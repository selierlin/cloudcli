# Fork 上游同步冲突解决文档（供评审批注）

> **生成时间**：2026-09-22
> **同步模式**：main-first（upstream → fork `main` → `cloudcli-dev`）
> **同步范围**：`3ed3be5a..upstream/main`（6c51fcaa），3 个提交，117 文件，+10218/-802
> **冲突情况**：upstream → `main` 无冲突；upstream → `cloudcli-dev` 共 22 个文件冲突（21 个内容冲突 + 1 个删除/修改冲突）

---

## 给评审者的说明

本文档列出 fork（`cloudcli-dev`）合并 `upstream/main` 的全部冲突。每个冲突块包含：

- **冲突内容**：`<<<<<<< HEAD` 侧 = fork 当前代码（`cloudcli-dev` @ 71f57175）；`>>>>>>> upstream/main` 侧 = 上游新代码
- **双方意图**：各自改动背后的功能
- **解决建议**：初稿方案，**请逐项批注**：`同意` / `反对（理由）` / `修改建议`

重点评审对象：
1. **C 类结构性冲突**（第 4 节）——存在实现路线取舍，建议最多
2. **DU 冲突**（第 5 节）——fork 删除 vs upstream 修改
3. **全局风险**（第 6 节）——合并后验证策略

---

## 1. 背景

### 1.1 fork 概况

`cloudcli` 是 `siteboon/claudecodeui` 的深度二次开发 fork，当前功能分支 `cloudcli-dev` 上叠加了多条工作线：

- **多 provider 扩展**：在 upstream 仅支持 claude/cursor/codex/opencode 的基础上扩展了 dsh、workbuddy、pi、zcode、omp
- **侧边栏重构**：会话置顶（pin）、批量管理模式、`RecentConversationRow` 组件抽取
- **Chat UI 重构**：用户消息吸顶（`UserMessageStickyHeader`）、执行过程摘要（`ExecutionProcessSummary`）、quick replies、消息编辑/fork
- **会话历史**：outline 路由、gzip 压缩、turn 分页游标
- fork 已**删除** `ChatExportMenu` 组件（导出菜单功能）

### 1.2 上游新增（待合入的 3 个提交）

| 提交 | 内容 |
|------|------|
| `fd424f3f` | fix(chat): Safari 上 IME 候选确认的 Enter 不触发发送 |
| `557109a2` | fix: 后台 agent 结果与状态恢复、只读临时浏览、clone-token 脱敏 —— 大改动：`chatRunRegistry` 保留守护、claude runtime hold 判定重构（`sawTaskEventThisTurn`/`stillOutstanding`/`holdForTurn`）、前端新增 `BackgroundTasksStrip`、`WorkflowPanel`、`SubagentTimeline`、`TranscriptSessionContext`、后台任务/工作流折叠进 tool row、侧边栏行内后台工作指示（紫点） |
| `6c51fcaa` | feat: 侧边栏可拖拽调宽（`useSidebarWidth`、`SidebarModeTabs`、`useTabOverflow`） |

**依赖变化**：无（package.json 无 diff）

---

## 2. 冲突总览

| # | 文件 | 类别 | 冲突块 | 难度 |
|---|------|------|--------|------|
| 1 | `server/index.ts` | B | 1 | 低 |
| 2 | `server/modules/agent/agent.routes.ts` | B/C | 2 | **高** |
| 3 | `server/modules/providers/provider.routes.ts` | A | 1 | 低 |
| 4 | `server/modules/providers/services/sessions.service.ts` | A | 1 | 低 |
| 5 | `server/modules/providers/list/claude/claude-runtime.provider.js` | C | 2 | **高** |
| 6 | `server/modules/providers/tests/provider.routes.test.ts` | A | 2 | 低（量大） |
| 7 | `src/modules/chat/ChatInterface.tsx` | B | 1 | 中 |
| 8 | `src/modules/chat/hooks/useChatComposerState.ts` | A | 1 | 低 |
| 9 | `src/modules/chat/hooks/useChatRealtimeHandlers.ts` | A | 1 | 低 |
| 10 | `src/modules/chat/tests/useChatMessages.test.ts` | A | 1 | 低（量大） |
| 11 | `src/modules/chat/tools/SubagentPanel.tsx` | C | 3 | **高** |
| 12 | `src/modules/chat/transcript/ChatMessagesPane.tsx` | B | 3 | 中 |
| 13 | `src/modules/chat/transcript/MessageComponent.tsx` | B | 2 | 中 |
| 14 | `src/modules/chat/utils/toolGrouping.ts` | B | 1 | 低 |
| 15 | `src/modules/i18n/locales/ja/sidebar.json` | A | 1 | 低 |
| 16 | `src/modules/sidebar/Sidebar.tsx` | A | 1 | 低 |
| 17 | `src/modules/sidebar/SidebarHeader.tsx` | C | 2 | 中 |
| 18 | `src/modules/sidebar/SidebarProjectSessions.tsx` | B | 1 | 中 |
| 19 | `src/modules/sidebar/SidebarRecentConversations.tsx` | C | 1 | **高** |
| 20 | `src/modules/sidebar/SidebarSessionItem.tsx` | B | 2 | 中 |
| 21 | `src/shared/api.ts` | A | 1 | 低 |
| 22 | `src/modules/sidebar/tests/recentConversationRowActions.test.tsx` | DU | - | 中 |

- **A 类**：相邻插入/import 冲突，两侧改动互不相关，全部保留即可
- **B 类**：功能叠加，合并方向明确但需逐块融合
- **C 类**：结构性/语义冲突，存在实现路线取舍
- **DU**：fork 删除 vs upstream 修改

---

## 3. A 类：机械合并（建议两侧都保留）

### 3.1 `server/modules/providers/services/sessions.service.ts`（类型 import）

```ts
<<<<<<< HEAD
  SessionOutlineItem,
=======
  WorkflowAgentActivity,
>>>>>>> upstream/main
```

- fork：outline 功能引入的会话大纲条目类型
- upstream：工作流 agent 时间线类型
- **建议**：两个类型都保留

### 3.2 `server/modules/providers/provider.routes.ts`（同位置各插一路由）

```
<<<<<<< HEAD
router.get(
  '/sessions/:sessionId/outline',
  asyncHandler(async (req: Request, res: Response) => {
    const sessionId = parseSessionId(req.params.sessionId);
    const result = await sessionsService.fetchOutline(sessionId);
=======
/**
 * One workflow agent's timeline, read on demand when its row in the workflow
 * card is opened. History does not carry it: a run can spawn a dozen agents
 * with hundreds of tool calls each, and the card only lists them.
 */
router.get(
  '/sessions/:sessionId/workflows/:runId/agents/:agentId',
  asyncHandler(async (req: Request, res: Response) => {
    const sessionId = parseSessionId(req.params.sessionId);
    const runId = parseWorkflowRunId(req.params.runId);
    const agentId = parseWorkflowAgentId(req.params.agentId);
    const result = await sessionsService.readWorkflowAgentActivity(sessionId, runId, agentId);
>>>>>>> upstream/main
```

- fork：新增 outline 路由；upstream：新增 workflow agent 路由
- **建议**：两个路由都保留（同时保留两侧的 parse 辅助函数 import 与 service 方法）

### 3.3 `src/shared/api.ts`（同位置各插 API 方法）

```ts
<<<<<<< HEAD
  // Pins or unpins a session so it sorts ahead of unpinned ones in the sidebar.
  setSessionPinned: (sessionId: string, isPinned: boolean) =>
    put(`/api/providers/sessions/${encodeURIComponent(sessionId)}/pinned`, { isPinned }),
  // Permanently removes a whole batch of archived sessions at once.
  permanentlyDeleteArchivedSessions: (sessionIds: string[]) =>
    del('/api/providers/sessions/archived', { sessionIds }),
=======
  // What one agent of a workflow run did, read from its transcript on demand
  // when its row in the workflow card is opened.
  workflowAgentActivity: (sessionId: string, runId: string, agentId: string) =>
    get(`/api/providers/sessions/${encodeURIComponent(sessionId)}/workflows/${encodeURIComponent(runId)}/agents/${encodeURIComponent(agentId)}`),
>>>>>>> upstream/main
```

- **建议**：两边方法都保留

### 3.4 `src/modules/chat/hooks/useChatComposerState.ts`（import）

```ts
<<<<<<< HEAD
import { composeQuickReplyInput, isQuickReplyCommand } from '@/shared/quickReplies';
=======
import { describeBackgroundTask, ownBackgroundTasks } from '@/modules/chat/utils/backgroundTasks';
>>>>>>> upstream/main
```

- fork：quick replies 功能；upstream：后台任务工具函数
- **建议**：两行 import 都保留
- **验证注记（评审补充）**：上游 `fd424f3f` 的 Safari IME Enter 修复落在 keydown/composition 处理，与 fork 的 `isQuickReplyCommand`（同在 Enter 路径拦截）可能叠加。合并后需在 WebKit 内核手测三条路径：①中文输入法候选上屏不误发送；②quick reply 命令正常发送；③普通发送正常

### 3.5 `src/modules/chat/hooks/useChatRealtimeHandlers.ts`（import）

```ts
<<<<<<< HEAD
import type { StreamingBufferRegistry } from '@/modules/chat/utils/streamingBufferRegistry';
=======
import { normalizedToChatMessages } from '@/modules/chat/hooks/useChatMessages';
import { collectRunningBackgroundTasks } from '@/modules/chat/utils/backgroundTasks';
>>>>>>> upstream/main
```

- **建议**：三行 import 都保留
- **验证注记（评审补充）**：upstream 侧带入 `collectRunningBackgroundTasks`/`normalizedToChatMessages` 说明冲突块之外还有成段 upstream 逻辑被自动合并，与 fork 的 `StreamingBufferRegistry` 事件处理是否互扰需快速过一遍，勿因"仅 import 冲突"跳过

### 3.6 `src/modules/sidebar/Sidebar.tsx`（import）

```ts
<<<<<<< HEAD
import { useBusySessionIdSet } from '@/shared/context/SessionProtectionContext';
import { getPageTitle } from '@/shared/utils';
=======
import { useBackgroundSessionIdSet, useBusySessionIdSet } from '@/shared/context/SessionProtectionContext';
>>>>>>> upstream/main
```

- **建议**：合并为一行 `import { useBackgroundSessionIdSet, useBusySessionIdSet } from ...` + 保留 `getPageTitle`

### 3.7 `src/modules/i18n/locales/ja/sidebar.json`

```json
<<<<<<< HEAD
  "recent": {
    "pinnedTitle": "固定された会話",
    "unpinnedTitle": "最近の会話"
=======
  "search": {
    "modeProjects": "プロジェクト",
    "modeConversations": "会話",
    "modeMore": "その他"
>>>>>>> upstream/main
```

- fork：置顶分组的日文文案；upstream：搜索模式标签的日文文案
- **建议**：两个 key 组都保留。**注意**：其余 11 种语言的 `sidebar.json` 无冲突已自动合并，合并后需检查各语言 key 集一致性

### 3.8 `server/modules/providers/tests/provider.routes.test.ts`（两侧测试插入，687 行）

两侧在同一位置各自插入测试，内容互不相关：

- **fork 侧 11 个测试**：outline 摘要/404、history gzip 压缩、turn 分页游标（快照保持、中间页定位、字节预算、伪造游标拒绝、provider id 再生忽略、空历史元数据等）、branch 路由 provider 校验
- **upstream 侧 2 个测试**：`the running-sessions route reports a session held open for background work`、`the workflow agent route reads an agent's timeline and status from its run directory`
- upstream 侧还在文件头新增 import：`IProvider`、`BackgroundTaskSummary`、`WorkflowAgentActivity`
- **建议**：两侧测试全保留 + 合并 import。fork 侧的 turn 分页测试依赖 fork 私有实现，与 upstream 测试无交叉

### 3.9 `src/modules/chat/tests/useChatMessages.test.ts`（两侧测试插入，202 行）

- **fork 侧 4 个测试**：结构化 tool result 投影（缩进多行 JSON、对象结果缩进、toolInput 同规则缩进、剥离 `tool_use_error` 包装）
- **upstream 侧 3 个测试**：后台任务事件折叠到发起它的 tool row（`folds the live task events...`）、工作流进度事件保持 agent 列表、跨页 acknowledgement 定位调用行
- **建议**：两侧测试全保留
- **执行注记（评审补充，3.8/3.9 同）**：两节均为概要，实际解决时必须以 worktree 冲突原文为准逐块对照，不要按概要直接手写；同位置插入测试的文件常见一个文件内多个相邻冲突块，易漏解或解串位

---

## 4. B/C 类：需融合或取舍的冲突（重点评审）

### 4.1 `server/index.ts`（B，低风险）

```
<<<<<<< HEAD
const wss = createWebSocketServer(server, {
=======
// A completed run stays subscribable while its session's background work
// (agents, workflows, backgrounded commands) is still reporting through it.
chatRunRegistry.setRetentionGuard((sessionId) => providerRuntimeService.hasBackgroundWork(sessionId));

createWebSocketServer(server, {
>>>>>>> upstream/main
```

- fork：把 WebSocket 服务器返回值赋给 `wss` 变量（供 fork 自己的用途）
- upstream：在创建前注册 retention guard——已完成的 run 若仍有后台工作在汇报，保持可订阅
- **建议**：直接叠加——保留 upstream 的 `setRetentionGuard` 两行 + fork 的 `const wss =` 赋值。两者无语义冲突
- **核对项（评审补充）**：
  1. **`createWebSocketServer` 返回签名**：fork 侧依赖返回值赋给 `wss`，upstream 冲突块里是裸调用——确认 557109a2 未改返回值结构，否则 fork 的消费点会静默拿到 `undefined`
  2. **retention guard 对 5 个扩展 provider 的降级路径**：`hasBackgroundWork` 的信号源（`sawTaskEventThisTurn`/`stillOutstanding`）只存在于 claude runtime。需确认 dsh/workbuddy/pi/zcode/omp 的 runtime 在 `providerRuntimeService.hasBackgroundWork()` 下的行为：统一返回 `false` 是安全的（不保持、正常回收）；若按 provider 分表查状态，可能抛错或返回 `undefined` 被 guard 误判。合并后对任一扩展 provider 跑一次完整会话（启动 → 完成 → registry 回收），确认不保持、不报错

### 4.2 `server/modules/agent/agent.routes.ts` 冲突①（B，中）

```
<<<<<<< HEAD
    if (!['claude', 'cursor', 'codex', 'opencode', 'dsh', 'workbuddy', 'pi', 'zcode', 'omp'].includes(provider)) {
      return res.status(400).json({ error: 'provider must be "claude", "cursor", "codex", "opencode", "dsh", "workbuddy", "pi", "zcode", or "omp"' });
=======
    if (requestedProvider !== null && !['claude', 'cursor', 'codex', 'opencode'].includes(requestedProvider)) {
      return res.status(400).json({ error: 'provider must be "claude", "cursor", "codex", or "opencode"' });
>>>>>>> upstream/main
```

- fork：provider 白名单扩到 9 个
- upstream：校验重构为 `requestedProvider !== null && ...`——显式区分「未指定 provider」（null，走默认）与「指定了 provider」（校验白名单）。这是配合 agent run 注册机制的改动
- **建议**：采用 upstream 的 null 判断结构 + fork 的 9 provider 白名单：
  ```ts
  if (requestedProvider !== null && !['claude', 'cursor', 'codex', 'opencode', 'dsh', 'workbuddy', 'pi', 'zcode', 'omp'].includes(requestedProvider)) {
    return res.status(400).json({ error: 'provider must be ...' });
  ```
- **待评审**：upstream 侧 `requestedProvider` 的来源逻辑（上游在别处如何把 query param 变成 null）需随自动合并部分一起核对，确认 fork 侧未覆盖该段
- **执行注记（评审补充）**：`provider` → `requestedProvider` 的改名是机械陷阱——冲突块外的自动合并区域可能已整体改用 upstream 变量名，而 4.3 冲突②里 fork 的 5 个 else-if 分支判断的是 `provider === 'dsh'`。本文件合并完成后全文词边界搜 `provider`，逐个核对作用域与判空

### 4.3 `server/modules/agent/agent.routes.ts` 冲突②（C，高）

```
<<<<<<< HEAD
        }, writer);
      } else if (provider === 'dsh') {
        console.log('🤖 Starting DSH ACP session');
        // ... queryDsh(...) 5 个 fork 扩展 provider 的 else-if 分支
        // （dsh / workbuddy / pi / zcode / omp，每个分支调用对应的 queryXxx，
        //   传 projectPath/cwd/sessionId/model/effort/permissionMode + writer）
      } else if (provider === 'omp') {
        ...
        }, writer);
=======
        }, run.writer);
      }

      // A tab can now abort the run (`chat.abort`), on which the runtime
      // returns as it does on completion. What the interrupted agent left
      // behind is not a result to branch or open a PR from.
      const aborted = run.events.some((event) => event.kind === 'complete' && event.aborted === true);
      if (aborted) {
        writer.send({ type: 'status', message: 'Run aborted', aborted: true });
>>>>>>> upstream/main
```

- fork：在 query 调用链上串了 5 个新 provider 分支，每支以 `}, writer);` 结束
- upstream：把整段重构为注册式 agent run——分支链收敛为 `}, run.writer);`，之后统一做 aborted 检测（`chat.abort` 中止的 run 不产出可分支/开 PR 的结果）
- **建议（手动合并，本文件最大的工作量）**：
  1. 以 upstream 的 run 注册结构为骨架（`run.writer`、aborted 检测）
  2. 把 fork 的 5 个 provider 分支逐个适配新结构：`queryXxx(..., run.writer)`，且每个分支结束后同样落入 aborted 检测
  3. 核对 fork 各 `queryXxx` 签名与 upstream `run` 对象的 writer 语义是否一致
- **事件契约确认（评审补充，采纳自两位审阅者）**：upstream 的 aborted 检测依赖 `run.events` 中出现 `kind === 'complete' && aborted === true`，这套事件契约只对 claude/cursor/codex/opencode 四家实现验证过。fork 的 5 个 `queryXxx` 若不产出同构事件，会静默失败（abort 检测不到 → 中止后仍可分支/开 PR；或 registry 等待事件永不满足）。需逐个确认：①writer 事件流与 `run.writer`/`run.events` 消费端契约一致；②abort 后是否仍发出 `complete` 事件；③有无自身清理逻辑与 upstream 假设冲突。验收时每个扩展 provider 至少手工/curl 冒烟一次「正常完成」与「`chat.abort` 中止 → 不可分支」两条路径
- **风险**：这是 API 行为路径，改错会导致 agent run 中止状态误报或 5 个扩展 provider 无法启动

### 4.4 `server/modules/providers/list/claude/claude-runtime.provider.js`（C，高，共 2 块）

**冲突①（import，低）**

```js
<<<<<<< HEAD
import {
  createCompleteMessage,
  createDeltaBatcher,
  createNormalizedMessage,
  omitStreamedAssistantBlocks
} from '@/shared/utils.js';
=======
import { sessionHistoryCache } from '@/modules/providers/services/session-history-cache.service.js';
import { createCompleteMessage, createNormalizedMessage } from '@/shared/utils.js';
>>>>>>> upstream/main
```

- **建议**：合并两侧 import（保留 fork 的 `createDeltaBatcher`/`omitStreamedAssistantBlocks` + upstream 的 `sessionHistoryCache`）

**冲突②（hold 判定逻辑，语义级，高）**

```js
<<<<<<< HEAD
        // The turn is over again, so re-close the delta gate: only a held run's
        // next follow-up `message_start` may re-open it. Applied after the
        // `complete` above, whose flush must still carry the turn's final deltas.
        terminalSent = true;
        if (backgroundWorkPending) {
          // Work started during this turn is still running. Hold the process
          // open so it can finish and report back in a follow-up turn; the
          // ceiling is only a backstop for work that never reports.
          backgroundWorkPending = false;
=======
        // Work started during this turn, or work from an earlier turn that
        // has not settled yet (a follow-up turn reports one task in while
        // another is still going), is still running. Hold the process open
        // so it can finish and report back in a follow-up turn; the ceiling
        // is only a backstop for work that never reports.
        //
        // The release when the last task settles is this same branch on the
        // follow-up turn the CLI pushes for it, not the settling event
        // itself: closing stdin at that moment would cut the turn that
        // relays the task's result.
        //
        // When the turn reported its tasks, the tracker is the whole truth: an
        // Agent call without `run_in_background` is scored as background by
        // `startsBackgroundWork`, but the CLI runs it in the foreground and
        // it has settled before this `result` — holding for it kept a process
        // alive for the full ceiling with nothing outstanding.
        const holdForTurn = sawTaskEventThisTurn ? stillOutstanding : backgroundWorkPending || stillOutstanding;
        backgroundWorkPending = false;
        sawTaskEventThisTurn = false;
        if (holdForTurn) {
>>>>>>> upstream/main
```

- fork：`terminalSent`/delta gate 机制——回合结束时重关流式增量闸门，只允许 held run 的下一次 `message_start` 重开（配合 fork 的 StreamingBufferRegistry 流式缓冲工作线）
- upstream：hold 判定重构——引入 `sawTaskEventThisTurn`/`stillOutstanding`，修复两个问题：(a) 更早回合未结算的工作也会 hold；(b) 回合内报告过任务时以 tracker 为准，避免前台 Agent call 被误判为后台而白等满 ceiling
- **建议（手动语义合并）**：
  1. 采纳 upstream 的 `holdForTurn` 三态判定（它修复了真实的误保持 bug）
  2. 保留 fork 的 `terminalSent = true;` 及 delta gate 注释——**位置以事件时序为准，不按冲突块文本顺序**（评审修正，两位审阅者一致）：fork 原代码中该赋值位于 `complete` flush 之后、hold 判定之前；upstream 重构后 `complete` flush 的位置与块外自动合并代码可能已移动，合并时须对照 fork 原代码画出完整事件流程 `result/complete → flush → terminalSent → tracker 判定（holdForTurn）→ hold/release`，确认赋值插在 flush 之后、hold 判定之前，机械拼接可能重开/误关 delta gate
  3. fork 侧原 `if (backgroundWorkPending)` 的块体与 upstream `if (holdForTurn)` 的块体需比对：若 upstream 块体内也有改动，需逐行核对
- **验证顺序（评审补充）**：先跑 fork 侧流式缓冲测试（`executionProcess.test.ts` 等，定位 delta gate 是否被破坏），再跑 upstream 侧（`claude-runtime-hold.test.ts`、`claude-background-work.test.ts`，定位 hold 语义是否被破坏）；并用一个「complete flush 含最后 delta 且随后 hold」的测试锁住顺序
- **风险（本合并最高）**：这是 omp 工作线深度改过的区域。hold/release 时机错乱会导致后台任务被掐断或进程挂满 ceiling

### 4.5 `src/modules/chat/ChatInterface.tsx`（B，中）

fork 直接渲染 `<ChatMessagesPane>`；upstream 用 `TranscriptSessionContext.Provider` 包裹并新增 5 个 props（`currentSessionId`、`revealMessage`、`backgroundTasks={sessionActivity?.tasks}`、`sendMessage`、`onLoadFullTranscript`）。fork 侧独有 props：`isUserScrolledUp`、`onReasoningAutoCollapseStart`、`searchRevealRequest`。

```
<<<<<<< HEAD
        <ChatMessagesPane
          scrollContainerRef={scrollContainerRef}
          // （wheel/touch 注释两行相同，略）
          onWheel={handleScroll}
          onTouchMove={handleScroll}
          ... fork 全量 props（含 isUserScrolledUp、onReasoningAutoCollapseStart、
              searchRevealRequest、isUserScrolledUp 等）
        />
=======
          <TranscriptSessionContext.Provider value={transcriptSessionValue}>
            <ChatMessagesPane
              scrollContainerRef={scrollContainerRef}
              ... upstream 全量 props（含 currentSessionId、revealMessage、
                  backgroundTasks、sendMessage、onLoadFullTranscript）
            />
          </TranscriptSessionContext.Provider>
>>>>>>> upstream/main
```

- **建议**：采用 upstream 的 Provider 包裹结构 + 两侧 props 并集。同时：
  - 保留 fork 的 `TranscriptRevealRequest` 类型 import（fork 的 `searchRevealRequest` 与 upstream 的 `revealMessage` 是两套揭示机制，`ChatMessagesPane` 的 props 接口已由自动合并部分统一，需核对类型定义处）
  - `transcriptSessionValue` 的构造代码在 upstream 侧冲突块之外，应已被自动合入——需核对
- **待评审**：`searchRevealRequest`（fork，搜索定位揭示）与 `revealMessage`（upstream，后台任务条滚动揭示）在 `ChatMessagesPane` 内部如何共存，合并后是否互相干扰
- **核对方法（评审补充）**：先读 upstream `TranscriptSessionContext` 的类型定义与 `ChatMessagesPane` 的 context 消费点，确认 upstream 的 reveal 走 context 还是 props，再决定 fork 的 searchReveal 挂同一条线还是独立传递；并保证一次只允许一个 reveal 生效，避免后台任务条滚动与搜索定位互相抢滚动

### 4.6 `src/modules/chat/transcript/ChatMessagesPane.tsx`（B，中，共 3 块）

**冲突①（类型 import）**

```
<<<<<<< HEAD
import type {
=======
import type { BackgroundTaskSummary,
>>>>>>> upstream/main
  ChatMessage,
  ...
```

- **建议**：合并为 `import type { BackgroundTaskSummary, ChatMessage, ... }`（upstream 格式虽怪但是合法 TS）

**冲突②（组件 import）**

```
<<<<<<< HEAD
import ExecutionProcessSummary from '@/modules/chat/transcript/ExecutionProcessSummary';
import UserMessageStickyHeader from '@/modules/chat/transcript/UserMessageStickyHeader';
import { deriveUserMessageAnchors } from '@/modules/chat/utils/userMessageAnchors';
=======
import ChatExportMenu from '@/modules/chat/transcript/ChatExportMenu';
import { BackgroundTasksStrip } from '@/modules/chat/transcript/BackgroundTasksStrip';
>>>>>>> upstream/main
```

- **建议**：保留 fork 三行 + upstream 的 `BackgroundTasksStrip` 一行；**不引入** `ChatExportMenu`（fork 已删除该组件文件，见冲突③）

**冲突③（sticky 工具条，需要决策）**

```
<<<<<<< HEAD
（空——fork 删除了此处的导出菜单区域）
=======
      {chatMessages.length > 0 && (
        <div className="pointer-events-none sticky right-4 top-3 z-10 mb-2 flex items-start justify-between gap-2 sm:px-4">
          {/* Running background work stays in view while the transcript scrolls under it. */}
          <div className="pointer-events-auto min-w-0 pl-4 sm:pl-0">
            <BackgroundTasksStrip
              messages={chatMessages}
              tasks={backgroundTasks}
              sessionId={selectedSession?.id || currentSessionId}
              sendMessage={sendMessage}
              onReveal={revealMessage}
              onLoadAll={loadAllMessages}
            />
          </div>
          <div className="pointer-events-auto">
            <ChatExportMenu
              messages={chatMessages}
              sessionTitle={selectedSession?.summary || selectedSession?.title}
              provider={provider}
              selectedProject={selectedProject}
              createDiff={createDiff}
              onLoadFullTranscript={onLoadFullTranscript}
            />
          </div>
        </div>
      )}
>>>>>>> upstream/main
```

- 事实：base 里此处是 `ChatExportMenu`；fork 删除了它（组件文件也不存在了）；upstream 保留导出菜单并新增 `BackgroundTasksStrip`（运行中后台任务的悬浮条，滚动时保持可见）
- **建议**：接纳 upstream 的 sticky 条结构，但**去掉 `ChatExportMenu` 那个 div**（保持 fork 的删除决策）。即只保留 `BackgroundTasksStrip`
- **核对项（评审补充）**：
  1. **`onLoadAll` 与 fork 分页的语义**：`BackgroundTasksStrip` 的 `onLoadAll={loadAllMessages}` 走 fork 的全量接口还是 upstream 新增的 full-transcript 接口？fork 的 turn 分页 + gzip 本是为避免一次性全量加载设计的，若直接触发全量拉取会击穿设计初衷（超长会话一次展开），需确认其触发条件（仅在用户点击后台任务条时？）
  2. **死 prop 清理**：删除 `ChatExportMenu` 后，`onLoadFullTranscript` 这一 prop 链路在 `ChatInterface` → `ChatMessagesPane` 上是否变成死 prop（TS 不报错但属死代码），核对并在合并提交说明中记录
  3. **双 sticky 层叠**：fork 已有 `UserMessageStickyHeader`（用户消息吸顶），与 upstream 的 sticky 条可能重叠。验收按四种状态截图对比：无后台任务 / 有后台任务 / 消息为空 / 移动端 H5，核对层叠顺序、`z-index`、移动端安全区
- **待评审（决策项）**：~~fork 删除导出菜单是有意的产品决策还是历史遗留？~~ **已定案（2026-09-22，用户确认）**：fork 是有意重构——导出功能已迁至快捷设置面板（`QuickSettingsExportSection.tsx`，调用同一套 `downloadTranscriptExport`，格式 Markdown/HTML/PDF，PDF 为 fork 新增），非功能丢失。**D5 = 不恢复**右上角旧入口，恢复只会产生重复入口

### 4.7 `src/modules/chat/transcript/MessageComponent.tsx`（B，中，共 2 块）

**冲突①（SubagentPanel 锚点）**

```
<<<<<<< HEAD
              <SubagentPanel
                toolInput={message.toolInput}
                toolResult={message.toolResult}
                subagent={message.subagent}
                activity={message.subagentActivity}
                startTimestamp={message.timestamp}
                onFileOpen={onFileOpen}
                createDiff={createDiff}
                selectedProject={selectedProject}
              />
=======
              <div id={`tool-result-${message.toolId}`} className="scroll-mt-4">
                <SubagentPanel
                  toolInput={message.toolInput}
                  toolResult={message.toolResult}
                  subagent={message.subagent}
                  taskStatus={message.taskStatus}
                  activity={message.subagentActivity}
                  onFileOpen={onFileOpen}
                  createDiff={createDiff}
                  selectedProject={selectedProject}
                />
              </div>
>>>>>>> upstream/main
```

**冲突②（ToolRenderer/Bash 行锚点）**

```
<<<<<<< HEAD
                  <ToolRenderer
                    toolName={message.toolName || 'UnknownTool'}
                    ... fork props
                    toolStatus={message.toolStatus}
                    startTimestamp={message.timestamp}
                  />
=======
                  // Bash draws its output inside this row rather than in the
                  // result section below, so for a backgrounded command this is
                  // the row the background-tasks strip scrolls to.
                  <div id={message.toolName === 'Bash' ? `tool-result-${message.toolId}` : undefined} className="scroll-mt-4">
                    <ToolRenderer
                      toolName={message.toolName || 'UnknownTool'}
                      ... upstream props
                      toolStatus={message.toolStatus}
                    />
                  </div>
>>>>>>> upstream/main
```

- upstream：`id="tool-result-<toolId>"` 锚点（供 `BackgroundTasksStrip.onReveal` 滚动定位）+ `taskStatus` prop
- fork：`startTimestamp` prop
- **建议**：锚点 div + `taskStatus` + `startTimestamp` 全保留（两侧改动正交）

### 4.8 `src/modules/chat/utils/toolGrouping.ts`（B，低）

```ts
<<<<<<< HEAD
  return Boolean(
    message.isToolUse
    && message.toolName
    && !message.isSubagentContainer
    && !NON_GROUPABLE_TOOL_NAMES.has(message.toolName),
  );
=======
  return Boolean(message.isToolUse && message.toolName && !message.isSubagentContainer && message.toolName !== 'Workflow');
>>>>>>> upstream/main
```

- fork：`NON_GROUPABLE_TOOL_NAMES` 集合机制（含 fork 认定不可分组的工具）
- upstream：硬编码排除 `Workflow`（工作流调用不折叠进工具组）
- **建议**：保留 fork 的集合机制，把 `'Workflow'` 加进 `NON_GROUPABLE_TOOL_NAMES`（若尚未包含）。核对集合定义处是否被自动合并
- **验收注记（评审补充）**：排除分组后 Workflow 消息需有落点——upstream 有独立 `WorkflowPanel` 卡片展示，fork 的 transcript 是工具组 + `ExecutionProcessSummary` 体系。若 Workflow 消息既不进工具组、`WorkflowPanel` 接线又没接上，会整条从渲染中消失。验收时构造一条含 Workflow 调用的会话目检其展示

### 4.9 `src/modules/chat/tools/SubagentPanel.tsx`（C，高，共 3 块——实现路线取舍）

**冲突①（import）**

```
<<<<<<< HEAD
import { memo, useEffect, useMemo, useState } from 'react';
import { Bot, Brain, ChevronRight, CircleAlert, CircleCheck, MessageSquareText } from 'lucide-react';
=======
import { memo, useMemo, useState } from 'react';
import { Bot, ChevronRight, CircleAlert, CircleCheck, CircleDashed } from 'lucide-react';
>>>>>>> upstream/main
```

**冲突②（fork 的工具函数 + 分页常量 vs upstream 删除）**

```
<<<<<<< HEAD
function timestampMs(timestamp: string | number | Date | undefined): number | undefined { ... }
function summarizeCurrentActivity(activity: SubagentActivity | undefined): string { ... }
/**
 * How many timeline entries are drawn before the "show more" step. ...
 */
const INITIALLY_RENDERED_ACTIVITIES = 25;
=======
（空——upstream 把这些挪进了新组件 SubagentTimeline）
>>>>>>> upstream/main
```

**冲突③（timeline 渲染主体）**

```
<<<<<<< HEAD
          {visibleEntries.length > 0 && (
            <div className="border-l border-border/60 pl-2">
              {visibleEntries.map((entry, index) => (
                entry.kind === 'tool' ? (
                  <ToolRenderer ... startTimestamp={entry.timestamp} />
                ) : (
                  <SubagentNote key={`activity-${index}`} activity={entry} />
                )
              ))}
            </div>
          )}
          {hiddenCount > 0 && (
            <button ...>Show {hiddenCount} more ...</button>
          )}
          {untransmittedCount > 0 && hiddenCount === 0 && (
            <div ...>{untransmittedCount} earlier ... not included</div>
          )}
=======
          <SubagentTimeline
            activity={entries}
            activityCount={subagent?.activityCount}
            onFileOpen={onFileOpen}
            createDiff={createDiff}
            selectedProject={selectedProject}
          />
>>>>>>> upstream/main
```

- **fork 路线**：面板内联渲染 timeline，`INITIALLY_RENDERED_ACTIVITIES = 25` 分页 + "Show N more" 按钮 + untransmitted 提示——解决「长跑 agent 打开即挂载上百个 tool renderer」的性能问题
- **upstream 路线**：抽出 `SubagentTimeline` 组件（upstream 新文件，会随合并自动加入），SubagentPanel 瘦身
- **建议（倾向 fork 路线）**：保留 fork 的内联分页渲染（`SubagentTimeline` 是 upstream 对同一性能问题的另一种解法，fork 版已含等价能力且有 untransmittedCount 这个 fork 特有信息）
- **执行修订（评审补充）**：
  1. ~~本轮直接 `git rm` upstream 的 `SubagentTimeline.tsx`~~ **执行时推翻**：`SubagentTimeline` 被 upstream 新增的 `WorkflowPanel`（工作流卡片）import 使用，**不是无引用死文件，不能删**。最终执行：文件保留（供 WorkflowPanel），`SubagentPanel` 走 fork 内联渲染并恢复 fork 版 `SubagentNote`（其定义在自动合并中被 upstream 侧删除，已从 fork 原版恢复）
  2. `taskStatus` prop 的接收与使用升级为**合并完成的硬性验收项**：upstream 的 `MessageComponent.tsx` 冲突①解法里已包含传 `taskStatus`，漏接会直接 TS 编译报错
- **待评审（决策项）**：
  - 方案甲（保 fork）：无组件迁移成本，本轮 `git rm` upstream 组件（**注意：该决策非永久结论，每次 fork-sync 需重新评估是否迁移**）
  - 方案乙（用 upstream）：迁移到 `SubagentTimeline`，再把 fork 的 `startTimestamp` 传递、`untransmittedCount` 提示移植进新组件——更长期但工作量大

### 4.10 `src/modules/sidebar/SidebarHeader.tsx`（C，中，共 2 块）

```
<<<<<<< HEAD
import { useEffect, useState } from 'react';
import { Preferences } from '@capacitor/preferences';
import { Activity, Archive, Folder, FolderPlus, MessageSquare, Plus, RefreshCw, Search, X, PanelLeftClose } from 'lucide-react';
=======
import { FolderPlus, Plus, RefreshCw, Search, X, PanelLeftClose } from 'lucide-react';
>>>>>>> upstream/main
---
<<<<<<< HEAD
import { IS_PLATFORM, cn } from '@/shared/utils';
import type { SidebarSearchMode } from '@/shared/types';
import SidebarServerMenu from '@/modules/sidebar/SidebarServerMenu';
=======
import { IS_PLATFORM } from '@/shared/utils';
import type { SidebarSearchMode } from '@/shared/types';
import GitHubStarBadge from '@/modules/sidebar/GitHubStarBadge';
import SidebarModeTabs from '@/modules/sidebar/SidebarModeTabs';
>>>>>>> upstream/main
```

- fork：`SidebarServerMenu`（服务器菜单）、Activity/Archive/Folder/MessageSquare 图标、`@capacitor/preferences`（移动端偏好存储）——fork 的多服务/移动端工作线
- upstream：`GitHubStarBadge`、`SidebarModeTabs`（ Projects / Conversations 模式切换，配合侧边栏调宽功能）
- **建议**：import 全保留合并。组件体（非冲突区域，自动合并）中 upstream 的 `SidebarModeTabs` 渲染与 fork 的 `SidebarServerMenu`/归档入口渲染需人工核对布局是否互相挤占（`SidebarHeader` 是窄容器）

### 4.11 `src/modules/sidebar/SidebarSessionItem.tsx` + `SidebarProjectSessions.tsx`（B，中）

**SidebarSessionItem.tsx（props 接口，2 块）**

```
<<<<<<< HEAD
  /** True while the parent list is in manage (batch-select) mode. */
  isManaging: boolean;
  /** True when this row is selected in manage mode. */
  isBatchSelected: boolean;
=======
  /** The session's turn has ended but the agents, workflows or commands it launched still run. */
  hasBackgroundWork: boolean;
>>>>>>> upstream/main
（解构处同理：isManaging, isBatchSelected vs hasBackgroundWork）
```

**SidebarProjectSessions.tsx（调用处）**

```
<<<<<<< HEAD
              isProcessing={activeSessions.has(session.id)}
              isManaging={isManaging}
              isBatchSelected={selectedSessionIds.has(session.id)}
=======
              isProcessing={activeSessions.has(session.id) && !backgroundSessionIds.has(session.id)}
              hasBackgroundWork={backgroundSessionIds.has(session.id)}
>>>>>>> upstream/main
```

- fork：批量管理模式（isManaging/isBatchSelected）
- upstream：`isProcessing` 语义变化——后台工作会话不再显示为"处理中"（转由紫点指示），新增 `hasBackgroundWork`
- **建议**：props 并集（4 个 prop 都保留），`isProcessing` 采用 upstream 的排除语义：`activeSessions.has(id) && !backgroundSessionIds.has(id)`。`SidebarSessionItem` 组件体内需补 `hasBackgroundWork` 的紫点渲染（参考 upstream 版组件体，自动合并区域可能已带入，需核对）与 fork 的批量选择框渲染共存

### 4.12 `src/modules/sidebar/SidebarRecentConversations.tsx`（C，高——fork 结构重构 vs upstream 行内增强）

fork 把行渲染抽成了 `renderConversationRow` → `RecentConversationRow` 组件，并重构为**置顶/未置顶分组**；upstream 仍在旧的内联 `.map()` 平铺结构里给行内加了 `hasBackgroundWork` 紫点与 attention 琥珀点指示。

```
<<<<<<< HEAD
      {pinnedConversations.length > 0 && (
        <div className="mb-2">
          <div className="...uppercase...">
            <Pin className="h-3 w-3" />
            {t('recent.pinnedTitle', 'Pinned conversations')}
          </div>
          <div className="space-y-0.5">
            {pinnedConversations.map(renderConversationRow)}
          </div>
        </div>
      )}
      {unpinnedConversations.length > 0 && (
        <div>
          {pinnedConversations.length > 0 && (
            <div className="...">{t('recent.unpinnedTitle', 'Recent conversations')}</div>
=======
      <div className="space-y-0.5">
        {conversations.map((conversation) => {
          const hasBackgroundWork = sessionActions.backgroundSessionIds.has(conversation.sessionId);
          const isProcessing = sessionActions.activeSessions.has(conversation.sessionId) && !hasBackgroundWork;
          const showAttentionIndicator =
            sessionActions.attentionSessionIds.has(conversation.sessionId) && !isSelected;
          ...（内联 <a> 行 + SessionOptions，其中 isProcessing 时转圈、
              hasBackgroundWork 时紫色脉冲点、attention 时琥珀点）
>>>>>>> upstream/main
```

fork 的 `renderConversationRow` 现状：

```tsx
const renderConversationRow = (conversation: RecentConversationListItem) => {
  ...
  return (
    <RecentConversationRow
      ...
      isProcessing={activeSessions.has(conversation.sessionId)}   // ← 未含 upstream 的排除语义
      isManaging={isManaging}
      isBatchSelected={selectedSessionIds.has(conversation.sessionId)}
      ...
    />
  );
};
```

- **建议（保留 fork 结构 + 移植 upstream 增强）**：
  1. 保留 fork 的分组结构与 `RecentConversationRow`
  2. 把 upstream 三项增强移植进 `RecentConversationRow`：
     - `hasBackgroundWork = backgroundSessionIds.has(id)`（新 prop，紫点 + `Background work running` tooltip）
     - `isProcessing` 改为 `activeSessions.has(id) && !hasBackgroundWork`
     - `showAttentionIndicator = attentionSessionIds.has(id) && !isSelected`（琥珀点 + `Session needs attention` tooltip）
  3. 数据源对接（评审修订）：**在 `SidebarRecentConversations` 组件内部**从 upstream 的 `useSessionProtection` hook（自动合并部分已更新）取 `backgroundSessionIds`/`attentionSessionIds` 集合，仅向 `RecentConversationRow` 暴露 `hasBackgroundWork`/`showAttentionIndicator` 两个布尔 prop——避免继续往散 props 上加 derived set、也避免同一会话状态在 `sessionActions` 与散 props 两处各自维护
- **移植注意（评审补充）**：
  - upstream 的 `isSelected` 是内联 `.map()` 里现算的，fork 的 `renderConversationRow` 里取值来源与时机不同（分组渲染 + Row 内部），琥珀点条件不可直接照抄，需核对变量引用
  - fork 的新测试文件（`sidebarPinOptimistic.test.ts` 等）需补紫点/琥珀点渲染覆盖，否则这些行为在 fork 侧无测试保护（断言素材见 4.13 清单）
- **待评审**：upstream 的 `sessionActions` 聚合模式与 fork 的散 props 模式是否要趁机统一？本建议按「不统一全局架构、组件内用 hook 取数」处理，控制合并半径

### 4.13 DU：`src/modules/sidebar/tests/recentConversationRowActions.test.tsx`

- fork 在侧边栏测试重构中**删除**了此文件（连同旧的内联行测试，替代为 `sidebarPinOptimistic.test.ts`、`sidebarProjectFilter.test.ts`、`sidebarStoredPreferences.test.ts` 等）
- upstream 在 557109a2 中给它**加了 17 行**（后台工作相关的行为测试改动）
- **建议**：保持 fork 的删除（`git rm`）。upstream 的 17 行修改针对 fork 已不存在的旧测试结构，其中仍有价值的行为断言按下方清单移植进 fork 的新测试文件（`sidebarPinOptimistic.test.ts` / `sidebarStoredPreferences.test.ts` 等），不做测试覆盖回退：
  - **断言清单**（源自 upstream 对该文件的完整改动）：
    1. `SessionRowActions` fixture 增加 `backgroundSessionIds: new Set<string>()` 字段
    2. 核心断言（upstream 新测试「a session with only background work running gets the purple dot, not the spinner, and is not processing」）：
       - 会话在 `activeSessions` 且在 `backgroundSessionIds` → `isProcessing === false`
       - 无 `.animate-spin` 元素（不显示 spinner）
       - 恰有 1 个 `[role="status"].bg-purple-500` 紫点，`aria-label` 为 `tooltips.backgroundWorkIndicator`
       - 其余行正常显示时间（`time` 元素）

---

## 5. 全局风险与验证建议

1. **`claude-runtime.provider.js` hold 逻辑**（4.4）是最高风险点：合并后必须跑
   - `server/modules/providers/tests/claude-runtime-hold.test.ts`（upstream 新增）
   - `server/modules/providers/tests/claude-background-work.test.ts`
   - fork 的流式缓冲相关测试（`executionProcess.test.ts` 等）
2. **`isProcessing` 语义变化**波及侧边栏所有消费方（4.11、4.12），合并后全局搜 `isProcessing=` 核对是否漏改
3. **本机测试基线**（评审修订：以清单比对，不以数量比对）——`npm test` 恒有 9 个既有失败，属环境敏感噪声，**不要去修**；合并后**失败集合与下列清单逐条相等**才视为健康，出现新失败才排查：
   - `dsh-sessions.test.ts` / `workbuddy-session-synchronizer.test.ts` 各 1 个：`synchronizer keeps the app-assigned name and does not duplicate app sessions`
   - `workbuddy-auth.test.ts` 3 个：`desktop-managed WorkBuddy engine`、`detects a codebuddy executable on PATH`、`detects the CLI embedded in WorkBuddy.app`
   - `claude-cli-path.test.ts` 4 个：`resolveClaudeCodeExecutablePath ...`（含「非 Windows 回落到裸命令」等）
   - 另：`agent.routes.test.ts` 整套并发跑时偶发 `Unable to deserialize cloned data`（node:test IPC 崩溃），单独复跑必过，属框架偶发
4. **上游 100+ 新文件**（`BackgroundTasksStrip`、`WorkflowPanel`、`SubagentTimeline`、`TranscriptSessionContext`、`useSidebarWidth`、`SidebarModeTabs`、后端 project-clone 路由等）随合并自动进入，无需手动处理，但依赖它们的接线点正是上文 B/C 类冲突
5. **i18n**：`ja/sidebar.json` 手工合并后，核对 12 种语言 `sidebar.json` 的 key 集一致性（评审补充：用脚本而非人眼——以 `en/sidebar.json` 为基准 flatten key 集合、diff 其余 11 个，发现缺失的 `recent.pinnedTitle`/`search.mode*` 等新 key 补齐）
6. **编译与静态检查**（评审补充顺序）：**全部冲突解决后、跑任何测试前**先 `npx tsc --noEmit`（或项目等价命令）——props 并集类改动（4.7、4.11、4.12）容易漏 prop 类型定义；tsc 之后补项目 lint，覆盖 tsc 抓不到的 JS 后端文件 runtime-only 引用、未使用 import、import 排序（A 类两侧保留后常见重复/同名冲突）
7. **（评审补充）`sessionHistoryCache` 读取链路与 fork 历史改造的兼容性——前置确认**：upstream 的 workflow agent timeline（3.2）、后台任务结果恢复都经 `sessionsService.readWorkflowAgentActivity` → `sessionHistoryCache` 读 run 目录 transcript；fork 对会话历史做过 gzip + turn 分页改造（1.1、3.8）。已知证据：fork 的 gzip 测试断言的是 HTTP 响应头 `content-encoding`（传输层），倾向兼容；但 turn 分页快照涉及的读取路径仍需确认未改存储格式——若存储层变了，upstream 所有新读历史功能会静默读空（不报错、卡片为空）。该核对应在接纳 3.2 路由之前完成
8. **（评审补充）侧边栏拖宽在移动端 H5 的适配——合并后跟进项**：fork 有 Capacitor iOS 版，upstream `useSidebarWidth` 拖宽是桌面鼠标手势，触摸设备上与列表滚动/横滑手势冲突；其宽度持久化（localStorage）与 fork 的 `@capacitor/preferences` 体系（4.10）不一致。跟进：用现成的 `IS_PLATFORM` 判断在移动端禁用/降级拖宽，核对宽度持久化与 fork 偏好存储统一

## 6. 决策清单（待批注）

| # | 决策项 | 初稿建议 | 评审后状态 |
|---|--------|---------|-----------|
| D1 | `agent.routes.ts` ②：5 个扩展 provider 适配 run 注册结构 | 适配 upstream 新结构 | 已确认，补事件契约确认 + 每 provider 冒烟（4.3） |
| D2 | `claude-runtime.provider.js` ②：hold 判定 | upstream `holdForTurn` + fork `terminalSent` 按事件时序定位 | 已确认，措辞由「前置」修正为「事件时序」（4.4） |
| D3 | `SubagentPanel.tsx`：fork 内联分页 vs upstream `SubagentTimeline` 组件 | 保 fork 路线（方案甲），`git rm` upstream 组件 | **已执行**：保 fork 渲染 + 恢复 fork 版 `SubagentNote`；`SubagentTimeline.tsx` **保留**（执行时发现被 `WorkflowPanel` 引用，非死文件，评审的 git rm 前提不成立） |
| D4 | `ChatMessagesPane.tsx` ③：sticky 条 | 接纳 `BackgroundTasksStrip`，维持删除 `ChatExportMenu` | 已确认，补 onLoadAll 语义、死 prop、双 sticky 三项核对（4.6） |
| D5 | `ChatExportMenu` 是否恢复（fork 曾删） | 不恢复 | **已定案（用户确认）**：功能已迁至快捷设置面板且更完善（含 PDF），恢复旧入口只会重复 |
| D6 | `SidebarRecentConversations.tsx`：结构 | 保 fork 分组结构，移植 upstream 三项行内增强 | 已确认，数据源改为组件内 hook 取集合（4.12） |
| D7 | `sessionActions` 聚合 vs fork 散 props | 不统一全局架构，组件内用 hook 取数 | 已确认（4.12） |
| D8 | DU 测试文件 | 保持删除，断言按 4.13 清单移植 | 已确认 |
| D9 | A 类 9 项机械合并 | 全部两侧保留 | 已确认，补 import 排序/lint 检查（第 5 节第 6 条） |
| D10 | 执行顺序 | 先 `main` 合并（无冲突），再 `cloudcli-dev`；每解完一个 C 类冲突（4.3、4.4、4.9、4.12）单独跑相关测试再继续；tsc 在全部冲突解完后、任何测试前 | 已确认 |

---

*本文档由 fork-sync dry-run 生成：`git worktree` 临时目录预演 `git merge --no-commit --no-ff upstream/main`（基线 `3ed3be5a`，fork HEAD `71f57175`，upstream `6c51fcaa`）。冲突内容为逐文件原文摘录，长测试文件为概要。*

---

## 审阅批注

### Claude

> [!CAUTION]
> **4.3 / D1（agent.routes.ts 冲突②）——5 个扩展 provider 的事件语义适配被低估**。建议以 upstream run 注册结构为骨架没错，但 upstream 的 aborted 检测依赖 `run.events` 中出现 `kind === 'complete' && aborted === true` 事件，这套事件契约是针对 claude/cursor/codex/opencode 四家 `queryXxx` 实现约定的。fork 的 `queryDsh/queryWorkbuddy/queryPi/queryZcode/queryOmp` 若不产出同构事件，会出现两种静默失败：abort 永远检测不到（用户中止后仍可分支/开 PR），或 run 注册表等待事件永远不满足。合并时需逐个确认 5 个 `queryXxx` 的 writer 事件流与 `run.writer`/`run.events` 的消费端契约一致，并至少给每个扩展 provider 手工验证一次「中止 → 不可分支」路径。

> [!WARNING]
> **4.4 / D2（claude-runtime.provider.js 冲突②）——`terminalSent = true` 的"前置"建议存疑**。建议第 2 条说把 fork 的 `terminalSent = true;` 与 delta gate 注释"置于 hold 判定之前"，依据是 fork 注释"必须在 `complete` flush 之后应用"。但 upstream 侧重构了这一整段，`complete` flush 的位置与 4.4 冲突块外的自动合并代码都可能已移动——"hold 判定之前"不等于"complete flush 之后"。机械按初稿顺序摆放可能重开/误关 delta gate。合并时应以**事件时序**为准（对照 fork 原代码里 `terminalSent` 赋值相对于 complete flush 与 `if (backgroundWorkPending)` 块的顺序），而非按冲突块文本顺序；并务必跑 `claude-runtime-hold.test.ts` + fork 的 `executionProcess.test.ts` 双向验证（文档第 5 节已列，此处补充：建议先跑 fork 侧流式缓冲测试再跑 upstream 侧，失败信息更能定位是 delta gate 还是 hold 语义被破坏）。

> [!WARNING]
> **3.4（useChatComposerState.ts）被归为 A 类可能低估——Safari IME Enter 修复与 quickReplies 的 Enter 路径存在交叠**。上游 `fd424f3f` 修的是 keydown/composition 处理中 IME 候选确认的 Enter 不触发发送；fork 的 `isQuickReplyCommand` 也在 Enter 路径上拦截命令。两者虽 import 不冲突，但自动合并带入的 upstream keydown 逻辑与 fork 的 quick reply 拦截可能在同一个 handler 里叠加，产生"IME 确认被 quickReply 判定吃掉"或反之。建议合并后在 Safari（或 WebKit 内核）手动验证：中文输入法候选上屏、quick reply 命令发送、普通发送三条路径。同类提醒：`useChatRealtimeHandlers.ts`（3.5）upstream 侧带入 `collectRunningBackgroundTasks`/`normalizedToChatMessages`，说明冲突块之外还有成段 upstream 逻辑被自动合并，与 fork 的 `StreamingBufferRegistry` 事件处理是否互扰也值得快速过一遍，不宜因"仅 import 冲突"就跳过。

> [!WARNING]
> **4.6 / D4 / D5——`onLoadFullTranscript`/`onLoadAll` 与 fork 的 turn 分页 + gzip 存在语义冲突风险**。upstream 的 `BackgroundTasksStrip` 通过 `onLoadAll={loadAllMessages}` 与 `ChatExportMenu` 的 `onLoadFullTranscript` 实现"整段历史一次性拉全"，而 fork 的会话历史是 turn 分页游标 + gzip 压缩，本来就是为避免一次性全量加载设计的。接纳 `BackgroundTasksStrip` 时需确认：它的 `onLoadAll` 走的是 fork 的全量接口还是 upstream 新增的 full-transcript 接口？若直接触发全量加载，可能击穿 fork 分页的设计初衷（超长会话一次展开）。另外删除 `ChatExportMenu` 后，`onLoadFullTranscript` 这一 prop 链路在 `ChatInterface` → `ChatMessagesPane` 上是否变成死 prop（TS 不会报错但属死代码），建议顺手核对并在合并提交说明中记录。

> [!IMPORTANT]
> **4.9 / D3——保 fork 路线的长期成本需明示**。方案甲（保 fork 内联分页）当下成本最低，但 `SubagentTimeline.tsx` 会成为仓库内的无引用死文件，且**后续每次上游同步都会再次撞上 SubagentPanel 冲突**（upstream 会持续演进 SubagentTimeline）。若选甲，建议：① 本轮直接 `git rm` upstream 的 `SubagentTimeline.tsx`（留死文件只会误导，"留作参考"可看 upstream 仓库）；② 在 D3 决策处补一句"每次 fork-sync 需重新评估是否迁移"，避免该决策被当成永久结论。另注意文档已正确指出：无论甲乙，`taskStatus` prop 都必须补进 fork 版 SubagentPanel——这条建议升级为合并完成的硬性验收项，因为 upstream 的 `MessageComponent.tsx` 冲突①解法里已包含传 `taskStatus`，漏接会直接 TS 编译报错。

> [!IMPORTANT]
> **4.12 / D6——移植三项增强时注意 fork 分组结构里 `isSelected`/`isProcessing` 的计算位置变化**。upstream 的琥珀点条件是 `attentionSessionIds.has(id) && !isSelected`，其 `isSelected` 是内联 `.map()` 里现算的；fork 的 `renderConversationRow` 里 isSelected 的取值来源与时机不同（分组渲染 + `RecentConversationRow` 内部），直接照抄条件可能引用错变量。同时 fork 的 `RecentConversationRow` 需要新增 `hasBackgroundWork`/`showAttentionIndicator` 两个 prop 并更新 `recentConversationRowActions` 系列新测试文件（fork 自己的 `sidebarPinOptimistic.test.ts` 等）来覆盖紫点/琥珀点渲染，否则这些行为在 fork 侧无测试保护。

> [!IMPORTANT]
> **4.1（server/index.ts）——建议补核对 `createWebSocketServer` 返回签名**。fork 侧 `const wss = createWebSocketServer(server, {...})` 依赖其返回值；upstream 冲突块里是裸调用 `createWebSocketServer(server, {`（无赋值）。若 upstream 在 557109a2 中改动了该函数的返回值结构（例如不再返回 wss、或返回对象形状变化），fork 侧的赋值消费点会静默拿到 undefined。初稿只提了 import 核对，建议加上返回签名核对。

> [!TIP]
> **5.3（测试基线）——"9 个失败"建议落成清单而非数量**。失败数量对环境噪声极敏感（多一条 flaky 就失真）。建议合并前先跑一次 `npm test`，把这 9 个失败测试的**名字**逐条记进本文档，合并后比对"失败集合恰好相等"而不是"数量等于 9"。

> [!TIP]
> **5.5（i18n）——key 集一致性用脚本核对而非人眼**。12 个 locale × 若干新增 key 人工核对必漏。建议合并后跑一行对比脚本（如 Node 脚本以 `en/sidebar.json` 为基准 flatten key 集合、diff 其他 11 个），发现缺失的 `recent.pinnedTitle`/`search.mode*` 等新 key 补齐即可。

> [!NOTE]
> **D10（执行顺序）同意，建议补一条：`cloudcli-dev` 合并期间每解决完一个 C 类冲突（4.3、4.4、4.9、4.12）即单独跑一次相关测试再继续**，避免 22 个冲突全部解完才首跑测试、失败无法归因到具体冲突块。第 5 节的 `npx tsc --noEmit` 前置检查同样同意，建议放在解决完全部冲突后、跑任何测试前执行。

### Codex

> [!WARNING]
> **4.3 / D1——建议为 5 个扩展 provider 分别补“正常完成 + `chat.abort` 中止”回归用例。**初稿要求把 `queryDxx(..., writer)` 改为 `run.writer` 并落入统一 aborted 检测，但扩展 provider 的 writer 消费方式是否与 upstream 假设一致并未证明；尤其要确认这些 query 实现是否会在 abort 后仍发出 `complete`、是否已有自身清理逻辑。仅跑上游 claude 相关测试无法覆盖这 5 条适配路径，建议在合并验收清单中新增最小集成测试或至少 curl 冒烟脚本。

> [!IMPORTANT]
> **4.4 / D2——`terminalSent = true` 的位置可能不是简单“置于 hold 判定之前”。**初稿描述它必须在 `complete` flush 之后应用，而 upstream 片段中 `backgroundWorkPending = false; sawTaskEventThisTurn = false;` 等状态清零动作与 `holdForTurn` 绑定在同一语义序列里。若把 fork 的赋值插早，可能把尚未完成的 `complete` flush 也关闭 delta gate；若插晚，又会跳过 fork 注释要求的时机。建议不要按冲突块机械拼接，而是基于合并后的完整事件流程画出：`result/complete` → flush → `terminalSent` → tracker 判定 → hold/release，并用一个“complete flush 含最后 delta 且随后 hold”的测试锁住顺序。

> [!IMPORTANT]
> **4.6 / D4——仅删除 `ChatExportMenu` 仍可能留下无效条件与外层布局差异。**upstream 的 sticky 条条件是 `chatMessages.length > 0`，但 `BackgroundTasksStrip` 自身可能支持空任务集渲染；同时 fork 若已有自己的 sticky 用户消息头（`UserMessageStickyHeader`），两套 `sticky top-*` 的层叠顺序、`z-index`、移动端安全区需实测。建议验收项增加：无后台任务、有后台任务、消息为空、移动端 H5 四种状态下截图对比，避免“保留一个上游 sticky 条”造成双 sticky 重叠。

> [!IMPORTANT]
> **4.12 / D6——`backgroundSessionIds`/`attentionSessionIds` 不宜直接塞进散 props。**初稿已决定不统一 `sessionActions`，但若在 `SidebarRecentConversations` 继续增加两个 derived set props，组件 API 会进一步膨胀。最小改动可以在本组件内部从既有 upstream hook/自动合并上下文取集合，仅向 `RecentConversationRow` 暴露两个布尔 prop；如果上下文不可用，再补 props，并在组件类型处注明来源。关键是避免同一会话状态在 `sessionActions` 和散 props 两处各自维护。

> [!TIP]
> **4.13 / D8——同意保持删除旧测试文件，但应把上游 17 行改动转成一张断言清单。**逐条列出 fork 需要承接的断言（后台会话不显示 spinner、显示紫点、attention 显示琥珀点、tooltip 文案等），再映射到 fork 新测试文件；否则“有价值的断言移植”很容易在执行时被省略，DU 决策会变成测试覆盖回退。

> [!NOTE]
> **D9——A 类“两侧保留”仍需在解决完冲突后做 import 排序与未使用引用检查。**例如测试文件合并后可能存在同名 describe/变量冲突或重复 import；`npx tsc --noEmit` 能挡一部分，但 JS 后端文件和测试中的 runtime-only 引用不会被完全覆盖。建议在验证清单中明确执行项目 lint/test 相关命令，而不是只依赖 tsc。

### OpenCode

> [!CAUTION]
> **4.1 + 全局——retention guard 对 5 个扩展 provider 的行为未验证**。`chatRunRegistry.setRetentionGuard((sessionId) => providerRuntimeService.hasBackgroundWork(sessionId))` 对所有 provider 的会话生效，而 upstream 这套后台工作信号（`sawTaskEventThisTurn`/`stillOutstanding`，见 4.4）只存在于 claude runtime。dsh/workbuddy/pi/zcode/omp 的 runtime 若未实现 `hasBackgroundWork`，需确认降级路径：统一返回 `false` 是安全的（不保持、正常回收），但若实现按 provider 分表查状态，扩展 provider 会话可能抛错或返回 `undefined` 被 guard 误判。建议在 4.1 的核对项中明确加一条：合并后对任一扩展 provider 跑一次完整会话（启动 → 完成 → registry 回收），确认不保持、不报错。

> [!IMPORTANT]
> **3.2 / 4.4①——upstream 新增的 `sessionHistoryCache`/`readWorkflowAgentActivity` 读取链路与 fork 历史改造的兼容性需前置确认**。upstream 的 workflow agent timeline 路由（3.2）经 `sessionsService.readWorkflowAgentActivity` → `sessionHistoryCache` 读 run 目录的 transcript；而 fork 对会话历史做了 gzip 压缩与 turn 分页游标改造（1.1、3.8）。需先弄清 fork 的 gzip 是 HTTP 传输层压缩还是存储层格式变化：若仅传输层，upstream 读取链路直接兼容；若存储层变了，workflow timeline、后台任务结果恢复等所有新 upstream 读历史功能都会静默读不到数据（不报错、卡片为空）。该核对应在接纳 3.2 路由之前完成。

> [!IMPORTANT]
> **4.2——`provider` → `requestedProvider` 变量名统一是机械陷阱**。upstream 把校验重构为 `requestedProvider !== null`，意味着冲突块外的自动合并区域可能已整体改用 upstream 变量名（含 null 语义来源逻辑）；而 4.3 冲突②里 fork 的 5 个 else-if 分支判断的是 `provider === 'dsh'`。手动合并时若只解冲突块、不统一变量引用，会出现引用已改名变量或漏判 null 的运行时错误。建议 agent.routes.ts 合并完成后全文词边界搜 `provider` 逐个核对作用域与判空。

> [!WARNING]
> **6c51fcaa（侧边栏拖宽）在移动端 H5 的触摸冲突**。fork 有 Capacitor iOS 版本，upstream 的 `useSidebarWidth` 拖宽是桌面鼠标手势，在触摸设备上与列表滚动/横滑手势冲突；且其宽度持久化（若用 localStorage）与 fork 已有的 `@capacitor/preferences` 偏好体系（见 4.10 fork 侧 import）不一致。建议合并后：用现成的 `IS_PLATFORM` 判断在移动端禁用/降级拖宽，并核对宽度持久化存储是否与 fork 偏好存储统一。

> [!IMPORTANT]
> **4.8——`'Workflow'` 入集合之外，还需核对 Workflow 消息在 fork 渲染树的落点**。upstream 排除 Workflow 分组是因为它有独立卡片（`WorkflowPanel`）展示；fork 的 transcript 是工具组 + `ExecutionProcessSummary` 体系，合并后 Workflow 消息若既不进工具组、`WorkflowPanel` 接线又没接上，会整条从渲染中消失。建议验收时构造一条含 Workflow 调用的会话目检其展示。

> [!TIP]
> **3.8 / 3.9——dry-run 概要与实际冲突可能有子块差异**。文档自述长测试文件为"概要"（687 行 / 202 行），实际解决时应以 worktree 冲突原文为准逐块对照，不要按概要直接手写；两侧在同一位置各自插入测试时，常见一个文件内多个相邻冲突块，容易漏解或解串位。

> [!NOTE]
> **4.5——两套揭示机制共存的核对方法**。`searchRevealRequest`（fork）与 `revealMessage`（upstream）都操纵滚动位置。建议先读 upstream `TranscriptSessionContext` 的类型定义与 `ChatMessagesPane` 的 context 消费点，确认 upstream 的 reveal 走 context 还是 props，再决定 fork 的 searchReveal 挂同一条线还是独立传递；并保证一次只允许一个 reveal 生效，避免后台任务条滚动与搜索定位互相抢滚动。

### 牵头结论

- **采纳：23/23 条**（Claude 10 条、Codex 6 条、OpenCode 7 条），其中两对同类批注（4.3 的 Claude+Codex、4.4 的 Claude+Codex）合并为单项落实。无「不采纳」项。
- **关键修正**：
  - 4.4 `terminalSent` 位置由「置于 hold 判定之前」修正为「以事件时序定位（complete flush → terminalSent → tracker 判定 → hold/release）」（来源：Claude、Codex，一致指出初稿措辞会被机械拼接误用）
  - 4.9 `SubagentTimeline.tsx` 由「留作参考」改为「本轮 `git rm`」，并标注 D3 为非永久结论（来源：Claude）
  - 4.12 数据源对接由「把集合引到本组件（措辞含糊）」细化为「组件内经 `useSessionProtection` hook 取集合、仅向 Row 传布尔 prop」（来源：Codex）
  - 3.4/3.5 由「纯机械合并」升级为「合并后需验证」（IME Enter 路径与 quickReplies 交叠、自动合并段与 StreamingBufferRegistry 互扰）（来源：Claude）
- **新增核对/验收项**（来源：Claude、OpenCode、Codex）：4.1 WebSocket 返回签名 + retention guard 扩展 provider 降级路径；4.2 变量改名全文核对；4.3 事件契约确认 + 每 provider 两条冒烟路径；4.5 双 reveal 互斥；4.6 onLoadAll 语义 + 死 prop + 双 sticky 四状态截图；4.8 Workflow 渲染落点目检；4.13 断言清单（已从 upstream 原文提取落定）；第 5 节新增第 7 条（sessionHistoryCache 前置确认）与第 8 条（拖宽移动端适配）
- **基线落成清单**：第 5 节第 3 条已由「9 个失败（数量）」改写为逐条测试名清单，合并后按集合比对（来源：Claude）
- **修订说明**：本次按批注修订了 3.4、3.5、3.8/3.9、4.1、4.2、4.3、4.4、4.5、4.6、4.8、4.9、4.12、4.13 共 13 处正文；第 5 节扩为 8 条并调整验证顺序（tsc → lint → 测试，C 类冲突逐项先跑）；第 6 节决策清单增加「评审后状态」列，D1–D4、D6–D10 已确认，仅 D5（`ChatExportMenu` 是否恢复）待用户最终拍板。
