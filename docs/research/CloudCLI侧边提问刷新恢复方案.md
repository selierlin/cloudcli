# CloudCLI 侧边提问（btw）刷新恢复方案

> **文档性质**：实施方案，待评审。第 2 章是可核对的事实，第 3 章起是设计决定；标 **【建议】** 的段落欢迎推翻。
> **状态**：**未实施**。v2（2026-11-01）已吸收外部审阅 20 条（原文见 §10，逐条结论见 §10.3），其中 2 条推翻了 v1 的核心链路。仅前端改动，不改服务端、不改表结构。
> **关联文档**：
> - `docs/research/CloudCLI侧边提问btw功能方案.md`（btw 本体；§17.13/§17.14 记录了「刷新即放弃」与回收窗口的两次结论）
> - `docs/research/iOS冷启动会话恢复实施方案.md`（同为"重开后状态丢失"的另一处解法，可对照取舍）

---

## 决议清单

| # | 问题 | 结论 |
|---|---|---|
| D1 | 恢复通道 | **同标签页 sessionStorage 快照**。不做服务端 resume 端点、不做 URL 参数 |
| D2 | 恢复形态 | 恢复成**边缘最小化 tab**，不自动展开抽屉 |
| D3 | 快照体积 | **512 KB（按 UTF-16 `length` 计）**，超限按轮次边界丢最旧 → 剥工具/图片载荷 → 只留文本；`setItem` 必须 try/catch 降级 |
| D4 | 有效期 | 与标签页同生命周期，另加 **6 小时**上限 |
| D5 | 服务端 | **零改动**。schema、路由、仓储都不动 |
| D6 | `beforeunload` 拦截 | **不启用**：Chrome 需先有用户交互才可能弹、移动端拦不住，A 落地后只剩"偶尔弹一次"的困惑 |
| D7 | 恢复判定 | **状态机**（`idle → waiting → attempted`）：等鉴权就绪 + `selectedSession?.id` 非空 + socket 已连接，再尝试**一次**；成功后置 `attempted`，切回源会话不二次恢复 |
| D8 | 流式行 | 快照**保留** `stream_delta` 行作为当前可见文本，同时**seed 进 `streamBuffers`**；订阅 ack 报 idle 时 `finalizeStreaming` 收口（v1 漏了这条，会让正文回缩并定型成残缺版本） |
| D9 | 探测失败 | 只有 **404** 才清快照；5xx / 网络 / 401 一律视为"本次无法确认"，保留快照、本轮不恢复 |
| D10 | 代码落点 | 新增 `useBtwRestore` hook；`streamingBufferRegistry` 加 `seed`；`useSessionStore` 加批量 `seedSession`；`useBtwSession` 新增 `restore()` 并导出 `BtwAnchorInfo` |

---

## 1. 需求与边界

### 1.1 用户诉求

在侧边提问里问了几轮，误刷一下页面，这条旁问就没了——既不在侧栏，也没有任何入口能找回来（`CloudCLI侧边提问btw功能方案.md:1004` 记录了当时"这一轮不做恢复入口"的决定）。要的是：**刷新后这条旁问还在，能接着问**。

### 1.2 恢复的完整含义

| 要素 | 缺了会怎样 |
|---|---|
| 副本 session id | 抽屉空态；下一句还会重新 fork（上下文丢） |
| 已渲染消息 | 抽屉在，但一片空白 |
| 锚点信息（`anchorInfo`） | 头部从"截至第 N 条"退化成默认锚点；`refork` 会从**新会话**的最新回复重新剪枝 |
| 流式上下文（`lastSeq` + buffer 文本） | `lastSeq` 缺了：运行中的 run 会从缓冲起点重放，`stream_delta` 合成行被重建一遍，与快照里的半成品行互相覆盖；buffer 缺了：下一条 delta 会把快照的长文本**覆盖成只剩新到达的那几十字**，并在 `stream_end` 时定型（§2 F3/F4/F5） |

### 1.3 不做的范围

- 不跨标签页、不跨设备（§7.1）。
- 不恢复滚动位置、不恢复 composer 草稿。
- 不延长服务端回收窗口：副本仍按"重启全量回收 + 6 小时陈旧扫描"回收（`ephemeral-cleanup.service.ts:39-86`）。
- 不补拉"刷新窗口内跑完的那段续写"（§7.3）。

---

## 2. 现状事实（可核对）

**【事实】F1｜抽屉的全部状态都在 React `useState` 里，没有持久化。**
`sideAskOpen` / `sideAskAnchor` / `sideAskPermissionRequests` / `sideAskMinimized`（`ChatInterface.tsx:372-383`），副本 id 在 `useBtwSession` 的 `useState`（`useBtwSession.ts:92`）。`localStorage|sessionStorage` 在 `src/modules/chat` 下与 btw 无任何交集。

**【事实】F2｜抽屉只渲染内存 store，从不回取历史。**
`sideAskMessages` 直接读 `sessionStore.getMessages(btw.sessionId)`（`ChatInterface.tsx:428-430`），没有任何 `/messages` 请求。**所以"只恢复 id"必然得到空抽屉。**

**【事实】F3｜订阅回放只覆盖"仍在运行"的 run，且缓冲有上限。**
`handleChatSubscribe` 只在 `isProcessing` 时 `replayEvents(sessionId, lastSeq)`（`chat-websocket.service.ts:568-576`），取 `seq > afterSeq`（`chat-run-registry.service.ts:293-300`）；缓冲上限 `MAX_BUFFERED_EVENTS_PER_RUN = 5000`，超限 `splice` 掉最旧的（`:51,130-131`），`replayEvents` 的注释明确说"客户端应改走 REST 刷新"。已完成的轮次不重放。

**【事实】F4｜流式正文是固定 id 的合成行，`stream_end` 用 buffer 里的累积文本定型。**
`__streaming_${sessionId}` / `__streaming_thinking_${sessionId}`（`useSessionStore.ts:1129-1132`），`updateStreamingBatch` 按该 id **覆盖**内容（`:1119-1145`）；`stream_end → sealStreaming → finalizeStreaming`（`useChatRealtimeHandlers.ts:182-188,371-374`），`finalizeStreaming` 把合成行换成随机 id 的正式行（`useSessionStore.ts:1180-1225`）。

**【事实】F5｜`complete` 之后的 REST 补拉只对"正在看的会话"生效。**
`sid === activeViewSessionId` 才 `requestLatestMessages`（`useChatRealtimeHandlers.ts:475-476`）。旁问副本永远不是 `activeViewSessionId`（它是独立订阅的隐藏会话）→ **抽屉永远不会自我纠正**。

**【事实】F6｜副本是真会话，且服务端会回收它。**
`is_ephemeral` 行 + 真实 transcript（`btw.service.ts:116-147`）；重启全量回收、6 小时陈旧扫描（`ephemeral-cleanup.service.ts:39-86`）。恢复必须接受"有时恢复不了"。

**【事实】F7｜已有一条丢失自愈路径。**
`handleSessionLost()` 在 `SESSION_NOT_FOUND` 与 `session_deleted` 两条路径上把抽屉打回空态并提示（`useBtwSession.ts:324-334`、`useChatRealtimeHandlers.ts:262-271`）。恢复后的副本若已被扫掉，第一次发送/关闭就会落到这里。

**【事实】F8｜消息槽可按条 seed，但逐条写是 O(N²)。**
`appendRealtime` 每次 `recomputeMergedIfNeeded` + `notify`（`useSessionStore.ts:1060-1076`），上限 500（`:714`）；`getMessages` 返回 `merged`（`:1238-1240`）；`setObservedSession` 让非选中会话也能重绘（`:1277`）。

**【事实】F9｜`selectedSession` 首帧为 `null`，异步填充。**
`useState<ProjectSession | null>(null)`（`useProjectsState.ts:506`）；从项目载荷回填，或深链走 `api.sessionDetails` 查一次（`:1500-1545`）；`currentSessionId` 还要等 `useChatSessionState.ts:1362`。**"挂载后跑一次"必然在首帧落空。**

**【事实】F10｜`lastSeqRef` 记录所有会话的 seq，不只活跃会话。**
`handleEvent` 在派发前按 `msg.sessionId` 记录（`useChatRealtimeHandlers.ts:196-204`），无活跃会话过滤。所以旁问副本的 seq 是准的——**这是一条被审阅误判的事实，见 §10.3 W1②**。

**【事实】F11｜socket 未就绪时 `sendMessage` 静默丢弃。**
`readyState !== OPEN` 只 `console.warn`（`WebSocketContext.tsx:188-195`）。重连路径会重订阅副本（`ChatInterface.tsx:564-585`），但"恢复时 socket 还没开"仍可能让首订阅丢掉。

**【事实】F12｜待批准的工具请求在订阅 ack 时由服务端重新下发。**
`chat_subscribed` 的 `pendingPermissions` 对 `sideAskSessionIdRef` 有专门分支（`useChatRealtimeHandlers.ts:254-258`）。恢复只要发一次 `chat.subscribe`，权限弹窗白拿回来，不需要进快照。

---

## 3. 方案选型

| 方案 | 成本 | 主要风险 | 结论 |
|---|---|---|---|
| **A. sessionStorage 快照** | 前端 ~400 行（含测试），0 服务端 | 快照体积、流式行时序、标签页复制 | **采用** |
| B. 服务端 resume 端点 | 新路由 + 新列 + 迁移 + 归属模型，400+ 行 | ①fork 边界没落库，部分 provider 的 message id 每次读取重新合成，"从哪开始"只能靠猜；②没有 owner 概念，双标签共用副本（双写 + 互删）；③6 小时内的旧副本"诈尸"；④改 sessions 表会让本机 ~40 例无关 server 测试假失败（需先迁移 `~/.cloudcli/auth.db`） | 否决（两方审阅一致维持） |
| C. URL `?btw=<id>` | 中 | 污染历史记录；与"不接管返回键"的既有约束冲突（btw 方案 §6.2）；同样不解决消息重放 | 否决 |
| D. 刷新时自动 promote | ~15 行 | 每次带旁问刷新都在侧栏多一条 `(btw)` 会话，破坏"旁问永不可见"；移动端 keepalive 常常发不出去 | 否决 |
| F. `beforeunload` 拦一下 | 5 行 | 只是防误刷，不是恢复 | 见 D6：不启用 |

**为什么 A 够用**：抽屉天然是"单标签页里的一个副本"。`sessionStorage` 按标签隔离、活过刷新、标签页关闭即清——正好是这件事的正确作用域。

---

## 4. 设计

### 4.1 快照结构

单槽，key `cloudcli.btw.restore.v1`（抽屉在单标签页里只有一个，不按 source 分槽）。

```ts
type BtwSnapshot = {
  v: 1;
  /** 创建副本时用的来源会话 id（不是渲染期的派生值）。决定刷新后是否恢复。 */
  forkSourceSessionId: string;
  sessionId: string;
  /** 已收到的最高 seq；恢复时作为订阅参数，避免从缓冲起点重放。 */
  lastSeq: number;
  /** 供恢复后 `refork` 复用。注意：只对 `forkSourceSessionId` 有效。 */
  anchor: BtwAnchorRequest;
  anchorInfo: BtwAnchorInfo | null;
  minimized: boolean;
  /**
   * 已渲染的行，**包含** `stream_delta` 合成行：它承载"刷新那一刻正在生成的正文"，
   * 恢复时既用于首帧显示，也用于 seed `streamBuffers`（D8）。
   */
  messages: NormalizedMessage[];
  savedAt: number;
};
```

`BtwAnchorInfo` 目前是 `useBtwSession.ts:19` 的局部类型，需 `export type` 出去。

### 4.2 写入时机

- **主**：`pagehide`。刷新、关标签、前进后退都会触发，且此时不再有帧要处理。
- **辅**：`visibilitychange → hidden`（iOS 上 `pagehide` 不一定来）＋ 每次"助手回合结束"后节流写一次（1 秒）。覆盖"被系统直接杀进程"。
- **不**在每个 delta 上写。
- **写入路径必须全同步**：`hidden` 回调里禁止任何 `await`，`setItem` 必须当场完成（页面冻结竞态）。
- **必须 try/catch**：`QuotaExceededError` 时按 §4.3 再降一级重写；仍失败就只存"id + lastSeq + anchor"，放弃消息（首帧空态但能继续问）。
- **source 固化**：写入的是 `forkSourceSessionId`（创建副本那一刻的 `sideAskSourceSessionId`），不是渲染时的派生值。

### 4.3 截断规则（D3）

判定放在 `serialize()` 之后，但**裁剪对象是 `messages` 数组**（裁完重新序列化再判），三级：

1. 按**轮次边界**丢最旧的（回退到最近的 `role === 'user' && kind === 'text'` 行）；
2. 剥大载荷：`images[].data`（base64）、`toolResult.content` / `toolResult.toolUseResult`、`toolUseResult`、`subagentTools`、`workflow` —— 保留工具名与调用参数，工具卡退化为"结果未缓存"；
3. 只保留 `user`/`assistant` 的 `kind === 'text'` 行。

规则要**幂等**：同一份消息数组会被"回合结束节流写"和 `pagehide` 反复裁剪，第二次裁必须不变。找不到 user 边界（数组以 assistant 行开头）时就地作为边界，不丢整段。

512 KB 是**存储预算**不是数据上限；`sessionStorage` 同源约 5 MB，本方案自限 512 KB，为同标签页其他用途留量。

### 4.4 恢复流程（D7）

**状态机**：`idle → waiting → attempted`。`attempted` 之后本轮不再尝试（切走再切回也不恢复），避免"用户主动关掉后又被复活"。

前置条件（全部满足才 attempt）：

1. 快照合法：`v === 1`、JSON 可解析、`Date.now() - savedAt < 6h`；
2. 鉴权就绪（`useAuth().user` 非空）——401 不应被当成"副本没了"；
3. `selectedSession?.id === snapshot.forkSourceSessionId`；
4. socket 已连接（F11）；
5. `btw.sessionId === null`（不抢新一轮创建）。

探测 `await api.sessionDetails(snapshot.sessionId)`（`api.ts:311-312`）：

| 结果 | 处置 |
|---|---|
| 2xx | 继续恢复 |
| 404 / `SESSION_NOT_FOUND` | **清快照**，静默结束 |
| 5xx / 网络异常 / 401 | **保留快照**，本轮不恢复（置 `attempted`，避免抖动循环） |

注意：探测通过只说明行还在，不等于"还能用它发送"（`getSessionDetailsById` 不区分 `is_ephemeral`；副本也可能处在 quiesce 中）。真正不可用的信号由 F7 的自愈路径兜住。

恢复动作，**按序**：

```text
1. btw.restore({ sessionId, anchorInfo })      // 同步写 sessionIdRef + setSessionId
                                               // MUST: 抽屉正文与 ensureSession 都只看它
2. sessionStore.seedSession(id, messages)      // 批量：一次 merge + 一次 notify（F8）
3. lastSeqRef.current.set(id, snapshot.lastSeq)
4. streamBuffers.seed(id, streamingText, streamingThinking, provider)   // 仅当快照里有 stream_delta 行
5. sessionStore.setObservedSession(id, true)
6. sendMessage({ type:'chat.subscribe', sessions:[{ sessionId:id, lastSeq:snapshot.lastSeq }] })
7. setSideAskAnchor(snapshot.anchor); setSideAskOpen(true); setSideAskMinimized(true)
```

- 第 1 步必须在第 6 步之前：`sideAskSessionIdRef` 是 render 期从 `btw.sessionId` 赋值的，而 `chat_subscribed` 的 pendingPermissions / `SESSION_NOT_FOUND` 两个分支都读它（`useChatRealtimeHandlers.ts:254-258,268-271`）。ack 至少一个往返，实践中够，但顺序要显式保证。
- 第 4 步的语义：`seed(id, text, thinking, provider)` 建一个 buffer，`text/thinking` 与 `published*` 都置为给定值、`lastPublishedAt = null`。之后 `append` 拼的是"快照文本 + 新 delta"，`publishBuffer` 下发的是**全量**文本，`updateStreamingBatch` 覆盖出的仍是完整正文——这就是不缩水的机制。
- 订阅 ack 若报 `isProcessing === false`（run 在刷新窗口内已结束）：调用 `sessionStore.finalizeStreaming(id)` + `streamBuffers.drop(id)`，把快照里的半成品行收口成正式行。否则它会永远停在"生成中"。
- 待批准的工具请求不进快照（F12）。

### 4.5 清理时机

| 时刻 | 位置 |
|---|---|
| 关闭成功（`204` 或 `SESSION_NOT_FOUND`） | `useBtwSession.close()` 的 `discard()` 分支（`useBtwSession.ts:264-272`） |
| 转正成功 | `promote()`（`:287-309`）——副本已变成正式会话，恢复它会重复 |
| 服务端已回收 | `handleSessionLost()`（`:324-334`） |
| 重新 fork | `refork()` → `close()` 已覆盖 |
| 超龄 / 解析失败 / 探测 404 | 恢复入口处 |

**关闭失败（`closeFailure === 'still-running'`）不清快照**：`close()` 此时返回 `false` 且不 `discard()`（`useBtwSession.ts:274-282`），副本仍在跑，用户可能马上重试关闭。实现时不要把 `clearBtwSnapshot()` 挂在 `close()` 的 `finally` 里。

### 4.6 与既有机制的交互

- **服务端回收**：恢复 → 发送 → `SESSION_NOT_FOUND` → `handleSessionLost()` 打回空态（F7）。不新增分支。
- **promote 后刷新**：快照已清，不会把已转正的会话再当旁问恢复。
- **复制标签页**：`sessionStorage` 会被一起复制，两个标签可能指向同一副本。一方关闭会删掉副本，另一方落到 `handleSessionLost` 自愈（§7.2）。
- **抽屉开着切主会话**：`refork()` 时若带显式锚点，服务端在新会话里找不到锚点 → `BTW_ANCHOR_INVALID` 400（`btw.service.ts:194-207`）；只有 `anchor === null` 的默认路径会从**新会话**最新回复静默剪枝（`:225-243`）。本方案不修这个既有边界（§10.3 C6）。
- **run 缓冲截断**（F3）：超长 run（>5000 事件）的增量可能顶掉缓冲，`lastSeq` 与缓冲起点之间缺帧且不会重放。本方案**只记录不修复**（§7.4）。

### 4.7 不做的事

- 不把快照写进 `localStorage`（跨标签、跨天诈尸）。
- 不新增服务端查询接口。
- 不恢复滚动位置、输入框草稿。
- 不为 whole-segment provider（codex/dsh 等）的 `revealPacer` 做 seed：它们的文本整段到达，刷新若发生在揭示中途，尾部会丢一小段（§7.5）。

---

## 5. 改动清单

| 文件 | 改动 | 估计 |
|---|---|---|
| `src/modules/chat/utils/btwSnapshot.ts` | **新增**。`BtwSnapshot` 类型、`readBtwSnapshot` / `writeBtwSnapshot` / `clearBtwSnapshot`、`trimBtwSnapshotMessages`（三级 + 幂等）、`extractStreamingSeed`、`SESSION_STORAGE_KEY`。纯函数，可单测 | +150 |
| `src/modules/chat/hooks/useBtwRestore.ts` | **新增**（D10）。状态机、前置条件、探测、§4.4 的 1–7 步、`pagehide`/`visibilitychange` 写出、ack idle 时的收口回调 | +130 |
| `src/modules/chat/utils/streamingBufferRegistry.ts` | `seed(sessionId, text, thinking, provider)`：建 buffer 且 `published*` 同步置位，不触发首帧重发 | +25 |
| `src/modules/chat/hooks/useSessionStore.ts` | `seedSession(sessionId, messages)`：一次 `recomputeMergedIfNeeded` + 一次 `notify`，复用 500 条上限 | +30 |
| `src/modules/chat/hooks/useBtwSession.ts` | 新增 `restore({ sessionId, anchorInfo })`（同步写 ref + state）；三个出口调 `clearBtwSnapshot()`；`export type BtwAnchorInfo` | +40 |
| `src/modules/chat/ChatInterface.tsx` | 接 `useBtwRestore`（传入 `sessionStore` / `lastSeqRef` / `streamBuffers` / `btw` / `sendMessage` / `selectedSession?.id`）；应用 `open/minimized/anchor`；保存 `forkSourceSessionId`；ack idle 的收口回调 | +35 |
| `src/modules/chat/tests/btwSnapshot.test.ts` | **新增**（§6 A 组） | +120 |
| `src/modules/chat/tests/btwRestore.test.tsx` | **新增**（§6 B 组） | +180 |
| `src/modules/chat/tests/streamingBufferSeed.test.ts` | **新增**（§6 C 组） | +50 |

服务端零改动 → **不需要** `npm run build:server`、不需要重启 daemon；只需 `npm run build:client`。

---

## 6. 测试计划

**A. `btwSnapshot.test.ts`（纯函数）**

1. 正常往返：写入 → 读出，字段等价（含 `anchorInfo`、`lastSeq`、`stream_delta` 行）。
2. 版本不符 / JSON 破损 / 超 6 小时 → 返回 `null` 且不抛错。
3. 一级截断按轮次边界：200 条超预算 → 首条是 `user` 文本行，尾部完整。
4. 二级截断：`images[].data` / `toolResult.toolUseResult` / `subagentTools` 被剥，工具名/参数仍在。
5. 三级截断与幂等：连续裁两次结果相同；数组以 assistant 开头时不丢整段。
6. `QuotaExceededError`：`setItem` 抛错 → 降级只存元信息，不冒泡。

**B. `btwRestore.test.tsx`（hook，沿用 `btwSession.test.tsx` 的 mock 手法）**

7. 恢复后 store 有快照消息，`chat.subscribe` 的 `lastSeq` 等于快照值（不是 0）。
8. 恢复后 `minimized = true`，`anchorInfo` 回到头部标签。
9. **`selectedSession` 首帧为 null、第二帧才赋值 → 仍能恢复**（F9 回归守卫）。
10. `forkSourceSessionId` 不匹配 → 不恢复、不订阅、快照保留。
11. 探测 404 → 不恢复 + 清快照 + 不订阅；探测 500/网络异常 → 保留快照且不恢复。
12. socket 未连接时不 attempt；连接就绪后由状态机发起恢复（重连路径 `ChatInterface.tsx:564-585` 作为二次兜底）。
13. `close()` 成功 / `promote()` 成功 / `handleSessionLost()` → 快照清空，且后者不发 DELETE。
14. `BTW_STILL_RUNNING` 关闭失败 → 快照**保留**。
15. 恢复后副本被回收：发送 → `SESSION_NOT_FOUND` → 抽屉回空态（与 `btwSessionReclaimed.test.tsx` 断言一致）。

**C. `streamingBufferSeed.test.ts`**

16. seed 后不产生首帧 publish；append 一个 delta 后 `flush` 收到的是"快照文本 + delta"的全量。
17. seed 后 `has(id) === true`，`drop` 后为 false。

**D. 手工（真机）**：见 §8。

**现有测试影响**：`btwSession.test.tsx` / `btwDrawerCollapse.test.tsx` / `btwSessionReclaimed.test.tsx` 不涉及快照，预期不需改；若 `useBtwSession` 返回类型扩展导致类型报错，补最小改动即可。

---

## 7. 风险与取舍

### 7.1 不跨标签 / 不跨设备（有意）

跨标签恢复必须引入归属协议（谁是副本主人、谁能删），这正是 B 被否的原因。按标签页作用域，两个标签各自 fork 各自的副本，与今天一致。

### 7.2 复制标签页（接受）

复制标签会连 `sessionStorage` 一起复制，两个标签可能都认为自己拥有同一条副本。后果有界：一边关闭删掉副本，另一边落到 `handleSessionLost`。**不引入 `BroadcastChannel` 抢占**。

### 7.3 "刷新窗口内跑完的续写"不补拉（接受）

若刷新发生在流式中途、而 run 在页面重载期间结束：服务端 transcript 是完整的（F6），但客户端只会显示快照那一刻的文本，并且 ack 报 idle 时会被 `finalizeStreaming` 收口成**一条不完整的正式消息**。抽屉不会自我纠正（F2 + F5），**这个抽屉生命周期内都不会补齐**——只有关闭重开或再次刷新才有机会看到全文。这是本方案最明显的正确性缺口，明确豁免。

### 7.4 超长 run 的缓冲截断（记录不修复）

`MAX_BUFFERED_EVENTS_PER_RUN = 5000` 被顶掉时，`lastSeq` 与缓冲起点之间缺帧，重放补不上。检测手段是比对 ack 的 `run.lastSeq`（`chat-websocket.service.ts:563`）与"重放事件的最小 seq"——本方案不做自动修复（要么 REST 补拉、要么清快照重 fork，代价都不止几行），只在实现里 `console.warn` 留痕。

### 7.5 whole-segment provider 的揭示尾部（接受）

codex / dsh 这类整段到达、由 `revealPacer` 播放的 provider，刷新若发生在揭示中途，快照只含已揭示部分；run 结束后也不会重放。丢失量以一次揭示动画为上限。

### 7.6 快照体积与隐私

`sessionStorage` 同源约 5 MB，本方案自限 512 KB。旁问内容以明文停留在这个标签页的会话存储里——与主会话消息同级别暴露面（都不落 `localStorage`）。退登不主动清理，标签页关闭即消失。

### 7.7 iOS 无 `pagehide`（部分覆盖）

靠 `visibilitychange` + 回合结束节流写兜住；最坏丢最后一次写入之后的内容。

---

## 8. 验收（真机）

前置：前端由服务端下发，**必须 `npm run build:client` 后刷新**，否则验的是旧包。端口陷阱见 `AGENTS.md`（nginx `127.0.0.1:3012` 代理 daemon `3011`，`lsof` 确认监听者是自己起的进程）。

1. 打开会话 → 开抽屉 → 问两轮 → `F5`。
   期望：右侧出现边缘最小化 tab；点开后两轮问答都在；头部仍是"截至第 N 条"。
2. 在抽屉里继续提问 → 正常流式返回（证明订阅与 `lastSeq` 接对了）。
3. 开抽屉 → 关闭 → `F5`：**不应**出现恢复 tab（快照已清）。
4. 开抽屉 → 「另存为会话」→ `F5`：侧栏该会话可见，且**不**出现旁问恢复 tab。
5. **流式中途刷新**：问一轮，等正文生成到一半（记下字数）→ `F5` → 恢复后正文**不缩水**；继续流式到结束，定型文案包含刷新前那段（D8 的核心断言）。
6. **run 在刷新窗口内结束**：`stream_end` 之后、`complete` 之前 `F5` → 恢复后不会卡在"生成中"；正文允许缺尾（§7.3 豁免）。
7. 停掉 daemon（副本随重启回收）→ 起回来 → 刷新：恢复 tab 出现后点开发送，应提示"服务端已回收"并允许重新提问。
8. 深链冷启动：新标签页打开 `/session/<id>`（无 `sessionStorage`）→ 不出现恢复 tab；同页再 `F5` → 正常恢复（验证状态机不依赖首帧）。

---

## 9. 待议项（已随审阅收敛）

| # | 议题 | 结论 |
|---|---|---|
| Q1 | 写入频率：500 ms 定时写？ | **否**。`pagehide + visibilitychange + 回合结束节流` 足够，另加 `QuotaExceededError` 降级 |
| Q2 | "创建时 source id"与派生值口径不一致 | **改写为既有边界**：真实症状是 `refork` 会 400 或从新会话剪枝（§4.6），本方案只固化 id、不修该边界 |
| Q3 | 是否改用 `/messages` + 服务端记录 fork 继承条数 | **维持否决 B**。但必须先解决 §4.4 的流式 seed，否则"快照 + 重放"本身就是新的切片问题 |
| Q4 | 截断后是否提示"更早内容未恢复" | **需要**，但不用 banner：列表顶部一条可折叠的"仅恢复最近 N 轮"，i18n key 与实现同批加 |
| Q5 | 复制标签页是否需要 `BroadcastChannel` 抢占 | **否**，写明接受 |
| Q6 | 回收后是否保留快照一轮 | **否**，维持清快照：复活一条服务端已判定死亡的副本，成本高于让用户重问 |
| Q7 | 是否抽 `useBtwRestore` | **是**（D10）。理由不是复用，是依赖收敛与可测 |
| Q8 | 是否先上 `beforeunload` | **否**（D6） |

---

## 10. 审阅批注

> 以下为外部审阅原文，逐条结论见 §10.3。

### 10.1 Claude

> [!CAUTION]
> **§4.4 的「挂载后执行一次」会让恢复在主路径上永不命中。** `selectedSession` 的初值是 `null`（`useProjectsState.ts:506`），无论刷新还是深链都在 projects 载荷/`api.sessionDetails` 返回后才被赋值（`useProjectsState.ts:1500-1540`），`currentSessionId` 更要等到 `useChatSessionState.ts:1362` 才写入。条件 2（`selectedSession?.id === snapshot.sourceSessionId`）在首帧必然为假，而 effect 只跑一次 → 快照被留在 storage 里、抽屉永远不出现，§8 的真机验收也过不了。建议把恢复判定改成「等 `selectedSession?.id` 非空后尝试一次」的状态机（`idle → waiting → attempted`），attempt 后置位，避免用户切回源会话时二次恢复。

> [!CAUTION]
> **快照会带着 `stream_delta` 合成行，和订阅回放在同一条行上打架。** 流式期间正文以固定 id `__streaming_${sessionId}` 落在 `realtimeMessages`（`useSessionStore.ts:1122-1140`，`kind:'stream_delta'`），而刷新后重放的 delta 走的是一个**空** buffer（`useChatRealtimeHandlers.ts:360-369`），`updateStreamingBatch` 会按同一个 id **覆盖**快照里的那段文本。复现：流到 300 字 → 刷新 → 恢复 → 下一条 delta 到达，界面正文从 300 字塌缩成"刷新后那几十字"，`stream_end` 时 `finalizeStreaming`（`:182-188`）把残缺版本定型，服务端全文又不会被回取（F2）→ 永久丢字。更糟的分支：run 在刷新期间结束，`chat.subscribe` 不再重放（F3），快照里的 `__streaming_*` 行永远不会被 finalize，抽屉会一直显示"生成中"。建议序列化时直接排除 `kind === 'stream_delta'` 的行；若想覆盖"刷新时仍在跑、并且不丢刷新前那段文本"，需要给 `streamBuffers` 加"以快照文本为初值"的 seed 入口，并把 §8.6 的断言从"消息不重复"改成"刷新前后正文不缩水"。

> [!IMPORTANT]
> **§4.4/§5 的 `restore()` 步骤没写最关键的副作用：写回 `sessionId`。** 抽屉的正文完全来自 `btw.sessionId ? sessionStore.getMessages(btw.sessionId) : EMPTY`（`ChatInterface.tsx:427-430`），而 `ensureSession` 也只看 `sessionIdRef.current`（`useBtwSession.ts:132-138`）。若 `restore()` 只 seed store、写 `lastSeqRef`、订阅，却没有 `sessionIdRef.current = snapshot.sessionId` 与 `setSessionId(...)`，界面仍是空抽屉，用户下一句话还会重新 fork 一条副本（并且旧快照/旧 id 的心智模型彻底错乱）。请把这两个赋值写进 §5 的 `restore()` 清单，并把它列为 §6 的必测项。

> [!IMPORTANT]
> **§4.3 的截断规则按现有 `NormalizedMessage` 结构收不住体积。** 大载荷不止 `toolResult`：`images[].data`（base64 图片）、`toolUseResult`、`subagentTools`、`workflow/agents` 都可能远超 512 KB（`src/shared/types.ts:733-772`），只剥 `toolResult` 会出现"二级截断做完仍超限、三级一下砍没"的跳变。另外两点需补：①"512 KB"要明确是 `json.length`（UTF-16）还是 UTF-8 字节数——浏览器 quota 一般按 UTF-16 计，两者对中文差一倍；②`sessionStorage.setItem` 会抛 `QuotaExceededError`，`pagehide` 里必须 try/catch 并降级再裁，不能把异常抛到卸载路径上。还应定义"裁完仍找不到 `role==='user' && kind==='text'` 边界"时的行为（恢复后的二次快照完全可能从一条 assistant 行开头）。

> [!IMPORTANT]
> **§4.4 条件 4 只覆盖了 2xx 与 404。** `sessionDetails` 的 5xx、网络异常、代理超时、鉴权失效都没有处置说明。建议：只有 `SESSION_NOT_FOUND`(/404) 才清快照；其余失败一律视为"本次无法确认"，保留快照且不恢复（不删除），否则一次代理抖动就永久毁掉恢复机会。同时注意 `getSessionDetailsById` 不区分 `is_ephemeral`（`sessions.service.ts:969-1005`），探测能通过是对的，但这也意味着探测成功并不等于"副本还能被 fork/发送"——不必因此加逻辑，写进文档即可。

> [!WARNING]
> **Q2 描述的现象和代码不完全一致，结论要改写。** 抽屉开着切会话后 `refork()`：若快照/抽屉带显式锚点，服务端 `resolveBtwAnchor` 在新会话里找不到该锚点会抛 `BTW_ANCHOR_INVALID`（400，`btw.service.ts:194-207`），是**报错**而不是"悄悄放宽上下文"；只有 `sideAskAnchor === null` 的默认锚点路径，才会从**新会话**的最新回复静默 fork（`:225-243`）。§4.2 固化"创建时的 source id"是对的，建议顺手把创建时的 id 存成 `forkSourceSessionId`，并在 source 变化后禁用 `refork`/「另存为会话」（或先关抽屉），否则快照里的 `anchor` 也仍然指向旧会话。另外恢复判定用的是 `selectedSession?.id`，创建时用的是 `currentSessionId || selectedSession?.id`（`ChatInterface.tsx:389`），两处口径建议统一。

> [!WARNING]
> **类型与签名上的实现缺口。** `BtwAnchorInfo` 是 `useBtwSession.ts:19` 的**局部**类型、未导出，`btwSnapshot.ts` 要引用它必须导出（或把快照类型搬到 `shared`）。`lastSeqRef` 若做成"可选入参"，默认值只能是 `null`，而恢复路径**必须**拿到真实的 ref——§6 里"入参变化导致类型报错，补一个默认值即可"不成立，默认值会让恢复静默失效。

> [!NOTE]
> **§1.2 对"lastSeq 从 0 → 整段重放 → 消息重复"的表述不够准确。** `appendRealtime` 按 id upsert（`useSessionStore.ts:1060-1075`），普通消息重放是幂等的；真正的重复/错乱集中在 `stream_delta` 合成行与 `finalizeStreaming` 生成的随机 id 行（见上一条 CAUTION）。建议改写成"重放会把流式合成行重建一遍，与快照里的半成品行冲突"，避免读者以为"必须持久化 seq 才能防重复"。

> [!NOTE]
> **§7.3 的"暂时看不到"实际是"这个抽屉生命周期内永久看不到"。** 已完成轮次既不重放（F3）、抽屉也不回取历史（F2），"卸载后 run 继续跑完"的那一段只有再次刷新/关闭重开才有机会出现。建议把措辞改准，或在 §4.6 补一句"接受：刷新窗口内完成的续写不再补拉"。

> [!NOTE]
> **§5 改动清单漏了 `src/modules/chat/tests/btwSnapshot.test.ts`**（§6 里列了）。另外 `+55` 行的 `ChatInterface.tsx` 估得偏乐观：pagehide/visibilitychange 两个监听、ref 同步、source 固化、恢复状态机、失败分支都要落在这个已超 1000 行的组件里，实际更像 +80～100。文件行数不是验收标准，但预算失真会挤压测试时间。

> [!TIP]
> **对 §9 待议项的意见（供牵头汇总，不构成结论）：**
> - Q1：500ms 定时写不划算；`pagehide + visibilitychange + 回合结束` 足够（正是本方案），但要补 `QuotaExceededError` 降级。
> - Q3：维持否决 B 的判断（新增列 + 迁移 + 归属模型 > 收益）；服务端 fork 前缀切片对"每次读取重新合成 id"的 provider 确实不可靠。但采用 A 之前必须先解决上面第 2 条 CAUTION，否则"seed + 重放"本身就是新的切片问题。
> - Q4：需要提示，但别在列表顶部放大 banner；一条可折叠的"仅恢复最近 N 轮"即可，i18n key 要与实现同批加。
> - Q5：不引入 `BroadcastChannel` 合理；复制标签是低频动作，且另一边会落到 `handleSessionLost` 自愈，写明即可。
> - Q6：维持"`handleSessionLost` 清快照"。保留一轮只会复活一条已被服务端判定死亡的副本，误判场景下用户重问的成本更低。
> - Q7：建议抽 `useBtwRestore`，理由不是复用而是**依赖收敛与可测**——两个生命周期监听、`lastSeqRef`、source 固化、恢复状态机留在 `ChatInterface.tsx` 里很难保证 effect 依赖正确，也难按 §6 的方式直接测。
> - Q8：同意 D6。`beforeunload` 在 Chrome 需用户交互后才生效、移动端基本拦不住，作为过渡只会制造"偶尔弹一次"的困惑。

> [!TIP]
> **恢复时的 seed 开销。** 500 条消息逐条 `appendRealtime` 每次都会 `recomputeMergedIfNeeded` + `notify`（`useSessionStore.ts:1060-1078`），合并计算是 O(N²)。React 18 会把重渲染批掉，但合并本身不会；建议加一个"批量 seed"入口（一次合并、一次 notify），或在 `restore()` 里先写 `realtimeMessages` 再统一 notify。抖动会出现在最不该有抖动的时候——刷新后第一帧。

> [!TIP]
> **订阅与渲染的顺序（低风险，建议写进实现注意事项）。** `restore()` 里 `chat.subscribe` 发出后，`chat_subscribed` 的 pendingPermissions 分支和 `SESSION_NOT_FOUND` 分支都依赖 `sideAskSessionIdRef.current`（`useChatRealtimeHandlers.ts:254-258`、`:268-271`），而它是在 render 时从 `btw.sessionId` 赋值的。先 `setSessionId` 再发订阅，让 render 先落地；虽然订阅 ack 至少要一个网络往返，实践中大概率安全，但恢复路径是"一条快照对应一个 id"，值得显式保证而不是依赖时序。

### 10.2 WorkBuddy · `01a1951c-62da-706c-8624-7b934340b26b`

> [!CAUTION]
> **F3 的引用让"快照 seq 之后丢帧"成为盲区，且现有 `lastSeqRef` 不会记录旁问的 seq。** ①方案的恢复链路是"快照消息 + 以 `snapshot.lastSeq` 订阅"，这只在"服务端缓冲仍覆盖 `lastSeq` 之后所有帧"时无缝。`chat-run-registry.service.ts` 的缓冲上限是 `MAX_BUFFERED_EVENTS_PER_RUN = 5000`（`chat-run-registry.service.ts:51`、`:130-131`），超限会 `splice` 掉最旧的；`replayEvents` 的文档（`:290-291`）明确写了"缓冲截断时客户端应走 REST 刷新"。恢复后若一个超长 run 的增量把缓冲顶掉，`lastSeq` 到缓冲起点之间的帧**既不在快照、也不会重放**，抽屉正文静默缺一段。建议：`chat_subscribed` 的 ack 里有服务端 `run.lastSeq`（`chat-websocket.service.ts:558`），恢复路径上对比 `ack.lastSeq > 客户端已收到的最高行 seq` 时降级走一次 REST 补拉或清快照重 fork，并在文档承认这个边界。②此外 `lastSeqRef` 只由主会话的事件处理器更新（`useChatRealtimeHandlers.ts:198`），旁问行的 seq 是否也进了这张 map 需要核对——若没有，`writeBtwSnapshot` 从 `lastSeqRef.current.get(btw.sessionId)` 读到的永远是 `undefined`，快照 seq 恒为 0，方案里"用快照 seq 订阅"的前提直接落空。这是实现前必须确认的第一优先级事实。

> [!WARNING]
> **§4.4 的"挂载后执行一次"与 `btw.sessionId` 为空的判据在时序上不够，刷新时 run 可能已经结束。** 若刷新发生在 `stream_end` 之后、快照里已含 finalize 后的完整行，问题不大；但若快照落在流式中途而刷新时 run 已跑完，服务端副本 transcript 是完整的（F4），抽屉却只会显示快照那一刻的半截正文，且 F3 保证不会重放补齐——§7.3 已承认这一点，但 §8 验收第 6 条只测了"run 仍在跑"，建议补一条"刷新时 run 恰好刚结束"的用例，把"永久显示半截"这个最容易被用户当成 bug 的形态纳入验收或明确豁免。

> [!WARNING]
> **`sendMessage` 在断线时是静默丢弃，恢复链路要考虑 socket 未就绪。** `WebSocketContext.tsx:188-195`：`readyState !== OPEN` 时只 `console.warn('WebSocket not connected')`。刷新后恢复 effect 与 ws 重连赛跑，慢一步 `chat.subscribe` 就发不出去——结果是没有订阅、没有回放、也没有 pendingPermissions，且没有任何重试。建议 `restore()` 前检查 `connectionStatus === 'connected'`（或把订阅挂到重连后的恢复逻辑上），否则"恢复成功但再无流式更新"会是一个难解释的现场。

> [!IMPORTANT]
> **`restore()` 依赖 `sessionStore` 与 `api.sessionDetails`，但二者在挂载后的可用性时序未写。** 若恢复 effect 放在 `ChatInterface` 挂载时，而 `sessionDetails` 的探测早于鉴权载荷就绪（token 恢复是异步的），401/403 会被当成失败分支处理——结合 Claude 批注对 404 之外的处置建议（保留快照、不恢复），这条自然被覆盖；但请把"鉴权未就绪不做探测"显式写进 §4.4 的前置条件，避免实现时把 401 也归入"清快照"。

> [!IMPORTANT]
> **截断的落点建议改为"写之前裁消息数组"，而不是"序列化后裁字符串"。** §4.3 的三级截断对"轮次边界"的判定依赖遍历消息行，若实现为对 JSON 字符串截断再回读会破坏结构。建议把 512 KB 判定放在 `serialize()` 之后、但裁剪对象是 `messages` 数组（裁完重新序列化再判），并如 Claude 批注所说明确按 UTF-16 `length` 计；同时 `trimBtwSnapshotMessages` 的三级规则要保证幂等（对已裁剪的快照再裁一次结果不变），因为"回合结束节流写 + pagehide 写"会在同一会话里对同一份消息数组反复执行。

> [!NOTE]
> **§4.5 清理表缺一行：`BTW_STILL_RUNNING` 关闭失败。** `close()` 在 `closeFailure = 'still-running'` 时返回 `false` 且**不** `discard()`（`useBtwSession.ts:280-282`）——副本仍在跑，快照理应保留（用户可能稍后重试关闭）。这恰好是对的，但文档应显式写明"关闭失败不清快照"，否则实现者容易把 `clearBtwSnapshot()` 挂在 `close()` 的 finally 里，把"还在跑的副本"的快照也清掉。

> [!NOTE]
> **`visibilitychange → hidden` 写快照会与 iOS Safari 的页面冻结竞态，但不影响正确性，只需接受。** `hidden` 回调里同步 `JSON.stringify` 512 KB 在现代手机上 <10ms，风险可控；真正要避免的是在 hidden 回调里做任何 `await`——`setItem` 必须同步完成。建议在 §4.2 写明"写入路径禁止异步"，防止实现者顺手用 `navigator.storage.persist` 之类的异步 API。

> [!TIP]
> **对 §9 待议项的意见（供牵头汇总）：**
> - Q2：Claude 批注的改写方向正确；补充一点——若按其建议在 source 变化后禁用 `refork`，`anchorRef`（`useBtwSession.ts:98-100`）固化的是 prop 初值，禁用逻辑要放在 `ChatInterface` 层做，不要试图改 hook 内部。
> - Q7：同意抽 `useBtwRestore`；§5 的行数预算里 `ChatInterface.tsx` 的 +55 需要相应下调，把状态机与监听都挪进 hook。

### 10.3 牵头结论（逐条）

| # | 审阅项 | 结论 | 落点 |
|---|---|---|---|
| C1 | 挂载后只跑一次永不命中 | **采纳** | D7、§4.4 状态机、§6-9 |
| C2 | `stream_delta` 行与回放互相覆盖 | **采纳**（本轮唯一推翻主链路的意见） | D8、§4.4 第 4 步、registry `seed`、§6-16/17、§8-5 |
| C3 | `restore()` 漏写 `sessionId` | **采纳** | §4.4 第 1 步、§6-7 |
| C4 | 截断收不住体积 + UTF-16 + Quota + 空边界 | **采纳** | D3、§4.3、§6-2/4/5/6 |
| C5 | 探测 2xx/404 之外的处置 | **采纳** | D9、§4.4 探测表、§6-11 |
| C6 | Q2 现象与代码不符（400 而非静默放宽） | **改写** | §4.6、§9 Q2 |
| C7 | `BtwAnchorInfo` 未导出、`lastSeqRef` 不能给默认值 | **采纳** | D10、§5 |
| C8 | `lastSeq` 与"消息重复"的表述不准 | **采纳** | §1.2 表格 |
| C9 | §7.3 措辞（永久而非暂时） | **采纳** | §7.3 |
| C10 | 清单漏测试文件、行数预算偏低 | **采纳**（预算按 hook 拆分后重估） | §5 |
| C11 | seed 逐条写是 O(N²) | **采纳** | D10、§4.4 第 2 步、store `seedSession` |
| C12 | 订阅与 render 的顺序 | **采纳** | §4.4 第 1/6 步的顺序说明 |
| W1① | 缓冲 5000 上限导致缺帧 | **部分采纳**（记录不修复） | §7.4 |
| W1② | "`lastSeqRef` 不记录旁问 seq" | **驳回（事实错误）** | §2 F10：`useChatRealtimeHandlers.ts:196-204` 在派发前按 `msg.sessionId` 记录，无活跃会话过滤 |
| W2 | run 在刷新窗口内结束 → 永久半截 | **采纳**（明确豁免 + 验收） | §7.3、§8-6 |
| W3 | socket 未就绪时 `sendMessage` 静默丢弃 | **采纳** | D7 前置条件 4、§6-12 |
| W4 | 鉴权未就绪不做探测 | **采纳** | D7 前置条件 2、§4.4 |
| W5 | 截断应裁数组、幂等 | **采纳** | §4.3 |
| W6 | `BTW_STILL_RUNNING` 不清快照 | **采纳** | §4.5 末段、§6-14 |
| W7 | `hidden` 回调禁止异步 | **采纳** | §4.2 |

**唯一未采纳的是 W1②**，且它不改变任何设计选择：快照 `lastSeq` 的来源是可靠的；D8 的 seed 仍然必需，但理由变成"空 buffer 会把正文覆盖成尾部"，不是"seq 恒为 0"。
