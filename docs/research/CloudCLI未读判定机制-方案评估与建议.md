# CloudCLI「未读」判定机制：现状复盘、方案评估与建议

> **文档性质**：方案评估。分四部分——① 现状事实复盘；② 我的建议；③ 面向评审 AI 的开放问题；④ 审阅批注与处置。
> **状态**：**方案已定案并已实施（2026-10-11 拍板 b + B-1 + C-1 + D-a；T1–T5 全部落地，双端全绿）**。本文 §1–§6 及 §9.1 描述的是**改造前**的现状（本文的论证对象）；实施结果见 §7 与 §9.3。已吸收三轮审阅（第一轮 12 条 / 第二轮 6 条 / 第三轮 9 条，见文末处置表）。
> **关联文档**：
> - `docs/research/CloudCLI侧边栏状态指示重设计方案.md`（一期：双通道信号）
> - `docs/research/CloudCLI侧边栏状态指示重设计-二期需求.md`（二期：需求 A/B/C/D，尤其 §3.6 的边界）
>
> **阅读提示（对评审者）**：文中凡是 **【事实】** 的段落，是代码/实测可复现的结论，请直接核对；凡是 **【建议】** 的段落，是我的判断，**欢迎推翻**；§8 是我专门留给评审者的问题清单，请优先回答。

---

## 决议清单（✅ 已拍板 · 2026-10-11）

> **✅ 拍板结论（2026-10-11）**：采纳**默认配方**——**总闸 (b) 仅下沉读/判定 ＋ 决定 1 B-1（只 raise、不清）＋ 决定 2 C-1（写留前端）＋ 决定 3 D-a（增量载荷附 `isUnread`）**。据此 **T1–T5 全部解除阻塞**，T3/T4 的验收标准已按本配方写死在 §7。
>
> **怎么用**：以下四项是落地前的岔路，每项列出「**选项 / 后果**」。**本文已按上表拍板定案**；保留选项与后果仅为存档决策依据——日后若需改判，改这里即可。

**总闸（= §8 Q10）｜是否执行下沉？三选一：**

- ✅ **(b) 仅下沉读 / 判定，写仍留前端**（**已选**）。收益＝**修复"刷新即丢未读"（来源 ② 由服务端重算并持久化）+ 判定真相收敛到一处**；改动可控，不必一步到位动写路径。
- **(a) 维持现状**：判定留在前端，需求 B 原地即终态。**无冗余、无回退**；代价＝本 bug（未覆盖 provider 永不未读）不修。
- **(c) 读与写都下沉**：前端水位 Map 整体可退。改动最大，且依赖下面「决定 1」先拍。

### 决定 1｜前置 B：清除规则与三来源合并优先级（✅ 已选 B-1）

> **✅ 已拍板（2026-10-11）：B-1 —— 只 raise、从不清。** 语义＝**无水位会话来了消息 → 蓝点上升并保持，直到用户打开**。

**问题**：下沉后，服务端算出的 `isUnread = false`，该不该**真的清除**前端已有的未读标记？

| 选项 | 做法 | 后果 |
|---|---|---|
| **B-1 只 raise、从不清** | 服务端结论只用来"点亮"，永不"熄灭" | ✅ 不与来源 ①（WS）/ ③（权限）打架（保住现不变量 `useProjectsState.ts:645-665`）；❌ 放弃"多端自动熄灭"收益——设备 A 已读，设备 B 不灭 |
| **B-2 双向镜像（false 即清）** | 服务端结论完全覆盖前端 | ✅ 多端一致；❌ 必须**正面解**下面的语义冲突，否则每次全量投影都会灭掉来源 ① 刚点的灯 |

**必须正面回答的场景**（**B-2 路径下的真冲突是语义不一致，不是时序竞态**）：§2.5 边界 1（**无水位** ⇒ 服务端 `isUnread` 恒 `false` `sessionReadState.ts:54`）× 来源 ①（WS **不查水位**，对用户**从未打开过**的会话照样设 notice `useProjectsState.ts:1039`）。
→ **用户从没点开的会话来了消息，蓝点该不该在下次全量投影时被灭掉？（选 B-2 时必须正面给规则；选 B-1 则不会被灭）**

**我的推荐**：**B-1**。其确切含义只有一句——**无水位会话来了消息 → 蓝点上升并保持，直到用户打开**（"打开即消费"：`clearSessionAttention` 在 `handleSessionSelect` `useProjectsState.ts:1335` 与切换时 `:1182` 均清灯，故灯是可熄灭的，只是"只能靠打开熄灭"）。
- ⚠️ **代价（第三轮补充，拍板前须看到）**：对"**用户永不打开**"的会话（如被忽略的旧项目），蓝点**会永久驻留**；来源 ③ 的权限灯同理。若不可接受，B-1 需再配一条"**驻留上限**"（如仅最近 N 天会话显示未读）。
- （**第三轮更正**：此前写的"给来源 ① 补例外 / 来源 ② 放弃否决权"是**同义反复**——B-1 的定义本就是"来源 ② 永不主动清"，已删。）
- 若评审更看重"设备 A 已读 ⇒ 设备 B 自动熄灭"，唯一路径是 **B-2** 并定义"无水位 ≠ 已读"的第三态。

### 决定 2｜前置 C：水位的"写"路径迁不迁移到服务端？（✅ 已选 C-1）

> **✅ 已拍板（2026-10-11）：C-1 —— 写留前端，本轮不迁**（用一条约束兜住：兜底值"**不早于已写水位**"）。

**背景**：本轮（§6.2）只下沉"读 / 判定"；水位的**写**仍在前端（切会话时 PUT 快照，§2.4）。

| 选项 | 后果 |
|---|---|
| **C-1 不迁（写留前端）** | ① **历史行一次性残余**：S4 **不给存量行回填** `content_updated_at`（§1.2 实测 37 条全 NULL），故升级后这些会话**首次打开-离开仍写不进水位**（`markSessionSeen(sid, null)` 早退），要到有一次新内容事件（S4 盖上兜底值）后**第二次**打开才恢复正常；新会话无此问题。（**第三轮更正**：Claude 原判"后果①被 S4 自发消解、应删"过强——mimo 实测 S4 不回填，故后果①**降级为历史行残余**，而非消失。）② 前端写"列表快照"，若兜底 `now()` 晚于离开时刻落库 ⇒ 写入**偏旧**水位 ⇒ 升级后假未读 |
| **C-2 写也下沉**（服务端在**用户切走**时自落水位） | ✅ 彻底消除 C-1 两条；❌ 需确定"离开时刻"的判定点（服务端怎么知道用户切走了），改动更大。**⚠️ 不可用"Turn 结束"当判定点**（第三轮补充）——那是**助手产出完毕**的时刻，此时推水位＝**用户还没看就已读**，直接摧毁未读语义；锚点只能是「**用户视角的离开**」 |

**我的推荐**：**C-1（本轮不迁）**——先把"读"下沉拿到收益，写路径用一条**约束**兜住：兜底值"**不早于已写水位**"（或排序保证）。C-2 留作下一阶段。**但须明确：C-1 是决策，不是遗漏。**

### 决定 3｜前置 D：增量事件载荷要不要带 `isUnread`？（**决定性**）（✅ 已选 D-a）

> **✅ 已拍板（2026-10-11）：D-a —— 载荷附 `isUnread`**（把 userId 穿给 `buildSessionUpsertedEvent`）。**须同时落实下方"必现配套"**：水位写入后同步使相关行 `isUnread` 失效 / 置 false。

**背景**：项目列表**主要靠增量 `session_upserted` 维护**（`useProjectsState.ts:901-913`），而该载荷**只带 `contentUpdatedAt`、不带 `isUnread`**（`session-upsert-broadcast.service.ts:57`），且广播 **user-agnostic**（`:73-85`）。⇒ 下沉后**增量行拿不到服务端布尔**。

| 选项 | 做法 | 后果 |
|---|---|---|
| **D-a 载荷附 `isUnread`** | 把 userId 一并传给 `buildSessionUpsertedEvent` | ✅ §6.5「删薄层、**冗余面 = 0**」的**唯一成立途径**；❌ 广播混入 per-user 字段（本地单用户＝**理论性**冲突） |
| **D-b 增量行保留前端判定** | 载荷已带 `contentUpdatedAt`，前端用内存水位 Map 继续 `isSessionUnread` | ❌ §6.5「冗余面 = 一个函数」**不成立**——该函数是**增量路径的成员**，不可整体删 |
| **D-c 增量行不参与重建** | 全靠来源 ① raise | ⤴ 绕回**决定 1**（clear 规则） |

**我的推荐**：**D-a**——对**本地单用户**工具，"广播带 per-user 字段"破坏 user-agnostic 是**理论性**的（默认就一个用户），换来的是判定真正收敛到一处、前端判定薄层可整体删除。若评审坚持保留 user-agnostic，则落到 **D-b**，并接受"前端判定薄层 ≥ 一个函数、且与 hydrate 的水位 Map 强绑"。

**⚠️ D-a 的必现配套（第三轮补充）**：走 D-a 后，若重建改为**读行字段**（而非实时比较水位 Map），会引入"**刚读完又亮**"的假未读——链：用户打开会话 → `clearSessionAttention`（`:1335`）清灯 + `markSessionSeen`（`:1178`）更新水位 → 水位 `notify()` 触发 `applyPersistedUnread` 重跑（订阅 `:674`）→ 此时**行对象里的 `isUnread` 仍是快照 `true`**，蓝点**在用户刚读完后再次亮起**（现状因重建是**实时比较水位 Map** `sessionReadState.ts:58-64` 而对此免疫）。⇒ D-a **必须**附带一条约束：**水位写入后，同步使相关行的 `isUnread` 失效 / 置 false**，否则"冗余面 = 0"是拿一个新的假未读换来的。

### 三项如何联动

- **总闸 (a) 维持现状** ⇒ 三项全部作废，本清单不用答。
- **总闸 (b) 仅下沉读** ⇒ 三项全答；**决定 3 的选法直接决定 §6.5 的冗余面**（D-a ⇒ 0，D-b ⇒ ≥ 1 函数）。
- **总闸 (c) 读写都下沉** ⇒ 决定 2 变为 C-2，且**依赖决定 1（clear 规则）先拍**才能删前端水位 Map。
- **落到 T 步骤**：**T3 不依赖任何一项**（投影补 userId + `isUnread`，纯服务端）；**T4 依赖决定 1** 才能定验收标准。

### 默认实现配方（建议直接采纳）与收益边界

**默认配方 = 总闸 (b) + 决定 1 B-1 + 决定 2 C-1 + 决定 3 D-a** —— 建议把 **T3 / T4 的验收直接挂在这个配方上**，其余选项计入下一阶段或不纳入本轮（避免逐项反复横跳）。

**⚠️ 该配方的收益边界（第三轮补充，勿误读为"三满收敛"）**：B-1 明确**放弃了"多端自动熄灭"**（服务端 `isUnread=false` 永不驱动清除）⇒ 配方实际价值 = **① 修复"刷新即丢未读"（来源 ② 持久化）+ ② 判定真相收敛到服务端**；而 §6.2 所说的"**多端一致 / 设备 B 自动熄灭**"在本配方下**拿不到**。若"多端熄灭"是硬需求，唯一路径是 **B-2 + 为"无水位 ≠ 已读"定第三态**。

---

## 0. 摘要（TL;DR）

- **现象**：WorkBuddy / OpenClaw 会话的「加粗 + 蓝点」（未读）在刷新后消失；Claude 会话正常。
- **根因**：未读的持久化判据是 `sessions.content_updated_at > session_read_state.last_seen_at`，而 **`content_updated_at` 目前只有 Claude 会产出**（其余 provider 恒为 `NULL`）。刷新后前端重建未读时判据恒为假，蓝点消失。
- **我的建议（§6）**：三件事——(A) 给「内容版本」加**中心化兜底**（provider 给精确值则用，不给则由中心化的事件路径兜底），使绝大多数 provider **零改动**即可生效；(B) 把**未读判定下沉到服务端投影**（前端不再持有判定真相）；(C) 统一「内容版本」的**表示与比较**（实测各 provider 的原始格式并不一致）。
- **我主动提出的更强替代（§6.4，请评审定夺）**：把「内容版本」从**时间戳**换成**单调递增的 revision 游标**，可彻底规避时间戳方案的漏判/精度问题。
- **审阅后新增的关键限制**：S4 的兜底对**共享 SQLite 型 provider（openclaw）会翻转成"永假未读"**，故「给这类 provider 补精确值」从可选升级为**S4 同批必做**（§5 S4、§8 Q5）；§6.2 的下沉还暴露**四个落地前置**（用户身份穿链 / clear 规则 / 写路径 / 增量载荷缺 `isUnread`，见 §6.2）。
- **与既有设计（需求 B）的关系（§6.5）**：下沉**不推翻、不回退**需求 B——它是需求 B 的**第二阶段**，**复用其全部数据层**（水位表 / `content_updated_at` / 读写接口 / 投影），只**替换前端那一薄层判定**（`isSessionUnread` + `applyPersistedUnread`）。且需求 B 代码**尚未提交**，本就无"回退"可言。
- **第二轮审阅新增（前置 D，决定性）**：`session_upserted` **增量载荷不含 `isUnread`**（且广播 user-agnostic）——而项目列表**主要靠增量维护**（`useProjectsState.ts:901-913`）⇒ 下沉后**增量行拿不到服务端布尔**。三选一**直接决定 §6.5「冗余面 = 一个函数」真假**：给载荷带 `isUnread`（≈0）/ 增量行保留前端判定（≥1 函数）/ 增量行不参与重建。**同时更正**：前置 B 的"5s 竞态"载体**失实**（项目刷新是事件驱动，无周期轮询），**真冲突是"§2.5 边界 1（无水位⇒false）× 来源 ①（WS 对从未打开的会话照样 raise）"的语义不一致**。
- **最希望评审者回答的一句话**：*「内容版本」应该由 provider 提供原始时间戳，还是由中心化路径维护一个与格式无关的游标？（§8 Q1/Q6）*

---

## 1. 问题陈述

### 1.1 现象

用户在 WorkBuddy（日常主力 provider）会话中看到会话行出现「加粗标题 + 右缘蓝点」，但**按刷新后即消失**；Claude 会话的未读不消失。

### 1.2 根因链（实测证据）

【事实】以下四项均为在运行中的本机环境实测：

1. 活库为 `~/.cloudcli/auth.db`：`session_read_state` 表**已建**，但 **0 行**——水位从未写入。
2. `sessions.content_updated_at`：**37 条全部为 NULL**。按 provider 分组：

   | provider | 会话数 | 有内容指纹的条数 |
   |---|---|---|
   | claude | 3 | 0 |
   | codex | 1 | 0 |
   | openclaw | 12 | 0 |
   | opencode | 1 | 0 |
   | workbuddy | 20 | 0 |

   （注：此处 claude 的 3 条也是 0，因为它们是在本功能落地**之前**索引的；即便 Claude 支持抽取，历史行也没有回填。）
3. 守护进程日志：`GET /api/user/read-state` 出现十余次（hydrate 正常），`PUT`/`DELETE` **一次都没有**——前端从未写过水位。
4. 代码链：投影 `contentUpdatedAt = row.content_updated_at ?? null` → `markSessionSeen(sid, null)`（`src/shared/sessionReadState.ts:125`）**直接早退不写**；`isSessionUnread(sid, null)`（同文件 `:49`）**恒返回 false**。

**结论**：没有内容指纹 ⇒ 水位写不进 ⇒ 刷新后重建不出未读。用户看到的蓝点**只是内存里的 WS 事件**，刷新即空。

### 1.3 真正的问题（结构性）

【我的判断】上面的根因不是"漏给 WorkBuddy/OpenClaw 写几行代码"，而是：

> **「未读」的持久化，把"提供一个内容级版本量"的责任，按 provider 逐个下发到了各自的同步器里。**

当 provider 数量增长（当前已有 claude / codex / opencode / dsh / zcode / workbuddy / pi / omp / cursor / openclaw 十条线），"每加一个 provider 就要有人记得补内容指纹"就成了一种**容易漏、且漏了静默**的负担。这正是本问题值得做一次方案评估、而非直接打补丁的原因。

---

## 2. 现状机制复盘【事实】

### 2.1 数据库里的两个字段

| 字段 | 语义 | 生产者 | 消费者 |
|---|---|---|---|
| `sessions.content_updated_at` | **会话内容版本**：该会话最新一条真实对话事件的时间戳 | provider synchronizer（索引/更新会话时） | 前端重建未读 |
| `session_read_state(user_id, session_id, last_seen_at)` | **用户水位**：用户离开该会话那一刻，该会话的内容版本快照 | 前端（切换会话时） | 前端重建未读 |

> 设计要点（二期 §3.6）：水位存的是**内容版本快照**而非本地时钟，避免时钟偏斜；`content_updated_at` 取**正文里的时间戳**而非文件 mtime，避免 `touch` 造成假未读。

### 2.2 两个独立信号

【事实】讨论"未读"时，有两个常被混为一谈的信号：

- **信号 1｜"这次是不是新内容"**（`content` vs `metadata`）——由 `session_upserted` 事件的 `change` 判别位承载。
  生产者是**中心化**的：`sessions-watcher.service.ts:263 classifyWatcherChange`、run-registry、fork 三处统一赋值。
- **信号 2｜"内容版本具体是什么值"**（供持久化比较）——由 `sessions.content_updated_at` 承载。
  生产者是 **per-provider**：各 synchronizer 从自己的磁盘格式里抽取。

**这个"一个已中心化、一个还需 per-provider"的不对称，是全部讨论的核心（详见 §3）。**

### 2.3 两条通道 + 三个来源

**两条正交通道**（`src/modules/sidebar/SessionStatusIndicators.tsx`）：

| 通道 | 位置 | 回答的问题 | 形态 |
|---|---|---|---|
| `ActivitySlot` | 左缘 | "它在动吗？"（瞬态） | 前台在跑 → 灰色旋转圈；仅后台在跑 → 紫色脉冲点 |
| `AttentionSlot` | 右缘 | "有东西在等我吗？"（粘性） | `action` → 琥珀胶囊＋⚠；`notice` → 蓝色小圆点 |

标题层面：`attentionLevel` 有值且未选中 → `font-bold`（`SidebarSessionItem.tsx:77/178`）。即"未读"的可见表现 = **加粗 + 右缘蓝点**。

**三个来源**（都汇入前端内存 Map `attentionSessions`）：

| 来源 | 触发条件 | 落点 |
|---|---|---|
| ① WS 实时 | 收到 `session_upserted` 且 `change !== 'metadata'` 且非当前正在看的会话 | `markSessionAttention(id,'notice')`（`useProjectsState.ts:1039`） |
| ② 水位重建 | 加载后/水位变化时，`isSessionUnread(id, contentUpdatedAt)` 为真 | 设 `'notice'`（`useProjectsState.ts:642-665`） |
| ③ 权限请求 | 有未答复的 pending approval | 设 `'action'`（`useProjectsState.ts:46`） |

**来源 ② 是唯一能在刷新后存活的通道**（来源 ① 是内存事件，刷新即失）。**注意来源 ② 有一条不变量——"只 raise、从不清"**（`useProjectsState.ts:636-638`），它是为"不与来源 ① / ③ 打架"而设；下沉方案必须重新回答这条不变量（见 §6.2 前置 B）。

### 2.4 写读时机

- **写 `content_updated_at`**：watcher 发现文件变化 → synchronizer 读文件 → `sessionsDb.createSession` upsert（`sessions.db.ts:132`，`content_updated_at = COALESCE(?, content_updated_at)`）。
- **写 `last_seen_at`**：**切换会话时**（`useProjectsState.ts:1178`）对"离开的"和"进入的"两个会话各写一次，值取自最新项目列表里的 `contentUpdatedAt`；值未变则不发请求（`sessionReadState.ts:128`）。
- **读 `last_seen_at`**：页面加载/登录时 `hydrateSessionReadState()` 一次性读全量（`AuthContext` 启动；`sessionReadState.ts:73`）。
- **读 `contentUpdatedAt`**：随项目列表投影（`GET /api/projects`）逐会话下发。

### 2.5 四条硬边界

【事实】以下边界是有意设计，但**第 2 条正是本次问题的扳机**：

1. 无水位（从未打开过）→ 永不未读（避免升级即满屏蓝点）。`sessionReadState.ts:54`
2. **无内容指纹（`contentUpdatedAt` 为 null）→ 永不未读（宁可漏报，不猜）。`sessionReadState.ts:49`**
3. 当前正在看的会话 → 不显示（打开即消费）。
4. 已有 `action` 不被 `notice` 降级。

### 2.6 代码落点

> 下列行号已按**实施后**的树校准（2026-10-11）。

| 关注点 | 位置 |
|---|---|
| 未读判据（前端，改造前） | `src/shared/sessionReadState.ts:45 isSessionUnread`；**服务端落点＝`server/shared/session-unread.ts isSessionContentUnread`** |
| 水位写/读/清 | `src/shared/sessionReadState.ts:121 markSessionSeen` / `:73 hydrateSessionReadState` / `:141 clearSessionReadState` |
| 前端重建 | `src/modules/project-workspace/hooks/useProjectsState.ts:646 applyPersistedUnread`（T4 后改读服务端 `isUnread`） |
| 前端写水位 | 同文件 `:1188`（切换会话时） |
| 事件分类 | `server/modules/providers/services/sessions-watcher.service.ts:263 classifyWatcherChange` |
| 单文件同步入口 | `server/modules/providers/services/session-synchronizer.service.ts:162 synchronizeProviderFile` |
| Claude 指纹抽取 | `server/modules/providers/list/claude/claude-session-synchronizer.provider.ts:132 synchronizeFileDetailed / :392 extractContentUpdatedAt` |
| 内容版本兜底 | `server/modules/websocket/services/session-upsert-broadcast.service.ts:110 stampFallbackContentTimestamp` |
| 归一化 | `server/shared/utils.ts normalizeContentTimestamp` |
| 投影 | `server/modules/projects/services/projects-with-sessions-fetch.service.ts:161 mapSessionRowToSummary`（`SessionSummary.contentUpdatedAt` + `isUnread`） |

---

## 3. 问题拆解：哪些该中心化，哪些**必然** per-provider

【我的判断】

把 §2.2 的两个信号分别问"能不能不做 per-provider"：

| 信号 | 能否中心化 | 理由 |
|---|---|---|
| 信号 1（是不是新内容） | **能，且已经是** | 由 watcher/run-registry/fork 中心化赋 `change` 判别位；无需懂 provider 格式（`add` 一律算 content；`change` 则问 synchronizer，答不出就保守算 content）。 |
| 信号 2（内容版本的值） | **不能完全中心化，但可加兜底** | 各 provider 的"磁盘真相"格式异构——要取到"内容级时间戳"，必须懂格式。 |

**"格式异构"的具体含义**（这决定了为什么 per-provider 无法消除）：

| provider | 存储形态 | 内容级时间在哪 |
|---|---|---|
| claude | 一会话一 `.jsonl` 文件 | 正文每行的 `timestamp` |
| workbuddy | 一会话一 `.jsonl` 文件 | 正文每行的 `timestamp`（**毫秒数字**） |
| openclaw | **共享 SQLite 库**（一个文件装所有会话） | `session_nodes.last_interaction_at` |
| opencode / zcode | SQLite 库 | 待核 |
| dsh | log 文件 | 待核 |

【我的结论】因此正确的分工是：

> **「内容版本」的表示、比较、兜底、以及未读判定——全部中心化；per-provider 只负责"用我最便宜的方式供一个内容版本值"，供不出就不供（由中心化兜底）。**

现状恰恰相反：**比较与判定在前端（易碎），而"供值"被当成必答题。**

---

## 4. 事实核查：各 provider 的内容版本可得性

【事实】实测各 provider 的原始素材，得到一个重要发现——**B 方案（逐 provider 精确抽取）的成本被高估了**：

| provider | 现成素材 | 抽取成本 | 备注 |
|---|---|---|---|
| claude | 正文行 `timestamp`（ISO 毫秒，如 `2026-10-10T10:26:45.676Z`） | **已实现** | — |
| workbuddy | 正文行 `timestamp`（**毫秒 epoch 数字**，如 `1791531485193`） | **近零** | 抽取层**已自带归一化**：`workbuddy-sessions.provider.ts` 的 `readEventTimestamp` 同时吃 ISO 字符串与毫秒数字、统一输出 ISO。**仍需补的只是"取主线最新对话事件"的筛选**（该函数服务于消息归一化，不做主线筛选）。 |
| openclaw | `session_nodes.last_interaction_at`（毫秒） | **≈1 行** | 该字段是 OpenClaw 自维护的"最后交互时间"（内容级），且现有 synchronizer **已经在用它当 `updated_at`**（`openclaw-session-synchronizer.provider.ts:270`，`const updatedSource = row.last_interaction_at ?? …`），只是没往 `content_updated_at` 那一列写 |
| codex / opencode / zcode / dsh / pi / omp / cursor | 待核 | 待核 | 建议做一次逐 provider 可得性普查（见 §8 Q7） |

**两个由实测暴露的、影响方案判定的细节：**

- **细节 1｜格式不统一，且"兜底值必须是 ISO"是硬约束**：Claude 的内容版本是 ISO 字符串，WorkBuddy 是毫秒数字，openclaw 是毫秒数字。**实测** `new Date("1791531485193")` → `Invalid Date`，即 `sessions.db.ts:normalizeTimestamp` 对裸毫秒值会返回 `null`。**后果**：S4 的"兜底 `now()`"若以任何非 ISO 中间形态落库，读回时会被归一化吞掉、`content_updated_at` 变回 `null`，**S4 等于没生效**。⇒ 统一落库格式不是锦上添花，而是 **S4 的落地前置**；T1 必须加一条"兜底值落库后读回非空且为 ISO"的单测锁死。
- **细节 2｜同毫秒并写真实存在，且兜底会放大它**：实测 Claude 抓到两条 `2026-10-10T10:26:45.676Z`。当前判据是严格 `>`（`sessionReadState.ts:64`），**若"离开时的水位"与"新消息时间戳"恰好同毫秒，会漏判未读**。更糟的是：S4 用 `now()` 兜底时，兜底值（`content_updated_at`）与水位（`last_seen_at`）会**来自同一批 watcher 事件、同一个时钟**，戳到同一毫秒的概率比"provider 各自看盘"更高——**此放大效应仅限被兜底的 provider**（供得出精确值的 provider 不受影响）。这同时是 §6.4 revision 替代方案的实证动机。

---

## 5. 方案空间

四个候选（S1–S4），外加两个更激进的替代（X/Y）供评审者评估。

### S1｜现状：仅 Claude 产指纹

- 机制：只有 Claude 的 synchronizer 实现 `synchronizeFileDetailed`。
- per-provider 成本：0（但功能对其余 provider 不可用）。
- 抗 touch：✅（Claude 用正文时间戳）。
- 结论：**本次 bug 的直接成因，不可接受。**

### S2｜逐 provider 精确抽取（= 原 B 方案）

- 机制：给 workbuddy/openclaw 等各自补 `synchronizeFileDetailed`，从各自磁盘格式抽内容级时间戳。
- per-provider 成本：**近零到低**（见 §4：workbuddy 归一化现成、只差主线筛选；openclaw ≈1 行；其余待核）。
- 抗 touch：✅（前提是各 provider 都真的抽到了"内容级"而非 mtime）。
- 风险：**每新增一个 provider 都要记得补**，漏了静默退化为 S1（本次 bug 的复制）。
- 【我的判断】比预想便宜，但**没有解决结构性问题**（§1.3）。

### S3｜纯中心化兜底

- 机制：放弃 provider 抽取。由中心化路径在「信号 1 = content」时，把 `content_updated_at` 盖为事件发生时刻（`now()`）。
- per-provider 成本：**0**。
- 抗 touch：⚠️ 否——provider 报不出 `change` 判别位时（现状 workbuddy/openclaw 均报 null→保守算 content），`touch`/SQLite 的无关写入也会算内容变化 ⇒ **假未读**。Claude 若也改走兜底，会**丢掉现有的精确性**。
- 结论：对"零维护"最优，但精确性最差。

### S4｜混合兜底（**【建议·主推】**）

- 机制：`content_updated_at = COALESCE(provider 提供的精确值, 中心化兜底的事件时刻)`。
  - provider 能供精确值（claude / openclaw / …）⇒ 用精确值，保留抗 touch。
  - provider 供不出 ⇒ 由中心化在 content 事件时兜底，**自动生效、零 provider 改动**。
- per-provider 成本：**0（必做部分）+ 可选增量**（想更精确的 provider 再补）。
- 抗 touch：Claude 等精确；无指纹 provider 容忍偶发假未读。
- **⚠️ 风险（审阅重点补充）**：对"报不出 `change` 判别位"的 provider（现状 workbuddy/openclaw），兜底会把**无关写入**也判成 content ⇒ **假未读**。**openclaw 尤其严重**——它是**共享 SQLite**，watcher 会被**任何写入**（含别的会话、WAL checkpoint）触发；若不处理，S4 会把 openclaw 从"永不未读"直接翻转成「**永假未读**」，比原 bug 更打扰。**缓解**：对这类 provider **补精确值**（openclaw 的 `last_interaction_at` 现成、workbuddy 近零成本），一旦供出精确值即不再走兜底。⇒ **§8 Q5 因此从开放问题升格为 S4 同批必做。**
- 【我的判断】**在"零维护"与"精确性"之间取了正确的点**：把 per-provider 抽取从"必答题"降为"加分题"，但**对 SQLite 型 provider 必须同批补精确值**，否则兜底反噬。

### 对比表

| | 内容版本来源 | per-provider 成本 | 抗 touch | 新 provider 是否会自动生效 |
|---|---|---|---|---|
| S1 | 仅 Claude | 0 | ✅ | ❌（静默失效） |
| S2 | 各 provider 抽 | 近零—低，逐家补 | ✅ | ❌（需记得补） |
| S3 | 纯中心化 now() | 0 | ❌ | ✅ |
| **S4** | **COALESCE(精确值, 中心化兜底)** | **0 + 可选增量（SQLite 型必补）** | **部分（按 provider）** | **✅** |

### 替代方案（更激进，供评审者评估）

- **X｜不做"未读点"，改做"最后活动时间"展示**：展示每个会话的最后活动时刻 + 用户自身的"上次查看时刻"。**论证修正**：X 不是"没有判定就没有漏判"——"最后活动时间"**同样依赖内容版本抽取**，`touch` 假值与格式异构问题**原样存在**，差别只在**错误后果降级**（从"布尔判定错（漏判/假未读）"降为"显示时刻不准"，容错性好、判定压力小）。**这才是 X 值得评估的理由**；按"无判定"论证会被一句"活动时间从哪来"问倒。
- **Y｜把未读升级为"事件流 / 通知中心"**：服务端维护 `session_activity_events`，前端按游标读取"自上次以来的活动事件"。天然支持"3 条新消息"这种计数（即被砍掉的二期需求 C 的影子）。更重，但语义最强。

---

## 6. 我的建议

### 6.1 内容版本：S4 混合兜底（服务端）

【建议】`content_updated_at` 的维护改为：

```
content_updated_at = COALESCE( 本次 provider 提供的精确内容时间戳,  │ 有精确值就用（claude/openclaw/…）
                                CASE WHEN 本次是 content 事件 THEN 事件时刻 ELSE 保持原值 END )
```

- 中心化部分所需的信息（"本次是不是 content 事件"）**就是信号 1，已经在手**（`change` 判别位），无需新机制。
- 提供精确值的 provider 保持抗 touch；供不出的 provider **零改动即生效**。
- **前提**：对 SQLite 型 provider 同批补精确值（§5 S4 风险），否则兜底反噬。

### 6.2 判定下沉：服务端投影直接给 `isUnread`

【建议】把 `useProjectsState.ts:642 applyPersistedUnread` 那 20 行判定逻辑，搬到服务端投影：

- `GET /api/projects` 的每个 session 直接带一个 `isUnread: boolean`，由服务端 `${content_updated_at} > ${last_seen_at}` 算出。
- 前端**删除重建逻辑**（来源 ②），只读布尔。
- **来源 ①（WS 实时）与 ③（权限）仍留前端**——它们是实时事件，必须在客户端消费。

> 收益：前端不再持有"判定真相"；多端天然一致；删除会话时水位随之清理（外键/显式）。

**⚠️ 本节有四个落地前置（审阅补充，缺一不可）：**

- **前置 A｜用户身份穿链**：投影入口 `getProjectsWithSessions(options)`（`projects-with-sessions-fetch.service.ts:193`）**当前没有 userId**，`SessionSummary` 也无用户维度；而 `session_read_state` 是 **per-user** 表（`schema.ts:293`，FK `users.id`）。要算 `isUnread` 必须把请求者 `userId` 穿进投影函数（涉及路由→service 参数链，可能还有缓存键）。**验收**：T3 增集成测——**同一会话、两个用户的 `isUnread` 不同**。
- **前置 B｜清除规则与三来源合并优先级必须先拍板**：现有 `applyPersistedUnread` 有明确不变量——**只 raise、从不清**（`useProjectsState.ts:645-665` 从不 `delete`，注释 `:636-638`："never clears one, so it cannot fight the other channels"）。下沉后若 `isUnread` 变成双向镜像（`false` 即清除），冲突**不是时序竞态**（**第二轮审阅更正**：项目列表刷新是**事件驱动**的——`refreshProjectsSilently` 只在 `websocket_reconnected` / 重命名 / SW 通知 / 命令面板触发，**无周期轮询**；`useChatComposerState.ts:1041` 的 5s 定时器只 reconcile VPS 排队卡片 `queuedDraft`，**从不拉 `GET /api/projects`**；且写库先于广播，兜底值在事件到达时已在库），而是**语义不一致**：**§2.5 边界 1（无水位 ⇒ 服务端 `isUnread` 恒 false）× 来源 ①（WS 不查水位、对用户从未打开过的会话照样设 notice）**——用户从没点开的会话来了消息，来源 ① 亮蓝点；而镜像语义下**任何一次全量投影**（挂载 / 切项目 / 重连 / 重命名）都会算出 `false` 把它灭掉。⇒ **必须先定义 clear 规则 + 三来源合并优先级**，T4 才有可测的验收标准。**（待拍板，见 §8 Q9）**
- **前置 C｜写路径是否迁移要明确**：本节只下沉了"读/判定"，**水位的"写"仍在前端**（§2.4）。两个后果：① `markSessionSeen(sid, null)` 的早退要到 S4 覆盖该 provider 后才解除，未覆盖的 provider **水位永远写不进**（原 bug 换个位置存活）；② 前端写的是"列表快照"，若兜底 `now()` **晚于**用户离开时刻落库，会写入**偏旧**水位 ⇒ 升级后假未读。⇒ 需明确"写不迁移"是**决策**还是**遗漏**。**（待拍板，见 §8 Q9）**
- **前置 D｜增量事件的形状缺 `isUnread`（决定性，第二轮审阅补充）**：项目列表**主要靠增量 `session_upserted` 维护**（`useProjectsState.ts:901-913`："maintained purely by incremental `session_upserted` deltas"），而该载荷由 `buildSessionUpsertedEvent` **单独构造**（`session-upsert-broadcast.service.ts:25-71`，注释 "One builder, one shape"），**只带 `contentUpdatedAt`（`:57`）、不带 `isUnread`**；且 `sendToConnectedClients` **向所有连接群发、无 user 隔离**（`:73-85`）——而 `isUnread` 依赖 per-user 水位（正是前置 A 的维度）。⇒ 下沉后**增量行拿不到服务端布尔**，三选一，且**直接决定 §6.5 的"冗余面"**：**(a)** 给事件载荷附 `isUnread`（需把 userId 传给 `buildSessionUpsertedEvent`；对本地单用户工具，"广播带 per-user 字段"破坏 user-agnostic 是**理论性**冲突）⇒ §6.5 可真正"删薄层、冗余面=0"；**(b)** 前端对增量行**继续用 `isSessionUnread` 判定**（载荷已带 `contentUpdatedAt`，可据内存水位 Map 算）⇒ §6.5 的"冗余面 = 一个函数"**不成立**，那个函数是**增量路径的成员**、非可整体删除的独立层；**(c)** 增量行不参与重建、全靠来源 ① raise ⇒ 绕回前置 B 的 clear 规则。**（待拍板，见 §8 Q9/Q10）**

**此外：保留现有的水位全量 `hydrateSessionReadState`，不要因为"下沉"就删掉**——`isUnread` 由投影给出能保证落地/多端一致，但来源 ①（WS 实时）仍在前端，且**离线刷新时本地 Map 是唯一兜底**（`sessionReadState.ts:103` 注释"offline load must still show the flags"）。即"**投影给权威结论 + hydrate 作离线降级与来源 ① 的输入，二者并存**"。

**与用户提案的关系**：用户提的"下沉服务端"正是本节——**我完全采纳**。我的两点增量是 6.1（兜底，否则下沉了也没值可比）与 6.3（统一表示）。

### 6.3 统一「内容版本」的表示与比较（**S4 落地前置**）

【建议】约定 `content_updated_at` 的**唯一落库格式（ISO 8601 UTC）**，并提供一个**共享归一化函数**（吃 ISO 字符串 / 毫秒数字 / 秒数字，产出 ISO）。

**为什么这是前置、而非优化**：实测 `new Date("1791531485193")` = `Invalid Date`，`normalizeTimestamp` 对裸毫秒返回 `null`（§4 细节 1）。兜底值一旦以非 ISO 形态落库，读回即被归一化吞掉 ⇒ **S4 静默失效**。故 T1 必须锁死"兜底值落库后读回非空且为 ISO"。

### 6.4 我主动提出的更强替代：revision 游标（**请评审定夺**）

【建议·待定】把"内容版本"从**时间戳**换成**单调递增的整数 revision**：

- 机制：每个会话维护 `content_revision`（初始 0）；每当信号 1 = content，中心化 `+1`。
- 水位存 `last_seen_revision`；未读 = `content_revision > last_seen_revision`。
- **优点**：
  1. **彻底规避时间戳的漏判**（§4 细节 2 的同毫秒问题在整数下不存在）；
  2. **与信号 1 完美对齐**——"是不是新内容"已在手，`+1` 即可，**无需 provider 提供任何时间戳**；
  3. 与格式无关，天然统一。
- **代价/风险**：
  1. 需新增状态与一次迁移（历史行 revision=0）；
  2. 需**同时维护两列**（revision 与 `content_updated_at` **可双列共存**，并非"必须放弃"可读快照）：判定走 `content_revision > last_seen_revision`，展示/调试仍读 `content_updated_at`；
  3. 无 `change` 判别位的 provider 仍会把 touch 算 `+1`（与 S3 同代价）；
  4. 并发 `+1` 需保证原子（单进程写入则无虞）。

**我的倾向**：先落 S4（已实现基础、改动小）；**revision 作为中期可选升级**，等 §8 Q1/Q6 评审有共识再定。若评审认为"漏判/精度"不可接受，则直接上 revision。

### 6.5 与既有设计（需求 B）的关系：冗余范围、是否推翻、是否回退

【问题】下沉（§6.2）把"未读判定"从**前端**搬到**服务端**后，**需求 B 已落地的那套前端机制（水位 Map + `isSessionUnread` + `applyPersistedUnread`）是否变成冗余？原设计要不要推翻？已写的代码要不要回退？**

**先钉一个前提【事实】**：需求 B 的代码**全部尚未提交**——`src/shared/sessionReadState.ts`、`server/modules/database/repositories/session-read-state.db.ts` 为新增未跟踪文件；`useProjectsState.ts`、`sessions.db.ts` 等为已改未提交（`git status` 可核）。**⇒ 不存在"git revert"的对象**；下文所说"删/改"都是对工作区的编辑，不涉及任何回退历史操作。

**分层判定：需求 B 的产出在下沉后各有不同命运**（"替换一层"≠"推翻整段设计"）：

| 层 | 需求 B 的具体产出 | 下沉后 | 是否算"推翻/回退" |
|---|---|---|---|
| **数据层（真相）** | `session_read_state` 表 + FK 清理、`content_updated_at` 列、`GET/PUT/DELETE /read-state`、投影 `contentUpdatedAt`、切会话写水位时序 | **全部保留** | ❌ 不推翻——**它正是下沉的前提**（下沉要读的就是这两列） |
| **服务端投影** | `projects-with-sessions-fetch.service.ts` 的 `contentUpdatedAt` | **改造**：补 userId（前置 A）+ 增 `isUnread` | ❌ 改造，非回退 |
| **前端判定层** | `sessionReadState.ts:45 isSessionUnread` + `useProjectsState.ts:642 applyPersistedUnread`（来源 ②） | **下沉后成为冗余**：同一规则若服务端已算，前端再算一遍就是**两处实现**（会像信号 1/2 那样静默分叉） | ⚠️ **被替换的部分**——但**"冗余面 = 一个函数"是条件结论**：取决于**前置 D** 的解法。选 (b)（增量行保留前端判定）时该函数**仍是增量路径的成员、不可整体删**；只有选 (a)/(c) 才成立。删此薄层非回退 |
| **前端缓存/输入** | `hydrateSessionReadState` 水位 Map + `markSessionSeen` 写水位 + `AuthContext` hydrate/reset | **取决于 Q9 拍板**（见下） | 视拍板而定 |

**"冗余"的精确定义**：冗余**不是"需求 B 白做了"**，而是——**若下沉后不删前端判定，则同一条 `content > seen` 规则会同时活在服务端投影与前端 `sessionReadState.ts` 两处**。这才是真冗余（可静默分叉，违背"判定真相只应有一处"）。所以下沉**必须**把判定收敛到一处（服务端），前端只读结果。

**结论（我的裁定）**：**需求 B 不需推翻，也不需回退**——

1. 需求 B **做对了骨架**：它把"真相"（水位 + 内容版本 + 读写接口）**放到了服务端**。下沉只是把**最后一公里的比较**也搬过去，**复用需求 B 的全部数据层**（上表每一行"保留"都是需求 B 的产出）。二者是**同一设计的第一、二阶段**，不是对立方案。
2. 真正被替换的只有**前端那薄薄一层判定**（`isSessionUnread` + `applyPersistedUnread`）——但**冗余面大小是条件结论**（见上表 + **前置 D**）：选 (a)/(c) 可整体删该层（冗余面 = 0 或一个函数），选 (b) 则该函数被**增量 `session_upserted` 路径**继续需要、**冗余面 ≥ 一个函数**。无论如何都是**增量改造**，代价小；且因为未提交，**连 revert 都不必**——改工作区即可。
3. 反向而言：**若回退需求 B**（删表/删列/删接口），下沉就失去前提（没值可比、没水位可读），是**反方向的浪费**。回退是错的方向。

**悬空项（待 Q9 / Q10 拍板；任何收尾都不叫"回退"）**：

- **若 Q9 选"仅下沉读/判定、写仍在前端"**（现状口径 + C5 保留 hydrate）：`sessionReadState.ts` 保留 `hydrate` / `markSessionSeen` / `clearSessionReadState` 作**离线兜底与来源 ① 的输入**；而 `isSessionUnread` 判定路径**去留取决于前置 D**——选 (a)/(c) 可删（`applyPersistedUnread` 改读投影 / 事件载荷里的 `isUnread`），选 (b) 保留给增量行。冗余面 = **0～一个函数**。
- **若 Q9 选"写也迁服务端"**（服务端在**用户切走**时自己落水位；**锚点只能是"用户视角的离开"，不可用"Turn 结束"**——后者是助手产出完毕的时刻，推水位＝还没看就已读，见「决议清单·决定 2」）：前端水位 Map 的"真相"职责完全消失，`sessionReadState.ts` 可能整体退化为极薄一层乃至删除。冗余面 = **整个文件**。但这**依赖前置 B（clear 规则）先拍板**，不能先删。
- **前置 D 的解法独立影响上两条**：把 `isUnread` 并入 `session_upserted` 载荷（选 a）是让"删薄层、冗余面=0"成立的**唯一途径**；否则增量路径一定需要一个前端判定函数。

**执行纪律**：**T3/T4 未拍板前，不要动任何代码**。因为存在"**维持现状**"这条合法终态——此时需求 B 现状**就是**终态（唯一判定点在前端），**既无冗余、也无回退**；代价只是"前端持真相 + 未覆盖 provider 永不未读（本 bug 仍在）"。即：**"是否产生冗余"取决于是否执行下沉，而"是否执行下沉"取决于 Q9。**

> **一句话给评审者**：**下沉 = 需求 B 的第二阶段（复用全部数据层、只替换前端判定薄层），不是推翻，也不需要 git 回退。** 若你反对下沉，需求 B 原地即为终态，同样无需回退。

---

## 7. 实施切分与验证

| 步骤 | 内容 | 验证手段 |
|---|---|---|
| T1 | 服务端内容版本兜底（S4） | 单测：无指纹 provider 的 content 事件后 `content_updated_at` 非空；metadata 事件后不变；**并锁"兜底值落库后读回非空且为 ISO"**（§6.3 前置） |
| T2 | 归一化函数 + 落库格式统一（§6.3） | 单测：ISO / 毫秒 / 秒 三种输入 → 同一 ISO |
| T3 | 投影带 `isUnread`（服务端判定；含**前置 A 的 userId 穿链**）；**并按 D-a 让 `buildSessionUpsertedEvent` 一并附 `isUnread`（穿 userId）** | 集成测：`content_updated_at > last_seen_at` ⇔ `isUnread=true`；无水位 ⇒ false；**同一会话、两个用户 `isUnread` 不同**；**增量事件载荷的 `isUnread` 与投影一致** |
| T4 | 前端删除 `applyPersistedUnread`，改读 `isUnread`（clear 规则**已定为 B-1：只 raise、不清**；D-a 配套＝水位写入后同步失效相关行 `isUnread`）。**注**：T4 属 §6.5 所称"替换前端判定薄层"，**不是回退需求 B**——数据层（表/列/接口/投影）原样保留 | 前端测：刷新后蓝点为服务端算出的结论；来源 ①③ 仍工作；**B-1 断言**＝服务端 `isUnread=false` 不熄灭前端已有 notice；**D-a 配套断言**＝打开会话（写水位）后该行不"刚读完又亮" |
| T5（**无判别位 provider 必做**） | 给 openclaw（**共享 SQLite**：任一写入触发 watcher）/ workbuddy（**文件型**：`change=null` 时 `touch` 也算 content）补精确值 + 收窄 change 判定。**注**：标题不用"SQLite 型"统称——workbuddy 是文件型（§3 表），二者动因不同 | openclaw：`last_interaction_at` 变了才 content、并落 `content_updated_at`（单测）；workbuddy：**复用现成 `readEventTimestamp` + 补主线筛选**，与磁盘真相一致性测试 |

**实施状态（2026-10-11）：T1–T5 全部落地，双端 typecheck / build / 测试全绿。**

| 步骤 | 落点 | 覆盖测试 |
|---|---|---|
| T1 | `session-upsert-broadcast.service.ts stampFallbackContentTimestamp`（仅 `change='content'` 且列空时盖 `now()`） | `session-upsert-broadcast.test.ts`：content 盖值并落库读回、metadata 不盖、精确值不被覆盖 |
| T2 | `shared/utils.ts normalizeContentTimestamp`；`sessions.db.ts` 委托之，`createSession` 接受 `string\|number\|null` | `shared/tests/normalize-content-timestamp.test.ts`（ISO/毫秒/秒/数字串/SQLite UTC/空值） |
| T3 | `shared/session-unread.ts isSessionContentUnread`；投影 `mapSessionRowToSummary` 带 `isUnread`；`projects.routes.ts` 穿 `userId`；`buildSessionUpsertedEvent` 增量载荷附 `isUnread` | `projects-with-sessions-fetch.test.ts`、`session-upsert-broadcast.test.ts`（含"同会话两用户不同结论"） |
| T4 | `useProjectsState.ts applyPersistedUnread` 改读服务端 `isUnread` + 本地水位修正（B-1 只 raise 不清；D-a 写水位后同步失效该行） | `projectsStateAttention.test.ts`（服务端未读载入、陈旧服务端标志被本机读动作覆盖等） |
| T5 | openclaw / workbuddy 各补 `synchronizeFileDetailed`：比较 `last_interaction_at` / 最新主线消息时间戳，判"真新消息 vs 无关写入/touch" | `openclaw-session-synchronizer.test.ts`、`workbuddy-session-synchronizer.test.ts`（首索引/推进/裸 touch 三分支） |

**回归关注**：删除会话时水位清理；多端一致性；升级不得让历史会话满屏蓝点（revision/水位缺失 = 未读为 false 的边界要保留）。

---

## 8. 面向评审 AI 的开放问题【请优先回答】

> 本节是本文的重点。以下问题我都有倾向；**其中 Q9 / Q10 已于 2026-10-11 拍板（见文首决议清单：b + B-1 + C-1 + D-a），其余 Q1–Q8 仍开放**，欢迎给出替代方案或直接推翻 S4。

- **Q1｜版本量用时间戳还是 revision？** 时间戳方案（S4）改动小、已实现基础；revision（§6.4）更干净但需迁移。你对"同毫秒漏判"的实际风险评估是多少？是否值得为它换模型？（审阅补充：S4 的 `now()` 兜底会**放大**同毫秒概率，见 §4 细节 2 / §5 S4。）
- **Q2｜无指纹 provider 的兜底粒度？** 选项：① content 事件时盖 `now()`（假未读来自 touch/无关写入）；② 干脆不兜底、维持"永不未读"（本次 bug 不修）；③ 对**文件型** provider 用"内容哈希/长度"中心化判内容是否真变。**⚠️ 组合关系（审阅补充）**：③ **产不出时间值**，无法填进 `content_updated_at`，**与 S4 的 `COALESCE` 不兼容**；它天然的落点是 revision（哈希变 ⇒ `+1`）或纯布尔判定。**即 ③ 实际是 §6.4 revision 的论据，不是时间戳方案内的选项。**
- **Q3｜是否值得做 Y（事件流 / 通知中心）？** 对一个**本地单用户**工具，`session_activity_events` + 游标是否过度设计？它能否顺带复活被砍掉的"新消息计数"？
- **Q4｜水位怎么读？** 现状是全量 `hydrate` 一次（会话多时内存 Map 会大）。是否改为"随投影内联"（投影直接带 `isUnread`，前端不持有 watermarks）？**审阅补充：不要因此删掉全量 hydrate**——它仍是离线降级与来源 ① 的输入（§6.2）。即结论是"二者并存"，而非"下沉即删全量"。
- **Q5｜假未读的容忍度？（已升格为 S4 同批必做，见 §5 S4）** 对 openclaw（共享 SQLite，任何写入都可能触发 watcher）你能接受多少假未读？**须在 S4 同批为 SQLite 型 provider 收窄 change 判定（`last_interaction_at` 变了才算 content），或直接补精确值**，否则要正面回答"能接受多少次假未读"。
- **Q6｜要不要一步到位重构成游标模型？** 即：不再有 `content_updated_at`，只有 `content_revision` + `last_seen_revision`。（审阅补充：因可**双列共存**，此问实为"是否以 revision 为判据、时间戳降为展示"，代价比"二选一"更小。）
- **Q7｜逐 provider 可得性普查**：请评审者补充/核对 codex / opencode / zcode / dsh / pi / omp / cursor 各自"内容级时间戳"的现成字段与成本。
- **Q8｜有没有我们没考虑到的方案？** 尤其：是否存在**完全不需要 per-provider、也不需要 touch 假未读**的第三方设计（例如由 run-registry 侧统一在"助手产出一条消息"时打点，而不依赖文件系统）？
- **Q9｜（审阅新增·✅ 已拍板 2026-10-11 → **B-1 / C-1 / D-a**，见文首决议清单）下沉的决策点**：**前置 B｜clear 规则**——"只 raise 从不清"要不要改；**真正必现的冲突不是时序竞态，而是语义不一致**：§2.5 边界 1（无水位 ⇒ 服务端 `isUnread` 恒 false）× 来源 ①（WS 对**从未打开过**的会话照样 raise）——即"**用户从没点开的会话来了消息，蓝点该不该在下次全量投影时被灭掉？**"（请直接给出规则）；**前置 C｜水位写路径**是否迁移到服务端（不迁移的两个后果见 §6.2）；**前置 D｜增量事件要不要带 `isUnread`**（见 §6.2 前置 D，三选一决定 §6.5 的冗余面）。三项都直接影响 T4 的验收标准。
- **Q10｜（新增·✅ 已拍板 2026-10-11 → **(b) 仅下沉读 / 判定**，见文首决议清单）下沉与原设计（需求 B）的关系**：三选一——**(a) 维持现状**（判定留在前端，需求 B 原地即为终态，无冗余、无回退）；**(b) 仅下沉读/判定**（保 hydrate；前端判定薄层的冗余面**取决于前置 D**：选"载荷带 `isUnread`"则 ≈0，否则 ≥ 一个函数）；**(c) 读写都下沉**（前端水位 Map 整体可退，冗余面 = 整个 `sessionReadState.ts`）。请评审者确认 §6.5 的裁定："需求 B 不推翻、不回退，下沉是第二阶段"是否成立；若主张回退需求 B，请说明如何在没有水位表/内容版本列的前提下实现任何未读方案。

> **给评审者的邀请**：§5 的 X/Y 与 §6.4 都欢迎被更有力的方案取代。若能给出"既零 per-provider 维护、又抗 touch、又不多端分裂"的设计，请直接提出。

---

## 9. 附录

### 9.1 当前数据流的时序（**改造前**——本 bug 的现状）

```
[用户发消息]
  → provider CLI 写磁盘（jsonl / sqlite）
  → watcher 发现变化 → synchronizer 索引 → 写 sessions.content_updated_at（仅 Claude 有值）
  → session_upserted 广播（change: content|metadata）
[页面开着]
  → 前端收 WS：非当前会话且 change≠metadata ⇒ 设 notice（来源 ①，内存）
[切换会话]
  → 对离开/进入的会话 markSessionSeen ⇒ PUT /api/user/read-state（写水位）
[刷新]
  → hydrateSessionReadState ⇒ GET 水位全量
  → applyPersistedUnread 遍历会话，isSessionUnread(contentUpdatedAt) ⇒ 设 notice（来源 ②）
     ↑ 无指纹时恒 false ⇒ 蓝点消失（本 bug）
```

**改造后（2026-10-11 已实施）**：

```
[用户发消息]
  → provider CLI 写磁盘
  → watcher → synchronizeFileDetailed 给出 contentChanged（提供商能判则判，判不出=synchronizeFile）
     → 写 sessions.content_updated_at（Claude/openclaw/workbuddy 供精确值；其余置 null）
  → 广播前：change='content' 且列空 ⇒ stampFallbackContentTimestamp 盖 now()（S4 兜底，落库读回为 ISO）
  → session_upserted 广播（载荷自带服务端算好的 isUnread）
[刷新 / 拉项目列表]
  → 服务端投影按 (content_updated_at, 该用户水位) 直接给每行 isUnread（no watermark ⇒ false）
  → 前端 applyPersistedUnread 直接采信该结论，仅叠加"本机刚读完"的本地修正（D-a）
[切换会话]  → markSessionSeen 写水位（PUT /api/user/read-state，与改造前一致）
```

### 9.2 相关文档与代码

- 一期设计：`docs/research/CloudCLI侧边栏状态指示重设计方案.md`
- 二期需求：`docs/research/CloudCLI侧边栏状态指示重设计-二期需求.md`（§3.6 的水位/指纹边界）
- 关键文件见 §2.6。

### 9.3 变更记录

| 日期 | 变更 |
|---|---|
| 2026-10-11 | 初稿：现状复盘 + S1–S4 方案空间 + 建议（S4 + 服务端判定）+ 开放问题 |
| 2026-10-11 | 吸收审阅批注（Claude 6 条 + mimo 6 条）：workbuddy 成本修正、§6.3 升为落地前置、S4 对 SQLite 型 provider 的风险与 Q5 升格、§6.2 三个前置、§6.4 双列、方案 X 论证修正、Q2 ③ 归 revision；新增 §8 Q9 与「审阅批注处置」 |
| 2026-10-11 | 新增 §6.5「与既有设计（需求 B）的关系：冗余范围、是否推翻、是否回退」+ §8 Q10；结论＝下沉是需求 B 的第二阶段（复用数据层、替换前端判定薄层），不推翻、不回退，且代码未提交故无 revert 对象 |
| 2026-10-11 | 吸收第二轮审阅（mimo + Claude，6 条全成立）：更正 §6.2 前置 B 的"5s 竞态"载体（真冲突＝**边界 1 × 来源 ① 语义不一致**）；新增**前置 D**（增量载荷无 `isUnread`）并据此把 §6.5「冗余面 = 一个函数」标注为**条件结论**；T5 标题改「无判别位 provider 必做」；处置表拆为两轮 |
| 2026-10-11 | 文档开头新增「**决议清单（需拍板·先读这里）**」：总闸 Q10（维持现状 / 仅下沉读 / 读写都下沉）+ 三项决定（前置 B clear 规则 / 前置 C 写路径 / 前置 D 增量载荷），每项列**选项 / 后果 / 我的推荐**，并给出三项联动与对 T3/T4 的影响 |
| 2026-10-11 | 全文校对：修正 4 处行号漂移（`useProjectsState.ts:1035→1039`、`:1172→1178`、`sessionReadState.ts:105→103`、`openclaw-...provider.ts:228→249`）与 2 处内部不一致（front-matter 一轮→三轮、§0 三个→四个前置）；吸收**第三轮批注 9 条**（Claude 5 + mimo 4，8 采纳 / 1 驳回 R8）：B-1 改写 + 驻留代价、后果①改判为"历史行残余"、C-2 删"Turn 结束"、D-a 补陈旧性约束、新增「默认实现配方 + 收益边界」 |
| 2026-10-11 | **方案定案**：用户拍板采纳默认配方 **b + B-1 + C-1 + D-a**。更新 front-matter 状态、决议清单（各项标 ✅ 已拍板）、§8 Q9/Q10 标记为已决议；§7 T3 补 D-a（增量载荷穿 userId 附 `isUnread`），T4 补 B-1 / D-a 配套断言 |
| 2026-10-11 | **实施落地**：T1–T5 全部完成。新增 `shared/session-unread.ts`、`normalizeContentTimestamp`、`sessions.db.backfillContentUpdatedAt`；投影与增量载荷带 `isUnread`；front-end `applyPersistedUnread` 改读服务端结论；openclaw / workbuddy 各补 `synchronizeFileDetailed`。同步：§2.6 行号按实施后校准 + 补兜底/归一化落点、§7 补实施状态表、front-matter 状态改为已实施。**验证**：双端 typecheck / build 通过；前端 188 文件 / 1555 测试全绿（Node 20）；服务端全量 1346 测试，红集与干净树**逐名一致**（10 项均为环境依赖既有红，本次净增 47 测试全通过） |

---

## 审阅批注

### Claude

> [!NOTE] 结论一致：方向（S4 混合兜底 + 6.2 判定下沉 + 6.3 统一表示）我总体认可，先落 S4、revision 作为中期升级是对的顺序。以下是需在落地前补齐的缺口与一处事实纠偏。

> [!TIP] §4 细节1 的 workbuddy 表述已过时：该 provider 抽取层已自带 `readEventTimestamp`，同时处理「ISO 字符串」与「毫秒数字」并统一输出 ISO（`workbuddy-sessions.provider.ts:228-232`，`typeof event.timestamp === 'number'` 分支走 `new Date(timestamp).toISOString()`）。也就是说『workbuddy 必须先归一化格式才能复用』这一说法被现成代码否定了——S2 对 workbuddy 的成本实际是『已在做』。建议把 T5 里 workbuddy 一栏从『补精确值』改成『复用现成抽取并核对一致性』，成本归零。

> [!IMPORTANT] §6.3『统一落库格式 + 共享归一化』不是锦上添花，而是 S4 的**落地前置**：`normalizeTimestamp` 只吃字符串，对裸毫秒数字执行 `new Date("1791531485193")` 会得 Invalid Date → 返回 null（`sessions.db.ts:40-56`）。这意味着『兜底 now()』一旦以某种非 ISO 中间形态落库，读回时会被归一化吞掉、`content_updated_at` 变回 null，S4 等于没生效。建议在 T1 里显式加一条『兜底值落库后读回非空且为 ISO』的单测，锁死这一环。

> [!WARNING] S4 用 now() 兜底后，『同毫秒漏判』的实际风险不减反增：content_updated_at 与水位 last_seen_at 会来自同一批 watcher 事件里的同一个时钟，二者同时戳到同一毫秒的概率比『provider 各自看盘』更高；再叠加 §4 细节2 已实测到的严格 `>` 同毫秒漏判，这更支持 §6.4 revision 游标。若评审认定精度不可妥协，建议把『收窄 change 判定』与『revision』打包评估，而不只看时间戳本身。

> [!CAUTION] S4 会把 openclaw（共享 SQLite）从『永不未读』翻转到『永假未读』：文档 §3 信号1 承认 workbuddy/openclaw 的 change 判别位常为 null → 保守算 content，而 §1.3 又说明这些 provider 的 watcher 会被**任何无关写入**触发。于是每有一次触碰，S4 就盖一次现在的值 → 假未读，且这次是**全局普遍**的假未读，比原 bug 更打扰。建议 S4 落地同批为 SQLite 型 provider 收窄 change 判定（`last_interaction_at` 变了才 content），即把 §8 Q5 从开放问题提前为 S4 的必做项，否则要正面回答『能接受多少次假未读』。

> [!NOTE] 对 §8 Q4：判定下沉后**不要删掉现有的水位全量 hydrate**。`isUnread` 由服务端投影给出能保证落地/多端一致，但水源①（WS 实时）仍在前端，而离线刷新时 `hydrateSessionReadState` 的本地 Map 是唯一兜底（`sessionReadState.ts:105` 的注释『offline load must still show the flags』）。建议就是你说的『二者并存』：投影给权威结论，hydrate 保留作离线降级与来源①的输入，别让『下沉』变成『删全量』。

### mimo ·

> [!CAUTION] §6.2『前端删除重建逻辑，只读布尔』遗漏了**清除语义**，这是 T4 的验收空洞。现有 `applyPersistedUnread` 有明确不变量：**只 raise、从不清**（`useProjectsState.ts:636-638` 注释『never clears one, so it cannot fight the other channels』）。下沉后若 `isUnread` 改为双向镜像（false 即清除），5s 的 `refreshProjectsSilently` 轮询会在「watcher 兜底尚未写入 `content_updated_at`」的竞态窗口里把 WS 刚设的 notice 清掉——来源①被来源②反向覆盖；同时来源③ action 的清除规则（`:618-625` 只清本通道标的）也需重新对齐。若为避冲突继续『只 raise』，则 §6.2 宣称的『多端天然一致』收益（在设备 A 已读、设备 B 自动熄灭）拿不到。**文档必须先拍板 clear 规则与三来源合并优先级，T4 才有可测的验收标准**，否则『只读布尔』是一句没定义完的话。

> [!IMPORTANT] §6.2 下沉有一个未写出的前置：**投影链路当前没有用户身份**。`projects-with-sessions-fetch.service.ts` 的入口签名只有 `projectPath`/`options`（`:61-65`），`SessionSummary` 无用户维度；而 `session_read_state` 是 per-user 表（`schema.ts:293`，FK users.id）。要算 `isUnread` 必须把请求者 userId 穿进投影函数（涉及路由→service 的参数链与可能的缓存键）。建议 T3 增补一条集成测：**同一会话、两个用户的 `isUnread` 不同**，锁死这个易漏的维度。

> [!WARNING] §6.2 只下沉了「读/判定」，**水位的「写」路径原样留在前端**（§2.4：切换会话时 PUT 离开会话的 `contentUpdatedAt` 快照），但全文未讨论这一半：① `markSessionSeen(sid, null)` 的早退在 S4 生效后才解除，S4 未覆盖的 provider 水位**永远写不进**，其未读在判定下沉后依旧恒 false（原 bug 换个位置存活）；② 前端写入的是「列表快照」，若 watcher 的 `now()` 兜底晚于用户离开时刻落库，会写入偏旧水位 → 升级后的会话出现假未读。§8 Q4 只问『怎么读』。建议明确：**写不迁移是决策还是遗漏**，并给 S4 兜底值一个「不早于已写水位」的约束或排序保证。

> [!TIP] §6.4 代价 2『放弃 `content_updated_at` 的可读快照价值』是**假两难**：revision 与时间戳可双列共存——判定走 `content_revision > last_seen_revision`（抗同毫秒），展示/调试仍读 `content_updated_at`。这会削弱 revision 方案的代价项，直接影响 Q1/Q6 的权衡结论，建议改写为「需同时维护两列」而非「放弃」。

> [!TIP] §8 Q2 选项 ③（内容哈希/长度）与 S4 的 `COALESCE` **不兼容**：哈希只能回答『变没变』，产不出时间值，无法填进 `content_updated_at`。它天然的落点是 revision（哈希变 ⇒ `+1`）或纯布尔判定。建议在 Q2 里标注这一组合关系——③ 实际是 revision 的论据，不是时间戳方案内的选项。

> [!NOTE] §5 方案 X 的论证需修正：『最后活动时间展示』同样依赖内容版本抽取，`touch` 假值与格式异构问题**原样存在**，差别只在错误后果从「布尔判定错（漏判/假未读）」降级为「显示时刻不准」。这才是对 X 更准确的支持理由（容错性好、判定压力小），而非文中的『没有判定就没有漏判』——按现表述，评审者一追问『活动时间从哪来』X 就站不住了。

### mimo · 第二轮（针对补充后的 §6.2 前置 B / §6.5 / 处置表）

> [!CAUTION] **前置 B 与处置表 M1 的竞态载体引用是错的，按它拍 Q9 会拍偏**：`useChatComposerState.ts:1041` 的 5s `setInterval` 只 reconcile **VPS 排队卡片 `queuedDraft`**（`:1029-1046`，`hydrateChatDrafts` + `readQueuedMessage`），**从不拉取 `GET /api/projects`**；而项目列表**根本没有周期性投影轮询**——全量刷新是事件驱动的（`websocket_reconnected` → `refreshProjectsSilently`，`useProjectsState.ts:911-913`；SW 通知；命令面板）。更进一步：按本文 §9.1 自己的时序「synchronizer 写库 → 广播 `session_upserted`」，**写库先于广播**，『兜底值尚未写入』的竞态窗口在 WS 路径上基本不存在。**真正必现的冲突不是竞态，而是语义不一致**：**边界 1（无水位 ⇒ 服务端 `isUnread` 恒 false）× 来源①（WS 不查水位，对用户从未打开过的会话照样设 notice）**——用户从没点开的会话来了消息，来源①亮蓝点，而镜像语义下任何一次全量投影都会算出 false 把它灭掉。**Q9 的 clear 规则必须正面解这个场景**，而『5s reconcile 竞态』这个例子应删除或替换。处置表 M1 核实栏『成立（`useChatComposerState.ts:1041` 的 5s reconcile）』属**核实失实**，『12 条全部核实为成立』至少此条不成立。

> [!IMPORTANT] 下沉还有一个**未列入前置的形状缺口（建议补为前置 D）**：项目列表主要由 `session_upserted` **增量维护**（`useProjectsState.ts:901-913`：『maintained purely by incremental `session_upserted` deltas』），而该载荷由 `buildSessionUpsertedEvent` **单独构造**（`session-upsert-broadcast.service.ts:52-59`，注释明言『One builder, one shape』），**不含 `isUnread`**；且广播是 **user-agnostic** 的（`:73-85` 向所有连接群发，而 `isUnread` 依赖 per-user 水位——正是前置 A 强调的维度）。⇒ 下沉后增量行拿不到服务端布尔，三选一：**(a)** 事件载荷也带 `isUnread` ⇒ 广播里混入 per-user 字段，本地单用户勉强跑、模型上与前置 A 冲突；**(b)** 前端对增量行**继续用 `isSessionUnread` 计算** ⇒ §6.5『删掉前端判定薄层、冗余面 = 一个函数』**不成立**（那个函数正是增量路径需要的）；**(c)** 增量行不参与重建、全靠来源① raise ⇒ 又绕回前置 B 的 clear 规则。**T4 与 Q10 (b) 的结论都依赖这条的解法**，请补进 §6.2 前置列表与 §6.5 表格。

> [!NOTE] §6.5 的 git 前提**核实为真**：`src/shared/sessionReadState.ts`、`server/modules/database/repositories/session-read-state.db.ts` 确为 `??` 未跟踪，`useProjectsState.ts`/`sessions.db.ts` 等确为 `M` 已改未提交——『无 revert 对象』成立；『下沉 = 需求 B 第二阶段、不推翻不回退』的裁定方向我认可。但『冗余面 = 一个函数』是**条件结论**：只有上一条选 (a) 或 (c) 时才成立，选 (b) 则前端判定薄层必须保留（或改为「事件载荷携带」+ 接受广播带 user 维度），§6.5 应标注这一条件。

> [!TIP] T5 标题『**SQLite 型必做**』却包含 workbuddy——它是**一会话一 `.jsonl` 的文件型** provider（§3 表），补精确值的动因是『change 判别位为 null → 兜底把无关写入算 content』（文件型 `touch` 同样触发），**不是**共享 SQLite 的问题。建议标题改中性（如『无判别位 provider 必做』）或把 openclaw / workbuddy 拆成两行动因，避免读者以为 workbuddy 也受『共享库』之累。

---

### Claude · 第二轮（针对补充后的 §6.2 前置、§6.5、处置表；已实测核对）

> [!IMPORTANT] **交接版本断裂：处置表只覆盖第一轮，两轮新增批注都未回填。** 我读到的「审阅批注处置」表只含 C1–C6 + M1–M6（12 条），而 mimmo 第二轮（M1 核实失实、前置 D、T5 标题）与本轮批注都不在其中。表尾「12 条全部核实为成立并采纳」是**第一轮快照**，却被写成终态措辞。若牵头 harness 仅按处置表汇总，前置 D 与 M1 载体修正会整体漏掉。建议处置表分割为「第一轮（12/12）+ 第二轮待裁定」两段，并标注每轮对应日期。

> [!CAUTION] **处置表 M1 行的核实载体失实，且与其自述「12 条全部核实为成立」冲突，按它拍 Q9 会拍偏。** 我实测：① `useProjectsState.ts` 与 `server/modules/projects` **均无 `setInterval` 周期轮询**——项目全量刷新是事件驱动的（`websocket_reconnected → refreshProjectsSilently`，`useProjectsState.ts:911`）；② `useChatComposerState.ts:1041` 的 5s reconcile **只 reconcile VPS 排队卡片 `queuedDraft`**（`hydrateChatDrafts`+`readQueuedMessage`），从不拉 `GET /api/projects`。故原 M1「5s reconcile 会在兜底未写入窗口清掉 WS 的 notice」的载体不成立。但其本质（clear 语义缺口）仍成立，**真正必现的冲突是 §2.5 边界1（无水位⇒服务端 false）× 来源①（WS 不查水位照样 raise）的语义不一致**，而非时序竞态。请按 mimmo 的修正重写 M1 的核实栏，再据此拍 Q9。

> [!WARNING] **前置 D 是决定 §6.5 与 Q10(b) 的三方困局，且留白在 Q9 之外——把它补进待裁定清单。** 实测广播载荷只有 `contentUpdatedAt`、**无 `isUnread`**（`session-upsert-broadcast.service.ts:57`），且 `sendToConnectedClients` 向**所有连接群发**、无 user 隔离（`:73-85`）；而项目列表由增量 `session_upserted` 维护（`useProjectsState.ts:901` 注释「maintained purely by incremental deltas」）。增量行因此拿不到服务端布尔，三选一直接决定「冗余面 = 一个函数」真假。既然载荷已带 `contentUpdatedAt`、且前置 A 本来就要把 userId 穿进投影链，**建议把同一 userId 传给 `buildSessionUpsertedEvent` 附一个 `isUnread` 字段**——对**本地单用户**工具，「广播带 per-user 字段」破坏 user-agnostic 的模型冲突是理论性的（默认就一个用户）。这才是让 §6.5「删除前端判定薄层、冗余面=0」真正成立的解，否则 (b)（增量行保留前端判定）会把它打回「冗余面≥一个函数」。

> [!NOTE] 同意 mimmo 的定性主贡献（冲突是语义不一致、非时序竞态），并补一处使它更完备的实测事实：广播载荷**已带 `contentUpdatedAt`**（`session-upsert-broadcast.service.ts:57`），故即便服务端不给增量行 isUnread，前端也可据内存水位 Map 对增量行继续 `isSessionUnread` 判定——这正是 Q10(b)/§6.5「冗余面 = 一个函数」的**条件前提**：那个函数是增量路径的成员函数，不是可整体删除的独立层。若选择不把 userId 进广播（保留 user-agnostic），则前端判定薄层必须保留给增量路径，Q10(b) 与 §6.5 表格应同步把「删除判定路径」改述为「限定在服务端投影结论触达的路径」。此前我在第一轮批注里按 Q4 建议「别删 hydrate、二者并存」——与这里一致：hydrate 提供的水位 Map 正是增量行判定的数据源，删了它增量路径就断了。

> [!TIP] T5 标题中性化（mimmo）成立，我实测补充两行动因以撑住拆分：openclaw 动因是**共享 SQLite 库**（任一写入触发 watcher，改判 `last_interaction_at` 变了才 content）；workbuddy 动因是**文件型、change 判别位为 null 时 touch 也算 content**。二者诉求都指向「无判别位 provider 需精确值与收窄判定」，但绝不是一个「SQLite 型」统称能概括——按 §3 表 workbuddy 是文件型，照现标题会误导读者。

### Claude · 第三轮（针对整理后的决议清单；已实测核对）

> [!TIP] **决定 1（B-1）推荐段的论证是自相矛盾的，建议删掉那段自我抵消的"例外"包装。** 原文「给来源①的无水位 raise 补一条例外——来源②对无水位会话放弃否决权（不主动清）……也不把从没打开过的会话点成无法熄灭的灯」——这里三层都不成立：① B-1 的定义就是"来源②永不主动清"（只 raise 从不清，`applyPersistedUnread：645-665`，`previous.get` 拒绝降级），"放弃否决权"在 B-1 下**无需例外**、本来就是；② 来源①（WS 增量）**从不查水位照样 raise**（`:1039`），"给无水位 raise 补例外"无从补起，它已经在 raise；③ "无法熄灭的灯"不实——**打开会话即清除**（`handleSessionSelect` `:1335`、切会话 `:1182` 均 `clearSessionAttention`），灯是可熄灭的，只是"只能靠打开熄灭"。建议把该段直接改写为一句朴素的判定:」**B-1 = 无水位会话来了消息 → 蓝点上升并保持，直到用户打开**」，这正是 B-1 要接受的行为，不要再用"例外/不主动清"去把它说成有别的东西。

> [!NOTE] **决定 2（C-1）的后果①被 S4 自发消解，应标注或删除，否则决策面双计。** 原文后果①「未覆盖 provider 的 `markSessionSeen(sid, null)` 早退不解除 ⇒ 水位永远写不进」——但按 §6.1 的 S4，`content_updated_at = COALESCE(精确值, content 事件⇒now())`，S4 落地后**不再有"未覆盖 provider"**（都有兜底值），`markSessionSeen` 收到的不再是 null、不会早退，水位能写进。真正残留的风险只有后果②（兜底 `now()` 晚于离开时刻 ⇒ 写偏旧水位 ⇒ 假未读）。若保留①，会 push 读者重复为"已经被 S4 解决的问题"去投 C-2。

> [!IMPORTANT] **推荐三元组（总闸 b + B-1 + C-1 + D-a）有一处收益边界没写清，多数读者会误读为三满。** 组合里 **B-1 明确否掉了"多端自动熄灭"**（决定 1 表格的 ❌ 已列），因此本组合的实际价值 = **① 修复"刷新即丢未读"**（来源②持久化由服务端重算）+ **② 判定真相收敛到服务端**；而 **"多端一致/设备 B 自动熄灭"这个 §6.2 声称的下沉卖点，在与 D-a 搭配时依然是拿不到的**——因为 B-1 下服务端 `isUnread=false` 永不驱动清除。若团队真正把"多端熄灭"当硬需求，唯一路径是 B-2（双向镜像）+ 为"无水位≠已读"定第三态。建议在「三项如何联动」末尾加一行"推荐组合的收益边界 = 刷新持久化，而非多端熄灭"，避免实施时以为 (b) 一步到位全收敛。

> [!NOTE] **决议清单决策面（1 总闸 × 3 决定 × 各分支）对一个本地单用户工具偏重，建议把推荐组合固化成一个默认实现配方。** 现状清单每一项都列了多个平权选项，容易让人反复横跳。既然文档倾向明确（总闸 b + 决定 1 B-1 + 决定 2 C-1 + 决定 3 D-a），建议在清单末尾用一行"**默认实现配方 = b + B-1 + C-1 + D-a**"收口，并标注"其余选项计入下一阶段或不纳入本轮"，让 T3/T4 的验收直接挂在配方上，而不是挂在一个仍需逐项拍的清单上。

### mimo · 第三轮（针对决议清单与 Claude 第三轮批注；已实测核对）

> [!CAUTION] **决定 3 推荐的 D-a 有一个必现缺陷没写进选项表：行字段的陈旧性会在本端制造"刚读完又亮"的假未读。** 走查：① 新消息到达 → 服务端算 `isUnread=true` → 广播载荷/投影把 `isUnread=true` **固化进前端的行对象**；② 用户打开会话 → `clearSessionAttention`（`:1335`）清内存灯 + `markSessionSeen` 更新水位（`:1178`）；③ 水位 `notify()` **触发 `applyPersistedUnread` 重跑**（订阅在 `:674`）——此时若重建改为**读行字段**（快照仍 `true`，B-1 下服务端 false 又永不驱动清除，投影也未必刷新），蓝点**在用户刚读完后再次亮起**。现状之所以没这个问题，是因为重建是**实时比较水位 Map**（`sessionReadState.ts:58-64`），不是读快照。⇒ D-a 必须在选项表里补一条配套约束：**"水位写入后，前端同步使所有行的 `isUnread` 字段失效（或置 false）"**，否则 D-a 的冗余面=0 是靠引入新的假未读换来的。另注：D-a 在 B-1 下同样拿不到"多端熄灭"（行字段只在广播/投影时刷新），与 Claude 第三轮 IMPORTANT 的收益边界结论一致。

> [!WARNING] **Claude 第三轮「决定 2 后果①被 S4 自发消解，应删除」过强——S4 不回填历史行，该后果降级而非消失。** §1.2 明确实测「历史行也没有回填」（37 条 `content_updated_at` 全 NULL），§7 也无回填步骤。走查：升级时已存在的会话首次「打开→离开」时 `contentUpdatedAt` 仍为 null ⇒ `markSessionSeen` 依旧早退、**水位写不进**；随后新消息由 S4 盖上兜底值，但**无水位 ⇒ 边界 1 ⇒ 重建不亮**，直到用户**第二次**打开它写入水位才恢复正常。⇒ C-1 后果①应改写为「**历史行一次性残余**：首次打开-离开仍写不进，第二次才正常；新会话由 S4 自动消解」，而不是整条删除。否则按 Claude 的建议删掉①，历史行的这个半修复状态会在实施时无人认领。

> [!TIP] **决定 2 的 C-2 把「Turn 结束时自落水位」列为判定点候选，这会直接摧毁未读语义，建议删掉或加警示。** 「Turn 结束」= 助手产出完毕的时刻——若此时把水位推到最新 `content_updated_at`，等于**用户还没看就已读**，漏报未读；未读的语义锚点只能是「**用户视角的离开**」（当前前端切会话时刻的等价物）。C-2 真正要解的难题文档已列（"服务端怎么知道用户切走了"），但把 Turn 结束与"切会话"并列会误导实现。§6.5 悬空项里同一表述（"切会话/Turn 结束时自己落水位"）也应同步处理。

> [!NOTE] **Claude 第三轮对决定 1 的批评（B-1 推荐段自我抵消）核实为真，但补一个它没说的收尾。** `clearSessionAttention` 在 `:1335`（打开）/ `:1182`（切换）确实在，"灯只能靠打开熄灭"成立，"放弃否决权"在 B-1 定义下确实是废话——Claude 的改写方向（"B-1 = 无水位会话来了消息 → 亮并保持，直到用户打开"）是对的。补充：这句话同时暴露 B-1 的一个**产品后果**——对"用户永不打开"的会话（如被忽略的旧项目），蓝点**永久驻留**，且来源 ③ 的权限灯也有同样驻留问题；若这不可接受，B-1 需要再配一条"驻留上限"（如仅最近 N 天会话显示未读），这是拍板 B-1 时应看到的完整代价。

> [!TIP] **文档头部状态行未随整理更新，与 R5 指出的"版本断裂"同类。** `:4` 仍写「已吸收一轮审阅（Claude 6 条 + mimo 6 条，见文末）」，而实际已有两轮处置表 + Claude 三轮批注 + 本节。建议改为「已吸收两轮审阅、共 X 条（见文末处置表）」，否则读者按头部计数会对处置覆盖度误判——这正是 R5 要防的问题在入口处复发。

---

## 审阅批注处置

【我的裁定】**第一轮 12 条全部核实为成立并采纳**（两处按核实结果微调）；**第二轮 6 条（见下）同样全部成立、已回写**。核实手段：逐条对照源码 / 实测 JS 行为。**⚠️ 版本提示**：本表第一轮当时把 M1 的核实载体写错（"5s reconcile 竞态"），已在第二轮 R1 更正——**勿再按第一轮的措辞引用**。

| # | 批注 | 核实 | 裁定 | 已落到的位置 |
|---|---|---|---|---|
| C1 | §4 workbuddy 表述过时（抽取层已自带归一化） | 实测 `readEventTimestamp` 存在（处理 string/number） | **采纳·微调**：归一化能力现成；但"取主线最新"仍需实现（该函数服务于消息归一化，不做主线筛选） | §4 表 + T5 |
| C2 | §6.3 是落地前置（`normalizeTimestamp` 会吞非 ISO） | 实测 `new Date("1791531485193")` = Invalid Date | **采纳** | §4 细节1、§6.3 标题、T1 |
| C3 | S4 兜底加剧同毫秒漏判 | 逻辑成立 | **采纳·限定**：仅对**被兜底**的 provider（供得出精确值者不受影响） | §4 细节2、§5 S4、Q1 |
| C4 | S4 使 openclaw 翻转为"永假未读" | 成立（共享 SQLite + change=null→content） | **采纳** | §5 S4 风险、§8 Q5 升格、T5 标"必做" |
| C5 | Q4 不要删 hydrate | 成立（`:105` 离线兜底） | **采纳** | §6.2 末段、Q4 |
| M1 | §6.2 遗漏清除语义（只 raise 从不清） | **本质成立**（`:645-665` 只 raise、`:618-625` 只清本通道）；**但"5s reconcile 竞态"载体经第二轮核证失实**（见 R1） | **采纳·更正**：冲突性质改为「边界 1 × 来源 ① 语义不一致」 | §2.3、§6.2 前置 B、Q9 |
| M2 | 投影链路无用户身份 | 成立（`getProjectsWithSessions` 无 userId；表 per-user） | **采纳** | §6.2 前置 A、T3 |
| M3 | 只下沉读/判定，写路径未讨论 | 成立 | **采纳** | §6.2 前置 C、Q9 |
| M4 | §6.4 代价2 是假两难（可双列共存） | 成立 | **采纳** | §6.4 代价2、Q6 |
| M5 | Q2 ③ 与 COALESCE 不兼容 | 成立（哈希产不出时间值） | **采纳** | Q2 |
| M6 | §5 方案 X 论证需修正 | 成立 | **采纳** | §5 X |

### 第二轮（针对补充后的 §6.2 前置 / §6.5 / 处置表）——【裁定：6 条全部成立，已回写】

提出者：mimo · 第二轮 + Claude · 第二轮（两边独立命中同一批，一致）。

| # | 批注（提出者） | 核实 | 裁定 | 已落到的位置 |
|---|---|---|---|---|
| R1 | 前置 B / M1 的「5s reconcile 竞态」载体失实；**真冲突是"边界 1 × 来源 ①"语义不一致**（mimo + Claude） | 实测：`useChatComposerState.ts:1041` 只 reconcile `queuedDraft`（`:1030` 有 `!queuedDraft` 早退）；`refreshProjectsSilently` 全事件驱动、无周期轮询；写库先于广播 | **采纳（更正第一轮载体）** | §6.2 前置 B、处置表 M1 |
| R2 | 新增**前置 D**：`session_upserted` 载荷无 `isUnread` + 广播 user-agnostic（mimo + Claude） | 实测 `buildSessionUpsertedEvent` 只带 `contentUpdatedAt`（`:57`）、`sendToConnectedClients` 群发无 user 隔离（`:73-85`） | **采纳** | §6.2 前置 D、§6.5、Q9、Q10 |
| R3 | §6.5「冗余面 = 一个函数」是**条件结论**，取决于前置 D（mimo + Claude） | 成立（选 (b) 时该函数仍被增量路径需要） | **采纳** | §6.5 表/结论/悬空项、Q10 |
| R4 | T5 标题「SQLite 型必做」含**文件型**的 workbuddy，易误导（mimo + Claude） | 成立（§3 表 workbuddy 为 `.jsonl` 文件型） | **采纳·改标题**为「无判别位 provider 必做」+ 拆两行动因 | §7 T5 |
| R5 | 处置表只覆盖第一轮、却写成终态措辞（Claude） | 成立（版本断裂） | **采纳**：拆为「第一轮 12/12 + 第二轮」 | 本节 |
| R6 | §6.5 的 git 前提核实为真（mimo） | 成立（`??` 未跟踪 / `M` 未提交） | **确认**（无改动） | §6.5 |

### 第三轮（针对整理后的「决议清单」）——【裁定：9 条，8 采纳 / 1 驳回】

提出者：Claude · 第三轮（5 条）+ mimo · 第三轮（4 条）。**Claude 与 mimo 在"决定 2 后果①"上直接冲突**（R8 vs R13），按"审阅者论据也要复算"实测裁定。

| # | 批注（提出者） | 核实 | 裁定 | 已落到的位置 |
|---|---|---|---|---|
| R7 | 决定 1 的 B-1 推荐段自我抵消（"例外/放弃否决权"在 B-1 下是同义反复；"无法熄灭"不实）（Claude） | 成立：`clearSessionAttention` 在 `:1335`（打开）/`:1182`（切换）确实清灯 | **采纳·改写**：B-1＝"无水位会话来了消息 → 亮并保持，直到用户打开" | 决议清单 决定 1 |
| R8 | 决定 2 后果①"被 S4 自发消解、应删"（Claude） | **不成立**（见 R13）：S4 不回填存量行 | **驳回·改判** | 决议清单 决定 2 |
| R9 | 推荐三元组的收益边界未写清：B-1 否掉"多端自动熄灭"（Claude） | 成立 | **采纳** | 决议清单 默认配方 + 总闸 (b) 措辞 |
| R10 | 建议固化"默认实现配方"收口，让 T3/T4 挂在配方上（Claude） | 成立 | **采纳** | 决议清单 默认配方 |
| R11 | 文档头部状态行"已吸收一轮审阅"未随整理更新（Claude） | 成立（已三轮） | **采纳** | front-matter |
| R12 | D-a 行字段陈旧 ⇒ 用户刚读完蓝点又亮；须加"水位写入后使行 `isUnread` 失效"约束（mimo） | 成立（订阅 `:674` 触发重跑；现状靠实时比较 `sessionReadState.ts:58-64` 免疫） | **采纳** | 决议清单 决定 3 配套约束 |
| R13 | Claude"后果①被 S4 消解"过强：S4 不回填存量行（37 条全 NULL）⇒ 后果①降级为"历史行一次性残余"（mimo） | 成立（§1.2 实测；§7 无回填步骤） | **采纳**（据此改判 R8） | 决议清单 决定 2 |
| R14 | C-2"Turn 结束自落水位"摧毁未读语义（还没看就已读）（mimo） | 成立 | **采纳** | 决议清单 决定 2 + §6.5 悬空项 |
| R15 | B-1 的产品代价：永不打开的会话蓝点永久驻留（含来源 ③）（mimo） | 成立 | **采纳** | 决议清单 决定 1 |

**第三轮总结**：Claude 5 条中 **4 采纳、1 驳回**（R8，被 mimo R13 证伪）；mimo 4 条**全部采纳**。**驳回要点**：C8 假设"S4 会回填存量行"，与 §1.2 实测（37 条全 NULL）＋ §7（无回填步骤）直接矛盾——这正是"审阅者论据也要复算"的又一例。

**仍需用户/评审拍板（本文不代拍）：** 前置 B（clear 规则 + 三来源合并优先级——**真冲突是"边界 1 × 来源 ①"语义不一致**）、前置 C（水位写路径是否迁移）、**前置 D（增量事件是否带 `isUnread`）**——合并为 §8 Q9 / Q10。
