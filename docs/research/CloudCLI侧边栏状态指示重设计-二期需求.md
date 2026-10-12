# CloudCLI 侧边栏状态指示重设计 · 二期需求

> 状态：**需求草案 v3（2026-10-10）**，已过**两轮**审阅（一审 27 条 + 二审 11 条 = Claude 3 + CodeBuddy 8，逐条复算；一审零反驳全采纳，二审 8 成立 / 2 部分 / 1 重复、**2 条携带错误论据**，见 §9 / §11）；用户拍板项见 §6。**实施状态（2026-10-10）：批次 1（P-1 + 需求 A，含 C-3 两侧＝服务端权威重建 + 前端即时补记）✅、批次 2（2-A＝需求 D 判别位 + 内容指纹；2-B＝需求 B 未读持久化）✅，双端全绿（服务端 1301 测试仅余文档基线 9 条、前端 187 文件全绿）；批次 3（需求 C）经用户拍板不做（见 §7）。**
> 出处：一期方案 `CloudCLI侧边栏状态指示重设计方案.md` §10「二期（另立）」的 4 条要点 + §13 风险表的 2 条缺口，本文把它们展开成「问题 / 真源 / 缺口 / 选项 / 验收判据 / 前置」。
> 关系：一期（`a38128e6`）解决的是**「指示看得懂」**（形状与语义）；二期解决的是**「指示说的是真话」**（数据源与生命周期）。二期不改视觉层，只补**数据源**。
> 真源：本文所有 `文件:行号` 均于 2026-10-10 实地复算（含审阅批注提出的主张），非转述。v2 相对 v1 有 **6 处核心论断改写 + 2 处事实更正**（见 §9 汇总）。

---

## 0. 一句话：二期为什么要做

一期把「一个圆点回答三个问题」拆成了左右双通道，用户终于**看得懂**了。但一期的数据源有一条**结构性短板**：

> **所有 attention 都是前端内存态、只由实时 WebSocket 事件置位。**（§1 第 5 条「指示说谎」）

后果有两类，二期的四条需求正是针对它们：

| 症状 | 归属 | 严重度 |
|---|---|---|
| 刷新 / 换设备后，**阻塞中的权限请求无痕**（哪个会话卡着等我，看不到） | 需求 A（片 1 验收新发现） | **高**（限交互式工具）/ 低（非交互式，见下） |
| 未读（notice）刷新即清、跨设备不一致 | 需求 B（D5） | 中 |
| 会话「有过新内容」判断不准：**transcript 文件被 touch（mtime 变、内容不变）也算「新动态」** | 需求 D | 中 |
| 侧栏消息数徽标**恒不渲染**（数据源恒 0） | 需求 C | 低 |

> **严重度分档（二审 CodeBuddy 更正，已复算）**：权限等待有超时——`TOOL_APPROVAL_TIMEOUT_MS` 默认 **55000ms**（`claude-runtime.provider.js:62`），非交互工具（如 Bash）55 秒后自动 deny 并广播 `permission_cancelled`（`:1227-1230`）⇒「刷新后无痕」对它们只是 **≤55s 的短窗口**；只有 `AskUserQuestion` / `ExitPlanMode` 传 `timeoutMs: 0` **无限等待**（`TOOLS_REQUIRING_INTERACTION`，`:83`、`:1217`）⇒ 需求 A 的**高严重度仅对交互式工具成立**。§2.5 验收相应分档。
>
> **病例更正（二审 Claude，已复算）**：「改标题」**不是**假未读病例——`renameSessionById`（`sessions.service.ts:959-970`）→ `updateSessionCustomName` 只 SET `custom_name`/`name_source`（`sessions.db.ts:527-539`），**不更新 `updated_at`**，且路由**不广播** `session_upserted`（`provider.routes.ts:1123-1131`）。真实病例是**文件 mtime 变化而内容不变**的链路（见 §5.1）。

---

## 1. 全局前提：服务端缺「会话级、可批量、可持久」的状态

四条需求看起来零散，根因是**同一个**：服务端没有把「会话状态」作为可查询、可枚举的一等数据暴露出来。现状是：

| 能力 | 现状 | 位置（真源） |
|---|---|---|
| 会话元数据持久化 | 有，SQLite `sessions` 表 | `server/modules/database/schema.ts:123-157` |
| **会话的「未读 / 已读水位」** | **无**（表里没有这类列） | 同上，列清单到 `updated_at` 为止 |
| **未决审批查询** | 有，但**只能按单个 sessionId 查** | `server/modules/providers/services/provider-runtime.service.ts:118-122` |
| **「哪些会话有未决审批」的枚举** | **无独立能力**；**可由服务层组装，但只对 registry 驱动的 turn 完备**（二审 T3）——Claude 侧 `_sessionId` 可为 `null` 的 pending 对任何按-sid 查询**不可见**（§2.4） | 全仓无 `listAllPending` / 无参 `listPending` |
| **等审批的会话是否在 `/running` 集合内** | **是**（**对 registry 驱动的 turn**，可静态证实；二审 T3 限定） | `listRunningRuns()` 只取 `status === 'running'`（`chat-run-registry.service.ts:244-257`），run 仅在终态 `complete` 事件流经时翻成 `completed`（`:120-127`）——权限等待期进程未结束、无 `complete`，故必在集合内。**注意 `listRunningSessions()` 是三来源并集**：`chatRunRegistry` + `provider.listBackgroundWork` + `listBusyClaudeCliSessions`（`sessions.service.ts:187-236`） |
| 运行中会话（含后台任务） | 有，`GET /api/providers/sessions/running` | `server/modules/providers/provider.routes.ts:1017-1023` |
| `/running` 条目是否带 `projectId` / pending | **都不带** | `server/modules/providers/services/sessions.service.ts:37-46`（`RunningSessionEntry`） |
| `/running` 前端消费 | 有，**5 秒轮询** | `src/shared/context/SessionProtectionContext.tsx:172-178` |
| 权限事件的 `projectId` | **无**（只有 `sessionId` + `requestId`） | `server/modules/providers/list/claude/claude-runtime.provider.js:1204` |
| `user_preferences`（按用户、跨设备 KV） | **有** | `server/modules/database/schema.ts:245-250`（PRIMARY KEY `(user_id, preference_key)`） |
| `users` 鉴权 | 有（JWT，`users` 表） | `server/modules/auth/auth.middleware.ts` |
| **`projects` / `sessions` 的 user 维度** | **无**（数据全局共享） | `projects` DDL `schema.ts:90-97`、`sessions` DDL `:123-157` 均无 `user_id` |

**依赖关系（重要）**：

```
        ┌─────────────────────────────────────────────┐
        │ 共享前置 P-1：服务层为每个 running 会话组装   │
        │ pending（复用现成 getPendingApprovalsFor...） │
        │ + /running 补 projectId；provider 接口零变更  │
        └───────────────┬─────────────────────────────┘
                        │
          ┌─────────────┼──────────────┐
          ▼             ▼              ▼
   需求 A（action   一期片 2        需求 B（未读持久化）
   加载时重建）      （项目聚合，      —— 需要「内容级信号」，
   + C-3            同样卡 projectId） 不是 D-1 能给的
                                          ▲
                                          │
                                   需求 D（内容 vs 元数据判别）
                                   —— 只修 WS 链路
                                   ★ 需求 C 的 messageCount
                                     反而可作 B 的水位信号
```

- **P-1 一处改动，同时喂饱「需求 A」「一期片 2 的项目聚合」**（后者的 `⚠n` 与 projectId 归属同源）。**且 P-1 可缩窄为服务层组装，不动 provider 契约**（一审 CodeBuddy/CBC）：pending 全部挂在活 run 上（§2.3 已静态证实），服务层可迭代 `listRunningSessions()` 已枚举的集合、对每项调**现成的、本就 provider-neutral 的** `getPendingApprovalsForSession(sessionId)`，**无需**给 `permissions.listPending` 加无参枚举签名（那是跨 provider 契约，改它波及所有实现者与测试）。
- **⚠️ 二审 T3 修正（缩窄只对 registry 驱动的 turn 完备，非全部）**：此路仍可能漏掉 **Claude 侧 `_sessionId === null`** 的 pending（`claude-runtime.provider.js:1222`——`sessionId`/`capturedSessionId` 皆空时置 `null`，按-sid 查询恒空）。真正的完备解是**新增无参 `listAllPending()`**（provider 按自身键空间枚举）。**但批注给的「DSH 反例」经复算不成立**：`agent.module.ts:58` 注入 `runs: chatRunRegistry`，两条 `startRun`（`chat-websocket.service.ts:223`、`agent.routes.ts:1036`）进**同一 registry**，run 必在 `listRunningRuns()`；且 DSH pending 实为 `pendingPermissions`（键 `requestId`、字段 `appSessionId`，`dsh-runtime.provider.ts:400/493`），按 appSessionId 反查会命中 run。批注「run 是另一套 Map」把 **DSH 内部 `activeRuns`** 与**网关 registry** 混为一谈。
- **需求 B 的依赖被二审更正（Claude/C1）**：原文写「B 依赖 D、先 D 后 B」**不成立**——D-1 只给 **WS `session_upserted`** 加判别位，而 B 的未读重建发生在**刷新后从 `GET /api/projects` 拿 `lastActivity` 与水位比对**，**该链路完全不经过 D-1**。正确表述：**B 需要「内容级信号」**（JSONL 行数指纹 / 真实 `messageCount` / 独立 `content_updated_at`）；**D-1 只修 WS 链路**；**需求 C 的 `messageCount`（C-1）一旦落地，反而是 B 的理想水位信号**（touch 文件、改标题都不动行数）⇒ 拍板 #5 与批次排序需连带重估。

---

## 2. 需求 A：`action` 态**加载时重建**（含缺口 C-3）

### 2.1 问题

`attentionSessions` 是前端内存态，**刷新即空**（`HEAD` 亦然，非一期引入）。对 `notice` 只是少看一条动态；对 `action`（**正在阻塞的权限请求**）会让「哪个会话卡着等我」彻底无痕——与「指示说谎」同类，方向相反（**该亮不亮**）。

**⚠️ 可恢复范围的边界（二审 Claude/T7）**：pending 本身也是**服务端进程内存态**（`pendingToolApprovals` 是模块级 `new Map()`，`claude-runtime.provider.js:52`）⇒ 需求 A 的重建**只在「同一服务端进程存活窗口」内有效**：刷新页面 / 重连到同一进程可重建；**进程重启后该 pending 已无、重建不出**（该亮不亮回归，措辞须与用户确认）。且**审批入口绑定发起设备**——换设备重建出的琥珀胶囊用户**没有审批入口**（「看得见、点不了」），须在验收里写清此语义，避免制造新的误导型指示。

### 2.2 现状真源

- 按会话查未决审批：`getPendingApprovalsForSession(sessionId)` — `server/modules/providers/services/provider-runtime.service.ts:118-122`；契约 `server/modules/websocket/services/chat-websocket.service.ts:80`；`permissions.listPending(sessionId)` — `server/shared/types.ts:641-644`。
- **唯一生产调用**：`chat-websocket.service.ts:551`（在 `handleChatSubscribe` 内，**只对客户端显式给的那批 `sessions[]`**，属「订阅当前查看会话」）。
- 实现者只有两家：Claude `claude-runtime.provider.js:1690-1705`、DSH `dsh-runtime.provider.ts:526-538`。
- 权限事件 payload：`{ kind, requestId, toolName, input, sessionId, provider }`（Claude `claude-runtime.provider.js:1204`）——**有 `requestId`、有 `sessionId`，无 `projectId`**。
- 前端置位：`src/modules/project-workspace/hooks/useProjectsState.ts:503-524`（`markSessionAttention`）、`:823-836`（置位总闸）。

### 2.3 缺口

1. **无「一键列出所有未决审批」的端点** —— 所有 `listPending` 签名都强制要 `sessionId`，前端无法问「谁在等」。**但这不是硬缺口**：pending 必挂在活 run 上（§1 表末行已静态证实），服务层可沿 `listRunningSessions()` 的集合逐个调现成方法组装出来（见 §2.4 P-1 缩窄）。
2. **挂载/刷新时不重建 `action`** —— 前端只依赖 WS 事件，重连信号是**本地合成**的（`src/shared/context/WebSocketContext.tsx:87-94`），带不来历史 pending。
3. **C-3：切走当前会话时，原会话的 pending 被丢弃、不补记** —— `markSessionAttention` 对 `viewedSessionId` **直接 `return`**（`useProjectsState.ts:509-511`）；置位闸（`:824-826`）与清除闸（`:804-808`）同样带 `eventSessionId !== viewedSessionId`。后果：正看着 A 时 A 弹权限 → 不置位 → 切到 B → **A 行永远无胶囊**，直到 A 再冒一个事件。

### 2.4 方案选项

| 选项 | 做法 | 优 | 劣 |
|---|---|---|---|
| **A-1 扩 `/running`（推荐）** | 服务层为每个 running 会话组装 `pendingPermissions`，随 `/running` 下发（**旁挂字段**，见下警告）；前端在 5s 轮询里对新出现的 pending 调**「权威重建」入口**（不经「选中抑制」） | 复用已有轮询，一处改动同时服务一期片 2 与需求 B | 前端消费链有**三处手写白名单**必须同改（见下） |
| A-2 新端点 | `GET /api/providers/sessions/pending-approvals` 返回 `[{sessionId, projectId, requestId, toolName}]` | 语义干净 | 新增一条轮询通道 |

**⚠️ A-1 的四处必改（一审 CodeBuddy/CBC + 二审 T5 补第四处，漏改任一则静默失效）**：

1. **`RunningSessionEntry` 加字段**（`sessions.service.ts:37-46`）。
2. **前端消费链每一环都是手写白名单**：`SessionProtectionContext.tsx:145-162`（逐字段 `typeof` 校验）→ `SessionActivitySnapshot`（`src/shared/types.ts:241`）→ `SessionActivity`（`:188`）→ **`sessionActivitiesMatch` 是逐字段列举比较**（`useSessionProtection.ts:21-26`）。**新字段若不进这个列举**，pending 的每次变化都会被 `sessionActivityMapsMatch` 判为「与上次相同」⇒ `syncProcessingSessions` `return prev`（`:207`）⇒ **整个 map 不更新，且无任何日志**。
3. **跨 provider 通道（二审 T6 降本：不必新建 context，多传一个 prop 即可）**：轮询在 `SessionProtectionProvider`（**父级**，`ProjectWorkspaceRoute.tsx:20`），`attentionSessions` 在其子级 `ProjectsStateProvider`。但 `ProjectWorkspaceRouteContent` 就在父 provider 内部、**已调 `useSessionProtectionActions()`**（`:33`，返回 6 个动作），只是传给 `ProjectsStateProvider` 的**只有 `isSessionProcessing`**（`:43`）⇒ **多传一个 prop（如 `processingSessions`）即通**，无需新建 context、无需改 `ProjectsStateContext` 的 Pick。
4. **三个 `SessionActivity` 构造点必须各自显式带上新字段（二审 T5，本轮新增）**：`useSessionProtection.ts` 有**三处**逐字段构造 `SessionActivity`——`markSessionProcessing`（`:77-85`）、`markSessionBackground`（`:140-146`）、`syncProcessingSessions`（`:191-198`）。**若只加进 `sessionActivitiesMatch` 而不加进构造点**，`markSessionProcessing`（每次 WS `permission_request`/首帧都调，`useChatRealtimeHandlers.ts:183/387/416`）构造的 `next` 就不含该字段 ⇒ **一次 WS 事件即把轮询带来的 `pendingPermissions` 抹掉**（比第 2 条更隐蔽：不是「漏加导致不更新」，而是「加了却被 WS 路径覆盖」，且 §2.5 第 7 条验收会**假通过**）。

**⚠️ 硬约束：`pendingPermissions` 只能作旁挂字段，绝不能靠新增 `/running` 条目来表达（二审 CodeBuddy/CBC，已复算）。** 前端把每条 `/running` 折成 `SessionActivity`（`useSessionProtection.ts:180-195`），而 `isSessionProcessing = activity && !activity.background`（`:211-214`）——把等审批会话**作为新条目**并进去，会被判为**正在响应**：`canInterrupt` 默认 true ⇒ composer 出现中断按钮，侧栏活动指示全线改变；且 `LOCAL_ACTIVITY_GRACE_MS = 10_000`（`:8`、`:202`）会让权限解决后的条目不立刻消失 ⇒ 胶囊残留 10s（比 §2.5 承诺的「≤5s」差）。

**A-1 的探针问题已被静态证实（一审 CodeBuddy/CB-B，已复算）**：等审批的会话**必在 `/running` 集合内**（§1 表末行）；abort 时 `completeRun` 终止 run 的同时 `onCancel` 也清掉 pending（`claude-runtime.provider.js:146-152`），不存在「run 已出表但 pending 残留」的孤儿态。**故探针（拍板 #2）应改写为验证另一件事**：**`/running` 里那类 `canInterrupt: false` 的外部 CLI 会话**（`sessions.service.ts:216-233`，Shell 里手起的 CLI）**在 CloudCLI 运行时里没有任何 pending 条目** ⇒「在 `/running` 却 `pendingPermissions` 为空」是**正常态而非缺口**，前端重建逻辑**不得据此报错或误判**。

**⚠️ 二审 T3 追加探针项**：还需验证 **Claude 侧 `_sessionId === null` 的 pending 是否真的可达**（`claude-runtime.provider.js:1222`）。若可达，「服务层遍历 `/running` 逐个 `listPending`」会漏掉它 ⇒ 需改走**无参 `listAllPending()`**；若不可达（sessionId 在权限请求前必已 announce），则缩窄成立、**provider 契约零变更**可保留。（批注给的 **DSH 反例已复算证伪**，见 §1 修正条，勿据此加验收。）

> **✅ 探针已闭合（2026-10-10，批次 1 实施时静态读源码）**：`claude-runtime.provider.js:975` `const { sessionId } = options`；`:986` `let capturedSessionId = providerSessionId`；`:990` `sessionKey = () => sessionId || capturedSessionId || null`；`:1222` `_sessionId: sessionId || capturedSessionId || null`。**调用方传的是稳定的 app session id**（`:976-977` 注释「Callers pass the stable app session id」）⇒ 凡经网关 registry 路由的 turn，`_sessionId` **恒非 null**（`=== null` 只出现在绕过 registry 的 legacy / 直连 API 调用，**不在需求 A 的覆盖口径内**，见 §2.4 语义边界）⇒ **缩窄成立、provider 契约零变更**，**无需 `listAllPending()`**。此结论已由「未实现 `listPending` 的 provider 缺席 `pendingPermissions`」守卫（`sessions.service.test.ts`）与「外部 CLI 会话空 pending 不误报」一并钉住。

**⚠️ `/running` 的 `pendingPermissions` 字段须显式区分「不支持」与「无」（二审 T6）**：外部 CLI 会话与「未实现 `listPending` 的 provider」在 payload 上**形状相同**（都缺字段）⇒ 建议**缺席＝provider 不支持 / 空数组＝支持但当前无 pending**，否则「不误报」只能靠「不崩」而非「不误判」判定。

**⚠️ A-1 的语义边界（须写进实施注释）**：需求 A **只覆盖 CloudCLI 自己驱动（经网关路由）的 turn**。外部 CLI 会话在终端里等权限时，CloudCLI 的 `pendingToolApprovals` 里没有它们 ⇒ 只会显示 running 而非 action。**这是设计边界，不是缺陷**，别让实施者当 bug 去「修」。

**C-3 的修法（与端点无关，可独立先做）**：

- **前端即时补记**：`markSessionAttention` 命中当前会话时**不再丢弃**，而是记进**新设的** `suppressedPendingRef`；在 `handleSessionSelect`（`useProjectsState.ts:1105-1130`）切走 / `sessionId` 变化 effect（`:953-955`）时，对**原** `viewedSessionId` 补记一次 `action`。**零服务端依赖、无延迟**，但只活在本次会话内（刷新丢）。
  - **不得复用现有 `pendingPermissionRequestIdsRef`（二审 CodeBuddy/CB-D，已复算）**：记录闸（`:791-798`）**无** viewed 例外（正看会话的 `permission_request` 也进地图），而清除闸（`:804-808`）**带** `eventSessionId !== viewedSessionId` ⇒ 正看 A 时 A 的 resolved/cancelled **不清地图**。若切走时按该地图补记，会把**已解决**的权限补成假胶囊。故新 ref **必须自带 resolve/cancel 同步移除**，且补记瞬间以实时 pending 复核。
- **服务端权威重建**：随 A-1 在挂载 + 每 5s 同步时重建，**可靠、跨刷新**，但切走后最多有 **5s 延迟**。

> 两者不互斥：**推荐都做** —— 前端即时补记管「切走瞬间立刻亮」，服务端重建管「刷新/换设备也对」。
> **重建入口形态（二审 T6）**：可写成 **`rebuildAttention(sid, level)`**，与 `markSessionAttention` 平级、由 `useProjectsState` 内部持有——本质是把「viewed 闸」的判断从调用方移进函数内，比「新跨 provider 通道 + 新入口」两个新概念省一层（同构先例：`useChatRealtimeHandlers` 已在 `subscribe` 上做跨会话写入，`useProjectsState.ts:823-836`）。
> **清除口径（二审 Claude/C6）**：服务端重建出来的 action，其**清除也须走同一 5s 轮询的集合差集**（不能只挂本地 WS 事件）——否则跨设备解决权限后胶囊残留；本地事件只做加速。

> **✅ C-3 两侧均已实施（2026-10-10）**：
> - **前端即时补记**＝新设 `suppressedPendingRef`（`Map<sessionId, Set<requestId>>`，`permission_request` 命中当前会话时登记；`permission_resolved`/`permission_cancelled` **不带 viewed 例外**地实时移除，满足上面「不得复用 `pendingPermissionRequestIdsRef`」的要求）。补记落在**单个**「viewed 变化」effect 里（`previousViewedSessionIdRef` 记住上一个 viewed 会话），**同时覆盖 `handleSessionSelect` 与 `sessionId` 变化两条入口**，故未单独建 `rebuildAttention` 符号——补记直接写 `attentionSessions`，与轮询路径同形。
> - **服务端权威重建**＝`useProjectsState` 的轮询差集 effect（重建列出的、清除本通道标过而轮询不再列的）。
> - 守卫 3 条见 `src/modules/project-workspace/tests/projectsStateAttention.test.ts`（切走即时置位 / 会话内已答不复活 / 部分已答仍置位），已反向验证命中。

### 2.5 验收判据

- [ ] **（交互式工具，高优先）** 用 `AskUserQuestion` / `ExitPlanMode` 触发权限后刷新页面，会话行**直接**重建出琥珀胶囊（无需新事件）。
- [ ] **（非交互式工具，低优先）** 用 Bash 类工具触发权限后**在 55s 窗口内**刷新，胶囊重建；超过 55s 则服务端已自动 deny 并广播 `permission_cancelled`，胶囊应消失而非重建。
- [ ] 切走一个正弹权限的会话后，原会话行在约定时限内（即时方案=立即；仅服务端方案=≤5s）出现胶囊。
- [ ] 权限被解决 / 取消后胶囊消失，**且清除走 5s 轮询集合差集**（跨设备解决也清）。
- [ ] **Claude 与 DSH 两个 provider 都覆盖**；未实现 `listPending` 的 provider **不误报**。
- [ ] **外部 CLI 会话（`canInterrupt: false`）`pendingPermissions` 为空时不误报、不报错**（正常态）。
- [ ] 重建出来的 `action` 与实时事件产生的 `action` **视觉与清除行为完全一致**（不出现「两个来源各清一半」）。
- [ ] **（进程边界，T7）** 服务端进程重启后，原 pending **不重建**（该亮不亮回归，属已知口径）；「换设备重建」实为「重连同一进程的另一次渲染」，审批入口只在发起设备。

### 2.6 前置

`P-1`＝**服务层组装 pending + `/running` 旁挂 `pendingPermissions`（+ 一期片 2 的 `projectId`）**；外加 §2.4 的**四处必改**（`RunningSessionEntry` 加字段 / `sessionActivitiesMatch` 逐字段列举 / 跨 provider 通道多传一 prop / 三个 `SessionActivity` 构造点各自带上新字段）与**探针（改写后：外部 CLI 空 pending 不误报）**。**provider 契约零变更。✅ 已实施（2026-10-10，批次 1）。**

---

## 3. 需求 B：未读持久化（D5）

### 3.1 问题

`notice` 是内存态，**刷新即空、跨设备不一致**。用户一旦发现未读「会自己消失」，会整体不信任所有指示。

### 3.2 现状真源

- `sessions` 表**无** `last_seen` / `read_at` / `unread` 列（`schema.ts:123-157`），也**无 `user_id`**。
- 前端 attention 内存态：`useProjectsState.ts:412`。
- 「已查看」当前**只有内存删除**：`clearSessionAttention`（`:526-540`），调用点 `:953-955`（URL 变化 effect）、`:1105-1130`（`handleSessionSelect`）、`:1147-1149`（删除会话）。
- 会话已有 `updated_at`（`sessions` 表列），`lastActivity` 投影自它（`projects-with-sessions-fetch.service.ts:128`）。
- **`user_preferences` 是一张按 `(user_id, preference_key)` 存跨设备状态的 KV 表**（`schema.ts:243-252`），但它**不是**已读水位的同类（见 §3.4 更正）。
- **`session_drafts` 才是同类基建**：`(user_id, draft_scope)` PK、**`draft_scope` 就是 sessionId**（`schema.ts:261-271`，注释自陈「lets a message typed on a laptop be finished on a phone」），且有完整 REST 通道 `PUT/DELETE /api/user/drafts`（服务端 `user.routes.ts:65-84`、前端 `api.ts:557-560`），**一行一 scope**。

### 3.3 缺口

服务端没有「已读水位」，且**「谁算读过」在数据模型里没有落点**：会话数据全局共享（`projects`/`sessions` 无 `user_id`），而鉴权体系却是多用户的。

### 3.4 方案选项

| 选项 | 做法 | 优 | 劣 |
|---|---|---|---|
| **B-4 复用 `session_drafts` 形态（推荐，一审 CBC + 二审 T1 修正）** | 新增 `session_read_state(user_id, session_id, last_seen_at)`（`(user_id, session_id)` PK），走 drafts 那套 REST 通道（新增 `PUT/DELETE /api/user/read-state`） | **三条（二审 T1 收窄后仅剩的可验证优势）**：① 一行一 scope ⇒ 天然无整包并发覆盖；② 天然有界；③ **单键可删**（drafts 有 `DELETE /api/user/drafts` 同形）。补水：水位写入频率**低于**草稿（草稿每按键 debounce 写，水位每切会话一次） | ① 新增一张表 + 一条 REST（**但不是新范式**：与 `session_drafts` 同构）；② **「会话删除即回收」不成立**（二审 T1：`session_drafts` 只 FK 到 `users`、**无指向 `sessions` 的外键**，`deleteSessionById` 是单表删、`deleteDraft` 不在会话删除链上 ⇒ drafts 现在**就有孤儿**）⇒ 清理须**新写代码**（加复合 FK，或删会话后显式 `DELETE FROM session_read_state WHERE session_id=?`） |
| B-3 复用 `user_preferences`（原推荐，**已降级，见更正**） | 在 KV 里存 `preference_key='sidebar.unread'`、值 = `{ [sid]: lastSeen }` | 零 schema 变更 | **三处硬伤**（见下更正） |
| B-1 新增 `sessions` 列 | `sessions.last_seen_at`（全局） | 最简 | 全局列多账号互相覆盖；带 `user_id` 则引出「会话是否按用户可见」更大问题 |
| B-2 只做 action | 不做 notice 持久化 | 最小成本 | 未读仍会「说谎」 |

> **推荐 B-4。** 保留原 B-3 的立意（把「已读」这个**用户态**放进用户态表、复用既有跨设备通道），但**换掉承载表**：`session_drafts` 是同构先例，「零新范式 + 复用既有 per-user-per-scope 通道」比「零 schema 变更」更值得。

**⚠️ B-3 为何降级（二审 CodeBuddy/CBC，逐行复算）**：`user_preferences` 前端唯一通道是 `src/shared/userSettings.ts`，形态是「**启动一次性全量 hydrate + 400ms debounce 写 + localStorage 明文镜像 + 封闭键集**」，与「每切一次会话写一次」的水位不匹配。三处实测代价：

1. **hydrate 竞态会静默丢水位**：`hydrateUserPreferences` 末尾 `preferences = { ...serverPreferences, ...migrated }`（`userSettings.ts:458`）整包替换内存副本，且循环 `for (const key of Object.keys(serverPreferences)) delete pendingServerWrites[key]`（`:454-456`）删掉同键的排队写 ⇒ 登录后立刻点开会话，水位**本地没进内存、也没上服务端，且无报错**。
2. **每次写都触发全 UI 偏好树重渲染**：`notifyListeners()` → `UiPreferencesContext` 全量 dispatch；`writeUserPreference` 还用 `JSON.stringify` 全值相等比较，map 越大越贵。
3. **水位的整包读改写有并发覆盖**（二审 Claude/C4）：设备 A、B 各自 read-modify-write 同一 key ⇒ **后写者整包覆盖先写者**，刚写的水位被抹掉（假未读回潮）。

（另附：**「按 session 拆 key」也不是出路**——`UserPreferenceKey` 是 TS 联合类型、`LEGACY_STORAGE_KEYS` 要求逐键登记，键名 `sidebar.unread.<sid>` 无法静态枚举，只能绕过 `writeUserPreference` 直调 API，丢掉 debounce / 未变早退 / 镜像三项；且 `undefined` 过不了 HTTP JSON（`JSON.stringify({k:undefined})` ⇒ `{}`），**单键删不掉**，§3.6 的「不残留孤儿键」在拆 key 方案下不成立。这正是 B-4 用**独立表 + 独立 REST** 的理由：**并发安全与可删除性不必二选一**。）

**⚠️ 两条做法要点（无论选 B-3 还是 B-4）**：

- **水位写「读取时刻该会话的 `lastActivity` 快照」，不写本地 `now`（二审 Claude/C5）**：`watermark = now(本地)` 与服务端 `updated_at`（UTC）直接比较有**双向时钟偏差**（快⇒漏报、慢⇒永不自愈的假未读）。写 `lastActivity` 快照则与判据字段同源、零时钟依赖，并发新消息仍被 `>` 正确捕获。
- **水位写入时机必须覆盖「切走/关闭」，不能只在「打开」写（二审 CodeBuddy/CB-A）**：否则「查看中收到新消息 → 切走 → 刷新」这条**主路径**会系统性产生假未读（查看期间 `lastActivity` 已推进，而水位停在打开时刻）。落点＝`handleSessionSelect`（`useProjectsState.ts:1105-1130`）与 URL 变化 effect（`:953-955`）——正是现有 `clearSessionAttention` 的调用点，同位补写；App 直接关闭需 `beforeunload` 兜底，或把「上次停留的会话」在加载时视为已读。

### 3.5 依赖警示（已按二审更正）

B 的判据「`lastActivity > watermark` ⇒ 未读」**需要「内容级信号」**（二审 Claude/C1）：`lastActivity` 投影自 `updated_at`，而 `updated_at` 会被**文件 mtime（touch）**推进（§5.1 真病例），**并非只随内容更新**。

- **D-1 帮不上 B**：D-1 只给 **WS `session_upserted`** 加判别位，而 B 是刷新后走 `GET /api/projects` 比对——**该链路不经过 D-1**。原「先 D 后 B」的依赖链**错误**。
- **C-1 不能直接当 B 的水位信号（二审 T4 推翻）**：`wc -l` 行数含**四类非对话行**（Claude 解析器 `claude-sessions.provider.ts`：`progress` `:537`、`last-prompt` `:552`、`system`/`compact_boundary` `:548`、`isSidechain` 子代理行 `:544`）⇒ 压缩 / CLI 退出 / 子代理各会**假未读**；且**行数口径只对 Claude 成立**（zcode/opencode 会话存共享 SQLite、`jsonl_path` 恒 null：`zcode-session-synchronizer.provider.ts:211`、`opencode-session-synchronizer.provider.ts:245`；watcher 盯的是单文件 `db.sqlite`/`opencode.db`：`sessions-watcher.service.ts:136/128`）。
- **B 需要的是一条「内容级信号」**，选项：**独立 `content_updated_at` 列**（各 synchronizer 以与 mtime 无关的判据写入；Claude 可用「主线对话行的最大 uuid/时间戳」）；**或二审 T2 的更省路径**——把 **D-1 的判别位落成「一个可复用内容指纹」**（而非只一个 `change` 枚举值）：`synchronizeFile` 本就每次全解析（`claude-session-synchronizer.provider.ts:119`），指纹**零额外读盘成本**，可同时喂 D 的 WS 链路与 B 的刷新链，**批次 2 由三步压两步**（见 §7）。
- 若既不做内容信号、也不采指纹路径，则 B 只能接受「mtime 变即未读」的粗糙口径并如实记录。

### 3.6 验收判据

- [x] 刷新后未读还在；**换设备（同账号）后未读一致**。
- [x] 打开会话 → **本端**立即清除；**另一设备在该次拉取（hydrate / refresh）后**清除。**「另一设备不刷新时未读仍在」是已知口径、不是缺陷**——`user_preferences` / `session_drafts` 均**无服务端推送**，`hydrateUserPreferences` 只在登录时拉一次（`AuthContext.tsx:141`）。
- [x] **（主路径）查看中收到新消息 → 切走 → 刷新 → 无未读**（水位写入覆盖切走，见 §3.4）。
- [x] 文件被 touch（mtime 变、内容不变）**不**产生未读（需内容级信号）。
- [x] 两设备交替打开**不同**会话，水位互不回潮（并发，B-4 天然满足 / B-3 需事务合并）。
- [x] 会话删除 → 水位一并清理（**须新写清理代码**：`deleteSessionById` 是单表 `DELETE`，B-4 的表不会自动回收，见 §3.4 劣列）。
- [x] 水位存储体积有界。

> **批次 2-B 实施回填（2026-10-10）**
>
> - **存储通道＝B-4**：新表 `session_read_state(user_id, session_id, last_seen_at)`（`(user_id, session_id)` PK，FK→`users`），REST 走 `GET/PUT/DELETE /api/user/read-state`（sessionId 走 body，同 drafts）。仓储 `session-read-state.db.ts`。
> - **水位来源＝内容指纹，不是 `lastActivity`**：`last_seen_at` 存该会话 `content_updated_at`（§5.4 #6 / 二审 T2 的可复用指纹）在「切走/进入」时刻的快照。**这是对 §3.4 措辞「写 lastActivity 快照」的收紧**——判据字段与 §3.5 要求的内容级信号同源，因此 §3.6 第 4 条（touch 不误报）成立；`lastActivity` 仍是展示用字段，两值已在投影层分开。
> - **判据**：`isSessionUnread(sid, contentUpdatedAt) = 有水位 && contentUpdatedAt > 水位`。**两条边界（有意为之、非缺陷）**：
>   1. **无水位 ⇒ 判为已读**（升级/从未点开过的会话不刷一片未读）；
>   2. **provider 无内容指纹（`contentUpdatedAt` 为 null）⇒ 永不判未读**（宁可漏报，不猜）。当前只有 Claude 产出指纹。
> - **水位写入时机**：投影载入后按水位重建 notice（唯一跨刷新通道，`applyPersistedUnread`）；URL 变化 effect 里对「被离开」与「被进入」两个会话都用**当时最新**的 `contentUpdatedAt` 写水位（覆盖主路径 §3.6 第 3 条）。**App 直接关闭仍无 `beforeunload` 兜底**——进入时已写一次水位，故崩溃场景最多误报一次，未做额外兜底。
> - **删除清理**：`deleteSessionById` / `deleteSessionByProviderSessionId` 同步 `DELETE FROM session_read_state`；前端 `handleSessionDelete` 同步清本地。
> - **`contentUpdatedAt` 也随 WS `session_upserted` 下发**（与 2-A 的 `change` 同处），使新建会话无需重取项目列表即可写水位。
> - **守卫**：服务端 `user.service`（校验/转发）、`sessions.db`（指纹往返 + 删除清理）、`projects-with-sessions-fetch`（投影带 `contentUpdatedAt` 且与 `lastActivity` 不同值）、WS payload；前端 `sessionReadState`（判据 + 无水位 + 无指纹 + 不重复写）、`projectsStateAttention`（载入重建 / 切走写水位 / 删除清水位）。**反向验证 4 条变异全部变红并已还原**。


### 3.7 前置

**内容级信号**（独立 `content_updated_at`，或 §3.5 的「D-1 顺带产出可复用内容指纹」；**已排除「C-1 行数」作通用信号**，见 §3.5）；存储通道＝**B-4 的新表 + 新 REST**（新做，且须自带会话删除清理）或 B-3 的 `user_preferences`（已有但需处理 hydrate 竞态与并发覆盖）。

---

## 4. 需求 C：`messageCount` 计数链路

### 4.1 问题

侧栏消息数徽标**恒不渲染**——数据源全链路写死 `0`。

### 4.2 现状真源

- 前端读 `session.messageCount`：`src/shared/types.ts:91`；格式化 `src/modules/sidebar/utils/sidebarProjectFormatting.ts:17,70`；渲染条件 `messageCount > 0`：`src/modules/sidebar/SidebarSessionItem.tsx:200-202,452`。
- **硬编码 0 共三处**（二审 CodeBuddy/CB6 补第三处）：`server/modules/websocket/services/session-upsert-broadcast.service.ts:50`、`server/modules/projects/services/projects-with-sessions-fetch.service.ts:127`（`mapSessionRowToSummary`）、**以及前端乐观行 `registerOptimisticSession`（`useProjectsState.ts:629`）**。第三处是**纯本地、不上 socket 的**新建会话记录（`:637-641` 自陈），即使 C-1 落地，新会话在首次 upsert 覆盖前仍恒 0 ⇒「新会话发 N 条 → 徽标显示 N」在**乐观窗口内不成立**，实现时须同改。
- 无 DB 计数列。
- transcript = **每会话一个 JSONL、一行一条消息**，路径存 `sessions.jsonl_path`（`schema.ts:136`）。
- 已有「读全量历史」通道：`sessions.service.ts:619-721`（`fetchHistory`）+ 缓存 `sessionHistoryCache.getFullHistory`（`:668-677`）；但其中 `total` 是**归一化后的条数**，**≠ JSONL 行数**。

### 4.3 方案选项

| 选项 | 口径 | 落点 |
|---|---|---|
| **C-1 DB 列 `message_count`（若做则推荐）** | JSONL **行数** | watcher 在 transcript 变化时重算并写回；`/api/projects` 与 `session_upserted` 都读它 |
| C-2 复用归一化条数 | `fetchHistory.total` | 需为**所有**行求值（不能只算打开过的），重 |
| **C-3 不做（可接受）** | — | 一期已决定「不显示该槽」（§4 通道 C）；**若不做，只须删掉 `SidebarSessionItem` 的两处 JSX**（`:200-202` 紧凑、`:452` 常规），**不要去动** `messageCount?` 可选字段与格式化层 `Number(x \|\| 0)`（二审 CodeBuddy/CBC，避免删穿） |

> **倾向不做，或降级。** 该徽标对「用户到底想知道什么」贡献最低（侧栏已有 age、未读、活动三通道）。**⚠️ 二审 T4 修正**：C-1 的**行数口径不能作 B 的通用水位信号**（含 4 类非对话行 + 仅 Claude 成立，见 §3.5）⇒ 原「C-1 顺带反哺 B」作废，「砍」回归纯降噪取舍。
>
> **⚠️「砍」的契约连带（二审 Claude/T9）**：`messageCount` 是 `SessionUpsertedEvent.session` 的**公共必填字段**（`server/shared/types.ts:291`）⇒ 「砍」除删两处 JSX 外，须**同时决定服务端契约去留**：保留恒 0（不动跨端契约与测试快照），或从类型/广播移除（动契约 + 所有生产点）。**前端** `messageCount?` 可选字段与格式化层仍按 CBC 建议不动。

### 4.4 验收判据（若做）

- [ ] 新会话发 N 条 → 徽标显示 N（口径需先钉死：行数 or 归一化条数；**乐观行 `registerOptimisticSession` 须同改，否则首次 upsert 前恒 0**）。
- [ ] 分页 / 重连后计数**不漂移**。
- [ ] 归档 / 删除会话后计数正确清理。
- （若不做）[ ] 只删 `SidebarSessionItem` 两处 JSX；**前端** `messageCount?` 字段与格式化层不动；**服务端** `SessionUpsertedEvent.session.messageCount` 契约去留须显式决定（保留恒 0 / 移除，T9）。

---

## 5. 需求 D：`session_upserted`「假未读」治理（原「白名单收紧 + 重连去重」）

### 5.1 问题

前端对 `session_upserted` **无条件** `markSessionAttention(..., 'notice')`（`useProjectsState.ts:858`）——严格说有两道抑制（正看会话走 `setExternalMessageUpdate` 分支，且 `markSessionAttention` 内有 viewed 闸 `:509-511`），但**核心成立：它不判别「内容变化」vs「元数据刷新」**。

**真实病例（二审 Claude/C2 更正，已逐行复算）**：**transcript 文件 mtime 变化而内容不变**（touch / 外部写属性）——

```
chokidar change（usePolling:true，纯 touch 必然被抓，sessions-watcher.service.ts:280-296，只过滤 isWatcherTargetFile 不判内容）
  → synchronizeProviderFile（indexed = Boolean(sessionId)，不判内容，session-synchronizer.service.ts:154-165）
  → createSession 以文件 mtime 作 updatedAt（claude-session-synchronizer.provider.ts:124-134）
  → DB `updated_at = COALESCE(?, CURRENT_TIMESTAMP)`（sessions.db.ts:121-127）
  ⇒ 既广播 upsert（WS 假 notice）也推进 lastActivity（水位假未读）
```

> **⚠️ 原病例「改标题」作废**：`renameSessionById`（`sessions.service.ts:959-970`）→ `updateSessionCustomName` 只 SET `custom_name`/`name_source`（`sessions.db.ts:527-539`），**不更新 `updated_at`**，且路由**不广播**（`provider.routes.ts:1123-1131`）⇒ 改标题**本来就不产生**假未读，原 §5.5 用例会**空转通过**。

### 5.2 现状真源

- **唯一生产者**：`server/modules/websocket/services/session-upsert-broadcast.service.ts`（`buildSessionUpsertedEvent` `:21-64`；文件头自陈 single producer `:8-20`）。
- **三条触发路径**（二审 CodeBuddy/CBC 补第三条）：`chat-run-registry.service.ts:155`（`recordProviderSessionId`）、`sessions-watcher.service.ts:212`（磁盘 debounce flush）、**`sessions.service.ts:432`（fork）**。
- watcher 已在采集一个**粗判别信号，但 flush 时丢弃**：`PendingWatcherUpdate.changeTypes: Set<WatcherEventType>`（`sessions-watcher.service.ts:108`、`:183`）——flush 只用 `updatedSessionIds`（`:212`）。**`add` ⇒ 必是内容变化；纯 `change` ⇒ 才需进一步 diff。**
- payload **无事件 ID、无 `seq`**：`server/shared/types.ts:283-296`。
- `seq` 只分配给 **provider 消息**（`chat-run-registry.service.ts:103-135`），网关事件（`session_upserted` / `loading_progress` / `chat_subscribed` / `protocol_error`）**都没有**。
- **重连不是「重放」而是「全量重取」**：侧栏 `useProjectsState.ts:761-764` → `refreshProjectsSilently()`（`GET /api/projects`）；聊天侧 `chat.subscribe` 只重放 provider 消息（`chat-websocket.service.ts:562-570`，且仅 `isProcessing`）。
- 现有「白名单」实为**排除式名单**（默认置位）：`useProjectsState.ts:823-834`（排除 `chat_subscribed` / `loading_progress` / `session_upserted` / `status` / `stream_end` / `permission_resolved` / `permission_cancelled` / `websocket_reconnected`）。

### 5.3 缺口与**一处提法更正**

- **真缺口**：事件无法区分「**内容变化**」vs「**元数据刷新**」 ⇒ 假未读。
- **提法更正**：一期文档与 §13 风险表把它写作「**重连重放去重**」。**实测：网关事件不会被重放**（重连是全量重取），因此**「重放去重」在当前架构下不是一个真实问题**。真正的问题是**假未读**。建议本期把该条**正名为「假未读治理」**；「幂等键」作为**防御性**（应对未来引入重放 / 重复投递），而非当下的必答题。

### 5.4 方案选项

| 选项 | 做法 |
|---|---|
| **D-1 服务端加判别位（推荐）** | `buildSessionUpsertedEvent(id, change: 'content' \| 'metadata')` —— **`change` 是每条调用路径显式传入的参数**，不是 builder 内部算出来的 |
| D-2 只在内容变化时广播 | 更彻底，但 watcher 还承担「更新标题」职责，语义变化大，需拆两条事件 |
| D-3 幂等键（防御） | 事件带 `revision`（如 `session.updated_at` 或会话级单调计数），前端忽略非递增 |

> **推荐 D-1 为主、D-3 为辅。** D-3 只在真的引入重放/多次投递时才有意义，记为**防御性待办**。
>
> **收口（2026-10-10，实施后）**：**采 D-1**（已落地）。**D-3 不做**——核实后它守的是一个不可能的失效：`markSessionAttention` 按 `Map<id, level>` 构造天然幂等（`current === level` 早退），系统无计数/序号，重复投递不改任何状态；且网关不重放（见上「提法更正」）。

**⚠️ D-1 的五条落实要求（二审多来源，均已复算）**：

1. **`change` 必须逐路径显式传参（二审 CodeBuddy/CBC）**：`buildSessionUpsertedEvent(sessionIdOrProviderSessionId)` 现签名**没有**判别位（`session-upsert-broadcast.service.ts:21-24`），三条调用点各自定性——**fork 必为 `metadata`**；**`recordProviderSessionId` 恰恰是真内容**（run 首次拿到 provider id 的那一刻就是新消息刚到时，`chat-run-registry.service.ts:145-152` 自陈用途是「客户端发现行被合并」）；**watcher 那条自己算**。若只在 watcher 里 diff，另两条会静默走错（fork 误置位、`recordProviderSessionId` 该亮不亮）。
   **⚠️（Claude 二审 T8）run-registry 路径无 diff 材料**：`recordProviderSessionId`（`chat-run-registry.service.ts:155`）只做 id 赋值 + 广播、**无 transcript 快照** ⇒ 它**不能**走「与上次快照 diff」；须给出**保守缺省**（建议 `content`，因其伴随真实 run 内容）并注释留痕，或把三条生产者收拢到统一的 `buildSessionUpsertedEvent` 旁路。
2. **watcher 的 diff 判据排除 `mtime`（二审 Claude/C3）**：真实病例正是 **mtime 变、内容不变**，若 diff 参与 mtime，touch 一律被判成 `content`，D-1 对核心病例失效。判据钉死为 **行数 + 字节数**（或行数 + 末行偏移）；mtime 至多作「无需重读」的短路信号。
3. **分两步降成本（二审 CodeBuddy/CB7）**：**D-1a** 先把已采集的 `changeTypes` 透传（改动≈十行，立刻消掉「新会话 / 新文件」这一类）；**D-1b** 再对纯 `change` 做行数 + 字节 diff。
4. **重启后的 diff 基线要钉死（二审 CodeBuddy）**：chokidar `ignoreInitial: true` 且初始全量同步不广播，重启后基线为空 ⇒ 每会话首个 watcher 事件要么假 content 要么假 metadata 一次。**建议：无基线默认 `metadata`，初始同步顺带建立基线。**
5. **不要假设事件及时性**：watcher 是 `usePolling: true, interval: 6_000`（`sessions-watcher.service.ts:280-289`），事件由轮询 diff 产生，非原生即时事件。
6. **把判别位落成「可复用内容指纹」而非单一枚举值（二审 T2）**：`synchronizeFile` 本就每次全解析 transcript（`claude-session-synchronizer.provider.ts:119`），顺手产出「主线对话行最大 uuid/时间戳」这类指纹，写进 `sessions` 新列 ⇒ 同时喂 D 的 `change` 判定与**需求 B 的刷新链比对**，**批次 2 由三步压两步**（§7）。

### 5.5 验收判据

- [x] **文件被 touch（mtime 变、内容不变）→ 不产生未读、不广播 `content`**（**核心病例**，可在 watcher 同步层构造「同内容不同 mtime」fixture 断言）。
- [x] 真有新消息（transcript 追加） → 产生未读。
- [x] fork 广播按 `metadata` 处理（不置位）。
- [x] （防御）同一事件重复投递 → 只置位一次。**（无需额外实现：`markSessionAttention` 按 `Map<id, level>` 构造天然幂等——`current === level` 早退，且系统无计数/序号，"重放去重"经实测不成立，不为不可能的失效挂守卫。见 §5.2 / §7 实施后记。）**
- [x] 一期文档 / §13 风险表把「重连重放去重」正名为「假未读治理」，并注明「无重放」的实测依据。**（2026-10-10 已回写：一期文档 §6 / §10 / §12.11 正名，§13 风险表四行同步。）**

> **批次 2-A 实施回填（2026-10-10）**
>
> - **判别位**：`session_upserted.session.change: 'content' | 'metadata'`，**三条生产者逐路径显式传参**——fork＝`metadata`（`sessions.service.ts`）、run 首次拿到 provider id＝`content`（`chat-run-registry.service.ts`，保守缺省并注释）、watcher＝自算。**builder 不猜**。
> - **watcher 的 diff 判据用的是「内容指纹」而非 §5.4 #2 提议的「行数+字节数」**：按 §5.4 #6 / 二审 T2，落地为 `sessions.content_updated_at`（Claude 取主线 user/assistant 行的**最新 timestamp**，跳过 `isSidechain` 与外部 sid）。指纹**与 mtime 无关**，故核心病例（touch）天然不产生 `content`。§5.4 #2 的「行数+字节」提议**已被 #6 取代**，不再单独实施。
> - **`absent ≠ false`**：provider 无 `synchronizeFileDetailed`（9 个实现中的 8 个）⇒ `contentChanged: null` ⇒ watcher 按 `content` 处理（宁可多报不误吞）；`false` ⇒ `metadata`；`true` ⇒ `content`。接口以**可选方法**加在 `IProviderSessionSynchronizer` 上，**其余 synchronizer 零改动**。
> - **无基线默认 `metadata`**（§5.4 #4）：老数据 / 首次索引时 `content_updated_at` 为 NULL，升级不刷未读。
> - **`change` 是「内容级信号」的副产品，但它只覆盖 WS 链路**：B 的刷新链不走 WS，故 B 用的是同一张表的 `content_updated_at`（见 §3.6 回填）。
> - **第 4 / 5 条（2026-10-10 收口）**：第 4 条（重复投递幂等）**经核实由构造天然满足、不挂守卫**——`markSessionAttention` 按 `Map<id, level>` 早退（`current === level`），系统无计数/序号，重复投递不改任何状态；第 5 条（一期文档正名）**已回写**（一期文档 §6 / §10 / §12.11 正名 + §13 风险表四行同步）。
> - **守卫**：`claude-session-synchronizer`（指纹往返 + touch→metadata + 追加→content + 子代理不推进）、`sessions-watcher`（`classifyWatcherChange` 三态）、`session-upsert-broadcast`（`change` 透传 + 批内各自分类）、`projectsStateAttention`（metadata 不置 notice / content 置 notice）。**反向验证 4 条变异全部变红并已还原**。

---

## 6. 待用户拍板清单

| # | 待定 | 选项 | 建议（含二审更新） |
|---|---|---|---|
| 1 | **action 重建用哪条通道** | A-1 扩 `/running` / A-2 新端点 | **A-1**；但「零契约变更即完备」被 **T3 部分否掉**（Claude `_sessionId=null` 的 pending 对按-sid 查询不可见）⇒ 若 §2.4 探针命中，须补**无参 `listAllPending()`** |
| 2 | **外部 CLI 空 pending 不误报** | 探针仍跑，防实现走样 | 报告须记 §1 表末行推演供对照；**追加（T6）**：`pendingPermissions` 字段须**显式区分「不支持」vs「无」** |
| 3 | **C-3 补记时机** | 前端即时 / 服务端 5s / 两者 | **两者**（即时 + 可靠各管一段），无新增阻碍 |
| 4 | **D5 已读水位的落点** | **B-4 同构新表 + REST** / B-3 `user_preferences` / B-2 只做 action | **B-4**；**T1 修正**：优势缩到三条（并发安全 / 单键可删 / REST 同形），「会话删除即回收」**移入劣列**（须新写清理代码） |
| 5 | **`messageCount` 做不做** | 做（C-1 行数口径）/ 砍（只删两处 JSX） | **T4 推翻其作 B 的通用水位信号**（含非对话行 + 仅 Claude 成立）⇒ 回归「**砍**，或仅作 Claude 侧展示」；不再因 B 而保留 |
| 6 | **`projectId` 缺口**：与一期片 2 合并处理？ | 合并 / 分开 | **合并**（同源同改），无新增阻碍 |
| 7 | **upsert 判别位** | D-1 顺带产出**可复用内容指纹** / 前端指纹 | **D-1**，`change` 逐路径显式传参，**并按 T2 落成指纹**（兼喂 B） |

> **批次 1 实施回填（2026-10-10）**：#1 采 **A-1**（T3 探针已闭合为「缩窄成立」，见 §2.4）；#2 采**显式区分**（缺席＝不支持／空数组＝无——`RunningSessionEntry` 与 `SessionActivity` 的注释均写明，且「未实现 `listPending` 的 provider 缺席该字段」有守卫）；#6 **合并**（`projectId` 已随 `/running` 旁挂，`null` 表示无项目行）；#3 **两者都落**（服务端 5s 轮询权威重建 + 前端即时补记 `suppressedPendingRef`，见 §2.4）。**#4 / #5 / #7 属批次 2 / 3，本轮未动。**

> **批次 2 实施回填（2026-10-10）**：**#4 采 B-4**（新表 `session_read_state` + `GET/PUT/DELETE /api/user/read-state`，与 `session_drafts` 同构）；**#7 采 D-1 并落成指纹**（`sessions.content_updated_at`，见 §5.4 #6）。**#5（`messageCount`）属批次 3，已由用户拍板不做（2026-10-10，见 §7）**——计数链路与两处恒假渲染槽均维持现状。详细口径与两条有意边界（无水位⇒已读、无指纹⇒永不未读）见 §3.6 的实施回填。

---

## 7. 建议排序与批次

| 批次 | 内容 | 理由 |
|---|---|---|
| **批次 1** ✅ **已实施（2026-10-10）** | `P-1`（**服务层组装 pending** + `/running` 旁挂 `pendingPermissions` + `projectId`）→ **需求 A**（action 重建 + C-3） | 最痛（阻塞权限无痕）；一处改同时喂一期片 2；**provider 契约零变更**。**实施口径**：C-3 两侧都落（服务端权威重建 + 前端即时补记 `suppressedPendingRef`） |
| **批次 2** ✅ **已实施（2026-10-10）** | **需求 D**（判别位，修 WS 链路）**顺带产出可复用内容指纹** → **需求 B**（未读持久化，复用该指纹） | **T2：D 与 B 可共用一个内容指纹**（`synchronizeFile` 本就全解析）⇒ **由三步压两步**；**T4：C-1 行数不可作 B 的通用信号**，原「C-1 作现成来源」作废。**实施拆两片**：**2-A**＝需求 D（`session.change` 判别位 + `sessions.content_updated_at` 内容指纹）；**2-B**＝需求 B（`session_read_state` 表 + `/api/user/read-state` + 前端未读重建），复用 2-A 的指纹 |
| **批次 3** ⛔ **不做（2026-10-10 用户拍板）** | 需求 C 的展示槽（`messageCount`）：计数链路不做，两处恒假渲染槽也不删 | 展示价值最低；**T4：行数口径含非对话行、且仅 Claude 成立**，不足以作通用信号 ⇒ **维持现状**（属已知死槽）。 |

> **测试建议（二审 CodeBuddy/CBC-G）**：§2.5 / §3.6 / §5.5 现多为人工勾选框，但其中三条**天生可自动化**且失效模式**静默**，建议各挂一条守卫：①「重建 action 与实时 action 得同一 `attentionSessions` 值且清同一个 pending 集合」；②「同一事件重复投递只置位一次」（纯函数级）；③「同内容不同 mtime 不广播 `content`」（watcher 同步层 fixture）。
>
> **实施后记（2026-10-10）**：① 与 ③ 已挂守卫（`projectsStateAttention` 的重建/清除一致断言；`claude-session-synchronizer`＋`sessions-watcher` 的内容级 fixture）。**② 经核实无需守卫**——`markSessionAttention` 按 `Map<id, level>` 构造天然幂等（`current === level` 早退），且系统无计数/序号，重复投递不改任何状态；挂守卫＝断言一个不可能发生的失效。

---

## 8. 与一期方案 / 一期的引用关系

- 一期方案：`docs/research/CloudCLI侧边栏状态指示重设计方案.md`
  - §10「二期（另立）」＝ 本文的出发点（4 条要点）
  - §13 风险表：「刷新/换设备即丢 attention」「`session_upserted` 产生假未读」「`messageCount` 恒为 0」「项目聚合漏算未加载会话」
  - §4 通道 C（messageCount 恒 0）、通道 D（projectId 前置）
  - §5 结语 / §6 / C-3（置位排除当前会话＝丢弃）
- 一期实现：提交 `a38128e6`（片 1，18 文件）。
- 一期方案 §10 的指针**已回填**（`### 二期（另立，已展开为独立需求文档：[…-二期需求.md](…)）`），两文互指已成立（二审 Claude/C7）。

---

## 9. 审阅处置（v2 修订）

审阅来源：Claude（8 条）+ CodeBuddy（三组共 19 条，含 2 张汇总 NOTE）。**批注涉及的代码事实主张逐条对源码复算：27 条全部成立，零证伪、零反驳，1:1 对应下表 27 行。** 处置如下：
> **计数脚注**：一审批注区现计 **26 条** callout——第 27 条 **CBC-G（验收自动化建议）** 已与 `## 二审批注` 末尾的同源项合流（二审重提），故源区少 1、本节表仍为 27 行。

| # | 来源 · 级别 | 批注要点 | 处置 | 落点 |
|---|---|---|---|---|
| C1 | Claude · CAUTION | 「先 D 后 B」依赖链错位：B 走 GET /api/projects，不经 D-1；C-1 可反哺 B | **采纳** | §1 依赖图+说明、§3.5、§7、拍板 #5 |
| C2 | Claude · WARNING | 病例「改标题」与真源不符（不改 updated_at、不广播）；真病例是 mtime 变内容不变 | **采纳** | §0、§5.1、§5.5 |
| C3 | Claude · WARNING | D-1 判据含 mtime 会自失效 | **采纳** | §5.4 要求 2 |
| C4 | Claude · WARNING | B-3 整包读改写多设备并发覆盖 | **采纳** | §3.4、§3.6 |
| C5 | Claude · WARNING | 水位写本地 now 有双向时钟偏差 | **采纳** | §3.4 做法要点 |
| C6 | Claude · TIP | suppressedPendingRef 缺失效同步；重建 action 的清除须走轮询差集 | **采纳** | §2.4、§2.5 |
| C7 | Claude · NOTE | 两处表述精度（「无条件」不精确；**一期方案** §10 指针已完成） | **采纳** | §5.1、§8 |
| C8 | Claude · TIP | A-1 备选「把 pending 会话并进 `/running`」会改变 `SessionProtectionContext.syncProcessingSessions` 的输入；该副作用应并入拍板 #2 的验收 | **采纳** | §2.4 硬约束、§6 #2 |
| CB1 | CodeBuddy · CAUTION | #2 探针可静态结案；改问「外部 CLI 空 pending 不误报」 | **采纳** | §1 表、§2.4、§2.5、§6 #2 |
| CB2 | CodeBuddy · WARNING | 严重度须分档（55000ms 超时；仅交互式工具无限等待） | **采纳** | §0、§2.5 |
| CB3 | CodeBuddy · CAUTION | 水位「随会话删除清理」在 KV 通道不可达，决定 B-3 子选型 | **采纳** | §3.4、§3.6、§6 #4 |
| CB4 | CodeBuddy · IMPORTANT | 「另一设备也清除」缺推送链路，只在刷新后成立 | **采纳** | §3.6、§3.7 |
| CB5 | CodeBuddy · IMPORTANT | 前端偏好通道是封闭键集 + mirror/debounce/早退三件套，拆 key 过不去 | **采纳** | §3.4 |
| CB6 | CodeBuddy · WARNING | 硬编码 0 漏第三处（乐观行 `registerOptimisticSession`） | **采纳** | §4.2 |
| CB7 | CodeBuddy · TIP | watcher 已采集 `changeTypes` 却丢弃，可作 D-1a | **采纳** | §5.2、§5.4 要求 3 |
| CB-A | CodeBuddy · CAUTION | 水位只在「打开」写 ⇒「查看中收到新消息→切走」系统性假未读 | **采纳** | §3.4 做法要点、§3.6 |
| CB-B | CodeBuddy · WARNING | #2 可静态回答（等审批会话在 running 内）；外部 CLI 是语义边界 | **采纳** | §1 表、§2.4、§2.5 |
| CB-C | CodeBuddy · WARNING | P-1 可缩窄为服务层组装，无需改 provider 契约 | **采纳** | §1、§2.4、§2.6、§7 |
| CB-D | CodeBuddy · TIP | 不可复用 `pendingPermissionRequestIdsRef`（清除闸有 viewed 例外） | **采纳** | §2.4 |
| CB-E | CodeBuddy · NOTE | 复算 Claude 各论断（均成立）；指出 D-1「与上次快照 diff」未写明快照存放与重启后无基线时的默认裁决 | **采纳** | §5.4 要求 4 |
| CBC-A | CodeBuddy · CAUTION | `user_preferences` 举错类比、`session_drafts` 才同类；hydrate 竞态静默丢水位 | **采纳** | §3.2、§3.4、§3.7、§6 #4 |
| CBC-B | CodeBuddy · WARNING | A-1 低估三处必改（Entry / `sessionActivitiesMatch` / 跨 provider 通道） | **采纳** | §2.4、§2.6 |
| CBC-C | CodeBuddy · WARNING | 把 pending 会话并进 `/running` 集合 ⇒ 被判 `isSessionProcessing=true` + 10s 残留 | **采纳** | §2.4（硬约束） |
| CBC-D | CodeBuddy · WARNING | `change` 必须逐路径显式传参（3 条路径各自定性） | **采纳** | §5.4 要求 1 |
| CBC-E | CodeBuddy · TIP | 「另一设备清除」措辞须改（与 CB4 合并） | **采纳** | §3.6 |
| CBC-F | CodeBuddy · NOTE | 三处硬编码 0；删死代码只需删两处 JSX | **采纳** | §4.2、§4.3 |
| CBC-G | CodeBuddy · TIP | 三条验收天生可自动化，建议各挂守卫 | **采纳** | §7 测试建议 |

> **汇总**：27 条批注**全部采纳、零反驳**；其中 **6 条改写了文档核心论断**（C1 依赖链、C2 病例、CBC-A 基建选型、CBC-C 旁挂约束、CB2 严重度、CB-C P-1 缩窄），**2 条属事实更正**（C2 的「改标题」病例作废、CBC-A 的「`user_preferences` 同类基建」作废）。
> **批注中唯一被指出「已完成」的待办**：C7——一期方案 §10 指针已回填，§8 该条已改为「核对」。

---

## 10. 二审靶单（供第二轮审阅）

> **二审已完成（2026-10-10），处置见 §11**；本节保留靶单原文供对照。
> 一审（§9）已把 v1 的 27 条批注逐条复算采纳。**二审的靶子不是措辞、不是文档自洽——那些一审已清完——而是 v2 新出现的承重裁定**：它们由一审批注催生、**从未被任何审阅者独立攻击过**。
> **纪律**：下面每条都要求**读代码推演**，不接受只读本文档即下结论；凡批注给出数字或修法，请连同出处一起复算（上一轮的一条硬伤即"病例给错、验收会空转通过"）。
> 本表是"一审催生、最需复核"的**最小集，不是全集**——靶单之外的承重问题同样欢迎。
> 提示：**T1 与拍板 #4 重叠、T4 与拍板 #5 重叠**——若二审直接裁定 #4 / #5，等于处决 T1 / T4，不必重复劳动。

| # | 靶子（承重裁定） | 读哪段代码 | 要验证的主张 | 什么算推翻 |
|---|---|---|---|---|
| **T1** | **D5 落点 B-3→B-4 翻转**（一审最大路线裁定） | `schema.ts:261-271`（`session_drafts` 定义）、`user.routes.ts:65-84`（drafts REST）、`src/shared/userSettings.ts:454-458`（hydrate 竞态） | `session_drafts` 是"同构先例"⇒新建 `session_read_state` 划算；`user_preferences` 三处硬伤（hydrate 丢写 / 全 UI 重渲 / 整包并发覆盖）使其不宜承载 | 若 `session_drafts` 的生命周期与"已读水位"**并不同构**（草稿是"输入即建"、水位是"查看即写"，触发频率可能差一个量级），或新表引入未列成本（无级联清理 / 无服务端排序），则"B-4 优于 B-3"需重估 |
| **T2** | **依赖图重构**（v2 的心脏，直接改批次排序） | `projects-with-sessions-fetch.service.ts:128`（`lastActivity←updated_at`）、`sessions.db.ts:121-127`（`COALESCE` 覆写 mtime）、本档 §3.5 / §5.1 | "B 需要**内容级信号**；D-1 只修 WS 链路；C-1 的 `messageCount` 反哺 B"；原"先 D 后 B"错误 | 若存在 B 与 D 共享的可行路径之外的中间态，或 D-1 其实能间接影响刷新链，则依赖图与 §7 批次需改 |
| **T3** | **P-1 缩窄**（决定是否动 provider 契约） | `provider-runtime.service.ts:118-122`、`chat-run-registry.service.ts:244-257`、`sessions.service.ts:216-233`（外部 CLI 并入） | 服务层遍历 `listRunningSessions()` 逐个调现成 `listPending` 即可**完备**覆盖，无需给跨 provider 契约加无参枚举签名 | 若存在"持有 pending 但**不在** running 集合"的路径（abort 时序窗口 / 后台任务持有权限 / 非 turn 型交互），缩窄不成立 |
| **T4** | **`messageCount` 作 B 的水位信号**（一审批注催生的新想法，从未被审） | `sessions.service.ts:619-721`（`fetchHistory.total` 口径 **≠** 行数）、`sessions-watcher.service.ts`（重建时机） | JSONL **行数**是不受 touch / 改标题影响的内容级信号 | 若行数口径在分页 / 压缩摘要 / 子代理消息下会漂移，则该信号不可作水位，拍板 #5 需回退到"砍" |
| **T5** | **A-1「三处必改」与旁挂硬约束** | `SessionProtectionContext.tsx:130-162`、`src/shared/types.ts:188-249`、`useSessionProtection.ts:21-26,180-214`、`ProjectWorkspaceRoute.tsx:20-38` | 前端手写白名单**恰三处**（漏改即 `return prev`、静默）；`pendingPermissions` 只能旁挂 | 若手写白名单 **>3 处**（还有第四处同样静默），或旁挂仍会触发 `isSessionProcessing = true` / 10s 残留 |
| **T6** | **§2.4 两处空白**（形态未定，可能藏实现代价） | `ProjectWorkspaceRoute.tsx:20-38`、`ProjectsStateContext.tsx:72-78` | 跨 provider 通道、绕过选中抑制的"权威重建入口"的**具体形态**可行 | 若指定形态后发现父→子已有更简路径，或新通道与现有 `isSessionProcessing` prop 冲突 |

---

## 11. 二审处置（v3 修订）

审阅来源：**Claude 二审 3 条**（追加在 Claude 块尾，行 448/450/452）+ **CodeBuddy 二审 8 条**（`## 二审批注` 节：T1–T6 + 靶外 + 1 条重复验收建议）= **11 条**。**逐条读源码复算**（非转述）：**8 条成立、2 条部分成立、1 条重复**；其中 **2 条携带事实错误的论据**（T3 的「DSH 反例」、靶外的「移动端拿不到」）。处置如下：

| # | 结论 | 复算结果 | 处置 | 落点 |
|---|---|---|---|---|
| **T3** | P-1 缩窄不完备 | **部分成立**：`listRunningSessions()` 确为三来源并集（`sessions.service.ts:187-236`）✓；Claude `_sessionId` 可为 `null`（`claude-runtime.provider.js:1222`）✓ ⇒ 按-sid 查询恒空。**但「DSH 反例」证伪**：`agent.module.ts:58` 注入 `runs: chatRunRegistry`，两条 `startRun`（`chat-websocket.service.ts:223`、`agent.routes.ts:1036`）进**同一 registry**，run 必在 `listRunningRuns()`；DSH pending 实为 `pendingPermissions`（键 `requestId`、字段 `appSessionId`）会被反查到 | **部分采纳**：降级「完备」措辞、探针改验 `_sessionId=null` 可达性；**驳回 DSH 论据**。**探针已闭合（§2.4，2026-10-10）：registry 路由的 turn `_sessionId` 恒非 null ⇒ 缩窄成立、无需 `listAllPending()`** | §1 表+修正条、§2.4 探针、§6 #1 |
| **T4** | `messageCount` 不可作通用水位信号 | **成立**：Claude 解析器含 4 类非对话行（`progress`:537 / `last-prompt`:552 / `compact_boundary`:548 / `isSidechain`:544）；zcode:211、opencode:245 `jsonl_path` 恒 null；watcher 盯单文件 :128/:136 | **采纳** | §3.5、§3.7、§6 #5、§7 批次 3 |
| **T1** | B-4 两条「优」不成立 | **基本成立**：`session_drafts` 无指向 `sessions` 的外键（`schema.ts:262-271`）✓；`deleteSessionById` 单表删（`sessions.db.ts:799`）✓；`deleteDraft`/`deleteEmptyDraft` 无一会话删除链（grep 证）✓；`getDrafts` 有 `ORDER BY`（`session-drafts.db.ts:73`）✓；`draft_scope` 混合命名空间（`schema.ts:257-259`）✓ | **采纳**：「会话删除即回收」移入劣列，优势收为三条 | §3.4、§3.6、§6 #4 |
| **T2** | 依赖图缺一条中间态 | **成立**：`synchronizeFile` 已 `processSessionFile` 全解析（`claude-session-synchronizer.provider.ts:119`）⇒ 内容指纹零额外读盘 | **采纳（建议）**：D-1 顺带产出可复用指纹，批次 2 压两步 | §3.5、§5.4 要求 6、§7 |
| **T5** | 手写白名单三处→四处 | **成立**：`SessionActivity` 三构造点（`useSessionProtection.ts:77-85/140-146/191-198`）✓；`markSessionProcessing` 早退只比 2 字段（:87-93）✓；三调用点 `useChatRealtimeHandlers.ts:183/387/416`✓ | **采纳**：必改清单三处→四处 | §2.4 必改 4 |
| **T6** | 跨 provider 通道可降本 | **成立**：`useSessionProtectionActions()` 返 6 动作（`SessionProtectionContext.tsx:180-188`）✓；只透传 `isSessionProcessing`（`ProjectWorkspaceRoute.tsx:43`）✓ | **采纳**：多传一 prop 即可；重建入口建议 `rebuildAttention(sid, level)` | §2.4 必改 3 |
| 靶外 | 批次 1 覆盖面 / 字段区分 | **部分成立**：**「移动端拿不到」证伪**（`App.tsx:128-129` 仅 `/` 与 `/session/:sessionId` 两条路由、都渲染 `ProjectWorkspaceRoute`，`SessionProtectionProvider` 在路由级，移动端走同一路由）；**「pending 字段须显式区分『不支持』vs『无』」成立** | **部分采纳** | §2.4、§6 #2 |
| **T7** | pending 是服务端进程内存态 | **成立**：`pendingToolApprovals` 是**模块级** `new Map()`（`claude-runtime.provider.js:52`）⇒ 进程重启即清空 ⇒「权威重建」**只在同进程存活窗口内**有效；且**审批入口绑定发起设备**，新设备重建的胶囊**点不了**（误导型指示） | **采纳**：§2.1 明示可恢复范围＝「同进程存活窗口」；§2.5 补「进程重启后不重建」用例 | §2.1、§2.5 |
| **T8** | D-1 在 run-registry 路径无 diff 材料 | **成立**：`recordProviderSessionId`（`chat-run-registry.service.ts:155`）只做 id 赋值 + 广播、**无 transcript 快照** ⇒「与上次快照 diff」在此无据可依 | **采纳**：§5.4 钉死各路径的 `change` 缺省口径 | §5.4 |
| **T9** | 砍 C 的契约连带 | **成立**：`messageCount` 是 `SessionUpsertedEvent.session` 公共字段（`server/shared/types.ts:291`）⇒「砍」须决定「保留恒 0 契约」还是「从类型/广播移除」 | **采纳**：§4.3/§4.4 补契约决策，与拍板 #5 联动 | §4.3、§4.4、§6 #5 |

> **汇总**：二审 11 条（Claude 3 + CodeBuddy 8）；**成立 8 / 部分成立 2 / 重复 1**；**2 条携带事实错误的论据**（T3 的「DSH 反例」、靶外的「移动端拿不到」）。**改动 v2 核心裁定的 4 条**：T4 推翻「C-1 反哺 B」、T1 收窄 B-4 优势、T3 部分否掉「零契约变更即完备」、T7 收窄需求 A 的可恢复范围（进程内存态）。
> **一处方法论观察（供后续审阅参考）**：二审的**结构主张很硬**（多处精确命中行号），但**两条附带论据含误**——T3 的「DSH run 是另一套 Map」（把 provider 内部 `activeRuns` 与网关 `chatRunRegistry` 混为一谈）、靶外的「移动端拿不到」（未查路由）。**批注给的论据与数字仍须逐条复算**（与一审同一纪律）。

---

## 审阅批注

### Claude

> [!CAUTION] **§1 依赖图 / §3.5 / §7 批次 2 / 拍板 #7：「先 D 后 B」的依赖链与两条链路错位，按现方案 B 的一条验收会落空。** B 的未读重建发生在**刷新后从 `GET /api/projects` 拿 `lastActivity` 与水位比对**（本文 §3.4 判据 `lastActivity > watermark`）；而 D-1 是给 **WS `session_upserted` 事件**加 `change` 判别位——D-1 落地后，**刷新/换设备重建这条链路完全不经过 D 的判别位**，`§3.6「纯元数据变更不产生未读（依赖 D）」`在该链路上无机制保障。B 要真不假未读，水位比对的对象本身必须是**内容信号**（JSONL 行数指纹 / 真实 `messageCount` / 独立 `content_updated_at` 列），这是 D-1 不提供的。附带交叉影响：**C-1 的 `messageCount` 一旦落地，反而是 B 的理想水位信号**（改标题、touch 文件都不动行数）——拍板 #5「倾向砍」与批次 3 的排序需要连带重估。建议把依赖改述为：「B 需要内容级信号；D-1 只修 WS 链路；C-1 可反哺 B」，并在 §3.4 明确水位比对的字段与裁决口径。

> [!WARNING] **§0 症状表 / §5.1 / §3.5：病例「改个标题也算新动态」与真源不符，验收会虚假通过。** 实地核对：改标题走 `renameSessionById`（`server/modules/providers/services/sessions.service.ts:959`）→ `updateSessionCustomName`（`server/modules/database/repositories/sessions.db.ts:527-540`），SQL 只 SET `custom_name`/`name_source`，**不更新 `updated_at`**，且调用链**不广播 `session_upserted`**（`provider.routes.ts:1128` 无 broadcast）——即两条链路（WS 置位、水位比对）改标题都**本来就不产生**假未读，§5.5/§3.6 的「改标题」用例测的是不存在的问题。真实病例是另一条链路：**transcript 文件 mtime 变化而内容未变**（touch/外部写属性）→ chokidar `change`（`sessions-watcher.service.ts:295`，只过滤 `isWatcherTargetFile` 不判内容）→ `synchronizeFile` 以文件 mtime 覆写 `updated_at`（`claude-session-synchronizer.provider.ts:126-133` + `sessions.db.ts:122-124` 的 `COALESCE(?, CURRENT_TIMESTAMP)`）→ `indexed = Boolean(sessionId)` 不判内容变化（`session-synchronizer.service.ts:154-162`）→ **既广播 upsert（WS 假 notice）也推进 `lastActivity`（水位假未读）**。请把 D/B 的病例链改写到这条真实路径上，否则需求 D 的立论与验收都挂在假病例上。

> [!WARNING] **§5.4 D-1：判据含 `mtime` 会自失效。** 「判据可用行数 / mtime + 大小」——上面那条真实病例恰恰是 **mtime 变、内容不变**，若 diff 参与 mtime，touch 一律被判成 `content`，D-1 对核心病例无效。判据应钉死为**行数 + 字节数**（或行数 + 末行偏移）组合，明确排除 mtime；`mtime` 至多作廉价的「无需重读」短路信号，不能进 `change` 裁决。

> [!WARNING] **§3.4 B-3：KV 整包读改写存在多设备并发覆盖，文档只提了体积裁剪未提并发。** `user_preferences` 按 `(user_id, preference_key)` 存整份 `{ [sessionId]: lastSeen }` map，设备 A、B 各自 read-modify-write 同一 key → **后写者整包覆盖先写者**：A 刚打开会话 1 写入水位，B 同时打开会话 2 写入会把会话 1 的水位丢掉（假未读回潮）。建议三选一并写进 §3.4：① 读改写放进同一事务并 re-read 合并；② 按 session 拆 key（`sidebar.unread.<sid>`，PK 天然并行、体积天然有界）；③ 接受 last-writer-wins，但 §3.6 验收必须加「两设备交替打开**不同**会话互不回潮」用例。

> [!WARNING] **§3.4 B-3 判据：水位写「本地 now」有双向时钟偏差，且慢时钟会造成永不自愈的假未读。** `watermark = now(设备本地)` 与服务端 `updated_at`（`CURRENT_TIMESTAMP`，UTC）直接 `>` 比较：设备时钟**快** ⇒ 之后一段时间的真新消息被吞（漏报）；时钟**慢** ⇒ 打开即写入偏小水位，若该会话此后无新内容，假未读**永远挂着**。低成本修法：打开会话时水位不写 `now`，**写「读取时刻该会话的 `lastActivity` 快照」**——与判据字段同源、零时钟依赖、并发新消息仍会被 `>` 正确捕获。建议写进 §3.4 选项 B-3 的做法描述里。

> [!TIP] **§2.4 C-3：`suppressedPendingRef` 缺失效同步；§2.5 清除判据需补「轮询差集」。** ① 文档只写了「切走时补记」，未规定 `permission_resolved`/`permission_cancelled` 到达时**同步移除** suppressed 记录、以及补记瞬间以 `pendingPermissionRequestIdsRef` 复核 requestId 仍挂起——否则会把已解决的权限补成假胶囊，与二期「说真话」目标自相矛盾。② 服务端重建出来的 action，其清除若只「复用一期 X-2 的 pending 集合语义」（X-2 清除挂的是**本地** WS 事件）则跨设备解决权限后胶囊残留——须明确：**重建与清除都走同一 5s 轮询的集合差集**，本地事件只做加速。

> [!TIP] **§2.4 A-1 / 拍板 #2：探针失败的备选方案有一处未提示的副作用。** 即便探针通过，加可选字段向后兼容；但备选「把 pending 会话**显式并进** `/running` 集合」会改变 `SessionProtectionContext`（5s 轮询，`src/shared/context/SessionProtectionContext.tsx:172-178`）的 `syncProcessingSessions` 输入——等权限的会话会被当作 processing 参与保护逻辑，需确认不引发运行态标记/清理保护的回归。建议把该核对并进拍板 #2 的验收，而非只验「在不在集合里」。

> [!NOTE] **两处表述精度。** ① §5.1「前端**无条件** `markSessionAttention(..., 'notice')`（`useProjectsState.ts:858`）」——实际有两道抑制：当前查看中的会话走 `setExternalMessageUpdate` 分支不置位，且 `markSessionAttention` 内部还有 `viewedSessionId` 闸（`useProjectsState.ts:509-511`）；核心论点（不判别内容/元数据）成立，但「无条件」易被实施者误读。② §8 末条「完成后应回填一期方案 §10 指针」**已完成**——一期方案 §10 现文案为「已展开为独立需求文档」并已链接本文，该待办可改为核对。

> <br>— **二申（下）· Claude** —

> [!WARNING] **§2.1 / §2.4 / §2.5 需求 A：pending 是服务端进程内存态，「跨设备重建」的边界需澄清。** 实地核对：`claudeRuntime.permissions.listPending` 读的是模块级 `const pendingToolApprovals = new Map()`（`claude-runtime.provider.js:52,1688-1711`）——**服务端进程重启即清空**。因此 A-1 的「权威重建」只对空白覆盖：**同进程存活窗口内**（刷新页面 / 换设备重连到同一服务端进程时 pending 仍在内存）✓；**进程重启后**该 pending 已无，即便前端刷新也重建不出。更隐性的是**审批入口的设备绑定**：`resolve`/`cancel` 由接口触发，样例只存在于**发起订阅连接的那台设备**（UI 弹窗），换到新设备重建出的琥珀胶囊用户**没有审批入口**——只是"看得见的挂起、点不了"，反而成新的误导型指示。而 pending 真正的生命周期由 provider SDK 的请求持有（超时/断连即 `finalize`），并非前端设备持有。建议：① §2.1 把 A 的可恢复范围明示为「同服务端进程存活窗口」，不再承诺「跨对话/跨重启」；② §2.5 补一条「服务端进程重启后，原 pending 不重建（该亮不亮回归可接受，须与用户确认措辞）」；③ 「换设备」降级为「重连同一进程的另一次渲染」，并在验收里把审批入口只在发起设备这一语义写清楚，避免新设备显示无效胶囊。一审对「重建的 action 到清除」已补，这里补的是「重建本身能覆盖到什么」的边界。

> [!WARNING] **§5.4 D-1：run-registry 这条生产者没有 diff 材料，「谁给事件填 change」落地必踩。** 两条触发路径中，watcher flush（`sessions-watcher.service.ts:212`）有磁盘 transcript 可做行数/字节 diff；但另一条 **run-registry 的 `recordProviderSessionId`**（`chat-run-registry.service.ts:155`，provider 报 `session_created`/id 时广播）是**纯 id/元数据捕获、无 transcript 快照**，D-1 的「与上次快照 diff」在此无据可依。它只能硬选：填 `metadata` 会漏掉此刻已伴随的真消息（漏报未读）；填 `content` 则保留 id 捕获窗口的假未读。文档 D-1 只写了校验判据，没写**两条生产者各自如何得出该判据/缺省口径**。建议在 §5.4 明确：`change` 判定仅对 watcher 路径生效，run-registry 路径给保守默认 `content`（因其伴随真实 run 内容）并注释留痕，或把它们收拢到统一的 `buildSessionUpsertedEvent` 旁路里。

> [!NOTE] **§4.3/§4.4 需求 C「砍」的契约连带，与一审 C-1 反哺 B 联动决策。** `messageCount` 是 `SessionSummary` 与 `SessionUpsertedEvent.session` 的公共字段（`server/shared/types.ts:283-296`、两处服务端 `0`、前端 `session.messageCount`）。「砍」不应止于删 `SidebarSessionItem` 徽标分支，须同步决定该字段是**保留恒 0 契约**（避免动跨端契约与测试快照）还是从类型/广播移除；而一审已指出 C-1 的真实 `messageCount` 恰是需求 B 的理想水位信号——「砍」与「B 反哺」两件事要**一起拍板**（关涉拍板 #5），不能先砍 C 再回头补 B 的信号。

### CodeBuddy · `b7f1c0d4-3a92-4e6b-9c05-2f8ad41e6b73`

> [!CAUTION] **§2.4 / 拍板 #2：「待审批会话是否在 running 集合内」不必实测即可结案，探针该换成另一个问题。** `chatRunRegistry` 的 run 只在 `complete` 事件经过时翻成 `completed`（`chat-run-registry.service.ts:122-127`），而 `listRunningRuns()` 只取 `status === 'running'`（`:244-256`）。Claude 的 `canUseTool` 在 `waitForToolApproval` 上**阻塞在 turn 内部**（`claude-runtime.provider.js:1216-1229`），turn 未结束 ⇒ `complete` 未产生 ⇒ run 必在 `/running` 里；DSH 同理（`pendingPermissions` 挂在 ACP turn 内，`dsh-runtime.provider.ts:476-503`）。中途 abort 时 `completeRun` 立即终止 run，但 abort 也会经 `onCancel` 清掉 pending（`:141-148`），二者不产生「在 running 里但已无审批」的错配窗口。真正需要探针的是另一个问题：**`/running` 里那类 `canInterrupt: false` 的外部 CLI 会话**（`sessions.service.ts:216-233`，Shell 里手起的 Claude CLI）——它们由 `listBusyClaudeCliSessions` 补入，**在 CloudCLI 运行时里没有任何 pending 条目**，所以「一个会话在 `/running` 里却 `pendingPermissions` 为空」是**正常态而非缺口**，前端重建逻辑不得据此报错或误判。建议：把拍板 #2 从「在不在集合内」改写为「确认外部 CLI 会话的空 pending 不触发误报」，并把 A-1 的语义边界补进 §2.4——需求 A **只覆盖 CloudCLI 自己驱动的 turn**。

> [!WARNING] **§0 症状表第 1 行「严重度＝高」与 §2.5 第 1 条验收：真实窗口是 55 秒，不是无限。** `TOOL_APPROVAL_TIMEOUT_MS` 默认 `55000`（`claude-runtime.provider.js:62`），非交互工具走 `timeoutMs: undefined` ⇒ 55 秒后 `onCancel('timeout')` 自动 deny 并广播 `permission_cancelled`（`:155-159`、`:1227-1230`）；只有 `AskUserQuestion` / `ExitPlanMode` 传 `timeoutMs: 0` **无限等待**（`TOOLS_REQUIRING_INTERACTION`，`:83`、`:1217`）。这意味着「刷新后卡着的权限无痕」只在**交互式工具**上是无痕的**长窗口**；对 Bash 这类主流工具，用户最多 55 秒就会看到 `permission_cancelled` 自己消失，指示丢了也就丢了。请把 §0 的严重度拆成两档（交互式＝高／非交互式＝低），并把 §2.5 第 1 条验收改成分档用例：交互式工具刷新后重建胶囊；非交互式工具只在 55s 内的刷新上验证。附带一条实施提醒：若将来调大该超时，5s 轮询的集合差集就成为唯一清理路径，§2.5 第 3 条的权重会随之上升。

> [!CAUTION] **§3.6「水位随会话删除一并清理」在 `user_preferences` 通道上当前**不可达**，且这一条直接决定 B-3 两个子选项的取舍。** 服务端删除语义是「值为 `undefined` 则 DELETE 该 `preference_key`」（`user-preferences.db.ts:66-71`，`user.service.ts:70-76`），但 `undefined` 过不了 HTTP：`api.user.savePreferences` 走 JSON body，`JSON.stringify({k: undefined})` 得到 `{}`，该键**根本不会出现在请求里**（`src/shared/userSettings.ts:242-252`）。全仓无第二个删除入口（`router.delete('/preferences')` 不存在）。后果分岔：**单 map 方案（`sidebar.unread` 整包）仍可清理**（读回整包 → 删条目 → 整包写回，删除是隐式的），而 **Claude 建议的「按 session 拆 key」（`sidebar.unread.<sid>`）则根本无法删除单个键**——孤儿键只能永久留存，§3.6 的两条验收（「不残留孤儿键」「KV 体积有界」）在拆 key 方案下不成立。建议把「键可否删除」写成 B-3 内部选型的显式判据，别让并发问题（整包覆盖）与删除问题（拆 key 不可删）两个优点被当成可以兼得。

> [!IMPORTANT] **§3.6 第 2 条「打开会话 → 未读清除，且在另一设备也清除」缺一条链路，当前设计只在刷新后成立。** `clearSessionAttention` 是纯内存删（`useProjectsState.ts:526-540`），B-3 只在「打开会话时写水位」，**没有任何把水位变更推给其它在线设备的通道**（`user_preferences` 变更不走 WS；`userSettings.ts` 只有本 tab 的 `storage` 事件和 `USER_PREFERENCES_CHANGED_EVENT`，两者都跨不过设备边界——`storage` 事件按规范只在同源**其它**标签页触发）。另一设备只有在 `hydrateUserPreferences()`（登录/重载时）才读到新水位。所以验收要么改成「另一设备**刷新后**清除」，要么给 B 补一条广播（可复用 upsert 广播的 `connectedClients` 走法，但那样又与 §1「数据全局共享、无 user 维度」撞上，需要先裁 scope）。请在 §3.4 的做法描述里把这两种口径写明，让拍板时看见代价。

> [!IMPORTANT] **§3.4 B-3 落点：前端偏好通道是**封闭键集**，且写入路径自带 mirror + 去重 + debounce，拆 key 方案过不去。** `UserPreferences` 是 TS 联合类型，新增 `sidebar.unread` 要同时动该类型与 `LEGACY_STORAGE_KEYS`（`Record<UserPreferenceKey, string>` 要求逐键登记，`userSettings.ts:28-155`）；单个键的写入通道 `writeUserPreference` 带三件套：**值未变即早退**（`JSON.stringify` 比对，`:255-259`）、**400ms debounce 合并**、**localStorage 镜像**（供首屏同步读）。两个具体代价：① 整包 map 每次「打开会话」都全量重写，镜像 blob 与 PATCH 体积随会话数线性增长；② 每个镜像写入都会在**同机其它标签页**触发 `storage` 事件，而该 handler 是 `preferences = readMirror()` **整包替换**（`:398-409`）⇒ 高频打开会话会引发跨标签的无关重渲染。若采纳拆 key，键名 `sidebar.unread.<sid>` 无法被 TS 联合类型静态枚举，只能绕过 `writeUserPreference` 直调 `api.user.savePreferences`，从而丢掉 debounce / 未变早退 / 镜像三项。请把这条写进 §3.4，让「按 session 拆 key」的成本显性化。

> [!WARNING] **§4.2「服务端**两处**硬编码 0」漏了第三处，且它会直接让 §4.4 第 1 条验收在乐观行上失败。** 前端新建会话时走 `registerOptimisticSession`，同样写死 `messageCount: 0`（`useProjectsState.ts:629`）。这条记录**不读 DB、纯本地**（`:614-640` 自陈「never dispatched onto the socket」），因此即使 C-1 落地、DB 有了 `message_count`，新会话在首次 upsert 覆盖之前仍恒为 0 ⇒「新会话发 N 条 → 徽标显示 N」在乐观窗口内不成立。消费侧无风险（`sidebarProjectFormatting.ts:70` 已有 `Number(x || 0)` 容错，`SidebarSessionItem.tsx:200-202,452` 双处渲染条件均为 `> 0`），所以只需在 §4.2 的真源清单补这一行，并要求实现时同改。

> [!TIP] **§5.4 D-1：watcher 已经在采集一个可用的粗判别信号，但被丢弃了；可作分阶段第一步，成本比完整 snapshot diff 低一个量级。** `PendingWatcherUpdate.changeTypes: Set<WatcherEventType>` 每次事件都在收（`sessions-watcher.service.ts:108`、`:183`），但 flush 时**只用了 `updatedSessionIds`**（`:212`），`changeTypes` 收集完即弃。于是存在一条不用碰 synchronizer 的粗判别：`changeTypes` 含 `add` ⇒ 必是内容变化；纯 `change` ⇒ 才需要进一步 diff。建议把 D-1 拆成两步写进 §5.4：**D-1a** 先把 `changeTypes` 透传到 payload（改动量≈十行，立刻消掉「新会话/新文件」这一类），**D-1b** 再对纯 `change` 做行数+字节 diff（并按 Claude 那条排除 `mtime`）。附一个实施注意：watcher 是 `usePolling: true, interval: 6_000`（`:282-286`），事件由 mtime/size 轮询 diff 产生而非原生事件，判据设计不要假设事件及时性。

---

#### 本节批注的落地影响汇总（便于拍板时取舍）

| 拍板项 | 本节提出的影响 |
|---|---|
| #2 探针问题 | 换成「外部 CLI 会话的空 pending 不误报」，A-1 可行性已可静态结案 |
| #3 C-3 补记时机 | 补记对象应区分交互式 / 非交互式权限（后者 55s 自愈） |
| #4 D5 落点（B-3） | 需在「整包（可清理／有并发覆盖）」与「拆 key（并发安全／删不掉／过不了前端封闭键集）」之间**二选一**，不可两得 |
| #5 `messageCount` | 若做，须连前端第三处硬编码一起改 |
| #6 `projectId` 合并 | 无新增阻碍（与 Claude 一致） |
| #7 upsert 判别位 | D-1 建议拆 D-1a（透传 `changeTypes`）/ D-1b（内容 diff）两步 |

### CodeBuddy · 2026-10-10

> [!CAUTION] **§3.4 B-3：水位只在「打开时」写入——「查看中收到新消息 → 切走」这条最常见路径会系统性产生假未读，且 §3.6 验收对此零覆盖。** 判据是 `lastActivity > watermark`，而 `lastActivity` 投影自 `updated_at`（`projects-with-sessions-fetch.service.ts:128`、`session-upsert-broadcast.service.ts:51`）。推演：打开 A（水位=T1）→ 查看期间新消息到达（`lastActivity`→T2；WS 链路对 viewed 会话正确地不置位，`useProjectsState.ts:851-859` 走 `setExternalMessageUpdate`）→ 切到 B → 刷新 → `T2 > T1` ⇒ **A 显示未读，全是用户亲眼看过的消息**。这不是边缘 case，是「挂着会话干活」的主路径。修法：水位写入时机必须**同时覆盖「切走/关闭」**——`handleSessionSelect`（`useProjectsState.ts:1105-1130`）与 URL 变化 effect（`:953-955`）正是现有 `clearSessionAttention` 的调用点，可同位补写水位；App 直接关闭（无 leave 事件）需 `beforeunload` 兜底，或把「上次停留的会话」在加载时视为已读。§3.6 必须补用例「查看中收到新消息 → 切走 → 刷新 → 无未读」。注意：与 Claude 批注的「写 lastActivity 快照而非本地 now」修法**叠加后该洞仍在**——快照若也只在打开时写，同样过期。

> [!WARNING] **§2.4 拍板 #2 的探针问题可由代码静态回答：网关驱动的权限等待会话「在」running 集合内；且 pending 不会比 run 长命。** ① `listRunningRuns()` 只滤 `status === 'running'`（`chat-run-registry.service.ts:250-258`），而 run 仅在终态 `complete` 事件流经 `decorateAndRecordEvent` 时翻转（`:120-127`）——权限等待期 provider 进程未结束、无 `complete`，故留在集合。② Claude 侧 pending 的三条出路（resolve / abort / timeout）都经 `cleanup` → `pendingToolApprovals.delete`（`claude-runtime.provider.js:137-152`），不存在「run 已出表但 pending 残留」的孤儿态。探针仍建议跑（防实现走样），但预期为「在」，且探针报告应记录本推演供对照。**附带语义边界须写进文档**：外部 CLI 会话（`listBusyClaudeCliSessions` 并入 `/running` 的那批）在终端里等权限时，CloudCLI 的 `pendingToolApprovals` 里没有它们 ⇒ A-1 重建只覆盖**网关路由**的权限；外部 CLI 会话会显示 running 而非 action——可接受，但这是设计边界不是缺陷，别让实施者当 bug 去「修」。

> [!WARNING] **§1 P-1「runtime 枚举能力」可能不必动 provider 契约，可缩窄为服务层组装。** 既然 pending 全部挂在活 run 上（上条②），服务层可直接迭代 `listRunningSessions()` 已枚举出的集合、对每项调**现成的** `getPendingApprovalsForSession(sessionId)`（`provider-runtime.service.ts:118-122`，本就 provider-neutral）——不必给 `permissions.listPending` 加无参枚举签名（`server/shared/types.ts:641-644` 是跨 provider 契约，改它波及所有实现者与测试）。若采此路，P-1 缩窄为「`/running` 补 `projectId` + `pendingPermissions`（服务层组装）」，provider 接口零变更。量级评估：每 5s × N 个 running 会话 × M 个 provider 的 `listPending` 调用，Claude 侧是一次小 Map 扫描，可接受，但值得写进实施注释。

> [!TIP] **§2.4 C-3：不可复用现有 `pendingPermissionRequestIdsRef`，文档新设 `suppressedPendingRef` 是对的——这里给出机制证据。** 记录闸（`useProjectsState.ts:791-798`）**无** viewed 例外（正看会话的 `permission_request` 也进地图），但清除闸（`:804-808`）带 `eventSessionId !== viewedSessionId`——正看 A 时 A 的 resolved/cancelled **不清地图**。若切走时按该地图补记，会把已解决的权限补成假胶囊。所以新 ref 必须自带 resolve/cancel 同步清除（即 Claude 批注 TIP ① 的要求），且补记瞬间以实时 pending 复核。另记一处既有怪相（不在本期范围，提及不展开）：正看会话的 pending 地图条目在 viewed 期间永不清除，属既有的轻微泄漏。

> [!NOTE] **对 Claude 批注关键论断的复算结论（牵头汇总可直接采信）与一处其未覆盖的实施缺口。** ① ✅「改标题不产生假未读」「改标题不产生假未读」链成立：`renameSessionById`（`sessions.service.ts:959-970`）→ `updateSessionCustomName` 只 SET `custom_name`/`name_source`（`sessions.db.ts:527-539`），路由不广播（`provider.routes.ts:1123-1131`）⇒ §5.5 的「改标题」用例会**空转通过**，D 的验收必须换成 mtime 病例。② ✅ mtime 覆写链成立且比 Claude 描述的更必然：chokidar 是 `usePolling: true, interval: 6000`（`sessions-watcher.service.ts:286-288`）——**轮询模式下纯 touch（内容零变化）也必然被抓**；`synchronizeFile` 以 `readFileTimestamps` 的文件 mtime 作 updatedAt 写库（`claude-session-synchronizer.provider.ts:124-134`）→ upsert `updated_at = COALESCE(?, CURRENT_TIMESTAMP)`（`sessions.db.ts:121-127`）→ `indexed: Boolean(sessionId)` 不判内容（`session-synchronizer.service.ts:154-165`）→ 广播与 `lastActivity` 双推进。③ ✅「无条件」确有两道抑制（`useProjectsState.ts:851-859` + `:509-511`）。④ **D-1 的「与上次快照 diff」未写明快照存哪、以及重启后无基线时的默认裁决**：chokidar `ignoreInitial: true` 且初始全量同步不广播，重启后 diff 基线为空，每会话首个 watcher 事件要么假 content 要么假 metadata 一次——需在方案里钉死（建议：无基线默认 metadata，初始同步顺带建立基线）。

### CodeBuddy Code · 2026-10-10

> [!CAUTION] **§3.4 B-3 举错了「同类基建」：`user_preferences` 不是已读水位的同类，`session_drafts` 才是；且把高频状态塞进 `userSettings` 通道会被 hydrate 竞态静默丢弃。** 该表前端唯一读写通道是 `src/shared/userSettings.ts`，它的形态是「**启动一次性全量 hydrate + 400ms debounce 写 + localStorage 明文镜像**」，与「每切一次会话就写一次」的水位不匹配，三处实测代价：① **登录后立刻点开会话，水位双重丢失**——`hydrateUserPreferences` 末尾 `preferences = { ...serverPreferences, ...migrated }`（`userSettings.ts:~437`）整体替换内存副本，而循环 `for (const key of Object.keys(serverPreferences)) delete pendingServerWrites[key]`（`:~430`）又删掉同键的排队写——本地既没进内存、也没上服务端，且**无报错**。② 每次写水位都 `notifyListeners()` → `UiPreferencesContext` 的 `set_many` 全量 dispatch（`UiPreferencesContext.tsx:58-63`），**每切一次会话重渲染整个 UI 偏好树**；`writeUserPreference` 还用 `JSON.stringify` 做全值相等比较（`userSettings.ts:~250`），map 越大越贵。③ 水位 map 明文落 `localStorage['user-preferences']`。真正的同类基建在隔壁：`session_drafts` 是 `(user_id, draft_scope)` PK（`schema.ts:262-270`），`draft_scope` **就是 sessionId**，已有 REST 通道 `PUT/DELETE /api/user/drafts`（`src/shared/api.ts:559-560`）、一行一 scope ⇒ **天然规避 Claude 指出的整包并发覆盖、天然有界、会话删/草稿清空即回收**。建议把 B-3 改为「复用 `session_drafts` 形态新增 `session_read_state(user_id, session_id, last_seen_at)`（即 B-1 的 user_id 版，但走 drafts 那套 REST 通道）」，并把「零 schema 变更」这条优点替换成「零新范式 + 复用既有 per-user-per-scope 通道」——否则 B-3 的「优」在实现后才暴露是代价。

> [!WARNING] **§2.4 A-1「`RunningSessionEntry` 加两个字段」低估了三处必做改动，其中一处漏改则每 5s 的轮询更新被整块静默丢弃。** `/running` 的前端消费链每一环都是**手写白名单**：`RunningSessionApiItem` 逐字段 `typeof` 校验（`SessionProtectionContext.tsx:130-162`）→ `SessionActivitySnapshot`（`src/shared/types.ts:241-249`）→ `SessionActivity`（`:188-206`）→ 而 `useSessionProtection.ts:23-30` 的 `sessionActivitiesMatch` 是**逐字段列举比较**，`sessionActivityMapsMatch` 判等后 `syncProcessingSessions` `return prev`（`:198-203`）——**新字段不进这个列举，pending 的每一次变化都会被判为「与上次相同」而整个 map 不更新，且无任何日志**。同时 §2.4 写「前端 5s 轮询里调重建入口」在架构上不通：轮询在 `SessionProtectionProvider`（**父级**，`ProjectWorkspaceRoute.tsx:20-24`），`attentionSessions` 在其子级 `ProjectsStateProvider` 内（`ProjectsStateContext.tsx:72-78`），父→子无数据流——现在只靠 `ProjectWorkspaceRoute.tsx:31-38` 把 `isSessionProcessing` 一个 prop 递下去，pending 需要一条新的跨 provider 通道。这两件事都不在 §2.4/§2.6 的前置里，实施者按现文做会卡在「数据到了但不更新」。

> [!WARNING] **§2.4 备选方案「把 pending 会话显式并进 `/running` 集合」的副作用可精确到代码，比 CodeBuddy 批注更硬：该会话会变成 `isSessionProcessing=true`。** 前端把 `/running` 的每个条目折成 `SessionActivity`（`useSessionProtection.ts:180-195`），而 `isSessionProcessing = activity && !activity.background`（`:203-205`）——并进去的等审批会话（非 background）**直接被判为正在响应**：`canInterrupt` 默认 true ⇒ composer 的中断按钮出现；`SidebarSessionItem` 与 `useProjectsState` 的 `isSessionProcessing` 判据全线改变。另有一个 10s 盲区：`LOCAL_ACTIVITY_GRACE_MS = 10_000`（`:6`、`:194-197`）会让「本轮消失但 startedAt 在 10s 内」的条目被保留 ⇒ 权限解决后胶囊残留 10s，比文档 §2.5 承诺的「≤5s」差。**结论：`pendingPermissions` 只能作为旁挂字段挂在 `/running` 条目上，绝不能靠新增条目来表达。**

> [!WARNING] **§5.4 D-1 的判别位在三条触发路径里有两条无解，文档只处理了 watcher 那条：`change` 必须是每条路径显式传入 builder 的参数，不是 builder 内部算出来的。** `buildSessionUpsertedEvent(sessionIdOrProviderSessionId)` 签名里**没有判别位**（`session-upsert-broadcast.service.ts:21-24`），三条调用点是 `chat-run-registry.service.ts:155`（`recordProviderSessionId`）、`sessions-watcher.service.ts:212`、`sessions.service.ts:432`（fork）。后两条各有定论：fork **必然是 metadata**；而 `recordProviderSessionId` 恰恰**是真未读**——它在 run 首次拿到 provider 自己的 id 时广播，那一刻正是新消息刚到的时刻（`chat-run-registry.service.ts:145-152` 的注释自陈用途是「客户端发现行被合并」）。若按 D-1 的「只在 watcher 里 diff 快照」，这条路径要么被判成 metadata（**别的设备上刚起的会话不亮**）要么被迫在前端无条件置位（回到假未读）。建议写进 §5.4：`buildSessionUpsertedEvent(id, change: 'content' | 'metadata')`，三条路径各自显式传值，watcher 那条自己算，另两条由调用点断言。

> [!TIP] **§3.6「打开会话 → 未读清除，且在另一设备也清除」在现有基建下只有「下次加载才清除」，措辞须改，否则实施者会去找一条不存在的推送通道。** `user_preferences` 没有服务端推送：`hydrateUserPreferences` 只在登录时拉一次（`AuthContext.tsx:137-143`），跨设备唯一的传播是 `localStorage` 的 `storage` 事件（`userSettings.ts:~490`，**只到同浏览器其他标签**）。建议改成：「打开会话 → 本端立即清除；**另一设备在该次会话状态被重新拉取时**（hydrate / refresh）清除」，并在 §3.6 补一条验收「另一设备不刷新时该胶囊仍在——这是已知口径，不是缺陷」，否则这条验收会逼出一个不该建的 WS 通道。

> [!NOTE] **§4 的「两处硬编码 0」是三处；「删死代码」的工作面比文档设想的小。** ① 遗漏的第三处：`useProjectsState.ts:629` `registerOptimisticSession` 里同样写死 `messageCount: 0`（乐观会话）。② 死代码面：`src/shared/types.ts:91` 的 `messageCount?` 本就是**可选**字段，而格式化层 `sidebarProjectFormatting.ts:70` 是 `Number(session.messageCount || 0)` ⇒ 服务端停止下发后恒 0，两处 JSX（`SidebarSessionItem.tsx:200-202` 紧凑布局、`:452` 常规布局，文档 §4.2 已列全）自然永不渲染。**所以 C-3「不做」的清理只需删那两处 JSX，不必动类型与格式化层**——文档 §4.3 把它写成「须一并删掉徽标分支，否则留死代码」是对的，但应点明只删这两处，避免实施者顺手把可选字段与格式化层一起删穿。

---

## 二审批注（第二轮 · 按 §10 靶单 T1–T6 读代码推演）

> 二审方法：每条靶子都回到源码推演，不复用一审结论；靶单之外的承重问题在最后单列。
> **结论摘要：T3 被推翻（缩窄不成立，有具体路径）、T1 被部分推翻（B-4 的两条「优」不成立）、T4 被推翻（行数口径含三类非消息行）、T2/T5/T6 各有一条承重修正。** 详见下。

### CodeBuddy（二审） · 2026-10-10

> [!CAUTION] **T3 推翻：P-1「沿 `listRunningSessions()` 逐个调 `listPending`」不完备——`/running` 的 running 集合与「持有 pending」不是同一个集合，两条路径各有反例。这直接决定拍板 #1 与 §2.6 的「provider 契约零变更」。** 一审与 §1 表末行的推论都建立在「pending 必挂在活 run 上 ⇒ 必在 `listRunningRuns()` 里」，但 `listRunningSessions()`（`sessions.service.ts:187-236`）实际是**三个来源的并集**，只有第一个来自 registry：
>
> - **反例 A（DSH，`chat-run-registry` 覆盖不到）**：DSH 的 pending 挂在 `activeRuns`（`dsh-runtime.provider.ts:375`、`:819-826`），键是 **acpSessionId**，而 `listPendingDshPermissions(appSessionId)` 是靠 `pending.appSessionId` 反查（`:526-538`）。`dsh-runtime.provider.ts` 全文**不 import `chatRunRegistry`**（已 grep 确认：零命中）——DSH 经 ACP 子进程驱动，run 是**另一套 Map**。`dispatchRun`（`chat-websocket.service.ts:211-231`）会为它 `startRun`，但 **`/running` 的第一条来源 `listRunningRuns()` 只看 registry**；只要 DSH turn 由**非 `dispatchRun` 的路径**发起（`agent.routes.ts:1036` 是第二条 `startRun` 调用点，或 turn 在 registry 之外建立后 ACP 子进程仍在等审批），就会出现「有 pending、但 `listRunningRuns()` 里没有该 sessionId」⇒ 服务层遍历**查不到**。此时 `/running` 旁挂字段方案对该会话**恒不显示 action**，而它确实正在阻塞用户。
> - **反例 B（Claude 的 `waitForToolApproval` 键是 appSessionId，但 registry 的 `providerSessionId` 可能尚未映射）**：`recordProviderSessionId`（`chat-run-registry.service.ts:146-152`）是在 run **首次拿到 provider id** 时才写入映射，而 `pendingToolApprovals` 的 metadata 键是 `_sessionId: sessionId || capturedSessionId || null`（`claude-runtime.provider.js:1222`，注意**可为 `null`**）。当 `sessionId` 与 `capturedSessionId` 都拿不到时（`capturedSessionId` 在 provider 未 announce 前为空），该 pending 的 `_sessionId` 是 `null` ⇒ **`listPending(null)` 匹配不到任何 appSessionId**，`getPendingApprovalsForSession`（`provider-runtime.service.ts:118-122`）对它**恒返回空**。这与「session_upserted 的 projectId 缺口」同源，但影响的是**需求 A 本身**：这条 pending 在任何按 sid 查询的通道里都不可见。
>
> **这不否定「不需要无参枚举签名」这个结论本身**（服务层组装仍比改契约便宜），但它否掉了 §2.6 那句「provider 契约零变更 ⇒ 无需无参枚举」作为**完备性**论据：真正的完备解是**新增一条无参 `listAllPending()`**（provider 侧按自己的键空间枚举，DSH 按 `acpSessionId`、Claude 按 `_sessionId` 可为 null 的实际情况返回），或服务层改为「先并 `activeRuns`/外部 CLI 两个来源再查」。建议把 §2.4 的探针改为**验证这两条反例是否可达**（可达则 A-1 的覆盖面打折，须在 §2.5 加一条「DSH 会话等审批时也能重建」的验收），并把 §1 表末行「可由服务层组装」的措辞降级为「对 registry 驱动的 turn 完备」。

> [!WARNING] **T4 推翻：JSONL「行数」不等于「消息数」，且这条信号对三个 provider 根本不成立——把它当 B 的水位信号会引入比 `updated_at` 更隐蔽的偏差。** 一审与 §3.5 都把「JSONL 行数」当作理想的内容级信号，但复算 Claude 的解析器（`claude-sessions.provider.ts`）后，行里至少有四类**非对话内容**会被计入：
> - `type: 'last-prompt'`（`:552`，CLI 退出时写的续跑叶子标记）
> - `type: 'progress'`（`:534`，工具进度的独立行）
> - `type: 'system'` + `subtype: 'compact_boundary'`（`:551`，压缩边界）
> - `isSidechain: true` 的子代理行（`:544` 的 `newestRow` 判据把它与主线区分开，但它**仍在同一文件里**）
>
> 也就是说：**压缩一次会让行数跳变而用户没收到新消息；一次 CLI 退出会 +1 行；子代理跑一轮会 +N 行。** 用行数当水位 ⇒ 这三种情况都产生**假未读**——正是需求 D 要消灭的东西，只是换了个更隐蔽的触发源。若要用，必须先过滤到「主线 user/assistant 对话行」才有意义，而那已经不是 `wc -l`，是**复用 `claude-sessions.provider.ts` 的解析器**（成本从「顺手算行数」跳到「watcher 里跑一遍解析」，与 §4.3「C-1 成本可控」的乐观估计背离）。
> 更硬的边界：**行数口径只对 Claude 成立**。zcode / opencode 的会话存在共享 SQLite 里、**`jsonl_path` 为空**（`zcode-session-synchronizer.provider.ts:211`、`opencode-session-synchronizer.provider.ts:245` 均自陈「keeps every session in one shared SQLite database, so jsonl_path…」），watcher 对它们盯的是 `db.sqlite` / `opencode.db` 单文件（`sessions-watcher.service.ts:128-137`）——**一个文件对应所有会话**，根本无法按会话取行数。dsh 是目录内 `.vN` 日志（`isDshSessionLogFile`），口径又不同。
> **⇒ 对 §6 #5 与 §7 批次 2 的直接后果**：`messageCount` **不能**作为通用的水位信号，它只在 Claude 下经过滤才有意义。若 B 需要一个跨 provider 的内容级信号，更现实的是**独立 `content_updated_at` 列**——在 synchronizer 里用一个与 mtime 无关的判据（Claude 可用「主线对话行的最大 uuid 序号/时间戳」）写入，跨 provider 各写各的。请把 §3.5 的「C-1 反哺 B」降级为「仅 Claude 可用，且需过滤非对话行」，否则拍板 #5 会基于一个不成立的信号做取舍。

> [!WARNING] **T1 部分推翻：B-4 的两条「优」在复算后不成立或被高估——「同构先例」这个核心论据其实比文档说的更弱，而文档没给 B-4 补上它真正缺的东西（会话删除清理）。**逐条复算靶单要求验证的四个推翻条件：
> - **「无级联清理」⇒ 推翻成立。** `session_drafts` 的 DDL（`schema.ts:262-271`）**只有 `FOREIGN KEY (user_id) REFERENCES users(id)`，没有指向 `sessions` 的外键**——`draft_scope` 只是个 TEXT。而 `deleteSessionById`（`sessions.db.ts:797-800`）就是单条 `DELETE FROM sessions WHERE session_id = ?`，**不触及其它表**；`sessionDraftsDb` 也**没有任何 delete 调用挂在会话删除链上**（全仓 `deleteDraft` 调用点只有 HTTP 通道与 scheduled-messages 的 `deleteEmptyDraft`，见 `session-drafts.db.ts:123`、`:166`）。⇒ **草稿表现在就存在「会话删了、草稿行留着」的孤儿**（用户没在那个 scope 再打字就永远不清）。文档 §3.4 把「会话删除即回收」列为 B-4 的**优**，实际上那是**草稿的现状缺陷**，不是可继承的性质；而 §3.6 的验收「会话删除 → 水位一并清理」在 B-4 下**同样需要新写清理代码**（要么加 FK——但 `sessions` 表无 `user_id`、而 `session_read_state` 有 `user_id`，FK 只能单向`(user_id, session_id)` 复合外键或干脆手工删——要么在 `deleteSessionById` 后显式 `DELETE FROM session_read_state WHERE session_id = ?`）。**请把这条成本写进 §3.4 的「劣」列**，它与 B-3 的「删不掉键」是**同一类成本的两种形态**，不构成 B-4 相对 B-3 的优势。
> - **「触发频率差一个量级」⇒ 部分成立，但方向相反。** 草稿是**每次按键 debounce 写**（`chatDrafts.ts:144-151`，且还有 5 秒轮的 `hydrateChatDrafts` 主动 reconcile，`:1035-1046`）；水位是**每次切会话写一次**。水位频率**更低**，对服务端压力更小——这一条 B-4 确实更优，文档可以放心用。
> - **「scope 就是 sessionId」⇒ 不精确。** `draft_scope` 实际是 **sessionId 或 `project:<projectId>` 的混合命名空间**（`schema.ts:255-259` 注释、`user.service.ts:50-59` 的 `readDraftScope` 只校验长度不校验前缀），且 `listQueuedMessages` 靠 `INNER JOIN sessions ON sessions.session_id = drafts.draft_scope` 把非会话 scope 过滤掉（`session-drafts.db.ts:82-88`）。**这意味着 drafts 通道已经处理过「scope 不总是 sessionId」这件事**——对 B-4 是**利好**（有现成的过滤写法可抄），但也说明「同构」不是逐字段对齐，服务端得为 `read_state` 明确「只接受真实 sessionId」。
> - **「无服务端排序」⇒ 不成立。** `getDrafts` 带 `ORDER BY datetime(updated_at) DESC`（`session-drafts.db.ts:69`）。这条靶单假设有误。
>
> **净结论**：B-4 相对 B-3 的优势缩到「并发安全 + 单键可删 + 已有 REST 形状」三条；「会话删除即回收」和「零新范式」要打折。请在 §3.4 把 B-4 的「优」列改写为可验证的三条，并把「需在 `deleteSessionById` 后补清理（或加复合 FK）」写进「劣」列与 §3.6 验收的实现注记。

> [!IMPORTANT] **T2 修正：依赖图里漏了一条真实的中间态——「内容级信号」不需要新列，`/running` 的 5 秒轮询本身就能当刷新链的内容判据；而 D-1 的产物可以顺带产出这个信号，两条需求其实能合并而非并列。** 靶单问「是否存在 B 与 D 共享的可行路径之外的中间态」——存在：复算发现 **watcher 的 `synchronizeFile` 每次都已完整解析了 transcript**（`claude-session-synchronizer.provider.ts:108-133`：`processSessionFile` → `readFileTimestamps` → `createSession`），也就是说**「内容变没变」这个判据在现有同步路径上零额外成本可得**——`processSessionFile` 解析出的行里已经有 `type`/`isSidechain`/`uuid`，判「主线对话行的最大 uuid 是否变了」不需要再读一次文件。
> 由此：**若把 D-1 的判别位落成「一个可复用的内容指纹」（而不只是一个 `change` 枚举值）**，它可以①写进 `sessions` 新列供 B 在刷新链比对（解决 §3.5 的信号缺口），②或由 `/running` 侧挂带给前端。⇒ **§7 批次 2 现在的排序（先做内容级信号 → 再 D → 再 B）可以压成两批**：做 D-1 时顺带产出指纹列，D 与 B 共用；否则按现文做，B 会被卡在一个独立的新列上（成本评估里没算它）。这不推翻 §3.5 的核心更正（「先 D 后 B」错误——**D-1 那个 `change` 枚举本身确实喂不到 B 的刷新链**），但给出了比「另做 content_updated_at 列」更省的一条路。请在 §3.5 / §7 补这条，并把「指纹列由 D-1 顺带产出」写进 §5.4 的落实要求里。

> [!IMPORTANT] **T5 修正：手写白名单不是三处而是**四处**，第四处在一审与文档都没点到的 `SessionProtectionContext` 之外——`SessionActivitySnapshot` 的构造还有第二个生产者，且 `sessionActivitiesMatch` 的字段集与 `SessionActivity` 的构造处**不同步**，改字段要同时改三个函数。** 复算 `useSessionProtection.ts` 全文后确认：`SessionActivity` 共有**三个构造点**——`markSessionProcessing`（`:70-84`，逐字段构造）、`markSessionBackground`（`:126-131`，逐字段构造）、`syncProcessingSessions` 的 `updated.set`（`:180-186`，逐字段构造）。前两个**都不经过** `sessionActivitiesMatch` 的完整字段集：`markSessionProcessing` 的早退判据只比 `statusText` 与 `canInterrupt`（`:86-88`），`markSessionBackground` 才调 `sessionActivitiesMatch`。
> **⇒ 真正的静默风险**：`pendingPermissions` 若加进 `SessionActivity`，则 `markSessionProcessing`（每次 WS `permission_request`/首帧都会调，`useChatRealtimeHandlers.ts:183`、`:387`、`:416`）构造出的 `next` **不含该字段** ⇒ 一次 WS 事件就把轮询带来的 `pendingPermissions` **抹掉**，而 `sessionActivitiesMatch` 因为比的是 `next.pendingPermissions === undefined` vs 地图里的旧值 ⇒ 判不等 ⇒ map 更新 ⇒ **pending 被清空**。这条比文档列的三处更隐蔽（不是「漏加导致不更新」，而是「加了却被 WS 路径抹掉」），且 §2.5 第 7 条验收「重建的 action 与实时 action 完全一致」正好是这个 bug 的对偶——它会**通过**，而实际行为相反。
> 建议 §2.4 的必改清单改为：**① `RunningSessionApiItem`（`SessionProtectionContext.tsx:130-162`）；② `SessionActivitySnapshot`（`types.ts:241-249`）；③ `sessionActivitiesMatch`（`useSessionProtection.ts:23-30`）；④ 三个构造点（`:70-84`、`:126-131`、`:180-186`）必须各自显式带上 `pendingPermissions`**（否则被 WS 路径抹除）。第④条是本轮新增，一审与文档均未覆盖。

> [!IMPORTANT] **T6 修正：跨 provider 通道不必新建——`ProjectsStateProvider` 已经能拿到父级的**全部** state，只是被 `Pick` 削了；而「权威重建入口」有一个更简的既有形态可抄（`ChatInterface` 已经订阅了同一条 WS）。** 靶单问「指定形态后发现父→子已有更简路径」——有：`ProjectWorkspaceRouteContent` 就在 `SessionProtectionProvider` **内部**调用 `useSessionProtectionActions()`（`ProjectWorkspaceRoute.tsx:30`），它返回的是 `markSessionProcessing`/`markSessionIdle`/`markSessionBackground`/`syncProcessingSessions`/`isSessionProcessing`/`getSessionActivity` **六个动作**（`SessionProtectionContext.tsx:180-186`），而传给 `ProjectsStateProvider` 的只有 `isSessionProcessing` 一个（`:36`）。⇒ **只需多传一个 prop**（如 `getPendingPermissionsForSession` 或 `processingSessions`），通道就通，不必新建 context、不必改 `ProjectsStateContext` 的 Pick 集合。文档 §2.4 第 3 条「需要一条新的跨 provider 通道」在**方向**上对，但把成本说重了，实施者可能因此去设计一个多余的新 context。
> 「绕过选中抑制的权威重建入口」也已有同构先例：`useChatRealtimeHandlers` 已经在 `subscribe` 上做跨会话的状态写入（`useProjectsState.ts:823-836` 同一批事件里既更新 attention 也更新 projects），而重建入口要做的事——**按 sid 直接置位/清除、不经 `markSessionAttention` 的 viewed 闸**——就是把那个闸的判断从调用方移进函数内。**建议 §2.4 把它写成「新增一个 `rebuildAttention(sid, level)` 入口，与 `markSessionAttention` 平级、`useProjectsState` 内部持有」**，比「新的跨 provider 通道 + 新的重建入口」两个新概念省一层。

> [!TIP] **靶单之外的一处承重问题（§7 批次 1 排序）：批次 1 把 `/running` 扩字段与需求 A 绑在一起，但 `/running` 的 5 秒轮询在 `SessionProtectionProvider` 里，而 `SessionProtectionProvider` 只挂在 `/` 与 `/session/:sessionId` 两个路由上（`ProjectWorkspaceRoute.tsx:20`）——移动端与非工作区视图拿不到，因此「需求 A 覆盖全部界面」这个隐含承诺不成立。** 若将来出现第三个消费该轮询的入口（设置页、通知中心），字段白名单要改第二次。**这不是当前缺陷**，但 §7 把批次 1 定为「最痛」时值得知道覆盖面上界在哪。另附一条对 §2.5 第 4 条验收的可执行性补强：`canInterrupt: false` 的外部 CLI 会话与「未实现 `listPending` 的 provider」在 `/running` payload 上**形状完全一样**（都没有 `pendingPermissions`），前端无法区分「没有 pending」与「这个 provider 不支持 pending」——建议 `/running` 的 pending 字段设计成**显式区分**（缺席＝不支持／空数组＝支持但无 pending），否则「不误报」这条验收只能靠「不崩」而非「不误判」来判定。

#### 二审结论对拍板项的影响（供 §6 直接更新）

| # | 拍板项 | 二审影响 |
|---|---|---|
| 1 | action 重建通道 | T3 推翻「零契约变更即完备」——需 `listAllPending()` 或并入 `activeRuns`，否则 DSH 等审批会话可能恒不显示 |
| 2 | 外部 CLI 空 pending | 维持；但追加一条「pending 字段须显式区分『不支持』与『无』」 |
| 3 | C-3 补记时机 | 无新增阻碍 |
| 4 | D5 落点 B-3→B-4 | T1 部分推翻——B-4 优势缩到三条；**「会话删除即回收」须从优列移到劣列**（drafts 本身也没级联到 sessions） |
| 5 | `messageCount` 做/砍 | **T4 推翻其作为通用水位信号**——非对话行 + 仅 Claude 成立；§3.5/§7 的「C-1 反哺 B」须降级 |
| 6 | `projectId` 合并 | 无新增阻碍 |
| 7 | upsert 判别位 | T2 建议 D-1 顺带产出**可复用内容指纹**，与 B 共用（可把批次 2 从三步压两步） |

> [!TIP] **§2.5/§3.6/§5.5 的验收全是人工勾选框，其中三条天生可自动化却没落成测试，建议在 §7 批次里各挂一条守卫。** 至少三条：① 「重建的 action 与实时事件产生的 action 视觉与清除行为完全一致」——可断言同一 sessionId 经「WS 事件置位」与「轮询重建置位」两条路得到**同一 `attentionSessions` 值且清同一个 pending 集合**；② 「同一事件重复投递只置位一次」——纯函数级；③ 「改标题不产生未读」（Claude 已证该用例会空转，须换成 mtime 病例）——可在 watcher 同步层构造「同内容不同 mtime」的 fixture 断言不广播 content。当前文档形态容易让实施者把「验收」理解成手工点一遍，而这三处的失效模式恰好都是**静默**（见本节上面第 2 条的 `return prev`）。
