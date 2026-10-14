# CloudCLI 会话所属关联方案

> - 状态：**设计稿（第 1 轮审阅已响应；V1 已探针点验并据此改判 Q1，待复审）**，尚未动工
> - 日期：2026-10-13
> - 用途：评审「会话之间建立所属/派生关系，并在侧边栏以缩进/引用体现」的方案。审阅重点：**§4 开放问题的取舍（尤其分页父行带出、pin 语义、conversations 的表达方式）、§3.4 拖拽与菜单入口的取舍、§3.5 归档/删除的边界规则**。
> - 参考规范：`.agents/skills/backend-module-standards/SKILL.md`（`server/`）、`.agents/skills/frontend-module-standards/SKILL.md`（`src/`）

---

## 0. 一句话结论

会话之间加一个用户手动维护的**自引用归属字段**（`parent_session_id`，限一层、限同项目），后端补字段的写/读/投影与一个设置接口，前端在 **projects 视图**渲染缩进树、在 **conversations 视图**渲染「派生自」引用行。存储层已有一个同形的先例（`forked_from_session_id`）可直接照抄，**渲染缩进本身很便宜，真正的成本集中在两个入口（菜单/拖拽）与两条边界规则（父会话不在已加载页、父会话被归档）**。两条边界都靠同一条客户端降级规则兜住（**父不可见 → 子按根渲染**），无正确性代价；其中「分页父行带出」经 V1 探针点验后确认当前规模不可达，**已从 P1 延后**（§1 V1、§4 Q1）。

---

## 1. 现状事实（已实测确认）

**存储层**

- `sessions` 表定义在 `server/modules/database/schema.ts:123-164`；主键 `session_id`，外键只指向 `projects(project_path)`（`:160-162`）。
- **已存在一个同形的自引用字段** `forked_from_session_id TEXT`（`server/modules/database/schema.ts:148`），语义注释为「informational only；删源不影响 fork」。迁移用 `addColumnToTableIfNotExists` 加列（`server/modules/database/migrations.ts:436-439`），并建了索引 `idx_sessions_forked_from`（`migrations.ts:701`）。
- 该字段**只被写、从没被 API 读出过**：写入仅发生在 `createForkedSession`（`server/modules/database/repositories/sessions.db.ts:344`、`:356`），生产读路径为零（除测试）。这既是「可照抄的模板」，也是一个反面教训：**光加列不投影 = 前端永远看不到**。
- `SESSION_ROW_COLUMNS`（`sessions.db.ts:35-36`）是**显式列清单**，新增列必须同步加进去，否则 `SELECT ${SESSION_ROW_COLUMNS}` 的查询取不到（`getSessionsByProjectPathPage:810-825`、`getSessionsByProjectPathIncludingArchived:796-808`、`getArchivedSessions:763`）。例外：`getRecentSessionsPage:726-757` 用的是 `SELECT sessions.*`，会自动带出新列。
- 持久化是裸 SQL 的 `better-sqlite3`，无 ORM、无 SQL 迁移文件；schema 是代码（`schema.ts`），演进是过程式（`migrations.ts`）。

**服务/接口层**

- 项目 → 会话的关联是**按文件系统路径**（`sessions.project_path` → `projects.project_path`），不是 project_id。归一化在 `normalizeProjectPath`（`server/shared/utils.ts`）。
- 会话列表的两种来源：
  - 项目内会话页：`getProjectSessionsPage` → `readProjectSessionsPageByPath`（`server/modules/projects/services/projects-with-sessions-fetch.service.ts:194-202`），**过滤 `isArchived = 0`，按时间倒序，默认每页 20**（`sessions.db.ts:810-825`）。
  - 全局最近流：`listRecentSessions`（`server/modules/providers/services/sessions.service.ts:313-343`）→ `getRecentSessionsPage`，跨项目、时间倒序、**排除已归档会话与已归档项目**（`sessions.db.ts:728-731`）。
- 会话项的投影：项目视图由 `mapSessionRowToSummary`（`projects-with-sessions-fetch.service.ts:161-173`）产出 `SessionSummary`（`:11-34`）；最近流由 `listRecentSessions` 内的 map 产出 `RecentSessionListItem`（`sessions.service.ts:89-92`）。两者当前**都不含任何关系字段**。
- `setSessionPinned`（`sessions.service.ts:346-357`）是「改一个布尔字段」的现成范式：路由解析 → service 校验存在 → `sessionsDb.updateSessionIsPinned` → 返回。
- 路由解析范式：`parseSessionPinned`（`server/modules/providers/provider.routes.ts:534-551`）、`parseSessionForkPayload`（`:486-505`）；pinned 路由在 `:1290-1298`。
- 实时增量：**唯一生产者** `buildSessionUpsertedEvent`（`server/modules/websocket/services/session-upsert-broadcast.service.ts:26-81`），广播入口 `broadcastSessionUpserted`（`:119-128`）/ `broadcastSessionUpsertedBatch`（`:138-151`）；事件类型 `SessionUpsertedEvent`、变更分类 `SessionUpsertChange = 'content' | 'metadata'`（`server/shared/types.ts:308`、`:322-358`）。

**前端**

- 会话类型 `ProjectSession`（`src/shared/types.ts:95-129`）带 `[key: string]: unknown` 开放索引，新增字段可透传但**必须显式补类型**才被当作一等字段使用。
- 侧边栏链路：`Sidebar → SidebarContent → SidebarProjectList → SidebarProjectItem → SidebarProjectSessions → SidebarSessionItem`。
  - 会话渲染循环：`src/modules/sidebar/SidebarProjectSessions.tsx:243-269`（**扁平 `sessions.map`**）。
  - 唯一的「缩进样式」就在 `SidebarProjectSessions.tsx:180` 的 `ml-3 space-y-1 border-l border-border pl-3`。
  - `SidebarSessionItem`（`:490`）与 `SidebarProjectItem`（`:507`）均 `memo`；另有 compact/desktop **两套布局**由 `useCompactSidebar()` 切换，缩进要两边都改。
- 排序/分组的唯一入口是 `getAllSessions`（`src/modules/sidebar/utils/sidebarProjectFormatting.ts:85-106`）：pinned 优先、再 `lastActivity` 倒序，并按 **project 对象引用**做 `WeakMap` 缓存（`:73-83`，注释说明缓存正是为保住 memo 边界）。搜索过滤 `filterSessionsForProject`（`:199-210`）、乐观 pin `applyOptimisticSessionPinState`（`:242-271`）、最近流乐观重排 `reorderRecentConversationsForPin`（`:279-296`）都假设「扁平」。
- conversations 视图：`src/modules/sidebar/SidebarRecentConversations.tsx`，消费 `RecentConversationListItem`，扁平流 + pinned/unpinned 两段 +分页「加载更多」。
- 会话操作菜单 `SessionOptions.tsx:51-212`（items 在 `:168-207`），**projects 行与 conversations 行共用**（文件头注释 `:42-50` 明确说明），是加「归到…/移出」动作的天然落点。
- 新会话是**懒创建**：点「新建会话」只重置到空聊天（`useProjectsState.ts:1390-1403`），真正的会话在首次发送时由 `api.providers.createSession` 分配（`src/modules/chat/hooks/useChatComposerState.ts:835-906`，payload 仅 `provider/projectPath/initialMessage`，`src/shared/api.ts:463-467`），随后 `registerOptimisticSession` 乐观插入（`useProjectsState.ts:773-852`）。
- 客户端侧边栏 DnD 基建：**无**。`src/` 无 `onDragStart/onDrop` 于侧边栏；`react-dropzone` 仅用于文件上传。`package.json` 无 dnd-kit / react-dnd / sortable。

**审阅轮补充事实（已实测确认，2026-10-13 第 1 轮）**

- **删行路径不止一处**：仓储层至少有 6 个删行点——`sessions.db.ts:341`（`createSession` 用 app 行替换 watcher 行）、`:387`（`assignProviderSessionId` 合并重复行）、`:449`/`:462`（`repointSessionToProviderSession`）、`:842`（`deleteSessionsByProjectPath`）、`:888`（`deleteSessionById`）、`:898`（`deleteSessionByProviderSessionId`）。`deleteSessionById`（`:888`）本身已被 `deleteOrArchiveSessionById`（`sessions.service.ts:995`）与 `permanentlyDeleteArchivedSessions`（`:1034-1036`）调用。
- **父会话会被自动 prune**：`pruneOrphanedSessions`（`server/modules/providers/services/session-synchronizer.service.ts:36-62`）在 transcript 文件消失时调 `deleteSessionById`（`:56`），而 `synchronizeSessions` 由 `getProjectsWithSessions` 在**每次加载侧边栏**时触发（`projects-with-sessions-fetch.service.ts:229-231`）。即「父被删」是自动、静默、可重复的。
- **删除不广播**：`deleteOrArchiveSessionById` 内无任何 `broadcastSessionUpserted`。改元数据后广播的**现成先例是 `forkSessionById`（`sessions.service.ts:506` 调 `broadcastSessionUpserted(..., 'metadata')`）**，不是 `setSessionPinned`（`:346-357`，只改字段、不广播）。
- **`updateSessionIsPinned` 不触碰时间戳**（`sessions.db.ts:875-886`，注释明确「independent from a session's activity timestamps」）；`updateSessionIsArchived`（`:866-873`）同样只改 flag。
- **`getSessionById` 不过滤 `isArchived`**（`sessions.db.ts:631-644`）→ 已归档父的标题可解析。
- **分页算术**：`readProjectSessionsPageByPath` 用 `hasMore = offset + rows.length < total`、`total = countSessionsByProjectPath`（`projects-with-sessions-fetch.service.ts:199-204`）；客户端下一页 `offset = countLoadedProjectSessions(project)`（`useProjectsState.ts:1537-1546`）——即 offset 由**已加载行数**推进。
- **会话操作菜单有 5 处手写**：`SessionOptions.tsx:168-207` 只服务 `SidebarSessionItem` 的**桌面**分支（`SidebarSessionItem.tsx:457`，`{!isCompact && …}`）；另有 `SidebarSessionItem.tsx:207-360` 的 compact bottom sheet、`SidebarRecentConversations.tsx:466-517` 桌面 `ActionMenu` 与 `:328-390` 移动 bottom sheet、`SidebarContent.tsx:114-172`/`:516+` 的 `menuItems` 各自维护。
- **i18n**：15 个语言包，`fallbackLng: 'en'`（`src/modules/i18n/config.ts:361`），**en 是超集**（扁平 key 实测：common.json en 321 / zh-CN 212，缺 109；chat.json en 469 / zh-CN 439）；会话文案住在 **`sidebar.json` 的 `sessions.*`**（`sessionOptions` 在此文件，common.json 无 `sessions` 段）。

**设计假设 V1（已用真实数据点验 → 结论：不可证，且其唯一消费者在当前规模不可达）**

- 原假设「派生/审阅会话通常比其父会话新」。若成立，则在时间倒序 + 分页下子排在上方、父常在未加载页——这是 §3.5① 与 §4 Q1 的前提。
- **探针实测（只读连接 `~/.cloudcli/auth.db` 及其 4 个备份）**：
  - 库内唯一的关系先例是 `forked_from_session_id`；**当前库 + 全部备份合计只有 1 条 fork 记录**（当前库 6 会话/0 fork；最大备份 20 会话/0 fork；含 fork 的那个 14 会话/1 fork）。n=1，无统计效力。
  - 更根本：fork 行插入时以 `CURRENT_TIMESTAMP` 写 `created_at/updated_at`（`sessions.db.ts:344-345`），子必然「更新」——它量的是 **fork 机制**，不是用户「把已有会话挂到父下」的行为。故**即使 fork 很多也测不了 V1**。
  - V1 可归约为「B 最后一次活跃是否晚于 A」。因 `updateSessionParent` 设计上不动时间戳（§3.1），这是纯用户行为事实，**库里没有任何列可回溯挖掘 → 实现前不可证**。
- **探针的次要发现（更关键）**：V1 一旦成立才会触发的分页孤儿（§4 Q1 / R1），**在当前数据规模不可达**——项目页大小 20（`projects-with-sessions-fetch.service.ts:117`）、最近流 40（`provider.routes.ts:1205`），而各快照中最大的活跃项目仅 **7** 个会话、全局活跃 ≤ **20**。即全部历史都落在第 1 页内，父不可能「在未加载页」。
- **处置**：§4 Q1 由「P1 做」**下调为延后（P3）**，并设定显式再触发条件（见 §4 Q1）；§3.5① 保留（其「父不可见 → 子按根」的降级路径本就无成本，是不做 Q1 时的安全网）。

---

## 2. 决策记录

以下为与需求方确认后锁定的方向（原话见「对话记录」）：

| # | 决策 | 说明 |
|---|------|------|
| D1 | **关系由用户手动建立** | 「用户给 B 拖定到 A 下方，就形成关联关系」。不做自动识别派生关系（链路无现成信号）。 |
| D2 | **新增字段，不复用 `forked_from_session_id`** | fork 语义是「物理复制了 transcript 的独立会话」，与「审阅/归属」不同，混用会污染语义。 |
| D3 | **独立存活** | 删父不删子。 |
| D4 | **只支持一层** | A→B/C，不支持 B 再带子。 |
| D5 | **projects 与 conversations 两个视图都要体现** | 表达方式见 §3.3（两视图不同）。 |
| D6 | **约束同项目** | 父子必须 `project_path` 相同。 |
| D7 | **fork 出的会话是根级，不继承被 fork 会话的父** | fork 是复制 transcript 的独立新会话，与归属无关（见 §3.5⑧）。 |

作者补充建议（需求方已认可方向，细节见 §4）：

| # | 建议 | 理由（摘要） |
|---|------|--------------|
| A1 | conversations 做**引用行**、不做缩进树 | 时间倒序 + 分页使父常在未加载页，树必然在最显眼处破碎，且会破坏该视图「全局活动流」的排序语义。 |
| A2 | pin 允许但**永不脱离父级**（同级排序） | 复用现有比较器，语义自洽，树结构稳定，无需禁用入口。 |
| A3 | **父不在可见集合 → 子按根渲染**；删除时在**仓储层**孤儿化，归档不解除关系 | 一条规则同时覆盖分页未加载 / 归档 / 删除；与 D3 一致，避免活会话凭空消失；归档可逆故保留关系。删除的孤儿化下沉到仓储层**删行点**（§3.2.1），而非只在 service 一处（第 1 轮 P1）。 |

---

## 3. 设计

### 3.1 数据模型

- 在 `sessions` 增列 `parent_session_id TEXT`（可空，自引用，无外键约束）。
  - `schema.ts` DDL 加列（与 `forked_from_session_id` 相邻）。
  - `migrations.ts` 用 `addColumnToTableIfNotExists` 加列 + `CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id)`。
  - `sessions.db.ts`：`SessionRow` 类型、`SESSION_ROW_COLUMNS` 同步加 `parent_session_id`。
- **不加自引用外键**：sqlite 加自引用 FK 需重建表（`migrations.ts:252-397` 那种高风险的 rebuild 路径），而唯一要保证的语义（删父后子独立）用一条 `UPDATE` 即可实现（§3.2.1）。
- **不加子会话排序字段**：子会话沿用与根相同的比较器（pin 优先、再时间），无需新列（对应 A2）。
- **归属是组织元数据，与活动时间无关**：`updateSessionParent` **不得**触碰 `updated_at`/`content_updated_at`（照 `updateSessionIsPinned`，`sessions.db.ts:875-886`）。排序键就是 `updated_at`（`sessions.db.ts:813-818`、`sidebarProjectFormatting.ts:98`）；一旦触碰，「归到…」这个纯组织操作会让子会话瞬间跳到项目顶部，并污染 `lastActivity`（同时喂给项目排序 `getProjectLastActivity`、年龄显示、upsert 广播 `session.lastActivity`）。（第 1 轮 P3）
- **`idx_sessions_parent` 标为可选**：实际只服务「计数子会话」与「孤儿化 UPDATE」两处（带出父行按主键取），不是性能必要项。（第 1 轮 W9）
- **NULL 陷阱（留注释）**：`sessions.project_path` 是 `ON DELETE SET NULL`（`schema.ts:160-161`），删项目会把父子 `project_path` 同时置 NULL；将来若把同项目校验下沉到 DB 层，须用 `IS` 而非 `=` 比较。当前仅服务端按请求校验，无即时影响。（第 1 轮 W8）

### 3.2 后端接口与投影（`server/modules/providers` + `server/modules/projects`）

1. 仓储（`sessions.db.ts`）：
   - `updateSessionParent(sessionId, parentSessionId | null)`（**不动时间戳**，见 §3.1）。
   - `orphanChildSessions(parentId)`（`UPDATE sessions SET parent_session_id = NULL WHERE parent_session_id = ?`）。
   - **孤儿化下沉到删行点（第 1 轮 P1，修订处方）**：把 `orphanChildSessions` 放进删行的私有 helper，由 `deleteSessionById`（`:888`）与 `deleteSessionByProviderSessionId`（`:898`）**共用**，同一事务内先 UPDATE 再 DELETE。这样所有调用方（`pruneOrphanedSessions`、`assignProviderSessionId`、`permanentlyDeleteArchivedSessions`、service 永久删除）自动收口。`deleteSessionsByProjectPath`（`:842`）**不需要**——D6 保证父子同项目路径，整批一起删，无悬垂。三处 INSERT（`createSession:300`、`createAppSession:287`、`createForkedSession:315-360`）是显式列清单，新列天然取 NULL，无需改动（顺带保证 D7）。
   - 需要时 `countChildrenOf(parentId)`。
2. 服务（`sessions.service.ts`）新增 `setSessionParent(sessionId, parentSessionId | null)`，镜像 `setSessionPinned` 的**同步**写法：**从校验到写入全程不得有 `await`**（`better-sqlite3` 同步、Node 单线程 → 天然原子），否则并发双写（A→父B 与 B→父A）可各自通过校验、落成两级环（第 1 轮 W4）。校验：
   - 目标会话必须存在（否则 `SESSION_NOT_FOUND` / 404）。
   - `parentSessionId === null` 即「移出」，直接写。
   - 非空时：父必须存在；父 ≠ 自己；**父与子 `project_path` 相同**（D6）；**父本身没有父**（限一层，D4）；**自己当前不是任何会话的父**（不能既有父又有子）。
   - 违反任一条 → `AppError`，`INVALID_SESSION_PARENT`，400。
3. **永久删除无需在 service 额外处理**（已由 §3.2.1 仓储层收口；§3.5③ 据此降级为「仓储层负责」）。归档分支不动关系。
4. `getSessionDetailsById`（类型 `:100-117` / 实现 `:840-872`）与 `listRecentSessions`（`:313-343`）投影补 `parentSessionId`；最近流**另补 `parentTitle`**——用 `getSessionById`（**不过滤归档**，`:631-644`）解析，**按去重后的父 id 批量查，避免 N+1**（一页 40 条）（第 1 轮 W6 + P8）。
5. 项目视图投影（`projects-with-sessions-fetch.service.ts`）：`SessionSummary`（`:11-34`）、`SessionRepositoryRow`（`:36-44`）、`mapSessionRowToSummary`（`:161-173`）补 `parentSessionId`。
6. 路由（`provider.routes.ts`）新增 `PUT /api/providers/sessions/:sessionId/parent`，body `{ parentSessionId: string | null }`；`parseSessionParent` 必须**严格**：接受 `string` 或 `null`，**拒绝其它类型**（仿 `parseSessionPinned:534-551`），并区分 `null`（移出）与字段缺失。（第 1 轮 W10）
7. 实时：`setSessionParent` 成功后调用 `broadcastSessionUpserted(sessionId, 'metadata')`（**先例 = `forkSessionById:506`，不是 `setSessionPinned`**，第 1 轮 W5）；`buildSessionUpsertedEvent`（`session-upsert-broadcast.service.ts:26-81`）的 `session` 补 `parentSessionId`。**只需广播被移动的那一个会话**——前端从全量 `parentSessionId` 重新派生分组（§3.3），父行「有子」状态同样派生，一次事件足够。**删除不广播**：删父后其他客户端的子行 `parentSessionId` 会短暂陈旧，靠 A3（父不在列表 → 子按根）兜住，下次 refetch 自愈（W5 + P1）。

### 3.3 前端派生与渲染

**类型与 API**

- `src/shared/types.ts`：`ProjectSession` 补 `parentSessionId?: string | null`；`RecentConversationListItem` 补 `parentSessionId?: string | null` 与 `parentTitle?: string`（两处以上文件使用，按前端规范放 shared）。
- `src/shared/api.ts`：新增 `setSessionParent(sessionId, parentSessionId | null)`（仿 `forkSession` 的写法，`api.ts:309-310`）。

**分组派生（`sidebarProjectFormatting.ts`）**

- 新增**独立纯函数**（如 `groupSessionsByParent(sessions)`）：输入 `getAllSessions` 的扁平有序结果，输出渲染行「根 + 每个父的子列表」。
- **不改写 `getAllSessions` 的返回结构**：它仍须返回扁平有序数组，因为 `getProjectLastActivity`（`:108-118`）、`filterProjects`（`:176-191`）等调用方假设扁平。把分组塞进 `getAllSessions` 会连带破坏它们。（第 1 轮 W2）
- 判定规则：某会话是**子**，当且仅当 `parentSessionId` 非空、且该父**出现在当前可见列表**、且该父本身不是子；否则按根渲染。此规则即 A3 的落地，**无需为归档/删除写特例**。
- **缓存按「project 引用 + 归一化搜索词」组合键**，或只在「无搜索」路径缓存；**不要**复用现有只以 project 为键的 `sortedSessionsByProject`（`:73-83`）——搜索态走 `filterSessionsForProject`（`:199-210`）返回的是不进缓存的**新数组**，直接复用会冲突。核心目标是保持数组与对象引用稳定，避免击穿 `SidebarProjectItem`/`SidebarSessionItem` 的 memo 边界。（第 1 轮 W2、R2 校准）

**渲染（projects 视图）**

- `SidebarProjectSessions.tsx:243-269` 的 `sessions.map` 改为：先渲染根，根后跟其子列表。
- **缩进落在子行变体上，不在 `:180` 容器**：`:180` 的 `ml-3 … border-l border-border pl-3` 是**项目级**容器，所有行（含根）都在里面，在那里加 `pl-/ml-` 会把根一起右移。缩进加到 `SidebarSessionItem` 的子行；desktop 是无内边距的 `<a>` 行、compact 是自带 `p-2 mx-3` 的卡片（`SidebarSessionItem.tsx:140-149`），**两种形态实现方式不同**。连接线用 `border-left` + 伪元素（纯 Tailwind，无 CSS module）。（第 1 轮 P10）

**渲染（conversations 视图，A1）**

- 不做缩进。子会话照常按时间排在扁平流里，标题下挂一行「↳ 派生自 <parentTitle>」。
- **点击目标定义三态**（否则是新空操作入口）：① 父在已加载集合 → 滚动高亮并可打开；② 父不在但存在（含已归档，`getSessionById` 可解析）→ 直接打开该父会话；③ 父已永久删除 → 纯文本不可点。（第 1 轮 W3）
- `parentTitle` 缺失时退化为「派生会话」。pinned/unpinned 分区与分页「加载更多」逻辑**完全不动**。

**乐观更新（第 1 轮 P7）**

- 沿用现有 overlay 模式：单独一张 `optimisticParents: ReadonlyMap<sessionId, string | null>`，在派生分组时叠加，**不重建 `project.sessions`**（否则该项目所有行引用全变 → 缓存击穿 → memo 全废，恰好是 R2 要避免的）。范式见 `applyOptimisticSessionPinState`（`:242-271`）。请求被 400 拒绝时**回滚 overlay 并给可见错误**（第 1 轮 W10）。

### 3.4 交互入口

- **基线入口 = 菜单**（P1）：加「归到…」「移出」两项：
  - 「归到…」：弹选择器，列出**同项目、且不是自己的子**的根级会话，选中即 `setSessionParent(self, target)`。
  - 「移出」：当前会话有父时显示，调 `setSessionParent(self, null)`。
  - **覆盖范围要先纠正（第 1 轮 P2）**：现有 `SessionOptions.tsx:168-207` **只服务 `SidebarSessionItem` 的桌面分支**（`SidebarSessionItem.tsx:457`，`{!isCompact && …}`），且会话操作菜单共 **5 处手写**（见 §1 补充事实）。因此「加两项」实际要落到 5 处，或**先抽一个共享菜单项构造器**再各页消费——这是本方案最被低估的工作量项。**移动端没有任何一处被现有 `SessionOptions` 覆盖**，须单独补。
- **桌面拖拽 = 增强**（P3，原生 HTML5 DnD，不引新依赖）：
  - 行上加拖拽手柄（避免和「点击打开会话」冲突——行本身是 `<a>`）。
  - 落点规则：拖到某个**根级会话行**上 → 设为它的子；拖到**项目头部 / 列表空白** → 移出。
  - **manage/batch 模式下禁用拖拽**；移动端不提供拖拽，继续走菜单。
  - 不支持拖到「另一个子会话」上交换父（YAGNI，落点规则保持两条）。

### 3.5 边界规则

| # | 场景 | 规则 |
|---|------|------|
| ① | **父不在当前已加载页**（分页） | 子按根渲染。**P1 不「带出父行」**（Q1 已延后，V1 探针改判，见 §1/§4 Q1）——此降级路径即是安全网，无正确性代价。若将来采纳，「带出父行」须用**独立字段**返回——**不能塞进 `sessions` 数组**，否则污染 `hasMore` 与客户端 offset 推进（`projects-with-sessions-fetch.service.ts:199-204`、`useProjectsState.ts:1537-1546`）。（第 1 轮 W1） |
| ② | **父被归档**（软删） | 父不再出现在活跃列表（现有查询已过滤 `isArchived=0`），子按根渲染；**关系保留**，恢复父后树自动复原（D3 + A3）。**但父子可能落在不同视图**：归档区有两条独立数据源（`getArchivedSessions` / `readProjectSessionsIncludingArchived`），都不经 `SidebarProjectSessions`、也没有 `SessionOptions`，故**归档区不显示归属**、「恢复父后树复原」**只在活跃区成立**。另：「归档父 + 活跃子」时，活跃子暂无入口挂回（选择器候选是活跃根会话）——见 §4 开放问题 8。（第 1 轮 P6） |
| ③ | **父被永久删除** | 由**仓储层删行点**收口（§3.2.1）：`deleteSessionById` / `deleteSessionByProviderSessionId` 内先孤儿化再删；service 无需额外处理。`deleteSessionsByProjectPath` 无需（D6 父子同项目一起删）。**删除不广播**，其他客户端的子行 `parentSessionId` 短暂陈旧 → 靠本表①/②规则兜住，下次 refetch 自愈。（第 1 轮 P1、W5） |
| ④ | **pin 与树** | pin 只在同级生效：根之间按 pinned+时间；兄弟之间同一比较器。pin 永不把子拎出父下（A2）。 |
| ⑤ | **搜索** | 先过滤再分组：父未命中 → 子按根；父命中而子未命中 → 子隐藏（沿用 `filterSessionsForProject` 语义，`:199-210`）。**projects 另有「项目名/路径命中 → 保留该项目全部会话」分支**（`:205-206`），此分支下不加过滤，树完整。**conversations 也有搜索态**（`SidebarRecentConversations.tsx:543`）：引用行**不参与**标题匹配；父被过滤掉时引用行退化为纯文本（不可点），不隐藏子行本身。（第 1 轮 W7） |
| ⑥ | **一层/同项目** | 服务端强制（§3.2.2），前端不依赖服务端之外的假设。 |
| ⑦ | **并发** | ① 两端同时改同一会话的父 → 后写覆盖（last-write-wins），可接受，不加锁。② **删除 × 设置交错**：`deleteOrArchiveSessionById` 在孤儿化与 `DELETE` 之间有 `await`（`removeFileIfExists` 循环 / `deleteProviderSession`，`sessions.service.ts:962-995`），窗口内一次 `setSessionParent` 可能通过校验并写入、随后父行被删 → 悬垂引用，靠本表 A3 兜住，可接受。（第 1 轮 W4、P9） |
| ⑧ | **fork 与归属** | fork 出的会话是**根级，不继承**被 fork 会话的父（D7）。仓储 INSERT 是显式列清单，`parent_session_id` 天然为 NULL，无需改动；菜单文案需说明。（第 1 轮 P5） |

---

## 4. 开放问题（附倾向）

| # | 问题 | 选项 | 倾向 |
|---|------|------|------|
| 1 | 项目视图是否「带出被引用的父行」（`referencedParents`）？ | ① P1 做 ② **延后到 P3，仅按需做** | **②延后（V1 探针改判）**。原倾向①的全部依据是「V1 成立时子常在上、父常在未加载页」。探针实测：V1 **不可证**（唯一先例 fork 合计 1 条，且原理上测不了，见 §1 V1）；且其触发场景**在当前规模不可达**（项目页 20 / 最近流 40 vs 最大活跃项目 7、全局活跃 ≤20）。**再触发条件**：一旦出现「单项目活跃会话 > 20（项目页装不下）」或真实观察到根级孤儿子，「带出父行」再上。届时仍**必须用独立字段** `referencedParents`（不塞进 `sessions`，否则破坏 `hasMore`/offset 算术并跨页重复，第 1 轮 W1）。不做时的降级路径 = §3.5①（父不可见 → 子按根），无正确性代价。 |
| 2 | conversations 引用行是否需要父标题？ | ① 需要 ② 不需要（退化显示「派生会话」） | **①（第 1 轮 W6 + P8 使处方落地）**：`getSessionById` 不过滤 `isArchived`（`sessions.db.ts:631-644`），按去重后的父 id **批量**解析即可覆盖「父已归档」，不再是必然退化场景。P1 可先只显示「派生会话」，P2 补 `parentTitle`。 |
| 3 | 子会话的 pin 语义？ | ① 同级排序（复用比较器）② 隐藏 pin 入口 | **①**（A2）。零特判、语义自洽。②更省代码但少功能，二选一。 |
| 4 | 是否要区分关系种类（派生 / 审阅）？ | ① 不做，字段只表达「归属」 ② 加 `relation_kind` | **①**。用户未要求区分；加枚举属过度设计（YAGNI）。将来确有需要再加列。 |
| 5 | 拖拽是否支持「拖到另一个子会话上交换父」？ | ① 不支持 ② 支持 | **①**。落点保持两条（根级行 / 空白），实现和心智都更简单。 |
| 6 | 父被归档时，子行是否提示「父已归档」？ | ① 不提示 ② 提示 | **①**。子已升为根；虽然 P8 使归档父标题可解析，MVP 仍不做额外状态提示。 |
| 7 | 「归到…」选择器是否包含「已是他人子」的会话作为可选父？ | ① 不包含（只能挂到根级会话下） ② 包含 | **①**。与 D4「一层」一致；包含会立即违反校验。 |
| 8 | 「归档父 + 活跃子」时，「归到…」候选是否列出归档父？ | ① 列出（需查归档区） ② 不列出 | **倾向②（产品问题，第 1 轮 P6 提出）**。候选默认是「同项目活跃根会话」；支持挂回归档父需额外查归档区。MVP 先②，与 §3.5② 一致。 |

---

## 5. 改动清单与实施顺序

按依赖排序，P1 为可交付主功能。

**P1 — 字段 + 接口 + 项目视图树 + 菜单**

后端：

1. `server/modules/database/schema.ts` — sessions DDL 加 `parent_session_id TEXT`。
2. `server/modules/database/migrations.ts` — 加列 + `idx_sessions_parent`。
3. `server/modules/database/repositories/sessions.db.ts` — `SessionRow`、`SESSION_ROW_COLUMNS` 加列；新增 `updateSessionParent`（**不动时间戳**）、`orphanChildSessions`（+ 若需 `countChildrenOf`）；**把孤儿化下沉到 `deleteSessionById` 与 `deleteSessionByProviderSessionId` 共用的删行 helper（同一事务，先 UPDATE 再 DELETE）**（第 1 轮 P1）。
4. `server/modules/providers/services/sessions.service.ts` — 新增 `setSessionParent`（**同步、无 await**，含全部校验）；`getSessionDetailsById` / `listRecentSessions` 投影补 `parentSessionId`；最近流补 `parentTitle`（批量用 `getSessionById`）。永久删除分支**无需改**（已在仓储层收口）。
5. `server/modules/projects/services/projects-with-sessions-fetch.service.ts` — `SessionSummary` / `SessionRepositoryRow` / `mapSessionRowToSummary` 补 `parentSessionId`。（`referencedParents` **不在 P1**——Q1 已延后，见 §4 Q1 / P3。）
6. `server/modules/providers/provider.routes.ts` — `parseSessionParent` + `PUT /sessions/:sessionId/parent`。
7. `server/modules/websocket/services/session-upsert-broadcast.service.ts` + `server/shared/types.ts` — 事件 `session` 加 `parentSessionId`；`setSessionParent` 后广播 `metadata`。

前端：

8. `src/shared/types.ts` — `ProjectSession` 加 `parentSessionId`。
9. `src/shared/api.ts` — `setSessionParent`。
10. `src/modules/sidebar/utils/sidebarProjectFormatting.ts` — 新增分组派生**独立纯函数**（不改 `getAllSessions` 返回结构；缓存按 project+搜索词组合键）（第 1 轮 W2）。
11. `src/modules/sidebar/SidebarProjectSessions.tsx` — 渲染循环改「根 + 子」，缩进 + 连接线（`:180`、`:243-269`）。
12. `src/modules/sidebar/SidebarSessionItem.tsx` — 子行缩进样式，compact/desktop 两分支。
13. 菜单入口（**共 5 处**，第 1 轮 P2）：`SessionOptions.tsx:168-207`（桌面）、`SidebarSessionItem.tsx:207-360`（compact bottom sheet）、`SidebarRecentConversations.tsx:466-517` 与 `:328-390`、`SidebarContent.tsx:114-172`/`:516+`。建议**先抽一个共享菜单项构造器**再加「归到…/移出」；选择器放 `src/modules/sidebar/modals/SessionParentPicker.tsx`（第 1 轮 P11：按前端规范 `modals/` 存放，不沿用 `SidebarModals.tsx` 的既有反例，也不顺带重构存量）。**实现结果：落地 4 处（前 4 个），第 5 处收敛为后续可选增强（需求方 2026-10-14 拍板）—— 见文末「作者动作：P1 实现落地」与 §6。**
14. `src/modules/project-workspace/hooks/useProjectsState.ts` — **overlay 乐观态** `optimisticParents`（不重建 `project.sessions`）；websocket 事件消费 `parentSessionId`；400 时回滚 overlay + 可见错误（第 1 轮 P7、W10）。
15. i18n：只补 **`src/modules/i18n/locales/en/sidebar.json` 的 `sessions.*`**（其余语言自动回落 en，`config.ts:361`）；zh-CN 可选（第 1 轮 P4，修正原「仅 en + zh-CN 全量维护」的错误依据与落点——实测 en 为超集）。

测试（与实现同步）：

16. `server/modules/providers/tests/` — `setSessionParent` 校验矩阵（自引用/跨项目/父已有父/自己已有子/成功/移出/**并发双写不落环**，第 1 轮 W4）；路由解析用例（严格类型、`null` vs 缺字段）；**删行路径的孤儿化断言**（覆盖 `deleteSessionById`、`deleteSessionByProviderSessionId`、`pruneOrphanedSessions`，第 1 轮 P1）。
17. `server/modules/projects/tests/` — 项目会话投影带 `parentSessionId`。
18. `src/modules/sidebar/tests/`（或 `src/shared/tests/` 视落点）— 分组派生：正常父子、父缺失→根、父是子→不嵌套、pin 同级、搜索过滤后分组、**引用行点击三态**；乐观 overlay 的**回滚**用例（第 1 轮 W10）。

**P2 — conversations 引用行 + 父标题**

19. `sessions.service.ts` `listRecentSessions` 补 `parentTitle`；前端 `SidebarRecentConversations.tsx` 渲染「↳ 派生自 …」；`RecentConversationListItem` 类型补字段。**实现结果：已完成（commit `88e0777c`）**——见文末「作者动作：P2 实现落地」与 §6。

**P3 — 桌面拖拽 + 按需的 `referencedParents`**

20. 侧边栏 DnD（draggable 手柄、drop 落点、manage 模式禁用）；移动端继续用菜单。**实现结果：已完成**——源码落点见「作者动作：P3 实现落地」与 §6。**落地时改了两点**：拖拽源不用独立手柄，改为**按住整行拖动**（原设计的手柄会在 hover 时让内容右移，且拖拽快照太小看不出拖成功）；反馈改为**源行变淡 + 目标行高亮环**，hover 无任何变化。
21. **仅当出现「单项目活跃会话 > 20」或观察到根级孤儿子**时：项目视图加**独立字段** `referencedParents: SessionSummary[]`（不并入 `sessions`）+ 客户端按 id 去重并入渲染集合，配套断言 `sessions/total/hasMore` 不变（§4 Q1、§1 V1）。

---

## 6. 验收清单（DoD）

状态以本文件末尾「作者动作：P1 实现落地」一节的同环境对照数据为准（`[x]` 已达成、`[d]` 有意延后）。

- [x] 项目视图：把 B 拖/挂到 A 下后，B 缩进显示在 A 下方，连接线可见；点 B 仍能正常打开会话。（菜单「归到…」与桌面拖拽两条路径均已达成：拖拽源 = **整行** `SidebarSessionItem.tsx:183-195`（`draggable` 见 `:502`），拖拽落点 `SidebarProjectSessions.tsx:190-226`，渲染落点 `SidebarProjectSessions.tsx:278-290`）
- [x] 一层约束：无法把已有子的 A 挂到别的会话下；无法把已有父的 B 变成父。（服务端 `setSessionParent` 400 + UI 侧对「拥有子会话的行」隐藏入口）
- [x] 同项目约束：跨项目设父被服务端拒绝（400），且前端乐观态回滚 + 可见错误（第 1 轮 W10）。
- [x] **「归到/移出」后子会话的时间序位置不变**（未被顶到项目顶部，`lastActivity` 未变，第 1 轮 P3）。（`updateSessionParent` 不动时间戳；`sessions.service.test.ts:590-592` 断言）
- [x] 「移出」后 B 回到根级，位置按时间序。
- [x] 分页边界：父未加载时，子按根渲染且不报错（P1 不做「带出父行」，此为预期行为；若 P3 采纳 Q1，则须补「父行随**独立字段**带出、树正确、『加载更多』不重复出图、offset 推进不受额外行影响」，第 1 轮 W1）。（分组纯函数对「父不在列表」统一降级为根，5 种成因合并为一条用例）
- [x] 归档父 → 子仍在活跃列表（按根）；恢复父 → 树复原；归档区不显示归属（第 1 轮 P6）。（归档不清 `parent_session_id`；父离开活跃列表即按根，规则天然成立）
- [x] 永久删除父 → 子成为根（DB `parent_session_id` 为 NULL）；**父被 `pruneOrphanedSessions` 自动清理时同样不悬垂**（第 1 轮 P1）。（孤儿化下沉到共享删行 helper，两条删除路径 + prune 全覆盖并有用例）
- [x] pin 子会话 → 只在 A 的子列表内上移，不脱离 A。（分组在 pin 分区之后进行，子序独立于根序）
- [x] 搜索（projects + conversations）：projects 父命中子未命中 → 只显示父、子命中父未命中 → 子按根；conversations 引用行不参与匹配、父被过滤时退化为不可点纯文本（第 1 轮 W7）。（分组输入是**已过滤**列表，故「父被过滤 → 子按根」自动成立）
- [x] fork 一个挂在 A 下的 B → 新会话 B′ 是**根级**，不在 A 下（第 1 轮 P5）。（fork 的 INSERT 为显式列清单，天然取 NULL，未改动）
- [x] websocket：一端改父子关系，另一端在**不刷新**的情况下树随之更新。（`session_upserted` 事件带 `parentSessionId`，`upsertSessionIntoProject` 展开整行 + `serialize` 比对，无需额外改动）
- [x] 多端不出现重复行或错位（`upsertSessionIntoProject` 正常合并）。
- [x] conversations 视图：子会话显示「↳ 派生自 …」引用行（父已删时不可点），时间序与分页不受影响。（P2 已完成：服务端 `listRecentSessions` 补 `parentTitle`，前端在标题下渲染引用行；父存在→可点开该父会话，父标题解析不到（已删）→纯文本「派生会话」。详见「作者动作：P2 实现落地」）
- [x] 移动端：**4 处稳定会话行**（项目视图桌面 `SessionOptions` + 移动 compact bottom sheet、conversations 桌面 `ActionMenu` + 移动 bottom sheet）均提供「归到…/移出」，无拖拽不报错（第 1 轮 P2）。（需求方 2026-10-14 拍板：入口范围由「5 处」收敛为「4 处稳定会话行」，覆盖审阅 P2「移动端一个入口都没有」的实际担忧）
- [d] 【后续可选增强，未纳入 P1】活跃搜索命中行（`SidebarContent.tsx`）加「归到…/移出」：归档变体按「归档父」一项的定义本就不显示归属；活跃命中行属**临时搜索面**，且不持有所属 project 的会话数组，须先由服务端 `findSessionTitleResults` 补 `parentSessionId`（外加客户端类型与传参）才能判定「是否拥有子会话」。
- [x] 校验：`npm run typecheck`、`npm run build`、改动文件 lint 无新增告警、相关单测通过（全量测试的既存基线失败需以改动前提交对照归因）。

## 7. 风险与回滚

- **R1 分页孤儿**（**已由 V1 探针降级为低风险/当前不可达**）：父不在已加载页 → 子树显示为根。实测当前最大活跃项目 7 会话 < 项目页 20（最近流 40 > 全局活跃 ≤20），该场景**当前不可能发生**。缓解 = §3.5①（父不可见 → 子按根，无正确性代价）；若将来项目超过一页且出现孤儿，再上「带出父行」，且**必须用独立字段** `referencedParents`（并入 `sessions` 会破坏分页算术并跨页重复，第 1 轮 W1）。
- **R2 memo 击穿**：分组缓存若与搜索链路冲突（`filterSessionsForProject` 返回不进缓存的新数组），或乐观更新重建 `project.sessions`，都会每帧重建数组 → 全树重渲。缓解 = 分组做**独立纯函数**、缓存按 project+搜索词组合键；乐观态走 **overlay**（第 1 轮 W2、P7）。
- **R3 两套布局漂移**：compact/desktop 需同步改；缩进落点是**子行变体**而非 `:180` 容器，compact 卡片是 `mx-3` 内边距形态（第 1 轮 P10）。
- **R4 pin / 搜索交互**：扁平假设散落在 `applyOptimisticSessionPinState` / `reorderRecentConversationsForPin` 等处，需逐一确认与分组后的语义一致。
- **R5 拖拽体验**：HTML5 DnD 在触屏基本不可用、可发现性低、与行链接冲突。缓解 = 菜单为基线入口、拖拽只作桌面增强。**落地时未加显式手柄**（手柄会让内容 hover 时右移，且 16px 的拖拽快照看不出拖成功），改为**整行即拖拽源**：拖拽快照是整张卡片、随光标移动，反馈为源行变淡 + 目标行亮环，hover 零变化。**2026-10-14 用真实 Chromium 点验**：按下整行 + 移动即触发行拖拽（未退化成链接 URL 拖拽），纯点击仍打开会话，⋯ 菜单按钮只触发菜单；`dragleave` 的 `relatedTarget` 可用，故「行内移动不闪高亮」的守卫成立。R5 的剩余部分（触屏不可用、可发现性）由「菜单为基线」承担。
- **R6 实时一致性**：只广播被移动会话的前提是「客户端从全量 `parentSessionId` 重新派生分组」。若实现时改成增量维护树，则需同时广播父子两行——实现时须明确走前者。**另：删除（含自动 prune）全程不广播**，其他客户端的子行会带陈旧 `parentSessionId` 直到下次 refetch，靠 A3 兜住（第 1 轮 W5/P1）。
- **R7 并发**：last-write-wins；删除×设置交错窗口内可能产生悬垂引用，靠 A3 兜住（第 1 轮 W4/P9）。
- **R8 删行路径收口不全**（第 1 轮 P1，高影响）：`parent_session_id` 悬垂不止发生在 service 永久删除——`pruneOrphanedSessions`、`assignProviderSessionId` 合并等路径都绕过它，且父被 prune 是每次刷新侧边栏都可能复现的自动行为。缓解 = §3.2.1 把孤儿化下沉到仓储删行 helper。
- **R9 菜单工作量被低估**（第 1 轮 P2）：会话操作菜单 5 处手写，现有 `SessionOptions` 只覆盖桌面一处；「加两项」实际是 5 处（含全部移动端）。缓解 = 先抽共享菜单项构造器。
- **回滚**：列为可空新增列，向后兼容。回滚前端渲染即恢复扁平列表；DB 侧保留 `parent_session_id` 数据不影响既有功能（与 `forked_from_session_id` 现状相同）。

---

## 审阅批注

### WorkBuddy · `03cf5d96-578f-4761-be2e-8d0a412ff810`

> [!CAUTION] §4 开放问题 1（**作者倾向「做」**）会破坏分页算术，且与去重未定义，风险被低估。
> 分页当前由 `readProjectSessionsPageByPath` 计算 `total = countSessionsByProjectPath`、`hasMore = offset + rows.length < total`（`projects-with-sessions-fetch.service.ts:194-202`），`getSessionsByProjectPathPage` 用 `LIMIT/OFFSET`（`sessions.db.ts:810-825`）。若「随页带出被引用的父行」把父行塞进 `sessions` 数组：
> 1. `rows.length` 可能 > `limit`，`hasMore` 与 `offset` 推进量都会算错；
> 2. 父行是更老的会话，它**必然后续出现在自己那一页**，客户端「加载更多」时会**重复出图**；
> 3. 客户端若按「返回条数」推进 offset，会被额外父行顶偏 → 漏页或重页。
> **建议**：父行走**独立字段**（如 `referencedParents: SessionSummary[]`）返回，不污染 `sessions/total/hasMore` 语义，前端按 id 去重后再并入渲染集合。若坚持塞进同一数组，必须在 DoD 里补「跨页去重 + offset 推进量不受额外行影响」的验收项，否则这条恰好在最显眼处会露馅。

> [!WARNING] §3.3「必须并入 `sortedSessionsByProject` 的 WeakMap 缓存」与现有过滤链路互相冲突，落地方式未交代。
> 该缓存只以 project 对象为键（`sidebarProjectFormatting.ts:73-106`），而搜索态走的是 `filterSessionsForProject` 的**另一条返回新数组**的分支（`:199-210`），过滤结果**不进缓存**。把分组塞进 `getAllSessions` 会连带影响 `getProjectLastActivity`（`:108-118`）与 `filterProjects`（`:176-191`）这两处仍假设「扁平有序数组」的调用方。**建议**：分组做成**独立的纯函数**（输入扁平有序数组、输出渲染行），缓存按「project 引用 + 归一化搜索词」组合键做，或干脆只对「无搜索」路径缓存，别改写 `getAllSessions` 的返回结构。R2 的表述要据实校准。

> [!WARNING] §3.3 conversations 引用行写明是「**可点的**『↳ 派生自 …』」，但没定义点击目标行为。
> 父可能未加载（分页）、已归档或被永久删除，此时「点父标题」无法定位/滚动。**建议**：明确三态——父在已加载集合→滚动高亮并可打开；父不在但存在→只打开父会话（或跳转该会话所在项目）；父已删→不可点纯文本。否则这条会变成新的空操作入口。

> [!WARNING] §3.2.2 校验与写入若非同一同步块，一层约束在并发下可被击穿成环。
> calib 校验是「父无父 且 自己不是任何人的父」，但两次并发请求（A→父B、B→父A）可各自通过校验，最终落成 `A.parent=B` 且 `B.parent=A` 的**两级环**——而前端判定「父本身不是子」会把两者都按根渲染，DB 却已脏。`better-sqlite3` 是同步 API、Node 单线程，**只要 `setSessionParent` 从校验到 `updateSessionParent` 之间没有任何 `await`，天然原子**。**建议**：把这条写进实现约束（保持同步、不要在中间穿插异步），并在测试矩阵里覆盖「并发双写」用例。

> [!IMPORTANT] 先例纠偏：广播的模板不是 `setSessionPinned`。
> `setSessionPinned`（`sessions.service.ts:345-357`）**只改字段、不广播**，前端靠乐观更新 + 重取。真正可照抄的「改元数据后广播」先例是 `forkSession`（`:506` 调 `broadcastSessionUpserted(..., 'metadata')`）。§3.2.7 与 R6 的结论（只广播被移动的那一个会话即可）成立，但要在文档里改引正确先例，并顺带确认：**删除父行时不广播子行**，客户端子行的 `parentSessionId` 会短暂陈旧——视觉上因「父已不在列表→子按根」而正确，属可接受的数据漂移，下次加载自愈；把这一点写进 R6 更完整。

> [!NOTE] §4 开放问题 2 / §3.5②：父已归档时 `parentTitle` 从哪来要定死。
> `listRecentSessions` 明确排除已归档会话与已归档项目（`sessions.db.ts:728-731`）。若 P2 走「服务端 join 父标题」，需先决定 join 是否**穿透归档**取父名；否则「父已归档」场景下 `parentTitle` 必然缺失，只能落到「派生会话」。建议把该取舍补进开放问题 2。

> [!NOTE] §3.5⑤ 搜索：conversations 视图也有搜索态，方案只覆盖了 projects。
> conversations 存在 recents 搜索模式（`SidebarRecentConversations.tsx:543`）。「派生自 <parentTitle>」行在搜索过滤下应否参与匹配、父被过滤掉时引用行如何显示，均未定义。另外 projects 侧还有「项目匹配名/路径 → 保留其全部会话」的分支（`filterSessionsForProject:205-206`），与该行「父命中子未命中→子隐藏」的规则叠加时的最终结果也没写。

> [!TIP] §3.1 若将来在 DB 层补同项目校验，注意项目删除是 `ON DELETE SET NULL` 而非级联。
> `sessions.project_path` 外键为 `ON DELETE SET NULL`（`schema.ts:160-161`），删项目不会带删会话，父子的 `project_path` 会**同时变成 NULL**。若用 `parent.project_path = child.project_path` 直接校验，NULL 比较恒为假会误判；需用 `IS` 语义。当前只在服务端按请求校验，短期无碍，但要留注释。

> [!TIP] §3.1 `idx_sessions_parent` 收益有限。
> 读路径的带出父行是按 `session_id` 主键取，唯一用到 `parent_session_id` 过滤的是 `orphanChildSessions` 与「计数子会话」。索引保留无害，但不必写进「性能必要项」；可在清单里标为可选。

> [!TIP] §5.14 乐观更新需补「失败回滚」与「用户可见错误」，当前 DoD 未覆盖。
> 跨项目/自引用等被服务端 400 拒绝时，前端乐观写入的 `parentSessionId` 必须回滚，并给出可见反馈；同时 `parseSessionParent` 除区分 `null` 与「字段缺失」外，还要拒绝非 string/non-null 的类型（仿 `parseSessionPinned` 的严格性）。建议补进 §5 测试项与 §6 验收清单。

> [!NOTE] §3.3「父本身不是子」在服务端一层强约束下恒真。
> 该条件属**防御性渲染**（防 DB 脏数据/未来扩层），保留无害；但别据此放松服务端校验（§3.2.2 与 §3.5⑥ 的强校验仍是唯一真相来源）。

### Pi

> [!CAUTION] §3.2.3 把孤儿化挂在 `deleteOrArchiveSessionById` 一处，但仓储层有 **6 条删行路径**，其中 5 条绕过它——`parent_session_id` 会持续产生悬垂引用。
> 实测删行点：`sessions.db.ts:341`（`createSession` 用 app 行替换 watcher 行）、`:387`（`assignProviderSessionId` 合并重复行）、`:449`/`:462`（`repointSessionToProviderSession` 清理被取代的行）、`:842`（`deleteSessionsByProjectPath`）、`:888`（`deleteSessionById`）、`:898`（`deleteSessionByProviderSessionId`）。只有 `:888` 的**应用删除分支**被 §3.5③ 覆盖，另外两类现实场景完全没覆盖：
> 1. **后台 prune**：`pruneOrphanedSessions`（`session-synchronizer.service.ts:36-61`）在 transcript 文件消失时直接 `deleteSessionById(sessionId)`。而 `synchronizeSessions` 由 `getProjectsWithSessions` 每次加载侧边栏都会触发（`projects-with-sessions-fetch.service.ts:225-227`）——**父会话被 prune 是自动的、静默的、每次刷新可能复现的**，子会话就此永久按根渲染，用户不会收到任何提示。
> 2. **watcher 行合并**：`assignProviderSessionId` 删掉的那条重复行，其 `session_id` 就是 provider 原生 id；侧边栏在 app 行出现前显示的正是这条行。用户若把会话挂到它下面，合并后引用即刻悬空（`:387`）。
> **建议**：把 `orphanChildSessions` 下沉到 `sessions.db.ts` 的 `deleteSessionById` 内部（同一事务内先 `UPDATE ... SET parent_session_id = NULL WHERE parent_session_id = ?` 再 `DELETE`），一次收口全部调用方；服务层的 §3.5③ 随之降级为「无需额外处理」。`:842` 那条按项目路径整批删，因 D6 父子同项目、一起被删，无需孤儿化，但要在文档里写明这一推理，避免实现者再补一遍。另外：**删除全程不广播**（`deleteOrArchiveSessionById` 内没有任何 `broadcastSessionUpserted`），所以其他客户端的子行会带着陈旧 `parentSessionId` 直到下次 refetch——视觉上靠 A3 规则兜住，但这条数据漂移应写进 §3.5③ 而非只写进 R6。

> [!WARNING] §3.4 与 §5.13 认定「菜单入口天然覆盖 projects 与 conversations 两个视图，且支持移动端」——实测有 **5 处手写菜单**，`SessionOptions.tsx:168-207` 只覆盖其中 1 处。
> `SessionOptions` 的唯一消费方是 `SidebarSessionItem` 的**桌面分支**（`SidebarSessionItem.tsx:367` `{!isCompact && (` → `:457`）。其余四处各自维护：`SidebarSessionItem.tsx:217-360` 的 compact bottom sheet（pin/rename/copy/delete 四项手写）、`SidebarRecentConversations.tsx:487-517` 的桌面 `ActionMenu items`、同文件 `:328-390` 的移动 bottom sheet、以及归档/搜索行 `SidebarContent.tsx:116-172` 的 `menuItems`。**移动端一个入口都没覆盖**，§6 的「移动端：菜单入口可用」会直接失败。**建议**：§5.13 拆成 5 个子项，或先做一个共享的菜单项构造器（参照文件头 `:42-50` 注释已经警告过的「复制 markup 导致漂移」教训——那次修的就是这个，如今 conversations 视图却又复制了一份）。这是本方案最被低估的工作量项。

> [!WARNING] §3.2.1 的 `updateSessionParent` 未规定是否触碰 `updated_at`；若照抄常规 `UPDATE ... SET updated_at = CURRENT_TIMESTAMP`，会产生三个可观察的错误。
> 排序键就是它：`getSessionsByProjectPathPage` 的 `ORDER BY datetime(COALESCE(updated_at, created_at)) DESC`（`sessions.db.ts:813-818`）、`getAllSessions` 的比较器（`sidebarProjectFormatting.ts:98`）、以及前端 `getSessionDate`。一旦触碰，**「归到…」这个纯组织性操作会让子会话瞬间跳到项目列表顶部**，且 `lastActivity`（= `updated_at`）被改写成移动时间——它同时喂给项目排序（`getProjectLastActivity`）、会话搜索的年龄显示、以及 upsert 广播的 `session.lastActivity`（`session-upsert-broadcast.service.ts:70`），污染面比想象大。仓储层对此已有明确先例与注释：「Persists the user's pin preference independently from a session's activity timestamps, so synchronizers can refresh metadata without changing it」（`sessions.db.ts:875-878`，`updateSessionIsPinned` 不动时间戳）。**建议**：`updateSessionParent` 照此办理，并在 §3.1 补一句「归属是组织元数据，与活动时间无关」，同时在 §6 加验收：「归到/移出后子会话的时间序位置不变」。

> [!WARNING] §5.15「仓库惯例仅 en + zh-CN 全量维护」与实测不符，会误导实施范围。
> 实测 15 个语言包（`src/modules/i18n/locales/`），`fallbackLng: 'en'`（`config.ts:361`），**en 是超集而非双语并置**：按嵌套 key 计 `common.json` en 321 / zh-CN 212（zh-CN 缺 109 个 en 已有的 key），`chat.json` en 34 / zh-CN 33。真实惯例是「**以 en 为唯一真源，其余语言回落 en**」，zh-CN 反而是缺得较多的一档。因此「只补 en + zh-CN」在结果上不错，但依据写错了——照字面理解会以为 zh-CN 是必须同步的第二真源。**建议**改为「只需补 en（其余语言自动回落）；zh-CN 可选」。另：会话相关文案实际住在 **`sidebar.json` 的 `sessions.*`**（`common.json` 里没有 `sessions` 段），§5.15 的路径要指名文件；且仓库大量使用 `t('sessions.foo', 'English default')` 内联默认（`SidebarSessionItem.tsx:300`、`SidebarContent.tsx:199` 等），进一步说明 en-only 完全够用。

> [!IMPORTANT] fork 与归属的关系全文未表态，而 fork 是紧挨着这两个菜单项的现成动作。
> `forkSessionById` → `createForkedSession`（`sessions.db.ts:315-360`）的 INSERT 是**显式列清单**，不含 `parent_session_id`，所以新列天然取 NULL——这一点是安全的（`createSession:300`、`createAppSession:287` 同理，都不需要改）。但语义要写死：**fork 出的会话是根级，不继承被 fork 会话的父**。否则会出现「B 挂在 A 下，fork B 得到 B′ 也是 A 的子」这种用户没要求、也没在 D1–D6 里授权的层级关系，而 §3.2.2 的服务端校验反倒会拦住用户后续把 A 挪走（A 已有子）。建议在 D2 或 §3.5 加一行，并把「fork 不继承归属」写进 §5.13 菜单项的说明文案。

> [!NOTE] §3.5② 只讨论了「父被归档」，但父与子可以落在**不同的视图**里，规则需要跨区表述。
> 归档区有两条独立数据源：`getArchivedSessions`（`sessions.db.ts:763`，扁平按项目分组，`SidebarContent.tsx:761` `groupArchivedSessionsByProject`）与归档项目视图（`readProjectSessionsIncludingArchived`，`projects-with-sessions-fetch.service.ts:175-182`，把所有会话平铺在项目卡下）。二者都不经过 `SidebarProjectSessions`，也没有 `SessionOptions` 菜单，所以方案里「归档保留关系、恢复后树自动复原」在归档区**无处可验证、也无法操作**。需明确：归档会话行不显示归属（可接受，MVP 够了），且「恢复父后树复原」只在活跃区成立。顺带一个真实场景：**归档父 + 活跃子**时，子在活跃列表按根渲染且**没有任何入口能挂回去**（菜单里的候选是「同项目活跃根会话」）；要不要在候选里列出归档父，是个需要拍板的产品问题，建议放进 §4 开放问题。

> [!TIP] §5.14 的乐观更新建议沿用仓库既有的 overlay 模式，而不是改写 `project.sessions`——这是 R2 的具体落法。
> 现有范式是 `optimisticPins: ReadonlyMap<sessionId, boolean>` + `applyOptimisticSessionPinState`（`sidebarProjectFormatting.ts:242-271`），它刻意**只在真有变化的行上换引用**，注释写明「Only projects that actually contain an overridden session are rebuilt, so untouched projects keep their identity — and with it the `sortedSessionsByProject` cache」。父字段的乐观态应当同构：单独一张 `optimisticParents` overlay，在派生分组时叠加。若图省事直接 `setProjects` 重建 `sessions` 数组，则该项目**所有**行引用全变，分组缓存击穿，`SidebarSessionItem`/`SidebarProjectItem` 的 memo 全废——恰好是 R2 想避免的结果。

> [!TIP] §4 开放问题 2 的「父已归档时 `parentTitle` 从哪来」不需要新设计，`getSessionById` 天然可用。
> `getSessionById`（`sessions.db.ts:631`）的查询**不过滤 `isArchived`**，因此父行即使已归档也能解析出标题，P2 的 `parentTitle` 只要按 `parentSessionId` 走一次 `getSessionById`（注意批量化：最近流一页 40 条，别做 N+1）即可覆盖归档场景。写进开放问题 2 的结论比留成 NOTE 更有价值——它把一个「必然退化成『派生会话』」的场景变成可用场景。

> [!NOTE] §3.5⑦ 的并发只考虑了「两端同时改父」，漏了删除与设置交错的窗口。
> `deleteOrArchiveSessionById` 在 `orphanChildSessions` 与 `deleteSessionById` 之间有 `await`（`removeFileIfExists` 循环、`deleteProviderSession`，`sessions.service.ts:962-992`）。窗口内一次 `setSessionParent` 完全可能通过「父必须存在」校验并写入，随后父行被删 → 又一条悬垂引用（渲染层靠 A3 兜住）。与 §3.5⑦ 的 last-write-wins 一致，**可接受**，但应在表里补一行「删除 × 设置交错 → 子按根渲染，靠 A3 兜底」，否则实现者会误以为这条已被覆盖。

> [!NOTE] §3.3 与 §5.12 的缩进落点需要说清，否则会在容器层误缩进根会话。
> `SidebarProjectSessions.tsx:180` 的 `ml-3 ... border-l border-border pl-3` 是**项目级**容器，所有会话行都在里面；在这里加一层 `pl-/ml-` 会把根会话一起右移。缩进必须落在 `SidebarSessionItem` 的**子行变体**上，且 compact 分支要单独处理——那里的行是自带 `p-2 mx-3` 内边距的卡片（`SidebarSessionItem.tsx:141-149`），不是无内边距的列表行，两种形态的缩进实现方式不同。这条 R3 已经提到「两套布局要同步改」，但没说清「改哪里」。

> [!NOTE] §5.13「新 modal，放在 `src/modules/sidebar/`」与前端规范的 modal 归属规则不一致。
> `frontend-module-standards` 要求：一个 feature module 含多个 modal 时放 `src/modules/<feature>/modals/`。sidebar 现有的 modal（批量归档确认、批量永久删除确认、删除确认、版本升级）全部内联在 `SidebarModals.tsx` 里，已经违反了这条规则；新增第 5 个时不要继续沿用。建议新建 `src/modules/sidebar/modals/SessionParentPicker.tsx`（只放新的，不顺带重构存量——那是与本方案无关的改动）。

### 作者响应：作者（2026-10-13，第 1 轮）

本轮全部条目**已逐条回源码核验**（结论 + 处方前提），无一条照单接受。核验结论：**无「结论错」或「前提不成立」条目**；WorkBuddy W1、Pi P1 两条属「结论对但处方需补全/修正」。核验方法见下注。

**对 WorkBuddy（`03cf5d96`）**

| # | 章节 | 一句话问题 | 作者响应 |
|---|------|-----------|----------|
| 1 | §4 Q1 | 带出父行若并入 `sessions` 会破坏分页算术、跨页重复 | **采纳，修正处方**。已实测 `hasMore = offset + rows.length < total`（`projects-with-sessions-fetch.service.ts:199-204`）与客户端 `offset = countLoadedProjectSessions(project)`（`useProjectsState.ts:1537-1546`）确会被额外行顶偏，跨页重复亦成立。处方照建议改为**独立字段** `referencedParents`。§4 Q1、§3.5①、§5.5/17、§6、R1 已成套改。 |
| 2 | §3.3 | 分组并入 `sortedSessionsByProject` 缓存与搜索链路冲突 | **采纳，修正表述**。已实测 `filterSessionsForProject`（`:199-210`）返回**不进缓存的新数组**，`getProjectLastActivity`（`:108-118`）/`filterProjects`（`:176-191`）依赖扁平结构。改为：分组做**独立纯函数**、**不改 `getAllSessions` 返回结构**、缓存按 project+归一化搜索词组合键。§3.3、R2 已改。 |
| 3 | §3.3 | 引用行「可点」但未定义点击目标 | **采纳**。定义三态（在已加载集合→滚动高亮+可打开；存在但不在→直接打开父会话；已删→纯文本不可点）。§3.3、§6 已改。 |
| 4 | §3.2.2 | 校验与写入非同一同步块可并发落成环 | **采纳**。明确 `setSessionParent` 从校验到写入**全程无 `await`**；补「并发双写」测试。§3.2.2、§3.5⑦、§5.16 已改。 |
| 5 | §3.2.7 | 先例纠偏：广播模板不是 `setSessionPinned` | **采纳，已核验**。实测 `setSessionPinned`（`:346-357`）只改字段不广播，`forkSessionById:506` 才广播；改引后者。连带把「删除不广播→子行陈旧→靠 A3 兜住」写进 §3.2.7、§3.5③、R6。 |
| 6 | §4 Q2 / §3.5② | 父已归档时 `parentTitle` 来源 | **采纳**（与 Pi P8 合并）。实测 `getSessionById` 不过滤 `isArchived`（`:631-644`），批量解析即可；Q2 结论由「必然退化」改为「采纳①」。 |
| 7 | §3.5⑤ | conversations 也有搜索态，未覆盖 | **采纳**。补 conversations 搜索规则（引用行不参与匹配、父被过滤时退化为不可点纯文本）+ projects「项目名/路径命中保留全部会话」分支叠加。§3.5⑤、§6 已改。 |
| 8 | §3.1 | 未来 DB 层同项目校验的 `ON DELETE SET NULL` NULL 陷阱 | **认可**。已在 §3.1 加注释条目（当前仅服务端按请求校验，无即时影响）。 |
| 9 | §3.1 | `idx_sessions_parent` 收益有限 | **认可**。§3.1、§5 已标为可选。 |
| 10 | §5.14 | 乐观更新缺失败回滚与可见错误；解析器须严格 | **采纳**。补「400 回滚 overlay + 可见错误」与 `parseSessionParent` 严格类型。§3.2.6、§3.3、§5.14、§5.16、§6 已改。 |
| 11 | §3.3 | 「父本身不是子」在服务端强约束下恒真 | **认可**。保留为防御性渲染；明确不据此放宽服务端校验。 |

**对 Pi**

| # | 章节 | 一句话问题 | 作者响应 |
|---|------|-----------|----------|
| 1 | §3.2.3 | 孤儿化只挂 service，5 条删行路径绕过 → 悬垂引用 | **采纳，修订处方**。已实测 6 个删行点，且 `pruneOrphanedSessions`（`session-synchronizer.service.ts:56`）由 `getProjectsWithSessions` 每次加载触发（`:229-231`），父被 prune 是自动/静默/可复现。**处方修正**：原议「下沉到 `deleteSessionById` 一次收口全部调用方」不完整——`deleteSessionByProviderSessionId`（`:898`）是独立函数、不经 `deleteSessionById`，须一并覆盖；改为抽**共用删行 helper** 由二者调用（同一事务先 UPDATE 再 DELETE）；`deleteSessionsByProjectPath`（`:842`）按 D6 无需。§3.2.1、§3.5③、§5.3、R8 已成套改。 |
| 2 | §3.4 | 菜单认定「覆盖两视图+移动端」，实测只覆盖 1/5 处 | **采纳，已核验**。实测 `SessionOptions` 仅由 `SidebarSessionItem.tsx:457`（桌面分支）消费，另有 4 处手写（见 §1 补充事实）。§3.4、§5.13、§6、R9 已改；实施建议先抽共享菜单项构造器。 |
| 3 | §3.2.1 | `updateSessionParent` 不得触碰 `updated_at` | **采纳，已核验**。实测 `updateSessionIsPinned:875-886` 的注释与实现。§3.1、§3.2.1、§5.3、§6 已改。 |
| 4 | §5.15 | i18n「仅 en+zh-CN」依据与落点均错 | **采纳，修正依据**。实测 en 为超集（common en 321 / zh-CN 212），`sessionOptions` 在 `sidebar.json`。§5.15 改为「补 `en/sidebar.json` 的 `sessions.*`，zh-CN 可选」。 |
| 5 | §3.5 | fork 与归属关系未表态 | **采纳**。新增 D7 + §3.5⑧；实测 `createForkedSession`（`:315-360`）INSERT 为显式列清单，新列天然 NULL。 |
| 6 | §3.5② | 归档区无入口，跨视图规则未表述 | **采纳**。§3.5② 补「归档区不显示归属、恢复只在活跃区成立」；新增开放问题 8（归档父是否入选择器候选）。 |
| 7 | §5.14 | 乐观更新应走 overlay 而非重建 `sessions` | **采纳**。§3.3 新增「乐观更新」段（`optimisticParents` overlay），R2 据此校准。 |
| 8 | §4 Q2 | `parentTitle` 用 `getSessionById` 可覆盖归档，无需新设计 | **采纳**（与 W6 合并）。升为 Q2 结论，注明批量避 N+1。 |
| 9 | §3.5⑦ | 并发漏了删除×设置交错窗口 | **采纳**。§3.5⑦ 补②「删除×设置交错 → 靠 A3 兜底」。 |
| 10 | §3.3/§5.12 | 缩进落点须说清，否则误缩进根会话 | **采纳，已核验**。实测 `:180` 为项目级容器、compact 卡片为 `p-2 mx-3` 形态（`SidebarSessionItem.tsx:140-149`）。§3.3、R3 已改。 |
| 11 | §5.13 | 新 modal 应放 `modals/` | **采纳**。选择器落 `src/modules/sidebar/modals/SessionParentPicker.tsx`，不顺带重构存量。 |

**核验方法（可复核）**：回源码逐条对照——分页算术与 offset（`projects-with-sessions-fetch.service.ts:199-204`、`useProjectsState.ts:1537-1546`）；删行路径与 prune（`sessions.db.ts:842/888/898`、`session-synchronizer.service.ts:56`）；广播先例（`sessions.service.ts:346-357` vs `:506`）；时间戳（`sessions.db.ts:875-886`）；`getSessionById`（`:631-644`）；i18n 用 `node -e` 实测扁平 key 计数。

**本轮成套修订**：§1（新增「审阅轮补充事实」块）、§2（D7、A3 校准）、§3.1/§3.2/§3.3/§3.4/§3.5（多条目 + 新增⑧）、§4（Q1/Q2/Q6 改判 + 新增 Q8）、§5（项 3/4/5/13/14/15/16/17/18）、§6（新增 7 项、改写 2 项）、§7（R1/R2/R6 改写 + 新增 R8/R9）、状态行。原 §3.5③ 与 §4 Q1 的具体表述已按本轮结论重写，以本节为准。

### 作者动作：作者（2026-10-13，V1 探针 → Q1 改判）

对 §1 唯一未决的设计假设 V1（「派生/审阅会话通常比父新」）用真实数据点验，并据结果改判 §4 Q1。

- **探针**：只读连接 `~/.cloudcli/auth.db` 及同目录 4 个时间点备份（脚本用 `better-sqlite3` readonly，未写任何数据）。以 `forked_from_session_id` 作为「派生」的现成信号，按仓库真实排序键（`updated_at`，`sessions.db.ts:813-818`/`:738-741`）对比子/父次序与「子在第 1 页、父在第 2 页」的比例。
- **结果**：当前库 6 会话/0 fork；最大备份 20 会话/0 fork；唯一含 fork 的备份 14 会话/**1 fork**（且该 fork 因插入时 `CURRENT_TIMESTAMP` 必然「更新」，`sessions.db.ts:344-345`）。**合计 n=1 → V1 不可证**；且 fork 机制在原理上就测不了 V1（详见 §1）。
- **次要发现（决策相关）**：V1 成立的场景（分页孤儿）**当前不可达**——项目页 20 / 最近流 40 vs 最大活跃项目 7 / 全局活跃 ≤20。故全部历史都在第 1 页内。
- **改判**：§4 Q1 从「P1 做（独立字段 `referencedParents`）」**下调为 P3、仅按需做**，并写明显式再触发条件（单项目活跃会话 > 20 或观察到孤儿子）。§1（V1 块重写）、§3.5①、§4 Q1、§5.5/17（移出 P1、P3 新增项 21）、§6（分页边界项）、§7 R1（高影响 → 当前不可达/低风险）已成套改。
- **未采纳**：不引入「链接时埋点采集 V1」——V1 的唯一消费者是 Q1，而 Q1 的再触发条件（项目超过页面大小）可直接观察，埋点属额外代码（YAGNI）。若将来需要数据，最小做法是在 `setSessionParent` 成功分支加一行结构化日志（子/父 `updated_at`、各自在项目内的 rank、项目总数），不落库。

---

### 作者动作：作者（2026-10-14，P1 实现落地）

P1（字段 + 接口 + 项目视图树 + 菜单）和后端测试已实现并**本地提交**（未 push），按依赖拆 8 个 commit：`b121372c` 后端 → `3829bcfb` 后端测试 → `f2a9870c` 前端类型/API/分组/缩进树 → `5d45f468` 前端乐观态/选择器/菜单/i18n/测试 → `643218a3` 抽共享菜单项 + conversations 两处入口 → `ecd82def` 路由与回滚测试（文档三笔在此前：`ee8f9d60`/`029fac55`/`2affa609`）。

**与方案的偏离（4 处，均已在 §6 标注）**

1. **乐观 overlay 落在 `useSidebarController`，不在 §5.14 写的 `useProjectsState`**。它做成独立纯函数 `applyOptimisticSessionParentState`，与既有 `optimisticPinBySessionId` **同址同型**（`null` 是真实覆盖，按 `has()` 而非真值判定），只重建承载该会话的那个 project 对象。改 `useProjectsState` 会牵动 websocket 合并路径，收益为零，故不动。
2. **回滚改为「丢弃 overlay + 静默刷新 + 可见错误」，未新增 websocket 事件消费**。`upsertSessionIntoProject` 展开整行 `...event.session`，`parentSessionId` 随 `SessionUpsertedEvent` 自动生效，无需改前端合并逻辑（§6 的 websocket 项即由此达成）。
3. **菜单入口落地 4 处，第 5 处收敛为后续可选增强**（需求方 2026-10-14 拍板，详见下条）。
4. **共享菜单项构造器只覆盖新增的两行**：抽了 `buildSessionOwnershipMenuItems`（`ActionMenu` 项）与 `SessionOwnershipSheetActions`（移动 sheet 按钮），**不顺带重构**存量 5 处菜单的 pin/rename/copy/delete。审阅 P2 的诉求是「别把新行复制 5 份」，这个做法满足该诉求且把回归面压到最小。

**第 5 处入口（`SidebarContent.tsx` 搜索命中行）：已由需求方拍板，收敛为后续可选增强（2026-10-14）**

- 归档变体**本就不该有归属入口**（§6「归档区不显示归属」），所以真正待定的是**活跃**搜索命中行的变体。
- 活跃命中行是**临时搜索面**，不是侧边栏的稳定会话列表；且它不持有所属 project 的会话数组，要再穿一层「是否拥有子会话」才能决定是否显示入口。
- 成本不在 UI（共享构造器已在，约 4 行），而在服务端 `findSessionTitleResults` 的投影要补 `parentSessionId` + 客户端类型 + 传参。
- 审阅 P2 的实际担忧是「**移动端一个入口都没有**」，本轮已由项目视图 compact sheet 与 conversations 移动 sheet 覆盖。
- **结论（需求方已采纳）**：§6 该项由「5 处」收敛为「**4 处稳定会话行**」（`[x]`），活跃搜索命中行单列为**后续可选增强**（`[d]`）。若将来要做，最小改动 = 服务端 `findSessionTitleResults` 补 `parentSessionId` 投影，其余复用现有共享构造器。

**验证（同环境对照，非跨 worktree）**

对照点 = 本功能首个 commit 的父提交 **`4cf48ba1`**，在其上 `git switch --detach` 于**同一仓库目录**复跑，再切回 `cloudcli-dev`。数字：

| 检查 | 基线 `4cf48ba1` | 本功能 HEAD | 结论 |
| --- | --- | --- | --- |
| `npm run typecheck` | 通过 | 通过 | 无新增 |
| `npm run build` | 通过 | 通过 | 无新增 |
| `npm test`（server） | 1436 例 / **9 失败** | 1446 例 / **9 失败** | +10 例全通过，**失败集合逐条一致**（`diff` 为空） |
| `npm run test:client` | 1666 例 / **36 失败** | 1681 例 / **35 失败** | +15 例；失败**少 1 例**（基线多出的那条是抖动的 `tokens refreshed…remount`） |
| `npm run lint` | 169 warning + 1 error | 170 warning + 1 error | +1 = 新增 context 文件触发 `react(only-export-components)`（仓库既有 25 处同类）；error 为既有 `openclaw-acp-mock.mjs` fixture |

**复跑者必读的坑（本轮踩过，约为 40 例假失败）**

server 全量测试**不会**自建库，而是经默认连接读**本机真实** `~/.cloudcli/auth.db`。该库结构停留在「上次启动过 server」的状态，因此**只在改了 `sessions` 表结构、又没迁移它**时，会出现约 40 例与改动无关的失败（`omp-runtime`/`pi-runtime`/claude-sdk/workbuddy/`claude-cli-path`），错误一律 `SQLITE_ERROR: no such column: parent_session_id`。这不是本次改动引入的缺陷：迁移该库后失败数即回落到基线的 9 例（已用「只读迁移副本」与「就地迁移」两次独立验证）。**复跑对照必须先迁移本机库**，且**不要并行**跑两套全量 server 测试（这些用例 spawn 子进程，互抢会把 18s 拖到 5min+ 并推高失败数）。

**仍待办**

- ~~P3：桌面拖拽（§5.20）~~ → **已完成**（见下方「作者动作：P3 实现落地」）。
- `referencedParents`（§5.21）仅在 §4 Q1 的再触发条件成立时做。
- i18n zh-CN 未做（按 §5.15 结论可选，en 为唯一真源）。

---

### 作者动作：作者（2026-10-14，P2 实现落地）

P2（conversations 引用行 + 父标题）已实现并**本地提交**（未 push）：`88e0777c`。

**做了什么**

1. **服务端**：`listRecentSessions` 在既有 `parentSessionId` 之外补 `parentTitle`。按**去重后的父 id** 走 `getSessionById` 解析（该查询不过滤 `isArchived`，故归档父也能解析），避免按行 N+1（一页 40 条）；父已永久删除时返回 `null`。`RecentSessionListItem` 补字段。路由 `/sessions/recent` 原样转发 `page`，无需改。
2. **前端**：`RecentConversationRow` 在标题下挂一行「↳ 派生自 `<parentTitle>`」。父存在（本页、离页或已归档）→ **可点**，跳到该父会话；父标题解析不到（已删）→ **纯文本「派生会话」**，不留死入口。点击优先用**本页父行自身**的 `projectId`/`provider`（父在本页时身份最准），父离页时回落到本行的 `projectId`/`provider`，由 workspace 按 id 从服务端解析真实元数据。
3. **i18n**：`en/sidebar.json` 补 `sessions.derivedFrom` / `sessions.derivedSessionFallback`（其余语言回落 en）。

**与方案 §3.3「点击三态」的偏离（1 处，已收敛）**

方案写的是三态：① 父在本页 →「滚动高亮并可打开」；② 父离页但存在 → 直接打开；③ 父已删 → 纯文本。实现把 ①/② **统一为「打开该父会话」**，理由：打开父会话后它即成为当前选中行，本页的行会自然显示选中态（选中样式本就绑 `selectedSession`），故「高亮」不需要额外 ref 埋点；「滚动」若父不在视口内也意义有限。③ 保持不变。这是**有意收简**，不是遗漏。

**已知边界（未做，与方案一致）**

- 搜索态：conversations 搜索（`searchFilter` ≥2 字符）走的是服务端会话标题/内容检索的独立结果面（`SidebarContent` 的 `showConversationSearch` 分支），**不是** recents 行；`SidebarRecentConversations` 自身不做标题过滤，故「父被搜索过滤掉 → 引用行退化纯文本」在当前实现下不存在需要特判的路径。`parentTitle` 也**未**并入标题检索索引，引用行不参与匹配（§3.5⑤ 的要求天然成立）。
- 不同 provider 的父：离页时前端只能给本行的 provider，交给 workspace 的 URL 解析路径（`useProjectsState` 按 `getSessionDetailsById` 回填 `__provider`）自愈。若将来实测出现可见闪烁，再考虑让服务端多带一个 `parentProvider`（当前不做，YAGNI）。

**验证（同环境对照）**

对照点 = P2 之前的提交 **`da7625cf`**（P1 收尾）。本轮改动只碰 `listRecentSessions` 与其测试、`SidebarRecentConversations.tsx` 与其新测试、`en/sidebar.json`。数字：

| 检查 | 基线 | 本功能 HEAD | 结论 |
| --- | --- | --- | --- |
| `npm run typecheck` | 通过 | 通过 | 无新增 |
| `npm run build` | 通过 | 通过 | 无新增 |
| `npm test`（server） | 1446 例 / **9 失败** | 1447 例 / **9 失败** | +1 例通过，**失败集合逐条一致**（`diff` 为空） |
| `npm run test:client` | 1681 例 / **35 失败** | 1686 例 / **35 失败** | +5 例通过，失败集合**是基线的子集**（基线多出的那条 `tokens refreshed…remount` 为抖动，本轮已通过） |
| `npm run lint` | 170 warning + 1 error | 170 warning + 1 error | **P2 新增 0 条**（相对最初基线 169 的 +1 仍只来自 P1 的新 context 文件） |

（server 全量测试读本机真实库的坑见上一节；本轮已迁移该库，故失败数落在基线 9 例。）

---

### 作者动作：作者（2026-10-14，P3 实现落地）

P3（桌面原生 HTML5 拖拽）已实现并**本地提交**（未 push），分三笔：`55b3b406`（feat 拖拽）→ `d984eccc`（fix 高亮所有权）→ `d094b25b`（feat 改「按住整行拖动」、去手柄）。

**做了什么**

1. **拖拽源 = 整行本身**。行 `<a href>` 加 `draggable={canDragSession}` 与 `onDragStart`/`onDragEnd`（`SidebarSessionItem.tsx:183-195`、`:502`），`startSessionDrag` 置 `effectAllowed='move'` 并写入**自定义 MIME**（`src/shared/constants.ts:471` `application/x-cloudcli-session` = 会话 id），Firefox 要求拖拽必须带 payload 才启动。按下左键 + 移动即起拖（原生 DnD 有移动阈值，纯点击不触发），拖拽快照就是整张卡片、随光标移动。**最初的实现用了独立 `GripVertical` 手柄，已废弃**，理由见下方「拖拽交互的二次调整」。
2. **落点规则两条**（§4 Q5 拍板「不支持拖到子行上换父」）：拖到**根级行**=收为它的子（`SidebarProjectSessions.tsx:190` `dropSessionOnRow`）；拖到列表**空白/头部**=移出（`:221` `handleListDrop`）。判定一律先验 `dataTransfer.types` 含自定义 MIME，外来拖拽（桌面文件、外链）被忽略；目标行自身不落（`:193`）。子行不是落点（`isSessionDropTarget = !parentSessionId`，`SidebarSessionItem.tsx:173`）。
3. **跨项目不可落 = 结构性保证**：拖拽态 `draggingSessionId` 持在**列表组件本地**（`SidebarProjectSessions.tsx:174`），不是全局，故另一个项目的列表根本看不到「有会话在拖」，无需额外校验。
4. **禁用面与菜单一致**：`canDragSession = canAssignParent && !isCompact && !isManaging`（`SidebarSessionItem.tsx:170`）同时决定 `draggable`；manage/batch 与 compact（以及无 picker provider）下整行不可拖，移动端继续走菜单（§5.20）。
5. **持久化复用既有路径**：落点最终调 `SessionParentPickerContext` 的 `setSessionParent`，与「归到…/移出」菜单同一写路径（`clearParent` 收敛为 `setSessionParent(id, null)`），乐观态/回滚/websocket 全部沿用，无新增后端面。

**真实浏览器点验发现的 bug 与修复（`d984eccc`）**

用真实 Chromium（Playwright，`channel: 'chrome'`）点验时发现：**Esc 取消拖拽时浏览器不派发 `dragleave`**，导致「行内瞬态高亮」残留（原实现把高亮记在目标行的局部 state，靠该行的 `dragleave` 清除）。修复 = 把高亮**所有权上移到列表**：行只上报 `onSessionDragOver(targetId)`，列表持 `dropTargetSessionId`，由 `dragend`（Esc 时确实触发，已用探针验证）、`drop`、以及容器 `dragleave`（`relatedTarget` 仍在内→不清，避免行间移动闪烁）统一清除。附带确认：载荷是自定义 MIME（未退化成链接 URL 拖拽），`dragleave.relatedTarget` 在 Chromium 可用，R5 的「不闪高亮」守卫成立。

**拖拽交互的二次调整（`d094b25b`，需求方 2026-10-14 反馈）**

初版把拖拽源做成 hover 才显形的 `GripVertical` 手柄，需求方实测提了两点：①**看不出是否拖成功**（拖拽源只有 16px，原生拖拽快照就是个小图标，几乎没有「跟随光标」的反馈）；②**为这个小功能改动了整个行的原始体验**（手柄显形靠 `group-hover`，同时给行预留了 `pl-7`，hover 时整行内容右移）。

调整 = **去掉手柄，整行即拖拽源**：

- 行 `<a>` 加 `draggable={canDragSession}` 与 `onDragStart`/`onDragEnd`，删掉手柄 `span` 与 `group-hover:pl-7`，行的外观与 hover 行为**回到从前**。
- 反馈来自「拖拽中」而非「hover」：**源行 `opacity-50` + 目标行 ring 高亮**；原生拖拽快照 = 整张卡片，跟随光标，这才回答了「是否拖成功」。
- 顺带移除了随手柄一起弃用的 i18n key `sessions.dragToFileUnder`。
- **真实 Chromium 复验**（探针 `dnd_probe5`）：按下整行 + 移动即触发行拖拽且 `dragstart` 在 `<a>` 上（快照为整行）、松手落位正常；**纯点击仍打开会话**（点击不产生 dragstart）；**⋯ 菜单按钮**（行右缘的绝对定位兄弟节点）只收到 `mousedown`/`click`，不触发行拖拽。

**与方案的偏离（1 处）**：落点维持方案的两条（未采纳「拖到子行换父」，与 §4 Q5 一致）；但**拖拽源由「显式手柄」改为「整行」**，与 §5.20 的初版措辞不同，理由见上。

**验证（同环境对照，非跨 worktree）**

对照点 = P3 之前的提交 **`4bb0c497`**（P2 收尾）。本轮改动只碰前端：`src/shared/constants.ts`、`SidebarSessionItem.tsx`、`SidebarProjectSessions.tsx`、`SidebarRecentConversations.tsx`（传参）、`Sidebar.tsx`、`SessionParentPickerContext.tsx`、`en/sidebar.json` 与两个前端测试文件；**未碰后端**，故 server 用例数不变。数字：

| 检查 | 基线 `4bb0c497` | 本功能 HEAD | 结论 |
| --- | --- | --- | --- |
| `npm run typecheck` | 通过 | 通过 | 无新增 |
| `npm run build` | 通过 | 通过 | 无新增 |
| `npm test`（server） | 1447 例 / **9 失败** | 1447 例 / **9 失败** | 用例数不变，**失败集合逐条一致**（`diff` 为空） |
| `npm run test:client` | 1686 例 / **35 失败** | 1696 例 / **35 失败** | +10 例通过；失败集合**是基线的子集**（基线多出的那条仍是抖动的 `tokens refreshed…remount`），**无新增** |
| `npm run lint` | 170 warning + 1 error | 170 warning + 1 error | **P3 新增 0 条** |

（`d094b25b` 二次调整后复验：client 为 **1698 例 / 35 失败**，失败集合与上表 P3 完全一致；server 1447 例 / 9 失败、lint 170 warning + 1 error 均不变。）

（server 全量测试读本机真实库的坑见 P1 一节；本轮未改表结构，未触发假失败。）

---

## 附录：对话记录（需求方原始答复）

> 1、用户给 B 拖定到 A 下方，就形成关联关系
> 2、新增字段
> 3、独立存活
> 4、一层
> 5、projects 和对话
> 6、约束同项目
