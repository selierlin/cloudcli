# WorkBuddy、OpenCode、Pi 对话编辑与 Fork 实施方案

> **状态**：待审阅；本文只定义实施方案，不包含业务代码改动。
>
> **日期**：2026-09-14
>
> **审阅目标**：请重点检查 Provider 原生能力假设、消息锚点的边界、分叉后 CloudCLI 会话与 provider session 的关联，以及升级兼容风险。批注请追加在本文末尾的“审阅批注”区，不修改正文。

## 1. 目标与范围

CloudCLI 已有三种不同但相关的用户能力：

1. **编辑历史用户消息**：保留该消息之前的上下文，丢弃其后活跃分支，并发送替换后的用户消息。
2. **聊天内 Fork**：从某条普通文本消息为止复制上下文，创建并打开一个独立会话；原会话不变。
3. **侧边栏“…” Fork**：复制当前会话的完整活跃上下文，创建并打开独立会话。

本方案的范围如下：

| Provider | 本次要补齐的能力 | 不在本次范围内 |
| --- | --- | --- |
| WorkBuddy / CodeBuddy | 编辑历史用户消息 | 已上线的聊天内 Fork、侧边栏 Fork 不重做 |
| OpenCode | 仅保留后续接入说明 | 本期不实现 Fork、编辑、本地 API client 或共享契约改造 |
| Pi | 第一阶段仅侧边栏完整会话 Fork | 指定消息 Fork、编辑历史消息，待原生 RPC/SDK 验证后另立方案 |

### 1.1 关键决策

- 不以“把历史消息拼进新 prompt”冒充 Fork。子会话必须由 provider 原生会话机制或其正式、可验证的持久化格式生成，并可被 provider 正常续跑。
- “编辑”统一遵循现有 Claude/Codex 语义：**编辑的用户消息和其后内容不再是当前活跃会话的一部分**；不物理删除原始 artifact。
- Fork 仅对已结束、已落盘、可恢复的会话开放；正在处理的会话继续隐藏入口。
- 聊天内操作仅对有稳定 provider 锚点的普通文本消息展示；不向思考、工具调用、工具结果或仅附件行展示。
- **编辑首期只支持纯文本用户消息**。文字与图片/文件混合的消息也不显示编辑入口，避免编辑后静默丢失附件；附件保留编辑另立体验方案。

## 2. 共同契约与复用点

现有共享契约足以完成本期 WorkBuddy 编辑和 Pi 完整会话 Fork：

- `IProviderFork.forkSession({ providerSessionId, jsonlPath, projectPath, upToAnchorId })`：侧边栏与聊天 Fork 共用。
- `IProviderSessions.resolveEditAnchor()`：把“被编辑消息”映射为最后保留的 provider 锚点。
- `IProviderSessions.rewindSession()`：当 provider 不支持原地续跑时，创建前缀副本并把**原 CloudCLI session row**重定向到副本。
- 后端能力矩阵的 `supportsMessageEditing` 与 `supportsSessionForking` 是前端唯一的显示开关；不在 React 中判断 provider id。

OpenCode 若未来接入，因其没有会话级 JSONL artifact，届时再设计 provider-owned fork source 校验与可空 artifact 契约；本期不为尚未接入的 provider 修改共享接口或数据库签名。

需要保持的现有链路：

```text
普通消息锚点
  ├─ 聊天内 Fork ──> POST fork-session(upToAnchorId) ──> 新 CloudCLI session
  └─ 编辑 ──> resolveEditAnchor(前一保留点)
                 └─ rewindSession（若 provider 只能 append）
                      └─ 原 CloudCLI session 改指向新 provider session，再发送替换消息
```

实现时应优先扩展现有 `sessionsService`、`chat.edit-send` 和 `/fork` 路由，而不是新建 provider 专用 API。

## 3. WorkBuddy：补齐历史用户消息编辑

### 3.1 已具备基础

`WorkbuddyForkProvider` 已能：读取 JSONL、按 `row.id === upToAnchorId` 截断、改写新 session id、写出可由 `codebuddy --resume` 继续的副本。其注释已记录该行为在 CodeBuddy 2.137.1 上验证过。

因此 WorkBuddy 缺少的不是“复制前缀”，而是把这条复制能力接入编辑语义：找到编辑消息前的保留点，并把当前 app session 改指向复制品。

### 3.2 实现设计

1. 在 `workbuddy-sessions.provider.ts` 实现 `resolveEditAnchor(sessionId, anchorId)`：
   - 读取当前 JSONL 的原始 event 行，寻找该用户消息的 `event.id`；
   - 从该消息之前向前扫描，返回最后一个**完整轮结尾**的 event id，而不是机械取文件前一行或可见消息数组前一项；
   - 第一条用户消息返回 `{ found: true, resumeThroughId: null }`；锚点不存在返回 `found: false`。
2. 在同一 sessions provider 实现 `rewindSession(sessionId, keepThroughId)`：
   - `keepThroughId === null` 时，直接在 provider 内调用 `sessionsDb.markProviderSessionSuperseded()` 和 `sessionsDb.detachProviderSession()`；这是实现 `rewindSession` 后网关实际会走到的首消息编辑路径，不能反向调用 `sessionsService.detachSessionForScratchEdit()`。
   - 否则调用一个仅供 WorkBuddy provider 内部使用的前缀复制 helper，生成新 transcript 和新 provider session id。
   - 调用现有 `sessionsDb.markProviderSessionSuperseded()` 与 `repointSessionToProviderSession()`，使原 CloudCLI 会话 id 不变、后续 `--resume` 指向新副本。
3. 把 WorkBuddy 能力矩阵的 `supportsMessageEditing` 改为 `true`。
4. 历史归一化继续给用户文本设置 `transcriptAnchorId`；不向非文本 event 设置它。

### 3.3 边界与风险控制

- 前缀复制天然不会断开 `parentId` 链；真正的风险是将未完成的 `tool_use` / function call 作为恢复点。新增私有的完整轮判定 helper：跳过 `event.type !== 'message'` 的结构行；仅在当前累计 tool call 都有按 call id 对应的 tool result、且本轮结束时返回边界。
- 若编辑目标不是首条用户消息、却找不到任何可证明完整的前序轮，`resolveEditAnchor()` 抛出 `EDIT_UNSAFE_BOUNDARY`，拒绝编辑且保持原会话不变；不静默回退到更早上下文，更不改为从空会话开始。
- 与现有 Fork 一样，先写入临时文件、验证文件存在和可解析，再重定向数据库记录；失败时绝不能提前改变原会话。
- 不复用 `IProviderFork` 作为跨 provider service 的反向依赖；将 JSONL 前缀复制的私有 helper 下沉到 WorkBuddy provider 文件，避免 provider sessions facet 依赖 registry/service。

### 3.4 测试与验收

- `resolveEditAnchor`：首条、中间、末条用户消息、未知 id、非 `message` 结构行；中断在 `tool_use` 的轮、以 tool result 结尾的轮、以及同一 assistant event 含多个 `output_text` block。
- `rewindSession`：副本只保留目标前缀；新文件中每行 sessionId 已改写；原 session row 被重定向；原 transcript 被记录为 superseded。
- WebSocket：编辑中间用户消息后，原 session 的 `jsonl_path` 已指向新文件、新文件行的 session id 均为新 id、旧文件已标记 superseded；刷新页面后不再展示被舍弃的尾部。
- 回归：WorkBuddy 聊天内 Fork 和侧边栏 Fork 仍创建独立 app session，不影响原会话。

## 4. OpenCode：后续接入预留（本期不实现）

OpenCode SDK 已公开“从特定消息 Fork”的 Session API，但 CloudCLI 当前只运行 `opencode run --session` 并直接读取 `opencode.db`。本期不新增 API client、不启动本地 server、不修改 `IProviderFork`、数据库签名或能力矩阵。

未来开始接入前，按以下顺序补充：

1. 固定并记录 OpenCode 版本和安装来源；验证本地 server 的启动、endpoint 发现、认证、并发和关闭策略。
2. 在临时 workspace 验证指定 user/assistant message Fork、完整 Fork、子会话续跑、原会话不变，以及 Fork 是否包含选中 message。
3. 通过后，在 `server/modules/providers/list/opencode/` 新建 `OpenCodeSessionClient` 与 `opencode-fork.provider.ts`；前者只管理本地 API 调用，后者实现 `IProviderFork`。
4. 为 `opencode-sessions.provider.ts` 的普通文本设置锚点，并按去重后的 `message_id` 解析编辑前的保留点。
5. 最后才抽象 provider-owned fork source 校验和可空 artifact 契约；OpenCode 的 `jsonl_path` 必须保持 `null`，不得把共享 `opencode.db` 当作可删除的单会话 transcript。

若上游只能依赖不稳定的内部 CLI 启动方式，则不实现，继续保持 OpenCode 无编辑/Fork 能力。

## 5. Pi：第一阶段只实现完整会话 Fork

### 5.1 选择这个切面

本机 Pi 0.85.1 的 CLI 已提供 `pi --fork <path|id>`；它会创建新的可恢复 session 文件。该能力直接对应侧边栏完整会话 Fork，且不需修改 Pi 的树状 JSONL。

Pi 0.85.1 已公开 RPC `fork` / `clone` 及 SDK 的 SessionManager fork 能力，指定历史用户消息 Fork 并非上游能力缺失。本阶段仍只做完整会话 Fork，原因是 CloudCLI 目前是一轮一进程的 `--mode json -p` 适配：接 RPC 需要常驻通道，接 SDK 需要新增依赖和运行时生命周期设计。两者都不应作为本次小范围能力补齐的隐含代价。

### 5.2 实施前置验证

在使用隔离 `PI_CODING_AGENT_SESSION_DIR` 的临时目录内完成：

1. 从至少两轮、含工具调用和 compaction 的源 session 执行 `pi --fork <源 JSONL 绝对路径> --mode json`，关闭 stdin 后确认 stdout 给出**新** session header id 且无模型调用。
2. 确认子 header 含 `parentSession`、header id 与事件 id 一致，后续 `pi --session <child-id>` 能恢复完整上下文。
3. 明确以源 session 的 `project_path` 作为 child process cwd；Pi 不会自动继承源 cwd。验收子文件位于该 cwd 对应的 sessions 子目录，不接受依赖递归查找兜底。
4. 固定记录已验证的 Pi 版本与 `--fork` 帮助输出；运行时在实际 fork 前执行缓存的版本/flag 预检，失败时拒绝操作而非创建不完整会话。首期保持静态能力入口：不兼容时点击后显示明确错误，不为隐藏入口改造动态能力矩阵。

### 5.3 实现设计

1. 新建 `pi-fork.provider.ts` 并实现 `IProviderFork`。
2. 使用与 `pi-runtime.provider.ts` 一致的命令解析和 child-process 生命周期规范；不得把 fork 逻辑塞进 runtime。
3. 启动 `pi --fork <源 JSONL 绝对路径> --mode json`，显式设置 `cwd = source.project_path`，逐行解析 JSON mode 的 session header。stdin 必须在 spawn 后立即 `end()`；未关闭 stdin 会使无 prompt fork 挂起。
4. 获取 child provider session id 后，通过 `resolvePiTranscriptPath()` 找到新 JSONL 文件，验证 header id、cwd 和 `parentSession`。不新增 watcher 竞争处理：现有 `sessionsDb.createForkedSession()` 已在事务中替换 watcher 先建的同 provider-session 临时行；只补回归测试证明 Pi 路径同样成立。
5. `PiProvider` 注册 `readonly fork`；能力矩阵仅将 `supportsSessionForking` 改为 `true`，`supportsMessageEditing` 保持 `false`。
6. Pi provider 在自身验证 source `jsonlPath` 和 child artifact；本期保持现有公共 `forkSessionById()` 的 JSONL 前置校验，不为 OpenCode 预先改造。

### 5.4 第二阶段的明确门槛（不在本方案实施）

聊天内 Fork/编辑仅在完成下列架构决策后再立项：选择常驻 Pi RPC 通道，或引入并管理 `@earendil-works/pi-coding-agent` SDK。实现前仍须用含 v3 compaction、branch summary、模型和 thinking 设置的真实会话验证所选路径。

届时的推荐语义是：聊天 Fork 创建独立 JSONL；编辑从被编辑用户 entry 的父 entry 创建独立分支/会话后发送替换 prompt。绝不截断原文件或手写 Pi entry。

### 5.5 测试与验收

- fork provider unit tests：绝对源路径、源 cwd、session root、stdin 立即关闭、无 header、子文件缺失、子 header 的 id/cwd/parentSession 不符、版本预检失败、进程失败，以及 watcher 先插入时由既有 `createForkedSession()` 去重事务消除临时行。
- 真实 smoke：完整会话 Fork 后在子会话发送 follow-up，验证模型能看到源会话的末尾上下文；原会话继续发送时不出现子会话内容。
- UI：运行中会话不显示侧边栏 Fork；已完成会话显示且点击后导航至新会话。未落盘会话的隐藏需先为侧边栏 payload 增加 `hasTranscript`（或等价字段）后才可作为验收项，本变更不将它写成既有行为。

## 6. 实施顺序与提交边界

为便于回滚和审阅，按三个独立变更交付：

1. **WorkBuddy 编辑**：后端 sessions/fork helper、能力矩阵、单测与 WebSocket 回归。
2. **Pi 完整会话 Fork**：先完成 §5.2 实测记录；通过后再新增 provider fork facet、能力矩阵和测试。

OpenCode 不进入本期交付；未来的验证失败也不阻塞 WorkBuddy/Pi 的独立交付。

## 7. 非目标与回退策略

- 不增加“fork 后自动发送新 prompt”的 UX；Fork 只创建并打开会话，用户自行继续。
- 不支持跨 provider Fork。
- 不尝试修复或迁移历史上未锚定的消息；此类消息不显示操作入口。
- provider 升级导致 fork contract 不兼容时，能力矩阵应临时关闭对应入口，保留历史只读与普通续跑能力。

## 8. 审阅批注

<!-- 审阅者请从此处开始追加，勿修改正文。 -->

### CodeBuddy

> [!CAUTION] §3.2.1 / §3.3 「确保截断后父链完整」防的不是真正的风险，而现有测试清单会给出假绿
> 前缀复制不可能断父链：`WorkbuddyForkProvider.resolveKeepCount` 返回 `anchorIndex + 1`（`workbuddy-fork.provider.ts:95-109`），保留的永远是文件前缀，每个保留行的 `parentId` 只可能指向更早的保留行。provider 自己的注释已经写明这一点（同文件 `:18-21`：「the last kept row's `parentId`, when set, always points at a kept row」），所以 §3.3 第一条当作主要风险是不成立的。
> 真正会让"编辑后第一次发送"直接失败的是**悬空工具调用**：编辑点的前一行可能是带 `tool_use`（function_call）却**没有**对应 `function_call_output` 的 assistant 行（运行被 Stop 或报错打断就是这么落盘），而 tool_result 是嵌在 `role: 'user'` 行里的 block（`workbuddy-sessions.provider.ts:882-902`），所以"前一行是不是 user 行"并不能说明它是不是一轮的完整结尾。拿这样的前缀去 `--resume`，模型侧会收到一个没有结果的工具调用。
> 建议把边界规则写成「回退到最后一个**完整轮结尾**的行」（assistant 行且最后一个 block 是 `output_text`，或一条不含纯 tool_result 内容的 `role: 'user'` 行），并在 §3.4 补三种 fixture：① 以 `tool_use` 结尾的中断轮；② 以 tool_result 结尾的轮；③ 同一 assistant 行含多个 `output_text` block。现在清单里的那句「带 tool event 的多 turn transcript」三条都覆盖不到，会通过。
> 另一个测试没要求的形态：`event.type !== 'message'` 的行是存在的（`workbuddy-sessions.provider.ts:798-810`），因此"前一条 event"经常不是一条可见消息。§3.2.1 的措辞（「可作为完整对话边界的 event」）方向是对的，但需要把它变成明确的判定函数并进测试，否则实现者很容易写成"在可见消息列表里取前一条"。

> [!WARNING] §5.1 / §5.4 的前提「原生 API 尚未提供」在 Pi 0.85.1 上不成立
> §5.4 把第二阶段的门槛定为「Pi RPC 明确提供从 entry id fork 的非交互方法」或「SDK 提供稳定的 SessionManager fork API」——两者本机都已具备（`@earendil-works/pi-coding-agent@0.85.1`）：
> - RPC：`{"type":"fork","entryId":"abc123"}`「Create a new fork from a previous user message on the active branch」，配套 `get_fork_messages`、`clone`（`docs/rpc.md:638`、`:666`、`:694`）；`pi --mode rpc` 是 `pi --help` 公开的 output mode。
> - SDK：`runtime.fork("entry-id")`、`runtime.fork("entry-id", { position: "at" })`（`docs/sdk.md:827`、`:830`）、`SessionManager.forkFrom(sourcePath, targetCwd, sessionDir?)`（`docs/session-format.md:395`）、`createBranchedSession(leafId)`（同文件 `:404`）。
> - 语义还正好对上 CloudCLI：TUI 中选中一条用户消息的 `/fork` 是「把 leaf 移到该消息的父 entry、把文本放回编辑器」（`docs/sessions.md:106`），即"保留这条用户消息之前的全部内容"，与 `resolveEditAnchor` 的 `resumeThroughId` 定义一致，编辑语义不需要自造。
> 因此"本阶段不做聊天内 Fork / 编辑"仍然可以是正确决定，但理由不是"等 API"，而是"CloudCLI 的 Pi 适配层是一次性 `pi --mode json -p` 子进程（`pi-runtime.provider.ts:93-128`），要走 RPC 或 SDK 得新开常驻通道，或新增 `@earendil-works/pi-coding-agent` 依赖（当前 `package.json` 并无此依赖）"。请把这个真实代价写成 §5.4 的门槛，否则该门槛在文档成立的当刻就已解锁，后续实现者还得重新推一遍。
> 同理 §5.2.3 的兜底「应改用 Pi 的 RPC/SDK 创建会话」其实是首选路径：RPC `clone` 与 `SessionManager.create(cwd, sessionDir?)`（`session-format.md:391`）都不需要 prompt、不触发模型调用，天然满足"不得通过额外模型请求制造不可见对话"的约束。

> [!IMPORTANT] §3.2.2：`keepThroughId === null` 走不到 `detachSessionForScratchEdit`，必须在 provider 内自行实现
> 网关的分支条件是 `providerRewindsForEdit`（`chat-websocket.service.ts:361`），即"该 provider 是否实现 `rewindSession`"。WorkBuddy 一旦实现，`resumeThroughId === null` 那一支（同文件 `:405-420`）就永不可达，改为调用 `rewindSessionForEdit(sessionId, null)`（`:397`）。所以 §3.2.2 的"沿用现有 scratch-edit 语义"只能落在 provider 内部，且**不能**调用 `sessionsService.detachSessionForScratchEdit`（`sessions.service.ts:524`）：那是 provider → service 的反向依赖，正是 §3.3 要避免的。Codex 就是这么处理的（`codex-sessions.provider.ts:2082-2091` 直接重写了 `markProviderSessionSuperseded` + `detachProviderSession`）。
> 建议二选一并在文档中写明：照搬 Codex 的写法；或把这 6 行下沉到 `sessionsDb` 做成共用方法供两处调用。不要留两份会各自漂移的"重开"实现。顺带记录一处行为变化：首条消息编辑失败时的错误码会从 `EDIT_DETACH_FAILED` 变为 `EDIT_REWIND_FAILED`（`chat-websocket.service.ts:400` vs `:415`），若前端按 code 分支需一并调整。

> [!IMPORTANT] §4.2.4 只改了「读」的前置校验，漏了「写」路径上的两处非空签名
> 让 OpenCode fork 产物的 `jsonl_path` 为 `null`，除 `forkSessionById` 的 `!source.jsonl_path` 校验（`sessions.service.ts:321-328`）外，还必须改：
> - `IProviderFork.forkSession` 的返回类型 `{ providerSessionId: string; jsonlPath: string }`（`server/shared/interfaces.ts:78-88`）；
> - `sessionsDb.createForkedSession({ … jsonlPath: string })`（`sessions.db.ts:241-252`）与 `repointSessionToProviderSession(sessionId, { providerSessionId; jsonlPath: string })`（`:353-355`）。
> 另外请把 OpenCode「`jsonl_path` 必须保持 null」的不变量写进方案正文：`opencode-session-synchronizer.provider.ts:140-141` 特意保持 null，是为了避免删除单个 app session 时把共享的 `opencode.db` 删掉；而 `deleteOrArchiveSessionById` 在 `jsonl_path` 为空时会回退到 `sessionSynchronizer.resolveTranscriptPath`，OpenCode 目前没有实现该方法所以安全（`sessions.service.ts:739-763`）。这条不变量一旦被后来者补上 resolver 就会踩雷，写进方案比留在注释里可靠。

> [!WARNING] §4.2.1 / §4.2.2：OpenCode 的锚点不是「一条消息一个 id」
> `opencode-sessions.provider.ts:372` 把 id 拼成 `${message_id}_${part_id}`，一条 message 会产出多条 normalized 行（text / reasoning / tool），且 assistant 多步执行时**同一个 `message_id` 下会有多个 `text` part**。按 §4.2.1 把 `forkAnchorId` / `transcriptAnchorId` 都设为 `message_id`，就会出现若干条不同的可见消息携带同一个锚点；此时 `resolveEditAnchor` 若照 Codex 那样直接在"有序可见消息列表"上 `indexOf` + `[idx-1]`（`codex-sessions.provider.ts:2048-2056`），取到的是**同一条消息的另一个 part**，fork 点会偏一轮。请明确要求「按 provider 顺序枚举**去重后的 message id**，返回前一条 message id」，并加一条多 step / 多 text part 的用例。客户端截断不受影响：`useSessionStore.ts:773-776` 用 `findIndex`，首次命中的正是被编辑消息本身，切法正确。
> 同一节还缺一条硬前提：整套设计依赖 OpenCode 的 fork **包含**被指定的 message（聊天内 Fork 保留它、编辑丢弃它）。§4.1.3 目前只写「验证 API fork 参数的精确字段」，请把"包含 / 不包含"单列为验证项：它是决定 §4.3 整张表是否正确的那个开关。

> [!NOTE] §4.1 请钉死 OpenCode 版本，并说明本机的验证环境从哪来
> 文档给了 WorkBuddy 2.137.1（`workbuddy-fork.provider.ts:18`）与 Pi 0.85.1（§5.1），但 §4 通篇没有版本号，而它的成败完全取决于该版本能否起本地 server、以及 API 形状。本机 `which opencode` 为空、也不存在 `~/.opencode`，§4.1 现在连第一步都跑不起来。建议补上"先在 `<version>` 上取环境"，并把 spike 结论里的版本落进文档（与 §6 要求留下前置验证记录一致）；否则 §7 的"provider 升级后临时关闭入口"没有基线可比。

> [!TIP] §5.5 第一条 UI 验收项目前不成立
> 「Pi 空 / 未落盘会话不显示侧边栏 Fork」尚未实现：`SessionOptions.tsx:79` 的判据只有 `Boolean(onFork) && forkableProviders.has(provider) && !isProcessing`，没有"是否已落盘"的输入。要么给侧边栏 payload 补一个类似 `hasTranscript` 的字段并按它 gate，要么把这条从验收清单删除；否则它会以"未实现"的形态被记为通过。后半句"运行中会话不显示"已经成立（同上）。

> [!TIP] §3.4 的 WebSocket 断言会平凡通过
> 「客户端先收到 `history_truncated`，再显示替换 prompt」是现有设计保证的：`history_truncated` 就在 rewind 之前发送（`chat-websocket.service.ts:379-404`）。建议改成能区分实现的断言：编辑后 `sessions.jsonl_path` 指向一个新文件、新文件每一行的 `sessionId` 都是新 id、旧文件被记入 superseded，且刷新后不再出现被丢弃的尾部。

> [!NOTE] §2「不在 React 中判断 provider id」与服务端现状的距离（本次不动，仅登记）
> 服务端已有同类写法：`sessions.service.ts:580` 用 `provider === 'claude' || 'codex' || 'workbuddy' || 'pi'` 决定是否走 transcript 缓存，OpenCode 本来就落在"否"的一支。§4.2.4 引入 `assertForkableSource()` 时不需要动它，但值得在文档里登记一句：这是同一类"新增 provider 静默失配"的写法，与 §2 的原则冲突；本次不扩大范围。

### Pi · `01a0a0b8-42e1-7716-9ce1-507b37f212d7`

> [!CAUTION] §5.2.3 的"仅创建"路径实测成立，但 stdin 不关闭会挂起——fork provider 必须照抄运行时"spawn 后立即 `stdin.end()`"的现有模式
> 实测（`pi --fork <源文件绝对路径> --mode json`，隔离 `PI_CODING_AGENT_SESSION_DIR`）：
> - stdin 已 EOF（`</dev/null`）：立即退出、exit 0，stdout 首行就是新 session header JSON，**无任何模型调用**，子文件已落盘。§5.2.3 的"优先无模型创建"路径确认可用，RPC/SDK 兜底对完整 Fork 不必要。
> - stdin 保持打开（pipe 但无数据）：6s+ 仍挂起等待输入，直到 stdin 关闭才退出。
> CloudCLI 的 Pi 运行时正是用 stdio pipe spawn 后立即 `child.stdin.end()`（`pi-runtime.provider.ts:254-269`，"prompt 走 argv，stdin 立即关闭"）。fork provider 若不复制这一步，**每个侧边栏 Fork 都会挂死**。这是实现细节级阻断，§5.3 没提，建议写进验收：spawn 后未关 stdin 必须超时失败或主动 end。

> [!WARNING] §5.2.4 的前提"源 session 的 cwd 被正确继承"不成立（实测）：子会话 cwd 取 fork 命令的调用目录，不是源会话的 cwd
> 源会话 cwd=`/Users/selier/Projects/open_projects/cloudcli`，fork 子会话 header cwd=`/private/tmp/pi-review-fork`（本次调用目录）。影响是链式的：
> - 子会话 header cwd 错 → 后续 `pi --session <child>` 的附件路径、shell 语义、项目信任判定全按错目录走；
> - Pi synchronizer 的 `processSessionFile` 把 header cwd 当作 `projectPath`（`pi-session-synchronizer.provider.ts:104-125`），cwd 错则 fork 被索引进错误的项目分组，侧边栏位置错；
> - 子文件落点也偏：实测落在 session root 平铺（而非 cwd 编码子目录），靠 `resolvePiTranscriptPath` 的递归兜底找回，依赖兜底不是好设计。
> 正确做法是 fork provider **显式以源会话的 `project_path` 作为子进程 cwd**。§5.2.4 应改写为"CloudCLI 必须显式传源 project_path，Pi 不会自动继承"，并把"子文件位于 cwd 编码子目录"加进验收。

> [!IMPORTANT] fork 子会话 header 新增 `parentSession` 字段；且子文件由 pi 进程落盘，与 watcher 索引存在时序窗口
> 实测子 header：`{"type":"session","version":3,"id":"<新>","cwd":...,"parentSession":"<源文件绝对路径>"}`：
> - `parentSession` 是常规运行不出现的字段。`processSessionFile` 只取 id/cwd，实测不报错；建议在方案里登记该字段，防止未来严格 schema 校验踩雷。
> - 与 WorkBuddy/OpenCode 不同，Pi 子文件由外部进程落盘，CloudCLI 无法实现 `IProviderFork` 注释要求的"先插 DB 行、再让 watcher 看到文件"顺序。watcher 先触发时，`upsertFile` 按 provider_session_id 去重（`pi-session-synchronizer.provider.ts:91-92`）会先建一行（默认命名），fork provider 的 `createForkedSession` 必须按 provider_session_id 找到该行改名/重定向，而不是无脑新建。§5.3 应写明这个幂等要求，并补一条"watcher 先于 insert 触发"的用例。

> [!WARNING] §7 的"升级后临时关闭入口"对 Pi 只是被动兜底：CloudCLI 未锁 Pi 版本、也无能力探测
> Pi 是全局 npm 安装，CloudCLI 不控制版本。`pi --fork` 若在某版本加入或改坏，能力矩阵默认开启时每次 Fork 都在运行时失败。代码里已有 `pi --version` 探测先例（`pi-auth.provider.ts:87`），建议装配能力矩阵时对 Pi 做一次 `--help`/`--version` 探测再决定 `supportsSessionForking`，把 §7 的"事后关闭"变成"事前 gate"；并在方案中记录当前验证通过的 Pi 版本（与 §4 要求 OpenCode 钉版本对齐）。

> [!NOTE] §5.5"子会话 follow-up 能看到源会话末尾上下文"的前提已实测成立，且比方案预期更完整
> 实测子文件 = 107 条 message（事件 id/parentId 与源一致）+ header + model_change/thinking_level_change，即**源全文拷贝**，模型与 thinking 设置随拷贝保留——§5.4 门槛里的"模型/thinking 设置"在 `--fork` 路径已被验证继承。本测试源无 compaction 事件，compaction/branch 处理仍未覆盖，留给 §5.4 门槛。另注意：`--fork` 传**绝对路径**最稳（传 partial id 时查找范围被 `PI_CODING_AGENT_SESSION_DIR` 限定，实测在隔离目录下会报 "No session found matching"）。

### 牵头结论

- 采纳：WorkBuddy 编辑的主要风险改为“完整轮结尾”而非前缀 `parentId` 链；方案已增加结构 event、悬空 tool call / tool result、多 output block 的明确边界与测试。（来源：CodeBuddy）
- 采纳：首条 WorkBuddy 消息编辑将在 provider 内直接执行 supersede + detach，避免 `rewindSession` 后不可达的 service 路径和 provider→service 反向依赖。（来源：CodeBuddy）
- 采纳：OpenCode 的可空 `jsonlPath`、共享数据库安全不变量、去重 provider message id 锚点及“fork 是否包含选中消息”均记录为未来接入的完成条件；用户决定本期不做 OpenCode，因此不预先改动共享接口或数据库。（来源：CodeBuddy）
- 采纳：OpenCode 必须先取得并记录固定版本及安装来源；当前环境无 OpenCode，不将接口资料视为本机兼容性结论。（来源：CodeBuddy）
- 采纳：Pi 完整 Fork 采用已实测的无 prompt CLI 路径：源 JSONL 绝对路径、源项目 cwd、stdin 立即 EOF，并验证 child 的 cwd、`parentSession` 与落盘位置。watcher 抢先索引由既有 `createForkedSession()` 去重事务处理，本期只增加回归验证。（来源：Pi）
- 部分采纳：Pi 上游已具备 RPC/SDK 的指定 entry fork，方案已更正这一事实；但本期仍不扩展到聊天内 Fork/编辑，因为那需要常驻 RPC 或 SDK 生命周期改造。二期门槛改为架构选型与 compaction smoke，而非等待上游 API。（来源：CodeBuddy）
- 部分采纳：Pi 版本/`--fork` flag 在实际 Fork 前做缓存预检，避免静态能力入口直接执行不兼容命令；不在本变更中把整个能力矩阵改为动态探测，因为其 API 与前端缓存契约超出当前三个 provider 的最小改动范围。（来源：Pi）
- 部分采纳：未落盘 Pi 会话应隐藏 Fork 的建议成立，但当前侧边栏没有 `hasTranscript` 数据，故从本期验收移除；若产品要求该 UX，须另加 payload 字段与显示条件。（来源：CodeBuddy）
- 不采纳（本期）：将会话历史缓存中的 provider id 条件一并抽象。本期仅使用既有 JSONL fork 契约，历史缓存改造与功能无直接依赖；OpenCode 接入时再与其 artifact 契约一并设计，避免现在扩大范围。（来源：CodeBuddy）
- 修订说明：已完成正文 §3、§4、§5 与测试验收项的同步修订；新增“纯文本消息才可编辑”“不安全 WorkBuddy 边界拒绝编辑”“Pi 静态入口 + 点击前预检”决策。审阅原文均完整保留在本节之前。
