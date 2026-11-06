# DSH 会话派生、消息编辑与侧边提问实施方案

> **状态**：修订版 v2（2026-11-04）。已吸收 OpenCode / WorkBuddy 两轮批注，逐条处理结果见 §17。
>
> **实现进度**：P0（§6）、P1（§5 的 `DshForkProvider`、§8 的 `disposeSession`、§9 的锚点与能力位）、P2（§7 的 `resolveEditAnchor` / `rewindSession`、事务化 repoint、索引器与 `createSession` 两道 superseded 防线）与 P3（btw 回收真机验证）已全部落地。测试见 `dsh-fork.test.ts`、`dsh-sessions.test.ts`、`dsh-runtime-resume.test.ts`、`dsh-message-editing.test.ts`、`btw.routes.test.ts`。P1 产物已在 24 份真实日志的 123 个 `turn/end` 边界上通过 DSH 自身 `restoreReleasedV4Artifact` + `JsonlSessionPersistence.open`；真机 `dsh --profile acp` 上既验证了 resume 继承源历史，也验证了 close 后日志停写、再 prompt 被拒。P4（回合内精确切分）为可选项。
>
> **基线**：`@deepseek-ai/dsh` 0.2.0-rc.2、DSH session format v4、CloudCLI 当前 main。
>
> **审阅目标**：重点检查 §2 的事实假设（尤其是 v4 日志的构造约束与 ACP resume 的拒绝条件）、§4 的锚点映射是否与既有 Provider 语义一致、§5 的产物是否真的能被 DSH 恢复，以及 §10 的失败模式是否有遗漏。批注请追加在文末“审阅批注”区，不修改正文。
>
> **关联文档**：
> - `docs/research/WorkBuddy-OpenCode-Pi对话编辑与Fork实施方案.md`（fork 共享契约与既有实现）
> - `docs/research/CloudCLI侧边提问btw功能方案.md`（btw 的实现与不变量）
> - `docs/research/CloudCLI的Provider架构分析.md`（provider 分层）

---

## 0. 结论摘要

三项能力不是三件事：

- **派生（fork）是基座**：写一份新的 DSH 会话日志，内容为源会话的事件前缀。CloudCLI 侧 `IProviderFork` 已经为此设计好，Pi / WorkBuddy / OMP / OpenCode 都是同一形状。
- **编辑 = 派生 + 重定向**：`resolveEditAnchor` 算出要保留到哪里，`rewindSession` 派生一份前缀并把原会话行指过去。网关的 `providerRewindsForEdit` 会自动走“先回退再普通 run”的分支，无需改网关。
- **侧边提问零额外代码**：`btw.service.ts` 直接消费 `provider.fork`，能力位 `supportsSessionForking` 打开后入口自动出现。额外需要的是 ACP `session/close`（销毁隐藏副本，否则进程仍持有日志句柄）。

难点不在 CloudCLI，而在 **DSH 日志的写入契约**：DSH 不接受带 `parentSession` 的会话被 ACP resume，而它自己的 `sessions.fork` 恰好会写这个字段。因此只能手工复刻它的 seed 构造，但**去掉 `parentSession`**。

**可以做到，但属于格式耦合，必须先做 spike 验证（§11）。**

### 0.1 审阅后的关键修正（v2）

| # | v1 的说法 | 实测结论 | v2 处理 |
| --- | --- | --- | --- |
| 1 | §5.3「单帧 zstd 应兼容」 | 读侧用 `assertZstdHeaderFrame` 要求**帧 0 的明文恰好只有一行头**，头+事件压一帧必然失败（`first frame is not exactly one header line`） | 帧布局固定为「帧 0 = 头行，帧 1..N = 事件」，S4 降级为回归断言 |
| 2 | §5.1「`delivery-accepted` 对 `seq < cut` 有豁免」 | 豁免条件是 `parentSession !== undefined && seq < cut`；本方案不写 `parentSession`，必须把该事件的 `data.sessionId` 改写为新 id，否则被拒 | 前缀复制不再是纯字节复制，增加一条改写规则 |
| 3 | §5.1 目标目录按 `projectKey(cwd)` 重算 | `assertStoredIdentity` 要求路径与 header 的 id / cwd / 世代 / 压缩方式完全一致，重算会在 symlink、`/var` vs `/private/var`、`DSH_SESSIONS_ROOT` 覆盖时被拒 | 目标目录从**源日志路径**推出，并断言目录名与 header 推导值一致 |
| 4 | §5.3 硬编码 `session.v4.jsonl.zstd` | `compression:'none'` 的根会报 `uses .jsonl.zstd, but this backend is configured for compression "none"` | 后缀、世代全部继承源文件名 |
| 5 | §5.2 回退 `findNewestSessionLog` | 该函数只在单会话项目返回，多会话项目直接 `null`；更糟的是可能取到别的主会话 | 派生路径删除该回退，只用行上的 `provider_session_id` |
| 6 | §4.1「一个事件 = 一条可见消息」 | 24 份日志中 8 条有 `surfaceOp: {op:'replace'}`，其中 3 条覆盖真实用户消息；`decodeSessionLog` 完全忽略它 | 被 replace 覆盖的行不得作为锚点 |
| 7 | §8「P3 不需要新代码路径」 | `IProviderRuntime` 只有 `run/abort/permissions/*BackgroundWork`，没有 close/dispose | 新增可选 `disposeSession(sessionId)`，P3 工作量上调 |

另外两条**好消息**，直接压缩了 spike 范围：

- **S0 已落地并跑通**：`scripts/spikes/dsh-fork-seed-selfcheck.mjs` 在本机 24 份日志、123 个 `turn/end` 边界（其中 36 个来自 seeded 日志，即 fork of fork）上，`restoreReleasedV4Artifact` 与真实 `JsonlSessionPersistence.open` 均 123/123 通过，7 条负向/边界控制全绿。
- **S1 / S2 真机已通过**（2026-11-04，`scripts/spikes/dsh-acp-resume-probe.mjs`）：手工 seed 能被真实 `dsh --profile acp` 的 `session/resume` 接受，且 resume 后的 prompt 正确答出了只存在于源会话历史里的路径。核心假设成立，余下只剩 S5/S6/S7/S8 这类边界验证。
- **生产实现已交叉验证**（P1 落地后，2026-11-04）：用 `DshForkProvider` 对同样的 24 份日志逐边界派生，产物再交给 DSH 自身 `restoreReleasedV4Artifact` + `JsonlSessionPersistence.open`，**123/123 通过**；另取一份真机产物用 `dsh-acp-resume-probe.mjs --seed` resume，追问「我让你读取的项目路径是什么」回答 `/Users/selier/Projects/open_projects/dsh-purge-mirror`（仅存在于源历史）。spike 构造器与生产构造器之间不存在漂移。
- 全量扫描 24 份日志：**没有任何一个 `turn/end` 处存在 pending inbox 消息**（`next-turn` / `next-step` 全为空）。「切在 `turn/end` 不会切出没人回答的问题」从假设升级为已证事实。

---

## 1. 需求与不变量

| 能力 | 用户语义 | 必须成立 |
| --- | --- | --- |
| 派生 | 从某条消息为止复制上下文，打开一个独立会话 | 子会话能被 DSH 正常续跑；源会话字节不变 |
| 编辑 | 替换一条已发送的用户消息，其后的内容不再是活跃分支 | 不物理删除原日志；编辑后能继续对话且上下文正确 |
| 侧边提问 | 从当前上下文问一个不进主会话的问题 | 主会话 transcript 与 DB 行不变；副本可回收 |

沿用既有文档的三条约束：

1. **不允许把历史拼进新 prompt 冒充 fork。** 子会话必须由 provider 可恢复的持久化形态生成。
2. **只在已结束的回合边界切。** 不产生半截工具调用或未闭合的 turn。
3. **不物理删除、不改写源会话。** 只读源日志，只写新目录。

---

## 2. 现状事实（可核对）

### 2.1 CloudCLI 侧

| 事实 | 位置 |
| --- | --- |
| `dsh` 的 `supportsMessageEditing` / `supportsSessionForking` 均为 `false` | `server/modules/providers/services/provider-capabilities.service.ts:157,172-173` |
| `DshProvider` 没有 `fork` 适配器 | `server/modules/providers/list/dsh/dsh.provider.ts:19-26` |
| `DshSessionsProvider` 没有 `resolveEditAnchor` / `rewindSession` | `server/modules/providers/list/dsh/dsh-sessions.provider.ts`（无这两个方法） |
| `AcpClient` 只有 `newSession` / `prompt` / `cancel` / `set_config_option` | `server/modules/providers/shared/acp/acp.client.ts:336,357,367,390,400,402` |
| `IProviderRuntime` 没有 close / dispose 能力 | `server/shared/interfaces.ts:33-55` |
| 历史解码的 zstd 分帧是启发式，解压失败被 `catch {}` 静默跳过 | `server/modules/providers/list/dsh/dsh-sessions.provider.ts:115-127` |
| 历史读取定位日志时**优先用 `provider_session_id` 拼路径**，拼不到才退 `findNewestSessionLog` | `server/modules/providers/list/dsh/dsh-sessions.provider.ts:342-348` |
| runtime 重启后只用缓存的 provider id 直接 prompt，不 resume | `server/modules/providers/list/dsh/dsh-runtime.provider.ts:555-568,644` |
| 历史解码丢弃 `user/message.data.id`，消息 id 由 `createNormalizedMessage` 重新生成 | `server/modules/providers/list/dsh/dsh-sessions.provider.ts:208-231`、`server/shared/utils.ts:490-498` |
| 编辑入口依赖 `message.transcriptAnchorId` | `src/modules/chat/transcript/MessageComponent.tsx:174-179` |
| 三个入口统一由两个能力位控制（编辑另加 `!isProcessing`） | `src/modules/chat/ChatInterface.tsx:1063-1065` |
| 会话重定向已有现成 DB 方法 | `server/modules/database/repositories/sessions.db.ts:655,723,742` |
| fork 服务层与编辑网关已通用化 | `server/modules/providers/services/sessions.service.ts:574,732,761,778`、`server/modules/websocket/services/chat-websocket.service.ts:319,367` |
| btw 无独立实现，直接消费 `provider.fork` | `server/modules/providers/services/btw.service.ts:84,134` |
| Pi 的 `rewindSession` 是可直接照抄的形状 | `server/modules/providers/list/pi/pi-sessions.provider.ts:720-765` |
| **DSH 的索引器没有 `isProviderSessionSuperseded` 检查**；Pi / Codex / Claude / OMP / WorkBuddy 都有 | `server/modules/providers/list/dsh/dsh-session-synchronizer.provider.ts`（无该检查）vs `pi-session-synchronizer.provider.ts:101` |

结论：CloudCLI 的契约齐全，DSH 只缺三个适配器方法、一个 ACP 方法（resume）、一个 ACP 方法（close）和锚点透传。

### 2.2 DSH / ACP 侧（0.2.0-rc.2）

安装路径：`~/.nvm/versions/node/<v>/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`。

| 事实 | 证据 |
| --- | --- |
| ACP 注册的方法：`session/new`、`list`、`resume`、`close`、`set_config_option`、`prompt`，外加 `cancel` 通知。**没有 fork。** | `dsh-acp/lib/index.js:1410` |
| `session/resume` 的参数是 `{ sessionId, cwd, mcpServers? }` | `dsh-acp/lib/index.js:1290-1310` |
| resume 拒绝：会话不存在、`origin === 'subagent'`、**`parentSession !== undefined`**、cwd 不匹配、会话已活跃 | 同上 |
| `AcpSession` 声明了 `static resume(...)` | `dsh-acp/lib/types/session.d.ts:54` |
| 原生 fork 是 `sessions.fork(source, boundary, childId?)`，按**包含式 seq 前缀**切 | `dsh-session/lib/index.js`（`fork` / `buildForkSeed`） |
| `buildForkSeed(events, boundary)`：复制 `0..boundary`，追加 `session/end-seed{inherited:true}`（`seq = boundary+1`，`time` 取 boundary 事件），再追加 `openTurnClosers({ kind: 'forked' })` | 同上 |
| 原生 fork 的 meta 固定写入 `parentSession: sourceId`、`isSeeded: true` | `dsh-session/lib/index.js`（`fork` 的 `meta`） |
| v4 文件头的合法字段：`type/version/id/createdAt/isSeeded/delegationDepth` + 可选 `cwd/parentSession/origin/agentPreset`。**没有 `seedLength`。** | `dsh-session-format-v1-to-v2/lib/index.js:HEADER_REQUIRED/OPTIONAL`、`dsh-session-format-v3-to-v4/lib/index.js:assertReleasedV4Header` |
| 恢复校验：`cut = inheritedEventCount`；`seq` 必须稠密（`seq === index`）；`isSeeded === true` 时**最后一个** `data.inherited === true` 的 `session/end-seed` 的 index 必须等于 `cut`；未知事件类型必须 `ignorable === true` | `dsh-session-format-v3-to-v4/lib/index.js:restoreReleasedV4Artifact` |
| **帧 0 的明文必须恰好只有一行头**，否则报 `first frame is not exactly one header line`；事件可合并在后续帧 | `dsh-session-persistence-jsonl/lib/index.js:2293-2295,2937-2951` |
| `delivery-accepted` 的豁免条件是 `header.parentSession !== undefined && event.seq < cut`，且 `deliveryId === header.id`；**不写 `parentSession` 就没有豁免** | `dsh-session-format-v3-to-v4/lib/index.js:1034` |
| `assertStoredIdentity` 要求文件路径等于 `generationLogPath(root, header.cwd, header.id, version, compression)` | `dsh-session-persistence-jsonl/lib/index.js:3384-3397` |
| `session/close` 走 `requireSession`，对未激活的会话会抛 `unknown session` | `dsh-acp/lib/index.js:1184-1189,1382,1408-1415` |
| resume 拒绝「已活跃」的判定是 `sessions.has(id) \|\| activating.has(id) \|\| ctx.sessions.get(id) !== undefined`，**`session/new` 建出的会话也算** | `dsh-acp/lib/index.js:1293-1296` |
| `listSessions` 只过滤 `origin === 'subagent'` 与 `parentSession !== undefined` | `dsh-acp/lib/index.js:1355` |
| 清理未闭合 turn 的合成事件由 `openTurnClosers` 生成（tool/result、step/end、turn/end，reason=`forked`），约 80 行且依赖精确文案 | `dsh-session/lib/index.js` |

> **对早期判断的修正**：v4 文件头不存 `seedLength`。继承长度完全由 `session/end-seed` 事件的位置表达。构造产物时不需要、也不能写该字段（写了会被 `unexpected field` 拒绝）。

### 2.3 实测日志结构

以本机真实会话为例（`~/.dsh/sessions/--Users-selier-Documents-deepseek-harness-default-workspace--/session-14fbceb0-.../session.v4.jsonl.zstd`）：

```text
0  permission/preset
4  turn/start            turn=1
6  step/start            turn=1 step=1
7  system/message        turn=1 step=1
8  user/message          data.id=592bec4e-...
9  user/message          data.id=b5823686-...   ← 注入，source.kind ≠ user
26 turn/end              turn=1 reason=aborted
28 turn/start            turn=2
30 step/start            turn=2 step=1
31 user/message          data.id=4a03285d-...
32 assistant/message     turn=2 step=1（message.id 存在）
33 step/end
34 turn/end
```

由此得到四条直接影响方案的事实：

1. **真实用户消息不在 turn 开头**，它前面有 `turn/start`、`step/start`、`system/message`。因此“在用户消息前一个事件截断”会切在 turn 内部，必须改用**上一个 `turn/end`** 作为边界。
2. 一个 turn 内只有一条真实用户消息（`source.kind === 'user'`），其余 `user/message` 是注入上下文，历史解码已在过滤（`dsh-sessions.provider.ts:213-219`）。
3. `assistant/message` 是**每 step 一条**，一个 turn 可能有多条；`message.id` 存在但不保证跨事件唯一可用于切分。
4. `seq` 从 0 开始稠密；文件头没有 `seq`。
5. **`surfaceOp: {op:'replace', startSeq, endSeq}` 会改变“可见对话”**。本机 24 份日志中 8 条带该字段，3 条覆盖真实用户消息（如 `d151591c…` 在 seq 968 用 `compact-checkpoint` 替换 8..695；`session-cbf70f33…` 在 seq 833 用 `rewind-…` 替换 826-827）。`decodeSessionLog` 目前完全忽略 `surfaceOp`，把已被替换的内容照常渲染。

---

## 3. 方案总览

```text
                     ┌─ 派生（入口 A）─────┐
用户消息/助手消息 ───┼─ 编辑（入口 B）─────┼─> DshForkProvider.writeSeedPrefix()
                     └─ 侧边提问（入口 C）─┘         │
                                                     ├─ 新目录 + v4 头(isSeeded, 无 parentSession)
                                                     ├─ 复制事件 0..boundary
                                                     └─ 追加 session/end-seed
                                                              │
                          ┌───────────────────────────────────┴────────────┐
                          │ 派生：insert 新 session 行                   │
                          │ 编辑：mark superseded + repoint 原行          │
                          │ 侧问：ephemeral 行 + 关闭时删除 + ACP close   │
                          └────────────────────────────────────────────────┘
```

分四期落地：

| 期 | 内容 | 依赖 |
| --- | --- | --- |
| P0 | ACP `session/resume` + `session/close`；runtime 缓存以 DB 为准 | 无（独立修 bug） |
| P1 | `DshForkProvider` + 锚点透传 + `supportsSessionForking` + `disposeSession` | P0、spike S0/S1/S2 |
| P2 | `resolveEditAnchor` + `rewindSession` + 索引器 superseded 早退 + `supportsMessageEditing` | P1 |
| P3 | 侧边提问联调（含关闭副本时 ACP close） | P1、P0 |

---

## 4. 锚点模型

### 4.1 锚点定义

**统一用 `event.seq` 的十进制字符串作为锚点。** 它是 DSH 日志里唯一稳定、稠密、与切分点直接对应的标识；`data.id` 只存在于用户消息，`message.id` 不保证覆盖所有可切行。

历史解码时（`decodeSessionLog`）为两类行补锚点：

| 行 | `transcriptAnchorId` | `forkAnchorId` |
| --- | --- | --- |
| 真实用户消息（`source.kind` 缺失或 `user`） | `String(seq)` | `String(seq)` |
| `assistant/message` 的文本块 | `String(seq)` | `String(seq)` |
| 助手思考块 | 不设 | 不设 |
| 工具调用/结果 | 不设 | 不设 |

这样 `isCuttableMessage`（`btw.service.ts:453`）天然只放行文本行，`MessageComponent` 的编辑入口也只在用户消息上出现。

**两条锚点过滤规则（v2 新增）**：

1. **被 `surfaceOp: replace` 覆盖的行不设锚点。** 解码时按 seq 顺序回放 `surfaceOp`，凡落在某个 `replace` 区间 `[startSeq, endSeq]` 内的行，`transcriptAnchorId` / `forkAnchorId` 都置空；替换事件本身（`compact-checkpoint`、`rewind-…`）也不设锚点。否则用户可以对一段已被压缩掉的历史发起编辑或派生，切出来的前缀与 DSH 自己看到的对话不一致。这是**锚点语义**问题，复制前缀本身在 compaction 日志上仍然合法（§11 已验证），所以本期只改锚点，不改 `decodeSessionLog` 的渲染行为（登记在 §10）。
2. **同一个 turn 内的多条 `assistant/message` 共享同一个 `forkAnchorId`**（都等于 `T.end.seq`）。前端不依赖该值去重，但集成测试不能断言“两条助手行派生出不同锚点”。

> **已知限制**：实时流式消息由 ACP chunk 拼出，chunk 不含 seq，因此当轮消息在 `complete` 后的历史刷新前没有锚点，三个入口要刷新后才出现。这与现有乐观消息窗口同源，`isProcessing` 也已禁用编辑，接受。

### 4.2 三个动作的边界映射

设锚点所在 turn 为 `T`，`T.end` 为该 turn 的 `turn/end`，`T.prevEnd` 为上一个 turn 的 `turn/end`：

| 动作 | 目标边界 | 理由 |
| --- | --- | --- |
| 聊天内派生（从用户消息） | `T.end.seq` | 与 btw 的 `advanceToTurnEnd` 一致：不把“没有答案的问题”交给子会话 |
| 聊天内派生（从助手消息） | `T.end.seq` | 助手行本来就在 turn 内，对齐到回合结束 |
| 侧边提问（默认） | 最新助手行所在 turn 的 `T.end.seq` | `resolveBtwAnchor` 默认取最新回复，天然落在已闭合 turn（`btw.service.ts:222-243`） |
| 编辑用户消息 | `T.prevEnd.seq`；若 `T` 是第一个 turn 则 `null` | 丢弃该消息及其整个回合，保留之前全部上下文 |

> 与 Claude 的细微差异：Claude 的 `forkAnchorId` 是消息自身 uuid，从**用户消息**派生会停在该消息、不含它的回答；DSH 按上表对齐到回合结束，会带上该回答。这与 btw 的 `advanceToTurnEnd` 一致（它刻意避免把“没人回答的问题”交给子会话），也是回合边界方案的自然结果。如果要严格复刻 Claude 的语义，只能走 §15 的档位 B。

**派生边界一律是 `turn/end` 的 seq**，因此前缀天然闭合，不需要复刻 `openTurnClosers`。这是本方案最重要的简化：把“回合内精确切分”明确排除在外。

> **已证事实（v2）**：全量扫描本机 24 份真实日志，**没有任何一个 `turn/end` 处存在 pending inbox 消息**（`next-turn` / `next-step` 全为空）。因此「切在 `turn/end` 会把一个没人回答的问题带给子会话」不成立，§4.2 的映射无需为此加特例。

### 4.3 尾部未闭合

三种情况分开处理：

| 情况 | 处理 |
| --- | --- |
| 目标锚点的 turn 已闭合 | 正常 |
| 目标锚点的 turn 未闭合（运行中） | **派生**：退到更早的 `turn/end`（不产生半截）；**完整会话派生**：直接拒绝 |
| 日志里没有任何 `turn/end` | 拒绝（`FORK_SOURCE_NOT_READY`） |

**「尾部未闭合」的判定口径（v2 补充）**：`lastEvent.type !== 'turn/end'` 即视为尾部未闭合，不比较 `turn` 编号、不看 `step`。本机存在现成 fixture：`d151591c…` 最后一条是 `step/start`（seq 1690），最后一个 `turn/end` 在 1642，正好覆盖这个分支。

“完整会话派生”（侧边栏 `…` → fork，无 `upToAnchorId`）在源会话运行中应当**拒绝**：它的语义是“复制此刻全部”，悄悄退一格会静默少内容。侧边提问不受影响，它的默认锚点本来就取上一轮回答。

**不做**：在未闭合 turn 尾部手写 `forked` cause 的 closers。这需要精确复刻 tool/result、step/end、turn/end 的文案与字段，任何一处差异都会产出 DSH 打不开或语义错乱的会话，收益却只是“运行中也能完整派生”。

---

## 5. 派生实现（`DshForkProvider`）

### 5.1 产物格式

```text
<srcProjectDir>/<encoded newId>/session[.vN].jsonl[.zstd]

物理布局（zstd）
  帧 0      明文 = 一行头 JSON（且只有这一行，必须以换行结尾）
  帧 1..N   明文 = 事件 0..boundary 的 JSONL + 最后一行 end-seed

逻辑内容
  行 0      { type:"session", version:4, id:newId, createdAt:<now>,
              cwd:<源 header.cwd>, isSeeded:true,
              delegationDepth:<源 header.delegationDepth ?? 0>,
              [agentPreset:<源 header.agentPreset>] }
  行 1..N   源事件 0..boundary（seq / time / sourceEventSeqs 不变；
             仅 `delivery-accepted` 改 data.sessionId，见下）
  行 N+1    { type:"session/end-seed", seq: boundary+1, time: <源 boundary 事件 time>,
              data:{ inherited:true } }
```

约束逐条对应 §2.2 的校验：

- **目标目录从源日志路径推出**：`srcProjectDir = dirname(dirname(srcLogPath))`，新会话目录放在同一父目录下。前置断言 `basename(srcProjectDir) === projectKey(header.cwd)`，不一致直接 `FORK_UNSUPPORTED_FORMAT`。**不要**用 `projectKey(cwd)` 重算——`assertStoredIdentity` 校验的是路径与 header 的 id / cwd / 世代 / 压缩方式完全一致，symlink、`/var` vs `/private/var`、结尾斜杠、`DSH_SESSIONS_ROOT` 覆盖都会让重算结果对不上。
- **文件名继承源日志的世代与压缩后缀**：从源文件名解析 `session(?:\.v(\d+))?\.jsonl(?:\.zstd)?`，源是 `.jsonl`（`compression:'none'`）就写 `.jsonl`，源是 `.v4.jsonl.zstd` 就写同名段。同一个 root 内不混用编码。
- `header` 字段集必须在白名单内，**不写 `parentSession`、不写 `origin`、不写 `seedLength`**。
- `seq` 必须稠密：原样复制且不增删事件，这一点自动满足；`end-seed` 接在末尾，`seq = boundary+1`。
- `isSeeded: true` 必须与“最后一个 `inherited:true` 的 end-seed”位置一致。**fork of fork 时前缀里已有旧 end-seed，这是允许的**——校验只取最后一个，而新 end-seed 永远在最后。
- **`session-log-deepseek/delivery-accepted` 必须改写 `data.sessionId` 为新 id**。豁免条件要求 `parentSession !== undefined`（§2.2），而本方案不写它；不改写会被 `current-generation delivery marker names the wrong Session` 拒绝。`seq` / `data.throughSeq` 保持原值（稠密与“throughSeq 必须早于自身”仍成立，已实测）。该事件只在 `session-log-deepseek` 插件开启时产生，默认关闭，**用现有日志做 spike 永远暴露不了它**。字段形状不认识 → `FORK_UNSUPPORTED_FORMAT`。
- `parentSession` 绝不写：这是 ACP resume 的硬性拒绝条件（§2.2）。血缘由 CloudCLI 的 `forked_from_session_id` 记录。**副作用比 v1 写的更大**：`listSessions` 只过滤 `origin==='subagent'` 与 `parentSession!==undefined`，所以派生产物会作为一条**普通可见会话**出现在 DSH 自己的会话列表 / DSH Desktop 里（按 cwd 分组），且没有 DSH 侧标题。属可接受损失，列入 §10。
- **帧 0 只放头行**。读取侧 `readZstdPrefix` 取第一帧后 `assertZstdHeaderFrame` 要求明文恰好一行；头与事件压在一帧会直接失败。事件侧可合帧，无需逐事件分帧。

### 5.2 构造步骤

1. **定位源日志**：以行上的 `provider_session_id` 为准（`sessions.service.ts:598-603` 已保证非空），复用 `resolveSessionLogPath(providerId, cwd)` 拼路径（`dsh-sessions.provider.ts:158`，当前是模块私有函数，需导出）——与 `fetchHistory` 的优先顺序一致（`:342-348`）。`jsonl_path` 只用于一致性校验，为空时回退到**同一个 id 推出的路径**。**派生路径禁止回退 `findNewestSessionLog`**：该函数只在单会话项目返回，多会话直接 `null`；即使返回，也可能把别的主会话当源，产出错误内容且不报错。仍找不到 → `FORK_SOURCE_NOT_READY`。
2. **解码并做强校验**：`decodeSessionLogBuffer` 的坏帧会被 `catch {}` 静默跳过（`dsh-sessions.provider.ts:115-127`），因此“能解出行”不等于“没丢事件”。解码后必须断言：
   - 行 0 是合法 header，`version === 4`，字段集在白名单内；
   - 对 `i = 0..last` 逐个断言 `events[i].seq === i`（空洞即拒绝）；
   - 末尾存在 `turn/end`（§4.3）；
   - 任一行 `JSON.parse` 失败 → 拒绝。
3. **改写 delivery marker**（§5.1），只动 `data.sessionId`；其余字段保持原值。
4. **解析 `upToAnchorId`**：`Number.parseInt`，必须是非负安全整数。不合法 → `FORK_ANCHOR_INVALID`。
5. **计算 boundary**（§4.2 / §4.3），并校验 `boundary` 是存在的、`type === 'turn/end'` 的 seq。
6. **生成 `newId = 'session-' + randomUUID()`**；从源 header 复制 `cwd`、`agentPreset`；从源路径推出目标项目目录与文件名（§5.1）。
7. **组装并编码**：帧 0 = 头行，帧 1 = 事件 0..boundary + end-seed（事件量大时按批分帧）。

### 5.3 写入与原子性

- **帧布局**：帧 0 = 头行单独压缩；帧 1..N = 事件（可合帧）。不要把头与事件压进同一帧，读取侧会报 `first frame is not exactly one header line`。
- 先写 `<srcProjectDir>/.tmp-<uuid>/<同名文件>`，`fsync` 后 `rename` 到 `<srcProjectDir>/<encoded newId>/`。`rename` 在同一文件系统内原子，watcher 不会读到半成品。`.tmp-` 前缀不与 `session-` 目录匹配，扫描器天然忽略。
- **自检后再返回**：写完后按 §5.2 的规则再读一遍产物（header 白名单、`seq` 稠密、最后一个 marker 位置、帧 0 只有一行），失败即删除新目录。生产代码**不 import DSH 内部包**；真实 `JsonlSessionPersistence.open` 只用于离线 spike 与集成测试的门。
- 失败时删除临时目录与新目录；**绝不**留下半成品。
- 返回 `{ providerSessionId: newId, jsonlPath }`，供调用方插 DB 行（与 `WorkbuddyForkProvider` 的“确认而非假设”一致）。

### 5.4 版本守卫

不做“按 dsh 版本号判断”，因为 rc 阶段版本号与格式世代不同步。改为**读文件判断**：

- 源文件名必须匹配 `session(?:\.v(\d+))?\.jsonl(?:\.zstd)?`；只接受**世代 4** 与 `none` / `zstd` 两种压缩，产物沿用同一组合。世代与 `header.version` 不一致 → 拒绝。
- 第一行解析出的 `header.version` 必须是 `4`，且字段集在白名单内。
- 任一事件 `type` 不在已知词表内且 `ignorable !== true` → 拒绝。
- 出现 `delivery-accepted` 但字段形状无法安全改写 → 拒绝（不猜）。
- 拒绝时统一抛 `FORK_UNSUPPORTED_FORMAT`（409），文案明确“当前 DSH 版本暂不支持派生/编辑”，**绝不降级硬写**。

这保证上游升格式时功能先失效而不是先写坏数据。

---

## 6. 前置：ACP resume 与运行时缓存（P0）

### 6.1 `AcpClient` 补 `resumeSession`（`closeSession` 随 P3）

```ts
resumeSession(sessionId, cwd, extra?: { mcpServers?: unknown[] })
  -> request('session/resume', { sessionId, cwd, mcpServers: extra?.mcpServers ?? [] })

// P3：销毁 btw 隐藏副本前调用
closeSession(sessionId)
  -> request('session/close', { sessionId })
```

`resume` 返回 `{ configOptions }`（与 `session/new` 同形状的配置项），需调用 `rememberConfigOptions`，否则模型切换会失效。

### 6.2 runtime 缓存改为“以 DB 为准”

现在 `dsh-runtime.provider.ts:555-568` 只在缓存缺失时才读 DB，导致三个实际问题：

| 场景 | 现状 | 修正 |
| --- | --- | --- |
| ACP 子进程重启后继续旧会话 | 命中缓存 id → `prompt` 报 `Unknown session` | 本进程未持有该 id 时先 `session/resume` |
| 编辑 repoint 到新 provider id | 缓存仍是旧 id → 跑错会话 | 每轮比对 DB，不一致就覆盖 |
| 编辑首条 detach（DB 为 NULL） | 缓存仍是旧 id → 继续旧会话 | DB 为空时删除缓存并新建 |
| 本进程 `session/new` 建过的会话 | 若只记 `resumedIds`，会误判“没 resume 过”去 resume → `session is already active` | 集合记的是 **created ∪ resumed**（本进程 ACP 侧仍存活的 id） |
| `trimSessionMappings` 裁掉映射后按 DB 重建 | 子进程里会话仍活跃 → resume 被拒 | 裁剪时**不删仍存活的 id**；必要时先 `session/close` 再删 |

实现上用 `liveAcpIds: Set<string>`（随 `AcpServerState` 生命周期）记录本进程 ACP 侧仍存活的 id；`sessionByApp` 只作为本轮解析结果的缓存，不再作为“真相”。三条维护规则：

1. `session/new` 成功后立即加入；`session/resume` 成功后加入。
2. 并发场景下第二轮 run 可能在该 id 尚未入集合时也发起 resume：用 `resuming: Map<string, Promise<void>>` 去重，两次 run 共享同一个请求。不靠解析 `session is already active` 文案兜底——错误文案是上游内部字符串，随版本变化。
3. 子进程重启时整张表随 `AcpServerState` 重建，无需手动清理；P3 引入 `session/close` 后，close 成功的 id 也必须移出，否则下一次 `prompt` 会报 `Unknown session`。

resume 失败时的错误映射：`session is not resumable` / `session is already active` / `session cwd does not match` 都要转成可读错误，而不是把原始 JSON-RPC 文案直接抛给用户。

> 这一期不依赖 DSH 日志格式，独立可交付，同时修掉现网“ACP 重启后旧会话直接失败”的问题。

---

## 7. 编辑（P2）

### 7.1 `resolveEditAnchor`

```ts
async resolveEditAnchor(sessionId, anchorId) {
  // 1) 定位并解码当前日志
  // 2) anchorId 必须是真实 user/message 的 seq，否则 { found:false }
  // 3) 找该 seq 所属 turn 的前一个 turn/end
  //    - 有 → { found:true, resumeThroughId:String(prevEndSeq) }
  //    - 该 turn 是第一个 → { found:true, resumeThroughId:null }
}
```

三点要求：

- 只接受**真实用户消息**锚点（`source.kind` 缺失或 `user`），注入的 `user/message` 不可编辑。
- `resumeThroughId` 是“最后保留”的 seq，即上一个 `turn/end`；不要返回 `turnStart - 1`，因为 turn 之间还有 `agent/inbox/spliced`，保留它会让前缀关系不确定。
- 找不到锚点返回 `{ found:false }`，而不是抛错——网关会区分 `ANCHOR_NOT_FOUND` 与 `EDIT_NOT_SUPPORTED`（`chat-websocket.service.ts:341-352`）。

### 7.2 `rewindSession`

照 Pi 的形状（`pi-sessions.provider.ts:720-765`），但**把两次 DB 写合并成一个事务**：

```ts
// 0) 先 fork；失败直接抛，DB 与 ACP 状态都不动
const forked = keepThroughId === null
  ? null
  : await forkDshSeed({ ...source, boundary: Number(keepThroughId) });

// 1) 原子提交：旧 id 记 superseded + 行指向新日志（首条则清空指针）
if (!forked) {
  sessionsDb.supersedeAndDetachSession({ sessionId, provider: 'dsh', providerSessionId, jsonlPath });
} else {
  sessionsDb.repointSessionToProviderSession(sessionId, {
    providerSessionId: forked.providerSessionId,
    jsonlPath: forked.jsonlPath,
    supersededProviderSessionId: providerSessionId,
  });
}

// 2) best-effort 关闭旧 ACP 会话（失败不阻断，见下）
await closeQuietly(providerSessionId);
```

三点必须说清：

- **`repointSessionToProviderSession` 目前不会写 `superseded_provider_sessions`**：它的 `supersededProviderSessionId` 只用于“迁移子行 + 删除旧行”（`sessions.db.ts:684-710`），Pi 是在外面单独调用 `markProviderSessionSuperseded`。两次写之间有窗口：mark 成功、repoint 失败时，行仍指向旧 id 但旧日志已被判死。建议给该方法补一条同事务的 superseded upsert（ON CONFLICT 幂等，Pi 的重复调用无副作用），并为首条分支新增 `supersedeAndDetachSession`。**不要把顺序调成“先 mark 再 repoint”当作修复**——窗口仍在。
- **rewind 也必须 close 旧 ACP 会话**，否则与 §8 自相矛盾：子进程仍持有旧日志的写句柄，superseded 日志可能被继续追加；旧标签页继续说话会写进“已失联”的日志；反复编辑还会累积内存。close 走 `requireSession`，对“fork 出来但尚未 activate”的 id 会抛 `unknown session`，所以必须 try/catch，只吞这一类。
- `keepThroughId` 已经是 `turn/end` 的 seq，派生时**不做二次对齐**（对齐只发生在派生入口）。

因为该方法存在，`providerRewindsForEdit` 返回 true，网关自动走“先 rewind、再普通 run”的路径（`chat-websocket.service.ts:367-380`），runtime 不需要支持“从中间 resume”。

### 7.2.1 必须同时补上索引器的 superseded 检查

这是本方案里最容易漏、后果最严重的一处。

DSH 的 app session id 与 provider session id 原本相等。编辑 repoint 之后，该行的 `provider_session_id` 变成新 id，但**旧日志目录仍在磁盘上**。`DshSessionSynchronizer.synchronize()` 每次都会全量扫描所有项目目录（`dsh-session-synchronizer.provider.ts:41-97`，注释明确写了 `since` 被忽略），于是：

1. 扫到旧目录，调用 `createSession('session-旧', ...)`；
2. `createSession` 先按 `provider_session_id = 'session-旧'` 查，查不到（已被 repoint）；
3. 走 INSERT，命中 `session_id` 主键冲突；
4. `ON CONFLICT(session_id) DO UPDATE SET provider_session_id = excluded.provider_session_id, jsonl_path = excluded.jsonl_path`（`sessions.db.ts:264-286`）把该行**改回旧 provider id 与旧日志**。

结果：编辑在用户不知情的情况下被回滚，甚至可能错乱到两个日志之间。

其他 provider 都靠索引器里的 `isProviderSessionSuperseded` 早退避免（`pi-session-synchronizer.provider.ts:101` 等）。**DSH 目前没有这一行**，P2 必须加上：

```ts
if (sessionsDb.isProviderSessionSuperseded(sessionId, this.provider)) {
  return null;
}
```

放在 `upsertSessionLog` 的最前面（`fsp.access` 之前即可）。这一条要在验收里专门覆盖：编辑完成后强制跑一次全量同步，断言 `provider_session_id` 仍是新 id。

**但只加这一条不够（v2 补充）**。真正执行覆盖的是 `createSession` 的 `ON CONFLICT(session_id) DO UPDATE`（`sessions.db.ts:264-286`），而 `isRetiredProviderSession` 只在 `existing` 为空时生效（`:258-260`）——旧日志重扫时 `existing` 查的是 `provider_session_id`，repoint 后查不到，于是落到 INSERT，再按主键冲突 UPDATE 回去。两条防线至少要有其一：

- 在 `createSession` 的 INSERT 之前，按 `session_id` 再查一次，若该行**当前**的 `provider_session_id` 已被 superseded，直接 `return sessionId`，不做 UPDATE；
- 或让索引器早退同时按 `provider_session_id` 与 `session_id` 两个键判定。

推荐前者：它挡在唯一的写入点上，对所有 provider 都成立，且不依赖调用顺序。

### 7.3 首条消息

`keepThroughId === null` → 原子地「记 superseded + 清空 provider 指针」→ runtime 下一轮新建 ACP 会话。**不要写成“先 mark 再 detach”**：detach 抛错时行会被标死但指针还在，用户看到的是会话再也开不起来。新增 `supersedeAndDetachSession` 把两条写进一个事务，顺序问题即消失。旧日志被标 superseded；但如 §7.2.1 所述，**还必须补上 `createSession` 写入点的守卫**，否则旧目录会在下一次全量扫描时把该行重新指回旧日志。

---

## 8. 侧边提问（P3）

**v1 说“不需要新代码路径”是错的**，实际有三处要补：

1. **`provider.fork` 存在**（P1 已具备），`supportsSessionForking` 打开后 `onAskAsideFromMessage` 自动出现（`ChatInterface.tsx:1065`）。
2. **新增 runtime 的销毁钩子**。btw 的销毁顺序是 `quiesceBtwSession` → `retireProviderSession` → 删行删文件（`btw.service.ts:257-300,387+`），但 `IProviderRuntime` 只有 `run / abort / permissions / listBackgroundWork / stopBackgroundTask`（`server/shared/interfaces.ts:33-55`），**没有任何入口能关掉 ACP 会话**。需要加一个可选方法：

   ```ts
   disposeSession?(sessionId: string): Promise<void>;
   ```

   DSH 实现为 `session/close` + 从 `liveAcpIds` 移出；其他 provider 不实现。放在 `quiesceBtwSession` 内、删行删文件**之前**调用，失败只记日志、不阻断删除（否则关不掉的抽屉更糟）。close 对未 activate 的 id 会抛 `unknown session`，视为成功。
3. **不 close 的后果**：ACP 子进程仍持有该会话的写句柄，删除后日志可能被重新创建，watcher 会把它当普通会话索引回来，直接违反 btw 的不变量 I4。

`resolveTranscriptPath` 已由 `DshSessionSynchronizer` 实现（`dsh-session-synchronizer.provider.ts:118-124`），删除路径无需新增。

> **交付顺序**：`supportsSessionForking` 同时放出「派生」和「侧边提问」两个入口（`ChatInterface.tsx:1066-1067` 共用开关），没有单独的能力位。因此 `disposeSession` + `session/close` 必须和 P1 同一批交付，不能留到 P3；P3 只剩 btw 联调与回收验证。

btw 的默认锚点取“最新一条回复”，因此主会话运行中开侧问也是安全的（不会切到未闭合 turn）。这一结论依赖 §4.2 的对齐规则，若改成精确 seq 就会失效。

---

## 9. 前端与能力位

| 改动 | 位置 |
| --- | --- |
| 打开两个能力位 | `provider-capabilities.service.ts:172-173` |
| 历史解码补 `transcriptAnchorId` / `forkAnchorId` | `dsh-sessions.provider.ts:decodeSessionLog` |
| 注册 `readonly fork = new DshForkProvider()` | `dsh.provider.ts` |

前端不需要改：能力位是唯一的显示开关（`ChatInterface.tsx:1063-1065`），编辑按钮另有 `transcriptAnchorId` 与“无附件”两个前置条件（`MessageComponent.tsx:174-179`），DSH 本来就不支持附件（`supportsImages/supportsFiles = false`），不冲突。

两个能力位各有一个**开关即生效**的陷阱：

- `supportsMessageEditing` 打开后，`resolveEditAnchor` 必须存在且**总是返回对象**。网关区分 `anchor === null`（→ `EDIT_NOT_SUPPORTED`）与 `anchor.found === false`（→ `ANCHOR_NOT_FOUND`，`chat-websocket.service.ts:341-352`）。返回 `null` 会让编辑入口出现但每次都报“不支持”。
- `supportsSessionForking` 打开后 `onAskAsideFromMessage` 与 `onForkFromMessage` **同时**出现（`ChatInterface.tsx:1066-1067`），DSH 只做 fork 等于把 btw 一起打开。所以 P1 必须带上 §8 的 `disposeSession`。

---

## 10. 边界与失败模式

| 场景 | 行为 |
| --- | --- |
| 源日志路径不存在 / `provider_session_id` 为空 | `FORK_SOURCE_NOT_READY`。**不回退** `findNewestSessionLog`（§5.2） |
| 锚点不存在，或不是可切的文本事件（工具/思考/注入消息） | `FORK_ANCHOR_INVALID` |
| 锚点落在 `surfaceOp: replace` 覆盖的行上 | 该行本就没有锚点，UI 不提供入口；直接调用按 `FORK_ANCHOR_INVALID` 拒绝 |
| 目标 turn 未闭合 | 派生退到上一个 `turn/end`；完整派生拒绝 |
| 格式版本不认识 / 压缩方式不认识 | `FORK_UNSUPPORTED_FORMAT`，不写任何文件 |
| 源日志是 `compression:'none'` | 产物沿用 `.jsonl` 后缀，不写 `.zstd` |
| 前缀含 `delivery-accepted` | 改写 `data.sessionId`；字段形状不认识 → 拒绝 |
| fork of fork | 前缀里保留旧 `session/end-seed`，新 marker 追加在末尾，校验只看最后一个 |
| 编辑首条消息 | 原子「记 superseded + detach」+ 新 ACP 会话 |
| 编辑后立刻再编辑 | 每次都基于当前 `provider_session_id` 的新日志，天然幂等 |
| `rewindSession` 的 fork 成功但 DB 提交失败 | fork 产物成为孤儿目录（被索引器扫到即一条普通会话）；调用方在 catch 里删除新目录 |
| 并发编辑 / 运行中编辑 | 前端 `isProcessing` 禁用；后端 `chatRunRegistry` 保证同一会话只有一次运行 |
| repoint 后索引器扫描新目录 | `createSession` 先按 `provider_session_id` 查已有行并 UPDATE，不会多建（`sessions.db.ts:201-238`） |
| repoint 后索引器扫描**旧**目录 | 会命中主键冲突并把 provider id 改回旧值；必须补 superseded 早退 + `createSession` 写入点守卫（§7.2.1） |
| watcher 在 rename 后、DB 插入前扫到新目录 | 会先插一行；调用方的插入随后按 `provider_session_id` 命中并 UPDATE，不产生重复行。由 S8 覆盖 |
| 源会话被归档 | 派生仍可进行（只读），但子会话是新生行，不受归档影响 |
| symlink 的 cwd | resume 用 `sameDirectory` 比较；派生**复制源路径结构**而不是重算，S5 只验 resume 一侧 |
| 派生产物出现在 DSH 自己的会话列表 / DSH Desktop | `parentSession` 未写 → 不被过滤，会成为一条**普通可见会话**，无 DSH 侧标题，`workspace.json` 也未登记（`registerSessionWithDesktopWorkspace` 只在 `session/new` 走，`dsh-runtime.provider.ts:571-576`）。属可接受损失，不修 |
| `decodeSessionLog` 忽略 `surfaceOp` | **既有行为**，不是本期引入。本期只保证锚点不落在被替换行上；渲染层的修正另立需求 |

---

## 11. 待验证假设（spike）

按顺序做，任一条失败都要回到方案调整。全部只读源日志、只写临时目录。

| # | 假设 | 验证方式 | 失败退路 |
| --- | --- | --- | --- |
| **S0** | 离线自检：真实 `restoreReleasedV4Artifact` + `JsonlSessionPersistence.open` 能接受构造出的 seed | `node scripts/spikes/dsh-fork-seed-selfcheck.mjs`：遍历本机全部日志 × 每个 `turn/end` 边界构造 seed；断言 0 失败。**已跑通 24 份 / 123 边界 / 7 条控制** | 任一失败即定位到该事件类型，先修构造器。**这是第一道门，不通过不进入真机** |
| S1 | 手工 seed（v4 头 + 前缀 + end-seed，**无 parentSession**）能被 `session/resume` 接受 | **已通过（2026-11-04 真机）**：构造 seed → `dsh --profile acp` → `session/resume` 返回 2 个 configOptions | 已被事实取代；保留为回归（`node scripts/spikes/dsh-acp-resume-probe.mjs --source <日志>`） |
| S2 | resume 后 prompt 真的继承前文上下文 | **已通过（2026-11-04 真机）**：对 `session-6fc583e3…` 的 seed 追问“我让你读取的项目路径是什么”，回答 `/Users/selier/Projects/open_projects/dsh-purge-mirror`（仅存在于源会话历史） | 已被事实取代；保留为回归（同脚本加 `--question "…"`） |
| S3 | fork of fork 能通过 restore | 对一份 `isSeeded:true` 的日志再派生一次 | 已离线通过；保留为回归 |
| S4 | **帧 0 必须恰好只有一行头** | 构造“头 + 事件同帧”的负向用例，断言报 `first frame is not exactly one header line`；正向用例断言可读 | 无退路——这是读取层硬约束，帧布局已按此固定 |
| S5 | `sameDirectory` 对 symlink cwd 的行为；resume 传空 `mcpServers` 不丢工具 | 用带 symlink 的项目路径 resume；对比 resume 前后的工具列表 | cwd 用源 header 的 `cwd` 原值，不做规范化；MCP 若丢失则从 profile 重挂 |
| S6 | 运行中尾部未闭合时，退到上一个 `turn/end` 的产物可用 | 主会话运行中派生（用 `d151591c…` 这类尾部未闭合的日志做 fixture），resume 后 prompt | 若不可用，运行中改为直接拒绝派生 |
| S7 | 删除副本前不 close 会导致日志被重建 | **已通过（2026-11-04 真机）**：resume → prompt 一轮 → `session/close` → 日志 2 秒内零增长 → 再 prompt 返回 `Invalid params: unknown session`。`isUnknownAcpSession` 的正则与该文案匹配，重复 close 不会抛错 | 确认 `session/close` 为硬依赖（方案已按硬依赖设计） |
| S8 | 多会话项目里派生后立即全量同步，不会产生重复行、不会改错 `provider_session_id` | 已由 `dsh-message-editing.test.ts`（全量重扫不回滚、superseded 写入守卫）与 `btw.routes.test.ts`（fork 后同步行数/指针）覆盖 | 若失败，说明 §7.2.1 的守卫不完整，先修再放能力位 |

**验收口径**：S0 全绿才进真机；S1/S2/S5/S6/S7/S8 必须在真实 `dsh --profile acp` 上跑通，不能以“文件生成成功”代替。

**S1/S2 真机记录（2026-11-04）**

做法：把 seed 写到隔离的 `DSH_HOME`（`sessions/`、`storages/` 独立，`profiles/` 软链到真实安装，`.credentials.yaml` 等只读复制），起真实 `dsh --profile acp`，依次 `initialize` → `session/resume` → `session/prompt`。脚本：`scripts/spikes/dsh-acp-resume-probe.mjs`。

**排障前提：`session/resume` 的所有失败都只回 `Internal error`，真实原因在 `error.data.details`。** 不看 details 会得出错误结论。实测遇到的两条：

| 现象 | `details` | 根因 |
| --- | --- | --- |
| 空 `DSH_HOME` 下 resume 失败，但 `session/new` 正常 | `no adapter registered for provider "workbuddy"` | 恢复时要用 seed 前缀里最后一条 `request/header` 的模型路由组合 configOptions；profile 里没有对应 provider。生产用真实 `DSH_HOME`，不受影响 |
| 头与事件压进同一帧 | `corrupt Zstandard session log: header frame failed validation: first frame is not exactly one header line` | 帧 0 必须恰好只有头行（再次确认 S4） |

后一条也说明：**P1 的错误映射必须读 `data.details`**，否则给用户的提示只会是 `Internal error`。

**S3 回收真机记录（2026-11-04，P3）**

同一份 seed，`--question` 先跑一轮拿到 `end_turn`，再 `session/close`：

```
S1     PASS  (configOptions=1)
stop   end_turn
S3     PASS  (closed; transcript idle at 456259 bytes)
S3b    PASS  (prompt refused: Invalid params: unknown session: 535ca3b9-…)
```

三点结论：

1. `session/close` 后子进程真的不再持有该会话，2 秒静默期内日志字节数不变——btw 的「先 close 再删文件」顺序成立。
2. 关闭后的 prompt 被拒且文案含 `unknown session`，与 `isUnknownAcpSession` 的正则一致，所以 `disposeSession` 对已关闭会话（重复回收、或从未 resume 的副本）静默通过，不会让 btw 删除流程 409。
3. close 不需要先 cancel：实测在 `end_turn` 之后直接调用即可；取消路径由 `quiesceBtwSession` 在 close 之前单独处理。

另一个观察：`session/list` 对这些会话返回空数组（新建的、以及仅含初始化事件的会话都不列）。CloudCLI 自己扫目录，不依赖它，无影响。

**现成 fixture**（省去自己造数据）：

- 4 份真实的 `parentSession + isSeeded` 日志（如 `session-17e7fb40…`，end-seed 在 745/819）→ 验证 fork of fork。
- `d151591c…`：尾部 `step/start` 未闭合 → 验证 §4.3。
- 8 份带 `surfaceOp: replace` 的日志，其中 `d151591c…` 在 seq 968 覆盖了 10 条真实用户消息 → 验证锚点过滤。
- `session-log-deepseek` 插件默认关闭、本机 0 条 `delivery-accepted` → **必须手造**一条，否则永远测不到。

---

## 12. 实施顺序

| 期 | 交付 | 预估 |
| --- | --- | --- |
| P0 | **已交付**：`AcpClient.resumeSession`、runtime 以 DB 为准 + `liveAcpIds` / `resuming`（`session/close` 随 P3 落地） | 小 |
| spike | **S0 离线自检已交付**（`scripts/spikes/dsh-fork-seed-selfcheck.mjs`，123/123）；**S1/S2/S7 真机已通过**（`scripts/spikes/dsh-acp-resume-probe.mjs`）；S6 等价于 S1（任意 `turn/end` 边界均已在 S0 覆盖），S8 由单测覆盖；S5 由「产物目录从源继承 + resume 传 header 原值 cwd」在设计上消解，本机无 symlink 项目可复现 | 小 |
| P1 | **已交付**：`DshForkProvider`（严格解码 / 格式守卫 / 原子写 / 写后自检）、历史锚点（`turn/end` 对齐 + `surfaceOp` 过滤）、`disposeSession` 与 ACP `session/close`、`supportsSessionForking` | 中偏大 |
| P2 | **已交付**：`resolveEditAnchor` / `rewindSession`、DB 事务助手（`supersedeAndDetachSession`、repoint 内联 superseded 记录）、索引器与 `createSession` 两道守卫、`supportsMessageEditing` | 中 |
| P3 | **已交付**：btw 回收真机验证（`session/close` → 日志停写 → 再 prompt 报 `unknown session`）；`btw.routes.test.ts` 断言删除前先 `disposeSession` | 小 |
| P4 | （可选）回合内精确切分 | 中 |

P0 与 P1 之间必须插入 spike（S0 先行）；P1 与 P2 可以并行开发，但 P2 的验收依赖 P1。P1 必须包含 `disposeSession`，否则 `supportsSessionForking` 一开，侧问入口也会出现却关不干净。

---

## 13. 验收标准

**单元测试**

- 锚点解析：合法 seq、越界、非数字、指向工具/思考/注入消息（都必须拒绝）。
- 锚点过滤：落在 `surfaceOp: replace` 区间内的行不产出锚点；同一 turn 内多条 `assistant/message` 的 `forkAnchorId` 相同。
- 边界计算：首 turn → null；中间 turn → 上一个 `turn/end`；未闭合尾部 → 退一格 / 拒绝。
- 产物构造：header 字段集、`isSeeded`、end-seed 位置、seq 稠密、复制事件字节不变（`delivery-accepted` 除外）。
- **帧布局**：帧 0 只有头行；「头 + 事件同帧」必须被自检拒绝（负向用例）。
- **路径推导**：目标目录由源日志路径推出；`basename(srcProjectDir) !== projectKey(header.cwd)` 时拒绝；不重算路径。
- **文件名继承**：源为 `session.v4.jsonl.zstd` 与源为 `session.jsonl`（`compression:none`）各一条，产物后缀与世代一致。
- **`delivery-accepted`**：手造一条，断言 `data.sessionId` 被改写为新 id、`seq`/`throughSeq` 不变；字段形状未知时拒绝。
- fork of fork：前缀含旧 end-seed 仍通过自检。
- 版本守卫：`.v3` / `version:5` / 未知事件类型 → 拒绝且不落盘。
- 原子性：中途失败后目标目录不存在、临时目录被清理。
- **DB 守卫**：模拟旧日志目录重扫，断言 `provider_session_id` 不被改回；首条 detach 失败后行仍可打开。

**集成测试**

- 真实拉起 `dsh --profile acp` → `session/new` → prompt 一轮 → 派生 → `session/resume` → prompt → 断言新回复引用了派生点之前的上下文。
- **多会话项目中派生**：项目下先有 3 个会话，断言派生用的是**行当前指向的日志**，不是最新的那份；派生后立即 `synchronize()`，断言行数不变、`provider_session_id` 仍指向新日志（S8）。
- ACP 子进程重启后继续旧会话：断言自动 `resume` 且不报 `Unknown session`。
- 编辑：派生 + repoint 后 `session/resume` 的 id 是新 id；原日志仍在磁盘且被标 superseded；**旧 ACP 会话已 close**（旧日志在编辑后不再增长）。
- **编辑后跑一次全量 `synchronize()`，断言该行的 `provider_session_id` 仍是新 id、`jsonl_path` 仍指向新日志**（验证 §7.2.1 的两道防线真的生效）。
- 侧问：打开抽屉 → 关闭 → DB 行、日志、ACP 内存会话三者都消失；**同一个主会话再开一次侧问仍能正常 resume**（验证 `liveAcpIds` 在 close 后被清理）。

**手工验收**

- 编辑首条 / 中间 / 最后一条用户消息；编辑后继续追问两轮。
- 从用户消息派生、从助手消息派生、派生一个派生。
- 主会话运行中开侧问；关闭后主会话字节不变。
- 多标签页同时观察 `history_truncated` 行为。

---

## 14. 风险与上游建议

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 日志格式是 DSH 内部契约，且当前是 `0.2.0-rc.2` | 上游一升格式，功能先失效 | 运行时版本守卫；只写新目录；失败不落半成品 |
| 不写 `parentSession` | 派生产物会在 DSH 自己的列表 / Desktop 里显示为**一条普通可见会话**，且无标题、未登记 `workspace.json` | 接受；CloudCLI 的 `forked_from_session_id` 保留血缘。若用户反馈干扰，再评估写 `origin:'subagent'`（但会被 listSessions 过滤，需同时确认 resume） |
| 复制前缀依赖“事件自包含” | 若某类事件引用前缀外的事件（如 `sourceEventSeqs` 指向更早事件）会悬空 | 复制 0..boundary 是**从零开始的前缀**，所有引用必然落在前缀内；这一点由“seq 从 0 稠密”保证 |
| **帧布局**：帧 0 必须只有头行 | 头+事件同帧 → 直接读不出 | 固定帧布局；S4 负向用例守住 |
| **`delivery-accepted`** 只在插件开启时出现 | 默认关闭 → 现有日志测不到，上线后全量失败 | 构造器无条件改写 `sessionId`；单测手造该事件 |
| **目标路径 / 压缩方式**必须与 header 一致 | 重算路径或写错后缀 → `assertStoredIdentity` 拒绝 | 从源路径推出，断言目录名；后缀继承源文件 |
| btw 删除依赖 ACP close | 不 close 会重建日志并污染索引 | `disposeSession` 与 `supportsSessionForking` 同批交付（P1） |
| app session id 与 provider id 不再相等（repoint 后） | 依赖“两者相同”的旧代码可能出错 | 已有 Pi/Codex 先例；本次只走既有 `repoint` 方法 |
| **watcher 与 fork 竞争**（多会话项目） | 半成品目录 / 重复行 / 取错源日志 | `.tmp-` + rename；派生不读“最新日志”；S8 覆盖 |
| **`surfaceOp` 语义**未在解码层实现 | 用户可能看到已被压缩掉的历史 | 本期只过滤锚点；渲染层另立需求（§10） |

**建议并行推上游**（不阻塞本方案）：

1. 在 ACP 暴露 `session/fork`（参数 `{ sessionId, atSeq, childSessionId? }`），或
2. 放开 `session/resume` 对 `parentSession !== undefined` 的拒绝，让原生 fork 的产物可直接续跑。

任一落地后，本方案的 `DshForkProvider` 可以退化成一次 RPC 调用，格式耦合约 300 行可直接删除。

---

## 15. 待拍板项

| # | 问题 | 建议 |
| --- | --- | --- |
| D1 | 锚点档位：只做回合边界（A），还是一开始就做回合内精确切分（B）？ | **A**。B 需要复刻 `openTurnClosers`，收益低、回归风险高 |
| D2 | 源会话运行中发起“完整会话派生” | **拒绝**，不静默退一格 |
| D3 | 派生产物是否写 `parentSession` | **不写**。写了就无法 ACP resume |
| D4 | 能力位是否按 dsh 版本动态探测 | **不探测**，改为运行时格式守卫 |
| D5 | 是否先做 spike 再动工 | **已按此执行**：S0 离线自检全绿，S1/S2 真机通过；余下 S5/S6/S7/S8 可与 P1 并行验证 |
| D6 | `surfaceOp: replace` 覆盖的历史是否还能编辑/派生 | **不能**。锚点过滤，落在替换区间内的行不提供入口；渲染层保持现状 |
| D7 | 派生产物在 DSH Desktop 里多出一条无标题会话 | **接受**，登记为已知损失；不写 `origin:'subagent'`（会被 `listSessions` 过滤） |

---

## 16. 审阅批注

### OpenCode

> [!NOTE] 总体结论：方案主线成立，§2.2 的关键事实我逐条对过 `dsh-acp/lib/index.js`，全部准确：`session/resume` 拒绝 `parentSession !== undefined` 与 `origin === 'subagent'`（1298-1302）、`listSessions` 也过滤同样两个字段（1355）、`closeSession` 用的是 `requireSession`（退出码 1408-1415），即对未激活的会话 close 会抛错。P0 的“先 resume 让 ACP 拿到句柄、销毁前再 close”方向正确，可以开工。

> [!CAUTION] §5.2 第 1 步的定位顺序有隐患：`DshSessionsProvider.fetchHistory` 是**优先用 `provider_session_id` 拼路径**、拼不到才退 `findNewestSessionLog`（`dsh-sessions.provider.ts:342-348`），而 §5.2 却写成“优先 `session.jsonl_path`”。DSH 在 fork 之前 `jsonl_path` 可能为空，两者可接受的回退不同。派生入口拿到的是调用方的 `jsonlPath`（`sessions.service.ts:611`），此时从**行上的 provider id** 才能定位到“当前活跃”的那份日志；若派生内部改用 `findNewestSessionLog`，在多会话项目里会取错（该函数单会话才返回，多会话直接 null），退化成 `FORK_SOURCE_NOT_READY`。建议把回退链与 history 读取对齐，并在 §13 加一条“派生用的就是行当前指向的日志”的断言。

> [!CAUTION] §5.1 的产物只写“一个 session 目录 + `session.v4.jsonl.zstd`”，漏了 DSH 侧的**会话标题/工作区归属元数据**。本文件里 `registerSessionWithDesktopWorkspace`（`dsh-runtime.provider.ts:277-300`）说明 DSH Desktop 由 `~/.dsh/storages/workspace.json` 决定分组；但 DSH 自己的 `sessions.fork` 是否写 `storages/sessions.json` 之类的标题表，方案没交代。若派生产物在 DSH 侧无标题，CloudCLI 索引器会用 `extractSessionName` 兜底，这没问题；但**若用户在 DSH Desktop 里直接看派生会话**，可能出现无标题/未分组。请确认这是否在“可接受损失”清单里，否则应在 §10 显式列出，避免后续被当 bug。

> [!WARNING] §7.2.1 的 superseded 早退方向对，但插入位置建议再核对。`upsertSessionLog` 当前在 `fsp.access` 之后、`createSession` 之前查 `isArchived`（`dsh-session-synchronizer.provider.ts:128-145`）。若早退放在 `fsp.access`，对**已被 superseded 但目录仍存在**的旧日志能挡住；但对“旧目录已不存在”的情况反正也走不到 insert。真正要防护的场景是 `createSession` 的 ON CONFLICT 回写，因此除了 superseded 早退，还应确认 `createSession` 回写到 `provider_session_id` 时不会越过 `isRetiredProviderSession`——`sessions.db.ts:258-260` 的 retired 检查只在 `existing` 为空时才生效，而 superseded 的旧日志目录重扫会命中 `existing`（旧 session_id 主键）走到 258 之前的 UPDATE 分支。建议在审查时补一条：**直接改 `createSession` 让 UPDATE 分支也检查 superseded**，或在早退里同时比 `session_id`，二选一，不要只靠 provider_session_id 一条路。

> [!WARNING] §6.2 的 `resumedIds: Set<string>` 生命周期与 `AcpServerState` 绑定是对的，但方案没写明 **close 后是否要从 `resumedIds` 移出**。btw 打开→关闭→再打开同一主会话时，如果 close 后没移出，第二次会认为“本进程已 resume 过”直接 `prompt`，而 ACP 进程里其实已经 `sessions.delete(sessionId)`，报 `Unknown session`。建议在 `resumedIds` 的描述里补“close/进程重启/主动 abort 后需清理”。

> [!TIP] §4.2 的“派生（从用户消息）对齐到 `T.end`”与 btw 的 `advanceToTurnEnd`（`btw.service.ts:471-483`）一致，但 DSH 的 `assistant/message` 是**每 step 一条**（§2.3 事实 4），一个 turn 内可能有多条 assistant 行并各带 `forkAnchorId`。`advanceToTurnEnd` 会取“下一个 user 行之前最后一条可切行”，落在多条 assistant 的最后一条；而 §4.2 表格的“从助手消息 → `T.end`”对所有 assistant 行都给同一个 seq，这在 btw 里等价，但 **`forkSession` 返回的 `anchorForkId` 会重复**。前端不依赖这个返回值做去重，但集成测试若断言“两个 assistant 行派生出不同 anchor”会失败。建议在测试里明确“同一 turn 内所有 assistant 行共享同一 forkAnchorId”。

> [!TIP] §10 漏了一种失败模式：**对已 superseded 的 session 再次编辑**。§10 写“编辑后立刻再编辑每次都基于当前 provider_session_id 的新日志，天然幂等”，但若用户编辑后刷新、从历史里点旧消息编辑（`resolveEditAnchor` 读的仍是行当前 `provider_session_id`，正确），这条没问题；真正漏的是 **`rewindSession` 失败但 `markProviderSessionSuperseded` 已执行**——§7.2 的伪代码是“先 fork 再 mark”，顺序正确；但 §7.3 detach 分支是“mark 后再 detach”，若 detach 抛错，行已被标 superseded 而 provider id 未清空，下次扫描会被早退挡住、导致会话“打不开”。建议 detach 分支也改成“先 detach 成功再 mark”，或加事务。

> [!IMPORTANT] §2.1 表格里“`resolveEditAnchor` / `rewindSession` 在 DSH 无”这一条，和 §7.1 的 `resolveEditAnchor` 返回 `{found:false}` 的约定要对齐：`chat-websocket.service.ts:341-352` 区分的是 `anchor === null`（provider 不支持）与 `anchor.found === false`（锚点找不到），DSH 的 `resolveEditAnchor` 若返回 null 会触发 `EDIT_NOT_SUPPORTED`，返回 `{found:false}` 才触发 `ANCHOR_NOT_FOUND`。§7.1 的注释写对了，但建议在 §9 的能力位表里注明：**`supportsMessageEditing` 打开后，`resolveEditAnchor` 必须存在且返回对象**，否则编辑入口出现但每次报 `EDIT_NOT_SUPPORTED`。

> [!TIP] §14 的风险表建议补一条：**派生 / 编辑后的日志 watcher 竞争**。§5.3 用 `.tmp-<uuid>` + rename 保证原子，但 DSH 自己的 `session/new` 与 `sessions.fork` 也写在同一个 `~/.dsh/sessions/<projectKey>/` 下，`synchronize()` 全量扫描（`dsh-session-synchronizer.provider.ts:46-64`）可能在 rename 后、DB insert 前抓到新目录，调用 `createSession`。这与 WorkBuddy 同风险（§10 最后一行已提），但 DSH 的 `findNewestSessionLog` 单会话假设会在多会话项目里把“新目录”误认成主会话（见上条 CAUTION）。建议 spike S6 之外加一条 S8：**在已有多个会话的项目里派生并立即全量同步，断言不产生重复行、不改错 `provider_session_id`**。

### WorkBuddy · `01a1a5b4-69ba-7702-aea4-1801d9be2b2c`

> [!NOTE] 总体结论：§2.2 的 DSH 侧事实我逐条对过安装包（`@deepseek-ai/dsh@0.2.0-rc.2`，含 `dsh-acp` / `dsh-session` / `dsh-session-format-v3-to-v4` / `dsh-session-persistence-jsonl`），全部准确：resume 拒绝条件（`dsh-acp/lib/index.js:1290-1305`）、`closeSession` 用 `requireSession`（同文件 1184-1189、1382）、`buildForkSeed` 的切分形状（`dsh-session/lib/index.js:926-935`）、v4 头白名单与 `seedLength` 不存在、`restoreReleasedV4Artifact` 的 `cut` / 稠密 / 最后一个 marker 三条规则，均与正文一致。§2.1 的 CloudCLI 事实也成立。下文按 §2/§4/§5/§6/§8/§10 分条给问题。

> [!CAUTION] §5.3 的「单帧 zstd 应兼容，列入 spike S4」是**确定的错误**，S4 现在就可以判死
> 读取侧不是「解压拼接后按行解析」：`readZstdPrefix` 取第一帧后立刻 `assertZstdHeaderFrame(headerFrame.value)`，该函数要求明文**恰好只有一行**（`dsh-session-persistence-jsonl/lib/index.js:2937-2951`、`2293-2295`，报错文案 `first frame is not exactly one header line`）。我用真实的 `JsonlSessionPersistence`（`compression:'zstd'`，临时 root）实测：
> - 头 + 事件压成**一帧** → `corrupt Zstandard session log: header frame failed validation: Error: … first frame is not exactly one header line`；
> - 头单独一帧、其余事件合为第二帧 → `stat` / `open` 均 OK，`header.isSeeded=true`、`inheritedEventCount` 正确。
>
> 本机 23 份真实日志的第 0 帧全部是「1 行」。所以 §5.3 不是「可能不兼容」，而是**必然失败**，其失败退路（按事件逐帧）也不是必需的——正确做法是**至少把头单独成一帧**，事件部分可以合帧。建议把 §5.3 直接改成「帧布局：帧 0 = 头行；帧 1..N = 事件（可按批次合并）」，把 S4 从「验证假设」降级为「回归断言（头帧必须单独一帧）」。

> [!CAUTION] §5.1 「`delivery-accepted` 对 `seq < cut` 的前缀有豁免，不要求等于新 id」是**反的**
> 豁免条件是 `!(header.parentSession !== undefined && event.seq < cut) && deliveryId !== header.id`（`dsh-session-format-v3-to-v4/lib/index.js:1034`），即**必须先写 `parentSession` 才豁免**——而本方案的决定恰恰是不写。我做了注入实验（往真实前缀里塞一条 `session-log-deepseek/delivery-accepted`，`sessionFormatVersion:4`，`throughSeq` 小于自身 seq）：
> - 旧 `sessionId` + **不写** `parentSession` → `current-generation delivery marker names the wrong Session`（拒绝）；
> - 旧 `sessionId` + **写** `parentSession` → 通过（但不能写，resume 会拒）；
> - 把 `data.sessionId` 改写成新 id + 不写 `parentSession` → 通过。
>
> 这条很阴：该事件只在 `session-log-deepseek` 插件开启时产生，其配置项 `enabled` 默认 `false` 且标了 `volatile()`（`dsh-session-log-deepseek/lib/index.js:17-20`），本机 23 份日志里 0 条命中，**用现有日志做 spike 永远不会暴露它**，一旦用户开了这个插件，派生/编辑会全量失败。建议 §5.1 明确：复制前缀时若遇到 `delivery-accepted`，把 `data.sessionId` 重写为新 id（`seq`/`throughSeq` 不动，稠密与「throughSeq 必须早于自身」都仍满足，已实测通过）；或直接 `FORK_UNSUPPORTED_FORMAT` 拒绝。§13 单元测试要造一条带该事件的用例。

> [!IMPORTANT] §5.1/§5.2 没写「目标目录由源日志所在目录推出」，用 `projectKey(cwd)` 重算会在多种真实场景下被拒
> `assertStoredIdentity` 校验 `path === generationLogPath(root, header.cwd, header.id, version, compression)`（`dsh-session-persistence-jsonl/lib/index.js:3384-3397`），不一致时抛 `corrupt session log …: header id "…" and cwd identify "…"`。我实测把 seed 写到与 `header.cwd` 不匹配的项目目录下，`stat` 直接拒。触发条件很常见：`project_path` 与日志里 `cwd` 的写法差异（`/var` vs `/private/var`、结尾斜杠、符号链接、Windows 盘符大小写）、`DSH_SESSIONS_ROOT` 覆盖、以及 `cwd` 被上游改过。建议 §5.2 改成：**目标项目目录 = `path.dirname(path.dirname(srcLogPath))`**（即复制源目录结构），并把 `projectKey(header.cwd) === <该目录名>` 作为前置断言，不一致就 `FORK_UNSUPPORTED_FORMAT`，不要自己重算。

> [!WARNING] 压缩后缀与格式世代被硬编码，`compression:'none'` 的根会被直接拒
> §5.1/§5.3 固定写 `session.v4.jsonl.zstd`。实测在 `compression:'none'` 的 backend 上，`.jsonl.zstd` 文件会报 `uses .jsonl.zstd, but this backend is configured for compression "none"`（另有 `ensureRootEncoding` 全根扫描同样的失败）。CloudCLI 侧的读取已经同时支持两种后缀（`dsh-sessions.provider.ts:39-43,115-140`），派生却只认一种。建议：后缀与世代**从源日志文件名继承**（`session(?:\.v(\d+))?\.jsonl(?:\.zstd)?`），源是 `.jsonl` 就写 `.jsonl`，并把「同一 root 内不混用编码」写进验收。

> [!WARNING] §5.2 的回退 `findNewestSessionLog` 在派生路径上是不安全且不必要的
> 该函数只在项目目录下**恰好一个**会话目录时才返回，否则 `null`（`dsh-sessions.provider.ts:166-190`）。派生入口的 `source.provider_session_id` 已被 `sessions.service.ts:598-603` 保证非空，`resolveSessionLogPath(<providerId>, cwd)` 是确定性的；保留「最新日志」这条回退只会在多会话项目里把**别的主会话**当源（派生出错误内容，且不报错）。建议 §5.2 第 1 步删掉这条回退，或改成「仅当 `provider_session_id` 为空时用于 history 读取，派生一律硬失败」。§10 对应行同步改。

> [!WARNING] §5.2/§5.4 的「坏行拒绝」不足以保住 `seq` 稠密，而 CloudCLI 的解码器会**静默跳过坏帧**
> `decodeZstdFrames` 用魔数切帧、`catch {}` 吞掉解压失败（`dsh-sessions.provider.ts:115-127`）。所以：
> - 一个损坏的中间帧会被**跳过**，剩余帧拼起来仍是合法 JSON 行，只是 `seq` 出现空洞；
> - §5.2 只要求「坏行 → 拒绝」，而空洞不会产生坏行。
>
> 建议：解码后强制断言 `event.seq === index`（0..boundary），并断言最后一条是 `turn/end` 且 `data.turn` 与锚点一致。另外这个「魔数切帧」本身是启发式（DSH 自己用 `scanZstdFrames`），若要严谨可改用 DSH 的 `scanZstdFrames` 或先验证 `zstdDecompress` 能整段解出（本机 23 份日志全帧可解，实测 `badFrames=0`）。

> [!IMPORTANT] §6.2 的 `resumedIds` 覆盖面不够：`session/new` 建出来的会话也算「已活跃」，且 `trimSessionMappings` 会先把缓存踢掉
> resume 的拒绝条件是 `sessions.has(id) || activating.has(id) || ctx.sessions.get(id) !== undefined`（`dsh-acp/lib/index.js:1293-1296`），**同一进程里 `session/new` 建的会话同样在内**。而 `trimSessionMappings` 在超过 256 条时直接删最旧映射（`dsh-runtime.provider.ts:33-41`），被删的会话在 ACP 子进程里仍然活跃。于是两种情形都会踩到 `session is already active`：
> - 「本进程新建过的会话」被 `resumedIds` 判为「没 resume 过」→ 去 resume → 被拒；
> - 映射被裁剪后按 DB 重建 → 判断为「没 resume 过」→ 去 resume → 被拒。
>
> 建议：维护的是「**本进程内 ACP 侧仍存活的 id**」（created ∪ resumed），裁剪映射时若该 id 仍存活则**不删**（或先 `session/close` 再删），并把 `already active` 当作「无需 resume」而不是错误处理。§6.2 的表格应补这两行。

> [!WARNING] §7.2 的 rewind 不关闭旧 ACP 会话，和 §8 对 btw 的硬依赖自相矛盾
> §8 正确指出「不 close 会重建日志、污染索引」，但 §7.2 的 `rewindSession` 只 `markProviderSessionSuperseded` + `repoint`，旧 provider session 仍留在 ACP 子进程的 `sessions` map 里，带着写句柄和 `Session` 对象。后果：(a) 被 superseded 的旧日志仍可能被追加写入，「旧日志只读」的前提不成立；(b) 用户在旧标签页继续说话会写进被 superseded 的日志（`repoint` 后 DB 已不指向它，watcher 又被早退挡住，内容彻底失联）；(c) 同一项目反复编辑会持续占用子进程内存。建议 §7.2 的 rewind 分支也做一次 best-effort `session/close`（必须 try/catch：`closeSession` 走 `requireSession`，对「fork 出来但还没被 activate」的 id 会抛 `unknown session: <id>`，这条 §8 也要写清楚）。

> [!IMPORTANT] P3 的「不需要新代码路径」不成立：`IProviderRuntime` 没有任何 close/dispose 能力
> `server/shared/interfaces.ts:33-55` 只有 `run/abort/permissions/listBackgroundWork/stopBackgroundTask`。btw 的销毁顺序是 `quiesceBtwSession` → `retireProviderSession` → 删行删文件（`btw.service.ts:257-300`、`387+`），目前**没有任何钩子能把 ACP 会话关掉**。§8 说「两处必须补齐 / 不需要新代码路径」只能对 fork 那半句成立。建议：把「新增可选 runtime 方法（如 `disposeSession(sessionId)`），在 `quiesceBtwSession` 内调用，失败不阻断删除」写进 §8 与 §12 的 P3 工作量（现在标「小」，实际要动共享接口 + btw 服务 + 一个测试）。

> [!WARNING] §4.1「一个事件 = 一条可见消息」在带 `surfaceOp: replace` 的日志里不成立，锚点会指向已被替换掉的行
> 本机 23 份日志里有 8 条 `surfaceOp:{op:'replace', startSeq, endSeq}`，其中 3 条覆盖了**真实人类 user/message**：例如 `d151591c…` 在 seq 968 用 `source.kind='compact-checkpoint'` 替换了 8..695（覆盖 10 条真实用户消息），`session-cbf70f33…` 在 seq 833 用空 content 的 `rewind-…` 行替换了 826-827。后果：
> - `decodeSessionLog` 完全忽略 `surfaceOp`，会把**已被压缩替换掉的**历史消息照常渲染出来，用户可以对它发起编辑/派生；
> - `resolveEditAnchor` 用原始日志扫 `turn/end` 算边界，与 DSH 自己「表面」的对话不一致（DSH 内部 `SurfaceManager` 会 `surface replace: start seq … not found in surface` 这类校验，`dsh-session/lib/index.js:358-368`）。
>
> 好消息：**复制前缀仍然合法**（我按 112 个 `turn/end` 边界全量构造 seed，`restoreReleasedV4Artifact` 0 失败；113 份 seed 用真实 `JsonlSessionPersistence.open` 全部通过，含 compaction 日志）。问题只在锚点语义。建议 §4.1 增加一条：解码时回放 `surfaceOp`，落在 replace 区间内的行不给锚点（或只把 replace 后的新行视为可切点）；§13 加一个用 compaction 日志构造的 fixture。附带提醒：`decodeSessionLog` 忽略 `surfaceOp` 是既有行为，本期不必修，但要在 §10 登记，否则会被当成派生引入的新 bug。

> [!TIP] 本机已跑通离线自检：S1/S3 可以提前判为通过，建议把它固化成 spike 的第一道门
> 我用 `restoreReleasedV4Artifact` + 真实 `JsonlSessionPersistence` 做了离线验证（不写 `~/.dsh`，全部落在临时 root）：
> - 头（**不写** `parentSession`）+ `0..lastTurnEnd` 前缀 + `end-seed{inherited:true}` → 通过；负向控制如方案所述：`isSeeded:false` + marker → `unseeded format v4 Session has inherited events`；带 `seedLength` → `unexpected field seedLength`；带 `parentSession` → 格式通过但 resume 会拒。
> - **fork of fork** 通过（旧 marker 保留在 745 那类位置，新 marker 在末尾）。顺带发现本机真实存在 4 份 `parentSession + isSeeded` 日志（如 `session-17e7fb40…`，end-seed 在 745/819），可作为现成 fixture。
> - 112 个 `turn/end` 边界 × 23 份日志，`restore` 全通过；113 份 seed 用 `JsonlSessionPersistence.open` 全通过（真实读取层，不只是格式校验）。
>
> 建议 §11 把这块提前：**先写这个离线校验脚本**（几十行），S1/S3 就变成纯离线的确定性断言，真机只需要验 S2（上下文继承）、S5（symlink cwd）、S7（close 后不重建）。S4 直接按上面第一条改写，不用再"验证"。

> [!TIP] 以下几点小项，建议顺手在正文登记
> - **`parentSession` 缺失的副作用比 §5.1 写的更大**：`listSessions` 只过滤 `origin==='subagent'` 与 `parentSession!==undefined`（`dsh-acp/lib/index.js:1355`），所以派生产物会作为**一条普通可见会话**出现在 DSH 自己的 session 列表 / DSH Desktop 里（按 cwd 分组）。§5.1 只说"看不到血缘"，没说"会多一条可见会话"，§10 的可接受损失清单应补这条。
> - **`registerSessionWithDesktopWorkspace` 只在 `session/new` 分支调用**（`dsh-runtime.provider.ts:571-576`）。派生行走的是 `createForkedSession`（只写 DB），不会登记到 `~/.dsh/storages/workspace.json`，DSH Desktop 里可能未分组。请确认这是否也要复用该函数。
> - **§4.3 / §15 D2 需要一个"尾部未闭合"的判定口径**：本机就有这种日志（`d151591c…` 结尾 seq1690 是 `step/start`，整份日志最后一个 `turn/end` 在 1642 之后没有），正好当「运行中拒绝完整派生」的 fixture。另外我按 §4.2 的定义扫了全部日志：**没有任何一个 `turn/end` 处存在 pending inbox 消息**（`next-turn`/`next-step` 全为空），说明「切在 turn/end」确实不会切出"没人回答的问题"，这条可以当作已证事实写进 §4.2。
> - **行号小漂移**：`AcpClient` 的方法在 `acp.client.ts:336/357/367/390/400/402`（正文写 337/367/393/402）；`dsh.provider.ts` 全文 31 行，§2.1 引 19-26 没问题。`provider-capabilities.service.ts:172-173` 准确。
> - **§9 的能力位说明建议加一句**：`supportsSessionForking` 打开后 `onAskAsideFromMessage` 与 `onForkFromMessage` **同时**出现（`ChatInterface.tsx:1066-1067` 共用同一个开关），DSH 只做了 fork 也就等于把 btw 一起打开了；§12 的 P1/P3 顺序要保证 btw 需要的 close 能力在同一批交付里，否则中间那一刻侧问是可点但关不干净的。

---

## 17. 审阅意见处理结果（v2）

### 17.1 逐条处置

| 来源 | 意见 | 处置 | 落点 |
| --- | --- | --- | --- |
| OpenCode | §5.2 定位顺序与 `fetchHistory` 不一致，`findNewestSessionLog` 会取错 | **采纳**。派生只用行上的 `provider_session_id`，删除该回退 | §5.2 步骤 1、§10 |
| OpenCode | §5.1 漏了 DSH 侧标题 / workspace 元数据 | **采纳（登记为已知损失）**。`workspace.json` 不登记，Desktop 可能未分组 | §10、§14、§15 D7 |
| OpenCode | superseded 早退不够，`createSession` 的 UPDATE 分支才是覆盖点 | **采纳**。增加写入点守卫，二选一（推荐改 `createSession`） | §7.2.1、§13 |
| OpenCode | close 后未从 `resumedIds` 移出 | **采纳**。改为 `liveAcpIds`（created ∪ resumed），明确清理时机 | §6.2 |
| OpenCode | 同一 turn 的多条助手行共享同一 `forkAnchorId` | **采纳**。写进锚点定义与测试约束 | §4.1、§13 |
| OpenCode | `mark` 后 `detach` 失败会让会话打不开 | **采纳**。改为单事务 `supersedeAndDetachSession` | §7.2、§7.3 |
| OpenCode | `supportsMessageEditing` 打开后 `resolveEditAnchor` 不能返回 null | **采纳**。能力位说明补充 | §9 |
| OpenCode | watcher 竞争，建议加 S8 | **采纳**。新增 S8 与风险行 | §11、§14 |
| WorkBuddy | 单帧 zstd 必失败，帧 0 必须只有头行 | **采纳**。帧布局固定，S4 降级为回归断言 | §5.1、§5.3、§11 |
| WorkBuddy | `delivery-accepted` 豁免理解反了，不写 `parentSession` 必须改写 `sessionId` | **采纳**。构造器无条件改写，形状未知则拒绝；单测手造该事件 | §5.1、§5.4、§13 |
| WorkBuddy | 目标目录不能用 `projectKey(cwd)` 重算 | **采纳**。从源路径推出 + 目录名断言 | §5.1、§5.2 |
| WorkBuddy | 压缩后缀 / 世代被硬编码 | **采纳**。继承源文件名，支持 `.jsonl`（none） | §5.1、§5.4、§13 |
| WorkBuddy | `findNewestSessionLog` 在派生路径不安全 | **采纳**。同上，删除 | §5.2、§10 |
| WorkBuddy | 坏行拒绝不足以保证 `seq` 稠密，解码器会静默跳帧 | **采纳**。增加 `seq === index` 全量断言 | §5.2、§13 |
| WorkBuddy | `resumedIds` 覆盖不足（created / 裁剪） | **采纳**。`liveAcpIds` + 裁剪保护 + `already active` 视为无需 resume | §6.2 |
| WorkBuddy | rewind 不 close 旧会话，与 §8 矛盾 | **采纳**。rewind 分支 best-effort close | §7.2 |
| WorkBuddy | P3“不需要新代码路径”不成立 | **采纳**。新增 `IProviderRuntime.disposeSession?`，P3 联调、P1 交付 | §8、§12 |
| WorkBuddy | `surfaceOp: replace` 会让锚点指向已被替换的行 | **部分采纳**。锚点过滤本期做；渲染层忽略 `surfaceOp` 是既有行为，登记不修 | §4.1、§10、§15 D6 |
| WorkBuddy | S1/S3 已离线通过，建议做成第一道门 | **采纳**。新增 S0，S1/S3 转为回归 | §11、§12 |
| WorkBuddy | 派生产物会作为普通会话出现在 DSH 列表 / Desktop | **采纳（登记）**。并入 §10 可接受损失 | §10、§14 |
| WorkBuddy | `registerSessionWithDesktopWorkspace` 只走 `session/new` | **采纳（登记）**。派生不登记，接受未分组 | §10 |
| WorkBuddy | 尾部未闭合需要判定口径 + 现成 fixture | **采纳**。`lastEvent.type !== 'turn/end'`，fixture 写进 §11 | §4.3、§11 |
| WorkBuddy | 行号漂移 | **采纳**。已核对修正 | §2.1 |
| WorkBuddy | `supportsSessionForking` 同时放出侧问入口，P1/P3 顺序有风险 | **采纳**。close/dispose 提前到 P1 | §8、§9、§12 |

**未采纳：无。** 唯一被降级的是 `surfaceOp` 的渲染层修正——它属于既有解码缺陷，不应混进本期派生方案，已在 §10 显式登记，避免后续被误判为派生引入。

### 17.2 对结论的影响

- **主线不变**：仍是“CloudCLI 侧物化日志前缀 + ACP resume”，不动 DSH 插件、不走 HTTP RPC。
- **三处设计实质变更**：帧 0 单独成帧；前缀复制需改写 `delivery-accepted`；目标路径 / 后缀从源日志继承（不重算）。
- **范围变更**：P3 从“零代码”变成“新增 runtime 销毁钩子”，且必须随 P1 交付；P2 从“小”上调为“中”（DB 事务助手 + 写入点守卫）。
- **验证前移**：S1/S3 已离线通过；真机 spike 收敛为 S2/S5/S6/S7/S8，其中 S0 是硬门。
- **风险面收敛**：`delivery-accepted`、`compression:none`、`surfaceOp`、多会话项目取错源这四个“默认测不到”的坑，都已有显式规则或测试用例。
