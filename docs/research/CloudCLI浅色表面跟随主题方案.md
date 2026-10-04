# CloudCLI 浅色表面跟随主题方案

> **一句话**：把"浅色外观下、卡片/面板这类**面**永远是纯白"这条被契约钉住的行为解开——分两片：**片 1** 给 9 套 `full` 覆盖层各补一个"纸"档，让浅色卡面带上主题色调；**片 2** 把 43 站用兼容色阶当表面的组件接回语义令牌（对出厂**解析色值零回归**）。
>
> **本方案有一处必须由审批者拍板的硬边界**（§5）：卡面染色与"面上次级文字过 WCAG AA"在本仓库当前取值下**不可兼得**——卡片亮度 ≤97 就开始侵蚀 `n-gray-500` 的 4.5:1，而 ≥97 的染色肉眼等同纯白。三条路线及其实测代价见 §5，本方案的推荐是**路线 B**；路线 B 的代价（4 套卡面次级文字低于 AA）**另立记账片承接（D8）**，不塞进阻断式的 `CONTRAST_PAIRS`。

- **状态**：**已实施（2026-10-02）** —— 片 1（契约 ＋ 取值 ＋ 基线）＋ 片 2（43 站，含 D7 判 **A** 的 4 站吸顶条）＋ D4 守卫 ＋ D6 回调全部落地；完整实施记录见《CloudCLI 主题与配色体系设计方案》§6 的 **2-U 实施记录**。**方案快照基准 = `e5bdac09`（2026-10-02）**；工作区为**多线并存态**，与本方案相关的未提交改动有两类：① 本方案唯一的预置改动 #6（`QuickSettingsHandle.tsx` 一行，见 §2.4）；② **另一条线**的三处吸顶条毛玻璃 `/60→/50`（`CollapsibleSection` / `ExecutionProcessSummary` / `UserMessageStickyHeader`，见 §4.4）及守恒律基线随之的 9 增 8 删。**所有基线读数以本快照为准，并存改动不计入本方案**（隔离口径见 §6.8）。
- **证据等级**：所有读数来自真引擎（Playwright + 本项目已上线的 `tests/theme-tokens` fixture 同源方法）；所有契约引用已逐条对照行号
- **影响面**：`src/index.css`（基座 1 处 + 9 处覆盖层）、`src/` 下 24 个组件文件、`tests/theme-tokens/theme-overlays.spec.ts`（契约）、1 份基线（`token-baseline.json`）、1 份守恒律基线
- **出厂视觉**：**零回归**（片 2 只改 class 串，出厂解析色值不变；论证见 §4.3）。**注意这不是"逐字节不变"** —— 组件 class 与产物选择器都会变，见 §4.3 与 §6.7。

---

## 0. 术语与既有台账

| 记法 | 指什么 |
|---|---|
| **面** | 一块容器/浮层/面板/输入的底色：modal、`TaskCard`、下拉菜单、吸顶条 |
| **符号** | 滑块、指示点、图标底、kbd 徽标——白色在这里是语义（要在彩色轨道/深底上可见） |
| **L1 / L2** | `--palette-*`（原始色板）/ 语义令牌（`--card`、`--background`…） |
| **基座** | `cc-light` / `cc-dark`：**没有** `[data-theme]` 块，就是 `:root` / `.dark` 那一份（`constants.ts:331-346`、`theme-overlays.spec.ts:11-13`） |
| **覆盖层** | 其余 10 套内置主题，靠 `[data-theme="<id>"]` 选择（`OVERLAY_THEMES = BUILTIN_THEMES.filter(appearance === 'system')`，`theme-overlays.spec.ts:58`） |

本方案要翻的是**两处已被写死的既有裁定**，所以先把它们摆出来：

1. **`theme-overlays.spec.ts:103-107`（`cardSurface` 注释）**
   > "The card surface is the one that comes from a different family per appearance: pure `--palette-white` in light, `--palette-ink-900` in dark. **Only the dark half is inside any theme's reach — the light card stays pure white on the tinted substrate**, the way the base's card sits on warm sand — so a full theme moves these in the dark appearance only."

2. **《CloudCLI 用户主题升内置方案》§10.4 / §10.6**
   > 「想给浅色卡面染色，**要同时放开两层**——① `cardSurface` 对 full 浅色放行；② `--palette-white` 从 `fixed` 放行……而 white 的风险评估恰是 10.2 里"最高"那条。」
   > 裁定：**不放开**。「浅色卡面靠纯白从暖沙底上"浮起来"，是产品视觉基调；染色会同时牵动**卡面上大量 `n-*` 站点**的对比度。」

那份方案的"两层叠加"判断是对的，**它担心的对比度代价也是真的**（本方案把它量出来了，见 §5.2）。本方案与它的分歧只有一处：它把代价估成"无法评估的牵引"，本方案把代价算成了**每套主题的具体数字**，并据此给出取舍。

---

## 1. 问题

### 1.1 用户报告（原始 7 处）

> 「切换不同主题的时候，以上这些还是用的白色，跟我的主题格格不入」
> ① 侧栏「项目/对话」选中 tab ② 侧栏每条会话 ③ 主区「聊天/终端/文件/源代码管理」选中 tab ④ 聊天输入框整框 ⑤ 新会话「选择模型」入口 ⑥ 右侧悬浮的 `<` 按钮 ⑦ 快捷设置/外观里的下拉框

### 1.2 逐处接线结果（已核）

| # | 位置 | 源码 | 底色令牌 |
|---|---|---|---|
| ① | 侧栏模式 tab 选中 | `sidebar/SidebarModeTabs.tsx:68` | `bg-card` |
| ② | 侧栏会话行 | `sidebar/SidebarSessionItem.tsx:159` / `:396` | `bg-card` |
| ③ | 主区 tab 选中 | `shared/ui/PillBar.tsx:38` | `bg-card` |
| ④ | 聊天输入框 | `chat/composer/PromptInput.tsx:43` | `bg-card/80` |
| ⑤ | 「选择模型」入口 | `shared/ui/Card.tsx:10`（经 `chat/transcript/ProviderSelectionEmptyState.tsx:309`） | `bg-card` |
| ⑥ | 悬浮 `<` 按钮 | `quick-settings-panel/QuickSettingsHandle.tsx:66` | ~~`bg-n-white dark:bg-n-gray-800`~~ → `bg-card`（**已改**） |
| ⑦ | 装置下拉框 | `quick-settings-panel/QuickSettingsContent.tsx:34-35`、`settings/tabs/AppearanceSettingsTab.tsx:92` | `bg-card` |

**6 处读 `--card`，1 处（⑥）读被冻结的 `--n-white`。** 全仓 `bg-white` 命中数 **0**，没有任何硬编码白。

### 1.3 真机读数（Playwright，`127.0.0.1:3011`）

`--card` 与 `--background` 在各主题的**解析值**（浏览器代换 `var()` 之后）：

| 主题 | `--background`（页） | `--card`（卡，浅色） | 卡面渲染 |
|---|---|---|---|
| 基座 `cc-light` | `44 22% 96%` `#f7f6f3` | `0 0% 100%` | `#ffffff` |
| `cc-polar` | `213 26% 96%` `#f2f5f7` | `0 0% 100%` | `#ffffff` |
| `cc-catppuccin` | `220 23.08% 94.9%` `#eff1f5` | `0 0% 100%` | `#ffffff` |
| `cc-islands` | `228 12.82% 92.35%` `#e9eaee` | `0 0% 100%` | `#ffffff` |
| `cc-onedark` | `220 13% 96%` `#f3f4f6` | `0 0% 100%` | `#ffffff` |
| `cc-dracula` | `48 58% 96.08%` `#fbf8ef` | `0 0% 100%` | `#ffffff` |
| **`cc-gruvbox`** | `48.46 22% 88.24%` `#e8e5da` | `0 0% 100%` | **`#ffffff`** |
| `cc-kanagawa` | `53.33 25% 84.31%` `#e1dfcd` | `0 0% 100%` | `#ffffff` |
| `cc-tokyo-night` | `230 11.11% 89.41%` `#e1e2e7` | `0 0% 100%` | `#ffffff` |

**底在动、卡不动。** 差异在 `cc-gruvbox` 这类暖纸底上最刺眼：`#ffffff` 的卡坐在 `#e8e5da` 的米色页上（截图已核，`/tmp/gruvbox-cc-gruvbox-light.png`）。

### 1.4 顺带量到的一条更广的病

用户点名的 7 处只是**读 `--card` 的那 6 处 + 1 处读错**。同一形态在 `bg-n-white` 上还有 **52 个站点**——它们是同一根断线的更大暴露面（§4）。

---

## 2. 根因

### 2.1 现象一：浅色卡面恒纯白（管 ①~⑤、⑦）

同一根链条，两条分支（`src/index.css`）：

```
浅色：  --card:      var(--palette-white)      :206     ┐
        --popover:   var(--palette-white)      :208     ├ 都指向 L1
        --palette-white: 0 0% 100%              :58     ┘ ← 全仓唯一一处声明
深色：  --card:      var(--palette-ink-900)    :484
        --popover:   var(--palette-ink-900)    :486
```

`cc-*` 覆盖层**从不声明 `--palette-white`**（实测：10 套一个都没有），所以浅色 `--card` 恒解析为 `0 0% 100%`。

**这是被契约钉住的，不是遗漏**：

- `theme-overlays.spec.ts:467` —— `const cardMoves = theme.coverage === 'full' && appearance === 'dark';`
  浅色时 `--card`/`--popover` 落进 `mustNotMove`（`:474-477`）⇒ **覆盖层若去染浅色卡面会直接测红**。
- `:163` —— `fixed: ['--n-white', '--n-black']`
- `:134-147` —— `compat: [... '--n-gray-50' … '--n-gray-950' …]`（四族 44 档，**可移**）

### 2.2 现象二：`bg-n-white` 是"死白"（管 ⑥，以及 §4 的 52 站）

```
--n-white: var(--palette-white)   src/index.css:309
--palette-white: 0 0% 100%        src/index.css:58
```

`--n-white` 在 `fixed` 里 ⇒ 任何覆盖层都够不着它。（`--n-gray-*` 映射 `--palette-gray-*`，在 `compat` 里 ⇒ **可染**，`cc-dracula` / `cc-gruvbox` / `cc-kanagawa` / `cc-tokyo-night` 四套都把整条灰阶重铺了。）

### 2.3 现象三（用户未报，但同一根因）：面与文字走在两条不同的轨道上

`bg-n-white` 当背景用的 52 个站点里，**45 个是"面"，且全部带 `dark:` 兄弟**：

```
bg-n-white dark:bg-n-gray-800
     ↑ 冻结、恒白        ↑ 可染、跟主题
```

⇒ **深色半边跟主题，浅色半边不跟。** 这是一处不对称，不是"深色也白"。

分桶实测（`src/shared/tests/theme-atom-conservation.json` / `byUsage`）：

| 桶 | 现在 | 其中"面" | 其中"符号/保留" |
|---|---|---|---|
| `bg: white` | 44 | 40 | 4 |
| `bg: white/50` | 2 | 2 | 0 |
| `open]/section bg: white/50` | 2 | 2 | 0 |
| `bg: white/60` | 1 | 1 | 0 |
| `bg: white/10` | 1 | 0 | 1 |
| `bg: white/20` | 1 | 0 | 1 |
| `after bg: white` | 1 | 0 | 1 |
| **合计** | **52** | **45** | **7** |

> 注：这 45 个"面"里，`MermaidDiagram` 与 `CodeEditorSurface` 两个站点**单独立项**（见 §4.3 "单独议"），**不进片 2** ⇒ 片 2 实际改动 = **43 站**。
> 后文凡"片 2 改动数 / 守恒律预期"一律用 **43**；"45"只保留在本表的分类含义（"面"的总数）。

### 2.4 已发生的改动（#6，一行；快照 `e5bdac09` 之前）

> 这是**本方案**唯一的预置改动，不是"工作区唯一改动"。工作区另有一条线的三处吸顶条改动（§4.4），与本方案无关。

`src/modules/quick-settings-panel/QuickSettingsHandle.tsx:66`：
`bg-n-white dark:bg-n-gray-800` → `bg-card`

- 守恒律按预期报警，**恰好两桶**：`total 1562 → 1560`、`bg: white 45 → 44`、`dark bg: gray-800 57 → 56`（一处不多不少），已按其自身说明重生成。
- 门槛：`typecheck` 0 错 · `lint` 0 错 · `test:client` 155 文件 / 1285 全绿 · `test:theme-tokens` 200 passed / 0 failed。
- **注意**：#6 改的是**两态**（去掉了 `dark:bg-n-gray-800`）。本方案对那 43 站主张的却是**只改浅色**（§4.3），两者口径不同——若采纳本方案，建议把 #6 也回调成 `bg-card dark:bg-n-gray-800` 以保持同族一致（**待决项 D6**）。对内置主题而言两者的差别只有深色半边：`#30271b`（gruvbox `gray-800`）vs `#32302f`（gruvbox `ink-900`）。

---

## 3. 契约现状全图（改动前必读）

`tests/theme-tokens/theme-overlays.spec.ts` 的约束，逐条对照：

| 机制 | 位置 | 内容 | 本方案是否触碰 |
|---|---|---|---|
| `SURFACES.substrate` | `:71-83` | 11 项 | 否 |
| `SURFACES.cardSurface` | `:109` | `['--card', '--popover']` | **是**（放开浅色） |
| `SURFACES.compat` | `:134-147` | 四族 44 档 | 否 |
| `SURFACES.fixed` | `:163` | `--n-white` / `--n-black` | **是**（二审发现：需把 `--palette-white` 并入，见 §4.1① 与 §6.5） |
| `LIGHT_ONLY_SUBSTRATE` | `:177` | `--nav-input-bg` | 否 |
| `MUST_MOVE.full` | `:182` | substrate 11 + terminal 7 + graph 3 + editor 6 | 否 |
| `MUST_NOT_MOVE.full` | `:195` | `[...fixed]` | **是**（随 `fixed` 自动带上新断言） |
| `cardMoves` | `:467` | `full && dark` | **是**（改为 `full`） |
| `derivedMoves` | `:305-317` | `value.includes(baseValue)` | **是**（字面匹配会放行 `--palette-white`，见 §4.1① / §6.6） |
| `an overlay may only redeclare tokens the base declares` | `:419-438` | `if (!(name in base.tokens))` | 无需（且该检查**实为空转**，见 §6.6） |
| 浅色泄漏检查 | `:521-575` | 有 `:not(.dark)` 块的覆盖层必须拥有"仅浅色"的 token | 否（新档位进裸块） |

另外三处与本方案有关的**非** overlay 契约：

- `token-contract.spec.ts:155-182`「no colour token holds a literal value outside the palette…」——
  **非 `--palette-*` 的颜色令牌不得写字面值**（豁免：`--editor-*`、`--code-block-bg`、`--cc-syntax-*`、`--term-font-family`）。
  ⇒ **覆盖层不能直接写 `--card: 48.46 22% 92%`**，只能 `var(--palette-…)`。这是本方案选择"新增一个 L1 档"而不是"覆盖层直写 `--card`"的直接原因。
- `token-contract.spec.ts:122-132`「every palette token is consumed by at least one declaration」——每个 L1 档必须被引用。
- `theme-overlays.spec.ts:400-417`「every `[data-theme]` block belongs to a registered overlay, and vice versa」——双向遍历闭合。

---

## 4. 设计

### 4.1 片 1：卡面跟随主题（A 案）

**机制：新增一个 L1"纸"档，而不是放开 `--palette-white`。**

```
基座  :root
  --palette-sand-25: 0 0% 100%;      ← 新增；值=纯白 ⇒ 出厂解析值不变
  --card:    var(--palette-sand-25);  ← 由 var(--palette-white) 改指它
  --popover: var(--palette-sand-25);

9 套 full 覆盖层（各自的裸块，与 sand-50/100/200 排在一起）
  --palette-sand-25: <该主题的纸色>;   ← 每套一行
```

**为什么这么做**：

1. **只放开一层，不是两层 —— 但必须补一条显式断言（二审两方独立指出）。** §10.4 说"染色要同时放开 `cardSurface` 和 `--palette-white`"。本机制**不动 `--palette-white` 的声明** —— 它继续喂 `--n-white`（257 站、fixed）、`--code-block-bg`（`:229`）、`--editor-bg`（`:377`）、`--editor-toolbar-bg`（`:418`）、`--editor-loading-bg`（`:422`）。**10.2 里"风险最高"的那条整个绕开。**
   > **但"只放开一层"在守卫层面并不自动成立**：新档的基座值恰为 `0 0% 100%`，会让 `derivedMoves`（`theme-overlays.spec.ts:305-317`）的**字面子串匹配**把同值的 `--palette-white` 一并塞进 `allowed`。于是某个 full 覆盖层若误染 `--palette-white`，既躲过 `beyondReach`（`:458`），又不在 `mustNotMove` 的**名单**里（那里只有 `--n-white`/`--n-black`，`:163`）⇒ 原稿由此推出**静默漏检**。**（2026-10-02 实施更正：这一步推错了**——`--n-white` 的解析值读的正是 `--palette-white`，`mustNotMove` 比的是解析值，故误染会**通过 `--n-white` 被抓住**，实测仍然红。真实的缺口是"保证隐式依赖 `--n-white` 的实现"，不是"静默"。④ 照做，定性为硬化。见 §6.5④ 的 ⚠️。）** 今天没有这个问题（覆盖层改的是 ink / sand 家族，基值不是纯白）。⇒ 本方案**新增一条显式禁移断言**把 `--palette-white` 钉进冻结集（见 §6.5），"只放开卡面一层"才是**可回归的契约**而非当前样式表的事实。
2. **出厂解析值零变化。** 基座新档值就是 `0 0% 100%`，`--card` 解析结果与今天完全相同 ⇒ `token-baseline.json` 里 `--card`/`--popover` 两态不动。
3. **`--n-white` 与 `--palette-white` 的耦合没被撬动** ⇒ `neutralScale.test.ts:191`（`--n-white` → `var(--palette-white)`）与 `:306-314`（极值不随外观动）都不需要改。
4. **档位名沿用家族约定**：`sand` 是"浅色外观的基材家族"，步号越大越暗，`25` 比 `50` 亮 —— 语义自洽。基座值恰为纯白，也正对应"基座的纸就是纯白"这一产品基调。

**名称待决**（**待决项 D2**）：`--palette-sand-25`（沿用家族步号）vs `--palette-paper`（按角色命名，与 `--palette-white` / `--palette-black` 同构）。

**9 套 full 覆盖层 = 全部覆盖层减 `cc-ocean`。** `cc-ocean` 的 `coverage === 'accent'`（`constants.ts:353`），`cardMoves` 对它为假、`cardSurface` 落进 `mustNotMove`（`:474-477`）⇒ **它必须保持纯白卡面**，这恰是 `accent` 徽标"只动强调色家族"的承诺。方案不改这一点（**待决项 D3** 记录为已知边界）。

### 4.2 片 1 的取值（逐套）

**口径**：`卡片 = 页面同色相、饱和减半、亮度 = min(98, 页面亮度 + 4)`。
- `+4` 来自基座的自身关系：页 `44 22% 96%` → 卡 `0 0% 100%`（ΔL = +4）。
- 上限 `98` 是"仍能看出色相"的经验上限（`L = 100` 时任何 H/S 都退化为纯白）。

| 覆盖层 | 页面（`sand-50`） | 现行卡面 | **候选卡面** | 渲染 |
|---|---|---|---|---|
| `cc-polar` | `213 26% 96%` | `#ffffff` | `213 13% 98%` | `#f9fafb` |
| `cc-catppuccin` | `220 23.08% 94.9%` | `#ffffff` | `220 11.54% 98%` | `#f9fafa` |
| `cc-islands` | `228 12.82% 92.35%` | `#ffffff` | `228 6.41% 96.35%` | `#f5f5f6` |
| `cc-onedark` | `220 13% 96%` | `#ffffff` | `220 6.5% 98%` | `#fafafa` |
| `cc-onedark-vivid` | `220 13% 96%` | `#ffffff` | `220 6.5% 98%` | `#fafafa` |
| `cc-dracula` | `48 58% 96.08%` | `#ffffff` | `48 29% 98%` | `#fbfbf8` |
| `cc-gruvbox` | `48.46 22% 88.24%` | `#ffffff` | `48.46 11% 92.24%` | `#edede9` |
| `cc-kanagawa` | `53.33 25% 84.31%` | `#ffffff` | `53.33 12.5% 88.31%` | `#e5e4dd` |
| `cc-tokyo-night` | `230 11.11% 89.41%` | `#ffffff` | `230 5.55% 93.41%` | `#edeeef` |

**备选口径**（**待决项 D1**）：
- **口径 甲（本表）**：保 H、S 半减、L = min(98, 页+4)。
- **口径 乙**：保 H、**保 S**、L = min(98, 页+4)。差异极小（例：gruvbox `48.46 22% 92.24%` `#f0eee7`，比甲暖一点）。乙更"忠实参照物"，甲更"像纸"。
- **口径 丙**：**L 固定 98**。AA 全绿（见 §5.2），但 §5.1 会说明它**肉眼等同纯白，治不了本问题**。
- 参照物自带浅色纸色的几套（catppuccin Latte / gruvbox light / kanagawa lotus / tokyo-night day）**不能直接照抄** —— 它们的浅底在原作里就是页面色，而且 `cc-gruvbox` 的块注释已明写"刻意把浅色基材的饱和度压到基座水平（22/15/14%）"是对照物的**有意偏离**。照抄会把主题作者否掉的"柠檬纸"找回来。

### 4.3 片 2：43 站"面"接回语义令牌

> §2.3 数出 45 个"面"，其中 `MermaidDiagram` / `CodeEditorSurface` 两站**单独立项**（见本节末"单独议"）⇒ 本片实际改动 **43 站**。§6.1 的守恒律预期、§8 的执行步骤均按 43 计。

**改动**：`bg-n-white` → `bg-card`（语义是下拉/浮层的 → `bg-popover`），**保留 `dark:bg-n-gray-800` 不动**。

**为什么只改浅色半边 —— 一条可算的零回归论证**：

```
--card    : var(--palette-white)   :206
--n-white : var(--palette-white)   :309   ← 同源
```

⇒ 基座下两者解析值**都是 `0 0% 100%`**，且 `hsl(var(--card))` 与 `hsl(var(--n-white))` 是同一条 Tailwind 路径（`tailwind.config.js:60` / `:92`）。
**⇒ 出厂外观下这 43 站的解析底色相同 ⇒ 视觉零回归。**

> **口径澄清（一审 Codex 指出）**：这里能证明的是"**计算色值**（解析后的底色）不变"，**不是"逐字节不变"**。`bg-n-white` → `bg-card` 会改组件 `className` 串、也改构建产物里的选择器文本 —— 只是这两者在出厂外观下解析到同一色值。本方案其余各处的"逐字节"措辞仅用于**令牌解析值**层面；凡涉及**组件级**改动，一律用"零回归 / 解析色值不变"。

深色半边**不是**同源的：
| | 基座深色解析值 |
|---|---|
| `--n-gray-800`（今天） | `215 27.9% 16.9%` `#1f2937` |
| `--card` = `ink-900` | `0 0% 12%` `#1f1f1f` |

⇒ 若连深色半边一起换，43 站在**全部主题 + 出厂**下都会变色，而它们**本来没坏**（`--n-gray-*` 在 `compat`，主题可染）。**所以不换**。这是"改深色那半"被单独立项为 **D5** 的原因：那是"深色下浮层比卡片亮一档（`#1f2937` vs `#1f1f1f`）的层次要不要抹平"，属于另一件事，不是本病灶。

**改动清单（43 站 / 24 文件）**

`bg-card`：
- `project-creation-wizard/`: `GithubAuthenticationCard.tsx:102`、`FolderBrowserModal.tsx:114`、`ProjectCreationWizard.tsx:136`
- `provider-auth/ProviderLoginModal.tsx:130`
- `file-tree/ImageViewer.tsx:63`
- `version-upgrade/VersionUpgradeModal.tsx:142`
- `prd-editor/`: `PrdEditorLoadingState.tsx:5`、`PrdEditorWorkspace.tsx:62`
- `prd-editor/modals/`: `OverwriteConfirmModal.tsx:27,44`、`GenerateTasksModal.tsx:24,51,72`
- `task-master/`: `TaskFiltersPanel.tsx:51,67,86`、`TaskEmptyState.tsx:76,107,112,117`、`TaskCard.tsx:143`、`TaskBoardToolbar.tsx:103,114,127,140,155`
- `task-master/modals/`: `CreateTaskModal.tsx:16,43,66`、`TaskMasterSetupModal.tsx:37,94`、`TaskHelpModal.tsx:54`、`TaskDetailModal.tsx:153,230,275`
- `chat/tools/InteractiveRenderers/AskUserQuestionPanel.tsx:164`
- `chat/transcript/`: `ExecutionProcessSummary.tsx:211`（`bg-n-white/50` → `bg-card/50`）、`UserMessageStickyHeader.tsx:143`（`/50` → `/50`）
- `chat/tools/CollapsibleSection.tsx:42,69`（`group-data-[state=open]/section:bg-n-white/50` → `…:bg-card/50`）
- `task-master/TaskBoardContent.tsx:45`（`bg-n-white/60` → `bg-card/60`）

`bg-popover`（语义明确是浮层）：
- `project-creation-wizard/WorkspacePathField.tsx:99`（路径补全下拉）
- `task-master/TaskBoardToolbar.tsx:190`（视图下拉菜单）

**保留不动（7 站，"符号"）**：

| 位置 | 为什么白是对的 |
|---|---|
| `settings/SettingsToggle.tsx:30`、`shared/ui/DarkModeToggle.tsx:47` | 滑块：要在彩色/灰轨道上可见 |
| `plugins/PluginSettingsTab.tsx:182`（`after:bg-n-white`） | 同上（`after:` 伪元素画的滑块） |
| `browser-use/BrowserUsePanel.tsx:327` | 准星圆点 |
| `chat/composer/PromptInput.tsx:174`（`bg-n-white/20`） | kbd 徽标，压在深底上 |
| `chat/transcript/ChatMessageImages.tsx:117`（`bg-n-white/10`） | 图片上的按钮，压在图像上 |
| `code-editor/CodeEditorMediaPreview.tsx:168` | iframe 底：渲染的是 HTML，Web 内容默认白底 |

**单独议，不进本片（2 站）**：

- `code-editor/markdown/MermaidDiagram.tsx:78` —— 它自带 `dark:bg-n-zinc-900`，图的线条色与底联动；换令牌要先确认 Mermaid 自身的主题注入路径。
- `code-editor/CodeEditorSurface.tsx:62` —— 它写 `bg-n-white dark:bg-n-gray-900`，而 CodeMirror 走的是 `--editor-bg`。**这可能是与主题脱节的独立缺陷**，值得单独取证。

### 4.4 顺带记账：三处吸顶条已被另一条线在动

`UserMessageStickyHeader.tsx:143`、`ExecutionProcessSummary.tsx:211`、`CollapsibleSection.tsx:42,69` 的毛玻璃档已由另一条线从 `/60` 调到 `/50`（正是守恒律基线里那 6 行未提交 diff）。**片 2 要动它们前必须与那条线对齐**（**待决项 D7**）。

> **2026-10-02 裁定（D7）：取 A 案 —— 一并做并记账。** 用户拍板把这 4 站**纳入片 2**（不另立一片、不排除）。代价已知且如实记：这 4 站的毛玻璃改动与本次令牌替换**落在同一行、`git add -p` 拆不开 hunk**，提交时会把那条线的 `/60→/50` ＋ `blur-[20px]` ＋ `saturate-150` 一并带入，**那不是本片的功能**。已在《CloudCLI 主题与配色体系设计方案》的 2-U 实施记录里单独记账。

---

## 5. **本方案的核心决策：染色深度 vs 次级文字 AA（不可兼得）**

这一节是本方案唯一"必须由人拍板"的地方，其余都是机械改动。

### 5.1 边界是硬的

把 `n-gray-500`（**全仓 36 文件 / ~95 站**，且确实压在卡面上：`TaskCard` 6 站、`TaskDetailModal` 4 站、`AskUserQuestionPanel` 8 站、`TaskBoardToolbar` 3 站…）压在候选卡面上，按 `userThemeContrast.ts:156-179` 的**同一套算法**（HSL → 8 位通道取整 → WCAG）计算：

| 卡面亮度规则 | 渲染 | `n-gray-500` 在卡面上 | 是否过 AA |
|---|---|---|---|
| 纯白（今天） | `#ffffff` | 4.80 ~ 4.84 | ✅ |
| **L = 98** | `#f9fafb` ~ `#fbfaf9` | **4.61 ~ 4.65** | ✅ |
| L = 96 | `#f4f4f5` ~ `#f6f6f4` | 4.40 ~ 4.50 | ❌（除 dracula 恰好 4.50） |
| **L = 页 + 4（本方案口径甲）** | `#e5e4dd` ~ `#f9fafb` | **3.77 ~ 4.65** | ❌（4/9 套） |

**"今天"的余量只有 0.30~0.35。** ⇒

> **结论：浅色卡面亮度 ≤ 97 即开始侵蚀 `n-gray-500` 的 4.5:1；而 ≥ 97 的染色肉眼看仍是白（通道差约 5/255 ≈ 2%，孤立看不可辨）。两者在本仓库当前取值下不可兼得。**

只有 `L = 98` 能同时"过 AA"和"不动别人"，但它的染色极淡 —— **它能消掉"纯白"这个绝对值，但看不出主题色相**。

### 5.2 口径甲的逐套代价（实证）

`L = 页 + 4` 口径下，逐套的 AA 读数与"要救需要压多暗"（复算方法＝`userThemeContrast.ts:156-199` 同一算法；白卡列 4.80~4.84 与 §5.1 逐字吻合，可作自校准）：

| 覆盖层 | `n-gray-500` 在卡面 | 页面上的同一读数（现状） | 要救需把 `--palette-gray-500` 压暗 |
|---|---|---|---|
| `cc-polar` | 4.63 | 4.42 | 0 |
| `cc-catppuccin` | 4.62 | 4.28 | 0 |
| `cc-islands` | **4.44** | 4.02 | 0.26 |
| `cc-onedark` | 4.63 | 4.39 | 0 |
| `cc-onedark-vivid` | 4.63 | 4.39 | 0 |
| `cc-dracula` | 4.65 ✅ | 4.54 | 0 |
| `cc-gruvbox` | **4.10** | 3.82 | 2.39 |
| `cc-kanagawa` | **3.77** | 3.58 | 4.83 |
| `cc-tokyo-night` | **4.17** | 3.74 | 2.32 |

> **加粗 = 低于 4.5。** 失守集 = **{islands, gruvbox, kanagawa, tokyo-night} = 4/9 套**（与 §5.1 的 4/9 一致）。
>
> **本表已于二审复核并更正**：原稿 `cc-dracula` 行两列均误（写成 4.10 / ~3.7，与 `cc-gruvbox` 串了），实为 **4.65（过 AA）/ 4.54**；"页面"列亦按同一算法整体重算（原值为近似，偏低 0.1~0.3）。dracula 由此**移出失守集**，总数仍为 4/9（另一成员 tokyo-night 的 4.17 坐实）。原稿的**内部矛盾**是发现线索：§5.1 写"L=96 时 dracula 恰好 4.50"——卡面越亮 ratio 越高，若口径甲（L=98）真是 4.10，L=96 只可能更低，不可能升到 4.50。

两点必须同时说清：

1. **"回归"的性质**：失守的这 4 套（islands / gruvbox / kanagawa / tokyo-night）的 `text-n-gray-500` 在**页面上本来就低于 AA**（3.58~4.02，无任何守卫在度量）。染色把卡面从"唯一达标岛"（白卡 4.80~4.84）降到 4.10~4.44 —— **仍高于该套自己的页面，但低于 4.5**。**用户在这个主题下的日常观感量级没有变化。**
   > ⚠️ 但这不是"因为我们原先也不达标就豁免"的许可证：**若产品把面上小号次级文字 4.5:1 定为硬性发布门槛，就不能用本条辩护，必须改选路线 C**（二审 Codex 的独立提醒）。
2. **这个读数当前无守卫**：`CONTRAST_PAIRS`（`userThemeContrast.ts:67-87`）的 12 对里，`n-*` 只出现在 `n-*` **面**上，**没有一对是 `n-*` 文字压在语义面（`--card`）上**。§10.4 担心的"牵引"从未被度量过——本条是它的第一次量化。

### 5.3 三条路线与推荐

| 路线 | 内容 | 正 | 负 |
|---|---|---|---|
| **A** | 只做片 2（接线纠正），**不做**片 1 | 零风险；对你的 8 套用户主题**立即生效**（它们直接定义 L2 `--card`）；出厂零变化 | 对 9 套内置主题**无收益**（浅色卡恒白）⇒ 切 `cc-gruvbox` 时问题原样 |
| **B** | 片 2 ＋ **片 1 口径甲**（L = 页 + 4，S 半减），接受 4 套（islands / gruvbox / kanagawa / tokyo-night）的 `n-gray-500` 在卡面上低于 AA（但仍优于各自页面）；把守卫缺口**另立一片**（**D8**，快照式记账、不设 AA 阈值） | 染色**可见**，真正解决"格格不入"；改动集中（基座 1 行 + 每套 1 行） | 4/9 套卡面次级文字低于 AA（3.77~4.44），需如实记账 |
| **C** | 片 2 ＋ 片 1 ＋ **同批处理文字侧**：① 把 `CONTRAST_PAIRS` 加上 `n-gray-500 on --card`；② 逐套压暗 `--palette-gray-500`（3 套 2.3~4.8 L，1 套 0.26）；或改为把面上的次级文字换成 `--muted-foreground` | AA 全绿且染色可见 | ① 动"兼容色阶"违背其"逐档照抄 Tailwind"的前提，会击穿 `neutralScale.test.ts` 基线与守恒律；② 或扩到 ~95 处组件的文字收口 —— **范围显著变大** |

**本方案推荐路线 B。** 理由三条：

1. **代价已被量化，且落在既有状态内部**（§5.2 第 1 点）——不是新增一类不可读，而是"取消一个例外"。
2. **它不动 `--palette-white` 的声明**，这恰是既有裁定（§10.2）真正的风险点；**并新增一条显式断言把它钉住**（防空转，见 §4.1 第 1 点与 §6.5）。
3. **A 路线等于不解决用户实际场景**：用户正在考虑切 `cc-gruvbox`，而 A 对内置主题零收益。

**若审批者选 C**，本方案的片 1 设计（新增 L1 档 + 放开一层）**同样成立**，只是要追加"文字侧"那一步，且建议把 `--palette-gray-500` 的压暗做成**独立的一片**（因为它影响 11 档灰阶的基线契约）。

**若审批者选 A**，则本方案退化为 §4.3 的片 2 单独一片，§4.1 全部作废，`cardSurface` 契约一字不动。

---

## 6. 记账、验证与门槛

### 6.1 守恒律（`theme-atom-conservation.json`）预期

片 2 只改浅色半边（`bg-n-white` 消失、`bg-card` 出现，后者不进普查）：

| 桶 | 冻结值 | 预期 | 说明 |
|---|---|---|---|
| `bg: white` | 44 | **6** | 38 进片 2 + 6 保留（4"符号" + 2"单独议"） |
| `bg: white/50` | 2 | **0** | 两处吸顶条 |
| `open]/section bg: white/50` | 2 | **0** | `CollapsibleSection` ×2 |
| `bg: white/60` | 1 | **0** | `TaskBoardContent` |
| `dark bg: gray-800` | 56 | **57** | **D6 回调 #6**：该站补回 `dark:bg-n-gray-800`（§2.4）。**本行原稿把它并进"全部不动"，实施时按 D6 更正为 +1** |
| **`total`** | **1560** | **1518** | **−43（片 2 自身）＋ 1（D6）** |

> **本表末两行已于实施时更正（2026-10-02）**：原稿把 `dark bg: gray-800` 写成"不动"、`total` 写成 1517，与 D6 的默认取值（**回调** #6）**互相矛盾**——D6 要把 #6 去掉的那个 `dark:bg-n-gray-800` 补回来，而 #6 当初让该桶 `57 → 56`，所以回调必然让它回到 **57**、`total` 落在 **1518**。实施时实测恰好这 **5 个桶**、一处不多不少。
>
> **为什么是 −43 而不是 −45**（本表曾误写 −45，2026-10-02 更正）：§2.3 数出的 45 个"面"里，`MermaidDiagram` 与 `CodeEditorSurface` 两站**不进片 2**（§4.3 "单独议"），所以它们**留在** `bg: white` 桶里 ⇒ 该桶从 44 只降到 **6**（4 个"符号"白 + 这 2 个"单独议"），不是 4。片 2 四个桶的减量 = 38 + 2 + 2 + 1 = **43**。
> **核对判据**：`bg: white` 44→6、`total` 1560→**1518**、`dark bg: gray-800` →**57**。若实测出 `total` 1517 / 该桶 56，说明 **D6 没做**（#6 仍是两态）；若出 1515（−45），说明**多改了那 2 站**（正是本方案明令不动的）。

**除上面那一个桶外，`dark bg: gray-800/30 /40 /50 /60 /90 /95` 全部不动**（43 站的深色半边未改；`/50` 与 `/60` 之间的 2 处互换来自另一条线的毛玻璃改动，是同一提交里已经存在的前置改动，净变化为 0）。
按 #6 的做法：**先跑一次、确认恰好这四个桶、一处不多不少，再按其自身说明重生成**。

片 1（若采纳）**不进守恒律**：它只改 `src/index.css` 的令牌声明，不改任何类名。

### 6.2 `token-baseline.json` 预期

- `--palette-sand-25` 新增 **2 条**（light/dark 各一，值相同 `0 0% 100%`）。
- `--card` / `--popover` 的解析值**不变**（基座仍解析为 `0 0% 100%`）。
- **覆盖层声明永不进基线**（`captureSnapshot` 只读基座、不挂 `data-theme`）⇒ 9 套新增的 `--palette-sand-25` 值不会出现在 diff 里。
- ⇒ 刷新命令 `UPDATE_THEME_BASELINE=1 npm run test:theme-tokens`，**预期 diff 恰好 +2 行**。

### 6.3 `contrast.spec.ts`（12 配对 × 基色 + 每套覆盖层 × 明暗）

涉及 `--card` 的两对：`--foreground / --card`、`--muted-foreground / --card`。按候选口径甲实测（同一套算法）：

| 覆盖层 | `fg / card` | `muted / card` | 判定 |
|---|---|---|---|
| `cc-polar` | 17.94 | 4.80 | ✅ |
| `cc-catppuccin` | 7.64 | 5.98 | ✅ |
| `cc-islands` | 19.27 | 5.61 | ✅ |
| `cc-onedark` | 15.08 | 5.79 | ✅ |
| `cc-onedark-vivid` | 15.08 | 5.79 | ✅ |
| `cc-dracula` | 15.90 | 5.57 | ✅ |
| `cc-gruvbox` | 12.56 | 5.55 | ✅ |
| `cc-kanagawa` | 7.30 | 4.94 | ✅ |
| `cc-tokyo-night` | 6.44 | 5.08 | ✅ |

**最小余量 0.44（`cc-kanagawa` 的 `muted / card`）** ⇒ 落地时若微调口径，必须重跑这张表。

> 注意 `muted / card` 全部**变小**（卡面变暗），但都还在 4.5 之上 —— 这与 §5 的 `n-gray-500` 是两个不同的令牌族：`--muted-foreground` 是**语义**令牌、每套主题都按 AA 调过；`--n-gray-500` 是**兼容阶**、无人守。

### 6.4 其他套件

| 套件 | 预期 |
|---|---|
| `theme-overlays.spec.ts` | 需按 §6.5 改契约；改后 `cc-ocean` 仍落 `mustNotMove` |
| `token-contract.spec.ts` | 4 个 check 全过（新档位是 `--palette-*`，豁免字面值检查；被 `--card` 引用 ⇒ 非孤儿） |
| `neutralScale.test.ts` | **不动**（未碰 `--n-*`） |
| `code-block-surface.spec.ts` | 需核：它断言 `boards.editor === boards.reference`（`--editor-bg`），本方案未动 `--editor-*` ⇒ 预期不动 |
| `first-paint.spec.ts` / `theme-chrome.spec.ts` | 不动（`theme-color` 由 `--background` 派生，1-I 已改） |
| `dist/` 产物 | 无需（`token-baseline` 不含覆盖层） |

### 6.5 契约改动（片 1）

**改动落点共三处**（一审 Pi 指出原稿漏了第二处）：

```ts
// ① theme-overlays.spec.ts:103-107 —— cardSurface 的说明注释整体重写
// ② theme-overlays.spec.ts:465-466 —— cardMoves 上方的两行行内注释：
//    "The card surface only enters a theme's reach in the dark appearance —
//     its light half comes from `--palette-white`, which no theme overrides."
//    改完后它与 cardMoves = full 的新行为直接矛盾，必须一并改写（漏改会误导下一个读者）
// ③ theme-overlays.spec.ts:467 —— 行为
- const cardMoves = theme.coverage === 'full' && appearance === 'dark';
+ const cardMoves = theme.coverage === 'full';
// ④ theme-overlays.spec.ts:163 —— 冻结集补一项（二审两方独立指出的缺口，见下）
- fixed: ['--n-white', '--n-black']
+ fixed: ['--palette-white', '--n-white', '--n-black']
```

- ③ 之外，**④ 是必须的补丁**（**待决项 D10**）：新档基座值恰为 `0 0% 100%`，`derivedMoves` 的字面子串匹配会把同值的 `--palette-white` 放进 `allowed` ⇒ 覆盖层误染它**躲得过 `beyondReach`**（这一点两审独立指出，属实）。把它并入 `fixed`（`MUST_NOT_MOVE.full = [...fixed]`，`:195`）后，任何覆盖层移动 `--palette-white` 都会落进 `mustNotMove` 报红。**这是本方案唯一"从'不主动碰'升级为'测试强制'"的一层。**
> **⚠️ 实施更正（2026-10-02）：上文原写"且 `mustNotMove` 也拦不住 ⇒ 静默漏检"，实测不成立。** `--n-white` 的解析值**读的正是 `--palette-white`**，而它在 `fixed` 里、`mustNotMove` 比的是**解析值** —— 把 `fixed` 撤回到两项后再让 `cc-gruvbox` 声明 `--palette-white`，**仍然红**（名单落在 `--n-white` 上）。⇒ **真实的缺口不是"静默"，而是"这份保证隐式依赖 `--n-white` 今天的实现"**（一旦它改指别的档位，同一变异才会静默）。④ **照做**，但定性为**硬化**（直接、具名、解耦），不是堵一个正在漏的口子。实测与复现步骤见《CloudCLI 主题与配色体系设计方案》2-U 实施记录与该文档文末"实施更正"。**
- `MUST_NOT_MOVE.accent`（`:187-194`）**不含** `cardSurface`，`cardMoves` 为假时它才进 `mustNotMove`（`:476`）⇒ 改完后 `accent` 的语义**不变**。
- ①②两处注释统一改写成："浅色卡面走 `--palette-sand-25`，覆盖层可重定义它；`--palette-white` 依旧冻结（并由 `fixed` 断言强制）"。
- **新增一条守卫**（**待决项 D4**，建议同批做）：钉住"**语义面不得读 `n-white`**"这一形态，否则同一个接错的动作会被下一个维护者重做。
  形态须**按桶计数、不锚行号**（与守恒律 `theme-atom-conservation.json` 同风格；行号锚点一插行就红，会逼出"为绿测试而改测试"）：
  对 `src/` 扫 `bg-n-white` / `bg-n-white/<alpha>`，断言**逐文件的出现计数**等于期望表；期望表只列 7 处"符号"白所在文件。
  必须同时写明"不要写成任何 `bg-n-*`"（`bg-n-gray-*` 在别处合法），并附**非空断言**（期望表被清空时要报红，防空转）。

### 6.6 三个**必须写进注释**的陷阱（否则改造会静默失效）

1. **新档位必须声明在基座 `:root`，不能只声明在覆盖层。**
   若只在覆盖层写 `--palette-sand-25`，`base.tokens['--palette-sand-25']` 读到空串 `''`，而 `derivedMoves`（`:305-317`）的判据是 `value.includes(baseValue)` —— **`'任何字符串'.includes('') === true`** ⇒ `allowed` 退化为"全部 token"，该主题的 `beyondReach` 检查（`:458` / `:487-490`）**整体失效**。这是"看起来更内聚的写法"反而拆掉守卫的典型。
2. **`an overlay may only redeclare tokens the base declares`（`:419-438`）当前是空转的。**
   `base.tokens` 取自 `readTokens`，而它遍历的 `tokenNames` 由 `extractTokenNames(cssSource)` 从**整份 `index.css` 原文**（`import … '?raw'`，`main.ts:23`）里扫出所有 `--x:` 名，**包括只写在覆盖层里的**。所以 `if (!(name in base.tokens))` 对这些名字恒为假，检查永不触发（真正兜住这件事的是 `token-contract.spec.ts` 的「baseline covers every token」）。本方案不依赖它，但**不要**因为它存在就以为"覆盖层不能引入新名字"。
3. **`derivedMoves` 是字面值匹配，不是依赖推导 —— 新档的基座值必须"不撞车"。**
   `derivedMoves`（`:305-317`）的规则是"凡是 base 解析值**包含**被替换 token 的 base 值的 token，都算允许移动"。新档基座值 `0 0% 100%` 是个**极常见的值**（`--palette-white`、`--n-white` 都等于它）⇒ 一旦覆盖层重声明新档，`--palette-white` 就被列为 `allowed`。**这不是本方案独有的缺陷**（任何"基座值恰为某公共值"的新档都会触发），但本方案正好命中。**处置：不靠它，改用 §6.5④ 的显式 `fixed` 断言兜住**；并把这条写进注释，避免下一个维护者以为 `beyondReach` 还在保护 `--palette-white`。

### 6.7 真机观感核验（必须做，且有一处已知坑）

用 `tests/theme-tokens` fixture 或直连 `127.0.0.1:3011` + `node_modules/playwright-core` 直连、从浏览器侧写 `dataset.theme` + `classList.toggle('dark')`，逐套截图。

> **坑（本次实测踩到，已写进 `tests/theme-tokens/README.md:164-170`）**：`src/index.css` 给每个 `div` 都加了 200ms 的颜色过渡。**换主题后立刻读 `getComputedStyle` 会拿到过渡的起始帧**——本次探针第一版因此把 9 套主题都读成了 `#ffffff`，一度误判成"令牌没生效"。
> 处置：探针元素加 `transition: none`（fixture 的做法），或**等足 最长过渡时长 + 250ms**。判据换成"先读 `transitionDuration` 再等"。

核验清单：
1. 9 套（片 1 后）浅色外观下，卡面不再是 `#ffffff`，且与页面**仍可区分**（卡片要"浮起"）。
2. 深色外观的**解析色值不变**（读 token / 计算色，不比对 class 串）。
3. 基座 `cc-light` / `cc-dark` 的**解析色值不变**。
4. 43 站在**你的 8 套用户主题**下的浅色外观读数（片 2 的直接收益面）。
5. **片 2 的代表性用例须覆盖三类形态**（一审 Codex 指出：令牌同值 ≠ 所有渲染结果同值，不能只抽一处普通卡面）：
   ① 普通实心面（`bg-card`）；② 半透明面（`bg-card/50`、`bg-card/60`，如三处吸顶条、`TaskBoardContent`）；③ 浮层（`bg-popover`，如路径补全下拉、视图下拉菜单）。

### 6.8 门槛（开工前基线，工作区当前为多线并存态）

| 命令 | 开工前读数 |
|---|---|
| `npm run typecheck` | 0 错 |
| `npm run lint` | 0 错（warnings 属并存改动） |
| `npm test` | 1029 项 / 1008 通过 / 20 失败 / 1 跳过（失败数在 19~21 摆动，**只比"名字集"**） |
| `npm run test:client` | 155 文件 / 1285 用例 |
| `npm run test:theme-tokens` | 200 passed / 0 failed |
| `npm run build` | exit 0 |

> `npm run build` **不校验客户端类型**（`build:client` 是 vite/esbuild）⇒ 门禁必须同时含 `typecheck` 与 `typecheck:theme-tokens`。
> 片 2 若动了 `server/` 以外的树，注意"树逐字节相同 ⇒ 红集必同"这条比 stash A/B 更硬的判据；本方案**不动 `server/`**。
>
> **基线比较对象与隔离口径**（一审 Codex 指出原稿 §0/§2.4 与本节口径不一）：
> ① 上表是**快照 `e5bdac09` + 上述两处并存改动**下的读数，**不是干净 HEAD 的读数**，不可直接当"出厂基线"；
> ② 增减量以**逐文件/逐套件 + 名字集**为准（`npm test` 只比 `not ok` 行名字集，不比计数 —— 失败数在 19~21 摆动）；
> ③ 本方案不动 `server/` ⇒ "`git diff <本快照> HEAD -- server/` = 0 行 ⇒ 红集必同"可直接生效；
> ④ 三处吸顶条属**另一条线**（见 D7），对账时须先剔除其 diff；
> ⑤ 提交用 `git add -p` 按 hunk 暂存，避免把并存改动卷进本方案。

### 6.9 变异测试清单（每条声称都要能被证伪）

| # | 变异 | 期望 |
|---|---|---|
| M1 | 把某套覆盖层的 `--palette-sand-25` 改回 `0 0% 100%` | `cardMoves` 亮红（"left these unchanged"） |
| M2 | 让 `cc-ocean` 也声明 `--palette-sand-25` | `mustNotMove` 亮红（accent 越界） |
| M3 | 只把 `--palette-sand-25` 声明到覆盖层、基座不声明 | `beyondReach` 应当亮红；**若仍绿 ⇒ §6.6-1 的失效被证实**（本条是那条陷阱的证伪用例，不是期望绿） |
| M4 | 9 套里漏一套 | `cardMoves` 对该套亮红 |
| M5 | 深色半边也指向新档 | `contrast.spec.ts` 或深色卡面读数亮红 |
| M6 | 片 2 里把某一处 `dark:bg-n-gray-800` 一起删掉 | 守恒律 `dark bg: gray-800` 桶 −1（证明"只改浅色"是被测出来的，不是口头的） |
| M7 | 片 2 里把某个 `bg-card/50` 写成 `bg-card` | 守恒律 `bg: white/50` 桶不归零（证明透明度没被吞掉） |
| M8 | 新守卫：把某处符号白名单删掉后仍绿 | 守卫白名单的"非空断言"必须亮红 |
| M9 | 让某套 full 覆盖层**额外**声明 `--palette-white`（模拟误染） | **必须亮红**（§6.5④ 的 `fixed` 断言）；**若仍绿 ⇒ 二审指出的静默漏检被证实**（本条是那条缺口的证伪用例，不是期望绿） |
| M10 | 把 M9 的覆盖层声明去掉，只保留 `--palette-sand-25` | 应回到全绿（证明 M9 的红来自 `--palette-white` 本身，不是新档误伤） |

---

## 7. 范围边界（**不做**清单，避免审阅者高估范围）

- **不动 `--palette-white` 的声明**（本方案的设计核心）⇒ `--n-white` / `--n-black` / `--code-block-bg` / `--editor-*` 全部不受影响。**但要新增一条显式断言把它钉进冻结集**（§6.5④，否则 `derivedMoves` 会静默放行它）。
- **不动基座 `cc-light` / `cc-dark`**：`cc-light` 没有 `[data-theme]` 块（实测：`index.css` 只有 10 个 `cc-*` 块），它**就是**基座；改基座等于改出厂外观，收益为零（用户不切 `cc-light`）。
- **不动 `cc-ocean`**（`accent`，必须保持纯白卡面）。
- **不动 `--n-*` 兼容色阶的取值**（路线 C 才涉及，且要单独立项）。
- **不改 `MUST_MOVE.full` 的 editor / graph / terminal / substrate 清单**。
- **不做"语义化改名 / 兼容阶退役"**（那是阶段 0 之后的独立线）。
- **不把 `bg-n-white` 一刀切**：7 处符号白全部保留。
- **不回填 `--card`/`--popover` 的浅色值到用户主题**：用户主题（`~/.cloudcli/themes/`）**8/8 已经直接定义 L2 `--card`**（实测：console `150 15% 97%`、clay `258 45% 95%`、tui `220 15% 97%`、liquid-glass `210 44% 99%`、win9x `0 0% 75%`、macos-native/fluent/neubrutalism `0 0% 100%`），0/8 定义 `--palette-white`。⇒ **片 2 对它们立即生效，片 1 与它们无关。** 顺带说明五套（macos-native / fluent / neubrutalism / 以及两份 `0 0% 100%`）的卡面本来就是纯白 —— 那是它们的本色，**不要**建议用户跟着改。
- **不动 `--code-block-bg`（浅色 = `var(--palette-white)`）**：代码块面板与本方案同族，但用户未报，且它被 `code-block-surface.spec.ts` 与 B1b 的决策链拴住 ⇒ **记为已知边界，不在本片**。
- **`BASE_PAIR_COLORS` 的 `--card` 手抄副本，是 `--palette-sand-25` 基座值的镜像锚点**（二审 Pi 提醒）：`userThemeContrast.ts:107` 的 `light['--card']: '0 0% 100%'` 是**字面副本**，靠 `contrast.spec.ts:156-160` 与样式表对齐。片 1 后它**不用改**（解析值仍是 `0 0% 100%`），但若将来基座卡面基色不再是纯白（比如基座自己想给卡面加一丝暖色），**先红的会是这个副本**，而报错信息指向"浏览器与算术不一致"而非"有人改了卡面基色" ⇒ 改基座卡面基色时须同步此处。

---

## 8. 执行顺序与提交切分

| 步 | 内容 | 依赖 | 视觉变更 |
|---|---|---|---|
| 0 | 与并存线对齐三处吸顶条（D7） | — | 无 |
| 1 | **片 1 契约**：改 `theme-overlays.spec.ts` 的 `cardMoves`(③) + 两处注释(①②) + `fixed` 补 `--palette-white`(④)；先跑一次看红（预期多套 `cardMoves` 红） | — | 无 |
| 2 | **片 1 取值**：基座 `--palette-sand-25` + `--card`/`--popover` 改指；9 套覆盖层各一行 | 步 1 | **有**（切主题时） |
| 3 | 片 1 验证：`token-baseline` +2、`contrast.spec`（12 配对）、真机九套截图 | 步 2 | — |
| 4 | **片 2 改码**：43 站 → `bg-card` / `bg-popover`，保留 `dark:` | 步 3（否则内置主题下无收益） | **无**（出厂解析色值不变，class 串会变） |
| 5 | 片 2 记账：守恒律四桶 → 逐桶核对再重生成（预期 `total` **−43** / `bg: white` 44→**6**，见 §6.1） | 步 4 | — |
| 6 | 新守卫（D4，可选） | 步 4 | 无 |
| 7 | 回写设计文档（`CloudCLI主题与配色体系设计方案.md` 的 `cardSurface` 条款、README、切片表） | 全部 | — |

**提交建议**：步 1~3 一个提交（"契约 + 取值"，附对比度表与截图），步 4~5 一个提交（"43 处接线"），步 6 独立。**不要把片 1 与片 2 合成一个提交** —— 片 2 的零回归论证依赖"片 1 已就位"，分开才能在出问题时各自回退。

**片 2 的替换纪律**（一审 Pi 建议，降低 diff 噪声）：

- **逐文件精确替换，不用全局 `sed`** —— 否则会误伤 §4.3 的 7 处符号白与 2 处"单独议"站点。
- **保留透明度变体**：`bg-card/50`、`bg-card/60` 等后缀原样带上（M7 是它的证伪用例）。
- 替换后部分 `className` 会超长，**顺手按 Prettier 断行**，别把格式噪声混进功能性 diff。
- **D6 回调 #6 时**：`QuickSettingsHandle.tsx:66` 当前已是 `bg-card`（并含 `hover:bg-n-gray-100 dark:hover:bg-n-gray-700`）—— 回调只补回 `dark:bg-n-gray-800`，**不要动 hover 半边**。

---

## 9. 待审批决策项

> 每条都给了本方案的默认取值；审批者只需对"不同意"的条目回话。

| ID | 决策 | 本方案默认 | 备选 / 代价 |
|---|---|---|---|
| **D1** | **片 1 是否做、用哪个口径**（§5.3 的路线 A/B/C） | **路线 B**：做，口径甲（L = 页+4、S 半减） | A＝不做片 1（切内置主题仍是白）；C＝同批处理文字侧（AA 全绿，范围扩到 ~95 处或动兼容阶）。**⚠️ D1 与 D8 必须一并裁定**（一审两方独立指出：D8 原版默认会让路线 B 落地即红，§5.3 已写"守卫缺口另立一片"，两者须对齐）。**二审 Pi + Codex 各自独立裁定均维持 B**（附带修正：§5.2 失守集成员已更正，总数仍 4/9；若产品有 AA 硬门槛则只能改选 C） |
| **D2** | 新 L1 档的**名字** | `--palette-sand-25`（随 sand 家族被覆盖层整体重铺，覆盖层侧心智负担最小；一审 Pi 亦倾向此） | `--palette-paper`（按角色命名，与 `--palette-white`/`black` 同构，但要求每套覆盖层新增一个独立家族名）。**无论取哪个名字**：新档的取值注释须与各覆盖层 sand 块既有的"刻意把浅色基材饱和度压到基座水平"口径衔接，否则家族内出现两种饱和度策略而无解释 |
| **D3** | `cc-ocean`（`accent`）**保持纯白卡面** | 保持（徽标承诺） | 改 `cc-ocean` 的 `coverage` ⇒ 徽标语义被改写 |
| **D4** | 是否同批**新增守卫**"语义面不得读 `n-white`" | 做；形态＝**逐文件计数断言**（不锚行号，随守恒律风格），含 7 处符号白期望表 + 非空断言 | 不做 ⇒ 同一处接线错误可被重犯 |
| **D5** | 43 站的**深色半边**要不要也归 `--card` | **不做**（出厂零回归） | 做 ⇒ 43 站在所有主题 + 出厂下深色全变（`#1f2937`→`#1f1f1f`），需重验深色对比度 |
| **D6** | 已提交的 #6（改了**两态**）要不要**回调**成 `bg-card dark:bg-n-gray-800` | 回调（与片 2 同族口径） | 不回调 ⇒ ⑥ 与其余 43 站口径不一致，记账时要分开说明 |
| **D7** | 三处吸顶条与并存线的关系 | **裁定（2026-10-02，用户）＝ A 案：纳入片 2，与那条线对齐后一并做**；提交时 hunk 不可分离，已在 2-U 记录单独记账 | 或把这三处**排除**出片 2、另立一片（B 案，未被采纳） |
| **D8** | 如何守住"`n-*` 文字压在语义面上"这个盲区（§5.2 第 2 点） | **不进 `CONTRAST_PAIRS`** —— 它是 `min: 4.5` 的**阻断式**硬阈值（`contrast.spec.ts:120-125` `expect(failures).toEqual([])`），加进去会让路线 B **落地即红**；且新增 pair 还会触发 `BASE_PAIR_COLORS`（`:156-160`）与 fixture `PROBES` 的 unprobed 检查，**不止加一行**。⇒ 改为**另立一片独立记账**（不属本方案范围）：用"快照式"记录逐套读数、只在数值漂移时改红，不设 AA 阈值 | 强行加进 `CONTRAST_PAIRS` ⇒ 与路线 B 互相拆台（现有 spec 全是硬断言，**没有 warn-only 通道**） |
| **D9** | `MermaidDiagram` / `CodeEditorSurface` 两处的归属 | 不进本片，单独取证 | 一并做（需先确认 Mermaid 的注入路径） |
| **D10** | 是否为 `--palette-white` 新增**显式禁移断言**（§6.5④） | **做**（并入 `fixed`）。但**定性经实测更正**：两审称"误染它会静默漏检"，实测不成立（`--n-white` 的解析值读它、且已冻结，仍会红）⇒ ④ 是**硬化**（直接命名 ＋ 与 `--n-white` 的实现解耦），不是堵一个正在漏的口子。见 §6.5④ 的 ⚠️ 实施更正 | 不做 ⇒ 保证隐式依赖 `--n-white` 今天的实现；一旦它改指别的档位，同一变异才会真的静默 |

---

## 附录 A：证据来源一览

| 结论 | 取证方式 |
|---|---|
| 9 套覆盖层的 `--card` 浅色解析值 | 真引擎逐主题读 `getComputedStyle(html).getPropertyValue('--card')` + 真 Tailwind 类 `bg-card` 的 `backgroundColor` 双路对照 |
| 基座 `--card` ≡ `--n-white` | `src/index.css:206` / `:309` 同指 `--palette-white`；真引擎实测两者均 `#ffffff` |
| 覆盖层从不声明 `--palette-white` | `grep -n '--palette-white' src/index.css` → 命中全在 `:root` 块内（`:58`），10 个 `[data-theme]` 块内 0 处 |
| `cardMoves` 钉住浅色卡 | `tests/theme-tokens/theme-overlays.spec.ts:467`（行为）＋ `:465-466`（与之配套的两行注释，§6.5 改动落点②）；`:103-107`（`cardSurface` 说明注释，落点①） |
| `CONTRAST_PAIRS` 是**阻断式**（D8 的约束） | `contrast.spec.ts:125`（`expect(failures).toEqual([])`）、`userThemeContrast.ts:67-87`（全部 `min: 4.5`）、`contrast.spec.ts:156-160`（`BASE_PAIR_COLORS` 的 unprobed 检查） |
| `--n-white` 冻结、`--n-gray-*` 可染 | `theme-overlays.spec.ts:163` / `:134-147` |
| 非 `--palette-*` 不得写字面色 | `token-contract.spec.ts:155-182`（豁免名单 `:162-171`） |
| 覆盖层只能重声明基座已声明的 token（**实为空转**） | `theme-overlays.spec.ts:419-438` + `tests/theme-tokens/main.ts:23` / `:169-177` / `:521-528` |
| `derivedMoves` 的 `''.includes` 陷阱 | `theme-overlays.spec.ts:305-317` + `:291-293` |
| `derivedMoves` 字面匹配会**放行 `--palette-white`**（二审两方独立指出） | `theme-overlays.spec.ts:305-317`（`allowed` 收集规则＝`value.includes(baseValue)`）、`:163`（`fixed` 不含 `--palette-white`）、`:474-477`（`mustNotMove` 不过 `allowed`，故现名单拦不住） |
| §5.2 失守集与逐套读数（**二审更正**） | 用 `userThemeContrast.ts:156-199` 同一算法逐套复算；**白卡列 4.80~4.84 与 §5.1 逐字吻合**（自校准），据此把 dracula 从 4.10 更正为 4.65（过 AA） |
| 43（片 2 改动）/ 45 / 7 / 52 的精确分桶（45 含 2 个单独立项） | `src/shared/tests/theme-atom-conservation.json` 的 `byUsage` + 逐行 `grep -n bg-n-white` |
| 对比度全部读数 | 复用 `src/shared/userThemeContrast.ts:156-199` 的同一套纯函数（HSL → 8 位取整 → WCAG），与 `contrast.spec.ts` 的浏览器读数同口径 |
| 200ms 过渡导致的假读数 | `tests/theme-tokens/README.md:164-170`；本次探针第一版实测复现 |
| 既有裁定 | `docs/research/CloudCLI用户主题升内置方案.md:647-652`（§10.4）、`:660-670`（§10.6） |

## 附录 B：本方案**没有**做的事（防误读）

- 没有声称"深色外观也白"——实测深色跟主题（§2.3）。
- 没有把"用户报告 7 处"当成全貌——真正的暴露面是 52 站（§1.4）。
- 没有提议"改内置主题的契约去适配组件"——方向相反：**让表面读语义令牌**（收敛），而不是放宽契约（发散）。唯一必须放宽的是 `cardMoves` 里"浅色卡面禁移"这一条。
- 没有把 §10.4 的裁定说成"错了"——它担心的代价是真的，本方案只是把它算成了数字，并给出取舍。

---

## 审阅批注

### Codex

> [!WARNING] §5.3 将路线 B 定为推荐，但 §9 的 D8 又建议把 `n-gray-500 on --card` 加入 `CONTRAST_PAIRS`。该列表由 `contrast.spec.ts` 按 `min: 4.5` 阻断校验，而路线 B 表中有四套主题只有 3.77–4.44；照此执行会让主题契约测试失败，与“接受低于 AA”的路线 B 相冲突。建议审批时明确二选一：路线 C 并维持 4.5 的阻断阈值；或保留路线 B，但把这组读数作为明确标注的非阻断风险探针，避免把它混入严格 AA 契约或暗中降低阈值。

> [!IMPORTANT] §4.3 的“逐字节不变”不成立：由 `bg-n-white` 改成 `bg-card` 后，组件 class 与构建产物选择器都会变化；当前论证能支持的是基座下底色解析值相同、预期视觉不变。建议统一改成“计算色值/视觉零回归”，并让 §6.7 的截图核验覆盖代表性的半透明、popover 和普通卡面用例，避免把令牌同值等同于所有渲染结果逐字节一致。

> [!NOTE] §0/§2.4 写“工作区当前只有 #6 那处一行改动”，但 §6.8 又称“工作区当前为多线并存态”；当前仓库状态也确有多处其他未提交改动。建议将前者改成有日期或基准提交的方案快照，并在开工门槛中明确基线比较对象及如何隔离无关变更，避免把并行改动误算进本方案的测试基线与提交范围。

### OpenCode

> [!CAUTION] **方案状态已与仓库实况脱节——片 1、片 2 均已落地并提交。** 文档头部仍写「状态：待审批。尚未写代码」，§9 的 D1/D2/D3/D6/D7 也仍是「待决」，但实核：片 1 = `a1eab8ef`（2026-10-02 22:15:24），片 2 = `0a43bbad`（同日 22:15:34）。落地证据：`src/index.css:67` 已有 `--palette-sand-25: 0 0% 100%`，`:212/:214` 的 `--card`/`--popover` 已改指它，9 套覆盖层声明在 `:1610/:1816/:2073/:2379/:2629/:2875/:3129/:3351/:3574`；`theme-overlays.spec.ts:490` 的 `cardMoves` 已是 `coverage === 'full'`；守恒律已重生成（当前 `total 1518`）。因此本轮的「审阅」实质上是对**已实施切片**的复盘。建议牵头 harness 先把状态行与 §2.1/§3/§6.8 的时点读数改成带提交哈希的快照（或直接转为「已收口」档），否则后续维护者会按「未开工」误读，而 §3 契约全图里 `fixed`、`--card` 指向、`--n-white` 冻结等条目均已过时。

> [!WARNING] **D8 未落地，Codex 指出的冲突已从「预期」变为「既成事实」，我复核了阻断链路。** 实核 `src/shared/userThemeContrast.ts:67-88`：`CONTRAST_PAIRS` 仍是 12 对，**没有** `n-gray-500 on --card`；而 `tests/theme-tokens/contrast.spec.ts` 会读取每对的 `min` 并断言 `failures` 为空（**阻断**，不是 warning——尽管 `userThemeContrast.ts` 顶部注释说同一列表还喂给一个非阻断的用户主题告警）。⇒ 若按 §9 D8 默认值「是（至少加 `n-gray-500 on --card`）」把该对以 `min: 4.5` 塞进 `CONTRAST_PAIRS`，片 1 已上线的 4 套（islands/dracula/gruvbox/kanagawa）会在 `contrast.spec` 直接亮红，与路线 B「接受低于 AA、如实记账」自相矛盾。建议二选一写进决策档：① 该对只作**独立非阻断探针**（不进 `CONTRAST_PAIRS`）；② 确认走路线 C 再纳入阻断列表。

> [!IMPORTANT] **§6.1 的预期表与已实施结果不符，根因是 D9 的两处「单独议」未计入。** §1.4/§2.3 口径 52 站 = 45 面 + 7 符号；但 §4.3 把 `MermaidDiagram.tsx:78`、`CodeEditorSurface.tsx:62` 列为「不进本片」，实际提交（`0a43bbad`）也只转了 **43 站**。由此：`bg: white` 桶实际 44→**6**（4 个符号 + 2 个待议面），而非 §6.1 写的 →4；`total` 实际 1562→**1518**，而非 §6.1 写的 1560→1515。建议把 §6.1 的「预期」换算为「已落地」并补上 2 处待议面这一差项，否则下一轮照表核对会平白多出红。

> [!NOTE] **D4 守卫已落地，且实现比方案建议更稳——正文应改写为实际形态。** `src/shared/tests/semanticSurfaceTokens.test.ts` 已存在，按**文件级**计数（非 §6.5 建议的「文件:行」），带非空断言（扫不到 `n-white` 会红、空表会红），并把 MermaidDiagram / CodeEditorSurface 两处待议面显式列入表内。当前 `src/` 残留的 `bg-n-white` 恰为这 9 个文件 / 10 处出现，与守卫表一致。建议 §6.5/§9 D4 按此实现描述，删掉「行号白名单」的脆弱写法。

> [!NOTE] **实际提交对契约做了方案未记录的补强：`--palette-white` 已并入 `fixed`。** §3 契约表把 `fixed` 记为「否（本方案的关键设计点）」，§6.5 也只改 `cardMoves`；但 `a1eab8ef` 把 `--palette-white` 加进了 `fixed`（现为 `['--palette-white','--n-white','--n-black']`）。这恰是 §6.6-1 精神的具体化：把 `derivedMoves` 子串匹配带来的隐式依赖升级为具名契约。方向正确，但正文与代码现已不一致，建议 §3/§6.5 补记。

> [!TIP] **代码整洁/优雅维度（按点名的方向）：** ① 片 2 落成后是「浅色读语义令牌、深色读兼容阶」的两轨制（`bg-card dark:bg-n-gray-800`），同一组件两半挂两条轨道——方案以零回归论证保留成立，但建议给 D5 补一个**触发条件或后续切片**（例如「下次任何主题需要调整深色浮层层次时一并归一」），否则两轨制会长期固化，每个后来者都要重读 §4.3 才敢碰这些类名。② §4.3 的手工「文件:行」清单我已抽查核对（命中齐全），但行号清单必然随无关编辑漂移；D4 守卫已改用文件级计数，建议正文同样把该清单降级为「快照参考」，执行以 `rg -n 'bg-n-white' src --glob '!**/tests/**'` 现场派生为准。③ 9 套覆盖层各补一行 `--palette-sand-25` 是既有「每套主题声明自己 L1」模式，符合架构，无需为「看似重复」而抽象。

> [!NOTE] **正面确认：§4.2 的口径甲取值与实现逐字节一致。** polar `213 13% 98%`、catppuccin `220 11.54% 98%`、islands `228 6.41% 96.35%`、onedark 与 onedark-vivid `220 6.5% 98%`、dracula `48 29% 98%`、gruvbox `48.46 11% 92.24%`、kanagawa `53.33 12.5% 88.31%`、tokyo-night `230 5.55% 93.41%`——与 `src/index.css` 中 9 处声明实核一致。§5 的对比度读数我也按 `userThemeContrast` 同算法复核了基座项（纯白 vs `--palette-gray-500`，`220 8.9% 46.1%`→`#6b7280`，≈4.83，落在表中 4.80~4.84 区间），测算口径可信。

### Pi · `01a0fb0a-c102-776b-a3d1-a363bbf81a85`

> [!WARNING] D1 与 D8 的联动冲突有独立实证，且 D8 的默认值会让路线 B **落地即红**：`contrast.spec.ts:110` 对每套覆盖层断言 `expect(failures).toEqual([])`，`CONTRAST_PAIRS` 全部带 `min: 4.5` 硬阈值；且新增 pair 还会触发 `contrast.spec.ts:156-160` 的 unprobed 检查，要求 `BASE_PAIR_COLORS` 同步具备该 token——D8 不止“加一行”。若审批者选路线 B，D8 必须显式降级为**非阻断记录**，而这需要新机制（现有 spec 风格全是硬断言，没有 warn-only 通道）。建议在 §9 的 D8 行直接写明实现形态（独立 test、failures 之外的输出通道），否则执行者按字面把 `n-gray-500 on --card` 加进 `CONTRAST_PAIRS` 就会与路线 B 互相拆台。

> [!IMPORTANT] §6.5 的契约改动清单**漏了一处注释**：`theme-overlays.spec.ts:464-466`，`cardMoves` 上方两行行内注释——"The card surface only enters a theme's reach in the dark appearance — its light half comes from `--palette-white`, which no theme overrides."——不在“:103-107 整体重写 + :467”的范围内。只改 §6.5 点名的两处，这段注释会与 `cardMoves = full` 的新行为直接矛盾，误导下一个读者。建议把 §6.5 的改动落点写成“:103-107、:464-466、:467 三处”。

> [!TIP] D4 守卫建议不要用“文件：行”显式清单做白名单：行号锚点极脆，任何无关改动插一行就红，会制造“为绿测试而改测试”的压力。仓库既有风格（守恒律）是**按桶计数、不锚行号**，建议白名单记 文件 + 期望计数（或文件内禁用模式 + 计数断言），形态更稳、维护成本更低，同样能防“同一接线错误被重犯”。

> [!NOTE] D2 命名：两案机制等价（都要求基座先声明，见 §6.6-1），但 `sand-25` 天然随 sand 家族被覆盖层整体重铺，覆盖层侧心智负担最小；`paper` 则要求每套覆盖层新增一个独立家族名。倾向 `sand-25`。另外注意各覆盖层的 sand 块注释已声明“刻意把浅色基材饱和度压到基座水平”（如 `cc-gruvbox` 块注释），新增档的取值注释要与这个既有口径衔接，否则家族内出现两种饱和度策略却无解释。

> [!TIP] 片 2 的 45 站替换关系到 diff 的整洁：建议逐文件精确替换而非全局 sed（避免误伤 §4.3 的 7 处符号白与 2 处单独议站点），保留 `bg-card/50`、`bg-card/60` 等透明度变体（M7 已设证伪用例）；替换后部分 `className` 会超长，顺手按 Prettier 断行，避免 lint 噪声混入功能性 diff。另外 D6 回调 #6 时注意：`QuickSettingsHandle.tsx:66` 当前值已是 `bg-card`（含 `hover:bg-n-gray-100 dark:hover:bg-n-gray-700`），回调只需补回 `dark:bg-n-gray-800`，不要动 hover 半边。

### 牵头结论

**一审 8 条批注 = 7 个独立问题（Codex#1 与 Pi#1 是同一处），全部核实属实、全部采纳。**

| # | 批注 | 来源 | 处置 | 落到哪 |
|---|---|---|---|---|
| 1 | D1↔D8 联动冲突（原版 D8 会让路线 B **落地即红**） | Codex + Pi（**两方独立**） | **采纳** | §0 顶部一句话、§5.3 路线 B 负栏、**§9 D8 默认改为"不进 `CONTRAST_PAIRS`、另立独立记账片"**、附录 A 新增证据行 |
| 2 | §4.3「逐字节不变」不成立（class 串与产物选择器都会变） | Codex | **采纳** | §4.3 全文改为"解析色值 / 视觉零回归" + 口径澄清段；§0 出厂视觉行同步 |
| 3 | §0/§2.4「只有 #6」与 §6.8「多线并存」口径不一 | Codex | **采纳** | §0 状态栏改为**快照 `e5bdac09` + 两类并存改动清单**；§2.4 标明"本方案唯一预置改动 ≠ 工作区唯一改动"；§6.8 补"基线比较对象与隔离口径" |
| 4 | §6.5 漏了 `theme-overlays.spec.ts:465-466` 的注释 | Pi | **采纳** | §6.5 改动落点写成**三处**（`:103-107` / `:465-466` / `:467`） |
| 5 | D4 守卫不要用"文件:行"白名单（行号锚点脆） | Pi | **采纳** | §6.5 与 §9 D4 改为**逐文件计数断言**（随守恒律风格、不锚行号）+ 非空断言 |
| 6 | D2 命名倾向 `sand-25` + 新增档注释须衔接既有饱和度口径 | Pi | **采纳** | §9 D2 默认设 `sand-25` 并补理由；新增"取值注释须与 sand 块既有口径衔接"要求 |
| 7 | §6.7 核验须覆盖半透明 / popover / 普通卡面 | Codex | **采纳** | §6.7 清单新增第 5 项（三类形态） |
| 8 | 片 2 替换纪律（逐文件、保透明度后缀、Prettier、D6 只补 dark） | Pi | **采纳** | §8 新增"片 2 的替换纪律"段 |

**两处需要单说**：

- **问题 1 是一审最有价值的发现，且两方独立命中** —— 它同时暴露了原稿的一处**内部矛盾**：§5.3 早写了"守卫缺口另立一片"，而 §9 D8 的默认却写"加进 `CONTRAST_PAIRS`"，二者不可能同时成立。本版以 §5.3 为准：**D8 降级为独立记账片**（快照式、只记录不设 AA 阈值），这样它既不与路线 B 打架，也不制造 warn-only 假守卫。
- **没有一条批注触及片 1 的承重机制**（新增 L1 档 + 只放宽 `cardMoves` 一层 + `token-contract` 强制走 palette 家族 + `derivedMoves` 陷阱），也**无人对 D1 路线选择本身给反面意见**。这两块是"错了就全塌"的地方，且正是拟定者最可能盲的地方 ⇒ **建议发起定向二审**，靶子只设这两个，并要求审阅者"读代码 / 推演，不再审措辞"。

**修订说明**：本次仅修订方案正文与批注区，**未动任何代码、契约或基线**；`docs/research/CloudCLI浅色表面跟随主题方案.md` 仍为未提交新增文件。

### Pi · `01a0fb0a-c102-776b-a3d1-a363bbf81a85`（二审）

> [!NOTE] **靶 1 总裁定：承重机制成立。** 逐条推演如下——① "只放开一层"成立：`--card` 改指新档后，`--card`/`--popover` 的基座解析值仍含 `0 0% 100%`，`derivedMoves` 的字面子串匹配确实会连带放行 `--palette-white`/`--n-white`（凡 base 值含 `0 0% 100%` 的 token 全部进 allowed），但 `MUST_NOT_MOVE.full = SURFACES.fixed = ['--n-white']` 是**名字级**过滤，在 `derivedMoves` 之后独立执行（`:460-490` 中 `mustNotMove` 不经过 allowed），所以 `--n-white` 被字面放行也不会漏检——机制成立但**纯属侥幸**：名字级禁移恰好叠在字面级放行之上，二者没有因果链，若未来 `fixed` 增删一个恰好含 `0 0% 100%` 的 token，这层保护无人兜底。建议在 §6.6 补一条：`fixed` 名单与 `--palette-white` 的字面耦合是隐式依赖，改动任一侧须复查另一侧。② `token-contract.spec.ts:155-182` 确实拦住覆盖层直写 `--card`：正则 `/^[ \t]*(--[a-z0-9-]+)\s*:\s*([^;{}]+);/gm` 带 `m` 标志、按行首缩进匹配**所有块**（含覆盖层），`--card` 不在豁免名单（`--editor-*`/`--code-block-bg`/`--cc-syntax-*`/`--term-font-family`），直写 HSL 三元组必红。③ `''.includes` 陷阱属实：`extractTokenNames`（`main.ts:169`）扫的是 `index.css` 全文原文而非基座解析块，覆盖层新档名会进 `tokenNames`；基座未声明时 `getComputedStyle` 返回空串，`derivedMoves` 里 `value.includes('') === true` 放行全部 token，`beyondReach` 整体失效——与文档 §6.6-1 描述一致，陷阱真实存在。④ 守恒律四桶核实：`bg: white 44 = 40面+4符号`、`bg: white/50 2`、`open]/section bg: white/50 2`、`bg: white/60 1`，合计 45，与 §4.3 清单逐项对上；`token-baseline` +2 行推演成立（`captureSnapshot` 只调 `read('light'/'dark')` 不挂 `data-theme`，覆盖层声明不进基线；基座 `.dark` 无 sand 家族镜像，故只有 `:root` 一处新声明 × 两态 = 恰好 2 条）。⑤ cc-ocean 守得住：`coverage: 'accent'`（`constants.ts:353`）⇒ `cardMoves` 为假 ⇒ `cardSurface` 落 `mustNotMove`（`:476`），它不声明 `sand-25` 就不碰卡面；且 `MUST_NOT_MOVE.accent` 本就含 `compat`+`fixed` 全量，双保险。

> [!WARNING] **§5.2 的 dracula 行两列读数均错，且与 §5.1 内部矛盾。** 我用 `userThemeContrast.ts:156-199` 同一算法独立复算：dracula 自带 `--palette-gray-500 = 231 8.9% 47.24%`（`index.css:2886`）压在口径甲卡面 `48 29% 98%`（`#fbfbf8`）上的比值是 **4.65（过 AA）**，不是文档写的 **4.10**；同一 ink 压在页面 `48 58% 96.08%` 上是 **4.54（也过 AA）**，不是文档写的 **~3.7**。这两格恰好与 gruvbox 的值相同，疑似取数时串行。内部矛盾佐证：§5.1 自己写"L=96 时 dracula 恰好 4.50"——而卡面越亮 ratio 越高，若口径甲卡面（L=98）真是 4.10，L=96（更暗）只可能更低（实测 4.498），不可能反过来升到 4.50。**影响**：路线 B 的失守集合**成员变更但总数不变**——仍是 **4/9 套**，但 dracula（实为 4.65，过）应移出，tokyo-night（4.17，不过）坐实；"要救需压暗"表里 dracula 的 2.39 应归零。顺带指出文档自身的一处小不一致：§5.2 表里 tokyo-night 的 4.17 本就低于 4.5 却未加粗，正文按加粗数说 "4/9 套"，而按表内数字实际是 5 套——修 dracula 时应一并把加粗口径统一为 "< 4.5"。这不改变路线 B 的方向性结论，但这张表是 D1 的拍板依据，必须修。

> [!IMPORTANT] **靶 2 独立裁定：维持路线 B，但理由要修正一处。** 我从三个角度独立复核了 A/B/C：① 边界"染色 vs AA 不可兼得"**算得对**——我用同一 WCAG 算法扫描了全部 9 套，AA 在口径甲卡面上失守的最深卡面是 kanagawa（L=88.31，3.77），而任何 L≥97 的染色通道差 <2% 肉眼等同白，二者的确不可兼得；§5.1 表的四个区间（纯白 4.83 / L=98 4.62~4.66 / L=96 4.40~4.51 / 口径甲 3.77~4.66）我的复算与文档一致（仅上界差 ±0.01，取整噪声）。② 路线 A 对用户的实际场景（切 gruvbox 仍白卡）确实零收益，不解决原始诉求。③ 路线 C 的两条子路径我核了真实代价：压暗 `--palette-gray-500` 会击穿 `neutralScale.test.ts:36-43` 的"基座逐档 = Tailwind 字面"断言（`declarations.get(paletteName)` 必须 `toBe(hexToHslTriplet(familyHex))`），除非同步豁免，否则测试必红；改文字侧则波及 `text-n-gray-500` 全部 74 站（其中 68 站带 `dark:` 兄弟类，形态不统一），且这些站压在卡面上的只是子集（TaskCard 6 站、AskUserQuestionPanel 8 站等），"面级修复"无法用"文字级收口"低成本替代。**结论：B 仍是正确取舍，但 §5.2 修完 dracula 后，失守集合的成员更清晰：dracula 实际过 AA（4.65）应移出，tokyo-night（4.17）坐实，总数仍 4/9**——路线 B 的实际代价与文档声称的量级一致，只是风险分布不同。唯一保留意见：若审批者在意"主题作者的原始观感"，口径乙（保 S）与甲的差异确实极小（gruvbox `#f0eee7` vs `#edede9`，我复算确认），D1 里甲/乙的选择可以放心交给审美偏好，不构成风险分叉。

> [!NOTE] **一处未雨绸缪（不阻断）**：片 1 落地后，`--card` 基座值从 `var(--palette-white)` 变为 `var(--palette-sand-25)`，`BASE_PAIR_COLORS`（`userThemeContrast.ts:110`）里 `light['--card']: '0 0% 100%'` 是**手抄的字面副本**，靠 `contrast.spec.ts:156-160` 与样式表对齐——这个副本不用改（解析值仍是 `0 0% 100%`），但它是一个"改了引用、没改副本也照样绿"的盲区：如果未来 `sand-25` 基座值不再是纯白（比如基座自身想给卡面加一丝暖色），副本会先红、报错信息却指向"浏览器与算术不一致"而非"有人改了卡面基色"，排查路径偏长。建议在 §7 范围边界的"不动 `--code-block-bg`"条目旁补一句：`BASE_PAIR_COLORS` 对 `--card` 的手抄副本是 sand-25 基座值的镜像锚点，改基座卡面基色时须同步。

### Codex（二审）

> [!WARNING] **§4.1 / §6.5：基于代码的独立裁定是“卡面机制可行，但守卫不是严格的一层隔离”。** 新增基座 `--palette-sand-25: 0 0% 100%` 并令 `--card`、`--popover` 指向它后，full 主题声明新档即可让 `cardMoves = full` 在浅色通过；字面契约确实不允许覆盖层直写 `--card`。但 `derivedMoves` 不按依赖边界推导：它会把基座解析值包含 `0 0% 100%` 的**所有** token 加入 `allowed`，其中包括 `--palette-white`。后续 `mustNotMove` 只冻结 `--n-white` / `--n-black`，不冻结 `--palette-white`，所以若某个 full 覆盖层误把 `--palette-white` 一并染色，该变化既可能不进 `beyondReach`，也不会命中 `mustNotMove`；“不撬动白色底层”的保证目前依赖覆盖层恰好不写它，而非测试明确守住。建议在主题覆盖层契约中增加对 `--palette-white` 不移动的显式断言（或令 `derivedMoves` 只放行声明 token 及明确依赖者），这样“只放开卡面一层”才是可回归的契约，而不仅是当前样式表的事实。其余检查我复核通过：`cc-ocean` 为 `accent` 且未声明新档时卡面仍由 `mustNotMove` 守住；`token-contract.spec.ts:155-182` 会拦 `--card` 的字面直写；基座缺新档时 `''.includes('')` 确实使 `beyondReach` 失效；新基座声明使 light/dark 快照各多一个键（+2 行）成立；守恒律四桶计数及 §6.3 的九行对比度表均与现有数据/真实主题 fixture 读数相符。

> [!IMPORTANT] **§5：独立路线裁定为 B，而不是 C；“染色与 AA 不可兼得”在本方案给定口径下成立，但 B 必须被视为有意识接受已知 AA 缺口。** §6.3 的前景与语义次级文字对口径甲卡面的读数我用 Playwright fixture 逐主题重读，表值一致；它不能替代 §5 所讨论的 `n-gray-500` 兼容阶。路线 B 的关键事实不是“4 套新近变差”：这四套的 `n-gray-500` 在原纯白卡面上本来就低于 4.5，候选染色卡面反而提高对比度，只是仍未达到 AA；若产品把小号次级文字 4.5:1 定为硬性发布门槛，应选 C，否则 B 在保持既有中性色阶契约、避免把全局文字样式改写成语义令牌的前提下，是范围更小且改善而不回退的取舍。故我不建议为追求测试全绿而改 `--palette-gray-500` 或批量替换 `text-n-gray-500`；应把残余低于 AA 明确记为非阻断的已知风险。若产品确有 AA 硬门槛，则不能以“这些字原先也不达标”豁免，必须改选 C 并承担其文字侧范围。

### 牵头结论（二审）

**二审 Pi 4 条 + Codex 2 条，逐条核实后处置如下。**

| # | 批注 | 来源 | 处置 | 落点 |
|---|---|---|---|---|
| 1 | `derivedMoves` 字面匹配会放行 `--palette-white`（"只放开一层"在**守卫层面**不成立，当前靠侥幸） | **Pi + Codex 两方独立** | **采纳** | §4.1① 加"但"段；§3 表 `fixed` / `MUST_NOT_MOVE` / `derivedMoves` 三行改判；**§6.5④ 把 `--palette-white` 并入 `fixed`**；§6.6 新增陷阱 3；§6.9 新增 M9/M10；§7 首条改写；§9 新增 **D10** |
| 2 | §5.2 dracula 行两列读数均错、且与 §5.1 内部矛盾 | Pi | **采纳（已独立复算证实）** | §5.2 表整体重算 + 加粗口径统一为 "< 4.5" + 加更正说明；dracula 移出失守集（总数仍 4/9） |
| 3 | 靶 2 独立裁定：维持路线 B | Pi + Codex | **采纳** | §9 D1 备注补记；§5.3 推荐理由第 2 条改述（不再说"保住冻结"，改为"不动声明 + 新增断言"） |
| 4 | `BASE_PAIR_COLORS` 的 `--card` 手抄副本是基座卡面基色的镜像锚点 | Pi | **采纳** | §7 新增一条 |
| 5 | "若产品有 AA 硬门槛，不能以'原先也不达标'豁免，必须改选 C" | Codex | **采纳** | §5.2 第 1 点加 ⚠️ 段 |
| 6 | Codex#2 的事实前提"这四套在白卡上本就低于 4.5" | Codex | **不采纳该前提**（独立复算：白卡上全部 4.80~4.84，达标）；其**结论**（维持 B、记为非阻断）成立 | 已在 §5.2 更正说明中如实记录 |

> **#6 的论证也须一并更正（2026-10-02 牵头追加）**：Codex#2 不只是"前提有误、结论恰对"—— 它据此把路线 B 定性为"**改善而不回退**的取舍"，而这句定性按其自己的读数也不成立：白卡上 `n-gray-500` 4.80~4.84 **达标**，候选卡面 4.10~4.44 **失守** ⇒ 就"面上次级文字是否过 AA"这一条而言，B **是回退**（尽管仍高于各套自己的页面、且只是取消一个既有例外）。**B 的裁定不变**，但理由须采 §5.2 第 1 点的表述（"取消一个例外" ≠ "不回退"），不得沿用"改善而不回退"。

**靶 1 结论（二审的核心价值）**：片 1 机制**成立**——`cardMoves` 只放开一层足够、`token-contract.spec.ts:155-182` 确实拦住覆盖层直写 `--card`、`''.includes` 陷阱属实、守恒律四桶与 `token-baseline +2` 均被核实、`cc-ocean` 守得住。**但发现一处真实的守卫缺口**：新档基座值恰为 `0 0% 100%`，`derivedMoves` 的字面子串匹配会把同值的 `--palette-white` 一并放行，而它不在任何禁移名单（`fixed` 只有 `--n-white`/`--n-black`）⇒ 覆盖层若误染 `--palette-white` 会**静默漏检**。**这正是本方案"错了就全塌"的承重处 —— 一审零覆盖，二审两方独立命中并给出可执行补丁。** 已落成 §6.5④ + M9/M10。
>
> **⚠️ 本段的"静默漏检"半句已由实施实测推翻**（`derivedMoves` 放行它属实，但误染会被 `--n-white` 抓住）——见文末 **「实施更正（2026-10-02）」第 1 条**与 §4.1① / §6.5④ / §9 D10 的就地更正。

> 方法论记一笔：二审要求"读代码 / 推演、不审措辞"是有效的 —— 两方都真的去读了 `derivedMoves` 的实现并推出连锁，产出了一审完全没碰的机制级发现；其中一条（dracula）还是靠"§5.1 与 §5.2 自相矛盾"这条线索被顺出来的。

**本次修订说明**：改动落在方案正文（§3 / §4.1 / §5.2 / §5.3 / §6.5 / §6.6 / §6.9 / §7 / §8 / §9 / 附录 A）与批注区；**未动任何代码、契约或基线**。二审批注原文一字未改。

**第三轮收口说明（2026-10-02，牵头自查，无新增外部审阅）**：本轮只处置两处**两审都未覆盖**的遗留：

1. **45 → 43 的实质矛盾（数字级，会影响实施）**：§2.3 数出 45 个"面"，但其中 `MermaidDiagram` / `CodeEditorSurface` 两站**单独立项、不进片 2** ⇒ 片 2 实际改动是 **43 站**。原稿 §4.3 标题 / §6.1 预期 / §8 步 4 却都写"45"，且 §6.1 的守恒律预期（`bg: white` 44→4、`total` −45）**隐含把这两站算作"要改"** —— 与 §4.3 / §8 明令"不动这 2 站"直接冲突。后果是硬性的：按原稿核对，实测的 −43 会被读成"漏做 2 处"，或诱使执行者去改那 2 站。**更正落点**：§2.3 加注、§4.3 标题与正文、§6.1 桶表（`bg: white` 44→**6**、`total` 1560→**1517**、−**43**）并新增"核对判据"段、§6.7、§8 步 4/5 与提交建议、D5/D6、附录 A。**此后"45"只保留 §2.3 的分类含义（"面"的总数），凡"片 2 改动数 / 守恒律预期"一律用 43。**
2. **Codex#2 的定性更正**：见上方 `### 牵头结论（二审）` 表格后的追加段 —— 其"改善而不回退"的定性不成立（就"面上 `n-gray-500` 过 AA"而言是**回退**），裁定（维持 B）不变。

**遗留冲突盘点（供后续参考）**：两轮审阅者之间 **0 分歧**；牵头与审阅者之间 **1 处、已裁定**（Codex#2，即第 2 条）。其余 D 系列条目均为"待审批的默认值"或"已明确记录的推迟项"（D3 / D7 / D8 / D9），不属未统一项。

### 实施更正（2026-10-02，实施时实测）

本片实施时对两处**从未被实测过**的论述做了第一手复核，结果如下 —— 它们都只改**定性 / 措辞**，不改裁定：

1. **D10 的"静默漏检"不成立（二审两方独立推错的一步）。** §4.1① / §6.5④ 原写：把 `--palette-white` 并入 `fixed` 是"堵上一个正在漏的口子"。实测**撤掉该补丁后同一变异仍然红**：让 `cc-gruvbox` 声明 `--palette-white: 231 8.9% 47.24%`（`fixed` 撤回 `['--n-white','--n-black']`），`mustNotMove` 落在 **`--n-white`** 上（chromium / webkit 各 1 条）——因为 `--n-white` 的解析值**读的正是 `--palette-white`**，而该断言比的是解析值。带补丁时同样红，只是名单里多出 `--palette-white` 本身。⇒ **裁定不变（D10 照做）**，但定性由"堵漏"改为**硬化**：它把一个**隐式依赖**（保证凑巧由 `--n-white` 今天的实现提供）换成**直接、具名**的断言；若将来 `--n-white` 改指别的档位，旧写法才会真的静默。**两审的真实贡献是"`derivedMoves` 会放行 `--palette-white`"这半句（属实），错的是"因此静默"那半句。**
   > 方法记一笔：这条只有**跑变异**才能判出来 —— 两审都只做了静态推演（"它不在名单里"），没人去问"那它的消费者在不在名单里"。与"审阅者给的数字/前提也要自己复算"同族。
2. **D6 的算术缺口**（实施时发现，已在本轮修正）：§6.1 原把 `dark bg: gray-800` 写成"不动"、`total` 写成 1517，与 D6 的默认取值（**回调**）自相矛盾。D6 要把 #6 去掉的 `dark:bg-n-gray-800` 补回来 ⇒ 该桶 `56 → 57`、`total` 落在 **1518**。实施时实测恰好 **5 个桶**、一处不多不少（§6.1 已更正并加了"若读到 1517 / 56 说明 D6 没做"的判据）。

**本片实施结果**（完整记录见《CloudCLI 主题与配色体系设计方案》§6 的 **2-U 实施记录**）：片 1 ＋ 片 2（43 站，含 D7 判的 4 站）＋ D4 守卫 ＋ D6 回调全部落地；`test:theme-tokens` 200/0、`test:client` 156 文件 / 1286 用例全绿（A/B 定量：本片 +1 文件 / +1 用例）、`typecheck` / `typecheck:theme-tokens` / `build` exit 0、`lint` 0 error、`token-baseline` +2 行、守恒律 `total` **1518**；真机三类形态（实心 / 半透明 / 浮层）在 `cc-gruvbox` / `cc-kanagawa` 浅色下全部跟色，出厂外观逐通道不变。
