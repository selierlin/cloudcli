---
name: claude-compat-check
description: 检查 Claude Code 升级后，CloudCLI 的会话解析器是否仍与实际写入的 JSONL 格式一致。解析最新会话并与项目的 normalizeMessage 基线比对，识别会错误渲染或丢失的新结构。用于 Claude 升级、Claude 会话消息缺失/空白、出现未知原始文本气泡或兼容性复核；不用于新增 AI Provider（见 providers/README.md）或 CodeX、WorkBuddy 格式问题。
---

# Claude Code 会话格式兼容性检查

cloudcli 只**读取** Claude Code 写下的历史会话文件（`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`），
从不写入。Claude Code 升级可能改变 transcript 的 JSONL 结构 —— 项目解析器不认识新结构时，消息会
**渲染异常或静默消失**（例：normalizeMessage 不认识的 content block 类型会被整条丢弃）。
本 skill 在 Claude Code 升级后跑一次，把这类"升级适配点"揪出来。

## Invariants

- 数据源是 `~/.claude/projects/` 下的会话 JSONL（含同目录 `agent-<id>.jsonl` 子代理文件），**只读**，绝不修改。
- 检查目标是项目读取逻辑：
  - `server/modules/providers/list/claude/claude-sessions.provider.ts` → `getSessionMessages()` / `normalizeMessage()` / `fetchHistory()`
  - `server/modules/providers/list/claude/claude-session-synchronizer.provider.ts`（索引/会话名）
  - `server/modules/providers/services/session-conversations-search.service.ts` → `parseClaudeSessionMatches()`
  - 前端 `src/components/chat/hooks/useChatMessages.ts`（`normalizedToChatMessages` / `parseTaskNotification`）
- 每个顶层 type / content block 要么被项目渲染或读取，要么已确认无影响；未分类的就是升级信号。
- 不要为"兼容未来"猜测新格式 —— 以真实会话文件为准。

## 与 CodeX 的关键差异

- **CodeX**：历史解析器**逐事件重构**消息，新事件格式 → 用户消息静默丢失（0.150 的 `user_message`→`UserMessage` 教训）。
- **Claude**：`getSessionMessages` 按 `sessionId` 过滤行后原样返回，`normalizeMessage` 按
  `raw.type` / `message.role` / `content` block **映射**成消息。所以风险点是「新增顶层 type / 新增 content block
  类型 / 现有字段改名」—— 不认识的会被 normalize 丢弃或降级。

## 格式基线（截至 Claude Code 当前版本）

**存储**：`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`；`<encoded-cwd>` 社区观测为「非字母数字字符替换为
`-`」，但真实路径（含空格/波浪号）编码不完全匹配简单替换 —— 别自己推导，扫描目录找 `<session-id>.jsonl` 即可。
子代理 `agent-<id>.jsonl` 同目录。

**行结构**：JSONL 每行 `{ type, sessionId, message: { role, content }, timestamp, ... }`，字段在**顶层**。

**顶层 type 分类**：

| type | 项目处理 |
|---|---|
| `user` / `assistant` | 按 `message.role` 渲染（消息主体） |
| `thinking` / `tool_use` / `tool_result` | normalizeMessage 专有分支（`raw.type === 'thinking'` 等） |
| `ai-title` / `last-prompt` / `custom-title` | 同步器取会话名 |
| `summary` | 搜索服务取摘要（含 `leafUuid`/`parentUuid` 关联） |
| `content_block_delta` / `content_block_stop` | 实时流式事件（非历史） |
| `mode` / `permission-mode` / `system` / `attachment` / `file-history-snapshot` / `file-history-delta` / `queue-operation` / `atis-latch` / `agent-name` / `cost-state` / `started` / `result` | 无 `message.role`，normalize 返回空，不展示（已确认无影响）。`system` 带 `subtype: "compact_boundary"`（`content: "Conversation compacted"` + `compactMetadata`）是自动压缩摘要边界，resume 用，项目不读不展示 |

**content block 类型**（`message.content` 数组元素的 `type`）：`text` / `tool_use` / `tool_result` /
`thinking` / `image`（image 是 user 附件 base64，`part.source.type === 'base64'`）。

**会话名事件字段**：`ai-title.aiTitle` / `last-prompt.lastPrompt` / `custom-title.customTitle`（均需 `sessionId` 匹配）。

**isInternalContent 前缀**（`claude-sessions.provider.ts` `INTERNAL_CONTENT_PREFIXES`，命中则过滤不展示）：
`<system-reminder>`、`Caveat:`、`[Request interrupted`、`Base directory for this skill:`。

**前端特殊渲染前缀**（不属 isInternalContent，但前端 `parseTaskNotification` 识别渲染成任务卡片，搜索 `sessions.service.ts` 跳过）：
`<task-notification>`。

**本地命令标签**（`parseLocalCommandPayload` / `extractTaggedContent` remap 成正常消息）：
`<command-name>` / `<command-message>` / `<command-args>` / `<local-command-stdout>`。

**社区观测补充（非本地基线，勿当回归）**：社区逆向文档观测过 `type: "progress"`（tool 执行期间中间写入，
流式非历史）与 `type: "agent-setting"`（子代理/teammate 会话元数据，主会话文件不出现，脚本跳过 `agent-*.jsonl`
不受影响）——本地均未出现，未计入 KNOWN_*。若升级后它们出现在主会话文件里，脚本会标 🆕，按「适配指引」评估。
（参考：claude-session-port / ccrider 的 session-format 文档，均为"as observed, can change between releases"。）


## 项目读取位置

- `claude-sessions.provider.ts` → `normalizeMessage(raw, sessionId)`（核心，约 line 306-601）分支顺序：
  1. `content_block_delta` / `content_block_stop`（流式）
  2. `message.role === 'user'`：content 为数组时处理 `image`(base64)/`tool_result`/`text` block；
     content 为 string 时依次判定 `isCompactSummary` → `parseLocalCommandPayload` → `<local-command-stdout>` →
     `parseFilesInputTag` + `isInternalContent`；`raw.isMeta === true` 跳过
  3. `raw.type === 'thinking'`（`raw.message.content`）
  4. `raw.type === 'tool_use'`（`raw.toolName` / `raw.toolCallId`）
  5. `raw.type === 'tool_result'`
  6. `message.role === 'assistant'`：content 数组处理 `text`/`tool_use`/`thinking` block；string 直接输出
- `claude-sessions.provider.ts` → `fetchHistory()`：先建 `toolResultMap`（user 消息里 `part.type === 'tool_result'`
  按 `part.tool_use_id`），再 normalize，最后把 tool_result 结果挂到匹配的 `tool_use` 上（`msg.toolId`）。
- `claude-session-synchronizer.provider.ts`：`sessionId`/`cwd` 顶层取；会话名 ai-title/last-prompt/custom-title
  （从文件末尾往前扫）→ 无则取第一个 user 消息；跳过 `subagents/`、`tool-results/` 目录。
- `session-conversations-search.service.ts` → `extractClaudeSearchableMessage`：content string/array、
  `isCompactSummary`、本地命令、`<local-command-stdout>`、`isInternalContent`、跳过 `isApiErrorMessage`。
- 前端 `useChatMessages.ts`：`parseTaskNotification` 识别 `<task-notification>`；`useChatSessionState.ts` 有
  `isTaskNotification` / `isInteractivePrompt` 转换。

## Workflow

1. 确认本次针对 Claude Code（CodeX 用 `codex-compat-check`，其他 provider 不用本 skill）。
2. 运行检查脚本（在仓库根目录）：

```bash
node .claude/skills/claude-compat-check/check-claude-format.mjs          # 最新会话
node .claude/skills/claude-compat-check/check-claude-format.mjs --all    # 最近 5 个
node .claude/skills/claude-compat-check/check-claude-format.mjs <路径>    # 指定会话
```

3. 解读报告：
   - 顶层 type 标 `需评估` → 新 type，确认它有无 `message.role` / `content`。
   - content block 标 `需评估` → 新 block 类型（text/tool_use/tool_result/thinking/image 之外）。
   - `潜在未过滤注入内容` 🆕 → isInternalContent 前缀覆盖不到的 `<...>` 注入。
   - `已评估` / `已适配` → 已知无影响，忽略。
4. 若发现真实变化：按「适配指引」改 `normalizeMessage` / 前缀列表 / 前端渲染，加单测验证。
5. 把新确认的类型更新进本 SKILL.md 的「格式基线」，并同步脚本的 KNOWN_* 常量。

## 适配指引（参考 normalizeMessage 现有模式）

1. **新顶层 type 有 `message.role`**：在 `normalizeMessage` 的 role 分支里按 content 结构补 block 处理
   （照抄 `message.role === 'user'` / `'assistant'` 分支模式，注意 `image`/`tool_result`/`text`/`thinking` block 的字段）。
2. **新顶层 type 无 `message.role`**：大概率是元数据，在脚本 `KNOWN_NOT_READ_TYPES` 里记录，无需改 normalize。
3. **新 content block 类型**：确认字段（`part.text`? `part.thinking`?），在对应 role 分支加 `else if (part.type === '...')`，
   前端 `normalizedToChatMessages` 也补渲染。
4. **新注入前缀**：若命中前缀的内容不该展示，加进 `INTERNAL_CONTENT_PREFIXES`；
   若是前端要特殊渲染的（如 `<task-notification>`），在前端 `parseTaskNotification` 同类处处理。
5. 测试：在 `server/modules/providers/tests/claude-sessions.test.ts` 加用例（构造新格式 transcript，
   `fetchHistory` 断言 normalize 结果）；`npm run typecheck && npm test` 全绿后再收工。
6. **保留既有分支** —— 老会话文件仍是旧格式，移除旧分支会导致历史会话回归。

## 相关资产

- 真实样例：`~/.claude/projects/-Users-selier-Projects-open-projects-cloudcli/<session-id>.jsonl`（当前工作目录会话）。
- 代码基线：`claude-sessions.provider.ts` 的 `normalizeMessage`（line 306+）与 `INTERNAL_CONTENT_PREFIXES`（line 223）。
