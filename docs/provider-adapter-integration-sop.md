# CloudCLI Provider 接入与验收 SOP

> 用途：用于 WorkBuddy 当前补齐，也用于后续接入新的 AI Provider。
>
> 维护方式：这是一个可持续更新的执行清单。每完成一项，立即把对应的 `[ ]` 改为 `[x]`，并在“证据记录”中填写文件、测试命令、输出或截图。不要只修改勾选状态，不要把未验证的内容标记为完成。

## 0. 新会话续接说明

新会话开始时，AI 必须先执行以下动作：

1. 读取项目根目录的 `AGENTS.md`；如果不存在，再读取 `CLAUDE.md`。
2. 读取本 SOP，先查看“当前进度”和“最近一次交接记录”。
3. 查看 Git 状态和当前分支，保留用户已有的未提交修改。
4. 只处理当前交接记录中明确指定的任务，不擅自扩大范围。
5. 开始工作前先检查依赖文件、相关测试和上一次留下的证据。
6. 每完成一个独立任务就更新本文件，并记录验证结果。
7. 如果发现任务无法安全完成，记录阻塞原因和需要用户决定的事项，不要伪造完成状态。

### 状态约定

- `[x]` 已完成，并且有代码或测试证据。
- `[ ]` 未完成，或尚未验证。
- `部分完成` 表示代码存在但仍有边界风险，不能视为完成。
- `不适用` 必须写明原因，不能静默跳过。

### 执行约束

- 所有回复使用中文，并称呼用户为“亮”。
- 后端代码位于 `server/` 时，必须遵循 `.agents/skills/backend-module-standards/SKILL.md`。
- Provider 适配验证遵循 `.agents/skills/provider-adapter-verification/SKILL.md`。
- 不要为了验证而修改、删除或覆盖用户无关的改动。
- 不要把普通文本计划伪装成结构化 Todo/Task。
- Provider 不支持某项能力时，必须显式返回 `unsupported` 或在能力矩阵中标明，不得静默回退到 Claude/Codex 的解析逻辑。
- 未经用户明确要求，不自动提交代码。

## 1. 当前项目上下文

### 1.1 当前目标

补齐 WorkBuddy 的 Provider 接入，使它不仅能完成普通对话，还能正确处理实时任务、工具生命周期、取消流程、Session、前端展示和不支持能力的边界。

### 1.2 当前判断

WorkBuddy 的基础接入已经存在，以下部分已在代码中找到：

- Provider Registry
- Runtime、模型、认证、Session
- Session Watcher
- MCP、Skills
- Agent API、Shell WebSocket
- 前端 Provider 配置和基础渲染
- WorkBuddy 相关单元测试

### 当前进度（2026-08-29）

已完成：

- WorkBuddy Task 生命周期事件的 Runtime/历史记录适配
- WorkBuddy 官方 interrupt 控制请求和子进程收尾
- WorkBuddy Token Usage 的明确 unsupported 边界
- WorkBuddy 真实 `TaskCreate/TaskUpdate` 返回的 `rawResponse.todos` 到统一 `TodoList` 快照适配
- WorkBuddy/Codex 历史任务快照去重和 realtime 同 ID 快照覆盖
- 停止类工具状态到前端 `stopped` 状态的映射
- WorkBuddy 工具结果的拒绝、取消、停止状态向前端透传
- WorkBuddy Session 首次全量回填、后续增量扫描，以及分页历史的有界流式收集
- Provider README、公开 API 文档、Agent API 注释中的 WorkBuddy/DSH 信息同步

仍不能视为完成：

- Runtime 到 WebSocket 到前端 Task/Tool 的完整链路验证
- 全 Provider 范围的稳定消息 ID 和完整工具终态验证
- MCP 敏感数据从 Tool Result、Session 持久化到 WebSocket 的全链路样本验证
- MCP 外部进程并发替换和跨平台矩阵验证

当前部署边界：CloudCLI 按单用户本地实例使用；多用户远程隔离不在当前范围内，W-013 已记录为“不适用”。

### 最近一次交接记录（2026-08-28）

- 已确认本机 WorkBuddy 桌面端内置 CLI：`/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy`，版本 `2.115.0`。
- 真实 CLI 烟测确认：任务工具结果位于 `message.content[].type=tool_result`，任务列表位于 `tool_result._meta.rawResponse.todos`；真实输出不一定产生 `system/task_*` 事件。
- 已执行：前端 51 项测试、服务端全量 386 项测试、类型检查、前后端构建、针对性 ESLint，均通过。
- 已执行：真实 CLI 的普通文本和 `TaskCreate → TaskUpdate` 烟测，均正常退出。
- 已补充 Runtime 异常矩阵：失败 Task、未知事件与非法 JSON、CLI 非零退出、工具拒绝结果；主动取消已有 interruptible 测试。
- 已补充 W-010 结构化诊断：未知事件、非法 JSON、stderr 和异常退出均记录 Provider/Session 等上下文，stderr 诊断做脱敏和长度限制。
- 已补充 W-011/W-012 的安全回归：WorkBuddy MCP 拒绝配置/父目录符号链接；公共 MCP 列表出口统一脱敏 `env`、`headers`、`envHttpHeaders`。
- 已补充 W-009：WorkBuddy 默认 1 小时绝对运行超时，支持 `WORKBUDDY_RUN_TIMEOUT_MS` 调整，超时后 SIGTERM/SIGKILL 收尾并发送失败终态。
- W-009 回归补充：超时原因同时作为统一 `error` 消息发送到前端，并忽略超时后迟到的 `result`，避免失败状态被覆盖。
- 已补充 W-005 的 Session Store 纯逻辑回归和 WebSocket 异常链路回归：验证 TodoList 终态覆盖旧历史快照、Task 生命周期同 ID 合并、工具传输 ID 变化时仍只保留一行，并验证工具失败/Task failed/error/complete、主动 abort/complete(aborted) 的统一事件顺序和 seq。
- 已复核 W-011/W-012：未注册工作区、项目/父目录/配置符号链接和 MCP 敏感字段返回均有回归覆盖；全仓 ESLint 0 错误，但存在 193 条既有警告，未纳入本次改动。
- 当前下一步：完成可自动化的全量验证；W-002/W-005 仍需要可用浏览器实例做真实 UI 验收，W-011 仍需要并发替换和跨平台矩阵，W-013 仍受当前单用户数据模型限制。

## 2. WorkBuddy 当前收尾清单

这一节是当前优先执行区。除非另有说明，按顺序推进。

### P0：协议和用户可见行为

- [x] **W-001 接入 Task 生命周期事件**

  目标：在 `workbuddy-runtime.provider.ts` 中识别并转换：

  - `system/task_started`
  - `system/task_progress`
  - `system/task_updated`
  - `system/task_notification`

  验收：任务开始、进度、完成、失败、停止、终止原因都能进入 CloudCLI 统一结构；未知事件不会中断会话。

  证据：`workbuddy-runtime.test.ts`、`workbuddy-sessions.test.ts` 已覆盖实时和历史 Task 事件，并验证同一任务使用稳定 ID。

- [ ] **W-002 保证任务终态能够落到前端**

  目标：检查 Task/Tool 状态从运行中进入 `completed`、`failed`、`stopped`、`cancelled` 或 `denied` 等终态。

  验收：不会出现任务已结束但界面仍然显示 `Running` 的情况；同一个任务只显示一条记录。

  当前进展：已完成代码级状态映射、同 ID 快照覆盖和前端 `stopped` 回归测试；仍缺浏览器 WebSocket、Session Store 和实际界面截图/录屏验证，因此暂不勾选。

- [x] **W-003 按官方协议实现中断和优雅收尾**

  目标：使用 `control_request` 的 `interrupt` 机制取消任务，并继续读取确认和终止事件，不直接把关闭 stdin 当作唯一取消协议。

  验收：取消后能收到可识别的停止终态；不会留下孤儿进程、永久 Running 状态或错误的下一次任务冲突。

  参考：

  - [CodeBuddy CLI 命令参考](https://cloud.tencent.com/document/product/1831/137026)
  - [CodeBuddy Workflow 状态协议](https://cloud.tencent.com/document/product/1831/137043)

  证据：`workbuddy-runtime.test.ts` 的 interruptible mock 验证 `control_request/interrupt`、`task_notification(stopped)` 和 aborted complete。

- [x] **W-004 修复 Token Usage 能力边界**

  目标：WorkBuddy 不支持 Token Usage 时，服务端返回明确的 `unsupported`，前端不展示错误的 Claude Token 数据。

  验收：选中 WorkBuddy Session 不会触发错误解析；API 返回结构明确、前端行为稳定。

  证据：`provider-token-usage.service.test.ts` 验证 WorkBuddy 返回 `unsupported: true`；`TokenUsageSummary.tsx` 不再渲染不支持能力的 0 tokens 按钮。

- [ ] **W-005 增加 Runtime → WebSocket → 前端的集成测试**

  至少覆盖：

  - 普通文本
  - 工具开始、更新、成功
  - 工具失败、拒绝、取消
  - Task 开始、进度、完成、失败、停止
  - 未知事件
  - 非法 JSON
  - CLI 异常退出
  - 用户主动取消

  验收：测试验证统一消息、Session Store 和最终渲染状态，而不是只验证 Runtime 内部函数。

  当前进展：已增加 `server/modules/websocket/tests/chat-websocket.service.test.ts`，验证 `chat.send → ChatSessionWriter → WebSocket` 的 WorkBuddy TodoList、complete、工具失败/Task failed/error/complete 异常链路，以及主动 abort 转换为单个 `complete(aborted)`；前端映射另有 `useChatMessages.test.ts`；`src/stores/sessionMessageMerge.test.ts` 验证 Session Store 对同 ID Todo/Task/工具快照的终态覆盖与去重。Runtime 层已补充失败 Task、未知事件/非法 JSON、CLI 非零退出、工具拒绝结果和主动取消测试，但 Session Store 实际 Hook 接入和实际前端状态仍未完整覆盖，因此暂不勾选。当前浏览器控制环境无可用实例，真实 UI 验收需要在本机打开 CloudCLI 后执行。

### P1：消息、工具和进程可靠性

- [x] **W-006 保留稳定消息和任务 ID**

  目标：优先使用 WorkBuddy 的 `uuid`、`message.id`、`session_id`、`task_id`、`tool_use_id`；没有原始 ID 时使用可重复生成的稳定 ID。

  验收：同一 Session 重载、同步、实时更新后不会产生重复消息。

  证据：WorkBuddy 的 `task_id`、`message.id`、`function_call.callId`、`tool_use.id`、会话级 `TodoList` ID，以及 Codex 原生 item ID 均已接入；历史快照会合并，realtime 同 ID 快照会覆盖旧历史。`workbuddy-runtime.test.ts`、`workbuddy-sessions.test.ts`、`codex-sessions.test.ts` 和 `sessionMessageMerge.test.ts` 覆盖工具、Task/Todo、历史分页和实时重载去重。

- [x] **W-007 完善工具结果转换**

  目标：展开文本块数组，保留结构化结果，并区分成功、失败、拒绝、取消、停止。

  验收：工具输出可读；拒绝和取消不会被一律显示成普通错误。

  证据：WorkBuddy 已支持文本块数组提取、`rawResponse.todos` 转 TodoList，以及成功、失败、拒绝、取消、停止状态；工具结果的 `status` 会透传到前端，`cancelled/canceled/stopped/killed` 映射为 `stopped`，`denied` 保留为 `denied`。`workbuddy-runtime.test.ts`、`workbuddy-sessions.test.ts` 和 `useChatMessages.test.ts` 已覆盖这些分支。

- [x] **W-008 修复进程清理竞态**

  目标：统一 `complete`、子进程 `close`、取消和异常退出的清理时机。

  验收：上一个任务刚结束时立即发起下一个任务，不会误报“已有运行中的任务”。

  证据：`workbuddy-runtime.test.ts` 覆盖正常 close、异常退出、用户中断、并发运行和下一次运行；`chat-run-registry.test.ts` 覆盖重复 complete、下一次运行和延迟 safety-net 不误终止新任务。

- [x] **W-009 增加超时和无输出保护**

  目标：处理长时间无输出、CLI 卡死、子进程异常退出等情况。

  验收：任务最终进入可见终态，并清理进程和 Session 状态。

  证据：`workbuddy-runtime.provider.ts` 使用默认 1 小时的 `WORKBUDDY_RUN_TIMEOUT_MS`，超时先 SIGTERM、3 秒后 SIGKILL，并发送统一 `error`；超时后的迟到 `result` 不会覆盖失败状态。`workbuddy-runtime.test.ts` 以 50ms 配置验证静默 CLI 返回失败完成、错误原因可见且不再被识别为运行中。

- [x] **W-010 增加未知事件和异常诊断**

  目标：未知事件、非法 JSON、stderr、CLI 退出码都能留下可定位的结构化信息。

  验收：日志包含 Provider、Session、事件类型和错误原因，但不泄露密钥。

  证据：`workbuddy-runtime.provider.ts` 对非法 JSON、未知事件、stderr 和无 terminal result 的非零退出记录结构化诊断；stderr 只保留截断后的脱敏预览。`workbuddy-runtime.test.ts` 验证未知/非法输入仍能完成、stderr 敏感值不进入诊断。

### P1：安全和数据边界

- [ ] **W-011 检查 MCP 配置的路径和竞态安全**

  验证项目级、用户级 `.mcp.json`/`mcp.json` 的：

  - symlink 处理
  - 真实路径校验
  - 检查与读取之间的 TOCTOU
  - 未注册项目访问

  验收：无法通过请求参数读写任意未授权目录的 MCP 配置。

  当前进展：WorkBuddy project/local 操作要求 workspace 已注册且为活动项目，工作区必须使用真实路径，项目 `.mcp.json` 和自定义配置根目录拒绝符号链接；配置读写已改为使用 `O_NOFOLLOW` 文件句柄，并按作用域串行化 CloudCLI 进程内的读改写操作，降低检查后再读写和并发覆盖风险。`mcp.test.ts` 已验证未注册工作区、配置/父目录/配置根目录符号链接、并发写入，以及读写目标文件不被越界修改。仍需在支持的平台矩阵上补充外部进程并发替换验证，因此暂不勾选。

- [ ] **W-012 检查敏感数据暴露路径**

  验证以下位置是否可能出现 env、Header、Token：

  - MCP API 响应
  - Tool Result
  - WorkBuddy stdout/stderr
  - 服务端日志
  - Session 持久化内容
  - WebSocket 消息

  验收：必要时脱敏，但不能无差别破坏用户正常业务输出；记录脱敏策略和测试样本。

  当前进展：WorkBuddy CLI stderr 诊断已做字段级脱敏和长度限制，并有回归测试；公共 MCP 适配出口现在对所有 Provider 的 `env`、`headers`、`envHttpHeaders` 统一只返回键名和 `<redacted>`，Claude/Codex/WorkBuddy 的列表响应已有回归断言；ChatSessionWriter 不记录异常 payload 原文，并移除标准化消息顶层意外携带的传输凭据字段，同时保留用户可见的 `content` 和工具结果。Tool Result、Session 持久化和 WebSocket 的全链路样本仍未完成，因此暂不勾选。

- [x] **W-013 检查多用户部署边界（当前单用户本地部署，不适用）**

  如果 CloudCLI 可能被多用户或远程访问，必须验证：

  - Session 是否属于当前用户
  - 客户端传入的 `cwd` 是否属于当前项目
  - `permissionMode` 是否允许 `bypassPermissions`
  - MCP URL 是否存在 SSRF 风险

  如果当前产品明确是单用户本地应用，记录“不适用”的产品依据。

  当前结论：产品当前明确按单用户本地实例部署，Platform 模式使用数据库中的首个用户；OSS 模式虽然存在登录接口，但 Provider Session、项目和 MCP 尚未按用户隔离。因此 W-013 在当前部署范围内记为“不适用”，不能据此宣称支持多人共享远程部署。未来若扩大到多用户/远程场景，必须重新打开本项，补充数据模型和所有 Session/Project/MCP 路由的用户归属校验。

### P2：性能和维护性

- [x] **W-014 将 WorkBuddy Session 同步改为增量或可控扫描**

  验收：大量历史 Session 下不会每次变更都全量读取所有文件；重复事件不会产生重叠同步。

  证据：`WorkbuddySessionSynchronizer` 在实例首次成功同步时全量扫描 `~/.codebuddy/projects` 和 `~/.workbuddy/projects`，后续同步使用 `since` 游标；首次扫描失败不会提前记录完成状态。`workbuddy-session-synchronizer.test.ts` 验证首次回填后按游标不重复处理旧文件。

- [x] **W-015 优化大文件历史读取**

  验收：历史记录分页读取时不需要一次性把整个文件读入内存。

  证据：`WorkbuddySessionsProvider.readTranscript` 使用 `createReadStream`/`readline` 逐行解析；有限分页只保留 `offset + limit` 的尾部窗口，并单独维护去重后的 Task/Todo 快照，仍返回准确 `total/hasMore`。`workbuddy-sessions.test.ts` 已验证尾部分页结果和全量历史结果保持一致。

- [x] **W-016 更新 Provider 文档**

  更新：

  - `server/modules/providers/README.md`
  - `public/api-docs.html`
  - Agent API Provider 示例和注释
  - WorkBuddy 配置、认证、能力说明

  证据：已同步 Provider README 的 Provider 列表、MCP/Skills/Session 根目录和 WorkBuddy 认证/超时说明；公开 API 文档已加入 `dsh`/`workbuddy` Provider 选项和模型列表；Agent API 注释已同步实际 Provider 列表。

## 3. 通用新增 Provider 接入清单

新增任意 AI Provider 时，复制这一节的状态到新的执行区。不要默认所有 Provider 都支持所有能力；不支持项必须写明原因。

### A. 接入前确认

- [ ] **P-001 确认官方协议和版本**

  记录 CLI/SDK 版本、官方文档、事件类型、输入输出格式和取消方式。

- [ ] **P-002 建立能力矩阵**

  至少记录：

  | 能力 | 支持情况 | 证据/备注 |
  | --- | --- | --- |
  | 普通文本 |  |  |
  | 流式增量 |  |  |
  | 工具调用 |  |  |
  | 工具进度 |  |  |
  | Todo/Task |  |  |
  | 后台任务/Workflow |  |  |
  | 图片/文件 |  |  |
  | Session 恢复 |  |  |
  | Session 历史 |  |  |
  | Token Usage |  |  |
  | 中断/取消 |  |  |
  | 权限请求 |  |  |
  | MCP |  |  |
  | Skills |  |  |

- [ ] **P-003 明确 Provider 原生能力与 CloudCLI 统一能力的边界**

  不因前端希望显示某种卡片，就伪造 Provider 不存在的结构化事件。

### B. 服务端适配

- [ ] **P-004 注册 Provider 和依赖注入**
- [ ] **P-005 实现 Runtime：启动、输入、输出、错误、退出码**
- [ ] **P-006 实现流式事件映射和稳定 ID**
- [ ] **P-007 实现工具完整生命周期**
- [ ] **P-008 实现 Task/Todo/Workflow 生命周期（如支持）**
- [ ] **P-009 实现官方取消、超时和优雅收尾协议**
- [ ] **P-010 实现模型列表和模型参数**
- [ ] **P-011 实现认证、安装状态和登录验证**
- [ ] **P-012 实现 Session 创建、恢复、历史和分页**
- [ ] **P-013 接入 Session Synchronizer 和 Watcher**
- [ ] **P-014 接入 Token Usage，或显式返回 unsupported**
- [ ] **P-015 接入 MCP，并完成路径、Header、env、URL 安全检查**
- [ ] **P-016 接入 Skills，并确认目录、前缀和权限边界**
- [ ] **P-017 接入 Agent API 和 Shell WebSocket（如需要）**
- [ ] **P-018 增加日志、错误诊断、脱敏和指标**

### C. 前端适配

- [ ] **P-019 Provider 选择、名称、Logo 和 i18n**
- [ ] **P-020 模型、权限模式、effort 等配置**
- [ ] **P-021 消息增量和稳定 ID 合并**
- [ ] **P-022 工具输入、输出、错误、拒绝、取消展示**
- [ ] **P-023 Task/Todo/Workflow 展示和终态**
- [ ] **P-024 Session 恢复、加载和 Token Usage 展示**
- [ ] **P-025 验证移动端或其他前端入口是否遗漏**

### D. 测试和验收

- [ ] **P-026 Runtime 单元测试**
- [ ] **P-027 Session/Normalizer 单元测试**
- [ ] **P-028 MCP/Skills/认证测试**
- [ ] **P-029 API 路由测试**
- [ ] **P-030 WebSocket 集成测试**
- [ ] **P-031 前端 Store/Renderer 测试**
- [ ] **P-032 真实 CLI 最小样本验证**
- [ ] **P-033 未知事件、非法 JSON、异常退出测试**
- [ ] **P-034 大 Session、慢任务、取消和重复触发测试**
- [ ] **P-035 类型检查、Lint、相关单测和构建验证**
- [ ] **P-036 更新文档和 Provider 接入记录**

## 4. 统一事件验收模型

所有 Provider 都应尽量映射到以下语义，而不是强行使用完全相同的原始事件名称：

```text
原始 Provider 事件
        ↓
Provider 专用适配器
        ↓
CloudCLI 统一事件
        ↓
Session Store / WebSocket
        ↓
消息、Tool、Todo、Task Renderer
```

统一结构至少需要能够表达：

- 稳定 ID
- 事件类型
- Session ID
- 工具或任务 ID
- 名称和输入
- 增量输出
- 最终输出
- 开始、更新、完成、失败、拒绝、取消、停止
- 错误原因和终止原因
- Token Usage（若支持）

### 最小状态机

```text
started
   ↓
updated/progress  ─────┐
   ↓                   │
completed              │
failed                 │
denied                 │
cancelled/stopped      │
   └───────────────────┘
```

验收时必须确认每个开始状态最终都能进入终态，不能只依赖“收到普通 result 就认为所有工具和任务都完成”。

## 5. 验证提示词模板

### 5.1 只读 Provider 基础验证

```text
请对当前项目做一次只读 Provider 接入验证，不要修改、创建、删除文件，不要安装依赖，也不要提交代码。

请先读取项目 AGENTS.md 和 Provider 接入 SOP，查看当前进度和最近一次交接记录。

然后依次验证：
1. 当前 Provider、版本和能力矩阵；
2. 普通文本消息的流式输出；
3. 一个工具从开始到终态的完整生命周期；
4. 如果 Provider 支持原生 Task/Todo/Workflow，验证结构化任务事件；
5. 如果不支持，不要用普通文本冒充结构化任务；
6. 验证取消、失败和未知事件处理；
7. 运行相关测试或类型检查。

每完成一个步骤，就在 SOP 中更新对应状态并记录证据。不要把未验证的项目标记为完成。最后写明剩余任务和下一次会话建议从哪一项开始。
```

### 5.2 验证 Task/Tool 不残留 Running

```text
请只验证当前 Provider 的实时任务和工具状态，不要修改代码。

请重点观察：
1. 任务或工具是否有稳定 ID；
2. 是否经历 started → updated/progress → completed/failed/cancelled 等状态；
3. 收到 complete 后是否仍有工具或任务显示 Running；
4. 用户主动取消后是否收到终态；
5. 是否存在重复消息或丢失的 task_* 事件。

请提供原始事件、统一 WebSocket 消息、前端最终状态三者的对照结果。
```

## 6. 交接记录模板

每次会话结束前，补充一条记录。新会话先读最后一条记录。

### 交接记录：YYYY-MM-DD HH:mm

- 当前分支：
- 当前工作区是否有用户未提交改动：
- 本次完成项：
- 本次未完成项：
- 修改文件：
- 验证命令：
- 验证结果：
- 已知失败或风险：
- 是否需要用户决策：
- 下一次会话从哪一项开始：
- 不能重复做的事情：

## 7. 完成定义

只有同时满足以下条件，才能说一个 Provider 接入完成：

- [ ] 能力矩阵已经填写，支持和不支持的能力边界清楚。
- [ ] Runtime 能处理正常输出、错误、异常退出和取消。
- [ ] 工具和任务都有稳定 ID，并且能进入终态。
- [ ] 原生 Task/Todo/Workflow 已适配；不支持时不会伪造。
- [ ] Session 创建、恢复、历史和 Watcher 已验证。
- [ ] MCP、Skills、认证和权限边界已验证。
- [ ] Token Usage 已支持，或明确返回 unsupported。
- [ ] 前端消息、工具、任务、错误和取消状态已验证。
- [ ] 单元测试、API/WebSocket 集成测试和必要的端到端验证已通过。
- [ ] 日志不会泄露敏感信息，未知事件可诊断。
- [ ] 文档、API 示例和 i18n 已更新。
- [ ] 本 SOP 已更新最后进度和交接记录。

> 完成定义的最后一项勾选前，不要把 Provider 宣称为“完整接入”。

## 8. 最近一次交接记录

### 交接记录：2026-08-28（继续执行）

- 当前分支：`feat/capacitor-ios-mobile`
- 当前工作区是否有用户未提交改动：是；本次只在 WorkBuddy 适配文件、相关测试、前端 Token Usage 组件和本 SOP 上继续追加修改，未清理其他改动。
- 本次完成项：补齐 W-005 的 Session Store 纯逻辑回归、WebSocket 失败/主动取消链路回归，并完成客户端构建复核；W-002、W-005 仍未达到完整验收条件。
- 本次未完成项：`W-002`、`W-005`，以及 P1/P2 项。
- 修改文件：
  - `server/modules/providers/list/workbuddy/workbuddy-runtime.provider.ts`
  - `server/modules/providers/list/workbuddy/workbuddy-sessions.provider.ts`
  - `server/modules/providers/services/provider-token-usage.service.ts`
  - `server/modules/providers/tests/workbuddy-runtime.test.ts`
  - `server/modules/providers/tests/workbuddy-sessions.test.ts`
  - `server/modules/providers/tests/provider-token-usage.service.test.ts`
  - `server/modules/providers/tests/fixtures/wb-mock-cli.mjs`
  - `src/components/chat/view/subcomponents/TokenUsageSummary.tsx`
  - `src/stores/sessionMessageMerge.ts`
  - `src/stores/sessionMessageMerge.test.ts`
  - `src/stores/useSessionStore.ts`
  - `server/modules/websocket/tests/chat-websocket.service.test.ts`
  - 本 SOP
- 验证命令：
  - `npx tsx --test "src/**/*.test.ts" "src/**/*.test.tsx"`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build:client`
  - `npx eslint src/stores/sessionMessageMerge.ts src/stores/sessionMessageMerge.test.ts src/stores/useSessionStore.ts`
  - `git diff --check`
- 验证结果：前端测试 51 项通过，服务端全量 386 项通过，类型检查、客户端构建、针对性 ESLint、全仓 ESLint 和 diff 检查通过。全仓 ESLint 为 0 错误、193 条既有警告；客户端构建仍有既有 CSS 语法警告和大 chunk 警告，但构建成功。
- 已知失败或风险：尚未通过真实 WebSocket 和浏览器 UI 验证；普通 `hang` mock 的取消仍依赖 3 秒后的信号兜底，这是测试兜底路径，不代表 interruptible WorkBuddy 流程失败。
- W-011 剩余风险：`O_NOFOLLOW` 已用于配置文件句柄，但尚未完成并发替换和完整 macOS/Linux/Windows 平台矩阵验证。
- 是否需要用户决策：暂不需要。
- 下一次会话从哪一项开始：先在本机启动 CloudCLI 并完成 `W-002` 的真实 UI 验收，再把截图/观察结果补入 W-005；随后处理 W-011 的并发替换/跨平台验证和 W-013～W-016。
- 不能重复做的事情：不要回退到关闭 stdin 作为唯一取消方式；不要把 WorkBuddy Token Usage 交给 Claude 解析器；不要把已经通过的 `W-001`、`W-003`、`W-004` 重复标记为未验证。

### 交接记录：2026-08-29（收尾执行）

- 当前分支：`feat/capacitor-ios-mobile`
- 当前工作区是否有用户未提交改动：是；保留全部已有改动，未提交代码。
- 本次完成项：
  - W-014：WorkBuddy 同步改为首次全量、之后按 `since` 游标增量扫描，并补回归测试。
  - W-015：WorkBuddy 历史改为逐行流式读取；有限分页只保留所需尾部窗口，同时保持 Task/Todo 快照去重和分页总数准确。
  - W-016：同步 Provider README、公开 API 文档、Agent API 注释，补充 DSH/WorkBuddy 的实际接入边界。
- 本次未完成项：W-002/W-005 的真实浏览器 UI 验收；W-006/W-007 的全 Provider 完整覆盖；W-011 的并发替换和跨平台矩阵；W-012 全链路敏感样本；W-013 多用户数据归属隔离。
- 本次新增或修改的重点文件：
  - `server/modules/providers/list/workbuddy/workbuddy-session-synchronizer.provider.ts`
  - `server/modules/providers/list/workbuddy/workbuddy-sessions.provider.ts`
  - `server/modules/providers/tests/workbuddy-session-synchronizer.test.ts`
  - `server/modules/providers/README.md`
  - `public/api-docs.html`
  - `server/modules/agent/agent.routes.ts`
  - 本 SOP
- 验证命令：
  - `npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/workbuddy-sessions.test.ts server/modules/providers/tests/workbuddy-session-synchronizer.test.ts`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build:client`
  - `npx tsx --test "src/**/*.test.ts" "src/**/*.test.tsx"`
  - `npx tsx --tsconfig server/tsconfig.json --test "server/**/*.test.ts" "server/**/*.test.js"`
  - `git diff --check`
- 验证结果：本次针对性 WorkBuddy Runtime/Session 测试 35 项、MCP 测试 11 项通过；前端 52 项、服务端全量 389 项、类型检查、客户端构建、Lint 和 diff 检查均通过。全仓 ESLint 为 0 错误、193 条既有 warning，不视为错误；客户端构建保留既有 CSS 解析和大 chunk warning，但构建成功。
- 本地服务验证：3001 已有用户进程占用，未终止；曾以 `SERVER_PORT=3002` 启动本工作区的开发后端和 Vite。浏览器控制环境没有可用实例，故没有伪造真实 UI 截图验收。
- 已知风险：WorkBuddy 的有限分页现在避免保存完整消息列表，但仍会保留去重 Task/Todo 快照；这是为了保证任务状态和 `total` 正确，不是无限制保留原始日志。
- 是否需要用户决策：若要完成 W-013，需要明确支持多用户/远程部署，并允许补充 sessions/projects/MCP 的用户归属数据模型；若只支持单用户本地部署，可将 W-013 记录为不适用而不是误判为已隔离。
- 下一次会话从哪一项开始：先读取本条交接；优先在用户可用浏览器实例中完成 W-002/W-005，随后再决定是否投入 W-011/W-013 的平台与部署级改造。
- 不能重复做的事情：不要自动提交；不要杀掉占用 3001 的已有进程；不要把浏览器不可用当成 UI 通过；不要回退已完成的流式历史、增量同步和敏感字段脱敏。

### 交接记录：2026-08-29（单用户部署边界确认）

- 当前分支：`feat/capacitor-ios-mobile`
- 当前工作区是否有用户未提交改动：是；继续保留全部未提交改动，未执行提交。
- 本次确认项：产品当前按单用户本地实例部署，W-013 记为“不适用”；暂不改造 `sessions/projects/MCP` 的多用户归属模型。
- 后续重新打开条件：产品需要单实例多人远程访问、租户隔离或共享服务部署时，重新执行 W-013。

### 交接记录：2026-08-29（安全边界自动化收尾）

- 当前分支：`feat/capacitor-ios-mobile`
- 当前工作区是否有用户未提交改动：是；继续保留全部未提交改动，未执行提交。
- 本次完成项：
  - W-011：WorkBuddy 自定义 MCP 配置根目录拒绝符号链接，补充读写回归测试；进程内作用域锁、配置文件 `O_NOFOLLOW` 和工作区路径校验保持有效。
  - W-012：异常 WebSocket payload 不再记录原文；标准化 WebSocket 消息移除顶层 `env`、`headers`、Token 等传输凭据字段，保留正常文本和工具输出；补充敏感值不进入诊断和 WebSocket 帧的回归测试。
- 本次未完成项：W-002/W-005 真实浏览器 UI 验收；W-011 外部进程替换和跨平台矩阵；W-012 Session 持久化及完整 Tool Result/Session/WebSocket 样本。
- 验证结果：MCP 与 WebSocket 定向测试共 17 项通过；服务端单并发全量 392 项通过，前端全量 52 项通过，类型检查、客户端构建和 `git diff --check` 通过；Lint 0 错误、193 条既有 warning。
- 并发测试说明：默认并发执行服务端测试时，已有测试间共享环境会触发 Node 测试运行器反序列化异常；使用 `npm test -- --test-concurrency=1` 全量复跑通过，不属于本轮业务失败。
- 下一次会话从哪一项开始：等待真实浏览器完成 W-002/W-005；W-011 继续保留外部进程替换/跨平台验证，W-012 继续保留 Session 持久化和完整 Tool Result/Session/WebSocket 样本验证。

### 交接记录：2026-08-29（工具状态与并发安全收尾）

- 当前分支：`feat/capacitor-ios-mobile`
- 当前工作区是否有用户未提交改动：是；继续保留全部未提交改动，未执行提交。
- 本次完成项：
  - W-006/W-007：补齐 WorkBuddy 工具结果的 `status` 透传，`denied`、`cancelled`、`stopped`、`killed` 不再统一显示成普通错误；补充稳定 ID、分页和前端状态测试。
  - W-011：增加 CloudCLI 进程内按作用域的 MCP 读改写锁，避免并发请求互相覆盖；符号链接、未注册工作区和 `O_NOFOLLOW` 保护保持有效。
- 本次未完成项：W-002/W-005 真实浏览器 UI 验收；W-011 外部进程替换和跨平台矩阵；W-012 Tool Result/Session/WebSocket 全链路敏感样本；W-013 多用户数据归属隔离。
- 修改重点文件：
  - `server/modules/providers/list/workbuddy/workbuddy-mcp.provider.ts`
  - `server/modules/providers/list/workbuddy/workbuddy-sessions.provider.ts`
  - `server/modules/providers/tests/mcp.test.ts`
  - `server/modules/providers/tests/workbuddy-runtime.test.ts`
  - `server/modules/providers/tests/workbuddy-sessions.test.ts`
  - `src/components/chat/hooks/useChatMessages.ts`
  - `src/components/chat/hooks/useChatMessages.test.ts`
  - `src/components/chat/types/types.ts`
  - 本 SOP
- 验证结果：前端全量 52 项通过，服务端全量 389 项通过，MCP 针对性测试 11 项通过，类型检查通过，客户端构建通过，Lint 0 错误、193 条既有 warning，`git diff --check` 通过。
- 浏览器验收：浏览器运行时连续确认无可用实例，未进行截图或伪造 UI 通过结论；本地开发服务验证使用 3002，原有 3001 进程未终止。
- 下一次会话从哪一项开始：用户打开并连接可用浏览器后，先完成 W-002/W-005；如果目标转为远程多用户部署，再单独评估 W-013 的数据模型改造范围。
- 不能重复做的事情：不要把工具取消状态重新压成 `isError`；不要移除 MCP 作用域锁；不要把单用户数据库当成多用户隔离；不要自动提交。
