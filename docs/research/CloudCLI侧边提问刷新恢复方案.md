# CloudCLI 侧边提问（btw）刷新恢复方案

> **文档性质**：实施方案，待评审。第 2 章是可核对的事实，第 3 章起是设计决定；标 **【建议】** 的段落欢迎推翻。
> **状态**：**未实施**（2026-11-01 起草）。仅前端改动，不改服务端、不改表结构。
> **关联文档**：
> - `docs/research/CloudCLI侧边提问btw功能方案.md`（btw 本体，§17.13/§17.14 记录了「刷新即放弃」与回收窗口的两次结论）
> - `docs/research/iOS冷启动会话恢复实施方案.md`（同为"刷新/重开后状态丢失"的另一处解法，可对照取舍）

---

## 决议清单（2026-11-01 拍板）

| # | 问题 | 结论 |
|---|---|---|
| D1 | 恢复通道 | **同标签页 sessionStorage 快照**。不做服务端 resume 端点、不做 URL 参数 |
| D2 | 恢复形态 | 恢复成**边缘最小化 tab**，不自动展开抽屉（避免刷新后被面板顶一脸） |
| D3 | 快照体积 | **512 KB 上限**，超限**按轮次边界丢最旧**；仍超限则剥掉工具结果载荷 |
| D4 | 有效期 | 与标签页同生命周期，另加 **6 小时**上限（与 §5.9 清扫阈值对齐）。不跨标签、不跨设备、不跨重启 |
| D5 | 服务端 | **零改动**。schema、路由、仓储都不动 |
| D6 | `beforeunload` 拦截 | **不随本方案启用**。它是 A 未落地前的临时手段，A 落地后纯属摩擦 |

---

## 1. 需求与边界

### 1.1 用户诉求

在侧边提问里问了几轮，误刷一下页面，这条旁问就没了——既不在侧栏，也没有任何入口能找回来（`CloudCLI侧边提问btw功能方案.md:1004` 记录了当时"这一轮不做恢复入口"的决定）。要的是：**刷新后这条旁问还在，能接着问**。

### 1.2 恢复的完整含义

抽屉的可恢复状态有四项，缺一项用户都会认为"没恢复"：

| 要素 | 缺了会怎样 |
|---|---|
| 副本 session id | 抽屉空态，下次提问重新 fork（上下文丢） |
| 已渲染消息 | 抽屉在，但一片空白 |
| 锚点信息（`anchorInfo`） | 头部从"截至第 N 条"退化成"默认锚点"；`refork` 会悄悄放宽上下文 |
| 流式上下文（`lastSeq`） | 订阅从 0 开始，运行中的 run 会被整段重放 → 消息重复 |

**这是本方案真正的成本所在**，不是"存一个 id"。

### 1.3 不做的范围

- 不跨标签页、不跨设备（见 §7.1 的取舍）。
- 不恢复滚动位置、不恢复 composer 草稿、不恢复"抽屉是展开还是最小化"以外的界面状态。
- 不延长服务端回收窗口：副本仍按"重启全量回收 + 6 小时陈旧扫描"回收（`ephemeral-cleanup.service.ts:39-86`）。

---

## 2. 现状事实（可核对）

**【事实】F1｜抽屉的全部状态都在 React `useState` 里，没有持久化。**
`sideAskOpen` / `sideAskAnchor` / `sideAskPermissionRequests` / `sideAskMinimized`（`ChatInterface.tsx:372-383`），副本 id 在 `useBtwSession` 的 `useState`（`useBtwSession.ts:92`）。`localStorage|sessionStorage` 在 `src/modules/chat` 下与 btw 无任何交集。

**【事实】F2｜抽屉只渲染内存 store，从不回取历史。**
`sideAskMessages` 直接读 `sessionStore.getMessages(btw.sessionId)`（`ChatInterface.tsx:428-430`），没有任何 `/messages` 请求。**所以"只恢复 id"必然得到空抽屉。**

**【事实】F3｜订阅回放只覆盖"仍在运行"的 run。**
`handleChatSubscribe` 只在 `isProcessing` 时 `replayEvents(sessionId, lastSeq)`（`chat-websocket.service.ts:568-576`），`replayEvents` 取 `seq > afterSeq`（`chat-run-registry.service.ts:293-300`）。已完成的轮次不会重放——服务端注释明确说"那会和历史请求重复"。

推论：刷新期间的增量只能靠"持久化的 `lastSeq` + run 仍在跑"来补；已结束的轮次必须由快照本身承担。

**【事实】F4｜副本是真会话，且服务端会回收它。**
`is_ephemeral` 行 + 真实 transcript（`btw.service.ts:116-147`）；重启全量回收、6 小时陈旧扫描（`ephemeral-cleanup.service.ts:39-86`、`btw.service.ts:347-377`）。**恢复必须接受"有时恢复不了"**，不能把"快照存在"当成"副本存在"。

**【事实】F5｜已有一条丢失自愈路径，不需要新增失败分支。**
`handleSessionLost()` 在 `SESSION_NOT_FOUND` 与 `session_deleted` 两条路径上把抽屉打回空态并提示（`useBtwSession.ts:324-334`、`useChatRealtimeHandlers.ts:262-271`）。恢复后的副本若已被扫掉，第一次发送/关闭就会落到这条路径上。

**【事实】F6｜消息槽是 `realtimeMessages`，上限 500 条，可按条 seed。**
`appendRealtime` 是公开入口（`useSessionStore.ts:1060-1076`），`MAX_REALTIME_MESSAGES = 500`（`useSessionStore.ts:714`），`getMessages` 返回 `merged`（`:1238-1240`），`setObservedSession` 让非选中会话的更新也能触发重绘（`:1277`）。

**【事实】F7｜抽屉的待批准工具请求在订阅 ack 时由服务端重新下发。**
`chat_subscribed` 的 `pendingPermissions` 对 `sideAskSessionIdRef` 有专门分支（`useChatRealtimeHandlers.ts:254-258`）。**恢复只要发一次 `chat.subscribe`，权限弹窗就白拿回来了**，不需要进快照。

**【事实】F8｜仓库已有 `beforeunload` 拦截的先例。**
`CodeEditor.tsx:102-111`：有未保存改动时挂监听，`preventDefault()` + `returnValue`。

---

## 3. 方案选型

| 方案 | 成本 | 主要风险 | 结论 |
|---|---|---|---|
| **A. sessionStorage 快照** | 前端 ~200 行，0 服务端 | 快照体积、标签页复制 | **采用** |
| B. 服务端 resume 端点（按 `forked_from_session_id` 查最新副本） | 新路由 + 新列 + 迁移 + 归属模型，400+ 行 | ①fork 边界没落库，部分 provider 的 message id 每次读取重新合成，切片只能靠猜；②没有 owner 概念，双标签会共用一个副本（双写 + 互删）；③6 小时内的旧副本会"诈尸"；④改 sessions 表会让本机 ~40 例无关 server 测试假失败（需先迁移 `~/.cloudcli/auth.db`） | 否决 |
| C. URL `?btw=<id>` | 中 | 污染历史记录；与"不接管返回键"的既有约束冲突（btw 方案 §6.2）；同样不解决消息重放 | 否决 |
| D. 刷新时自动 promote（`pagehide` + keepalive PATCH） | ~15 行 | 每次带旁问刷新都在侧栏多一条 `(btw)` 会话，破坏"旁问永不可见"这条前提；移动端进程被杀时 keepalive 常常发不出去 | 否决（可作为"只求不丢内容"的备选） |
| F. `beforeunload` 拦一下 | 5 行 | 只是防误刷，不是恢复；A 落地后变成每次刷新都弹窗 | 见 D6：不随本方案启用 |

**为什么 A 够用**：抽屉天然是"单标签页里的一个副本"。`sessionStorage` 按标签隔离、活过刷新、标签页关闭即清——正好是这件事的正确作用域，不需要发明归属协议。

---

## 4. 设计

### 4.1 快照结构

单槽，key `cloudcli.btw.restore.v1`。抽屉本身在单标签页里只有一个，不做按 source 分槽。

```ts
type BtwSnapshot = {
  v: 1;
  /** 打开抽屉时的来源会话；刷新后只有当前会话与它相同才恢复。 */
  sourceSessionId: string;
  sessionId: string;
  /** 已收到的最高 seq；恢复时作为订阅参数，避免整段重放。 */
  lastSeq: number;
  /** 供恢复后 `refork` 复用，避免"重新开始"悄悄放宽上下文。 */
  anchor: BtwAnchorRequest;
  anchorInfo: BtwAnchorInfo | null;
  /** 恢复时以最小化 tab 出现（D2），字段保留以便将来记住用户的折叠状态。 */
  minimized: boolean;
  messages: NormalizedMessage[];
  savedAt: number;
};
```

### 4.2 写入时机

- **主**：`pagehide`。刷新、关标签、前进后退都会触发，且此时不再有帧要处理。
- **辅**：`visibilitychange → hidden`（iOS 上 `pagehide` 不一定来）＋ 每次"助手回合结束"后节流写一次（1 秒）。这一条覆盖"被系统直接杀进程"的情况，代价是一次 `JSON.stringify`。
- **不**在每个 delta 上写：省 IO，且快照只服务"卸载那一刻"。

写入前把 `sideAskSourceSessionId` 固化成**创建副本时用的那个 id**（不是渲染时的派生值），避免"抽屉开着切了会话"把快照记到错误的 source 上。

### 4.3 截断规则（D3）

`serialize()` 后按 512 KB 判定，超限时依次：

1. 从最旧的一端整轮丢弃（回退到最近的 `role === 'user' && kind === 'text'` 边界），保留最近若干完整轮次；
2. 仍超限 → 对 `kind === 'tool'` 的行剥掉 `toolResult` 载荷（保留工具名与调用参数），工具卡退化为"结果未缓存"；
3. 仍超限 → 只保留 user/assistant 文本行。

被丢弃的旧轮次仍然在服务端副本的 transcript 里；本方案不提供"往前翻"，所以界面上的提示语要写清"仅恢复最近的旁问内容"。

### 4.4 恢复流程

挂载后执行一次（`ChatInterface` 的 effect），条件全部满足才恢复：

1. 读到合法快照（`v === 1`、JSON 可解析、`Date.now() - savedAt < 6h`）；
2. `selectedSession?.id === snapshot.sourceSessionId`——**不匹配就保持沉默、不删除**，用户可能只是先去了别的会话；
3. `btw.sessionId` 仍为空（新一轮创建不会被旧快照抢）；
4. `await api.sessionDetails(snapshot.sessionId)` 返回 2xx（`api.ts:311-312`）。404 → 清掉快照、静默结束。

命中后按顺序：

```text
seed:     每个 snapshot.messages → sessionStore.appendRealtime(id, m)
seq:      lastSeqRef.current.set(id, snapshot.lastSeq)
observe:  sessionStore.setObservedSession(id, true)
subscribe:{ type:'chat.subscribe', sessions:[{ sessionId:id, lastSeq:snapshot.lastSeq }] }
ui:       anchor ← snapshot.anchor; anchorInfo ← snapshot.anchorInfo
          sideAskOpen ← true; sideAskMinimized ← true
```

- `lastSeq` 必须来自快照。用 0 订阅会让运行中的 run 整段重放，而快照里已经有这些消息 → 重复。
- `appendRealtime` 走 upsert，重复的 id 会替换而不是堆叠；`MAX_REALTIME_MESSAGES = 500` 的截断只会砍掉最旧的（与 D3 一致）。
- 待批准的工具请求不进快照：订阅 ack 会把它们送回来（F7）。

### 4.5 清理时机

快照必须在下列任一时刻清空，否则下次刷新会"复活"一条早已不存在的副本：

| 时刻 | 位置 |
|---|---|
| 关闭成功（`204` 或 `SESSION_NOT_FOUND`） | `useBtwSession.close()` 的 `discard()` 分支（`useBtwSession.ts:264-272`） |
| 转正成功 | `promote()`（`:287-309`）——此时副本已变成正式会话，恢复它会重复 |
| 服务端已回收 | `handleSessionLost()`（`:324-334`） |
| 重新 fork | `refork()` → `close()` 已经覆盖 |
| 超龄 / 解析失败 / 探测 404 | 恢复入口处 |

### 4.6 与既有机制的交互

- **服务端回收**：恢复 → 发送 → `SESSION_NOT_FOUND` → `handleSessionLost()` 打回空态并提示。不需要新分支，也不会往已消失的副本里塞协议错误（该分支已有，见 `useChatRealtimeHandlers.ts:268-271`）。
- **promote 后刷新**：promote 已清快照，刷新后不会把"已转正的会话"再当旁问恢复。
- **重复标签页**：复制标签页会连同 `sessionStorage` 一起复制，两个标签可能指向同一个副本。后果有界——一方关闭会删掉副本，另一方落到 `handleSessionLost` 自愈。见 §7.2。
- **切换主会话**：快照只在 source 匹配时启用；抽屉开着切会话是既有边界，不在本方案范围内。

### 4.7 不做的事

- 不把快照写进 `localStorage`（跨标签、跨天"诈尸"）。
- 不新增服务端查询接口。
- 不恢复滚动位置或输入框草稿。

---

## 5. 改动清单

| 文件 | 改动 | 估计 |
|---|---|---|
| `src/modules/chat/utils/btwSnapshot.ts` | **新增**。`BtwSnapshot` 类型、`readBtwSnapshot` / `writeBtwSnapshot` / `clearBtwSnapshot`、`trimBtwSnapshotMessages`（D3 的三级截断）、`SESSION_STORAGE_KEY`。纯函数，可单测 | +110 |
| `src/modules/chat/hooks/useBtwSession.ts` | 新增 `restore(snapshot)`：seed store、写 `lastSeqRef`、`setObservedSession`、`chat.subscribe`、写入 `anchorInfo`；`discard()` / `promote()` / `handleSessionLost()` 三个出口调 `clearBtwSnapshot()`；新增可选入参 `lastSeqRef` | +45 |
| `src/modules/chat/ChatInterface.tsx` | 挂载后一次恢复 effect（§4.4）；`pagehide` / `visibilitychange` / 回合结束的写出（§4.2）；恢复时设置 `sideAskOpen` / `sideAskMinimized` / `sideAskAnchor`；保存"创建副本时的 source id" | +55 |
| `src/modules/chat/tests/btwRestore.test.tsx` | **新增**（见 §6） | +180 |

服务端零改动，因此**不需要** `npm run build:server`、不需要重启 daemon；只需 `npm run build:client`。

---

## 6. 测试计划

**`btwSnapshot.test.ts`（纯函数）**

1. 正常往返：写入 → 读出，字段等价（含 `anchorInfo`、`lastSeq`）。
2. 版本不符 / JSON 破损 / `savedAt` 超 6 小时 → 返回 `null`，且**不抛错**（`sessionStorage` 在隐私模式下可能直接抛）。
3. 截断按轮次边界：构造 200 条超预算消息，断言结果的第一条是 `user` 文本行，且尾部内容完整。
4. 二级截断：工具结果被剥掉后总量下降，工具名/参数仍在。

**`btwRestore.test.tsx`（hook + 组件，沿用 `btwSession.test.tsx` 的 mock 手法）**

5. 恢复后 `sessionStore` 里有快照消息，`chat.subscribe` 的 `lastSeq` 等于快照值（不是 0）。
6. 恢复后抽屉以 `minimized = true` 出现，`anchorInfo` 回到头部标签。
7. `sourceSessionId` 不匹配 → 不恢复、不订阅、快照保留。
8. `sessionDetails` 返回 404 → 不恢复、快照清空、不发 `chat.subscribe`。
9. `close()` 成功 → 快照清空；`promote()` 成功 → 快照清空；`handleSessionLost()` → 快照清空且**不发 DELETE**。
10. 恢复后的副本被服务端回收：发送 → `SESSION_NOT_FOUND` → 抽屉回到空态（与现有 `btwSessionReclaimed.test.tsx` 的断言一致）。

**现有测试影响**：`btwSession.test.tsx` / `btwDrawerCollapse.test.tsx` / `btwSessionReclaimed.test.tsx` 不涉及快照，预期不需要改；若 `useBtwSession` 的入参变化导致类型报错，补一个默认值即可。

---

## 7. 风险与取舍

### 7.1 不跨标签 / 不跨设备（有意）

跨标签恢复必须引入归属协议（谁是副本主人、谁能删），这正是 B 方案被否的原因。按标签页作用域，两个标签各自 fork 各自的副本，与今天的行为一致。

### 7.2 复制标签页（接受）

浏览器复制标签会连 `sessionStorage` 一起复制，两个标签可能都认为自己拥有同一条副本。后果：一边关闭会删掉副本，另一边在下次操作时落到 `handleSessionLost`（提示"服务端已回收"并允许重新提问）。**不做 `BroadcastChannel` 抢占**——为这个低频场景引入跨标签协议不划算。

### 7.3 快照与副本不一致（接受）

快照是"卸载那一刻的界面"。若刷新后副本被回收（重启 / 6 小时），界面先显示旧内容，第一次操作即自愈（§4.6）。反向不一致（副本比快照新）只发生在"卸载后 run 继续跑完"，那段内容暂时看不到——本次不做前端补拉，因为补拉要面对"fork 前缀怎么切"的问题（见 §9 批注 Q3）。

### 7.4 快照体积与隐私

`sessionStorage` 同源上限通常 5 MB，本方案自限 512 KB。旁问内容会以明文停留在这个标签页的会话存储里——与主会话消息同等级别的暴露面（都不落盘到 localStorage）。退出登录时不清理，标签页关闭即消失。

### 7.5 iOS 无 `pagehide`（部分覆盖）

靠 `visibilitychange` + 回合结束的节流写兜住；最坏情况丢掉最后一次写入之后的内容（通常是半句话）。

---

## 8. 验收（真机）

前置：前端由服务端下发，**必须 `npm run build:client` 后刷新页面**，否则验的是旧包。端口陷阱见 `AGENTS.md`（nginx `127.0.0.1:3012` 代理到 daemon `3011`，`lsof` 确认监听者是自己起的进程）。

1. 打开会话 → 开抽屉 → 问两轮 → `F5`。
2. 期望：右侧出现边缘最小化 tab（不是自动展开的 420px 面板）；点开后两轮问答都在；头部仍显示"截至第 N 条"。
3. 在抽屉里继续提问 → 正常流式返回（证明订阅与 `lastSeq` 接对了）。
4. 打开抽屉 → 关闭 → `F5`：**不应**出现恢复 tab（快照已清）。
5. 打开抽屉 → 「另存为会话」→ `F5`：侧栏该会话可见，且**不**出现旁问恢复 tab。
6. 打开抽屉 → 问一轮 → 在抽屉里提问后立刻 `F5`（run 仍在跑）：恢复后消息不重复（验证 `lastSeq` 而非 0）。
7. 停掉 daemon（副本随重启回收）→ 起回来 → 刷新：恢复 tab 出现后点开发送，应提示"服务端已回收"并允许重新提问。

---

## 9. 待审阅批注区

> 供其他 harness 逐条批注。每条给出「位置 / 批注 / 结论」，结论填 **采纳 / 驳回 / 改写**。

| # | 位置 | 批注 | 结论 |
|---|---|---|---|
| Q1 | §4.2 | 快照写入放 `pagehide` + 回合结束节流，是否足够？被系统杀进程时丢最后半句话能否接受，还是要按 500ms 定时写？ | 待定 |
| Q2 | §4.2 | "创建副本时的 source id"与 `sideAskSourceSessionId` 派生值不一致，是否说明抽屉跨会话时本身就有 bug（§4.6 只说"不在范围"）？ | 待定 |
| Q3 | §4.4 | 既然要 seed `realtimeMessages`，为什么不干脆用 `/messages` 回取 + 按锚点切掉 fork 前缀？若由**服务端**在 fork 完成后记录"继承了多少条"，这个切法是否反而更稳？（当前判断：新增列 + 迁移的成本高于收益） | 待定 |
| Q4 | §4.3 | 截断丢掉最旧轮次后，`BtwMessageList` 顶部是否需要"更早内容未恢复"的提示？不提示用户会以为旁问只剩这些 | 待定 |
| Q5 | §7.2 | 复制标签页的双所有权接受为已知缺陷，还是值得用 `BroadcastChannel` 做一次抢占？ | 待定 |
| Q6 | §4.5 | `handleSessionLost()` 清快照意味着"服务端回收后不再重试恢复"。若回收是误判（§17.14 的事故形态），是否有必要保留快照一轮？ | 待定 |
| Q7 | §5 | 改动集中在 `ChatInterface.tsx`（+55 行）。是否应该整体抽成 `useBtwRestore` hook，控制在 `hooks/` 里，即使它只被一个组件使用？ | 待定 |
| Q8 | D6 | 是否先上 `beforeunload`（5 行）作为过渡，等 A 落地再撤？ | 待定 |
