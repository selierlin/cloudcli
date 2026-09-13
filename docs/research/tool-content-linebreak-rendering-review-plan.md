# CloudCLI 工具内容换行与折行渲染评审优化方案

> 状态：待评审（问题已定位到行，方案待定稿）
> 日期：2026-09-13
> 范围：仅前端聊天转录区（`src/modules/chat/tools/**`、`src/modules/chat/transcript/**`）中工具卡片的换行/折行；含一处服务端历史投影的 JSON 序列化。不修改 Provider 协议、不改 WebSocket 事件格式、不改 `TOOL_CONFIGS` 的注册表语义。
> 关联文档：`docs/architecture/06-tool-view.md`（工具渲染链路权威说明）、`docs/architecture/04-message-store-and-lazy-loading.md`
> 行号基准：`590b88f1`（2026-09-13 重新核对全部引用；此前基于 `353ab751` 的引用已失效并修正，见 §10）

## 目录

- [0. 结论先行](#0-结论先行)
- [1. 背景与已确认现状](#1-背景与已确认现状)
- [2. 目标、指标与非目标](#2-目标指标与非目标)
- [3. 候选路线与决策](#3-候选路线与决策)
- [4. 详细设计](#4-详细设计)
- [5. 文件级改动清单](#5-文件级改动清单)
- [6. 测试方案](#6-测试方案)
- [7. 实施顺序](#7-实施顺序)
- [8. 风险、监控与回滚](#8-风险监控与回滚)
- [9. 验收结论模板](#9-验收结论模板)
- [10. 引用复核记录](#10-引用复核记录)

## 0. 结论先行

用户反馈两个方向**相反**的诉求，必须分开处理，不能用一个全局 CSS 类一次解决：

- **内容侧**：「有的工具没有换行，观看效果很差」——正文应当**保留并显示换行**。
- **命令侧**（本轮新增的明确功能点）：「关于命令，我希望不要换行」——命令行本身应当**强制单行，不允许换行**。

排查后确认：**这不是一个 bug，而是六个换行保真缺陷（L1–L6）加一个单行化需求（L0），分布在三条不同的渲染路径上**，其中影响面最大的缺陷（报错正文被 Markdown 吞掉换行）覆盖**所有失败的非 Bash 工具**。

本方案的判断：

1. **先按「这一行该不该换行」把表面分成两类，再谈怎么换行。**
   - **命令（terminal 风格）**：`Bash`、`PowerShell` 的命令行 → **强制单行**，超宽时横向滚动，折叠/展开都不换行（`L0`）。
   - **正文（内容）**：报错、shell 输出、Plan、Subagent 结果、任务列表、diff、待办 → **保留换行**。
2. **正文内部再按「文本来源」分流，而不是统一加一个 CSS 类。**
   - **运行时文本**（工具报错、shell 输出、堆栈）不是 Markdown，按纯文本 `whitespace-pre-wrap` 渲染，保留原样换行，杜绝 `#`、`*`、`|`、`\` 被当语法解析。
   - **模型撰写文本**（Plan、Subagent prompt/result）本身是 Markdown，走 Markdown 渲染但**必须打开 `remark-breaks`**，让单个 `\n` 成为硬换行，与用户消息的处理保持一致（`MessageComponent.tsx:131-132`）。
3. **`TaskList` / `TaskGet` 的正则是信息丢失型缺陷**，不只是显示问题——它静默丢弃所有不匹配的行。这一条优先级高于「换行长什么样」。
4. **标题/摘要行的一行化（`truncate`）是刻意设计，不在本次修改范围**；本方案只处理「正文」和「命令行」。
5. 修完后需要能回答两句话：
   - *同一份 payload，在任何 Provider、任何展开状态下，行结构都不丢。*
   - *任何命令，在任何状态下都恰好占一行。*
   这是本方案的验收核心。

优先级：`L0` 命令单行化（用户明确要求）> `L1` 报错正文 > `L4` 任务列表丢行 > `L2` Plan/Subagent 正文 > `L3` 结构化 JSON > `L5` diff 长行 > `L6` 待办/问答内换行。

---

## 1. 背景与已确认现状

### 1.1 渲染链路（与 `06-tool-view.md` 一致，此处只保留与换行相关的部分）

```text
NormalizedMessage
  → formatToolResultContent            （useChatMessages.ts:9-13，此处可能 JSON.stringify）
  → ChatMessage { toolInput: JSON字符串, toolResult.content: 字符串 }
  → MessageComponent
      ├─ isSubagentContainer → SubagentPanel      （MessageComponent.tsx:232-244）
      └─ isToolUse                                （MessageComponent.tsx:245-299）
           ├─ ToolRenderer mode="input"           （MessageComponent.tsx:255-270 → ToolRenderer.tsx）
           ├─ 报错 → ToolErrorDisplay             （MessageComponent.tsx:273-281）
           └─ 成功 → ToolRenderer mode="result"   （MessageComponent.tsx:282-297）
  → ContentRenderers/*                   （TextContent / MarkdownContent / TaskListContent / …）
```

命令行是这条链上的**独立支路**，不经过 `ContentRenderers`：

```text
toolName === 'Bash'   → BashCommandDisplay   （ToolRenderer 特判；命令与输出同一张卡）
toolName === 'PowerShell' → OneLineDisplay   （terminal 分支）
```

换行能否保住，取决于三件事各自是否成立：

| 环节 | 是否保住换行 |
| --- | --- |
| 字符串里是否还有 `\n` | 取决于序列化（L3）与正则解析（L4） |
| 渲染组件是否 pre-wrap | `TextContent` plain 可以；`QueueItemContent`/`QuestionAnswerContent` 不行（L6） |
| 是否走了 Markdown 且开了 breaks | 没开 → 单 `\n` 被折叠成空格（L1、L2） |

### 1.2 已经正确处理、不要动的表面

先划清边界，避免改错地方：

1. **`TextContent` 的三种 format**（`TextContent.tsx:20-50`）已经正确：`json`/`code` 用 `<pre>`，`plain` 用 `whitespace-pre-wrap`。其中 `code`/`json` 会继承全局 `word-break: break-all`（`index.css:818-823`），是「断得太碎」而非「不断行」，属于另一个议题。
2. **`BashCommandDisplay` 的输出**（`BashCommandDisplay.tsx:206-210`）用 `whitespace-pre-wrap break-all` + `max-h-80 overflow-auto`，是正确的。
3. **`CollapsibleDisplay` 的 raw params**（`CollapsibleDisplay.tsx:78`）用 `<pre className="whitespace-pre-wrap ...">`，正确。
4. **所有标题/摘要/一行行**：`OneLineDisplay` 的 `truncate`（`:134, 150, 185`）、`CollapsibleSection` 的标题 `truncate`（`:61, 84`）、`ToolGroupContainer` 的预览 `truncate`（`:159`）、`ToolErrorDisplay` 折叠态的 `truncate`（`:75`）——**都是一行化设计，本次不改**。
5. **命令的折叠态已经是单行**（`BashCommandDisplay.tsx:151` 的 `truncate` 分支），符合 `L0`；**只有展开态在换行**。
6. **全局 CSS 的两条规则是有意为之**（`index.css:818-839`）：
   - `.chat-message pre, code { white-space: pre-wrap !important; word-break: break-all }`（`:818-823`）——为了让长 URL/长路径强制换行；
   - `.chat-message .markdown-code-block pre { white-space: pre !important; overflow-x: auto }`（`:826-832`）——围栏代码块保留原格式并横向滚动。
   这也解释了为什么 `BashCommandDisplay.tsx:145-147` 和 `ToolErrorDisplay.tsx:73-74` 刻意用 `<span>` 而不是 `<code>`：一旦是 `<code>`，`!important` 会击败 `truncate`。**任何新增的「单行」表面都要遵守这条——`L0` 直接踩在这个坑上（`OneLineDisplay.tsx:106` 用的是 `<code>`）。**

### 1.3 需求与缺陷清单（已定位到行）

#### L0（用户明确要求）命令行必须单行，不换行

> 这一条**不是缺陷，是新增需求**。当前行为是「展开后换行」，需求是「永远单行」。

- **代码自己的注释已经写明了「单行」意图**（`ToolRenderer.tsx:142-143`）：
  > `// Bash renders as a Codex-style command row: the command on a single line with`
  > `// a chevron that expands to show the output inline.`
  但实现是「展开后换行」。**所以 `L0` 不是新增产品方向，而是让实现回到它自己声明的意图。** 这一点在评审时可以直接引用，无需额外论证。
- **位置**：
  - `src/modules/chat/tools/BashCommandDisplay.tsx:148-155`——命令 span 的类名是
    `open ? 'whitespace-pre-wrap break-all' : 'truncate'`，**展开时换行**（与上述注释矛盾）。
  - `src/modules/chat/tools/OneLineDisplay.tsx:106`——terminal 分支的
    `<code className={... ${wrapText ? 'whitespace-pre-wrap break-all' : 'block truncate'}}>`。
    `PowerShell` 配置了 `wrapText: true`（`toolConfigs.ts:148`），**所以 PowerShell 命令行也换行**。
- **影响工具**：`Bash`（走 `BashCommandDisplay`）、`PowerShell`（走 `OneLineDisplay` terminal 分支）。
  `Bash` 注册表里的 `wrapText: true`（`toolConfigs.ts:122`）对 Bash 本身是死代码——`ToolRenderer.tsx:145` 按名字把它特判到 `BashCommandDisplay`，该配置项只影响分组预览。
- **需求行为**：命令行永远恰好一行；超出可用宽度时**横向滚动**查看完整命令，既不换行也不省略。
- **必须一起处理的坑**：`OneLineDisplay.tsx:106` 用的是 `<code>`，会被 `index.css:818-823` 的
  `white-space: pre-wrap !important` 强制换行。**只改类名无效**，必须同时把 `<code>` 换成 `<span>`
  （`BashCommandDisplay.tsx:145-147` 已经踩过这个坑并留了注释）。
- **`wrapText` 字段的处置**：改完后 `wrapText` 将**没有任何配置使用者**（只剩 `Bash`/`PowerShell` 两处，且都指向 terminal）。按仓库既有 gotchas 对「声明了却不读」字段的态度（见 `06-tool-view.md`），应当**删除该字段**而不是留着骗人；删除后非 terminal 分支行为不变（本来就没人传 `true`）。
- **可选（默认不做）**：对齐 `GitPanel` 的既有交互，给命令加一个「换行 / 滚动」用户开关（`GitPanel.tsx:37` 的 `wrapText` state + `GitDiffViewer.tsx:53` 的 `overflow-x-auto whitespace-pre` 分支已经是现成范式）。默认实现固定为「单行 + 滚动」，不引入开关。

#### L1 报错正文的换行被 Markdown 吞掉

- **位置**：`src/modules/chat/tools/ToolErrorDisplay.tsx:83`
- **代码**：`<Markdown className="prose prose-sm prose-red max-w-none font-serif dark:prose-invert">{trimmedContent}</Markdown>`
- **根因**：`Markdown` 的 `breaks` 默认为 `false`（`Markdown.tsx:21-22, 268`），只有 `breaks` 为真时才挂 `remarkBreaks`（`Markdown.tsx:283-285`）。标准 Markdown 把段落内的单个 `\n` 视为空格，于是多行报错被回流成一整段。
- **影响工具**：**所有失败的非 Bash 工具**。Bash 的失败不走这里（`MessageComponent.tsx:273` 按名字排除，输出留在 `BashCommandDisplay` 里）。
- **额外代价**：报错是运行时文本，走 Markdown 还会把 `#`、`*`、`|`、`\` 当语法处理，可能进一步改写原文。
- **同源问题**：`ToolErrorDisplay` 忽略 `useIsExportingTranscript()`（见 `06-tool-view.md` 的 gotchas），导出的失败卡片只保留折叠态的一行预览——这是同一个组件上的相邻缺陷，建议一并处理（见 §4.1）。

#### L2 Plan / Subagent 正文的换行被 Markdown 吞掉

- **位置（同一根因的四个调用点）**：
  - `src/modules/chat/tools/ContentRenderers/MarkdownContent.tsx:22`（`<Markdown>` 未传 `breaks`，是公共入口）
  - `src/modules/chat/tools/ToolRenderer.tsx:259`——`Task` / `Agent` 的 input 与 result（`toolConfigs.ts:560, 577, 619`）
  - `src/modules/chat/tools/PlanDisplay.tsx:87`——`ExitPlanMode` / `exit_plan_mode`
  - `src/modules/chat/tools/SubagentPanel.tsx:279`——subagent 的最终结果
- **反证（说明这是缺陷而非设计）**：`toolConfigs.ts:703` 和 `:719` 显式写了
  `content: input.plan?.replace(/\\n/g, '\n') || input.plan`
  ——作者明显认为文本里该有换行，才专门把转义的 `\\n` 还原成真实换行，结果紧接着被 Markdown 折叠掉。
- **注意区分**：`Task` 的多字段分支用 `parts.join('\n\n')`（`toolConfigs.ts:607`），双换行是段落分隔，**仍然生效**；坏掉的是 prompt/plan 内部的单个 `\n`。
- **文案风险**：Plan 是模型撰写的 Markdown（可能有列表、加粗），不能像 L1 那样退化成纯文本。所以 L1 和 L2 必须走**不同**的修法。

#### L3 结构化结果被 `JSON.stringify` 压成单行

- **位置**：
  - `src/modules/chat/hooks/useChatMessages.ts:10`——`const text = typeof content === 'string' ? content : JSON.stringify(content);`
  - `src/modules/chat/tools/SubagentPanel.tsx:68`——`JSON.stringify(content)`（`readResultText` 兜底分支）
  - `server/modules/providers/list/claude/claude-sessions.provider.ts:1113`——`JSON.stringify(toolResult.content)`（Claude 历史里 `tool_result.content` 为内容块数组时）
- **影响**：所有 result `content` 为数组/对象（而非预拼接字符串）的工具；对 Claude 历史而言是**每一个** content 为块数组的 `tool_result`。`Default` 只对 MCP 的 `type:'text'` 数组做了拆包（`toolConfigs.ts:771-806`），其余原样落到 `TextContent` plain，输出成一整行 JSON。
- **不一致证据**：`toolInput` 在所有地方都是 `JSON.stringify(x, null, 2)`（`useChatMessages.ts:288`、`toolConfigs.ts:737, 763, 796, 799, 824`）。输入缩进、输出不缩进，属于疏漏而非风格。
- **相邻问题（值得知道，不在本方案范围）**：
  - `server/modules/providers/list/codex/codex-sessions.provider.ts:333`、`server/modules/providers/list/dsh/dsh-sessions.provider.ts:99` 用 `.join('')` 拼接多个文本块且**无分隔符**，块本身没有末尾换行时会直接粘连。
  - 但 `.join('')` 在流式增量场景是正确的，**不要顺手改成 `\n`**，否则会把流式拼接改错。

#### L4 任务列表正则丢行 + 长主题被截断

- **位置**：`src/modules/chat/tools/ContentRenderers/TaskListContent.tsx`
  - `:15-37` `parseTaskContent`：`content.split('\n')` 后逐行正则匹配，**不匹配的行被直接跳过**。
  - `:78-85` 兜底只在 `tasks.length === 0`（一行都没匹配上）时触发。于是**混合 payload 中，表头、空行、换行续写的主题、备注会被静默丢弃**，剩下的行看起来「很正常」，问题因此不易被发现。
  - `:115` 主题用 `truncate`，且没有 `title` 属性，长主题被省略号截断后**无法查看原文**。
- **影响工具**：`TaskList` result（`toolConfigs.ts:514-522`）、`TaskGet` result（`toolConfigs.ts:537-545`）。注意服务端会把历史里的 `TaskCreate/Update/List/Get` 改写成 `TodoWrite`（`server/shared/message-unification.ts`），但**实时**的 `TaskList`/`TaskGet` 结果仍然走到这个渲染器。
- **性质**：这是**信息丢失**，严重程度高于「换行不好看」。本方案把它排在 L2 之前。

#### L5 diff 长行被裁切且无横向滚动出口

- **位置**：`src/modules/chat/tools/ToolDiffViewer.tsx`
  - `:45` 外层 `overflow-hidden rounded border ...`——**只有 `overflow-hidden`，没有 `overflow-x-auto`**。
  - `:79-83` 行内容 `<span className="flex-1 whitespace-pre-wrap px-2 ...">`——flex 子项**没有 `min-w-0`**，其自动最小尺寸可能等于最长不可断 token。
- **根因链**：`.chat-message { overflow-wrap: break-word }`（`index.css:811-815`）**不会**降低 min-content 尺寸，因此 flex 子项仍可能撑开；撑开后由 `.chat-message { contain: paint }`（`index.css:635-637`）、`.chat-messages-pane { contain: paint }`（`index.css:611-613`）和滚动容器的 `overflow-x-hidden`（`ChatMessagesPane.tsx:216`）三层裁掉。**横向溢出没有查看出口。**
- **对照正确实现**：围栏代码块显式给了 `overflow-x: auto`（`index.css:826-832`）；表格给了 `overflow-x-auto` + 移动端滚动提示（`index.css:847-871`）。diff 是唯一漏掉这一处理的代码类正文。
- **与 L0 的关系**：`L0` 的做法（单行 + `overflow-x-auto`）正是本条的参考实现；`L5` 则相反（优先换行，仅在不可断 token 时滚动）。**两者方向不同是刻意的**：命令是「标识符」，diff 是「内容」。
- **影响工具**：`Edit`、`Write`、`ApplyPatch` 的 diff 正文。

#### L6 待办与问答文本内的换行被折叠成空格

- **位置**：
  - `src/modules/chat/tools/Queue.tsx:107-114`——`QueueItemContent` 是普通 `<div className={cn('min-w-0 flex-1 text-xs', ...)}>`，无 `whitespace-pre-wrap`
  - `src/modules/chat/tools/ContentRenderers/QuestionAnswerContent.tsx:96-98`（问题文本）、`:162-170`（选项 label / description）
- **影响工具**：`TodoWrite`、`TodoRead`、Codex 的 `TodoList`/`update_plan`；`AskUserQuestion`（转录区视图）。
- **实际影响面偏低**：多数待办项是单行文本，只有 payload 内含 `\n` 时可见。因此排在最后。

### 1.4 相邻但不在本方案范围的问题

列出以免评审时被当成「方案漏了」：

| 问题 | 位置 | 为什么不并入 |
| --- | --- | --- |
| `Grep`/`Glob` 结果只渲染文件名列表，**匹配到的行内容被丢弃** | `toolConfigs.ts:328-333`、`FileListContent.tsx` | 这是「该不该展示匹配行」的产品决策，不是换行问题；改动会改变卡片体积与性能特征 |
| `TodoRead` 结果不以 `[` 开头时静默不渲染任何内容 | `toolConfigs.ts:438-453` + `TodoListContent.tsx:62-64` | 静默空输出，属独立缺陷 |
| `codex/dsh` 多文本块 `.join('')` 无分隔符 | 见 L3 相邻问题 | 与流式拼接语义耦合，需单独验证 |
| 折叠态一律一行（`truncate`） | §1.2 第 4 条 | 刻意设计 |
| `word-break: break-all` 让 JSON/code 断在词中间 | `index.css:818-823` | 「断得太碎」是另一类问题，本方案不动全局规则 |
| ZCode 的 patch 工具名是 `Patch`，注册表键是 `ApplyPatch` | `zcode-sessions.provider.ts:502` | 落到 `Default` 渲染，不是换行问题；是否补别名属独立决策 |
| ZCode 未识别工具回退名是 `Tool` | `zcode-sessions.provider.ts:211, 468` | 同上，落到 `Default`；`Default` 正文本身是 pretty JSON，不受本方案影响 |
| ZCode 未给注册表新增任何工具键 | `toolConfigs.ts` 的 25 个键与 `353ab751` 时一致 | 因此本轮新增 Provider 不改变 `L0`–`L6` 的工具范围 |

---

## 2. 目标、指标与非目标

### 2.1 目标

1. **命令行（Bash / PowerShell）永远恰好一行**，超宽横向滚动，折叠/展开都不换行（`L0`）。
2. **运行时文本（报错、shell 输出）保持字节级换行**——行数、空行、缩进与 payload 一致。
3. **模型撰写的 Markdown 文本，单个 `\n` 渲染为硬换行**，同时不破坏围栏代码块、表格、列表的既有渲染。
4. **结构化结果不再以单行 JSON 呈现**，缩进风格与 `toolInput` 一致。
5. **任何 payload 行都不因渲染而丢失**——解析器不认识的行必须以原文回退，而不是丢弃。
6. **超长不可断 token 有可见出口**（换行或横向滚动），不被静默裁切。
7. 以上在**转录区、导出文档、Subagent 面板**三个渲染入口表现一致。
8. 不引入新的全局 CSS `!important`，不改变既有标题/摘要的一行化设计。

### 2.2 可验证指标

| 指标 | 通过条件 |
| --- | --- |
| 命令单行（折叠） | 含 `\n` 的多行命令，折叠态渲染高度等于一行 |
| 命令单行（展开） | 同一命令展开输出后，命令行仍为一行；容器存在 `overflow-x-auto`，滚动可达行尾 |
| 命令不省略 | 命令行不使用 `text-overflow: ellipsis` 截断（`truncate` 仅允许出现在折叠态之外的一行摘要行） |
| `wrapText` 清理 | 全仓 `wrapText` 在 chat tools 下无残留引用；`ToolDisplayConfig` 不再声明该字段 |
| 报错换行 | 给定含 5 行（其中 2 行为空行）的报错文本，展开后 DOM 中换行位置与原文一一对应 |
| Markdown 硬换行 | 给定 `line1\nline2`，Plan/prompt 渲染为两个可见行（`<br>` 或 `whitespace-pre-wrap`），且围栏代码块内的 `\n` 语义不变 |
| JSON 缩进 | 结构化 result 渲染输出包含换行且缩进为 2 空格，与同工具的 `toolInput` 展示一致 |
| 无丢行 | 混合 payload（合法行 + 表头 + 空行 + 备注）渲染后，所有非空行文本都能在 DOM 中找到 |
| 长行可见 | 单行 500 字符的 diff 行在 DOM 中不被裁切（换行或存在可横向滚动的祖先） |
| 导出等价 | `TranscriptExportDocument` 下同一 fixture 的断言与屏幕态一致（除强制展开外）；命令行的导出态同样单行 |
| 回归 | `toolGrouping.test.ts`、`transcriptExport.test.tsx`、`useChatMessages.test.ts` 全绿 |

### 2.3 非目标

1. 不改 `CollapsibleSection` / `ToolGroupContainer` / `ToolErrorDisplay` 折叠态的一行化设计；`OneLineDisplay` 只改 terminal 分支与 `wrapText` 清理，其余分支不动。
2. 不改全局 `index.css` 的 `.chat-message pre, code` 与 `.markdown-code-block` 规则（`L0` 通过换标签规避，而不是改规则）。
3. 不改变 `TOOL_CONFIGS` 的注册表结构、工具分类与既有字段语义；唯一例外是删除已无使用者的 `wrapText`（见 §4.0）。
4. 不改服务端事件格式；L3 的服务端改动仅限历史投影的序列化缩进。
5. 不新增工具卡片类型、不调整分组阈值 `TOOL_GROUP_THRESHOLD`。
6. 不处理 §1.4 的相邻问题（含 ZCode 的 `Patch` / `Tool` 别名）。
7. 不做 Markdown 渲染器替换（不引入新的 markdown 库）。
8. **不给命令加「换行 / 滚动」用户开关**（对齐 GitPanel 的交互留作后续可选项，见 §4.0）。

---

## 3. 候选路线与决策

### 3.0 L0：命令单行怎么做

| 路线 | 做法 | 优点 | 缺点 |
| --- | --- | --- | --- |
| A | 折叠/展开都 `truncate`（省略号） | 改动最小 | 长命令看不全，与「观看效果好」相悖；`title` 提示只覆盖桌面悬停 |
| **B（推荐）** | 折叠/展开统一 **单行 + `overflow-x-auto`**（`whitespace-pre`） | 命令永远一行且完整可达；与 `GitDiffViewer.tsx:53` 的既有非换行分支同构 | 长命令会出现横向滚动条（macOS 覆盖式滚动条默认不占位） |
| C | 折叠 `truncate`，展开单行滚动 | 保留折叠态的干净观感 | 两个状态行为不一致，用户要先展开才能看全命令 |
| D | 给用户一个「换行 / 滚动」开关 | 兼顾两类偏好，对齐 `GitPanel.tsx:37` | 超出本轮范围；需要新增 UI 与持久化偏好 |

**决策：路线 B。** 折叠与展开统一单行滚动，行为一致、命令完整可达。路线 D 记为后续可选。

**配套决策（必须与 B 同时做）：**

1. `OneLineDisplay.tsx:106` 的 terminal 分支把 `<code>` 换成 `<span>`——否则 `index.css:818-823` 的
   `white-space: pre-wrap !important` 会击败单行设置，改类名等于没改。
2. 删除 `wrapText` 字段（`toolConfigs.ts:16`、`OneLineDisplay.tsx:19, 48, 185`、`ToolRenderer.tsx:193`）
   及 `Bash`/`PowerShell` 上的 `wrapText: true`（`toolConfigs.ts:122, 148`）。删除后：
   - terminal 分支：固定「单行 + 横向滚动」；
   - 非 terminal 分支：固定 `truncate`（与当前 `wrapText` 默认 `false` 的行为完全一致，无行为变化）。
3. 不改 `BashCommandDisplay` 的输出区（`BashCommandDisplay.tsx:206-210` 继续 `whitespace-pre-wrap break-all`）——
   **输出要换行，命令不要换行**，这是本需求的核心区分。

### 3.1 L1：报错正文用什么渲染

| 路线 | 做法 | 优点 | 缺点 |
| --- | --- | --- | --- |
| A | `ToolErrorDisplay` 的 `<Markdown>` 加 `breaks` | 一行改动，与用户消息一致 | 报错仍是 Markdown，`#`/`*`/`|`/`\` 仍被解析，可能改写运行时原文 |
| **B（推荐）** | 展开体改为纯文本 pre-wrap（复用 `TextContent format="plain"` 的样式），不再走 Markdown | 运行时文本字节级保真；与 `BashCommandDisplay` 的输出观感一致；不依赖 `remark-breaks` | 报错里若含 Markdown 语法（极罕见）不再渲染格式 |

**决策：路线 B。** 依据「文本来源分流」原则：报错是运行时数据而非模型撰写内容。同时把折叠态 `truncate` 与导出态的 `isExporting` 一起修（导出强制展开正文），见 §4.1。

### 3.2 L2：Plan / Subagent 正文

| 路线 | 做法 | 优点 | 缺点 |
| --- | --- | --- | --- |
| **A（推荐）** | `MarkdownContent` 增加 `breaks` prop 并在 Plan/Subagent 调用点传 `true` | 保留 Markdown（列表/加粗/代码块），单换行变硬换行；与 `MessageComponent.tsx:131-132` 用户消息一致 | 需确认表格单元格内的软换行不会被破坏 |
| B | 全部退化为纯文本 | 最保真 | Plan 的 Markdown 结构（标题、列表）会丢失，是明显回退 |
| C | 全局给 `Markdown` 默认 `breaks = true` | 一处生效 | 会改变助手正文与思考流的换行观感，**超出本方案范围**，风险最大 |

**决策：路线 A。** 只对「工具卡片内模型撰写的文本」显式传 `breaks`，不改 `Markdown` 的默认值。

### 3.3 L3：JSON 缩进改在哪里

| 路线 | 做法 | 风险 |
| --- | --- | --- |
| **A（推荐）** | 在三个序列化点统一加 `null, 2` | 需确认下游消费方（`startsWith('[')`、正则解析）不被缩进破坏——已初步核对兼容：`TodoRead` 的 `content.startsWith('[')` 对缩进后的数组仍成立（`[\n  {...}`） |
| B | 只在展示层（`TextContent`）探测并美化 | 对 `TaskListContent` 等已先行取值的结果无效；「探测 JSON」是隐式魔法 |

**决策：路线 A**，但必须为三个点各补一个契约测试（§6.2），因为 L3 是唯一一处改动会跨前后端的。

### 3.4 L4：不匹配行怎么办

| 路线 | 做法 | 说明 |
| --- | --- | --- |
| A | 严格化：任一行不匹配就整体回退为 `<pre>` | 无信息丢失；已匹配的合法列表也会退化成原文，观感不如表格 |
| **B（推荐）** | 忽略空行后，若仍有不匹配行 → 整体回退为 `<pre>`；全部匹配 → 保留现在的可视化列表 | 空行不影响判定，避免「列表末尾多一个空行就退化」 |
| C | 保留匹配行 + 把不匹配行渲染成原文块 | 信息保留最好，但布局最复杂，且需要定义顺序语义 |

**决策：路线 B**，并为 `truncate` 的主题补 `title` 属性（`TaskListContent.tsx:115`），让长主题至少可悬停查看。路线 C 记为后续可选优化。

### 3.5 L5：diff 长行

**决策：** 给行内容 flex 子项补 `min-w-0`（`ToolDiffViewer.tsx:79`），保持 `whitespace-pre-wrap break-words`（优先换行）；仅当仍存在不可断 token 时，外层由 `overflow-hidden` 改为 `overflow-x-auto`（`ToolDiffViewer.tsx:45`）。两步都做，因为只加 `min-w-0` 无法覆盖「500 字符无空格」的极端场景。

**明确不采用**：改全局 `.chat-message pre, code` 规则（影响面过大）、给 diff 加 `truncate`（等于丢内容）。

### 3.6 L6：待办与问答

**决策：** 给 `QueueItemContent` 的内容 div（`Queue.tsx:107-120`）与 `QuestionAnswerContent` 的问题/选项文本（`:96-98`、`:162-170`）加 `whitespace-pre-wrap break-words`。纯 CSS，无结构改动。

---

## 4. 详细设计

### 4.0 L0 命令单行化

**4.0.1 `BashCommandDisplay.tsx:148-155`（Bash 命令行）**

把命令 span 的类名由

```tsx
'min-w-0 flex-1 font-mono text-xs text-foreground',
open ? 'whitespace-pre-wrap break-all' : 'truncate',
```

改为单行 + 横向滚动（折叠/展开一致）：

```tsx
'min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-xs text-foreground',
```

要点：

- `whitespace-pre` 保留命令内的原始空白（多行命令里的 `\n` 不再产生换行，因为容器不换行，但也不会被压成空格）；
- `overflow-x-auto` 必须挂在**命令 span 自身**上——外层卡片是 `overflow-hidden`（`:112`），挂在父级会被裁掉；flex 子项已有 `min-w-0 flex-1`，具备收缩条件；
- 该 span 不是 `<code>`/`<pre>`，不受 `index.css:818-823` 影响，这条已经满足；
- 头部 `onClick`（`:123`）仍在父 div 上，命令区滚动不影响「点击展开输出」；`role="button"` / `aria-expanded` 不变。

**4.0.2 `OneLineDisplay.tsx:104-109`（PowerShell 命令行）**

1. `<code>` → `<span>`（**必须**，见 §3.0 第 1 条），并把 `$` 前缀保留在同一个 span 内；
2. 类名固定为 `block overflow-x-auto whitespace-pre font-mono text-xs text-green-400`；
3. 外层深色容器（`:105`）已有 `min-w-0 flex-1`，无需改动。

**4.0.3 删除 `wrapText`**

| 文件 | 位置 | 动作 |
| --- | --- | --- |
| `toolConfigs.ts` | `:16` 类型声明、`:122`（Bash）、`:148`（PowerShell） | 删除字段与两处赋值 |
| `OneLineDisplay.tsx` | `:19` props、`:48` 默认值、`:106` terminal 分支、`:185` 通用分支 | 删除 props 与默认值；两处分支改为固定类名 |
| `ToolRenderer.tsx` | `:193` `wrapText={displayConfig.wrapText}` | 删除该 prop 传递 |
| `src/modules/chat/tools/README.md` | `:162` | 同步删除（该文件已是过期草稿，见 `06-tool-view.md`，顺手修正此行） |

**4.0.4 明确不改的部分**

- `BashCommandDisplay` 的输出区（`:206-210`）：继续 `whitespace-pre-wrap break-all` + `max-h-80 overflow-auto`。
- `BashCommandDisplay` 的 `description` 行（`:189`）：已是 `truncate` 单行。
- `ToolGroupContainer` 的组预览（`:159`）：已是 `truncate` 单行。
- 分组预览对 Bash 的取值走 `getToolInputPreview` → `config.getValue`（`toolGrouping.ts:68`），拿到的是完整命令字符串，随后由 `truncate` 收成一行——**不需要额外改动**；多行命令在预览里仍是一行，符合需求。

**4.0.5 验收锚点**

给定命令 `git commit -m "a\nb"`（或任何含换行的多行命令）：

- 折叠态：命令行占一行；
- 展开输出后：命令行仍占一行，且 `scrollWidth > clientWidth` 时可横向滚动到行尾；
- 导出文档：命令行同样一行（`isExporting` 只影响展开态，不影响命令行的单行约束）。

### 4.1 L1 报错正文

`ToolErrorDisplay.tsx`：

1. 展开体（`:81-87`）不再使用 `<Markdown>`，改为与 `TextContent` plain 同构的纯文本容器：
   `whitespace-pre-wrap break-words` + 保留红色主题类；不使用 `<pre>`/`<code>` 标签（避免 `index.css:820` 的 `!important` 影响折叠态的 `truncate`，与 `:73-74` 的既有注释保持一致）。
2. 折叠态预览（`:72-78`）保持 `truncate` 不变。
3. 引入 `useIsExportingTranscript()`：导出时强制走展开体（`open || isExporting`），使导出文档包含完整报错，消除 `06-tool-view.md` 记录的「导出只剩一行预览」问题。
4. 保留 `aria-expanded`、键盘交互与 `role="button"` 语义不变。

**验收锚点**：给定 `Error: boom\n  at a.ts:1\n  at b.ts:2`，展开后必须呈现三行，且不以 Markdown 方式渲染。

### 4.2 L2 Plan / Subagent 正文

1. `MarkdownContent.tsx`：给 props 增加 `breaks?: boolean`，透传给 `<Markdown breaks={breaks}>`；**默认值保持 `false`**，避免影响既有调用方。
2. 显式传 `breaks` 的调用点：
   - `ToolRenderer.tsx:259`（`contentType: 'markdown'` 分支）——覆盖 `Task`/`Agent` 的 input 与 result。
   - `PlanDisplay.tsx:87`——`ExitPlanMode` / `exit_plan_mode`。
   - `SubagentPanel.tsx:279`——subagent 结果。
3. `toolConfigs.ts:703, 719` 的 `input.plan?.replace(/\\n/g, '\n')` **保留**——它仍是必要的（把 Provider 传来的转义换行还原），修复点在渲染层而非配置层。
4. 回归关注：Markdown 表格单元格内的软换行、列表项内的续行。若发现某一类文本出现「过度断行」，退路是把该调用点的 `breaks` 关掉，改为依赖 `\n\n` 分段。

### 4.3 L3 结构化 JSON

1. `useChatMessages.ts:10` → `JSON.stringify(content, null, 2)`。
2. `SubagentPanel.tsx:68` → `JSON.stringify(content, null, 2)`。
3. `claude-sessions.provider.ts:1113` → `JSON.stringify(toolResult.content, null, 2)`。
4. **前置校验（必须做，而非可选）**：确认下列消费方在缩进后行为不变——
   - `toolConfigs.ts:438-453`（`TodoRead`，`startsWith('[')` + `JSON.parse`）
   - `toolConfigs.ts:771-806`（`Default` 的 MCP `type:'text'` 拆包，先 `JSON.parse` 再 `JSON.stringify(..., null, 2)`）
   - `TaskListContent`（不该收 JSON，但需确认不会因缩进产生新的匹配行）
   - 服务端 `formatToolResultContent` 的 `<tool_use_error>` 包裹剥离（`useChatMessages.ts:11`）——缩进发生在剥离之后，顺序不受影响
5. 体积影响：对超大 result 会增加空白字符。服务端已有 oversized output 截断，暂不引入新的上限；在 §6.3 中加一条体积断言作为观察项。

### 4.4 L4 任务列表

1. `parseTaskContent`（`TaskListContent.tsx:15-37`）返回值改为 `{ tasks, hasUnparsedLine }`：
   - 遍历时跳过纯空白行；
   - 任何非空且不匹配的行 → `hasUnparsedLine = true`。
2. `TaskListContent` 组件（`:75-85`）：
   - `hasUnparsedLine === true` → 用现有 `<pre className="whitespace-pre-wrap ...">` 渲染原文；
   - 否则按现状渲染可视化列表。
3. `:115` 主题 span 增加 `title={task.subject}`。
4. 不改变「0 行匹配 → 回退原文」的既有行为（它是新逻辑的子集）。

### 4.5 L5 diff 长行

1. `ToolDiffViewer.tsx:79` 的行内容 span：`flex-1 whitespace-pre-wrap` → `min-w-0 flex-1 whitespace-pre-wrap break-words`。
2. `ToolDiffViewer.tsx:45` 外层：`overflow-hidden` → `overflow-hidden overflow-x-auto`（保留圆角裁切，同时给不可断 token 一个滚动出口）。
3. 行号列（`w-6 flex-shrink-0`）不动，滚动时随内容一起横向移动属于可接受行为；若评审认为行号应固定，改为 `sticky left-0`（列为可选项，默认不做）。

### 4.6 L6 待办与问答

1. `src/modules/chat/tools/Queue.tsx:107-114` 的内容 div 增加 `whitespace-pre-wrap break-words`。
2. `QuestionAnswerContent.tsx:96-98`、`:162-170` 同样处理。
3. 不改变 stateful 的展开/收起行为（`QuestionAnswerContent` 是唯一有状态的 content renderer）。

---

## 5. 文件级改动清单

| # | 文件 | 改动 | 对应条目 |
| --- | --- | --- | --- |
| 0a | `src/modules/chat/tools/BashCommandDisplay.tsx` | 命令 span 改单行 + `overflow-x-auto`（`:148-155`） | L0 |
| 0b | `src/modules/chat/tools/OneLineDisplay.tsx` | terminal 分支 `<code>`→`<span>`、单行滚动；删除 `wrapText` props/默认值/两处分支（`:19, 48, 106, 185`） | L0 |
| 0c | `src/modules/chat/tools/configs/toolConfigs.ts` | 删除 `wrapText` 类型与 Bash/PowerShell 赋值（`:16, 122, 148`） | L0 |
| 0d | `src/modules/chat/tools/ToolRenderer.tsx` | 删除 `wrapText` prop 传递（`:193`） | L0 |
| 0e | `src/modules/chat/tools/README.md` | 同步删除 `wrapText` 声明（`:162`） | L0、文档同步 |
| 1 | `src/modules/chat/tools/ToolErrorDisplay.tsx` | 展开体改纯文本 pre-wrap；接入 `useIsExportingTranscript` | L1 |
| 2 | `src/modules/chat/tools/ContentRenderers/MarkdownContent.tsx` | 新增 `breaks?: boolean`（默认 false） | L2 |
| 3 | `src/modules/chat/tools/ToolRenderer.tsx` | markdown 分支传 `breaks` | L2 |
| 4 | `src/modules/chat/tools/PlanDisplay.tsx` | 传 `breaks` | L2 |
| 5 | `src/modules/chat/tools/SubagentPanel.tsx` | 结果区传 `breaks`；`readResultText` 缩进 | L2、L3 |
| 6 | `src/modules/chat/hooks/useChatMessages.ts` | `formatToolResultContent` 缩进 | L3 |
| 7 | `server/modules/providers/list/claude/claude-sessions.provider.ts` | 历史投影序列化缩进 | L3 |
| 8 | `src/modules/chat/tools/ContentRenderers/TaskListContent.tsx` | 不匹配行检测 + 回退 + `title` | L4 |
| 9 | `src/modules/chat/tools/ToolDiffViewer.tsx` | `min-w-0` + `overflow-x-auto` | L5 |
| 10 | `src/modules/chat/tools/Queue.tsx` | `whitespace-pre-wrap` | L6 |
| 11 | `src/modules/chat/tools/ContentRenderers/QuestionAnswerContent.tsx` | `whitespace-pre-wrap` | L6 |
| 12 | `src/modules/chat/tests/toolContentLineBreaks.test.tsx`（新增） | 见 §6 | 全部 |
| 13 | `src/modules/chat/tests/toolCommandSingleLine.test.tsx`（新增） | 见 §6.1 | L0 |
| 14 | `docs/architecture/06-tool-view.md` | 更新「报错展开体」「MarkdownContent」「命令行单行」三处描述 | 文档同步 |

---

## 6. 测试方案

### 6.1 屏幕态渲染测试

新增两个文件（测试目录是 `src/modules/chat/tests/`，与 `toolGrouping.test.ts` / `transcriptExport.test.tsx` 同级）：

- `toolContentLineBreaks.test.tsx`——覆盖 L1–L6
- `toolCommandSingleLine.test.tsx`——覆盖 L0

用 React Testing Library 逐个断言 DOM，而不是只断言类名：

**L0（`toolCommandSingleLine.test.tsx`）**

| 用例 | fixture | 断言 |
| --- | --- | --- |
| Bash 折叠态单行 | 含 `\n` 的 `git commit -m "a\nb"` | 命令 span 存在 `whitespace-pre` + `overflow-x-auto`；不含 `whitespace-pre-wrap` |
| Bash 展开态仍单行 | 同上 + 有输出，点击展开 | 展开后命令 span 的类名不变（不因 `open` 切换）；输出区仍含 `whitespace-pre-wrap` |
| PowerShell 单行 | 含 `\n` 的命令 | 命令节点是 `<span>` 而非 `<code>`（否则会被全局 `!important` 击败）；含 `overflow-x-auto` |
| 无 `wrapText` 残留 | — | 对 `OneLineDisplay` 传 `wrapText` 不再是合法 prop（类型层面）；渲染非 terminal 分支仍为 `truncate` |
| 导出态单行 | 导出文档 | 命令行同样单行 |

**L1–L6（`toolContentLineBreaks.test.tsx`）**

| 用例 | fixture | 断言 |
| --- | --- | --- |
| L1 报错展开 | 5 行含 2 空行的报错 | 展开后文本节点保留 `\n`（或容器 class 含 `whitespace-pre-wrap`），且不产生 `<p>`/`<strong>` 等 Markdown 元素 |
| L2 Plan 硬换行 | `line1\nline2` | 渲染出两个可见行；围栏代码块内 `\n` 不被额外转换 |
| L2 Subagent 结果 | 同上报错形态的 result | 与 Plan 一致 |
| L3 JSON 缩进 | `[{ "a": 1 }]` 结构化 result | 输出含缩进换行；`JSON.parse` 仍可还原 |
| L4 混合 payload | 合法行 + 表头 + 空行 + 备注 | 所有非空行文本都能在 DOM 中命中；不含可视化列表进度条 |
| L4 全合法 payload | 3 条合法任务 | 仍渲染可视化列表（不因新增逻辑而回退） |
| L5 长 diff 行 | 单行 500 字符 | 行内容容器为 `min-w-0`，外层存在 `overflow-x-auto` |
| L6 待办换行 | 含 `\n` 的 todo item | 文本节点保留换行 |

### 6.2 L3 跨层契约测试

- 客户端：新增/扩展 `useChatMessages` 测试，断言结构化 `toolResult.content` 投影后为带缩进的字符串，且 `formatToolResultContent` 对 `<tool_use_error>` 的剥离仍然生效。
- 服务端：在 Claude 历史 provider 的既有测试中加一条断言——content 为块数组时输出含换行缩进，且 `toolResultMap` 配对结果不变。
- 兼容性：为 `TodoRead` 的 `startsWith('[')` 与 `Default` 的 MCP 拆包各加一条「缩进输入」用例。

### 6.3 导出等价测试

在 `transcriptExport.test.tsx` 补一条：失败的非 Bash 工具在导出文档中**包含完整报错正文**（验证 L1 的 `isExporting` 接入）。这是本次唯一会改变导出内容的改动，必须显式覆盖。

### 6.4 既有回归

`toolGrouping.test.ts`、`liveSubagentGrouping.test.ts`、`useChatMessages.test.ts`、`transcriptExport.test.tsx` 必须全绿。其中 `toolGrouping` 关注 `getToolInputPreview` 是否受 L3 影响（当前它走 `config.getValue`/`title`，不读 `toolResult.content`，预期不受影响，但需实测）。

### 6.5 人工验收矩阵

| 场景 | 入口 | 期望 |
| --- | --- | --- |
| 多行命令（Bash） | 折叠 + 展开 + 导出 | 命令行始终一行；可横向滚动到行尾；输出区仍正常换行 |
| 多行命令（PowerShell） | 屏幕 + 导出 | 同上 |
| 工具报错（非 Bash） | 屏幕展开 | 行结构与原文一致；导出同样完整 |
| Plan 卡片 | 屏幕 + 导出 | prompt 内单换行可见；列表/加粗仍渲染 |
| Subagent 结果 | 面板内 | 同 Plan |
| `TaskList` 混合 payload | 屏幕展开 | 原文回退，无丢行 |
| 长 diff 行 | 编辑类工具展开 | 换行或可横向滚动，不裁切 |
| 待办含换行 | 验证清单展开 | 换行可见 |
| 长会话滚动/折叠 | 全部 | 无新增布局跳动、无横向滚动条出现在聊天区 |

---

## 7. 实施顺序

| 阶段 | 内容 | 理由 |
| --- | --- | --- |
| 阶段 0 | 为 L0、L1、L4 各写一个**失败**测试 | L0 是用户明确要求；L1/L4 是信息丢失型缺陷。先固化现象 |
| 阶段 1 | **L0（命令单行化）** | 用户明确要求，且改动集中（`BashCommandDisplay` + `OneLineDisplay` + `wrapText` 清理），独立发布便于验证观感 |
| 阶段 2 | L1 + L2（同一根因：Markdown `breaks`） | 同一发布，避免「报错修了但 Plan 没修」的中间态 |
| 阶段 3 | L4（丢行） | 信息丢失，优先级高于观感类问题 |
| 阶段 4 | L3（含服务端） | 唯一跨前后端改动，单独发布便于回滚 |
| 阶段 5 | L5 + L6（纯 CSS） | 低风险，可合并为一个发布 |
| 阶段 6 | 文档同步（`06-tool-view.md` + `tools/README.md`）+ 人工验收矩阵 | 收尾 |

---

## 8. 风险、监控与回滚

| 风险 | 触发条件 | 缓解 |
| --- | --- | --- |
| `breaks` 造成过度断行 | 模型在 Markdown 段落里大量使用软换行 | 只对工具卡片显式传 `breaks`；`Markdown` 默认值不变，助手正文不受影响 |
| 报错改纯文本后丢失格式 | 报错内含 Markdown 语法 | 接受；运行时文本保真优先。如出现具体反例，再对单个调用点回退为 `breaks` 方案 |
| JSON 缩进破坏下游解析 | 某处依赖单行 JSON | §4.3 第 4 条的前置校验 + §6.2 契约测试；缩进改动集中在 3 个点，回滚成本低 |
| JSON 缩进放大 DOM/导出体积 | 超大结构化 result | 服务端已有 oversized output 截断；把体积变化记为观察指标而非门槛 |
| 任务列表回退过于激进 | 合法列表混入了备注行 | `ignore 空行` 已排除最常见误判；如需更细粒度，走路线 C（后续可选） |
| `overflow-x-auto` 引入 diff 卡片内滚动条 | 长行场景 | 优先走换行（`break-words`），滚动仅覆盖不可断 token 的极端场景 |
| 命令行的横向滚动条被误读为「布局坏了」 | 长命令场景 | 折叠/展开行为一致；滚动条仅在超宽时出现，macOS 覆盖式滚动条默认不占位。人工验收矩阵显式覆盖 |
| 命令区滚动与「点击展开输出」冲突 | 命令区位于可点击头部内 | 命令区滚轮/触控板滚动不触发点击；点击仍冒泡到父 div 切换展开，行为不变。若实测冲突，退路是只对命令区 `stopPropagation` 的滚动事件，不动点击 |
| 删除 `wrapText` 影响未知调用方 | 有仓外/未检索到的调用 | 已全仓检索：仅 `toolConfigs.ts`（2 处赋值）、`OneLineDisplay.tsx`（4 处）、`ToolRenderer.tsx`（1 处）、`README.md`（1 处）；无测试引用。删除前再跑一次 `grep -rn wrapText src/` 确认 |
| 导出内容变化 | L1 接入 `isExporting`、L0 影响命令行 | §6.3 专项测试；这是预期的行为修正，需在发布说明中写明 |

**监控**：本次改动不涉及运行时埋点。以「既有测试全绿 + 人工验收矩阵通过」为发布门槛。

**回滚**：分阶段发布，每个阶段独立可回滚。L3 因跨前后端，回滚时需同时回滚服务端与客户端两处。

---

## 9. 验收结论模板

```
条目覆盖：L0 / L1 / L2 / L3 / L4 / L5 / L6  ✔/✘
命令单行：Bash 折叠 ✔/✘   Bash 展开 ✔/✘   PowerShell ✔/✘   导出 ✔/✘
wrapText 清理：无残留引用 ✔/✘
新增测试：toolCommandSingleLine.test.tsx __ 条 / toolContentLineBreaks.test.tsx __ 条
导出等价：包含完整报错正文 ✔/✘
回归：toolGrouping / liveSubagentGrouping / useChatMessages / transcriptExport  ✔/✘
人工矩阵（§6.5）通过：__ / 9
未处理（记录在案）：Grep/Glob 匹配行、TodoRead 空输出、codex/dsh join 分隔符、ZCode 的 Patch/Tool 别名
```

---

## 10. 引用复核记录

本轮（2026-09-13）在 `590b88f1` 上重新核对了全文的 `file:line` 引用。基线从 `353ab751` 前进了 7 个提交，其中与本文相关的有：

| 提交 | 说明 | 对本文的影响 |
| --- | --- | --- |
| `7bbe7104` `42c00853` | `feat(chat): 丰富工具活动分组摘要` | `toolGrouping.ts` 新增 `summarizeToolGroupActivity`（`:91`）与 `activitySummary`；`ToolGroupContainer` 预览行从 `:155` 移到 `:159`。**已修正引用** |
| `57d4ee69` | 集成 ZCode provider | `toolConfigs.ts` 未新增工具键，`L0`–`L6` 工具范围不变；新增两条相邻观察（§1.4） |
| `9441c27d` | 稳定 transcript 滚动交接 | 未触及 `ChatMessagesPane.tsx:216` 的 `overflow-x-hidden`；L5 结论不变 |
| `1dc2b0a9` `590b88f1` | Claude 流快照去重、dsh 品牌蓝 | 与工具渲染无关 |

核对结果：

- **未变**：`ToolErrorDisplay.tsx:83`、`MarkdownContent.tsx:22`、`Markdown.tsx:268, 283`、`ToolRenderer.tsx:142-145, 193, 259`、`PlanDisplay.tsx:87`、`SubagentPanel.tsx:279`、`useChatMessages.ts:10`、`TaskListContent.tsx:15-37, 79-85, 115`、`ToolDiffViewer.tsx:45, 79`、`Queue.tsx:107-114`、`QuestionAnswerContent.tsx:96-98, 162-170`、`BashCommandDisplay.tsx:112, 145-155, 189, 206-210`、`OneLineDisplay.tsx:19, 48, 106, 185`、`toolConfigs.ts:16, 122, 148, 703, 719`、`CollapsibleDisplay.tsx:78`、`CollapsibleSection.tsx:61, 84`、`ToolGroupContainer.tsx:97, 126, 129, 131`、`index.css:611-613, 635-637, 811-815, 818-823, 826-832`、`ChatMessagesPane.tsx:216`
- **已修正**：`ToolGroupContainer.tsx` 预览 `155 → 159`；`index.css` 表格滚动规则 `845-871 → 847-871`；`SubagentPanel.tsx` JSON 序列化 `66 → 68`；`claude-sessions.provider.ts` `1112-1113 → 1113`；`MessageComponent.tsx` 工具分支区间 `272-279/280-295 → 273-281/282-297`、Bash 排除 `271 → 273`；测试目录 `tools/tests/ → tests/`
- **工作区状态**：复核时有未提交改动，集中在 `settings/**`、`shared/types.ts`、`useChatRealtimeHandlers.ts` 与两个流式测试，**均不涉及本文引用的工具渲染文件**，故引用仍然有效

> 若后续再有提交，请以本节的核对清单为准重新跑一遍 `grep`，不要直接信任本文行号。

---

## 审阅批注

> 本节供多 harness 交叉审阅使用。请补充：编号（如 `L1-1`）、严重级别、证据（文件:行号）、建议。

### Claude

（待补充）

### WorkBuddy

（待补充）

### Pi

（待补充）

### 牵头结论

（待补充）
