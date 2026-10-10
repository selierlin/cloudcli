# CloudCLI 接入 OpenClaw Provider 实施计划

> **状态**：v1 · **P0/P1/P2/P3/P4 全部完成**（P2 = ACP 实时 runtime，真机 E2E 已通；P3 = fork 确定不支持、MCP 维持 harness-managed；P4 = `openclaw-compat-check` 技能已落地并实测）。**接入后补修两处真缺陷（2026-10-11）**：① ACP 桥默认给 prompt 前置的 `[Working directory: …]` 注入前缀会显示在用户消息里 ⇒ spawn 加 `--no-prefix-cwd` + 读取侧剥离（§3）；② 全局扫描游标令接入前的存量会话永不回填 ⇒ 照 pi/omp/workbuddy 加「首次扫描全量」（§2.2）。**剩余＝P1 真机验收**（重建 `dist-server` 后由用户重启守护进程）见 §7。
> **日期**：2026-10-10
> **用途**：本文档是 OpenClaw（`openclaw`，npm 包 `openclaw`，本机 OpenClaw 2026.9.9）作为**新 harness/provider** 接入 CloudCLI 的完整实施方案，也是后续 `openclaw-compat-check` 技能与实现代码的共同契约源。所有格式结论均以本机真实数据/打包源码实测为准；未实测的一律标注。
> **参考规范**：`server/modules/providers/README.md`（How To Add A Provider 9 步）、同目录 `CloudCLI接入ZCode-Provider实施计划.md`（格式模板；OpenClaw 读路径同为 SQLite，最贴近）。

---

## Context

CloudCLI 现支持 claude / codex / cursor / dsh / omp / opencode / pi / workbuddy / zcode 九个 provider。用户本机已装并配置 OpenClaw（`~/.local/share/node/current/bin/openclaw`，数据在 `~/.openclaw/`），且已用 dotfiles + 快照制管理费用模型（MiMo / wuanai）。现希望把 OpenClaw 作为**第十个 provider** 完整接入 CloudCLI。

**分期决策（用户已定）**：先做 **P0（契约固化）+ P1（只读接入，历史可见可读）**，交付后验收再做 P2（实时）；Gateway 生命周期由 P2 处理，P1 假定它已在跑；MCP 矩阵新增 `openclaw` 列（编译强制 + 需 ALTER 迁移）已接受。

**与已有 provider 的关键差异（决定本方案如何复用）**：OpenClaw 是 **Pi 引擎的衍生 fork**（依赖 `@earendil-works/pi-tui`），会话**行格式就是 Pi 的 entry 格式**；但它的**会话 SSOT 已从「扫 jsonl」迁到 SQLite**（`~/.openclaw/agents/<id>/agent/openclaw-agent.sqlite`）。因此：
- **读取层**：读法是 **SQLite reader**（照 ZCode/OpenCode），但**归一化内容复用 Pi 的 entry 解析**（`message.role` / `content` blocks / `parentId` 树）。
- **实时层**：唯一官方流式通道是 **`openclaw acp`（JSON-RPC over stdio，ACP 协议）**，走常驻 Gateway；照 **dsh 的 ACP 客户端**形状写（**原写「照 Codex app-server」是笔误**——codex 是另一套协议）。注意：实测每轮只收到一个终段帧（详见 §3「流式粒度」）。

---

## 已实测确认的 OpenClaw 事实

### 二进制与调用

- 入口：`~/.local/share/node/current/bin/openclaw`（node bundle `openclaw.mjs`）；`openclaw --version` → `OpenClaw 2026.9.9 (bcfc888)`。
- 状态隔离：`--profile <name>` 把 `OPENCLAW_STATE_DIR`/`OPENCLAW_CONFIG_PATH` 隔离到 `~/.openclaw-<name>`；`--dev` 用 `~/.openclaw-dev` + 端口 19001。默认 state root = `~/.openclaw`。
- 多 agent：`~/.openclaw/agents/<agentId>/`（本机 `main` 为活动 agent）；每个 agent 独立 workspace / auth / **会话 SQLite**。会话 key 形如 `agent:<agentId>:<key>`（`agent:main:main`、`agent:main:dingtalk:group:...`）。

### 会话存储（SQLite —— 本方案核心）

- **每 agent 会话库**：`~/.openclaw/agents/<agentId>/agent/openclaw-agent.sqlite`（WAL；本机 8.2MB + 3.5MB WAL）。**磁盘 `agents/<id>/sessions/<uuid>.jsonl` 是遗留物，自 2026-08-02 停写**；新会话无对应文件。**读路径必须面向 SQLite**。
- 全局库 `~/.openclaw/state/openclaw.sqlite`（auth store、acp、audit 等），**不读**。

关键表（`sqlite_master`，STRICT）：

| 表 | 关键列 | 用途 |
|---|---|---|
| `transcript_events` | `session_id, seq, event_json TEXT \| event_zstd BLOB, created_at, event_utf8_bytes, navigation_json` | **会话正文**：每行一条 Pi entry。`event_json`（明文）与 `event_zstd`（zstd 压缩，1..4MiB）互斥（CHECK） |
| `session_transcript_active_events` | `session_id, active_position, event_seq, message_position, context_eligible` | **active 分支**：按 `active_position` 排出当前生效路径（已做 leaf 选择） |
| `session_nodes` | `session_key PK, current_session_id, entry_json, updated_at, created_at, status, display_name, label, archived_at, project_id, parent_session_key, fork_source_*` | **会话索引** + 元数据（`entry_json` 含 model/tokens/时间） |
| `session_windows` | `session_id PK, session_key, model_provider, model, display_name, started_at/ended_at, status, channel, previous_session_id` | 窗口（reset/rollover/fork 会产生多个 session_id 指向同一 session_key） |
| `session_transcript_index_state` | `session_id, indexed_seq, leaf_event_id, active_event_count` | 索引状态（不读） |

`session_transcript_archives` / `session_transcript_cold_archives` 是冷归档表，**P1 不读**（只读活动窗口）。

### 会话行格式（Pi 血统）

`transcript_events.seq=0` 恒为 header：`{"type":"session","version":3|4,"id":"<session_id>","timestamp":ISO,"cwd":"<绝对路径>"}`（`version` 实测 3 或 4；磁盘遗留文件为 3，DB 新会话为 4）。`seq>=1` 为 entry，字段在**顶层**：`id`（短 hex 或 UUID）、`parentId`（构成树，可 null）、`timestamp`、`type`。

- **顶层 `type` 实测全集**：`message`、`custom`、`session`、`thinking_level_change`、`model_change`、`leaf`、`custom_message`。（打包 `.d.ts` 的 `SessionEntry` union 更宽：另有 `compaction`/`reset`/`branch_summary`/`session_info`/`label`——本机未出现，属升级信号。）
- **`message.role`**：`user` / `assistant` / `toolResult`。assistant 额外带 `api`/`provider`/`model`/`usage`/`stopReason`/`responseId`/`errorMessage`。
- **content block 类型**：`{type:'text',text}`、`{type:'thinking',thinking,thinkingSignature}`、`{type:'toolCall',id,name,arguments,partialArgs}`、`{type:'image',data,mimeType}`；`toolResult`/部分消息的 `content` 也可是**纯字符串**。
- **`toolResult` 消息**：`{role:'toolResult', toolCallId, toolName, content:[...], details, isError}`。
- **`custom` 子类型实测**：`model-snapshot`、`openclaw:prompt-error`。**`custom_message`** 实测 `customType:'openclaw:turn-aborted'`（`display:false`）。`leaf` = `{targetId}`（leaf 控制）。
- `message_position`（active_events 列）：消息在 active 路径上的 0 基序号，非消息 entry 为 null。
- **`active_events` 永不包含 seq=0**（header 单独取）；实测 active 覆盖 < 总事件数（如 119/122），即确实排除了废弃分支。

### 读取算法（P1 核心）

```
索引：SELECT ... FROM session_nodes（+ session_windows 取 model）WHERE archived_at IS NULL
历史：
  1) header = transcript_events WHERE session_id=? AND seq=0 → cwd, id, version
  2) seqs = session_transcript_active_events WHERE session_id=? ORDER BY active_position
  3) rows = transcript_events WHERE session_id=? AND seq IN (seqs)
     → event_json 直接 JSON.parse；event_zstd 用 node:zlib.zstdDecompressSync 解压
  4) 逐 entry 归一（复用 Pi 的 role/content block 解析）
```

- zstd 解压已验证：`zlib.zstdDecompressSync(row.event_zstd)` 得明文 entry。
- 分页用共享 `sliceTailPage`；`limit:null`=全量 / `limit:0`=空页 / 必返 `total,hasMore,offset,limit`。

### 注入内容（读取必须过滤）

OpenClaw 把大量**注入上下文**写成 `role:'user'` 的 message，CloudCLI 若不剥离会当成用户输入。OpenClaw 自身用 `dist/strip-inbound-meta-*.mjs` 剥离，键如下（**cloudcli 需复刻一份，不 import 其 dist**）：

- **inbound context marker**：`⟦openclaw:ctx⟧`（`dist/inbound-context-marker-*.mjs`，注释明言「多份拷贝须保持一致，漂移会静默停止剥离」——**是兼容信号**）。标记出现在 `Sender: … ⟦openclaw:ctx⟧` / `Context: ⟦openclaw:ctx⟧` 后跟 ```json 块的行。
- **前导时间戳前缀**：`/^\[[A-Za-z]{3} \d{4}-\d{2}-\d{2} \d{2}:\d{2}[^\]]*\] */`（如 `[Sat 2026-08-02 04:04 UTC] `）。
- **`message` 工具投递提示**：`MESSAGE_TOOL_DELIVERY_HINTS`（`Delivery: …` 系列句）。
- **活动记忆块**：`<active_memory_plugin>…</active_memory_plugin>` / `Context:` 段。
- **bootstrap/合成 prompt**：首条 `role:user` 常为 `A new session was started via /new or /reset. Execute your Session Startup sequence now - …`（openclaw 自身 bootstrap 文案）；`[cron:<id> <name>] …` 是 cron 注入。**会话名 fallback 与历史渲染都应跳过这些**。

### 实时运行通道（P2）

- **唯一流式通道 = `openclaw acp`**（JSON-RPC over stdio，ACP 协议，SDK `@agentclientprotocol/sdk@1.4.0`；走 Gateway，`ws://127.0.0.1:18789` + token）。方法：`initialize`/`authenticate`/`session/new`/`session/load`/`session/prompt`/`session/cancel`/`session/update`(通知)/`session/request_permission`/`session/list`/`session/delete`/`fork`/`resume`/`set_mode`/`set_config_option`。流式事件：`agent_message_chunk` / `agent_thought_chunk` / `tool_call(_update)` / `session/request_permission`。
- **非流式（不可用于逐 chit）**：`openclaw agent --json` / `openclaw agent exec --json` 都是「跑完整轮、末尾一次性输出」；且 `agent exec` 每次随机 `sessionId` + 临时 state 目录（跑完删除），**不能续跑**。
- 权限/审批：`openclaw approvals` / `exec-approvals` / `exec-policy`；`agent exec --code-mode direct|auto|code`；ACP 侧经 `exec.approval.requested → session/request_permission`。
- **前置条件**：ACP 依赖 Gateway 常驻（本机 launchd 托管）。冷态需先 `openclaw gateway start`。

### 认证 / 模型 / Skills / MCP

- **认证**：主通道 `openclaw models status --json` → `{ defaultModel, auth:{ providers:[{provider, effective:{kind}, profiles:{apiKey,oauth,token,labels}}], missingProvidersInUse, modelRouteIssues } }`。"已登录"= `profiles.apiKey|oauth|token > 0` 且 `missingProvidersInUse` 空；或 `openclaw.json` 的 `models.providers.<id>.apiKey` 内联（本机 mimo/wuanai 即内联）。凭据落点 `~/.openclaw/state/openclaw.sqlite`（auth store）。"已安装"= `openclaw --version` 成功。
- **模型**：`openclaw models list --json` → `{ count, models:[{key,name,input,contextWindow,local,available,tags:["default"]}] }`（`key`=`<provider>/<modelId>`）。配置 `~/.openclaw/openclaw.json`：`models.providers.<id>.{baseUrl,apiKey,api,models:[{id,name,contextWindow,input,maxTokens,reasoning}]}`；默认模型 `agents.defaults.model.primary`（=`models status` 的 `defaultModel`）。
- **Skills**：`openclaw skills`（list/search/info/install/update/…）。根：bundled（安装目录 `.../openclaw/skills`）、custodian（`.../openclaw/custodian-skills`）、插件符号链 `~/.openclaw/plugin-skills/`、托管 `~/.openclaw/skills`、项目/额外目录（config `skills.load.extraDirs`）。`SKILL.md` frontmatter：`name`/`description`/`metadata.openclaw.*`。配置 `skills.entries.<name>.enabled`。
- **MCP**：`openclaw mcp`（add/list/set/show/status/tools/…）。schema 在 `openclaw.json` 的 `mcp.servers`（`additionalProperties`，键含 `enabled`/`command`/`args`/`env`/`cwd`/`url`/`transport:stdio|sse|streamable-http`/`headers`/`auth`/`oauth`…）。**只有 user 一级 scope**（无项目级）。

---

## 与已有 Provider 的关键差异

| provider | 存储 | 行格式 | 本方案借鉴 |
|---|---|---|---|
| Claude / WorkBuddy / Pi / DSH | JSONL 文件 | 各自 | Pi 的 **entry/message/content 解析**（OpenClaw 行格式=Pi） |
| ZCode / OpenCode | SQLite | OpenCode `part.data` | **SQLite reader + synchronizer 骨架**（读法是本方案模板） |
| **OpenClaw** | **SQLite（agent 库）** | **Pi entry（`version:3/4`、`parentId` 树、`message.role`/`content` blocks）** | 读法照 ZCode、内容照 Pi —— **混合** |

三个独有风险点：
1. **SSOT 已迁 SQLite**：按文件扫会**读到空**（新会话无 jsonl 文件）。
2. **zstd 压缩行 + v4 header**：`event_json`/`event_zstd` 互斥，需按列分派解压；version 3/4 都要接受。
3. **注入上下文伪装成 user**：`⟦openclaw:ctx⟧` 等标记 + bootstrap/cron prompt，漏剥离会污染历史与会话名。

---

## 1. 文件清单

### 新建 `server/modules/providers/list/openclaw/`

| 文件 | 职责 | 模板 |
|---|---|---|
| `openclaw.provider.ts` | Wrapper，`super('openclaw')`，组装各 facet | `zcode.provider.ts` |
| `openclaw-auth.provider.ts` | `installed` = `openclaw --version`；`authenticated` = `models status --json` 的 profiles 判定（或配置内联 key）。30s 缓存。导出 `resolveOpenclawCommand()` / `getOpenclawCommand()`（供 shell/P2） | `zcode-auth.provider.ts` |
| `openclaw-models.provider.ts` | `getSupportedModels()`：优先 `models list --json`，回退读 `openclaw.json` 的 `models.providers.*.models`；`DEFAULT` 取 `agents.defaults.model.primary`。导出 `getOpenclawHomeDir()` / `getOpenclawAgentDbPath(agentId)` / `getOpenclawAgentIds()`（供其它 facet 与 watcher） | `zcode-models.provider.ts` |
| `openclaw-sessions.provider.ts` | **`fetchHistory`（SQLite reader：active-path + zstd + 注入剥离 + Pi entry 归一）**；`normalizeMessage`（实时 ACP，P2 前先给最小分支/返回 `[]`）。**核心文件** | `zcode-sessions.provider.ts` + `pi-sessions.provider.ts` 的归一化 |
| `openclaw-session-synchronizer.provider.ts` | 扫每个 agent 库的 `session_nodes` upsert；`projectPath` 取 header `cwd`；`jsonl_path=null`；实现 `deleteProviderSession`（共享库防复活） | `zcode-session-synchronizer.provider.ts` |
| `openclaw-skills.provider.ts` | 扫 `~/.openclaw/skills` + `plugin-skills` + 项目/额外目录的 `SKILL.md`；命令语法待定（见 §5） | `zcode-skills.provider.ts` |
| `openclaw-mcp.provider.ts` | **P1 = 空适配器**（`super('openclaw', [], [])`，写抛错，照 omp）；P3 补 `mcp.servers` 读写（user scope） | `omp-mcp.provider.ts` → P3 换 `zcode-mcp.provider.ts` |
| `openclaw-runtime.provider.ts` | **P1 = 守卫**（`run()` 抛"实时未启用"，`abort()`→false）；P2 换 ACP 客户端 | P2 照 `codex-app-server.client.ts` + `codex-runtime.provider.ts` |

> `IProvider.fork`：P1 缺省（无 fork）；P3 评估 ACP `fork` 方法。

### 修改（后端注册触点，`grep -rn "zcode" server/` 逐处镜像）

| 文件 | 改动 |
|---|---|
| `server/shared/types.ts` | `LLMProvider` 加 `'openclaw'`（编译强制） |
| `server/modules/providers/provider.registry.ts` | import + `openclaw: new OpenclawProvider()`（编译强制） |
| `server/modules/providers/provider.routes.ts` | `parseProvider` if 链加分支（**手写链，易漏**） |
| `server/modules/providers/services/provider-capabilities.service.ts` | 能力矩阵加条目（编译强制，见 §4） |
| `server/modules/providers/services/session-synchronizer.service.ts` | `processedByProvider` 计数 map（编译强制） |
| `server/modules/providers/services/provider-token-usage.service.ts` | openclaw 分支：取 active 路径**最后一条** assistant `usage`（当前上下文占用口径，与 claude/pi/codex 一致；不要累加） |
| `server/modules/providers/services/sessions-watcher.service.ts` | watch root `~/.openclaw/agents`；`isProviderEnginePresent` 查 `~/.openclaw`；`isWatcherTargetFile` 匹配 `openclaw-agent.sqlite` |
| `server/modules/providers/index.ts` | 导出 `getOpenclawCommand`（供 shell-websocket PTY） |
| `server/modules/agent/agent.routes.ts` | provider 校验数组 + `queryOpenclaw` 分支 |
| `server/modules/agent/agent.module.ts` | `Pick<...>` 依赖 key union 加 `'queryOpenclaw'`（**易漏**） |
| `server/index.ts` | `const queryOpenclaw = providerRuntimeService.getRunner('openclaw')` + 传入 module |
| `server/modules/commands/commands.routes.ts` | `MODEL_PROVIDERS` + `MODEL_PROVIDER_LABELS.openclaw = 'OpenClaw'` |
| `server/modules/notifications/services/notification-orchestrator.service.ts` | label map `openclaw: 'OpenClaw'` |
| `server/modules/websocket/services/shell-websocket.service.ts` | PTY 启动分支 + 欢迎语映射（按需） |
| `server/modules/database/schema.ts` | `provider_models` CHECK 加 `'openclaw'`（`migrateProviderModelsProviderCheck` 自动迁移）；`MCP_SERVERS_TABLE_SCHEMA_SQL` 加 `enabled_openclaw BOOLEAN DEFAULT 0` |
| `server/modules/database/migrations.ts` | **新增 `ALTER TABLE mcp_servers ADD COLUMN enabled_openclaw`**（CREATE IF NOT EXISTS 不给旧库加列，**新 provider 必然踩**） |
| `server/modules/database/repositories/mcp-servers.db.ts` | `McpServerRow` + `ENABLED_COLUMN_BY_PROVIDER`（编译强制） |
| `server/modules/providers/README.md` | provider 列表 + MCP/skills/sync 表补 openclaw 行（顺带修 omp 漏项） |
| `public/api-docs.html` | `PROVIDER_ORDER` 加 openclaw |

### 修改（前端，机械规则：`grep -rn "zcode" src/` 逐处镜像）

- 类型/常量：`src/shared/types.ts`（`LLMProvider`）、`src/shared/constants.ts`（`MCP_PROVIDER_NAMES` / `MCP_SUPPORTED_SCOPES` / `MCP_SUPPORTED_TRANSPORTS` / `MCP_ADD_BLOCKED_REASON` / `MCP_SUPPORTS_WORKING_DIRECTORY` / `PROVIDER_PERMISSION_PREFERENCE_KEYS`）、`src/shared/userSettings.ts`（新增 `openclawPermissions` 键）、`src/shared/providerModelSettings.ts`（`LLM_PROVIDERS`）
- UI 派发：`src/shared/ui/LLMProviderLogo.tsx`（+ `OpenclawLogo.tsx` 或复用）
- chat：`useChatProviderState.ts`（`FALLBACK_DEFAULT_MODEL` 编译强制 + `FALLBACK_PERMISSION_MODES`）、`chatProviderLabel.ts`、`useAvailableProviders.ts`、`useProviderAuthStatus.ts`、`ProviderSelectionEmptyState.tsx`（`PROVIDER_META` + `readyPrompt`）、`ModelLibraryPanel.tsx`
- auth/onboarding：`ProviderLoginModal.tsx`（无 OAuth，展示状态）、`AgentConnectionsStep.tsx`、`AgentConnectionCard.tsx`
- settings/agents-settings：`AgentsSettingsTab.tsx`、`AgentSelectorSection.tsx`（`AGENT_NAMES` 编译强制）、`AccountContent.tsx`（编译强制）、`AgentCategoryContentSection.tsx`
- mcp/skills/sidebar：`McpServers.tsx`（`MCP_PROVIDER_BUTTON_CLASSES` 编译强制）、`ProviderSkills.tsx`（`PROVIDER_NAMES` 编译强制 + paths）、`SidebarContent.tsx`、`SidebarRecentConversations.tsx`（`PROVIDER_LABELS` 编译强制）
- i18n：`en` + `zh-CN` 的 `chat.json`（`messageTypes.openclaw`、`providerSelection.readyPrompt.openclaw`）与 `settings.json`（`agents.openclaw.*` / MCP 描述，按需）

> 编译级触点（union / `Record` 键 / i18n 键）以 `npm run typecheck` 报错为准逐一补齐；`grep zcode` 只作兜底。

### 新建（测试）

- `server/modules/providers/tests/openclaw-{auth,models,sessions,session-synchronizer,skills}.test.ts`
- `server/modules/providers/tests/fixtures/openclaw-agent-db.ts`（用 `better-sqlite3` memory/temp 建 `session_nodes`/`session_windows`/`transcript_events`/`session_transcript_active_events`，投样例行：明文 + zstd 行、注入 user、toolResult、active 分支含废弃事件）

---

## 2. 读取设计（sessions / synchronizer）

### 2.1 `fetchHistory(sessionId, options)`

- `providerSessionId = options.providerSessionId ?? sessionId`（CloudCLI 侧的 id 见 §2.3）。
- 定位：`session_nodes.current_session_id`（当入参是 session_key）或直接用 session_id；再取 header（seq=0）得 `cwd`。
- 取 active 路径（§读取算法），逐 entry 归一（复用 Pi 逻辑）：
  - `message` + `role:user` → 剥离注入元数据（§注入内容）；剩余非空则渲染 user text；附件（`image` block → data URL）映射 images。
  - `message` + `role:assistant` → content blocks：`text`→text、`thinking`→thinking、`toolCall`→tool_use（`toolInput=arguments`，`toolId=id`）；`model` 盖在 text 行（回答页脚）。
  - `message` + `role:toolResult` → 独立 `tool_result` 行（`toolId=toolCallId`、`isError`），**不挂到 tool_use 上**——Pi 与 OMP 的实现都是独立行，本方案照此（已由测试钉死）。
  - `custom`/`custom_message`/`leaf`/`model_change`/`thinking_level_change`/`session` → 无 UI（跳过）；`custom_message` 若 `display:true` 可评估是否渲染（默认跳过）。
- token 汇总：active 路径最后一条 assistant 的 `message.usage`。
- 容错：坏 JSON / 未知 type / 缺字段 → 跳过该行；zstd 解压失败 → 跳过该行（不整体失败）。

### 2.2 `session-synchronizer`

- 遍历 `~/.openclaw/agents/*/agent/openclaw-agent.sqlite`（`getOpenclawAgentIds()`），每库：`session_nodes`（`archived_at IS NULL`）→ upsert。
- `projectPath` = 该会话 header 的 `cwd`（realpath 归一；缺失回退 `~/.openclaw/workspace`）。
- 会话名：`display_name` / `label` → 回退「首条**非注入** user 文本」（跳过 §注入内容 的 bootstrap/cron）。
- `jsonl_path = null`（共享库，避免删一个会话毁整库）。
- `synchronizeFile(filePath)`：仅匹配 basename `openclaw-agent.sqlite`（不匹配 `-wal`/`-shm`）。
- **首次扫描全量回填（`hasCompletedInitialScan`）**：`scan_state.last_scanned_at` 是**全局单调游标**，共享同一个游标的所有 provider 都按它做增量。openclaw 接入较晚，其存量会话可早于该游标 ⇒ 只用增量会**永不回填**（实测：源 28 条非归档会话只索引到 3 条）。故照 **pi/omp/workbuddy 的既有范式**：**进程内首次 `synchronize` 忽略游标做全量**，成功后置位，后续才守游标。`synchronizeAgent` 吞掉每库读错误并以 `failed` 上报，**只有干净通过才置位**（部分失败留待下次全量重试）。测试：`openclaw-session-synchronizer.test.ts` 的「backfills a store older than the cursor on the first scan only」。
- **`deleteProviderSession(providerSessionId)`**：删 `transcript_events` / `session_transcript_active_events` / `session_index_state` / `session_windows` / `session_nodes` 中该会话的行（按 `session_id`，逐表 try/catch 跳过缺表）。**共享库 provider 必做，否则删除后下次扫描复活**（见记忆「共享库 provider 的单侧删除必然复活」）。

### 2.3 CloudCLI 侧 id 与 project 映射

- **`provider_session_id` = `session_key`**（`agent:<agentId>:<key>`）：稳定（reset/rollover 换 `current_session_id` 但 key 不变）。读历史时再解析到 `current_session_id`。P2 的实时续跑用它作为 `openclaw acp` 的 `_meta.sessionKey`（见 §3）。
- **`project_path` = header `cwd`**（OpenClaw 无 project 概念，`session_nodes.project_id` 实测全空）。多数会话共享 `~/.openclaw/workspace`，侧栏会归为同一 project（可接受）。

---

## 3. runtime 设计（P2，已实施）

**共享 ACP 客户端**：DSH 与 OpenClaw 都走 ACP，故把 DSH runtime 内嵌的 `AcpClient` 抽成 `server/modules/providers/shared/acp/acp.client.ts`（NDJSON JSON-RPC over stdio；`initialize`/`session/new`/`session/prompt`/`session/cancel` + `session/update` / `session/request_permission` 通知）。DSH runtime 改为引用它（行为零变化，dsh 测试全绿）。**计划原写「照 `codex-app-server.client.ts`」是笔误**——codex 是另一套协议，ACP 的正确模板是 dsh 的客户端。

`openclaw-runtime.provider.ts`（P2）：
- **单进程多会话**：spawn `openclaw acp`（`OPENCLAW_STATE_DIR` 钉到 `getOpenclawHomeDir()`），`initialize` 一次；每个 app 会话用 `session/new` 的 `_meta.sessionKey` 绑到 OpenClaw 会话（`--session` 只能钉一个默认 key，故不用于多会话）。
- **`--no-prefix-cwd`（必须）**：ACP 桥的 `submitPrompt` 默认给每条 prompt 前置 `[Working directory: <cwd>]\n\n`（`server-*.mjs` 的 `prefixCwd ?? true`），这段前缀会被**存进用户消息并原样显示**。故 spawn 时加官方标志 `--no-prefix-cwd` 阻止新污染；读取侧 `stripOpenclawInboundMetadata` 另加一条「剥离开头 `[Working directory: …]` 行」（`LEADING_ACP_WORKING_DIRECTORY_RE`）以处理**存量**已污染消息。测试：`openclaw-sessions.test.ts` 两条。
- **session key**：`provider_session_id` 即 key；**新会话**由 runtime 生成 `agent:<defaultAgentId>:<uid12>`（`getOpenclawDefaultAgentId()` 读 `agents.entries`，缺省 `main`）并发 `session_created(newSessionId=key)`；**续跑**用会话行已存的 key（不发 `session_created`）。
- **chunk 无 `messageId`**（与 dsh 不同 ⇒ 关键差异）：OpenClaw 的 `agent_message_chunk`/`agent_thought_chunk` 只带 `content.text`。runtime **自己累积**并铸 per-segment id（`openclaw-<run>-text-<n>`／`-thinking-<n>`），发出的 `content` 是该段「到目前为止的全量快照」，前端按稳定 id upsert 单行增长。**`tool_call` 会封段**，其后文本另起一行，得到 text→tool→text 的正确分段。
- 事件映射：`agent_message_chunk`→text、`agent_thought_chunk`→thinking、`tool_call`→tool_use（`toolId=toolCallId`、`toolInput=rawInput`）、`tool_call_update`→tool_result（`status in_progress` 跳过；`completed`/`failed` 落地，`isError=status∈{failed,error}`，内容优先 `content` blocks 再 `rawOutput`）、`session/request_permission`→permission_request。
- **Gateway 生命周期：不自动起停**（遵用户取向，`oc`/`ocq` 按需 wrapper 负责）。Gateway 冷态时 ACP 子进程立即退出，失败以「`OpenClaw ACP server exited with code N: <末行 stderr>`」浮出（`AcpClient` 记末行 stderr 进退出错误）。
- **流式粒度：真机实测「每轮一帧」，根因已 100% 凿定（2026-10-10）**。每次 `session/prompt` 全程只收到**一个** `agent_message_chunk`，在 turn 末与 `usage_update`/`end_turn` 同批到达。**故 OpenClaw 已加入 `WHOLE_SEGMENT_PROVIDERS`**（`src/modules/chat/utils/revealPacer.ts`），与 dsh 同型走 reveal 打字机；runtime 仍累积成增长快照，将来若 Gateway 真发 delta 只会让 reveal 更快追平。

  **排查经过（避免重蹈「读代码当实证」）**：① 先在 ACP 层实测单帧 → ② 写 Gateway **WS 探针**（`GatewayChatClient`，与 ACP 同源订阅 `chat` 事件）同样只 1 帧、且**引擎层 `agent` 事件也只有 1 帧** → ③ 开 gateway 的 **OpenAI 兼容 HTTP API**（`POST /v1/chat/completions` + `stream:true`）SSE **内容 chunk 也是 1 个** → ④ `openclaw infer model run --local` 证 provider 层**确为** SSE。⇒ 三条官方通道全单帧、换通道零收益，问题在引擎。

  **根因（`@openclaw/ai` → `openclaw-completions-stream`）**：**只要模型输出 reasoning(thinking)，openclaw 的「reasoning-tag 文本分区器」就无条件进 strict 模式，把所有可见正文 hold 到流结束才一次性放出**。链路：主循环对含 reasoning 的 chunk 调 `beginReasoning(_, true)`（forceStrict，`openai-completions-stream-*.mjs:1653`）→ `reasoningTagTextPartitioner.markStrict()`（`reasoning-tag-text-partitioner-*.mjs:12360`，`strictMode=true; holdStart ??= emitted`）→ `emitSafePrefix` 的 strict 分支（`:12098`）**只 hold 不外发** → 直到 `text_end` 的 `flush()`（`:12370`）才整段放出；引擎侧孪生开关 `openclawDelivery.textPhaseRequiresTerminal`（`openai-completions-stream:1592`）令 `builtin-openclaw:10529` 再抑制发布。**这是设计取舍**（怕流式 chunk 边界切裂 `</reasoning>` 之类标签），**与 `strictReasoningTags` 配置项无关（那条是另加的启动期 strict）**。

  **实证（隔离 state dir 跑 `openclaw agent --local` + `OPENCLAW_RAW_STREAM=1`，数 `assistant_text_stream`）**：`reasoning:true`（现配）→ **`text_delta×1`**（全文一次性）、但 thinking 逐块（`assistant_thinking_stream×6`）；**`reasoning:false` 或 `--thinking off` → `text_delta×8`**（1/8/8/8/8/8/8/1，与直连 mimo 的 provider SSE 内容 chunk **一一对应**）。**通道级端到端**（真实网关热改配置、无需重启、事后逐字节还原）同步变 8 帧：引擎 `agent` assistant 帧=8、网关 `chat` `state:delta`=8、HTTP SSE 内容帧=8 ⇒ **ACP 订阅同一批 `chat` 事件，故亦会分段**。

  **可操作开关（openclaw 侧，配置热重载）**：① 模型条目 `models.providers.<p>.models[].reasoning: false`；或 ② `--thinking off` / 会话 `thought_level=off`（ACP `session/new` 即暴露 `thought_level`）。**取舍**：这是**真关掉思考**（不是只改显示），推理模型会损失推理质量——是取舍，非 bug 修复。**⇒ 想从 openclaw 拿真流式的唯一路径是关该模型的 reasoning；CloudCLI 若要暴露「流式」选项，落点应是「是否关 thinking」而非换通道。** 探针：`/tmp/oc-ws-probe.mjs`、`/tmp/oc-http-probe.mjs`。
- abort → `session/cancel`；权限选项 `allow_once`/`reject_once`（`auto` 模式选 allow-once）；收尾照 dsh runtime 契约（`session_created`/error/complete + notify）。

**已知前置（已放行）**：本机 ACP bridge 曾被 Gateway 的「device metadata change pending approval」挡住。**2026-10-10 用户授权后已 `openclaw devices approve <id>` 放行**，真实握手/对话全通。注意待批准项只在连接存活窗口内出现（`devices list` 平时看不到）。

**ACP 能力面（真机实测，供 P3/能力矩阵参考）**：`initialize` 返回 `loadSession:true`、`promptCapabilities={image:true,audio:false,embeddedContext:true}`、`sessionCapabilities={list,resume,close}`；**`image:true` ⇒ `supportsImages` 可为 true**。`session/new` 返回 `configOptions`：`thought_level`（off/minimal/low/medium/high/adaptive＝effort）、`fast_mode`、`verbose_level`、`trace_level`。**ACP 无 `session/set_model`**（不能会话内换模型）。

---

## 4. 能力矩阵（`provider-capabilities.service.ts`）

P1（runtime 未启用）：

```ts
openclaw: {
  provider: 'openclaw',
  permissionModes: ['default', 'auto'],   // default=ACP 权限请求进聊天 UI；auto=用 bridge 的 allow-once
  defaultPermissionMode: 'default',
  supportsImages: false,          // ACP bridge 暂不透传附件
  supportsFiles: false,
  supportsAbort: true,            // P2：session/cancel
  supportsPermissionRequests: true, // P2：session/request_permission
  supportsTokenUsage: true,       // 读 active 路径末条 assistant usage
  supportsEffort: false,
  supportsMessageEditing: false,
  supportsSessionForking: false,  // P3 评估 ACP fork
},
```

前端 `useChatProviderState.ts` 的 `FALLBACK_PERMISSION_MODES.openclaw` 同步为 `['default', 'auto']`。

---

## 5. 待验证点（实现/联调时实测）

1. **`session_key` vs `current_session_id` 作为 CloudCLI id 的取舍**：rollover（`session_windows` 多行）时读 `current_session_id` 是否足够；`session_key` 含冒号是否影响任何下游。
2. **`event_zstd` 解压边角**：截断帧、`navigation_json` 存在时的分派；Node `zstdDecompressSync` 对损坏帧行为。
3. **注入剥离的完整性**：`⟦openclaw:ctx⟧` 之外是否还有未覆盖 marker（grep `INBOUND_METADATA_MARKERS` / `MESSAGE_TOOL_DELIVERY_HINTS` 全集）；bootstrap prompt 的稳定前缀。
4. **`display_name` 来源**：24/27 有值，其余（含 `agent:main:main`）需首条非注入 user 兜底；`label` vs `display_name` 优先级。
5. **多 agent**：本机只有 `main` 活动；其他 agent（`ak-lobster`/`claude-code-kb`）是否应统统索引，还是只 `main`（默认全部）。
6. **watcher 事件量**：库目录下 `-wal`（3.5MB）高频写，只匹配主库 `openclaw-agent.sqlite` 是否够（与 ZCode 同策略）。
7. **`version:4` header**：v3/v4 是否除版本号外无结构差异（本方案不校验版本，直接解析）。
8. **skills 命令语法**：OpenClaw 技能在会话中如何被调用（`/skill`? 别的?）——决定 `commandForSkill`。
9. **auth 判定**：`models status --json` 在未登录/未装模型时的输出形状；内联 key 与 profiles 的优先级。
10. **P2 前置（已实测）**：Gateway 常驻（launchd `ai.openclaw.gateway`，`ws://127.0.0.1:18789`）；ACP 续跑靠 `session/new` 的 `_meta.sessionKey`（**非** `--require-existing`；多会话也不用 `--session`）；ACP SDK `PROTOCOL_VERSION=1`；`openclaw acp` 连 Gateway 需设备已配对——本机曾有一条 `ACP` 待 `openclaw devices approve` 的设备请求（见 §3 末）。

---

## 6. 验证命令

```bash
npx tsc --noEmit -p server/tsconfig.json
npx eslint server/modules/providers/**/*.ts server/shared/types.ts server/shared/interfaces.ts
# 相关测试（新增 + 会因新增 provider 而失败的既有断言）
npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/openclaw-sessions.test.ts
# 既有需同步：mcp.test.ts（9→10）、mcp-servers.db.integration.test.ts、mcpGlobalImpact.test.ts、
#   mcpMatrix.test.tsx、provider-runtime.service.test.ts、agent.routes.test.ts
npm run typecheck
```

---

## 7. 实施顺序

1. **P0（本文档，完成）**：契约固化。
2. **P1 只读接入（完成）**：静态注册骨架（LLMProvider/registry/routes/capabilities/schema/migrations/commands/notification/README + wrapper/auth/models/mcp(空)/skills/runtime(守卫)）→ SQLite 会话链路（sessions/synchronizer/watcher/token-usage + 夹具）→ 前端全触点 + i18n + DB 迁移 → 测试。**验收：重启 server 后本机真实 OpenClaw 会话出现在侧栏、历史消息与工具卡完整、注入内容不显示**。
3. **P2 实时 runtime（完成）**：抽取共享 ACP 客户端（§3）+ OpenClaw ACP runtime（单进程多会话、`_meta.sessionKey` 绑定、无 `messageId` 的自累积分段）+ 权限映射 + 能力矩阵上调。**测试：`openclaw-runtime.test.ts` 7 条 + `openclaw-live-normalize.test.ts` 6 条（假 ACP CLI 全链路）。真机 E2E 已通（设备配对放行后 `initialize`→`session/new`→`session/prompt`→`end_turn`）；流式粒度实测「每轮一帧」⇒ 已加入 `WHOLE_SEGMENT_PROVIDERS`（见 §3）。**
4. **P3（已完成评估）**：
   - **fork：确定不支持**。ACP bridge 的能力集是 `sessionCapabilities={list,resume,close}`，**无 `fork`/`delete`**，bundle 里也没有 `session/fork` 处理方法 ⇒ `supportsSessionForking` 维持 `false`。
   - **MCP：维持 harness-managed**（P1 已定，openclaw 无 user-scope MCP 配置面）。
   - **skills：P1 已覆盖三类根并经测试**，无需扩展。
   - 未采纳的 ACP 方法：`session/list`/`resume`/`close` 虽被广告，但 CloudCLI 历史走 SQLite，不需要。
5. **P4 `openclaw-compat-check` 技能（完成）**：`.agents/skills/openclaw-compat-check/`（`SKILL.md` + `check-openclaw-format.mjs`），已用本机真实库验证（默认 + `--all`）。README 修补已在 P1 完成（`server/modules/providers/README.md` 的 id/目录/MCP/skills/session 四表）。

---

## 附录：关键文件与证据

- 会话库：`~/.openclaw/agents/main/agent/openclaw-agent.sqlite`（本机实测表/列见 §已实测）。
- 剥离逻辑真源：`~/.local/share/node/current/lib/node_modules/openclaw/dist/strip-inbound-meta-*.mjs`、`inbound-context-marker-*.mjs`、`message-tool-delivery-hints-*.mjs`。
- 会话 entry union：`.../openclaw/dist/types-*.d.ts`（`SessionEntry` 家族）。
- ACP：`.../openclaw/dist/acp-cli-*.mjs`、`server-*.mjs`（`serveAcpGateway`）。
- 本仓库模板：`zcode-sessions.provider.ts`（SQLite reader）、`zcode-session-synchronizer.provider.ts`（含 `deleteProviderSession`）、`pi-sessions.provider.ts`（Pi entry 归一）、`shared/acp/acp.client.ts`（P2 共享 ACP 客户端，抽自 dsh-runtime）。
