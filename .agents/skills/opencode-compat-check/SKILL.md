---
name: opencode-compat-check
description: 检查 OpenCode CLI 升级后，CloudCLI 是否仍能读取其 SQLite 会话历史，并正确解析 `opencode run --format json` 的实时事件信封。用真实 opencode.db 与本机二进制提取的类型契约做两路对照，识别会静默丢正文、工具入参变空或会话索引失败的新结构。用于 OpenCode 升级、历史消息缺失/空白、生成过程不出字而结束时整段蹦出、模型选择器为空或兼容性复核；不用于新增 AI Provider（见 providers/README.md）或 Claude、CodeX、Pi、WorkBuddy、DSH、ZCode 的格式问题。
---

# OpenCode 会话格式兼容性检查

CloudCLI 只**读取** OpenCode 的两处输出，从不写入：历史来自共享 SQLite 库
`~/.local/share/opencode/opencode.db`，实时来自 `opencode run --format json` 的 stdout。
OpenCode 升级可能改变这两处的结构 —— 项目解析器不认识新结构时，**助手正文会整条消失、
工具入参变成 `{}`、会话不再出现在侧栏**，而且全都不报错。本 skill 在 OpenCode 升级后跑一次，
把这类"升级适配点"揪出来。

## Invariants

- 数据源只读：`opencode.db`（及其 WAL）、`~/.config/opencode/`、`~/.local/share/opencode/auth.json`
  一律不改；`opencode run` 只在检查器之外由人手动触发，本 skill 不代跑模型。
- 检查目标是项目读取逻辑：
  - `server/modules/providers/list/opencode/opencode-sessions.provider.ts` → `normalizeMessage()`（实时）/ `normalizeHistoryRows()`（历史）/ `extractText()` / `isUserTextEcho()` / `aggregateOpenCodeSessionTokenUsage()`
  - `server/modules/providers/list/opencode/opencode-session-synchronizer.provider.ts`（索引 / 会话名 / 子会话 prune）
  - `server/modules/providers/list/opencode/opencode-runtime.provider.js`（信封词汇表 / `--format json` 调用 / 权限模式）
  - `server/modules/providers/list/opencode/opencode-models.provider.ts`（模型目录 / `session.model` 解析）
  - `server/shared/utils.ts` → `getOpenCodeDatabasePath()` / `unwrapJsonStringLiteral()`
- 每个 part 类型 / 信封 type / 被查询的列要么被项目读取，要么已确认无影响；未分类的就是升级信号。
- 不要为"兼容未来"猜测格式 —— 以真实 DB 和本机二进制提取的契约为准。
- 检查器必须在仓库内运行（`better-sqlite3` 从仓库根 `node_modules` 解析）。

## 与其他 harness 的关键差异

- **Claude / WorkBuddy / Pi / DSH**：历史是 JSONL（或 zstd 帧），一次读文件即可。
- **ZCode**：同为 SQLite，但只读 `message.data` / `part.data` 两处 JSON。
- **OpenCode**：**两套并行格式**，历史在 SQLite（`session` / `message` / `part` / `project` 四张表），
  实时是进程 stdout 的 JSONL 信封。于是有三个独有风险点：
  1. **信封双层包裹 + 命名错位**（最致命）：信封是 `{type, timestamp, sessionID, part}`，正文在
     `part` 里；且**信封 `type` 用 snake_case（`step_finish`），part 内 `type` 用 kebab-case（`step-finish`）**。
     曾发生过的真实事故就是只读扁平字段：`text` 信封被整个丢弃（正文不显示）、
     `tool_use` 的入参变成 `{}`，而历史回读正常 —— 症状是"生成时不出字，结束时整段蹦出"。
  2. **`--format json` 是块级不是 token 级**：CLI 只在 `part.time.end` 填好后发一次 `text`，
     所以"整段蹦出"在这个通道上是**结构使然，不是 bug**。真增量在 `opencode serve` 的
     `message.part.delta` 事件里（CloudCLI 不走那条路）。
  3. **表/列漂移**：SQL 是写死列的，改名会让索引、历史、token 汇总三条链路分别失效。

## 格式基线（截至 1.18.31）

**存储与读取面**

| 面 | 位置 | CloudCLI 用途 |
|---|---|---|
| 历史 | `~/.local/share/opencode/opencode.db`（`getOpenCodeDatabasePath()` **硬编码，无 env 覆盖**） | `session` / `message` / `part` 三表读历史与索引，`project` 取 `worktree` 兜底 project_path |
| 配置 | `~/.config/opencode/` 下 `config.json` / `opencode.json` / `opencode.jsonc` | 模型目录：`provider.<id>.name` 与 `provider.<id>.models.<id>` |
| 凭据 | `~/.local/share/opencode/auth.json`，回退 env `OPENCODE_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | 判定 provider 是否"已连接" |
| skills | `~/.config/opencode/skills` → `~/.claude/skills` → `~/.agents/skills` | 技能来源（后两者与 agents 真源同指） |

库里有 20+ 张表（`event`、`session_message`、`todo`、`credential`、`account`…），
CloudCLI **只读上述 4 张**。`event` 表虽不读，但它的 `type` 带修订号后缀
（`message.part.updated.1`、`session.next.step.failed.2`）—— 是契约漂移的早期信号。

**信封契约（实时）**：`opencode run --format json` 每行一个信封
`{ type, timestamp, sessionID, part }`；**只有 `error` 不带 `part`**（顶层 `error` 字段）。

| 信封 `type` | 发出条件 | `part.type` | 正文位置 |
|---|---|---|---|
| `text` | `part.time.end` 已填（整块完成） | `text` | `part.text` |
| `reasoning` | `part.time.end` 已填 **且** CLI 带 `--thinking` | `reasoning` | `part.text` |
| `tool_use` | `part.state.status` 为 `completed` / `error`（仅终态发一次） | `tool` | `part.tool` / `part.callID` / `part.state.input` / `part.state.output` |
| `step_start` | 立即 | `step-start` | 无正文（项目不渲染） |
| `step_finish` | 立即 | `step-finish` | `part.tokens` / `part.cost` / `part.reason` |
| `error` | 收到 `session.error` | —（信封顶层） | 信封 `error` |

`isUserTextEcho` 会跳过 `role === 'user'` 的回显（`raw.role` / `raw.message.role` / **`raw.part.role`**
三处都看 —— 作者知道 `part` 存在，是读正文时漏了 `part.text`）。

**part 类型全集（历史，`part.data.type`）** —— 10 个，来自二进制 `switch(D.type)`：

| `part.data.type` | CloudCLI 处理 |
|---|---|
| `text` | 渲染 user/assistant 文本；user 侧用 `<images_input>` / `<files_input>` 标签还原附件 |
| `reasoning` | 渲染为 thinking |
| `tool` | 渲染为 tool_use + 结果（`state.status` 为 `completed`/`error` 时挂 output/error） |
| `step-finish` | 渲染为 stream_end |
| `patch` | 渲染为 Patch 工具卡片 |
| `agent` | 渲染为 Agent 工具卡片 |
| `step-start` / `snapshot` / `file` / `subtask` | 已知但当前不渲染（生命周期 / 快照 / 文件 / 子任务元数据） |

**`message.data.role`**：`user` / `assistant`。`normalizeHistoryRows` 只把 `user` 之外全当 assistant；
`readFirstUserText` 用 `json_extract(m.data,'$.role')='user'` 取会话名兜底。

**`session` 行的语义**（易误判，逐条记好）：

- `version` 是**写入它的 CLI 版本**（如 `1.18.31`），**不是格式世代号** —— 跟着升级走属正常。
- `parent_id` 非空 = 子会话，同步器会 prune（`pruneChildSessions`）并跳过索引。
- `time_archived` 非空 = 归档，不索引。
- `directory` / `slug` / `title` / `project_id` 等为 NOT NULL；`upsertSession` 取不到
  `directory`（或 `project.worktree`）就**整条跳过**，不进侧栏。
- `model` 是 JSON（`{"id":"z-ai/glm-5.3-flash","providerID":"openrouter"}`）或裸字符串，
  要 compose 成 `<providerID>/<modelID>` 才能喂 `--model`。
- `tokens_input` / `tokens_output` / `tokens_reasoning` / `tokens_cache_read` / `tokens_cache_write`
  五列**可选**：缺了走逐条 `message.data.tokens` 汇总（已支持的降级，不是断裂）。

**编码细节**：首条 user prompt 被存成 JSON 字符串字面量（`"生成 500 字小说"`），靠
`unwrapJsonStringLiteral` 去引号；`part.data.type === 'text'` 且 `text` 首尾带引号就是它的适用面。
`jsonl_path` 在索引时**恒为 null** —— 全库共享一个 db 文件，写 path 会在删会话时毁掉所有人。

## 项目读取位置

- `opencode-sessions.provider.ts` → `normalizeMessage(raw, sessionId)`：先
  `const payload = readObjectRecord(raw.part) ?? raw`（信封解包，扁平帧是无副作用 no-op），
  再按**信封** `type` 分派：`text` → stream_delta、`reasoning` → thinking、
  `tool_use` → tool_use（读 `payload.state`）、`error` → error、`step_finish` → stream_end；
  `step_start` 及未知 type 返回 `[]`。`baseId` 取 `payload.id` / `payload.messageID`。
- `opencode-sessions.provider.ts` → `normalizeHistoryRows(rows, sessionId)`（历史主链路）：
  `message LEFT JOIN part` 按 `time_created, id` 排序；assistant message 的 `data.error` 先出一条
  error；再按 **`part.data.type`** 白名单 if 链渲染 `text` / `reasoning` / `tool` / `step-finish` /
  `patch|agent`，其余**静默跳过**。
- `opencode-sessions.provider.ts` → `aggregateOpenCodeSessionTokenUsage()`：优先 session 列，缺列则
  汇总 assistant `message.data.tokens`（含 `tokens.cache.read/write`）。
- `opencode-runtime.provider.js` → `spawnOpenCode()`：`opencode run --format json --dir <cwd>
  [--session <id>] [--model p/m] [--variant <effort>]`，逐行 JSON.parse stdout 交给
  `normalizeMessage`；非 JSON 行当 stream_delta 兜底；stderr 走 error 帧。权限模式映射：
  plan→`--agent plan`、bypassPermissions→`--auto`、acceptEdits→`OPENCODE_PERMISSION={"edit":"allow"}`。
- `opencode-session-synchronizer.provider.ts`：`session LEFT JOIN project`，过滤
  `time_archived IS NULL AND parent_id IS NULL`；`upsertSession` 取 `directory ?? worktree` 作
  project_path；会话名取 `session.title`，兜底 `readFirstUserText`（首条 user 的 text part）。
- `opencode-models.provider.ts`：`getSupportedModels` = 硬编码策展目录 ∩ 已连接 provider，
  再追加配置文件里声明的 `provider.<id>.models.*`；`getCurrentActiveModel` 读 `session.model`。

## Workflow

1. 确认本次针对 OpenCode（Claude / CodeX / Pi / WorkBuddy / DSH / ZCode 各有自己的 compat-check）。
2. 在仓库根目录运行检查脚本：

```bash
node .agents/skills/opencode-compat-check/check-opencode-format.mjs              # 最新会话
node .agents/skills/opencode-compat-check/check-opencode-format.mjs --all        # 最近 5 个
node .agents/skills/opencode-compat-check/check-opencode-format.mjs <sessionId>  # 指定会话
node .agents/skills/opencode-compat-check/check-opencode-format.mjs /path/to/opencode.db
node .agents/skills/opencode-compat-check/check-opencode-format.mjs --no-binary  # 跳过契约提取
```

退出码：`0` 全匹配，`1` 找不到库或用不了，`2` 有需评估的信号。
`OPENCODE_DB_PATH` 可覆盖库路径、`OPENCODE_BIN` 可指定二进制（仅检查器的口子，项目代码没有）。

3. 解读报告：
   - `[DB 结构]` ⚠️ → 必需列被改名/删除，对应 SQL 直接抛错；`ℹ️ 可选列` 只是 token 汇总降级。
   - `⚠️ session 缺 directory` → 这些会话不会出现在侧栏（同步器跳过）。
   - `[part.data.type]` 标 `需评估` → 新 part 类型，历史里会静默跳过（白名单 if 链）。
   - `⚠️ 取不到首条 user 文本` → 会话名只剩 `session.title`，`readFirstUserText` 的 SQL 前提变了。
   - `[message.data.role]` 标 `需评估` → 新 role 会被当 assistant 渲染。
   - `[二进制契约对照]` 的 🆕 → **即使本地库还没出现**也能发现的类型（1.18.31 的 union 有 10 个
     part 类型，真实库往往只出现 5 个，只靠数据面必漏）。这部分是离线提取，不联网。
   - `ℹ️ 未做契约提取` → `--no-binary`，或 PATH 里没有 `opencode`；此时以数据面为准并说明局限。
4. 若发现真实变化：按「适配指引」改代码，加单测验证。
5. 把新确认的类型更新进本 SKILL.md 的「格式基线」，并同步脚本的 `KNOWN_*` 常量。

## 适配指引（参考现有读取模式）

1. **新 part 类型**：判断它出现在历史还是仅实时。历史 → 在 `normalizeHistoryRows` 的白名单 if 链
   补分支（渲染型仿 `text`/`tool`，元数据型加进「已知不渲染」）；仅实时 → 在 `normalizeMessage`
   的信封分派里补分支。
2. **新信封 type / 正文换位置**：先确认正文落在 `part` 的哪个字段，再改
   `normalizeMessage`。**别退回读顶层** —— 信封恒为 `{type,timestamp,sessionID,part}`，
   把 `payload` 解包删掉就是历史事故的复现。
3. **新 role**：确认它是否该渲染；`normalizeHistoryRows` 目前把非 `user` 一律当 assistant，
   新增 role 若需要独立渲染要显式分支。
4. **表/列变化**：三条链路一起改 —— 历史 `fetchHistory` 的 JOIN、索引 `synchronizeRows` 的
   `WHERE`/投影、token 汇总的 `PRAGMA table_info` 探测与回退。
5. **二进制提取失效**（报告里 `ℹ️ 二进制里找不到契约 anchor`）：上游改了打包/压缩方式。
   此时应以 `opencode run --format json` 的**真实输出**为准（手动跑一次，抓 stdout 逐行看
   `part.type` 与信封 `type`），并把新契约登记进脚本常量。
6. 测试：`opencode-sessions.test.ts`（normalize 各信封 / 历史 part 渲染 / token 汇总）、
   `opencode-runtime.test.ts` 与 `opencode-runtime.provider.test.js`（信封→前端消息）、
   `opencode-models.test.ts`（目录与已连接 provider）。按惯例**验证新用例在未修复代码上会红**：

```bash
npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/opencode-sessions.test.ts
npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/list/opencode/opencode-runtime.provider.test.js
npm run typecheck
```

7. **保留既有分支** —— 扁平帧、旧 part 类型都是合法历史，移除会导致回归。

## 相关资产

- 代码基线：`opencode-sessions.provider.ts` 的 `normalizeMessage`（line 205+）/
  `normalizeHistoryRows`（line 376+）/ `aggregateOpenCodeSessionTokenUsage`（line 156+）；
  `opencode-session-synchronizer.provider.ts` 的 `synchronizeRows`（line 63+）/ `upsertSession`（line 136+）/
  `readFirstUserText`（line 183+）；`opencode-runtime.provider.js` 的 `spawnOpenCode`（line 126+）/
  `resolveOpenCodePermissionOptions`（line 37+）；`opencode-models.provider.ts` 的
  `readOpenCodeConfigState`（line 374+）/ `parseOpenCodeSessionModelValue`（line 464+）。
- 测试基线：`server/modules/providers/tests/opencode-sessions.test.ts`、
  `opencode-runtime.test.ts`、`opencode-models.test.ts`、
  `server/modules/providers/list/opencode/opencode-runtime.provider.test.js`。
- 契约提取原理：脚本读本机 `opencode` 二进制（Bun 单文件产物，源码内联）里的两处 anchor ——
  part 分派 `switch(D.type){case"step-start"...}` 与信封写入函数
  `{type:N,timestamp:Date.now(),sessionID:W,..._}`。提取失败会如实报告，不猜。
- 二进制落点：npm 全局装的是软链，如
  `~/.nvm/versions/node/<v>/bin/opencode` → `.../lib/node_modules/opencode-ai/bin/opencode.exe`。
