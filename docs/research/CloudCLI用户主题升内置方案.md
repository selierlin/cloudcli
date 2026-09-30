# CloudCLI 用户主题升为内置主题方案

> **状态**：**已实施完毕（2026-09-30）**（定稿 2026-09-30：一审 Claude 5 条 ＋ WorkBuddy 10 条，二审 Claude 13 条，三审 Claude 5 条，四审 Claude 5 条；**同日用户已对剩余待决表态，待决清零**）。逐条裁定与理由见文末「牵头结论（一审）～（四审）」；§10 为定稿后追问"约束还能放开吗"的附带盘点。**§7 主流程 1–6 全绿**（契约 **198 passed**；变异 M1–M5 ＋ 负对照 M3″ 全部按预期；静态核对 **561/0**；四条新规则块入包、CSS 增量 **+23,832 B**；`lint` 153/0、`typecheck` ×2 与 `build:client` 均 exit 0、`test:client` **150 文件 / 1240 全过**），**另撞到两处本方案没写到的门槛**（`neutralScale.test.ts` 的"全文最后一次声明赢"、原子守恒扫描器把**注释**里的类名也算进去），均已修好并记入文末「实施记录（2026-09-30）」。§9 收尾清单：第 1、2、3、5 条已办，第 4 条（上一片遗留的两笔独立提交）与第 6 条（`console.css` 的独立线）按原文归属另办。本文件是**决策件 ＋ 实施依据**。
> **范围**：把 `~/.cloudcli/themes/` 下的四套用户主题（`dracula` / `gruvbox` / `kanagawa` / `tokyo-night`）升为**产品内置主题**，并为此对「覆盖层契约」做**一处**最小放松。
> **仓库**：主改动在 `cloudcli`（`src/index.css`、`src/shared/constants.ts`、`tests/theme-tokens/`）；四套主题文件的可编辑真源在 `dotfiles`（`cloudcli/.cloudcli/themes/*.css`，经 stow 折叠进 `~/.cloudcli/themes/`）。

---

## 0. TL;DR

| 项 | 结论 |
|---|---|
| 该不该放松守卫 | **该，但只放松一条**：兼容灰阶 `--n-gray-*` 从「所有主题禁移」改为「**仅 `accent` 主题禁移**」 |
| 该不该放松 `full` 的 editor / graph 必移项 | **不该**——那是 **16 个有现成配方的值**，不是新设计（见 §3.2） |
| 四套主题要补什么 | editor 6 槽（浅色实补 5、深色实补 6）＋ graph 10 条 lane（保色调、重调 S/L）＝ **21 条/套 × 4 套 ＝ 84 条** |
| 范围边界 | **契约侧**：`accent` 的禁移收**兼容层四族 44 档**（`gray` ＋ `zinc`/`slate`/`neutral`，共 1380 站点）；**主题侧**：四套主题仍只重染 `gray`（三族 157 处迁入后仍冷灰）。见 §3.1 末、§10.3 |
| 放松的对价 | 兼容层四族**共 1380 处**（`gray` 1223 ＋ `zinc` 66 ＋ `slate` 51 ＋ `neutral` 40）从"所有主题禁移"变为"**仅 `accent` 禁移**" ⇒ 其可读性自此无守卫（探针只能买 `gray` 的——四套只染 `gray`），因此必须补**五对**对比度探针（另有一对可选，§4.5） |
| 是否新增 `coverage` 档位 | **不需要**。补完之后四套就是合规的 `full` |
| 实施前第 0 步 | 先量「四套 × 现有 6 对 × 2 外观」的对比度读数 ＋ 自证 `BASE_PAIR_COLORS` 出厂值（§7 第 0 步）——这是唯一一处可能**已存在**的红 |
| 待决 | **已清零**（2026-09-30 用户裁定）：§8-9 取 (a)；§8-8 **本片补齐** editor 到 23/28；§8-7 **不加**单调性断言；§8-3/4/5/6 照四审显式表态。**另新增 §10.3：`compat` 由 `gray` 扩为四族 44 档**（堵 `accent` 侧三族漏网）⇒ 可进 §9 收尾与提交 |

---

## 1. 背景：两条通道在代码里差什么

CloudCLI 的主题有两个来源，差别不只是"在哪":

|  | 内置主题 | 用户主题 |
|---|---|---|
| 身份 | `BUILTIN_THEMES` 注册表（`src/shared/constants.ts:330`）＋ `src/index.css` 里的 `[data-theme="cc-*"]` 块 | `~/.cloudcli/themes/*.css/json/tmTheme` 文件，id 形如 `user-*` |
| 到达方式 | 随 bundle 编译，**无取数步骤** | 服务端 `fs.readdir` 列举（`server/modules/themes/services/theme-files.service.ts:391`）→ HTTP 取文本 → 客户端编译 → `<style>` 注入 |
| 显示名 | 注册表里写死，**可以是中文** | `.css` **无法自报名字**（`readDeclaredMetadata` 对 css 返回空）⇒ 回落**文件名**；`coverage` 徽标同样读不到 |
| 守卫 | 受 `theme-overlays.spec.ts` / `contrast.spec.ts` 全套约束 | **不受**——两个 spec 都是 `BUILTIN_THEMES.filter(appearance === 'system')`（`theme-overlays.spec.ts:58`、`contrast.spec.ts:40`） |
| 跨设备 | 随产品走 | 靠 dotfiles stow 或个人拷贝；产品**不创建也不播种**该目录（服务端读目录包在 `try/catch` 里，目录缺失 = 空列表、不报错） |

**「升为内置」因此不是搬文件，是让主题进入注册表。** 一进注册表就立刻被拿去跑全套内置契约——这就是本方案要处理的三道坎的来源。

### 1.1 契约的三组常量

`tests/theme-tokens/theme-overlays.spec.ts`：

- `SURFACES`（`:70`）——把令牌分成 `substrate` / `terminal` / `editor` / `graph` / `cardSurface` / `fixed` 六个家族
- `MUST_MOVE`（`:126`）——`accent` 只需动 4 个强调色令牌；`full` 必须动 substrate 11 ＋ terminal 7 ＋ graph 3（探针）＋ editor 6
- `MUST_NOT_MOVE`（`:132`）——`accent` 不许动 substrate / terminal / editor / graph / fixed；`full` 只不许动 `fixed`
- `fixed`（`:120`）现在是 `['--n-white', '--n-black', '--n-gray-100', '--n-gray-700']`

另有 `SYNTAX_BOARD_THEMES`（`:588`）单独登记"哪几套主题拥有语法板"（目前 4 套：catppuccin / islands / onedark / onedark-vivid）。

---

## 2. 实测：三道坎

四套主题逐项比对 `MUST_MOVE.full`（脚本按位置解析 `src/index.css` 基色与主题文件声明，再做 `var()` 链式解析与逐令牌比对）：

| 面 | 浅色 | 深色 |
|---|---|---|
| substrate（11） | ✅ 全动 | ✅ 全动 |
| terminal（7） | ✅ 全动 | ✅ 全动 |
| graph（10 lane，契约以 1/5/10 为探针） | ❌ 缺 3 | ❌ 缺 3 |
| editor（6） | ❌ 缺 5（`--editor-fg` 已动，因基色走 `hsl(var(--palette-sand-950))`） | ❌ 缺 6 |

**坎 1 —— 兼容灰阶（`fixed` 组）**：四套主题都重染 `--palette-gray-*`。`--n-gray-100: var(--palette-gray-100)`（`src/index.css:287`），计算值随动 ⇒ `mustNotMove` 直接红。

**坎 2 —— `MUST_MOVE.full` 的 editor / graph**：四套都没声明 `--palette-graph-*`；editor 侧除 `--editor-fg` 外都没落点。

**坎 3 —— `coverage` 档位**：`accent` 的 `MUST_NOT_MOVE` 含 substrate，而四套明明动了 substrate ⇒ 当不了 `accent`；又不能当 `full`（坎 2）。**四套落在档与档之间。**

---

## 3. 判断：哪一道该放松

### 3.1 该放松：兼容灰阶冻结（坎 1）

**证据一：四套改的是完整 11 档，是协和的整阶重标定，不是东染一档。**

```
dracula.css      --palette-gray-50..950   11 档
gruvbox.css      --palette-gray-50..950   11 档
kanagawa.css     --palette-gray-50..950   11 档
tokyo-night.css  --palette-gray-50..950   11 档
```

⇒ 守卫拦住的**不是缺陷，是策略**。

**证据二：`fixed` 注释给的两条理由，一条是设计意见、一条把话说反了。**

守卫原文（`theme-overlays.spec.ts:113-120`）：

> The `--n-gray-*` pair stands for the whole Tailwind compatibility skeleton (~1.5k utility sites): retinting it would change far more than a theme advertises, and it is already cool enough to sit under a cool substrate.

- "it is already cool enough to sit under a cool substrate" —— 这是**审美判断**，不是正确性属性。
- "far more than a theme advertises" —— 恰恰反了：**这些站点就是 app 自己的 chrome**。一枚写着「完整」的徽标本来就该覆盖它们；钉死它们等于产品主动留一道"外壳是主题色、内脏是冷灰"的接缝——`dracula.css` 自己的注释就在警告这件事。

**站点数口径（一审修正）**：本方案最初写"~1.5k"，那是**估算而非实测**。现改为可复算的口径与数字：

```
rg -o --no-filename 'n-gray-[0-9]+' src --glob '!**/tests/**' | wc -l   → 1223  （74 个文件、11 个档位）
rg -o --no-filename 'n-zinc-[0-9]+'  … → 66    'n-slate-[0-9]+' … → 51    'n-neutral-[0-9]+' … → 40
rg -o --no-filename 'n-(white|black)\b' … → 257
```

⇒ 兼容层四族合计 **1380** 处（`gray` 一族 1223），另 `--n-white/--n-black` 257 处。常用配对抽样：`text-n-gray-700` **56** 处、`bg-n-gray-50` **52** 处、`hover:bg-n-gray-100` **40** 处。
（`.agents/skills/theme-authoring/SKILL.md` 与 `dracula.css:12` 里那句"**343 处表面**"是更早、更窄的旧口径，本次无法复现；两处随 §6 risk 3 的回写一并改成上面的口径与数字。）

> **范围边界（一审补充，四审后改为两层，必须成行）**：这里有两件事被"只收 `gray`"一句话盖住了，拆开写：
> **(a) 主题侧**——本片**四套主题只重染 `gray`**。`zinc` / `slate` / `neutral` 三族（66 ＋ 51 ＋ 40 ＝ 157 处）**四套都没声明** ⇒ 迁入后这三族仍是冷灰。这是**有意不染**（四套的 L1 只重标定了 `gray` 阶），不是漏项。
> **(b) 契约侧**——`accent` 的禁移**必须**把这四族都收进去（§4.1、§10.3）。原先三族**从不在 `fixed` / `MUST_NOT_MOVE` 任何一处**（`userThemeTokens.ts:217` 的 `^--n-[a-z0-9-]+$` 只说明它们能"跟主题走"），于是 `accent` 主题可以染掉 157 处冷灰而仍挂 `accent` 徽标——这跟 `--n-gray-500` 能穿过是同一个洞，只是三族**连 1 档都没挂**，比当时的 `gray` 更宽。**本片一并堵上**（四审后裁定，§10.3-(i)）。
> 之所以要写这一句：§3.1 那套"外壳是主题色、内脏是冷灰"的论断若不加限定，下一位读者会原样套到另外三族上；同时它也回答了 §8 待决 2 的一个隐含前提——兼容族不止 `gray` 一族。

**显式约定（一审补充；四审后扩到四族）**：既然"**染完整 11 档**"是本方案据以判定"策略而非缺陷"的论据，它就是一条契约承诺，须写进 §4.1 的注释而不只是靠常识：**`full` 主题若动兼容层某一族，必须把那一族染完整 11 档**（只染其中几档既过不了 `accent`（动了 compat）也挂不了 `full`（不完整），会落回今天四套的"档位之间"）。

**证据三：`--n-white` / `--n-black` 的**理由要改写，结论不变（二审修正）。** 原写"永远暗色的终端选区 chrome 的白描边/黑阴影、与外观无关、没有哪个主题该改它"——这条**定性不成立**：实测 `text-n-white` **143** 处、`bg-n-white` **51** 处、`bg-n-black` **36** 处，而"终端选区 chrome"那一路只占几处（`hsl(var(--n-black) / 0.1)`，`src/index.css:1032 / 1124 / 1383 / 1387`）；四套自己的取证点旁边就站着 `bg-blue-600 text-n-white`（`McpServerFormModal.tsx:243`，与 §4.5 对 2 是同一个三元表达式），说明白字确实在被跟主题无关的地方消费。**站得住的那条理由是**：纯白/纯黑作**填充与标签**时，一旦被重染，白字压灰、黑字压亮的对比度风险最高，而它们承担的站点量（257 处）也远超任何主题宣称的面 ⇒ **继续冻结**。但不要拿"外观无关"当理由——它与事实不符，下一位读者会据此去反对别人放松 white/black。

**结论：把整个 `gray` 阶（11 档）从「所有主题禁移」移到「仅 `accent` 禁移」。** 这样 `accent` 徽标的意思（"只动强调色家族"）一字不减，而 `full` 主题获得了收掉接缝的能力。

**`accent` 侧同步补全（采纳一审 Claude-3 / WorkBuddy-6；四审后扩到四族）**：`fixed` 今天只挂了 `--n-gray-100/700` 两档，而灰阶有 11 档；更宽的是 `zinc` / `slate` / `neutral` 三族**一档都没挂**（不在 `fixed`、也不在 `MUST_NOT_MOVE.accent`）⇒ `accent` 主题可重染未探针的档位（实测：给 `cc-polar` 注入 `--palette-gray-500` **能通过**；注入 `--palette-gray-100` 则红；三族因不在任何清单，**11 档全通**）。既然本次把"收兼容层"这个能力**只下放给 `full`**，`accent` 就没理由留这条缝——只挂 2 档反而让"变异 M5 是绿的"看起来像设计意图。**改动：`accent` 的禁移改为兼容层四族 44 档**（§4.1），代价是这份清单从 **31** 项变 **73** 项（`substrate 11 ＋ terminal 7 ＋ editor 6 ＋ graph 3 ＋ compat 44 ＋ fixed 2`），不新增用例。
> **算术修正（四审后复核）**：本节与 §4.1 原先都写"**31 → 42**"，构成式写作 `…＋ fixed 4 ＋ compat 11`。**两处都不对**：`fixed` 在本片由 4 项删到 2 项（`--n-gray-100/700` 移入 `compat`），所以只收 `gray` 时是 **40**（不是 42）；四审后扩到四族，`compat` 为 44 档 ⇒ 终值 **73**。四轮评审都没算这一步（详见文末「牵头结论（四审）」的复算）。
> **二审修正**：原写"从 ~12 项变 ~23 项"——两个数都错，实测现状是 **31** 项。这句正被用来论证"代价可接受"，写成 12→23 会让人以为它是张小清单。

> **一处如实记账**：兼容阶梯在文档里的定位是**过渡层**（`--n-*` 令牌层是永久契约面，但"逐档等于 Tailwind 原值"这个性质是为阶段 0 的保值迁移服务的）。当语义化改名立项、这些站点改走语义令牌后，它们会自然跟随主题。所以本次重染是**当下收口**，不是永久形态。这不构成反对，只是避免下一位读者误读。

### 3.2 不该放松：`full` 的 editor / graph（坎 2）

**驳回理由：这不是"新设计"，是 16 个照方抓药的值。** 既有 5 套 `full` 主题（polar / catppuccin / islands / onedark / onedark-vivid）用的是**同一形态**——"把 editor 的 6 个契约槽与 10 条 graph lane 指到自己的 substrate 家族"——但**取值逐套不同**，不是同一套字面量（一审修正：原写"逐字同一套配方"，这条被 `src/index.css` 反驳）：

**editor 的形态**——把 6 个契约槽指到**自己的** substrate 家族：

```
cc-polar 浅色   --editor-bg: hsl(var(--palette-sand-50));      /* :1643 */
                --editor-panel-bg: hsl(var(--palette-sand-100)); /* :1653 */
                --editor-toolbar-fg: hsl(var(--palette-sand-800)); /* :1664 */
cc-polar 深色   --editor-bg: hsl(var(--palette-ink-950));      /* :1670 */
                --editor-fg: hsl(var(--palette-ink-100));      /* :1671 */
                --editor-panel-bg: hsl(var(--palette-ink-900)); /* :1680 */
cc-onedark 深色 --editor-bg: hsl(var(--palette-ink-900));      /* :2332 ← 不是 ink-950 */
                --editor-panel-bg: hsl(var(--palette-ink-850)); /* :2342 */
cc-onedark-vivid 深色 --editor-bg: hsl(var(--palette-ink-900));/* :2541 ← 同上 */
```

> **深色的 `--editor-bg` 不是自由选择，被 `code-block-surface.spec.ts:60` 反向钉死（采纳一审 WorkBuddy-2）**：该 spec 对每个 `system` 主题断言「**代码块底板 == `--editor-bg`**」，且浅深**两外观都判**（`boards.editor === boards.reference`，`reference` 由 `var(--editor-bg)` 绘制）。四套 `.css` 今天写的底板是 `--code-block-bg: var(--palette-sand-50)` / `var(--palette-ink-950)`（`dracula.css:124/148`、`gruvbox.css:128/148`、`kanagawa.css:128/151`、`tokyo-night.css:126/149`）⇒ **四套的深色 `--editor-bg` 只能是 `ink-950`**。若照"更新的先例"取 `ink-900`（onedark 系的做法），四套会**同一条断言全红**，而失败信息只说 "the editor preview draws X, not the editor page Y"，看不出根因。
> 更一般的表述：**一条主题的 `--editor-bg` 必须与它自己的 `--code-block-bg` 同值**；`ink-950` 与 `ink-900` 都合规，取决于该主题的底板取哪一档——这正是"同形态、逐套取值"的意思。

**顺带修好的一处（采纳一审 WorkBuddy-2 附笔）**：`dracula.css:38-43` 自己记的那条"**不变量偏离**"（浅色底板是米黄、编辑器页仍是纯白 `#fffbeb` vs `#ffffff`；深色 `#282a36` vs `#282c34`）**在本次迁入后消失**——编辑器页第一次跟着主题走。这条该写成"顺带修好"，否则下一个读 `dracula.css` 的人会以为偏离还在。

**关键前置条件已满足**：四套主题各自都定义了 `--palette-sand-{50,100,200,500,800,950}` 与 `--palette-ink-{100,400,800,850,900,950}`（逐套实测，完全一致）⇒ editor 映射表所需的沙/墨档**一个不缺**，不需要新造任何 L1 色。（注意：它们定义的是**子集**，不是完整 11 档——够用即可。）

**graph 的配方**——声明 `--palette-graph-1..10`，**保持基色相（198.6°…83.7°）只重调 S/L**，使每条 lane 在**该主题的两个 substrate** 上都 ≥3:1：

```
基色    --palette-graph-1: 198.6 88.7% 48.4%;  /* sky-500 */   （src/index.css:90）
cc-polar  --palette-graph-1: 213 45% 52%;                      （:1613）
cc-catppuccin --palette-graph-1: 198.6 55% 42%;                （:1794）—— 同色相、S=55%、L 取两底较差者
```

**放松它的代价是可见的**：不补 editor 时，深色外观下编辑器页停在基色字面量 `#282c34`（One Dark 的底，`src/index.css:484`）、`--editor-panel-bg: #21252b`、`--editor-toolbar-fg: #d1d5db`（冷灰）——kanagawa / tokyo-night 这类偏暖偏深的主题会明显不搭；不补 graph 时 git 面板留 10 个与主题无关的高饱和基色（sky-500 / orange-500 / purple-500 …）。**省下 16 行、换来一枚不再有内容的「完整」徽标，不划算。**

---

## 4. 具体改动

### 4.1 契约（唯一需要放松的地方）

`tests/theme-tokens/theme-overlays.spec.ts`：

```diff
@@ SURFACES（:70）@@
+  /**
+   * The Tailwind compatibility skeleton — all four neutral families
+   * (`gray` / `zinc` / `slate` / `neutral`), 1380 sites:
+   *   `gray` 1223  `rg -o --no-filename 'n-gray-[0-9]+' src --glob '!**/tests/**' | wc -l`
+   *   `zinc` 66 · `slate` 51 · `neutral` 40
+   *
+   * Out of reach for `accent` — retinting any of it would change far more than
+   * that badge advertises — but *inside* the reach of a theme that already claims
+   * the surfaces, because those sites are the app's own chrome and leaving them
+   * cold is the seam the ramp's step values are not meant to force.
+   *
+   * All four families are listed, not the two `gray` steps that happened to be
+   * probed, and not `gray` alone: the old guard left `zinc` / `slate` /
+   * `neutral` on *no* list at all, so an `accent` theme could retint 157 sites
+   * and still call itself `accent`. A family a `full` theme retints is expected
+   * to be retinted **all eleven steps** — a partial retint leaves the same seam,
+   * one step over.
+   */
+  compat: [
+    '--n-gray-50', '--n-gray-100', '--n-gray-200', '--n-gray-300', '--n-gray-400',
+    '--n-gray-500', '--n-gray-600', '--n-gray-700', '--n-gray-800', '--n-gray-900',
+    '--n-gray-950',
+    /* `zinc` / `slate` / `neutral` 同形：各 11 档，实施时逐档列出
+       （`--n-zinc-50 … --n-zinc-950`、`--n-slate-…`、`--n-neutral-…`） */
+  ],
   /**
    * Tokens no overlay is allowed to move, whatever its coverage.
    *
-   * `--n-white` / `--n-black` are the white outline and black shadow of the
-   * always-dark terminal selection chrome, which is appearance-agnostic on
-   * purpose. The `--n-gray-*` pair stands for the whole Tailwind compatibility
-   * skeleton (~1.5k utility sites): retinting it would change far more than a
-   * theme advertises, and it is already cool enough to sit under a cool
-   * substrate.
+   * `--n-white` / `--n-black` are mostly plain white / black fills and labels
+   * (257 sites), with only a handful of `hsl(var(--n-black) / 0.1)` shape uses
+   * behind them. Retinting pure white or black is the highest-risk move there
+   * is for contrast, and the sites they carry outnumber what any one theme
+   * advertises — so they stay frozen.
+   *
+   * (Two revisions settled the wording: "appearance-agnostic, so no theme has
+   * any business moving them" was wrong — see the plan's §3.1 evidence 3.)
+   *
+   * `zinc` / `slate` / `neutral` are **no longer** frozen — they moved
+   * into `compat` (above). They were never in this list before either, which is
+   * exactly how an `accent` theme could retint them — `compat` closes that.
+   * That is deliberate and recorded in the plan (§3.1): this slice retints
+   * `gray` alone.
    */
-  fixed: ['--n-white', '--n-black', '--n-gray-100', '--n-gray-700'],
+  fixed: ['--n-white', '--n-black'],

@@ MUST_NOT_MOVE（:132）@@
   accent: [
     ...SURFACES.substrate,
     ...SURFACES.terminal,
     ...SURFACES.editor,
     ...SURFACES.graph,
+    ...SURFACES.compat,
     ...SURFACES.fixed,
   ],
   full: [...SURFACES.fixed],
```

**影响面**：`MUST_MOVE` **不变**（compat 不是"必须动"，只是"可以动"——既有 5 套主题都不动它，若列为必移会当场全红）。`accent` 的 `MUST_NOT_MOVE` 由 **31** 项（`substrate 11 ＋ terminal 7 ＋ editor 6 ＋ graph 3 ＋ fixed 4`）变 **73** 项（`… ＋ compat 44 ＋ fixed 2`；**注意 `fixed` 由 4 减到 2**，所以只收 `gray` 时是 40、不是 42，见 §3.1 的算术修正），**不新增用例**（该清单在 per-theme 测试里 in-test 遍历，门槛数不动）。

> **需知情**：这条放松**同时作用于现有 5 套内置主题**（它们获得了一项不使用的能力）。契约文档文字必须一并回写，不能说成"只对新四套生效"。

### 4.2 四套主题要补的值

> **先做迁移这一步：选择器必须改写（采纳一审 WorkBuddy-8）**
> 四套 `.css` 现在的选择器是 `:root` / `:root:not(.dark)` / `.dark`（`dracula.css:48 / 123 / 147`，另三套同形）。搬进 `src/index.css` 必须变成：
>
> | 用户文件里的块 | 搬进去之后 |
> |---|---|
> | `:root { … }`（L1 色板 ＋ 兼容灰阶） | 裸 `[data-theme="cc-<id>"] { … }` |
> | `:root:not(.dark) { … }`（语法板 ＋ 代码块底） | `[data-theme="cc-<id>"]:not(.dark) { … }` |
> | `.dark { … }` | `[data-theme="cc-<id>"].dark { … }` |
>
> **§4.4 原来的"原样随文件迁入"是错的**：字面照搬会把 `:root:not(.dark)` 直接搬进去，于是四套的**语法板对所有主题生效**。它的护栏不是没有——语法板守卫（`theme-overlays.spec.ts:590` 的 `owns === false` 分支报 "names N syntax slots but owns no board"）与 `token-baseline.json`（实测含 **22** 处 `--cc-syntax`、**2** 处 `--code-block-bg`，`<html>` 快照会立刻漂）——但这属于"会响"，不该靠它兜。**正确表述：值原样、选择器按覆盖层形态改写。**

**editor —— 浅色外观（`[data-theme="cc-<id>"]:not(.dark)`）：**

```css
  --editor-bg: hsl(var(--palette-sand-50));
  --editor-gutter-bg: hsl(var(--palette-sand-50));
  --editor-loading-bg: hsl(var(--palette-sand-50));
  --editor-panel-bg: hsl(var(--palette-sand-100));
  --editor-toolbar-fg: hsl(var(--palette-sand-800));
  /* --editor-fg 不重声明：基色即 hsl(var(--palette-sand-950))，经 var() 链随主题走。
     这是既有 5 套的统一口径（逐套实测：它们的浅色块都只声明 5 个契约槽，无 fg）。 */
```

**editor —— 深色外观（`.dark`）** —— `--editor-bg` **必须与 `--code-block-bg` 同值**，四套的底板是 `ink-950` ⇒ 取 `ink-950`（见 §3.2 的 `code-block-surface.spec.ts` 约束）：

```css
  --editor-bg: hsl(var(--palette-ink-950));   /* == 该主题的 --code-block-bg */
  --editor-fg: hsl(var(--palette-ink-100));
  --editor-gutter-bg: hsl(var(--palette-ink-950));
  --editor-panel-bg: hsl(var(--palette-ink-900));
  --editor-toolbar-fg: hsl(var(--palette-ink-100));
  --editor-loading-bg: hsl(var(--palette-ink-950));
```

**graph —— 外观无关，一份放在裸块内：** 声明 `--palette-graph-1..10`，**基色相不变**，S/L 重挑至每条 lane 在 `sand-50`（浅底）与 `ink-950`（深底）**两个底上都 ≥3:1**；S 建议取单一定级（参照 `cc-catppuccin` 的 55%）以保持十条并列时的饱和度一致。具体十组值在实施时用脚本搜索确定并逐条记账。
（**位置已核实与既有 5 套同形**：它们都把 10 条 lane 声明在裸 `[data-theme="cc-X"]` 块里——`cc-graph` 是外观无关的一份，contract 的 `MUST_MOVE.full.graph` 探针（1/5/10）在两个外观下都因此满足。）

> **阶序从"审计项"抬成核对表的一列（采纳三审）**。`gray` 阶是本片重染的**唯一整阶家族**，而"11 档亮度单调"**没有任何断言守着**（§8-7）。本轮仍不做断言（要定度量与间距下界，属新机制），但三审指出：只宣布"须声明阶序"会让复核无从下手 ⇒ 现改为**随 §7 第 3 步的静态核对一起交付的一列可复算产出**，并在实施前**先填实测值**（本轮已复算，见 §7 第 3 步的阶序表；四套两口径均单调递减，最小相邻间隔 **2.10 L / 0.01 Y**，都落在 50→100 档、与基色同值）。真机复验时逐档读 `--n-gray-50..950` 的 computed L 做一次 quick check。
> 为什么值得留文本痕迹：§3.1 据以判定"**策略**而非缺陷"的正是"协和的整阶重标定"——把承诺写成可核对的一列，既不添机制，也让那条论据不再只是形容词。翻转会**静默发生**：`gray-600`（暗占位）若比 `gray-400`（光正文）亮、或 `gray-100`（暗文字）比 `gray-50` 深，现有探针一个都发现不了。
> **三审顺带确认了机制的来由**：四套灰阶是"**以基色阶为模板、保 L 换色相**"——上半段（`50/100/200/300`）的 L 与基色**逐档完全相同**，下半段（`400…950`）偏移 ≤ 2.6 个 L（例：`gray-900` 基色 11.00 vs gruvbox 8.48）。这解释了 §7 0a 表 3 里"灰阶面读数与 base 差 ≤ 0.02"这个反直觉的结果，也是"整阶重标定而非东染一档"的又一处实证。

**新增声明量（一审修正：88 → 84）**：每套 5（浅）＋ 6（深）＋ 10（graph）＝ **21 条 × 4 套 ＝ 84 条**。
> 原写 88 ＝ 22×4，那是把浅色 `--editor-fg` 也算成一条新声明；而按既有 5 套的口径它**不重声明**（靠 `var()` 链跟随），所以是 84。§7.3 的静态核对口径同此。
> 两条路都成立（写与不写都合规，写了更自明），本方案选**不写**以与既有 5 套形态一致；若实施时选择写明，则核对口径是 88。

> **一审新发现的一条缺口（须知情，进 §8-8）**：本节的 editor 补值是**契约最小集**（6 个 `MUST_MOVE` 槽，浅色实补 5）。而**既有 5 套主题的形态是 23（浅）/ 28（深）个 editor 令牌**——它们把编辑器页整片都接管了（选区、活动行、gutter-fg、tooltip、minimap、autocomplete、toolbar-bg/border…）。
> 只补 6 槽的后果：编辑器页的**非契约 chrome 保持基色**（浅色 `#17c` 自动补全高亮、`#cceeff44` 青色活动行、`#f5f5f5` gutter/panel 等），在四套主题的浅底上会看得出接缝。差额约 **40 槽/套（18 浅 ＋ 22 深）× 4 ＝ 160 条**。要不要补齐，见 §8-8。

### 4.3 注册表

`src/shared/constants.ts:330`，`cc-onedark-vivid` 之后追加四条：

```ts
  { id: 'cc-dracula',     name: '德古拉',   appearance: 'system', source: 'builtin', coverage: 'full' },
  { id: 'cc-gruvbox',     name: '复古盒',   appearance: 'system', source: 'builtin', coverage: 'full' },
  { id: 'cc-kanagawa',    name: '神奈川',   appearance: 'system', source: 'builtin', coverage: 'full' },
  { id: 'cc-tokyo-night', name: '东京夜',   appearance: 'system', source: 'builtin', coverage: 'full' },
```

（中文名 **待定**，见 §8。）
`name` 是字面量、不是 i18n key（现有 6 条的形态）⇒ **无 i18n 改动**。

### 4.4 测试名单

`tests/theme-tokens/theme-overlays.spec.ts:588`：

```diff
-const SYNTAX_BOARD_THEMES = ['cc-catppuccin', 'cc-islands', 'cc-onedark', 'cc-onedark-vivid'];
+const SYNTAX_BOARD_THEMES = [
+  'cc-catppuccin', 'cc-islands', 'cc-onedark', 'cc-onedark-vivid',
+  'cc-dracula', 'cc-gruvbox', 'cc-kanagawa', 'cc-tokyo-night',
+];
```

四套主题的语法板（11 槽 × 2 外观）在上一个片已补齐，**值原样、选择器按 §4.2 改写**后迁入。

**基线不用动**：`token-baseline.json` 只记 `:root` / `.dark` 的基色，覆盖层声明永不进入（B2 片实测结论：新增覆盖层不改变两份基线）。双向守卫（`theme-overlays.spec.ts:346`，"块存在但未注册"）因为注册表与块同时加，自动满足。

**本轮会涨的用例数（采纳一审 WorkBuddy-1）**：有三个套件是**逐 `system` 主题展开**的，注册表加 4 条 ⇒ 每引擎 **+12**（`theme-overlays.spec.ts:386` ＋4、`contrast.spec.ts:88` ＋4、`code-block-surface.spec.ts:60` ＋4），两引擎 **174 → 198**。
> `SYNTAX_BOARD_THEMES` 那一行本身**不涨用例**——它在 `owns` 分支里是 in-test 遍历。

**`tests/theme-tokens/main.ts` 不需要改（采纳一审 WorkBuddy-10，二审扩到六个令牌）**：§4.5 用到的 `--n-gray-50/100/300/700/900/950` **全部**在 `NEUTRAL_SCALE_PROBE_TOKENS`（＝ `SCALE_TOKEN_NAMES`（4 族 × `NEUTRAL_STEPS`）＋ `EXTREME_TOKENS` 的 `--n-white/black`）里——`NEUTRAL_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]`（`src/shared/tests/neutralScale.ts:31`），十一个档**一个不缺** ⇒ 新增的对**不会**撞上 `contrast.spec.ts:100-108` 那条 "not in the fixture's PROBES"。

### 4.5 放松的对价：补五对兼容灰阶对比度探针（＋一对可选）

`src/shared/userThemeContrast.ts` 的 `CONTRAST_PAIRS`（`:53`）是**对比度契约的唯一书写处**，被两侧共用：`contrast.spec.ts`（内置主题，真浏览器）与 `findContrastWarnings`（用户主题，纯函数、非阻断警告）。目前的 6 对**全部是语义令牌，不含兼容阶梯**——所以灰阶一旦放开，那 1223 处站点的可读性**没有任何东西守着**。

**一审把"一对"改成"三对"（采纳 WorkBuddy-4）**：原方案只加 `--n-gray-700` on `--n-gray-50`，而它**买不回它声称的东西**——被放松的是 `gray-100` 与 `gray-700` 两档，而 `--n-gray-50` **从来不在** `fixed`（`:120` 只有 white / black / 100 / 700）⇒ 拿一个"本来就可动"的令牌当表面；结果是 **`gray-100` 一个配对都没判**，而它恰恰是最常用的表面（`hover:bg-n-gray-100` 40 处）且还作暗色下的文字色（`src/index.css:861-865` 一组 `color: hsl(var(--n-gray-100)) !important`）。染错 `gray-100` 同样毁掉那 40+ 处。

**二审再补两对（＋一对可选），把三处绘制点的暗色半也判上。** 一审那三对**只判了浅色半**：三处取证点的 className 另一半都换了令牌，其中两处的暗色半是**无 alpha 的实色、纯函数完全算得出**，只是当时没列出来（只有 `/50` 那处真算不出）。逐处核过完整 className 后的实况：

| 取证点 | 浅色半 | 暗色半 | 暗色半可算？ |
|---|---|---|---|
| 对 1 `TextContent.tsx:39`（代码块） | `gray-700 on gray-50` | `dark:bg-n-gray-800/50 dark:text-n-gray-300` | ❌ 表面带 `/50`，要在上一层之上再合成 |
| 对 2 `VersionUpgradeModal.tsx:250,258`、`TaskEmptyState.tsx:96` | `gray-700 on gray-100` | `dark:bg-n-gray-700 dark:text-n-gray-300` | ✅ 实色 ⇒ 新增**对 4** |
| 对 2 的另一组 `McpServerFormModal.tsx:244,255,294` | 同上 | `dark:bg-n-gray-800 dark:text-n-gray-300` | ✅ 实色 ⇒ 新增**对 6（可选）** |
| 对 3 `TextContent.tsx:31`（JSON 块） | `gray-100 on gray-900` | `dark:bg-n-gray-950`（ink 不变）⇒ `gray-100 on gray-950` | ✅ 实色 ⇒ 新增**对 5** |

量级上暗色半并不小（同 §3.1 口径复算）：`dark:text-n-gray-300` **53** 处、`dark:bg-n-gray-800` **71** 处、`dark:bg-n-gray-700` **27** 处；而对 2 的浅色半（同一 `className` 上 `bg-n-gray-100` ＋ `text-n-gray-700`）只有 **9** 处。⇒ 只判浅色半会让"残留盲区"只记到三分之一。

**改为五对（＋一对可选），全部取证到真实绘制点：**

```diff
   { ink: '--ring', surface: '--background', min: 3 },
+  // The chat's fenced-code panel (TextContent.tsx:39).
+  { ink: '--n-gray-700', surface: '--n-gray-50',  min: 4.5 },
+  // Secondary buttons (bg-100 + text-700 on the same element).
+  { ink: '--n-gray-700', surface: '--n-gray-100', min: 4.5 },
+  // The JSON block's own ink on its own board (TextContent.tsx:31).
+  { ink: '--n-gray-100', surface: '--n-gray-900', min: 4.5 },
+  // The dark half of pair 2 — same elements, `dark:bg-gray-700 text-gray-300`.
+  { ink: '--n-gray-300', surface: '--n-gray-700', min: 4.5 },
+  // The dark half of pair 3 — `dark:bg-n-gray-950` under an unchanged ink.
+  { ink: '--n-gray-100', surface: '--n-gray-950', min: 4.5 },
+  // Optional: the dark half of pair 2's other variant (`dark:bg-n-gray-800`).
+  { ink: '--n-gray-300', surface: '--n-gray-800', min: 4.5 },
```

**取证（逐对）**：
- 对 1：`src/modules/chat/tools/ContentRenderers/TextContent.tsx:39` 同一个 `<pre>` 上挂 `border-n-gray-200/50 bg-n-gray-50 … text-n-gray-700`
- 对 2：`src/modules/version-upgrade/VersionUpgradeModal.tsx:250,258`、`src/modules/mcp/McpServerFormModal.tsx:244,255,294`、`src/modules/task-master/TaskEmptyState.tsx:96` —— 同一个 `className` 上 `bg-n-gray-100 … text-n-gray-700`
- 对 3：`TextContent.tsx:31` 的 JSON 块 `bg-n-gray-900 … text-n-gray-100`
- 对 4：对 2 三处的暗色半 `dark:bg-n-gray-700 dark:text-n-gray-300`
- 对 5：`TextContent.tsx:31` 的暗色半 `dark:bg-n-gray-950`（ink 不变 ⇒ `gray-100`）
- 对 6（可选）：`McpServerFormModal.tsx:244,255,294` 的暗色半 `dark:bg-n-gray-800 dark:text-n-gray-300`
- 覆盖矩阵：`gray-700`（被放松档）作 ink 判两个表面 ✓、并作表面（对 4）✓；`gray-100`（被放松档）作**表面**（对 2）与作 **ink**（对 3 / 对 5）各判 ✓；`gray-300` 作 ink（对 4 / 对 6）✓
- **读数量级**：五对＋可选对在 base 与四套上的读数见 §7 0a 表末尾；最紧的是 **对 4 = 7.00（base）**，比新增对 1/2 的 9.3~9.9 更贴 4.5 限值、判别力最强 —— 这正是不该把暗色半留在表外的理由。

**同时需补 `BASE_PAIR_COLORS`（`:76`）的出厂值**：新增用到的六个令牌 `--n-gray-50` / `--n-gray-100` / `--n-gray-300` / `--n-gray-700` / `--n-gray-900` / `--n-gray-950` 的浅深两格。
> **为什么两格写同值（采纳一审 Claude-4 的解释要求，不采纳其改结构建议）**：兼容阶梯**只在 `:root` 声明、与外观无关**（`src/index.css:112-293`，`.dark` 块里没有它们），所以每一对在两个外观下必然同值。`BASE_PAIR_COLORS` 是**按外观键控**的表（`Record<Appearance, …>`），照键位各写一份是最小改动；把类型改成"这对可以外观无关"会为一个记录的特例改共用表的结构。**成交口径：在实现处加一行注释说明"两格同值是因为该阶外观无关，不是复制粘贴"**。
> ⚠️ **不要把"判了两次"当覆盖面**：它算术上没错，但等于**判一次**——**这些对是在判档位，不是在判绘制点**。二审补的对 4/5/6 把两处"能算的暗色半"补了进来，但**仍有一处算不出**：`TextContent.tsx:39` 的 `dark:bg-n-gray-800/50`，表面带 `/50`（要在上一层之上再合成一次），纯函数型的用户主题警告也不该假装能算。这条**如实记录**（§6 risk 1 与 §7.2 的 M3″），不留在正文当安慰。

**同时必须承认「探针覆盖不到的强制 chrome」——它不是抽样漏档，是不可覆盖的切面（二审新增）。** 四套重染的是**完整 11 档**，其中两档被 `!important` 的输入 chrome 独占消费、用户无覆盖手段：

| 档 | 消费点 | base 读数（按真实表面） |
|---|---|---|
| `--n-gray-400` | `src/index.css:900-903` `textarea::placeholder { color: hsl(var(--n-gray-400)) !important; opacity: 1 !important }`（浅色；`:919-940` 的 `.chat-input-placeholder` 同色） | `on n-gray-50` = **2.43**、`on --background` = **2.35**、`on --card` ≈ **2.54**（近似值） |
| `--n-gray-600` | `src/index.css:906-917` `.dark textarea::placeholder` / `.dark textarea.bg-transparent::placeholder`（深色） | `on n-gray-800` = **1.94**、`on --background`(=该主题 `ink-950`) = **2.44**、`on --card` ≈ **2.18**（近似值） |

> **三审修正一处表面**：二审表里写的 `gray-600 on gray-950`（=2.66）是拿**灰阶**档近似"深色底"，而基色的深色底其实是 `--palette-ink-950`（`src/index.css:75`，`0 0% 8%`，与 `gray-950` 的 `224 71.4% 4.1%` 不是同一个色）。改为**按真实表面列**：浅色 textarea 有 `bg-n-gray-50`（`McpServerFormModal.tsx:417` 等五处）与 `bg-background`（`UserThemesSection.tsx:322`）两种，深色对应 `dark:bg-n-gray-800` 与 `bg-background`(=`ink-950`)；**聊天输入框是第三种**——它是 `bg-transparent`（`PromptInput.tsx:99`），外壳是 `bg-card/80 backdrop-blur-sm`（`PromptInput.tsx:42-43`）⇒ 它的真实面是**`--card` 80% 合成在页底之上的复合面，纯函数算不出**（与 `dark:bg-n-gray-800/50` 那处同性质），表中 `--card` 一行只是"当它是纯卡片"的**近似值**，真值被 `--background` 与 `--card` 两行夹住。六个面 × 五主体的读数与判读口径见 **§7 0a 表 3**。

⇒ **不能照搬"加一对 4.5 探针"**：这六个面**在 base 上就都没到 4.5**（placeholder 本就是"淡淡的提示"，出厂值只有 1.9~2.5:1）。加 `min: 4.5` 的对会立刻红在 base，那不是发现缺陷，是**拿错了限值**。**成交口径**：(1) 把 400 / 600 写进本节的"探针不覆盖清单"并在 §6 risk 1 点名；(2) §7 第 0a 步给出**六个面 × 四套的读数与相对 base 的绝对差**（§7 0a 表 3），判据是**单边的"不得比 base 差多少"**、且阈值**只对灰阶面成立**——三审要求的可复算口径已按此定稿（理由与两族实测差值见该表）。**四审已裁定：不为它们立断言，灰阶面那半与 `gray-500` 探针一并转交「灰阶收口」片（见 §8-9）。**

> **一句话钉死范围边界（采纳三审"要写这一句"，但理由按实测改写）**：五对覆盖 `{50, 100, 300, 700, 900, 950}`，表 3 覆盖 `{400, 600}`，可选的对 6 覆盖 `800` ⇒ 真正"既无 4.5 探针、也不在任何表里"的是 **`{200, 500}`**。三审的措辞是"这两档是**有意给主题的创作自由度**、不是漏洞"——**结论采纳，理由不采纳**。按 `rg -o` 复算后两档是两种完全不同的东西：
> - **`200`：89 处，但没有文字场景**——61 处是 `border-n-gray-200`（边），只有 6 处作文字（4 个 `dark:text-n-gray-200` ＋ 2 个 `text-n-gray-200`）。两端读数也印证：浅色下作文字仅 **1.18:1**、深色下却有 **11.86:1** ⇒ 它承担的从来不是"要读的字"，没有可卡的稳定场景。
> - **`500`：119 处，其中 101 处作文字**（73 个 `text-n-gray-500` ＋ 28 个 `dark:text-n-gray-500`）⇒ **它是五对之外最大的未覆盖墨档，绝不是"没被消费"**。实测它跨在 AA 线上下：浅 `on n-gray-50` **4.63**（刚过）、`on --background` **4.47**（**已低于 4.5**）；深 `on n-gray-800` **3.04**、`on ink-900` **3.41**、`on ink-950` **3.81** ⇒ **出厂值就有一半不达标**。它该与 `400` / `600` 归**同一类**（"出厂就没达标，不能拿 4.5 卡"），并登记进探针不覆盖清单与 §7 0a **表 3b**（含四套读数与 Δmax）。
> 为什么仍**不该**把 `CONTRAST_PAIRS` 铺满 11 档：不是因为"没消费"，而是因为**剩下这四档没有一档能用 4.5 判**——`200` 没有文字场景，`400` / `500` / `600` 出厂即不达标；推成全矩阵只会换来一串一上线就红在 base 的假警报。本片对探针的定位自始至终是**抽样 ＋ 取证到真实绘制点 ＋ 只放能过的限值**，不是全覆盖。

**配套的下一步（§7 第 0 步）**：新对进表就要进 `BASE_PAIR_COLORS`，而 `contrast.spec.ts:140` 那条 "the base the user-theme warning measures against is the one the browser paints" 会拿新对去比基色。**抄错一位会红在那条**，且报文是"表 vs 样式表"——预先说明，免得被误读成"某套主题不合格"。

> **备选（本方案不默认启用）**：把探针改成 `theme-overlays.spec.ts` 里的独立断言，不改共用的 `CONTRAST_PAIRS`。理由见 §8 待决问题 3。

### 4.6 收尾：把四套文件从用户目录移除

四套 `.css` 必须从 `~/.cloudcli/themes/`（即 dotfiles 真源 `dotfiles/cloudcli/.cloudcli/themes/`）**删除**，否则选择器里会同时出现 `dracula`（用户主题，文件名）与 `德古拉`（内置，中文名）两个条目。

⇒ 上一个片（S1–S6）在四套文件里补的语法板与 `--code-block-bg`，其**内容随本次迁入 `src/index.css`**，dotfiles 侧那 4 个文件整体退场。**dotfiles 仓库会有一次"删 4 个文件"的提交**。

**关于"其它机器"（部分采纳一审 Claude-2，附前提修正）**：批注担心 stow 符号链接在删源后留悬空链接、以及用户在旧文件上的改动静默消失。**前提需修正**——本机 `~/.cloudcli/themes` 是**目录软链**（实测 `ls -la ~/.cloudcli`：`themes -> ../dotfiles/cloudcli/.cloudcli/themes`，cloudcli 包是"整目录折叠"安装），**不是逐文件软链** ⇒ 删源即删文件，**不会产生悬空链接**；且这些文件从来就是 dotfiles 的真源，在它上面改什么都没"丢"。
真实成本只剩一条：**尚未同步 dotfiles 的机器**上，选择器会短暂同时列出 `dracula`（旧用户主题）与 `德古拉`（新内置）两个条目，直至 `git pull` ＋ `stow -R`。**处置：在 dotfiles 侧提交信息里写明"同步后 `~/.cloudcli/themes/` 下这四个文件应消失"**，不引入哈希比对工具（本仓库是个人 dotfiles，不是产品部署面，没有"用户自定义"这一层）。

**头注的处置（二审新增，必须成行）**：四份文件各 161~164 行，其中**头注占了前 46 行**（`dracula.css:1-46`，另三套同构）。§4.2 只说了"值原样、选择器改写"，§4.6 只说"文件整体退场"——于是头注里至少五类内容会二选一地出事。逐类处置如下：

| # | 头注内容 | 落点 | 处置 |
|---|---|---|---|
| 1 | 旧口径"`--n-gray-*` 的 **343 处表面**"（`:12`，另 `:77`/`:78` 各一处；四套同款） | 与 `SKILL.md:128-131`、§6 risk 3 同一笔 | **改写**为 §3.1 的新口径与数字（1223），四处源文件与技能正文一并回写 |
| 2 | `:root:not(.dark)` **不能写成 `:root`**、通道 B 的样式表插在 `<head>` 末尾（`:25-28`） | 已被 §4.2 的迁移映射表取代 | **丢弃**。整段照抄进 `src/index.css` 等于把一段已失效的通道说明钉进产品源码 |
| 3 | 形状约束：`--code-block-bg` 必须裸三元组或 `var()`（写 `hsl()` 会**静默丢声明**）；11 个 `--cc-syntax-*` 是 hex、与内置那 55 条同形（`:30-36`） | 内置块注释 | **保留**。这是**不报错**的那类，丢了下一位作者收不到任何提示 |
| 4 | §3.2 判为"顺带修好"的不变量偏离记录（`:38-43`） | §3.2 与提交说明 | **迁出**：记录本身正在即将被删的文件里，改写进 §3.2 与提交说明，不再留代码注释 |
| 5 | 色值来源（`:45`／`:46`，四套各不相同：dracula-theme README ＋ alacritty ANSI、gruvbox.vim、kanagawa.nvim、tokyonight.nvim） | 内置块注释 | **保留**，逐套照抄那一行 |

⇒ 采纳的是"**只把「形状约束 ＋ 色值来源」搬进覆盖层块注释，其余逐条记账**"，不采纳"整段改写后随迁入"（会把失效的通道说明一起带进产品源码），也不采纳"dotfiles 侧留归档"（git 历史即归档，这四份文件在 dotfiles 里从来不是发布物）。
另：`:2` 的标题仍写着 `user-dracula`——文件退场后这一处不再是问题；若实施时先改后删，则不必动。

---

## 5. 替代方案与否决理由

| 方案 | 内容 | 否决理由 |
|---|---|---|
| **A. 四套保持用户主题，不升内置** | 零改动 | 已达成"不受约束、保持原味"，但**放弃产品自带**（新装机器上主题列表为空、无中文名、无徽标）。与用户目标相反 |
| **B. 不放松守卫，让出 2 档灰** | 四套放弃 `--palette-gray-100/700` | 11 档里 2 档回落冷灰，是肉眼可见的接缝；且等于让主题放弃它自己认定的一致性 |
| **C. 新增第三档 `coverage`** | 如 `palette`（substrate ＋ terminal），不要求 editor/graph | 补完 §4.2 之后四套就是合规 `full`，新档位只会让徽标词汇从 2 变 3、多一条恒不使用的分支。**不需要** |
| **D. 连 `full` 的 editor/graph 一起放松** | 一行改动，零补值 | 见 §3.2：省 16 行、换一枚失内容的徽标，且深色编辑器页与 git 图会明显不搭 |
| **E. 把内置主题全部搬成用户主题** | "统一"到一条通道 | `cc-light`/`cc-dark` 就是 `:root`/`.dark` 本身、**搬不走** ⇒ 统一度只到 ~90%；并付：中文名全失（`.css` 无法自报）、产品不再自带主题、首屏从零网络变取数。详见 §6 注 |

---

## 6. 风险与代价

| # | 风险 / 代价 | 严重度 | 处置 |
|---|---|---|---|
| 1 | 兼容阶梯的可读性失去守卫 | **高** | 已落 §4.5 的**五对（＋一对可选）**探针（两档被放松令牌 × 两种角色 × 浅/暗两个半边都判）。**探针不覆盖清单（如实记录，不假装覆盖）**：① `TextContent.tsx:39` 的 `dark:bg-n-gray-800/50` 表面带 alpha、要在上一层再合成，纯函数算不出；② **输入 chrome 的 `gray-400`/`gray-600`**（`textarea::placeholder` 的 `!important`、`opacity:1`、用户不可覆盖）**不能**用 4.5 探针防——base 自己在六个面上只有 **1.70~2.55:1**（聊天输入框那两面本身还是复合面，见 §7 0a 表 3），加 4.5 的对会红在 base。处置：§7 0a 表 3 给出**六个面 × 四套**的读数与相对 base 的绝对差，判据按面族分（灰阶面 `≤0.10`，表面面只登记、实测最大 **0.56**）；③ **`gray-500`（101 处文字，五对之外最大的未覆盖墨档）**：读数跨在 AA 线上下（浅 4.47~4.83、深 2.67~3.81），登记为 §7 0a **表 3b**（不设阈值）。②③ 与表 3 的灰阶面相对断言**均已由四审裁定划归「灰阶收口」片**（§8-9）。**严重度仍是"高"，但它指向的是契约层，不是这四套**（采纳四审）：本片四套的灰阶是"**保 L 换色相**"，而对比度在近中性灰底上几乎只随 L 变 ⇒ 灰阶面四套与 base 只差 **≤0.02**，**这四套即便染了完整 11 档，实际可读性影响在读数上近乎为零**。风险不在四套、而在**契约对世界开口**——将来任何 full 主题都能这么染，不必继承四套的保 L。⇒ 读这一行的正确姿势是"契约有口、面向前未来任意 full 主题"，既不是"四套本身有问题"，也不是"既然 Δ 小那探针不必加" |
| 2 | `accent` 曾能穿过未探针档位（实测给 `cc-polar` 注入 `--palette-gray-500` 通过） | 中 | **已采纳并关闭**：`SURFACES.compat` 列 `gray` 全 11 档（§4.1），M5 的读法随之翻转（§7.2） |
| 3 | 放松同时放开了现有 5 套内置主题 | 低 | 它们不使用该能力。**回写清单**：契约注释 ＋ 两份研究文档 ＋ **`.agents/skills/theme-authoring/SKILL.md:128-131`** ＋ **四套 `.css` 头注（`:12` 与 `:77`/`:78` 的"343 处表面"）**——该技能写"`--n-gray-*` 别漏…管着 **343 处表面**"，放松之后"别漏"只对 `full` 成立、对 `accent` **恰好相反**（会被 `MUST_NOT_MOVE.accent` 判红），且那句 343 要一并换成 §3.1 的口径与数字（1223） |
| 4 | 四套主题成为**产品维护面** | 中 | 今后加主题要同步守卫、登记、文档；主题不再是"改文件即生效"，改一次要重新构建 |
| 5 | 个人审美进入产品 | —— | 属产品决策，本方案不评价；审阅者若认为不宜，应退回方案 A |
| 6 | 跨仓库搬迁（dotfiles 删 4 文件 ↔ cloudcli 增 4 块） | 低 | 建议 cloudcli 侧提交里注明来源与原始文件；dotfiles 侧提交注明"同步后这四个文件应消失"（§4.6） |
| 7 | 4 条新主题的深色半若与既有 `cc-onedark` 的观感重叠 | 低 | 无功能风险；选择器条目变长 |
| 8 | **editor 只补契约最小集**（浅 5 / 深 6），非契约 chrome 留在基色（浅色 `#17c` 自动补全、`#cceeff44` 活动行、`#f5f5f5` gutter/panel…） | 中 | 初审未覆盖，牵头自记。见 §8-8：补齐到既有 23/28 形态（约 +160 条）或接受接缝 |
| 9 | "**染完整 11 档**"从论据升为契约约定后，未来只想染部分档的主题无处可去 | 低 | 它今天本就无处可去（过不了 `accent`、挂不了 `full`）；语义化改名立项后那批站点改走语义令牌，约束自然消解 |
| 10 | **两处对比度薄边**：`kanagawa` 浅色 `--muted-foreground` on `--background` = **4.52**、`tokyo-night` 浅色 `--primary-foreground` on `--primary` = **4.59**（限值 4.5） | 中 | **二审判定：不动档**——余量是**正的**（+0.02 / +0.09），与 1-H 那次"修红"（`sand-500` 44% → 4.42，余量 −0.08）方向不同；在余量 >0 时动档要牵动四套 L1，收益只是"看着更稳"、没有可证伪的失效。**登记为永久风险**：任何未来对 `sand-` / `brand-` 族的微调，先回看这两处（出处见 §7 0a） |
| 11 | 四套 `.css` 的 46 行头注随文件退场而散落（旧口径、失效的通道 B 说明、不报错的形状约束） | 低 | 已落 §4.6 的五类逐条处置表：**保留**形状约束 ＋ 色值来源，**改写** 343 口径，**丢弃**通道 B 说明 |
| 12 | §8-8 若补齐 editor 到 23/28，**editor 内部的 fg/bg 配对会第一次进对比度套件**，可能再冒薄边 | 中 | 见 §8-8 的表态条款：补齐**同时**要求 editor 内部配对也过门槛（至少 3:1，仿 `--ring/bg`），实施时并入 §7 0a 的读数表——否则补齐换来的"无色接缝"会被一个事先没量、事后才红的 editor 薄边抵消 |

---

## 7. 验证计划与门槛

### 第 0 步（一审新增，必须排在契约跑绿之前）

**0a. 先量"四套 × 现有 6 对 × 2 外观"的对比度**（采纳 WorkBuddy-3）。注册登记后 `contrast.spec.ts:88` 会立刻把这四套拉进判；这一维**用户主题通道从来不量**（`.css` 原样注入、无对比度判定），升内置后它才成为产品契约的一部分。实测（8 位通道取整、与 `contrast.spec.ts` 同口径；自检：base 浅色 `muted-fg/background` 读出 **4.62**，与 `userThemeContrast.ts` 注释记载的 4.62 相同）：

**表 1 —— 现有 6 对。二审补了「限值」列**：`ring/bg` 的限值是 **3** 而不是 4.5，不标出来会让 `tokyo-night` 那格 3.71 与 4.52 并列时被误读成"擦线"。

| 主题 | 外观 | fg/bg | fg/card | muted-fg/bg | muted-fg/card | primary-fg/primary | ring/bg | 判定 |
|---|---|---|---|---|---|---|---|---|
| **限值** | | 4.5 | 4.5 | 4.5 | 4.5 | 4.5 | **3** | — |
| base | 浅 | 18.19 | 19.65 | **4.62** | 5.00 | 4.94 | 4.78 | PASS |
| base | 深 | 15.89 | 14.22 | 6.47 | 5.79 | 5.01 | 5.01 | PASS |
| dracula | 浅 | 15.89 | 16.48 | 5.56 | 5.77 | 5.97 | 6.02 | PASS |
| dracula | 深 | 13.36 | 12.07 | 6.04 | 5.46 | 5.90 | 5.90 | PASS |
| gruvbox | 浅 | 12.99 | 14.74 | 5.74 | 6.51 | 5.85 | 5.40 | PASS |
| gruvbox | 深 | 10.75 | 9.57 | 5.77 | 5.13 | 5.84 | 5.84 | PASS |
| kanagawa | 浅 | 7.75 | 9.30 | **4.52** | 5.43 | 5.27 | 4.59 | PASS |
| kanagawa | 深 | 11.26 | 9.75 | 6.30 | 5.45 | 5.94 | 5.94 | PASS |
| tokyo-night | 浅 | 5.78 | 7.48 | 4.57 | 5.91 | **4.59** | 3.71 | PASS |
| tokyo-night | 深 | 10.59 | 9.63 | 5.82 | 5.30 | 6.79 | 6.79 | PASS |

**8 组全过**，但两处只剩一线，**须点名**（限值 4.5）：
- `kanagawa` 浅色 `--muted-foreground` on `--background` = **4.52**
- `tokyo-night` 浅色 `--primary-foreground` on `--primary` = **4.59**

参照系：1-H 的先例正是**同一条配对的基色**（`--palette-sand-500` 44% → 4.42:1）被判为缺陷、当场改了出厂配色（44%→43%，→4.59）。kanagawa 的 4.52 只比那个被判缺陷的值高 **0.10**。⇒ 实施第一步是决定动不动这两档；**二审已裁定：不动档**（余量为正，见 §6 risk 10）。

**表 2 —— 本次新增的五对（＋可选一对）。这些对第一天就会判这四套**（二审补，读数与 §4.5 同口径；因兼容阶外观无关，浅深两格同值 ⇒ 每对 5 个读数）：

| 新对 | base | dracula | gruvbox | kanagawa | tokyo-night | 限值 | 判定 |
|---|---|---|---|---|---|---|---|
| 对 1 `gray-700 on gray-50` | 9.86 | 9.82 | 9.88 | 9.75 | 9.82 | 4.5 | PASS |
| 对 2 `gray-700 on gray-100` | 9.37 | 9.32 | 9.45 | 9.26 | 9.38 | 4.5 | PASS |
| 对 3 `gray-100 on gray-900` | 16.12 | 15.98 | 16.28 | 16.02 | 16.10 | 4.5 | PASS |
| 对 4 `gray-300 on gray-700` | **7.00** | **6.86** | **7.19** | **6.81** | **6.91** | 4.5 | PASS |
| 对 5 `gray-100 on gray-950` | 18.30 | 18.20 | 18.46 | 18.16 | 18.33 | 4.5 | PASS |
| 对 6（可选）`gray-300 on gray-800` | 9.96 | 9.75 | 10.23 | 9.78 | 9.82 | 4.5 | PASS |

**25 个读数（＋可选 5）全过，余量比表 1 宽得多** ⇒ 这批探针是**为将来的主题**买的护栏，对本次入册的四套**不构成闸门**（这点要写出来，否则"必须同时补五对"读起来像是这四套有风险）。最紧的是**对 4 = 7.00**，比新增对 1/2 的 9.3~9.9 更贴限值，判别力最强。

**表 3 —— 探针覆盖不到的强制 chrome（不是"抽样漏档"，是不该拿 4.5 去卡的切面；二审新增，三审补全表面并定判读口径）**：

`gray-400` / `gray-600` 的**六个读数面**（三审核实：`textarea` 的底有 `bg-n-gray-50`、`bg-background`、`bg-card/80` 三类，浅深各三；出处见 §4.5 的表）：

| 面 | base | dracula | gruvbox | kanagawa | tokyo-night | Δmax |
|---|---|---|---|---|---|---|
| 浅 · `gray-400 on n-gray-50`（`McpServerFormModal.tsx:417` 等五处） | **2.43** | 2.41 | 2.44 | 2.40 | 2.41 | 0.02 |
| 浅 · `gray-400 on --background`（`=sand-50`；`UserThemesSection.tsx:322`） | **2.35** | 2.45 | 2.24 | 2.11 | 1.96 | 0.39 |
| 浅 · `gray-400 on --card`（近似值；真实面是 `--card/80`，见下） | **2.54** | 2.54 | 2.55 | 2.53 | 2.54 | 0.01 |
| 深 · `gray-600 on n-gray-800`（`dark:bg-n-gray-800`，同上五处） | **1.94** | 1.94 | 1.94 | 1.95 | 1.94 | 0.01 |
| 深 · `gray-600 on --background`（`=该主题 ink-950`） | **2.44** | 1.88 | 1.95 | 2.17 | 2.25 | 0.56 |
| 深 · `gray-600 on --card`（近似值；真实面是 `--card/80`，见下） | **2.18** | 1.70 | 1.74 | 1.88 | 2.05 | 0.48 |

> **两行 `--card` 是近似、不是真值（三审自查修正）**：聊天输入框的 placeholder 所在外壳是 `bg-card/80 backdrop-blur-sm`（`PromptInput.tsx:42-43`），真实面是"80% 卡片合成在页底之上"的**复合面**，纯函数算不出（与 §4.5 记的 `dark:bg-n-gray-800/50` 同性质）。表中把它当纯卡片算，真值被同外观的 `--background` 与 `--card` 两行**夹住**（对比度对表面亮度单调 ⇒ 8 成卡片 + 2 成页底必落在两者之间）。⇒ 这两行**不参与判读**，列出来是为了给出区间两端的读数。

**判读口径（三审采纳：把"不得显著劣于 base"从一个程度副词换成可复算的数）**：每格读**该主题与 base 的绝对差**，且**单边**——只判"变低（变差）"方向，判据是 `base − 该主题 ≤ 阈值`。

- **灰阶面**（上表第 1、4 行）：阈值 **0.10**。实测两格的差 ≤ **0.02**（余量 5 倍）。这是本片放松的**那一族**的直接台账：把 `gray-400` 挪到 `gray-300` 的亮度（Y 0.663 vs 0.364）会掉到 1.41（Δ −1.02），当场越界。
- **表面面**（第 2、5 行判读；第 3、6 行是复合面的区间端点、不判读）：**不设阈值，只登记读数与最大值**。这四行的差全由主题自己的 `sand-50` / `ink-950` / `ink-900` 决定，而这三个令牌**本片不动**（`MUST_MOVE.full` 也不含 `--n-*`）——它们今天没有守卫，本片也不新立。实测最大偏离 **0.56**（dracula 深色 `--background`：1.88 vs base 2.44）。

> **为什么不是一个统一的"绝对差 ≤ 0.5"（三审建议值，此处只部分采纳）**：0.5 对灰阶面**太松**（实测只差 0.02，松了 25 倍），对表面面又**不够**（dracula 的深色两个面是 0.56 / 0.48，当场越界）。若为让它过而抬到 0.6，那是**照着数据挑阈值**——正是本方案一路在拒斥的那种口径。⇒ 按**面族**给阈值，而不是给一个统一数。
> **表 3 的用途要说清**：本次迁入是**值原样拷贝**，这六个读数**一个都不会变**；表 3 买的是"这些切面从此有台账"，属**防未来**，不是给现在立闸门。这几档之所以要单列：它们是 `!important` ＋ `opacity: 1` 的输入 chrome，**用户无覆盖手段**，染色坏了没有任何东西会响（唯一"防线"是这句记录本身）。

**表 3b —— 五对之外最大的未覆盖墨档：`gray-500`（三审复核时发现，牵头自记）**。`rg` 实测 **119** 处，其中 **101 处是文字**（73 `text-n-gray-500` ＋ 28 `dark:text-n-gray-500`）；它既无 4.5 探针，也不在表 3 的强制 chrome 里：

| 面 | base | dracula | gruvbox | kanagawa | tokyo-night | Δmax |
|---|---|---|---|---|---|---|
| 浅 · `gray-500 on n-gray-50` | **4.63** | 4.59 | 4.62 | 4.57 | 4.60 | 0.06 |
| 浅 · `gray-500 on --background` | 4.47 | 4.65 | 4.24 | 4.00 | 3.74 | 0.73 |
| 浅 · `gray-500 on --card` | 4.83 | 4.82 | 4.81 | 4.80 | 4.84 | 0.03 |
| 深 · `gray-500 on n-gray-800` | 3.04 | 3.04 | 3.05 | 3.06 | 3.03 | 0.03 |
| 深 · `gray-500 on --background` | 3.81 | 2.95 | 3.06 | 3.40 | 3.53 | 0.86 |
| 深 · `gray-500 on --card` | 3.41 | 2.67 | 2.73 | 2.94 | 3.21 | 0.74 |

对照：`gray-200`（89 处，61 处作边、6 处作文字）作文字时浅色 **1.18** / 深色 **11.86**（四套同档，Δ ≤ 0.24）⇒ 它没有文字场景。

⇒ **登记，不设阈值**（与表 3 的表面面同处置）：只有浅色的 `n-gray-50` / `--card` 两行在 4.5 之上（四套 4.57~4.84），其余四行**出厂即低于 AA**。唯一立得住的形式是**只对浅色灰面/卡面两行立 4.5 探针**（同时把它们并入 §4.5 的 `CONTRAST_PAIRS` 与 `BASE_PAIR_COLORS`）——**四审已裁定：本片不做，连同表 3 的灰阶面相对断言一起划归「灰阶收口」片**（理由同 §8-9：只守半边，与"完整的可读性"口径不符）；本表在本片的作用只是**台账**。

**0b. 自证 `BASE_PAIR_COLORS` 的出厂值**（采纳 Claude-1）：新对进 `CONTRAST_PAIRS` 就要进 `BASE_PAIR_COLORS`（`:76`，存的是**出厂 base 的已解析 triplet**），而 `contrast.spec.ts:140` 会拿它比样式表。**先单独跑一次这条**确认新对的出厂值 ≥ 限值并且与样式表一致——否则抄错一位会让 `contrast.spec.ts` 红一片，且排错时容易被误读成"某套主题不合格"。出厂值的精确读数（二审替换原"约 8:1"的估算）：对 1 **9.86**、对 2 **9.37**、对 3 **16.12**、对 4 **7.00**、对 5 **18.30**；这一步是**证伪抄写错误**，不是证伪配比。

### 主流程

1. **契约跑绿**：`npm run test:theme-tokens`（chromium ＋ webkit 两引擎）。
   基线是 **174 tests / 16 files**，其中 `[chromium]` **87** 条 ⇒ 87×2＝174（一审修正：原写"87 passed（两引擎）"把单引擎数当成了两引擎总数）。本片加 4 条 `system` 主题 ⇒ **每引擎 +12、两引擎 198**（§4.4）。
2. **变异检验（证明新守卫非空转）**：
   - M1 给某套新主题删掉一条 editor 声明 → `mustMove` 红
   - M2 给某套新主题删掉整块语法板 → `SYNTAX_BOARD_THEMES` 守卫红
   - M3 **把 `--palette-gray-700` 染到不合读 → 对 1 / 对 2 / 对 4 必须红**。这条同时也是"**旧防线已撤、新防线在顶岗**"的实证：`gray-700` 原先在 `fixed` 里（旧防线会以 `moved surfaces it does not advertise` 拦住），如今只有探针拦得住。
     （**二审修正**：原写"把 `--palette-gray-50` 调成浅色墨不可读"——`gray-50` **从来不在** `fixed`（`:120` 只有 white / black / 100 / 700），那条变异没有"旧防线"可撤，括注对它不成立。）
   - **M3′（一审新增）** 把 `--palette-gray-100` 染到不合读 → **对 2 / 对 3 / 对 5 必须红**。这条是**新增探针的意义所在**：只加对 1 时它**不会红**（`gray-100` 一个配对都没判），加了之后它才是守卫
   - **M3″（一审新增，负对照）** 把**仍无任何探针覆盖**的档位 `--palette-gray-600` 染到不合读 → **绿**，作为 §4.5 末尾记录的**残留盲区**的实证。
     （**二审定档**：原举例是 `gray-300` / `gray-500`。`gray-300` 被新增的对 4 / 对 6 覆盖后不再适用，`gray-500` 是纯理论档；改点名 **`gray-600`**——它是**无探针**的，又是被 `textarea::placeholder`（`!important`、`opacity: 1`、用户不可覆盖，`index.css:906-910`）**真实消费**的档。用会被真实 UI 消费的档做负对照，比用抽象档更能暴露放松的边界，也与 §4.5 表 3 的"占位对不能立"呼应。**这条必须写进方案并预期为绿**，否则实施者会把一条该绿的空转读成回归。）
   - M4 给 `cc-ocean`（`accent`）注入 `--palette-gray-100` → `accent` 的禁移必须红
   - M5 **读法已翻转（一审）**：给 `cc-ocean` 注入 `--palette-gray-500` → 采纳 §4.1 的全 11 档之后**必须红**（原先写"→ 绿，记为已知盲区"）。定稿时二选一写死：要么补全后它是守卫，要么不补全时它是空转——不允许存在一条永远绿的变异
3. **静态核对**：脚本按选择器解析 `src/index.css`，逐令牌比对"落盘值 == 设计表"，**84 条**全绿（口径见 §4.2；若选择重声明浅色 `--editor-fg` 则为 88，两种口径选定时要一致）。

   **阶序 = 同一张核对表的第二列（采纳三审，从"审计项"抬上来）**：逐档给出重染后 `--palette-gray-50..950` 的亮度，核对**档号递增 ⇒ 亮度递减**单调，并记下最小的相邻间隔。**实施前已先复算一遍**（本轮，两口径都算）：

   | 主题 | `gray-50 → 950` 的 HSL L 序列 | 单调（L / Y 两口径） | 最小相邻间隔 |
   |---|---|---|---|
   | base（参照） | 98.00 95.90 91.00 83.90 64.90 46.10 34.10 26.70 16.90 11.00 4.10 | ✓ / ✓ | 2.10 L · 0.01 Y |
   | dracula | 98.00 95.90 91.00 83.90 65.99 47.24 36.06 28.63 19.04 12.31 4.89 | ✓ / ✓ | 2.10 L · 0.01 Y |
   | gruvbox | 98.00 95.90 91.00 83.90 62.64 43.54 31.75 23.98 14.66 8.48 2.33 | ✓ / ✓ | 2.10 L · 0.01 Y |
   | kanagawa | 98.00 95.90 91.00 83.90 66.31 47.66 36.58 29.22 19.64 12.89 5.47 | ✓ / ✓ | 2.10 L · 0.01 Y |
   | tokyo-night | 98.00 95.90 91.00 83.90 65.91 47.13 35.93 28.49 18.89 12.17 4.76 | ✓ / ✓ | 2.10 L · 0.01 Y |

   （`Y` = WCAG 相对亮度，与 §7 0a 同口径；两个口径都判是因为 `L` 是作者写的量、`Y` 才是绘制后真正决定观感的量，而它们在本例中同为单调。最小间隔都落在 **50 → 100** 档，与基色同值 ⇒ 这是**继承来的**间隔，不是四套自己压出来的。）
   逐档点亮之后，这列就是 §8-7「要不要加单调性断言」的**现成判据**：真要做断言，两条口径与这条下界（`2.10 L`）都是现成的，可随时抬成一条 `theme-overlays.spec.ts` 的断言而不必重新定度量。
4. **真机复验**：**10 个覆盖层主题**（6 现有 ＋ 4 新增；`cc-light`/`cc-dark` 不是覆盖层不算）× 2 外观 × 4 类面（editor 6 槽 / graph 10 lane / 代码块 / 终端）读 computed 值。断言两处：
   - `--editor-bg` 应等于该主题自己的 **`--code-block-bg`**（**不是** `--background`——一审修正；`code-block-surface.spec.ts:60` 就是这条）
   - 语法板与 `--code-block-bg` 与四套 `.css` 迁移前的值逐槽一致（值原样）
   - **阶序 quick check（三审新增，一行命令的事）**：对四套各读一次 `--n-gray-50..950` 的 computed 值，取 L 序列与第 3 步的表逐位对齐。它与静态核对是同一条数据的两个来源（一张是表格、一张是浏览器），不一致就说明选择器或继承链出了岔。
5. **门槛**：`npm run typecheck` · **`npm run typecheck:theme-tokens`**（一审补：本方案改的是 `tests/theme-tokens/*.spec.ts`，由 `tests/theme-tokens/tsconfig.json` 单独管；根 `typecheck` **不覆盖**它，而 `build:client` 走 vite/esbuild、不做类型检查）· `npm run lint` · `npm run build:client` 全 0；`npm test` 与 `test:client` 无回归。
6. **产物核对**：`dist` CSS 里 4 套新 `[data-theme=cc-*]` 规则块存在且总字节增量与预期一致（覆盖层声明进产物、不进基线）。

---

## 8. 待决问题（请审阅者表态）

1. **该不该放松**：把兼容灰阶从"所有主题禁移"改为"仅 `accent` 禁移"——你是否同意？反对意见请针对 §3.1 的三条证据，而不是"契约应尽量严"的一般原则。
2. **`accent` 的禁移集合**（一审已裁定，四审后扩到四族）：原方案只挂 2 档，实测 `--n-gray-500` 可穿过。**牵头已采纳一审意见改为全 11 档；四审后又发现 `zinc`/`slate`/`neutral` 三族一档都没挂（同样能穿），故一并纳入**（§4.1、§10.3）。确认点：集合是**兼容层四族 44 档**（`gray` / `zinc` / `slate` / `neutral` 各 11 档）。
3. **探针挂哪**：挂进共用的 `CONTRAST_PAIRS`（一处书写、两侧共用、用户主题也受警告）还是写成 `theme-overlays.spec.ts` 的独立断言？（前者更单一来源，后者更局部。）两轮新增的**五对（＋可选一对）**也一并按此决定。**四审已显式确认：挂共用的 `CONTRAST_PAIRS`**（单一来源、两侧共用、用户主题同受警告；本片所有新增对已按此写成 diff，不存在"独立断言"的动机）。
4. **中文名**：`dracula → 德古拉` 较无争议；`gruvbox / kanagawa / tokyo-night` 是否也意译成 `复古盒 / 神奈川 / 东京夜`，还是保留拉丁原名？（现有 6 条内置全是中文名：海洋 / 极地 / 卡布奇诺 / 岛屿 / 暗夜一号 / 暗夜一号·浓彩）**四审已显式确认：全部意译**（`德古拉 / 复古盒 / 神奈川 / 东京夜`）——与现有 6 条内置一致，`.css` 迁入注册表后中文名是唯一能自报的名字。
5. **是否需要第三档 `coverage`**：本方案判断"不需要"（§5-C）。若你不同意，请指出补完 §4.2 之后四套还缺哪一族的承诺。**四审已显式确认：不需要**（随 §8-8 补齐后四套即是合规 `full`）。
6. **跨仓库搬迁**：dotfiles 侧删除 4 个文件、cloudcli 侧新增 4 个块。是否接受这种"内容搬家"？**四审已显式确认：接受**。前置是 §4.6 的头注处置表（二审产出）＋ §9 收尾清单把"内容搬家"与 S 线遗留分开提交。
7. **要不要加"档位单调性"断言（一审新立）**：一审提出，§3.1 的论据是"**协和的整阶重标定**"，而现行契约对"重染得协不协和"**零约束**——染成 11 个乱序亮度也能过。可选加固是在 `theme-overlays.spec.ts` 加一条"11 档亮度单调 ＋ 相邻档间距下界"的断言。
   牵头倾向：**本片不做**，理由是该断言是一个**新机制**（要定义度量——纯 L 单调还是感知亮度单调、间距下界取多少、要不要按外观分别判），塞进"放松一条守卫"的片里是范围膨胀；且 §4.5 的五对探针已经守住了"可读性"这个正确性面。**但它确实是 §3.1 那条论据的正向守卫**——若你认为应当现在就加，请给度量口径，我按此立片。**二审的折中已采纳**：本片不做断言，但把"11 档亮度单调"写成 §4.2 的核对项（提交说明须声明阶序）。
   **三审进一步：已把度量口径先做出来，只是不立断言**。逐档 L / Y 序列与最小间隔已在 §7 第 3 步的阶序表里**先复算并列齐**（四套两口径均单调，最小间隔 2.10 L / 0.01 Y，落在 50→100 档、继承自基色），真机复验也加了逐档 quick check。⇒ 这一问的剩余部分已经很小：**要不要把这张现成的表抬成断言**。牵头仍倾向不加（同一理由：新机制、且它是"造型"约束而非"可读性"约束），但若你要加，度量、下界、判两外观与否三件事都不用再定，照 §7 第 3 步那张表写即可。
   **四审已把 (b)（灰阶面相对断言）判为与本问同族的"造型约束"并转交「灰阶收口」片**（§8-9）⇒ 本问牵头倾向**同样归该片**：本片是"给放松补可读性防线"的片，不掺造型机制。
   **定稿裁定（2026-09-30，用户按牵头倾向表态）：本片不加断言，阶序表留在 §7 第 3 步作核对项、并连同 (b) 与 `gray-500` 探针划归「灰阶收口」片。** ⇒ 此项**关闭**。
8. **editor 补值取"契约最小集"还是"匹配既有形态"（牵头自记，一审未覆盖）**：本方案补 6 个 `MUST_MOVE` 槽，而**既有 5 套主题是 23（浅）/ 28（深）个 editor 令牌**。差额约 **40 槽/套 × 4 ＝ 160 条**，不补的后果是编辑器页**非契约 chrome 保持基色**（浅色 `#17c` 自动补全高亮、`#cceeff44` 青色活动行、`#f5f5f5` gutter/panel、tooltip、minimap…），在四套主题的浅底上会看得见接缝——**这正是我用来反对放松 `full` 的那条理由，只是位置挪到了 editor 面的内部**。
   牵头倾向：**补齐**（既然四套各自都定义了齐备的沙/墨档，映射是机械的：bg 类 → `sand-50/100`、fg 类 → `sand-800/950`，深色同理），但这会把本片的改动面从 84 条扩到约 244 条。请你表态：**要不要在本片一并补齐**，还是先落最小集、把接缝作为下一片。
   **二审加的一条约束（必须与表态绑定）**：补齐后 editor 从"6 槽契约最小集"变成"23/28 个真实令牌"，其中 **fg 类（`--editor-fg` / `--editor-toolbar-fg` / gutter-fg）与 bg 类（panel / loading / gutter-bg / toolbar-bg）的内部配对会被第一次拉进对比度判定**。这与 §7 0a 那两处薄边是同一性质的风险，只是面从 substrate 挪进了 editor。⇒ 若选"补齐"，**同时**要求 editor 内部 fg/bg 配对也过门槛（至少 3:1，仿 `--ring/bg`），并把读数并入 §7 0a 的读数表（§6 risk 12）；否则补齐的收益（无色接缝）会被一个事先没量、事后才红的 editor 薄边抵消。
   **三审要求的"映射依据"已产出，且它比预期简单得多（见附录 C）**：三审指出"机械映射只证明了**值的可达性**，没证明**每个槽该落哪一档有明示依据**"，并要求先出一张"既有 5 套 editor 逐槽 → L1 档"的提取表。表已按 `src/index.css` 逐块解析产出（附录 C），结论是它**几乎没有二义性**：浅色 **23 槽在 5 套之间逐槽完全相同**；深色 28 槽里 **22 槽相同**，只有 6 槽（`bg` / `gutter-bg` / `loading-bg` / `minimap-bg` 与 `panel-bg` / `active-line-gutter-bg`）分两列，且分列的唯一轴是"**该主题自己的底板取 `ink-950` 还是 `ink-900`**"。⇒ 三审担心的"不同作者会给 tooltip / active line / minimap 给出相反的答案"**在既有 5 套上不成立**（它们连 tooltip、minimap、ghost text 的取值都一致）；四套的底板是 `ink-950` ⇒ **照 `polar/catppuccin/islands` 那一列逐槽抄**即可。这一条不改变"要不要补齐"的表态题，但把"补齐需要一个新的人工推断层"这个反对理由去掉了。
   **四审确认（采纳批注 2）：抄哪一列没有歧义——四套取左列（`ink-950` 系）。** 正文已两处写死：§4.2 的深色 recipe（`src/index.css:250` 一带"四套的底板是 `ink-950` ⇒ 取 `ink-950`"）与附录 C.3（"四套的 `--code-block-bg` 是 `ink-950`（§3.2）⇒ 照左列逐槽抄"）。⇒ 若 §8-8 选"补齐"，实施就是**照左列抄 23/28 槽，不含取舍、不需要再补一行映射依据**。
   **定稿裁定（2026-09-30，用户按牵头倾向表态）：本片一并补齐到既有 23/28 形态（约 244 条），照附录 C 左列抄。** 与之一并生效的二审绑定条款：**editor 内部 fg/bg 配对须过门槛（至少 3:1，仿 `--ring/bg`）**，读数并入 §7 0a 读数表（§6 risk 12）。⇒ 此项**关闭**，改动面由 84 条定为约 **244 条**。
9. **输入 chrome（placeholder / caret）的 `gray-400` / `gray-600` 要不要立防（二审新增，三审已把判读口径定下来）**：这两档被 `!important` 的 `textarea::placeholder`（`index.css:900-917`）与 `.dark textarea`（`:861-865`）**独占消费且不可被用户覆盖**，而现有与新增探针**一对都不覆盖它们**（§4.5 表 3）。
   但**它们不能照搬 4.5 探针**——实测 base 自己在六个读数面上只有 1.70~2.55:1（其中两个是复合面的近似端点；全表见 §7 0a 表 3），加 `min: 4.5` 的对会立刻红在 base（那不是发现缺陷，是拿错了限值）。
   **三审的"需要一个可复算判读口径"已照办**：§7 0a 表 3 现在给出六个读数面 × 五主体的读数与"相对 base 的绝对差"，判据是**单边的**（只判变差），阈值**按面族分**——灰阶面 `≤ 0.10`（实测差 ≤ 0.02），表面面不设阈值只登记（实测最大 0.56，由主题自己的 ink/sand 决定，本片不动那三个令牌）。三审建议的统一 "≤ 0.5" **未被采纳**，理由写在表 3 下方（对灰阶面太松、对表面面又会让 dracula 当场越界）。
   ⇒ 原剩两个选项：**(a)** 只留这张表、不立断言；**(b)** 把表 3 的**灰阶面那半**抬成一条相对的断言（灰阶面那两行有现成的度量与阈值：`base − 主题 ≤ 0.10`；表面面那四行**没有**可归因的度量，立不了）。
   **四审裁定：取 (a)，并把 (b) 从"本片备选"改成一句明确的转交（采纳四审）。** 四审指出的判据是**它约束的是什么**：`base − 主题 ≤ 0.10` 是一条**真守卫**（任何把灰阶 L 染动的 full 主题都会让它响，不是 M3″/M5 那种任何输入都不红的变异），但它约束的是"主题须保持灰阶的 L 序"，属**造型约束**（＝ §8-7 那一族），不是本片放松引入的**可读性**违约。在本片立它，等于把一条与可读性无关的造型约束混进"给放松补防线"的片里。
   ⇒ **成交口径（写死，防下一片重推）**："灰阶面相对断言的度量与阈值已备齐（本表 `≤ 0.10`），待 **「灰阶收口」片**随 `gray-500` 那对一起立，本片不立。"——本片不留备选、不重新论证。原选项 (c)（认为 placeholder 就该按 4.5 卡、先把 base 修到位）**三审未再坚持**，仍不在本片范围：placeholder 的 1.9~2.5:1 是**产品既有状态**、不是本片放松造成的，顺手抬到 4.5 会改变四套 ＋ base 的观感。
   **另有一条与 placeholder 无关、但同属"未覆盖档"的可收紧项（三审复核时牵头顺带发现）**：`gray-500`（101 处文字）在**浅色灰面/卡面**上是 **4.57~4.84**，**能过 4.5**（表 3b）。⇒ 它是这一轮里唯一"可以顺手补一对真 4.5 探针"的未覆盖档（`{ ink: '--n-gray-500', surface: '--n-gray-50', min: 4.5 }`），成本是再进 `BASE_PAIR_COLORS` 一格；它**不改任何达标面**（base 4.63 已过、既有五套不动灰阶）。
   **四审裁定：不为 `gray-500` 补探针，与 (b) 一同划归「灰阶收口」片（采纳四审）。** 理由与 (b) 同源：它只在浅色半边能过（4.57~4.84）、深色半边出厂即不达标（3.04 / 3.81 / 3.41），补浅色只守半边，与本片"对价探针买的就是**完整的**可读性"口径不符。⇒ 本片只留表 3b 台账，探针留给收口片整体做。
   牵头倾向仍是 **(a) ＋ 不补**，理由同上：本片的目标是"给放松的守卫补上等值的防线"，而表 3 / 表 3b 买的是**台账**（本次迁入是值原样拷贝、读数一个都不变）。**四审已确认此倾向，并把它定为定稿裁定。**

---

## 9. 收尾清单（交付前必做，**不是**待决问题）

三审指出：下面这些是**动作**，不是"请审阅者表态"的条目，散在 workspace 里，**方案审过 ≠ 代码落库**。单列在此，避免被"方案通过"的满足感盖住。

| # | 动作 | 侧 | 归属 / 判据 |
|---|---|---|---|
| 1 | 四套 `.css` 从 `cloudcli/.cloudcli/themes/` **删除**（与 cloudcli 侧新增的 4 个块是同一笔内容搬家） | dotfiles | 本片。提交信息注明"同步后 `~/.cloudcli/themes/` 下这四个文件应消失"（§4.6） |
| 2 | `src/index.css` 增 4 块 ＋ `constants.ts` 加 4 条 ＋ `SYNTAX_BOARD_THEMES` 加 4 名 ＋ 契约放松一处（§4.1） | cloudcli | 本片。以 §7 主流程 1–6 全绿为完成判据 |
| 3 | 三处回写：契约注释 / `.agents/skills/theme-authoring/SKILL.md:128-131` / 两份研究文档（343 口径 → 1223） | 两侧 | 本片（§6 risk 3） |
| 4 | **上一片遗留**：`tests/theme-tokens/user-theme-shape-contract.spec.ts` ＋ `docs/research/CloudCLI用户主题补齐语法板与代码块底方案.md`（均**未跟踪**），以及 `src/index.css` / `tests/theme-tokens/theme-overlays.spec.ts` / 两份研究文档的**已改**内容（语法板接管 ＋ 通道 A 浅色补齐） | cloudcli | **不是本片**。按 `feat(theme):` / `docs(theme):` 落成独立两笔，**不要**与第 2 条混进同一提交，否则回头 split 不出来 |
| 5 | 仓库里另有**非主题**改动同时未提交（`server/modules/providers/*`、`src/modules/chat/composer/*`、`src/shared/types.ts`、`server/shared/types.ts`、`composerModelMenu.test.tsx`） | cloudcli | 另一条工作流，提交时按功能拆开，别并进主题那笔 |
| 6 | `~/.cloudcli/themes/console.css` 仍无语法板 | dotfiles | 独立线（不在本片，见附录 A） |

> 第 4 条现在**可以立刻做**，不必等本片批准——它是已完成工作的落库，与"要不要升内置"这个决策无关。三审的原话是"审批完不等同于代码落库"，这一条就是它指的那件事。

---

## 10. 附带盘点：约束还能放开吗（2026-09-30 定稿后追加）

> 用户定稿后追问"另外约束是否有适当放开"。本节是**回答**，不是新的待决项。结论：**本片不再放开任何一条**；并把**一处对称缺口收紧**（三族，10.3，**已裁定取 (i)**）；另有一处真实残留收紧（浅色卡面，10.4）**不予放开**。

### 10.1 契约今天管着哪些面（`theme-overlays.spec.ts`）

| 面 | 令牌数 | `MUST_MOVE.full` | `MUST_NOT_MOVE.full` | `MUST_NOT_MOVE.accent` |
|---|---|---|---|---|
| accent 家族 | 4 | — | —（可动可不动） | —（**必移**） |
| substrate | 11 | ✓ 必移 | — | ✓ 禁移 |
| terminal | 7 | ✓ | — | ✓ |
| editor | 6 | ✓ | — | ✓ |
| graph | 3（探针；语义 10 lane） | ✓ | — | ✓ |
| `cardSurface` | 2 | **仅深色** | **浅色禁移** | ✓ |
| `fixed`（`--n-white`/`--n-black`） | 2（本片后） | — | ✓ 禁移 | ✓ |
| `compat` | **44**（四族 × 11 档；本片后） | 可动、不强制 | — | ✓ 禁移（**本片新增**；四族原先 0 档被守） |

⇒ 本片把 `compat` 从"`gray` 2 档、full 也禁移"改成"**四族 44 档、仅 `accent` 禁移**"，其余一律不动。以下逐条判断"能不能再放开"。

### 10.2 `--n-white` / `--n-black`：**可放开，但不应放开**

- 现状：`fixed`，full 也禁移（3.1 证据三已改写理由）。
- 判断：**不放开**。两条理由都是可证的——① 纯白/纯黑作**填充与标签**时，重染的对比度风险最高（白字压灰 / 黑字压亮，最容易失效）；② 站点量 **257** 处，远超任何单套主题宣称的面。
- 补一笔：四套主题**一个都没声明**它们（实测 `grep`），放开也无人用 ⇒ 属 YAGNI。
- 若将来真要放开（比如某主题确实需要暖白卡面），判据应先量 **white/black 参与的配对**，而不是直接移出 `fixed`。

### 10.3 【本次新发现】`zinc` / `slate` / `neutral` 三族在 `accent` 侧是**同类漏网**

- 现状：三族（66 ＋ 51 ＋ 40 ＝ **157** 站点）**既不在 `fixed`、也不在 `MUST_NOT_MOVE.accent`**，且 `derivedMoves` 的判据是"**包含即允许**" ⇒ **`accent` 主题声明 `--palette-zinc-*` 就能穿过**，把 157 处冷灰染掉而仍挂"只动强调色家族"的 `accent` 徽标。
- 与 `gray` 是**同一机制、同一处 diff**：本片之所以把 `gray` 的禁移从 2 档（100/700）改为全 11 档，正是因为"`--n-gray-500` 能穿过"；三族**连 1 档都没挂**，比当时的 `gray` 更宽。
- ⇒ 这与"本方案只收 `gray` 一族"（§3.1 范围边界）**不是同一件事**：范围边界说的是"**四套主题不重染**三族"，而这里说的是"**`accent` 主题可以染**三族"。前者是主题侧的选择，后者是契约侧的漏洞。
- **两个选项**：
  **(i) 本片顺手扩到四族**：`SURFACES.compat` 由 `gray` 11 档扩为 **4 族 44 档**（或在 `accent` 的禁移里补三族），`accent` 的禁移清单 **31 → 73** 项、**不新增用例**；**四套主题仍只染 `gray`**（范围边界不变）。徽标语义（"不碰兼容层任何一族"）自此自洽。
  **(ii) 维持"只 `gray`"**：则须在契约注释里**明写**"`accent` 承诺不覆盖 `zinc`/`slate`/`neutral`"，接受徽标语义打折——今天的纯理论风险（**没有任何主题会去染**），但下一位维护者会再问一次同一句。
- **裁定（2026-09-30，用户按牵头倾向）：取 (i)，本片扩到四族。** 理由：同一处 diff、零新用例、与"补全 `gray` 11 档"是同一次判断；不做的话，这份方案等于只堵了四条里的三条。⇒ §4.1 的 `compat` 已按 44 档改写，`accent` 禁移终值 **73**。
  > **顺带修正一处算术**：本轮算 (i) 的代价时才发现，原写"31 → 42"本身就错（`fixed` 由 4 减到 2 没算进去，只收 `gray` 应是 **40**）。详见 §3.1 的算术修正 —— 四轮评审都没走到这一步。

### 10.4 浅色 `--card` / `--popover` 恒纯白：真实残留收紧，**两层约束叠加**

- 现状：`cardSurface` 只在 full 的**深色**外观进 `mustMove`，浅色进 `mustNotMove`（spec:411-419）⇒ **full 主题只能在深色动卡面，浅色卡面恒为纯白**。
- 四套主题**不声明 `--card`/`--popover`**（实测 `grep`，四套一个都没有），深色卡面是沿 `--palette-ink-900` 自动跟随 ⇒ **无冲突、无需处理**。
- 但这是"约束还能不能放开"的一个真实答案：**想给浅色卡面染色，要同时放开两层**——① `cardSurface` 对 full 浅色放行；② `--palette-white` 从 `fixed` 放行（因为浅色 `--card: var(--palette-white)`）。而 white 的风险评估恰是 10.2 里"最高"那条。
- ⇒ **不放开**。这不是遗漏：浅色卡面靠纯白从暖沙底上"浮起来"，是产品视觉基调；染色会同时牵动**卡面上大量 `n-*` 站点**的对比度（`--background` 与 `--card` 两面的读数差见 §7 0a 表 3）。

### 10.5 明确**不该**放开的

- **`accent` 的 substrate / terminal / editor / graph 禁移**：这正是 `accent` 徽标的承诺（"只动强调色家族"）；放开等于徽标失信。
- **`MUST_MOVE.full` 的 editor / graph**：本片用"补齐"而非"放松"解决（§3.2）——它们是 **16 个有现成配方的值**，放松会让"完整"徽标失去内容。
- **语法槽**：本就不在 `SURFACES`（能改、不承诺，`cc-polar` 无板是其例），已是最松形态，**没有约束可放开**。

### 10.6 总表

| 候选 | 现状 | 裁定 | 一句话理由 |
|---|---|---|---|
| `zinc` / `slate` / `neutral` | `accent` 也能染（漏） | **已收紧**（本片，10.3-(i)） | 与 `gray` 同类漏洞，比当时更宽；157 站点 |
| `--n-white` / `--n-black` | full 也禁移 | **不放开** | 对比度最高风险 ＋ 257 站点；四套不用（YAGNI） |
| 浅色 `--card` / `--popover` | full 浅色禁移 | **不放开** | 与 `--palette-white`（fixed）两层叠加；卡面靠纯白浮起 |
| `accent` 的 substrate 等 | 禁移 | 不放开 | 徽标承诺 |
| 语法槽 | 无约束 | —— | 已最松 |

> **一句话**：本片**放一条（`compat`／四族 44 档）、收一条（三族从"无人在守"并入同一处禁移）**，其余都属"有理由不动"。10.3 是本次追问的净增量——四轮评审都没点到它；本片据 (i) 已把它并入同一次 diff。

---

## 附录 A：本方案**不改**的东西（避免审阅者误以为范围更宽）

- `--n-white` / `--n-black` **继续冻结**（理由按二审改写：纯白/纯黑作填充与标签时，重染的对比度风险最高、承担的站点量最大——**不是**"外观无关"，那条与事实不符，见 §3.1 证据三）
- **输入 chrome 的 `--n-gray-400` / `--n-gray-600` 不在本方案的防线内**（`textarea::placeholder` 的 `!important` 切面；base 自己在六个读数面上只有 **1.70~2.55:1**，**不能**用 4.5 探针防，见 §4.5 表 3 与 §7 0a 表 3 的判读口径、§8-9）
- **兼容层的另外三族：契约上纳入禁移、主题上不重染**——`zinc` / `slate` / `neutral`（157 处）原先**不在任何清单**（`accent` 也能染），本片把它们并入 `accent` 禁移（§4.1、§10.3-(i)）；但**四套主题仍只重染 `gray`**，三族迁入后仍冷灰（§3.1 的范围边界 (a)/(b)）
- `full` 的 `MUST_MOVE` 清单**一字不动**（substrate 11 ＋ terminal 7 ＋ graph 3 ＋ editor 6）
- 语法板**不进 `SURFACES`**（它是可选面：能改、不承诺——`cc-polar` 就没有板），这条口径沿用
- `cc-polar` 不补语法板（自造主题、无参照物，既有决策）
- **mermaid 图 / 链接色 / 状态与图标色不跟主题**——三条独立线，不在本方案范围内
- `console.css`（`user-console`）**不参与本次升迁**：它除配色外还改了全站直角、JetBrains Mono、关毛玻璃、浮岛外壳、滚动条，且把 `--n-gray-*` 直接写在 L2（绕开 L1）——性质与四套不同，需要单独立项
- 阶段 0 的兼容阶梯**不退役**（语义化改名未立项）

## 附录 B：取证清单（每条结论的来源）

| 结论 | 来源 |
|---|---|
| 四套染完整 11 档灰 | 逐文件 `--palette-gray-*` 提取，四套均 50…950 |
| editor 缺口浅 5 / 深 6 | 脚本：基色 `:root`/`.dark` ＋ 主题块合并 → `var()` 链解 → 逐令牌比对 `MUST_MOVE.full` |
| sand/ink 档位齐备（6＋6） | 逐文件 `--palette-sand-*` / `--palette-ink-*` 提取，四套一致 |
| 既有主题 editor/graph 配方 | `src/index.css:1613 / 1643 / 1653 / 1664 / 1670 / 1671 / 1680 / 1794 / 2015 / 2264 / 2474` |
| 深色 editor 基色是字面量 | `src/index.css:484 / 495 / 524 / 526` |
| 探针配对的真实绘制点（五对＋可选一对） | 对 1 `src/modules/chat/tools/ContentRenderers/TextContent.tsx:39`；对 2 `src/modules/version-upgrade/VersionUpgradeModal.tsx:250,258`、`src/modules/mcp/McpServerFormModal.tsx:244,255,294`、`src/modules/task-master/TaskEmptyState.tsx:96`；对 3 `TextContent.tsx:31`；对 4 = 对 2 的暗色半 `dark:bg-n-gray-700 dark:text-n-gray-300`（`VersionUpgradeModal.tsx:250,258`、`TaskEmptyState.tsx:96`）；对 5 = `TextContent.tsx:31` 的暗色半 `dark:bg-n-gray-950`；对 6 = `McpServerFormModal.tsx:244,255,294` 的暗色半 `dark:bg-n-gray-800` |
| 暗色半的量级 | `dark:text-n-gray-300` 53 处、`dark:bg-n-gray-800` 71 处、`dark:bg-n-gray-700` 27 处（`rg -o --no-filename`，`src`，排除 `**/tests/**`）；对 2 的浅色半（同一 `className` 上 `bg-n-gray-100` ＋ `text-n-gray-700`）只有 9 处 |
| 输入 chrome 的两档 | `src/index.css:900-903` `textarea::placeholder { color: hsl(var(--n-gray-400)) !important; opacity: 1 !important }`；`:906-917` `.dark textarea::placeholder` 与 `.dark textarea.bg-transparent::placeholder` 用 `--n-gray-600`（另 `:919-955` 的 `.chat-input-placeholder` 与 `::-webkit-` / `::-moz-` 变体同色）；`:861-865` `.dark textarea` 的 `color` / `caret-color` 用 `--n-gray-100`。base 在**六个读数面**上的读数：浅 `2.43 / 2.35 / 2.54`、深 `1.94 / 2.44 / 2.18`（每组第三个是复合面的近似端点；逐面见 §7 0a 表 3） |
| `--n-white` / `--n-black` 的真实消费面 | `text-n-white` 143 处、`bg-n-white` 51 处、`bg-n-black` 36 处（合计 257）；"终端选区 chrome"那一路只有 `hsl(var(--n-black) / 0.1)` 四处（`index.css:1032 / 1124 / 1383 / 1387`）；旁证 `McpServerFormModal.tsx:243` 的 `bg-blue-600 text-n-white` |
| `accent` 的 `MUST_NOT_MOVE` 项数 | `theme-overlays.spec.ts:132-140` 展开 = substrate 11 ＋ terminal 7 ＋ editor 6 ＋ graph 3 ＋ fixed 4 = **31**（现状）；本片把 `fixed` 的 `--n-gray-100/700` 移入 `compat`、并把 `compat` 定为四族 44 档 ⇒ `…＋ compat 44 ＋ fixed 2` = **73**（只收 `gray` 时是 **40**；原写"31 → 42"漏算 `fixed −2`，见 §3.1 算术修正与四审复算） |
| 四套文件头注五类内容的落点 | `dracula.css`（1-46 行）：`:2` 标题、`:12` 与 `:77` 的 343 口径、`:25-28` 通道 B 说明、`:30-36` 形状约束、`:38-43` 不变量偏离、`:45` 色值来源；`gruvbox.css` / `kanagawa.css` / `tokyo-night.css` 同构（`:12` / `:25` / `:38` / `:45`或`:46` / `:77`或`:78`） |
| 新增五对＋可选的对比度读数 | 脚本同 §7 0a 口径；base / dracula / gruvbox / kanagawa / tokyo-night 逐位复现（对 4 最紧 = 7.00 / 6.86 / 7.19 / 6.81 / 6.91） |
| 深色 `--editor-bg` 被代码块底板钉死 | `tests/theme-tokens/code-block-surface.spec.ts:60`（`boards.editor === boards.reference`，两外观都判，`reference` 由 `var(--editor-bg)` 绘制）；四套底板 `dracula.css:124/148`、`gruvbox.css:128/148`、`kanagawa.css:128/151`、`tokyo-night.css:126/149` |
| 既有 overlay 的 editor 形态是 23（浅）/ 28（深）个令牌，graph 10 条声明在**裸块** | 脚本按 `[data-theme="cc-*"]` 的选择器形态分块统计（5 套 full 主题一致） |
| 四套 × 6 对 × 2 外观的对比度读数 | 脚本与 `contrast.spec.ts` / `userThemeContrast.paintedChannels` 同口径（8 位通道取整）；自检 base 浅色 `muted-fg/background` = 4.62，与 `userThemeContrast.ts:104-105` 注释记载的 4.62 一致 |
| `--n-gray-50/100/300/700/900/950` 已在 fixture 探针集合内 | `tests/theme-tokens/main.ts:120`（`NEUTRAL_SCALE_PROBE_TOKENS = SCALE_TOKEN_NAMES + EXTREME_TOKENS`）＋ `src/shared/tests/neutralScale.ts:27-31`（`NEUTRAL_FAMILIES` 4 族 × `NEUTRAL_STEPS` = 50…950 十一档 ＋ white/black） |
| 兼容阶梯**外观无关**（只在 `:root` 声明） | `src/index.css:112-293`（`--palette-gray-*` 与 `--n-gray-*`），`.dark` 块内无它们 |
| 门槛数 174 / 198 | `npx playwright test --config playwright.theme-tokens.config.ts --list` → `Total: 174 tests in 16 files`；`--project=chromium` 逐项 87 |
| 逐 `system` 主题展开的三个套件 | `theme-overlays.spec.ts:386`（`OVERLAY_THEMES`）、`contrast.spec.ts:88`（`SUBJECTS`）、`code-block-surface.spec.ts:60`（`THEMES`） |
| `typecheck` 不覆盖主题测试 | `package.json`：`typecheck` 只走根 `tsconfig.json` ＋ `server/tsconfig.json`；主题测试由独立的 `typecheck:theme-tokens` 管 |
| 用户主题目录是**目录软链**（无逐文件链接） | `ls -la ~/.cloudcli` → `themes -> ../dotfiles/cloudcli/.cloudcli/themes` |
| 站点数口径与旧口径 | 本方案口径 `rg -o --no-filename 'n-gray-[0-9]+' src --glob '!**/tests/**' \| wc -l` → 1223；旧口径 `.agents/skills/theme-authoring/SKILL.md:131` 与 `dracula.css:12` 写"343 处表面"（本次无法复现） |
| 服务端不创建主题目录 | `server/modules/themes/services/theme-files.service.ts:391`（`readdir` 包在 `try/catch`） |
| `.css` 无法自报名字 | `theme-files.service.ts:113` `readDeclaredMetadata`；消费点在 `src/modules/settings/ThemeSelector.tsx:49,56` |
| 基线不受覆盖层影响 | 上一片（语法板接管 B2）实测：新增覆盖层声明，两份基线逐字节不变 |
| 探针盲区（`--n-gray-500` 可穿过） | 本方案起草时的注入实测：`cc-polar` ＋ `--palette-gray-500` → 通过；＋ `--palette-gray-100` → `moved surfaces it does not advertise: --n-gray-100` |
| 输入 chrome 的六个读数面 | `bg-n-gray-50` / `dark:bg-n-gray-800`：`McpServerFormModal.tsx:417 / 461 / 476 / 491`（另 `:376` 一处）；`bg-background`：`UserThemesSection.tsx:322`；聊天输入框：`PromptInput.tsx:42-43` 外壳 `bg-card/80` ＋ `:99` 的 `bg-transparent` textarea ⇒ **复合面（算不出，`--card` 行是近似端点）**。placeholder 规则 `index.css:900-917`，用户主题不可覆盖 |
| 六个读数面的五主体读数与 Δmax | §7 0a 表 3（灰阶面 Δ ≤ 0.02、可判读的表面面 Δ 最大 0.56 / 0.48）——灰阶面与 base 几乎同亮，是因为四套的灰阶是**保 L 换色相**（见 §4.2 注释与 §7 第 3 步的阶序表） |
| 五对之外的未覆盖档（`gray-200` / `gray-500`） | 站点数 `rg -o --no-filename 'n-gray-[0-9]+' …`：`200` 89 处（61 `border-` ＋ 10 `hover:bg-` ＋ 8 `bg-` ＋ 4 `dark:text-` ＋ 2 `text-` ＋ …）、`500` 119 处（73 `text-` ＋ 28 `dark:text-` ＋ …）。读数见 §7 0a **表 3b**；`200` 作文字浅 1.18 / 深 11.86（无稳定场景），`500` 六格 4.63 / 4.47 / 4.83 / 3.04 / 3.81 / 3.41（出厂即半不及格） |
| 四套灰阶的 L 序列（单调性与间隔） | §7 第 3 步的阶序表：两口径均单调递减，最小间隔 2.10 L（50→100，继承自基色）；上半段 L 与基色逐档相同、下半段偏移 ≤ 2.6 |
| 既有 5 套 editor 逐槽落点 | 附录 C（脚本按 `[data-theme="cc-*"]` 分块解析 `src/index.css`） |
| 三族在 `accent` 侧漏网（四审后新发现） | `theme-overlays.spec.ts:120` 的 `fixed` 只含 `--n-white/black/gray-100/gray-700`；`MUST_NOT_MOVE.accent`（`:132-140`）不含任何 `zinc`/`slate`/`neutral` ⇒ `accent` 主题声明 `--palette-zinc-*` 即可穿过（`derivedMoves` 判据"包含即允许"，与 §3.1 证据里 `gray-500` 同机制）。三族站点 66 ＋ 51 ＋ 40 ＝ **157** |
| `accent` 禁移项数（现状 / 只收 `gray` / 四族） | 现状 **31**（`spec:132-140` 展开 = substrate 11 ＋ terminal 7 ＋ editor 6 ＋ graph 3 ＋ fixed 4）；本片 `fixed` 4→2 ⇒ 只收 `gray` = **40**；扩四族（`compat` 44 档）= **73**。原写"31 → 42"漏算 `fixed −2` |

---

## 附录 C：既有 5 套 `full` 主题的 editor 逐槽落点提取表

三审批注（§8-8）要求：在谈 244 条之前，先给出"既有 5 套的 23/28 个 editor 令牌**逐槽落到哪个 L1 档**"的直接依据。下表按选择器解析 `src/index.css` 产出（`cc-polar` / `cc-catppuccin` / `cc-islands` / `cc-onedark` / `cc-onedark-vivid`）。

**结论：这张表几乎不含有待推断的槽。** 浅色 23 槽在 5 套之间**逐槽完全相同**；深色 28 槽里 22 槽相同，只有 6 槽分两列，分列的唯一轴是"该主题自己的底板取哪一档"。

### C.1 浅色（23 槽，5 套完全一致）

| 槽 | 落点 | | 槽 | 落点 |
|---|---|---|---|---|
| `bg` | `sand-50` | | `panel-bg` | `sand-100` |
| `gutter-bg` | `sand-50` | | `panel-border` | `1px solid …sand-200` |
| `gutter-fg` | `sand-500` | | `tooltip-bg` | `sand-100` |
| `gutter-separator` | `1px solid …sand-200` | | `tooltip-border` | `1px solid …sand-200` |
| `loading-bg` | `sand-50` | | `tooltip-arrow` | `sand-100` |
| `minimap-bg` | `sand-100` | | `tooltip-arrow-border` | `sand-200` |
| `active-line-bg` | `brand-400 / 0.14` | | `toolbar-bg` | `sand-50` |
| `active-line-gutter-bg` | `sand-100` | | `toolbar-fg` | `sand-800` |
| `selection` | `sand-200` | | `toolbar-border` | `sand-200` |
| `selection-focused` | `brand-500 / 0.22` | | `toolbar-hover-bg` | `sand-100` |
| `autocomplete-selected-bg` | `brand-500` | | `fold-placeholder-bg` | `sand-100` |
| `fold-placeholder-fg` | `sand-500` | | | |

（无 `--editor-fg`：它由基色 `hsl(var(--palette-sand-950))` 经 `var()` 链跟随，5 套一致。）

### C.2 深色（28 槽，22 槽一致、6 槽分两列）

| 槽 | `polar` / `catppuccin` / `islands` | `onedark` / `onedark-vivid` | 分歧？ |
|---|---|---|---|
| `bg` | `ink-950` | `ink-900` | **✓** |
| `gutter-bg` | `ink-950` | `ink-900` | **✓** |
| `loading-bg` | `ink-950` | `ink-900` | **✓** |
| `minimap-bg` | `ink-950` | `ink-900` | **✓** |
| `panel-bg` | `ink-900` | `ink-850` | **✓** |
| `active-line-gutter-bg` | `ink-900` | `ink-850` | **✓** |
| `fg` | `ink-100` | 同 | |
| `panel-fg` | `ink-100` | 同 | |
| `toolbar-fg` | `ink-100` | 同 | |
| `autocomplete-selected-fg` | `ink-100` | 同 | |
| `gutter-fg` | `ink-400` | 同 | |
| `fold-placeholder-fg` | `ink-400` | 同 | |
| `caret` / `cursor` | `brand-400` | 同 | |
| `active-line-bg` | `brand-400 / 0.06` | 同 | |
| `selection` / `selection-focused` | `ink-850` | 同 | |
| `autocomplete-selected-bg` | `ink-850` | 同 | |
| `toolbar-bg` / `tooltip-bg` / `tooltip-arrow` | `ink-850` | 同 | |
| `toolbar-border` / `toolbar-hover-bg` | `ink-800` | 同 | |
| `matching-bracket-bg` | `brand-400 / 0.28` | 同 | |
| `nonmatching-bracket-bg` | `danger-500 / 0.28` | 同 | |
| `search-match-bg` | `brand-400 / 0.35` | 同 | |
| `search-match-selected-bg` | `brand-400 / 0.18` | 同 | |
| `search-match-outline` | `1px solid …brand-400` | 同 | |

### C.3 这张表对 §8-8 意味着什么

- **6 个分歧槽不是审美分歧，是一条规则**：`bg` / `gutter-bg` / `loading-bg` / `minimap-bg` 与 `panel-bg` / `active-line-gutter-bg` 两组各自整体平移一档，轴是**该主题自己的底板**（`ink-950` 系 vs `ink-900` 系）。而四套的 `--code-block-bg` 是 `ink-950`（§3.2）⇒ **照左列逐槽抄**，与 §4.2 已给的 6 槽最小集完全一致、无冲突。
- **三审担心的"语义二义槽"在既有 5 套上不存在**：tooltip（bg / border / arrow / arrow-border）、active line、autocomplete 高亮、minimap、fold placeholder 这些槽，5 套**取值一致**；没有任何一处出现"这个作者这么落、那个作者反过来"的情形。⇒ "补齐需要一个新的人工推断层"这个反对理由不成立：这一步是**照列抄**，不是设计。
- **L1 覆盖面**：全表引用 **14 个 L1 档**——`sand-50/100/200/500/800`、`ink-100/400/800/850/900/950`、`brand-400/500`、`danger-500`；四套主题**一个不缺**（含 `danger-500` 与 `brand-400`）。6 个带 alpha 的槽照既有写法 `hsl(var(--palette-X) / 0.NN)` 落。
- 仍**不改变** §8-8 的表态题（补齐 / 不补齐），只把它的执行风险降到"机械照抄"，并让"补齐而引入 editor 内部 fg/bg 配对（§6 risk 12）"成为唯一还需要额外处理的事。

---

## 审阅批注

### Claude

> [!WARNING] **§4.5 探针的出厂值必须先自证，否则探针一上线就把 8 套全打红。**
> 我核对了 `BASE_PAIR_COLORS`（`src/shared/userThemeContrast.ts:76`）——它存的是**出厂 base 的已解析 triplet**，探针 `--n-gray-700`/`--n-gray-50` 这对要连 `:root` 的原厂 L1 也一并写进浅/深两格。风险在于：灰色阶梯 Tailwind 原值（`gray-700`≈`#374151`、`gray-50`≈`#f9fafb`）对比度约为 8:1，**远过 4.5**，本方案的 min=4.5 在 base 下必然过——但若实施时把出厂 triplet 抄错一位（比如记成哪一档的十六进制），`contrast.spec.ts` 会当场红一片，且排错时容易被误判成"某套主题不合格"。建议把这对的出厂 triplet 与 base 自证（跑一次确认 ≥4.5）做成 §7 验证计划的显式第 0 步，排在契约跑绿之前。

> [!WARNING] **§4.6 的"删 4 文件"低估了存量机器与用户本地改动的成本。**
> dotfiles 经 stow 折叠进 `~/.cloudcli/themes/`——stow 默认是**符号链接**：删除真源会立刻在装了 stow 的机器上留出悬空链接，而那 4 套文件在本方案落库前可能已被个别机器实例化为普通拷贝（或用户在其上做过本地 hack）。此指针只处理了"cloudcli 侧可追溯性"，没处理**其它已 deploy 过的机器 / 用户自定义**。建议补一步：升迁发布后的一次性清理与"该套文件是否偏离真源"的检测提示（哈希比对），避免用户升级后发现自己在旧文件上的配色改动静默消失。

> [!WARNING] **待决 2 我支持把 `accent` 的 11 档全列进 `MUST_NOT_MOVE`。**
> 我核实了守卫机制（`theme-overlays.spec.ts:417-420`）：`MUST_NOT_MOVE` 只是个**探针列表**，`beyondReach`（`:401-403`）也只拦「未被 `derivedMoves` 允许」的 move——`--palette-gray-300/500` 这类不在列表里的档，无论 accent 还是 full 都能自由重染而无声。既然本方案已经把"收灰阶"这个能力**只下放给 full**，那 `accent` 就没理由留这么大一个缝：只挂 2 档反而让 M5 的"绿"显得像设计意图，实为盲区。全列后契约更诚实，代价只是 `accent` 的 `MUST_NOT_MOVE` 从 ~12 一档变 ~22 一档，无明显维护负担。

> [!TIP] **§4.5 "判两次、同一个数"——既然兼容阶梯与外观无关，为何不判一次。**
> 文档说这对在两个外观取值相同、"判两次、无副作用"。既然如此，`BASE_PAIR_COLORS` 里浅/深两格写**同一个 triplet** 是冗余的——建议要么直接定义成外观无关（让 `userThemeContrast` 对这对跳过 appearance 分支），要么在批注里说明"两格同值"是刻意为之（给未来有人把某档改成外观相关时留位）。目前写法会在两格各存一份拷贝，未来若真要让某档随外观，得两处同改，反而容易漏一处。

> [!NOTE] **§3.1 证据一的"协和整阶重标定"论据成立，但建议把二级结论写死。**
> "11 档完整重染 = 策略而非缺陷"这一判断我同意。但它隐含一个未明说出去的承诺：**四套新内置主题从此必须重染完整灰阶**才能挂 `full` 徽标——若某天有人想新增一套只重染其中 5 档的主题，既过不了 `accent`（动了 compat）也挂不了 `full`（不完整），会落在与今天四套一样的"档位之间"里。建议在 §4.1 契约 diff 的注释里把"`full` 若动灰阶则须染完整 11 档"作为一条**显式约定**写明，给未来作者一个明确边界，而不是靠「整阶重标定才通过」这个隐含常识。这是可选加固，不阻塞本方案。

### WorkBuddy

> [!CAUTION] **§7.1 的门槛数错了：`87 passed` 是单引擎数，实际报的是 174；而且方案没说本次改动会把它推到 198。**
> 实测（HEAD，2026-09-30）：`npx playwright test --config playwright.theme-tokens.config.ts --list` → `Total: 174 tests in 16 files`，其中 `[chromium]` 逐项 **87** 条 ⇒ 87×2＝174。所以文档写的"当前基线 87 passed（chromium ＋ webkit 两引擎）"把单引擎数当成了两引擎总数，照它核对会得到"只跑了一半"的错觉（这条门槛是实施期唯一的数字闸门，值得写死）。
> 更要紧的是：本方案给注册表加 4 条 `system` 主题，有三个套件是**逐主题展开**的 —— `theme-overlays.spec.ts:386`（+4）、`contrast.spec.ts:88`（+4）、`code-block-surface.spec.ts:60`（+4）⇒ 每引擎 +12、两引擎 **174 → 198**。§7.1 / §7.5 应把 174 与 198 两个数都写进门槛（`SYNTAX_BOARD_THEMES` 那一行本身不涨用例：它在 `OWNER` 分支里是 in-test 遍历）。

> [!WARNING] **§4.2 的深色 editor 映射被 `code-block-surface.spec.ts` 反向钉死，方案没有说出这层耦合。**
> `code-block-surface.spec.ts:60` 对每个 `system` 主题断言"代码块底板 == `--editor-bg`"（`boards.editor === boards.reference`，浅深**两外观都判**）。四套 `.css` 今天写的底板是 `--code-block-bg: var(--palette-sand-50)` / `var(--palette-ink-950)`（逐文件核过：`dracula.css:124/148`、`gruvbox.css:128/148`、`kanagawa.css:128/151`、`tokyo-night.css:126/149`）。
> 所以 §4.2 那份 recipe 里 **`--editor-bg` 深色只能是 `ink-950`**。这不是"照 `cc-polar` 抄"的美学选择：`cc-onedark` / `cc-onedark-vivid` 的深色编辑页取的是 `ink-900`（`src/index.css:2332 / 2541`，与它们自己的 `ink-900` 底板一致）。实施时若按"更新的先例"取 ink-900，四套会**同一条断言全红**，而失败信息只说 "the editor preview draws X, not the editor page Y"，看不出根因。
> 建议：在 §4.2 深色 recipe 旁点明"`--editor-bg` 必须与 `--code-block-bg` 同值（`code-block-surface.spec.ts` 的契约）"；并把 §3.2 的"配方逐字可查"改成**逐套取值**（polar / catppuccin / islands → ink-950；onedark / onedark-vivid → ink-900），否则"同一套配方"这句话本身会被 `src/index.css` 反驳。
> 附一笔该记的正面账：`dracula.css:38-43` 自己记的"不变量偏离"（浅色底板是米黄、编辑器页仍是纯白）**在本次迁入后消失**——编辑器页第一次跟着主题走。方案该把这条写成"顺带修好的一处"，否则下一个读 `dracula.css` 的人会以为偏离还在。

> [!WARNING] **§2 / §7 缺一整维验收：四套主题从未被内置契约量过对比度。**
> 注册登记后 `contrast.spec.ts:88` 会立刻把这四套拉进 "base ＋ 每套覆盖层 × 明暗" 的判。我按同一算法（8 位通道取整，`userThemeContrast.ts:107-140` 的口径，与 `contrast.spec.ts:70` 等价）把**现有 6 对**逐套算了一遍：**全过**，但有两处只剩一线 ——
> - `kanagawa` 浅色 `--muted-foreground`(sand-500 `48.75 7.62% 39.68%`) on `--background`(sand-50 `53.33 67.5% 84.31%`) = **4.52:1**（下限 4.5，通道值 `rgb(109,106,93)` on `rgb(242,236,188)`）；
> - `tokyo-night` 浅色 `--primary-foreground`(frost-50) on `--primary`(brand-500 `214.74 75.4% 49.41%`) = **4.59:1**。
> 这不是小事：1-H 的先例正是**同一条配对**的基色（`--palette-sand-500` 44% → 4.42:1）被判为缺陷、并当场改了出厂配色（44%→43%，4.59）。kanagawa 的 4.52 只比那个被判缺陷的值高 0.10，而**用户主题通道从来不量它**（`.css` 文件走原样注入，没有对比度判定）——升内置之后它就成了产品契约的一部分。
> 建议 §7 加第 0 步：把"四套 × 现有 6 对 × 两外观"的 12 个读数写进方案（至少点名上面两处薄边）再决定动不动档位。否则"契约跑绿"这条门槛等于把这一维推到实施日才发现，而那时它已经是一枚写着"完整"的徽标的组成部分。

> [!WARNING] **§4.5 的"对价"买不回它声称的东西：新探针只覆盖被放松的两档里的**一档**，且拿一档**没被放松**的令牌当表面。**
> 新对是 `--n-gray-700` on `--n-gray-50`。但 `--n-gray-50` **从来不在** `fixed`（`theme-overlays.spec.ts:120` 只有 white / black / 100 / 700）⇒ 它一直是可移的；被放松的是 100 与 700。于是：灰-700 作 ink 被判，**灰-100 一个配对都没判**。
> 而 100 恰恰是最常用的**表面**：`hover:bg-n-gray-100` 实测 40 处，`--n-gray-100` 还作暗色下的文字（`src/index.css:862-896` 一组 `color: hsl(var(--n-gray-100)) !important`）。把 100 染错同样毁掉那 40+ 处，探针不响。
> 另外取证只指了浅色那一半：`TextContent.tsx:39` 的暗色半边是 `dark:bg-n-gray-800/50 dark:text-n-gray-300`，而 `--n-gray-800/300` 都不在任何禁移清单里，且 `/50` 意味着表面之上还要再混一次——纯函数算不出。文档说"这一对在两个外观下的取值相同 ⇒ 判两次、同一个数，无副作用"，算术上没错，但它同时意味着**判两次等于判一次**；把"判了两次"当覆盖面是自证式的。建议把这句话改成"暗色半边不判，原因是 `/50` 需要真实合成"，别留在那里当安慰。
> 建议二选一加固：(a) 探针补一对 `--n-gray-700` on `--n-gray-100`（次级按钮 / 悬停面，真实存在）；(b) 在 `theme-overlays.spec.ts` 里加一条**档位单调性**断言（11 档亮度单调 ＋ 相邻档间距下界），它才是 §3.1"整阶重标定"这个论据的正向守卫——现在的契约对"重染得协不协和"零约束。
> 同时点出 **M3 是"按断言量身定做"的变异**：它挑的正是探针唯一看得见的那一档，所以它 RED 不能证明覆盖面。建议补一条 M3′：把 `--palette-gray-100` 染成读不出的颜色 → 期望**没有任何断言变红**，把这处盲区写进方案（而不是只写在 §6 risk 2 里作为 accent 的事）。

> [!IMPORTANT] **§4.1 的放松只松了 gray 两档，而 §3.1 以"收掉接缝"立论，却没交代另外三个兼容族。**
> `--palette-zinc/slate/neutral-*` 同样在主题可达范围内（`userThemeTokens.ts:217` 的 `--palette-[a-z0-9-]+` 家族规则），`--n-zinc/slate/neutral-*` 也从不在 `fixed` / `MUST_NOT_MOVE` 里 —— 这 159 个站点（实测 `src/`：zinc 68 / slate 51 / neutral 40）**今天就已经可以跟主题走，四套却都没动**，迁入后依然冷灰。
> 这不是要扩范围，而是建议加一句"本方案只收 gray 这一族，zinc / slate / neutral 有意留在外面"，否则 §3.1 那套"外壳是主题色、内脏是冷灰"的论断会被下一位读者原样套到另外三族上。同一句也顺带回答了 §8 待决 2 的一个隐含前提——"11 档"这个说法默认兼容族只有 gray。

> [!TIP] **§8 待决 2 我赞成补全，但"补全"的集合要写清；并且补全会让 M5 的读法翻转。**
> 建议直接写成 gray 全 11 档（而不是继续叫 `compat` 的 2 档）＋一句话说明另外三族的处置（见上条），否则"更严"只严了一个族。代价我核过：`accent` 的 `MUST_NOT_MOVE` 从 ~12 变 ~23，**不新增用例**（该清单在 per-theme 测试里 in-test 遍历），门槛数不动。
> 更关键的是 M5：它现在被写成"负对照：给 `cc-ocean` 注入 `--palette-gray-500` → **绿**（记为已知的探针盲区，除非采纳 §8 待决 2）"。补全之后这条会**变红**，于是它从"记录盲区"变成"守卫本身"。定稿时必须二选一写死——否则实施者面前是一条永远绿的空转变异（正是本仓库反复记过的假绿形态），或者把一条该红的变异读成回归。

> [!IMPORTANT] **"~1.5k 个站点"在仓库里至少有三个版本，方案两处都用它当论据却没写数法。**
> 实测（`src/` 全树，`*.tsx|*.ts|*.css`）：`n-gray-<step>` 出现 **1234** 次（11 个不同档位、77 个文件、138 种写法）；四个兼容族合计 1234(gray)＋68(zinc)＋51(slate)＋40(neutral)＝**1393**，再加 `--n-white` / `--n-black` 的 271 处＝**1664**。
> 而 `.agents/skills/theme-authoring/SKILL.md:131` 与 `dracula.css:12` 都写"**343 处**表面"（与 dist 侧实测的 324 处更接近）。"1.5k"落在 1234 与 1664 之间，两种读法都说得通。
> 建议 §3.1 与 §4.1 的注释改成实测数并写明口径（"`src/` 内 `n-gray-*` 出现 1234 次"），否则下一位读者要么按 343 反驳、要么把它当 1664 去评估"接缝"的范围。顺带：`text-n-gray-700`（含 `hover:` 等前缀形态）我数到 **56** 处，方案写 51；`bg-n-gray-50` 45 处（方案 30）、`hover:bg-n-gray-100` 40 处（与方案一致）。三个数里两个对不上，同一处口径问题——建议整段统一成一次可复算的实测。

> [!TIP] **迁移的那一步（选择器改写）没有写进方案，而四套文件的现状与目标形态选择器不同。**
> 四套 `.css` 现在是 `:root` / `:root:not(.dark)` / `.dark`（`dracula.css:48 / 123 / 147`，另三套同形）；迁进 `src/index.css` 必须变成 `[data-theme="cc-<id>"]` / `[data-theme="cc-<id>"]:not(.dark)` / `[data-theme="cc-<id>"].dark`。§4.4 写的是"语法板…**原样**随文件迁入"——字面执行会把 `:root:not(.dark)` 直接搬进去，那会让四套的语法板**对所有主题生效**。
> 好消息是有护栏，不是静默：语法板守卫（`theme-overlays.spec.ts:590`，`owns === false` 分支报 "names N syntax slots but owns no board"，浅色泄漏会让它报 "declares a syntax board but moves no slot"）＋ `token-baseline.json`（实测含 22 处 `--cc-syntax`、2 处 `--code-block-bg`，`<html>` 快照会立刻漂）。
> 仍建议把这一步写死：§4.2 补一行"L1 块 → 裸 `[data-theme="cc-<id>"]`；语法板与底板 → `:not(.dark)` / `.dark` 两半"，§4.4 的"原样"改成"**值**原样、**选择器**按覆盖层形态改写"。
> 另：§4.2 / §7.3 的"**88 条**"与 §2 的"浅色缺 5"自相矛盾——若浅色 `--editor-fg` 靠 `var()` 链跟随（`src/index.css:366`）不需新声明，新增是 5＋6＋10＝**21 条/套 ＝ 84 条**。要么把 §7.3 的核对表口径改成 84，要么明说浅色块**刻意**重声明 `--editor-fg`（后者更稳：把"跟随"变成"写明"，也免掉"实施时要不要写"的自由裁量）。

> [!NOTE] **§7.5 的门槛漏了 `typecheck:theme-tokens`；§7.4 的"8 个主题"对不上任何集合。**
> 本方案改的是 `tests/theme-tokens/*.spec.ts`，它们由 `tests/theme-tokens/tsconfig.json` 单独管；`npm run typecheck` 只走根 tsconfig ＋ `server/`，**不覆盖**它，而 `npm run build:client` 是 vite/esbuild、不做类型检查。基线里 `typecheck:theme-tokens` 是独立脚本，建议并入 §7.5。
> 集合数：注册表当前 8 条，其中 `appearance: 'system'`（＝能当覆盖层的）**6 条**（`src/shared/constants.ts:332-385`，`cc-light` / `cc-dark` 不是覆盖层），迁入后是 **10 条**。"8 个主题 × 2 外观"两种读法都不成立，建议写成"10 个覆盖层主题（6 现有 ＋ 4 新增）× 2 外观 × 4 类面"。

> [!NOTE] **§6 risk 3 的回写清单漏了一个承重文件。**
> 方案说"契约文字与两份研究文档一并回写"。至少还有一处陈述了契约事实：`.agents/skills/theme-authoring/SKILL.md:128-131` 把兼容层列为"`--n-gray-*` / `--n-white` / `--n-black`"，并写"**`--n-gray-*` 别漏**…它管着 343 处表面"——那本技能是主题作者（含内置通道 M4）的作业书。放松之后"别漏"只对 `full` 成立、对 `accent` **恰好相反**（会被 `MUST_NOT_MOVE.accent` 判红）。
> 建议把技能正文纳入回写清单，并写清两个通道各自的答案（内置通道：契约按 coverage 分档；用户主题通道：契约不强制 coverage，但技能建议要跟着改，否则会教出与内置契约相左的写法）。
> 另：§4.5 那步我核实过**不需要**动第三个文件——`--n-gray-50` / `--n-gray-700` 已在 `tests/theme-tokens/main.ts` 的 `NEUTRAL_SCALE_PROBE_TOKENS`（＝`SCALE_TOKEN_NAMES`：4 族 × 11 档 ＋ `--n-white/black`）里，`contrast.spec.ts:100-108` 的 "not in the fixture's PROBES" 那条不会响。建议在 §4.5 写一句"两令牌已在探针集合内、无需改 `main.ts`"，把"要不要动第三个文件"一次答掉；并点明 `contrast.spec.ts:140` 会自动拿新对去比 `BASE_PAIR_COLORS`，值写错时红在那条、且报错是"表 vs 样式表"——预先说明，免得被误读成"某套主题不合格"。

### 牵头结论

汇总 2026-09-30 一审（Claude 5 条 · WorkBuddy 10 条，共 15 条）。**每条都先复核再裁定**：可证伪的数字我都用与本仓库同一口径重算过一遍（测试数用 `--list`，对比度用 8 位取整的 WCAG 算法并以 base 的 4.62 自检，站点数用 `rg` 复算）。**15 条里 12 条完全成立，2 条前提需修正，1 条部分采纳。无一条整体否决。**

#### 采纳（11 条）

| 来源 | 条目 | 落点 |
|---|---|---|
| Claude-1 | 探针出厂值必须先自证，否则红一片且易误诊 | §7 **第 0b 步** |
| Claude-3 | `accent` 的禁移补全（只挂 2 档 → 全 11 档） | §3.1 末、§4.1、§6 risk 2 |
| Claude-5 | "`full` 若动灰阶须染完整 11 档"写成显式约定 | §3.1 末、§4.1 注释 |
| WorkBuddy-1 | 门槛数：87 是单引擎，实际 174；本片推到 198 | §0、§4.4、§7.1 |
| WorkBuddy-2 | 深色 `--editor-bg` 被 `code-block-surface.spec.ts` 钉死；"配方逐字可查"应改逐套取值；附 dracula 的"顺带修好" | §3.2、§4.2、§7.4 |
| WorkBuddy-3 | 四套从未被内置契约量过对比度 | §7 **第 0a 步**（含 8 组读数与两处薄边） |
| WorkBuddy-5 | 未交代 `zinc`/`slate`/`neutral` 三族的处置 | §3.1 范围边界、附录 A |
| WorkBuddy-6 | 待决 2 的"补全集合"要写清，且补全会让 M5 读法翻转 | §3.1 末、§4.1、§7.2 的 M5 |
| WorkBuddy-7 | "~1.5k" 至少三个版本、需给数法 | §3.1 口径块、附录 B |
| WorkBuddy-8 | 迁移的选择器改写没写进方案；"原样迁入"会泄漏；88/84 自相矛盾 | §4.2 迁移表、§4.4、§7.3 |
| WorkBuddy-9 · 10 | 门槛漏 `typecheck:theme-tokens`；"8 个主题"对不上集合；skill 正文漏进回写清单；`main.ts` 不必改；`contrast.spec.ts:140` 的报错归属 | §4.4、§6 risk 3、§7.4、§7.5 |

#### 部分采纳（4 条）

| 来源 | 采纳的部分 | 未采纳的部分与理由 |
|---|---|---|
| Claude-2 | §4.6 补一行"未同步的机器上会短暂同时出现两套条目"，并在 dotfiles 提交信息里写明 | **前提修正**：本机 `~/.cloudcli/themes` 是**目录软链**（实测），删源不会留悬空链接；**不采纳**其"哈希比对工具"建议——这是个人 dotfiles，没有"产品部署面/用户自定义"这一层 |
| Claude-4 | §4.5 写明"两格同值是因为该阶外观无关，不是复制粘贴"，并在实现处加注释 | **不采纳**"把这对改成外观无关以省掉重复"：`BASE_PAIR_COLORS` 是按外观键控的表，为一个 3 条记录的特例改共用表结构，代价大于那两行重复 |
| WorkBuddy-4 | 探针由 1 对扩到 **3 对**（覆盖 `gray-700` 作 ink 两个表面、`gray-100` 作表面与作 ink）；新增 M3′（`gray-100` 染坏必须红）与 M3″（无探针档位染坏预期为绿）；把"判两次、同一个数"改成如实记录暗色半边算不出 | **不采纳**同时加入"档位单调性断言"：那是**新机制**（要定度量、间距下界、是否分外观），塞进"放松一条守卫"的片里是范围膨胀；已立为 **§8-7** 请审阅者定夺，并附牵头理由 |
| WorkBuddy-2 附笔 | "顺带修好"一笔已写进 §3.2 | —— |

#### 牵头自记（一审未覆盖，1 条）

- **§8-8**：本方案 editor 补值只是**契约最小集**（浅 5 / 深 6），而既有 5 套主题是 **23 / 28** 个 editor 令牌。差额约 160 条，不补则编辑器页的非契约 chrome（自动补全高亮、活动行、gutter/panel、tooltip、minimap…）留在基色——**正是我用来反对放松 `full` 的那条"接缝"理由，只是位置挪进了 editor 面内部**。牵头倾向补齐，但会把改动面从 84 条扩到约 244 条，故列为待决而非默认。

#### 修订说明（本次对方案正文做了什么）

1. **数字全部换成可复算的实测值**：门槛 174/198、站点 1223（＋方法）／旧口径 343 标注为待更新、新增声明 84（＋"若重声明浅色 `--editor-fg` 则为 88"两种口径）、覆盖层主题 10 个、`accent` 禁移 ~12 → ~23。
2. **§4.1 的放松范围由 2 档改为 `gray` 全 11 档**，并把"只收 `gray` 一族"写成显式边界。
3. **§4.2 新增"迁移：选择器必须改写"小节**（含三行映射表），并把 §4.4 的"原样迁入"改为"值原样、选择器改写"。
4. **§4.2 新增"深色 `--editor-bg` == 该主题 `--code-block-bg`"的硬约束**，并补 `cc-onedark`/`vivid` 取 `ink-900` 的对照，把"同一套配方"改为"同形态、逐套取值"；同时补上 dracula 那条"不变量偏离消失"的顺带修好。
5. **§4.5 由一对探针扩为三对**（逐对给出真实绘制点），并改写"判两次"那段为**如实记录的盲区**；补 `BASE_PAIR_COLORS` 两格同值的解释。
6. **§7 重写**：新增第 0 步（0a 四套对比度读数表 ＋ 两处薄边点名；0b 出厂值自证），变异表加入 M3′/M3″ 并把 M5 的读法翻转写死，真机复验由"`--editor-bg` == `--background`"改为"== `--code-block-bg`"，门槛并入 `typecheck:theme-tokens`。
7. **§6 风险表**：risk 1 改为"三对探针 ＋ 如实记录的残留盲区"，risk 2 标记为已关闭，risk 3 补入 skill 正文，新增 risk 8（editor 最小集）与 risk 9（"染完整 11 档"成为约定后的边界）。
8. **§8 由 6 问扩到 8 问**：待决 2 改为"已裁定、待确认"，新增待决 7（单调性断言）与待决 8（editor 最小集 vs 既有形态）。
9. **附录 A/B** 同步：A 补"另三族有意不动"，B 补 12 条新取证（含对比度口径自检、目录软链形态、三对探针的落点、174/198 的来源、`typecheck` 的覆盖边界）。

#### 仍未解决 / 留给二审的三件事

1. **§7 第 0a 步的两处薄边要不要动档**：`kanagawa` 4.52、`tokyo-night` 4.59。它们现在**过**，但只比 1-H 被判缺陷的那个值高 0.10。这是本方案**唯一一处可能已存在的红**——先量后决定，动档会牵动四套主题的 L1。
2. **§8-8 的 editor 范围**：84 条还是约 244 条。它决定本片是"补齐契约"还是"接管编辑器页"。
3. **未做的两笔**：本机 `~/.cloudcli/themes/console.css` 仍无语法板（独立线）；上一片 S 线的 2 个未跟踪文件与 cloudcli 侧 4 个已改文件、dotfiles 侧 4 个主题文件**都还没提交**。

---

### Claude · `二审`（2026-09-30）

> [!WARNING] **新增三对探针只判了浅色半；三处绘制点的暗色半换了 token，其中两处**是纯函数算得出来的**，而只有算不出来的那一处被记了。**
> 逐处核过三个绘制点的完整 className（不只是文档引的那半句）：
> - **对 1**（`TextContent.tsx:39`）暗色 `dark:bg-n-gray-800/50 dark:text-n-gray-300` —— 表面带 `/50`，要在上一层再合成 ⇒ §4.5 末如实记为盲区 ✓。
> - **对 2**（`VersionUpgradeModal.tsx:250`、`TaskEmptyState.tsx:96`）暗色 `dark:bg-n-gray-700 dark:text-n-gray-300`；而同一处取证的 `McpServerFormModal.tsx:244/255/294` 暗色写的是 `dark:bg-n-gray-800 dark:text-n-gray-300` ⇒ **暗色半其实是 `gray-300 on gray-700` 与 `gray-300 on gray-800` 两对**，都无 alpha、纯函数完全算得出。按同口径（8 位取整）复算：`gray-300 on gray-700` = base 7.00 / dracula 6.86 / gruvbox 7.19 / kanagawa 6.81 / tokyo 6.91；`gray-300 on gray-800` = 9.96 / 9.75 / 10.23 / 9.78 / 9.82。**前者比新增对 1/2 的 9.3~9.9 更贴 4.5 限值，判别力最强。**
> - **对 3**（`TextContent.tsx:31`）`dark:bg-n-gray-950` 盖掉 `bg-n-gray-900`、ink 不变 ⇒ 暗色半是 `gray-100 on gray-950`（实色）= 18.30 / 18.20 / 18.46 / 18.16 / 18.33。
>
> 量级上暗色半并不小（`rg -o` 计数）：`dark:text-n-gray-300` 53 处、`dark:bg-n-gray-800` 71 处、`dark:bg-n-gray-700` 26 处；而对 2 的浅色半（同一 className 上 `bg-n-gray-100` ＋ `text-n-gray-700`）同口径只有 **9** 处。
> ⇒ 现状是"判浅色半 ＋ 如实记一处算不出的暗色半"，但另外两处**不是算不出、只是没列**；读者会把它们和 `/50` 那处一起当成"纯函数的边界"，而 §6 risk 1 的"残留盲区如实记录"也就只记了三分之一。
> **建议**（不新增机制、不加度量）：至少补 `{ ink: '--n-gray-300', surface: '--n-gray-700', min: 4.5 }` 与 `{ ink: '--n-gray-100', surface: '--n-gray-950', min: 4.5 }`（两令牌已在 `NEUTRAL_SCALE_PROBE_TOKENS`，不会撞 `contrast.spec.ts` 的 "not in the fixture's PROBES"）；若求全再加 `gray-300 on gray-800`。这也正是 §8-7 里"可以现在就做、且不引入新度量"的那一半——单调性度量那半我同意仍留作独立片。

> [!WARNING] **迁移时四套文件头部那 22~23 行注释的去向没有交代，其中含已知失实的旧口径与只对用户通道成立的警告。**
> 四份文件各 161~164 行，其中 22~23 行是头注（`dracula.css:1-46`）。§4.2 只写"值原样、选择器改写"，§4.6 写"四套文件整体退场"，于是头注里至少五类内容会二选一地出事：
> 1. **旧口径**：`dracula.css:12`（另三套同款、`dracula.css:77` 又一处）写"`--n-gray-*` 的 **343 处表面**"。§6 risk 3 要把 343 回写成新口径，但清单只点了"契约注释 ＋ 两份研究文档 ＋ skill"，**没点这四处源文件**。
> 2. **只对用户通道成立的警告**：`dracula.css:25-28` 的"`:root:not(.dark)` **不能写成 `:root`**…（通道 B 的样式表插在 `<head>` 末尾）"——这条本身就是被 §4.2 的迁移映射表取代的。整段照抄进 `src/index.css`，就是把一段已失效的通道说明钉进产品源码。
> 3. **仍然成立的形状约束**：`:30-36`（`--code-block-bg` 必须裸三元组或 `var()`，写成 `hsl()` 会**静默丢声明**；11 个语法槽是 hex、与内置那 55 条同形）。丢了下一位作者**不会收到任何报错**。
> 4. **§3.2 判为"顺带修好"的那条记录**：`:38-43` 的"不变量偏离"——§3.2 要把它写成"迁入后消失"，而记录本身正在即将被删的文件里。
> 5. **色值来源**：`:45`（dracula-theme/README.md ＋ alacritty ANSI 16 色），四套各不相同，删掉就没了。
>
> **建议**：在 §4.2 或 §4.6 明确一句处置（三选一）——整段改写后随迁入／只把「形状约束 ＋ 色值来源」搬进 overlay 契约注释、其余逐条记账丢弃／dotfiles 侧留归档。另：`:2` 的标题也还写着 `user-dracula`。

> [!TIP] **§7 第 0a 步要补新增三对的读数（它们第一天就会判这四套）。**
> 0a 只量了"现有 6 对"，但三对进 `CONTRAST_PAIRS` 后，重染了整阶灰的四套立刻同表受判。我按同口径补算（base / dracula / gruvbox / kanagawa / tokyo）：`gray-700 on gray-50` = 9.86/9.82/9.88/9.75/9.82；`gray-700 on gray-100` = 9.37/9.32/9.45/9.26/9.38；`gray-100 on gray-900` = 16.12/15.98/16.28/16.02/16.10 —— **15 个读数全过**，余量比现有 6 对宽得多。这反过来说明三对是**为将来的主题**买的护栏、对本次入册的四套不构成闸门，值得在 §4.5 点明一句（否则"必须同时补三对"读起来像这四套有风险）。
> 另：§7 0b 的"灰色阶…对比度约 8:1"可换成精确值（base 对 1 = 9.86、对 2 = 9.37、对 3 = 16.12）。

> [!NOTE] **两处数字要更正（都源自一审我给的错值，请连我一起改）。**
> - §3.1 末与 §4.1 的"`accent` 的 `MUST_NOT_MOVE` 从 **~12 项**变 **~23 项**"——两个都不对：现在是 `substrate 11 ＋ terminal 7 ＋ editor 6 ＋ graph 3 ＋ fixed 4` ＝ **31** 项，加 `compat`（11）后 **42** 项。这句正被用来论证"代价可接受"，写成 12→23 会让人以为它是个小清单。
>   **（四审后复核修正）**：连这句"42"也不对——`fixed` 在本片由 4 项删到 2（`--n-gray-100/700` 移入 `compat`），所以只收 `gray` 是 **40**；扩到四族是 **73**。见 §3.1 的算术修正。
> - §0 的"`zinc` / `slate` / `neutral` 三族（**159 处**）"与 §3.1、§3.1 范围边界、附录 A 的 **157 处**（66＋51＋40）不一致：§0 漏改。

> [!NOTE] **§3.1 证据三对 `--n-white` / `--n-black` 的定性不成立。**
> 实测 `text-n-white` **143** 处、`bg-n-white` 51 处、`bg-n-black` 36 处（技能正文自己写"`text-n-white` 有 200 处"），而"终端选区 chrome 的白描边/黑阴影"那一路只用了几处 `hsl(var(--n-black) / 0.1)`（`src/index.css:1032 / 1124 / 1383 / 1387`）。⇒ **冻结的结论可以不变**（纯白/纯黑当填充与标签，跨主题混色时对比度风险最高），但"外观无关、没有哪个主题该改它"这条**理由**要改写；四套自己的取证点旁边就站着 `bg-blue-600 text-n-white`（`McpServerFormModal.tsx:243`），说明白字确实在跟主题无关的地方被消费。否则下一位读者会拿这条理由去反对别人放松 white/black。

> [!NOTE] **§7.2 的两条变异要跟着上面的改动顺一下。**
> - **M3** 的括注"（若只有探针红，说明 §4.1 的放松确实把旧防线撤了、新防线在顶岗）"对 `--palette-gray-50` **不成立**：`--n-gray-50` 从来不在 `fixed`，没有旧防线可撤。真正"旧防线已撤、新防线顶岗"的档是 **gray-700**（原先在 `fixed`，如今只由对 1 / 对 2 判）⇒ 把这条括注移到一条瞄着 `--palette-gray-700` 的变异上，或删掉。
> - **M3″** 的示例档位随"补暗色半对"失效：补了 `gray-300 on gray-700` 之后 `--palette-gray-300` 已被覆盖，负对照要改用仍无探针的档（gray-200 / 400 / 500 / 600 / 800 之一）。

> [!NOTE] **§4.5 的第一条注释比它的取证宽。**
> `{ ink: '--n-gray-700', surface: '--n-gray-50' }` 的注释写 "A fenced/JSON-free code panel **and plain text** in the chat transcript"，但 `TextContent.tsx:47` 的纯文本分支只有 `text-n-gray-700`、**没有** gray-50 背景（它的表面是聊天面板自己的语义令牌）⇒ 这一对是被 `:39` 的代码块 `<pre>` 挣来的，纯文本只共享 ink。建议注释只指 `:39`，免得读者以为纯文本那半也被判了。

> [!TIP] **已复算 / 已逐处核过的东西（供牵头省一遍，下面是"无异议"的部分）。**
> - **§7 0a 表的 60 个读数**：我按同口径（8 位通道取整、L2→L1 沿 `hsl(var(--palette-*))` 解、card 浅＝纯白/深＝ink-900、primary-fg 浅＝frost-50/深＝ink-950）独立复算，**逐位相同**，含两处薄边（kanagawa 浅 4.52、tokyo 浅 4.59）与 tokyo 浅 ring/bg 3.71（后者限值是 3，不是 4.5——表中"判定 PASS"没错，但建议给"限值"一列，否则 3.71 与 4.5 并列会被误读）。
> - **§7.1 的 174 / 87 / 198**：`--list` 逐文件 `[chromium]` = theme-overlays 14、contrast 8、code-block-surface 8，其余套件（terminal-tokens / graph-lanes / token-contract / token-preview / token-baseline 系）全是 in-test 遍历 ⇒ 三个套件各 ＋4 ＝ 每引擎 ＋12、174 → 198 ✓。`SYNTAX_BOARD_THEMES` 那行不涨用例 ✓。
> - **§3.1 的数法**：按方案原样给出的命令复算 —— 1223 / 74 文件 / 11 档、zinc 66、slate 51、neutral 40、`white|black` 257、`text-n-gray-700` 56、`bg-n-gray-50` 52、`hover:bg-n-gray-100` 40，**全部逐字复现**。我顺手撤回一审自己的 1234 / 68 / 271 / 45：那是"连 `src/**/tests` 一起算＋更宽正则"的口径，方案的数法更准。
> - **L1 集合安全**：四套声明的 47 个 `--palette-*` 全部是基色 93 个的子集 ⇒ `theme-overlays.spec.ts:356`（"overlay 只能重声明基色声明过的令牌"）与基线覆盖率两条都不会红。
> - **语法板与载体**：四套逐块数过 —— `--cc-syntax-*` 11 槽 × 2 外观、槽名两侧一致，`--code-block-bg` 两侧各 1；语法槽是 hex，与内置那 55 条同形 ⇒ 不会撞 `token-contract.spec.ts:155` 的字面量白名单（`--editor-` / `--code-block-bg` / `--cc-syntax-` 都在豁免里）。
> - **§4.2 的 editor 配方与既有 5 套逐槽同形**：浅色 = `sand-50 / 50 / 100 / 800 / 50`（无 `--editor-fg`，实测 `cc-polar` 浅色块 23 个 editor 令牌里正是这 5 个契约槽）；深色 polar / catppuccin / islands = `ink-950 / 100 / 950 / 900 / 100 / 950`，onedark 系才用 `ink-900 / 850` ⇒ "同形态、逐套取值"与 `code-block-surface.spec.ts:60` 的推论都成立；§8-8 的 23/28、18/22、40、160 算术自洽。
> - **§8-8 的可行性**（这条或许能帮你决定）：既有 5 套的编辑页令牌共引用 **14 个 L1 档**——`sand-50/100/200/500/800`、`ink-100/400/800/850/900/950`、`brand-400/500`、`danger-500`——四套主题**一个不缺**（含 `danger-500` / `brand-400`），且 6 个带 alpha 的槽可照既有写法 `hsl(var(--palette-X) / 0.28)`（`src/index.css:1686`）⇒ **补齐到 23/28 不需要新造任何 L1 色**，§3.2 说的"机械映射"是站得住的。
> - **三处探针绘制点与对 2 的三处站点**：`TextContent.tsx:31 / 39`、`VersionUpgradeModal.tsx:250 / 258`、`McpServerFormModal.tsx:244 / 255`、`TaskEmptyState.tsx:96` 逐行核过，引用属实。
> - **注册表与 id**：`src/shared/constants.ts:330` 的字段名（`id/name/appearance/source/coverage`）与 §4.3 片段一致；8 条注册里 `system` 恰 6 条 ⇒ "6 现有 ＋ 4 新增 ＝ 10" ✓；id 唯一的格式约束是 `cc-` 前缀（`src/shared/tests/themeContext.test.tsx:172`），`cc-tokyo-night` 这种三段式不会被拦。

> [!WARNING] **placeholder / caret / dark 文字用的中间档，三对探针一对都没覆盖——而这正是 `!important`、用户无覆盖手段的强制 UI chrome。**
> 修订把探针扩到三对（`gray-700/50`、`gray-700/100`、`gray-100/900`），但这四套重染的是**完整 11 档**，其中两档被**强制 UI chrome** 独占消费且不可被覆盖：
> - `src/index.css:900-909`：`textarea::placeholder { color: hsl(var(--n-gray-400)) !important; opacity: 1 !important }`（浅），`.dark` 用 `--n-gray-600`。
> - `src/index.css:861-865`：dark 下 `textarea` 文字与 `caret-color` 用 `--n-gray-100`。
> - 上一轮取证也确认：`--n-gray-100` 作暗色文字（`::selection` 等）遍布 `index.css:862-896` 的 `!important` 块。
>
> 三对 `gray-700/50`、`gray-700/100`、`gray-100/900` 覆盖的是 `text-gray-雪700` 与 grey 面——恰好**跳过** 400/600 这两档。深色主题极易把 600 染得贴近背景（400 在暗外观本应很亮、600 是占位专属），登录框/输入框的**占位符会静默消失或看不清**，且因 `opacity:1 !important` 用户无法自调。这比"残留盲区如实记录"更该点名——它不是第 n 个抽样漏档，而是**一个不可覆盖的切面的独占档**。建议至少把 `{ ink: '--n-gray-400', surface: '--n-gray-900', min: 4.5 }`（光占位）与 `{ ink: '--n-gray-600', surface: '--n-gray-950', min: 4.5 }`（暗占位）列为**强制新增对**（400/600 也在 `NEUTRAL_SCALE_PROBE_TOKENS`，不撞 "not in the fixture's PROBES"）；若嫌扩表，则 §4.5 必须明写"不覆盖输入 chrome"，并把 placeholder 对比列为四套重染的自查项。

> [!IMPORTANT] **§8-8 editor 补齐的隐性代价没算进去：editor 内部配对会第一次进对比度套件，可能又冒出薄边。**
> 牵头倾向补齐到 23/28（244 条），我核过 L1 覆盖足够（§3.2 的"机械映射"成立）。但补齐后 editor 从"6 槽契约最小集"变成"23/28 个真实令牌"，其中 fg 类令牌（`--editor-fg` / `--editor-toolbar-fg` / gutter）与 bg 类（panel / loading / gutter-bg）的**内部配对**会被 `contrast.spec.ts`（若它按 `CONTRAST_PAIRS` 逐幂对判）或真机复验拉进来。这跟 §7 0a 那两处薄边是同一性质的风险，只是面从 substrate 挪进 editor。建议在 §8-8 的表态结论里加一句："补齐同时要求 editor 内部 fg/bg 配对也过对比度门槛（至少 3:1，仿 `--ring/bg`），实施时并入 0a 读数表"——否则补齐的收益（无色接缝）会被一个事先没量、事后才红的 editor 薄边抵消。

> [!WARNING] **"档位单调性"拖成独立片成本不该计为零——占位/正文的相对深浅翻转会静默发生且无人宣称。**
> 牵头把单调性断言列为 §8-7"范围膨胀、拖独立片"，我同意**不塞进本片**。但方案里要承认：重染整套灰阶的**单调性翻转**是真实退化路径，且它不透明——`gray-600`(暗占位)若比 `gray-400`(光正文)亮、或 `gray-100`(暗文字)比 `gray-50` 深，没有任何探针能发现，真机复验若不是逐档读或者说只抽查选定档也未必撞见。建议 §4.2 的记账清单把"重染后 11 档须保持亮度单调"写成**审计项**（提交说明须声明阶序、随 88/244 条一起），即使本轮不做断言，也把"作者承诺了单调"这条留下文本痕迹——它既是 §3.1"协和整阶"论据的可审计化，也不添任何新机制。

> [!TIP] **§7 0a 两处薄边（kanagawa 4.52、tokyo 4.59）我不建议为 0.10 动档，但要求登记为永久风险。**
> 参照系是 1-H 把 sand-500 44→43 的那次——那次的余量是 **-0.08**（4.42 < 4.5，已红）；这两处是 **+0.02 / +0.09**，方向不同：前者是修红，后者是保绿。在余量 >0 的情况下动档会牵动四套 L1、且收益是一次"看着更稳"没有可证伪的失效。我建议不动档，但把它俩写进 §6 risk 表（不止 §7 0a 脚注），并注明"任何未来对 sand-/brand- 族的微调，先回看这两处"——否则这个发现会随 0a 的实测表一起沉底，失去它作为"最可能先红的点"的价值。

> [!NOTE] **placeholder 中间档的失防，补全了牵头 moulding 的"M3″ 负对照"示例档位结论——600 已实际被消费。**
> 二审上一条把 M3″ 的示例从 `gray-300` 改到任意无探针档（200/400/500/600/800 之一）。建议**点名 `--palette-gray-600`** 作 M3″ 的档位：它既是无探针的（三对都没它），又是**真实绘制**到 placeholder 暗半的档（`index.css:907`），用它做负对照比拿一个纯理论档（如 gray-500，`rg` 未见于强制 chrome）更有说服力——证明"新防线在顶岗"时，用一个会被真实 UI 消费的档位比抽象档位更能暴露放松的边界。顺带：这样 M3″ 就与上面开头那条的"占位对强制新增"形成了呼应——若占位对采纳，M3″ 才需改回理论档。

---

### 牵头结论（二审）

汇总 2026-09-30 二审（Claude **13 条**）。**每条先复核再裁定**：可证伪的数字全部用与本仓库同一口径重算——对比度用 8 位通道取整的 WCAG 算法（与 §7 0a 同口径，以 base 的 4.62 自检）、站点/令牌数用 `rg -o --no-filename … --glob '!**/tests/**'`、清单项数用集合展开、用例数用 `--list`。**13 条里 12 条采纳、1 条部分采纳（配对形式不可用）、0 条否决。**

#### 采纳（12 条）

| # | 内容 | 落点 |
|---|---|---|
| 1 | 暗色半只判了三分之一：三处绘制点的另一半换了令牌，**其中两处是实色、纯函数完全算得出**，只有 `/50` 那处真算不出 | §4.5（三对 → **五对 ＋ 可选一对**，含逐处对照表）、§7 0a 表 2、附录 B |
| 2 | 四套文件 **46 行头注**的去向没交代（旧口径 / 失效的通道 B 说明 / 不报错的形状约束 / 顺带修好的记录 / 色值来源） | §4.6 **头注处置表**、§6 risk 11 |
| 3 | §7 0a 要补新增对的读数（它们第一天就会判这四套）；0b 的"约 8:1"换成精确值 | §7 0a 表 2、0b |
| 4 | 两处数字错并正在被用来论证"代价可接受"：`accent` 的禁移清单 **31 → 42**（非"~12 → ~23"）；§0 的 **159 → 157** | §0、§3.1 末、§4.1 |
| 5 | §3.1 证据三对 `--n-white/--n-black` 的**定性不成立**（结论可留、理由要改） | §3.1 证据三、§4.1 注释、附录 A |
| 6 | §7.2 两条变异要顺：M3 的括注对 `--palette-gray-50` 不成立（它从不在 `fixed`） | §7 主流程 M3（改瞄 `gray-700`） |
| 7 | §4.5 对 1 的注释比取证宽（纯文本分支没有 `gray-50` 底） | §4.5 diff 块注释 |
| 8 | 0a 表要给"**限值**"列（`ring/bg` 是 3 不是 4.5） | §7 0a 表 1 |
| 9 | §8-8 补齐 editor 的隐性代价：**editor 内部 fg/bg 配对会第一次进对比度套件**，可能再冒薄边 | §8-8 表态条款、§6 risk 12、§7 0a 末 |
| 10 | "单调性拖独立片"的成本不该计为零 ⇒ 至少留成**审计项** | §4.2 记账清单、§6 risk 10 旁 |
| 11 | 两处薄边（kanagawa 4.52 / tokyo 4.59）登记为**永久风险**，不留在 0a 脚注里沉底 | §6 risk 10、§7 0a |
| 12 | M3″ 的负对照档位：一审的 `gray-300` 已被新对覆盖 ⇒ 改点名 **`--palette-gray-600`**（无探针 ＋ 真实被占位符消费） | §7 主流程 M3″ |

#### 部分采纳（1 条）

| 来源 | 采纳的部分 | 未采纳的部分与理由 |
|---|---|---|
| 二审 · placeholder/caret 的 400/600 | **现象成立**：400/600 被 `!important` 的 `textarea::placeholder`（`index.css:900-910`）与 `.dark textarea`（`:861-865`）**独占消费、用户不可覆盖**，而现有与新增探针**一对都不覆盖**。⇒ 已写进 §4.5 表 3、§6 risk 1 的"探针不覆盖清单"、§7 0a 表 3，并新立 §8-9 请审阅者选 (a)/(b)/(c) | **不采纳它给的两个配对形式**。牵头按同口径复算：`gray-400 on gray-50` = **2.43**、`gray-600 on gray-950` = **2.66**、`gray-600 on gray-800` = **1.94** —— **加 `min: 4.5` 的对会立刻红在 base**。这不是发现缺陷，是**拿错了限值**（placeholder 出厂本就是 1.9~2.7:1 的淡淡提示）。另：建议里的 `gray-400 on gray-900` = 6.99 数值上过，但**该表面是虚构的**——浅色 placeholder 的真实底是 `bg-n-gray-50` / `bg-background`，没有一处坐在 `gray-900` 上；拿一个不被消费的配对当证据，与这套"取证到真实绘制点"的口径不符 |

#### 牵头复算 + 自查（二审未覆盖 / 需修正的两处）

- **复核结论：13 条里凡我复算得到数字的全部逐位复现**——含三处暗色半（`gray-300/700` = 7.00 / 6.86 / 7.19 / 6.81 / 6.91；`gray-300/800` = 9.96 / 9.75 / 10.23 / 9.78 / 9.82；`gray-100/950` = 18.30 / 18.20 / 18.46 / 18.16 / 18.33）、新增三对（9.86 / 9.37 / 16.12 起）、`text-n-white` 143 / `bg-n-white` 51 / `bg-n-black` 36、`n-black` 的四处 `hsl(var(--n-black) / …)`、`accent` 清单 31、`--list` 的 174 / 87。**仅一处数字有 1 的差**：`dark:bg-n-gray-700` 我读到 **27**（二审写 26，口径差异不重要），方案按 27 记。
- **牵头自查一处二审判定为"部分采纳"的连带影响**：既然 §4.5 的表 3 拆出了 400/600，M3″ 的"无探针档位集合"要同时更新——采纳五对＋可选一对之后，**仍无探针的档是 `{200, 400, 500, 600}`**（若**不**采纳可选的对 6，则 `800` 也在内）。**`600` 之所以最优**：它是这个集合里唯一被真实 UI（占位符）消费的档。已写进 §7 M3″。

#### 修订说明（本次对方案正文做了什么）

1. **数字**：`accent` 的 `MUST_NOT_MOVE` **31 → 42**（§3.1 末、§4.1 两处，并附二审修正说明）；§0 的 **159 → 157**；§4.5 的"三对"全部改为"**五对（＋可选一对）**"（§0、标题、正文、risk、§7、§8 同步）。
2. **§3.1 证据三改写**：`--n-white/--n-black` 的冻结理由由"外观无关"改为"纯白/纯黑作填充与标签的对比度风险最高 ＋ 站点量 257"，并点明旧理由与事实不符。§4.1 的 `fixed` 注释同步改写。
3. **§4.4**：`main.ts` 不必改的理由由两个令牌扩到**六个**（`50/100/300/700/900/950`），并给出 `NEUTRAL_STEPS` 的完整集合作为依据。
4. **§4.5 重写**：保留一审的三对论证；新增「三处绘制点的浅/暗半对照表」、把探针扩到**五对＋可选一对**（diff 块逐条给注释与真实性引证）、扩 `BASE_PAIR_COLORS` 到六个令牌、把"判两次"那段改成"**在判档位、不是在判绘制点**"、新增**表 3**（placeholder / caret 的 400/600 无法用 4.5 探针防）。
5. **§4.6 新增头注处置表**（五类 × 落点 × 处置：保留形状约束与色值来源、改写 343 口径、丢弃通道 B 说明、迁出不变量偏离记录）。
6. **§6 风险表**：risk 1 重写（五对 ＋ **探针不覆盖清单**含 placeholder 的不可覆盖切面）；risk 3 的回写清单补入**四套 `.css` 头注的 343 口径**；新增 **risk 10**（两处薄边，登记为永久风险）、**risk 11**（头注散落）、**risk 12**（editor 补齐的隐性代价）。
7. **§7 重写为三张表**：0a 表 1 加"限值"列、新增表 2（新增五对＋可选的 25＋5 个读数）与表 3（不可覆盖的输入 chrome，判据改为"不得显著劣于 base"）；0b 用精确读数替换估算；M3 的括注改瞄 `gray-700`；M3′ 补对 5；M3″ 定档 `gray-600` 并说明覆盖集合。
8. **§8**：待决 3 的"两对"改为"五对（＋可选一对）"；待决 8 绑定二审的 editor 内部配对约束；**新增待决 9**（输入 chrome 的 400/600 选 (a)/(b)/(c)）。
9. **附录 A/B** 同步：A 补"输入 chrome 不在防线内"并改写 white/black 的理由；B 补 6 条新取证（五对的绘制点、暗色半量级、输入 chrome 三处位置与读数、white/black 的 259/257 计数、`accent` 31/42、头注五类落点）。

#### 仍未解决 / 留给三审的四件事

1. **§8-9（二审新增）输入 chrome 的 400/600**：选 (a) 只记读数不立断言（牵头倾向）/ (b) 立一条**相对基线**的下限断言（要定义度量，半片新机制）/ (c) 认为 placeholder 本就该按 4.5 卡、先把 base 修到位——那会变成一个独立的可访问性片。
2. **§8-8 的 editor 范围**：84 条还是约 244 条。它决定本片是"补齐契约"还是"接管编辑器页"。**二审已给出可行性佐证**：既有 5 套编辑页共引用 14 个 L1 档，四套一个不缺 ⇒ 机械映射站得住；但若选补齐，**必须同时**把 editor 内部 fg/bg 配对纳入对比度判定（§6 risk 12）。
3. **§8-7 的档位单调性**：本片不做断言、只留审计项（§4.2），是否认可。（**三审后已抬成 §7 第 3 步核对表的一列并预填实测值**；"审计项"这个说法在正文里已不再使用。）
4. **未做的两笔**：本机 `~/.cloudcli/themes/console.css` 仍无语法板（独立线）；上一片 S 线的 2 个未跟踪文件与 cloudcli 侧 4 个已改文件、dotfiles 侧 4 个主题文件**都还没提交**。（**三审后移入 §9 收尾清单**，不再当待决问题。）

---

### Claude · `三审`（2026-09-30）

> [!WARNING] **§8-9 我站 (a)，但"不得显著劣于 base"需要一个可复算的判读口径，否则 (a) 与 (b) 的差别只剩"人工 vs 自动"，而它俩缺的度量其实是同一个。**
> 牵头把 (a) 定为"只记读数、判据是不得显著劣于 base"、(b) 定为"相对基线的下限断言（如不低于 base 的 20%）"。但 (a) 的判据"显著劣于"**没有任何定义**——它落到核验人手里的是一句程度副词。既然 placeholder 的 1.94~2.43:1 是产品既有状态、本片不立 4.5 是对的，那 (a) 唯一能落地的形式就是：表 3 里给**每套 × 每对**一个相对 base 的偏移上限（哪怕只是"人工核验 ≤ ±某个可复算的差"），并把它写成 §7 0a 表 3 的一列，而不是留在裁定文本里当形容词。否则 (a) 会把一个本该给出的度量口径再压给实施者脑补——这正是前面几轮反复用"可复算"在消除的那种判断。建议明确：表 3 的判读口径是"该读数相对 base 的差"，并给个数值上界（如绝对差 ≤ 0.5），即便不立断言。

> [!WARNING] **若选 §8-8 的"补齐"，244 条必须有一张"既有 5 套 editor 逐槽 → L1 档"的映射表作直接依据——"机械映射站得住"只证明了值的可达性，没证明映射可核对。**
> 牵头复核"既有 5 套编辑页共引用 14 个 L1 档、四套一个不缺"——这成立了**每个目标档有值可取**，但没成立**每个 editor 槽该落到哪一档有明示依据**。客观地说：既有 23（浅）/28（深）个令牌里有**语义二义槽**（tooltip、active line、autocomplete 高亮、minimap、ghost text…），它们的"规范落点"不是从 `--editor-bg`/`--editor-fg` 那种一眼可推的槽能推导出来的——不同作者会给 tooltip 落到 `sand-800` 还是 `sand-500`、给 active line 落到 `sand-50` 还是半透明，给出相反的答案都不奇怪。
> 我是支持补齐的（二审已认同可行），但补齐的**顺序**应是：先出一张"既有 5 套的 23/28 逐槽落点提取表"（每槽列出 1~5 套各自落哪档、取主流或多数），以它为配方依据落进 §4.2 或附录 B，再谈 244 条。否则"机械映射"这个论断需要一个新的人工推断层才能执行，而那个推断层正是 §3.2 拒斥的"新设计"。这不妨碍本片决策，但让"补齐"具备可审计性。

> [!NOTE] **单调性审计项我认可，但它的落点要具体到"这份阶序声明出现在哪、谁复核"，否则退化成一张空头申明。**
> 二审折中（本片不做断言、只把"11 档亮度单调"写成 §4.2 审计项、提交说明须声明阶序）方向对。但审计项若只宣布"须声明"，复核就无从下手。建议再落半步：把"阶序声明"定义为**随 §7 静态核对一起交付的一行可复算产出**（比如"四套重染后 `--palette-gray-50..950` 逐档亮度单调升序，间隔 ≥ 某个下界"写进第 3 步核对表的读数列），真机复验时逐档读亮度序列做那条 quick 检查。把这半行从"审计项"抬到"核对表的一列"，既不加新机制，又让"作者承诺了单调"第一次可被第三者验证——否则它仍是一纸声明。

> [!TIP] **主动点明"无探针中间档是有意的创作自由度"，免得下一位读者把 {200,500} 当漏洞又补一堆探针。**
> 五对覆盖 `{50,100,300,700,900,950}`；余下五档逐档都有去处——`400` / `600` 在**表 3**（强制输入 chrome，本就不能用 4.5 卡），`800` 在可选的**对 6** 与表 3 的表面上。⇒ **真正"既无 4.5 探针、也不在任何表里"的只有 `{200,500}`**（若放弃可选的**对 6**，`800` 也加入这一档）。M3″ 已明示把 600 当负对照档。建议 §4.5 显式写一句："无探针的中间档（200/500）是有意给主题的创作自由度，不是漏洞"——这一句能防止后续维护者沿"探针该越铺越密"的方向把 `CONTRAST_PAIRS` 推成一张全 11 档矩阵（那正是审阅流程一路在收敛、不想扩大的东西）。呼应本片"五对是抽样不是全覆盖"的定位，把范围边界一句话钉死。

> [!NOTE] **定稿前请把"未做两笔"的提交单列成一件事——它们散在 workspace，审批完不等同于代码落库。**
> §8 留的第 4 件事（console.css 独立线 ＋ S 线 2 个未跟踪文件 ＋ cloudcli 4 个已改文件 ＋ dotfiles 4 个主题文件尚未提交）里，最容易被方案通过带来的满足感盖住的是**代码还散着**。建议定稿提交时把它单列为收尾清单，而不是塞在待决里当第 4 条——否则方案审完、改动面对齐了，实施线却可能被"上一片遗留"和"本片"混在同一批未提交里，回头 split 时难以分离。

---

### 牵头结论（三审）

汇总 2026-09-30 三审（Claude **5 条**）。**每条先复核再裁定**：凡可证伪的都先复算或重新取证——对比度用与本仓库同一口径（8 位通道取整的 WCAG，沿用 `userThemeContrast.paintedChannels`）、灰阶亮度用 HSL L 与 WCAG 相对亮度**两个**口径、editor 逐槽落点用脚本解析 `src/index.css`、站点数用 `rg -o`。**5 条里 3 条采纳、2 条部分采纳、0 条否决。** 五条批注的实质都是"把已经答对的东西写成可复算的数"，本轮把它们全落成了表；复核过程中另外发现**一处真实漏项（`gray-500`）**与**一处自己写错的表面（聊天输入框是 `--card/80` 复合面）**，两处都已修正。

#### 采纳（3 条）

| # | 内容 | 落点 |
|---|---|---|
| 1 | §8-8 的"补齐"缺一张**既有 5 套 editor 逐槽 → L1 档**的提取表（"机械映射"只证明了值的可达性） | **附录 C**（新增）；§8-8 补结论 |
| 2 | 单调性从"审计项"抬成 **§7 静态核对表的一列**，并定义谁复核 | §7 主流程第 3 步**阶序表**（已预填实测值）、第 4 步 quick check、§4.2 注释、§8-7 |
| 3 | "未做两笔"该单列成**收尾清单**，不塞在待决里当第 4 条 | **§9 收尾清单**（新增），并把"上一片遗留 vs 本片"的提交边界写死 |

#### 部分采纳（2 条）

| 来源 | 采纳的部分 | 未采纳的部分与理由 |
|---|---|---|
| 三审 · §8-9 需要可复算判读口径 | **形式全部采纳**：表 3 改为给出"**相对 base 的绝对差**"并配一个数值上界，写成 §7 0a 表 3 的列；同时把表面由二审的 2 格**补全为 6 个读数面** × 5 主体 | **不采纳统一的"绝对差 ≤ 0.5"**。三审给的 0.5 是单目估的，实测两族差了一个数量级：灰阶面（`gray-400/50`、`gray-600/800`）四套与 base 只差 **≤ 0.02**（用 0.5 卡等于松 25 倍、不是防线）；而表面面最大差 **0.56**（dracula 深色 `--background` 1.88 vs base 2.44）、`--card` 0.48 ⇒ **0.5 之下 dracula 当场越界**，抬到 0.6 又是照着数据挑阈值。⇒ 改为**按面族给阈值**：灰阶面 `≤ 0.10`，表面面只登记不设阈值（驱动项是该主题自己的 `ink-950`/`ink-900`，本片不动） |
| 三审 · §4.5 点明"`{200,500}` 是有意的创作自由度、不是漏洞" | **要写这一句**这个判断采纳（它就是用来挡住"把 `CONTRAST_PAIRS` 铺成全 11 档矩阵"的反射动作），已落 §4.5 末尾 | **不采纳它给的理由**。"没被消费所以不必覆盖"与事实不符：`500` 实测 **119 处、其中 101 处作文字**（73 `text-` ＋ 28 `dark:text-`），是五对之外**最大**的未覆盖墨档；`200` 也确有 6 处作文字。真实的理由分成两条（`200` 没有稳定文字场景：浅 1.18 / 深 11.86 两端极值；`400`/`500`/`600` **出厂即不达标**：500 的六格是 4.63 / 4.47 / 4.83 / 3.04 / 3.81 / 3.41）⇒ 已按实测改写理由，并把 `500` 登记进 §7 0a **表 3b** 与 §6 risk 1 的不覆盖清单 |

#### 牵头复算 + 三处更正（三审建议之外）

- **复算一：输入 chrome 的六个读数面**（三审只看到二审的 2 格；本轮按 `textarea` 的真实 className 补全；后两行是复合面的**近似端点**）：

  | 面 | base | dracula | gruvbox | kanagawa | tokyo-night | Δmax |
  |---|---|---|---|---|---|---|
  | 浅 · `on n-gray-50` | 2.43 | 2.41 | 2.44 | 2.40 | 2.41 | 0.02 |
  | 浅 · `on --background` | 2.35 | 2.45 | 2.24 | 2.11 | 1.96 | 0.39 |
  | 浅 · `on --card`（白） | 2.54 | 2.54 | 2.55 | 2.53 | 2.54 | 0.01 |
  | 深 · `on n-gray-800` | 1.94 | 1.94 | 1.94 | 1.95 | 1.94 | 0.01 |
  | 深 · `on --background` | 2.44 | 1.88 | 1.95 | 2.17 | 2.25 | 0.56 |
  | 深 · `on --card` | 2.18 | 1.70 | 1.74 | 1.88 | 2.05 | 0.48 |

- **更正一（表面写错）**：二审表里的 `gray-600 on gray-950` = 2.66 是拿**灰阶**档近似"深色底"，而基色深色底是 `--palette-ink-950`（`src/index.css:75`，`0 0% 8%`）与 `gray-950`（`224 71.4% 4.1%`）**不是同一个色**。已改为按真实表面列。
- **更正二（自查：复合面当成了实色）**：本轮初稿把聊天输入框的底写成 `ChatComposer.tsx:388` 的 `bg-card`，但那一处是**拖拽提示浮层**；输入框外壳实为 `PromptInput.tsx:42-43` 的 `bg-card/80 backdrop-blur-sm`，`PromptInput.tsx:99` 的 textarea 是 `bg-transparent` ⇒ 真实面是"80% 卡片合成在页底之上"的**复合面，纯函数算不出**（与 §4.5 记的 `dark:bg-n-gray-800/50` 同性质）。⇒ §7 0a 表 3 的两个 `--card` 行**降级为近似端点、不参与判读**，真值由同外观的 `--background` 与 `--card` 两行夹住。
- **更正三（顺带发现的真漏项：`gray-500`）**：三审的 TIP 把 `{200,500}` 一起说成"没被消费的创作自由度"。按 `rg -o` 复算后只有 `200` 成立（89 处里 61 处是边、仅 6 处作文字）：**`500` 有 119 处、其中 101 处作文字**，而它的六格读数是 **4.63 / 4.47 / 4.83 / 3.04 / 3.81 / 3.41** ⇒ 与 `400`/`600` 同属"出厂即不达标"的那一类，是**五对之外最大的未覆盖墨档**。⇒ 新增 §7 0a **表 3b** 登记它的六个面 × 五主体读数，并在 §8-9 里点明：它是这一轮唯一"可以顺手补一对真 4.5 探针"的档（浅色灰面/卡面两行四套 4.57~4.84 能过），本方案倾向不做（留给"灰阶收口"那片）。这一处三轮审阅都没点到，是本次复算的净增量。
- **复算二：灰阶 L / WCAG 相对亮度序列**——四套在**两个口径上都严格单调递减**，最小相邻间隔 **2.10 L / 0.01 Y**，且都落在 `50 → 100` 档（与基色同值 ⇒ 是继承来的间隔）。顺带发现机制：**四套的灰阶是"保 L 换色相"**——上半段 `50/100/200/300` 的 L 与基色**逐档完全相同**（98 / 95.9 / 91 / 83.9），下半段偏移 ≤ 2.6 L。这正是"灰阶面读数与 base 差 ≤ 0.02"的反直觉结果之来由，也是 §3.1"整阶重标定"的又一处实证。
- **复算三：既有 5 套 editor 逐槽**（三审要求的依据表）——浅色 **23/23 逐槽相同**；深色 **28 槽里 22 槽相同**，6 槽分两列且唯一轴是"自己的底板取 `ink-950` 还是 `ink-900`"。⇒ 三审设想的那种"语义二义槽（tooltip / active line / minimap / ghost text…）在不同作者手里会落到不同档"的情形，**在既有 5 套上一次都没有出现**。
- **口径自检**：本轮脚本独立复现了文档里已有的全部读数（`2.43` / `1.94` / `2.35` / `2.66` 与 §7 0a 表 1/2 各格），说明三处新表与既有表同口径。

#### 修订说明（本次对方案正文做了什么）

1. **状态行**：`二审已汇总` → **`三审已汇总`**，本版改称**四审稿**，指向三份牵头结论。
2. **§0**：待决行改标"三轮评审后新增"；注明 §8-7 已抬成核对表一列、§8-8 的依据表已产出（附录 C）、§8-9 的口径已落 §7 0a 表 3。
3. **§4.2**：阶序段由"**审计项**（提交说明须声明阶序）"改写为"**核对表的一列**"，并预填实测值；新增"保 L 换色相"的机制说明。
4. **§4.5**：强制 chrome 表由"档 × 消费点 × 单读数"改为"档 × 消费点 × **三读数面**"，补三审对表面的更正（含聊天输入框是 `--card/80` 复合面的说明）；末尾新增"未覆盖档"一段——`200`/`500` 的**理由按实测改写**（`200` 无稳定文字场景、`500` 是最大未覆盖墨档且出厂即不达标），并指向 §7 0a 新立的 **表 3b**。
5. **§7 0a**：表 3 重写为 6 读数面 × 5 主体 ＋ Δmax，判读口径写明"单边、按面族给阈值（灰阶 0.10 / 表面仅登记）"，并把"为何不用统一 0.5"写进表下；**新增表 3b**（`gray-500` 六面读数，登记不设阈值）。
6. **§7 主流程**：第 3 步新增**阶序表**（四套 L 序列 ＋ 单调判据 ＋ 最小间隔，含 base 参照行）并说明它可直接抬成断言；第 4 步新增**逐档亮度 quick check**。
7. **§6 risk 1**：数字改 `1.70~2.55`（六面），不覆盖清单加第 ③ 条（`gray-500`），判据改为"按面族"。
8. **§8**：7 / 8 / 9 三问各自补"三审要求已照办"的回落段落——§8-7 剩"要不要把现成的表抬成断言"、§8-8 剩"要不要照列抄"、§8-9 收窄为 (a)/(b)（只有灰阶面那半立得起断言）并补一条"`gray-500` 是否顺手补一对浅色探针"。
9. **新增 §9 收尾清单**：把"未做两笔"从待决里摘出，列成 6 条动作，并写死"上一片遗留（S 线 2 个未跟踪 ＋ 4 个已改文件）**不与本片混提**"、"仓库里另一条工作流的非主题改动别并进主题那笔"。
10. **附录**：A 的数字更新；B 新增 6 条取证（六个读数面的出处、六面读数、`gray-500`/`gray-200` 的站点分布与读数、L 序列、逐槽落点、口径自检）；**新增附录 C**（editor 逐槽落点提取表 ＋ 它对 §8-8 的三点含义）。

#### 仍未解决 / 留给四审的五件事

1. **§8-9**：口径已定（§7 0a 表 3）。剩 **(a) 只留台账** vs **(b) 把灰阶面那半抬成断言**（`base − 主题 ≤ 0.10`，度量与阈值现成；表面面那几行**没有**可归因的度量，立不了）。另附一问：要不要**顺手**为 `gray-500` 补一对浅色 4.5 探针（表 3b，唯一能过的一档）。牵头倾向 **(a) ＋ 不做**。
2. **§8-8**：依据表已出（附录 C），这一问从"要不要补一整套映射"退化成"**要不要在本片照列抄 23/28 槽**"。牵头倾向补齐，但若你选最小集，附录 C 让下一片变成纯粹的照抄作业。
3. **§8-7**：断言要不要现在就加。度量（L 与 Y 两口径）、下界（2.10 L）、是否分外观三件事都不用再定——§7 第 3 步表已给全。牵头仍倾向不加（造型约束，非可读性约束）。
4. **§8 其余四问**（中文名 / 探针挂哪 / 是否要第三档 `coverage` / 跨仓库搬迁）三轮均未收到反对，仍未表态即视为默认。
5. **§9 收尾清单第 4 条可以立刻做**，与"要不要升内置"无关——它是已完成工作的落库。

### Claude · `四审`（2026-09-30）

> [!IMPORTANT] **§8-9 表态：取 (a)（只留台账、不立断言）＋ 不为 gray-500 补探针；但要把 (b) 明确转交给「灰阶收口」片，而不是在本片留成备选。**
> 理由**不是**"(b) 不会响"——恰恰相反：`base − 主题 ≤ 0.10` 是一条**真守卫**（任何把灰阶 L 染动的 full 主题都会让它响，无论今天这四套还是将来的新主题）。"四套实测 Δ ≤ 0.02"只说明它**当前通过**，与其它探针一样——本仓库警惕的是 M3″/M5 那种**任何输入都不红**的变异，这条不是。它该归哪一片的判据是**它约束的是什么**：它约束"主题须保持灰阶的 L 序"，属**造型约束**（＝ §8-7 那一族），不是本片放松引入的可读性违约；在本片立它，等于把一条造型约束混进"给放松补防线"的片里。
> **建议**：本片取 (a)，但把 (b) 从"备选"改成一句明确的**转交**："灰阶面相对断言的度量与阈值已备齐（§7 0a 表 3 的 `≤ 0.10`），待'灰阶收口'片随 `gray-500` 那对一起立，本片不立"——否则下一片要么重新推导一遍、要么本片多一条与可读性无关的造型约束，两个都不好。gray-500 同理：浅色能过（4.57~4.84）、深色不达标（3.04/3.81/3.41），补浅色只守半边，与本片"对价探针买的就是完整的可读性"口径不符；它和 (b) 一同属于灰阶收口片。

> [!NOTE] **「照列抄」抄哪一列没有歧义：四套取附录 C 的左列（`ink-950` 系）——正文两处都已写死，核对确认、无需补。**
> 附录 C 深色 28 槽里 22 槽一致、6 槽分两列（轴是"自己的底板取 `ink-950` 还是 `ink-900`"）。四套的 `--code-block-bg` 实测都是 `ink-950`（`dracula.css:124/148` 等），而 `code-block-surface.spec.ts:60` 断言 `--editor-bg == --code-block-bg` ⇒ **四套只有左列可选**。这一点正文已写死两处——§4.2 的深色块（"四套的底板是 `ink-950` ⇒ 取 `ink-950`"）与附录 C.3（"四套的 `--code-block-bg` 是 `ink-950`（§3.2）⇒ 照左列逐槽抄"）⇒ §8-8 若选补齐，实施就是照左列抄 23/28，不含取舍、不需要再补一行。（本条初稿误判 §4.2 与附录 C「未写死」，核对后撤回该判断。）

> [!WARNING] **risk 1 的"高"严重度应保留，但可以在它的措辞里加一句 §4.5 已实的 Δ≤0.02——否则读完 risk 1 会误以为"四套解锁灰阶 = 解开就有风险"。**
> 这轮复算的净结论其实缓解了 risk 1：四套是"**保 L 换色相**"，而对比度（在近中性灰的底上）几乎只随 L 变 ⇒ 灰阶面四套与 base 只差 ≤0.02，**本片这四套即便染了完整 11 档，对可读性的实际影响在读数上近乎为零**。风险仍在，但不在四套、而在**契约对世界开口**（将来任何 full 主题都能这么染，不必继承四套的保 L）。risk 1 因此必须保留"高"（它是契约层面的风险），但建议在措辞上加一句"本片四套因保 L 实测 Δ≤0.02、相对安全；风险面向的是未来任意 full 主题"，免得这枚"高"被当作四套本身有问题、或反过来被当作"既然 Δ 小那探针不必加"。

> [!NOTE] **§8 其余四问的表态（与牵头默认一致，但显式地落一句，免得"未反对即默认"落成"没人看过"）。**
> - **中文名**：全部意译（`德古拉 / 复古盒 / 神奈川 / 东京夜`）——与现有 6 条内置（海洋 / 极地 / 卡布奇诺…）一致，`.css` 迁入注册表后中文名是唯一能自报的名字。
> - **探针挂哪**：挂共用的 `CONTRAST_PAIRS`（单一来源、两侧共用、用户主题也受同样警告）——本片所有新增对已按此写成 diff，不存在"独立断言"的动机。
> - **第三档 coverage**：不需要，随 §8-8 补齐后四套即是合规 `full`。
> - **跨仓库搬迁**：接受。前置是 §4.6 的头注处置表（二审产出）＋ §9 收尾清单把"内容搬家"与 S 线遗留分开提交。

> [!NOTE] **抽查背书：本片正文的关键读数与我三审时可核实的点逐一一致——方案三轮后已到可定稿程度。**
> 我复核了本轮正文依赖的锚点：`userThemeContrast.ts:53`（`CONTRAST_PAIRS` 的书写处）、`TextContent.tsx:31/39`（对 3 / 对 1 的真实绘制点）、`VersionUpgradeModal.tsx / McpServerFormModal.tsx / TaskEmptyState.tsx`（对 2 的三处）、`index.css:900-910`（placeholder 的 400/600）、`:861-865`（dark 文字 `gray-100`）——逐处存在、className 与正文引证一致；对 4 = 7.00、placeholder 2.43/1.94 与我同口径复算吻合。三轮里牵头从"复核→修正→补附录 C→自查真漏项"的每一环都落成了可复核的表，方案成熟度已到可定稿。**唯一未决的本片内事项是第 1 条的转交措辞（把 (b) 与 `gray-500` 划给「灰阶收口」片），其余可进入提交。**

### 牵头结论（四审）

汇总 2026-09-30 四审（Claude **5 条**）。**5 条全部采纳、0 条否决、0 条部分采纳**——本轮批注无一条需要复算或取证推翻，性质是**裁定与措辞**（前四轮该量的都量过了）。三类动作：① 把 §8-9 从"要不要立断言"闭合为"（a）＋ 明确转交"；② 给 risk 1 补上"风险在契约层、不在四套"的定性；③ 把"未反对即默认"的四问落成显式表态。

#### 采纳（5 条）

| # | 四审意见 | 落点 |
|---|---|---|
| 1 | **§8-9 取 (a)，并把 (b) 从"备选"改成明确转交**给「灰阶收口」片；`gray-500` 同理（补浅色只守半边，与本片"完整可读性"口径不符） | §8-9 正文：裁定已落 ＋ 写死成交口径"（b）与 gray-500 待「灰阶收口」片随对方一起立，本片不立"；§7 表 3b 下方同步改为"四审已裁定划归收口片" |
| 2 | **「照列抄」抄哪一列无歧义：四套取附录 C 左列**（`ink-950` 系）——正文两处已写死，核对确认、无需补 | §8-8 新增"**四审确认**"段，指明 §4.2（`index.css:250` 一带）与附录 C.3 两处已写死；实施＝照左列抄 23/28、不含取舍 |
| 3 | **risk 1 保留"高"，但措辞须加一句**"本片四套保 L ⇒ Δ≤0.02、相对安全，风险面向未来任意 full 主题" | §6 risk 1 处置列重写：定性改为"**指向契约层、不是这四套**"＋"读这一行的正确姿势"一句 |
| 4 | **§8 其余四问显式表态**（中文名意译 / 挂 `CONTRAST_PAIRS` / 不需要 `coverage` / 接受搬迁），免得"未反对即默认"落成"没人看过" | §8 第 3/4/5/6 问各补"**四审已显式确认**"一句（结论与牵头默认一致） |
| 5 | **抽查背书**：锚点逐处核实、方案已到可定稿程度，唯一未决的本片内事项是第 1 条的转交措辞 | 状态行当时升为"定稿候选"，后经用户同日裁定升为**定稿**；§0 待决行改为"已清零"；本结论 |

#### 本轮净变化（相对三审稿）

- **§8-9 闭合**：从"（a）/（b）请选一个 ＋ gray-500 是否顺手补"→ **已裁定 (a) ＋ 两者均转交收口片**。给下一片留了一句可直接照做的成交口径（度量 `≤ 0.10` 已备齐），避免重推。
- **risk 1 定性修正**：把"高"从"四套可能染坏可读性"纠回"**契约对世界开口**"。这不是降级，是**归位**——它挡住的是将来任何不保 L 的 full 主题，与四套的当前安全性是两回事。
- **§8-8 去二义**：批注 2 初稿曾判"§4.2 与附录 C 未写死左列"，**自查后撤回**（两处确实已写死）⇒ 本版只加一句确认，不改正文。

#### 仍未解决 → **已由用户裁定清零（2026-09-30）**

1. **§8-7**：**不加**阶序断言——与 §8-9 转交的 (b) 同族（造型约束），一并归「灰阶收口」片；阶序表留在 §7 第 3 步作核对项。
2. **§8-8**：**本片一并补齐** editor 到既有 23/28 形态（约 244 条），照附录 C 左列抄；与二审绑定条款一并生效（editor 内部 fg/bg 配对须过 3:1，并入 §7 0a 读数表）。

⇒ **本片待决清零**，可进入 §9 收尾与提交（§9 第 4 条上一片遗留落库现在就能做）。

> **定稿判断（牵头）**：四审第 5 条已给抽查背书。本片正文经四轮"复核→修正→补证"后，所有结论都落到可复核的表或可证的数上；用户已按牵头倾向对最后两件表态 ⇒ **定稿**。实施按 §7 主流程 1–6 ＋ §9 收尾清单执行。

#### 用户追问「约束是否还有适当放开」（2026-09-30，新增一节）

定稿后用户问：除本方案这一条，覆盖层契约是否还有可适当放开处。**牵头复核三处并给出边界（详见 §10）**：① `--n-white`/`--n-black` **可放开但不应放开**（对比度最高风险 ＋ 257 站点）；② `zinc`/`slate`/`neutral` 三族在 **`accent` 侧是同类漏网**（本方案只堵了 `gray`）⇒ 不是放不放开、而是**要不要对称收紧**，见 §10.3；③ 浅色 `--card`/`--popover` 恒纯白是**真实残留收紧**（full 只能在深色动卡面），四套不冲突，见 §10.4。**其中 ② 是四轮评审都没点到的净增量**，用户已裁定取 **(i) 本片扩到四族**（下方「定稿裁定」）。

### 定稿裁定（用户，2026-09-30）

- **§8-7**：不加单调性断言，阶序表留 §7 第 3 步作核对项，归「灰阶收口」片。
- **§8-8**：本片**补齐** editor 到 23/28，照附录 C 左列抄（约 244 条），并兑现 editor 内部 fg/bg 配对过 3:1 的绑定条款。
- **§10.3 三族漏网**：取 **(i) 本片顺手扩到四族**——`compat` 定为 44 档、`accent` 禁移终值 **73**（见 §4.1、§10.3）。
- ⇒ **本片待决清零、文档定稿**；实施按 §7 主流程 ＋ §9 收尾清单。
- **本次复算净增量（四轮评审均未覆盖）**：除了 10.3 的三族漏网，本轮算代价时还发现原写"31 → 42"**本身算错**（`fixed` 由 4 减到 2 未计入，只收 `gray` 应为 **40**）⇒ 已按 §3.1 的"算术修正"逐处改正。

---

## 实施记录（2026-09-30）

**范围**：按 §4 落地四套用户主题（`dracula` / `gruvbox` / `kanagawa` / `tokyo-night`）升为内置主题，含**一处**契约放松（§4.1）、五对 ＋ 一对可选对比度探针（§4.5）、editor 补齐到 23/28（§8-8）、灰阶阶序核对（§7 第 3 步）。`src/index.css` **纯追加 761 行 / 0 删除**（单 hunk `@@ -2592,3 +2592,764 @@`，12 块），`src/shared/constants.ts` ＋4 条，`tests/theme-tokens/theme-overlays.spec.ts` 的 `SYNTAX_BOARD_THEMES` ＋4 名。

### 一、契约的唯一改动（§4.1 / §10.3-(i)）

| 项 | 改前 | 改后 |
|---|---|---|
| `SURFACES.fixed` | `--n-white` / `--n-black` / `--n-gray-100` / `--n-gray-700` | **`--n-white` / `--n-black`**（257 处） |
| `SURFACES.compat`（新组） | — | 四族 × 11 档 ＝ **44 档**（1380 处：`gray` 1223 / `zinc` 66 / `slate` 51 / `neutral` 40） |
| `MUST_NOT_MOVE.accent` | 11 ＋ 7 ＋ 6 ＋ 3 ＋ **4** ＋ 2 ＝ **31** | 11 ＋ 7 ＋ 6 ＋ 3 ＋ **44** ＋ 2 ＝ **73** |

`compat` 的判据是**单向**的：`coverage: full` 可以染，但**必须整族十一档一起染**（只染几档＝"档位之间"的半冷半暖接缝，落回原问题）；`coverage: accent` 一档不许动。`fixed` 的理由按 §4.6 重写为"257 处纯白 / 纯黑填充与标签"（旧理由"终端选区 chrome 的白描边 / 黑阴影"实测只覆盖 4 处、不成立）。

### 二、§7 主流程 1–6 的实测读数

| 步 | §7 的判据 | 实测 |
|---|---|---|
| 1 契约跑绿 | 174 → **198**（每引擎 +12） | ✅ **198 passed / 0 failed**（chromium ＋ webkit） |
| 2 变异 M1–M5 | 见下表 | ✅ 全按预期（含负对照 M3″ 绿） |
| 3 静态核对 | **84 条**全绿（§8-8 补齐后约 244） | ✅ **561 checks / 0 failures**，口径见下文订正 |
| 4 真机复验 | 10 主题 × 2 外观 × 4 类面 ＋ 阶序 quick check | ✅ 见下 |
| 5 门槛 | typecheck ×2 / lint / build:client 全 0；`test:client` 无回归 | ✅ 见下 |
| 6 产物核对 | 4 套新规则块入包 ＋ 字节增量符合预期 | ✅ **+23,832 B**，见下 |

**第 2 步（变异，chromium ＋ webkit 各计）**：

| 变异 | 预期 | 实测 |
|---|---|---|
| M1 删一条 editor 声明 | `mustMove` 红 | ✅ RED |
| M2 删整块语法板 | `SYNTAX_BOARD_THEMES` 红 | ✅ RED，报文 `Error: syntax boards:`（34 passed / 2 failed） |
| M3 `--palette-gray-700` 染到不合读 | 对 1 / 2 / 4 红 | ✅ RED（`contrast`） |
| M3′ `--palette-gray-100` 染到不合读 | 对 2 / 3 / 5 红 | ✅ RED（`contrast`） |
| **M3″ 负对照** `--palette-gray-600` | **绿** | ✅ **GREEN：24 passed / 0 failed** —— §4.5 的残留盲区实证 |
| M4 `cc-ocean` 注入 `--palette-gray-100` | `accent` 禁移红 | ✅ RED，报文 `moved surfaces it does not advertise` |
| M5 `cc-ocean` 注入 `--palette-gray-500` | **红**（读法已翻转） | ✅ RED，同上报文 |

M4 / M5 的报文值得记一笔：四族进 `compat` 之后，`accent` 仍由**旧**那条 `moved surfaces it does not advertise` 拦下 ⇒ "旧防线"在收窄后依然顶岗，本片新增的只是**放给 `full`** 的那半边。M5 从"任何输入都不红的空转"变成真守卫，正是 §4.1 收全 11 档的直接结果。

**M2 第一次跑是假信号，如实记**：删除片段的结尾写成了 `}\n`，把紧随其后的 `.dark` 半块的闭合括号一并吞掉，整份样式表变成非法 CSS ⇒ 页面加载失败，30 条用例全报 `page.waitForFunction` 超时。**那不是守卫命中，是夹具崩了**（与 N10 记录里"有选择器、无括号"那一次同族）。把片段结尾停在最后一条声明的 `;`（不吞括号）后，即得预期的 `Error: syntax boards:`。另记一笔方法学：变异脚本用 `| tail -80` 收尾，管道退出码恒为 0 ⇒"绿 / 红"标签不可信，**只有 `failed` 条数与报文标题是有效信号**。

### 三、阶序（§7 第 3 步的第二列）

逐套读 `--n-gray-50..950` 的 HSL L，与 §7 第 3 步**实施前预填的表逐位相同**：

| 主题 | L 序列 | 单调 | 最小相邻间隔 |
|---|---|---|---|
| dracula | 98.00 95.90 91.00 83.90 65.99 47.24 36.06 28.63 19.04 12.31 4.89 | ✓ | 2.10 |
| gruvbox | 98.00 95.90 91.00 83.90 62.64 43.54 31.75 23.98 14.66 8.48 2.33 | ✓ | 2.10 |
| kanagawa | 98.00 95.90 91.00 83.90 66.31 47.66 36.58 29.22 19.64 12.89 5.47 | ✓ | 2.10 |
| tokyo-night | 98.00 95.90 91.00 83.90 65.91 47.13 35.93 28.49 18.89 12.17 4.76 | ✓ | 2.10 |

第 4 步的 quick check（临时 spec，跑完即删）另得两条读数：**四套 × 两外观的八行读数逐位相同**（斜坡声明在裸块里、与外观无关，与 §4.2 的设计一致），且**每条的最小相邻间隔都落在 50 → 100 档**、与基色同值 ⇒ 这个下界是**继承来的**，不是四套自己压出来的。§8-7 的现成判据（两条口径 ＋ `2.10` 下界）随本次实测一并备齐。

### 四、门槛与产物

| 项 | 读数 |
|---|---|
| `typecheck` | exit 0 |
| `typecheck:theme-tokens` | exit 0 |
| `lint` | **153 warnings / 0 errors**（与既有持平、无新增） |
| `build:client` | exit 0 |
| `test:theme-tokens` | **198 passed / 0 failed** |
| `test:client` | **150 文件 / 1240 全过** |
| `npm test` | **19 失败，全在既有 provider 代码**（Codex 目录 / `getStatus`·WorkBuddy / `resolveClaudeCodeExecutablePath` / `spawnOpenCode` / `synchronizer`）；HEAD worktree 基线为 **24 失败**、是本片红集的**超集**（多出的 5 条带 `/tmp` 路径敏感）⇒ 本片不可能引入它们 |

**第 6 步的做法**：`dist` 里四条新规则块存在，**12 条规则体合计 23,453 B**；整份产物 CSS 由 252,688 B（HEAD）增至 **276,520 B**（＋**23,832 B**），差额 379 B 是 12 处选择器文本与括号。为排除同时未提交的 provider 改动混入，另做**单变量重构**：用 HEAD 的树 ＋ **只替换本片 `src/index.css`** 重建，产物**恰好也是 276,520 B** ⇒ provider 那批改动贡献 **0** CSS 字节。

### 五、两处本方案没写到的门槛（实施时新撞到的）

**1）`src/shared/tests/neutralScale.test.ts` —— "全文最后一次声明赢"**。该 spec 用 `readDeclarations` 读 `src/index.css` 的**全表**（实现与文档都写明"anywhere in the stylesheet"、同名后写覆盖先写），断言 `--palette-gray-*` 等于 Tailwind 的出厂值。四套新块是这份文件里**第一次**重声明 `--palette-gray-*` 的地方，于是该断言变成"拿 dracula 的灰阶去比 Tailwind 的灰阶"，11 条红：

```
--palette-gray-50 (from #f9fafb): expected '230 20% 98%' to be '210 20% 98%'
```

⇒ **确实由本片引入**（HEAD worktree 基线 **105/105 全绿**）。修法：给该 spec 加 `stripOverlayBlocks()`（按括号深度剥掉每个 `[data-theme=` 块）后再 `readDeclarations` —— 覆盖层**有权**重声明这些名字（这正是 `coverage: 'full'` 买的东西），而"出厂的 L1 灰阶"这条断言本来只该看基础层。**§7 的第 3、5 步都没提到这个文件**，属实施面新发现。

**2）`themeHardcodedAtoms.ts` 的原子守恒 —— 扫描器把注释里的类名也算进去**。该扫描器**镜像 Tailwind 自己的 content scan**（跳过 `tests` 目录、只读 `.ts` / `.tsx`、**不剥注释**），所以注释正文里出现的 `bg-n-gray-100` 会被当成一处真实消费。本片在 `userThemeContrast.ts` 新增的六条配对注释里，为指明落点写明了 `bg-n-gray-100` / `dark:bg-n-gray-700` / `dark:bg-n-gray-800`（×2，折进同一桶）/ `dark:bg-n-gray-950` / `dark:text-n-gray-300` / `text-n-gray-700` —— **六个桶各 ＋1**，与 `themeAtomConservation` 的失败清单逐桶对上（其中一处点名 `src/shared/userThemeContrast.ts:82`）。这不是"测试写得太死"：**注释文本进 Tailwind 的扫描面**，真跑 `build` 时那六条 utility 也会被生成、`dist` 里会多出无人使用的类。修法：六条注释改写成不含类名词形的散文，语义（哪一对、哪个落点）一条不丢。

（附：为确认第 2 条的真凶，曾把 `composerModelMenu.test.tsx` 临时挪开复跑，守恒仍红 ⇒ 与它无关，也与此前几笔提交无关——它们一行 `.tsx` 都没动。）

### 六、§4.6 头注处置的落地

| # | §4.6 的处置 | 落地 |
|---|---|---|
| 1 | 343 口径 → 1223（＋四族 1380） | `.agents/skills/theme-authoring/SKILL.md` 改写为四族表 ＋ 契约两档口径；两份研究文档各加「契约订正（2026-09-30）」；设计方案文档 §6 第 6 条回写。四套 `.css` 头注里那几处随文件退场，不必再改 |
| 2 | 通道 B / `:root:not(.dark)` 说明**丢弃** | 未进 `src/index.css` |
| 3 | 形状约束（`--code-block-bg` 须裸三元组或 `var()`，写 `hsl()` 静默丢声明；11 个 `--cc-syntax-*` 是 hex） | 进四套新块的块注释 |
| 4 | 不变量偏离记录**迁出** | 见下 |
| 5 | 色值来源（逐套一行） | 进四套新块的块注释 |

**第 4 类的实测结果**：`dracula.css:38-43` 记的偏离（浅色代码块底是米黄 `#fffbeb`、编辑器页仍是纯白 `#ffffff`；深色 `#282a36` vs `#282c34`）**在迁入后消失** —— 新块同时声明 `--code-block-bg: var(--palette-sand-50)` 与 `--editor-bg: hsl(var(--palette-sand-50))`（深色两处同取 `ink-950`），编辑器页第一次跟着主题走，`code-block-surface.spec.ts:60` 的"底板 == 编辑器页"也由构造满足（8/8 全等）。记录已改写进 §3.2 与提交说明，代码里不再留"偏离还在"的注释。

### 七、与既有账的关系

- **出厂状态无视觉变更**（新增主题只在用户主动选中时生效）；`--palette-white` 未动。
- **§7 第 3 步"84 条"的口径订正**：84 是**最小集**口径下的数；§8-8 裁定**补齐**之后实际落盘的是**约 244 条**（照附录 C 左列抄，浅色 23 槽 / 深色 28 槽），故静态核对报的是 **561 项**（逐令牌 ＋ 值形状 ＋ 阶序），不是 84。两者不矛盾，是同一张表在两种范围下的两个数——**该订正已随本次实测落定**。
- **两处薄边如实登记**（§6 risk 12，不在本片修）：kanagawa 浅色 `muted-fg` / `bg` **4.52:1**、tokyo-night 浅色 `primary-fg` / `primary` **4.59:1** —— 都过线但余量小，将来若动这两个令牌会最先响。
- **「灰阶收口」片的入场券已备齐**：`gray-{200,400,500,600}` 的探针缺口、placeholder 的 `1.9~2.5:1` 既有状态、灰阶面相对断言的度量与阈值（`≤0.10`），三者状态不变，随本次实测读数一并移交。
- §9 第 6 条（`~/.cloudcli/themes/console.css` 仍无语法板）**状态不变**，属独立线。

### 八、§9 收尾清单的完成情况

| # | 动作 | 结果 |
|---|---|---|
| 1 | dotfiles 侧四套 `.css` 删除 | ✅ 已删。**这四份文件在 dotfiles 里从未被 git 跟踪**（`git status` 一直是 `??`）⇒ 只有删除动作、没有提交可写，原文"提交信息里注明"这条落成空操作，如实记此 |
| 2 | cloudcli 侧五处改动 | ✅ 见上，§7 1–6 全绿 |
| 3 | 三处回写 | ✅ 见第六节 |
| 4 | 上一片遗留落两笔独立提交 | ✅ **开工前已落**（`e756584e` feat ＋ `a24206dc` docs）；本片与它们无内容交叉（`src/index.css` 的差异是单 hunk 纯追加） |
| 5 | 非主题改动（provider 那批）另拆 | ✅ 未并入本片提交（§7 第 6 步的产物核对已单变量证明其 CSS 贡献为 0） |
| 6 | `console.css` 的语法板 | 不在本片 |

