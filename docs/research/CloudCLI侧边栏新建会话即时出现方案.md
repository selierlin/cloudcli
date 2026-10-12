# CloudCLI 侧边栏「对话」页签新建会话即时出现方案

- 文档日期：2026-10-10
- 适用仓库：`cloudcli`（React 前端 `src/` + Node 后端 `server/`）
- 状态：**已实施（方案 D / 验收范围①：本机新建即时）**——2026-10-10，见文末「实施记录」
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

#### 二审补充

> [!CAUTION] **折叠行无法被既有的乐观置顶机制即时响应——方案 A 引入的新缺口，且当前方案只字未提**
> 折叠行只存在于**派生层**，不在 `recentConversations` **state** 里。而乐观置顶链路 `updateSessionPinned`（`useSidebarController.ts:1319-1374`）是两路：
> - `setOptimisticPinBySessionId`（`1327-1331`）→ 项目树侧应用；
> - `setRecentConversations((prev) => reorderRecentConversationsForPin(prev, ...))`（`1332-1334`）→ 作用在 **state** 上。
>
> 对折叠行点置顶：`reorderRecentConversationsForPin` 在 `sidebarProjectFormatting.ts:284-286` 因找不到该行（`!conversations.some(...)`）**直接原样返回**；而 `mergeRecentConversationsWithProjects` 构造行时 `isPinned` 硬编码 `false`、也不读 `optimisticPinBySessionId`。结果：折叠行置顶的即时预览**完全不生效**（点了没反馈，既不重排也不变色），只有等 `updateSessionPinned` 成功路径里的 `reloadRecentConversations()`（`1350`）重取 feed、该行以置顶身份进入 loadedIds 后才纠正。最终一致（reload 兜底），但乐观预览静默失效。
> **建议**：方案 4/5 需显式处理这一交互——要么在 `reorderRecentConversationsForPin` 调用处对"折叠行 + 派生结果"重排（把输入换成派生 `recentConversationsWithCurrentTitles`），要么 `merge` 构造行时读入 `optimisticPinBySessionId`。至少要在"已知边界"里声明这个退化。

> [!WARNING] **一审对 `isPinned` 的透传建议与方案的折叠分区存在耦合，二选一才能自洽**
> 我上一轮建议折叠行 `isPinned: Boolean(session.isPinned)`（对齐 server）。但这与 `4.3` 的 append 分区 `[pinned, additions, unpinned]` 冲突：一旦透传，`additions` 里的置顶折叠行会被塞进**未置顶块**，恰恰破坏置顶语义。所以两条路只能二选一：
> - **维持硬编码 `isPinned:false`**（方案现状）→ 接受上述 CAUTION 的"已置顶折叠行错位/乐观置顶失效"，直到 reload；
> - **透传 + 同步把 `additions` 按 `isPinned` 分区后再拼**（`[...pinned, ...pinnedAdditions, ...unpinnedAdditions, ...unpinned]`）。
> 请牵头明确选定其一，别同时采纳两套建议。

> [!NOTE] **折叠时机其实早于"发首条消息"——文档的因果表述可更精确**
> `registerOptimisticSession` 挂在 `onSessionEstablished`（`ProjectMainRegion.tsx:45-48`），即 `POST /api/providers/sessions` **创建成功就触发**，早于"发送首条消息"。`useProjectsState.ts:615-636` 构造的乐观行 `lastActivity: new Date().toISOString()` 在创建瞬间就比 feed 最新新。所以方案 A 生效在创建即折入，不依赖首条消息。第 1 节复现步骤 3-4 与第 4 节数据流把现象表述成"发首条消息后才出现"，因果略偏——建议改为"新建即应即时出现"，避免误导评审以为折叠依赖"首个 message"。

> [!TIP] **性能：memo 现为标题折叠 + merge 两遍全遍历 `projects × sessions`**
> `5.2` 的 memo 在 `projects` 每次引用变化时，先跑 `mergeRecentConversationsWithProjects` 一遍 O(P×S)，再跑既有的标题折叠一遍 O(P×S)。而 `projects` 引用变化极频繁（乐观 pin `applyOptimisticSessionPinState`、summary 更新、ws `session_upserted` 都重建数组）。中小项目无所谓，大项目（几十 projects × 数百 sessions）每次无关输入变化都双倍全遍历。可接受，但若在意，`merge` 内部已收集了每个候选的 `summary`，可与标题折叠合并成单遍——前提是别破坏"无变化时引用不变"和 `loadedIds` 去重两条契约。低优先级，不改也可。

#### 三审补充

> [!IMPORTANT] **方案的健壮性依赖一个文档没写明的服务端前提：活跃项目 `sessions` 的归档过滤由 `AND isArchived = 0` 保证，且 `ProjectSession` 无 `isArchived` 字段供客户端兜底**
> 我核验了"折叠行被**归档/删除**后会不会幽灵残留"：
> - 活跃项目 `project.sessions` 来自 `getSessionsByProjectPathPage`（`sessions.db.ts:720`），SQL 带 `AND isArchived = 0`（`728`），**不含归档会话**；归档/删折叠行后 `projects` 重取即清除该项目该行，`merge` 不再折回 → 无残留。**这条是 OK 的。**
> - 但同在 `sessions.db.ts` 的 `getSessionsByProjectPathIncludingArchived`（`706`，供归档项目取值）可返回含归档会话的集合。而客户端 `ProjectSession`（`types.ts:82-100`）**没有 `isArchived` 字段**（`mapSessionRowToSummary` 也未输出，`projects-with-sessions-fetch.service.ts:122-131`）——即 `mergeRecentConversationsWithProjects` **无法在客户端按归档状态过滤**。一旦未来有某条路径误让活跃项目携带归档会话（例如误复用 includingArchived、或项目归档/恢复的中间态把归档会话混进来），`merge` 会把这些**已归档会话当"新会话"折回对话列表**（`id∉loadedIds && lastActivity>newest` 对它们恰好成立）。
> **建议**：在方案 4/6 里把"活跃项目 sessions 已由服务端保证 `isArchived=0`"写成明确前提（必要时在 `merge` 加一条注释注明此依赖），防止后续改动破坏该保证时静默回灌归档会话。

> [!NOTE] **契约措辞修正：折叠行存在期间，6-4"无变化时引用不变"不再成立**
> `5.2` 把 changed 初值设为 `merged !== recentConversations`。一旦有折叠行，`merged` 就是新引用 → changed 恒 true → 每次 `projects` 引用变化（乐观 pin 别的会话、summary 更新、ws 推送，`applyOptimisticSessionPinState`/`useProjectsState.ts` 都会重建数组）都会让 memo 重建列表数组并 re-render `conversations`。**行为上是合理的**（折叠行就是相对 feed 的附加内容，应 re-render），但文档 6-4 与 `recentConversationTitleSync.test.ts:114` 的"引用不变"承诺只在**无新增行**时成立。建议把 6-4 措辞收窄为"无新增行且无标题变化时引用不变"，以免实现者误以为常规输入变化会稳定引用。

> [!NOTE] **时间闸前提要的是"同一时区解释"，不止"同机同钟"**
> `5.1` 用 `Date.parse(lastActivity)`（ISO 若带 `Z` 按 UTC 解析）计算毫秒；而 `recent` feed 的 `lastActivity` 来自 DB `updated_at ?? created_at`（`sessions.service.ts:261`），服务端排序用 `julianday(COALESCE(updated_at, created_at))`（`sessions.db.ts:643`，按 UTC 解释）。若 DB 里时间是无时区后缀的本地串，`julianday` 按 UTC、`Date.parse` 按浏览器本地时区，会同时区偏置约 ±N 小时。文档已声明"同机同钟"收敛，但准确说**需要的是守护进程与浏览器处于同一时区解释**——同机通常满足，但措辞建议补"同时区"三字，避免被理解成仅"同一时钟"。

> [!TIP] **候选行标题 fallback 与项目树不一致（无害，但可注一句防误判）**
> `merge` 候选行 `sessionTitle: summary.trim() || session.id` 对齐服务端 recent 的 `custom_name || session_id`（`sessions.service.ts:260`）。但项目树里未命名会话的显示名是 `getSessionName` → `summary || name || t('projects.newSession')`（`sidebarProjectFormatting.ts:56-58`）。于是同一条新建未命名会话：**对话页显示 raw `session.id`，项目树显示"新会话"**。这是既有 recent 的现状（不是方案引入），但评审容易误判成不一致 bug——建议在 4.3 附近留一句,说明对话页故意沿用服务端 fallback，与项目树文案不同源。

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

**三审补充**

> [!CAUTION] **“其他客户端建会话也能即时反映”不是当前方案 A 的能力，必须收窄范围或采用方案 C**
> 文档 3 节一边把服务端创建即广播列为“未来多端增强”，一边在“为什么 A 能同时覆盖两条来源”中声称其他客户端建会话也会反映。实际 `POST /api/providers/sessions` 只创建 DB 行并返回（当前代码在 `provider.routes.ts:1097-1106`，没有 broadcast）；`session_upserted` 是 watcher / chat-run 后续产生的 delta，不是创建请求的即时事件。因此 A 的准确范围是“本机 `onSessionEstablished` 立即可见，其他客户端等到后续 upsert 才可见”。若验收包含另一浏览器/另一台机器在创建后立刻看到新行，方案 C（或创建成功后的专用广播）不是可选项，而是必需项；若只做本机修复，应删除多端承诺并把 C 明确排除在本期验收之外。

> [!IMPORTANT] **三审建议把“新会话来源”提升为一等信号，避免跨模块靠 `projects` 反推**
> 当前链路已经有精确来源：`ChatInterface.handleSessionEstablished` 调用 `ProjectMainRegion.handleSessionEstablished`，后者直接调用 `registerOptimisticSession`（`ProjectMainRegion.tsx:43-48`）；WebSocket 分支也能在 `setProjects` 中区分插入与更新（`useProjectsState.ts:316-328`）。建议让这两个入口共同维护“待投影的 sessionId/行”并经 `sidebarSharedProps` 传给 sidebar，再由 feed state 合并、去重和维护 total；这样空 feed、同秒时间、分页 offset、置顶/删除/重命名都能复用现有 reducer 语义。单纯扩展 `recentConversationsWithCurrentTitles` 会把状态来源、分页来源和交互来源拆在三个层次，后续每个操作都要再次补偿。

> [!WARNING] **三审测试还缺“请求边界竞态”，不能只验证 rerender 后的纯函数结果**
> `fetchRecentConversationsPage` 的 sequence 只防旧请求覆盖新请求（`useSidebarController.ts:238-287`），并不知道 `projects` 在请求开始后新增了 sessionId。至少补两条集成用例：一是 `/recent` 已成功返回空数组后再创建首条会话；二是 `/recent` 请求进行中创建会话，分别验证响应落地、`projects` upsert、后续 loadMore/刷新不会丢行或重复。当前 7.1 只覆盖“feed 已有两行、rerender 加第三行”，无法暴露前面两审指出的空 feed 和请求边界问题。

> [!NOTE] **三审结论**
> 在不引入显式新会话信号、不修改服务端广播的前提下，只能把本期目标限定为“本机新建会话即时出现”；多端即时、空 feed、同秒排序和派生行交互仍需额外设计。建议牵头评审先确认验收范围，再决定是收窄方案 A，还是直接升级到“本地投影 + 创建广播”的组合方案。

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

---

## 评审回应与方案修订（v3）——二审裁定与待拍板

> 本节在 v2 之后追加。**二审意见以「二审补充」形式署名在上文 §审阅批注 的 `### Claude` / `### Codex` 节内**：
> - Claude 二审：折叠行无法被乐观置顶即时响应；`isPinned` 透传与 append 分区二选一；折入时机早于"发首条消息"；性能（memo 两遍全遍历）。
> - Codex 二审：严格 `ms > newestLoadedMs` 撞 SQLite 秒级精度；折叠行"立即置顶"没走通；offset 未与服务端分页位置对齐（更正其自身上一轮 NOTE）；同秒候选缺 `session_id DESC` 决胜键。
>
> ⚠️ **必须先明确的事实（供三审定位靶子）**：**二审全部引用 v1 的编号与代码**——`§4.2` 的时间闸候选条件、`§5.1` 的 `ms <= newestLoadedMs` 与 `additions` 分区、`5.2` 的 memo。**v2 本身（显式信号 + pending overlay + 单向对账 + props 穿线）没有任何一条二审覆盖过**。v3 的任务是把二审裁定归位，并把「v2 vs 更小方案 D」的取舍摆上台面，供三审裁决。

### A. 二审逐条裁定（含命中范围与复算）

| # | 来源 | 条目 | 裁定 | 命中 v1 | 命中 v2 | 复算依据 |
|---|---|---|---|---|---|---|
| 1 | Claude | 折叠行无法被既有乐观置顶链路即时响应 | **成立** | ✔ | **✔** | 乐观置顶的即时预览作用于 **state**：`setRecentConversations(prev => reorderRecentConversationsForPin(prev, sessionId, isPinned))`（`useSidebarController.ts:1332-1334`）；而 `reorderRecentConversationsForPin` 找不到该行即 `return conversations`（`sidebarProjectFormatting.ts:284-286`）。v2 的 pending 行同样不在 state ⇒ 点置顶无即时预览，等 `reloadRecentConversations()`（`:1350`）兜底 |
| 2 | Claude | 一审"`isPinned` 透传"建议与 append 分区耦合，须二选一 | **成立** | ✔ | ✖ | v2 只投影本地**新建**（必未置顶），不直接冲突；但**修 #1** 若走"merge/派生读 `optimisticPin`"就会重新引回该冲突 ⇒ 修 #1 时必须一并按 `isPinned` 分区 |
| 3 | Claude | 折叠时机早于"发首条消息"（文档表述） | **部分接受** | ✔ | **✔** | 时机结论对：`onSessionEstablished` → `registerOptimisticSession`（`ProjectMainRegion.tsx:47`），在 `POST /providers/sessions` 成功即触发（`useChatComposerState.ts:892`）。但"早于发首条消息"措辞**也不精确**——首条消息是随创建请求一起提交的（`:856` `initialMessage`）。精确表述应为"**会话创建成功即折入**" |
| 4 | Claude | 性能：memo 两遍全遍历 `projects × sessions` | **成立（仅 v1）** | ✔ | ✖ | v2 的叠加是对 `feed + pending` 的一次变换，不遍历全部 `projects` ⇒ 不适用 |
| 5 | Codex | 严格 `ms > newestLoadedMs` 撞 SQLite 秒级精度 | **成立（仅 v1）** | ✔ | ✖ | `createAppSession` 用 `CURRENT_TIMESTAMP`（`sessions.db.ts:227`，秒级）；v2 无时间闸 ⇒ 已消除 |
| 6 | Codex | 折叠行"立即置顶"没走通 | **成立** | ✔ | **✔** | 与 #1 同源，独立发现 |
| 7 | Codex | offset 未与服务端分页位置对齐 | **成立** | ✔ | **✔** | `loadMoreRecentConversations` 传 `recentConversations.length` 作 offset（`useSidebarController.ts:293-303`）。v2 的 pending 不进 state ⇒ 新增 1 行后 offset 落后 1，会重取上一页末行（`existingIds` 去重避免重复展示，但不"对齐"） |
| 8 | Codex | 同秒/同毫秒候选缺 `session_id DESC` 决胜键 | **成立（低优先）** | ✔ | ✔ | v2 的 `prependPendingConversations` 若仅按 `lastActivity` 排序，多个同刻 pending 顺序不定；服务端在时间相同用 `session_id DESC`（`sessions.db.ts:642-653`） |

**收敛结论**：二审中真正"横向命中 v2"的是 **#1 / #6 / #7**。三者**同根**——新行留在**派生层**，于是所有作用于 `recentConversations` **state** 的机制（乐观置顶重排、分页 offset、total 维护）都要各自单独适配。这正好解释了为何**两轮评审各自都给出同一句建议**："让显式新会话进入可被现有 reducer/state 操作的同一列表"（Claude #1 建议、Codex 二审 TIP）。

### B. 方案 D（v3 提议，取代 v2 的 pending overlay）

**做法**：新建会话时把行**直接并入 feed state**（而非悬浮在派生层），并同步 `total`。它与 v2 共享同一条"显式信号"来源（`registerOptimisticSession` 仍要经 `sidebarSharedProps` 把 `createdConversation` 传给 `<Sidebar>` → `useSidebarController`，因为 controller 本身不知道新建），**但省去 pending state、对账 effect 与派生层改造**。

```ts
// useSidebarController.ts —— 新增 1 个 effect：把本地新建会话并入 feed state
const insertedConversationIdsRef = useRef<Set<string>>(new Set());
useEffect(() => {
  if (!createdConversation) return;
  const { row } = createdConversation;
  if (insertedConversationIdsRef.current.has(row.sessionId)) return; // 去重：同一信号不重复并入
  insertedConversationIdsRef.current.add(row.sessionId);

  setRecentConversations((previous) => {
    if (previous.some((c) => c.sessionId === row.sessionId)) return previous; // 重取已含该行
    // 新会话必未置顶 ⇒ 插到置顶块之后、未置顶块之前（对齐服务端 `isPinned DESC`）
    const pinned = previous.filter((c) => c.isPinned);
    const unpinned = previous.filter((c) => !c.isPinned);
    return [...pinned, row, ...unpinned];
  });
  setRecentConversationsTotal((total) => total + 1);
}, [createdConversation]);
```

**为什么二审三条命中对 D 不成立**：

- **#1/#6（乐观置顶）**：新行已在 `recentConversations` state ⇒ `reorderRecentConversationsForPin(recentConversations, ...)` **能找到它**，点置顶立即重排、无需等 reload。
- **#7（offset）**：新行进 state ⇒ `recentConversations.length` 计入它。**且服务端也把它排在最前**（`isPinned DESC, julianday(updated_at) DESC`，`sessions.db.ts:642-653`；新行 `updated_at` 最新）——故客户端"state 含它 + offset 计入它"与"服务端把它排首位"**位置一致**，`loadMore` 不漏不重。反证：v2 的派生层方案（state 不含它）正是 Codex #7 的重叠来源。
- **total**：`total + 1` 与 state 增量天然同步。

**自洽性（为何不会丢 / 重复）**：

1. `fetchRecentConversationsPage(0, false)` 重取是**整体替换**（非 append 分支 `return conversations`，`useSidebarController.ts:262-264`）。该会话已落库，服务端 `/recent` 必返回它 ⇒ 乐观行被**服务端版本替换**（顺带纠正 `lastActivity` 格式与 `projectDisplayName`），不丢不重。
2. 切页签 effect（`searchMode==='conversations'` 且搜索词 <2）会 `reloadRecentConversations()`（`:335-341`），同上；append（loadMore）分支有 `existingIds` 去重（`:267-271`）。
3. **搜索态隔离**不变：`recentConversations` 仅用于非搜索分支渲染（Claude 一审批注已核）。
4. `rename`（`:1269-1273`）与删除/归档（`:984-990`）都是对 state 的原地 map/filter，乐观行一并受治。
5. 既有 `recentConversationsWithCurrentTitles` memo（`:350-376`）会照常处理乐观行，无冲突。

**D 的新增待确认点（请三审一并裁决）**：

1. **竞态闪丢**：若 `POST /providers/sessions` 落库前有人触发重取，整体替换会短暂丢掉乐观行。窗口极小（`create` await 完成后才发信号）；且下一拍重取即恢复。
2. **`total` 原子性**：去重分支（state 已含该 id）不应再 +1——上例用 `insertedConversationIdsRef` 兜住；实现时须确认该 ref 的清理时机（删除/归档时应移除对应 id，避免历史 id 永久占位）。
3. **时间口径约束（不在二审、一审范围内，牵头复算新增）**：乐观行 `lastActivity` 用 `new Date().toISOString()`（UTC、毫秒、带 `Z`）；服务端行用 DB `CURRENT_TIMESTAMP`（UTC、秒级、**无时区后缀**），前端 `Date.parse` 对后者按**本地时区**解析 ⇒ 两者口径不同。**约束：D 只做"置顶块后、未置顶块前"的位置插入，不得用 `lastActivity` 跨源比较排序**（pending 内部同口径可排）。遵守此约束即无影响。

**D 与 v2 取舍对比**

| 维度 | v2（pending overlay） | D（并入 state） |
|---|---|---|
| 二审 #1/#6 乐观置顶 | ✖ 失效（等 reload） | ✔ 立即生效 |
| 二审 #7 offset 对齐 | ✖ 落后 1（重取末行） | ✔ 对齐 |
| `total` | 需 `+ pending.length` | 天然 `+1` |
| 改动面 | props 穿线 + pending state + **2 个 effect（投影+对账）** + 派生 memo 改造 + 纯函数 | props 穿线 + **1 个 effect** + 纯函数 |
| `recentConversations` 语义 | 纯服务端分页真值 | 混入乐观行（重取时被服务端版本替换） |
| 主要新增风险 | 派生层与 state 侧机制持续失配 | 竞态闪丢（小）、`total` 原子性 |
| 空 feed / 置顶 / `-Infinity` / 秒级精度 | 已解 | 已解 |

### C. 待拍板项（请三审重点裁决）

> 以下四项**尚未定论**，需要评审给出结论或牵头拍板；文档不预设答案。

1. **方案选型：D 还是 v2？** 牵头的倾向是 **D**（二审三条命中对 D 均不成立，且改动更小），但 D 改变了 `recentConversations` "纯服务端真值"的语义假设——请评估该语义变化是否可接受、有无未预见的消费者。
2. **范围收敛：只覆盖"本机新建"，放弃多端 / WebSocket 即时。** 依据：`session_upserted` 事件字段不足（仅 `id/summary/messageCount/lastActivity`，无 `isPinned/created_at/updated_at`）且语义是 upsert 非 insert（Codex 一审已核）。请确认这是否是可接受的范围。
3. **并发丢信号：** 极端并发下可能丢一条新建信号 ⇒ 退化为"该条等下一次重取才出现"。请确认可接受，或要求改为可累积的队列信号。
4. **D 的竞态闪丢（B 节新增点 1）与 `total` 原子性（点 2）** 是否可接受 / 需要更严的写法。

### D. 三审质疑清单（请围绕以下点"读代码推演失败路径"）

1. **D 的 offset 对齐论证**：`[...pinned, row, ...unpinned]` 的插入位置 + `recentConversations.length` 作 offset，在"首屏 40 行 + 新增 1 行 + 连续 loadMore"下是否真不漏不重？特别验证"存在置顶行"与"乐观行尚未被重取替换"两个时点。
2. **D 的语义变化**：state 混入乐观行后，除 offset/`total`/置顶/rename/删除外，**是否还有消费者**把 `recentConversations` 当作"服务端权威分页"？请全量排查消费点。
3. **竞态窗口**：`POST /providers/sessions` await 完成 → `onSessionEstablished` → props 穿线 → effect 落 state 之间，是否有任何路径触发 `fetchRecentConversationsPage(0,false)` 把乐观行冲掉？窗口内失败是否可恢复？
4. **`insertedConversationIdsRef` 的生命周期**：删除 / 归档 / 重取后该 id 是否应从 ref 清除？不清除会否造成"同 id session 重建后不再并入"？
5. **时间口径约束（B 节新增点 3）**：在实际数据（DB 秒级无时区 vs 本地 ISO-UTC）下，D 的"位置插入、不跨源比时间"是否足以规避？有无隐藏的排序路径仍会比较二者？
6. **是否仍有比 D 更小的桥接点**：例如是否存在现成的"session 创建事件"订阅点，可直接在 controller 内落 state，省去 props 穿线？
7. **二审对 v2 的"未覆盖"**：请确认 v2 的 side-channel props 穿线、overlay 对账、`nonce` 并发模型**确实未被任一轮覆盖**，以及这些点在选 D 后是否仍需保留（如信号穿线）。

---

## 附：三审阅读指引

- **靶子**：`### C. 待拍板项` 与 `### B. 方案 D`（真正的新内容）。**不要**再对 §1/§2 现象链路、v1 §4/§5 时间闸方案做审——它们已被 v2 取代、且二审已覆盖。
- **纪律**：审阅者给出的**数字与修法都要复算**（本轮已出现"勘误自身也不准"与"二审更正一审 NOTE"两例）；对失败路径请"读代码推演"，不要只做文档自洽性检查。
- **行号**：全文行号已因工作区未提交改动漂移，**一律以符号/引文为准**（见文首勘误）。

---

## 三审裁定（v4）——意见收敛于方案 D

> 三审意见以「三审补充」形式署名在上文 §审阅批注 的 `### Claude`（4 条）与 `### Codex`（4 条）节内。**与前两轮相同，三审引用的仍是 v1 的编号**（`§5.1/§5.2/§4.3/§6-4`、时间闸 `merge`）——它同样没读到 v2/v3。但三审**独立地**给出了方案 D 的逐字描述（Codex #6），这是决定性收敛信号。
>
> ⚠️ 三审写作期间工作区另有**未提交改动**（另一条线：侧栏 attention 二期，涉及 `server/modules/websocket/services/session-upsert-broadcast.service.ts` 等 14 个文件），已影响若干行号与 `session_upserted` 的 payload。本节复算**按当前工作区实码**核过（见 §C）。

### A. 三审逐条裁定（含命中范围与复算）

| # | 来源 | 条目 | 裁定 | 对方案 D | 复算依据（当前工作区） |
|---|---|---|---|---|---|
| 1 | Claude | 归档过滤前提：活跃项目 `sessions` 由服务端保证 `isArchived=0`；客户端 `ProjectSession` 无 `isArchived`，无法兜底 | **成立（前提级）** | 本机乐观行必活跃、不直接命中；**但若把信号源扩到 ws 插入分支（#6）则必须** | `getSessionsByProjectPathPage` 带 `AND isArchived = 0`（`sessions.db.ts:750,758`）；`ProjectSession`（`src/shared/types.ts:82-104`）**无 `isArchived`**；`getSessionsByProjectPathIncludingArchived`（`:736`）存在 |
| 2 | Claude | 折叠行存在期间，`§6-4`"无变化时引用不变"不再成立 | **成立（仅 v1）** | **对 D 不适用**：D 不改 `recentConversationsWithCurrentTitles` 的 `changed` 初值，该契约在 D 下继续成立 | v1 §5.2 把 `changed` 初值设为 `merged !== recentConversations`（v1 专有）；D 的插入发生在 state 层，不触碰该 memo |
| 3 | Claude | 时间闸前提要的是"**同时区解释**"，不止"同机同钟" | **成立（仅 v1）** | **与 v3 §B 新增点 3 是同一点**——三审独立命中 | v1 `Date.parse(lastActivity)` vs 服务端 `julianday(...)`（UTC）的口径差；D 用"位置插入、不跨源比时间"规避 |
| 4 | Claude | 候选行标题 fallback 与项目树不同源（对话页显示 raw `id`，项目树显示"新会话"） | **成立（既有现状，无害）** | 适用（D 的乐观行同样取 `summary\|\|id`） | 对话页 `custom_name?.trim() \|\| session_id`（`sessions.service.ts:332`）vs 项目树 `getSessionName`（`sidebarProjectFormatting.ts:56`） |
| 5 | Codex | "其他客户端建会话即时反映"不是方案 A 的能力；`POST /sessions` 无 broadcast | **成立（= v3 待拍板项 2）** | 同 | 已核 `provider.routes.ts:1097-1107`：`createAppSession` 后仅 `res(201).json(...)`，**无 `broadcastSessionUpserted`** |
| 6 | Codex | 把"新会话来源"提为一等信号：`registerOptimisticSession` **与** ws `setProjects` 插入分支两入口共同维护"待投影行"，经 `sidebarSharedProps` → sidebar → feed **state** 合并/去重/维护 total | **成立（= 方案 D 的精确描述）** | **核心** | `upsertSessionIntoProject` **已区分插入 vs 更新**（`inserted` 标志，`useProjectsState.ts:291-330`）⇒ 插入分支天然是信号命中点 |
| 7 | Codex | 测试还缺"请求边界竞态"：①`/recent` 成功返回空后再创建；②`/recent` 请求进行中创建 | **成立（= v3 待确认点 1）** | 同 | `fetchRecentConversationsPage` 的 sequence 只防"旧响应覆盖新响应"（`useSidebarController.ts:238-260`），不知道请求期间 `projects` 新增 |
| 8 | Codex | 结论：不引入显式信号、不改服务端广播 ⇒ 只能限定"本机新建"；**先定验收范围** | **成立** | 拍板项 | — |

### B. 决定性事实：四个独立来源收敛到方案 D，无对立意见

- **三审 Codex #6 逐字即方案 D**（"经 `sidebarSharedProps` 传给 sidebar，再由 feed **state** 合并、去重和维护 total"）——与 v3 §B 的伪代码同构。
- 收敛路径：① 一审 Codex TIP「收窄为显式新会话投影」→ ② 二审 Claude #1 / Codex #2「更简单的是让显式新会话进入可被现有 reducer/state 操作的同一列表」→ ③ **三审 Codex #6** 逐字给出 D → ④ v3 §B 调和为 D。
- **三审无一条反对 D**；三条"对 v1 的命中"（#2/#3/#4）在 D 下或消失、或降级为"前提/无害"。**分歧已收敛。**

### C. 工作区时效性核对（本轮新查，防判据过期）

1. **`session_upserted` 正在被另一条线加字段**：`SessionUpsertedEvent` 新增 `change: SessionUpsertChange`（`'content' | 'metadata'`，`server/shared/types.ts:291,307`），用于区分"真实追加 vs bare touch"（侧栏未读胶囊）。**但 session 对象仍只有 `id/summary/messageCount/lastActivity/change`——仍无 `isPinned/created_at/updated_at`** ⇒ "事件字段不足"判据**仍成立**。
2. **`POST /sessions` 仍无 broadcast**（`provider.routes.ts:1097-1107`）⇒ "创建不广播"判据成立。
3. **行号继续漂移**：三审引的归档 SQL 行（`720/728`）现值 `750/758` ⇒ 再次印证实现**一律按符号定位**。

### D. 唯一实质待拍板项：本期验收范围（其余均已收敛）

| 选项 | 做法 | 代价 |
|---|---|---|
| **① 本机新建即时**（推荐为本期） | 方案 D：仅 `registerOptimisticSession` 喂信号，纯前端 | 多端（另一浏览器/机器）**不**即时，等 `session_upserted` 后续 delta |
| **② 含多端即时** | 需**方案 C**：`POST /providers/sessions` 成功后广播专用事件（或把信号源扩到 ws 插入分支 `useProjectsState.ts:327-330`，但须先补 `RecentConversationListItem` 所需字段） | 触及协议层/服务端；须补字段 |

**建议**：① 为本期（用户报告的就是本机路径），② 另立项。若选 ②，需回到"方案 C"重新设计。

次要/接受项（不阻塞）：
- 并发丢信号 ⇒ 退化为"等下次重取"（可接受）；
- D 的竞态闪丢（v3 §B 新增点 1）与 `total` 原子性（点 2）⇒ 实现时用 ref 集合兜住；
- 候选行 fallback 文案差异（三审 #4）⇒ 注一句即可，非缺陷。

---

## 实施记录（2026-10-10）

**验收范围**：① 本机新建即时（方案 D）。多端即时仍不在范围内。

**改动（符号级：4 源文件 + 1 类型 + 2 测试文件）**：

| 文件 | 改动 |
|---|---|
| `src/shared/types.ts` | 新增 `CreatedConversationSignal = { row: RecentConversationListItem; nonce: number }` |
| `src/modules/project-workspace/hooks/useProjectsState.ts` | 新增 state `createdConversation`；`registerOptimisticSession` 末尾 `setCreatedConversation`（row = sessionId / provider / projectId / projectDisplayName / `summary.trim() \|\| sessionId` / now / `isPinned:false`，nonce 递增）；`sidebarSharedProps` 带出 |
| `src/modules/sidebar/Sidebar.tsx` | props 类型加 `createdConversation`，透传给 `useSidebarController` |
| `src/modules/sidebar/hooks/useSidebarController.ts` | args 加 `createdConversation`；新增 `insertedConversationIdsRef` 与 1 个 effect：去重后把 row 插到置顶块之后、未置顶块之前，并 `total + 1` |
| `src/modules/sidebar/tests/recentConversationNewSession.test.ts` | 新增 5 测试（即时出现+total / unnamed 用 id / 置顶后插 / 已含不重复 / 掉出不顶回） |
| `src/modules/project-workspace/tests/projectsStateAttention.test.ts` | 新增 2 测试（信号生产端 row 字段；unnamed fallback） |

**实现期对 D 伪代码的两处收紧**（`v3 §B` 伪代码本身带此坑）：
1. **去重分支不得再加 `total`**：伪代码在"feed 已含该行"时仍 `total + 1`（其点 2 已预警）。实际实现改为"先判 feed 是否已含该 id，含则早退不加 total"，与 `insertedConversationIdsRef` 构成双层去重。
2. **effect 依赖 `[createdConversation, recentConversations]`**：`insertedConversationIdsRef` 保证"每个 id 只并入一次"，故 `recentConversations` 变化触发重跑时早退，不会把已掉出 feed 的行顶回。

**验证**：
- `tsc --noEmit -p tsconfig.json` 通过；`oxlint` 0 error。
- `vitest run src/modules/sidebar src/modules/project-workspace`：23 文件 / 122 测试全绿。
- **反向验证**：变异 A（effect 完全不动作）→ 4 红；变异 B（禁用去重）→ 3 红。测试可证伪。
- `npm run build:client` 成功（产物 `index-BWOTqyzm.js`，HTML 已引用）。
- **真机验证未完成**：本地 3011 守护进程需登录凭证，未取得。请刷新页面后（纯前端改动，无需重启守护进程）切到「对话」页签，对某项目新建会话并发送首条消息，确认新行即时出现在顶部、无重复、total 正确。

**环境提示（与本次改动无关，但影响本地跑测）**：本机 Node 已迁 v26，其原生 WebStorage 与 jsdom 冲突，`localStorage` 为 undefined ⇒ 所有依赖 `localStorage` 的 client 测试在 Node 26 下必红。此套件须在 **Node 20** 下跑（v22 已卸载）：`PATH="$HOME/.nvm/versions/node/v20.19.6/bin:$PATH" npx vitest run`。项目 `.nvmrc` 仍写 `v22`（已过期）。
