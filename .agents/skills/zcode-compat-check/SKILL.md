---
name: zcode-compat-check
description: 检查 ZCode CLI 升级后，CloudCLI 是否仍能读取其 SQLite 会话历史与流式事件语义。用于 ZCode 历史消息缺失、工具卡片异常、会话索引失败或格式兼容性复核；不用于 Claude、Codex、Pi、WorkBuddy 或 DSH。
---

# ZCode 会话格式兼容性检查

CloudCLI 只读 ZCode CLI 写入的 `~/.zcode/cli/db/db.sqlite`，绝不修改它。ZCode 使用基于
OpenCode 的 SQLite 存储：会话在 `session`，消息在 `message.data` JSON，消息组成部分在
`part.data` JSON。CLI 升级改变表、JSON role 或 part 类型时，CloudCLI 可能让历史消息或工具调用静默消失。

## Invariants

- 数据库、WAL 与 ZCode 配置只读；不可修复、迁移或写入用户的 `~/.zcode`。
- 实际路径优先读取 `~/.zcode/cli/config.json` 的 `storage.sessionDbPath`，否则是默认
  `~/.zcode/cli/db/db.sqlite`，与 `getZcodeDatabasePath()` 一致。
- 检查目标是 `zcode-sessions.provider.ts`（历史 / stream-json 映射）、
  `zcode-session-synchronizer.provider.ts`（索引）、`zcode-runtime.provider.ts`（实时事件）及
  `zcode-models.provider.ts`（路径解析）。
- 以本机真实 SQLite 数据为准；不为尚未出现的版本猜测格式。

## 格式基线（接入时 ZCode 0.16.5）

`session` 读取 `id`、`directory`、`title`、`time_created`、`time_updated`、`time_archived`；
未归档会话被索引。`message` 读取 `id`、`session_id`、`time_created`、`data`、`sequence`，
其中 `data.role` 为 `user` 或 `assistant`。`part` 读取对应 ID、时间、`data`、`sequence`。

| `part.data.type` | CloudCLI 处理 |
|---|---|
| `text` | `text`/`content` 渲染为 user 或 assistant 文本；user 的附件标签转为附件 |
| `reasoning` | 渲染为 thinking |
| `tool` | `tool`、`callID`、`state.input`；`completed`/`error` 时挂接 output/error |
| `step-finish` | 回合结束标记 |
| `patch` / `agent` | 对应工具卡片 |
| `step-start` / `file` / `timeline` | 已评估为元数据，当前不单独渲染 |

`tool.state.status` 已知为 `pending`、`running`、`completed`、`error`。assistant 的
`message.data.error` 单独渲染为错误。实时 `stream-json` 由 `normalizeMessage()` 处理
`model.streaming`、`tool.updated`、`permission.resolved`、`turn.completed`；
`~/.zcode/cli/rollout/model-io-*.jsonl` 只是诊断记录，CloudCLI 不读取，不是历史格式基线。

## Workflow

```bash
node .claude/skills/zcode-compat-check/check-zcode-format.mjs
node .claude/skills/zcode-compat-check/check-zcode-format.mjs --all
node .claude/skills/zcode-compat-check/check-zcode-format.mjs /path/to/db.sqlite
```

报告 `🆕` 或 `⚠️` 时：

1. 新 role / part type：确认真实字段，在 `normalizeHistoryRows()` 补最小映射；若来自实时管道，在 runtime / `normalizeMessage()` 补分支。
2. 缺表或关键字段：复核 SQL 查询、路径解析与同步器。新增未读取的列本身无碍。
3. 坏 JSON 或孤立 part：可能正写入 WAL，先复跑；持续存在再按新语义加容错。
4. 在 `fixtures/zcode-session-db.ts` 构造新格式，补 `zcode-sessions.test.ts` / `zcode-session-synchronizer.test.ts`，再运行相关测试和 typecheck。
5. 确认后同步更新本基线及脚本 `KNOWN_*` 常量；保留旧格式分支。
