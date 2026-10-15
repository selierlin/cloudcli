# CloudCLI 侧边栏「Fork 会话即时出现」方案

- 文档日期：2026-10-15
- 适用仓库：`cloudcli`（React 前端 `src/` + Node 后端 `server/`）
- 状态：**已实施（方案 A；Q1-b + Q2-a + Q4「解析不到则仅导航」）**——2026-10-15，见文末「实施记录」
- 前置文档：[`CloudCLI侧边栏新建会话即时出现方案.md`](CloudCLI侧边栏新建会话即时出现方案.md)（已实施，方案 D：本机新建即时出现）
- 目标读者：独立评审者 / 其他 AI（本文自足，无需会话上下文）
- 评审重点：**§3 方案取舍（A 显式信号 vs B ws 插入分支）、§6 待拍板项（聊天内 fork 的信号入口）**

> [!IMPORTANT] **行号纪律**
> 本文所有行号写作时取自当前工作区，可能已漂移。**实现前一律以「符号 / 引文」为准**，不要照抄行号。

---

## 0. 一句话结论

前置文档给「本机新建会话」补了一条桥（`createdConversation` 显式信号 → 侧栏 feed 插入）。**两条 fork 路径（侧边栏「…」→ 派生会话、聊天内 AI 回复下方「从此处派生」）都没有走这座桥**：它们只做导航，new 行要等侧栏刷新才出现在「对话」列表。本方案把这两条路径也接上同一条桥——都在 **fork 成功的那一刻**发一条「新会话进对话列表」信号，其余（插入位置、`total`、去重）复用既有机制。

---

## 1. 问题现象与复现

**现象**：通过以下两种方式 fork 一个会话后，新会话会**立刻被打开**，但**不出现在**侧边栏「对话」页签的列表里，必须点侧栏顶部「刷新」才出现。

**两条入口**：

1. **侧边栏「…」→ 派生会话**：会话行右侧「…」菜单里的 `派生会话`（`SessionOptions.tsx` 的 `sessions.forkSession`）。
2. **聊天内「从此处派生」**：AI 回复内容下方的 `forkFromHere` 按钮（`MessageComponent.tsx`）。

**对照**：同样动作下，**「项目」页签（项目树）** 里新会话会即时出现（服务端 fork 后广播了 `session_upserted`）。缺失的只是「对话」列表。

**复现步骤**（任选入口）：

1. 打开侧边栏，记下当前「对话」列表。
2. 在一个**已完成**、且 provider 支持 fork 的会话上点派生（侧栏菜单或聊天内按钮）。
3. 观察：应用跳到新会话 → 回看「对话」列表 → **无新行**；点刷新 → 新行出现在顶部。

---

## 2. 现状链路与证据（含 file / 符号）

### 2.1 「新建会话即时出现」的既有桥（前置文档已实现）

- 生产端：`useProjectsState.ts` 的 `registerOptimisticSession`（`src/modules/project-workspace/hooks/useProjectsState.ts`），在写入 `projects` 之外，末尾 `setCreatedConversation(...)` 产出一条 `CreatedConversationSignal`（`row: RecentConversationListItem` + `nonce`）。row 的字段口径：`sessionTitle = summary.trim() || sessionId`、`isPinned: false`、`lastActivity = now`。
- 穿线：`useProjectsState` 的 `sidebarSharedProps` 带出 `createdConversation` → `Sidebar` → `useSidebarController`。
- 消费端：`useSidebarController.ts` 新增 1 个 effect（对应符号 `insertedConversationIdsRef` 与其后的 `useEffect`）：去重后把 row **插到置顶块之后、未置顶块之前**，并 `recentConversationsTotal + 1`。

> 关键点：这条桥只在 `registerOptimisticSession` 一处产信号。

### 2.2 两条 fork 路径都只导航，不发信号

| 入口 | 处理函数（符号） | 现有行为 | 是否发 `createdConversation` |
|---|---|---|---|
| 侧边栏「…」派生 | `useSidebarController.ts` 的 `forkSession` | `api.forkSession(session.id)` 成功后 `onSessionSelect({ id, summary, __provider, __projectId })` 导航 | **否** |
| 聊天内派生 | `ChatInterface.tsx` 的 `handleForkFromMessage` | `api.forkSession(sourceSessionId, { upToAnchorId })` 成功后 `onNavigateToSession(forkedSessionId)` | **否** |

`forkSession` 上方的注释写着「新行会随 websocket 到达，所以这里不重取」——**该注释对「对话」列表不成立**（见 2.3）。

### 2.3 为什么 ws 到不了「对话」列表

服务端 fork **确实会广播**：`server/modules/providers/services/sessions.service.ts` 的 `forkSessionById` 在 `createForkedSession` 之后 `await broadcastSessionUpserted(forkSessionId, 'metadata')`。

但客户端 ws 处理（`useProjectsState.ts` 中 `event.kind === 'session_upserted'` 的分支，符号 `upsertSessionIntoProject` 调用处）**只 `setProjects`**，从不写 `recentConversations`。「对话」列表是另一份**按需分页**拉取的数据（`fetchRecentConversationsPage` → `GET /api/providers/sessions/recent`），重新拉取时机只有：切到该页签、改搜索词、点刷新、置顶/删除/归档等动作。

> 结论：fork 的新会话确实已落库（刷新必能看到），但**在刷新之前没有任何东西把它喂给「对话」列表**。这与前置文档 §2.3 描述的「新建会话」根因是**同一类缺口**。

### 2.4 fork 的服务端产物（决定 row 的字段口径）

`forkSessionById` 返回 `{ sessionId, provider, projectPath, sessionName }`，其中 `sessionName = options.title?.trim() || \`${source.custom_name?.trim() || 'Session'} (fork)\``。

`createForkedSession`（`server/modules/database/repositories/sessions.db.ts`）写入的列里：
- `custom_name = sessionName`、`name_source = 'manual_rename' | 'fork'`；
- `forked_from_session_id = source`；
- **不写 `parent_session_id`**（那是「会话所属关联」的列，与 fork 血缘是两码事）。

所以 fork 出的会话在「对话」列表里是**顶层行**（没有「filed under …」引用行），标题是 `sessionName`。

---

## 3. 方案对比

| 方案 | 做法 | 评价 |
|---|---|---|
| **A. 按路径补显式信号（推荐）** | fork 成功的那一刻，把「新会话进对话列表」信号发出去：侧栏 fork 由 controller 直接插入 feed state；聊天内 fork 走上行信号（见 §4）。 | **采用**。与前置文档 D 同构；插入时机精确（此刻确知它是新会话），排序 / `total` / 去重全部复用既有机制。 |
| B. 在 ws「插入分支」统一喂 feed | 在 `useProjectsState.ts` 的 ws 分支里，当 `upsertSessionIntoProject` 判定为**插入**时也 `setCreatedConversation`。 | **否决**。见下。 |
| C. fork 后重取首页 | `await reloadRecentConversations()` | 否决：多一次网络往返；会把已翻到第 2+ 页的行丢掉；可能闪 loading 态。与前置文档否决理由一致。 |

**为什么否决 B（本轮新增的判据，请评审重点核）**：

`projects` 里的会话列表本身是**分页**的（`Project.sessionMeta = { hasMore, total }`，服务端 `getSessionsByProjectPathPage` 带 `LIMIT/AND isArchived = 0`）。因此一个**数据库里早已存在、只是没被加载进当前页**的老会话，它的 `session_upserted` 到达客户端时，在 `upsertSessionIntoProject` 里同样会被判为 `inserted = true`（客户端 `projects` 里找不到它）⇒ 方案 B 会把这条**老会话**顶到「对话」列表**顶部**，与服务端「按活动时间倒序」的排序不符，直到下一次重取才纠正。B 无法区分「真·新会话」和「只是本端没加载过」，这正是前置文档三审 §D 把 ws 路径排除在外的原因。

方案 A 把信号打在 fork 成功回调里——**代码位置本身就携带「这是刚创建的新会话」这一事实**，不需要靠 `projects` 是否含该 id 去猜。

---

## 4. 选定方案（方案 A）详细设计

### 4.1 数据流

```
【侧栏「…」派生】
  forkSession ──api.forkSession()──▶ { sessionId, sessionName }
        ├─ onSessionSelect(...)                       （保留：导航/打开）
        └─ [新增] 构造 row → 折入 recentConversations state + total+1

【聊天内「从此处派生」】
  handleForkFromMessage ──api.forkSession()──▶ { sessionId, sessionName }
        ├─ onNavigateToSession(...)                   （保留：导航/打开）
        └─ [新增] 发「新会话进对话列表」信号
                        │  (经 shell 到 useProjectsState)
                        ▼  setCreatedConversation({ row, nonce })
                 useSidebarController 的既有 effect 折入 feed state + total+1
```

两条路径最终都落到**同一份** `recentConversations` state，插入规则 / 去重 / `total` 完全复用既有 effect。

### 4.2 插入规则（复用既有，不新增）

沿用前置文档 D 的规则，且**必须满足**：

1. **位置**：插到置顶块之后、未置顶块之前（fork 新会话必未置顶，对齐服务端 `isPinned DESC` 之后按活动时间倒序的语义）。
2. **`total` 只在真正插入时 +1**：若 feed 已含该 id（例如期间发生了一次重取，或 signal 重放），不得再加。
3. **双层去重**：`insertedConversationIdsRef`（每个 id 只并入一次）+ 函数式更新里的成员检查。掉出 feed（归档/删除）后不得被旧信号顶回。

### 4.3 row 字段映射（对齐服务端 `/recent` 派生规则）

| 字段 | 取值 | 依据 |
|---|---|---|
| `sessionId` | fork 响应 `payload.data.sessionId` | `forkSessionById` 返回 |
| `provider` | 侧栏：`session.__provider`；聊天内：`selectedSession.__provider` | 两侧均已持有 |
| `projectId` | 见下方「projectId/displayName 解析」 | — |
| `projectDisplayName` | 同上 | — |
| `sessionTitle` | `(payload.data.sessionName ?? '').trim() \|\| sessionId` | 与 `registerOptimisticSession` 同口径；服务端会话标题 = `custom_name?.trim() \|\| session_id` |
| `lastActivity` | `new Date().toISOString()` | 与 `registerOptimisticSession` 同口径 |
| `isPinned` | `false` | fork 新会话必未置顶 |
| `parentSessionId` | `null`（不写） | fork 只写 `forked_from_session_id`，不写 `parent_session_id`；服务端 `/recent` 对顶层行给 `parentSessionId = null` |

**projectId / projectDisplayName 解析**：

- 聊天内 fork：直接取 `selectedProject.projectId` / `selectedProject.displayName`（`ChatInterface` 已持有 `selectedProject: Project | null`）。
- 侧栏 fork：`useSidebarController` 持有 `projects`，**优先按会话 id 反查其所属 project**（`projects.find(p => (p.sessions ?? []).some(s => s.id === session.id))`）取 `projectId`/`displayName`；回退 `session.__projectId`。若两边都解析不出，则**跳过 feed 插入、保留导航**（不阻塞 fork 的可见结果）。

> 时间口径约束（沿用前置文档 §B 新增点 3）：乐观行 `lastActivity` 是本地 ISO-UTC；服务端行是 DB `CURRENT_TIMESTAMP`（秒级、无时区后缀）。**只做位置插入、不跨源比时间**，故不受影响。

### 4.4 聊天内 fork 的信号入口（**待拍板，见 §6 Q1**）

`ChatInterface` 够不到侧栏 feed（它渲染在 `WorkspaceMain` 下，与 `Sidebar` 平级），必须把「新会话进对话列表」这件事经共享父层回传。现有两条现成通道可参照：`onSessionEstablished`（→ `registerOptimisticSession`）、`onNavigateToSession`。

- **Q1-a 复用 `onSessionEstablished`**：`handleForkFromMessage` 里再加一句 `onSessionEstablished?.(forkedSessionId, { provider, project, summary: sessionName })`。**零新 prop、零新类型**。代价：① `registerOptimisticSession` 的语义是「聊天 run 创建了会话」，fork 不是 run；② 它会**顺带** `setProjects` 乐观 upsert 与 `setSelectedSession`，其中乐观 upsert 会把服务端 ws 已经送达的树的 `messageCount` 覆写为 `0`（`upsertSessionIntoProject` 是 `{...existing, ...incoming}`，incoming 的 `messageCount: 0` 会赢）。
- **Q1-b 新增窄回调 `onSessionForked`**：语义准确，只发 feed 信号，**不碰 `projects` / `selectedSession`**（树行由服务端 ws 广播负责，无需本地乐观）。代价：需从 `useProjectsState` 穿到 `ProjectMainRegion` → `WorkspaceMain` → `ChatInterface`。

**牵头倾向 Q1-b**：与「只桥接 feed」的目标一致，且避免覆写 ws 已到位的树行字段。若评审认为穿线成本过高，退 Q1-a 亦可（功能可用，仅语义与 messageCount 短暂偏差）。

### 4.5 侧栏 fork 的插入方式（**待拍板，见 §6 Q2**）

- **Q2-a controller 本地插入（牵头倾向）**：`useSidebarController` 已经是 feed state 的 owner（持有 `setRecentConversations`、`insertedConversationIdsRef`）。把既有 effect 的「折入 feed」逻辑抽成一个内部小函数（如 `insertConversationRow(row)` / `foldConversationRow(prev, row)`），effect 与 `forkSession` 共用。**不新增任何 props 穿线**。
- **Q2-b 统一走 signal**：把信号生产者（`registerForkedSession`）经 `sidebarSharedProps` → `Sidebar` → controller 下传，`forkSession` 调它，仅由 effect 落 state。收益是「唯一生产者 + 唯一插入点」，代价是给侧栏新增一条上行回传链路。

两者都满足 §4.2 的规则；差别只在「插入调用点有几个」。

---

## 5. 必须守住的不变量

1. **一条路径只导航、只插一行**：fork 成功 → 既有导航行为不变；feed 里最多新增 1 行，不重复、不覆盖既有行。
2. **`total` 与 state 同步**：只有真正插入时才 +1。
3. **引用稳定**：无信号时 `recentConversations` 不因 fork 相关渲染而整体换引用（不得引入每次 render 都重算的派生层）。
4. **不额外请求**：fork 即时出现**不**触发 `fetchRecentConversationsPage`。
5. **搜索态隔离**：仅作用于非搜索态的「对话」列表渲染分支（沿用前置文档结论）。
6. **导航优先**：即便 feed 插入的 project 解析失败，也必须完成导航。

---

## 6. 待拍板项（请评审重点裁决）

| # | 问题 | 选项 | 牵头倾向 |
|---|---|---|---|
| Q1 | 聊天内 fork 的信号入口 | a) 复用 `onSessionEstablished`（小，但语义外扩 + 覆写树行 messageCount）；b) 新增窄 `onSessionForked`（准，需穿线） | **b** |
| Q2 | 侧栏 fork 的插入方式 | a) controller 本地插入（复用既有 effect 逻辑）；b) 统一走 signal（穿线到 controller） | **a** |
| Q3 | 信号语义命名 | 是否把 `createdConversation` 泛化为「新增会话进对话列表」，还是为 fork 复用同一信号、仅收敛文档注释？ | 复用同一信号，改注释 |
| Q4 | 解析不到 project 时是否仍插行 | 跳过插入（仅导航）？还是用 `session.__projectId` 兜底即便 displayName 缺失？ | 跳过插入、仅导航 |

**已核、无需拍板**：

- fork **不写** `parent_session_id`（§2.4），故 fork 行在 feed 里是顶层行，row 不需要 `parentTitle`。
- 服务端 fork **会**广播 `session_upserted`（§2.3），所以「项目树」侧无需本方案干预；本方案只补「对话」列表。

---

## 7. 测试计划

### 7.1 hook 测试（`src/modules/sidebar/tests/`，沿用 `recentConversationNewSession.test.ts` 的 `renderController` 夹具）

新增 `recentConversationFork.test.ts`（或并入现有文件）：

1. 侧栏 fork 成功后：feed 顶部（置顶块之后）出现新行，`sessionTitle = sessionName`，`total + 1`，且**未**调用 `recentConversations` 接口。
2. 置顶行存在时：fork 行插在置顶块之后（同既有 #3 用例）。
3. `sessionName` 为空：`sessionTitle` 回退为 `sessionId`。
4. 同一 `sessionId` 的 fork 信号重放：不重复、`total` 不二次 +1。
5. fork 后 feed 又整体重取（已含该行）：不重复、`total` 正确。
6. 解析不到 project（`session.__projectId` 缺失且 `projects` 无匹配）：不插行、`total` 不变（仍导航 —— 由调用方测试覆盖）。

### 7.2 生产端测试

若选 Q1-b：`useProjectsState` 增加 1 条「`registerForkedSession` 产出的 row 字段口径」测试（对齐 `projectsStateAttention.test.ts` 里 `registerOptimisticSession` 的既有用例）。若选 Q1-a 则复用既有测试，无需新增。

### 7.3 回归

`recentConversationNewSession.test.ts`、`recentConversationTitleSync.test.ts`、`sidebarPinOptimistic.test.ts`、`recentConversationBackgroundWork.test.tsx` 必须保持全绿。

> 环境提示（沿用前置文档）：本机 Node 26 的原生 WebStorage 与 jsdom 冲突会导致依赖 `localStorage` 的 client 测试必红；本套件须在 **Node 20** 下跑（例：`PATH="$HOME/.nvm/versions/node/v20.19.6/bin:$PATH" npx vitest run`）。

---

## 8. 验证步骤（真机 / 冒烟）

1. 起服务，未改动服务端时**刷新页面即可**（纯前端改动）。
2. 侧栏「…」→ 派生会话 ⇒ 应用跳到新会话，且「对话」列表**顶部即时**出现 fork 行（标题为 `… (fork)`），无重复、`total` 正确；点刷新不产生第二行。
3. 聊天内 AI 回复下方「从此处派生」⇒ 同上。
4. 有置顶会话时：fork 行出现在置顶块**之后**。
5. 回归：用既有「新建会话」入口，行为不变。

---

## 9. 影响面

| 层 | 文件（符号） | 改动 |
|---|---|---|
| 侧栏 | `src/modules/sidebar/hooks/useSidebarController.ts` | 抽出「折入 feed」helper；`forkSession` 构造 row 并折入（Q2-a） |
| 聊天 | `src/modules/chat/ChatInterface.tsx` (`handleForkFromMessage`) | fork 成功后发信号（Q1-a 1 行；Q1-b 调新 prop） |
| 生产端 | `src/modules/project-workspace/hooks/useProjectsState.ts` | 仅 Q1-b：新增 `registerForkedSession`（只发 feed 信号） |
| 穿线 | `ProjectMainRegion.tsx` / `WorkspaceMain.tsx` / `Sidebar.tsx` | 仅 Q1-b：新增 `onSessionForked` 的传递 |
| 类型 | `src/shared/types.ts` | 仅 Q1-b（或在 Q3 里把信号注释泛化）时微调；否则不动 |
| 测试 | `src/modules/sidebar/tests/…` | §7 新增/回归 |

**无服务端改动**（fork 广播已存在）。

---

## 10. 给评审者的质疑清单（请读代码推演失败路径）

1. **Q1-a 的覆写风险**：`upsertSessionIntoProject` 是 `{...existing, ...incoming}`。ws 已把 fork 行写进 `projects` 后，`registerOptimisticSession` 的乐观 upsert 是否真的会把 `messageCount` 覆写为 `0`？会否造成「项目树行短暂显示 0 条消息」？影响是否可接受？（若成立，Q1-a 的代价被低估）
2. **Q2-a 的去重一致性**：controller 本地插入与 `createdConversation` effect 共用 helper 后，`insertedConversationIdsRef` 的两处写入是否仍能保证「每个 id 只并入一次」？本地插入加入 ref 后，若之后真有一条同 id 的 `createdConversation` 信号到达，会被正确跳过吗？
3. **竞态**：fork 响应到达前若发生一次 `fetchRecentConversationsPage(0,false)`（整体替换），本地插入是否会被冲掉？冲掉后能否靠「已落库 + 下次重取」恢复？窗口多大？
4. **`total` 原子性**：本地插入在「feed 尚未加载」（用户从未切到「对话」页签）时执行会怎样？会不会 `total = 1` 但 `recentConversations` 为空、渲染出错误空态？
5. **projectId 反查的可靠性**：侧栏 fork 的 `session` 到底带不带 `__projectId`？「按会话 id 扫 `projects`」在「项目会话分页」下是否可能扫不到（会话在未加载的页里）？若扫不到应如何降级？
6. **Q3 命名**：复用 `createdConversation` 承载 fork，会否有消费者按「本地新建」语义解读该信号（除 feed 插入外）？请全量排查 `createdConversation` 的消费点。
7. **是否还有更小的桥接点**：是否存在直接能拿到 fork 结果的共享层（例如 `api` 层或 ws 通道）可在 controller 内落 state，省去聊天内穿线？

---

## 附录 A：关键证据片段（符号级）

### A.1 侧栏 fork（待改）

`src/modules/sidebar/hooks/useSidebarController.ts` · `forkSession`：

```ts
const forkSession = useCallback(async (session: SessionWithProvider) => {
  try {
    const response = await api.forkSession(session.id);
    const payload = await response.json();
    const forkedSessionId = payload?.data?.sessionId;
    if (!response.ok || typeof forkedSessionId !== 'string') {
      throw new Error(payload?.message || `HTTP ${response.status}`);
    }
    onSessionSelect({ id: forkedSessionId, summary: payload.data.sessionName,
                     __provider: session.__provider, __projectId: session.__projectId } as ProjectSession);
  } catch (error) {
    console.error('[Sidebar] Error forking session:', error);
    alert(t('messages.forkSessionError'));
  }
}, [onSessionSelect, t]);
```

### A.2 聊天内 fork（待改）

`src/modules/chat/ChatInterface.tsx` · `handleForkFromMessage`：成功分支目前仅 `onNavigateToSession?.(forkedSessionId)`。

### A.3 服务端 fork 广播（已存在，无需改）

`server/modules/providers/services/sessions.service.ts` · `forkSessionById`：`createForkedSession(...)` 之后 `await broadcastSessionUpserted(forkSessionId, 'metadata')`，返回 `{ sessionId, provider, projectPath, sessionName }`。

### A.4 既有 feed 插入 effect（待抽 helper）

`src/modules/sidebar/hooks/useSidebarController.ts`：`insertedConversationIdsRef` + 其后的 `useEffect`（消费 `createdConversation`），逻辑为「ref 去重 → feed 已含则早退（不加 total）→ 否则 `[...pinned, row, ...unpinned]` 且 `total+1`」。

---

## 审阅批注

> 请审阅者在对应 harness 的小节内以 `> [!INFO]/[!TIP]/[!WARNING]/[!CAUTION]` 形式追加，注明命中的章节/符号与复算依据。

### Claude

_（待批注）_

### Codex

_（待批注）_

### 其他

_（待批注）_

---

## 附：阅读指引

- **靶子**：§3（A vs B 的取舍，尤其 B 否决理由）、§4.4–4.5（Q1/Q2）、§6 待拍板、§10 质疑清单。
- **纪律**：数字与修法都要**复算**；对失败路径请「读代码推演」，不要只做文档自洽性检查。
- **行号**：以符号 / 引文为准。

---

## 实施记录（2026-10-15）

**验收范围**：两条 fork 入口（侧栏「…」派生、聊天内「从此处派生」）的会话即时出现在侧边栏「对话」列表。纯前端；无服务端改动。

**拍板结果**（§6）：

- **Q1 → b**：新增窄回调 `onSessionForked`，只发「新会话进对话列表」信号，不碰 `projects` / `selectedSession`。
- **Q2 → a**：侧栏 fork 由 `useSidebarController` 本地折入 feed（复用与信号 effect 共用的 `applyCreatedConversationRow`）。
- **Q3**：**不新增信号类型**，fork 复用既有 `createdConversation` 信号（`CreatedConversationSignal`），不重命名语义。
- **Q4**：解析不到所属 project 时**跳过 feed 插入、仍导航**。

**改动（9 源文件 + 1 测试文件）**：

| 文件 | 改动 |
|---|---|
| `src/modules/project-workspace/hooks/useProjectsState.ts` | 抽出 `buildCreatedConversationRow`；`registerOptimisticSession` 复用之；**新增 `registerForkedSession`**（只 `setCreatedConversation`，不 `setProjects`/`setSelectedSession`）；`RegisterOptimisticSessionArgs` → `RegisterSessionArgs`；随 return 带出 |
| `src/modules/project-workspace/context/ProjectsStateContext.tsx` | `ProjectMainState` pick / 值 / deps 加 `registerForkedSession` |
| `src/modules/project-workspace/ProjectMainRegion.tsx` | 新增 `handleSessionForked` → `registerForkedSession`，透传 `onSessionForked` |
| `src/modules/project-workspace/WorkspaceMain.tsx` | 新增 prop `onSessionForked`，透传给 `ChatInterface` |
| `src/modules/chat/ChatInterface.tsx` | 新增 prop `onSessionForked`；`handleForkFromMessage` 成功分支发信号（provider 取 `selectedSession.__provider`、project 取 `selectedProject`、summary 取 `sessionName`） |
| `src/modules/sidebar/utils/sidebarProjectFormatting.ts` | 新增纯函数 `foldConversationRow(conversations, row)`（置顶块后插入 + 去重） |
| `src/modules/sidebar/hooks/useSidebarController.ts` | 抽出 `applyCreatedConversationRow(row, conversations)`（ref 去重 + 已含早退 + `total+1`），effect 与 `forkSession` 共用；`forkSession` 成功后按会话 id 反查所属 project（回退 `__projectId`）并折入 feed |
| `src/modules/project-workspace/tests/workspaceTabKeepAlive.test.tsx` | 补 `onSessionForked` 必填 prop |
| `src/modules/sidebar/tests/recentConversationFork.test.ts` | **新增 3 测试**：即时出现 + total / 空名回退 id / 解析不到 project 不插行但仍导航 |
| `src/modules/project-workspace/tests/projectsStateAttention.test.ts` | **新增 1 测试**：`registerForkedSession` 只桥 feed、不动 `projects` |

**验证**：

- `npx tsc --noEmit -p tsconfig.json` 通过。
- `npx oxlint`（10 个改动文件）**0 error**；`ChatInterface` 的 `preserve-manual-memoization` warning 与该文件既有同类警告同族，非本次新增。
- 目标测试：`recentConversationFork`(3) / `recentConversationNewSession`(5) / `projectsStateAttention`(31) 全绿。
- 全量 `vitest run`：**8 文件 / 35 测试失败**，与改动前基线**逐一致**（用 `git stash push -- src server` 对照过：同 4 文件 / 16 例在仅跑 sidebar+project-workspace+chat 时完全一致）——均为既有环境相关失败，非本次引入。
  - 环境提示（沿用前置文档）：须在 **Node 20** 下跑（Node 26 的原生 WebStorage 与 jsdom 冲突）。本机以 `PATH="$HOME/.nvm/versions/node/v20.19.6/bin:$PATH"` 执行。

**真机验证未完成**：请刷新页面后（纯前端改动，无需重启守护进程）分别用①侧栏「…」→ 派生会话、②聊天内 AI 回复下方「从此处派生」，确认新会话**即时**出现在「对话」列表顶部（标题为 `… (fork)`）、无重复、`total` 正确；有置顶会话时 fork 行应在置顶块之后；点刷新不产生第二行。

**已知取舍（供后续评审复核）**：`forkSession` 的依赖新增了 `projects` / `recentConversations`，其引用会随 feed 变化；feed 变化不频繁，未做 ref 稳定化（见 §10 质疑 2/3）。
