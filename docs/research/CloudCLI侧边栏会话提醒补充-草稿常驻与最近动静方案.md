# CloudCLI 侧边栏会话提醒补充：草稿常驻 + 最近动静弱提示

> - **状态**：**已实现（2026-10-15，未 push）**。需求 1 全量落地（`6e971568`）；需求 2 经两次迭代，最终定为**方案 B——改未读蓝点自身的清除规则**（`88e078e2`）；A 路径（整行弱底色 → 左缘竖条）已废弃（`e385524a`，见「迭代 1 / 迭代 2」）。**两个页签自动一致**：B 不引入新视觉，未读蓝点本就由同一个 `attentionSessions` 供两个页签，故原「Conversations 弱底色暂缓项」随之消解。类型检查 0 error；前端全量测试与既存基线一致（8 文件 / 35 例环境相关失败，全在无关模块）；lint 0 error。§4 的 Q1–Q7 已在 §8 逐条落定。未走多 AI 审阅（见 §8 首段理由）。
> - **用途**：评审「在侧边栏会话行补充两类提醒」的方案 —— ① 输入框有草稿未发送 → 常驻标记；② AI 刚回复、我打开看过又切走 → 还想找得回去。审阅重点：**§4 开放问题的取舍（尤其需求 2 是否该新增弱底色而非给蓝点续命、弱底色的触发与时长、需求 1 的草稿标记是否复用蓝点）、§3.1 的订阅与重渲染边界、§3.2 的「零新增状态」推导是否成立**。
> - **关联文档**（**务必先读**，本方案建立在其不变量之上）：
>   - `docs/research/CloudCLI侧边栏状态指示重设计方案.md`（一期：左右双通道、删绿点）
>   - `docs/research/CloudCLI侧边栏状态指示重设计-二期需求.md`（二期：未读持久化）
>   - `docs/research/CloudCLI未读判定机制-方案评估与建议.md`（未读下沉服务端 + 内容指纹）
> - **参考规范**：`.agents/skills/frontend-module-standards/SKILL.md`（本方案**不触碰 `server/`**）
> - **阅读提示（对评审者）**：凡 **【事实】** 段落均为代码实测可复现（附 `文件:行号`），请直接核对；凡 **【建议】** 为作者判断，**欢迎推翻**。§4 是专门留给评审者的问题清单。

---

## 0. 一句话结论

用户提了两条需求。**第一条（草稿未发送提醒）成立，做**：草稿数据源已就绪，只需新增一个**独立形状**的常驻标记——**绝不复用蓝点**，否则重蹈一期「一个点三种语义」的覆辙。**第二条（打开后蓝点续命 10 分钟）动机真实，但形式否掉**：让蓝点兼职「我最近来过」会把一期刚拆开的「未读（Q1）」与「最近活跃（Q3）」两个生命周期重新压回一个形状，且纯定时器会「指示说谎」（你已回复它却还亮）。**替代实现（方案 A）**：新增一条**极弱**的会话行底色表达「最近 N 分钟有过新内容」，它**纯由已有的 `contentUpdatedAt` + 时间推导、零新增状态、不改任何既有生命周期**，恰好落在一期文档预留的回退位上（一期 §295）。

> **⚠ 本节已被推翻，保留作决策留痕。** 方案 A 落地后用户实测两次否掉（底色不够明显 → 竖条与选中态撞车），最终改用**方案 B：改未读蓝点自身的清除规则**（打开不清、发出/留草稿才清、宽限期兜底）。**最终结论与理由见 §8「迭代 2」**，本节及 §3.1/§3.2 的 A 路径描述均已作废。

---

## 1. 现状事实（已实测确认）

### 1.1 attention（蓝点 / 加粗）的单一状态源与生命周期

- **单一 state 源**：`attentionSessions: Map<string, SessionAttentionLevel>`（`src/modules/project-workspace/hooks/useProjectsState.ts:449`），`SessionAttentionLevel = 'action' | 'notice'`（`src/shared/types.ts:1872`）。
- **加粗**：`isUnread = Boolean(attentionLevel) && !isSelected`（`SidebarSessionItem.tsx:103`，应用处桌面 `:548` / compact `:283`；Conversations 行同规则 `SidebarRecentConversations.tsx:131`、`:242`）。
- **蓝点 / 琥珀胶囊**：`AttentionSlot` 在 `level === 'notice'` 画蓝点（`SessionStatusIndicators.tsx:84-97`）、`'action'` 画琥珀胶囊（`:100-111`）；**`level` 为空或 `isSelected` 时整槽返回 `null`**（`:80-82`）。
- **左缘是另一条通道**：`ActivitySlot`（`SessionStatusIndicators.tsx:37-63`）表达「在动吗」（瞬时），与右缘未读正交。
- **置位**：WebSocket 非白名单事件 → `markSessionAttention`（`useProjectsState.ts:1025-1038`，`getAttentionLevel` 把 `permission_request` 判 `action`、其余 `notice`，`:47-48`）；`session_upserted` 且非 metadata（`:1059-1064`）；审批轮询权威置 `action`（`:603-631`）；**刷新后由服务端 `isUnread` 重建**（`applyPersistedUnread` `:660-690`，只升不降）。
- **清除**：**打开/切换会话立即清**（`handleSessionSelect` → `clearSessionAttention(session.id)`，`useProjectsState.ts:1363-1366`）；进入/离开 effect 再清（`:1210-1212`）；resolve/cancel 清最后一个请求（`:1006-1023`）；删除会话（`:1405-1407`）。
- **置位函数对「当前观看会话」直接丢弃**（`markSessionAttention` `:558-561`）——即你在看的会话不会被标未读。

> **【事实】结论**：蓝点/加粗是**粘性（sticky）且「打开即清」**的，且它**只有一个生命周期**。任何「打开后仍要保持」的诉求都与它现有语义相冲突。

### 1.2 未读已下沉服务端，内容指纹已持久化

- 列与迁移：`sessions.content_updated_at`（`server/modules/database/schema.ts:158-164`、`server/modules/database/migrations.ts:507`）。
- 判定纯函数：`isSessionContentUnread`（`server/shared/session-unread.ts:13-28`）；水位表 `session_read_state`（`schema.ts:305-314`，仓库 `session-read-state.db.ts`）。
- 随载荷下发：项目列表投影 `projects-with-sessions-fetch.service.ts:170-182`；增量广播 `session-upsert-broadcast.service.ts:49-67`。
- **客户端已持有 `contentUpdatedAt` 与 `isUnread`**：`src/shared/types.ts:111`（`contentUpdatedAt?: string | null`）、`:119`（`isUnread?: boolean`）；且已被用于写已读水位：`markSessionSeen(targetSessionId, targetSession.contentUpdatedAt)`（`useProjectsState.ts:1196-1204`）。

> **【事实】`contentUpdatedAt` 是「内容级时间戳」，不是文件 mtime** —— bare `touch` 不会改变它（二期需求 D 的成果）。这使它可以安全地当作「最近真的有过新内容」的判据。

### 1.3 侧边栏已有一个 60s 心跳，且无任何 attention 衰减

- 唯一相关定时器：`useSidebarController.ts:157-163` 的 `setInterval(60s)` 刷新 `currentTime`，驱动年龄文案（`SidebarSessionItem.tsx:99`、`sidebarProjectFormatting.ts:22-29`）。
- **`attentionSessions` 为粘性，无任何 `setTimeout/setInterval` 引用它**；清除只由 §1.1 的显式路径触发。

> **【事实】现状不存在任何「N 分钟后自动衰减」的时间状态。** 需求 2 若采用定时器，是**新增一类状态**；若采用方案 A（§3.2），则**复用这个 60s 心跳、零新增状态**。

### 1.4 草稿：已按会话持久化，且有现成订阅点，但无人监听

- **三层存储**：服务端表 `session_drafts`（`schema.ts:282-292`，仓库 `server/modules/database/repositories/session-drafts.db.ts`）+ localStorage 镜像 `chat-drafts` + 内存 `Map` 单例，全部在 `src/shared/chatDrafts.ts`。
- **scope 口径**：一个 scope 是 sessionId，或未发送的新会话用 `project:<projectId>`（`chatDrafts.ts:14-17`；由 `useChatComposerState.ts:263-267` 算出）。
- **现成读取 API**：`readDraftText(scope)`（`:183-185`）、`readQueuedMessage(scope)`（`:191-207`，返回 `null` 除非内容/附件非空）、**`subscribeToChatDrafts(listener)`（`:222-227`）**。
- **写路径**：每次键入经 1s 防抖写服务端（`:47`、`:144-151`）；登录后 hydrate（`:236-284`）。
- **`CHAT_DRAFTS_CHANGED_EVENT`（`:38`，dispatch `:109`）全仓库无任何监听者**——`grep` 只见 dispatch，不见 `addEventListener`。

> **【事实】侧边栏当前完全拿不到「某会话有草稿」**，但数据源与订阅点都已存在，**接入不需要任何后端改动**。

### 1.5 一期已裁定删除「最近活跃」绿点（Q3）

- 一期文档：「**删除绿点。** 它要么等于『你刚点过』（你自己知道），要么等于『别人动过它』（已归通道 B）。信息量≈0，却是最大混淆源」（`CloudCLI侧边栏状态指示重设计方案.md:78`）；D1 裁定删除（`:209`）。
- **但一期同时预留了回退位**：「删绿点后『最近用过』的可发现性下降｜依赖列表排序 + age 文本；**若体感不足，回退为『极弱行底色』而非点**」（`:295`）。

> **【事实】一期删的是「绿点」，不是「最近活跃」这个信息本身**；并明确授权了「极弱行底色」这一低干扰回退形式。**本方案的需求 2 正是走这条授权路径**，不是推翻一期。

---

## 2. 决策记录

| 编号 | 决策 | 理由 | 依据 |
|---|---|---|---|
| D1 | **需求 2 不给蓝点续命**，改为新增极弱行底色 | 蓝点=Q1「有事等我」，粘性/打开即清；「最近来过」=Q3，生命周期不同。续命即把两种语义压回一个形状，正是一期要根治的病 | 一期 `:33`、`:78` |
| D2 | 需求 2 的弱底色**纯由 `contentUpdatedAt` + 当前时间推导**，零新增状态 | 已有字段已下发；复用 60s 心跳；不新增定时器、不新增 Map、不改 attention 生命周期 | §1.2、§1.3 |
| D3 | 需求 1 的草稿标记**独立形状**，绝不并入蓝点/加粗 | 草稿是用户自己的状态，与「AI 有新动态」正交；一期原则「一个位置/一种形状只回答一个问题」 | 一期 `:33` |
| D4 | 需求 1 的标记**常驻、不因打开而清**，只在发出或清空时消失 | 草稿不被消费就不会消失；「打开会话」不等于「处理了草稿」 | §1.4 |
| D5 | 需求 2 的弱底色在**选中行不显示** | 你正看着它，「最近来过」对当前行无导航价值，徒增噪声 | 与 `AttentionSlot` 的 `isSelected` 处理一致（`SessionStatusIndicators.tsx:80`） |
| D6 | 需求 1 的标记在**选中行不显示** | 你正看着输入框，标记无信息量 | 同上 |

> D1–D6 是作者倾向，**均可被 §4 推翻**。

---

## 3. 设计

### 3.1 需求 1：草稿未发送 → 常驻标记

**语义**：`scope`（sessionId）存在非空草稿或待发队列消息 ⇒ 该会话行显示一个常驻标记。它是继「活动（左缘）」「未读（右缘）」之后的**第 4 类信号：Q5『我留了半句话没发』**。

**3.1.1 数据通路（不改后端）**

在侧边栏侧新增一个订阅，把「有草稿的 scope 集合」暴露给行组件：

- 订阅：`useSyncExternalStore(subscribeToChatDrafts, getSnapshot)` —— 与仓库既有模式一致（`useCompactSidebar.ts:31`、`useThemePasteFormat.ts:41`、`useSlashCommands.ts:96` 均用此法订阅模块级单例）。
- **重渲染边界（关键）**：`notifyListeners()` **每次键入都会触发**（`chatDrafts.ts:179`），若快照直接返回可变对象会导致全列表每键一渲染。**`getSnapshot` 必须返回一个「只有成员变化才换引用」的稳定值**（例如缓存的 `ReadonlySet<string>`，或一个仅在成员变化时自增的版本号），并让行组件只读「本会话是否在集合内」。
- **新导出（建议）**：在 `chatDrafts.ts` 增加 `hasDraftContent(scope): boolean`（= `readDraftText(scope).trim() !== '' || readQueuedMessage(scope) !== null`）与一个「列出有内容的 scope」的选择器，供侧边栏一次性取集合，避免逐行调用。

**3.1.2 「有草稿」的判定口径（需拍板，见 §4 Q3）**

- **纯空白不算**：`text.trim() === ''` 且无附件 ⇒ 不算。
- **待发队列消息算不算**：`readQueuedMessage(scope) !== null`（有 content 或 attachments）**倾向算**——它本质也是「写了没发出去」。
- **新会话草稿**：scope 为 `project:<projectId>`，**不挂在任何会话行上**。v1 **不做**（不在项目行提示），见 §4 Q4。

**3.1.3 形状与位置**

- **独立形状**，不复用蓝点。建议：右缘、蓝点**左侧**放一个「铅笔 / 起草中」图标（或一个虚线空心胶囊），与蓝点（实心圆）、琥珀胶囊（实心+警告）**在形状上可区分**（一期原则：靠形状而非颜色区分，`SessionStatusIndicators.tsx:74-78` 注释）。
- 复用 `AttentionSlot` 所在的「右缘槽」容器思路，但**另起一个 `DraftSlot`**，让两个槽可**并存**（草稿 + 未读同时成立时都画）。
- tooltip 走既有 i18n 段 `sidebar.json → tooltips.*`（现 22 个 key，如 `attentionNoticeIndicator`，`locales/en/sidebar.json:93-94`）；新增 `tooltips.draftIndicator`（en/zh-CN 各一条）。

**3.1.4 显隐规则**

- 有草稿 ⇒ 显示（选中行除外，D6）。
- 发出消息 / 清空输入 ⇒ 标记消失（由 `chatDrafts` 的 `updateDraft` 自动驱动）。
- **不因打开会话而清除**（D4）——这是它与未读标记的核心差别。

**3.1.5 覆盖范围**

- 三个宿主行：Projects 桌面行、compact 卡片（`SidebarSessionItem.tsx` 两处布局）、Conversations 行（`SidebarRecentConversations.tsx`）。与一期的「两页签一致」要求对齐（一期 §3/§5）。
- 移动端随 compact 卡片自然覆盖。

### 3.2 需求 2：最近动静弱底色（方案 A）

**语义**：`now - contentUpdatedAt < TTL` 且非选中 ⇒ 该会话行加一层**极弱**底色，表达「最近有过新内容」。它是**导航辅助**，不抢任何既有形状；**未读（蓝点）仍严格「打开即清」**。

**3.2.1 零新增状态推导（D2）**

```
weakRecent(session) =
  !!session.contentUpdatedAt
  && (now - Date.parse(session.contentUpdatedAt)) < RECENT_ACTIVITY_TTL_MS
```

- `now` 取既有 60s 心跳的 `currentTime`（`useSidebarController.ts:157-163`）——沿用时不必新增定时器。
- `contentUpdatedAt` 为 `null` 的会话**不显示**（老会话兜底见 §4 Q5）。
- **TTL 默认 10 分钟**（可配置常量），符合用户诉求；因是「极弱底色」而非点，10 分钟不会像常亮圆点那样刺眼。

**3.2.2 与用户场景的对应（验证成立）**

| 时刻 | 用户动作 | attention（蓝点/加粗） | 弱底色 |
|---|---|---|---|
| T0 | AI 回复完毕 | 置 `notice` → 亮 | 亮（T0<TTL） |
| T1 | 打开会话 | **打开即清 → 灭** | **仍亮**（时间未到） |
| T2 | 切到其他会话 | 保持灭 | **仍亮**（T0+TTL 前） |
| T0+TTL | 时间到 | 灭 | **自动灭** |

即：用户「打开后还想找得回去」的诉求由弱底色满足，而**蓝点全程没说谎**（它确实只在「有事等我」时亮）。

**3.2.3 渲染**

- 「极弱」的强度要与既有行底色**明显拉开**，避免混淆。既有底色分布（`SidebarSessionItem.tsx:246-253` 桌面/compact 同构）：基色 `bg-card`；hover `hover:bg-accent` / `hover:bg-muted/25`；**`bg-muted/20` 用于「非选中且处理中」的行**；**选中态不用底色，而是 `border-primary/40` + `shadow-[inset_3px_0_0_0_hsl(var(--primary))]`**（`:248-249`、`:489-490`）。因此弱底色的主要混淆对象是「处理中行」与 hover 态，而非选中态。建议用一个极低透明度 tint（例如 `bg-primary/5` 级别），并在暗色主题下单独校验对比度（一期 §12.5 的教训：颜色不是可靠信道）。
- 选中行不画（D5）。
- **不改** `AttentionSlot` / `ActivitySlot` / 项目聚合的任何代码路径。

**3.2.4 被否决的替代（供评审对照）**

- **方案 B（行为式）**：打开会话不立即清 attention，改为「发出消息 → 清」「留下草稿 → 交 §3.1」「都没留 → 弱提示」。「看一眼没回」判定更准，但需新增 per-session 衰减状态，且对「纯 FYI、不打算回」的会话会滞留（需再补「停留超 X 秒视为已读」），复杂度显著更高，与用户「最简优先」的既有偏好不符。
- **方案 C（原样照做：蓝点 10 分钟续命）**：会同时踩两个坑 —— ① 语义污染（§2 D1）；② 「指示说谎」（你已回复它仍亮）。**明确不采纳**。

---

## 4. 开放问题（附倾向）

> 评审者请优先回答本节。

**Q1｜需求 2 是否接受「弱底色」而非「蓝点续命」？**
作者倾向：**接受**。若评审坚持要求蓝点本身可见地保留一段时间，则必须同时满足：起点是「离开会话那一刻」（而非 AI 回复那一刻，否则等于未读）、期内「一发出消息立即清」——否则「指示说谎」。请评审确认二选一。

**Q2｜弱底色的触发是否应包含「你自己发出的消息」？**
作者倾向：**包含**（`contentUpdatedAt` 无法区分发言方，且「我刚动过这个会话」本也值得找得回去）。若不希望自己发言点亮它，需要新增「仅 assistant 内容时间戳」字段，成本上升。请评审裁决。

**Q3｜待发队列消息（`readQueuedMessage`）算不算「有草稿」？**
作者倾向：**算**。请评审确认。

**Q4｜新会话草稿（`project:<id>`，无会话行）是否要在项目行提示？**
作者倾向：**v1 不做**，避免范围膨胀（项目行聚合已由 `deriveProjectAggregate` 承担，混入草稿维度会让 `ProjectAggregate` 类型与优先级链变复杂，`projectAggregate.ts:17-21`）。列为后续可选。

**Q5｜`contentUpdatedAt` 为 `null` 的会话怎么处理？**
作者倾向：**不显示弱底色**（宁缺毋滥）。若认为老会话体验断层明显，可回退到 `lastActivity`——但该字段是文件 mtime 派生，会重新引入二期刚消灭的「touch 即新」假阳性，**不建议**。

**Q6｜弱底色的 TTL 取 10 分钟还是更短？**
作者倾向：**10 分钟**（贴合用户表述，且弱底色不刺眼）。若实测发现活跃项目下顶部行长期泛光形成噪声，下调至 2–3 分钟。

**Q7｜草稿标记的形状最终选型？**
作者倾向：**右缘、蓝点左侧的「起草中」图标**（形状可区分）。请评审在「图标 / 虚线胶囊 / 行左缘小笔」中给定。

---

## 5. 改动清单与实施顺序

**阶段 1 · 需求 1（草稿常驻标记）**
1. `src/shared/chatDrafts.ts`：新增 `hasDraftContent(scope)` 与「有内容的 scope 集合」选择器（导出）。
2. 新增侧边栏 hook（如 `src/modules/sidebar/hooks/useDraftScopes.ts`）：`useSyncExternalStore(subscribeToChatDrafts, getSnapshot)`，快照为**成员变化才换引用**的稳定集合（落实 §3.1.1 重渲染边界）。
3. `src/modules/sidebar/SessionStatusIndicators.tsx`：新增 `DraftSlot`（独立形状，与 `AttentionSlot` 并存）。
4. 三个宿主行接入：`SidebarSessionItem.tsx`（桌面 + compact）、`SidebarRecentConversations.tsx`。
5. `locales/en/sidebar.json`、`locales/zh-CN/sidebar.json`：新增 `tooltips.draftIndicator`。

**阶段 2 · 需求 2（最近动静弱底色）**
6. 常量 `RECENT_ACTIVITY_TTL_MS`；在行组件用 `currentTime` + `contentUpdatedAt` 推导并挂弱底色 class（桌面 + compact + Conversations）。
7. 暗色 / 选中态对比度校验；确认不与 `bg-muted/20` 混淆。

**阶段 3 · 测试与文案**
8. 单测：`hasDraftContent` 口径（空白/队列/清空）、弱底色 TTL 边界（`contentUpdatedAt=null`、刚好 TTL、TTL 内）。
9. 渲染测试：草稿标记与未读**并存**、选中行两者皆隐、TTL 到期消失。
10. i18n 补 en/zh-CN（仓库惯例：en 为真源，zh-CN 同步）。

> **【事实】** 本方案**不涉及 `server/`**，无迁移、无路由、无广播改动。

---

## 6. 验收清单（DoD）

- [ ] 在会话 A 输入若干文字但**不发送**，切到会话 B：A 的行**显示**草稿标记。
- [ ] 回到 A 再切走：草稿标记**仍在**（常驻，不因打开而清）。
- [ ] 在 A 发送消息：草稿标记**立即消失**。
- [ ] 在 A 清空输入：草稿标记**消失**。
- [ ] 只有空白/纯空格的输入：**不**显示草稿标记。
- [ ] A 同时有未读与草稿：**两个标记并存**（右缘两个可区分形状）。
- [ ] 选中 A 时：草稿标记与未读标记**都不显示**。
- [ ] AI 在 A 回复完毕 → 打开 A（蓝点/加粗**立即消失**）→ 切到 B：A 行**弱底色仍在**，且**蓝点/加粗不复现**。
- [ ] A 的 `contentUpdatedAt` 超过 TTL 后：弱底色**自动消失**，无需任何用户动作。
- [ ] 弱底色**不影响**项目行聚合指示（`deriveProjectAggregate`）的既有输出。
- [ ] 三个宿主行（Projects 桌面 / compact 卡片 / Conversations）行为一致。
- [ ] 暗色主题下弱底色可辨识，且不与「非选中且处理中」行的 `bg-muted/20`、hover 态混淆。
- [ ] 键入草稿时**不引发全列表逐键重渲染**（快照引用稳定性验证）。

---

## 7. 风险与回滚

| 风险 | 影响 | 缓解 / 回滚 |
|---|---|---|
| 需求 1 快照引用不稳，键入逐键重渲染全列表 | 侧边栏卡顿 | §3.1.1 强制稳定集合；DoD 末项专项验证 |
| 弱底色与「处理中」行底色（`bg-muted/20`）/ hover 混淆 | 用户误判状态 | 「极弱」强度与二者拉开；暗色专项校验；必要时只保留左缘 2px 条 |
| 活跃项目顶部行长期泛光 | 噪声 | TTL 可下调（Q6）；或仅对「非当前最新会话」显示 |
| 评审否决方案 A、坚持蓝点续命 | 需返工 | 回滚点：阶段 2 独立，可整体回退为「不做需求 2」，阶段 1 不受影响 |
| 需求 1 扩展到项目行聚合 / 新会话草稿 | 范围膨胀 | §4 Q4 明确 v1 不做，单列后续 |

**回滚粒度**：阶段 1 与阶段 2 无依赖，可分别独立上线/回退。

---

## 8. 实施记录（2026-10-15）

**为什么未走多 AI 审阅**：本方案的既往审阅价值来自服务端风险（DB 迁移 / 删行孤儿化 / 分页算术 / 并发 / 时间戳污染排序），此需求**一条都不沾**（纯前端、无 `server/` 改动、无迁移、无并发）。唯一的事实不确定点（`contentUpdatedAt` 客户端可得性）已实地复算：它已被 `applyPersistedUnread` 消费（`useProjectsState.ts:674`），`null` 是显式处理分支（`sessionReadState.ts:47-49`）。

**落地内容**

- 需求 1：`DraftSlot`（`SessionStatusIndicators.tsx`，右缘钢笔，独立形状）；数据面 `getDraftScopesSnapshot` + `hasQueuedContent`/`draftHasContent`（`src/shared/chatDrafts.ts`）、`useDraftScopes`（`src/modules/sidebar/hooks/useDraftScopes.ts`，`useSyncExternalStore`）；三个宿主行接入；i18n `tooltips.draftIndicator`（en + zh-CN）。
- 需求 2：**初版 A 路径（`isRecentlyActive` + `RECENT_ACTIVITY_TTL_MS` + 整行底色 → 左缘竖条）已整体废弃**。最终形态见「迭代 2 · 方案 B」：不动渲染、只改 `useProjectsState` 里未读的清除规则。

**§4 开放问题的落定（实现即答案）**

| 问题 | 落定 | 说明 |
|---|---|---|
| Q1 弱底色 vs 蓝点续命 | **都不是，走方案 B** | 最终改蓝点自身的清除规则（打开不清、处理才清），见「迭代 2」 |
| Q2 含自己发的消息 | **N/A（A 已废弃）** | B 里「发出消息」经草稿清除路径覆盖 |
| Q3 队列消息算草稿 | **算** | `hasQueuedContent`（content 或 attachments 非空） |
| Q4 新会话草稿 | **不做** | 未触及项目行聚合 |
| Q5 `contentUpdatedAt` 为 null | **N/A（A 已废弃）** | B 不依赖该字段做推导 |
| Q6 TTL | **10 分钟** | B 的宽限期 `ATTENTION_GRACE_MS`，起点为「最后一次看到它」 |
| Q7 形状 | **钢笔（`Pencil`）** | 与蓝点（实心圆）、琥珀胶囊（实心+警告）形状可区分 |

**与方案的偏离**：A 路径的取值迭代（底色强度 → 竖条）已随 A 整体废弃，见「迭代 1」；最终需求 2 不再对应本文档 §3.2 的任何一种形式，而是 §3.1 曾评估过的「行为规则替代定时器」，见「迭代 2」。

**暂缓项（已消解）**：原拟给 Conversations 页签补弱底色，需服务端投影补 `contentUpdatedAt`。**方案 B 不再新增视觉**，未读蓝点由同一个 `attentionSessions` 供两个页签，故该项无需再做；Conversations 的草稿钢笔早已接入（需求 1）。

**测试**：`src/shared/tests/chatDrafts.test.ts`（快照口径 + 引用稳定性）；`src/modules/sidebar/tests/sessionRowDraft.test.tsx`（钢笔与蓝点并存 / 选中隐藏 / 空白不计 / 队列计入）；`src/modules/project-workspace/tests/projectsStateAttention.test.ts`（既有 23 例 + B 新增 6 例）。

**未验证项（需人工目视或真机）**：B 的行为需在真机上体感确认——「打开一个未读会话 → 切走 → 蓝点与加粗应仍在」、10 分钟后自动消失、留草稿即消失。

**迭代 1（2026-10-15）· 需求 2 从「整行弱底色」改为「左缘竖条」**

用户目视后反馈 `bg-primary/5`「不够明显」。判断：**底色的「弱」是这个信道本身的属性**——当初选它正是为了不抢左右两缘的语义，因此加浓底色只会同时逼近「非选中且处理中」的 `bg-muted/20` 与 hover 态，越调越脏。正确做法是**换信道**（背景面积 → 边缘形状），而不是在同一维度加码。

- 具体：新增 `RecentActivityRail`（`SessionStatusIndicators.tsx`），行内绝对定位、`inset-y-1 left-0 w-[3px] rounded-full bg-primary/50`；`SidebarSessionItem` 两种布局挂载（桌面 `<a>` 为此补 `relative`）。整行底色 `bg-primary/5` 移除。
- 为何不与既有指示撞车：`ActivitySlot` 是**左缘外侧**的悬挂点（`left-0 -translate-x-1`，仅处理中出现），本竖条是**左缘内侧**的静态满高条——形状与位置都不同；右缘（蓝点 / 钢笔）完全未动。这正是本文档 §风险表「必要时只保留左缘 2px 条」预留的回退路径（本实现取 3px，以在圆角行上更稳）。
- 与选中态的关系：选中行本就不显示该条（`!isSelected`）；未选中 → 选中时，左缘从「50% 主色条」变为「实主色 inset 条」，读作自然递进，而非两个互相矛盾的状态。
- 测试同步：`sessionRowDraftAndRecency.test.tsx` 由「断言行 class 含 `bg-primary/5`」改为「断言行内存在 `.bg-primary/50` 竖条」，并继续按「装饰、非状态」校验它不产生 `role="status"`。
- 顺带修复：该测试自创建起就漏传两个必填 prop（`isProcessing` / `hasBackgroundWork`），`tsc` 报 TS2769 且已随 `6e971568` 提交；本次一并补上，`tsc --noEmit` 由 1 error 归零。

**迭代 2（2026-10-15）· 需求 2 由「新增视觉」改为「改未读的清除规则」（方案 B）**

用户指出左缘竖条与选中态竖条**几乎无差别**，一针见血。核对：选中态是 `shadow-[inset_3px_0_0_0_hsl(var(--primary))]`（**左缘内侧 3px 实主色**），竖条是 `left-0 w-[3px] bg-primary/50`（**左缘内侧 3px 半透明主色**）——同边、同宽、同色，只差透明度。这正是一期文档反复强调的禁忌（一个位置/形状只回答一个问题），A 路径两次都栽在同一处。

**根因**：这条会话行的信道已基本占满——左缘外侧（活动）、左缘内侧（选中）、标题（未读加粗）、右缘（蓝点/胶囊/钢笔）、行底色（处理中/hover）。**没有任何一个位置能再插一个形状而不与既有语义抢地盘。**

**用户最终选择 B，且它比 A 更简单**：用户原话要的就是「加粗 + 蓝点**继续保持显示**」——即同一个点续命，不必造第二个形状。落地：

- **打开不再清除**。`useProjectsState` 的进入/离开 effect 由 `clearSessionAttention(viewedSessionId)` 改为 `noteSessionViewed(viewedSessionId)`：仅记录查看时刻并启动宽限期；`handleSessionSelect` 里的清除同步移除。
- **真正清除**：① 该会话出现未发送草稿（`chatDrafts` 订阅）——回复必经此态，故「发出消息」被同一规则覆盖；② 宽限期到点，由**单个共享清扫**（每 30s）兜底；③ 删除会话。
- **从未打开过的 `notice` 不过期**（无 `seenAt`）：没看见的提醒不会悄悄消失——这是刻意区别于「按置位时刻衰减」的设计。
- **`action` 语义不变**：看它不老化胶囊，草稿也不清它（只清 `notice`）。
- **状态结构**：内部 `Map<id, level>` → `Map<id, {level, seenAt}>`，对外仍以 `useMemo` 暴露 `Map<id, level>`，故侧边栏各层与既有渲染测试**零改动、零新 prop**。
- **已知口径**：刷新后「已看过」不再保留——离开时会写服务端已读水位（与改动前一致），宽限期只在当前会话生命周期内有效。
- **测试**：`projectsStateAttention.test.ts` 既有 23 例全绿 + 新增 6 例（打开不清 / 宽限期边界 / 未打开不过期 / 新信号重新变新 / 草稿清 `notice` / 草稿不碰 `action`）。

**为何 B 不算「让蓝点说谎」**：本文档 §3.1 否掉的是「纯计时器给蓝点续命」；B 用「发出 / 留草稿即清」把说谎面收窄到仅剩「看了、不打算回、也没留字」这一类，而那一类正是宽限期要服务的对象。

---

## 审阅批注

> 本节留给其他 harness / 评审者填写。请对每条结论标明 **证据 / 反驳 / 补充**，并**优先回答 §4**。以下为占位样例（作者预留，非评审意见）。

### 待审阅（未填写）

> [!NOTE] 请评审者重点核对 §3.2.1 的「零新增状态」推导是否真的成立。
> 关键假设是：`contentUpdatedAt` 已在**所有**会话的客户端对象上可用且可靠非空。§1.2 已证其在服务端投影与广播中下发，但**是否有 provider / 会话类型在客户端拿不到该字段**，作者未逐一复算（§4 Q5 已列为开放问题）。请评审用实测确认。
