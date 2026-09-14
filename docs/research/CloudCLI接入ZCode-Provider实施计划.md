# CloudCLI 接入 ZCode Provider 实施计划

> **状态**：第一轮审阅完成，已按批注逐条处置并修订正文（v2）
> **日期**：2026-09-13
> **审阅轮次**：v1 → Claude + Pi 批注（原文见文末「审阅批注」）→ 本 v2 修订正文并给出「牵头结论」（文末最后一节）。第一轮审阅期间针对争议项补做的实测统一记在「§第一轮审阅后补充实测」。
> **用途**：本文档是 ZCode Provider（Z.AI / BigModel 的 ZCode CLI，v0.16.5，随 `/Applications/ZCode.app` 分发）接入 CloudCLI 的完整实施方案。审阅重点：ZCode 事实是否与实际行为相符、事件映射是否有遗漏或语义错误、权限模式映射是否安全、MCP 落点与写回是否有并发风险、触点清单是否有缺漏。
> **参考规范**：`server/modules/providers/README.md`（How To Add A Provider 9 步流程）、`docs/Provider接入与验收SOP.md`、同目录 `CloudCLI接入Pi-Provider实施计划.md`（上一份同类方案，格式模板）

## Context

CloudCLI 目前支持 claude/codex/cursor/opencode/dsh/workbuddy/pi 七个 Provider。用户已在本机安装并配置好 ZCode（`/Applications/ZCode.app`，CLI v0.16.5），且已用 dotfiles + `zcode-sync` 维护好 `~/.zcode/cli/config.json` 里的多渠道（deepseek / ark）。现在希望把 ZCode 作为第八个 Provider 完整接入 CloudCLI：认证检测、模型目录、历史会话浏览/侧边栏索引、以及直接在 CloudCLI 内与 ZCode 实时对话。

**用户已定决策**：
- 执行顺序：**先后端跑通（真 CLI 端到端验证），再做前端**
- 认证：**只检测现有 `~/.zcode/cli/config.json` 渠道**即视为已认证，不做 OAuth 登录按钮
- MCP：用户不确定是否需要，**由本方案评估后给出建议**（见 §6 决策点）

**与已有 Provider 的关键差异（决定了本方案能大量复用）**：ZCode CLI 的**对话存储是 opencode 血统的 sqlite**（`session`/`message`/`part` 表，`part.data` 的 `text`/`reasoning`/`tool`/`step-start`/`step-finish` 形状与本仓库 `opencode` Provider 读的库**逐字段一致**），而它的 **headless 协议是 Claude 血统**（`--prompt`/`--resume`/`--mode`/stream-json）。因此：**runtime 照 WorkBuddy 模板写，sessions/synchronizer/models 照 OpenCode 模板改**。

## 已实测确认的 ZCode 事实（规划阶段用本机二进制 + 反编译验证过）

**二进制与调用**
- CLI 不在 PATH，打包在 `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`（node bundle，13MB，`package.json` 元信息 `apps/zcode-cli/packages/cli/dist/zcode.cjs`）。用户 alias：`zcode='node /Applications/ZCode.app/Contents/Resources/glm/zcode.cjs'`。
- App 内**不打包 node**；需用 PATH 上的 `node`（本机为 nvm v22.22.0）。`ELECTRON_RUN_AS_NODE=1 /Applications/ZCode.app/Contents/MacOS/ZCode` 可用但会告警，不作为方案路径。

**headless 流式协议（本方案核心）**
- **`--output-format stream-json` 可用但未写进 `--help`**（`--help` 只列了 `--json`，那是**最终单块 JSON**，不流式）。stdout 为逐行 NDJSON，是本 Provider runtime 唯一正确的接入点。
- 实测事件清单（含一次真实工具调用）：

| type | payload.kind / 关键字段 | 用途 |
|---|---|---|
| `session.titleUpdated` | `title` / `previousTitle` | 会话命名（首轮 `source:first_input`） |
| `turn.started` | `turnNumber`/`input`/`messageId` | 回合开始 |
| `session.updated` | `model`/`modelRef`/`usage`/`finishReason`/`contextUsageBreakdown` 等多种子形状 | 模型信息、token、上下文占用 |
| `model.streaming` | kind=`start`/`text_start`/`text_delta`/`text_end`；`tool_input_start`/`tool_input_delta`/`tool_input_end`/`tool_call`；`reasoning_start`/`reasoning_delta`/`reasoning_end`；`finish` | **正文/思考增量 + 工具调用**（`assistantMessageId`、`toolCallId`、`toolName`、`input`） |
| `tool.updated` | kind=`scheduled`/`started`/`error`/`batch`（`toolName`、`input`、`error`） | 工具执行状态与结果 |
| `permission.requested` | `requestId`/`toolCallId`/`toolName`/`riskLevel`/`reason`/`suggestedPermissionUpdates` | **权限审批请求（headless 下无客户端应答）** |
| `permission.resolved` | `decision: deny`/`reason:"No permission client configured for <Tool>"` | headless 默认拒绝记录 |
| `streamRecovery.updated` | kind=`tool_error` 等 | 流恢复锚点 |
| `turn.completed` | `response`/`usage`/`tokenCount`/`toolCallCount`/`resultType` | 回合终态（**权威响应文本 + usage**） |
| `result`（末行） | 同 `--json` 结构 | 进程终态汇总 |

- `--resume <sess_...>` 实测可用：续接后追加进同一 sqlite 会话。`-c/--continue` 续最近会话。`--attach <path>` 实测可让模型读到附件内容（可重复），**且实测可读图片**（v2 补充，见下）。
- **僵尸 flag 复核（v2 已逐条实测）**：`--settings`、`--max-turns`、`--permission-mode`、`--allowed-tools`、`--model` 在 `--help` 里有，但 0.16.5 严格 parser 直接报 `Unknown option`。**例外：`--disallowed-tools` 是活 flag**（实测被接受、且确实拒绝被点名的工具）——不要因为同一组 help 条目就把 allow/deny 家族整体判死。权限只能走 `--mode`，续接只能走 `--resume`/`-c`，**模型无任何 CLI 通道**（见 §附录-A）。
- `--mode` 的**真实 CLI 取值只有 `build | edit | plan | yolo`**；`auto` 虽在配置 schema 枚举里，但 CLI 实测报 `Unsupported --mode value: auto`。`--help` 明文 **`--mode ... (default: yolo for --prompt)`** —— headless 的原生默认就是 `yolo`（`build` 是 TUI 的默认）。
- **prompt 无 stdin 通道**：`--prompt -` 实测不会读 stdin（它会开一个空会话），`-p/--print` 不带参数报 "argument is ambiguous"。故 prompt 只能走 argv。

**headless 权限模型（关键安全事实）**
- headless 没有权限客户端：bundle 内 `DenyPermissionBroker` 对需要审批的工具一律返回 `{decision:'deny', reason:'No permission client configured for <Tool>'}`，并且会发 `permission.resolved` 事件。**没有 `control_request`/`canUseTool`/stdin 审批通道**（grep 确认）。
- 实测四种模式对「创建文件」任务的结果：

| `--mode` | 读取类工具 | 写文件（Write） | 执行 Bash | 实测结论 |
|---|---|---|---|---|
| `yolo` | ✅ | ✅ 自动批准 | ✅ 自动批准 | 任务完成、`response:DONE`、正常退出 |
| `edit` | ✅ | ✅ 自动批准 | ❌ 需审批→拒绝 | 写文件成功、无拒绝、`DONE` |
| `build` | ✅ | ❌ 拒绝 | ❌ 拒绝 | 模型反复重试，**输出膨胀到 1.1MB 且 >45s 不退出** |
| `plan` | ✅ | ❌ 拒绝 | ❌ 拒绝 | 不做写入，正常结束 |

- 结论：**`build` 模式在 headless 下对需要写/执行的任务会陷入重试循环**，这是最需要防御的风险（见 §3.4 拒绝检测与熔断、§5 验证项）。

**会话存储（opencode 血统，可大量复用）**
- 库：`~/.zcode/cli/db/db.sqlite`（默认路径来自配置 `storage.sessionDbPath`）。表：`session`/`message`/`part`/`todo`/`permission`/`turn_usage`/`model_usage`/`tool_usage`/`session_entry`/`session_input`/`session_target`/`session_task_link`/`workflow_*`/`local_setting`/`input_history`/`schema_migration`。
- `session` 列：`id`(`sess_...`)、`project_id`、`slug`、`directory`、`path`、`title`、`time_created/updated`、`time_archived`、`title_source` 等。**没有 `project` 表**（opencode 有），也**没有 `model`/`agent`/`tokens_*` 列**（opencode 有）。
- `message.data`（JSON）：`{role:'user'|'assistant', modelID, providerID, mode, tokens:{total,input,output,reasoning,cache:{read,write}}, finish, ...}`。**模型可从此取**（`<providerID>/<modelID>`）。
- `part.data`（JSON）：`{type:'text', text}` / `{type:'reasoning', text}` / `{type:'tool', callID, tool, state:{status,input,output,error}}` / `{type:'step-start'}` / `{type:'step-finish'}` —— **与本仓库 opencode Provider 完全同构**。
- `session_entry` 只存 shell 选择等运行时条目，**不是对话正文**，忽略。

**配置 / 认证 / MCP / Skills**
- 配置分层（低→高）：内置默认 → 用户 `~/.zcode/cli/config.json` → 项目 `<cwd>/zcode.json` 或 `<cwd>/.zcode/config.json` → `ZCODE_*` 环境变量 → CLI overrides。CLI **只读 `~/.zcode/cli/config.json`**，桌面端 provider 在 `~/.zcode/v2/config.json`（两套独立）。
- 认证：CLI 用 `cli/config.json` 的 `provider.<id>.{name,kind,options:{apiKey,baseURL},models}` + `model.main`。Z.AI 官方还支持 `zcode login` OAuth（凭据在 `~/.zcode/v2/credentials.json`）。**v2 凭据单独不构成可用认证**：v2 实测「只放 `v2/credentials.json`、无 `cli/config.json`」时 CLI 直接报 `Error: Model config is missing. Create ~/.zcode/cli/config.json with an explicit model provider before running ZCode.` 故 `authenticated` 判定**必须**以 `cli/config.json` 存在一个带 `options.apiKey` 的 provider 且能解析出模型（`model.main` 或 `provider.models` 非空）为准；`v2/credentials.json` 只能作辅助展示，不能单独判真。
- **MCP：`mcp.servers` 是配置文件的顶层键**（默认值 `mcp:{servers:{}}`，与 `storage`/`plugins`/`skills` 同级）。条目 schema（bundle `PAo/MAo/OAo`，`g.discriminatedUnion('type')`）：
  - stdio：`{type:'stdio', command, args?, cwd?, env?, enabled?, timeoutMs?}`
  - http：`{type:'http', url, headers?, oauth?, enabled?, timeoutMs?}`
  - sse：`{type:'sse', url, headers?, oauth?, enabled?, timeoutMs?}`
  - 实测：项目 `<cwd>/.zcode/config.json` 写 `mcp.servers.probe` → 真实启动了我们注入的 stdio MCP server，`contextUsageBreakdown.mcp_tool_schemas` 从 5218 → 6102 字符，**确认被加载**。
- Skills：`~/.zcode/skills/`（本机已 stow 链接，内含本用户既有技能）。
- 配置文件写回注意：`~/.zcode/cli/config.json` 也被用户的 `zcode-sync`（只动 `provider`）和桌面端（只动 `command`/`plugins`/`storage`）读写；三方字段不重叠，但**任何写入都必须 read-modify-write 且保留未知顶层键**。

**第一轮审阅后补充实测（v2 新增，用于处置 Claude/Pi 争议项）**

- **图片 attach 可用**：造一张纯红 96×96 PNG，`--attach` 后问「What color is the attached image?」，模型答 `red` → **`supportsImages: true`**。
- **`--disallowed-tools` 是活 flag，但只是「按工具名」的 best-effort 拒绝，不是安全边界**：实测 `--mode yolo --disallowed-tools Write` 确实让 `Write` 被拒，但模型改用 `Bash`（`echo ... > file`）绕过去并成功建文件。可用于排除个别高危工具，**不能**当作权限控制。
- **无 stdin prompt 通道**：`--prompt -` 不读 stdin、`-p` 缺参报错 → prompt 只能经 argv（长度/`ps` 可见性局限无 CLI 侧规避手段）。
- **首个携带 sessionId 的事件较晚**：一次 headless 运行的前 3 条事件依次是 `session.titleUpdated`(#0)、`turn.started`(#1)、`session.updated`(#2，无 sessionId)；**#3 的 `session.updated` 才携带 `sessionId`**。且 51 条 `session.updated` 中只有 13 条带 `sessionId`。→ 提取必须「扫描首个 payload 内含 `sess_` 前缀 sessionId 的事件」，不能取首事件。（`ZCODE_SESSION_ID` 不可用作兜底，见下条。）
- **`tool.updated` 的 kind 全集**：`scheduled` / `started` / `result` / `error` / `batch`。
  - **成功输出走 `kind=result`**：payload 形如 `{toolCallId, result:{success, content, perf, truncated, originalBytes, ...}}`（原方案漏了这个，会丢工具成功输出）。
  - **执行失败走 `kind=error`**：`{toolCallId, error:{type:'tool_execution_failed', message, code}}`。
  - **权限拒绝不产生 `kind=error`**：只发 `permission.resolved{decision:'deny'}` + 随后 `tool.updated{k=kind:'batch', successCount:0, errorCount:1}`。→ 拒绝的 tool_use 必须靠 `permission.resolved` 或 `batch` 闭合，否则前端卡片永远停在「执行中」。
- **tokens 是「每轮 prompt 快照」而非会话累计**：抽查真实库同一会话两条 assistant message，`input` 分别 15530 / 15689（非 15530 / 31199），`cache.read` 8192→0。→ 印证 §1「取最新一条」契约正确（上下文占用口径），§2.2 的累加只是历史展示口径，两者分工不同、非矛盾。
- **`session.directory` 始终是绝对路径**（抽查 8 条：`/private/tmp/...`、`/Users/selier/...`）；注意 macOS `/tmp` 会规范化为 `/private/tmp`，做 projectPath 匹配时要 realpath 归一。`session` 表含 `parent_id` 列（fork 的库侧支撑）。
- **`app-server` 子命令确实存在且有完整交互协议**：bundle 实证方法含 `session/create|send|stop|setMode|setModel|fork|messages|usage|subscribe`，事件含 `permission.requested` / `userInput.requested`。本方案 v1 选择了更简单的 one-shot `--prompt` 路径，理由见 §附录-A。
- **相关环境变量**（grep bundle 全集）：`ZCODE_HOME`、`ZCODE_STORAGE_DIR`、`ZCODE_PROJECT_DIR`、`ZCODE_API_KEY`、`ZCODE_BASE_URL`。**无任何模型选择变量**（`ZCODE_MODEL_RETRY_*` 只是重试参数）。`ZCODE_HOME`/`ZCODE_STORAGE_DIR` 可用于测试隔离与配置落点控制。
  - **`ZCODE_SESSION_ID` 不是输入变量（v3 更正）**：bundle 内 7 处引用**全部是 zcode 向 plugin/hook/custom-command 子进程注入**的模板变量（与 `CLAUDE_SESSION_ID` 同组，`t.sessionId` 有值时才 set，供 `${ZCODE_SESSION_ID}` 展开），**CLI 自身从不通过 `process.env` 读取它**，也不会出现在 stream-json 里。故它**不能**作为 runtime 的 sessionId 兜底（runtime 的 env 里根本没有）。

## 1. 文件清单

### 新建 `server/modules/providers/list/zcode/`

| 文件 | 职责 | 模板 |
|---|---|---|
| `zcode.provider.ts` | Wrapper，`super('zcode')`，组装各 facet | `pi.provider.ts` |
| `zcode-auth.provider.ts` | 解析命令（`ZCODE_COMMAND` → PATH `zcode` → App 内置 cjs）；`installed`；`authenticated` = `cli/config.json` 存在**带 `options.apiKey` 的 provider 且能解析出模型**（`model.main` 或 `provider.models` 非空）。`v2/credentials.json` 仅作辅助展示、**不单独判真**（v2 实测仅 v2 凭据时 CLI 报 `Model config is missing`）；30s 缓存 | `workbuddy-auth.provider.ts` |
| `zcode-models.provider.ts` | **v2 决策（已被附录-C 取代）：OPTIONS 收敛为 `model.main` 单一模型**（headless 无 `--model` 通道，多模型目录落不了地；UI 注明「模型由 zcode 配置决定」）。**附录-C（v5）改为**：全量列出 `provider.<id>.models`（`group=providerId`），`DEFAULT` 仍取 `model.main`，并用 `resolveZcodeModelEnv()` 解析出 per-run 的 `ZCODE_MODEL`/`ZCODE_BASE_URL`/`ZCODE_API_KEY` 环境通道落地切换（**不改写配置文件**）。导出 `getZcodeConfigPath()` / `getZcodeDatabasePath()`（供其它 facet 与 shell 复用） | `opencode-models.provider.ts` + 配置解析 |
| `zcode-runtime.provider.ts` | spawn `node <cjs> --prompt <text> --output-format stream-json --no-color --cwd <dir> --mode <mode> [--resume <sess_>] [--attach <path>...] [--disallowed-tools <names...>]`；NDJSON 行解析 → `NormalizedMessage`；`session_created` 从**首个携带 `sess_` sessionId 的事件**提取（非首事件）；abort=SIGTERM→SIGKILL；拒绝检测 + 熔断（§3）；prompt 经 argv（长度上限 + `ps` 可见性，见 §3.1） | `workbuddy-runtime.provider.ts` |
| `zcode-sessions.provider.ts` | `normalizeMessage`（实时 stream-json 事件）+ `fetchHistory`（读 sqlite `message`/`part`，分页/usage 契约）。可**复用 opencode 的 normalizeHistoryRows 逻辑** | `opencode-sessions.provider.ts` |
| `zcode-session-synchronizer.provider.ts` | 扫 `db.sqlite` 的 `session` 表 upsert（**去掉 opencode 的 `project` join**，`directory` realpath 归一后作 projectPath），`synchronizeFile` **只匹配主库 `db.sqlite`**（与 opencode 一致；WAL 高频提交会放大 watcher 事件量，如实测丢更新再评估加入 + 去抖） | `opencode-session-synchronizer.provider.ts` |
| `zcode-mcp.provider.ts` | 读写配置文件 `mcp.servers`（见 §6 建议）：user → `~/.zcode/cli/config.json`，project → `<workspace>/.zcode/config.json`；stdio/http/sse 映射共享 `ProviderMcpServer`；read-modify-write 保留未知键 + **rename 前用 mtime/size 校验快照未被他人改写**（见 §6 残余竞态） | `workbuddy-mcp.provider.ts` / `codex-mcp.provider.ts` |
| `zcode-skills.provider.ts` | 扫描 `~/.zcode/skills/**/SKILL.md`（+ 项目 `.zcode/skills`，若存在）；`commandForSkill` 用 zcode 的 `/skill <name>` 语法 | `workbuddy-skills.provider.ts` |

> `IProvider.fork` 缺省：`--prompt` 路径无 transcript fork 入口（**app-server 有 `session/fork`，本方案未采用**，见 §附录-A），故 `supportsSessionForking:false` 仅对 `--prompt` 路径成立。

### 新建（测试与前端）

- `server/modules/providers/tests/zcode-{auth,models,sessions,session-synchronizer,runtime,mcp,skills}.test.ts`
- `server/modules/providers/tests/fixtures/zcode-mock-cli.mjs`（仿 `wb-mock-cli.mjs`，按 `MOCK_MODE` 输出真实形状的 stream-json 事件流；覆盖 text/reasoning/tool/permission-denied/turn.completed/result 与无尾换行场景）
- `server/modules/providers/tests/fixtures/zcode-session-db.mjs`（或纯 SQL 建库工具：造 `session`/`message`/`part` 表与样例行）
- `src/shared/ui/ZcodeLogo.tsx`

### 修改（后端注册触点，`grep -rn "workbuddy" server/` 逐处镜像）

| 文件 | 改动 |
|---|---|
| `server/shared/types.ts` | `LLMProvider` 加 `'zcode'` |
| `server/modules/providers/provider.registry.ts` | `zcode: new ZcodeProvider()` |
| `server/modules/providers/provider.routes.ts` | `parseProvider` 允许 `'zcode'` |
| `server/modules/providers/services/provider-capabilities.service.ts` | 能力矩阵（§4） |
| `server/modules/providers/services/sessions-watcher.service.ts` | watch root（`~/.zcode/cli/db`）+ `isProviderEnginePresent` 检查 `~/.zcode` |
| `server/modules/providers/services/session-synchronizer.service.ts` | 计数 map 加 `zcode: 0` |
| `server/modules/providers/services/provider-token-usage.service.ts` | zcode 分支：取 sqlite **最后一条** assistant `message.data.tokens`（= 当前上下文占用口径，**与 claude/workbuddy/pi/codex 既有语义一致，不要改成累加**；实测 zcode tokens 为每轮 prompt 快照）。累加口径只用于 §2.2 历史展示 |
| `server/modules/providers/services/sessions.service.ts` | transcriptPath 缓存条件评估：zcode 无 jsonl 主路径（如同 opencode 保持 null），按需纳入 |
| `server/modules/providers/index.ts` | 导出 `getZcodeCommand`（供 shell-websocket PTY） |
| `server/modules/agent/agent.routes.ts` | provider 数组 + `queryZcode` 分支 |
| `server/modules/agent/agent.module.ts` | 依赖 key union 加 `'queryZcode'`（**易漏**） |
| `server/index.ts` | `const queryZcode = providerRuntimeService.getRunner('zcode')` + 传入 module |
| `server/modules/commands/commands.routes.ts` | `MODEL_PROVIDERS` + `MODEL_PROVIDER_LABELS.zcode = 'ZCode'` |
| `server/modules/notifications/services/notification-orchestrator.service.ts` | label map `zcode: 'ZCode'` |
| `server/modules/websocket/services/shell-websocket.service.ts` | PTY 启动分支（`zcode` / `node <cjs>`） |
| `server/modules/database/schema.ts` | `provider_models` CHECK 加 `'zcode'`（`migrateProviderModelsProviderCheck` 自动迁移，无需新 migration） |
| `server/modules/providers/README.md` | provider 列表 + MCP/skills/sync 表补 zcode 行 |

### 修改（前端，机械规则：`grep -rn "workbuddy" src/` 逐处镜像）

- 类型/常量：`src/shared/types.ts`（`LLMProvider` 加 `'zcode'`）、`src/shared/constants.ts`（`MCP_PROVIDER_NAMES`/`MCP_SUPPORTED_SCOPES`/`MCP_SUPPORTED_TRANSPORTS`/`MCP_SUPPORTS_WORKING_DIRECTORY`/`PROVIDER_PERMISSION_PREFERENCE_KEYS`）、`src/shared/userSettings.ts`（新增 `zcodePermissions` 偏好键，否则上面那个 `Record<LLMProvider,…>` 无法编译）
- UI 派发：`src/shared/ui/LLMProviderLogo.tsx` + 新建 `ZcodeLogo.tsx`
- chat：`useChatProviderState.ts`（`PROVIDERS` + `FALLBACK_PERMISSION_MODES.zcode` + fallback model）、`chatProviderLabel.ts`、`MessageComponent.tsx`、`ProviderSelectionEmptyState.tsx`、`ModelLibraryPanel.tsx`、`ModelLibraryPanel.tsx`（**v5：zcode 目录列出全部配置模型；模型库自定义模型表单注明自定义 ID 需写成 `<渠道>/<模型>`**）
- 权限模式 UI：composer 模式选择器对 zcode **默认 `acceptEdits`**；选中 `bypassPermissions`(yolo) 时显示显著警示（"将自动批准包括命令执行在内的全部工具"）
- auth/onboarding：`ProviderLoginModal.tsx`（无 OAuth，展示状态即可，参考 DSH/Pi 呈现）、`useProviderAuthStatus.ts`、`AgentConnectionsStep.tsx`、`AgentConnectionCard.tsx`
- settings/agents-settings：`AgentsSettingsTab.tsx`、`AgentSelectorSection.tsx`、`AgentCategoryContentSection.tsx`、`AccountContent.tsx`、`PermissionsContent.tsx`、`Settings.tsx`/`useSettingsController.ts`
- mcp/skills/sidebar：`McpServers.tsx`、`ProviderSkills.tsx`、`SidebarContent.tsx`、`SidebarRecentConversations.tsx`、`sidebarProjectFormatting.ts`
- i18n：`en` + `zh-CN` 的 `chat.json`（`messageTypes.zcode`、`providerSelection.*.zcode`）与 `settings.json`（agents.account.zcode、MCP 描述）；其余 locale 走 en fallback（与 pi 现状一致）
- `public/api-docs.html`：`PROVIDER_ORDER` 加 zcode

> 前端路径以 `src/modules/...` 为准（README 里的 `src/components/...` 是过时路径）。编译级触点（union / `Record` 键 / i18n 键）最终以 `npm run typecheck` 报错为准逐一补齐，「grep workbuddy」只作兜底。

## 2. 事件映射设计

### 2.1 实时 stream-json 事件 → NormalizedMessage（`zcode-sessions.normalizeMessage`）

| ZCode 事件 | 输出 |
|---|---|
| `model.streaming` kind `text_delta` | `kind:'stream_delta'`（正文通道） |
| `model.streaming` kind `text_start`/`text_end` | 忽略（或 `stream_end`，保持与 workbuddy 一致） |
| `model.streaming` kind `reasoning_delta` | `kind:'stream_delta'`，`streamChannel:'thinking'` |
| `model.streaming` kind `tool_call`（`toolCallId`/`toolName`/`input`） | `kind:'tool_use'`，`toolId`/`toolName`/`toolInput` |
| `model.streaming` kind `tool_input_start/delta/end` | 忽略（`tool_call` 已带完整 input，避免重复渲染） |
| `tool.updated` kind `started` | 忽略（`tool_call` 已发） |
| `tool.updated` kind `result` | 更新对应 `tool_use` 的 `toolResult = {content: result.content, isError: !result.success}`（**成功输出主通道；原方案漏了此 kind**） |
| `tool.updated` kind `error` | 更新对应 `tool_use` 的 `toolResult = {content: error.message, isError:true}` |
| `tool.updated` kind `batch` | **不忽略**：按 payload 的 `toolCallIds[]` **逐个**闭合对应卡片（deny 不产生 `kind=error`）；与 `permission.resolved` 的重叠靠幂等集合去重 |
| `permission.requested` | `kind:'error'` 或专用提示消息（见 §3.4），内容含工具名与风险级别 |
| `permission.resolved`（decision=deny） | 拒绝提示（见 §3.4），是熔断计数来源；**同时以此闭合对应 `toolCallId` 的 tool_use**（否则卡片停在「执行中」） |
| `turn.completed` | `kind:'stream_end'`；`response` 若正文未流式（异常路径）时兜底为 `kind:'text', role:'assistant'`；usage → tokenUsage |
| `result` | 仅作进程终态判据（`response`/`usage`），不重复发文本 |
| `session.titleUpdated` | 忽略（由 synchronizer 用 `session.title` 落库） |
| `session.updated` / `turn.started` / `streamRecovery.updated` | 忽略（无渲染语义；`streamRecovery.updated` 仅日志） |
| 未知 type | `console.warn` 跳过 |

**ID/时序**：正文 delta 用 `assistantMessageId` + 单调 `seq` 合成稳定 id；工具用 `toolCallId`。用户 prompt 在 stream-json 里**没有** user 文本回显事件（只在 `turn.started.payload.input` 元数据里），因此**无需 workbuddy/pi 那样的“跳过 user 回显”处理**——但为稳妥，normalizeMessage 仍忽略任何 role:user 的文本事件。

**sessionId 提取（v2 修正，v3 收尾）**：实测前 3 条事件（`session.titleUpdated`/`turn.started`/`session.updated`）**都不带 `sessionId`**，首个带 `sessionId` 的是第 4 条 `session.updated` 变体。故 `session_created` 的提取必须是「顺序扫描事件，取首个 payload 内含 `sess_` 前缀 `sessionId` 者」。**兜底链（v3 定稿）**：扫描事件（主路径，实测 #4 即命中）→ 回读 sqlite。**删除 `ZCODE_SESSION_ID` 兜底**（它是注入给子进程的模板变量，runtime 读不到，见 §已实测）。回读 sqlite 必须加防串条件：`directory = --cwd 的 realpath` **且** `time_created ≥ 本进程 spawn 时刻` **且** 排除已绑定 `provider_session_id` 的会话，避免同目录并发会话互相命中。

**tool_use 终态闭合（v2 补充，v3 定稿为幂等设计）**：三类终止分别走 `tool.updated/result`（成功）、`tool.updated/error`（执行失败）、`permission.resolved deny` + `tool.updated/batch`（权限拒绝）。注意：
- `batch` payload 形如 `{toolCallIds: string[], successCount, errorCount}`，**携带具体 `toolCallIds` 列表**，应按列表逐个闭合，不能只看 `errorCount`。
- `errorCount` **不区分**「权限拒绝」与「执行失败」（后者已由 `kind=error` 闭合），因此 `permission.resolved` 与 `batch` 对同一卡片**必然重叠**。
- 故必须**幂等**：runtime 维护 `closedToolCallIds: Set<toolCallId>`，三路闭合统一走一个 helper，已闭合的 id 直接忽略。

### 2.2 历史（sqlite）→ NormalizedMessage（`zcode-sessions.fetchHistory`）

`message` + `part` 两表 LEFT JOIN，按 `(time_created, id)` 排序，逐 part 归一（**与 opencode 同构，直接移植 `normalizeHistoryRows`**）：

| part.type | 输出 |
|---|---|
| `text` | `kind:'text'`，role 取 message.role（user/assistant）；user 侧解析 `<images_input>`/`<files_input>` 标签（若 cloudcli 用 attach 则此处无标签，保留解析以兼容手工会话） |
| `reasoning` | `kind:'thinking'` |
| `tool`（`state.status`=completed/error） | `kind:'tool_use'` + `toolResult={content, isError}`（`state.output`/`state.error`） |
| `step-finish` | `kind:'stream_end'` |
| 其它（`step-start`/`patch`/`agent`） | `step-start` 跳过；`patch`/`agent` 按 opencode 规则映射为 tool_use |

**usage**：优先 `turn_usage` 聚合；缺失时按 opencode 做法累加各 assistant `message.data.tokens`（`input`/`output`/`reasoning`/`cache.read`/`cache.write`）。`buildTokenUsage` 口径与 opencode 保持一致。**此处「累加」与 §1 token-usage 服务的「取最新一条」并不矛盾**：后者是「当前上下文占用」endpoint 语义（实测 zcode tokens 为每轮 prompt 快照，取最新=当前窗口占用），此处是会话历史展示的总量口径，两者分工不同。

**分页契约**：`limit:null`=全量 / `limit:0`=空页 / 必返 `total,hasMore,offset,limit`（用共享 `sliceTailPage`）。

## 3. runtime 设计

### 3.1 spawn 参数

```bash title=zcode-runtime-spawn-参数
node <zcode.cjs> --prompt <prompt> --output-format stream-json --no-color \
  --cwd <workingDir> --mode <build|edit|plan|yolo> \
  [--resume <sess_...>] \
  [--attach <absPath> ...] \
  [--disallowed-tools <name ...>]      # 可选，best-effort 拒绝（非安全边界，见下）
```
- `getZcodeCommand()`：`ZCODE_COMMAND`（可含 "node <cjs>" 的多词？——解析为 `command + args`，见下）→ PATH `zcode` → App 内置 `.../glm/zcode.cjs`（内置时前置 `node`）。
  - 实现要点：命令解析返回 `{command, baseArgs, source}`；内置路径时 `command='node', baseArgs=[cjsPath]`；override/PATH 二进制时 `baseArgs=[]`。
- `cwd` = session 的 `workingDir`/`projectPath`（同时传 `--cwd`，保证 zcode 的 session 归属目录正确）。
- 附件：`options.attachments` 逐个 `--attach <absPath>`（realpath + allowed-root 校验照抄 Codex/Pi 的路径校验，含 symlink 逃逸防护）。**普通文件与图片都走 `--attach`，且实测图片可被模型识别**（红图→`red`），故 `supportsImages: true`。
- `--disallowed-tools`（**v3 定位：预留能力，首版不注入、不暴露 UI**）：0.16.5 **实测接受**，能拒绝被点名的工具，但**只是按工具名的 best-effort 拦截，模型可换工具绕过**（实测 deny `Write` 后改用 `Bash` 成功写文件），**不构成安全边界**。首版**不注入**该 flag（避免产生无 UI 来源的"幽灵配置项"）；后续迭代再加 settings 入口 + `zcodeDisallowedTools` 偏好键。spawn 参数中保留该位，实现 `getZcodeCommand`/arg 拼装时预留。
- **prompt 经 argv**：实测无 stdin 通道（`--prompt -` 不读 stdin、`-p` 缺参报错）。故需：① 对拼接后的 prompt 施加长度上限并在超限时给出明确错误（macOS `execve` argv 有上限）；② 文档注明 prompt 会出现在 `ps` 输出中（已知暴露面，0.16.5 无 CLI 侧规避手段）；③ `turn.started.payload.input` 的元数据可作为长度校验参考。
- env 透传；`stdin` 立即 `end()`（`--prompt` 模式不读 stdin）。
- `--no-color` 必须传，避免 ANSI 污染 NDJSON 行。

### 3.2 会话管理

- 首跑不传 `--resume`；**顺序扫描事件，取首个 payload 内含 `sess_` 前缀 `sessionId` 的事件**（实测前 3 条事件均不带 sessionId，#4 才出现；**不能取首事件**），发一次 `session_created`（同 workbuddy `announceSession`）。兜底：直到 `turn.completed`/`result` 仍无 → 回读 sqlite（带防串条件：`directory` realpath + `time_created ≥` spawn 时刻 + 排除已绑定 `provider_session_id` 的会话）。**不使用 `ZCODE_SESSION_ID`**（注入型模板变量，见 §已实测）。
- 后续 `--resume <sess_...>`，不再发 `session_created`。
- `activeProcesses: Map<appSessionId, ChildProcess>` 防并发；`abortedSessionIds: Set` 让 close 时正确报 aborted。

### 3.3 abort / timeout / 收尾

- abort：`SIGTERM` → 3s 后 `SIGKILL` 兜底（zcode 无 stdin 控制协议；`--prompt` 一次性进程，SIGTERM 足够）。close 读 aborted 标记 → `createCompleteMessage({exitCode:0, aborted:true})`。
- timeout：`ZCODE_RUN_TIMEOUT_MS`（默认 60min，仿 `WORKBUDDY_RUN_TIMEOUT_MS`）。
- 收尾契约照抄 WorkBuddy：恰好一条 `complete`、close 时 flush 无尾换行残留 buffer（`result` 可能是末行无换行）、`pendingFinish` 由 `result`/`turn.completed` 决定，非零退出且无终态事件 → 报 stderr（redact）。

### 3.4 权限拒绝防御（**本方案最重要的新增设计**）

因为 headless 无审批通道、非 yolo 模式会静默拒绝并可能陷入重试循环，runtime 必须：

1. 解析 `permission.resolved`（`decision:'deny'`）与 `permission.requested`，累计 `deniedToolCalls`，并**用 `permission.resolved`/`tool.updated/batch{errorCount}` 闭合被拒工具的卡片**（deny 不发 `kind=error`）。
2. 对**首个**拒绝发一条 `kind:'error'` 提示（**v2 已改文案方向**）：`"ZCode 在 headless 下无法弹出审批，<tool> 已被拒绝，本任务可能无法完成。文件编辑类任务可切到 acceptEdits(edit) 模式；仅当你确认信任该任务时，才考虑 bypassPermissions(yolo)（= 全自动批准，含任意命令执行）。"` —— 先解释失败原因与后果，把 `acceptEdits` 作为首选建议，**不把 yolo 当首选**。
3. **熔断**：一个**进程内**（一次 spawn = 一个 `--prompt` 回合；`--resume` 是新的 spawn，计数重置）拒绝数 ≥ `ZCODE_MAX_DENIALS`（默认 3）时，主动 `terminateChild()` 并以 `exitCode:1` 结束，避免 1.1MB/45s+ 的空转（实测最坏情况）。可配置，默认开启。
4. **可选事前防线（v3：首版不启用）**：`--disallowed-tools`（见 §3.1，可被绕过、非安全边界）首版**不注入**，仅保留参数位与探测结论；入口留待后续迭代。

> 该设计把「静默拒绝 → 无限重试」这一实测风险转成「一条可见错误 + 快速失败」。计数语义：**每次 spawn 重置**（含 `--resume` 续接），不做跨进程累计。
> **熔断终止的呈现（v3 新增）**：熔断时给 complete 消息附**专用错误标识 `ZCODE_PERMISSION_CIRCUIT_OPEN`**（而非仅 `exitCode:1`），供前端渲染「因多次工具拒绝而终止，可切换权限模式重试」的专用文案，与「正常失败」区分。阶段 4 UI 走查需覆盖该路径。

## 4. 能力矩阵

```ts title=provider-capabilities-ZCode
zcode: {
  provider: 'zcode',
  permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
  defaultPermissionMode: 'acceptEdits',   // = edit，v2 调整（原为 bypassPermissions）；理由见下
  supportsImages: true,     // v2 实测：--attach 红图 → 模型答 red
  supportsFiles: true,      // --attach
  supportsAbort: true,
  supportsPermissionRequests: false,  // headless 无审批通道，拒绝即 deny
  supportsTokenUsage: true,           // turn.completed.usage / message.tokens
  supportsEffort: false,              // 无 effort 入口
  supportsMessageEditing: false,      // 无 resume-at-row
  supportsSessionForking: false,      // 仅对 --prompt 路径；app-server 有 session/fork（未采用，见 §附录-A）
}
```

**模式映射（`PERMISSION_MODE_MAP`）**：

| CloudCLI PermissionMode | ZCode `--mode` | 语义 |
|---|---|---|
| `default` | `build` | 读取放行、写/命令被拒绝（headless 无审批）；靠 §3.4 熔断保护 |
| `acceptEdits` | `edit` | 自动批准文件编辑，命令仍需审批→被拒（**默认值**，v2 调整） |
| `bypassPermissions` | `yolo` | 全部自动批准（含任意命令执行）；**需用户显式选择** |
| `plan` | `plan` | 只规划不落盘 |

> **默认值决策（v2）**：由 `bypassPermissions` 改为 **`acceptEdits`(edit)**。理由：`yolo` = 写文件 + Bash 全自动批准且 headless 无二次确认，作为「用户不主动改模式时的默认」等于默认关闭安全阀，与其余 7 个 provider 的默认口径（均需审批/保守）相悖；`acceptEdits` 让最常见的文件编辑类任务可用，同时把命令执行挡在默认之外。事实澄清：`--help` 明确 `default: yolo for --prompt`，故「zcode 原生默认是保守的 build」不成立（build 是 TUI 默认）——但「原生默认」不应作为产品默认的依据。代价：涉及 Bash 的任务在默认模式下会被拒并触发 §3.4 熔断，需在 UI 明确引导用户按需切换。
> 配套 UI：composer 的模式徽标对 `bypassPermissions` 显示显著警示；对 `acceptEdits` 下的 Bash 拒绝给出 §3.4 的可读提示，并把**熔断终止（`ZCODE_PERMISSION_CIRCUIT_OPEN`）与普通失败区分呈现**。`--disallowed-tools` 首版不暴露 UI（见 §3.1）。
> 与 pi 的差异：pi 只暴露 `['default','readonly']`；zcode 四种模式实测各有真实语义（yolo/edit/build/plan 行为已逐一验证），故如实暴露。

## 5. 实现前必须先验证的点（阶段 3 开工时实测）

> v2 已消解原第 1 项（图片 attach，实测支持）。以下为仍需实测的项。

1. **SIGTERM 中断后 sqlite 已落盘的 message/part 是否保留**：中断后 `fetchHistory` 能读到已完成部分（预期有尾缺）。**容错策略（v2 已明确）**：`JSON.parse` 失败的 message/part 行整行跳过；缺 `data`/`type` 等必需字段的行跳过；`message` 无对应 `part` 时渲染空内容而不报错；未知 `part.type` 忽略。用截断 fixture 在 `zcode-sessions.test` 覆盖。
2. **中断会话随后 `--resume` 是否可用**：半写状态的会话可能拒绝续接或行为异常（只验证了「可读」，未验证「可续」）。
3. **`--resume` 跨 cwd**：会话 `directory` 与 cloudcli 传入的 `workingDir` 不一致时 `--resume` 是否仍命中（决定是否需要 `--cwd` 与会话目录强绑定）。
4. **`--resume` 跨 mode**：历史会话在某 mode 下创建、续接时传不同 `--mode`，zcode 是否接受 / 行为如何。
5. **拒绝熔断阈值**：实测 `build`/`edit` 模式在「必须写文件 / 必须执行命令」任务下的重试次数与耗时，校准 `ZCODE_MAX_DENIALS` 默认值。
6. **末行无换行**：确认 `result` 是否为末行且可能无 `\n`（照抄 workbuddy flush 逻辑，用 mock 覆盖）。
7. **`node` 不在 server PATH 时**（launchd 环境无 nvm）：`ZCODE_COMMAND` 覆盖 + not installed 状态呈现。
8. **sqlite 并发读**：zcode 运行中（WAL 模式）cloudcli 只读打开是否稳定；必要时加 `busy_timeout`。
9. **`--surface` 缺省影响**：CLI 由桌面 App 分发且 help 有 `--surface terminal|desktop`，确认缺省 surface 下 stream-json 事件形状与 terminal 一致（本方案实测均在缺省下，暂未见异常）。
10. **`--locale` 固定**：runtime 是否需固定 `--locale en-US`，避免错误/事件文案随环境漂移（若有按文本匹配的错误分类逻辑需特别注意）。
11. **`session.directory` 抽样**：抽查多个真实会话确认始终为绝对路径且稳定（v2 抽查 8 条均绝对；注意 macOS `/tmp`→`/private/tmp` 归一）。
12. **prompt argv 长度上限**：实测触发 `execve` 长度上限的具体阈值，用于设定 **runtime** prompt 长度校验值。基线参考（v3 补充）：macOS 单个 argv 参数上限约 256KB、argv+env 总量上限约 1MB（ARG_MAX）；校验值应显著低于两者，并为多个 `--attach` 路径预留余量。

### 决策点（v2 已定夺）

- **§6-MCP**：**实现读 + 写**（user + project；理由与残余竞态见 §6）。
- **§4-defaultPermissionMode**：**定为 `acceptEdits`(edit)**（v2 调整，理由见 §4）。`bypassPermissions`(yolo) 保留为需用户显式选择的选项。
- **模型选择**：~~OPTIONS 收敛为 `model.main` 单模型~~ → **v5 改为全量目录 + `ZCODE_*` 环境通道落地切换**（`--model`/`--settings`/`/model` 三条 flag 通道仍不通，但环境通道可用且不改写配置；见 §附录-A 与 §附录-C）。

## 6. MCP 支持评估与建议（回答用户第 3 个问题）

**结论：建议实现 MCP 的读 + 写（user + project 两个 scope），但写入必须严格 read-modify-write。**

理由：
1. **schema 与本仓库模型 1:1 对齐**：zcode 支持 `stdio`/`http`/`sse`，与 `McpTransport` 完全一致；条目字段（command/args/env/cwd/url/headers）与 `ProviderMcpServer` 可直接映射。相比之下 pi 是「无原生支持 → 空 scope」，zcode 属于「有原生支持且格式简单」。
2. **落点已被端到端验证**：`mcp.servers` 在项目配置里注入后确实被 CLI 加载（§已实测）。
3. **成本低**：只需一个 JSON 文件读写 facet + 前端 `McpServers.tsx` 的 map 补一行。

风险与约束（写进实现）：
- **同文件多方写（v2 加强）**：`~/.zcode/cli/config.json` 还被用户的 `zcode-sync`（只重写 `provider`）和桌面端（只写 `command`/`plugins`/`storage`）读写。cloudcli 写入**只能改 `mcp.servers`，其余顶层键原样保留**，并采用与 `zcode-sync` 一致的原子写（临时文件 + rename）。**RMW 只缩小竞态窗口、不消除竞态**：读快照→rename 之间若另一方已写入，旧快照会覆盖对方新改动。v2 要求额外做**乐观并发校验**：写入前比对快照的 `mtime`+`size`（或内容 hash）与当前文件一致；不一致则重读重算后重试（有限次），仍失败则以可读错误中止。文件锁（`ZCODE_FILE_LOCK_TIMEOUT` 提示 zcode 侧有锁机制）留作后续增强。**残余竞态窗口记为已知风险**。
- **scope 语义**：user scope → `~/.zcode/cli/config.json`；project scope → `<workspacePath>/.zcode/config.json`。**不支持 `local` scope**（zcode 无第三层）。`MCP_SUPPORTED_SCOPES.zcode = ['user','project']`。
- **stdio cwd**：zcode `PAo` 支持 `cwd`，故 `MCP_SUPPORTS_WORKING_DIRECTORY.zcode = true`。
- **不做**：不管理 zcode 的 plugin 内嵌 MCP（只读展示或直接忽略）。

> v2 定夺：**实现读 + 写**（采纳乐观并发校验 + 记录残余竞态），不降级为只读。若实现期发现 mtime 校验在实践中频繁失败，再退回只读并记录原因。

## 7. 测试计划

- `zcode-auth.test.ts`：内置/ PATH / `ZCODE_COMMAND` 三种解析；未安装；已认证（config.json 有带 apiKey 的 provider + 可解析模型）/未认证（无文件）；**仅 v2/credentials.json 时判未认证（负例）**；缓存 reset
- `zcode-models.test.ts`：**全量目录（多 provider、同 id 靠 group 区分、label 取 `name` 否则裸 modelId）**、`model.main` 为 `DEFAULT`（缺失时退化首个）、缺文件/坏 JSON/无模型 fallback、**`resolveZcodeModelEnv` 返回 trio、请求默认模型时返回 `null`、前缀无法解析报 `ZCODE_MODEL_CHANNEL_UNRESOLVED`（裸 id / 未知渠道 / 渠道缺 baseURL 或 apiKey）、解析过程不改动配置文件**
- `zcode-sessions.test.ts`：normalizeMessage 各 stream-json 事件（text/reasoning/tool_call/**tool.updated result/error/batch**/permission-deny/turn.completed/result）；**两次 spawn 的 `session_created` 提取（首事件无 sessionId 的负例）**；**deny 后 tool_use 卡片闭合**；**`permission.resolved` 与 `batch` 同时到达同一 toolCallId 时只闭合一次（幂等）**；fetchHistory 用临时 sqlite（message+part 样例）验证 text/reasoning/tool/step-finish、分页契约、usage 汇总、**无 project 表**、**截断/半写行容错**
- `zcode-session-synchronizer.test.ts`：upsert、title 取值（session.title / 首条 user 兜底）、time_archived 过滤、坏库容错、`jsonl_path=null`、**只匹配主库 `db.sqlite`（不匹配 -wal）**
- `zcode-runtime.test.ts`：mock CLI（`ZCODE_COMMAND` 指向 `zcode-mock-cli.mjs`）——session_created、正常流式文本/思考/工具（**成功输出经 `tool.updated/result`**）、**permission deny → 错误提示 + tool 闭合 + 熔断退出并附 `ZCODE_PERMISSION_CIRCUIT_OPEN`**、**`--resume` 时熔断计数重置**、`--resume` 透传、`--attach` 参数、**prompt 超长报错**、abort、超时、末行无换行 flush、并发拒绝、非零退出无终态、**请求的非默认模型通过 `ZCODE_MODEL`/`ZCODE_BASE_URL`/`ZCODE_API_KEY` 注入子进程且配置文件字节不变**、**请求默认模型时不注入环境变量**、**渠道无法解析的模型在 spawn 前失败（子进程未启动）**
- `zcode-mcp.test.ts`：list/upsert/remove（user+project）、**保留未知顶层键**（模拟已有 `provider`/`command`/`plugins` 键）、**快照 mtime/size 变更时中止并重试**、transport 校验、坏 JSON 容错、原子写
- `zcode-skills.test.ts`：`~/.zcode/skills/**/SKILL.md` 递归、缺失目录容错、命令语法
- 既有测试同步：`provider-runtime.service.test.ts`（id 列表）、`mcp.test.ts`（全局写入覆盖 8 providers）、`agent.routes.test.ts`（`queryZcode`）、`provider-models.db.integration.test.ts`、前端 `chatProviderLabel.test.ts`
- 前端：`chatProviderLabel`/`composerToolsSettingsResolution` 等现有测试镜像加 zcode 断言

## 8. 实施顺序

1. **阶段 1 — 静态注册骨架**：`LLMProvider`/registry/routes/capabilities/schema/commands/notification/README + wrapper、auth、models、mcp、skills facet（runtime/sessions/synchronizer 最小可编译）。验证：`npm run typecheck` + `npm run lint:server` + 既有测试无新增失败
2. **阶段 2 — 磁盘会话链路**：`zcode-sessions` + `zcode-session-synchronizer` + watcher 注册 + token-usage 分支 + sqlite 测试夹具。验证：重启 server 后本机真实 zcode 会话出现在侧栏且消息完整
3. **阶段 3 — 实时 runtime**：先做 §5 验证项 1–12，再实现 `zcode-runtime` + `agent.routes`/`agent.module`/`server.index` + shell-websocket 分支 + 拒绝熔断。验证：浏览器内 zcode 对话、多轮 `--resume` 续接、abort、附件（含图片）
4. **阶段 4 — 前端全触点 + i18n + api-docs**：`grep workbuddy src/` 逐处镜像、en/zh-CN locale、`ZcodeLogo`、**模式徽标警示（bypassPermissions）与「模型由 zcode 配置决定」提示**。验证：`npm run build` + 手动走查
5. **阶段 5 — 收尾**：全部测试、lint/typecheck/`npm test`、按 provider-adapter-verification 做端到端只读验证（含工具调用生命周期、会话历史回看）
6. **后续（不在本次范围）**：评估 `app-server`（ZCode Protocol）接入以解锁模型切换 / 运行时切 mode / 权限应答 / fork——见 §附录-A。

## 验证命令

```bash title=验证命令
npm run lint:server
npm run typecheck
npm test
npm run build        # 阶段 4 后
```

### Critical Files（实现模板）

- `server/modules/providers/list/workbuddy/workbuddy-runtime.provider.ts` — runtime 模板（spawn/行解析/session_created/abort/complete 收尾）
- `server/modules/providers/list/opencode/opencode-sessions.provider.ts` — **历史读取模板（zcode 与之同构，直接移植）**
- `server/modules/providers/list/opencode/opencode-session-synchronizer.provider.ts` — 同步器模板（需去 `project` join）
- `server/modules/providers/list/opencode/opencode-models.provider.ts` — 模型目录/配置读取模板
- `server/modules/providers/list/workbuddy/workbuddy-auth.provider.ts` — 命令解析模板
- `server/modules/providers/services/provider-capabilities.service.ts` — 能力矩阵
- `server/modules/providers/README.md` — 9 步接入流程

## 附录-A：模型选择与 app-server（回应 Pi 的两条 §CAUTION）

**议题一：headless 模型选择断链（Pi 指出，v2 采纳）**
- 实测确认：`--model` 是僵尸 flag（`Unknown option`）；`--settings` 也是僵尸；grep 全部 `ZCODE_*` 环境变量**无模型选择项**（`ZCODE_MODEL_RETRY_*` 只是重试参数）。`/model` 只是 TUI slash 命令，headless 无对应入口。
- 结论：**headless 下模型只能由 `cli/config.json` 的 `model.main` 决定**。故 v2 将 `zcode-models` 的 OPTIONS **收敛为 `model.main` 单模型**，UI 注明「模型由 zcode 配置决定」，不再假装提供可切换目录（避免「前端换了模型、runtime 仍用默认」的断链）。写项目级 `<cwd>/zcode.json` 改模型的做法被否决（污染用户工作区、并发会话互踩）。多模型能力留待 app-server 的 `session/setModel`（后续项）。**→ 附录-C（v5）已改为：全量列目录 + per-process 的 `ZCODE_MODEL`/`ZCODE_BASE_URL`/`ZCODE_API_KEY` 环境通道落地切换（不改写任何配置文件）；「写项目级配置文件」仍被否决。**

**议题二：为何不采用 app-server（Pi 指出前提不完整，v2 部分采纳）**
- 事实：`app-server` 子命令存在，bundle 实证协议方法含 `session/create|send|stop|setMode|setModel|fork|messages|usage|subscribe`，事件含 `permission.requested` / `userInput.requested`；`session` 表有 `parent_id` 列。**若走 app-server，可一并解锁**：模型切换（setModel）、运行时切 mode（setMode）、**权限应答**（`permission.requested` 有应答通道，可根治 §3.4 的静默拒绝问题）、以及 fork。
- 本方案仍选 one-shot `--prompt` 的理由：app-server 是**长驻进程 + 双向 JSON-RPC/订阅生命周期 + 握手/鉴权**的完整交互协议，接入复杂度与失败面显著高于一次性子进程；v1 目标是把 zcode 快速接成可用 provider。这是一次**有意识的取舍**，不是「zcode 无此能力」。
- 术语更正（已同步到 §1/§4）：`IProvider.fork` 缺省、`supportsSessionForking:false` 的准确表述是「**`--prompt` 路径无 fork 入口**（app-server 有 `session/fork`，本方案未采用）」。
- 后续项：已列入 §8 阶段 6。届时 setModel / setMode / 权限应答 / fork 均可一并评估。

## 附录-B：阶段 3 开工实测与对正文的更正（v4 · 2026-09-13）

> 用本机真 CLI（0.16.5）在临时 cwd 下复测 §5 验证项，产生的临时会话已从真实库清理；未改动用户 zcode 配置。以下更正均已落到实现。

**更正 1 — `ZCODE_STORAGE_DIR` 不重定位 config/db（推翻 §已实测 的「可用于配置落点控制」）**
- 实测：`ZCODE_STORAGE_DIR=<sandbox>` 时，CLI 仍读 `~/.zcode/cli/config.json`（沙箱放 bogus config 也照跑不误），会话仍写入 `~/.zcode/cli/db/db.sqlite`；`ZCODE_ENV=beta` 亦然。只有 plugin cache 等辅助状态进了沙箱。
- 影响：`getZcodeHomeDir()` 改为**恒 `~/.zcode`**（homedir），不再读该 env；测试隔离改用显式 seam `setZcodeHomeDirForTests()`。README 同步更正。

**更正 2 — session id 在事件信封、首条事件即有（修正 §3.2 的「前 3 条无 sessionId、#4 才出现」）**
- 实测 `session.titleUpdated`（#1）的信封即含 `sessionId: sess_...`；payload 内无。提取改为读**信封 `sessionId`**（回退 payload），sqlite 回读兜底保留（含 §3.2 防串条件）。

**更正 3 — `tool.updated/batch` 成功时也会发（补 §2.1）**
- `payload={toolCallIds, successCount, errorCount}`；成功 run 亦发 `batch{errorCount:0}`。故幂等闭合是**设计必需**（`result` 先闭合、`batch` 必须被忽略），非仅用于 deny。`permission.resolved` 的 payload 确认含 `toolName`/`riskLevel`。

**更正 4 — 权限行为与 §3.4 前提有出入，熔断降级为安全网**
- `edit`（默认 acceptEdits）**会自动批准非破坏性命令**（`echo` 实测成功），并非「Bash 一律被拒」；`build` 对写文件(medium)+高危命令(high) 在 **2 次拒绝后优雅放弃**（~10s、137KB、exit 0、以正文说明失败），**未复现** 1.1MB/45s 重试循环。
- 因此熔断仍实现（默认 `ZCODE_MAX_DENIALS=3`）作安全网，但**排除交互工具 `ExitPlanMode`**：headless 必然拒绝它，plan 模式每轮都会出现，若计数会对正常 plan 运行误报。
- §4 默认 `acceptEdits` 保持不变：常见文件编辑可用，写/高危命令仍受控。

**更正 5 — 终态事件形状**
- `result` 是**顶层事件（无 payload）**：`{type,sessionId,response,usage,projection:{contextUsed,contextWindow}}`；`turn.completed.payload.response` 在「回合以工具调用结束」时可能为 `""`（真回复只在终态）。
- `--resume` 实测跨 cwd、跨 mode 均被接受且命中同一会话（§5 第 3/4 项结论：无需把 `--cwd` 与会话目录强绑定）；未知 session 时**仅 stderr + exit 1、无 stdout**，故 runtime 在「非零退出且无终态事件」分支必须把 stderr（redact 后）作为 error 消息上报。

**端到端**：真 CLI 跑通 runtime 全链路——`session_created` → thinking/text delta → `tool_use`+`tool_result`（真实 `ZCODE_RUNTIME_OK`）→ `stream_end` → `complete`(exit 0)，无错误。

## 附录-C：模型可切换（v5 · 2026-09-13，取代附录-A 议题一的「单模型收敛」结论）

> 附录-A 议题一与 §1/§3.1/§7 里「OPTIONS 收敛为 `model.main` 单模型」的结论**已被本节取代**；其余论证（`--model`/`--settings`/`/model` 三条通道均不通）仍然成立，并再次复测确认。

**背景**：接入完成后用户提出「为什么 zcode 只有 `ark/deepseek-v4-flash` 一个模型」。原因是 `loadZcodeModels()` 按 v2 决策只输出 `model.main` 一项；而用户配置里实际有 14 个模型（`ark` 12 个 + `deepseek` 2 个）。用户选择「列出全部并支持切换」。

**再次复测的三条通道（结论不变）**
- `--model <id>`：不存在（`--help` 里也没有）。
- `--settings <path>`：`--help` 里有，但解析器报 `Unknown option '--settings'`（用一份把 `model.main` 改成 `ark/glm-5.3` 的配置实测，CLI 直接拒收该参数）。
- `/model <id>` 当 prompt 发：被当普通文本喂给模型（模型回复「用户输入了 `/model`」），未触发 slash 命令。

**关键新发现：per-process 环境通道（本附录的实际落地机制）**

上面三条 flag 通道确实都堵死，但配置分层里还有一层 `ZCODE_*` 环境变量。实测（0.16.5，临时 cwd，事后已从真实库清理会话）：

| 组合 | 结果 |
| --- | --- |
| `ZCODE_MODEL` + `ZCODE_BASE_URL` + `ZCODE_API_KEY` | **生效**：CLI 上报所选模型并正常作答 |
| 只给 `ZCODE_MODEL` | 失败（`Turn execution failed`）——**不继承**配置文件里 provider 的 baseURL/key |
| `ZCODE_MODEL` + `ZCODE_API_KEY`（缺 BASE_URL） | 模型被选中，但请求打到 `api.anthropic.com` → `invalid x-api-key` |
| `ZCODE_MODEL=bogus/glm-5.3` + 有效 URL/key | 生效，上报 `bogus/glm-5.3` —— 说明该通道**与配置里的 provider 条目无关**，`<provider>/` 前缀只是标签，连通性只由 URL+key 决定 |
| `ZCODE_MODEL=glm-5.3`（无斜杠） | 生效，上报 `anthropic/glm-5.3` —— 前缀默认成 `anthropic` |

- 三条环境变量**必须同时给**；override 只覆盖 `model` 层，其余配置（MCP、skills、权限、工具）照常加载（实测 `toolCount` 与走配置路径时同为 19）。
- 因此**不需要改写用户的 `model.main`**：没有全局副作用、不影响 ZCode TUI/桌面端、不需要并发锁。

**采用的方案（选项 B）**
1. `loadZcodeModels()` 遍历 `provider.<id>.models` 全量输出，值 `<providerId>/<modelId>`、`label = entry.name ?? modelId`、`group = providerId`（`ark` 与 `deepseek` 都有 `deepseek-v4-flash`，靠 group 区分）；`DEFAULT` 仍为 `model.main`，`model.main` 缺失时退化为首个模型。
2. 新增 `resolveZcodeModelEnv(model)`：取值的 `<provider>/` 前缀 → 读该 provider 的 `options.baseURL` + `options.apiKey` → 返回 `{ZCODE_MODEL, ZCODE_BASE_URL, ZCODE_API_KEY}`。**请求的就是 `model.main` 时返回 `null`**（留给配置路径，那条路还带 provider headers/timeout/请求签名）；前缀无法解析出 URL+key 时抛 `ZCODE_MODEL_CHANNEL_UNRESOLVED`，**在 spawn 前失败**而不是静默用默认模型。
3. runtime 把该 trio 合并进 spawn 的 env；配置文件**不读模型、不写**。若 CLI 上报的模型与请求不符，仅记一条服务端 warn。
4. 前端：composer 模型菜单无需额外警示（切换是 per-run 的，无全局副作用）；模型库自定义模型表单注明「自定义 ID 需写成 `<渠道>/<模型>`，渠道须存在于 `~/.zcode/cli/config.json`」——这条同时说明自定义模型**可以**用（只要带渠道前缀）。

**已知取舍**
- 仍不提供 fork；`setMode`/权限应答/fork 继续留在阶段 6 的 app-server 议题内。
- 该通道绕过配置里 provider 的 `headers`/`timeout` 等字段（只用 baseURL + apiKey）。对 Z.AI/BigModel 这类需要请求签名的首方渠道，仍应把 `model.main` 设成它们、走配置路径。

## 审阅批注

> 审阅 harness 请在本节追加批注。格式建议：`### 审阅者：<harness 名>（日期）` + 分条意见（标注所属章节，如 §3.4）。同意可直接写"无异议"，有异议请给出理由与建议的替代方案。

（暂无批注）

### Claude · 2026-09-13

> [!CAUTION] §4 默认权限模式放 `bypassPermissions`(yolo) 风险过高，建议默认 `acceptEdits`(edit)
> yolo = 写文件 + Bash 全自动批准。CloudCLI 一旦选中 zcode provider、用户不主动改模式，即获得任意命令执行能力，且 headless 无审批通道、无二次确认，等于把"关掉安全阀"设为默认。这与 CloudCLI 其他 provider 的默认口径（需审批）相悖。另外方案把"开箱即用"作为理由，但 §已实测恰好显示 zcode 原生默认是保守的 `build`（写/命令全拒），并非 yolo——"原生默认"这一论据不成立。建议 `defaultPermissionMode: 'acceptEdits'`（写文件自动批、Bash 被拒），把 yolo 留给用户显式选择。

> [!CAUTION] §3.4 拒绝提示主动引导用户"切换到 bypassPermissions(yolo)"，是在教用户关安全阀
> build/edit 模式遇拒时，提示文案直接把用户推向 yolo。应改为：先说明该操作在 headless 下无法审批、任务将失败，再给出可选方案（切 `acceptEdits` 可让文件编辑通过；仅当用户确实信任任务时才考虑 yolo）。至少不应把 yolo 作为首选建议。

> [!WARNING] §1 认证检测把 `~/.zcode/v2/credentials.json`（桌面端凭据）计入 `authenticated`，可能产生假阳性
> §配置已明确"CLI 只读 `~/.zcode/cli/config.json`"。若 CLI 实际不读桌面端凭据，会出现"UI 显示已认证 → runtime 发起调用却认证失败"。请验证：仅存在 v2 凭据、config.json 无 provider 时 `zcode --prompt` 是否可用；不可用则认证检测只应看 config.json。

> [!WARNING] §6 并发写：read-modify-write 缩小窗口但不能消除竞态
> zcode-sync / 桌面端 / cloudcli 三方共写 `~/.zcode/cli/config.json`。RMW 保证"保留未知顶层键"，但若 cloudcli 读快照后、rename 前另一方已写入，旧快照会覆盖对方新改动。建议写前用 mtime / 内容 hash 校验快照仍最新，不一致则重读重算；或引入文件锁。至少把"残余竞态窗口"列为文档已知风险。

> [!WARNING] §3.1 `--prompt <text>` 走 argv，有长度与可见性两个问题
> ① macOS execve argv 总长度受限，长 prompt（大段粘贴 / 内嵌 base64 图片）可能超限报错——请实测 zcode 是否支持 stdin 传 prompt（如 `--prompt -`）；② prompt 作 argv 会出现在 `ps` 输出中，属已知暴露面，建议文档注明。

> [!WARNING] §2.2 与 §1(token-usage 服务) 的 usage 口径表述矛盾
> §2.2 历史 usage 写"累加各 assistant `message.data.tokens`"，§1 的 token-usage 服务分支却写"从 sqlite **最后一条** assistant `message.data.tokens` 汇总"。若只读最后一条，跨多轮会话的 token 统计会严重偏低，请统一为累加口径。

> [!IMPORTANT] §3.1 图片 attach 的措辞自相矛盾
> §3.1 断言"图片与普通文件都走 `--attach`"，§5 验证项 1 又说图片待实测、不支持则降级。请把 §3.1 改为"普通文件走 `--attach`；图片是否支持见验证项 1"，避免实现者照 §3.1 直接做死。

> [!IMPORTANT] §3.2 "首条事件的 sessionId" 提取时序需明确
> 实测事件表里首条很可能是 `session.titleUpdated`，其 payload 是否携带 `sessionId` 未列出。若首条事件无 sessionId，提取逻辑要等"首条携带 sessionId 的事件"（turn.started / session.updated）。请明确兜底事件，否则 `session_created` 可能缺失或取到 undefined。

> [!IMPORTANT] §2.2 / synchronizer `session.directory` 字段可靠性未列入验证项
> 去掉 project join 后 projectPath 直接取自 `session.directory`，但该字段是否总是绝对路径、跨会话是否稳定，方案未实测。建议加入 §5：抽查多个真实 zcode 会话的 directory 值，避免 projectPath 映射出错。

> [!IMPORTANT] §3.4 熔断"同一回合"需明确定义
> 从 runtime 看一次 spawn = 一个 `--prompt` 回合，熔断计数应在进程内累积、每次新 spawn（含 `--resume` 续接）重置。请在实现约定里写死，否则并发/续接下计数语义不清。

> [!NOTE] §5 建议补一条 `--resume` 跨 mode 的验证
> 历史会话在某 mode 下创建，续接时传入不同 `--mode`，zcode 是否接受 / 行为如何未验证。建议加入验证项，避免阶段 3 才发现续接模式不生效。

> [!NOTE] §5 验证项 2 的"读取需容错"要落到实现
> 中断后可能读到半条 message/part（time_created 排序末尾）。"容错"具体指跳过不完整 part、容忍缺失字段还是别的方式？建议明确策略，并在 `zcode-sessions.test` 用截断 fixture 覆盖。

> [!NOTE] §2.1 工具被拒后的 tool_use 终态闭合未定义
> `permission.resolved` deny 后，对应 tool_use 卡片是否还会收到 `tool.updated kind=error`？若不会，前端 tool_use 会一直停在"执行中"。请实测确认拒绝时 tool_use 的闭合事件，必要时在 §2.1 补一条映射。

### Pi · `01a09985-beaa-72d3-abbc-92923ab63c88`

> [!CAUTION] §1/§3.1 模型选择存在断链：headless 无任何传模型入口，composer 的多模型目录落不了地
> 实测 0.16.5：`--model` 报 `Unknown option`；grep 全部 `ZCODE_*` 环境变量无模型选择项（`ZCODE_ENV` 是部署环境开关）；`--settings`（可指定配置文件）为僵尸 flag。headless 下模型只能由配置 `model.main` 决定。因此 §1 `zcode-models.provider` 生成的多模型 OPTIONS 在 §3.1 的 spawn 参数里没有传递通道——用户在 composer 换模型后，runtime 仍会用 config.json 的默认模型。为会话写项目级 `<workingDir>/zcode.json` 不可取（污染用户工作区、并发会话互踩）。建议三选一：① OPTIONS 收敛为 `model.main` 单模型并在 UI 注明"模型由 zcode 配置决定"；② 评估走 app-server 的 `session/setModel`（见下条）；③ 若发现其他传递通道再恢复多模型。§7 的 models/runtime 测试断言需相应调整。

> [!CAUTION] 全文未评估 `zcode app-server`（ZCode Protocol）——fork 结论的前提被它推翻
> `--help` 列出 `app-server` 子命令；bundle 实证其协议方法含 `session/create`、`session/send`、`session/stop`、`session/setMode`、`session/setModel`、`session/fork`、`session/messages`、`session/usage`、`session/subscribe` 等，事件含 `permission.requested`/`userInput.requested`。由此：① 方案"0.16.5 无 transcript fork 入口"→ `IProvider.fork` 缺省、`supportsSessionForking:false` 的前提不完整——`--prompt` 路径确实无入口，但 app-server 有 `session/fork`（session 表亦有 `parent_id` 列，疑似派生会话支撑）；② codex 已有 app-server 接入先例，交互式协议可能同时解决模型选择（setModel）、运行时切模式（setMode）与权限应答（是否可应答未确认）。建议补一节"为何不采用 app-server 而选 `--prompt`"的论证；若维持现方案，请把 fork 相关表述改为"`--prompt` 无入口（app-server 有 session/fork，本方案未采用）"。

> [!WARNING] §4 defaultPermissionMode=yolo：Claude 批注的事实引用有误，但产品担忧成立，应显式定夺
> 纠正：`--help` 明文 `--mode ... (default: yolo for --prompt)`，headless 原生默认确实是 yolo（`build` 是 TUI 默认），"§已实测显示原生默认是保守的 build"这一引用不成立（实测表是四种模式对比，非默认值）。但安全关切本身有效：其余 7 个 provider 的 `defaultPermissionMode` 全部是 `default`，zcode 将是唯一"零审批"默认值；而若默认 `build`，新用户首个写/执行类任务必然全拒并触发 §3.4 熔断。这是真正的产品两难，建议牵头者显式论证；若维持 yolo，至少配合：composer 模式徽标显著警示 + `--disallowed-tools` 提供用户可配的高危工具排除（见下条）；若改保守默认，UI 需预先解释熔断行为。

> [!IMPORTANT] §3.4 漏了活 flag `--disallowed-tools`：实测被 0.16.5 接受，可作熔断之外的事前防线
> 实测：`--allowed-tools` 确为僵尸（`Unknown option`），但 `--disallowed-tools`（help 另列驼峰别名 `--disallowedTools`）被 parser 正常接受，与 `--prompt` 组合解析无误。方案只写了僵尸结论，易被推广成"这组 allow/deny flag 都别用"。建议：将 `--disallowed-tools` 记入可用 flag 清单，并评估在 yolo/default 下按用户偏好注入以排除高危工具——这是熔断（事后止损）之外唯一的事前工具级控制。

> [!IMPORTANT] token-usage 口径：Claude 批注的"矛盾"判断需修正，真正缺的是一个未验证前提
> 核实仓库：`provider-token-usage.service.ts` 的既有语义是「当前上下文占用」——claude/workbuddy/pi/codex 均只读最新一条 assistant usage（注释明言"Summing turns would count the same cached prefix once per turn"），前端 `TokenUsageSummary` 注释亦明示 context-window usage。故 §1"最后一条"恰好符合 endpoint 语义，不应按"累加"修改；§2.2 的累加是 fetchHistory 的历史展示口径（opencode 模板亦然），两者本就分工不同。但方案有个未验证前提：zcode `message.data.tokens` 是否与 opencode 一样是「每轮快照」（input=该轮全量 prompt）——若是「会话累计值」，两个落点的读法都要反过来。建议 §5 增加验证项：抽查真实 db 中 tokens 随轮次的变化规律，再冻结两个落点的口径。

> [!NOTE] §5 建议补三条验证：中断会话的 `--resume` 可用性、`--surface` 缺省影响、`--locale`
> ① 验证项 2 只验证了 SIGTERM 后 sqlite 落盘"可读"，未验证该中断会话随后 `--resume` 是否正常（半写状态可能拒绝续接或行为异常）；② CLI 由桌面 App 分发且 help 列出 `--surface terminal|desktop`，未测缺省 surface 对 stream-json 事件形状的影响；③ help 有 `--locale`，runtime 不固定 locale 时错误/事件文案可能随环境漂移，若有按文本匹配的逻辑（如错误分类）需注意。

> [!NOTE] §1 synchronizer 匹配 `db.sqlite-wal` 与 opencode 行为不一致，需评估事件量
> opencode 的 `synchronizeFile` 只匹配主库 `opencode.db`；方案让 zcode 同时匹配 `db.sqlite` 与 `db.sqlite-wal`。WAL 在模型流式期间高频提交，watcher 会在每次提交时触发 `synchronizeRows` 扫描（虽有 since 过滤）。建议实测事件频率后决定是否与 opencode 保持一致（仅主库）或加去抖。

> [!NOTE] §1 认证检测含 v2/credentials.json：bundle 实证该文件确被 CLI 读取，建议保留判定并补运行时验证
> bundle 中存在读取 `~/.zcode/v2/credentials.json` 的函数（Z.AI OAuth 凭据），计入 `authenticated` 有依据。Claude 提出的"仅有 v2 凭据、config.json 无 provider 时 `--prompt` 是否可用"仍应实测（本机 config.json 已有 provider，需临时移走文件构造场景），通过后再冻结判定逻辑。

### 牵头结论（v2 · 2026-09-13）

> 处置原则：争议项一律以本机实测为准（补充实测见正文「§第一轮审阅后补充实测」）。审阅者原文保持不动。已修订正文 v2。

**采纳（照批注修订）**
- **拒绝提示不得把 yolo 当首选建议**（Claude §3.4）：已重写文案，先解释失败原因与后果、首选 `acceptEdits`，yolo 仅作显式选项。见 §3.4。
- **认证不得把 v2/credentials.json 计入判真**（Claude §1）：实测仅 v2 凭据时 CLI 报 `Model config is missing`，故 `authenticated` 收紧为「`cli/config.json` 有带 apiKey 的 provider 且能解析出模型」。Pi 的「保留 v2 判定」**不采纳其判真用途**。见 §1/§已实测。
- **MCP 写入需乐观并发校验**（Claude §6）：新增 mtime/size 快照校验 + 有限重试，并把「残余竞态窗口」记为已知风险。见 §6。
- **prompt 只能走 argv 的限制须落文档/实现**（Claude §3.1）：实测无 stdin 通道（`--prompt -`/`-p` 均不可用），已加长度上限校验 + `ps` 可见性说明。见 §3.1。
- **图片措辞矛盾 + 待验证**（Claude §3.1）：实测图片 attach 可用，`supportsImages:true`，§3.1 与 §5 已一致化。
- **sessionId 提取时序**（Claude §3.2）：实测前 3 条事件无 sessionId、#4 才出现，已改为「扫描首个含 `sess_` sessionId 的事件」+ 兜底。
- **熔断「同一回合」定义**（Claude §3.4）：已写死为「每进程（每次 spawn，含 `--resume`）计数、重置」。
- **tool_use 拒绝后闭合**（Claude §2.1）：实测 deny 只发 `permission.resolved` + `tool.updated/batch{errorCount}`、**不发 `kind=error`**，已补映射。**并额外发现原方案漏了 `tool.updated/result`（成功输出主通道）**，一并补齐。
- **容错策略要具体**（Claude §5）：已明确「解析失败行/缺字段行/无 part 的 message/未知 part.type」的处理，并要求截断 fixture。
- **模型选择断链**（Pi §1/§3.1）：实测 `--model` 僵尸、无模型 env，采纳方案①——OPTIONS 收敛为 `model.main` 单模型 + UI 注明。见 §1/§附录-A。
- **app-server 未被评估**（Pi）：已补 §附录-A 论证「为何 v1 选 `--prompt`」，并更正 fork 表述为「`--prompt` 无入口（app-server 有 `session/fork`，未采用）」。架构不改。
- **token-usage 口径**（Pi）：采纳其修正——非矛盾；并已实测 tokens 为每轮快照，冻结两落点读法。见 §2.2/§5。
- **补验证项**（Pi §5）：中断后 `--resume`、`--surface` 缺省、`--locale` 已加入 §5（第 2/9/10 项）。
- **synchronizer 只看主库**（Pi §1）：采纳与 opencode 一致——只匹配 `db.sqlite`，WAL 待实测再定。见 §1。
- **`--disallowed-tools` 是活 flag**（Pi §3.4）：采纳记入可用 flag，并**实测澄清其边界**——按工具名拦截、模型可换工具绕过（deny `Write` 后改用 `Bash`），故只作 best-effort 事前防线、**非安全边界**。见 §3.1/§3.4。
- **`session.directory` 需验证**（Claude §2.2）：已抽样（8 条均绝对路径）并把 realpath 归一写入实现；仍保留 §5 抽样项。

**部分采纳**
- **defaultPermissionMode**（Claude §4 主张 acceptEdits；Pi §4 主张显式定夺）：**采纳 Claude 的结论方向，但驳回其事实依据**。实测 `--help` 明文 `default: yolo for --prompt`，故「原生默认是 build」不成立（Pi 的纠正正确）；但「原生默认」不应作为产品默认依据。**v2 定为 `acceptEdits`(edit)**：文件编辑可用、命令执行默认被挡，不再是「零审批」默认；并配 composer 警示徽标 + `--disallowed-tools` 可选注入。代价（Bash 任务被拒并熔断）已在 §4 写明。
- **app-server**（Pi §2）：采纳其事实与表述更正、补论证章节；**不采纳「本方案改用 app-server」**，作为阶段 6 后续项。
- **`--disallowed-tools` 作防线**（Pi §4）：采纳记入清单，但降级为「best-effort、可绕过」，不视为与熔断等价的控制。

**不采纳**
- **把 v2/credentials.json 保留为 authenticated 判据之一**（Pi §8）：实测 CLI 缺 `cli/config.json` 时即使有 v2 凭据也直接失败，判真会产假阳性。bundle 读取该文件属实，但不足以支撑 CLI 可用性判定。
- **按「累加」修改 §1 token-usage**（Claude §6）：与既有 endpoint 语义相悖（Pi 的核实成立），且实测 tokens 为每轮快照，取最新即当前上下文占用。

**修订说明（本次对正文的改动）**
1. 头部改为 v2 状态；新增「第一轮审阅后补充实测」小节（图片/`--disallowed-tools`/无 stdin/首 sessionId/tool.updated 全集/tokens 快照/directory/app-server/env）。
2. §1 表：auth 判据收紧、models 收敛单模型、runtime 加 `--disallowed-tools` 与 sessionId 提取、synchronizer 只看主库、mcp 加并发校验、fork 表述更正、token-usage 行加口径说明。
3. §2.1 补 `tool.updated/result`、修 `batch`/`permission.resolved` 的闭合语义，新增 sessionId 提取与 tool 终态两段；§2.2 澄清 usage 非矛盾。
4. §3.1 重写附件与 argv 段；§3.2 改 sessionId；§3.4 重写文案与计数定义。
5. §4：`defaultPermissionMode` 改 `acceptEdits`、`supportsImages` 定 true、加决策理由与 UI 要求。
6. §5：删已解决的图片项、扩为 12 项、决策点改为已定夺；§6 加乐观并发校验与定夺；§7 测试项同步；§8 阶段 3 范围与阶段 6 后续项。
7. 前端触点补「单模型提示」「yolo 警示徽标」；新增 §附录-A（模型选择 + app-server 论证）。

> 说明：上述「补充实测」均为本机 `/Applications/ZCode.app/.../zcode.cjs`（v0.16.5）实际运行结果，测试用临时目录已清理，未改动任何源码或用户 zcode 配置。

### Claude · v2 回应（2026-09-13）

> [!NOTE] 先确认两处被修正的事实，我接受修正
> ① **token-usage 口径**：核实 `provider-token-usage.service.ts` 后确认 Pi 正确——`summarizeClaudeTokenUsage` 注释明言「Summing turns would count the same cached prefix once per turn」，pi/workbuddy 分支同样取最新一条，既有语义就是「当前上下文占用」，我 v1 把两处不同用途的口径判为「矛盾」不成立。v2 的处置（§1 取最后一条并注明口径、§2.2 保留累加）正确。
> ② **defaultPermissionMode 事实引用**：`--help` 明文 `default: yolo for --prompt`，我 v1 的「原生默认是 build」引用错误（实测表是四模式对比、非默认值）。我坚持的结论方向（产品默认不应是最宽松模式）被保留，v2 定为 `acceptEdits`，认可。

> [!NOTE] v2 对我其余 v1 批注的处置，逐条确认
> §3.4 文案重写（yolo 不作首选）、认证收紧（v2 凭据不判真）、§6 乐观并发校验、prompt argv 长度与 ps 可见性、图片措辞一致化、sessionId 提取、熔断计数语义、容错策略具体化、tool_use 闭合、synchronizer 只看主库、`session.directory` realpath 归一 —— 均已按批注或按 Pi 建议落地，无异议。牵头对 Pi §8 的「不采纳」裁决合理：CLI 实测（`Model config is missing`）优先于 bundle 静态证据。

> [!WARNING] 新增关切：默认 `acceptEdits` 下，熔断将成为「默认任务的常见结局」而非罕见路径
> v2 默认 `acceptEdits`(edit)，Bash 在默认模式下必然被拒，而实测 build 的重试循环在 edit 下同样存在（§5 验证项 5 待校准）。含义：**默认模式下，只要任务含 ≥3 次命令执行就会被强制终止（exitCode:1）**——这是合理取舍，但前端必须把「拒绝过多、被熔断终止」与「正常失败」区分呈现（专用错误码/文案），否则用户会误判为 zcode 崩溃。建议 §3.4 给熔断终止一个专用错误码，阶段 4 UI 走查验证。

> [!IMPORTANT] 新增缺口：`--disallowed-tools` 的「用户偏好」没有前端入口
> §3.1/§4 写「按用户偏好可选注入 `--disallowed-tools`」，但 §1 文件清单与前端触点没有任何对应配置 UI。要么补一个入口（settings → zcode），要么把措辞改成「预留能力，首个版本不暴露 UI」——否则阶段 4 会漏掉一个已被写进能力描述的开关。

> [!NOTE] 新增验证建议：`ZCODE_SESSION_ID` 的方向语义待澄清
> §3.2 把它列为 sessionId 提取兜底之一。需确认它是 spawn 时的**输入**控制变量（指定会话）还是**输出**回显；若是输入，runtime 自己知道设了什么，兜底应优先回读 sqlite 而非依赖它；且并发时「回读 sqlite 最新会话」可能命中他人会话，需防串。

> [!NOTE] 实现细节：§2.1 的 tool_use 双闭合需幂等
> 现在 `permission.resolved` 与 `tool.updated/batch{errorCount>0}` 都会闭合被拒 tool_use 卡片，若两者都到达会触发二次闭合。要求按 `toolCallId` 幂等（首次闭合后忽略同 id 后续闭合事件），并在 `zcode-runtime.test` 补一条 mock 测试。

### Pi · `01a09985-beaa-72d3-abbc-92923ab63c88`（v2 回应）

> [!NOTE] 对牵头处置的核实：我 v1 的 8 条均被合理处置，无进一步异议
> 6 条采纳/部分采纳的修订我逐项核对了正文与「补充实测」，与我的证据一致；1 条不采纳（v2/credentials.json 判真）我**接受**：`Model config is missing` 的运行时证据强于我引用的 bundle 静态证据（bundle 有读取函数 ≠ 凭据足以驱动 headless），且该实测正是我批注要求的"先验证再冻结"流程的产出；`tokens` 快照实测（15530/15689 而非 31199）直接消解了口径前提问题。附录-A 把 app-server 定为"有意识的取舍"并列入阶段 6，论证成立；提醒一句：阶段 6 优先评估权限应答通道——它若可用，§3.4 整套熔断补丁可降级为兜底。

> [!IMPORTANT] §3.2 兜底链里的 `ZCODE_SESSION_ID` 是不可达路径，应删除（实测澄清 Claude 的质疑，支持其方向）
> bundle 中 7 处 `ZCODE_SESSION_ID` 引用全部是 zcode 向 plugin/hook/custom-command 子进程**注入**的模板变量（与 `CLAUDE_SESSION_ID` 同组、仅在已有 sessionId 时设置，供 `${ZCODE_SESSION_ID}` 展开），**不是 CLI 读取的输入变量**，也不会回显到 stream-json 事件流。runtime 的 env 里不会有它，兜底永远落空。建议兜底链改为：扫描事件（主路径，实测 #4 即命中）→ 回读 sqlite。且回读需按 Claude 的并发担忧加防串条件：`directory = --cwd 的 realpath` + `time_created ≥ 本进程 spawn 时刻` + 排除已绑定 provider_session_id 的会话，否则同目录并发多会话会互相命中。

> [!IMPORTANT] §2.1 batch 闭合的实现细节：payload 带 `toolCallIds` 列表，v2 只写了 errorCount；且两路闭合必然重叠，幂等要从"要求"变成"设计"
> 实测 batch payload schema 为 `{toolCallIds: string[], successCount, errorCount}`——**携带具体 toolCallId 列表**，应按列表逐个闭合而非只看 errorCount。另注意 batch 的 errorCount 不区分"权限拒绝"与"执行失败"（后者已由 kind=error 闭合），`permission.resolved` 与 `batch` 两路闭合对同一卡片必然重叠。支持 Claude 的幂等要求，具体化为设计：runtime 维护 `closedToolCallIds: Set<toolCallId>`，`permission.resolved` / `tool.updated(result|error)` / `batch` 三路闭合统一走一个 helper，已闭合的 id 忽略。§7 补"deny 后同时到达 permission.resolved 与 batch"的 mock 用例。

> [!NOTE] 支持 Claude 的两个新缺口，各补一句实现方向
> ① 熔断专用错误码（Claude WARNING）：建议 complete 消息的 error 带稳定标识（如 `ZCODE_PERMISSION_CIRCUIT_OPEN`）而非仅 `exitCode:1`，前端据此渲染"因多次工具拒绝终止，可切换权限模式重试"的专用文案，§7 补断言；② `--disallowed-tools` 前端入口（Claude IMPORTANT）：建议 v2 措辞改为"预留能力、首版不暴露 UI"（零成本，不产生幽灵配置项），入口与 yolo 警示徽标留到后续迭代——否则 §1 前端触点要新增 settings 入口 + `zcodeDisallowedTools` 偏好键，清单会变。

> [!NOTE] 小笔误与一个参考值：§5 第 12 项
> "用于设定**云端** prompt 长度校验值"疑为"runtime"笔误。另可给实现一个基线参考：macOS 单个 argv 参数上限约 256KB、argv+env 总量上限约 1MB（ARG_MAX），校验值应显著低于两者，并为多个 `--attach` 路径预留余量。

### 牵头结论（v3 · 2026-09-13）

> 第二轮（v2 回应）两位审阅者均确认 v1 批注已被合理处置、无进一步异议，并各自提出新增项。以下逐条处置；审阅者原文保持不动。

**采纳（已修订正文 v3）**
- **熔断终止需专用错误标识**（Claude WARNING + Pi 附议）：§3.4 定为 complete 消息带 **`ZCODE_PERMISSION_CIRCUIT_OPEN`**，前端据此与「正常失败」区分呈现；§4 配套 UI、§7 补断言。理由：默认 `acceptEdits` 下含命令执行的任务会常态化触发熔断，若与崩溃混同会严重误导。
- **`--disallowed-tools` 首版不暴露 UI**（Claude IMPORTANT + Pi 建议）：采纳 Pi 的零成本方案——§3.1/§3.4/§4 措辞改为「**预留能力，首版不注入、不暴露 UI**」，避免产生无来源的幽灵配置项，也避免 §1 前端触点清单膨胀；参数位保留。
- **删除 `ZCODE_SESSION_ID` 兜底**（Pi IMPORTANT，实测支持）：我复核 bundle 内 7 处引用**全部是向 plugin/hook/custom-command 子进程注入的 `${ZCODE_SESSION_ID}` 模板变量**（与 `CLAUDE_SESSION_ID` 同组），CLI 从不读取它 → runtime env 里不存在，兜底永不可达。§3.2 兜底链改为「扫描事件 → 回读 sqlite」，并按 Claude 的并发担忧加**防串条件**（`directory`=--cwd realpath + `time_created ≥ spawn 时刻` + 排除已绑定 `provider_session_id` 的会话）。
- **tool_use 闭合改为幂等设计**（Claude + Pi）：采纳 Pi 的具体化——`batch` 按 payload 的 `toolCallIds[]` **逐个**闭合；因 `errorCount` 不区分拒绝/失败、且 `permission.resolved` 与 `batch` 必然重叠，runtime 维护 `closedToolCallIds: Set`，三路闭合统一 helper，已闭合即忽略。见 §2.1/§7。
- **§5 笔误与 argv 基线**（Pi）：`云端`→`runtime` 已改；补入 macOS 单参数 ~256KB / ARG_MAX ~1MB 的基线参考，校验值需显著低于并预留 `--attach` 余量。

**无需动作（确认性意见）**
- Claude v2 的前两条 NOTE（接受 token-usage 与 defaultMode 的事实修正、逐条确认 v2 处置）与 Pi v2 首条 NOTE（确认 8 条处置、接受 v2 凭据不判真）均为确认，无正文改动。
- Pi 提醒「阶段 6 优先评估权限应答通道」：已并入 §附录-A 与 §8 阶段 6 的表述方向（若 app-server 权限应答可用，§3.4 熔断降级为兜底）——不改本版设计。

**修订说明（v3 对正文的改动）**
1. §已实测：更正 `ZCODE_SESSION_ID` 为「注入型模板变量、非输入」；sessionId 条目删除该兜底提示。
2. §2.1：`batch` 行改为按 `toolCallIds[]` 逐个闭合；新增/改写 sessionId 兜底链与幂等闭合两段。
3. §3.1/§3.4/§4：`--disallowed-tools` 改为「首版不注入、不暴露 UI、保留参数位」；熔断新增专用错误标识；配套 UI 增加熔断区分。
4. §5：修正第 12 项笔误并补 argv 基线。
5. §7：补「首事件无 sessionId 负例」「两路闭合幂等」「熔断计数在 `--resume` 重置」「熔断专用错误标识」「首版不注入 `--disallowed-tools`」断言。

> 说明：v3 仅新增一处实测（`ZCODE_SESSION_ID` 的 7 处引用方向），其余为对 v2 回应的处置；未改动任何源码或用户 zcode 配置。
