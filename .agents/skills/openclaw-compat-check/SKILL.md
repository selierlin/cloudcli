---
name: openclaw-compat-check
description: 检查 OpenClaw CLI/Gateway 升级后，CloudCLI 是否仍能读取其每 agent 的 SQLite 会话历史与 ACP 实时事件语义。用于 OpenClaw 历史消息缺失、工具卡片异常、注入内容误显示或格式兼容性复核；不用于 Claude、Codex、DSH、Pi、ZCode、OMP 或 WorkBuddy。
disable-model-invocation: true
---

# OpenClaw 会话格式兼容性检查

CloudCLI 只读 OpenClaw 写入的会话数据库，绝不修改它。OpenClaw 是 Pi 引擎的衍生 fork，**会话行格式就是 Pi 的 entry 格式**（`type` + `message.role` + `content` blocks + `parentId` 树），但**持久化 SSOT 已从「扫 jsonl」迁到 SQLite**：每个 agent 一个 `openclaw-agent.sqlite`。升级若改表、改事件结构、改注入头，CloudCLI 会静默漏消息、把注入内容显示成用户输入，或让工具卡片消失。

## 范围与不变量

- 只读；不可修复、迁移或写入用户的 `~/.openclaw`。
- 数据库根：`OPENCLAW_STATE_DIR`；未设置时为 `~/.openclaw`（与 `getOpenclawHomeDir()` 一致）。
- 每 agent 的库在 `<root>/agents/<agentId>/agent/openclaw-agent.sqlite`；`getOpenclawAgentIds()` 只认**含该 sqlite 的目录**。
- 检查目标：
  - `server/modules/providers/list/openclaw/openclaw-sessions.provider.ts`：`fetchHistory`（active 分支读取）、`decodeOpenclawTranscriptEvent`（zstd 解压）、`stripOpenclawInboundMetadata`（注入剥离）、`normalizeOpenclawAgentMessage`（Pi entry 归一）。
  - `server/modules/providers/list/openclaw/openclaw-session-synchronizer.provider.ts`：会话发现、`session_key`/project 映射、删除。
  - `server/modules/providers/list/openclaw/openclaw-models.provider.ts`：路径解析与 `getOpenclawAgentIds()`。
  - `server/modules/providers/services/provider-token-usage.service.ts`：`readOpenclawTokenUsage`。
  - `server/modules/providers/services/sessions-watcher.service.ts`：watcher 目标文件过滤。
- 以本机真实 SQLite 数据为准；不为尚未出现的版本猜测格式。

## 格式基线（接入时 OpenClaw 2026.9.9）

**索引表**（读取逻辑依赖的字段）：`session_nodes(session_key, current_session_id, display_name, created_at, updated_at)`、`session_windows(session_id, session_key, created_at, updated_at)`、`session_transcript_active_events(session_id, active_position, event_seq)`、`session_transcript_index_state(session_id)`。

**事件表** `transcript_events(session_id, seq, event_json, event_zstd, navigation_json, ...)`：事件正文在 `event_json`（明文）或 `event_zstd`（Zstandard blob，二者互斥），用 `node:zlib.zstdDecompressSync` 解压。**历史只走当前分支**：`session_transcript_active_events JOIN transcript_events ON (session_id, seq = event_seq) ORDER BY active_position`；不需要 `parentId` 树回溯。`seq=0` 是 `session` header（携带 `cwd`），**不一定在 active 集里**，同步器单独读它取 project_path。

| `entry.type` | CloudCLI 处理 |
|---|---|
| `message` | 唯一渲染类型，按 `message.role` 归一 |
| `session` | header（`seq=0`，`cwd` → project_path） |
| `custom` / `custom_message` | 元数据，不渲染 |
| `thinking_level_change` | 元数据，不渲染 |
| `model_change` | 元数据（作答模型在 assistant `message.model` 上，另读） |
| `leaf` | 分支叶子标记，元数据 |

`message.role` 已知为 `user`、`assistant`、`toolResult`（三者均已适配）。`content[]` 已知 block：`text`、`thinking`、`toolCall`、`image`；`user` 消息的 `content` 也可能是**纯字符串**（已按 `readOpenclawUserText` 处理）。assistant 一 block 一行（thinking 先于 text）。

**注入剥离**（`role:user` 历史）是本模块最高优先级的兼容信号：OpenClaw 会把渠道上下文写进用户文本，CloudCLI 靠 `⟦openclaw:ctx⟧` marker、`[EEE YYYY-MM-DD HH:MM …]` 时间戳前缀、`MESSAGE_TOOL_DELIVERY_HINTS`、`<active_memory_plugin>` 块与合成引导前缀（`A new session was started via /new or /reset`、`[cron:`）剥离。**剥完为空的行不渲染**——注入头变样会让整个 header 变成一条假用户消息。

## ACP 实时层（与历史分离）

实时只走 `openclaw acp`（JSON-RPC over stdio → 常驻 Gateway）。`session/update` 通知形状为 `{sessionId, update:{sessionUpdate, content}}`，**chunk 不带 `messageId`**（runtime 自铸 per-segment id 并累积快照）。已知 `sessionUpdate`：`agent_message_chunk`→text、`agent_thought_chunk`→thinking、`tool_call`/`tool_call_update`→tool_use/result、`session/request_permission`→permission_request；`session_info_update`/`available_commands_update`/`usage_update` 为元数据。**实测每轮只收到一个终段 `agent_message_chunk`**（Gateway 的 live delta 广播不送达 ACP 客户端），故 OpenClaw 属 `WHOLE_SEGMENT_PROVIDERS`。出现新 `sessionUpdate` 或 chunk 开始携带 `messageId` 时，需评估 runtime 的累积/封段逻辑。

## 工作流

在仓库根目录运行：

```bash
node .agents/skills/openclaw-compat-check/check-openclaw-format.mjs
node .agents/skills/openclaw-compat-check/check-openclaw-format.mjs --all
node .agents/skills/openclaw-compat-check/check-openclaw-format.mjs /path/to/openclaw-agent.sqlite
```

- 默认检查每个 agent 的**最新一条**会话；`--all` 各取 5 条。
- 报告 `🆕`：真实的新 `entry.type` / `message.role` / `content[].type`，需确认是否携带要展示的历史内容。
- 报告 `⚠️ active 悬挂`：`session_transcript_active_events` 指向的 `event_seq` 在 `transcript_events` 里缺失，历史会少读。
- 报告 `ℹ️ 无注入特征样本`：本会话没有注入头可验证剥离路径，属信息性，不是错误。
- 空目录或无库不代表兼容；请先运行一次 OpenClaw，或传入指定 db。

## 适配与验证

1. 新 entry.type：只有携带历史正文时才在 `fetchHistory` 的归一分支处理；纯元数据不渲染。
2. 新 role / block：在 `normalizeOpenclawAgentMessage()` 补最小映射（thinking 先于 text；toolResult 挂 `toolCallId`）。
3. 缺表或字段：复核 `fetchHistory` 的 SQL、`openclaw-session-synchronizer.provider.ts` 的索引与删除路径、以及 watcher 规则；不能只改历史读取。
4. 注入特征变样：同步 `stripOpenclawInboundMetadata`，并更新 `OPENCLAW_SYNTHETIC_USER_PREFIXES`。
5. 在 `server/modules/providers/tests/fixtures/openclaw-agent-db.ts` 用新格式构造数据库，补 `openclaw-sessions.test.ts` / `openclaw-session-synchronizer.test.ts`，再运行：

```bash
npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/openclaw-sessions.test.ts
npm run typecheck
```

证据只认两类：已在真实数据库/真实 ACP 会话中确认的格式，以及 OpenClaw 随包发布的 schema（`dist/` 里的 `kysely`/SQLite migration 与 `agent-harness` 定义）。**计划文档 `docs/research/CloudCLI接入OpenClaw-Provider实施计划.md` 是本模块的契约 SSOT**，改动格式认知时一并回写它。
