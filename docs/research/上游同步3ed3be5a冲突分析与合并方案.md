# 上游同步 3ed3be5a 冲突分析与合并方案

> 生成时间：2026-09-18（v5，新增 §3.0 各方目的与最终方向总裁定；v4 吸收 v3 复核批注；关键论断均经牵头方独立复核）
> 同步模式：main-first（upstream/main → fork main → cloudcli-dev）
> 状态：**方案定稿，待用户批准执行**（批注原文见 §六）

## 一、背景与同步范围

- fork 当前功能分支：`cloudcli-dev`（HEAD = 34dee092）
- fork `main`（origin/main = 5e73a49b）是 upstream/main 的**纯祖先**，无任何 fork 私有提交 → 冲突①（upstream → main）为纯快进，**无冲突**。
- 冲突②（更新后的 main → cloudcli-dev）经临时 worktree dry-run 预演：**10 个文件、14 个冲突块**。

```
同步范围：5e73a49b..3ed3be5a（15 个提交，70 个文件，+4833/-172）
```

上游主要提交：

| 提交 | 内容 |
|------|------|
| b8e572bd | 印尼语 i18n（#1328） |
| f05ba1fd | 插件推荐 GLM Usage（#1323） |
| b028e0d8 | 侧栏项目头滚动固定（#1312） |
| 5ce8ed45 | Codex 从 canonical typed rollout rows 恢复用户提示词（#1277） |
| 544baffe | OpenCode provider 前缀拼入会话 model id（#1333） |
| f3620803 | OpenCode/Cursor stderr 去 ANSI 转义（#1303） |
| 4b98d2ea | 聊天 markdown 渲染工作区图片路径（#1307） |
| d450ed85 | 压缩（compaction）单行折叠展示（#1295） |
| 7090a5db | Running 状态可折叠项目分组（#1166） |
| a6d50c84 | Codex 支持纯图片 prompt（#1346） |
| ed3f0bfc | OpenCode 隐藏子会话（#1344） |
| 7704a905 | Claude 侧栏显示会话标题而非提示词（#1258） |
| 208c7156 | Claude 后台代理/Workflow 保持 CLI 存活（#1291） |
| 580be52d | 聊天内文件引用跳转修复（#1256） |
| 3ed3be5a | 设置弹窗 Esc/背景点击关闭（#1164） |

依赖变化：**无**（package.json 无 diff）。

---

## 二、冲突清单总览

| # | 文件 | 块数 | 冲突类型 | 建议方案 |
|---|------|-----|---------|---------|
| 1 | `server/modules/providers/list/claude/claude-session-synchronizer.provider.ts` | 3 | 同一函数被两边独立重写 | **整文件取 ours**（fork 为超集），见 §3.1 |
| 2 | `server/modules/providers/list/cursor/cursor-runtime.provider.js` | 2 | fork 的 deltaBatcher 改造 vs 上游 ANSI 清洗 | 手动合并，见 §3.2 |
| 3 | `server/modules/providers/list/opencode/opencode-runtime.provider.js` | 1 | import 行冲突 | 取并集，见 §3.3 |
| 4 | `server/modules/providers/tests/codex-runtime.test.ts` | 1 | 相邻插入测试 | 两边都保留（上游 mock 需补 fork 字段），见 §3.4 |
| 5 | `server/modules/providers/tests/codex-sessions.test.ts` | 1 | 相邻插入测试（共享收尾行） | 两边都保留 + 各补收尾括号，见 §3.4 |
| 6 | `server/modules/websocket/services/shell-websocket.service.ts` | 1 | import 行冲突 | 取并集，见 §3.5 |
| 7 | `src/modules/chat/ChatInterface.tsx` | 1 | 上游新增 Provider 包裹 vs fork 大量私有 props | **只采纳 Provider 包裹**，两个上游 prop 不采纳，见 §3.6 |
| 8 | `src/modules/chat/hooks/useChatMessages.ts` | 1 | 同一对象两行属性插入 | 两行都保留，见 §3.7 |
| 9 | `src/modules/chat/transcript/Markdown.tsx` | 2 | fork i18n 改造 vs 上游 openDirectory | 手动合并取并集，见 §3.8 |
| 10 | `src/modules/settings/Settings.tsx` | 1 | fork 移动端键盘避让 vs 上游背景点击关闭 | 手动合并两者叠加，见 §3.9 |

---

## 三、逐文件冲突分析与方案

### 3.0 各方修改目的与最终方向总裁定（v5 新增）

> 复核方法：fork 侧目的取自 `git log $(merge-base)..cloudcli-dev -- <file>` 的提交链语义（Markdown.tsx 例外：其 fork 改造经历次 merge 提交带入，无独立功能提交，目的从改动内容与所在 merge 的主题判定）；上游侧目的取自 §一 提交表。

**裁定总表**：每个冲突先回答"双方各自要什么"，再定方向。方向共三类——

| 方向类型 | 含义 | 适用 |
|---------|------|------|
| A. 目的正交 → 并集叠加 | 双方要的东西互不排斥，物理合并即可 | §3.2、§3.3、§3.4、§3.5、§3.7、§3.8、§3.9 |
| B. fork 目标 ⊃ 上游目标 → 保留 fork，上游测试作验收 | 上游想要的效果 fork 已有且更好 | §3.1 |
| C. 上游方向更先进 → 以上游为主干，保留 fork 独有语义 | 上游是新架构/权威数据源，fork 的旧手段应让位 | §3.6（Provider 基建）、§四.1（typed 图片源） |

| 冲突 | fork 目的（提交链） | 上游目的（提交） | 裁定 |
|------|---------------------|------------------|------|
| §3.1 标题提取 | 标题质量递进：DSH 同步增强（54c10dc6）→ 会话分支（2663431b）→ ai-title 优先（8b12c0a6）→ **自定义名称来源**（e25436f0）→ **来源升级与历史回填**（102e94a9，name_source 成熟）→ 编辑 prompt 顶开旧 transcript（d2f0833b）。核心：**标题来源可追溯（name_source）并驱动更新策略** | #1258：单一目标——侧栏显示标题而非提示词，无来源概念 | **B**：fork 机制已实现上游效果且带来源追踪；上游 410 行回归测试全过即验收 |
| §3.2/3.3 cursor/opencode | delta 合并抽到 shared 并接入（8f7c134b，流式消息批处理=减少碎片）+ 中止后不泄漏残留 delta（4405c238，**生命周期正确性**） | #1303：stderr 去 ANSI（**错误文本在聊天里可读**） | **A**：一个管流式通道、一个管文本清洗，正交；清洗后的文本走 send() |
| §3.4 codex 测试 | SDK 升级配套 + 生命周期（a2ca26a8）、分叉会话 history_base（d77c633a）、reasoning 流式（aa4ff521） | #1346：纯图片 prompt 支持 | **A**：互不相关的测试增量，全保留 |
| §3.5 shell-websocket | 接入 Pi（22313017）、ZCode（57d4ee69）、WorkBuddy 路径修复（43e362c4）三个私有 provider 启动命令 | #1303 部分：shell 输出去 ANSI + helper 迁 shared | **A**：正交，import 并集 |
| §3.6 ChatInterface | 交互能力矩阵：搜索定位、消息编辑、会话 fork、滚动/思考态（多提交）；且**有意删除**了 `currentSessionId`（b29c5896 精简空态判断——上游只用于空态文案）与 `loadFullTranscript`（fork 分页方案替代全量加载） | #1307+#1256：markdown 需拿到 workspace 上下文（图片路径、文件引用）——**新渲染基建** | **C**（基建部分）：Provider 是 fork 没有也不排斥的增益，采纳；两个 prop 的不采纳**不是权宜而是 fork 架构演进方向**（fork 用分页替代全量、空态不需要会话 id）。独立判断项：空态文案是否需要区分会话 |
| §3.7 useChatMessages | `forkAnchorId` = 会话分叉锚点（19a3400c 分离派生/编辑锚点、a0c65080 Turn Segment 稳定行身份）；`66f4ac03` 工具内容保留行结构（**结构化 content**） | #1295：compaction 折叠展示——压缩作为一行说出来（**假设 content 是字符串**） | **A**：一个管锚点身份、一个管压缩行；类型守卫正是保护 fork 的结构化 content 目的不被上游的字符串假设破坏 |
| §3.8 Markdown.tsx | i18n 中文化（t()，经 merge 2a9bfa95/dddd8698 带入的移动端/中文适配成果） | #1256：openDirectory——目录型引用跳转 | **A**：正交，并集 |
| §3.9 Settings.tsx | 移动端键盘避让（5d22d769）+ 快捷回复管理（b65ce526）+ ZCode/Pi 权限模式（19bdee1d） | #1164：弹窗可关闭性（Esc/背景） | **A**：可关闭性与键盘避让不冲突，叠加；iOS 触发差异真机确认 |
| §四.1 codex-sessions 重复分支 | 图片经 `pendingUserImagesByTurnId`（旧 SDK 时代的旁路手段）+ 分叉历史 history_base 语义 | #1277：从 **canonical typed rows** 直接恢复 prompt 与 `local_image`——新 SDK 的**权威数据源** | **C**：上游数据源方向更先进，**以上游分支为主干**，保留 fork 的 turn 锚定与 pending 回落；与 §3.1 裁定相反，勿一刀切"保留本地" |

**两点提炼**：
1. **方向 C 与 B 并存说明"保留本地"不是默认答案**——§3.1 保留 fork 是因为 fork 是超集；§四.1 反过来以上游为主干是因为 typed rows 是权威来源，fork 的 pending 旁路是旧 SDK 时代的替代手段，应让位为回落兜底。
2. 所有方向 A 的冲突，双方目的在**不同关注点**（通道/文本、锚点/渲染、避让/关闭），物理并集即语义并集；不需要任何一方让步。

### 3.1 claude-session-synchronizer.provider.ts（3 块）— 最大风险点

**涉及上游提交**：7704a905（Claude 侧栏显示会话标题而非提示词）

**冲突原因**：fork 的 name_source 功能（`SessionNameSource` 追踪标题来源）与上游 #1258 对同一段标题提取逻辑做了两次独立重写。

**本地（fork）实现****要点**（`claude-session-synchronizer.provider.ts:225`、`:251`、`:334`）：

- `sessionNameSource` 贯穿返回值与 DB（`shared/types.ts` 中的 `SessionNameSource` 类型）
- `extractSessionAiTitleFromEnd`：**倒序**扫描，遇 `custom-title` 且非 backfill 场景**立即返回**（`claude_custom_title`）；否则记录倒序首个（即最新）`ai-title` / `last-prompt`
- 兜底链：`extractSessionAiTitleFromEnd` → `nameMap`（`history_display`）→ `extractFirstUserMessage`（`first_user_prompt`，处理 `/clear` 后关闭的会话）

**上游实现****要点**（`extractSessionTitle`）：

- **正序**扫描，逐类**保留最后一次**出现值，优先级 `custom-title > ai-title > last-prompt`
- 上游注释明确说明正序的原因：*"Claude writes `custom-title` immediately before `ai-title`, so a reverse scan that returns its first hit would always lose the manual rename."*

**语义等价性分析**（这是本方案的核心论断，请审阅者重点核查）：

1. 上游担心的坑——倒序扫描首个命中即返回会丢手动改名——**fork 已规避**：fork 倒序扫描时遇到 `ai-title` 并不返回，只有命中 `custom-title` 才早退（文件序 `custom-title` 在 `ai-title` 之前，倒序先读到 `ai-title` 不会早退，继续读到 `custom-title` 才返回）。
2. 两边都取"每类的最新值"，优先级也一致（`custom > ai > lastPrompt`）。差异仅在扫描方向与实现手法。
3. fork 额外具备而上游没有的：来源追踪（`SessionNameSource`）、`history_display` 中间层、`first_user_prompt` 兜底、backfill 的 `includeLastPrompt` 全量扫描模式。

**方案（v2 修订，原"三个冲突块保留本地"不成立）**：**本文件整取 ours**（`git checkout --ours -- <file>` 后 `git add`）。

**v2 修订依据（WorkBuddy 批注缺陷 1，牵头方已独立复核合并态）**：仅按冲突块取 ours 会把 git"自动合并成功"的两段拼成混合体——合并态 `:267` 的方法头来自上游（`extractSessionTitle` + 正序 docstring），而 fork 侧调用点（冲突块内 `:227`、自动合入的 backfill `:431`）仍写 `extractSessionAiTitleFromEnd`，方法名对不上；方法尾同时保留 fork 的三段 `return { name, source, lastPrompt }` 与上游的 `return foundCustomTitle || foundAiTitle || foundLastPrompt;`，而 `found*` 变量只在冲突块 THEIRS 侧声明，作用域对不上。实测 typecheck 报 5 条编译错。
而上游在本区间对该文件的全部改动只有四处：加 docstring、方法改名、扫描方向与变量名改写、加尾返回——**这四处全部被 fork 实现覆盖，整文件取 ours 不丢任何上游资产**。

**遗留疑问（已关闭）**：上游正序保留"最后一次" `custom-title`，fork 倒序早退返回的同样是"最后一次"；backfill 路径 `customTitle` 只取倒序首个（即最新）。Codex 与 WorkBuddy 均确认无反例，WorkBuddy 补充：上游注释批评的是 base 版旧实现（"倒序首命中即返回，custom-title 排最后必输"），不适用于 fork。**论断成立。**

**合并后需验证**：
- 上游 `claude-sessions.test.ts` 若有 #1258 新增用例，**保留并运行**（回归资产）；失败时优先补进 fork 实现或测试，不得因"保留本地"删上游测试（Codex 批注要求）；
- fork 侧 `name_source` 相关测试合并后全量重跑。

### 3.2 cursor-runtime.provider.js（2 块）

**涉及上游提交**：f3620803（stderr 去 ANSI）

**块 1（import 行）**：

- 本地：`createCompleteMessage, createDeltaBatcher, createNormalizedMessage, flattenPromptForWindowsShell`
- 上游：`createCompleteMessage, createNormalizedMessage, flattenPromptForWindowsShell, stripAnsiSequences`
- 方案：**取并集**（保留 `createDeltaBatcher`，加 `stripAnsiSequences`）。

**块 2（stderr 发送）**：

```javascript title=上游 f3620803 的 stderr 清洗逻辑
// The CLI styles its stderr for a terminal; the chat renders plain
// text, so the escapes have to go before the text is surfaced.
const cleanedStderrText = stripAnsiSequences(stderrText);
if (!cleanedStderrText.trim()) {
  return;
}

ws.send(createNormalizedMessage({ kind: 'error', content: cleanedStderrText, ... }));
```

本地侧同位置是 `send(createNormalizedMessage(...))` —— fork 引入了 `deltaBatcher`（`cursor-runtime.provider.js:66`、`:75` 的 `const send = (message) => deltaBatcher.send(message)`）。

**方案**：**清洗逻辑采用上游，发送通道保留本地**：

```javascript title=方案：清洗用上游、通道用 fork 的 send()
const cleanedStderrText = stripAnsiSequences(stderrText);
if (!cleanedStderrText.trim()) {
  return;
}

send(createNormalizedMessage({
  kind: 'error',
  content: cleanedStderrText,
  sessionId: capturedSessionId || sessionId || null,
  provider: 'cursor',
}));
```

理由：fork 的 deltaBatcher 是全局流式批处理改造，error 消息走批处理通道与 fork 其他 error 路径一致。

**v2 附注（疑问已关闭）**：Codex 与 WorkBuddy 按全量出站点核对，fork HEAD 的 cursor 出站消息除 batcher 内部 flush 出口（`:73`）外全部走 `send()`，stderr error（`:318`）与 process error（`:375`）本就在 `send()` 上；`createDeltaBatcher` 契约是非 delta 帧先 flush 旧 delta 再发送，不破坏流式顺序。**结论：走 `send()`，不改回 `ws.send`。** 另 trust-retry 顺序无需额外动作：合并态里 `shouldSuppressForTrustRetry(stderrText)` 在冲突块之上、用原始 `stderrText`，strip ANSI 在冲突块内，边界已把顺序固定住。

### 3.3 opencode-runtime.provider.js（1 块）

import 行冲突，同 §3.2 模式：

- 本地：`... createDeltaBatcher ... getOpenCodeDatabasePath`
- 上游：`... getOpenCodeDatabasePath, stripAnsiSequences`

**方案**：取并集。文件体内上游对 stderr 的 `stripAnsiSequences` 调用已自动合入（无冲突），只需修 import。**合并后需读一遍该文件 stderr 段确认自动合入的调用点与 fork 的 `send` 通道一致。**

### 3.4 codex-runtime.test.ts / codex-sessions.test.ts（各 1 块）

**冲突原因**：两边在文件同一位置各自追加了新测试，git 视为相邻插入冲突，**非逻辑冲突**。

- 本地新增：native item id 生命周期、SDK reasoning usage 字段读取、fork 历史/`history_base`/superseded 会话测试
- 上游新增：纯图片 prompt 测试（a6d50c84）

**方案（v2 修订）**：**两边测试全部保留**，但两个文件处理方式不对称：

- `codex-runtime.test.ts`：干净的相邻插入，直接拼接即可。
- `codex-sessions.test.ts`：两侧**共享了尾部收尾行**（`} finally {` + `await rm(...)` + `}` + `});`），直接拼接报 `TS1005: '}' expected`。须给两侧各补一份收尾——OURS 的 finally 体是 `await rm(...)`，THEIRS 是 `restoreHomeDir(); await rm(...)`，括号各补各的（WorkBuddy 批注缺陷 2）。
- **上游 #1346 纯图片 prompt 用例在 fork 里编译不过**：其 `ProviderRuntimeContext` 字面量缺 fork 追加的 `resolveProviderConfigDir` / `resolveSettingsFile`（`server/shared/types.ts:493`、`:500`），报 TS2739。须给该 mock 补两行 `resolveProviderConfigDir: () => null,` / `resolveSettingsFile: () => null,`（fork 同文件 `:39`–`:47` 已有样板）。
- 流程提醒：`npm test` 走 tsx **不做类型检查**，上述只会被 `npm run typecheck` 暴露。

### 3.5 shell-websocket.service.ts（1 块）

import 行冲突：

- 本地：`parseIncomingJsonObject` + `getPiCommand, getWorkbuddyCommand, getZcodeCommand`（**fork 私有 provider 启动命令，绝不能丢**）
- 上游：`parseIncomingJsonObject, stripAnsiSequences`

**方案**：

```typescript title=方案：import 取并集
import { parseIncomingJsonObject, stripAnsiSequences } from '@/shared/utils.js';
import { getPiCommand, getWorkbuddyCommand, getZcodeCommand } from '@/modules/providers/index.js';
```

文件体内上游用 `stripAnsiSequences` 清洗 shell 输出的改动已自动合入，无额外处理。

**v2 附注（疑问已关闭）**：fork 原有的本地 `function stripAnsiSequences`（fork HEAD `:41`）在合并态已被上游删除（helper 迁到 shared utils 时删的，fork 未改该区域），不存在同名遮蔽。唯一注意：合并后 `@/shared/utils.js` 只能留**一条** import（冲突两侧都含 `parseIncomingJsonObject`）。

### 3.6 ChatInterface.tsx（1 块）— 上游新架构引入点

**涉及上游提交**：4b98d2ea（图片路径渲染）+ 580be52d（文件引用跳转），二者共同依赖新文件 `src/modules/chat/context/MarkdownWorkspaceContext.ts`。

**上游改动**：

1. 在 `<ChatMessagesPane>` 外包一层 `<MarkdownWorkspaceContext.Provider value={markdownWorkspaceValue}>`
2. `ChatMessagesPane` 新增 `currentSessionId` prop

**本地改动**：`ChatMessagesPane` 的 props 大量 fork 私有扩展——`searchRevealRequest`、`isUserScrolledUp`、`onReasoningAutoCollapseStart`、消息编辑（`onEditMessage`）、会话 fork（`onForkFromMessage`）等（`ChatInterface.tsx:471`、`:510`）。

**方案（v2 修订，原"currentSessionId 全部采纳"不成立）**：手动合并——**只采纳 `<MarkdownWorkspaceContext.Provider>` 包裹层；`currentSessionId` 与 `onLoadFullTranscript` 两个 prop 均不采纳；本地全部 props 原样保留**：

**v2 修订依据（WorkBuddy 批注缺陷 3，牵头方已独立复核 fork HEAD）**：

1. fork 的 `ChatMessagesPane`（`src/modules/chat/transcript/ChatMessagesPane.tsx`）**没有** `currentSessionId` 这个 prop——它在 `b29c5896` 中被有意删掉（上游只在其内部的 `ProviderSelectionEmptyState` 上用到）。照原方案采纳即报 TS2322。真要采纳须连带改 `ChatMessagesPane.tsx` 与 `ProviderSelectionEmptyState`，不混在冲突解决里顺手做（列为独立判断项，见下）。
2. 同一冲突块 THEIRS 侧还带 `onLoadFullTranscript={loadFullTranscript}`——该 prop 与函数在 fork 里已被整体删除（`src/` 内 0 处出现，`c90eaf58`、`99ea0525`），照 THEIRS 取报 TS2304。

```jsx title=方案v2：仅采纳 Provider 包裹，fork props 原样保留
<MarkdownWorkspaceContext.Provider value={markdownWorkspaceValue}>
  <ChatMessagesPane
    scrollContainerRef={scrollContainerRef}
    /* … fork 全部私有 props 原样保留，currentSessionId / onLoadFullTranscript 不加 … */
  />
</MarkdownWorkspaceContext.Provider>
```

**独立判断项（合并后再议，不阻塞本次同步）**：fork 的 `ChatMessagesPane` 内部是否需要 `currentSessionId` 传给 `ProviderSelectionEmptyState`（上游用它区分空态文案）。

**注意事项**：
- `markdownWorkspaceValue` 的定义来自上游对组件上方的改动（自动合入），合并后需确认变量确实存在且类型对齐；
- 若 fork 私有子组件（如消息编辑浮层）渲染在 `ChatMessagesPane` 内部，它们现在也处于该 Context 下，理论上是纯增益；
- **合并后必须验证**：#1307（图片路径）与 #1256（文件引用跳转）两个修复在 fork 环境下实际生效（发一条带本地图片路径的消息 + 一条含 `file:line` 引用的消息）。

### 3.7 useChatMessages.ts（1 块）

同一映射对象内两边各插一行：

- 本地：`forkAnchorId: msg.forkAnchorId,`
- 上游：`compact: msg.compact,`（配合 d450ed85 压缩折叠展示，`shared/types.ts` 自动合入的 `compact` 字段）

**方案（v2 升级）**：**两行都保留，且必须给上游自动合入的 `appendCompactionRow`（fork HEAD 0 处、纯 #1295 新增，落在 `useChatMessages.ts:97`）做 content 类型守卫**：

```typescript title=方案：两行并存
      forkAnchorId: msg.forkAnchorId,
      compact: msg.compact,
```

**v2 修订依据（WorkBuddy 批注缺陷 5，已独立复核合并态）**：`appendCompactionRow` 按 `msg.content` 是字符串来写（`const content = msg.content || ''; const text = content.trim();`），而 fork 侧工具结果消息的 `content` 可以是对象/数组，真机会抛 `content.trim is not a function`。实测 `vitest run src/modules/chat` 由基线 434/434 变 2 failed（`indents a structured object tool result` 等）。

**v4 修法收敛（两位审阅者一致）**：复用同文件 `useChatMessages.ts:9` 的现成样板 `formatToolResultContent()`（`typeof content === 'string' ? content : JSON.stringify(content, null, 2)`），或在 `appendCompactionRow` 里做一次 `typeof content === 'string'` 判断即可；**不引入新渲染分支或消息类型，不扩大处置范围**。另 WorkBuddy 已确认：`appendCompactionRow` 在 `normalizedToChatMessages` 循环里**无条件、先于 switch** 调用（合并态 `:326`），`MessageComponent.tsx:194` 的 `message.compact ?` 可达——**这是纯类型/运行时问题，不是又一个"不可达分支"**。

### 3.8 Markdown.tsx（2 块）

**涉及上游提交**：580be52d（文件引用跳转，`usePaletteOps` 新增 `openDirectory`）

- 块 1：本地 `const { openFileInEditor } = usePaletteOps(); const { t } = useTranslation('chat');` vs 上游 `const { openFileInEditor, openDirectory } = usePaletteOps();`
- 块 2（useCallback 依赖数组）：本地 `[openFileInEditor, t]` vs 上游 `[openFileInEditor, openDirectory]`

**方案**：取并集：

```typescript title=方案：块1 并集
  const { openFileInEditor, openDirectory } = usePaletteOps();
  const { t } = useTranslation('chat');
```

```typescript title=方案：块2 依赖数组并集
    [openFileInEditor, openDirectory, t],
```

同时核对上游在 `Markdown.tsx` 体内对 `openDirectory` 的调用点（目录型链接跳转）已自动合入且与 fork 的 `t()` 用法不冲突。

### 3.9 Settings.tsx（1 块）

**涉及上游提交**：3ed3be5a（设置弹窗 Esc/背景点击关闭）

- 本地：模态根节点带移动端键盘避让（`Settings.tsx:157` `style={{ bottom: 'var(--keyboard-height, 0px)' }}`，配套 `:191` 的 safe-area padding）
- 上游：同节点新增 `onMouseDown={handleBackdropMouseDown}` / `onClick={handleBackdropClick}`

**方案**：**两者叠加**——保留键盘避让 style，加上游两个事件 handler：

```jsx title=方案：键盘避让 + 背景关闭叠加
    <div
      className="modal-backdrop fixed inset-0 z-[9999] flex items-center justify-center bg-background/80 backdrop-blur-sm md:p-4"
      style={{ bottom: 'var(--keyboard-height, 0px)' }}
      onMouseDown={handleBackdropMouseDown}
      onClick={handleBackdropClick}
    >
```

**风险（v2 已证否）**：移动端键盘弹出时点击背景关闭弹窗的担忧**在当前布局下不成立**——WorkBuddy 指出：fork 的面板容器是 `flex h-full w-full … md:h-[90vh] …`，移动端内层就是整屏；backdrop 又被 `bottom: var(--keyboard-height)` 抬高底边，键盘弹出时面板跟着变矮，**不会露出可点的 backdrop 带**。Codex 与 WorkBuddy 一致表态：接受叠加，暂不加键盘期间禁用逻辑，真机验证确有误触再加 guard。`handleBackdropMouseDown` / `handleBackdropClick` 定义在上游对文件上部的改动中（自动合入），合并后确认存在。真机唯一需确认项：iOS 上 `onMouseDown` 与 `onClick` 是否都能触发（上游 Esc 路径在移动端没有等价物）。

---

## 四、非冲突但需复核的自动合入风险

1. **`codex-sessions.provider.ts`（严重，v2 新增，WorkBuddy 批注缺陷 4，已独立复核合并态）**：该文件不在冲突清单里（git 报 Auto-merging 成功），但合并结果在 `getCodexSessionMessages` 里把**同条件分支写了两遍**：fork 分支（合并态 `:1502`）`item_completed + UserMessage`，图片取自 `pendingUserImagesByTurnId`，末尾 `continue`；上游 #1277 新增分支（合并态 `:1576`）同条件，图片改用 `extractCodexTypedUserImages(item.content)` 直接从 typed `local_image` 项取。**fork 分支在前且有 `continue`，上游那份永远不可达**——上游自带的回归用例 "Codex history restores user prompts from typed item_completed rows" 因此失败（文本能恢复，但 `images[0].path` 为 undefined，期望 `/tmp/prompt-picture.png`）。**处置：合并后把两分支合一**——typed item 里有图就用 typed 的，没有才回落 `pendingUserImagesByTurnId`；注意两侧图片类型不一致（fork 侧 `Array<{ data: string }>`，上游侧 `Array<{ path?, data? }>`），合一时对齐 `CodexHistoryResult` 的 images 类型。上游分支还有 `anchoredTurnIds`（编辑切分按 turn 锚定）语义，合一时保留。
2. **`shared/types.ts`**：上游 +45 行（compact、图片上下文等类型）。fork 也改过此文件（`SessionNameSource` 等），自动合入成功但**建议合并后通读一遍**确认无类型语义覆盖。
3. **侧栏系列**（`Sidebar.tsx`、`SidebarProjectItem.tsx`、`useSidebarController.ts` 等）：git 报告 Auto-merging 成功，但 fork 对侧栏有大量改造（会话标题 name_source 显示）。#1258 的"显示标题而非提示词"与 fork 的 `sessionNameSource` 展示逻辑可能在非冲突行产生**行为叠加**，需在真机上复核侧栏标题显示。
4. **新增测试文件**（`claude-compaction.test.ts`、`claude-background-work.test.ts` 等 10 个）：直接落盘，合并后统一跑测试套件验证。
5. **`WorkspaceMain.tsx` / `useFileOpenResolver.ts`**（#1256）：fork 有自己的 file-open 改造，自动合入后需回归"点击聊天内文件引用 → 打开编辑器"链路。
6. **既有重复勿顺手清理（v2，WorkBuddy 方法学提醒）**：`codex-sessions.provider.ts:1521/:1523` 有一对重复注释，fork 与 upstream **各自都有**，属既有重复，不是本次合并带来的，不要顺手删。

---

### §四.5 双改交集全量清单（v3 新增，最大的未审计面）

> 本次同步中 fork 与 upstream **都改过**的文件共 **33 个**；冲突清单只覆盖 10 个，其余 23 个被 git 判定 auto-merge 成功。WorkBuddy 在 `codex-sessions.provider.ts` 抓到的不可达分支证明：**这类"双改但无冲突"文件可能藏静默行为回退，且 typecheck / tsc 抓不全**。合并前应对下列高危文件逐个静态复核（方法：`git diff <合并态> <fork HEAD> -- <file>` 看上游在该文件实际落了什么 + 是否与 fork 同区域）。

双改交集全量（冲突文件加 ★）：

| 分组 | 文件 | 风险点 |
|------|------|--------|
| Claude provider | `claude-session-synchronizer.provider.ts` ★ | §3.1 已处置（整取 ours） |
| | `claude-runtime.provider.js` | **208c7156 后台保活（+24 行）落进 fork 改造过的 runtime**，§四 原文漏列——需复核保活逻辑与 fork 的 deltaBatcher/进程管理是否叠加 |
| | `claude-sessions.provider.ts` | **升格高危（v4）**：同一文件吃到**两个**上游提交——f3620803（#1303，删本地 `stripAnsiFormatting`、改调 shared）**和 d450ed85（#1295，+76 行 compaction 服务端半**，往 normalizer 插 `system` / `compact_boundary` / `status` 分支）；fork 在同一函数附近也有改动（fork 侧 hunk `@@ -668`、`@@ -680,10 +686,37`），属"同函数相邻插入、auto-merge 成功"——**正是 §四.5 要找的形态，而 §3.7 只处置了客户端半（`appendCompactionRow`）**。处置对齐 §四.1：合并后先跑 `claude-compaction.test.ts` + `claude-sessions.test.ts`，人工确认压缩行在 fork 会话里正常出（合并态本地 `stripAnsiFormatting` 已随上游删除，无同名遮蔽） |
| | `claude-models.provider.ts` | fork 是否改过模型列表逻辑 |
| Codex | `codex-runtime.provider.ts`、`codex-sessions.provider.ts`（§四.1）、`codex-runtime.test.ts` ★、`codex-sessions.test.ts` ★ | §四.1 已列合一 |
| 其他 provider | `cursor-runtime.provider.js` ★、`opencode-runtime.provider.js` ★ | §3.2/§3.3 已处置 |
| server 共享 | `sessions.db.ts` | **v4 修正**：上游本区间净改动仅 +8 行（`deleteSessionByProviderSessionId()`，供 #1344 OpenCode synchronizer 删子会话），**无 schema/migration 叠加**；fork 的 `name_source` INSERT/UPDATE CASE 改动与其不同区域，auto-merge 干净。真正要复核的是 **#1344 链路本体**（`opencode-session-synchronizer.provider.ts` +32、`opencode-sessions.test.ts` +41）——fork 未改过这两个文件、不在本清单，已列入 §五 验收 |
| | `session-conversations-search.service.ts` | fork 全文搜索改造 vs 上游 |
| | `shell-websocket.service.ts` ★、`server/shared/types.ts`、`server/shared/utils.ts` | utils 是 fork 大量私有工具（deltaBatcher 等）与上游 `stripAnsiSequences` 共存处，防同名遮蔽 |
| 测试 | `claude-sessions.test.ts`（**双改 + 上游 410 行新增**） | fork 版与上游 #1258 用例 auto-merge 后**必须全过**——这是 §3.1 整取 ours 的直接验收 |
| 前端 chat | `ChatInterface.tsx` ★、`useChatMessages.ts` ★、`Markdown.tsx` ★、`MessageComponent.tsx` | MessageComponent 承接 compact 折叠与图片渲染的展示层，fork 有大量消息渲染改造，**需静态复核** |
| 侧栏 | `Sidebar.tsx`、`SidebarProjectItem.tsx`、`SidebarProjectList.tsx`、`useSidebarController.ts`、`sidebarRowProps.test.tsx` | §四.3 已提真机复核，此处升格为"先静态 diff 复核再真机" |
| i18n | `config.ts`、`en/chat.json`、`en/settings.json` | **v4 修正（原结论反了）**：缺 key **不会显示裸 key**——`config.ts` 有 `fallbackLng: 'en'`，新 key（`chat.misc.compacted` 等）在其余 locale 回退英文，现象是"少翻译"不是 bug。上游 #1328 的 `id` 语言包与 `config.ts` 的 `id:` 条目已确认与 fork 私有 locale 并存未被覆盖 |
| 其他 | `McpServerFormModal.tsx`、`WorkspaceMain.tsx`、`ProviderLoginModal.tsx`、`Settings.tsx` ★、`src/shared/types.ts` | WorkspaceMain 已列真机回归；ProviderLoginModal 关系 fork 私有 provider 登录（Pi/ZCode 等） |

**复核方法（v4 补双向）**：每个文件做**两个方向**的 diff——
- `git diff <fork HEAD> <合并态> -- <file>`：上游净落地了什么（是否落进 fork 也动过的函数）；
- `git diff <合并态> <fork HEAD> -- <file>`：fork 的改动有没有被上游盖掉。
只看单方向会漏掉第二种失效（WorkBuddy / Codex 一致建议）。

---

## 五、合并执行步骤（v3，含验证门槛与执行时序；待用户批准后执行）

**第 0 步（前置，v4 修订）**：工作区确认。主仓的不属于本次同步的未提交改动（三个 auth provider 的 spawn.sync 判活修复 + 未跟踪的 `provider-installed-detection.test.ts`）**归属已确认为用户另一需求**，不必放弃。但因 `claude-auth.provider.ts` 在 origin/main 与 cloudcli-dev 间有提交差异（牵头方已验证，2+/15-），**`git checkout main` 仍会被这批脏文件阻塞**，须三选一：① 先单独 commit 到 cloudcli-dev（推荐，改动与配套测试是完整功能，勿混进 merge commit——未跟踪文件不 `git add` 即不会进）；② stash 后同步完恢复；③ 用独立 worktree 更新 main。**另两点**：`npm test` 的 glob 会捕获未跟踪的测试文件，主仓直接跑会污染基线计数；`npm run build` 会写 `dist`/`dist-server`，勿在主仓跑——**全部验证在干净 worktree 里做**。

1. `git checkout main && git merge --ff-only upstream/main`（纯快进，无风险），回 `cloudcli-dev`
2. `git merge main`，按 §3.1–§3.9 逐文件处理冲突（Edit → `git add`）：
   - §3.1 文件整取 ours（`git checkout --ours -- <file>`）
   - §3.6 只加 Provider 包裹，`currentSessionId` / `onLoadFullTranscript` 不采纳
   - 其余按各节方案
3. 处理 §四.1（`codex-sessions.provider.ts` 重复分支合一）及 §3.4 的测试 mock 补字段
4. 通读 §四 列出的其余自动合入文件；**逐个静态复核 §四.5 双改交集清单**（合并态 vs fork HEAD 的 diff）
5. **验证门槛（v3 补全；顺序不可换）**：
   - **先 `npm run typecheck`**（本次两处缺陷只有 typecheck 能抓到：tsx / vitest 都不查类型；已核实该 script 覆盖 `tsconfig.json` 与 `server/tsconfig.json` 两侧）
   - 再 `npm test`、`npm run test:client`
   - **基线口径（v4 已补全，WorkBuddy 在干净 34dee092 worktree 实测）**：

     | 门槛 | 基线数字 |
     |------|---------|
     | 两侧 `tsc --noEmit` | 0 错 |
     | `vitest run src/modules/chat` | 434/434 |
     | `vitest run src/modules/sidebar` | 4 文件 / 21 用例全过 |
     | `npm run test:client` 全量 | 91 文件 / 655 用例全过 |
     | `npm test`（server 全量） | 765 用例：755 pass / **9 fail** / 1 skip |
     | 两个 codex 测试文件 | 28/28 |

     **关键：`npm test` 基线不是 0 failed，是 9 个（既有失败，环境依赖/断言不匹配类，与本同步无关）。必须按用例名对比，不能只看计数**——"9 个基线失败 + 合并引入 1 个新失败 + 掩盖 1 个基线失败"在计数上与"9 个"无法区分。基线失败名单（8 个名字，其中 `synchronizer keeps the app-assigned name...` 在两个文件各失败一次）：
     - `resolveClaudeCodeExecutablePath` 系列 ×4（`leaves non-Windows...` / `returns undefined on Windows...` / `returns undefined when every wrapper...` / `still resolves the native exe...`）
     - `getStatus` 系列 ×3（WorkBuddy 可执行文件探测相关：`detects a codebuddy executable on PATH` / `detects the CLI embedded in WorkBuddy.app` / `reports an installed but desktop-managed WorkBuddy engine`）
     - `synchronizer keeps the app-assigned name and does not duplicate app sessions` ×2
     另：全套跑偶发多 2 个负载相关失败（`workbuddy-runtime.test.ts`、`websocket/tests/chat-edit-send.test.ts`），单跑即过，不追。
   - **构建门槛（v3 新增）**：`npm run build`（`build:client` vite + `build:server`）——typecheck 过不等于 build 过，且部署链路依赖 dist。**在验证 worktree 里跑，勿污染主仓 `dist`**
   - **上游新测试验收（v4 补全为完整清单）**——上游本区间新增 **10 个测试文件** + `opencode-sessions.test.ts`（#1344 修改），**全部保留并通过是"保留本地"类决策的验收标准**：
     - server 侧：`claude-sessions.test.ts`（含 #1258 的 410 行新增）、`claude-compaction.test.ts`、`claude-background-work.test.ts`、`strip-ansi-sequences.test.ts`、`opencode-sessions.test.ts`（#1344 子会话隐藏，fork 未改过此文件、不在 33 清单，**v4 增列**）
     - client 侧（走 `npm run test:client` 不会漏跑，但须纳入验收口径，**v4 增列**——漏掉的正是 §3.6 / §3.7 人工项的自动断言兜底）：`compactionRows.test.ts`（#1295，149 行）、`markdownImage.test.tsx`（#1307）、`fileReferenceLinks.test.tsx`（#1256）、`revealDirectory.test.ts` / `revealDirectoryWiring.test.tsx`、`fileOpenResolver.test.tsx`、`editorLineNavigation.test.tsx`
   - 真机人工回归：Claude 侧栏标题、Cursor/OpenCode 带 ANSI 的 stderr、markdown 本地图片、`file:line` 引用跳转、compaction 折叠（含结构化工具结果共存不抛错，`indents a structured object tool result` 用例）、**Codex typed `local_image` 图片恢复**（`restores user prompts from typed item_completed rows` 用例）、移动端 Settings 键盘避让与背景关闭
   - **fork 私有 provider 冒烟（v3 新增）**：Pi / WorkBuddy / ZCode / DSH 各起一个会话确认解析正常——上游动了 `ProviderLoginModal`、provider 共享代码与 `server/shared/utils.ts`，私有 provider 的运行时行为未被上述任何门槛覆盖
   - 测试未过前**不提交 merge**
6. **push 前向用户确认（main 与 cloudcli-dev 分开确认）**

**执行时序细节（v3）**：
- 动手前**重新 `git fetch upstream`** 确认 `upstream/main` 仍是 3ed3be5a（本方案基于此修订，上游若前移需重跑冲突分析）；
- 冲突未解决完之前随时可 `git merge --abort` 回滚；已提交后发现问题的回滚点：`git reset --hard ORIG_HEAD`（即 34dee092）；
- §四.1 分支合一与 §3.7 类型守卫是**新写代码**，建议测试先行：先跑上游失败用例确认红，再改实现到绿（TDD），不要先写实现再补测试。

---

## 六、审阅批注区

> 以下由各 harness（Pi / Claude / WorkBuddy 等）审阅时追加批注。格式：`### 批注：<harness> - <日期>`，逐条注明针对的章节号（如 §3.1）、结论（同意 / 反对 / 存疑）与理由。不改动本文档正文。
>
> **牵头方修订记录（v2，2026-09-18）**：收到 Codex、WorkBuddy 两份批注后，牵头方对 WorkBuddy 的 5 处缺陷论断**逐一在临时 worktree 重新合并验证**（拼接混合体、`currentSessionId`/`onLoadFullTranscript` 在 fork HEAD 的缺失、`codex-sessions.provider.ts` 不可达分支、`appendCompactionRow` 的 content 类型假设、测试收尾行），全部属实；两位审阅者关闭的疑问（§3.1 等价性、§3.2 batcher、§3.9 移动端误触）均已采纳并写回正文。批注原文保留在下方不再改动，正文修订处以 **v2 修订** 标注。
>
> **牵头方修订记录（v4，2026-09-19）**：收到两位的 v3 复核批注后，牵头方独立核验了全部承重论断——`fallbackLng: 'en'`（fork HEAD `config.ts:277`）、`sessions.db.ts` 上游净改动仅 +8 行、`claude-sessions.provider.ts` 吃到 #1295+#1303 两个提交、`formatToolResultContent()` 样板存在、**`claude-auth.provider.ts` 在两分支间确有差异（`git checkout main` 会被阻塞，此处 WorkBuddy 的"不必 stash"不成立、以 Codex 为准）**、#1344 链路文件 fork 未改——全部属实，已吸收为 v4：修正 §四.5 三处判断、复核方法改双向 diff、§五 验收清单补全为 10+1 个测试文件、基线数字补全（含 9 个基线失败按用例名对比）、第 0 步改写、§3.7 修法收敛。批注原文保留在下方不再改动，正文修订处以 **v4** 标注。
>
> **牵头方修订记录（v5，2026-09-19）**：应用户要求补"各方修改目的 → 最终方向"裁定，新增 §3.0。fork 侧目的取自各冲突文件的 fork 提交链（`git log $(merge-base)..cloudcli-dev -- <file>`，已逐一查证；Markdown.tsx 的 i18n 改造经历次 merge 提交 2a9bfa95/dddd8698 带入，无独立功能提交，此点已查实并写明）。裁定出三类方向（正交并集 / fork 超集保留 fork / 上游先进以上游为主干），关键结论：**§3.1 与 §四.1 方向相反，"保留本地"不是默认答案**。

### 批注：Codex - 2026-09-18

**总体结论：同意按 main-first 执行，但有两点需要收紧。** 我在当前 `cloudcli-dev`（34dee092）上重新做了 dry-run，结果与正文一致：`upstream/main`（3ed3be5a）合入当前分支仍是 10 个文件、14 个冲突块；`package.json` / lockfile 均无变化，所以本次不需要 `npm install`。需要收紧的是：§3.2 / §3.3 不应停留在“请审阅者确认”，现有代码已经能给出明确答案；§3.1 保留 fork 实现时，也必须把上游新增测试当作回归资产跑完，而不是只跑 fork 旧测试。

- **§3.1：同意保留 fork 实现。** 我核对了当前实现：倒序扫描并不会在首个 `ai-title` 或 `last-prompt` 早退；非 backfill 路径只在遇到有效 `custom-title` 时早退，backfill 路径会完整收集三类事件。因此上游 #1258 修复的“倒序首个命中遮蔽 custom-title”问题，在 fork 里确实已经被规避。fork 还额外保留 `SessionNameSource`、`history_display`、`first_user_prompt` 和 backfill 所需的 `lastPrompt`，语义上是超集。合并后必须保留并运行上游新增的 `claude-sessions.test.ts` 用例；若失败，优先把失败样例补进 fork 的实现或测试，不应因为“保留本地”就直接删上游测试。
- **§3.2：同意清洗逻辑取上游、发送通道保留 fork，且这个问题可以关闭。** 当前 Cursor 的 stderr error（约 `cursor-runtime.provider.js:318`）和 process error（约 `:375`）都已经走 `send()`；`createDeltaBatcher` 的契约也是非 delta 帧先 flush 旧 delta 再发送，因此不会破坏流式顺序。所以这里应使用 `send(createNormalizedMessage(...))`，不要改成直接 `ws.send`。另外要保留“先用原始 stderr 判断 trust retry，再 strip ANSI”的顺序，避免清洗后影响 `shouldSuppressForTrustRetry` 的匹配。
- **§3.3：同意 import 取并集。** dry-run 的自动合并结果已经显示：OpenCode stderr 段会同时得到上游 `stripAnsiSequences()` 清洗和 fork 的 `send()` 通道，这正是目标形态。这里只需修 import，不应把 `send()`改回 `ws.send()`。
- **§3.4：同意两边测试全保留。** 这类相邻插入冲突的风险主要是重复测试名或 helper 覆盖，合并后跑测试即可暴露；不要手工删任何一边。
- **§3.5：同意 import 并集。** 额外要确认上游把本地 `stripAnsiSequences` helper 迁到 shared utils 后，文件内旧 helper 已被删除，避免同名 import/helper 并存造成遮蔽。
- **§§3.6–3.8：同意全部“并集”方案。** `MarkdownWorkspaceContext.Provider` + `currentSessionId` 直接采用上游，不另造 fork 版 context；fork 的消息编辑、会话 fork、`forkAnchorId` 等私有能力必须原样保留。`useChatMessages` 中 `forkAnchorId` 与 `compact` 都不能丢。`Markdown.tsx` 的依赖数组必须是 `[openFileInEditor, openDirectory, t]`，其中 `t` 不是可有可无——语言切换后闭包需要更新。
- **§3.9：我的表态是接受“键盘避让 + 上游背景关闭”叠加，暂不加键盘期间禁用逻辑。** 当前移动端 Settings 面板是全屏布局，正常情况下用户能点到的区域主要在面板内部，而不是 backdrop；正文提到的“键盘上方 backdrop 点击误关闭”更像未来改成紧凑弹窗后的风险。现在先保持简单，等真机验证确有误触，再按 `--keyboard-height` 或焦点状态加 guard。
- **§四 / §五的验证建议补充为固定门槛：** 冲突处理完至少跑 `npm run typecheck`、`npm test`、`npm run test:client`；再人工回归 Claude 侧栏标题、Cursor/OpenCode 带 ANSI 的 stderr、markdown 本地图片、`file:line` 引用跳转、compaction 折叠、移动端 Settings 键盘避让。测试未过前不要提交 merge，push 仍需用户确认。

### 批注：WorkBuddy - 2026-09-18

**总体结论：main-first 的路线和"逐块并集"的取向都同意，但正文的逐块方案不足以产出可编译、可运行的合并结果。** 我没有停在读代码，而是按 §3.1 至 §3.9 把 10 个文件 14 个块**按文档原方案脚本化解决了一遍**，然后跑类型检查与相关测试。结果：`typecheck` 报 7 条错，合并后冒出 3 个失败用例（前端 2 个 + 后端 1 个），而这三处在正文里都没有被点到。另有两处正文方案照做会直接把 fork 已删的东西带回来。

**复现方法（可复核）。** 在 `/tmp` 建 worktree（`git worktree add <tmp> -b sync-verify cloudcli-dev`）→ `merge --no-commit --no-ff upstream/main`（复现 10 文件 / 14 块，与正文 §二 完全一致）→ 按 §3.1 至 §3.9 逐块落地方案 → 把主仓 `node_modules` 软链进 worktree → 跑 `npx tsc --noEmit -p tsconfig.json` 与 `-p server/tsconfig.json`、`npx vitest run src/modules/chat src/modules/sidebar`、`npx tsx --test server/modules/providers/tests/codex-{runtime,sessions}.test.ts`。

**基线（干净 `cloudcli-dev` = 34dee092，四项全绿，用来判定回归）：** 两侧 `tsc` 均 0 错误；`vitest run src/modules/chat` 54 文件 434 用例全过；两个 codex 测试文件 28 用例全过。凡合并后超出这些数字的失败都算回归，不算"本来就坏"。

#### 一、正文未覆盖的缺陷

**缺陷 1（§3.1，编译级，正文的处置方式本身不成立）。** 只把三个冲突块保留 OURS，会得到 5 条编译错误，全部落在 `claude-session-synchronizer.provider.ts`：

```
:226  TS2551 Property 'extractSessionAiTitleFromEnd' does not exist ... Did you mean 'extractSessionTitle'?
:329  TS2552 Cannot find name 'foundCustomTitle' / TS2304 'foundAiTitle' / TS2552 'foundLastPrompt'
:394  TS2551 同上（backfill 调用点）
```

根因不在冲突标记里，而在 git 判定"自动合并成功"的两段被拼成了混合体：

1. **方法头被拼接**：合并后 `:261` 的定义名与 docstring 来自上游（`extractSessionTitle` + "Scans forward keeping the last match"），而参数 `includeLastPrompt = false` 与返回类型 `ClaudeTitleMetadata | undefined` 来自 fork；两个调用点（冲突块 1 的 OURS 侧 `:226`、以及**自动合入**的 backfill `:394`）写的都是 fork 的 `extractSessionAiTitleFromEnd`。名字对不上。
2. **方法尾被拼接**：合并后 `:329` 同时留着 fork 的三段 `if (customTitle/aiTitle/lastPrompt) return { name, source, lastPrompt }` 与上游的 `return foundCustomTitle || foundAiTitle || foundLastPrompt;`，而 `found*` 只在上游侧的冲突块 2 里声明（`:283` 至 `:285`）。变量作用域对不上。

**建议正文把 §3.1 改为："整个 `extractSessionTitle` / `extractSessionAiTitleFromEnd` 方法区段以 fork 版本整体重写"，而不是"三个冲突块保留本地"。** 等价且更省事的做法是对该文件整取 ours（`git checkout --ours <file>`）。我核对过上游在本区间对该文件的全部改动（`git diff 5e73a49b..upstream/main -- <file>`）只有四处：加 docstring、方法改名、扫描方向与变量名改写、加尾返回；这四处全部被 fork 实现覆盖，**整文件取 ours 不会丢任何上游资产**。

**缺陷 2（§3.4，"无影响"不成立，两侧不对称）。**

- `codex-runtime.test.ts` 确实是干净的相邻插入，直接拼接可编译，正文建议成立。
- `codex-sessions.test.ts` **不是**。两侧共享了尾部收尾行（`  } finally {` + `    await rm(tempRoot, { recursive: true, force: true });` + `  }` + `});`），"本地在前、上游在后"直接拼接会得到 `TS1005: '}' expected`。正确做法是给两侧各补一份收尾：OURS 的 finally 体是 `await rm(...)`，THEIRS 的 finally 体是 `restoreHomeDir(); await rm(...)`，顺序可任意，但括号必须各补各的。
- 更隐蔽的一条：**上游 #1346 新增的纯图片 prompt 用例在 fork 里编译不过**。它构造的 `ProviderRuntimeContext` 字面量只有 5 个字段，缺 fork 追加的 `resolveProviderConfigDir` 与 `resolveSettingsFile`（`server/shared/types.ts:493`、`:500`），报 `TS2739` 于 `codex-runtime.test.ts:130`。基线 typecheck 干净，所以这是合并引入的。修法是给该 mock 补两行 `resolveProviderConfigDir: () => null,` / `resolveSettingsFile: () => null,`，fork 同文件 `:39` 至 `:47` 已有正确样板。
- 顺带一个流程提醒：`npm test` 走 tsx，**不做类型检查**，上面这些只会在 `npm run typecheck` 暴露。Codex 把 typecheck 列为门槛是对的，而且顺序应当是**先 typecheck 再 test**。

**缺陷 3（§3.6，照正文做会把 fork 已删的东西带回来）。** 正文说"上游的 Provider 包裹 + `currentSessionId` 全部采纳"，但：

- fork 的 `ChatMessagesPane`（`src/modules/chat/transcript/ChatMessagesPane.tsx`）**根本没有** `currentSessionId` 这个 prop：它在 `b29c5896 fix(chat,sidebar): 精简 Provider 空态判断与侧栏按钮样式` 里被有意删掉了（上游只在 `ProviderSelectionEmptyState` 上用到它）。照正文采纳即报 `TS2322: Property 'currentSessionId' does not exist on type 'IntrinsicAttributes & ChatMessagesPaneProps'`（合并后 `ChatInterface.tsx:482`）。真要采纳，必须连带改 `ChatMessagesPane.tsx` 与 `ProviderSelectionEmptyState`，而这两个文件正文从未列出。
- 同一个冲突块的 THEIRS 侧还带着 `onLoadFullTranscript={loadFullTranscript}`（合并后 `:519`），正文完全没提。这个 prop 与函数在 fork 里已被整体删除（`src/` 内 0 处出现，见 `c90eaf58`、`99ea0525`），照 THEIRS 取即报 `TS2304: Cannot find name 'loadFullTranscript'`。

**建议 §3.6 改为："只采纳 `<MarkdownWorkspaceContext.Provider>` 包裹层；`currentSessionId` 与 `onLoadFullTranscript` 两个 prop 都不采纳（fork 已分别移除），fork 的私有 props 原样保留。"** Provider 包裹本身是纯增益，我确认 import 在合并后能解析（客户端 tsc 只报上述两个 prop 错，没有 module 解析错）。至于"fork 的 ChatMessagesPane 是否还需要 `currentSessionId`"，应当降级为一个**独立判断项**，不要混在冲突解决里顺手做。

**缺陷 4（§四，严重：自动合入文件里的同函数重复分支与静默遮蔽）。** `server/modules/providers/list/codex/codex-sessions.provider.ts` 不在冲突清单里（git 报 Auto-merging 成功），但合并结果把同一个分支写了两遍，且都在 `getCodexSessionMessages`（合并后 `:1397` 起）里：

- fork 分支（合并后 `:1502`）：`payload.type === 'item_completed' && payload.item?.type === 'UserMessage'`，图片取自 `pendingUserImagesByTurnId`，**末尾 `continue`**。
- 上游 #1277 新增分支（合并后 `:1576`）：同条件，图片改用 `extractCodexTypedUserImages(payload.item.content)` 直接从 typed `local_image` 项取。

fork 的分支在前且有 `continue`，上游那一份**永远不可达**。上游自带的回归用例 "Codex history restores user prompts from typed item_completed rows" 因此失败：文本能恢复（fork 分支干的），但 `images[0].path` 是 `undefined`（期望 `/tmp/prompt-picture.png`）。基线该文件 28 用例全过，所以这是合并引入的功能回退。

**建议在 §四 增加一条"自动合入的同函数重复分支审计"，并在合并后把两分支合一**（typed item 里有图就用 typed 的，没有才回落 `pendingUserImagesByTurnId`）；注意两个来源的图片类型不一样（fork 侧是 `Array<{ data: string }>`，上游侧是 `Array<{ path?, data? }>`），合一时要对齐 `CodexHistoryResult` 的 images 类型。

**缺陷 5（§3.7，合并后运行时回归，测试能抓到）。** `compact: msg.compact` 保住了没错，但上游 #1295 的 `appendCompactionRow`（fork HEAD 里 0 处，纯上游新增）被自动合入 `normalizedToChatMessages`，它按"`msg.content` 是字符串"来写：`const content = msg.content || ''; const text = content.trim();`。fork 侧工具结果消息的 `content` 可以是对象/数组，真机这条路会抛 `content.trim is not a function`。实测 `npx vitest run src/modules/chat` 由基线 434/434 变成 2 failed（`indents a structured object tool result` 等）。**建议 §3.7 从"两行都保留"升级为"两行都保留，且必须给 `appendCompactionRow` 的 content 做字符串归一或类型守卫"**，并列入合并后验证项。

#### 二、回应正文里挂着的"请审阅者表态 / 确认"

- **§3.1 遗留疑问（backfill 路径 `customTitle` 只取倒序首个，是否与上游"正序保留最后一次"一致）：一致，我没有找到反例。** 倒序首个就是正序最后一个；两侧都先剔除空白值再比较（fork 用 `claudeRenamedTitle?.trim()`，上游用 `title?.trim()`）；优先级也都是 `custom > ai > lastPrompt`。上游注释里说的那个坑针对的是 base 的旧实现（`git diff 5e73a49b..upstream/main -- <file>` 可见 base 是"倒序首命中即返回，且 `return aiTitle || lastPrompt || claudeRenamedTitle`"，custom-title 排在最后必输），**该批评不适用于 fork 的实现**。唯一形式差异是 fork 在非 backfill 早退时返回对象里的 `lastPrompt` 为 undefined，而该路径的调用者只读 `name` 与 `source`，无行为差异。所以 §3.1 的语义等价论断我背书，问题只在"怎么把它落地"（见缺陷 1）。
- **§3.2 "error 类消息是否应过 batcher"：应过，可以关闭这个疑问。** 我按全量出站点核的（不是按 Codex 给的两个行号）：fork HEAD 的 cursor 出站消息除 `:73` 的 `ws.send(message)`（batcher 内部的 flush 出口）外，全部走 `send()`，即 `:248`、`:264`、`:272`、`:291`、`:318`、`:349`、`:375`、`:378`。`:318`（stderr error）与 `:375`（process error）本来就在 `send()` 上。所以"清洗取上游、通道留 `send()`"正确，不要改回 `ws.send`。
- **§3.2 的 trust-retry 顺序：无需额外动作，冲突块的边界已经把顺序固定住了。** 合并态里 `shouldSuppressForTrustRetry(stderrText)` 在冲突块**之上**、用的是原始 `stderrText`；stripAnsi 出现在冲突块内 THEIRS 侧。Codex 的提醒本身没错，但结论是"已经安全"，不必列为待办。
- **§3.5 shell-websocket 的 union import：正确且已足够。** 合并态里 fork 原有的本地 `function stripAnsiSequences`（fork HEAD `:41`）已被删除（上游把 helper 迁到 shared utils 时删的，fork 未改该区域，故自动合并取删除），合并后 `:489` 的调用点解析到 shared utils 的导入。所以不存在同名遮蔽，Codex 让"确认旧 helper 已删除"是已知答案的多余动作。唯一要注意的是合并后 `@/shared/utils.js` 只能留**一条** import（冲突两侧都含 `parseIncomingJsonObject`）。
- **§3.3 opencode：确认，只需修 import。** 合并态 `:350` 已经是 `stripAnsiSequences(data.toString())`，紧跟 `send(createNormalizedMessage(...))`，正是目标形态；不要改回 `ws.send`。
- **§3.9 移动端 backdrop 误关：同意 Codex，而且这个风险可以直接证否。** fork 的面板容器是 `flex h-full w-full flex-col overflow-hidden border border-border bg-background shadow-2xl md:h-[90vh] md:max-w-4xl md:rounded-xl`，即移动端（小于 md）内层就是整屏；backdrop 又被 `style={{ bottom: 'var(--keyboard-height, 0px)' }}` 抬高了底边，键盘弹出时面板跟着变矮，不会露出可点的 backdrop 带。所以"键盘上方 backdrop 被误点"在当前布局下不成立，先保持简单是对的。真机只需确认一件事：iOS 上 `onMouseDown` 与 `onClick` 是否都能触发（上游的 Esc 路径在移动端没有等价物）。

#### 三、一处方法学提醒（不改任何结论）

判定"是不是合并引入的"必须拿基线说话。我这次差点收到两个假信号：一次是 `npx tsc` 在错误的 cwd 下跑（检查了主仓而非 worktree，误得"全绿"）；一次是看到 `codex-sessions.provider.ts:1521/:1523` 有一对重复注释，像极了拼接产物，核对后发现 **fork 与 upstream 各自都有这一对**，属既有重复，不是本次合并带来的，**不要去"顺手清理"它**。所以每条结论我都用"干净 HEAD + 相同命令"重跑过一遍再写进来。

#### 四、对验证门槛的补充（在 Codex 的基础上）

1. **顺序：先 `npm run typecheck`，再 `npm test`，再 `npm run test:client`，最后真机。** 理由：本次两处缺陷只被 typecheck 抓到（tsx / vitest 都不查类型），一处只被 vitest 抓到（运行时 TypeError），两套检查互不替代。
2. **增加两个必测项：** ① Codex 会话里含 typed `local_image` 的图片恢复（缺陷 4）；② 聊天里"结构化工具结果 + compaction 折叠"共存不抛错（缺陷 5）。
3. **基线口径写进门槛：** 干净 `cloudcli-dev` 上 `tsc -p tsconfig.json` 与 `tsc -p server/tsconfig.json` 均 0 错误、`vitest run src/modules/chat` 434/434、两个 codex 测试文件 28/28；合并后超出即回归。
4. **动手前先看工作区。** 我做验证期间主仓工作区出现了不属于本次同步的未提交改动（`claude-auth.provider.ts` / `codex-auth.provider.ts` / `cursor-auth.provider.ts` 三处 `spawn.sync` 判活修复，外加新增未跟踪的 `server/modules/providers/tests/provider-installed-detection.test.ts`），来源不是我。§五 第 1 步 `git checkout main` 在有未提交改动时会被打断，执行合并前请先确认这些改动的归属与去留。

（本批注只写在 §六，未改动正文；上面所有行号都已标注是"fork HEAD"还是"合并态"，便于复核。）

### 批注：WorkBuddy - 2026-09-18（v3 复核）

**总体结论：v3 的两个增量面方向正确、可执行。** §四.5 的「33 个双改文件」我用 `comm` 复核，与「双方相对 base 都改过」的真实交集**完全一致（无多无少）**，★ 标注的 10 个与 §二 冲突清单吻合；§五 的两条新门槛也核实属实（`typecheck` = `tsc --noEmit -p tsconfig.json && tsc --noEmit -p server/tsconfig.json`，确覆盖两侧；`build` = vite + tsc + tsc-alias）。但 §四.5 有 **3 处判断要修正**（1 处风险指向错、1 处应升格、1 处结论反了），§五 的「上游新测试验收」清单**漏了 8 个客户端测试文件**，另「待补基线」我已跑出真实数字——其中 **`npm test` 全量在本机基线不是 0 failed**。

#### 一、先更正我上一轮的数字

- **§3.1（v2 修订）的行号：正文准确，我上一轮写错了。** 实测合并态 `:267` = 上游方法头（`extractSessionTitle` + 正序 docstring）、`:227` = 冲突块 1 OURS 侧调用点、`:431` = 自动合入的 backfill 调用点，三处与正文完全一致。我上一轮批注里的 `:261` / `:226` / `:394` 是我在**已解析过**的 worktree 上数的（解析后行号下移），**以正文的原始合并态行号为准**。
- **§3.4 的 mock 修补：完整，且已核实只有一处要补。** 扫了合并态 `codex-runtime.test.ts` 的两个 `ProviderRuntimeContext` 字面量，只有上游 #1346 新增的那个（合并态 `:131`）缺 `resolveProviderConfigDir` / `resolveSettingsFile`；fork 原有的（`:40`）样板完整。所以「补两行」充分且必要，不会漏第二个，也不会错改到旧用例。

#### 二、§四.5 三处需要修正

**发现 1（结论反了）· i18n：其余 locale 缺 key 不会显示裸 key。** §四.5 写上游新 key「在 fork 私有语言包可能缺失，显示裸 key」。实测 `src/modules/i18n/config.ts:298` 是 `fallbackLng: 'en'`，且 #1328 把 `id` 语言包连同 `config.ts` 的 `id:` 条目一并合入（合并态 `locales/id/` 存在、`config.ts:123` / `:272` 有 `idCommon` / `id:`）。新 key（`chat.misc.compacted`、`chat.misc.compactionSummary`、`settings.plugins.glmUsagePlugin`）只加 `en` 是上游自己的做法，其余 11 个 locale 回退英文。**现象是「少翻译」，不是「裸 key」，不必按 bug 处理**；`config.ts` 唯一要确认的是 id 条目与 fork 私有 locale 并存未被覆盖（已确认存在）。

**发现 2（指向错）· `sessions.db.ts` 没有 migration 叠加。** §四.5 写「注意是否有 migration 叠加」，但上游 #1344 在该文件只加了 8 行——一个 `deleteSessionByProviderSessionId()` 查询方法（供 OpenCode synchronizer 删子会话），**不涉及 schema / ALTER / migration**。fork 的改动（125+/25-）集中在 `name_source` 的 INSERT/UPDATE CASE 逻辑，与新增方法不同区域，auto-merge 干净。真正该复核的是 #1344 的链路本体（`opencode-session-synchronizer.provider.ts` +32、`opencode-sessions.test.ts` +41），而这两个文件**不在 33 个双改清单里**（fork 未改过），既不进 §四.5 取样、也没进 §五 验收清单。

**发现 3（应升格）· `claude-sessions.provider.ts` 不只是「name_source 读取侧 vs 上游」。** 它在本区间吃到**两个**上游提交：f3620803（#1303，删本地 `stripAnsiFormatting`、改调 shared `stripAnsiSequences`）**和 d450ed85（#1295，+76 行的 compaction 服务端半）**。#1295 往 normalizer 插了 `system` / `compact_boundary` / `status` 分支，而 **fork 在同一函数附近也改了**（fork 侧 hunk `@@ -668`、`@@ -680,10 +686,37`），属「同函数相邻插入、auto-merge 成功」——**正是 §四.5 要找的形态，而 §3.7 只处置了客户端半（`appendCompactionRow`）**。建议升格到与 `codex-sessions.provider.ts` 同级：合并后先跑 `claude-compaction.test.ts` + `claude-sessions.test.ts`，人工确认压缩行在 fork 会话里正常出。（顺带：合并态该文件的本地 `stripAnsiFormatting` 已随上游删除，无同名遮蔽。）

#### 三、§五 需要补的三条

**发现 4（验收清单不全）· 「上游新测试」漏了 8 个文件，且漏的正好是 §3.6 / §3.7 人工项的自动断言。** §五 列了 `claude-sessions.test.ts`、`claude-compaction.test.ts`、`claude-background-work.test.ts`、`strip-ansi-sequences.test.ts`、`codex-runtime.test.ts`——全在 server 侧。上游本区间实际新增 10 个测试文件，客户端 6 个加 `opencode-sessions.test.ts`（#1344，+41 改动）都没列：

- `src/modules/chat/tests/compactionRows.test.ts`（#1295，149 行）——`compact` 折叠的行级断言
- `src/modules/chat/tests/markdownImage.test.tsx`（#1307）、`src/modules/chat/tests/fileReferenceLinks.test.tsx`（#1256）——正是 §3.6 要人工验的「带本地图片路径的消息 + 含 file:line 的消息」
- `src/modules/file-tree/tests/revealDirectory.test.ts`、`src/modules/file-tree/tests/revealDirectoryWiring.test.tsx`、`src/modules/project-workspace/tests/fileOpenResolver.test.tsx`、`src/modules/code-editor/tests/editorLineNavigation.test.tsx`（#1256）

这些走 `npm run test:client` 不会漏跑，但被排除在「上游带来的测试全部保留并通过」的**验收口径**之外，等于 §3.6 的验收只剩人工。建议把 10 个文件的完整清单直接写进 §五，人工回归降为补充。

**发现 5（修法可更省事）· §3.7 的 content 守卫有现成样板，且已确认无可达性问题。** 正文写「字符串归一或类型守卫」——`useChatMessages.ts:9-15` 的 `formatToolResultContent()` 就是干这个的（`typeof content === 'string' ? content : JSON.stringify(content, null, 2)`），注释还明确说是为了让结构化结果「不挤成一行」，`appendCompactionRow`（`:104` 的 `content.trim()`）直接复用同一 idiom 即可，不必新造判断。另确认：`appendCompactionRow` 在 `normalizedToChatMessages` 循环里**无条件、先于 switch** 调用（合并态 `:326`），没有 fork 分支能抢在它前面吃掉 compact 行；`MessageComponent.tsx:194` 的 `message.compact ?` 也在 user 分支之后、可达。**所以缺陷 5 是纯类型/运行时问题，不是又一个「不可达分支」，处置范围不要扩大。**

**发现 6（第 0 步可销项）· 工作区那批改动已确认归属，但别让它污染基线计数。** §五 第 0 步把三处 auth provider 改动 + `provider-installed-detection.test.ts` 列为「需用户先决定 stash/commit/放弃」。**用户已确认这是他另一个需求的改动，不是本次同步的干扰项**，不必 stash 也不必放弃。只提醒两点：① merge commit 里不要混入（尤其未跟踪的那个测试文件，不 `git add` 就不会进）；② `npm test` 的 glob 是 `server/**/*.test.ts`，**会把未跟踪的 `provider-installed-detection.test.ts` 一起跑**，在主仓跑验证会污染「合并后基线」计数——建议验证在干净 worktree 里做，或在 §五 注明。

#### 四、§五「待补基线」已补齐（含一个反直觉数字）

在干净 `cloudcli-dev`（34dee092）worktree 实测：

| 门槛 | 基线数字 |
|------|---------|
| `npm run test:client` 全量 | **91 文件 / 655 用例全过** |
| `npm test`（server 全量） | **765 用例：755 pass / 9 fail / 1 skipped** |
| `vitest run src/modules/sidebar` | **4 文件 / 21 用例全过** |
| 两侧 `tsc --noEmit` | 0 错（沿用前文） |
| `vitest run src/modules/chat` / 两个 codex 文件 | 434/434、28/28（沿用前文） |

**关键提醒：`npm test` 全量基线不是 0 failed，是 9 个。** §五 写「合并后超出基线即回归」方向对，但**必须按用例名记录基线，不能只记计数**——「9 个基线失败 + 合并引入 1 个新失败 + 掩盖 1 个基线失败」在计数上和「9 个」无法区分。这 8 个名字（9 次失败，其中 `synchronizer keeps the app-assigned name and does not duplicate app sessions` 在两个文件里各失败一次）：

```
resolveClaudeCodeExecutablePath leaves non-Windows platforms on the bare command
resolveClaudeCodeExecutablePath returns undefined on Windows when the default resolves to nothing
resolveClaudeCodeExecutablePath returns undefined when every wrapper on PATH is a JavaScript launcher
resolveClaudeCodeExecutablePath still resolves the native exe when both installs are on PATH
getStatus detects a codebuddy executable on PATH
getStatus detects the CLI embedded in WorkBuddy.app
getStatus reports an installed but desktop-managed WorkBuddy engine
synchronizer keeps the app-assigned name and does not duplicate app sessions   ×2
```

都是环境依赖 / 既有实现与断言不匹配类，与本同步无关。另：全套跑偶发多 2 个负载相关的失败（`workbuddy-runtime.test.ts`、`websocket/tests/chat-edit-send.test.ts`），单跑即过，别追。

#### 五、同意项与两处表述建议

- **同意** §四.5 的 33 文件清单（与 `comm` 交集一致）；同意「这类双改文件可能藏静默回退、typecheck 抓不全」的判断——`codex-sessions.provider.ts` 就是实证。
- **同意** §3.3：上游本区间对该文件**只有** #1303 的 ANSI 改动（`git log 5e73a49b..upstream/main -- <file>` 仅 f3620803），#1344 没碰 runtime 文件，「只需修 import」成立。
- **同意** §3.1 整取 ours 的结论；同意 §五「先 typecheck 再 test」的顺序与「上游测试不得因保留本地而删」的口径。
- **表述建议一**：§四.5 的复核方法只写了 `git diff cloudcli-dev <合并态> -- <file>`（= 上游净落地了什么）。两种失效模式需要**两个方向**：反方向 `git diff <合并态> cloudcli-dev -- <file>`（= fork 的改动有没有被上游盖掉）。建议把两个方向都写上。
- **表述建议二**：`build:server` 会写 `dist`，`npm run build` 请在验证 worktree 里跑，别在主仓跑（主仓 `dist` 是部署产物）。

（本批注只写在 §六，未改动正文；v3 的 §四.5 清单、§五 门槛均已按上面的方法在干净 worktree 与临时合并 worktree 上实测核对。）

### 批注：Codex - 2026-09-19（v3 复核）

**总体结论：v3 的两个新增面方向正确，我认可 §四.5 和 §五 的补强，但还有 4 点需要在执行前收紧。** 我已重新 fetch，`upstream/main` 仍是 `3ed3be5a`，本次增量没有新的上游提交；文档 v3 是在旧同步范围内补审计面，不是新的上游前移。

1. **§四.5 的双改交集我独立复核过，数量确实是 33。** 我用双方相对 merge-base 的改动文件做交集，结果与文档表格完全一致；这说明 v3 的“最大未审计面”不是拍脑袋，而是真实风险面。
2. **WorkBuddy 的 3 处修正我同意，建议直接吸收进正文：**
   - i18n 缺 key 的现象是“少翻译、回退英文”，不是“显示裸 key”；
   - `sessions.db.ts` 本区间没有 migration 叠加，真正要关注的是 OpenCode 子会话删除链路；
   - `claude-sessions.provider.ts` 应升格为高危复核对象，因为同一文件同时吃到 #1295 compaction 和 #1303 ANSI 两类上游改动。
3. **§五 的“上游新测试验收”确实漏了客户端 6 个测试文件，且 `opencode-sessions.test.ts` 是修改不是新增，但同样要纳入验收。** 只列 server 侧会让 §3.6 / §3.7 的人工项缺少自动断言兜底。建议把 10 个新增测试文件 + `opencode-sessions.test.ts` 全部写进同一验收清单。
4. **第 0 步不能因为“改动归属明确”就简化成“不必 stash / 不必放弃”。** 如果你仍按原流程 `git checkout main`，这批改动还是会阻塞切换。正确做法是三选一：先单独提交、先 stash，或改用独立 worktree 更新 main；但不应该把它混进本次 merge commit。`provider-installed-detection.test.ts` 是未跟踪文件，若在主仓直接跑 `npm test` 会被 glob 捕获，验证基线最好也在干净 worktree 里做。
5. **§3.7 的修法我建议收敛到最小实现：** 直接复用 `formatToolResultContent()` 的字符串归一思路，或在 `appendCompactionRow()` 里做一次 `typeof content === 'string'` 判断；不要再引入新的渲染分支或消息类型，避免把“类型/运行时问题”扩大成结构改造。
6. **§四.5 的复核方法要写双向 diff：**
   - `git diff <fork HEAD> <合并态> -- <file>` 看“上游净落地了什么”；
   - 反向 `git diff <合并态> <fork HEAD> -- <file>` 看“fork 的改动有没有被上游盖掉”。
   只看单方向会漏掉第二种失效。
7. **构建与全量测试建议固定在临时 worktree 里跑：** `npm run build` 会写 `dist` / `dist-server`，主仓里的产物不适合被验证过程污染。全量基线已有数字，后续应按“测试名”对比，不要只看失败计数，否则“9 个既有失败 + 1 个新增失败 + 1 个被掩盖”在数字上会误判成无回归。
