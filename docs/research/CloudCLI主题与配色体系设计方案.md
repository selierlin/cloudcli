# CloudCLI 主题与配色体系设计方案

> 编写日期：2026-09-24 ｜ 修订：2026-09-25（v5：阶段 0-A / 0-B / 0-C 已实施并验收，记录见 §6）
> 状态：**已定稿并正在实施**（§8 无遗留待定项；阶段 0 已完成 0-A / 0-B / 0-C / 0-D / 0-E0 / 0-E1 / 0-E1b / 0-E2a / 0-E2b / 0-E2c / 0-E2d / 0-E2e / 0-E2f / 0-E2g / 0-E2h / 0-E2i / 0-E2j / 0-E2k / 0-E2l / 0-E2m / 0-E2n / 0-E2o / 0-E2p / 0-E2q / 0-E2r / 0-E2s / 0-E2t / 0-E2u / 0-E2v / 0-E2w / 0-E2x / 0-E2y / 0-E2z / 0-E3a / 0-E3b / 0-E3c / 0-E3d / 0-E3e / 0-E3f / 0-E3g / 0-E3h / 0-E3i / 0-E3j / 0-E3k / 0-E3l / 0-E3m / 0-E3n / 0-E3o / 0-E3p / 0-E3q 五十片，其余分片待做；0-E2 暴露的护栏缺口已由 0-E2c 的守恒律闭合，0-E2d 是第一个在"双绿"门槛下通过的迁移片，0-E2e 闭合了扫描器的**覆盖面缺口**——轴限定中性色此前完全不在任何护栏视野内；0-E3i 修正了产物核对脚本的**前提假设缺口**——脚本原假设"被测文件迁移前不含 `n-*` 令牌"，随分片推进（前片已令牌化的文件被再次触碰）必然被打破。截至 0-E3q：中性具名硬编码剩余 **252 处 / 65 文件**（起点 1517 / 105））
> 参照物：WorkBuddy（`/Applications/WorkBuddy.app`，app.asar 解包 + 本机皮肤包实物）、Codex CLI（`@openai/codex@0.155.1`，Rust 二进制字符串解析）
> 目标读者：评审 AI / 后续实施者

---

## 0. 结论先行

1. **cloudcli 现在只有"明暗模式"，没有"主题"这个概念。** `src/index.css` 有 44 个令牌，但界面样式的**主路径不是令牌**：实测 TSX/TS 中 Tailwind 具名色原子类（`bg-gray-900` 等）约 **3227 处**，反而多于语义令牌类（约 2498 处），另有终端 / 编辑器 / 语法高亮 / Git 图各自硬编码。换肤时这些面必然不跟随。
   > v2 修正：初稿"主 UI 已令牌化、绝大部分自动跟随"的判断被三方审计推翻，见 §1.2 #10 / #11 与 §1.3。
   > v5 状态：0-A / 0-B / 0-C 之后，`index.css` 共声明 **109** 个自定义属性（39 palette + 26 终端 + 44 其他）；**终端与语法高亮两条路径已令牌化**，编辑器与 Git 图仍待做。§1.2 的表已按片更新状态。
2. **两个参照物是两种哲学**：
   - **WorkBuddy = 云端皮肤包**：主题是"带元数据的云资源"（后端目录 + zip 包 + VIP 分级 + 有效期 + CDN 白名单），重，但适合商业化运营。
   - **Codex = 文件即主题**：主题是"放进目录的一个文件"（`.tmTheme`，Sublime/TextMate 标准格式），零后端，直接吃到现成主题生态。
3. **推荐采用 Codex 式模型**（文件/数据即主题），并借用 WorkBuddy 的**令牌分层**与**包契约安全约束**。理由见 §3.3。
4. 回答"新增主题/皮肤是不是更优雅的配置"：**是**。采用该模型后，新增一套主题从"改代码 + 发版"降级为"加一个文件"，且不需要后端配合。这是本方案的核心价值。
5. **落地口径已在 v3 定稿**（三方评审 + 两轮拍板，§8 无待定项）：阶段 0 按**七片文件集群**推进、以**机器可校验豁免清单**与 **DoD 三件套**（grep 清零 / 视觉基线阈值 0 / 计算值等值断言）验收；`dark:` 走**三分法**而非二选一；`--cc-syntax-N` 本轮不升语义名、只加映射快照与 denylist 护栏。首片（0-A：palette + L2 引用改写）可立即开工。

---

## 1. cloudcli 现状排查

### 1.1 已有资产（可复用）

| 资产 | 位置 | 评价 |
|---|---|---|
| 语义令牌 + 明暗两套值 | `src/index.css:45-239`（`:root` / `.dark`） | shadcn 风格 HSL 三元组，结构正确；0-A 后全部颜色类令牌已引用 palette 层，0-C 又为终端补了 `--palette-term-*` / `--term-*`（终端板只在 `:root` 声明，明暗共用同一深色板） |
| 主题上下文 | `src/shared/context/ThemeContext.tsx` | light/dark/system、`<html class="dark">`、meta theme-color、跨设备持久化 |
| 主题切换 UI | `src/shared/ui/ThemeModeSelector.tsx`（挂在外观设置页） | 三选一胶囊，可扩展为多主题选择器 |
| 语法高亮已令牌化 | `src/shared/syntaxTheme.ts` + `Markdown.tsx:182` | **亮点**：把 Prism 的 oneLight/oneDark 编译成 `--cc-syntax-N`，主题切换只是变量翻转，tokenization 不重跑。0-B 片后由 chat 与编辑器两条 markdown 路径**共用同一单例** |
| 字体令牌 | `--ui-font-family` / `--ui-font-size` / `--ui-code-font-*`，外观设置页已有 UI | 与主题正交，无需改动 |
| 外观设置页 | `src/modules/settings/tabs/AppearanceSettingsTab.tsx` | 主题选择器的天然落点 |

### 1.2 缺口（撑不起"主题"的原因）

| # | 缺口 | 证据 |
|---|---|---|
| 1 | **无 palette 层**：语义值直接写 HSL 三元组，没有原始色板可替换 | `src/index.css` 中 `--background: 44 22% 96%` 等，直接是终值 |
| 2 | **无主题扩展点**：只有 light/dark 二元，无 `data-theme`，无主题注册表 | `ThemeContext.tsx:11` 类型写死 `'light' \| 'dark' \| 'system'` |
| 3 | ~~终端完全硬编码~~ ✅ **0-C 已修复** | `useShellTerminal.ts` 曾写死 VSCode Dark+（38 处 hex），已改为 `--term-*` 令牌 + 运行期解析（见 §6 阶段 0 之 0-C 记录） |
| 4 | ~~编辑器主题来自第三方，不可调~~ ✅ **0-D 已修复** | `CodeEditorSurface.tsx:76` 曾用 `oneDark`（`@codemirror/theme-one-dark`，该包同时提供 UI 主题与语法高亮）；`editorStyles.ts:13-79` 有 **13 处** `isDarkMode ? A : B` 三元色值（v2 修正：初稿记 7 处）。已改为自建 `EditorView.theme()` + `HighlightStyle`，全部颜色走 `--editor-*` / `--cc-syntax-*`（见 §6 阶段 0 之 0-D 记录） |
| 5 | ~~语法高亮存在第二条未令牌化路径~~ ✅ **0-B 已修复** | `MarkdownCodeBlock.tsx` 曾用 `isDarkMode ? prismOneDark : prismOneLight`，绕过了 `--cc-syntax-*`；已改为与 chat 共用 `src/shared/syntaxTheme.ts` 单例（见 §6 阶段 0 之 0-B 记录） |
| 6 | **Git 图颜色硬编码** | `src/modules/git-panel/utils/commitGraph.ts:20-29`，10 个 lane 颜色写死 |
| 7 | **零散硬编码** | `mobileTerminalSelection.ts:179-228`（**7 处**，v2 修正：初稿记 4 处）、`git-panel/history/CommitHistoryItem.tsx`（`'#0ea5e9'` lane fallback）、`AgentSelectorSection.tsx`（5 处 agent 品牌色） |
| 8 | **`index.css` 后半段仍有 66 处硬编码色值** | `src/index.css:481-691`（滚动条 / checkbox / radio / textarea / placeholder 的暗色补偿）、`:753`、`:845`、`:1063-1118`、`:1161-1162`；多为 `rgb()/rgba()` 形式并带 `!important`，**不走令牌** |
| 9 | 无主题包 / 注入机制 | — |
| **10** | **Tailwind 具名色原子类不走令牌（最大缺口）** | 实测 TSX/TS 中 `bg-slate-800` / `text-zinc-400` / `prose-pre:bg-gray-900` 这类具名色原子类约 **3227 处**（中性色 1502 + 彩色系 1725），是 #8 那 66 处的**约 49 倍**，且多于语义令牌类的 2498 处。无 `dark:` 者任何主题下固定不变；有 `dark:` 者只随明暗翻转、不随主题变化。集中分布：`TaskDetailModal.tsx`、`fileIcons.ts`、`AskUserQuestionPanel.tsx`、`TaskEmptyState.tsx`、`VersionUpgradeModal.tsx`、`toolConfigs.ts` 等 |
| **11** | **`dark:` 前缀 = 明暗规则硬编码** | 上述具名色中约 **529 处**带 `dark:` 前缀（含 `dark:hover:` 等复合变体约 640 处）。它在编译期固化"暗色下用哪个色"，与"运行期改令牌换肤"结构性冲突——深色主题要让卡片从 `gray-800` 变 `slate-900`，这些组件不接受接管 |

> 注：各 harness 的 Logo（`ClaudeLogo.tsx` / `PiLogo.tsx` / `DshLogo.tsx`）与 agent 品牌色属于**品牌标识**，不应随主题变化，建议保留硬编码并显式标注为例外。

### 1.3 规模

- `src/` 下只有 **1 个 CSS 文件**（`src/index.css`，v5 时 1236 行）——样式绝大多数以 Tailwind 原子类写在 TSX 中。**v2 修正**：初稿把这一点判定为"只要令牌层设计到位，绝大部分 UI 自动跟随"，审计后不成立。原子类的色值分两类：走令牌的语义类（`bg-background` 等，约 2498 处）与**不走令牌的具名色类**（`bg-gray-900` 等，约 3227 处）。后者才是大头，且 `dark:` 前缀进一步把明暗规则写死（§1.2 #10 / #11）。
- `index.css` 现声明 **109** 个自定义属性（0-A / 0-C 后：39 palette + 26 终端 + 44 其他）；`src/` 中被 `var()` 引用到的唯一变量 78 个，其余是主题覆盖面（见附录 A）。
- `index.css` 后半段沉淀了 **66 处 `rgb()/rgba()` 硬编码**（滚动条、checkbox/radio、textarea、placeholder 的暗色补偿，见 §1.2 #8）。**审计时必须同时匹配 `rgb()/rgba()`，只看 hex 会漏掉全部 66 处。**
- **令牌值格式不止 HSL 三元组**：还有 HSL+alpha（`--nav-glass-bg: 44 22% 96% / 0.7`）与尺寸类（`calc()` / `env()`）。任何"令牌白名单校验器"必须按令牌逐一定制值格式规则，不能按单一格式校验。

---

## 2. 参照物 A：WorkBuddy「外观主题」（云端皮肤包）

### 2.1 资源模型

主题不是枚举，而是**带元数据的资源**：

| 字段 | 取值 | 说明 |
|---|---|---|
| `kind` | `theme` / `color` | 整套皮肤 / 只换配色 |
| `appearance` | `light` / `dark` / `system` | 主题自身的明暗归属 |
| `series` | `craft` / `collection` / `coop` | 主题系列（分栏展示） |
| `vipLevel` | free / pro / advanced / ultimate | 商业化分级 |
| `validity_type` | `permanent` / `limited` + `valid_from`/`valid_to` | 限时皮肤 |
| 资源 | `cover_url` / `preview_url` / `zip_url` | 封面 / 预览 / 主题包 |

接口：`operation-platform/appearance/resources`（目录）+ `user-asset/appearance/get|set`（用户选择），选择结果 24h 同步。

特性开关 `ProductFeature.EnableAppearance`（`main/common.js:1722`）默认关闭，由发行版下发。

### 2.2 令牌体系：三层 + 三命名空间

- **三层**：`--wb-palette-*`（原始色板，brand-8 = `#00C29A`）→ `--wb-color-*` / `--wb-*`（语义）→ 组件级（button/icon/status/sidebar）
- **三命名空间并存**：`--wb-*`（产品语义）、`--cb-*`（agent-ui 组件，经 bridge 层别名到 wb）、`--vscode-*`（编辑器/IDE 集成）
- light 默认落 `:root`；dark 由 `data-theme=dark` / `.dark` / `.cb-dark` / `.vscode-dark` / `body[data-vscode-theme-name="IDE Night"]` 覆盖

### 2.3 皮肤包契约（实物验证）

本机 `~/.workbuddy/appearance-resources/<resourceKey>-<updatedAt>/` 已有真实皮肤（张韶涵主题皮肤-v11，skin.css 1408 行 / 681 变量；激战金秋-龙狮城 v10，62KB）。契约要点：

1. zip 内**单个 CSS**（约定名 `skin.css`）+ `assets/` 资源目录
2. 只写覆盖值，**全部 `!important`**
3. 选择器需**穷举所有 light/dark 标记**
4. **变量覆盖 + 选择器补丁两层**：纯变量不够，组件级硬编码要用 `.notifications-panel {...}`、`[class*=mainArea] ...` 这类补丁对抗特异性
5. 图片走相对 `url()`，注入前重写为 `local-file://` 绝对 URL（扩展名白名单）
6. 工作流是"从源模板 remap/retune"，注释记录取色来源与改动计数（`modified: 313/569`）
7. 安全：zip bomb 防护（≤20MB / ≤500 条目）、路径穿越校验、CDN 主域白名单

### 2.4 代价评估

该模型为商业化运营而生（分级、限时、审核、下架、遥测）。对 cloudcli 这种**自托管开源**项目，直接照搬会引入一整套后端目录服务、CDN 白名单与包安全加固——**收益不匹配成本**。值得借鉴的是它的**令牌分层**与**契约安全约束**，不是它的分发链路。

---

## 3. 参照物 B：Codex CLI 主题（文件即主题）★ 主参考

### 3.1 机制（解包证据）

二进制 `/…/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex`（229MB，Mach-O）中提取到：

```
$CODEX_HOME/themes/                                          ← 自定义主题目录
Custom .tmTheme files can be added to the  … directory.       ← 文档说明
Theme "X" not found. Using the default theme.
  To use a custom theme, place a .tmTheme file at $CODEX_HOME/themes/
Custom theme "X" at <path> could not be loaded (invalid .tmTheme format).
  Falling back to the default theme.
Theme "X" not recognized; using default theme
```

- 主题模块：`tui/src/theme/mod.rs`
- 依赖 `syntect-5.3.0` + `two-face-0.5.1`：**直接用 Sublime/TextMate 的 `.tmTheme` 格式**，语法高亮与主题共用同一体系
- 内置主题来自库，实测字符串中包含：Catppuccin（Latte/Frappe/Macchiato/Mocha）、Dracula、Monokai Extended（含 Bright/Light/Origin）、Nord、Solarized (dark/light)、base16-ocean/eighties/mocha、gruvbox、OneHalf、TwoDark、Sublime Snazzy、InspiredGitHub、1337、Zenburn 等
- 失败策略明确：**目录里找不到 / 格式非法 → 回落默认主题，并给出可操作的提示**

### 3.2 与 cloudcli 的形态相似性

Codex 的 TUI 同样不是"一个 CSS 文件能搞定一切"的界面，它有 markdown、diff、streaming、status card、picker 等多种渲染面（源文件路径可见 `tui/src/markdown.rs`、`tui/src/status/card.rs`、`tui/src/streaming/code_fence.rs` 等）。它用**一套标准主题格式贯穿所有渲染面**，这正是 cloudcli 缺的那一环。

### 3.3 为什么 Codex 式更优雅

| 维度 | WorkBuddy 云端皮肤包 | Codex 文件即主题 |
|---|---|---|
| 新增一套主题 | 上传后端 → 审核 → 上架 → 客户端下发 | **把文件放进目录** |
| 是否需要后端 | 是（目录接口 / VIP / 有效期 / CDN） | **否** |
| 格式 | 私有 `skin.css` 契约 | **标准 `.tmTheme`**（Sublime/TextMate） |
| 生态复用 | 无 | **直接吃现成主题库** |
| 内置主题来源 | 运营驱动，数量少 | **库自带几十套** |
| 安全面 | zip 解压 / 路径穿越 / CDN 白名单 | 本地文件，攻击面小 |
| 失效处理 | 有效期 / 下架 / `invalid_resources` | 文件在即有效 |
| 适合场景 | 商业化、分级、运营 | **开源工具、自托管** |

结论：对 cloudcli，**"主题 = 一个文件/一段数据"** 才是优雅解。WorkBuddy 的分发链路可作为未来可选的"远程主题源"扩展，不进核心。

---

## 4. 设计目标与原则

**目标**

1. 新增主题（内置或用户自定义）**不需要修改任何组件代码**
2. 主题可**增量覆盖**：只改 3 个变量就能得到一套"换强调色"的主题
3. 主题切换后**全站一致**——"一致"定义为**结构性一致**（所有渲染面都从令牌取色、无硬编码旁路），**不是内容性一致**（不要求每套主题都覆盖每一个面）。增量主题（只改 `--primary`）不会动终端 / 编辑器 / Git 图，这是预期行为；主题选择器上须以 badge 标注覆盖范围（`coverage: accent | full`），避免用户预期错位
4. 与现有 light/dark/system、字体设置、`--cc-syntax-*` 机制**兼容共存**
5. 不引入后端依赖

**非目标（明确不做）**

- 不做主题商店 / 账号体系 / VIP 分级 / 限时皮肤
- 不做主题的可视化编辑器
- 不引入 Tailwind 之外的 CSS 框架或运行时 CSS-in-JS
- 不改变现有令牌的**语义命名**（避免大面积重构 Tailwind 配置）
- **不对 Tailwind 具名色原子类做全量语义化**（约 3227 处）：阶段 0 只收口**中性色系**中的界面骨架部分，彩色系 / 状态色 / 图标色按语义豁免并标注理由（见 §5.7）

---

## 5. 设计方案

### 5.1 令牌分层

```
L1 palette（原始色板，新增）
  --palette-gray-1 … --palette-brand-8 …
        ↓ 被引用
L2 semantic（现有，保持命名不变）
  --background / --foreground / --primary / --card / --border / --ring /
  --nav-* / --cc-syntax-N / 新增 --term-* / --editor-* / --graph-*
        ↓ 被引用
L3 component（Tailwind 原子类 + 少量组件内样式）
  bg-background / text-muted-foreground / border-border …
```

**关键性质**：主题只需覆盖 L1 或 L2，L3 自动跟随。这就是"增量换肤"的机制基础。

L2 是**主题契约面**：约定一组令牌即构成一个可换肤的完整主题；未覆盖的令牌自动继承 base。

> **v2 补充（这是初稿最大的技术空洞）**：L1 必须在**定义上**被 L2 引用，否则"覆盖 L1 即可换肤"是假的——现状 L2 全是直接写终值（`--background: 44 22% 96%`），新增的 `--palette-*` 无人引用，覆盖它不会改变任何 UI。因此阶段 0 的 palette 层改造包含**两步**：
>
> 1. 定义 L1（新增色板）；
> 2. **把 L2 的值改写为引用 L1**。对 HSL 语义令牌，采用通道拆分：`--primary: 175 84% var(--palette-brand-light-4)`（hue / sat 保持字面、lightness 走 L1），或在需要整色替换时直接 `--primary: var(--palette-brand-8)`——后者若 L1 存 hex，需同步调整 Tailwind 消费方式（当前 `index.css` 有 16 处 `hsl(var(--x))` 包裹）。
>
> **v4（0-A 已实施）——选整色引用，且消费端零改动**：上面那句"整色引用需调整消费方式"**只在 L1 存 hex 时成立**。实施把 L1 也定义为 **HSL 三元组**（与 L2 同格式），于是 `hsl(var(--primary))` 的解析路径完全不变，Tailwind 配置与 16 处 `hsl(var(--x))` **一行未动**；带 alpha 的导航令牌写成 `var(--palette-x) / 0.7` 同样等值。未采用通道拆分，因为它会让 palette 退化为"亮度档位"（hue/sat 仍是字面值），无法整组换色——palette 的换色能力正是本层的存在理由。实测见 §6 阶段 0-A 记录。
>
> **范围界定**（避免与 §4 非目标"不改变语义命名"冲突）：命名不变，只改**值的来源**。对无法自然拆分通道的令牌（`--nav-*` 的 HSL+alpha、尺寸类），L1 可暂不覆盖、保持字面值。`coverage: accent` 类增量主题通过覆盖 L2 实现；`coverage: full` 类主题可选择同时覆盖 L1 与 L2。
>
> **L1 的定位必须写进主题开发文档**：它是"内置主题的组织约定 + 完整主题的换色入口"，**不是所有主题的唯一入口**——否则主题作者会误以为改 L1 就能生效。

### 5.2 主题选择器：`data-theme` 与 `.dark` 双轨共存

现状 `<html class="dark">` 需要保留（Tailwind `darkMode: ["class"]`、大量 `dark:` 原子类依赖它）。方案：

```html
<html data-theme="cc-ocean" class="dark">
```

- **`class="dark"`** 继续表示"暗色基底"，驱动现有 `dark:` 原子类与 base 语义值 → 由主题的 `appearance` 字段决定
- **`data-theme="<id>"`** 选择主题的覆盖层，优先级高于基底：

```css
/* base（现有，不动） */
:root { --background: 44 22% 96%; … }
.dark { --background: 0 0% 8%; … }

/* 主题覆盖层（新增，可只写需要改的） */
[data-theme="cc-ocean"] {
  --palette-brand-8: #0f766e;
  --primary: 175 84% 32%;
  --ring: 175 84% 32%;
}
[data-theme="cc-ocean"].dark {
  --palette-brand-8: #2dd4bf;
  --primary: 172 66% 50%;
}
```

`appearance: system` 时主题不绑定明暗，跟随系统在 `data-theme` 的两个分支间切换。

**必须写明的硬约束（否则双轨方案不成立）**：现状 `:root` / `.dark` 全部位于 `@layer base` 内（`src/index.css:45`、`:207`）。CSS Cascade Layers 中 layered 样式恒低于任何 **unlayered** 样式——因此**主题覆盖层必须是普通 CSS，严禁放进任何 `@layer`**。满足此约束时 `[data-theme="x"]` 稳定压过 `@layer base` 内的 base 值，**完全不依赖文件加载顺序**，并顺带消解 §7"`data-theme` 与 `dark:` 原子类叠加优先级困惑"的一半。

### 5.3 主题数据模型

```ts
// 放在 src/shared/types.ts（两个以上文件使用）
/** 一套主题的元数据；由内置注册表或用户主题清单产生，供主题选择器与 ThemeContext 消费。 */
export type ThemeManifest = {
  /** 唯一 id，同时作为 <html data-theme> 的值；用户主题从文件名派生并做 sanitize。 */
  id: string;
  /** 展示名（选择器与 aria-label 使用）。 */
  name: string;
  /** 主题自身的明暗归属；决定 <html class="dark"> 与 color-scheme。 */
  appearance: 'light' | 'dark' | 'system';
  /** 来源：内置 / 用户文件；用于 UI 分区与删除能力判定。 */
  source: 'builtin' | 'user';
  /** 可选：作者与描述，用户主题在 UI 中展示。 */
  author?: string;
  description?: string;
  /** 可选：覆盖范围。accent=只改强调色；full=完整覆盖（含终端/编辑器/Git 图）。选择器上以此显示 badge，呼应 §4 目标 3 的"结构性一致"。 */
  coverage?: 'accent' | 'full';
  /** 可选：是否允许用户在其基础上再自定义强调色（为"主题 + 个人强调色"双层定制留口）。默认 false。 */
  supportsAccentOverride?: boolean;
  /** 可选：首帧自愈哨兵类名，用于"加载成功但内容有害"的判定（见 §5.6）。 */
  sentinelClass?: string;
};
```

**注意**：`ThemeManifest` 是"元数据"，**不含色值**。色值只有两个来源——内置主题的 CSS 文件，或用户主题文件/内容。这样元数据可枚举、可校验，色值不受约束。

### 5.4 三种主题来源与优先级

| 来源 | 载体 | 生效方式 | 阶段 |
|---|---|---|---|
| 内置主题 | 仓库内 CSS 文件（随构建产物打包） | Vite 静态 import 或独立 `<link>` | 1 |
| 用户主题（文件） | 服务器主机 `~/.cloudcli/themes/<id>.{css,json,tmTheme}` | 由服务端列目录 + 静态提供，前端 `<link>`（CSS）或 `<style>`（JSON / tmTheme 编译产物）引入 | 2 |
| 用户主题（粘贴） | 设置页文本框内容 | 存于用户偏好，注入 `<style>` | 2（可选） |

优先级：用户主题 > 内置主题 > base（light/dark）。

### 5.5 用户主题格式：三种选项

**选项 A：令牌 JSON（约束式，推荐作为默认）**

```json
{
  "name": "深海",
  "appearance": "light",
  "tokens": {
    "--primary": "175 84% 32%",
    "--ring": "175 84% 32%",
    "--term-background": "#0b1220"
  }
}
```

- 优点：**可校验**（白名单令牌、值格式），无法写选择器 → 不可能破坏布局，也不可能用 `url()` 外联
- 缺点：只能改已令牌化的东西
- 实现：读取后编译成 `[data-theme="x"]{ --a: b; … }` 注入

**选项 B：原始 CSS（自由式，作为进阶）**

```css
[data-theme="my-theme"] {
  --primary: 175 84% 32%;
}
[class*=toolbar] { background: #123 !important; }
```

- 优点：与 WorkBuddy/Codex 能力对齐，能补组件级硬编码
- 缺点：可写任意选择器与 `url()`（自托管场景下风险可接受，但仍应提示"主题来自你信任的来源"）
- 约束（借 WorkBuddy 契约）：单文件、文件名 sanitize、大小上限、不允许 `@import`

**选项 B2：标准 `.tmTheme`（Sublime / TextMate，选项 B 的官方变体）**

```xml
<plist version="1.0"><dict>
  <key>name</key><string>Dracula</string>
  <key>settings</key><array>
    <dict><key>settings</key><dict>
      <key>background</key><string>#282a36</string>
      <key>foreground</key><string>#f8f8f2</string>
      <key>caret</key><string>#f8f8f0</string>
    </dict></dict>
    <dict><key>scope</key><string>keyword</string>
      <key>settings</key><dict><key>foreground</key><string>#ff79c6</string></dict></dict>
    …
  </array>
</dict></plist>
```

- **为什么必须有它**：§3.3 把"直接吃现成主题库（`.tmTheme`）"列为 Codex 式模型的核心理由；若用户拿到 Dracula / Nord / Catppuccin 官方 `.tmTheme` 却无法使用，"文件放进目录即生效"的承诺对生态内主题不成立，方案自相矛盾。
- **实现**：tmTheme 是 plist XML，结构简单（`settings` 数组，首元素为全局 `background/foreground/caret/selection/lineHighlight`，其余为 `scope` + `foreground/fontStyle`）。前端做轻量解析后映射到 `--cc-syntax-*` / `--editor-*` / `--term-*` 一族令牌——这与本方案"把第三方主题编译成变量"的既有思路（`src/shared/syntaxTheme.ts` 从 Prism 主题编译）**同构**，可复用同一套编译与测试路径。
- **边界**：`.tmTheme` 只管色、不提供布局令牌，因此编译产物只覆盖语法 / 终端 / 编辑器子集；主 UI 令牌需由可选的内嵌扩展键（`cloudcli` 键）或同名 `.css` 补足。

**推荐**：默认走 A；设置页提供"高级模式"开关切到 B（原始 CSS，带语法高亮编辑器 + 实时预览）；B2 与 B 同档，按文件扩展名自动分派。三种格式共用同一套加载 / 生效链路，差异只在"解析 / 校验函数"。

> **v2 说明（§8.1 的结论）**：审阅中对"默认 A 还是默认 B"有分歧——Pi 主张默认 CSS 编辑器（目标用户是开发者，写 CSS 零门槛）；Claude / DSH 的证据链指向 A 的安全性（A 只能写白名单令牌，天然免疫"加载成功但破坏 UI"）。**本方案维持默认 A**：cloudcli 是自托管服务，主题会被分享 / 跨设备同步，A 的"不可能破坏布局"是可验证的护栏；同时把切到 B 的成本降到最低（一个开关 + 一次信任确认），并允许用户在设置中把"默认打开模式"改为 B。

### 5.6 加载与生效链路（含首帧防闪烁）

```
启动
 ├─ 同步读取本地偏好（localStorage + 服务端偏好镜像，沿用现有机制）
 ├─ 解析出 { themeId, resolvedAppearance }
 ├─ 立即在首帧前设置 <html data-theme=… class=…> 与 color-scheme、meta theme-color
 │   （现有 ThemeContext 已是同步首帧，需保持该性质）
 ├─ 用户主题：先用 localStorage 缓存的 CSS 内容同步注入 <style>（首帧不闪）
 │   └─ 后台拉取 /api/themes/<id>.css?v=<mtime> 校验是否有更新
 │        · 有更新 → 热替换并更新缓存
 │        · 失败 / 文件消失 → 回落默认 + 告警，清缓存
 └─ 首次加载（无缓存）：<link rel="stylesheet" href="/api/themes/<id>.css?v=<mtime>">
     · onload 后把内容缓存进 localStorage
     · 加载失败 → 回落默认主题 + 控制台告警（对齐 Codex 的失败策略）
     · 切换主题时：先加新 <link>，onload 后再移除旧的，避免闪白
```

要点：

- **内置主题**可在构建期打包，避免运行期请求
- **用户主题**必须走运行期注入，且要处理"加载中 / 失败"两态
- 现有 `ThemeContext` 对 `<html>` 的 class 与 meta 操作（`ThemeContext.tsx:67-95`）需扩展为同时维护 `data-theme` 与 `color-scheme`
- **首帧防闪烁靠缓存，不靠 `<link>` 时序**（v2 修正）：`<link>` 是异步的，首帧必然先按 base 渲染再闪变，与"同步首帧"要求矛盾。解法是**缓存上次成功加载的主题内容**（或编译后的令牌 JSON）到 localStorage，下次启动同步注入 `<style>`，再在后台校验更新——这正是 WorkBuddy `applyCachedCssSync` 的机制。
- **`color-scheme` 必须显式设置**（v2 新增）：在 `<html>` 上随 `appearance` 写 `color-scheme: light|dark`，浏览器据此自动渲染原生滚动条、checkbox / radio、`<input>`、`<textarea>` 与 `::placeholder`，使 §1.2 #8 的 66 处暗色补偿大部分可删（现状这些补偿正是在手写模拟 `color-scheme`）。**执行顺序：先加 `color-scheme`，再重审 66 处是否仍需保留**，避免先令牌化一堆本可删除的补偿。
- **JS 消费者需要主动刷新**（v2 新增）：CSS 变量变化不触发任何事件，xterm 的 `ITheme` 不支持 `var()`，CodeMirror 的 `EditorView.theme()` 在扩展创建时求值。因此主题切换后必须显式重读——xterm 走 `getComputedStyle(document.documentElement)` 重读 `--term-*` 后重设 `terminal.options.theme`；CodeMirror 走 compartment reconfigure。Git 图无此问题：`CommitGraphStrip.tsx` 是 SVG，`stroke` 可直接写 `var(--graph-lane-N)`。
- **"加载成功但破坏 UI"必须有恢复通道**（v2 新增）：失败回落只覆盖"文件缺失 / 格式非法"，覆盖不了选项 B 的 `body{display:none}` / `font-size:0` / `visibility:hidden` 这类**合法但有害**的 CSS——此时用户连切回默认主题的入口都看不到。必须提供强制恢复通道（三选一）：① 全局快捷键（如 `Ctrl/Cmd+Shift+Alt+R` 重置主题）；② 启动参数 / 环境变量 `CLOUDCLI_RESET_THEME=1`；③ URL 查询参数 `?theme=default`。建议**再加**一道自愈哨兵：注入主题 CSS 后 300ms 内若 `<html>` 未出现该主题预设的 `sentinelClass`，判定异常、自动回落并告警。选项 A 因只能写白名单令牌而天然免疫，这一点应在设置页"高级模式"开关处以文案明示。
- **用户主题 URL 必须带版本参数**（v2 新增，v3 补注）：`/api/themes/<id>.css` 若无 `?v=`，浏览器 / 中间层会缓存旧文件——用户改了 `~/.cloudcli/themes/` 里的文件、刷新后看不到变化，与阶段 2 验收冲突。服务端列目录时返回每文件 mtime（或内容 hash），前端拼 `?v=<mtime>`。服务端实现**直接复用 `server/modules/plugins/plugins.routes.ts:26` 的 `/:name/assets/*` + `resolveAsset` 模式**（已含路径安全 + 扩展名约束），不必新写目录遍历与校验。**v3 补注**：该模式已发 `Content-Type` 与 `Cache-Control: no-store, no-cache, must-revalidate`（`plugins.routes.ts:29-30`），因此浏览器侧本就无缓存，`?v=` 属"兜住中间层 / 代理缓存 + 便于排障"的加固而非硬性必需——若复用该模式就顺手保留。
- **"文件主题"与"粘贴主题"是两条存储线**（v3 新增）：前者在服务端目录（只读、随部署卷走、**内容不跨设备同步**），后者存用户偏好（**内容跨设备同步**）。二者的删除、失效、跨设备语义均不同，设置页须按 `ThemeManifest.source` 区分展示，文档写明。
- **跨设备同步的边界**（v2 新增）：偏好镜像会把 `themeId` 同步到未安装该主题文件的设备，届时应**显式提示"此设备缺少该主题，已回落默认"**而非静默回落。另注意现状怪癖：`setTheme('system')` 不写偏好（`ThemeContext.tsx:113-121`，仅 light/dark 才 `writeUserPreference`），新增 `themeId` 键时需决定 `system` 分支是否同样豁免，避免把本机临时态覆盖成跨设备永久态。

### 5.7 硬编码收口清单（阶段 0 的施工面）

| 目标 | 文件 | 收口方式 |
|---|---|---|
| **Tailwind 具名中性色（界面骨架）** → 三分法**第一类**（v3 定为必做） | 中性色 **1502 处**（设计期 grep 口径；0-E2e 发现该口径漏了轴限定形态，真实口径为 **1517 处**，见该片记录），分布于 **105 个文件**（热点：`AskUserQuestionPanel.tsx` 84、`TaskDetailModal.tsx` 72、`McpServerFormModal.tsx` 69、`TaskBoardToolbar.tsx` 60、`AgentConnectionsStep.tsx` 60、`VersionUpgradeModal.tsx` 55…） | **v4 定案（A1 保值档位令牌）**：`bg-gray-100 dark:bg-gray-700` → `bg-n-gray-100 dark:bg-n-gray-700`——只把字面档位换成令牌引用，取值**逐档等于现状 Tailwind 中性值**。初稿写的 `bg-slate-800 → bg-card` / `text-zinc-400 → text-muted-foreground` **不可行**：实测本片存在 **89 种不同的 `(light, dark)` 元组**，而一个令牌类只能承载**一对**值，折叠到 ~15 个角色令牌必然改色（light 整体偏暖、dark 卡片 `#1f2937 → #1f1f1f`，单点 ΔRGB 最大 100），DoD 的"阈值 0"当场作废。保值档位层由 0-E1（`gray`）与 0-E1b（`zinc` / `slate` / `neutral`）建设（见下方实施记录）。**按文件集群分片，热点文件（>50 处）单独成片**；`bg-x dark:bg-y` 是成对结构（实测同文件对 ≥ 335 处，本仓粗测 414），**替换必须一次完成、同时消灭两半，不设中间态**。**代价（记账）**：`dark:` 双写结构保留（§5.7 第一类字面要求未满足），且档位跨角色耦合（`--n-gray-700` 同时承载 light 正文色与 dark 抬升面）；两者都由**阶段 2 的语义化改名**收口——与 `--cc-syntax-N` 本轮"只加间接与护栏、阶段 2 一次到位改名"（§8.9）同构。**进度**：**0-E3q 后剩余 252 处 / 65 文件**（`AskUserQuestionPanel.tsx` 84、`TaskDetailModal.tsx` 72、`McpServerFormModal.tsx` 69、`TaskBoardToolbar.tsx` 60、`VersionUpgradeModal.tsx` 55、`CodeEditorHeader.tsx` 52、`FolderBrowserModal.tsx` 46、`TaskEmptyState.tsx` 46、`AccountContent.tsx` 41、`toolConfigs.ts` 38、`QuestionAnswerContent.tsx` 35、`NextTaskBanner.tsx` 33、`TaskMasterSetupModal.tsx` 32、`GithubAuthenticationCard.tsx` 31、`PrdEditorHeader.tsx` 30、`GenerateTasksModal.tsx` 30、`CreateTaskModal.tsx` 30、`TaskHelpModal.tsx` 30、`TaskCard.tsx` 30、`fileIcons.ts` 28、`TaskListContent.tsx` 24、`MessageComponent.tsx` 24、`CodeEditorBinaryFile.tsx` 23、`CodeEditorMediaPreview.tsx` 22、`TaskFiltersPanel.tsx` 22、`TaskQuickSortBar.tsx` 18、`OverwriteConfirmModal.tsx` 18、`StepReview.tsx` 18、`SidebarProjectItem.tsx` 16、`taskKanban.ts` 16、`ImageViewer.tsx` 14、`ProjectCreationWizard.tsx` 14、`ShellHeader.tsx` 14、`TaskBoardContent.tsx` 14、`ToolDiffViewer.tsx` 12、`MarkdownPreview.tsx` 12、`UserMessageStickyHeader.tsx` 12、`TerminalShortcutsPanel.tsx` 11、`TextContent.tsx` 11 均已清零，余下最大单片为 `BrowserUsePanel.tsx` 11）。沿革：0-E0 全量 **1502 处 / 105 文件** → 0-E2 后 1439 / 104 → 0-E2c 不变（纯护栏片）→ 0-E2d −84 → **0-E2e 扩面 +15 又同片清零 −15，剩余量不变**（但覆盖面从 1502 增至 **1517**，见 0-E2e 记录的口径变化）→ 0-E2f −72 → 0-E2g −69 → 0-E2h −60 → 0-E2i −55 → 0-E2j −52 → 0-E2k −46 → 0-E2l −46 → 0-E2m −41 → 0-E2n −38 → 0-E2o −35 → 0-E2p −33 → 0-E2q −32 → 0-E2r −31 → 0-E2s −30 → 0-E2t −30 → 0-E2u −30 → 0-E2v −30 → 0-E2w −30 → 0-E2x −28 → 0-E2y −24 → 0-E2z −24 → 0-E3a −23 → 0-E3b −22 → 0-E3c −22 → 0-E3d −18 → 0-E3e −18 → 0-E3f −18 → 0-E3g −16 → 0-E3h −16 → 0-E3i −14 → 0-E3j −14 → 0-E3k −14 → 0-E3l −14 → 0-E3m −12 → 0-E3n −12 → 0-E3o −12 → 0-E3p −11 → 0-E3q −11。另处置 2 处旧式 `*-opacity-*` 共现隐雷，见 0-E2 记录。**0-E2c** 补上配对层守恒律——0-E0 时代的全量字面命中数（1439 剩余 ＋ 1 豁免 ＋ 62 已迁移 = 1502）即冻结总量起点，从数字上追溯确认了 0-E2b 的迁移守恒 |
| **状态色（成功 / 错误 / 警告 / 信息）** → 三分法**第二类** | 约 300 处（如 `bg-green-500 dark:bg-green-600`） | **保留 `dark:`，作为"主题不应控制的色"**。`--status-*` 令牌的**定义与替换捆绑为同一个后续片（可晚于阶段 0），阶段 0 不引入**——否则会重演 DSH 指出的"无消费者死令牌"覆辙（保留 `dark:` 的组件不读令牌，覆盖 `--status-*` 无效）。替换完成前，主题开发文档须诚实写明"状态色暂不受主题控制" |
| **品牌色 / 文件图标色 / 装饰色** → 三分法**第三类** | 约 1000 处（`fileIcons.ts`、agent 品牌色、渐变色） | **明确豁免**，写入机器可校验的豁免清单（§6），主题不覆盖 |
| **`dark:` 前缀总览**（v3 定口径） | 实测 `dark:` 共约 **1302 处** = 中性具名 **529** + 彩色具名 **581** + 语义令牌类 **6** + 结构性变体（`dark:prose-invert` 等）约 186。**注意：`dark:` + 具名色合计约 1110 处（86%），均为硬编码**，须按三分法分流 | **验收只统计"`dark:` + 具名色"**（目标收敛到豁免清单），**不统计"`dark:` 总数归零"**——`dark:bg-card` 这类**指向令牌**的 dark 变体天然无害、主题完全接管，计入会白费力气。另：全项目语义令牌类的 `dark:` 用法仅 6 处，说明现状暗色处理基本是"具名色双写"模式 |
| xterm 终端 ✅ | ~~`src/modules/shell/hooks/useShellTerminal.ts:36-75`（38 处 hex）~~ | **0-C 已完成**：改为 `--term-*` 令牌，由 `src/modules/shell/utils/terminalTheme.ts` 在运行期解析；`extendedAnsi` 已按附录 A **废弃**（见 §6 阶段 0 之 0-C 记录） |
| CodeMirror 主题 ✅ | ~~`src/modules/code-editor/CodeEditorSurface.tsx:76`（`oneDark`）~~ | **0-D 已完成**：`src/modules/code-editor/utils/editorTheme.ts` 建了 `EditorView.theme()`（UI：背景 / 光标 / 选区 / 行号 / 搜索 / tooltip）与 `HighlightStyle.define()`（token 色）两套。UI 面走 `--editor-*`，语法面经 `SYNTAX_TOKEN_MAP` **与 chat 侧 Prism 共用** `--cc-syntax-N` |
| 编辑器 diff 样式 ✅ | ~~`src/modules/code-editor/utils/editorStyles.ts:13-79`（**13 处** `isDarkMode ? A : B`）~~ | **0-D 已完成**：改为 `--editor-diff-add/del-*` 等令牌，函数退化为常量（`EDITOR_STYLES` / `EDITOR_LOADING_STYLES`），`isDarkMode` 参数消失 |
| 第二处语法高亮 ✅ | `src/modules/code-editor/markdown/MarkdownCodeBlock.tsx:69` | **0-B 已统一**：改走 `src/shared/syntaxTheme.ts` 的 `syntaxTheme.style`，直连 Prism 主题的分支已删除 |
| Git 图 lane 色 | `src/modules/git-panel/utils/commitGraph.ts:20-29`（10 lane）+ `git-panel/history/CommitHistoryItem.tsx`（`'#0ea5e9'` fallback） | 抽为 `--graph-lane-*`，light/dark 各一套；**避免 10 条天花板**，加参数化回退（§5.12） |
| 终端选区菜单 | `src/modules/shell/utils/mobileTerminalSelection.ts:179-228`（**7 处**） | 改为读令牌。**该项目属移动端高发区，需专项回归**：改后在 iOS Safari 实机 / 模拟器验证长按菜单、选区手柄与滚动行为 |
| 滚动条 / 表单件 / placeholder | `src/index.css:481-691`、`:753`、`:845`、`:1063-1118`、`:1161-1162`（66 处） | **先加 `color-scheme`（§5.6），再重审这 66 处**：能靠 `color-scheme` 自动跟随的成批删除，剩余按语义归为 `--scrollbar-*` / `--control-*` / `--placeholder` |
| agent 品牌色 / Logo | `AgentSelectorSection.tsx`、`*Logo.tsx` | **保持硬编码**，在 `index.css` 顶部集中声明豁免清单并注明"品牌标识，不随主题变化" |

验收（v3 定口径）：grep 必须**同时匹配字面色值与具名色原子类**，只匹配前者会漏掉占比约 98% 的具名色；对 `dark:` 则**只统计 `dark:` + 具名色**，不统计 `dark:` + 令牌类。

```bash
# ① 字面色值
grep -rnE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(' src --include='*.css' --include='*.ts' --include='*.tsx' | grep -vE 'hsl\(var\('
# ② Tailwind 具名色原子类（初稿完全遗漏）
rg -o -e '(bg|text|border|ring|stroke|fill|from|to|via|decoration|placeholder|shadow|outline|divide|accent|caret)-(slate|gray|zinc|neutral|stone|black|white)(-[0-9]{2,3})?(/[0-9]{1,3})?' src --glob '*.tsx' --glob '*.ts' | wc -l
# ③ dark: + 具名色（验收对象；dark: + 令牌类不计入）
rg -o -e 'dark:(bg|text|border|ring|stroke|fill|from|to|via|decoration|placeholder|shadow|outline|divide|accent|caret)-(slate|gray|zinc|neutral|stone|black|white|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-[0-9]{2,3})?(/[0-9]{1,3})?' src --glob '*.tsx' --glob '*.ts' | wc -l
```

剩余命中**必须全部落在机器可校验的豁免清单内**（§6 阶段 0），清单外命中即验收失败。**0-E0 已把它落成两份独立资产**：`src/shared/tests/themeHardcodedAllowlist.ts`（**永不**迁移项，逐条 `file + token + 理由`）与 `src/shared/tests/theme-hardcoded-baseline.json`（**派生快照 = 待迁移项**，逐片收敛到空）；护栏 `themeHardcodedAtoms.test.ts` 断言"剩余命中 ⊆ 基线"且"豁免清单无死项"，并在失败时报出**具体文件与原子**的计数漂移。注意口径：二者只覆盖**中性族**——扫描器 `themeHardcodedAtoms.ts` 在构造上就只找中性具名色，彩色 / 状态 / 品牌 / 图标色（约 1700 处）不经此清单。**注意：grep 只能证明"没有硬编码"，证明不了"每套主题的令牌全集可解析"——后者由 §5.11 的契约测试承担。**

### 5.8 安全与健壮性（借 WorkBuddy 的约束）

用户主题文件由服务端读取并提供：

- 文件名 `sanitize`（仅 `[a-zA-Z0-9._-]`，拒绝 `.` / `..`），防路径穿越
- **id 前缀强制**（v2 新增）：内置主题 id 固定 `cc-` 前缀，用户主题强制 `user-` 前缀（或枚举时去重并告警），避免用户文件 sanitize 出的 id 与内置 id 相同、按 §5.4 优先级**静默遮蔽**内置主题
- **选择器注入防护**（v2 新增）：`data-theme` 值会写进属性选择器 `[data-theme="…"]`，sanitize 若放宽到 `[a-zA-Z0-9._-]` 之外，必须排除 `]`、引号、空格等会破坏选择器语法或造成注入的字符
- 大小上限（建议 256KB），拒绝 `@import`
- 目录固定为 `~/.cloudcli/themes/`，只读该目录，只返回 `*.css` / `*.json` / `*.tmTheme`
- 前端注入位置固定（`<link>` 或 `<style>`），不做 HTML 解析
- **恢复通道**：见 §5.6 的强制重置手段 + 自愈哨兵

### 5.9 与既有能力的关系

| 既有能力 | 关系 |
|---|---|
| `--cc-syntax-N` 变量化 | **继承；本轮不升语义名，只做三件事挡风险**（v3 已决）。现状：编号由"遍历 selector×property 时遇到差异的先后顺序"决定（`src/shared/syntaxTheme.ts:33-75`），源主题增删任一差异属性则其后编号整体重排；评估时消费者实测仅 4 个文件、全在 chat 模块内，但 **0-B 已使其跨出 chat**（chat 的 `Markdown.tsx`、code-editor 的 `MarkdownCodeBlock.tsx` + 3 个测试共用 `src/shared/syntaxTheme.ts`），编号不再只是模块内部实现，故下文三件事由加固升级为**必要**。**0-D 已完成**：**①** 导出 `SYNTAX_TOKEN_MAP` 常量（`{ keywordColor: 3, … }` 形态）把编号与语义绑定一次，内部引用走常量而非手写 `--cc-syntax-3`；**②** 加**黄金映射测试**——现有测试只断言 `var(--cc-syntax-\d+)` 的**形状**（`src/shared/tests/syntaxTheme.test.ts` 的 `assert.match`），未锁住具体映射，Prism 依赖 bump 导致编号重排时测试照绿；因 `buildSyntaxTheme()` 是纯函数，用 **inline snapshot** 固化 `{ style, css }` 即可（快照即对照表、零维护、diff 可读），并叠加"变量总数不变"作第一道信号；**③** 加 **denylist grep 护栏**——生成器与快照之外**禁止任何文件手写 `--cc-syntax-[0-9]` 字面量**，新消费者只允许消费 `style` / `css` 产物或 `SYNTAX_TOKEN_MAP`，CI 命中即红。**语义名草案（本轮定方向不实现）**：以 Prism 语义类别为根（comment / string / keyword / function / number / operator / punctuation / tag / attr-name / constant）、属性作后缀（`-color` / `-style` / `-weight`），如 `--cc-syntax-comment-color`；CodeMirror `HighlightStyle` 的 tag 名向同一套类别对齐，chat 与编辑器共用一套命名，**阶段 2 前一次到位改名**。<br>**0-D 实现偏差（比草案更强）**：`SYNTAX_TOKEN_MAP` 不是手写编号表，而是由 `deriveTokenMap` 从 `buildSyntaxTheme` 的产物**反查派生**——编号一旦因 Prism bump 重排，映射自动跟着走，不会出现"常量表与实际编号不一致"的中间态；找不到槽位时在模块加载期 `throw`，把改名变成构建期失败。黄金对照改用 `collectSyntaxVariables` 的完整"selector.property → 变量"快照 + 变量总数，另把每个语义槽位的 One Dark 色值冻结成表——后者能抓住"两个槽位对调"这类快照看不出的错误 |
| 字体设置（`--ui-font-*` / `--ui-code-font-*`） | 正交，不动。主题可选择性覆盖，但默认不应覆盖用户字体选择 |
| `meta[name=theme-color]` | 由主题的 `appearance` 决定。**取值链需闭环**（v2 修正）：`--background` 是 HSL 三元组，而 `meta[content]` 只接受 hex/rgb，须提供统一解析函数（HSL→hex、alpha 与背景合并）；同时 `ThemeContext.tsx:77-93` 还硬编码了 iOS `apple-mobile-web-app-status-bar-style`（`black-translucent` / `default`），是按明暗二值写的，主题化后须改由 `appearance` 驱动。`ThemeManifest` 可选携带 `themeColor` / `statusBar` 覆盖字段以避免解析误差 |
| 跨设备偏好同步 | 沿用现有偏好存储，新增 `themeId` 一个键即可；边界见 §5.6 |

### 5.10 可访问性（a11y）约束

初稿完全未覆盖 a11y。用户主题（尤其选项 B）可轻易写出不可用界面，须写入契约：

- **对比度**：内置主题必须过 WCAG AA（正文小字 ≥ 4.5:1，大字 / 图形 ≥ 3:1）；选项 A 的令牌校验器附带**非阻断**对比度警告
- **焦点可见性**：`--ring` 与 `--background` 对比度 ≥ 3:1，作为**硬性条款**（键盘用户依赖它定位焦点）
- **不以颜色单独传达状态**：diff 增删、Git lane、状态标签可以换色，但不得去掉非颜色标识（图标 / 符号 / 纹理），保证色盲可用
- **验收**：内置主题纳入 §5.11 契约测试的对比度断言

### 5.11 契约测试（比 grep 验收更可靠）

grep 只能证明"没有字面硬编码"，证明不了"每套主题的令牌全集可解析、明暗双分支都有值"。新增一组自动化契约测试：

- 遍历内置主题 CSS 与用户主题编译产物，断言 §5.9 定义的 L2 令牌全集在 `:root`、`.dark`、每套 `[data-theme]` 覆盖层中**取值非空且可解析**（含 `hsl(0 0% 8% / 0.7)` 这类 HSL+alpha 格式）
- 断言 `--ring` / `--background` 对比度 ≥ 3:1、正文对比度 ≥ 4.5:1
- 阶段 1 起：对"切换主题后终端 / 编辑器 / Git 图同时变化"做 `getComputedStyle`（含 xterm `options.theme` 重读后值）断言 / 快照
- **现成资产**：`src/shared/tests/syntaxTheme.test.ts`（0-B 由 chat 迁入）、`src/modules/chat/tests/markdownSyntaxThemeInjection.test.tsx`、`src/modules/code-editor/tests/markdownCodeBlockSyntaxTheme.test.tsx`（0-B 新增）已是语法高亮路径的护栏，予以保留并扩展；0-D 又补 `src/shared/tests/syntaxThemeTokenMap.test.ts`（编号冻结）与 `src/modules/code-editor/tests/editorThemeTokens.test.ts`（编辑器令牌）各一组

> **v4（0-A 已实现其中两项）**：`tests/theme-tokens/` 已落地"令牌全集可解析"与"明暗双分支都有值/无漂移"——它导入生产样式表，对每套明暗取全部自定义属性的 resolved 值并与签入基线逐位比对，另加 palette 无死令牌、颜色声明不绕过 palette 两项护栏（详见 §6 阶段 0-A 记录）。**对比度断言**（`--ring`/`--background` ≥ 3:1、正文 ≥ 4.5:1）与**遍历 `[data-theme]` 覆盖层**留待阶段 1——后者需要主题注册表先存在。运行：`npm run test:theme-tokens`（`UPDATE_THEME_BASELINE=1` 用于有意变更后刷新基线）。

> **v5（0-D 追加）**：fixture 的探针新增 `wrap: 'raw'` 形态，覆盖 `--editor-*` 这类"值即完整颜色表达式"的令牌（Tailwind 的 `hsl(var(--x))` 形态对它们会拼出无效的 `hsl(#282c34)`）。38 个编辑器颜色令牌已纳入基线的 `rendered` 层。**明暗两态共用同一规则集**这一点由 `editorThemeTokens.test.ts` 断言（`--cc-syntax-N` 槽位在两侧解析出不同值），可作为阶段 1"切换主题后编辑器同时变化"的最小前置证据。

### 5.12 Git 图 lane 色的数量上限（避免穷举）

`--graph-lane-1..10` 假设 lane ≤ 10，但活跃分支多的仓库（monorepo 尤甚）易超。方案：

- 默认保留 `--graph-lane-1..10` 显式令牌（便于主题精调）
- 超过 10 条时用参数化回退：定义 `--graph-lane-base-hue` / `--graph-lane-hue-step`，第 N 条 lane 取 `hsl(calc(base + step × (N-1)), 70%, 55%)`——在 `commitGraph.ts` 的 JS 侧计算最稳妥（不依赖 `@property` 的浏览器支持），主题只需覆盖两个参数即可控制整张图色系

---

## 6. 落地路径

### 阶段 0：令牌收口（无新功能，纯重构）

**拆分口径（v3 已决）：按模块分片 + 机器可校验豁免清单，每片独立合入 / 独立验收 / 独立可回滚。严禁一次性大 PR。**

分片序列（按依赖顺序）：

| 片 | 内容 | 为什么在这个位置 |
|---|---|---|
| 0-A ✅ | **palette 层 + L2 引用改写**（§5.1 的两步）——**已实施，见本节末 0-A 记录** | 纯 CSS，不碰 JS，最容易验证 |
| 0-B ✅ | **语法高亮路径统一**：`MarkdownCodeBlock.tsx` 从直连 Prism 切到 `--cc-syntax-*`——**已实施，见本节末 0-B 记录** | 已有测试护栏（`syntaxTheme.test.ts`、`markdownSyntaxThemeInjection.test.tsx`） |
| 0-C ✅ | **终端（xterm）令牌化**——**已实施，见本节末 0-C 记录** | 独立模块，改动集中，可单独测 |
| 0-D ✅ | **编辑器（CodeMirror）令牌化**：UI 主题 + `HighlightStyle` 两套——**已实施，见本节末 0-D 记录**；同时补完 §5.9 要求的 `SYNTAX_TOKEN_MAP` 三件事（0-B 漏做） | 改动较深，单独一片便于回滚 |
| 0-E0 ✅ | **豁免清单 + 待迁移基线 + 护栏**——**已实施，见本节末 0-E0/0-E1 记录** | 与 A1/B 选型无关，先建验证设施，后续每片才有可测的收敛口径 |
| 0-E1 ✅ | **保值档位令牌层**（`--palette-gray-*` / `--n-*` / Tailwind `n-*` 键）+ **等值护栏**——**已实施，见本节末 0-E0/0-E1 记录** | A1 的地基；类替换本身属 0-E2+ |
| 0-E1b ✅ | **非 gray 族档位层**（`zinc` / `slate` / `neutral` 各 11 档；`stone` 不建）+ 等值护栏泛化到 `(族, 档)`——**已实施，见本节末 0-E1b 记录** | 122 处非 gray 替换的地基；同样不改 TSX |
| 0-E2a ✅ | **类级等值护栏 + 旧式 opacity 共现护栏**（并处置实测到的 2 处隐雷）——**已实施，见本节末 0-E2 记录** | 补上"令牌类**可以**正确承载值"的机器证明；共现护栏清掉一个改名即静默丢透明度的陷阱 |
| 0-E2b ✅ | **首个文件集群**：`AgentConnectionsStep.tsx` 60 → 0——**已实施，见本节末 0-E2 记录** | 非 gray 最集中（50/60）；同时含 gray 与 zinc/neutral，一次覆盖三种族 |
| 0-E2c ✅ | **配对层：中性色守恒律**（字面 byUsage ＋ 折叠后 `n-*` byUsage ≡ 冻结原始 byUsage，含防空转守卫）——**已实施，见本节末 0-E2c 记录** | 补上"换上去的令牌**是对的**"这一半机器证明；0-E2 的 V2（错档位）/ V3（丢修饰符）此前完全无人管 |
| 0-E2d ✅ | **首个热点文件集群**：`AskUserQuestionPanel.tsx` 84 → 0——**已实施，见本节末 0-E2d 记录** | 全仓 #1 热点；且构成最纯（84 处只有 gray / white 两族），是 A1 改名的最简形态。也是第一片在 0-E2c 的"双绿"门槛下通过的迁移 |
| 0-E2e ✅ | **扫描器覆盖面**：轴限定中性色（`border-t/b/l/r/x/y-*`、`divide-x/y-*`、`ring-offset-*`）纳入扫描器与守恒律，并同片清零新纳入的 15 处——**已实施，见本节末 0-E2e 记录** | 闭合"主题生效一半"的最后一类漏洞：此前这 15 处不在任何护栏视野内，阶段 0 收工也不会被扫到 |
| 0-E2f ✅ | **热点榜第二的文件集群**：`TaskDetailModal.tsx` 72 → 0——**已实施，见本节末 0-E2f 记录** | 0-E2d 之后最大单片；72 处只有 gray / white / black 三族、`text`/`bg`/`border` 三类工具、`dark:`/`hover:` 两种变体，是最标准的 A1 形态 |
| 0-E2g ✅ | **热点榜第三的文件集群**：`McpServerFormModal.tsx` 69 → 0——**已实施，见本节末 0-E2g 记录** | 密度最高的一片（69 处压在 17 行内）；族仅 gray / white / black，工具仅 `bg`/`text`/`border`，是最标准的 A1 形态 |
| 0-E2h ✅ | **热点榜第四的文件集群**：`TaskBoardToolbar.tsx` 60 → 0——**已实施，见本节末 0-E2h 记录** | 首个**零透明度修饰符**的片（60 处全无 `/alpha`）；族仅 gray / white；同文件品牌色 purple / blue 未动 |
| 0-E2i ✅ | **热点榜第五的文件集群**：`VersionUpgradeModal.tsx` 55 → 0——**已实施，见本节末 0-E2i 记录** | **token 数至今最多（31 个）**、档位最杂（同片 11 个档位）；首个自带**独占拼写**的片，首次实测条件式断言的 `0 → dist 为 0` 方向；首个拿到带透明度真实值链样本的片 |
| 0-E2j ✅ | **热点榜第六的文件集群**：`CodeEditorHeader.tsx` 52 → 0——**已实施，见本节末 0-E2j 记录** | 首个 `text` 远多于 `bg`（36 : 16）且完全不用 `border` 的片；`dark:` 系变体占一半（26/52）；同文件品牌色 blue / green（含带透明度拼写）未动 |
| 0-E2k ✅ | **热点榜第七的文件集群**：`FolderBrowserModal.tsx` 46 → 0——**已实施，见本节末 0-E2k 记录** | 首个带模态遮罩拼写（`bg-black/50`）的片；`border` 类占 8 处，在前七片热点里首次成规模；19 个 token 含 2 处带透明度，值链样本再次拿到 |
| 0-E2l ✅ | **热点榜第八的文件集群**：`TaskEmptyState.tsx` 46 → 0——**已实施，见本节末 0-E2l 记录** | 带透明度 4 处**全部集中在同一 token**（`dark:bg-gray-800/60`）——首个透明度不分散的片；`border` 仅 2 处、`black` 0 处；`white` 12 处 |
| 0-E2m ✅ | **热点榜第九的文件集群**：`AccountContent.tsx` 41 → 0——**已实施，见本节末 0-E2m 记录** | **首个跨四族混合片**（gray 16 / zinc 13 / neutral 11 / white 1）；**40 个 distinct token 至今最多**（41 处几乎一 token 一次）；首次**批量**拿到独占拼写（27 个，前九片仅 0-E2i 有 1 个）；带透明度样本首次覆盖非 gray 族（`zinc-900/20`、`neutral-900/20`）；首现 950 档（`active:bg-gray-950` / `active:bg-zinc-950`） |
| 0-E2n ✅ | **热点榜第十的文件集群**：`toolConfigs.ts` 38 → 0——**已实施，见本节末 0-E2n 记录** | 首个**类名映射表**（`.ts` 配置，`primary` / `secondary` / `border` / `icon` 四类槽位）的片；**纯 `gray`、零 `bg`**（`text` 32 ／ `border` 6）；token 同质度最高（9 个 token 覆盖 38 处） |
| 0-E2o ✅ | **热点榜第十一的文件集群**：`QuestionAnswerContent.tsx` 35 → 0——**已实施，见本节末 0-E2o 记录** | **首个含豁免的片**（`border-gray-150` 保留，迁移脚本首次引入豁免过滤）；**带透明度 5 处、历片最多**，首次覆盖 `dark:hover:` 复合变体的透明度值链；档位跨度最广（gray 50 起） |
| 0-E2p ✅ | **热点榜第十二的文件集群**：`NextTaskBanner.tsx` 33 → 0——**已实施，见本节末 0-E2p 记录** | **首个 `slate` 主导的片**（slate 20 / gray 8 / white 5）；首次在产物里验证 `slate` 族完整令牌链（`hsl(var(--n-slate-900) / .3)`）；22 个 token 压在 13 行内 |
| 0-E2q ✅ | **热点榜第十三的文件集群**：`TaskMasterSetupModal.tsx` 32 → 0——**已实施，见本节末 0-E2q 记录** | 三工具最均衡的片（`bg` 12 ／ `border` 8 ／ `text` 12）；含模态遮罩 `bg-black/50` 与卡面 `dark:bg-gray-800/50` 两处带透明度；`bg-black/50` ⊂ `bg-black` 前缀陷阱再次实测安全 |
| 0-E2r ✅ | **热点榜第十四的文件集群**：`GithubAuthenticationCard.tsx` 31 → 0——**已实施，见本节末 0-E2r 记录** | 中段档位最集中的片（`gray-300/400/500/600/700` 五档合计 21/31）；带透明度 1 处 `dark:bg-gray-900/50`；无独占拼写（字面全部仍被其他文件消费） |
| 0-E2s ✅ | **热点榜第十五的文件集群**：`PrdEditorHeader.tsx` 30 → 0——**已实施，见本节末 0-E2s 记录** | 零透明度片；工具类含 `placeholder` 2 处（`placeholder-gray-400` / `dark:placeholder-gray-500`）；**2 个原子归零**（`placeholder: gray-400` / `placeholder: gray-500` 各 1→0），与 2 个"迁移后全仓零消费"的字面一一对应 |
| 0-E2t ✅ | **热点榜第十六的文件集群**：`GenerateTasksModal.tsx` 30 → 0——**已实施，见本节末 0-E2t 记录** | 三工具最均衡（`bg` 11 ／ `border` 8 ／ `text` 11）；含模态遮罩 `bg-black/50`（本片唯一带透明度）；档位缺 `gray-500`、含 `black`；21 个字面在 `src/` 均仍有其他消费者（**0 独占拼写**，最小 2 处） |
| 0-E2u ✅ | **热点榜第十七的文件集群**：`CreateTaskModal.tsx` 30 → 0——**已实施，见本节末 0-E2u 记录** | 与 0-E2t **逐 token 同构的姊妹文件**（21 个 token 及计数完全一致，仅品牌色族 `purple-*` → `blue-*`）；三工具均衡（`bg` 11 ／ `border` 8 ／ `text` 11）；含模态遮罩 `bg-black/50`；**0 独占拼写**（最小 1 处） |
| 0-E2v ✅ | **热点榜第十八的文件集群**：`TaskHelpModal.tsx` 30 → 0——**已实施，见本节末 0-E2v 记录** | `text` 为主（`text` 17 ／ `bg` 7 ／ `border` 6）；**带透明度 2 处**（`bg-black/50` 与 `dark:bg-gray-800/50`），两处值链均实测；密度 30 处 / 13 行 |
| 0-E2w ✅ | **热点榜第十九的文件集群**：`TaskCard.tsx` 30 → 0——**已实施，见本节末 0-E2w 记录** | 跨两族（`gray` 24 ＋ `slate` 4 ＋ `white` 2）；**4 个 slate 原子归零**（`slate-100/400/500/900` 各 1→0，本片是其字面唯一消费者）；零透明度（值链检查真空转） |
| 0-E2x ✅ | **热点榜第二十的文件集群**：`fileIcons.ts` 28 → 0——**已实施，见本节末 0-E2x 记录** | **token 数与 `byAtom` 减量条目都只有 2 个**（`text-gray-500` ×21、`text-gray-400` ×7，28 处全落在这两个桶内）；纯 `text`、零 `bg` / `border` / 透明度；28 处落在 28 行（一行一处） |
| 0-E2y ✅ | **热点榜第二十一的文件集群**：`TaskListContent.tsx` 24 → 0——**已实施，见本节末 0-E2y 记录** | 纯 `gray` 单族、8 档（`gray-100…800`）；`text` 18 ／ `bg` 4 ／ `border` 2；零透明度；密度 24 处 / 10 行；**0 独占拼写**（最小 1 处 = `dark:text-gray-100`） |
| 0-E2z ✅ | **热点榜第二十二的文件集群**：`MessageComponent.tsx` 24 → 0——**已实施，见本节末 0-E2z 记录** | 无 `border`（`text` 19 ／ `bg` 5）；含 `dark:bg-gray-800/60`（**60% 透明度**）；**2 个字面归零但 0 个原子桶归零**——首次实证"桶粒度粗于字面粒度"，修正了此前"桶归零 ⟺ 字面归零"的简化理解 |
| 0-E3a ✅ | **热点榜第二十三的文件集群**：`CodeEditorBinaryFile.tsx` 23 → 0——**已实施，见本节末 0-E3a 记录** | 密度最高的片之一（**23 处仅落在 6 行**，同一 className 串被三处按钮复用）；跨三色 `gray` 17 ＋ `white` 5 ＋ `black` 1；`text` 16 ／ `bg` 7、零 `border`；含 `md:bg-black/50`（**首个 `md:` 变体**）；**0 独占拼写**（最小 3 处） |
| 0-E3b ✅ | **热点榜第二十四的文件集群**：`CodeEditorMediaPreview.tsx` 22 → 0——**已实施，见本节末 0-E3b 记录** | 与 0-E3a **同模块姊妹组件**（同一 6 类 className 串被 3 处复用）；跨三色 `gray` 16 ＋ `white` 5 ＋ `black` 1；`text` 14 ／ `bg` 8、零 `border`、含 `bg-white`（PDF iframe 背景）；含 `md:bg-black/50`；**首次触发产物核对脚本的覆盖面缺口**——`index.css` 以字面类名作选择器目标，脚本却只扫 `.tsx?` |
| 0-E3c ✅ | **热点榜第二十五的文件集群**：`TaskFiltersPanel.tsx` 22 → 0——**已实施，见本节末 0-E3c 记录** | 与 0-E2h 的 `TaskBoardToolbar.tsx` 同模块（本片由后者渲染）；跨 `gray` 19 ＋ `white` 3；`bg` 8 ／ `text` 8 ／ `border` 6；**22 处仅落 8 行**（3 个 `<select>` 复用同一 `w-full rounded-md border … dark:bg-gray-800` 串）；零透明度；**0 独占拼写**（最小 2 处） |
| 0-E3d ✅ | **热点榜第二十六的文件集群**：`TaskQuickSortBar.tsx` 18 → 0——**已实施，见本节末 0-E3d 记录** | 与 0-E2h / 0-E3c 同属 `TaskBoardToolbar` 一族；**6 个 token 各恰好 ×3**（3 个按钮复用同一 `bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:…` 串），18 处仅落 3 行；纯 `gray`、零 `border` / 透明度；含 `hover:` / `dark:hover:` 变体；**1 个字面（`hover:bg-gray-200`）迁移后全仓零消费**（`src=0` 且 `dist=0`，Tailwind 不再生成该规则） |
| 0-E3e ✅ | **热点榜第二十七的文件集群**：`OverwriteConfirmModal.tsx` 18 → 0——**已实施，见本节末 0-E3e 记录** | 18 处落在 **17 个不同 token** 上（16 个各仅 1 次、唯 `bg-white` 2 次）——与 0-E3d 的"6 token 各 ×3"互为另一极端；跨 `gray` / `white` / `black`；含模态遮罩 `bg-black/50`（值链实测 50%）；`hover:bg-gray-50` 是 `index.css` 选择器目标之一（迁后仍有 2 个 src 消费者）；**1 字面归零但 0 桶归零**（`dark:hover:bg-gray-600`） |
| 0-E3f ✅ | **热点榜第二十八的文件集群**：`StepReview.tsx` 18 → 0——**已实施，见本节末 0-E3f 记录** | 18 处落 8 行；`text` 14 ／ `bg` 2 ／ `border` 2；纯 `gray` ＋ `white`；含 `dark:bg-gray-900/50`（50% 透明度，值链实测）；同文件蓝色信息卡（`border-blue-200` / `dark:bg-blue-900/20` 等）未触碰；**0 独占拼写**（最小 1 处） |
| 0-E3g ✅ | **热点榜第二十九的文件集群**：`SidebarProjectItem.tsx` 16 → 0——**已实施，见本节末 0-E3g 记录** | 16 处 / 12 token / 7 行；含 `bg-gray-500/10`（10%）与 `dark:bg-gray-900/30`（30%）**两处透明度**，值链均实测；`bg-gray-500` 一族（裸 / `/10` / `hover:` / `dark:hover:`）在本片集中；**7 个派生字面迁后 `src=0`（本片是其唯一消费者）、其中 2 个原子桶归零**（`bg: gray-400`、`border: gray-800` 各 1→0） |
| 0-E3h ✅ | **热点榜第三十的文件集群**：`taskKanban.ts` 16 → 0——**已实施，见本节末 0-E3h 记录** | 16 处 / 16 token / **4 行**（每 token 恰好 ×1）——`color` + `headerColor` 两串各 4 个 token、两列复用；跨 `slate` 8 ＋ `gray` 8；`bg` 8 ／ `border` 4 ／ `text` 4；含 `dark:bg-slate-900/50` 与 `dark:bg-gray-900/50` **两处 50% 透明度**，值链均实测；**同一 `KANBAN_COLUMN_CONFIG` 里 6 列语义色交错**——pending=slate、cancelled=gray 属中性待迁，in-progress=blue ／ done=emerald ／ blocked=red ／ deferred=amber 四列语义彩色**非本线范围、未触碰**；**9 个派生字面迁后 `src=0`（本片是其唯一消费者）、其中 7 个原子桶归零** |
| 0-E3i ✅ | **热点榜并列第十四的文件集群**：`ImageViewer.tsx` 14 → 0——**已实施，见本节末 0-E3i 记录** | 14 处落 **7 行**（每行 light＋dark 成对）；纯 `gray` ＋ `white`；档位 `gray-50/400/500/600/800/900` ＋ `white`；`text` 9 ／ `bg` 4 ／ **零 `border`**；**零透明度**（同文件第 62 行遮罩 `bg-black/50` 已是前片令牌 `bg-n-black/50`，本片未触碰）；**该文件已含前片遗留令牌——首次触发产物核对脚本的"前提假设缺口"**：脚本原假设被测文件迁移前不含 `n-*`，反向还原会把遗留令牌一并还原、永远无法等于备份，已改为**正向重放**并回归验证（见 0-E3i 记录）；**0 字面迁后归零、0 桶归零**（本片 9 个派生字面在全仓都有别的消费者，最小 4 处） |
| 0-E3j ✅ | **热点榜并列第十四的文件集群**：`ProjectCreationWizard.tsx` 14 → 0——**已实施，见本节末 0-E3j 记录** | 14 处落 **5 行**（其中 3 行是同一模态外壳串的复用）；跨 `gray` 12 ＋ `white` 1 ＋ `black` 1；`bg` 6 ／ `border` 4 ／ `text` 4；含模态遮罩 `bg-black/50`（值链实测 50%）与**响应式 `sm:` 前缀**（全屏 → `sm:rounded-lg sm:border`）；变体含 `hover:` / `dark:hover:`；**0 字面迁后归零、0 桶归零**（本片 12 个派生字面在全仓都有别的消费者，最小 2 处） |
| 0-E3k ✅ | **热点榜并列第十四的文件集群**：`ShellHeader.tsx` 14 → 0——**已实施，见本节末 0-E3k 记录** | 14 处落 **6 行**；族 `gray` 13 ＋ `white` 4（`text-white` 与 `hover:text-white` 各 2）；`text` 8 ／ `border` 3 ／ `bg` 3；**两处透明度**（`border-gray-600/80` 80%、`bg-gray-700/70` 70%，值链均实测）；含 `disabled:text-gray-500` 伪类状态；**同一 className 串内语义彩色（orange / red / blue）未触碰**；**文件含 3 处前片遗留令牌 `focus:ring-offset-n-gray-800`——正向重放第二次复用（遗留令牌还原出的字面在备份中不存在、自动落选）**；**3 字面迁后全仓零消费、0 桶归零**（同桶另有别变体字面存活） |
| 0-E3l ✅ | **热点榜并列第十四的文件集群**：`TaskBoardContent.tsx` 14 → 0——**已实施，见本节末 0-E3l 记录** | 14 处落 **7 行**；族 `gray` 12 ＋ `white` 1 ＋ `black` 1；`text` 8 ／ `bg` 6（无 `border`）；**两处透明度**（`bg-white/60` 60%、`dark:bg-black/20` 20%，值链均实测）；变体含裸类 / `dark:`；属于看板"暂无任务"空态与卡片计数徽标；**4 字面迁后全仓零消费、1 桶归零**（`bg: gray-300` 1→0；同桶另有别变体字面存活，`dark:bg-gray-600` 字面已全仓零消费但 `bg: gray-600` 桶仍存 1） |
| 0-E3m ✅ | **热点榜并列第十二的文件集群**：`ToolDiffViewer.tsx` 12 → 0——**已实施，见本节末 0-E3m 记录** | 12 处落 **4 行**（含一行状态串、一行容器、一行头部、一行文本）；族 `gray` 12；档位 `gray-50 / 100 / 200 / 500 / 600 / 700 / 800`；`text` 4 ／ `border` 4 ／ `bg` 4；**4 类透明度 / 6 处**（`border-gray-200/60`、`dark:border-gray-700/50` 各 ×2，`bg-gray-50/80`、`dark:bg-gray-800/40` 各 ×1，值链均实测）；变体含裸类 / `dark:`；属工具 diff 视图的头部条与状态文字；**3 字面迁后全仓零消费、0 桶归零**（同桶另有别变体字面存活） |
| 0-E3n ✅ | **热点榜并列第十二的文件集群**：`MarkdownPreview.tsx` 12 → 0——**已实施，见本节末 0-E3n 记录** | 12 处落 **5 行**（markdown 渲染器的引用块 / 表格 / 表头 / 单元格等 element 映射）；族纯 `gray` 12；档位 `gray-50 / 200 / 300 / 400 / 600 / 700 / 800`；`border` 8 ／ `text` 2 ／ `bg` 2；**零透明度**；变体含裸类 / `dark:`；**2 字面迁后全仓零消费、1 桶归零**（`border: gray-300` 1→0；`dark:border-gray-600` 字面已全仓零消费但 `border: gray-600` 桶仍存 2） |
| 0-E3o ✅ | **热点榜并列第十二的文件集群**：`UserMessageStickyHeader.tsx` 12 → 0——**已实施，见本节末 0-E3o 记录** | 12 处落 **4 行**（一条 sticky 提示条外壳串 + 两处图标 + 一处文本）；族 `gray` 11 ＋ `white` 1；档位 `gray-100 / 200 / 400 / 500 / 700 / 800` ＋ `white`；`text` 6 ／ `bg` 4 ／ `border` 2；**两处透明度均 95%**（`bg-white/95`、`dark:bg-gray-800/95`，值链实测）；变体含裸类 / `hover:` / `dark:hover:`；**2 字面迁后全仓零消费、0 桶归零**（同桶另有别变体字面存活） |
| 0-E3p ✅ | **热点榜并列第十一的文件集群**：`TerminalShortcutsPanel.tsx` 11 → 0——**已实施，见本节末 0-E3p 记录** | 11 处落 **4 行**（含两行按钮串复用 ＋ 一行蓝底按钮 ＋ 一行外壳）；族 `gray` 8 ＋ `white` 3；档位 `gray-100 / 600 / 700 / 900` ＋ `white`；`text` 5 ／ `bg` 3 ／ `border` 3；**两处透明度**（`border-gray-700/80` 80%、`bg-gray-900/95` 95%，值链均实测）；变体含裸类 / `active:`；**同一 className 串内语义彩色（blue-500/600）未触碰**；**3 字面迁后全仓零消费、1 桶归零**（`border: gray-600` 2→0；`active:text-white` / `bg-gray-900/95` 字面已全仓零消费但 `text: white` / `bg: gray-900` 桶仍有存活） |
| 0-E3q ✅ | **热点榜并列第十一的文件集群**：`TextContent.tsx` 11 → 0——**已实施，见本节末 0-E3q 记录** | 11 处落 **3 行**（两行 `<pre>` 代码块串 ＋ 一行纯文本 `<div>`）；族纯 `gray` 11；档位 `gray-50 / 100 / 200 / 300 / 700 / 800 / 900 / 950`；`text` 5 ／ `bg` 4 ／ `border` 2；**三处透明度均 50%**（`border-gray-200/50`、`dark:border-gray-700/50`、`dark:bg-gray-800/50`，值链均实测）；变体含裸类 / `dark:`（4 个）；**4 字面迁后全仓零消费、0 桶归零**（9 个桶均仍有别变体字面存活，如 `bg: gray-950` 4→3） |
| 0-E2j+ | **其余按文件集群施工**：`bg-gray-100 dark:bg-gray-700 → bg-n-gray-100 dark:bg-n-gray-700`（非 gray 同理走 `n-zinc` / `n-slate` / `n-neutral`），热点文件单独成片。**热点榜已更新到 0-E3q 之后**：`BrowserUsePanel.tsx` 11、`QuickSettingsHandle.tsx` 10、`WorkspacePathField.tsx` 10、`ProviderLoginModal.tsx` 9、`WizardProgress.tsx` 9、`SidebarModals.tsx` 8 | 见 §6 下"切片粒度"；每片跑基线快照收敛 + 守恒律**双绿**才算过；**迁移前先点名确认每个档位在 `index.css` 有 L1+L2 双声明**（见 0-E2i 的前置检查）。**注意**：非 gray 的剩余处分散在 `AccountContent.tsx`、`NextTaskBanner.tsx` 等；stone 全仓 0 处 |
| 0-F | **Git 图 + 其余零散硬编码**（`MobileTerminalSelection` 等） | 体量小，收尾 |
| 0-G | **`index.css` 后半段 66 处暗色补偿** | **必须等 `color-scheme` 先上**（§5.6），否则会令牌化一堆本可删除的补偿 |

**切片粒度（v3）**：按**文件集群**而非色值类型切片——中性色分布在 **65 个文件**（0-E3q 后；含轴限定形态，覆盖面口径见 0-E2e 记录），同模块语义一致、review 上下文完整。热点文件必须单独成片（`BrowserUsePanel.tsx` 11、`QuickSettingsHandle.tsx` 10），避免单个 PR 塞进几十处替换。**已落地四十一片**：`AgentConnectionsStep.tsx` 60 → 0（0-E2b，首批含非 gray 族）、`AskUserQuestionPanel.tsx` 84 → 0（0-E2d，#1 热点、纯 gray）、`Tooltip.tsx` 等 4 文件的 15 处轴限定形态 → 0（0-E2e，扫描器覆盖面片）、`TaskDetailModal.tsx` 72 → 0（0-E2f，#2 热点、纯 gray）、`McpServerFormModal.tsx` 69 → 0（0-E2g，#3 热点、密度最高）、`TaskBoardToolbar.tsx` 60 → 0（0-E2h，#4 热点、零透明度）、`VersionUpgradeModal.tsx` 55 → 0（0-E2i，#5 热点、token 最多）、`CodeEditorHeader.tsx` 52 → 0（0-E2j，#6 热点、text 为主且无 border）、`FolderBrowserModal.tsx` 46 → 0（0-E2k，#7 热点、含模态遮罩）、`TaskEmptyState.tsx` 46 → 0（0-E2l，#8 热点、透明度集中于同一 token）、`AccountContent.tsx` 41 → 0（0-E2m，#9 热点、四族混合、独占拼写批量样本）、`toolConfigs.ts` 38 → 0（0-E2n，#10 热点、类名映射表、纯 gray 零 bg）、`QuestionAnswerContent.tsx` 35 → 0（0-E2o，#11 热点、含豁免、透明度最多）、`NextTaskBanner.tsx` 33 → 0（0-E2p，#12 热点、slate 主导）、`TaskMasterSetupModal.tsx` 32 → 0（0-E2q，#13 热点、三工具均衡）、`GithubAuthenticationCard.tsx` 31 → 0（0-E2r，#14 热点、中段档位集中）、`PrdEditorHeader.tsx` 30 → 0（0-E2s，#15 热点、零透明度、两原子归零与两字面全仓零消费一一对应）、`GenerateTasksModal.tsx` 30 → 0（0-E2t，#16 热点、三工具均衡、含模态遮罩 `bg-black/50`）、`CreateTaskModal.tsx` 30 → 0（0-E2u，#17 热点、与 0-E2t 逐 token 同构）、`TaskHelpModal.tsx` 30 → 0（0-E2v，#18 热点、`text` 为主、带透明度 2 处）、`TaskCard.tsx` 30 → 0（0-E2w，#19 热点、跨 gray/slate 两族、4 个 slate 原子归零）、`fileIcons.ts` 28 → 0（0-E2x，#20 热点、仅 2 个 token、28 行一行一处）、`TaskListContent.tsx` 24 → 0（0-E2y，#21 热点、纯 gray 单族 8 档）、`MessageComponent.tsx` 24 → 0（0-E2z，#22 热点、无 border、2 字面归零但 0 桶归零）、`CodeEditorBinaryFile.tsx` 23 → 0（0-E3a，#23 热点、23 处仅落 6 行的高密度片、首个 `md:` 变体）、`CodeEditorMediaPreview.tsx` 22 → 0（0-E3b，#24 热点、与 0-E3a 同模块姊妹组件、首次暴露 `index.css` 选择器级消费者缺口）、`TaskFiltersPanel.tsx` 22 → 0（0-E3c，#25 热点、与 0-E2h 同模块、22 处落 8 行）、`TaskQuickSortBar.tsx` 18 → 0（0-E3d，#26 热点、6 token 各 ×3、1 字面迁移后全仓零消费）、`OverwriteConfirmModal.tsx` 18 → 0（0-E3e，#27 热点、18 处落 17 token、含遮罩 `bg-black/50`）、`StepReview.tsx` 18 → 0（0-E3f，#28 热点、`text` 14／`bg` 2／`border` 2、含 `dark:bg-gray-900/50`）、`SidebarProjectItem.tsx` 16 → 0（0-E3g，#29 热点、两处透明度、7 字面迁后全仓零消费且 2 桶归零）、`taskKanban.ts` 16 → 0（0-E3h，#30 热点、16 处落 4 行、中性/语义彩色在同一配置表交错、9 字面迁后全仓零消费且 7 桶归零）、`ImageViewer.tsx` 14 → 0（0-E3i，#31 热点、14 处落 7 行、文件含前片遗留令牌、首次修正产物核对脚本的前提假设缺口）、`ProjectCreationWizard.tsx` 14 → 0（0-E3j，#32 热点、14 处落 5 行、含模态遮罩与 `sm:` 响应式）、`ShellHeader.tsx` 14 → 0（0-E3k，#33 热点、14 处落 6 行、含前片遗留令牌、3 字面归零而 0 桶归零），`TaskBoardContent.tsx` 14 → 0（0-E3l，#34 热点、14 处落 7 行、空态与卡片计数徽标、4 字面归零而 1 桶归零），`ToolDiffViewer.tsx` 12 → 0（0-E3m，#35 热点、12 处落 4 行、纯 gray、4 类透明度 6 处、3 字面归零而 0 桶归零），`MarkdownPreview.tsx` 12 → 0（0-E3n，#36 热点、12 处落 5 行、markdown element 映射、2 字面归零而 1 桶归零），`UserMessageStickyHeader.tsx` 12 → 0（0-E3o，#37 热点、12 处落 4 行、含 `hover:` / `dark:hover:` 伪类与两处 95% 透明度、2 字面归零而 0 桶归零），`TerminalShortcutsPanel.tsx` 11 → 0（0-E3p，#38 热点、11 处落 4 行、含 `active:` 伪类、语义蓝未触碰、3 字面归零而 1 桶归零），`TextContent.tsx` 11 → 0（0-E3q，#39 热点、11 处落 3 行、两行 `<pre>` 代码块串 ＋ 一行纯文本 `<div>`、三处 50% 透明度、4 字面归零而 0 桶归零）。**每片的通过门槛是"双绿"**：快照基线按预期减少（证明字面在消失）＋ 守恒律零漂移（证明换上去的令牌对且保形），见 0-E2c 记录。

**`dark:` 处置不设独立片**：它必须并入各文件集群片的同一个 diff（`bg-x dark:bg-y` 是成对结构，见 §5.7）。本阶段对 `dark:` 的产出只是纸面工作（分类清单），不是独立施工片。

**豁免清单是单一事实源（v3）**：必须**机器可校验**，不能只写在 `index.css` 顶部注释里（注释会漂移）。建议独立清单文件（`文件:行号` 或 `模式 + 理由`），验收脚本以 allowlist 排除方式执行；新代码引入硬编码时先过清单。**§5.7 的三分法分类清单与本豁免清单是同一份资产，一次建设、共同消费。**

**每片完成的定义（DoD 三件套，固定化）**：

1. **该片 grep 清零**（对机器可校验 allowlist）：§5.7 的 ①②③ 三条命令在该片覆盖文件上收敛到豁免清单内
2. **视觉基线比对，阈值 0**：Playwright 截图（`toHaveScreenshot` 或 + `pixelmatch`），对聊天页 / 设置页 / 终端页 / 编辑器 diff / Git 图 / 权限面板在 light、dark 下各拍基线图。这是把"零变化"这一**定量承诺**定量验收——纯人工肉眼回归发现不了 alpha 偏移 5%、光标色微差、滚动条宽 1px
3. **计算值等值断言（0-A 片必做，其余片可选）**：改写前后对全部令牌取 `getComputedStyle` 的 resolved value，逐位相等断言。0-A 片的"视觉零变化"最难验证（`hsl(var(--x))` 包裹与 HSL 通道拆分是否等值，像素比对受反锯齿与字体渲染干扰），纯 JS 断言比截图回归更精确、更轻、可逐令牌定位失败点

**额外要求**：`npm run test:client`、`npm run build:client`、`npm run typecheck`、`npm run lint` 全绿；§5.11 的令牌契约测试通过。

**阶段 0 的定量终点**：整仓中性色具名类从 1502 处收敛到"仅豁免清单命中"，**而非"计划内的片改完就算完"**。0-E0 已把它变成可测的：`src/shared/tests/theme-hardcoded-baseline.json` 的 `total` 即当前待迁移量，终点是 **`total = 0`**（豁免项不计入），护栏在每片提交时强制显式刷新该数。

**配对层护栏（0-E2c 补，固定化）**：DoD 第 1 项只证明"字面在减少"，对"换上去的类是否等于被换掉的类"零约束——0-E2 的 V2（错档位）/ V3（丢透明度）/ V4（丢变体）实测都能穿过它。现以 `src/shared/tests/themeAtomConservation.test.ts` 的**守恒律**补齐：中性色按 `变体链 工具类: 族-档/透明度` 建成仓库级普查，**在 `src/` 中字面拼写与 `n-*` 拼写共享同一个桶**，冻结快照 `theme-atom-conservation.json`（当前总量 **1517**，0-E2e 扩面后；含轴限定工具类）。因此每片的通过门槛是"双绿"——快照 `total` 按预期减少 **且** 守恒律零漂移；新增中性色（字面或 `n-*`）需在同一个 commit 里刷新冻结值并逐桶核对 diff。

**价值**：立即解决"终端 / 编辑器配色与界面不搭"的实际问题，且是 1/2 的前置。

#### 0-A 实施记录（2026-09-25）

**改动**：`src/index.css` 的 `:root` / `.dark`——19 个 L1 palette 令牌（命名见附录 A），全部颜色类 L2 令牌（含 `--nav-*` 的 alpha 项）改写为 `var(--palette-*)` 引用。**语义命名未动、尺寸类令牌未动、Tailwind 配置未动、16 处 `hsl(var(--x))` 未动**（理由见 §5.1 v4）。

**新增契约测试**：`tests/theme-tokens/`（独立 Vite fixture + Playwright，照 `tests/transcript-layout/` 模式；`npm run test:theme-tokens`、`npm run typecheck:theme-tokens`）。四项检查：

| 检查 | 作用 |
|---|---|
| resolved 值与签入基线逐位相等 | 把"视觉零变化"变成可测断言（令牌字符串 + 经 `hsl(var(--x))` 真实解析的颜色双层） |
| 基线覆盖样式表声明的全部令牌 | 新增令牌必须显式入库，否则不受护栏 |
| 每个 palette 令牌都有消费者 | 防 DSH #3 那类"死令牌"（覆盖它却不改变任何 UI） |
| 无颜色声明绕过 palette | 0-A 的收口护栏 |

后两项读**声明文本**而非 resolved 值：`getComputedStyle` 会先展开 `var()`，间接层在那里不可见（这是实施中踩到的第一个坑）。

**验收证据**：

- **零漂移**：改写后用**改写前**的基线跑检查 1，全部令牌 resolved 值跨 chromium / webkit 逐位相等（该次运行中"基线覆盖"一项因"新增 palette 令牌未入库"而红，恰好反证了"只有新增、没有改动"）；随后固化新基线，8 项检查全绿
- `npm run test:client` 122 文件 / 847 用例通过；`typecheck`、`typecheck:theme-tokens`、`lint`（0 error）、`build:client` 全绿
- 生产产物核对：19 个 palette 令牌均进入 `dist` CSS，且 minifier **保留** `var()` 引用（`--background: var(--palette-sand-50)`）——若被展开成字面值，主题覆盖就失效了，这一步是必须的

**替代截图回归的理由**：DoD 第 2 项要求阈值 0 的视觉基线。0-A 用**计算值等值断言**替代（DoD 第 3 项本就把这一项标为"0-A 片必做"，理由是"纯 JS 断言比截图回归更精确、更轻、可逐令牌定位失败点"）：截图比对受反锯齿与字体渲染干扰、跨机漂移，而计算值断言能定位到具体令牌。0-A 是纯变量来源改写，令牌值不变即渲染不变，该替代在此片是**更强**的保证。真实渲染路径由 fixture 的 probe（`hsl(var(--x))` 实解析颜色）覆盖。

**实施中发现的坑（对后续片与主题机制有用）**：`src/index.css:328-337` 给所有 `div`/`span`/`p` 等加了 `transition: background-color/border-color/color 200ms`（"Color transitions for theme switching"）。这意味着**主题/明暗切换时全站颜色是渐变过渡的**，任何"切换后立即读颜色"的验收代码都会读到过渡起始值。fixture 用内联 `transition: none` 规避；阶段 1 的"首帧无闪烁"验收与主题切换动画设计都应把这条既存行为纳入考虑。

**行号偏移说明**：0-A 在 `:root` 内新增 palette 层，使 `index.css` **176 行之后的内容整体下移 35 行**（逐行核对：原 382/592/654/746/964/1019/1062/1063 → 417/627/689/781/999/1054/1097/1098）。**正文引用已全部同步**；文末批注区保留审阅者写作时刻的原始行号，未做改动。

#### 0-B 实施记录（2026-09-25）

**改动**：语法高亮主题从"chat 模块私有"提升为共享形态。

| 文件 | 变化 |
|---|---|
| `src/shared/syntaxTheme.ts`（新增） | `buildSyntaxTheme` / `PrismStyleSheet` / `SyntaxTheme` 由 `src/modules/chat/utils/syntaxHighlightTheme.ts` 迁入（构建逻辑一字未改，`:33-75`）；新增 `syntaxTheme` 单例（`:82`）与 `cc-syntax-theme` 样式注入（`:84-95`） |
| `src/shared/tests/syntaxTheme.test.ts`（迁移） | 原 `src/modules/chat/tests/syntaxHighlightTheme.test.ts`，改指 shared 模块（lossless 断言不变） |
| `src/modules/chat/transcript/Markdown.tsx` | 删除本地 `buildSyntaxTheme` 调用与样式注入，改导入共享单例（`:14`、`:182`） |
| `src/modules/code-editor/markdown/MarkdownCodeBlock.tsx` | `style={isDarkMode ? prismOneDark : prismOneLight}` → `style={syntaxTheme.style}`（恒定，`:69`）；直连 Prism 主题的导入删除 |
| `src/modules/code-editor/tests/markdownCodeBlockSyntaxTheme.test.tsx`（新增） | 4 项护栏 |
| `.oxlintrc.json` | `boundaries/elements` 的 `frontend-shared-file` 清单加入 `src/shared/syntaxTheme.ts` |

**为什么必须迁移，而不是"让 code-editor 从 chat 的 barrel 导入"**：`Markdown.tsx:9` 已 `import { MermaidDiagram } from '@/modules/code-editor'`——**chat 依赖 code-editor**。若 code-editor 反向依赖 chat 的主题模块，即构成模块环；规范也要求跨模块只经 `index.ts`。shared 是唯一合法落点。

**为什么保留 `isDarkMode`**：`MarkdownCodeBlock` 的 `customStyle`（light 下 `background: hsl(var(--muted))`）与 `codeTagProps` 不是语法高亮配色，而是**容器背景策略**，且已是变量引用。0-B 只替换 `style` prop 的来源，保留该分支即实现视觉零变化——dark 下 `<pre>` 背景由 `syntaxTheme.style` 的 `pre` 规则提供，取值等于改前的 `prismOneDark`。

**护栏与反向验证**：新增 4 项测试断言 ① 每个 token 颜色都是 `var(--cc-syntax-N)`；② `<pre>` 自身颜色也是变量；③ light 与 dark 渲染出的 token 颜色序列**完全相同**；④ 注入样式表声明了被引用的变量。为确认护栏不是"假绿"，用 `git stash` 把 `MarkdownCodeBlock.tsx` 临时回退到改写前实现重跑——**4 项全红**（`token colour "rgb(166, 38, 164)" is not a variable`、明暗 token 颜色不同、样式表未注入），随后 `git stash pop` 复原。

**验收证据**：

- `npm run test:client` 123 文件 / 851 用例通过（基线 122/847；净增 = 新增 1 文件 4 用例，迁移不改计数）
- `typecheck`、`lint`（153 warnings / **0 error**，与 0-A 后基线一致）、`build:client` 全绿
- 该片 grep 清零：`from 'react-syntax-highlighter/dist/esm/styles/prism'` 全仓仅剩 `src/shared/syntaxTheme.ts`（单一事实源）与其测试；`cc-syntax-theme` 注入点唯一
- code-editor 路径**自足**：护栏测试只导入 `MarkdownCodeBlock`（不经 chat），仍断言到样式表已注入——证明编辑器单独加载时主题可用

**实施中发现的坑（对阶段 1/2 有用）**：本仓的架构边界（`.oxlintrc.json:43-120`）把 `src/shared/` 下的**单文件逐个登记**在 `frontend-shared-file` 清单里，`boundaries/include` 也只收录 `src/shared/*.ts` 这一层。新增 shared 文件若不登记，`boundaries(no-unknown)` 会直接报 **error**（不是 warning），使 `npm run lint` 失败。阶段 1 若新增 shared 级模块（如主题注册表），必须同步登记。

#### 0-C 实施记录（2026-09-25）

**改动**：终端配色从"JS 里写死"改为"CSS 令牌 + 运行期解析"。

| 文件 | 变化 |
|---|---|
| `src/index.css` | L1 新增 20 个 `--palette-term-*`（`:80-105`）；L2 新增 22 个 `--term-*`（6 基础 + 8 正常 + 8 bright，`:142-168`）与 4 个语义别名（`:170-177`）。**只在 `:root` 声明**——终端明暗共用同一深色板（§8.3 已决） |
| `src/modules/shell/utils/terminalTheme.ts`（新增） | `TERMINAL_THEME_TOKENS`（token→xterm 键）+ `readTerminalTheme()`：探针元素写 `hsl(var(--token))`，用 `getComputedStyle` 把令牌解析成 xterm 需要的具体颜色 |
| `src/modules/shell/hooks/useShellTerminal.ts` | 删除 38 处 hex 与 `extendedAnsi`；构造 Terminal 时 `theme: readTerminalTheme()`；新增"切换明暗时重读令牌重设 theme"的 effect |
| `tests/theme-tokens/main.ts` | PROBES 增加全部终端令牌（含 4 个别名），并暴露 `readTerminalTheme` 供浏览器内直调 |
| `tests/theme-tokens/terminal-tokens.spec.ts`（新增） | 4 项护栏 |

**为什么必须引入运行期解析**：xterm 把内容画进 canvas，`ITheme` 只接受具体色值、不支持 `var()`——这正是 §5.7 与 §5.6 早已标明的"JS 消费者"约束。解析用**探针元素**而不是 `getPropertyValue('--x')`：后者返回的是三元组字符串（`0 0% 11.8%`），而 xterm 5.5.0 的颜色解析器（`common/Color.ts` 的 `toColor`）只可靠支持 `#rgb[a]` / `#rrggbb[aa]` / `rgb()` / `rgba()`；探针经浏览器解析后返回规范的 `rgb(r, g, b)`，与 Tailwind 的 `hsl(var(--x))` 消费路径完全一致，且把格式风险挡在构建期测试里。

**L1 格式沿用三元组**：终端板的 hex 值按 CSS 的 HSL 算法换算（1 位小数即可精确往返）；20 个 `--palette-term-*` 覆盖 19 个不同色值（`--palette-term-cursor` 与 `--palette-term-bright-white` 同为 `#ffffff`，按角色分开命名）。**往返精度可证，不是"看着对"**——护栏断言每个 xterm 主题键解析出的颜色等于改造前那串 hex 的 `rgb()`。

**`extendedAnsi` 废弃 —— 本片唯一有意的渲染变更**：附录 A 建议废弃这 16 个值；执行时确认了比"减少变量"更硬的理由：xterm 把 `theme.extendedAnsi[i]` 写入 `colors.ansi[16..31]`（`browser/services/ThemeService.ts`），而这 16 个槽位是 **256 色 6×6×6 立方体的前 16 项**（`#000000` / `#00005f` / `#000087` …），并非第二套 ANSI 梯度。原硬编码的 VGA 板（`#800000` / `#008000` / …）会把这 16 个槽位画错、破坏立方体。故**未采用"由 bright 系列推导"的字面做法**（那仍会占用这 16 个槽位），而是**删掉该字段**，把槽位交回 xterm 的标准立方体。

- 影响面：仅 `\e[38;5;16m`…`\e[38;5;31m` 这类显式 256 色码。**ANSI 0–15（`\e[31m` 等）与 232–255 灰阶不受影响**；终端页截图也不经过这些槽位
- 这**违反阶段 0"视觉零变化"的字面要求，属明知并有意**的例外（依据是附录 A 的既有处置意见），故在此显式记账。若要求严格零变化，恢复方式即补回 16 个令牌

**护栏与反向验证**：

- **类型层面**：`TERMINAL_THEME_TOKENS` 用 `satisfies Record<ThemedColourKey, string>` 约束，键集由 xterm 的 `ITheme` 推导（排除 `selectionInactiveBackground`——终端从未设置它，xterm 默认的半透明白没有对应令牌）。**实测删掉 `brightWhite` 一行，`npm run typecheck` 立即报 TS1360**，证明漏键在编译期就被拦住
- **行为层面 4 项**：token 颜色解析回原 hex 板、语义别名与 `--term-ansi-*` 同色、明暗两态同板、`extendedAnsi` 不再被覆写。**反向验证**：把 `--palette-term-red` 临时改成 `0 61.4% 70%`，护栏报 `red: expected rgb(205, 49, 49), got rgb(225, 132, 132)`
- **顺带确认了两层护栏的分工**：把该值改成 `49.9%`（渲染结果不变）时，只有"令牌字符串 vs 基线"那条报错，终端护栏仍绿——**字符串层保令牌同一性，渲染层保视觉同一性**

**验收证据**：

- **零漂移**：用 0-C 前的基线跑契约测试，**"resolved token values match the checked-in baseline" 全绿**（既有令牌逐位未变）；唯一红灯是"baseline covers every token"，未覆盖项**恰好只有新增的 46 个令牌**（20 palette + 26 L2），反证"只新增、未改动"。随后固化基线，16 项检查（8 × chromium/webkit）全绿
- `npm run test:client` 123 文件 / 851 用例通过（与 0-B 相同——终端护栏落在 Playwright fixture 而非 vitest：该行为只在真实浏览器里可验）
- `typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`build:client` 全绿
- 生产产物：20 个 `--palette-term-*` 全部进入 `dist` CSS，且 minifier **保留**整条间接链（`--term-ansi-red: var(--palette-term-red)`、`--term-error: var(--term-ansi-red)`）
- 该片 grep 清零：`useShellTerminal.ts` 与 `terminalTheme.ts` 已无任何 hex / rgb 字面量

**实施中发现的坑**：终端的明暗刷新只能靠 `useTheme().isDarkMode` 触发，而 `.dark` 的 class 切换是本项目当前**唯一**的"主题信号"。阶段 1 引入 `data-theme` 后必须扩展这个信号，否则换主题不会刷新已打开的终端——这与 §5.6"JS 消费者需要主动刷新"是同一条约束，CodeMirror 侧同理。

**行号偏移**：0-C 在 `index.css` 的 `:root` 内共插入 64 行，`:root` 之后的全部内容下移 64 行（逐行核对：原 382/592/654/746/964/1019/1062/1063 → 481/691/753/845/1063/1118/1161/1162）。正文引用已同步（`:root`/`.dark` 区间改为 `45-239`、`.dark` 起点改为 `:207`、暗色补偿段改为 `481-691` 等）；文末批注区与两轮牵头结论保留写作时刻的原始行号，未做改动。

#### 0-D 实施记录（2026-09-25）

**改动**：编辑器配色从"第三方主题 + `isDarkMode` 三元"改为"CSS 令牌 + 自建 CodeMirror 主题"。

| 文件 | 变化 |
|---|---|
| `src/index.css` | L2 新增 **43 个** `--editor-*`（29 个 UI/面板/搜索/折叠/tooltip/自动补全 + 13 个 diff/toolbar/minimap/loading + 1 个 invalid）。`:root` 写 light 值（= CodeMirror base theme 与 `defaultLightThemeOption` 当前渲染值），`.dark` 覆盖为 oneDark 值 |
| `src/modules/code-editor/utils/editorTheme.ts`（新增） | `editorChrome`（两态共用的 `EditorView.theme()` 规则，颜色全 `var()`）、`editorLightTheme` / `editorDarkTheme`（共用规则集，仅 `dark` 标志与一条 `.cm-content ::selection` 不同）、`editorHighlightStyle` / `editorHighlightExtension`（`HighlightStyle.define()`，颜色经 `SYNTAX_TOKEN_MAP` 指向 `--cc-syntax-N`） |
| `utils/editorStyles.ts` | 13 处 `isDarkMode ? A : B` → `var(--editor-diff-*)` / `var(--editor-toolbar-*)`；两个 getter 退化为常量 `EDITOR_STYLES` / `EDITOR_LOADING_STYLES` |
| `CodeEditorSurface.tsx` | `theme={isDarkMode ? oneDark : undefined}` → `theme={isDarkMode ? editorDarkTheme : editorLightTheme}`，`oneDark` 导入删除 |
| `CodeEditor.tsx` | `<style>{EDITOR_STYLES}</style>`；extensions 数组加 `editorHighlightExtension` |
| `CodeEditorLoadingState.tsx` | `isDarkMode` 成为孤儿 prop（样式不再需要），连同调用点一并删除 |
| `src/shared/syntaxTheme.ts` | 新增 `SYNTAX_SELECTORS`（语义名 → Prism `selector.property`）、`collectSyntaxVariables`、`deriveTokenMap`、`SYNTAX_TOKEN_MAP` |
| `tests/theme-tokens/main.ts` | PROBES 支持 `wrap: 'raw'`，为 38 个编辑器颜色令牌加裸 `var()` 探针 |
| `src/shared/tests/syntaxThemeTokenMap.test.ts`、`src/modules/code-editor/tests/editorThemeTokens.test.ts`（新增） | 6 + 5 项护栏 |

**关键判断：编辑器不需要 xterm 那样的运行期解析**。CodeMirror 由 CSS 驱动——`EditorView.theme()` 与 `HighlightStyle.define()` 的样式值经 style-mod 原样写进规则，可直接写 `var(--x)`，明暗与主题切换都靠变量翻转，不必重建扩展。这与 0-C 的 xterm（canvas 消费者、`ITheme` 不收 `var()`）恰成对照。**仍是两套规则而非一套**：两态唯一的结构差异是 dark 额外给 `.cm-content ::selection` 上色（light 交给浏览器默认），其余规则共用 `editorChrome`。

**语法面：为什么"共用令牌"必然带来可见变化（本片有意的渲染变更）**。`@codemirror/theme-one-dark` 与 `react-syntax-highlighter` 的 One Dark **不是同一个色板**——前者多出 `chalky #e5c07b`（typeName / className / number / changed / annotation / modifier / self / namespace）与 `stone #7d8799`（meta / comment），Prism 侧无同值槽位。共用 `--cc-syntax-N` 后：

- **dark**：上述 8 个常见 tag 由 `#e5c07b` 变 `#d19a66`，comment 由 `#7d8799` 变 `#5c6370`；其余 tag 与 Prism 同值（同源调色板），如 keyword `#c678dd`、operator/variable/function `#61afef`
- **light**：编辑器语法高亮从 CodeMirror 内置 `defaultHighlightStyle`（`#708` / `#a11` / `#940`）**整体切换为 One Light**，与 chat 代码块一致
- `tags.invalid` 在 Prism 无对应槽位，另立 `--editor-invalid`（light `#f00` / dark `#ffffff`，即原值）保零变化

映射按"**色值组优先、组内取语义最近类别**"选取（如 CM 的 operator 组在 Prism 中同值的只有 `url` 槽位），故少数 tag 的语义名与实际槽位并不对应——这正是阶段 2 语义化改名要重新决策的部分，已在 §5.9 记账。

**有意豁免（本片唯一未令牌化处）**：`editorExtensions.ts` 的 minimap gutter 色（`rgba(34, 197, 94, 0.8/1)`）——`@replit/codemirror-minimap` 用 canvas `fillStyle` 绘制，与 xterm 同属"canvas 消费者"，`var()` 无效。影响面仅 diff minimap 的绿条，且 minimap 背景已令牌化（`--editor-minimap-bg`）。

**护栏与反向验证**：

- `syntaxThemeTokenMap.test.ts` 6 项：语义映射都能解析到真实变量、名字互不重复、变量总数冻结（136）、完整 `selector.property → 变量` 快照、10 个语义槽位的 One Dark 色值冻结、全仓无手写 `--cc-syntax-N`
- `editorThemeTokens.test.ts` 5 项：chrome 全是令牌引用、引用的 `--editor-*` 都已声明、highlight spec 全是 `var()`、借用的 `--cc-syntax-N` 都在 Prism 表中、code-editor 模块不再 import `one-dark`
- **反向验证（逐条确认不是假绿）**：① `keyword` 槽位改指 `number.color` → "名字互不重复"与"One Dark 色值"**双红**（`"keyword" (--cc-syntax-28) moved off its One Dark colour`）；② highlight 颜色写成 `#c678dd` → 红（`a highlight spec holds a literal colour`）；③ chrome 背景写成 `#ffffff` → 红（`chrome holds a literal value`）；④ 两处 `--editor-caret` 声明改名（模拟拼错）→ 红（`referenced but never declared`）。四项改回后均恢复全绿

**验收证据**：

- **零漂移（既有令牌）**：固化基线**之前**先跑一次契约测试——"resolved token values match the checked-in baseline" 14 项全绿（既有令牌逐位未变），唯一红灯是"baseline covers every token"，未覆盖项**恰好只有新增的 86 项**（43 × 明暗），反证"只新增、未改动"；随后固化基线，16 项全绿
- **新令牌探针非假绿**：基线 `rendered` 中 38 个编辑器颜色令牌都解析出具体颜色（light `--editor-bg = rgb(255, 255, 255)`、dark `= rgb(40, 44, 52)`；light `--editor-fg = rgb(13, 11, 8)` 即 `--palette-sand-950`），而非探针失败时的默认值
- `npm run test:client` **125 文件 / 862 用例**通过（0-C 基线 123/851；净增 = 2 文件 11 用例）
- `typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`build:client` 全绿
- 生产产物：43 个 `--editor-*` **全部**进入 `dist` CSS，minifier **保留**间接链（`--editor-bg: hsl(var(--palette-white))`、`--editor-toolbar-bg: hsl(var(--palette-white))` / `#1f2937`）；`var(--editor-invalid)` 与 `cc-syntax-theme` 注入点都在 bundle 里。**注**：`--cc-syntax-N` 字符串**不在**产物中是预期行为——它由 `deriveTokenMap` 在运行期从 Prism 主题对象算出，因此该层的令牌同一性只能由 vitest 断言（specs 全为 `var()`）保证，对产物 grep 不适用
- 该片 grep 清零：`src/` 下 `@codemirror/theme-one-dark` **零导入**（由护栏测试扫描 code-editor 模块持续保证）；`editorStyles.ts` 已无 hex/rgb 字面量

**实施中发现的坑（对后续片与阶段 1 有用）**：

1. `@uiw/react-codemirror` 的 `theme` prop 变化走 `StateEffect.reconfigure`（`useCodeMirror.js:141-148`），保留文档与撤销历史、不重建 view——"切明暗会重建编辑器"的担心不成立
2. `theme={undefined}` 会落到 uiw 的默认参数 `'light'`（`getDefaultExtensions.js`），注入 `defaultLightThemeOption`（仅 `background:#fff`）——**`undefined` 不等于"无主题"**，这也解释了现状 light 侧语法色其实来自 `basicSetup` 的 `defaultHighlightStyle` 兜底
3. 令牌值的形态决定探针写法：`--editor-*` 是**完整颜色表达式**，用 `hsl(var(--x))` 探针会得到无效的 `hsl(#282c34)`，必须用裸 `var(--x)`（`tests/theme-tokens/main.ts` 的 `wrap` 字段）
4. `Array.prototype.flatMap` 的回调**返回 string 会被展开成字符数组**——`match ? [m[1]] : []` 不能简写成 `exec()?.[1] ?? []`；本次调试中该 bug 让"令牌是否已声明"护栏报出全部令牌缺失

**行号偏移**：0-D 在 `index.css` 的 `:root` 内插入 58 行（编辑器块 `:179-236`）、`.dark` 内插入 49 行（编辑器块 `:298-344`），二者合计使 `.dark` 之后的内容整体下移 **107 行**。`:root` / `.dark` 区间由 `45-239` 变为 `45-346`，`.dark` 起点由 `:207` 变为 `:265`，暗色补偿段的 `Color transitions for theme switching` 注释现位于 `:434`。正文引用已按需同步；文末批注区与两轮牵头结论保留写作时刻的原始行号，未做改动。

#### 0-E0 / 0-E1 实施记录（2026-09-25）

二者合成一批交付：0-E0 是**验证设施**（与 A1/B 选型无关），0-E1 是 A1 的**令牌地基**。本批**不做任何类替换**——替换属 0-E2+，按文件集群逐片进行。

**为什么是 A1（保形间接）而不是语义化折叠**：实测本片有 **89 种不同的 `(light, dark)` 元组**（如 `gray-50→gray-800`、`white→gray-800`、`gray-100→gray-700` 各算一种），覆盖约 570 处原子；而**一个令牌类只能承载一对值**。因此"折叠到 ~12–15 个角色令牌"与"像素零变化"不可兼得，实测色差：`text-gray-700→gray-300` 一处 light ΔRGB 100、`bg-white→gray-700` 一处 dark Δ 65。A1 保留档位粒度、恒等映射，把零变化做成**可证明**而非可猜。同族方案对比：A0（config 里把 `gray` 键指向令牌）虽 0 处 TSX 改动，但保留 `bg-gray-100` 字面、使 §5.7 的具名色审计失去意义，且正是 §8.8 拍板排除的路线；A2（折叠语义令牌）干净但放弃零变化。

**0-E0 交付**

| 文件 | 作用 |
|---|---|
| `src/shared/tests/themeHardcodedAtoms.ts`（新增；本批同时收敛） | variant-aware 扫描器：认 `hover:` / `dark:` / `prose-pre:` / `bg-gray-900/50` / `shadow-black/[0.025]`。与 §5.7 的 grep 逐条对齐；**测试目录整体排除**（spec 里引用类名是描述行为，不画产品 UI；审计资产自身也必须能写出它要找的类名），故只度量 `src/` 下的渲染代码——排除后命中恰为 **1502 处 / 105 文件**，与 §5.7 一致 |
| `src/shared/tests/themeHardcodedAllowlist.ts`（新增） | **永不**迁移项：`file + token + 理由`，逐条窄匹配（同 token 出现在别处即失败——"豁免"不能悄悄变成"遗忘"）。当前仅 1 条，见下方"发现的既有 bug" |
| `src/shared/tests/theme-hardcoded-baseline.json`（新增） | **待迁移**派生快照：`total` + `byFile` + `byAtom` 计数。**计数而非行号**（行号随无关编辑漂移），`byAtom` 另可抓住"同文件内一增一减"的替换 |
| `src/shared/tests/themeHardcodedAtoms.test.ts`（新增） | 2 项护栏：① 豁免清单无死项；② 剩余命中 ⊆ 基线（失败时逐条报出 `file …: baseline 1, now 0` / `atom text: white: …`）。刷新：`UPDATE_THEME_HARDCODED_BASELINE=1` |

**0-E1 交付**

| 文件 | 变化 |
|---|---|
| `src/index.css` | L1 新增 **11 个** `--palette-gray-50..950`（Tailwind `gray` 逐档值，**1 位小数 HSL 三元组精确往返**，55 个档位全族实测 0 失配）；L2 新增 **13 个** `--n-gray-50..950` + `--n-white` + `--n-black`。**只在 `:root` 声明**：档位表与外观无关，"明暗差异"仍由各站点选哪个档位表达（`bg-n-gray-100 dark:bg-n-gray-700`），与原字面类行为一致。两个极值**复用**既有 `--palette-white` / `--palette-black`，不另造同值令牌 |
| `tailwind.config.js` | 注册 `n-gray`（11 档）、`n-white`、`n-black` → `hsl(var(--n-*))`。类名形态 `bg-n-gray-100`：`n` = neutral，且不再被 §5.7 的具名色 grep 命中（这正是 A1 让审计可清零的原因）。**阶段 2 改名后本键删除** |
| `src/shared/tests/neutralScale.ts`（新增） | 档位表的单一事实源：`GRAY_STEPS`、`grayHex`（**运行期读 `tailwindcss/colors`**，不重述字面值）、`hexToHslTriplet` / `hslTripletToHex`、命名与声明读取助手 |
| `src/shared/tests/neutralScale.test.ts`（新增） | 31 项等值护栏，见下 |
| `tests/theme-tokens/main.ts` | 13 个 `--n-*` 加 `hsl()` 探针，进契约基线 |

**等值护栏：四段链条，逐段可定位**。承诺是"浏览器画出同一个颜色"，这只在整条链都成立时才为真，故四段分别断言：

```
class  →  tailwind config  →  hsl(var(--n-gray-100))  →  --n-gray-100  →  --palette-gray-100  →  Tailwind 的字面值
        ① test：loadConfig 解析真实配置，12 个键逐一相等      ② test：转发到对应 palette    ③ test：等于 colors.gray[100]
                                                        ④ tests/theme-tokens 基线：浏览器解析出的 rgb() 与 Tailwind 的 rgb 一致
```

其中 ③ 有意做成**非自洽**：`hexToHslTriplet` 必须对全族**无损**（`hslTripletToHex(hexToHslTriplet(hex)) === hex`，31 项中单独一条），否则整条链会"忠实地"保留一个**近似**值。用 `tailwindcss/loadConfig.js` 解析真实配置（而非正则读文本），这样 `n-gray` 少一档、写错变量名、多出未登记的键都会红。**读声明文本而非 `getComputedStyle`**：后者会展开 `var()`，恰好把要考的间接层抹掉（0-B 的教训）。

**反向验证（5 条，逐条确认不是假绿）**：① `--palette-gray-100` 的 `95.9%` 改成 `95%` → 红；② `--n-gray-100` 转发改指 `--palette-gray-200` → 红；③ config 里 `500` 键写成 `hsl(var(--n-gray-5000))` → 红；④ 在 `ComposerAttachment.tsx` 加一处 `bg-gray-500` → 红（`file …: baseline 1, now 2`）；⑤ 把该文件真实的 `text-white` 迁移成 `text-n-white` → 红（`file …: baseline 1, now 0` + `atom text: white: baseline 143, now 142`）。**⑤ 第一次跑时是绿的**——原因是我挑的 `bg-gray-100` 在该文件根本不存在，`sed` 空转；换成真实命中后如期变红。这条提醒：反向验证必须挑**真实命中**，否则"绿"什么也证明不了。

**验收证据**

- **零漂移（既有令牌）**：固化基线**之前**先跑契约测试——"resolved token values match the checked-in baseline" 14 项全绿，唯一红灯是"baseline covers every token"，未覆盖项**恰好只有新增的 26 项**（13 × 明暗），反证"只新增、未改动"；随后固化基线，16 项全绿
- **新令牌探针非假绿**：基线 `rendered` 里 13 个 `--n-*` 都解析出具体 `rgb()`，且 **light 与 dark 完全相同**：`--n-gray-100 = rgb(243, 244, 246)`（= `#f3f4f6`）、`--n-gray-950 = rgb(3, 7, 18)`（= `#030712`）、`--n-white = rgb(255, 255, 255)`、`--n-black = rgb(0, 0, 0)`——逐档与 Tailwind 的 hex 一致
- `npm run test:client` **127 文件 / 895 用例**通过（0-D 基线 125/862；净增 = 2 文件 33 用例）
- `typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**，与 0-D 持平）、`build:client` 全绿
- 生产产物：13 个 `--n-*` 与 11 个 `--palette-gray-*` 全部进入 `dist` CSS，minifier 保留间接链（`--n-gray-100: var(--palette-gray-100)`、`--palette-gray-100: 220 14.3% 95.9%`）；因暂无消费者，**不产出** `bg-n-gray-*` 工具类（预期）
- 该片"grep 清零"**尚未达成**（本批不做替换）：`src/shared/tests/theme-hardcoded-baseline.json` 的 `total` 当前为 **1501**（1502 − 1 条豁免），随 0-E2+ 逐片收敛，终点为 0

**发现的既有 bug（未修，交回负责人）**：`src/modules/chat/tools/ContentRenderers/QuestionAnswerContent.tsx:62` 的 `border-gray-150`——Tailwind 没有 `gray-150` 档位，该类**不生成任何 CSS**，那条边框实际不渲染。按 AGENTS.md"发现无关死代码只报告、不删除"，它以豁免项形式留在清单里，理由写明"要改成 `gray-200` 属于改设计、超出零变化范围"。**这是全仓唯一一条豁免**。

**实测热点榜（中性族口径，`byFile` 前 7）**：`AskUserQuestionPanel.tsx` 84、`TaskDetailModal.tsx` 72、`McpServerFormModal.tsx` 69、`AgentConnectionsStep.tsx` 60、`TaskBoardToolbar.tsx` 60、`VersionUpgradeModal.tsx` 55、`CodeEditorHeader.tsx` 52。与 §5.7 记的前 5 名一致（`VersionUpgradeModal` 55 亦一致），第 7 名起与附录 B 那份含彩色系的 grep 开始分叉。

**非 gray 族的处置（122 处，占 8%）—— 已定 (a)**。实测各族档位用量：`zinc` 57（10 档）、`slate` 40（10 档）、`neutral` 25（10 档）、`stone` **0**；三族各用到 10 个档位（共 30/33 个槽），所以"按需建档"与"全族建档"只差 6 行，**省不下令牌**。两条路里 **(a) 每族各自建档位令牌**被采纳，理由：① (b) 的归并要给等值护栏开 122 条例外，全称断言降级为人工目检——用 60 行 CSS 换掉刚建好的验收设施；② `--n-*` 是阶段 2 前的过渡层，多 3 个命名空间只是一次性成本；③ 与 0-D 的 `--editor-*` 同构（照抄第三方字面值来保零变化）。另一个变体 **config 别名**（在 `tailwind.config.js` 里把 `zinc` / `slate` / `neutral` 指向令牌，0 处 TSX 改动、同样零位移）**已否决**：它使 §5.7 的"1502 → 0"定量终点不可测——grep 再也分不清"合法间接"与"漏改"，省 122 处机械改动换来整套护栏失明，不值。实施见下一小节。

**行号偏移**：0-E1 在 `index.css` 的 `:root` 内插入 **41 行**（L1 档位块 11 行 + 7 行注释 + 空行；L2 `--n-*` 块 16 行 + 6 行注释 + 空行），插入点之前的行号不变，之后整体下移 41 行。**实测**：`:root` 起点仍为 `:46`、区间 `45-346 → 45-387`；`@layer base` 内的 `.dark` 起点 `:265 → :306`（区间 `306-386`）；暗色补偿段的 `.dark` 起点 `:623 → :664`；`Color transitions for theme switching` 注释 `:434 → :475`。

**一处欠账（顺带记账）**：§1.2 #8 与 §5.7 里那组暗色补偿锚点（`481-691`、`:753`、`:845`、`:1063-1118`、`:1161-1162`）写于 **0-C 时代**，0-D 的 +107 当时未同步，本片再 +41，**累计偏移 +148**——按此读作 `629-839`、`:901`、`:993`、`:1211-1266`、`:1309-1310`（抽查 8 个锚点均落在预期的 `!important` 色值行上）。本轮**不逐一改写这两处正文引用**：0-G 施工该块时会按内容重新定位，届时一并校正，避免现在写下的数字再漂一次。

#### 0-E1b 实施记录（2026-09-25）

非 gray 族取 (a)：每族各自建档位令牌；`stone` 不建（0 处消费者，避免死令牌）。**本批不改任何 TSX**，替换仍属 0-E2+。

**交付**

| 文件 | 变化 |
|---|---|
| `src/index.css` | L1 新增 **33 个** `--palette-{zinc,slate,neutral}-50..950`（Tailwind 逐档值，四族 44 档实测**全部精确往返**）；L2 新增 **33 个** `--n-*`。仍**只在 `:root` 声明**（档位与外观无关） |
| `tailwind.config.js` | 注册 `n-zinc` / `n-slate` / `n-neutral`（各 11 档）→ `hsl(var(--n-*))`；注释由 "named greys" 更正为 "named neutrals" 并写明为何不归并 |
| `src/shared/tests/neutralScale.ts` | 由 gray 单族泛化为 `(family, step)` 坐标系：`NEUTRAL_FAMILIES` / `NEUTRAL_STEPS` / `familyHex` / `SCALE_TOKEN_NAMES`；`paletteName`、`tokenName` 改双参 |
| `src/shared/tests/neutralScale.test.ts` | 31 → **100 项**；新增"族内档位封闭"断言——`^--palette-(gray\|zinc\|slate\|neutral)-` 的声明集合必须**精确等于**四族 × 11 档 |
| `tests/theme-tokens/main.ts` | 探针列表由硬编码改为**从 `SCALE_TOKEN_NAMES` 派生**，后续加族/档不必二次编辑 |

**泛化后为什么还是"全称"**：四段链条（`class → config → token → palette → Tailwind 字面值`）对**每族每档**逐条断言，共 44 档 × 3 段。"档位封闭"是原 `no step exists outside the Tailwind ramp` 的推广：正则扩到四族并做**集合相等**（实测给已有族多一个 `--palette-zinc-1000` 会红）。

**一个刻意的职责边界**：新增 `--palette-stone-100` 这类**全新族**不会让本测试变红——正则只认已登记的四族。这不是漏洞而是分工：无消费者的 palette 令牌归 `tests/theme-tokens` 的 `every palette token is consumed by at least one declaration` 管。两条都已实测（下表 N1/N2）。

**反向验证（7 条，全部实测；还原后 100 项复绿）**

| # | 注入的破坏 | 结果 |
|---|---|---|
| M1 | `--palette-zinc-800` 的 `15.9%` → `15%` | 红 |
| M2 | `--n-slate-100` 转发改指 `--palette-slate-200` | 红 |
| M3 | config 里 `n-neutral` 的 `800` 键指到 `--n-neutral-900` | 红 |
| M4 | 新增 `--palette-stone-100` | **绿** → 见 N2，属职责划分 |
| M5 | `--n-zinc-50` 重复声明两次 | 红（"declared exactly once"） |
| N1 | 新增 `--palette-zinc-1000`（已有族多档位） | 红（证明"档位封闭"确实生效，M4 的绿不是断言整体失效） |
| N2 | 新增 `--palette-stone-100` 后跑 `test:theme-tokens` | 红（`palette tokens no declaration references`） |

M4 的绿是本片唯一"预期外"结果，追查后确认是职责划分而非空洞。教训同 0-E1 的 ⑤：**绿必须问清归谁管**。

**验收证据**

- **零漂移（既有令牌）**：固化基线**之前**先跑契约测试，`resolved token values match the checked-in baseline` 全绿；唯一红灯是 `baseline covers every token`，未覆盖项**恰好 66 个**（33 个新 `--palette-*` + 33 个新 `--n-*`，去重后无一落在既有令牌上），反证"只新增、未改动"
- **新令牌探针非假绿**：`--n-zinc-800 = rgb(39, 39, 42)`（= `#27272a`）、`--n-slate-100 = rgb(241, 245, 249)`（= `#f1f5f9`）、`--n-neutral-950 = rgb(10, 10, 10)`（= `#0a0a0a`），且 **light 与 dark 完全相同**
- `npm run test:client` **127 文件 / 964 用例**通过（0-E1 基线 127/895；净增 69 = `neutralScale.test.ts` 由 31 增至 100）
- `typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`build:client` 全绿
- 生产产物：66 个新声明全部进 `dist` CSS；因暂无消费者**不产出** `bg-n-zinc-*` 等工具类（预期）
- `theme-hardcoded-baseline.json` 的 `total` 仍为 **1501**，终点 0 不变（替换未开始）

**行号偏移**：0-E1b 在 `index.css` 的 `:root` 内插入 **75 行**（L1 三族块 33 行 + 4 行注释/空行 + 原 gray 注释扩写 2 行；L2 三族块 33 行）。**实测**：`:root` 起点仍为 `:46`、区间 `45-387 → 45-462`；`@layer base` 内的 `.dark` 起点 `:306 → :381`（区间 `381-461`）；暗色补偿段的 `.dark` 起点 `:664 → :739`；`Color transitions for theme switching` 注释 `:475 → :550`。
**累计偏移**：§1.2 #8 与 §5.7 那组 0-C 时代锚点现为 **+223**（0-D 的 107 + 0-E1 的 41 + 本片 75），按此读作 `704-914`、`:976`、`:1068`、`:1286-1341`、`:1384-1385`（抽查 `:914`/`:976`/`:1068` 落在 `opacity: 1 !important`、`:1384` 落在色值行）。沿用 0-E1 的处置：**不逐一改写正文引用**，0-G 施工该块时按内容重新定位。

#### 0-E2 实施记录（2026-09-25）

**范围**：首个文件集群 ＋ 类级等值护栏的透明度路径 ＋ 实测到的两处隐雷。

**交付**

1. **`AgentConnectionsStep.tsx` 60 → 0**：7 个 provider 卡片的 class 串，gray 10 ＋ zinc 40 ＋ neutral 10；`blue` / `purple` 属三分法第二/三类，不动。18 行改动，逐 token 保形（变体前缀与 `/50` 修饰符原样保留）。
2. **类级等值护栏（第五段链条）**：新增 `neutralScaleCompiler.ts` 的 `compileUtilities()`——用真实 `tailwind.config.js`、经 Tailwind 自带 PostCSS 插件编译探针类名，对 `4 族 × 11 档 ＋ 2 极值` × `3 种 utility` × `3 种 modifier 形态`（plain / `/50` / `/[0.025]`，共 414 个类）逐条断言声明文本恰为 `hsl(var(--n-X))` 或 `hsl(var(--n-X) / α)`，且**只此一条声明**。存在的理由：全仓有 **121 处**中性色命中带透明度修饰符，而具名色走 `rgb(… / var(--tw-bg-opacity, 1))`、令牌色走 `hsl(var(…) / α)`，是两条不同的声明形态——此前这条路径没有任何机器护栏。
3. **旧式 opacity 共现护栏**：扫描器新增 `findOpacityCoupledAtoms()`（同一行同时出现中性色原子与旧式 `*-opacity-*` 工具类即命中），**不设豁免口**——唯二的合法解都是折叠，没有"可以留着"的情形。

**隐雷（实测发现并处置）**

`ImageViewer.tsx:62` 与 `ProviderLoginModal.tsx:128` 的 `bg-black bg-opacity-50`（两个模态遮罩）。具名色经 `--tw-bg-opacity` 渲染，令牌形态 `hsl(var(--n-black))` 不读该变量，**改名即静默丢掉半透明**——遮罩会从半透明变成全黑。折叠为 `bg-n-black/50` 后可证等价：`--n-black = rgb(0, 0, 0)`（明暗相同）⇒ `hsl(0 0% 0% / .5)` ≡ `rgb(0 0 0 / 0.5)`。全仓共 2 处，已清零；护栏从此常驻（先跑护栏确认它**恰好**报出这 2 处真实命中，再修）。

**一处返工与教训**：`compileUtilities` 初版直接写在 `neutralScale.ts` 里，而该模块被 `tests/theme-tokens/main.ts` 打进**浏览器 fixture**；`node:path` 与 Tailwind 编译器的引入让 fixture 整体崩掉（`test:theme-tokens` 由 16 绿变 12 红，报错信息完全指不到根因）。现拆为两文件：`neutralScale.ts` 保持纯数据，Node-only 部分进 `neutralScaleCompiler.ts`。**结论：`src/shared/tests/` 不等于"只在 Node 跑"，改动前先看谁 import 它。**

**零漂移证据（迁移部分）**：刷新基线**之前**先跑护栏，漂移清单**全部为减少、无一增加**，且每个原子级 delta 都能逐条归因——`total 1501 → 1439`（−62 = 本片 60 ＋ 隐雷 2）；`bg: black −2`、`bg: gray-100 −2 / gray-600 −1 / gray-700 −1 / gray-800 −3 / gray-900 −1`、`border: gray-300 −1 / gray-600 −1`、`bg: zinc-* 合计 −32`、`border: zinc-* −8`、`bg: neutral-* −8`、`border: neutral-* −2`。

**反向验证 5 组**（每组先用脚本打印实际替换次数，命中数为 0 即报错退出，杜绝空转假绿；全部突变事后核对残留为 0）

| 突变 | 规模 | 预期 | 实测 |
|---|---|---|---|
| V1 回退一处迁移（`bg-n-zinc-100 → bg-zinc-100`） | 8 处 | 红 | ✅ 红（快照 `total` 与 file/atom 三处漂移） |
| V2 迁到**错档位**（`bg-n-zinc-100 → bg-n-zinc-200`） | 8 处 | ? | ❌ **绿（未检出）** |
| V3 **丢掉透明度修饰符**（`dark:bg-n-zinc-800/50 → dark:bg-n-zinc-800`） | 4 处 | ? | ❌ **绿（未检出）** |
| V4 重新引入旧式共现（`bg-n-black/50 → bg-black bg-opacity-50`） | 1 处 | 红 | ✅ 红（共现护栏 ＋ 快照各一条） |
| V5 令牌值退化为字面 `hsl(240 3.7% 15.9%)` | 1 处 | 红 | ✅ 红（4 项） |

**本片暴露的护栏缺口（重要）**：V2 / V3 未检出，根因是**迁移后的类完全不在任何护栏视野内**——`theme-hardcoded-baseline.json` 只统计"尚未迁移的字面命中"，`n-*` 类不被扫描，`neutralScale.test.ts` 只证明令牌类**能够**正确承载值。也就是说当前护栏能证明的命题是"**字面色在减少**"，**不是**"**换上去的令牌是对的**"。DoD 承诺的"类↔令牌映射表 ＋ 等值断言护栏"正是为此；本片交付了其中的**值层**，**配对层**仍无约束。（**已由 0-E2c 闭合**，见下节。）

**下一步决策点（已由 0-E2c 拍板）**：补配对层，两个候选都能抓 V1 / V2 / V3

- **守恒律** ← **选定**：`扫描到的字面命中 byUsage ＋ 折叠后的 n-* byUsage ≡ 冻结的原始 byUsage`。一次性写完、全派生，后续集群零登记；代价是新增 UI 代码若使用 `n-*`，需随基线一起刷新冻结值（同现有基线刷新仪式）。实施见下节。
- **逐片映射表**（未选）：每个集群登记"该文件迁移前 byAtom → 迁移后 byAtom"，逐文件断言相等。记录更直白、历史可查；代价是 ~40 片各一条登记，且需防止登记本身被复制粘贴带错。

**验收**：`test:client` **127 文件 / 968 用例**（0-E1b 基线 127/964，净增 4 = 3 形态 ＋ 1 共现）；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`build:client`、`test:theme-tokens` 16 项全绿；`--n-*` 探针与令牌基线**未变动**（本片不新增令牌）。产物：迁移后的类产出令牌形态（`bg-n-gray-800\/50` → `hsl(var(--n-gray-800) / .5)`，透明度保留）；`bg-zinc-100` / `bg-neutral-100` 已从 `dist` **消失**（该文件是其唯一消费者）；`.bg-opacity-50` 也从 `dist` 消失（见下）。

**顺带修正**：写在注释里的**合法**类名会被 Tailwind 的 content 扫描（`./src/**/*.{js,ts,jsx,tsx}`，不排除测试）采进生产产物——本片新写的文档注释一度让 `.bg-opacity-50` 继续产出。现一律写成 `bg-opacity-*` 这类**非法**类名，并在注释里说明原因。

#### 0-E2c 实施记录（2026-09-25）

**范围**：闭合 0-E2 暴露的配对层缺口。**不改任何 TSX**，本片是纯护栏片——转移基线仍为 **1439 处 / 104 文件**。

**交付**

1. **守恒律**（`src/shared/tests/themeAtomConservation.test.ts` ＋ `theme-atom-conservation.json`）：仓库级中性色普查，键为 `usageKey`＝`变体链 工具类: 族-档/透明度`（如 `dark:hover bg: gray-100/50`）。字面与 `n-*` 两种拼写**落进同一个桶**，于是一次忠实迁移（纯改名）不动任何桶；而改档位、改工具类、改族、丢 `/50`、丢 `dark:` 都会把计数挪到邻桶，当场红。冻结文件与基线同为快照产物，同一套刷新仪式（`UPDATE_THEME_ATOM_CONSERVATION=1`）。
2. **跨零自洽的免费验证**：冻结总量 **1502**，恰好等于 0-E0 时代的全量字面命中数（当前字面 1439 剩余 ＋ 1 豁免 ＋ 已迁移 62）。也就是说 0-E2b 的 60 处迁移 ＋ 2 处折叠，在**没有任何登记**的情况下被这套普查追溯证明为守恒——守恒律对既有迁移是自洽的，不是只对新片生效。
3. **反空转守卫**（同文件的第一个用例）：逐条断言普查的每个键位**真的有取值**——`n-*` 命中数、带变体的 `n-*`、带透明度的 `n-*`、带透明度的字面量，四条各自 `> 0`。存在的理由：若 `n-*` 正则失效，两侧普查会一起退化成"只有字面量"，冻结文件随刷新照单全收，守恒律将**永远静默通过**。快照类护栏无法自证这一点，只能直接断言扫描形状。
4. **顺手修掉一个死字段**：`ATOM` 的透明度后缀是**非捕获组**，所以 `AtomHit.opacity` 自 0-E0 起恒为 `null`（形式上有字段、事实上无数据）。守恒律必须以透明度建键（否则 V3 不可见），故把它改为捕获组。该改动对既有基线**零漂移**（基线的 `byAtom` 标签不含透明度）。

**边界（写在明处的"不管"）**

- 普查**不记位置**：键里没有文件名。把类从 A 文件搬到 B 文件不会红——迁移是替换，不会搬类；按文件的收敛由基线快照负责。
- 普查**不记唯一性或顺序**：只记重数。同一行写两次同类会被计两次（`TOKEN` 分词器按 token 匹配），这符合"重数守恒"的定义。
- **新增**中性色会红（无论写成字面还是 `n-*`）：这是设计的一部分，不是误报——约定是"与迁移同 commit 刷新冻结值，并逐桶核对 JSON diff"。这也是本方案唯一的日常成本。
- 折叠（`bg-black bg-opacity-50` → `bg-n-black/50`）**不在守恒律视野内**：它是"一次性变化"，冻结值取自当前状态，历史变换被吸收进初值。它的证明在别处——共现护栏 ＋ 类级等值断言（第五段链条）＋ `--n-black` 取值，三者在 0-E2 已交付。

**对草案的一处有意加强**：决策点原文只要求抓 V1 / V2 / V3，键**没有**包含变体链。实测发现全仓 `variants` 被扫描但**没有任何护栏消费**（`grep -rn variants src/shared/tests`），即"丢 `dark:`"属"没人管"而非"归别人管"。变体链在多一个字段的前提下即可纳入，故把它并入 `usageKey`。代价：变体上下文发生合法变化（如给一处加 hover 态）时需刷新冻结值，与"新增颜色"共用同一仪式。

**反向验证 10 组**（每组先打印实际替换次数，命中数为 0 即中止以防空转；全部突变事后 `diff` 核对字节级还原）

Mutation 侧：

| 突变 | 规模 | 预期 | 实测 |
|---|---|---|---|
| V1 回退一处迁移（`bg-n-zinc-100 → bg-zinc-100`） | 8 处 | 快照红 | ✅ 红（**快照**一条；守恒律按设计保持绿——同一桶内挪计数） |
| V2 迁到**错档位**（`bg-n-zinc-100 → bg-n-zinc-200`） | 8 处 | 守恒律红 | ✅ 红（0-E2 时未检出，缺口已闭合） |
| V3 **丢掉透明度修饰符**（`dark:bg-n-zinc-800/50 → dark:bg-n-zinc-800`） | 4 处 | 守恒律红 | ✅ 红（0-E2 时未检出） |
| V4 **丢掉 `dark:` 变体**（`dark:bg-n-zinc-800 → bg-n-zinc-800`） | 8 处 | 守恒律红 | ✅ 红（加强后新覆盖） |
| V5 **换工具类**（`bg-n-zinc-100 → text-n-zinc-100`） | 8 处 | 守恒律红 | ✅ 红 |
| V6 **换族**（`bg-n-zinc-100 → bg-n-gray-100`，即"折进 gray"那个诱惑） | 8 处 | 守恒律红 | ✅ 红 |

守卫侧（先破扫描器、再**盲目重刷冻结值**，确认是守卫而非普查在报警）：

| 突变 | 预期 | 实测 |
|---|---|---|
| V7 令牌正则失效（`-n-(` → `-m-(`） | 守卫红 | ✅ 红（`token pattern matched nothing`；且此时的守恒律是**绿**的，正说明守卫不可省） |
| V8 `variants` 一律记空 | 守卫红 | ✅ 红 |
| V9 字面侧透明度不再捕获 | 守卫红 | ✅ 红 |
| V10 令牌侧透明度不再捕获（两个分支都断） | 守卫红 | ✅ 红 |

**反向验证自身的两次打偏（教训）**：V9 / V10 初版各只改了一个分支——V9 改的是字面量分支（令牌分支未动，断言照过），V10 只断 `TOKEN_SCALED`（`TOKEN_EXTREME` 仍在提供带透明度的 `bg-n-black/50`，断言照过）。两次都表现为"守卫没红"，看起来像护栏缺口。**结论：突变探针必须覆盖提供该属性的全部代码路径，否则"未检出"是探针的问题而非护栏的问题**——与 0-E0"先用不存在的类做突变导致假绿"是同一类错误的不同形态。

**验收**：`test:client` **128 文件 / 970 用例**（0-E2 基线 127/968，净增 1 文件 2 用例）；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`build:client`、`test:theme-tokens` 16 项全绿。基线 **未漂移**（1439 不变，本片不改 TSX）。产物：`bg-n-zinc-100` / `bg-n-gray-800` / `bg-n-black\/50` 在 `dist` 中；`.bg-opacity-50` 仍为 0（延续 0-E2 的结论）。**行号偏移不变**（累计 +223，本片未改 `index.css`）。

**顺带发现的遗留（未改，非本片范围）**：`themeHardcodedAtoms.ts` **顶部注释**里引用了 4 个真实类名（`hover:bg-gray-100` / `dark:bg-gray-800` / `prose-pre:bg-gray-900` / `bg-gray-900/50`），会被 content 扫描采进产物——目前这 4 个类各有活消费者，产物里看不出差异；但等最后一个消费者迁移完，注释会让该字面工具类**留在 `dist`**，使阶段 0"字面清零"的产物核对无法达成。修法是把注释里的类名写成通配形式（同 0-E2 的 `bg-opacity-*` 处置），本片不动它。


**行号偏移**：本片未改 `index.css`，偏移不变（累计 **+223**）。

#### 0-E2d 实施记录（2026-09-25）

**范围**：全仓 #1 热点文件 `AskUserQuestionPanel.tsx` 84 → 0。这也是第一片在 0-E2c 新门槛（基线收敛 ＋ 守恒律零漂移，"双绿"）下通过的迁移，因此它的价值一半在文件本身、一半在验证门槛可用。

**文件构成（先量化再动手）**：扫描器给出 **84 处命中 / 42 个不同 token / 25 行**，族只有 **gray 与 white**（无 zinc / slate / neutral / black），透明度修饰符 14 处。变体覆盖 `dark:` / `hover:` / `group-hover:` / `placeholder:` / `dark:hover:` / `dark:group-hover:` / `dark:placeholder:`。全文件**无动态色构造**（无模板串插值、无色名变量），所以是 A1 改名的最纯形态。选它而不是 41 处的 `AccountContent.tsx`，理由：单位收益最大（占剩余量 5.8%），且单一族使"改动=纯前缀插入"可被机械证明。

**手法：脚本化 + 双向守恒的写法约束**

- 替换走一次性脚本，正则**镜像扫描器的 atom 形状**（工具类＋族＋可选档位＋可选透明度修饰符，带前后界）；替换次数必须**等于扫描器报出的命中数**，不等则**拒绝写入**——避免"人手猜什么算颜色类"。
- 改完再证明一次"改动只是插入 `-n-`"：把新文件里所有 `-n-(gray|white|black)` 反向还原成 `-(gray|white|black)`，与改前备份 **`diff` 字节级相同**。这条比逐行读 diff 更强——它排除了"顺手改了点别的"。

**双绿证据**

- **守恒律零漂移且未刷新**：普查总量 **1502 = 1502**，**200 个桶逐桶相等**。这是纯改名的应有结果，也是第一片实证"守恒律不需要跟着迁移片刷新"——它只在新增/删除颜色时才需要动。
- **基线按预期收敛**：`total 1439 → 1355`（**−84**）。刷新前先读漂移清单：`byFile` 只有 `AskUserQuestionPanel.tsx` 一项 `84 → 0`（其余文件无一变化），`byAtom` **22 条全部为减、无一增加**，且每条都能与该文件自己的 42 个 token 逐一对上（如 `bg: gray-50` −4 = 该文件 `bg-gray-50` 1 ＋ `bg-gray-50/50` 1 ＋ `hover:bg-gray-50/60` 2；`text: gray-400` −9 = `text-gray-400` 7 ＋ `dark:text-gray-400` 1 ＋ `placeholder:text-gray-400` 1）。22 条合计 −84，与 `total` 的差一致。

**产物核对**：42 个 token **全部**在 `dist` 中有令牌形态（0 个缺失）；该文件**独占**的 15 个字面类已从 `dist` 消失（`border-gray-200/80`、`dark:bg-gray-800/90`、`dark:bg-gray-900/60`、`dark:border-gray-700/60`、`dark:group-hover:border-gray-600`、`dark:hover:bg-gray-700/40`、`dark:hover:bg-gray-700/60`、`dark:hover:border-gray-600`、`dark:placeholder:text-gray-600`、`dark:ring-gray-700`、`group-hover:border-gray-300`、`hover:bg-gray-50/60`、`hover:border-gray-300`、`placeholder:text-gray-400`、`ring-gray-200`）；仍在 `dist` 里的同名字面类来自**别的文件**（迁移按文件分片，符合预期）。`placeholder:` 与 `dark:placeholder:` 各产出 **2 条**（`::placeholder` ＋ `::-moz-placeholder`）。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`build:client`、`test:theme-tokens` 16 项全绿。**行号偏移不变**（累计 +223，本片未改 `index.css`）。

**工具侧两个坑（记账，避免重犯）**

1. **产物核对不能靠"看着像"的 grep**：CSS 类名本身在产物里是**转义**形态（`dark\:hover\:bg-n-gray-700\/40`），而 BSD grep 的 BRE **不认 `\:`**（实测 `grep '\.b\:c'` 对 `a.b\:c` 返回 0）。本片第一版核对脚本因此把 9 个**确实存在**的令牌类报成"缺失"，差点写成"产物没生成"。正解：按 CSS 规则转义（非 `[A-Za-z0-9_-]` 一律加反斜杠）＋ `grep -oF`，或直接在 Node 里按字符串切分数匹配。
2. **正则字符类的 JS 陷阱**：`/[]/` 在 JS 里是**空字符类**（匹配不到任何字符），不像 POSIX 把开头的 `]` 当字面量。我写的转义类 `/[][\\/:....]/` 因此静默地不做任何转义——**不报错、不命中**，正是"空转"的典型形态。

**顺带发现：扫描器覆盖面缺口（未改，待拍板）**

`COLOUR_UTILITIES` 只做**前缀**匹配 `(util)-(族)`，因此"轴/侧限定"的工具类**扫描器与守恒律都看不见**：`border-t|b|l|r-*`、`border-x|y-*`、`divide-x|y-*`、`ring-offset-*`。实测 **10 处**中性色落在外面：

- `src/shared/ui/Tooltip.tsx` 5 处 `border-t/b/l/r-gray-900 dark:border-t/b/l/r-gray-100`（成对结构，正是 A1 的目标形态）
- `src/modules/chat/transcript/LoadAllMessagesOverlay.tsx:74` 1 处 `border-t-white`
- `src/modules/shell/ShellConnectionOverlay.tsx:41` 1 处 `ring-offset-gray-950`
- `src/modules/shell/ShellHeader.tsx:72/92/104` 3 处 `ring-offset-gray-800`

**后果**：阶段 0 的定量终点（"1502 → 0"）**不覆盖这 10 处**，收工后它们仍是硬编码、不随主题变化——正是 §5.7 警告的那类"主题生效一半"的残留。修法是把这几类形态并入扫描器（`COLOUR_UTILITIES` 需从"前缀"扩为"前缀＋可选轴"，并同步扩 `ATOM` / `usageKey`），代价是阶段 0 的基准量从 **1502 → 1512**、文件数 105 → 108，且需要重新冻结守恒普查（届时已迁移的 62 ＋ 84 处不受影响，因为守恒律按桶记账）。**属独立一片（扫描器覆盖面），本片未动**。

#### 0-E2e 实施记录（2026-09-25）

**范围**：闭合 0-E2d 暴露的**扫描器覆盖面缺口**——把"轴/侧限定"的中性色工具类纳入扫描器与守恒律，并**同一片内清零**新纳入的命中。属"会改变阶段 0 基准量"的变更，已获拍板。

**量化（先量再动，更正 0-E2d 的口径）**：精确命中 **15 个 token / 10 行 / 4 文件**。0-E2d 记的"10 处"是**按行**数的，漏算了 `Tooltip.tsx` 每行各有 light/dark **两个** token：

| 文件 | token | 形态 |
|---|---|---|
| `src/shared/ui/Tooltip.tsx` | 10 | 5 行 ×（`border-t/b/l/r-gray-900` ＋ `dark:border-t/b/l/r-gray-100`），四个箭头各一对 |
| `src/modules/shell/ShellHeader.tsx` | 3 | `focus:ring-offset-gray-800` |
| `src/modules/shell/ShellConnectionOverlay.tsx` | 1 | `focus:ring-offset-gray-950` |
| `src/modules/chat/transcript/LoadAllMessagesOverlay.tsx` | 1 | `border-t-white` |

`outline-offset-*` **零命中**，且 Tailwind 的 `outlineOffset` 只接受宽度、不接受颜色——它本来就不是颜色工具，**不纳入**（纳入会产生永不匹配的死模式）。

**实现**：新增 `UTILITY` 常量作为"工具类半边"的唯一 alternation，`ATOM` / `TOKEN_SCALED` / `TOKEN_EXTREME` **三者共用同一份**。轴形式为 `border(?:-[trblxy])?`、`divide(?:-[xy])?`，`ring-offset` 单列于 `ring` 之前。两个设计约束：

1. **轴组必须是非捕获组**：`ATOM` 的组号（`family` / `step` / `opacity`）是守恒律键的一部分，任何新的捕获组都会静默错位整条链。
2. **三个正则共用一份 `UTILITY`**（而非各写一遍）——这直接消灭了 0-E2c 踩过的"探针只堵一半路径"：不存在"字面侧支持轴、令牌侧不支持"这种半通状态。反向验证 V-D 印证了这一点。

**无需改 `tailwind.config.js` 或 `src/index.css`**：`n-*` 注册在**统一 `colors` 键**下，Tailwind 会让所有颜色工具类（含 `borderColor` 的轴限定、`ringOffsetColor`）继承它，因此现有令牌**已能**承载轴限定形态，本片只扩了"看得见"的部分。

**冻结账（扩面的既定代价）**：守恒普查 **1502 → 1517**（+15 命中 / +11 桶），刷新前漂移清单为 **11 条、全部是 `frozen 0, now N`**，每条都点名来源文件行——即"新纳入的视野"，而非回归。基线快照 `theme-hardcoded-baseline.json` 的 `total` **未刷新**（见下，扩面与迁移精确抵消）。

**双绿证据**

- **基线零刷新即绿**：`total` 仍为 **1355**。这是本片最强的证据——扫描器扩面把基线**推高 15**，同一片内迁移又把它**拉低 15**，两次抵消到**未刷新就相等**。若迁移了 14 处或 16 处（或误迁移了一处非轴限定），基线会在**不刷新**的情况下报 `total: baseline 1355, now 1356` 或反方向的死项——**"零刷新通过"本身就是"恰好 15 处、一处不多不少"的机器证明**。
- **守恒律零漂移**：扩面后刷新一次（1517），迁移后 **1517 = 1517、211 桶逐桶相等、未再刷新**——纯改名不动桶，与 0-E2d 同构。

**反向验证 4 组**（每组先量化确认突变已命中，再评分；全部命中）

| # | 突变 | 守恒律 | 基线 | 判定 |
|---|---|---|---|---|
| V-A | `border-t-n-gray-900` → `-gray-800`（错档位，2 处） | **红** | 绿 | 新纳入的领地**在守恒律视野内** |
| V-B | `border-t-n-gray-900` → `border-n-gray-900`（丢轴限定，2 处） | **红** | 绿 | 轴限定是键的一部分，丢轴即换桶 |
| V-C | `border-t-n-gray-900` → `border-t-gray-900`（回退字面，2 处） | 绿 | **红** | 扩面**未削弱**快照对"回退"的检出（同桶，守恒律按设计不拦） |
| V-D | 扫描器的 `UTILITY` 撤销全部轴支持 | **红** | 绿 | 冻结普查里的 15 个轴命中**无法再被产出**，且反空转守卫同步报红——**证明守卫非空转** |

**反空转守卫补强**：守恒律测试新增第 5 条断言——`[...literals, ...tokens]` 中 `utility` 含 `-` 的命中必须 > 0。这正是本片扩面若"扩了但没生效"（正则写错、常量没接上）时会**立刻变红**的那条；V-D 实测它确实会红。

**产物核对**：11 个迁移后的拼写**全部**在 `dist` 有令牌形态，值链全部到达 `--n-*`——`border-t-n-gray-900` → `border-top-color:hsl(var(--n-gray-900))`；`dark:border-t-n-gray-100` → `hsl(var(--n-gray-100))`；`focus:ring-offset-n-gray-800` → `--tw-ring-offset-color: hsl(var(--n-gray-800))`（**`ring-offset` 走的是 `--tw-ring-offset-color` 变量，不是 `border-color`，本片首次验证该链**）。8 个被迁走的字面拼写（`border-t/b/l/r-gray-900`、`dark:border-t-gray-100`、`border-t-white`、`ring-offset-gray-800/950`）在 `src/` 与 `dist` **双双归零**（这些拼写在本仓**仅此一处**消费者，故可直接核对消失）。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`build:client`、`test:theme-tokens` 16 项全绿。**行号偏移不变**（累计 +223，本片未改 `index.css`）。

**口径变化（记账，需知悉）**：阶段 0 的定量终点从"覆盖 **1502** 处"变为"覆盖 **1517** 处"，但**当前剩余量不变**（1355），因为新纳入的 15 处已在本片清零。换言之：*之前报的 1355 是"扫描器可见的剩余"，真实的硬编码中性色剩余是 1370；本片把盲区纳入视野并立即归零，两者重新对齐到 1355*。

**与既有账的关系**：0-E2b（60）＋ 0-E2（2 隐雷）＋ 0-E2d（84）＋ 本片（15）＝ 阶段 0 至今迁移 **161** 处；守恒普查的冻结总量因此恒等于"剩余 ＋ 豁免 ＋ 已迁移"。

#### 0-E2f 实施记录（2026-09-25）

**范围**：热点榜第二 `src/modules/task-master/modals/TaskDetailModal.tsx` **72 → 0**。0-E2d 之后的最大单片。

**量化（先量再动）**：扫描器给出 **72 处命中 / 22 个不同 token / 28 行**；族只有 **gray 65 / white 6 / black 1**（无 zinc / slate / neutral），工具类只有 `text` / `bg` / `border` 三类，变体只有 `dark:` 与 `hover:`（含 `dark:hover:` 复合），带透明度修饰符 1 处（`bg-black/50`）。**无动态色构造**（无模板串插值、无色名变量），是 A1 改名的纯形态。选它而非 69 处的 `McpServerFormModal.tsx`：纯粹按热度取榜第二，且本片不复用 0-E2e 的覆盖面（该文件无轴限定形态），可作为"扩面片之后、门槛未受影响"的对照。

**手法**：与 0-E2d / 0-E2e 同一套写法约束——替换走脚本、**以扫描器输出为唯一事实源**（命中 72 = 改写 72，不等则拒绝写入）；改完把 `-n-(gray|white|black)` 反向还原，与改前备份 **`diff` 字节级相同**（`/tmp` 备份 → 还原 → `diff -q` 无输出）。

**双绿证据**

- **守恒律零漂移且未刷新**：普查 **1517 = 1517、211 桶逐桶相等**。纯改名不动桶。
- **基线按预期收敛**：`total **1355 → 1283**（**−72**）`，`byFile` 只有该文件 `72 → 0`；`byAtom` **19 条全部为减、无一增加**。22 个 token 因**变体不计入原子键**（`byAtom` 的键是 `工具类: 族-档`，不含 `dark:`/`hover:`）而折叠成 19 个原子，每条都能逐一配对：

  | 原子 | Δ | 来源 token |
  |---|---|---|
  | `bg: gray-800` | −9 | `dark:bg-gray-800` 4 ＋ `dark:hover:bg-gray-800` 5 |
  | `text: gray-300` | −10 | `dark:text-gray-300` 10 |
  | `text: gray-700` | −9 | `text-gray-700` 9 |
  | `border: gray-200` / `border: gray-700` | 各 −6 | `border-gray-200` 6 / `dark:border-gray-700` 6 |
  | …（其余 15 条同理） | | 19 条合计 **−72**，与 `total` 差一致 |

**产物核对**：22 个 token **全部**在 `dist` 有令牌形态；值链到达 `--n-*`，**透明度保留**——`bg-n-black/50` → `background-color:hsl(var(--n-black) / .5)`（本片唯一的修饰符，是 A1"改名不丢 alpha"的实测点）。**与 0-E2d 的差异（记账）**：该文件的 22 个字面拼写在**别的文件里仍有消费者**（`src_left` 实测 8~100 不等），因此**不能**用"字面类从 `dist` 消失"作为证据——那里残留的是别人的用量。本片的证据落在**令牌形态全产出 ＋ 守恒律零漂移 ＋ 基线 19 条全减**。核对脚本据此写成"token 必须产出；字面类若在 `src/` 已无消费者则 `dist` 必须为 0，否则允许存在"，避免把"别人还在用"误判成泄漏。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`build:client`、`test:theme-tokens` 16 项全绿。**行号偏移不变**（累计 +223，本片未改 `index.css`，也未改 `tailwind.config.js`）。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ **72** ＝ **233** 处。

#### 0-E2g：`McpServerFormModal.tsx` 69 → 0（热点榜第三，已实施）

**范围**：`src/modules/mcp/McpServerFormModal.tsx`。**69 处 / 16 个 token / 17 行**——族 `gray` 64 ＋ `white` 3 ＋ `black` 2；工具类只有 `bg` 30 ／ `text` 23 ／ `border` 16；变体只有 `dark:` / `hover:`（含 `dark:hover:` 3 处）；带透明度 **3 处**（`bg-black/50` ×2 为遮罩、`dark:bg-gray-900/50` ×1）。**无动态色构造、无轴限定形态、无 stone/zinc/slate/neutral**——标准 A1 形态。位于密度极高的 `mcp` 模块，17 行承载 69 处（平均每行 4 处），是全仓最"密"的一片。

**手法**：沿用既定约束——替换脚本以扫描器输出为唯一事实源（**69 = 69**，不等则拒写），改完把新文件的 `-n-(gray|zinc|slate|neutral|stone|black|white)` 反向还原，与改前备份 **`diff` 字节级相同**，证明"只是插入了 `-n-`"。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新**（纯改名；也再次实证守恒律只在增删颜色时才需刷新） |
| **基线** | **1283 → 1214（−69）**，文件数 **102 → 101**（`byFile` 该文件 `69 → 0` 是唯一文件级 delta）；`byAtom` **16 条全为减、无一增**，每条与 16 个 token 逐一对上（例：`bg: gray-800` −10 = `dark:bg-gray-800` 10；`text: white` −3 = `text-white` 3；`bg: black` −2 = `bg-black/50` 2，原子键不含透明度故与透明拼写合桶），合计恰 **−69** |

**产物核对（本片把核对精度又提高一格）**：16 个 token **全部**在 `dist` 有令牌形态；值链到达 `--n-*`，**透明度保留**——`bg-n-black/50` → `hsl(var(--n-black) / .5)`、`dark:bg-n-gray-900/50` → `hsl(var(--n-gray-900) / .5)`。沿用 0-E2f 的**条件式**判法：本片 16 个字面拼写在 `src/` 中**仍各有消费者**（实测 10~63 处），故**允许**留在 `dist`（`src_left > 0 ⟺ dist > 0` 双向成立即通过）。同文件的非中性色（`ring-blue-500` 7 ／ `border-blue-500` 7 ／ `bg-blue-600` 3 ／ `text/-border-red-500` 各 1）**未被触碰**。

**核对脚本自身的两处修正（记账）**：
1. **前缀误计**：初版用"裸子串出现次数"判产物，`dark:bg-gray-80` 这种不存在的拼写会被 `…-800` 前缀喂出虚高计数（实测虚报 9），使"令牌已产出"这条证据变软。现改为**两侧都类精确**——`src` 侧按 Tailwind 候选边界 `TOKEN` 正则整词相等，`dist` 侧按选择器边界（后随 `{` 或 `:`，且不得是 `\`／`/`／`-`／字母数字）。
2. **非空转探针**：给脚本故意混入 `dark:bg-gray-80` / `text-fuchsia-999` 两个假拼写，确认它**报 FAILED**（前者走双向守卫、后者走"token 必须产出"守卫），证明两条断言都有活性。**同一探针也暴露了本片证据的一个覆盖缺口**：16 个字面拼写**没有一个是本文件独占**，于是双向守卫只被实测了 `>0 → dist>0` 一半，`0 → dist 为 0` 那一半本片无真实样本（0-E2d 曾以 `AskUserQuestionPanel.tsx` 的独占拼写覆盖过）。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`build:client`、`test:theme-tokens` 16 项全绿。未改 `index.css` / `tailwind.config.js`（**累计行号偏移仍为 +223**）。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ **69** ＝ **302** 处；剩余 **1214 处 / 101 文件**，余下最大单片 `TaskBoardToolbar.tsx` 60。

#### 0-E2h：`TaskBoardToolbar.tsx` 60 → 0（热点榜第四，已实施）

**范围**：`src/modules/task-master/TaskBoardToolbar.tsx`。**60 处 / 22 个 token / 17 行**——族 `gray` 47 ＋ `white` 13（**无 black**）；工具类 `text` 30 ／ `bg` 20 ／ `border` 10；变体 `dark:` / `hover:`（含 `dark:hover:` 6 处）；**带透明度 0 处**，是首批"零修饰符"的片。**无动态色构造、无其他中性族**；同文件的品牌色（`purple-*` 11 ／ `blue-*` 10）**未触碰**。

**手法**：与 0-E2g 相同（脚本以扫描器为唯一事实源，**60 = 60**，不等则拒写；反向还原后与备份 `diff` 字节级相同）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **1214 → 1154（−60）**，文件数 **101 → 100**；`byAtom` **16 条全为减、无一增**（22 个 token 折叠成语义原子后 16 条），每条可配对（例：`text: gray-400` −5 = `dark:text-gray-400` 4 ＋ `text-gray-400` 1；`text: white` −7 = `text-white` 3 ＋ `dark:text-white` 4；`bg: gray-700` −6 = `dark:bg-gray-700` 3 ＋ `dark:hover:bg-gray-700` 3），合计恰 **−60** |

**产物核对（脚本升级为"派生式"）**：本片把核对脚本改成**通用件**——迁移前拼写不再手抄，而是**从迁移后文件自己的 `n-*` token 反向去掉 `-n-` 派生**，所以"迁移漏了一个 token"不可能悄悄退出核对范围；且把"反向还原 ≡ 备份"的纯前缀插入证明内联进同一脚本。结果：纯插入 **YES**；22 个 token **全部**在 `dist` 有令牌形态；22 个字面拼写在 `src/` 中**仍各有消费者**（实测 2~96 处），故按条件式断言**允许**留在 `dist`（`src_left > 0 ⟺ dist > 0` 双向成立）。本片无带透明度 token，值链检查为空转，已如实标注而非默认通过。

**核对脚本自身的一处修正（记账）**：初版"纯前缀插入"判据报 **NO**——根因是我在 `untokenise` 正则里加了 `(?=[-/]|$)` 尾部守卫，而 **JS 正则的 `$` 是"输入末尾"而非"行尾"**，于是行中 `text-n-white` 后跟空格时无法还原，与备份产生大片差异。**迁移本身无问题**（早先的 sed 反向 `diff` 是 IDENTICAL），是探针过严造成的**假失败**——与 0-E2g 的"裸子串过松造成假通过"恰好是一对镜像。去掉 lookahead 后 YES。已用 `text-fuchsia-999` / `dark:bg-gray-80` 假拼写做非空转探针，确认脚本能报 **FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`build:client`、`test:theme-tokens` 16 项全绿。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ **60** ＝ **362** 处；剩余 **1154 处 / 100 文件**，余下最大单片 `VersionUpgradeModal.tsx` 55。

#### 0-E2i：`VersionUpgradeModal.tsx` 55 → 0（热点榜第五，已实施）

**范围**：`src/modules/version-upgrade/VersionUpgradeModal.tsx`。**55 处 / 31 个 token / 21 行**——族 `gray` 46 ＋ `white` 8 ＋ `black` 1；工具类 `text` 28 ／ `bg` 21 ／ `border` 6；变体 `dark:` / `hover:`（含 `dark:hover:` 4 处）；带透明度 **3 处**。**31 个 token 是至今单片最多**（此前最多 22），档位也最杂——同片出现 `gray-50/100/200/300/400/500/600/700/800/900/950` 共 **11 个档位**，其中 `dark:bg-gray-950`、`text-gray-800`、`dark:text-gray-200`、`hover:text-gray-600`、`dark:hover:bg-gray-600` 五个拼写在全仓都属少见。**无动态色构造、无其他中性族、无轴限定形态**；同文件品牌/状态色（`blue-*` 23 ／ `red-*` 6 ／ `green-*` 1）与备份 **逐项 diff 相同**。

**前置检查（本片新增一步，但经核对属"快检"而非"补洞"）**：迁移前先点名确认这 11 个档位在 `src/index.css` 里**同时**有 L1 `--palette-gray-<step>` 与 L2 `--n-gray-<step>` 声明（含 `n-white` / `n-black`）——本片是首个用到 `gray-950` 与 `gray-800` 等少见档位的片，先确认没有任何新令牌要建（结论：11 个档位 L1／L2 双声明齐全，无需改 `index.css`）。

这类"档位没建令牌"的失败**在护栏视野内**：`neutralScale.test.ts` 已断言每个 `--n-<family>-<step>` 等于 `var(--palette-<family>-<step>)`、令牌恰好声明一次，`tests/theme-tokens` 的浏览器基线又断言每个 `--n-*` 在明暗两种外观下都能解析。**记录时的自我更正**：本节初稿写的是"L2 缺失时类存在、产物存在、护栏全绿，是结构上抓不到的失败"——**该说法未经验证且不成立**，读一遍 `neutralScale.test.ts` 即可否证。故前置检查的定位是"迁移前的一次快速点名"，不是"护栏缺口"。

**手法**：与 0-E2g／0-E2h 相同（扫描器为唯一事实源，**55 = 55**，不等则拒写）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **1154 → 1099（−55）**，文件数 **100 → 99**；`byAtom` **23 条全为减、无一增**，每条与 31 个 token 逐一对上（例：`bg: gray-700` −5 = `dark:bg-gray-700` 2 ＋ `dark:bg-gray-700/50` 2 ＋ `dark:hover:bg-gray-700` 1；`text: gray-300` −5 = `dark:text-gray-300` 4 ＋ `dark:hover:text-gray-300` 1；`bg: gray-950` −1 = `dark:bg-gray-950` 1），合计恰 **−55** |

**产物核对（通用脚本首次遇到"独占拼写"，补上了两片前记在案的覆盖缺口）**：纯前缀插入 **YES**；31 个 token **全部**产出；**带透明度 3 处首次拿到真实值链样本**——`bg-n-black/50` → `hsl(var(--n-black) / .5)`、`dark:bg-n-gray-700/50` → `hsl(var(--n-gray-700) / .5)`（0-E2h 该检查迭代零次，属真空转）。更关键的是：本片**首次出现两个独占拼写**——`border-white` 与 `dark:bg-gray-700/50` 在 `src/` 已无任何消费者，核对里 `src = 0 且 dist = 0`，于是条件式断言 **`0 → dist 为 0`** 这一半方向**首次被真实数据实测**（0-E2g／0-E2h 两片都因"每个拼写都有别的消费者"而无样本，已在各自记录中标注为覆盖缺口）。非空转探针（注入 `text-fuchsia-999`）如预期报 **FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`build:client`、`test:theme-tokens` 16 项全绿。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ **55** ＝ **417** 处；剩余 **1099 处 / 99 文件**，余下最大单片 `CodeEditorHeader.tsx` 52。

#### 0-E2j：`CodeEditorHeader.tsx` 52 → 0（热点榜第六，已实施）

**范围**：`src/modules/code-editor/CodeEditorHeader.tsx`。**52 处 / 13 个 token / 10 行**——族 `gray` 44 ＋ `white` 8（**无 black**）；工具类 `text` 36 ／ `bg` 16（**无 border**）；变体 `dark:` 系 26 ／ `hover:` 系 16 ／ 裸用 10；**带透明度 0 处**。**无动态色构造、无其他中性族、无轴限定形态**——标准 A1 形态；同文件品牌/状态色（`blue-*` 7 ／ `green-*` 3，含 `dark:bg-blue-900/30`、`dark:bg-green-900/30` 等带透明度拼写）**未被触碰**。

**前置检查（沿用 0-E2i 的一次点名）**：迁移前确认本片用到的 9 个档位（`gray-100/200/400/500/600/700/800/900` ＋ `white`）在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**（`index.css:52,92-100,249-259`），无需新建令牌。

**手法**：与 0-E2g／0-E2h／0-E2i 相同（扫描器为唯一事实源，**52 = 52**，不等则拒写；反向还原后与备份 `diff` 字节级相同）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **1099 → 1047（−52）**，文件数 **99 → 98**；`byFile` 该文件 `52 → 0` 是唯一文件级 delta；`byAtom` **9 条全为减、无一增**，每条与 13 个 token 折叠后逐一对上（`bg: gray-100` −8 = `hover:bg-gray-100` 8；`bg: gray-800` −8 = `dark:hover:bg-gray-800` 8；`text: gray-200` −1 = `dark:hover:text-gray-200` 1；`text: gray-400` −9 = `dark:text-gray-400` 8 ＋ `text-gray-400` 1；`text: gray-500` −2 = `dark:text-gray-500` 1 ＋ `text-gray-500` 1；`text: gray-600` −7 = `text-gray-600` 7；`text: gray-700` −1 = `hover:text-gray-700` 1；`text: gray-900` −8 = `hover:text-gray-900` 7 ＋ `text-gray-900` 1；`text: white` −8 = `dark:hover:text-white` 7 ＋ `dark:text-white` 1），合计恰 **−52** |

**产物核对（通用脚本第 4 次复用，本片无新形态）**：纯前缀插入 **YES**；13 个 token **全部**在 `dist` 有令牌形态；13 个字面拼写在 `src/` 中**仍各有消费者**（实测 1~86 处），故按条件式断言**允许**留在 `dist`（`src_left > 0 ⟺ dist > 0` 双向成立）。两点如实记账：① 本片**无独占拼写**，`0 → dist 为 0` 那一半方向仍无新样本（0-E2i 已以真实数据实测过该方向）；② 本片**无带透明度 token**，值链检查迭代零次，属**真空转**而非通过。非空转探针（注入 `dark:bg-gray-80` / `text-fuchsia-999`）如预期报 **FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`build:client`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ **52** ＝ **469** 处；剩余 **1047 处 / 98 文件**，余下最大单片 `FolderBrowserModal.tsx` 46。

#### 0-E2k：`FolderBrowserModal.tsx` 46 → 0（热点榜第七，已实施）

**范围**：`src/modules/project-creation-wizard/FolderBrowserModal.tsx`。**46 处 / 19 个 token / 19 行**——族 `gray` 41 ＋ `white` 4 ＋ **`black` 1**；工具类 `text` 23 ／ `bg` 15 ／ `border` 8；变体 `dark:` 系 20 ／ `hover:` 系 11 ／ 裸用 15。**带透明度 2 处**：`bg-black/50`（模态遮罩）与 `dark:bg-gray-900/50`。**无动态色构造、无其他中性族、无轴限定形态**。同文件品牌/状态色（`blue-*` 等）未触碰。

**前置检查（沿用既定一次点名）**：迁移前确认本片用到的 12 个档位（`gray-50/100/200/300/400/500/600/700/800/900` ＋ `white` ＋ `black`）在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**（共 24 条声明），无需新建令牌。

**手法**：与 0-E2g…0-E2j 相同（扫描器为唯一事实源，**46 = 46**，不等则拒写；反向还原后与备份 `diff` 字节级相同）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **1047 → 1001（−46）**，文件数 **98 → 97**；`byFile` 该文件 `46 → 0` 是唯一文件级 delta；`byAtom` **16 条全为减、无一增**，每条与 19 个 token 折叠后逐一对上（`bg: black` −1 = `bg-black/50` 1；`bg: gray-900` −1 = `dark:bg-gray-900/50` 1；`bg: gray-700` −5 = `dark:hover:bg-gray-700` 5；`border: gray-200` −4 = `border-gray-200` 4；`border: gray-700` −4 = `dark:border-gray-700` 4；`text: gray-300` −4 = `dark:hover:text-gray-300` 3 ＋ `dark:text-gray-300` 1；`text: gray-400` −7 = `text-gray-400` 5 ＋ `dark:text-gray-400` 2；`text: gray-600` −4 = `hover:text-gray-600` 3 ＋ `text-gray-600` 1；其余 8 条各 −1），合计恰 **−46** |

**产物核对（通用脚本第 5 次复用）**：纯前缀插入 **YES**；19 个 token **全部**在 `dist` 有令牌形态；19 个字面拼写在 `src/` 中**仍各有消费者**（实测 1~84 处），条件式断言 `src_left > 0 ⟺ dist > 0` 双向成立。**带透明度 2 处再次拿到真实值链样本**：`bg-n-black/50` → `hsl(var(--n-black) / .5)`、`dark:bg-n-gray-900/50` → `hsl(var(--n-gray-900) / .5)`（0-E2h 该检查曾迭代零次）。本片仍无独占拼写，`0 → dist 为 0` 方向无新样本（0-E2i 已实测）。非空转探针（注入 `dark:bg-gray-80` / `text-fuchsia-999`）如预期报 **FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`build:client`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ **46** ＝ **515** 处；剩余 **1001 处 / 97 文件**，余下最大单片 `TaskEmptyState.tsx` 46。

#### 0-E2l：`TaskEmptyState.tsx` 46 → 0（热点榜第八，已实施）

**范围**：`src/modules/task-master/TaskEmptyState.tsx`。**46 处 / 16 个 token / 22 行**——族 `gray` 34 ＋ `white` 12（**无 `black`、无其他中性族**）；工具类 `text` 32 ／ `bg` 12 ／ `border` 2；变体 `dark:` 系 22 ／ `hover:` 系 1 ／ 裸用 23。**带透明度 4 处**：全部为同一 token `dark:bg-gray-800/60`——九片里首个透明度**不分散**的片。**无动态色构造、无轴限定形态**。同文件品牌/状态色未触碰。

**前置检查（沿用既定一次点名）**：迁移前确认本片用到的 10 个档位（`gray-100/200/300/400/500/600/700/800/900` ＋ `white`）在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**（共 20 条声明），无需新建令牌。

**手法**：与 0-E2g…0-E2k 相同（扫描器为唯一事实源，**46 = 46**，不等则拒写；反向还原后与备份 `diff` 字节级相同）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **1001 → 955（−46）**，文件数 **97 → 96**；`byFile` 该文件 `46 → 0` 是唯一文件级 delta；`byAtom` **15 条全为减、无一增**，合计恰 **−46**（`text: gray-400` −8 = `dark:text-gray-400` 8；`text: white` −8 = `dark:text-white` 6 ＋ `text-white` 2；`bg: gray-800` −4 = `dark:bg-gray-800/60` 4；`bg: white` −4 = `bg-white` 4；`text: gray-900` −6、`text: gray-600` −6 各 = 同名字面 6；`text: gray-500` −2 = `text-gray-500` 2；`bg: gray-100`／`bg: gray-200`／`bg: gray-600`／`bg: gray-700`／`border: gray-200`／`border: gray-700`／`text: gray-300`／`text: gray-700` 各 −1） |

**产物核对（通用脚本第 6 次复用）**：纯前缀插入 **YES**；16 个 token **全部**在 `dist` 有令牌形态；16 个字面拼写在 `src/` 中**仍各有消费者**（实测 2~76 处），条件式断言 `src_left > 0 ⟺ dist > 0` 双向成立。**带透明度 4 处再次拿到真实值链样本**：`dark:bg-n-gray-800/60` → `hsl(var(--n-gray-800) / .6)`。本片仍无独占拼写，`0 → dist 为 0` 方向无新样本（0-E2i 已实测）。非空转探针（注入 `dark:bg-gray-80` / `text-fuchsia-999`）如预期报 **FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`build:client`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ **46** ＝ **561** 处；剩余 **955 处 / 96 文件**，余下最大单片 `AccountContent.tsx` 41。

#### 0-E2m：`AccountContent.tsx` 41 → 0（热点榜第九，已实施）

**范围**：`src/modules/settings/tabs/agents-settings/sections/content/AccountContent.tsx`。**41 处 / 40 个 token / 16 行**——**首个跨四族混合片**：`gray` 16 ＋ `zinc` 13 ＋ `neutral` 11 ＋ `white` 1；工具类 `bg` 20 ／ `text` 15 ／ `border` 6；变体形态至今最多——裸用 17 ／ 仅 `dark:` 15 ／ 仅 `hover:` 3 ／ 仅 `active:` 3 ／ `dark:hover:` 2 ／ `dark:active:` 1。**带透明度 2 处**：`dark:bg-zinc-900/20`、`dark:bg-neutral-900/20`——**透明度样本首次覆盖非 gray 族**（历片均为 gray / black）。**首现 950 档**：`active:bg-gray-950`、`active:bg-zinc-950`。**无动态色构造、无轴限定形态**。同文件品牌/状态色未触碰。

**前置检查（沿用既定一次点名）**：迁移前逐一确认本片用到的 **24 个档位**在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**（gray 100/300/500/600/700/800/900/950 ＋ zinc 50/100/200/300/600/700/800/900/950 ＋ neutral 50/100/300/700/800/900 ＋ white，共 48 条声明），并确认 `tailwind.config.js` 的 `n-gray` / `n-zinc` / `n-slate` / `n-neutral` 四组键均含 50 与 950 两端，无需新建令牌。

**手法**：与 0-E2g…0-E2l 相同（扫描器为唯一事实源，**41 = 41**，不等则拒写；反向还原后与备份 `diff` 字节级相同）。本片 token 含前缀包含关系（`bg-gray-800` ⊂ `dark:bg-gray-800`、`bg-zinc-900` ⊂ `dark:bg-zinc-900/20`），脚本按**长度降序**替换，长者先落地后短者不再命中，逐条对照确认未串味。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新**——首次在**四族同片**上验证折叠后拼写仍逐桶守恒 |
| **基线** | **955 → 914（−41）**，文件数 **96 → 95**；`byFile` 该文件 `41 → 0` 是唯一文件级 delta；`byAtom` **36 条全为减、无一增**，合计恰 **−41**（`bg: zinc-900` −2 = `bg-zinc-900` 1 ＋ `dark:bg-zinc-900/20` 1；`bg: neutral-900` −2 = `dark:bg-neutral-900/20` 1 ＋ `active:bg-neutral-900` 1；`bg: gray-800` −2 = `bg-gray-800` 1 ＋ `dark:bg-gray-800` 1；`text: gray-300` −2 = `dark:text-gray-300` 2；其余 32 条各 −1，逐条与 token 对上） |

**产物核对（通用脚本第 7 次复用）**：纯前缀插入 **YES**；40 个 token **全部**在 `dist` 有令牌形态；**首次批量拿到独占拼写样本 —— 27 个 token 的字面在 `src/` 与 `dist` 双双归零、其令牌形态在 `dist` 存在**（0-E2i 仅 1 个；这是"本片清掉了仓内最后一处该字面"的实证）。条件式断言 `src_left > 0 ⟺ dist > 0` 双向成立。**带透明度 2 处值链**：`dark:bg-n-zinc-900/20` → `hsl(var(--n-zinc-900) / .2)`、`dark:bg-n-neutral-900/20` → `hsl(var(--n-neutral-900) / .2)`。非空转探针（注入 `dark:bg-gray-80` / `text-fuchsia-999`）如预期报 **FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`build:client`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ **41** ＝ **602** 处；剩余 **914 处 / 95 文件**，余下最大单片 `toolConfigs.ts` 38。

#### 0-E2n：`toolConfigs.ts` 38 → 0（热点榜第十，已实施）

**范围**：`src/modules/chat/tools/configs/toolConfigs.ts`。**38 处 / 9 个 token / 20 行**——**首个类名映射表片**：这是 `.ts` 配置而非 TSX，38 处全部是**类名字符串字面量**，按 `primary` / `secondary` / `border` / `icon` 四类槽位重复出现。族**纯 `gray`**（38，零 `white` / `black`）；工具类 `text` 32 ／ `border` 6、**零 `bg`**；**零透明度**。token 同质度至今最高：**9 个 token 覆盖 38 处**，单 token 最多 8 处（`text-gray-700` / `dark:text-gray-300`）。**无动态色构造、无轴限定形态**。同文件彩色（各工具品牌色）未被计入也未被触碰。

**前置检查（沿用既定一次点名）**：迁移前确认本片用到的 5 个档位（`gray-300/400/500/600/700`）在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**（共 10 条声明），无需新建令牌。

**手法**：与 0-E2g…0-E2m 相同（扫描器为唯一事实源，**38 = 38**，不等则拒写；反向还原后与备份 `diff` 字节级相同）。token 含前缀包含关系（`text-gray-400` ⊂ `dark:text-gray-400`），按长度降序替换后短者不再命中，逐条对照确认未串味。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **914 → 876（−38）**，文件数 **95 → 94**；`byFile` 该文件 `38 → 0` 是唯一文件级 delta；`byAtom` **8 条全为减、无一增**，合计恰 **−38**（`text: gray-400` −9 = `dark:text-gray-400` 7 ＋ `text-gray-400` 2；`text: gray-300` −8 = `dark:text-gray-300` 8；`text: gray-700` −8 = `text-gray-700` 8；`text: gray-500` −7 = `text-gray-500` 7；`border: gray-400` −2 = `border-gray-400` 2；`border: gray-500` −2 = `dark:border-gray-500` 2；`border: gray-300` −1 = `border-gray-300` 1；`border: gray-600` −1 = `dark:border-gray-600` 1） |

**产物核对（通用脚本第 8 次复用）**：纯前缀插入 **YES**；9 个 token **全部**在 `dist` 有令牌形态——**这同时证明 `.ts` 配置里的类名字符串确实被 Tailwind 的 content 扫描覆盖**（`src/**/*.{ts,tsx}`），不是"只写在 TS 里没进 CSS"的死字符串；9 个字面拼写中 8 个在 `src/` 仍各有消费者、1 个（`dark:border-gray-500`）**独占拼写**（src 0 / dist 0，令牌形态 dist 存在）。条件式断言 `src_left > 0 ⟺ dist > 0` 双向成立。本片**无带透明度 token**，"值链"检查属真空转（与 0-E2h 同类）。非空转探针（注入 `dark:bg-gray-80` / `text-fuchsia-999`）如预期报 **FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`build:client`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ **38** ＝ **640** 处；剩余 **876 处 / 94 文件**，余下最大单片 `QuestionAnswerContent.tsx` 35（该文件另有 1 处豁免 `border-gray-150`，不在基线口径内）。

#### 0-E2o：`QuestionAnswerContent.tsx` 35 → 0（热点榜第十一，已实施）

**范围**：`src/modules/chat/tools/ContentRenderers/QuestionAnswerContent.tsx`。扫描器原始命中 **36** 处，其中 **1 处是唯一豁免** `border-gray-150`（见下"阻断点"），**实际迁移 35 处 / 21 个 token**。族 `gray` 33 ＋ `white` 2；工具类 `text` 22 ／ `bg` 8 ／ `border` 5；**带透明度 5 处——历片最多**（`bg-gray-50/50`、`dark:bg-gray-800/30`、`dark:hover:bg-gray-800/50`、`dark:border-gray-700/50`、`dark:border-gray-700/40`）。档位跨度含 `gray-50` 与 `gray-100` 低端。**无动态色构造、无轴限定形态**。

**阻断点与处置（本片独有）**：`border-gray-150` 的豁免理由是 **Tailwind 无 `gray-150` 档，该类根本不生成 CSS**——"没有颜色可令牌化，边框压根不渲染"，迁移它只会把"不渲染"伪装成"已令牌化"，且 `--n-gray-150` 并不存在、产物核对必然报红。此前 22 片都没有豁免文件，`migrate-slice.ts` 直接吃扫描器原始输出即可；本片首次给脚本**加入豁免过滤**（按 `file + token` 跳过 `NEUTRAL_EXEMPTIONS`），并新增 `exempt` 计数行以便复核。迁移后实测 `border-gray-150` 原样留在第 62 行、同一行的 `bg-gray-50/50` 等已正常迁移。

**前置检查（沿用既定一次点名）**：迁移前确认本片用到的 10 个档位（`gray-50/100/300/400/500/600/700/800/900` ＋ `white`）在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**（共 20 条声明），无需新建令牌。

**手法**：扫描器为唯一事实源（`scanner hits: 36  exempt: 1  migratable: 35  rewrites: 35`，不等则拒写）；反向还原后与备份 `diff` 字节级相同。token 含前缀包含关系（`dark:bg-gray-800` ⊂ `dark:bg-gray-800/30`），按长度降序替换后逐条对照确认未串味。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新**（豁免项不参与折叠，未造成漂移） |
| **基线** | **876 → 841（−35，而非 −36 —— 豁免项不计入基线口径）**，文件数 **94 → 93**；`byFile` 该文件 `35 → 0` 是唯一文件级 delta；`byAtom` **15 条全为减、无一增**，合计恰 **−35**（`text: gray-400` −8 = `text-gray-400` 7 ＋ `dark:text-gray-400` 1；`text: gray-500` −6 = `dark:text-gray-500` 6；`bg: gray-800` −3 = `dark:bg-gray-800` 1 ＋ `dark:bg-gray-800/30` 1 ＋ `dark:hover:bg-gray-800/50` 1；`bg: gray-50` −2 = `hover:bg-gray-50` 1 ＋ `bg-gray-50/50` 1；`border: gray-700` −2 = `dark:border-gray-700/50` 1 ＋ `dark:border-gray-700/40` 1；`text: gray-100` −2 = `dark:text-gray-100` 2；`text: gray-600` −2 = `text-gray-600` 1 ＋ `dark:text-gray-600` 1；`text: white` −2 = `text-white` 2；`text: gray-900` −2 = `text-gray-900` 2；其余 6 条各 −1，其中 **`border: gray-100` 归零**） |

**产物核对（通用脚本第 9 次复用）**：纯前缀插入 **YES**；21 个 token **全部**在 `dist` 有令牌形态；**5 个独占拼写**（`bg-gray-50/50`、`border-gray-100`、`dark:bg-gray-800/30`、`dark:border-gray-700/40`、`dark:hover:bg-gray-800/50`）。**带透明度 5 处值链全部实测**，首次覆盖 **`dark:hover:` 复合变体**：`dark:hover:bg-n-gray-800/50` → `.dark\:hover\:bg-n-gray-800\/50:hover:is(.dark *){background-color:hsl(var(--n-gray-800) / .5)}`（其余 4 条为 `.5 / .3 / .5 / .4`）。非空转探针（注入 `dark:bg-gray-80` / `text-fuchsia-999`）如预期报 **FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`build:client`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ **35** ＝ **675** 处；剩余 **841 处 / 93 文件**，余下最大单片 `NextTaskBanner.tsx` 33。

#### 0-E2p：`NextTaskBanner.tsx` 33 → 0（热点榜第十二，已实施）

**范围**：`src/modules/task-master/NextTaskBanner.tsx`。**33 处 / 22 个 token / 13 行**——**首个 `slate` 主导的片**：`slate` 20 ＋ `gray` 8 ＋ `white` 5（此前非 gray 族只在 0-E2b 作为少数出现，0-E2m 是四族均分）；工具类 `text` 19 ／ `bg` 8 ／ `border` 6；**带透明度 1 处**（`dark:bg-slate-900/30`）。**无动态色构造、无轴限定形态**。同文件品牌/状态色未触碰。

**前置检查（沿用既定一次点名）**：迁移前确认本片用到的 16 个档位（`gray-100/400/500/600/800/900` ＋ `slate-50/100/200/300/400/600/700/800/900` ＋ `white`）在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**（共 32 条声明），无需新建令牌。

**手法**：与 0-E2g…0-E2o 相同（扫描器为唯一事实源，`scanner hits: 33  exempt: 0  migratable: 33  rewrites: 33`；反向还原后与备份 `diff` 字节级相同）。token 含前缀包含关系（`text-white` ⊂ `dark:text-white`、`text-gray-400` ⊂ `dark:text-gray-400`），按长度降序替换后逐条对照确认未串味。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新**——首次在 **`slate` 主导**的片上验证折叠守恒 |
| **基线** | **841 → 808（−33）**，文件数 **93 → 92**；`byFile` 该文件 `33 → 0` 是唯一文件级 delta；`byAtom` **20 条全为减、无一增**，合计恰 **−33**（`text: white` −5 = `text-white` 3 ＋ `dark:text-white` 2；`text: slate-600` −3 = `text-slate-600` 3；`bg: slate-100` −2 = `hover:bg-slate-100` 2；`bg: slate-800` −2 = `dark:hover:bg-slate-800` 2；`border: slate-300` −2 = `border-slate-300` 2；`border: slate-600` −2 = `dark:border-slate-600` 2；`text: slate-300` −2 = `dark:text-slate-300` 2；`text: gray-400` −2、`text: gray-900` −2 各 = 同名字面；其余 12 条各 −1。**`border: slate-300`、`border: slate-600`、`text: slate-600` 三条归零**） |

**产物核对（通用脚本第 10 次复用）**：纯前缀插入 **YES**；22 个 token **全部**在 `dist` 有令牌形态——**首次实测 `slate` 族的完整令牌链**：`dark:bg-n-slate-900/30` → `hsl(var(--n-slate-900) / .3)`（此前 slate 只作为 0-E2b/0-E2m 的少数族出现，未单独验证过值链）。**5 个独占拼写**（`border-slate-300`、`dark:border-slate-600`、`dark:hover:bg-slate-800`、`hover:bg-slate-100`、`text-slate-600`）。条件式断言 `src_left > 0 ⟺ dist > 0` 双向成立。非空转探针（注入 `dark:bg-gray-80` / `text-fuchsia-999`）如预期报 **FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`build:client`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ 35 ＋ **33** ＝ **708** 处；剩余 **808 处 / 92 文件**，余下最大单片 `TaskMasterSetupModal.tsx` 32。

#### 0-E2q：`TaskMasterSetupModal.tsx` 32 → 0（热点榜第十三，已实施）

**范围**：`src/modules/task-master/modals/TaskMasterSetupModal.tsx`。**32 处 / 26 个 token / 11 行**——族 `gray` 26 ＋ `white` 4 ＋ `black` 2；**三工具最均衡的一片**：`bg` 12 ／ `border` 8 ／ `text` 12（此前各片都明显偏 `text`）；**带透明度 2 处**：模态遮罩 `bg-black/50` 与卡面 `dark:bg-gray-800/50`；变体含 `hover:` / `dark:hover:` 双层。**无动态色构造、无轴限定形态**。同文件品牌/状态色未触碰。

**前置检查（沿用既定一次点名）**：迁移前确认本片用到的 11 个档位（`gray-50/200/300/400/500/600/700/800/900` ＋ `white` ＋ `black`）在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**（共 22 条声明），无需新建令牌。

**手法**：与 0-E2g…0-E2p 相同（扫描器为唯一事实源，`scanner hits: 32  exempt: 0  migratable: 32  rewrites: 32`；反向还原后与备份 `diff` 字节级相同）。本片含两处前缀包含关系——`bg-black/50` ⊂ `bg-black`、`text-gray-400` ⊂ `dark:text-gray-400`——按**长度降序**替换，长者先落地后短者不再命中，迁移后对照 `bg-black/50` 与裸 `bg-black` 各自独立确认未串味。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **808 → 776（−32）**，文件数 **92 → 91**；`byFile` 该文件 `32 → 0` 是唯一文件级 delta；`byAtom` **19 条全为减、无一增**，合计恰 **−32**（`bg: black` −2 = `bg-black/50` 1 ＋ `bg-black` 1；`bg: gray-800` −2 = `dark:hover:bg-gray-800` 1 ＋ `dark:bg-gray-800/50` 1；`bg: gray-50` −2 = `bg-gray-50` 1 ＋ `hover:bg-gray-50` 1；`bg: white` −2 = `bg-white` 2；`border: gray-200` −3 = `border-gray-200` 3；`border: gray-700` −3 = `dark:border-gray-700` 3；`text: gray-300` −2 = `dark:text-gray-300` 1 ＋ `dark:hover:text-gray-300` 1；`text: gray-400` −3 = `dark:text-gray-400` 2 ＋ `text-gray-400` 1；`text: gray-600` −2 = `text-gray-600` 1 ＋ `hover:text-gray-600` 1；`text: white` −2 = `text-white` 1 ＋ `dark:text-white` 1；其余 10 条各 −1），**无原子归零** |

**产物核对（通用脚本第 11 次复用）**：纯前缀插入 **YES**；26 个 token **全部**在 `dist` 有令牌形态；**本片 0 个独占拼写**（26 个字面在 `src/` 均仍有其他消费者，如实记账，非空转）。**带透明度 2 处值链实测**：`bg-n-black/50` → `hsl(var(--n-black) / .5)`、`dark:bg-n-gray-800/50` → `hsl(var(--n-gray-800) / .5)`。非空转探针（注入 `dark:bg-gray-80` / `text-fuchsia-999`）如预期报 **FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`build:client`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ 35 ＋ 33 ＋ **32** ＝ **740** 处；剩余 **776 处 / 91 文件**，余下最大单片 `GithubAuthenticationCard.tsx` 31。

#### 0-E2r：`GithubAuthenticationCard.tsx` 31 → 0（热点榜第十四，已实施）

**范围**：`src/modules/project-creation-wizard/GithubAuthenticationCard.tsx`。**31 处 / 18 个 token / 14 行**——族 `gray` 27 ＋ `white` 4（无 `black`）；工具类 `text` 21 ／ `bg` 6 ／ `border` 4；**带透明度 1 处**（`dark:bg-gray-900/50`）。档位**集中在中段**：`gray-300/400/500/600/700` 五档合计 **21/31**，两端（`gray-50` / `gray-900`）各仅 1 处。**无动态色构造、无轴限定形态**。同文件品牌色（`green-*` 等 GitHub 语义色）未触碰。

**前置检查（沿用既定一次点名）**：迁移前确认本片用到的 10 个档位（`gray-50/200/300/400/500/600/700/800/900` ＋ `white`）在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**（共 20 条声明），无需新建令牌。

**手法**：与 0-E2g…0-E2q 相同（扫描器为唯一事实源，`scanner hits: 31  exempt: 0  migratable: 31  rewrites: 31`；反向还原后与备份 `diff` 字节级相同）。token 含前缀包含关系（`text-white` ⊂ `dark:text-white`、`text-gray-400` ⊂ `dark:text-gray-400`），按长度降序替换后逐条对照确认未串味。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **776 → 745（−31）**，文件数 **91 → 90**；`byFile` 该文件 `31 → 0` 是唯一文件级 delta；`byAtom` **17 条全为减、无一增**，合计恰 **−31**（`text: gray-700` −4 = `text-gray-700` 4；`text: gray-300` −4 = `dark:text-gray-300` 4；`text: gray-400` −4 = `dark:text-gray-400` 4；`text: gray-500` −3 = `text-gray-500` 3；`text: white` −3 = `text-white` 2 ＋ `dark:text-white` 1；`text: gray-600` −2 = `text-gray-600` 2；其余 11 条各 −1。**无原子归零**） |

**产物核对（通用脚本第 12 次复用）**：纯前缀插入 **YES**；18 个 token **全部**在 `dist` 有令牌形态；**0 个独占拼写**（18 个字面在 `src/` 均仍有其他消费者，最小 2 处，如实记账、非空转）。**带透明度 1 处值链实测**：`dark:bg-n-gray-900/50` → `hsl(var(--n-gray-900) / .5)`。非空转探针（注入 `dark:bg-gray-80` / `text-fuchsia-999`）如预期报 **FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`build:client`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ 35 ＋ 33 ＋ 32 ＋ **31** ＝ **771** 处；剩余 **745 处 / 90 文件**，余下最大单片 `PrdEditorHeader.tsx` 30。

#### 0-E2s：`PrdEditorHeader.tsx` 30 → 0（热点榜第十五，已实施）

**范围**：`src/modules/prd-editor/PrdEditorHeader.tsx`。**30 处 / 18 个 token / 11 行**——族 `gray` 24 ＋ `white` 6（无 `black`）；工具类 `text` 18 ／ `bg` 6 ／ `border` 4 ／ `placeholder` 2；**零透明度**（全片无 `/NN` 修饰）。档位跨两端：`gray-50/100/200/400/500/600/700/800/900` ＋ `white`（缺 `gray-300`）。变体含 `hover:` / `dark:hover:` 双层。**无动态色构造、无轴限定形态**。同文件品牌色（`purple-*` / `green-*`）未触碰。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 10 个档位（`gray-50/100/200/400/500/600/700/800/900` ＋ `white`）在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **10 / 10**，无缺失，无需新建令牌。

**手法**：与 0-E2g…0-E2r 相同（扫描器为唯一事实源，`scanner hits: 30  exempt: 0  migratable: 30  rewrites: 30`；反向还原后与备份 `diff` 字节级相同）。token 含三段前缀包含关系（`text-white` ⊂ `dark:text-white` ⊂ `dark:hover:text-white`、`text-gray-400` ⊂ `dark:text-gray-400`、`text-gray-900` ⊂ `hover:text-gray-900`），按**长度降序**替换后逐条对照确认未串味。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **745 → 715（−30）**，文件数 **90 → 89**；`byFile` 该文件 `30 → 0` 是唯一文件级 delta；`byAtom` **14 条全为减、无一增**，合计恰 **−30**（`text: white` −6 = `text-white` 3 ＋ `dark:text-white` 1 ＋ `dark:hover:text-white` 2；`text: gray-400` −5 = `dark:text-gray-400` 4 ＋ `text-gray-400` 1；`text: gray-900` −3 = `hover:text-gray-900` 2 ＋ `text-gray-900` 1；`bg: gray-100` −2 = `hover:bg-gray-100` 2；`bg: gray-800` −2 = `dark:hover:bg-gray-800` 2；`border: gray-200` −2 = `border-gray-200` 2；`text: gray-500` −2 = `text-gray-500` 2；`text: gray-600` −2 = `text-gray-600` 2；其余 6 条各 −1），其中 **2 条归零**：`placeholder: gray-400` 1→0、`placeholder: gray-500` 1→0 |

**产物核对（通用脚本第 13 次复用）**：纯前缀插入 **YES**；18 个 token **全部**在 `dist` 有令牌形态；**本片 2 个字面在迁移后于 `src/` 归零**（`placeholder-gray-400`、`dark:placeholder-gray-500`——迁移前本片是其全仓唯一消费者），`dist` 同步不再生成，条件式断言 `(src>0)===(dist>0)` 在这两列同为 0 时成立；**零透明度**，无值链实测项。非空转探针（注入 `bg-gray-999`）如预期报 **FAILED**。

**一处自洽印证**：`byAtom` 归零的 2 条原子（均为 `placeholder` 工具类）与产物侧"迁移后全仓零消费的 2 个字面"是同一组事实的两个视角——原子桶归零 ⟺ 该字面全仓再无消费者。两条独立路径给出同一个"2"，互为佐证。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ 35 ＋ 33 ＋ 32 ＋ 31 ＋ **30** ＝ **801** 处；剩余 **715 处 / 89 文件**，余下最大单片 `GenerateTasksModal.tsx` 30（与 `CreateTaskModal.tsx` / `TaskHelpModal.tsx` / `TaskCard.tsx` 并列）。

#### 0-E2t：`GenerateTasksModal.tsx` 30 → 0（热点榜第十六，已实施）

**范围**：`src/modules/prd-editor/modals/GenerateTasksModal.tsx`。**30 处 / 21 个 token / 10 行**——族 `gray` 24 ＋ `white` 5 ＋ `black` 1；工具类 `bg` 11 ／ `border` 8 ／ `text` 11（**三工具最均衡**，此前各片 `text` 普遍占优）；**带透明度 1 处**（模态遮罩 `bg-black/50`）。档位 `gray-50/100/200/300/400/600/700/800/900` ＋ `white` ＋ `black`——**缺 `gray-500`**，两端与中段齐备。**无动态色构造、无轴限定形态**。同文件品牌色（`purple-*`）与半透明卡片面（`dark:bg-purple-900/50`、`dark:bg-purple-900/20`）未触碰。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 11 个档位（`gray-50/100/200/300/400/600/700/800/900` ＋ `white` ＋ `black`）在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **11 / 11**，无缺失，无需新建令牌。

**手法**：与 0-E2g…0-E2s 相同（扫描器为唯一事实源，`scanner hits: 30  exempt: 0  migratable: 30  rewrites: 30`；反向还原后与备份 `diff` 字节级相同）。token 含前缀包含关系（`text-gray-600` ⊂ `hover:text-gray-600`、`text-gray-400` ⊂ `dark:text-gray-400`），按**长度降序**替换后逐条对照确认未串味；本片另有 `bg-black/50` 但**不存在裸 `bg-black`**，故该形态的包含陷阱在本片不成立（仍按长度降序处理）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **715 → 685（−30）**，文件数 **89 → 88**；`byFile` 该文件 `30 → 0` 是唯一文件级 delta；`byAtom` **17 条全为减、无一增**，合计恰 **−30**（`bg: white` −3 = `bg-white` 3；`border: gray-200` −3 = `border-gray-200` 3；`border: gray-700` −3 = `dark:border-gray-700` 3；`bg: gray-700` −2 = `dark:bg-gray-700` 1 ＋ `dark:hover:bg-gray-700` 1；`bg: gray-800` −2 = `dark:bg-gray-800` 2；`text: gray-300` −2 = `dark:text-gray-300` 1 ＋ `dark:hover:text-gray-300` 1；`text: gray-400` −2 = `dark:text-gray-400` 1 ＋ `text-gray-400` 1；`text: gray-600` −2 = `hover:text-gray-600` 1 ＋ `text-gray-600` 1；`text: gray-900` −2 = `text-gray-900` 2；`text: white` −2 = `dark:text-white` 2；其余 7 条各 −1），**无原子归零** |

**产物核对（通用脚本第 14 次复用）**：纯前缀插入 **YES**；21 个 token **全部**在 `dist` 有令牌形态；**0 个独占拼写**（21 个字面在 `src/` 均仍有其他消费者，最小 2 处——`dark:hover:bg-gray-600`、`hover:bg-gray-50`，如实记账、非空转）。**带透明度 1 处值链实测**：`bg-n-black/50` → `hsl(var(--n-black) / .5)`。非空转探针（注入 `bg-black/95`）如预期报 **FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ 35 ＋ 33 ＋ 32 ＋ 31 ＋ 30 ＋ **30** ＝ **831** 处；剩余 **685 处 / 88 文件**，余下最大单片 `CreateTaskModal.tsx` 30（与 `TaskHelpModal.tsx` / `TaskCard.tsx` 并列）。

#### 0-E2u：`CreateTaskModal.tsx` 30 → 0（热点榜第十七，已实施）

**范围**：`src/modules/task-master/modals/CreateTaskModal.tsx`。**30 处 / 21 个 token / 10 行**——族 `gray` 24 ＋ `white` 5 ＋ `black` 1；工具类 `bg` 11 ／ `border` 8 ／ `text` 11；**带透明度 1 处**（模态遮罩 `bg-black/50`）。档位 `gray-50/100/200/300/400/600/700/800/900` ＋ `white` ＋ `black`（缺 `gray-500`）。

**与 0-E2t 的关系（可机械核对的同构）**：本片与上一片 0-E2t `GenerateTasksModal.tsx` 是**逐 token 同构的姊妹文件**——扫描器给出的 **21 个 token 及其出现次数完全一致**（`bg-white` 3、`dark:bg-gray-800` 2、`border-gray-200` 3、`dark:border-gray-700` 3、`bg-black/50` 1……），两片的 `byAtom` 减量也因此呈**逐条相同的 17 条模式**。唯一差别是模块品牌色族：0-E2t 用 `purple-*`，本片用 `blue-*`（两者均不属中性色、均未触碰）。核对方式不是"看起来像"，而是把两片的 token 清单直接比对——相同项数与计数一一对上。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 11 个档位（`gray-50/100/200/300/400/600/700/800/900` ＋ `white` ＋ `black`）在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **11 / 11**，无缺失，无需新建令牌。

**手法**：与 0-E2g…0-E2t 相同（扫描器为唯一事实源，`scanner hits: 30  exempt: 0  migratable: 30  rewrites: 30`；反向还原后与备份 `diff` 字节级相同）。token 含前缀包含关系（`text-gray-600` ⊂ `hover:text-gray-600`、`text-gray-400` ⊂ `dark:text-gray-400`），按**长度降序**替换后逐条对照确认未串味；本片有 `bg-black/50` 但**无裸 `bg-black`**，故该包含陷阱在本片不成立。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **685 → 655（−30）**，文件数 **88 → 87**；`byFile` 该文件 `30 → 0` 是唯一文件级 delta；`byAtom` **17 条全为减、无一增**，合计恰 **−30**，且**模式与 0-E2t 逐条相同**（`bg: white` −3、`border: gray-200` −3、`border: gray-700` −3、`bg: gray-700` / `bg: gray-800` / `text: gray-300` / `text: gray-400` / `text: gray-600` / `text: gray-900` / `text: white` 各 −2、其余 7 条各 −1；构成分解同 0-E2t），**无原子归零** |

**产物核对（通用脚本第 15 次复用）**：纯前缀插入 **YES**；21 个 token **全部**在 `dist` 有令牌形态；**0 个独占拼写**（21 个字面在 `src/` 均仍有其他消费者，最小 1 处——`dark:hover:bg-gray-600`、`hover:bg-gray-50`，如实记账、非空转）。**带透明度 1 处值链实测**：`bg-n-black/50` → `hsl(var(--n-black) / .5)`。非空转探针（注入 `bg-black/95`）如预期报 **FAILED**。

**一处连锁可观测**：`dark:hover:bg-gray-600` 与 `hover:bg-gray-50` 的 `src` 计数在本片迁移后为 **1**，而在 0-E2t 的产物核对里为 **2**——本片消费掉其中 1 处后余 1 处，与上文"最小 1 处"一致；两片的产物核对在数字上相互咬合。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ 35 ＋ 33 ＋ 32 ＋ 31 ＋ 30 ＋ 30 ＋ **30** ＝ **861** 处；剩余 **655 处 / 87 文件**，余下最大单片 `TaskHelpModal.tsx` 30（与 `TaskCard.tsx` 并列）。

#### 0-E2v：`TaskHelpModal.tsx` 30 → 0（热点榜第十八，已实施）

**范围**：`src/modules/task-master/modals/TaskHelpModal.tsx`。**30 处 / 19 个 token / 13 行**——族 `gray` 23 ＋ `white` 6 ＋ `black` 1；工具类 `text` 17 ／ `bg` 7 ／ `border` 6；**带透明度 2 处**（`bg-black/50` 与 `dark:bg-gray-800/50`）。档位 `gray-50/200/300/400/600/700/800/900` ＋ `white` ＋ `black`——**缺 `gray-100` 与 `gray-500`**。**无动态色构造、无轴限定形态**。同文件品牌色（`blue-*` / `emerald-*` / `amber-*` / `purple-*`，含 `steps[].accent` 模板串里的四组 accent 组合）未触碰。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 10 个档位（`gray-50/200/300/400/600/700/800/900` ＋ `white` ＋ `black`）在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **10 / 10**，无缺失，无需新建令牌。

**手法**：与 0-E2g…0-E2u 相同（扫描器为唯一事实源，`scanner hits: 30  exempt: 0  migratable: 30  rewrites: 30`；反向还原后与备份 `diff` 字节级相同）。token 含前缀包含关系（`text-white` ⊂ `dark:text-white`、`text-gray-400` ⊂ `dark:text-gray-400`、`text-gray-300` ⊂ `dark:text-gray-300`、`text-gray-600` ⊂ `hover:text-gray-600`），按**长度降序**替换后逐条对照确认未串味；`bg-black/50` 与 `dark:bg-gray-800/50` 均无对应的裸形态并存。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **655 → 625（−30）**，文件数 **87 → 86**；`byFile` 该文件 `30 → 0` 是唯一文件级 delta；`byAtom` **15 条全为减、无一增**，合计恰 **−30**（`text: white` −5 = `dark:text-white` 3 ＋ `text-white` 2；`border: gray-200` −3 = `border-gray-200` 3；`border: gray-700` −3 = `dark:border-gray-700` 3；`text: gray-400` −3 = `dark:text-gray-400` 2 ＋ `text-gray-400` 1；`text: gray-600` −3 = `text-gray-600` 2 ＋ `hover:text-gray-600` 1；`text: gray-900` −3 = `text-gray-900` 3；`text: gray-300` −2 = `dark:text-gray-300` 1 ＋ `dark:hover:text-gray-300` 1；其余 8 条各 −1），**无原子归零** |

**产物核对（通用脚本第 16 次复用）**：纯前缀插入 **YES**；19 个 token **全部**在 `dist` 有令牌形态；**0 个独占拼写**（19 个字面在 `src/` 均仍有其他消费者，最小 1 处——`dark:bg-gray-800/50`，如实记账、非空转）。**带透明度 2 处值链均实测**：`bg-n-black/50` → `hsl(var(--n-black) / .5)`、`dark:bg-n-gray-800/50` → `hsl(var(--n-gray-800) / .5)`。非空转探针（注入 `bg-black/95`）如预期报 **FAILED**。

**密度观察**：30 处落在 **13 行**（≈2.3 处/行），是近几片里最密的一类——原因是标题区与步骤列表把 `text-*` 成串写在同一 `className` 上，替换仍是逐 token 纯插入，无结构性风险。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ 35 ＋ 33 ＋ 32 ＋ 31 ＋ 30 ＋ 30 ＋ 30 ＋ **30** ＝ **891** 处；剩余 **625 处 / 86 文件**，余下最大单片 `TaskCard.tsx` 30。

#### 0-E2w：`TaskCard.tsx` 30 → 0（热点榜第十九，已实施）

**范围**：`src/modules/task-master/TaskCard.tsx`。**30 处 / 19 个 token / 13 行**——族 `gray` 24 ＋ `slate` 4 ＋ `white` 2；工具类 `text` 20 ／ `bg` 8 ／ `border` 2；**零透明度**（值链检查真空转，见下）。档位 `gray-100/200/300/400/500/700/800` ＋ `slate-100/400/500/900` ＋ `white`（共 12 档，两个族的档位互不重叠）。**无动态色构造、无轴限定形态**。同文件品牌/状态色未触碰。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 12 个档位（`gray` 7 档 ＋ `slate` 4 档 ＋ `white`）在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **12 / 12**，无缺失，无需新建令牌。

**手法**：与 0-E2g…0-E2v 相同（扫描器为唯一事实源，`scanner hits: 30  exempt: 0  migratable: 30  rewrites: 30`；反向还原后与备份 `diff` 字节级相同）。token 含前缀包含关系（`text-gray-400` ⊂ `dark:text-gray-400`、`text-gray-500` ⊂ `dark:text-gray-500`），按**长度降序**替换后逐条对照确认未串味；`dark:text-slate-100/400` 与 `text-slate-500/900` 无长短包含关系。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **625 → 595（−30）**，文件数 **86 → 85**；`byFile` 该文件 `30 → 0` 是唯一文件级 delta；`byAtom` **17 条全为减、无一增**，合计恰 **−30**（`text: gray-400` −6 = `dark:text-gray-400` 5 ＋ `text-gray-400` 1；`text: gray-500` −6 = `dark:text-gray-500` 1 ＋ `text-gray-500` 5；`bg: gray-100` −2 = `bg-gray-100` 2；`bg: gray-700` −2 = `dark:bg-gray-700` 2；`bg: gray-800` −2 = `dark:bg-gray-800` 2；其余 12 条各 −1），其中 **4 条归零**且**全在 `slate` 族**：`text: slate-100`、`text: slate-400`、`text: slate-500`、`text: slate-900` 各 1→0 |

**产物核对（通用脚本第 17 次复用）**：纯前缀插入 **YES**；19 个 token **全部**在 `dist` 有令牌形态；**4 个字面在迁移后于 `src/` 归零**（`dark:text-slate-100`、`dark:text-slate-400`、`text-slate-500`、`text-slate-900`——迁移前本片是其全仓唯一消费者），这四个的 `dist` 表单同样为 **0**、而对应令牌 `dist` 各为 **1**——即"字面规则不再生成、令牌规则新生成"在同一行上同时可读。其余 15 个字面仍有其他消费者（最小 5 处 = `bg-gray-200`）。**零透明度，值链检查迭代零次（真空转），如实标注**。非空转探针（注入 `bg-slate-999`）如预期报 **FAILED**。

**与 0-E2s 的对照**：这是本线第二次出现"独占拼写归零"，但规模更大（**4 个 vs 2 个**）且**跨族**（0-E2s 是同一 `placeholder` 工具类的两个档位，本片是 `slate` 族四个不同工具类位置的独立字面）。两片的 `byAtom` 归零条数与产物侧 `src` 归零字面数依旧一一对应。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ 35 ＋ 33 ＋ 32 ＋ 31 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ **30** ＝ **921** 处；剩余 **595 处 / 85 文件**，余下最大单片 `fileIcons.ts` 28。

#### 0-E2x：`fileIcons.ts` 28 → 0（热点榜第二十，已实施）

**范围**：`src/modules/file-tree/utils/fileIcons.ts`。**28 处 / 2 个 token / 28 行**。这是本线**结构最简单的一片**：扫描器只报出两个 token——`text-gray-500` ×21 与 `text-gray-400` ×7；族只有 `gray`，工具类只有 `text`，**零 `bg` / 零 `border` / 零透明度 / 零变体**（无 `dark:`、无 `hover:`）。档位只有 2 个（`gray-400` / `gray-500`）。文件其余部分是各语言/文件类型的品牌色图标映射（`text-blue-*`、`text-amber-*` 等）与 lucide 图标导入，均未触碰。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 2 个档位（`gray-400` / `gray-500`）在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **2 / 2**，无缺失。

**手法**：与 0-E2g…0-E2w 相同（扫描器为唯一事实源，`scanner hits: 28  exempt: 0  migratable: 28  rewrites: 28`；反向还原后与备份 `diff` 字节级相同）。本片**无任何前缀包含关系**（两个 token 都是裸 `text-gray-*`，无 `dark:`/`hover:` 长形态可与之竞争），长度降序替换在此退化为无关紧要的顺序。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **595 → 567（−28）**，文件数 **85 → 84**；`byFile` 该文件 `28 → 0` 是唯一文件级 delta；`byAtom` **仅 2 条**、均为减：`text: gray-400` **74 → 67（−7）**、`text: gray-500` **55 → 34（−21）**，合计恰 **−28**，**无原子归零** |

**产物核对（通用脚本第 18 次复用）**：纯前缀插入 **YES**；2 个 token **全部**在 `dist` 有令牌形态；**0 个独占拼写**（两个字面在 `src/` 仍有 19 / 21 处其他消费者）。**零透明度，值链检查迭代零次（真空转），如实标注**。非空转探针（注入 `text-gray-999`）如预期报 **FAILED**。

**一处结构性观察**：本片 28 处**恰好落在 28 行**（每行一处，无一行承载两处），与 0-E2v 的"30 处 / 13 行"（≈2.3 处/行）形成两端对照——两片都通过同一套门槛，说明核对流程对"密度"不敏感，只对"token 内容"敏感；这正是"从产物反推清单"设计的收益。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ 35 ＋ 33 ＋ 32 ＋ 31 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ **28** ＝ **949** 处；剩余 **567 处 / 84 文件**，余下最大单片 `TaskListContent.tsx` 24（与 `MessageComponent.tsx` 并列）。

#### 0-E2y：`TaskListContent.tsx` 24 → 0（热点榜第二十一，已实施）

**范围**：`src/modules/chat/tools/ContentRenderers/TaskListContent.tsx`。**24 处 / 15 个 token / 10 行**——**纯 `gray` 单族**（无 `white` / `black` / 非 gray 族）；工具类 `text` 18 ／ `bg` 4 ／ `border` 2；**零透明度**；档位 8 个（`gray-100/200/300/400/500/600/700/800`，缺 `50` 与 `900`）。变体含 `dark:` 与 `dark:border-*`。**无动态色构造、无轴限定形态**。同文件语义色（success / warning 等）未触碰。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 8 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **8 / 8**，无缺失。

**手法**：与 0-E2g…0-E2x 相同（扫描器为唯一事实源，`scanner hits: 24  exempt: 0  migratable: 24  rewrites: 24`；反向还原后与备份 `diff` 字节级相同）。token 含前缀包含关系（`text-gray-300/400/500` ⊂ 对应 `dark:text-gray-*`），按**长度降序**替换后逐条对照确认未串味。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **567 → 543（−24）**，文件数 **84 → 83**；`byFile` 该文件 `24 → 0` 是唯一文件级 delta；`byAtom` **13 条全为减、无一增**，合计恰 **−24**（`text: gray-400` −7 = `dark:text-gray-400` 4 ＋ `text-gray-400` 3；`text: gray-500` −4 = `dark:text-gray-500` 3 ＋ `text-gray-500` 1；`text: gray-600` −3 = `text-gray-600` 3；其余 10 条各 −1），**无原子归零** |

**产物核对（通用脚本第 19 次复用）**：纯前缀插入 **YES**；15 个 token **全部**在 `dist` 有令牌形态；**0 个独占拼写**（15 个字面在 `src/` 均仍有其他消费者，**最小 1 处 = `dark:text-gray-100`**——本片迁走后全仓恰好还剩 1 处，属于"贴边非独占"的临界样本，如实记账）。**零透明度，值链检查迭代零次（真空转），如实标注**。非空转探针（注入 `text-gray-999`）如预期报 **FAILED**。

**一处临界观察**：`dark:text-gray-100` 的 `src` 计数为 **1**——它距"独占拼写归零"只差一步。若下一片恰好是它最后的消费者，那条 `byAtom` 会归零、产物核对那一行会变成 `0 0`（与 0-E2s / 0-E2w 同形）。这条记录因此可以当作后续片次的"预期锚点"。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ 35 ＋ 33 ＋ 32 ＋ 31 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 28 ＋ **24** ＝ **973** 处；剩余 **543 处 / 83 文件**，余下最大单片 `MessageComponent.tsx` 24。

#### 0-E2z：`MessageComponent.tsx` 24 → 0（热点榜第二十二，已实施）

**范围**：`src/modules/chat/transcript/MessageComponent.tsx`。**24 处 / 16 个 token / 12 行**——族 `gray` 20 ＋ `white` 4；工具类 `text` 19 ／ `bg` 5（**无 `border`**、无 `placeholder` / `ring` 等）；**带透明度 1 处**（`dark:bg-gray-800/60`，**60% 档**）。档位 `gray-300/400/500/600/700/800` ＋ `white`（共 7 档，缺 `50` / `100` / `900`）。变体含 `dark:` / `dark:hover:` / `hover:`。**无动态色构造、无轴限定形态**。同文件语义状态色未触碰。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 7 个档位（`gray` 6 档 ＋ `white`）在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **7 / 7**，无缺失。

**手法**：与 0-E2g…0-E2y 相同（扫描器为唯一事实源，`scanner hits: 24  exempt: 0  migratable: 24  rewrites: 24`；反向还原后与备份 `diff` 字节级相同）。token 含前缀包含关系（`text-white` ⊂ `dark:text-white`、`text-gray-300/400/500` ⊂ 对应 `dark:text-gray-*` ＋ `dark:hover:text-gray-300`），按**长度降序**替换后逐条对照确认未串味。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **543 → 519（−24）**，文件数 **83 → 82**；`byFile` 该文件 `24 → 0` 是唯一文件级 delta；`byAtom` **12 条全为减、无一增**，合计恰 **−24**（`text: gray-400` −5 = `dark:text-gray-400` 3 ＋ `text-gray-400` 2；`text: gray-500` −5 = `dark:text-gray-500` 2 ＋ `text-gray-500` 3；`text: white` −4 = `dark:text-white` 1 ＋ `text-white` 3；`text: gray-300` −2 = `dark:text-gray-300` 1 ＋ `dark:hover:text-gray-300` 1；其余 8 条各 −1），**0 个原子桶归零**（最接近的是 `bg: gray-400`，迁后余 **1**） |

**产物核对（通用脚本第 20 次复用）**：纯前缀插入 **YES**；16 个 token **全部**在 `dist` 有令牌形态；**2 个字面在迁移后于 `src/` 归零**（`bg-gray-600`、`dark:bg-gray-500`——迁移前本片是其全仓唯一消费者），这两个的 `dist` 同为 **0**、对应令牌各为 **1**。**带透明度 1 处值链实测**：`dark:bg-n-gray-800/60` → `hsl(var(--n-gray-800) / .6)`（**首见 60% 档**，此前的透明度样本是 `/20` `/30` `/40` `/50`）。非空转探针（注入 `bg-gray-999`）如预期报 **FAILED**。

**本片最有价值的一处认知修正——"桶"比"字面"粗**：0-E2s 与 0-E2w 曾经呈现"`byAtom` 归零条数 = 产物侧 `src` 归零字面数"（各 2 与 4），容易让人以为两者恒等。本片给出反例：**2 个字面归零，`byAtom` 却 0 条归零**。原因是两者的聚合粒度不同——
- **原子桶**的键是 `变体链 工具类: 族-档`（如 `bg: gray-600`），同一档位下**所有变体字面**（`bg-gray-600`、`dark:bg-gray-600`、`hover:bg-gray-600`…）共享一个桶；
- **产物核对的 `src` 计数**是**字面级**（`bg-gray-600` 与 `dark:bg-gray-600` 分别统计）。

本片迁走的是裸 `bg-gray-600`（它唯一），但 `bg: gray-600` 桶里还有别的变体字面存活，故桶减 1（6 → 5）而不归零。同理 `bg: gray-500` 桶因 `dark:bg-gray-500` 之外仍有消费者，也是 6 → 5。所以正确表述是：**字面归零 ⇒ 该字面所属桶必然减计数；桶归零 ⟺ 该桶下所有变体字面都全仓零消费**——后者是更强的条件，只有在"该档位只剩这一个变体字面在消费"时才与前者的条数相等（0-E2s 的 `placeholder` 桶、0-E2w 的 `slate` 桶恰好满足）。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

#### 0-E3a：`CodeEditorBinaryFile.tsx` 23 → 0（热点榜第二十三，已实施）

**范围**：`src/modules/code-editor/CodeEditorBinaryFile.tsx`。**23 处 / 9 个 token / 6 行**——族 `gray` 17 ＋ `white` 5 ＋ `black` 1；工具类 `text` 16 ／ `bg` 7（**无 `border`**、无 `placeholder` / `ring` 等）；**带透明度 1 处**（`md:bg-black/50`）。档位 `gray-100/400/600/800/900` ＋ `white` ＋ `black`（共 7 档，缺 `50` / `200` / `300` / `700`）。变体含 `dark:` / `dark:hover:` / `hover:` / `md:`。**无动态色构造、无轴限定形态**。同文件语义状态色（`bg-background` / `text-muted-foreground` / `bg-primary` 等）未触碰。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 7 个档位（`gray` 5 档 ＋ `white` ＋ `black`）在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **7 / 7**，无缺失。

**手法**：与 0-E2g…0-E2z 相同（扫描器为唯一事实源，`scanner hits: 23  exempt: 0  migratable: 23  rewrites: 23`；反向还原后与备份 `diff` 字节级相同）。token 含前缀包含关系（`text-gray-900` ⊂ `hover:text-gray-900`；`text-white` ⊂ `dark:text-white` / `dark:hover:text-white`；`bg-black` ⊂ `md:bg-black/50`），按**长度降序**替换后逐条对照确认未串味。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **519 → 496（−23）**，文件数 **82 → 81**；`byFile` 该文件 `23 → 0` 是唯一文件级 delta；`byAtom` **7 条全为减、无一增**，合计恰 **−23**（`text: white` −5 = `dark:hover:text-white` 3 ＋ `dark:text-white` 2；`text: gray-900` −5 = `hover:text-gray-900` 3 ＋ `text-gray-900` 2；`bg: gray-800` −3 = `dark:hover:bg-gray-800` 3；`bg: gray-100` −3 = `hover:bg-gray-100` 3；`text: gray-400` −3 = `dark:text-gray-400` 3；`text: gray-600` −3 = `text-gray-600` 3；`bg: black` −1 = `md:bg-black/50` 1），**0 个原子桶归零** |

**产物核对（通用脚本第 21 次复用）**：纯前缀插入 **YES**；9 个 token **全部**在 `dist` 有令牌形态；**无字面在迁移后归零**（9 个字面的 `src` 计数最小为 **3**——`dark:hover:text-white` 与 `hover:text-gray-900` 各 3，即 **0 独占拼写**，本片没有任何字面是全仓唯一消费者）。**带透明度 1 处值链实测**：`md:bg-n-black/50` → `hsl(var(--n-black) / .5)`。非空转探针（注入 `bg-gray-999`）如预期报 **FAILED**。

**本片特征——"高密度复用"**：23 处落在仅 **6 行**。原因是三处按钮（侧栏关闭、全屏切换、关闭）共用**完全相同的 className 串** `flex items-center justify-center rounded-md p-1.5 text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white`（该串含 6 个中性色类，出现 3 次即 18 处；另加两个标题行的 `text-gray-900 dark:text-white` 各 2 处 = 4，与模态遮罩 1 处，合计 23）。这是继 0-E2l「同一 token 多处复用」之后第二个"低行数、高命中"样本，也是 `md:` 变体在本线首次出现（`md:bg-black/50`，桌面端遮罩）。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

#### 0-E3b：`CodeEditorMediaPreview.tsx` 22 → 0（热点榜第二十四，已实施）

**范围**：`src/modules/code-editor/CodeEditorMediaPreview.tsx`。**22 处 / 10 个 token / 6 行**——族 `gray` 16 ＋ `white` 5 ＋ `black` 1；工具类 `text` 14 ／ `bg` 8（**无 `border`**、无 `placeholder` / `ring` 等）；**带透明度 1 处**（`md:bg-black/50`）；含 `bg-white`（PDF `<iframe>` 背景）。档位 `gray-100/400/600/800/900` ＋ `white` ＋ `black`（共 7 档）。变体含 `dark:` / `dark:hover:` / `hover:` / `md:`。**无动态色构造、无轴限定形态**。同文件语义状态色（`bg-muted/30` / `text-muted-foreground` 等）未触碰。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 7 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **7 / 7**，无缺失。

**手法**：与 0-E2g…0-E3a 相同（扫描器为唯一事实源，`scanner hits: 22  exempt: 0  migratable: 22  rewrites: 22`；反向还原后与备份 `diff` 字节级相同）。token 含前缀包含关系（`text-gray-900` ⊂ `hover:text-gray-900`；`text-white` ⊂ `dark:text-white`；`bg-black` ⊂ `md:bg-black/50`），按**长度降序**替换后逐条对照确认未串味。本片与 0-E3a 共享同一段按钮 className，**6 个中性类完全相同**，是"同模块姊妹组件"的第二个样本。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **496 → 474（−22）**，文件数 **81 → 80**；`byFile` 该文件 `22 → 0` 是唯一文件级 delta；`byAtom` **8 条全为减、无一增**，合计恰 **−22**（`text: white` −4 = `dark:hover:text-white` 3 ＋ `dark:text-white` 1；`text: gray-900` −4 = `hover:text-gray-900` 3 ＋ `text-gray-900` 1；`bg: gray-800` −3；`bg: gray-100` −3；`text: gray-400` −3；`text: gray-600` −3；`bg: black` −1；`bg: white` −1），**0 个原子桶归零** |

**产物核对（通用脚本第 22 次复用）——首次报 FAILED，归因是脚本自身的覆盖面缺口**：首跑输出 `hover:text-gray-900` 一行 `src=0 / dist=1`，触发脚本的镜像断言 `(litSrc > 0) !== (litDist > 0)`。**这不是迁移缺陷**。追查到 `src/index.css:1082` 有一条**手写的、带 CSS 转义的选择器** `.hover\:text-gray-900:hover`（与 `a:hover` / `.hover\:bg-gray-50:hover` 等并列，见下）。核对脚本的 `srcExact` 只遍历 `src` 下的 `.tsx?` 文件，**完全看不见 CSS 里的类名引用**，于是把一个合法消费者判成"凭空多出的 dist 规则"。**修法**：给 `srcExact` 增加 `.css` 分支——按 `/\.((?:[A-Za-z0-9_-]|\\.)+)/g` 提取类选择器并反转义后再比较（*不能*用裸 token 扫描：CSS 选择器 token 化后是 `.hover:text-gray-900:hover`，带前导点与伪类，永不等于裸候选名）。修复后该行 `src` 由 0 变 **1**（即 index.css 那处），与 `dist=1` 一致，**ARTIFACT CHECK PASSED**。非空转双对照同时成立：**不注入 PASSED、注入 `bg-gray-999` FAILED**（`/tmp/0e2j-probe.cjs` 同缺口、同修复）。

**新发现——`index.css` 的选择器级消费者（阶段 0 口径缺口，已拍板 B3）**：`src/index.css` 的两段 `@media (hover: none) and (pointer: coarse)`（触屏禁用 hover）把**字面中性类名当作选择器目标**：

```css
.hover\:bg-gray-50:hover,
.hover\:bg-gray-100:hover,
.hover\:text-gray-900:hover { background-color: inherit !important; color: inherit !important; opacity: inherit !important; }
```

（`hover\:bg-gray-50` / `hover\:bg-gray-100` 各出现在 1044/1045 与 1080/1081 两段，`hover\:text-gray-900` 在 1082。）阶段 0 把**使用处**改成 `n-*` 后，这些选择器**不再命中已迁移元素**。量化：
- `hover:text-gray-900`——本片之后 `.tsx` 消费者**归零**，该 CSS 规则现匹配 **0** 个元素（完全失效），而它本该覆盖的那 6 处（0-E3a 3 ＋ 0-E3b 3）已改用 `hover:text-n-gray-900`，不再被重置；
- `hover:bg-gray-50` / `hover:bg-gray-100`——`.tsx` 仍有未迁移消费者（后者 `src` 计数 11），规则对**未迁移元素**仍有效，但对 0-E2t / 0-E2u 等已迁移元素已失配。

**影响面**：仅在触屏（`hover:none`）且发生 sticky hover 时可观测，视觉差异是"hover 态未被强制 `inherit`"。**取舍（已拍板，用户 2026-09-25）**：选项为 **B1** 逐片把这三行补成 `n-*` 选择器；**B2** 旧＋新两套并存（零行为变化，阶段 0 末删旧）；**B3** 不动，作为已知差异记账、交阶段 2 语义化改名时统一重排这些引用。**结论：采纳 B3**——理由：实际影响需触屏 sticky hover 才可观测，且阶段 2 本就要重排 `index.css` 的这些引用。配套决定：**扫描器 `themeHardcodedAtoms.ts` 暂不把 CSS 选择器级引用纳入口径**（若纳入须刷新冻结基准量 1517，属"护栏覆盖面变化"事项，本阶段不做）。这三行**不改、不删**，作为阶段 2 的显式待办保留。（探针侧的 `.css` 支撑已就地修复——那是核对工具的覆盖面，不入库。）

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ 35 ＋ 33 ＋ 32 ＋ 31 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 28 ＋ 24 ＋ 24 ＋ 23 ＋ **22** ＝ **1042** 处；剩余 **474 处 / 80 文件**，余下最大单片 `TaskFiltersPanel.tsx` 22。

#### 0-E3c：`TaskFiltersPanel.tsx` 22 → 0（热点榜第二十五，已实施）

**范围**：`src/modules/task-master/TaskFiltersPanel.tsx`。**22 处 / 9 个 token / 8 行**——族 `gray` 19 ＋ `white` 3；工具类 `bg` 8 ／ `text` 8 ／ `border` 6；**零透明度**；档位 `gray-50/300/400/600/700/800` ＋ `white`（共 7 档），变体仅 `dark:`。**无动态色构造、无轴限定形态**。同文件品牌色（`text-blue-600` / `hover:text-blue-700` / `dark:text-blue-400` / `dark:hover:text-blue-300`）未触碰。本片是 0-E2h 的 `TaskBoardToolbar.tsx` 的下游组件（由后者渲染），3 个 `<select>` 复用**同一段** `w-full rounded-md border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800`，是 22 处仅落 8 行的原因。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 7 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **7 / 7**，无缺失。

**手法**：与 0-E2g…0-E3b 相同（扫描器为唯一事实源，`scanner hits: 22  exempt: 0  migratable: 22  rewrites: 22`；反向还原后与备份 `diff` 字节级相同）。token 含前缀包含关系（`bg-gray-50` 与 `text-gray-600` 等互为不同字面但同族；`dark:border-gray-600` ⊃ `border-gray-600`），按**长度降序**替换后逐条对照确认未串味。**本片是 0-E3b 之后、不带 `index.css` 选择器命中形态的常见片**，迁移后无新增"选择器级消费者"暴露。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **474 → 452（−22）**，文件数 **80 → 79**；`byFile` 该文件 `22 → 0` 是唯一文件级 delta；`byAtom` **9 条全为减、无一增**，合计恰 **−22**（`bg: gray-800` −4；`border: gray-300` −3、`border: gray-600` −3；`text: gray-300` −3、`text: gray-700` −3；`bg: white` −3；`bg: gray-50` −1、`text: gray-400` −1、`text: gray-600` −1），**0 个原子桶归零** |

**产物核对（通用脚本第 23 次复用，含 0-E3b 新增的 `.css` 分支）**：**ARTIFACT CHECK PASSED**。9 个派生字面在 `src`（`.tsx` ＋ `.css`）均仍有其他消费者（`bg-gray-50` 12、`bg-white` 14、`border-gray-300` 2、`dark:bg-gray-800` 17、`dark:border-gray-600` 2、`dark:text-gray-300` 6、`dark:text-gray-400` 34、`text-gray-600` 19、`text-gray-700` 7）——**0 独占拼写，最小 2 处**；`dist` 侧 9 个 `n-*` 令牌规则各 1 条，值链检查**真空转**（0 个带透明度 token），纯插入证明 `reversed ≡ backup: YES`。非空转对照：**不注入 PASSED、注入 `bg-gray-999` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ 35 ＋ 33 ＋ 32 ＋ 31 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 28 ＋ 24 ＋ 24 ＋ 23 ＋ 22 ＋ **22** ＝ **1064** 处；剩余 **452 处 / 79 文件**，余下最大单片 `OverwriteConfirmModal.tsx` 18（与 `StepReview.tsx` / `TaskQuickSortBar.tsx` 并列）。

#### 0-E3d：`TaskQuickSortBar.tsx` 18 → 0（热点榜第二十六，已实施）

**范围**：`src/modules/task-master/TaskQuickSortBar.tsx`。**18 处 / 6 个 token / 3 行**——**6 个 token 各恰好 ×3**，是三个排序按钮复用**同一段** className（`bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700`）的直接结果，18 处仅落 3 行，是"密度最高"形态的又一极端样本。纯 `gray` 单族、6 档（`gray-100/200/400/600/700/800`），变体含 `hover:` / `dark:hover:` / `dark:`；零 `border` / `white` / `black` / 透明度。**无动态色构造、无轴限定形态**。同文件品牌色（`bg-blue-100` / `dark:bg-blue-900` / `text-blue-700` / `dark:text-blue-300`，选中态）未触碰；本片由 0-E2h 的 `TaskBoardToolbar.tsx` 渲染（`TaskFiltersPanel.tsx` 亦同族）。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 6 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **6 / 6**，无缺失。

**手法**：与 0-E2g…0-E3c 相同（扫描器为唯一事实源，`scanner hits: 18  exempt: 0  migratable: 18  rewrites: 18`；反向还原后与备份 `diff` 字节级相同）。本片 6 个 token 之间无前缀包含关系，替换无串味风险，仍逐条对照确认。**不含 `index.css` 选择器命中形态**（`hover:bg-gray-200` 不在那三行选择器目标内）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **452 → 434（−18）**，文件数 **79 → 78**；`byFile` 该文件 `18 → 0` 是唯一文件级 delta；`byAtom` **6 条全为减、各 −3**，合计恰 **−18**（`bg: gray-100` −3、`bg: gray-200` −3、`bg: gray-700` −3、`bg: gray-800` −3、`text: gray-400` −3、`text: gray-600` −3），**0 个原子桶归零** |

**产物核对（通用脚本第 24 次复用，含 0-E3b 新增的 `.css` 分支）**：**ARTIFACT CHECK PASSED**。6 个派生字面中 5 个在 `src` 仍有其他消费者（`bg-gray-100` 7、`dark:bg-gray-800` 14、`dark:hover:bg-gray-700` 4、`dark:text-gray-400` 31、`text-gray-600` 16），**唯 `hover:bg-gray-200` 迁移后 `src=0`**——它是本片 3 处独占的字面，迁完即全仓零消费，Tailwind 也随之**不再生成**该规则（`dist=0`）。这与 0-E2z 的"2 字面归零但 0 桶归零"同源：`hover:bg-gray-200` 归零而 `bg: gray-200` 桶仍存 4（其他变体字面仍在），**再次印证桶粒度粗于字面粒度**。值链检查**真空转**（0 个带透明度 token），纯插入证明 `reversed ≡ backup: YES`。非空转对照：**不注入 PASSED、注入 `bg-gray-999` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ 35 ＋ 33 ＋ 32 ＋ 31 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 28 ＋ 24 ＋ 24 ＋ 23 ＋ 22 ＋ 22 ＋ **18** ＝ **1082** 处；剩余 **434 处 / 78 文件**，余下最大单片 `OverwriteConfirmModal.tsx` 18（与 `StepReview.tsx` 并列）。

#### 0-E3e：`OverwriteConfirmModal.tsx` 18 → 0（热点榜第二十七，已实施）

**范围**：`src/modules/prd-editor/modals/OverwriteConfirmModal.tsx`。**18 处 / 17 个 token / 6 行**——**18 处落在 17 个不同 token 上**（16 个各仅 1 次、唯 `bg-white` 2 次），是"几乎每个类名各出现一次"的模态框典型形态（与 0-E3d 的"6 token 各 ×3"互为另一极端）。跨三色 `gray` / `white` / `black`，档位 `gray-50/200/300/400/600/700/800` ＋ `white` ＋ `black`（共 9 档），变体含 `dark:` / `hover:` / `dark:hover:`。**无动态色构造、无轴限定形态**。同文件语义状态色（`bg-yellow-100` / `text-yellow-600` 等警示样式）未触碰。**含模态遮罩 `bg-black/50`**（与 0-E2k / 0-E2q / 0-E2t 同类）。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 9 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **9 / 9**，无缺失。

**手法**：与 0-E2g…0-E3d 相同（扫描器为唯一事实源，`scanner hits: 18  exempt: 0  migratable: 18  rewrites: 18`；反向还原后与备份 `diff` 字节级相同）。token 含前缀包含关系（`bg-black` ⊂ `bg-black/50`），按**长度降序**替换后逐条对照确认未串味。**注意 `hover:bg-gray-50` 属 `index.css` 选择器目标三行之一**（见 0-E3b 的 B3 决策）——本片迁后该字面在 `src` 仍有 2 个消费者，规则未整体失效，但本片这 1 处已改用 `hover:bg-n-gray-50`、不再被那三行选择器命中，属 B3 记账范围内的既有差异，本片不处理。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **434 → 416（−18）**，文件数 **78 → 77**；`byFile` 该文件 `18 → 0` 是唯一文件级 delta；`byAtom` **16 条全为减、无一增**，合计恰 **−18**（`bg: white` −2、`text: white` −2；`bg: black`、`bg: gray-50`、`bg: gray-600`、`bg: gray-700`、`bg: gray-800`、`border: gray-200`、`border: gray-300`、`border: gray-600`、`border: gray-700`、`text: gray-300`、`text: gray-400`、`text: gray-600`、`text: gray-700`、`text: gray-900` 各 −1），**0 个原子桶归零**（`border: gray-300` 由 2 → **1**，进入临界） |

**产物核对（通用脚本第 25 次复用，含 0-E3b 新增的 `.css` 分支）**：**ARTIFACT CHECK PASSED**。17 个派生字面中 16 个在 `src` 仍有其他消费者（最小 `border-gray-300` 1、`dark:border-gray-600` 1），**唯 `dark:hover:bg-gray-600` 迁后 `src=0`**——由本片独占，迁完即全仓零消费，Tailwind 随之不再生成（`dist=0`），与 0-E2z / 0-E3d 同源：该字面归零而 `bg: gray-600` 桶仍存 4，**第三次印证桶粒度粗于字面粒度**。`hover:bg-gray-50` 两侧均 2（迁后仍有 2 个 src 消费者，含 `index.css` 那处选择器，`.css` 分支正确计入）。值链检查：`bg-n-black/50` → `.bg-n-black\/50{background-color:hsl(var(--n-black) / .5)}`，**50% 透明度实测到达 `--n-black`**（本片 1 个带透明度 token）；纯插入证明 `reversed ≡ backup: YES`。非空转对照：**不注入 PASSED、注入 `bg-gray-999` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ 35 ＋ 33 ＋ 32 ＋ 31 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 28 ＋ 24 ＋ 24 ＋ 23 ＋ 22 ＋ 22 ＋ 18 ＋ **18** ＝ **1100** 处；剩余 **416 处 / 77 文件**，余下最大单片 `StepReview.tsx` 18。

#### 0-E3f：`StepReview.tsx` 18 → 0（热点榜第二十八，已实施）

**范围**：`src/modules/project-creation-wizard/StepReview.tsx`。**18 处 / 8 个 token / 8 行**——族 `gray` ＋ `white`（无 `black`）；工具类 `text` 14 ／ `bg` 2 ／ `border` 2；档位 `gray-50/200/400/600/700/900` ＋ `white`（共 7 档），变体仅 `dark:`。**带透明度 1 处**（`dark:bg-gray-900/50`）。**无动态色构造、无轴限定形态**。同文件蓝色信息卡（`border-blue-200` / `bg-blue-50` / `dark:border-blue-800` / `dark:bg-blue-900/20` / `text-blue-800` / `dark:text-blue-200` 等）未触碰。**含 `index.css` 选择器目标外的普通 hover 形态**（本片无 `hover:` 变体）。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 7 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **7 / 7**，无缺失。

**手法**：与 0-E2g…0-E3e 相同（扫描器为唯一事实源，`scanner hits: 18  exempt: 0  migratable: 18  rewrites: 18`；反向还原后与备份 `diff` 字节级相同）。token 含前缀包含关系（`text-gray-600` 与 `text-gray-900` 同族不同档；`dark:bg-gray-900/50` ⊃ `bg-gray-900`），按**长度降序**替换后逐条对照确认未串味。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **416 → 398（−18）**，文件数 **77 → 76**；`byFile` 该文件 `18 → 0` 是唯一文件级 delta；`byAtom` **8 条全为减、无一增**，合计恰 **−18**（`text: gray-900` −4、`text: white` −4；`text: gray-400` −3、`text: gray-600` −3；`bg: gray-50` −1、`bg: gray-900` −1、`border: gray-200` −1、`border: gray-700` −1），**0 个原子桶归零** |

**产物核对（通用脚本第 26 次复用，含 0-E3b 新增的 `.css` 分支）**：**ARTIFACT CHECK PASSED**。8 个派生字面在 `src` 均仍有其他消费者（`bg-gray-50` 11、`border-gray-200` 17、`dark:border-gray-700` 15、`dark:text-gray-400` 27、`dark:text-white` 8、`text-gray-600` 12、`text-gray-900` 9、`dark:bg-gray-900/50` 1）——**0 独占拼写，最小 1 处**。值链检查：`dark:bg-n-gray-900/50` → `.dark\:bg-n-gray-900\/50:is(.dark *){background-color:hsl(var(--n-gray-900) / .5)}`，**50% 透明度实测到达 `--n-gray-900`**（本片 1 个带透明度 token）；纯插入证明 `reversed ≡ backup: YES`。非空转对照：**不注入 PASSED、注入 `bg-gray-999` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ 35 ＋ 33 ＋ 32 ＋ 31 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 28 ＋ 24 ＋ 24 ＋ 23 ＋ 22 ＋ 22 ＋ 18 ＋ 18 ＋ **18** ＝ **1118** 处；剩余 **398 处 / 76 文件**，余下最大单片 `SidebarProjectItem.tsx` 16（与 `taskKanban.ts` 并列）。

#### 0-E3g：`SidebarProjectItem.tsx` 16 → 0（热点榜第二十九，已实施）

**范围**：`src/modules/sidebar/SidebarProjectItem.tsx`。**16 处 / 12 个 token / 7 行**——族 `gray` ＋ `white`（无 `black`）；档位 `gray-200/400/500/600/800/900` ＋ `white`（共 7 档）；变体含 `hover:` / `dark:hover:` / `dark:`。**带透明度 2 处**（`bg-gray-500/10` 10%、`dark:bg-gray-900/30` 30%）。**`bg-gray-500` 一族在本片集中**（裸 `bg-gray-500`、`bg-gray-500/10`、`hover:bg-gray-500`、`dark:hover:bg-gray-500` 四种变体同现），是本片 token 多样性的主要来源。**无动态色构造、无轴限定形态**。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 7 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **7 / 7**，无缺失。

**手法**：与 0-E2g…0-E3f 相同（扫描器为唯一事实源，`scanner hits: 16  exempt: 0  migratable: 16  rewrites: 16`；反向还原后与备份 `diff` 字节级相同）。token 含多重前缀包含关系（`bg-gray-500` ⊂ `bg-gray-500/10`；`hover:bg-gray-500` ⊂ `dark:hover:bg-gray-500`），按**长度降序**替换后逐条对照确认未串味。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **398 → 382（−16）**，文件数 **76 → 75**；`byFile` 该文件 `16 → 0` 是唯一文件级 delta；`byAtom` **9 条全为减、无一增**，合计恰 **−16**（`bg: gray-500` −4、`text: white` −4；`bg: gray-600` −2；`bg: gray-400` −1、`bg: gray-900` −1、`border: gray-200` −1、`border: gray-800` −1、`text: gray-400` −1、`text: gray-600` −1），**其中 2 个原子桶归零**：`bg: gray-400`（1 → 0）、`border: gray-800`（1 → 0） |

**产物核对（通用脚本第 27 次复用，含 0-E3b 新增的 `.css` 分支）**：**ARTIFACT CHECK PASSED**。12 个派生字面中 **7 个迁后 `src=0`**（`bg-gray-400`、`bg-gray-500`、`bg-gray-500/10`、`dark:bg-gray-900/30`、`dark:border-gray-800`、`dark:hover:bg-gray-500`、`hover:bg-gray-500`）——**本片是它们的唯一消费者**，迁完即全仓零消费，Tailwind 也随之不再生成（各 `dist=0`），与 0-E2z / 0-E3d / 0-E3e 的"桶粒度粗于字面"格局一致：**7 个字面归零、其中仅 2 个桶归零**（`bg: gray-400`、`border: gray-800` 桶恰好只剩这一个变体字面，故同步归零；其余 5 个与别处同档不同变体的字面共享桶）。存活侧最小 `dark:bg-gray-600` = 1。值链检查：`bg-n-gray-500/10` → `.bg-n-gray-500\/10{background-color:hsl(var(--n-gray-500) / .1)}`、`dark:bg-n-gray-900/30` → `.dark\:bg-n-gray-900\/30:is(.dark *){background-color:hsl(var(--n-gray-900) / .3)}`，**10% 与 30% 两处透明度均实测到达 `--n-*`**；纯插入证明 `reversed ≡ backup: YES`。非空转对照：**不注入 PASSED、注入 `bg-gray-999` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ 35 ＋ 33 ＋ 32 ＋ 31 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 28 ＋ 24 ＋ 24 ＋ 23 ＋ 22 ＋ 22 ＋ 18 ＋ 18 ＋ 18 ＋ **16** ＝ **1134** 处；剩余 **382 处 / 75 文件**，余下最大单片 `taskKanban.ts` 16。

#### 0-E3h：`taskKanban.ts` 16 → 0（热点榜第三十，已实施）

**范围**：`src/modules/task-master/utils/taskKanban.ts`（纯 `.ts` 工具模块，非 TSX）。**16 处 / 16 个 token / 4 行**——族 `slate` 8 ＋ `gray` 8；档位 `slate-50/100/200/700/800/900` ＋ `gray-50/100/200/700/800/900`；变体 `dark:` 与裸类。**带透明度 2 处**（`dark:bg-slate-900/50`、`dark:bg-gray-900/50`，均 50%）。**该文件是 `KANBAN_COLUMN_CONFIG` 的六列语义色配置表**：pending=`slate`、cancelled=`gray`（中性，本片迁），in-progress=`blue`、done=`emerald`、blocked=`red`、deferred=`amber`（语义彩色，**非本线范围、未触碰**）——**同一数据结构里中性色与语义色交错，是本片独有的样本**。16 处落在 `color` 与 `headerColor` 两串，每串 4 个 token，slate 列与 gray 列复用同一形状。**无动态色构造、无轴限定形态**。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 12 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **12 / 12**，无缺失。

**手法**：与 0-E2g…0-E3g 相同（扫描器为唯一事实源，`scanner hits: 16  exempt: 0  migratable: 16  rewrites: 16`；反向还原后与备份 `diff` 字节级相同）。**16 个 token 各恰好 ×1**；脚本核对确认本文件 16 个 token **两两互不为子串**（不存在 `bg-slate-50` / `bg-slate-500` 一类的包含对，子串对计数为 0），故按**长度降序**替换后无需担心串味——仍逐条对照确认（含斜杠的两处透明度 token 最长，先替换）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **382 → 366（−16）**，文件数 **75 → 74**；`byFile` 该文件 `16 → 0` 且从表中消失，是唯一文件级 delta；`byAtom` **16 条全为减、无一增**，合计恰 **−16**（`bg: gray-800` −1、`bg: gray-900` −1、`bg: gray-100` −1、`bg: gray-50` −1、`bg: slate-100` −1、`bg: slate-50` −1、`bg: slate-800` −1、`bg: slate-900` −1、`border: gray-200` −1、`border: gray-700` −1、`border: slate-200` −1、`border: slate-700` −1、`text: gray-200` −1、`text: gray-800` −1、`text: slate-200` −1、`text: slate-800` −1），**其中 7 个原子桶归零**：`bg: slate-50`、`bg: slate-800`、`border: slate-200`、`border: slate-700`、`text: gray-800`、`text: slate-200`、`text: slate-800`（各 1 → 0） |

**产物核对（通用脚本第 28 次复用，含 0-E3b 新增的 `.css` 分支）**：**ARTIFACT CHECK PASSED**。16 个派生字面中 **9 个迁后 `src=0`**（`bg-slate-50`、`border-slate-200`、`dark:bg-slate-800`、`dark:bg-slate-900/50`、`dark:border-slate-700`、`dark:text-slate-200`、`text-slate-800`、`text-gray-800`、`dark:bg-gray-900/50`）——**本片是它们的唯一消费者**，迁完即全仓零消费、Tailwind 随之不再生成（各 `dist=0`）；**9 个字面归零、其中 7 个桶归零**（`dark:bg-slate-900/50` 与 `dark:bg-gray-900/50` 虽各自归零，但其桶内尚有别处的同档不同变体字面存活，故桶只减不归零——`bg: slate-900` 2→1、`bg: gray-900` 19→18），**再次印证"桶粒度粗于字面"**（0-E2z / 0-E3d / 0-E3e / 0-E3g 同一格局）。存活侧最小 `bg-slate-100` = 1。值链检查：`dark:bg-n-slate-900/50` → `.dark\:bg-n-slate-900\/50:is(.dark *){background-color:hsl(var(--n-slate-900) / .5)}`、`dark:bg-n-gray-900/50` → `.dark\:bg-n-gray-900\/50:is(.dark *){background-color:hsl(var(--n-gray-900) / .5)}`，**两处 50% 透明度均实测到达 `--n-*`**；纯插入证明 `reversed ≡ backup: YES`。非空转对照：**不注入 PASSED、注入 `bg-gray-123,text-slate-456` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ 35 ＋ 33 ＋ 32 ＋ 31 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 28 ＋ 24 ＋ 24 ＋ 23 ＋ 22 ＋ 22 ＋ 18 ＋ 18 ＋ 18 ＋ 16 ＋ **16** ＝ **1150** 处；剩余 **366 处 / 74 文件**，余下最大单片 `ImageViewer.tsx` / `ProjectCreationWizard.tsx` / `ShellHeader.tsx` / `TaskBoardContent.tsx` 四者并列 14。

#### 0-E3i：`ImageViewer.tsx` 14 → 0（热点榜第三十一，已实施）

**范围**：`src/modules/file-tree/ImageViewer.tsx`。**14 处 / 9 个 token / 7 行**——族 `gray` ＋ `white`（无 `black`）；档位 `gray-50/400/500/600/800/900` ＋ `white`；变体 `dark:` 与裸类。**14 处每处都是 light＋dark 成对**（行内结构固定）。**零透明度**（本片不含 `/xx` 形式 token）。**零 `border`**（`text` 9 ／ `bg` 4）。**该文件已含一处前片遗留令牌 `bg-n-black/50`**（模态遮罩，0-E2 系列遮罩片所留），本片未触碰。**无动态色构造、无轴限定形态**。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 7 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **7 / 7**，无缺失。

**手法**：与 0-E2g…0-E3h 相同（扫描器为唯一事实源，`scanner hits: 14  exempt: 0  migratable: 14  rewrites: 14`；正向重放证明下与备份逐字节一致）。**9 个 token**：`dark:text-gray-400` ×3、`dark:bg-gray-800` ×2、`text-gray-500` ×2、`bg-gray-50` ×2，余 5 个各 ×1。脚本核对确认本文件 9 个 token **两两互不为子串**。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **366 → 352（−14）**，文件数 **74 → 73**；`byFile` 该文件 `14 → 0` 且从表中消失，是唯一文件级 delta；`byAtom` **9 条全为减、无一增**，合计恰 **−14**（`text: gray-400` −3、`bg: gray-50` −2、`bg: gray-800` −2、`text: gray-500` −2、`bg: gray-900` −1、`bg: white` −1、`text: gray-600` −1、`text: gray-900` −1、`text: white` −1），**无桶归零**（9 个桶迁后均仍有剩余） |

**产物核对（通用脚本第 29 次复用，本次修正前提假设）**：**ARTIFACT CHECK PASSED**（修正后）。脚本第一次跑出 **FAILED**，根因**不是本片迁移有误，而是脚本的前提假设被打破**：脚本第 1 项证明为"把当前文件的 `-n-` 反向还原，应逐字节等于备份"，这隐含假设"被测文件迁移前不含 `n-*` 令牌"。本片文件携带前片遗留的 `bg-n-black/50`，反向还原会把这一处也还原成 `bg-black/50`，于是**永远无法等于备份**（0-E3b 是脚本**覆盖面**缺口，本条是脚本**前提假设**缺口）。修法：改为**正向重放**——从备份出发，把本片 token 的字面→令牌替换回放一遍，结果须逐字节等于当前文件；并用"还原后确实存在于备份中的字面"筛出本片字面（前片遗留令牌还原出的字面在备份中不存在，自动落选）。该证明**不弱于**原证明：它同样能抓"漏迁"（未替换的字面会存活）与"多插"（`n-n-` 会与期望不符），且不受前片遗留令牌干扰。**变异测试**：把某处 `bg-n-gray-50` 改回 `bg-gray-50`（漏迁）→ FAILED；改成 `bg-n-n-gray-50`（多插）→ FAILED；恢复后 PASSED。**回归**：用同法重跑 0-E3h（纯字面文件）仍 PASSED。9 个派生字面在 `src` 均仍有其他消费者（`dark:text-gray-400` 23、`text-gray-500` 15、`bg-white` 11、`dark:bg-gray-800` 10、`text-gray-600` 10、`bg-gray-50` 8、`text-gray-900` 8、`dark:text-white` 7、`dark:bg-gray-900` 4）——**0 独占拼写，最小 4 处**。值链检查：本片无透明度 token；脚本另核对文件内既有的 `bg-n-black/50` → `.bg-n-black\/50{background-color:hsl(var(--n-black) / .5)}` 仍在。非空转对照：**不注入 PASSED、注入 `bg-gray-123,text-slate-456` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ 35 ＋ 33 ＋ 32 ＋ 31 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 28 ＋ 24 ＋ 24 ＋ 23 ＋ 22 ＋ 22 ＋ 18 ＋ 18 ＋ 18 ＋ 16 ＋ 16 ＋ **14** ＝ **1164** 处；剩余 **352 处 / 73 文件**，余下最大单片 `ProjectCreationWizard.tsx` / `ShellHeader.tsx` / `TaskBoardContent.tsx` 三者并列 14。

#### 0-E3j：`ProjectCreationWizard.tsx` 14 → 0（热点榜第三十二，已实施）

**范围**：`src/modules/project-creation-wizard/ProjectCreationWizard.tsx`。**14 处 / 12 个 token / 5 行**——族 `gray` 12 ＋ `white` 1 ＋ `black` 1；档位 `black`、`gray-100/200/300/400/600/700/800/900`、`white`；变体含裸类 / `hover:` / `dark:` / `dark:hover:`。**带透明度 1 处**（`bg-black/50`，模态遮罩，50%）。**该文件是模态外壳**：第 135–137 行是全屏遮罩 ＋ 卡片容器 ＋ 头部（同一 `border-b border-n-gray-200 p-6 dark:border-n-gray-700` 串在容器与头部各复用一次，故 `border-gray-200` / `dark:border-gray-700` 各 ×2），并含**响应式 `sm:` 前缀**（全屏 → `sm:rounded-lg sm:border`）。**无前片遗留令牌、无动态色构造、无轴限定形态**。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 10 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **10 / 10**，无缺失。

**手法**：与 0-E2g…0-E3i 相同（扫描器为唯一事实源，`scanner hits: 14  exempt: 0  migratable: 14  rewrites: 14`；正向重放证明下与备份逐字节一致）。**12 个 token**：`border-gray-200` ×2、`dark:border-gray-700` ×2，余 10 个各 ×1。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **352 → 338（−14）**，文件数 **73 → 72**；`byFile` 该文件 `14 → 0` 且从表中消失，是唯一文件级 delta；`byAtom` **12 条全为减、无一增**，合计恰 **−14**（`border: gray-200` −2、`border: gray-700` −2；`bg: black` −1、`bg: gray-100` −1、`bg: gray-700` −1、`bg: gray-800` −1、`bg: white` −1、`text: gray-300` −1、`text: gray-400` −1、`text: gray-600` −1、`text: gray-900` −1、`text: white` −1），**无桶归零** |

**产物核对（通用脚本第 30 次复用，正向重放版）**：**ARTIFACT CHECK PASSED**。12 个派生字面在 `src` 均仍有其他消费者（`border-gray-200` 13、`text-gray-400` 13、`dark:border-gray-700` 12、`bg-white` 10、`hover:bg-gray-100` 10、`dark:bg-gray-800` 9、`text-gray-900` 7、`dark:text-white` 6、`dark:hover:bg-gray-700` 3、`dark:hover:text-gray-300` 3、`hover:text-gray-600` 3、`bg-black/50` 2）——**0 独占拼写，最小 2 处**。值链检查：`bg-n-black/50` → `.bg-n-black\/50{background-color:hsl(var(--n-black) / .5)}`，**50% 透明度实测到达 `--n-black`**（本片 1 个带透明度 token）。非空转对照：**不注入 PASSED、注入 `bg-gray-123,text-slate-456` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ 35 ＋ 33 ＋ 32 ＋ 31 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 28 ＋ 24 ＋ 24 ＋ 23 ＋ 22 ＋ 22 ＋ 18 ＋ 18 ＋ 18 ＋ 16 ＋ 16 ＋ 14 ＋ **14** ＝ **1178** 处；剩余 **338 处 / 72 文件**，余下最大单片 `ShellHeader.tsx` / `TaskBoardContent.tsx` 二者并列 14。

#### 0-E3k：`ShellHeader.tsx` 14 → 0（热点榜第三十三，已实施）

**范围**：`src/modules/shell/ShellHeader.tsx`。**14 处 / 9 个 token / 6 行**——族 `gray` 13 ＋ `white` 4；档位 `gray-100/400/500/600/700/800` ＋ `white`；变体含裸类 / `hover:` / `disabled:`。**带透明度 2 类**（`border-gray-600/80` 80%、`bg-gray-700/70` 70%，各 ×2）。**同一 className 串内语义彩色与中性色交错**：`border-orange-500/70 bg-orange-600/80 … focus:ring-orange-400/70`（`hover:`/`focus:` 态）与 `bg-red-600` / `hover:bg-blue-600/80` 等语义色**非本线范围、未触碰**。**文件含 3 处前片遗留令牌 `focus:ring-offset-n-gray-800`**（焦点环偏移，0-E2 系列片所留），本片未触碰——这是 0-E3i 修正后的**正向重放第二次复用**。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 7 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **7 / 7**，无缺失。

**手法**：与 0-E2g…0-E3j 相同（扫描器为唯一事实源，`scanner hits: 14  exempt: 0  migratable: 14  rewrites: 14`；正向重放证明下与备份逐字节一致）。**9 个 token**：`text-white` / `hover:text-white` / `border-gray-600/80` / `bg-gray-700/70` / `text-gray-100` 各 ×2，余 4 个各 ×1（前缀包含对 `text-white` ⊂ `hover:text-white` 按长度降序先替长项，逐条对照确认未串味）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **338 → 324（−14）**，文件数 **72 → 71**；`byFile` 该文件 `14 → 0` 且从表中消失，是唯一文件级 delta；`byAtom` **9 条全为减、无一增**，合计恰 **−14**（`text: white` −4、`bg: gray-700` −2、`border: gray-600` −2、`text: gray-100` −2、`bg: gray-800` −1、`border: gray-700` −1、`text: gray-400` −1、`text: gray-500` −1），**无桶归零** |

**产物核对（通用脚本第 31 次复用，正向重放版）**：**ARTIFACT CHECK PASSED**。文件共 17 个中性 token（含 3 处遗留令牌），正向重放筛出**本片 9 个派生字面**、遗留令牌自动落选。**3 个字面迁后 `src=0`**（`bg-gray-700/70`、`border-gray-600/80`、`disabled:text-gray-500`）——本片是它们的唯一消费者，迁完即全仓零消费、Tailwind 随之不再生成（各 `dist=0`）；**3 个字面归零、其中 0 个桶归零**（`bg: gray-700` 11→9、`border: gray-600` 5→3、`text: gray-500` 23→22，同桶另有别变体字面存活），**再次印证"桶粒度粗于字面"**。存活侧最小 `border-gray-700` = 1。值链检查：`border-n-gray-600/80` → `.border-n-gray-600\/80{border-color:hsl(var(--n-gray-600) / .8)}`、`bg-n-gray-700/70` → `.bg-n-gray-700\/70{background-color:hsl(var(--n-gray-700) / .7)}`，**80% 与 70% 两处透明度均实测到达 `--n-*`**。非空转对照：**不注入 PASSED、注入 `bg-gray-123,text-slate-456` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ 35 ＋ 33 ＋ 32 ＋ 31 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 28 ＋ 24 ＋ 24 ＋ 23 ＋ 22 ＋ 22 ＋ 18 ＋ 18 ＋ 18 ＋ 16 ＋ 16 ＋ 14 ＋ 14 ＋ **14** ＝ **1192** 处；剩余 **324 处 / 71 文件**，余下最大单片 `TaskBoardContent.tsx` 14。

#### 0-E3l：`TaskBoardContent.tsx` 14 → 0（热点榜第三十四，已实施）

**范围**：`src/modules/task-master/TaskBoardContent.tsx`。**14 处 / 10 个 token / 7 行**——族 `gray` 12 ＋ `white` 1 ＋ `black` 1；档位 `gray-200 / 300 / 400 / 500 / 600 / 700` ＋ `white` / `black`；变体含裸类 / `dark:`。**带透明度 2 类**（`bg-white/60` 60%、`dark:bg-black/20` 20%）。属看板**"暂无任务"空态**（`text-gray-400` 提示 ＋ `bg-gray-200` / `bg-gray-300` 两级同心圆占位 ＋ `text-gray-500` / `text-gray-400` 双行文案）与**卡片计数徽标**（`bg-white/60 dark:bg-black/20`）。无 `border` 工具类。**文件不含前片遗留令牌**（`scanScaleTokenAtoms` 报 0）。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 8 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **8 / 8**，无缺失。

**手法**：与 0-E2g…0-E3k 相同（扫描器为唯一事实源，`scanner hits: 14  exempt: 0  migratable: 14  rewrites: 14`；正向重放证明下与备份逐字节一致）。**10 个 token**：`text-gray-400` / `dark:text-gray-500` / `text-gray-500` / `dark:text-gray-400` 各 ×2，余 6 个（`bg-white/60` / `dark:bg-black/20` / `bg-gray-200` / `dark:bg-gray-700` / `bg-gray-300` / `dark:bg-gray-600`）各 ×1（前缀包含对按长度降序先替长项，逐条对照确认未串味）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **324 → 310（−14）**，文件数 **71 → 70**；`byFile` 该文件 `14 → 0` 且从表中消失，是唯一文件级 delta；`byAtom` **8 条全为减、无一增**，合计恰 **−14**（`text: gray-400` −4、`text: gray-500` −4、`bg: black` −1、`bg: gray-200` −1、`bg: gray-300` −1、`bg: gray-600` −1、`bg: gray-700` −1、`bg: white` −1），**1 桶归零**（`bg: gray-300` 1→0） |

**产物核对（通用脚本第 32 次复用，正向重放版）**：**ARTIFACT CHECK PASSED**。文件共 **14 个中性 token**（本片全部为新迁移，无遗留令牌），正向重放筛出**10 个派生字面**。**4 个字面迁后 `src=0`**（`bg-gray-300`、`bg-white/60`、`dark:bg-black/20`、`dark:bg-gray-600`）——本片是它们的唯一消费者，迁完即全仓零消费、Tailwind 随之不再生成（各 `dist=0`）；**4 个字面归零、其中 1 个桶归零**（`bg: gray-300`；`bg: gray-600` / `bg: white` / `bg: black` 同桶另有别变体字面存活）——**再次印证"桶粒度粗于字面"，本次方向为字面多、桶少**。存活侧最小 `bg-gray-200` = 3、`dark:bg-gray-700` = 4。值链检查：`bg-n-white/60` → `.bg-n-white\/60{background-color:hsl(var(--n-white) / .6)}`、`dark:bg-n-black/20` → `.dark\:bg-n-black\/20:is(.dark *){background-color:hsl(var(--n-black) / .2)}`，**60% 与 20% 两处透明度均实测到达 `--n-*`**。非空转对照：**不注入 PASSED、注入 `bg-gray-123,text-slate-456` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 1192 ＋ **14** ＝ **1206** 处；剩余 **310 处 / 70 文件**，余下最大单片 `ToolDiffViewer.tsx` / `UserMessageStickyHeader.tsx` / `MarkdownPreview.tsx` 三者并列 12。

#### 0-E3m：`ToolDiffViewer.tsx` 12 → 0（热点榜第三十五，已实施）

**范围**：`src/modules/chat/tools/ToolDiffViewer.tsx`。**12 处 / 9 个 token / 4 行**——族纯 `gray` 12；档位 `gray-50 / 100 / 200 / 500 / 600 / 700 / 800`；工具类 `text` 4 ／ `border` 4 ／ `bg` 4；变体含裸类 / `dark:`。**带透明度 4 类 / 6 处**（`border-gray-200/60` ×2、`dark:border-gray-700/50` ×2、`bg-gray-50/80` ×1、`dark:bg-gray-800/40` ×1）。属工具 diff 视图的头部条（`border-gray-200/60 dark:border-gray-700/50` ＋ `bg-gray-50/80 dark:bg-gray-800/40`）与状态/文本串。**文件不含前片遗留令牌**（`scanScaleTokenAtoms` 报 0）。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 7 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **7 / 7**，无缺失。

**手法**：与 0-E2g…0-E3l 相同（扫描器为唯一事实源，`scanner hits: 12  exempt: 0  migratable: 12  rewrites: 12`；正向重放证明下与备份逐字节一致）。**9 个 token**：`dark:border-gray-700/50` / `dark:text-gray-400` / `border-gray-200/60` 各 ×2，余 6 个（`dark:bg-gray-800` / `dark:bg-gray-800/40` / `text-gray-500` / `bg-gray-50/80` / `text-gray-600` / `bg-gray-100`）各 ×1（前缀包含对按长度降序先替长项，逐条对照确认未串味；`dark:bg-gray-800` ⊂ `dark:bg-gray-800/40` 一类的斜杠后缀尤需先长后短）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **310 → 298（−12）**，文件数 **70 → 69**；`byFile` 该文件 `12 → 0` 且从表中消失，是唯一文件级 delta；`byAtom` **8 条全为减、无一增**，合计恰 **−12**（`bg: gray-800` −2、`border: gray-200` −2、`border: gray-700` −2、`text: gray-400` −2、`bg: gray-100` −1、`bg: gray-50` −1、`text: gray-500` −1、`text: gray-600` −1），**无桶归零** |

**产物核对（通用脚本第 33 次复用，正向重放版）**：**ARTIFACT CHECK PASSED**。文件共 **12 个中性 token**（本片全部为新迁移，无遗留令牌），正向重放筛出**9 个派生字面**。**3 个字面迁后 `src=0`**（`bg-gray-50/80`、`border-gray-200/60`、`dark:bg-gray-800/40`）——本片是它们的唯一消费者，迁完即全仓零消费、Tailwind 随之不再生成（各 `dist=0`）；**3 个字面归零、其中 0 个桶归零**（`bg: gray-50`、`border: gray-200`、`bg: gray-800` 同桶另有别变体字面存活），**再次印证"桶粒度粗于字面"**。存活侧最小 `dark:border-gray-700/50` src = 1（仅本片外 1 处消费者）。值链检查：`border-n-gray-200/60` → `hsl(var(--n-gray-200) / .6)`、`dark:border-n-gray-700/50` → `.5`、`bg-n-gray-50/80` → `.8`、`dark:bg-n-gray-800/40` → `.4`，**4 类透明度 6 处均实测到达 `--n-*`**。非空转对照：**不注入 PASSED、注入 `bg-gray-123,text-slate-456` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 1206 ＋ **12** ＝ **1218** 处；剩余 **298 处 / 69 文件**，余下最大单片 `MarkdownPreview.tsx` / `UserMessageStickyHeader.tsx` 二者并列 12。

#### 0-E3n：`MarkdownPreview.tsx` 12 → 0（热点榜第三十六，已实施）

**范围**：`src/modules/code-editor/markdown/MarkdownPreview.tsx`。**12 处 / 8 个 token / 5 行**——族纯 `gray` 12；档位 `gray-50 / 200 / 300 / 400 / 600 / 700 / 800`；工具类 `border` 8 ／ `text` 2 ／ `bg` 2；变体含裸类 / `dark:`。**零透明度**。属 markdown 渲染器的 element 映射：引用块（`border-l-4 border-gray-300 … dark:border-gray-600`）、表格（`border-gray-200 dark:border-gray-700`）、表头 `thead`（`bg-gray-50 dark:bg-gray-800`）、`th` / `td`。**文件不含前片遗留令牌**（`scanScaleTokenAtoms` 报 0）。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 7 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **7 / 7**，无缺失。

**手法**：与 0-E2g…0-E3m 相同（扫描器为唯一事实源，`scanner hits: 12  exempt: 0  migratable: 12  rewrites: 12`；正向重放证明下与备份逐字节一致）。**8 个 token**：`dark:border-gray-700` / `border-gray-200` 各 ×3，余 6 个（`border-gray-300` / `text-gray-600` / `dark:border-gray-600` / `dark:text-gray-400` / `bg-gray-50` / `dark:bg-gray-800`）各 ×1（前缀包含对按长度降序先替长项，逐条对照确认未串味）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **298 → 286（−12）**，文件数 **69 → 68**；`byFile` 该文件 `12 → 0` 且从表中消失，是唯一文件级 delta；`byAtom` **8 条全为减、无一增**，合计恰 **−12**（`border: gray-200` −3、`border: gray-700` −3、`bg: gray-50` −1、`bg: gray-800` −1、`border: gray-300` −1、`border: gray-600` −1、`text: gray-400` −1、`text: gray-600` −1），**1 桶归零**（`border: gray-300` 1→0） |

**产物核对（通用脚本第 34 次复用，正向重放版）**：**ARTIFACT CHECK PASSED**。文件共 **12 个中性 token**（本片全部为新迁移，无遗留令牌），正向重放筛出**8 个派生字面**。**2 个字面迁后 `src=0`**（`border-gray-300`、`dark:border-gray-600`）——本片是它们的唯一消费者，迁完即全仓零消费、Tailwind 随之不再生成（各 `dist=0`）；**2 个字面归零、其中 1 个桶归零**（`border: gray-300`；`border: gray-600` 同桶另有别变体字面存活 2 处），**再次印证"桶粒度粗于字面"**。存活侧最小 `bg-gray-50` = 7、`dark:bg-gray-800` = 7。值链检查：**本片 0 个带透明度 token**，脚本输出 `(transparency-bearing tokens: 0)`。非空转对照：**不注入 PASSED、注入 `bg-gray-123,text-slate-456` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 1218 ＋ **12** ＝ **1230** 处；剩余 **286 处 / 68 文件**，余下最大单片 `UserMessageStickyHeader.tsx` 12。

#### 0-E3o：`UserMessageStickyHeader.tsx` 12 → 0（热点榜第三十七，已实施）

**范围**：`src/modules/chat/transcript/UserMessageStickyHeader.tsx`。**12 处 / 10 个 token / 4 行**——族 `gray` 11 ＋ `white` 1；档位 `gray-100 / 200 / 400 / 500 / 700 / 800` ＋ `white`；工具类 `text` 6 ／ `bg` 4 ／ `border` 2；变体含裸类 / `hover:` / `dark:hover:`。**带透明度 2 类 / 2 处**（`bg-white/95`、`dark:bg-gray-800/95`，均 95%）。属用户消息"吸附顶栏"提示条：外壳串（`border-gray-200 bg-white/95 … hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800/95 dark:hover:bg-gray-800`）＋ 两处图标 ＋ 一处文本。**文件不含前片遗留令牌**（`scanScaleTokenAtoms` 报 0）。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 7 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **7 / 7**，无缺失。

**手法**：与 0-E2g…0-E3n 相同（扫描器为唯一事实源，`scanner hits: 12  exempt: 0  migratable: 12  rewrites: 12`；正向重放证明下与备份逐字节一致）。**10 个 token**：`text-gray-400` / `dark:text-gray-500` 各 ×2，余 8 个（`border-gray-200` / `bg-white/95` / `hover:bg-gray-100` / `dark:border-gray-700` / `dark:bg-gray-800/95` / `dark:hover:bg-gray-800` / `text-gray-700` / `dark:text-gray-200`）各 ×1（前缀包含对按长度降序先替长项，逐条对照确认未串味；`dark:bg-gray-800/95` 与 `dark:hover:bg-gray-800` 分属不同变体链，未串味）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **286 → 274（−12）**，文件数 **68 → 67**；`byFile` 该文件 `12 → 0` 且从表中消失，是唯一文件级 delta；`byAtom` **9 条全为减、无一增**，合计恰 **−12**（`bg: gray-800` −2、`text: gray-400` −2、`text: gray-500` −2、`bg: gray-100` −1、`bg: white` −1、`border: gray-200` −1、`border: gray-700` −1、`text: gray-200` −1、`text: gray-700` −1），**无桶归零** |

**产物核对（通用脚本第 35 次复用，正向重放版）**：**ARTIFACT CHECK PASSED**。文件共 **12 个中性 token**（本片全部为新迁移，无遗留令牌），正向重放筛出**10 个派生字面**。**2 个字面迁后 `src=0`**（`bg-white/95`、`dark:bg-gray-800/95`）——本片是它们的唯一消费者，迁完即全仓零消费、Tailwind 随之不再生成（各 `dist=0`）；**2 个字面归零、其中 0 个桶归零**（`bg: white`、`bg: gray-800` 同桶另有别变体字面存活），**再次印证"桶粒度粗于字面"**。存活侧最小 `dark:hover:bg-gray-800` src = 1、`dark:text-gray-200` src = 1。值链检查：`bg-n-white/95` → `.bg-n-white\/95{background-color:hsl(var(--n-white) / .95)}`、`dark:bg-n-gray-800/95` → `.dark\:bg-n-gray-800\/95:is(.dark *){background-color:hsl(var(--n-gray-800) / .95)}`，**两处 95% 透明度均实测到达 `--n-*`**。非空转对照：**不注入 PASSED、注入 `bg-gray-123,text-slate-456` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 1230 ＋ **12** ＝ **1242** 处；剩余 **274 处 / 67 文件**，余下最大单片 `TerminalShortcutsPanel.tsx` / `TextContent.tsx` / `BrowserUsePanel.tsx` 三者并列 11。

#### 0-E3p：`TerminalShortcutsPanel.tsx` 11 → 0（热点榜第三十八，已实施）

**范围**：`src/modules/shell/TerminalShortcutsPanel.tsx`。**11 处 / 7 个 token / 4 行**——族 `gray` 8 ＋ `white` 3；档位 `gray-100 / 600 / 700 / 900` ＋ `white`；工具类 `text` 5 ／ `bg` 3 ／ `border` 3；变体含裸类 / `active:`。**带透明度 2 类 / 2 处**（`border-gray-700/80` 80%、`bg-gray-900/95` 95%）。属终端快捷键面板的按钮样式串（两行复用风格串 ＋ 一行蓝底主按钮 ＋ 一行外壳）。**同一 className 串内语义彩色 `blue-500` / `blue-600` 未触碰**。**文件不含前片遗留令牌**（`scanScaleTokenAtoms` 报 0）。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 5 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **5 / 5**，无缺失。

**手法**：与 0-E2g…0-E3o 相同（扫描器为唯一事实源，`scanner hits: 11  exempt: 0  migratable: 11  rewrites: 11`；正向重放证明下与备份逐字节一致）。**7 个 token**：`active:text-white` / `border-gray-600` / `bg-gray-700` / `text-gray-100` 各 ×2，余 3 个（`text-white` / `border-gray-700/80` / `bg-gray-900/95`）各 ×1（前缀包含对 `text-white` ⊂ `active:text-white` 按长度降序先替长项，逐条对照确认未串味）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **274 → 263（−11）**，文件数 **67 → 66**；`byFile` 该文件 `11 → 0` 且从表中消失，是唯一文件级 delta；`byAtom` **6 条全为减、无一增**，合计恰 **−11**（`text: white` −3、`bg: gray-700` −2、`border: gray-600` −2、`text: gray-100` −2、`bg: gray-900` −1、`border: gray-700` −1），**1 桶归零**（`border: gray-600` 2→0） |

**产物核对（通用脚本第 36 次复用，正向重放版）**：**ARTIFACT CHECK PASSED**。文件共 **11 个中性 token**（本片全部为新迁移，无遗留令牌），正向重放筛出**7 个派生字面**。**3 个字面迁后 `src=0`**（`active:text-white`、`bg-gray-900/95`、`border-gray-600`）——本片是它们的唯一消费者，迁完即全仓零消费、Tailwind 随之不再生成（各 `dist=0`）；**3 个字面归零、其中 1 个桶归零**（`border: gray-600`；`text: white` / `bg: gray-900` 同桶另有别变体字面存活），**再次印证"桶粒度粗于字面"**。存活侧最小 `bg-gray-700` src = 1、`border-gray-700/80` src = 1。值链检查：`border-n-gray-700/80` → `.border-n-gray-700\/80{border-color:hsl(var(--n-gray-700) / .8)}`、`bg-n-gray-900/95` → `.bg-n-gray-900\/95{background-color:hsl(var(--n-gray-900) / .95)}`，**80% 与 95% 两处透明度均实测到达 `--n-*`**。非空转对照：**不注入 PASSED、注入 `bg-gray-123,text-slate-456` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 1242 ＋ **11** ＝ **1253** 处；剩余 **263 处 / 66 文件**，余下最大单片 `TextContent.tsx` / `BrowserUsePanel.tsx` 二者并列 11。

#### 0-E3q：`TextContent.tsx` 11 → 0（热点榜第三十九，已实施）

**范围**：`src/modules/chat/tools/ContentRenderers/TextContent.tsx`。**11 处 / 9 个 token / 3 行**——族纯 `gray` 11；档位 `gray-50 / 100 / 200 / 300 / 700 / 800 / 900 / 950`；工具类 `text` 5 ／ `bg` 4 ／ `border` 2；变体含裸类 / `dark:`（4 个）。**带透明度 3 类 / 3 处，均为 50%**（`border-gray-200/50`、`dark:border-gray-700/50`、`dark:bg-gray-800/50`）。属工具输出内容的文本/代码块渲染器——两行 `<pre>` 代码块串（一行深色底、一行浅色底）＋ 一行纯文本 `<div>`。**文件不含前片遗留令牌**（`scanScaleTokenAtoms` 报 0）。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 8 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **8 / 8**，无缺失。

**手法**：与 0-E2g…0-E3p 相同（扫描器为唯一事实源，`scanner hits: 11  exempt: 0  migratable: 11  rewrites: 11`；正向重放证明下与备份逐字节一致）。**9 个 token**：`text-gray-700` / `dark:text-gray-300` 各 ×2，余 7 个各 ×1（`dark:border-gray-700/50` / `dark:bg-gray-800/50` / `border-gray-200/50` / `dark:bg-gray-950` / `text-gray-100` / `bg-gray-900` / `bg-gray-50`；token 间存在前缀包含对，按长度降序替换后逐条对照确认未串味）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **263 → 252（−11）**，文件数 **66 → 65**；`byFile` 该文件 `11 → 0` 且从表中消失，是唯一文件级 delta；`byAtom` **9 条全为减、无一增**，合计恰 **−11**（`text: gray-700` −2、`text: gray-300` −2、`bg: gray-50` −1、`bg: gray-800` −1、`bg: gray-900` −1、`bg: gray-950` −1、`border: gray-200` −1、`border: gray-700` −1、`text: gray-100` −1），**0 桶归零** |

**产物核对（通用脚本第 37 次复用，正向重放版）**：**ARTIFACT CHECK PASSED**。文件共 **11 个中性 token**（本片全部为新迁移，无遗留令牌），正向重放筛出**9 个派生字面**。**4 个字面迁后 `src=0`**（`dark:bg-gray-950`、`dark:border-gray-700/50`、`dark:bg-gray-800/50`、`border-gray-200/50`）——本片是它们的唯一消费者，迁完即全仓零消费、Tailwind 随之不再生成（各 `dist=0`）；**4 字面归零而 0 桶归零**（`gray-950` 桶 4→3、其余桶均另有别变体字面存活），**再次印证"桶粒度粗于字面"**。存活侧最小 `bg-gray-900` src = 4、`text-gray-700` src = 3。值链检查：`border-n-gray-200/50` → `.border-n-gray-200\/50{border-color:hsl(var(--n-gray-200) / .5)}`、`dark:border-n-gray-700/50` → `.dark\:border-n-gray-700\/50:is(.dark *){border-color:hsl(var(--n-gray-700) / .5)}`、`dark:bg-n-gray-800/50` → `.dark\:bg-n-gray-800\/50:is(.dark *){background-color:hsl(var(--n-gray-800) / .5)}`，**三处 50% 透明度均实测到达 `--n-*`**。非空转对照：**不注入 PASSED、注入 `bg-gray-123,text-slate-456` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 1253 ＋ **11** ＝ **1264** 处；剩余 **252 处 / 65 文件**，余下最大单片 `BrowserUsePanel.tsx` 11。

### 阶段 1：主题扩展点

引入 `data-theme` + `ThemeManifest` + 内置主题注册表，内置 3–4 套主题（默认明 / 暗 + 2 套示范）。外观设置页加入主题选择器，并按 `coverage` 显示覆盖范围 badge。

**验收**：切换主题后主 UI、终端、编辑器、语法高亮、Git 图**同时**变化；`appearance: system` 主题跟随系统；首帧无闪烁；`theme-color` 与 iOS status-bar 随 `appearance` 同步更新；§5.11 契约测试与 §5.10 对比度断言通过。

**可选随附功能**：设置页内的"令牌预览页"——读 `getComputedStyle(document.documentElement)` 过滤出 `--` 变量、按命名空间分组渲染当前值与明暗对比色块。对主题作者是调试工具、对用户是透明度，实现成本不高，不进核心验收路径。

### 阶段 2：用户主题

服务端提供主题目录列举与静态文件（复用 `plugins.routes.ts` 的 `/:name/assets/*` 模式）；前端加载链路含"缓存同步注入 / 后台校验更新 / 加载中 / 失败回落"；设置页支持选择与（可选）粘贴内容。若采纳选项 A，需实现令牌白名单校验；若支持 B2，需实现 `.tmTheme` 解析。

**验收**：往 `~/.cloudcli/themes/` 放一个文件，刷新后主题出现在选择器中并可生效（改文件后刷新能看到变化，即 `?v=` 生效）；非法文件被拒绝且不影响启动；删除文件后回落默认；**"合法但有害"的 CSS 可用 §5.6 的恢复通道退出**；跨设备同步到未安装主题的设备时给出显式提示而非静默回落。

---

## 7. 风险与取舍

| 风险 | 说明 | 缓解 |
|---|---|---|
| 阶段 0 触及终端/编辑器 | 这两处逻辑较深（xterm 实例生命周期、CodeMirror 扩展） | 阶段 0 只做"取值来源替换"，不改行为；对 xterm/CodeMirror 补测试 |
| 令牌契约面覆盖不全 | 主题作者可能发现某个角落不受令牌控制 | §5.7 两条 grep + §5.11 契约测试共同界定可信边界；对未令牌化处以注释声明豁免；数量类令牌（Git lane 等）用参数化回退（§5.12） |
| `data-theme` 与 `dark:` 原子类叠加 | 两套机制并存可能产生优先级困惑 | ① 主题覆盖层严禁放进 `@layer`（§5.2），稳定压过 `@layer base`；② 选项 A 强制 `data-theme` 只写变量不写选择器；③ `dark:` 前缀按 §5.7 策略 ① 消除，或按策略 ② 在主题契约中声明 |
| **具名色原子类规模（约 3227 处）远超初稿预估** | 阶段 0 若全量收口，工作量与回归面都很大 | 按文件集群分片（105 文件）、热点单独成片、每片 DoD 三件套、机器可校验豁免清单；定量终点 = 收敛到豁免清单（§6 阶段 0） |
| **死令牌（定义了但无消费者）** | `--status-*` / `--palette-*` 若先定义再换消费者，期间主题作者覆盖无效 | L1 必须与 L2 引用改写同片（§5.1）；`--status-*` 与状态色替换捆绑、阶段 0 不引入（附录 A）；§5.11 契约测试断言令牌"有取值"且"被引用" |
| **阶段 0"视觉零变化"不可验证** | 人工回归漏判（alpha 偏移、1px 差异） | 引入视觉回归基线（Playwright 截图比对，阈值 0），见 §6 阶段 0 验收 |
| **用户主题"合法但有害"** | 选项 B 可写 `body{display:none}` 等，用户失去恢复入口 | 强制恢复通道（快捷键 / 启动参数 / 查询参数）+ 自愈哨兵（§5.6）；选项 A 天然免疫 |
| **a11y 退化** | 主题可写出低对比度 / 焦点不可见 / 仅靠颜色传达状态 | §5.10 硬性条款 + §5.11 契约测试断言 |
| 用户主题权限 | 选项 B 可写任意 CSS | 默认 A，B 需显式开启并提示信任来源 |
| 主题数量膨胀导致选择器难用 | — | 内置主题保持少而精；用户主题分区展示 |

---

## 8. 待评审确认的问题（v3：全部已决）

> v2 收敛了 1/3/4/5/6；v3（2026-09-25，三方补充拍板后）2/7/8/9 也已决。**当前无遗留待定项。**

1. **用户主题格式**：→ **已决**：三格式并行（A 令牌 JSON 默认 / B 原始 CSS 高级 / B2 `.tmTheme` 生态），见 §5.5。默认维持 A，理由见该节 v2 说明。
2. **用户主题存放位置**：→ **已决**：采用 `~/.cloudcli/themes/`，Docker 仅文档标注、不做代码适配。**实施约束**：路径解析必须复用 server 现有的 `path.join(os.homedir(), '.cloudcli', …)` 模式，新增一个与 assets 平行的目录常量，严禁主题模块另写第二套拼接。依据：`docker/` 下仅 `claude-code` / `codex` 构建环境 + `shared` + README，无应用 Dockerfile、无 compose，Docker 非分发形态；而 `~/.cloudcli` 已是既有持久化约定（`server/shared/image-attachments.ts:22`、`server/load-env.ts:43`、`server/index.ts:323`）。若 README 补 Docker 说明，须同时覆盖 themes 与 assets 两个挂载点。
3. **阶段 0 的终端配色**：→ **已决**：**终端默认保持恒深色**（把 `--term-*` 的 light 值就设为现用深色板），浅色终端作为主题覆盖能力实现，不内置翻转。
4. **第二层选择器**：→ **已决**：把"默认明 / 默认暗"建模为两套内置主题，保留 light/dark/system 三选一胶囊，使"主题"与"明暗"正交，避免双层选择器的心智负担。
5. **品牌色边界**：→ **已决**：agent 品牌色与各 harness Logo 保留硬编码，走 §8.7 的机器可校验豁免清单声明。
6. **远程主题源扩展点**：→ **已决**：只留扩展点（`ThemeManifest.source` 已是可扩展字符串枚举，未来加 `'remote'` 值成本近零），不实现。
7. **阶段 0 拆分口径**：→ **已决**：**按模块分片（文件集群为粒度）+ 机器可校验豁免清单，每片独立合入 / 验收 / 回滚，严禁一次性大 PR**。详见 §6 阶段 0。
8. **`dark:` 前缀处置**：→ **已决**：**不做"全消除 vs 暗底保证"的二选一**——该二分是伪命题（`dark:bg-gray-800` 生成 `.dark\:bg-gray-800:is(.dark *)`，特异性 ≥ (0,2,0) 且直接写死色值，`[data-theme="x"]` 的 (0,1,0) 压不过；因此**凡主题应控制的色，只能换成语义令牌类；主题不应控制的色（状态 / 品牌 / 图标）保留 `dark:` 并豁免**）。落地方案是**三分法**，详见 §5.7。
9. **`--cc-syntax-N` 语义化命名**：→ **已决**：**本轮不升语义名**，本轮只做三件事挡风险（导出 `SYNTAX_TOKEN_MAP` 常量 + 黄金映射 snapshot 测试 + denylist grep 护栏），语义名草案定方向、阶段 2 与编辑器令牌化一并实施。详见 §5.9。

---

## 附录 A：令牌清单（草案）

**L1 palette（阶段 0-A / 0-C / 0-E1 已实施，命名以此为准）**

| 色族 | 令牌 | 用途 |
|---|---|---|
| 中性极值 | `--palette-white` `--palette-black` | 卡片/浮层底、阴影基色 |
| 暖沙 `sand` | `--palette-sand-50/-100/-200/-500/-800/-950` | 浅色界面基底（档位越高越深） |
| 冰白 `frost` | `--palette-frost-50` | 强调色填充上的前景 |
| 中性墨 `ink` | `--palette-ink-100/-400/-800/-850/-900/-950` | 深色界面基底 |
| 品牌 `brand` | `--palette-brand-400/-500` | 主色（light 取 500，dark 取 400） |
| 危险 `danger` | `--palette-danger-500/-800` | 破坏性操作（light 取 500，dark 取 800） |
| 终端 `term` | `--palette-term-bg/-fg/-cursor/-selection` + `--palette-term-{black..white}` + `--palette-term-bright-{black..white}` | 0-C 新增。终端板（VSCode Dark+）自成一族，因为它的 hue 与界面族不同；**只在 `:root` 声明**，明暗共用（§8.3 已决） |
| 兼容档位族 `gray` / `zinc` / `slate` / `neutral` | 每族 `--palette-<族>-50/-100/-200/…/-900/-950`（各 11 档） | `gray` 于 0-E1 新增、其余三族于 0-E1b 新增。**Tailwind 默认中性档位的原值**（逐档 1 位小数三元组，四族 44 档往返**全部无损**），为的是把 ~1.5k 处 `bg-gray-100 dark:bg-gray-700` 类字面档位换成令牌引用而**不动像素**（§5.7 v4 / §6 之 0-E 记录）。它**不是策展色族**（与 `sand` / `ink` 无关），是**过渡层**：阶段 2 把消费者改成语义名后本族退场。**只在 `:root` 声明**（档位值与外观无关）。四族并列而不归并的理由见 0-E1b 记录（归并等于 122 处改色 + 给等值护栏开例外）；`stone` 不建（0 处消费者） |

**格式 = HSL 三元组，与 L2 同格式**（`44 22% 96%`，非 hex）。这是实施时定下的关键选择：Tailwind 用 `hsl(var(--border))` 消费令牌，只要 L1 与 L2 同为三元组，`--background: var(--palette-sand-50)` 就等价于原字面值——**Tailwind 配置与 `index.css` 中 16 处 `hsl(var(--x))` 全部无需改动**。若 L1 用 hex，才需要按 §5.1 的说明调整消费方式。带 alpha 的导航令牌写成 `var(--palette-x) / 0.7`（var 嵌套合法，解析结果与原字面值一致）。

**L2 semantic（现有，保持）**

`--background` `--foreground` `--card` `--card-foreground` `--popover` `--popover-foreground` `--primary` `--primary-foreground` `--secondary` `--secondary-foreground` `--muted` `--muted-foreground` `--accent` `--accent-foreground` `--destructive` `--destructive-foreground` `--border` `--input` `--ring` `--radius`

导航：`--nav-glass-bg` `--nav-glass-blur` `--nav-glass-saturate` `--nav-tab-glow` `--nav-tab-ring` `--nav-float-shadow` `--nav-float-ring` `--nav-divider-color` `--nav-input-bg` `--nav-input-focus-ring`

语法：`--cc-syntax-0..N`（由 Prism 主题编译产生）

**L2 semantic（新增，阶段 0 引入）**

终端（0-C 已落地，L1 对应 `--palette-term-*`，20 个）：`--term-background` `--term-foreground` `--term-cursor` `--term-cursor-accent` `--term-selection-bg` `--term-selection-fg` `--term-ansi-{black,red,green,yellow,blue,magenta,cyan,white}` `--term-ansi-bright-{black,red,green,yellow,blue,magenta,cyan,white}`

终端语义别名（v2 新增，0-C 已落地）：`--term-error` `--term-success` `--term-warning` `--term-info`。ANSI 色在 CLI 生态里是**语义色而非装饰色**——`git diff`、`ls`、`grep`、`npm` 都靠红=错误 / 删除、绿=成功 / 新增、黄=警告、蓝=信息来传达状态。主题作者若把"红"改蓝，diff 增删将无法区分。开发文档须写明"改 hue 可以，但保持语义对应关系"。（实现注：别名目前无 UI 消费者，属**给主题作者的契约命名**，由 `tests/theme-tokens` 断言其与 `--term-ansi-*` 的映射关系。）

终端 `extendedAnsi`（v2 处置，0-C 已执行废弃）：`useShellTerminal.ts` 原先硬编码的 16 个 `extendedAnsi` 值**已删除**，不再由 `--term-ansi-bright-*` 推导——那 16 个槽位是 256 色 6×6×6 立方体的**前 16 项**（`ansi[16..31]`），覆盖它们会破坏立方体而非定义第二套 ANSI 梯度。删除后这些槽位交回 xterm 的标准立方体。**这是本片唯一有意的渲染变更**，详见 §6 阶段 0 之 0-C 记录。

编辑器：`--editor-background` `--editor-gutter-bg` `--editor-toolbar-bg` `--editor-toolbar-border` `--editor-toolbar-fg` `--editor-diff-add` `--editor-diff-add-strong` `--editor-diff-del` `--editor-diff-del-strong`

兼容档位（0-E1 已落地，13 个）：`--n-gray-50..950` + `--n-white` + `--n-black`，全部 `var(--palette-*)`。这是 **A1 保值层**——**唯一一类不承载语义、只承载"原 Tailwind 档位"的令牌**（见 §5.7 v4）。Tailwind 侧以 `n-gray` / `n-white` / `n-black` 三个键注册，类名为 `bg-n-gray-100`。**阶段 2 语义化改名后整层删除**。两个极值直接复用既有 `--palette-white` / `--palette-black`，不另造同值令牌（避免死令牌）。

图表：`--graph-lane-1..10` + 参数化回退 `--graph-lane-base-hue` `--graph-lane-hue-step`（§5.12）

状态色（v2 新增，**v3 标注引入时机**）：`--status-success` `--status-warning` `--status-error` `--status-info`——**阶段 0 不引入**。其定义必须与"状态色 `dark:` 类的替换"捆绑为同一个后续片：替换完成前定义它只会产出**无消费者的死令牌**（保留 `dark:` 的组件不读令牌，覆盖 `--status-error` 无任何效果），正是 DSH 在 L1 上指出的同一类覆辙。替换完成前，主题开发文档须写明"状态色暂不受主题控制"。

---

## 附录 B：解包取证索引

**WorkBuddy**（`/Applications/WorkBuddy.app/Contents/Resources/app.asar`，298MB；asar header 位于偏移 16，数据区 = 16 + headerSize）

| 内容 | 位置 |
|---|---|
| 特性开关 `EnableAppearance` | `main/common.js:1722-1726` |
| 资源模型 / 校验 / DTO 映射 | `main/daemon-bootstrap.js:773-1010` |
| zip 下载 / 解压 / URL 重写 / 缓存 | `main/daemon-bootstrap.js:1010-1260`（`skin.css`、`local-file://`、`ALLOWED_ASSET_EXTS`、20MB/500 条上限） |
| 令牌定义（palette + semantic，light/dark） | `renderer/assets/safe-delete-events-Cb4BnJzK.css:1690-2250` |
| dark 选择器集合 | `renderer/assets/esm-pzWMy03t.css`、`automation-panel-TLOWWMiC.css`（`data-theme="dark"` / `.vscode-dark` / `.cb-dark`） |
| 运行时宿主 / skin manager | `renderer/assets/*`（`appearance-runtime-host.tsx`、`applyCachedCssSync`、catalog 重试退避） |
| 真实皮肤包 | `~/.workbuddy/appearance-resources/theme-tkhlwz-*/skin.css`、`theme-tkmw7j-*/skin.css` |

**Codex CLI**（`@openai/codex@0.155.1`；二进制 `…/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex`，229MB）

| 内容 | 证据 |
|---|---|
| 主题目录 | 字符串 `$CODEX_HOME/themes/` |
| 主题格式 | `.tmTheme`（Sublime/TextMate），依赖 `syntect-5.3.0` + `two-face-0.5.1` |
| 主题模块 | `tui/src/theme/mod.rs` |
| 失败回落文案 | `Theme "X" not found. Using the default theme.` / `invalid .tmTheme format` / `not recognized; using default theme` |
| 内置主题名 | Catppuccin（4 变体）、Dracula、Monokai Extended（4 变体）、Nord、Solarized（dark/light）、base16-ocean/eighties/mocha、gruvbox、OneHalf、TwoDark、Sublime Snazzy、InspiredGitHub、1337、Zenburn 等 |

---

## 审阅批注

### Claude

> [!CAUTION]
> 严重风险：换肤契约面被系统性低估——Tailwind 具名色原子类是 §1.3 / §5.7 / 阶段 0 审计与验收的盲区，数量约为 66 处 `rgb()/rgba()` 的 50 倍。实测 `src/**/*.tsx|ts` 中 `bg-slate-800`、`text-zinc-400`、`prose-pre:bg-gray-900` 这类具名色原子类共 **3240 处**（中性色系 1504 处、彩色系 1731 处、其中带 `dark:` 前缀 1127 处；集中分布：`fileIcons.ts` 160、`AskUserQuestionPanel.tsx` 137、`PermissionsContent.tsx` 122、`TaskDetailModal.tsx` 98 等）。这些类不经过任何令牌：无 `dark:` 的在任何主题下都固定不变；有 `dark:` 的只随明暗翻转、不随主题变化。而 §5.7 与阶段 0 的 grep 验收只匹配字面色值（`#hex`、`rgb()/hsl()`），**一行都匹配不到它们**。后果：按当前清单完成阶段 0 后切主题，任务面板、权限页、问答面板等大面积 UI 停留在原配色——"主题生效一半"的破碎观感恰是 §1.2 批评现状的问题原样复现，"新增主题=加一个文件"的承诺对这部分 UI 不成立。建议：(a) 验收命令增加具名色匹配（如 `grep -rnoE '(bg|text|border|ring|stroke|fill|from|to|via|decoration|placeholder|prose-[a-z:-]*)-(slate|gray|zinc|neutral|stone|black|white)(-[0-9]{2,3})?(/[0-9]{1,3})?' src --include='*.tsx'`）；(b) 按语义二分处置——状态色、文件类型图标色（`fileIcons.ts`）、品牌色可显式豁免并注释理由，中性色系的背景/文字/边框应纳入阶段 0 收口清单或逐处标注例外；(c) 据此重估阶段 0 工作量与 §1.3"绝大部分 UI 自动跟随"的表述。文档点名的文件自身就是实例：`CodeEditorSurface.tsx:62-63` 的 `bg-white dark:bg-gray-900`、`prose-pre:bg-gray-900` 目前不在 §5.7 该文件条目的收口范围内。

> [!WARNING]
> 潜在风险：§5.7"CodeMirror 用 `EditorView.theme()` 基于令牌自建明暗两套，替换第三方 oneDark"只覆盖了一半问题。`@codemirror/theme-one-dark` 的 oneDark 同时提供 UI 主题与语法高亮两部分；`EditorView.theme()` 只生成背景/光标/选区/行号等 UI 面 CSS，代码 token 颜色（keyword/string/comment…）必须另用 `HighlightStyle.define()` 定义。照当前表述实施，替换后会出现"新背景 + oneDark 残留或缺失的语法色"（现状 `CodeEditorSurface.tsx:76` light 分支传 `undefined` 依赖默认浅色，也说明语法色从未被显式管理）。建议 §5.7 该行明确两个 API 都要建，且编辑器语法色与 chat 侧 Prism 路径共用同一套语义令牌，避免出现第二套平行命名。

> [!WARNING]
> 潜在风险：`--cc-syntax-N` 目前不是稳定契约，§5.9 将其提升为"全局唯一语法高亮路径"前必须先解决命名稳定性。实现在 `src/shared/syntaxTheme.ts:33-75`：编号由"遍历 selector×property 时遇到差异的先后顺序"决定，`--cc-syntax-3` 的含义完全取决于两个源 Prism 主题的内容——源主题增删任一差异属性，其后编号整体重排。用户主题作者无从针对"关键字色"写覆盖，写了也会随编译漂移失效。建议：升级为契约面前把编号改为从 selector+property 推导的语义名（如 `--cc-syntax-keyword-color`），或至少固化映射表并导出常量，供选项 A 的令牌白名单校验与主题作者文档使用。

> [!WARNING]
> 潜在风险：§5.6 对用户主题的"首帧防闪烁"实际无解。用户主题走运行期 `<link rel="stylesheet">`，首帧必然先按 base 渲染、CSS 到达后再闪变，与"保持 ThemeContext 同步首帧性质"的要求自相矛盾。附录 B 已取证 WorkBuddy 的 `applyCachedCssSync`（缓存上次皮肤 CSS、启动时同步注入）正是解此问题的机制，但正文未借鉴。建议 §5.6 补充：首次加载成功后将用户主题内容（或编译后的令牌 JSON）缓存至 localStorage，下次启动同步注入 `<style>`，后台再校验目录中的更新，校验失败回落默认并告警。

> [!TIP]
> 建议：xterm 是 JS 对象消费者，§5.7"抽 --term-*，xterm theme 从 CSS 变量读取"需展开为实现契约——CSS 变量变化不触发任何事件，且 xterm 的 ITheme 不支持 `var()`，主题切换后必须主动 `getComputedStyle` 重读 `--term-*` 并重设 `terminal.options.theme`。建议把该刷新机制写进 §5.6 生效链路，与 CodeMirror 扩展刷新并列说明。Git 图无此问题：`CommitGraphStrip.tsx` 是 SVG，`stroke` 可直接写 `var(--graph-lane-N)`，令牌化可行、无需刷新。

> [!TIP]
> 建议：显式利用 `@layer base` 的现成优先级保障。现状 `:root`/`.dark` 全部位于 `@layer base` 内（`index.css:45-141`），layered 样式天然低于任何 unlayered 样式——主题覆盖层只要写成普通 CSS（**严禁放进任何 @layer**），`[data-theme="x"]` 就稳定压过 base，完全不依赖 CSS 文件加载顺序，并顺带消解 §7 中"data-theme 与 dark: 原子类叠加优先级困惑"的一半。建议在 §5.2 把这一约束写明，它是双轨方案成立的关键前提而非可选优化。

> [!TIP]
> 建议：`mobileTerminalSelection.ts` 属于本项目移动端高发区，收口需专项回归。实测该文件 179-228 行共 **8 处**硬编码（179/180/181/197/198/200/228），多于 §1.2 #7 记录的 4 处；它是移动端长按选择菜单的运行时注入样式，改令牌后需在 iOS Safari 实机/模拟器验证长按菜单、选区手柄与滚动行为。

> [!TIP]
> 建议：跨设备同步 themeId 的边界场景应进阶段 2 验收：偏好镜像会把 themeId 同步到未安装该主题文件的设备，届时应显式提示"此设备缺少该主题，已回落默认"而非静默回落。另外注意现状怪癖：`setTheme('system')` 不写偏好（`ThemeContext.tsx:116-120`，仅 light/dark 才 `writeUserPreference`），新增 themeId 键时需决定 system 分支是否同样豁免，避免把本机临时态覆盖成跨设备永久态。

> [!NOTE]
> 补充说明：若干引用细节修正（均不改变结论）：① `editorStyles.ts` 的色值三元实为 13 处（§1.2 #4 记 7 处）；② §5.7 Git 图条目应补 `CommitHistoryItem.tsx:72` 的 `#0ea5e9` fallback 硬编码；③ Markdown.tsx 实际路径为 `src/modules/chat/transcript/Markdown.tsx`；④ 现有令牌值格式不止 HSL 三元组，还有 `44 22% 96% / 0.7`（HSL+alpha，`--nav-*`）与 `calc()/env()`（尺寸类），选项 A 的校验器需按令牌白名单逐一定制值格式规则，不能按单一格式校验。语法高亮已有测试护栏（`syntaxHighlightTheme.test.ts`、`markdownSyntaxThemeInjection.test.tsx`），是阶段 0 的现成验收资产，建议保留并扩展。

> [!NOTE]
> 补充说明：对 §8 待确认问题的审阅意见——§8.3：建议终端默认保持恒深色（把 `--term-*` 的 light 值就设为现用深色板），浅色终端作为主题覆盖能力实现，不内置翻转；§8.4：建议把"默认明/默认暗"建模为两套内置主题并保留三选一胶囊，使"主题"与"明暗"正交，避免双层选择器的 UI 心智负担；§8.5：同意品牌色与 Logo 保留硬编码，建议在 `index.css` 顶部集中注释声明豁免清单；§8.6：同意只留扩展点——`ThemeManifest.source` 当前已是可扩展字符串枚举，未来加 `'remote'` 值即可，成本近零。

### DSH · `3579500d-…`

> [!WARNING]
> 潜在风险：**§3 的"生态复用"卖点与 §5 的交付格式脱节**。§3.3 表格把"直接吃现成主题库（.tmTheme）"列为 Codex 式模型的核心理由，但 §5.5 推荐的两个用户主题格式——令牌 JSON（A）与原始 CSS（B）——**都不是 .tmTheme**：用户拿到 Dracula / Nord / Catppuccin 官方 `.tmTheme` 文件时，A/B 均无法直接使用，"文件放进目录即生效"的承诺对生态内现成主题不成立。建议：(a) 把 `.tmTheme` 作为选项 B 的官方变体（B2）写入 §5.5——tmTheme 是 plist 结构的 XML，可服务端预编译为 §5.5 的令牌 JSON 或直接经轻量解析转 CSS 变量，解析成本可控，且与本方案"把第三方主题编译成变量"的既有思路（`syntaxHighlightTheme.ts`）同构；(b) 若不做 B2，则 §3.3 该行应降级表述为"内置主题由编译产生、用户主题吃自家格式"，避免方案自相矛盾。

> [!WARNING]
> 潜在风险：**用户主题"加载成功但破坏 UI"没有任何恢复路径**。§5.6 与 §5.8 只覆盖"加载失败 → 回落默认 + 告警"，但选项 B 的原始 CSS 完全可能成功加载却把界面搞坏——`body{display:none}`、设置面板文字 `font-size:0`、`visibility:hidden` 之类，此时用户连切回默认主题的入口都看不到（Codex/WorkBuddy 的回落只针对"文件缺失 / 格式非法"，不针对"内容有害"）。建议增加强制恢复通道：内置快捷键 / 启动参数 / `?theme=default` 查询参数三者任一即可；或启动自愈哨兵——注入主题 CSS 后若 300ms 内 `<html>` 上未出现主题预设的哨兵类则判定异常、自动回落。顺带说明：选项 A（令牌 JSON）因只能写白名单令牌而天然免疫此问题，这一点应作为 A 的卖点在设置页"高级模式"开关处明示。

> [!NOTE]
> 补充说明：**L1 palette 层目前没有任何消费者，"覆盖 L1 即可换肤"（§5.1 关键性质）在现状下不成立**。附录 A 新增 `--palette-*`，但现有 L2 全是直接写的终值（`--background: 44 22% 96%`），L1 定义后无人引用——覆盖 `--palette-brand-8` 不会改变任何 UI，除非把 L2 定义改为引用 L1（HSL 通道拆分，如 `--primary: 175 84% var(--palette-brand-light-4)`）。这实质上是比"补一层"大得多的重构，且 §4 非目标明确"不改变现有令牌的语义命名"，两者需要对齐。建议二选一明确写入方案：要么定义 L1→L2 的引用规则并评估其对 44 个现有令牌的重写量；要么把 L1 定位为"可选约定层"，并澄清"主题只需覆盖 L1 或 L2"实际只有 L2 生效、L1 仅供内置主题内部组织用。

> [!TIP]
> 建议：**显式设置 `color-scheme`，原生控件随主题自动跟随，§1.2 #8 的 66 处补偿可能大幅缩减**。文档只在 §5.7 说"评估暗色补偿是否仍必要"，但没给机制——`color-scheme: dark|light`（随 `appearance` 设置在 `<html>` 上）会让浏览器原生滚动条、checkbox/radio、`<input>`、`<textarea>` 及 `::placeholder` 的默认渲染自动跟随，`index.css:382-592` 的滚动条/表单件/placeholder 暗色补偿很可能因此成批可删（现状这些补偿正是手写模拟 `color-scheme` 的行为）。建议在阶段 0 收口时把"先加 `color-scheme`、再重审 66 处是否保留"作为执行顺序写进 §5.7，避免先令牌化一堆本可删除的补偿。

> [!TIP]
> 建议：**用户主题 URL 需带版本参数，且服务端可复用 plugins 模块的静态资源路由模式**。`<link href="/api/themes/<id>.css">` 若无 `?v=` 参数，浏览器（尤其本地 HTTP 服务 + 可能的缓存层）会缓存旧文件，用户改了 `~/.cloudcli/themes/` 里的文件、刷新后却看不到变化——与阶段 2 验收"刷新后主题出现在选择器中并可生效"冲突。建议服务端目录枚举时返回每文件 mtime（或内容 hash），前端拼 `?v=<mtime>` 实现缓存失效。另外本仓库 `server/modules/plugins/plugins.routes.ts:26` 已有 `/:name/assets/*` + `resolveAsset`（路径安全 + 扩展名约束）的现成静态提供模式，阶段 2 的 `/api/themes/` 直接复用该模式即可，不必新写一套目录遍历与校验逻辑。

> [!NOTE]
> 补充说明：**主题 id 的 sanitize 规则需要补两类约束**。① 保留名冲突：用户文件 sanitize 出的 id 可能与内置 id（如 `cc-ocean`）相同，按 §5.4 优先级会静默遮蔽内置主题——建议内置 id 固定 `cc-` 前缀、用户主题强制 `user-` 前缀（或枚举时去重并告警）；② `data-theme` 值会被写进属性选择器 `[data-theme="…"]`，sanitize 若只允许 `[a-zA-Z0-9._-]`（§5.8）尚安全，但若未来放宽需排除 `]`、引号、空格等会破坏选择器语法或造成注入的字符。另：`useShellTerminal.ts:36-75` 的 xterm theme 实际含 **16 个 `extendedAnsi` 值**（共 38 处 hex），附录 A 的 `--term-ansi-*` / `--term-ansi-bright-*`（16 值）未覆盖它——需决定 extendedAnsi 是收口为令牌还是明确废弃（由 bright 推导），否则 §5.7 该条目会漏掉半块 ANSI 板。

> [!NOTE]
> 补充说明：**§4 目标 2 与目标 3 存在张力，建议精确定义"全站一致"**。只覆盖 `--primary` 的增量主题不会动终端/编辑器/Git 图——"只改 3 个变量得到换强调色主题"（目标 2）与"主题切换后全站一致"（目标 3）在字面上矛盾。建议把"一致"定义为**结构性一致**（所有渲染面都从令牌取色、无硬编码旁路），而非**内容性一致**（每个主题都覆盖所有面），并在主题选择器上给每套主题标注覆盖范围（如 badge：仅强调色 / 完整），避免用户对增量主题的预期错位。

> [!TIP]
> 建议：**把"令牌契约面"做成自动化测试，而不是只靠 grep 验收**。阶段 0/1 验收目前依赖 §5.7 的 grep 命令 + 人工检查，但 grep 只能证明"没有字面色值"，证明不了"每套主题的 L2 全集都可解析、双分支都有值"（`CSS.supports('color', 'hsl(0 0% 8% / 0.7)')` 这类格式校验）。建议新增一组契约测试：遍历内置主题 CSS，断言 §5.9 定义的 L2 令牌全集（44 + 新增）在 `:root` 与 `.dark` 分支、以及每套 `[data-theme]` 覆盖层中取值非空且可解析；阶段 1 的"切换主题后终端/编辑器/Git 图同时变化"改为按主题截图或 `getComputedStyle` 断言（terminal.options.theme 重读后的值）的快照测试。这也直接缓解 §7"令牌契约面覆盖不全"——测试跑一遍比人眼扫一遍可靠。

> [!NOTE]
> 补充说明：**`meta theme-color` / iOS status-bar 的取值链没有闭环**。§5.9 说 theme-color "改为读 `--background` 或主题元数据"，但 `--background` 是 HSL 三元组（`44 22% 96%`），`meta[content]` 只接受 hex/rgb；且 `ThemeContext.tsx:77-93` 同时硬编码了 iOS `apple-mobile-web-app-status-bar-style`（`black-translucent` / `default`），这是按明暗二值写的，主题化后必须改为由 `appearance` 驱动。建议：(a) 定义统一解析函数（HSL→hex、alpha 与背景合并）并注明 `ThemeContext.tsx` 两处 meta 更新点都要改；(b) 允许 `ThemeManifest` 可选携带 `themeColor` / `statusBar` 覆盖字段，避免解析误差；(c) 阶段 1 验收补一条"切换 system 主题 + 系统明暗变化时，theme-color 与 status-bar 同步更新"。

### Pi

> [!CAUTION]
> 严重风险：**阶段 0 "视觉零变化"的验收缺少可量化手段，纯人工肉眼回归几乎必然漏判**。阶段 0 是纯重构——补 palette 层、抽终端/编辑器/Git 图令牌、收口 66 处暗色补偿——文档承诺"现有 light/dark 视觉零变化"，但验收标准里只有 `npm run test:client` / `build` / `typecheck` / `lint` 全绿 + grep 收敛。这些都能通过的情况下，单个色值的 alpha 通道偏移 5%、终端光标色从 `#AEAFAD` 写成 `#ADAFAD`、滚动条宽了 1px，**没有任何自动化手段能发现**。而终端/编辑器/滚动条/表单件这些恰好是交互密集、视觉敏感的区域。建议：阶段 0 开工前先引入一套轻量视觉回归工具（如 Playwright 截图 + `pixelmatch` 对比，或直接 `storybook` + `chromatic` 模式），对关键页面（聊天页 / 设置页 / 终端页 / 编辑器 diff / Git 图 / 权限面板）在 light 和 dark 下各拍一张基线图，重构后逐像素比对，差值阈值设为 0。这不是过度设计——"零变化"本身就是定量承诺，理应定量验收。

> [!WARNING]
> 潜在风险：**`dark:` 前缀的 Tailwind 原子类是"暗色模式硬编码"，与主题系统存在结构性冲突，且和 Claude 指出的具名色问题不是同一维度**。具名色（`bg-gray-900`）是色值硬编码，`dark:bg-gray-800` 则是**明暗规则硬编码**——它在编译期就确定了"暗色模式下用哪个色"，主题系统运行时改令牌完全影响不到这些类。后果：一套深色主题如果想让卡片背景从 gray-800 换成 slate-900，`dark:bg-gray-800` 的组件会全部留在原地，主题覆盖面被打穿。这比具名色更难修——具名色还能靠"替换为 bg-card + 令牌"来收口，`dark:` 前缀的存在意味着组件对"暗色模式下长什么样"有自己的主张，不接受主题接管。建议：阶段 0 的具名色收口需同时评估 `dark:` 前缀的处置策略——要么组件层面消除 `dark:` 类、全部走语义令牌（让令牌自身带明暗分支），要么明确声明 `dark:` 类是"主题的暗底保证"、主题覆盖层必须同时覆盖 `.dark` 选择器下的具名色映射，并把这条写入主题契约文档的限制章节。

> [!WARNING]
> 潜在风险：**主题的可访问性（a11y）完全没有进入方案视野**。文档通篇讨论视觉自由度与工程收口，但没有任何 WCAG 对比度约束或焦点可见性保障。用户主题（尤其选项 B 原始 CSS）可以轻易写出：(a) 正文对比度低于 4.5:1（小号文字的 WCAG AA 底线）；(b) `--ring` 与 `--background` 对比度不足，键盘用户完全看不见焦点在哪；(c) 用颜色 alone 传达状态（如 diff 的 add/del 只有色差异、无形状/符号辅助），色盲用户无法区分。建议在方案中补一个 a11y 小节：(1) 内置主题需过 WCAG AA 对比度校验；(2) 选项 A 的令牌白名单校验器可附带对比度警告（非阻断，仅提示）；(3) 明确 `--ring` 必须与 `--background` 拉开至少 3:1 对比度，作为主题契约的硬性条款；(4) Git 图 lane 色、diff 增删色等状态指示，主题可换色但不能去掉非颜色标识（如图标、符号、纹理）。

> [!TIP]
> 建议：**终端 16 色 ANSI 板要补充语义命名，否则主题作者会误用**。附录 A 只列了 `--term-ansi-red` / `--term-ansi-green` 等纯颜色名，但在 CLI 生态里这些颜色是有约定语义的：红=错误/危险、绿=成功/通过、黄=警告/注意、蓝=信息/链接、洋红=强调/调试、青=路径/代码。很多终端程序（ls、git、grep、diff、npm 输出）依赖这套语义来传达状态。如果主题作者把"红色"改成了蓝色，`git diff --color` 的删除行会变成蓝色、新增行也是蓝色，用户完全分不清。建议：在 `--term-ansi-*` 旁边加一组语义别名（如 `--term-error` / `--term-success` / `--term-warning` / `--term-info`），或至少在主题开发文档里明确写"ANSI 色是语义色，不是装饰色，改 hue 可以但要保持语义对应关系"。另外 extendedAnsi（DSH 已指出 16 个值）建议明确废弃、由 bright 系列推导，避免 24 个变量让主题作者无所适从。

> [!TIP]
> 建议：**设置页内藏一个"令牌预览页"，既是调试工具也是契约可视化**。展示所有 L2 令牌的当前值、明暗对比色块、以及在哪些组件中被引用（可从构建期的令牌使用统计生成）。价值有三：(a) 主题作者调颜色时不用在整个应用里到处找效果；(b) 契约测试的可视化载体，"令牌是否全、值是否合法"一眼可见；(c) 对用户是透明度——"你的主题改了哪些地方"有明确清单。实现成本不高：读 `getComputedStyle(document.documentElement)` 过滤出 `--` 开头的变量，按命名空间分组渲染即可。建议作为阶段 1 的随附功能，不是核心路径但能显著降低后续维护成本。

> [!TIP]
> 建议：**Git 图 lane 色避免数量天花板，用 fallback 或 HSL 旋转动态扩展**。`--graph-lane-1..10` 假设 lane 最多 10 条，但活跃分支多的仓库很容易超（monorepo 场景尤甚）。一旦超了，要么继续硬编码加变量（没完没了），要么 fallback 到固定色（视觉跳跃）。更优雅的做法：定义 `--graph-lane-base-hue` / `--graph-lane-hue-step` 两个令牌，第 N 条 lane 的颜色由 `hsl(calc(var(--graph-lane-base-hue) + var(--graph-lane-hue-step) * (N - 1)), 70%, 55%)` 动态生成；主题只需覆盖这两个参数就能控制整张图的色系，且数量无上限。前提是用 `@property` 注册 hue 为 `<number>` 以便 CSS calc，或在 JS 侧的 `commitGraph.ts` 里做计算。比硬编码 10 个变量更灵活，主题作者也好理解。

> [!NOTE]
> 补充说明：**对 §8.1 用户主题格式的默认选项建议翻转**。文档推荐默认用令牌 JSON（A）、高级模式切原始 CSS（B），但 cloudcli 的核心用户群是开发者——写 CSS 对他们是零门槛，而令牌 JSON 需要先查白名单、理解 HSL 三元组格式、不能用浏览器 DevTools 实时调，反而学习成本更高。选项 A 的核心价值是"安全"（不会破坏布局），但安全是对"不信任的第三方主题"而言的。用户自己写的主题、或从信任来源拷的 CSS，安全性不是首要诉求，便利性才是。建议：默认展示 CSS 编辑器（带语法高亮 + 实时预览），令牌 JSON 作为"安全模式/简单模式"可切换；设置页在切换到 CSS 模式时弹一次风险确认即可。这也和 Codex "文件放进去就生效"的直觉更一致。

> [!NOTE]
> 补充说明：**`ThemeManifest` 建议预留两个可扩展字段，成本近零但避免未来打破契约**。(1) `coverage?: 'accent' | 'full'`——标注主题是只改强调色还是完整覆盖，在主题选择器上显示对应 badge，直接缓解 DSH 指出的"目标 2 与 3 张力"问题；(2) `supportsAccentOverride?: boolean`——声明主题是否允许用户在其基础上再自定义强调色（类似 macOS 的"强调色"设置），为未来"主题 + 个人强调色"双层定制留口子。两个字段都是可选、有默认值，不影响现有方案，但避免了未来加字段时旧主题元数据的兼容处理。

---

## Pi 对 §8 待确认项的拍板

### §8.2 主题目录与 Docker 挂卷

**结论：采用 `~/.cloudcli/themes/`，Docker 场景做文档标注，不做特殊适配。**

理由：
- 本仓库 `docker/` 下只有 `claude-code`、`codex` 两个构建环境 Dockerfile，没有应用主 Dockerfile，也没有 docker-compose，README 未提 docker 部署——**Docker 不是主要分发形态**，为它设计额外目录结构属于过度设计。
- `~/.cloudcli/themes/` 对齐 Codex 的 `$CODEX_HOME/themes/` 惯例，开发者直觉一致。
- Docker 用户挂载卷是常规操作，只需在文档里加一行"若使用 Docker 部署，将 `/root/.cloudcli/themes/` 挂载到宿主机目录"即可，无需代码改动。
- 未来若推出一键部署镜像，再考虑 `/data/themes/` 之类的标准化路径不迟，当前不做预设。

### §8.7 阶段 0 拆分口径：一次性收口 vs 按模块分片 + 豁免

**结论：按模块分片 + 豁免清单，每片独立可回滚。严禁一次性大改。**

理由：
- 阶段 0 承诺"视觉零变化"，改动面越大、验证越难，出问题越难定位。一次性收口等于把所有风险压在一次 PR 里，回滚成本极高。
- 分片建议（按依赖顺序）：
  1. **palette 层 + L2 引用改写**：纯 CSS 改动，不碰 JS，最容易验证。
  2. **语法高亮路径统一**：把 `MarkdownCodeBlock.tsx` 从直连 Prism 主题切到 `--cc-syntax-*`，已有测试护栏（`syntaxHighlightTheme.test.ts`、`markdownSyntaxThemeInjection.test.tsx`）。
  3. **终端（xterm）令牌化**：独立模块，改动集中在 `useShellTerminal.ts`，可单独测。
  4. **编辑器（CodeMirror）令牌化**：UI 主题 + 语法高亮两套，改动较深，单独一片方便回滚。
  5. **Git 图 + 其他零散硬编码**：体量小，最后收尾。
  6. **index.css 后半段 66 处暗色补偿**：等 `color-scheme` 先上，再决定哪些可删、哪些需令牌化。
- 每片的验收标准：该模块视觉零变化 + 该模块的 grep 命中清零（品牌豁免除外）+ 截图对比通过。
- **豁免清单**必须显式维护（建议放 `src/index.css` 顶部注释），包括：agent 品牌色、各 harness Logo、文件图标色（`fileIcons.ts`）、状态色（成功/错误/警告的语义色值）。

### §8.8 `dark:` 前缀（529 处中性色具名色）：全消除 vs 暗底保证

**结论：不追求全消除。按语义分类处置，目标是"主题关键路径不受 dark: 硬编码阻挡"，不是零 dark:。**

数据核实：`dark:` 前缀总数 **1303 处**，其中中性色具名色相关约 **529 处**，其余为彩色系（状态色、品牌色、文件图标色等）。

处置策略分三类：

| 类别 | 举例 | 处置 | 占比（估） |
|---|---|---|---|
| **语义背景/文字/边框** | `bg-gray-50 dark:bg-gray-900`、`text-gray-700 dark:text-gray-300`、`border-gray-200 dark:border-gray-800` | **替换为令牌类**（`bg-card`、`text-muted-foreground`、`border-border`），由令牌的 light/dark 分支接管 | ~200 处 |
| **状态色（成功/错误/警告/信息）** | `bg-green-500 dark:bg-green-600`、`text-red-500 dark:text-red-400` | **保留 dark:，作为主题暗底保证**。新增 `--status-success` / `--status-error` / `--status-warning` / `--status-info` 令牌，dark: 类可逐步替换但不是阶段 0 必须 | ~300 处 |
| **品牌色 / 文件图标色 / 装饰色** | Agent 品牌色、`fileIcons.ts`、渐变色 | **明确豁免**，写入豁免清单，主题不覆盖 | ~1000 处 |

理由：
- 1303 处全改工作量巨大，且大部分是状态色和品牌色，本来就不该随主题变——为了"零 dark:"而改是为手段而手段。
- 第一类（语义背景/文字）是主题能否"换肤"的关键路径，约 200 处，工作量可控，改完主题就已经能覆盖 80% 以上的视觉面。
- 状态色建议新增独立令牌（`--status-*`），主题可选择性覆盖，但默认保持现有语义色，这是"主题一致性"与"状态可识别性"的平衡。

### §8.9 `--cc-syntax-N` 是否本轮升语义名

**结论：本轮不升。做两件轻量事情把风险挡住即可，等阶段 2 用户主题上线前再升。**

理由：
- `--cc-syntax-N` 当前的消费者只有 **4 个文件**，全在 chat 模块内，且都是内部实现——编号不稳定对外界零影响。
- 升语义名需要梳理所有 selector×property 组合（keyword / string / comment / function / number... 至少十几个），还要决定命名粒度（是 `--syntax-keyword-color` 还是 `--syntax-keyword` 一个对象式？要不要分 font-weight？），设计成本不低。
- 更关键的是：**编辑器语法高亮如果也要共用同一套令牌，命名必须同时覆盖 Prism 和 CodeMirror 两套 token 体系**，这件事应该和 §5.7 编辑器令牌化一起做，而不是现在孤立地给 chat 侧改名。
- 本轮先做两件事挡风险：
  1. 在 `buildSyntaxTheme()` 旁边导出一个 `SYNTAX_TOKEN_MAP` 常量（`{ keywordColor: 3, commentColor: 5, ... }`），把编号和语义绑定一次。内部代码如果需要引用具体语义，走这个常量而不是手写 `--cc-syntax-3`。
  2. 在 CSS 注释里明确标注 "`--cc-syntax-N` 是内部实现，不保证编号稳定，主题作者请勿直接覆盖"。
- 升级时机：阶段 2 做用户主题（选项 A 令牌白名单）时，语法令牌必然要进入白名单，那时再统一升语义名、同时覆盖 Prism 和 CodeMirror 两条路径，一次到位。

---

## DSH 对 §8 待确认项的拍板

### §8.2 主题目录与 Docker 挂卷

**结论：采用 `~/.cloudcli/themes/`，Docker 仅文档标注、不做代码适配；但目录解析必须收敛到服务端现成的 home 解析方式，不许新写第二套路径逻辑。**

- 同意 Pi：实测 `docker/` 下只有 `claude-code` / `codex` / `shared` 构建环境与 README，无应用 Dockerfile、无 compose——Docker 不是分发形态，为它设计 `/data/themes/` 属过度设计。
- 补强（实施约束）：`~/.cloudcli` 本就是服务器所有持久化的既有约定（auth.db、`assets/`、`local-server.json`，见 `server/index.ts:198/268/323` 的 `path.join(os.homedir(), '.cloudcli', ...)` 模式）。主题目录必须**复用同一解析方式**（新增一个与 assets 平行的目录常量，而不是在主题模块里另写 `~/.cloudcli/themes` 字符串拼接）。这样 Docker / systemd / 非标准 HOME 场景的挂卷点与 assets 完全一致，README 一句话即可覆盖。
- 补一条：若日后在 README 写 Docker 说明，应同时覆盖"主题目录 + assets 目录"两个挂载点，避免只挂 themes 不挂 assets 的认知偏差。

### §8.7 阶段 0 拆分口径

**结论：按模块分片 + 显式豁免清单，每片独立合入、独立验收、独立可回滚；严禁一次性大 PR。同意 Pi 的分片顺序，补强四点。**

1. **豁免清单必须是机器可校验的单一事实源**，不能只写在 `index.css` 顶部注释里——注释会漂移。建议维护一个独立清单文件（`*豁免清单*.txt` 或 TS 常量，按 `文件:行号` 或 `模式 + 理由` 记录），验收 grep 用排除该清单的方式执行（`grep -vf` 或脚本化 allowlist）；品牌色 / `fileIcons.ts` / 状态色豁免全部走它，新代码引入硬编码时先过清单。
2. **按"文件集群"切片，而非按色值类型切片**：实测 1502 处中性色分布在 **105 个文件**，热点集中（`AskUserQuestionPanel.tsx` 84、`TaskDetailModal.tsx` 72、`McpServerFormModal.tsx` 69、`TaskBoardToolbar.tsx` 60…）。每个 PR 覆盖一组同模块文件（同模块语义一致、review 上下文完整）；热点文件（>50 处）单独成片，避免单 PR 塞进 84 处替换。
3. 分片顺序的依赖依据（与 Pi 一致，补因果）：palette/L2（纯 CSS，不碰 JS）→ 语法高亮（有现成测试护栏）→ 终端 / 编辑器（改动深、独立回滚）→ Git 图 / 零散 → 66 处暗色补偿（必须等 `color-scheme` 先上，否则会令牌化一堆本可删除的补偿）。
4. **阶段 0 的定量终点**：整仓中性色具名类从 1502 处收敛到"仅豁免清单命中"，而非"计划内的片改完就算完"；每片验收 = 该片 grep 清零 + 视觉回归基线（阈值 0）+ 契约测试通过。

### §8.8 `dark:` 前缀（529 处中性色具名色）：全消除 vs 暗底保证

**结论：同意 Pi 的三分法，但把决策表述修正为"按类别选择策略"，并给出技术依据——"① vs ②"是伪二选一。**

- 技术依据（决定策略边界，已核实）：`dark:bg-gray-800` 生成的规则形如 `.dark\:bg-gray-800:is(.dark *)`（特异性 ≥ (0,2,0)），且在元素上直接写死具体色值——CSS 变量继承与 `[data-theme="x"]` 覆盖（特异性 (0,1,0)）都压不过它。因此"策略②暗底保证"在技术上**只对主题不应控制的色**（状态色、品牌色）成立；对主题应控制的色，**不存在绕过替换的选择，只能换成语义令牌类**。真实决策是"哪些类别交给主题（必须换令牌），哪些保留 `dark:`（豁免 / 语义色）"，这正是 Pi 三分法的内容，拍板确认。
- 三分法确认：语义背景/文字/边框（约 200 处）→ 阶段 0 换令牌类，主题关键路径，必做；状态色（约 300 处）→ 保留 `dark:` + `--status-*` 令牌可选覆盖，语义色不该随主题乱变；品牌 / 文件图标 / 装饰（约 1000 处）→ 豁免清单。
- 补强（验收口径，防矫枉过正）：**验收必须区分 `dark:` + 具名色（必须收敛）与 `dark:` + 令牌类（无害，允许保留）**。`dark:bg-card` 这类 dark 变体指向令牌、没有硬编码任何色值，主题完全接管，不应计入验收命中——否则阶段 0 会为消灭无害用法白费力气。建议验收命令单独统计"dark: 具名色"（现 529 处），目标收敛到豁免清单；而不是"dark: 总数归零"（1302 处中大部分无害）。

### §8.9 `--cc-syntax-N` 是否本轮升语义名

**结论：本轮不升语义名，同意 Pi 的时机判断；但"导出常量 + 写注释"还不够，必须补一条黄金映射锁测试。**

- 事实支撑（已核实）：消费者仅 4 个文件、全在 chat 模块内部（`syntaxHighlightTheme.ts`、`Markdown.tsx` + 2 个测试），编号不稳定对外零影响；生成器对任意属性（color / fontStyle / fontWeight…）统一编号，"语义名"需覆盖 selector × property 两个维度，命名粒度本身需要设计——这正是应该 defer 的原因之一。
- 补强 1（本轮必做）：现有测试只断言 `var(--cc-syntax-\d+)` 的**形状**（`syntaxHighlightTheme.test.ts:81,100`），**没有锁住具体映射**——一旦源 Prism 主题依赖升级（oneLight/oneDark 迟早 bump）导致"遍历遇到差异的顺序"变化，编号会整体重排而测试照绿。本轮应加一条**黄金映射测试**：固化"selector×property → 编号"的完整对照（或至少固化变量总数 + 每个 selector 的变量分布），依赖升级时编号漂移则 CI 红，逼出有意的 remap 决策。这是把"编号不稳定"从静默风险变成显式变更的关键一步，成本一条测试。
- 补强 2：语义名草案现在就在文档定方向（不实现），让阶段 2 不被命名 bikeshed 卡住：以 Prism 语义类别为根（comment / string / keyword / function / number / operator / punctuation / tag / attr-name / constant…），属性维度作后缀（`-color` / `-style` / `-weight`），如 `--cc-syntax-comment-color`；编辑器 `HighlightStyle` 的 token 名向同一套 Prism 类别对齐，保证两条路径共用一套命名（呼应 §5.7 编辑器令牌化）。
- 与 §8.8 的关系：语法高亮令牌属于"主题应控制的色"，但走编译产物（变量）路径，不涉及 `dark:` 具名色问题，两件事独立、可并行推进。

## 牵头结论（第 1 轮：27 条批注汇总）

> 三方对 §8 四项待定项的拍板见紧随其后的 Pi / DSH / Claude 三节，汇总与落地见文末「牵头结论（第 2 轮）」。

**汇总（2026-09-24，三方共 27 条批注）**：采纳 22 条 / 部分采纳 5 条 / 不采纳 0 条。三条批注被判为**核心修正**并改写正文骨架：Claude #1（具名色原子类是审计盲区）、DSH #3（L1 palette 无消费者的结构空洞）、DSH #1（`.tmTheme` 与交付格式脱节）。

**验证说明**：结论中所有量化断言均已在本仓库用 `rg` 实测复核。与批注数字不一致处已在对应条目标注（`mobileTerminalSelection` 为 7 处而非 8 处；`editorStyles.ts` 为 14 处 hex / 13 处三元）。

### Claude（10 条）

| # | 批注 | 意见 | 理由 / 处置 |
|---|---|---|---|
| 1 | 具名色原子类是 §1.3 / §5.7 / 阶段 0 的审计盲区（[CAUTION]） | **采纳（核心）** | 实测确认：中性色 1502 + 彩色系 1725 ≈ **3227 处**，约为 66 处 `rgb()` 的 49 倍，且多于语义令牌类 2498 处——初稿"绝大部分 UI 自动跟随"不成立。已写入 §1.2 #10、§1.3、§4 非目标、§5.7（新增两行 + 验收命令 ②）、§6 阶段 0 范围 |
| 2 | §5.7 CodeMirror 只覆盖一半，须建 `HighlightStyle.define()`（[WARNING]） | **采纳** | 已核实 `CodeEditorSurface.tsx:4` 导入 `oneDark`（该包同时提供 UI 主题与语法高亮）。只做 `EditorView.theme()` 会残留 / 缺失语法色。已写入 §5.7 |
| 3 | `--cc-syntax-N` 编号不是稳定契约（[WARNING]） | **部分采纳** | 编号确由遍历顺序决定（`syntaxHighlightTheme.ts:29-48`，已核实）。采纳"升为契约面前先固化编号"；**语义重命名**是否本轮做列为 §8.9 待定——selector+property 未必能一一派生出简洁语义名 |
| 4 | §5.6 首帧防闪烁对用户主题无解（[WARNING]） | **采纳** | `<link>` 异步，与"同步首帧"自相矛盾。已按 WorkBuddy `applyCachedCssSync` 机制改写 §5.6（缓存同步注入 + 后台校验更新） |
| 5 | xterm 需主动重读；Git 图可直接 `var()`（[TIP]） | **采纳** | CSS 变量变化不触发事件、xterm `ITheme` 不支持 `var()`，须 `getComputedStyle` 重读后重设。已写入 §5.6 |
| 6 | 显式利用 `@layer base` 优先级保障（[TIP]） | **采纳** | 已核实 `:root` / `.dark` 位于 `@layer base`（`index.css:45`、`:143`）。已写入 §5.2 作为"双轨方案成立的硬约束" |
| 7 | `mobileTerminalSelection.ts` 8 处、属移动端高发区需专项回归（[TIP]） | **部分采纳** | 实测 **7 处**（行 179 / 180 / 181 / 197 / 198 / 200 / 228），非 8 处；但"初稿记 4 处是错的 + 需移动端专项回归"成立。已按 7 处修正 §1.2 #7、§5.7 |
| 8 | 跨设备 themeId 边界；`system` 分支不写偏好需决定（[TIP]） | **采纳** | 已核实 `setTheme` 的 `system` 分支 early return、不调 `writeUserPreference`（`ThemeContext.tsx:113-121`）。已写入 §5.6 与 §6 阶段 2 验收 |
| 9 | 引用细节修正（[NOTE]） | **采纳** | ① `editorStyles.ts` 实为 14 处 hex / 13 处三元 ✓；② `CommitHistoryItem.tsx` 的 `'#0ea5e9'` fallback ✓（路径为 `git-panel/history/`，非 `components/`）；③ `Markdown.tsx` 路径为 `chat/transcript/` ✓；④ 令牌值格式多样 ✓；⑤ 已有测试护栏 ✓ |
| 10 | 对 §8 各问题的意见（[NOTE]） | **采纳** | 8.3 恒深色 / 8.4 建模为两套内置主题 / 8.5 豁免清单注释 / 8.6 扩展点，全部采纳，见 §8 |

### DSH（9 条）

| # | 批注 | 意见 | 理由 / 处置 |
|---|---|---|---|
| 1 | §3"生态复用"与 §5 交付格式脱节，建议加 `.tmTheme` 变体（[WARNING]） | **采纳（核心）** | 这是方案自相矛盾，必须修。已新增 §5.5 选项 B2，并说明其与 `syntaxHighlightTheme.ts` 的编译思路同构 |
| 2 | 用户主题"加载成功但破坏 UI"无恢复路径（[WARNING]） | **采纳** | 已写入 §5.6 强制恢复通道（快捷键 / 启动参数 / 查询参数）+ 自愈哨兵；A 免疫作为卖点在设置页明示 |
| 3 | L1 palette 无消费者，"覆盖 L1 即可换肤"在现状下不成立（[NOTE]） | **采纳（核心）** | 初稿最大技术空洞。已改写 §5.1：L1→L2 引用规则（通道拆分）+ 范围界定，并把"两步改造"写入 §6 阶段 0 |
| 4 | 显式 `color-scheme`，66 处补偿可能大幅缩减（[TIP]） | **采纳** | 已写入 §5.6，并定执行顺序"先加 `color-scheme`，再重审 66 处"，§5.7 同步 |
| 5 | URL 需版本参数；复用 plugins 静态资源路由（[TIP]） | **采纳** | 已核实 `plugins.routes.ts:26` 的 `/:name/assets/*` + `resolveAsset` 模式存在。已写入 §5.6 |
| 6 | sanitize 两类约束 + `extendedAnsi` 未覆盖（[NOTE]） | **采纳** | 已核实 `extendedAnsi` 在 `useShellTerminal.ts:59`。已写入 §5.8（`cc-` / `user-` 前缀、选择器注入字符）与附录 A（废弃 `extendedAnsi`） |
| 7 | §4 目标 2 与 3 张力，建议定义"结构性一致"（[NOTE]） | **采纳** | 已改写 §4 目标 3，并落地为 `coverage` 字段（§5.3）+ 选择器 badge |
| 8 | 把令牌契约面做成自动化测试（[TIP]） | **采纳** | 已新增 §5.11 |
| 9 | `theme-color` / iOS status-bar 取值链未闭环（[NOTE]） | **采纳** | 已核实 iOS `apple-mobile-web-app-status-bar-style` 硬编码（`ThemeContext.tsx:77-93`）。已写入 §5.9 + `ThemeManifest` 覆盖字段 |

### Pi（8 条）

| # | 批注 | 意见 | 理由 / 处置 |
|---|---|---|---|
| 1 | 阶段 0"视觉零变化"缺可量化验收（[CAUTION]） | **采纳** | "零变化"是定量承诺，须定量验收。已写入 §6 阶段 0 验收（Playwright 截图比对，阈值 0） |
| 2 | `dark:` 前缀是明暗规则硬编码，与主题系统冲突（[WARNING]） | **采纳** | 实测带 `dark:` 的具名色约 529 处（含复合变体约 640 处），与 Claude #1 同源但维度不同（色值 vs 规则）。已写入 §1.2 #11、§5.7，处置策略列为 §8.8 待定（推荐策略 ①） |
| 3 | a11y 完全未进视野（[WARNING]） | **采纳** | 已新增 §5.10：AA 对比度、`--ring` ≥ 3:1 硬条款、不得仅以颜色传达状态，并纳入 §5.11 |
| 4 | ANSI 色需语义命名 + `extendedAnsi` 处置（[TIP]） | **采纳** | 已写入附录 A（`--term-error/success/warning/info`），与 DSH #6 合并处置 |
| 5 | 设置页"令牌预览页"（[TIP]） | **部分采纳** | 价值认可，但属**阶段 1 可选增值项**，不进核心验收路径。已列为 §6 阶段 1 的可选随附功能 |
| 6 | Git lane 用 HSL 旋转动态扩展（[TIP]） | **部分采纳** | 采纳"避免 10 条天花板"的目标（新增 §5.12）；但 `@property` 注册 hue 的浏览器兼容性有风险，改为**在 `commitGraph.ts` 的 JS 侧计算**，并保留 `--graph-lane-1..10` 供主题精调 |
| 7 | §8.1 建议默认翻转为原始 CSS（[NOTE]） | **部分采纳** | 与 DSH #2 的安全论证存在张力。**维持默认 A**（免疫"破坏 UI"，自托管分享 / 跨设备同步场景更需要护栏），但把 B 的入口做浅（一键开关 + 语法高亮 + 实时预览），并允许用户改"默认打开模式"。已写入 §5.5 v2 说明 |
| 8 | `ThemeManifest` 预留 `coverage` / `supportsAccentOverride`（[NOTE]） | **采纳** | 与 DSH #7 呼应。已写入 §5.3（另加 `sentinelClass` 支撑 §5.6 自愈哨兵） |

**未采纳**：无。

**部分采纳的 5 条**（Claude #3、Claude #7、Pi #5、Pi #6、Pi #7）均已给出替代方案：或降级为可选增值项、或修正数字后采纳、或以"安全优先"的理由保留初稿取向并说明。

**遗留待定（需项目所有者拍板）**：§8.2（主题目录与 Docker 挂卷）、§8.7（阶段 0 拆分口径）、§8.8（`dark:` 处置策略）、§8.9（`--cc-syntax-N` 是否本轮语义化）。

**修订说明（本次对方案做了哪些调整）**：

1. 修正三处系统性低估 / 空洞：具名色原子类规模（§1.2 #10 / #11、§1.3、§5.7）、L1→L2 引用规则（§5.1）、`.tmTheme` 生态缺口（§5.5 B2）。
2. 修正 5 处事实性引用错误：`editorStyles.ts` 13 处三元、`mobileTerminalSelection.ts` 7 处、`CommitHistoryItem.tsx` 的 `#0ea5e9`、令牌值格式多样性、`Markdown.tsx` 路径。
3. 新增 4 个章节：§5.10 a11y、§5.11 契约测试、§5.12 Git lane 数量上限、§5.5 选项 B2。
4. 强化 5 处机制：首帧缓存注入（§5.6）、`color-scheme` 与 66 处补偿的执行顺序（§5.6 / §5.7）、JS 消费者主动刷新（§5.6）、用户主题恢复通道与哨兵（§5.6）、`?v=` 缓存失效与 plugins 路由复用（§5.6）。
5. 重估 §6 阶段 0 的范围与验收方式（视觉回归 + 两条 grep + 契约测试），并提示分片拆分。
6. §8 待评审问题从 6 条更新为 9 条（4 条已决 → 待定 4 条 + 已决 5 条，其中 3 条为新增）。

**代码改动**：无。本轮只修订设计文档，等待审批结果后再进入实施。

---

## Claude 对 §8 待确认项的拍板（补充轮）

> 2026-09-25，应项目所有者要求，对 Pi / DSH 已拍的四项给出独立结论。本轮所有数字断言均已在当前工作区重新实测，与 v2 记录不一致处已标注；三方结论一致处不再重复论证，只列增量。

### §8.2 主题目录与 Docker 挂卷

**结论：采用 `~/.cloudcli/themes/`，Docker 仅文档标注、不做代码适配；路径解析必须复用 server 现有 `path.join(os.homedir(), '.cloudcli', …)` 模式（新增与 assets 平行的目录常量），严禁主题模块另写第二套拼接。与 Pi / DSH 完全一致，复核支撑采纳：**

- 已实测 `docker/` 下仅 `claude-code` / `codex` / `shared` 三个构建环境与 README，无应用 Dockerfile、无 compose——Docker 非分发形态，为其预设 `/data/themes/` 属过度设计。
- 已实测 `server/index.ts:323`（`path.join(os.homedir(), '.cloudcli', 'local-server.json')`）与 `plugins.routes.ts` 的 `/:name/assets/*` + `resolveAsset` 模式（`Content-Type` / `Cache-Control` 已齐）均存在，阶段 2 静态提供直接复用。
- 一处补充进 README 口径的要求：**"文件主题"与"粘贴主题"是两条存储线**——前者在服务端目录（只读、随部署卷走、内容不跨设备同步），后者存用户偏好（跨设备同步内容）。二者的删除、失效、跨设备语义均不同，设置页须按 `source` 区分展示，文档写明。

### §8.7 阶段 0 拆分口径

**结论：按模块分片（文件集群为粒度）+ 机器可校验豁免清单，每片独立验收、独立合入、独立回滚，严禁一次性大 PR。同意 Pi / DSH，四处补强：**

1. **`dark:` 收敛不设独立片**。Pi 阶段 0 第 4 项"dark: 处置策略定案"的产出应限定为纸面工作（策略 + 分类清单），施工动作并入各文件集群片——`bg-gray-50 dark:bg-gray-900` 是成对结构（实测相邻成对至少 **335 处**），消灭 `dark:` 与替换具名色必须是同一个 diff（见 §8.8 修正 ①）。分片计划里不应出现独立的"dark: 片"。
2. **第一片（palette + L2 引用改写）加计算值等值断言**。该片的"视觉零变化"最难验证——`hsl(var(--x))` 包裹与 HSL 通道拆分是否等值，像素比对受反锯齿与字体渲染干扰。固定加一条：改写前后对全部 44 个令牌取 `getComputedStyle` 的 resolved value，逐位相等断言。纯 JS 断言、可逐令牌定位失败点，比截图回归更精确且更轻。
3. **每片 DoD 三件套固定化**：该片 grep 清零（对机器可校验 allowlist）+ 视觉基线比对（阈值 0）+ 计算值等值断言（palette/L2 片必做，其余片可选）。
4. DSH 四点补强（allowlist 单一事实源、文件集群切片、依赖顺序、定量终点）全部同意；§8.8 的三分法分类清单与豁免清单是**同一份资产**，一次建设、共同消费。

### §8.8 `dark:` 前缀处置

**结论：三分法（语义骨架换令牌 / 状态色后置 / 品牌豁免）成立并拍板采纳；附一处数据勘误、两处执行修正。**

**数据勘误（本轮实测钉死口径）**：`dark:` 总数 **1302** = 中性色具名 **534** + 彩色系具名 **590** + 语义令牌类仅 **6** + 其余约 172 为 `dark:` + 非色 utility（`dark:block`、`dark:prose-invert` 等结构性变体，天然无害）。**`dark:` + 具名色合计 1124 处、占 86%**——DSH"1302 中大部分无害"按字面不成立，应改为"结构性变体与令牌类（约 178 处）无害，具名色 1124 处均为硬编码、按三分法分流"。另：全项目 `dark:bg-card` 这类令牌类用法仅 6 处，说明暗色处理基本是"具名色双写"模式——第一类替换完成后这些 `dark:` 自然消失，验收口径维持 DSH 提法定：只统计 `dark:` + 具名色（本轮实测 534，v2 记 529，差 5 属口径/时点漂移，不影响结论），收敛目标 = 豁免清单命中。

**修正 ①（原子性）**：`bg-x dark:bg-y` 是成对结构，替换必须一次完成（一次换成 `bg-card` 同时消灭两半），不存在"先去 dark: 再换色"的中间态，也不允许同一文件拆两片处理。这同时约束 §8.7：dark: 处置并入文件集群片。

**修正 ②（`--status-*` 纪律）**：Pi 三分表"状态色 → 保留 dark: + 新增 --status-* 令牌"自相矛盾——保留 `dark:` 的组件不读令牌，此时覆盖 `--status-error` **没有任何效果**，主题作者以为能改、实际改了无效，这正是 DSH 在 L1 上指出的"无消费者令牌"覆辙的重演。拍板：**`--status-*` 的定义与状态色 `dark:` 类的替换捆绑为同一个后续片（可晚于阶段 0），阶段 0 不引入**；替换完成前，主题开发文档诚实写明"状态色暂不受主题控制"。附录 A 的 `--status-*` 条目应标注引入时机，防止阶段 0 实施者顺手定义出死令牌。

### §8.9 `--cc-syntax-N` 是否本轮升语义名

**结论：本轮不升语义名（同意 Pi / DSH 时机判断）；黄金映射测试采纳，实现形态定为 inline snapshot；另加一条 denylist 护栏；语义名本轮只定草案方向。**

- **黄金映射 = inline snapshot**：`buildSyntaxTheme()` 是纯函数，对输出 `{ style, css }` 直接做 inline snapshot 即固化"selector×property → 编号"全表——快照本身就是对照表、零额外维护，prism 主题依赖 bump 导致编号重排时 CI 红，且 diff 直接可读（哪个编号从 comment 变成 string 一目了然）。比手工维护对照文件更省力，可叠加"变量总数不变"断言作第一道信号。`SYNTAX_TOKEN_MAP` 常量仍建议导出（消费者出现前可仅供测试消费）。
- **denylist 护栏（本轮必做）**：收口 `MarkdownCodeBlock.tsx` 后消费者跨出 chat 模块，"内部实现"的边界开始外溢。护栏：生成器与快照之外**禁止任何文件手写 `--cc-syntax-[0-9]` 字面量**，新消费者只允许消费 `style` / `css` 产物或 `SYNTAX_TOKEN_MAP`。CI grep 检查命中即红，把"编号不稳定"从注释约定升级为机器强制。

**v4 补记（0-E1 实施后，对上面"修正 ①"的再修正）**：原拍板假设第一类可"换成 `bg-card` 同时消灭两半"，从而让 class-1 的 `dark:` 双写自然消失。**实测证伪**（理由与数据见 §5.7 v4 / 0-E 记录）：本片存在 **89 种不同的 `(light, dark)` 元组**，语义令牌类只能承载一对值，强行折叠必然改色。故 0-E 采用 **A1 保值档位**——`bg-gray-100 dark:bg-gray-700 → bg-n-gray-100 dark:bg-n-gray-700`：**成对替换的原子性不变**（一次改完两半、不设中间态），但**两半都保留**，`dark: + 具名色` 收敛为 `dark: + 令牌类`。

这对验收口径的影响：§5.7 与上面的"只统计 `dark:` + **具名色**"现在正是 A1 的收敛对象（`bg-n-gray-100` 不再被具名色 grep 命中，`dark:bg-n-gray-700` 亦不计入），**所以口径不用改，只是"具名色"的终点从"换成 `bg-card`"变成"换成 `bg-n-gray-*`"**。代价（`dark:` 双写在 class-1 内继续存在、档位跨角色耦合）已在 §5.7 v4 记账，由**阶段 2 语义化改名**一次收口——与 §8.9 对 `--cc-syntax-N` 的"本轮只加间接、阶段 2 改名"完全同构。
- **语义名草案（本轮定方向不实现，同意 DSH）**：以 Prism 语义类别为根（comment / string / keyword / function / number / operator / punctuation / tag / attr-name / constant …）、属性作后缀（`-color` / `-style` / `-weight`），CodeMirror `HighlightStyle` 的 tag 名向同一套类别对齐——chat 与编辑器两条高亮路径共用一套命名，阶段 2 前一次到位改名，避免两次重命名。

### 四项总表

| 项 | Claude 结论 | 与 Pi / DSH 的关系 |
|---|---|---|
| §8.2 | `~/.cloudcli/themes/`，Docker 仅文档标注；路径复用 homedir 模式；文件/粘贴两线存储语义写明 | 完全一致（无分歧） |
| §8.7 | 分片 + 机器可校验豁免清单；dark: 不设独立片；palette 片加计算值等值断言 | 一致 + 两处补强 |
| §8.8 | 三分法采纳；勘误（dark: + 具名色 1124 处占 86%）；--status-* 与消费者捆绑、阶段 0 不引入 | 一致 + 一处勘误 + 两处修正 |
| §8.9 | 本轮不升；黄金映射 = inline snapshot；加 denylist 护栏；草案本轮定方向 | 一致 + 实现形态细化 |

**留给项目所有者的净分歧**：无——四项三方结论方向一致，分歧仅在执行细节（§8.8 的 `--status-*` 引入时机与 Pi 表述冲突、§8.7 的 dark: 是否独立片与 Pi 分片顺序冲突，本拍板均给出修正理由，建议采纳本轮表述）。

---

## 牵头结论（第 2 轮：§8 四项拍板汇总与落地）

**日期**：2026-09-25 ｜ **输入**：Pi / DSH / Claude 三方对 §8.2 / §8.7 / §8.8 / §8.9 的独立拍板 ｜ **产出**：§8 全部标记已决，正文 v3 落地

### 一、四项拍板汇总

| 项 | 三方方向 | 最终落地（已写入正文） |
|---|---|---|
| **§8.2 主题目录** | 完全一致，无分歧 | `~/.cloudcli/themes/`，Docker 只写文档、不做代码适配；**路径解析必须复用 server 现有 `path.join(os.homedir(), '.cloudcli', …)` 模式**，新增与 assets 平行的目录常量，严禁第二套拼接。见 §8.2、§5.6 |
| **§8.7 拆分口径** | 一致（分片 + 机器可校验豁免清单） | 0-A…0-G **七片序列** + **按文件集群切片**（105 文件，热点单独成片）+ **DoD 三件套**（grep 清零 / 视觉基线阈值 0 / 计算值等值断言）+ **dark: 不设独立片**；定量终点 = 收敛到豁免清单。见 §6 阶段 0 |
| **§8.8 `dark:` 处置** | 一致采纳三分法；Claude 作了勘误与两处修正 | 弃"全消除 vs 暗底保证"伪二选一；**三分法**（语义骨架换令牌 ~200 处必做 / 状态色保留 `dark:` 且 `--status-*` 阶段 0 不引入 ~300 处 / 品牌图标豁免 ~1000 处）；**验收只统计 `dark:` + 具名色，不统计 `dark:` 总数**。见 §8.8、§5.7、附录 A |
| **§8.9 语法令牌命名** | 一致同意本轮不升 | 本轮三件事：`SYNTAX_TOKEN_MAP` 常量 + **黄金映射 inline snapshot 测试** + **denylist grep 护栏**；语义名草案定方向、阶段 2 与编辑器令牌化一并实施。见 §8.9、§5.9 |

### 二、本轮数字复核结果（牵头实测）

| 断言 | 来源 | 实测 | 判定 |
|---|---|---|---|
| 中性色具名类分布 **105 个文件** | DSH §8.7 | **105** | ✅ 精确一致 |
| 热点文件 84 / 72 / 69 / 60 | DSH §8.7 | `AskUserQuestionPanel` **84**、`TaskDetailModal` **72**、`McpServerFormModal` **69**、`TaskBoardToolbar` **60** | ✅ 四项全部一致 |
| `dark:` + 中性具名 **534** / 彩色 **590** / 令牌类 **6** | Claude §8.8 | **529** / **581** / **6** | ✅ 一致（±5 属口径漂移） |
| `dark:bg-card` 类令牌用法仅 6 处 | Claude §8.8 | 字面 `dark:bg-card` = **0**，语义令牌类合计 **6** | ✅ 成立（"这类"指类别） |
| 成对结构 ≥ 335 处 | Claude §8.7 | 同文件成对 **414** | ✅ 成立 |
| `--cc-syntax-N` 消费者 4 个文件 | Pi / DSH §8.9 | **4**（`syntaxHighlightTheme.ts`、`Markdown.tsx` + 2 测试） | ✅ 精确一致 |
| 现有测试只断言编号形状、未锁映射 | DSH §8.9 | `assert.match(value, /^var\(--cc-syntax-\d+\)$/)` | ✅ 成立 |
| `resolveAsset` 路由已带 `Content-Type` / `Cache-Control` | Claude §8.2 | `plugins.routes.ts:29-30` 均存在（`Cache-Control: no-store`） | ✅ 成立（详见下"补充发现"） |
| `darkMode: ["class"]`、Tailwind v3 | DSH §8.8（特异性论证前提） | `tailwind.config.js` = `darkMode: ["class"]`，`tailwindcss ^3.4.0` | ✅ 前提成立 |
| `docker/` 无应用 Dockerfile | Pi / DSH / Claude §8.2 | 仅 `claude-code/` `codex/` `shared/` + README | ✅ 成立 |

### 三、牵头发现的两处需修正

1. **DSH §8.2 的引用行号有误**（不影响结论）：DSH 称 `~/.cloudcli` 解析见 `server/index.ts:198/268/323`，实测 `server/index.ts` **只有 :323** 一处（`local-server.json`）。同模式的实际位置是 `server/shared/image-attachments.ts:22`（assets）、`server/load-env.ts:43`（auth.db）、`server/modules/browser-use/browser-use.service.ts:84`。"复用同一解析方式"的结论完全成立，正文引用已改为准确位置。
2. **`?v=` 参数的性质需降级表述**：Claude 建议"阶段 2 复用 plugins 路由"，而该路由已发 `Cache-Control: no-store, no-cache, must-revalidate`——浏览器侧本就无缓存。故 `?v=` 应表述为"兜住中间层 / 代理缓存 + 便于排障"的**加固**，而非阶段 2 验收的必要条件。已在 §5.6 补注。**这也意味着阶段 2 验收里"改文件后刷新能看到变化"由 `no-store` 即已满足，`?v=` 是双保险。**

### 四、采纳与收敛

- **采纳**：三方 §8 全部拍板（方向一致）；Claude 的两处修正（`--status-*` 捆绑消费者、dark: 不设独立片）与一处勘误（`dark:` 分母口径）**全部采纳**——前者避免了"死令牌"覆辙，后者纠正了 DSH"1302 中大部分无害"的字面误读。
- **修正后采纳**：§8.7 的"dark: 处置策略定案"从阶段 0 的**施工项**降为**纸面产出**（分类清单），施工并入文件集群片。
- **不采纳**：无。
- **口径统一**：全文的 `dark:` 相关数字统一为"`dark:` + 具名色"口径（中性 529 / 彩色 581 / 合计约 1110），**不再使用"`dark:` 总数"作为验收指标**。

### 五、本轮对正文的改动清单

| 章节 | 改动 |
|---|---|
| §8 | 标题改 v3，2/7/8/9 由"待定"改为"已决"，补实施约束与依据；**当前无遗留待定项** |
| §6 阶段 0 | 重写为 0-A…0-G 七片序列表 + 切片粒度 + dark: 不设独立片 + 豁免清单单一事实源 + DoD 三件套 + 定量终点 |
| §5.7 | 三行具名色/dark: 条目重写为**三分法**；新增 `dark:` 总览行（含 1302 分解与验收口径）；验收段落加入第 ③ 条命令与 allowlist 要求 |
| §5.9 | `--cc-syntax-N` 条目重写为 v3 三件事 + 语义名草案方向 |
| §5.6 | `?v=` 补注 `no-store` 性质；新增"文件主题 vs 粘贴主题两条存储线" |
| 附录 A | `--status-*` 标注**阶段 0 不引入**及与消费者捆绑的理由 |
| §7 | 更新规模风险缓解；新增"死令牌"风险行 |
| §8 / 头部 | 版本状态更新为 v3 |

**代码改动**：无。本轮仍只修订设计文档。§8 已无待定项，**下一步可直接进入阶段 0 的 0-A 片实施**（palette 层 + L2 引用改写，含计算值等值断言）。
