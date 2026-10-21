# CloudCLI 侧边提问（btw）功能方案

> **文档性质**：实施方案。第 2 章是代码可核对的事实，第 3 章之后是设计决定；凡标 **【建议】** 的段落都欢迎推翻。
> **状态**：方案已定稿，**未实施**（2026-10-21 拍板 D1–D5，见下表）。已吸收两轮外部审阅（第一轮 Claude 8 + Codex 4，处置见 §12；第二轮 Claude 4 + Codex 3，处置见 §14）与一轮实施前自查（§13，其中 1 条后被第二轮推翻）。正文已按三轮结论改写；**D5（§11-4）于 2026-10-21 定为方案 a，阻塞项已清，可进入实施**。§11 中第 2/5/6 条仍是带【建议】的默认取值，未单独拍板，实施时按建议执行。
> **关联文档**：
> - `docs/research/WorkBuddy-OpenCode-Pi对话编辑与Fork实施方案.md`（fork 的既有实现）
> - `docs/research/CloudCLI的Provider架构分析.md`（provider 分层）

---

## 决议清单（2026-10-21 已拍板）

| # | 问题 | 结论 |
|---|---|---|
| D1 | 抽屉里能否追问？ | **能**。一次打开 = 一次 fork，副本内可连续追问 |
| D2 | 要不要禁工具？ | **不禁**。完整工具访问，权限模式**逐回合继承主会话的 UI 态**（不是零成本：抽屉必须复用同一个 options 构造器，见 §5.3） |
| D3 | 入口形态 | **独立按钮**为主，另加消息级「从这里 btw」 |
| D4 | 主会话正在跑时能否开 btw？ | **能**，抽屉顶部挂明确提示，不禁用 |
| D5 | 建副本时"有文件无行"的占位窗口怎么收口？（2026-10-21 追加） | **方案 a**：进程内"正在创建"注册表，`createSession` 的 INSERT 分支命中即写成 `is_ephemeral = 1`；一次性消费 + 回填时校验误标 + 60s 过期（§5.1） |

---

## 1. 需求与语义

### 1.1 用户诉求

对话进行中冒出一个疑问（"这行为什么这么写""这个配置在哪生效"），希望当场问清楚，**但这句话和它的回答不要进入主会话的上下文**，以免带偏后续回合。

### 1.2 与 Claude Code 原生 `/btw` 的差异

| 维度 | 原生 `/btw` | 本方案 | 差异原因 |
|---|---|---|---|
| 工具访问 | 完全禁用 | 完整可用 | D2：疑问多是"去查一下"，禁用就没用了 |
| 轮次 | 单轮，不可追问 | 可追问 | D1 |
| 上下文 | 主会话到此刻为止 | 主会话截到指定锚点 | 额外支持从中间插入 |
| 落盘 | 完全不落盘 | 落盘后立即删 | CloudCLI 无"不落盘"通道，见 §2 |
| 转正 | 按 `f` 分叉子代理 | 「另存为会话」 | 等价出口 |
| 权限 | 不适用 | 逐回合继承前端实际发出的 mode（§5.3 三层） | 本仓库的 mode 是 UI 态，不是会话属性 |

### 1.3 四条不变量（验收基准）

任何实现都必须同时满足，缺一条就是没做到"不污染"：

- **I1** 主会话的 transcript 文件字节不变（不追加、不改写、不改 mtime）。
- **I2** 主会话在 `sessions` 表里的行不变。
- **I3** 副本不出现在侧栏、会话搜索、未读统计、项目计数里。
- **I4** 抽屉关闭后，副本不留下数据库行，也不留下 transcript 文件（含共享库形态 provider 的库内行）。

I4 的正常路径是"关闭即删"；异常路径（客户端消失、请求丢失）由 §5.9 的周期清扫兜住，最长 6 小时。

---

## 2. 现状事实（为什么不能照抄）

**【事实】F1｜一回合必须绑定一个已存在的会话行，且同一会话同时只允许一回合。**

`resolveSendTarget` 从数据库取行（`server/modules/websocket/services/chat-websocket.service.ts:185-195`），拿不到就报 `SESSION_NOT_FOUND`；`chatRunRegistry.startRun` 以 app session id 为键，重复就报 `RUN_IN_PROGRESS`（`server/modules/websocket/services/chat-run-registry.service.ts:195-210`）。所以"在侧边发一句话"必须先有一个会话行。

**【事实】F2｜任何新 transcript 文件都会被 watcher 索引成会话。**

同步器按 `provider_session_id` upsert，无行即 INSERT（`server/modules/database/repositories/sessions.db.ts:167-194`），触发源是启动扫描与 chokidar 的 add/change（`server/modules/providers/services/sessions-watcher.service.ts:285-302`）。**删掉 DB 行但留着文件会被重建**。所以"临时副本"不能靠"不建行"实现，只能靠"建行 + 标记 + 关闭时先删文件再删行"。

**【事实】F3｜服务端没有一次性问答通道。**

服务端除会话运行外，只有 `POST /api/agent` 会主动发模型请求，而它同样建会话、写 transcript（`server/modules/agent/agent.routes.ts:947,1075-1088`）。没有"发一段 messages、拿回答案、不留痕"的接口。

**【事实】F4｜fork 已覆盖 7 个 provider，但锚点粒度不同。**

`IProviderFork.forkSession` 接受 `upToAnchorId`（`server/shared/interfaces.ts:88-113`）。各实现见 §7。能力矩阵里 `supportsSessionForking: true` 的是 claude / codex / opencode / workbuddy / pi / zcode / omp（`server/modules/providers/services/provider-capabilities.service.ts:68,100,122,145,190,219,250`）。

**【事实】F5｜"删文件 + 清共享库 + 删行"已经实现，且顺序正确。**

`deleteOrArchiveSessionById(force:true, deletedFromDisk:true)` 先删 transcript（含被 superseded 的旧路径）、再调 provider 的 `deleteProviderSession`、最后删行（`server/modules/providers/services/sessions.service.ts:1018-1105`）。这个顺序正好是 I4 需要的。

**【事实】F6｜没有"前端本地斜杠命令"这一层。**

`/btw` 不是 CLI 命令，`useSlashCommands` 的列表来自项目扫描（`src/modules/chat/hooks/useSlashCommands.ts:82`），发送路径也不会在本地拦截。所以入口只能是按钮，或新开一层本地命令解析。

---

## 3. 方案总览

```
主会话 (app session A)
   │  点「btw」按钮 / 消息级「从这里 btw」
   ▼
前端抽屉（锚点 = 用户指定消息 或 A 的最后一条完整用户消息）
   │  用户输入第一问
   ▼
POST /btw ──► fork A（upToAnchorId）──► provider 副本 B（隐藏行 is_ephemeral=1）
   │                                        │
   │                                        ├─ chat.send（普通链路，权限模式继承 A）
   │                                        └─ chat.subscribe（抽屉订阅 B 的流）
   ▼
抽屉展示问答；可继续追问（仍在 B 内）
   │
   ├─「重新 fork」→ 清 B，回到锚点重开
   ├─「另存为会话」→ 去掉 ephemeral 标记，B 正式出现
   └─ 关闭 → 清 B（abort 运行 → 删文件 → 清共享库 → 删行）
```

关键决定：**打开抽屉时不 fork，发第一问时才 fork**。这样锚点取的是"发问那一刻"的主会话状态，也避免"点开又关掉"白复制一次。

---

## 4. 数据模型

### 4.1 新增列

`sessions` 表增加：

```sql
is_ephemeral BOOLEAN DEFAULT 0
```

- `schema.ts` 的 `SESSIONS_TABLE_SCHEMA_SQL` 同步加上（`server/modules/database/schema.ts:124-176`）。
- 迁移用现成的 `addColumnToTableIfNotExists`（`server/modules/database/migrations.ts:38-45`），新增 `addSessionEphemeralColumn`，并在 `runMigrations` 注册。
- **列必须进入读路径，否则 §5.6 的广播过滤是空转**（第二轮自查补）：`SESSION_ROW_COLUMNS`（`server/modules/database/repositories/sessions.db.ts:38`）、`SessionRow` 类型与 `normalizeSessionRow` 都要带上 `is_ephemeral`。只加 schema 和迁移，`buildSessionUpsertedEvent` 里的 `row.is_ephemeral` 会恒为 `undefined`，过滤条件永远不成立。
- 不加索引：`sessions` 表行数在本地场景很小，过滤成本可忽略；多个列表查询都要改，索引收益不抵维护面。

### 4.2 语义

`is_ephemeral = 1` 的行是**完全真实的会话**（有 provider session、有 transcript、能跑 turn），唯一区别是"默认不可见、可被一键回收"。它不是一个新实体类型，只是可见性标记。

唯一的中态是 §5.1 的**占位阶段**：那一瞬间 `provider_session_id` 与 `jsonl_path` 都还是 `NULL`，行尚未对应任何 provider 会话。这个中态只存在于单个请求的时长内，且正是崩溃安全网的依据（有行可扫、可清）。占位期间 watcher 有可能抢先建行，由 §5.1 的"正在创建"注册表保证那条行同样落成 `is_ephemeral = 1`，因此**不存在"短暂可见的副本行"**。

---

## 5. 服务端设计

### 5.1 创建副本：`POST /api/providers/sessions/:id/btw`

请求：

```json
{ "upToAnchorId": "可选，消息 id", "title": "可选" }
```

响应：

```json
{ "sessionId": "...", "provider": "claude", "projectPath": "...",
  "anchorMessageId": "...", "anchorDegraded": false }
```

流程（放在 `sessions.service.ts`，路由只做解析与转发，遵守后端规范）：

1. 取源行，校验存在、有 `provider_session_id`、provider 有 `fork`。
2. **解析锚点**（§5.2）。
3. **先插占位行**：`session_id = randomUUID()`、`provider_session_id = NULL`、`jsonl_path = NULL`、`is_ephemeral = 1`、`model/effort` 继承源行；紧接着把它登记进 §5.1 末尾的"正在创建"注册表（`projectPath` + `session_id`，60s 过期）。
4. 调 `fork.forkSession({ providerSessionId, jsonlPath, projectPath, upToAnchorId, title })`。失败时**主动注销注册表条目**并删除占位行。
5. **回填**该行的 `provider_session_id` 与 `jsonl_path`：先用 `assignProviderSessionId` 合并 watcher 可能已抢先建出的重复行（`server/modules/database/repositories/sessions.db.ts:443-492`），**再单独补写 `jsonl_path`**——该函数在"无重复行"分支只 UPDATE `provider_session_id`（`sessions.db.ts:483-488`），不会写 `jsonl_path`。漏掉这一步的后果不是显示问题：表里 `jsonl_path` 恒为 NULL，§5.4 的删除定位不到文件、§5.9 的 mtime 判据全部失效。回填成功后注销注册表条目。
6. **不调用 `broadcastSessionUpserted`**（对比正式 fork 在 `sessions.service.ts:596`）。
7. 返回。

**为什么必须先插行（修正原方案）**：`forkSession` 在返回前已经写出副本的 transcript 文件（`claude-fork.provider.ts:36-52`）。原文的顺序是"先 fork 后建行"，那么进程若在两步之间崩溃，会留下**有文件、无 DB 行**的副本，而 watcher 会把它索引成一条**普通可见会话**（`is_ephemeral` 默认 0），且 §5.5 的启动清理看不见它——比孤儿更糟。先插占位行则崩溃后仍有一条 `is_ephemeral = 1` 的行可被清理。

代价：`createForkedSession` 需要拆成"建占位行"与"回填"两个动作，并新增 `isEphemeral` 入参（`server/modules/database/repositories/sessions.db.ts:378-425`）。回填要在同一事务里完成，避免出现"文件已存在、行仍为 NULL"的中态被 watcher 抢先索引。

**占位窗口会漏一条可见行——按方案 a 收口（2026-10-21 已拍板）**：占位行的 `provider_session_id` 是 NULL，而 watcher 的 `createSession` 是按 `provider_session_id` 找行的（`sessions.db.ts:191-194`）——找不到就走 INSERT，`is_ephemeral` 取**默认值 0**。也就是说，从 `forkSession` 写出文件到第 5 步回填之间，watcher 只要扫到该文件，就会建出一条 `is_ephemeral = 0` 的行，**§5.6 的广播过滤（只挡 1）挡不住它**；随后 `assignProviderSessionId` 会把这条重复行删掉，而全仓没有任何 `session_deleted` 广播（grep 零命中），所以已经推给客户端的条目会变成"侧栏幽灵"，刷新才消失。

窗口大小：watcher 是 6s polling（`sessions-watcher.service.ts:340-341`）＋广播有 debounce（`schedulePendingWatcherFlush`，`sessions-watcher.service.ts:162-186`），回填通常在 fork 返回后几毫秒内完成，撞上的概率低（opencode 因临时 serve 会拉到秒级）。但这**不是概率问题而是分支缺失**——两条行在形状上可辨（一条 NULL、一条有 provider id），必须选一种收口。

**已选方案 a**：把 `is_ephemeral` 的判定提前到会话行的创建入口（`createSession` 的 INSERT 分支），由进程内的"正在创建"注册表兜住窗口。

- **注册表键**：`projectPath`。理由：`createSession` 的查行条件只按 `provider_session_id`，而新建分支能拿到的稳定标识只有文件所在目录；按 `projectPath` 也能覆盖"同一项目连开两个 btw"。值为 `{ pending: Array<{ placeholderSessionId, expiresAt }> }`——**登记的是占位行的 `session_id`**，不是 provider id（provider id 此刻还不存在）。
- **写入时机**：§5.1 第 3 步插入占位行之后、调 `forkSession` 之前登记；第 5 步回填成功后注销。
- **消费规则：一次性消费 + 用后校验 + 过期即弃**。watcher 建行命中注册表时，先把新行写成 `is_ephemeral = 1`、消费掉该条目，并**记下被标行的 `session_id`**。第 5 步回填时核对：若被标行的 `provider_session_id` 与本次 fork 返回的 id 不一致，说明标错了（见下条），立即把它改回 `0`。
- **为什么要有校验**：键是 `projectPath` 而非 provider id，窗口内同一项目里若恰好另有正常新会话被 watcher 建行，会先被误标。误标的后果不是"闪一下"，而是**周期清扫会把用户的正常会话删掉**——所以必须能自愈，不能只靠"概率低"。
- **过期时间取 60s**：远大于正常 fork 的耗时，又短到任何异常残留（fork 失败、进程半死）都会在下一分钟内自然失效。过期即弃，**不做"到点统一清"之外的任何补标**。
- **命中失败即降级**：注册表查不到时保持现有行为（`is_ephemeral = 0`），不做任何猜测。a 方案只消除"我们自己创建"的窗口，不改变 watcher 对其他内容的判断。
- **落地位置**：新建 `server/modules/providers/services/ephemeral-fork-registry.service.ts`（单例、纯内存，`register / consume / expire`），在 `createSession` 的 INSERT 分支查询（`sessions.db.ts:191-215`）。同步器不感知，仓储层只多一个"是否隐藏"的入参——避免把"为什么隐藏"的知识塞进 watcher（与 §5.6 的分层判断一致）。

**不采纳的两个备选**：b（补 `session_deleted` 帧）需要为一条极小概率事件扩 WebSocket 协议，且只治"幽灵"不治"行本身"；c（fork 前预分配 provider id）只有 claude 这类"id 可指定"的 provider 支撑，跨 provider 无法统一。两者都不选。

### 5.2 锚点解析规则

- **只接受用户消息作为锚点**。理由：以助手消息收尾会切在回复中间，后续上下文不闭合；codex 更是只能落到 turn 粒度。
- 请求未传 `upToAnchorId` 时，从 `fetchHistory` 取**最后一条 `type === 'user'` 的消息**。
- 会话里一条用户消息都没有（刚建好、还没发过话）→ 400 `BTW_ANCHOR_INVALID`；前端在拿不到任何用户消息时直接隐藏两个入口，不发请求。
- 请求传了但该消息不是用户消息、或不属于该会话 → 400 `BTW_ANCHOR_INVALID`。
- 主会话正在跑时，"最后一条用户消息"是已落盘的完整行，**锚点选取**不会读到半写行（历史读取本身也会丢弃解析失败的行，`claude-sessions.provider.ts:493-495`）。这复现了原生 btw 的"看不到我正在写的那条"。注意：这只保证**锚点**正确，不保证 fork 复制过程本身能容忍半写行——那是 §10-6 的待实测项。
- codex 会把锚点降级到所在 turn（`codex-fork.provider.ts:29-33`），此时响应 `anchorDegraded: true`，前端在抽屉顶部提示"上下文截至该轮结束"。
- zcode 是唯一"默认锚点会必然失败"的 provider（第二轮自查，属于设计缺陷不是降级）：`planZcodeFork` 的判据是"存在比锚点更新的 workspace checkpoint 就拒绝"（`zcode-fork.provider.ts:62-77`）。我们的默认锚点是**最后一条用户消息**，而它之后的那一轮只要动过文件就必留 checkpoint ⇒ 默认路径直接 409。文档上一版给的补救"从末尾开始"在语义上不成立：不传锚点时 zcode 取的是最后一条消息（可能是助手消息），与本方案"只接受用户消息"冲突。
  **处置**：zcode 的默认路径改为**不传 `upToAnchorId`**（等于 fork 整段对话，`planZcodeFork` 走到 `messages[last]`，永远不触发 checkpoint 守卫）；只有用户从中间指定锚点时才可能 409，此时按原样透传并提示"该位置之后有文件快照"。即：zcode 的"从末尾 btw"等价于"当前全部上下文"，比原生 btw 多带一条正在生成的助手消息——这是可接受的偏差，需在抽屉提示条里说明。
- 响应字段口径：`anchorMessageId` 表示**实际生效**的锚点。zcode 默认路径不指定锚点，所以返回 `null` 且 `anchorDegraded: true`，与 codex 的"降级到轮"共用同一个布尔位但文案不同（前端按 provider 区分，见 §6.5）。

### 5.3 复用 `chat.send`

副本就是一个普通会话行，前端直接对它发 `chat.send`，无需新协议。`chat.subscribe` 按 sessionId 回放，抽屉拿 `lastSeq: 0` 即可（`src/modules/chat/hooks/useChatSessionState.ts:1148`）。

**双订阅可行性（已核实服务端）**：`handleChatSubscribe` 以 `sessionId` 为键调用 `chatRunRegistry.attachConnection(sessionId, ws)`（`server/modules/websocket/services/chat-websocket.service.ts:540-548`），同一个 socket 可以同时挂多个会话的回放游标，不是"后订阅替换前订阅"。因此主会话与副本可以共用一个 WS。

**仍未核实的是前端分发**：`useChatSessionState` 按"当前选中会话"持有 loading 与 seq 记账，抽屉若自己累积流事件，必须确认事件消费前按 `sessionId` 过滤，否则两边会串。这条写进 S2 验收（§9），不靠推测。

**权限与运行参数（第二轮审阅更正，原方案只说对了一半）**："继承主会话"不是一句话，而是**三层**，任何一层漏掉都会让抽屉与主会话产生实际差异：

| 层 | 字段 | 真身 | 漏掉的后果 |
|---|---|---|---|
| ① 前端 UI 态 | `permissionMode` | `useChatProviderState` 的组件状态（`src/modules/chat/hooks/useChatProviderState.ts:202,555`），常规发送经 `buildSendOptions`、定时发送经 `ChatInterface.tsx:476` 塞进 options，**不在 session 行里** | 漏传 → claude 运行时直接跳过 `sdkOptions.permissionMode`（`claude-runtime.provider.js:253-255`），静默落到 SDK 默认的 `default`，工具全部卡在权限卡上 |
| ② 每回合 `options` | `effort`（UI 态）、`toolsSettings` / `skipPermissions`（用户偏好，但**由客户端读出后随请求发**）、`model` | 统一由 `useChatComposerState.buildSendOptions` 构造（`src/modules/chat/hooks/useChatComposerState.ts:666-689`），服务端原样 spread 进 runtime（`chat-websocket.service.ts:276-288`） | 漏传 `effort` → 按 provider 默认档跑；漏传 `toolsSettings` → claude 拿到空的 `allowedTools`/`disallowedTools`（`claude-runtime.provider.js:258-266`），工具面直接变了 |
| ③ 同一请求内的覆盖 | `toolsSettings.skipPermissions` | **不是服务端设置**（更正审阅者的归因）：它由客户端从该 provider 的权限偏好读出（`useChatComposerState.ts:666-674` 的 `readUserPreference`），随请求发给服务端，运行时在 `settings.skipPermissions && permissionMode !== 'plan'` 时把 mode 改写成 `bypassPermissions`（`claude-runtime.provider.js:258-266`） | 覆盖源就在②里：漏传 `toolsSettings` 会让 `skipPermissions` 变假（抽屉变严，安全侧）；传了 `true` 则 `permissionMode` 被顶掉（抽屉变松） |

**`model` 是唯一不需要前端保证的**：服务端解析时行内记录优先于请求值（`provider-models.service.ts:512-526` 的 `resolveResumeModel` → `readRecordedSessionSelection` 读 `sessions.model`），所以 §5.1 把源行的 `model` 复制到副本行就够了。**`effort` 不在这个回退链里**——pi/omp 直接读 `options.effort`（`pi-runtime.provider.ts:100-101`、`omp-runtime.provider.ts:108-109`），必须由前端逐回合发送。

因此口径定为：

- **抽屉不复制主会话的 mode，而是实时镜像**（读 `ChatInterface` 的当前值逐回合发送），抽屉内的模式选择器**置灰只显示**，不给第二条改动入口。选"实时"而不是"fork 时刻快照"，是因为两者的失败方向不对称：快照会把"用户在主会话里收紧成 default"这件事挡在抽屉之外，抽屉继续按旧的高权限跑（fail-open）；实时镜像最多是"抽屉突然变严"（fail-closed）。
- **options 构造抽成共享函数**，由 `useChatComposerState` 与 `BtwComposer` 共同调用，禁止抽屉自己手拼——手拼就是上面三层的漏点来源。
- 验收用例必须包含"**故意漏传**"：断言漏传 `permissionMode` 时抽屉里的工具会卡在权限卡（即复现失败），以此证明继承链路真的被测到了。

### 5.4 回收副本：`DELETE /api/providers/sessions/:id/btw`

- 校验目标是 `is_ephemeral = 1`，否则 403 `NOT_EPHEMERAL`（**防止前端 bug 误删正式会话**，这是本方案里唯一一道"防自己"的闸）。
- **必须先中止运行再删（第二轮自查，阻断级；原方案完全没写）**：`deleteOrArchiveSessionById` 从头到尾**没有任何 abort 调用**（`server/modules/providers/services/sessions.service.ts:1008-1105`，逐行核对过；该文件里与 abort 相关的注释只有"这里没有 run 可中止"那一句）。而用户点关闭最常见的时机恰恰是"等得不耐烦了"，副本很可能正在跑。直接删文件的后果是双重的：

  1. CLI 进程继续 append，把刚 `unlink` 的 jsonl **重建**回磁盘；watcher 下一轮 polling 扫到新文件 → `createSession` INSERT → `is_ephemeral` 默认 0 → **变成一条可见的正式会话**。§5.7 的 tombstone 只有 60s，挡不住一个跑了几分钟的长回合。
  2. 那个 provider 进程失去归属，继续改工作区文件，且再也没有 UI 能停它。

  通道是现成的：`chat.abort` 的 handler 做的就是 `runtime.abort(provider, sessionId)` + `completeRun`（`server/modules/websocket/services/chat-websocket.service.ts:429-457`），`DELETE /btw` 走同一套（不需要新协议）。删除顺序固定为 **abort → 等 run 终结（拿到 terminal 事件）→ 删文件 → 清 provider 共享库 → 删行**。若 run 在超时内没有终结，返回 409 `BTW_STILL_RUNNING` 并保留副本（让它被 §5.9 兜底），**不要**在没有确认退出时删文件。
- **直接复用** `deleteOrArchiveSessionById(sessionId, { force: true, deletedFromDisk: true })`：force 路径本来就不校验归档状态，且该函数及其路由都不广播（`server/modules/providers/provider.routes.ts:1328-1339` 只返回结果，前端自行更新列表），正好符合"副本不该被客户端知道"的要求。不需要为"删除"本身抽新方法，abort 是**前置步骤**，不是它的替代。
- 幂等：行已不存在返回 204（注意 `deleteSessionById` 内部对不存在的行会抛 `SESSION_NOT_FOUND`，端点要先判存在性再调）。

**转正：`PATCH /api/providers/sessions/:id/btw/promote`**

- 同样先校验 `is_ephemeral = 1`，否则 403。
- 标题：请求体 `title` 可选。空串、纯空白、超过 120 字符一律拒绝（400 `BTW_TITLE_INVALID`），不悄悄截断——现有 `renameSessionById` 完全不校验（`server/modules/providers/services/sessions.service.ts:1157-1168`），这里刻意更严，因为转正是不可撤销的可见性变更。未传时用 `"<源会话名> (btw)"`。
- `is_ephemeral = 0` + `custom_name` + `name_source = 'manual_rename'` 一次事务写完。
- **副本仍在跑时转正（第二轮自查补）**：不 abort，只翻标记。理由：转正的语义是"留下来"，中止回合属于另一个动作；但必须保证翻标记后**抽屉不再删它**（前端把 `promoted` 置位，`destroy()` 遇到已转正就跳过 `DELETE`）。若此时 watcher 的 upsert 正巧在建行，也不会把标记改回 1：同步的 UPDATE 分支整条语句里没有 `is_ephemeral`（`sessions.db.ts:202-225`，已核对）。
- 广播 **`session_upserted` 的 `metadata` 级**变更。不能用 `content`：`stampFallbackContentTimestamp` 只在 `content` 级写 `content_updated_at`（`session-upsert-broadcast.service.ts:141-147`），用 `content` 会把一次转正误判成"来了新消息"而点亮未读。
- 排序位置：`updated_at` 保持副本创建时间，因此侧栏按该时间落位，不会跳到最前——这是期望行为（转正的是几十分钟前的侧聊，不是刚刚的新消息）。

### 5.5 残留清理（启动兜底）

服务端启动时扫一遍 `is_ephemeral = 1` 的行，逐个执行 §5.4 的清理。理由：进程崩溃、断电、清理请求丢失都会留下副本；没有这道兜底，孤儿副本会永远占着磁盘（虽然不进侧栏，因为 §5.6 的过滤）。

### 5.6 可见性过滤

**原则：不在仓储层一刀切，按"用户可见面"过滤（第二轮审阅更正）。** 第一版写的"所有列表查询都加 `AND is_ephemeral = 0`"会误伤内部消费者——同一个仓储方法往往同时服务"给用户看"和"给清理/对账用"两个相反场景：

| 仓储方法 | 内部消费者（**必须看到副本**） | 用户可见消费者（**必须过滤**） |
|---|---|---|
| `getSessionsByProjectPathIncludingArchived` | `project-delete.service.ts:45`：项目强删要按行删 transcript，过滤掉副本就会留下文件 | `projects-with-sessions-fetch.service.ts:186`：项目会话视图 |
| `getArchivedSessions` | `claude-session-synchronizer.provider.ts:416`：名称回填（按 `name_source` 过滤，副本本不匹配，但查询本身不该被收窄） | `sessions.service.ts:976` 归档列表、`session-conversations-search.service.ts:1199` 搜索候选集 |
| `getSessionsByProjectPathPage` | — | `projects-with-sessions-fetch.service.ts:204` |
| `getSessionsByProjectPath` | 当前无外部调用方（实施时确认） | — |

处置：

1. 仓储层保留"全量"语义，另加 `...Visible` 变体，或在**服务/DTO 边界**过滤；每个方法的 caller 在实施结论里列全，不靠文档维护清单。
2. `getSessionById` **不过滤**——副本自己跑 turn、抽屉读取历史都走它（`§5.3`）。
3. **项目强删必须有一条断言**："项目里存在的副本 transcript 也被删掉"。这条最容易漏，而且漏了不报错，只在磁盘上留一堆 jsonl。
4. 搜索、未读统计、项目会话计数都属于用户可见面。

**必须同时过滤广播（阻断级，原方案漏了）**：`buildSessionUpsertedEvent` 只挡 `row.isArchived`（`server/modules/websocket/services/session-upsert-broadcast.service.ts:35-37`），而它取行走的是 `getSessionById`——正是本节明确要求**不过滤**的那个查询。watcher 会把副本文件的 `add`/`change` 入队并调用 `broadcastSessionUpsertedBatch`（`server/modules/providers/services/sessions-watcher.service.ts:233-238,295-300`），于是**副本创建那一刻就会广播给所有客户端，侧栏当场出现一条**，I3 直接破防。

修法只有一处：`buildSessionUpsertedEvent` 增加 `row.is_ephemeral` 判断并返回 `null`。单点，不散在 watcher 里。注意 `stampFallbackContentTimestamp` 在 build 之前执行（`session-upsert-broadcast.service.ts:160-161`），会给副本行写 `content_updated_at`；行随后会被删，无害，不必额外拦。

### 5.7 watcher 竞态

同步器看到新 transcript 会 upsert。正式 fork 已有"先插行再让 watcher 看见"的约定（`sessions.service.ts:584-596` 与 `sessions.db.ts:399-413` 的 reclaim 逻辑），副本沿用即可。

**删除侧的竞态要按实际机制描述**（更正原方案）：watcher 并不"持有文件列表"，它是逐文件调用 `synchronizeProviderFile`，同步完成才入队广播（`sessions-watcher.service.ts:295-300`）。所以文件已经不存在时，sync 抛错、不建行、不入队，这条路径是安全的。

真正的窗口只有一个：sync 已经读到文件内容（Unix 下 `unlink` 不阻止已打开的 fd 继续读），而 upsert 落在删除之后。此时 `createSession` 按 `provider_session_id` 找不到行 → 走 INSERT，`is_ephemeral` 取默认值 **0** → 副本复活成**可见**会话。窗口是"读文件+解析"的毫秒级，概率低但后果是用户可见的。

处置（按成本从低到高）：

1. 删除后立即再执行一次 `deleteSessionById`（幂等，挡住"upsert 先于二次删除"的那一半）。
2. **进程内 tombstone 集合**：删除成功后把 `provider_session_id` 记入带 TTL（60s）的 `Set`，同步器的 upsert 入口遇到即跳过。比建一张墓碑表轻得多，且能同时覆盖第 1 条盖不住的那一半。
3. §5.5 的启动清理作为最终兜底。

注意 tombstone 只在单进程内有效——CloudCLI 是单进程守护，成立；若将来多进程部署，这里要改成持久化。

### 5.8 不做的事

- 创建时**不主动**广播 `session_upserted`；并且 §5.6 要求广播服务自身也过滤，两道一起才算数。
- 不写未读状态（副本不算"来了新消息"）。
- 不参与项目计数与统计。

### 5.9 周期清扫（原方案漏了）

启动清理只覆盖"服务重启过"。浏览器崩溃、刷新、断网都会让 `DELETE /btw` 永远到不了服务端，而服务可能连续运行数天——副本就会一直留在磁盘，违反 I4，并在 provider 自己的 CLI 会话列表里持续可见（见 §8）。

处置：一个低频定时器，扫 `is_ephemeral = 1 AND updated_at < now - 6h`，逐个走 §5.4 的回收路径。

- 阈值取 6 小时：同步器建行时用文件时间戳写 `updated_at`（`claude-session-synchronizer.provider.ts:96-107` 的 `readFileTimestamps`），抽屉连续追问会让 transcript 的 mtime 与 `updated_at` 一起往前走，正常使用不会被误杀；只有真正被遗弃的副本才会命中。
- 只做**服务端定时**，不依赖前端心跳。前端心跳能更精确地判断"人还在不在"，但引入一个新的存活协议，收益不抵复杂度。
- 刷新后抽屉丢失是**预期行为**：重新打开会按当前主会话重新 fork，不会接着旧副本。

---

## 6. 前端设计

### 6.1 入口

**主入口：聊天头部按钮。** 位置在会话标题栏右侧，与现有工具栏同排。图标用 `MessageSquareDashed` 一类"旁注"语义，不用 `+`（那是新建会话）。

**次入口：消息级「从这里 btw」。** 复用现有消息级 fork 菜单的位置（`src/modules/chat/transcript/MessageComponent.tsx:258,689`），在用户消息上显示该动作。点它 = 用该消息作锚点打开抽屉。

**不做快捷键**：CloudCLI 是网页，浏览器已占用大量组合键；先看使用频率再说。

### 6.2 抽屉容器

**新建一个独立组件，不复用 `QuickSettingsPanelView`**。理由：那个组件承担设置面板的布局职责（可钉成列、与设置状态强耦合，`src/modules/quick-settings-panel/QuickSettingsPanelView.tsx:201-253`），直接复用会把两套生命周期绑在一起。只借用它的形态约定：

- 桌面端：右侧固定宽度（建议 420px）抽屉，**不遮罩**，主会话仍可操作；
- 移动端：全屏覆盖（`inset-0`），否则 420px 在手机上无法使用；
- `z-index` 与现有浮层对齐；`Escape` 关闭需 `capture` 且与命令菜单/权限弹窗做优先级让步（参考设置面板的 Escape 处理）。

**移动端键盘不是 `inset-0` 能解决的**（批注命中）：全屏抽屉里的输入框会被软键盘顶起或遮住，消息列表的可视高度与滚动锚点也会跟着错。仓库已有现成工具 `useVisualViewportKeyboardOffset`（`src/modules/project-workspace/hooks/useVisualViewportKeyboardOffset.ts:37`，由 `ProjectWorkspaceRoute.tsx:38` 调用），抽屉应复用同一套偏移量，而不是自己再监听一次 `resize`：

- 抽屉高度改为 `calc(100% - keyboardOffset)`，底部留 `env(safe-area-inset-bottom)`；
- 输入框贴在抽屉底部，键盘弹起时消息列表自身滚动，不整体上推；
- 关闭/返回手势与浏览器历史无关，用 `Escape` 与显式关闭按钮，**不接管返回键**。

### 6.3 状态与流

**目录归属（更正原方案）**：btw 是 chat 的子能力，**不新建 feature module**，因此也不建 `index.ts`。按前端模块规范（hook 归 `hooks/`，组件按用途归子目录）：

```text
src/modules/chat/
|-- btw/
|   |-- BtwDrawer.tsx       容器 + 头部（锚点说明、重新 fork、另存为会话、关闭）
|   |-- BtwMessageList.tsx  消息列表
|   `-- BtwComposer.tsx     输入框（复用 PromptInput 的受控形态）
`-- hooks/
    `-- useBtwSession.ts    会话生命周期（创建/删除/转正），不含消息累积
```

若导出给 chat 模块之外使用，走 `src/modules/chat/index.ts` 桶文件；仅本模块使用时不出桶。

`useBtwSession` **只负责生命周期，不负责消息累积**：

1. `ensureSession()`：发第一问时调 `POST /btw`，拿 `sessionId`，缓存。
2. `send(text)`：`chat.send` 到副本，options 走 §5.3 的共享构造器。
3. `subscribe()`：只发 `chat.subscribe({ sessions: [{ sessionId, lastSeq: 0 }] })`；**回放与增量都交给全局事件泵**，抽屉不自己累积。
4. `destroy()`：`DELETE /btw`，然后丢弃该 sessionId 的 store slot。
5. 消息、流式态、loading 一律从 `sessionStore` 里 B 的 slot 读（用 `getSessionSlot` 只读访问，避免顺手建槽）。

**"自建 hook 本地累积、不渗进全局 store"这个隔离假设不成立（第二轮审阅核实，原结论作废）**：前端只有一条 WebSocket，所有帧都进 `useChatRealtimeHandlers.handleEvent`，它按 `msg.sessionId` 路由、**不丢弃非活跃会话的事件**（`src/modules/chat/hooks/useChatRealtimeHandlers.ts:172-330`），而 `sessionStore` 是按 sessionId 分槽的 Map、切会话不清空（`useSessionStore.ts:1-8`）。也就是说，**按原方案**（抽屉自己累积），B 的 `stream_delta`/`text`/`tool_use` 会同时落到共享 store 和抽屉数组里——两套累积、两套 seq 记账、两套 finalize。

处置：**改为复用共享 store 的 B slot（原方案的"不复用"作废）**。

- 抽屉读 store，天然只有一份累积；历史翻页、工具卡、reasoning、sealed 行全部白拿，`useBtwSession` 退化为一个很薄的生命周期 hook。
- 原方案担心的"副本渗进侧栏缓存"不成立：侧栏列表来自 projects API，不是这个 store；store 里多一个 slot 不会让会话出现在任何列表里。
- **不选**"给全局 handler 加非活跃会话丢弃"：那会连带杀掉本仓库正在依赖的后台会话流式与 attention 更新（`lastSeqRef`、`streamBuffers`、`revealPacer` 都是按 sid 设计的），改动面远大于收益。
- 需要一个新增：store 目前**没有删槽 API**（注释明写"No clearing. Old data stays."）。`destroy()` 要真的丢掉已删副本的 slot，得给 `useSessionStore` 加一个 `dropSession(sessionId)`；不加就是每次 btw 都在内存里留一份死消息，长会话下会累积。

`useChatSessionState` 仍然不复用——它绑定路由选中态与项目上下文；抽屉直接读 store slot，不经过它。

**复用展示层**：`MessageComponent`、`Markdown`、`ToolGroupContainer`、`Reasoning` 都是纯展示组件，且都在 chat 模块内，直接引用即可。

### 6.4 权限卡

claude 是唯一会把工具权限弹到 UI 的 provider（`supportsPermissionRequests: true`）。默认权限模式下，抽屉里必须能渲染并回传权限请求，否则工具调用会卡住。

现成组件是 `PermissionRequestsBanner`（`src/modules/chat/composer/PermissionRequestsBanner.tsx:26-36`）：**纯受控**，接收 `pendingPermissionRequests` 与两个回调，可以直接放进抽屉的输入框上方，不需要改它。需要自己做的是**按 `sessionId` 过滤**待决请求——浏览器侧拿到的是全局待决列表，主会话与副本的请求必须分开渲染，否则两边会互相看到对方的授权弹窗。权限决策走 `chat.permission-response`（`chat-websocket.service.ts:575-587`），协议本身是 provider 中立的，无需扩展。

其余 provider 不弹权限卡，按各自 CLI 的默认策略执行。

**前提是生效 mode 为 `default`（第二轮审阅更正）**：mode 不是全局常量，而是 `useChatProviderState` 的 UI 状态（`src/modules/chat/hooks/useChatProviderState.ts:202,555`，初值来自该 provider 的偏好，可在输入框菜单里切换）。所以抽屉必须实时镜像它（§5.3）；只有在镜像到的值为 `default`、且该 provider 的权限偏好里 `skipPermissions` 为假时，claude 才会真的发权限请求。验收用例必须两者都显式设好，否则会"测了个空"。

### 6.5 提示条

抽屉顶部常驻一行状态，内容随场景变化：

- 默认：`上下文截至第 N 条消息`
- 主会话正在跑：追加 `主会话正在执行，btw 的工具操作可能与其冲突`
- `anchorDegraded` + codex：`该 provider 只能按轮截断，上下文截至该轮结束`
- `anchorDegraded` + zcode：`已从会话末尾开始，上下文包含正在生成的回复`

这行不是装饰：§1.3 的 I3 容易理解，但"看不到锚点之后的内容"最容易被误解成 bug；zcode 那条反过来，是"看得比你以为的多"。

### 6.6 重新 fork 与另存为会话

- **重新 fork**：`destroy()` 后清空本地消息，锚点重置为"主会话当前最后一条用户消息"，下次发问时重建。
- **另存为会话**：新端点 `PATCH /api/providers/sessions/:id/btw/promote`（后端细节见 §5.4）。前端在转正成功后关闭抽屉并跳转到该会话。

### 6.7 i18n

新增文案同时改 `zh-CN` 与 `en`（键集以 `en` 为基准，见项目 i18n 策略）。涉及：按钮名、抽屉标题、锚点说明、两个动作、**五个错误码**的用户可读文案：`BTW_ANCHOR_INVALID`（含"会话里还没有你的消息"）、`NOT_EPHEMERAL`、`BTW_TITLE_INVALID`、`BTW_STILL_RUNNING`、`SESSION_NOT_FOUND`（源会话已被删）。上一版写"四个"，第二轮自查更正。

---

## 7. Provider 支持矩阵

| provider | fork 锚点 | 只读/工具 | 本方案可用性 |
|---|---|---|---|
| claude | 任意消息（含锚点） | 完整可禁，本方案不禁 | 一等 |
| pi | 任意分支条目 | 有 `--tools` 白名单 | 一等 |
| omp | 任意分支条目 | 有 `--tools` 白名单 | 一等 |
| workbuddy | 任意行 | `plan` 近似只读 | 一等 |
| opencode | 任意 message id | `--agent plan` 只读 | 一等（fork 需临时 `opencode serve`；回收不用起进程，删除直连 `opencode.db`，已核实 `opencode-session-synchronizer.provider.ts:114-140`） |
| zcode | 任意 message | `--mode build` 可拒写 | 二等：**默认不传锚点**（fork 整段，见 §5.2 更正）；只有用户从中间指定时才可能 409 |
| codex | **仅 turn 粒度** | 无只读档 | 二等（锚点降级，`anchorDegraded`） |
| cursor / dsh / openclaw | 无 fork | — | 不支持，按钮隐藏 |

能力位建议加 `supportsBtw: boolean`（由 `supportsSessionForking` 派生也可），前端据此隐藏入口，而不是在组件里按 provider id 分支（沿用能力矩阵的既定原则，见 `provider-capabilities.service.ts:5-9`）。

---

## 8. 边界与风险

| 风险 | 触发条件 | 处置 |
|---|---|---|
| **副本被广播进侧栏** | 副本文件被 watcher 的 add/change 捕获 | **阻断级**：广播服务按 `is_ephemeral` 过滤（§5.6） |
| **崩溃留下无行孤儿** | fork 成功、建行前进程崩溃 | 两阶段建行，占位行先落库（§5.1） |
| **关闭时副本仍在跑 → 文件被重建、进程失联** | 用户在生成中关抽屉 / 刷新后收敛 | **阻断级**：`DELETE /btw` 必须先 `runtime.abort` 并等 run 终结，再删文件；未终结则 409 `BTW_STILL_RUNNING`（§5.4） |
| **占位窗口漏一条可见行** | fork 写出文件到回填写入之间被 watcher 扫到 | **已定方案 a**：`createSession` 的 INSERT 分支查进程内"正在创建"注册表，命中则写成 `is_ephemeral = 1`；一次性消费 + 回填时校验 + 60s 过期（§5.1）。S1 必须有对应断言 |
| 并发写同一工作区 | 主会话跑着时开 btw | D4 选择允许；抽屉顶部提示，不做技术规避 |
| 锚点粒度降级 | codex | `anchorDegraded` 明示 |
| **fork 正在跑的会话被 provider 拒绝** | codex / zcode 走活 app-server，opencode 需临时 serve；主会话正在跑 turn | D4 允许并发，但 `thread/fork` 是否接受"有活跃 turn"的线程未知（§10-8）。S4 逐个实跑；失败时提示"等主会话这一轮结束再试"，不改 D4 |
| checkpoint 冲突 | zcode，**只有用户从中间指定锚点之后还有文件快照**才触发（默认不传锚点，走整段 fork，永不触发，见 §5.2） | 409 透传 + 可读提示，建议用户改从末尾开 btw |
| 超大会话复制慢 | 数十 MB transcript | 只在第一次发问时复制一次，后续追问复用；S2 就要有加载态 |
| 客户端消失、DELETE 未送达 | 刷新、崩溃、断网 | 周期清扫 + 启动兜底（§5.5、§5.9） |
| 回收后又被索引 | sync 已读到文件、upsert 落在删除之后 | 二次删除 + 进程内 tombstone（§5.7） |
| 权限请求无人应答 | claude + default 模式 + 抽屉未渲染权限卡 | §6.4 必须实现，不能留空 |
| 副本被搜索命中 | 全文搜索直接查 transcript | §5.6 的候选集过滤要覆盖搜索路径 |
| **项目强删漏删副本文件** | 在 `getSessionsByProjectPathIncludingArchived` 这一层直接加过滤 | §5.6 改为"仓储层不过滤、过滤下沉到可见面"，并对项目强删加断言 |
| **抽屉漏发 options → 与主会话行为不一致** | `BtwComposer` 自己手拼 `chat.send.options` | 复用 `buildSendOptions`＋实时镜像 mode（§5.3）；S2 加"故意漏传"回归 |
| **副本事件双写** | 抽屉自建 hook 本地累积，同时全局事件泵也写 store | 改为读共享 store slot（§6.3），并给 store 加 `dropSession` |
| 误删正式会话 | 前端传错 id | §5.4 的 `is_ephemeral` 校验 |
| provider 侧短暂可见 | 副本存续期间，`~/.claude/projects` 等目录里多一个 jsonl，provider 自己的 CLI 会话列表能看到 | **可接受**，关闭即删。实施者不要把它当泄漏去"修"——CloudCLI 无法也不该隐藏 provider 自己的存储 |

---

## 9. 实施切片

**S1｜服务端最小闭环（仅 claude）**
- `is_ephemeral` 列 + 迁移 + `SESSION_ROW_COLUMNS` / `SessionRow` / 归一化（§4.1）
- `POST /btw` / `DELETE /btw` / `PATCH /btw/promote`
- 两阶段建行（占位 → 回填，**含 `jsonl_path` 补写**，§5.1）
- **占位窗口注册表**（`ephemeral-fork-registry.service.ts`：登记 / 一次性消费 / 回填时校验误标并自愈 / 60s 过期；`createSession` 的 INSERT 分支消费它，§5.1）
- **删除前置 abort**（`runtime.abort` + 等终结；超时 409 `BTW_STILL_RUNNING`，§5.4）
- 可见面过滤（侧栏/搜索/未读/计数，**过滤下沉到服务层，仓储层保持全量**，§5.6）+ **广播服务过滤**
- 启动清理 + 周期清扫 + tombstone
- **验收必须是自动化断言，不是手工 curl**：副本创建/删除前后比对①源 transcript 的字节数与 mtime 不变、②`sessions` 行集合不变、③侧栏/搜索/计数查询结果不变；再用同步器测试模拟"文件 add → 广播"路径，断言 `buildSessionUpsertedEvent` 对副本返回 `null`。**新增一条**：副本跑到一半发 `DELETE`，断言①run 收到 abort、②transcript 在删除后不再出现、③没有新行落库（这条挡的是 §5.4 的 abort 前置，手工 curl 测不出来）。**再新增一条（挡方案 a）**：在回填前手动插入一条"watcher 抢先建行"的调用，断言①新行 `is_ephemeral = 1`、②注册表条目已被消费（第二次调用不再命中）、③过期后同一 projectPath 的正常新会话仍为 `is_ephemeral = 0`；④**误标自愈**——构造"被标行的 provider id 与 fork 返回值不一致"的情形，断言该行被改回 `0`（这条挡的是"键按 projectPath、误标正常会话后被周期清扫删掉"）。

**S2｜前端抽屉**
- 按钮 + 抽屉 + `useBtwSession`
- 流式渲染 + 权限卡 + 提示条 + **fork 进行中的加载态**（opencode 起 serve 会明显更久）
- **Stop 按钮**（第二轮自查补）：抽屉内必须能中止当前回合，走 `chat.abort`。没有它，用户想停就只能关抽屉，而关闭＝删副本，正好把 §5.4 的 abort 路径当成唯一出口
- **读共享 store 的 B slot**（第二轮审阅改）：`useSessionStore` 新增 `dropSession`，抽屉不本地累积（§6.3）
- **options 复用共享构造器 + mode 实时镜像**（第二轮审阅改，§5.3）
- **空会话隐藏入口**（会话里还没有用户消息时不渲染按钮，§5.2）
- 验收：
  - 主会话跑长回合的同时开 btw，两边流事件**按 sessionId 不串**、loading 态互不污染；
  - **副本消息只有一份累积**：抽屉渲染的条目与 store 里 B slot 完全同源（不是两份），关闭后 slot 被 `dropSession` 丢弃；
  - **options 逐字段一致**：抽屉发出的 `chat.send.options` 与主会话相同（`permissionMode` / `effort` / `toolsSettings` / `skipPermissions` / `model`），并有一条**反向断言**：故意不发 `permissionMode` 时，claude 的工具调用会卡在权限卡上——证明该字段真的被继承链路用到了；
  - 关闭后侧栏无新增条目；
  - **生成中点 Stop**：回合停下、抽屉仍可用（副本未被删）；
  - 移动视口下聚焦输入框，发送按钮、最后一条消息、键盘三者不重叠。

**S3｜消息级入口**
- 用户消息上的「从这里 btw」
- 验收：从中间消息开 btw，副本内容确实截止在该消息

**S4｜铺开 provider**
- pi / omp / workbuddy / opencode / zcode / codex，逐个实跑
- 验收：矩阵里每一行都跑通一次，降级提示正确

**S5｜收尾**
- 另存为会话、重新 fork
- i18n 两端
- 本文档回写实施结论

---

## 10. 待实测项（不要假设）

1. **prompt cache 是否命中**。推导是"字节级复制 + 同 model + 同 system prompt ⇒ 前缀命中"，但 fork 会重写所有 uuid，`cache_control` 断点位置可能改变。不实测就无法断言 btw 便宜。
2. **每种权限模式下的工具行为**。尤其 claude `default` 模式下权限请求能否从抽屉正常回传。
3. **fork 耗时**随 transcript 大小的曲线。决定要不要加"复制中"的 loading 态。
4. **codex turn 粒度的确切边界**：代码注释声明"含该消息与该轮答案"（`codex-fork.provider.ts:12-21`），但这是对本应用的承诺而非协议保证，仍需实跑确认；同时确认它不吃到"下一轮"，否则码锚点会多带内容。
5. **删除后 watcher 重建的实际概率**。§5.7 已用"二次删除 + tombstone"兜住，但仍值得实测确认窗口是否存在，否则那段加固可能是空转。
6. **主会话正在写 assistant 行时 fork，是否会读到半写行**。§5.2 的容错只覆盖 history 路径；`forkClaudeSession` 是 SDK 内部逐行复制（`claude-fork.provider.ts:40-44`），是否同样丢弃解析失败的行未知。D4 允许"跑着开 btw"，这条路径必然会被走到。
7. **多客户端同时在线时，副本广播过滤是否彻底**。`sendToConnectedClients` 是全体广播（`session-upsert-broadcast.service.ts:100-110`），只要 build 漏一个分支，所有连着的设备都会看到。
8. **fork 一个正在跑 turn 的线程，provider 是否接受**（第二轮自查补）。codex 的 `thread/fork` 与 zcode 的 `session/fork` 都走活的 app-server（`codex-app-server.client.ts:571-581`），opencode 还要临时起 serve。D4 允许并发打开；若 provider 报 "turn in progress"，二等档就变成"必须等主会话空闲"，矩阵与提示条都要改。逐个实跑，别只看文档。
9. **zcode 不传锚点的整段 fork 是否真的不触发 checkpoint 守卫**。代码推导是 `messages[last]` ⇒ 不存在更新的 checkpoint（`zcode-fork.provider.ts:62-77`），但 `session/fork` 在"整段"情况下是否仍 restore 某个快照，要实跑确认。这是把 zcode 从"默认必然 409"改成"默认可用"的唯一依据。
10. **abort 之后 jsonl 是否立刻停止增长**（§5.4 的验收前提）。有些 provider 的 abort 只是断流，进程仍会写完当前块；需要观察 abort 后文件 mtime 在 1s 内停止，否则"删文件"这一步永远赶不上 append。

---

## 11. 开放问题

1. 抽屉宽度 420px 在 13 寸屏上是否会挤主会话到不可用？需要真实截图判断，可能需要"抽屉可拖动调整宽度"。
2. 同一个主会话能否同时开多个 btw 抽屉？**【建议】限制为一个**（多开会让"锚点"语义混乱），但未拍板。
3. model/effort **已定，不再是开放问题**（第二、三轮核实）：`model` 由副本行继承——服务端解析时行内记录优先于请求值（`provider-models.service.ts:512-526`）；`effort` **不能靠行继承**，pi/omp 直接读 `options.effort`（`pi-runtime.provider.ts:100-101`、`omp-runtime.provider.ts:108-109`），必须逐回合发。抽屉复用 §5.3 的共享构造器后两者自动一致，不需要额外 UI。
4. **已定：§5.1 占位窗口选方案 a**（2026-10-21 拍板）。落点是进程内"正在创建"注册表 + `createSession` 的 INSERT 分支消费（不是改同步器），一次性消费 + 回填时校验误标 + 60s 过期。备选 b（新增 `session_deleted` 协议帧）与 c（fork 前预分配 provider id，仅 claude 类可行）已否决。
5. **【建议】抽屉里给 Stop**（已写进 S2）。砍掉它的代价是"想停只能关抽屉"，而关＝删副本，会把 §5.4 的 abort 路径变成用户唯一的停止手段。
6. **【建议】转正时副本仍在跑：不 abort，只翻标记**（已写进 §5.4）。若希望"转正即静默"，那就要 abort，等于转正顺带杀掉正在生成的回答，风险更大。

---

## 12. 第一轮审阅批注与处置

### 12.1 原始批注

#### Claude
> [!CAUTION] 潜在风险：运行中的 watcher 广播会把副本泄进前端。§5.8 只承诺"创建时不广播"，但副本跑 turn 期间 transcript 会变，`sessions-watcher.service.ts:236` 的 `broadcastSessionUpsertedBatch` 会把该 sessionId 广播出去，而它取行走的是 `getSessionById`（`session-upsert-broadcast.service.ts:35`）——恰好是 §5.6 明确要求**不过滤**的那个查询。结果是所有客户端收到 `session_upserted`，I3（不进侧栏）当场破防。§5.6 的过滤清单需要补一条：广播服务在取行后对 `is_ephemeral = 1` 的行直接跳过（或在 watcher 入队前过滤），否则 §5.8 的三条"不做"全是空头支票。

> [!CAUTION] 潜在风险：fork 成功 → 建行失败之间有个崩溃窗口，产物比孤儿更糟。§5.1 的顺序是先调 `forkSession`（provider 侧已产出新 jsonl）再 INSERT。若进程在两步之间崩掉，留下一个无 DB 行的 transcript 文件，下次 watcher 扫描会把它索引成**可见的正式会话**（F2 的机制反向生效）。§5.5 的启动清理只扫 `is_ephemeral = 1` 的行，看不见这种"从未建行"的孤儿。建议：要么反过来先建行（`is_ephemeral=1` + 状态标记）再 fork、失败时行还在可被启动清理兜住；要么接受现状但必须把这一窗口写进 §10 去实测触发概率。

> [!WARNING] 潜在风险：双订阅互扰未验证。§6.3 假设抽屉用 `chat.subscribe({ sessions: [{ sessionId: B, lastSeq: 0 }] })` 独立订阅，但主会话的流由 `useChatSessionState` 持有且其 loading 态、seq 记账都键在"当前会话"上。两次 subscribe 是叠加还是替换、事件如何按 sessionId 分发回两个 UI 消费者，方案没有给出结论。S2 验收里应显式加一条：抽屉流式输出期间主会话同时跑长回合，两边事件不串、loading 态不互相污染。

> [!WARNING] 潜在风险：fork 读到半写行。§5.2 论证了锚点读取有容错（丢弃解析失败的行），但那是 history 路径；fork 本身（claude 走 `forkClaudeSession`，见 `claude-fork.provider.ts:40-44`）在主会话**正在写** assistant 行时逐行复制，是否同样容忍半写行是另一个未知数，§10 没列。D4 允许跑着开 btw，这条路径必然被踩到，建议补进 §10 实测项。

> [!IMPORTANT] 关键信息：§5.6 的过滤清单是枚举式的，会随代码演化过期。建议实施时用"grep 所有对 sessions 表的列表型 SELECT"做一次全面清点（含跨项目的最近会话、未读统计、项目计数），把清单写在实施结论里而不是文档里。另外 §5.7 的"删除后立即再删一次"其实盖不住竞态——watcher 可能已持有文件列表、其 upsert 落在二次删除**之后**。若按第一条 CAUTION 把 ephemeral 感知做进 watcher/upsert 路径（如进程内记住刚删除的 provider_session_id 集合，sync-upsert 遇到即跳过并顺手删文件），可同时解决广播泄漏与重建竞态，且不需要 tombstone 表。

> [!TIP] 建议：opencode 的删除路径已核实为直连 sqlite 清共享库（`opencode-session-synchronizer.provider.ts:114-140`），无需临时 serve，S4 铺开时只有 fork 侧有启动开销——建议把 §10-3 的"fork 耗时 loading 态"提前到 S2 就做，否则 opencode 用户第一问会面对无反馈的空白期。

> [!NOTE] 补充说明：btw 存续期间，provider 侧副本（如 `~/.claude/projects` 里的新 jsonl）在 provider 自己的 CLI 会话列表里可见，CloudCLI 无法也不必隐藏；关闭即删，属于可接受的短暂外泄，建议在文档里写明，避免实施者当成泄漏去"修"。

> [!TIP] 建议：`PATCH /btw/promote` 需要补两处细节——title 的默认值与合法性校验（空串/超长），以及转正后应广播 `content` 级变更让侧栏立即出现且排序到正确位置；§6.6 只写了"广播 session_upserted"，粒度没定。

> [!IMPORTANT] 关键信息（第二轮核查）：§6.3"自建 hook 本地累积、不渗进全局 store"的隔离假设**不成立**。前端只有一条 WebSocket、一个全局事件泵 `useChatRealtimeHandlers.handleEvent`，它按 `msg.sessionId` 路由且**不丢弃非活跃会话的事件**——B 的 `stream_delta`/`complete`/`status` 会照常写进共享 `sessionStore`（`src/modules/chat/hooks/useChatRealtimeHandlers.ts:172` 起），与抽屉自己的 `useBtwSession` 形成双份累积。服务端侧倒没问题：`chat.subscribe` 支持多会话、`attachConnection` 按会话键挂接（`chat-websocket.service.ts:512-570`）。实施前必须二选一并写进方案：(a) 全局 handler 对非活跃会话的事件加 sid 过滤（改动小但影响所有现有语义）；(b) 抽屉直接读全局 sessionStore 里 B 的 transcript，放弃本地累积（与 §6.3 的"不复用"结论相反，但更贴现状）。

> [!WARNING] 潜在风险（第二轮核查）：§5.3"权限模式继承"的落点比文档写的脆弱。`permissionMode` **不是** chat.send 的协议字段，只是随 `options` 原样 spread 进 runtime（`chat-websocket.service.ts:276-288`）；它也不存于 session 行，纯属前端 UI 态（`ChatInterface.tsx:476`）。两个后果：(a) 抽屉自建 hook 后必须从 ChatInterface 显式拿到主会话当前 mode，且要定义"fork 时刻快照"还是"实时跟随"——用户在抽屉打开期间切换主会话模式时行为未定义；(b) 一旦漏传，claude 运行时静默落到 `default`（`claude-runtime.provider.js:254`），工具全卡在权限卡上，表象与 §8"权限请求无人应答"相同但根因不同，排查会很绕。建议：S2 验收加一条"漏传 permissionMode"的回归用例，并让抽屉把 mode 选择器置灰、始终镜像主会话。

> [!NOTE] 补充说明（第二轮核查）：即使用户正确继承了模式，服务端全局设置仍会覆盖它——`settings.skipPermissions` 为真时非 plan 模式一律被改写成 `bypassPermissions`（`claude-runtime.provider.js:264-265`）。"继承主会话权限模式"的准确语义是"继承 UI 态，服务端设置照常生效"，建议写明，避免验收时 bypass 场景对不上。

> [!NOTE] 补充说明（第二轮核查）：F1（resolveSendTarget / RUN_IN_PROGRESS）、F5（删除顺序 transcript → provider store → 行，含 superseded 路径清理）均核实成立，仅行号有数行漂移；§5.4"抽出不广播的内部方法"可行，`deleteOrArchiveSessionById` 本身确实不广播，广播发生在其调用方。

#### Codex
> [!IMPORTANT] 关键信息：§6.3 的目录布局与前端模块规范不一致。当前仓库把 `chat` 作为 `src/modules/chat/` 这一 feature module，规范要求 hook 放在 `src/modules/<feature>/hooks/`；方案却把 `useBtwSession.ts` 放在新建的 `src/modules/chat/btw/` 根目录，并把它称为独立模块。应明确二选一：若 btw 是独立 feature，就建 `src/modules/btw/`（含自己的 `index.ts`、`hooks/`）；若它是 chat 的子能力，就保留 `src/modules/chat/`，把 hook 放进 `src/modules/chat/hooks/`，不要在同一层级混用“模块”定义。否则后续 import 边界、barrel 导出和测试归属都会漂移。

> [!WARNING] 潜在风险：§6.2 的移动端 `inset-0` 只解决覆盖范围，没有处理输入框底栏、软键盘和安全区。`BtwComposer` 在全屏抽屉中会被 iOS/Android 键盘顶起或遮住，消息列表的可视高度、滚动锚点和 `Escape`/返回手势也可能与现有聊天输入底栏冲突。方案应明确移动端采用何种 fixed/sticky 结构（含 `visualViewport`/safe-area 处理），并在 S2 增加真机或 Playwright 移动视口验收：聚焦输入框后发送按钮、最后一条消息和键盘都不重叠。

> [!WARNING] 潜在风险：清理生命周期只覆盖显式关闭和下次服务启动（§5.4–§5.5），没有覆盖浏览器崩溃、刷新、断网导致 `DELETE /btw` 未送达的情况。此时副本行和 provider transcript 会一直保留，既违反 I4，也会让 provider 自身的 CLI 会话列表持续出现垃圾项。建议增加基于 `created_at`/`updated_at` 的 TTL 回收或后台周期清扫，并把“客户端消失但服务仍运行”的场景写入 S1/S5 验收；仅靠组件 `destroy()` 和启动兜底不够。

> [!TIP] 建议：S1 的验收目前是手工 curl，无法守住 I1–I4。至少补自动化断言：副本创建/删除前后的源 transcript 字节数与 mtime、`sessions` 行集合、侧栏/搜索/计数查询结果，以及删除后 watcher 触发是否会重建；把 §5.7 的竞态从“概率实测”提升为可重复的同步器测试。

> [!CAUTION] 潜在风险：§5.6 把 `getSessionsByProjectPathIncludingArchived` 也列入 `is_ephemeral = 0` 过滤清单，但这个仓储方法同时服务两个相反场景：`projects-with-sessions-fetch.service.ts:185-195` 需要向项目视图返回会话，`project-delete.service.ts:45-50` 则必须枚举包括隐藏副本在内的全部 transcript 才能清理文件。若统一过滤，项目强删会漏删 ephemeral 文件；若不过滤，项目会话接口又会泄出副本。应拆成“可见列表查询”和“清理专用全量查询”，明确各自 caller，并分别补项目删除、项目列表、隐藏副本三组测试。

> [!WARNING] 潜在风险：§5.3/§11-3 把 model、effort 的继承写成默认行为，但 `chat.send` 的这些值来自**当次请求的 `options`**；`chat-websocket.service.ts` 只有在 `clientOptions.model/effort` 存在时才写回 session，且 `useChatComposerState.ts` 还会同时发送 `toolsSettings`、`skipPermissions`。仅在 `createForkedSession` 里复制 `source.model/effort`，不会让后续抽屉回合自动使用它们；方案又只明确透传 `permissionMode`。若 `BtwComposer` 漏发这些字段，D2 的“完整工具、继承权限”会与主会话产生实际差异。应明确由前端逐回合发送完整 options，或由服务端从副本/源会话解析，并在 S2 覆盖 model、effort、工具白名单、skipPermissions 的继承验收。

> [!IMPORTANT] 关键信息：`is_ephemeral` 不是只改 schema 和 `createForkedSession` 就完成的单点字段。`sessions.db.ts` 的 `SessionRow`、`SESSION_ROW_COLUMNS`、各 `SELECT`/归一化结果，以及 `session_upserted` 构造、项目会话 API/共享类型都要有明确的字段流向；尤其广播服务需要能读到该字段才能跳过副本。实施清单应把这些消费者写全，并区分“内部清理必须读到”与“普通 API 不得返回”两种契约，避免字段只写不读或误暴露。

---

### 12.2 逐条处置

| # | 批注 | 判定 | 处置与理由 |
|---|---|---|---|
| C1 | watcher 广播会把副本泄进前端 | **采纳（阻断级）** | 复核为真：`buildSessionUpsertedEvent` 只挡 `isArchived`（`session-upsert-broadcast.service.ts:35-37`），watcher 的 add/change 都会走 batch 广播（`sessions-watcher.service.ts:233-238,295-300`）。原 §5.8 的"不广播"只是不主动调，挡不住 watcher。已在 §5.6 定为必须修的阻断项，修法单点：该函数加 `is_ephemeral` 判断。 |
| C2 | fork 与建行之间崩溃 → 孤儿被索引成可见会话 | **采纳，改设计** | 复核为真：`forkSession` 先写文件（`claude-fork.provider.ts:36-52`），建行在后；`createSession` 的 INSERT 分支让 `is_ephemeral` 取默认 0。已把 §5.1 改为**两阶段建行**（先插占位行再回填），代价是 `createForkedSession` 要拆成两个动作。 |
| C3 | 双订阅互扰未验证 | **部分采纳** | 服务端侧已复核：`attachConnection` 以 sessionId 为键，同一 socket 可挂多个会话，不存在"后订阅替换前订阅"（`chat-websocket.service.ts:540-548`）。前端按 sessionId 分发未核实，已写进 S2 验收而不是在这里下结论。 |
| C4 | fork 是否容忍半写行未知 | **采纳** | `forkClaudeSession` 是 SDK 内部，代码不可读，只能实测。已列为 §10-6。 |
| C5 | 枚举清单会过期；二次删除盖不住；建议 tombstone | **部分采纳，并更正两处定性** | ①"枚举清单会过期"采纳——清点结果写进实施结论，文档清单只作初始范围。②"watcher 已持有文件列表"**不准确**：它是逐文件 `synchronizeProviderFile`，同步成功才入队（`sessions-watcher.service.ts:295-300`）；文件已删时 sync 抛错、不建行，这条路是安全的。真正的窗口是"已读到内容、upsert 落在删除之后"（Unix 下 unlink 不阻断已打开的 fd），毫秒级。③tombstone 采纳并已写进 §5.7，但按上述更正把严重性下调为"低概率、后果可见"。 |
| C6 | opencode 删除不需要临时 serve | **采纳** | 复核为真：`deleteProviderSession` 直连 `opencode.db` 用占位符删表（`opencode-session-synchronizer.provider.ts:114-140`）。已修正 §7。 |
| C7 | provider 自己的 CLI 列表能看到副本 | **采纳** | 属可接受外泄，已写入 §8 并注明"不要当泄漏去修"。 |
| C8 | promote 的标题校验与广播粒度 | **采纳** | 已补进 §5.4：空串/超长拒绝；广播用 `metadata`（用 `content` 会触发 `stampFallbackContentTimestamp` 误点未读，`session-upsert-broadcast.service.ts:141-147`）。注意现有 `renameSessionById` 完全无校验（`sessions.service.ts:1157-1168`），这里是刻意更严。 |
| X1 | 目录布局违反前端规范 | **采纳** | 原写法把 hook 放在新建的 `chat/btw/` 根下，与规范"hook 归 `hooks/`"冲突。已改为：btw 是 chat 的子能力、不新建模块（不建 barrel），组件进 `chat/btw/`，hook 进 `chat/hooks/`。 |
| X2 | 移动端键盘与安全区 | **采纳** | 已补进 §6.2，并指向仓库现成的 `useVisualViewportKeyboardOffset`（`src/modules/project-workspace/hooks/useVisualViewportKeyboardOffset.ts:37`）而不是另写一套监听。S2 增加移动视口验收。 |
| X3 | 刷新/崩溃导致 DELETE 未送达 | **采纳** | 原方案只有启动清理，盖不住"服务连续运行数天"。已新增 §5.9 周期清扫（`updated_at < now - 6h`），并明确"刷新丢抽屉是预期行为"。 |
| X4 | S1 验收要自动化 | **采纳** | 已改写 S1 验收为四组断言，并把 §5.7 的竞态转成同步器可重复测试。 |

### 12.3 未采纳 / 实施时再判的

- **没有驳回任何一条**，但有两条改了定性（C2 的严重性、C5 的"持有文件列表"描述），理由见上表。
- C5 提到的"把 ephemeral 感知做进 watcher/upsert 路径，可同时解决广播泄漏与重建竞态"——只采纳一半：广播泄漏用 build 过滤解决（更靠上、单点），重建竞态用 tombstone 解决。不把两件事合并进 watcher，因为 watcher 不该知道"某个会话为什么不可见"。

---

## 13. 实施前自查（写于第一轮审阅之后，未送审）

第一轮处置完成后，对着代码把正文的关键断言逐条复核了一遍，目的是找"照文档写会跑不通"的地方。共 9 条：6 条设计漏洞、3 条表述与代码不符。**全部已回写正文**，其中 **N2 已拍板为方案 a**（2026-10-21，会改变 S1 范围），3 条转入 §10 待实测。

第一轮的结论没有被推翻；C3 的服务端部分（`attachConnection` 按 sessionId 挂多个会话）复核后仍然成立。**但本节 B1 自身的判断后来被判错**（前端其实会发送 `permissionMode`），见 §14 的 R2——自查也会出错，这一条保留原文并划掉，不悄悄改写。

### 13.1 设计漏洞

| # | 问题 | 证据 | 处置 |
|---|---|---|---|
| N1 | **关闭抽屉时副本仍在跑 → 文件被重建、进程失联**（阻断级；原方案完全没写） | `deleteOrArchiveSessionById` 全函数无任何 abort 调用（`sessions.service.ts:1008-1105`）；CLI 继续 append 会让已 `unlink` 的 jsonl 重现，watcher 下一轮 polling 即 INSERT 出 `is_ephemeral = 0` 的可见行 | §5.4 改为 **abort → 等终结 → 删文件 → 清库 → 删行**；超时返回 409 `BTW_STILL_RUNNING`。通道复用 `chat.abort`（`chat-websocket.service.ts:429-457`），不新增协议。S1 增一条自动化验收（跑到一半删） |
| N2 | **两阶段建行的占位窗口会漏一条可见行** | 占位行 `provider_session_id = NULL`，`createSession` 按该列找行（`sessions.db.ts:191-194`）必然找不到 → INSERT 取默认 0；`assignProviderSessionId` 事后合并删除，但全仓无 `session_deleted` 广播（grep 零命中）⇒ 已推给客户端的条目变侧栏幽灵 | **已拍板方案 a**（2026-10-21）：进程内注册表，`createSession` 的 INSERT 分支命中即写 `is_ephemeral = 1`，一次性消费 + 60s 过期，详见 §5.1 与决议 D5 |
| N3 | **`assignProviderSessionId` 不回填 `jsonl_path`** | 该函数无重复行时只 UPDATE `provider_session_id`（`sessions.db.ts:483-488`） | §5.1 第 5 步拆成"合并 + 补写 `jsonl_path`"两步，并写明漏掉的后果（删除定位不到文件、§5.9 的 mtime 判据失效） |
| N4 | **zcode 的默认锚点必然 409** | `planZcodeFork` 判据＝"存在比锚点更新的 checkpoint 就拒绝"（`zcode-fork.provider.ts:62-77`）；默认锚点＝最后一条用户消息，其后的助手轮只要改过文件就必留 checkpoint | §5.2 改为 **zcode 默认不传锚点**（fork 整段，走 `messages[last]`，永不触发守卫）；从中间指定才可能 409。§7 矩阵同步更正 |
| N5 | **fork "正在跑的线程" 是否被 provider 接受，未验证**（codex/zcode/opencode） | 两者都走活的 app-server（`codex-app-server.client.ts:571-581`），opencode 还起临时 serve；第一轮只测了 claude 的半写行 | 进 §10-8；§8 风险表补一行，失败时降级为"等主会话这一轮结束"而不改 D4 |
| N6 | **转正撞上"副本正在跑"没有口径** | 原 §5.4 只写了标题与广播 | 定为**不 abort、只翻标记**；前端置 `promoted`，`destroy()` 遇已转正跳过 `DELETE`。并核对同步 UPDATE 整条语句不含 `is_ephemeral`（`sessions.db.ts:202-225`），不会被改回 1 |

### 13.2 表述与代码不符

| # | 原文断言 | 实际情况 | 处置 |
|---|---|---|---|
| B1 | "前端发 `chat.send` 时把主会话的 `permissionMode` 原样带上" | ~~前端从未发送~~ **本条判错，已被第二轮审阅推翻**：前端**确实**在 options 里发送（`src/modules/chat/ChatInterface.tsx:476`、`useChatComposerState.ts:666-689`），mode 是 `useChatProviderState` 的 UI 态（`:202,555`），既不是"不存在该字段"也不是"全局唯一"。真实风险是**抽屉自建后漏发**，以及服务端 `skipPermissions` 会覆盖它 | §5.3 已重写为三层（UI 态 / 每回合 options / 服务端覆盖），并要求复用共享构造器＋实时镜像；§6.4 的前提说明同步更正 |
| B2 | "`is_ephemeral` 只需 schema + 迁移" | 列不进读路径（`SESSION_ROW_COLUMNS`／`SessionRow`／`normalizeSessionRow`）时，`buildSessionUpsertedEvent` 的 `row.is_ephemeral` 恒为 `undefined` | §4.1 增加一条"列必须进入读路径"，并点明否则 §5.6 的阻断级修复是空转 |
| B3 | "四个错误码" | 实际五个：锚点非法（含"还没有用户消息"）／非 ephemeral／标题非法／仍在运行／源会话已被删 | §6.7 更正为五个并列出 |

### 13.3 自查遗留

- **已拍板**：§11-4（N2 的 a/b/c）→ **方案 a**（2026-10-21）。S1 范围据此包含注册表服务与一条"抢先建行"断言。
- **待实测**：§10-8（fork 活跃线程）、§10-9（zcode 整段 fork 是否仍 restore 快照）、§10-10（abort 后 jsonl 是否 1s 内停止增长）。
- **无驳回**，也无对第一轮结论的推翻。第二轮审阅复核了本节引用的 F1/F5，结论成立，仅行号有数行漂移。

---

## 14. 第二轮审阅批注与处置（2026-10-21）

7 条（Claude 4 条 + Codex 3 条），原文已并入 §12.1 对应标题下并标注"第二轮核查"。**7 条全部采纳**，其中四条改动了结论或归因：R1 推翻了 §6.3 的隔离假设，R5 改写了 §5.6 的过滤策略，R2 推翻了 §13 自己给出的 B1 判断，R3 的事实成立但归因被更正。

| # | 批注 | 判定 | 处置与理由 |
|---|---|---|---|
| R1 | 前端全局事件泵会把副本事件写进共享 store，"自建 hook 本地累积"不成立 | **采纳，改设计** | 复核为真：单 WebSocket，`handleEvent` 按 `msg.sessionId` 路由且不丢弃非活跃会话（`useChatRealtimeHandlers.ts:172-330`），`sessionStore` 按 sessionId 分槽且切换不清空（`useSessionStore.ts:1-8`）⇒ 订阅即双写。§6.3 改为复用 store 的 B slot；**否决**"给全局 handler 加非活跃会话丢弃"，那会连带杀掉后台会话流式与 attention。附带一项新增：store 没有删槽 API，需加 `dropSession` |
| R2 | `permissionMode` 是前端 UI 态；漏传会静默落 `default` | **采纳，并推翻 §13 的 B1** | 我上一轮判定"前端从未发送该字段"是**错的**：`ChatInterface.tsx:476` 与 `useChatComposerState.ts:666-689` 都在发，mode 来自 `useChatProviderState.ts:202,555`。§5.3 重写为三层；口径定为**实时镜像 + 抽屉内选择器置灰**（选快照会 fail-open：主会话收紧权限时抽屉还在按旧的高权限跑） |
| R3 | `skipPermissions` 会覆盖前端传来的 mode | **采纳事实，更正归因** | 覆盖确实存在（`claude-runtime.provider.js:264-266`），但**覆盖源不是"服务端全局设置"**：`settings` 就是客户端传来的 `toolsSettings`（`:258-261`），其值来自该 provider 的用户偏好（`useChatComposerState.ts:666-674`）。所以它是"同一请求内的覆盖"而非服务端二次裁决。§5.3 第三层与 §6.4 的前提说明按此更正 |
| R4 | F1/F5 复核成立，仅行号漂移 | **采纳（无设计变更）** | 不逐处重排行号（文档开头已声明行号可能漂移）；§13 已注明 F1/F5 复核成立 |
| R5 | `getSessionsByProjectPathIncludingArchived` 同时服务项目视图与项目强删，统一过滤会漏删副本文件 | **采纳，改策略** | 复核为真：`project-delete.service.ts:45` 靠这张表删 jsonl，过滤即漏删；`projects-with-sessions-fetch.service.ts:186` 才需要过滤。§5.6 从"仓储层一刀切"改为"仓储层不过滤、过滤下沉到可见面"，四个方法的双向 caller 已列全，项目强删加断言 |
| R6 | `model`/`effort` 来自每回合 `options`，只复制行不管用 | **采纳** | 部分修正：`model` **能**靠行继承（`resolveResumeModel` 行内优先，`provider-models.service.ts:512-526`）；`effort` 不能，pi/omp 直接读 `options.effort`（`pi-runtime.provider.ts:100-101`、`omp-runtime.provider.ts:108-109`）。§5.3 三层表 + §11-3 改写，S2 增"options 逐字段一致 + 故意漏传"的正反断言 |
| R7 | `is_ephemeral` 要写全字段流向，并区分"内部必须读到"与"API 不得外露" | **采纳（与 §13 的 B2 合并）** | §4.1 保留；新增下面的契约二分表，实施清单按表逐项勾 |

### 14.1 `is_ephemeral` 的契约二分（R7 具体化）

| 消费者 | 读不读该列 | 契约 |
|---|---|---|
| `buildSessionUpsertedEvent` | **读** | 命中即返回 `null`，不广播 |
| 启动清理 / 周期清扫 / 项目强删 | **读** | 用全量查询，**不得**过滤 |
| 侧栏 / 搜索 / 未读 / 项目计数 | 不直接读 | 由服务层过滤，仓储层保持全量 |
| 普通会话 API 的 DTO | 不读 | 字段不进 DTO，避免把内部标记变成前端契约 |
| 同步器 upsert | 不读 | 只按 `provider_session_id` 合并，不因标记改变写入行为。方案 a 的注册表是**仓储层 INSERT 分支的进程内旁路**（§5.1），不是同步器读该列，本行不因此变化 |

这张表是实施时的勾选清单：**每一行都要有对应测试**，尤其是第 2 行（漏了只会静默留文件）和第 1 行（漏了当场破 I3）。

### 14.2 本轮之后还剩什么

- **已拍板**（2026-10-21，第二轮之后追加）：§11-4 占位窗口 → **方案 a**。S1 因此多一个 `ephemeral-fork-registry.service.ts` 与一条"回填前抢先建行"的断言；b/c 已否决。
- **仍待实测**：§10-8/9/10。
- **新进 S2 的工作量**：`dropSession`、options 共享构造器、mode 置灰镜像（本轮新增）＋ Stop（§13 已补）——这四项在原 S2 里都不存在。
- **没有遗留的分歧**：7 条全部采纳，无驳回。但两边的判据都要复算：R2 是"审阅者推翻了我"（我上一轮把"协议类型里没有该字段"误当成"链路上没有发送"）；R3 是"我采纳了事实、更正了审阅者的归因"（覆盖源是客户端偏好，不是服务端设置）。这两条互为镜像，说明**结论和归因都得回代码里对一遍**，不能只对一半。
