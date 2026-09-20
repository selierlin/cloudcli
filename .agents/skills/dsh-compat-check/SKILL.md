---
name: dsh-compat-check
description: 检查 DeepSeek Harness（DSH）升级后，CloudCLI 是否仍能正确读取其 Zstandard JSONL 会话记录；用于 DSH 历史消息缺失、注入上下文误显示或格式兼容性复核。
---

# DeepSeek Harness transcript 格式兼容性检查

CloudCLI 只读 DeepSeek Harness（DSH）写入的会话日志。Harness 升级后，事件、内容块、压缩方式或用户消息来源字段发生变化时，CloudCLI 可能静默遗漏消息，或把工作区指令等注入内容显示成用户输入。

## 范围与不变量

- 数据源为 `DSH_SESSIONS_ROOT`；未设置时为 `${DSH_HOME:-~/.dsh}/sessions`。npm 版 `dsh --profile acp` 把会话写在 `~/.dsh/sessions`（旧的 dsh-desktop 桌面版 harness 目录已被取代），CloudCLI 的 `getDshHome()` 默认 `~/.dsh`，与此一致。只读，绝不修改日志。
- 会话日志按 Session 格式世代命名，CloudCLI 读取 `<root>/--<project-key>--/<encoded-session-id>/session[.vN].jsonl[.zstd]` 中**世代号最大**的那份（`session.jsonl.zstd` 为 v0，`session.v3.jsonl.zstd` 为 v3）。世代号与物理编码后缀都是文件名的一部分，发现逻辑必须按模式匹配；写死单个文件名会让升级后的会话静默读成空历史。编码后缀由 root 配置（默认 `zstd`，`compression: none` 时为纯文本 `.jsonl`），一个 root 只写一种编码。
- Zstandard 根（默认）的日志由多个独立 Zstandard 帧顺序拼接；每帧解压后合为逻辑 JSONL。部分写入或损坏的末帧只应丢弃该帧，保留此前可读内容——Node 的 `zstdDecompressSync` 对截断帧静默返回空串而非抛错，所以「丢掉整帧」就是当前行为。纯文本根按 UTF-8 逐行读取。
- 检查目标：
  - `server/modules/providers/list/dsh/dsh-sessions.provider.ts`：`isDshSessionLogFile()`、`findDshSessionLogPath()`、`decodeZstdFrames()`、`decodeSessionLogBuffer()`、`decodeSessionLog()`、`extractText()`。
  - `server/modules/providers/list/dsh/dsh-session-synchronizer.provider.ts`：会话发现、会话名和 project key 映射。
  - `server/modules/providers/list/dsh/dsh-models.provider.ts`：会话根目录覆盖。
  - `server/modules/providers/services/sessions-watcher.service.ts`：watcher 目标文件过滤。

## 当前基线

已确认的 header 版本为 `0`（旧，物理文件 `session.jsonl.zstd`）与 `3`（当前，物理文件 `session.v3.jsonl.zstd`）；两者的事件结构一致，同一套解码逻辑可读。未压缩根（`compression: none`）把同样的事件写成纯文本 `session[.vN].jsonl`，CloudCLI 已按后缀分派（`.zstd` 走帧解压，其余按 UTF-8 文本）读取。DSH 用一次迁移把会话重命名到新世代，因此升级后同一项目下的**全部**历史会一起失效。

上游还支持一个 `cwd === undefined` 的兜底目录 `_no-cwd`（裸名，不带 `--` 包裹）。CloudCLI 不会用到它：runtime 的 `newSession(cwd)` 永远收到非空 cwd（最终兜底到 `process.cwd()`），且这类会话没有可归属的 project_path，所以同步器与历史读取都无需适配。

CloudCLI 历史渲染的唯一事件是：

| 事件 | 读取字段 | 输出 |
| --- | --- | --- |
| `user/message` | `data.content` 中的 `{ type: "text", text }` | 用户文本 |
| `assistant/message` | `data.message.content` 中的 `{ type: "text", text }` | 助手文本 |

`user/message` 的 `data.source.kind === "user"` 才是真实用户输入。`plugin`、`agent-instructions`、`skill-catalog` 等非 user 来源是 Harness 注入上下文，CloudCLI 会跳过。`source.kind` 缺失仍会被当前代码当作用户消息渲染，是最高优先级的兼容性信号。

已知但不渲染的内容块为 `reasoning`、`tool-call`、`image`；当前历史读取只展示 `text`。日志中常见的生命周期、工具、压缩行和标题事件也仅作元数据处理。已在真实日志中确认的无害元数据事件：`session/end-seed`（种子阶段结束，`data: {}`）、`session/title-llm-request`（内部标题生成请求）、`model/selection`（模型选择）、`system/message`（`role: system` 的系统提示词，非用户输入）、`assistant/attempt`（LLM 尝试记录：`data.stream[].chunk` 为流式 chunk 或失败 finish 原因，不携带助手正文，故调用失败且无 `assistant/message` 的会话在历史里只有用户提问）。出现未分类事件或 block 时，不要猜测格式，以真实样本确认其是否携带需要展示的历史内容。

## 工作流

在仓库根目录运行：

```bash
node .agents/skills/dsh-compat-check/check-dsh-format.mjs
node .agents/skills/dsh-compat-check/check-dsh-format.mjs --all
node .agents/skills/dsh-compat-check/check-dsh-format.mjs /absolute/path/to/session[.vN].jsonl[.zstd]
```

- 默认检查最新日志；`--all` 检查最近 5 个。
- 报告 `🆕`：真实的新顶层事件或 content block，需确认是否应进入历史渲染。
- 报告 `⚠️ source.kind 缺失`：当前会把该 user/message 显示出来；先确认它不是新型注入上下文。
- 报告 `ℹ️ 未压缩根（compression: none）`：该 root 写纯文本行而非 Zstandard 帧，CloudCLI 已按后缀支持；这类日志的帧数为 0 属正常，不是损坏。
- 报告 `⚠️ session header version`：当前解码不验证版本，需比较 Harness 的兼容承诺并决定是否加拒绝或适配。
- 空目录或无日志不代表兼容；请先运行一次 DSH，或传入指定日志。

## 适配与验证

1. 新的真实用户/助手事件或文本字段：修改 `decodeSessionLog()`，保留现有分支以兼容旧日志。
2. 新注入来源：收紧用户来源判断，并同步 `DshSessionSynchronizer.extractSessionName()`，避免污染历史和会话名。
3. 新的压缩或文件名：同时修改 `findDshSessionLogPath()`/`resolveSessionLogPath()`、同步器的扫描与删除路径、以及 watcher 规则；不能只改历史读取。
4. 新 block：仅当用户确实需要在历史中看到它时扩展 `extractText()` 或归一化模型；不要把 tool/reasoning 元数据误当正文。
5. 在 `server/modules/providers/tests/dsh-sessions.test.ts` 增加使用新格式的 fixture，运行：

```bash
npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/dsh-sessions.test.ts
npm run typecheck
```

更新本技能和检查器中的已知类型。证据只认两类：已在真实日志中确认的格式，以及上游随产品发布的格式定义——全局安装的 `@deepseek-ai/dsh-session-format` / `dsh-session-persistence-jsonl` 子包 `lib/index.js` 与 `README.zh.md` 是文件名、编码与路径编码的真源，比单个日志样本更完整且无需联网。
