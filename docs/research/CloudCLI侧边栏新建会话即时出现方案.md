# CloudCLI 侧边栏「对话」页签新建会话即时出现方案

- 文档日期：2026-10-10
- 适用仓库：`cloudcli`（React 前端 `src/` + Node 后端 `server/`）
- 状态：**已评审 → v2 修订**（尚未实施；见文末「评审回应与方案修订（v2）」）
- 目标读者：独立评审者 / 其他 AI（本文自足，无需会话上下文）
- ⚠️ **行号勘误**：本文写作期间工作区存在未提交改动（`useProjectsState.ts` / `types.ts` / `sessions.service.ts` 均已变动），文中所有行号已漂移。**实现前一律以符号/引文为准**。

---

## 0. 一句话结论

侧边栏「对话」页签的列表是**另一份分页数据**，新建会话的乐观写入**只补进了项目树**（`projects`），两份数据之间没有桥。把桥补上即可让新行即时出现。

推荐做法：在 **已有**的 `recentConversationsWithCurrentTitles` 派生逻辑里，除了折入标题变更，再**折入 `projects` 中"比已加载行都新"的会话**。纯前端、不重取、不重置分页。

---

## 1. 问题现象与复现

**现象**：在侧边栏「对话」页签下新建一个会话并发送首条消息后，新会话**不会自动出现**在对话列表里；必须点侧边栏上方的「刷新」按钮（或重进该页签）才会出现。

**对照**：同样操作下，**「项目」页签**（项目树）里新会话会**即时出现**。

**复现步骤**：

1. 打开侧边栏，切到「对话」页签（列表已加载若干历史会话）。
2. 通过该页签内的新建入口（点某项目行 / ＋）新建会话。
3. 在聊天区发送首条消息。
4. 观察「对话」列表 → **无新行**；点顶部刷新 → 新行出现在顶部。

> 注：「项目」/「对话」/「运行中」/「已归档」是侧栏顶部的四个页签；`modeConversations` 的中文即「对话」。用户描述的现象指向**「对话」页签**，而不是项目树。

---

## 2. 现状链路与证据（含 file:line）

### 2.1 项目树为什么即时出现（乐观写入）

新建会话时，前端有一条**乐观写入**链路：

1. 首条消息发送 → `POST /api/providers/sessions` 拿到 sessionId
   - `src/modules/chat/hooks/useChatComposerState.ts:853`
2. 成功后回调 `onSessionEstablished(targetSessionId, { provider, project, summary })`
   - `src/modules/chat/hooks/useChatComposerState.ts:892-896`
3. 回调被接到 `registerOptimisticSession`
   - `src/modules/project-workspace/ProjectMainRegion.tsx:45-48`
4. `registerOptimisticSession` 构造一个本地 `session_upserted` 事件并 `setProjects` upsert
   - `src/modules/project-workspace/hooks/useProjectsState.ts:615-678`（关键：`625-636` 构造 optimistic session，`657-671` upsert 进 `projects`）

所以项目树读的 `projects` 里当场就有那一行。

### 2.2 「对话」列表为什么不出现

「对话」列表是**另一份分页数据** `recentConversations`：

- state：`src/modules/sidebar/hooks/useSidebarController.ts:122`
- 拉取：`fetchRecentConversationsPage` → `api.recentConversations({ limit: 40, offset })`
  - `src/modules/sidebar/hooks/useSidebarController.ts:238-287`
- 服务端：`GET /api/providers/sessions/recent` → `listRecentSessions(limit, offset)`
  - `server/modules/providers/provider.routes.ts:1025-1033`
  - `server/modules/providers/services/sessions.service.ts:241-271`
  - SQL 排序：`ORDER BY isPinned DESC, julianday(COALESCE(updated_at, created_at)) DESC, session_id DESC`
    - `server/modules/database/repositories/sessions.db.ts:636-667`（**置顶优先，其后按活动时间倒序**）

它的重新拉取时机**只有**：

- 切到「对话」页签 / 改搜索词：`useSidebarController.ts:335-341`
- 点顶部刷新且当前在「对话」模式：`useSidebarController.ts:1244-1247`
- 置顶/删除/归档等动作之后（如 `useSidebarController.ts:1368`）

**关键事实**：

- `registerOptimisticSession` **只写 `projects`**，对 `recentConversations` 完全没碰（`useProjectsState.ts:615-678`）。
- WebSocket 的 `session_upserted`（含其他客户端/磁盘 watcher 推送）也**只更新 `projects`**（`useProjectsState.ts:838-860` + `861+` 的 `setProjects`），不往 feed 加行。
- 现有的 `recentConversationsWithCurrentTitles` memo **只用 `projects` 去改已存在行的标题，不加新行**
  - `src/modules/sidebar/hooks/useSidebarController.ts:350-376`（逐行 `recentConversations.map(...)`，无 insert）
- 服务端 `POST /api/providers/sessions` **创建时不广播**：只写 DB 就返回
  - `server/modules/providers/provider.routes.ts:1005-1015`

### 2.3 根因

会话确实已落库（刷新后 `/recent` 一定读得到）。但**在此之前，「对话」页签没有任何东西通知它去拉一次**，也没有东西往这份列表里插入新行。侧栏顶部刷新按钮恰好触发了那次拉取，所以表现为「点一下才出现」。

> 这是**设计缺口**，不是缓存/磁盘扫描延迟问题：`/api/providers/sessions/recent` 直读 DB，新建会话由 DB 落库，刷新必然能看到。

---

## 3. 方案对比

| 方案 | 做法 | 评价 |
|---|---|---|
| **A. 客户端折叠（推荐）** | 扩展现有 `recentConversationsWithCurrentTitles` memo：折标题 **+** 折入 `projects` 中"比已加载行都新"的会话 | **采用**。纯前端、不重取、不重置分页、与本 memo 既有职责同源 |
| B. 新建后重取首页 | 监听到 `projects` 新增会话就 `reloadRecentConversations()` | 否决：多一次网络往返；**会把已翻到第 2+ 页的行丢掉**（代码里 `useSidebarController.ts:1265-1268` 的注释明确在意这点）；可能闪 loading 态 |
| C. 服务端创建即广播 `session_upserted` | 改 `POST /api/providers/sessions` 加广播 | 否决（作为**本 fix**）：改动面触及协议层；而且项目树已由乐观写入覆盖，真正缺的是喂给侧栏列表——客户端折叠更小且更完整。可留作未来多端一致性增强项 |

**选 A 的核心理由**：这个 memo 的存在意义本来就是「把 `projects` 的变更**折进** feed，而不是重取」（见 `useSidebarController.ts:343-349` 的注释）。新建会话只是它尚未覆盖的第三种变更（前两种：标题变更 `350-376`、置顶重排 `1332-1334`）。

**为什么 A 能同时覆盖两条来源**：`projects` 的新行既来自本机乐观写入（`registerOptimisticSession`），也来自 `session_upserted` delta（`useProjectsState.ts:861`）。折叠一次，两条路径都吃到（其他客户端建会话也能反映）。

---

## 4. 选定方案（详细设计）

### 4.1 数据流

```
新建会话 → POST /providers/sessions → onSessionEstablished
        → registerOptimisticSession → setProjects(+新会话)   ← 项目树即时
                                              │
                        [新增] mergeRecentConversationsWithProjects
                                              ▼
                    recentConversationsWithCurrentTitles (派生)
                                              ▼
                        侧栏「对话」列表即时出现（无需刷新）
```

### 4.2 插入规则（精确）

设 `feed = recentConversations`（原始 state，不含折叠行）：

- 若 `feed` 为空 → 原样返回（页签没开过，打开时本就会重取）。
- 记 `newestLoadedMs = max(lastActivity of feed)`（**取 max 而非 `feed[0]`**，因为置顶行会打乱"首行即最新"的假设），并收集 `loadedIds`。
- 遍历 `projects[].sessions`，凡满足 **`id ∉ loadedIds` 且 `lastActivity > newestLoadedMs`** 的会话，作为候选。
- 候选按 `lastActivity` 倒序，插到**置顶块之后、未置顶块之前**（对齐服务端 `isPinned DESC` 优先的排序）。
- 无候选 → 原样返回（保持引用不变）。

### 4.3 候选行字段映射（对齐服务端 `/recent` 的派生规则）

| 字段 | 取值 | 服务端对应 |
|---|---|---|
| `sessionId` | `session.id` | `session_id` |
| `provider` | `getSessionProvider(session)`（`__provider ?? provider`，兜底 `'claude'`） | `session.provider` |
| `projectId` | `project.projectId` | join 出的 `project_id` |
| `projectDisplayName` | `project.displayName` | `resolveProjectDisplayName(...)` |
| `sessionTitle` | `(session.summary ?? '').trim() \|\| session.id` | `custom_name?.trim() \|\| session_id` |
| `lastActivity` | `session.lastActivity ?? session.createdAt ?? session.created_at ?? null` | `updated_at ?? created_at` |
| `isPinned` | `false`（新会话未置顶） | `Boolean(isPinned)` |

类型：`RecentConversationListItem` 见 `src/shared/types.ts:1860-1865`；`ProjectSession` 见 `src/shared/types.ts:82-100`。

---

## 5. 具体改动

### 5.1 新增纯函数 `src/modules/sidebar/utils/sidebarProjectFormatting.ts`

放在 `reorderRecentConversationsForPin`（同族列表变换，`295` 行附近）旁边。函数在**同文件**，可复用文件内私有的 `getSessionProvider`（`sidebarProjectFormatting.ts:45-50`）。

```ts
/**
 * 把工作区里"刚建出来的会话"折进 Conversations feed。
 *
 * feed 只在页签打开时从 /api/providers/sessions/recent 拉一次；新建会话会
 * 落进 `projects`（本机乐观 upsert，或其他客户端的 session_upserted delta），
 * 但永远进不了 feed。把这类会话插到未置顶块的顶部，无需手动刷新即可出现——
 * 与上方标题折叠同源：都是把 `projects` 折进 feed 而不是重新拉取。
 *
 * 只折入"比所有已加载行都新"的会话：某项目更早的会话会经
 * loadMoreProjectSessions 分页进来，那些是历史，不是新会话。
 * 无新增时原样返回入参（保持引用不变）。
 */
export const mergeRecentConversationsWithProjects = (
  conversations: RecentConversationListItem[],
  projects: Project[],
): RecentConversationListItem[] => {
  if (conversations.length === 0) {
    return conversations;
  }

  const loadedIds = new Set<string>();
  let newestLoadedMs = Number.NEGATIVE_INFINITY;
  for (const conversation of conversations) {
    loadedIds.add(conversation.sessionId);
    const ms = Date.parse(conversation.lastActivity ?? '');
    if (Number.isFinite(ms) && ms > newestLoadedMs) {
      newestLoadedMs = ms;
    }
  }

  const additions: RecentConversationListItem[] = [];
  for (const project of projects) {
    for (const session of project.sessions ?? []) {
      if (loadedIds.has(session.id)) {
        continue;
      }
      const lastActivity = session.lastActivity ?? session.createdAt ?? session.created_at ?? null;
      const ms = Date.parse(lastActivity ?? '');
      // 必须比每一行都新：否则就是分页进来的旧会话，不能当"新对话"顶上去。
      if (!Number.isFinite(ms) || ms <= newestLoadedMs) {
        continue;
      }
      loadedIds.add(session.id);
      additions.push({
        sessionId: session.id,
        provider: getSessionProvider(session),
        projectId: project.projectId,
        projectDisplayName: project.displayName,
        // 未命名会话保留 id 当标题，与服务端派生 sessionTitle 的规则一致。
        sessionTitle: (session.summary ?? '').trim() || session.id,
        lastActivity,
        isPinned: false,
      });
    }
  }

  if (additions.length === 0) {
    return conversations;
  }

  additions.sort((a, b) => Date.parse(b.lastActivity ?? '') - Date.parse(a.lastActivity ?? ''));

  // 置顶行保持在上，对齐 feed 自身的排序（见 reorderRecentConversationsForPin）。
  const pinned = conversations.filter((conversation) => conversation.isPinned);
  const unpinned = conversations.filter((conversation) => !conversation.isPinned);
  return [...pinned, ...additions, ...unpinned];
};
```

> 类型导入：`RecentConversationListItem`、`Project` 已在该文件导入（`sidebarProjectFormatting.ts:8` 附近）。

### 5.2 修改 memo `src/modules/sidebar/hooks/useSidebarController.ts:350-376`

保留原标题折叠逻辑，仅把输入由 `recentConversations` 换成 `merged`，并把"是否变化"初值改为 `merged !== recentConversations`：

```ts
const recentConversationsWithCurrentTitles = useMemo(() => {
  if (recentConversations.length === 0) {
    return recentConversations;
  }

  const merged = mergeRecentConversationsWithProjects(recentConversations, projects);

  // Trimmed, because that is how the server derives a row's `sessionTitle`.
  const summaryBySessionId = new Map<string, string>();
  for (const project of projects) {
    for (const session of project.sessions ?? []) {
      const summary = typeof session.summary === 'string' ? session.summary.trim() : '';
      if (summary) {
        summaryBySessionId.set(session.id, summary);
      }
    }
  }

  let changed = merged !== recentConversations; // 有新增行即视为已变化
  const next = merged.map((conversation) => {
    const summary = summaryBySessionId.get(conversation.sessionId);
    if (summary === undefined || summary === conversation.sessionTitle) {
      return conversation;
    }
    changed = true;
    return { ...conversation, sessionTitle: summary };
  });
  return changed ? next : recentConversations;
}, [projects, recentConversations]);
```

并在文件头把 `mergeRecentConversationsWithProjects` 加入 `@/modules/sidebar/utils/sidebarProjectFormatting` 的导入（`useSidebarController.ts:8-16`）。

**不改动**：返回对象里的 `recentConversations: recentConversationsWithCurrentTitles`（`useSidebarController.ts:1409`）；`recentConversationsTotal / hasMore / loadMoreRecentConversations` 的 **offset 继续基于原始 `recentConversations.length`**（折叠行不通知服务端，分页对齐服务端）。

---

## 6. 必须守住的不变量

1. **不重复**：折叠行不入 `recentConversations` state，靠 `loadedIds` 去重；真 feed 拉到后按 id 自然合流。
2. **不误插旧会话**：分页进来的旧会话 `lastActivity` 比 feed 顶部旧 ⇒ 被时间闸拦掉。
3. **置顶行不被压**：新会话插在置顶块之后、未置顶块之前。
4. **无变化时引用不变**：`recentConversationTitleSync.test.ts:114` 的 `=== rowsBefore` 断言继续成立。
5. **不触发额外请求**：仍是纯派生，`recentConversationsResponse` 调用次数不变。
6. **feed 为空不动**：页签没开过 ⇒ feed 空 ⇒ 直接返回。
7. **无渲染环**：memo 依赖 `[projects, recentConversations]` 的**引用**；插入是输入的函数，输入引用不变即不重算（同标题折叠）。

### 已知边界（需评审确认是否接受）

- **时间闸依赖"客户端写的 `lastActivity`" vs "服务端给的 feed 顶"**。本机部署（`cloudcli` 守护进程与前端同机，同钟）无偏差；若远端部署存在显著时钟偏移，极端情况下新行要等一次刷新才出现。此为**可接受的退化**，不影响正确性（不会插错行，只会晚一拍）。
- 若某会话 `lastActivity` 缺失/不可解析 → 跳过，等一次刷新再出现（与现状一致，不更差）。
- 折叠行若长期不被真 feed 覆盖（例如创建后一直不开/不刷「对话」页签），会一直由派生维持——但它确实存在于 DB，不会成为幽灵行。

---

## 7. 测试计划

### 7.1 新增 hook 测试 `src/modules/sidebar/tests/recentConversationNewSession.test.ts`

复用 `recentConversationTitleSync.test.ts` 的 `renderController / openConversationsTab` 骨架（该骨架 mock 了 `api.recentConversations` 并断言调用次数）。

| # | 用例 | 断言 |
|---|---|---|
| 1 | 新建会话无需刷新即出现在 feed 顶部 | feed 有 session-1/2（`lastActivity` `2026-09-22T09:30`）；rerender 时 projects 多出 session-3（`lastActivity` `2026-09-22T10:00`、summary `New chat`）⇒ `feed[0].sessionId === 'session-3'`，且标题/`provider`/`projectId`/`projectDisplayName` 正确；`recentConversationsResponse.mock.calls.length === 1` |
| 2 | 分页进来的旧会话不会被折入 | 加入 session-old（`lastActivity` `2026-09-01`）⇒ 不在列表里 |
| 3 | 已在 feed 的会话不产生重复行 | projects 里给 session-1 更新 `lastActivity`/标题 ⇒ 长度不变、无重复 id |
| 4 | 置顶行不被压 | feed 含一条 `isPinned: true` 的行时，新会话插在该置顶行**之后**（纯函数单测亦可） |

### 7.2 回归

- `recentConversationTitleSync.test.ts`（标题折叠 + 引用不变）
- `sidebarPinOptimistic.test.ts`（置顶重排）
- `recentConversationBackgroundWork.test.tsx`（后台态行）

---

## 8. 验证步骤

1. `npx tsc --noEmit`（或项目既有类型检查）+ 定向 `vitest` 跑 7.1/7.2 各文件。
2. **纯前端改动** ⇒ 不用重启 `com.selier.cloudcli` 守护进程；`npm run build:client` 后刷新页面即可。
3. 真机：切「对话」页签 → 新建会话 → 发首条消息 ⇒ **新行即时出现在顶部**；再点刷新 ⇒ 不产生重复行。

---

## 9. 影响面与回滚

- 改动文件：`src/modules/sidebar/utils/sidebarProjectFormatting.ts`（+1 纯函数）、`src/modules/sidebar/hooks/useSidebarController.ts`（memo 输入 + 变化判据）、`+1` 测试文件。
- 无服务端改动、无协议改动、无 i18n 新键、无新增依赖。
- 回滚：撤销 memo 改动即可退回现状（纯函数留着无害）。

---

## 10. 给评审者的质疑清单（请重点挑战这些点）

1. **时间闸判据是否成立**：用"最新会话 `lastActivity` > feed 所有已加载行的 `lastActivity` 最大值"来区分"新建"与"分页旧会话"，是否存在反例？特别是：置顶会把老会话排到首行（故取 max 而非 `feed[0]`）——这个处理是否正确且充分？
2. **时钟偏移退化**是否可接受？本机同钟的假设是否可靠（守护进程与浏览器在同一台机器）？
3. **不重复的完备性**：折叠行只存在于派生结果、不进 state，是否真的在所有路径（重取、切页签、置顶、删除、翻页）下都不产生重复或错序？`recentConversationsTotal/hasMore/offset` 不回退是否引入不一致？
4. **置顶排序**：插入到"置顶块之后"是否正确？新会话是否可能被用户立刻置顶而与派生逻辑打架？
5. **是否应选方案 C（服务端创建即广播）**：若考虑多端一致性（另一台机器/另一个浏览器打开同一后端），A 的"只对本机算新"是否是可接受的范围收敛？是否存在更小改动的桥接点被我漏掉？
6. **memo 引用稳定性**：`merged !== recentConversations` 作为 changed 初值，是否会破坏既有的"无变化时引用不变"契约（尤其当只有折叠行、没有标题变更时）？
7. **是否有更简单的既有机制**可直接复用（例如某处已订阅 `session_upserted` 的组件、或 `sidebarSharedProps` 里可挂载的现成信号），使改动比"折入 memo"更小？

---

## 附录 A：关键证据片段

### A.1 现有 memo（待修改，`useSidebarController.ts:350-376`）

```ts
const recentConversationsWithCurrentTitles = useMemo(() => {
  if (recentConversations.length === 0) {
    return recentConversations;
  }
  // Trimmed, because that is how the server derives a row's `sessionTitle`.
  const summaryBySessionId = new Map<string, string>();
  for (const project of projects) {
    for (const session of project.sessions ?? []) {
      const summary = typeof session.summary === 'string' ? session.summary.trim() : '';
      if (summary) {
        summaryBySessionId.set(session.id, summary);
      }
    }
  }
  let changed = false;
  const next = recentConversations.map((conversation) => {
    const summary = summaryBySessionId.get(conversation.sessionId);
    if (summary === undefined || summary === conversation.sessionTitle) {
      return conversation;
    }
    changed = true;
    return { ...conversation, sessionTitle: summary };
  });
  return changed ? next : recentConversations;
}, [projects, recentConversations]);
```

### A.2 乐观写入（`useProjectsState.ts:615-678` 摘要）

```ts
const registerOptimisticSession = useCallback(({ sessionId: newSessionId, provider, project, summary }) => {
  if (!newSessionId || !project?.projectId) return;
  const now = new Date().toISOString();
  const optimisticSession: ProjectSession = {
    id: newSessionId, summary: summary ?? '', messageCount: 0,
    createdAt: now, created_at: now, updated_at: now, lastActivity: now,
    __provider: provider, __projectId: project.projectId,
  };
  const upsert: SessionUpsertedEvent = { kind: 'session_upserted', sessionId: newSessionId, provider, session: optimisticSession, project: {...}, timestamp: now };
  setProjects((previousProjects) => { /* upsert 进对应项目 */ });
  setSelectedSession(/* ... */);
}, []);
```

### A.3 服务端创建不广播（`provider.routes.ts:1005-1015`）

```ts
router.post('/sessions', asyncHandler(async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const provider = parseProvider(body.provider);
  const projectPath = typeof body.projectPath === 'string' ? body.projectPath : '';
  const initialMessage = typeof body.initialMessage === 'string' ? body.initialMessage : '';
  const result = sessionsService.createAppSession(provider, projectPath, initialMessage);
  res.status(201).json(createApiSuccessResponse(result)); // 无广播
}));
```

### A.4 feed 服务端排序（`sessions.db.ts:642-653`）

```sql
SELECT sessions.* FROM sessions
LEFT JOIN projects ON projects.project_path = sessions.project_path
WHERE sessions.isArchived = 0 AND (projects.isArchived IS NULL OR projects.isArchived = 0)
ORDER BY sessions.isPinned DESC,
         julianday(COALESCE(sessions.updated_at, sessions.created_at)) DESC,
         sessions.session_id DESC
LIMIT ? OFFSET ?
```

---

## 审阅批注

### Claude

> [!INFO] **建议先补的核验项（行号勘误）**
> 文档反复引用的 `RecentConversationListItem` 实际定义在 `src/shared/types.ts:1889-1894`，不是第四节写的 `1860-1865`（`1860-1865` 是 `ProjectSortOrder` / `SidebarSearchMode`）。不影响实现，但真动手前请以 `1889` 为准，避免类型字段对不上。

> [!TIP] **折叠无条件执行在"搜索态"是安全的，但方案没点明这一前提（建议写进文档）**
> 我核对过消费侧：`src/modules/sidebar/SidebarContent.tsx:1253-1260` 只在**非搜索态**渲染 `recentConversations`（即折叠后的派生）；而搜索命中态（`searchMode==='conversations' && query≥2`，`SidebarContent.tsx:899`）渲染的是**另一份** `conversationResults`（`SidebarContent.tsx:905-912, 1114`），与 `recentConversations` 完全隔离。所以么 memo 里无条件折叠不会把新会话塞进搜索结果。但这份安全性**隐含在渲染分支**里，方案正文没有一句话论证它——建议在 4.2"插入规则"前补一句前提，否则未来有人改渲染分支时这层守护会静默失效。

> [!WARNING] **命名偏差：闸捕获的是"最新活动的会话"，不只是"新建会话"——语义与测试都要跟上**
> `4.2` 的候选条件（`id ∉ loadedIds && lastActivity > newestLoadedMs`）会对**所有** `projects` 里"掉出前 40 页、随后被重新激活（`updated_at` 被 bump）"的旧会话也成立，不只是新创建的。这在行为上其实与 server 按活动时间排序一致，是**期望**的，但全文都把它表述成"新会话 / 新建即时出现"，会误导评审以为只覆盖新创建。建议：在 `merge` 的注释里明确"新 = 活动时间比 feed 所有已加载行都新的会话（含新建与被重新激活）"，并把测试 #5（见下）纳入。

> [!CAUTION] **折叠行 `isPinned` 硬编码 `false`，会与 projects 里已置顶且掉页的旧会话冲突**
> `5.1` 新行一律 `isPinned: false`。但"被重新激活的旧会话"完全可能是用户**已置顶**的（置顶后活动又多、排到前 40 页之外——置顶恰好让它排在 feed 首部，反而更易出现在 loadedIds 里？不一定，置顶与时间排序是两列）。一旦这类置顶旧会话以折叠候选身份进来，会被硬塞进"未置顶块"，而 server 会把它排进"置顶块"，**直到下次刷新才纠正**，形成短暂错位。修法很小：候选行 `isPinned: Boolean(session.isPinned)` 即可，与 server `Boolean(isPinned)` 对齐。测试 #4 只覆盖了"新建未置顶插在置顶行后"，请补一条"project 里已置顶的会话被折叠时仍待在置顶块"。

> [!WARNING] **时间闸的退化极端：当 feed 全部行的 `lastActivity` 都不可解析时，`newestLoadedMs` 为 `-Infinity`，会把整个 `projects` 全量折进渲染**
> `5.1` 里 `newestLoadedMs` 只由 feed 中 `Date.parse` 成功行贡献（不可解析行被跳过）。若因极端残留（某批行的 `updated_at`/`created_at` 均为 NULL）出现"feed 所有行都不可遍历"，则 `newestLoadedMs` 保持 `Number.NEGATIVE_INFINITY`，此时**所有** project 会话（含大量分页历史）都能通过 `ms > newestLoadedMs`，一次性全量折入，直到 feed 重取才消失。已知边界一节只提了"单条缺失→跳过"的正常情形，没覆盖这个整体退化。建议要么在文档 6 已知边界里显式声明这个触发前提，要么给闸加一道兜底（例如同时要求 `Date.parse(lastActivity) > now - 某窗口`）。

> [!TIP] **`merge` 是纯函数，测试不要再全押在 hook 骨架上——直接对 `mergeRecentConversationsWithProjects` 参数化单测更精准**
> `7.1` 的 4 个用例都走 `renderController` 骨架，较绕。既然 `5.1` 让函数可独立导入，建议直接加对纯函数的参数化用例，覆盖 hook 框架难精确达的边界：feed 为空、feed 全部行 lastActivity 不可解析、置顶/未置顶混排、`lastActivity` 与 `newestLoadedMs` 恰相等的临界毫秒、跨项目多候选的排序确定性与 `isPinned` 透传。测试 #4 已提到"纯函数单测亦可"，把 #1-3 的等价场景也补到纯函数层。

> [!NOTE] **已核对的非问题项（不必改动），供牵头汇总参考**
> - **不重复完备性**：核对了 `useSidebarController.ts:262-272` 的 append 去重（按 `existingIds`），折叠行不进 state、不在 `previous` 里，`loadMore` 追加真实 page-1 不会与折叠行撞 id；刷新重取 page-0 后折叠行进入 state 的 `loadedIds`，折叠自动收敛，无重复。`4.2/6-1` 成立。
> - **offset/hasMore 不回退即不变量 #3/#5**：核对了 `loadMoreRecentConversations` 的 offset 取 `recentConversations.length`（state 长度，`useSidebarController.ts:297`），折叠行悬浮在派生层、不摊进 state，分页对齐服务端；真实行被新行挤后的视觉上移是预期的"多显示新行"。成立。
> - **memo 引用稳定契约**：当无新增时 `merge` 原样返回入参引用（`merged === recentConversations`），`changed` 从 false 起，标题无变则整体返回原引用，`recentConversationTitleSync.test.ts:114` 的 `=== rowsBefore` 契约不受影响。`5.2` 的第 `//` 注释判据改法正确，也回应了 `10-质疑清单 #6`。
> - **标题源一致性**：候选行 `sessionTitle` 取 `session.summary`（与服务端 `custom_name` 略有出入），但这与既有标题折叠 memo（`useSidebarController.ts:350-376`）同源，非新增风险；未命名会话回退 `session.id` 也与 `sessions.service.ts:260` 的 fallback 一致。

### Codex

> [!CAUTION] **空 feed 场景会直接漏掉首条新会话，当前设计并未满足“即时出现”**
> `5.1`/`5.2` 都以 `recentConversations.length === 0` 为提前返回条件，但“列表为空”不等于“页签从未加载”：`fetchRecentConversationsPage(0, false)` 完全可能成功返回空数组（`useSidebarController.ts:253-273`），此时用户从空状态新建首条会话，`projects` 已出现新行，memo 仍直接返回空 feed，`SidebarRecentConversations.tsx:733-745` 会继续显示“No conversations yet”。这不是文档 4.2 所说的“页签没开过，打开时本就会重取”，而是一个可直接复现的产品缺口。若继续采用折叠法，不能仅靠移除 early return：空 feed 下没有可用的时间边界，单纯遍历 `projects` 又可能把历史会话全部倒出。更稳妥的是让 `registerOptimisticSession` / `session_upserted` 产生一份明确的“新插入 sessionId”信号，折叠只消费该信号；这样空列表、首条会话和时间异常都不需要启发式判断。

> [!CAUTION] **“比 feed 最大时间更新”不能可靠区分新会话与分页旧会话，置顶分页存在明确反例**
> 服务端顺序是 `isPinned DESC` 后再按活动时间倒序。若第一页 40 行全是置顶会话，其中最新置顶时间为 10:00，而一个未置顶会话在 9:45 被重新激活，它按服务端规则应进入未置顶块顶部，却会因 `9:45 <= newestLoadedMs(10:00)` 被折叠函数永久漏掉。反过来，文档把该函数描述成“新会话”合并，但判据实际捕获的是“时间比当前已加载全局最大值更新的一切未加载会话”，还包括被重新激活的旧会话。仅改成按置顶/未置顶分别取最大值，也只能缓解分块问题，无法解决“已加载页不包含目标块”时缺少边界的问题。建议优先使用显式插入来源，而不是用时间戳推断是否新会话。

> [!WARNING] **方案宣称同时覆盖 WebSocket 新增，但 `session_upserted` 并未携带足够字段对齐 `/recent`**
> 文档 3 节称折叠可同时吃到本机 `registerOptimisticSession` 和 `session_upserted`。但服务端事件的 `session` 只写入 `id/summary/messageCount/lastActivity`（`session-upsert-broadcast.service.ts:47-52`），没有 `isPinned`、`created_at` 或 `updated_at`；现有 upsert 对已加载行会保留旧字段，对首次插入行则没有这些字段（`useProjectsState.ts:275-318`）。因此 4.3 试图“对齐服务端 `/recent` 派生规则”的说法只对本机 optimistic 行较完整，对远端首次出现的会话并不成立。至少应把字段能力写入范围假设；若要承诺多端即时，应补齐事件字段或让该事件直接携带一条可渲染的 `RecentConversationListItem`。

> [!WARNING] **`recentConversationsTotal` 不同步会产生可见的计数错误**
> 方案明确不改 `recentConversationsTotal`，但 `SidebarRecentConversations.tsx:750-755` 会把该值直接显示在列表标题旁；现有删除/归档逻辑也会主动维护它。新建会话后服务端总数已增加，派生层却多显示一行而总数仍为旧值，形成“列表有 N+1 行、标题仍显示 N”的不一致。若使用显式“新插入 sessionId”集合，可只对确属新增的行递增展示总数；若折叠还覆盖旧会话重新激活，则不能一律 `total + additions.length`。测试计划应加入“首条空列表会话”和“新增后 total 同步”两条。

> [!TIP] **建议把方案范围从“时间启发式合并”收窄为“显式新会话投影”**
> 当前问题的最小闭环是：`POST /sessions` 成功后已知 `targetSessionId`、provider、project、summary，并且本地 WebSocket upsert 也知道 `sessionId`。把这些新 ID 投影成 sidebar row，比扫描所有 `projects[].sessions` 再靠时间筛更小、更确定，也能自然覆盖空 feed、置顶、远端事件字段不足和 total 维护。若牵头评估仍选方案 A，请在实施前至少增加测试：feed 成功加载为空后新建、feed 第一页全为置顶、时间恰好相等、全部时间不可解析、远端事件缺 `isPinned`、新增后计数与刷新后一致。

> [!NOTE] **已核对的成立项**
> 折叠行不进入 `recentConversations` state，`loadMoreRecentConversations` 仍按原始 state 长度取 offset（`useSidebarController.ts:293-303`），因此不会直接造成服务端分页 offset 漂移；append 也有按 `sessionId` 去重（`useSidebarController.ts:262-271`）。这两点可以保留，但不足以覆盖上面的空列表、候选识别和总数一致性风险。

**二审补充**

> [!CAUTION] **严格 `ms > newestLoadedMs` 会撞上 SQLite 秒级时间精度，折叠行可能先出现后消失**
> `sessionsDb.createAppSession` 用 `CURRENT_TIMESTAMP` 写 `created_at/updated_at`（`sessions.db.ts:220-229`），规范化后通常只精确到秒；本机 optimistic 行则用浏览器 `Date.toISOString()`，精确到毫秒。场景是：optimistic 行先以 `10:00:00.123Z` 折入，随后 `onRefresh` 或 `session_upserted` 用 DB 的 `10:00:00.000Z` 覆盖项目数据；若 feed 中已有同秒的最新行，`5.1` 的 `ms <= newestLoadedMs` 会把该会话剔除，而真实 `/recent` state 尚未重取，表现为新行闪现后消失。即使把比较改成 `>=`，同秒多会话仍需按服务端的 `lastActivity DESC, sessionId DESC` 决定位置。这里不能只调比较符，应使用显式新会话 ID，或完整复刻服务端排序键并定义同秒合并规则。

> [!WARNING] **折叠行上的“立即置顶”没有走通现有 optimistic 链路**
> `updateSessionPinned` 会同时写 `optimisticPinBySessionId`、尝试 `reorderRecentConversationsForPin(recentConversations, ...)`，成功后再重取（`useSidebarController.ts:1319-1350`）。但折叠行不在 `recentConversations` state，`reorderRecentConversationsForPin` 会原样返回；同时 5.2 的 merge 使用原始 `projects`，而 optimistic pin 只投影在 `projectsWithResolvedPinState`（`useSidebarController.ts:760-763`）。结果是点击折叠行的置顶按钮后，项目树可以立即变化，对话行却要等 `reloadRecentConversations` 才移动/显示 Pin，破坏现有即时预览语义。若保留派生行，merge 至少要读取 resolved pin state，且置顶重排必须能作用于派生结果；更简单的是让显式新会话进入可被现有 reducer/state 操作的同一列表。

> [!WARNING] **二审更正：offset 虽不会因去重而漏行，但并未与服务端分页位置对齐**
> 我前一条 NOTE 的表述过强。新会话已经落库，因此服务端分页会把它计入索引；但 `loadMoreRecentConversations` 仍传 `recentConversations.length`，未计派生折叠行。首屏 40 行后新增 1 行，再加载下一页时客户端 offset=40，而服务端的下一页应从 51 个“已显示会话”之后开始（逻辑上 offset=41），会重复请求上一页末行。现有按 `sessionId` 去重能避免重复展示，所以通常不会直接漏行，但这不是文档 5.2 所称的“分页对齐服务端”；若候选还包含重新激活的旧会话，重叠/边界会更难推理。应把“服务端可见的派生新增数”纳入 offset，或把这些行真正合并进分页状态，并补一条“新增 1/2 行后连续 loadMore 不重不漏”的测试。

> [!TIP] **同毫秒/同秒候选还缺少服务端的 `session_id DESC` 决胜键**
> 5.1 的 `additions.sort` 只比较 `lastActivity`。服务端在时间相同时用 `session_id DESC`（`sessions.db.ts:642-653`）；两个同秒新会话可能在折叠态与刷新后交换位置。若暂不改成显式投影，至少应按 `(lastActivity, sessionId)` 复刻服务端排序，并测试同时间戳、不同 sessionId 的稳定顺序。该问题低于空 feed 和时间闸问题，但会影响“刷新后不跳行”的体验。

---

## 评审回应与方案修订（v2）

> 本节在 v1（上文）被 Claude / Codex 审阅后追加。v2 **取代** v1 的 §3/§4/§5/§7（方案与改动），保留 §1/§2（现象与根因）、§6 的部分不变量、§8/§9、附录 A。

### A. 逐条裁定（含独立复算）

| 来源 | 批注 | 裁定 | 复算结果 |
|---|---|---|---|
| Claude | 行号勘误（类型定义位置） | **部分接受** | 结论对（v1 引用的 `1860-1865` 已失效），但**勘误本身也不准**：实测 `RecentConversationListItem` 现在 `src/shared/types.ts:1903-1908`，非批注的 `1889-1894`。根因是**行号漂移**（见文首勘误），不是单纯记错 |
| Claude | 折叠在"搜索态"安全，但未写明前提 | **接受** | 已核：`SidebarContent.tsx` 的搜索命中分支（`showConversationSearch`，`searchFilter≥2`）渲染 `conversationResults`，而 `recentConversations`（派生列表）只在**非搜索**分支渲染（`SidebarContent.tsx` 的 `searchMode === 'conversations'` 分支）。两者隔离。v2 把该前提写入正文 |
| Claude | 语义偏差：闸捕获"最近活动"而非"新建" | **接受（v2 结构性消除）** | 成立。v1 的 `id ∉ loadedIds && lastActivity > max` 会命中"被重新激活的旧会话"。v2 用显式新建信号，语义精确 |
| Claude | `isPinned` 硬编码 `false` 与置顶旧会话冲突 | **接受（v2 基本不再适用）** | v1 成立；v2 只投影本地新建（新会话必未置顶），但投影行仍读 `Boolean(session.isPinned)` 以防御 |
| Claude | feed 全行时间不可解析 ⇒ `newestLoadedMs=-Infinity` 全量折入 | **接受（v2 不再适用）** | v1 成立；v2 无时间闸，问题消失 |
| Claude | `merge` 是纯函数，应加纯函数单测 | **接受** | v2 采纳（见 C 节） |
| Claude | 四项"已核对非问题" | **认同** | 与我的复算一致：append 去重、offset 不漂移、无变化时引用稳定、标题与既有折叠同源 |
| Codex | **空 feed 会漏掉首条新会话** | **接受（关键）** | 成立：`fetchRecentConversationsPage(0,false)` 可**成功返回空数组**，此时 `SidebarRecentConversations` 走空状态分支（"No conversations yet"）。v1 的 `recentConversations.length === 0` 早退会让"从空列表新建首条"不出现。**v1 用启发式无法干净修复**（空 feed 下没有时间边界，扫描 `projects` 又会倒出历史）。v2 显式信号天然覆盖 |
| Codex | 时间闸不能区分新建与分页旧会话（置顶反例） | **接受** | 成立：服务端 `isPinned DESC` 在前；若首页 40 行全置顶（最新置顶 10:00），一个未置顶且在 9:45 被重新激活的会话按规则应进未置顶块顶部，却因 `9:45 ≤ 10:00` 被漏。**全局 max 不变式本身不成立**。v2 消除 |
| Codex | 声称覆盖 WebSocket 新增，但事件字段不足 | **接受** | 已核 `session-upsert-broadcast.service.ts`：`session` 仅 `id/summary/messageCount/lastActivity`，无 `isPinned/created_at/updated_at`；且该事件对**已存在**会话也会发（磁盘 watcher 共用同一 builder），语义是 upsert 不是 insert。v2 **撤回**"覆盖多端/WebSocket 即时"的声明，范围收敛为"本地新建" |
| Codex | `recentConversationsTotal` 不同步 ⇒ 可见计数错 | **接受** | 已核：`SidebarContent.tsx` 把 `recentConversationsTotal` 传给列表，`SidebarRecentConversations.tsx` 直接把 `{total}` 显示在标题旁。v2 用 `total + 投影中未确认条数` 修正 |
| Codex | 建议收窄为"显式新会话投影" | **采纳** | 即 v2 方案 |
| Codex | 两项"已核对成立项" | **认同** | 与复算一致 |

**收敛结论**：三种独立视角（Claude / Codex / 我）都指向同一个判断——**v1 的时间启发性是薄弱环节**。v2 改为**显式信号 + 乐观 overlay + 单向对账**，与代码库既有的 `optimisticStarByProjectId` / `optimisticPinBySessionId`（在 `useSidebarController` 中同构存在）保持同一范式。

### B. v2 设计（取代 v1 §4/§5）

**数据流**

```
本地新建会话
  → registerOptimisticSession（此刻已知完整行数据：id/provider/project/summary/now）
  → 新增 side-channel：createdConversation = { row: RecentConversationListItem, nonce }
  → sidebarSharedProps → <Sidebar> → useSidebarController
  → pendingConversations overlay（按 id 去重后前插）
  → [对账] 一旦真实 feed 包含该 id，即从 overlay 单向移除
  → 派生列表 = prependPendingConversations(feed, pending) 再走既有标题折叠
  → 展示 total = recentConversationsTotal + pending.length
```

**关键取舍**

1. **只覆盖"本地新建"**（用户报告的那条路径）。远端 `session_upserted` 字段不足、语义为 upsert，**明确不在范围内**（多端即时若要，另立项，或补事件字段）。
2. **不重取、不重置分页、无时间闸** ⇒ 空 feed、置顶边界、`-Infinity`、`isPinned`、total 五类问题**一次性消除**。
3. overlay 与 `optimisticPin` 同构：**单向**在 feed 确认后丢弃，杜绝"掉出首页后被反复顶回"的隐患。
4. **搜索态隔离**（Claude 批注）：派生列表仅用于非搜索分支渲染，overlay 行不会混入搜索结果。写入正文。

**改动点（符号级，行号以实际为准）**

1. `src/modules/project-workspace/hooks/useProjectsState.ts`
   - 新增 state `createdConversation: { row: RecentConversationListItem; nonce: number } | null`。
   - 在 `registerOptimisticSession` 内（upsert `projects` 之后）`setCreatedConversation`，`row` 取 `{ sessionId, provider, projectId, projectDisplayName, sessionTitle: (summary ?? '').trim() || sessionId, lastActivity: now, isPinned: false }`，`nonce = previous.nonce + 1`。
   - 把 `createdConversation` 加进 `sidebarSharedProps` 的 memo 与依赖数组。
2. `src/modules/sidebar/Sidebar.tsx`
   - props 类型加 `createdConversation`；透传进 `useSidebarController({ ... })`。
3. `src/modules/sidebar/hooks/useSidebarController.ts`
   - 入参加 `createdConversation`；新增 `pendingConversations` state。
   - effect①（投影）：`createdConversation` 变化时按 id 去重前插。
   - effect②（对账）：`recentConversations` 变化时，移除已出现在 feed 的 pending 行（镜像 `optimisticPin` 的对账）。
   - 派生 memo：`merged = prependPendingConversations(recentConversations, pendingConversations)`，之后照旧标题折叠；`merged.length === 0` 早退。
   - 返回 total 改为 `recentConversationsTotal + pendingConversations.length`。
4. `src/modules/sidebar/utils/sidebarProjectFormatting.ts`
   - 新增纯函数 `prependPendingConversations(feed, pending)`：去重、按 `lastActivity` 倒序、**置顶块优先**（与 `reorderRecentConversationsForPin` 对齐）。
5. 类型：`createdConversation` payload 类型（放 `src/shared/types.ts` 或就近定义）。

**并发假设（写入注释）**：信号是"最新一条 + `nonce`"，依赖创建动作由用户串行触发。极端并发下可能丢一条信号 ⇒ 退化为"该条等下一次 feed 拉取才出现"，**不影响正确性**。

### C. v2 测试

纯函数（`prependPendingConversations`）：
- pending 为空 ⇒ 原样返回（引用不变）
- pending 与 feed 有重复 id ⇒ 不重复
- 多条 pending ⇒ 按 `lastActivity` 倒序
- feed 含置顶行 ⇒ pending 置于**置顶块之后**

hook（`useSidebarController`，复用 `recentConversationTitleSync.test.ts` 骨架）：
- **空 feed + 投影一条 ⇒ 列表出现该行**（Codex 空列表场景）
- feed 已加载 + 投影 ⇒ 出现在顶部
- feed 随后含该 id ⇒ overlay 移除、不重复
- `total = 原始 total + pending 条数`
- 无投影信号 ⇒ 既有行为不变

回归：`recentConversationTitleSync.test.ts`、`sidebarPinOptimistic.test.ts`、`recentConversationBackgroundWork.test.tsx`。

### D. v1 中 v2 仍然有效的部分

- §1 现象/复现、§2 链路与根因（**行号需按符号重定位**）
- §6 不变量 4/5/6/7（引用稳定、不额外请求、搜索态隔离、无渲染环）
- §8 验证步骤（纯前端、无需重启守护进程）、§9 影响面（改动清单按 B 节更新）、附录 A 证据
