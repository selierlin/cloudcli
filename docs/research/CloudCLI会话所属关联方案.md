# CloudCLI 会话所属关联方案

> - 状态：**设计稿（待审阅）**，尚未动工
> - 日期：2026-10-13
> - 用途：评审「会话之间建立所属/派生关系，并在侧边栏以缩进/引用体现」的方案。审阅重点：**§4 开放问题的取舍（尤其分页父行带出、pin 语义、conversations 的表达方式）、§3.4 拖拽与菜单入口的取舍、§3.5 归档/删除的边界规则**。
> - 参考规范：`.agents/skills/backend-module-standards/SKILL.md`（`server/`）、`.agents/skills/frontend-module-standards/SKILL.md`（`src/`）

---

## 0. 一句话结论

会话之间加一个用户手动维护的**自引用归属字段**（`parent_session_id`，限一层、限同项目），后端补字段的写/读/投影与一个设置接口，前端在 **projects 视图**渲染缩进树、在 **conversations 视图**渲染「派生自」引用行。存储层已有一个同形的先例（`forked_from_session_id`）可直接照抄，**渲染缩进本身很便宜，真正的成本集中在两个入口（菜单/拖拽）与两条边界规则（父会话不在已加载页、父会话被归档）**。这两条边界一旦不处理，树会在最显眼的位置显示为「孤儿」或让活着的会话凭空消失。

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

**设计假设（待验证，非实测）**

- 假设「派生/审阅会话通常比其父会话新」。若成立，则在时间倒序 + 分页下，子会话排在上方、父会话常在未加载页——这正是 §3.5 边界规则①要处理的场景。该假设需在实现前用真实数据点验（V1）。

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

作者补充建议（需求方已认可方向，细节见 §4）：

| # | 建议 | 理由（摘要） |
|---|------|--------------|
| A1 | conversations 做**引用行**、不做缩进树 | 时间倒序 + 分页使父常在未加载页，树必然在最显眼处破碎，且会破坏该视图「全局活动流」的排序语义。 |
| A2 | pin 允许但**永不脱离父级**（同级排序） | 复用现有比较器，语义自洽，树结构稳定，无需禁用入口。 |
| A3 | **父不在可见集合 → 子按根渲染**；删除时服务端 `SET NULL`，归档不解除关系 | 一条规则同时覆盖分页未加载 / 归档 / 删除；与 D3 一致，避免活会话凭空消失；归档可逆故保留关系。 |

---

## 3. 设计

### 3.1 数据模型

- 在 `sessions` 增列 `parent_session_id TEXT`（可空，自引用，无外键约束）。
  - `schema.ts` DDL 加列（与 `forked_from_session_id` 相邻）。
  - `migrations.ts` 用 `addColumnToTableIfNotExists` 加列 + `CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id)`。
  - `sessions.db.ts`：`SessionRow` 类型、`SESSION_ROW_COLUMNS` 同步加 `parent_session_id`。
- **不加自引用外键**：sqlite 加自引用 FK 需重建表（`migrations.ts:252-397` 那种高风险的 rebuild 路径），而唯一要保证的语义（删父后子独立）用一条 `UPDATE` 即可实现（§3.5）。
- **不加子会话排序字段**：子会话沿用与根相同的比较器（pin 优先、再时间），无需新列（对应 A2）。

### 3.2 后端接口与投影（`server/modules/providers` + `server/modules/projects`）

1. 仓储（`sessions.db.ts`）新增：
   - `updateSessionParent(sessionId, parentSessionId | null)`。
   - `orphanChildSessions(parentId)`（`UPDATE sessions SET parent_session_id = NULL WHERE parent_session_id = ?`），供永久删除调用。
   - 需要时 `getSessionIdsByParent(parentId)`（校验「自己已是父」用；也可用 `count`）。
2. 服务（`sessions.service.ts`）新增 `setSessionParent(sessionId, parentSessionId | null)`，镜像 `setSessionPinned`（`:346-357`），服务端强校验：
   - 目标会话必须存在（否则 `SESSION_NOT_FOUND` / 404）。
   - `parentSessionId === null` 即「移出」，直接写。
   - 非空时：父必须存在；父 ≠ 自己；**父与子 `project_path` 相同**（D6）；**父本身没有父**（限一层，D4）；**自己当前不是任何会话的父**（不能既有父又有子）。
   - 违反任一条 → `AppError`，新增 code 如 `INVALID_SESSION_PARENT`，400。
3. `deleteOrArchiveSessionById`（`:915`）**永久删除分支**：删行前调用 `orphanChildSessions(sessionId)`；**归档分支不变**（保留关系）。
4. `getSessionDetailsById`（`:840-872`，类型 `:100-117`）与 `listRecentSessions`（`:313-343`）投影补 `parentSessionId`。最近流**另补 `parentTitle`**（父行可能不在本页，见 A1/§3.3）。
5. 项目视图投影（`projects-with-sessions-fetch.service.ts`）：`SessionSummary`（`:11-34`）、`SessionRepositoryRow`（`:36-44`）、`mapSessionRowToSummary`（`:161-173`）补 `parentSessionId`。
6. 路由（`provider.routes.ts`）新增 `PUT /api/providers/sessions/:sessionId/parent`，body `{ parentSessionId: string | null }`，解析器 `parseSessionParent`（仿 `parseSessionPinned:534-551`；注意 `null` 合法、需与「字段缺失」区分）。
7. 实时：`setSessionParent` 成功后调用 `broadcastSessionUpserted(sessionId, 'metadata')`；`buildSessionUpsertedEvent`（`session-upsert-broadcast.service.ts:26-81`）的 `session` 里补 `parentSessionId`。**只需广播被移动的那一个会话**——前端的分组是从「所有会话的 `parentSessionId`」重新派生的（§3.3），父行的「有子」状态同样是派生的，故一次事件足以让树更新。

### 3.3 前端派生与渲染

**类型与 API**

- `src/shared/types.ts`：`ProjectSession` 补 `parentSessionId?: string | null`；`RecentConversationListItem` 补 `parentSessionId?: string | null` 与 `parentTitle?: string`（两处以上文件使用，按前端规范放 shared）。
- `src/shared/api.ts`：新增 `setSessionParent(sessionId, parentSessionId | null)`（仿 `forkSession` 的写法，`api.ts:309-310`）。

**分组派生（`sidebarProjectFormatting.ts`）**

- 新增纯函数，把 `getAllSessions` 的扁平结果派生成渲染行：先按现有比较器排序，再分成「根」与「父 → 子列表」。
- 判定规则：某会话是**子**，当且仅当 `parentSessionId` 非空、且该父**出现在当前可见列表**、且该父本身不是子；否则按根渲染。此规则即 A3 的落地，**无需为归档/删除写特例**。
- **必须并入 `sortedSessionsByProject` 的 WeakMap 缓存**（`:73-83`），保持数组与对象引用稳定，否则每帧击穿 `MemoProjectItem/MemoSessionItem` 的 memo 边界。

**渲染（projects 视图）**

- `SidebarProjectSessions.tsx:243-269` 的 `sessions.map` 改为：先渲染根，根后跟其子列表。
- 缩进：在 `:180` 现有 `border-l` 基础上，子行再加一层 `pl-/ml-`；连接线用 `border-left` + 伪元素即可（纯 Tailwind，无 CSS module）。
- compact 与 desktop **两套分支都要改**（`useCompactSidebar`）。

**渲染（conversations 视图，A1）**

- 不做缩进。子会话照常按时间排在扁平流里，标题下挂一行可点的「↳ 派生自 <parentTitle>」；`parentTitle` 缺失时退化为「派生会话」。pinned/unpinned 分区与分页「加载更多」逻辑**完全不动**。

### 3.4 交互入口

- **基线入口 = 菜单**（P1）：在共用菜单 `SessionOptions.tsx:168-207` 加两项：
  - 「归到…」：弹选择器，列出**同项目、且不是自己的子**的根级会话，选中即 `setSessionParent(self, target)`。
  - 「移出」：当前会话有父时显示，调 `setSessionParent(self, null)`。
  - 菜单入口天然覆盖 projects 与 conversations 两个视图，且支持移动端。
- **桌面拖拽 = 增强**（P3，原生 HTML5 DnD，不引新依赖）：
  - 行上加拖拽手柄（避免和「点击打开会话」冲突——行本身是 `<a>`）。
  - 落点规则：拖到某个**根级会话行**上 → 设为它的子；拖到**项目头部 / 列表空白** → 移出。
  - **manage/batch 模式下禁用拖拽**；移动端不提供拖拽，继续走菜单。
  - 不支持拖到「另一个子会话」上交换父（YAGNI，落点规则保持两条）。

### 3.5 边界规则

| # | 场景 | 规则 |
|---|------|------|
| ① | **父不在当前已加载页**（分页） | 子按根渲染。是否让服务端「随页带出被引用的父行」见 §4 开放问题 1（作者倾向：做）。 |
| ② | **父被归档**（软删） | 父不再出现在活跃列表（现有查询已过滤 `isArchived=0`），子按根渲染；**关系保留**，恢复父后树自动复原（D3 + A3）。 |
| ③ | **父被永久删除** | 服务端 `orphanChildSessions` 置 NULL，子真正成为根（D3）。 |
| ④ | **pin 与树** | pin 只在同级生效：根之间按 pinned+时间；兄弟之间同一比较器。pin 永不把子拎出父下（A2）。 |
| ⑤ | **搜索** | 先过滤再分组：父未命中 → 子按根；父命中而子未命中 → 子隐藏（沿用 `filterSessionsForProject` 语义，`:199-210`）。 |
| ⑥ | **一层/同项目** | 服务端强制（§3.2），前端不依赖服务端之外的假设。 |
| ⑦ | **并发** | 两端同时改同一会话的父 → 后写覆盖（last-write-wins），可接受，不加锁。 |

---

## 4. 开放问题（附倾向）

| # | 问题 | 选项 | 倾向 |
|---|------|------|------|
| 1 | 项目视图是否「随页带出被引用的父行」？ | ① 做：分页后收集页内子会话引用的父（同项目、未归档），补查后一并返回，保证树可渲染 ② 不做：子按根渲染即可 | **①**。假设 V1 成立时，子常在上、父常在未加载页，「看起来是坏的」恰好发生在最显眼处；代价是一次额外查询，值。若验证后孤儿很少，可退回②。 |
| 2 | conversations 引用行是否需要父标题？ | ① 需要（服务端 join 父标题）② 不需要（退化显示「派生会话」） | **P1 先②、P2 补①**。①更好用但需在最近流投影里加一次父标题解析；不阻塞主功能。 |
| 3 | 子会话的 pin 语义？ | ① 同级排序（复用比较器）② 隐藏 pin 入口 | **①**（A2）。零特判、语义自洽。②更省代码但少功能，二选一。 |
| 4 | 是否要区分关系种类（派生 / 审阅）？ | ① 不做，字段只表达「归属」 ② 加 `relation_kind` | **①**。用户未要求区分；加枚举属过度设计（YAGNI）。将来确有需要再加列。 |
| 5 | 拖拽是否支持「拖到另一个子会话上交换父」？ | ① 不支持 ② 支持 | **①**。落点保持两条（根级行 / 空白），实现和心智都更简单。 |
| 6 | 父被归档时，子行是否提示「父已归档」？ | ① 不提示 ② 提示 | **①**。子已升为根，提示需额外拉归档父信息，MVP 不值。 |
| 7 | 「归到…」选择器是否包含「已是他人子」的会话作为可选父？ | ① 不包含（只能挂到根级会话下） ② 包含 | **①**。与 D4「一层」一致；包含会立即违反校验。 |

---

## 5. 改动清单与实施顺序

按依赖排序，P1 为可交付主功能。

**P1 — 字段 + 接口 + 项目视图树 + 菜单**

后端：

1. `server/modules/database/schema.ts` — sessions DDL 加 `parent_session_id TEXT`。
2. `server/modules/database/migrations.ts` — 加列 + `idx_sessions_parent`。
3. `server/modules/database/repositories/sessions.db.ts` — `SessionRow`、`SESSION_ROW_COLUMNS` 加列；新增 `updateSessionParent` / `orphanChildSessions`（+ 若需 `countChildrenOf`）。
4. `server/modules/providers/services/sessions.service.ts` — 新增 `setSessionParent`（含全部校验）；`deleteOrArchiveSessionById` 永久删除分支加 `orphanChildSessions`；`getSessionDetailsById` / `listRecentSessions` 投影补 `parentSessionId`。
5. `server/modules/projects/services/projects-with-sessions-fetch.service.ts` — `SessionSummary` / `SessionRepositoryRow` / `mapSessionRowToSummary` 补 `parentSessionId`；**开放问题 1 若采纳**，在此加「随页带出父行」。
6. `server/modules/providers/provider.routes.ts` — `parseSessionParent` + `PUT /sessions/:sessionId/parent`。
7. `server/modules/websocket/services/session-upsert-broadcast.service.ts` + `server/shared/types.ts` — 事件 `session` 加 `parentSessionId`；`setSessionParent` 后广播 `metadata`。

前端：

8. `src/shared/types.ts` — `ProjectSession` 加 `parentSessionId`。
9. `src/shared/api.ts` — `setSessionParent`。
10. `src/modules/sidebar/utils/sidebarProjectFormatting.ts` — 新增分组派生纯函数（并入 WeakMap 缓存）。
11. `src/modules/sidebar/SidebarProjectSessions.tsx` — 渲染循环改「根 + 子」，缩进 + 连接线（`:180`、`:243-269`）。
12. `src/modules/sidebar/SidebarSessionItem.tsx` — 子行缩进样式，compact/desktop 两分支。
13. `src/modules/sidebar/SessionOptions.tsx` — 「归到…」「移出」两项 + 同项目选择器（新 modal，放在 `src/modules/sidebar/`）。
14. `src/modules/project-workspace/hooks/useProjectsState.ts` — 乐观更新父字段 + websocket 事件消费 `parentSessionId`。
15. i18n：`src/modules/i18n/locales/{en,zh-CN}/...` 补菜单/选择器/引用行文案（仓库惯例仅 en + zh-CN 全量维护）。

测试（与实现同步）：

16. `server/modules/providers/tests/` — `setSessionParent` 校验矩阵（自引用/跨项目/父已有父/自己已有子/成功/移出）；路由解析用例；删除时孤儿化断言。
17. `server/modules/projects/tests/` — 项目会话投影带 `parentSessionId`（及带出父行，若采纳）。
18. `src/modules/sidebar/tests/`（或 `src/shared/tests/` 视落点）— 分组派生：正常父子、父缺失→根、父是子→不嵌套、pin 同级、搜索过滤后分组。`setSessionParent` 组件接线用例。

**P2 — conversations 引用行 + 父标题**

19. `sessions.service.ts` `listRecentSessions` 补 `parentTitle`；前端 `SidebarRecentConversations.tsx` 渲染「↳ 派生自 …」；`RecentConversationListItem` 类型补字段。

**P3 — 桌面拖拽**

20. 侧边栏 DnD（draggable 手柄、drop 落点、manage 模式禁用）；移动端继续用菜单。

---

## 6. 验收清单（DoD）

- [ ] 项目视图：把 B 拖/挂到 A 下后，B 缩进显示在 A 下方，连接线可见；点 B 仍能正常打开会话。
- [ ] 一层约束：无法把已有子的 A 挂到别的会话下；无法把已有父的 B 变成父。
- [ ] 同项目约束：跨项目设父被服务端拒绝（400）。
- [ ] 「移出」后 B 回到根级，位置按时间序。
- [ ] 分页边界：父未加载时，子按根渲染且不报错；若采纳开放问题 1，父行随页带出、树正确。
- [ ] 归档父 → 子仍在活跃列表（按根）；恢复父 → 树复原。
- [ ] 永久删除父 → 子成为根（DB `parent_session_id` 为 NULL）。
- [ ] pin 子会话 → 只在 A 的子列表内上移，不脱离 A。
- [ ] 搜索：父命中子未命中 → 只显示父；子命中父未命中 → 子按根显示。
- [ ] websocket：一端改父子关系，另一端在**不刷新**的情况下树随之更新。
- [ ] 多端不出现重复行或错位（`upsertSessionIntoProject` 正常合并）。
- [ ] conversations 视图：子会话显示「↳ 派生自 …」引用行，时间序与分页不受影响。
- [ ] 移动端：菜单入口可用，无拖拽不报错。
- [ ] 校验：`npm run typecheck`、`npm run build`、改动文件 lint 无新增告警、相关单测通过（全量测试的既存基线失败需以改动前提交对照归因）。

## 7. 风险与回滚

- **R1 分页孤儿**（高影响）：父不在已加载页 → 树在最显眼处显示为孤儿。缓解 = §4 开放问题 1 采纳「带出父行」。
- **R2 memo 击穿**：分组派生若不并入 WeakMap 缓存，每帧重建数组 → 全树重渲。缓解 = §3.3 强制并入缓存。
- **R3 两套布局漂移**：compact/desktop 需同步改，否则移动端样式错位。
- **R4 pin / 搜索交互**：扁平假设散落在 `applyOptimisticSessionPinState` / `reorderRecentConversationsForPin` 等处，需逐一确认与分组后的语义一致。
- **R5 拖拽体验**：HTML5 DnD 在触屏基本不可用、可发现性低、与行链接冲突。缓解 = 菜单为基线入口、拖拽只作桌面增强、加显式手柄。
- **R6 实时一致性**：只广播被移动会话的前提是「客户端从全量 `parentSessionId` 重新派生分组」。若实现时改成增量维护树，则需同时广播父子两行——实现时须明确走前者。
- **R7 并发**：last-write-wins，可接受。
- **回滚**：列为可空新增列，向后兼容。回滚前端渲染即恢复扁平列表；DB 侧保留 `parent_session_id` 数据不影响既有功能（与 `forked_from_session_id` 现状相同）。

---

## 审阅批注

### 审阅者：（待填）

| 章节 | 批注 | 作者响应 |
|------|------|----------|
| | | |

---

## 附录：对话记录（需求方原始答复）

> 1、用户给 B 拖定到 A 下方，就形成关联关系
> 2、新增字段
> 3、独立存活
> 4、一层
> 5、projects 和对话
> 6、约束同项目
