# CloudCLI 流式输出体验优化技术方案

> 状态：功能改造与自动化验证已完成，待桌面/iOS 性能验收
> 日期：2026-09-12
> 范围：前端流式提交节奏、流式期间的聊天区跟底；不修改 Provider 协议和服务端事件格式
> 关联文档：`docs/architecture/02-realtime-stream.md`、`docs/architecture/05-scrolling.md`

## 0. 结论先行

本方案选择：**帧对齐的“最新状态提交”（latest-state commit）**。

- 不做逐字打字机动画，不虚构模型尚未产生的输出节奏。
- 保留每个会话、每个通道的完整累计文本；前台收到 delta 后在下一次合格的动画帧发布最新累计值。
- 当前 Provider 在服务端已按 50ms 合并，前台持续高速输出时实际约 20 次/秒提交；前端另设约 30 次/秒的防御上限，低速输出只在真实 delta 到来后提交，不会空转。
- `stream_end` / `complete` 仍同步 `flushNow`，不等待动画播放完毕。
- 动画帧不可用但 timer 仍获调度时，由标称 100ms watchdog 兜底；浏览器后台节流或主线程阻塞期间不承诺墙钟时间上限。
- 只发布发生变化的 `text` / `thinking` 通道，避免正文阶段重复写入已经停止变化的思考通道。
- 同一帧的 dirty 通道通过一次 store 事务原子更新，只做一次 `computeMerged` 和一次 `notify`。
- 当前可见会话走帧对齐发布；不可见会话降至最高 5Hz 的后台发布，切换为可见时同步收敛最新累计值，避免并发流把不可见 merge 成本线性放大。
- 流式跟底改为单个、可取消、执行前重新确认用户意图的 `requestAnimationFrame` 写入；不使用平滑滚动。
- 初始 settle 循环同样服从用户滚动意图；所有 `isUserScrolledUp` 写入统一同步更新 ref 和 state。

这不是“把 100ms 常量改小”的单点修改。提高提交频率会放大现有滚动定时器和重复通道写入，因此流式 registry、跟底调度和对应测试必须作为一个完整变更发布。

## 1. 背景与已确认现状

### 1.1 当前链路

```text
Provider token delta
  → 服务端 createDeltaBatcher（50ms 或累计 2048 字符时提前发布）
  → WebSocket NormalizedMessage(stream_delta)
  → useChatRealtimeHandlers
  → streamingBufferRegistry（按 session 累计，100ms 定时发布完整字符串）
  → useSessionStore.updateStreaming（替换固定 id 的同一行）
  → normalizedToChatMessages
  → StreamingMarkdown（settled 前缀 + pending 尾块）
  → useChatSessionState（消息数组变化后延迟 50ms 跟底）
```

### 1.2 已有优点，必须保留

1. `stream_delta` 不直接逐帧写 store，而是按会话缓冲。
2. 正文和思考是两个独立通道，最终形成两个稳定行。
3. `stream_end` 和缺少 `stream_end` 的 `complete` 都能同步收尾。
4. 流式行原地替换，行数不会随 token 数增长。
5. `StreamingMarkdown` 只频繁解析未完成尾块，已完成前缀由 memo 保持。
6. 流式结束前后使用同一组件，避免整条回复 DOM 重挂。
7. 用户上滑后不会被已有的延迟跟底强制拉回。
8. 多会话缓冲互相隔离。

### 1.3 当前体验瓶颈

| 问题 | 当前机制 | 用户可感知结果 |
| --- | --- | --- |
| 固定 10Hz 提交 | 首个 delta 启动 100ms timer，窗口内只累计 | 模型越快，每次出现的文字块越大 |
| 服务端、前端双重合并 | 服务端已经按 50ms/2048 字符合并，前端又固定等待最多 100ms | 原始 token 到可见内容通常经过两层等待，服务端约 20Hz 的输出被前端压到约 10Hz |
| 提交未与绘制帧对齐 | `setTimeout` 到点直接写 store | 更新可能落在一帧中间，随后又触发布局和滚动 |
| 通道重复发布 | `flushBuffer` 每次发布所有非空通道 | thinking 停止、text 开始后，旧 thinking 仍可能被重复写 store |
| 跟底也是延迟任务 | 每次 `chatMessages` 变化后再等 50ms | 内容先长高，视口随后跳到底；提高刷新率后会出现多个待执行 timer |
| Markdown 尾块仍有成本 | 每次发布都扫描完整文本找安全边界，并解析 pending 块 | 不能无条件提升到 60Hz |

## 2. 目标、指标与非目标

### 2.1 产品目标

1. 高速模型输出时，正文由约 10Hz 的成块跳变改善为跟随服务端批次的约 15–20Hz 增长；本轮不提高服务端事件频率。
2. 不牺牲首字时间和完成时间；UI 不得排队播放已经生成完的内容。
3. 流式增长与跟底尽量在同一绘制节奏内完成，减少“文字先跳、页面后跳”。
4. 用户一旦离开底部，任何已排队的自动跟底都不得夺回滚动位置。
5. 桌面端与 iOS/H5 后台切换、会话切换、工具调用、思考转正文保持正确。
6. 多会话并发流式时，不让不可见会话按前台 20–30Hz 持续执行完整 store merge。

### 2.2 可验证指标

以下时间从前端收到第一个 `stream_delta` 开始计算，不包含 Provider TTFT：

| 指标 | 通过条件 |
| --- | --- |
| WS 接收 → store publish | 下一合格动画帧，目标 P95 ≤ 34ms |
| 前台持续高速提交频率 | 当前 Provider 约 15–20 次/秒；前端硬上限约 30 次/秒；同一绘制帧每 session 最多一次 store batch |
| store publish → 内容 paint | P95 ≤ 2 个设备显示帧；不假设 rAF 内的 React 更新一定赶上当前帧 |
| 原始 delta → 内容 paint | 服务端合并 ≤ 50ms + 前端调度/paint ≤ 3 个设备显示帧；60Hz 设备目标 P95 ≤ 100ms |
| 终帧收敛 | `stream_end` / `complete` 调用栈内同步发布全部未提交内容 |
| 完成附加延迟 | 0 个“打字机播放”周期；最多只剩 React 自身一次提交/绘制 |
| 用户脱离底部 | 后续流式更新造成的程序化 `scrollTop` 写入次数为 0 |
| 长回复渲染预算 | 桌面目标 P95 单次 commit < 16ms；移动端目标 P95 < 25ms |
| 每秒主线程预算 | 记录 100 条消息窗口内每秒累计的 store merge、`normalizedToChatMessages`、`visibleMessages` slice、tool grouping、Markdown、React commit、scroll handler 时间；改后不得出现无 long task 但 duty cycle/耗电显著恶化 |
| 双通道事务 | 同一 pump 的 dirty thinking/text 只触发一次 `computeMerged`、一次 active-session `notify`，且最终最多一次 React commit |
| 并发会话 | 1 条可见流保持目标频率；3 条不可见流各自 publish/merge ≤ 5Hz；切换会话后的首次 paint 前发布该会话最新累计内容 |
| 内容与视口相位差 | 跟底状态下，内容 paint 与贴底完成的差值 P95 ≤ 1 个显示帧 |
| 正确性 | 不丢字、不重复、不串会话、不交换 thinking/text 顺序、不产生空占位行 |

如果移动端长 Markdown 无法满足渲染预算，应把前台最小间隔从 32ms 调整为 48ms；不要用更复杂的增量 AST 或逐字队列掩盖性能问题。

### 2.3 非目标

- 不修改服务端 delta 合并、WebSocket 信封、`seq`、replay 或 Provider adapter。
- 不增加逐字打字机、随机速度、淡入每个 token、闪烁光标。
- 不重写 Markdown parser，不引入增量 Markdown AST。
- 不处理 `StreamingMarkdown` 的 settled/pending 块换父节点问题；这是独立议题。
- 不重构全部聊天滚动状态机；只替换流式跟底 writer，并给直接竞争的 initial-settle writer 增加用户意图守卫。
- 不新增用户设置或实验开关；性能常量先由基准和验收统一确定。
- 不顺带调整字体、消息间距、工具卡片或 ActivityIndicator 样式。

## 3. 候选路线与决策

| 路线 | 做法 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- | --- |
| A. 缩短 timer | 100ms 改为 40–50ms | 改动最小 | 仍不与绘制帧对齐；滚动 timer 问题保留；后台和前台一个节奏 | 不选 |
| B. 帧对齐最新状态提交 | 服务端 50ms 批次不变；前端可见会话由 rAF 发布最新累计值、watchdog 兜底；不可见会话最高 5Hz | 移除前端第二层 100ms 等待；无人为播放延迟；控制并发后台 merge 成本 | 可见会话的 store/Markdown 更新频率约提高到当前的两倍，必须配套滚动与性能门槛 | **选择** |
| B2. 同时提高服务端频率 | 服务端 50ms 改为约 32ms，再走路线 B | 可接近 30Hz | WS、replay 和后台会话事件成本约增加 50%；当前没有数据证明必要 | 暂不选，首版数据不足时再评估 |
| C. 自适应逐字队列 | 收到内容进入字符队列，每帧按积压释放 | 动画最丝滑 | UI 会落后真实模型；完成后还可能继续播放；中英文速度难统一；选择和 Markdown 结构更不稳定 | 拒绝 |
| D. 增量 Markdown AST | parser 保留状态，只追加 AST | 理论性能上限高 | 与 GFM、数学、HTML、表格、代码高亮组合复杂，风险远超当前问题 | 拒绝 |

选择 B 的关键原因：CloudCLI 是编码 Agent 界面，内容真实性和完成时效优先于“模拟人类打字”。服务端已有 50ms 合并，本轮只移除前端额外的 100ms 二次批处理颗粒，不人为改变 Provider 的时间线，也不增加服务端事件量。

## 4. 详细设计

### 4.1 新链路

```text
                         ┌─ stream_end / complete ─→ 同步 flushNow ─→ finalize
                         │
Provider token delta ─→ 服务端 50ms/2048 字符合并 ─→ WS delta
                                                        │
                                                        ▼
                                  前端累计完整文本 ─→ 标记对应通道 dirty
                         │
                         ├─ visible session：rAF pump（最小间隔 32ms）
                         │       └─ 发布本帧最新完整字符串
                         │
                         ├─ visible session：100ms watchdog
                         │       └─ rAF 暂停/主线程繁忙时发布 dirty 通道
                         │
                         └─ hidden session：200ms publish timer（最高 5Hz）
                                 └─ 切换为可见时同步 flush 最新累计值

dirty channels ─→ 单次 store batch/merge/notify ─→ React/Markdown commit
                                                  └─→ 单个 follow rAF ─→ 若仍 pinned 则贴底
```

### 4.2 `StreamingBuffer` 状态

继续按 `sessionId` 存一个 buffer，不增加 React state：

```ts
type StreamBuffer = {
  text: string;
  thinking: string;
  publishedText: string;
  publishedThinking: string;
  provider: LLMProvider;
  frameId: number | null;
  publishTimer: number | null;
  lastPublishedAt: number | null;
};
```

约束：

- `text` / `thinking` 是从本轮开始累计的权威内容。
- `published*` 只用于判断通道是否发生变化，不作为另一份业务状态暴露出去。
- 当前 stream buffer 在单轮内只增长，保存已发布字符串直观且不易因 Unicode 长度产生误判；若基准表明内存复制有实际问题，再改为 revision/length，首版不预优化。
- 新建 buffer 时 `text`、`thinking`、`publishedText`、`publishedThinking` 均初始化为 `''`；首个非空 delta 必须立即形成 dirty 通道。
- `frameId` 和 `publishTimer` 任一触发发布后都要取消另一方，避免同一批内容双写；`publishTimer` 在可见会话中是 100ms watchdog，在不可见会话中是 200ms 发布 timer。
- `lastPublishedAt === null` 明确表示该 buffer 尚未发布，首帧不受 32ms 限制；后续值使用 rAF timestamp / `performance.now()` 的同一时间域，不使用系统时间。
- registry 的 flush 回调一次接收该 session 本帧全部 dirty channel，而不是逐通道回调；数组顺序固定为 thinking、text。
- registry 额外接收 `isSessionVisible(sessionId)` 判定；判定从 `ChatInterface` 维护的当前可见会话 ref 读取（Chat workspace inactive 时为 `null`），不能捕获初始化时的旧 session 值。

### 4.3 调度算法

常量：

```ts
const FOREGROUND_MIN_PUBLISH_INTERVAL_MS = 32;
const STREAM_PUBLISH_WATCHDOG_MS = 100;
const BACKGROUND_PUBLISH_INTERVAL_MS = 200;
```

32ms 是前端最大约 30Hz 的防御上限，而不是固定播放速度。当前全部 token 流 Provider 都先经过服务端 `createDeltaBatcher`：连续同通道 delta 最长等待 50ms，累计达到 2048 字符会提前发布；所以正常实际频率约为 20Hz。前端上限负责防止超大块提前 flush 或未来 Provider 绕过合并时把 React 推到 60/120Hz。

算法如下：

1. `append(sessionId, delta, provider, channel)` 把 delta 追加到权威字符串。
2. 若 session 当前不可见，不请求 rAF，只保留一个 200ms publish timer；同窗口 delta 继续合并。
3. 若 session 当前可见且已有 `frameId`，不重复排帧；否则请求 rAF，并同时启动 100ms watchdog。
4. rAF 回调检查 `lastPublishedAt`：
   - 值为 `null`（首次发布）或 `timestamp - lastPublishedAt >= 32ms`：发布所有 dirty 通道。
   - 尚未达到：继续请求下一帧，watchdog 保持不变。
5. 发布时只调用发生变化的通道；更新对应 `published*` 和 `lastPublishedAt`。
6. 发布后如果没有新 dirty 内容，不再请求 rAF；后续 delta 再唤醒。
7. 如果发布过程中同步来了新 delta（JavaScript 单线程下只会在当前调用栈结束后发生），下一次 append 重新排帧，不需要重入逻辑。
8. 当前会话或 Chat workspace active 状态发生变化时，在 `useLayoutEffect` 中先更新 registry 使用的可见 session ref，再对新可见 session 同步调用 `flushNow(sessionId)`，使最新累计值在该次切换后的首次 paint 前进入 store；旧 session 的后续 delta 自动改走 200ms timer。该切换 flush 只发布 dirty 内容，不 finalize、也不 drop buffer，不使用 `flushSync`。

这意味着：

- Provider 原始 delta 每 200ms 一个 → 服务端逐个发出，UI 约每 200ms 更新一次，不插值。
- Provider 原始 delta 每 10ms 一个 → 服务端约每 50ms 合并一次，UI 在随后动画帧发布，实际约 20Hz。
- 服务端因 2048 字符阈值连续提前 flush，或未来 runtime 未走 batcher → 前端仍最多约每 33ms 发布一次，不逐个重放。
- 三条不可见会话同时流式 → 每条仍完整累计，但各自最多约 5Hz 进入 store merge；用户切入任一会话时先同步追到最新值，不播放中间批次。
- 浏览器掉帧 → rAF 自然降频；若 timer 仍获调度，watchdog 会尝试兜底，但不能突破主线程阻塞或浏览器后台节流。

### 4.4 不可见会话、页面后台与终帧语义

这里区分“CloudCLI 当前不可见会话”和“整个浏览器页面进入后台”：前者由 session id 可精确判断并主动降频；后者由浏览器调度策略决定。不能只依赖 rAF，因为浏览器会暂停后台页面的动画帧。watchdog 是“第二种可运行机会”，不是硬实时保证：后台 timer 也可能被浏览器延后到 1 秒或更久，主线程阻塞时两者都会延后。

- 当前不可见会话只用 200ms timer 发布，最高 5Hz，不排 rAF；该策略只降低 store 派生计算频率，不丢弃 delta。
- 当前可见会话的 watchdog 获得执行机会时取消待执行 rAF，立即发布 dirty 通道。
- 页面恢复可见或收到后续事件时仍会重新排 rAF；`stream_end` / `complete` 事件一旦被 JavaScript 处理就同步收敛，所以不会把后台积压做成逐批补播。
- 会话切换为可见时由 layout effect 同步 `flushNow(sessionId)`；`flushNow` 同步取消 rAF 和 publish timer，只发布 dirty 通道。
- `flushNow` 后 buffer 仍存在，直到现有调用方执行 `drop`；`has(sessionId)` 的语义不变。
- `drop(sessionId)` / `dropAll()` 必须同时取消两类句柄。
- 空 delta 不建 buffer；没有 dirty 通道的 `flushNow` 不调用 store。
- `stream_end` 和 `complete` 的现有顺序保持：`flushNow` → `finalizeStreaming` → `drop`。
- 上述三步必须保持在同一个同步调用栈内，禁止在中间引入 `await`、Promise continuation 或其他让步点；这样下一轮 delta 不可能插入旧 buffer 被 drop 之前。
- Cursor 等不发 `stream_end` 的 Provider 继续依赖 `complete` 收尾。

### 4.5 Dirty 通道的原子 store 更新

当前 `flushBuffer` 会发布两个非空通道。思考结束后正文继续增长时，旧思考内容也会再次传给 `updateStreaming`。

registry 先按以下判据收集本帧更新：

```ts
if (buffer.thinking !== buffer.publishedThinking) updates.push({ channel: 'thinking', text: buffer.thinking });
if (buffer.text !== buffer.publishedText) updates.push({ channel: 'text', text: buffer.text });
```

随后一次调用 `sessionStore.updateStreamingBatch(sessionId, updates, provider)`：

1. 只复制一次 `slot.realtimeMessages`。
2. 已存在的通道行在原数组位置替换，并保留该行首次创建时冻结的 timestamp。
3. 新出现的通道行按 batch 顺序追加到 `realtimeMessages` 数组末尾；同批首次创建 thinking/text 时 thinking 先 append、text 后 append，不移动任何已有行或无关 realtime 消息。
4. 每个新行都独立执行一次 timestamp 取值并把结果冻结给该行，不能为了少一次调用而共享一个 batch timestamp；两次取值因毫秒精度而相等是允许的，稳定顺序依赖数组 append 顺序与稳定排序，而不是伪造不同时间。
5. 全部更新应用后只调用一次 `recomputeMergedIfNeeded(slot)`。
6. 只调用一次 `notify(sessionId)`。
7. updates 为空时完全 no-op。

不能只依赖 React 18 自动批处理：即使两个 `setState` 最终合并成一次 render，原先逐通道调用 `updateStreaming` 也会提前做两次数组复制和两次 `computeMerged`。原子 store 事务是本轮实施内容，不留到性能复测后再决定。

保留旧的 `updateStreaming(sessionId, accumulatedText, provider, channel?)` 签名，内部仅把单通道参数包装成一个元素的 updates 后委托给 `updateStreamingBatch`。生产热路径统一使用 batch；薄包装保留已有单通道 store 测试和内部调用兼容性，不形成第二套实现。

thinking 先于 text 只承诺“同一次 batch 内两行均为首次创建”这一种情况：服务端 `createDeltaBatcher` 在 channel 变化时先 flush 旧通道，registry batch 固定 thinking、text 排序，store 按该顺序 append 新行。如果 text 在更早批次已经先创建，后到的 thinking 只能追加到末尾，不得把它移到 text 之前。现有服务端 channel-change 测试继续保留，并补前端测试分别覆盖同批首建、先 text 后 thinking，以及与其他 realtime 行交错时不重排。

### 4.6 跟底调度

提高流式发布频率前，必须移除当前“每次消息数组变化后启动一个无 cleanup 的 50ms timer”的模式。

设计：

1. 在 `useChatSessionState` 中增加一个 `followFrameRef`，同一时刻最多存在一个流式跟底 rAF。
2. `chatMessages` 变化且满足现有 guards 时，只请求一次跟底帧；已有帧则合并。
3. 回调执行前重新检查：
   - Chat tab 仍 active；
   - `isUserScrolledUpRef.current === false`；
   - 没有分页 restore；
   - 没有 search jump；
   - 不在 loading-more 流程。
4. 通过后执行即时 `container.scrollTop = container.scrollHeight`。
5. 删除当前“state → ref”的镜像 effect，新增唯一写入口（沿用对外名称 `setIsUserScrolledUp`）：先同步写 `isUserScrolledUpRef.current`，再调用内部 state setter。
6. `handleScroll`、session reset、composer 发送、测试及其他内部调用全部经过唯一写入口；`scrollToBottomAndReset` 继续依赖真实 scroll 事件把状态归位，不私自形成第二套状态更新规则。
7. session 切换、CloudCLI 内部 Chat workspace tab 变为 inactive 和 unmount 时取消旧 `followFrameRef`。
8. 初始 settle rAF 的每一帧同样检查 `isUserScrolledUpRef`；一旦用户脱离底部，立即清除 `pendingInitialScrollRef` 并停止循环，不能在首秒持续夺回位置。

“标签不可见”需要区分两种状态：

- **CloudCLI 内部 workspace tab inactive**：`isActive` 变为 false，取消 follow rAF；现有 `wasChatActiveRef` / `becameActive` 分支在重新进入 Chat 时按 pinned/detached 状态恢复位置，不新增入口。
- **浏览器或 iOS 页面进入后台**：`isActive` 通常不变，不主动取消已经排队的 rAF；浏览器恢复调度后该帧或 watchdog 会处理最新累计状态。首版不新增 `visibilitychange` 滚动 writer，避免与现有 tab-reactivation restore 形成重复入口。

明确不使用 `scrollTo({ behavior: 'smooth' })`：流式期间连续启动 smooth scroll 会让动画追不上不断增长的目标，并更容易产生漂浮、回弹和晕动问题。这里需要的是帧内锚定，不是过渡动画。

程序化贴底几乎每次都会产生 `scroll` 事件，频率会随发布率增加。阶段 0/3 必须记录 `handleScroll` 次数和累计耗时。首版不预先加入“程序化 scroll 标记后短路”：浏览器可能把程序化滚动和用户输入合并到相邻事件，错误短路会漏掉真实脱离意图；`scroll` 事件本身不可取消，单纯声明 passive 也不能消除 handler 工作。只有 trace 证明该项成为显著瓶颈，才另立有行为测试的优化。

不使用 `flushSync` 强迫 rAF 内 store 更新赶上当前 paint。方案接受 React commit 最多后移一帧，并以 `publish → paint`、`content paint → follow complete` 两项指标实测；只有相位差超标且能证明 `flushSync` 总成本更低时才重新评估。

### 4.7 Markdown 策略

首版保持 `StreamingMarkdown` 与 `splitStreamingMarkdown` 不变。

理由：

- settled/pending 拆分已经避免每次完整 Markdown 解析。
- 同一组件覆盖 streaming → settled，DOM 结束时不会整体重挂。
- 当前问题首先是服务端 50ms 合并后，前端又额外增加 100ms 展示颗粒；同时改 parser 会让回归来源无法区分。

但发布频率将从上限 10Hz 提高到当前 Provider 典型约 20Hz（防御上限约 30Hz），所以 Markdown 性能是上线门槛：

- 用纯段落、长列表、未闭合代码 fence、表格、数学公式分别测试 1k/10k/30k 字符。
- 如果 10k 字符场景的移动端 P95 commit 超过 25ms，把最小发布间隔调整为 48ms。
- 如果只有某种 pending 块超标，先对该块做证据驱动的局部优化；不直接引入增量 AST。

### 4.8 无障碍和动效偏好

- 本方案展示真实内容变化，不增加装饰性逐字动画，因此 `prefers-reduced-motion` 下无需降低内容发布率。
- 不新增 live region；现有整条消息不应在每次 delta 时被屏幕阅读器重复朗读。
- 后续若单独增加闪烁光标，必须 `aria-hidden`，并在 reduced-motion 下停止闪烁；不纳入本方案。

### 4.9 可重复的性能测量协议

性能对比只使用开发期临时埋点，不把诊断 telemetry 带入生产构建：

1. 用固定 replay fixture 驱动同一组 100 条可见消息，分别运行“1 条可见流”和“1 条可见 + 3 条不可见并发流”；改前、改后使用相同 delta 内容、时间轴、浏览器、设备和窗口尺寸。
2. 在 `computeMerged`、`normalizedToChatMessages`、`visibleMessages` slice、tool grouping、Markdown render/split、`handleScroll` 前后用 `performance.mark` / `performance.measure` 记录；React commit 用 `<Profiler onRender>` 记录，程序化 `scrollTop` 写入单独计数。
3. `publish → paint` 以 commit 后下一次 rAF 作为可重复的 paint proxy；报告中明确它不是浏览器像素落屏的硬保证。`paint → follow` 使用跟底 rAF 完成时刻计算。
4. 每个场景先预热 5 秒，再采样 30 秒，独立运行 3 次；按每个 30 秒固定时间窗汇总调用次数、总耗时、单次 P50/P95，并将总耗时除以 30 归一化为 ms/s。
5. 单独列出 100 条窗口下 `normalizedToChatMessages + visibleMessages` 的合计 ms/s；不能把它藏在 React commit 或 tool grouping 数据中。
6. iOS 使用同一 replay 和采样窗；若调试工具无法保留自定义 measure，则由临时内存聚合器输出相同字段，验收完成后移除。

## 5. 文件级改动清单

| 文件 | 计划改动 |
| --- | --- |
| `src/modules/chat/utils/streamingBufferRegistry.ts` | 可见 session 用 rAF + 100ms watchdog，不可见 session 用 200ms timer；加入 dirty 通道判定；flush 回调改为一次提交本 session 的通道 batch |
| `src/modules/chat/ChatInterface.tsx` | 维护当前可见 session ref，把 registry batch 接到 `sessionStore.updateStreamingBatch`；用 layout effect 在会话首次 paint 前同步 flush 最新累计值 |
| `src/modules/chat/hooks/useSessionStore.ts` | 新增原子 `updateStreamingBatch` 热路径，一次数组复制、merge、notify；保留旧 `updateStreaming` 为单通道薄包装 |
| `src/shared/types.ts` | 增加带独立注释的 `StreamingChannelUpdate` 共享类型，供 registry、ChatInterface、session store 使用，并放入既有聊天消息分组 |
| `src/modules/chat/tests/streamingBufferRegistry.test.ts` | 重写 cadence 测试；覆盖首帧 dirty、前台限频/watchdog、后台 5Hz、切前台收敛、终帧、只发布变化通道、取消和会话隔离 |
| `src/modules/chat/hooks/useChatSessionState.ts` | 把 50ms follow timer 改为单 rAF；删除 ref 镜像 effect并统一写入口；给 initial settle 增加用户抢占守卫 |
| `src/modules/chat/tests/transcriptScrollOwnership.test.tsx` | 覆盖同一行增长、帧合并、用户抢占、initial settle 退出、session/tab 切换取消和 claim 抑制；补齐新增 store 方法 mock |
| `src/modules/chat/tests/streamingBufferSessionScope.test.tsx` | 将 registry flush 四元回调断言改为 batch 签名；确认 session/channel 隔离、交错通道顺序和同步收尾 |
| `src/modules/chat/tests/thinkingStreamStore.test.tsx` | 保留单通道薄包装用例；新增 batch 原子更新、每行 timestamp、append/不重排以及单次 merged 重算/通知断言 |
| `src/modules/chat/tests/streamedReplyEcho.test.tsx` | 继续通过旧 `updateStreaming` 薄包装验证单通道 echo；无需改调用签名，若 store mock 类型新增必填方法则同步补齐 |
| `src/modules/chat/transcript/StreamingMarkdown.tsx` | 不改行为；更新“每 100ms”注释为新的服务端批次 + 前端帧调度事实 |
| `src/modules/chat/utils/streamingMarkdown.ts` | 不改行为；同步 cadence 注释 |
| `src/modules/chat/utils/toolGrouping.ts` | 不改行为；同步 cadence 注释，保留并更新性能基线说明 |
| `src/modules/chat/transcript/ToolGroupContainer.tsx` | 不改行为；同步 cadence 与 memo 失效说明 |
| `src/modules/chat/tests/streamingMarkdownComponent.test.tsx` | 原用例复跑；原则上不改实现和断言 |
| `server/shared/tests/delta-batcher.test.ts` | 扩展同窗口 thinking/text 交错顺序契约；不修改服务端 batcher 实现 |
| `server/modules/providers/tests/{claude-partial-stream,cursor-runtime,opencode-runtime,pi-runtime,workbuddy-runtime}.test.ts` | 审计现有 fixture，并仅在缺失处补“按序拼接 delta 等于最终全文”的契约断言；不修改 Provider runtime |
| `docs/architecture/02-realtime-stream.md` | 补全服务端 50ms/2048 字符 batcher；把前端 100ms timer 更新为帧对齐提交 + watchdog + dirty channel；顺带校正已被近期流式改动影响的直接相关段落 |
| `docs/architecture/05-scrolling.md` | 更新流式增长跟底 writer、时序图和 gotchas；记录单个 follow rAF 的所有权规则 |
| `docs/provider-adapter-integration-sop.md` | 在新 Provider checklist 中加入“输出可拼接 delta、runtime 接入 batcher、双通道切换保持顺序、fixture 拼接等于最终全文”四项门禁 |

不新增跨模块组件导出，不修改 barrel。`StreamingChannelUpdate` 被三个文件共同使用，按前端规范放入 `src/shared/types.ts`，使用 `export type` / `import type` 并补齐用途注释；所有前端应用源码 import 继续使用 `@/...`。

## 6. 测试方案

### 6.1 Registry 单元测试

至少覆盖：

1. 首个前台 delta 在下一 rAF 发布，不等待 watchdog。
2. 新 buffer 的 `publishedText` / `publishedThinking` 均为 `''`，首个 delta 立即变 dirty；同一帧多 delta 只产生一次发布，内容为最新完整累计值。
3. 连续高速 delta 不超过 `FOREGROUND_MIN_PUBLISH_INTERVAL_MS` 上限。
4. 低速 delta 不制造额外空发布。
5. rAF 不执行、fake timer 推进到 100ms 时，watchdog 发布内容；测试只验证代码调度，不宣称浏览器后台墙钟精度。
6. rAF 与 watchdog 竞争时只有一方写 store。
7. thinking 未变化、text 继续增长时，batch 中不重复包含 thinking。
8. 两通道同时 dirty 时只回调一次，batch 内 thinking 仍先于 text。
9. `flushNow` 同步发布未提交内容并取消两个句柄。
10. 无 dirty 内容的 `flushNow` no-op。
11. `drop` / `dropAll` 后推进 fake timers/rAF 不再发布。
12. 多会话内容完全隔离；不可见 session 不排 rAF 且最多每 200ms 发布一次。
13. session 从不可见切为可见时，layout effect 内的 `flushNow` 同步发布尚未进入 store 的最新累计值，首次 paint 不闪出旧版本，之后恢复前台 cadence。
14. 连续两轮 `delta → end → delta → end`，并模拟 end 处理返回后立即到达下一轮 delta，第二轮从空内容开始。

### 6.2 滚动单元测试

至少覆盖：

1. 同一流式行内容增长、行数不变时仍跟底。
2. 一帧前多次消息更新只排一个跟底写入。
3. 跟底 rAF 执行前用户上滑，不写 `scrollTop`。
4. 用户回到底部后，下一次增长恢复跟随。
5. search jump、分页 restore、loading-more 期间不跟底。
6. session A 排队的跟底不能作用于 session B。
7. CloudCLI 内部 Chat tab inactive 或 hook unmount 后旧 rAF 被取消。
8. “回到底部”仍重置 load-all 的可见窗口。
9. initial settle 循环期间用户上滑会同步停止循环，之后不再写 `scrollTop`。
10. CloudCLI 内部 Chat tab 重新 active 时沿用现有 reactivation restore；浏览器后台恢复不新增独立 writer。

### 6.3 Provider 与 store 契约测试

1. 扩展 `server/shared/tests/delta-batcher.test.ts`：同一窗口按 thinking → text → thinking 交错输入，每次 channel 切换先 flush 旧通道，输出顺序和内容严格一致。
2. 扩展前端 session-store 测试：一个包含双 dirty 通道的 batch 原子产生两行，每个新行独立取得 timestamp，均冻结各自首次取值；即使 timestamp 相等，同批首建仍按 thinking、text append 到数组末尾，且只形成一次 store merge/active-session 通知语义。
3. 增加互补顺序测试：text 在更早 batch 已创建时，后到 thinking 追加末尾而不重排 text 或其他 realtime 行；旧 `updateStreaming` 薄包装与 batch 结果一致。
4. 对 Claude、Cursor、OpenCode、Pi、WorkBuddy 的 streaming fixture 审计或补齐断言：按接收顺序拼接所有 delta 必须严格等于 fixture 的最终全文。这里验证的是“可拼接增量”，不要求每个 delta 自身长度递增，也不增加运行时注册表校验。
5. 在 `02-realtime-stream.md` 和 Provider 接入 SOP 把“新 token-stream Provider 必须输出可拼接 delta、runtime 必须接入 `createDeltaBatcher`、双通道切换保持顺序、fixture 拼接等于最终全文”写成代码审查与测试 checklist。由 adapter fixture 自动断言保护内容正确性，文档只负责接入流程。

服务端定向测试：

```bash
npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/delta-batcher.test.ts
```

### 6.4 既有回归测试

```bash
npm run test:client -- --run \
  src/modules/chat/tests/streamingBufferRegistry.test.ts \
  src/modules/chat/tests/streamingBufferSessionScope.test.tsx \
  src/modules/chat/tests/transcriptScrollOwnership.test.tsx \
  src/modules/chat/tests/streamingMarkdown.test.ts \
  src/modules/chat/tests/streamingMarkdownComponent.test.tsx \
  src/modules/chat/tests/streamingMarkdownRenderEquivalence.test.tsx \
  src/modules/chat/tests/messageStreamEnd.test.tsx \
  src/modules/chat/tests/thinkingStreamStore.test.tsx \
  src/modules/chat/tests/streamedReplyEcho.test.tsx
```

随后执行：

```bash
npm test
npm run test:client
npm run build:client
npm run typecheck
npm run lint:client
```

### 6.5 人工与性能验收矩阵

| 场景 | 观察点 |
| --- | --- |
| 高速短回答 | 立即出现、立即完成，不在 complete 后继续播放 |
| 高速 10k/30k 长回答 | 文字连续增长；Performance trace 无持续 long task |
| 中文、英文、emoji、组合字符 | 不按 UTF-16 切割显示，不出现半个字符；本方案整串发布天然满足 |
| 未闭合/闭合代码 fence | 代码块样式切换正确，无内容丢失 |
| 列表、表格、数学、引用 | 与非流式最终 DOM 等价 |
| thinking → text | 顺序正确，thinking 停止后不发生重复 store 写入 |
| tool → text → tool | 工具卡片顺序和状态不受影响 |
| 流式期间上滑选择文字 | 不被拉回底部；已完成段落选择保持 |
| 点击回到底部 | 立即恢复跟随，后续增长稳定贴底 |
| 切换会话/Chat 标签 | 后台不串内容；回来后位置恢复符合现状 |
| 1 条可见 + 3 条不可见并发流 | 可见流保持目标频率；每条不可见流 publish/merge ≤ 5Hz；切入后台会话后的首次 paint 显示最新累计值 |
| iOS H5 前后台切换 | 允许浏览器节流；恢复后直接显示最新累计内容，无大量逐批补播 |
| abort、断网重连、无 stream_end | 最终内容不丢失，无残留 streaming 行 |

## 7. 实施顺序

### 阶段 0：基线

1. 用现有 100ms 版本录制桌面和 iOS 的高速长回复 Performance trace。
2. 记录 WS receive → store publish、publish → paint、content paint → follow complete 三段延迟。
3. 按 §4.9 协议记录每秒 store `computeMerged`、`normalizedToChatMessages`、`visibleMessages` slice、tool grouping、Markdown、React commit、`handleScroll` 次数/累计时间、程序化滚动写入次数和 long task；不能只看单次 commit P95。
4. 固定一组纯文本与复杂 Markdown 输入，作为改前/改后同源样本；分别录制单可见流与“1 条可见 + 3 条不可见”并发样本。

### 阶段 1：Registry（先测试后实现）

1. 把 §6.1 新时序写成 fake rAF/fake timer 测试。
2. 实现可见 session 的帧对齐 pump/watchdog、不可见 session 的 200ms timer、切换可见时同步收敛，以及 dirty-channel batch。
3. 实现 session store 原子 batch，一次完成双通道数组更新、merge 和 notify。
4. 通过 registry、session-store 与 handler/session-scope 测试。

### 阶段 2：滚动（必须与阶段 1 同一发布）

1. 把 §6.2 的抢占和合并场景写成测试。
2. 替换 50ms follow timer，删除镜像 effect并确保全部 setter/ref 写入口同步。
3. 给 initial settle 加用户脱离守卫，明确内部 Chat tab 与浏览器后台的不同恢复路径。
4. 复跑分页、搜索跳转、lazy row、composer 发送相关测试。

### 阶段 3：性能门槛与收尾

1. 按 §4.9 对相同单流与并发样本重新录制 Performance trace，对比三段延迟、每秒累计主线程时间、merge/normalization/slice/commit/scroll 次数和 long task。
2. 桌面和移动端指标通过则保留 32ms；移动端超预算则统一改为 48ms 后复测。
3. 更新两份架构文档。
4. 执行 `npm test` 服务端全量测试，以及全量前端验证。

阶段 1 和阶段 2 可以分 commit，便于审查和回滚，但不能只部署阶段 1。

## 8. 风险、监控与回滚

| 风险 | 触发信号 | 控制措施 |
| --- | --- | --- |
| Markdown/React 开销放大 | commit P95 超预算、持续 long task | 32ms 降为 48ms；保持现有 parser，不继续提高频率 |
| 无 long task 但持续 CPU/耗电升高 | 每秒 merge+normalization+slice+group+markdown+commit duty cycle 显著增长 | 按固定 30 秒采样窗决定 32/48ms；必要时降低前端上限，不先改 parser |
| 多个不可见会话并发流式 | rAF/merge 次数随 session 数按前台频率增长 | 不可见 session 仅用 200ms timer；切换可见同步 flush；1+3 并发基准与测试 |
| 跟底与用户滚动竞态 | 用户上滑后被拉回 | ref 同步更新；rAF 执行前重新检查；回归测试固定时序 |
| initial settle 在首屏争抢滚动 | 打开流式会话后首秒无法上滑 | settle 每帧检查同步 ref，用户脱离即终止 claim |
| 后台 rAF 与 timer 都被浏览器节流 | 回前台瞬间仍是旧文本 | 可见性恢复/下一事件重新排帧；terminal 一旦被处理就同步 flush；验收要求恢复后直接追到最新而非逐批补播 |
| rAF/watchdog 双发布 | 相同累计值连续两次写 store | dirty 判定；任一发布取消另一句柄；竞争测试 |
| thinking 重复更新 | 正文阶段出现额外 render | per-channel published snapshot；专门测试 |
| 双 dirty 通道重复 merge | 一次 pump 出现两次 `computeMerged` | 原子 `updateStreamingBatch`，一次复制/merge/notify；测试与 trace 双重验证 |
| 多会话句柄泄漏 | 切会话后旧 session 保留错误 cadence 或终止后继续触发 | 可见性判定读实时 ref；`drop`/`dropAll` 取消 frame 和 timer；切换与 session 隔离测试 |
| 设备性能分层明显 | 旧手机掉帧但桌面正常 | 以移动端门槛决定 32/48ms，不做 UA 判断 |

回滚边界清晰：registry 可恢复到原 100ms timer，跟底可恢复到原 50ms effect；服务端协议、store 数据结构和持久化格式均未改变，无数据迁移。

## 9. 验收结论模板

实施完成后必须记录：

```text
桌面：receive→publish P95 / publish→paint P95 / paint→follow P95 / 实际 publish Hz / long task 数
iOS：receive→publish P95 / publish→paint P95 / paint→follow P95 / 实际 publish Hz / long task 数
每秒累计：computeMerged / normalizedToChatMessages / visibleMessages slice / tool grouping / markdown / React commit / handleScroll 次数与耗时
并发：1 visible + 3 hidden 各自 publish/merge Hz / 切换可见同步收敛结果
双通道：每 pump 的 merge / notify / commit 次数
高频短答：complete 后是否仍有播放
长 Markdown：最终 DOM 是否一致
用户上滑：程序化 scrollTop 写入次数
最终常量：32ms 或 48ms，以及选择依据
```

只有正确性测试全部通过、用户滚动无回归、移动端性能达到门槛后，才算完成；“看起来更快”不是单独的通过标准。

### 9.1 2026-09-12 实施记录

- 已实现可见 session 的 rAF + 32ms 上限 + 100ms watchdog、不可见 session 的 200ms cadence，以及切换可见时的同步 latest-state flush。
- 已实现 registry dirty-channel batch、session store 原子 `updateStreamingBatch` 和旧 `updateStreaming` 单通道薄包装。
- 已把流式跟底替换为单个可取消 rAF，统一 `isUserScrolledUp` ref/state 写入口，并让 initial settle 服从用户抢占。
- 前端定向测试 35 条通过；前端全量测试 459 条通过；流式相关服务端与 Provider 定向测试 78 条通过。
- `npm run build:client`、`npm run typecheck`、`npm run lint` 通过；lint 仍报告仓库既有 warnings，本次改动没有新增 lint error。
- 服务端全量 `npm test` 最新运行结果为 663 passed / 9 failed / 1 skipped。失败集中在当前工作区另有改动的 session synchronizer / WorkBuddy status 测试，以及受本机 Claude 可执行路径污染的 Windows path 测试；本次新增的 Cursor、OpenCode、delta-batcher 契约测试全部通过。该门禁尚不能记为全绿。
- 尚未录制 §4.9 要求的桌面/iOS 30 秒 Performance trace，因此 32ms 仍是待真实性能数据确认的首选常量；若移动端超出预算，按方案统一调整为 48ms 后复测。

## 10. 两轮双 Harness 审阅后锁定的决策

1. 保留服务端 50ms/2048 字符合并；前端以 32ms 为防御上限、100ms timer 为非硬实时 watchdog，最终 32/48ms 由移动端每秒累计主线程成本决定。
2. `publishedText` / `publishedThinking` 首版保存字符串引用且初值固定为 `''`，不引入 revision；`lastPublishedAt` 用 `null` 表示首次发布。
3. registry 一帧只回调一次 channel batch；session store 必须原子应用 batch，只做一次数组复制、`computeMerged` 和 `notify`。
4. `flushNow → finalizeStreaming → drop` 保持同一同步调用栈，不增加 finalized 状态；用 end 后紧接下一轮 delta 的测试守住不让步约束。
5. 所有 `isUserScrolledUp` 写入统一经过同步 ref/state setter；流式 follow 和 initial settle 都服从该 ref。
6. CloudCLI 内部 Chat tab 复用现有 reactivation restore；浏览器后台不取消排队 rAF，不新增 `visibilitychange` 滚动 writer。
7. 不使用 `flushSync`，允许 React commit 与跟底存在最多一帧相位差，以 `publish→paint` 和 `paint→follow` trace 验收。
8. 不预先短路程序化 `scroll` 事件；先记录 handler 次数与累计耗时，避免标记误吞真实用户滚动。
9. 新 token-stream Provider 必须输出可拼接 delta，runtime 必须接入 `createDeltaBatcher`；架构文档与接入 SOP 增加 checklist，各 Provider fixture 以“拼接 delta 等于最终全文”自动守住正确性，不做运行时注册表校验。
10. 当前可见 session 采用 32ms 上限 + 100ms watchdog；不可见 session 只用 200ms timer，最高 5Hz，切换为可见时同步 flush 最新累计值。以“1 可见 + 3 不可见”作为本轮并发性能承诺。
11. 保留 `updateStreaming` 原签名作为 `updateStreamingBatch` 的单通道薄包装；生产 registry 热路径只用 batch，避免测试兼容与生产实现分叉。
12. 新行各自取得并冻结首次 timestamp；新行追加数组末尾，同批 thinking/text 首建按该顺序 append。跨批次绝不为了 thinking-first 重排已有行，timestamp 相等也不伪造时间差。
13. 性能数据按固定 fixture、5 秒预热、30 秒采样、3 次独立运行收集并归一化为 ms/s；必须单列 normalization 与 visible slice 成本。
14. 同步所有依赖“100ms tick”表述的代码注释、两份架构文档与 Provider 接入 SOP；不借机改动对应运行时行为。最终门禁同时执行 `npm test` 和前端全量验证。

---

## 审阅批注

### Claude

> [!CAUTION] **两轮流式之间 `drop` 时序窗口可能导致内容串台（§4.4、§4.3 第 1 步、§6.1 测试 13）**
> `append` 直接"追加到权威字符串"，而文档已写明 `flushNow` 后 buffer 仍存在、"直到现有调用方执行 `drop`"。若 `finalizeStreaming` 到 `drop` 之间跨异步边界，第二轮 `delta` 可能在 drop 前到达并追加到第一轮残留文本上，造成同一 session 内容串台。§6.1 测试 13 断言"第二轮从空内容开始"，但那是结果断言，不是时序保证。建议明确 `finalizeStreaming` 内同步完成 drop，或在 buffer 上打 finalized 标记、`append` 见到标记先重置，并补一个"`end` 后立即来 `delta`"的时序测试。

> [!WARNING] **tab 隐藏取消跟底 rAF 后，回前台缺重新锚定入口（§4.6 第 7 点）**
> 取消 `followFrameRef` 正确，但文档未定义回前台后的恢复路径。若后台期间 `chatMessages` 无新变化（或后台渲染被节流但未触发新一轮 follow），回前台瞬间视口不会补一次贴底，验收表里"回前台位置恢复符合现状"缺少实现支撑。建议在 `visibilitychange` 回到可见且仍 pinned 时重排一帧跟底，并纳入 iOS H5 前后台切换验收。

> [!WARNING] **"落后收到内容 P95 ≤ 50ms" 与 rAF 相位 + 32ms 限制叠加后偏乐观（§2.2 指标表）**
> 最坏路径为：服务端 50ms 合并窗口 → 前端最多再等下一帧 16.7ms → 距上次发布不足 32ms 时再等一帧 → React commit。尾延迟可达 ~100ms，P95 ≤ 50ms 只覆盖"恰好赶上一帧且不触发 32ms 限制"的常见路径。建议指标改为"P95 ≤ 2 帧"，或在方案中给出 合并窗口 + rAF 相位 + commit 的叠加预算模型，避免验收时对真实分布误判。

> [!IMPORTANT] **"React 18 通常会批处理"需在 trace 中验证，不应作为假设（§4.5）**
> rAF 回调内两个 dirty 通道的同步 `setState` 是否被自动批处理取决于 React 版本与执行上下文；若未批处理，每次 pump 产生两次独立 commit，§2.2 长回复渲染预算直接翻倍。建议把"单次 pump 是否只产生一个 commit"列为阶段 0/3 的明确观测项，作为保留 32ms 还是降 48ms 的决策依据，而非留到首版后再评估。

> [!WARNING] **服务端 batcher 的跨通道顺序未确认（§1.1、§4.5）**
> §4.5 依赖"thinking 先于 text 发布"，但该约束只覆盖前端发布侧；若 `createDeltaBatcher` 在同一合并窗口内混排 thinking/text 的 delta，前端 append 得到的通道顺序由服务端入队顺序决定。建议补一条集成测试：同一合并窗口内 thinking 与 text 交错到达时，最终两行顺序稳定且内容正确。

> [!TIP] **§10.6 的 Provider delta 硬规则应纳入本轮实施，而非留作后续**
> 若"新 Provider 必须输出可拼接 delta 且 runtime 必须接入服务端 batcher"是方案正确性的前置条件，建议至少在本轮加入一条 adapter 契约测试或注册表校验，防止未来 Provider 直接送累计全文时被 `append` 重复累计、误当合法输入。

> [!NOTE] **首帧发布需明确"首次发布"的判定（§4.3 第 4 步）**
> "首次发布或已达到 32ms"依赖一个隐式首帧标记或 `lastPublishedAt` 的空值语义。建议明确 `lastPublishedAt` 首值约定（如 `null` 视为首次、不参与 32ms 限制），否则首帧延迟可能被误压到约 33ms，与 §2.2 "前台首次可见提交 P95 ≤ 34ms"擦边。

### WorkBuddy

> [!WARNING] **硬编码 100ms 节奏的下游消费者未纳入计划，CPU/耗电按 tick 率线性放大（§5 文件清单、§8 风险表、§10.5）**
> 当前代码里"每 100ms tick"不只是一个常量，而是一串被明确量化的假设：
> - `src/modules/chat/utils/toolGrouping.ts:70-74` 自己写了"**分组每 100ms tick 重跑一次**，100 条窗口下 `buildGroupPreview` 实测 0.18ms/tick，**约为 store 自身每 tick merge 成本的七分之一**"→ 反推 store merge ≈ 1.2ms/tick；
> - `src/modules/chat/transcript/ToolGroupContainer.tsx:189-194` 明确"流式期间 `memo` 无法 bail，因为每次 tick `visibleMessages` 都是新数组"；
> - `src/modules/chat/transcript/StreamingMarkdown.tsx:16-17`、`src/modules/chat/utils/streamingMarkdown.ts:5` 都写着"每 100ms 重发全量累计文本"；
> - `src/modules/chat/utils/streamingBufferRegistry.ts:3-6` 甚至注明该常量"**Kept in sync with `StreamingMarkdown`, whose split logic assumes this cadence**"。
>
> §5 只改了 registry 和 `useChatSessionState`，这些消费者与注释全部遗漏。§2.2 只约束"单次 commit < 16ms"，但把频率从 10Hz 提到 20–30Hz 后，**每秒总渲染/合并工作量翻 2–3 倍**——这正是 §10.5 问的移动端 CPU/耗电，而 §8 风险表只监控 commit P95 与 long task，可能漏掉"没有 long task、但 duty cycle 翻倍导致发热降频"的形态。
> 建议：① 把这些消费者与 cadence 注释补进 §5；② 阶段 0/3 的 trace 指标从"单次 commit 时间"扩为"**每 100 条消息窗口内，每秒累计 merge+group+markdown 时间**"，否则 32/48ms 的取舍缺少依据。

> [!WARNING] **§4.5 分通道发布会把 store 的 merged 重算跑两遍，React 批处理救不了（§4.5）**
> `updateStreaming` 每次都会 `slot.realtimeMessages = [...]` 生成新数组，再调 `recomputeMergedIfNeeded`（`src/modules/chat/hooks/useSessionStore.ts:878-885`），而后者是**引用比较**触发的全量 `computeMerged`（同文件 `:440-448`）。因此同一 pump 里先 `publish('thinking')` 再 `publish('text')`，会产生**两次新数组 → 两次 `computeMerged`**，而非一次。
> React 18 的自动批处理只让**渲染**合并成一次 commit；store 侧的合并计算已经跑了两遍，且它落在思考→正文交叠窗口的热路径上。按上一条反推的 ~1.2ms/次，交叠窗口内每次 pump 多花约 1.2ms。
> 建议：不要把这个留到"首版后再评估"。要么在 registry 侧提供一个**单次批量发布入口**（一次调用同时提交 dirty 通道，store 内一次 `recomputeMergedIfNeeded`），要么在阶段 0 trace 里显式测量 thinking→text 交叠窗口的 merge 次数。§4.5 目前把判断条件写成"两个 `notify` 是否形成两个独立 commit"，判据本身是错的——**要看的是 merge 次数，不是 commit 次数**。

> [!WARNING] **初始滚动 rAF 是未列举的第二个流式期 writer，且完全不检查用户上滑（§4.6、§2.1.4、§2.2、§10.4）**
> `src/modules/chat/hooks/useChatSessionState.ts:609-641` 有一段独立的初始贴底 rAF 循环：每帧写 `container.scrollTop = container.scrollHeight`，直到 `scrollHeight` 连续 3 帧稳定或满 60 帧（约 1s）才停。它：
> - **不读 `isUserScrolledUpRef`**，只要 `pendingInitialScrollRef.current` 为真就一直写；
> - 执行期间内容持续增长 → `stableCount` 永远归零 → 会跑满 60 帧。
>
> 可达路径：用户打开一个**正在流式的会话**（或点新建会话后立刻发送），`pendingInitialScrollRef` 在 session 变更时被置真（`:591`），随后流式内容每帧长高 → 该循环与新的 follow rAF **同时写 `scrollTop` 约 1 秒**；此时用户上滑也拉不回。
> 这直接违反 §2.1.4「用户一旦离开底部，任何已排队的自动跟底都不得夺回滚动位置」和 §2.2「后续流式更新造成的程序化 `scrollTop` 写入次数为 0」。§10.4 把它算作"initial settle"的 claim，但 §2.3 非目标又声明"只替换流式跟底这一位 writer"，实际是**两个 writer 并发**。
> 建议：要么在阶段 2 一并给它加 `isUserScrolledUpRef` 守卫与用户滚动取消，要么在 §2.2 指标里明确豁免"initial settle 窗口"，不能两者都不做。

> [!WARNING] **`isUserScrolledUpRef` 的同步写入点只列了 2 处，实际至少 4 处（§4.6 第 5/6 点）**
> 目前 ref 与 state 的关系是"state → ref 的镜像 effect"（`useChatSessionState.ts:416-418`）。要满足 §4.6 第 5 点"先写 ref 再写 state"，必须逐点排查所有写入 `isUserScrolledUp` 的位置，否则 ref 会被镜像 effect 反向覆盖，出现顺序依赖的隐性 bug：
> 1. `handleScroll` 中 `setIsUserScrolledUp(!nearBottom)`（`:508`）；
> 2. session 变更 reset 里的 `setIsUserScrolledUp(false)`（`:596`）——**计划未提及，且会被镜像 effect 写回 ref**；
> 3. `handleScroll` 闭包/`scrollToBottomAndReset`（`:426-433`）路径；
> 4. 暴露给 composer 的 setter（计划已提，仅 1 处）。
> 建议：在计划里写清"**删除 `:416-418` 的镜像 effect，改为每个写入点同时更新 ref 与 state**"，并补一条"ref 与 state 任意时刻相等"的测试；只改 handleScroll 一处会留下 reset 路径的竞态。

> [!TIP] **rAF 里发布 ≠ 同帧绘制；§4.1 时序图可能差一帧（§4.1、§2.1.3）**
> `notify` 的实现是 `setTick(n => n + 1)`（`useSessionStore.ts:606-610`），在 rAF 回调里调用属于非 React 事件上下文。React 18 会批处理，但**并发调度不保证本次 commit 落在当前帧的 paint 之前**——很可能推到下一个 tick 才提交。于是 §4.1 画的"store commit → React/Markdown commit → 单个 follow rAF → 贴底"会整体后移一帧，"文字先长、视口后跳"会以 1 帧粒度残留。
> 建议：在 §2.2 明确给出可接受的定义（"≤1 帧相位差"），并让阶段 0 trace 记录 **publish→paint 的延迟**而不只是 publish 间隔；若确实要求同帧，再评估 `flushSync`（但会牺牲批量，需一并测量）。

> [!TIP] **跟底频率翻倍会同步放大 `scroll` 事件风暴，指标未覆盖（§4.6、§2.2）**
> 贴底写入只在 `scrollTop` 真正变化时才触发事件，而流式期间 `scrollHeight` 持续增长 → 几乎**每次 follow 写都会触发一次 `scroll`**，进而跑 `handleScroll`（`useChatSessionState.ts:502-541`，内含 `isNearBottom()` 布局读取、`scrollPositionRef` 写入、近顶/load-all 判定）。频率从 ~10Hz 提到 20–30Hz，这个 handler 的执行次数与布局读取同样翻 2–3 倍，但它是**主线程同步开销，不计入 React commit**，§2.2 的 commit P95 指标会漏掉它。
> 建议：把 `scroll` listener 改为 passive，并对"程序化写入引起的 scroll 事件"做短路（例如写前打标记、handler 首行消费标记后直接返回），至少在阶段 0/3 把 scroll handler 耗时列入 trace 观测项。

> [!NOTE] **关于 Claude 提出的 `drop` 时序 CAUTION：当前实现下已被同步顺序消解（§4.4、§6.1 测试 13）**
> 核对 `src/modules/chat/hooks/useChatRealtimeHandlers.ts:211-217`：`stream_end` 分支里 `flushNow → finalizeStreaming → drop` **三者在同一个调用栈内同步完成**，中间没有 `await`/微任务让步；`complete` 分支（`:238-242`）同样同步，且由 `has(sid)` 兜住避免二次收尾。因此第二轮的 `stream_delta` 不可能插到 `drop` 之前——除非未来把这三步中的任一步改成异步。
> 建议不必按 CAUTION 处理；改为在 §4.4 补一句"**这三步必须保持同步，禁止在中间引入 await**"并加一条注释/测试守住该约束即可。§6.1 测试 13 也应从"结果断言"补一条"end 后紧接 delta 仍从空内容开始"的时序断言，两条一起就完整了。

### 牵头结论

- 部分采纳：`drop` 串轮风险（来源：Claude；WorkBuddy 复核）。当前 `stream_end` 与 `complete` 两条路径都是 `flushNow → finalizeStreaming → drop` 同一同步调用栈，实际不存在可插入 delta 的异步窗口；不增加 finalized 状态，也不把 drop 移入 store。采纳其长期约束价值，在 §4.4 明确禁止中间 `await`/让步，并把“end 返回后立即到下一轮 delta”加入测试。
- 不采纳：新增 `visibilitychange` 跟底入口（来源：Claude）。批注混合了 CloudCLI 内部 Chat tab inactive 与浏览器页面后台两种状态：前者已有 `wasChatActiveRef` 的 reactivation restore，后者不会触发本方案的主动取消，排队 rAF 会在浏览器恢复调度后继续。新增入口会形成额外滚动 writer。已在 §4.6 澄清两种路径并补验收。
- 部分采纳：可见延迟 P95 ≤ 50ms 偏乐观（来源：Claude）。原指标明确从前端收到 WS delta 计时，不应重复计入服务端 50ms；但确实混淆了 store publish 与真正 paint。§2.2 已拆成“原始 delta→paint、receive→publish、publish→paint”三段，以显示帧表达 React 相位，并把 60Hz 端到端目标定为 P95 ≤ 100ms。
- 采纳：React 批处理必须用 trace 验证（来源：Claude）。进一步采纳 WorkBuddy 对判据的纠正：关键不只是 commit，而是 store merge。§2.2、§4.5、阶段 0/3 已同时记录 merge/notify/commit 次数。
- 部分采纳：服务端跨通道顺序需确认（来源：Claude）。源码已确认 `createDeltaBatcher` 在 channel 变化时先 flush，且已有 channel-change 单测；不把它当未确认风险。采纳补强建议，增加 thinking→text→thinking 交错服务端测试与前端最终行顺序测试。
- 采纳：Provider delta 硬规则纳入本轮（来源：Claude）。§6.3 与 §10 已规定新 token-stream Provider 必须输出可拼接 delta，runtime 必须接入 `createDeltaBatcher`，并同步架构文档；不增加运行时注册表校验，因为现有 adapter/runtime 测试已是更贴近边界的验证点。
- 采纳：明确首次发布判定（来源：Claude）。`lastPublishedAt` 改为 `number | null`，`null` 表示首帧，不受 32ms 限制。
- 采纳：补齐所有依赖 100ms cadence 的消费者、注释和每秒 CPU/耗电指标（来源：WorkBuddy）。§2.2、§5、阶段 0/3、§8、§9 已纳入 tool grouping、Markdown、store merge、React commit、scroll handler 的每秒累计成本，最终 32/48ms 不再只看单次 commit 和 long task。
- 采纳：双 dirty 通道改为原子 store batch（来源：WorkBuddy）。registry 每 pump 只回调一次；`updateStreamingBatch` 一次复制 realtime 数组、一次 `computeMerged`、一次 `notify`。不再依赖 React 自动批处理掩盖 store 侧重复计算。
- 采纳：initial settle 是直接竞争的滚动 writer（来源：WorkBuddy）。§2.3 已收窄非目标，§4.6 要求 settle 每帧检查用户 ref、用户脱离即终止，§6.2 增加对应时序测试。
- 采纳：统一 `isUserScrolledUp` 的 ref/state 写入口（来源：WorkBuddy）。§4.6 明确删除镜像 effect，handleScroll、session reset、composer 和测试全部经过唯一同步 setter，避免只修一个调用点。
- 采纳：rAF publish 不保证当前帧完成 React paint（来源：WorkBuddy）。新增 publish→paint、paint→follow 指标，允许最多一帧相位差；首版明确不使用 `flushSync`，避免用同步渲染破坏批处理收益。
- 部分采纳：程序化贴底引发 scroll handler 风暴（来源：WorkBuddy）。采纳阶段 0/3 记录次数与累计耗时；不预先添加 passive/程序化事件短路。`scroll` 本身不可取消，passive 不会消除执行成本；短路标记存在误吞相邻真实用户事件的风险，只有 trace 证明成为瓶颈后再单独设计。
- 修订说明：方案已从“registry + 一个 follow writer”扩充为“registry channel batch + session-store 原子事务 + follow/initial-settle 用户意图统一 + 完整 cadence 消费者和三段性能观测”；服务端生产代码仍不改，只增加契约测试和架构硬规则。Claude、WorkBuddy 的原始批注全部保留未改写。

### Claude · 第二轮审阅

> [!WARNING] **`updateStreaming` 旧 API 去留未定，§5 文件清单与 §6.4 回归清单不自洽（§5、§6.4）**
> 代码核实：`streamedReplyEcho.test.tsx:83,105` 直接调用 `result.current.updateStreaming('session-1', ...)`（单通道），`useSessionStore.ts:862` 定义，`ChatInterface.tsx:96` 是唯一生产消费点。§5 计划“用 `updateStreamingBatch` 替换逐通道 `updateStreaming` 热路径”，但文件清单未列 `streamedReplyEcho.test.tsx` 的适配改动，§6.4 却把它列为“应通过”的回归。若替换后删除或变更 `updateStreaming` 签名，该测试会挂。建议写明：`updateStreaming` 保留为 `updateStreamingBatch` 的单通道薄包装（接口不变、测试兼容），或将 `streamedReplyEcho.test.tsx` 补进 §5 适配清单。

> [!WARNING] **原子 batch 内两行首次创建的 timestamp 需各自独立冻结（§4.5）**
> 现有 `updateStreaming`（`useSessionStore.ts:872`）“每行冻结各自首次 timestamp”，注释（`:869-871`）明说这是防止思考行漂到正文之下、顺序被 swap 的关键。若 `updateStreamingBatch` 为省一次 `Date.now()` 而共享单一时间戳，thinking/text 两行首次创建时 timestamp 相同，会让后续排序失去稳定锚点。建议 §4.5 明确“每行独立取各自首次创建时刻，batch 内不共享时间戳”，并补一条“thinking 与 text 同批首建时顺序稳定”的 store 契约测试。

> [!NOTE] **§2.2 “每秒主线程预算”缺测量方法，阶段 0/3 的对比不可重复（§2.2、§7 阶段 0）**
> “记录 100 条消息窗口内每秒累计的 store merge、tool grouping、Markdown、React commit、scroll handler 时间”没有定义埋点方式（`performance.mark` + PerformanceObserver？手动打点？）和窗口语义（固定时间窗还是消息计数窗）。建议补一句测量协议（在哪埋点、采样窗口多长、如何归一化到每秒），否则改前/改后两组 trace 无法对齐，32/48ms 的取舍依据会被质疑。

> [!NOTE] **决策 9 的硬规则缺自动强制；32ms 防御上限只保护渲染频率，不保护正确性（§10 决策 9、§4.3）**
> 牵头结论确认“不增加运行时注册表校验”。未来新 Provider 绕过 `createDeltaBatcher` 直接送累计全文时：32ms 限频能挡住 60Hz 渲染风暴，但 `append` 会把累计全文当 delta 重复追加、内容翻倍——这类错误只剩 code review 拦截。建议至少在架构硬规则旁附“新 Provider 接入 checklist”（输出 delta、接入 batcher、双通道顺序），或为各 adapter 的 streaming fixture 加一条“相邻两次 append 内容严格增长”的 smoke 断言；不做也行，但请承认这是纯文档约束。

> [!TIP] **batch 创建行的插入位置语义应与现有 push 末尾一致（§4.5）**
> 现有 `updateStreaming` 对首次出现的通道行是 `[...realtimeMessages, msg]`（追加末尾），`finalizeStreaming` 只原位替换不重排，行顺序由创建顺序决定。`updateStreamingBatch` 若“按 thinking、text 顺序创建占位行”，需明确两行都追加到数组末尾且 thinking 在前，避免与逐通道 push 的既有数组形态（尤其与其他 realtime 消息交错时）不一致。

### WorkBuddy · 第二轮审阅

先确认已核实的部分（不再重复）：服务端 `createDeltaBatcher` 确实在 channel 变化时先 flush（`server/shared/utils.ts:480-487`），所以 §4.5 的通道顺序前提成立；`StreamingChannelUpdate` 放 `src/shared/types.ts` 也符合前端规范的“两处以上使用即入 shared”（`frontend-module-standards` 的 Place types by usage）；`setIsUserScrolledUp` 的既有消费方只有布尔调用（`useChatComposerState.ts:66,874`），改成唯一写入口不会有 updater 形式兼容问题。以下是我认为**修订后仍然存在的问题**。

> [!WARNING] **每秒主线程预算的清单仍漏了 `normalizedToChatMessages`（§2.2、§7 阶段 0、§9）**
> §2.2 已把 duty cycle 观测扩到 store merge / tool grouping / Markdown / React commit / scroll handler，但漏掉了这条触发链的**第一环**：`useChatSessionState.ts:386-393` 的 `chatMessages` useMemo 以 `storeMessages` 为依赖，每次 publish 都会重跑 `normalizedToChatMessages(storeMessages)`（`src/modules/chat/hooks/useChatMessages.ts:81` 起）：全量 O(N) 遍历 + 多个 `Map`/`Set` 分配 + 逐条 `formatToolResultContent`，之后 `visibleMessages`（`:952-955`）再切一次数组、`groupConsecutiveTools` 再跑一次。
> 它是 tool grouping 的上游，也随 tick 率线性放大，而且量级与被点名的 tool grouping 同阶。按现在清单做 trace，duty cycle 仍会被低估。
> 建议：把 `normalizedToChatMessages`（含 `visibleMessages` 切片）与 `computeMerged` 一起列为必须计时的项，并考虑给 100 条窗口的样本单独记一行。

> [!WARNING] **并发多会话流式时“每帧 merge 次数 = N”，方案的性能建模只覆盖单活跃流（§2.2、§7 阶段 0、§8）**
> `notify` 有 active-session 门（`useSessionStore.ts:606-610`），但 `recomputeMergedIfNeeded`（`:884`）**无条件执行**，新的 `updateStreamingBatch` 同样如此；registry 也完全不知道 `isActive`，隐藏 Chat tab 仍会为每个 session 各排一个 rAF 并在 20–30Hz 下持续 publish（`useChatRealtimeHandlers.ts:200-209` 对任意 `sid` 都 append）。也就是说**每条并发流独立贡献一次每帧 merge + 一次 rAF 回调**。
> 按仓库自述 ~1.2ms/次 merge 反推：3 条并发后台流 ≈ 70+ 次 merge/秒 ≈ 80ms/s 纯合并开销，且这些会话**当前不可见**。方案把频率从 10Hz 提到 20–30Hz，等于把这个开销也翻倍，而 §2.2 的指标、阶段 0 的 trace 和 §8 的风险表都只按一条活跃流建模。
> 建议：① 明确本轮的性能承诺是“单活跃流”还是“N 条并发流”；② 给 registry 增加一个“非 active session 只走 watchdog（例如 ≤5Hz 合并）或仅在重新激活时收敛”的策略——内容不会丢（buffer 继续累计，`becomeActive` 恢复位置），但后台空转成本能直接压掉；③ 阶段 0 的样本里加一个“3 条并发流 + 1 条可见”的对照。

> [!TIP] **§4.5 的“thinking 先于 text”应精确表述为“同一次 batch 内首次创建时”**
> 行顺序实际由**通道首次出现的批次**决定：若 text 先于 thinking 到达（不同 batch），text 行先建、thinking 行后建，顺序就是 text 在上。§4.5 现在写“三层守住 thinking 先于 text”，容易被实现成“把 thinking 行挪到 text 行之前”，那会破坏真实的交错顺序。
> 建议：写明“batch 内顺序**只用于首次创建时的稳定锚点，不得对已存在的行重排**”，并补一条“先 text 后 thinking 到达时不被重排”的 store 契约测试（与 §6.3.2 的“同批首建”测试互补）。

> [!NOTE] **§4.2 只声明了 `lastPublishedAt` 的初值，没声明 `publishedText` / `publishedThinking` 的初值（§4.2、§6.1）**
> dirty 判定完全依赖 `buffer.text !== buffer.publishedText`。§4.2 明确了 `lastPublishedAt === null` 表示未发布，但没写两个 `published*` 的初始化值。若实现时图省事初始化成“创建时的累计内容”（看似更“已发布”），首帧就永远不会 dirty，首字会被吞到下一次 delta —— 这与 §2.2「WS 接收 → store publish 下一合格动画帧」直接冲突。
> 建议：把“buffer 初始化契约”与 `lastPublishedAt` 并列写进 §4.2：`publishedText` / `publishedThinking` 一律初始为 `''`，并在 §6.1 加一条“首个 delta 即 dirty”的断言。

> [!NOTE] **§5 对 `updateStreaming` 影响面的清单仍不完整（补全 Claude 指出的那一处）**
> Claude 已指出 `streamedReplyEcho.test.tsx` 未列入 §5。核对后直接触及 `updateStreaming` 的文件共 4 个，建议一次列全，否则按现清单实施会直接红一片：
> - `src/modules/chat/tests/streamedReplyEcho.test.tsx:83,105`（直接调用单通道 API）；
> - `src/modules/chat/tests/thinkingStreamStore.test.tsx`（9 处调用：`:82,83,103,107,113,133,134,149,171`；§5 已列入，但改为 batch 后这些断言要整体重写）；
> - `src/modules/chat/tests/transcriptScrollOwnership.test.tsx:89`（把 `updateStreaming` mock 成 `vi.fn()`，改名后要同步）；
> - `src/modules/chat/tests/streamingBufferSessionScope.test.tsx`（9 条 `assert.deepEqual` 钉死了 registry flush 回调的**四元签名** `[sessionId, channel, text, provider]`：`:111,126,139,143,156,171,174,186,198`，§4.2 改成 batch 回调后这是签名级重写，不是“确认仍隔离”）。
>
> 另外建议在 §5 明确 `updateStreaming` 的去留：保留为 `updateStreamingBatch` 的单通道薄包装（测试零改动），还是删除（则上述 4 个文件全部进清单）。

> [!TIP] **改了服务端测试，但全量验证门禁里没有服务端测试（§6.3、§6.4、§7 阶段 3）**
> §5 明确要改 `server/shared/tests/delta-batcher.test.ts`，§6.3 给了单文件命令（形式与仓库 `package.json` 的 `test` 脚本一致，可用），但 §6.4 的“随后执行”只有 `test:client / build:client / typecheck / lint:client`，§7 阶段 3 第 4 步也写的是“执行全量前端验证”。`typecheck` 虽含 server 但只做类型检查，**服务端契约测试不会进入最终门禁**。
> 建议：在 §6.4 / 阶段 3 补 `npm test`（仓库既有的服务端全量测试入口），避免新增的 channel 交错契约测试只在定向命令里跑过一次。

### 牵头结论 · 第二轮

- 采纳：明确旧 `updateStreaming` 的去留（来源：Claude、WorkBuddy）。保留原签名作为 `updateStreamingBatch` 的单通道薄包装，生产热路径只使用 batch。§5 已列出四个直接影响测试文件，并区分“调用签名保留”和“mock / registry callback 需适配”。
- 部分采纳：原子 batch 内 timestamp 独立冻结（来源：Claude）。每个新行独立取得并冻结首次 timestamp，不共享一个 batch timestamp；但不要求两个 ISO 时间值必须不同，因为同步创建可能落在同一毫秒。稳定顺序由尾部 append 顺序和稳定排序保证，不通过伪造时间实现。§4.5、§6.3 已补同批首建、相等 timestamp 和跨批不重排测试。
- 采纳：补充可重复测量协议（来源：Claude）。§4.9 固定 replay、设备/窗口、5 秒预热、30 秒采样、3 次运行，并规定 `performance.measure`、React Profiler、paint proxy 和 ms/s 归一化方式；这些均为实施期临时诊断，不进入生产 telemetry。
- 采纳：Provider 硬规则需要自动验证和接入 checklist（来源：Claude）。各 Provider fixture 以“按序拼接 delta 严格等于最终全文”作为正确性断言，同时更新架构文档和 Provider 接入 SOP。没有采纳“相邻 append 内容严格增长”的表述，因为 delta 片段本身无需单调变长；也不增加运行时注册表校验。
- 采纳：新行保持现有尾部 append 语义（来源：Claude）。已有行原位替换，新行按 batch 顺序追加到数组末尾，不重排无关 realtime 消息。
- 采纳：主线程预算补齐 `normalizedToChatMessages` 与 `visibleMessages` slice（来源：WorkBuddy）。指标、埋点协议、阶段 0/3 和验收模板均已单列二者。
- 采纳：纳入并发多会话流式策略（来源：WorkBuddy）。当前可见 session 继续 rAF + 100ms watchdog；不可见 session 仅用 200ms timer，最高 5Hz，切换为可见时同步 flush 最新累计值。新增“1 条可见 + 3 条不可见”基准和 cadence/收敛测试，不把性能承诺局限在单流。
- 采纳：收窄 thinking-first 语义（来源：WorkBuddy）。只保证同批两行首次创建时 thinking 先 append；若 text 已在更早批次创建，后到 thinking 必须留在末尾，不得重排历史顺序。
- 采纳：明确 `publishedText` / `publishedThinking` 初始化（来源：WorkBuddy）。两者固定从 `''` 开始，并增加首个 delta 立即 dirty 的测试。
- 采纳：补齐 `updateStreaming` 四处测试影响面（来源：WorkBuddy）。`streamedReplyEcho` 保留旧调用；`thinkingStreamStore` 同时覆盖薄包装与 batch；`transcriptScrollOwnership` 补 store mock；`streamingBufferSessionScope` 改为 batch 回调签名断言。
- 采纳：最终门禁加入服务端全量测试（来源：WorkBuddy）。§6.4 和阶段 3 均增加 `npm test`，避免服务端 channel 交错契约只跑定向用例。
- 修订说明：第二轮没有推翻“latest-state commit”主路线，但补全了兼容接口、每行顺序语义、可重复性能方法和多会话后台 cadence。两位审阅者的第二轮原始批注继续完整保留，正文已与上述结论同步。
