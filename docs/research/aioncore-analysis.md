# AionCore 后端引擎设计分析

> 分析日期：2026-08-29
> 仓库：`/Users/selier/Projects/open_projects/AionCore`（分支 `main`，浅克隆）
> 配套前端：AionUi（Electron 薄壳），见 [aionui-analysis.md](./aionui-analysis.md)

## 1. 项目定位

AionCore 是 **AionUi 桌面应用真正的本地后端引擎**，用 Rust 构建（Axum + Tokio + SQLite），通过 HTTP REST + WebSocket 向 AionUi 桌面/Web 客户端提供全部业务能力。产出单二进制 `aioncore`，由 AionUi 启动时从 PATH 或 managed-resources 中拉取。

官方文档：`ARCHITECTURE.md` / `ARCHITECTURE.zh-CN.md`（最权威的架构说明）。

## 2. 技术栈

| 组件 | 技术 |
|---|---|
| Web 框架 | Axum 0.8 |
| 异步运行时 | Tokio |
| 数据库 | SQLite（sqlx 0.8 异步 + rusqlite 0.32 bundled） |
| 认证 | JWT（HMAC-SHA256）+ CSRF（Double Submit Cookie） |
| 密码 | bcrypt（cost 12）+ AES-256-GCM 存储加密 |
| 实时通信 | WebSocket（`/ws` 单端点）+ 事件总线广播 |
| 语言 | Rust 2024 edition |

## 3. 分层架构（27 个 crate）

官方定义**四层架构**，依赖严格向下流动（下层不知道上层存在），禁止循环依赖：

```
┌─────────────────────────────────────────────┐
│ Composition 组装层                          │
│   aionui-app（唯一可执行/服务装配中心）      │
├─────────────────────────────────────────────┤
│ Domain 领域层（横向并列）                    │
│   ai-agent · conversation · team · session  │
│   session-message · cron · channel · mcp    │
│   realtime · skill-runtime · shell · auth   │
│   session · file · project · office · system│
│   extension · assistant · team-prompts      │
├─────────────────────────────────────────────┤
│ Capability 能力层（通用能力，无领域语义）    │
│   db · process · runtime · api-types        │
├─────────────────────────────────────────────┤
│ Foundation 基础层                            │
│   common（常量/错误/工具）  assets（资源）   │
└─────────────────────────────────────────────┘
```

依赖方向规则：组装层 → 领域层 → 能力层 → 基础层。跨领域协作通过 trait/port 抽象（如 conversation 通过 `IWorkerTaskManager` 使用 ai-agent 能力）。

### 各层 crate 职责速览

**基础层**
- `aionui-common`：共享错误类型（`ApiError`）、枚举、ID 生成、加密工具、分页
- `aionui-api-types`：所有 HTTP/WS 请求响应类型，**API 契约唯一定义处**；禁止依赖 axum/tower，只允许 serde
- `aionui-db`：SQLite 数据库层，Repository trait + 实现
- `aionui-assets`：嵌入式静态资源（agent 元数据、提示词）
- `aionui-runtime`：托管 Node、子进程管理、PATH 增强
- `aionui-process`：直连 CLI 会话的子进程监管、隔离和启动清理

**能力层**
- `aionui-auth`：JWT 认证、密码哈希、CSRF 保护、Cookie 管理、认证中间件、限流
- `aionui-realtime`：WebSocket 连接管理、事件广播（`BroadcastEventBus`）、消息路由

**领域层**
- `aionui-conversation`：对话管理、消息收发、确认机制、流式响应
- `aionui-session`：统一直连 CLI 与 ACP 后端的会话状态 FSM
- `aionui-channel`：多渠道集成（微信/钉钉/飞书/Telegram/Slack/Discord）、插件系统
- `aionui-team`：团队协作、任务调度、邮箱系统
- `aionui-cron`：定时任务执行、Cron 表达式、事件触发
- `aionui-file`：文件操作、监听、快照、Git、压缩
- `aionui-project`：项目/文件夹绑定、项目浏览器、资源边界校验
- `aionui-office`：Office 文档处理（Excel/PPT/Word）、预览、转换
- `aionui-system`：系统设置、提供商管理、版本检查
- `aionui-mcp`：MCP 协议集成、OAuth、多平台适配器
- `aionui-ai-agent`：Agent 生命周期管理、Worker 任务队列、ACP
- `aionui-extension`：扩展注册中心、Hub 管理、技能发现
- `aionui-shell`：Shell 命令执行、语音转文字（STT）
- `aionui-assistant`：Assistant 配置与管理
- `aionui-skill-runtime`：技能运行时消费侧（agent 执行命令消费技能）

## 4. 应用入口（aionui-app，二进制名 aioncore）

### 启动流程（`crates/aionui-app/src/main.rs`）

1. clap 解析 CLI 参数 → `AppConfig`
2. `aionui_runtime::set_managed_resources_mode` + `init`（托管 Node）+ `enhance_process_path`
3. tokio multi_thread runtime → `async_main`
4. CLI 子命令分发（`capabilities/config/diagnose/team/session/skills/doctor/user/secret/prepare-managed-resources` 等），无子命令走完整服务器启动：
   - `bootstrap::init_environment`
   - `DataDirInstanceGuard::try_acquire`（数据目录单例锁，防多实例）
   - `bind_http_listener` → `init_data_layer`（数据库）
   - `AppServices::from_config`（DI 装配中心）
   - `parent_exit_signal`（父进程退出跟随）
   - `run_server`

### 关键配置（`crates/aionui-app/src/config.rs`）

- `host`：默认 `127.0.0.1`
- `port`：默认 **25808**
- `data_dir`：数据库文件 `{data_dir}/aionui-backend.db`
- `local`：本地嵌入式模式，跳过鉴权（Electron 嵌入用）
- `identity_mode`：`Local / WebUi / AionPro`
- 其他：`bootstrap_secret`、`dump_prompts`、`recover_corrupted_database`

### 路由组装（`crates/aionui-app/src/router/routes.rs`）

`create_router_with_runtime` 启动三个后台服务（事件桥 `forward_event_bus_to_websocket`、channel orchestrator、fs/scm monitor），`create_router_with_all_state` 合并所有领域路由。中间件栈：`security_headers → CSRF（非 local）→ auth_middleware（按路由组）→ handler`。WebSocket `/ws` 独立，不走 auth 中间件；CORS 在 local 模式全开。

### DI 三阶段

```
AppServices（aionui-app/src/services.rs 集中构建所有共享依赖）
   → build_module_states() 按领域裁剪 → 各领域 RouterState（ModuleStates 聚合 20 个）
   → handler 通过 State(state): State<RouterState> 取依赖
```

规则：**AppServices 是唯一服务构建中心**；领域 crate 不构建自己的依赖，只声明需要什么。`AppServices` 持有 database、jwt_service、user_repo、event_bus、worker_task_manager、agent_registry、conversation_repo、encryption_secret_raw 等。

## 5. Agent 系统（aionui-ai-agent）

### 核心抽象

- **`IAgentTask` trait**（`src/agent_task.rs`）：10 个方法——`agent_type / conversation_id / workspace / status / last_activity_at / live_background_tasks / subscribe / prompt_media_caps / supports_midturn_delivery / send_message / cancel / kill`，是上层（conversation/team）操作的统一门面
- **`AgentInstance` 封闭枚举**：`Acp(Arc<AcpAgentManager>) / Aionrs(Arc<AionrsAgentManager>) / Session(Arc<SessionAgentTask>) / Mock(test)`，用 match 分派而非 trait object downcast
- **`AgentRegistry`**（`src/registry.rs`）：agent 目录缓存（`RwLock<HashMap>`）+ catalog MPSC 消费者 + CLI 探测策略；`hydrate()` 从数据库加载，含 **43 个 seed agent**（claude/codex/gemini/qwen 等）
- **`WorkerTaskManagerImpl`**（`src/task_manager.rs`）：并发控制核心。`DashMap<String, TaskSlot>`，TaskSlot = `Arc<OnceCell<ManagedAgentTask>>`，用 `OnceCell::get_or_try_init` 做**单飞**（single-flight），防止同一 conversation 重复拉起 agent；`collect_idle` 判断空闲
- **`AgentFactory`**（`src/factory/mod.rs`）：按 `AgentSessionKind`（Acp/Aionrs/Antigravity）分派构建
- **`AcpAgentManager`**（`src/manager/acp/`）：ACP 引擎实现，含 `PermissionRouter`、`CatalogForwarder`、`AcpSession`
- **`PermissionRouter`**（`src/manager/acp/permission_router.rs`）：权限确认机制。后台循环收 `PermissionRequest` → 转 `AgentStreamEvent::AcpPermission` → 通过按 `tool_call_id` 键控的 `pending_permissions` map 等待用户 confirm；team MCP 工具自动批准（`AUTO_APPROVE_MCP_SERVERS`）

### Agent REST 端点（`src/routes/agent.rs`）

`/api/agents/*`：`GET /logos`、`GET /management`、`POST /{id}/health-check`、`POST /provider-health-check`、`PATCH /{id}/enabled`、`GET|PUT /{id}/overrides`、`POST /custom`、`PUT|DELETE /custom/{id}`、`POST /custom/try-connect`。另有 `/api/remote-agents/*` 配对端点。

## 6. 数据库（aionui-db）

- **迁移**：sqlx `migrate!()` 内嵌迁移，**43 个迁移文件**（`migrations/001_initial_schema.sql` → `043`），启动自动执行，`IF NOT EXISTS` 幂等；有 **migration 不可变性检查**（`just migration-check`）
- **Repository 模式**：`I` 前缀 trait + `Sqlite` 前缀实现（如 `IAcpSessionRepository` / `SqliteAcpSessionRepository`），40 个 Repository 文件；Service 只依赖 trait
- **核心表**（`migrations/001_initial_schema.sql`）：`users`、`system_settings`、`client_preferences`、`providers`、`conversations`、`messages`、`conversation_artifacts`、`acp_session`、`agent_metadata`（43 行 seed）、`remote_agents`、`mcp_servers`、`oauth_tokens`、`assistants`（+overrides/plugins/users/sessions/pairing_codes）、`teams`、`mailbox`、`team_tasks`、`cron_jobs`

### 类型分布

| 类型 | 位置 | 用途 |
|---|---|---|
| Row 模型 | `aionui-db/src/models/` | 数据库行映射 |
| Params 对象 | `aionui-db/src/repository/` | 数据库写入参数 |
| 请求/响应类型 | `aionui-api-types` | API 契约与共享 DTO |

### 错误传播

```
DbError（数据库层）→ From trait → ApiError → IntoResponse → HTTP 响应
```

映射规则：`DbError::NotFound/Conflict` 保留语义；`Query/Migration/Init` 统一映射为 Internal（屏蔽细节）。

## 7. 渠道系统（aionui-channel）

- **抽象**：`ChannelPlugin` trait（`src/plugin.rs`）——`initialize / start / stop / send_message / edit_message / active_user_count / bot_info / plugin_type / status / last_error`；`PluginCallbacks`（message_tx/confirm_tx mpsc channel）
- **插件工厂**（`src/plugins/mod.rs`）：`create_plugin(PluginType)` 按 feature 分派（telegram/lark/dingtalk/weixin/slack/discord 均 feature-gated）
- **消息循环**（`src/orchestrator.rs`）：`ChannelOrchestrator::run` 消费 message_rx/confirm_rx，驱动 `ActionExecutor` 路由 → 发送 agent / 回复
- 渠道插件是后台 bot 接入，与主 HTTP 服务平行，在 `aionui-app` 的 `create_router_with_runtime` 中启动 orchestrator

## 8. 会话系统（aionui-session）

服务器权威的会话控制平面，与 ACP 路径不同：

- **直接 spawn claude CLI**（不经 ACP），把 stream-json 帧解析成后端无关的 `SessionEvent`
- 经纯 reducer `step()` 折叠成 **5-name/4-variant 的 `SessionState` FSM**
- 后端经 `SessionBackend`/`BackendConnection` trait 隔离（Claude/Codex/Acp/Antigravity）

`aionui-session-message`：跨会话消息投递，投递委托给 `ConversationService::send_message`（人类发送路径），保证「跨会话投递 ≡ 用户按下发送」。

## 9. 进程管理三层分立

| crate | 职责 |
|---|---|
| `aionui-runtime` | 托管 Node 运行时（打包版从 managed-resources 激活，download 模式装到 `{data_dir}/runtime/node`，**不依赖系统 PATH**）、PATH 增强、进程 spawn Builder、kill_process_tree |
| `aionui-process` | **底层子进程监管器**：`Spawner` trait + `RealSpawner`、`ManagedProcess`、`ProcessIdentity`、`Containment`、`FileRegistryStore`、reconcile/supervisor；注册表存于 `{data_dir}/runtime/aionui-process/` |
| `aionui-shell` | OS 集成层：打开文件/文件夹、STT 语音转文字（Deepgram/OpenAI） |

### 子进程 Builder 约定

新子进程启动点必须用 `aionui_runtime::Builder::agent(program)`（长驻 Agent CLI）/ `Builder::clean_cli(program)`（短工具），两者设置 `kill_on_drop(true)` 并清除 `NODE_OPTIONS`/`NODE_INSPECT`/`NODE_DEBUG`/`CLAUDECODE` 防止调试环境泄漏；`clean_cli` 额外设置管道 stdio + `NO_COLOR=1` + `TERM=dumb`。**禁止手写 `tokio::process::Command`**。

## 10. 安全模型

中间件栈（由外到内）：**CORS（local only）→ Security Headers → CSRF（非 local）→ Auth（按路由组选择性应用）→ Handler**

### JWT 认证

- 算法：HMAC-SHA256；有效期 24h；Payload：`user_id/username/iat/exp/iss("aionui")/aud("aionui-webui")`
- Secret 优先级：环境变量 → 数据库 → 随机生成（64 字节 getrandom）
- Token 提取：`Authorization: Bearer` → `aionui-session` Cookie；支持黑名单（SHA-256 哈希，DashMap）

### CSRF（Double Submit Cookie）

- Cookie `aionui-csrf-token`（非 HttpOnly）+ 请求头 `x-csrf-token`，值必须匹配
- 安全方法（GET/HEAD/OPTIONS）免校验；豁免 `/login`、`/api/auth/qr-login`

### 其他

- 密码：bcrypt cost 12，最低 50ms 响应防计时攻击，dummy hash 防用户枚举
- Cookie：`aionui-session`（HttpOnly）+ `aionui-csrf-token`，SameSite Strict/Lax，30 天
- 限流：登录 5 次/15min（IP）、公开端点 60 次/1min（IP）、敏感操作 20 次/1min（用户 ID）
- **local 模式**：跳过 JWT/CSRF、全开 CORS、注入 `system_default_user`

## 11. API 规范

### 统一响应

```json title=成功响应
{
  "success": true,
  "data": { ... },
  "message": "optional message"
}
```

```json title=错误响应
{
  "success": false,
  "error": "Human-readable error message",
  "code": "ERROR_CODE"
}
```

### 错误码 → HTTP 状态码

| ApiError 变体 | 状态码 | 错误码 |
|---|---|---|
| BadRequest | 400 | BAD_REQUEST |
| Unauthorized | 401 | UNAUTHORIZED |
| Forbidden | 403 | FORBIDDEN |
| NotFound | 404 | NOT_FOUND |
| Conflict | 409 | CONFLICT |
| UnprocessableEntity | 422 | UNPROCESSABLE_ENTITY |
| RateLimited | 429 | RATE_LIMITED |
| Internal | 500 | INTERNAL_ERROR |
| BadGateway | 502 | BAD_GATEWAY |
| Timeout | 502 | TIMEOUT |

### 分页

```json title=PaginatedResult
{
  "items": [...],
  "total": 100,
  "hasMore": true
}
```

JSON 字段 camelCase（`#[serde(rename_all = "camelCase")]`）。

### WebSocket 事件

- 入口：单一 `/ws` 端点
- 格式：`{ "name": "domain.actionName", "data": ... }`，两级 camelCase（如 `conversation.listChanged`、`cron.jobExecuted`）
- ⚠️ 遗留：部分事件用 kebab-case（`channel.pairing-requested`）或三级命名（`team.agent.status`），新增必须遵循两级 camelCase

### ACP 工具输出清洗

翻译层把工具返回的大型二进制/inline base64 剥离（如 Codex 图片生成返回的 PNG base64），保留 `saved_path`、`image.path`、`result_omitted` 等小字段，保证 WS 和 SQLite 消息内容可控大小。前端应通过文件路径加载图片，不依赖 inline base64。

## 12. 领域 crate 标准结构

```text title=crates/aionui-conversation/src 结构
├── lib.rs       # 模块导出，domain_routes()/Service/RouterState
├── routes.rs    # pub fn domain_routes(state) -> Router；handler 只做参数/响应转换
├── service.rs   # 业务逻辑唯一存放处；不 import axum
├── state.rs     # #[derive(Clone)] RouterState，持有 Arc 依赖
├── error.rs     # 领域错误类型（可选）
└── types.rs     # 领域模型（可选）
```

Handler 签名约定：

```rust title=handler 签名约定
async fn handler(
    State(state): State<RouterState>,       // 依赖注入
    Extension(user): Extension<CurrentUser>, // 当前认证用户
    Path(id): Path<String>,                  // 路径参数
    Json(body): Json<RequestType>,           // 请求体
) -> Result<(StatusCode, Json<ApiResponse<ResponseType>>), ApiError>
```

## 13. 工程文化与规范（AGENTS.md）

这个仓库对 AI 协作有**极其严格的验证纪律**：

- **禁止猜测任何 agent CLI 行为**（wire 协议、消息形状、字段语义），必须引用实证来源：`~/aion/protocols/samples/` 抓包数据、ACP 库源码（`~/.cargo/registry/src/*/agent-client-protocol-*`）、官方 adapter 代码；声明要标注 `verified: ...`
- **禁止把子 agent 的结论当事实**——必须打开引用文件核对（文档记录了具体教训案例）
- 文档纪律：AGENTS.md 只放「做什么/不做什么」，设计原理放 ARCHITECTURE.md；规则锚定稳定概念，不锚定具体字段/方法名

### 测试策略

| 层级 | 位置 | 数据库 |
|---|---|---|
| 单元测试 | crate 内 `#[cfg(test)]` | 无或 Mock |
| 集成测试 | `crates/<crate>/tests/` | 内存 SQLite |
| E2E 测试 | `crates/aionui-app/tests/` | 内存 SQLite（完整 HTTP 链路 + 登录） |

- 内存库：`init_database_memory()`（`sqlite::memory:`，单连接池，自动迁移 + 系统默认用户）
- 优先真实内存库，Mock 仅用于隔离不相关依赖
- 测试失败处理：禁止改测试来通过；先判断断言是否仍代表正确行为
- 命名：`*_test.rs`（单元）、`*_integration.rs`（集成）、`*_e2e.rs`（端到端）

## 14. 开发工作流（justfile）

```text title=常用 just 命令
just setup            # 启用 pre-commit hooks（克隆后跑一次）
just build            # release 构建（自动 lint-fix + fmt）
just build-debug      # debug 构建
just test             # nextest 全 workspace 测试
just check            # migration-check + lint + fmt-check + test
just run              # 跑服务（debug），如 just run -- --port 3000
just migration-check  # 校验已发布 migration 不可变
just update-aionrs    # 更新内嵌 aionrs agent 引擎版本
just push             # 全部门禁通过后 push
just audit            # cargo audit 安全审计
```

## 15. 与 AionUi 的 API 面对应

| AionUi（TS）调用面 | AionCore（Rust）实现 |
|---|---|
| `ipcBridge` HTTP REST | 各领域 crate `routes.rs`，合并于 `aionui-app/src/router/routes.rs` |
| API DTO 契约 | `aionui-api-types`（前后端对接契约源） |
| `/api/agents/*` | `aionui-ai-agent/src/routes/agent.rs` |
| `/api/conversations*` | `aionui-conversation/src/routes.rs` |
| `/api/remote-agents/*` | `aionui-ai-agent/src/routes/remote.rs` |
| `/api/messages/search` | `aionui-conversation` |
| `/ws` 事件推送 | `aionui-realtime`（BroadcastEventBus + WebSocketManager） |

## 16. 关键文件速查

| 目的 | 路径 |
|---|---|
| Workspace 定义 | `Cargo.toml` |
| 官方架构文档 | `ARCHITECTURE.zh-CN.md` |
| 启动 main() | `crates/aionui-app/src/main.rs` |
| 路由组装 | `crates/aionui-app/src/router/routes.rs` |
| 状态聚合 | `crates/aionui-app/src/router/state.rs` |
| 服务装配中心 | `crates/aionui-app/src/services.rs` |
| AppConfig | `crates/aionui-app/src/config.rs` |
| Agent 统一门面 | `crates/aionui-ai-agent/src/agent_task.rs` |
| 单飞并发管理 | `crates/aionui-ai-agent/src/task_manager.rs` |
| Agent 目录 | `crates/aionui-ai-agent/src/registry.rs` |
| 权限确认 | `crates/aionui-ai-agent/src/manager/acp/permission_router.rs` |
| agent REST 路由 | `crates/aionui-ai-agent/src/routes/agent.rs` |
| 会话 REST 路由 | `crates/aionui-conversation/src/routes.rs` |
| 数据库迁移起点 | `crates/aionui-db/migrations/001_initial_schema.sql` |
| Repository 层 | `crates/aionui-db/src/repository/` |
| 渠道插件 trait | `crates/aionui-channel/src/plugin.rs` |
| 渠道 orchestrator | `crates/aionui-channel/src/orchestrator.rs` |
| WebSocket 处理 | `crates/aionui-realtime/src/handler.rs` |
| API 契约 DTO | `crates/aionui-api-types/src/lib.rs` |

## 17. 设计要点总结

1. **本地优先**：默认 `127.0.0.1:25808`，`--local` 模式跳过鉴权，为桌面壳内嵌而生
2. **严格分层 + DI 三步**：领域间通过 trait/port 协作，避免循环依赖
3. **Agent 统一门面**：`IAgentTask` trait + `AgentInstance` 封闭枚举，屏蔽 ACP 子进程/aionrs 原生/Session 三种实现差异
4. **单飞并发控制**：`OnceCell` + DashMap 保证每个 conversation 同一时刻只有一个 agent 实例
5. **SQLite 单一文件**：`aionui-backend.db`，43 个内嵌迁移
6. **单一 WS 通道**：`/ws` + `BroadcastEventBus`，事件命名 `domain.camelCaseAction`
