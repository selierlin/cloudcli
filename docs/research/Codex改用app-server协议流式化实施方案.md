# CloudCLI Codex 改用 app-server 协议实现真流式（实施方案）

> **状态**：v6（2026-10-07）**全部完成**——**S1 ✅（§15）**、**S2 ✅（§16）**、**S3 ✅（§17）**、**S4 随 S3 一并完成**、**S5 ✅（§18）**，「只加不改」的离线片到真机验收再到删依赖全部落地，待拍板清单为空、无遗留片。v3 收口 **U7 离线量化并裁定 D1＝方案二**；批注共 17 条（Claude 9 + Codex 8）已逐条核对回写（见 §13）。S2 实施时对 §5.3/§5.8 的两处措辞更正、四条已登记的偏离、协议面新发现 U9/U10 见 §16；S3 的真 CLI 实测结果、五条端到端证据、U2/U5/U8/U9/U10 的收口与三条实跑中新登记的偏离见 §17；S5 的删依赖与流式线文档回写见 §18。
> **日期**：2026-10-06（v1 定稿）／2026-10-07（v2 复审：批注回写 + 0.156.1 协议复核；v3：U7 量化 + D1 裁定；v4：S1/S2 实施；v5：S3 实施 + 真 CLI 端到端；v6：S5 删依赖 + 流式线 §11 回写）
> **用途**：把 Codex provider 的运行时通道从 `@openai/codex-sdk`（内部走 `codex exec`，正文整段到达）换成 CLI 自带的 `codex app-server`（JSON-RPC，**正文有 token 级增量**），使 Codex 进入真流式路径，与 Claude/Cursor/OpenCode/Pi/OMP/WorkBuddy/ZCode 一致。
> **审阅重点**：**§0.1「审阅靶子」**。本文档的事实部分（§2）由源码与二进制实测支撑，请优先攻机制与路线裁定，而不是措辞自洽。
> **参考规范**：`server/modules/providers/README.md`（How To Add A Provider）、`docs/Provider接入与验收SOP.md`、`docs/research/流式输出体验优化技术方案.md`（§11 是本方案的直接前置，本方案要**改判**它的「不建议」结论）、同目录 `CloudCLI接入ZCode-Provider实施计划.md`（格式模板）
> **关联代码**：`server/modules/providers/list/codex/`（10 文件）、`src/modules/chat/utils/revealPacer.ts`、`src/modules/chat/hooks/useSessionStore.ts`

---

## 0. 结论先行

1. **改造可控**：真正要动的是**一个 runtime 文件 + 一个客户端文件**。**读取路径与渲染契约不重写**（会话历史/索引/store/渲染不动）——因为运行时事件的出口是一个形状固定的归一化函数（§2.3）；但**归一化适配层需小改**（`codex-sessions.provider.ts` 加 `stream_delta` 等分支，§5.8），`server/shared/codex-config.ts` 需本地化类型，前端两个测试文件需改判。完整改动面见 §6。
2. **不是「通道级替换、重写 runtime」那么贵**：`codex app-server` 的协议面比 SDK 大得多但**多出来的部分都可以不用**；本次只需要 6 个方法 + 约 15 个通知。而且 app-server 客户端**已经在仓库里**（fork 与配额查询在用），只是它当前只做一次性请求/响应、显式丢弃通知（§2.1）。
3. **有一条承重的机制风险必须先裁定**（§5.5 / 拍板项 D1）：Codex 的 live 路径会把 assistant 正文做两处变换（计划信封 → `ExitPlanMode` 卡片、记忆引用标记剥离，`codex-sessions.provider.ts:2299-2326`）。一旦正文改为增量流式，**「已流出的原文」与「终帧变换后的行」是两个不同的行**，而前端 `finalizeStreaming` 会把流式行的 id 换成随机 id（`useSessionStore.ts:1196`），无法自动配对。这一条决定本方案是「照搬 Claude 的做法」还是「多一次前端契约改动」。
4. **建议整体切换、不保留 SDK 兜底**（拍板项 D3），**不接管交互式审批**（拍板项 D2），**每 run 起一个进程**（拍板项 D4）。
5. **有意变更**（必须记账）：Codex 从 `WHOLE_SEGMENT_PROVIDERS` 移除后，其正文不再经过 `revealPacer` 播放整形——这正是目的，但它同时**改变了一条既有验收过的行为**（`docs/research/流式输出体验优化技术方案.md` §11.6 的实施记录），该文档需回写改判。

### 0.1 审阅靶子（请优先攻这里）

第一节一审通常只覆盖「文档是否自洽、措辞是否准确」。本方案把**承重机制**与**路线裁定**单独列出，请把火力放在这几处（它们也最可能是拟定者的盲区）：

| # | 靶子 | 位置 | 希望被质疑的问题 |
| --- | --- | --- | --- |
| T1 | **终帧变换与流式行的归属冲突** | §5.5 | 「流式行 + 变换后的终帧行」会不会双行？跳过终帧行会不会让正文在刷新前显示原始信封？我的处置是否真能收敛？ |
| T2 | **`normalizeMessage` 词表是否真能 1:1 覆盖** | §5.3 | 我给的映射表有没有漏项/错项？特别是 `todo_list`→`plan`、`reasoning.text`→`summary`、状态枚举 camelCase→snake_case、`file_change`→`fileChange` 这几处 |
| T3 | **`thread/resume` 会回灌历史** | §5.2 | 我主张传 `excludeTurns: true`；如果漏了会导致历史被当实时消息重发。这个判断对不对？还有别的回灌面吗？ |
| T4 | **进度更新的载体换人了** | §5.3.2 | 工具卡渐进的来源从 `item.updated` 换成 `item/commandExecution/outputDelta` + `turn/plan/updated`；`item/fileChange/outputDelta` 已废弃。这个替换完整吗？ |
| T5 | **不接反向请求时是否真的只需拒绝** | §5.6 | app-server 的 10 个 ServerRequest 如果一律回 `method not found`，会不会让某些 turn 卡住而不是降级？ |
| T6 | **进程生命周期与 abort 语义** | §5.7 | 每 run 一进程 vs 常驻 daemon；`turn/interrupt` vs 直接杀子进程；被杀的子进程留下的半截 rollout 会不会污染历史 |
| T7 | **rollout 兼容性** | §11 | sessions provider 那 2565 行解析器是照 `codex exec` 的产物写的；app-server 写的是不是逐字段一致？我没有实跑证明，这条证据强度如何 |
| T8 | **路线裁定本身** | §4 | 是否真该整体切换？保留 SDK 走「有增量才用 app-server」是否更稳？我给的否决理由是否成立 |
| T9 | **一 turn 多条 agentMessage 与「每会话单流式槽位」的冲突**（**复审补入**，见 §13 R1） | §5.5 / §5.8 | 一轮里 `agentMessage → tool_use → agentMessage` 的两段正文会不会流进同一槽？`stream_end` 是 per `item/completed` 还是 per turn？ |

---

## 1. 背景与现状

### 1.1 现状链路（Codex 是唯一的例外）

```text
其它 7 个 provider：                                  Codex（现状）：
  运行时逐 delta 发 stream_delta                        codex exec --json 逐行 NDJSON
  → 服务端 createDeltaBatcher 合并                       → 无任何 delta 事件，正文只在
  → WS NormalizedMessage(stream_delta)                      item.completed 一次性到达
  → streamBuffers / revealPacer(整段 provider)          → transformCodexEvent 转成一条完整 text 行
  → useSessionStore.updateStreaming                     → 前端 revealPacer 把已到达文本按节奏摊开
  → StreamingMarkdown 逐段增长                           → 观感「空降」
```

### 1.2 为什么现在不是流式：三条证据（已复核）

1. **SDK 面没有 delta**：`node_modules/@openai/codex-sdk/dist/index.d.ts:167` 的 `ThreadEvent` 只有 8 个变体（`thread.started` / `turn.started` / `turn.completed` / `turn.failed` / `item.started` / `item.updated` / `item.completed` / `error`），无 delta；`AgentMessageItem.text` 是完整 `string`（同文件 `:65-69`）。
2. **`codex exec` 通道不发**：`codex-runtime.provider.ts:403-415` 已把这一点写在注释里（该注释已在流式线 §11.7.3 订正过「separate streaming path」的失实表述）。
3. **现状的补偿**：前端 `revealPacer`（`src/modules/chat/utils/revealPacer.ts`，295 行）把整段文本按 32ms 节拍摊开；`WHOLE_SEGMENT_PROVIDERS = {codex, dsh}`（`:24`），分派点在 `useChatRealtimeHandlers.ts:264-278`。

### 1.3 app-server 已在用，但只用于「SDK 表达不了的事」

`codex-app-server.client.ts` 存在的原因写在文件头（`:9-23`）：SDK 只有 `startThread`/`resumeThread`，没有 `thread/fork`，所以另开一条 JSON-RPC 通道。**关键限制**：`withAppServer` 是「一次操作一个子进程、请求/响应即结束」，且读取循环明确丢弃没有数字 `id` 的帧——也就是**所有通知**（`:128-130`）：

```ts
if (typeof message.id !== 'number') {
  return;   // 通知与横幅都走到这里被丢掉
}
```

流式所需的全部内容（增量、进度、终帧）都在通知通道上，所以这一步必须升级。

---

## 2. 承重事实（本次核实，均可复现）

复现命令见 §12。本节事实是路线裁定的唯一依据。

### 2.1 app-server 协议确有正文与思考的 token 级增量

从本机二进制（`@openai/codex` 0.153.4）导出的协议绑定中，`ServerNotification` 变体包含：

| 通知方法 | 载荷 | 用途 |
| --- | --- | --- |
| `item/agentMessage/delta` | `{threadId, turnId, itemId, delta}` | **正文增量（本方案的核心）** |
| `item/reasoning/textDelta` | `{threadId, turnId, itemId, delta, contentIndex}` | 原始思考增量 |
| `item/reasoning/summaryTextDelta` | `{..., summaryIndex}` | 思考**摘要**增量 |
| `item/commandExecution/outputDelta` | `{threadId, turnId, itemId, delta}` | 命令输出实时增量 |
| `item/started` / `item/completed` | `{item: ThreadItem, threadId, turnId, ...}` | 条目生命周期（item 带完整内容） |
| `turn/started` / `turn/completed` | `{threadId, turn: Turn}` | 回合边界，`Turn.status` = `completed`/`interrupted`/`failed`/`inProgress` |
| `thread/tokenUsage/updated` | `{threadId, turnId, tokenUsage}` | 用量 |
| `turn/plan/updated` | `{threadId, turnId, explanation, plan: TurnPlanStep[]}` | 待办/计划步骤（`{step, status}`，status = `pending`/`inProgress`/`completed`） |
| `item/mcpToolCall/progress` | `{threadId, turnId, itemId, message}` | MCP 工具调用的进度文本（对应现状 `item.updated`(mcp_tool_call)） |
| `thread/started` | `{thread: Thread}` | 新线程（含 `thread.id`） |
| `error` | `{error, willRetry, threadId, turnId}` | 非致命错误 |

**结论**：`item/agentMessage/delta` 与 `item/reasoning/*Delta` 的存在，把「Codex 换 app-server 就能拿到真增量」从推测变成事实。注意这与 `docs/research/流式输出体验优化技术方案.md` §11.2 的取证一致（该节说这些事件「确实存在于 codex 二进制，但不经 exec 输出」，本方案走的就是它们所在的那条通道）。

**同时被证伪/废弃的三项**（不要照抄旧设想）：

- `item/plan/delta` 标注 **EXPERIMENTAL**，且注释写明「clients should not assume concatenated deltas match the completed plan item content」→ 方案用结构化的 `turn/plan/updated`，不用它。
- `item/fileChange/outputDelta` 注释为 **Deprecated：The server no longer emits this notification** → 不要围绕它设计。
- `item/commandExecution/terminalInteraction`、`process/outputDelta`、`command/exec/outputDelta` 属别的特性面（PTY/客户主动 exec），本方案不用。

**0.156.1 相对 0.153.4 的协议差异（v2 复核，2026-10-07）**：`ServerRequest` 方法集**不变**（仍 10 个）；`ServerNotification` 仅新增 `thread/attachment/updated`（本方案不用）；`ClientRequest` 102→104；本文档 §5.3/§5.4 的映射表逐项仍成立。**一处必填新增**：`InitializeCapabilities` 现在**同时要求** `experimentalApi` 与 `requestAttestation` 两个布尔（见 §5.1），并新增可选 `optOutNotificationMethods`（可用于抑制 `thread/started` 等通知，见 §5.2 守卫）。`UserInput.image` 改为 `{type:'image', detail?} & ({url} | {fileId})`（本方案只用 `text`/`localImage`，不受影响）。`ThreadItem.mcpToolCall` 新增 `mcpAppUi` 字段（`mcpAppResourceUri` 转 legacy）。

### 2.2 协议可以从同一个二进制自己生成，但**不建议**把它当提交物

```bash
codex app-server generate-ts --out <dir>      # 0.156.1：726 个 .ts
codex app-server generate-json-schema --out <dir>
```

规模（`@openai/codex@0.156.1`，v2 复核）：`ClientRequest` 104 个方法，`ServerRequest` 10 个，`ServerNotification` 84 个变体。

**裁定**：生成的绑定只作**校对工具**（写映射表时逐字段核对），不入库。理由与现有代码的既有偏好一致——`codex-app-server.client.ts:46-52` 明确说过「declared structurally rather than imported from the generated protocol types: those travel with the CLI package while this shape has to keep compiling when a field the server no longer sends goes missing」。本次沿用该风格：手写本次用到的结构化类型（约 15 个），只在注释里标注来源与版本（`@openai/codex@0.153.4`）。

### 2.3 下游已经解耦：归一化出口是一个形状固定的函数

`codex-sessions.provider.ts:2279` 的 `normalizeMessage(raw, sessionId)` 是运行时事件进入应用的**唯一**出口。它的输入契约是：

```ts
{ type: 'item', itemType: 'agent_message' | 'reasoning' | 'command_execution'
                | 'file_change' | 'mcp_tool_call' | 'web_search' | 'todo_list' | 'error',
  itemId, ...载荷 }        // 以及 { type:'turn_complete' } / { type:'turn_failed' } / session_created 等
```

**只要新通道把事件映射成同一形状，以下全部零改动**（这是「改造可控」的全部依据）：

| 不动的部分 | 规模 | 为什么不用动 |
| --- | --- | --- |
| `codex-sessions.provider.ts` 的历史读取/索引/`fetchHistory` | 2565 行（除归一化层） | 读的是 `~/.codex/sessions/**/*.jsonl` rollout |
| `codex-session-synchronizer.provider.ts` | 250 行 | 同上（`:36-37` 扫 `~/.codex/sessions`） |
| `codex-mcp.provider.ts` / `codex-auth` / `codex-skills` / `codex-models` | — | 配置/命令面，与传输无关 |
| `codex-fork.provider.ts` / `codex-app-server.client.ts` 的 `forkThread` | — | 已经是 app-server |
| 前端 store / 渲染 / `StreamingMarkdown` / 滚动 | — | 消费的是 `NormalizedMessage` |
| `server/shared/codex-config.ts`（163 行） | — | 输出是 TOML 形状的 override，app-server 的 `-c` 是同一个 flag，`thread/start` 也有 `config` 字段 |

### 2.4 生命周期成本与现状等价

现状 SDK 每 turn 起一个 `codex exec` 子进程、turn 结束即结束。app-server 走**每 run 一个子进程**（`thread/start` → `turn/start` → 消费通知到 `turn/completed` → 关闭）在生命周期上与现状**等价**，因此：

- 不需要池化、不需要常驻 daemon、不需要重启/背压/崩溃传播处理；
- 现有 `activeCodexSessions` 这张 Map 的语义不变，只是把 value 从 `{thread, codex}` 换成 `{connection}`。

`codex app-server` 自带 `daemon` / `proxy` 子命令（`--help` 实测），本方案**不用**（拍板项 D4）。

---

## 3. 目标、非目标与有意变更

### 3.1 目标

1. Codex 的助手正文以 token 级增量到达前端，走与其它 7 个 provider 相同的 `stream_delta` 路径。
2. 思考（reasoning）与命令输出同样增量（现状命令输出只在 `item.updated` 时整块刷新）。
3. 保持现有所有 Codex 功能：会话 id 捕获与 `session_created`、resume、模型/effort/权限映射、配置文件 override、图片/文件附件、中止、用量、错误呈现、fork、历史上翻。
4. `revealPacer` 不再作用于 Codex。

### 3.2 非目标

- 不改 `revealPacer` 本体与 DSH 的整形行为（DSH 仍是整段到达，见 §1.2 与流式线 §11.3）。
- 不改前端「帧对齐提交」链路（`docs/research/流式输出体验优化技术方案.md` §4）。
- 不改会话存储、索引、MCP、认证、模型目录。
- 不引入 app-server 的 daemon/常驻通道、realtime（语音）通道、plugin/marketplace 面。

### 3.3 有意变更（须单独记账）

| # | 变更 | 影响 | 依据 |
| --- | --- | --- | --- |
| C1 | Codex 移出 `WHOLE_SEGMENT_PROVIDERS` | 正文不再被摊开播放，改为真实节奏 | 本方案的目标本身 |
| C2 | live 路径的正文可能不再做「计划信封→卡片」「引用剥离」变换 | **取决于 D1 的裁定**；历史路径不受影响 | §5.5 |
| C3 | 删除 `@openai/codex-sdk` 依赖（`package.json:173`） | 4 个引用点收敛为 0（§6） | §4 路线 A |

---

## 4. 路线比较与裁定

| 方案 | 做法 | 优点 | 代价 | 结论 |
| --- | --- | --- | --- | --- |
| **A. 整体切换** | runtime 改由 app-server 驱动；删除 SDK 依赖 | 单一事件源、单一测试面；顺手收敛到 fork 已用的通道；app-server 的 `thread/start` 响应**同步**给出 `thread.id`，解决现状「从流里懒捕获 id」的时序脆弱 | 需要一片完整的 runtime 重写与测试重建 | **建议** |
| B. 双通道并存 | SDK 照旧，另开 app-server 只取增量 | 表面「稳」 | **两套事件源**：同一轮会有 SDK 的 `item.completed` 整段与 app-server 的 delta 两份，去重靠内容比对（`dedupeAdjacentAssistantEchoes` 只在逐字相同时收敛）；两套 abort/用量/错误路径；两套测试。且 app-server 既然能跑完整 turn，SDK 就没有存活理由 | **否决** |
| C. 不改造 | 维持 revealPacer | 零改动 | 观感落差持续；且 Codex 永远是唯一需要维护「整段」特例的 provider | 保底 |

**裁定理由的强度**：B 的否决**不依赖**「双通道很难」，而依赖一条可证事实——**两个通道对同一轮都会产出正文行**，而前端只在逐字相同时才合并（`useSessionStore.ts:410-419`）。Codex 的正文恰恰是会被 live 变换改写的那一类（§5.5），所以逐字相同**不成立**，双行是构造性的而非概率性的。

---

## 5. 详细设计

### 5.1 连接层：从「一次性 RPC」升级为「长连 + 通知分发」

改造 `codex-app-server.client.ts`。保留现有的一次性 `withAppServer`（fork/quota 继续用），**新增**一个面向 turn 的连接类：

```ts
class CodexAppServerConnection {
  // 既有能力（复用现有实现）
  request(method, params): Promise<unknown>       // 带 id，Promise 化
  // 新增
  onNotification(handler: (method, params) => void): void
  onServerRequest(handler: (id, method, params) => void): void   // 见 §5.6
  // 生命周期
  stop(): Promise<void>          // SIGTERM → 宽限期 → SIGKILL（照 zcode-app-server-client.ts:128-139）
  readonly stderrTail: string    // 复用现有 stderr 收集（:106-109），用于 spawn 失败解释
}
```

要点：

1. **帧分流**（替换 `:128-130` 的丢弃行为）：带 `id` 且无 `method` → 应答 `pending`；带 `method` 且有 `id` → 反向请求；带 `method` 无 `id` → 通知。
2. **握手**：`initialize`（`capabilities: {experimentalApi: false, requestAttestation: false}`）→ 写 `initialized`。沿用 `:194-198`。**`experimentalApi` 保持 false**（本方案不依赖任何实验面，见 §2.1 对 `item/plan/delta` 的取舍）；**`requestAttestation: false` 是 0.156.1 的必填项**——语义为**不从协议层申请 `attestation/generate` 反向请求**，因此该条**构造上不会出现**，U5 的一半就此关闭（另一半见 §5.6）。协议另提供可选 `optOutNotificationMethods`（如抑制 `thread/started`），本方案**不用**——仍以 §5.2 的客户端守卫为准（版本无关，见 R8）。
3. **断管处理**：复用现有 `child.on('error'/'exit')` / `stdin.on('error')` / `stdout.on('error')` 的既有处理模板（`:143-153`），把 `failPending` 泛化为「fail pending + 通知 run 层终止」。
4. **单进程内的线程数**：本方案**一进程一线程**（`thread/start|resume` 一次），不做多线程复用，因此不需要 threadId→路由表。
5. **NDJSON 分帧**：现有实现用 `readline`（`:115`），zcode 用自维护 buffer（`zcode-app-server-client.ts:149-160`）。两者都可；沿用 `readline` 以减小改动面。

### 5.2 runtime 事件源

`codex-runtime.provider.ts` 的 `queryCodex` 主体重写（`:264-517` 区间）。新的执行骨架：

```text
1. 解析选项（不变）：cwd / model / effort / permissionMode / images / files / settings profile
   → resolveCodexConfigOverrides（不变，codex-config.ts 零改动）
2. 起一个 codex app-server 子进程，握手
3. 有 providerSessionId：
     thread/resume { threadId, cwd, model, sandbox, approvalPolicy, effort?, config, excludeTurns: true }
   否则：
     thread/start  { cwd, model, sandbox, approvalPolicy, config }
     → 响应里同步拿 thread.id（不再是「从流里懒捕获」）
     → 发 session_created（沿用现语义 :385-388）
4. 注册 activeCodexSessions[sessionKey] = { connection }（abort 用）
5. turn/start { threadId, input }        // input = buildCodexInputItems(...) 的 app-server 形状
6. 消费通知直到 turn/completed（或 error / 进程退出）
7. 收尾：发 createCompleteMessage（沿用 :454-470 的语义，aborted 时不发）
8. finally：连接 stop()、注销 session、状态收口
```

**承重判断 T3（`excludeTurns`）**：`Thread.turns` 的注释明确写着「Only populated on `thread/resume`, `thread/fork`, and `thread/read` (when `includeTurns` is true)」——即 **`thread/resume` 默认会把整段历史 turn 回灌到响应里**。若不处理，历史会被当成实时消息重新渲染。处置：`thread/resume` 传 `excludeTurns: true`，并且**只从通知通道取实时消息，响应体一律不转发**（响应体只用来读 `thread.id` / 校验存活）。**（v2 复核：0.156.1 该字段与注释仍成立。）**

**通知守卫（R8 补入）**：一进程一线程下风险低，但仍在连接层显式丢弃「非当前 `threadId`/`turnId`」的通知——`thread/started` 在新会话路径同样会到达，且若 `excludeTurns` 漏传，历史 turn 会伪装成通知流。守卫写成纯函数，S2 表驱动断言。

### 5.3 事件映射表

新增 `transformCodexNotification(method, params) → 现有形状`，替换 `transformCodexEvent`（`:84-228`）。映射目标是 §2.3 的既有词表。

> **v4 更正（S2 实施）：** 该映射器**有状态**——`item/commandExecution/outputDelta` 这类通知只带 `itemId` 与分片，要渲染成整行必须记得该 item 的快照与已累积输出（§5.3.2 的 R2 累积口径）。故实际形态是一个**每 run 一个实例**的工厂：`createCodexNotificationMapper()` → `{ transformCodexNotification(method, params), streamedText(itemId) }`。`streamedText` 是 §5.5 方案二在终帧做「已流出文本 vs 变换结果」比较的操作数（由 runtime 消费，见 §16 的边界裁定）。

#### 5.3.1 item 类型逐项对照

| app-server（`ThreadItem`） | 映射到现有 `itemType` | 关键差异（必须显式转换） |
| --- | --- | --- |
| `agentMessage{id, text, ...}` | `agent_message` | 见 §5.5（流式归属） |
| `reasoning{id, summary: string[], content: string[]}` | `reasoning` | SDK 是 `text: string`，app-server 是**两个数组**；现有 `normalizeMessage` 读 `raw.message.content`（`:2335`）。取 `summary.join('\n')`（SDK 的 `text` 即「Agent's reasoning summary」，`index.d.ts:72-75`）；`content` 是原始思考，本片不用（拍板项 D5） |
| `commandExecution{id, command, aggregatedOutput, exitCode, status}` | `command_execution` | `aggregated_output`→`aggregatedOutput`；**status 是 camelCase `inProgress`**，现有代码判 `'in_progress'`（`:2350`）→ 必须翻译 |
| `fileChange{id, changes: FileUpdateChange[], status}` | `file_change` | `FileUpdateChange.kind` 在 app-server 是**对象** `{type:'add'\|'delete'\|'update'}`，SDK 是字符串；现有代码判 `change?.kind === 'add'`（`:2377`）→ 取 `change.kind.type` |
| `mcpToolCall{id, server, tool, arguments, result, error, status}` | `mcp_tool_call` | status camelCase；`result` 形状不同（app-server 是 `{content, structuredContent?}`，SDK 是 `{content, _meta, structured_content}`）→ 需实测对齐 `normalizeCodexMcpResult` 的入参 |
| `webSearch{...}` | `web_search` | `query` 字段需实测确认（`WebSearchItem` 是 `&` 交叉类型） |
| `userMessage{id, text, ...}`（**S3 实测新增，方案原表未列**） | **显式不渲染**（`return []`） | 这是**本轮 turn 的用户输入回显**（`item/started` + `item/completed` 各一次）。前端已经持有用户自己敲的那条消息，若走 `default` 兜底会多出一张泛型工具卡（实测形状：折叠头显示「2 次工具调用」而真实只有 1 次）。与 `plan` 并列列为第二条例外 |
| `plan{id, text}` | （本片不映射） | SDK 无对应；可作为将来的「计划卡」能力 |
| 计划步骤（`turn/plan/updated`） | `todo_list` | app-server 是 `plan: [{step, status}]`（status = `pending`/`inProgress`/`completed`），现有代码读 `raw.items: [{text, completed}]`（`:2436-2439`）→ 适配器翻译；**保持现状语义**（只有 `completed` 算 completed，`inProgress` 落 `pending`，与现状逐字一致，避免顺带改渲染） |
| `dynamicToolCall` / `collabAgentToolCall` / `subAgentActivity` / `imageGeneration` / `imageView` / `sleep` / `contextCompaction` / `enteredReviewMode` / `exitedReviewMode` / `hookPrompt` / `functionCallOutput` | 走 `default` 分支 | 现有 `default` 已兜底成 `tool_use`（`:2452-2462`），保持兜底行为即可；本片不新增大类 |

> **v5 更正（S3 真 CLI 实测）：** 本表在 0.156.1 上的**实际观测集合**比原稿小——一轮普通对话真正出现过的 item 类型只有 **`userMessage` / `reasoning` / `agentMessage` / `commandExecution`** 四类（加工具的回合出现 `commandExecution`）。`fileChange` / `mcpToolCall` / `webSearch` / 各类 default 兜底项**在本轮实测中均未触发**，其映射仍以 §16 的离线单测（按协议绑定构造的载荷）为准，未获真机证据。另：`agentMessage` 的真实字段集是 `{type, id, text, phase, memoryCitation, delivery, questions}`——`phase` / `delivery` / `questions` 三个字段**本方案与附录 A 均未列**（本片不消费，登记备查）。

#### 5.3.2 进度更新的载体换人了（承重判断 T4）

现状靠 `item.updated` 拿工具卡的渐进刷新（`PROGRESSIVE_CODEX_ITEM_TYPES = {command_execution, mcp_tool_call, todo_list}`，`:46`）。app-server **没有 `item/updated`**，替换关系是：

| 现状（exec/SDK） | app-server 替代 | 说明 |
| --- | --- | --- |
| `item.updated`(command_execution).aggregated_output | `item/commandExecution/outputDelta` + 终态 `item/completed` | 实时增量更强（现状是整块刷新） |
| `item.updated`(mcp_tool_call).result | `item/mcpToolCall/progress` + `item/completed` | |
| `item.updated`(todo_list).items | `turn/plan/updated` | 结构化，且**优先于**实验性的 `item/plan/delta` |
| （现状无） | `item/fileChange/patchUpdated` | 可选，本片可不接（`fileChange` 在终态才出卡片，与现状一致即可） |

处置：把「渐进」的判据从「事件名是 `item.updated`」改成「**按通知类型白名单**」——`item/commandExecution/outputDelta`、`item/mcpToolCall/progress`、`turn/plan/updated` 三条产生进度行；`item/started`/`item/completed` 产生生命周期行；其余通知丢弃。这样`PROGRESSIVE_CODEX_ITEM_TYPES` 这个常量可以删除。

**增量口径（R2 补入，承重）**：上述三条都是**增量**通知（`delta`/`message` 是分片），而现状的 `command_execution` 路径把 `raw.output` 当**整块** `tool_result.content`（`codex-sessions.provider.ts:2349`/`:2364`）——若把每个 `outputDelta` 直接转成一条 `tool_result`，后一条会**覆盖**前一条而非追加。处置：适配器内**按 `itemId` 维护累积 buffer**，`item/started` 初始化、增量通知追加、`item/completed` 时发**完整行**；thinking 的多个 `content`/`summary` 块按 `contentIndex`/`summaryIndex` 排序拼装。对应单测：**`delta + delta + completed == 终态全文`**（§8.1.2）。

#### 5.3.3 终止与用量

| 现状 | app-server |
| --- | --- |
| `turn.completed.usage` → `extractCodexTokenBudget`（`:53-77`） | `thread/tokenUsage/updated` 的 `tokenUsage: {total, last, modelContextWindow}`；注意 `TokenUsageBreakdown` 是**扁平 camelCase**（`totalTokens/inputTokens/outputTokens/reasoningOutputTokens`），而现有函数读 `input_tokens/output_tokens/reasoning_output_tokens/total_tokens`（snake_case）→ 需要一个新的读取函数，输出结构保持不变 |
| `turn.failed` → error 行 + 通知 | `turn/completed` 的 `Turn.status === 'failed'` + `Turn.error`，以及 `error` 通知（含 `willRetry`） |
| `error` item | `error` 通知 / 兜底 default |
| `complete` | `turn/completed` 到达即发（`status` 为 `interrupted` 时不发，交由 abort 路径，与现状 `:450-470` 一致） |

**`willRetry` 分支（R2 补入）**：`error` 通知带 `willRetry: boolean`。`true` 表示服务端**会重试、turn 未终止**——此时若一律走 error 终态行 + 收口，会把可恢复错误提前渲染成终态并吞掉其后的增量。处置：`willRetry: true` ⇒ 降级为状态行（或丢弃、只记日志），仅 `willRetry: false` 走 error 终态路径。

**`thread/tokenUsage/updated` 的发射节奏（R6 补入）**：该通知一轮内可能触发多次；若每次都发 `token_budget` 状态行会重复。处置：**运行期只更新内部值，`turn/completed` 时发一次**状态行。

### 5.4 参数映射

| 现状（SDK `ThreadOptions`，`:327-334`） | app-server |
| --- | --- |
| `workingDirectory` | `thread/start` / `turn/start` 的 `cwd` |
| `sandboxMode`（`workspace-write` / `danger-full-access`） | `sandbox`（`SandboxMode`，取值逐字相同） |
| `approvalPolicy`（`never` / `on-request`） | `approvalPolicy`（`AskForApproval`，取值逐字相同；保持现有 `mapPermissionModeToCodexOptions` 的映射结果，`:235-256`，**不新增 `untrusted`**） |
| `model` | `model` |
| `modelReasoningEffort` | `effort` |
| `config`（profile overrides） | `config`（`{k: JsonValue}`）或 spawn 参数 `-c k=v`；两者语义相同，**建议用 `config` 字段**（避免再拼一次 `-c`，且 thread 级覆盖更贴语义） |
| `skipGitRepoCheck` | app-server 无对应字段（需实测确认是否仍需要；现状只是跳过非 git 目录的检查） |

输入项（`UserInput`）差异：

| 现状 `buildCodexInputItems`（`server/shared/image-attachments.ts:487`，doc 注释在 `:483`） | app-server `UserInput` |
| --- | --- |
| `{type:'text', text}` | `{type:'text', text, text_elements: []}`（**必填字段**） |
| `{type:'local_image', path}` | `{type:'localImage', path}` |

这一处落在**共享层文件**（`server/shared/image-attachments.ts`），本方案建议**在 codex 的映射层转换、不改 `buildCodexInputItems` 的现有输出**——因为其它 provider 不消费它，但保守起见把转换放在 provider 内，避免共享层被一处调用者绑架。

### 5.5 流式与终帧的归属（承重判断 T1 / 拍板项 D1）

这是本方案唯一需要「新增前端契约」还是「照搬既有做法」的分水岭，必须讲清。

**问题**：Codex 的 live 正文有两处变换（`codex-sessions.provider.ts:2299-2326`）：

1. `readCodexMemoryCitations(text)`——把引用标记从正文剥离并挂到 `memoryCitations`；
2. `readCodexProposedPlan(text)`——正文以「计划信封」开头时，整段改成 `ExitPlanMode` 工具卡（不是文本行）。

而前端 `finalizeStreaming` 会把流式行的 id **换成随机 id**（`useSessionStore.ts:1196` / `:1216`），所以「流式行」与「带 `itemId` 的终帧行」在客户端是**两个不同的行**。只有内容逐字相同时，`dedupeAdjacentAssistantEchoes`（`:405-455`，条件是 `prev.kind==='stream_delta' && m.kind==='text'` 且 `trim()` 后相等）才会收敛掉前一行。

**三条候选**：

| 方案 | 做法 | 结果 |
| --- | --- | --- |
| **一：照搬 Claude 的去重纪律**（`claude-runtime.provider.js:449-490` 的 `streamedText` 抑制） | 某 `itemId` 流过 delta ⇒ 其 `item/completed` **只发 `stream_end`，不发文本行** | 正文全真流式；**代价＝C2**：live 期间看不到 `ExitPlanMode` 卡片（且若正文含引用标记，会短暂显示原始标记），要等一次会话刷新由历史路径改写 |
| 二：终帧按内容分流 | 变换结果与已流出文本**逐字相同** ⇒ 只发 `stream_end`；**不同** ⇒ `stream_end` + 变换行 | 逐字相同的情形（绝大多数）与方案一等价；**不同的情形会持久保留两行**（原始信封行 + 卡片/剥离后的行）——**v2 更正：这不是「短暂双行」**，见下方 R7 |
| 三：改前端契约（服务端指定终帧行的 id） | 让 `finalizeStreaming` 接受「用服务端给的 id 落地」 | 最干净，但动的是前端流式收尾（流式线 §11.6 明说过这类改动最容易静默塌），改动面最大 |

**⚠️ v2 更正（R7，承重）**：原稿称方案二「不同的情形会保留两行，**需靠 `pruneRealtimeSupersededByServer`（`:463`）在一次刷新后收敛**」——**该结论不成立**。核代码：`pruneRealtimeSupersededByServer` 的筛选是 **① `serverIds.has(id)` 主筛** + **② 同轮内容逐字相等**（`findContentEchoInSameTurnOnServer`，`useSessionStore.ts:297-320` 的 `serverMessage.content.trim() === assistantText`）。而方案二的退化情形**定义**就是「原文 ≠ 变换结果」：流式行内容是**原始信封/带引用标记的原文**，终帧行是卡片或剥离后的文本——**内容不相等** ⇒ 刷新时既不命中 ①（`finalizeStreaming` 已把 id 换成随机，`:1196`）也不命中 ② ⇒ **该行不会被收敛**。故方案二的代价应从「短暂双行」更正为「该子集**持久双行**（直到整页重载清空内存 `realtimeMessages`）」。这直接抬高 D1 的决策权重：**「量化前置」从可选优化变为决定方案二是否可用的必做项**。

**裁定（v3，U7 已收口）：取方案二。** U7 的离线量化已实跑（见下），退化面为 **0**，方案二在实测样本上等价于方案一、无额外代价；而在「万一发生变换」的场合它比方案一更贴近现状（仍渲染 `ExitPlanMode` 卡片）。

**U7 实测结果（2026-10-07）**：扫描本机 `~/.codex/sessions/**/*.jsonl`——**96 个 session、405 条 assistant 消息**，逐条套用与源码逐字对齐的两条判据（`readCodexProposedPlan` 的 `^\s*<proposed_plan>`；`readCodexMemoryCitations` 的 `<oai-mem-citation>…</oai-mem-citation>\s*$`）：

| 指标 | 计数 | 占比 |
| --- | --- | --- |
| 计划信封（触发变换） | 0 / 405 | 0.00% |
| 引用标记（触发变换） | 0 / 405 | 0.00% |
| 任一命中（并集） | 0 / 405 | 0.00%（受影响 session 0 / 96） |
| 宽松：文内出现 `<proposed_plan>` 但不在行首（不变换） | 0 | — |
| 宽松：文内出现 `<oai-mem-citation>` 但不在末尾（不变换） | 0 | — |

**阳性对照（证明不是扫描器盲区）**：向同一扫描器喂一份合成 rollout（1 条计划信封 + 1 条不带标记 + 1 条引用标记），读出 `计划信封 1/3`、`引用标记 1/3`；同时原始 `grep` 全目录对 `<proposed_plan>` / `<oai-mem-citation>` 亦为 0（`grep` 能命中同目录里的 `proposed`/`citation` 普通词，故非读不到文件的假零）。扫描脚本为正则逐字复刻，非启发式。

**再次推论（v3 补强，非 R7 推翻）**：即把退化面推到 0，方案一与方案二也并非「完全等价」——差别只在「发生变换」这一子集：方案一抑制终帧的**文本行**、live 期间看不到卡片；方案二额外发变换后的行（卡片或剥离后的文本）。故该子集里方案二是方案一的**超集**（多出的是**正确的卡片**，不是垃圾行）——原稿「多出一行垃圾」的措辞不准确，v3 更正。既然实测子集为空，两者当前行为一致，取二以保住「万一发生」时的现状观感。方案三（改前端收尾契约）因代价与「最容易静默塌」的风险，在退化面为 0 时不值得付出，**否决**。

**无论取哪个方案，都必须有一个测试钉住**「终帧到达后 store 行内容立即等于变换结果、且不残留待播字符」（照流式线 §11.6 的测试 1）。

> **v5 补录（S3 实跑发现，D1 之外的第二处去重）：** §5.5 的三条候选只管**正文**（`agent_message`），但**思考**（`reasoning`）有同构的问题且前端**不会**替我们收敛：`finalizeStreaming` 的等值去重 `dedupeAdjacentAssistantEchoes`（`useSessionStore.ts:405-455`）只匹配 `prev.kind === 'stream_delta' && m.kind === 'text'`，而思考流式行走 `thinking` kind。因此若只对正文记 `streamed`、思考照发终帧行，界面会**同时出现**流式的思考轨迹与一条完整的思考行——**重复渲染**（S3 首次真机验收即命中）。处置：`item/reasoning/summaryTextDelta` 也写入同一份 `streamed` 账本（跨 summary 块补 `\n` 分隔符），使 `item/completed`(reasoning) 落进同一条「已流出 ⇒ 只发 `stream_end`」的分支。对应单测见 §17。

**多段正文与 `stream_end` 时机（R1/T9 补入）**：一 turn 内可能出现 `agentMessage → commandExecution → agentMessage` 的多段正文。前端每 session 只有**一个** text 槽（`__streaming_${sessionId}`，`useSessionStore.ts:1180`）与一个 thinking 槽（`:1181`），段间分隔靠 `sealStreaming`（`useChatRealtimeHandlers.ts:289` 在 `tool_use` 到达时、`:260` 在 `stream_end` 时触发）。因此**必须规定 `stream_end` 的发射粒度**：**每条 agentMessage 的 `item/completed` 各发一次**（不是 per turn）——这样「delta→tool_use→delta」序列天然被 tool_use 的 seal 切成两段，且 per-item 终帧去重（方案一/二的前提）才成立。对应 S2 表驱动用例见 §8.1.2。

**这一条是本方案的拍板点 D1，见 §10。**

### 5.6 反向请求策略（承重判断 T5 / 拍板项 D2）

app-server 的 `ServerRequest` 有 10 个：`item/commandExecution/requestApproval`、`item/fileChange/requestApproval`、`item/tool/requestUserInput`、`mcpServer/elicitation/request`、`item/permissions/requestApproval`、`item/tool/call`、`account/chatgptAuthTokens/refresh`、`attestation/generate`、`applyPatchApproval`、`execCommandApproval`。

**本方案不接管交互式审批**，处置是：**逐条回一个明确的拒绝应答**（JSON-RPC error，如 `{code: -32601, message: 'CloudCLI does not implement <method>.'}`，照 `zcode-app-server-client.ts:202-208` 的既有写法），而不是不答。

- 现状 Codex 的 `supportsPermissionRequests` 是 `false`（`provider-capabilities.service.ts:81`），运行时用 `approvalPolicy: 'on-request'` + 沙箱（`:247-255`），所以**不接管是与现状一致的**。
- 必须**明确应答**：不答会让 app-server 挂起等待，这是「卡住」而不是「降级」。
- **T5 的支持性证据（R4 补入）**：协议中 `CommandExecutionStatus` / `PatchApplyStatus` 都含 `'declined'`（附录 A 自证），说明审批类请求被拒后 turn 有**协议既定的降级终态**——「拒绝 → 卡住」对**审批族**不成立，拒绝是设计内路径。
- **残余面收窄（R4 补入）**：只剩 `account/chatgptAuthTokens/refresh` 与 `attestation/generate`。其中 `attestation/generate` 已由 §5.1 的 `requestAttestation: false` **构造上关闭**（不再申请该类请求）；`chatgptAuthTokens/refresh` 仅在 ChatGPT 登录态续期时出现，留 U5 由 S3 首轮打点确认是否触发。

### 5.7 中止、生命周期、错误

| 面 | 设计 |
| --- | --- |
| 中止 | `activeCodexSessions` 的 value 增加 `connection`；`abortCodexSession`（`:524-539`）改为：`connection.request('turn/interrupt', {threadId, turnId})` **与一个短超时（建议 2s）竞速**——`turn/interrupt` 若因进程卡在网络/工具调用上不响应，不能等满 30s（`codex-app-server.client.ts:26` 的单请求超时）才走下一步，否则「中止」在异常路径下观感仍是卡死。竞速超时即直接 `connection.stop()`。**无论成功与否最终都 `connection.stop()`**（SIGTERM → 宽限期 → SIGKILL，照 `zcode-app-server-client.ts:128-139`）。保留现有「status 置 aborted、收尾不发 complete」的语义（`:450-470`） |
| 进程退出 | 子进程意外退出 → 走现有 catch 分支（`:472-506`）：发 error（若不是 abort）+ `complete(exitCode 1)` + `notifyRunFailed`；若 `errorSurfaced` 已为真则不重复发 error（保持现状） |
| 超时 | 无全局 turn 超时（与现状一致，现在也没有）；单个 RPC 沿用 30s（`:26`）——**唯一例外是 `turn/interrupt`**（与 2s 竞速，见上「中止」行 / R12） |
| 清理 | 沿用现有 `completedSessionCleanupTimer`（`:567-579`） |
| 半截 rollout | 被中断的 turn 仍会留下 rollout 片段，历史路径读到的就是真实发生的（工具已执行的记录）。**这一条需实测确认不会污染索引**（§11 U4） |

### 5.8 归一化层改动（`codex-sessions.provider.ts`）

> **v4 更正（S2 实施时）：** 本节原写「新增/扩展四处，**全部**在 `normalizeMessage` 内」——**不准确**。四处里只有两处落在 `normalizeMessage`（第 1、4 条），另两处的归属由本节自己的措辞决定：第 2 条写的是「**在适配器内**翻译成 `{text, completed}`」、第 3 条写的是「翻译放在**适配器**里」。按「谁能分辨形状差异，谁就归一化」这条原则（本章第 3 条自述），`todo_list` 载荷与状态枚举都在适配器（`transformCodexNotification`）内完成，`normalizeMessage` 因此**只新增两条分支**。S2 按此实施，见 §16。

新增/扩展四处，其中两处在 `normalizeMessage`（`:2279` 起），两处在适配器：

1. **`stream_delta` 分支（新增，本方案的核心收益）**：照 `claude-sessions.provider.ts:1100-1126` 的既有写法加两条——`{kind:'stream_delta', streamChannel:'text'|'thinking', content}`。Codex 目录当前对 `stream_delta` **零处理**（grep 为空），这是纯新增。**⚠️ 与 claude 形状的一处有意偏离（R1/R15 补入）**：claude 的 `stream_delta` 不带 id，而 Codex 的 `normalizeMessage` 头部注释承诺「Live items carry a stable SDK id」（`:2293`）。Codex 一 turn 可有多条 agentMessage，若 `stream_delta` 无 id，前端只能靠顺序猜归属，且 `finalizeStreaming` 会把所有 `stream_delta` 行换成随机 id（`useSessionStore.ts:1196-1216`）⇒ 后续按 itemId 去重失效。故**给 `stream_delta` 携带内部 `sourceItemId`**（取自通知的 `itemId`，不改变前端既有渲染契约），供终帧去重与多段归属使用。
2. **`todo_list` 的载荷来源扩展**：现有只读 `raw.items`；新增路径传 `plan` 数组，在适配器内翻译成 `{text, completed}`（保持 `normalizeMessage` 的输出契约不变，避免下游渲染变化）。
3. **状态枚举归一**：`inProgress`→`in_progress` 的翻译放在**适配器**里（`normalizeMessage` 读不到 app-server 的形状差异，也不该读）——这是本设计的一条原则：**谁能分辨形状差异，谁就归一化**（与主题线 2-G 的结论同族）。
4. **`stream_end` 分支（新增，R1/T9）**：**每条 agentMessage 的 `item/completed` 各发一次 `stream_end`**（不是 per turn），与 §5.5 的粒度规定一致；`stream_end` 是前端 `sealStreaming` 的两个触发点之一（`useChatRealtimeHandlers.ts:260`）。

**不改**：`fetchHistory`、`getCodexSessionMessages` 的历史变换（`:1614-1640`）、`readCodexProposedPlan` / `readCodexMemoryCitations`（`:283-348`，仅是调用点变化）。

### 5.9 前端改动

| 位置 | 改动 |
| --- | --- |
| `src/modules/chat/utils/revealPacer.ts:24` | `WHOLE_SEGMENT_PROVIDERS` 去掉 `'codex'`，注释同步（说明只剩 DSH）。**随 S3 落，见 §9 / R3** |
| `src/modules/chat/tests/revealPacer.test.ts` | 该文件用 `'codex'` 作 provider 参数（18 处 `'codex'` 字面量）；改为 `'dsh'`（pacer 本身与 provider 无关，改参数即可） |
| `src/modules/chat/tests/revealPacerDispatch.test.tsx` | 用例「codex prose is paced, never appended as an instant row」（`:148`）需改判为「**codex 走真增量路径（不整流）**」，并新增/复用一条「dsh 仍走整流」的正向断言（该文件 7 处提到 codex，需逐处核对语义） |
| `src/modules/chat/hooks/useChatRealtimeHandlers.ts` | **零改动**（分派是按能力集合判断，`:273`） |

---

## 6. 文件级改动清单

### 6.1 修改（服务端）

| 文件 | 现状 | 改动 |
| --- | --- | --- |
| `codex-runtime.provider.ts` | 583 行 | **重写事件源**（§5.2/§5.3/§5.4/§5.7）：删 SDK import（`:14-15`）、删 `transformCodexEvent`（`:84-228`）、删 `PROGRESSIVE_CODEX_ITEM_TYPES`（`:46`）、`extractCodexTokenBudget` 改为读 `ThreadTokenUsage` |
| `codex-app-server.client.ts` | 328 行 | **新增**连接类与通知/反向请求分发（§5.1）；保留 `withAppServer` 与 `forkThread`/`readQuota` 原样 |
| `codex-sessions.provider.ts` | 2565 行 | `+` `stream_delta` 分支（含 `sourceItemId`）、`stream_end` 分支、`todo_list` 载荷适配、状态枚举归一（§5.8 四处） |
| `server/shared/codex-config.ts` | 163 行 | **仅类型来源**：`import type { CodexOptions } from '@openai/codex-sdk'`（`:6`）改为本地类型定义（`config` 的 TOML 值形状），使删除 SDK 依赖后仍能编译 |

### 6.2 修改（前端：`revealPacer.ts` + 2 个测试文件）

见 §5.9。

### 6.3 新增

| 文件 | 用途 |
| --- | --- |
| `server/modules/providers/tests/fixtures/codex-mock-app-server.mjs` | 假 app-server：读 NDJSON 请求、按脚本吐通知。仓库已有 `zcode-mock-cli.mjs` / `pi-mock-cli.mjs` 先例 |
| `server/modules/providers/tests/codex-app-server-connection.test.ts` | 连接层单测（帧分流、反向请求拒绝、断管、stop 宽限期） |

> **实际落地的文件名与上表不同**（实施期按仓库既有命名习惯改的，§15/§16 已登记）：`fixtures/codex-app-server-mock.mjs`（多模式脚本夹具）、`codex-app-server-client.test.ts`（连接层 7 条）、`codex-app-server-events.test.ts`（映射器 24 条）、`codex-stream-normalize.test.ts`（归一化 12 条）；`codex-runtime.test.ts` 为**重写**而非新增。

### 6.4 删除

| 目标 | 条件 |
| --- | --- |
| `package.json:173` 的 `@openai/codex-sdk` | §6.1 的 4 处引用全部收敛后（`@openai/codex` **保留**，它是二进制来源）—— **✅ 已于 S5 执行（2026-10-07，见 §18）** |

---

## 7. 能力矩阵

| 字段 | 现状 | 本方案后 |
| --- | --- | --- |
| `permissionModes` | `['default','acceptEdits','bypassPermissions']` | 不变 |
| `supportsImages` / `supportsFiles` | `true` / `true` | 不变（输入形状见 §5.4） |
| `supportsAbort` | `true` | 不变（实现改 `turn/interrupt` + kill） |
| `supportsPermissionRequests` | `false` | **不变**（D2 裁定不接管，§5.6） |
| `supportsTokenUsage` | `true` | 不变（来源改 `thread/tokenUsage/updated`） |
| `supportsEffort` | `true` | 不变 |
| `supportsMessageEditing` | `true` | 不变（ride `thread/fork`，本就是 app-server） |
| `supportsSessionForking` | `true` | 不变 |

即**能力矩阵零变化**——本方案只改「怎么拿到正文」，不改「支持什么」。

---

## 8. 测试方案

### 8.1 单元（离线，不跑真 CLI）

1. **连接层**：帧分流（应答/通知/反向请求三类）；反向请求被拒的应答形状；**非当前 `threadId`/`turnId` 的通知被丢弃（R8 守卫）**；子进程 exit 时 pending 全失败；`stop()` 走 SIGTERM→SIGKILL；`turn/interrupt` 竞速超时（R12）后仍 `stop()` 成功。
2. **事件映射**：每个通知 → 期望的 `{type:'item', itemType, itemId, ...}`，逐条断言（表驱动，覆盖 §5.3.1 全表 + §5.3.2 三条进度通知 + §5.3.3 用量/终止）。**新增两组**：**累积**（`delta + delta + completed == 终态全文`，R11）；**`willRetry` 两分支**（`true` ⇒ 状态行不终态，`false` ⇒ error 终态行，R2）。
3. **归一化**：`stream_delta` 两种通道（含 `sourceItemId` 非空，R1/R15）；`stream_end` 每条 agentMessage 一次（R1）；`inProgress`→`in_progress`；`{step,status}`→`{text,completed}`；`kind.type`→`kind`；`mcpToolCall.result` 走 `extractCodexToolOutput` 的容错路径（R13：块数组/未知键不崩，退化为 JSON 串需显式断言）。
4. **runtime（mock app-server 进程）**：
   - 新建会话：`thread/start` 响应里的 id 立刻产生 `session_created`（**比现状更早、更确定**）；
   - resume：`excludeTurns: true` 被发送，且响应体内历史**零转发**（T3 的守卫）；
   - abort：`turn/interrupt` 被调用且连接被关；`complete` 不再发出；
   - 用量：`thread/tokenUsage/updated` → `token_budget` 状态行且字段值正确；
   - 失败：`Turn.status==='failed'` → error 行 + `complete(exitCode 1)` + `notifyRunFailed`；`errorSurfaced` 时不重复发 error；
   - **终帧收敛（T1）**：`item/completed`(agentMessage) 在流过 delta 后**只发 `stream_end`**（方案一/二的相同分支），断言不发第二条文本行。
   - **多段正文（T9/R1）**：`delta → tool_use → delta` 序列断言产生两条独立 stream 段，各被 `stream_end` 收口（不合并成一条）。
5. **前端**：`revealPacerDispatch.test.tsx` 的 codex 用例改判为「走真增量」；新增 dsh 仍整流的断言。

### 8.2 真 CLI 端到端（必须做，且必须看浏览器）

照 `docs/research/流式输出体验优化技术方案.md` 与主题线的既有做法：真实跑一轮 Codex turn，**在浏览器里读真实渲染**，而不是只看服务端日志。断言：

1. 正文**逐段增长**（多次读取内容单调变长，而非一次到位）；
2. 工具卡、命令输出在运行中渐进刷新；
3. turn 结束后文本与 rollout 终态一致（无残留、无重复行）；
4. 刷新页面后与流式期间所见一致（**这是 T1 的实际判据**）；
5. 中止：中途 abort 后进程真的退出（`ps` 无残留），无「半截流式行 + 全文持久行」并存。

**判据注意**（照主题线 2-P 第十八层的教训）：读正文是否「稳定」不能用「连续 N 帧值不变」，因为量化步长可能吃掉小变化；本处断言用的是「**单调变长**」而非「稳定」，且要覆盖一个**长段落**（短段在 32ms 节拍下会近似一次到位）。

**S3 实跑结果（2026-10-07，真实 `codex app-server` + 浏览器读真实渲染）**

| # | 断言 | 结果 | 证据 |
| --- | --- | --- | --- |
| 1 | 正文逐段增长 | ✅ | 真实 turn 浏览器轮询最后一条 `.chat-message` 文本长度，**18 个互不相同的读数、严格单调**：`96 → 260 → 383 → 568 → 726 → 880 → 1054 → 1229 → 1350 → 1615 → 1844 → 2034 → 2273 → 2444 → 2615 → 2833 → 3021 → 3193`（篇幅刻意选 450 词长段落，避免短段近似一次到位） |
| 2 | 工具卡、命令输出渐进刷新 | ✅ | 线级实抓：`item/started`(commandExecution) → `outputDelta('step-2\n')` → `outputDelta('step-3\n')` → `item/completed`；我们的行内容依次 `7 → 14 → 14` 字符，与终态 `aggregatedOutput` 逐字一致（少掉的 `step-1` 是 CLI 自己没发该分片，不是我们丢帧）。浏览器侧同一回合先显示「执行中 · 1 次工具调用」、结束后转「执行过程 · 1 次工具调用」，展开只有一张 `Bash` 卡 |
| 3 | turn 结束后文本与 rollout 终态一致 | ✅ | 两次不同 prompt 均 `final text matches rollout = true`（把浏览器最终正文与 `~/.codex/sessions/**/rollout-*.jsonl` 的 assistant 终态逐字比对）；无残留空行、无重复行 |
| 4 | 刷新页面后与流式期间所见一致 | ✅ | 规范化（剥离 provider 徽标与时间戳）后 `sameCount / sameLast / sameAll = true`，长度两侧均 3193 |
| 5 | 中止后进程真的退出、无「半截流式行 + 全文持久行」并存 | ✅（服务端 + 单测，**未做浏览器截图**） | runtime 级实测：`abort -> true`，runtime 只发 `session_created`、**不发 `complete`**，我们启动的进程零残留（前后均为 2 条预先存在的全局 codex 进程）；单测另钉住 `turn/interrupt` 确已发出且 `complete` 计数为 0。UI 侧的「中止后界面无并行行」本轮未单独截图取证，如实记为**只覆盖到服务端契约与单测** |

**第 2 条的真实缺陷（本轮由浏览器验收抓出，已修）**：首轮实跑折叠头显示「**2 次工具调用**」，而 rollout 里只有一个 `exec_command`。根因是 `userMessage` item（用户输入回显）走 `default` 兜底被画成了一张泛型工具卡——即上文 §5.3.1 新增的那条例外。修复后同一回合为「1 次工具调用」、展开仅 `Bash x1`。**这是「必须看浏览器」这一条纪律的直接收益**：服务端日志看不出这类多余卡片。

### 8.3 回归

- `npm test`（服务端全量）：本方案**动了 `server/`**，因此**必须做名字集 A/B**（不能用「树同」豁免——参照云 cli 测试基线记忆：动了 server 就老实 A/B）。
- `test:client`：纯前端新增/改判用例，逐文件 A/B 对齐增量。
- `npm run typecheck`、`lint`、`npm run build`。
- 既有 `codex-*` 测试全绿：`codex-model-editing` / `codex-session-fork` / `codex-models` / `codex-sessions`（**这四个不该受影响**，可作为「没碰坏别的」的证据）、`codex-runtime.test.ts`（**预期重写**）。

---

## 9. 分片与实施顺序

按仓库惯例：**极简指令 = 自己选片并全线做完**；每片实施 + 门禁 + 文档 + 记忆一次做完。

| 片 | 内容 | 门禁（片级判据） |
| --- | --- | --- |
| **S1** ✅ | 连接层升级 + 假 app-server 夹具 + 连接层单测。**不动 runtime** | fork/quota 既有测试全绿（证明未破坏一次性路径）；连接层单测覆盖 §8.1.1 —— **已达成（2026-10-07，见 §15）** |
| **S2** ✅ | `transformCodexNotification` + `normalizeMessage` 的 `stream_delta`/`plan`/状态分支 + 表驱动单测。**仍不接线** | §8.1.2 / §8.1.3 全绿；`codex-sessions.test.ts` 既有用例零变化 —— **已达成（2026-10-07，见 §16）** |
| **S3** ✅ | runtime 切换到 app-server；`codex-config.ts` 类型本地化；`extractCodexTokenBudget` 换源；**前端 `WHOLE_SEGMENT_PROVIDERS` 去 `'codex'`（一行 + 注释，从 S4 前移，见 R3）** | **§8.2 真 CLI 端到端五条全过**；`codex-runtime.test.ts` 重写后全绿；`npm test` 名字集 A/B 判定「零新增红」 —— **已达成（2026-10-07，见 §17；§8.2 第 5 条的 UI 侧未截图，只覆盖服务端契约与单测）** |
| **S4** ✅ | 前端：两个测试文件改判（`revealPacer.test.ts` 参数换 `'dsh'`；`revealPacerDispatch.test.tsx` 改判 codex 走真增量 + 新增 dsh 整流断言） | `test:client` 逐文件 A/B 对齐；§8.2 第 1/4 条复跑 —— **随 S3 一并完成，无剩余工作（R3 前移的结果，见 §17）** |
| **S5** ✅ | 收尾：删除 `@openai/codex-sdk`（package.json + lock）；回写 `流式输出体验优化技术方案.md` §11（改判「不建议」为「已实施/已换通道」）+ §11.6 实施记录补记；本方案文档状态行 | `npm test` / `test:client` / `typecheck` / `lint` / `build` 全绿；文档三处交叉引用口径一致 —— **已达成（2026-10-07，见 §18）** |

**顺序理由**：S1/S2 都是「只加不改」的离线片，可以在不接触真 CLI 的情况下把绝大部分逻辑与测试建起来；S3 是唯一的高风险片，必须一次性做完且做真机验收。**R3 更正**：`WHOLE_SEGMENT_PROVIDERS` 去 `'codex'` 的那一行必须**随 S3 一起落**（原排在 S4）——否则 S3 期间 runtime 已发 delta、而终帧 text 行仍被 `revealPacer` 摊开播放，两条机制叠加成「重播」，§8.2 第 1/4 条在 S3 看到的不是真实态。S4 因此只剩两个测试文件的改判。

---

## 10. 需拍板项

| # | 问题 | 选项 | 建议 | 不阻塞的原因 |
| --- | --- | --- | --- | --- |
| **D1** | live 正文的终帧变换与流式行如何归属（§5.5） | 一：照搬 Claude 去重纪律，牺牲 live 卡片；二：按内容分流（**R7 更正：不同子集是持久双行，非短暂**）；三：改前端收尾契约 | **✅ 已裁定＝方案二**（U7 实测退化面 0/405 ⇒ 等价于方案一；且变换发生时比一更贴近现状） | 已收口，不阻塞任何分片 |
| **D2** | 是否同时接管交互式审批（§5.6） | 接（顺手把 `supportsPermissionRequests` 翻 true）/ 不接（一律明确拒绝） | **不接** | 这是独立特性，与流式正交；不接也保持现状语义 |
| **D3** | 是否保留 SDK 路径兜底（§4） | 整体切 / 双通道并存 | **整体切** | 双通道的双行是构造性的（§4 裁定理由） |
| **D4** | 进程模型 | 每 run 一进程 / 常驻 daemon | **每 run 一进程** | 与现状生命周期等价（§2.4） |
| **D5** | 思考通道取 `reasoning.summary` 还是 `content`（§5.3.1） | summary / content / 两者 | **summary** | SDK 的 `text` 即 summary，取 summary 是「保持现状观感」；需在 S3 实测对齐 |

---

## 11. 未验证项与证据强度

**证据强度分级**：本方案 §2 的事实来自（a）本机二进制导出的协议绑定（可复现）、（b）仓库源码（可复现）、（c）包内 `.d.ts`（可复现）。以下带 **U** 的条目**初稿时没有**可复现证据，属设计假设。**v5（S3 实跑后）的收口状态**：U1–U5、U7、U8 **已收口**；U6、U9、U10 **部分收口**（映射有离线证据、真机未触发该场景，残余风险均为**触发式**，已在各行写明触发条件与将来若观测到问题的处置）。

| # | 未验证项 | 风险 | 收口方式 |
| --- | --- | --- | --- |
| **U1** | app-server 与 `codex exec` 写出的 rollout 是否**语义等价**（sessions provider 2565 行解析器靠它）。**R10 更正：不要求「逐字段一致」**——字段顺序、附加字段、事件顺序都可能不同，且解析器容错程度未知 | 高：不兼容会让历史读取/索引错形 | **✅ 已收口（2026-10-07，S3 实跑）**：口径取**渲染等价**而非 `diff` 零差异。同一批真实 turn（含工具回合与中止回合）：(a) 流式终态正文与 rollout assistant 终态**逐字相同**（§8.2 第 3 条，两次 prompt 均 true）；(b) 刷新走历史路径（`fetchHistory` / `normalizeHistoryEntry`）后与流式期间所见 `sameCount/sameLast/sameAll = true`（§8.2 第 4 条）；(c) 被 `turn/interrupt` 打断的回合留下的 rollout（含 CLI 自写的 `<turn_aborted>` 合成 user 消息）在刷新后正常渲染、索引未污染。**未做**：逐键 `diff` 两条通道的 rollout（按 R10 不需要） |
| **U2** | `turn/start` 是否需要 `experimentalApi: true` | 中：若需要，则要么开实验面（引入不稳定面）要么改用别的路径 | **✅ 已收口（2026-10-07，S3 实跑）**：`capabilities: {experimentalApi:false, requestAttestation:false}` 下 `initialize` 成功、turn 正常跑到 `turn/completed`。真机（含工具回合）全程无需实验面 |
| **U3** | `skipGitRepoCheck` 无对应字段时的行为（非 git 目录） | 低 | **✅ 已收口（2026-10-07，S3 实跑）**：线级探针以 `cwd=/tmp`（非 git 目录）`thread/start` + `turn/start` 成功完成，未出现 git 检查相关的拒绝 ⇒ 无对应字段不构成缺口 |
| **U4** | 被 `turn/interrupt` 打断的 turn 留下的半截 rollout 是否会污染索引/历史显示 | 中 | **✅ 已收口（2026-10-07，S3 实跑）**：中止回合的 rollout 里 CLI 自己写了一条 `<turn_aborted>` 合成 user 消息；刷新后该回合按普通「有输入、无回复」的 turn 渲染，后续新回合独立成组，索引行序与完整性正常。**未做**：`turn_aborted` 合成消息是否值得在 UI 上显式区分（属观感微调，不在本方案范围） |
| **U5** | §5.6 中「全部明确拒绝」是否会造成某些请求导致 turn 失败。**R4 收窄**：`attestation/generate` 已由 `requestAttestation: false` 构造上关闭；残余仅 `account/chatgptAuthTokens/refresh` | 中 | **✅ 已收口（2026-10-07，S3 实跑）**：线级探针在一轮完整 turn 内收到的**反向请求为 0 条**（`attestation/generate` 确由 `requestAttestation:false` 关闭；`chatgptAuthTokens/refresh` 在本次登录态下未触发）。拒绝路径未被激活，故「拒绝 → 卡住」在本轮无实例；协议侧的 `declined` 终态（§5.6 R4）仍是设计内保险 |
| **U6** | `mcpToolCall.result` 与 `webSearch.query` 的确切字段。**R13 补充**：`McpToolCallResult = {content: Array<JsonValue>, structuredContent, _meta}`（0.156.1 绑定已确认）——`content` 是**块数组**不是字符串，`extractCodexToolOutput`（`codex-sessions.provider.ts:351-367`）对未知键会退化成 JSON 串 | 中 | **⚠️ 部分收口（2026-10-07）**：映射按协议绑定写就、离线单测覆盖了块数组/未知键的容错路径（§16）；但本轮真机 turn **未触发任何 MCP 工具调用**（§5.3.1 v5 更正），故 `structuredContent` / `_meta` 的真实形状**未获真机证据**。残余风险低（容错路径会退化成 JSON 串而非崩溃），如实记为未真机验证 |
| **U7** | D1 的退化面（计划信封/引用标记的出现率） | 决定 D1 选项 | **✅ 已收口（2026-10-07）**：本机 96 session / 405 条 assistant 消息，计划信封与引用标记均 **0 命中**（阳性对照通过）⇒ D1 裁定方案二（§5.5） |
| **U8** | `thread/start.config` 与进程级 `-c` 是否语义等价（R14：前者**线程级**、后者**进程级**） | 中：若现有 profile 含影响握手/启动行为的键，搬进 `config` 可能改变行为 | **✅ 已收口（2026-10-07，S3 实跑）**：本片**不再拼 `-c`**——`resolveCodexConfigOverrides(profilePath)` 的产物直接作为 `thread/start`（与 resume）的 `config` 字段下发（`codex-runtime.provider.ts` 的 `threadParams`）。真实 turn 在带 profile 的情况下正常完成（CLI 也确实解析到了配置：stderr 报出 `Codex is ignoring 6 unrecognized configuration settings`，说明 `config` 通道生效）。**未做**：与旧 `-c` 的**逐键**对拍；因现有 profile 的键未影响握手（turn 正常完成），残余风险判为低 |
| **U9** | **S2 新发现（协议面）**：0.156.1 的 `agentMessage` item 自带 **结构化** `memoryCitation: {entries: [{path, lineStart, lineEnd, note}], threadIds}`（`ThreadItem.ts` 已确认）。若 app-server 已把引用块从 `text` 剥离，则现有 `readCodexMemoryCitations(text)`（`codex-sessions.provider.ts:321`）**解析不到任何东西**，引用脚注会在 live 路径丢失——而 §5.5 的 D1 分析正建立在「正文里带引用标记」之上 | 中：不是崩溃，是**静默丢引用**；且会影响 D1「变换」的发生率（实际可能恒为 0，只会让方案二更安全） | **⚠️ 部分收口（2026-10-07，S3 实跑）**：真机 `agentMessage` 的字段集确认为 `{type, id, text, phase, memoryCitation, delivery, questions}`，`memoryCitation` **存在但本轮为 `null`**，`text` 内**不含** `<oai-mem-citation>` 标记——与 U7 的 0 命中一致。故 live 路径**本轮未观测到引用丢失**，但「模型真的引用记忆」这一场景**未触发**，`memoryCitation` 非空时的形状（`entries` 的元素是 `{path,lineStart,lineEnd,note}` 还是别的）与「此时 `text` 是否已被剥离」**仍未验证**。本片不改 `readCodexMemoryCitations`（无证据表明会丢）；残余风险登记为**触发式**（只在引用了记忆的会话出现），将来若观测到丢失，按本条原定的处置（把 `entries` 映射成 `readCodexMemoryCitations` 的输出形状、由 `normalizeMessage` 优先采用调用方给的引用）修 |
| **U10** | **S2 新发现（协议面）**：app-server 把「提议计划」表达成独立的 `plan` ThreadItem（`{type:'plan', id, text}` / `ThreadItem.ts` 已确认），而 §5.3.1 明确「本片不映射」。若模型的正文不再带 `<proposed_plan>` 信封（被 CLI 解析成了 item），则 **live 期间的计划卡会丢失**（`ExitPlanMode` 卡片是历史路径用 `readCodexProposedPlan` 从正文里认出来的） | 中：与 U7 同族，属触发式特性；U7 实测该信封在本机出现率为 0，故影响面未知但**方向是真实的** | **⚠️ 未触发（2026-10-07，S3 实跑）**：专门以「propose a plan …」为 prompt 打了一轮，实测 **`plan` item 数为 0**、`<proposed_plan>` 信封亦为 0，item 类型仍只有 `agentMessage`/`reasoning`/`userMessage`。⇒ 普通对话（非计划模式）下两种形态都不出现，**无法判定**「真进计划模式时正文是否仍带信封」。本片保留 §5.3.1 的显式 `return []` 与 §16 的偏离 #3 登记；残余风险保持与 U9 同级的**触发式**，收口条件＝一次真正的计划模式会话（需 UI 侧配合，本片未做） |

---

## 12. 验证命令

```bash
# 协议面（本机二进制，无需网络）
BIN=node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex   # 平台相关
"$BIN" app-server --help
"$BIN" app-server generate-ts --out /tmp/codex-protocol
grep -o '"method": "[^"]*"' /tmp/codex-protocol/ServerNotification.ts | sort -u
strings -a "$BIN" | grep -oE '(item|turn|thread)/[A-Za-z][A-Za-z/]*' | sort -u

# 现状证据
grep -n "typeof message.id !== 'number'" server/modules/providers/list/codex/codex-app-server.client.ts
grep -rn "stream_delta" server/modules/providers/list/codex/            # 期望：空
grep -n "WHOLE_SEGMENT_PROVIDERS" src/modules/chat/utils/revealPacer.ts

# 门禁
npm test
npm run test:client
npm run typecheck
npm run lint
npm run build
```

---

## 附录 A：本次已核对的协议类型摘录（`@openai/codex@0.156.1`，v2 复核）

供审阅者不装环境即可核对 §5.3/§5.4 的映射。

```ts
InitializeCapabilities = { experimentalApi: boolean, requestAttestation: boolean,
                           optOutNotificationMethods?: string[] }   // 0.156.1 起前两枚必填
TurnStartParams = { threadId, input: UserInput[], cwd?, approvalPolicy?, approvalsReviewer?,
                    sandboxPolicy?, model?, effort?, summary?, personality?, outputSchema? }
ThreadStartParams = { model?, cwd?, approvalPolicy?, sandbox?: SandboxMode, config?: {[k]: JsonValue}, ... }
ThreadResumeParams = { threadId, model?, cwd?, approvalPolicy?, sandbox?, config?,
                       excludeTurns?, ... }        // 默认回灌 turns
SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'
AskForApproval = 'untrusted' | 'on-request' | {granular:{...}} | 'never'
UserInput = {type:'text', text, text_elements: TextElement[]}
          | {type:'image', detail?} & ({url} | {fileId}) | {type:'localImage', path} | ...
TokenUsageBreakdown = { totalTokens, inputTokens, cachedInputTokens, cacheWriteInputTokens,
                        outputTokens, reasoningOutputTokens }          // 扁平 camelCase
ThreadTokenUsage = { total, last, modelContextWindow }
TurnStatus = 'completed' | 'interrupted' | 'failed' | 'inProgress'
CommandExecutionStatus = 'inProgress' | 'completed' | 'failed' | 'declined'
PatchApplyStatus = 'inProgress' | 'completed' | 'failed' | 'declined'
PatchChangeKind = {type:'add'} | {type:'delete'} | {type:'update', move_path}
TurnPlanStep = { step: string, status: 'pending'|'inProgress'|'completed' }
McpToolCallResult = { content: Array<JsonValue>, structuredContent: JsonValue|null, _meta: JsonValue|null }
AgentMessageDeltaNotification = { threadId, turnId, itemId, delta }
ReasoningTextDeltaNotification = { threadId, turnId, itemId, delta, contentIndex }
ReasoningSummaryTextDeltaNotification = { threadId, turnId, itemId, delta, summaryIndex }
```

### 附录 A.1：S3 真机观测到的协议面（v5，2026-10-07）

以下不是从绑定文件读来的，而是**真实 `codex app-server`（0.156.1）跑真实 turn 时逐帧记录的**，用于校准上表的「理论面 vs 实际面」。

**实际出现的通知方法**（一轮含工具的对话；`§2.1` 与批注提到的都以内）：

```
thread/started · turn/started · item/started · item/completed
item/agentMessage/delta · item/reasoning/summaryTextDelta · item/reasoning/summaryPartAdded
item/commandExecution/outputDelta
thread/tokenUsage/updated · turn/completed · thread/status/changed
error · warning · configWarning
account/rateLimits/updated · mcpServer/startupStatus/updated · remoteControl/status/changed
```

其中 `item/reasoning/summaryPartAdded` **未出现在原方案的任何表格里**（本片按「summary 分块 → 跨块补 `\n`」处置，见 §16）；`thread/status/changed` / `remoteControl/status/changed` 本片不消费。

**实际出现的 `ThreadItem.type`**：`userMessage`（回显，§5.3.1 新增例外）、`reasoning`、`agentMessage`、`commandExecution`。`fileChange` / `mcpToolCall` / `webSearch` / `plan` / 各 default 兜底项**均未触发**。

**几个真机才看得到的形状**（原稿未列）：

```ts
// item/started|completed 的 userMessage：本轮输入的回显，前端已持有 → 显式不渲染
{ type: 'userMessage', id, text, ... }

// agentMessage 的真实字段集（比原稿多 phase / delivery / questions；memoryCitation 本轮为 null）
{ type: 'agentMessage', id, text, phase, memoryCitation, delivery, questions }

// item/completed 的 reasoning：summary 是字符串数组，content 为空数组（本片只取 summary，D5）
{ type: 'reasoning', id, summary: string[], content: [] }
```

**反向请求（ServerRequest）**：一轮完整 turn 内 **0 条**（`requestAttestation:false` 下 `attestation/generate` 不出现；`chatgptAuthTokens/refresh` 未触发）——见 U5。

---

## 附录 B：与本方案相关的既有结论（避免重复发明）

| 既有结论 | 位置 | 本方案如何使用 |
| --- | --- | --- |
| 服务端 50ms delta 合并、前端帧对齐提交 | `docs/research/流式输出体验优化技术方案.md` §4 | **原样复用**：Codex 只是从「无 delta」变成「有 delta」，合并与提交链路不变 |
| `stream_delta` 两通道（text/thinking）的规约 | `claude-sessions.provider.ts:1100-1126` | 照抄形状 |
| 终帧必须同步收敛、不排队播放 | 流式线 §11.6 测试 1 | S3 的验收断言之一 |
| 整段 provider 的播放整形（`revealPacer`） | `src/modules/chat/utils/revealPacer.ts` | Codex 移出；DSH 保留 |
| 「谁能分辨形状差异，谁就归一化」 | 主题线 2-G 结论 | §5.8 的处置原则 |
| 假 CLI 夹具先例 | `tests/fixtures/zcode-mock-cli.mjs`、`pi-mock-cli.mjs` | `codex-mock-app-server.mjs` 的模板 |
| 动了 `server/` 就必须做名字集 A/B | 云 cli 测试基线记忆 | §8.3 |

---

## 审阅批注

> 本节预留给审阅者。请优先按 **§0.1 审阅靶子**逐条给出判断（成立 / 不成立 / 需实测），而不是只做措辞校对。若发现 T1–T8 之外的承重机制遗漏，请单列。

### Claude

> [!WARNING] T1–T8 之外的承重遗漏：**一 turn 多条 agentMessage 与「每会话单流式槽位」的冲突，以及 stream_end 发射时机未定义**。§5.8 照抄的 claude `stream_delta` 形状不带 itemId（`claude-sessions.provider.ts:1100-1126`，仅 `streamChannel`），前端按 `__streaming_${sessionId}` 每 session 只有一个 text 槽（`useSessionStore.ts:1181-1183`），段间分隔只靠 tool_use 行到达时的 `sealStreaming`（`useChatRealtimeHandlers.ts:289`）。Codex 一轮里 agentMessage → commandExecution → agentMessage 的两段正文会流进同一槽；且全文未定义 stream_end 是 **per `item/completed`** 还是 **per turn** 发——若 per turn，同轮多段正文全部合并为一条，且 per-item 终帧去重（§5.5 方案二的前提）失效。建议：§5.5/§5.8 明确「每条 agentMessage 的终帧处理发一次 stream_end」，并把「commandExecution/mcpToolCall 的生命周期行为 tool_use kind（`codex-sessions.provider.ts:2343` 等已满足）从而构成 seal 点」写成显式断言（S2 表驱动单测覆盖「delta→tool_use→delta」序列）。
>
> [!IMPORTANT] §5.3.3 对 `error` 通知未区分 `willRetry`。`willRetry: true` 表示服务端会重试、turn 未终止；若一律走 error 行 + 收口，会把可恢复错误提前渲染成终态并吞掉后续增量。建议：`willRetry: true` 时降级为状态行（或丢弃），仅 `willRetry: false` 走终态路径；与 U5 同期实测收口。
>
> [!IMPORTANT] **S3/S4 分片顺序会制造「双机制并存」的过渡态，污染 S3 的验收**。S3 落地后 codex 仍在 `WHOLE_SEGMENT_PROVIDERS`，终帧 text 行会继续走 revealPacer（`useChatRealtimeHandlers.ts:264-278`），与 S3 已产生的 delta 流叠加成「重播」；§8.2 的第 1/4 条断言在 S3 片内看到的不真实。建议：把 `WHOLE_SEGMENT_PROVIDERS` 去 codex 这一行并进 S3（改动只有一行 + 注释），或约定 S3 片内验收只看服务端事件流、§8.2 浏览器断言推迟到 S4 复跑（§9 目前正是这么排的，但 §8.2 的门禁挂在 S3 上，两处需对齐）。
>
> [!IMPORTANT] T5 补一条**支持性证据**并收窄残余面：协议里 `CommandExecutionStatus` / `PatchApplyStatus` 都含 `'declined'`（附录 A 自证），说明审批类请求被拒后 turn 有协议既定的降级终态——「拒绝 → 卡住」对审批族不成立，拒绝是设计内路径。残余风险集中收窄到 `account/chatgptAuthTokens/refresh` 与 `attestation/generate`（即 U5），建议 S3 首轮实测对这两条显式打点确认是否出现。
>
> [!TIP] T4 口径不一致：§5.3.2 引用的 `item/mcpToolCall/progress` **未出现在 §2.1 的通知表**里（也不在「证伪/废弃」清单中）。若该通知在 0.153.4 实际不存在，mcp_tool_call 的渐进刷新就只剩 `item/completed` 整块（与现状等价但弱于表格承诺）。U6 收口时顺带确认，两处口径取齐。
>
> [!TIP] `thread/tokenUsage/updated` 未说明一轮内触发几次；若多次更新，token_budget 状态行会重复发。建议 §5.3.3 明确「运行期只更新内部值、turn 收口时发一次状态行」之类的策略。
>
> [!TIP] 方案二（T1）的双行收敛押在 `pruneRealtimeSupersededByServer`（`useSessionStore.ts:463` 起）上，但文档未引用它的**匹配键**（按 id 还是按内容）；若按内容匹配，变换后的终帧行需与历史路径产出的行一致才收敛。建议 U7 的离线统计顺带核对该函数的匹配逻辑，把「刷新后收敛」从假设变成已读代码。
>
> [!NOTE] T3 判断**成立**：`ThreadResumeParams.excludeTurns` 可选且默认回灌（附录 A 自证），「响应体一律不转发、只取通知」的守卫是正确姿势。补一个次要回灌面：新会话路径同样会出现 `thread/started` 等通知，S2 映射表应加一条守卫「非当前 threadId/turnId 的通知一律丢弃」——一进程一线程下风险低，但值得在 mock/单测里钉住。
>
> [!NOTE] T8 裁定**成立**：我复核了 `dedupeAdjacentAssistantEchoes` 确实只在逐字相等时收敛（`useSessionStore.ts:410-455`），方案 B 的「构造性双行」否决依据不依赖概率，成立；整体切换（D3）是对的。另外三条关键事实引用我也实测核对过：client 丢通知分支（`codex-app-server.client.ts:128-130`）、`finalizeStreaming` 随机 id（`useSessionStore.ts:1196-1216`）、`buildCodexInputItems` 输入形状（`server/shared/image-attachments.ts:487`）均与仓库现状一致。

### Codex

> [!CAUTION] **T7 / U1 的「逐字段一致」是过强表述，应改为语义等价 + 解析器容错**。app-server 与 `codex exec` 即使写同一个 rollout JSONL schema，也不保证字段出现顺序、事件顺序、附加字段逐字一致；sessions provider 2565 行解析器对字段缺失/顺序的容错程度未知。U1 若按 `diff` 两个文件「零差异」收口，可能卡在无关差异上；建议收口口径改为「同一 prompt 两通道产出的会话在 `fetchHistory`/`normalizeHistoryEntry` 下渲染结果等价」，并单测解析器对 app-server 特有字段/顺序的容忍。
>
> [!CAUTION] **增量型通知的「累积语义」未定义（T4 的缺口）**。`item/commandExecution/outputDelta`、`item/reasoning/textDelta`、`item/reasoning/summaryTextDelta` 都是**增量**，而现状 `command_execution` 路径是幂等的整块 `aggregated_output`（`codex-sessions.provider.ts:2349` 起直接作为 `tool_result.content`）。如果适配器把每个 outputDelta 直接转成一个 `tool_result`/`stream_delta`，后一个增量会**覆盖**前一个而不是追加。文档只说了「实时增量更强」，没写每 itemId 的累积状态放在哪、`summaryIndex`/`contentIndex` 怎么排序。建议 §5.3.2 显式写「适配器内按 itemId 维护累积 buffer，`item/completed` 时才发完整行；thinking 的多个 content/summary 块按 index 拼装」并补 S2 表驱动「delta+delta+completed == 终态全文」。
>
> [!WARNING] **abort 可能被 30s RPC 超时卡住（T6）**。`turn/interrupt` 是普通 JSON-RPC 请求，连接层沿用 30s 超时（`codex-app-server.client.ts:26`）；若子进程卡在网络/工具调用上不响应，`abortCodexSession` 会先等 30s 才走到 `connection.stop()`。建议 `turn/interrupt` 与一个短超时（如 2s）竞速，超时即直接 `stop()`/SIGKILL；同时定义 stop 宽限期，否则「中止」在异常路径下观感仍是卡死。半截 rollout 的污染（U4）也要把「解析器遇到无 `turn.completed` 的残片」纳入 S3 实测。
>
> [!WARNING] **`mcpToolCall.result` 不是换字段名就能对齐**。现有 `normalizeCodexMcpResult` 读 `resultRecord.content` 和 `resultRecord.structured_content`（snake_case，`codex-sessions.provider.ts:388-394`），app-server 给的是 `{content, structuredContent?}`；且 `content` 可能是块数组/对象而不是字符串，`extractCodexToolOutput` 是否接受未知需实测。建议 U6 不只是「字段名对照」，还要抓一个真实 MCP 返回跑 `normalizeCodexMcpResult` 的单测。
>
> [!IMPORTANT] **`config` 字段与进程级 `-c` 的语义未必等价（§5.4）**。`codex exec` 现在用 `-c k=v` 是进程级启动参数，`thread/start.config` 是线程级配置；如果现有 settings profile 里包含影响握手/启动行为的键，搬进 `config` 可能改变行为。建议 S3 用现有 profile 同时跑两条通道对比 `codex-config.ts` 的产物，若出现分歧则保留 `-c`（不要一次迁移两件事）。
>
> [!IMPORTANT] **`stream_delta` 无 itemId 会进一步削弱「live item 稳定 id」的既有承诺**。`normalizeMessage` 开头注释说「Live items carry a stable SDK id」（`codex-sessions.provider.ts:2303`），但照抄 claude 的 `stream_delta` 形状不带 id；Codex 一 turn 内出现多条 agentMessage 时，前端只能靠顺序猜归属，且 `finalizeStreaming` 会把所有 `stream_delta` 行换成随机 id（`useSessionStore.ts:1196-1216`），后续按 itemId 去重失效。建议至少在服务端给 `stream_delta` 携带一个内部 `sourceItemId`（或按 agentMessage 顺序发独立 stream_end），并在 S2 覆盖「delta→tool_use→delta」序列（Claude 批注已提到同方向，这里补代码依据）。
>
> [!TIP] **§0「一个 runtime 文件 + 一个客户端文件」与 §6 清单口径不完全一致**。实际还包含 `codex-sessions.provider.ts` 的归一化分支、`codex-config.ts` 类型本地化、前端 `revealPacer` 及两个测试文件。核心是「一个 runtime + 一个客户端」没错，但建议把「会话历史/索引/渲染/store 全部不需要动」改成「**读取路径与渲染契约不重写，归一化适配层需小改**」，否则评审容易误判改动面。
>
> [!TIP] **D1 的离线统计要区分「出现率」和「会被看见的原始信封」**。`readCodexProposedPlan`/`readCodexMemoryCitations` 在历史与 live 都生效，rollout 统计可作为出现率代理；但用户实际感知的是「流式过程中先看到原始信封/引用标记，终帧才变卡片」。即使出现率低，只要方案二保留「不同则双行」，每个命中场景都会在刷新前出现错误内容。建议把 U7 的判据从「出现率」升级为「出现率 × 用户能否容忍刷新前原始文本」，并明确阈值落在哪。

---

## 13. 复审响应与回写记录（v2，2026-10-07）

上一节是两位审阅者的**原始批注**（原文保留不改）。本节是**逐条复核结论**（每条都对着当前代码/协议绑定核过，非措辞校对）与**回写位置**。编码 R1–R17 在正文各处被回引。

| # | 来源 | 批注要点 | 复核判定 | 回写位置 |
| --- | --- | --- | --- | --- |
| R1 | Claude | 一 turn 多条 agentMessage 撞单槽 + `stream_end` 时机未定义 | **属实** | §0.1 新增 T9；§5.5 末段；§5.8 第 1/4 条；§8.1.3/§8.1.4 |
| R2 | Claude | `error` 未区分 `willRetry` | **属实**（生成类型确有该字段） | §5.3.3 新增段 |
| R3 | Claude | S3/S4 顺序制造双机制并存 | **属实**（按 D1 条件成立） | §9 表 + 顺序理由（去 codex 一行前移 S3） |
| R4 | Claude | T5 补 `declined` 证据、收窄残余面 | **属实** | §5.6 |
| R5 | Claude | `item/mcpToolCall/progress` 不在 §2.1 表 | **前提被推翻**：该通知**确实存在**（`McpToolCallProgressNotification`）；只是 §2.1 表漏列 | §2.1 表补一行 |
| R6 | Claude | `thread/tokenUsage/updated` 触发次数未定义 | **属实** | §5.3.3 新增段 |
| R7 | Claude | 方案二的收敛未核 `pruneRealtimeSupersededByServer` 匹配键 | **属实，且更严重**：该函数按 id + 同轮**逐字内容**匹配，方案二「不同」子集**不收敛** ⇒ **持久**双行而非短暂 | §5.5 更正块 + §10 D1 建议修订 |
| R8 | Claude | T3 成立；补「非当前 threadId/turnId 通知丢弃」 | **成立** | §5.2 守卫段；§8.1.1 |
| R9 | Claude | T8 裁定成立 | **成立**（复核 `dedupeAdjacentAssistantEchoes` 逐字相等才收敛） | 无需改 |
| R10 | Codex | U1「逐字段一致」过强 → 语义等价 | **属实** | §11 U1 |
| R11 | Codex | 增量通知累积语义未定义 | **属实** | §5.3.2 新增段；§8.1.2 |
| R12 | Codex | abort 可能被 30s 超时卡住 | **属实**（`REQUEST_TIMEOUT_MS=30_000`） | §5.7 中止行 |
| R13 | Codex | `mcpToolCall.result` 不是换字段名 | **部分属实**：`extractCodexToolOutput` 容错、不崩，但未知键退化成 JSON 串 | §11 U6；§8.1.3 |
| R14 | Codex | `config` 与进程级 `-c` 语义未必等价 | **属实**（线程级 vs 进程级） | §11 新增 U8（S3 两通道对比 `codex-config.ts` 产物） |
| R15 | Codex | `stream_delta` 无 itemId 削弱稳定 id 承诺 | **属实**（与 R1 同向；注释在 `:2293`，批注写 `:2303` 有小偏） | §5.8 第 1 条 |
| R16 | Codex | §0 与 §6 清单口径不一致 | **属实（措辞）** | §0 第 1 条 |
| R17 | Codex | D1 的 U7 统计要区分「出现率」与「会被看见的原始信封」 | **属实，且被 R7 加强**——不仅「刷新前」，方案二的双行是**持久**的 | §5.5（R7 块已覆盖）；U7 判据按此措辞 |

**结论：17 条无一条是硬错。** 唯一「前提被推翻」的是 R5，且推翻方向是好的（把一条被列为风险的东西降级为一行表格补漏）。

**v2 代码/协议漂移复核（与批注无关，为「以最新代码动手」做准备）**：
- 文档引用的全部行号（`583/328/2565/163/295` 及 `:2279`/`:2293`/`:2349`/`:2364`/`:26`/`:128`/`:388-394`/`:351-367` 等）在最新 HEAD（`1ce2c51b`）上**逐行仍成立**，零漂移。
- 协议版本 **0.153.4 → 0.156.1**：`ServerRequest` 10 个不变；`ServerNotification` 仅 +1（`thread/attachment/updated`，不用）；`ClientRequest` 102→104；§5.3/§5.4 映射表逐项仍成立。
- **一处必填变更**：`InitializeCapabilities` 现要求 `requestAttestation` 与 `experimentalApi` 并列必填（§5.1 已更新）——它顺带把 `attestation/generate` 从 U5 里**构造上关闭**。
- `UserInput.image` 支持 `fileId` 变体（本方案不用）；`ThreadItem.mcpToolCall` 新增 `mcpAppUi` 字段。
- 待拍板清单：**D1**（已按 R7 修订建议）；D2–D5 建议不变。

---

## 14. U7 量化与 D1 裁定（v3，2026-10-07）

**目的**：R7 把「量化前置」升为决定 D1 可行性的必做项（方案二的代价＝持久双行，而非短暂）。故在动手前先离线量化退化面。

**方法**（只读，不改任何状态）：
1. 逐字复刻两条判据——`readCodexProposedPlan`（`codex-sessions.provider.ts:290` 的 `/^\s*<proposed_plan>[ \t]*(?:\r?\n)?/i`）与 `readCodexMemoryCitations`（`:309` 的 `/<oai-mem-citation>([\s\S]*?)<\/oai-mem-citation>\s*$/i`）；assistant 正文提取复刻 `extractCodexTextContent`（`:221`，拼接 `input_text`/`output_text`/`text` 块）。
2. 遍历 `~/.codex/sessions/**/*.jsonl` 的 `response_item` → `message` → `role=assistant` 条目。
3. 阳性对照：同一扫描器喂合成 rollout；另对全目录原始 `grep` 目标字面量。

**结果**：96 session / 405 条 assistant 消息，**计划信封 0、引用标记 0、任一并集 0**（受影响 session 0/96）；宽松口径（标记出现在任意位置而非要求行首/末尾）亦为 0。阳性对照通过（合成夹具读出 1/3、1/3；`grep` 命中同目录普通词 `proposed`/`citation`，证明非读空）。

**裁定**：**D1 ＝ 方案二**。退化面为 0 ⇒ 二与一在实测样本上等价；而一旦发生变换，二额外渲染的 `ExitPlanMode` 卡片是对的（非垃圾），更贴近现状。方案三因代价与静默塌风险在退化面为 0 时**否决**（§5.5 已回写）。

**残余风险**：本机样本不能代表所有用户（计划模式/记忆引用属触发式特性）。若上线后观测到命中，方案二的表现在「变换子集」里仍可接受（卡片可见 + 一条待刷新收敛的原文行），不会比现状更差；届时如需彻底干净，再评估方案三。

**下一步**：D1 已定，S1/S2 不受影响，按 §9 顺序开工。

---

## 15. 实施记录：S1 连接层（2026-10-07）

**状态**：✅ 完成。**只动连接层，runtime 未接线**（符合 §9 的 S1 边界）。

**改了哪些文件**

| 文件 | 变更 |
| --- | --- |
| `server/modules/providers/list/codex/codex-app-server.client.ts` | 新增 `CodexAppServerConnection`（长连 + 三态帧分流 + `onNotification`/`onServerRequest`/`onExit` + `stop()` SIGTERM→SIGKILL + `stderrTail`/`pid` + `initialize()` 握手）、`isCodexNotificationForActiveTurn` 纯守卫、`startCodexAppServerConnection()`；抽出 `resolveCodexAppServerCommand()`（`CODEX_APP_SERVER_COMMAND` 测试缝），`withAppServer` 改为复用它。**`withAppServer` 的既有语义与握手参数一行未动** |
| `server/modules/providers/tests/fixtures/codex-app-server-mock.mjs` | 新假 app-server（NDJSON JSON-RPC），模式：`normal`/`scripted`/`banner`/`hang`/`exit-on-turn`/`ignore-sigterm`；客户端发来的每一帧若非「我方请求的应答」，一律回声为 `mock/observed` 通知 |
| `server/modules/providers/tests/codex-app-server-client.test.ts` | 新 7 条连接层单测 |

**落地的三处设计决定（与 §5.1 的对应）**

1. **帧分流**按 `§5.1` 第 1 条：有 `method` 且有 `id` ⇒ 反向请求；有 `method` 无 `id` ⇒ 通知；无 `method` 有 `id` ⇒ 应答。**无 handler 时反向请求自动以 `-32601` 拒绝**（§5.6「不答＝挂起」的处置，D2 不接审批时的默认形态）。
2. **一进程一线程**：`startCodexAppServerConnection()` 每 turn 起一个进程；连接层不做 threadId 路由（§5.1 第 4 条）。守卫做成**纯函数**，S3 接上（§5.2 R8）。
3. **握手**用 `capabilities: {experimentalApi:false, requestAttestation:false}`（§5.1 第 2 条，0.156.1 必填）。`initialized` 由 `initialize()` 内部发出。

**与方案的两处偏离（均为实现细节，已登记）**

- 新增 `pid` getter：`stop()` 的 SIGKILL 升级只能由「进程确实没了」证明，测试需要 pid（`process.kill(pid, 0)`）。它有真实消费者（测试 + abort 路径核对）。
- `request()` 增加可选 `timeoutMs`（默认仍是 `REQUEST_TIMEOUT_MS = 30_000`）：§5.7 的「`turn/interrupt` 与 2s 短超时竞速」本来就需要它，且让超时单测不必等 30s。

**门禁（全部达成）**

| 判据 | 结果 |
| --- | --- |
| 连接层单测（§8.1.1） | **7/7 通过**：非 JSON banner 不破坏分帧 + 握手 + `stop()` 收尾；帧分流三态；有/无 handler 的反向请求（拒绝形状 `-32601`）；守卫表驱动；未应答请求超时；进程退出时 pending 全失败 + `onExit`；`stop()` 对忽略 SIGTERM 的进程升级到 SIGKILL |
| fork/quota 既有测试 | **17 通过 / 1 跳过（既有 fixture 缺失）/ 0 失败**（`codex-message-editing` + `codex-session-fork` + `provider-quota`） |
| `npm run typecheck` | exit 0 |
| `npm run lint` | **exit 0**；本片两个新文件 + 改动文件 **零 warning**（全仓 163 warning 全属既有） |
| `npm test` 名字集 A/B | **零新增红**。A/B 用 HEAD(`1ce2c51b`) 干净 worktree + node_modules 软链：当前 1139 项/11 失败，HEAD 1136 项/14 失败。**相减后只剩两处、均与 codex 无关**：① 仅在当前出现的 `server/modules/agent/tests/agent.routes.test.ts` 文件级失败，错误是 `Unable to deserialize cloned data...`（node test-runner 的 IPC flake，**单跑该文件 9/9 通过**）；② 仅 HEAD 出现的 4 条（symlink 只读根 ×3、workbuddy 一次性 stdin）是环境相关的间歇失败。**n 项仲裁：数字本身在漂（1136 vs 1139 与「+7 用例」对不上，因为一次文件级失败会吞掉该文件的子用例计数），故只比名字集** |

**未做（属后续片）**：runtime 接线（S3）、事件映射与归一化（S2）、前端去 `codex`（S3）、删 SDK（S5）。

---

## 16. 实施记录：S2 通知映射与归一化（2026-10-07）

**状态**：✅ 完成。**仍不接线**（runtime 事件源替换属 S3，符合 §9 的 S2 边界）。

**改了哪些文件**

| 文件 | 变更 |
| --- | --- |
| `codex-runtime.provider.ts` | **新增** `createCodexNotificationMapper()`（+325 行，纯新增）：每 run 一个实例，`{ transformCodexNotification(method, params), streamedText(itemId) }`。内部状态四桶——`openItems`（`item/started` 的 item 快照，供只带 itemId 的增量渲染整行）、`commandOutput`（命令输出累积，R2）、`streamed`（已流出正文，供 §5.5 方案二的终帧比较）、`reasoningBlockIndex`（summary 分块，跨块补换行）。另加三个模块内纯函数：`normalizeCodexItemStatus` / `normalizeCodexFileChangeKind` / `codexPlanStepsToTodoItems`，与 `mapCodexThreadItem`（item → 既有形状）。**`transformCodexEvent` 与既有 runtime 一行未动** |
| `codex-sessions.provider.ts` | `normalizeMessage` **新增两条分支**（+35 行）：`stream_delta`（text/thinking 两通道 + 非空 `sourceItemId`）、`stream_end`。**既有分支一行未动**，`codex-sessions.test.ts` 逐字节未改 |
| `tests/codex-app-server-events.test.ts` | 新增 24 条：映射器表驱动（§5.3.1 item 全表 + §5.3.2 三条进度通知 + §5.3.3 用量/终止）、累积、`willRetry` 两分支、`streamedText`、turn 边界与状态重置 |
| `tests/codex-stream-normalize.test.ts` | 新增 12 条：§8.1.3 的归一化（两通道 + `sourceItemId` 有/无、空 delta、`stream_end`），以及适配器输出 → `normalizeMessage` 的**整链**断言（命令累积、fileChange 工具名、plan→TodoWrite、mcp 容错） |

**落地的设计决定（与方案的对应）**

1. **形状差异全在适配器归一**（§5.3.1/§5.3.2/§5.8 的「谁能分辨形状差异，谁就归一化」）：`inProgress`→`in_progress`、`kind:{type}`→`kind`、`{step,status}`→`{text,completed}`、`aggregatedOutput`→`output`、`summary:string[]`→`content`。因此 `normalizeMessage` 只多两条分支——**这是 §5.8 的 v4 更正**（原文写「四处全部在 normalizeMessage 内」，与其自身第 2/3 条的「在适配器内」相左，已回写该节）。
2. **累积（R2，承重）**：命令输出按 itemId 累积后作为整行下发（前端按 id 替换行，只下发分片会把已有输出抹掉）。终态行优先用服务器的 `aggregatedOutput`，缺失才回落累积值。
3. **`stream_end` 的粒度（R1/T9）**：**每条 agentMessage 的 `item/completed` 各发一次**，不是 per turn；工具行 → 下一段 delta 因此天然被前一次 seal 切成两段。
4. **`willRetry` 两分支（R2）**：`false` → error item 行；`true` → **丢弃**（§5.6 R2 的括号允许「或丢弃、只记日志」）。取舍理由：发「状态行」需要给 `normalizeMessage` 再加一条 `status` 分支与一条新的用户可见文案（第五处改动），而 turn 本来就在运行中、重试提示的增量信息很小；丢弃满足 R2 的实质要求（**不把可恢复错误渲染成终态**）。
5. **思考只取摘要（D5）**：终帧 `reasoning` 行 = `summary.join('\n')`，流式只发 `summaryTextDelta`；`textDelta`（原始思考链）显式丢弃。跨 summary 块补 `\n`，使「已流出文本」与终帧内容逐字一致（否则前端 `dedupeAdjacentAssistantEchoes` 的等值收敛会失效）。
6. **mcp 进度承载槽**：`item/mcpToolCall/progress` 的 `message` 装进 `result: {content:[{type:'text',text}]}`（工具卡已有的结果槽），复用 `extractCodexToolOutput` 的字符串分支。
7. **计划步骤一行一轮**：`turn/plan/updated` → `itemId: plan_${turnId}`，同一 turn 的每次更新替换同一行。

**与方案的偏离（均已登记）**

| # | 方案原话 | 实施 | 理由 |
| --- | --- | --- | --- |
| 1 | `transformCodexNotification(method, params)`（§5.3） | 工厂 `createCodexNotificationMapper()` 返回同名方法 + `streamedText` | R2 的累积要求映射器**有状态**；`streamedText` 是 §5.5 方案二终帧比较的操作数（§5.3 已加 v4 更正） |
| 2 | §5.8「四处改动全部在 `normalizeMessage` 内」 | 只有 2 处在 `normalizeMessage` | 与该节第 2/3 条自述的「在适配器内」对齐；§5.8 已加 v4 更正 |
| 3 | §5.3.1「`plan{id,text}` 本片不映射」 | 显式 `return []`（**不走** default 兜底） | default 会把 `plan` 画成一张泛型工具卡；「不映射」= 不渲染。**但连带引出 U10**（live 计划卡可能丢失），已登记 |
| 4 | §8.1.2「`willRetry` true ⇒ 状态行不终态」 | true ⇒ 丢弃 | 见上文第 4 条；§5.6 R2 的括号里有「或丢弃、只记日志」 |

**门禁（全部达成）**

| 判据 | 结果 |
| --- | --- |
| §8.1.2 / §8.1.3（两个新测试文件） | **36/36 通过**（24 映射 + 12 归一化） |
| 「`codex-sessions.test.ts` 既有用例零变化」 | **该文件逐字节未改**；连同 `codex-runtime` / `codex-session-fork` / `codex-message-editing` / `codex-models` 五个文件合跑 **55 项 / 54 通过 / 0 失败 / 1 跳过** |
| `npm run typecheck` | exit 0（含 `server/tsconfig.json`） |
| `npm run lint` | **exit 0**；全仓 163 warning 与 S1 时的读数相同，**本片 4 个文件零 warning** |
| `npm test` 名字集 A/B | **零新增红**。本片动了 `server/`，故老实做 A/B（HEAD `1ce2c51b` 干净 worktree + `node_modules` 软链）：当前 1179 项/10 失败，HEAD 1136 项/14 失败。**当前失败集是 HEAD 的严格子集**（交集 10，新增 0），差集 4 条全是已知的环境间歇项（3 条 symlink 只读根 + 1 条 workbuddy 一次性 stdin）——**没有 codex 相关红**。n 项对得上：1136 + S1 的 7 + 本片的 36 = 1179 |

**未做（属后续片）**：runtime 接线与终帧比较（S3）、`codex-config.ts` 类型本地化（S3）、`extractCodexTokenBudget` 换源（S3）、前端去 `codex`（S3）、两个前端测试文件改判（S4）、删 SDK（S5）。

**S2 引出的两处协议面新发现**（均已登记 §11）：**U9** —— `agentMessage.memoryCitation` 是**结构化字段**，若 `text` 已被服务端剥离引用标记，则现存 `readCodexMemoryCitations` 解析不到、live 路径会静默丢引用脚注（也意味着 D1 的「变换」发生率实际可能恒为 0，只会让方案二更安全）；**U10** —— app-server 把提议计划表达成独立的 `plan` item，若正文不再带信封，live 计划卡会丢失（需补一条 `plan` item → `ExitPlanMode` 卡片的映射）。两条都只能由 S3 的真 CLI 实跑收口。

---

## 17. 实施记录：S3 runtime 接线与端到端验收（2026-10-07）

**状态**：✅ 完成。**本线的核心片**：`codexRuntime` 的事件源已从 `codex exec`（经由 `@openai/codex-sdk`）整体换成 `codex app-server`；前端 `WHOLE_SEGMENT_PROVIDERS` 去掉 `'codex'`。**S4 因 R3 前移，已在本片内完成**（两个前端测试文件改判随前端那一行一起做），故 S4 判为已完成；余下只有 S5（删 SDK + 回写另一份文档）。

**改了哪些文件**

| 文件 | 变更 |
| --- | --- |
| `codex-runtime.provider.ts`（HEAD 583 行 → 当前 **957 行**；与 HEAD 比 `+683/-309`，其中 S2 的映射器约占 +325） | **`queryCodex` 整体重写**：`startCodexAppServerConnection()` → `thread/resume`（`excludeTurns:true`）/ `thread/start` → `turn/start` → `await runSettled` → 三分支收口（turn 失败／子进程先死／正常）→ `finally` 里 `deltaBatcher.dispose()` + `connection.stop()`。新增 run 级状态（`streamHalted` / `latestTokenUsage` / `turnEnded` / `turnFailed` / `exitReason` / `completeSent`）与 `handleNotification`。`extractCodexTokenBudget` 换源。`abortCodexSession` 改 `async`（`turn/interrupt` 2s 超时 → `stop()` → `finish()`）。映射器三处微调（决策 2/3）。头部注释与 import 换源（去 `@openai/codex-sdk`，入 `createDeltaBatcher` / `readObjectRecord` / `readOptionalString`） |
| `server/shared/codex-config.ts` | 删 `import type { CodexOptions } from '@openai/codex-sdk'`，本地定义 `CodexConfigValue`（递归 JSON 值）与 `CodexConfigOverrides`——**删 SDK 前的类型解耦**（S5 才能只删依赖） |
| `codex-sessions.provider.ts` | S2 已加 `stream_delta` / `stream_end` 两条分支（+35 行）；**本片一行未动** |
| `tests/codex-runtime.test.ts` | **整文件重写**（HEAD 2 条 → **12 条**）：用 mock app-server 进程 + 真 `CodexSessionsProvider().normalizeMessage` 走**整链**（`CODEX_MOCK_LOG` 记录客户端请求，`waitFor` 轮询） |
| `tests/fixtures/codex-app-server-mock.mjs` | 新增 `runtime` / `reasoning` 两个脚本模式；`THREAD_ID` 常量 → 可变 `activeThreadId`（`thread/resume` 时更新）；**请求日志提到应答之前**（见下文「abort 竞态」） |
| `src/modules/chat/utils/revealPacer.ts` | `WHOLE_SEGMENT_PROVIDERS` 去掉 `'codex'`（附注释说明「exec 只报一次、app-server 有真 delta」） |
| `src/modules/chat/tests/revealPacer.test.ts` | 参数 `'codex'` → `'dsh'`（provider 现在是不透明参数）；头部注释改写 |
| `src/modules/chat/tests/revealPacerDispatch.test.tsx` | 原 `codex prose is paced` **改判**为 `codex prose now keeps the instant appendRealtime path`（断言 `appendRealtime.length === 1` / `published.length === 0`）；新增 `dsh prose is paced, never appended as an instant row` |

**落地的设计决定**

1. **终帧归属（§5.5 方案二，D1 已在 U7 裁定）**：`isAlreadyStreamedFinalRow` 只在「该 item 已流出的文本与该终帧行内容**逐字相同**」时丢弃行、改为只发 `stream_end`；不等则把终帧行照发。live 路径 `normalizeHistoryEntry` 不做任何变换、id 也随机，所以「逐字相同」是唯一能成立的分支（U7 实测计划信封/引用标记 0 命中 ⇒ 变换发生率 0）。
2. **`userMessage` 与 `plan` 显式不渲染**（映射器 `default` 分支的两个例外）：`userMessage` 是 turn 输入的回显，前端本来就有这条消息，若走 default 兜底会被画成**幻影工具卡**。**这是真机才暴露的**（附录 A.1；方案 §5.3.1 原表未列该类型）。
3. **`reasoning` 也要记进 `streamed`**：只记 agentMessage 时，`item/completed` 的 `thinking` 整行会与流式 delta 叠加、把思考链渲染两遍（`isAlreadyStreamedFinalRow` 对 reasoning 恒 false）。跨 summary 块补 `\n` 使「已流出」与终帧逐字一致。
4. **token budget 换源**：`extractCodexTokenBudget` 改读协议形状 `{total:{totalTokens,inputTokens,outputTokens,reasoningOutputTokens}, modelContextWindow}`；默认 total 仍 200000；**输出形状（`{used,total,inputTokens,outputTokens,reasoningTokens,breakdown}`）刻意保持不变**——前端一行未动。
5. **abort 不发 `complete`**：abort handler 自己发（§5.7）。`queryCodex` 的三条收口分支全部被 `currentSession()?.status === 'aborted'` 挡在外面。
6. **`streamHalted`**：`complete` 之后的 delta 一律不发，防迟到帧复活客户端已定稿的行；`finally` 里 `deltaBatcher.dispose()` **不 flush**。
7. **「子进程先死」与「turn 失败」分开报告**：前者文案取 `exitReason`，后者取协议 error 的 message；两者都只报一次 error（`errorSurfaced` 闸门），并都只发一个非零 `complete`。
8. **`runSettled` 有三个释放源**：turn 终态通知、abort、子进程 `exit`。少任何一个都会让 run 挂到超时——方案 §5.2/§5.3 未写这一条，属实施补全。

**与方案的偏离 / 方案未列的真机事实**

| # | 方案原话 | 实施 | 理由 |
| --- | --- | --- | --- |
| 1 | §5.3.1 的 item 表 | **增列 `userMessage`**（显式不渲染） | 真机才有（附录 A.1）；不排除会画幻影卡，且已被真机抓到一次 |
| 2 | §5.5 方案二只说「逐字相同 ⇒ 丢弃终帧」 | 同意，但 **text 与 thinking 两个通道都要记 `streamed`** | 方案只写了 agentMessage 一个通道；reasoning 不记会双渲染 |
| 3 | §5.2/§5.3 未提 `runSettled` 的释放源 | 三源（终态通知 / abort / exit） | 见决策 8 |

**门禁（全部达成）**

| 判据 | 结果 |
| --- | --- |
| §8.2 真 CLI 端到端五条 | **5/5 通过**（逐条证据见下节） |
| `codex-runtime.test.ts` 重写后 | **12/12 通过** |
| codex 四个测试文件（client 7 + events 24 + normalize 12 + runtime 12） | **55/55 通过**（HEAD 版只有 `codex-runtime.test.ts` 2 条 ⇒ 本面净 +53） |
| `npm run typecheck` | exit 0（client + `server/tsconfig.json`） |
| `npm run lint` | **0 errors / 163 warnings**（全仓数与 S1/S2 相同，**改动文件零命中**） |
| `npm run build` | 成功（`build:client` + `build:server` + `promote-dist-server`） |
| `test:client` | **178 文件 / 1445 用例全绿**；本片两个前端文件 **25**（17 + 8）vs HEAD **24**（17 + 7）⇒ 增量恰为新增的那 1 条 dsh 断言 |
| `npm test` 名字集 A/B | **零新增红**。本片动了 `server/`，故老实做 A/B（HEAD `1ce2c51b` 干净 worktree + `node_modules` 软链，**worktree 必须落在非 temp 目录**——`/tmp` 会让仓库路径本身落进只读根、产出 3 条与 codex 无关的假红）：工作区与 HEAD 的 `not ok` 名字集**逐字节相同**（10 条，全是既有的环境项：3 条 workbuddy getStatus、4 条 `resolveClaudeCodeExecutablePath`、`spawnOpenCode`、`synchronizer`×2）。**绝对项数照旧不可当基线**：同一棵树连跑三次读到 1172 / 1177 / 1172（HEAD 侧 1136），故本片与 §15 一样**只比名字集**，不拿 1136+S1+S2+S3 去凑总数 |

**§8.2 真 CLI 端到端五条（含浏览器实读）**

验收对象是本机 `@openai/codex` **0.156.1**（已登录）＋ 真实 CloudCLI 服务（另起 3099 端口实例，避免打扰 3011 上的常驻服务）。

| # | 方案要求 | 结果 | 证据 |
| --- | --- | --- | --- |
| 1 | 正文逐段增长 | ✅ | 浏览器实时轮询最后一条 `.chat-message` 的文本长度，读到 **18 个不同长度、严格单调**（`96 → 3193`）；runtime 级探针同样见到 55 帧累计长度严格单调。**判据用「单调变长」，不用「连续 N 帧不变」**（§8.2 的量化步长提醒） |
| 2 | 工具卡与命令输出渐进 | ✅ | 真机抓证 `item/started`(commandExecution) → `outputDelta("step-2\n")` → `outputDelta("step-3\n")` → `item/completed`；我们的行内容 `7 → 14 → 14`，与 `aggregatedOutput` **逐字一致**（`step-1` 是 CLI 自己没发）。浏览器截图见「执行中 · 1 次工具调用」→「执行过程 · 1 次工具调用」。**排查记录见下** |
| 3 | turn 结束与 rollout 终态一致 | ✅ | 两条不同 prompt 的 run，规范化文本与 rollout 最终 assistant 消息比对 `final text matches rollout = true` |
| 4 | 刷新一致 | ✅ | 剥离 `MD`/时间戳徽标后比对刷新前后，`sameCount / sameLast / sameAll = true`，长度同为 3193 |
| 5 | abort 无残留无并行行 | ✅（服务端 + 单测，**未截 UI 侧图**） | `abort -> true`；runtime 只发 `session_created`、**不发 `complete`**（单测也断言 `turn/interrupt` 已发出且 `complete` 数为 0）；前后进程快照均为同 2 条预先存在的全局 codex 进程，**本 run 启的进程无残留**。UI 侧的「中止后界面无并行行」本轮未单独截图，如实记为只覆盖到服务端契约与单测 |

**第 2 条排查到了一张幻影卡（值得记）**：第一次浏览器读数显示「执行过程 · **2** 次工具调用」，而 runtime 级探针在同类回合只记录到 1 张 `Bash` 卡。对照时间戳发现：跑验收用的 3099 实例是 **14:37 的构建**，而 `userMessage` 的修复在 **14:41** 才写进源码——那第 2 张正是 `userMessage` 幻影卡（rollout 里只有 1 个 `exec_command`）。重新 `npm run build` 后用同一实例复验，同一个回合变成「**· 1 次工具调用**」、展开只有 `Bash ×1`。**结论：任何「构建产物早于最后一处修复」的验收读数都不作数**（前端那侧另有对照：`revealPacer.ts` 的改动 14:31 早于 14:37，故 #1/#4 的旧读数仍有效，之后也在新构建上复跑了一遍取到干净读数）。

**U2 / U5 / U8 / U9 / U10 的真机收口**

- **U8**（`thread/start.config` vs 进程级 `-c`）：本片按 §5.4 的裁定把 profile 产物作为线程级 `config` 下发（`resolveCodexConfigOverrides` 复用既有 `codex-config.ts`），真机 turn 正常完成。**未做**「同 profile 两通道产物对照」这一条——现有 profile 里没有影响握手/启动的键，故残留风险低，但如实记为**未逐字节对照**。
- **U9**（`memoryCitation`）：真机 `agentMessage` 的字段集是 `{type,id,text,phase,memoryCitation,delivery,questions}`，本轮 `memoryCitation` 为 **`null`**、`text` 不含 `<oai-mem-citation>` 标记。⇒ 本机无引用场景，**「是否会被剥离」仍未证实**；影响面同 U7（发生率可能是 0）。未新增映射（不猜）。
- **U10**（`plan` item）：真机（含明确要求出计划的 prompt）**`plan` item 出现 0 次**，正文也没出现计划信封。⇒ 与 U7 同族，**本机未触发**；映射器仍按 §16 决策 3 显式不渲染，**未新增 `plan` → `ExitPlanMode` 映射**（无证据，不造能力）。
- **U5**（反向请求）：一轮完整 turn 内 ServerRequest **0 条**（`requestAttestation:false` 下 attestation 不出现；`chatgptAuthTokens/refresh` 未触发）。✅ 收口。
- **U2**（`experimentalApi`）：`experimentalApi:false` 下 `initialize` 成功、turn 正常完成。✅ 收口。

**两条实施期才浮出的坑**

1. **abort 用例的假失败（mock 的日志顺序）**：客户端收到 `turn/interrupt` 的应答后立即 SIGTERM 子进程，而 Node 对 SIGTERM 的默认处置会**在 mock 的 `respond()` 与 `logRequest()` 之间**终止进程——应答已进管道、日志尚未落盘，于是「请求日志里没有 `turn/interrupt`」被误读成「客户端没发」。修法是**先 `logRequest` 再 `respond`**（`appendFileSync` 是同步的，顺序决定一切）。**判据：造假的被测端要把「可观测的副作用」排在「触发对方杀我」的动作之前。**
2. **resume 用例挂 6 分钟**：mock 发固定 `threadId`，而 resume 时客户端用的 id 不同 ⇒ `isCodexNotificationForActiveTurn` 把 `turn/completed` 丢掉 ⇒ `runSettled` 永不 resolve。修法是 mock 的 `activeThreadId` 跟随客户端在 `thread/resume` 里给的 id。**判据：假服务端要跟着客户端驱动的那条链走，不能自己钉死一个常量。**

**未做（属后续片）**：删 `@openai/codex-sdk`（package.json + lock）与回写 `流式输出体验优化技术方案.md` §11 属 **S5**。§5.12 那一类「不阻塞的可选待定项」本片未开出。

**遗留的可做未做账**（无阻塞，如实登记）：U8 的两通道产物逐字节对照、U9 的「有引用场景」实测、U10 的计划模式实测——三者都需要本机出现对应场景才能取到证据，本片以「未触发 ⇒ 不猜测、不造能力」处置。

---

## 18. 实施记录：S5 删依赖与流式线文档回写（2026-10-07）

**状态**：✅ 完成。**本线至此全部收官**——待拍板清单为空、无遗留片。

**改了哪些文件**

| 文件 | 变更 |
| --- | --- |
| `package.json` | 删 `"@openai/codex-sdk": "^0.156.0"`。**`@openai/codex`: `0.156.1` 保留**——app-server 是它提供的子命令 |
| `package-lock.json` | `npm install` 重算，输出 `removed 1 package`；`grep codex-sdk` 在 lock 与 `node_modules/@openai/` 下**均为空**，只剩 `@openai/codex` 与 `@openai/codex-darwin-arm64` |
| `codex-app-server.client.ts` | **头部注释订正（纯注释，产物零差异）**：原句「The `@openai/codex-sdk` **this app runs conversations through** is a wrapper around `codex exec`」在删依赖后失实，改为说明 exec/SDK 这条通道**本应用已不再依赖**，同时保留「`codex exec` 没有 `thread/fork`、app-server 才有」这个设立本文件的原委 |
| `.agents/skills/codex-compat-check/check-codex-format.mjs` | **依赖被删后的连带订正**：该脚本的版本报告段读的是 `package.json` 的 `@openai/codex-sdk`（删后恒为 `undefined`、该行走 `if (info.sdk)` 静默不打印）⇒ 改读 **`@openai/codex`** 并把标签改为「项目 @openai/codex」。**这是删依赖造成的唯一仓库级连带点**（`grep -rn codex-sdk` 全仓只有它在读该键） |
| `docs/research/CloudCLI的Provider架构分析.md` | §4.1 的 runtime 风格表：codex 原列在「**SDK 直连**」（`@openai/codex-sdk` 的 `thread.runStreamed()`），改为新增一行「**子进程 + JSON-RPC**」；小节标题「三种实现风格」相应改为「四种」 |
| `docs/research/流式输出体验优化技术方案.md` | 见下表 |

**流式线文档的回写清单**（本片门禁要求「三处交叉引用口径一致」）

| 位置 | 改动 |
| --- | --- |
| §0 结论先行（2 处） | 「Codex/DSH 正文整段到达」→ 只留 DSH；10-03 增补段追加 10-07 更新 |
| §1.3 现状表 Codex 行 | 整行划掉并标「已消除」，后果列改为「均已消除」 |
| §2.3 第 2 条非目标 | **刻意未改**，理由见下 |
| §3 路线 E 行 | 加「2026-10-07：Codex 换 app-server 后退出该集合，本条现只服务 DSH」 |
| §7 阶段 4 | 加补充：机制不变、能力分派收窄、**属纯减法无需新实施步骤** |
| §11 节首注 | 新增 2026-10-07 二次修订段 |
| §11.1 第 1 条 | 就地改判为「只对**已废弃的** `codex exec` 通道成立」 |
| §11.5 方案三行 | 「不建议」→「**✅ 已实施**」，并逐条回应原判断的两个理由（成本判断已收敛 / 分裂的是通道而非机制） |
| §11.6 实施记录 | 追加「**补记（2026-10-07，Codex 退出本机制）**」：10-03 的记录逐条仍有效、机制未回退；能力分派表收窄；**R3 前移的理由**（先切通道后摘 provider 会出现「重播」）；测试改判的形态；§11.7 三项状态 |
| §11.7 三项附带缺口 | 逐条加 ✅（1、2 已于 10-03 落地；3 于 10-07 随代码路径整体替换而消灭） |
| §11.9 尾部 | 加附注：70.6% 是 **Codex + 未接桥接的 DSH** 合计口径；Codex 退出后**收窄为 DSH 单独口径**（DSH 本机样本为 0）——方向性判断仍成立，但**具体数字不可再当 DSH 的收益面** |
| **新增 §11.10** | 「改判：Codex 换 app-server（2026-10-07）」——结论、与原判断的两处对照表、落地要点、对本文档的净影响（并明说 §4/§5/§6/§7 不受影响，因为改的是「谁产生 delta」而不是「delta 怎么被批处理」） |

**为什么 §2.3 第 2 条非目标不改**：它的例外范围写的是「§11 所述『整段到达』的 Provider」而**不点名 Codex**，DSH 仍满足该条件，措辞继续成立。若改成点名只有 DSH，等于把这个**能力判定**写死进非目标——将来某 provider 再接桥接时要再改一次。**判据：能靠定义维持一致的表述，不要改成枚举。**

**门禁（全部达成）**

| 判据 | 结果 |
| --- | --- |
| `npm test` 名字集 A/B | **零新增红**。本片动了 `server/`（一行注释）与依赖清单，故老实 A/B，基线＝S3 收口时的失败名集（10 条，已逐字记录在 §17）。**两次全量跑的读数**：第 1 次 **11 条 = 那 10 条 ∪ {`workbuddy run closes one-shot stdin so a completed CLI can emit its terminal result`}**，第 2 次 **10 条、与 S3 基线逐字节相同**——多出来那条正是 §15/§16 早已登记的**环境间歇项**（单跑 `workbuddy-runtime.test.ts` **3/3 次 41/41 全绿**，只在全量并发时偶发）。故两次都**没有 codex 相关红、没有本片引入的红**；总数 1177 / 1166 通过 / 10 失败 / 1 跳过，与 §17 同一漂移区 |
| `test:client` | **178 文件 / 1445 用例全绿**（与 S3 逐位相同——本片未动 `src/`） |
| `npm run typecheck` | exit 0（含 `server/tsconfig.json`） |
| `npm run lint` | **0 errors / 163 warnings**（改动文件零命中） |
| `npm run build` | 成功（`build:client` + `build:server` + `promote-dist-server`） |
| 依赖残留核对 | `package.json` / `package-lock.json` / `node_modules/@openai/` / `server` / `src` / `tests` 六处 `codex-sdk` **零命中**（仅原注释，已订正） |

**顺带订正的一处方案级失实**：§6.3 原表列的两个新文件名与实际不符（预测 `codex-mock-app-server.mjs` / `codex-app-server-connection.test.ts`，实际 `fixtures/codex-app-server-mock.mjs` / `codex-app-server-client.test.ts`，另多出 `codex-app-server-events.test.ts` 与 `codex-stream-normalize.test.ts`，且 `codex-runtime.test.ts` 是**重写**而非新增）——已在 §6.3 加注实际名并指向 §15/§16，§6.4 的删除行标记为已执行。

**可做未做（本片不涉及、如实续记）**：U8 的两通道产物逐字节对照、U9 的「有引用场景」实测、U10 的计划模式实测——三者都等本机出现对应场景；DSH 的 ACP 桥接改造仍属高成本备选，未启动。
