# CloudCLI 侧边栏视觉降噪方案

> 状态：**P0 四项已实施**（本地 4 个提交，未推送），P1 未动。§2.3 / §2.4 已按实施后的实测更正，§12 为改后数据与验收结果。
> 日期：2026-10-28（初稿与第 1 轮响应同日）
> 范围：`src/modules/sidebar/` 桌面端与移动端的列表外观（项目行、展开块、模式条、顶栏按钮）。不含会话内容区。
> 不在范围：主题 token / `--primary` 等调色板变量、21 个外置主题、`SidebarCollapsed` 折叠图标栏、信息架构级重构（合并页签、改变导航模型）。
> 用途：请审阅者重点核对三件事——① §2 的测量与 §3 的 `file:line` 是否与当前代码一致；② P0 四项是否会让「收藏 / 删除 / 新建会话」变得难发现或难触发；③ P1 的导航收编是否值得为它承担 i18n 成本。
> 参考规范：`.agents/skills/frontend-module-standards/SKILL.md`
> 记号：**【实测】**＝真实服务 + 真实数据库 + Chromium 渲染后 `getBoundingClientRect()` 测量；**【代码】**＝读源码得出，未渲染验证；**【待验证】**＝无法从当前代码确定。

---

## 1. 需求

用户原话：

> 「目前侧边栏中的元素太多混杂在一起了，我看过去感觉很乱。你可以自己打开看看，是不是有美化空间呢？」
> 「我同时展开了 3 个项目……和整体画面有点格格不入」（同一位用户上一轮对新建会话按钮的描述）

拆成三条可验收的诉求：

| # | 诉求 | 验收口径 |
|---|---|---|
| N1 | 一眼扫过去不再「哪里都在抢注意力」 | 同一屏内高饱和/高对比色块 ≤ 1 处；行内常驻图标数量下降 |
| N2 | 展开多个项目时，块与块之间能看出层次 | 一个展开块内行宽/行高/左缘有明确规则，且规则可复述 |
| N3 | 不改主题、不改使用习惯就能变整齐 | 不动 token 与外置主题；P0 不新增交互步骤 |

**本方案不主张「换配色」。** 上一轮已经确认：观感问题来自「面积 × 饱和度」的结构，而不是某个 token 的对比度——同一处主色，kanagawa 浅色的填充对比只有 4.10，却比对比度 10.35 的 ocean 深色更刺眼。只按对比度调参调不准，所以方案全部落在「用在哪、用多大」上（见 §6）。

---

## 2. 现场事实

测量环境：本机服务端（`SERVER_PORT=3021`，真实 `~/.cloudcli/auth.db`），视口 1280×1000，侧栏宽 288px，样本 12 个项目 / 2 个会话。主题分别渲染 `cc-tokyo-night` 与 `cc-kanagawa` 的浅色与深色四组，结论一致。

### 2.1 几何（单位 px，相对侧栏左缘）【实测】

| 元素 | 左缘 | 宽 | 高 |
|---|---|---|---|
| 侧栏 | 0 | 288 | 1000 |
| 顶栏（品牌 + 3 个图标按钮） | 12 | 264 | 28 |
| 模式条容器 | 12 | 263 | 34 |
| 搜索框 | 12 | 263 | 36 |
| 项目行 | 6 | 275 | **52** |
| └ 星标槽 | 14（图标 20） | 24 | 24 |
| └ 项目名文本区 | 50 | **117** | 36 |
| └ 尾部动作区 | 175 | **92** | 24 |
| 展开块（`ml-3 + border-l + pl-3`） | 18 | 263 | — |
| ├ 新建会话 | 31 | 196 | **32** |
| ├ 管理 | 231 | 50 | 32 |
| └ 会话行 | 31 | 250 | **42** |

第一行项目距顶部 **145px**（品牌行 + 模式条 + 搜索框 + 分隔线）。

### 2.2 模式条四项宽度【实测】

`项目 98 | 对话 98 | 运行中 30 | 归档 34`，容器 263。288px 下四项全部可见，无「···」按钮；其余侧栏宽度下的收起行为由 `useTabOverflow` 决定，本次未逐档实测【代码 + 单点实测】。

### 2.3 行背景状态【实测 + 代码，改前快照】

| 状态 | 背景 | 来源 |
|---|---|---|
| 选中 | `bg-accent` | `SidebarProjectItem.tsx:336-337` |
| 已收藏（未选中） | 浅色 `bg-yellow-50/50`、深色 `bg-yellow-900/10` | `SidebarProjectItem.tsx:341-343` |
| 普通 | `bg-background` | `SidebarProjectItem.tsx:340` |

> P0-2 已删除「已收藏」一行，改后只剩选中 / 普通两种。

### 2.4 收藏会参与排序（本轮更正上一版的结论）【代码 + 实测】

上一版断言「收藏不参与排序、黄底只是逐行装饰」，**这条是错的**。

`sortProjects`（`src/modules/sidebar/utils/sidebarProjectFormatting.ts:118-145`）在按名称或日期排序**之前**先把 `isStarred` 的项目整体排到最前：

```ts
if (aStarred && !bStarred) return -1;
if (!aStarred && bStarred) return 1;
```

上一版只查了 `server/` 的 `ORDER BY` 与 `SidebarProjectList` 的渲染顺序，漏掉了这个前端排序函数。

实测（2026-10-28，真实数据库，22 个项目）：给第 7 位的「我的资料」加星，2.5s 内它移到第 2 位（收藏组内部再按名称/日期排），取消收藏后顺序完全还原。

**对 P0-2 的影响**：分组这件事**已经由位置承担**，金色实心星负责标记「为什么在这一组」。黄底是同一信息的第三种表达，删除它只是去掉重复，不丢分组——这与上一版「纯装饰」的理由不同，但结论一致。

---

## 3. 问题清单（按视觉影响排序）

### P1-① 项目行尾部动作吞掉 1/3 宽度，且红色删除常驻

- **现象**：hover / 选中时，行尾依次出现 `关注徽标(16) + 改名(24) + 删除(24) + 折叠箭头(16)`，含间距共 **92px**，占 275px 行宽的 33%；标题可用宽度只剩 **117px**。删除图标用 `text-red-600`，是整条侧栏饱和度最高的元素。【实测】
- **代码**：`SidebarProjectItem.tsx:414-464`；改名 `:439-448`、删除 `:449-458`、箭头 `:459-462`。
- **附带缺陷**：改名与删除是 `<div onClick>`，没有 `role` / `tabIndex` / `onKeyDown`，键盘用户无法触发；星标容器 `:348-369` 同样是 `div`。【代码】
- **影响**：N1、N2。

### P1-② 星标常驻 + 收藏整行染黄 → 3 种行底色

- **现象**：未收藏的星以 `opacity-40` 常驻，12 行形成一列灰星点阵；收藏行再叠一层黄底。于是同屏有 3 种行底色（选中 accent / 收藏黄 / 普通），其中 2 种是彩色。【实测】
- **代码**：星标 `SidebarProjectItem.tsx:348-369`（`opacity-40 hover:opacity-100`）；黄底 `:341-343`。
- **影响**：N1。收藏信息星标已表达，黄底是重复编码，且与「选中」争夺同一语义通道。

### P1-③ 展开块的 52 / 42 / 32 三段行高没有任何规则

- **现象**：项目行 52、会话行 42、新建会话行 32，三者间距均为 `space-y-1`（4px）。因为新建行最矮、又带描边，展开块看起来像「标题 + 表单 + 列表」三套东西拼接。【实测】
- **代码**：容器 `SidebarProjectSessions.tsx:291-292`（`ml-3 space-y-1 border-l border-border pl-3`）；新建行 `:338`（`h-8`）；会话行由 `SidebarSessionItem.tsx:514` 起的 `div` 渲染，无显式高度类，实测 42px。
- **影响**：N2。

### P1-④「新建会话」是第二个搜索框

- **现象**：新建会话 = `h-8 + border border-primary/25 + bg-card + rounded-md`；正上方搜索框 = `h-9 + border-primary/35 + rounded-xl`；右侧「管理」= `variant="outline"` 描边。三者连读像两条表单控件。【实测】
- **代码**：`SidebarProjectSessions.tsx:338`（桌面）、`:298-320`（移动端两列变体同样带 `border-primary/25`）。
- **背景**：这一版是上一轮为压制「实心 primary 长条」改的；当时只解决了「太重」，没解决「像输入框」。【实测记录：改前填充对底 4.1–10.4，改后为卡片表面】
- **影响**：N2。

### P1-⑤ 模式条 2 个带文字 + 2 个纯图标，宽度 98:98:30:34

- **现象**：四个模式（项目 / 对话 / 运行中 / 归档）在同一容器里，前两个 98px 带文字，后两个 30/34px 只有图标；「波形 = 运行中、盒子 = 归档」只能靠 hover tooltip 得知。宽度比 2:2:1:1 在视觉上没有任何分组依据。【实测】
- **代码**：`SidebarModeTabs.tsx:40-45`（`showLabel` 布尔）+ `:63-71`（className）。
- **影响**：N1、N2。

### P1-⑥ 同一屏两个「+」，含义不同

- **现象**：顶栏「+」= 新建项目（`SidebarHeader.tsx:121-129`，title `创建新项目`）；「对话」视图表头「+」= 在当前项目新建会话（`SidebarRecentConversations.tsx:753-761`）。两者在对话模式下同屏可见，字形、尺寸、灰度一致。【实测 + 代码】
- **影响**：N2，兼有可发现性风险。

### P1-⑦ 第二行 `0 - ...path` 的「0 -」

- **现象**：12 个项目里 9 个是空项目，第二行一律以 `0 - ` 开头再接截断路径（`0 - ...open_projects/cloudcli`）。计数 0 不携带信息，却占据行首并让路径多缩进两个字符。【实测】
- **代码**：`SidebarProjectItem.tsx:400-408`（`{count}{' - '}{path}`，路径超过 25 字符取末 22 位）。
- **影响**：N1。

### P1-⑧ 圆角 6 / 8 / 12 三套并存

- 项目行与会话行 `rounded-md`（6）+ `rounded-lg`（8）混用；模式条 `rounded-lg`（8）；搜索框 `rounded-xl`（12）；顶栏按钮 `rounded-lg`（8）。【代码】
- 影响：低。列在此处，作为 P1-⑨ 的附带项。

---

## 4. P0：不动信息架构的降噪

四项互相独立，可分批提交。全部只改 `className` 与行内 JSX，不动数据流。

### P0-1 改名 / 删除收进「···」，删除不再常驻

**改法**：`SidebarProjectItem.tsx:438-458` 的两个 `<div>` 换成一个 `ActionMenu`（`src/shared/ui/ActionMenu.tsx`，已支持 `isDanger / showDividerBefore / iconOnly / portal / icon / triggerClassName / ariaLabel`，见 `ActionMenu.tsx:10-39` 的类型定义），删除项加 `showDividerBefore`。

```tsx
const projectMenuItems = [
  { key: 'rename', label: t('tooltips.renameProject'), icon: Edit3, onSelect: () => onStartEditingProject(project) },
  { key: 'delete', label: t('tooltips.deleteProject'), icon: Trash2, onSelect: () => onDeleteProject(project), isDanger: true, showDividerBefore: true },
];

<ActionMenu
  label={t('search.modeMore', 'More')}
  // 读屏用户在同一行还会遇到星标与折叠箭头，通用「更多」无法区分上下文。
  ariaLabel={`${project.displayName} · ${t('search.modeMore', 'More')}`}
  icon={MoreHorizontal}
  iconOnly
  portal
  variant="ghost"
  size="sm"
  // touch: 变体与现有改名/删除按钮保持一致（:440 / :451），
  // 否则在「桌面宽度 + 触屏」的平板场景没有 hover，入口不可见。
  triggerClassName="h-6 w-6 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 touch:opacity-100"
  items={projectMenuItems}
/>
```

> **移动端可见性已有一层兜底**：`src/index.css:1196-1198` 在 `@media (max-width: 768px)` 内把 `.group .group-hover\:opacity-100` 强制为 `opacity: 1 !important`，所以 ≤768px 即使漏写 `touch:opacity-100` 也不会隐身。但 `isCompact` 由 `useCompactSidebar` 判定，桌面宽度下的触屏设备不在这条媒体查询内，故仍按现有两处按钮的写法保留 `touch:opacity-100`。

**预期**：尾部 `关注徽标 16 + 菜单 24 + 箭头 16`（含间距约 64px），标题宽度 117 → 约 145px；红色不再常驻；改名/删除获得键盘可达性（顺手修掉 §3-P1-① 的附带缺陷）。

**代价**：删除从「1 次点击 + 确认框」变成「开菜单 + 点删除 + 确认框」。删除本身已有二次确认（`onDeleteProject` → `pendingDeletion` 弹窗），多一层菜单是否可接受见 Q2。

### P0-2 星标改为 hover 显现，去掉收藏黄底

**改法**：
1. `SidebarProjectItem.tsx:348-354`：未收藏时 `opacity-40` → `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100`；**保留 24px 槽位**，避免 hover 时文字横移。已收藏仍 `opacity-100`。
2. `:341-343` 删除 `bg-yellow-*` 三个分支，收藏行回到 `bg-background`。
3. 星标容器 `:348-354` 由裸 `<div onClick>` 改为可聚焦控件：`role="button" tabIndex={0}` + `onKeyDown`（Enter / Space 触发 `toggleStarProject`，Space 需 `preventDefault`）。这是 V6 唯一没有落地处方的缺口——只改透明度不会让星标变得可 Tab。

> **空槽位的视觉处理**（回应审阅 §P0-2 的「空槽点阵」）：24px 槽在非 hover 时是一条留白，而不是 12 个字形；留白与「40% 灰星」的噪声量级差一个数量级，故默认取留白。若实测觉得空槽割裂，备选是 hover 行时显示 20% 描边空星（`opacity-20`），二者都保留槽位宽度。

**预期**：行底色 3 种 → 2 种（选中 / 普通）；左侧 12 个灰星点阵消失；收藏仍由金色实心星表达（常驻）；星标可用键盘操作。

**风险**：未收藏时星标不可见，是否影响「给项目加星」的可发现性 → Q1。

### P0-3 新建会话 / 管理回到列表行语言

**改法**（桌面 `:338`、移动 `:302` 与 `:312-320`）：

桌面新建会话（`Button variant="ghost"`）：

```
- h-8 flex-1 justify-start gap-2 border border-primary/25 bg-card text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-foreground active:bg-accent/80
+ h-9 flex-1 justify-start gap-2 bg-transparent text-xs font-medium text-foreground transition-colors hover:text-foreground
```

移动端新建会话（`:302`，两列网格里的 `<button>`）：

```
- flex h-8 items-center justify-center gap-2 rounded-md border border-primary/25 bg-card text-xs font-medium text-foreground transition-all duration-150 hover:bg-accent active:scale-[0.98] active:bg-accent/80
+ flex h-9 items-center justify-center gap-2 rounded-md bg-transparent text-xs font-medium text-foreground transition-all duration-150 hover:bg-accent active:bg-accent/80 active:scale-[0.98]
```

「管理」（桌面 `:346-354`、移动 `:312-320`）由 `variant="outline"` 改 `variant="ghost"`，className 统一为 `h-9 text-xs text-muted-foreground hover:text-foreground`；加号图标保留 `text-primary`。

**不写 `hover:bg-accent/60` 的原因**：`Button` 的 ghost 变体已带 `hover:bg-accent`，再叠加一个不同透明度的同名属性，最终生效值取决于生成顺序，不是一个可预期的覆盖。悬停底色直接沿用 ghost 的默认值。

**关于 `active:scale-[0.98]`**：移动端保留，理由见 §6.2 修订——同屏的会话行（`SidebarSessionItem.tsx:251`）与项目行（`SidebarProjectItem.tsx:192`）都是 `active:scale-[0.98]`，单独去掉这一颗会变成唯一的「不跟手」按钮。桌面端本就没有该属性（上一轮已移除）。

**预期**：展开块内不再出现「输入框」；行高阶梯从 52/42/32 收窄为 52/42/36；`border-primary/25` 这个全侧栏最强边框消失。

**风险**：新建会话是项目块内的主操作，降为「行」是否会太弱 → Q3。

### P0-4 空项目不再显示「0 - 」

**改法**：`SidebarProjectItem.tsx:400-408`

```tsx
// 现有 getSessionCountDisplay（:59-62）已经把两个来源合并成字符串：
//   Number(project.sessionMeta?.total ?? sessions.length)
// 所以这里只做一次数值化，不重新取数，避免漏掉 meta 缺失的兜底分支。
const sessionCount = Number(sessionCountDisplay);

<div className="text-xs text-muted-foreground">
  {sessionCount > 0 && <span className="opacity-60">{sessionCount} · </span>}
  {project.fullPath !== project.displayName && (
    <span className="opacity-60" title={project.fullPath}>{path}</span>
  )}
</div>
```

即：计数为 0 时整段不渲染；大于 0 时用 `·` 替代 `-`。

**预期**：9 个空项目第二行只剩路径，行首不再出现无意义的 0。

**不做**：把计数改成右侧徽标。那需要重新占用刚清空的尾部空间，留待有真实诉求再说。

---

## 5. P1：导航层与网格

### P1-1 模式条（三个选项，作者倾向 A）

| 选项 | 做法 | 成本 | 风险 |
|---|---|---|---|
| **A（倾向）** | 保留 2+2，但在文字组与图标组之间加 1px 分隔；两个图标按钮统一 `32×26`；运行中计数徽标常驻 | 纯样式，~10 行 | 图标仍无文字，仍需 tooltip |
| B | 四项全部带文字（`项目 / 对话 / 运行中 / 归档`） | 需补 i18n：`modeRunning` 仅 en / zh-CN / zh-TW 有；`modeArchived` 15 个语言全缺。288px 下 4×62≈248 可放下，更窄时靠现有 `useTabOverflow` 收起 | 15 个语言文件改动；短文案在德语/俄语会溢出 |
| C | 把运行中 / 归档收进「···」 | 最小 | 运行中计数徽标被隐藏，等于砍功能，**不建议** |

### P1-2 顶栏三个等权图标

`SidebarHeader.tsx:107-138`：刷新（低频）/ 新建项目（主操作）/ 折叠（视图操作）三者同为 `h-7 w-7 ghost`。倾向：刷新并入「···」（可与设置、版本入口同组），顶栏只留「+」与折叠；若不想新增菜单，至少给刷新与折叠更低的静息灰度（`text-muted-foreground/50`，hover 复原）。

### P1-3 统一网格

- 行圆角：`rounded-md`(6) 与 `rounded-lg`(8) 并存 → 统一 8；
- 行高：52 / 42 / 32 → P0-3 后为 52 / 42 / 36，可进一步把会话行与新建行都定到 40；
- 模式条与搜索框之间目前 `space-y-2`（8px），顶栏到模式条 `mt-2.5`（10px），分隔线到列表 8px——三个间距值 → 统一 8 或 12。

---

## 6. 明确不做的方向

1. **不动 `--primary` 与任何主题 token。** 它是 focus ring、选中边框、开关状态的共同来源；改它会钝化整个应用的强调色，且 21 个外置主题要逐个跟进。问题在这一处用法，不在调色板。
2. **不新增 hover 位移 / 缩放**（`hover:translateY`、`hover:scale`）。上次已确认这类微动效会加重「乱」的体感。移动端既有的 `active:scale-[0.98]` 按压反馈**保留**：它只在手指按下的瞬间存在，且同屏会话行 / 项目行都有（`SidebarSessionItem.tsx:251`、`SidebarProjectItem.tsx:192`），单独移除一颗按钮会破坏一致性。桌面端当前无此属性。
3. **不改会话行 / 项目行的点击语义**（整行点击 = 选中并展开）。`projectRowClickSelection.test.tsx` 覆盖该行为。
4. **不动 `SidebarCollapsed` 图标栏**（折叠后是另一套布局，另有版本状态点）。
5. **不引入新的设计 token / 组件层。** P0 全部落在既有 `Button` / `ActionMenu` 与 Tailwind 类名上。

---

## 7. 验收标准

| # | 判据 | 验证方式 |
|---|---|---|
| V1 | 项目行 hover 时尾部图标 ≤ 3 个（徽标 / 菜单 / 箭头），标题可用宽度 ≥ 140px | `getBoundingClientRect()` 复测，脚本见 §2 |
| V2 | **非 hover 静态**行底色 ≤ 2 种（选中 / 普通）；hover 态单独不计入（普通行 `hover:bg-accent/50`、收藏行原 `hover:bg-yellow-100/50` 属交互反馈，不是基色） | 计算样式取值，悬停态外移鼠标后取 |
| V3 | 未收藏行的星标在非 hover 时 `opacity: 0`，hover 后 `1`，且文字 x 坐标不变 | 前后 rect 对比 |
| V4a | **P0 阶段**：展开块内行高取值 ≤ 3 个，且不含 32（P0-3 后应为 52 / 42 / 36） | 遍历 `[data-testid="project-session-list"]` 子节点 |
| V4b | **P1-3 之后**：展开块内行高只出现 2 个值（项目行 / 嵌套行）。V4b 不参与 P0 验收——按 §10 顺序 P0 先于 P1，P0 阶段必不成立 | 同上 |
| V5 | 空项目第二行不出现 `0` | 文本断言 |
| V6 | 键盘可达：`Tab` 能聚焦星标与「···」菜单；`Enter` 打开菜单，`Enter` / `Space` 切换星标 | Playwright `keyboard.press`；落地处方见 P0-1（ActionMenu 自带）与 P0-2 第 3 条（`role="button" tabIndex={0} onKeyDown`） |
| V7 | `cc-kanagawa` / `cc-tokyo-night` × 浅/深四组下，V1–V3 成立 | 四组重跑 |
| V8 | `vitest run src/modules/sidebar` 全绿（基线 21 文件 / 129 例，Node 22） | `npx vitest run src/modules/sidebar` |
| V9 | 无测试断言被本次样式改动破坏（已 grep：`bg-yellow` / `opacity-40` / `border-primary/25` 在 `src/modules/sidebar/tests` 无命中） | `grep -rn` |

---

## 8. 风险与回滚

| 风险 | 概率 | 处置 |
|---|---|---|
| 删除操作可发现性下降（多一层菜单） | 中 | 菜单项保持红色危险色 + 二次确认；若反馈差，回退到「hover 才显示红色图标」而不是恢复常驻 |
| 星标 hover 才出现，用户找不到收藏入口 | 中 | 保留 24px 槽位；`group-focus-within` 保证键盘可见；先只对「未收藏」隐藏 |
| 新建会话降权后用户以为不能新建 | 低-中 | 加号保持 primary；hover 有底色反馈；若反馈差，改为 `bg-primary/8` 淡底（不回到描边） |
| 分类器/i18n 文案缺失（P1-1 B） | — | 不做 B 即无此风险 |
| 改动只影响外观，但破坏了行点击 | 低 | V8 单测覆盖；改动不触及事件处理 |

回滚粒度：P0 四项各自独立提交，可单独 revert。P1 各项独立提交。

---

## 9. 开放问题

| # | 问题 | 作者倾向 | 需要审阅者表态 |
|---|---|---|---|
| Q1 | 未收藏的星标默认隐藏（hover 显现），会不会让「加星」变得难发现？**连带**：保留的 24px 槽在非 hover 时是一条留白，是否也要处理？ | 倾向隐藏；槽位保持留白（不画 20% 空星）——留白与 12 个灰星的噪声量级不同，空星会把噪声还回来 | 是否需要 `opacity-20` 常驻 / hover 行时出描边空星？三个选项都要保留槽宽以维持文字 x 不变 |
| Q2 | 删除收进「···」后变成三步，是否可接受？ | 倾向接受：删除已有二次确认，本就不该是「一次点到」的动作 | 是否有其他入口（右键菜单 / 快捷键）需要同步？ |
| Q3 | 新建会话降到行级（无描边、hover 才有底色），是否太弱？ | 倾向接受：它是块内主操作但不是全局主操作，primary 加号承载强调 | 是否改为 `bg-primary/[0.06]` 的淡底折中？ |
| Q4 | 收藏黄底是否有我不知道的分组含义（例如某些视图下按收藏排序）？ | **已实测：收藏确实会排序**（`sortProjects` 先按 `isStarred` 分组，见 §2.4），所以分组已由位置表达，黄底是第三种重复表达，仍倾向删除（P0-2 已按此实施） | 无需再确认服务端依赖：排序在前端，且取消收藏后顺序可还原 |
| Q5 | 模式条走 A（分隔 + 等宽图标）还是 B（四项带文字 + 补 i18n）？ | 倾向 A：15 个语言文件为两个词改动不划算 | 若近期有其他改动本来就要动 locale，则 B 的边际成本更低 |
| Q6 | 顶栏刷新是否真的低频到可以收进菜单？ | 倾向收进菜单 | 若有用户习惯用刷新手动同步会话，则改为降灰度而非移走 |

---

## 10. 实施顺序（若批准）

1. P0-4（最短、零风险，先验证测量脚本与截图链路）
2. P0-2（星标 + 黄底）
3. P0-1（菜单，涉及少量新代码）
4. P0-3（新建/管理）
5. 四组主题复测 + `vitest src/modules/sidebar`
6. P1 视审阅结论再排

每步一个 commit，完成一批后本地提交（不推送），便于单独回退。

---

## 11. 审阅批注

> 审阅方式：在本节下方按 `### 审阅者：<名字>（日期）` 追加，逐条写「章节 / 问题 / 建议」；作者在表内 `作者响应` 列裁决（采纳 / 采纳但修正处方 / 不采纳 + 理由）。

### 审阅者：（待填）

| 章节 | 批注 | 作者响应 |
|---|---|---|
| | | |

### Claude · `cloudcli-doc-review`

> 已按 §2 提示实际打开源码核对全部关键 `file:line`。结论：P0 引用的行号基本准确（选中 `:337` / 普通 `:340` / 黄底 `:343`、星标 `:353`、改名 `:439-448` / 删除 `:449-458` / 箭头 `:459-462`、桌面新建行 `:338`），ActionMenu 确在其位且支持 `isDanger / showDividerBefore / iconOnly / portal`，P0 四项可落地。以下为主要风险。

> [!WARNING]
> **P0-3 处方未覆盖移动端，且与 §6 约定冲突。** 移动端新建/管理在 `SidebarProjectSessions.tsx:302`，仍是 `h-8 ... border-primary/25`，且带 `active:scale-[0.98]`（`:302`）——§6.2 明确「不做 hover 位移/缩放」，但该 `active:scale` 保留。P0-3 的处方（桌面 `:338`）既未把移动端 `:298-320` 一并改写，也未在 §6 声明这个已存在的 scale 属豁免。建议：处分明示移动端同样降为行级，并把移动端 `active:scale-[0.98]` 一并移除或明确豁免，否则 V7（四组主题复测）会带出不一致。

> [!WARNING]
> **V4 判据与 P0-3 / P1-3 的执行顺序矛盾。** V4 要求「展开块内行高只出现 2 个值（项目行 / 嵌套行）」，但 §4 明确 P0-3 后的预期是 **52 / 42 / 36**（共 3 个值），要到 P1-3 把会话行、新建行统一到 40 才收敛为 2 个值。按 §10 顺序（P0 先于 P1），在验收 P0 阶段 V4 必不成立。建议：V4 绑定到 P1-3，或在 P0 阶段把判据临时放宽为「行高值 ≤ 3 且不含 32」。

> [!WARNING]
> **V6 键盘可达判据没有对应的落地处方。** V6 要求 Tab 能聚焦星标、菜单。但 `SidebarProjectItem.tsx:349-369` 星标与 `:439-458` 改名/删除都是裸 `<div onClick>`，无 `role="button" tabIndex` / `onKeyDown`。P0-2 只把未收藏星 `:353` 的 `opacity-40` 改成 `opacity-0`（并靠 `group-focus-within` 保证键盘可见），P0-1 换成 ActionMenu 后菜单本身可达，但**星标仍不可 Tab**。V6 没有一条处方让它通过。建议：P0-2 处分明给星标补 `role="button" tabIndex={0}` 与 `onKeyDown`，否则 V6 要么降级、要么归入独立无障碍专项。

> [!TIP]
> **P0-1 处方依赖 ActionMenu 的 `icon` / `triggerClassName` / `size` prop，文档未先确认存在。** 我确认了 `isDanger / showDividerBefore / iconOnly / portal` 存在，但 `icon`、`triggerClassName`、`variant="ghost"` 是否透传、以及 portal 模式下 `isDanger` 是否在菜单内正确渲染，需先读 `ActionMenu.tsx` 确认，建议在实施第 3 步（P0-1）前把这三项纳入验证清单，避免处方落地时发现 prop 不齐。

> [!NOTE]
> **P0-2 后左侧会留下一列「空槽位点阵」，值得再权衡。** 保留 24px 槽位防文字横移是对的，但 12 个空槽在非 hover 时连成一列空白带，仍是一种视觉噪声（Q1 已有同类担忧）。折中不必只限「常驻 `opacity-20`」这一种：也可 hover 目标行时以淡金描边空星提示可加星，牺牲可发现性的同时保留槽位的「留白即待操作」语义。建议在 Q1 的裁决里给「槽位自身的视觉处理」单独一行。

> [!NOTE]
> **V2 未定义 hover 态是否计入「行底色」。** P0-2 后静态态是选中 / 普通 2 种，但普通行 hover 还有 `hover:bg-accent/50`（`:339`）、收藏行 hover `hover:bg-yellow-100/50`（`:343`），即非选中状态实际有 2 个悬浮态 / 2 种基色。V2 口径若只数静态背景则成立，若把 hover 也算进去则 ≥3。建议验收口径明示「以非 hover 静态背景计」。

### Codex · `doc-review-codex`

> 我抽查了 `SidebarProjectItem.tsx`、`SidebarProjectSessions.tsx`、`ActionMenu.tsx`、`SidebarModeTabs.tsx`，与方案关键行号基本一致。以下是在 Claude 批注之外补充的风险与处方缺口。

> [!WARNING]
> **P0-4 处方与实际代码变量不匹配。** 当前第二行不是 `{count}{' - '}{path}`，而是由 `getSessionCountDisplay` 返回 `String(total)`（`SidebarProjectItem.tsx:59-62`、`:109`），渲染处是 `{sessionCountDisplay}{...}{' - '}{path}`（`:401-406`）。处方里写的 `sessionCount > 0` 在现有组件中并不存在这个数值变量，直接照抄会找不到变量。建议改为基于数值来源（`project.sessionMeta?.total ?? sessions.length`）先计算数值，再做 `> 0` 判断与 `·` 文案替换。

> [!WARNING]
> **P0-1 的 ActionMenu 触发器缺少 `touch:opacity-100`，移动端「···」会不可见。** 现有改名 / 删除图标都带 `touch:opacity-100 ... group-hover:opacity-100`（`:440`、`:451`），处方里的 `triggerClassName` 只有 `opacity-0 group-hover:opacity-100 focus-visible:opacity-100`，没有触屏覆盖。触屏没有 hover，若不保留 `touch:opacity-100`，改名 / 删除入口在移动端可发现性会比现状更差。建议补上 `touch:opacity-100`，并把它纳入移动端验收。

> [!WARNING]
> **P0-3 处方对移动端「管理」按钮描述不足。** 移动 compact 的「管理」是 `Button variant="outline" size="sm" className="h-8 text-xs"`（`SidebarProjectSessions.tsx:304-312`），处方只笼统写「由 outline 改 ghost」，没有给出移动端完整 className 替换。建议与新建会话一起给出移动端两列的完整类名，并明确 `h-8` → `h-9` 是否同样应用，否则移动端行高仍停留在 32，窄屏下 V4 不会成立。

> [!TIP]
> **P0-1 的 aria-label 建议用项目级文案，而不是通用「更多」。** 一个项目行有星标、菜单、折叠等多个可聚焦控件；若菜单 trigger 的 aria-label 是 `t('search.modeMore', 'More')`，读屏用户会听到多个相同「更多」，难以区分上下文。`ActionMenu` 已支持 `ariaLabel` prop，建议传入项目级文案（如组合改名 / 删除的 tooltip），至少不要和模式条的「更多」共用同一标签。

> [!NOTE]
> **我抽查确认 P0-1 依赖的 ActionMenu props 均已存在。** `icon`、`triggerClassName`、`variant`、`size="sm"`、`portal`、`iconOnly`、`ariaLabel`、`showDividerBefore`、`isDanger` 都在 `ActionMenu.tsx` 的类型与实现中，Claude 批注里的验证清单可降为普通注意项。

> [!NOTE]
> **P0-4 还要覆盖 `sessionMeta` 缺失的兜底路径。** `getSessionCountDisplay` 取 `project.sessionMeta?.total ?? sessions.length`；若 meta 缺失且 sessions 为空，显示值也是 `"0"`。处方如果只判断某个单一来源的计数，可能漏掉这一分支。建议在处方里明确「以两个来源合并后的数值为准」再判断。

---

### 作者响应：作者（2026-10-28）

> 处置口径：逐条回到源码与渲染复核，不照单接受；区分「事实对但定性不成立」与「完全不成立」。§4 / §6.2 / §7 / §9 已按下表就地修订。

| # | 章节 | 一句话问题 | 作者响应 |
|---|---|---|---|
| A1 | §4 P0-3 | 未覆盖移动端 `:302`，且 `active:scale` 与 §6.2 冲突 | **采纳但修正处方**。移动端完整类名已补（`:302` / `:312-320`）；`active:scale-[0.98]` **保留**——同屏会话行 `SidebarSessionItem.tsx:251` 与项目行 `SidebarProjectItem.tsx:192` 都有该按压反馈，单独去掉一颗会变成唯一的「不跟手」按钮。§6.2 已改写为「不新增 hover 位移」，并写明按压反馈的豁免理由。 |
| A2 | §7 V4 | 与 P0-3（52/42/36）及 P1-3（统一 40）的执行顺序矛盾 | **采纳**。拆成 V4a（P0 阶段：取值 ≤ 3 个且不含 32）与 V4b（P1-3 后：= 2 个值），并注明 V4b 不参与 P0 验收。 |
| A3 | §7 V6 | V6 要求星标可 Tab，但 P0-2 只改透明度 | **采纳**。P0-2 增加第 3 条：`role="button" tabIndex={0}` + `onKeyDown`（Enter / Space）。这是原方案漏掉的落地处方。 |
| A4 | §4 P0-1 | ActionMenu 的 `icon / triggerClassName / variant` 未先确认 | **不采纳（前提不成立）**。`ActionMenu.tsx:10-39` 的类型定义里 `icon`、`triggerClassName`、`variant`、`size`、`portal`、`iconOnly`、`ariaLabel` 均在；Codex 独立复核同结论。§4 P0-1 已把出处补进行文。 |
| A5 | §9 Q1 | 保留 24px 槽会留下「空槽点阵」 | **部分采纳**。Q1 增加槽位处置分支（留白 / `opacity-20` / hover 出描边空星）；默认仍是留白——留白是负空间，与 12 个可见字形的噪声量级不同。 |
| A6 | §7 V2 | 未定义 hover 态是否计入「行底色」 | **采纳**。V2 明确以「非 hover 静态背景」计，并点名两条 hover 规则。 |
| A7 | §4 P0-4 | `sessionCount` 变量在组件里不存在，照抄会找不到 | **采纳**。处方改为 `const sessionCount = Number(sessionCountDisplay)`，复用 `getSessionCountDisplay`（`:59-62`）已合并的两个来源。 |
| A8 | §4 P0-1 | 触发器缺 `touch:opacity-100`，移动端会不可见 | **采纳处方、更正论据**。≤768px 其实不会隐身：`src/index.css:1196-1198` 在 `@media (max-width: 768px)` 内已把 `.group .group-hover\:opacity-100` 强制为 `opacity: 1 !important`。但 `isCompact` 由 `useCompactSidebar` 判定，桌面宽度下的触屏设备不在这条媒体查询内，故仍按现有两处按钮的写法补 `touch:opacity-100`。 |
| A9 | §4 P0-3 | 移动端「管理」缺完整类名，且未说明是否 `h-8 → h-9` | **采纳**，并**更正行号**：移动端「管理」在 `SidebarProjectSessions.tsx:312-320`，不是批注里的 `:304-312`——`:304` 是移动端新建会话按钮 `onClick` 体内的 `onNewSession(project)`。桌面 / 移动都改 `h-9`。 |
| A10 | §4 P0-1 | 菜单 aria-label 用通用「更多」，读屏无法区分上下文 | **采纳**。改为 `${project.displayName} · More`。 |
| A11 | §4 P0-4 | `sessionMeta` 缺失时可能漏兜底 | **采纳**。处方走 `Number(sessionCountDisplay)`，该函数本身就是 `Number(project.sessionMeta?.total ?? sessions.length)`，天然覆盖该分支。 |

**未被回应、仍在开放的问题**

- **Q4（收藏是否参与排序）— 已闭环，且原结论被推翻**：实施 P0-2 前的对照实测证明**会排序**：给第 7 位的「我的资料」加星后 2.5s 内它移到第 2 位，取消后顺序完全还原。上一轮按服务端 `ORDER BY` 判定「不排序」漏掉了前端 `sortProjects`（`sidebarProjectFormatting.ts:118-145`）。删黄底因此不是「删一条装饰」，而是「删一条与位置重复的分组提示」——分组由位置 + 金色实心星保留。§2.4 已改写为实测结论。
- **Q5 / Q6**：与 P1 绑定，本轮不动，留待 P0 落地后再讨论。

**修订范围声明**：本轮只改文档，未动代码。被改写的旧段落（P0-1 / P0-2 / P0-3 / P0-4 / §6.2 / V2 / V4 / Q1）已就地更新，原文不再保留；上方两位审阅者的批注原文完整保留，未做删改。

---

## 12. 实施记录（2026-10-28）

### 12.1 提交

| 提交 | 内容 |
|---|---|
| `34bbb83f` | P0-4 空项目不再显示「0 - 」 |
| `95b3804a` | P0-2 星标悬停显现 + 删收藏黄底（含行容器改造，见 12.3） |
| `9b6485b1` | P0-1 改名/删除收进「···」 |
| `1f0342c0` | P0-3 新建会话/管理去描边与卡片底 |

全部本地提交，未推送。改动面：`SidebarProjectItem.tsx`、`SidebarProjectSessions.tsx`、`projectRowClickSelection.test.tsx`（查询改成精确名，见 12.3）。

### 12.2 改后实测（288px 侧栏，真实数据库，Chromium）

| 指标 | 改前 | 改后 |
|---|---|---|
| 项目行尾部宽度 | 92（含红色删除） | **50**（有聚合徽标时 70） |
| 项目名可用宽度 | 117 | **145 / 165** |
| 行高 | 52 / 42 / 32 | 53 / 36 / 会话行未改 |
| 新建会话边框 / 底色 | `1px border-primary/25` + `bg-card` | `0px` + `transparent` |
| 非 hover 行底色种类 | 3 | **2**（选中 / 普通；四个主题组合实测一致） |
| 未收藏星标 opacity（静息 → hover） | 0.4 常驻 | **0 → 1** |
| 菜单触发器 opacity（静息 → hover） | 无 | **0 → 1** |

四组主题（kanagawa / tokyo-night × 浅 / 深）逐项数值一致，只是色值不同：kanagawa 浅 `rgb(225,223,205)` / `rgb(212,207,179)`，kanagawa 深 `rgb(31,31,40)` / `rgb(54,54,70)`，tokyo-night 浅 `rgb(225,226,231)` / `rgb(208,213,227)`，tokyo-night 深 `rgb(26,27,38)` / `rgb(41,46,66)`——每组都只有两个值。

主题 token 未改动，21 个外置主题无需跟进。

### 12.3 与方案的偏差（均为实现约束，非取舍）

1. **桌面行容器从 `<Button>` 改成 `<div>`，名字区单独包一个 `<button>`。** `ActionMenu` 的触发器是真实 `<button>`，而 `<button>` 里不能再放按钮；星标同时升级成 `role="button"`，也需要非按钮容器。整行点击、键盘展开（名字区按钮）、选中/hover 逻辑都不变；`projectRowClickSelection` 的三条断言全过。
2. **P0-4 复用已有的 `totalSessionCount`**，没有新增 `Number(sessionCountDisplay)`——两者同源（`project.sessionMeta?.total ?? sessions.length`），少一个变量。
3. **菜单触发器外包一层 `onClick={stopPropagation}`**：整行点击会切换展开，而 `ActionMenu` 不接收 `onClick`，只能在外层吞掉。已验证开菜单不会误折叠行。
4. **测试查询从 `/project two/` 改为精确 `'project two'`**：行的可访问名现在是项目名，菜单名是「项目名 · 更多」，正则同时命中两者。

### 12.4 验收结果

| 判据 | 结果 |
|---|---|
| V1 尾部 ≤ 3 个图标、标题 ≥ 140px | 通过（尾部 3 个：聚合徽标 / 菜单 / 箭头；标题 145–165） |
| V2 非 hover 行底色 ≤ 2 种 | 通过（四主题组合均为 2） |
| V3 星标静息 opacity 0、hover 1、文字不位移 | 通过（槽位保留 24px，名字 x 恒为 50） |
| V4a 行高 ≤ 3 个值且不含 32 | 通过（53 / 36 / 会话行原值） |
| V5 空项目不出现 0 | 通过 |
| V6 键盘可达 | 通过（星标、菜单触发器均可 Tab；菜单 Esc 关闭并归焦） |
| 侧边栏测试 | 22 文件 / 132 例全过（Node 22） |
| `tsc --noEmit` / `build:client` | 通过 |

### 12.5 未做（留给 P1）

- 移动端卡片仍常驻 红色删除 + 编辑 两个色块，且第二行仍是「0 sessions」——P0 的范围是桌面行，移动端没有 hover，改成菜单需要单独的交互决策。若要统一，属 P1-3「统一网格」一起做。
- 移动端「新建会话」文字左缘 43px，与桌面项目名 50px 差 7px，是 `ml-3 pl-3` 容器 + `px-3` 叠加的结果，同样留到 P1-3 对齐。

---

## 13. 实施后的校正（2026-10-28，用户反馈）

### 13.1 P0-3 改为「卡片行」，不是「无壳行」

上一轮把「新建会话 / 管理」改成 ghost + 透明底，实测观感是**悬空**：它下面是清一色的 `bg-card` 卡片行，上面是项目卡片，中间突然出现一行裸文字，右端的「管理」没有着落。方案里担心的「像第二个搜索框」其实是 `border-primary/25` 造成的，不是卡片本身。

现改为与会话行同一张卡：`rounded-md border border-border/30 bg-card p-0.5`，行高 42、宽 250，与会话行完全一致；强调色只留在加号上。移动端两列同步为 `rounded-lg` 卡片。

### 13.2 「···」新增「复制项目路径」

复制 `project.fullPath`（绝对路径），并沿用会话菜单的反馈方式：`closeOnSelect: false` + 标签翻成「项目路径已复制」+ 勾选图标，关闭菜单时复位。已实测剪贴板得到 `/Users/selier/Projects/open_projects/cloudcli`。15 个语言包均已补 `tooltips.copyProjectPath` / `tooltips.projectPathCopied`。

### 13.3 刷新后「新建会话」被吸顶行盖住

**成因**：项目行从 #1312 起是 `sticky top-0`，容器一滚动就把整个块的第一行（操作行 + 首条会话）盖在自己下面；而行尾的 `hover:bg-accent/50` 是半透明的，悬停时就透出下面的会话。刷新后之所以会停在这个位置，是因为用户的 `keepProjectsExpanded` 为 `true`（已在其 `auth.db` 的 `uiPreferences` 里确认），展开块从首帧就存在，浏览器恢复的滚动偏移可以直接落在块内部。

**处理**：
1. 吸顶外壳补 `bg-background`，半透明 hover 只与页面底色混合，不再透出下面的会话。
2. 新增 `useRevealPinnedBlockStart`：挂载后一帧内，如果某个展开块的表头正吸在容器顶端、而块自身的起点已被滚到顶端之上，就把滚动位置退回块起点——也就是用户手动「往上滚」的那一步。只作用于当前吸顶的那个块，只在挂载时执行一次，用户自己点击展开的块不受影响（那种情况由 `useExpandScrollAnchor` 负责）。

**未闭环**：headless Chromium 不会恢复嵌套滚动容器的偏移，所以「刷新后停在块中间」这一步无法在本机复现；上面的修正是按该状态构造并单测覆盖的（`revealPinnedBlockStart.test.tsx` 4 例）。若真机仍复现，下一步是把校正窗口扩到 `pageshow` 之后。

### 13.4 同一个问题的第二次修复：一次校正太早，等于没校正

用户复验：第三点仍在，「不管选中哪个会话，刷新后一定只剩块末尾那几条会话」。

**定位**（本机 Chromium 156 + 真实数据库快照，`/tmp/verify-sidebar`）：把侧栏滚到 300px 后，展开块的状态是 `blockTop = -300`、`headerTop = 0`——表头吸顶、块起点在视口上方，可见的正是最后 5 条会话。构造这个状态后观察，`useRevealPinnedBlockStart` **一次都没触发**。原因有两个，叠在一起：

1. **只校正一次，且时机太早**。挂载后的那一帧里，项目列表还没拿到 projects（实测 `count = 0`，blocks 为空），或者滚动偏移还没落地；`checkedRef` 随即置位，之后无论偏移多晚出现都不再看第二眼。
2. **偏移不是「首帧就有」的**。它由加载过程带进来（浏览器恢复、保存的展开集生效、会话首页到达），落在挂载之后。实测把偏移注入在 900ms，旧实现全程无反应。

**处理**：把逐项目的一次性钩子换成**列表级、带沉降窗口**的版本（`SidebarProjectList` 挂一次）：

- 窗口内按 0/60/160/320/700/1200/1800ms 复检，并监听容器的 `scroll` 事件——偏移以滚动形式落地时立刻校正，以布局变化落地时由定时器兜住。
- 仍然只处理**表头正吸在容器顶端、且块起点已在顶端之上**的那个块；块起点未越过顶端就 `break`（块按文档顺序排列）。
- 任何用户输入（`wheel` / `touchstart` / `pointerdown` / `keydown`）立即关闭窗口，之后偏移归用户；点击展开因此不受影响（`pointerdown` 先于 `click`，仍由 `useExpandScrollAnchor` 负责）。
- 窗口结束于挂载后 2s。DOM 侧只加了一个 `data-sidebar-project-block` 标记。

**验证**（真实构建 + 真实数据库快照，Chromium 1440×760，`keepProjectsExpanded=true` 从库里读到）：

| 场景 | 校正前 | 校正后 |
|---|---|---|
| cloudcli 展开，注入 offset 300（块内） | `scrollTop 300`，首行是第 5 条会话 | `scrollTop 0`，首行是项目行 + 新建会话/管理 |
| hapi（第 11 个块）展开，注入 offset 700 | `scrollTop 700`，块起点 -74px | `scrollTop 626`，块起点 0 |
| 无注入（对照） | `scrollTop 0` | 不变 |

**仍未闭环的一点**：真机浏览器的「刷新」是否恢复嵌套滚动偏移无法在自动化里验证——`page.reload()`（CDP）和 `window.location.reload()` 都不恢复，Playwright 也不能触发浏览器级 Cmd+R（页面标记仍在，说明没有真的重载）。所以上面的验证是**构造同一状态**（用户态快照 + 注入偏移）而不是复刻刷新本身；用户侧的实际偏移无论来自恢复还是加载过程，只要落在挂载后 2s 内都会被这个窗口接住。

**单测**：`revealPinnedBlockStart.test.tsx` 6 例（偏移挂在挂载后、已在顶端、块整体在视口上方、只校正吸顶的那个块、用户输入后停止、窗口结束后停止）。

### 13.5 触屏布局（≤767px）补齐 P0

用户反馈：「手机端你是不是没有适配？项目下没有 ···」。核对属实：`SidebarProjectItem` 有两套 DOM，`useCompactSidebar` 在 ≤767px 渲染触屏卡片，而 P0-1/P0-2 只改了桌面分支。手机上仍是原样——每张卡片右侧常驻一个红色删除和一个蓝色编辑，没有「···」。

**处理**（只动触屏分支，桌面分支的菜单项改为共用同一份定义）：

| 项 | 改前（触屏） | 改后 |
|---|---|---|
| 项目操作 | 红色删除 + 蓝色编辑，两个 32×32 常驻 | 一个「···」，常驻（触屏没有 hover 可用来揭示） |
| 菜单项 | 无 | 复制项目路径 / 重命名项目 / 从侧边栏移除项目 |
| 星标 | 常驻，未收藏灰底、收藏黄底方框 | 常驻，方框不再变黄；收藏状态只由黄色实心星表达，与桌面同理由（`sortProjects` 已把它排到前面） |
| 第二行 | `11 sessions`（硬编码英文，未 i18n） | `11 · ...open_projects/cloudcli`，与桌面同源同截断规则（`pathLabel`） |

抽出的 `projectMenuItems` 同时供两个分支使用，避免「桌面收进菜单、手机又长出两个图标」这种漂移。

**实测**（真实构建 + 数据库快照，Chrome 390×844、`isMobile`、`hasTouch`）：

- 每张项目卡片的「···」`opacity: 1`，`aria-label` 为 `项目名 · 更多`；
- 卡片内不再有 `lucide-trash2` / `lucide-edit-3` 按钮；
- 点开菜单得到三项：`复制项目路径`、`重命名项目 (F2)`、`从侧边栏移除项目 (Delete)`；
- 卡片高 66px，展开后操作行 282×42（两列），会话卡片紧接其下，纵向节奏未被打破。

`tsc` 干净，侧栏 23 文件 / 138 例全过，`oxlint` 仅剩既有的 classnames-order 警告。
