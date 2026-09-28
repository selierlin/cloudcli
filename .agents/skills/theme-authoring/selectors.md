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
| `[role="separator"]` | 侧栏拖拽柄 | 侧栏宽度拖拽 |

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
