---
name: theme-authoring
description: 为 CloudCLI 创作或修改主题。两条通道：内置配色主题（`BUILTIN_THEMES` + `src/index.css` 的 `[data-theme]` 令牌覆盖层，随包发布、受契约守卫）与用户 CSS 主题（自由式样式表，落 `~/.cloudcli/themes/`，零代码改动、无守卫）。含通道判据、令牌体系、服务端文件闸门、DOM 锚点分级、对比度守恒、免登录验证配方。触发词：做个主题、配色主题、CSS 主题、皮肤、换个配色、改配色、主题不生效、主题没反应。
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

## 通道 A：内置配色主题

1. `src/shared/constants.ts` 的 `BUILTIN_THEMES` 注册一项：

   ```ts
   { id: 'cc-<name>', name: '<中文名>', appearance: 'system', source: 'builtin', coverage: 'full' }
   ```

   `appearance` 是**外观角色**（`light` / `dark` / `system`）；`system` 表示「两种外观都能用」。
   `cc-light` / `cc-dark` 是外观默认本身，不是可选主题。

2. `src/index.css` 写 `[data-theme="cc-<name>"]` 块。**只赋 `--palette-*` / `--editor-*`
   字面值，其余一律引用**。`cc-ocean` 全文就两个值，却带动四个强调面、两种外观：

   ```css
   [data-theme="cc-ocean"] {
     --palette-brand-500: 173 75% 27%;
     --palette-brand-400: 172 66% 55%;
   }
   ```

3. **覆盖层放在任何 `@layer` 之外**。这是结构约定（Tailwind v3 处理后样式表零 `@layer`、
   覆盖层靠文档顺序取胜），不是「layered 必输」机制——所以它由结构断言守着，别指望层叠机制。

4. 明暗：家族模型天然分 sand（浅底）/ ink（深底）。要只作用单一外观，用 `:not(.dark)` / `.dark`。

5. 跑守卫：`npm run test:theme-tokens`（遍历双向守卫 + 对比度 6 配对）。
   新增令牌的片可以用「先不刷基线跑契约测试：0 漂移 + 未覆盖项数 = 新令牌数 × 2」反证只新增。

6. 回写 `docs/research/CloudCLI主题与配色体系设计方案.md`。

7. commit：**subject 必须以汉字字符起头**（commitlint `subject-case` 连大写拉丁词开头都拒）。

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

**`--n-gray-*` 别漏**：`src/index.css` 里 `--n-gray-*` 定义上方的注释明说这是给主题覆写的
别名层（`bg-n-gray-700` 编译成 `hsl(var(--n-gray-700))`），它管着 **343 处表面**
（代码块底、次级按钮、悬停态、弹窗、Tooltip）。不染就是「外壳是主题色、内脏是冷灰」。
`--n-white` / `--n-black` **故意别动**——它们同时当底色和文字色用（`text-n-white` 有 200 处）。

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

见 `verification.md`。**不许跳过**：通道 B 一个守卫都没有，唯一能证明「它真的生效了」的
就是真装真读。
