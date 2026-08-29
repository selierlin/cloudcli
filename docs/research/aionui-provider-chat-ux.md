# AionUi / AionCore 双仓库：Provider 机制与聊天 UX 分析

> 分析日期：2026-08-29
> 范围：AionUi（Electron 壳，Provider 前端视角 + 聊天 UX）+ AionCore（Rust 后端，Provider 后端视角 + 流式推送）
> 相关：整体架构见 `aionui-analysis.md` / `aioncore-analysis.md`（本文件聚焦 Provider 链路 + 聊天交互细节）
> 用途：评估 Aion 的设计是否值得 cloudcli 借鉴

## 0. 双仓库身份

| | AionUi（Repo A，前端壳） | AionCore（Repo B，后端服务） |
|---|---|---|
| 路径 | `~/Projects/open_projects/aionui` | `~/Projects/open_projects/AionCore` |
| 语言 | TypeScript / React | Rust |
| 框架 | Electron + Arco Design + UnoCSS | Axum 0.8 + Tokio + sqlx(SQLite) |
| 关键文档 | `AGENTS.md` | `ARCHITECTURE.zh-CN.md` |

AionUi 通过 `common/adapter/ipcBridge.ts` 调用 AionCore 的 HTTP REST + 单一 WebSocket `/ws`；`--local` 模式注入 `system_default_user` 跳过鉴权。

**核心概念对照（重要）**：Aion 的 Provider（`/api/providers/*`）是**模型平台凭据管理**（LLM API key），Aion 的 Agent（`/api/agents/*`）才是外部 CLI 统一接入（≈ cloudcli 的 Provider 概念）。阅读时注意区分。

---

## A1. Provider 机制（前端视角）

### 1.1 IPC 桥接层（`aionui/packages/desktop/src/common/adapter/ipcBridge.ts`）

```ts title=providers 相关 API 封装
export const mode = {
  listProviders:      httpGet('/api/providers'),
  createProvider:     httpPost('/api/providers'),
  updateProvider:     httpPut((p) => `/api/providers/${p.id}`),
  deleteProvider:     httpDelete((p) => `/api/providers/${p.id}`),
  fetchProviderModels:httpPost((p) => `/api/providers/${p.id}/models`),
  fetchModelList:     httpPost('/api/providers/fetch-models'),   // 匿名预创建拉模型
  detectProtocol:     httpPost('/api/providers/detect-protocol'),
};
```

同一文件内还有 WS 事件封装：`conversation.responseStream = wsEmitter<IResponseMessage>('message.stream')`、`confirmMessage`、`killTerminal` 等。

### 1.2 类型定义

- `common/types/provider/providerApi.ts` —— 注释明确写着 "Direct mirror of the Rust types in `crates/aionui-api-types/src/provider.rs`"（TS 类型镜像 Rust DTO）
- `common/types/provider/authType.ts` —— `AuthType` 枚举：oauth-personal、gemini-api-key、vertex-ai、cloud-shell、openai、anthropic、bedrock
- `common/config/storage.ts` —— `IProvider` 完整接口（id、platform、name、base_url、api_key、models、capabilities、context_limit、model_protocols、bedrock_config、is_full_url）

### 1.3 设置页

- `renderer/components/settings/SettingsModal/contents/ModelModalContent.tsx` —— Provider 列表页：每个 provider 一个 Arco `Collapse`，含模型启用开关、健康检查按钮、API key 数量
- `renderer/pages/settings/components/AddPlatformModal.tsx` —— 新增表单：platform Select、base_url、api_key（支持多 key）、模型多选、**协议检测状态**
- `renderer/hooks/agent/useModeModeList.ts` —— SWR hook 调 `fetchModelList`

要点：前端不直接拼 Provider 存储结构，全部走 REST 由后端持久化；模型列表可"匿名拉取"（未保存先预览）。

---

## A2. 聊天 UX 实现细节（重点）

所有路径基于 `aionui/packages/desktop/src/`。

### 2.1 流式输出 —— 真实增量追加，**没有打字机动画**

**结论：没有逐字打字机动画，没有闪烁光标。** 流式渲染依赖 WS 增量事件做真实文本拼接。

- 合并逻辑在 `common/chat/chatLib.ts`：`composeMessage` / `mergeTextMessageContent` 做流式合并 —— `content: incomingReplace ? incoming.content : existing.content + incoming.content`（默认字符串尾接追加）
- `TMessage` 是按 `type` 区分的判别联合：text、tips、tool_call、tool_group、agent_status、permission、acp_permission、ask、acp_tool_call、plan、thinking、available_commands、acp_terminal_output
- 批处理在 `renderer/pages/conversation/Messages/hooks.ts`：`useMergeLiveMessage` 用 `setTimeout(flush)` 把同一帧多条 WS 消息批量合并，按 `msg_id`/`call_id`/`tool_call_id`/`terminal_id` 缓存合并；thinking 合并键是 `thinking:${msg_id}`，`done` 帧原地替换
- 全局只有 `useTypewriterPlaceholder`（登录/引导页占位符），聊天列表没有 per-char 渲染

**移植性要点**：要做"逐字打字机"需自行加；当前设计是"事件驱动 + 不可变追加"，对 React 友好。

### 2.2 思考过程结束后自动折叠

文件：`renderer/pages/conversation/Messages/components/MessageThinking.tsx` + `MessageThinking.module.css`

- 折叠状态：`useState(!isDone)`（thinking 期间默认展开）
- 自动收起：`useEffect(() => { if (isDone) setExpanded(false) }, [isDone])` —— 收到 `status:"done"` 后自动折叠
- 计时器：thinking 期间 `setInterval(..., 1000)` 每秒更新耗时
- 头部图标：thinking 中 = Spin 旋转图标 + "Thinking... · Xs"；完成后 = Brain 图标 + "Thought complete · Xs"
- **关键**：CSS 里 `.collapsed { display: none; }` —— 折叠是**瞬间隐藏，没有高度动画**；唯一动画是箭头旋转 `transition: transform 0.2s ease`

> 真正的平滑高度过渡动画在另一个组件 `CollapsibleContent`（见 2.4），thinking 折叠**没有用它**。

### 2.3 聊天文本渲染（Markdown / 代码块 / 流式解析）

- 主渲染：`renderer/components/Markdown/index.tsx` —— `MarkdownView` 是 ReactMarkdown 封装：`rehypeKatex`、memoized 自定义组件（`code → CodeBlock`、`a → LocalFileLink`、`table → MarkdownTable`、`img → LocalImageView`）
  - 注释明确：**memoizing 组件是为了流式更新时不卸载/重挂 DOM**，保持 hooks 与滚动状态
- 文本气泡：`Messages/components/MessageText.tsx` —— AI 消息走 `MarkdownView`，用户消息 `whitespace-pre-wrap`；用 `stripThinkTags` 剥离 `thinking` 标签；JSON 内容包在 `CollapsibleContent maxHeight={200} defaultCollapsed` 里
- 列表层：`Messages/MessageList.tsx` —— **不是虚拟列表**，直接 `.map` 渲染；预处理把多个 tool_calls 聚合成 `tool_summary` 卡片、diff 聚合成 `file_summary`；`React.memo` + 自定义比较器减少重渲染

**结论**：流式 Markdown 就是"不断变化的完整字符串喂给 ReactMarkdown"，靠 memoized 组件保住 DOM，没有增量 AST 解析。

### 2.4 折叠/展开高度过渡动画（CollapsibleContent）

文件：`renderer/components/chat/CollapsibleContent.tsx` —— 项目里**唯一的 max-height 过渡动画**实现：

- `maxHeight: isCollapsed ? maxHeight px : undefined` + CSS `transition-all duration-300`
- `ResizeObserver` 检测内容是否超高需要折叠
- 渐变遮罩 fade-out + 展开/折叠切换按钮

**移植性要点**：这是把"折叠动画"做得顺滑的现成方案（max-height + transition 比 `display:none` 平滑），值得直接抄。

### 2.5 自动滚动

文件：`Messages/useAutoScroll.ts` —— `ResizeObserver` 监听 scroller + content；`FOLLOW_BOTTOM_THRESHOLD_PX = 4`（贴底阈值）、`AT_BOTTOM_THRESHOLD_PX = 100`（显示"回到底部"按钮）；`requestAnimationFrame` 节流。

### 2.6 ACP 工具调用渲染

三个组件在 `Messages/acp/`：

| 组件 | 展示 | 交互 |
|---|---|---|
| `MessageAcpToolCall.tsx` | Arco `Card` + 标题 + `StatusTag`（pending=蓝、in_progress=橙）+ 输入 JSON + diff 面板 | 图片经 LocalImageView + 下载 |
| `MessageAcpPermission.tsx` | 权限请求卡片，选项映射到 `PermissionRequestPanel` | `onConfirm` 调 `conversation.confirmMessage` |
| `MessageAcpTerminalOutput.tsx` | 命令 `$...` + 状态 Tag + 输出 `<pre>` | 运行中自动 tail 滚动，"Stop" 调 `killTerminal` |

### 2.7 移植性评估小结

| 想要的效果 | Aion 现状 | 可借鉴度 |
|---|---|---|
| 打字机/闪烁光标 | 无 | 需自建 |
| 流式增量渲染 | 事件追加 + memoized 组件 | 与 cloudcli 同思路 |
| 思考自动折叠 | `display:none` 瞬间收起 | cloudcli 的 Reasoning 组件反而更完整，只需接线 |
| 平滑高度折叠动画 | `CollapsibleContent` max-height + transition | ✅ 值得抄 |
| Markdown/代码块流式解析 | ReactMarkdown + memo 组件 | 等价 |
| 工具调用卡片/状态图标 | Card + StatusTag | 等价 |

---

## B1. Provider 机制（后端视角）

### B1.1 数据层与实体

- `AionCore/crates/aionui-db/src/repository/provider.rs` —— `IProviderRepository` trait（list/find_by_id/create/update/delete），`CreateProviderParams`/`UpdateProviderParams`（字段与前端 `IProvider` 一一对应）
- api_key **加密存储**（`api_key_encrypted`）

### B1.2 服务层（`aionui-system/src/provider.rs`）

- `ProviderService::create()` 用 `encrypt_string(&req.api_key, &self.encryption_key)` 加密后落库
- `row_to_response()` 读取时解密（**宽松降级**：解不开的 key 变空串，不报错）
- 校验：base_url 必须 http/https、platform/name 必填；bedrock 允许空 base_url/api_key 但必须带 `bedrock_config`

### B1.3 路由（`aionui-system/src/routes.rs`）

```
GET    /api/providers
POST   /api/providers
POST   /api/providers/detect-protocol      ← 字面量段注册在 /{id} 之前
POST   /api/providers/fetch-models         ← 匿名拉模型（未保存先预览）
PUT    /api/providers/{id}
DELETE /api/providers/{id}
POST   /api/providers/{id}/models
```

### B1.4 DTO（`aionui-api-types/src/provider.rs`）

- `ProviderResponse`（**api_key 明文返回**——pre-launch 约定，不做掩码）、`CreateProviderRequest`、`FetchModelsResponse`（`Vec<ModelInfo>`）
- `ModelType` 枚举：Text、Vision、FunctionCalling、ImageGeneration、WebSearch、Reasoning、Embedding、Rerank、ExcludeFromPrimary
- `ModelCapability`、`ModelSettings`（image_input、openai_api_mode）、`BedrockConfig`、`ProtocolDetectionResponse`

### B1.5 按平台拉模型（`aionui-system/src/model_fetcher/fetchers.rs`）

`fetch_for_platform` 按 platform 分发：anthropic/claude、gemini、bedrock、vertex-ai、new-api、minimax、dashscope-coding，默认走 OpenAI-compatible `/models`。anthropic 失败时回退硬编码模型列表。

### B1.6 Provider 如何关联 Agent（api_key 喂给引擎的关键接线）

**第一步：会话行存模型引用。**
- `aionui-conversation/src/convert.rs` —— 会话 `conversations.model` JSON 列存**前端整份 `TProviderWithModel`**，后端 `parse_provider_with_model` 宽松解析只抽取 `{ provider_id, model, use_model }`
- `aionui-conversation/src/task_options.rs` —— 发消息/定时任务时解析出 `ProviderWithModel`

**第二步：Agent 工厂按 provider_id 取回密文并解密。**
- `aionui-ai-agent/src/factory/aionrs.rs`（`build` 函数）：
  1. `provider_repo.find_by_id(user_id, provider_id)` 取回 Provider 行
  2. `decrypt_string(api_key_encrypted, encryption_key)` 解密出 api_key
  3. `map_aionrs_provider(platform, model_id, model_protocols)` 映射成 aionrs 内部 provider 标识
  4. `resolve_aionrs_url_and_compat_with_mode` 决定 base_url + OpenAI/Anthropic 兼容模式（Responses vs Chat Completions）
  5. 拼成 `AionrsResolvedConfig { provider, api_key, model, base_url, compat_overrides, ... }` 注入 agent 会话

**结论**：provider 与 agent 关联 = 会话行 `model` JSON（存 provider_id + 模型名）→ 任务构建解析成 `ProviderWithModel` → 工厂按 provider_id 反查解密 api_key 再按平台拼装引擎参数。

---

## B2. 流式消息的产生与推送（服务端）

### B2.1 事件类型（`aionui-ai-agent/src/protocol/events/mod.rs`）

`AgentStreamEvent` 是后端统一流事件枚举，serde tag 即 wire 上的 `type`：

- 对外事件：`content`（Text）、`thinking`、`tool_call`、`acp_tool_call`、`tool_group`、`tips`、`agent_status`、`plan`、`permission`/`acp_permission`/`ask`、`acp_terminal_output`、`finish`/`error`、`available_commands`
- 纯内部信号（不转发 WS）：`SegmentBreak`（段间软边界）、`BackendTurnBound`（fork 锚点）、`AcpDialectSignal`、`MessageLifecycle`

### B2.2 `message.stream` 的产生链路

```text title=流式消息完整链路
用户 POST /api/conversations/:id/messages
  → ConversationService::send_message   (service.rs:3797)
  → build_task_options(row)             从会话行解析 ProviderWithModel
  → ConversationTurnOrchestrator::run_user_turn
  → run_attempt                          (turn_orchestrator.rs:98)
      → agent = AgentFactory 构建的 AgentInstance
      → StreamRelay::new                  (turn_orchestrator.rs:283)
      → agent.subscribe()                订阅 broadcast channel
      → relay.consume_with_send_error(rx, send_error_rx)   (stream_relay.rs:274)
```

转发核心：`aionui-conversation/src/stream_relay.rs` `forward_to_websocket_with_msg_id`（line 855）把 `AgentStreamEvent` 序列化、`normalize_keys_to_snake_case` 归一化键名，包成：

```json title=WS 消息载荷
{
  "conversation_id": "...", "msg_id": "...", "turn_id": "...",
  "type": "content" | "thinking" | "tool_call" | ...,
  "data": { ... }, "hidden": false,
  "user_id": "...", "backend_turn_id": "..."
}
```

再 `broadcast_stream_payload` 组装成 `WebSocketMessage::new("message.stream", payload)` 发出。文本增量就是多次 `content` 事件、同一 `msg_id`、`data.content` 逐段追加。

### B2.3 文本/思考/工具块在 wire 上如何区分

- **靠 `type` 字段 + `msg_id` 归并**：
  - 文本流：`type:"content"`，同 `msg_id` 连续追加；工具调用发生时**关闭当前文本段**（新起 `msg_id`），把回复切成多个气泡
  - 思考：`type:"thinking"`，`data.status:"thinking"|"done"`、`data.duration`；`done` 帧触发前端自动折叠；空思考块被 relay 丢弃（不产空卡片）
  - 工具调用：`type:"tool_call"`，`data.call_id/name/args/status/output/description`
  - 终帧：`type:"finish"` / `type:"error"`
- **最终文本改写**：`send_final_text_override`（line 970）发 `type:"content"` + `replace:true`，前端据此**原地替换**而非追加

### B2.4 WebSocket 广播

- 事件信封：`aionui-api-types/src/websocket.rs` —— `WebSocketMessage<T> { name, data }`，单一 `/ws` 端点
- 广播：`aionui-realtime/src/broadcaster.rs` —— `EventBroadcaster` trait + `BroadcastEventBus`（`tokio::sync::broadcast`）；业务模块只依赖 `Arc<dyn EventBroadcaster>`

### B2.5 前端收到的结构

前端 `ipcBridge.conversation.responseStream` 收到 payload 后，`chatLib.ts` 的 `transformMessage` 映射成 `TMessage` 判别联合，`hooks.ts` 的 `useMergeLiveMessage` 按 `msg_id`/`call_id`/`terminal_id` 合并，交给 `MessageList.tsx` 渲染。

---

## C. 对 cloudcli 的借鉴结论

### 架构层

1. **流式文本**：aionui 是"事件追加 + ReactMarkdown 全量重渲染 + memoized 组件保 DOM"，没有打字机。cloudcli 已有类似 WS 流，可沿用同一 msg_id 追加策略
2. **思考折叠**：aionui 用 `display:none` 瞬间收起 + 图标/计时器状态机，简单但无动画；**平滑折叠需抄 `CollapsibleContent.tsx` 的 max-height + transition 方案**
3. **Provider→Agent 接线范式**：会话行存 `{provider_id, model}`，工厂按 provider_id 反查解密 api_key 再按平台组装——这是"provider 多引擎复用"的干净范式（cloudcli 目前 provider 即引擎，暂用不上；若要加"模型平台"概念可参考）
4. **协议拉模型**：按 platform 分发的 fetcher + 匿名预创建拉取 + 失败回退列表，可抄的后端模式
5. **wire 契约**：`{name, data}` 信封 + `message.stream` 下 `{conversation_id, msg_id, turn_id, type, data, hidden, replace?}`，文本/思考/工具块全靠 `type` + `msg_id` 归并

### 与 cloudcli 现状的差异点（决定"取精华"方向）

- **打字机效果**：Aion 也没有，两个项目都缺 → 需自建（建议只做闪烁光标）
- **思考自动收缩**：cloudcli 的 `Reasoning` 组件已内置 auto-open/auto-close 逻辑但未接线（`MessageComponent` 没传 `isStreaming`）；Aion 的实现反而是 `display:none` 瞬间收起 → **优先接线 cloudcli 已有能力，再考虑抄 Aion 的平滑动画**
- **文字渲染**：两者等价；Aion 的 `CollapsibleContent` max-height 过渡、`stripThinkTags`、工具卡片状态机值得参考
