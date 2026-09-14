# 工具换行漏项修复方案（G1–G3，评审稿）

> **状态**：**G1–G3 已实施并验证**（见 §12 实施记录）。审阅已完成，结论见文末「牵头结论」。
> **基线**：L0–L6 已提交为 `66f4ac03`（`fix(chat): 保留工具内容的行结构`），本方案的 `文件:行号` 以该提交为准；G1–G3 的改动在其上。
> **承接**：`docs/research/tool-content-linebreak-rendering-review-plan.md`（L0–L6 已实施并验证）。
> **范围**：L0–L6 落地后的补查中发现的 **3 个漏项（G1–G3）** + **1 个决策项（G4）**。

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
- [11. 待决策事项](#11-待决策事项)
- [审阅批注](#审阅批注)

---

## 0. 结论先行

补查后确认 **3 个真实缺陷**，全部用**真实构建产物 CSS + Playwright** 实测过（探针脚本已删除，数据见下文）：

| ID | 问题 | 影响面 | 推荐路线 | 风险 |
| --- | --- | --- | --- | --- |
| **G1** | `AskUserQuestion` **交互面板**的问题正文 / 选项标签 / 选项描述没有任何 whitespace 类，换行被折叠成空格 | 用户回答模型提问时的面板（composer 区） | 加 `whitespace-pre-wrap break-words`（3 处） | 极低 |
| **G2** | 纯 JSON 回复块的 `whitespace-pre` 是**死类**：被全局 `!important` 压掉，实测仍是 `pre-wrap` + `break-all` | 助手回复的纯 JSON 内容 | 改用标记类，让「不换行 + 横向滚动」真正生效 | 低 |
| **G3** | 全局 `.chat-message pre, .chat-message code` 上的 `word-break: break-all` 让**未被豁免的 `<pre>`** 与**全部行内 `<code>`** 里作者写的 `break-words` 空转，长 token 一律从中间劈开 | 6 处 `<pre>`（code 参数、raw params、任务兜底原文、Bash 折叠预览）+ 助手/用户正文的行内 `<code>`（fenced code block 已被豁免，不在内） | 把该声明改为 `word-break: normal` | 中（全站排版基线） |

**为什么值得单独开一轮**：G1 与上一轮 L6 是同一个工具的**另一张脸**，L6 修了问答卡却漏了交互面板；G2 与 L0 是**同一个 CSS 陷阱**，L0 躲过了却留下这一处；G3 是「长 token 被劈成两半」的**全局根因**——L0/L5 只是在两个局部绕开了它。

**G4（PowerShell 成功时输出完全不显示）** 属于行为缺口而非换行缺陷，需要产品决策，默认**不进**本轮范围（见 §3.4）。

---

## 1. 背景与已确认现状

### 1.1 上一轮为什么漏了这三处（方法论复盘）

上一轮的检索范围是「工具卡片」：`src/modules/chat/tools/**` + `ToolRenderer` 的 `contentType` 分支。这个范围漏掉了三层：

1. **同一个工具的第二张脸**：`AskUserQuestion` 有两套 UI——`contentType: 'question-answer'` 走 `QuestionAnswerContent`（transcript 内，L6 已修），以及交互面板 `AskUserQuestionPanel`（composer 区，**不经 `ToolRenderer`、不在 `.chat-message` 内**）。只修前者，后者漏网。
2. **全局 CSS 的作用域比「工具卡」大**：`index.css:818-823` 的 `.chat-message pre, .chat-message code` 作用于**整个消息容器**，助手回复的纯 JSON 块也在其中（G2）。
3. **只按「表面」逐个修，没有审「全局声明给未标记元素的默认值」**：G3 不在任何单个组件里，而在全局规则与被它命中的 6 处 `<pre>` 之间。

> **本节的意义**：这三层是**可复用的检索清单**。后续类似改动应按「同一数据的全部渲染出口 × 全局 CSS 命中集合」双向穷举，而不是按组件目录遍历。

### 1.2 G1 · AskUserQuestion 交互面板：问题与选项的换行被吞

**证据（静态）**

| 元素 | 位置 | 现有类名 |
| --- | --- | --- |
| 问题正文 | `AskUserQuestionPanel.tsx:221`（`{q.question}` 在 `:222`） | `text-[14px] font-medium leading-snug …` |
| 选项标签 | `AskUserQuestionPanel.tsx:255`（`{opt.label}` 在 `:260`） | `text-[13px] leading-tight …` |
| 选项描述 | `AskUserQuestionPanel.tsx:263`（`{opt.description}` 在 `:268`） | `text-[11px] leading-snug …` |
| （次要）问题分组徽章 | `AskUserQuestionPanel.tsx:186`（`{q.header}` 在 `:187`） | `text-[9px] font-semibold uppercase …` |

**祖先链无任何 whitespace 声明**：面板由 `PermissionRequestsBanner.tsx:51-59` 通过 `getPermissionPanel` 直接渲染，注册点在同文件 `:18`；`PermissionRequestsBanner` 挂在 `ChatComposer.tsx:287` 的 `<div className="mx-auto mb-3 max-w-[54.25rem]">` 内 —— 整条链路都在 `.chat-message` **之外**，因此拿不到 `.chat-message pre/code` 的全局规则，默认就是 `white-space: normal`。

**证据（实测）**：同一段含 `\n` 的文字，按元素**实际字号/行高**测量：

| 元素（实际类名） | 无 whitespace 类 | 加 `whitespace-pre-wrap` |
| --- | --- | --- |
| 问题正文（`text-[14px] leading-snug`，行高 19.25px） | **19.25px（1 行）** | **38.5px（2 行）** |
| 选项标签（`text-[13px] leading-tight`，行高 16.25px） | **16.25px（1 行）** | **32.5px（2 行）** |

> **实施修正（2026-09-14）**：本节初稿写「24px / 48px」。那是**未带字号类**（浏览器默认 16px × `line-height: normal` ≈ 24px）的测量值——探针漏了元素的实际类名，量的是「一个 16px 的裸元素」而非面板文字。两轮审阅（Claude G1-1、Codex G1-1）独立复现了上表数字。结论（「换行被折叠成 1 行」）不变，数字已按元素实际条件改写。

**为什么这是缺陷而不是「数据本来就单行」**：同一个 `questions[]` payload 的**另一张脸**（`QuestionAnswerContent.tsx:96, 162, 166`）在 L6 已被加上 `whitespace-pre-wrap break-words` —— 团队已经承认这些字段会含换行。同一份数据在问答卡里保留换行、在交互面板里被折叠，是不一致。

### 1.3 G2 · 纯 JSON 回复块：`whitespace-pre` 是死类

**证据（静态）**：`MessageComponent.tsx:370-372`

```tsx
<pre className="overflow-x-auto p-4">
  <code className="block whitespace-pre font-mono text-sm text-foreground">
```

该块由 `MessageComponent.tsx:353-369` 的「内容是纯 JSON」分支产生（`JSON.stringify(parsed, null, 2)` 后落进 `<code>`），根容器在 `:113` 带 `chat-message` 类。

**证据（实测，真实构建产物 CSS）**：该 `<code>` 的计算值为

```
white-space: pre-wrap     ← 期望 pre，被压掉
word-break: break-all
overflow-wrap: break-word
```

原因与 L0 记录的完全同源：`index.css:818-823` 的 `.chat-message code { white-space: pre-wrap !important; … }` 是 `!important`，属性和类名都拦不住；外层 `<pre>` 的 `overflow-x-auto`（`:370`）因此是空转。

**影响**：作者的本意是「JSON 带缩进、不换行、超宽横向滚动」——一个可滚动查看器。实际行为是「自动换行 + 长字符串值被 `break-all` 从中间劈开」。注意 L3 已经保证 JSON 是 pretty 的，**缩进本身正常**，受影响的只有超过容器宽的**行**。

### 1.4 G3 · 全局 `word-break: break-all` 让未豁免的 `<pre>` 与行内 `<code>` 的 `break-words` 空转

**证据（静态）**：`index.css:817-823`

```css
/* Force wrap long URLs and code */
.chat-message pre,
.chat-message code {
  white-space: pre-wrap !important;
  word-break: break-all;      /* :821 —— 问题所在 */
  overflow-wrap: break-word;  /* :822 */
}
```

**证据（实测，真实构建产物 CSS + 真实浏览器）**

| 被测元素 | 计算 `word-break` | 是否受影响 |
| --- | --- | --- |
| `.chat-message pre.break-words` | **`break-all`** ← 作者写的是 `break-words`（`overflow-wrap: break-word`），意图是按词边界换行 | **是** |
| `.chat-message code`（行内） | **`break-all`** ← 同一个坑（见下文「受影响表面 B」） | **是** |
| `.chat-message div.whitespace-pre-wrap.break-words` | `normal` ← `div` 面正常 | 否（对照组） |
| `.chat-message .markdown-code-block pre` | `normal` ← 已被更高特异性的 `(0,2,1)` 规则豁免（`index.css:826-832`） | 否 |
| `.chat-message .markdown-code-block pre code` | `normal` ← `index.css:834-839` 的 `word-break: inherit` 传下来 | 否 |

`word-break: break-all` 的语义是「为填满行宽，允许在任意字符间断行」。实测同一段文字在 120px 宽容器里的断行位置：

```
当前（break-all）：  "aaaaaaaaaa b"    /  "bbbbbbbbb"      ← 在词中间断开
改为 normal 后：     "aaaaaaaaaa "     /  "bbbbbbbbbb"     ← 在空格处断行
```

即：`bbbbbbbbbb` 整词本可以整体挪到第二行，`break-all` 仍然把它劈开。**这正是 L0 从 Bash 输出里删掉 `break-all` 的理由**，但当时只改了 Bash 一处；全局声明仍对其它表面生效。

> **实施修正（2026-09-14）**：本节初稿把 break-all 的断点写成 `"aaaaaaaaaa bbbbb"` / `"bbbbb"`。按本节声明的条件（120px 容器）复测得到的是 `"aaaaaaaaaa b"` / `"bbbbbbbbb"`——**精确断点依赖字体与容器宽度，初稿的数值不可复现**。两轮审阅均指出此点（Claude G3-2、Codex G3-1）。**结论与所有指标一律只断言行数与「整词是否下移」，不断言字符位置**（§2.2 已同步）。

**受影响表面 A：6 处 `<pre>`**（全部写了 `break-words` 或至少期望按词换行，实测全部拿到 `break-all`）：

| 位置 | 内容 | 现有溢出处理 |
| --- | --- | --- |
| `TextContent.tsx:39` | `contentType: 'text'` + `format: 'code'`：`exec` 沙箱脚本、`Default` 入参 JSON、browser MCP 入参 | `overflow-hidden` |
| `CollapsibleDisplay.tsx:78` | raw params | `overflow-hidden` |
| `PlanDisplay.tsx:112` | raw params | `overflow-hidden` |
| `TaskListContent.tsx:129` | 任务列表解析失败时的兜底原文 | 无 |
| `TaskListContent.tsx:154` | 分段渲染里不匹配的备注原文块 | 无 |
| `BashCommandDisplay.tsx:194` | 折叠态 `errorPreview`（输出末 3 行） | 无 |

**受影响表面 B：行内 `<code>`（本轮审阅新增，初稿遗漏）**

初稿只枚举了 `<pre>`，漏了同一规则的另一半选择器——`.chat-message code`。`Markdown.tsx:103-105`（`shouldInline` 分支，判定见 `:99`）渲染的行内 code 同时带 `whitespace-pre-wrap break-words`，实测计算仍是 `word-break: break-all`。

| 位置 | 内容 | 实测 |
| --- | --- | --- |
| `Markdown.tsx:103-105` | 助手/用户正文的行内 code（路径、URL、hash、命令片段） | `white-space: pre-wrap`、`word-break: break-all` |

**覆盖面比看起来大**：用户消息正文同样经 `<Markdown>`（`MessageComponent.tsx:131-136`，根容器 `:113` 带 `chat-message` 类），流式回复经 `StreamingMarkdown.tsx` → `MarkdownBody` 复用同一渲染器。因此**凡 `.chat-message` 内的 markdown 正文**都在这一表面内。

**fenced code block 不在内**（初稿「所有 `<pre>`」的措辞过宽）：`Markdown.tsx:127` 的 `.markdown-code-block` 容器内由 `SyntaxHighlighter` 生成 `<pre><code>`，被 `index.css:826-832`（`.chat-message .markdown-code-block pre`，特异性 `(0,2,1)`）与 `:834-839`（`pre code`，`word-break: inherit`）显式豁免为 `normal`——实测双引擎确为 `normal`。本方案初稿与审阅批注均修正此措辞，避免后续按「所有 `<pre>`」穷举时把 fenced block 误计为 G3 面。

**为什么不一致更刺眼**：`div` 面（`ToolErrorDisplay.tsx:95`、`SubagentPanel.tsx:98`、`Queue.tsx:111`、`QuestionAnswerContent.tsx:96`）拿到的是 `word-break: normal` + `break-words`，所以**报错正文比代码块/参数块换行更干净**——同一个产品里两套断行规则。

### 1.5 相邻但不在本方案范围

| ID | 问题 | 位置 | 处置 |
| --- | --- | --- | --- |
| **G4** | PowerShell **成功时输出完全不显示** | `toolConfigs.ts:138-158`（`one-line` + `result.hideOnSuccess`）；`MessageComponent.tsx:273` 只特判 `Bash`；`ToolRenderer.tsx:145` 只有 `Bash` 分支、`:366` 对 `type:'special'` 返回 `null` | **决策项**，见 §3.4 |
| **G5** | `TextContent.tsx:31` 的 `format: 'json'` 分支是**死代码**（全仓无调用方只传 `'code'`/`'plain'`），且实测同样被 `pre-wrap + break-all` 吃掉，`overflow-x-auto` 空转 | `TextContent.tsx:20-35` | 低优先，可顺手清理 |
| **G6** | `FileListContent` 文件名无 `truncate`/`min-w-0`，超长文件名溢出按钮 | `FileListContent.tsx:32-48` | 低优先 |
| **G7** | 斜杠命令结果弹窗 4 处 `break-all`（模型 id、路径） | `CommandResultModal.tsx:116, 324, 386, 494`（`:372` 另有 `break-words`） | 低优先（不在 transcript 内） |
| **G9** | composer 内「View tool input」兜底 `<pre>` 有 `whitespace-pre-wrap` 但**无 `break-words`**；超长路径/URL 只能靠 `overflow-auto` 滚动（与 transcript 的 `CollapsibleDisplay.tsx:78`、`PlanDisplay.tsx:112` 是**同一份 raw params 的第三张脸**） | `PermissionRequestsBanner.tsx:100` | 低优先，登记（本轮审阅新增）——该处在 `.chat-message` **外**，不受全局规则影响，`whitespace-pre-wrap` 正常生效，故不是缺陷，只是策略不一致；顺手补 1 行亦可 |
| **G8** | Codex `toolInput` 是预序列化的紧凑 JSON，客户端对字符串原样透传 | `useChatMessages.ts:290`；上一份方案 §1.4 | 沿用上一轮结论，未处理 |

---

## 2. 目标、指标与非目标

### 2.1 目标

1. **G1**：`AskUserQuestion` 交互面板的问题与选项，内部换行结构与 payload 一致（首尾空白不计入）。
2. **G2**：纯 JSON 回复块真正拿到 `white-space: pre`，超宽行由横向滚动可达。
3. **G3**：`<pre>`/`<code>` 上作者声明的「按词边界换行」生效；长 token 仍可断行，但只在**放不下时**断。
4. **不引入行为回退**：6 处受影响 `<pre>` 在改动后**不得出现裁切或溢出**。

### 2.2 可验证指标

| 指标 | 期望值 | 验证方式 |
| --- | --- | --- |
| G1 问题正文行数 | 含 1 个内部 `\n` 时渲染 2 行 | jsdom 类令牌 + §6.4 目视 |
| G2 `<code>` 计算 `white-space` | `pre` | §6.2 真实浏览器 |
| G2 超宽行可滚 | `scrollWidth > clientWidth` | §6.2 |
| G3 `.chat-message pre` 计算 `word-break` | `normal` | §6.2 |
| G3 词边界断行 | `"aaaaaaaaaa bbbbbbbbbb"` 在 120px 容器**渲染 2 行**，且整词 `bbbbbbbbbb` 完整落在第 2 行（**不断言精确字符位置**——依赖字体度量，见 §1.4 实施修正） | §6.2 |
| G3 行内 `<code>` 计算 `word-break` | `normal`（当前为 `break-all`） | §6.2 |
| G3 fenced code block 仍豁免 | `.chat-message .markdown-code-block pre` 的 `white-space` 仍为 `pre`、`word-break` 仍为 `normal` | §6.2（防回归） |
| G3 **无溢出** | 400 字符无空格 token 的 `scrollWidth === clientWidth` | §6.2（已预验证，见下） |

> **G3 的关键预验证（已完成）**：把该声明改为 `normal` 后，`400` 字符无空格 token 在 120px 容器里 `scrollWidth === clientWidth === 120`，**没有溢出**。原因是 `index.css:822` 的 `overflow-wrap: break-word` 仍在（本次不动），它保证「一个词单独一行也放不下时允许内部断行」。**因此 G3 不需要给 6 处 `<pre>` 逐处补溢出保护**——这是与「初判需要 3~4 处配合修改」相反的结论，也是本方案选择路线 A 的主要依据。

### 2.3 非目标

- 不改 `<pre>` 的 `white-space`（除已标记的终端面 `tool-terminal-output` 与 diff 行 `tool-diff-row`）。内容面**继续换行**，这与 L1/L3/L4/L5/L6 的结论一致。
- 不引入「换行 / 不换行」用户开关（上一份方案 §11.4 已记为退路，非本轮）。
- 不重开 L0–L6 的任何结论。
- 不处理 G4–G8。

---

## 3. 候选路线与决策

### 3.1 G1：面板文本怎么保住换行

| 路线 | 做法 | 评价 |
| --- | --- | --- |
| **A（推荐）** | 给 3 处文本元素加 `whitespace-pre-wrap break-words` | 与 L6 对 `QuestionAnswerContent` 的做法**完全一致**；零新机制；改动 3 行 |
| B | 把问题/选项的渲染抽成与 `QuestionAnswerContent` 共用的子组件 | 消除「同一数据的两个实现」这一根因，但属于重构，超出本轮；且两者的视觉设计（面板是卡片式可交互、问答卡是只读列表）差异真实存在，强合并会带来条件分支 |
| C | 加全局规则命中面板 | 面板在 `.chat-message` 外，且全局规则已是本方案的病根（G3），不宜再加 |

**决策：A。** 同时把 B 记为长期改进方向（写进 §1.5/§11），不在本轮做。

理由补充：`whitespace-pre-wrap` 而非 `whitespace-pre`。面板文字是**内容**（问题、选项说明），不是终端面——窄屏必须能换行。

### 3.2 G2：让 JSON 块的 `pre` 真正生效

| 路线 | 做法 | 代价 |
| --- | --- | --- |
| **A（推荐）** | `:371` 的 `whitespace-pre` 换成标记类（复用 `tool-terminal-output`），与 `.chat-message code` 的 `!important` 正面相遇并胜出（`(0,2,0)` ＞ `(0,1,1)`） | 零 CSS 新增；但类名语义偏窄 |
| B | 删掉死类与 `overflow-x-auto`，**接受换行**（即现状） | 零风险，但等于承认「作者本意 + L3 的 pretty JSON」在当前渲染下只能换行；超宽行仍被 `break-all` 劈开 |
| C | 先把 `.tool-terminal-output` 重命名为中性名（如 `.preserve-source-lines`），再给两处共用 | 命名诚实，但要同步 `index.css`、`BashCommandDisplay.tsx:212`、`toolCommandSingleLine.test.tsx` 断言、两份文档 —— 纯改名，churn 不小 |

**决策：A，并保留现名。** 理由：① 行为收益与 C 相同，churn 只有 1 行；② 改名会动到上一轮刚验证过的测试断言与两份文档，属于为命名洁癖付回归风险。

**但在 §1.3/§4.2 明确记录命名债**：该标记类现在是「保留源行结构」的通用出口，服务于**终端输出**与**JSON 查看器**两个消费者；名称里的 `tool-` 会误导后来者以为只能给工具卡片用。若本次评审有人主张改名，接受在**同一轮**完成（避免两次触碰同一处）。

**与 G3 的交互**：路线 A 的标记类含 `overflow-wrap: normal`，意味着 JSON 块内超长字符串**不自动断行、靠横向滚动**。若同时实施 G3，两者不冲突（标记类特异性更高）。若只做 G3 不做 G2，JSON 块会退化为「按词换行 + 超长 token 兜底断行」——也可接受，但作者本意落空。**建议 G2 与 G3 同轮**。

### 3.3 G3：改全局声明 vs 就地覆盖

| 路线 | 做法 | 代价 / 风险 |
| --- | --- | --- |
| **A（推荐）** | `index.css:821` 的 `word-break: break-all` → `normal` | 1 行。影响面 = 所有 `.chat-message` 内的 `<pre>`/`<code>`。**已实测不引起溢出**（§2.2），因为 `overflow-wrap: break-word`（`:822`）仍在 |
| B | 不动全局，给 6 处 `<pre>` 各加更高特异性的 `word-break: normal` 覆盖 | 局部、但重复 6 次，且又开「标记类/`!important` 覆盖」先例；与 L5 评审中「避免依赖实现细节」的方向相反 |
| C | 不动，记为已知限制 | 需接受「同一产品里 `div` 面按词换行、`pre` 面劈词」的长期不一致 |

**决策：A。** 三条独立理由：

1. **这是作者本意的修复，不是新策略**：6 处 `<pre>` 里有 3 处显式写了 `break-words`，另外 3 处属于同类内容。全局声明让它们空转，等于 CSS 与源码意图相反。
2. **实测无溢出**（§2.2），代价被证伪。
3. **收敛方向一致**：上一轮把 Bash 输出与 diff 从「劈词」改成「保留源行结构」，本路线把其余内容面从「劈词」改成「按词换行」——同一个原则在不同表面上的正确取值。

**必须同时接受的三点**：

- `break-all` → `normal` 后，**超长 token 的断行位置不变**（仍会断，只是不再抢占本该留给整词的位置），因此**不会出现新裁切**；但**行的总数可能增加**（整词下移），长日志类的视觉高度会略增。
- `.chat-message` 已有 `hyphens: auto`（`index.css:814`）。本路线**不改变**连字符行为，但改动后「按词换行」会更容易走到连字符点；§6.4 需人工确认中英混排下没有出现意外连字符（属既有行为，不计为本轮回归）。
- 全局改动的回滚成本是 1 行（§8）。

### 3.4 G4：PowerShell 输出（决策项，默认不进本轮）

**现状**：`toolConfigs.ts:138-158` 把 PowerShell 配成 `one-line` 终端行 + `result: { hideOnSuccess: true, type: 'special' }`；`MessageComponent.tsx:273` 的结果区只排除 `Bash`；`ToolRenderer` 既无 `PowerShell` 分支（`Bash` 的特判在 `:145`），也无 `type: 'special'` 分支（`:366` 返回 `null`）。

**净结果**：成功的 PowerShell 调用**只显示命令**，输出被丢弃；失败的 PowerShell 走 `ToolErrorDisplay`（因此失败反而看得到输出）。而 `toolConfigs.ts:135-137` 的注释写着「It is the same interaction as Bash」——与实际不符。

| 路线 | 做法 | 代价 / 风险 |
| --- | --- | --- |
| A | 把 `ToolRenderer.tsx:145` 与 `MessageComponent.tsx:273` 的 `toolName === 'Bash'` 放宽为 `Bash || PowerShell`，输出复用 `BashCommandDisplay` | **不是「2 处条件」**（初稿低估，审阅修正）：`shouldHideToolResult`（`toolConfigs.ts:850-858`）在 `toolResult` 非 error 且 `hideOnSuccess` 时会先返回 true，故还须调整 `toolConfigs.ts:154-157` 的 `hideOnSuccess` 或 `:273` 的排除逻辑；且**本机 macOS 无法产出 Windows 会话**，只能靠构造数据验证；需先确认 Claude 的 PowerShell `toolResult.content` 语义与 Bash 一致 |
| B | 维持隐藏，但修正 `toolConfigs.ts:135-137` 的误导性注释，并把「PowerShell 只显示命令、不显示输出」写入 `06-tool-view.md` | 零行为风险；承认现状是产品选择 |
| C | 维持隐藏且不改注释 | 不推荐：注释与行为矛盾会持续误导后续维护者 |

**建议：B**（本轮），把 A 记为待评估——因为要正确实现 A，需要先拿到一份真实的 Windows PowerShell 会话（或至少确认其 `toolResult` 形状），否则等于盲改。

---

## 4. 详细设计

### 4.1 G1 · 面板文本保住内部换行

三处各加两个类，与 `QuestionAnswerContent.tsx:96` 的写法保持逐字一致：

| 位置 | 改动 |
| --- | --- |
| `AskUserQuestionPanel.tsx:221` | `text-[14px] font-medium leading-snug …` → 前置 `whitespace-pre-wrap break-words ` |
| `AskUserQuestionPanel.tsx:255` | `text-[13px] leading-tight …` → 前置 `whitespace-pre-wrap break-words ` |
| `AskUserQuestionPanel.tsx:263` | `text-[11px] leading-snug …` → 前置 `whitespace-pre-wrap break-words ` |

**次要项**：`:186` 的 `{q.header}` 徽章同样是外部字符串。徽章是 `uppercase tracking-wider text-[9px]` 的单行标签，含换行的概率极低；**本轮不改**，记入 §1.5（避免为假想数据引入边界行为）。

**为什么不用 `whitespace-pre`**：面板文字是内容；窄屏必须能换行。这与终端面（命令、输出、diff）的"保留源行"是相反取值，理由与 L0–L6 一致：**终端面不换行、内容面换行**。

**`break-words` 的作用**：面板里最长的 token 是选项标签，可能是路径或命令片段。`break-words`（`overflow-wrap: break-word`）保证它放不下时仍能断行，不会把卡片撑破。

### 4.2 G2 · 纯 JSON 块改用标记类

```tsx
// 之前
<pre className="overflow-x-auto p-4">
  <code className="block whitespace-pre font-mono text-sm text-foreground">

// 之后
<pre className="overflow-x-auto p-4">
  <code className="block tool-terminal-output font-mono text-sm text-foreground">
```

要点：

1. **类必须加在 `<code>` 上**，不能只加在父 `<pre>` 上。`white-space` / `word-break` / `overflow-wrap` 虽然都是可继承属性，但 `.chat-message code { … !important }` 直接命中的是 `<code>` 本身，继承值必败。
2. `.chat-message .tool-terminal-output`（`index.css:849-853`）= `(0,2,0)` ＞ `.chat-message code` = `(0,1,1)`，**无需新增任何 CSS**。
3. 该规则含 `overflow-wrap: normal`，即 JSON 中的超长字符串**不断行、靠外层 `overflow-x-auto`（`:370`）滚动**——正是"查看器"的本意。
4. `whitespace-pre` 死类**删除**，不要保留。

### 4.3 G3 · 全局断行规则

```css
/* index.css:818-823 */
.chat-message pre,
.chat-message code {
  white-space: pre-wrap !important;
  word-break: normal;          /* 由 break-all 改来 */
  overflow-wrap: break-word;   /* 不动 */
}
```

同时把 `:817` 的注释从 `/* Force wrap long URLs and code */` 改成能表达新语义的说明，例如：

```css
/* Wrap at word boundaries; a single token longer than the line still breaks
   via `overflow-wrap`, so nothing is clipped or overflows. `break-all` used to
   sit here and split words mid-token even when the whole word would have fit
   on the next line -- the same defect the terminal output and diff surfaces
   were fixed for individually. */
```

**这一条声明同时修两个表面**：它命中的是 `.chat-message pre` **和** `.chat-message code`，所以 §1.4 表面 A（6 处 `<pre>`）与表面 B（行内 `<code>`，含正文与流式回复）一起被修正——无需为行内 code 单独改动。这也是路线 A 优于路线 B 的一个新论据：就地覆盖要改 6 处，且**根本覆盖不到行内 code**（那 6 处都是 `<pre>`）。

**不做**的事：不改 6 处 `<pre>` 的类名（已实测不需要）；不给它们补 `overflow-x-auto`（会把"内容面"变成第二个滚动面，与 §2.3 冲突）；不动 fenced code block（已被 `index.css:826-839` 豁免，§6.2 有防回归断言）。

---

## 5. 文件级改动清单

| # | 文件 | 位置 | 改动 | 归属 |
| --- | --- | --- | --- | --- |
| 1 | `src/modules/chat/tools/InteractiveRenderers/AskUserQuestionPanel.tsx` | `:221` | 加 `whitespace-pre-wrap break-words` | G1 |
| 2 | 同上 | `:255` | 加 `whitespace-pre-wrap break-words` | G1 |
| 3 | 同上 | `:263` | 加 `whitespace-pre-wrap break-words` | G1 |
| 4 | `src/modules/chat/transcript/MessageComponent.tsx` | `:371` | `whitespace-pre` → `tool-terminal-output`（删死类） | G2 |
| 5 | `src/index.css` | `:821` | `word-break: break-all` → `normal` | G3 |
| 6 | `src/index.css` | `:817` | 更新注释以表达新语义 | G3 |
| 7 | `src/modules/chat/tests/toolWhitespaceGap.test.tsx` | 新增 | G1 + G2 的 jsdom 断言 | G1/G2 |
| 8 | `tests/transcript-layout/transcript-layout.spec.ts` + `fixture.tsx` | 新增场景 | G2/G3 的计算样式断言（真实浏览器） | G2/G3 |
| 9 | `docs/architecture/06-tool-view.md` | 相关段 | 同步「断行取值」表：终端面 / 内容面 / JSON 查看器的取值与理由 | 全部 |
| 10 | `docs/research/tool-content-linebreak-rendering-review-plan.md` | §11.6（新增） | 记录本轮与 L0–L6 的关系（G2 补 L0 的同源漏点、G3 是 L0/L5 的全局根因） | 全部 |

**预计代码改动量**：4 个逻辑行（3 处类名 + 1 处 CSS 声明）+ 1 处注释 + 测试与文档。

---

## 6. 测试方案

### 6.1 jsdom 渲染测试（新增 `src/modules/chat/tests/toolWhitespaceGap.test.tsx`）

沿用既有工具的类令牌断言约定（jsdom 无 CSS 引擎，**不断言计算值**）：

| 用例 | 断言 |
| --- | --- |
| 面板问题含 `\n` | 问题 `<p>` 的 `className` 含 `whitespace-pre-wrap` 与 `break-words` |
| 面板选项标签含 `\n` | 标签 `<div>` 同上 |
| 面板选项描述含 `\n` | 描述 `<div>` 同上 |
| 面板无换行内容 | 三个元素仍带上述类（不因数据而变分支） |
| 纯 JSON 回复块 | `<code>` 含 `tool-terminal-output`；**不含** `whitespace-pre` |
| 纯 JSON 回复块外层 | 父 `<pre>` 仍含 `overflow-x-auto` |
| 行内 code（助手正文） | `<code>` 含 `whitespace-pre-wrap` 与 `break-words`（类令牌层，证不改动其声明） |

渲染方式：面板用 `@testing-library/react` 的 `render`（`useState`/`useEffect`/`requestAnimationFrame` 均需真实渲染）。**无需 i18n Provider**：`vitest.setup.ts` 只注册了 `cleanup` 与 `matchMedia`，并未初始化 i18n；而 `messageStreamEnd.test.tsx:34-42` 渲染的 `MessageComponent` 自身就调用 `useTranslation`/`t()`（`MessageComponent.tsx:208`）且无任何 Provider 包裹，测试为绿 —— 说明该环境下 `useTranslation` 可用。消息用例直接照抄该写法：`MessageComponent` + `UiPreferencesProvider`，`message.content` 传纯 JSON 字符串。

**限制**：jsdom 不会应用 `index.css` 的层叠，所以这两个用例只能证明「类被正确挂上」，不能证明「计算值正确」。计算值留给 §6.2。

### 6.2 真实浏览器断言（`tests/transcript-layout/`，`npm run test:transcript`）

该 harness 已在真实 Chromium/WebKit 里 `import '@/index.css'`（`fixture.tsx:5`），是唯一能验证全局 CSS 层叠结果的地方。

| 场景 | 断言 |
| --- | --- |
| G3 断行值 | `.chat-message pre` 的 `getComputedStyle().wordBreak === 'normal'` |
| G3 词边界断行 | 120px 容器内 `"aaaaaaaaaa bbbbbbbbbb"` 断为 `"aaaaaaaaaa"` / `"bbbbbbbbbb"`（用 `Range` 逐字符取 `top` 分行） |
| G3 无溢出 | 400 字符无空格 token：`scrollWidth === clientWidth` |
| G2 计算值 | 纯 JSON 回复块的 `<code>`：`whiteSpace === 'pre'`，且超宽时 `scrollWidth > clientWidth` |
| G3 行内 code | `.chat-message code`（非 `pre`）的 `getComputedStyle().wordBreak === 'normal'`；改动前为 `break-all` |
| G3 fenced block 未回归 | `.chat-message .markdown-code-block pre` 仍为 `white-space: pre`、`word-break: normal` |
| G2+G3 互不干扰 | 同一页面内 D1 断言仍成立（标记类赢过 `!important`） |

> 若评审认为「把计算样式断言塞进以滚动几何为职责的 harness」不合适，**退路**是在 `src/` 下加一个读 `src/index.css` 文本、正则取 `.chat-message pre` 块并断言 `word-break: normal` 的守卫测试（抑制回归）。仓库目前**没有**客户端读源文件做断言的先例（仅 `server/shared/tests/claude-cli-path.test.ts` 有），因此作为次选。

### 6.3 既有回归

| 套件 | 期望 |
| --- | --- |
| `npm run test:client` | 全绿（基线 73 文件 / 523 用例 + 本次新增） |
| `npm test` | 与既有基线一致（本机存在 9 条与本次改动无关的预置失败，见项目记忆） |
| `npm run test:transcript` | 全绿（含新增场景） |
| `npm run typecheck` | 干净 |
| `npm run lint` | 0 error；warning 数与基线一致；**同时充当 UTF-8 完整性检查**（本仓注释含 em dash，历史上被编辑工具破坏过） |
| 编码校验 | 所有改动文件 `file -b` 为 `UTF-8 text` / `Unicode text, UTF-8` |

### 6.4 人工验收矩阵

| # | 场景 | 期望 |
| --- | --- | --- |
| 1 | 触发一次 `AskUserQuestion`，问题含 1 个内部换行 | 面板里换行可见（不折叠成空格） |
| 2 | 同上，某选项的 `description` 含换行 | 描述换行可见 |
| 3 | 长选项标签（含路径） | 不撑破卡片；按词换行 |
| 4 | 让助手回复一段纯 JSON | 带 2 空格缩进；**不换行**；超宽行可横向滚动 |
| 5 | 打开一个 `exec`/`Default` 工具的 raw params（长路径） | 在词边界换行；整词优先下移 |
| 6 | 展开一个解析失败的任务列表（兜底原文） | 同上；无裁切 |
| 7 | 展开一个失败的 Bash（折叠态 `errorPreview`） | 同 5；3 行预览仍换行 |
| 8 | 中英混排的长段落 | 无意外连字符（`hyphens: auto` 既有行为，只确认未恶化） |
| 9 | 窄屏（≤768px）重复 1–6 | 无横向溢出页面的情况 |
| 10 | 导出 HTML / Markdown | **断行规则**与屏幕态一致（导出复用活动文档样式表，见上一份方案 §11.4 记录）；不要求不同可用宽度下逐行像素相同 |
| 11 | 助手正文里一段含长 URL/路径的**行内 code** | 在词边界断行、不劈词、不溢出；窄屏同样 |
| 12 | 含长 token 的 **markdown 表格** cell | 不新增横向溢出（cell 长 token 由 `.chat-message` 的 `overflow-wrap: break-word`，`index.css:813` 兜底；移动端表格另有 `min-width: 36rem` + `overflow-x`） |
| 13 | 一个 **fenced code block**（含长行） | 行为与改动前完全一致：仍 `white-space: pre` + 块内横向滚动，不得因 G3 变成换行 |

---

## 7. 实施顺序

| 阶段 | 内容 | 理由 |
| --- | --- | --- |
| 1 | G1（3 处类名）+ `06-tool-view.md` 同步 | 独立、零依赖、可单独验收 |
| 2 | G2（1 处类名）| 与 G3 有交互，先落地再验 G3 |
| 3 | G3（1 条声明 + 注释）| **必须与 G2 同批验证**：两者都作用于 `.chat-message` 内的 `<pre>`/`<code>`，分两次验会重复排查同一组回归 |
| 4 | 测试（§6.1 / §6.2）+ 全量回归 | |
| 5 | 文档（`06-tool-view.md`、上一份方案 §11.6） | |

**发布单位建议**：阶段 1 一个提交；阶段 2+3 一个提交（G2/G3 互相影响，拆开会产生"改了 G3 但 JSON 块行为仍错"的中间态）。

---

## 8. 风险、监控与回滚

| 风险 | 概率 | 影响 | 缓解 | 回滚 |
| --- | --- | --- | --- | --- |
| G3 使某些 `<pre>` 或行内 `<code>` 出现裁切/溢出 | 低（已实测无溢出） | 内容不可见 | §6.2 的"无溢出"断言覆盖 400 字符 token；§6.4 第 5–7、11–12 项目视 | 恢复 `word-break: break-all`（1 行） |
| G3 使长日志类内容视觉高度增加 | 中 | 观感变化 | 属预期（整词下移）；§6.4 目视确认可接受 | 同上 |
| G3 影响助手正文的行内代码断行 | **确定发生**（不是"可能"——实测当前即为 `break-all`） | 观感改善（不再劈词） | §6.2 计算值断言 + §6.4 第 11 项 | 同上 |
| G2 使超长 JSON 字符串必须横向拖动 | 中 | 窄屏体验 | 与终端面/diff 的取值一致；§11 记为可加"换行开关"的退路 | 删除标记类即回到换行 |
| 标记类命名（`tool-terminal-output`）语义偏窄误导后来者 | 中 | 维护成本 | §3.2 明示命名债；改名作为一次独立提交可随时做 | 不适用 |
| 面板加 `whitespace-pre-wrap` 后异常长的模型输出撑高面板 | 低 | 观感 | `:230` 的 `max-h-48 overflow-y-auto` 已限高 | 去掉类名 |
| 文档与实现再次分叉 | 中 | 后续误判 | §5 第 9–10 项列入同一提交 | 不适用 |

---

## 9. 验收结论模板

```
基线：857f4a61 → <实施提交>
范围：G1 / G2 / G3（G4 未纳入）

代码
  G1  AskUserQuestionPanel.tsx:221/255/263      □
  G2  MessageComponent.tsx:371                  □
  G3  index.css:821（+ 注释 :817）               □

指标（§2.2）
  G1 面板问题含 1 个内部 \n 渲染 2 行            □
  G2 JSON 块 white-space === 'pre'              □
  G2 超宽行 scrollWidth > clientWidth            □
  G3 .chat-message pre word-break === 'normal'  □
  G3 .chat-message code word-break === 'normal' □
  G3 fenced block 仍 pre + normal（防回归）      □
  G3 "aaaaaaaaaa bbbbbbbbbb" 渲染 2 行、整词下移  □
  G3 400 字符 token 无溢出                       □

回归
  test:client / test:transcript / typecheck / lint □
  编码校验（file -b 全部 UTF-8）                  □
  9 条预置失败与本轮无关（逐条核对）              □

人工验收（§6.4）1–10                            □
文档同步（06-tool-view.md / 上一份方案 §11.6）    □
未处理项已登记（G4–G8）                          □
```

---

## 10. 引用复核记录

本方案的全部 `文件:行号` 于 **2026-09-14** 逐条复核（当时 L0–L6 仍是工作区改动；其后已提交为 `66f4ac03`，行号不变）。复核方式：`grep -n` 定位 + `sed -n` 阅读原文；CSS 相关结论另用一次性 Playwright 脚本对**真实构建产物**实测计算值与断行位置，脚本已删除。

### 10.1 基线说明

> **本节初稿写于 L0–L6 尚未提交时**，原标题为「审阅前必读」，正文要求审阅者「直接读工作区、禁止 `git checkout/stash/reset/clean`」。**该前提已经失效** —— 更新如下，原正文保留在折叠块里仅作历史记录。

**现行事实**：L0–L6（`tool-terminal-output`、`tool-diff-row`、`break` 传递、3 处 `JSON.stringify(_, null, 2)` 等）已提交为 **`66f4ac03`**（`fix(chat): 保留工具内容的行结构`，24 个文件）。因此：

1. 本方案的 `文件:行号`（`index.css:817-823`、`:849`、`:861`、`MessageComponent.tsx:370-371` 等）在 `66f4ac03` 上**直接成立**，不再需要「读工作区」这一前提。
2. 审阅时**无需**任何特殊 git 操作；`git checkout` / `git stash` 不再有丢改动之虞。
3. G1–G3 的实施改动叠加在 `66f4ac03` 之上，见 §12 实施记录。

<details>
<summary>初稿原文（L0–L6 未提交时的说明，仅作历史记录）</summary>

**L0–L6 的实现改动当时全部是未提交的工作区改动。**已验证：

```
$ git log --oneline -1
857f4a61 docs(research): 补充命令单行化需求并复核行号引用
$ git show HEAD:src/index.css | grep -c "tool-terminal-output"
0
$ git show HEAD:src/index.css | grep -c "tool-diff-row"
0
```

当时受影响的未提交文件共 24 个。据此提出的四点要求（引用只在工作区成立、禁止 git 改写、自检命令、「建议先提交再派发审阅」）中，**第 4 点已被采纳**：用户在本轮审阅后把 L0–L6 提交为 `66f4ac03`，基线从而可用一个 commit hash 指代 —— 这正是当时建议的目的。

</details>

| 引用 | 复核结果 |
| --- | --- |
| `AskUserQuestionPanel.tsx:221 / 255 / 263` | 成立（`:222` = `{q.question}`、`:260` = `{opt.label}`、`:268` = `{opt.description}`） |
| `AskUserQuestionPanel.tsx:186 / 230` | 成立（徽章 / `max-h-48 overflow-y-auto`） |
| `PermissionRequestsBanner.tsx:18 / 51-59` | 成立（注册 / 渲染 `CustomPanel`） |
| `ChatComposer.tsx:287` | 成立（面板挂载点，在 `.chat-message` 外） |
| `MessageComponent.tsx:113 / 353-369 / 370-371` | 成立（根类名 / JSON 判定分支 / `<pre>`+`<code>`） |
| `index.css:817-823 / 814 / 849-853 / 861-865 / 900-903` | 成立（全局 pre/code 规则 / `hyphens: auto` / 终端面标记 / diff 行标记 / `* { max-width }`） |
| `TextContent.tsx:31 / 39`、`CollapsibleDisplay.tsx:78`、`PlanDisplay.tsx:112`、`TaskListContent.tsx:129 / 154`、`BashCommandDisplay.tsx:194 / 210` | 成立（6 处受 G3 影响的 `<pre>` + 已标记的终端输出） |
| `toolConfigs.ts:135-158`、`ToolRenderer.tsx:145 / 366` | 成立（PowerShell 配置 / Bash 特判 / `type:'special'` 落空） |
| `useChatMessages.ts:290`、`QuestionAnswerContent.tsx:96 / 162 / 166` | 成立（字符串透传 / L6 已修的三处） |
| 实测：无类 vs `whitespace-pre-wrap` 的面板文字高度 | **初稿「24px vs 48px」不成立**（漏带字号类）→ 已更正为 19.25 / 38.5（`text-[14px] leading-snug`）与 16.25 / 32.5（`text-[13px] leading-tight`），见 §1.2 实施修正 |
| 实测：`.chat-message pre.break-words` → `word-break: break-all` | 成立 |
| 实测：120px 容器内 `break-all` 的断点 | **初稿 `"aaaaaaaaaa bbbbb"` / `"bbbbb"` 不可复现** → 复测为 `"aaaaaaaaaa b"` / `"bbbbbbbbb"`；已改为只断言行数与整词下移，见 §1.4 实施修正 |
| 实测：`.chat-message code`（行内）计算 `word-break` | 成立 = `break-all`（审阅新增表面，见 §1.4「受影响表面 B」） |
| 实测：`.chat-message .markdown-code-block pre` / `pre code` 计算值 | 成立 = `pre` + `normal`（fenced block 已被豁免，故「所有 `<pre>`」措辞已收窄） |
| 实测：`PermissionRequestsBanner.tsx:100` 的 `<pre>` | 成立 = `white-space: pre-wrap` 正常生效（在 `.chat-message` 外），仅缺 `break-words`（登记为 G9） |
| 实测：`buildTranscriptHtml.tsx` 导出样式继承 | 成立（`collectDocumentStyles()` 在 `:24-39`，调用点 `:75`；`@media print` `:108-111` 无断行覆盖，故 G3 会传导到导出/打印） |
| 实测：400 字符 token 在 `normal` + `overflow-wrap: break-word` 下无溢出 | 成立 |
| 全仓检索：`format: 'json'` 无调用方 | 成立（仅 `'code'`/`'plain'`） |
| 全仓检索：客户端测试无用例读取源码文件 | 成立（仅 `server/shared/tests/claude-cli-path.test.ts`；`dist-server/` 下的同名文件是构建产物，不计） |

**未复核/不可复核项**：

- Claude `PowerShell` 的 `toolResult` 实际形状 —— 本机 macOS 无法产出 Windows 会话，G4 路线 A 的可行性未验证（正因如此建议本轮选 B）。

---

## 11. 待决策事项

| # | 事项 | 选项 | 建议 |
| --- | --- | --- | --- |
| D1 | G2 的标记类是否改名 | 保留 `tool-terminal-output` / 改中性名 | 保留（churn 与回归风险不值），命名债写进文档 |
| D2 | G3 是否本轮做 | 做 / 记入待办 | 做（已实测无溢出，且是作者本意的修复） |
| D3 | G4 PowerShell 输出 | A 修 / B 改注释 / C 不动 | B；A 需真实 Windows 会话后再评估 |
| D4 | §6.2 的断言放在哪个 harness | `tests/transcript-layout/` / 源码守卫测试 | 前者（真实 CSS 层叠），后者为退路 |
| D5 | G5（`TextContent` 死分支）/ G6 / G7 | 顺手清 / 记入待办 | 记入待办（与 G1–G3 不同源） |
| D6 | G1 的 `q.header` 徽章 | 一起加类 / 不加 | 不加（单行标签，避免为假想数据加边界） |

---

## 12. 实施记录（2026-09-14）

**结果**：G1、G2、G3 全部实施并验证；G4 按建议维持 B（本轮不改行为）。改动叠加在 `66f4ac03` 之上。

### 12.1 代码改动

| # | 文件 | 位置 | 改动 |
| --- | --- | --- | --- |
| 1 | `InteractiveRenderers/AskUserQuestionPanel.tsx` | `:221 / :255 / :263` | 三处各前置 `whitespace-pre-wrap break-words `（与 `QuestionAnswerContent.tsx:96` 逐字一致） |
| 2 | `transcript/MessageComponent.tsx` | `:371` | 死类 `whitespace-pre` → `tool-terminal-output`；补一条注释说明为何类名表达不了该约束 |
| 3 | `src/index.css` | `:821` | `word-break: break-all` → `normal`（`white-space: pre-wrap !important` 与 `overflow-wrap: break-word` 均未动） |
| 4 | `src/index.css` | `:817`（原注释） | 重写为表达新语义；并说明它同时覆盖行内 `<code>` |
| 5 | `src/index.css` | `:849` 上方注释 | 补上 JSON 查看器这第二个消费者与命名债（审阅第 9 条） |
| 6 | `src/modules/chat/tests/toolWhitespaceGap.test.tsx` | 新增 | G1 + G2 + 行内 code 的 jsdom 类令牌断言（8 例） |
| 7 | `tests/transcript-layout/tool-content-wrapping.spec.ts` | 新增 | G3/G2 的真实浏览器计算值与断行断言（5 场景 × 2 引擎） |
| 8 | `tests/transcript-layout/fixture.tsx` | 新增 action | `seed-wrapping-samples`：每种断行规则各一条消息；另修一处**既有的** `providerModels` 缺 `zcode` 的类型错误（`typecheck:transcript` 在 `66f4ac03` 上即为红，见 §12.4） |
| 9 | `tests/transcript-layout/tsconfig.json` | `include` | 收编新 spec，使其纳入 `typecheck:transcript` |
| 10 | `docs/architecture/06-tool-view.md` | Gotchas | 新增 4 条：全局规则、JSON 查看器是标记类的第二消费者、面板在 `.chat-message` 之外 |
| 11 | 本文件 + `tool-content-linebreak-rendering-review-plan.md` | §11.6 / §12 | 记录本轮与 L0–L6 的关系 |

**未纳入**：G4（PowerShell，维持 B）、G5–G8（登记）、**G9**（审阅新增的 composer 兜底 `<pre>`，低优先，本轮未动）。

**与 §5 的两处偏差**：

- §5 第 8 项把浏览器场景写在既有的 `transcript-layout.spec.ts` 里；实施时改为**新增 `tool-content-wrapping.spec.ts`**。理由：原 spec 全篇服务于滚动几何（装有 `scrollLeft/scrollTop` 劫持与逐帧采样），把「计算样式 / 断行」混进去会让两件事共用一套仪器，读和改都更贵。新增文件同一 `testDir`、同一 fixture、同一 webServer，`npm run test:transcript` 一并执行。
- §9 的验收模板仍按原计划写「`index.css:821`」，实施后 `word-break` 在 `:829`（注释加长使行号下移 8 行）。模板未改，以免掩盖这一事实。

### 12.2 实施中自己抓到的两个错误（都不是审阅提出的）

| # | 问题 | 怎么发现的 | 处置 |
| --- | --- | --- | --- |
| 1 | **「词边界断行」用例是空转的**：初版把样例文字放进普通段落，而 `.chat-message pre, .chat-message code` **只命中 `<pre>`/`<code>`** —— 段落改动前后计算值都是 `normal`。第一次跑「反证」时它**在未修复的 CSS 上照样通过** | 「把实现回退，看测试是否失败」这一步 | 样例文字改放进行内 code；再反证：未修复时该用例在两引擎下都失败 |
| 2 | 把测量宽度直接钉在行内 `<code>` 上**无效**（行内盒不取 `width`），实际得到 818px | 探针里加了一条「回读并断言宽度」的守卫 | 改为钉在最近的非行内祖先上，并回读断言 |
| 3 | **用错了 linter**：本仓的 `npm run lint` 跑的是 **`oxlint`**（`oxlint src/ server/`），而我用 `npx eslint <file>` 迭代类名顺序 —— 该命令只是打印一段 eslint 配置迁移提示后退出，**根本没跑任何规则**，于是「0 classnames-order」是假绿 | 用 `git worktree add` 拉一份 `e98a71cd` 的干净副本跑基线，发现总数 143 vs 142，再逐条比位置才定位到 `MessageComponent.tsx:375` 这条一直存在 | 改用 `npx oxlint <file>` 重试各排序；实测只有把 `tool-terminal-output` 放在**最前**才通过，已改为 `tool-terminal-output block font-mono text-sm text-foreground` |

> **共同教训**：与 §10 记录的两次同源 —— **探针/测试/检查命令的条件必须与真实条件一致**，且**反证要在未修复的代码上跑一遍**。断言「通过」本身不构成证据；先确认**检查真的执行了**，再看结果。

### 12.3 验证结果

| 项 | 结果 |
| --- | --- |
| `toolWhitespaceGap.test.tsx` | 8 例通过（伴随 1 条 `NO_I18NEXT_INSTANCE` stderr 警告 —— 与既有 `messageStreamEnd.test.tsx` 相同，属仓库基线） |
| `tool-content-wrapping.spec.ts` | **10 例通过**（5 场景 × Chromium/WebKit） |
| 反证（把 G3 回退为 `break-all`） | **6 例失败**（词边界 ×2、行内 code ×2、JSON 查看器 ×2）；另 4 例通过，因为它们是**守卫**而非检测器：无溢出（改动前后都成立）与 fenced 豁免（改动前后都应成立） |
| `npm run test:transcript` | **20 例通过**（10 几何 + 10 本轮），几何套件未受影响 |
| `npm run typecheck` / `typecheck:transcript` | 干净（后者原为红，见 §12.4） |
| `npm run lint` | 0 error；**142 warning，与 `e98a71cd` 的干净 worktree 基线一致**（比对方式：`git worktree add` + 按告警位置逐条 diff，确认无新增）；无 UTF-8 损坏 |
| `npm run test:client` | **74 文件 / 531 用例全过**（基线 73 / 523，+1 文件 = 新增的 `toolWhitespaceGap.test.tsx` 的 8 例） |
| `npm run build:client` | 干净；产物 CSS 中 `.chat-message pre,.chat-message code{…word-break:normal…}` 与 `tool-terminal-output` 均已入包 |
| 编码 | 所有改动文件 `file -b` 为 UTF-8 |

### 12.4 顺带发现的既有问题（非本轮引入）

`npm run typecheck:transcript` 在 `66f4ac03` 上**即为失败**：`fixture.tsx` 的 `providerModels` 缺 `zcode`，而 `LLMProvider` 已含 `'zcode'`（提交 `19bdee1d` 引入）。主 `typecheck` 不覆盖 `tests/transcript-layout`，所以一直没暴露。已在 §12.1 第 8 项顺带修复（一个字段）。

---

## 审阅批注

> 本节供多 harness 交叉审阅使用。请在**自己的小节内**追加批注，不要修改方案正文。
>
> 每条批注请包含四要素：**编号**（如 `G1-1`，对应 §1 的缺陷 ID）、**严重级别**、**证据**（`文件:行号` 或可复现步骤）、**建议**。
> 风险等级建议使用 GitHub admonition：`> [!NOTE]` 补充 / `> [!TIP]` 建议 / `> [!IMPORTANT]` 关键 / `> [!WARNING]` 风险 / `> [!CAUTION]` 严重（数据丢失、故障）。
>
> **审阅重点**：
> ① G1/G2/G3 是否真实存在？请**独立复核行号**（基线 `857f4a61`），并独立复现 §1.2–§1.4 的实测数字。
> ② **有无遗漏的同类表面？** 建议按「同一数据的全部渲染出口 × 全局 CSS 命中集合」双向穷举，重点检查 `.chat-message` **之外**的渲染区（composer、模态、导出）以及未被 §1.4 列出的 `<pre>`/`<code>`。
> ③ G3 的影响面判断是否成立？特别是：`word-break: break-all` → `normal` 对**行内代码、助手正文、markdown 表格、导出/打印**的实际观感影响；「`overflow-wrap: break-word` 保证不溢出」这一论断是否在所有浏览器（含 WebKit）成立。
> ④ G2 是否值得改（纯 JSON 回复块并非工具表面）、以及标记类命名方案（D1）的取舍。
> ⑤ G4 PowerShell 的处置（D3）与你对 `toolResult` 形状的了解。
> ⑥ §6.2 的断言落点（D4）是否合适。
>
> 若发现问题，请给出**可复现步骤**而非结论性描述——上一轮的教训是「只给结论的批注」需要牵头逐条反查，成本高。相关基线：本方案承接 `tool-content-linebreak-rendering-review-plan.md`（L0–L6 已实施）。

### Claude

> 审阅基线：`857f4a61` + 工作区 L0–L6 未提交改动。已按 §10.1 直接阅读工作区文件，**未执行任何 git 改写操作**；CSS 计算值用一次性 Playwright 脚本对**真实构建产物** `dist/assets/index-D474x3RN.css` 独立复现（chromium 1.63 + webkit 双引擎），探针脚本已删除。下列行号均为工作区版本。

#### ① G1–G3 存在性复核

> [!IMPORTANT] **G1-1 · 缺陷成立，但 §1.2 实测数字「24px/48px」无法复现**
> **证据**：`AskUserQuestionPanel.tsx:221`（`{q.question}` 在 `:222`）、`:255`（`{opt.label}` 在 `:260`）、`:263`（`{opt.description}` 在 `:268`）行号精确成立，三个元素类名确无任何 whitespace 声明；对照组 `QuestionAnswerContent.tsx:96/162/166` 均有 `whitespace-pre-wrap break-words`，「同一 payload 双出口不一致」的论点成立。
> 但独立实测：用面板实际字号行高（`text-[14px] leading-snug` = 14px × 1.375）在 chromium 与 webkit 下，含 `\n` 文本无类高度为 **19.25px（1 行）**、加 `whitespace-pre-wrap` 为 **38.5px（2 行）**；选项标签 `text-[13px] leading-tight` 为 16.25 / 32.5。**24/48 恰为浏览器默认 16px × `line-height: normal`（≈1.5）的取值**，疑为测量时字号/行高类未生效。
> **建议**：§1.2 的「24px/48px」改为实测值（19.25/38.5 或注明元素与测量条件），否则下一位审阅者会因数字不符而误判 §10.1 复核记录不可信。

> [!NOTE] **G1-2 · 行号 1 行偏移**
> §1.2 表格「问题分组徽章 `AskUserQuestionPanel.tsx:186`（`{q.header}`）」——`{q.header}` 实际在 `:187`，`:186` 是该 `<span>` 的类名行。轻微偏移，不影响结论（徽章同为外部字符串）。

> [!NOTE] **G2-1 · 死类结论实测确认**
> `MessageComponent.tsx:370-371` 行号精确。实测 `.chat-message code.block.whitespace-pre` 计算 `white-space` = **pre-wrap**、`word-break` = **break-all**（双引擎一致）——`whitespace-pre` 确为死类。静态推演（`index.css:820` 的 `(0,1,1) !important` > 工具类 `(0,1,0)`）成立。

> [!TIP] **G3-1 · 核心论断确认（含 WebKit）**
> 实测（chromium + webkit 一致）：`.chat-message pre.break-words` 计算 `word-break` = **break-all**；`.chat-message div.break-words` = **normal**（div 面对照成立）。override 为 `normal` 后，400 字符无空格 token 的 `scrollWidth === clientWidth === 120`，**无溢出**——「`overflow-wrap: break-word` 保证不溢出」在 WebKit 下同样成立。断行位置定性符合（break-all 劈词 / normal 词边界断行）。

> [!NOTE] **G3-2 · 断行示例的精确断点与独立复现不一致**
> §1.4/§10.1 写 break-all 断为 `"aaaaaaaaaa bbbbb"`/`"bbbbb"`，我实测（120px 容器 + `whitespace-pre-wrap break-words`）为 `"aaaaaaaaaa b"`/`"bbbbbbbbb"`。**定性一致、精确断点依赖字号与容器宽度**。§2.2 指标「断为 `aaaaaaaaaa` / `bbbbbbbbbb`」建议只断言行数与整词下移，不断言精确字符，否则验收断言会因环境字体而漂移。

#### ② 遗漏的同类表面

> [!WARNING] **G3-3 · 行内 `<code>` 面未列入影响面**
> **证据**：`Markdown.tsx:104`（`shouldInline` 分支）渲染行内 code，命中 `.chat-message code` 全局规则（`word-break: break-all`）；用户消息正文（`MessageComponent.tsx:130-136` 走同一 `Markdown`）与 `StreamingMarkdown` 中的行内 code 均如此。§1.4 只列 6 处 `<pre>`，§2.2 指标与 §6.4 验收矩阵只覆盖 `.chat-message pre`。
> **影响判断**：G3 改动对行内 code 是**改善**（不再劈词），与 §8 风险表一句相符——但影响面枚举、指标、验收均未覆盖，是「改了但没测」的表面。
> **建议**：把行内 code 显式列入影响面；§6.4 加一条「正文行内 code 的长 URL/路径按词断行、不溢出」验收项；§2.2 补一条 `.chat-message code` 计算 `word-break === 'normal'`。

> [!NOTE] **G3-4 · `.markdown-code-block pre` 已豁免，「所有 `<pre>`」措辞过宽**
> `index.css:826-832` 的 `.chat-message .markdown-code-block pre { … word-break: normal; overflow-wrap: normal }` 特异性 `(0,2,1)` > `(0,1,1)`，实测计算 `word-break: normal`、`white-space: pre`。§1.4「所有 `<pre>` 里作者写的 break-words 全部空转」不准确——实际受影响的是**未走标记类/豁免选择器的 `<pre>`（即 6 处）+ 行内 `<code>`**。建议修正措辞，避免后续按「所有 pre」穷举时误判 fenced code block 也是 G3 面。

> [!NOTE] **G1-3 · `PermissionRequestsBanner.tsx:100` 的兜底 `<pre>` 缺 `break-words`**
> 与 G1 面板**同一组件文件**的另一分支（非 AskUserQuestion 工具的 Confirmation 兜底）的「View tool input」`<pre>`，位于 `.chat-message` **外**的 composer 区，有 `whitespace-pre-wrap` 但**无 `break-words`**。实测（双引擎）其计算 `white-space: pre-wrap` 正常生效（不受全局规则影响），故不折叠换行；但超长 token（路径/URL）无 `overflow-wrap` 兜底，靠 `overflow-auto` 滚动。这是「工具 raw params」数据的第三张脸（transcript 的 `CollapsibleDisplay:78`/`PlanDisplay:112` 均有 `break-words`）。建议记入 §1.5/§11 待办（与 G6 同类低优先）或顺手补 1 行。

> [!NOTE] **G7 确认**：`CommandResultModal.tsx:116/324/386/494` 4 处 `break-all` 成立（`:372` 另有 `break-words`）。属 `.chat-message` 外模态，低优先判断合理。

#### ③ G3 影响面判断

> [!TIP] **G3-5 · 影响面判断总体成立，补充三点**
> 1. **markdown 表格**：break-all → normal 后 cell 长 token 由 `.chat-message` 的 `overflow-wrap: break-word`（`index.css:813`）兜底；移动端表格有 `min-width: 36rem` + `overflow-x`（`index.css:872-897`）。不会新增溢出，断行位置更自然。建议 §6.4 加一条表格 cell 验收。
> 2. **导出/打印**：`buildTranscriptHtml.tsx:75-89` 的 `collectDocumentStyles()` 内联活动文档样式表，全局改动会传导到导出与打印；`@media print` 无断行特殊处理。无回归风险，但 §6.4 第 10 项的「与屏幕态一致」应理解为「断行规则一致」，可注明。
> 3. **风险表「长日志视觉高度增加」判断成立**：break-all → normal 让整词下移，行数可能增加，属预期。

> [!NOTE] **G4-1 · 证据链完整，建议 B 合理；补充一个强化点**
> 确认：`OneLineDisplay.tsx:93-125` 终端分支只渲染命令单行、**不渲染输出**；`ToolRenderer` 对 `type:'special'` 无分支，落 `:366 return null`；`shouldHideToolResult`（`toolConfigs.ts:856-857`）因 `hideOnSuccess` 在 toolResult 存在且非 error 时返回 true，`MessageComponent.tsx:273` 结果区被抑制——PowerShell 成功输出确实完全丢失，`toolConfigs.ts:135-137` 注释「It is the same interaction as Bash」与行为矛盾。
> **补充**：即使按路线 A 给 `ToolRenderer`/`MessageComponent` 加 PowerShell 分支，`shouldHideToolResult` 的 `hideOnSuccess` 仍会先挡住结果区——A 还需调整 hideOnSuccess 或 `MessageComponent` 的排除逻辑，改动面比「2 处条件」更大，**进一步支持本轮选 B**。

#### ④ G2 取舍与 D1 命名

> [!NOTE] **G2-2 · 值得做；D1「保留现名」权衡成立，附一条命名债补强**
> 纯 JSON 回复块虽非工具表面，但它命中全局 `.chat-message code` 且作者意图（pretty + 不换行 + 横向滚动）可被 `tool-terminal-output` 以 1 行实现——与 L0 同源、churn 极小，值得做。D1 保留现名可接受；但该标记类现同时服务「终端输出」与「JSON 查看器」，建议把 JSON 查看器这一消费者写进 `index.css:849` 处的注释（当前注释只讲 terminal），以落实 §3.2 的命名债记录。

#### ⑤ §6.2 断言落点（D4）

> [!NOTE] **D4-1 · 同意放 `tests/transcript-layout/`；补一条行内 code 断言**
> 计算值断言只有真实 CSS 层叠能验证，放 transcript-layout harness 正确。建议把 G3-3 的行内 code 纳入：断言 `.chat-message code`（非 pre）的计算 `word-break` 在改动后为 `normal`（当前为 `break-all`），否则行内 code 是 G3 改动的**未测表面**。

### WorkBuddy · `（sessionId）`

（待补充）

### Pi · `（sessionId）`

（待补充）

### ZCode

（待补充）

### Codex

> 审阅基线：`857f4a61` + 当前工作区的 L0–L6 未提交改动。已先读 §10.1，直接读取工作区文件；未执行 `git checkout`、`git stash`、`git reset` 或 `git clean`。计算样式以现有真实构建产物 `dist/assets/index-D474x3RN.css` 在 Chromium、WebKit 各复测一次；下列行号均为工作区版本。

#### ① G1–G3 存在性复核

> [!IMPORTANT] **G1-1 · 缺陷成立，但高度实测数字需更正**
> **证据**：`AskUserQuestionPanel.tsx:221/255/263` 的三个渲染容器分别在 `:222/:260/:268` 输出 `q.question`、`opt.label`、`opt.description`，类名均无 whitespace / overflow-wrap 声明；`QuestionAnswerContent.tsx:96/162/166` 是同一类数据的另一出口，已有 `whitespace-pre-wrap break-words`。面板经 `composer/PermissionRequestsBanner.tsx:51-59` 挂入 `ChatComposer.tsx:287`，不在 `.chat-message` 内，故内部 `\n` 会按默认 `white-space: normal` 折叠。
> **复现**：以构建产物的实际 Tailwind 类渲染 `one\ntwo`，`text-[14px] leading-snug` 当前为 **19.25px**（无 whitespace，1 行）；加 `whitespace-pre-wrap` 后为 **38.5px**（2 行）。`text-[13px] leading-tight` 对应 **16.25px / 32.5px**。Chromium 与 WebKit 一致。
> **建议**：保留 G1 和三处加类方案，但将 §1.2/§10.1 的 **24px/48px** 改成带元素、字号、行高条件的实测值，或仅表述为“1 行 / 2 行”；否则数字不可重复。另，徽章值实际在 `AskUserQuestionPanel.tsx:187`（`:186` 是 `<span>` 起始标签）。

> [!IMPORTANT] **G2-1 · 死类结论成立**
> **证据 / 复现**：`MessageComponent.tsx:370-374` 的纯 JSON 分支确为 `<pre class="overflow-x-auto p-4">` 内嵌 `code.block.whitespace-pre`。在 Chromium、WebKit 对现有构建产物读取计算值，均为 `white-space: pre-wrap`、`word-break: break-all`、`overflow-wrap: break-word`；即 `index.css:818-823` 的 `.chat-message code { white-space: pre-wrap !important }` 直接压过 Tailwind 工具类，外层横向滚动未承担预期用途。
> **建议**：G2 值得修，且将标记类放在 `<code>` 本身的方案正确；父 `<pre>` 的继承值无法胜过直接命中的 `!important` 规则。D1 可暂保留 `tool-terminal-output`，但应把 JSON 查看器消费者补入 `index.css:841-848` 的注释，避免其语义仅看起来像终端输出。

> [!IMPORTANT] **G3-1 · 根因与“无溢出”前提成立（含 WebKit），但影响面枚举不完整**
> **证据 / 复现**：`index.css:818-823` 当前确为 `word-break: break-all` 与 `overflow-wrap: break-word`。120px 容器中的 `.chat-message pre.whitespace-pre-wrap.break-words` 在两引擎均计算为 `break-all`；将同一规则临时覆盖为 `word-break: normal` 后变为 `normal`，400 字符无空格 token 仍为 `scrollWidth === clientWidth === 120`，两引擎一致。故路线 A 的“不会因单个长 token 新增横向溢出”判断成立。
> **建议**：§2.2/§6.2 不要断言示例字符串的精确字符断点；它取决于字体度量。应断言 `word-break: normal`、整词优先下移和无溢出。

#### ② 遗漏的同类表面

> [!WARNING] **G3-2 · 行内 Markdown `<code>` 是遗漏的受影响表面**
> **证据**：`transcript/Markdown.tsx:101-114` 的行内 code 使用 `whitespace-pre-wrap break-words`，却同样直接命中 `index.css:818-823` 的 `.chat-message code`，当前计算值也是 `word-break: break-all`；用户消息经 `MessageComponent.tsx:115-136` 也会走此渲染路径。
> **建议**：将行内 code 明列进 G3 影响面；§6.2 增加非 `<pre>` 的 `.chat-message code` 计算值断言，§6.4 增加长 URL/路径行内 code 在正文、窄屏下不劈词且不溢出的验收项。

> [!NOTE] **G3-3 · fenced code block 不属于 G3，现有“所有 `<pre>`”表述过宽**
> **证据**：`index.css:826-839` 的 `.markdown-code-block pre` / `pre code` 以更高特异性覆写为 `white-space: pre !important; word-break: normal; overflow-wrap: normal`。双引擎计算值均为 `pre / normal / normal`，并非 `break-all`。
> **建议**：将 §0、§1.4 的“所有 `<pre>`”收窄成“未被 fenced code block 或标记类豁免的 `<pre>`”；保留列出的 6 处，但不要将 fenced block 误计为本次缺陷。

> [!NOTE] **G1-2 · composer 内还有一处同类 raw-input 表面，建议登记**
> **证据**：`composer/PermissionRequestsBanner.tsx:95-102` 的 Confirmation 兜底 `rawInput` 是 `.chat-message` 外的 `<pre class="… overflow-auto whitespace-pre-wrap …">`。它能保住换行，但没有 `break-words`；超长路径/URL 只能滚动。它与 `CollapsibleDisplay.tsx:78`、`PlanDisplay.tsx:112` 的 raw params 属同类数据的另一出口。
> **建议**：不必扩大 G1 主修复；作为低优先待办登记即可，或明确此表面以横向滚动为有意策略，避免以后重复判定为漏项。

#### ③ G3 影响面判断

> [!TIP] **G3-4 · 全局改动的主要影响判断成立，测试应覆盖行内 code、表格与导出**
> **证据**：`index.css:810-823` 同时作用于助手/用户消息内的 `<pre>` 与 `<code>`，所以改动也会影响 Markdown 正文和行内 code，不只 §1.4 的 6 个 `<pre>`；表格单元格内的 code 同样会继承这条行为。`export/buildTranscriptHtml.tsx:24-39,75-89` 将运行时活动样式表内联，`@media print`（`:108-111`）无断行覆盖，因此导出 HTML / 打印也会随之改变。
> **复现**：上述 `normal + overflow-wrap: break-word` 的无溢出结果已在 Chromium、WebKit 各验证；视觉变化仅是原本可放入下一行的整词不再被预先劈开，长日志总高度可能增加，符合 §8 预期。
> **建议**：保留 G3 路线 A；补充真实浏览器用例：行内 code、含长 token 的 Markdown 表格，以及导出 HTML 的断行规则继承。§6.4 第 10 项应明确验证“规则一致”，而不是要求不同可用宽度下的逐行像素一致。

### 牵头结论

> 汇总轮次：**2026-09-14**。已收到 **Claude**、**Codex** 两份批注（WorkBuddy / Pi / ZCode 未提交）。
> 汇总方式：逐条在**当前工作区**上独立复核 `文件:行号`，并用一次性 Playwright 脚本对**真实构建产物**（`dist/assets/index-D474x3RN.css`，Chromium + WebKit 双引擎）独立复现所有实测数字。探针脚本已删除。
> **结果：20 条批注全部采纳（采纳 20 / 部分采纳 0 / 不采纳 0）**，其中 **3 条指出的是本方案自身的错误**，已按批注更正正文。

#### 一、本方案被证伪的 3 处（审阅的核心价值）

| # | 本方案原文 | 独立复核结果 | 处置 |
| --- | --- | --- | --- |
| 1 | §1.2「无类 24px / 加类 48px」 | **不成立**。24px = 16px × `line-height: normal`，是**未带字号类**的裸元素高度；按元素实际类名（`text-[14px] leading-snug`）复测为 **19.25 / 38.5**，`text-[13px] leading-tight` 为 **16.25 / 32.5**。探针漏带了元素的实际类名 | 已更正 §1.2、§10.1，并记入实施修正（结论不变） |
| 2 | §1.4「break-all 断为 `"aaaaaaaaaa bbbbb"` / `"bbbbb"`」 | **不可复现**。按本节声明的同一条件（120px 容器）复测为 `"aaaaaaaaaa b"` / `"bbbbbbbbb"`——精确断点随字体度量漂移 | 已更正 §1.4、§10.1；§2.2 指标与 §6.2 断言改为**只断言行数与整词下移** |
| 3 | §0/§1.4「**所有** `<pre>` 的 `break-words` 空转」 | **措辞过宽**。fenced code block 被 `index.css:826-832`（特异性 `(0,2,1)`）与 `:834-839` 显式豁免，实测双引擎均为 `pre` + `normal` | 已收窄为「未被豁免的 `<pre>`」，并在 §6.2 加防回归断言 |

> **共同模式（值得记住）**：前两处都是**「探针的条件 ≠ 应用的真实条件」**——一次漏了字号类，一次漏了对齐容器度量。与 L5 那轮的 `whitespace-pre` 教训同源：**在真实构建产物上量之前，先确认探针的 DOM 与生产 DOM 同构**。

#### 二、审阅新增的真实表面（本方案初稿遗漏）

| # | 表面 | 证据 | 处置 |
| --- | --- | --- | --- |
| 4 | **行内 `<code>`**（助手/用户正文、流式回复） | `Markdown.tsx:103-105` 带 `whitespace-pre-wrap break-words`，实测计算 `word-break: break-all`；用户消息经 `MessageComponent.tsx:131-136`（根容器 `:113` 带 `chat-message`）走同一渲染器 | 已新增 **§1.4「受影响表面 B」**、§2.2 指标、§6.1/§6.2 断言、§6.4 第 11 项；并在 §4.3 指出**路线 A 天然覆盖它、路线 B 覆盖不到** |
| 5 | composer 的 raw-input 兜底 `<pre>` | `PermissionRequestsBanner.tsx:100` 有 `whitespace-pre-wrap`、无 `break-words`；在 `.chat-message` **外**，不受全局规则影响，故 `whitespace-pre-wrap` 正常生效 | 登记为 **G9**（§1.5）。**不是缺陷**，是策略不一致；顺手补 1 行亦可 |
| 6 | `CommandResultModal` 的 4 处 `break-all` | `:116 / 324 / 386 / 494` 成立（`:372` 另有 `break-words`） | G7 原地保留（低优先，不在 transcript 内） |

#### 三、被审阅强化的判断（本方案结论正确但论证不足）

| # | 批注 | 采纳方式 |
| --- | --- | --- |
| 7 | G4 路线 A **不止「2 处条件」** | 复核成立：`shouldHideToolResult`（`toolConfigs.ts:850-858`）在 `hideOnSuccess` 且非 error 时**先**返回 true，故 `:273` 的条件放宽**不足以**让输出出现，还须动 `hideOnSuccess` | §3.4 路线 A 的代价栏已改写——这**进一步支持本轮选 B** |
| 8 | G3 影响面含**行内 code / 表格 / 导出与打印** | 复核成立：`.chat-message pre, .chat-message code` 同时作用于正文；表格 cell 由 `index.css:813` 的 `overflow-wrap: break-word` 兜底、移动端另有 `min-width: 36rem`；`buildTranscriptHtml.tsx:24-39`（`collectDocumentStyles()`，调用点 `:75`）内联活动样式表，`@media print`（`:108-111`）无断行覆盖 | §6.4 新增第 11–13 项；第 10 项明确为「**规则**一致」而非逐行像素一致 |
| 9 | G2 值得做；标记类注释需补 JSON 查看器消费者 | 复核成立（`index.css:841` 的注释当前只讲 terminal） | 采纳进 §5 第 6 项的实现要求（同一提交内补注释） |
| 10 | §6.2 断言放 `tests/transcript-layout/`，并补行内 code 断言 | 采纳（D4 维持原选择，断言项已扩） | §6.2 已扩 |

#### 四、独立复核确认无误的引用（未改动）

`AskUserQuestionPanel.tsx:221/255/263`（`:222/:260/:268` 为值）、`PermissionRequestsBanner.tsx:18/51-59`、`ChatComposer.tsx:287`、`MessageComponent.tsx:113/273/353-372`、`index.css:813/817-823/826-839/849`、`TextContent.tsx:31/39`、`CollapsibleDisplay.tsx:78`、`PlanDisplay.tsx:112`、`TaskListContent.tsx:129/154`、`BashCommandDisplay.tsx:194`、`toolConfigs.ts:135-158/850-858`、`ToolRenderer.tsx:145/366`、`OneLineDisplay.tsx:93-125`、`useChatMessages.ts:290`、`Markdown.tsx:99/103-105/127`、`StreamingMarkdown.tsx:3-4` —— **逐条成立**。

#### 五、审阅独立性的保留意见

两份批注在**全部 20 条**上一致，且连数字（19.25 / 38.5 / 16.25 / 32.5、`"aaaaaaaaaa b"`）都相同。这提高了结论的可信度，但也意味着**两份批注可能并非独立得出**——《方案》的审阅意见请按「一次强复核」而非「两次交叉验证」计权。补入 WorkBuddy / Pi / ZCode 中的任意一家（尤其是与上述两者不同源的模型）能显著提升置信度。

#### 六、待用户决策

| 事项 | 状态 |
| --- | --- |
| D1–D6（§11） | 建议不变；D2（G3 本轮做）因**影响面已确认含正文行内 code**而更需要独立提交与回归 |
| **是否先把 L0–L6 提交**（§10.1 第 4 条） | 仍待定。本方案的行号只在工作区成立，审阅期间已两次触发假阳性风险 |
| G9（新增登记项） | 低优先；若要顺手补 `break-words`，与 G1 同批即可 |
