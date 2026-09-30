# CloudCLI 内置主题接管语法调色板方案

> 状态：**B1 / B1b / B2 / B3 / B4 已实施**（B4 为 2026-09-30 补三套内置主题的浅色语法半）；**本文 §8 决策 7 登记的那笔"另案"（N10 泄漏守卫缺口）也已收口**（2026-09-29，只动测试）。本文是 `docs/research/CloudCLI主题与配色体系设计方案.md`（下称"主题文档"）§8.9 / §5.7"语义化改名"的一个**收窄立项**，面向多 AI 会审。
> 起因：2-P 之后用户提出再增一套 One Dark 变体（Vivid）。调查发现 **Vivid 的全部可见差异都落在语法调色板上**，而语法调色板是主题文档 §5.11 v7 明确记录的"不在任何覆盖层可达范围内"的边界。故本方案先解决那条边界，再落地新主题。
> 编写日期：2026-09-28。文中所有行号对应当前的 `HEAD`。

---

## 0. 结论先行

1. **要做的事只有一件机制改动：给语法槽稳定的语义名。** 0-D 当年已经把"名字 ↔ 编号的绑定"收进 `SYNTAX_TOKEN_MAP` 一处，2-E 又把语法基色表**挪到 `<head>` 最前**、模块注释里写明理由是"免得覆盖层的 `--cc-syntax-*` 被它静静压掉"。也就是说：**顺序问题早就解决了，缺的只是稳定的名字。** 升名之后，内置覆盖层在 `src/index.css` 里声明同名令牌即可生效——**不需要任何新的注入机制、不需要 ThemeContext 改动、不需要新的 `<style>` 元素**。

2. **本条只取"改名轮"五条到期条款中的一条。** 主题文档 §5.7 列了 5 条"前提：改名轮立项"的悬置条款（`dark:` 双写与档位耦合、附录 A 的 `--n-*` 整层、0-E1 的 tailwind `n-*` 键、§8.9 的 `--cc-syntax-N`、2-C 白名单扩充）。其中 `--n-*` 已由 2026-09-26 拍板为**永久契约面**、不再随改名轮（主题文档 571/5301）。本方案**只立 §8.9 与 2-C 白名单这两条**，其余三条维持悬置。**这是一个范围决定，请审阅者确认**（§8 决策 1）。

3. **契约面的取舍（本方案的核心争议）：语法是否成为 `full` 的承诺面？**
   **推荐：否。** 理由是**机械的**、且已有先例：终端字体那一轮（`docs/research/CloudCLI终端字体动态配置方案.md` §3.4）已经论证过——把某能力放进 `SURFACES`，`MUST_MOVE.full` 会**强制**每套 `full` 主题都声明它（不声明即红），`MUST_NOT_MOVE.accent` 又会**禁止** accent 主题声明它（声明即红）。语法色对某些参照物并不存在（自造的 `cc-polar` 就没有参照板），所以它是**可选**能力，**不纳入 `SURFACES` 遍历**，改用独立断言证明"声明了就一定生效"。备选"纳入"见 §3.4。

4. **本方案有意的视觉变更**（不是零变化片）：四套 `full` 主题的**代码块 token 色**会从 prism `oneDark`/`oneLight` 换成各自参照物的语法板。基础层（`cc-light`/`cc-dark`、无主题态）**零变化**。这个变更就是本片的目的，逐条记账（§6.3）。

5. **一个新发现，可能改变"目标是否真达成"：代码块的*底色*不在语法层里，而且今天三个消费者三种画法。** chat 侧把它写死成 `transparent`（由外层 `bg-muted/50` / `dark:bg-n-zinc-900` 画底），编辑器侧明色用 `--muted`、暗色才落到 Prism 的底。后果是：**只升语法槽的名字，暗色下代码块仍坐在 `--n-zinc-900` 这个主题碰不到的兼容原子上**（以 `cc-onedark` 为例：`#18181b` vs 它自己的 `#282c34`，肉眼可见地不搭）。所以"代码块像主题"是**两件事**，第二件今天不可达。三个候选与推荐见 §3.2b，**这是本次新开的范围，需要审阅者明确取舍**（§8 决策 4）。

6. **顺带修掉一处自相矛盾**：主题文档 §5.11 v7 记的"`full` 主题不改语法高亮"是**如实边界**；但 `cc-catppuccin` 的 `src/index.css:1689-1692` 注释里写着"Codex 自己的主题就是*语法*主题……**语法那一半在 `.tmTheme` 里已经有家了，本主题给的是壳那一半**"。也就是说 catppuccin 是**同一个参照物被刻意劈成两半**：壳做成内置主题、语法留给用户自己装一个 `.tmTheme`。这个劈法在"内置主题改不了语法"的前提下是唯一选择；一旦边界打开，它就成了"装一套 catppuccin 要装两个东西"的体验缺陷。

7. **一片做不完，建议切成三片（＋一个条件片）**（§5）：B1 机制（升名 ＋ 读取面 ＋ 白名单 ＋ 契约），**B1b 容器底色（仅当决策 4 取 (a)）**，B2 回填四套既有 `full` 主题的语法板，B3 新增主题。B1 单独合入时**基础层零变化**、四套主题代码块不变（因为还没人声明），是一个可独立验收的片。

8. **对新主题的推荐要改判。** 我在上一轮对话里推荐 `One Dark Vivid Islands`，理由是"三条候选里唯一动了两条轴、唯一能一眼分辨"。**那个理由的前提是"语法不可达"**；语法一旦接线，`Vivid` 本身就带来 175 项语法色的加饱和（**外加终端 9～10 槽，见 §3.7 订正**），已经足够分辨，不必再叠 Islands 轴（而 Islands 轴的手法 `cc-islands` 已演过一遍）。**改判为 `one_dark_vivid.theme.json`（非 Islands）**，见 §3.8。

---

## 1. 现状排查

### 1.1 已有资产（可复用）

| 资产 | 位置 | 说明 |
|---|---|---|
| 语法调色板生成器 | `src/shared/syntaxTheme.ts:33-75` `buildSyntaxTheme()` | 把 prism `oneLight`/`oneDark` 两个 style 对象编译成一张 `--cc-syntax-N` 变量表 ＋ 一个只读 `var()` 的 style 对象 |
| 语义名绑定（**关键**） | `src/shared/syntaxTheme.ts:100-148` | `SYNTAX_SELECTORS`（10 个语义名 → `selector.property`）＋ `deriveTokenMap()` 从生成物**反查派生** `SYNTAX_TOKEN_MAP`；找不到槽位时模块加载期 `throw` |
| 基色表注入（**关键**） | `src/shared/syntaxTheme.ts:175-183` `ensureSyntaxStyleElement()` | `document.head.insertBefore(el, head.firstChild)`——**故意插在最前** |
| 顺序理由已成文 | 同上注释 152-174；主题文档 4197（2-E 决策 8） | 原话："覆盖层的 `--cc-syntax-*` 就会被基色表静静压掉……改为插到 `<head>` 最前" |
| 真引擎顺序证明 | `tests/theme-tokens/user-theme-tmtheme.spec.ts:98-127` | 已用 `readSyntaxToken('keyword')` ＋ `reinjectSyntaxStyleSheet()` 证明"用户 `.tmTheme` 压过基色表，且基色表晚注入也夺不回来"。**本方案直接复用这个范式** |
| fixture 的语法读口 | `tests/theme-tokens/main.ts:291-301` `readSyntaxToken(name)` | 按**语义名**读一个语法槽当前解析值 |
| fixture 的重注入口 | `tests/theme-tokens/main.ts:309-312` `reinjectSyntaxStyleSheet()` | 驱动"基色表晚落位"情形 |
| 冻结映射表 | `src/shared/tests/syntaxThemeTokenMap.test.ts:78-217` | 136 项 `selector.property → 变量名` 的 inline snapshot；`:34` 断言变量数 = 136 |
| denylist 护栏 | `src/shared/tests/syntaxThemeTokenMap.test.ts:242-266` | 扫 `src` / `server` / `tests`，禁止任何文件手写 `/--cc-syntax-[0-9]/` |
| 覆盖层契约 | `tests/theme-tokens/theme-overlays.spec.ts:57-127` | `SURFACES` / `MUST_MOVE` / `MUST_NOT_MOVE`；`:237-249` `derivedMoves()`（**只要重新声明就计入 moved**，与值是否等于基线无关） |
| 令牌基线 | `tests/theme-tokens/token-baseline.json` ＋ `token-contract.spec.ts` | 两外观的全量解析值基线；`UPDATE_THEME_BASELINE=1 npm run test:theme-tokens` 重生成 |
| 用户主题编译器 | `src/shared/userThemeTokens.ts` | 白名单 ＋ 值形状 ＋ 结构闸门；`themeOverlaySelector()` 产出与内置主题同形的选择器 |
| 白名单的引用规则 | `src/shared/userThemeTokens.ts:266-270`、`289-300` | "`var()` 引用的目标也必须自身可授权"——**`:289-300` 那段正是为堵 `--editor-fg: var(--cc-syntax-3)` 而加的** |

### 1.2 缺口（实测，不是推断）

**缺口 1：语法槽的名字不稳定，所以不能进契约。**
`--cc-syntax-N` 的编号由"遍历两个 Prism 主题时遇到差异的先后顺序"决定（`src/shared/syntaxTheme.ts:33-75`），prism 依赖 bump 一次就整体重排。主题文档 §8.9（4734）与 §5.9（652）据此决定"本轮不升语义名"，只做三件挡风险的事。语义名草案的方向已经写下（§8.9 / 5106）：**以 Prism 语义类别为根、属性作后缀**（`comment` / `string` / `keyword` … ＋ `-color` / `-style` / `-weight`）。

**缺口 2（初稿在这里推断错了，下面是实测更正）：代码块的"底色"根本不在语法层里，而且三个消费者的画法互不一致。**
初稿曾以为"136 项里有 `pre[class*="language-"].background = --cc-syntax-3`，所以把容器槽也升名就能让底色随主题"。**实测证伪**：

| 消费者 | 容器底色的真实来源 | Prism 的容器槽是否生效 |
|---|---|---|
| chat markdown（`src/modules/chat/transcript/Markdown.tsx:134`） | 外层 `<div className="… bg-muted/50 … dark:bg-n-zinc-900">` | **全部失效**：`customStyle` 里写死 `background: 'transparent'`（`:191`，注释"容器自己管底色，好让标签行与代码读成一块面板"），`codeTagProps` 也写死透明（`:197`） |
| 编辑器侧 markdown（`src/modules/code-editor/markdown/MarkdownCodeBlock.tsx:70-77`） | **明色**：`customStyle.background = 'hsl(var(--muted))'`；**暗色**：不覆盖 ⇒ 落到 Prism 的 `pre` 底色 | 明色失效、暗色生效（**两个外观不对称，是构造上的**） |
| 编辑器本体（CodeMirror） | `--editor-bg` | 不走 Prism，无关 |

于是（**这一段的结论在审阅期间被第二次更正，见下**）：

- **`code[class*="language-"]` 那一族（槽 0/1/2）在 chat 与编辑器里一律不上身**——`react-syntax-highlighter` 只在 `codeTagProps` 为 `undefined` 时才用默认值，而两个消费者**都显式传了它**（chat `Markdown.tsx:197`、编辑器 `MarkdownCodeBlock.tsx:83`）。所以 `code[…].background` / `.color` / `.textShadow` 是死槽。
- **真正在画代码正文的是 `<pre>`**（`pre[class*="language-"].color`，槽 4）——它由 `preProps.style = {...defaultPreStyle(=pre[…] 对象), ...customStyle}` 内联，两个消费者都没覆盖 `color`。**初稿选错了元素**：它以为 `code[…].color` 活着，实测与读库双证其死。详见 §3.2 的"第 11 槽改判"。
- **`pre[…].background`（槽 3）是半活的**：编辑器暗色有效、编辑器明色与 chat 两态均被覆盖。它是"容器底色"在语法层里的真身，但只在一处生效。
- **12 条 `::selection`（槽 6–17）全是死槽**：这套库把 style 对象只当**类名查表**用（`createStyleObject`），从不序列化成 CSS，选择器键没有任何生效通路。

而"用户眼里那块面板"的底色，在 chat 的**暗色**下由 `dark:bg-n-zinc-900` 决定——**那是 Tailwind 兼容骨架里的 `--n-zinc-*` 别名层**（`src/index.css:292-302`），任何主题都不覆盖它，正是覆盖层契约 `fixed` 组那句"`--n-gray-*` 代表整个兼容骨架（约 1.5k 处原子类）；重染它会改变远多于一个主题所宣称的范围"所保护的对象。

> **契约订正（2026-09-30，《CloudCLI 用户主题升内置方案》§4.1 落地时回写）**：上面引的 `fixed` 组注释与"任何主题都不覆盖它"的读法**已随该方案改写**——兼容骨架不再是全族冻结。四族 11 档共 **44 个令牌**移入新的 `compat` 组（`--n-gray-*` / `--n-zinc-*` / `--n-slate-*` / `--n-neutral-*`，合计 **1380 处**工具类站点：`gray` 1223 ／ `zinc` 66 ／ `slate` 51 ／ `neutral` 40），**`full` 可整族重染**（整族十一档，不许只染一部分——局部重染会留下同一个接缝、只挪一档），`accent` 一档不许动；`fixed` 只剩 `--n-white` / `--n-black`（**257 处**，旧注释那句"约 1.5k 处原子类"的整骨架口径作废）。因此：① `dark:bg-n-zinc-900` 这类兼容原子对 `full` 主题**已是可达面**；② 本段的"不能"如今只对 `accent` 成立，而"本次迁入的四套只重染 `gray`、`zinc` / `slate` / `neutral` 三族仍保持冷灰"是**现状**而非契约；③ 本方案的结论（容器底另立 `--code-block-bg`）不因此改变。**同行四处**（`:205` 表格格"不能"、`:510` "`--n-zinc-900` 自身仍在 `fixed` 组里"、`:552` "落在 `fixed` 组保护的那层骨架里"、`:644` "兼容骨架不可被主题动"）**沿用同一订正**，均为该提案当时的边界，不再代表当前契约。

**这条是本方案最需要审阅者注意的新发现**：它把原目标拆成两件事——**token 色（今天可达）** 与 **容器底（今天不可达，且三个消费者三种画法）**。处置见 §3.2b 与 §8 决策 4。**审阅后要补一句**：可达的那一半里，"正文色"落在 `<pre>` 而不是 `<code>`——元素选错会让契约面拿到一个"改了没反应"的槽，且比"被 `transparent` 覆盖"更难发现。

**缺口 3：语法槽不在令牌基线里，所以"改名是否零变化"今天无从证明。**
`tests/theme-tokens/main.ts:169-179` 的 `tokenNames` 来自 `src/index.css?raw` 的声明扫描；语法变量由 JS 注入，**`index.css` 里 `--cc-syntax-*` 出现 0 次**（实测），于是它们不在基线、不在 `readWithTheme().tokens` 里。`theme-overlays.spec.ts:351-370` 那条"覆盖层只能重新声明基色表声明过的令牌"也会因此把语法令牌判为 unknown。

**缺口 4：白名单不授权语法族，且用户主题的三条路径不一致（如实）。**
`userThemeTokens.ts` 的 `FAMILY_RULES`（212-227）没有任何一条匹配 `--cc-syntax-*`，`ruleForToken()` 返回 null ⇒ 选项 A 的 `.json` 主题**不能**设语法色。但：
- 选项 B 的 `.css` 主题是**原样注入**（`userThemeStyles`），**今天就能**设 `--cc-syntax-*`；
- `.tmTheme` 编译器产出的变量名一律经 `SYNTAX_TOKEN_MAP` 取（2-E 决策 3），所以它也**能**改语法色，且不经过白名单（作者写的是 scope，不是令牌名）。

⇒ 现状是：**同一个能力，`.css` 与 `.tmTheme` 通、`.json` 不通**。这不是有意设计，是白名单快照的时间差。

### 1.3 一个反直觉的前提：内置主题改不了语法色，**不是因为没能力**

必须把这条讲清楚，否则后面的设计会被误读成"新增一套机制"：

- 语法基色表是 `:root{}` ＋ `.dark{}` 的 `<style>`，**在 `<head>` 最前**；
- 内置覆盖层是 `src/index.css` 里的 `[data-theme="…"]` 块，**同权重、文档顺序在后** ⇒ 覆盖层赢；
- 用户主题的 `<style>` 追加在 `<head>` 末尾 ⇒ 也赢（已由 `user-theme-tmtheme.spec.ts` 在真引擎证明）。

**所以"内置主题声明 `--cc-syntax-*` 就能生效"今天在机制上已经成立，唯一的问题是 `index.css` 里只能写编号，而编号是 Prism 遍历顺序的函数——写它等于把主题钉死在某一版 prism 上。** 这正是 §8.9 说"授权会让主题绑上会重排的编号"的意思。

---

## 2. 设计目标与非目标

### 2.1 目标

- **G1 内置主题能自带语法板**：覆盖层用**稳定名字**声明语法色，在两种外观下都压过基色表，且基色表晚落位也夺不回来。
- **G2 修掉"同一参照物劈成两半"**：`cc-catppuccin` / `cc-islands` / `cc-onedark` 各自有真实语法板的，代码块改用自己的色板。
- **G3 新主题 Vivid 有真实内容**：它的 175 项加饱和色能被表达（至少能被表达出可见的那部分）。
- **G4 基础层零变化**：`cc-light` / `cc-dark` / 无主题态的解析值与今天逐字节相同；覆盖层升名是**纯改名**，值一个不动。
- **G5 用户主题的语法路径统一**：`.json` 与 `.css` / `.tmTheme` 对齐（要么都通、要么都说清为什么不通）。

### 2.2 非目标（明确不做，理由见 §9）

- 不做"改名轮"的其余三条到期条款（`dark:` 双写、`--n-*` 整层、tailwind `n-*` 键）。
- 不重命名那 136 项里的**其余 125 项**（含 rainbow-braces / code-toolbar / prism-previewer / line-numbers 等 Prism 插件 chrome）。
- 不给语法色加对比度断言（§5.10 的 6 组配对是 UI 配对，不是语法配对）。
- 不改代码块的**几何 / 字体**（那是 `--editor-*` 与 `--ui-code-font-*` 的事）。
- 不改 `--cc-syntax-*` 的**注入机制**（不新增 `<style>`、不动 `ThemeContext`）。
- 不做 §5.12 之外的新令牌参数化。

---

## 3. 设计方案

### 3.1 机制：把 11 个槽升为语义名，其余保持编号

```
今天                                     本方案
:root{                                    :root{
  --cc-syntax-18: hsl(220, 10%, 40%);       --cc-syntax-comment-color: hsl(220, 10%, 40%);
  --cc-syntax-30: hsl(286, 60%, 67%);       --cc-syntax-keyword-color: hsl(286, 60%, 67%);
  --cc-syntax-4:  hsl(220, 14%, 71%);       --cc-syntax-block-foreground: hsl(220, 14%, 71%);
  ... 共 136 项                             ... 11 项有名 ＋ 其余 125 项仍为编号
}                                         }
```

> **第 11 槽的绑定在审阅后由 `code[…].color`（槽 1）改为 `pre[…].color`（槽 4）**，名字随之从 `--cc-syntax-code-foreground` 改为 `--cc-syntax-block-foreground`。依据见 §3.2 的"第 11 槽改判"。

要点：

1. **名字由 `buildSyntaxTheme()` 直接产出**，不再先编号再反查。做法：把 `SYNTAX_SELECTORS`（名 → `selector.property`）反成一张 `selector.property → 名` 的表，生成器查表——命中就用语义名，未命中才编号。
2. **`deriveTokenMap()` 一行都不用改。** 它是从生成物里"反查"出 `keyword.color` 对应哪个变量名；生成物现在写的就是 `--cc-syntax-keyword-color`，反查照旧命中。**这是 0-D 那层间接的红利**：改名的动作面被限制在"名字怎么生成"一处。
3. **`SYNTAX_TOKEN_MAP` 的类型是 `Record<SyntaxSemanticName, string>`，所以加键是编译期强制的**：改 `SyntaxSemanticName` 会立刻让 `src/shared/tests/syntaxThemeTokenMap.test.ts:42` 的 `ONE_DARK_SLOT_COLOURS`（同类型）编译失败，逼着把新槽的期望色补上。这是好事，写进 DoD。
4. **denylist 不需要改**：`/--cc-syntax-[0-9]/` 正好继续指认"还没升名的那些编号"，而升名后的 11 个不再命中。护栏语义自动跟着走。

### 3.2 哪些槽进契约面（**11 个**）

| 语义名 | 绑到 `selector.property` | 快照里的编号 | 活性 |
|---|---|---|---|
| `--cc-syntax-comment-color` | `comment.color` | 18 | chat ＋ 编辑器 |
| `--cc-syntax-punctuation-color` | `punctuation.color` | 22 | 同上 |
| `--cc-syntax-class-name-color` | `class-name.color` | 25 | 同上 |
| `--cc-syntax-constant-color` | `constant.color` | 27 | 同上 |
| `--cc-syntax-number-color` | `number.color` | 28 | 同上 |
| `--cc-syntax-keyword-color` | `keyword.color` | 30 | 同上 |
| `--cc-syntax-property-color` | `property.color` | 31 | 同上 |
| `--cc-syntax-string-color` | `string.color` | 37 | 同上 |
| `--cc-syntax-function-color` | `function.color` | 46 | 同上 |
| `--cc-syntax-url-color` | `url.color` | 47 | 同上 |
| **`--cc-syntax-block-foreground`** | `pre[class*="language-"].color` | **4** | **新增**：代码块里未命中 token 的普通正文色；两个消费者都没覆盖它 |

**为什么到这里为止**：**这句在审阅后已用实测坐实，且数字收紧**——Vivid 改动的 175 条带前景色的语法属性，**其 base 色 175/175 全部等于这 10 个槽的 One Dark 色**，且落在**5 个**色族上：`keyword` `#c678dd`（紫）、`string` `#98c379`（绿）、`url` `#56b6c2`（青）、`property` `#e06c75`（红）、`punctuation` `#abb2bf`（灰）。**另 5 个槽的色族一个都没动**（`comment` `#5c6370`、`className`/`constant`/`number` `#d19a66`、`function` `#61afef`）——所以准确说法是"**改动的属性集合 ⊆ 契约槽的 5 个色族**"，而不是此前几稿里"六个色相加饱和"的宽读；那 5 个没动的槽在 B2 里会**照抄参照物而值不变**（不是漏做，是可以被这一步证明"确实没变"）。
> 边界照实说：175/175 是**色族级**的覆盖证明（没有一条改动落在契约之外的色族上），不等于"175 条逐条都能被 11 个槽表达"——同一色族内不同语言的属性名在 Prism 侧本就合并到同一个槽，这正是"按颜色而非按语义映射"的既有口径（本节末段那笔账）。

后 125 项是 HTML/JSON/Markdown 专用类、Prism 插件 chrome、行号与工具栏配色；它们**确实**也是变量（两主题取值不同），但升名只会造出"改了没反应"的假契约——原因见下一条。

**明确不进契约面的 17 个槽（实测，不是推断；**一行一槽**，不汇总）**

> 计数在第二轮被审阅者修正：初稿写"15 个"、表格列了 16 项、而槽 5 只在正文被提一句没有行。**逐槽数实的实为 17 个**——`0`/`1`/`2`（`code[…]` 三件套）、`3`（半活）、`5`（仅暗色有值）、`6`–`17`（12 条 `::selection`）。Claude 补的要求一并采纳：**每一步都写"为什么"**，这份清单是给下一个读 136 项快照的人看的，理由比计数更能防"以为漏了"。

| 槽 | 绑到（`selector.property`，照黄金快照逐字抄） | 为什么不进来 |
|---|---|---|
| 0 | `code[class*="language-"].background` | `<code>` 元素拿不到主题样式（同下 1、2，共同理由见本节末） |
| 1 | `code[class*="language-"].color` | 同上。**这是初稿误当"第 11 槽"的那一个**，改判经过见本节末 |
| 2 | `code[class*="language-"].textShadow` | 同上 |
| 3 | `pre[class*="language-"].background` | **半活**：编辑器暗色半边**有效**（`customStyle` 暗色不给 `background`，于是 `preProps.style` 落回 `defaultPreStyle`），编辑器明色被 `background: hsl(var(--muted))` 覆盖、chat 两态都被 `transparent` 覆盖。它是容器色的**真身**，处置见 §3.2b |
| 5 | `pre[class*="language-"].textShadow` | **仅暗色有值**（两套 Prism 主题里恰好"亮色无、暗色有"）。命名它会立刻触发 §3.4 的"两外观声明齐"难题，而它值本身并无人消费 |
| 6 | `code[class*="language-"]::-moz-selection.background` | 选择器键**没有生效通路**（理由见本节末"6–17 的共同理由"） |
| 7 | `code[class*="language-"]::-moz-selection.textShadow` | 同上 |
| 8 | `code[class*="language-"] *::-moz-selection.background` | 同上 |
| 9 | `code[class*="language-"] *::-moz-selection.textShadow` | 同上 |
| 10 | `pre[class*="language-"] *::-moz-selection.background` | 同上 |
| 11 | `pre[class*="language-"] *::-moz-selection.textShadow` | 同上 |
| 12 | `code[class*="language-"]::selection.background` | 同上 |
| 13 | `code[class*="language-"]::selection.textShadow` | 同上 |
| 14 | `code[class*="language-"] *::selection.background` | 同上 |
| 15 | `code[class*="language-"] *::selection.textShadow` | 同上 |
| 16 | `pre[class*="language-"] *::selection.background` | 同上 |
| 17 | `pre[class*="language-"] *::selection.textShadow` | 同上 |

- **0 / 1 / 2 的共同理由**：`react-syntax-highlighter` 只在 `codeTagProps` 为 `undefined` 时才用默认值（`node_modules/react-syntax-highlighter/dist/esm/highlight.js` 的三元：`_ref7$codeTagProps === void 0 ? 默认 : 传入`），而 chat（`Markdown.tsx:190-197`）与编辑器（`MarkdownCodeBlock.tsx:83`）**都显式传了它** ⇒ `code[…]` 那一族从来不上身。
- **6–17 的共同理由**：**这套库从不把 style 对象序列化成 CSS**——`useInlineStyles` 默认 true，token 的色只经 `createStyleObject(classNames, …, stylesheet)` 按**类名**查表（`create-element.js`），`<pre>`/`<code>` 的色经 `preProps.style`／`codeTagProps` 内联。选择器键（含 `::selection`）没有任何一条通路能生效。**第二轮把这条加固了**：升名本身**也造不出这个能力**（OpenCode）——问题不是"变量没被引用"，而是选择器键整个没有生效通路；就算把 `--cc-syntax-13` 升名，它仍只被那个死键引用。要真生效必须在 `index.css` 另写真规则（如 `pre[class*="language-"]::selection { background: var(…) }`），**那是新机制、不是改名**。顺带一个事实：`src/index.css` 里 `::selection` **0 处**，也就是说**全部 7 套主题的代码块选中色今天都是浏览器默认**。

**真正活着、且值得升名的容器相关槽只有槽 4**（`pre[…].color`）。槽 5 的理由见上表最后两段。

> **第 11 槽改判（审阅后）**：初稿选 `code[…].color`（槽 1），并在文中自我标注"需要真引擎证据、不能只靠推断"。审阅者按此提出"反证里要同时读 `<pre>` 的计算 color"。**读库源码后发现初稿的推断是错的**：如上表，`code[…]` 那一族根本不上身，**两个消费者的正文色都来自 `<pre>`**（槽 4）——chat 与编辑器都把 `codeTagProps` 显式传了，默认值（含 `code[…].color`）被整个替换掉。所以：
> - 初稿那句"`code[…].color` 是唯一一个两处消费者共用"是**错**的（它一处都不用），真身是 `pre[…].color`；
> - **名字**随之从 `--cc-syntax-code-foreground` 改为 `--cc-syntax-block-foreground`（`pre[…]` 就是"块"，两个审阅者此前对 `code-foreground` 的认可建立在旧绑定上，故随之作废）；
> - §6.2 的那条真机断言**保留并加强**：同时读 `<pre>` 与 `<code>` 的计算 color，且要求"删掉该声明后两者一起回落"——**只有两个元素都读，才能证明选对了元素**，否则会把同一个错误换个更隐蔽的形式。

> 备选（**不推荐**）"把 136 项全升名"：Prism 的 selector 里含 `pre[class*="language-"]`、`.token.cr:before`、`.prism-previewer-angle … circle` 这类**不是合法 CSS 标识符**的形状，无法机械派生名字；而且会给基线灌进 136×2 条对主题无意义的条目。主题文档 5010 早就记过这一层（"selector+property 未必能一一派生出简洁语义名"）。

### 3.2b 容器底色：一个独立的、本次新发现的问题

"代码块看起来像不像这个主题"由**两层**决定：token 色（§3.2，可达）与**面板底色**（本节，今天不可达）。后者的现状是**三个消费者三种画法**：

| 消费者 / 外观 | 底色来源 | 主题能改吗 |
|---|---|---|
| chat · 明色 | `bg-muted/50` = `--muted` ＋ 50% alpha | 能（`--muted` 是 L2，`full` 主题必动） |
| chat · 暗色 | `dark:bg-n-zinc-900` = `--n-zinc-900` ← `--palette-zinc-900` | **不能**（兼容骨架，`fixed` 组保护的对象） |
| 编辑器 markdown · 明色 | `hsl(var(--muted))` | 能 |
| 编辑器 markdown · 暗色 | Prism `pre[…].background`（`--cc-syntax-3`） | **能**——但那个槽对 chat 是死的，升名与否要看这条路径保不保留 |

**后果**：以 `cc-onedark` 暗色为例，代码块底色今天是 zinc-900（`#18181b`），而 One Dark 的编辑器页是 `#282c34`——**色块与 token 色不搭**，且这个不搭只出现在暗色。这正是"代码块不在各自调色板里"的**另一半**，且它不会被 §3.2 的升名修好。

三个候选：

- **(a) 引入一个容器令牌并让消费者都引它**（推荐）：新增一个 L2 令牌（例如 `--code-block-bg`），把 chat 的 `bg-muted/50` ／ `dark:bg-n-zinc-900` 与编辑器侧的两条分支统一到它，然后让它按 `full` 主题的可达范围参与契约（它属于"代码/编辑器"这一面，与 `SURFACES.editor` 同类）。**代价**：一个新 L2 令牌 ＋ 三处消费者改写 ＋ 五套主题各补一值（各参照物的代码底色都有现成值：One Dark `#282c34`、Catppuccin `base`、Islands 的 editor 底色）。**收益**：目标真正达成，且顺手把"暗色走兼容原子"这个阶段 0 遗留的形态收成令牌（方向与既有迁移一致）。**这是新增范围，请审阅者明确接受与否。**
- **(b) 撤掉 chat 的 `transparent`，让 Prism 的 `pre` 底色生效**：改动最小，但**违反那条注释的意图**（"容器自己管底色，好让标签行与代码读成一块面板"）——标签行会重新变成一块不同的底色；同时丢掉 `bg-muted/50` 的半透明质感。**不推荐**。审阅后补一条：它并不会"复活" §3.2 点名的死槽——槽 3 本来就是**半活**的（编辑器暗色已在用它），(b) 只是把它的可达面扩大到 chat 与明色半边；真正**全死**的 16 个槽（`code[…]` 三件套 ＋ 槽 5 ＋ 12 条 `::selection`，即 17 个非契约槽减去半活的槽 3）与本节无关。
- **(c) 本片不做容器**，只做 token 色，并**如实记账**"代码块底色仍不随主题（暗色尤甚）"。最小的诚实切片；代价是 `cc-onedark` 这类主题的代码块仍会底色不搭，目标只完成一半。

**我的推荐是 (a)**，但如果审阅者认为本片应该先收机制、把容器留作下一片，则取 (c) 并把本节原样保留为那一片的依据（**不要删节**，那是把已知缺口埋掉）。

### 3.3 覆盖层怎么落地（零新机制）

内置覆盖层在 `src/index.css` 自己的 `[data-theme="…"]` 块里照常声明即可。明暗两半照既有形状分开：

```css
[data-theme="cc-onedark"]:not(.dark) {
  --cc-syntax-comment-color: hsl(220, 10%, 50%);
  --cc-syntax-keyword-color: hsl(286, 60%, 55%);
  /* … 11 条 */
}
[data-theme="cc-onedark"].dark {
  --cc-syntax-comment-color: hsl(220, 10%, 40%);
  --cc-syntax-keyword-color: hsl(286, 60%, 67%);
  /* … 11 条 */
}
```

**为什么必须两半分开**：语法色是"两个 Prism 主题"编译出来的，`oneLight` 与 `oneDark` 的同一槽色值不同（`buildSyntaxTheme` 的整套存在理由就是它们不同）。所以语法板天然是**外观相关**的，和 `--editor-*` 一样，必须用 `:not(.dark)` / `.dark` 分块——**不能用一条 appearance-agnostic 的块**（那是 `cc-catppuccin` 给 L1 用的形状）。这一点会被既有的"light-scoped 块不得泄漏进暗色"守卫自动覆盖（`theme-overlays.spec.ts:439-482`），无需新增断言。

**顺序不需要额外保证**：基色表恒在 `<head>` 最前（`ensureSyntaxStyleElement`），覆盖层在 `index.css`。仍照 2-E 的范式加一条真引擎断言（§6.2 G1），而不是把它当注释约定。

### 3.4 契约面：语法**不纳入** `SURFACES`（本方案核心取舍）

**推荐：语法令牌是"可选能力"，不进 `SURFACES` / `MUST_MOVE` / `MUST_NOT_MOVE`。** 独立断言证明"声明了就一定生效"。

理由是**机械的**，照抄终端字体那一轮的论证（`CloudCLI终端字体动态配置方案.md` §3.4，连同它引用的 `derivedMoves()` 语义：**覆盖层只要重新声明就计入 `moved`，与值是否等于基线无关**）：

- 若语法进 `MUST_MOVE.full`：`mustMove = MUST_MOVE.filter((n) => !moved.has(n))` ⇒ **不声明就红**。于是 `cc-polar`（自造主题、**没有**任何参照语法板）被强制必须凭空造一套；更严重的是**未来任何参照物只提供 chrome 板的主题都不许标 `full`**——这正是终端字体轮拒绝把字体塞进 `SURFACES` 的同一条理由。
- 若语法进 `MUST_NOT_MOVE.accent`：`cc-ocean` 被**禁止**顺手声明语法色，同样没有道理。

**代价（如实）**：`full` 的语义仍是"动底料 ＋ 终端 ＋ 编辑器 ＋ Git 图"，**不含**代码块。文档要在 §5.3 / §5.11 v7 写明"`full` 不承诺语法板"，并说明这是**刻意的可选面**（与 `--term-font-family` 同一类：能改、不承诺）。

**弥补措施**（不引入合同的强制，但让"半吊子语法板"红掉）：

- **全有或全无（all-or-nothing）**，**按外观各自判定**（审阅后收紧了措辞）：一个主题只要声明了**任何一个**语法槽，则对其声明的每个外观，**该外观基色表声明过的槽必须全声明**。细则如下：
  - "基色表在这个外观声明过"是唯一判据——`buildSyntaxTheme()` 对明色半边是有条件写入的（`syntaxTheme.ts:62`：`if (lightValue !== undefined)`，注释说"只有明色主题会省略属性"），所以**基色表自己的明色半边就不保证齐**；
  - 因此**参照物某外观本就没有值的槽，允许该外观半块少写**，但必须同时在主题的偏离清单里点名该槽（否则视为漏写 ⇒ 红）。判据：**不得逼主题造一个"参照物不存在"的值**；
  - 反之，基色表在某外观有值、主题却漏写的，一律红。
- **"声明即生效"逐主题断言**：对每个声明了语法槽的主题，逐槽断言"该槽确实生效"。**比较方式在审阅后必须写明**（否则这条断言写出来即红）：`readSyntaxToken()` 走的是探针、返回的是**计算色**（`rgb(198, 120, 221)`），而主题块声明的是 `#c678dd` / `hsl(286, 60%, 67%)`，两种形状**直接 `===` 永不成立**。取 **① 照 `user-theme-tmtheme.spec.ts:60-65` 的 `tripletReference` 范式**：把期望值也过一遍探针再比（`readSyntaxToken` 保留，用于顺序证明与第 11 槽的选型探针）；声明一致性另走 **②**：`readWithTheme().tokens` 比的是**原样声明文本**（`extractTokenNames` 只扫 `index.css` 的 `--x:` 声明，而 B1 不给 `index.css` 加任何语法声明 ⇒ **必须手工把语义名追加进 `tokenNames`**，见 §3.6-1；追加后比的是原样声明文本，形状天然一致），两者分工写进 DoD。
- **`deriveTokenMap()` 零改动要有一条同级反证**（细则 5）：重命名前后 `deriveTokenMap()` 的输出**逐槽相等**（键同一、变量名按新规则）。这条红不了，说明 0-D 那层间接的红利确实兑现了；`deriveTokenMap` 作为"最需要保护的一步之外第二需要保护的"，不能只靠 §3.1 的断言一句带过。
- 于是：**没有参照板的主题可以不写**（合法），**但写了就得写全**（防止"改了 keyword 忘了 block 底"这种半吊子）。

> 备选（**不推荐，但请审阅者拍板**）"语法进 `MUST_MOVE.full`"：好处是 `full` 徽标语义更完整、且能强制 `cc-polar` 也补上；代价是上面那两条（强制自造 ＋ 封死未来的 chrome-only 参照物）。若审阅者认为"`full` 必须完整"优先于"参照物差异可容忍"，则应选此路，并接受 `cc-polar` 需要发明一套语法板（它的 lane 已经是发明出来的，方法论现成）。

### 3.5 用户主题白名单的扩充（2-C 的"到期条件"）

`userThemeTokens.ts` 的 `FAMILY_RULES` 增加一条（**必须放在通配更宽的规则之前**，照该数组的既有注释"顺序有意义"）：

```ts
// 语法槽：值写进 Prism style 对象后原样成为一条声明（和 --editor-* 同一类），
// 所以是完整 CSS 表达式而非三元组。字母开头的模式把编号槽挡在外面——
// 编号仍是实现细节（§5.9），授权会让主题绑上会重排的名字。
{ pattern: /^--cc-syntax-[a-z][a-z0-9-]*$/, rule: 'expression' },
```

三处细节：

1. **`[a-z]` 开头是关键**：`--cc-syntax-3` 匹配不上，编号槽继续不可授权。**这是本方案唯一一处"防漏"必须靠模式本身写对的地方**，评审时请看这一条。
2. **`expression` 规则下的引用检查自动生效**：`matchesRule` 的 `expression` 分支（`:289-300`）会遍历值里的每个 `var()` 目标并要求它自身可授权。加了这条之后 `var(--cc-syntax-keyword-color)` 变成合法引用（同一个文件也能直接设它），而 `var(--cc-syntax-3)` 仍非法。**这一条是 2-C 记录里"`--editor-fg: var(--cc-syntax-3)` 可绕过白名单"（Claude 代码审阅 P2-2）那个修复的自然延伸，不是新洞。**
3. **`.json` 的对比度检查会忽略语法值**：`compileUserThemeTokens` 只把"字面三元组 / 单独 `var()`"交给 `userThemeContrast`，`expression` 形状不在其中 ⇒ 语法色不进 §5.10 的警告集。**这是对的**（§5.10 的 6 组配对是 UI 配对），但要写进文档，别让读者以为漏了。
4. **（审阅后新增）"语义名字符集与白名单模式必须严格同源"要写进 DoD。** 上面那条模式的正确性**完全依赖未来的语义名只用 `[a-z]` 开头 ＋ `[a-z0-9-]*`**：若将来某个 `SyntaxSemanticName` 用了下划线（`block_foreground`）或别的不在字符集里的字符，模式会失配 ⇒ **该槽静默不可授权**，而测试未必红（变量既不在白名单、也不在任何断言里）。所以：① `SyntaxSemanticName` 的拼写规则要与模式写在**同一处注释**里、互相指认；② 变异集除已有的 `[a-z]`→`[a-z0-9]`，**再加一条"把某个语义名改成下划线 ⇒ 必须红"**的变异（照本线纪律：变异值不得与基色同值，否则假绿——2-O/2-P 已各栽过一次）。

### 3.6 读取面：把 11 个语义槽纳入令牌基线

**必须做**，否则"改名零变化"无法证明（缺口 3）。做法：

1. `tests/theme-tokens/main.ts`：**`tokenNames` 手工追加 `Object.values(SYNTAX_TOKEN_MAP)`**（第二轮按 N6 定死这条路）。原因：`extractTokenNames(cssSource)` 只扫 `index.css?raw`（`main.ts:23`），而 **B1 不给 `index.css` 加任何语法声明** ⇒ 不追加则 B1 的基线 diff 恰为 **0 行**，§6.1/§6.6 写的"B1 恰增语法条目"会落空。
   - **两轮之间这里出现过三处互相矛盾的说法**（本节说"无需追加"、§5.1 表说"追加"、§3.4 / §6.2 说"自动"），现在**统一到"B1 手工追加"**，另两处措辞已同步改过。
   - **为什么"追加会掩盖缺陷"那条顾虑不成立**（两位审阅者一致的反对理由）：`tokenNames` 是**读取清单**、不是存在性断言。某槽在某外观没有值时 `getPropertyValue` 读到空串、**如实入基线**——基线里已有先例（`--reasoning-collapse-duration` / `--reasoning-fade-duration` 两条就是空串）。所以"浅色半边省略"在追加后**反而更显性**；读取面**不需要**为表达"light 省略"再做改造。
   - **B2 起两条来源取并集**：`index.css` 里的主题声明也会被 `extractTokenNames` 扫到，与手工清单合并（`Set` 幂等）。把这句话写进注释，否则 B1 收口时会答不出"基线为什么多了 11×2 条"。
2. `UPDATE_THEME_BASELINE=1 npm run test:theme-tokens` 重生成基线，**并逐行核对 diff 只新增语法条目、其余值一个未动**。这是本片的"零变化"证据。
3. **连带检查另外两个消费者**（`token-baseline.json` 除本套件外还被两个单测读）：`src/shared/tests/themeHardcodedAtoms.test.ts`、`src/shared/tests/neutralScale.test.ts`，需实测确认不受新增键影响。`token-contract.spec.ts` 自己的"stylesheet 里有、基线里没有"断言会先红、重生成后转绿（预期）。
4. **字面色护栏是否要加豁免——移到 B2 判定，且必须实测**（N7，两位审阅者同判）：`token-contract.spec.ts:146-171` 扫描 `index.css` 里所有 `--x: <字面色>;`，`--editor-` 已被豁免（`:154`）。护栏的 `HSL_TRIPLET`（`token-contract.spec.ts:37`）**只认空格三元组**（另加 hex / `rgba(` 两个分支）：
   - overlay 若写 **`hsl(286, 60%, 67%)`**（§3.3 示例的形状）⇒ **不命中** ⇒ **不需要豁免**；
   - overlay 若写 **`286 60% 67%`**（三元组）或 **`#c678dd`**（hex）⇒ 命中 ⇒ **需要豁免**。
   - 所以"需不需要豁免"**取决于 §3.5 的值形状，而值形状要到 B2 写值时才定**。**B1 列里不要预先把豁免记成必做**（初稿记错了）；B2 第一步先实测一条真实 overlay 声明跑过这条护栏，再决定写不写豁免——**不许再由 §3.3 的示例形状推**（那是"形状正好躲过"的巧合，不是设计）。

> 备选（**不推荐**）：不动 `tokenNames`，改用 `readSyntaxToken()` 逐槽断言。缺点是基线看不到语法色，**升名这个动作本身失去零变化证明**，而升名恰恰是本片最需要保护的一步。

### 3.7 四套 `full` 主题的语法板来源（B2 的内容）

| 主题 | 语法板来源 | 状态 |
|---|---|---|
| `cc-onedark` | `one_dark.xml`（One Dark Theme 插件） | **现成**：380 条带前景色的语法属性 |
| `cc-onedark-vivid`（B3 新增） | `one_dark_vivid.xml` | **现成**：其中 175 条相对 base 有变、128 条饱和度 +3pp 以上；**另加终端**——见下面那处订正 |
| `cc-catppuccin` | Codex 默认色板（暗 Mocha / 浅 Latte） | **参照物本身就是纯语法主题**——`index.css:1689-1692` 的注释已把这件事写着，只是当年没接线 |
| `cc-islands` | 平台 jar 里 Islands 的 editor scheme | **现成**：2-O 记录"另有 30 余条语法色本片未接线" |
| `cc-polar` | **无参照物**（自造主题） | 若不选"语法进 `MUST_MOVE.full`"，本片**可以不写**；若写，则用它的 lane 方法（保色相、定饱和、解明度）发明一套 |

> **订正（2026-09-30，B4 片）：上表的三处"浅色半无来源"全部作废——三套都有可引用的浅色答案，且没有一套是发明的。**
>
> | 主题 | 浅色半来源（新查明） | 性质 |
> |---|---|---|
> | `cc-islands` | `ManyIslandsLight.theme.json` 的 `editorScheme: "Light"` ⇒ 平台通用 `themes/Light.xml`（本机 `intellij.platform.ide.impl.jar` 内；内部名 "Light"，显示名 "IntelliJ Light"） | **官方**：浅色主题不挂自己的板，挂的是平台那份。此前记的"Islands 只有 `IslandSchemeDark.xml`"是"islands 目录下没有浅色文件"，不等于"没有浅色板" |
> | `cc-onedark` | **Atom One Light**（`one-dark-syntax` 的浅色姊妹板，即这套暗色板的源头） | **官方姊妹板**：插件四份文件全 `dark: true`，浅色答案在它的上游项目里 |
> | `cc-onedark-vivid` | 直接取 sibling 的浅色板 | **恒等派生**：插件官方 `scripts/create-vivid-variants.js` 是纯字符串 `replaceAll` 且只作用于三份 `dark: true` 文件，它换的五个 hex（`#e06c75` / `#56b6c2` / `#98c379` / `#abb2bf` / `#c678dd`）在浅色板里**一个都不出现** ⇒ 变换在浅色上是恒等，照搬 sibling 就是"把规则用上去" |
>
> 于是 §3.7 事实 2/3 那句"只有发明或不动两条路"不成立：`cc-onedark` 的浅色半本来**就是** One Light（基色 `prism-oneLight` 与它逐槽同源），另两套也各有引用对象。**`cc-polar` 仍然不写**（自造、无参照物，§8 决策 2 不变）。落盘与守卫见 B4 实施记录。

映射方法沿用 `SYNTAX_SELECTORS` 已经定下的口径：**参照物的语法属性 → 按色值分组 → 组内取语义最近的 Prism 类别**（`editorTheme.ts:104-144` 的 CodeMirror tag 映射就是照这个口径做的，`SYNTAX_SELECTORS` 注释 96-98 记录了"`class-name`/`number` 在两个 One Dark 主题里同色、`url` 是唯一的青"这类形状）。**必须承认一处已知不精确**：这个映射是按颜色而非按语义做的，所以少数槽的语义名与实际 Prism 槽位并不对应（主题文档 983 已记账，2-E 决策 5 也记过）。本方案不试图修正它，但要在文档里指回那笔账，别让读者以为是新引入的。

> **来源表必须与改动面同宽（第二轮新发现 B，OpenCode 提出、Claude 加固）**
>
> N4 把**终端**也划进改动面之后，上面那张"语法板来源"表就不够了——它只覆盖**暗色半**。要求改成：**每套主题 × 每个外观 × 每个面（语法 / 终端 / 灰阶）**都要写明来源，或如实写"**本片不动**"并进 §6.3 记账。**改动面定了，来源表必须同宽**（Claude）。
>
> 本轮实测的三条事实（B2/B3 开工第一步要做成一张完整的矩阵表）：
>
> 1. **终端面是外观无关的。** 终端板走 L1 的 20 条 `--palette-term-*`，每套 `full` 主题在**自己的 L1 块里只声明一次**（实测 `cc-onedark` / `cc-islands` / `cc-catppuccin` / `cc-polar` 各 20 条，`cc-ocean` 因为是 accent 而没有）⇒ **Vivid 的终端改动不需要明暗拆分**，没有"浅色终端来源"这个问题。
> 2. **语法面是外观相关的，而三个参照物没有浅色语法板。** One Dark Theme 插件 `one-dark-theme-6.2.5.jar` 里只有 `one_dark.theme.json` / `one_dark_vivid.theme.json`（两份都 `dark: true`）与 `one_dark.xml` / `one_dark_vivid.xml` 两份**暗色** editor scheme——**没有浅色版**；Islands 只有 `IslandSchemeDark.xml`（同样无浅色）。**只有 catppuccin 是双套**（Mocha / Latte）。
> 3. 所以 `cc-onedark` / `cc-onedark-vivid` / `cc-islands` 的**浅色语法半**只有两条路：**发明**（照 2-P 发明浅色壳的同一手法：保色相饱和、重解明度）或**本片不动**（浅色半保持基色 `prism-oneLight`）。
>
> **一条已有的巧合必须点明**：基色的浅色半本来就是 Prism 的 `oneLight`，而那正是 One Dark 那个项目的浅色姊妹板 ⇒ 对 `cc-onedark` 而言"浅色语法半不动"是**语义自洽**的（它已经像自己）；但对 `cc-onedark-vivid` **不是**——不动就意味着 **Vivid 只在暗色半可辨**，浅色下它与 `cc-onedark` 同板。因此 §3.8 的比较表要**按外观分别声明**，§6.3 的记账也是**两外观各一份 ＋ 终端一份**。
>
> **本方案的取舍建议**：`cc-onedark` / `cc-islands` 取"浅色半不动 ＋ 记账"（有上面那条巧合兜着，且不动即零风险）；`cc-onedark-vivid` 若要浅色半也浓彩，就得**发明**一套并按 §6.3 逐条记——这条与 N4 的 DoD 扩展一起进 B3 的开工清单。
>
> > **2026-09-30 订正**：本段的"不动"与"发明"两分法在 B3 时被采纳过（B3 三、1），随后被 **B4 推翻**——上表已查明三套的官方浅色来源，既不是不动、更不是发明。B3 那句"没有可迁移的规则"只对**它的暗色变换**成立（按色手调），对**浅色板**不成立：浅色板的规则是"照参照物取值"，而参照物确实存在。B4 记录见文末；§3.8 那条"一眼可辨只在暗色成立"的订正**仍然成立**（浅色下两套同板），但性质从"无来源的空白"变成"有据的同板"。

> **订正（审阅期间由本方案作者自查发现，非审阅者指出）："Vivid 不动终端"是错的。**
> 我此前判"终端 16 槽 0 变化"依据的是 `one_dark.xml` 的 **`<colors>`** 段（那里确实只有 `CONSOLE_BACKGROUND_KEY` 一条，`CONSOLE_*` 变 0 项）。**但终端的 ANSI 槽不在 `<colors>`，而在 `<attributes>`**——那里有 **21 条 `CONSOLE_*_OUTPUT`**，Vivid **改了其中 12 条**：
>
> | 改动 | base → Vivid |
> |---|---|
> | `CONSOLE_RED_OUTPUT` / `RED_BRIGHT` / `ERROR_OUTPUT` | `#e06c75` → `#ef596f` |
> | `CONSOLE_GREEN_OUTPUT` / `GREEN_BRIGHT` / `USER_INPUT` | `#98c379` → `#89ca78` |
> | `CONSOLE_MAGENTA_OUTPUT` / `MAGENTA_BRIGHT` | `#c678dd` → `#d55fde` |
> | `CONSOLE_CYAN_OUTPUT` / `CYAN_BRIGHT` | `#56b6c2` → `#2bbac5` |
> | `CONSOLE_WHITE_OUTPUT` / `NORMAL_OUTPUT` | `#abb2bf` → `#bbbbbb` |
>
> 未动的是 black / blue（含 bright）/ yellow（含 bright）三族。按 `cc-onedark` 那套"normal 与 bright 同值、靠加粗区分"的读法折算到 16 槽：**红/绿/品红/青各动 normal＋bright，白动一槽，共 9～10 槽移动**。
> **后果**：§3.8"Vivid 是纯语法板变体"的说法作废（见该节订正），§7 附录 C 里"Vivid 与 base 的差异量化"那一行也要按本节改写。**教训记账**：判"某段 XML 有没有改某能力"之前，先确认**该能力在哪一段**——`<colors>` 与 `<attributes>` 同名键并存（`CONSOLE_*` 两边都有），只看一段就会得出反向结论。这属本线"取证要读这一步的全部要求"的第 7 次命中。

### 3.8 新增主题：改判为 `one_dark_vivid`（非 Islands）

上一轮的推荐与本轮不同，理由是**前提变了**，如实记录：

| | 上一轮（语法不可达） | 本轮（语法可达） |
|---|---|---|
| Vivid 单做 | 与 `cc-onedark` 的可见差异 ≈ 正文灰从 `#abb2bf` 变 `#bbbbbb`，看不出是两套 | **多出 175 项语法色的加饱和**（＋终端 9～10 槽，见 §3.7 订正），一眼可辨 |
| Vivid Islands | 三条候选里唯一动两轴的 | 多出的 Islands 轴只带来"缝隙消失 ＋ 边框淡一点"，而那是 `cc-islands` 演过的手法 |
| 推荐 | Vivid Islands | **Vivid（`one_dark_vivid.theme.json` ＋ `one_dark_vivid.xml`）** |

选 Vivid 的额外好处：**它与 `cc-onedark` 共享全部底料**（四份文件里 `accentColor #568AF2` / `backgroundColor #202329` / `selectionBackground #323844` 完全一致），所以**底料层一次都不用动**，验收时"底料没变、其余按参照物走"是干净的。

> **订正（审阅期间自查）：不要再说它是"纯粹的语法板变体"。** 按 §3.7 的订正，Vivid 同时改了**终端**（12 条 `CONSOLE_*_OUTPUT`）与**正文灰**（`#abb2bf`→`#bbbbbb`）。所以它实际动的是**语法板 ＋ 终端 ＋ 灰阶**三条轴——底料不动，这才是准确说法。这**加强了** B3 的价值（更可辨），但也意味着 B3 的验收清单要同时覆盖终端与语法两面，不能只测代码块。
>
> **再订正（第二轮，按新发现 B）："一眼可辨"只在暗色半成立。** 上表那句"一眼可辨"是**未分外观**的宽读。实测：Vivid 的参照物只有暗色板，浅色语法半**没有来源**（§3.7 新发现 B）——若取"浅色半不动"，Vivid 与 `cc-onedark` 在**浅色外观下同板**，差别只剩正文灰。所以：
> - 本表的上表头要读成"**暗色半**"；
> - §6.3 的记账是**两外观各一份 ＋ 终端一份**（终端是外观无关的，见 §3.7 事实 1）；
> - B3 的 DoD 描述要从"代码块变"扩为"**代码块 ＋ 终端**，且代码块分两外观说明"（Claude 的加码）。
>
> **2026-09-30 追加（B4）**：浅色半已按 §3.7 订正表补齐（Vivid 取 sibling 的 One Light 板），于是"浅色下 Vivid 与 `cc-onedark` 同板"从**没来源的结论**变成**有据的设计**，并且有了断言钉着：姊妹差断言在浅色外观下给的是**空语法期望集**，两套浅色板任何一槽漂开即红（B4 变异 M1 实测）。上面三行不改。

主题名与 id 待用户定（§8 决策 5）。建议 id `cc-onedark-vivid`，显示名由用户给。

---

## 4. 与主题文档的冲突与改判

| 主题文档条款 | 原立场 | 本方案 |
|---|---|---|
| §8.9 / 4734；§5.9 / 652 | "**本轮不升语义名**"，只做 `SYNTAX_TOKEN_MAP` ＋ 黄金快照 ＋ denylist 三件事；语义名草案"阶段 2 前一次到位改名" | **本方案立项改名**，但**只升 11 个槽**、不追求"覆盖 Prism 与 CodeMirror 两套 token 体系的完整命名"（那是 4951-4952 当初把成本估高、进而推迟的原因）。范围从"全表命名"收窄为"契约面命名" |
| §5.7 / 566-576（改名轮 5 条到期条款） | 5 条互为一体，前提是"改名轮立项" | **只兑现第 4 条（§8.9 的 `--cc-syntax-N`）与第 5 条（2-C 白名单扩充）**；第 1/2/3 条维持悬置。其中第 2 条已由 2026-09-26 拍板为永久契约面 |
| §5.8 v4 / 624 | `--cc-syntax-*` 是**有意不授权的三族**之一，理由是"编号尚无稳定语义名、语义名要等阶段 2，授权会让主题绑上会重排的编号" | **理由消失**（编号槽仍不授权、授权的是语义槽）。三族变为两族（几何族、`--tw-*`），§5.8 需出 v8 并保留"为什么当年排除、今天为什么改"的沿革链 |
| §5.11 v7 / 695；1-E 记录 / 3741 | "语法高亮本轮不在任何覆盖层的可达范围内……`SURFACES` 里没有 `syntax` 组是如实反映边界而非漏写。**要把它纳入主题覆盖，得先做 §8.9 的改名／映射决策**" | **本条正是被执行的那句**。`SURFACES` 仍然没有 `syntax` 组，但**理由变了**：从"不可达"变成"可达但可选"（§3.4）。必须改措辞，否则读者会以为边界还在 |
| `src/index.css:1689-1692`（`cc-catppuccin` 的注释） | "语法那一半在 `.tmTheme` 里已经有家了，本主题给的是壳那一半" | **改判**：壳与语法改由同一套内置主题承担；`.tmTheme` 那条路仍在（用户仍可自装），但不再是"内置主题只能给一半"的**唯一原因** |
| §5.3（`coverage` 三值语义） | `accent` = 只动强调色族；`full` = 底料 ＋ 终端 ＋ 编辑器 ＋ Git 图 | **追加一句**：`full` **不承诺**语法板（可选面，同 `--term-font-family`），并互指本节 |
| 附录 A 令牌清单 | 有 `语法：--cc-syntax-0..N（由 Prism 主题编译产生）` 一行（4761） | 追加 11 个具名槽 ＋ 订正计数（136 中 11 具名 / 125 编号），并点名 **17 个刻意不升名的槽**（`code[…]` 三件套 `0`/`1`/`2` ＋ 半活的 `3` ＋ 仅暗色有值的 `5` ＋ 12 条 `::selection`），一行一槽、各写理由 |
| 审阅批注区（Claude 的 WARNING，4818）——**不是附录 B** | `--cc-syntax-N` 不是稳定契约（编号由遍历顺序决定） | **在 11 个具名槽上该 WARNING 失效**，需改判并注明生效范围（其余 125 项仍适用）。**引用已更正**（第二轮新发现 C）：`:4818` 落在主题文档的「## 审阅批注」区（该区始于 `:4807`），而真正的「## 附录 B：解包取证索引」在 `:4781`、内容是 WorkBuddy/Codex 的解包证据、与 `--cc-syntax-N` 无关。回写时**须写"审阅批注（Claude WARNING，4818）"**，否则下一位读者按"附录 B"去找会扑空 |

> 回写状态（**已落笔，2026-09-29**）：B1 实施后本表**逐条改写了主题文档**，并在主题文档侧反向标注本方案为改判来源（照终端字体那一轮的闭环体例）。实际落点与本文的差异，如实记两处：① 本表把审阅批注区的定位写成 `:4818`，那正是主题文档在**审阅时刻**的行号——B1 的段落写进去后该条**已下移**，故主题文档在原批注下追加的"B1 改判"注里**写明 `4818` 是审阅时刻的行号并指出它已下移**，不把过期行号当活引用；② 本表为 B2 / B3 预留的"逐套记录 / 片记录 ＋ 切片表一行"**已落**（B2 见"B2 实施记录"、B3 见"B3 实施记录"，主题文档切片表升 **v17**：B2 / B3 两行改为已实施 ＋ 各加一句逐套可见变化），切片表另按本表登记了 N10 的"待排期"行（**该行已于 2026-09-29 收口，见主题文档 §6 末的 N10 记录**）。主题文档的四处落点：§5.3 v12、§5.8 v8、§5.9 表格行、§5.11 v7 的边界改判，另加附录 A 的 11 具名槽清单与审阅批注区那一注。

---

## 5. 实现清单（分片）

### 5.1 B1 — 机制（可独立合入，基础层零变化）

**生产代码**

| 文件 | 改动 |
|---|---|
| `src/shared/syntaxTheme.ts` | ① `SYNTAX_SELECTORS` 增 1 项（`blockForeground` → `pre[class*="language-"].color`，**审阅后由 `code[…]` 改判**）；② 由它派生一张反向表 `selector.property → 名`；③ `buildSyntaxTheme()` 用反向表决定名字（命中语义名、未命中编号）；④ 更新模块注释：说明"契约面 11 个 / 其余编号"这条界线，**并点名 17 个不进契约面的槽、逐槽给理由**（见 §3.2 那张一行一槽的表；**计数据第二轮由 15 修正为 17**——初稿把半活的槽 3 排除、又漏了槽 5） |
| `src/shared/userThemeStyles.ts` | **零代码改动**，但注释要动：`COMPILED_OUTPUT_FINGERPRINT = JSON.stringify(SYNTAX_TOKEN_MAP)`（`:86`）在升名后必然变化 ⇒ 旧编译产物在 `:476` 的指纹校验失配、主题**全员重编译**（预期行为，写进 B1 记账）。同时该指纹的注释（`:67-86`）讲的是"Prism bump 会重编号"的场景，升名后编号槽不再被任何编译产物点名、指纹也不再随 Prism bump 翻动——**这正是注释预告的"正确"行为**，注释宜顺手更新，别让两段文字打架 |
| `src/shared/userThemeTokens.ts` | `FAMILY_RULES` 增 `--cc-syntax-<letter…>` → `expression`（放在数组正确位置）；同步模块注释里那段"有意不授权的三族"（变两族） |
| `src/shared/tmTheme.ts` | **零代码改动，只有措辞要改**（第二轮新发现 A，OpenCode）：`:117` 的 "the **ten** semantic names" 与 `:127` 的 "a deliberate **ten**-slot projection" 都要改成 **eleven**。**连锁必须记名**（见右栏）：`:433` 的产出循环遍历 `Object.keys(SYNTAX_TOKEN_MAP)`，新键会被**每个 `.tmTheme` 的编译产物自动多出一条** `--cc-syntax-block-foreground = 全局前景`（该策略被 `tmTheme.test.ts:130-142` 固化："a slot no rule mentions takes the global foreground"）。**裁定：保留**（不改循环）——TextMate 的全局前景本来就是正文色，且**今天 `.tmTheme` 用户的代码块正文色是 Prism 的 oneDark/oneLight 灰**（编号槽 4 无人声明），那正是本方案要修的"两套板混在一个文件里"。代价是 **B1 对 `.tmTheme` 用户不再"零渲染变化"**，故 §5.1 验收口径 / §6.1 / §6.3 都要按此收窄措辞。**被否的备选**：把循环收窄到 `SYNTAX_SCOPE_PATTERNS` 能产出的槽集——它要写代码、且唯一效果是**保住一个错值** |

**测试**

| 文件 | 改动 |
|---|---|
| `src/shared/tests/syntaxThemeTokenMap.test.ts` | ① 黄金快照重录（11 个名字替代对应编号）；② `ONE_DARK_SLOT_COLOURS` 补 1 项（**TS 会强制**）；③ 新增一条"11 个具名槽的**值**未移动"的断言（现有那条只锁名字，值锁在 `ONE_DARK_SLOT_COLOURS` 的暗色半边——**建议同时补浅色半边**，因为 light 是 `buildSyntaxTheme` 会省略属性的那一侧）；④ denylist 保持不变（可加一句注释说明为何不变） |
| `tests/theme-tokens/main.ts` | `tokenNames` **手工追加** `Object.values(SYNTAX_TOKEN_MAP)`（N6 定案，见 §3.6-1） |
| `tests/theme-tokens/token-baseline.json` | 重生成（**逐行核对只增语法条目**） |
| `tests/theme-tokens/token-contract.spec.ts` | **本轮不动**：字面色豁免移到 B2 判定（N7，见 §3.6-4）——先实测一条真实 overlay 声明跑过护栏，再决定写不写 |
| `tests/theme-tokens/theme-overlays.spec.ts` | **不改 `SURFACES`**。新增三条：① 全有或全无（读 `index.css`，结构检查，**按外观各自判定**）；② 声明即生效（对声明了语法槽的主题逐槽比对，复用 `resolve()`／`tripletReference` 两条比法，见 §6.2）；③ **结构测试：遍历 `SYNTAX_TOKEN_MAP` 的每个非编号名逐条过 `FAMILY_RULES`**（N13，把"某天会静默失配"从"靠变异兜"变成"当场红"；判"哪种 token 算语法槽"也以 `Object.values(SYNTAX_TOKEN_MAP)` 为**单一来源**，不写第三个正则） |
| **4 个被升名击穿的既有测试文件**（附录 A 初稿漏列，N8 补） | **不逐个写死新名字**，把 `/^var\(--cc-syntax-\d+\)$/` 一类放宽到 `[a-z0-9-]+`：`src/shared/tests/syntaxTheme.test.ts:81`、`src/modules/code-editor/tests/markdownCodeBlockSyntaxTheme.test.tsx:57/:67/:86`、`src/modules/chat/tests/markdownSyntaxThemeInjection.test.tsx:39/:83`（`:71` 会先红）、`src/modules/code-editor/tests/editorThemeTokens.test.ts:75`（连带 `:79` 的 `borrowed.length >= 10`）。**注意**：`syntaxTheme.test.ts:100` 测的是**不升名**的槽 3 ⇒ 放宽后**继续绿**，别把它当"该红"样本；`editorThemeTokens.test.ts:66` 已是宽正则、`:75` 还是 `\d+`，**同文件并存**，修时顺手扫同文件还有没有别的 `\d+` 语法正则（Claude） |
| `src/shared/tests/tmTheme.test.ts` | 补一条锁定"**第 11 槽也回落全局前景**"的用例（新发现 A；既有 `:130-142` 锁的是 `punctuation` 那一条）；`tmTheme.test.ts:144` 的"全局前景不得写进 UI 令牌"不受影响 |
| `tests/theme-tokens/user-theme-syntax.spec.ts`（新）或并入既有 `user-theme-tokens.spec.ts` | ① `.json` 主题现在可以设 `--cc-syntax-keyword-color` 并生效；② 设 `--cc-syntax-3` 仍被丢弃并上报；③ `var(--cc-syntax-keyword-color)` 合法、`var(--cc-syntax-3)` 非法 |
| `::selection` 判死实验（**Claude 要求列为 B1 实施期强制项**，N2） | OpenCode 给的读法：① 注入真规则 `code[class*="language-"]::selection{background:#ff0000}` → 拖选代码块文字 → **对选中区截图像素取样**，应变红（证明"通路存在但今天空载"）；② 移除注入再取样 ⇒ 应回落浏览器默认（≠ oneDark 槽值 `#3e4451`/`#9da9bf`），判死旧因果。**双引擎跑**；`getComputedStyle(el,'::selection')` 跨引擎不稳，以**像素**为准 |

**B1 的验收口径**（第二轮按新发现 A 收窄了措辞，**不要把"零变化"读成全场景**）：

- **基础层零变化**（基线 diff 只增语法条目）；
- **四套内置覆盖层都还没声明语法槽**，所以**内置主题下的代码块视觉不变**；
- **一处例外必须记名**：`.tmTheme` 用户的代码块**正文色会变**——新键经 `tmTheme.ts:433` 的产出循环自动落进每个 `.tmTheme` 的编译产物、取该主题的**全局前景**（裁定见 §5.1 生产代码表那一栏）。**这不是副作用而是修好了原本的错值**（今天那里是 Prism 的 oneDark/oneLight 灰），但它确实超出"零变化"，故进 §6.3 记账；
- **旧编译产物会被指纹自动作废**：`COMPILED_OUTPUT_FINGERPRINT = JSON.stringify(SYNTAX_TOKEN_MAP)` 随升名变化 ⇒ `userThemeStyles.ts:476` 的校验失配 ⇒ 文件主题**全员重编译一次**（预期行为；这正是该模块注释 `:463-466` 预告的场景——"a compiler whose output embeds build-derived names"）。**这条同时保证了升级后不会有"旧编号名"的缓存残留**；
- 白名单新能力可用（`.json` 主题可设语义语法槽、设编号槽仍被丢）。

### 5.1b B1b — 容器底色（**第二轮定为 (a2)：新增令牌、四路同值**）

| 文件 | 改动 |
|---|---|
| `src/index.css` | 新增一个 L2 容器令牌（名待定，如 `--code-block-bg`），在 `:root` / `.dark` 各给基色值 |
| `src/modules/chat/transcript/Markdown.tsx:134` | `bg-muted/50 … dark:bg-n-zinc-900` → 引新令牌（**这是把 `--n-zinc-900` 这个兼容原子从一处消费里换掉**，方向与阶段 0 的迁移一致，但会让该处进入主题可达范围） |
| `src/modules/code-editor/markdown/MarkdownCodeBlock.tsx:70-77` | 明色的 `hsl(var(--muted))` 与暗色的 Prism 回落**统一**到新令牌（消掉那个"两外观不对称"）。**行号已核**：`:75` 是 `...(isDarkMode ? {} : { background: 'hsl(var(--muted))' })`、`:77` 是 `codeTagProps` |
| `tests/theme-tokens/theme-overlays.spec.ts` | **不进 `SURFACES`**（审阅后定：容器令牌与语法同判，否则 §5.3 的 `full` 措辞自相矛盾），改用"声明即生效"的同类独立断言 |
| `src/index.css` 各主题块 | 五套主题各补一值（来源：One Dark `#282c34`、Catppuccin `base`、Islands 的 editor 底色、`cc-polar` 的编辑器底） |

**第二轮的选择：(a2)，两位审阅者一致，牵头采纳。** 理由（两边给的是同一条）：`cc-onedark` 的编辑器页 `#282c34` **≠** 它的暗色 `--muted`（实测 `218.57 12.07% 22.75%` ≈ `#333841`，`--muted` 走 `--palette-ink-850`、本就在 `SURFACES.substrate` 里 ⇒ 主题可达性无疑）⇒ **"代码块底可以不同于 `--muted`"是一个有实际买主的能力**；而 (a1) 换成 `--muted` 就把这个能力丢掉了，还会让三种画法长期共存、日后收口要第二次动消费者。

**(a2) 的代价必须逐条记账（§6.3）——共 3 处视觉变化**：(a2) 让四路同值，而今天这四路**形态本就不一致**（chat 明色 `--muted`＋50% alpha 半透明、chat 暗色 `--n-zinc-900` 不透明、编辑器明色 `--muted` 不透明、编辑器暗色 Prism 色不透明），所以：(i) chat 明色由"半透明"变"同值"、(ii) 编辑器明色由 `--muted` 变新令牌值、(iii) 编辑器暗色由 Prism 色变新令牌值。**这三处在动手前要先写进 §6.3**，否则会被当成意外。

**两个内部决定（第二轮已定 / 已明确顺序）**：

1. **值形状：triplet ＋ 消费处写 alpha——已定**（两位审阅者一致）。能保住 chat 明色 `bg-muted/50` 的**半透明质感**（消费写 `hsl(var(--code-block-bg) / 0.5)`），且与 L2 既有的 `--muted` / `--background` 形状一致。代价：triplet 走 `SEMANTIC_TOKENS` 轨道 ⇒ **用户 `.json` 主题可以设它**；完整表达式走 `FAMILY_RULES`（如语法那条 `expression`），语义更严但用户可设性要另定。**联动两条**（OpenCode）：① 若当初取 (a1) 本条消失——现在取 (a2) 故成立；② **取 triplet ⇒ B1b 自己就需要字面色豁免**（overlay 写的是 `220 13% 18%` 这种三元组，正中 N7 的护栏）。这与 §3.6-4 的"豁免移 B2 判定"是**同一件事的两处**，实施时一并处理、别记两次。
2. **明色半边逐套来源：开工第一步先出表，再动代码。** 统一到令牌后明色**不再有 `bg-muted/50` 兜底**，所以每套都要显式写清（Latte 的代码底、One Light 的代码底、Islands 明色编辑器底、`cc-polar` 的编辑器明色底）。**逐套值要连同"参照物 → 令牌"的映射一起记账**，同 B2 的要求（格式与 §3.7 那张同宽的来源矩阵一致）。

**B1b 的验收**：两处消费者在**两种外观**下画出的底色相同且等于新令牌的解析值（真引擎读 `getComputedStyle`，不要靠肉眼看截图——2-P 已经栽过一次"连续 N 帧不变"的假稳定判据）。

**可复用结论（2-P 教训，此片必踩）**：`bg-background` 这类元素带 `.transition-colors`（`background-color 0.2s`），**任何即时读值都会读到插值中间色**；先读 `transitionDuration` 再等"最长时长 + 250ms"，或拿"同规则无过渡探针"的瞬时值当期望。尤其当两个外观的差 < 8 位量化步长时，"连续几帧不变"的判据会在过渡刚起步时就成立。

### 5.2 B2 — 回填四套既有 `full` 主题的语法板

每套主题一个独立提交，逐套刷基线（照既有节奏：片内逐片刷、只合并构建与全量测试）：

1. `cc-onedark` ← `one_dark.xml`
2. `cc-catppuccin` ← Codex Mocha / Latte
3. `cc-islands` ← 平台 jar 的 Islands editor scheme
4. `cc-polar` ← **视 §8 决策 2 而定**：若选"可选"则本片不写（并作为"可选面"的活例子留在文档里）；若选"强制"则用 lane 方法发明

**B2 第一步（不是写值，两步前置）**：① **实测字面色护栏**——把一条真实 overlay 声明（triplet 或 hex 形状）跑过 `token-contract.spec.ts`，据此决定要不要加 `--cc-syntax-` 豁免（N7，见 §3.6-4；**不许由 §3.3 的示例形状推**）；② **出同宽的来源矩阵**（主题 × 外观 × 面：语法/终端/灰阶，见 §3.7 新发现 B），**先出表再动代码**。

**逐套的记账要求**：参照物 → 11 槽的映射表 ＋ **每一处"照抄参照物会被自家契约拦下"的偏离**（这条在本线已第 4 次命中：2-N 的 `subtext0` 4.37:1、2-O 的 `--palette-frost-50`、2-P 的 `accentColor` 3.33:1）＋ **每个"本片不动"的面**（尤其浅色语法半，见 §3.7 事实 2/3）。

### 5.3 B3 — 新增 `cc-onedark-vivid`

注册表一行（`src/shared/constants.ts`，`appearance: 'system'` / `source: 'builtin'` / `coverage: 'full'`）＋ 三块 overlay（L1 ＋ 明色半 ＋ 暗色半）＋ 11 条语法槽 × 2 外观。底料与 `cc-onedark` 逐项相同（四份文件共享核心色板），**只有语法板 ＋ 终端板 ＋ 那处灰不同**（`foregroundColor #abb2bf`→`#bbbbbb`；终端 12 条 `CONSOLE_*_OUTPUT` 折 9～10 槽；`selectionBackground` 之外无他）。

**B3 的 DoD 描述（第二轮按 N4 扩写，Claude 加码）**：不能只测代码块——要写成"**代码块 ＋ 终端**，且代码块**分两外观**说明"：终端面走既有 `terminal-tokens.spec.ts` 的消费者守卫范式（真 xterm 读画出的 ANSI 色；注意 normal/bright 同值对的折算口径，即 §3.7 订正里"9～10 槽"的由来）；代码块的浅色半**要么发明并记账、要么明确写"不动"**（§3.7 新发现 B）。**若验收口径不写清，实施时会只补一个终端 spec 而漏改 §3.8 与 §6.3。**

---

## 6. 验收标准（DoD）

### 6.1 零变化（G4）

- **先给"零变化"下一个精确的定义**（N14，第二轮补）：**零变化指渲染值不变，产物文本会变**——B1 升名后注入的 `<style id="cc-syntax-theme">` 里 11 个变量**名字换了、值没换**。不写这句，B1 收口时的产物 diff 会被误判成违反承诺；**核对方法是逐槽比"值"，不是比产物文本**。
- 基线重生成的 diff **只含新增的语法条目**，其余条目逐字节不变（人工核对 + 可脚本化）。
- `--cc-syntax-*` 的 11 个具名槽：**名字变了、值没变**（黄金快照 ＋ 明暗两张期望色表）。
- 无主题态 / `cc-light` / `cc-dark` 的**代码块**渲染值与今天相同（真引擎读 `readSyntaxToken`）。
- **一处例外（新发现 A，必须单列，别混进上面三条）**：装了 `.tmTheme` 的用户，代码块**正文色会变**（新键自动落入其编译产物，取该主题的全局前景，见 §5.1 与 §5.1 验收口径）。**这是修好原本的错值，但它不属于"零变化"。**
- **另一处非渲染面的变化**：用户主题的编译缓存会被指纹作废、**全员重编译一次**（预期；同时保证不会有旧编号名的缓存残留）。

### 6.2 覆盖层真的能改（G1）

对**每个**声明了语法槽的主题、两种外观：

- **声明一致性（值形状已定，审阅后）**：**不要**拿 `readSyntaxToken(槽) === 该块声明的值`——前者是**计算色**（`rgb(198, 120, 221)`）、后者是**声明文本**（`#c678dd` / `hsl(286, 60%, 67%)`），两种形状直接比**永不成立**（审阅者指出）。改为：① 声明一致性走 `readWithTheme().tokens`（比**原样声明文本**，形状天然一致）；② 需要计算色时照 `user-theme-tmtheme.spec.ts:60-65` 的 `tripletReference` 范式，**把期望值也过一遍探针**再比。两条分工写进 DoD，缺哪条都会写出"一写出来就红"的断言。
  > **①的前提是 §3.6-1 的手工追加**（N6 定案）：`extractTokenNames` 只扫 `index.css`，B1 不往那里加声明 ⇒ **不追加就读不到语法槽**，本条会静默变成"比空集"。措辞在第二轮由"自动收录"改为"手工追加"——**这里是最容易把 N6 又改回错口径的地方**。
  > **B2 起此前提失效（2026-09-29）**：B2 把 44 条 `--cc-syntax-*` 声明写进了 `index.css` 的覆盖层块，`extractTokenNames` 因而**自动收录**这些名字（`main.ts` 里那份手工追加保留但不再是唯一来源）。"不追加就读不到"只对 B1 那一版的树成立，见 B2 实施记录"三、2"。
- **顺序证明**：调 `reinjectSyntaxStyleSheet()` 把基色表重新插到最前，再读一次，值**不变**（照 `user-theme-tmtheme.spec.ts:98-127` 的范式）。
- **必须有一条红色的反证**：把基色表从"最前"改成"追加"，上述断言应当红。**否则这条证明是空转**（2-E 决策 8 修掉的正是这个隐患，别让它悄悄退化）。这条反证需要 `reinjectSyntaxStyleSheet()` 出一个 **append 变体**（现签名无参）——**机制改动要写进附录 A**，否则 DoD 里最硬的这条验收实现时会卡壳。
- **`--cc-syntax-block-foreground` 单独一条（审阅后加强）**：探针只证明"令牌能解析"，而这一项的选型断言是"**哪个元素在画代码正文**"。所以要在**真实渲染的代码块**上**同时读 `<pre>` 与 `<code>` 的计算 color**，并确认：① 两者同值（说明正文色确由继承而来）；② 它随主题移动。**反证（两段）**：把该主题块里的这一条删掉，两个元素**都应回落**到基色；若只有 `<code>` 回落而 `<pre>` 不动（或反之），说明选错了元素——那正是初稿的错误形态。
  > **读法细节（OpenCode 补，两位采纳）**：删声明后 `<code>` 的回落**不是独立的**——它是**继承** `<pre>` 的回落值。所以断言要写成"**两元素同值、且该值等于基色表的槽 4 base 值**"，而不是各自独立去比一个期望值；后者会把"继承"错读成"两条独立路径恰好相等"。
  > 这条反证在 fixture 读真 `index.css` 的前提下需要一个可行的"删法"（CSSOM 删声明，或把该令牌显式置回基值）——**也要写进附录 A**。
- **`::selection` 判死实验（N2，Claude 要求列为 B1 实施期强制项）**：读法与出处见 §5.1 测试表末行。**目的不是证明"颜色不对"，而是证明"通路存在但今天空载"**——它判死的是 OpenCode 第一波那条因果（"选中色停在 oneDark 蓝上"），而两位审阅者已在第二轮各自撤回该因果。
- **次一级反证（细则 5）**：重命名前后 `deriveTokenMap()` 的输出**逐槽相等**（键同一、变量名按新规则）。这条守的是"拆名没改变反查语义"，即 0-D 那层间接的红利真的兑现了。

### 6.3 有意的视觉变更逐条记账（G2/G3）

这一条不是"零变化"，是**本片的目的**，必须写成清单而不是一句"已知变更"。**清单的形状在第二轮被扩了三处**（务必按新形状写，否则会漏）：

1. **按外观分列**：代码块的颜色变化是**两外观各一份**（语法板天生外观相关，§3.3）。**不要**只写"暗色下更好看"——浅色半可能是"本片不动"，那是一行必须写出来的记录，不是空白。
2. **终端单列**：N4 之后终端也是改动面，与外观无关（§3.7 事实 1）⇒ 单独一份清单（来源：`<attributes>` 的 `CONSOLE_*_OUTPUT`，折 16 槽时**写明 normal/bright 的折算口径**）。
3. **"本片不动"的面要显式成行**（§3.7 新发现 B）：**尤其某套主题的浅色语法半没有来源时**——`cc-onedark` / `cc-islands` 的浅色半当时按"不动"记，就写"浅色半保持基色 `prism-oneLight`"并注明这是**有意的、不是漏做**。
   > **2026-09-30 由 B4 收口**：三套的浅色来源都已查明（§3.7 订正表），浅色半已各自补齐，本条现在的适用范围只剩**真的没有来源**的主题——目前只有 `cc-polar`（自造板）。B4 的记账见文末实施记录"六"。

**B1 自己就有一处必须记账的变化（新发现 A）**：`.tmTheme` 用户的代码块**正文色**从 Prism 的 oneDark/oneLight 灰变为该主题的全局前景（§5.1 生产代码表已裁定"保留"，理由是今日那个值是"两套板混在一个文件里"的错值）。**这是 B1 片里的用户可见变化**，不能只写在机制说明里。

**B1b 采纳 (a2) 后要记的 4 条**：
- 三处消费者形态变化（详见 §5.1b 的 (a2) 段：chat 明色由半透明变同值、编辑器明色、编辑器暗色）；
- **一条反向后果（细则 4）**：`--n-zinc-900` 被换掉后，"**暗色代码块底色永久固定**"这个保证随之消失——该处变得可被主题移动。这是**有意的**，但要写进这份清单，否则评审会把它当成破坏既定契约。判据是"替换兼容原子的消费 ≠ 打开 `fixed` 边界"：被替换的是**这一处消费者**，`--n-zinc-900` 自身仍在 `fixed` 组里、别处不动。

### 6.4 全有或全无（结构）

读 `index.css`：任一主题声明了语法槽 ⇒ **对其声明的每个外观**，该外观基色表声明过的槽必须全声明（细则 3：按外观各自判定，且允许"参照物在该外观本就没有值"的槽少写并记账，**不得逼主题造参照物不存在的值**）。**反证**：故意漏一个槽，断言必须红。

**两条"单一来源"约束（N13，第二轮两位都加码）**：这三处都在判"哪些名字算语法槽"——(i) 生成器的反向表、(ii) 白名单的家族模式、(iii) 本节的 all-or-nothing．**只有 (i) 是真源**，另两处必须以 `Object.values(SYNTAX_TOKEN_MAP)`／`SYNTAX_SELECTORS` 为准，**不许再写第三个手打清单或第三个正则**（否则某天某个名字含下划线会**静默失配**）。
- 因此新增一条**结构测试**：遍历 `SYNTAX_TOKEN_MAP` 的每个**非编号**名，逐条过 `FAMILY_RULES` 的匹配，**全过得通过**。它把 Claude 细则 3 指出的隐患从"**靠变异证明护栏会红**"升级成"**护栏恒真**"——一条测试、成本极低。

### 6.5 变异测试

每片按既有节奏给变异集，**每条变异恰 2 红（chromium ＋ webkit）**。至少要打到：

- `[a-z]` 开头那条模式放宽成 `[a-z0-9]`（编号槽应立刻变成可授权）；
- **（审阅后新增）某个语义名改用下划线**（如 `block_foreground`）⇒ 必须红（守 §3.5 的"模式与名字符集同源"）；
- **（N8 的边界钉法，两位都提）把放宽后的宽正则改回 `\d+`** ⇒ **恰是 N8 列的那几个文件红，而 `syntaxTheme.test.ts:100` 仍绿**（它测的是不升名的槽 3）。这条不是"证明护栏会红"，而是**证明"放宽"这个动作的边界没被放宽过头**——少了它，把正则写成 `.*` 也照样绿；
- 反向表里某槽的名字写错/漏项（生成物应出现编号而不是语义名）；
- 基色表注入位置从"最前"改成"追加"（顺序证明的那条应红）。
- **（新发现 A）把 `tmTheme.ts:433-434` 的回退改掉**（`slotColours.get(slot) ?? foreground` → 不回退）⇒ 既有的 `tmTheme.test.ts:130-142` 与新加的"第 11 槽回落全局前景"用例**都应红**。它守的是"新键的连贯行为有测试兜着"，不然这条连锁只存在于文档里。
- **注意变异值不得与基色同值**：2-O / 2-P 已各栽过一次"变异写成与基色同值 ⇒ 假绿"（本线纪律：每条变异先确认它真的把值改掉了；**2-P 那次是重复犯错**）。

### 6.6 门槛（每片收口时逐片刷）

`npm test`（含服务端树对照）、`test:client`、`test:theme-tokens`（A/B：B1 应恰增"基线条目数"；**B2 实测推翻本条原写的"B2/B3 逐套递增"** —— `captureSnapshot` 只读光明/暗基色、**不挂任何 `data-theme`**，所以覆盖层声明**永远不会进基线**，B2 的验证只能靠 `theme-overlays.spec.ts` 的逐主题断言（见 B2 实施记录"三、1"））、`lint`、`typecheck` ＋ `typecheck:theme-tokens`、`build`。**三片都不动 `server/`**，因此按既有纪律可以先取"服务端树逐字节相同"这条**更硬**的对照（`git diff <上片 docs commit> HEAD -- server/` 与 `git status --short -- server/` 同时为 0）来豁免名字集 A/B；若中途有任何一片动到 `server/`，该豁免立即失效、老实做名字集 A/B。

---

## 7. 风险与坑

| 风险 | 说明 | 处置 |
|---|---|---|
| **改了名字，值跟着动了** | 升名是纯改名，但 `buildSyntaxTheme` 的编号分配与名字分配写在同一个循环里，改错会把"第 N 个差异"对应到别的槽 | 黄金快照按 `selector.property` 为键（快照是键→名的表，键不变可证槽位没动）＋ 明暗两张期望色表 |
| **夹具的时间抖动** | 2-P 的真机核验中，`.transition-colors` 0.2s 让"连续 N 帧不变"的稳定判据在总变化量 < 8-bit 量化步长时提前退出（已记入记忆第十八层） | 语法断言用 `readSyntaxToken` 的**瞬时探针**（`transition: none`，`main.ts:291-301` 已这么写），不依赖"等稳定" |
| **基线是共享文件** | `token-baseline.json` 被三个测试读（`token-contract.spec.ts`、`src/shared/tests/themeHardcodedAtoms.test.ts`、`src/shared/tests/neutralScale.test.ts`，另有 README 提及），重生成是整文件覆写 | 重生成后逐行核对 diff；并实测后两个测试不受新增键影响 |
| **字面色护栏会误伤** | 覆盖层里的 `#hex` 会被 `token-contract.spec.ts:146-171` 抓住 | 加显式 `--cc-syntax-` 豁免（理由＝"完整的 CSS 颜色值"，与 `--editor-*` 同类），**不要靠形状巧合躲过** |
| **`syntax` 不进 `SURFACES` 被读成疏忽** | 主题文档已经因同类事被评审指出过漏迁 | §3.4 的机械理由必须**连同一句"这是刻意的可选面"**一起写进 `theme-overlays.spec.ts` 的注释与主题文档 §5.11 |
| **浅色半边的省略属性** | `buildSyntaxTheme` 对 light 只在 `lightValue !== undefined` 时写声明（`syntaxTheme.ts:58-66`），所以某些槽在 light 下**本就没有声明** | 具名槽必须逐个实测"light 下有没有值"；MUST_MOVE 类的断言若用在 light 上需先确认槽存在（本方案因不进 `SURFACES` 而绕开，但 B2 写值时要看清"这个槽 light 有没有基线"） |
| **`full` 语义含糊** | 语法可选、`full` 却不含它，读者会问"那 `full` 到底全在哪" | §5.3 明写"`full` = 底料 ＋ 终端 ＋ 编辑器 ＋ Git 图，不含代码块"，并互指 §3.4 |
| **改了契约面却忘了授权引用** | 若只加家族规则而漏了 `expression` 分支的引用检查，`var(--cc-syntax-3)` 可能借道进来 | 决策 3 里那条"引用目标也须可授权"是既有的，**B1 要专门加一条"`var(--cc-syntax-3)` 必须被丢"的用例** |
| **把死槽当活槽升名** | `code[…]` 的 `background`/`color`/`textShadow`、槽 5 的 `textShadow`、12 条 `::selection` 均无生效通路（前者因 `codeTagProps` 被两个消费者显式覆盖、后者因这套库根本不序列化选择器）；初稿还错把 `code[…].color` 当成活槽 | §3.2 用一张**一行一槽**的表点名 **17 个**槽及各自理由，并单列"第 11 槽改判"；B1 的注释与测试各写一句理由 |
| **`.tmTheme` 的连锁没被预见**（新发现 A） | 给 `SYNTAX_SELECTORS` 加键，经 `tmTheme.ts:433` 的"遍历 `SYNTAX_TOKEN_MAP` 全键 ＋ 未命中回落全局前景"自动改变**每个 `.tmTheme` 的编译产物**（正文色槽多出一条声明）；方案初稿通篇未提，§1.2 缺口 4 只写了"它也能改语法色"的现状 | 裁定**保留**（语义正确、且修的是错值）并**单向记账**：§5.1 生产代码表 ＋ §5.1 验收口径 ＋ §6.1 ＋ §6.3 四处都点名它；`tmTheme.ts:117/:127` 的 "ten" 改 "eleven"；补一条锁定用例 |
| **来源表比改动面窄**（新发现 B） | 语法板来源表只覆盖暗色半，而 N4 之后改动面已含终端与灰阶，且**三个参照物没有浅色语法板**（One Dark 插件、Islands 均为暗色单板） | §3.7 立"主题 × 外观 × 面"同宽矩阵，允许写"本片不动"但**必须成行**；§3.8 的比较表按外观分声明；§6.3 按新形状写清单。**2026-09-30 复查**：矩阵已同宽，而"三参照物无浅色板"这半句是**误读**（B4 查明三套都有官方浅色来源，见 §3.7 订正表）——风险本身已消解，留此条作"取证要读到平台级/上游级文件"的教训 |
| **暗色代码块底是兼容原子** | chat 暗色底走 `dark:bg-n-zinc-900`，落在 `fixed` 组保护的那层骨架里 | 决策 4；若取 (a)，文档要写清这是"**把一处兼容原子的消费换成令牌**"（方向与阶段 0 迁移一致），**不是**打开 `fixed` 家族的边界——两者必须分开说，否则会被读成破坏既定契约 |
| **映射按颜色而非语义** | `SYNTAX_SELECTORS` 的既有口径是"色值组优先、组内取语义最近类别"，少数槽名实不符 | 沿用、不修，文档指回主题文档 983 与 2-E 决策 5 的旧账 |

---

## 8. 决策项

> **第二轮审阅后的状态（2026-09-28）**：第一轮这 7 项**两位审阅者结论一致、牵头全部采纳**（逐条判定见 `### 牵头结论`）；第二轮就 N1–N14 逐条表态、**全部收敛**（见 `### 牵头结论（第二轮）`），并带出三条新发现 A/B/C（A、C 由本方案认领为新增改动，B 落到 §3.7）。
>
> **因此本表现在只剩"用户偏好"级的两处需要点头**（第 3 项的新名字、第 5 项的显示名）；其余各项**已无未统一意见**，可直接进入实施。下表保留为决议记录。
>
> 另：原先列为"实施时须先定的内部决定"的两条（**B1b 容器令牌值形状**、**各套主题的明色半边来源**）**已在第二轮定下**（triplet ＋ 先出表，见 §5.1b）；新发现 A 的"保留 vs 收窄"由牵头裁定为**保留**（§5.1 生产代码表）。

1. **范围**：只立"改名轮"的第 4 / 5 条，其余三条维持悬置——是否同意？（§0-2、§4）
2. **契约面**：语法**可选**（推荐，不纳入 `SURFACES`）还是**强制**（纳入 `MUST_MOVE.full`，代价是 `cc-polar` 必须自造、且未来 chrome-only 参照物不许标 `full`）？（§3.4）
3. **命名**：`--cc-syntax-<role>-color`（11 个里 10 个）＋ **`--cc-syntax-block-foreground`**（审阅后由 `code-foreground` 改名，因为绑定从 `code[…]` 改判到 `pre[…]`；第二轮两位审阅者一致确认新拼写）这套拼写是否采用？（§3.1、§3.2）
4. **容器底色**：取 **(a2) 新增容器令牌、四路同值**（第二轮两位一致表态，牵头采纳）、**(a1) 最小**（只换 chat 暗色、不加令牌）、**(b) 撤掉 chat 的 `transparent`**（未获支持）、还是 **(c) 本片不做、如实记账**？（§3.2b、§5.1b）
5. **新主题**：id `cc-onedark-vivid` ＋ 显示名？以及是否接受"改判为 Vivid（非 Islands）"。（§3.8）
6. **`cc-polar`**：本片写不写语法板？（取决于决策 2；若选"可选"，它就是一个"可选面"的活例子）
7. **是否连带修一处旧账**：`theme-overlays.spec.ts:439-482` 的"浅色块泄漏"守卫会**整体跳过**没有 `:not(.dark)` 半块的主题（2-O 记录的既有覆盖面缺口）。本片**必然**要给若干主题加明暗两块，正是收口这个缺口的好时机——但那属于"改护栏"，要不要顺带做？（注：改动护栏属既定纪律里的"停下问"一类。**第二轮两位都主张另案、不并入本片**，牵头同意；N10 要求它**现在就在主题文档切片表登记一行"待排期"**，否则"另立案"等于永不立案）

   > **该行已于 2026-09-29 触发并收口**（登记时写的触发条件就是"下一次动该守卫"）。实测该缺口确实为真且对四套 `full` 主题**全盲**（浅色半写成裸选择器会泄漏 **5 条** `--editor-*` 令牌，旧守卫下 28 例全绿）；改法是把跳过谓词换成"没有任何按外观作用域的块"，只动测试、无视觉变更。门槛、8 条变异与两处如实记账（其中一条既有断言"在作用域写对时不可能触发"，其可达性 M6 另证）见主题文档 §6 末的 **N10 记录**。**本片 §5.3 / §6.3 的范围与记账不受影响。**

---

## 9. 非目标

- **不做**改名轮其余三条（`dark:` 双写与档位耦合、`--n-*` 整层处置、tailwind `n-*` 键）。
- **不重命名**其余 125 项编号槽，**也不升名**那 17 个非契约槽（缺口 2：`code[…]` 三件套 ＋ 半活的槽 3 ＋ 仅暗色有值的槽 5 ＋ 12 条 `::selection`）。
- **不做**语法色的对比度/可读性断言（§5.10 是 UI 配对）。
- **不引入**新的注入机制、新的 `<style>` 元素、`ThemeContext` 改动。
- **不统一** Prism 与 CodeMirror 的完整命名体系（§8.9/4952 当初那个"一次到位"的大目标被本方案有意放弃）。
- **不动**代码块的几何与字体。**容器底色是否纳入取决于 §8 决策 4**：若取 (c) 则它明确落在本方案之外，并作为**已记名的缺口**（不是"没想到"）留在 §3.2b。

---

## 附录 A：改动文件总表

| 文件 | B1 | B1b（若决策 4 取 (a)） | B2 | B3 |
|---|---|---|---|---|
| `src/shared/syntaxTheme.ts` | 改 | — | — | — |
| `src/shared/userThemeTokens.ts` | 改 | — | — | — |
| `src/shared/tmTheme.ts` | **零代码改动；只改 `:117`/`:127` 的 "ten"→"eleven"**（新发现 A）。`docstring` 里那句"this table is a deliberate ten-slot projection"必须同步，否则与新键矛盾 | — | — | — |
| `src/shared/constants.ts` | — | — | — | 加一行 |
| `src/index.css` — 基色/覆盖层 | 只改注释 | 新增容器令牌 ＋ **四路**消费者取用 | 4 套 × 11 槽 × 2 外观 | 全套 ＋ 11 槽 × 2 ＋ 终端板 |
| `src/modules/chat/transcript/Markdown.tsx` | — | 容器 div 改引新令牌 | — | — |
| `src/modules/code-editor/markdown/MarkdownCodeBlock.tsx` | — | 两外观统一到新令牌 | — | — |
| `src/shared/tests/syntaxThemeTokenMap.test.ts` | 改 | — | — | — |
| **4 个既有测试文件**（附录 A 初稿漏列，N8）：`src/shared/tests/syntaxTheme.test.ts`、`src/modules/code-editor/tests/markdownCodeBlockSyntaxTheme.test.tsx`、`src/modules/chat/tests/markdownSyntaxThemeInjection.test.tsx`、`src/modules/code-editor/tests/editorThemeTokens.test.ts` | 改：`\d+` → `[a-z0-9-]+`（逐处清单见 §5.1 测试表） | — | — | — |
| `src/shared/tests/tmTheme.test.ts` | 改：补"第 11 槽回落全局前景"用例 | — | — | — |
| `tests/theme-tokens/main.ts` | 改：**① `tokenNames` 手工追加 `Object.values(SYNTAX_TOKEN_MAP)`（N6）；② `reinjectSyntaxStyleSheet()` 出 append 变体（现签名无参）；③ 出"删掉某条语法声明看回落"的可行删法（CSSOM 删声明，或把令牌显式置回基值）**——②③ 是 §6.2 红色反证的执行机制（批注 4） | — | — | — |
| `tests/theme-tokens/token-baseline.json` | 重生成 | 重生成 | 逐套重生成 | 重生成 |
| `tests/theme-tokens/token-contract.spec.ts` | **不动**（豁免移 B2，N7） | — | 视实测决定是否加 `--cc-syntax-` 豁免 ＋ 容器令牌是否同判 | — |
| `tests/theme-tokens/theme-overlays.spec.ts` | 加断言（含"`<pre>` 与 `<code>` 都读"的双元素探针、**白名单单一来源的结构测试** N13） | 加容器断言（**不进 `SURFACES`**） | — | — |
| `tests/theme-tokens/*user-theme*.spec.ts` | 加用例；另加 **`::selection` 判死实验**（N2，像素取样、双引擎） | — | — | — |
| `docs/research/CloudCLI主题与配色体系设计方案.md` | §5.8 v8 / §5.9 / §5.11 v7 / §5.3 / 附录 A / 审阅批注区（4818，**不是附录 B**） / §5.7 | §5.3 容器令牌 | 逐套记录 | 片记录 ＋ 切片表一行 |
| 同上 · 切片表 | B1 行 | B1b 行 | B2 行 | B3 行 ＋ **N10 的"待排期"行（浅色块泄漏守卫缺口）** |

> **该"待排期"行已于 2026-09-29 收口**（B 线四片做完后由它自己的触发条件带出）：跳过谓词改为"没有任何按外观作用域的块"，缺浅色半的主题报错；只动测试、无视觉变更，门槛 168 passed / 0 failed、两份基线未动。详见主题文档 §6 末的 **N10 记录**。

## 附录 B：实施顺序

1. B1 的四段按 **升名 → 读取面 → 白名单 → 契约断言** 顺序做，每段刷一次 `test:theme-tokens`（升名后夹具读不到值是预期的，读取面补上即绿）。
2. B1 收口：基线 diff 核对 ＋ 变异集 ＋ 全量门槛。
3. B2 逐套（每套一个提交、逐套刷基线、逐套记账）。
4. B3 与前两片解耦，可并行准备内容，但**合入应排在 B1 之后**（它需要语法槽）。
5. 主题文档回写排在最后，并与本方案互指。

## 附录 C：取证索引（本文引用的原文与行号）

| 事实 | 位置 |
|---|---|
| "本轮不升语义名"的决定 | 主题文档 4734（§8 第 9 项）、5115、5132 |
| 不升名的三条理由 ＋ 升级时机 | 主题文档 4947、4950-4956、5010 |
| 语义名草案方向 | 主题文档 5106 |
| "阶段 2 前一次到位改名"＝命名撞车 | 主题文档 568、5206 |
| 改名轮 5 条到期条款 ＋"前提：改名轮立项" | 主题文档 566-576 |
| 白名单"有意不授权的三族" | 主题文档 624（§5.8 v4） |
| 白名单的引用规则 | 主题文档 624 尾句；`userThemeTokens.ts:266-270、289-300` |
| "语法高亮不在覆盖层可达范围内"＋解决办法 | 主题文档 695（§5.11 v7）、3741（1-E 记录） |
| 基色表必须落在 `<head>` 最前的隐患与修法 | 主题文档 4197（2-E 决策 8） |
| 顺序的真引擎证明范式 | `tests/theme-tokens/user-theme-tmtheme.spec.ts:98-127` |
| 136 项冻结映射 ＋ 计数器 | `src/shared/tests/syntaxThemeTokenMap.test.ts:34、78-217` |
| denylist 扫描范围 | `src/shared/tests/syntaxThemeTokenMap.test.ts:227-231、242-266` |
| 容器槽确在 136 项内 | `syntaxThemeTokenMap.test.ts:153-154、193-194` |
| **容器槽对 chat 是死槽**（`customStyle` 写死 `background: 'transparent'`） | `src/modules/chat/transcript/Markdown.tsx:183-199`（`:191` 与 `:197`） |
| **`code[…]` 那一族不上身的机制**（默认 `codeTagProps` 只在 prop 为 `undefined` 时生效，两个消费者都传了） | `node_modules/react-syntax-highlighter/dist/esm/highlight.js`（`_ref7$codeTagProps === void 0 ? …`）；`Markdown.tsx:197`、`MarkdownCodeBlock.tsx:83` |
| **选择器键永不生效的机制**（token 色按类名查表，不序列化 CSS） | `node_modules/react-syntax-highlighter/dist/esm/create-element.js`（`createStyleObject`） |
| **终端 ANSI 槽在 `<attributes>` 而非 `<colors>`**（Vivid 改了 12 条 `CONSOLE_*_OUTPUT`） | `/tmp/od` 解包比对（本次调查，见 §3.7 订正） |
| **chat 代码块底色来自容器 div** | `src/modules/chat/transcript/Markdown.tsx:134`（`bg-muted/50` ＋ `dark:bg-n-zinc-900`） |
| **编辑器侧两外观不对称** | `src/modules/code-editor/markdown/MarkdownCodeBlock.tsx:70-77`（`isDarkMode ? {} : { background: 'hsl(var(--muted))' }`） |
| `--n-zinc-*` 是 `--palette-zinc-*` 的别名层 | `src/index.css:292-302` |
| 兼容骨架不可被主题动（`fixed` 组的意图） | `theme-overlays.spec.ts:97-108` |
| 语法组件只是 `PrismLight` ＋ 语言注册表（不含样式覆盖） | `src/shared/syntaxHighlighter.ts:55-82` |
| 覆盖层的 `moved` 语义（声明即计） | `theme-overlays.spec.ts:237-249` |
| "覆盖层只能声明基色表声明过的令牌" | `theme-overlays.spec.ts:351-370` |
| 浅色块泄漏守卫（含覆盖面缺口） | `theme-overlays.spec.ts:439-482`；主题文档 4609（2-O 记账） |
| 字面色护栏 ＋ `--editor-` 豁免 | `token-contract.spec.ts:146-171`（豁免在 154） |
| 基线重生成命令 | `token-contract.spec.ts` 文件头注 |
| `--cc-syntax-*` 在 `index.css` 出现 0 次 | 实测（本次调查） |
| `cc-catppuccin`"语法那一半在 `.tmTheme` 里有家" | `src/index.css:1689-1692` |
| `cc-islands` 的 editor scheme 另有 30 余条语法色未接线 | 主题文档 4609 |
| "可选能力不纳入 `SURFACES`"的机械论证先例 | `CloudCLI终端字体动态配置方案.md` §3.4（119-146） |
| Vivid 与 base 的差异量化（**已订正**） | 本次调查：`<attributes>` 502 项中带前景色的 380 项里 **175 项变**、128 项饱和度 +3pp 以上，且**其 base 色 175/175 全在 10 个契约槽的色系内**；`<attributes>` 的 **21 条 `CONSOLE_*_OUTPUT` 里 12 条变**（红/绿/品红/青各 normal＋bright、白、normal）；theme json 的 ui 14 项变（13 项只是 `#abb2bf`→`#bbbbbb`）；`<colors>` 段 60 项中 7 项非 CONSOLE 变（**该段的 `CONSOLE_*` 只有 `CONSOLE_BACKGROUND_KEY` 一条，故"该段 CONSOLE 变 0 项"不等于"终端不变"——初稿据此得出的"Vivid 不动终端"已作废**，见 §3.7 订正） |
| 四份 One Dark 变体共享核心色板 | 本次调查：`accentColor #568AF2`、`backgroundColor #202329`、`selectionBackground #323844`、`notificationBackground #3d424b` 四份全同 |
| **`.tmTheme` 加键的自动连锁**（新发现 A） | `src/shared/tmTheme.ts:433-434`（`Object.keys(SYNTAX_TOKEN_MAP)` ＋ `?? foreground` 回退）、`:402-404`（回退的理由注释）、`:117`/`:127`（"ten" 措辞）；行为被 `src/shared/tests/tmTheme.test.ts:130-142` 固化 |
| **`.tmTheme` 的缓存指纹会随映射变化** | `src/shared/userThemeStyles.ts:86`（`COMPILED_OUTPUT_FINGERPRINT = JSON.stringify(SYNTAX_TOKEN_MAP)`）、`:463-466`（注释预告的场景）、`:476`（校验点） |
| **参照物没有浅色语法板**（新发现 B） | `/tmp/od` ＋ `one-dark-theme-6.2.5.jar` 全清单比对（本次调查）：只有 `one_dark{,_vivid}.theme.json`（均 `dark: true`）与 `one_dark{,_vivid}.xml`；Islands 侧只有 `IslandSchemeDark.xml` |
| **终端面是外观无关的** | `src/index.css`：`--palette-term-*` 20 条／套，主题块内只声明一次（实测 `cc-onedark`/`cc-islands`/`cc-catppuccin`/`cc-polar` 各 20，`cc-ocean` 无）；基座 `:169-188` ＋ `--term-*` 别名 `:230-...` |
| **主题文档 `:4818` 的归属**（新发现 C） | 主题文档 `:4807`（「## 审阅批注」区起）、`:4818`（Claude 那条 `--cc-syntax-N` 的 WARNING）、`:4781`（**真正的**「## 附录 B：解包取证索引」） |
| **4 个硬编码 `/--cc-syntax-\d+/` 的测试文件**（N8） | `src/shared/tests/syntaxTheme.test.ts:81`（`:100` 是不升名的槽 3，**放宽后仍绿**）；`src/modules/code-editor/tests/markdownCodeBlockSyntaxTheme.test.tsx:57/:67/:86`；`src/modules/chat/tests/markdownSyntaxThemeInjection.test.tsx:39/:83`（`:71` 先红）；`src/modules/code-editor/tests/editorThemeTokens.test.ts:75`（同文件 `:66` 已是宽正则） |
| **字面色护栏的正则形状**（N7） | `tests/theme-tokens/token-contract.spec.ts:37`（`HSL_TRIPLET` 只认空格三元组）、`:146-171`（扫描）、`:154`（`--editor-` 豁免） |
| **基线的读取面只扫 `index.css`**（N6） | `tests/theme-tokens/main.ts:23`（`cssSource = src/index.css?raw`）、`:170-180`（`extractTokenNames`）、`:182`（`tokenNames`）；基线里已有空串先例：`--reasoning-collapse-duration`、`--reasoning-fade-duration` |
| **槽 0–17 的真实选择器** | `src/shared/tests/syntaxThemeTokenMap.test.ts` 快照（`code[class*="language-"]` 的 `background`/`color`/`textShadow` ＝ 0/1/2、`pre[…]` 同三件 ＝ 3/4/5、12 条 `::selection` ＝ 6–17） |

---

## 审阅批注

> 本节留给会审的其他 harness 就地批注（照 `CloudCLI终端字体动态配置方案.md` 的体例）。**请按 §8 的 7 个决策项逐条给结论**，尤其是决策 2（语法是否进 `SURFACES`）与决策 4（容器底色做不做）——这两条决定本方案的实际工作量与目标完成度。

### Claude

> 总体：结构完整、实测驱动、取证翔实。我认同核心走向（只升 11 槽契约面、B1 独立合入）。以下按 §8 决策项 1–7 逐条结论，另加 5 条细则/表述缺口。

**[§8 决策 2 · 契约面：同意"可选"，但要和决策 4 绑着审]**
> [!NOTE] 决策 2 我同意"语法不进 `SURFACES`、保持可选"——机械理由充分（`derivedMoves()` 声明即记、`MUST_MOVE.full` 强制自造、`MUST_NOT_MOVE.accent` 封死 chrome-only 参照物），且先例已在终端字体轮走通。`all-or-nothing` ＋ "声明即生效"独立断言这套弥补措施够用，不必引入合同强制。但请与决策 4 一并读我的 **CAUTION 第 3 条**：容器令牌的处理必须与语法同判（同为"可选、不进 `SURFACES`"），否则 §5.3 的 `full` 措辞会自相矛盾。

**[§8 决策 4 · 容器底色：倾向 (a)，但容器令牌不进 `SURFACES`]**
> [!TIP] 决策 4 我倾向 (a)——token 色只是目标的一半，暗色下 `cc-onedark` 代码块坐 `#18181b` 不搭是肉眼可见的事实，不做容器目标不算真正达成。但有一个**前提**：`--code-block-bg` 应做成**与语法同类的"可选能力"，不进 `SURFACES`/`MUST_MOVE`**，作为 B1b 独立片、独立验收，而不是借机改契约面。这样 B1b 的 `theme-overlays.spec.ts` 改动只加独立断言、不动 `SURFACES` 数组，"基础层零变化"的张力最小。

**[§8 决策 1 · 范围：同意]**
> [!NOTE] 只立改名轮第 4/5 条、其余三条维持悬置，范围收敛是好的；余三条悬置理由（`dark:` 双写档位耦合、`--n-*` 永久契约、tailwind 键）笔头一笔带过即可，不必展开。

**[§8 决策 3 · 命名：同意，但白名单模式与命名规则必须强同源]**
> [!WARNING] `--cc-syntax-<role>-color` ＋ `--cc-syntax-code-foreground` 这套拼写我同意。但 §3.5 那条 `/^--cc-syntax-[a-z][a-z0-9-]*$/`（`[a-z]` 开头防编号）能否一直生效，**完全依赖未来的语义名只用字母开头＋连字符**。若将来某个 `SyntaxSemanticName` 用了下划线（如 `code_foreground`）或任何非 `[a-z0-9-]` 字符，模式会失配 ⇒ **静默不可授权**，而测试未必红（因为变量不在白名单也不在断言里）。请把"**语义名字符集合与白名单模式严格同源**"写进 DoD；变异集里 `[a-z]`→`[a-z0-9]` 已经有了，建议再加一条"语义名改用下划线 → 断言必须红"的变异。

**[§8 决策 5 · 新主题：同意改判 Vivid]**
> [!NOTE] 改判有理有据：语法可达后 Vivid 单轴 175 项加饱和已足够分辨，不必叠 Islands；且与 `cc-onedark` 共享全部底料让"只动一条轴"验收最干净。`cc-onedark-vivid` id 合理。唯一要用户定的就是显示名（决策项已列，OK）。

**[§8 决策 6 · `cc-polar`：同意"不写"，作为可选面活例]**
> [!TIP] 若决策 2 取"可选"，`cc-polar` 本片不写正合适——它是"没有参照板也能标 full"的活例，比任何文档都更能说明"可选面"的边界。建议在 B2 的提交说明里把"本套不涉及语法板"这一句写清，别让未来读者误以为漏了。

**[§8 决策 7 · 守卫缺口：不并进本片，另立案]**
> [!TIP] `:439-482` 浅色块泄漏守卫的覆盖面缺口与本片目标（语法板）**正交**。并进来会扩大 diff、把"改护栏"这种既定纪律里"停下问"的动作混进一个本就偏大的片。建议单独列一个"收口守卫缺口"子项，本片只保证新增的明暗两半政体不制造新的泄漏即可。

---

**[细则 1 · `<code>.color` 选型反证：补齐 `<pre>` 侧读取]**
> [!IMPORTANT] 你已正确地把 `code[…].color` 的选型标记为"需真引擎证据"，并要求在真实渲染的代码块上读计算颜色＋一条删除反证。请在这条反证里**同时读 `<pre>` 的计算 color**：确认正文色确实由 inner `<code>` 继承、而 `<pre>` 侧没有把自己的 color 覆盖上去（react-syntax-highlighter 把 `customStyle` 挂在 `<pre>` 上，若它带 color 会盖掉 inner 继承）。这一步能彻底锁死"画正文的确实是这个元素"，比只抽查 code 侧更硬。

**[细则 2 · G3 与 11 槽的覆盖错配要实测对齐]**
> [!WARNING] 结论 3 说 Vivid 差异"全部落在 10 个 token 槽"（§3.2），而 §3.7/附录 C 说 175 项带前景色差异。两个数是 `<attributes>` 级 vs 契约 selector 级的错配——**很可能自洽，但需要实测证明，不是推断**：把 175 项逐一映射到 13 个契约 selector（11 槽含 `code-foreground`，另计 `pre[…].color`），算出真正命中契约槽的项数。若命中远小于 175，G3"未被表达的那部分差异是落在非契约槽的 chrome/HTML 类槽上"，语义上仍成立，但要如实写清承诺边界，别让"175 项都能被表达"的隐含读法成立。

**[细则 3 · all-or-nothing 的"空值/省略"语义要澄清]**
> [!WARNING] §3.4 要求"声明任一槽 ⇒ 11 槽两外观声明齐"，但风险表又记了"`buildSyntaxTheme` 对 light 在 `lightValue !== 0` 才写声明"（`syntaxTheme.ts:58-66`）。两者一撞：某个槽若参照物的 light 板**本就没有值**，主题要不要在 light 半块里凑齐 11 条？建议明确细则——是"基色表存在该槽（任外观）即要求两外观齐"，还是"按外观族各自判定"；并对"参照物 light 无此槽"的情形给一个显式处置（允许该外观半块少写、记入偏离清单），否则 all-or-nothing 会逼主题造"参照物不存在"的值。

**[细则 4 · 决策 4 取 (a) 会替代 `--n-zinc-900` 一个消费点——记账句要强调"是替换、不是开边界"]**
> [!TIP] 你已在风险表写了"替换兼容原子消费 ≠ 打开 fixed 边界"的正确区分，很好。但建议在 B1b 的提交说明再加一句**反向后果**：替换后，原先"暗色代码块底色永久固定"的保证消失，该处变得可被主题移动——这本身是此次有意的视觉变更，要写进 §6.3 逐条记账，否则会被当成破坏既定契约。

**[细则 5 · `deriveTokenMap()` 零改动要有一条同级反证]**
> [!NOTE] §3.1 断言 `deriveTokenMap()` 一行不用改、"反查照旧命中"，讲得通（反查键是语义名而非编号）。但"零改动且结果逐槽等价"是本片最需要保护的一步之外第二需要保护的。建议加一条与 §6.2"红色反证"同级的测试：**重命名前后 `deriveTokenMap()` 输出逐槽相等**（键同一、变量名按新规则），证明拆名没改变反查语义——这条红不了，说明 0-D 的红利确实兑现了。

### OpenCode

> 总体：同意核心走向（B1 先行、11 槽契约面、语法可选不进 `SURFACES`）。本文引用的行号与关键事实我对照 `HEAD` 实测抽查过（见末条 NOTE），未发现失实。先对 §8 七个决策项表态，另有 6 条批注，其中 1 条 CAUTION 是文档本身的完整性缺陷。

**[§8 决策 1 · 范围]**
> [!NOTE] 同意只立第 4/5 条，其余三条维持悬置。

**[§8 决策 2 · 契约面]**
> [!NOTE] 同意"可选、不进 `SURFACES`"。机械论证我照代码核过一遍：`derivedMoves()`（`theme-overlays.spec.ts:237-249`）"声明即计"的语义、`MUST_MOVE.full` 的强制方式（`:400-412`）与方案描述一致，终端字体轮的先例可以直接照抄。

**[§8 决策 3 · 命名]**
> [!NOTE] 同意 `--cc-syntax-<role>-color` ＋ `--cc-syntax-code-foreground`。`code-foreground` 不带 `-color` 后缀是 11 个里唯一的例外，但 `code-color` 歧义更大，建议保持现状。

**[§8 决策 4 · 容器底色]**
> [!TIP] 取 (a)，且容器令牌与语法同判：可选、不进 `SURFACES`，用独立断言。但要先补两个方案没写的决定（值形状、明色半来源），见批注 6。

**[§8 决策 5 / 6 · Vivid 与 `cc-polar`]**
> [!NOTE] 均同意：改判 Vivid（非 Islands）在"语法可达"前提下成立；`cc-polar` 不写、留作可选面活例。

**[§8 决策 7 · 泄漏守卫缺口]**
> [!TIP] 另立案，不并入本片。补一个本片必须自觉满足的下限：新增语法声明的主题在两个外观各声明全部 11 槽（对称），对 `:439-482` 守卫的 `owned` 计算是惰性的——不会让它变红，但也别指望它顺带覆盖语法槽。

---

**[批注 1 · 文档完整性：附录 C 被腰斩，3 行取证行漂移到了"作者回应"之后]**
> [!CAUTION] 附录 C 的表主体止于 `cc-islands` 行（:483），但表的最后 3 行——"可选能力不纳入 `SURFACES` 的机械论证先例"、"Vivid 与 base 的差异量化"、"四份 One Dark 变体共享核心色板"——现在落在 `## 作者回应` 占位段落之后（:541-543），与所属表格断开。牵头 harness 汇总时若按"审阅批注区块以下"做裁剪/回写，这 3 行证据会随批注区一起被丢弃或错位。建议先把表修回附录 C，再进入汇总；这也是我把这条排在内容批注之前的原因。

**[批注 2 · §3.2 的"不进契约面"清单漏了 14 个活槽：selection 家族（槽 6-17）与 textShadow（槽 2、5）]**
> [!WARNING] 这 14 个既不是插件 chrome 也不是 HTML 专用类，而是代码块核心可见外观：快照（`syntaxThemeTokenMap.test.ts:149-159、189-195`）证明它们是变量 ⇒ 两主题取值不同 ⇒ 活槽；chat 的 `customStyle`/`codeTagProps` 只覆盖元素自身的 background，管不到 `::selection`。后果与缺口 2 同型：B2 把 11 槽换成参照物语法板后，用户在代码块里选中文字的高亮色仍停在 oneLight/oneDark 的蓝上，与"代码块像主题"的目标同源。处置二选一：把 `code[class*="language-"]::selection.background`（含 ` *::selection` 那条）升名入契约，或照三个死槽的体例在注释与文档里点名"为什么 selection 也不进来"。不点名的话，按方案自己的预言，下一个读 136 项快照的人仍会以为漏了。

**[批注 3 · §6.2"声明即生效"的等式按字面写永不成立：值形状不对齐]**
> [!IMPORTANT] `readSyntaxToken`（`main.ts:291-301`）走探针，返回计算色 `rgb(198, 120, 221)` 这样的形状；而主题块声明值是 `#c678dd` 或 `hsl(286, 60%, 67%)`，`resolve()`（`theme-overlays.spec.ts:284-289`）只做 `var()` 替换、不做颜色归一——两边直接 `===` 必红。修法二选一：① 照 `user-theme-tmtheme.spec.ts:60-65` 的 `tripletReference` 范式，把期望值也过一遍探针再比；② 声明一致性交给既有 per-theme 测试的 unresolved 检查（tokens 路径比的是原样声明文本，形状天然一致，§3.6 之后语法槽自动进 `readWithTheme().tokens`），`readSyntaxToken` 那条只留给顺序证明与 `code-foreground` 选型探针。DoD 里要写明走哪条，否则这条断言写出来即红。

**[批注 4 · §6.2 两条红色反证的执行机制不在改动清单里]**
> [!TIP] "把基色表从最前改成追加"需要 `reinjectSyntaxStyleSheet()` 出一个 append 变体（现签名无参；附录 A 里 `main.ts` 只记了 tokenNames）；"删掉主题块里 code-foreground 一条看回落"在 fixture 读真 `index.css` 的前提下要有可行删法（CSSOM 删声明，或把令牌显式置回基值）。两处机制改动请补进附录 A，否则 DoD 里最硬的两条验收实现时会卡壳。

**[批注 5 · 升名会自动失效用户主题编译缓存——这是既有设计的正确行为，应记一笔]**
> [!NOTE] `userThemeStyles.ts:86` 的 `COMPILED_OUTPUT_FINGERPRINT = JSON.stringify(SYNTAX_TOKEN_MAP)`：升名改变映射 ⇒ 指纹改变 ⇒ 旧编译产物（内含旧编号名）在 `:476` 的校验失配、重新编译。方案没提这件事；建议在 B1 记账里写明"升名触发全员主题缓存重编译，预期行为"，免得未来有人当回归"修"掉。连带：该指纹的注释（:67-86）讲的是"Prism bump 重编号"场景，升名后编号槽不再被任何编译产物点名、指纹不再随 Prism bump 翻动——正是注释里预告的"正确"行为，注释宜顺手更新，别让两段文字打架。

**[批注 6 · B1b 的新令牌还缺两个决定：值形状与明色半来源]**
> [!TIP] §5.1b 只给了暗色值来源（One Dark `#282c34`、Catppuccin `base`、Islands editor 底）；明色半要逐套写清（Latte 的代码底、One Light 的代码底……）——统一到令牌后明色不再有 `bg-muted/50` 兜底。且值形状决定授权轨道：triplet＋alpha（保住 `bg-muted/50` 的半透明质感，消费写 `hsl(var(--code-block-bg) / 0.5)` 一类）还是完整表达式，分别对应进 `SEMANTIC_TOKENS`/`FAMILY_RULES` 哪条、以及用户 `.json` 主题可不可以设它。这两个决定不定，B1b 没法动工。

---

**[实测核对记录]**
> [!NOTE] 本文引用我对照 `HEAD` 抽查 12 处：`syntaxTheme.ts` 全文（生成器/`SYNTAX_SELECTORS`/`deriveTokenMap`/头部注入）、`Markdown.tsx:134、:191、:197`、`MarkdownCodeBlock.tsx:75、:77`、`theme-overlays.spec.ts` 的 `SURFACES`/`MUST_MOVE`/`derivedMoves`/泄漏守卫、`token-contract.spec.ts:146-171`、`main.ts` 的 `tokenNames`/`readSyntaxToken`/`reinjectSyntaxStyleSheet`、快照槽号 0/1/3/4/37/47、`userThemeTokens.ts:212-227、266-270、289-300`、`index.css:292-302` 与 `1687-1692`、`constants.ts` 的 coverage 分布——全部一致；§3.1"denylist 不需要改"经核成立（allowed 集恰为生成器与快照两文件）。

---

### 牵头结论

> 汇总时间：2026-09-28。两位审阅者（Claude、OpenCode）**对 §8 七个决策项的结论完全一致**；另有 14 条批注/细则。逐条判定如下：**决策 7 项全部采纳；批注 14 条中采纳 11、部分采纳 1（观察成立、处置反向）、不采纳 1（同一条批注的另一半，其因果描述不成立）、致谢 1（实测核对记录）**；另有 **2 条由本方案作者自查发现的失实**（审阅者未指出，一并认领）。

**一、决策项（两位意见一致，牵头采纳，待用户最终拍板）**

| 决策 | 结论 | 出处 |
|---|---|---|
| 1 · 范围＝只立改名轮第 4/5 条 | 采纳 | Claude 决策 1；OpenCode 决策 1 |
| 2 · 语法**不进** `SURFACES`（可选面） | 采纳 | 两者一致；机械论证两位都照代码核过 |
| 3 · 命名 `--cc-syntax-<role>-color` | **采纳，但第 11 槽改名** | 见"三、改判"第 1 条 |
| 4 · 容器底色取 (a)，且容器令牌与语法同判（不进 `SURFACES`） | 采纳 | 两者一致；本项目把"或纳入 `SURFACES`"那条备选取消 |
| 5 · 新主题改判 `one_dark_vivid`（非 Islands） | 采纳，**理由订正** | 见"二、自查"第 2 条 |
| 6 · `cc-polar` 本片不写，留作可选面活例 | 采纳 | 两者一致 |
| 7 · 浅色块泄漏守卫缺口**另立案**，不并入本片 | 采纳 | 两者一致；本片只保证新增的明暗两半不制造新泄漏 |

**二、作者自查发现的两处失实（审阅者未指出，由本轮取证带出）**

1. **第 11 槽选错了元素。** 初稿把 `code[class*="language-"].color`（槽 1）当成"两处消费者共用且活着"的正文色槽。**实测＋读库双证其死**：`react-syntax-highlighter` 只在 `codeTagProps` 为 `undefined` 时才用默认值，而 chat 与编辑器**都显式传了它**，所以 `code[…]` 那一族根本不上身；两个消费者的正文色都来自 **`<pre>`（槽 4）**。（触发线索是 Claude 的细则 1——"反证里要同时读 `<pre>`"；但结论比细则 1 更强：不是"`<pre>` 可能覆盖"，而是"`<pre>` 才是真身、`<code>` 全程不参与"。）
   → 绑定改判为 `pre[class*="language-"].color`，名字改为 `--cc-syntax-block-foreground`。
2. **"Vivid 不动终端"是错的。** 我此前拿 `<colors>` 段判终端，而**终端的 ANSI 槽在 `<attributes>`**：那里 21 条 `CONSOLE_*_OUTPUT` 有 **12 条**被 Vivid 改动（红/绿/品红/青各 normal＋bright、白、normal），折算到 16 槽约 **9～10 槽移动**。§3.8"Vivid 是纯语法板变体"随之作废，改为"**底料不动，语法板 ＋ 终端 ＋ 灰阶三条轴一起动**"——这**加强**了 B3 的价值，但 B3 的验收要同时覆盖终端与语法两面。
   → 教训："判某段 XML 有没有改某能力"之前先确认**该能力在哪一段**；`<colors>` 与 `<attributes>` 有同名键并存，只看一段会得出反向结论。这是本线"取证要读这一步的全部要求"的第 7 次命中，已回写 §3.7。

**三、逐条批注判定**

| # | 批注（来源） | 判定 | 处置 |
|---|---|---|---|
| 1 | 附录 C 被腰斩、3 行取证漂到"作者回应"之后（OpenCode CAUTION；Claude 细则亦提） | **采纳** | 已把 3 行移回附录 C 表内，并**顺手订正**其中"Vivid 与 base 的差异量化"一行（原写法正是自查 2 那个错误的来源） |
| 2 | §3.2"不进契约面"清单漏了 14 个活槽（selection 12 ＋ `textShadow` 2）（OpenCode WARNING） | **部分采纳** | **观察属实**（14 个确为变量、文档确未提），**但处置取"点名不进契约"而非"升名"**，且其因果描述不成立——见下条理由。已把清单从 3 项扩到 **15 项**并逐类给理由 |
| 2′ | 同上：批注称"选中色仍停在 oneLight/oneDark 的**蓝**上" | **不采纳（该因果）** | 那 12 条 `::selection` **没有任何生效通路**：这套库把 style 对象只当**类名查表**用（`createStyleElement`/`createStyleObject` 从不序列化成 CSS），`useInlineStyles` 默认 true；且 `src/index.css` 里 `::selection` **0 处**。所以代码块选中色今天是**浏览器默认**——升名不是"让既有颜色跟着主题"，而是**造一个新能力**。据此不升名、只点名（判据同"死槽不得升名"） |
| 3 | §6.2"声明即生效"按字面写永不成立（值形状不对齐）（OpenCode IMPORTANT） | **采纳** | 照其 ①＋② 分工写进 §6.2：声明一致性走 `readWithTheme().tokens`（原样声明文本，形状天然一致，且 `extractTokenNames` 会自动收录）；需要计算色时用 `tripletReference` 范式把期望值也过一遍探针 |
| 4 | 两条红色反证的执行机制不在改动清单里（OpenCode TIP） | **采纳** | `reinjectSyntaxStyleSheet()` 的 append 变体、"删掉一条看回落"的可行删法，已要求写进附录 A |
| 5 | 升名会失效用户主题编译缓存，应记一笔（OpenCode NOTE） | **采纳** | `COMPILED_OUTPUT_FINGERPRINT = JSON.stringify(SYNTAX_TOKEN_MAP)`（`userThemeStyles.ts:86`）随升名变化 ⇒ 全员重编译（预期）；连带更新 `:67-86` 的注释。已写入 B1 改动清单 |
| 6 | B1b 新令牌缺两个决定（值形状、明色半来源）（OpenCode TIP） | **采纳** | 已补进 §5.1b；建议 triplet（保住 `bg-muted/50` 的半透明质感），并逐套列明色值 |
| 7 | 细则 1：`<code>` 选型反证要补 `<pre>` 侧读取（Claude IMPORTANT） | **采纳并加强** | 见"二、自查"第 1 条——**它直接推翻了初稿的选型**，§6.2 那条已改为"两个元素都读 ＋ 双段反证" |
| 8 | 细则 2：175 项 vs 契约槽的覆盖要实测对齐（Claude WARNING） | **采纳** | **已实测：175/175**——改动的 175 条属性，其 base 色**全部**落在 10 个契约槽的色系内（紫/绿/青/红/灰五族，无遗漏）。§3.2 相应改为"实测坐实"，并写清这是**色系级**覆盖、不等于"175 条逐条可表达" |
| 9 | 细则 3：all-or-nothing 的"空值/省略"语义要澄清（Claude WARNING） | **采纳** | §3.4/§6.4 已改为"**按外观各自判定**"：基色表在某外观声明过的槽必须声明；**参照物某外观本就没有值的槽允许少写**但须记入偏离清单（判据：不得逼主题造参照物不存在的值） |
| 10 | 细则 4：`--n-zinc-900` 替换的反向后果要记账（Claude TIP） | **采纳** | §6.3 增一条：替换后"暗色代码块底色永久固定"的保证消失，属**有意**视觉变更，须写进清单 |
| 11 | 细则 5：`deriveTokenMap()` 零改动要有同级反证（Claude NOTE） | **采纳** | §6.2 增一条：重命名前后 `deriveTokenMap()` 输出**逐槽相等** |
| 12 | 决策 3 附带的"命名与白名单模式必须同源"（Claude WARNING） | **采纳** | §3.5 增第 4 点：拼写规则与 `/^--cc-syntax-[a-z][a-z0-9-]*$/` 互指，变异集增"语义名改下划线 ⇒ 必须红" |
| 13 | OpenCode 的 12 处实测核对记录 | **致谢** | 其"§3.1 denylist 不需要改"经复核成立（allowed 集恰为生成器与快照两文件）。**但其核对未覆盖 `node_modules` 侧**——本轮两处改判恰恰都在库里，说明"引用一致性"与"机制正确性"是两种检查，前者过不了后者 |

**四、由本结论产生的文档改动清单**

- §3.1 / §3.2 / §3.2b / §3.4 / §3.5 / §3.6 / §3.7 / §3.8：改判与订正（第 11 槽、15 项不进契约清单、按外观判定的 all-or-nothing、白名单同源、`tokenNames` 无需追加、Vivid 终端订正）
- §5.1 / §5.1b：`syntaxTheme.ts` 绑定改判；新增 `userThemeStyles.ts` 注释行；B1b 补两个必须先定的决定
- §6.2 / §6.3 / §6.4 / §6.5：值形状、双元素探针、deriveTokenMap 同级反证、`--n-zinc-900` 记账、下划线变异
- §1.2 缺口 2：结论第二次更正（元素是 `<pre>` 不是 `<code>`）
- 附录 A / 附录 C：机制改动入表、3 行取证明回表内并订正量化
- 主题文档回写时，**另需**把"Vivid 的差异量化"与 §5.11 v7 的措辞一并改（清单见 §4）

---

## 作者回应

> 体例：逐条给"采纳 / 部分采纳 / 不采纳 ＋ 理由"。
> **决策 7 项：全部采纳。批注 14 条：采纳 11、部分采纳 1（其观察成立、处置反向）、不采纳 1（其因果描述不成立，与"部分采纳"那条同源）；另认领 2 条自查失实。**
> 需要用户拍板的剩两处：**决策 3 的第 11 槽新名字 `--cc-syntax-block-foreground`**（两位审阅者此前认可的是旧绑定下的 `code-foreground`，绑定一改，该认可随之作废）、**决策 5 的显示名**。决策 7 的"守卫缺口另立案"若用户同意，将作为独立片登记，不在本方案内实施。

---

## 第二轮审阅：未决与未统一项（2026-09-28）

> 本清单**只列"未定 / 未统一 / 因作者改判而需重新确认"的项**；已获一致结论且未再变动的项不重复（见 `### 牵头结论`）。共 **14 项**，分四组。
> **请按 N1–N14 逐条给结论**，直接在本节之后追加 `### <harness>（第二轮）`。
> 分组含义：**A 组**＝审阅者的结论建立在**已被作者改判的前提**上，需重新确认；**B 组**＝文档自身缺陷（作者自查，多数是实测带出的，含一处更正）；**C 组**＝仍未拍板、或作者只给了建议；**D 组**＝作者建议新增（两位都未提）。

### A 组 · 审阅结论建立在已被改判的前提上（需重新确认）

**N1 · `code-foreground` 的命名认可已作废。**
- 现状：Claude 与 OpenCode **都明确同意** `--cc-syntax-code-foreground`；OpenCode 还专门表态"它不带 `-color` 后缀是 11 个里的唯一例外，但 `code-color` 歧义更大，建议保持现状"。
- 变的是前提：作者读库源码后把该槽的**绑定**从 `code[class*="language-"].color`（槽 1）改判到 `pre[class*="language-"].color`（槽 4）——名字必须跟绑定对象走，故改为 `--cc-syntax-block-foreground`。
- **作者建议**：采纳新名 `--cc-syntax-block-foreground`（保留两位"不带 `-color`"的既有偏好；`block-color` 反而有歧义）。
- **需**：两位重新确认该拼写，或另提；**用户**最终点头（与决策 3 同项）。

**N2 · `::selection` 那 12 槽的因果——作者**不采纳** OpenCode 批注 2 的一半。**
- 分歧：OpenCode 主张"用户在代码块里选中文字的高亮色仍停在 oneLight/oneDark 的**蓝**上"，要求升名入契约或至少点名；作者的判定是**部分采纳**（观察成立 → 已扩进"不进契约面"清单）＋**不采纳其因果**，取"点名不升名"。
- 作者的两条依据（可复核）：① 该库 `useInlineStyles` 默认 true，style 对象按**类名**内联到元素，选择器键（含 `::selection`）**没有生效通路**（`create-element.js` 的 `createStyleObject` 只按类名查表，从不序列化成 CSS）；② `src/index.css` 里 `::selection` **出现过 0 次**（本轮实测）⇒ 今天代码块选中色是**浏览器默认**，升名不是"让既有颜色跟主题走"而是**造一个新能力**。
- **作者建议**：维持"点名不升名"。**并补一条能把争议一次判死的实验**：真机在代码块里选中一段文字，读实际生效的选中背景色；若为浏览器默认（而非 oneDark 的 `#c678dd` 一族）则作者判断成立。**请反对方指定该实验的读法，或由 B1 实施期补做**——不接受"两边都只是推理"的状态。

**N3 · 第 11 槽的**元素**改判（`code[…]` → `pre[…]`），两位从未见过这组证据。**
- 证据：`node_modules/react-syntax-highlighter/dist/esm/highlight.js` 的 `codeTagProps` 三元**只在 prop 为 `undefined` 时**才用含 `code[…]` 的默认值，而 chat（`Markdown.tsx:197`）与编辑器（`MarkdownCodeBlock.tsx:83`）**都显式传了它** ⇒ `code[…]` 那一族从来不上身，两个消费者的正文色都来自 `<pre>`。
- **作者建议**：接受改判。**并保留**两位要求的那条双段反证（Claude 细则 1：同时读 `<pre>` 与 `<code>` ＋ 删除后回落）——它的意义已从"`<pre>` 可能覆盖"升级为"确认谁是真身"，比原意图更必要。

**N4 · B3 的改动面因"Vivid 动终端"而扩大——两位同意改判 Vivid 时，作者给的卖点是错的。**
- 分歧：两位认可"改判为 Vivid（非 Islands）"时，方案的卖点是"**纯粹的语法板变体**"；订正后它同时动**终端**（`<attributes>` 的 21 条 `CONSOLE_*_OUTPUT` 里 **12 条**变，折 16 槽约 **9～10 槽移动**）与**灰阶**（`#abb2bf`→`#bbbbbb`）。
- **作者建议**：结论不变（仍做 Vivid，且这**加强**了它的可辨性），但 **B3 的 DoD 必须同时覆盖终端与语法两面**，不能只测代码块。若某位的"同意"依赖"改动小"，请按订正后的事实**重新确认**。

### B 组 · 文档自身缺陷（作者自查，含一处更正）

**N5 · "不进契约面的 15 个槽"与它自己的表格对不上，且槽 5 无处置行。（计数缺陷）**
- 事实：§3.2 标题写 **15**；同节表格列的是 `0,1,2` ＋ `6–17` ＋ `3` ＝ **16**；§4 / §9 / 附录 A 的括注是"`code[…]` 三件套 ＋ 12 条 `::selection`" ＝ 15（把槽 3 排除，可槽 3 又占着表里一行）。而**槽 5（`pre[…].textShadow`）只在正文被提了一句"不升名"，既没有行、也没进任何计数**。
- 实测快照：不在契约面的实为 **17 个**——`0,1,2`（`code[…]` 的 `background`/`color`/`textShadow`）、`3`（`pre[…].background`，**半活**）、`5`（`pre[…].textShadow`，**仅暗色有值**）、`6–17`（12 条 `::selection`）。
- **作者建议**：改为 **17**，并**一行一个槽**（不许再汇总成"三件套"）；槽 3 标"半活"、槽 5 标"仅暗色有值"。理由：这份计数是给下一个读 136 项快照的人看的，"汇总式计数"正是它出错的方式。

**N6 · §3.6 与"批注 3 处置"对"语法槽怎么进读取面"说法相反。**
- §3.6 / 附录 A 说：`tests/theme-tokens/main.ts` 的 `tokenNames` **手动追加** `Object.values(SYNTAX_TOKEN_MAP)`。
- 批注 3 处置却说：`extractTokenNames` 扫 `--x:` 声明，所以语法槽会**自动**进 `tokens`。
- 实测：`main.ts:23` 的 `cssSource` 是 `src/index.css?raw` ⇒ `extractTokenNames` **只扫 `index.css`**。B1 不给 `index.css` 加任何语法声明 ⇒ **"自动"在 B1 不成立**（要到 B2 有主题块声明了才成立）。
- **作者建议**：写明"**B1 手动追加；B2 起 `index.css` 里的主题声明也会被扫到，两者取并集**"，并注明并集是 `Set` 幂等的。否则 B1 收口时"基线为什么多了 11×2 条"会说不清。

**N7 · 附录 A 把"基线重生成"与"`token-contract` 加豁免"记在 B1，但这两件事的实际事件在 B2，且"加豁免"取决于**尚未定**的值形状。**
- 事实：基线形状是 `{light:{tokens,rendered}, dark:{…}}`，`tokens` 只来自 `tokenNames`；字面色护栏的正则是 `HSL_TRIPLET = /^(?:\d+(?:\.\d+)?%?\s+){2}\d+(?:\.\d+)?%(?:\s*\/\s*[\d.]+%?)?$/`（`token-contract.spec.ts:37`），**只认空格三元组**（另加 hex / `rgba(` 两个分支）。
- 推论：overlay 里若写 **`hsl(286, 60%, 67%)`**（§3.3 示例的形状）⇒ **不命中** ⇒ **不需要豁免**；若写 **`286 60% 67%`**（三元组）或 **`#c678dd`**（hex）⇒ 命中 ⇒ 需要豁免。
- **作者建议**：① "加豁免"移到 **B2** 列，并**先定值形状**再决定要不要（见 N11）；② 由 §3.3 的示例形状（`hsl(...)`）推，**很可能不需要豁免**——但这条必须**实测一条 overlay 声明跑过护栏**再写死，不许再靠推。

**N8 · 附录 A 漏列 4 个会被升名击穿的测试文件（全部硬编码 `/--cc-syntax-\d+/`）。**
- 实测命中（升名后必红，且**不是因为它们错了**，而是它们的正则假设了名字是数字）：
  - `src/shared/tests/syntaxTheme.test.ts:81` —— "主题相关的值必须是变量"这条对 **11 个升名槽全红**；
  - `src/modules/code-editor/tests/markdownCodeBlockSyntaxTheme.test.tsx:57 / :67 / :86` —— 三处；
  - `src/modules/chat/tests/markdownSyntaxThemeInjection.test.tsx:39 / :83` —— 两处（`:71` 的 `referenced.size > 0` 会先红）；
  - `src/modules/code-editor/tests/editorThemeTokens.test.ts:75`（连带 `:79` 的 `borrowed.length >= 10`）。
  附录 A 只列了 `src/shared/tests/syntaxThemeTokenMap.test.ts` 一个。
- **作者建议**：**修法不是逐个写死新名字**，而是把正则从 `\d+` 放宽到 `[a-z0-9-]+`——`editorThemeTokens.test.ts:66` 已经有这条更宽的正确写法（`/^var\(--(?:cc-syntax|editor)-[a-z0-9-]+\)$/`），**同一个文件的 `:75` 却还是 `\d+`**。理由：这几个测试的**意图**是"色值必须是变量引用、且被注入的表声明"，与"名字是编号还是语义名"无关；逐个改成新名字会把它降级成"名字的快照"，护栏反而变弱。附录 A 补这 4 行。

### C 组 · 仍未拍板 / 作者只给了建议

**N9 · 决策 4(a) 的"统一"到底统一到什么程度？（**本轮新出的实质问题**，两位审议时只有"要不要做容器"这一个问题）**
- 事实：四条路径今天的**形态并不一致**——chat 明色 `bg-muted/50`（**半透明**）、chat 暗色 `--n-zinc-900`（不透明）、编辑器明色 `--muted`（不透明）、编辑器暗色 Prism 色（不透明）。§5.1b 写的是"**都引同一个令牌**" ⇒ 四路同值 ⇒ **3 条路径会产生视觉变化**（编辑器代码块若带上 alpha，会露出编辑器页底色）。而 §6.3 的记账目前只写了 `--n-zinc-900` 那一处（Claude 细则 4）。
- 另一个实测：`--muted` **本身已经是主题可达的**（基座 `sand-100` / `ink-850`，`cc-onedark` 已把 ink-850 覆盖成 `218.57 12.07% 22.75%`）⇒ **真正不可达的只有 chat 暗色那一个消费点**。
- **作者建议**：把 (a) 拆成两个子选项交审阅者表态：
  - **(a1) 最小**：只把 chat 暗色的 `--n-zinc-900` 换成一个 L2 引用（可复用 `--muted`），**不加新令牌**、其余三路不动。视觉变化仅 chat 暗色一处。
  - **(a2) 完整**：新增 `--code-block-bg`，四路同值。**买到的真能力**是"主题能把代码块底设成不同于 `--muted` 的值"——对 `cc-onedark` 正是如此（编辑器页 `#282c34` ≠ 暗色 `--muted` 的 `#333841`），所以这个能力**有实际价值、不是空头**。代价：新令牌 ＋ 3 处视觉变化，**必须逐条记账**。
  - 作者倾向 **(a2)**，但要求 §6.3 补齐那 3 处记账后再动手。

**N10 · 决策 7 的"另立案"要落成什么？**
- 两位都主张另案、不并入本片，作者同意。
- **作者建议**：同意另案，但**要求现在就在主题文档的切片表登记一行（标"待排期"）**——否则"另立案"的实际含义是"永不立案"。本片只承诺"新增的明暗两半不制造新泄漏"（两位都提过这条下限）。

**N11 · B1b 的两个内部决定（审阅者已要求开工前定死，方案只给了建议）。**
- **值形状**：作者建议 **triplet ＋ 消费处写 alpha**（保住 chat 明色 `bg-muted/50` 的半透明质感）。**联动两条**：① 取 (a1) 则本决定消失；② 取 triplet 则 **B1b 自己就需要字面色豁免**（overlay 里写的是 `220 13% 18%` 这种三元组，命中 N7 的护栏），取完整表达式则不需要。
- **明色半边逐套来源**：方案只给了暗色值。建议 B1b 开工第一步先列"参照物 → 令牌"的逐套映射表（与 B2 同格式），**先出表再动代码**。

**N12 · `cc-onedark-vivid` 的显示名（用户）。**
- **作者建议**：`cc-onedark` 是"暗夜一号"，本套建议 **"暗夜一号·浓彩"**（Vivid 的含义就是加饱和）；若要更中性可用"暗夜一号·鲜明"。**由用户定**，id 保持 `cc-onedark-vivid`。

### D 组 · 作者建议新增（两位都未提）

**N13 · 用一条"结构测试"替掉"靠变异测试守白名单同源"的脆弱做法。**
- 现状：`SYNTAX_SELECTORS` 的键是 `SyntaxSemanticName`（`syntaxTheme.ts:113`），而白名单模式 `/^--cc-syntax-[a-z][a-z0-9-]*$/` 是**另一份手写清单**（`userThemeTokens.ts`）。Claude 细则 3 已指出：将来某个名字若含下划线，模式会**静默失配**。方案现在的处置是"变异集里加一条'名字改下划线 ⇒ 必须红'"——那是**证明护栏会红**，不是**保证护栏恒真**。
- **作者建议**：加一条结构测试——遍历 `SYNTAX_TOKEN_MAP` 的每个**非编号**名，逐个过 `FAMILY_RULES` 的匹配，全过得通过。一条测试、成本极低，把"某天会静默失配"从"靠变异兜"变成"当场红"。

**N14 · §6.1 要写明"B1 的零变化＝渲染值不变，产物文本会变"。**
- B1 升名后，注入的 `<style id="cc-syntax-theme">` 里 11 个变量**名字变了**（值不变）。若 §6.1 只写"零变化"，B1 收口时的产物 diff 会被误判成违反承诺。
- **作者建议**：§6.1 加一句"零变化指**渲染值**；产物文本因名字替换而变，逐槽核对值不变即可"。

### OpenCode（第二轮）

> 先交代立场变化：作者两处自查我已**独立读库源码复核**，全部成立——`highlight.js:291-294`（默认 `codeTagProps` 仅在 prop 为 `undefined` 时生效，两个消费者都显式传了）、`:328-333`（`preProps.style = Object.assign({}, style['pre[class*="language-"]'], customStyle)`，chat/编辑器都未覆盖 color ⇒ 正文色＝槽 4）、`create-element.js:36-46`（`useInlineStyles` 默认 true，token 色按**类名**查表，选择器键从不序列化成 CSS）。据此：我第一波批注 2 的因果（"选中色停在 oneDark 蓝"）**认账撤回**；批注 3 的值形状问题、批注 5 的缓存记账均已被采纳落实。以下按 N1–N14 逐条表态，另有 A/B/C 三条新发现。

**[N1 · `--cc-syntax-block-foreground`]**
> [!NOTE] 同意新名。绑定改判成立（复核同上），名字跟绑定对象走；`block` 与 `pre` 对应自然，维持无 `-color` 后缀的既有偏好。

**[N2 · `::selection` 12 槽——认账，且补一个更强的论据与实验读法]**
> [!IMPORTANT] 作者判定成立，我第一波的因果撤回。补强论据：**升名本身也造不出这个能力**——`::selection` 槽的问题不是"变量没被引用"，而是**选择器键整个没有生效通路**；就算把 `--cc-syntax-13` 升名，它仍只被那个死键引用。要真生效得在 `index.css` 另写真规则（如 `pre[class*="language-"]::selection { background: var(…) }`），那是新机制不是改名——所以"点名不升名"是唯一正确处置。实验读法（作者点名反对方指定，两步像素取样，双引擎跑）：① 向页面注入真规则 `code[class*="language-"]::selection{background:#ff0000}`，拖选代码块文字，对选中区截图像素取样 ⇒ 应变红，证明"通路存在但今天空载"；② 移除注入再取样 ⇒ 浏览器默认色（≠ oneDark 槽值系 `#3e4451`/`#9da9bf`），判死旧因果。`getComputedStyle(el,'::selection')` 在 Chromium 可读但跨引擎不稳，以像素为准。

**[N3 · 第 11 槽元素改判]**
> [!NOTE] 接受（复核同上）。双段反证保留正确，补一个读法细节：删声明后 `<code>` 的回落是**继承** `<pre>` 的回落值——断言应写"两元素同值且等于基色表的槽 4 base 值"，而不是各自独立比。

**[N4 · Vivid 动终端]**
> [!NOTE] 接受订正，结论不变（仍 Vivid）。B3 DoD 加终端面：`terminal-tokens.spec.ts` 的消费者守卫范式（真 xterm 读画出的 ANSI 色）直接复用；写用例时注意 normal/bright 同值对的折算口径（§3.7 订正里"9～10 槽"的由来）。

**[N5 · 计数 15/16/17 与槽 5 无行]**
> [!TIP] 采纳作者建议：统一 **17**、一行一槽。补一个同步点：§5.1 生产代码表 ④ 与 §7"把死槽当活槽升名"行里的"15 个槽"括注要一并改 17，否则修订完 §3.2 又在两处留下旧计数。

**[N6 · `tokenNames` 追加与否——本轮我唯一与作者落笔方向相反的表态]**
> [!WARNING] 现在文档里有**三处互相矛盾**：§3.6-1 说"无需追加、**不要**手工追加"；§5.1 测试表仍写"`tokenNames` 追加"；§6.1/§6.6 说"B1 基线应恰增语法条目"。事实（已核）：`cssSource = index.css?raw`（`main.ts:23`），B1 无人声明 ⇒ 不追加则 **B1 基线 diff = 0 行**，§6.1/§6.6 的"B1 恰增"落空。我支持 **N6 作者建议（B1 手动追加）**：① G4 的全量机检证据不该缺浅色半边——黄金快照锁名、`ONE_DARK_SLOT_COLOURS` 只锁暗色值，浅色半边值表目前仅是 §5.1 ③ 的"建议补"；② §3.6-1 的"掩盖缺陷"论据不成立——`tokenNames` 是**读取清单**不是存在性断言，某槽 light 无值时 `getPropertyValue` 读到空串、**如实入基线**，缺陷更显性而非被掩盖；③ 成本一行，B2 起与自动收录取并集（`Set` 幂等）。若作者最终仍取"不追加"，则 §6.1/§6.6/§5.1 表三处必须同步改成"B1 基线 diff 为 0 行、零变化由快照＋明暗值表承载"，且值表浅色半边从"建议"升"必须"——**三个方案都行，三处矛盾不能留**。

**[N7 · 豁免移 B2、先定值形状]**
> [!TIP] 同意。`HSL_TRIPLET`（`token-contract.spec.ts:37`）只认空格三元组、`hsl(...)` 形状不命中而 hex 命中——与我的第一波批注 4 同判。连带：§5.1 测试表的"token-contract 加豁免"行随迁 B2；§3.6-4 的条件化表述（"若是 hex 形状"）可保留。

**[N8 · 4 个被升名击穿的测试文件]**
> [!TIP] 同意"放宽正则"的修法（优于逐个写死新名，护栏意图不变）。补充实测：4 文件命中全部确认；但 `syntaxTheme.test.ts:100`（`preRule.background`）测的是**不升名**的槽 3 ⇒ 放宽后**继续绿**——不要把它误当"该红"样本。建议变异集加一条"把宽正则改回 `\d+` ⇒ N8 列的文件恰红、`:100` 仍绿"，把这条边界钉住。

**[N9 · (a1) vs (a2)]**
> [!TIP] 表态 **(a2)**：`cc-onedark` 编辑器页 `#282c34` ≠ 其暗色 `--muted`（作者实测 `218.57 12.07% 22.75%` ≈ `#333841`——`--muted` 走 `--palette-ink-850`，主题可达性无疑，它在 `SURFACES.substrate` 里），"代码块底可以不同于 `--muted`"是真能力。(a1) 会让三种画法长期共存、后续收口要第二次动消费者；3 处视觉变化都在 B1b 独立片内逐条记账，代价可控。

**[N10 · 另案落成切片表登记行]**
> [!NOTE] 同意。"另立案"必须落成主题文档切片表的"待排期"行，否则就是永不立案。

**[N11 · B1b 值形状与明色半]**
> [!NOTE] 同意 triplet ＋ 消费处写 alpha（`hsl(var(--code-block-bg) / 0.5)`），与 L2 同形；明色半先出"参照物 → 令牌"映射表再动代码。若 N9 取 (a1)，值形状决定随联动①消失。

**[N12 · 显示名]**
> [!NOTE] 用户定。"暗夜一号·浓彩"可，不另提。

**[N13 · 结构测试替变异守同源]**
> [!TIP] 同意，且补同族一条（我第一轮遗留的"三处编码"之③）：all-or-nothing／声明即生效断言识别"语法槽声明"的判定，也应以 `Object.values(SYNTAX_TOKEN_MAP)` 为**单一来源**——别在 spec 里再写第三个正则（前两个是生成器反向表、白名单模式）。

**[N14 · 零变化＝渲染值]**
> [!NOTE] 同意。

---

**[新发现 A · B1 对 `.tmTheme` 编译器的自动回退连锁——两位审阅者与作者都没提，附录 A 缺文件]**
> [!WARNING] `tmTheme.ts:432-436` 的产出循环遍历 `SYNTAX_TOKEN_MAP` 的**全部键**，未被 scope 命中的槽**回落全局 `foreground`**（该策略被 `tmTheme.test.ts:130-142` 用例固化："a slot no rule mentions takes the global foreground"）。B1 给映射加 `blockForeground` 键后，**每个 `.tmTheme` 的编译产物会自动多出 `--cc-syntax-block-foreground = 全局前景`**——而改判后这正是"正文色真身"槽 ⇒ 既有 `.tmTheme` 用户的代码块正文色会随其全局前景移动。语义上这恰好正确（TextMate 全局前景就是正文色），但它是 **B1 机制片**里用户侧的可见变化，方案通篇未提（§1.2 缺口 4 只说了"它也能改语法色"的现状，没预见加键的连锁）。四件配套事：① 拍板**保留**（我倾向保留，TextMate 语义正确）还是**收窄**（循环改按 `SYNTAX_SCOPE_PATTERNS` 的槽集遍历）；② 更新 `tmTheme.ts:117、:127` 的"ten semantic names / ten-slot projection"措辞；③ `tmTheme.test.ts` 补一条锁定第 11 槽回退的用例；④ **附录 A 的 B1 生产代码表补 `src/shared/tmTheme.ts`、测试表补 `src/shared/tests/tmTheme.test.ts` 两行**（现表只有 syntaxTheme / userThemeStyles / userThemeTokens）。

**[新发现 B · §3.7 语法板来源表仍只覆盖暗色半]**
> [!WARNING] 除 catppuccin（Mocha/Latte 双套）外，其余三行参照物全是暗色板（`one_dark.xml`、Islands editor scheme、`one_dark_vivid.xml`）。§3.3 已论证语法板必须明暗分块，但**每套主题浅色半的来源逐套缺位**：One Dark 插件与 Islands 有没有浅色 scheme？若答案是"浅色半沿用 oneLight 基色不动"，要写明——并且它直接约束 §3.8 的"一眼可辨"：**只在暗色成立**，浅色下 Vivid 与 `cc-onedark` 同板，§3.8 对比表应按外观分别声明，§6.3 记账也是两外观各一份。请在 §3.7 补一列"浅色半来源"，或如实写"浅色半本片不动"并记入 §6.3。

**[新发现 C · §4 表"附录 B 取证索引（4818）"标签错位仍在]**
> [!TIP] 主题文档 `:4818` 落在其**审阅批注区**（Claude 的 WARNING，区块始于 :4807）；真正的"附录 B：解包取证索引"（:4781）是 WorkBuddy/Codex 解包证据，与 `--cc-syntax-N` 无关。内容与改判本身没问题，但回写时对象应写"审阅批注（Claude WARNING，4818）"，否则按标签找附录 B 会扑空。

### Claude（第二轮）

> 立场：作者两处自查（N3 元素改判、N5 计数 17）与 OpenCode 三点库代码复核，我已**读 `node_modules` / 本仓库源码独立确认**——`highlight.js:290-294`（`codeTagProps` 仅 prop 为 `undefined` 时取默认，两消费者都显式传了 ⇒ `code[...]` 族不上身）、`:333`（`preProps.style = Object.assign({}, defaultPreStyle, customStyle)`，未覆盖的 `color` 落到 `pre`）、`createStyleObject`/`useInlineStyles`（style 对象按类名查表、选择器键不序列化）。据此我第一波的细则 1 升级为"支持元素改判"，并对 N2 的旧因果**撤回**。以下 N1–N14 逐条；另有 C 组第 15 项与 B 组汇总级发现各一条。

**[N1 · `--cc-syntax-block-foreground`]**
> [!NOTE] 同意。绑定改判成立（复核同上），名字跟绑定走、`block` 对 `pre` 自然；与 OpenCode 一致维持"不带 `-color`"偏好。点名 `block-color` 有歧义这点同意。

**[N2 · `::selection`——撤回我第一波的暗示，赞同"点名不升名"]**
> [!IMPORTANT] 我意识到自己第一波没有独立质疑过 selection 这 12 槽，OpenCode 批注 2 把因果引向"停在一 / 二号主题蓝上"时我未置可否。现在**明确撤回**：作者依据（style 对象类名查表、选择器键无生效通路、`index.css::selection` 0 处）与 OpenCode 补强（升名也造不出能力，须在 `index.css` 写真规则才算新机制）叠加，结论是唯一的——**点名不升名**。但 OpenCode 给的"注入规则→像素取样→移除→再取样"实验我**要求列为 B1 实施期强制项**（作者建议的"反对方指定读法"由 OpenCode 提供了，够具体、可执行），不让它停在"两边推理"。

**[N3 · 第 11 槽元素改判]**
> [!NOTE] 接受。双段反证保留；采纳 OpenCode 的读法细节（删声明后 `<code>` 回落是**继承** `<pre>` 的回落值，断言应写"两元素同值且等于槽 4 base"，非各自独立比）。

**[N4 · Vivid 动终端]**
> [!NOTE] 接受订正，结论不变（仍 Vivid）。**但**我要在 OpenCode 基础上补一句：B3 DoD 的终端面不能只加"测 ANSI 色"这一个动作——因为本方案的目标词一直是"代码块像主题"，把终端拉进来意味着 B3 的验收描述要同步从"代码块变"扩为"代码块＋终端"，§3.8 的对比表与 §6.3 记账都是两外观之外再加终端一列。若验收口径不写清，实施时容易只补一个终端 spec 而漏改 §3.8。

**[N5 · 计数统一 17、一行一槽]**
> [!TIP] 同意：改 17、一行一槽、槽 3 标"半活"、槽 5 标"仅暗色有值"。补充同步点：除 OpenCode 提的 §5.1 ④ 与 §7 两处括注外，**§3.2 标题本身与 3.2b 开头**（"三个死槽"字样）也要核对——让"17"成为全文档唯一计数。并且：既然一行一槽，**每一步都写一句"为什么"**，这份清单是给下一个读 136 项快照的人看的，理由比计数更能防"以为漏了"。

**[N6 · tokenNames——我支持 OpenCode 的"B1 手动追加"立场]**
> [!IMPORTANT] 我第一波 §3.6/附录 A 的原始建议就是"`tokenNames` 追加 `Object.values(SYNTAX_TOKEN_MAP)`"，作者在第二轮的 N6 里把它自我改成"**无需追加、自动进 tokens**"，OpenCode 反驳并主张回到"B1 手动追加"。**我站在 OpenCode 这边**，理由补齐三点：① `main.ts:23` 的 `cssSource = index.css?raw`，`extractTokenNames` 只扫 `index.css`，B1 无人声明语法槽 ⇒ "自动"在 B1 不成立，`§6.1/§6.6` 的"B1 基线恰增语法条目"会落空——这是文档当前三处矛盾的核心；② 我第一波就指出"升名是零变化最需要保护的一步"，而零变化的**全量机检**证据（而不是快照的抽样）正需要语法槽进 `tokens`；③ `tokenNames` 是读取清单不是存在性断言，light 无值槽如实进基线（读空串）反而让缺陷更显性。**三处矛盾必须解，我选"手动追加"，并同时把读清单升级为"能如实表达 light 省略"** —— 若作者坚持不追加，则按 OpenCode 的备选把三处改成"B1 基线 diff 为 0 行"且浅色半边值表从"建议"升"必须"，两条路都行，但不能留矛盾。

**[N7 · 豁免移 B2、先定值形状]**
> [!TIP] 同意。`hsl(...)` 不命中、hex / 空格三元组命中，与 OpenCode 一致；"需不需要豁免"必须以实测一条 overlay 声明跑过护栏为准，不许靠 §3.3 示例形状推。§5.1 表的"加豁免"随迁 B2。

**[N8 · 4 个被击穿测试文件]**
> [!TIP] 同意"放宽正则到 `[a-z0-9-]+`"而非逐个写死新名（护栏意图不变）。采纳 OpenCode 的边界钉法（变异集加"宽正则改回 `\d+` ⇒ N8 四文件恰红、`:100` 仍绿"）。补充提醒：`editorThemeTokens.test.ts:66` 已有宽正则、`:75` 是 `\d+`，这俩**同文件并存**本身就是"句改堵漏"式的坑——修的时候顺手核对同文件是否还有其它 `\d+` 语法正则，别只改注明的一处。

**[N9 · (a1) vs (a2)]**
> [!TIP] 表态 **(a2)**。理由与 OpenCode 一致（`cc-onedark` 编辑器页 `#282c34` ≠ 其暗色 `--muted`，这个差值正是"代码块底不同于 `--muted`"的真能力，(a1) 换 `--muted` 把它丢掉）。补充从第一波延续的立场：**前提仍是容器令牌与语法同判——不进 `SURFACES`**，B1b 独立片内逐条记那 3 处变。作者若取 (a2)，需在 §6.3 补全 3 处记账（chat 明色半透明变、编辑器明色变、编辑器暗色变）后再动手。

**[N10 · 另案落成切片表登记行]**
> [!NOTE] 同意。只有落成"待排期"行才算立案；本片下限（新增明暗两半不制造新泄漏）两审一致，接受。

**[N11 · B1b 值形状与明色半]**
> [!NOTE] 同意 triplet ＋ 消费处写 alpha，与 L2 同形；明色半先出映射表再动码。联动确认：取 (a1) 则本决定消失（OpenCode 已记）。

**[N12 · 显示名]**
> [!NOTE] 用户定。"暗夜一号·浓彩"可接受，不另提。

**[N13 · 结构测试替变异守同源]**
> [!TIP] 同意，且补 OpenCode 同族第三处：all-or-nothing／声明即生效的"哪种 token 算语法槽"判定也以 `Object.values(SYNTAX_TOKEN_MAP)` 为单一来源。结构测试（遍历非编号名全过 `FAMILY_RULES`）成本极低，采纳。

**[N14 · 零变化＝渲染值]**
> [!NOTE] 同意。同时接受 OpenCode C 组的"浅色半来源"作为 §3.7 补列项（见下）。

---

**[补 B · §3.7 浅色半来源——升级为 CAUTION 前的确认项]**
> [!WARNING] OpenCode 的新发现 B（语法板来源表只覆盖暗色半）我**确认成立**，且补一个连带：作者改判 N4 后 Vivid"动终端"是**两外观一起动**还是**只暗色**？`one_dark_vivid.xml` 若只有暗色板，浅色半 + 终端的来源就都悬空。请作者在 §3.7 补一行"**每套主题每个外观每面（语法/终端/灰阶）的来源或'本片不动'**"，这比单补"浅色半来源"一列更完整——因为 N4 已经把终端也算进改动面，来源表不能只补语法。这也是我对 N4 那段"验收口径要写清"的另一面：**改动面定了，来源表必须同宽**。

**[补 C · （针对 OpenCode 新发现 C 的汇总级提醒）]**
> [!NOTE] 新发现 C 的"附录 B 标签错位"我复核认可（`:4818` 落在审阅批注区而非附录 B）。这条虽然小，但属于**回写主文档时的引用错误**，会直接让下一轮读者按标签扑空——建议牵头把它并进"四、由本结论产生的文档改动清单"的回写项，而不是只作备注留在审阅区，防止汇总时丢。

---

### 牵头结论（第二轮）

> 汇总时间：2026-09-28。两位审阅者（OpenCode、Claude）**按 N1–N14 逐条表态，全部收敛**：**N1–N14 无一项存在分歧**（其中 N12 归用户）；另带出**三条新发现 A / B / C**，牵头逐条独立复现后**全部采纳**（A、C 是本方案新增的改动项，B 落到 §3.7）。
>
> **本轮已无"未统一"项。** 剩下的只有两处**用户偏好**（第 3 项的新名字、第 5 项的显示名）。另一位审阅者第一波的两条旧因果（"选中色停在 oneDark 蓝上"）**由两位各自明确撤回**，故 N2 的分歧随之消解。

**一、N1–N14 判定（两位一致，牵头采纳）**

| 项 | 内容 | 判定 | 落到哪 |
|---|---|---|---|
| N1 | 命名 `--cc-syntax-block-foreground` | 两位一致同意（保留"不带 `-color`"偏好） | §3.2 / §8 决策 3（**待用户点头**） |
| N2 | `::selection` 12 槽：点名不升名 | 两位一致**撤回旧因果**、同意点名；Claude 要求把 OpenCode 给的读法列为 **B1 强制项** | §3.2 六~十七行 / §5.1 测试表末行 / §6.2 |
| N3 | 第 11 槽元素改判 ＋ 读法细节 | 两位接受改判；采纳"`<code>` 回落是**继承** `<pre>`"的读法 | §3.2 末 / §6.2 |
| N4 | Vivid 动终端 ⇒ B3 改动面扩大 | 两位接受订正；Claude 加码"验收描述要同步扩" | §3.8 / §5.3 / §6.3 |
| N5 | 计数统一 **17**、一行一槽、逐槽写理由 | 采纳（两位均要求全文档唯一计数） | §3.2 / §3.2b / §5.1 ④ / §7 / §9 |
| N6 | `tokenNames` **B1 手工追加** | 两位**都站"手工追加"**，牵头采纳；三处矛盾已统一 | §3.6-1 / §3.4 / §6.2 |
| N7 | 豁免移 B2、先定值形状、**必须实测** | 采纳 | §3.6-4 / §5.1 表 / §5.2 第一步 |
| N8 | 4 个被升名击穿的测试文件 ＋ 边界钉法 | 采纳"放宽正则"而非写死新名；采纳 Claude"同文件还有别的 `\d+`"的提醒 | §5.1 测试表 / §6.5 / 附录 A |
| N9 | **(a2)** 新增容器令牌、四路同值 | 两位一致表态 (a2)，牵头采纳；3 处视觉变化须先记账 | §5.1b / §6.3 |
| N10 | "另立案"落成切片表"待排期"行 | 采纳 | §8 决策 7 / 附录 A 切片表行 |
| N11 | triplet ＋ 消费处写 alpha；明色半先出表 | 采纳 | §5.1b |
| N12 | 显示名 | **归用户** | §8 决策 5 |
| N13 | 结构测试替"靠变异守白名单同源" | 两位采纳，并各补一处"单一来源"约束 | §6.4 / §5.1 表 |
| N14 | 零变化＝**渲染值**不变、产物文本会变 | 采纳 | §6.1 |

**二、三条新发现（牵头独立复现后采纳）**

1. **新发现 A · `.tmTheme` 的连锁 —— 属实，且是本轮最有价值的一条。** 复现：`tmTheme.ts:433` 就是 `for (const slot of Object.keys(SYNTAX_TOKEN_MAP) as SyntaxSemanticName[])`，`:434` 是 `slotColours.get(slot) ?? foreground` ⇒ 加键必然给**每个** `.tmTheme` 的产物多一条声明，且该行为已被 `tmTheme.test.ts:130-142` 固化。
   → **裁定：保留**（OpenCode 倾向保留，Claude 未反对）。**加强的理由（两位都没说到的）**：今天 `.tmTheme` 用户的 `<pre>` color 是**基色表**的槽 4（oneDark `#abb2bf` / oneLight `#383a42`）——**与用户自己的主题无关**，这正是该模块注释 `:402-404` 说的"leaving the base value there would mix two palettes in one file"。所以保留不是"顺带接受一个副作用"，而是**修好一个本来就错的取值**。
   → 配套四件事**全部采纳**：`tmTheme.ts:117/:127` 的 "ten"→"eleven"；补一条锁定第 11 槽回退的用例；附录 A 补 `tmTheme.ts` 与 `tmTheme.test.ts` 两行；**单向记账四处**（§5.1 生产代码表、§5.1 验收口径、§6.1、§6.3）。
   → **被否的备选**（把循环收窄到 `SYNTAX_SCOPE_PATTERNS` 的槽集）：要写代码，且唯一效果是**保住一个错值**。
2. **新发现 B · §3.7 来源表只覆盖暗色半 —— 属实，且比原批注更重。** 复现：One Dark Theme 插件 jar **全清单**只有 `one_dark.theme.json` / `one_dark_vivid.theme.json` ＋ `one_dark.xml` / `one_dark_vivid.xml`，**没有任何浅色板**；Islands 只有 `IslandSchemeDark.xml`。⇒ **三个参照物（One Dark、Vivid、Islands）都没有浅色语法板**，只有 catppuccin 是双套。另一条实测剔除了一个担心：**终端面是外观无关的**（终端板走 L1 的 20 条 `--palette-term-*`，每套主题只声明一次）⇒ 不存在"浅色终端来源"。
   → 采纳 Claude 的"同宽"要求（主题 × 外观 × 面），并**补一条两位都没提的巧合**：基色浅色半本身就是 Prism 的 `oneLight`，而它是 One Dark 那个项目的浅色姊妹板 ⇒ 对 `cc-onedark`，"浅色语法半不动"是**语义自洽**的；对 `cc-onedark-vivid` 则意味着**只在暗色半可辨**，故 §3.8 的比较表与 §6.3 的记账都按外观拆开。
3. **新发现 C · §4 表里"附录 B 取证索引（4818）"标签错位 —— 属实。** 复现：主题文档 `:4818` 是「## 审阅批注」区（起于 `:4807`）里 Claude 的 WARNING；真正的「## 附录 B：解包取证索引」在 `:4781`，内容是 WorkBuddy/Codex 解包证据。
   → 已按 Claude 的要求并进**变更清单**（不只是留在审阅区备注）：§4 表该行的对象改写为"审阅批注（Claude WARNING，4818）"。

**三、牵头的两处"取舍说明"（审阅者未表态、由牵头定）**

1. **新发现 A 取"保留"会让 B1 不再全场景零变化** —— 这是**本方案唯一一处为"修错值"而接受的行为变更**。处理方式是**单向记账 + 单测**，不是改回旧行为。若审阅者认为"B1 必须绝对零变化"优先，可改取收窄路线，但须重开本节。
2. **§3.2 的计数在第二轮由 15 改为 17** —— 这解释了上一轮"四、由本结论产生的文档改动清单"里仍写着"15 项"的历史痕迹：那条记录的是**当时**的改动，**以本节为准**，正文已全部改为 17。

**四、由第二轮结论产生的文档改动清单（本次已落笔）**

- §3.2：17 个非契约槽**一行一槽**重写（含真实选择器，照快照逐字抄）、逐槽理由、`::selection` 补 OpenCode 的"升名也造不出能力"论据
- §3.2b / §9 / §4 / §5.1 ④ / §7：计数 15 → 17 全面同步
- §3.4 / §6.2：`tokenNames` 口径由"自动"改"手工追加"（N6，三处矛盾收敛）
- §3.6-1 / §3.6-4：手工追加的理由与"空串先例"；豁免移 B2 ＋ **必须实测**
- §3.7：新增"来源表必须与改动面同宽"整块（事实 1/2/3 ＋ 巧合 ＋ 取舍建议）
- §3.8：比较表按外观拆开 ＋ 终端面的连带说明
- §4：`4818` 的引用对象更正（新发现 C）
- §5.1：生产代码表补 `tmTheme.ts`（新发现 A）、测试表补 `tmTheme.test.ts`、4 个被击穿文件、`::selection` 判死实验、结构测试（N13）、`token-contract` 改为"不动"
- §5.1 验收口径 / §6.1：零变化的**精确定义**＋ 单列 `.tmTheme` 例外 ＋ 指纹重编译说明
- §5.1b：定 (a2) ＋ 3 处视觉变化预告 ＋ 两个内部决定落定
- §5.2 / §5.3：B2 的两步前置（实测护栏 ＋ 出同宽来源矩阵）；B3 的 DoD 扩到"代码块 ＋ 终端、且分两外观"
- §6.3：记账形状改为"两外观分列 ＋ 终端单列 ＋ '本片不动'成行"＋`.tmTheme` 一条
- §6.4：新增"两条单一来源约束"＋ 结构测试（N13）
- §6.5：新增 N8 的边界钉法 ＋ 新发现 A 的变异
- §7：新增两行风险（`.tmTheme` 连锁、来源表比改动面窄）
- §8：状态更新（决策表降为决议记录；只剩两处用户偏好）；决策 4 改写为 (a2)/(a1)/(b)/(c)
- 附录 A：补 4 行文件 ＋ N10 的"待排期"行 + N6/N7 的迁移
- 附录 C：补新发现 A/B/C 的取证行

**五、仍需用户点头的（只剩两处，均为偏好）**

1. **第 3 项的新名字** `--cc-syntax-block-foreground`（两位审阅者已一致同意）；
2. **第 5 项的显示名**（建议"暗夜一号·浓彩"，id 保持 `cc-onedark-vivid`）。

---

## B1 实施记录（2026-09-29）

> 开工前拍板（用户："开始，按你推荐的吧"）：第 11 槽定名 **`--cc-syntax-block-foreground`**；新主题显示名 **"暗夜一号·浓彩"**（id 不变）；**决策 7 另立案**（N10 的"待排期"行随本片写进主题文档）。

### 一、门槛（全绿）

| 项 | 读数 | 对照 |
|---|---|---|
| `npm test` | 1029 / 1008 通过 / 20 失败 / 1 跳过 | 与开工前**逐字相同**；`server/` 树 0 行改动（`git diff -- server/` 与 `git status --short -- server/` 同时为 0）⇒ 按纪律豁免名字集 A/B |
| `test:client` | 147 文件 / 1234 通过 | A/B（`git stash push` 后重跑）：基线 147 / 1230 ⇒ **＋4**，三条归属明确——`syntaxThemeTokenMap` ＋1、`userThemeTokens` ＋2、`tmTheme` ＋1 |
| `test:theme-tokens` | **142 通过**（chromium ＋ webkit） | 原 132 ＋ 10（`user-theme-syntax` 4 测试 ×2 ＋ `theme-overlays` 1 ×2） |
| `lint` | 153 warnings / 0 errors | 与基线相同 |
| `typecheck` ＋ `typecheck:theme-tokens` | 0 错 | `build:client` 是 vite/esbuild、**不校验类型**，故这两条必须单跑 |
| `build` | exit 0 | — |
| `token-baseline.json` diff | **22 增 / 0 删**，新增行 100% 含 `cc-syntax` | 这就是 §6.1 的"渲染值零变化"证据：11 明 ＋ 11 暗 |
| 冻结快照 diff | **恰 11 行**改名为语义名，其余 125 个编号槽**逐字节未动** | 计数在命名槽上也自增是刻意的（见"三、5"） |

### 二、变异集（9 条，逐条实测）

| # | 变异 | 红 | 说明 |
|---|---|---|---|
| M2 | `ensureSyntaxStyleElement` 的插入位置 `insertBefore(firstChild)` → `appendChild` | 1 | `markdownSyntaxThemeInjection` 的落位断言。**顺序是承重的**，这条是它的护栏 |
| M3 | `tmTheme.ts:434` 去掉 `?? foreground` | 5 | 含**本片新增**的"第 11 槽回落全局前景"用例 |
| M4 | 白名单 `[a-z]` → `[a-z0-9]` | 4 | 编号槽立刻变可授权 |
| M5 | 某个语义名改成下划线（`--cc-syntax-block_foreground`） | 2 | 含 N13 的**结构测试**——它把"某天会静默失配"变成当场红 |
| M6 | 宽正则改回 `\d+`（N8 的边界钉法） | 1 | 恰是遍历命名槽那条；**覆盖槽 3 的断言仍绿**，证明"放宽"没放宽过头 |
| M7 | 给 `cc-onedark` 暗色块加**一条**语法声明 | **2**（chromium ＋ webkit） | all-or-nothing 报出缺的 10 个槽；且 per-theme 测试**仍绿**——证明后者已独立覆盖"声明即生效" |
| M8 | 命名槽也消耗编号（`variableCount` 不自增） | 1 | 快照（125 个编号整体前移） |
| M9 | 删掉 `ONE_DARK_SLOT_COLOURS.blockForeground` | 编译期 | `TS2741` —— §3.1-3 的"加键是编译期强制的"被证实 |
| — | 变异值均**不等于**基色值 | — | 照本线纪律（2-O / 2-P 各栽过一次"变异写成与基色同值 ⇒ 假绿"） |

### 三、实施期发现与改判（6 条，如实记账）

1. **§3.1-2 的"`deriveTokenMap()` 一行都不用改"要收窄。** 11 个名字**不是同一条拼写规则**（`blockForeground` 不带 `-color`），若让生成器按"kebab ＋ `-color`"机械派生，那个例外就成了藏起来的特例。故 `SYNTAX_SELECTORS` 的值由 `selector.property` 改为 `{ slot, token }`（**令牌名显式写出**），`deriveTokenMap` 的取值方式随之从 `key` 改成 `slot`。**反查语义一个字节未变**，§6.2 那条"次一级反证"的命题（键同一、变量名按新规则）照旧成立并被测试钉住。
2. **语义表必须上移到生成器之前。** `syntaxTheme = buildSyntaxTheme(…)` 在模块顶层执行，而表原本定义在它**之后**——加反向表后不重排就是 TDZ 错误。表连同 `SEMANTIC_TOKEN_BY_SLOT` 一并移到 `buildSyntaxTheme` 之前。
3. **`tmTheme.ts:127` 的 "ten" 不能改 "eleven"（本条是对方案 §5.1 要求的改判）。** §5.1 要求 `:117` 与 `:127` 两处都改；实测 `:127` 那句 "this table is a deliberate ten-**slot** projection" 里的 "this table" 指 `SYNTAX_SCOPE_PATTERNS` **自己**——它只映射 **10 个 scope 槽**（`blockForeground` 不对应任何 TextMate scope），改成 eleven 会失实。故：`:117`（"the ten semantic names `SYNTAX_TOKEN_MAP` binds"）照改（map 现在有 11 个键），`:127` **保留 ten** 并补一句"第十一个槽由产出循环按全局前景回落携带"。
4. **白名单扩充波及三处既有反例，不是方案列的"零处"。** `src/shared/tests/userThemeTokens.test.ts` 有三处（`:153` / `:181` / `:388`）拿 `SYNTAX_TOKEN_MAP.keyword` 当"主题不可授权"的反例，升名后它**变成可授权** ⇒ 三处改判为编号槽。**实现细节**：字面量 `--cc-syntax-3` 会命中 denylist（实施时真撞了一次，命中的是 `userThemeTokens.ts` 注释里的那一处），故测试用 `` `--cc-syntax-${3}` `` 拼出——**测试注释里也不能写**。
5. **`::selection` 判死实验的探针判据改判（原设计写"应显红"，实测那个探针过松）。** 原判据是"对选中区像素取样，注入 `#ff0000` 后应出现该色"。**两处错**：① chromium 把 `rgb(255,0,0)` 合成为 `254,50,50`，`g` 通道差 50 远超容差 ⇒ "规则确实落地"判成 0 像素；② 另一条比对因页面背景色恰好落在容差内**假阳性通过**。改用**主色判据**：三种状态（无规则 / `rgb(255,0,0)` / `hsl(220,13%,28%)`）的主色**互不相等**，且移除规则后**复原**——四条断言都不需要知道浏览器默认色是什么。诊断数据：选区高亮在 chromium 与 webkit **都渲染**，占元素裁切区约 **89%** 像素（`dominantColour` 的注释记了这个数）。**判死结论不变**：Prism 表给 `::selection` 写的颜色**不是**引擎画出来的那一个 ⇒ 那 12 个槽今天确实空载。
6. **一条方案要求的断言实为既有覆盖，故未另写。** §5.1 / §6.2 的"声明即生效"没有单独写一条：`theme-overlays.spec.ts` 的 per-theme 测试读每个主题声明的**全部**令牌（语法槽已在 `tokenNames` 里）并断言"按写的解析"，语法槽于是天然在射程内。改为在模块注释里点名。**M7 变异证实了这个判断**（加一条语法槽：per-theme 测试仍绿，只有 all-or-nothing 红）。

### 四、本片新落的测试资产

| 资产 | 内容 |
|---|---|
| `tests/theme-tokens/user-theme-syntax.spec.ts`（新） | 4 测试 × 2 引擎：① `.json` 语法槽生效 ＋ 基色表晚落位夺不回；② **顺序负控**——`reinjectSyntaxStyleSheet('last')` 必须把槽夺回（`≠ 主题值`，`= 基色值`）；③ `<pre>` 与 `<code>` **双元素**同值、随主题一起移动、删掉声明后**一起**回落；④ `::selection` 判死实验（主色判据，`sharp` 取像素） |
| fixture 新能力（`tests/theme-tokens/main.ts`） | `syntaxTokenNames`（语义槽清单＝单一来源）、`readCodeBlockColours()`（按消费者形状渲染真 `<pre>`/`<code>`，`<pre>` 的样式取自**生产** `syntaxTheme.style`）、`removeDeclaration()`（CSSOM 删声明，返回命中条数以防"什么都没删也看着对"）、`reinjectSyntaxStyleSheet('last')`（append 负控） |
| `theme-overlays.spec.ts` | 新增 all-or-nothing（**按外观各自判定**，槽清单取自页面的 `SYNTAX_TOKEN_MAP`，不写第三个正则）；模块注释补第 3 点说明语法为何不进 `SURFACES` |
| `syntaxThemeTokenMap.test.ts` | 新增 `ONE_LIGHT_SLOT_COLOURS` 与"命名槽的浅色值未移动"断言（light 是 `buildSyntaxTheme` 会省略声明的那一侧）；denylist 注释说明它为什么**不需要**改 |

### 五、下一片

B1b（容器底色，决策 4 取 **(a2)**）尚未开工。它的两个前置按 §5.1b：**先出"主题 × 外观 × 面"同宽来源矩阵**，再动代码；值形状已定（triplet ＋ 消费处写 alpha），且它自己就需要 `token-contract.spec.ts` 的字面色豁免（与 §3.6-4 是同一件事的两处）。

---

## B1b 实施记录（2026-09-29）

> 开工前拍板（用户："按你推荐的"）：**取 (α)**——base 明 `var(--palette-white)`、暗写字面 `220 13% 18%`，接受它带来的那 **1 行字面色豁免**；**保住 chat 明色的 50% alpha**（§6.3 (i) 与 §5.1b 的验收句随之改判）；**纳入 mermaid 源码回落**——方案 §3.2b 的"三个消费者"之外实际还有第四处（`MermaidDiagram.tsx:70`），不纳入正是方案自己否掉 (a1) 的那条理由。两个前置按 §5.1b 先做完（**实测**了字面色护栏的 7 种形状、出了同宽的来源矩阵），结论与那处改判的记账都写在主题文档侧。

### 一、门槛（全绿）

| 项 | 读数 | 对照 |
|---|---|---|
| `npm test` | 1029 / 1009 通过 / 19 失败 / 1 跳过 | 在已知抖动区（19~21）；`server/` 树 0 行改动 ⇒ 按纪律豁免名字集 A/B |
| `test:client` | **149 文件 / 1239 通过** | B1 收口基线 147 / 1234 ⇒ **＋2 文件 / ＋5 用例**（chat `codeBlockPanel` 1、code-editor `codeBlockPanel` 2、`userThemeTokens` ＋2） |
| `test:theme-tokens` | **156 通过** | B1 基线 142 ⇒ **＋14**（`code-block-surface` 7 测试 × 2 引擎） |
| `lint` | 153 warnings / 0 errors | 与基线相同 |
| `typecheck` ＋ `typecheck:theme-tokens` | 0 错 | `build:client` 不校验类型，故这两条必须单跑 |
| `build` | exit 0 | — |
| `token-baseline.json` diff | **＋2**：`--code-block-bg` 明 `0 0% 100%`、暗 `220 13% 18%` | 与 B1 后的基线逐行比对，**只此两行**（`extractTokenNames` 扫 `index.css`，故这次不需要手工追加） |
| `theme-atom-conservation.json` | `total` 1517 → **1515**、`dark bg: zinc-900` 3 → **1**，**其余桶一个未动** | §6.3 的"反向后果"被这条守卫抓个正着，处置见"三、4" |

### 二、变异集（8 条，逐条实测）

| # | 变异 | 红 | 说明 |
|---|---|---|---|
| M1 | 删 `cc-catppuccin` 暗色的 `--code-block-bg` | **2**（该主题 × 2 引擎）| 面板底 ≠ 编辑器页底；其余主题仍绿 |
| M2 | chat 明色改回 `bg-muted/50` | 1（jsdom）| 消息点明 "the light half should paint the token" |
| M3 | `MarkdownCodeBlock` 恢复"按外观选板" | 1（jsdom）| 消息点明 **"in dark"** —— 这正是"两外观比对"那条断言买到的东西 |
| M4a | chat 删 `dark:bg-code-block` | 1（jsdom）| — |
| M4b | **探针**删 `dark:bg-code-block`（测试装置变异，验真引擎暗色断言的牙）| **12**（6 主题 × 2 引擎）| 全局那条"这段比较不是空转"仍绿 ⇒ 两条断言分工正确 |
| M5 | base 暗色改 `var(--palette-ink-900)`（即 (β)）| **4**（base ＋ **继承 base 的 `cc-ocean`**，各 × 2 引擎）| 顺带证明"未声明即沿继承链取值"是真的 |
| M6 | 白名单删 `--code-block-bg` | **2**（jsdom 两条新测试）| 变异前先补了这两条测试，否则这个变异**不会红**（见"三、2"）|
| M7 | 删 `token-contract.spec.ts` 的字面色豁免行 | **2**（chromium ＋ webkit）| 恰是那一条测试，其余 8 条仍绿 |
| M8 | mermaid 源码回落改回 `bg-muted/50` | 1（jsdom）| — |

**红数为何不总是 2**：把断言写成"每个主题一条测试"后，跨主题的变异（M4b / M5）红数 = 主题数 × 2。§6.5 的"每条变异恰 2 红"是**一条断言**的粒度；这里如实报实际数。

### 三、实施期发现与改判（5 条，如实记账）

1. **一条"更省事"的实现被实测否掉：`--code-block-bg: var(--editor-bg)` 不成立。** 开工时先试的是"引用编辑器页底"一步到位——零豁免、零重复，且逐套值与来源矩阵相同。**它错在消费者要的是 triplet**：chat 写 `hsl(var(--code-block-bg) / 0.5)`，而 `--editor-bg` 是**完整值**（base 暗色是 hex `#282c34`）⇒ `hsl(#282c34 / 0.5)` 非法、声明会被浏览器丢掉。故按方案原文走"独立 triplet 令牌"，`--editor-bg` 只作**值来源**与**测试期望**。**这不是能力缺口，是形状约束**：要合并这两者得先让 `--editor-*` 也改成 triplet，而它们被 `EditorView.theme()` 当完整值消费（§5.11 v5）——**别去补**。
2. **新增的契约面没有测试会红——开工时补了两条。** 给 `SEMANTIC_TOKENS` 加完 `--code-block-bg`，自查"删掉它会红吗"，答案是**不会**（既有测试不逐令牌点名）。故在 `userThemeTokens.test.ts` 补"收 triplet / 拒 hex"两条，M6 才有意义。**判据：新增一条契约面，先问"删掉它，哪个变异会红"。**
3. **`token-contract.spec.ts` 的测试名跟着豁免一起改。** 它原叫"…outside the palette and the editor board"，加第二个豁免后名字失实，改为"…the palette, the editor board and the code-block panel"；注释里写明两处豁免各自承载的是"外部板子的字面值"。
4. **`theme-atom-conservation.json` 不在方案的改动面表里。** §6.3 预告了"`--n-zinc-900` 被换掉 ⇒ 那个保证消失"，但没提这条守卫会因它变红——它是**阶段 0 的中性色守恒**守卫：两处 `dark:bg-n-zinc-900` 消费被替换 ⇒ 按设计报警。处置照它自己的说明（同 commit 重生成 ＋ 逐桶核对），diff 恰为 `total` −2 与 `dark bg: zinc-900` −2。
5. **暗色 chat 的"不透明"是本片的一处自决（方案未写）。** §5.1b 决定 1 只说明色保 alpha，用户拍板的也是"保住 alpha"；今天 chat 两半的**形态**是"明色半透明、暗色不透明"，故暗色取 `dark:bg-code-block`（不透明）——保住既有形态、最小变形。**代价**：chat 两半仍不对称（编辑器预览两半同值），这条不对称如实写进主题文档 §6.3，而没有顺手抹掉。

### 四、本片新落的测试资产

| 资产 | 内容 |
|---|---|
| `tests/theme-tokens/code-block-surface.spec.ts`（新） | **每主题一条 × 2 引擎**：真引擎读四个探针（`reference`＝`var(--editor-bg)`、`chat`＝消费者的类串、`editor`＝`hsl(var(--code-block-bg))`、`half`＝手写 50%），断言"编辑器预览**两外观**都等于编辑器页底"、"chat 暗色等于它"、"chat 明色等于它的 50% 且不等于原值"；另有一条全局测试守"这些比较不是空转"（各主题的 `--editor-bg` 不全相同）|
| `tests/theme-tokens/main.ts` | 新探针 `readCodeBlockBoards()`；`tokenNames` **未动**（`--code-block-bg` 在 `index.css` 里，`extractTokenNames` 自动收录）|
| `src/modules/chat/tests/codeBlockPanel.test.tsx`（新） | 1 测试：chat 面板的类串（`bg-code-block/50` ＋ `dark:bg-code-block`，且不再有 `bg-muted/50` / `n-zinc-900`）|
| `src/modules/code-editor/tests/codeBlockPanel.test.tsx`（新） | 2 测试：编辑器预览的 `<pre>` 在**两外观**都画 `hsl(var(--code-block-bg))` **且两外观同值**；mermaid 源码回落的类串 |
| `src/shared/tests/userThemeTokens.test.ts` | ＋2：`--code-block-bg` 收 triplet、拒 hex |
| `src/index.css` / `tailwind.config.js` | `--code-block-bg` 的 10 处声明（base ×2 ＋ 4 主题 ×2；`cc-ocean` 不写、沿继承）＋ Tailwind 的 `code-block` 色键（`hsl(var(--code-block-bg))`，故 `bg-code-block/50` 的透明度修饰符可用）|

### 五、下一片

B2（回填四套既有 `full` 主题的语法板）是下一片。两个前置与 §5.2 相同，且本片已各做了一半：**字面色护栏已实测**（7 种形状的命中表在主题文档的记账里）、**同宽来源矩阵已出**（并顺手发现"五个来源就是各自的 `--editor-bg`"）。

---

## B2 实施记录（2026-09-29）

> 开工前拍板（用户："按你推荐的"）：**读法甲 ＝ 语义逐槽**。§3.7 的"按色值分组再取语义最近的 Prism 类别"与 §3.2 的"5 个没动的槽照抄参照物 ⇒ 值不变"在 **`class-name`** 上分叉：参照物给 `#e5c07b` 黄，基色给 `#d19a66` 橙。取甲的理由是**乙没法统一应用** —— islands 的 number（青）/ constant（紫）/ class-ref（灰）本来就是三个色，逼它们同族只会得到一个错值；甲是唯一能对三套一致执行的规则，且它让"回填语法板"真的有内容。
> 范围：`cc-onedark` / `cc-catppuccin` / `cc-islands` 三套；**`cc-polar` 按 §8 决策 2 的"可选"本片不写**（§5.2 第 4 条取前者），`cc-ocean` 是 accent 主题、沿继承。

### 一、门槛（全绿）

| 项 | 读数 | 对照 |
|---|---|---|
| `npm test` | 1029 / 1008 通过 / 20 失败 / 1 跳过 | 已知抖动区（19~21）；`server/` 树 0 行 ⇒ 按纪律豁免名字集 A/B |
| `test:client` | 149 文件 / 1239 通过 | 与 B1b 逐字相同 —— 本片只动 `index.css` 与两个 playwright spec，无 `src/` TS 变更 |
| `test:theme-tokens` | **158 通过** | B1b 基线 156 ⇒ **＋2**（新测试 × 2 引擎）|
| `lint` | 153 warnings / 0 errors | 与基线相同 |
| `typecheck` ＋ `typecheck:theme-tokens` | 0 错 | `build:client` 不校验类型，故这两条必须单跑 |
| `build` | exit 0 | — |
| `token-baseline.json` | **未动** | 实测证实覆盖层声明永不进基线（见"三、1"）|
| `theme-atom-conservation.json` | **未动** | 本片不碰任何 utility 消费者 |

### 二、参照物与保真度

| 主题 | 参照物 | 保真度 |
|---|---|---|
| `cc-onedark` | 插件 jar 内 `one_dark.xml`（497 条属性，**dark-only**）| 逐属性读，一个文件一套 |
| `cc-islands` | 平台 jar 内 `themes/islands/IslandSchemeDark.xml` | 逐属性读；**该 scheme 无 `DEFAULT_CLASS_NAME`** ⇒ 取 `DEFAULT_CLASS_REFERENCE` |
| `cc-catppuccin` | **官方色板 v1.8.0**（Mocha / Latte）| ⚠️ **不是编辑器 scheme**：Codex 的 27 套主题编译进 229MB 二进制（`strings` 搜不到、包内无 `.tmTheme`）⇒ 只能取官方**角色约定**，如实记账 |

映射（甲）：comment ← `LINE_COMMENT`；punctuation ← `OPERATION_SIGN` / `BRACES`；className ← `CLASS_REFERENCE`；constant ← `CONSTANT`；number ← `NUMBER`；keyword ← `KEYWORD`；property ← `INSTANCE_FIELD`；string ← `STRING`；function ← `FUNCTION_DECLARATION`；url ← `VALID_STRING_ESCAPE`；blockForeground ← `IDENTIFIER`。

**逐套的可见变化**：`cc-onedark` **只有 `class-name` 一处**（橙 → 黄，其余 10 槽与该主题基色同值，命名只是把"继承"改成"拥有"）；`cc-islands` **11 槽全变**；`cc-catppuccin` **两外观各 11 槽全变**。两套 dark-only 参照物的**浅色半明确不动**（保持基色 Prism oneLight），按 §3.7 事实 2/3 记账。

### 三、实施期发现与改判（4 条，如实记账）

1. **§6.6 的"B2/B3 逐套递增"不成立**（已在正文改判）。`captureSnapshot` 只读光明/暗基色、**不挂 `data-theme`** ⇒ 覆盖层声明**永不进基线**。B2 的验证因此只能落在 `theme-overlays.spec.ts` 的逐主题断言上。
2. **§6.2 的"①前提 ＝ 手工追加"从 B2 起失效**（已在正文改判）。B2 把 44 条声明写进 `index.css` ⇒ `extractTokenNames` **自动收录**语法槽名；"不追加就读不到"只对 B1 那一版的树成立。
3. **"删掉声明也照样绿"是本片开工自查抓到的最大缺口，且我最初把它判错了方向。** 开工时以为风险是"`cc-onedark` 的 10/11 槽与基色同值 ⇒ 覆盖层输了也读到同值"。**实测证伪**：`readOverlay` 的 `declared` 只含**存在的**声明，删掉整块后 check 1 **连检查对象都没有** —— 这与"值是否同色"毫无关系，`cc-islands` / `cc-catppuccin` 一样漏。故新加的"own all of it, and move it"才**是**唯一会红的东西（M1–M4 各 2 红，且**只有它**红）。**判据：逐主题断言里凡"只遍历已有声明"的，都挡不住"整块被删"。**
4. **一处按甲的语义取值的必然坍缩（不是被契约拦下）**：`cc-islands` 的 `url` 取 `VALID_STRING_ESCAPE`（`#cf8e6d`）后**与 `keyword` 撞色** —— 该 scheme 没有独立的青色角色。**记账而非掩饰**。另如实记一条"没有发生"：本片**没有**第 5 次"照抄参照物被自家契约拦下" —— 语法板不在 §5.10 的配对表内，参照物自身也没有低于 AA 的语法色需要改。

### 四、变异集（6 条，逐条实测）

| # | 变异 | 红 | 说明 |
|---|---|---|---|
| M1 | 删 `cc-onedark` 的 11 条 | **2** | 新测试 × 2 引擎；per-theme / 全有或全无**都不红**（见"三、3"）|
| M2 | 删 `cc-islands` 的 11 条 | **2** | 同上 |
| M3 | 删 `cc-catppuccin` **明色半**的 11 条 | **2** | 同上（该主题明色半声明了、暗色半仍在 ⇒ 只有"整块"这条能发现）|
| M4 | `cc-islands` 的 11 条全改成基色值（板子声明了但一个槽都不动）| **2** | 证明"move it"那半句有牙 |
| M5 | 删 `--cc-syntax-` 字面色豁免 | **2** | 恰 `token-contract` 那一条 × 2 引擎 |
| M6 | `cc-islands` 的 `comment` 由 `#7a7e85` 改 `#7a7e86` | **0（绿）** | **已知边界，见下** |

**M6 是如实记账的边界**：语法板的**取值**没有被任何测试冻结。per-theme 的 check 1 只证"声明按原文解析"，删改声明会连检查对象一起消失；全有或全无只证"不缺槽"。要冻值就得把 44 个 hex 抄进测试，而本仓库对**覆盖层取值**历来不冻结（进 `token-baseline.json` 的只有**基色**）。故取值正确性由本记录的两张映射表与三份参照物的复核承担，**不由测试承担**。

### 五、本片新落的测试资产与改动面

| 资产 | 内容 |
|---|---|
| `src/index.css` | **44 条**声明（3 主题 × 11 ＋ catppuccin 的明色半另 11），每块带来源与偏离注释 |
| `tests/theme-tokens/token-contract.spec.ts` | ＋1 处豁免（`--cc-syntax-` 前缀，**实测**过 hex 确实命中护栏，非形状巧合）；测试名与 docblock 同步改为"…the editor board, the code-block panel and the syntax board" |
| `tests/theme-tokens/theme-overlays.spec.ts` | ＋1 测试 × 2 引擎：三个板主题**拥有**板、拥有**整块**板、且**至少移动一个槽**；反向断言"非板主题一个槽都不许命名"与"参照物没有明色板的主题不许在明色半声明" |

**偏离 §5.2 的"每套主题一个独立提交"**：三个块共用同一个测试文件与同一处字面色豁免，且"逐套刷基线"的理由已被实测推翻（覆盖层不进基线），故合成一个提交。

### 六、下一片（B3，开工前的表述）

**B3**（`cc-onedark-vivid`，显示名"暗夜一号·浓彩"）。§5.3 的 DoD 要求"**代码块 ＋ 终端**，且代码块**分两外观**说明"；浅色半二选一（发明并记账 / 明确写不动）。本片已把它的语法板路径打通（具名槽 ＋ 字面色豁免 ＋ 板主题守卫），剩下的是 Vivid 自己的三条轴（语法 / 终端 / 灰阶）。

**→ B3 已实施，见下节。**

---

## B3 实施记录（2026-09-29）

> 范围：第四套内置主题 `cc-onedark-vivid`／"暗夜一号·浓彩"（id 与显示名由用户 2026-09-29 定）。三条轴：**语法板 ＋ 终端板 ＋ 一处 L1 灰**——底料不动，这才是准确说法（§3.8 的订正）。
> 参照物：插件 jar 内 `one_dark_vivid.xml` ＋ `one_dark_vivid.theme.json`（与 `cc-onedark` 同一 jar、同一次解包）。

### 一、门槛（全绿）

| 项 | 读数 | 对照 |
|---|---|---|
| `npm test` | 1029 / 1008 通过 / 20 失败 / 1 跳过 | 已知抖动区；**做了名字集 A/B**（19 个 `not ok` 名字逐字节相同），`server/` 树 0 行 |
| `test:client` | 149 文件 / 1239 通过 | 与 B2 逐字相同 —— 本片只加一行注册表 ＋ `index.css` ＋ 两个 playwright spec，无 `src/` TS 逻辑变更 |
| `test:theme-tokens` | **168 通过** | B2 基线 158 ⇒ **＋10**（＝ ＋5 用例 × 2 引擎，名字集 A/B 逐条核对，见"五"）|
| `lint` | 153 warnings / 0 errors | 与基线相同 |
| `typecheck` ＋ `typecheck:theme-tokens` | 0 错 | `build:client` 不校验类型，故这两条必须单跑 |
| `build` | exit 0 | — |
| `token-baseline.json` | **未动** | 与 B2 的实测结论一致（覆盖层声明永不进基线）|
| `theme-atom-conservation.json` | **未动** | 本片不碰任何 utility 消费者 |

### 二、参照物与三条轴（逐轴取值）

**① 灰阶（一处 L1）。** `foregroundColor` #abb2bf → #bbbbbb —— One Dark 的冷蓝灰换成中性灰。它只喂 `--palette-ink-100` 一个 L1 步；`--muted-foreground` 走 `ink-400`（`BookmarkMnemonicAvailable.foreground`）**不动**。
> **两套计数不矛盾，实测已对齐**：§3.8 写"theme json 的 ui 14 项变（13 项只是 `#abb2bf`→`#bbbbbb`）"，本节按**扁平叶键**数得"**26 条变、25 条是灰、1 条是红**"。差别只是粒度：14 是 `ui.<对象>` 的个数（`*` / ComboBox / Counter / DragAndDrop / Editor / GotItTooltip / Notification / ParameterInfo / Plugins / SearchEverywhere / SpeedSearch / Table / ToolWindow / VersionControl），其中 13 个只动灰、`ui.SpeedSearch` 同时动灰与红（`errorForeground` #e06c75 → #ef596f）。另有 `colors.foregroundColor` 与 `icons.ColorPalette.Checkbox.Foreground.Selected.Dark` 两条也在灰里。

**② 终端（外观无关）。** 源 `<attributes>` 的 21 条 `CONSOLE_*_OUTPUT` 中 **12 条变**：`RED`/`RED_BRIGHT`/`ERROR`、`GREEN`/`GREEN_BRIGHT`/`USER_INPUT`、`MAGENTA`/`MAGENTA_BRIGHT`、`CYAN`/`CYAN_BRIGHT`、`WHITE`/`NORMAL`（各三折冗余：一 normal、一 bright、一义名共用一色）。black / blue（含 bright）/ yellow（含 bright）三族未动。
**折算口径**：源用 `FONT_TYPE: 1` 而非颜色区分 normal 与 bright，故沿用 `cc-onedark` 记录的派生规则（保 H、S，L + 9）⇒ **红/绿/品红/青各动 normal ＋ bright ＝ 8 槽，白只动 normal 半 ＝ 1 槽，共 9 槽**；`--palette-term-fg` 另动一个令牌。**§3.7 那个"9～10 槽"至此定为 9** —— 白的 bright 伙伴读 `selectionForeground`（#d7dae0），而 variant 没动它。这正是本片新增的终端断言所钉住的数。

**③ 语法板（只暗色半）。** 11 槽里 **6 移动、5 不动**：`punctuation` #abb2bf→#bbbbbb、`keyword` #c678dd→#d55fde、`property` #e06c75→#ef596f、`string` #98c379→#89ca78、`url` #56b6c2→#2bbac5、`block-foreground` #abb2bf→#bbbbbb；`comment`、`class-name`（黄）、`constant`、`number`（橙）、`function`（蓝）五槽与 `cc-onedark` 同值。映射沿用 B2 拍板的**甲（语义逐槽）**与同一张表：punctuation ← `OPERATION_SIGN`/`BRACES`（该 scheme 未设 ⇒ 回落全局前景 = `IDENTIFIER` = #bbbbbb）。

### 三、实施期发现（4 条）

1. **浅色半的取舍（§5.3 明列二选一，本片选"不动"）。** 判据是**没有可迁移的规则**：variant 的加饱和是**按色手调**（ΔS 从 ±5.5 到 +17.2 不等、ΔH −4 到 +13、ΔL −7.8 到 +2.4），所以"把暗色板的变换搬到浅色板"这件事**不存在**——那不是派生而是凭空发明，与 2-P 发明浅色外壳时手里有"保色相饱和、重解明度"这条可执行规则的情形不同。**后果如实记**：浅色外观下代码块 / 编辑器 / 底料**逐字节等于 `cc-onedark`**（终端板外观无关，两外观都动）。这也与主题名自洽——它叫"暗夜一号"。
   > 顺带：这条约定**已有守卫表达**，不是我拍的：`theme-overlays.spec.ts` 的 `BOARD_IN_BOTH_APPEARANCES` 只放 `cc-catppuccin`，"参照物只出暗色板"的主题在明色半声明语法槽即报红（M5/M7 实测）。
2. **复制出来的覆盖层有一条既有契约看不见的缝：它可以"只漂一点"。** `cc-onedark-vivid` 的三块是**有意复制** `cc-onedark` 的（插件四份文件共享核心色板），而**覆盖层契约只把主题与基色比**——复制时漂了一个值，它照样"按原文解析"、照样在 `full` 的触达范围内。B2 那条"拥有整块板"的守卫也看不见（它只管语法板、且不比对姊妹）。故新增一条断言：**两个主题的差异恰为记录的那一组**（`VIVID_SUBSTRATE_MOVES` ＋ 暗色半的 `VIVID_DARK_SYNTAX_MOVES`），三个方向都报错（只在一侧声明 / 不该动的动了 / 该动的没动）。**判据：凡是"复制"而非"派生"的资产，都要有一句"它该与源差在何处"的断言，否则复制品与源的关系无人守。**
3. **§6.3 要求的"两外观各一份 ＋ 终端一份"在实施时才能精确到"哪些渲染令牌真的动了"**，故收口前用一次性探针实测了一遍（探针跑完即删）：**暗色外观动 17 个渲染令牌**（`--foreground` ＋ 四个 `--editor-*-fg` 共 5，终端 10，义名 `--term-error` / `--term-success` 2）；**浅色外观只动 12 个**（终端 10 ＋ 两个义名），因为 L1 的灰只在暗色被消费。**注意 `rendered` 里没有 `--cc-syntax-*`**——语法板走另一条注入通道（`<style id="cc-syntax-theme">`），所以"代码块那 6 槽"不在这份名单里，两份清单要合起来读。
4. **`--palette-ink-100` / `--palette-term-fg` / `--palette-term-white` 三者在 variant 里同值（`0 0% 73.33%`）不是笔误**：源里 `foregroundColor`、`CONSOLE_NORMAL_OUTPUT`/`WHITE_OUTPUT` 本来就同值，`cc-onedark` 里三者也是同一个三元组的重复写法。本片沿用同一写法、不为"去重"引入间接。

### 四、变异集（8 条，逐条实测，全部 RED）

| # | 变异 | 红 | 抓它的测试 |
|---|---|---|---|
| M1 | 从 `SYNTAX_BOARD_THEMES` 去掉 `cc-onedark-vivid` | **2** | 板主题守卫（× 2 引擎）|
| M2 | 删掉 variant 的 11 条语法声明 | **4** | 板主题守卫 ＋ 姊妹差（各 × 2 引擎）|
| M3 | `--palette-term-cyan` 退回姊妹的值 | **4** | 姊妹差（`theme-overlays`）＋ 终端姊妹差（`terminal-tokens`）|
| M4 | 动 `--palette-term-yellow`（**不在**预期移动集里）| **4** | 同上两条 |
| M5 | 给 variant 的**明色半**加一条语法声明 | **6** | all-or-nothing ＋ 板主题守卫 ＋ 姊妹差（各 × 2 引擎）|
| M6 | `--palette-ink-100` 退回姊妹的值 | **2** | 姊妹差 |
| M7 | 把 `cc-onedark-vivid` 列进 `BOARD_IN_BOTH_APPEARANCES` | **2** | 板主题守卫（明色半无板）|
| M8 | 注册表 `coverage` 改 `accent` | **2** | 逐主题触达断言（`cc-onedark-vivid (accent) …`）|

M3 / M4 是**成对**的：M3 证明"该动的没动"会红，M4 证明"不该动的动了"也红——少了任一条，姊妹差断言只守一半。每条都先确认真的改了值（不与姊妹同值），全部还原后逐字节比对（见"五"）。

### 五、测试资产与改动面

| 资产 | 内容 |
|---|---|
| `src/shared/constants.ts` | 注册表 ＋1 行（`appearance: 'system'` / `source: 'builtin'` / `coverage: 'full'`）|
| `src/index.css` | variant 三块（L1 ＋ 明色半 ＋ 暗色半），每块带来源与偏离注释；块头注释含"底板不动 ＋ 语法 ＋ 终端 ＋ 灰阶三条轴"与"为什么不去发明浅色板" |
| `tests/theme-tokens/theme-overlays.spec.ts` | `SYNTAX_BOARD_THEMES` ＋1；＋1 测试（姊妹差，三个方向）|
| `tests/theme-tokens/terminal-tokens.spec.ts` | ＋1 测试（终端板相对姊妹恰动 9 槽 ＋ foreground）|

`test:theme-tokens` 的 **＋10 与 ＋5 用例逐条对齐**（名字集 A/B）：注册表驱动自动新增 3 条（`code-block-surface` / `contrast` / `theme-overlays` 的逐主题触达，**零改测试**）＋ 本片手写 2 条。

**提交方式**：与 B1 / B1b / B2 一致——代码一个 `feat(theme):`、两文档一个 `docs(theme):`。

**"真实 xterm 读画出的 ANSI 色"这句 DoD 措辞要收窄**：本仓库没有"读 xterm 画出的像素"的通道，终端的消费者守卫是**两层**——`terminal-tokens.spec.ts` 读 `readTerminalTheme()`（喂给 xterm 的那个 `ITheme` 对象本身），`src/modules/shell/tests/shellTerminalThemeRefresh.test.tsx` 读 `terminal.options.theme`（它确实被推到终端上）。本片按既有范式落在第一层，并把第二层由既有测试覆盖。**这不是能力缺口，是这套仓库的取证分工**，如实记以免下一片去找不存在的通道。

### 六、§6.3 记账（按要求的形状：两外观各一份 ＋ 终端一份）

1. **代码块 · 暗色半 —— 6/11 槽移动**：`punctuation` / `keyword` / `property` / `string` / `url` / `block-foreground`（值见"二、③"）。另 5 槽与 `cc-onedark` 同值（派生所致，非漏做）。
2. **代码块 · 浅色半 —— 本片不动**：保持基色 `prism-oneLight`。参照物只出暗色板；**逐条落实在 `BOARD_IN_BOTH_APPEARANCES` 上**（明色半声明语法槽会被守卫拒绝）。后果：浅色外观下代码块 / 编辑器 / 底料与 `cc-onedark` 逐字节相同。
3. **终端 —— 9 槽 ＋ foreground**（外观无关，故不分明暗）：`red` / `green` / `magenta` / `cyan` / `white` / `bright-red` / `bright-green` / `bright-magenta` / `bright-cyan` 与 `--term-foreground`（⇒ `--term-ansi-*` 十个 ＋ `--term-foreground`，义名 `--term-error` / `--term-success` 随红绿跟动）。折算口径见"二、②"。
4. **灰阶 —— 一处 L1**：`--palette-ink-100`，暗色外观下连带 `--foreground` 与四个 `--editor-*-fg`（渲染名单见"三、3"）；`--muted-foreground`（`ink-400`）不动。
5. **一处"没有发生"也要记**：本片**没有**第 5 次"照抄参照物被自家契约拦下"——variant 的语法板不在 §5.10 的配对表内，终端板也不在，参照物自身没有低于 AA 需要改的色（`contrast.spec.ts` 对 `cc-onedark-vivid` 的自动新增用例是绿的）。

---

## 附录 A（B3 增补）

`SYNTAX_BOARD_THEMES` 由三条变四条（`cc-onedark-vivid` 加入）；`BOARD_IN_BOTH_APPEARANCES` **不变**（仅 `cc-catppuccin`）。新增两条断言与两个常量集：`VIVID_SUBSTRATE_MOVES`（11 项）＋ `VIVID_DARK_SYNTAX_MOVES`（6 项），以及 `terminal-tokens.spec.ts` 里那张期望的移动键名单（10 项）。**这两组名单就是"姊妹差恰为记录的那一组"这条断言的全部内容**，改动它们等于改动该片承诺。

> **B4 后记（2026-09-30）**：`BOARD_IN_BOTH_APPEARANCES` 当日由 1 项扩为 4 项后，**连同它的 `expectsABoard` 分支一起被删除**——四套板主题在两个外观都有板之后，"只声明暗色半"不再是一个存在的形态，留一个恒真分支只会让下一位读者以为还有例外。现在的守卫读作"**拥有板 ⇒ 两个外观各 11/11，且至少移动一槽**"。见文末 B4 实施记录。

---

## B4 实施记录（2026-09-30）

> 范围：**补三套内置 `full` 主题的浅色语法半** —— `cc-islands` / `cc-onedark` / `cc-onedark-vivid` 各 11 槽。B2 / B3 只落了暗色半（当时按"参照物没有浅色板"记，见 §3.7 订正），B4 把三处的官方浅色来源查明并落盘。
> 触发：2026-09-30 用户追问"其他主题的代码块配色跟主题了吗"，并要求"没有完善就查来源、按来源做一次兼容调整"。
> 面：**只动 `src/index.css` 与一个 spec**；不动注册表、不动 `src/` 逻辑、不动终端面、不动底板。

### 一、来源与逐槽取值（三套 × 11 槽）

来源见 §3.7 订正表。取值如下（来源键名照参照物原文）：

**`cc-islands` 浅色 —— 平台 `themes/Light.xml`**

| 槽 | 值 | 来源键 |
|---|---|---|
| comment | `#8c8c8c` | `DEFAULT_LINE_COMMENT` |
| punctuation | `#080808` | `DEFAULT_IDENTIFIER`（light scheme 未声明 ⇒ 回落 `TEXT`）|
| class-name | `#080808` | `DEFAULT_CLASS_REFERENCE`（同上）|
| constant | `#871094` | `DEFAULT_CONSTANT` |
| number | `#1750eb` | `DEFAULT_NUMBER` |
| keyword | `#0033b3` | `DEFAULT_KEYWORD` |
| property | `#871094` | `DEFAULT_INSTANCE_FIELD` |
| string | `#067d17` | `DEFAULT_STRING` |
| function | `#00627a` | `DEFAULT_FUNCTION_DECLARATION` |
| url | `#0037a6` | `DEFAULT_VALID_STRING_ESCAPE`（该 scheme 无独立青色角色）|
| block-foreground | `#080808` | `TEXT` |

**`cc-onedark` 浅色 —— Atom One Light**

变量：`mono-1` `#383a42`、`mono-3` `#a0a1a7`、`hue-1` `#0184bc`、`hue-2` `#4078f2`、`hue-3` `#a626a4`、`hue-4` `#50a14f`、`hue-5` `#e45649`、`hue-6` `#986801`、`hue-6-2` `#c18401`。映射沿用暗色半的 hue 角色：`comment`←mono-3、`punctuation` / `block-foreground`←mono-1、`class-name`←hue-6-2、`constant` / `number`←hue-6、`keyword`←hue-3、`property`←hue-5、`string`←hue-4、`function`←hue-2、`url`←hue-1。

**`cc-onedark-vivid` 浅色** —— 与 `cc-onedark` **逐槽同值**（恒等派生；理由与那五个 hex 的清单见 §3.7 订正表）。

### 二、与基色板的差异（"声明即拥有"必须看得见）

判据是"该槽是否偏离基色 `prism-oneLight`"：

| 主题 | 移动 | 说明 |
|---|---|---|
| `cc-islands` | **11/11** | 与平台 Light 板逐槽不同，无一同值 |
| `cc-onedark` | **3/11** | 只 `class-name` / `constant` / `number` —— 基色把这三槽并成一个橙黄，One Light 官方是拆开的；其余 8 槽与基色**同值**，命名的意义是"主题拥有自己的板"而非"值变了" |
| `cc-onedark-vivid` | **3/11** | 同上（且同值于 sibling）|

> 这条正是两条守卫的交点：all-or-nothing 要求 11/11，板主题守卫要求"至少移动一槽"。三套各有真实移动点（最少的也有 3 个），所以两条都过；**若某套浅色半整槽照抄基色，后者会报红**。

### 三、对比度读数（如实记，不凑 AA）

底色取各主题浅色的 `--code-block-bg`（`sand-50`：islands `#E9EAEE`、onedark/vivid `#F3F4F6`）。**语法槽不在 `CONTRAST_PAIRS` 里**（§3.4 的有意取舍），且既有标准是"照参照物原值平移"（`cc-islands` 暗色 `comment` 4.27:1、`cc-onedark` 暗色 `comment` 2.32:1 都这么留着），故这里只记账、不改值：

- **`cc-islands` 浅色**：低于 4.5:1 的是 `comment` 2.80:1、`string` 4.42:1；其余 9 槽 5.16–16.66:1。
- **`cc-onedark` / `cc-onedark-vivid` 浅色**：8 槽低于 4.5:1 —— `comment` 2.34、`class-name` 2.91、`string` 2.91、`property` 3.33、`function` 3.68、`url` 3.80、`constant` / `number` 4.42。**其中 5 槽在基色板上本来就是同一个值**（One Light 与 `prism-oneLight` 同源），所以不是本片引进的缺陷；余下 3 槽（橙黄那组）是把官方拆开的两个色，值本身来自 One Light。

### 四、门槛（全绿）

| 项 | 读数 |
|---|---|
| `test:theme-tokens` · chromium | **87 通过 / 0 失败** |
| `test:theme-tokens` · webkit | **87 通过 / 0 失败** |
| `token-baseline.json` | **未动**（覆盖层声明永不进基线，与 B2 / B3 结论一致）|
| 落盘值静态核对 | 3 主题 × 11 槽 = **33 / 33 与来源表逐字节相同**（脚本按选择器解析 `src/index.css`，非人工比对）|

### 五、变异集（2 条，逐条实测）

| # | 变异 | 结果 | 抓它的测试 |
|---|---|---|---|
| M1 | `cc-onedark-vivid` 浅色 `block-foreground` 由 `#383a42` 改 `#383a43` | **RED** | 姊妹差断言（浅色期望集为空 ⇒ 与 sibling 的任何漂移都报 "moved off its sibling"）|
| M2 | 删掉 `cc-islands` 浅色的 11 槽块 | **RED**，报文 `cc-islands in light: names 0 of 11 syntax slots` | 板主题守卫（**扩 `BOARD_IN_BOTH_APPEARANCES` 之后才可能报红**）|

M2 的报文顺带证明了一件事：**扩表之前，整段删掉浅色板是不报错的**——旧守卫把浅色半整段跳过（这正是 §3.7 事实 2 所依赖的形态）。两条变异均已还原，还原后复跑 87 / 87。

### 六、§6.3 记账（B4 增量）

1. **代码块 · 浅色半 —— 三套各 11 槽落盘**（值见"一"）：本片的主变更。
2. **代码块 · 暗色半 / 终端 / 底板 / 编辑器 / 图道 —— 未动。**
3. **一处必须点明的同值**：`cc-onedark` / `cc-onedark-vivid` 浅色有 8 槽与基色同值（见"二"）——不是漏抄，是 One Light 与 `prism-oneLight` 同源；命名它们的目的是**拥有**板而不是继承。
4. **一处"没有发生"也要记**：本片**没有**第 5 次"照抄参照物被自家契约拦下"——三套浅色板不在 §5.10 的配对表内（该表只含语义令牌），`contrast.spec.ts` 未被触发。

### 七、改动面

| 文件 | 改动 |
|---|---|
| `src/index.css` | 三个 `:not(.dark)` 块各 ＋11 槽 ＋ 来源注释；`cc-onedark-vivid` 的块头注释由"浅色半不动"改写为恒等派生的理由；`cc-onedark` / `cc-onedark-vivid` 两处暗色语法注释的末句同步改写 |
| `tests/theme-tokens/theme-overlays.spec.ts` | `BOARD_IN_BOTH_APPEARANCES` 扩为四主题后连同其分支删除；三处段落注释改写（块头、"拥有板"、姊妹差）|

**提交方式**：与 B1–B3 一致 —— 代码一个 `feat(theme):`、文档一个 `docs(theme):`。


