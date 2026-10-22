# CloudCLI 侧边提问（btw）功能方案

> **文档性质**：实施方案。第 2 章是代码可核对的事实，第 3 章之后是设计决定；凡标 **【建议】** 的段落都欢迎推翻。
> **状态**：**S1、S2 已实施完成**（2026-10-21）。S1 落地清单与偏差见 §16，S2 见 §17。**S3 的消息级入口已随 S2 一起落地**（只剩真机验收），S4 未开始。已吸收三轮外部审阅（第一轮 12 条见 §12、第二轮 7 条见 §14、第三轮 8 条见 §15）与一轮实施前自查（§13，其中 1 条后被第二轮推翻）。**无待拍板项**；§11 中第 2/5/6 条仍是带【建议】的默认取值。
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

**锚点字段必须是 `forkAnchorId`，不是 message id（第三轮批注，接口阻断项）**。`NormalizedMessage` 区分三个 id：`id`（可能是读取时合成的展示 id）、`transcriptAnchorId`（编辑用）、`forkAnchorId`（fork 用，`server/shared/types.ts:398-415`）。codex 的 `id` 每次读取都会变，真正能传给 `thread/fork` 的是 `turnId`；现有前端 fork 也明确发送 `message.forkAnchorId`（`src/modules/chat/ChatInterface.tsx:432-437`）。沿用 `upToAnchorId` 这个名字但塞 generic id，会在 codex 上把展示 id 当 `lastTurnId` 传下去。

请求：

```json
{ "anchorForkId": "可选，provider 的 fork 锚点（来自 message.forkAnchorId）",
  "anchorMessageId": "可选，仅用于服务端校验与前端回显",
  "title": "可选" }
```

响应：

```json
{ "sessionId": "...", "provider": "claude", "projectPath": "...",
  "anchorForkId": "...", "anchorMessageId": "...",
  "anchorDegraded": false, "anchorSource": "default|explicit" }
```

- `anchorForkId` 是**实际生效**的锚点；`anchorMessageId` 是它在本次历史里的对应消息（前端用它显示"截至第 N 条消息"，并校验用户选的那条仍在）。
- `anchorDegraded` 为真表示 provider 把锚点放大到了更大的粒度（codex：turn；zcode 默认：整段），此时 `anchorForkId` 返回放大后的值。
- 两个字段都传时以 `anchorForkId` 为准；只传 `anchorMessageId` 时服务端按历史查它的 `forkAnchorId`，查不到即 400 —— 这条是**兼容前端手误的闸，不是主路径**。

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

**2026-10-22 修订：剪点从「被点的那一行」改为「该行的轮末」。** 原文只认用户文本消息，理由是「以助手消息收尾会切在回复中间」。实测推翻了这条（十家矩阵，见 §17.11）：真正切在回复中间的不是「助手行」，而是「同一轮里还没走完的工具往返」；而剪在提问行会让副本里留下一条**没人回答的问题**，provider 把它当成待办——pi / omp 会在旁问旁边把它重答一遍，claude 会补一条 `No response requested.`。

- **可切的锚点是「带 `forkAnchorId` 的 user/assistant 文本行」**。工具行不算，即使 provider 给它们盖了锚点（pi / omp / zcode 是逐行盖）：一次调用还没拿到结果时，那是轮中而不是轮末，停在调用与结果之间是 provider 可能拒绝恢复的转录。判据仍是 `kind === 'text'`，不是 `role === 'user'` 一项（claude 的填法见 `claude-sessions.provider.ts:1250-1265`）。
- **请求里的锚点只是游标，不是剪点**：服务端从该行往下扫，遇到下一条真正的用户提问（`role === 'user' && kind === 'text' && !isCompactSummary`）之前停下，取范围内**最后一条可切的文本行**作为剪点。被点的行本来就在轮末时，剪点就是它自己，不移动。
- 请求未传锚点时，取**最后一条可切行**，也就是最后一轮的末行——同一套语义，不需要第二套规则。若最近这条没有锚点（claude 对缺 `uuid` 的行会整条不填锚点），**继续往前找**，不报错；实际生效到第几条由 `anchorMessageId` 如实反映（它回填的是**剪点**，不是被点的那行），提示条会显示。
- 会话里一条可切行都没有（刚建好、还没发过话，或 provider 全不给锚点）→ 400 `BTW_ANCHOR_INVALID`；前端在拿不到此类消息时直接隐藏入口，不发请求。
- 请求传了 `anchorForkId` 但该值不属于该会话的可切行（包括落在工具行上）→ 400 `BTW_ANCHOR_INVALID`。只传 `anchorMessageId` 时按历史查它的 `forkAnchorId`，查不到同样 400。
- 主会话正在跑时，"最近一条可切行"是已落盘的完整行，**剪点选取**不会读到半写行（历史读取本身也会丢弃解析失败的行，`claude-sessions.provider.ts:493-495`）。注意：这只保证**剪点**正确，不保证 fork 复制过程本身能容忍半写行——那是 §10-6 的待实测项。
- **codex 的 `forkAnchorId` 就是 `turnId`**（`codex-sessions.provider.ts:2321,2345` 直接写 `raw.turnId`），同一 turn 内的用户消息与助手消息共享一个值。所以"以用户消息为锚点"在 codex 上必然放大到该轮结束，`anchorDegraded: true`，前端提示"上下文截至该轮结束"。
- zcode 是唯一"默认锚点会必然失败"的 provider（第二轮自查，属于设计缺陷不是降级）：`planZcodeFork` 的判据是"存在比锚点更新的 workspace checkpoint 就拒绝"（`zcode-fork.provider.ts:62-77`）。我们的默认剪点是**最后一条可切行**，而它之后的那一轮只要动过文件就必留 checkpoint ⇒ 默认路径直接 409（剪点后移到轮末只减少了差距，没消除：该轮的 checkpoint 写在该轮消息之后）。文档上一版给的补救"从末尾开始"在语义上不成立：不传锚点时 zcode 取的是最后一条消息（可能是助手消息），与本方案"只接受用户消息"冲突。
  **处置**：zcode 的默认路径改为**不传锚点**（等于 fork 整段对话，`planZcodeFork` 走到 `messages[last]`，永远不触发 checkpoint 守卫）；只有用户从中间指定锚点时才可能 409，此时按原样透传并提示"该位置之后有文件快照"。即：zcode 的"从末尾 btw"等价于"当前全部上下文"，比原生 btw 多带一条正在生成的助手消息——这是可接受的偏差，需在抽屉提示条里说明。
- **响应的 `anchorForkId` 是唯一可回传给 fork 的值**，`anchorMessageId` 只服务 UI（显示"截至第 N 条"、校验用户选的那条还在）。zcode 默认路径不指定锚点，所以 `anchorForkId` 返回 `null`、`anchorMessageId` 返回它内部实际取到的那条消息，`anchorDegraded: true`——与 codex 的"降级到轮"共用同一个布尔位，但文案不同（前端按 provider 区分，见 §6.5）。

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

- **还有第三种"没在跑，但也没停"的状态：background task（第三轮批注）**。仓库明确区分两类忙：有 run 的（`background: false, canInterrupt: true`）和"回合已结束但后台任务还在跑"的（`background: true, canInterrupt: false`，`server/modules/providers/services/sessions.service.ts:31-45`）。后者**没有 run 可 abort**，只能用 `chat.stop-task`（按 taskId 逐个停，`chat-websocket.service.ts:459-500`、前端同样用法 `BackgroundTasksStrip.tsx:146`）。所以删除前置要做两步判定：
  1. 查该会话在 `getRunningSessions` 里的条目；
  2. `canInterrupt: true` → `runtime.abort` 并等终结；`background: true` 且有 `tasks` → 对每个 taskId 发 `chat.stop-task` 并等其消失；两者都为假（无非就是空闲）→ 直接进删除。

  漏掉第 2 步的后果与漏掉 abort 一样：任务仍在写 provider 存储/工作区，删掉的 jsonl 会被重新 append 出来，watcher 再索引成可见会话。**`chat.abort` 不能替代 `chat.stop-task`**，两者覆盖的是不同状态。
- **§5.9 的周期清扫必须走同一套前置判定**，不能只看 `updated_at` 就删：一个 6 小时没人打开、但后台任务仍在跑的副本，扫到就删同样会把会话"复活"成可见行。清扫的实现应当是"挑出候选 → 逐个执行与 `DELETE /btw` 完全相同的清理函数"，而不是另写一条 SQL 路径。
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
| `getAllSessions` | `claude-session-synchronizer.provider.ts:416`：legacy 标题回填，查询本身不该被收窄 | `session-conversations-search.service.ts:1198`：**搜索候选集** |

**搜索这一格是全表最容易漏、也最容易做对的（第三轮批注）**：正文搜索的候选集就是 `getAllSessions() + getArchivedSessions()`（`session-conversations-search.service.ts:1198-1199`），ripgrep 拿的是这两个函数给出的**显式文件清单**、不做目录扫描。所以只要在这两个函数的可见面版本上过滤，标题搜索与正文搜索**同时覆盖**，不需要再按服务逐个枚举。这也是为什么 `getAllSessions` 必须进上表——按"搜索服务"为单位想，很容易只记得改 `getArchivedSessions` 那一半。

处置：

1. 仓储层保留"全量"语义，另加 `...Visible` 变体，或在**服务/DTO 边界**过滤；每个方法的 caller 在实施结论里列全，不靠文档维护清单。
2. `getSessionById` **不过滤**——副本自己跑 turn、抽屉读取历史都走它（`§5.3`）。
3. **项目强删必须有一条断言**："项目里存在的副本 transcript 也被删掉"。这条最容易漏，而且漏了不报错，只在磁盘上留一堆 jsonl。
4. 搜索、未读统计、项目会话计数都属于用户可见面。

**必须同时过滤广播（阻断级，原方案漏了）**：`buildSessionUpsertedEvent` 只挡 `row.isArchived`（`server/modules/websocket/services/session-upsert-broadcast.service.ts:35-37`），而它取行走的是 `getSessionById`——正是本节明确要求**不过滤**的那个查询。watcher 会把副本文件的 `add`/`change` 入队并调用 `broadcastSessionUpsertedBatch`（`server/modules/providers/services/sessions-watcher.service.ts:233-238,295-300`），于是**副本创建那一刻就会广播给所有客户端，侧栏当场出现一条**，I3 直接破防。

修法只有一处：`buildSessionUpsertedEvent` 增加 `row.is_ephemeral` 判断并返回 `null`。单点，不散在 watcher 里。注意 `stampFallbackContentTimestamp` 在 build 之前执行（`session-upsert-broadcast.service.ts:160-161`），会给副本行写 `content_updated_at`；行随后会被删，无害，不必额外拦。

### 5.7 watcher 竞态

**正式 fork 的实际顺序不是"先插行"（第三轮批注，原描述有误）**：`forkSession` 先落盘（provider 侧 transcript 已存在），然后才 `createForkedSession` 建行、`broadcastSessionUpserted`（`sessions.service.ts:575-605`）。所以正式 fork 今天就带着同一个窗口在跑：watcher 可能按 provider 原生 id 抢先建行并广播，随后 `createForkedSession` 的 reclaim 分支 `DELETE` 旧行 + `INSERT` 新行（`sessions.db.ts:399-426`，**新旧 `session_id` 不同**），而全仓没有删除广播 ⇒ 已推给前端的旧 id 条目会作为幽灵留在侧栏，直到刷新。正式 fork 里这个幽灵不被"顶掉"：新行是另一个 id，不是覆盖。

**btw 不走这条路径**：占位行在 fork 之前就已落库（§5.1 第 3 步），注册表保证 watcher 抢先建出的行也是 `is_ephemeral = 1`、并且回填时会合并进占位行（`assignProviderSessionId` 走 duplicate 分支）。也就是说方案 a 顺带让 btw **不存在**"正式 fork 那种幽灵"。

**顺带记录、不在本方案范围**：正式 fork 的幽灵是既有行为，本方案不修。S1 验收时顺便观察一次正式 fork 是否真的留下幽灵——如果留下，说明未来想修时可以直接复用本方案的"占位行 + 注册表"手法。

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
4. `destroy()`：**显式状态机，DELETE 成功才丢 slot**（第三轮批注更正——原写法"DELETE 后丢弃"在失败路径上会把唯一可观察状态扔掉）：
   - `204` → `dropSession(sessionId)` → 关抽屉；
   - `409 BTW_STILL_RUNNING` → **保留抽屉、保留 slot、保留已渲染的消息**，头部显示"正在停止…"并暴露重试；用户能在这里按 Stop 或再点关闭。绝不能先 drop 再删，否则用户既看不到副本也停不掉它，只能等 §5.9 的周期清扫；
   - 已 `promoted` → 跳过 DELETE，直接关（副本已转正，删了就是删用户的正式会话）；
   - 其他错误 → 保留，给出可重试提示。

   这条状态机的判据是"**抽屉是否还能让用户操作这个副本**"：只要 DELETE 没成功，抽屉就不关，slot 也不丢；成功才一次性清干净。**不做"先关抽屉、后台异步删"**，那等于把失败变成一个用户看不见的孤儿。
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

**在支持 fork 的 provider 里，只有 claude 会把工具权限弹到 UI**（`supportsPermissionRequests: true`）。注意这个限定条件（第三轮批注）：**dsh 的 `supportsPermissionRequests` 也是 true**（`provider-capabilities.service.ts:150-160` 的注释写明其 ACP 权限请求会路由到 chat UI），只是它 `supportsSessionForking: false`，所以当前不受影响。写成"claude 是唯一"会在将来给 dsh 开 fork 时照错结论漏掉权限卡。

因此抽屉**按能力位渲染，不按 provider id 分支**：`supportsPermissionRequests` 决定是否挂权限卡，`supportsAbort` 决定是否显示 Stop。这与 `provider-capabilities.service.ts:5-9` 的既定原则一致，也让 S4 铺到 dsh 时不需要改 UI。

默认权限模式下，抽屉里必须能渲染并回传权限请求，否则工具调用会卡住。

现成组件是 `PermissionRequestsBanner`（`src/modules/chat/composer/PermissionRequestsBanner.tsx:26-36`）：**纯受控**，接收 `pendingPermissionRequests` 与两个回调，可以直接放进抽屉的输入框上方，不需要改它。需要自己做的是**按 `sessionId` 过滤**待决请求——浏览器侧拿到的是全局待决列表，主会话与副本的请求必须分开渲染，否则两边会互相看到对方的授权弹窗。权限决策走 `chat.permission-response`（`chat-websocket.service.ts:575-587`），协议本身是 provider 中立的，无需扩展。

其余 provider（当前 = 所有支持 fork 的 provider）不弹权限卡，按各自 CLI 的默认策略执行。

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

新增文案同时改 `zh-CN` 与 `en`（键集以 `en` 为基准，见项目 i18n 策略）。涉及：按钮名、抽屉标题、锚点说明、两个动作、**五个错误码**的用户可读文案：`BTW_ANCHOR_INVALID`（覆盖三种成因："会话里还没有你的消息"／"这条消息不能作为锚点"／"provider 没给这条消息锚点"）、`NOT_EPHEMERAL`、`BTW_TITLE_INVALID`、`BTW_STILL_RUNNING`、`SESSION_NOT_FOUND`（源会话已被删）。上一版写"四个"，第二轮自查更正。

抽屉里的 `409 BTW_STILL_RUNNING` 文案不是错误提示，而是**状态**（"正在停止…"＋重试），所以它需要一条常驻文案而不是 toast（§6.3 的 destroy 状态机）。

---

## 7. Provider 支持矩阵

| provider | fork 锚点（`forkAnchorId` 的真身） | 只读/工具 | 本方案可用性 |
|---|---|---|---|
| claude | transcript 行 `uuid`，只挂在 user/assistant 的 **text** 消息上（`claude-sessions.provider.ts:1250-1265`） | 完整可禁，本方案不禁 | 一等 |
| pi | 分支条目 `entryId`（`pi-sessions.provider.ts:161`） | 有 `--tools` 白名单 | 一等 |
| omp | 分支条目 `entryId`（`omp-sessions.provider.ts:106`） | 有 `--tools` 白名单 | 一等 |
| workbuddy | `eventAnchorId`（`workbuddy-sessions.provider.ts:1054,1104`） | `plan` 近似只读 | 一等 |
| opencode | `message_id`（`opencode-sessions.provider.ts:712`） | `--agent plan` 只读 | 一等（fork 需临时 `opencode serve`；回收不用起进程，删除直连 `opencode.db`，已核实 `opencode-session-synchronizer.provider.ts:114-140`） |
| zcode | `message_id`（`zcode-sessions.provider.ts:439`） | `--mode build` 可拒写 | 二等：**默认不传锚点**（fork 整段，见 §5.2 更正）；只有用户从中间指定时才可能 409 |
| codex | **`turnId`**（`codex-sessions.provider.ts:2321,2345`，同 turn 的 user/assistant 共享） | 无只读档 | 二等（锚点必然放大到轮，`anchorDegraded`）。附：`forkThread` 不转发 `title`（`codex-fork.provider.ts:29-34`），副本在 provider 侧的标题是它自己的默认值；我们只在 DB 行里命名，转正后侧栏显示的是我们的名字，可接受 |
| cursor / dsh / openclaw | 无 fork（dsh 有 `supportsPermissionRequests: true` 但 `supportsSessionForking: false`） | — | 不支持，按钮隐藏 |

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
| **锚点传成 generic message id** | `/btw` 收 `message.id` 而不是 `forkAnchorId` | **接口阻断级**：codex 的 `id` 每次读取都变，会被当成 `lastTurnId`；契约只认 `anchorForkId`（§5.1、§5.2） |
| **回合结束但后台任务仍在跑** | 抽屉里跑过带 background task 的回合，用户随后关闭 | `chat.abort` 停不了它（`canInterrupt: false`），必须逐个 `chat.stop-task` 并等消失后再删；§5.9 清扫走同一套前置（§5.4） |
| **DELETE 失败后前端丢了 slot** | 409 `BTW_STILL_RUNNING` 或网络错误 | destroy 状态机：DELETE 成功才 `dropSession`，失败保留抽屉与 slot 并给重试（§6.3） |
| provider 侧短暂可见 | 副本存续期间，`~/.claude/projects` 等目录里多一个 jsonl，provider 自己的 CLI 会话列表能看到 | **可接受**，关闭即删。实施者不要把它当泄漏去"修"——CloudCLI 无法也不该隐藏 provider 自己的存储 |

---

## 9. 实施切片

**S1｜服务端最小闭环（仅 claude）**
- `is_ephemeral` 列 + 迁移 + `SESSION_ROW_COLUMNS` / `SessionRow` / 归一化（§4.1）
- `POST /btw` / `DELETE /btw` / `PATCH /btw/promote`
- 两阶段建行（占位 → 回填，**含 `jsonl_path` 补写**，§5.1）
- **占位窗口注册表**（`ephemeral-fork-registry.service.ts`：登记 / 一次性消费 / 回填时校验误标并自愈 / 60s 过期；`createSession` 的 INSERT 分支消费它，§5.1）
- **删除前置 abort**（`runtime.abort` + 等终结；超时 409 `BTW_STILL_RUNNING`，§5.4）
- **删除前置 stop-task**（`canInterrupt: false` 但有 `tasks` 的条目逐个 `chat.stop-task` 并等消失；周期清扫复用同一函数，§5.4）
- **锚点契约只认 `forkAnchorId`**（请求 `anchorForkId`／响应回填有效锚点，§5.1、§5.2）
- 可见面过滤（侧栏/搜索/未读/计数，**过滤下沉到服务层，仓储层保持全量**，§5.6）+ **广播服务过滤**
- 启动清理 + 周期清扫 + tombstone
- **验收必须是自动化断言，不是手工 curl**：副本创建/删除前后比对①源 transcript 的字节数与 mtime 不变、②`sessions` 行集合不变、③侧栏/搜索/计数查询结果不变；再用同步器测试模拟"文件 add → 广播"路径，断言 `buildSessionUpsertedEvent` 对副本返回 `null`。**新增一条**：副本跑到一半发 `DELETE`，断言①run 收到 abort、②transcript 在删除后不再出现、③没有新行落库（这条挡的是 §5.4 的 abort 前置，手工 curl 测不出来）。**再新增一条（挡方案 a）**：在回填前手动插入一条"watcher 抢先建行"的调用，断言①新行 `is_ephemeral = 1`、②注册表条目已被消费（第二次调用不再命中）、③过期后同一 projectPath 的正常新会话仍为 `is_ephemeral = 0`；④**误标自愈**——构造"被标行的 provider id 与 fork 返回值不一致"的情形，断言该行被改回 `0`（这条挡的是"键按 projectPath、误标正常会话后被周期清扫删掉"）。**第五条（挡锚点契约）**：给一个"同 turn 两条消息共享 `turnId`"的 codex 夹具，断言按用户消息的 `forkAnchorId` 建出的副本 `anchorForkId === turnId`、`anchorDegraded === true`；再断言传 generic `message.id` 时被拒（400），证明不会静默把它当 `lastTurnId` 用。**第六条（挡 background task）**：构造 `background: true, canInterrupt: false` 的副本，发 DELETE，断言①不发 `runtime.abort`、②对每个 taskId 发了 `chat.stop-task`、③任务消失前不删文件、④最终行与文件都不在。

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
  - **destroy 状态机**：把 DELETE 打成 409（副本仍在跑）与打网络错误两种，断言抽屉**不关**、slot **不丢**、出现"正在停止/重试"；再断言 DELETE 成功那一路径才 `dropSession`；
  - 移动视口下聚焦输入框，发送按钮、最后一条消息、键盘三者不重叠。

**S3｜消息级入口**
- 用户消息上的「从这里 btw」，显示条件与现有 fork 按钮一致：`message.forkAnchorId` 存在（`MessageComponent.tsx:263,694-697`），点击时把 `forkAnchorId` 当 `anchorForkId` 发（不是 `message.id`）
- 验收：从中间消息开 btw，副本内容确实截止在该消息；对 codex 断言提示条显示"截至该轮结束"

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
11. **正式 fork 是否真的留下侧栏幽灵**（第三轮批注建议，顺手验证）。按 §5.7 的代码推导它会：watcher 抢建 → reclaim `DELETE`+`INSERT` 换 id → 无删除广播。实跑一次正式 fork，看侧栏是否多出一条刷新后才消失的条目。结论只用于"未来要不要拿本方案的手法去修正式 fork"，不阻塞 S1。

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

> [!IMPORTANT] 关键信息（第三轮核查）：§6.4"claude 是唯一 supportsPermissionRequests: true 的 provider"**不成立**——dsh 也是 true（`provider-capabilities.service.ts:159`，注释明确说明其 ACP 权限请求会路由到 chat UI）。dsh 恰好 `supportsSessionForking: false` 所以本方案不受波及，但该句应改为"**支持 fork 的 provider 中仅 claude 弹权限卡**"，否则将来给 dsh 开 fork 时会照着错误结论漏掉权限卡实现。

> [!WARNING] 潜在风险（第三轮核查）：§5.7"正式 fork 已有'先插行再让 watcher 看见'的约定，副本沿用即可"对实际代码顺序的描述不准确——真实顺序是 `forkSession` 先落盘（jsonl 已存在）→ **然后**才 `createForkedSession`。窗口期内 watcher 可能抢先按 provider 原生 id 建行并广播；reclaim 逻辑（`sessions.db.ts:398-413`）会删掉这行换成 app id 的正式行，但**已收到广播的客户端会留下幽灵条目**，除非后续有删除广播或前端对账。正式 fork 今天就带着这个窗口在跑（幽灵最终会被盖掉，因为正式行本来就该出现）；btw 的副本则不会——幽灵会一直挂着直到刷新。S1 验收建议实际观察一次正式 fork 的这个窗口，确认前端如何消化幽灵条目，再把同样机制用于 btw（或在广播侧过滤，与第一轮 CAUTION #1 一并处理）。

> [!TIP] 建议（第三轮核查）：§5.6 过滤清单可以落到更精确的杠杆上——全文搜索的候选集就是 `getAllSessions()` + `getArchivedSessions()`（`session-conversations-search.service.ts:1198-1201`），ripgrep 拿的是显式文件清单、不做目录扫描，所以**过滤这两个仓库函数即可同时覆盖标题搜索与正文搜索**。`getAllSessions` 目前只有搜索与 claude 的 legacy 标题回填（`claude-session-synchronizer.provider.ts:416`）两个调用方，建议把它列为 §5.6 的显式条目，比按服务逐个枚举更不易漏。

> [!NOTE] 补充说明（第三轮核查）：以下声明均核实成立——codex 仅 turn 粒度（`forkThread({ lastTurnId })`，`codex-fork.provider.ts:30-34`，且 title 确实未转发）；zcode checkpoint 守卫与 409 语义（`zcode-fork.provider.ts:14-49`）；消息级操作区可挂入口（`MessageComponent.tsx:255` 附近 edit 按钮同款形态）；抽屉订阅用 `lastSeq: 0` 的形态与 `useChatSessionState.ts:1144-1152` 现有写法一致；Escape capture 处理（`QuickSettingsPanelView.tsx:99-120`）与迁移 helper（`migrations.ts:34,50` 有 `isPinned` 先例）都可直接套用。

#### Codex
> [!IMPORTANT] 关键信息：§6.3 的目录布局与前端模块规范不一致。当前仓库把 `chat` 作为 `src/modules/chat/` 这一 feature module，规范要求 hook 放在 `src/modules/<feature>/hooks/`；方案却把 `useBtwSession.ts` 放在新建的 `src/modules/chat/btw/` 根目录，并把它称为独立模块。应明确二选一：若 btw 是独立 feature，就建 `src/modules/btw/`（含自己的 `index.ts`、`hooks/`）；若它是 chat 的子能力，就保留 `src/modules/chat/`，把 hook 放进 `src/modules/chat/hooks/`，不要在同一层级混用“模块”定义。否则后续 import 边界、barrel 导出和测试归属都会漂移。

> [!WARNING] 潜在风险：§6.2 的移动端 `inset-0` 只解决覆盖范围，没有处理输入框底栏、软键盘和安全区。`BtwComposer` 在全屏抽屉中会被 iOS/Android 键盘顶起或遮住，消息列表的可视高度、滚动锚点和 `Escape`/返回手势也可能与现有聊天输入底栏冲突。方案应明确移动端采用何种 fixed/sticky 结构（含 `visualViewport`/safe-area 处理），并在 S2 增加真机或 Playwright 移动视口验收：聚焦输入框后发送按钮、最后一条消息和键盘都不重叠。

> [!WARNING] 潜在风险：清理生命周期只覆盖显式关闭和下次服务启动（§5.4–§5.5），没有覆盖浏览器崩溃、刷新、断网导致 `DELETE /btw` 未送达的情况。此时副本行和 provider transcript 会一直保留，既违反 I4，也会让 provider 自身的 CLI 会话列表持续出现垃圾项。建议增加基于 `created_at`/`updated_at` 的 TTL 回收或后台周期清扫，并把“客户端消失但服务仍运行”的场景写入 S1/S5 验收；仅靠组件 `destroy()` 和启动兜底不够。

> [!TIP] 建议：S1 的验收目前是手工 curl，无法守住 I1–I4。至少补自动化断言：副本创建/删除前后的源 transcript 字节数与 mtime、`sessions` 行集合、侧栏/搜索/计数查询结果，以及删除后 watcher 触发是否会重建；把 §5.7 的竞态从“概率实测”提升为可重复的同步器测试。

> [!CAUTION] 潜在风险：§5.6 把 `getSessionsByProjectPathIncludingArchived` 也列入 `is_ephemeral = 0` 过滤清单，但这个仓储方法同时服务两个相反场景：`projects-with-sessions-fetch.service.ts:185-195` 需要向项目视图返回会话，`project-delete.service.ts:45-50` 则必须枚举包括隐藏副本在内的全部 transcript 才能清理文件。若统一过滤，项目强删会漏删 ephemeral 文件；若不过滤，项目会话接口又会泄出副本。应拆成“可见列表查询”和“清理专用全量查询”，明确各自 caller，并分别补项目删除、项目列表、隐藏副本三组测试。

> [!WARNING] 潜在风险：§5.3/§11-3 把 model、effort 的继承写成默认行为，但 `chat.send` 的这些值来自**当次请求的 `options`**；`chat-websocket.service.ts` 只有在 `clientOptions.model/effort` 存在时才写回 session，且 `useChatComposerState.ts` 还会同时发送 `toolsSettings`、`skipPermissions`。仅在 `createForkedSession` 里复制 `source.model/effort`，不会让后续抽屉回合自动使用它们；方案又只明确透传 `permissionMode`。若 `BtwComposer` 漏发这些字段，D2 的“完整工具、继承权限”会与主会话产生实际差异。应明确由前端逐回合发送完整 options，或由服务端从副本/源会话解析，并在 S2 覆盖 model、effort、工具白名单、skipPermissions 的继承验收。

> [!IMPORTANT] 关键信息：`is_ephemeral` 不是只改 schema 和 `createForkedSession` 就完成的单点字段。`sessions.db.ts` 的 `SessionRow`、`SESSION_ROW_COLUMNS`、各 `SELECT`/归一化结果，以及 `session_upserted` 构造、项目会话 API/共享类型都要有明确的字段流向；尤其广播服务需要能读到该字段才能跳过副本。实施清单应把这些消费者写全，并区分“内部清理必须读到”与“普通 API 不得返回”两种契约，避免字段只写不读或误暴露。

> [!CAUTION] 潜在风险：§5.4 的关闭清理没有处理正在运行的副本回合或尚未结束的后台任务。`deleteOrArchiveSessionById` 只删 transcript、provider store 和 DB 行，不会先调用 `chat.abort` 或 `chat.stop-task`；如果用户在抽屉回合执行中关闭，runtime 仍可能继续写文件/启动后台工作，随后 watcher 会把已删会话重新索引，I4 不再成立。关闭流程必须先取消或确认终止 `chatRunRegistry` 中的 running run，并处理 background tasks，再执行删除；否则至少把“运行中关闭”定义为延迟删除并由服务端最终清理。

> [!CAUTION] 潜在风险：§5.2 把 `upToAnchorId` 描述成“消息 id”，但现有契约实际上分三层：`NormalizedMessage.id` 可能是读取时合成的展示 id，`transcriptAnchorId` 是稳定转录行 id，`forkAnchorId` 才是 provider fork 锚点（`server/shared/types.ts:398-415`）。Codex 的 `id` 每次读取都会变化，真正的 fork 值是 `turnId`；现有前端 fork 也显式发送 `message.forkAnchorId`（`src/modules/chat/ChatInterface.tsx:432-437`）。若 `/btw` 只收 generic message id，Codex 会传错 `lastTurnId`，响应里的 `anchorMessageId` 也无法表达降级后的 turn。应把请求/响应契约改为 provider fork anchor（或同时传 `messageId` 与 `forkAnchorId`），并按 provider 解析有效锚点。

> [!IMPORTANT] 关键信息：§6.4 不应硬编码“只有 claude 有权限卡”。`ProviderCapabilities` 已提供 `supportsPermissionRequests`、`supportsAbort` 等能力位（`server/modules/providers/services/provider-capabilities.service.ts:20-24`），而且 DSH/OpenClaw 的 capability 行也声明了 `supportsPermissionRequests: true`；即使当前它们没有 fork 而被隐藏，后续扩展矩阵时按 provider id 分支会再次漂移。抽屉的权限卡、中止按钮和失败处理都应由能力位驱动，并把 `chat.abort`/`chat.stop-task` 纳入关闭与异常路径验收。

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
- **仍待实测**：§10-8/9/10（第三轮又加了第 11 条，见 §15）。
- **新进 S2 的工作量**：`dropSession`、options 共享构造器、mode 置灰镜像（本轮新增）＋ Stop（§13 已补）——这四项在原 S2 里都不存在。
- **没有遗留的分歧**：7 条全部采纳，无驳回。但两边的判据都要复算：R2 是"审阅者推翻了我"（我上一轮把"协议类型里没有该字段"误当成"链路上没有发送"）；R3 是"我采纳了事实、更正了审阅者的归因"（覆盖源是客户端偏好，不是服务端设置）。这两条互为镜像，说明**结论和归因都得回代码里对一遍**，不能只对一半。

### Codex
> [!CAUTION] 潜在风险（第三轮复核）：§5.1/§5.2 的锚点契约仍与现有 fork 契约不一致。请求示例写的是“消息 id”，响应写的是 `anchorMessageId`，但 `NormalizedMessage` 明确区分 `id`、`transcriptAnchorId` 与 `forkAnchorId`（`server/shared/types.ts:398-415`）；Codex 的 `id` 是读取时合成值，真正传给 `thread/fork` 的是 `turnId`/`forkAnchorId`，现有前端也从 `message.forkAnchorId` 发起 fork（`src/modules/chat/ChatInterface.tsx:432-437`）。若 `/btw` 仍按 generic message id 校验和转发，Codex 会把展示 id 误当 `lastTurnId`，且 `anchorDegraded` 没有稳定的请求/响应回填口径。应把字段改为 provider fork anchor，或同时传 `messageId` 与 `forkAnchorId` 并在响应返回有效锚点；这是进入 S3 前必须收口的接口阻断项。

> [!CAUTION] 潜在风险（第三轮复核）：§5.4 只保证 `chat.abort` 后等待 running run 终结，却没有覆盖“回合已结束但 background task 仍在跑”的状态。仓库把这类会话列为 `background: true, canInterrupt: false`（`server/modules/providers/services/sessions.service.ts:36-44`），停止它必须走 `chat.stop-task`，不能用 `chat.abort` 代替。若此时执行 DELETE，或 §5.9 的 6 小时清扫只看 `updated_at`，后台任务仍可能继续写 provider 存储/工作区并在之后重建会话；周期清扫也必须先查询并停止/等待 background tasks，且验收要覆盖“回合完成、任务未完成时关闭/清扫”。

> [!WARNING] 潜在风险（第三轮复核）：§6.3 把 `destroy()` 写成“DELETE 后丢弃 store slot”，但 §5.4 规定运行未终结时返回 409 并保留副本。前端没有定义收到 `BTW_STILL_RUNNING` 后是保持抽屉、保留 B slot 并显示可重试，还是照常关闭；按当前顺序会在删除失败后丢掉唯一可观察状态，用户无法再停止或重试。应把 destroy 改成显式状态机：DELETE 成功才 `dropSession`，409 保持 slot/抽屉并展示停止中或重试，只有 promoted 时才跳过删除。

> [!IMPORTANT] 关键信息（第三轮复核）：§6.4 仍写“claude 是唯一会把工具权限弹到 UI 的 provider”，与能力矩阵不完全一致；`supportsPermissionRequests` 已是能力位，DSH/OpenClaw 行也为 true（`server/modules/providers/services/provider-capabilities.service.ts:20-24,159`）。虽然它们当前无 fork，但按 provider id 硬编码会让未来支持 fork 时漏掉权限卡。应改为按 `supportsPermissionRequests`/`supportsAbort` 渲染和处理，并把能力位作为 S2/S4 的验收输入。

---

## 15. 第三轮审阅批注与处置（2026-10-21）

8 条（Claude 4 + Codex 4），其中 T4 是两边对同一问题各写一条。**全部采纳**，一条是接口阻断项（T1），一条推翻了我对正式 fork 顺序的描述（T5）。

| # | 批注 | 判定 | 处置 |
|---|---|---|---|
| T1 | `/btw` 的锚点契约用 generic message id，与 `forkAnchorId` 契约冲突 | **采纳（接口阻断级）** | §5.1 请求改为 `anchorForkId` + 可选 `anchorMessageId`，响应回有效 `anchorForkId`；§5.2 判据改为 `role === 'user' && kind === 'text' && forkAnchorId`；§7 矩阵逐 provider 标出真身；§9 S1 第五条断言 + S3 入口条件。复核确认：codex 的 `forkAnchorId` 就是 `turnId`（`codex-sessions.provider.ts:2321,2345`），现有前端 fork 也发 `message.forkAnchorId`（`ChatInterface.tsx:432-437`） |
| T2 | 回合已结束但 background task 仍在跑时，`chat.abort` 停不住 | **采纳（阻断级）** | §5.4 改两段式前置：`canInterrupt: true` → abort，`background: true` 有 tasks → 逐个 `chat.stop-task`；§5.9 清扫复用同一清理函数而不是另写 SQL；§9 S1 第六条断言。复核确认 `canInterrupt: false` 的设计说明在 `sessions.service.ts:31-45` |
| T3 | `destroy()` 在 DELETE 失败（尤其 409）时丢 slot，用户无法再停或重试 | **采纳** | §6.3 改显式状态机：204 才 `dropSession`，409 保留抽屉/slot 并显示"正在停止…"＋重试，promoted 跳过 DELETE；§6.7 补"409 是状态不是 toast"；§9 S2 加两种失败路径验收 |
| T4 | "claude 是唯一弹权限卡"不成立，dsh 的 `supportsPermissionRequests` 也是 true | **采纳**（Claude 与 Codex 各提一条，合并处置） | 复核确认 dsh 为 true 且 `supportsSessionForking: false`（`provider-capabilities.service.ts:150-160`）。§6.4 改为"**支持 fork 的 provider 中仅 claude**"，并要求权限卡与 Stop 分别由 `supportsPermissionRequests` / `supportsAbort` 驱动，不按 provider id 分支；§7 矩阵补脚注 |
| T5 | §5.7 说"正式 fork 已有先插行再让 watcher 看见的约定"，与实际顺序不符 | **采纳，且顺带确认 btw 不受影响** | 复核确认真实顺序是 `forkSession`（落盘）→ `createForkedSession`（建行）→ `broadcastSessionUpserted`（`sessions.service.ts:575-605`）。§5.7 重写：正式 fork 今天就有这个幽灵（reclaim 是 `DELETE`+`INSERT`、新旧 id 不同、无删除广播），btw 因占位行 + 注册表走不到这条路径；§10 新增第 11 条顺手实测 |
| T6 | 搜索候选集是 `getAllSessions()` + `getArchivedSessions()`，ripgrep 只吃显式文件清单 | **采纳** | §5.6 表格补 `getAllSessions` 行，并写明"过滤这两个函数即可同时覆盖标题搜索与正文搜索"，比按服务枚举更不易漏。复核确认调用点 `session-conversations-search.service.ts:1198-1199` |
| T7 | 一批声明核实成立：codex 仅 turn 粒度、zcode 409 语义、`MessageComponent` 入口形态、`lastSeq: 0`、Escape capture、迁移 helper | **记录，正文无需改** | 已核，均在 §5.2 / §6.1 / §6.2 / §6.7 中以现有形式成立；§9 S3 的入口条件此时补上了 `forkAnchorId` 判据 |

### 15.1 本轮之后还剩什么

- **待实测增至 11 条**：原 10 条 + 正式 fork 幽灵观察（§10-11）。
- **无待拍板项**：D1–D5 已定，本轮批注没有引入新的设计选择——全部是"照错的地方改对"。
- **S1 范围又长了两条**：`chat.stop-task` 前置、锚点契约改造（含"传 generic id 被拒"的负向断言）。
- **一个反复出现的模式**：三轮审阅里，凡是我写"只有 X 会 Y""顺序是先 A 后 B""约定是这样"的地方，几乎都被证伪（dsh 权限位、正式 fork 顺序、permissionMode 链路）。**凡断言"唯一/顺序/约定"，必须当场贴代码行**，否则不要写进方案。

---

## 16. S1 实施记录（2026-10-21）

**状态：S1 已完成，门禁全绿（server 1592 测试 / 0 失败；typecheck、build:server、lint 全过）。S2–S4 未开始。**

### 16.1 落地文件

| 文件 | 内容 |
|---|---|
| `server/modules/database/ephemeral-fork-registry.service.ts`（新） | 占位窗口注册表（register / claim / settle / abandon / sweep）+ 回收墓碑（retire / isRetired） |
| `server/modules/database/schema.ts` | `SESSIONS_TABLE_SCHEMA_SQL` 加 `is_ephemeral BOOLEAN NOT NULL DEFAULT 0` |
| `server/modules/database/migrations.ts` | `addSessionIsEphemeralColumn` 并在 `runMigrations` 注册 |
| `server/modules/database/repositories/sessions.db.ts` | `SessionRow` / `SESSION_ROW_COLUMNS` 加列；`createSession` 消费注册表与墓碑；新增 `createPendingEphemeralSession` / `completeForkedSession` / `promoteEphemeralSession` / `listEphemeralSessions`；可见面查询加过滤 |
| `server/modules/providers/services/btw.service.ts`（新） | 创建（锚点解析）/ 回收（abort + stop-task 前置）/ 转正 / 清扫 |
| `server/modules/providers/services/ephemeral-cleanup.service.ts`（新） | 启动全量回收 + 30 分钟周期清扫（`unref`） |
| `server/modules/providers/provider.routes.ts` | `POST /sessions/:id/btw`、`DELETE .../btw`、`PATCH .../btw/promote` + 两个解析器 |
| `server/modules/websocket/services/session-upsert-broadcast.service.ts` | `buildSessionUpsertedEvent` 对 `is_ephemeral` 返回 `null` |
| `server/modules/projects/services/projects-with-sessions-fetch.service.ts` | 归档项目视图在服务层过滤副本（底层查询保持全量） |
| `server/index.ts` | 启动时 `initializeEphemeralCleanup()`，关闭时 `closeEphemeralCleanup()` |
| 两个测试文件 | `database/tests/ephemeral-sessions.db.integration.test.ts`（7 条）、`providers/tests/btw.routes.test.ts`（8 条） |

### 16.2 与方案的四处偏差（都是实施时才暴露的）

1. **注册表放在 database 模块，不在 providers**。方案 D5 写的是 `providers/services/ephemeral-fork-registry.service.ts`，但消费方 `sessions.db.ts` 属于 database 模块，反向依赖违反模块规范。最终落在 `database/ephemeral-fork-registry.service.ts`，由 database 桶导出给 providers 用。
2. **过滤落点是"按查询用途"而不是"按层"**。§5.6 原话是"仓储层保持全量、过滤下沉到服务面"，但分页查询（`getRecentSessionsPage` / `getSessionsByProjectPathPage` / `countSessionsByProjectPath`）在服务层过滤会让分页与总数错位。最终按方法切分：**可见面方法直接在 SQL 过滤**（`getAllSessions` / `getArchivedSessions` / 两个分页 / 计数），**唯一需要全量的 `getSessionsByProjectPathIncludingArchived` 保持不过滤**，由项目归档视图在服务层过滤。两个函数都写了"调用方必须自己过滤"的注释。
3. **新增一条方案没写、但会真出事的过滤**：`findLatestPendingAppSession` 加了 `is_ephemeral = 0`。OpenCode 同步器靠它"认领 app 创建但还没拿到 provider id 的行"，btw 占位行正好满足条件（`provider_session_id IS NULL`），不排除会被它认领成正式会话，随后被清扫当垃圾删掉。
4. **墓碑检查放在 `createSession` 的 INSERT 分支**，不是"同步器的 upsert 入口"。同步器有十几个，入口不止一个；`createSession` 是它们唯一的汇合点，改一处即可。

### 16.3 验收覆盖（对应 §9 的六条）

自动化断言已覆盖：①占位行不进任何可见面、②窗口内 watcher 建行落成隐藏、③窗口误标正常会话后自愈、④注册表过期不再影响新会话、⑤墓碑阻止复活、⑥`completeForkedSession` 合并 duplicate 并补写 `jsonl_path`、⑦转正可见且 `updated_at` 不变、⑧锚点按 `forkAnchorId` 解析且 display id 被拒、⑨无可用锚点报 400、⑩无 fork / 嵌套 btw 报 409、⑪fork 失败删占位行、⑫删正式会话 403、⑬删副本后行与文件都不在。

**未覆盖**（需要真 provider + 真进程，留给 S2 联调）：abort 后 jsonl 是否 1s 内停止增长、`chat.stop-task` 的真实停止时序、prompt cache 是否命中。

### 16.4 实施期间发现的一个环境陷阱

本机 `npm test` 在不设 `DATABASE_PATH` 时会**读写真实的 `~/.cloudcli/auth.db`**。该库若没跑过最新迁移（缺 `is_ephemeral` 列），所有 `SELECT ${SESSION_ROW_COLUMNS}` 都会 `SQLITE_ERROR`，表现为 omp/pi/zcode/codex 的 runtime 测试**整片假红**（15/15 失败，错误只有 `{ code: 'SQLITE_ERROR' }`，看不出是列缺失）。

判据：`git stash` 后同一条命令变绿 ⇒ 不是代码问题。处置：对真实库跑一次 `initializeDatabase()`（等价于用户重启守护进程），列补齐后全绿。

**这是加列类改动的通用前置**：先迁移真实库，再跑全量测试，否则会被假红带偏。



---

## 17. S2 实施记录（2026-10-21）

**状态：S2 已完成，前端门禁全绿（client 1898 测试 / 0 失败；typecheck、build:client、lint 0 error）。** 真机联调仍需重启守护进程（S1 的新端点尚在 `dist-server` 里没被拉起），列入 §17.4。

### 17.1 落地文件

| 文件 | 内容 |
|---|---|
| `src/shared/api.ts` | `btwSession` / `deleteBtwSession` / `promoteBtwSession`（与 `forkSession` 同组） |
| `src/modules/chat/hooks/useBtwSession.ts`（新） | 生命周期：create / send / abort / close 状态机 / promote / refork；**不累积消息** |
| `src/modules/chat/btw/BtwDrawer.tsx`（新） | 抽屉容器 + 头部（锚点、降级、主会话忙碌、关闭失败重试）+ 两个动作 |
| `src/modules/chat/btw/BtwMessageList.tsx`（新） | 直接渲染 `MessageComponent`，贴底跟随 |
| `src/modules/chat/btw/BtwComposer.tsx`（新） | 受控输入 + Stop + 权限卡（复用 `PermissionRequestsBanner`） |
| `src/modules/chat/hooks/useSessionStore.ts` | 新增 `dropSession` / `setObservedSession` |
| `src/modules/chat/utils/sendOptions.ts`（新） | `buildChatSendOptions`：主 composer 与抽屉唯一的 options 构造器 |
| `src/modules/chat/hooks/useChatRealtimeHandlers.ts` | 按 `sideAskSessionId` 单独路由抽屉的权限请求（订阅回放 / 请求 / 解决 / 回合结束） |
| `src/modules/chat/ChatInterface.tsx` | 抽屉状态、镜像的 permissionMode/model/effort、Escape 让步、消息级入口透传、前台流式可见性、向上报告「有没有可作锚点的用户消息」 |
| `src/modules/chat/transcript/MessageComponent.tsx` + `ChatMessagesPane.tsx` | 用户消息页脚的「从此处侧边提问」 |
| `src/modules/project-workspace/WorkspaceHeader.tsx` + `WorkspaceMain.tsx` | 会话标题栏按钮；可见性由 `useSessionForkingProviders` 决定，以请求计数器下发给 chat |
| `src/modules/i18n/locales/{en,zh-CN}/chat.json` | `sideAsk.*`（30 键，两语言齐全）+ `message.askAsideFromHere` |
| 四个测试文件 | `btwSession.test.tsx`（4）、`btwPermissionRouting.test.tsx`（4）、`btwSendOptions.test.ts`（3）、`sessionStoreSideAsk.test.tsx`（2） |

### 17.2 实施时才暴露的三处非正交问题

1. **只加 `dropSession` 不够，还必须加 `setObservedSession`**。方案 §6.3 只记了「store 没有删槽 API」，但 `notify()` 只在 `sessionId === activeSessionId` 时 `setTick`，而抽屉里的副本**不是**选中会话 —— 只加 `dropSession` 的话，抽屉的流式与工具卡会一直停在第一帧。最终给 store 加了一个「观察槽」集合，`notify` 对 active ∪ observed 生效。这是 S2 的阻断级发现，方案原文没有覆盖。
2. **权限卡不是「浏览器侧已经拿到全局列表、抽屉自己过滤」**。§6.4 的原判断有误：`useChatRealtimeHandlers` 只在 `sid === activeViewSessionId` 时写 `pendingPermissionRequests`，非查看中的副本请求**根本不会被记录**。所以改法不是「抽屉过滤」，而是给 handler 加了一条按 `sideAskSessionId` 的独立路由（订阅回放、请求、解决、`complete` 清空四条路径）。已加测试分别证明两边互不串台。
3. **主会话的全局 Escape 会抢走抽屉的 Escape**。`ChatInterface` 在 `canAbortSession` 时用 document capture 监听 Escape 并 abort；抽屉在 bubble 阶段收到时 `defaultPrevented` 已为真。最终让主会话的全局处理在 `sideAskOpen` 时直接让位，抽屉自己关。

### 17.3 与方案的三处有意偏差

1. **移动端键盘不调用 `useVisualViewportKeyboardOffset`**。它是 project-workspace 模块的私有 hook，跨模块直接引用违反前端模块规范；而该 hook 已由 `ProjectWorkspaceRoute` 全局挂载，只写 `--keyboard-height`。抽屉直接 `height: calc(100% - var(--keyboard-height, 0px))` 读同一个变量，效果一致且零耦合。
2. **转正按钮在副本运行中也可用**（只禁用 creating / closing）。§5.4 的后端语义就是「不 abort、只翻标记」，UI 不该比后端更严；转正时本地只丢 slot，不删行。
3. **切换会话时不自动丢弃抽屉**。抽屉可能正拿着上一段会话的答案，切走再切回是常见用法；强行 DELETE 会把它变成不可预期的数据丢失。副作用是：切到别的会话后，头部「上下文截至第 N 条」会按新会话的消息表计算而可能变成空 —— 已知的外观偏差，不影响分支本身（锚点在创建时就已固定）。
4. **空会话隐藏入口靠 chat 反向上报**。按钮在 header（project-workspace 模块），判断「有没有可作锚点的用户消息」要靠 chat 的转录 —— 因此 `ChatInterface` 通过 `onSideAskAvailabilityChange` 把布尔量报给 `WorkspaceMain`，后者与 provider 能力位一起决定按钮是否存在。方案原写法默认这两件事在同一层，实际不在。
5. **S3 的消息级入口提前落地**：它只是 `MessageComponent` 的一个按钮 + 一条 prop 链，与抽屉共用同一状态，拆成两片反而要改两次同一批文件。锚点仍按方案只传 `forkAnchorId`（外加同一条消息的 display id 供回显），显示条件与 fork 按钮一致。

### 17.4 验收现状与遗留

- 自动化已覆盖：①首次发问才 fork、②`chat.send` options 与主 composer 同源（`permissionMode` 必在、跳过权限跟随 provider）、③409 保留抽屉与 slot、④204 才 `dropSession`、⑤转正不发 DELETE、⑥权限请求按 sessionId 分流、⑦观察槽与非观察槽的重绘差异、⑧删槽后行消失。
- **未做**：真机/真浏览器联调（需要 `npm run build:server` 后重启守护进程，新端点才生效）。留待 S2 验收时逐条走：抽屉布局与滚动、软键盘、Stop 的真实中止、claude `default` 模式下的权限卡、以及「故意漏传 `permissionMode` 时工具卡住」这条反向断言（属联调项，无法在 jsdom 里表达）。
- 已在真实浏览器（本机 3011，服务端仍是旧进程）做前端冒烟：头部按钮在可 fork 的会话上出现；抽屉贴右 420×900、背景与 `header` 同色、textarea 自动聚焦且落在底部；Escape 关闭且不触发主会话 abort；用户消息页脚的消息级按钮已渲染（hover 显现）。
- **创建接口的真实往返已验**（2026-10-22 真机首轮，见 §17.6）；权限卡与 Stop 仍未验。

### 17.5 移动端 / iOS 适配（2026-10-21 补）

方案原文只写了「移动端全屏 + 读 `--keyboard-height`」，落地后按 `ios/` + Capacitor 壳的实际约束逐项核过，改了三处、否掉一处：

1. **顶部与右侧安全区必须抽屉自己吃**。`viewport-fit=cover` 已开（`index.html`），而项目里那套补偿只覆盖两个位置：`#root` 的 padding（`display-mode: standalone` / `body.pwa-mode`）与 `body.pwa-mode .fixed.inset-0` 的 `top/left/right`。抽屉是 `fixed right-0 top-0`，**两者都不匹配**，所以 PWA standalone 下头部会钻到刘海底下。改为在 `aside` 上直接写 `paddingTop: env(safe-area-inset-top)`、`paddingRight: env(safe-area-inset-right)`（横屏时机身刘海落在抽屉所贴的那一侧）。桌面 `env()` 求值为 0，零影响。
2. **底部安全区要减掉键盘，不能直接 `pb-safe-area-inset-bottom`**。抽屉高度已经是 `100% - --keyboard-height`，底边正好压在键盘顶；此时再叠 34px 的 home indicator inset，输入框会离键盘悬空。主 composer 早有同义表达式（`.chat-composer-shell` 的 `--chat-composer-safe-bottom = max(0, env(safe-area-inset-bottom) - --keyboard-height)`），但它挂在那个类的局部变量上，抽屉不在其内。最终在 `BtwComposer` 根节点内联同一个表达式，语义一而不跨模块偷变量。
3. **头部按钮放大到 32px**。原来是 `h-6 w-6`（24px），比同一行的 `MobileMenuButton`（`p-1.5` + 16px 图标 = 32px）和 tab 按钮（32px 高）都小，iOS 上点不中。改成 `h-8 w-8` 后与邻居等高，且 header 高度由 tab 行决定，桌面不会变高。
4. **消息级按钮不需要为触屏加变体（已否掉）**。`tailwind.config.js` 开了 `future.hoverOnlyWhenSupported`，`opacity-0 + group-hover:opacity-100` 在触屏上本该永久不可见 —— 但 `index.css:1192` 早有一条全局中和：`@media (hover: none) and (pointer: coarse) { .group-hover\:opacity-100 { opacity: 1 !important } }`。在 Playwright 的 iPhone 13 视口下实测既有 fork 按钮与新增按钮 `opacity` 均为 `1`，所以再加 `[@media(hover:none)]:opacity-100` 只会变成第二套机制（已撤销）。

**验证（Playwright，iPhone 13：390×664）**：抽屉 `390×664` 贴边全屏、`paddingTop/Right` 在桌面为 0；把 `--keyboard-height` 手动置 300px 后抽屉高 364、底边 364，`BtwComposer` 底边同步且在键盘占满时 padding-bottom 归零；`matchMedia('(hover: none)')` 为 true 时两个消息级按钮 `opacity: 1`；头部按钮实测 `32×32`。

**仍需真机（Capacitor / 微信内置 / iOS Safari）**：①`textarea` 的 `autoFocus` 在 WKWebView 里能否在非直接手势栈内唤起键盘（唤不起也只是少一次自动弹起，点一下即可）；②真实键盘弹出时 `--keyboard-height` 与 `env(safe-area-inset-bottom)` 的实际读数是否按上式抵消（`@capacitor/keyboard` 已设 `resize: 'none'`，插件只报高度）；③iPad 触摸设备上头部 32px 的命中感。

### 17.6 真机首轮实测与删除路径的伴随目录修复（2026-10-22）

**实测：一次完整的创建 → 追问 → 回答 → 关闭往返。** 用户在 workbuddy 会话 `1dfdb9c3…` 上打开抽屉、发问、收到回答后点关闭。守护进程日志：

| 时间 | 事件 |
|---|---|
| 08:00:35.620 | `POST /api/providers/sessions/1dfdb9c3…/btw` → 201，副本 `29958168…`，provider 侧 `59077ef7…` |
| 08:00:38 / 44 / 48 / 58 | watcher 四次 change event，均指向副本的 `59077ef7….jsonl` —— 回复在流式写入 |
| 08:01:05.404 | `DELETE …/29958168…/btw` → 200，15.2ms（run 已结束，故没有 abort 等待） |

事后核对：源会话仍在且未归档，`is_ephemeral = 1` 的行 0 条。**这证明 fork → 前缀复制 → 独立回答 → 关闭回收全链路成立**，副本没有反向污染源会话。

**这一轮没有覆盖的**：权限卡（该轮无工具调用，副本的 `tool-results/` 为空）、Stop 的真实中止（答完才关）、软键盘与真机键盘高度。

**修掉的一处删除缺陷**：副本关掉后 `<project>/<psid>/` 空目录残留。根因在通用删除路径 —— `deleteOrArchiveSessionById` 只 `removeFileIfExists(transcript)`，从不处理 provider 保在 transcript 旁边的同名目录；workbuddy 的 `<psid>.jsonl` 与 `<psid>/tool-results/…` 是一对。这不是 btw 引入的：正常删会话同样留下，本机 workbuddy 已积累 **55** 个（另有 50 个存活会话目录、15 个 `memory/` 目录），btw 只是让它发生得更频繁。

修法在 `sessions.service.ts` 新增 `removeDirectoryBesideTranscript`，与文件删除同处一条循环：

- **只对 `.jsonl` 结尾的 transcript 生效**，路径去掉扩展名即为候选目录。dsh 的 `session.jsonl.zstd` 因此不受影响（`path.extname` 是 `.zstd`，去掉最后一个扩展会指到别人的目录）。
- **目录删除失败不阻断删行**，只 `console.warn`。会话行已经不可达，删不掉的目录是垃圾，不是拒绝删除的理由；这与文件删除失败会抛出的既有语义有意不同。
- 目录被删也算进 `deletedFromDisk`：jsonl 已不在、只剩目录时，删除确实动了磁盘。

三条测试（`sessions.service.test.ts`）：①jsonl + 同名目录都被删；②只剩目录时 `deletedFromDisk` 仍为 true；③`.jsonl.zstd` 的同名目录不被误删。反向验证：把该调用短路成 `false &&`，① ② 变红、③ 仍绿 —— 证明守卫测试不是靠「无差别删目录」通过的。

服务端全量 1595 测试 0 失败（新增 3 条），typecheck / lint / build:server 通过，`dist-server` 已重建。**存量 55 个孤儿目录已清理**（2026-10-22，经用户确认后逐个复核「同名 jsonl 不存在」并移入垃圾篓；50 个存活目录与 15 个 `memory/` 目录未动，复核后剩余孤儿 0）。

### 17.7 IME 组字中的 Escape 会误触发应用级动作（2026-10-22 修）

**现象**：用户打拼音时按 Esc 取消候选，抽屉/会话被退出。数据核查先行：当前会话 transcript 2657 行、0 坏行，51 条 message 全部配对（每个 user 后都有 `status: completed` 的 assistant），无未完成回合、`is_ephemeral` 残留 0 条。**没有脏数据**。日志里当天 btw 只有 08:00 那一次 `POST`/`DELETE`，说明被关掉时还没发出请求（抽屉首次发送才建会话），所以也没有丢消息。

**根因**：浏览器在 IME 组字中按 Esc（取消候选）仍然派发 `keydown` Escape，而应用侧所有 Escape 处理都没看 IME 状态。三条判据缺一不可：

| 判据 | 覆盖的场景 |
|---|---|
| `event.isComposing` | Chrome / Firefox |
| `keyCode === 229` | 部分 Windows IME 每个键都报 229 |
| `compositionend` 之后 30ms 内 | Safari 先派发 `compositionend` 再派发 keydown，此时 `isComposing` 已是 false |

落点：`src/shared/utils.ts` 新增 `isImeKeyEvent(event)`（模块级监听 `compositionend`，接受原生或 React 合成事件）。在此之前项目里有 **3 份**各自实现的同类判定（`useChatComposerState` / `BtwComposer` 的 Enter、`mobileImeInputFallback`），Escape 一处都没有。

**接入的 13 处 Escape**：`ChatInterface` 的全局中止（capture 阶段，最危险）、`BtwDrawer`、`QuickSettingsPanelView`、`Settings`、`Dialog`、`ActionMenu`、`useComposerMenuAnchor`、`useSlashCommands`（2 处）、`useFileMentions`、`AskUserQuestionPanel`、`useSessionTitleRename`、侧栏 4 个重命名输入框。同一批顺带补齐了侧栏重命名输入框缺失的 Enter 守卫（`useSessionTitleRename` 早有，侧栏 5 处没有 —— 拼音确认候选的 Enter 会把半截名字存下去）。

**验证**：
- 单元测试 5 条（`src/shared/tests/imeKeyEvent.test.ts`）：普通 Escape 为 false、`isComposing`、`keyCode 229`、React 合成事件读 nativeEvent、`compositionend` 后 30ms 窗口的两端。
- 组件测试 2 条（`src/modules/chat/tests/btwDrawerEscape.test.tsx`）：IME Escape 不关抽屉、普通 Escape 照关。反向验证：去掉守卫后前者变红、后者仍绿——证明不是把 Escape 整个禁掉。
- 真机（Playwright，1280×900）：修复前三种情形**都会关抽屉**；修复后 `plainEscapeCloses: true`、`imeEscapeCloses: false`、`safariOrderCloses: false`。
- client 全量 235 文件 1906 测试 0 失败（+7）、typecheck / lint 0 error / build:client 通过。

**未覆盖**：`AskUserQuestionPanel` 之外的交互式卡片、代码编辑器与 PRD 编辑器的 Escape（不涉及打字中取消候选的场景），以及 git 各模态框；它们仍是无守卫的裸 Escape。

### 17.8 入口收编：消息操作栏统一（2026-10-22）

**动机**：按原来的布局，侧边提问有两个入口 —— 顶部标题右侧一个常驻图标、每条用户消息一个悬浮图标。前者在标题很短时离标题很远（`WorkspaceTitle` 根与内层都是 `flex-1`，图标被推到容器右端），后者让用户侧多出「这里也能做分支」的暗示。收敛结论是：**消息级操作只挂在 AI 回复上，低频操作折进一个「⋯」**。

**改动**：

| 位置 | 之前 | 现在 |
|---|---|---|
| 顶部标题右侧 | 侧边提问图标（`MessageSquareDashed`，`WorkspaceHeader`） | 删除 |
| 用户消息 footer | 编辑、派生、侧边提问、选择、复制、时间 | 编辑、选择、复制、时间 |
| AI 回复 footer | 派生、复制、朗读、模型、时间、耗时 | 复制、朗读、**⋯**、模型、时间、耗时 |

「⋯」用的是共享 `ActionMenu`（`portal`），菜单项为「从此处派生」「从此处侧边提问」。三点选择都不是随意的：

1. **必须 `portal`**：footer 是 `overflow-x-auto` + 右侧渐隐 mask，绝对定位的菜单会被自己的滚动容器裁掉、也会被 mask 吃掉。
2. **触发按钮要脱掉 Button 的外壳**：footer 里全是裸图标（3.5 号），共享按钮的 `h-10 w-10` 会把它撑大一倍且多出 hover 底色；用 `triggerClassName` + `[&_svg]:size-3.5` 压回同一档。
3. **菜单是操作组尾巴**：放在朗读之后、模型名之前，常用控件（复制/朗读）位置不动。

**连带删除的 plumbing**（入口在 header 时才有意义的那套）：`WorkspaceHeader.onOpenSideAsk`、`WorkspaceMain` 的 `sideAskRequest` 计数器与 `sideAskHasAnchor` 上报、`ChatInterface` 的 `sideAskRequest` / `onSideAskAvailabilityChange` 两个 prop 与对应 effect，以及 i18n 里随之失去消费者的 `sideAsk.open`。抽屉的「重新开始」仍走 `handleSideAskRefork`，未受影响。

**验收**：
- 单元/组件测试：`messageStreamEnd.test.tsx` 的断言改成「菜单里两项、点谁触发谁」，并新增「用户消息没有 ⋯ 也没有派生/侧边提问」一条。
- 真机（1440×900，`127.0.0.1:3011` 直连守护进程）：AI 回复可见 3 个「⋯」（3 条回复）；用户消息 footer 只剩「编辑并重新发送 / 选择消息 / 复制消息」；顶部 `header` 里已无侧边提问按钮；点「⋯」后菜单 220×82 贴在触发按钮下方 6px、两项文案正确；点「从此处侧边提问」抽屉正常打开（420 宽，右侧）。
- client 全量 235 文件 1907 测试 0 失败、typecheck / lint 0 error / build:client 通过。

**遗留**：从 AI 回复触发时抽屉的锚点标签可能退回默认文案「上下文截止到你的最后一条消息」——`sideAskAnchorLabel` 靠 `message.id` 在 `chatMessages` 里找序号，而 `id` 只来自 `segmentId`（部分行没有），找不到就退回默认。这是既有逻辑，旧入口同样会命中，不在本次改动范围。

**行为边界**：入口收编后，一条刚发出、还没有 AI 回复的提问无法开始侧边提问（用户消息侧不再有图标）。这是「用户侧不做这几个操作」的直接代价，属预期。

### 17.9 「选择消息」也移到 AI 侧（2026-10-22）

收编的第二步：用户侧不再承担任何消息级操作，于是**局部导出的入口也从问句搬到答案**，并与派生/侧边提问一起放进 AI 回复的「⋯」。

- **行为不变的部分**：点「选择消息」仍然是「选中这一整轮」——该轮的问题 + 本轮所有可选的答案，工具行不进选区。入口换了位置，导出的单位没换。
- **实现**：`collectTurnSelectionKeys` 的第二个参数从「必须是该轮用户消息的 key」放宽为「该轮内任一行的 key」，内部由 `findIndex` + 轮的 `[startIndex, endIndex]` 区间反查所属轮；不被任何轮覆盖的行（窗口从一轮中段开始）退化为只选它自己。`ChatMessagesPane` 的接线不用改。
- **菜单顺序**：选择消息 → 从此处派生 → 从此处侧边提问。副作用是**每条可选的 AI 回复现在都有「⋯」**（原先只有带 `forkAnchorId` 的行才有），因为选择与 provider 的分叉能力无关。
- **测试**：`transcriptSelection.test.tsx` 的入口用例改成「从答案的菜单进入、回调拿到的仍是整轮」；新增「问句不再有入口」「答案的 key 能反查到所属轮」「无轮覆盖的行只选自己」。另修 `transcriptStreamingRerenders.test.tsx` 的夹具自检：它原用 `button[aria-expanded]` 的数量证明工具组真的折叠了，AI 回复多出菜单触发器后变成 8，改判 `button[aria-expanded]:not([aria-haspopup])`（折叠组按钮无 `aria-haspopup`，`ActionMenu` 触发器有）。
- **真机**（1440×900，`127.0.0.1:3011` 直连）：菜单 220×118 三项；点「选择消息」后底部出现「已选 2 条消息」（该轮的问题 + 答案，选区高亮在两侧），取消后复选框与选择条清零；用户消息 footer 已无「选择消息」。

### 17.10 旁问外壳与执行过程折叠（2026-10-22）

抽屉此前只借了主线的 `MessageComponent`，没借它的外壳，于是同一份消息在抽屉里是另一副样子：14px 衬线、行与行之间没有间距，思考与工具调用一张一张铺开且永不收起。

**外壳（三项，同一个根因）**

1. 滚动容器加 `chat-messages-pane`。这正是主线字号规则（`.chat-messages-pane .chat-message .prose`）与 `contain: layout style paint` 的作用域；computed 值会序列化成 `content`（= layout + paint + style），不要误判成没生效。
2. 消息外层补 `mx-auto w-full space-y-3 px-4`。主线的行外边距来自 `ChatMessagesPane.tsx` 的这层包裹（外加 `max-w-[62.5rem]`，抽屉宽度用不到），**不是**消息行自带的 `px-3 sm:px-0` ——后者是气泡内边距。所以「去掉抽屉的 `px-3` 让行内边距生效」是错的写法，会直接贴边。
3. 输入框跟随设置。抽屉不是 `.chat-composer-shell`（那套还带着 shell 的 containment 与 `--chat-composer-safe-bottom`，fixed 浮层不该继承），因此单独加 `.btw-composer .btw-input` 一条规则，取 `--ui-font-family` / `--ui-font-size`。

**折叠（最小档）**

- 复用 `deriveExecutionProcessProjection`（纯函数，主线同款）与 `buildTailAnchoredMessageKeys`；`isProcessing` 用 `BtwDrawer` 已有的同名 prop 下传，不新增状态源。
- 展开状态是抽屉本地 `Map<disclosureKey, collapsed>`，缺省取 `group.defaultCollapsed`（ordinary run 为 true）。主线的跨会话持久化与「搜索揭示」不在本档。
- 折叠时**跳过组员渲染**，在 `firstMemberKey` 处渲染 `ExecutionProcessSummary`，在成员末尾渲染 `data-execution-process-end`。marker 不能省：`ExecutionProcessSummary` 的 sticky 靠它判断何时停止吸顶，缺了会一直粘着。
- **attention 成员豁免折叠**（`group.attentionKeys`）：待批的权限卡、失败的调用本身就在 run 里，折掉等于把用户要处理的卡片藏起来。主线同样豁免。
- 与主线的差异（有意）：没有工具组的紧凑列表（`ToolGroupContainer` 的三条以上折叠）、没有 reasoning 的 handoff/自动收起序列、展开状态不跨会话记住。这些只在手动展开后才看得见。

**验证**

- `btwMessageListExecution.test.tsx` 四条：pane 类存在 + 默认折叠（答案与问题可见、思考不渲染）、点开后成员行回到转录、attention 行在折叠态仍可见、空会话不渲染组头。
- 真机（1440×900，`127.0.0.1:3011`）：抽屉 420 宽；`.chat-messages-pane` 命中且 `contain` 为 `content`；输入框 computed `17px` + system 字体（与主线一致）。
- **折叠的真机态未验**：抽屉里发消息时 `btw.send` 没有成功（文本留在输入框、无 ephemeral 会话落库），与守护进程未重启、`/btw` 写端点尚未生效一致。等重启后再补一次「有思考的旁问」观感核验。
- 标题未改（`sideAsk.title` 仍是「侧边提问 / Side question」）：命名尚未拍板，`sideAsk.title` 是唯一显示位，改一个键即可。



### 17.11 剪点从「被点的行」移到「该行的轮末」（2026-10-22）

**起因**：17.8 把入口搬到 AI 回复后，「从此处侧边提问」传的是该条回复的 `forkAnchorId`，而服务端 §5.2 只认用户文本行 ⇒ 真机报「不能作为锚点」。修法有两个方向：让前端退回传「这条回复所属的用户消息」，或者放宽服务端。真正决定方向的是一次实测。

**实测（十家 harness，各起一个临时会话：用户问 A → 助手答 A → 用户问 B → 助手答 B，然后从用户 B 所在位置剪一份副本并发旁问 C）**

| 结果 | provider | 现象 |
|---|---|---|
| 稳定双答 | pi、omp | 副本里既有对 B 的完整回答，又对 B 再答一遍，然后才答 C |
| 补假回复 | claude | 给悬空的 B 补一条 `No response requested.` |
| 正常 | workbuddy | B 被降级为历史，只答 C |
| 无悬空 | codex | 剪点本来就是 turn 粒度，B 与它的回答一起进出 |
| 走不通 | dsh（用户行无 anchor）、opencode（401）、zcode（余额）、cursor（无 transcript）、openclaw（已卸载） | 未验成 |

结论：剪在提问行会让副本留下**没人回答的问题**，provider 把它当待办。所以「退回去传用户消息」是错的方向——它只是把入口暴露的问题藏起来，双答照旧。正确方向是**把剪点推到该轮结束**。

**规则**（§5.2 已就地改写）

- 可切行 = 带 `forkAnchorId` 的 `user`/`assistant` **文本行**；工具行即使带锚点也不算（pi / omp / zcode 是逐行盖锚点的，停在「调用发出、结果未回」之间是可能无法恢复的转录）。
- 请求里的锚点是**游标**：从它往下扫，遇到下一条真正的用户提问前停下，取范围内最后一条可切行。被点的行本就在轮末时不动。
- 未传锚点时取最后一条可切行 = 最后一轮的末行；与显式路径同一套语义，不新增分支。
- `anchorMessageId` 回填**剪点**而不是被点的那行（否则提示条说「截至第 3 条」而副本实际含到第 6 条）。前端 `sideAskAnchorLabel` 因此改成优先读 `btw.anchorInfo?.anchorMessageId`，请求值只在副本创建前兜底。

**实现**：`btw.service.ts` 里 `isAnchorableUserMessage` → `isCuttableMessage`（放开 assistant 文本行），新增 `advanceToTurnEnd` 与 `startsUserTurn`（后者排除 `isCompactSummary`，否则 workbuddy 的压缩摘要行会被当成新轮起点，把剪点提前）。匹配改在完整历史上按 index 找（`cuttable` 只用于「最后一条」与空集判断）。约 40 行。

**测试**（`btw.routes.test.ts`，10 条全绿）

- 显式锚点落在第一轮提问 → 剪到该轮回复（`anchor-1` → `anchor-2`），`anchorMessageId` 同步变成回复行。原文那条测试断言的正是旧语义，已改。
- 新增「锚点在助手回复上」：落在轮末不移动，且不越过下一条提问。
- 新增「一轮里有两次工具往返」：从提问剪，跳过工具行，停在下一轮提问前；工具行的锚点被拒（400）。

**未验 / 遗留**

- 真机未复验：需要重启守护进程才吃得到服务端改动，等下次重启后补一次「从 AI 回复开抽屉 → 抽屉里看到该轮完整回答」。
- pi / omp 的双答是否消失，需要重启后再跑一次同一条矩阵；本次只证明了剪点规则，没有重跑真跑。
- 源会话正在生成时，末行可能是「调用已发、结果未回」，此时剪点回落到该轮最后一条文本行（少带一次工具往返），但不会留下半条工具链 —— 这是有意取舍，未在真机压测。

### 17.12 窄容器里的 markdown 表格（2026-10-22）

**现象**：抽屉里的表格每一列都被压成窄条，文字逐字换行；同一张表在主会话里正常。

**根因**：表格的「列宽保底」写成了**视口**媒体查询 —— `@media (max-width: 768px)` 下 `.chat-message .markdown-table` 才拿到 `min-width: 36rem`、单元格 `min-width: 8rem`（`src/index.css`）。抽屉是 `w-full sm:w-[420px]`，在 1440 的窗口里它很窄但视口很宽，媒体查询永远不触发；而 `.chat-message * { max-width: 100% }` 把 `min-w-full` 的表格钉在容器宽度上，`table-layout: auto` 只能把每一列继续压扁。换句话说，**判据一直是「屏幕窄不窄」，而真正决定列宽的是「这个容器给了表格多少空间」**。

**改法**：`.markdown-table-wrapper` 加 `container-type: inline-size`，把同一组保底声明再写一份进 `@container (max-width: 36rem)`。容器查询命中的条件是 wrapper 自己的宽度，抽屉里是 386px（420 − 两侧 `px-4`），必然触发；主会话 998px，不触发。

**为什么两份规则并存**：`@container` 要 Safari 16+，而项目构建 target 没有抬到那个版本；直接替换媒体查询会让老 Safari 连手机上的保底都失去。所以媒体查询保留原样做回落，两份声明**必须一起改**——注释里已写明这一点。

**验证（真机 1440×900，`127.0.0.1:3011`，真实抽屉外壳结构）**

| 容器 | wrapper | table | wrapper scrollWidth | 结果 |
|---|---|---|---|---|
| 抽屉（`aside` 420 + `chat-messages-pane` + `px-4`） | 386 | 576 | 576 | 横向可滚，列宽保底生效 |
| 主会话（1000 宽） | 998 | 998 | 998 | 不误伤，表格仍随容器 |

`getComputedStyle(wrapper).containerType === 'inline-size'` 是这条规则真的落地了的直接证据（不是"看起来对了"）。

**没有自动化守卫**：`tests/transcript-layout` 与 `tests/theme-tokens` 都不覆盖表格宽度，这条只能靠上面的读数。若以后把 `container-type` 挪走或改掉 wrapper 类名，症状会回到"表格挤扁"，不会报错。

### 17.13 抽屉断开后的宽限期回收（2026-10-22）

**起因**：用户问「刷新后侧栏里消失的副本会不会变成脏数据」。查下来不脏，但回收窗口太长 —— 只有关闭按钮（X / Esc / 点背景）会立刻 DELETE，刷新绕过了它，副本要等启动清扫（下次重启）或 30 分钟一次的 6 小时扫描。

**先澄清一个不存在的通道**：前端**没有任何重连入口**。副本 id 只活在 `useBtwSession` 的 `useState` 里，没有 localStorage / URL / store 持久化；`is_ephemeral` 在 `src/` 下零引用，所以侧栏、搜索、列表都不可能显示它。刷新＝这份旁问永久放弃，这一轮**不做恢复入口**（用户拍板只做回收）。

**方案**：`server/modules/websocket/services/session-presence.service.ts` 记录「哪个 socket 在订阅哪个 session」，最后一个 watcher 断开后起一个 **2 分钟**的宽限期，到期仍无人订阅才回收。

- 订阅即 watcher：`chat.subscribe` 里 `watchSession(ws, sessionId)`；`ws.on('close')` 里 `forgetConnection(ws)`。多标签页天然正确 —— 任一 socket 还订阅就不算 idle。
- 宽限期的意义：socket 断开不等于抽屉关闭（合盖、网络闪断、重连）。客户端回来重新订阅会取消定时器。
- 回收动作复用 `btwService.destroyBtwSession`（先 quiesce 再删行 + transcript + 伴随目录）。回收前重读一次行：正常关闭 / 提升 / 上一轮清扫已经处理掉的，静默跳过。
- 装配方向是**反向注入**：presence 模块零 import（它被 chat gateway 调用，而 btw.service 已经依赖 gateway，直接 import 会成环），由 `ephemeral-cleanup.service.ts` 在启动时 `configureSessionPresence({ graceMs, onIdle })` 注册回调；`configureSessionPresence(null)` 同时清定时器与全部 watcher 记录（关闭路径 + 测试隔离都用它）。

**必须配套的客户端改动**：`ChatInterface.handleWebSocketReconnect` 原来只重订阅当前选中会话，**不重订阅旁问副本**。不改的话任何一次网络闪断都会在 2 分钟后杀掉正开着的抽屉（还会顺带修掉一个既有缺口：重连后抽屉不再收流式帧）。现在按 `sideAskStreamingSessionIdRef` 一起订阅，`lastSeq` 取 `lastSeqRef` —— 该 ref 由 realtime handler 对**每条带 seq 的帧**写入（不只选中会话），所以旁问的 seq 是准的。

**留在旧路径上的两种副本**：① 创建成功但 `chat.subscribe` 从未送达（页面在创建与订阅之间被杀）—— 没有 watcher 记录，不会起定时器；② 回收时 quiesce 超时返回 409（后台任务不肯停）—— 与关闭失败同样处理。两者都落回 6 小时扫描。

**测试**（`server/modules/websocket/tests/session-presence.test.ts`，4 条全绿）：多 watcher 时最后一个才算 idle、宽限期内重订阅取消回收、一个 socket 关掉多个会话各通知一次（重复订阅不重复通知）、集成路径（`chat.subscribe` 记 watcher → `close` 才通知）。**客户端那条重订阅没有自动化守卫**（`handleWebSocketReconnect` 是组件内联回调，现有测试只到 hook 层），只能靠这条记录兜住。

**未验**：真机刷新后 2 分钟副本是否真被回收 —— 需要重启守护进程让新服务端生效。
