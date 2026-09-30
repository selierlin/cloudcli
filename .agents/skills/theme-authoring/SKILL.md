---
name: theme-authoring
description: 为 CloudCLI 创作或修改主题。两条通道：内置配色主题（`BUILTIN_THEMES` + `src/index.css` 的 `[data-theme]` 令牌覆盖层，随包发布、受契约守卫）与用户 CSS 主题（自由式样式表，落 `~/.cloudcli/themes/`，零代码改动、无守卫）。含通道判据、令牌体系、服务端文件闸门、DOM 锚点分级、对比度守恒、免登录验证配方。通道 A 的完整方法（参照物选择、三种来源形态、板令牌产出、契约读法、验证配方、回写清单）见 `builtin-channel.md`；通道 B 的选择器分级见 `selectors.md`、验证配方见 `verification.md`。触发词：做个主题、配色主题、CSS 主题、皮肤、换个配色、改配色、主题不生效、主题没反应。
---

# CloudCLI 主题创作

## 0. 先判通道

判据是**内容**，不是文件扩展名。

| 你要改的 | 通道 |
|---|---|
| 纯颜色，且能写成「重新赋值 `--palette-*` L1 家族成员」 | **A 内置** |
| 纯颜色，但要逐个面微调（家族模型覆盖不到） | **B 用户 CSS** |
| 选择器 / 布局 / 材质 / 字体 / 隐藏元素 / 动画 | **B 用户 CSS** |

一句话：**改的是 L1 家族的值 → A；改的是某个具体面的样子 → B。**

> 别用「文件是 `.css` 还是 `.json`」判断——内置覆盖层本身就写在 `src/index.css` 里。
> 走错的代价是契约直接拒：`tests/theme-tokens/token-contract.spec.ts` 规定，除
> `--palette-*` / `--editor-*` 外，**任何颜色令牌不得持字面值**（HSL 三元组 / hex /
> `rgb()` 都不行），必须 `var(--palette-*)`。

选定通道后，两条路的差别在**住址 + 门槛**，不在内容：

| | A 内置 | B 用户 CSS |
|---|---|---|
| 住址 | `src/index.css` 的 `[data-theme]` 块 + `BUILTIN_THEMES` | `~/.cloudcli/themes/*.css` |
| 生效范围 | 随包发布，任何浏览器打开都有 | 服务端读得到就行 |
| 要过的关 | §5.10 对比度 6 配对、§5.11 遍历双向守卫、硬编码扫描、`token-contract` | **一个都没有** |
| `coverage` 徽标 | 可声明 | 文件里无处声明 → 无徽标 |
| 代价 | 改代码 + 回写设计文档 + commit | 两个文件，零代码 |

**细节不在这份文件里**——判完通道，去读对应分册：

| 你要做的事 | 读哪份 |
|---|---|
| 从参照物产出一套内置主题（通道 A 的全部方法） | **`builtin-channel.md`** |
| 给用户 CSS 主题写选择器 | `selectors.md`（**写前必读**） |
| 验证用户 CSS 主题真的生效 | `verification.md` |

本文件是索引：判通道、认令牌层、避坑。

## 通道 A：内置配色主题

**动手前读 `builtin-channel.md`**——方法在那里。本节只放两样：读者**不点开分册也能安全
动手**的 **3 条硬约束**，以及最小骨架。

### 3 条硬约束

| # | 硬约束 | 由谁守 | 漏写的后果 |
|---|---|---|---|
| 1 | 只赋 `--palette-*` / `--editor-*` **字面值**，其余一律引用 | `token-contract.spec.ts` | 测试**报错** |
| 2 | 覆盖层放在**任何 `@layer` 之外** | `theme-overlays.spec.ts` 的结构断言 | 测试**报错** |
| 3 | 浅色半边**必须**写成 `[data-theme="<id>"]:not(.dark)` | **无守卫** | **静默**——那套主题的泄漏检查整条失效 |

前两条漏写会被 CI 拦住（在这里点名只为省一次折返）；**第 3 条无守卫、漏写不报错**，
它是三条里唯一必须读理由的，见分册 M6。

### 骨架

1. `src/shared/constants.ts` 的 `BUILTIN_THEMES` 注册一项：

   ```ts
   { id: 'cc-<name>', name: '<中文名>', appearance: 'system', source: 'builtin', coverage: 'full' }
   ```

   `appearance` 是**外观角色**（`light` / `dark` / `system`）；`system` 表示「两种外观都能用」。
   `cc-light` / `cc-dark` 是外观默认本身，不是可选主题。
   `coverage` 取 `full` 还是 `accent` **有判据**（分册 M4）——别为显得完整而虚报。

2. `src/index.css` 写 `[data-theme="cc-<name>"]` 块。`cc-ocean` 是 `accent` 的典型，
   全文两个值就带动四个强调面、两种外观：

   ```css
   [data-theme="cc-ocean"] {
     --palette-brand-500: 173 75% 27%;
     --palette-brand-400: 172 66% 55%;
   }
   ```

   但 `full` 不是这个量级：**45~60 条声明 × 2~3 个块**（基色块 + `:not(.dark)` + `.dark`）。
   **每个值从哪来**是分册 M1–M3、M5 的事，别凭直觉填。

3. 明暗：家族模型天然分 sand（浅底）/ ink（深底），所以 L1 只写一遍、两种外观各自取档。
   要不要另写作用域块，判据是**一份 L1 值喂不喂得饱两种外观**：喂不饱（「译」/「译 + 造」
   这类两套色板的主题）就必须分块，浅色那半**必须**写成 `[data-theme="<id>"]:not(.dark)`
   ——硬约束 3，无守卫、漏写静默；喂得饱（只覆盖强调族、一份值明暗通用，如 `cc-ocean`）
   才不必分块。

4. 跑守卫：`npm run test:theme-tokens`（遍历双向守卫 + 对比度 6 配对）。
   新增**令牌**片的技巧：先不刷基线跑契约测试，「0 漂移 + 未覆盖项数 = 新令牌数 × 2」反证只新增。
   新增**主题**片的对账期望（恰 `+4`）见分册 V4。

5. 回写 `docs/research/CloudCLI主题与配色体系设计方案.md` 三处（清单与锚点纪律见分册 D1）。

6. commit：**subject 必须以汉字字符起头**（commitlint `subject-case` 连大写拉丁词开头都拒）。

## 通道 B：用户 CSS 主题

### 落点与闸门

- 文件：`~/.cloudcli/themes/<name>.css`，id 自动成 `user-<name>`（小写）。
  服务端只读扫描（`server/modules/themes/services/theme-files.service.ts`），路由 `/api/themes`。
- 文件名：`^[a-zA-Z0-9][a-zA-Z0-9._-]*$`；≤256KB；**禁 `@import`**；符号链接不得逃出目录。
- 粘贴主题走同一个闸门实现 `containsImportAtRule`（`src/shared/cssAtRules.ts`）。
- 逃生门 `?theme=default`（`src/main.tsx:46`）：清掉应用中的主题**和**预览草稿。

### 写法

- **令牌值必须是 HSL 三元组**（`150 12% 94%`），消费端是 `hsl(var(--x))`。
  写 `#hex` 会**静默失效**——不报错，只是没效果。
- **明暗分工**（推荐契约）：颜色规则全写 `:root:not(.dark)`，几何 / 材质 / 选择器写裸 `:root`。
  → 浅色是主题、切深色时颜色回落基色但布局改动保留。
- 覆盖层追加到 `<head>`，与 bundle 基色**同权重**，靠**文档顺序**取胜。
- 文件形式**无法声明 `coverage`**（文件里没这字段）→ 选择器里不显示覆盖范围徽标。

## 令牌体系

| 层 | 什么 | 举例 |
|---|---|---|
| L1 色板 | 家族成员，**唯一允许持字面值的一层** | `--palette-sand-500` / `--palette-brand-400` / `--palette-ink-100` |
| L2 语义 | `hsl(var(--palette-*))`，不要直接赋字面值 | `--background` / `--foreground` / `--primary` / `--card` / `--muted` / `--border` |
| 几何 | 派生 Tailwind 工具类 | `--radius`（`rounded-*` 全派生自它）、`--header-safe-area-top`、`--header-base-padding` |
| 玻璃导航 | 既有 glass 系统 | `--nav-glass-bg/-blur/-saturate`、`--nav-float-shadow/-ring`、`--nav-divider-color`、`--nav-input-*` |
| 板 | 终端 / 编辑器 / Git 图 | `--term-*`、`--editor-*`、`--graph-lane-*` |
| 兼容层 | 见下 | `--n-gray-*` / `--n-white` / `--n-black` |

**兼容层（`--n-*`）要按族整染**：`src/index.css` 里 `--n-*` 定义上方的注释明说这是给主题覆写的
别名层（`bg-n-gray-700` 编译成 `hsl(var(--n-gray-700))`），四个中性族合计 **1380 处**
（`gray` 1223 / `zinc` 66 / `slate` 51 / `neutral` 40；代码块底、次级按钮、悬停态、弹窗、
Tooltip）。不染就是「外壳是主题色、内脏是冷灰」。
契约（`tests/theme-tokens/theme-overlays.spec.ts` 的 `SURFACES.compat`）现在这样划：
`coverage: full` **可以**染这四族，但**必须整族十一档一起染**——只染其中几档既动了 `compat`
又算不上完整，会落回「档位之间」那种半冷半暖的接缝；`coverage: accent` **一档都不能动**，
它承诺只做强调色家族。
`--n-white` / `--n-black` **两种覆盖度都别动**：它们多是纯白 / 纯黑的填充与标签（257 处，
`text-n-white` 143 · `bg-n-white` 51 · `bg-n-black` 36），染纯白或纯黑是这里风险最大的动作。

**这三块会被 JS 侧重新读取**：`resolvedThemeId` 随用户主题变化（`ThemeContext.tsx`），所以
`--term-*` / `--editor-*` / `--graph-lane-*` 也跟着主题走，不是只能改外壳。

## DOM 锚点

见 `selectors.md`——**写选择器前必读**。那里按可信度分级，并列出会误伤的具体例子。

## 陷阱

1. **`[class*='x']` 子串匹配会误伤**。`[class*='border-r']` 会命中 `border-red-200` /
   `border-r-n-gray-900`。整词匹配用 `[class~='x']`。
2. **同一个类名可能挂在多个标签上**。`pwa-header-safe` 在 `<header>`（`WorkspaceHeader`）
   和 `<div>`（`WorkspaceStateView` 空态）上都有；写 `header.pwa-header-safe` 会漏掉空态。
3. **同类名跨模块撞车**。`flex-shrink-0` + `border-r` 既是工作区侧栏，也是**设置弹窗左栏**。
   要限定成「工作区壳的**直接子**」，否则设置弹窗被当成第三张卡。
4. **inline style 要赢必须 `!important`**，代价是那个交互的视觉失效（例：侧栏宽度是 inline style，
   强改会让拖拽 resize 看不出效果）。
5. **色相旋转会掉对比度**。绿是高相对亮度色相，「保持 L、只转色相」会让 `n-gray-500` 文字
   从 4.44 掉到 3.70。要**保对比度**：深半段（当墨用）二分求解新 L，浅半段（当底用）保持 L。
6. **自定义令牌名拼错会静默失效**。写完逐个核对，见 `verification.md` 第 2 条。
7. **`@import` 闸门是保守的，连注释都会命中**（见下）。

### 关于 `@import` 闸门（反直觉，必读）

`containsImportAtRule` 是**转义感知**的（`@im\70 ort` 也认），而且**不排除注释与字符串**——
它按 CSS 规范的 ident 规则读 `@` 后面的名字。实测：

| 文本 | 结果 |
|---|---|
| `/* 不需要 @import 也行 */` | **true（整份文件被拒）** |
| `/* 不用 @import */` | **true** |
| `/* 不需要 @import（闸门不允许） */` | false |
| `@im\70 ort url(x.css)` | **true** |
| `@media (min-width:768px){}` | false |

第三行与第一行看着矛盾，其实是同一个机制：名字一直读到「不是 ident 字符」为止，全角 `（`
属于 ident 字符（`\u0080-\uffff`），于是读出的名字是 `import（闸门不允许）` ≠ `import`。
**所以：主题文件里永远不要出现 `@import` 这个词**，哪怕在注释或说明里——「恰好通过」不能依赖。

## 验证

通道 A 见 `builtin-channel.md` 的 V1–V4，通道 B 见 `verification.md`。**两边都不许跳过**：
通道 B 一个守卫都没有，唯一能证明「它真的生效了」的就是真装真读；通道 A 的守卫**只覆盖
源码**，「值真的画到屏幕上了」同样只有真机读数能证明。
