# DOM 锚点分级（写选择器前必读）

用户 CSS 主题的选择器是**运行时**生效的：绑错了不报错，只会「某些地方没变」或
「某些地方不该变却变了」。所以每写一条，先问它落在哪一级。

行号是写作时的定位起点，会随重构漂移——以「谁写的」为准，别以行号为准。

## 一级：契约面属性（可信）

| 锚点 | 谁写 | 说明 |
|---|---|---|
| `html.dark` | `ThemeContext.tsx` `classList.toggle('dark', …)` | 深色外观。**`dark` 类在 `<html>` 上，不是 `<body>`** |
| `html[data-theme="…"]` | `ThemeContext.tsx` `documentElement.dataset.theme` | 值是 `resolvedThemeId`。完整取值见 `src/shared/constants.ts` 的 `BUILTIN_THEMES`（`cc-*` 的内置项 ＋ 用户主题的 `user-<name>`） |
| `html[data-appearance="light\|dark"]` | `index.html` 内联脚本 | **只在首帧**——挂载后不再维护，改由 `style.colorScheme` 表达 |
| `[data-user-anchor]` | `LazyMessageRow.tsx` | 懒加载消息行的 wrapper |
| `[data-message-timestamp]` | `MessageComponent.tsx` | 消息行 wrapper。**在 `LazyMessageRow` 的里层，两者不是同一级** |
| `[data-slot="prompt-input"]` | `PromptInput.tsx` | 输入框根元素 |
| `[data-slot="activity-tab"]` | `ActivityIndicator.tsx` | 输入框上方「推理中…」/「停止」两个标签。出厂是**接在输入框上沿的一体框**（直角下沿、无下边线）；主题改它必须连 `--activity-tab-overlap` 一起设：输入框边宽多少就压多少（`0` 或负值 = 改成独立浮块） |
| `[role="separator"]` | 侧栏拖拽柄 | 侧栏宽度拖拽 |

## 拼接面的聚焦态：必须自绘（**无守卫，漏写静默**）

`[data-slot="activity-tab"]` 是 `[data-slot="prompt-input"]` 的**兄弟节点**（绝对定位在
`bottom-full`，见 `ChatComposer.tsx`）——**吃不到输入框的 `:focus-within`，也没有可用的
类钩子**。于是：**任何用 `!important` 静态钉死标签 `border-color` / `box-shadow` 的主题，
输入框聚焦时外观一变，标签就静止不动**，接缝处从"加粗/变色的框"掉回"原样的细线"，很显眼。

出厂组件本有聚焦分支（`ActivityIndicator.tsx` 收到 `isInputFocused` 就换类），但主题的
`!important` 静态值会**反过来盖掉它**（`!important` > 工具类）——**这条无守卫、漏写不报错。**
修法是从祖先侧感知焦点、自己把变化画回来：

```css
:root:has([data-slot='prompt-input']:focus-within) [data-slot='activity-tab'] {
  /* 值与同主题输入框的 :focus-within 对齐 */
  border-color: hsl(var(--ring) / 0.9) !important;
  box-shadow: 0 0 0 3px hsl(var(--ring) / 0.25) !important;
}
```

三个要点：
- **`:has()` 一定可用**：用户主题是 raw `textContent` 注入（`userThemeStyles.ts`），不经任何
  处理，`:has()` 原样交给浏览器求值。
- **底边不用管**：标签自带的 `.chat-activity-tab { clip-path: inset(-8px -8px 0 -8px) }`
  （`src/index.css`）会把环的**下半圈裁掉**，所以可放心用完整的 `0 0 0 Npx` spread ring
  ——不会在输入框里留一道横线。
- **跟的方式照抄输入框**：有的主题聚焦是"加粗"（加 ring），有的是"位移"（如 `neubrutalism`
  整块下压 3px）——标签要跟着做**同一个**变化，不只是加环。

> **内置主题不受此坑影响**：`index.css` 的 `cc-*` 是纯令牌、不覆盖这两个 slot，走组件自带
> 的聚焦分支。

## 二级：结构性类名（组合后唯一）

| 锚点 | 来源 | 说明 |
|---|---|---|
| `.fixed.inset-0.flex.bg-background` | `ProjectWorkspaceShell` | 工作区壳。三个类一起才唯一——移动端抽屉也是 `fixed inset-0 flex`，**`bg-background` 才是那个区分点** |
| 壳的 `> .flex-1` | 同上 | 主区。**必须用 `>` 直接子**，否则会命中内容里任意 `flex-1` |
| 壳的 `> .flex-shrink-0.border-r` | `ProjectSidebarRegion` | 侧栏。同理必须限定直接子（见「会误伤的坑」） |
| `.chat-messages-pane` | 聊天面板 | 滚动容器 |
| `.chat-message` / `.chat-message.user` | `MessageComponent.tsx` | 消息行；`.user` 是用户那一侧 |
| `.chat-message .prose` / `.markdown-code-block` | 消息正文 | 正文与代码块 |

## 三级：Tailwind 工具类名（会用，但会失配）

用它就要接受「下次重构可能绑不上」：

- 气泡：`.rounded-2xl.rounded-br-md` + `border-border/60` + `bg-muted/60`
- 用户头像：`.rounded-full.bg-blue-600`（**硬编码的 Tailwind 蓝，不走任何令牌**）
- `header.pwa-header-safe` / `div.pwa-header-safe`：**标签不统一**，见 SKILL.md 陷阱 2

## 会误伤的坑

```css
/* ✗ 子串匹配：命中 border-red-200、border-r-n-gray-900 */
[class*='border-r'] { border-right-color: …; }

/* ✓ 整词匹配 */
[class~='border-r'] { border-right-color: …; }
```

```css
/* ✗ 设置弹窗左栏也是 flex-shrink-0 + border-r，会被当成第三张卡 */
[class~='flex-shrink-0'][class~='border-r'] { … }

/* ✓ 限定工作区壳的直接子 */
[class~='fixed'][class~='inset-0'][class~='flex'][class~='bg-background']
  > [class~='flex-shrink-0'][class~='border-r'] { … }
```

**验证误伤的唯一办法是把反例一起测**——一个过宽的选择器在只看正例时完全正常。
反例清单见 `verification.md` 第 3 条。

## 布局杠杆

| 效果 | 怎么做 |
|---|---|
| 全站圆角 | 改 `--radius`（`rounded-*` 全派生自它）。真圆形（头像 / 状态点 / 进度环）要保住：`[class*='rounded']:not([class*='rounded-full'])` |
| 内层跟着外层同色 | 内层大量元素本就是 `bg-background`，改外层背景即自动一致——**别逐个改内层**，那是白干的活 |
| 浮岛 / 台面 | 壳降级成台面色，两张卡各给 `bg-background` + 1px 边框 + 壳上 `padding` 与内层 `margin-left` 制造缝 |
| 字体 | `--ui-font-family` 是 `useFontSettings.ts` 写进 `<html>` 的 **inline style**，样式表压不过 → 动字体只能靠选择器 + `!important` |
| 窄屏隔离 | 与 `isMobile` 阈值对齐用 `@media (min-width: 768px)`，否则移动端会跟着变形 |
