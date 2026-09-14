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
| OpenCode | 三项能力全部补齐 | 更换 OpenCode 的完整实时流式运行架构 |
| Pi | 第一阶段仅侧边栏完整会话 Fork | 指定消息 Fork、编辑历史消息，待原生 RPC/SDK 验证后另立方案 |

### 1.1 关键决策

- 不以“把历史消息拼进新 prompt”冒充 Fork。子会话必须由 provider 原生会话机制或其正式、可验证的持久化格式生成，并可被 provider 正常续跑。
- “编辑”统一遵循现有 Claude/Codex 语义：**编辑的用户消息和其后内容不再是当前活跃会话的一部分**；不物理删除原始 artifact。
- Fork 仅对已结束、已落盘、可恢复的会话开放；正在处理的会话继续隐藏入口。
- 聊天内操作仅对有稳定 provider 锚点的普通文本消息展示；不向思考、工具调用、工具结果或仅附件行展示。

## 2. 共同契约与复用点

当前共享契约已可承载三类能力，无需引入第二套前端协议：

- `IProviderFork.forkSession({ providerSessionId, jsonlPath, projectPath, upToAnchorId })`：侧边栏与聊天 Fork 共用。
- `IProviderSessions.resolveEditAnchor()`：把“被编辑消息”映射为最后保留的 provider 锚点。
- `IProviderSessions.rewindSession()`：当 provider 不支持原地续跑时，创建前缀副本并把**原 CloudCLI session row**重定向到副本。
- 后端能力矩阵的 `supportsMessageEditing` 与 `supportsSessionForking` 是前端唯一的显示开关；不在 React 中判断 provider id。

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
   - 返回它前一条**可作为完整对话边界**的 event id；
   - 第一条用户消息返回 `{ found: true, resumeThroughId: null }`；锚点不存在返回 `found: false`。
2. 在同一 sessions provider 实现 `rewindSession(sessionId, keepThroughId)`：
   - `keepThroughId === null` 时，沿用现有 scratch-edit 语义：把旧 provider session 标为 superseded，解除 app session 的 provider 绑定；下一次发送创建新会话。
   - 否则调用一个仅供 WorkBuddy provider 内部使用的前缀复制 helper，生成新 transcript 和新 provider session id。
   - 调用现有 `sessionsDb.markProviderSessionSuperseded()` 与 `repointSessionToProviderSession()`，使原 CloudCLI 会话 id 不变、后续 `--resume` 指向新副本。
3. 把 WorkBuddy 能力矩阵的 `supportsMessageEditing` 改为 `true`。
4. 历史归一化继续给用户文本设置 `transcriptAnchorId`；不向非文本 event 设置它。

### 3.3 边界与风险控制

- 不能简单取“数组中前一行”：一条 turn 若被拆为多个 event，必须在 fixture 中覆盖 user/assistant/tool 交错形态，确保截断后父链完整。
- 与现有 Fork 一样，先写入临时文件、验证文件存在和可解析，再重定向数据库记录；失败时绝不能提前改变原会话。
- 不复用 `IProviderFork` 作为跨 provider service 的反向依赖；将 JSONL 前缀复制的私有 helper 下沉到 WorkBuddy provider 文件，避免 provider sessions facet 依赖 registry/service。

### 3.4 测试与验收

- `resolveEditAnchor`：首条、中间、末条用户消息、未知 id、带 tool event 的多 turn transcript。
- `rewindSession`：副本只保留目标前缀；新文件中每行 sessionId 已改写；原 session row 被重定向；原 transcript 被记录为 superseded。
- WebSocket：编辑中间用户消息后，客户端先收到 `history_truncated`，再显示替换 prompt；刷新页面后不再展示被舍弃的尾部。
- 回归：WorkBuddy 聊天内 Fork 和侧边栏 Fork 仍创建独立 app session，不影响原会话。

## 4. OpenCode：用官方 Session API 支持完整能力集

### 4.1 依据与前提

OpenCode SDK 已公开 `POST /session/{id}/fork`，语义是“从特定消息 Fork”；这满足聊天内 Fork 的核心需求。CloudCLI 当前以 `opencode run --session` 运行、直接读取 `opencode.db` 历史，因此不能直接假设 CLI 子进程已经暴露 HTTP 服务。

**实施前置验证（必须先完成，不通过则停止，不写入能力矩阵）**：

1. 确认当前受支持 OpenCode 版本可启动/发现本地 server，且能以当前 workspace 和认证上下文调用 Session API。
2. 在临时 workspace 创建多轮会话，使用指定 user message 和 assistant message 分别 fork；确认子会话在 `opencode run --session <child>` 下可正常续跑，且原会话不变。
3. 验证 API fork 参数的精确字段、响应中的子 session id、消息 id 类型，以及完整会话 Fork 的 endpoint 参数。
4. 验证本地 server 与已有 `opencode run` 并存时，不会争抢数据库锁、重置模型/权限设置或泄漏到另一个 workspace。

若上游 server 只能依赖不稳定的内部 CLI 启动方式，本方案降级为“不实现”，不改写 SQLite 数据库。

### 4.2 适配设计

新增一个 provider 内部的 `OpenCodeSessionClient`（名称可按现有文件风格调整），其唯一职责是：

- 确保/获取当前 workspace 的本地 OpenCode API endpoint；
- 请求 session fork；
- 将 HTTP 错误转成可处理的 `AppError`；
- 不承担实时聊天事件转换，也不读写 SQLite。

具体改动：

1. `opencode-sessions.provider.ts`
   - 历史 `message` 行的用户文本设置 `transcriptAnchorId = message_id`；普通 user/assistant text 设置 `forkAnchorId = message_id`。
   - 实现 `resolveEditAnchor()`：按当前会话的有序、可见普通文本消息定位 anchor，返回前一条可用于 API fork 的 message id；第一条返回 `null`。
   - 实现 `rewindSession()`：调用 OpenCode fork，随后标记旧 provider session superseded，并将 app session 重定向到新 provider session。`null` 走既有 scratch-edit。
2. `opencode-fork.provider.ts`
   - 实现 `IProviderFork`，调用 `OpenCodeSessionClient.fork`。
   - `upToAnchorId` 存在时传指定 message id；省略时按上游已验证的“完整 session”语义调用。
   - 返回新 provider session id。OpenCode 使用 SQLite 作为历史来源，`jsonlPath` 对此 provider 允许为 `null`；需先把共享 `IProviderFork`/`sessionsService` 的“必须有 jsonl_path”前置条件改为 provider 能声明的 artifact-ready 检查，而非对所有 provider 强制 JSONL。
3. `opencode.provider.ts` 注册 `readonly fork`，能力矩阵的两个 bool 都置为 `true`。
4. `sessions.service.ts`
   - 将 fork 前的 `!source.jsonl_path` 校验改为“provider fork 所需 source artifact 是否就绪”。最小实现是把 `jsonlPath` 改为可选，并仅由 Claude/Codex/WorkBuddy 校验；更稳妥的实现是在 `IProviderFork` 增加 `assertForkableSource()`，由各 provider 自己验证。审阅后择一，禁止在 service 中写 `provider === 'opencode'` 特判。

### 4.3 编辑和 Fork 的语义

| 操作 | OpenCode provider 调用 | CloudCLI 会话结果 |
| --- | --- | --- |
| 侧边栏 Fork | fork 完整会话 | 新 app session，原会话不变 |
| 聊天内 Fork | fork 到选中消息 | 新 app session，原会话不变 |
| 编辑历史用户消息 | fork 到该用户消息之前的 message，再发送替换内容 | 原 app session 被重定向到 fork；旧 OpenCode session superseded |

### 4.4 测试与验收

- client contract tests：请求路径、认证/endpoint 发现失败、4xx/5xx 映射、响应 schema 验证。
- sessions tests：消息锚点稳定性、分页时锚点不丢失、编辑保留点正确。
- fork provider tests：完整 Fork、指定消息 Fork、子 session id 未返回、source artifact 不就绪。
- 集成 smoke（真实临时 workspace）：三类操作后分别用 `opencode run --session` 发送 follow-up；验证上下文前缀正确、原会话不变、CloudCLI 刷新后仍能读取子会话。

## 5. Pi：第一阶段只实现完整会话 Fork

### 5.1 选择这个切面

本机 Pi 0.85.1 的 CLI 已提供 `pi --fork <path|id>`；它会创建新的可恢复 session 文件。该能力直接对应侧边栏完整会话 Fork，且不需修改 Pi 的树状 JSONL。

Pi 的“指定历史消息 Fork”虽有潜力，但 `--fork` 不接收 entry id 边界。交互式 `/fork` 可以从活跃分支中的既往**用户消息**选择位置；CloudCLI 的一次性 JSON runtime 不应模拟 TUI，也不应自行裁剪/伪造含 compaction 的 JSONL。因此本阶段明确不开放聊天内 Fork 和编辑。

### 5.2 实施前置验证

在使用隔离 `PI_CODING_AGENT_SESSION_DIR` 的临时目录内完成：

1. 从至少两轮、含工具调用和 compaction 的源 session 执行 `pi --mode json --fork <source-id> -p <最小验证提示>`；确认 stdout 给出**新** session header id。
2. 确认子文件位于 Pi sessions root、header id 与事件 id 一致，且后续 `pi --session <child-id>` 能恢复完整上下文。
3. 验证 `--fork` 是否要求 prompt；若支持仅创建，优先使用无模型调用的创建方式。若不支持，Fork 实现不得通过额外模型请求制造不可见对话；应改用 Pi 的 RPC/SDK 创建会话，或推迟功能。
4. 验证源 session 的 cwd 和 `--session-dir` 被正确继承；不接受把子会话写到 CloudCLI server 当前目录。

### 5.3 实现设计

1. 新建 `pi-fork.provider.ts` 并实现 `IProviderFork`。
2. 使用与 `pi-runtime.provider.ts` 一致的命令解析和 child-process 生命周期规范；不得把 fork 逻辑塞进 runtime。
3. 启动 Pi 的原生 fork 命令，逐行解析 JSON mode 的 session header，获取 child provider session id；完成后通过 `resolvePiTranscriptPath()` 找到新 JSONL 文件并验证 header。
4. `PiProvider` 注册 `readonly fork`；能力矩阵仅将 `supportsSessionForking` 改为 `true`，`supportsMessageEditing` 保持 `false`。
5. 由于当前公共 `forkSessionById()` 假设有 `jsonl_path`，与 OpenCode 的通用改造一起将前置校验下沉到 provider；Pi provider 在自身验证 source `jsonlPath` 和 child artifact。

### 5.4 第二阶段的明确门槛（不在本方案实施）

聊天内 Fork/编辑仅在以下任一条件满足后再立项：

- Pi RPC 明确提供“从 entry id fork/选择 branch leaf”的非交互方法；或
- `@earendil-works/pi-coding-agent` SDK 提供稳定、公开的 SessionManager fork API，且能正确处理 v3 compaction、branch summary、模型和 thinking 设置。

届时的推荐语义是：聊天 Fork 创建独立 JSONL；编辑从被编辑用户 entry 的父 entry 创建独立分支/会话后发送替换 prompt。绝不截断原文件或手写 Pi entry。

### 5.5 测试与验收

- fork provider unit tests：命令参数（source id、cwd、session root）、无 header、子文件缺失、子 header id 不符、进程失败。
- 真实 smoke：完整会话 Fork 后在子会话发送 follow-up，验证模型能看到源会话的末尾上下文；原会话继续发送时不出现子会话内容。
- UI：Pi 空/未落盘会话、运行中会话均不显示侧边栏 Fork；已完成会话显示且点击后导航至新会话。

## 6. 实施顺序与提交边界

为便于回滚和审阅，按三个独立变更交付：

1. **WorkBuddy 编辑**：后端 sessions/fork helper、能力矩阵、单测与 WebSocket 回归。
2. **Pi 完整会话 Fork**：先完成 §5.2 实测记录；通过后再新增 provider fork facet、能力矩阵和测试。
3. **OpenCode 全能力**：先完成 §4.1 compatibility spike；只有真实 OpenCode server fork smoke 通过，才进入正式适配与 UI 开关。

任何一个 provider 的前置验证失败，都不阻塞其他 provider 的独立交付。

## 7. 非目标与回退策略

- 不增加“fork 后自动发送新 prompt”的 UX；Fork 只创建并打开会话，用户自行继续。
- 不支持跨 provider Fork。
- 不尝试修复或迁移历史上未锚定的消息；此类消息不显示操作入口。
- provider 升级导致 fork contract 不兼容时，能力矩阵应临时关闭对应入口，保留历史只读与普通续跑能力。

## 8. 审阅批注

<!-- 审阅者请从此处开始追加，勿修改正文。 -->
