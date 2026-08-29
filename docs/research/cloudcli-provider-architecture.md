# CloudCLI Provider/适配器架构分析

> 分析日期：2026-08-29
> 范围：`server/modules/providers/` + `server/shared/` + WebSocket 服务层 + 前端消费链路
> 权威源：`server/modules/providers/README.md`（新增 Provider 的操作文档）+ 代码实读
> 相关：WorkBuddy 接入执行清单见 `docs/provider-adapter-integration-sop.md`（本文件是架构参考，那份是执行清单）

## 1. 项目身份

- **名称**：CloudCLI（Claude Code UI），为 Claude Code / Codex / Cursor / OpenCode / WorkBuddy / DSH 提供 Web 界面
- **语言**：TypeScript（服务端 + React 前端），部分运行时适配器是 `.js`
- **运行时**：Node.js + Express（REST）+ `ws`（WebSocket）+ React

## 2. 核心结论：这是什么设计模式

**门面(Facade) + 适配器(Adapter) + 服务定位器(Service Locator) 三合一的插件式集成层**，外加一道**反腐蚀层(Anti-Corruption Layer，以 `NormalizedMessage` 为规范消息模型)**：

1. **门面**：每个外部 CLI agent = 一个 `AbstractProvider` 门面对象，聚合 7 个正交适配器面（facet），应用层只面向 `IProvider` 接口
2. **适配器**：每个面都是一个适配器，把 provider 原生格式翻译成共享契约
3. **服务定位器**：`providerRegistry` 是唯一映射表，6 个服务都通过它解析实现，避免循环依赖
4. **反腐蚀层**：`NormalizedMessage` + `MessageKind` 联合类型是跨 provider 的"世界语"，前端只需一个 kind 开关
5. **能力声明**：`provider-capabilities.service.ts` 把 UI 差异声明为静态特性表，前端零 provider 分支
6. **运行时协议无关**：`ChatSessionWriter` + `chatRunRegistry` 让 WebSocket 协议完全 provider 无关

## 3. Provider 抽象层

### 7 面契约（`server/shared/interfaces.ts`）

| 面 | 接口 | 职责 |
|---|---|---|
| `runtime` | `IProviderRuntime` | 启动/终止一次实时 CLI/SDK 会话（`run` / `abort` / `permissions?`） |
| `models` | `IProviderModels` | 返回受支持的模型目录、读取 provider 原生会话当前模型 |
| `auth` | `IProviderAuth` | 报告安装/登录状态（正常"未安装/未登录"是数据，不是异常） |
| `mcp` | `IProviderMcp` | 读写 provider 原生 MCP 配置文件 |
| `skills` | `IProviderSkills` | 从 `SKILL.md` 文件发现/写入/删除技能 |
| `sessions` | `IProviderSessions` | 消息规范化（`normalizeMessage`）+ 历史拉取（`fetchHistory`） |
| `sessionSynchronizer` | `IProviderSessionSynchronizer` | 扫描磁盘上的会话产物，upsert 进 `sessionsDb` |

```ts title=IProvider 门面接口
export interface IProvider {
  readonly id: LLMProvider;
  readonly runtime: IProviderRuntime;
  readonly models: IProviderModels;
  readonly mcp: IProviderMcp;
  readonly auth: IProviderAuth;
  readonly skills: IProviderSkills;
  readonly sessions: IProviderSessions;
  readonly sessionSynchronizer: IProviderSessionSynchronizer;
}
```

### 注册表（Service Locator）

```ts title=provider.registry.ts 结构
const providers: Record<LLMProvider, IProvider> = {
  claude: new ClaudeProvider(), codex: new CodexProvider(), ...
};
export const providerRegistry = {
  listProviders(): IProvider[] { ... },
  resolveProvider(provider: string): IProvider { ... } // 未知 id 抛 UNSUPPORTED_PROVIDER
};
```

依赖倒置关键：runtime 适配器执行时不直接 import 服务，而是收到运行时上下文对象 `ProviderRuntimeContext`（`types.ts`），提供 `resolveProviderSessionId` / `resolveResumeModel` / `normalizeMessage` / `isProviderInstalled` 等回调，由 `provider-runtime.service.ts` 组装注入。

### 每个 Provider 的 8 文件布局

```text title=provider 文件布局
server/modules/providers/list/<provider>/
  <provider>.provider.ts                  # 门面组装器，super('<id>')
  <provider>-runtime.provider.ts/js       # 实时执行
  <provider>-auth.provider.ts             # 安装/登录状态
  <provider>-models.provider.ts           # 模型目录
  <provider>-mcp.provider.ts              # 原生 MCP 配置读写
  <provider>-skills.provider.ts           # 技能发现
  <provider>-sessions.provider.ts         # 消息规范化 + 历史
  <provider>-session-synchronizer.provider.ts  # 磁盘产物扫描
```

## 4. 具体 Provider 适配器（6 个）

Provider 列表：`claude / codex / cursor / opencode / dsh / workbuddy`。同一个面在不同 Provider 下实现差异很大，体现适配器价值。

### 4.1 runtime —— 三种实现风格

| 风格 | Provider | 机制 |
|---|---|---|
| **SDK 直连** | claude、codex | `@anthropic-ai/claude-agent-sdk` 的 `query()` / `@openai/codex-sdk` 的 `thread.runStreamed()`；不 spawn 进程，消费 SDK 事件流；`AbortController` 取消 |
| **子进程 + JSONL** | workbuddy | `spawn(codebuddy, ['-p', '--output-format', 'stream-json', ...])`；stdout 按行拆 JSON 事件；abort 优先写 `control_request` interrupt，超时后 SIGTERM→SIGKILL |
| **ACP 桥** | dsh | 走 ACP（Agent Client Protocol）bridge，一次性程序化应答权限 |

所有 runtime 遵循**"恰好一个 complete"契约**：成功/失败/abort 都由 `createCompleteMessage()` 产生唯一终止事件；abort 路径由 chat 层替 runtime 补发。

### 4.2 sessions —— 读 JSONL / SQLite

| Provider | 读取源 | 关键翻译 |
|---|---|---|
| codex | `~/.codex/sessions/**/*.jsonl` | `function_call.shell_command`→`Bash`、`apply_patch`→`Edit`、子代理折叠成 `Task` |
| workbuddy | `~/.workbuddy/projects/**/*.jsonl` | 只处理 `message` 事件；剥离引擎注入的 `<user_query>` 包装；Task/Todo 快照去重 |
| cursor | `~/.cursor/projects/**/*.jsonl` | 用 `worker.log` 恢复 workspacePath |
| opencode | OpenCode 的 SQLite `opencode.db` | 读共享 DB，不删共享会话 |
| dsh | `session.jsonl.zstd` | 压缩文件读取 |

历史分页统一用 `sliceTailPage()`：`offset=0` 返回最近 `limit` 条，`limit:null` 全量。

### 4.3 auth / mcp / skills / session-synchronizer 要点

- **auth**：探测可执行文件（env 覆盖 → PATH → 内置 CLI），30s 缓存 + `--version` 探测；不伪造登录流程（WorkBuddy 登录归桌面 App）
- **skills**：各 provider 发现各自的根，命令前缀不同（Claude/Cursor/OpenCode 用 `/`，Codex 用 `$`）
- **session-synchronizer**：扫描 provider 会话根，从 `ai-title` 提标题、首条 user_query 兜底；跳过 `subagents/`、`tool-results/` 噪音

## 5. 消息规范化（Anti-Corruption Layer）

所有 provider 原生事件最终翻译成唯一规范消息模型 `NormalizedMessage` + 按 `kind` 分派的联合类型 `MessageKind`：

- `MessageKind`：`text / tool_use / tool_result / thinking / error / complete / status / task_notification / session_created / permission_request` 等
- **`complete` 是唯一终止信号**，`aborted/success/exitCode` 挂在这个消息上，前端不分 provider 就能处理成功/失败/中止
- `createNormalizedMessage(fields)` 保证 `id / sessionId / timestamp / provider` 信封字段

```text title=规范化管道
provider 原生事件（JSONL 行 / SDK 事件）
  → runtime 中间形状（如 codex transformCodexEvent）
  → context.normalizeMessage(raw, sessionId) → provider.sessions.normalizeMessage()
  → NormalizedMessage[]
  → writer.send(msg)
```

## 6. 能力抽象（provider-capabilities.service.ts）

纯静态能力矩阵（`ProviderCapabilities` + `PROVIDER_CAPABILITIES` 常量表），每 provider 声明：`permissionModes[]` / `supportsImages` / `supportsFiles` / `supportsAbort` / `supportsPermissionRequests` / `supportsTokenUsage` / `supportsEffort`。

设计意图：**前端 composer UI 完全由这个 shape 渲染，不写任何按 provider id 分支的 React 条件**。新功能要暴露在这里，而不是在组件里写 `if (provider === 'claude')`。

## 7. 服务层（Dispatcher）

| 服务 | 职责 |
|---|---|
| `provider-runtime.service.ts` | 核心分发器：组装 `ProviderRuntimeContext`，`run/abort/resolveToolApproval/getPendingApprovalsForSession` |
| `sessions.service.ts` | 会话门面：`createAppSession`（app 侧 UUID）、`fetchHistory`（sessionId 重映射回 app id）、`createClaudeBranch` |
| `mcp.service.ts` | `list/upsert/remove` 单 provider + `addMcpServerToAllProviders` 全局遍历 |
| `skills.service.ts` / `provider-auth.service.ts` / `provider-models.service.ts` | 同模式分发器 |
| `provider-token-usage.service.ts` | 按 provider 从不同来源读 token 用量；WorkBuddy/Cursor 明确返回 `unsupported` |
| `session-synchronizer.service.ts` | 编排所有 provider 同步，只有全部成功才推进 `scan_state.last_scanned_at` |
| `sessions-watcher.service.ts` | chokidar 监听各 provider 会话根，`add/change` → 单文件同步 → 广播 `session_upserted` |

## 8. MCP 抽象

`shared/mcp/mcp.provider.ts` 定义第二个共享基类 `McpProvider`，把"provider 原生 MCP 配置格式"隔离。抽象方法仅 4 个：

- `readScopedServers(scope, workspacePath)`
- `writeScopedServers(scope, workspacePath, servers)`
- `buildServerConfig(input)`（UI 表单 → 原生配置段）
- `normalizeServerConfig(scope, name, rawConfig)`（原生配置段 → 共享 `ProviderMcpServer`）

共享基类提供 scope/transport 校验、密钥脱敏（`<redacted>` 往返恢复）、响应清洗。各 provider 原生格式：

| Provider | 存储位置 |
|---|---|
| Claude | `.mcp.json`（user/local/project） |
| Codex | `.codex/config.toml` |
| Cursor | `.cursor/mcp.json` |
| OpenCode | `~/.config/opencode/opencode.json`（或 `.jsonc`） |
| WorkBuddy | `~/.codebuddy.json` / `~/.workbuddy/.mcp.json` + `<workspace>/.mcp.json` |
| DSH | harness 管理 |

## 9. 消息流向（完整链路）

### 实时（chat.send）

```text title=实时消息链路
前端 WebSocket chat.send { sessionId, content, options }
  → chat-websocket.service.ts handleChatSend（session 信息全部取自服务端，不信任客户端）
  → chatRunRegistry.startRun（创建 run + ChatSessionWriter）
  → providerRuntimeService.run(provider, command, options, run.writer)
  → runtime 适配器启动（spawn CLI 或 SDK），CLI stdout 吐 JSONL
  → 逐事件解析 → context.normalizeMessage() → NormalizedMessage[]
  → ChatSessionWriter.send()：session_created 转 id 映射 / sessionId 重映射 / 分配 seq / 脱敏
  → ws.send 推到浏览器
```

### 订阅/重连（chat.subscribe）

`chatRunRegistry.attachConnection` 把运行中的 run 出站 writer 重绑到新 socket，`replayEvents(seq > lastSeq)` 重放错过的缓冲事件。

### 历史（REST）与索引（watcher）

- 历史：`sessionsService.fetchHistory` → provider `sessions.fetchHistory` 读磁盘 → 翻页 → `NormalizedMessage[]`
- 索引：chokidar watcher → `sessionSynchronizerService.synchronizeProviderFile` → provider `synchronizeFile` → `sessionsDb` upsert → 广播 `session_upserted`

## 10. 前端如何消费

1. `useChatRealtimeHandlers.ts`：按 `kind` 分派的薄 reducer —— `stream_delta` 100ms 累积缓冲、`complete` 收尾/触发 REST 刷新、`permission_*` 管理审批弹窗。注释明确：因为协议是 kind 统一的，这里**没有 provider 分支**
2. `useSessionStore.ts`：`appendRealtime / updateStreaming / finalizeStreaming` 写入会话 slot，与 REST 历史合并去重
3. `useChatMessages.ts`：`normalizedToChatMessages()` 最后一步翻译，按 kind 渲染成 UI 形状（`tool_use` 附带 `tool_result`、`Task` 渲染子代理容器等）

## 11. 关键文件索引

| 目的 | 路径 |
|---|---|
| 架构权威文档 | `server/modules/providers/README.md` |
| 接口契约 | `server/shared/interfaces.ts` |
| 规范消息/核心类型 | `server/shared/types.ts` |
| 规范化工具 | `server/shared/utils.ts`（`createNormalizedMessage` L347、`sliceTailPage` L409、`createCompleteMessage` L373） |
| 门面基类 | `server/modules/providers/shared/base/abstract.provider.ts` |
| 注册表 | `server/modules/providers/provider.registry.ts` |
| 运行时分发 | `server/modules/providers/services/provider-runtime.service.ts` |
| 能力矩阵 | `server/modules/providers/services/provider-capabilities.service.ts` |
| MCP 基类 | `server/modules/providers/shared/mcp/mcp.provider.ts` |
| Skills 基类 | `server/modules/providers/shared/skills/skills.provider.ts` |
| 出站网关 | `server/modules/websocket/services/chat-session-writer.service.ts` |
| run 注册表 | `server/modules/websocket/services/chat-run-registry.service.ts` |
| WebSocket 入口 | `server/modules/websocket/services/chat-websocket.service.ts` |
| 前端事件分发 | `src/components/chat/hooks/useChatRealtimeHandlers.ts` |
| 前端消息转换 | `src/components/chat/hooks/useChatMessages.ts` |
| 前端会话存储 | `src/stores/useSessionStore.ts` |
