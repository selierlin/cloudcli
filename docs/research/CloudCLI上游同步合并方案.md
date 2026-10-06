# CloudCLI 上游同步合并方案（upstream/main → cloudcli-dev）

> **状态**：**两轮审阅已回写（2026-10-06）；用户已批准**。尚未执行任何合并，工作区未改动（仅新增本文档）。
> **用途**：本文档是本次 `fork-sync`（main-first 模式）的处置方案，供多个 AI / 人 交叉审阅后再落地。
> **审阅对象**：第 4 节的分组处置（尤其 4.2 乙组 11 项）与 §7 的十问清单（两轮均已给结论，见 §7.1 / §7.2）。
> **取证环境**：dry-run worktree `/tmp/cloudcli-sync2.KTHw0h`（分支 `sync-preview`，停在冲突状态）。可只读检视。
> **行号基准**：**除注明外，文中行号一律指 dry-run worktree（冲突态）**；主仓 HEAD（`cloudcli-dev`）的行号会不同（第一轮审阅已有两处因取错树而误报，见 §7.1 #9/#12）。落地时按**符号**定位。
> **可复算命令**：见附录 A（含 i18n key diff 脚本与基线）。
> **已变更（第一轮）**：§3（46 UU + 1 AA）、§4.1.1（D1 拆除面补全 + 拆除序 + 消费方订正）、§4.2 B1/B2/B3/B5/B7/B11、§4.3 C6、§4.4-5（key diff 门禁与真实基线）、§5（新增步骤 0）、§6（+i18n/+冒烟 2 项）、§7.1（审阅响应表）。
> **已变更（第二轮）**：§4.1.1-⑦（D1 第四处拆除面：`sidebarRowProps.test.tsx` 两处 harness）、§4.1.2-3（D2 Escape 改采上游 capture 机制）、§4.2 B3（连带改上游测试断言）、§5 步骤 0（(19~21) 措辞订正）、§7.2（第二轮响应表：十问全部给结论）、§8.2（themeMode 语义变化记账）。**十问已全部收敛，无遗留待决。**

---

## 1. 背景与同步范围

| 项 | 值 |
|---|---|
| fork | `selierlin/cloudcli`（`origin`，SSH 推送） |
| upstream | `siteboon/claudecodeui`（本次经 SSH 拉取；https 走代理到境外 TLS 断，见 §8.3） |
| 同步基点 `<BASE>` | `6c51fcaa` |
| 基点性质 | **= 本地 `main` = `origin/main`，且是 `upstream/main` 的祖先** ⇒ 本地 `main` 未含 fork 自有提交，可 fast-forward |
| 上游目标 | `upstream/main` HEAD = `dc7cb6c6`（2026-09-28） |
| 上游新增 | **18 提交 / 168 文件 / +11950 −530** |
| fork 侧分叉 | `cloudcli-dev` 相对基点 **518 提交 / 918 文件 / +130312 −5956** |

同步模式为 **main-first**：① `upstream/main` → 本地 `main`；② `main` → `cloudcli-dev`。

### 1.1 上游新增功能（18 提交，按功能归类）

| 功能 | 提交 |
|---|---|
| 新增捷克语 locale（`cs/`，含 `languages.ts` + `config.ts` 注册） | `7fb91f00` |
| Codex 新增 GPT-6 Sol / GPT-6 Luna 模型 | `48c8ae4c` |
| Source Control「工作区 vs 任意分支」对比（新 `git-panel/compare/*`、`useBranchCompare`、服务端 `git-branch-diff.service`） | `a2ed7f3c` |
| 快捷设置面板改版：Settings/Commands 标签页 + 可停靠 | `9212ee33` |
| 双击会话标题重命名 | `09892b57` |
| API key 绕过 Claude 订阅登录时告警 | `c6468e13` |
| 会话显示 resume 将回放的分支 | `d1b09330` |
| Tab 补全（而非执行）斜杠命令 | `eef9791e` |
| 助手消息渲染 `\(…\)` / `\[…\]` LaTeX | `de0908b0` |
| 折叠工具组在流式 tick 间保持 memo | `3576232e` |
| 每条助手回复标注回答模型（新 `MessageModelLabel`） | `7f4eba78` |
| **主题跟随操作系统外观**（`themeMode` 重构） | `87c44f58` |
| Claude CLI 驱动的轮次报告为 running（新 `claude-cli-liveness.service`） | `3cc73ede` |
| 侧边栏批量选择并删除项目内多条会话 | `f34ac834` |
| 桌面端最大化后视图尺寸修复 | `4cd470fa` |
| 代码编辑器丢弃未保存改动前确认 | `05b63060` |
| @ 文件下拉每次打开重取列表 | `fce5c2e7` |
| 停止 token 刷新/语言切换导致 app 重挂载 | `dc7cb6c6` |

### 1.2 依赖变化

`package.json`：`@openai/codex` `0.153.4` → **`0.156.1`**；`@openai/codex-sdk` `^0.153.0` → **`^0.156.0`**。
⇒ 合并后必须 `npm install`（`package-lock.json` 亦在上游 diff 内）。

---

## 2. 已拍板事项（用户 2026-10-06 决定）

| 编号 | 议题 | 裁定 |
|---|---|---|
| **D1** | 侧边栏「项目会话批量选择」 | **方案 A：保留 fork 的 Manage 模式**（跨 3 列表统一 UX），拒绝上游 #1404 的 `isSelecting` 系；但**移植上游那条更正确的运行态规则**（见 §4.1.1） |
| **D2** | 快捷设置面板浮层的遮罩 | **取上游的 `isPinned` 停靠能力，但浮层分支沿用 fork 的「不加遮罩 + 宽面板」**；关闭逻辑只保留 fork 的 outside-click（删上游 Escape-capture），避免两套关闭逻辑并存 |
| — | 乙组（§4.2，11 项真语义冲突） | **逐个审**：本文档给出倾向方案，审阅者逐项确认或改判 |

---

## 3. 冲突总览

- **冲突①（upstream → `main`）：0 个冲突**（fast-forward）。
- **冲突②（`main` → `cloudcli-dev`）：47 文件 / 93 冲突块** = **46 `UU`（改/改）+ 1 `AA`（add/add）**；唯一 add/add 是 `server/modules/providers/tests/codex-models.test.ts`。
  （复算：`git status --porcelain | awk '$1 ~ /^(U|A|D)/'` ⇒ 46 `UU` + 1 `AA`。）

按处置方式分三组：

| 组 | 文件数 | 性质 | 章节 |
|---|---|---|---|
| **甲组** | 6 | 已拍板的产品级二选一（D1/D2） | §4.1 |
| **乙组** | 11 | 真语义冲突，需逐项裁定 | §4.2 |
| **丙组** | 6 | 机械并集 / 取一侧，无判断空间 | §4.3 |
| **i18n** | 24 | 键并集 + 去重 | §4.4 |

---

## 4. 分组处置方案

### 4.1 甲组：已拍板的产品级二选一（6 文件）

#### 4.1.1 D1 — 侧边栏批量选择（5 文件）

**牵连文件**：`src/modules/sidebar/SidebarSessionItem.tsx`(8 块)、`SidebarModals.tsx`(5)、`SidebarProjectSessions.tsx`(4)、`hooks/useSidebarController.ts`(2)、`Sidebar.tsx`(1)。

**裁定：保留 fork 的 Manage 模式。** 具体规则：

1. **这 5 个文件一律取 fork（HEAD）侧**，丢弃上游 `isSelecting` / `isChecked` / `onToggleSessionSelected` / `effectiveSelectedIds` / `checkedSessionIds` / `selectAllLabel` 等选择设施。
2. **连带清理（非冲突区也需动）**：上游 #1404 的选择设施不只在冲突块内 ——
   - `SidebarProjectSessions.tsx` 261–318 的「Select 工具条」（上游侧）需删；
   - `SidebarSessionItem.tsx` 131–156（`isSelectable`/`toggleSelected`/`handleSelectionKeyDown`/`selectionIcon`）、199–202、471–473、524 等自动合入的上游选择代码需删；
   - 上游新增测试 `src/modules/sidebar/tests/sessionBulkSelection.test.ts` 应一并移除（或隔离）。

   **⚠️ 审阅补全（ZCode，已复核）——拆除面比上面三条更大，另有三处不在冲突块内**：
   - ④ `Sidebar.tsx:265–269`（**自动合并区**）把 `sessionSelection` + `onSetSessionSelection`/`onToggleSessionSelected`/`onCancelSessionSelection`/`onDeleteSelectedSessions` 传给 `SidebarProjectList`。注意 `Sidebar.tsx` 的唯一冲突块在 **287–296**，取 fork 侧**不会**自动消掉 265–269；
   - ⑤ `SidebarProjectList.tsx:47, 86`（上游改过的**非冲突**文件）消费 `sessionSelection?.projectId`；
   - ⑥ `useSidebarController.ts` 内部：`:127` state、`:131` ref（`sessionIdsBeingDeletedRef`）、`:1055–1153` 的删除确认流程、`:1581` 返回值出口，连带 `setProjectSessionSelection`(`:1032`)/`toggleSessionSelected`/`cancelSessionSelection`(`:1051`)/`showDeleteSelectedSessionsConfirmation` 等派生回调。
   - ⑦ **（第二轮补）** `src/modules/sidebar/tests/sidebarRowProps.test.tsx`（双改**自动合并区**）里有**两处** harness 构造了五个选择 props：`:65` 形参 + `:102–106` 字段，**以及 `:255–258` 的第二处**（ZCode 只点了前者，已复核补全）。拆掉 `SidebarProjectList` 的选择设施后该测试会编译失败，**两处都要清**。

   **拆除顺序（照此序，否则 `Sidebar.tsx` 处会编译失败、执行者被迫临场发挥）**：
   先拆叶子（`SidebarProjectList` 的 props、`Sidebar.tsx:265–269` 的传参）→ 再拆 hook 内部流程（`:1055–1153` 及其派生回调）→ 最后删 state/ref（`:127`/`:131`）与返回出口（`:1581`）。
3. **移植上游更正确的运行态规则**：上游 `isSessionRunning = active && !background`（后台工作会话**可选**，与单行删除规则一致），fork 原为 `!activeSessions.has`（后台工作会话**不可选**）。裁定为**采用上游规则**，作为独立小改动并入 fork 的 `selectableSessionIds` 计算。
4. **保留 fork 的 pin 相关正交改动**：`SidebarSessionItem.tsx` imports 的 `Pin/PinOff`、`<SessionOptions>` 的 `isPinned/onTogglePinned`、行 261–267 的 pin 徽标（已自动合入）**必须保留**。
5. `useSidebarController.ts` 的 2 块是**正交 state**（fork 的 `batchSessionArchiveConfirmation` / `batchArchivedSessionDeleteConfirmation` vs 上游的 `sessionSelection` / `sessionIdsBeingDeletedRef`）⇒ 取 fork 两个 state，删上游 `sessionSelection` / `sessionIdsBeingDeletedRef`。
   **消费方归属订正（ZCode，已复核）**：`batchArchivedSessionDeleteConfirmation` 的**直接消费者是 `SidebarModals.tsx`（`:29/:75/:268` 等）＋ hook 内确认流程（`:120/:1279–1303`）＋ `Sidebar.tsx`（`:147/:291`）**；`SidebarContent.tsx` 中**没有**该符号 ——「不可删」的结论成立，但**原稿写成「被归档列表（`SidebarContent`）使用」是错的**，据此订正。
6. `SidebarModals.tsx` 取 fork 的两个弹窗（`batchSessionArchiveConfirmation` / `batchArchivedSessionDeleteConfirmation`），删上游 `pendingDeletion?.kind === 'sessions'` 弹窗；`Sidebar.tsx` 的 `SidebarModals` props 取 fork 的 6 个 batch 回调。

> **代价（如实记录）**：主动放弃上游官方实现 ⇒ **每次后续同步都会在这 5 个文件重复冲突**。建议在 `docs/` 或 `AGENTS.md` 登记「已裁决：保留 fork Manage」，避免下次重新讨论。

#### 4.1.2 D2 — 快捷设置面板浮层（`QuickSettingsPanelView.tsx`，3 块）

**裁定：以上游架构为骨架（props + `useQuickSettingsPanelState` + `isPinned` 停靠 + Commands 标签页），浮层分支沿用 fork 的「不加遮罩 + 宽面板」。**

预期目标形态（示意，需按合并后实际符号落定）：

1. **块 1（imports）**：取并集
   `import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';`
2. **块 2（组件头部/状态）**：**手工重建**。
   - 保留上游：`props { selectedProject, onInsertCommand }`、`useQuickSettingsPanelState`（`isOpen/isPinned/activeTab/selectTab/togglePin/close/toggle`）、`QuickSettingsTabs` / `QuickSettingsCommandsTab`。
   - 回植 fork：`useSessionOutlineData`、`QuickSettingsOutline`、`exportExpanded`、`handleJumpToMessage`；并保留 **fork 版 `QuickSettingsContent` 的调用签名**（`messages/sessionTitle/selectedProject/exportExpanded/isLoading`），**不要用上游的 `isDarkMode/preferences` 调用**。
   - **删除**上游引入的 `quickSettingsPreferences` / `handlePreferenceChange` 段落（当前自动合并态已引用不存在的符号，属残缺态）。
   - `activeTab` 取值域扩为 `'settings' | 'outline' | 'commands'`。
3. **块 3（渲染外壳）**：**手工合并**。
   - 采用上游 `isPinned ? 停靠列 : 浮层` 的分支；
   - 浮层分支用 fork 的宽 `w-80` + `paddingTop: safe-area` + **不加遮罩**；
   - **Escape 关闭（第二轮改判，ZCode）**：**不要**照原稿「删上游 capture、留 fork 冒泡」——fork 的 Escape 处理器（worktree `:194–195`，挂在 `document` **冒泡相**）会**输给** chat 的 capture-phase abort-on-Escape 与编辑器的 close-on-Escape（上游注释在 `:117–120` 明说），出现「关面板 + 中止流式」双触发。改法：**保留一条关闭逻辑但换成上游的 capture 机制**（`window` capture + `event.defaultPrevented` 守卫，回调里调 fork 的 `setIsOpen(false)`），既无两套逻辑并存、又保住优先级语义；fork 的 outside-click（`mousedown`）保留。
4. **连带改动（非冲突区，缺则编译失败）**：
   - `src/shared/types.ts` 的 `QuickSettingsTab` 加入 `'outline'`；
   - `src/modules/quick-settings-panel/QuickSettingsTabs.tsx`（上游硬编码只列 settings/commands）手工加 outline 项；
   - `useSessionOutlineData.ts:7` 有一个**同名局部类型** `type QuickSettingsTab = 'settings' | 'outline'`，与 `shared/types` 撞名 ⇒ 需归一为引用 `shared/types`；
   - `QuickSettingsPanelHeader`（已自动合并为上游版，要求 `isPinned/canPin/onTogglePin/onClose`）与 `ProjectQuickSettingsRegion`（上游新文件，以 props 调用面板）**已定型**，本方案与之相容；
   - i18n：`quickSettings.tabs.outline` 键已在 fork 侧存在（不在冲突块内），保留。

---

### 4.2 乙组：需逐个审的真语义冲突（11 项）

> 每项给出「冲突本质 / 倾向方案 / 连带动作 / 验收」。**审阅者请逐项确认或改判**，并在第 7 节记录结论。

#### B1. `src/shared/context/ThemeContext.tsx`（7 块）★枢纽

**冲突本质**：两侧把**同一条「外观模式」轴**写了两遍。
- fork：`theme: 'light'|'dark'|'system'` state（先读 `localStorage['theme']`，再读偏好镜像），并叠加**覆盖层主题** API（`themeId`/`resolvedThemeId`/`userThemes`/`themeFallback` + `userThemeStyles`/`userThemePastes`/`userThemes` subscriptions）。
- 上游（#1393）：把 `theme` 重构为 `themeMode` + `setThemeMode`，新增文件内 helper `readStoredThemeMode()`（`:96`）与 `resolveIsDarkMode()`（`:106`），并让 `system` **持续跟随 OS**（订阅回调改为重读存储、媒体查询分支用 `readStoredThemeMode()`），`ThemeMode` 类型在 `src/shared/types.ts:1802`。

**关键事实**：`readStoredThemeMode` 只读偏好镜像（`readUserPreference('theme')`），而 fork 是「先 `localStorage['theme']` 再镜像」；两者**指向同一存储**（fork 的 `writeUserPreference('theme', …)` 与上游一致）⇒ **无数据迁移问题**。fork 的 `theme` 与上游的 `themeMode` **取值域完全相同**。

**倾向方案：以上游的 `themeMode`/`setThemeMode`/`readStoredThemeMode`/`resolveIsDarkMode` 为唯一模式状态，fork 的覆盖层 API 原样保留在其上。**

逐块落定：
| 块 | 行号（worktree） | 处置 |
|---|---|---|
| 1 imports | 12–35 | 并集：fork 的 constants/authToken/types/userTheme* imports + 上游 `ThemeMode` 类型 |
| 2 `ThemeContextValue` | 64–84 | 并集：`themeMode`/`setThemeMode` + fork 的 `themeId`/`resolvedThemeId`/`setThemeId`/`userThemes`/`themeFallback` |
| 3 state 声明 | 171–204 | **取上游**（`themeMode` + `isDarkMode` via `resolveIsDarkMode`），**删 fork 的 `theme`/`setThemeState`** |
| 4 订阅回调 | 401–428 | **执行期改判（用户裁「方案 B」）**：不取上游回调体。上游的「无条件下沉到达的 mode」会抹掉 fork 的 sticky-`system`（B2 保留了断言它的测试），二者互斥 ⇒ 保留 fork 语义、按 `themeMode` 命名改写（见 §8.4 ①）；**拼回** fork 的 `setThemeIdState(readUserPreference('themeId', null))` 与 `applyUserThemeStyle` effect |
| 5 媒体查询分支 | 484–491 | **取上游** `readStoredThemeMode() === 'system'`，依赖去掉已删除的 `theme` |
| 6 `setThemeMode` / `toggleDarkMode` | 511–549 | = 上游 `setThemeMode` + fork `setThemeId` + 上游版 `toggleDarkMode` |
| 7 value 对象 | 554–580 | 并集：fork 五个覆盖层字段 + 上游 `themeMode`/`setThemeMode`（+ `toggleDarkMode`/`isDarkMode`） |

**⚠️ 子决策（需审阅者确认）——`theme`/`setTheme` 是否保留为薄别名？**
- 事实：全仓 `theme`/`setTheme` 的消费者**只有 1 处**：`src/shared/ui/ThemeModeSelector.tsx:15`（`const { theme, setTheme } = useTheme();`）。
- 选项 **i（推荐，最干净）**：**不保留别名**，改 `ThemeModeSelector.tsx:15` 为 `const { themeMode, setThemeMode } = useTheme();`，并把 `theme === value` / `setTheme(value)` 相应改名（该文件另有局部 `type ThemeMode = 'light'|'system'|'dark'`，需处理同名）。
- 选项 **ii（最小改动）**：在 value 里把 `theme`/`setTheme` 作为别名再暴露一次 ⇒ 不动 `ThemeModeSelector`，但**同一概念留两个名字**，是未来漂移源。
- 理由倾向 i：避免一个状态两个名字（与仓库既有「同一概念不留双名」的取向一致）。

**审阅结论（已复核）**：
- **块 4 依赖 `[theme]`→`[]` 安全**：Claude 曾提 stale-closure 风险，ZCode 实证收敛——拼回的两段中 `setThemeIdState(readUserPreference('themeId', null))` 纯重读存储、无响应式引用；`applyUserThemeStyle` 是**模块级 import**（worktree `:17`），其响应式依赖挂在独立 effect 的 `[applyTarget, userThemeState.status]`（`:421`）上，不受订阅回调依赖影响。唯一引用响应式 `theme` 的代码（fork 的 `savedTheme` 分支）恰是按方案被丢弃的半段。**落定时保持「拼回段只走重读存储」形态即可，不必补依赖。**
- **消费者清点要按全文搜，不能只靠行号**：`theme`/`setTheme` 的组件消费者确为 `ThemeModeSelector.tsx:15`（`:39` 调用 `setTheme(value)`）；**测试侧还有 `result.current.theme` 断言**（见 B2）。选选项 i 时按 `result.current.theme` **全文搜**。

**连带动作**：`src/shared/tests/themeContext.test.tsx`（见 B2）。

**验收**：`useTheme()` 同时能取到 `themeMode`/`setThemeMode` 与 `themeId`/`resolvedThemeId`/`userThemes`/`themeFallback`；`system` 在 OS 变化时翻转；覆盖层选中的主题在明暗切换后仍生效。

#### B2. `src/shared/tests/themeContext.test.tsx`（4 块）

**冲突本质**：不是测试打架，而是 **B1 实现的影子**。两侧各自新增整段测试：
- fork：overlay（`themeId`/`userThemes`/`themeFallback`）+ 浏览器 chrome（`dataset.theme`、`color-scheme`、`theme-color`/status-bar/favicon）+ 一处 `result.current.theme === 'system'`（`:310`）。
- 上游：`themeMode`/`setThemeMode`、跟随 OS（`changeSystemAppearance`）、未知存储值回落 `system`。

**倾向方案：两侧测试全部保留**，并：
| 块 | 行号 | 处置 |
|---|---|---|
| 1 imports | 5–9 | 取 fork（需 `vi`，用于 `vi.spyOn(console,'warn')`） |
| 2 helpers | 30–86 | 并集（fork 的 `ensureChromeMeta`/`chromeContent`/`ensureFaviconLink` + 上游的 `emulateSystemDarkAppearance`/`changeSystemAppearance`） |
| 3 `beforeEach`/`afterEach` | 94–107 | 手工并集：`beforeEach` 保 fork 5 条 + `emulateSystemDarkAppearance(false)`；保留上游那个 `afterEach`（恢复 `matchMedia`）与 fork 的 `vi.restoreAllMocks()`（vitest 允许多个 `afterEach`） |
| 4 测试主体 | 163–422 | 两侧全保留 |

**依赖**：只有当 B1 按选项 i 或 ii 露出对应 API 时才成立；若 B1 走选项 i，则 fork 侧 `result.current.theme` 断言需改为 `themeMode`。

**⚠️ 行号按树分辨（已复核）**：该断言在 **dry-run worktree（冲突态）= `:310`**，在**主仓 HEAD（fork，`cloudcli-dev`）= `:264`**。Claude 批注称「实际在 `:264`」，实际是**读的主仓 HEAD**，与本文档声明的「worktree 行号」不是同一棵树 —— **两者都对，但要按树读**；真正落地时是合并后形态，行号必然再漂移，**一律按符号定位**。

**⚠️ 另需确认（非冲突区）**：基点测试「`a theme arriving from the store is applied without being written back`」在自动合并区被 fork 的实现替换**静默吃掉**（合并后已不存在）。请确认这是 fork 的有意替换，而非合并丢失。

#### B3. `src/modules/chat/hooks/useSlashCommands.ts`（4 块）

**冲突本质**：上游把「命令拉取」抽成共享 hook（`shared/hooks/useProjectSlashCommands.ts`，供 chat 与 quick-settings Commands 标签页共用）；fork 把命令用量存储从 `localStorage`（`safeLocalStorage`）迁到服务端同步的 `userSettings`（`readCommandUsage`），并加了 **`skillScopeToNamespace`**（按 scope 映射 project/user/skill 命名空间）。

**倾向方案**：
| 块 | 处置 |
|---|---|
| A imports(4–14) | 手工并集：保 fork 的 `userSettings` + 取上游 `useProjectSlashCommands`；**删** `api`（拉取已进 hook）、**删** `safeLocalStorage` |
| B 类型/历史函数(42–77) | **两边都不留**（fork 删了 localStorage 历史函数，上游把类型搬进 hook） |
| C 本地 helper(83–135) | **取上游（删本块）**，但**必须把 fork 的 `skillScopeToNamespace` 移植进 `src/shared/hooks/useProjectSlashCommands.ts`** 并在其 `mapSkillToSlashCommand` 里使用（上游写死 `namespace: 'skill'`，直接采用会**丢掉 fork 的命名空间特性**）；**不要**保留本地 `isSkillCommand`（`:16` 已从 `@/shared/utils` 导入） |
| D `slashCommands` 定义(216–287) | **手工合并**：取上游 `useMemo` 结构（块外 211–215 已落位），把历史来源换成 fork 的 `readCommandUsage()` 排序；丢弃 HEAD 的 `fetchCommands` 体 |

**注意**：`eef9791e` 的 Tab 补全（510–545）**未冲突**、已自动合入，保留。

**审阅补记（Claude，已复核并按 worktree 订正行号）**：
- **B3 与丙组 C3 有隐含顺序依赖**：本块要删的**本地** `isSkillCommand`（worktree `:84`）之所以能删，是因为 C3 保留了上游在 `shared/utils` 新增的 `isSkillCommand`，而本文件 `:16` 已 `import { isSkillCommand } from '@/shared/utils'`。**若 C3 落地时丢了 `shared/utils` 的那一段，B3 会直接编译失败** ⇒ §5 的执行顺序里须写明该依赖（当前 C3 在 B3 前属**巧合而非设计**）。
- **两处调用点在冲突块之外**：worktree `:386` / `:408`（Claude 批注写 `:342`/`:364`，那是**主仓 HEAD** 的行号）。已核签名一致、语义相同，**删本地定义后这两处不要顺手改写**。

**第二轮改判（ZCode）——执行期实证：前提为误，本项作废**：ZCode 称上游自带测试 `src/shared/tests/useProjectSlashCommands.test.tsx:65` 的 `review.namespace === 'skill'` 在移植 `skillScopeToNamespace` 后必挂。实际 `:65` 断言的对象是 `scope: 'plugin'` 的 `/review`，而 `skillScopeToNamespace('plugin')` **兜底返回 `'skill'`**（`src/shared/hooks/useProjectSlashCommands.ts:56–64`）；夹具里那个 `scope: 'user'` 的 `/commit` **没有 namespace 断言**。移植后实测该文件 **5/5 通过**，**测试无需改写**。⇒ 详见 §8.4 ②，本段作废。

**验收**：skill 命名空间仍生效；命令用量排序仍跨设备同步；Tab 仍补全不执行。

#### B4. `src/modules/chat/hooks/useFileMentions.tsx`（2 块）

**冲突本质**：上游 `fce5c2e7` 抽出 `loadProjectFiles`（自持 AbortController ref），供「初次加载」与「下拉打开时重取」两条路径复用；fork 在初次加载 effect 里内联 fetch 并加了「隐藏路径排最后」排序。fork 侧引用的 `abortController` 在该作用域**已不存在 ⇒ 照字面取 HEAD 会编译失败**。

**倾向方案**：
- 块 A（50–65，helper）：**两者都留**（fork `isHiddenMentionPath` + 上游 `haveSameFiles`）。
- 块 B（122–149，初次加载）：**取上游 `await loadProjectFiles(projectId)`**，把 fork 的隐藏排序**移进 `loadProjectFiles`**（在 `flattenFileTree` 之后、`setFileList` 之前），使两条路径都保留排序。
- 上游新增的刷新 effect（163–173）与 Escape abort（304–312）已自动合入，保留。

**验收**：@ 下拉每次打开都重取；隐藏路径仍排最后。

#### B5. `src/modules/chat/utils/toolGrouping.ts`（2 块）

**冲突本质**：fork 改成「单工具也成组」（保持同容器/键型，避免 DOM 跳变）并加 `activitySummary`；上游 `3576232e` 引入 `WeakMap` 缓存工厂 `getToolGroup`（让 `memo` 能 bail）并保留阈值分组。

**倾向方案**：
- 块 A（注释 169–180）：取上游注释。
- 块 B（`items.push` 241–260）：**手工合并** —— 保留 fork「总是成组」，走上游缓存：把 `activitySummary: summarizeToolGroupActivity(run)` 补进 `getToolGroup` 的对象字面量，本块写成单行 `items.push(getToolGroup(run, showThinking));`。
- 缓存基建（54–77）、`NON_GROUPABLE_TOOL_NAMES`、fork 放宽的候选判断已在合并文件里，无需重造。

**⚠️ 审阅新增风险（Claude，未验证，须真机确认）——缓存 × `activitySummary` 的流式语义**：
`getToolGroup` 以 **run 数组身份**为键缓存；若流式期间数组身份稳定而内容增长，则 `activitySummary: summarizeToolGroupActivity(run)` 会在**首次计算后冻结**，fork 原本每 tick 重算的摘要不再更新。⇒ §6 冒烟清单已补「流式期间折叠组摘要仍刷新」一条；若真冻结，处置是**把摘要移出缓存对象**（或在 run 内容变化时换键），而不是退回 fork 的无缓存实现（那会丢掉 `3576232e` 的 memo bail）。

**验收**：单工具仍成组；折叠组在流式 tick 间不重渲染（memo bail）；**流式期间折叠组摘要仍随内容刷新**。

#### B6. `src/modules/chat/transcript/ToolGroupContainer.tsx`（1 块）

**冲突本质**：仅 `memo` 的 JSDoc 注释冲突（双方各自按自己的实现改了说明）。逻辑无冲突；文件其余部分（`messageKeys` 消歧、`hidesProcessIdentity`、fork 的整体重写）已自动合入。

**倾向方案**：**取上游注释**，前提是同时接住 `3576232e` 的一对（`toolGroupCache` + pane 传 `getGroupedMessageKey`，见 B7）。
**注意（如实记录）**：fork 给本组件加了 `onExpandedChange`/`revealRequestId`，而 pane 目前用每次渲染新建的内联箭头传入 ⇒ process group 的 memo 本来就难 bail，故 fork 注释也不算错。此项**属文档措辞，不影响行为**。

#### B7. `src/modules/chat/transcript/ChatMessagesPane.tsx`（1 块）

**冲突本质**：上游侧是**过期的基点工具组片段**（fork 整体重写了渲染循环，diff3 无法对齐）。关键：fork 的工具组 Fragment 块已作为公共上下文出现在冲突块**上方**（566–655），fork 的非组 return 在**下方**（707 起）——上游这侧是**重复的过期片段**。

**倾向方案：取 HEAD（fork）**，丢弃 682–705。**并**把 fork 工具组调用处（约 635 行）的 `getMessageKey={getMessageKey}` 改为 `getMessageKey={getGroupedMessageKey}`（`getGroupedMessageKey` 已在 203–204 落位），以接住 `3576232e` 的性能收益——否则该模块函数会变成未使用符号。

**审阅结论（ZCode，已复核，回答了 §7 问题 6）**：改 `getGroupedMessageKey` **不影响** `ExecutionProcessSummary` / reasoning 分组。`getGroupedMessageKey`（worktree `:203`）是**模块级函数**，其 JSDoc 明说仅用于折叠组内部行键、由 `ToolGroupContainer` 自行消歧，且「模块函数身份稳定」正是 memo bail 的前提；而 `deriveExecutionProcessProjection`（`:352`）与 `deriveUserMessageAnchors`（`:358`）消费的仍是 pane 级 `getMessageKey`（`:345`，useCallback）。两层键各司其职，**可按方案执行**。

**验收**：流式期间折叠工具组不重渲染；`ExecutionProcessSummary`/reasoning/sticky header 行为不变。

#### B8. `src/modules/chat/transcript/MessageComponent.tsx`（1 块）

**冲突本质**：同一页脚行区。fork 放宽了时间戳显示条件（`shouldShowAssistantCopyControl || !isGrouped`）；上游新增 `<MessageModelLabel model={message.model} />`。

**倾向方案：两者可共存**（保留 fork 门控 + 插入上游模型标签）：
```tsx
<MessageModelLabel model={message.model} />
{(shouldShowAssistantCopyControl || !isGrouped) && <span>{formattedTime}</span>}
```
import（`:15`）、fork 的 `formattedTime` 自定义已在自动合并区。

**依赖**：`src/shared/types.ts` 的 `model?` 字段（丙组 C1）与后端 `model`（丙组 C3）—— 二者已自动合入。

#### B9. `src/modules/code-editor/EditorSidebar.tsx`（1 块）

**冲突本质**：上游 `05b63060` 重构了这一行（新增 `isFloating`、`handleClose/handlePopOut`、`onUnsavedChangesChange`，浮层时 div 用 `contents` 并条件给 className/style）；fork 只把同一行里的 `border-gray-200 dark:border-gray-700` 迁到语义令牌 `border-n-gray-*`。

**倾向方案：手工合并 = 上游结构 + fork 令牌**（示意）：
```tsx
className={isFloating
  ? 'contents'
  : `h-full overflow-hidden border-l border-n-gray-200 dark:border-n-gray-700 ${useFlexLayout ? 'min-w-0 flex-1' : ''}`}
style={isFloating || useFlexLayout ? undefined : { width: `${effectiveWidth}px`, minWidth: `${MIN_EDITOR_WIDTH}px` }}
```
上游其余重构（96–152）与 fork 另一处 resize handle 改色（`:126`）均已自动合入。

#### B10. `src/modules/settings/tabs/AppearanceSettingsTab.tsx`（2 块）

**冲突本质**：同一段「外观模式」行被两侧各换了一遍实现。上游 #1393 换成 `light/dark/system` 的 `<select>`（走 `useTheme().themeMode/setThemeMode`）；fork 早已换成 `ThemeModeSelector`（含 `system`）+ `ThemeSelector`（覆盖层）并追加用户主题/令牌预览/字体区块。

**倾向方案**：
- 块 1（imports 3–17）：**取 fork**（不需要 `useTheme`/`ThemeMode` 导入）。
- 块 2（主题设置行 52–96）：**取 fork**（已是上游 #1393 的功能超集）。
- **依赖**：需 B1 落定后同时暴露 `themeMode`/`setThemeMode`（fork 的 `ThemeModeSelector` 若按 B1 选项 i 改成这两个名字，则本文件天然一致）。

> 备注：fork 的 `ThemeModeSelector` i18n 键是 `themeMode.*`（各 locale 均已有）；上游新键在 `appearanceSettings.theme.*`。取 fork 后上游那组键成为**未被消费的键**，见 §4.4 的处置建议（保留键、不删）。

#### B11. `server/modules/providers/list/claude/claude-auth.provider.ts`（2 块）

**冲突本质**：两侧都重写了 `checkCredentials` 区域。
- fork：**删**本地 `loadSettingsEnv()`，改调共享的 `readClaudeSettingsEnv()`（`@/shared/claude-settings.js`，语义等价）。
- 上游 #1375：保留 `loadSettingsEnv`，拆出 `findApiKeyCredential()`，新增 `subscriptionOverride`（api key 绕过订阅登录时告警）与 `readCredentialsFile()`。

**倾向方案：采纳上游 #1375 的完整重构，再接上 fork 的去重意图**：
1. 块 1（83–102）取上游；块 2（113–116）取上游（删 fork 那行 `const settingsEnv = …`，否则与 `findApiKeyCredential` 的参数重复声明、TS 报错）。
2. 把 `checkCredentials` 里的 `const settingsEnv = await this.loadSettingsEnv();` 改为 `const settingsEnv = await readClaudeSettingsEnv();`。
3. 删 `loadSettingsEnv` 方法本体（顶部 fork 的 import 因此被用上；`readFile`/`os`/`path`/`readObjectRecord` 仍被 `readCredentialsFile` 使用）。

**审阅结论（ZCode，已复核，可照方案执行）**：块 2 上游侧为空（即删 fork 那行 `const settingsEnv = await readClaudeSettingsEnv();`，worktree `:114`）；`:132` 的 `this.loadSettingsEnv()` 改 `readClaudeSettingsEnv()` 后，`loadSettingsEnv`（`:88` 起）**再无调用方，删除安全**；`readFile`/`os`/`path`/`readObjectRecord` 仍被 `readCredentialsFile`（`:171` 起）使用，**import 保留正确**。

**验收**：`server/modules/providers` 相关测试通过；api key 绕过订阅登录时仍告警。

---

### 4.3 丙组：机械并集 / 取一侧（6 文件）

| 编号 | 文件 | 块 | 处置 |
|---|---|---|---|
| C1 | `src/shared/types.ts` | 1（649–662） | 同点两正交字段（fork `streamChannel` + 上游 `model`）⇒ **两者都留** |
| C2 | `server/shared/types.ts` | 1（347–362） | 与 C1 同构（后端那份）⇒ **两者都留** |
| C3 | `src/shared/utils.ts` | 2 | 块 1 import 手工合一行（fork 字体/主题类型 + 上游 `QuickSettingsTab`/`SlashCommand`）；块 2 两段整段都在（fork 的 THEME CHROME 段 + 上游的 SLASH COMMANDS / QUICK SETTINGS 段）⇒ **都保留** |
| C4 | `src/modules/code-editor/CodeEditorHeader.tsx` | 1（91–103） | 相邻插入 ⇒ **都保留**（fork 令牌 className + 上游未保存圆点）；上游 `hasUnsavedChanges` prop 与 `labels` 已自动合入 |
| C5 | `src/modules/project-workspace/ProjectWorkspaceShell.tsx` | 1（3–8） | 保留 fork 两行 import（`useProjectSidebarState`/`useSidebarSwipeGesture`），**删已无消费者的 `QuickSettingsPanel`**（body 已自动合并为上游 `<ProjectQuickSettingsRegion />`） |
| C6 | `server/modules/providers/tests/codex-models.test.ts` | add/add | **两侧测试都保留**。核对结论：两套模型名不冲突（fork `gpt-5.6-sol`/`gpt-6-astra` vs 上游 `gpt-6-sol`/`gpt-6-luna`），provider（自动合并）当前**已含两组**；版本闸门实际断言是 `major > 0 \|\| minor >= 155`（worktree `:303`），对 `0.156.1` 可过。（原稿写的「`0.1561 ≥ 0.155`」是转写走样，结论不变。） |

**C6 补充（ZCode，已复核）**：这是**整文件级 add/add**，工作量比「import 去重」大——两侧测试风格不同构（fork 用 `withIsolatedDatabase` 临时库 + `writeTempCodexConfig`；上游用 `createRequire` 纯目录断言、无数据库依赖），并成一个文件需**手工拼接**。安全性结论：上游侧仅 2 个测试、断言一律按 value 查找（`findCodexModel`），**不碰 `OPTIONS[0]` / 列表长度 / 顺序**，与 fork 侧 `OPTIONS[0] === 'gpt-6-astra'`（`:148`）及合并后 provider（`gpt-6-astra` 仍在 curated 首位）互不冲突；两侧 helper 名不撞（已核）。

---

### 4.4 i18n：24 个 locale 文件（约 36 块）

**冲突本质**：双方在**同一位置各插入不同的键**：
- 上游新增：`sessions.select/selectAll/selectAllLoaded/clearSelection/deleteSelected_{one,other}`、`deleteConfirmation.{confirmDeleteSessions,deleteSessions_*,selectedSessions_*,archiveSessions_*,archiveSessionsNotice_*}`、`appearanceSettings.theme.{label,description,light,dark,system}`。
- fork 自有：`sessions.{sessionOptions,sessionName,pinSession,…}`、归档系列、`userThemes.*`、`tokenPreview.*` 等。

**处置：键并集 + 去重。**
1. 逐文件对每个冲突块做并集；`sessions.selectAll` 等**两侧同名**的键需去重（保 fork 的译文，若上游文案更准确再改判）。
2. 按本仓库 i18n 策略（**只维护 zh-CN，`en` 是键集基准**）：上游新键需 **`en` 定义 + `zh-CN` 翻译两条一起写**；其余 locale 缺失回落 `en`，不必补。
3. **`appearanceSettings.theme.*` 的特殊处置**：若 B10 取 fork 的 `ThemeModeSelector`，这组上游键**无消费者**。裁定建议：**保留键不删**（上游后续可能再引用、且删了会让下次同步再冲突），但在本方案登记为「已存在但当前未消费」。
4. 上游新增的 `cs/` locale 已自动合入并注册（`languages.ts:79` + `config.ts:134-143` 8 个文件），**无需额外动作**；`cs` 无 fork 自有键，回落 `en` 属预期。
5. **收口门禁：key diff 用「对基线取增量」，不要指望 0/0。**
   实测（主仓 HEAD = 合并前 `cloudcli-dev`）：`en` **2277** 键 / **9** 文件，`zh-CN` **1727** 键 / **8** 文件（`zh-CN` 无 `git.json`）⇒ **en 独有 576 键 / zh-CN 独有 26 键**（差 550 = 576 − 26）。
   - 结论：**本仓库的 `zh-CN` 是「部分翻译 + 回落 `en`」**（覆盖率约 76%），**不存在「zh-CN 与 en 逐键相等」的前提**；原稿「确认 `zh-CN ⊆ en` 仍成立」的措辞会误导（合并前就有 26 个 zh-CN 独有键）。
   - 门禁判据（按增量，判据见附录 A 脚本）：
     ① **`zh-CN` 独有键数不得增加**（26 → ≤26；若增加，说明并集时把键只写进了 zh-CN）；
     ② **`en` 独有增量必须 = 「上游本次新增且尚未翻译」的键数**，且这些键要**逐条列出**（按策略应把上游新键补进 zh-CN ⇒ 期望增量 **0**）；无法归零时须能逐条解释，不得凭感觉。
   - 命令与前置基线记录见 §5 步骤 1 与附录 A。

---

## 5. 执行顺序与提交切分

**总原则**：任何一步动作前先说明；**不 push**（push 前须再次确认）。

### 步骤 0：前置检查与基线记录（**必须先做，否则收口无从比对**）
```
git status --porcelain                 # 必须干净（未跟踪的研究文档不影响，但要心里有数）
git branch --show-current              # 期望 cloudcli-dev
```
在 `cloudcli-dev` 当前 HEAD 先跑一次，把**名字集**（不是绝对计数）记进执行手记：
```
npm test                               # 记下 `not ok` 名字集（剥掉 "ok N - " 前缀再比）
npm run test:client                    # 记下 文件数 / 用例数
node <附录A 的 i18n-keydiff.mjs> en zh-CN   # 记下基线：en 独有 576 / zh-CN 独有 26
```
> 依据：`npm test` 的失败集在本仓库**随运行漂移**（历史观测 10~21 不等，第二轮 ZCode 实跑两轮为 13 fail / 1103），**基线一律以本步骤的实跑记录为准**，"无新增"必须靠名字集 A/B，绝对计数不可当基线。
>
> **本轮实跑基线（2026-10-06，HEAD `0650d54e`，合并前）**：`npm test` **1103 / 1092 通过 / 10 失败 / 1 跳过**（失败名集存 `/tmp/baseline-notok-names.txt`，10 条：`getStatus`（codebuddy/WorkBuddy 引擎）×3、`resolveClaudeCodeExecutablePath`（Windows）×4、`spawnOpenCode` ×1、`synchronizer`（同名 ×2））；`npm run test:client` **161 文件 / 1322 用例 全绿（0 失败）**；i18n **`en` 2277 键 / `zh-CN` 1727 键（en 独有 576 / zh-CN 独有 26）**。

### 步骤 1：同步 `main`（无冲突）
```
git checkout main
git merge --ff-only upstream/main      # 已确认是祖先关系，纯 FF
git checkout cloudcli-dev              # 回到工作分支
```

### 步骤 2：合并 `main` → `cloudcli-dev`，按本文档 4.x 逐组解决
建议的解决顺序（按依赖与风险从低到高）：
1. **丙组 6 文件**（纯并集，低风险）
2. **i18n 24 文件**（键并集 + 去重）
3. **B9/B8/B6**（编辑器/消息页脚/注释类）
4. **B5/B7/B4/B3**（chat 工具组/渲染循环/@ 列表/斜杠命令）
   - **⚠️ 硬顺序依赖**：B3 删本地 `isSkillCommand` 依赖 **第 1 步的 C3** 在 `src/shared/utils.ts` 保留上游 SLASH COMMANDS 段（本文件 `:16` 的 import 指向它）。此顺序**必须显式保持**，不能因"B3 更熟"提前做。
5. **B11**（服务端 claude-auth）
6. **B1 → B2 → B10**（ThemeContext 枢纽 → 其测试 → 外观设置页）
7. **D2**（快捷设置面板，连带 `shared/types` / `QuickSettingsTabs` / `useSessionOutlineData`）
8. **D1**（侧边栏批量选择 5 文件 + **三步拆除序**见 §4.1.1 第 2 条 + 测试移除）

解决中**每处理完一组就跑一次针对性测试**（见 §6），不要全部攒到最后。

### 步骤 3：收口
```
npm install            # 依赖升级
npm run typecheck && npm run typecheck:theme-tokens   # 门禁
npm test               # 服务端
npm run test:client    # 前端
npm run lint
npm run build
```
> 若需要变更视觉/主题，按仓库惯例跑 `test:theme-tokens` 与令牌基线；本合并**原则上不改视觉**，若有则单独记账。

### 步骤 4：提交
- 合并本身是**一个 merge commit**（`git commit` 收尾 merge）。
- 提交信息：`Merge upstream dc7cb6c6 into cloudcli-dev (fork sync)`（**沿用本仓既有同步提交的写法**，见 `3616d0d7` / `ff2fd034`；`Merge …` 开头被 commitlint 的 merge 忽略规则放行）。
  - ⚠️ **原稿写的 `merge: 同步 upstream/main（dc7cb6c6）并入 cloudcli-dev` 实测过不了 commitlint**（`type-enum` 不含 `merge`）⇒ 已改判为上面的写法（执行期复核，见 §8.4 ⑥）。
- body 简述 D1/D2 裁定 + 乙组逐项结论。

---

## 6. 验收清单

| 层 | 命令/方式 | 期望 |
|---|---|---|
| 类型 | `npm run typecheck`、`npm run typecheck:theme-tokens` | 0 错 |
| 服务端测试 | `npm test` | 失败集与**步骤 0 记录的名字集**逐字节相同（不用绝对计数） |
| 前端测试 | `npm run test:client` | 0 失败（文件数/用例数对齐逐文件实测之和） |
| 主题 | `npm run test:theme-tokens` | 通过 |
| Lint | `npm run lint` | 0 错 |
| 构建 | `npm run build` | exit 0 |
| **i18n key diff** | 附录 A 脚本：`en vs zh-CN` | **zh-CN 独有 ≤ 26**（基线），**en 独有增量 = 上游新键中未翻译者**，逐条列出（期望 0） |
| 冒烟（真机） | 起服务 | ① 侧边栏批量归档/删除（3 个列表）② 快捷设置面板（outline + 停靠，浮层不遮罩）③ 主题模式 light/system/dark 与 OS 跟随 ④ 用户主题覆盖层 ⑤ 代码编辑器未保存确认 ⑥ @ 文件下拉 ⑦ 斜杠命令 Tab 补全 **+ 三命名空间 project/user/skill 生效** ⑧ LaTeX 渲染 ⑨ 模型标签 ⑩ 工作区 vs 分支对比 **⑪ 流式期间折叠工具组摘要仍刷新**（对应 B5 的 WARNING） |

---

## 7. 待审 / 待决问题清单（给审阅者）

> 请逐条给结论（同意 / 改判 + 理由）。**只对机制与裁定提问，不必逐字校对措辞。**

1. **D1 代价**：放弃上游 #1404 ⇒ 每次后续同步在这 5 文件重复冲突。是否接受？有无更省事的替代（例如保留上游同时把 fork Manage 作为「最近/归档」专用）？
2. **B1 子决策**：`theme`/`setTheme` 保留为别名（选项 ii）还是改名 `ThemeModeSelector`（选项 i，推荐）？
3. **B1 语义**：以 `themeMode` 为唯一模式状态后，fork 的 `preferLocalValueOnHydrate`（`themeId` 的重置压过 hydrate）机制是否需要同步扩展到 `themeMode`？
4. **B2 非冲突区疑点**：基点测试「`a theme arriving from the store is applied without being written back`」被静默替换 —— 确认属有意替换？
5. **B3**：`skillScopeToNamespace` 移植进上游 hook 时，"project/user/skill 三命名空间"与上游写死的 `namespace:'skill'` 差异，是否还有其它消费者依赖？
6. **B7**：把 pane 的 `getMessageKey` 改为 `getGroupedMessageKey` 是否会影响 fork 的 `ExecutionProcessSummary` / reasoning 分组键？
7. **D2**：删除上游 Escape-capture 后，"Escape 关闭面板"这一预期行为是否会缺失？是否需要在 fork 的 outside-click effect 里补 Escape？
8. **§4.4-3**：无消费者的 `appearanceSettings.theme.*` 键保留还是删除？
9. **审计覆盖**：自动合并区是否还有「双方改了同一文件不同处」的语义丢失？（各代理已点名 QuickSettings 为半残缺态；是否需对 `SidebarRecentConversations`/`SidebarContent`、`git-panel`、`electron/*` 再做一轮针对性扫描？）
10. **提交粒度**：一个 merge commit 是否够？是否需要按组拆成多次「先 merge 再修」的提交？

### 7.1 第一轮审阅响应（Claude / ZCode，2026-10-06）

**复核原则**：审阅者的数字与前提**一律自己复算**（本轮即抓到 2 处行号取错树）。结论如下。

| # | 来源 | 批注要点 | 复核结论 | 回写位置 |
|---|---|---|---|---|
| 1 | ZCode | `--diff-filter` 实测 46 UU + 1 AA，原稿「全部 UU…仅 1 处 add/add」自相矛盾 | ✅ **属实**（`git status --porcelain` ⇒ 46 `UU` + 1 `AA`） | §3 |
| 2 | ZCode | D1 拆除面更大：`Sidebar.tsx:265–269`、`SidebarProjectList.tsx:47/86`、hook 内部 `:127/:131/:1055–1153/:1581` + 派生回调；须给拆除顺序 | ✅ **属实**（已逐处 grep 复核） | §4.1.1-2 |
| 3 | ZCode | `batchArchivedSessionDeleteConfirmation` 的消费者是 `SidebarModals` + hook + `Sidebar.tsx`，**不是 `SidebarContent`** | ✅ **属实**（`SidebarContent.tsx` 无该符号） | §4.1.1-5 |
| 4 | ZCode | 回答 Q6：改 `getGroupedMessageKey` 不影响 ExecutionProcessSummary / reasoning | ✅ **属实**（两层键各司其职，`:203` 模块函数 vs `:345` pane useCallback） | §4.2 B7、§7 Q6 = **已答（可执行）** |
| 5 | ZCode | 收敛 Claude 的 B1 块 4 stale-closure WARNING：`[]` 安全 | ✅ **属实**（`applyUserThemeStyle` 是模块级 import `:17`，依赖挂在独立 effect `:421`） | §4.2 B1 |
| 6 | ZCode | C6 是整文件 add/add，工作量大于 import 去重；版本闸门实为 `major > 0 \|\| minor >= 155` | ✅ **属实**（`:303`）；原稿「0.1561 ≥ 0.155」属转写走样 | §4.3 C6 |
| 7 | ZCode | B11 已实证可照方案执行 | ✅ **属实**（`:114` 删除侧、`:132` 改调用、`:171` `readCredentialsFile` 仍在用） | §4.2 B11 |
| 8 | ZCode | §6「无新增」需先有基线 ⇒ 先跑一次 `npm test` 记录失败名集 | ✅ 采纳 | §5 步骤 0、§6 |
| 9 | Claude | B3↔C3 隐含顺序依赖；`isSkillCommand` 两处调用点在冲突块外 | ⚠️ **半属实**：结论对，**行号取错树**（批注写 `:342/:364` = 主仓 HEAD；worktree 实为 `:386/:408`） | §4.2 B3、§5 步骤 2-4 |
| 10 | Claude | B5 缓存 × `activitySummary` 可能冻结，建议补冒烟项 | ⚠️ **未验证但成立风险**：已作为 WARNING 收下 + 补冒烟项 + 预备两种处置 | §4.2 B5、§6 |
| 11 | Claude | B1 块 4 改 `[]` 有 stale-closure 风险 | ❌ **被 ZCode 推翻**（见 #5）⇒ 按「`[]` 安全」记录，但保留「拼回段只走重读存储」的约束 | §4.2 B1 |
| 12 | Claude | B1 消费者行号「`:310` 实际在 `:264`」 | ❌ **批注本身错**：`:264` 是**主仓 HEAD**、`:310` 是 **worktree**；两者都对但不同树 ⇒ 保留 `:310` 并注明按树分辨 | §4.2 B2 |
| 13 | Claude | 全文行号基于冲突态 worktree，落地会漂移，按符号定位 | ✅ 采纳（并因 #12 上升为「**必须**按符号定位 + 声明所依据的树」） | §4.2 B2、§4.2 B1 |
| 14 | Claude | §6 冒烟补：流式摘要刷新、skill 三命名空间 | ✅ 采纳 | §6 |
| 15 | Claude | §4.4 key diff 无可复算命令 | ✅ 采纳，并**顺带实测出真实基线**（en 2277 / zh-CN 1727、原「zh-CN ⊆ en」措辞失真） | §4.4-5、§6、附录 A |
| 16 | Claude | §5 步骤 1 前加工作区干净前置检查 | ✅ 采纳 | §5 步骤 0 |

**仍待答**：Q1（D1 代价是否有更省事替代）、Q2（B1 别名 i/ii）、Q3（`preferLocalValueOnHydrate` 是否扩展）、Q4（被静默替换的基点测试是否属有意）、Q5（`skillScopeToNamespace` 其它消费者）、Q8（未消费 i18n 键去留）、Q9（自动合并区是否再扫一轮）、Q10（提交粒度）。
> 撤回：**Q6 已由 ZCode 实证回答（可执行）**。~~Q7（Escape）未获回应~~ → **第二轮已改判，见 §7.2 与 §4.1.2-3**。
> §7.1 遗留的 Q1–Q5、Q8–Q10 已在**第二轮**全部给出结论，见 §7.2。

### 7.2 第二轮审阅响应（Claude / ZCode，2026-10-06）

**复核原则**：同 §7.1 —— 审阅者的数字与前提**一律自己复算**。

**乙组逐项结论**：除下列两条改判外，其余项均「同意文档倾向方案」。

| # | 来源 | 批注要点 | 复核结论 | 回写位置 |
|---|---|---|---|---|
| 1 | ZCode | **B3 连带动作缺口**：上游测试 `useProjectSlashCommands.test.tsx:65` 断言 `review.namespace === 'skill'`（夹具 `:49–51` 含 `scope:'user'`/`'plugin'` 的 skill），移植 fork 的 `skillScopeToNamespace` 后**必挂**，须改测试为按 scope 断言 | ❌ **前提为误（执行期实证推翻）**：`:65` 断言的对象是 `scope: 'plugin'` 的 `/review`，而 `skillScopeToNamespace('plugin')` 兜底返回 `'skill'`；夹具里 `scope: 'user'` 的 `/commit` 无任何 namespace 断言。实测 **5/5 通过**，测试**不必改** | §8.4 ② |
| 2 | ZCode | **D2/§7-Q7 改判**：照原文删上游 Escape-capture 会**丢优先级**（fork 冒泡相输给 chat/编辑器的 capture），应改采上游 capture 机制、回调调 fork 的 `setIsOpen(false)` | ✅ **属实**（上游 `:117–138` capture + `defaultPrevented`；fork `:194–195` document 冒泡） | §4.1.2-3 |
| 3 | ZCode | D1 拆除清单补第四处：`sidebarRowProps.test.tsx` harness 的五个选择 props | ✅ **属实且不足**——除 `:65`/`:102–106` 外 **`:255–258` 还有第二处**（已补） | §4.1.1-⑦ |
| 4 | ZCode | §5 步骤 0 的「失败集漂移（19~21）」未复现，实跑 13 fail / 1103，且均不在合并触及域 | ✅ **属实**（相对计数本就随运行漂移 ⇒ 已改为「以实跑为准」） | §5 步骤 0 |
| 5 | ZCode | B1 唯一消费者清点成立：`DarkModeToggle` 只用 `isDarkMode/toggleDarkMode` | ✅ **属实**（`:18`） | §4.2 B1、§7.2-Q2 |
| 6 | ZCode | C6 是整文件 add/add，需手工拼接（两侧 helper 名不撞）；版本闸门 `major>0 \|\| minor>=155` | ✅ **属实**（与 §7.1 #6 同） | §4.3 C6 |
| 7 | ZCode | B11 可照方案执行 | ✅ **属实**（与 §7.1 #7 同） | §4.2 B11 |
| 8 | ZCode | Q9 已实扫：91 个「双方都改」文件中 47 个已入冲突清单、**剩 47 个走自动合并**；点名近距双改前 10 与 `AuthContext.tsx` 抽验良性 | ✅ **属实**（收窄为「执行时对 5 个文件做 diff 目检，其余交 typecheck/测试/冒烟」） | §6、§7.2-Q9 |
| 9 | Claude | §6 冒烟补两项（流式摘要刷新 / skill 三命名空间） | ✅ 采纳（与 §7.1 #14 同） | §6 |
| 10 | Claude | §4.4-5 key diff 缺可复算命令 | ✅ 采纳（与 §7.1 #15 同） | §4.4-5、附录 A |
| 11 | Claude | §5 步骤 1 前加工作区干净前置检查 | ✅ 采纳（与 §7.1 #16 同） | §5 步骤 0 |

**十问最终裁定表（Q1–Q10 全部收敛，无遗留）**：

| Q | 结论 | 依据 |
|---|---|---|
| Q1 D1 代价 | **维持方案 A**（保留 fork Manage）。替代方案＝两套选择系统并存、维护面更差 | ZCode |
| Q2 B1 别名 i/ii | **选 i（改名 `ThemeModeSelector`）**，且比正文更简单：局部 `type ThemeMode` 与 `shared/types` 结构同域、**无需导入类型**；改点三处（`useTheme()` 解构 → `:13`/`:14` 区、`theme === value` → `:30`、`setTheme(value)` → `:39`，**按符号定位**；ZCode 批注给的 `:41/:47` 有偏差） | ZCode |
| Q3 `preferLocalValueOnHydrate` 扩展 | **不需要**。`themeReset.ts` 只固化 `themeId:null`、从不重置模式轴 ⇒ 无扩展场景；但须在 §8.2 记两条语义变化 | ZCode |
| Q4 基点测试被替换 | **有意替换，非合并丢失**。`git log --all -S` 溯源：由 `4623c522`（偏好迁 off localStorage）引入、`99ea0525`（统一 provider 工作流）移除，均在 fork 历史内 | ZCode（**本机复算一致**） |
| Q5 `skillScopeToNamespace` 消费者 | **仅 chat 一处**（`:108` 定义 / `:121` 使用）；移植后 QuickSettings Commands 页自动继承。**另须连 fork 本地的 `mapSkillToSlashCommand`（`:118` 定义 / `:238` 调用）一起删**，别只删前者 | ZCode |
| Q6 `getGroupedMessageKey` 影响 | **不影响**（两轮一致；见 §7.1 #4） | ZCode |
| Q7 D2 Escape | **改判**：不删上游 capture，改采**上游 capture 机制**（见 §4.1.2-3） | ZCode |
| Q8 未消费 i18n 键 | **保留** `appearanceSettings.theme.*`，登记「已存在未消费」 | 两轮一致 |
| Q9 自动合并区审计 | **收窄**：47 个双改自动合并文件中，执行时对 `ChatInterface`/`useProviderAuthStatus`/`useChatMessages`/`Settings.tsx`/`CodeEditor.tsx` 做一次 diff 目检，其余交 typecheck + 测试 + 冒烟；脚本见 §7.2 附注与附录 A | ZCode |
| Q10 提交粒度 | **单 merge commit**。「先 merge 再修」的中间态不可编译，会同时破坏 bisect 与 §6 门禁；追加修复走 merge 之后的常规提交 | 两轮一致 |

**本轮回写时的两处提醒（我自己复算发现的）**：
- **审阅者行号仍有偏差**（不影响结论）：ZCode 给 `ThemeModeSelector` 的改点是 `:15/:41/:47`，其中 `:15` 正确、`:41/:47` 实为 **`:30/:39`**（`:8` 实为 `:7`）。主仓 HEAD 与 worktree 该文件**逐字节同**，故非「取错树」而是单纯记错 ⇒ 再次印证**落地一律按符号定位**。
- **§3 口径**（46 UU + 1 AA）已在第一轮回写落地，本轮无新增。

<details><summary>Q9 行距排序复算脚本（基线行号可直接比，双侧 diff 同以 6c51fcaa 为旧文件）</summary>

```bash
git diff --name-only 6c51fcaa..upstream/main | sort > /tmp/up-files.txt
git diff --name-only 6c51fcaa..cloudcli-dev | sort > /tmp/fk-files.txt
comm -12 /tmp/up-files.txt /tmp/fk-files.txt > /tmp/both.txt
git -C /tmp/cloudcli-sync2.KTHw0h diff --name-only --diff-filter=U | sort > /tmp/conflict.txt
comm -23 /tmp/both.txt /tmp/conflict.txt > /tmp/auto-both.txt   # 47 个双改自动合并文件
while read f; do
  git diff 6c51fcaa..upstream/main -- "$f" | grep '^@@' | sed 's/^@@ -\([0-9]*\).*/\1/' > /tmp/up.txt
  git diff 6c51fcaa..cloudcli-dev -- "$f" | grep '^@@' | sed 's/^@@ -\([0-9]*\).*/\1/' > /tmp/fk.txt
  awk -v file="$f" 'BEGIN{min=999999} NR==FNR{up[FNR]=$1; n=FNR; next}
    {for(i=1;i<=n;i++){d=$1-up[i]; if(d<0)d=-d; if(d<min)min=d}}
    END{if(min==999999)min=-1; print min, file}' /tmp/up.txt /tmp/fk.txt
done < /tmp/auto-both.txt | sort -n
```
</details>

---

## 8. 风险与记账

### 8.1 风险
1. **依赖升级**：`@openai/codex` 0.153→0.156 可能影响 codex provider 行为与版本闸门测试。
2. **ThemeContext 是枢纽**：B1 未定则 B2/B10 无法收口，且编译不过。
3. **QuickSettings 半残缺态**：不改 §4.1.2 的连带项（`shared/types` 的 `QuickSettingsTab`、`QuickSettingsTabs`、`useSessionOutlineData`）则即使无冲突标记也不编译。
4. **fork 分叉巨大（518 提交）**：本次 merge commit 体量大，建议合并后真机冒烟而非只信测试。
5. **自动合并区语义丢失**：见第 7 节问题 9。
6. **dry-run worktree 暂留** `/tmp/cloudcli-sync2.KTHw0h`（分支 `sync-preview`）：不需要时清理（`git worktree remove --force` + `git branch -D sync-preview`）。

### 8.2 如实记账（有意为之的取舍）
- D1：放弃上游 #1404 官方实现。
- D2：浮层不加遮罩（与上游不同）；Escape 关闭改采**上游 capture 机制**（第二轮改判，不再「删 capture」）。
- B6：该注释冲突按文档措辞处理，不留行为影响。
- `appearanceSettings.theme.*` 键可能成为未消费键（Q8 裁定：保留并登记「已存在未消费」）。
- **B1 落定后的两条 themeMode 语义变化（Q3 答案②，ZCode）**：① themeMode 的唯一源从 fork 的「localStorage 优先、镜像兜底」变为「仅镜像」，而 hydrate 是**整体采纳服务端副本** ⇒ 会话建立前的本地改模式可能在 hydrate 时被服务端旧值回滚（这是上游 #1393 的既有语义，跨设备同步本就如此，**接受即可**）；② 镜像功能上线前只在 localStorage 写过 `theme` 的存量数据，合并后**首次加载会回落 system 一次**，此后自愈（fork 写路径两处同写），**不必写迁移**。
- **B1 回调体执行期改判（用户裁方案 B）**：文档 B1 块 4「取上游回调体」与 B2「两测都留」自相矛盾，实际保留 fork 的 sticky-`system` 语义。详见 §8.4 ①。
- **两处文档未列的语义相斥（自动合并区，靠上游新测试暴露）**：`ProviderAuthStatus` 保留 fork 的 `installed`/`provider`/`authVerified`（上游 #1375 删）；`useProjectsState.ts:892–900` 保留 fork 的 `!sessionId ⇒ 清空反规范化选择`（上游本次删除）。裁决均为**保留 fork**，详见 §8.4 ④。

### 8.3 通道备注（非本次合并内容，但值得记）
`upstream` remote 的 fetch URL 是 https，经 7890 代理到境外 github 会 TLS 断（`SSL_ERROR_SYSCALL`）。本次改用 `git fetch git@github.com:siteboon/claudecodeui.git 'refs/heads/*:refs/remotes/upstream/*'` **未改 remote 配置**地拉取成功。若希望以后一次到位，可把 `upstream` 的 fetch URL 改为 SSH（`git remote set-url upstream git@github.com:siteboon/claudecodeui.git`），但**本次未做**。

**备注 2（`npm install`）**：首次 `npm install` 在 `registry.npmjs.org` 上 `ECONNRESET`。根因不是墙，而是**进程环境里带着 `HTTP_PROXY/HTTPS_PROXY=http://127.0.0.1:7890` 而这个代理未就绪**（`lsof` 无监听；`curl -x` 到它报 `SSL_ERROR_SYSCALL`），而**直连 registry 是通的**（`curl -I` 无代理 200）。处置：`env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy npm install` ⇒ 成功（`@openai/codex@0.156.1`、`@openai/codex-sdk@0.156.1`）。未改任何 `~/.npmrc`/remote 配置。

### 8.4 执行记录（2026-10-06 落地）

**结果**：47 个冲突文件全部解决，`grep -rlnE '^(<<<<<<<|>>>>>>>) '` 在 `src server docs` 为空。分组照 §4 执行：D1（5 文件，保留 fork Manage，`SidebarModals.tsx` 恢复为与 fork HEAD 逐字节同）／D2（`QuickSettingsPanelView.tsx` 手工重建：去掉浮层遮罩、Escape 只留上游 window-capture 一条、`panelBody` 下移到 `useSessionOutlineData` 之后以解 TDZ）／B1–B11／C1–C6／i18n 24 文件（三方深合并）。

**① 执行期改判 1 处：B1/B2 自相矛盾（升级给用户，用户裁「按你推荐的」⇒ 方案 B）**

文档 B1 块 4 写「取上游回调体」，B2 块 4 写「两个测试都留」，而上游回调体（无条件下沉 `theme`）与 fork 的 sticky-`system` 断言互斥 ⇒ 照字面执行 `themeContext.test.tsx` 必红。裁定 **B**：订阅回调保留 fork 语义——「`system` 是本机外观轴自己的决定，只有到达的是显式 `light`/`dark` 且本机当前不跟随 OS 时才采纳」——按 `themeMode` 命名改写；其余按上游（`themeMode`/`setThemeMode`/`resolveIsDarkMode`/`readStoredThemeMode` + fork 覆盖层 API），`theme`/`setTheme` 别名删除。复核：`src/shared/tests/themeContext.test.tsx` **20/20 绿**。⇒ §4.2 B1 的「取上游回调体」作废，以本条为准。

**② 执行期修正 1 处：§7.2 #1（ZCode 的 B3 改判）前提为误 —— 原上游测试不改也过**

ZCode 称 `useProjectSlashCommands.test.tsx:65` 的 `review.namespace === 'skill'` 在移植 `skillScopeToNamespace` 后**必挂**。实为**前提取错对象**：`:65` 断言的对象是 `scope: 'plugin'` 的 `/review`，而 `skillScopeToNamespace('plugin')` 走兜底分支返回 `'skill'`（`src/shared/hooks/useProjectSlashCommands.ts:56-64`）；夹具里那个 `scope: 'user'` 的 `/commit` **没有任何 namespace 断言**。实测该文件 **5/5 通过**。⇒ §7.2 #1 的「必须同步改写为按 scope 断言」作废；B3 只保留「移植 hook + 删本地 `mapSkillToSlashCommand` 家族」。

**③ 合并带来 5 个上游新测试文件全红 → 逐个适配（均为「上游测试的假设 ≠ fork 的有意分叉」）**

| 文件 | 红 | 根因 | 处置（只改测试） |
|---|---|---|---|
| `chat/tests/messageModelLabel.test.tsx` | 1 | fork 默认语言 zh-CN，模型标签的可访问名被译成「由 … 回答」，断言读英文原文 | 文件内 `beforeAll` 钉 `en` |
| `settings/tests/accountContentSubscriptionOverride.test.tsx` | 4 | 同上（通知文案与 `Logged in as …` 均为译文）；夹具还缺 `installed`/`provider` | 同钉 `en` + 夹具补两字段 |
| `provider-auth/tests/useProviderAuthStatusSubscriptionOverride.test.ts` | 2 | fork 的 `ProviderAuthStatus` 保留 `installed`/`provider`/`authVerified`，上游 #1375 删掉了它们 ⇒ 上游 expected 缺这三项 | expected 补回（其余与上游同） |
| `project-workspace/tests/projectsStateRenameSession.test.ts` | 5 | fork 刻意保留「URL 无 sessionId ⇒ 清空反规范化选择」的 effect（`newSessionSelectionRace.test.ts` 有专属断言），上游**删掉了**它 ⇒ 上游 harness 让 `sessionId` 恒 `undefined`，选择被自己的 effect 清掉 | harness 把「`handleSessionSelect` 的导航」与「URL 回填」放进**同一个 `act`**（`rerender({ sessionId })`），与真实路由同批提交 |
| `chat/tests/transcriptStreamingRerenders.test.tsx` | 1 | 上游选择器 `.chat-message.tool > button[aria-expanded]` 绑上游的分组 DOM；fork 把工具运行投成「执行过程」摘要（`aria-expanded` 落在普通 `div` 内），且没有 user 边界时整段折成 1 条 | 夹具给每个 run 加一条 user 行（使 fork 恰好产出 4 条折叠摘要），选择器改 `button[aria-expanded]` |

**④ 两处「文档未列的语义相斥」，靠上游新测试才暴露（Q9 自动合并区的样本）**

- **`ProviderAuthStatus`（`src/shared/types.ts`）**：丙组 C1 只登记了 `streamChannel` + `model`，**漏了**这里的 `installed`/`provider`/`authVerified`（fork 有、上游 #1375 删）与上游新增的 `subscriptionOverride`。合并取并集（fork 字段 + `subscriptionOverride`），故上游新测试要按 fork 形态改 expected（见 ③ 第 3 行）。
- **`useProjectsState.ts:892-900` 的 `!sessionId ⇒ setSelectedSession(null)`**：上游在本次同步中**删除**了它，fork 保留（并带 `newSessionSelectionRace.test.ts` 的专属断言）。该文件在自动合并区、不在冲突清单内，是「双方改同一文件不同处且语义相斥」的典型 ⇒ 裁定**保留 fork**（fork 的 URL 驱动选择依赖它：在 URL 追上之前必须清掉反规范化选择）。这是 §7.2-Q9「执行时目检 5 个文件」名单**之外**的一处，说明按文件行距筛热区仍会漏（本文件行距不在前 10）。

**⑤ 门禁结果**

| 门禁 | 结果 |
|---|---|
| `npm install` | ✅ `@openai/codex@0.156.1` + `@openai/codex-sdk@0.156.1`（见 §8.3 备注 2） |
| `npm run typecheck` | ✅ 0 错（client + server） |
| `npm run test:client` | ✅ **178 文件 / 1444 用例 0 失败**（HEAD 161/1322 ⇒ 上游 +17 文件/+122 用例） |
| `npm test`（服务端） | 1136 / 1125 通过 / 10 失败 / 1 跳过 ⇒ **失败名集是 HEAD 的严格子集**，新增 0（A/B 见下） |
| `npm run test:theme-tokens` | ✅ 204 通过（**HEAD 亦 204** —— 记忆里的「208」是旧值，非本合并所致；规格文件逐字节未动、`src/index.css` 未动） |
| `npm run lint` | ✅ **0 error** / 163 warning（fork 原 153 ⇒ +10，全部来自并入的上游代码；本合并改动的 5 个测试文件 0 warning） |
| `npm run build` | ✅ exit 0 |

**服务端 A/B（本轮唯一动了 `server/` 的是 B11 + 自动合并 ⇒ 按纪律做真 A/B）**：
- HEAD worktree（`git worktree add --detach HEAD` + 软链 `node_modules`）：**1103 / 1089 / 13 失败 / 1 跳过**（与 §7.2 #4 的实跑一致）。
- 工作区：**1136 / 1125 / 10 失败 / 1 跳过**（两次跑漂移 11→10）。
- 名字集：工作区 ⊆ HEAD，**新增 0**。唯一「只在工作区多出」的一条（`workbuddy run closes one-shot stdin…`）与「只在 HEAD 多出」的三条 symlink 测试，**都在两棵树里单跑 41/0 通过** ⇒ 属已登记的顺序/时序漂移，非回归。
- 稳定交集 10 条：`workbuddy`/`codebuddy` `getStatus` ×3、`resolveClaudeCodeExecutablePath` ×4、opencode `spawnOpenCode` ×1、`synchronizer` ×2 —— 全部环境依赖（本机装了 WorkBuddy、PATH、Windows-only 分支）。

**⑥ 提交信息改判**：§5 步骤 4 原稿的 `merge: 同步 …` **过不了 commitlint**（`type-enum` 只允许 build/chore/ci/docs/feat/fix/perf/refactor/revert/style/test，不含 `merge`；已实测报错），而 `Merge upstream <sha> into cloudcli-dev (fork sync)` 被 commitlint 的 merge 忽略规则放行（本仓先例 `3616d0d7`、`ff2fd034`）。⇒ 改用后者。

> 未做项：真机冒烟（§6 的 ⑪ 项「流式期间折叠组摘要仍刷新」尤其需要），`npm run typecheck:theme-tokens`（本轮未改主题令牌）。

---

## 附录 A：可复算命令

```bash
# 同步范围
git rev-list --count 6c51fcaa..upstream/main          # 18
git diff --stat 6c51fcaa..upstream/main | tail -1     # 168 files, +11950 -530
git rev-list --count 6c51fcaa..cloudcli-dev           # 518

# 冲突复现（worktree 已存在，或重来一遍）
TMP2=$(mktemp -d /tmp/cloudcli-sync2.XXXXXX)
git worktree add "$TMP2" -b sync-preview cloudcli-dev
git -C "$TMP2" merge --no-commit --no-ff upstream/main
git -C "$TMP2" diff --name-only --diff-filter=U       # 47 文件
for f in $(git -C "$TMP2" diff --name-only --diff-filter=U); do \
  n=$(grep -c '^<<<<<<<' "$TMP2/$f"); echo "$n  $f"; done | sort -rn   # 共 93 块

# 单文件冲突块
grep -n -A40 '^<<<<<<<' "$TMP2/src/shared/context/ThemeContext.tsx"

# 未合并状态字母分布（46 UU + 1 AA）
git -C "$TMP2" status --porcelain | awk '$1 ~ /^(U|A|D)/ {print $1}' | sort | uniq -c
```

### A.1 i18n key diff（§4.4-5、§6 的门禁脚本）

写到 `scripts/` 之外的一次性脚本即可（**别提交**）。用法：`node /tmp/i18n-keydiff.mjs en zh-CN`。

```js
// /tmp/i18n-keydiff.mjs —— 扁平化嵌套键后比对两个 locale 的键集
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [base, cmp] = process.argv.slice(2);
const root = 'src/modules/i18n/locales';
const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) =>
  (v && typeof v === 'object' && !Array.isArray(v)) ? flat(v, p ? p + '.' + k : k) : [p ? p + '.' + k : k]);

let miss = 0, extra = 0;
for (const f of readdirSync(join(root, base)).filter((f) => f.endsWith('.json')).sort()) {
  const b = new Set(flat(JSON.parse(readFileSync(join(root, base, f), 'utf8'))));
  let c;
  try { c = new Set(flat(JSON.parse(readFileSync(join(root, cmp, f), 'utf8')))); }
  catch { console.log(f + ': 对比侧缺失整个文件 (' + b.size + ' 键)'); miss += b.size; continue; }
  const onlyB = [...b].filter((k) => !c.has(k));
  const onlyC = [...c].filter((k) => !b.has(k));
  if (onlyB.length || onlyC.length) {
    console.log(f + ': 基准独有 ' + onlyB.length + ' / 对比独有 ' + onlyC.length);
    onlyB.slice(0, 8).forEach((k) => console.log('   -' + k));
    onlyC.slice(0, 8).forEach((k) => console.log('   +' + k));
  }
  miss += onlyB.length; extra += onlyC.length;
}
console.log('\n合计: 基准(' + base + ')独有 ' + miss + ' 键 / 对比(' + cmp + ')独有 ' + extra + ' 键');
```

**合并前基线（2026-10-06，`cloudcli-dev` HEAD）**：`en` 2277 键/9 文件，`zh-CN` 1727 键/8 文件 ⇒ **en 独有 576 / zh-CN 独有 26**。收口判据见 §4.4-5。

## 附录 B：组员与块数索引

**甲组（6）**：QuickSettingsPanelView(3)、Sidebar(1)、SidebarModals(5)、SidebarProjectSessions(4)、SidebarSessionItem(8)、useSidebarController(2) — 共 23 块
**乙组（11）**：ThemeContext(7)、themeContext.test(4)、useSlashCommands(4)、useFileMentions(2)、toolGrouping(2)、ToolGroupContainer(1)、ChatMessagesPane(1)、MessageComponent(1)、EditorSidebar(1)、AppearanceSettingsTab(2)、claude-auth.provider(2) — 共 27 块
**丙组（6）**：shared/utils(2)、shared/types(1)、server/shared/types(1)、CodeEditorHeader(1)、ProjectWorkspaceShell(1)、codex-models.test(1) — 共 7 块
**i18n（24）**：约 36 块

（23 + 27 + 7 + 36 = 93，与实测一致。）

---

## 审阅批注

### Claude

> [!IMPORTANT] B3 与 C3 存在隐含顺序依赖，已实证：`shared/utils` 的 `isSkillCommand`（worktree `:503`）来自丙组 C3「保留上游 SLASH COMMANDS 段」。若 C3 落地时丢了该段，B3 的「删本地 `isSkillCommand`」会直接编译失败。建议在 §5 执行顺序里把该依赖写明（当前顺序恰好 C3 在前，但属巧合而非设计）。另：`useSlashCommands.ts` 的 `:342` / `:364` 两处 `isSkillCommand` 调用点在冲突块之外，删本地定义后需确认共用签名一致——已核语义相同（`command.type === 'skill' || command.metadata?.type === 'skill'`），仅提醒不要顺手改写这两处。

> [!WARNING] B5「WeakMap 缓存 × fork 的 activitySummary」的流式语义未验证：`getToolGroup` 以 run 数组身份为键缓存；若流式期间数组身份稳定而内容增长，则 `activitySummary: summarizeToolGroupActivity(run)` 会在首次计算后冻结，fork 原本每 tick 重算的摘要不再更新。§6 冒烟清单没有对应项，建议补「流式期间折叠组摘要仍刷新」一条，合并时真机验证。

> [!WARNING] B1 块 4 依赖由 `[theme]` 改 `[]` 存在 stale-closure 风险：上游「回调体重读存储」是刻意的去依赖设计，但拼回的 fork 两段（`setThemeIdState(readUserPreference('themeId', null))` 与 `applyUserThemeStyle`）若引用了任何响应式值，`[]` 会闭包过期。落定时应确认这两段全部走「重读存储」模式；做不到就得在依赖数组补值，而不是照抄 `[]`。

> [!NOTE] B1 消费者清点补充（已复核）：`theme`/`setTheme` 的组件消费者确实仅 `ThemeModeSelector.tsx:15`（`:39` 有 `setTheme(value)` 调用），但测试侧还有 `themeContext.test.tsx` 的 `result.current.theme` 断言——文档写 worktree `:310`，当前树实际在 `:264`。B1 选选项 i 时，B2 的改点应按 `result.current.theme` 全文搜，不止点名的那一处。`themeReset.test.ts` / `userThemes.test.ts` 均只用 `themeId`，不受影响。

> [!NOTE] 全文行号均基于 dry-run worktree（冲突态），真正落地时文件是合并后形态，行号必然漂移（上面已现一例：`:310` → `:264`）。执行各项时应按符号定位，不要按行号找。

> [!TIP] §6 冒烟清单建议补两项：① 流式期间折叠工具组摘要仍刷新（对应 B5 的 WARNING）；② skill 斜杠命令三命名空间（project/user/skill）合并后仍生效——B3 的「验收」写了，但冒烟清单 ⑦ 只提 Tab 补全，没覆盖命名空间。

> [!TIP] §4.4-5 要求「跑一次 key diff」但没给可复算命令，§6 清单也无对应行。建议在附录 A 补一条 en 与 zh-CN 键集比对的脚本/命令，并在 §6 加一行期望值，避免收口时凭感觉。

> [!TIP] §5 步骤 1 前建议加一道前置检查：`git status --porcelain` 确认工作区干净再 `git checkout main`（当前仅一份未跟踪研究文档，不影响本次，但步骤应可复用于下次同步）。

#### 第二轮批注：逐项裁定与 §7 十问结论（含实机核验）

**乙组逐项结论**（凡未注明改判者均为「同意文档倾向方案」）：

> [!IMPORTANT] B3 改判（补充连带动作）：上游自带测试 `src/shared/tests/useProjectSlashCommands.test.tsx:65` 断言 `namespace === 'skill'`，且其夹具含 `scope: 'user'` 的 skill（`:51`）。`skillScopeToNamespace` 移植进 hook 后该断言必挂，**必须同步改写为按 scope 断言**。B3 的「连带动作」一节漏了这条，是会直接红测试的缺口，不是可选项。

> [!WARNING] D2/§7-Q7 改判：「删上游 Escape-capture」照原文执行会引入行为退化，理由如下——已核 worktree `QuickSettingsPanelView.tsx:117-140`：上游 capture 监听的注释明说，chat 有 capture-phase abort-on-Escape、编辑器有 close-on-Escape；而 fork 的 Escape 处理（`:191-193`，挂在 `document` 冒泡相）会**输给这些 capture 监听**，出现 Escape 同时「关面板 + 中止流式」的双触发。因此 Escape 关闭确实不会缺失（fork effect 已含），但优先级是错的。建议改法：**保留一条关闭逻辑但换成上游的 capture 机制**（window capture + `defaultPrevented` 守卫），回调里调 fork 的 `setIsOpen(false)`——这样既没有两套逻辑并存，又保住了优先级语义。

> [!NOTE] §7-Q3 结论：**不需要**把 `preferLocalValueOnHydrate` 扩展到 `themeMode`。已核 `src/shared/themeReset.ts`：该渠道是「坏主题 pick 导致界面不可读」的逃生口，清的是覆盖层选中（`themeId`），不清模式；`themeMode` 坏值最多明暗颠倒、不影响可读性，且上游 `readStoredThemeMode` 对未知存储值回落 `system` 已兜底。扩展反而扩大重置副作用。

> [!IMPORTANT] §7-Q4/B2 疑点已实锤——**是有意替换，非合并丢失**：`git log -S "applied without being written back"` 显示该测试由 fork 提交 `4623c522`（偏好迁移 off localStorage）引入、由 fork 提交 `99ea0525`（统一 provider 工作流）删除，当前树中字符串已不存在。可以在本文档把该疑点从「待确认」改记为「已确认，溯源到 99ea0525」。

> [!NOTE] §7-Q6 结论：**不影响**。已核 `ChatMessagesPane.tsx:352/:358`——`deriveExecutionProcessProjection` 与 user anchors 仍用 per-render 的 `getMessageKey`，进程投影/reasoning 分组键不动；`ToolGroupContainer` 仅在组内行键用该 prop（`ToolGroupContainer.tsx:157`），且 `getGroupedMessageKey`（pane `:203`，模块级、身份稳定）正是 memo bail 的前提。B7 取 HEAD + 换键的方案成立。

> [!NOTE] §7-Q5 结论：`skillScopeToNamespace`/`mapSkillToSlashCommand` 的消费者仅 chat 一处（已核全仓 grep）；移植进上游 hook 后，QuickSettings 的 Commands 标签页（`useProjectSlashCommands` 的另一消费者）**自动继承**命名空间语义，无其他依赖方。风险集中在上游测试（见 B3 改判条）。

> [!TIP] §7-Q9 建议的具体审计方法：对 168 个上游文件中**未进冲突清单**的每个文件跑 `git diff <BASE>..cloudcli-dev -- <file>`，凡非空即「双方改了同一文件不同处」的候选，再逐个目检语义是否相斥。这比按目录猜（Sidebar/git-panel/electron）覆盖完整，且可脚本化——建议把清单命令补进附录 A。

> [!TIP] §7-Q10 结论：单 merge commit 够。组内拆分会让「merge 前状态」不可复现（merge commit 的第二父必须恰是 upstream/main），拆修只能落在 merge 之后的后续 commit，收益仅是回滚粒度，代价是历史噪音；§5 已有的「每组跑针对性测试」已覆盖风险控制。§7-Q1 同意接受 D1 代价（重复冲突换 UX 一致性），按 §4.1.1 登记裁决即可；§7-Q8 建议保留 `appearanceSettings.theme.*` 键（与 §4.4-3 建议一致）。

### ZCode

> [!WARNING] D1 的「连带清理」清单不完整，`sessionSelection` 的实际拆除面比文档写的大（以下均已在 dry-run worktree 实证）。文档第 2 条只点了 `SidebarProjectSessions.tsx`、`SidebarSessionItem.tsx` 与上游测试文件，但还有三处不在清单内：① `Sidebar.tsx:265–269` 是**自动合并区**，把 `sessionSelection` 与 `onSetSessionSelection`/`onToggleSessionSelected`/`onCancelSessionSelection`/`onDeleteSelectedSessions` 传给 SidebarProjectList——注意 Sidebar.tsx 唯一冲突块在 287–296，这段不在其中，取 fork 侧不会自动消掉它；② `SidebarProjectList.tsx:47,86`（上游改过的**非冲突**文件）消费 `sessionSelection?.projectId`；③ `useSidebarController.ts` 内部：`:127` state、`:131` ref、`:1055–1153` 的删除确认流程读这两个符号、`:1581` 返回值出口，连带 `setProjectSessionSelection`/`toggleSessionSelected`/`cancelSessionSelection`/`showDeleteSelectedSessionsConfirmation` 等派生回调。照单执行会在 Sidebar.tsx 处编译失败，执行者被迫临场发挥拆除 hook 内删除流程。建议把这三处补进 D1 清单，并给「先拆叶子（SidebarProjectList props、Sidebar.tsx 传参）→ 再拆 hook 内部流程 → 最后删 state/ref」的拆除顺序。另：D1 第 5 条称 `batchArchivedSessionDeleteConfirmation`「被 SidebarContent 使用」与实况不符——直接消费者是 `SidebarModals.tsx`（`:29/:75/:268`）与 hook 内确认流程（`:1279–1303`），`SidebarContent.tsx` 中无该符号；「不可删」结论本身成立，消费方归属宜订正。

> [!IMPORTANT] 回答 §7 问题 6（B7）：已实证改 `getGroupedMessageKey` **不影响** ExecutionProcessSummary / reasoning 分组。`getGroupedMessageKey`（worktree `:203`）是模块级函数，其 JSDoc 明说仅用于折叠组内部行键、由 ToolGroupContainer 自行消歧、且「模块函数身份稳定」正是 memo bail 的前提；而 `deriveExecutionProcessProjection`（`:352`）与 `deriveUserMessageAnchors`（`:358`）消费的仍是 pane 级 `getMessageKey`（`:345`，useCallback）。两层键各司其职，B7 改的只是传给 ToolGroupContainer 的内部行键，可按方案执行。

> [!IMPORTANT] 收敛上一节（Claude）对 B1 块 4 的 stale-closure WARNING：实证支持 `[]` 安全。拼回的两段中，`setThemeIdState(readUserPreference('themeId', null))` 纯重读存储、无响应式引用；`applyUserThemeStyle` 是模块级 import（`:17`），其响应式依赖挂在独立 effect 的 `[applyTarget, userThemeState.status]` 上，不受订阅回调依赖影响。唯一引用响应式 `theme` 的代码（fork 的 `savedTheme` 分支）恰是按方案被丢弃的半段。落定时保持「拼回段只走重读存储」形态即可，不必补依赖。

> [!NOTE] C6 已实证「两侧测试都保留」可行，但工作量比「import 去重」大：这是整文件级 add/add。上游侧仅 2 个测试，断言一律按 value 查找（`findCodexModel`），不碰 `OPTIONS[0]`/列表长度/顺序，与 fork 侧的 `OPTIONS[0]==='gpt-6-astra'`（`:148`）及合并后 provider（gpt-6-astra 仍在 curated 首位）互不冲突。版本闸门实际断言是 `major > 0 || minor >= 155`，对 0.156.1 可过——文档写「`0.1561 ≥ 0.155`」属转写走样，结论不变。两侧测试风格不同构（fork 用 `withIsolatedDatabase` 临时库 + `writeTempCodexConfig`；上游用 `createRequire` 纯目录断言、无数据库依赖），并成一个文件需手工拼接，除 import 外还要核对两侧是否残留同名 helper（本例 helper 名不撞，可放心）。

> [!NOTE] B11 已实证可照方案执行：块 2 上游侧为空（即删 fork 那行 `const settingsEnv = …`）；`:132` 的 `this.loadSettingsEnv()` 改 `readClaudeSettingsEnv()` 后，`loadSettingsEnv` 再无调用方，删除安全；`readFile`/`os`/`path`/`readObjectRecord` 仍被 `readCredentialsFile`（`:171` 起）使用，import 保留正确。

> [!NOTE] §3 口径小订正：`--diff-filter=U` 实测 **46 个 UU + 1 个 AA**（codex-models.test.ts）= 47 文件、93 块与实测吻合；「47 文件…全部 UU…仅 1 处 add/add」措辞自相矛盾，建议改为「46 UU + 1 AA」。

> [!TIP] §6「服务端测试失败集与合并前无新增」需要基线才有意义：建议在 §5 步骤 1 之前先在 `cloudcli-dev` 当前 HEAD 跑一次 `npm test`，把失败名集（A/B）记进本文档或执行手记，否则收口时「无新增」无从比对。

### ZCode（第二轮）

> [!WARNING] D1 拆除清单还需补第 ④ 处：`src/modules/sidebar/tests/sidebarRowProps.test.tsx`（双改自动合并区）的 `listProps` harness（worktree `:65` 形参、`:102–106` 字段）构造了 `sessionSelection` + `onSetSessionSelection`/`onToggleSessionSelected`/`onCancelSessionSelection`/`onDeleteSelectedSessions` 五个选择 props。D1 拆掉 `SidebarProjectList` 的选择设施后，这个测试会编译失败，需把这五个字段从 harness 一并删掉——回写的④⑤⑥与原稿的「移除 sessionBulkSelection.test.ts」都没覆盖它。

> [!WARNING] §5 步骤 0 的「`npm test` 失败集随运行漂移（19~21）」未复现：本机连跑两轮均为 **13 fail / 1103**，失败名集为 opencode spawn ×1、synchronizer ×2、workbuddy/codebuddy getStatus ×4、document model 默认模型 ×2、`resolveClaudeCodeExecutablePath`（Windows）×4——**全部不在本次合并触及的文件域**。建议：① 删掉或订正「（19~21）」括号注，以步骤 0 实跑记录为准；② 收口比对时这 13 条应原样重现，出现名集之外的新失败即回归，与合并相关。

> [!IMPORTANT] 回答 Q3：**不需要**把 `preferLocalValueOnHydrate` 扩展到 `themeMode`，但要在 §8.2 记两条语义变化。机制本体（`userSettings.ts:293`）是「引导期把**固定值**压过服务端副本」的逃生通道，themeReset（`themeReset.ts:59`）只固化 `themeId: null`、从不重置模式轴 ⇒ 无扩展场景。但 B1 落定后要记账：① themeMode 的唯一源从 fork 的「localStorage 优先、镜像兜底」变为「仅镜像」，而 hydrate 是**整体采纳服务端副本**——会话建立前的本地改模式可能在 hydrate 时被服务端旧值回滚（这是上游 #1393 的既有语义，跨设备同步本就如此，接受即可）；② 镜像功能上线前只在 localStorage 写过 `theme` 的存量数据，合并后首次加载会回落 system 一次——fork 写路径两处同写（worktree `:501/:508`、`:527/:529`），之后自愈，不必写迁移。

> [!IMPORTANT] 回答 Q2：**选 i，且比正文写的更简单**。`ThemeModeSelector.tsx` 的局部 `type ThemeMode = 'light'|'system'|'dark'`（`:8`）与 shared/types 的 `ThemeMode` 结构同域，TS 结构化兼容——**不需要导入类型**，「同名」问题只在真正 import 时才出现。落定即三处改名：`:15` 解构 `{ themeMode, setThemeMode }`、`:41` `theme === value` → `themeMode === value`、`:47` `setTheme(value)` → `setThemeMode(value)`，局部类型原样保留。另已核 `DarkModeToggle.tsx:18` 只消费 `isDarkMode/toggleDarkMode`，B1「唯一组件消费者」的清点成立。

> [!IMPORTANT] Q9 已实际扫完一轮（部分收口）：全量 91 个「双方都改」文件中，47 个已在方案冲突清单内，**剩下 47 个走自动合并**（复算命令：`comm -12 <(git diff --name-only 6c51fcaa..upstream/main | sort) <(git diff --name-only 6c51fcaa..cloudcli-dev | sort)` 再减冲突集，行距排序脚本见本批注附注）。结论：① 正文点名的 `SidebarContent`/`SidebarRecentConversations` **不在双改集合里**（单方改动，不存在此类风险）；`git-panel`(行距 10) 与 `electron/desktopWindow.js`(>13) 也排不到热区；② 真正的近距双改前 10：`sessions.service.ts`(1，仅 import 交错)、`ProjectsStateContext.tsx`(1，双方各加各的字段 `renameSession` vs `handleSessionSelect`，良性，但依赖 `useProjectsState.ts` 同时提供两个函数——该文件也在双改清单，typecheck 兜底)、`sessionRowBackgroundWork.test.tsx`(1，良性)、`ChatInterface.tsx`(2)、`Markdown.tsx`(2，上游 LaTeX 二次处理 vs fork 表格包装/导入重排，语义区不相交)、`zh-TW/chat.json`(2)、`useProviderAuthStatus.ts`(2)、`SidebarProjectList.tsx`(2，已在 D1⑤)、`codex-models.provider.ts`(3，C6 已核)、`WorkspaceMain.tsx`(3)；③ `AuthContext.tsx`(13) 抽验良性：上游 `dc7cb6c6` 改启动检查/token 轮换流（tRef + 读存储），fork 只动类型与错误消息解析。⇒ 建议把 Q9 收窄为「执行时对 `ChatInterface`/`useProviderAuthStatus`/`useChatMessages`/`Settings.tsx`/`CodeEditor.tsx` 五个做一次 diff 目检，其余交给 typecheck+测试+冒烟」。

> [!NOTE] 回答 Q4：**有意替换，非合并丢失**。`git log -S "applied without being written back"` 显示该基点测试由 `4623c522`（move user preferences off localStorage）引入、`99ea0525`（unify provider workflows #1206）移除，均在 fork 侧历史内。B2 的「另需确认」可销项。

> [!NOTE] 回答 Q5：`skillScopeToNamespace` **无其它消费者**——全仓仅 `useSlashCommands.ts` 冲突块 C 内 `:108` 定义、`:121` 使用，移植进共享 hook 是自包含改动。顺带提醒：worktree 里 fork 侧还有自己的本地 `mapSkillToSlashCommand`（`:118`）与调用（`:238`），B3-C 落地时连它一起删，别只删 `skillScopeToNamespace`。

> [!TIP] Q1/Q8/Q10 结论：**Q1** 维持 D1 方案 A——替代方案（上游选择系 + fork Manage 管最近/归档）意味着两套选择系统并存，维护面更差，且代价已被 §7.1 的登记机制缓解，把「已裁决」写进 `AGENTS.md` 即可；**Q8** 同意外观键保留并登记「已存在未消费」；**Q10** 单 merge commit——「先 merge 再修」的中间态不可编译，会同时破坏 bisect 与 §6 门禁的语义（门禁必须在可编译的提交上运行），追加修复走合并后的常规提交。

<details><summary>Q9 行距排序复算脚本（基线行号可直接比，双侧 diff 同以 6c51fcaa 为旧文件）</summary>

```bash
git diff --name-only 6c51fcaa..upstream/main | sort > /tmp/up-files.txt
git diff --name-only 6c51fcaa..cloudcli-dev | sort > /tmp/fk-files.txt
comm -12 /tmp/up-files.txt /tmp/fk-files.txt > /tmp/both.txt
git -C /tmp/cloudcli-sync2.KTHw0h diff --name-only --diff-filter=U | sort > /tmp/conflict.txt
comm -23 /tmp/both.txt /tmp/conflict.txt > /tmp/auto-both.txt   # 47 个双改自动合并文件
while read f; do
  git diff 6c51fcaa..upstream/main -- "$f" | grep '^@@' | sed 's/^@@ -\([0-9]*\).*/\1/' > /tmp/up.txt
  git diff 6c51fcaa..cloudcli-dev -- "$f" | grep '^@@' | sed 's/^@@ -\([0-9]*\).*/\1/' > /tmp/fk.txt
  awk -v file="$f" 'BEGIN{min=999999} NR==FNR{up[FNR]=$1; n=FNR; next}
    {for(i=1;i<=n;i++){d=$1-up[i]; if(d<0)d=-d; if(d<min)min=d}}
    END{if(min==999999)min=-1; print min, file}' /tmp/up.txt /tmp/fk.txt
done < /tmp/auto-both.txt | sort -n
```
</details>
