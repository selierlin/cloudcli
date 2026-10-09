# CloudCLI 中性色语义化改名方案

> **定位**：本方案对应《CloudCLI 主题与配色体系设计方案》§5.7 与「语义化改名」小节里那笔**未立项**的账。主文档已把主题线收口，并明确该动作"属排期决策、不在主题线范围内"——故本方案**独立成篇**，立项与否由用户单独拍板。
>
> **状态**：**全部定案（路线 B 分层折叠；D1–D7 均按 §9 建议采纳，2026-10-08）**。同日完成**换靶二审**（见 §10-2）与 **D6 拍板实测**（见 §10-3）。**片 1–17 已全部实施，本线收口（见 §11）**——中性色折叠达自然终点，剩余 448 点写成显式白名单档并落机器守卫。所有数字来自 2026-10-08 对工作区的实测。
>
> **一句话**：把组件里 **1075 处**兼容族消费点（`bg-n-gray-100 dark:bg-n-gray-700` 这类）搬到 **19 个 L2 语义令牌**（`bg-muted` 这类）。收益是让主题的既有 substrate 契约**全身生效**、主题接管从"44 档灰阶"降到"~19 个令牌"；代价是**全局必然改色**（折叠有损，不可保形）。

---

## 0. 摘要

| | |
|---|---|
| **改什么** | `src` 下所有 `{bg,text,border,…}-n-{gray,zinc,slate,neutral}-*` 消费者 → L2 语义令牌；同时消灭 `dark:` 双写 |
| **规模** | 1075 处消费点 / 87 种同前缀配对 / 涉及几乎所有组件文件 |
| **能保形吗** | **不能**。87 种 `(light,dark)` 元组 → ~19 个令牌，一对值承载不下，必然移动像素 |
| **最大收益** | 主题的 substrate 契约（`MUST_MOVE.full` 里已有 `--muted`/`--border`/…）从"只覆盖少量消费点"变成"覆盖全部"，**无需新增任何主题契约** |
| **最大代价** | 视觉不可自动验收（没有"零变化"可证），只能逐主题人眼重验（**二审修正：可加截图回归基线，见 §7**） |
| **建议路线** | **B（分层折叠）**：低损配对照折，离群配对保留 `--n-*`（`text gray-400` → D1-b；`text gray-700 → gray-300` → D7-b，两族合计约 66 处配对） |

---

## 1. 范围与现状

### 1.1 消费点

口径：`src/**/*.tsx`，属性前缀（`bg|text|border|ring|divide|from|to|via|stroke|fill|placeholder|outline|decoration|shadow|caret|accent`）＋ `-n-<family>-<step>`。

| family | 消费点 |
|---|---|
| gray | 967 |
| zinc | 55 |
| slate | 28 |
| neutral | 25 |
| **合计** | **1075** |

按属性拆（gray）：`text` 502 / `bg` 264 / `border` 197 / `ring` 2。

### 1.2 形态

- **87 种**同前缀 `light → dark` 配对（如 `text gray-600 → gray-400` 各算一种）
- **18 种**仅 light 无 dark（最大一档：`text gray-900` 52 处）
- **9 种**仅 dark 无 light（最大一档：`bg gray-800` 20 处。**实测其光态几乎全是 `bg-card` / `bg-popover` 卡片浮层面，不是实心按钮**——真·实心按钮只有 3 处且都带 light 基态、不在本桶，详见 §1.4）
- 带 `dark:` 且含 `n-*` 的行：**371 行**

### 1.3 目标集合：21 个 L2 语义令牌

定义在 `src/index.css:208-235`（浅）与 `:494-512`（深）：

| 令牌 | 浅色 | 深色 |
|---|---|---|
| `--background` | sand-50 | ink-950 |
| `--foreground` | sand-950 | ink-100 |
| `--card` / `--popover` | sand-25 | ink-900 |
| `--secondary` | sand-100 | ink-850 |
| `--secondary-foreground` | sand-800 | ink-100 |
| `--muted` | sand-100 | ink-850 |
| `--muted-foreground` | sand-500 | ink-400 |
| `--accent` | sand-100 | ink-850 |
| `--accent-foreground` | sand-800 | ink-100 |
| `--border` | sand-200 | ink-850 |
| `--input` | sand-200 | ink-800 |
| `--sunken`（片 9 新增，见 §9-D9） | sand-200 | ink-800 |
| `--overlay`（片 16 新增，见 §9-D16） | black | black |

（含 `*-foreground` 与 primary/destructive 原 19 个；这三个"面"令牌 `--secondary`/`--muted`/`--accent` **浅深都取值相同**。片 9 因 `bg` 层没有第二档 subdued 面而**新增 `--sunken`**，目标集合 **19 → 20** —— 这是 D9 的唯一契约代价，`theme-overlays.spec.ts` 的 `SURFACES.substrate` 已同步（8 套 full 主题经 `--palette-sand-200`/`--palette-ink-800` 自动"移动"它，无需逐套改写）。片 16 因黑遮罩属兼容层（`bg-n-black/*`）而**新增 `--overlay`**，目标集 **20 → 21** —— 它是**唯一不进 `SURFACES.substrate` 的新增令牌**（源 `--palette-black` 不被任何主题重铺 ⇒ `bg-overlay` 跨全主题恒等，8 套 full 主题无须"移动"它）。）

### 1.4 两处易误读的形态 / 口径（2026-10-08 复核）

**a) "仅 dark 无 light 的 `bg gray-800`"不是实心按钮。** §1.2 记的那 20 处，实测（放宽到"行内无 light `bg-n-*`"口径共 30 行）其**光态**是 `bg-card`(27) / `bg-popover`(2) / `bg-muted`(1)——**清一色是"卡片 / 浮层 ＋ 深色补丁"**，即 `bg-card dark:bg-n-gray-800`。它们**不构成"折到 `--primary` 还是 `--secondary`"的难题**：`--card` 本就外观感知，删掉 `dark:` 半即得 `bg-card`，与其基态一致。

真·实心按钮（基态即 `bg-n-gray-800`）全仓仅 **3 处**：`settings/…/AccountContent.tsx:46`、`onboarding/AgentConnectionsStep.tsx:31`、`standalone-shell/StandaloneShellHeader.tsx:17`——且**都带 light 基态，不在"仅 dark"桶里**，归 §4 的 `bg` 层"基态已实心"批。

**b) 兼容族规模有两个口径，勿混读。** 本方案 §1.1 用**属性前缀**口径（gray 967 / zinc 55 / slate 28 / neutral 25）；`tests/theme-tokens/theme-overlays.spec.ts:126-127` 用**全形态**口径（`n-<family>-<step>` 任意出现、排除测试树）记为 **gray 1287 / zinc 66 / slate 51 / neutral 40**。两者不矛盾（后者含 `--n-*` 声明侧与更多 CSS 属性位），差别只在统计范围 —— 引用规模时须注明是哪个口径。

---

## 2. 映射策略

### 2.1 为什么可行——substrate 契约已经在

`tests/theme-tokens/theme-overlays.spec.ts:70-82` 的 `SURFACES.substrate` 已经包含 `--muted` / `--muted-foreground` / `--secondary` / `--accent` / `--border` / `--input` / `--foreground`，而它**在 `MUST_MOVE.full` 里**（`:206`）——即每套 `full` 主题**今天就必须**动这些令牌。

这意味着：**改名轮不新增任何主题契约**。它只是把"主题已经动了的令牌"从"少量消费点读它"变成"全部中性消费点读它"。主题侧不用学新东西，只是原来染了没效果的现在生效了。

### 2.2 映射表（高频 10 条，覆盖约 54% 消费点）

口径：这 10 条配对各占若干处，合计覆盖 **288 个配对**（`light` + `dark` 两侧共 576 个消费点 / 1075 ≈ **54%**；其余为长尾与"仅 light / 仅 dark"的单侧档）。

损失口径：`ΔL` = 明度百分点差（浅色侧用 light 值、深色侧用 dark 值）；`ΔRGB` = 最大通道差（0~255），**主要来自色相从冷（gray H≈215~224）转到暖（sand H≈40~44）**。

| 配对 | 处 | → 令牌 | 浅 ΔL | 浅 ΔRGB | 深 ΔL | 深 ΔRGB |
|---|---:|---|---:|---:|---:|---:|
| `text gray-900 → gray-100` | 16 | `foreground` | −7 | **31** | −2.9 | 10 |
| `text gray-700 → gray-300` ⚠️① | 42 | `secondary-foreground`（**借位**） | −8.7 | 42 | +9.1 | 30 |
| `text gray-600 → gray-400` ⚠️③ | 57 | `muted-foreground`（与下条**同色**） | +8.9 | 40 | −4.9 | 22 |
| `text gray-500 → gray-400` ⚠️③ | 37 | `muted-foreground`（与上条**同色**） | −3.1 | 24 | −4.9 | 22 |
| **`text gray-400 → gray-500`** | **24** | `muted-foreground` | **−21.9** | **71** | **+13.9** | **46** |
| `bg gray-100 → gray-800` ⚠️② | 15 | `muted` | −4.9 | 17 | +0.1 | 12 |
| `bg gray-50 → gray-800` ⚠️② | 12 | `muted` | −7 | 22 | +0.1 | 12 |
| `bg gray-200 → gray-700` ⚠️② | 10 | `sunken`（**片 9 改判**，见 §10-4） | −4 | 18 | −3.7 | 22 |
| `border gray-200 → gray-700` | 49 | `border` | −4 | 18 | −9.7 | 38 |
| `border gray-300 → gray-600` ⚠️④ | 26 | `input`（**借用**） | +3.1 | 18 | −11.1 | 40 |

**读法**：

- 深色侧的 `bg gray-100/50 → gray-800` 几乎**零变化**（ΔL +0.1）——因为 `--muted` 深色 = ink-850 (17%) ≈ gray-800 (16.9%)。明度位置本来就撞上了，变的只是色相（冷→中性）。
- 浅色侧 `bg gray-200 → secondary` **ΔRGB 仅 6**——`--secondary` 浅色 = sand-100 (91%) ≈ gray-200 (91%)。
- 大部分配对 ΔRGB ≤ 42，属"冷调换暖调"的可接受变化。
- **离群之一**：`text gray-400 → gray-500`，浅 ΔL −21.9 / ΔRGB 71。`--muted-foreground`（sand-500, 43%）太深，承载不了"最弱的辅助文字"这一层。

**二审补充（2026-10-08，见 §10-2）：表中带 ⚠️ 的四点是"折叠的结构性缺陷"，逐条都能升成待拍板项。**

- ⚠️① **`text gray-700 → gray-300`（42 处）的目标令牌是"借位"**：`--secondary-foreground` 的契约是"画在 `bg-secondary` 上的文字"（正当消费者仅 `Button.tsx:17` / `Badge.tsx:12`），而这 42 处是**正文/副文**（`AccountContent.tsx:45` 副文、`TextContent.tsx:47`、`MessageComponent.tsx:440` 正文；少数如 `McpServerFormModal.tsx:244/255` 落在 B 类实心按钮上、本就不折）。按语义应换 `--foreground`，但实测**更糟**：浅 ΔRGB 42 → **73**、ΔL −8.7 → −22.7（`--foreground`=sand-950(4%) 比 gray-700(26.7%) 深得多）。⇒ 与 `text gray-400` 同性质——**19 个 L2 令牌里没有"正文次级文本"这一层**，见 §2.3b。**D7 定案 b（保留 `text-n-gray-700` / `dark:text-n-gray-300` 族不折，并入 D1 白名单 —— 与 D1-b 同性质：L2 缺该层）。**
- ⚠️② **两级浮底塌成一级**：`--muted`＝`--secondary`＝`--accent` **浅深都同值**（`index.css:218/220/222`、`:502/504/506`，实测复核），所以本表的 `bg gray-100/50 → muted` 与 `bg gray-200 → secondary` 折完**是同一个颜色**——源档 95.9% / 91% 的两级浮底，在两种外观下都塌成沙-100 / 墨-850。见 §9-**D6**。**D6 拍板实测（§10-3）：折叠命中的不只是“两级浮底”，更有 10 处“基态 `bg-n-gray-100` ＋ `hover:bg-n-gray-200`”次级按钮 —— `--muted`=`--secondary` 同值使 hover 反馈归零；定案 D6-a（接受，换取 `bg` 层清零，人工验收点名）。** **片 9 补（§10-4）：`bg gray-200 → sunken` 后不再与 `muted` 同色（sand-200 87% vs sand-100 91%），本行"塌一档"解除；仍塌的只剩 `bg gray-50` 与 `bg gray-100`（都 → `muted`，而源档 96% / 95.9% 本就只差 0.1，视觉无感）。**
- ⚠️③ **`text gray-600` 与 `text gray-500` 折后同色**：源档明度差 12 点（34.1% / 46.1%），而 `--muted-foreground`（sand-500, 43%）只有一个位置 ⇒ 折后合并。损失比 ② 小，但同属"多档塌一档"。
- ⚠️④ **`border gray-300 → --input` 是借用语义**：该族实际用在**按钮/卡片边框**（非输入框），`--input` 的语义是"输入控件边框"。可接受，须记账。

**关于 zinc / slate / neutral 三族（108 处）**：它们按**步进名直接复用上表**（`bg-n-zinc-100 → bg-n-gray-100` 的同一行）。折叠的**目标是语义令牌**，与源族无关，所以不需要各出一张表、也不必然要保留 `--n-*`。唯一要留意的是四族**同名步进的明度并不严格相等**（如 `neutral-800` 14.9% vs `gray-800` 16.9%、`neutral-900` 9% vs `gray-900` 11%；hue 差别更大：neutral 0 / zinc 240 / slate 210~228 / gray 210~224），所以复用后 ΔRGB 会略有出入（各档 ≤ 数个百分点），但**不改变目标令牌的选择**。

### 2.3 离群配对的处置

两条"折叠即明显失真"的族：

**a) `text gray-400`（24 处配对）** —— 浅 ΔL −21.9 / ΔRGB 71，`--muted-foreground`（sand-500, 43%）太深，承载不了"最弱的辅助文字"这一层。三选：

- **D1-a** 加一个新令牌（如 `--faint-foreground`）承载这一层 → 目标集合 19 → 20，主题契约要同步加（`MUST_MOVE` + 白名单）。
- **D1-b** 保留 `--n-gray-400` 不折 → 破坏"消费点归零"，但改动最小。**（已定案）**
- **D1-c** 强行折到 `--muted-foreground` → 接受 24 处的明显变化。

**b) `text gray-700 → gray-300`（42 处配对）** —— **二审新增**（见 §2.2 ⚠️①）。现表目标 `--secondary-foreground` 是**借位**（契约是"画在 `bg-secondary` 上的文字"），语义不对；而语义正确的 `--foreground` 实测**更糟**（浅 ΔRGB 73）。同属"L2 缺一层"。处置候选同 a。**定案 D7-b**（保留该族不折，并入 D1 白名单 —— 与 D1-b 同性质：L2 缺“正文次级文本”这一层）。

### 2.4 顺带收益：仅 light 无 dark 的档自动获得外观感知

`text gray-900`（52 处，无 dark 伙伴）→ `text-foreground` 后，深色外观下不再"深灰（11%）压在近黑（8%）上"。这一族今天在深色外观下的可读性是可疑的，改名后由 `--foreground` 的外观感知直接解决。

---

## 3. 三条路线

| 路线 | 做法 | 消费点覆盖 | 改色幅度 | 代价 |
|---|---|---|---|---|
| **A 全量** | 1075 处全搬，含离群 | 100% | 最大 | 守恒律必须退役；逐主题重验全部面 |
| **B 分层（推荐）** | 低损照折；离群保留 `--n-*` | ~90% | 受控 | 仍有"残留 `--n-*` 消费点"，改名不彻底 |
| **C 不搬** | 组件不动，改由每套主题铺满 44 档灰阶 | 0% | 0（仓库） | 27 套主题（11 内置 ＋ 16 用户）各自 44 档的重复劳动；`--n-*` 消费点永久存在 |

**推荐 B 的理由**：折叠损失的主要来源是色相（冷→暖），这是**想要的**变化；会"疼"的是少数离群族（`text gray-400`，二审又发现 `text gray-700` 存疑，合计 66 处配对）。把它们排除后，改色幅度受控。

> **二审修正（2026-10-08）：B 的"约 90% 收益"要拆成两个口径说。**
> ① **消费者覆盖**确实 ≈85~90%；
> ② 但**"让主题接管这一族"这半个收益，对保留族不成立** —— nord 没有任何 `--palette-gray-*` 覆盖（实测 `palette-gray:0`），所以被保留的 `--n-gray-400`（全形态 **146 处**）在 nord 下**仍是出厂冷灰**。B 只避开了"出厂像素移动"，没把这族交进主题手里。
> 要让 ② 也成立，只能选 **D1-a**（加令牌）或 **A**（全量）。

**路线 C 值得认真对待**：它其实是"改名轮的替代品"——北欧（nord）那类主题完全可以靠"重铺 44 档兼容族"全身修好（另外 8 套用户主题就是这么做的：7 套重铺 `--palette-gray-*`、`console` 直铺 `--n-gray-*`）。二者的差别是：**改名轮把"44 档映射"的工作做一次、放在仓库里；路线 C 把它转嫁给每个主题作者。**

---

## 4. 分片执行

建议按**属性层**推进（语义清晰度：text > border > bg），每层再按文件集群拆：

| 层 | 处数 | 语义清晰度 | 备注 |
|---|---:|---|---|
| `text` | 502 | 高（正文/次要/弱文字三档清晰） | 先做；含 52 处"仅 light" |
| `border` | 197 | 高（`--border` / `--input`） | 目标令牌少、损失小 |
| `bg` | 264 | 中（含 B 类实心按钮，不折） | 须先剔除"基态已实心"的那批 |
| `ring` | 2 | — | 单独处理 |

每片交付 = 该片 `--n-*` 消费点**按白名单口径归零** ＋ 该片涉及的界面人工过一遍。

> **口径与 D1 绑定**：若 §9-D1 取 **b（保留 `--n-gray-400` 一族）**，则"归零"只能是"**除白名单配对外归零**"，且**白名单必须写进 grep 命令本身**（否则每片的完成判定含糊）。白名单范围要按"全形态"实测圈定 —— 按批注复算，`text-n-gray-400` 全形态约 **146 处**（其后接空格的约 71 处），远超 §2.2 表里那一档 24 处配对。若 D1 取 a / c（不留 `--n-*`），则维持严格"归零"。

> **二审追加（2026-10-08）**：§9-**D7** 定案 b（`text gray-700` 一族也保留 `--n-*`），白名单须加 `text-n-gray-700`/`dark:text-n-gray-300` 这一族（42 处配对）；两族合计约 66 处配对。白名单**每加一族都要同步 grep**。D6 定案 a：`bg` 层仍按“除白名单外归零”，但这 10 处 hover（`bg-n-gray-200` → 同色 `--secondary`）折叠后无视觉反馈，须在人工验收时点名接受。

> **收口（2026-10-08）**：本条口径已落地为**机器守卫**（而非字面 grep）—— `src/shared/tests/neutralConsumerWhitelist.ts` 的数据 ＋ `neutralConsumerWhitelist.test.ts` 的差集断言（"白名单外归零" ＋ "无死条目"）。见 §11。

---

## 5. 主题迁移

**关键结论：不是所有主题都要改。** 分两类：

### 5.1 自动跟随（7 套内置 ＋ 8 套用户，无需改动）

它们染的是 `--palette-sand-*` / `--palette-ink-*`——而语义令牌正是 `var(--palette-sand-100)` 这类引用，所以改名后**自动生效**：

- 内置（7 套）：`cc-light` / `cc-dark`（两套基座，无自身 overlay，即 `:root` / `.dark` 本身）、`cc-ocean`（`coverage: accent`，不碰 substrate）、`cc-catppuccin` / `cc-islands` / `cc-onedark` / `cc-onedark-vivid`（后四套 `index.css:1672/1936/2244/…`，均 **gray:0 / sand:7 / ink:6**）
- 用户：`clay` / `fluent` / `liquid-glass` / `macos-native` / `neubrutalism` / `nord` / `tui` / `win9x`（只写语义令牌或 palette sand/ink）

### 5.2 必须改写（4 套内置 ＋ 8 套用户）

它们重铺了兼容灰阶（7 套染 `--palette-gray-*` 整族 11~12 档，`console` 直接铺 `--n-gray-*` 13 档），改名后这层**失去消费者**、染色失效，须改成染 sand/ink 或直接覆盖语义令牌：

| 内置 | gray 档 | sand | ink |
|---|---:|---:|---:|
| `cc-dracula` | 11 | 9 | 7 |
| `cc-gruvbox` | 11 | 7 | 6 |
| `cc-kanagawa` | 11 | 7 | 6 |
| `cc-tokyo-night` | 11 | 7 | 6 |

| 用户 | gray 档 |
|---|---:|
| `ayu` / `everforest` / `monokai` / `papercolor` / `rose-pine` / `synthwave84` | 11 |
| `solarized` | 12 |
| `console` | 直接铺 `--n-gray-*` 13 档 |

**注意**：这 4 套内置本来就同时染 sand/ink（要满足 `MUST_MOVE.full` 的 substrate），所以改名后它们的**底料仍然对**——失效的只有 gray 那一层。改写 ≈ **删掉 gray 染色**（或改成更细的语义令牌覆盖）。

> **二审定性修正（2026-10-08）：标题里的"必须改写"要拆成两种不同强度。**
> - **4 套内置（`coverage: full`）—— 清 gray 层"合法且安全"。** `compat`（`theme-overlays.spec.ts:144`）**不在 `MUST_MOVE.full` 里**：`MUST_MOVE.full = substrate + terminal + graph + editor`（`:204-206`），`MUST_NOT_MOVE.full` 只含 `fixed`（`:219`）。即 full 主题"不动 compat"完全合法 ⇒ 删掉 gray 层**不会破任何契约**。
> - **8 套用户主题 —— 不受 coverage 契约约束。** 仓库里**没有任何 spec 读 `~/.cloudcli/themes/`**（实测 grep 无命中）⇒ 它们不跑这张契约，改写是"**按效果该改**"，不是"契约逼着改"。
>
> 结论：§8"主题连锁更新"风险**实际低于标题所示** —— 4 套内置是"删一层"，8 套用户是"自觉维护"。

---

## 6. 护栏生命周期（方案里最容易漏的一节）

| 护栏 | 位置 | 改名后 | 处置 |
|---|---|---|---|
| **守恒律** | `src/shared/tests/themeAtomConservation.test.ts` ＋ `theme-atom-conservation.json` | **不红**（收口后冻结在 448） | "会红"的预测基于"消费点归零"假设；D1-b/D7-b 保留了消费者 ⇒ 反空转断言（`:98-102`，要求 `--n-*` 命中 > 0）仍满足。D3=c 定"部分保留" ⇒ 收口后退化为**纯防漂移**守卫，见 §11.4 |
| token 基线 | `tests/theme-tokens/token-baseline.json` ＋ `token-contract.spec.ts:60/94` | **不动** | 它 pin 的是声明侧解析值 |
| **palette 消费存在性** | `token-contract.spec.ts:122`（`every palette token is consumed by at least one declaration`） | **绿的前提是 D2=b 保留 `--n-*` 声明** | 若 `--n-gray-*` 骨架**整个退役**，`--palette-gray-*` 立刻变孤儿 ⇒ 该测试红。它今天绿，**正因为** `--n-gray-*` 的声明还引用着 `--palette-gray-*`。⇒ **D2 与 D1-b 自相矛盾**：D2 说 `--n-*` 降级为"仅声明、无消费者"，而 D1-b 明确保留了 `--n-gray-400` 的消费者（146 处）。见 §9-D2 精修 |
| 硬编码扫描器 | `themeHardcodedAtoms.ts` ＋ `theme-hardcoded-baseline.json`（现 total 0） | **不红** | 只管字面 Tailwind 色；`--n-*` 半只喂守恒律 |
| 对比度 | `src/shared/userThemeContrast.ts:67-87`（含 `--n-gray-*` 对 `:74-86`） | **不红，且仍有效** | "陈旧"的预测同样基于"归零"假设；D1-b/D7-b 保留族仍有 448 命中在用 ⇒ 这些对比度对**仍被绘制**、并非"没人绘制的度量"。收窄会失去对保留族的对比度保护 ⇒ **不收窄**（除非将来 re-open D1/D7 折掉保留族） |
| 主题覆盖层契约 | `theme-overlays.spec.ts`（`compat` 组 `:144-157`、none-or-all `:539`） | **不破坏** | `compat` 不在 `MUST_MOVE.full` 里，主题"不动它"合法；只是这组契约变成"可选死契约" |
| 触屏 hover 手写选择器 | `src/index.css:1205-1208`、`token-contract.spec.ts:205` | **已清理（2026-10-08）** | 中和块的 `--n-gray-*` 三条（`hover:bg-n-gray-50`/`hover:bg-n-gray-100`/`dark:hover:bg-n-gray-700`）随改名折走消费者后成死选择器 ⇒ 已删；`red-*` 两条（状态色，活）保留。守卫**改判**为"钉活类 ＋ 禁死类重现"，双向突变已验证 |

**最重要的两条**：① 守恒律是"为改名轮而存在的护栏"，改名轮完成 = 它使命结束，**必须显式退役**而不是刷基线放行；② 这个退役**会让中性色失去唯一一层结构保护**，所以路线 B 保留部分 `--n-*` 时，守恒律可**部分保留**（这正是推荐 B 的一个附带好处）。

---

## 7. 验收口径

**"视觉零变化"（DoD 阈值 0）在本轮作废**——因为改色是设计目标。替代口径三条：

1. **逐片 grep 清零**：该片的 `--n-*` 消费点归零（机器可查）。
2. **逐主题 × 逐外观人工过**：范围 = 出厂的浅/深 ＋ 受影响的重点主题。（**二审修正见下**）
3. **契约生效可验证**：抽一套 substrate 令牌，证明"full 主题改它 → 消费点全变"（这正是改名的目的，也是它唯一的正向证据）。

> **二审修正（2026-10-08）：第 2 条"人工过是唯一可行方式"写过重了——它是"今日没做"，不是"做不到"。**
> Playwright 已是 **1.63.0**，自带 `toHaveScreenshot`（内置 pixelmatch）；`sharp ^0.34.2` 是**直接依赖**；仓库现有截图/快照用例 **0 个**（实测）。缺的只是"**用例 ＋ 检入基线 PNG ＋ 阈值/更新流程**"三样。
> ⇒ 若愿投入，可把"逐主题 × 逐外观"从纯人眼升级为**截图回归基线**（首次人眼核准，之后自动报像素差）。注意它报"变了"、报不出"变错了"，人眼仍不能省；但可从"每次全界面看"降为"**只在基线 diff 出现时看**"。⇒ §8 首条风险与 §0"最大代价"的措辞应据此收敛。

---

## 8. 风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| **无自动视觉护栏** | 改色是全局的；**现状是"没做"而非"做不到"**——Playwright 1.63.0 ＋ `sharp` 已具备 `toHaveScreenshot`，仓库现有 0 个截图用例（见 §7 二审修正）。即便做了，基线也只报"变了"、报不出"变错了" | 可加截图回归基线（首次人眼核准，之后自动报像素差）＋ 逐主题人眼；分片小步；每片先出对照截图 |
| **守恒律退役后裸奔** | 中性色失去结构保护 | 路线 B 保留部分；或新写"语义令牌消费点计数"型护栏 |
| **主题连锁更新** | 12 套主题要改（4 内置 ＋ 8 用户），且改完要重验 | 5.2 已明确；**二审定性：4 内置删 gray 层"合法且安全"（`compat` 不在 `MUST_MOVE.full`）、8 用户不受 coverage 契约约束**，故风险实际更低 |
| **`--n-*` 变成空壳** | 拍板为永久契约面，但消费点归零后没人读 | 见 §9-D2 |
| **89 vs 87 口径** | 文档旧记"89 种元组"，本方案实测 87（同前缀口径），差异来自配对算法 | 以本方案实测为准 |

---

## 9. 决策项（2026-10-08）

**全案定案（2026-10-08，均按 §9 建议采纳）—— D1=b（保留 `--n-gray-400`）/ D2=b（精修：`--n-*` 降级为“仅声明、标注无消费者”）/ D3=c（守恒律部分保留）/ D4=B（分层折叠）/ D5=出厂 ＋ 12 套 / D6=a（接受 `bg` 层“多档塌一档”，含 10 处 hover 反馈归零）/ D7=b（`text gray-700` 族并入 D1 白名单）/ D8=a（卡片加深族 `bg-card … dark:bg-n-gray-800` → `dark:bg-secondary`）/ D9=b 轻量版（新增 `--sunken` 接住 `bg` 层 gray-700 面族）/ D10=a（次级/描边按钮状态对 10 行归一为"两档面 hover"，见 §10-5）/ D11=a（inset/卡片块 12 行折 `--card`/`--background`；B 类实心按钮判定保留，见 §10-6）/ D12=a（白面族 2 行折 `--card`＋守卫表收口，见 §10-7）/ D13=a（ring 族折 `ring-border`/`ring-offset-muted`/`ring-offset-background`，见 §10-8）/ D14=a（ghost 兼容族 zinc/slate/neutral 收口，见 §10-9）/ D15=a（常暗容器族按"有无跟随外观的规范兄弟"分流，见 §10-10）/ D16=b（遮罩族 32 点折新增 `--overlay`，零视觉变化，见 §10-11）/ D17=a（残余 hover 态 8 行对齐 `hover:text-foreground` 惯例，见 §10-12）。** 换靶二审见 §10-2，D6 拍板实测见 §10-3，D8/D9 实测见 §10-4。

| # | 决策 | 选项 | 决定 |
|---|---|---|---|
| **D1** | 离群配对（`text gray-400`，24 处）怎么办 | a) 加 `--faint-foreground` / b) 保留 `--n-gray-400` / c) 强折 | **b**（路线 B 的前提；二审发现同类还有 `text gray-700`，见 D7） |
| **D2** | `--n-*` 声明与 `--palette-gray-*` 的最终处置 | a) 原样保留（永久契约面）/ b) 降级为"仅声明、标注无消费者" / c) 收敛删除 | **b**，**精修**：`--n-*` 的"无消费者"须**排除 D1-b 保留的 `--n-gray-400` 一族**（仍有 146 处消费者）；`--palette-gray-*` 也正是靠这层声明才不触 `token-contract.spec.ts:122` 的孤儿断言 |
| **D3** | 守恒律怎么处置 | a) 退役删除 / b) 重写为"声明侧存在性" / c) 部分保留（路线 B） | **c**（若走 B） |
| **D4** | 走哪条路线 | A 全量 / B 分层 / C 不搬改铺主题 | **B** |
| **D5** | 验收时人工要过多少主题 | 只过出厂 / 过全部（11 内置 ＋ 16 用户 = 27 套） | **过出厂 ＋ 5.2 的 12 套（4 内置 ＋ 8 用户）** |
| **D6** | 折叠后"多档塌一档"要不要接受（§2.2 ⚠️②③） | a) 接受（含 10 处次级按钮 hover 反馈归零）/ b) 重定 `--secondary` 或 `--muted` 的值使二者有别（**动出厂外观 ＋ 全部主题重验**）/ c) 该族保留 `--n-*` | **a**（实测见 §10-3：b 动出厂太重、c 保留病根式冷灰）；⚠️ 10 处 hover 无反馈须人工验收点名 |
| **D7** | `text gray-700` 一族（42 处配对）的目标令牌（§2.3b） | a) 强折 `--foreground`（接受浅 ΔRGB 73）/ b) 保留 `--n-*`（并入 D1 白名单）/ c) 新增令牌（同 D1-a） | **b**（与 D1-b 同性质：L2 缺“正文次级文本”这一层） |
| **D8** | 卡片加深族 `bg-card … dark:bg-n-gray-800`（29 行）＋ F2 `dark:bg-n-gray-900`（5 行）的归宿 | a) `dark:bg-secondary`（零变化、跟主题、留 `dark:` 双写）/ b) 新增 `--raised`（消灭双写、动契约）/ c) 丢掉覆盖只留 `bg-card`（深色变暗） | **a**（`dark:bg-secondary`，与 `PillBar.tsx:38`/`SidebarModeTabs.tsx:68` 既有同款；F2 归 `bg-card`） |
| **D9** | `bg` 层 `dark:bg-n-gray-700` 面族（31 行）的深侧归宿 —— `--muted`/`--secondary`/`--accent` 恒同值，L2 无第二档 subdued 面 | a) 不新增（接受只剩 4 套主题跟、折 1:1 令牌时 ΔL≈10）/ b) 新增令牌 / c) 就地保留 `--n-*`（把"不跟主题"固化） | **b 轻量版**：只补 **1 个 `--sunken`（浅 sand-200 / 深 ink-800）**，一次接住 gray-700 面族的深侧；目标集 19 → 20（见 §1.3） |
| **D10** | `bg` 层"次级/描边按钮状态对"（10 行：片 9 排的 8 处 ＋ `TaskBoardToolbar:155` ＋ `QuickSettingsHandle:66`）的归宿 —— 深侧 rest `gray-700`(26.7%) / hover `gray-600`(34.1%) **都亮于 L2 最亮深色面 `sunken`(23%)** | a) 归一为"两档面 hover"（`bg-muted hover:bg-sunken`；形态 A 保 `bg-card dark:bg-secondary`）/ b) 并入 D1-b 白名单不动 / c) 再新增第二档令牌 | **a**（复用 D9 的 `--sunken` 兼作 hover 加深档，全主题方向一致；代价＝深色整体降一档 Δ≈10，见 §10-5） |
| **D11** | `bg` 层"inset/卡片块"（12 行：浅 `gray-50/100` ＋ 深 `gray-900/950`）的归宿；B 类实心按钮（品牌色 ＋ 中灰装饰件）是否折 | a) inset 块折 `--card`（全屏遮罩归 `--background`）＋ B 类保留 / b) B 类也强折 / c) 两者全保留 | **a**（浅 `gray-50/100` 98~96%≈`card` 100%、深 `gray-900` 11%≈`card` 深 12%，Δ 最小且跟主题；B 类＝品牌色体系＋中灰装饰件，L2 缺角色故保留，见 §10-6） |
| **D12** | `bg` 层"白面族"（`bg-n-white` 做底面：`CodeEditorSurface:62`、`MermaidDiagram:78`；守卫 `semanticSurfaceTokens` 显式冻结为"deferred face"）的归宿 | a) 折 `--card`＋守卫表收口 / b) 新增 `bg-editor` 键（`--editor-bg`）／`bg-code-block` / c) 保留在守卫表 | **a**（浅 `n-white`＝`card` 浅、深 `gray-900` 11%≈`card` 深 12%，Δ 最小；`--editor-bg` 是"完整色值"令牌、深 18% Δ7 且引入非 `hsl()` 键型 ⇒ 不选；守卫提示语亦推荐 `bg-card`，见 §10-7） |
| **D13** | `ring` / `ring-offset` 族（`border` 姊妹，片 3 未收；7 处含兄弟族）的归宿 | a) 折语义令牌（描边→`ring-border`、焦点缝隙→按容器 `ring-offset-muted`/`ring-offset-background`）/ b) 并入白名单保留 | **a**（`ring-offset` 语义＝元素紧邻背景⇒按容器选；类均对齐既有设计系统写法、零新造；守恒律 555→543，见 §10-8） |
| **D14** | ghost 兼容族（`zinc`/`slate`/`neutral`，与 gray 并列、明度 Δ<2%、同样只 4 套主题跟）的归宿 | a) 按"状态/分类调色板中性档折中性令牌、彩色档保留"统一收口 / b) 整族保留 / c) 只折非品牌处 | **a**（中性档承载"无信号"⇒中性令牌正确；彩色状态色/品牌色卡/常暗容器保留；守恒律 543→505、slate 族清零，见 §10-9） |
| **D15** | 常暗容器族（7 处：`prose-pre`、`TextContent` json、`StandaloneShellHeader`、`OneLineDisplay`、`VersionUpgradeModal`、`Tooltip`、`SidebarProjectItem` tint）的归宿 | a) 按"有无跟随外观的规范兄弟"分流（兄弟跟外观者折、绿字终端/反色者保留）/ b) 整族保留（沿用 D14"常暗保留"先例）/ c) 整族折 | **a**（#1–#3 有跟随外观的规范兄弟⇒遗留可折；#4–#6 绿字终端契约/刻意反色⇒保留；#7 tint 对转别族；守恒律 505→496，见 §10-10） |
| **D16** | `bg` 层遮罩族（`bg-n-black/NN` 32 点：模态/抽屉全屏 dim 层）的归宿 —— `--n-black` ＝ `--palette-black` ＝ `0 0% 0%`、**无任何主题重铺**（≠ `--n-gray-*`）⇒ **无"不跟主题"缺陷**；但 `black` ∈ 守卫 `NEUTRAL_FAMILIES`，字面 `bg-black` 被禁 | a) 保留 `bg-n-black/*` 为刻意签名（零改动）/ b) 新增 `--overlay` 折 `bg-overlay/NN` / c) 折 `bg-background/NN`（对齐 Settings/移动抽屉） | **b**（零视觉变化、零 overlay 改写、清掉兼容层消费；`--overlay` 浅深皆 `var(--palette-black)`；不透明 3 处与 chip tint 保留；守恒律 496→464，见 §10-11） |
| **D17** | 残余 `hover:text-n-gray-*`（8 行：`gray-600` hover 5 ＋ `gray-700` hover 3 ＋ `dark:gray-300` hover 8）；其基态已是白名单（`text-n-gray-400`）或语义（`text-muted-foreground`） | a) 对齐全仓惯例 `hover:text-foreground` / b) 保留 raw（视为白名单族的 hover） | **a**（`text-n-gray-400 hover:text-foreground` 与 `text-muted-foreground hover:text-foreground` 是两类基态的既定配方、10+ 处先例；`MessageCopyControl:200` 同组件二分支自证；守恒律 464→448，见 §10-12）|

---

## 附：一句话回答"值不值"

**它把"每套主题各自 44 档灰阶的重复劳动"换成"仓库里一次 1075 处的重构"**——收益是复利的（未来每个新主题都更省事），代价是现在这一次全局改色。**决策变量只有一个：未来还会不会持续加主题。**

---

## 审阅批注

### WorkBuddy · `01a11b18-830f-7464-b637-3ba40c113f27`

> [!IMPORTANT] 关键信息：改造难度评估。机械部分风险低——1075 处消费点集中在 74 个 `tsx` 文件（实测复核一致），映射由 §2.2 的配对表驱动，可脚本化 codemod，逐片 grep 清零可机器验收；真正的成本大头在**人工视觉验收**（§7-2：出厂 2 外观全界面 + §9-D5 的 11 套主题 × 2 外观）和守恒律部分保留所需的新护栏（§9-D3c）。整体属**中等规模、低技术风险、高验收成本**的重构。

> [!WARNING] 潜在风险：D1-b 与 §4 验收口径内部冲突。若按建议保留 `--n-gray-400` 一族，则 `text` 层（502 处）的"该片 `--n-*` 消费点归零"永远无法达成——§4 的交付口径需改为"除白名单配对外归零"，且该白名单必须写进 grep 命令本身，否则每片的完成判定含糊。实测 `text-n-gray-400` 全形态约 146 处（仅 `text-n-gray-400 ` 后接空格的就有 ~71 处），不止 §2.2 表里那一档 24 处配对，白名单范围要实测圈定。

> [!WARNING] 潜在风险：`bg` 层的"仅 dark 无 light"实心按钮（最大档 `bg gray-800` 20 处，§1.2）只说了"不折"，但没给归宿——是保留 `--n-*`、还是折到某个语义令牌（`--primary`？`--secondary`？），直接影响 `bg` 层能否清零和 19 令牌目标集是否要扩。建议在 §4 或 §9 补一条待拍板项。

> [!IMPORTANT] 关键信息：`zinc`/`slate`/`neutral` 三族（108 处）在 §2.2 的映射表里完全缺席，全文默认隐含"按 gray 同表折叠"。三族与 gray 的同名步进明度并不保证一致，且 fold 掉三族意味着这三族也失去最后一个消费场景。需补充：三族是复用 gray 映射表，还是各自出表、还是同样保留 `--n-*`。

> [!NOTE] 补充说明：§2.4 的收益项（仅 light 无 dark 的 18 种配对）在深色外观下的新值是外观感知的，无法像 §2.2 那样预计算 Δ 值——这一族（含最大的 `text gray-900` 52 处）应作为人工验收的重点切片，建议在 §7 明确点名。

> [!TIP] 建议：分片顺序建议在 text → border → bg 之间先插一片"仅 light 无 dark"族（§1.2 的 18 种），它没有配对折叠的 Δ 权衡、纯收益、且量最大（text gray-900 一档就 52 处）——用它作为第一片可以在最小风险下先验证 codemod 流程和验收流程。

---

## 10. 复算与回写记录（2026-10-08）

对上面 6 条批注逐条复算（**数字** ＋ **前提**）。结论：**6 条方向全部成立、无捏造数字**。处置如下：

| 批注 | 复算结果 | 处置 |
|---|---|---|
| ① 难度（1075 处 / 74 文件） | 数字 ✓ | §1.1 口径注明 |
| ② D1-b 与 §4 口径冲突 | ✓ **真内部矛盾** | **已回写 §4**（补白名单口径 + 146/71 实测） |
| ③ "仅 dark `bg gray-800` 是实心按钮" | 20 ✓，但**定性错**（实为 `bg-card` / `bg-popover`） | **已改 §1.2 标签 + 新增 §1.4a**。注：该定性源自本方案 §1.2 原文，批注是**继承而非新错** |
| ④ 三族缺席映射表（108 处） | 数字 ✓；四族同名步进明度确实不等 ✓ | **已补 §2.2 说明**（复用 gray 表即可，非"三选一"级决策） |
| ⑤ §2.4 收益无法预计算 | ✓ | 保留（§7-2 已含人工过） |
| ⑥ 先做"仅 light"族 | 18 种 / 52 处 ✓ | 保留 |

被批注引用的护栏行号全部属实：守恒律反空转 `themeAtomConservation.test.ts:98-102` ✓、`SURFACES.substrate` `theme-overlays.spec.ts:70-82` ✓、`MUST_MOVE.full` `:196-206` **确实不含 `compat`** ✓。

**批注 6 条未抓到、本次自查补出的：**

1. **§1.2 "实心按钮"标签本身错**（批注③ 反而把它放大了）—— 真·实心按钮全仓仅 3 处且都带 light 基态，不在"仅 dark"桶。
2. **§2.2 "覆盖约 60%"** 实为 **≈54%**（288 配对 → 两侧 576 / 1075）。
3. **口径撞车未点名**（已补 §1.4b）：`compat` 在 `theme-overlays.spec.ts:126-127` 记为 gray 1287 / zinc 66 / slate 51 / neutral 40（全形态），与本方案 §1.1 的 967 / 55 / 28 / 25（属性前缀）不同 —— 不矛盾，但并排出现会被误读。
4. **§5 名单 / 计数对不上**：§5.1 标题"7 内置"而正文只列 4（已补 `cc-light` / `cc-dark` / `cc-ocean`，合计正好 7）；§5.2 标题"7 套用户"实为 **8**（6 套 palette-gray ＋ `solarized` ＋ `console`）；连带 §3`路线 C` / §8 / §9-D5 的"24 套 / 11 套"统一改为 **27 套（11 内置 ＋ 16 用户）/ 12 套**。
5. **状态行"4 项待拍板"** 实为 **5**（D1–D5）。

**仍未收敛（若二审，靶子如下）：**

- §2.2 映射目标的**语义正确性**（如 `text gray-700 → secondary-foreground` 是否该用 `foreground`）；
- §5 那 12 套"删 gray 层后是否仍满足 `MUST_MOVE.full` 契约"（只验过分类、未验过改完合法）；
- §7"无自动视觉护栏"是**协议上限还是实现选择**。

以上均需**读代码推演**，一审（只读文档）未覆盖；**已于同日按 D4=B 完成，见 §10-2**。

---

### 10-2. 第二轮：换靶二审（2026-10-08，D4=B 定案后）

**打法**：靶子＝ §10 末列的三处空白（映射语义 / 主题契约 / 视觉护栏），派两个并行调研，**派单写明"读代码推演、不审措辞"**。**结果：靶子 1 有 1 条真语义错 + 1 条结构性缺陷；靶子 2 两条定性要改。** 逐条均经复算（下表"复算"列即自算结论）。

**靶子 1 · §2.2 映射目标的语义正确性**

| 项 | 二审说 | 复算 | 处置 |
|---|---|---|---|
| `text gray-700 → secondary-foreground` | 语义误用，应 → `foreground` | 前提 **✓**（`secondary-foreground` 正当消费者仅 `Button.tsx:17`/`Badge.tsx:12`）；**但其建议修法实测更糟**（浅 ΔRGB 42 → **73**） | 记入 §2.2 ⚠️① + §2.3b，**升为待拍板 D7** |
| `bg gray-200 → secondary` 与 `bg gray-100 → muted` 折后同色 | 结构性塌陷 | **✓**（`--muted`=`--secondary`=`--accent` 浅深同值，`index.css:218/220/222`、`:502/504/506`） | 记入 §2.2 ⚠️② + **待拍板 D6** |
| `text gray-600` / `gray-500 → muted-foreground` 塌成一级 | ✓ | **✓**（源档差 12 点，`--muted-foreground` 只有一个位置） | 记入 §2.2 ⚠️③ |
| `border gray-300 → --input` 借用语义 | ✓ | **✓**（该族用在按钮/卡片边框） | 记入 §2.2 ⚠️④（可接受） |
| 保留 `--n-gray-400` 后 nord 是否仍冷灰 | 是真问题 | **✓**（nord `palette-gray:0`） | 记入 §3 收益口径 |
| 有无漏掉的高频配对 | — | 本轮未另发现 | — |

**靶子 2 · 主题契约与护栏**

| 项 | 二审说 | 复算 | 处置 |
|---|---|---|---|
| 4 内置（full）删 gray 层会否破契约 | 不会 | **✓**（`compat` 不在 `MUST_MOVE.full`：`MUST_MOVE.full`=substrate+terminal+graph+editor `:204-206`；`MUST_NOT_MOVE.full` 只含 `fixed` `:219`） | 回写 §5.2 |
| 8 用户主题是否受契约约束 | 不受 | **✓**（无 spec 读 `~/.cloudcli/themes/`） | 回写 §5.2 |
| `token-contract.spec.ts:122` 孤儿风险 | 若 `--n-*` 全退则 `--palette-gray-*` 变孤儿 | **✓**（断言"每个 `--palette-*` 至少被一处声明消费"）；**并暴露 D2 与 D1-b 自相矛盾** | 回写 §6 + §9-D2 精修 |
| §7"无自动视觉护栏"是上限还是选择 | 是实现选择 | **✓**（Playwright 1.63.0 带 `toHaveScreenshot`＋pixelmatch；`sharp ^0.34.2` 直接依赖；现 0 截图用例） | 回写 §7、§8 |
| §5"12 套必须改写"的定性 | 偏低 | 4 内置是"删一层"、8 用户是"自觉维护" | 回写 §5.2、§8 |

**二审未覆盖 / 仍待确认**：

- ~~**D6 / D7**（需用户拍板，见 §9）~~ → **已定案：D6=a / D7=b（见 §9、§10-3）**；
- 若 D7 或 D1-a 走"新增令牌"，目标集合 19 → 20，**须同步主题契约**（`MUST_MOVE` + 白名单）—— 本方案不涉及（D1-a / D7-c 均未采纳）；
- §2.2 表只覆盖高频 10 条（≈54%），**全量 87 条配对的逐条目标令牌**尚未成表 —— 实施前若要闭环，需补齐。

---

### 10-3. D6 拍板实测（2026-10-08）

**问题**：§2.2 ⚠️② 的“多档塌一档”（`bg gray-100/50 → muted` 与 `bg gray-200 → secondary` 折后同色）影响面到底有多大？拍板前须先实测，不能靠“两级浮底”的直觉定性。

**实测**（`grep` 工作区 `src/`）：`bg-n-gray-200` 全形态 **18 处**，其中 **10 处**构成“基态 `bg-n-gray-100` ＋ `hover:bg-n-gray-200`”的**状态对**，且 hover **只改 bg、无第二反馈源**：

| 文件:行 | 形态 |
|---|---|
| `TaskQuickSortBar.tsx:33/45/57` | `bg-n-gray-100 … hover:bg-n-gray-200` |
| `TaskEmptyState.tsx:96` | 同上 |
| `TaskDetailModal.tsx:163` | 同上 |
| `McpServerFormModal.tsx:244/255/294` | 同上 |
| `VersionUpgradeModal.tsx:250/258` | 同上 |

折叠后基态 `→ --muted`、hover `→ --secondary`，而 `--muted`＝`--secondary`（`index.css:218/220/222`）⇒ **这 10 处次级按钮 hover 无视觉反馈**。其余 8 处为进度条轨道 / 分隔条 / 单选 chip，是单档、不构成状态对，不受影响。

**原定性修正**：二审只判“两级浮底变一级”（低频、近似无感），实测真正命中的是**状态对**（交互反馈消失）——比原定性更重，故推荐从“a 无痛”改为“a 是取舍”。

**定案 D6=a**：接受这 10 处 hover 反馈归零，换取 `bg` 层彻底清零。排除 b（改出厂外观 ＋ 全主题重验，代价远超收益）与 c（为 10 处保留不跟主题的冷灰 hover，与本轮“消灭病根”自相矛盾）。人工验收时须**点名**这 10 处确认为可接受。

---

### 10-4. D8 / D9 实施，以及"一个令牌覆盖"的纠正（2026-10-08，片 9）

**D8（卡片加深族，片 6 实施）**：`bg-card … dark:bg-n-gray-800`（29 行）→ `dark:bg-secondary`；浅侧 `bg-card` 同行的 `dark:bg-n-gray-900`（5 行）→ 删（归 `bg-card`）。

**D9 实施时纠正了上轮的"一次覆盖①②③、零变化"**：该表述**不准确**。实测 `dark:bg-n-gray-700` 全族 **31 行**，**浅侧有 6 种**（`bg-card` / `gray-50` / `gray-100` / `gray-200` / `gray-600` / `gray-800`），一个令牌不可能同做六种浅侧的目标。逐族裁定：

| 族 | 浅侧 | 行 | 浅侧目标 | 深侧目标 |
|---|---|---:|---|---|
| ① | `bg-card` | 3（＋4 状态对另片） | `bg-card`（不变） | `dark:bg-sunken` |
| ② | `bg-n-gray-100` | 1（＋3 状态对另片） | `bg-muted` | `dark:bg-sunken` |
| ③ | `bg-n-gray-200` | 13（＋1 状态对另片） | `bg-sunken`（并入） | — |
| ④ | `bg-n-gray-50` | 3 | `bg-muted` | `dark:bg-sunken` |
| ⑤ 实心按钮 | `bg-n-gray-800` | 2 | 不折（另族） | — |
| ⑥ 头像 | `bg-n-gray-600` | 1 | 不折（另族） | — |

本片实施 **20 行**（①②③④ 的 rest 态）；**含 `hover:bg-n-gray-*` 的 8 处状态对 ＋ 实心按钮 2 处 ＋ 头像 1 处留下另片**（状态对的 rest 与 hover 必须同折，否则 hover 相对 rest 的落差会被放大，故不拆）。

**`--sunken` 取值依据**：`--muted`/`--secondary`/`--accent` **恒同值**（浅 sand-100 / 深 ink-850），L2 无第二档 subdued 面。`--sunken` 取 **浅 sand-200 / 深 ink-800**（浅侧与 `--border`/`--input` 同档、深侧与 `--input` 同档）。

**Δ（脚本实测，非手抄）**：

| 折叠 | 浅 ΔL / ΔRGB | 深 ΔL / ΔRGB |
|---|---|---|
| 族③ `gray-200 → sunken` | −4 / 18 | −3.7 / 22 |
| 旧案 `→ muted`（=D6 的塌一档） | 0 / 6 | **−9.7 / 38** |

即 `--sunken` 用一点浅侧变化换掉深侧的大变化，并**免掉 ②③ 折后同色**（回归两档）。

**契约成本（唯一代价）**：目标集 **19 → 20**；`theme-overlays.spec.ts` 的 `SURFACES.substrate` 加 `--sunken`。**无需改任何 overlay**——8 套 full 主题**全部**重铺 `--palette-sand-200`/`--palette-ink-800`，故 `--sunken` 对它们**自动"移动"**（`mustMove` 满足），accent 主题（`cc-ocean`）不碰它。`token-baseline.json` **文本级**加浅/深两条（`44 14% 87%` / `0 0% 23%`），未吞并发行（`--chat-composer-safe-bottom` 仍红）。

**门禁**：`theme-overlays` 38 全过（证明契约真生效）；守恒律 **652 → 615（−37，7 桶全减）**；`test:theme-tokens` 202/2（2 红＝并发行 `--chat-composer-safe-bottom`，非本片）；lint/typecheck 全过。

---

### 10-5. D10 实施：次级/描边按钮状态对归一为"两档面 hover"（2026-10-08，片 10）

**范围**：**10 行 / 9 文件**，全是**次级/描边按钮的 rest ＋ hover 状态对**，深侧统一 `dark:bg-n-gray-700` → `dark:hover:bg-n-gray-600`。分三形态：

| 形态 | 浅 rest | 行 | 折后 |
|---|---|---:|---|
| A 描边按钮（＋`border-input`） | `bg-card` | 5（`TaskBoardToolbar:155`、`CreateTaskModal:66`、`TaskMasterSetupModal:94`、`OverwriteConfirmModal:44`、`GenerateTasksModal:72`） | `bg-card dark:bg-secondary … hover:bg-muted dark:hover:bg-sunken` |
| B 次级 chip | `bg-n-gray-100`(95.9%) | 3（`TaskEmptyState:96`、`VersionUpgradeModal:250/258`） | `bg-muted … hover:bg-sunken`（删 dark） |
| C 次级按钮 | `bg-n-gray-200`(91%) | 1（`Shell:415`） | `bg-muted … hover:bg-sunken`（删 dark） |
| A 变体（深侧本已 `dark:bg-secondary`） | `bg-card` | 1（`QuickSettingsHandle:66`） | `… hover:bg-muted dark:hover:bg-sunken` |

**根因（关键数据）**：这 10 行的深侧 rest=`gray-700`(**26.7%**)、hover=`gray-600`(**34.1%**)——**两者都亮于 L2 里最亮的深色面 `--sunken`(23%)**，即 L2 深色缺"抬起面"档；叠加 `--muted`/`--secondary`/`--accent` 恒同值 ⇒ hover 无处可去（D9 缺层在此处具体化）。

**折叠语言＝"两档面 hover"**：`--sunken` 恰是 `--muted` 的**深一档浅色（87% vs 91%）/ 亮一档深色（ink-800 23% vs ink-850 17%）** ⇒ `hover:bg-sunken` 相对 `bg-muted` 天然是"浅加深 / 深变亮"，方向与原 `gray-200` / `gray-600` 一致。**已逐套核 8 个主题的 `sand-100`/`sand-200` 与 `ink-850`/`ink-800` 覆盖：全部方向一致**（浅 ΔL −4~7、深 +4~10）。

**Δ（出厂）**：

| 形态 | 浅 rest / hover | 深 rest / hover |
|---|---|---|
| A | 0 / −7 | −9.7 / −11 |
| B | −4.9 / −4 | −9.7 / −11 |
| C | 0 / +3 | −9.7 / −11 |

**代价**：**深色整体降一档**（可见）。换来跟全部主题 ＋ 消除病根（nord 下按钮 hover 不再出冷灰）。`TaskBoardToolbar:155` 深侧本就是 `dark:bg-secondary`，属向同形态既有写法收敛。

**守恒律**：**615 → 583（−32）**，**9 桶全减零增长**（`bg: gray-100` −3、`bg: gray-200` −1、`hover bg: gray-50` −5、`hover bg: gray-100` −1、`hover bg: gray-200` −3、`hover bg: gray-300` −1、`dark bg: gray-700` −8、`dark:hover bg: gray-600` −8、`dark:hover bg: gray-700` −2 ⇒ −32＝10 行）。**残留 3 处为明确排除项**（`AgentConnectionsStep:31`/`AccountContent:46` B 类实心按钮、`MessageComponent:252` 头像）。

**门禁**：lint 163/0；双 typecheck ✓；`test:client` 182 文件 1492 全绿；`test:theme-tokens` 202/2（2 红＝并发行 `--chat-composer-safe-bottom`）。

---

### 10-6. D11 实施：inset/卡片块折 `--card`（2026-10-08，片 11）＋ B 类实心按钮判定

**B 类"实心按钮"判定（结论＝保留，不折）**：
- **品牌色实心按钮**：`AgentConnectionsStep.tsx:31` 与 `AccountContent.tsx:46` 里**每个 provider 一套品牌色**（blue-600/purple-600/cyan-700/orange-600/emerald-600/indigo-600 ＋ gray-800/zinc-900/neutral-700）。这是**刻意的品牌标识体系**，折 `--n-gray-*` 会让"同排按钮只有 codex 跟主题、其他不跟" ⇒ 保留。
- **中灰装饰件**：头像底 `bg-n-gray-600`（`MessageComponent:252`）、状态点 `bg-n-gray-400 dark:bg-n-gray-500`（`:214`）、小灰点 `bg-n-gray-300 dark:bg-n-gray-600`（`TaskBoardContent:55`、`QuestionAnswerContent:79`）、图标底 `bg-n-gray-400/500`（`SidebarProjectItem:269/410`）—— L2 **无中灰面档**（与 D1-b 的 `text gray-400` 白名单同性质）⇒ 保留。

**D11 实施（12 行）**：`bg` 层"inset/卡片块"——浅 `gray-50/100`(98%~96%) ≈ `--card`(100%)、深 `gray-900`(11%) ≈ `--card` 深(12%) ⇒ Δ 最小、方向一致、跟全部主题。族 4（全屏遮罩）深侧是 `gray-950`(8%)＝`--background` 深 ⇒ 单独归 `--background`。

| 族 | 行 | 折后 | Δ浅 / Δ深 |
|---|---|---|---|
| 1 内容块 | `TaskIndicator:79`、`ImageViewer:71` | `bg-card` | 2 / 1 |
| 2 卡片块 | `GithubAuthenticationCard:43`、`StepReview:41`、`FolderBrowserModal:243`、`McpServerFormModal:264`、`taskKanban.ts:45` | `bg-card dark:bg-card/50` | 2 / 1 |
| 3 浮动条 | `TerminalShortcutsPanel:118` | `bg-card/95` | 4 / 1 |
| 4 全屏遮罩 | `ShellConnectionOverlay:25/36/54` | `bg-background/90` | 2 / 0 |
| 5 输入框 | `AskUserQuestionPanel:333` | `bg-card dark:bg-card/60` | 2 / 1 |

ring 部分（`ring-n-gray-200 dark:ring-n-gray-700`）属 ring 族，本片不动。

**⚠️ 教训：枚举清单必须含 `.ts`**：`taskKanban.ts:45`（**`.ts` 文件**）在片 5 清单里，却被 `--include=*.tsx` 连续漏过片 5/6/7/9/10；靠**守恒律红桶的残留明细**（`dark bg: gray-900/50` 剩 1 且指名该文件）才捞出。**判据：重冻前读红桶的"残留行文件路径"——它是"清单是否完整"的兜底探针。**

**守恒律**：**583 → 559（−24）**，**8 桶全减零增长**（`bg: gray-100/95` −1、`bg: gray-50` −8、`bg: gray-50/90` −3、`dark bg: gray-900` −2、`dark bg: gray-900/50` −5、`dark bg: gray-900/60` −1、`dark bg: gray-900/95` −1、`dark bg: gray-950/90` −3）。残留 2 桶为排除项：`bg: gray-50` 剩 1（`CommandMenu:77` override）、`dark bg: gray-900` 剩 1（`CodeEditorSurface:62` 白面）。

**门禁**：lint 163/0；双 typecheck ✓；`test:client` 182 文件 1492 全绿；`test:theme-tokens` 202/2（既有并发红）。

### 10-7. D12 实施：白面族折 `--card`（2026-10-08，片 12）—— 守卫表收口

**背景**：`semanticSurfaceTokens.test.ts` 冻结了 `bg-n-white` 的分布表，并在表内把两处真·face 显式标为 **"Faces, deferred to their own slice … completing that slice means editing this table, which is the point"**。本片正是完成该片并**删表项**。

**两处白面族（`bg-n-white` 做底面）**：

| 行 | 原 | 折后 | Δ浅 / Δ深 |
|---|---|---|---|
| `CodeEditorSurface:62`（markdown preview 容器） | `bg-n-white dark:bg-n-gray-900` | `bg-card` | 0 / 1 |
| `MermaidDiagram:78`（```mermaid 图块） | `bg-n-white dark:bg-n-zinc-900` | `bg-card` | 0 / 2 |

**判据**：浅 `--n-white`＝`--palette-white`(100%)＝`--card` 浅（出厂 sand-25 100%），主题下 card 跟 sand-25；深 `--n-gray-900`(11%)≈`--card` 深（ink-900 12%）、`--n-zinc-900`(10%) 同族 ⇒ 折 card **Δ 最小、方向一致、跟全部主题**。

**未选 `bg-editor`（`--editor-bg`）的理由**：CodeEditorSurface 的 preview 与 CodeMirror 编辑面同面板交替，编辑面确用 `--editor-bg`，但 ①`--editor-bg` 是「**完整色值**」令牌（`EditorView.theme()` 直写规则，用户主题编译器契约要求整色值），新增 tailwind 键会引入**非 `hsl()` 三元组**新键型；②保真更差——`--editor-bg` 出厂深 `#282c34`(≈18%) 比原 `gray-900`(11%) Δ7、`--muted`/`--code-block` 深同为 18%；`--card` 深 12% Δ 仅 1。故统一折 `--card`（守卫提示语亦推荐 `bg-card`）。

**符号保留（不动）**：`bg-n-white` 的其余消费者均为 frozen-white **symbol**（开关把手 `SettingsToggle`/`DarkModeToggle`/`PluginSettingsTab` `after:` 把手、`BrowserUsePanel` crosshair、`PromptInput` kbd、`ChatMessageImages` 图上按钮、`CodeEditorMediaPreview` iframe 页面本体）——白在此处**即语义**，主题不得染色，守卫表 symbols 段保留。

**守恒律**：**559 → 555（−4）**，3 桶全减零增长（`bg: white` −2、`dark bg: gray-900` −1、`dark bg: zinc-900` −1）。

**门禁**：lint 163/0；双 typecheck ✓；守卫 `semanticSurfaceTokens` ✓；`test:client` 182 文件 1492 全绿；`test:theme-tokens` 202/2（既有并发红）。

### 10-8. D13 实施：ring 族折语义令牌（2026-10-08，片 13）

`ring` / `ring-offset` 族（`border` 的姊妹，片 3 只收 border 未收 ring）。全量普查后 **7 处**（含全部兄弟族 `zinc/slate/neutral/white/black` ⇒ 本片后**零残留**）：

| 形态 | 行 | 原 | 折后 | 依据 |
|---|---|---|---|---|
| A 输入框描边 | `AskUserQuestionPanel:333` | `ring-1 ring-n-gray-200 … dark:ring-n-gray-700` | `ring-1 ring-border`（删 dark） | 对照片 3 的 `border-n-gray-200 → border-border`；`--border` 自动感知暗色 |
| B 焦点环偏移（ShellHeader 4 处） | `:82/:103/:119/:131` | `focus:ring-offset-n-gray-100 … dark:focus:ring-offset-n-gray-800` | `focus:ring-offset-muted`（删 dark） | 按钮坐落在容器 `bg-muted`（`:60`）上 ⇒ 缝隙色＝容器色；`gray-800`(16.9%) 与 `--muted` 深（ink-850 17%）**Δ0.1 精确** |
| C 焦点环偏移（遮罩） | `ShellConnectionOverlay:41` | `focus:ring-offset-n-gray-50 … dark:focus:ring-offset-n-gray-950` | `focus:ring-offset-background`（删 dark） | 遮罩背景是 `bg-background/90`（片 11 改）⇒ 缝隙色＝`--background`；`gray-50`/`gray-950` ≈ background 浅/深 |

**判据：`ring-offset-*` 的语义＝"元素紧邻背景色"，故按**所在容器**选令牌（A 是描边线 ⇒ 同 border；B/C 是缝隙 ⇒ 同容器面）。**

**代价（诚实记账）**：B 浅侧从 `gray-100`(95.9%) → `muted`(91%)，Δ≈5 —— **这是修正**（原值比容器 `bg-muted` 亮 5%，环缝与容器本有微差），折后与容器完全一致。A/C 浅侧 Δ≈4/2、深侧 Δ≈0/4。

**新类非新造**：`ring-border`／`ring-offset-muted`／`ring-offset-background` 均**对齐既有设计系统写法**（`ring-offset-background` 见 `DarkModeToggle`/`ThemeModeSelector`/`ThemeSelector`/`UserThemesSection`/`SettingsToggle`；`ring-offset-muted` 见 `PillBar`；`ring-border` 见 `PillBar`/`ModelLibraryPanel`）——零污染探针实测 Tailwind 真生成（`tailwind.config` 未显式配 `ringOffsetColor`，v3 默认继承 `colors`）。

**守恒律**：**555 → 543（−12）**，**6 桶全减零增长**（`ring: gray-200` −1、`dark ring: gray-700` −1、`focus ring-offset: gray-50` −1、`dark:focus ring-offset: gray-950` −1、`focus ring-offset: gray-100` −4、`dark:focus ring-offset: gray-800` −4）。

**门禁**：lint 163/0；双 typecheck ✓；`test:client` 182 文件 1492 全绿；`test:theme-tokens` 202/2（既有并发红）。

### 10-9. D14 实施：ghost 兼容族（zinc/slate/neutral）收口（2026-10-08，片 14）

片 1–13 只处理了 `gray` 兼容族；`zinc` / `slate` / `neutral` 三个**并列的 ghost 兼容族**（同样喂 `--palette-*`、同样只有 4 套主题重铺）从未系统收。三者明度与 gray **几乎一致**（Δ<2%，如 100 档 95.9/96.1/96.1%，700 档 26.1/26.7/25.1%）⇒ **gray 族映射可直接套用**。

**判据（本片新立）＝"状态/分类调色板的中性档应折中性令牌，彩色档保留"**：这些 ghost 消费点绝大多数是"一色调色板的最后中性档"（与 blue/emerald/red/amber 等**语义状态色**并列）——彩色档承载信号（红=阻塞、绿=完成）本不该跟主题，而中性档承载"无信号"，用中性令牌正确。

**折（5 文件 / 约 19 行）**：

| 组件 | 折法 | 依据 |
|---|---|---|
| `taskKanban` pending 列 | `color: bg-card dark:bg-card/50 border-border` / `headerColor: bg-muted text-foreground` | **完全对齐**同文件的 cancelled 列；顺带把 cancelled 残留的 `text-n-gray-800/200` 一并收口 |
| `NextTaskBanner` | `bg-card dark:bg-card/30 border-border`／`text-foreground`／`text-muted-foreground`／`border-input` | 独一份中性横幅（无品牌顾虑）；保深侧 alpha `/30` |
| `TaskCard` pending 态 | `text-foreground`／`text-muted-foreground` | 中性态（cancelled=red、pending=slate） |
| `ToolStatusBadge` stopped | `bg-secondary text-secondary-foreground` | 设计系统**中性徽章标准配方**（`Badge.tsx:12`/`Button.tsx:17`） |
| `ProviderSkills` system | `border-border/30 bg-muted/10 text-muted-foreground` | 与 5 个彩色 scope 徽章同款"淡色带边"结构，保 alpha |

**保留（B 类品牌色 / 常暗，判据同 §10-6）**：
- `AccountContent:51-55/83-87`、`AgentConnectionsStep:36-66`——**每 provider 一套品牌色卡**（zinc=codex、neutral 等），整排 provider 卡不应只让一种跟主题。
- `AgentSelectorSection:39`——每 agent 品牌色点（opencode=`bg-n-zinc-500`）。
- `BrowserUsePanel:314/333/334/335`——截图预览的**常暗容器**（`bg-n-neutral-950` + 浅字）。

**代价（诚实记账）**：`ProviderSkills` system 的文字由 `slate-700`(≈26%) → `muted-foreground`（sand-500 46%）**变浅**；其余四处按语义映射，Δ 与 gray 族同量级（≤5）。

**守恒律**：**543 → 505（−38）**，**22 桶全减零增长**（slate 族 20 桶 ＋ `text: gray-800` −1、`dark text: gray-200` −1）。**slate 族清零**；残留 ghost 全为上述保留项。

**门禁**：lint 163/0；双 typecheck ✓；零污染探针实测新类（`bg-muted/10`/`border-border/30`/`bg-card/30` 等）真生成；`test:client` 182 文件 1494 全绿；`test:theme-tokens` 202/2（既有并发红）。

### 10-10. D15 实施：常暗容器族按"有无跟随外观的规范兄弟"分流（2026-10-08，片 15）

**判据（本片新立）＝"看同类内容的规范实现跟不跟外观"**。常暗面不能整族一刀切——逐处找**同类内容的规范兄弟**，跟随外观者＝遗留可折，绿字终端/反色者＝签名保留：

| # | 位置 | 现值 | 规范兄弟（同类内容） | 判定 |
|---|---|---|---|---|
| 1 | `CodeEditorSurface:63` | `prose-pre:bg-n-gray-900` | `MarkdownCodeBlock:75` 用 `--code-block-bg`（**跟外观**） | **折** →`prose-pre:bg-code-block` |
| 2 | `TextContent:31`(json) | `bg-n-gray-900 … dark:bg-n-gray-950` | 同文件 `code` 分支用 `bg-muted`（**跟外观**） | **折** →`bg-code-block text-foreground` |
| 3 | `StandaloneShellHeader:17` | `bg-n-gray-800 border-n-gray-700` | `ShellHeader:60` 用 `bg-muted border-border`（**跟外观**） | **折** → 对齐 `ShellHeader`（文字翻 `text-foreground`/`text-muted-foreground`） |
| 4 | `OneLineDisplay:103` | `bg-n-gray-900 dark:bg-n-black` | 注释明写 *"Terminal style: dark pill"*＋`toolConfigs` 给 `text-green-400` | **保留** |
| 5 | `VersionUpgradeModal:213` | `bg-n-gray-900 dark:bg-n-gray-950` | 绿字终端输出（`text-green-400`） | **保留** |
| 6 | `Tooltip:186` | `bg-n-gray-900 dark:bg-n-gray-100` | 纯反色提示（浅暗/深亮） | **保留** |
| 7 | `SidebarProjectItem:191` | `bg-n-gray-500/10 dark:bg-n-gray-900/30` | 兄弟＝`bg-yellow-500/10`（星标黄 tint） | **转别族**（tint 对） |

**关键**：`--code-block-bg`（tailwind 键 `bg-code-block`）**正是"代码块面板底"的语义令牌且主题可控**——折到它＝同时满足"跟主题"与"可被主题定制"。而 #4/#5 的 `text-green-400` **依赖深底成立对比度**（绿-400 压白面不过 AA），#6 是刻意反色，故三者保留。

**代价（诚实记账，本片是有意的视觉变更）**：#1/#2/#3 浅色下由深底变浅底（与规范兄弟一致）；#3 顺带把绿字徽章由 `text-green-400` 修为 `text-green-600 dark:text-green-400`（浅底下绿-400 不过对比）。

**守恒律**：**505 → 496（−9）**，**9 桶全减零增长**（`prose-pre bg: gray-900` −1、`bg: gray-800` −1、`bg: gray-900` −1、`border: gray-700` −1、`dark bg: gray-950` −1、`text: gray-100` −1、`text: gray-200` −1、`text: gray-400` −1、`hover text: white` −1）；残留全为 #4–#7 保留项。

**门禁**：lint 163/0；双 typecheck ✓；零污染探针实测 `prose-pre:bg-code-block` 真生成（`.prose-pre\:bg-code-block :is(:where(pre)…)`）；`test:client` 182 文件 1494 全绿；`test:theme-tokens` 202/2（既有并发红）。

### 10-11. D16 实施：遮罩族折 `--overlay`（2026-10-08，片 16）

**现象**：全仓 `bg-n-black/*` 共 32 点，全是模态/抽屉的全屏 dim 层（`/50` ×21、`/60` ×9、`/80` ×1、`/90` ×1，其中 `md:` 响应式 6 处）。

**关键诊断（本片的核心事实）**：`--n-black` ＝ `var(--palette-black)` ＝ **`0 0% 0%`**，**无任何主题重铺** ⇒ 与 `--n-gray-*`（只 4 套主题跟）**根本不同**：黑遮罩**不存在"不跟主题"的缺陷**，它本来就跨全部主题恒等。故本片**不是修 bug，而是把"纯黑"这一角色从兼容层提升为语义令牌**。

**为何不能回退成 Tailwind 内置 `bg-black`**：守卫 `themeHardcodedAtoms` 把 `black`/`white` 明确列入 `NEUTRAL_FAMILIES`（"中性族必须移到令牌"），字面 `bg-black` 会被 `theme-hardcoded-baseline.json` 判为硬编码漂移。⇒ 归宿只能是**语义令牌**。

**唯一确定项**：新增 `--overlay`（浅深皆 `var(--palette-black)`），32 点折 `bg-overlay/NN`（alpha/变体原样）。**零视觉变化**（`hsl(var(--overlay)/0.5)` ≡ `hsl(var(--n-black)/0.5)`）、**零 overlay 改写**（`--palette-black` 不被任何主题重铺 ⇒ `--overlay` 不进 `SURFACES.substrate`，8 套 full 主题无须动）、给主题一个可选的遮罩 tint 钩子。

**保留（明确排除，本片未动）**：
- 不透明 `bg-n-black` 3 处：`TaskMasterSetupModal:59`（包 `<Shell>` 的终端面板底）、`BrowserUsePanel:520`（截图查看器面板底）——终端/常暗签名（同 §10-10 #4/#5）。
- `TaskBoardContent:45` 的 `dark:bg-n-black/20`：编号 chip 的**深色 tint**，语义非"遮罩"⇒ 不消费 `bg-overlay`（否则主题改遮罩会连带染 chip）。

**守恒律**：**496 → 464（−32）**，**5 桶全减零增长**（`bg: black/50` −15、`bg: black/60` −9、`bg: black/80` −1、`bg: black/90` −1、`md bg: black/50` −6）；`bg: black`(2) / `dark bg: black`(1) / `dark bg: black/20`(1) 三桶残留＝保留项。

**契约成本**：目标集 **20 → 21**；`src/index.css` 双块各 +1、`tailwind.config.js` +1 键、`token-baseline.json` 文本级 +2 条（浅/深皆 `0 0% 0%`，**未重生成**故未吞并发红 `--chat-composer-safe-bottom`）。

**门禁**：lint 163/0；双 typecheck ✓；零污染探针实测 `bg-overlay/50`/`md:bg-overlay/50` 真生成；隔离 diff 32 行精确命中；`test:client` 182 文件 1494 全绿；`test:theme-tokens` 202/2（既有并发红）。

### 10-12. D17 实施：残余 hover 态对齐设计系统惯例（2026-10-08，片 17）

**背景**：片 16 后重扫，灰/中性折叠已近尾声。逐桶归类剩余 464 点，发现**唯一仍有干净语义归宿的一族＝ `hover:text-n-gray-*` 8 行**（`hover text: gray-600` 5 ＋ `hover text: gray-700` 3 ＋ `dark:hover text: gray-300` 8）。

**关键判据（本片新立）—— "基态已语义化 / 已归白名单" 决定 hover 的处置**：

| 组 | 基态 | 原 hover | 处置 |
|---|---|---|---|
| A（5 处） | `text-n-gray-400`（D1-b 白名单）＋`dark:text-n-gray-500` | `hover:text-n-gray-600 dark:hover:text-n-gray-300` | 折 `hover:text-foreground`（保 `dark:text-n-gray-500`） |
| B（3 处） | `text-muted-foreground`（**语义**） | `hover:text-n-gray-700 dark:hover:text-n-gray-300` | 折 `hover:text-foreground` |

**依据＝全仓既有惯例**：`text-n-gray-400 hover:bg-muted hover:text-foreground`（`CodeEditorHeader:114`、`ProjectCreationWizard:148`、`FolderBrowserModal`×3、`TaskHelpModal:68`、`CreateTaskModal:26`、`GenerateTasksModal:36`、`VersionUpgradeModal:160` 等 10+ 处）与 `text-muted-foreground hover:text-foreground`（`ThemeModeSelector:45`、`SidebarModeTabs:69`、`SidebarHeader`×3 等）是两类基态的**既定配方**；本片 8 处是**最后一撮未对齐的离群点**（基态已是白名单/语义，唯独 hover 仍写 raw）。

**决定性证据**：`MessageCopyControl:200-202` 同一组件**显式二分支** —— user 用 `text-muted-foreground hover:text-foreground`（惯例），assistant 用 `text-n-gray-400 hover:text-n-gray-600 …`（离群）。B 组 `TaskBoardToolbar` 三按钮的选中态本就是 `text-foreground`，故 hover 归 `foreground` = "悬停预览选中态"，语义自洽。

**范围** 8 行 / 6 文件（`ProviderLoginModal:135`、`AskUserQuestionPanel:349`、`MessageComponent:525`、`MessageCopyControl:202`、`MessageSpeakControl:35`、`TaskBoardToolbar:115/128/141`）。`hover:text-foreground` 已是 80 文件的通用类，**无需探针**。

**守恒律**：**464 → 448（−16）**，**3 桶全减零增长**（`hover text: gray-600` −5、`hover text: gray-700` −3、`dark:hover text: gray-300` −8）；残留 `hover text: white`(3)＝品牌 hover＝保留。

**门禁**：lint 163/0；双 typecheck ✓；残留 `hover:text-n-gray-*` grep 清零；`test:client` 182 文件 1494 全绿；`test:theme-tokens` 202/2（既有并发红）。

**⚠️ 阶段性结论（重要）**：本片后，**中性色折叠已达自然终点**。剩余 448 点的构成＝①**白名单（L2 缺层）**：`text gray-400`(55)＋`dark gray-500`(28)〔D1-b〕、`text gray-700`(57)＋`dark gray-300`(51)〔D7-b〕，及同族小档 `gray-800/200`、`gray-300/600`、`dark gray-100` ≈ **~215 点**；②**B 类（品牌/装饰/签名）**：`text white`(71)＋彩色实心按钮/状态点/头像、`bg-n-black` 不透明 3 处、Tooltip 反色、终端 pill；③**ghost 品牌卡**（zinc/neutral）。三者**均无干净语义归宿**（要么 L2 缺该层，要么彩色兄弟硬编码、只折中性档反而与兄弟不一致）。⇒ **若无新的设计决策（如 re-open D1/D7 新增文本层令牌），折叠阶段到此为止。**

## 11. 收口：显式白名单档与机器守卫（2026-10-08）

**本节是路线 B 的"结账"**。§4 订下的口径 —— "该片 `--n-*` 消费点**除白名单外**归零，且**白名单必须写进 grep 命令本身**" —— 在片 1–17 期间只以**文字**存在：守恒律冻住了每个桶的**数量**，却无法回答"留下来的这条究竟是**已拍板的保留**还是**漏项**"。本节把这个口径从文字落成**可执行的差集断言**。

### 11.1 白名单档（89 签名 / 448 命中）

残留点按 **签名**（`utility: family-step[/opacity]`，见 11.2）归入四类，每类带**保留理由**与**归属决策**：

| 类别 | 签名数 | 命中数 | 保留理由 | 归属决策 |
|---|---|---|---|---|
| `l2-text-gap` | 10 | 214 | **L2 没有"最弱辅助文字""正文次级文字"这一层**；强折到最近令牌是**大幅且方向错误**的移动（`text gray-400`→`--muted-foreground` 浅 ΔL 22；`text gray-700`→`--foreground` 浅 ΔRGB 73） | **D1-b / D7-b**（两次拍板，含二审复核） |
| `brand-decoration` | 42 | 154 | **B 类品牌色体系与刻意签名**：`text-n-white`（彩色面上的白字）、彩色实心按钮、状态点/头像/图标底（L2 无中灰面档）、分类 chip 的中性档（邻居是彩色档）、`bg-n-black` 不透明底（D16 keep-set）、Tooltip 反色、终端 pill、星标 tint 对、阴影 | **D11 / D16 等既有判定；B 类保留**（§10-6） |
| `ghost-brand` | 36 | 79 | **ghost 兼容族 `zinc`/`neutral`**：与 `gray` 并列（ΔL<2%、同样只 4 套主题跟），消费者几乎全是**各 provider 品牌卡**（codex/opencode=zinc、…）与 BrowserUse 暗色截图面；其"中性档"承载的是**品牌身份**而非"无信号" | **D14 判据的反面**：`zinc`/`neutral` 非状态/分类调色板，整族保留 |
| `exempted` | 1 | 1 | 已由 `NEUTRAL_EXEMPTIONS` 逐点点名（`border: gray-150`），非**族级**决策；此处仅为**总账完整**而登记 | `NEUTRAL_EXEMPTIONS`（点级豁免） |

> 10+42+36+1 = **89 签名**；214+154+79+1 = **448 命中**＝守恒律 `total`，两侧同源（同一个 `usageKey` 输入集）。

### 11.2 为什么"签名"而非"消费点"

- **决策是按族做的**（"保留 `text gray-400`"、"保留 ghost 品牌卡"），故白名单**同键**；按 `file:token` 会得到 448 条随无关编辑 churn 的条目，还只是把普查重抄一遍。
- 签名**丢弃 variant**（`dark:`/`hover:` 等）。这是刻意的：variant 的移动**守恒律已经在管**，白名单再管一次只会让它更脆。二者分工＝**守恒律管"普查没动"，白名单管"哪些是被批准的"**——一个桶可以在**错的签名集**下守恒，一个签名可以在**错的计数**下被批准，**互不蕴含**。

### 11.3 机器守卫

- **数据**：`src/shared/tests/neutralConsumerWhitelist.ts` —— `NEUTRAL_RESIDUAL_WHITELIST`（89 条）＋ `RESIDUAL_CATEGORIES`（每类一条理由）。签名以 `usageKey` 的 **key 形态**书写（`text: gray-400`，非类名），因 Tailwind 把 `src/` 当 content 扫描（**注释也扫**），类名字面量会真进 `dist`；key 形态不是活类、零产物。
- **断言**：`src/shared/tests/neutralConsumerWhitelist.test.ts`，三条：
  1. **每个残留消费者的签名都在白名单内**（差集为空）——即 §4 的"除白名单外归零"；
  2. **白名单无死条目**（每条签名都仍有消费者）；
  3. **每条条目所归类别都带非空理由**。
- **反向验证（已做）**：删一条活条目 → 测试 1 红并列出真实命中；删一条死条目风格 → 测试 2 红。双向都拦得住。
- **新增语义**：往白名单加一条＝**声明"又有族被刻意留在 compat 层"**，是一个**设计决策**，不是静默放行——这正是 §4 想要暴露的东西。

### 11.4 守恒律的最终形态（D3=c）

守恒律 `themeAtomConservation.test.ts` **保留**（D3=c "部分保留"），但角色在此后**退化为纯"防漂移"守卫**：它冻结 448 的**分桶计数**，任何残留消费点的新增/移除/变体移动都会红。它与 §11.3 的白名单**并存不重复**（见 11.2 的分工）。本次仅更新其头部 docstring 记录最终定位，**未改任何断言**。

> 折叠期（片 1–17）守恒律兼当"进度表"（每片重冻、红桶须为目标桶且只减不增）；收口后它只承担**防漂移**，不再有"继续减到 0"的含义。

### 11.5 完成定义（DoD）

本线**收口**＝下面三条同时成立：

1. 除白名单外，中性色（`--n-{gray,zinc,slate,neutral,black}-*`）消费点**归零**——由 11.3 测试 1 断言；`slate` 族已整族清零（§10-9）。
2. 白名单**每一条都被一次拍板覆盖**（11.1 归属决策列），且无死条目——由 11.3 测试 2、3 断言。
3. 守恒律冻结在 **448**，`test:client` 全绿。

**何时会 re-open**：若要"compat 层彻底死掉 / 让 nord 这类主题也能把弱文字修暖"，只有 **re-open D1/D7（新增文本层令牌，如 `--faint-foreground`）** 能做到（保留族在任何主题下都是出厂冷灰）。那是**"弱文字要不要跟主题"的取舍**，属**独立一条线**（连同 `--subtle-foreground` 一起评估），应单独拍板，不并入本收口。
