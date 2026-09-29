# CloudCLI 用户主题补齐语法板与代码块底方案

> 状态：**已实施完毕（S1–S4 ＋ S6 全部完成；S5 未触发）**——决策 7 裁"加窄守卫 spec"、决策 8 裁"(ii) 接受 ＋ 记账"（见文末「定稿裁定」）；**S1 已跑完（5/5 通过）、S2 对照表已产出（§10）、S3 已落盘（四文件 × 24 条，24 项校验全绿）、S4 真机复验已通过（8 组 × 11 槽 ＋ 底板 ＋ 非令牌元素 ＋ 真实 chat 截图，双引擎全绿）、S6 守卫 spec 已落地（新 spec 6/6 通过，theme-tokens 全套 174 passed）**——五份执行记录见文末。四套主题文件现为 **71 条声明**（既有 47 条 L1 一字未动 ＋ 新增 24 条）。
> 范围：`~/.cloudcli/themes/` 下四套用户主题（`user-dracula` / `user-gruvbox` / `user-tokyo-night` / `user-kanagawa`）**补齐 `--cc-syntax-*` 语法板与 `--code-block-bg`**，并讨论要不要一并接管聊天区 markdown 正文色。
> 与本文相关的姊妹篇：`docs/research/CloudCLI内置主题语法调色板接管方案.md`（下称"语法接管方案"，通道 A，已实施）。**本文是通道 B 侧的一次对称补齐**，机制完全复用它已落地的成果，不新增任何机制。
> 编写日期：2026-09-29；**修订日期：2026-09-29（一审后、二审后、S3 落盘勘误、S4 复验、S6 落地各一次）**。文中行号对应当前 `HEAD`；所有"实测"结论均由真 chromium 探针产出，不是读代码推断。

---

## 0. 结论先行

1. **问题是真的，但归因要对**。四套主题的**代码块语法色与容器底色今天不跟主题**——实测：换成 `user-dracula` 后 `--cc-syntax-keyword-color` 仍是 `hsl(286, 60%, 67%)`（Prism `oneDark` 的紫），代码块底仍是 `rgb(40, 44, 52)`。而内置主题 `cc-catppuccin` 在同条件下**是跟的**（keyword `rgb(203, 166, 247)`、底 `rgb(30, 30, 46)`）。**这不是机制做不到，是我们漏写了两族声明。**

2. **而"聊天区正文颜色不跟主题"是另一件事，且不是我们的锅。** 实测四组对照：默认、`cc-catppuccin`、`user-dracula` 三种状态下，markdown 段落色**逐字节相同**（`rgb(209, 213, 219)`）。根因是 `prose prose-gray dark:prose-invert` 走 Tailwind Typography 的 `--tw-prose-*`，构建产物里就是写死的 `#d1d5db`，全项目零覆写。**连内置主题都不跟**，属项目既有基线，不是本方案引入的缺陷。

3. **本方案要做的事只有一件半**：给四套主题各补 **11 个语法槽 × 2 个外观**，加 **`--code-block-bg` × 2 个外观**。零新机制、零新增令牌、零改源码——`--cc-syntax-*` 与 `--code-block-bg` 都是既有契约面，用户 `.css` 主题原样注入，写进去就生效（§1.3 有机制证明，§3 有真机验证）。

4. **一处与内置主题的关键处境差异（对我们有利）**：语法接管方案的 §3.7 记载，内置主题的语法板**只有暗色来源**——One Dark / Islands 的参照物都没有浅色版，只有 catppuccin 是双套。而**我们这四个配色全部有官方浅色板**：Dracula 有 `Alucard`、Gruvbox 有 `light`、Kanagawa 有 `lotus`，Tokyo Night 有官方 VSCode 浅色主题（其 nvim 侧 `day` 是程序化反转，本文不用它作语法板来源，见 §4）。所以"浅色半写什么"这个困扰内置主题的问题，我们这边不存在。

5. **prose（正文排版色）单列为决策项**，见 §3.5 与 §8 决策 2。它技术上可做（已实测），但**会让我们比内置主题"更深"**：内置主题一律不动 prose，我们动了就等于自己接手这套对比度保证，且 `--tw-prose-*` 不在官方契约面里。**我的建议是不做**，把已知边界如实记账。

6. **一处必须记账的诚实性边界**：语法板的 11 个槽是**按色值/语义近邻映射**的，不是逐条等价。四套里有**两套的浅色语法板需要平移**——Dracula 的 `Alucard` 只有 UI 色板、Kanagawa 的官方 tmTheme 只有 wave（`lotus` 需按色板平移）。这与语法接管方案 §3.7 记的"映射是按颜色而非按语义做的"是同一笔账，本文只是把它落到四个具体配色上（§4）。

7. **改动面**：**4 个主题文件**（`cloudcli/.cloudcli/themes/{dracula,gruvbox,tokyo-night,kanagawa}.css`），每个从 47 条声明增到 **71 条**（+12 × 2 外观 = +24 条）；**外加 cloudcli 仓库 `tests/theme-tokens/` 下 1 个机制守卫 spec**（决策 7 已裁"加"，内容见 §5 S6）。主题改动落在 dotfiles 仓库，spec 落在 cloudcli 仓库（§6.4 措辞已相应放宽）。**同目录下第五套 `console.css` 有意不动**（§2.2 点名）——它是带选择器的自由式主题，与这四套不同族。

   关于守卫，准确的说法不是"通道 B 一个守卫都没有"，而是**现有守卫读不到这四个文件**：`tests/theme-tokens/` 里已有通道 B 的真引擎 harness（`user-theme-style.spec.ts` 经 `applyUserTheme({id, css})` 注入任意 `.css` 正文并读回渲染色）。它守住的是**机制**（写法是否生效），守不住**取值**（dotfiles 里那四个文件里的具体色值）。决策 7 新增的窄 spec 同样只守机制（形状契约 ＋ 外观块顺序），因此"以真机读数为准"（G5）这个结论继续成立。

8. **一处最安静的错误必须先钉死：`--code-block-bg` 不能写 `hsl()`。** 它与 11 个语法槽**不同类**——语法槽是完整颜色值（消费端原样内联 `var(--cc-syntax-*)`），而 `--code-block-bg` 是 **L2 语义令牌、消费端写 `hsl(var(--code-block-bg))`**（构建产物原文：`.bg-code-block\/50{background-color:hsl(var(--code-block-bg) / .5)}`）。写成 `hsl(...)` 会变成 `hsl(hsl(...) / .5)` → 声明在计算值阶段失效 → 代码块底板**在聊天与编辑器预览双双消失**，且**没有任何一层会报错**。**二审判定的处置是：落盘直接用引用形态 `var(--palette-sand-50)` / `var(--palette-ink-950)`（与内置主题逐字同形），让这个错误在结构上不可能发生**——详见 §3.2、§3.4 第三类形状与 §5 的 S1(a)。

9. **一处必须如实记账的不变量偏离（二审发现的实质缺口）**：`--code-block-bg` 的设计不变量是"代码块坐落在该外观的**编辑器页**上"，而基色的 `--editor-bg` **不跟主题走**（浅色纯白、深色字面值 `#282c34`），四套主题又都不写 `--editor-*`。于是把底板指向主题色之后，**块与编辑器页分家了**——深色下 Tokyo Night `#1a1b26` / Kanagawa `#1f1f28` 对 `#282c34` 幅度明显（Dracula / Gruvbox 只差 2～4 个 RGB 级，看不出来），浅色下块是主题色温而页仍是纯白。**已裁定 (ii)：有意接受 ＋ 记账**（用户拍板），理由与备选见 §8 决策 8、记账见 §6.3 第 4 条；`--editor-*` 其实可达（`console.css` 已写 27 条，见 §9 勘误），所以这是"要不要做"而非"做不到"。

10. **落盘写 hex，不写 `hsl()`**（S3 落盘时的勘误）。本文初稿把语法槽定为"统一 `hsl()`"，依据是"与 `index.css` 里内置主题的多数写法一致"——实施时逐条核对：**内置主题那 55 条 `--cc-syntax-*` 全部是 hex，一条 `hsl()` 都没有**，依据不成立，写 `hsl()` 反成唯一偏离先例的写法。落盘改为 hex：与先例逐字同形、零换算损耗、升格通道 A 时零改动。**连带把 §7 风险 10（hex → hsl 有损）从"记账接受"改为"已消除"**。详见 §3.4 与 §8 决策 4。

11. **S4 真机复验的结论：落盘值逐格兑现，无一处偏差**（2026-09-29）。四套 × 两外观 × 11 槽的**渲染值**与 §10 期望**全等**（88/88）；`--code-block-bg` 的计算值等于 `var()` 引用的那个 L1 令牌本身；代码块底与页面底在两个外观下**恰好相等**（这正好把 §6.2 "浅色半必须用混色值"那条口径的前提钉成机检）；真实 chat 里的容器边框、语言标签、复制按钮、代码前景色**都跟着主题走了**（"已复制"态是唯一例外，按构造不跟，实则未失配）；编辑器页仍停在 `#282c34`，即 §6.3 第 4 条记账的"块 ≠ 页"**在真机上如实成立**。读数清单不是手抄的——用 §6.1 第 1 条的取样器从**渲染产物反推**，反推出的 11 个槽与 `SYNTAX_SELECTORS` 逐个对上（该取样器当场喊过一次缺：`url` 只在 `[text](href)` 这类形态上出现）。**顺带踩到并记下一个读数陷阱**：过渡进行中 `getComputedStyle` 返回插值，见 §6.1 第 4 条与 §7 风险 13。

12. **S6 把 S1 的一次性读数换成了常驻断言**（2026-09-29）。新增 `tests/theme-tokens/user-theme-shape-contract.spec.ts`（3 个 test、6/6 通过、双引擎），把 §0.8 那条"最安静的错误"从"验过一次"变成"每次都拦"：两种合法形态（裸三元组 / `var()` 引用）解出同一块板、`hsl()` 形态下三路读数全变透明且无任何告警、外观块顺序不影响结果。**它只守机制、不读 dotfiles**（把四套主题全删了它照样绿），所以 S4 的逐槽读数**仍是取值层的唯一证据**，两者不可互替。三条断言都配了对照，避免在真空里通过；另做了变异检验（把令牌名写错 ⇒ test 1 当场失败）。**§7 风险 1 / 8 的"用后即弃"缺口就此关闭。**

---

**本文的证据强度声明（避免读者高估）**：§1.2 的三张对照表全部是真 chromium 探针产出，可复现。§3.6 的那次验证**只覆盖了 2 个语法槽（`keyword` / `string`）与 prose 三项**，不是全 11 槽——它证明的是**写法可行**，不是"四套主题 × 两外观 × 13 项都已验过"。后者的真机读数属实施阶段（§6.1）。

---

## 1. 现状排查

### 1.1 已有资产（全部可复用，本方案不新增）

| 资产 | 位置 | 说明 |
|---|---|---|
| 语法槽的语义名 | `src/shared/syntaxTheme.ts:87-102` `SYNTAX_SELECTORS` | **11 个稳定名**：`comment` / `punctuation` / `class-name` / `constant` / `number` / `keyword` / `property` / `string` / `function` / `url`（均带 `-color` 后缀）＋ `block-foreground`（无后缀）。由语法接管方案 B1 升名，编号槽不在此列 |
| 语法基色表注入 | `src/shared/syntaxTheme.ts:231-238` `ensureSyntaxStyleElement()` | 插在 `<head>` **最前**（`:236` 的 `insertBefore(el, head.firstChild)`），注释 `:208-229` 写明理由是"免得覆盖层的 `--cc-syntax-*` 被它静静压掉" |
| 顺序的真引擎证明 | `tests/theme-tokens/user-theme-tmtheme.spec.ts:98-131` | 已证明"用户主题压过基色表，且基色表晚注入也夺不回来" |
| 容器底色令牌 | `src/index.css:216-217`（基色 `var(--palette-white)`）／`:467`（`.dark` → `220 13% 18%`） | 语法接管方案 B1b 新增的 L2 令牌；内置主题用法见 `:1810` / `:1852` |
| 容器底色的消费者（**3 处**，不是 1 处） | chat：`src/modules/chat/transcript/Markdown.tsx:134` `bg-code-block/50 … dark:bg-code-block`；编辑器预览：`src/modules/code-editor/markdown/MarkdownCodeBlock.tsx:75` `background: 'hsl(var(--code-block-bg))'`、`src/modules/code-editor/markdown/MermaidDiagram.tsx:70` 同一对类名 | B1b 已把 chat 的 `bg-muted/50` / `dark:bg-n-zinc-900` 统一到它。**三处的透明度处置本就不同**（chat 浅色 = 令牌的 50%，chat 深色与编辑器预览均不透明），`tests/theme-tokens/code-block-surface.spec.ts:12-27` 把这条"有意不对称"写明了——所以浅色下的可见变更幅度在这几处不一样 |
| 通道 B 的既有真引擎 harness（**e2e 半**） | `tests/theme-tokens/user-theme-style.spec.ts:36-50`（经 `main.ts:662-690` 的 `applyUserTheme({id, css})`，`main.ts:667` 的 `format` 默认 `'css'`）；探针 `main.ts:316-326` `readSyntaxToken()` / `readCodeBlockBoards()` / `readWithTheme().rendered` | **它是通道 B 的守卫，只是读不到 dotfiles 里那四个文件**——这是 §2.2 与 §6 口径的依据，别再说"一个守卫都没有" |
| 通道 B 的既有真引擎 harness（**jsdom 半**） | `src/modules/chat/tests/markdownSyntaxThemeInjection.test.tsx`（`:36` 的 `referencedVariables()` 是"哪些槽被真的引用了"的取样器，见 §6.1 第 1 条）／`src/modules/code-editor/tests/markdownCodeBlockSyntaxTheme.test.tsx` | 这两个钉住的是**机制**（基色表在 `<head>` 最前、元素唯一性、语法槽被引用），同样读不到那四个文件的取值 |
| 用户 CSS 主题的闸门 | `server/modules/themes/services/theme-files.service.ts` | 只查文件名 / 大小 / `@import` / 符号链接逃逸；**不查令牌名** |
| 用户主题（`.css`）注入路径 | `src/shared/userThemeStyles.ts` | **原样注入**，不经过 `userThemeTokens.ts` 的白名单 |
| 白名单已含语法族 | `src/shared/userThemeTokens.ts` `FAMILY_RULES` 的 `/^--cc-syntax-[a-z][a-z0-9-]*$/` | 所以**即使将来把这四套升格为 `.json` 主题也走得通**；本文走 `.css`，不受此限 |

### 1.2 缺口（实测，不是推断）

**缺口 1：语法板没写，代码块语法色停在 Prism 基色。**

| 状态 | `--cc-syntax-keyword-color` | 渲染出的 keyword 色 |
|---|---|---|
| 默认（无主题）· 深色 | `hsl(286, 60%, 67%)` | `rgb(198, 120, 221)` |
| `cc-catppuccin` · 深色 | `#cba6f7` | `rgb(203, 166, 247)` |
| **`user-dracula` · 深色** | **`hsl(286, 60%, 67%)`（未跟）** | **`rgb(198, 120, 221)`（未跟）** |

即：内置主题会重染 11 个语法槽（`src/index.css:1886-1896` 起，各主题明暗各一套），**我们的四套一条都没写**。后果是代码块的紫/绿 token 与主题本身不搭——对 Dracula 尤其刺眼（Dracula 的紫是 `#bd93f9`、粉是 `#ff79c6`，而屏幕上是 One Dark 的紫）。

**缺口 2：容器底色没写，代码块底板停在基色。**

| 状态 | `--code-block-bg` · 深色 | 渲染底 |
|---|---|---|
| 默认 | `220 13% 18%`（`src/index.css:467` 的字面值） | `rgb(40, 44, 52)` |
| `cc-catppuccin` | `240 21.05% 14.9%`（=`--palette-ink-950`） | `rgb(30, 30, 46)` |
| **`user-dracula`** | **`220 13% 18%`（未跟）** | **`rgb(40, 44, 52)`（未跟）** |

深色下这两者恰好都接近 Dracula 的底色（`rgb(40, 42, 54)` vs `rgb(40, 44, 52)`），**肉眼几乎看不出，会让这个问题被误判为"已经好了"**。浅色下则明显：基色是纯白 `0 0% 100%`，而 Dracula 的浅色底应是米黄 `48 100% 96.08%`。

**缺口 3（反向）：归属澄清——聊天正文色不跟主题，且这不是缺口。**

同一段 markdown 在三种状态下的实测：

| 元素 | 默认 · 深色 | `cc-catppuccin` · 深色 | `user-dracula` · 深色 |
|---|---|---|---|
| 正文段落 | `rgb(209, 213, 219)` | `rgb(209, 213, 219)` | `rgb(209, 213, 219)` |
| 标题 h2 | `rgb(255, 255, 255)` | 同左 | 同左 |
| 加粗 | 同左 | 同左 | 同左 |
| 链接 | `rgb(96, 165, 250)` | 同左 | 同左 |
| **行内 code** | `rgb(239, 238, 236)` | `rgb(205, 214, 244)` | `rgb(248, 248, 242)` |

**结论**：走 L2 语义令牌的行内代码**跟了**；走 Tailwind Typography 的正文/标题/加粗，以及硬编码的 Tailwind 链接色，**三者一律没跟，内置主题也不例外**。证据是构建产物里的 `--tw-prose-body: #374151`（明）／`#d1d5db`（暗）／`--tw-prose-headings: #fff` 全是字面值，而 `src/index.css` 里 `tw-prose` 的出现次数为 **0**。

### 1.3 一个反直觉的前提：为什么"写进去就生效"，不需要任何新机制

和语法接管方案 §1.3 同因，但两侧的可达面不同：

```
语法基色表（JS 注入 <style>）   :root{…} .dark{…}       ← 在 <head> 最前
内置覆盖层（index.css）          [data-theme="cc-x"]{…}   ← 同权重、文档顺序在后 ⇒ 赢
用户 CSS 主题（追加 <style>）    :root:not(.dark){…}      ← 在 <head> 末尾 ⇒ 也赢
```

用户主题胜出的机制是**文档顺序**（同为作者样式、特异性亦不低），已被 `user-theme-tmtheme.spec.ts` 在真引擎证明。**本方案额外做了一次针对性的真机验证**（§3.6），确认连同 `:root:not(.dark)` / `.dark` 分块写法一起有效。

---

## 2. 设计目标与非目标

### 2.1 目标

- **G1 代码块跟主题**：四套主题在**两种外观**下，11 个语法槽与 `--code-block-bg` 都指向各自的参照配色，且压过 Prism 基色表。
- **G2 与内置主题同口径**：槽名、明暗分块形状、值的取法，与 `src/index.css` 里内置主题的写法一致——将来若这四套升格为通道 A，值是直接可搬的。
- **G3 全有或全无**：每套主题的每个外观，11 槽全写（我们的四个参照物都有双板，没有"参照物没值"的豁免理由）。
- **G4 零副作用**：四套主题的既有 47 条 L1 声明**一个不动**；不碰几何 / 材质 / 字体 / 选择器。
- **G5 实测交付**：以真机读数为准，不以"我写了"为准（现有守卫读不到这四个文件，§1.1 末行、§6）。

### 2.2 非目标（明确不做）

- **不动 prose**（除非 §8 决策 2 判"做"）：见 §3.5。
- **不动硬编码的 Tailwind 调色板原子**：链接 `text-blue-600`、工具面板 `text-red-500` / `bg-blue-500` / `bg-purple-500`、代码块"已复制"态的 `text-green-600` 等。理由是**它们按构造就在扫描范围之外**——`src/shared/tests/themeHardcodedAllowlist.ts:1-5` 的文件头写明"扫描器只看中性 utility，状态色 / 品牌色 / 图标色 already out of scope by construction"。覆盖面数百处，且**真去动它们，没有任何守卫会拦你**（这反而更支持不作）
  - **两本账别混称**：`theme-hardcoded-baseline.json` 是"**尚未做**"的派生快照（当前 `{"total":0,…}`，已清空）；`themeHardcodedAllowlist.ts` 是"**永不做**"的豁免清单（当前**仅 1 条**：`QuestionAnswerContent.tsx` 的 `border-gray-150`，理由是 Tailwind 无 `gray-150` 这一档、该 class 根本不产出 CSS）。上版把两者混引为"baseline.json 里是登记豁免项"，是错的
  - 误伤风险仍然成立：`selectors.md:42-43` 专门警告 `[class*='x']` 会命中 `border-red-200`
- **不改源码**：不碰 `index.css`、`syntaxTheme.ts`、`userThemeTokens.ts`、`ThemeContext`。
- **不动同目录下的第五套 `console.css`**：它与这四套共用同一条服务端闸门、同一条注入路径、同一个选择器面，代码块同样停在 Prism 基色（实测 `cc-syntax|code-block-bg` 命中 **0**）。但它是 **379 行 / 77 条声明（`grep -cE '^\s*--[a-z0-9-]+\s*:'`；二审勘误：上版写 82 是把注释行也算进去了）、带选择器的自由式主题**，与本方案"只覆写 L1 ＋ 两层外观块"的族不同——按 `theme-authoring` 的通道划分它属另一类。**有意不做，理由记在此处**，免得实施完被追问"为什么 console.css 的代码块还是 One Dark 紫"。（顺带：它已写 **27 条 `--editor-*`**，正是 §8 决策 8 备选 (i) 的现成先例。）
- **不动 `--editor-*`**：见 §9 与 §8 决策 8——这是**有意接受**的边界，会导致"代码块底板不再等于编辑器页"（§6.3 第 4 条）。
- **往 cloudcli 仓库加且只加一个机制守卫 spec**（决策 7 已裁"加"，§5 S6；**✅ 已落地**：`tests/theme-tokens/user-theme-shape-contract.spec.ts`）：`tests/theme-tokens/` 里的 harness 完全具备驱动通道 B 的能力（§1.1 末行），把它固化成常驻 spec 后，"形状写错 → 探针读出非预期色"从"用后即弃"变为"每次都拦"。**但它守的是机制、不是 dotfiles 里那四个文件的取值**——所以 §5 S1 的一次性真机探针与 §6.1 的逐槽读数**仍是主证据，不因有 spec 而省略**。范围严格限定为**形状契约（§3.4 第三类）与外观块顺序**两条，不扩到"取值是否等于某主题"这类需要读 dotfiles 的断言（那会把外部仓库路径依赖带进 cloudcli CI）。
- **不新增令牌**：只用既有的 `--cc-syntax-*` 与 `--code-block-bg`。
- 不改 `--n-white` / `--n-black`（语法接管方案反复点名的 200 处共用地，既有主题也没动）。

---

## 3. 设计方案

### 3.1 语法板：11 个槽，明暗两半

槽名照抄 `SYNTAX_SELECTORS`（`src/shared/syntaxTheme.ts:87-102`），一个不改：

```css
/* 10 个带 -color 后缀 */
--cc-syntax-comment-color
--cc-syntax-punctuation-color
--cc-syntax-class-name-color
--cc-syntax-constant-color
--cc-syntax-number-color
--cc-syntax-keyword-color
--cc-syntax-property-color
--cc-syntax-string-color
--cc-syntax-function-color
--cc-syntax-url-color
/* 1 个不带后缀：它是 <pre> 的正文色，不是某个 token 的颜色 */
--cc-syntax-block-foreground
```

**为什么必须分两半、不能用一条 appearance-agnostic 的块**（与语法接管方案 §3.3 同一条理由）：语法色是"两个 Prism 主题"编译出来的，`oneLight` 与 `oneDark` 同一槽的值不同——`buildSyntaxTheme` 的整套存在理由就是它们不同。所以语法板天然**外观相关**。我们四个配色的明暗两板色值也确有差异，同理。

### 3.2 容器底色：`--code-block-bg`

**写法：直接引用 L1，与内置主题逐字同形。**

```css
:root:not(.dark) { --code-block-bg: var(--palette-sand-50); }   /* 内置主题同形见 src/index.css:1642 */
.dark            { --code-block-bg: var(--palette-ink-950); }   /* 内置主题同形见 src/index.css:1669 */
```

**为什么用引用而非新算色值**：四套主题的 `sand-50` / `ink-950` 实测**恰好就是各自的官方浅底 / 深底**——`dracula` `ink-950` = `231.43 14.89% 18.43%` = `#282a36`、`gruvbox` = `0 0% 15.69%` = `#282828`、`tokyo-night` = `235 18.75% 12.55%` = `#1a1b26`、`kanagawa` = `240 12.68% 13.92%` = `#1f1f28`；`sand-50` 同理是各自浅底。于是：

- **§7 风险 1（形状写错 → 底板消失）在这条令牌上直接消失**——`var()` 引用恒合法，不必靠"记得别写 hsl()"来防；
- 不必为这条令牌新算一份 hex，**§7 风险 10 的 hsl 损耗账也不用背这一笔**；
- 与内置主题的写法逐字一致，将来升格通道 A 时是**零改动**。

> **形状仍然是硬约束，只是引用形态自动满足它**：`--code-block-bg` 属 §3.4 的第 3 类，必须是**裸 HSL 三元组或 `var()` 引用**；写 `hsl()` 会让底板消失。若因故不用引用形态而写死值，就必须落成裸三元组。**这是本方案唯一一处"写错形状就静默全毁"的地方**，务必看 §3.4 第 3 类。

**注意浅色下的视觉变更**：基色是纯白，而四个主题的浅色底都是带色温的（Dracula 米黄、Gruvbox 米白、Tokyo Night 冷白、Kanagawa 米白）。所以浅色外观下代码块会**从纯白变成主题色温**——这是本次有意的可见变更，要进 §6.3 记账。**并且幅度在三处消费者之间不同**：chat 浅色是"令牌差的一半"（50% 叠在 `--background` 上），chat 深色与编辑器预览是完整的令牌差（§1.1 消费者行、§6.3）。

**另有一条必须记账的副作用**（二审新增）：这条令牌的设计不变量是"**代码块坐落在该外观的编辑器页上**"（`src/index.css:210-217` 的注释），而**基色的 `--editor-bg` 不跟主题走**（浅色 `src/index.css:365` 指向 `--palette-white`、深色 `:484` 是字面值 `#282c34`），四套主题又都没写 `--editor-*`。所以指向主题底色之后，**块与编辑器页就分家了**（Tokyo Night `#1a1b26` vs `#282c34`、Kanagawa `#1f1f28` vs `#282c34`；浅色下块是主题色温 vs 编辑器页纯白）。这是 §8 决策 8 的题，**处置写进 §6.3**。

### 3.3 落盘形状（与现有 47 条 L1 块的关系）

现有四份主题都是**单一 `:root{}` 块**装 47 条 L1 声明，因为 L1 的 sand/ink 分工让"一份值同时喂两种外观"。**语法与容器没有这个性质，所以要在同一个文件里追加两个带外观作用域的块**：

```css
/* 既有：不动 */
:root {
  --palette-ink-950: …;   /* 47 条 */
  …
}

/* 新增块 1：浅色外观 */
:root:not(.dark) {
  --code-block-bg: var(--palette-sand-50);   /* 引用形态，见 §3.2 */
  --cc-syntax-comment-color: <…>;   /* 11 条 */
  …
}

/* 新增块 2：深色外观 */
.dark {
  --code-block-bg: var(--palette-ink-950);
  --cc-syntax-comment-color: <…>;   /* 11 条 */
  …
}
```

两处要点：

1. **浅色半写 `:root:not(.dark)` 而不是 `:root`**。写 `:root` 会连深色外观一起盖（两种外观同值），而那正是语法接管方案硬约束 3 点名的"**无守卫、漏写静默**"那一条——它失效时不报错，只是深色下语法色错。我们的 `:root:not(.dark)`（特异性 0,2,0）也确实压得过基色表的 `:root`（0,1,0）。
2. **深色半写 `.dark`**：与基色表的 `.dark` 同特异性（0,1,0），靠文档顺序取胜（`<head>` 末尾）。

> **一个待实测的形状问题**：`.dark` 与 `:root:not(.dark)` 的**相对顺序**在本文件里是否影响结果？按特异性推演不影响（两者互斥匹配），但通道 B 没有守卫，本文把它列为实施第一步的实测项（§5 **S1(c)**）。

### 3.4 值形状与映射口径

**先分清三类形状——混类就会静默出错，而其中一类的错法最安静：**

| 类 | 令牌 | 消费端 | 合法形状 | 写错的后果 |
|---|---|---|---|---|
| 1 | 既有 47 条 `--palette-*` | `hsl(var(--palette-x))` | **裸 HSL 三元组**（或对 L1 的 `var()` 引用） | 写 hex → 声明失效，静默 |
| 2 | 11 个 `--cc-syntax-*` | `react-syntax-highlighter` 把 `var(--cc-syntax-*)` **原样内联**进 style 属性（`syntaxTheme.ts:111-160` 生成、**`:140`** 写入 `merged[property] = var(...)`） | **完整颜色值**：`hex` / `hsl()` / `rgb()` 均可 | 基本写不坏（浏览器自己解析内联值） |
| 3 | **`--code-block-bg`** | **`hsl(var(--code-block-bg))`**——L2 语义令牌，走 `SEMANTIC_TOKENS`（`src/shared/userThemeTokens.ts:165-180`，`ruleForToken` 于 `:261` 返回 `'triplet-or-reference'`） | **裸 HSL 三元组 或 `var()` 引用；`hsl()` 非法** | **写 `hsl()` → `hsl(hsl(...) / .5)` → 计算值无效 → 声明被丢 → 代码块底板消失，三层都不报错** |

类的划分依据在源码里逐处可查：
- `src/index.css:212-217` 的注释直写 *"A triplet, because the chat surface resolves it as `hsl(var(--code-block-bg) / 0.5)`"*，而基值就是 `var(--palette-white)`（引用形态）；
- 构建产物 `dist/assets/*.css`：`.bg-code-block\/50{background-color:hsl(var(--code-block-bg) / .5)}`；
- `src/modules/code-editor/markdown/MarkdownCodeBlock.tsx:75` 同形；
- 通道 A 侧有闸门：`src/shared/tests/userThemeTokens.test.ts:127-137` 正拿 `#282c34` 当反例，断言它被 ignore、理由是 "HSL triplet"；`userThemeTokens.ts:169` 也在 `SEMANTIC_TOKENS` 里。

**闸门是分路径的（二审补记，别以为"通道 A"是一道统一的闸门）**：

| 导入路径 | 编译入口 | 第 3 类的遭遇 | 类型 |
|---|---|---|---|
| `.css`（**本文走这条**） | `userThemeStyles.ts`——`userThemeStyles.ts:95` 注释原文 *"a `.css` file verbatim, a `.json` one compiled"* | 原样注入，**没有任何形状校验** | **破坏型**：底板静默消失 |
| `.json` | `compileUserThemeTokens`（`userThemeStyles.ts:213`） | 命中 `SEMANTIC_TOKENS` → `triplet-or-reference` → 完整 `hsl(…)` 既不是 triplet 也不是 `var()` 引用 → **被忽略** | **drop 型**：该条不生效，其余照常 |
| `.tmTheme` | `compileTmTheme`（`userThemeStyles.ts:216`） | 产出的本就是规整化的语法声明，**用户不手写这个令牌** | 不适用 |

所以"无闸门"只对 `.css` 精确成立；四条本次都走 `.css`，**决策 4 的修正依然成立，且被这条差异强化**（`.json` 侧有护栏、`.css` 侧没有，正是需要写清形状的理由）。

- **取值建议**：语法槽（第 2 类）**统一写 hex**——与 `index.css` 里内置主题的 `--cc-syntax-*` **逐字同形**（实测 **55 条全部是 hex，无一条 `hsl()`**），升格为通道 A 时零改动；**`--code-block-bg`（第 3 类）直接写 `var(--palette-sand-50)` / `var(--palette-ink-950)` 引用**（§3.2）——与内置主题逐字同形，形状恒合法，风险 1 在这条令牌上归零。
  - **为什么不是 `hsl()`**（S3 落盘时勘误）：本节初稿写的是"统一 `hsl()`，与内置主题的多数写法一致"——**这个理由不成立**，内置主题那 55 条语法槽**一条 `hsl()` 都没有**。写 `hsl()` 还会平白背上 hex → hsl 的单向损耗（`#6272a4` → `hsl(225, 15%, 51%)` 反算不回原值），升格时也需逐条改写。故落盘形态定为 hex，§10 的 HSL 列降为**反算参照**、不再等于落盘形态。见 §8 决策 4。
- **映射口径**（照语法接管方案 §3.7 已定下的那套）：**参照物的语法属性 → 按色值分组 → 组内取语义最近的 Prism 类别**。已知不精确，如实记账。
- **三个通常没有独立色、需按口径取的槽**：
  - `punctuation` → 取参照物的**编辑器前景色**（标点在大多数配色里就是前景色）；
  - `property` → **按参照物个别判断**（多数配色里它有独立变量色，一刀切取前景色会丢语义；参照物确实没有时才退回前景色）；
  - `block-foreground` → 取**编辑器前景色**（它就是 `<pre>` 的正文色）。
  这三条是本方案里最"靠判断"的部分，**请审阅者重点看**（§8 决策 3），并且它们的可读性在 §6.2 单独核算。

### 3.5 prose：正文排版色（**决策项，我建议不做**）

**技术上能做，已实测**。在当前 `user-dracula` 上追加如下覆写：

```css
.chat-message .prose {
  --tw-prose-body: …; --tw-prose-headings: …; --tw-prose-bold: …;
}
.dark .chat-message .prose {
  --tw-prose-body: …; --tw-prose-headings: …; --tw-prose-bold: …;
}
.chat-message .prose a { color: …; }
```

真机读数（深色）：

| 元素 | 补丁前 | 补丁后 |
|---|---|---|
| 正文段落 | `rgb(209, 213, 219)` | `rgb(68, 71, 90)` |
| 标题 | `rgb(255, 255, 255)` | `rgb(98, 114, 164)` |
| 加粗 | `rgb(255, 255, 255)` | `rgb(98, 114, 164)` |
| 链接 | `rgb(96, 165, 250)` | `rgb(189, 147, 249)` |

**但有一条坑必须先讲**：**深色半不能用 `--tw-prose-invert-*`。** 第一版补丁就栽在这：Typography 在深色下把 `--tw-prose-body` 指成 `var(--tw-prose-invert-body)`，而我在 `.chat-message .prose`（低特异性）里直接赋了 `--tw-prose-body`，**把那条间接引用截断了**，结果深色下拿到的是浅色的值。修法：两半都**直写 `--tw-prose-body`**，靠作用域分块区分。

**建议不做的三条理由**：

1. **与内置主题不一致**：`cc-catppuccin`、`cc-onedark` 等一律不动 prose（`src/index.css` 里 `tw-prose` 零覆写）。我们做了，就变成"用户主题比内置主题更彻底"——一个将来会被问"为什么内置不做"的差异。
2. **`--tw-prose-*` 不在契约面里**：它是 Tailwind Typography 的框架内部变量（语法接管方案 §3.5 把 `--tw-*` 明确列为"framework internals"，白名单同样不授权）。绑上去等于把主题挂在框架的实现细节上，Typography 升级可能改名字或改默认值。
3. **接手对比度保证**：Typography 的 gray 阶是它挑过的（明 `#374151` / 暗 `#d1d5db`，都过 AA）。换主题色后要自己保证可读——而这正好落在"我们比官方更激进"的地带。

**如果审阅者判"做"**，则 §5 的实施清单要加一步：为四套主题各配一套 prose 色（body / headings / bold / link × 2 外观 = 8 个值），并逐个核算对比度（AA ≥ 4.5）。

### 3.6 机制可行性：已用真机验证（本方案写就时的证据）

在真 chromium 里给 `user-dracula` 追加「`:root:not(.dark)` + `.dark`」两块的覆写后，与追加前对照复测 8 项：

| 断言 | 补丁前 | 补丁后 | 结论 |
|---|---|---|---|
| 语法 keyword | `rgb(198, 120, 221)`（One Dark 紫） | `rgb(255, 121, 198)` | **转向** ⇒ §3.1–3.3 的写法生效 |
| 语法 string | `rgb(152, 195, 121)`（One Dark 绿） | `rgb(241, 250, 140)` | **转向** |
| 正文段落 | `rgb(209, 213, 219)` | `rgb(68, 71, 90)` | **转向** ⇒ §3.5 可行 |
| 标题 | `rgb(255, 255, 255)` | `rgb(98, 114, 164)` | **转向** |
| 加粗 | `rgb(255, 255, 255)` | `rgb(98, 114, 164)` | **转向** |
| 链接 | `rgb(96, 165, 250)` | `rgb(189, 147, 249)` | **转向** |
| 行内 code | `rgb(248, 248, 242)` | `rgb(248, 248, 242)` | 未变（它走 L2 令牌，本来就跟主题） |
| 代码块底 | `rgb(40, 44, 52)` | `rgb(40, 44, 52)` | 未变（**该次补丁没写 `--code-block-bg`**） |

**两处必须如实说明的证据边界**：

1. **只覆盖 2 个语法槽**（`keyword` / `string`），不是全 11 个。这一格证明的是"用户主题的 `:root:not(.dark)` / `.dark` 声明能压过 Prism 基色表"，**不能**推出"11 个槽都会生效"——后者的逐槽读数属实施阶段（§6.1）。
2. **`--code-block-bg` 的可达性与形状契约：已由 S1 实测结清（2026-09-29）**。本方案写就时这里写的是"尚无真机证据"，实施第一步已把它补上——在真 chromium 里给 `.css` 主题注入三种形态，`readCodeBlockBoards().editor` 读数：`var(--palette-ink-950)` → `rgb(40, 42, 54)`（**可达**）、裸三元组 → `rgb(40, 42, 54)`（**可达**）、`hsl(…)` → `rgba(0, 0, 0, 0)`（**底板消失，三层不报错**）。同时结清了 `.dark` 与 `:root:not(.dark)` 的**顺序不敏感**。完整读数见文末「S1 执行记录」。

---

## 4. 来源表（**必须与改动面同宽**）

按要求：每个主题 × 每个外观 × 每个面（语法 / 容器底）都要写明来源，或如实写"不动"。

| 主题 | 外观 | 语法板来源 | 状态 | 容器底来源 |
|---|---|---|---|---|
| **Dracula** | 暗 | `vs-visual-studio-code/src/dracula.yml`（官方 VSCode 主题，含 9 色 anchor ＋ `tokenColors` 的 scope→色 分配） | **现成** | 同色板的 `BG` / `Current Line` |
| | 浅（Alucard） | `dracula-theme/README.md` 的 Alucard 色板 | **只有 UI 色板，无官方语法分配** ⇒ 按暗色口径平移 | 同色板底色 |
| **Gruvbox** | 暗 | `gruvbox/colors/gruvbox.vim` 的 `hi` 组（官方 vim 方案） | **现成** | `dark0` / `bg0` |
| | 浅 | 同上文件的 light 分支 | **现成** | `light0` |
| **Tokyo Night** | 暗 | `vs-tokyo-night-vscode-theme/themes/tokyo-night-color-theme.json`（＋ `tokyonight.nvim/lua/tokyonight/colors/night.lua` 作对照） | **现成** | `bg` |
| | 浅 | 同上仓库的 `tokyo-night-light-color-theme.json`（**官方有浅色版，与内置主题的处境不同**） | **现成** | `bg` |
| **Kanagawa** | 暗 | `kanagawa.nvim/extras/tmTheme/kanagawa.tmTheme`（官方 tmTheme，wave 板） | **现成** | `sumiInk*` 系列 |
| | 浅（lotus） | `kanagawa.nvim/lua/kanagawa/themes.lua` 的 lotus 段 ＋ `colors.lua` | **需按 lotus 色板平移**（官方 tmTheme 只有 wave） | `lotusInk*` / `fujiWhite` 系 |

**参照物的本机位置（本方案写就时已克隆，浅克隆在 `~/Projects/open_projects/refs/`）**：`dracula-theme/`、`vs-visual-studio-code/`、`gruvbox/`、`vs-tokyo-night-vscode-theme/`、`tokyonight.nvim/`、`kanagawa.nvim/`。**上表里的路径都是仓库内路径**，第三方要复核需先拿到同一份仓库——所以 S2 落盘时必须把**参照物的 commit SHA** 与最终取值一起记进对照表（§5 S2），实施时也照 §7 第 5 条把来源写进文件注释，让"与官方血统有落差"这句有个可核的锚点。

**四条如实记账**：

1. **Dracula `Alucard` 与 Kanagawa `lotus` 的语法板需要平移**，不是官方现成的语法分配。这与语法接管方案 §3.7 给 `cc-onedark` / `cc-islands` 判的处境相同（那两个连浅色色板都没有）。平移口径 = 保暗色的"语义 → 色名"映射关系，把色名换成浅色板的对应成员。
2. **`punctuation` / `property` / `block-foreground` 三槽在多数参照物里没有独立定义**，按 §3.4 的三条口径分别取（`punctuation` 与 `block-foreground` 取前景色，`property` 按参照物个别判断）。**这是三处判断，不是三处抄写。**
3. **映射按色值而非按语义**，所以个别槽的语义名与 Prism 实际槽位可能不严格对应（`class-name` 与 `number` 在两个 One Dark 主题里同色、`url` 是唯一的青，这类形状见 `SYNTAX_SELECTORS` 的注释）。本方案不修正它，只指回那笔既有账。
4. **平移必须产出可审计的对照表，不能只写进 `.css` 注释**：S2 要独立产出一份「主题 × 外观 × 13 项 → 参照物色名 → 原始 hex → 落盘 hex（附 HSL 反算参照）→ 判断依据」的四表，先给牵头逐套过一遍，再落进文件注释。理由是平移板在成员缺位时（浅色板成员常少于暗板）怎么取舍是判断，判断藏进 `.css` 注释就不可复核（§5 S2）。

---

## 5. 实施清单

**改动面**：**4 个主题文件 × 24 条新增声明**（11 语法 + 1 容器，各 × 2 外观 ⇒ 12 × 2）＋ **1 个新增机制守卫 spec**（决策 7 已裁"加"，见 S6）。**勘误（S3 落盘时）**：本节初写"× 22 条"，与括注自己的算式（12 × 2）对不上，实际为 **24 条**（§0.7 与 §9 的改动面表本来就按 +24 记，与此处一致）。

| 片 | 内容 | 可独立验收 |
|---|---|---|
| **S1** ✅ **已执行 2026-09-29（5/5 通过，读数见文末「S1 执行记录」）** | 机制实测（不写文件），**三个子项**：<br>(a) **可达性 ＋ 形状证伪**——先按 §3.2 的引用形态写 `var(--palette-ink-950)`，确认 `readCodeBlockBoards()` 读出主题深底（可达性成立）；再故意改成 `hsl(...)`（错形状），确认底板消失；这一步同时钉死 §3.4 第 3 类；<br>(b) 给单套主题补 1～2 个语法槽，确认两外观下都生效；<br>(c) 确认 `.dark` 与 `:root:not(.dark)` 的相对顺序不影响结果 | 是。这一步补上 §3.6 缺的那块真机证据，并把"最安静的错误"变成可证伪的读数 |
| **S2** | 取四套主题 × 两外观 × 13 项的色值（含 §3.4 的三处口径判断），**先产出 §4 第 4 条要求的「参照物色名 → 原始 hex → 落盘 hex → 判断依据」对照表（含参照物 commit SHA）交牵头逐套评审**，通过后再落盘；并按 §6.2 核算对比度。**注意 `--code-block-bg` 两项走引用形态（§3.2），不在"新算色值"之列** | **✅ 已产出**（§10：4 张对照表 ＋ 24 组对比度读数，全过；含 1 处"造值"与 3 处按槽判断）。**牵头裁定：不另走一轮批注，直接进 S3 落盘**（2026-09-29；同时裁定落盘形态由 hsl 改为 hex，见 §3.4 / §8 决策 4） |
| **S3** ✅ **已执行 2026-09-29（4 文件 × 24 条，24 项校验全绿，见文末「S3 执行记录」）** | 落盘：四个文件各追加两个块（§3.3 的形状），既有 47 条一字不动。**同批把 §6.3 第 4 条的分家记账写进文件注释**；并按勘误把语法槽落成 **hex**（§3.4 / §8 决策 4） | 是 |
| **S4** ✅ **已执行 2026-09-29（8 组 × 11 槽全等 ＋ 底板/非令牌/真实 chat，"双引擎全绿"，见文末「S4 执行记录」）** | 真机复验：四套主题 × 两外观，逐槽读渲染值（清单由 §6.1 第 1 条的取样器反推），与 S2 的期望值比对（§6.1）；**并覆盖代码块内部的非令牌元素与编辑器预览**（§6.1 第 3 条） | 是 |
| **S5**（仅当 §8 决策 2 判"做"） | prose 色：4 主题 × 2 外观 × 4 个变量 ＋ 链接色，附对比度核算 | 是 |
| **S6** ✅ **已执行 2026-09-29（新 spec 6/6 通过，双引擎；theme-tokens 全套 174 passed，见文末「S6 执行记录」）** | 把 S1 的机制结论固化为常驻守卫：`tests/theme-tokens/` 新增一个**窄 spec**（实际落名 `user-theme-shape-contract.spec.ts`），断言两件事——(a) **形状契约**：`.css` 路径下 `--code-block-bg` 写裸三元组 / `var()` 时底板兑现、写 `hsl()` 时底板消失（把 §3.4 第三类钉死）；(b) **顺序不敏感**：`.dark` 与 `:root:not(.dark)` 的相对顺序不影响结果（S1(c) 的结论）。**只碰机制、不读 dotfiles 那四个文件**，故与主题取值解耦、可在 cloudcli 侧长期跑 | 是（spec 自身可独立跑绿） |

**顺序理由**：S1 先做是为了不让"容器底是否可达"与"它的值形状"这两个未验证项带着最大不确定性进入 S3 落盘；**S6 紧随其后把 S1 的结论沉淀为常驻守卫，避免"验过一次就再不检查"**。

---

## 6. 验收标准（DoD）

### 6.1 真机读数（主证据；现有守卫不是没有，而是读不到这四个文件——§1.1 末行）

四套主题 × 两种外观，在真 chromium 中：

1. **11 个语法槽**的**渲染值**（不是声明文本）与 S2 的期望值逐位相等。比较方式：**把期望值也过一遍探针再比**（照 `user-theme-tmtheme.spec.ts:60-66` 的 `tripletReference` 范式）——声明是 hex（如 `#c678dd`）、读出来是 `rgb(198, 120, 221)`，直接 `===` 永不成立。
   - **11 个槽的核对清单要从产物反推，别手抄 `SYNTAX_SELECTORS`**（二审建议）：仓库里已有现成取样器 `src/modules/chat/tests/markdownSyntaxThemeInjection.test.tsx:36` 的 `referencedVariables()`——它渲染真 markdown，用 `matchAll(/var\((--cc-syntax-[a-z0-9-]+)\)/g)` 从**渲染出的内联样式**里反推"这段代码块实际引用了哪些槽"。用它当清单来源（配一段覆盖全 11 槽的样例：注释 / 标点 / 类名 / 常量 / 数字 / 关键字 / 属性 / 字符串 / 函数 / URL），比手抄多挡住两件事：**抄错名**（写进去也不生效，且静默）与**漏项**（清单自己不会喊缺）。编辑器那半的对应物是 `src/modules/code-editor/tests/markdownCodeBlockSyntaxTheme.test.tsx`。
2. **`--code-block-bg` 要拆成两个断言**，因为在 chat 浅色半"渲染值"根本不可判定：
   - **(a) 计算值**：读 `getComputedStyle(document.documentElement).getPropertyValue('--code-block-bg')`（即 `tests/theme-tokens/main.ts:519-524` 那一路），与 S2 期望的裸三元组比对。**必须读计算值而非注入 `<style>` 的 `textContent`**——§3.2 已把落盘值定为 `var(--palette-sand-50)` 这类引用形态，`textContent` 里就是那个 `var(...)`，与"裸三元组期望"一比会**假红**；而自定义属性的计算值会把 `var()` 代换掉（`tests/theme-tokens/token-baseline.json` 全文 **0 处 `var(`**，其 `--code-block-bg` 记作 `"0 0% 100%"` 而源码声明偏偏是 `var(--palette-white)`，`--n-gray-200` 记作 `"220 13% 91%"` 而源码是 `var(--palette-gray-200)`），所以这一条对两种形态都成立。
   - **(b) 落地证据**：深色（不透明）面读渲染出的底板色作为落地证据；**浅色面不能比令牌值**——chat 的浅色底是 `hsl(var(--code-block-bg) / .5)` 叠在 `--background` 上的混色（`src/index.css:212-217` 注释、`main.ts:414` 探针都确认这一层），它既不等于令牌值、还会跟着主题页面底一起漂。浅色面沿用 `readCodeBlockBoards()` 的 `half` 口径，或直接沿用 `code-block-surface.spec.ts` 已钉住的那套关系（**编辑器预览恒不透明、chat 深色不透明、chat 浅色恒为一半**）。
   - 若照字面写成"渲染值与期望值相等"，这条断言在浅色半要么永不成立、要么被写成一个恒真判断——正是本项目记过的"未加探针须点名报错，防 `undefined` 恒假通过"的同一族陷阱。
3. **代码块内部的非令牌元素要一并读数**：语言标签、复制按钮、容器边框、行内 code。它们不走 `--code-block-bg`，但**多数走 L2 令牌或 `--n-gray-*`，而这两族正是我们上一轮已经改过的**（`Markdown.tsx:135-151` 的 `text-muted-foreground` / `border-border` / `hover:text-foreground`；`MarkdownCodeBlock.tsx:30,48,60` 的 `--n-gray-*` 与 `bg-card/90`）。**已知的唯一例外是"已复制"态的 `text-green-600 / dark:text-green-500`**（`Markdown.tsx:149`），它是按构造在扫描范围外的状态色，不跟主题、也不在本次范围（§2.2）。S4 每组读数时对它截一张图确认无意外失配即可。
   - **该块不渲染行号**（一审 Claude 批注点名的"行号"元素**不存在**——`Markdown.tsx` 未用 `showLineNumbers`）。此句为封口，免得下一位读者照原批注去找那个不存在的元素。
4. **读数前必须让过渡跑完**（**S4 实测踩到的坑，2026-09-29 补**）：`getComputedStyle` 在 CSS 过渡进行中返回的是**插值**而不是终值。S4 第一次读数就撞上了——`--code-block-bg` 的计算值已是主题的深底，底板却读出 `rgba(255,254,250,.5)`，正好是基色白到主题沙色之间 **25%** 处的插值，看着像个真实的不一致，其实是读数时机错了。两个要点：
   - **注入"掐掉过渡"的表并不够**：规范明说改 `transition-property` / `transition-duration` **不影响已在进行的过渡**，所以"先注入 `transition-duration:0s` 再读"仍会读到插值。正确做法是**等它跑完**（`document.getAnimations().length === 0`），或在注入前就已 `transition: none`。
   - 仓库里的探针都显式设了 `transition: none`（`main.ts:317`、`main.ts:407`，注释写着"a value read mid-interpolation is a value no one painted"），**`readTokens` 的令牌枚举却是在真元素上读的**（`main.ts:521-524`）——所以自建读数脚本时要自己补这一手。见 §7 风险 13。

### 6.2 对比度（语法槽**不入** UI 配对，但判断槽要单独核）

语法接管方案 §3.4 已判定：语法色**不进** `SURFACES`、不加对比度断言（§5.10 的 6 组配对是 UI 配对）。本方案沿用——**但仍要做一次人工核算，且范围不能只写 1 处**：

- **核算范围**：`block-foreground` ＋ 另两个按判断取的槽（`punctuation`、`property`），即 **3 槽 × 4 主题 × 2 外观 = 24 组**，对各自的 `--code-block-bg` 至少 AA（4.5:1，正文级）。其余 8 槽是有名有姓的 token 色，不进 UI 配对（沿用既有判定）。
- **为什么是这三个**：它们取的是**编辑器前景色**，而在 Dracula `Alucard` 与 Kanagawa `lotus` 这两套**平移板**上最危险——平移只保"语义 → 色名"映射，浅色板的成员若与语义错位，取到的前景色可能逼近容器底（浅底 ＋ 低对比前景）直接跌破可读线。**平移板的危险不在"色值抄错"，在"取到的成员本身对比不足"。**
- **浅色面的底色必须用混色后的实际值**：chat 浅色半的底板是 `hsl(var(--code-block-bg) / .5)` 叠在 `--background` 上（§6.1 第 2 条），拿令牌原值当底色会算出一个页面上并不存在的对比度。**编辑器预览与 chat 深色面用令牌原值。**
- ✅ **该口径的成立前提已由 S4 机检（2026-09-29）**：混色结果只有在 `--code-block-bg` 与 `--background` 相等时才正好等于令牌原值。四套主题在两个外观下**恰好都相等**（浅色同取 `sand-50`、深色同取 `ink-950`；已逐套实测计算值，8/8 相等，见文末「S4 执行记录」第 3 条）。所以 §10.5 直接用令牌原值算出的 24 组读数**就是页面上的实际对比度**，不必重算。这条断言已写成机检，一旦将来某套主题把代码块底与页面底分开，它会立刻变红。

### 6.3 有意的视觉变更逐条记账

| # | 变更 | 范围 |
|---|---|---|
| 1 | 代码块 token 色从 Prism `oneLight`/`oneDark` 换成各主题的语法板 | 四套 × 两外观；**聊天与编辑器 markdown 预览共用同一份 `syntaxTheme.style`，两处同时变** |
| 2 | 代码块底色：深色下从 `220 13% 18%` 换成各主题的深色代码面；**浅色下从纯白换成主题色温** | 四套 × 两外观 × **3 处消费者**（chat、编辑器预览、Mermaid 回退块） |
| 3 | （仅当 §8 决策 2 判"做"）聊天正文 / 标题 / 加粗 / 链接色改由主题决定 | 四套 × 两外观 |
| 4 | **代码块底板不再等于编辑器页**（§8 决策 8 的处置）：这条令牌的设计不变量是"块坐落在该外观的编辑器页上"，而 `--editor-bg` 不跟主题走（浅色纯白、深色 `#282c34`），四套主题又不写 `--editor-*` | 四套 × 两外观 × **编辑器 markdown 预览**（chat 侧无编辑器相邻，不受影响） |

**第 4 条要说实**：这是**有意接受的不变量偏离**，不是疏漏。深色下偏离幅度不一——Dracula `#282a36` / Gruvbox `#282828` 对 `#282c34` 只差 2～4 个 RGB 级（肉眼不可见），而 **Tokyo Night `#1a1b26` / Kanagawa `#1f1f28` 对 `#282c34` 明显更深**（观感是"代码块成了更暗的嵌入面板"，通常不难看，但确实不再等于编辑器页底）。浅色下块变成主题色温、编辑器页仍是纯白，同样一眼可见。**守卫拦不到这条**：`code-block-surface.spec.ts:33-36` 的 `THEMES` 只遍历 `BUILTIN_THEMES.filter(appearance === 'system')`，用户主题不在其内（与 §7 风险 8 是一件事的两面）。

**第 2 条的幅度在三处消费者之间不同，必须分开记**：chat 浅色是**令牌差的一半**（`/ .5` 叠在 `--background` 上），chat 深色与编辑器预览是**完整的令牌差**（不透明）。同一份"从纯白变主题色温"的记账若只按 chat 写，编辑器预览那半会把变化幅度少记一倍（`code-block-surface.spec.ts:12-27` 把这条不对称写明了）。

**S4 补充（2026-09-29）**：浅色下"令牌差的一半"的实际幅度，对**四套主题都是零**——因为它们的代码块底与页面底同取 `sand-50`（§6.2 末条），50% 叠在自身之上仍是自身。也就是说 chat 浅色半的 `/50` 不对称在这四套主题下**看不出来**，真正可见的变化只在编辑器预览那半（不透明，从纯白变成主题色温）。深色下同理：chat 与编辑器预览都拿到完整令牌差。

### 6.4 零副作用与仓库归属

- 四套主题既有 **47 条 L1 声明逐字节不变**（`git diff` 只应看到新增行）；
- **cloudcli 仓库只新增 1 个 spec**（决策 7 裁"加"）：`git status --short` 应只见 `tests/theme-tokens/` 下那一个新文件（外加本文档本身），**无其它改动**；四套主题与其余源码都不落在那里。**✅ 实测达成（2026-09-29）**：`git status --short` 恰为 `?? docs/research/…方案.md` ＋ `?? tests/theme-tokens/user-theme-shape-contract.spec.ts` 两行。留一条**未修的既有缺口**备查：`tests/theme-tokens/tsconfig.json` 的 `include` 只登记到 `user-theme-paste` / `user-theme-tmtheme`，**之后新增的 8 个 spec（含本片的）都不在其中**，故 `npm run typecheck:theme-tokens` 不覆盖它们——本片按"只加一个 spec、不动其它文件"的约束**没有顺手登记**；本次是以临时登记的方式验过后回滚的（类型检查通过）。
- dotfiles 仓库只应看到这 4 个主题文件被修改。

### 6.5 收尾

- 真机 fixture 进程关闭、端口释放；
- 不遗留临时探针脚本在仓库内。

---

## 7. 风险与坑

| # | 风险 | 后果 | 处置 |
|---|---|---|---|
| 1 | **`--code-block-bg` 写成 `hsl()`**（把三类形状混为一谈时顺手写成 `hsl()`） | **最安静且最严重**：`hsl(hsl(...) / .5)` → 计算值无效 → 声明被丢 → 代码块底板在 chat 与编辑器预览**双双消失**，三层都不报错 | **已由 §3.2 的引用形态（`var(--palette-sand-50)` / `var(--palette-ink-950)`）在结构上消除**——`var()` 恒合法，不靠"记得"来防；另留 §3.4 三类形状表、**S1(a) 用错形状做证伪实测**、§6.1 第 2(a) 读**计算值**；**并由 S6 的守卫常驻钉住形状契约**（✅ 2026-09-29 已落地） |
| 2 | 浅色半写成 `:root` 而非 `:root:not(.dark)` | **静默**：深色下语法色错，不报错（语法接管方案硬约束 3 点名的同一条） | §3.3 写死形状；**S1(c)** 实测顺序；§6.1 两外观分别读数 |
| 3 | `--tw-prose-invert-*` 被自己的低特异性声明截断（**实测已栽过一次**） | 深色下拿到浅色值，且看起来"生效了" | §3.5 记下修法：两半都直写 `--tw-prose-body` |
| 4 | ~~`--code-block-bg` 的可达性尚无真机证据~~ | — | ✅ **已由 S1 结清（2026-09-29）**：`var()` 形态与裸三元组均兑现主题色，见文末「S1 执行记录」 |
| 5 | 参照物缺槽（`punctuation` / `property` / `block-foreground`）靠判断取色 | 少数槽的色可能不是作者本意；**平移板上更可能直接不达 AA** | §3.4 分别口径；§4 记账；**§6.2 对 3 槽 × 4 主题 × 2 外观核算** |
| 6 | Dracula `Alucard`、Kanagawa `lotus` 的语法板是**平移**出来的 | 不是官方原值，与主题"官方血统"有落差 | §4 记账；**S2 产出对照表（含原始 hex 与参照物 commit）**；值写进文件注释标明来源 |
| 7 | 深色下 `--code-block-bg` 的新旧值**肉眼接近**（`rgb(40,44,52)` vs 各主题深底） | 可能被误判为"本来就没问题"或"改了没效果" | §6.1 断言用数值比对，不靠眼看 |
| 8 | 现有守卫**读不到**这四个文件（不是"没有守卫"） | 写错只是"没效果"或"底板消失" | **机制类错误由 S6 的窄 spec 常驻拦截**（✅ 2026-09-29 已落地：`user-theme-shape-contract.spec.ts`）；**取值**仍全靠 §6.1 真机读数（spec 不读 dotfiles）；升格通道 A 时守卫随之内建（§2.2、§8 决策 5） |
| 9 | 硬编码的 Tailwind 原子（链接、工具面板、代码块"已复制"态）仍不跟主题 | 代码块/聊天区会"一半跟、一半不跟" | 已列非目标（§2.2）；如实告知用户这是既有基线 |
| 10 | ~~hex → hsl 有损，将来升格通道 A 时与官方 hex 对不上~~ | — | ✅ **已消除**（S3 落盘时勘误）：落盘形态由 `hsl()` 改为 hex，**不再有换算损失**；§10 的 HSL 列只是反算参照、不参与落盘。`--code-block-bg` 本来就走引用形态（无损耗） |
| 11 | **代码块底板不再等于编辑器页**（二审发现的实质缺口，§3.2 / §6.3 第 4 条） | 编辑器 markdown 预览里"块 ≠ 页"，深色下 Tokyo Night / Kanagawa 幅度明显；**没有任何守卫拦**（现存 spec 只遍历内置主题；决策 7 新增的窄 spec 也只守形状与顺序，不覆盖分家） | §8 决策 8 定处置；§6.3 第 4 条如实记账；若选"一并纳入 `--editor-*`"则改动面重算（§9 也提示了先例：`console.css` 已写 27 条 `--editor-*`） |
| 12 | **S2 里出现一处"造值"**（§10.4 / §10.6 第 1 条）：金川浅色 `property` 的官方 `syn.identifier` `#77713f` 在 lotus 浅底上仅 **4.15:1**，未达 §6.2 的 AA 线 | 该槽取值**不是**参照物原值（压暗 2.2 个 L 点至 `#706b3b`）；复核时与 `kanagawa.nvim` 的 palette 对不上，会被当成抄错 | §10.1–10.4 每格都同时写「参照物色名 ＋ 原始 hex」，§10.6 第 1 条点名；**这是本轮唯一的造值**，其余 87 格均为参照物原值（已逐位校验） |
| 13 | **在过渡进行中读数**（**S4 实测踩到，2026-09-29**） | `getComputedStyle` 返回**插值**而非终值，看起来像真实的取值不一致：S4 初版把主题沙色的底板读成基色白与它 25% 处的 `rgba(255,254,250,.5)`，会被误判成"底板没跟上主题" | **等过渡跑完再读**（`document.getAnimations().length === 0`）。注意注入 `transition-duration:0s` **不能取消已在进行的过渡**（规范如此），所以"先掐过渡再读"不够；仓库现存探针都靠显式 `transition: none` 规避（`main.ts:317,407`）。已写进 §6.1 第 4 条 |

---

## 8. 决策项（**需要审阅者明确取舍**）

| # | 决策 | 我的建议 | 备选 |
|---|---|---|---|
| 1 | **范围**：只补语法板 ＋ 容器底，还是连 prose 一起做 | **只补前两项**（G1–G3），prose 列为"已知边界" | 三项全做（§3.5 给了实施形状与坑） |
| 2 | **prose 归属**：§3.5 那套覆写算不算"主题该管的事" | **不算**，理由是 §3.5 的三条（与内置主题不一致 / `--tw-prose-*` 不在契约面 / 接手对比度保证） | 算，且顺手把"比内置更彻底"当优点 |
| 3 | **缺槽口径**：`punctuation` / `property` / `block-foreground` 怎么取 | **`punctuation` 与 `block-foreground` 取前景色；`property` 按参照物个别判断**（多数配色里它有独立变量色，一刀切会丢语义；参照物确实没有才退回前景色） | 三槽一律取前景色（更省事，但 `property` 会丢语义）；或三槽全按参照物个别判断（成本最高） |
| 4 | **值形状**：统一 `hsl()` 还是照参照物原样（hex） | **S3 落盘时勘误后定：语法槽写 hex**——与内置主题那 55 条逐字同形、零换算损耗、升格零改动；`--code-block-bg` 用 `var(--palette-sand-50)` / `var(--palette-ink-950)` 引用形态（不是取舍，是契约——§3.4 第 3 类；引用形态让风险 1 归零，见 §3.2）。**原裁定为 `hsl()`，其依据「与内置主题多数写法一致」经逐条核对不成立（55/55 全是 hex）** | 语法槽写 `hsl()`：本节初稿的选择，代价是 hex → hsl 单向损耗（约 3 位小数漂移）＋与内置主题形态不一致＋升格时逐条改写，故弃 |
| 5 | **是否顺带把四套升格为内置主题（通道 A）** | **本方案不做**，但值按可搬的形状写，留路 | 另案立项（要过守卫 ＋ 回写设计文档，是另一个量级） |
| 6 | **浅色代码块底从纯白变主题色温**是否可接受 | **可接受**，且这正是"代码块像主题"的一半 | 浅色下保持纯白（则浅色半只有 token 色跟，底不跟） |
| 7 | **要不要往 cloudcli 仓库加一个常驻守卫 spec**（把 §3.6 那类探针固化） | **已裁定：加**（用户拍板；Claude 二审亦倾向加）。**范围**：一个**只守机制**的窄 spec（`tests/theme-tokens/`，见 §5 S6）——断言 `.css` 路径下 `--code-block-bg` 的**形状契约**（写 `hsl()` 底板消失 / 写裸三元组或 `var()` 兑现）＋ `.dark` 与 `:root:not(.dark)` **顺序不敏感**；**不读 dotfiles 那四个文件的取值**，故不引入跨仓库路径依赖。代价已接受：§6.4 措辞放宽为"cloudcli 仓库只新增 1 个 spec"。**✅ 2026-09-29 已按此范围落地**（`user-theme-shape-contract.spec.ts`，3 个 test：两种合法形态等价、`hsl()` 形态底板消失且无告警、外观块顺序不敏感；6/6 通过、双引擎）。**实现时的一条经验**：三条断言都得配"对照"，否则会在真空里通过——两种形态的等价要拿"未主题化的页面确实画得出底板"垫底，顺序不敏感要先断言两个外观本就不同（否则一份没做作用域区分的表也能通过 `toEqual`） | 不加，改一次性探针（原倾向；WorkBuddy 二审同意"不加 ＋ 触发条件写实"）——代价是形状/顺序类地雷"用后即弃"，不再自动拦截 |
| 8 | **代码块底板与编辑器页分家怎么办**（二审发现的实质缺口，§3.2 / §6.3 第 4 条） | **已裁定 (ii)：有意接受分家 ＋ 写进 §6.3 记账**（用户拍板）。理由：本方案的边界是"只覆写 L1 ＋ 两层外观块"；(i) 要把 `--editor-*` 整个家族纳入（30+ 条 × 2 外观 × 4 主题，且含 `1px solid #ddd` 这类**边框表达式**与 `none`，与本次"纯颜色令牌"不是同一类活），编辑器面板还要各自过一遍可读性——那是**另一份对称的姊妹方案**，不该塞进这一份 | **(i) 一并纳入 `--editor-*`**：块与页重新一致，但改动面翻数倍、风险类别也变。**可行性已确认**——`--editor-*` 在两条导入路径都放行（`FAMILY_RULES` 为 `'expression'`，`userThemeTokens.ts:226`），且 `console.css` 已有 **27 条 `--editor-*`** 的现成先例可抄。**(iii) 不改底色**：与 G1 冲突，不成立 |

---

## 9. 非目标

见 §2.2。另补三条：

- 不修 `--n-zinc-*` 一类兼容骨架（既有边界，语法接管方案 `fixed` 组保护的对象）。
- **不改 `--term-*`**：四套主题已写。
- **不改 `--editor-*`**：**但理由要纠正**（二审勘误）——原写"不在用户主题的可达面里"是**错的**。`--editor-*` 在通道 B 其实**可达**：`.css` 原样注入、服务端闸门不查令牌名、基色 `.dark` 里是**字面值**（不是 `var()`），用户主题的块在文档顺序上更后 ⇒ 写得进去也压得过；`.json` 路径同样放行（`FAMILY_RULES` 为 `'expression'`，`userThemeTokens.ts:226`）。**`console.css` 已经写了 27 条 `--editor-*`，就是活证据。** 所以这是"**要不要做**"（§8 决策 8），不是"做不到"。
- 不为"用户主题也能有 coverage 徽标"做任何事（通道 B 文件里无处声明，固有代价）。

---

## 附录 A：改动文件总表

| 文件 | 现状 | 改后 | 仓库 |
|---|---|---|---|
| `cloudcli/.cloudcli/themes/dracula.css` | 87 行 / 47 条 | +2 块 / +24 条 | dotfiles |
| `cloudcli/.cloudcli/themes/gruvbox.css` | 87 行 / 47 条 | +2 块 / +24 条 | dotfiles |
| `cloudcli/.cloudcli/themes/tokyo-night.css` | 87 行 / 47 条 | +2 块 / +24 条 | dotfiles |
| `cloudcli/.cloudcli/themes/kanagawa.css` | 87 行 / 47 条 | +2 块 / +24 条 | dotfiles |
| `cloudcli/.cloudcli/themes/console.css` | 379 行 / 77 条 | **不动**（§2.2 点名，有意不做） | dotfiles |
| `cloudcli/tests/theme-tokens/user-theme-shape-contract.spec.ts` | 不存在 | **新增**（决策 7 的机制守卫，见 §5 S6；✅ 已落地，落名同左，未再改名） | **cloudcli** |

（主题文件的每条 = 1 个 `--code-block-bg` ＋ 11 个语法槽，两个外观各一份。上表最后一行是**唯一**落在 cloudcli 仓库的改动。）

## 附录 B：取证索引（本文引用的原文与行号）

| 主张 | 证据位置 | 取证方式 |
|---|---|---|
| 11 个语法槽的语义名 | `src/shared/syntaxTheme.ts:87-102` | 读源码 |
| 语法基色表插在 `<head>` 最前 | `src/shared/syntaxTheme.ts:231-238` ＋ 注释 `:208-229` | 读源码 |
| 用户主题按文档顺序压过基色表 | `tests/theme-tokens/user-theme-tmtheme.spec.ts:98-131` | 读测试 |
| `--code-block-bg` 基色与内置主题用法 | `src/index.css:212-217`（注释 ＋ `var(--palette-white)`）／`:467` / `:1810` / `:1852` | 读源码 |
| **`--code-block-bg` 的消费形状是 `hsl(var(...))`** | `dist/assets/*.css` 里 `.bg-code-block\/50{background-color:hsl(var(--code-block-bg) / .5)}`；`MarkdownCodeBlock.tsx:75`；`src/index.css:216` 注释 | 读构建产物 ＋ 源码 |
| **通道 A 对它有形状闸门、通道 B 没有** | `src/shared/userThemeTokens.ts:169`（`SEMANTIC_TOKENS`）／`:261`（`triplet-or-reference`）／`src/shared/tests/userThemeTokens.test.ts:127-137`（`#282c34` 反例） | 读源码 ＋ 测试 |
| 内置主题重染语法槽 | `src/index.css:1886-1896`（catppuccin dark）等 | 读源码 |
| 代码块底的 **3 处**消费者 ＋ 透明度不对称 | `Markdown.tsx:134`；`MarkdownCodeBlock.tsx:75`；`MermaidDiagram.tsx:70`；`tests/theme-tokens/code-block-surface.spec.ts:12-27` | 读源码 ＋ 读测试 |
| chat 正文走 Typography | `src/modules/chat/transcript/MessageComponent.tsx:226` 等 6 处 | 读源码 |
| `--tw-prose-*` 是字面值 | `dist/assets/index-*.css` 里 `--tw-prose-body:#374151` | 读构建产物 |
| `src/index.css` 无 prose 颜色覆写 | `grep -n 'tw-prose' src/index.css` → 0 命中 | 实测 |
| 缺口 1/2/3 的数值 | 本方案 §1.2 三张表 | 真 chromium 探针（四状态对照） |
| 覆写写法可行 | §3.6 表 | 真 chromium 探针（含补丁对照） |
| 四套主题当前不含语法声明 | `grep -c 'cc-syntax\|code-block-bg' ~/.cloudcli/themes/*.css` → 各 0 | 实测 |
| 硬编码原子的两本账 | `src/shared/tests/theme-hardcoded-baseline.json`（`{"total":0,…}`）／`src/shared/tests/themeHardcodedAllowlist.ts:1-5,20-30`（1 条） | 读源码 |
| 通道 B 的既有真引擎 harness（e2e ＋ jsdom 两半） | `tests/theme-tokens/user-theme-style.spec.ts:36-50`；`main.ts:316-326` / `:662-690`（`format` 默认 `'css'` 于 `:667`）；`src/modules/chat/tests/markdownSyntaxThemeInjection.test.tsx:36`；`src/modules/code-editor/tests/markdownCodeBlockSyntaxTheme.test.tsx` | 读测试 |
| **闸门分路径**（`.css` 破坏型 / `.json` drop 型） | `src/shared/userThemeStyles.ts:95`（"verbatim" 注释）／`:213`（`compileUserThemeTokens`）／`:216`（`compileTmTheme`）；`src/shared/userThemeTokens.ts:226`（`--editor-*` → `'expression'`） | 读源码 |
| **自定义属性的计算值会代换 `var()`** | `tests/theme-tokens/token-baseline.json` 全文 0 处 `var(`；其 `--code-block-bg` 记 `"0 0% 100%"` 而源码是 `var(--palette-white)`；`--n-gray-200` 记 `"220 13% 91%"` 而源码是 `var(--palette-gray-200)`；读值路径 `main.ts:519-524` | 读基线产物 |
| **代码块底板 ≠ 编辑器页（分家）** | `src/index.css:365`（`--editor-bg` 浅色 `hsl(var(--palette-white))`）／`:484`（深色字面值 `#282c34`）；内置主题两侧同指一档：`:1642`/`:1643`、`:1669`/`:1670`；`tests/theme-tokens/code-block-surface.spec.ts:9-19`（拿 `var(--editor-bg)` 作参照）／`:33-36`（`THEMES` 只遍历内置） | 读源码 ＋ 读测试 |
| 四套主题的实际底板来源 | 各主题 `--palette-ink-950` / `--palette-sand-50` 实测 = `#282a36` / `#282828` / `#1a1b26` / `#1f1f28` 与各自浅底 | 实测（hsl → hex 换算） |
| `console.css` 已写 `--editor-*`（决策 8 备选 (i) 的先例） | `grep -c -- '--editor-' ~/dotfiles/cloudcli/.cloudcli/themes/console.css` → 27 | 实测 |
| `Markdown.tsx` 不渲染行号 | 该文件未使用 `showLineNumbers` | 读源码 |

---

## 10. S2 交付物：语法板与容器底对照表（**待逐套评审，通过后才落盘**）

<!-- S2-SECTION-START -->

口径出自 §3.4（三类值形状 ＋ 三条判断口径）与 §4（来源表）。"甲"指语法接管方案 §3.7 已定的**语义逐槽**映射。
**`.css` 里的落盘形态是 hex**（语法槽属 §3.4 第 2 类，完整颜色值合法），与内置主题那 55 条 `--cc-syntax-*` 逐字同形；落盘 hex 统一小写（参照物原文大小写不一，RGB 等价）。**表中的 HSL 列是原始 hex 的反算参照**（取 2 位小数），供将来升格通道 A 时按需取用，**不是落盘形态**。

### 10.1 德古拉（`user-dracula`）

**参照物与 commit**：`vs-visual-studio-code` @ `a08a206f2c8420ba3c05f0e8d01d43b2f933fdf8`；`dracula-theme` @ `1e04a4b768302fa2de37d09cc7b8087eabcd3ed8`

| 槽 | 暗色（参照物 hex / HSL 参照） | 浅色（参照物 hex / HSL 参照） | 判断依据 |
|---|---|---|---|
| `comment` | `#6272A4` → `hsl(225.45, 26.61%, 51.37%)`<br><sub>COMMENT #6272A4</sub> | `#6c664b` → `hsl(49.09, 18.03%, 35.88%)`<br><sub>Alucard Comment #6c664b</sub> | 暗色 `COMMENT` / 浅色 Alucard `Comment` |
| `punctuation` | `#F8F8F2` → `hsl(60.00, 30.00%, 96.08%)`<br><sub>FG #F8F8F2（编辑器前景）</sub> | `#1f1f1f` → `hsl(0.00, 0.00%, 12.16%)`<br><sub>Alucard Foreground #1f1f1f</sub> | §3.4 口径一：取编辑器前景色；与 `property` / `block-foreground` 同值（Dracula 的括号类标点即前景） |
| `class-name` | `#8BE9FD` → `hsl(190.53, 96.61%, 76.86%)`<br><sub>CYAN #8BE9FD（entity.name.class / entity.name.type）</sub> | `#036a96` → `hsl(197.96, 96.08%, 30.00%)`<br><sub>Alucard Cyan #036a96（平移）</sub> | 甲：className ← CLASS_REFERENCE。Dracula 的类/类型是**青**而非 One Dark 的黄；浅色为平移 |
| `constant` | `#BD93F9` → `hsl(264.71, 89.47%, 77.65%)`<br><sub>PURPLE #BD93F9</sub> | `#644ac9` → `hsl(252.28, 54.04%, 53.92%)`<br><sub>Alucard Purple #644ac9（平移）</sub> | 甲：constant ← CONSTANT |
| `number` | `#BD93F9` → `hsl(264.71, 89.47%, 77.65%)`<br><sub>PURPLE #BD93F9</sub> | `#644ac9` → `hsl(252.28, 54.04%, 53.92%)`<br><sub>Alucard Purple #644ac9（平移）</sub> | Dracula 未单列 `constant.numeric`，随 `constant` ⇒ 与 constant 同值 |
| `keyword` | `#FF79C6` → `hsl(325.52, 100.00%, 73.73%)`<br><sub>PINK #FF79C6</sub> | `#a3144d` → `hsl(336.08, 78.14%, 35.88%)`<br><sub>Alucard Pink #a3144d（平移）</sub> | 甲：keyword ← KEYWORD |
| `property` | `#F8F8F2` → `hsl(60.00, 30.00%, 96.08%)`<br><sub>FG #F8F8F2</sub> | `#1f1f1f` → `hsl(0.00, 0.00%, 12.16%)`<br><sub>Alucard Foreground #1f1f1f（平移）</sub> | 甲：property ← INSTANCE_FIELD。Dracula 把对象属性画成前景 ⇒ 与 `punctuation` / `block-foreground` 同值 |
| `string` | `#F1FA8C` → `hsl(64.91, 91.67%, 76.47%)`<br><sub>YELLOW #F1FA8C</sub> | `#846e15` → `hsl(48.11, 72.55%, 30.00%)`<br><sub>Alucard Yellow #846e15（平移）</sub> | 甲：string ← STRING |
| `function` | `#50FA7B` → `hsl(135.18, 94.44%, 64.71%)`<br><sub>GREEN #50FA7B</sub> | `#14710a` → `hsl(114.17, 83.74%, 24.12%)`<br><sub>Alucard Green #14710a（平移）</sub> | 甲：function ← FUNCTION_DECLARATION |
| `url` | `#8BE9FD` → `hsl(190.53, 96.61%, 76.86%)`<br><sub>CYAN #8BE9FD（markup.underline.link）</sub> | `#036a96` → `hsl(197.96, 96.08%, 30.00%)`<br><sub>Alucard Cyan #036a96（平移）</sub> | 见表下注 ① |
| `block-foreground` | `#F8F8F2` → `hsl(60.00, 30.00%, 96.08%)`<br><sub>FG #F8F8F2</sub> | `#1f1f1f` → `hsl(0.00, 0.00%, 12.16%)`<br><sub>Alucard Foreground #1f1f1f</sub> | §3.4 口径三：取编辑器前景色 |
| `--code-block-bg` | `var(--palette-ink-950)`（= `#282a36`） | `var(--palette-sand-50)`（= `#fffbeb`） | §3.2：引用形态，不新算色值 |

### 10.2 格鲁夫（`user-gruvbox`）

**参照物与 commit**：`gruvbox` @ `ef8864bb42bf244f0295d1c5a403b27e3d139695`（`colors/gruvbox.vim`；暗色取 `bright_*`、浅色取 `faded_*`）

| 槽 | 暗色（参照物 hex / HSL 参照） | 浅色（参照物 hex / HSL 参照） | 判断依据 |
|---|---|---|---|
| `comment` | `#928374` → `hsl(30.00, 12.10%, 51.37%)`<br><sub>`Comment` → `GruvboxGray`（`gray_245`）</sub> | `#928374` → `hsl(30.00, 12.10%, 51.37%)`<br><sub>`Comment` → `GruvboxGray`（`gray_244`）</sub> | 明暗同值（`gray_245` / `gray_244` 十六进制相同） |
| `punctuation` | `#ebdbb2` → `hsl(43.16, 58.76%, 80.98%)`<br><sub>Normal 前景 `fg1`</sub> | `#3c3836` → `hsl(20.00, 5.26%, 22.35%)`<br><sub>Normal 前景 `fg1`</sub> | §3.4 口径一；`Operator` 在 Gruvbox 里就 link 到 `Normal` |
| `class-name` | `#fabd2f` → `hsl(41.97, 95.31%, 58.24%)`<br><sub>`Type` / `Typedef` → `GruvboxYellow`（`bright_yellow`）</sub> | `#b57614` → `hsl(36.52, 80.10%, 39.41%)`<br><sub>`GruvboxYellow`（`faded_yellow`）</sub> | 甲：className ← CLASS_REFERENCE |
| `constant` | `#d3869b` → `hsl(343.64, 46.67%, 67.65%)`<br><sub>`Constant` / `Boolean` → `GruvboxPurple`</sub> | `#8f3f71` → `hsl(322.50, 38.83%, 40.39%)`<br><sub>`GruvboxPurple`（`faded_purple`）</sub> | 甲：constant ← CONSTANT |
| `number` | `#d3869b` → `hsl(343.64, 46.67%, 67.65%)`<br><sub>`Number` → `GruvboxPurple`</sub> | `#8f3f71` → `hsl(322.50, 38.83%, 40.39%)`<br><sub>`GruvboxPurple`</sub> | Gruvbox 的 Number 与 Constant 同为 purple ⇒ 与 constant 同值（派生） |
| `keyword` | `#fb4934` → `hsl(6.33, 96.14%, 59.41%)`<br><sub>`Keyword` / `Statement` → `GruvboxRed`</sub> | `#9d0006` → `hsl(357.71, 100.00%, 30.78%)`<br><sub>`GruvboxRed`（`faded_red`）</sub> | 甲：keyword ← KEYWORD |
| `property` | `#83a598` → `hsl(157.06, 15.89%, 58.04%)`<br><sub>`Identifier` → `GruvboxBlue`</sub> | `#076678` → `hsl(189.56, 88.98%, 24.90%)`<br><sub>`GruvboxBlue`（`faded_blue`）</sub> | §3.4 口径二：Gruvbox 无 property 组 ⇒ 退回 `Identifier` |
| `string` | `#b8bb26` → `hsl(61.21, 66.22%, 44.12%)`<br><sub>`String` → `GruvboxGreen`</sub> | `#79740e` → `hsl(57.20, 79.26%, 26.47%)`<br><sub>`GruvboxGreen`（`faded_green`）</sub> | 甲：string ← STRING |
| `function` | `#b8bb26` → `hsl(61.21, 66.22%, 44.12%)`<br><sub>`Function` → `GruvboxGreenBold`</sub> | `#79740e` → `hsl(57.20, 79.26%, 26.47%)`<br><sub>`GruvboxGreenBold`</sub> | 与 `string` 同值（Gruvbox 两者同为 green；派生，非漏做） |
| `url` | `#8ec07c` → `hsl(104.12, 35.05%, 61.96%)`<br><sub>`bright_aqua`（本色的青角色）</sub> | `#427b58` → `hsl(143.16, 30.16%, 37.06%)`<br><sub>`faded_aqua`</sub> | 甲：url ← VALID_STRING_ESCAPE；Gruvbox 的 aqua 即其转义/PreProc 色 |
| `block-foreground` | `#ebdbb2` → `hsl(43.16, 58.76%, 80.98%)`<br><sub>Normal 前景 `fg1`</sub> | `#3c3836` → `hsl(20.00, 5.26%, 22.35%)`<br><sub>Normal 前景 `fg1`</sub> | §3.4 口径三 |
| `--code-block-bg` | `var(--palette-ink-950)`（= `#282828`） | `var(--palette-sand-50)`（= `#fbf1c7`） | §3.2 |

### 10.3 东京夜（`user-tokyo-night`）

**参照物与 commit**：`vs-tokyo-night-vscode-theme` @ `7c0f11eaef322f293621ca7befe462214b7ea468`（`tokyo-night-color-theme.json` / `tokyo-night-light-color-theme.json`）

| 槽 | 暗色（参照物 hex / HSL 参照） | 浅色（参照物 hex / HSL 参照） | 判断依据 |
|---|---|---|---|
| `comment` | `#51597d` → `hsl(229.09, 21.36%, 40.39%)`<br><sub>`comment`</sub> | `#888b94` → `hsl(225.00, 5.31%, 55.69%)`<br><sub>`comment`</sub> | 直取注释色 |
| `punctuation` | `#a9b1d6` → `hsl(229.33, 35.43%, 75.10%)`<br><sub>`editor.foreground`</sub> | `#343b59` → `hsl(228.65, 26.24%, 27.65%)`<br><sub>`editor.foreground`</sub> | §3.4 口径一 |
| `class-name` | `#0db9d7` → `hsl(188.91, 88.60%, 44.71%)`<br><sub>`support.class` / `support.type`</sub> | `#006c86` → `hsl(191.64, 100.00%, 26.27%)`<br><sub>`support.class` / `support.type`</sub> | 甲：className ← CLASS_REFERENCE |
| `constant` | `#ff9e64` → `hsl(22.45, 100.00%, 69.61%)`<br><sub>`variable.other.constant` / `constant.language`</sub> | `#965027` → `hsl(22.16, 58.73%, 37.06%)`<br><sub>`variable.other.constant` / `constant.language`</sub> | 甲：constant ← CONSTANT |
| `number` | `#ff9e64` → `hsl(22.45, 100.00%, 69.61%)`<br><sub>`constant.numeric`</sub> | `#965027` → `hsl(22.16, 58.73%, 37.06%)`<br><sub>`constant.numeric`</sub> | 甲：number ← NUMBER（与 constant 同值） |
| `keyword` | `#bb9af7` → `hsl(261.29, 85.32%, 78.63%)`<br><sub>`keyword`</sub> | `#65359d` → `hsl(267.69, 49.52%, 41.18%)`<br><sub>`keyword`</sub> | 甲：keyword ← KEYWORD |
| `property` | `#7dcfff` → `hsl(202.15, 100.00%, 74.51%)`<br><sub>`variable.other.property` / `support.variable.property`</sub> | `#0f4b6e` → `hsl(202.11, 76.00%, 24.51%)`<br><sub>`variable.other.property`</sub> | 甲：property ← INSTANCE_FIELD |
| `string` | `#9ece6a` → `hsl(88.80, 50.51%, 61.18%)`<br><sub>`string`</sub> | `#385f0d` → `hsl(88.54, 75.93%, 21.18%)`<br><sub>`string`</sub> | 甲：string ← STRING |
| `function` | `#7aa2f7` → `hsl(220.80, 88.65%, 72.35%)`<br><sub>`entity.name.function` / `support.function`</sub> | `#2959aa` → `hsl(217.67, 61.14%, 41.37%)`<br><sub>`entity.name.function`</sub> | 甲：function ← FUNCTION_DECLARATION |
| `url` | `#89ddff` → `hsl(197.29, 100.00%, 76.86%)`<br><sub>`keyword.operator` / `constant.character.escape`</sub> | `#006C86` → `hsl(191.64, 100.00%, 26.27%)`<br><sub>`keyword.operator` / `constant.character.escape`</sub> | 见表下注 ② |
| `block-foreground` | `#a9b1d6` → `hsl(229.33, 35.43%, 75.10%)`<br><sub>`editor.foreground`</sub> | `#343b59` → `hsl(228.65, 26.24%, 27.65%)`<br><sub>`editor.foreground`</sub> | §3.4 口径三 |
| `--code-block-bg` | `var(--palette-ink-950)`（= `#1a1b26`） | `var(--palette-sand-50)`（= `#e1e2e7`） | §3.2 |

### 10.4 金川（`user-kanagawa`）

**参照物与 commit**：`kanagawa.nvim` @ `bb85e4bfc8d89b0e62c8fa53ccdd13d12e2f77b3`（`lua/kanagawa/themes.lua` 的 `syn` 角色表 ＋ `colors.lua`；暗 = wave、浅 = lotus）

| 槽 | 暗色（参照物 hex / HSL 参照） | 浅色（参照物 hex / HSL 参照） | 判断依据 |
|---|---|---|---|
| `comment` | `#727169` → `hsl(53.33, 4.11%, 42.94%)`<br><sub>`syn.comment` → `fujiGray`</sub> | `#8a8980` → `hsl(54.00, 4.10%, 52.16%)`<br><sub>`syn.comment` → `lotusGray3`</sub> | 直取注释色 |
| `punctuation` | `#DCD7BA` → `hsl(51.18, 32.69%, 79.61%)`<br><sub>Normal 前景 `fujiWhite`</sub> | `#545464` → `hsl(240.00, 8.70%, 36.08%)`<br><sub>Normal 前景 `lotusInk1`</sub> | §3.4 口径一。**注**：Kanagawa 另有 `syn.punct`（`#9CABCA` / `#4e8ca2`），本方案按口径一未取 |
| `class-name` | `#68AD99` → `hsl(162.61, 29.61%, 54.31%)`<br><sub>`syn.type` → `waveAqua2`</sub> | `#597b75` → `hsl(169.41, 16.04%, 41.57%)`<br><sub>`syn.type` → `lotusAqua`</sub> | 甲：className ← CLASS_REFERENCE |
| `constant` | `#FFA066` → `hsl(22.75, 100.00%, 70.00%)`<br><sub>`syn.constant` → `surimiOrange`</sub> | `#cc6d00` → `hsl(32.06, 100.00%, 40.00%)`<br><sub>`syn.constant` → `lotusOrange`</sub> | 甲：constant ← CONSTANT |
| `number` | `#D27E99` → `hsl(340.71, 48.28%, 65.88%)`<br><sub>`syn.number` → `sakuraPink`</sub> | `#b35b79` → `hsl(339.55, 36.67%, 52.94%)`<br><sub>`syn.number` → `lotusPink`</sub> | 甲：number ← NUMBER |
| `keyword` | `#957FB8` → `hsl(263.16, 28.64%, 60.98%)`<br><sub>`syn.keyword` → `oniViolet`</sub> | `#624c83` → `hsl(264.00, 26.57%, 40.59%)`<br><sub>`syn.keyword` → `lotusViolet4`</sub> | 甲：keyword ← KEYWORD |
| `property` | `#E6C384` → `hsl(38.57, 66.22%, 70.98%)`<br><sub>`syn.identifier` → `carpYellow`（`@variable.member`）</sub> | `#706b3b` → `hsl(54.34, 30.99%, 33.53%)`<br><sub>`syn.identifier` → `lotusYellow` **压暗 2 个 L 点**</sub> | 见 §10.6 第 1 条（原值 `#77713f` 仅 4.15:1） |
| `string` | `#98BB6C` → `hsl(86.58, 36.74%, 57.84%)`<br><sub>`syn.string` → `springGreen`</sub> | `#6f894e` → `hsl(86.44, 27.44%, 42.16%)`<br><sub>`syn.string` → `lotusGreen`</sub> | 甲：string ← STRING |
| `function` | `#7E9CD8` → `hsl(220.00, 53.57%, 67.06%)`<br><sub>`syn.fun` → `crystalBlue`</sub> | `#4d699b` → `hsl(218.46, 33.62%, 45.49%)`<br><sub>`syn.fun` → `lotusBlue4`</sub> | 甲：function ← FUNCTION_DECLARATION |
| `url` | `#C0A36E` → `hsl(38.78, 39.42%, 59.22%)`<br><sub>`syn.operator` / `syn.regex` → `boatYellow2`</sub> | `#836f4a` → `hsl(38.95, 27.80%, 40.20%)`<br><sub>`syn.operator` / `syn.regex` → `lotusYellow2`</sub> | 见表下注 ③ |
| `block-foreground` | `#DCD7BA` → `hsl(51.18, 32.69%, 79.61%)`<br><sub>Normal 前景 `fujiWhite`</sub> | `#545464` → `hsl(240.00, 8.70%, 36.08%)`<br><sub>Normal 前景 `lotusInk1`</sub> | §3.4 口径三 |
| `--code-block-bg` | `var(--palette-ink-950)`（= `#1f1f28`） | `var(--palette-sand-50)`（= `#f2ecbc`） | §3.2 |

**表下注（适用 §10.1、§10.3、§10.4）**：

① **Dracula `url` = 青 `#8BE9FD`**：`url` 槽覆盖 [operator, url, escape, regexp, link]，Dracula 的操作符落在 PINK（= `keyword`）、而链接（`markup.underline.link`）与类型落在 CYAN。取青以免与 `keyword` 撞色；代价是与 `class-name` 同值（Dracula 本来就一色两用）。

② **Tokyo Night `url` = `#89ddff`（暗）/ `#006C86`（浅）**：这是它的 `keyword.operator` 与 `constant.character.escape` 色。它的青角色 `#7dcfff` 已被 `property`（`variable.other.property`）占用，故取同族的操作符色，使十一槽尽量可辨。

③ **Kanagawa `url` = `syn.operator`（`#C0A36E` / `#836f4a`）**：Kanagawa 的链接色是 `syn.special1`（`#7FB4CA` / `#6693bf`），但 `#6693bf` 在 lotus 浅底（`#f2ecbc`）上只有 **2.70:1** —— 对同时承载操作符的槽过低，故取 `syn.operator`（`@operator` / `@string.regexp` 用的是同一角色）。

### 10.5 对比度核算（§6.2：3 槽 × 4 主题 × 2 外观 = 24 组，全过）

| 主题 | 外观 | 代码块底 | `block-foreground` | `property` | `punctuation` | 参考：11 槽最弱者 |
|---|---|---|---|---|---|---|
| 德古拉 | light | `#fffbeb` | 15.89:1 | 15.89:1 | 15.89:1 | `string` `#846e15` = 4.80:1 |
| 德古拉 | dark | `#282A36` | 13.36:1 | 13.36:1 | 13.36:1 | `comment` `#6272A4` = 3.03:1 |
| 格鲁夫 | light | `#fbf1c7` | 10.22:1 | 5.82:1 | 10.22:1 | `comment` `#928374` = 3.24:1 |
| 格鲁夫 | dark | `#282828` | 10.75:1 | 5.48:1 | 10.75:1 | `comment` `#928374` = 4.02:1 |
| 东京夜 | light | `#e1e2e7` | 8.47:1 | 7.21:1 | 8.47:1 | `comment` `#888b94` = 2.63:1 |
| 东京夜 | dark | `#1a1b26` | 8.10:1 | 9.96:1 | 8.10:1 | `comment` `#51597d` = 2.50:1 |
| 金川 | light | `#f2ecbc` | 6.19:1 | 4.54:1 | 6.19:1 | `comment` `#8a8980` = 2.93:1 |
| 金川 | dark | `#1F1F28` | 11.26:1 | 9.73:1 | 11.26:1 | `comment` `#727169` = 3.33:1 |

**读法**：前三列是 §6.2 要求达 AA(4.5:1) 的三槽，**24 组全部达标**（最低是金川浅色 `property` 4.54:1）。末列是**信息性**读数——语法色按语法接管方案 §3.4/§5.10 的既有判定**不进 UI 对比度配对**，基色 Prism 自己也有低于 4.5 的槽（`oneDark` 的注释 `#5c6370` 在 `#282c34` 上约 2.9:1），所以这一列只作参考、不设阈值。其中值得一提的两处：**东京夜的注释**（2.50 / 2.63:1，与基色 Prism 同量级）与**金川浅色的注释**（2.93:1）。

### 10.6 本表需要评审者重点看的七处

| # | 位置 | 情况 | 我的处置 |
|---|---|---|---|
| 1 | **金川浅色 `property`** | 官方 `syn.identifier` = `lotusYellow` `#77713f`，在 lotus 浅底上仅 **4.15:1**，未达 AA | **压暗 2 个 L 点**至 `#706b3b`（4.54:1），色相/饱和度不动。**这是本次唯一的"造值"** |
| 2 | **Dracula 的 `punctuation` / `property` / `block-foreground` 三槽同值** | Dracula 把括号类标点与对象属性都画成前景色 | 照取，不粉饰。代价：编辑器的"定义名/分隔符"与"变量名"同色 |
| 3 | **Dracula 的 `class-name` = 青**（非 One Dark 的黄） | Dracula 官方 `entity.name.class` / `entity.name.type` 就是 `CYAN` | 照取（甲：按语义角色，不按 One Dark 的颜色） |
| 4 | **Tokyo Night 的 `url` 不取青** | 它的青 `#7dcfff` 已被 `property` 占用 | 取同族的操作符/转义色 `#89ddff` / `#006C86` |
| 5 | **Kanagawa 的 `url` 不取链接色** | `syn.special1` 的 lotus 值 `#6693bf` 在浅底上仅 **2.70:1** | 取 `syn.operator`（`#C0A36E` / `#836f4a`） |
| 6 | **四套的 `comment` 都低于 AA**（2.50～4.02:1） | 这是参照物的原值，且基色 Prism 的注释同样低于 AA | 照取；`comment` 不在 §6.2 的三槽之列 |
| 7 | **`--code-block-bg` 用引用形态** | `var(--palette-ink-950)` / `var(--palette-sand-50)`，与内置主题逐字同形 | 不新算色值；`sand-50` / `ink-950` 实测即各主题官方底 |

### 10.7 与 §4 来源表的偏差（如实记账）

§4 设想 Tokyo Night 取 `vs-tokyo-night-vscode-theme` 的两份 JSON（暗 + 浅）。**实际两半都照取了该仓库的 `tokenColors`**；但该浅色主题的 `editor.background`（`#e6e7ed`）与本主题 L1 的浅底 `sand-50`（`#e1e2e7`，来自 nvim `day` 的官方算法）**不同源**，两者同属冷白族、逐槽差异在 1～2 级以内。**记这一笔以免复核时对不上。**

<!-- S2-SECTION-END -->

---

## 审阅批注

> **给审阅者**：请在**本节内**追加批注，不要改动本文正文。按 harness 分组，用 GitHub 风格 admonition 标风险等级。

格式示例：

```markdown
### Pi · `<你的 session id>`
> [!WARNING] 潜在风险：……
> [!IMPORTANT] 关键信息：……

### Claude · `<你的 session id>`
> [!NOTE] 补充说明：……
```

| 标记 | 含义 |
|---|---|
| `> [!NOTE]` | 补充说明 |
| `> [!TIP]` | 最佳实践 / 小提示 |
| `> [!IMPORTANT]` | 关键信息 |
| `> [!WARNING]` | 潜在风险 |
| `> [!CAUTION]` | 严重风险（数据丢失 / 故障级） |

<!-- 以下留空，待各 harness 填写 -->

### Claude
> [!NOTE] 总体判断：方案自述的边界（§3.6 仅 2 个语法槽、`--code-block-bg` 无真机证据、平移板非官方原值）都很诚实，§3.3 的 `:root:not(.dark)` 分块与"深色半直写 `--prose-body`"两条坑已踩过并落成台账。下文不重复 §7 已记项，只补它没覆盖的口子。
>
> [!WARNING] 浅色半的对比度核算敞口（指向 §6.2 与决策 3）：§6.2 只要求核 `--cc-syntax-block-foreground` 对 `--code-block-bg` 一处 AA。但 §3.4/§4 明言 `punctuation`/`block-foreground` 取"编辑器前景色"、`property` 取前景色——这三槽在 Dracula `Alucard` 与 Kanagawa `lotus` 两套**平移板**上尤其危险：平移只保"语义→色名"映射，浅色板成员若与语义错位，取到的前景色可能逼近容器底（如 lotus 的浅底对低对比 lilac 前景），直接跌破可读线。建议 §6.2 把核算范围从"1 处"扩到"至少这 3 处判断槽 × 4 主题 × 两外观"，其余 8 槽可维持不入 UI 配对。
>
> [!WARNING] 代码块**内部其它 UI** 未列入取证（指向 §6.1 / 附录 B）：`Markdown.tsx:134` 证明的只是容器底单点；行号、代码块页头/复制按钮、边框这些元素不走 `--code-block-bg`，大概率还停在基色。S4 真机读数只逐槽验 token，可能留下"底跟了、工具栏/行号不跟"的局部失配，且一眼看不出。建议 S4 每组读数时把代码块内非 token 元素也截一张一并确认，和 §6.3 的视觉变更台账对齐。
>
> [!IMPORTANT] 平移板缺"语义→实际色名对照表"这一产出物（指向 §4 三条记账）：§4 只记"需平移"，未定平移的**产出物**。Alucard/lotus 浅色板成员往往少于暗板（某语义色可能无对应成员），"保暗色映射、换浅色成员"在成员缺位时如何取舍是未决的判断，且每一步判断都该可复核。建议：S2 落盘前先把四套 × 两外观的"语义 → 参照物色名 → 最终 hsl"对照表独立产出一份，让牵头逐套评审后再写进文件注释，避免把判断藏进 `.css` 注释不可审计。
>
> [!TIP] hsl 有损与决策 5（升格通道 A）的张力：决策 4 建议统一 hsl、决策 5 留路搬进 `index.css`。但 hex→hsl 不可逆，将来升格复核时会发现"声明 hsl 反算不回官方 hex"，对照官方主题产生约 3 位小数的漂移。若保真优先，照参照物原样 hex 更稳（§3.4 已确认语法槽消费端原样内联，hex 合法）；若只求通道 A 形状统一则可接受 hsl。不强求换，仅提示这条路径的长期成本。
>
> [!NOTE] §8 六项取合的明确表态：决策 1 同意只补语法板+容器底；决策 2 同意 prose 不做（三个理由成立，尤其"比内置更彻底"的差异将来必被反向询问）；决策 3 同意取前景色为统一默认，但仅限 `punctuation`/`block-foreground` 两槽，`property` 建议仍按参照物个别判断——它在多数配色里有独立变量色，一刀切前景色可能丢语义；决策 4/5/6 均可接受，其中决策 6 的"浅色改色温"是本次唯一必有可见变更，务必进 §6.3 对用户明示。

### WorkBuddy

> [!NOTE] 先交底：本文的行号与事实我逐条读过（不是照抄）。核对的正面结果：`SYNTAX_SELECTORS` 确实在 `src/shared/syntaxTheme.ts:87-102` 给出 11 个稳定名（10 个 `-color` ＋ `blockForeground`）；`ensureSyntaxStyleElement()` 在 `:231-238`、`:236` 确为 `insertBefore(el, head.firstChild)`；四个主题文件实为各 `87 行 / 47 条 --palette-*`、单一 `:root` 块、`cc-syntax|code-block-bg` 各 0 命中，与 §1.1／附录 A 完全一致；`grep -c tw-prose src/index.css` = 0（§0.2 成立）；`--palette-white: 0 0% 100%`（`src/index.css:52`）未被四套覆写，所以"浅色底 = 纯白"的前提成立；内置主题口径也核过，`cc-catppuccin` 浅色半 `:1838-1848`、深色半 `:1886-1896` 各 11 条含 `block-foreground`，G2 的"值可直接搬"成立；`.agents/skills/theme-authoring/selectors.md:42-43` 确有 `[class*='border-r']` 会命中 `border-red-200` 的警告。以下只写与事实不符或口径缺失的部分。

> [!CAUTION] `--code-block-bg` **不能**跟着决策 4 写成 `hsl()`，这是本方案最容易犯且最安静的一处（指向 §3.4 与决策 4）。§3.4 把值形状分成两类——"L1 `--palette-*` 必须是三元组（写 hex 静默失效）"与"语法槽消费端原样内联，hex 合法"——但 `--code-block-bg` 落在被漏掉的**第三类**：它是 L2 语义令牌，消费端恰恰是 `hsl(var(--code-block-bg))`。证据链是逐处可查的：`src/index.css:216-217` 的注释直写"A triplet, because the chat surface resolves it as `hsl(var(--code-block-bg) / 0.5)`"；`src/modules/code-editor/markdown/MarkdownCodeBlock.tsx:75` 写 `background: 'hsl(var(--code-block-bg))'`；`tests/theme-tokens/main.ts:411/414` 的参照探针也是 `hsl(var(--code-block-bg))` 与 `hsl(var(--code-block-bg) / 0.5)`。若照决策 4"统一写 `hsl()`"落成 `--code-block-bg: hsl(48 100% 96.08%)`，浏览器拿到 `hsl(hsl(…))` → 计算值无效 → 聊天与编辑器代码块**双双丢掉底板**，且没有任何一层会报错（`.css` 原样注入、无校验、构建也不参与）。对照通道 A：同一个令牌在 `src/shared/userThemeTokens.ts:169` 的 `SEMANTIC_TOKENS` 里 → `ruleForToken` 返回 `'triplet-or-reference'`，`userThemeTokens.test.ts:130-133` 正是拿 `#282c34` 当反例断言它被忽略；换句话说**通道 A 有闸门、通道 B 没有，而决策 4 正好在拆掉这道闸门**。建议：§3.4 补第三类"经 `hsl(var())` 取值的 L2 令牌 ⇒ 恒为裸三元组或引用"，决策 4 措辞改成"**语法槽**统一写 `hsl()`；`--code-block-bg` 恒写三元组"。这一条我建议列为 S1 的第一个实测项（写坏形状时 `readCodeBlockBoards` 会读出非预期色，正好可证伪）。

> [!WARNING] §1.1 表里"**容器底色的唯一消费者** = `src/modules/chat/transcript/Markdown.tsx:134`"与事实不符：至少 3 个消费者。除该处（`bg-code-block/50 … dark:bg-code-block`）外，还有 `src/modules/code-editor/markdown/MarkdownCodeBlock.tsx:75`（内联在 `<pre>` 上的 `background: 'hsl(var(--code-block-bg))'`）与 `src/modules/code-editor/markdown/MermaidDiagram.tsx:70`（同一对类名）——后两者经 `MarkdownPreview`（`MarkdownPreview.tsx:8,15`）← `CodeEditorSurface.tsx:8` 供编辑器预览使用，与聊天共用。两个后果要一并改：(1) 改动面包含**编辑器 markdown 预览**，§6.3 的视觉变更记账与 §6.1／S4 的验收范围都要覆盖它，(2) 两处的透明度处置**本来就不同**（聊天浅色是令牌的 50%，编辑器预览不透明——`tests/theme-tokens/code-block-surface.spec.ts:9-27` 的注释把这条"有意不对称"写明了），所以浅色下"从纯白变主题色温"的幅度在这两地不一样，同一份记账不能只按聊天写。顺带：该 spec 的 `readCodeBlockBoards()` 已经把"editor 恒 = editor page / chat 暗色不透明 / chat 浅色恒为一半"钉住了，§6.1 的措辞可以直接沿用它的口径，不必另起一套。

> [!WARNING] §6.1 的"`--code-block-bg` 的**渲染值**与期望值相等"这句在聊天浅色半**不可判定**（指向 §6.1 与 §6.2）。那里的渲染值不是令牌值，而是 `hsl(var(--code-block-bg) / 0.5)` 叠在 `--background` 上的混色（`src/index.css:216-217` 的注释与 `main.ts:414` 的探针都确认 0.5 这一层），它既不等于令牌值，还会跟着主题的页面底一起漂。照字面执行，这条断言要么永远不成立、要么被写成一个恒真判断——正是本线记过的"未加探针须点名报错，防 `undefined` 恒假通过"的同一族陷阱。建议把这一项拆成两条：(a) 读 `:root` 上该令牌的字面值并与 S2 期望比对（这是本次真正在改的东西），(b) 暗色（不透明）面读渲染值作为落地证据；浅色面改用 `readCodeBlockBoards()` 的 `half` 口径。**并且同一条要传导到 §6.2**：若按"`block-foreground` 对 `--code-block-bg` ≥ AA"核算，浅色半的底色必须是**混色后的实际值**，拿令牌值当底色会算出一个页面上并不存在的对比度（这条与 Claude 提的"核算范围扩到 3 处判断槽"是两件事，可并列采纳）。

> [!IMPORTANT] §0.7／§2.2／§5 的"**通道 B 一个守卫都没有 / 没有测试资产可加 / 只能靠真机读数（自建探针）**"是过度声明，仓库里已有通道 B 的真引擎 harness（指向 §0.7、§2.2、§5 的 S1/S4 与 §3.6）。`tests/theme-tokens/` 就是它，而且通道 B 需要的能力**全都现成**：`user-theme-style.spec.ts:36-50` 用生产路径 `applyUserTheme({id, css})` 注入任意 `.css` 正文并读回渲染色（`main.ts:667` 的 `format` 默认就是 `'css'`）；`main.ts:316-326` 的 `readSyntaxToken(name)` 逐槽读、`readCodeBlockBoards()` 读容器底、`readWithTheme(...).rendered` 读全令牌。两点结论：(1) §3.6 那次"针对性真机验证"不是唯一通道，S1 的两个未验证项（容器底可达性、`.dark` 与 `:root:not(.dark)` 的相对顺序）可以落成**常驻守卫**而非用后即弃的探针，而它会自动接住上面第一条（形状写错时探针读出非预期色，不会静默通过）；(2) 与之绑定的取舍必须由牵头拍板并改写 §2.2 措辞——加 spec 意味着往 cloudcli 仓库写一个文件，**与 §6.4"cloudcli 仓库保持干净"直接冲突**；且该 spec 只能守**机制**，守不到 dotfiles 里那四个文件的真实取值。所以准确的说法不是"没有守卫"，而是"**现有守卫读不到这四个文件**"——这句话才配得上"只能靠真机读数"这个结论，也才解释得清为什么 §6.1 是主证据。

> [!WARNING] §2.2 一处取证指错了文件（指向 §2.2 第一条非目标）。`src/shared/tests/theme-hardcoded-baseline.json` 当前是 `{"total":0,"byFile":{},"byAtom":{}}`（已清空，是"待迁移"的派生快照）；真正的豁免清单是另一个文件 `src/shared/tests/themeHardcodedAllowlist.ts`，而里面**只有 1 条**（`QuestionAnswerContent.tsx` 的 `border-gray-150`）。`text-blue-600` `text-red-500` `bg-blue-500` `bg-purple-500` **不在任何登记豁免里**——该文件自己的注释写明"扫描器只看中性 utility，状态色 / 品牌色 / 图标色**按构造已在范围外**"（`themeHardcodedAllowlist.ts:1-5` 的文件头注释、`themeHardcodedAtoms.ts`）。结论（不动它们）仍然成立，但理由要换成"按构造不在扫描范围内"，而这反而**更支持**这条非目标：真去动它们，没有任何守卫会拦你。建议按事实改写这两句（顺带 AC：`theme-hardcoded-baseline.json` 是"未做"账、`themeHardcodedAllowlist.ts` 是"永不做"账，两者别混称）。

> [!NOTE] 范围只写了四套，没提同目录下的第五套 `console.css`（指向 §0.7、§2.2、附录 A）。`~/dotfiles/cloudcli/.cloudcli/themes/console.css`（经 `~/.cloudcli/themes` 整目录软链生效）是 379 行 / 77 条声明、`cc-syntax|code-block-bg` 命中 0——它与那四套共用同一条服务端闸门、同一条注入路径、同一个选择器，代码块同样停在 Prism 基色。§0.7 的"改动面：4 个文件"和附录 A 把它静默排除了，§2.2 也没把它列成非目标。它是有选择器的自由式主题（与四套"只换 L1"不同族），大概率就是"有意不做"——但"有意"要写下来。建议在 §2.2 点名它并给理由，否则实施完最可能被追问的就是"为什么 console.css 的代码块还是 One Dark 紫"。

> [!TIP] §4 的来源表只给上游仓库内的路径，没给本机位置或获取方式（我在常见位置也没找到 `vs-visual-studio-code/src/dracula.yml`、`tokyo-night-*-color-theme.json` 这几个参照物）。S2 的产出（四套 × 两外观 × 13 项取值）因此**不可被第三方复核**。建议 S2 落盘时把参照物的**版本 / commit** 与最终取值一起记进对照表，实施时也照 §7 第 5 条把来源写进文件注释——这样 §7 第 5 条"与官方血统有落差"才有个可核的锚点。

> [!NOTE] §8 六项取合的表态：决策 1 同意（只补语法板 ＋ 容器底）；决策 3 同意取前景色为统一默认；决策 2 的"不做 prose"我同意，并把 §3.5 的选择器核过——`.chat-message .prose` 在本仓库确实有既有同类（`src/index.css:597-602`，用户字体设置那一组），`.chat-message .prose a` (0,2,1) 也压得过 Typography 那套 `:where()` 包裹后的 (0,1,0)，所以 §3.6 的"转向"读数可信、将来改判"做"时 S5 有现成锚点（改判前请把"每个主题的 prose 色要自己过 AA"这条并进 §6.2，别只留在"建议不做"的理由里）；决策 4 见上文 CAUTION——**不能按现措辞执行**；决策 5 同意本方案不做，但请把"值按可搬的形状写"与决策 4 的修正对齐（`--code-block-bg` 搬过去本来就是三元组形状，无需为它改）；决策 6 同意，且请把它与上文的透明度事实一起写进 §6.3（浅色变动幅度是"令牌差的一半"，不是令牌差本身）。

### WorkBuddy（二审）

> [!NOTE] 二审范围与交代：只针对**一审回改新写入的内容**（§0.7/§0.8、§1.1 三行、§2.2、§3.2/§3.4、§4、§5 S1/S2/S4、§6.1/§6.2/§6.3、§7、§8 决策 7、附录 A/B）逐条复核，不重复一审已结清项。**两处需要改数/改行号，一处实质缺口需要拍板**；另有三条正面核对与三条可执行建议。上轮我说"参照物在常见位置没找到"是**搜得太浅**（只搜到 4~5 层），一审补的 `~/Projects/open_projects/refs/` 我核了——七个目录都在，那条补充是对的。

> [!WARNING] **实质缺口：改了代码块底，却让它离开了"编辑器页"——这正是 `--code-block-bg` 这条令牌要保证的不变量（指向 §3.2、§6.3，以及 §9 的一句）**。`src/index.css:210-217` 的注释写明这条令牌的关系是"代码块坐落在该外观的**编辑器页**上"，内置主题一律把两者指向同一个色板档（`:1643` / `:1670` 的 `sand-50` / `ink-950`），`tests/theme-tokens/code-block-surface.spec.ts:9-19` 更是**拿 `var(--editor-bg)` 当参照**做断言（"editor 恒 = editor page"）。但基色的 `--editor-bg` **不跟主题走**——`src/index.css:365` 浅色指向纯白（`hsl(var(--palette-white))`，而四套主题都**没有**覆写 `--palette-white`）、`:484` 深色是**字面值** `#282c34`——而四套主题只覆写 L1、不写 `--editor-*`（§9 明说不改）。**于是方案一旦把 `--code-block-bg` 指向主题自己的底色，块与它旁边的编辑器页就分家了**：Tokyo Night 深色下块 `#1a1b26` vs 编辑器页 `#282c34`、Kanagawa `#1f1f28` vs `#282c34`、浅色下块（米黄/冷白/米白）vs 编辑器页纯白——**这正是 B1b 引入这条令牌时想消灭的那种"两块板"**。三种处置需牵头拍板：(i) 把 `--editor-bg` 一并纳入（则 §9 的非目标与"4 文件 × 22 条"的改动面都要重算，还要各自核一遍编辑器侧的可读性）；(ii) **有意接受分家，但必须写进 §6.3 并说明"块不再等于编辑器页"**（我倾向这条：改动面最小、也最诚实，最省事）；(iii) 保持块 = 编辑器页（那等于深色/浅色下都不改底色，与 G1 冲突，不成立）。**另外请纠正 §9 的那句"后者不在用户主题的可达面里"——`--editor-*` 在通道 B 其实可达**：`.css` 是原样注入、服务端闸门不查令牌名、基色 `.dark` 里是**字面值**（不是 `var()`），用户主题的块在文档顺序上更后 ⇒ 写得进去也压得过。所以 (i) 不是"做不到"，是"要不要做"。补一条证据强度提醒：`code-block-surface.spec.ts:33-36` 的 `THEMES` 只遍历 `BUILTIN_THEMES.filter(appearance === 'system')`，**用户主题不在其内**，所以这条不变量在本次改动上不会被任何守卫拦（与 §7 风险 8 是同一件事的两面）。

> [!WARNING] **一审回改自身有三处失准，建议合并成一次勘误（指向 §2.2、附录 A、§3.4、附录 B、§3.3、§3.6、§7）**：
> 1. **`console.css` 的"82 条声明"实测为 77 条**。同一支命令（`grep -cE '^\s*--[a-z0-9-]+\s*:'`）在四套主题上给出的正是 47 条（与附录 A 一致），在 `console.css` 上是 **77**；放宽到"任意位置出现 `--x:`"也只有 **78**，唯名 75。379 行 ✓、24 个规则块 ✓（"带选择器的自由式主题"这个定性也对）。请核对计数方法——这个数字是"有意不做"那条记账的支撑，落不准会让一条正确的决定看起来像估算。
> 2. **`src/shared/syntaxTheme.ts:143` 应为 `:140`**。精确位置：`140:      merged[property] = \`var(${variableName})\`;`；`:143` 是那段"theme omits the property…"的注释。§3.4 第 2 类与附录 B 都用了这个行号。
> 3. **三处交叉引用随 S1 拆分失效**：§3.3"…列为实施第一步的实测项（**§5 步骤 2**）"与 §3.6 边界 2"…列为实施第一步（**§5 步骤 2 / S1**）"都指向一个已不存在的"步骤 2"（§5 现在是 S1–S5 加三个子项）；而 §7 风险 4 的处置写"**S1(b)**"，按新拆分碰 `--code-block-bg` 的是 **S1(a)**（(b) 是语法槽、(c) 才是顺序）。建议三处分别改为 `S1(c)`、`S1(a)`、`S1(a)`。

> [!TIP] **§6.1 第 2(a) 条的"读声明值"要写明走 `getComputedStyle`；并且容器底其实可以直接用引用形态——比新算 hex 更省、形状恒正确（指向 §3.2、§3.4、§6.1-2(a)）**。先说证据：`tests/theme-tokens/token-baseline.json` 全文 **0 处 `var(`**，而它的 `--code-block-bg` 记的是 `"0 0% 100%"`（源码声明偏偏是 `var(--palette-white)`）、`--n-gray-200` 记的是 `"220 13% 91%"`（源码 `var(--palette-gray-200)`）⇒ **自定义属性的计算值会把 `var()` 代换掉**。所以 (a) 对"字面三元组"与"`var()` 引用"两种形态**都成立**，而引用形态恰好是内置主题的写法（`index.css:1643/1670`）。顺着这条我给一个可选简化：**深色半写 `var(--palette-ink-950)`、浅色半写 `var(--palette-sand-50)`**——四套主题的这两个 L1 实测**恰好就是各自的官方底**（Dracula `231.43 14.89% 18.43%`=`#282a36`、Gruvbox `0 0% 15.69%`=`#282828`、Tokyo Night `235 18.75% 12.55%`=`#1a1b26`、Kanagawa `240 12.68% 13.92%`=`#1f1f28`；`sand-50` 即各自浅底）。好处是 §3.2 不必为这条令牌新算 hex、形状天然合法（§7 风险 1 在这条令牌上直接消失）、也不会在 §7 风险 10 的 hsl 损耗账上多背一笔。**注意落点**：若采纳，§6.1-2(a) 的措辞必须从"声明值"改成"**计算值**（`getComputedStyle(document.documentElement).getPropertyValue('--code-block-bg')`，即 `main.ts:519-524` 那一路）"，否则实施者可能去读注入 `<style>` 的 `textContent`（那里是 `var(--palette-ink-950)`），与"裸三元组期望"一比就**假红**。

> [!NOTE] **正面核对：一审查否 Claude 的那条前提成立，我逐处复核了牵头引的每个行号**。`Markdown.tsx:137` 语言标签 `text-muted-foreground`；`:148-151` 复制按钮 `text-muted-foreground` / `hover:text-foreground`，已复制态 `text-green-600 dark:text-green-500`（`:149`）；`:134` 容器 `border border-border`。`MarkdownCodeBlock.tsx:30` 行内 `<code>` 走 `border-n-gray-* / bg-n-gray-100 / text-n-gray-900`；`:48` 语言角标 `text-n-gray-400`；`:60` 复制按钮 `border-border bg-card/90 text-foreground/80 hover:bg-muted`。链路也通：`src/index.css:288-295` 的 `--n-gray-200/400/800/900` **都是 `var(--palette-gray-*)`**，四套主题又都覆写了 `--palette-gray-*` ⇒ 它们确实跟着主题走，不是"停在基色"。`Markdown.tsx` 也**没有行号**（未设 `showLineNumbers`），Claude 点名的"行号"元素不存在。**建议在 §6.1 第 3 条补一句"该块不渲染行号"**，把这条封口——否则下一个读者还会照 Claude 的原话去找那个不存在的元素。

> [!TIP] **S4 的 11 槽核对清单要从产物反推，别手抄 `SYNTAX_SELECTORS`（指向 §6.1 第 1 条、§5 S4）**。仓库里已有一个现成的取样器：`src/modules/chat/tests/markdownSyntaxThemeInjection.test.tsx:36-44` 的 `referencedVariables()`——它渲染真 markdown，再用 `matchAll(/var\((--cc-syntax-[a-z0-9-]+)\)/g)` 从**渲染出的内联样式**里反推"这段代码块实际引用了哪些槽"。用它当清单来源（配一段覆盖全 11 槽的样例：注释 / 标点 / 类名 / 常量 / 数字 / 关键字 / 属性 / 字符串 / 函数 / URL），比手抄 11 个名字多挡住两件事：抄错名（写进去也不生效，且静默）、漏项（清单自己不会喊缺）。同时**该文件是第二个"看得到机制、看不到那四个文件"的 jsdom 守卫**（它还钉住基色表在 `<head>` 最前、以及元素唯一性），§1.1 的 harness 行可以把它一并列上——`src/modules/code-editor/tests/markdownCodeBlockSyntaxTheme.test.tsx` 是编辑器那半的对应物。

> [!TIP] **§8 决策 7 我同意"本次不加"，但请把触发条件写实（指向 §2.2 末条与决策 7）**。现在两个选项的收益差被写成了"机制类错误是常驻拦截还是用后即弃"，落地时容易变成"看心情"。建议写死触发条件，例如："**出现第二次同类形状/顺序错误，或这四套升格为通道 A 时**（后者落地时守卫本就随之内建），才加 spec"。这样 §2.2 的"不加"就带了一条可执行的复评线，而不是一个需要读者相信的偏好。

### Claude（二审）

> [!NOTE] 二审范围与交代：只针对牵头一审批注汇总后的**修订版**复核，重点回答牵头"留给二审与你的问题"第 1/2/3 条。先交代对我一审两条被回应的批注的态度——**批注 9（"内部 UI 停在基色"）我接受核否**：牵头与 WorkBuddy 二审逐处读过 `Markdown.tsx:135-151` 与 `MarkdownCodeBlock.tsx:30,48,60`，语言标签/复制钮/容器边框走 `text-muted-foreground`/`border-border`/`--n-gray-*`（后两者上轮已改过），真正不跟的只有"已复制态"`text-green-600` 状态色，且 **`Markdown.tsx` 根本没有行号**——我原批注点名"行号"是想当然，接受 WorkBuddy 补的"§6.1 写明该块不渲染行号"这条封口；**批注 10（hsl 有损→写 hex）我接受牵头"采纳风险、不采纳换形状"**，"对照表同时留原始 hex＋参照物 commit"确实比我原案更省、也不动摇可搬性承诺。
>
> [!IMPORTANT] **回答牵头遗留问题 2（§3.4 第 3 类的闸门前提是否只在 `.css` 成立）——我读了三个编译入口，确认闸门确实是分路径的**：`.css`（本次走的那条，`userThemeStyles.ts`）"injected verbatim, not compiled here"，不碰白名单，`--code-block-bg` 写 `hsl(hsl(…))` 直接落 `<head>` 产生无效值，**破坏型**；`.json` 走 `compileUserThemeTokens → ruleForToken`，`--code-block-bg` 命中 `SEMANTIC_TOKENS` → `'triplet-or-reference'`，完整 `hsl(…)` 不是 triplet 也不是 `var()` 引用，会像 `#282c34`（`userThemeTokens.test.ts:127-137`）被**忽略**——**drop 型，不破坏**；`.tmTheme` 走 `compileTmTheme`，产出的是规整化的语法声明，用户根本不手写这个令牌。**结论：CAUTION 的"无闸门"只对 `.css` 精确成立，而四条本次都只走 `.css`，所以决策 4 修正依然成立，且被这条差异强化**。建议 §3.4 第 3 类补一句闸门差异记账（`.css` 破坏型 / `.json` drop 型 / `.tmTheme` 非手写面），否则下一位读者会在升格 `.json` 后误以为形状仍有护栏。
>
> [!WARNING] **回答牵头遗留问题 1（§8 决策 7 要不要加守卫 spec）——我明确表态：倾向加**，牵头"不加"的顾虑我也认同，但可以折成一个**窄 spec**。理由：形状地雷（决策 4 的核心）恰恰是"只在 `.css` 无闸门、只被一次性探针防"的那类——`.json` 侧 `triplet-or-reference` 帮它挡了，`.css` 侧谁都不挡，这个不对称正是值得钉的点；一个只跑机制、不碰四文件取值的窄 spec（断言 `.css` 注入路径的形状契约＋`.dark`/`:root:not(.dark)` 顺序）成本约几十行，换 §6.4"cloudcli 仓库干净"一行措辞，性价比高。同意 WorkBuddy 提的触发写实（"第二次同类错误或升格通道 A 才加"）作为**下限**，但我认为"形状地雷已在 json 侧有守卫、css 侧没有"这一条本身已构成**现在**就加的充分理由，不必等到第二次——请用户在决策 7 上定夺，我两可但偏加。
>
> [!NOTE] **回答牵头遗留问题 3（`property` 是否砍回一刀切）——我维持按参照物个别判断**。四套配色普遍有官方变量色（Dracula 有 `constant`/`variable` 之分、Tokyo Night 有独立 variable 色），一刀切前景色会丢掉"变量/属性"这一语义层；S2 多一列判断依据是一次性成本，且 §4 新增的对照表交付物本就是让这个判断可复核的载体，没有额外负担。若牵头评估 S2 工时紧，可折中：只对**确有独立变量色**的参照物做个别判断、没有的退回前景色——但这本质上就是"个别判断"口径，说明砍回去省不了多少。
>
> [!TIP] **补一个牵头问题 2 顺带挖到的点**（供 §9 记账）：`--editor-*` 在 `FAMILY_RULES` 是 `'expression'`（完整值、不强制 triplet）——WorkBuddy 二审说"`--editor-*` 可达"在 `.json` 路径同样成立，不只在 `.css`。所以若牵头将来选方案 (i)（一并纳入 `--editor-bg`），两条导入路径都放行，形状约束不存在；决策权只在"要不要改色板一致"，不卡在闸门——这给 §8 决策 7 / §9 那句"后者不在用户主题的可达面里"的正确表述补了一枚证据。

### 牵头结论

**汇总**：两家共 11 条实质批注 → **采纳 8 条、部分采纳 3 条、完全不采纳 0 条**；另有 1 条事实判断被核否（Claude 的"内部元素还停在基色"）。方案已按采纳结果回改，逐条见下。

#### 一、采纳（8 条）

| # | 来源 | 批注 | 采纳理由与落点 |
|---|---|---|---|
| 1 | WorkBuddy `CAUTION` | `--code-block-bg` 不能写 `hsl()` | **本次一审最有价值的一条，我原方案确有漏洞。** 我把值形状分成"L1 三元组"与"语法槽完整色值"两类，**正好漏掉它所在的第三类**。逐条复现：构建产物 `.bg-code-block\/50{background-color:hsl(var(--code-block-bg) / .5)}`、`src/index.css:212-217` 的注释原文、`MarkdownCodeBlock.tsx:75`、通道 A 的闸门 `userThemeTokens.test.ts:127-137`（`#282c34` 反例）。**落点**：§0 新增第 8 条、§3.2 加形状警告、§3.4 重写为三类形状表、§7 风险 1、§8 决策 4 拆开、**S1(a) 用错形状做证伪实测** |
| 2 | WorkBuddy `WARNING` | "唯一消费者"实为 3 处 | 核实：`Markdown.tsx:134` / `MarkdownCodeBlock.tsx:75` / `MermaidDiagram.tsx:70`，后两者经 `MarkdownPreview` 供编辑器预览。**我另核出一条批注没说透的**：三处的**透明度处置本就不同**（`code-block-surface.spec.ts:12-27` 写明了），所以浅色变更幅度在 chat 是"令牌差的一半"、在编辑器预览是"整个令牌差"。**落点**：§1.1 消费者行、§3.2、§6.3 第 2 条、附录 B |
| 3 | WorkBuddy `WARNING` | §6.1 的渲染值断言在 chat 浅色半不可判定 | 成立。浅色底是 50% 混色，不等于令牌值、还随页面底漂；照字面写要么恒假、要么被写成恒真。**落点**：§6.1 第 2 条拆为 (a) 读 `:root` 字面值 / (b) 落地证据，浅色沿用 `readCodeBlockBoards()` 的 `half` 口径 |
| 4 | Claude `WARNING` | 对比度只核 1 处不够 | 成立，且平移板的危险**不在"抄错色值"而在"取到的成员本身对比不足"**——这一点批注点得准。**落点**：§6.2 扩到 3 槽 × 4 主题 × 2 外观 = 24 组；浅色用混色后的底 |
| 5 | WorkBuddy `IMPORTANT` | "一个守卫都没有"是过度声明 | 成立，我核了 `user-theme-style.spec.ts:36-50` 与 `main.ts:662-690`（`format` 默认 `'css'`），harness 完全具备驱动通道 B 的能力。**落点**：§0.7、§1.1 新增"既有 harness"行、§2.2、§6.1 标题、§2.1 G5、§7 风险 8 —— 口径统一改为"**现有守卫读不到这四个文件**"（见下文"部分采纳"） |
| 6 | WorkBuddy `WARNING` | §2.2 取证指错文件 | 成立。`theme-hardcoded-baseline.json` 现为 `{"total":0,…}`（"尚未做"账），`themeHardcodedAllowlist.ts` 才是豁免清单且**仅 1 条**（`QuestionAnswerContent.tsx` 的 `border-gray-150`），而 `text-blue-600` 等**按构造**在扫描范围外。**落点**：§2.2 该条整段重写，两本账分开；§7 风险 9、附录 B |
| 7 | Claude `IMPORTANT` | 平移板缺"语义→色名"对照表这一产出物 | 成立，"判断藏进 `.css` 注释就不可复核"是要害。**落点**：§4 新增第 4 条记账；S2 改为交付物（先评审后落盘） |
| 8 | WorkBuddy `NOTE` | 第五套 `console.css` 未点名 | 成立。核实为 379 行 / **77** 条声明（二审勘误：本表原写 82，是把注释行也算进去了）/ `cc-syntax|code-block-bg` 命中 0。**落点**：§2.2 点名并给理由（自由式主题、不同族、有意不做）；附录 A 加行 |

#### 二、部分采纳（3 条）

| # | 来源 | 批注 | 采纳部分 / 未采纳部分 |
|---|---|---|---|
| 9 | Claude `WARNING` | 代码块内部其它 UI 未取证，"大概率还停在基色" | **采纳结论**：S4 要覆盖非 token 元素，已写进 §5 S4 与 §6.1 第 3 条。**核否前提**：我逐处读了 `Markdown.tsx:135-151` 与 `MarkdownCodeBlock.tsx:30,48,60`——语言标签走 `text-muted-foreground`、复制按钮走 `text-muted-foreground`/`hover:text-foreground`、容器边框走 `border-border`、行内 code 与语言角标走 `--n-gray-*`，**而 L2 与 `--n-gray-*` 正是我们上一轮已经改过的两族**，所以它们**已经跟着主题走**，不是"停在基色"。真正不跟的只有"已复制"态的 `text-green-600 / dark:text-green-500`（`Markdown.tsx:149`），属按构造在范围内的状态色，已在 §2.2 列明。这条批注的价值在于**把 S4 的验证面扩对了**，但按错误的前提写会误导实施者去"修"本来没坏的东西 |
| 10 | Claude `TIP` | hsl 有损，建议保真优先写 hex | **采纳风险提示，不采纳换形状**。理由：语法槽三类形状都合法（§3.4 第 2 类），写 `hsl()` 与 `index.css` 内置主题的多数写法一致、升格通道 A 时才好搬；漂移改用"§4 对照表同时留**原始 hex** ＋ 参照物 commit SHA"抵掉——这比换 hex 更便宜，也不动摇 §0.7 的可搬性承诺。已列 §7 风险 10、§8 决策 4 的备注 |
| 11 | WorkBuddy `IMPORTANT` 的推论 | "S1 的两个未验证项可以落成常驻守卫" | **采纳"可以"这个事实，不采纳"本次就加"这个动作**。加 spec 要往 cloudcli 仓库写文件，与 §6.4"cloudcli 仓库保持干净"直接冲突，且守卫只能守机制、守不到 dotfiles 里那四个文件的取值。这不是我单方能定的取舍，**已升级为 §8 决策 7** 交给你拍板：加，则同步改写 §2.2 与 §6.4 |

#### 三、两位同意的其余表态（无需改文，记录在案）

- **决策 1**（只补语法板 ＋ 容器底）：双方同意。
- **决策 2**（prose 不做）：双方同意。**Claude 的唯一附加条件已并进 §6.2**——将来若改判"做"，每个主题的 prose 色要各自过 AA，不能只留在"建议不做"的理由里。
- **决策 5 / 6**：同意。**决策 6 的可见变更已按 WorkBuddy 的提醒写进 §6.3，并按第 2 条的修正把幅度差异分开记**。
- WorkBuddy 顺带核过 `§3.5` 的选择器（`.chat-message .prose` 在本仓库有同类先例 `src/index.css:597-602`），确认 §3.6 的"转向"读数可信——这条我保留原判，未改。

#### 四、本次修订清单（供二审 diff 对照）

| 节 | 修订性质 |
|---|---|
| 头部 | 状态改"一审已汇总并回改，待二审"，加修订日期 |
| §0 | **新增第 8 条**（形状地雷）；第 7 条改写（守卫口径 ＋ console.css） |
| §1.1 | "唯一消费者"行重写为 3 处；**新增"既有真引擎 harness"行** |
| §2.1 | G5 口径改为"现有守卫读不到这四个文件" |
| §2.2 | 硬编码原子条**整段重写**（两本账）；**新增 console.css 非目标**；"不加测试资产"条改写 |
| §3.2 | 加形状硬约束与三处透明度差异 |
| §3.4 | **重写为三类形状表** ＋ 取值建议；缺槽口径三条分别化（`property` 改为个别判断） |
| §4 | 加本机参照物位置与 commit 要求；**新增第 4 条记账**（对照表作为交付物） |
| §5 | S1 拆三子项（含形状证伪）；S2 改为交付物；S4 扩验证面；顺序理由更新 |
| §6.1 | 标题口径改；`--code-block-bg` 断言**拆为 (a)(b)**；**新增第 3 条**（非 token 元素） |
| §6.2 | **范围从 1 处扩到 24 组**；加"浅色用混色底" |
| §6.3 | 加消费者范围与**幅度差异**说明 |
| §7 | 风险表**重排为 10 条**，形状风险置顶 |
| §8 | **决策 3 修正**（`property` 个别判断）；**决策 4 修正**（非取舍，是契约）；**新增决策 7**（要不要加守卫 spec） |
| 附录 A / B | console.css 加行；**新增 5 条证据**（形状、闸门、3 消费者、两本账、harness） |

#### 五、留给二审与你的问题

1. **§8 决策 7（新增）**：要不要为通道 B 加一个常驻守卫 spec？我倾向不加（保 §6.4 干净），但这条会改变"形状写错只能靠一次性探针发现"的处境，值得你定。
2. **§3.4 第 3 类**是本轮新增的硬约束，**请二审重点复核它**——尤其"通道 B 无闸门"这个前提是否只在 `.css` 路径成立（`.json` 与 `.tmTheme` 两条导入路径的闸门是否也不同，本文未展开）。
3. Claude 提的"`property` 按参照物个别判断"意味着 S2 的工作量上升，**S2 的对照表会因此多一列判断依据**——若你认为不值，可在二审改回"一刀切前景色"。

---

### 牵头结论（二审汇总）

**汇总**：第二轮两家共 **5 条实质批注（WorkBuddy 5 ＋ Claude 4，其中 4 条是回答我留的三个问题）** → **采纳 4 条、部分采纳 1 条、完全不采纳 0 条**；另有 **3 处我自己一审回改的失准被勘误**，已全部修正。**本轮出现一条新的实质设计缺口（`--code-block-bg` 的不变量偏离），是本轮最重要的发现。**

#### 一、采纳（4 条）

| # | 来源 | 批注 | 采纳理由与落点 |
|---|---|---|---|
| 1 | WorkBuddy `WARNING` | **代码块底板与编辑器页分家**（实质缺口） | **成立，且本轮最重要。** 逐处复现：`--code-block-bg` 的不变量注释在 `src/index.css:210-217`，内置主题两侧同指一档（`:1642`/`:1643`、`:1669`/`:1670`），而基色 `--editor-bg` **浅色**是 `hsl(var(--palette-white))`（`:365`，四套主题都不覆写 `--palette-white`）、**深色**是字面值 `#282c34`（`:484`）⇒ 我把底板指向主题色之后，块与页确实分家。**落点**：§0 新增第 9 条、§3.2 末段、§6.3 **新增第 4 条**、§7 **新增风险 11**、**§8 新增决策 8**、附录 B +2 条证据 |
| 2 | WorkBuddy `TIP` | 容器底**直接用引用形态**（`var(--palette-sand-50)` / `var(--palette-ink-950)`），并写明读**计算值** | **成立，且是纯收益，直接改写 §3.2 的落盘形状。** 我核过四套主题的 `ink-950` / `sand-50` 实测**恰好就是各自官方底**（`#282a36` / `#282828` / `#1a1b26` / `#1f1f28` 与各自浅底），且内置主题的 `--code-block-bg` 写法就是 `var(--palette-*)`。于是：**风险 1（形状写错 → 底板全丢）在这条令牌上结构性归零**、不必新算 hex、升格通道 A 时零改动。读值侧的证据我也核了——`tests/theme-tokens/token-baseline.json` 全文 **0 处 `var(`**，其 `--code-block-bg` 记作 `"0 0% 100%"` 而源码是 `var(--palette-white)`，证明**计算值会代换 `var()`**，所以 §6.1 第 2(a) 已改成读 `getComputedStyle` 的**计算值**，并写明"别读 `<style>.textContent`，那里是 `var(...)`，一比就假红" |
| 3 | Claude `IMPORTANT` | 闸门**分路径**（`.css` 破坏型 / `.json` drop 型 / `.tmTheme` 非手写面） | **成立，回答了我的遗留问题 2。** 我核了 `userThemeStyles.ts:95` 的注释原文（*"a `.css` file verbatim, a `.json` one compiled"*）与 `:213`/`:216` 两条编译入口。**落点**：§3.4 第三类下**新增闸门差异表**。这条同时强化了决策 4 的修正理由（`.json` 有护栏、`.css` 没有） |
| 4 | WorkBuddy `NOTE` ＋ `TIP` | ①"该块不渲染行号"要封口；②11 槽清单应从产物反推 | **两条都成立。** ①我核了 `Markdown.tsx` 未用 `showLineNumbers`，一审 Claude 点名的"行号"元素确实不存在，已在 §6.1 第 3 条封口。②`referencedVariables()` 确实在 `src/modules/chat/tests/markdownSyntaxThemeInjection.test.tsx:36`，编辑器侧对应物 `markdownCodeBlockSyntaxTheme.test.tsx` 也在 —— 已写进 §6.1 第 1 条与 §5 S4，并把这两个 jsdom 守卫补进 §1.1 的 harness 行（**它比我原表更完整：通道 B 的守卫有 e2e ＋ jsdom 两半**） |

#### 二、部分采纳（1 条）

| # | 来源 | 批注 | 采纳 / 未采纳 |
|---|---|---|---|
| 5 | Claude `WARNING` | 决策 7 **倾向"现在就加"**守卫 spec | **采纳其论据，不采纳其时点。** 论据（`.json` 侧有 `triplet-or-reference`、`.css` 侧没有 ⇒ 不对称值得钉）成立；但**采纳批注 2 之后这道地雷已用引用形态结构性消除**（不再是"靠人记得别写 hsl()"），剩下的顺序类地雷由 **S1(c)** 一次性验掉，于是"现在加"的紧迫性大幅下降。仍按 WorkBuddy 的写法**把触发条件写死**（第二次同类错误 / 升格通道 A），**并如实记下二位在此分歧**（§8 决策 7 备注）。这条最终要你定 |

#### 三、被勘误的三处（我自己的失准，全部已修）

| # | 位置 | 原写 | 实测 | 已修 |
|---|---|---|---|---|
| 1 | §2.2 / 附录 A / 一审结论 | `console.css` = **82** 条声明 | **77** 条（`grep -cE '^\s*--[a-z0-9-]+\s*:'`；同命令在四套主题上正好各 47，与我原表一致） | 三处全改，并注明原 82 是把注释行也算进 `grep -c '^\s*--'` |
| 2 | §3.4 第 2 类 / 附录 B | `syntaxTheme.ts:143` 写入 `merged[property] = var(...)` | 该语句在 **`:140`**；`:143` 是"theme omits the property…"那段注释 | 已改 |
| 3 | §3.3 / §3.6 / §7 风险 4 | 分别指向"§5 步骤 2"（已不存在）、"§5 步骤 2 / S1"、"S1(b)" | §5 现在是 S1–S5 ＋ 三子项；碰 `--code-block-bg` 的是 **S1(a)**、顺序是 **S1(c)** | 三处分别改为 `S1(c)`、`S1(a)`、`S1(a)` |

#### 四、二审回改清单（供定稿 diff 对照）

| 节 | 修订性质 |
|---|---|
| 头部 | 状态改"二审已汇总并回改，待定稿"，修订日期补记两轮 |
| §0 | 第 8 条补"引用形态让风险 1 结构性归零"；**新增第 9 条**（不变量偏离） |
| §1.1 | harness 行拆成 **e2e ＋ jsdom 两半**，补 `referencedVariables()` 与编辑器侧对应物 |
| §2.2 | console 77 勘误；"不加测试资产"条补触发条件；**新增"不动 `--editor-*`"条** |
| §3.2 | **落盘形状整段改写为引用形态** ＋ 四套主题实测底 hex ＋ **新增分家说明** |
| §3.3 | 新增块示例改用引用形态；`§5 步骤 2` → `S1(c)` |
| §3.4 | 第 2 类行号勘误；**新增闸门差异表**；取值建议按引用形态改写 |
| §3.6 | `§5 步骤 2 / S1` → `S1(a)` |
| §5 | S1(a) 改为"可达性 ＋ 形状证伪"两步；S2 标注引用形态不计入新算；S3 补分家记账；S4 补取样器 |
| §6.1 | 第 1 条补取样器反推清单；第 2(a) 改**计算值** ＋ 假红警示；第 3 条补"该块不渲染行号" |
| §6.3 | **新增第 4 条**（不变量偏离）＋ 幅度差异实写 |
| §7 | 风险 1 补"已结构性消除"；风险 4 改 `S1(a)`；风险 10 排除该令牌；**新增风险 11** |
| §8 | 决策 4 改引用形态；**决策 7 补触发条件 ＋ 记分歧**；**新增决策 8** |
| §9 | **勘误"`--editor-*` 不在可达面"** —— 可达，`console.css` 已写 27 条为证 |
| 附录 A / B | console 77 勘误；**新增 6 条证据**（闸门分路径、计算值代换、分家、四套底值、console 的 editor 先例、无行号） |

#### 五、留给定稿与你的问题

1. **§8 决策 8（本轮新增，最需要你拍板）**：代码块底板与编辑器页分家，**(ii) 接受 ＋ 记账**（我倾向）还是 **(i) 一并纳入 `--editor-*`**？(i) 的可行性已确认（两条导入路径都放行、`console.css` 有 27 条现成先例），但它会把改动面从"4 文件 × 22 条"吹到**数倍**，且含边框表达式这类不同形状的值，编辑器面板还要各自过可读性——我认为那是**另一份对称的姊妹方案**，不该塞进这一份。
2. **§8 决策 7**：WorkBuddy 与我倾向"不加、写死触发条件"，**Claude 二审倾向"加"**。二位分歧已如实记在方案里，等你定。
3. **已可进入实施**：若决策 8 选 (ii)、决策 7 选"不加"，则本轮修订后方案**无未决的技术前提**，可直接从 §5 S1 开始（S1 会把最后两个未验证项——容器底可达性、引用形态形状——用真机读数钉死）。

---

### 定稿裁定（用户拍板，2026-09-29）

**两项决策已定：**

| # | 决策 | 裁定 | 连锁修订 |
|---|---|---|---|
| **7** | 要不要往 cloudcli 仓库加常驻守卫 spec | **加** —— 只守机制的**窄 spec**（§5 S6） | §0 第 7 条、§2.2、§5（改动面 ＋ S6 ＋ 顺序理由）、§6.4、§7 风险 1 / 8 / 11、附录 A |
| **8** | 代码块底板与编辑器页分家 | **(ii) 有意接受 ＋ §6.3 记账** | §0 第 9 条改"已裁定"；§8 决策 8 同 |

**spec 的边界（实施时必须守住，防范围蔓延）**：

1. **只断言机制**：`.css` 路径下 `--code-block-bg` 的形状契约（`hsl()` 失效 / 裸三元组与 `var()` 生效）＋ `.dark` 与 `:root:not(.dark)` 顺序不敏感。
2. **不读 dotfiles**：不断言"四套主题的取值等于某色"——那会把 `~/dotfiles` 的路径依赖带进 cloudcli CI。
3. **不覆盖分家**：决策 8 选 (ii) 后，"块 ≠ 页"是**有意接受**的行为，spec 不应把它钉成失败用例。
4. **由此产生的口径变化**：§6.4 的"cloudcli 仓库保持干净"放宽为"**只新增这一个 spec**"；§2.2 的"不加测试资产"改为"**加且只加一个机制守卫 spec**"，且**不替代** §6.1 的真机逐槽读数（后者仍是取值层的唯一证据）。

**一处措辞收紧**：§0 第 9 条原写"本文的处置是有意接受"，现改"已裁定 (ii)"，避免读者误以为仍待定。

---

### S1 执行记录（2026-09-29）

**手段**：`tests/theme-tokens/` 下临时 spec `zz-s1-mechanism.spec.ts`（5 个 test，chromium 单项目，跑完即删），走既有 harness 的 `applyUserTheme` / `readWithTheme` / `readCodeBlockBoards` / `readSyntaxToken` —— 不写仓库文件、不新增机制。**结果 5/5 通过（2.3s）**。

| 子项 | 注入形态 | 读数 | 结论 |
|---|---|---|---|
| **(a1) 引用形态可达** | `--code-block-bg: var(--palette-ink-950)`（同时声明该 L1 为 Dracula 值） | dark：`editor=rgb(40, 42, 54)`、`chat=rgb(40, 42, 54)`、`half=rgba(40, 42, 54, 0.5)`；light：`chat=half=rgba(40, 42, 54, 0.5)` | ✅ **可达** |
| **(a2) 裸三元组可达** | `--code-block-bg: 231.43 14.89% 18.43%` | dark：`editor=rgb(40, 42, 54)` | ✅ **可达** |
| **(a3) 形状证伪** | `--code-block-bg: hsl(231.43, 14.89%, 18.43%)` | dark：`editor=rgba(0, 0, 0, 0)`、`chat=rgba(0, 0, 0, 0)`、`half=rgba(0, 0, 0, 0)` | ✅ **确证底板消失，且三层不报错**（§3.4 第三类、§7 风险 1 —— 从推演升级为实测） |
| **(b) 语法槽两外观分别生效** | `:root{--cc-syntax-keyword-color:hsl(96,60%,40%)}` ＋ `.dark{…:hsl(200,100%,50%)}` | 基色 `rgb(166, 38, 164)` → light `rgb(90, 163, 41)`；基色 `rgb(198, 120, 221)` → dark `rgb(0, 170, 255)` | ✅ 分别生效、互不相同 |
| **(c) 顺序不敏感** | 同两块，`[light, dark]` 与 `[dark, light]` 两种排列 | 两种排列均为：light `rgb(255, 251, 235)`、dark `rgb(40, 42, 54)`，**逐位相同** | ✅ 顺序不影响 |

**顺带读到的两条对账证据**（不是本次要答的问题，一并记下以备 §6.3 / §6.1 引用）：

1. **决策 8 的分家在真机上成立**：`readCodeBlockBoards().reference`（＝`var(--editor-bg)`）dark 下读 `rgb(40, 44, 52)`（`#282c34`，字面值）、light 下读 `rgb(255, 255, 255)`（`--palette-white`）；而 `editor`（＝`hsl(var(--code-block-bg))`）被主题接管后是另一值 ⇒ **块 ≠ 页**，与 §6.3 第 4 条的记账一致。
2. **浅色 chat 的半透明形态被实测确认**：light 下 `chat=rgba(40, 42, 54, 0.5)` 对 `editor=rgb(40, 42, 54)`（不透明），dark 下两者相同 —— 这正是 §6.3 第 2 条"幅度在三处消费者之间不同"的机制来源。

**对 S6 的直接用处**：a3 那格的期望读数（`editor=rgba(0, 0, 0, 0)`）与 c 格的"两种排列逐位相同"，可直接作为 S6 守卫的断言基线，不必再摸索。

---

### S2 执行记录（2026-09-29）

**交付物**：§10 的四张对照表（4 主题 × 2 外观 × 13 项 = 104 格，其中 `--code-block-bg` 8 格走引用形态 ⇒ **88 格 hex→hsl**）＋ 24 组 §6.2 对比度读数。

**参照物（本机浅克隆在 `~/Projects/open_projects/refs/`，commit 已写进 §10 每张表头）**：

| 主题 | 参照物仓库 | commit |
|---|---|---|
| Dracula（暗） | `vs-visual-studio-code`（`src/dracula.yml`） | `a08a206f2c8420ba3c05f0e8d01d43b2f933fdf8` |
| Dracula（浅 Alucard） | `dracula-theme`（`README.md` 色板，无官方语法分配 ⇒ **平移**） | `1e04a4b768302fa2de37d09cc7b8087eabcd3ed8` |
| Gruvbox（暗 / 浅） | `gruvbox`（`colors/gruvbox.vim`，`bright_*` / `faded_*`） | `ef8864bb42bf244f0295d1c5a403b27e3d139695` |
| Tokyo Night（暗 / 浅） | `vs-tokyo-night-vscode-theme`（两份主题 JSON 的 `tokenColors`） | `7c0f11eaef322f293621ca7befe462214b7ea468` |
| Kanagawa（暗 wave / 浅 lotus） | `kanagawa.nvim`（`themes.lua` 的 `syn` 角色表 ＋ `colors.lua`） | `bb85e4bfc8d89b0e62c8fa53ccdd13d12e2f77b3` |

**逐位校验**：文档里的 88 个 `hex → hsl` 对**全部由脚本算出、逐位比对为 0 不一致**（含反向检查：脚本里每条都能在文档中找到）。

**结果**：

1. **§6.2 的 24 组 AA 全部达标**，最低为金川浅色 `property` **4.54:1**。
2. **1 处造值**：金川浅色 `property`（官方 `#77713f` 仅 4.15:1 ⇒ 压暗至 `#706b3b`）。已写进 §7 风险 12 与 §10.6 第 1 条。
3. **3 处按槽判断**（非抄写）：Dracula 的 `class-name` 取青（官方如此，非 One Dark 的黄）；Tokyo Night 的 `url` 取操作符族（青被 `property` 占用）；Kanagawa 的 `url` 取 `syn.operator`（链接色在 lotus 浅底上仅 2.70:1）。三条都在 §10.4 表下注。
4. **`punctuation` / `property` / `block-foreground` 三槽按 §3.4 的三条口径取**，其中 Dracula 三槽同值（其官方即如此），Gruvbox 的 `function` 与 `string` 同值、`number` 与 `constant` 同值（派生，非漏做）。
5. **没有改动任何主题文件**；`--code-block-bg` 仍按 §3.2 走 `var(--palette-ink-950)` / `var(--palette-sand-50)`，不新算色值。

**下一步**：§10 交牵头逐套评审（或再走一轮批注）。**2026-09-29 牵头裁定：不另走批注、直接进 S3**，并当场改判落盘形态为 hex（见 §3.4 勘误与下节）。

---

### S3 执行记录（2026-09-29）

**改动**：`~/dotfiles/cloudcli/.cloudcli/themes/` 下四份 `.css`（经 `~/.cloudcli/themes` 整目录软链生效），各追加两个外观作用域块（`:root:not(.dark)` / `.dark`），每块 12 条（`--code-block-bg` ＋ 11 槽）⇒ **每文件 +24 条、四文件共 +96 条**；并在每份文件的头部注释里补了形状契约与 §6.3 第 4 条的分家记账（按各主题的实际幅度分开写：Dracula / Gruvbox 深色对编辑器页只差 2 / 4 个 RGB 级、肉眼不可见，Tokyo Night / Kanagawa 则明显更深）。**既有 47 条 L1 声明一字未动。**

**落盘形态勘误（本次唯一的范围外变动，已获牵头当场拍板）**：§3.4 原写"语法槽统一 `hsl()`，**与 `index.css` 里内置主题的多数写法一致**"。实施时逐条核对 `src/index.css`：**内置主题的 55 条 `--cc-syntax-*` 全部是 hex，一条 `hsl()` 都没有** —— 该理由不成立，写 `hsl()` 反而是唯一偏离先例的写法，还要平白背上 hex → hsl 的单向损耗。故落盘改为 **hex（统一小写）**，并同步修正 §3.4、§4 第 4 条、§5（改动面 ＋ S2）、§6.1 第 1 条、§7 风险 1 / 10 / 12、§8 决策 4、§10 开头与四个表头。连带效果：**§7 风险 10 从"记账接受"变为"已消除"**。另勘误 §5 的改动面（初写"× 22 条"，与括注算式 12 × 2 不符，实际 **24 条**）。

**校验（脚本 `/tmp/s3_check.py`，以 §10 四张表为期望值源；临时资产，跑完不留仓库）**：**24 项全绿**。

| 检查项 | 结果 |
|---|---|
| 块序列 | 四份均为 `[:root, :root:not(.dark), .dark]` |
| L1 块 | 47 条，**名称集合与编辑前逐项一致** |
| 两个新块 | 各 12 条；`--code-block-bg` = `var(--palette-sand-50)` / `var(--palette-ink-950)`（引用形态） |
| 88 格槽值 | 与 §10 表**逐值一致**（大小写归一后比对） |

**未做 / 下一步**：S4 的真机逐槽读数（含代码块内非令牌元素与编辑器预览）；S6 的守卫 spec（决策 7 已裁"加"，另起）。**截至本片，四套主题尚未在真机复验** —— S1 验的是机制、S3 落的是取值，两者合起来才构成 S4 的比对基线。**（S4 已于同日结清，见下一节；本段是 S3 当时的快照，保留不改。）**

---

### S4 执行记录（2026-09-29）

**改动**：**无**。S4 只读数，四套主题文件在 S4 期间一字未改 —— 所以"落盘值兑现"这件事是拿**未改动**的文件验的。

**取证方式**：三份**一次性**临时资产，跑完即删（§6.5 要求仓库不留探针）。

| 资产 | 落点 | 干什么 |
|---|---|---|
| 取样器 | `src/modules/chat/tests/zz-s4-slot-list.test.tsx`（jsdom） | 渲染一段覆盖全槽的 markdown（ts / css / bash / json / md 五段围栏），用 `referencedVariables()` 从**渲染出的内联 style** 反推 `--cc-syntax-*` 清单 |
| 读数 spec | `tests/theme-tokens/zz-s4-readback.spec.ts`（playwright） | 经生产路径 `applyUserTheme({id, css})` 注入四个真文件，逐槽读渲染值，与 **§10 四张表**比对 |
| 截图 spec | `tests/transcript-layout/zz-s4-shots.spec.ts`（playwright） | 挂**真 `ChatMessagesPane`**，按生产同形注入主题，读代码块内部的非令牌元素并截图 |

**期望值来源**：脚本 `/tmp/gen/s4_expect.py` 从**文档 §10.1–10.4 的四张表**里抽 88 格 hex。**刻意不从 `.css` 回读** —— 那样就是自证；文档是独立的一路。

**结果：双引擎（chromium ＋ webkit）全绿。**

| # | 检查项 | 结果 |
|---|---|---|
| 1 | 四套 × 两外观 × 11 槽的**渲染值** vs §10 期望 | **88/88 全等**。两侧都过引擎（期望 hex 与实测都读成 `rgb()`）再比，不是拿 hex 字符串比 |
| 2 | 槽清单从产物反推 | 反推出 **11 个稳定名**，与 `SYNTAX_SELECTORS` **逐个对上**（`comment`/`punctuation`/`class-name`/`constant`/`number`/`keyword`/`property`/`string`/`function`/`url`/`block-foreground`）；另有一批无名编号槽（`--cc-syntax-5/26/36/…`）随之浮现，它们是差异序列里的非契约槽，符合预期 |
| 3 | `--code-block-bg` 计算值 == `var()` 指向的 L1 令牌 | **8/8 相等**（浅色 `sand-50`、深色 `ink-950`）；`getComputedStyle` 确实把 `var()` 代换掉了（读到的都是裸三元组） |
| 4 | 代码块底 == 页面底（§6.2 口径前提） | **8/8 相等**（`rgb(255,251,235)` / `rgb(40,42,54)` / `rgb(251,241,199)` / `rgb(40,40,40)` / `rgb(225,226,231)` / `rgb(26,27,38)` / `rgb(242,236,188)` / `rgb(31,31,40)`） |
| 5 | 代码块内**非令牌元素**跟主题（有主题 vs **无主题基线**） | **全部 moved**：`--muted-foreground` / `--border` / `--foreground` / `--n-gray-100/200/400/800/900` 逐套逐外观都被主题改动。**唯一 `SAME` 是浅色下的 `--card`**（`hsl(var(--palette-white))`，四套都没覆写 `--palette-white`）—— 这是 §9 记过的已知前提，不是回归 |
| 6 | 真实 chat 代码块（`ChatMessagesPane`）的底板 | **8/8** 等于 `hsl(--code-block-bg / .5)`（浅色）或 `hsl(--code-block-bg)`（深色），逐位相等 |
| 7 | 真实 chat 的容器边框 / 语言标签 / 复制按钮 / 代码前景 | 逐套不同，全部跟着主题走（例：`--cc-syntax-block-foreground` 深色下读出 `#f8f8f2` / `#ebdbb2` / `#a9b1d6` / `#dcd7ba`，与 §10 四张表的 `block-foreground` 格逐位一致） |
| 8 | 行号元素 | **不存在**（`Markdown.tsx` 未用 `showLineNumbers`）—— 与 §6.1 第 3 条的"封口"一致，一审点名要找的元素确实没有 |
| 9 | "已复制"态（`text-green-600 / dark:text-green-500`） | 8/8 都点进了 green 态，**未被主题带坏**；它按构造不跟主题（§2.2），如实达成"无意外失配" |
| 10 | §6.3 第 4 条的"块 ≠ 编辑器页" | **真机复现**：编辑器页在两个外观下都停在 `rgb(40,44,52)` / `rgb(255,255,255)`，而四套的块底是各自的 `ink-950` / `sand-50` —— 记账为真 |

**S4 踩到并补进文档的坑（1 处，已写进 §6.1 第 4 条与 §7 风险 13）**：**过渡进行中读 `getComputedStyle` 会拿到插值**。首版读数里 `--code-block-bg` 的计算值已是主题深底，底板却读出 `rgba(255,254,250,.5)` —— 正好是基色白到主题沙色之间 25% 处。看着像"底板没跟上"，实为读数时机问题。**关键细节**：事后注入 `transition-duration:0s` **不能取消已经在跑的过渡**（规范明说改 `transition-*` 不影响进行中的过渡），必须**等 `document.getAnimations()` 空**再读。仓库现存探针靠显式 `transition: none` 规避，`readTokens` 的令牌枚举却是在真元素上读的 —— 自建读数脚本要自己补这一手。

**顺带产出的一条正面结论**：四套主题让**代码块底恰好等于页面底**（浅色同取 `sand-50`、深色同取 `ink-950`），所以 chat 浅色半那个 `/50` 的不对称在**这四套主题下视觉为零**（50% 叠在自身之上仍是自身），§6.2 用令牌原值算的 24 组对比度就是页面上的实际值；真正可见的变化集中在编辑器预览那半（不透明，从纯白变主题色温）。已补进 §6.2 与 §6.3。

**未做 / 下一步**：**S6**（决策 7 已裁"加"）——把 S1 的机制结论固化为常驻窄 spec（形状契约 ＋ 外观块顺序），建议名 `user-theme-shape-contract.spec.ts`，基线可用 S1(a3) 的 `rgba(0,0,0,0)` 与 S1(c) 的"两种排列逐位相同"。**S5 仍未触发**（§8 决策 2 判"不做"，§6.3 第 3 条不适用）。仓库侧：cloudcli 只多了本文档，没有其它改动（三份临时资产已删）。**（S6 已于同日结清，见下一节；本段是 S4 当时的快照，保留不改。）**

---

### S6 执行记录（2026-09-29）

**改动**：**只新增 1 个文件** —— `cloudcli/tests/theme-tokens/user-theme-shape-contract.spec.ts`（3 个 test）。四套主题、`src/` 与其余测试**一字未动**；`git status --short` 恰为两行（本文档 ＋ 新 spec），§6.4 的承诺**逐字达成**。

**spec 内容**：只守机制、不读 dotfiles（无 `fs`），故与主题取值解耦。断言三条：

| # | 断言 | 用什么值 | 对照（防"真空通过"） |
|---|---|---|---|
| 1 | **两种合法形态等价**：`var(--palette-sand-50)`（并当场种下该 L1）与裸三元组 `120 60% 40%` / `240 60% 40%` 解出**同一块板**，且四路读数逐位等于手上算的 `rgb(41,163,41)` / `rgba(41,163,41,0.5)` / `rgb(41,41,163)` / `rgba(41,41,163,0.5)` | 取**调色板里没有的颜色**，命中只可能来自注入的 sheet | 先断言注入后 `styleCount === 1`（sheet 真在文档里），否则读的是基色 |
| 2 | **错形状静默失效**：`--code-block-bg: hsl(120, 60%, 40%)` ⇒ `editor` / `chat` / `half` **全部** `rgba(0, 0, 0, 0)`；同时 `styleCount === 1`、`state === { appliedId, failedId: null, warnings: [] }` | hsl 形态 | 读之前先测**未主题化**的 `editor` ≠ `rgba(0,0,0,0)`，证明透明是这张 sheet 造成的 |
| 3 | **外观块顺序不敏感**：`[light, dark]` 与 `[dark, light]` 两种排列下，两外观的读数 `toEqual` | 同 #1 的两个三元组 | 先断言 `light.editor !== dark.editor`，否则一份**没做作用域区分**的表也能通过 `toEqual` |

**结果：6/6 通过（chromium ＋ webkit，2.6s）；`theme-tokens` 全套 174 passed（此前 168＋新 6），无回归。**

**变异检验（证明这三条断言不是真空通过）**：把注入 sheet 里的令牌名临时写成 `--code-block-bgz`，test 1 **当场失败**，报的是"两种形态解不出同一块板"，`Expected/Received` 差 3 处 —— 也就是说"令牌名写错 → 悄悄读成基色"这条最安静的失败路径被拦住了；改回后 6/6 复绿。仓库无残留（变异用的副本已删，`test-results/` 在 `.gitignore` 内、已清）。

**照 S1 基线的对账**：test 2 的期望值用的正是 S1(a3) 的 `editor = rgba(0, 0, 0, 0)`，test 3 用的正是 S1(c) 的"两种排列逐位相同" —— **S1 的一次性读数就此转为常驻断言**，§7 风险 1 / 8 的"用后即弃"缺口关闭。

**与 S4 的分工（如实记清，别混为一谈）**：这个 spec 守的是**机制**；S4 那 88 格逐槽渲染值才是**取值**的证据，两者不可互替 —— 本 spec 全程不碰 `~/.cloudcli/themes/`，把主题文件全删了它照样绿（那时它验的是"`.css` 路径的形状契约是否还成立"，而不是"主题写对了没"）。

**未做 / 待决**：`tests/theme-tokens/tsconfig.json` 的 `include` **未登记本 spec**（§6.4 约束"不动其它文件"）。本次类型检查是**临时登记后跑过再回滚**（`npm run typecheck:theme-tokens` 通过），但长期看这个 spec 与**此前 7 个未登记的 spec**（`code-block-surface` / `contrast` / `first-paint` / `token-preview` / `user-theme-style` / `user-theme-syntax` / `user-theme-tokens`）都不在 `typecheck:theme-tokens` 的覆盖面里 —— 属既有缺口，未顺手修（§3 的外科手术原则），已记在 §6.4。
