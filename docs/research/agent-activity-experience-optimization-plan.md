# CloudCLI 思考过程与工具活动体验优化方案

> 状态：第二轮复审已汇总，方案已修订，待实施确认
> 日期：2026-09-12
> 范围：思考过程展开/收起、命令与工具活动状态、子代理摘要、折叠引起的滚动稳定性
> 首期边界：只调整现有前端展示状态，不修改 Provider 协议或持久化格式
> 关联文档：`docs/research/thinking-streaming-plan.md`、`docs/research/streaming-output-experience-optimization-plan.md`、`docs/architecture/05-scrolling.md`

## 0. 结论先行

本方案首期选择：**用户意图优先、由事件驱动的渐进披露（progressive disclosure）**。

- 思考流式进行时默认展开，让用户持续看到模型在工作。
- 最终正文开始后不立即收起思考；在最终正文首次可见至少 2.5 秒后，满足安全条件才自动收起。工具前后的普通 assistant preamble、任务通知及其派生结果不算最终正文；若晚到工具证明流式文本其实是 preamble，已自动收起的思考会恢复展开并保持到本轮 terminal。
- 自动收起不再只依赖“思考流结束 + 固定 1 秒”。没有正文、用户正在阅读、用户已离开底部或用户手动操作时，均不自动收起。
- 用户手动展开或收起后，本轮都不再由程序反向覆盖其选择。
- 命令和工具维持紧凑行展示；运行中增加可感知的耗时，完成后保留结果摘要，错误提供就地诊断入口。
- 工具组和子代理默认呈现“现在做什么、做了多少、结果如何”，完整细节继续按需展开。
- 首期不实现 stdout/stderr 实时 tail。当前多数 Provider 只在 `toolResult` 到达时给出完整输出，强行在前端模拟会制造假进度。真正的命令输出增量协议作为二期单独设计。

首期不是把 `AUTO_CLOSE_DELAY` 从 1000 改成另一个常量。当前组件不能识别正文是否已经开始，也不能可靠区分用户操作与程序操作；必须补齐状态输入和所有权规则，否则延迟改长仍会出现抢控制权、布局跳动和不同工具行为不一致。

## 1. 背景与现状

### 1.1 当前思考块行为

当前链路如下：

```text
thinking stream_delta
  → 独立 thinking 行
  → MessageComponent
  → Reasoning(isStreaming=true)
  → 默认展开并流式渲染

stream_end / complete
  → thinking 行 finalize
  → Reasoning(isStreaming=false)
  → 固定等待 1000ms
  → 自动收起
```

已确认事实：

1. `Reasoning.tsx` 的 `AUTO_CLOSE_DELAY` 固定为 1000ms。
2. 流式开始时，只要面板关闭且 `defaultOpen !== false`，effect 会再次将其打开。
3. 自动收起只看 `isStreaming`，不知道正文是否已经出现。
4. `MessageComponent` 只接收上一条消息，不知道当前思考行后面是否已有正文。
5. 思考和正文是两条独立消息，正文开始不会直接改变思考组件的状态。
6. 折叠会移除一块可变高度内容；若用户没有贴底或正在阅读，视口会产生可感知位移。

当前优点需要保留：

- 思考内容实时可见，不再出现长时间空白等待。
- thinking/text 通道互相独立，正文不会覆盖思考。
- 思考结束后仍可重新展开查看。
- 历史消息、导出模式和 `showThinking=false` 已有明确处理路径。

### 1.2 当前命令与工具展示

| 类型 | 当前行为 | 已有优点 | 主要缺口 |
| --- | --- | --- | --- |
| Bash 命令 | 单行命令、spinner、结果行数、点击展开；成功和失败均默认收起 | 密度低，命令可复制 | 无运行耗时；失败详情默认隐藏；完整输出通常到结束才出现 |
| 普通工具 | 按配置显示 one-line 或 collapsible；有 running/error/denied/stopped badge | Provider 状态已统一 | 完成态常没有摘要；不同工具默认展开规则分散 |
| 连续工具组 | 默认收起，异常时自动展开 | 能压缩大量重复工具 | 运行中看不出整体进度；摘要主要是工具数和 preview |
| 子代理 | 默认收起；内部最多先渲染 25 条活动 | 避免长时间线拖慢页面 | 运行中缺少耗时和当前动作；用户需展开才知道进展 |
| 计划/提问 | 默认展开，权限操作保持可见 | 关键交互不易遗漏 | 应明确排除在自动收起策略之外 |

### 1.3 外部产品原则

公开资料能确认的共性，而非像素级复刻：

- 豆包的公开演示强调运行期间展示动态思考、搜索与框架构建过程，完成后进入结构化结果展示；没有公开自动折叠毫秒数。
- OpenAI 官方文档把 preamble 定义为工具调用前的简短、用户可见说明，并明确工具之间可以出现多条进度消息。可借鉴的原则是“持续解释正在做什么”，不是让原始过程永久占据正文。
- 两者都支持“运行过程可感知、最终结果占主视觉、历史过程可回看”的渐进披露方向。

参考：

- OpenAI Model guidance — Preambles：<https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.2#preambles>
- 豆包深度思考公开演示说明：<https://www.toutiao.com/article/7587294706141495844/>

## 2. 目标、指标与非目标

### 2.1 产品目标

1. 思考转正文时不产生“内容刚看见就消失”的突兀感。
2. 程序默认行为不得覆盖用户在本轮做出的展开/收起选择。
3. 用户即使不展开工具详情，也能知道当前活动、持续时间和最终结果。
4. 成功活动保持紧凑，失败、拒绝和等待用户操作的活动具有更高视觉优先级。
5. 自动折叠不得夺回用户滚动位置或打断文本选择。
6. 桌面与 iOS H5 使用同一语义，只允许响应式布局不同。

### 2.2 可验证指标

| 指标 | 首期门槛 |
| --- | --- |
| 最终正文首屏可见后思考自动收起等待 | 不少于 2500ms |
| 正文尚未出现时 | 不因 `isStreaming=false` 自动收起 |
| 用户手动切换后 | 本轮程序反向切换次数为 0 |
| 用户已上滑、面板 hover/focus、存在文本选择时 | 自动收起次数为 0 |
| 自动折叠动画 | 180–240ms，并尊重 `prefers-reduced-motion` |
| 自动折叠触发范围 | 仅限仍贴底的视口；非贴底时不进入自动折叠路径 |
| 贴底自动折叠后的稳定状态 | 仍贴底，正文锚点不发生可感知跳动 |
| 运行中活动状态刷新 | 耗时标签按 1s 更新，不触发全会话消息重建 |
| 异常工具 | 错误/拒绝/停止状态在折叠态可见，错误详情最多一次点击可达 |
| 自动化回归 | 相关定向测试、前端全量、typecheck、lint、build 通过 |

### 2.3 非目标

- 不显示 Provider 未提供的隐藏思维链。
- 不合并或改写 thinking/text 的底层消息通道。
- 不修改流式正文 32ms/100ms/200ms 调度方案。
- 不改变工具权限、执行和取消语义。
- 首期不增加数据库字段，不持久化每条消息的展开状态。
- 首期不实现命令 stdout/stderr 增量传输。
- 不做统一的全站动画系统或无关 UI 重构。

## 3. 方案选择

| 路线 | 做法 | 优点 | 问题 | 结论 |
| --- | --- | --- | --- | --- |
| A. 只把 1 秒改成 3 秒 | 修改一个常量 | 改动最小 | 仍不知道正文是否出现；仍会覆盖用户意图；仍可能跳动 | 拒绝 |
| B. 正文出现后固定收起 | 思考行感知后续正文，延迟 2.5 秒收起 | 转场更自然 | 若用户正在阅读仍可能打断 | 不完整 |
| C. 事件驱动 + 用户意图门 | 路线 B，加用户操作、滚动、hover/focus/selection 条件 | 行为可解释、可测试、尊重用户 | 状态输入较多 | **选择** |
| D. 永不自动收起 | 完全交给用户 | 不打断阅读 | 长思考长期挤压正文，移动端尤其明显 | 拒绝 |

## 4. 首期详细设计

### 4.1 思考块状态输入与最终正文判定

`Reasoning` 新增五个展示输入，不写入 Provider 原始消息：

```ts
type ReasoningProps = {
  isStreaming?: boolean;
  finalAnswerStarted?: boolean;
  isAutoCollapseCandidate?: boolean;
  isSupersededThinking?: boolean;
  suppressAutoCollapse?: boolean;
  disclosureKey?: string;
  // existing props...
};
```

- `finalAnswerStarted`：同一用户轮次内已经出现可判定为最终回答的 assistant 正文。
- `isAutoCollapseCandidate`：当前块是否为本轮最新 thinking 且已具备自动收起条件；同时控制候选期 selection 监听。
- `isSupersededThinking`：当前块之后已出现更新的 thinking，用于逐块接管并收起旧块。
- `suppressAutoCollapse`：聊天视口已离开底部，或外层存在不适合改变布局的状态。
- `disclosureKey`：本轮 thinking 块的稳定展示键，用于在 LazyMessageRow 卸载/重挂后恢复用户所有权和可见耗时。
- 这些字段都是展示派生值，不污染 Provider 原始消息或持久化格式。

最终正文不能简单定义成“任意普通 assistant 文本”。OpenAI preamble 也可能作为独立 assistant 文本出现；若把它当正文，思考块会在随后几十秒的工具执行期过早收起。

首期使用以下可执行判定：

1. 非 thinking、非 tool、非任务通知、非任务通知派生结果且内容非空，才是正文候选。`useChatMessages` 投影任务通知结果时新增 `isTaskNotificationResult=true`，不依赖 `isProcessing` 间接猜测来源。
2. 候选若 `isStreaming=true`，并且它之后尚无运行中/新增工具，则暂视为流式最终正文；若随后出现工具，立即撤销候选并取消 timer。若工具到达时块已进入 `COLLAPSED_AUTO`，reducer 将其恢复为 `OPEN_AUTO`，并标记 `deferAutoCollapseUntilTerminal=true`：本轮剩余 processing 期间不再反复收起，terminal 后若存在最终正文，再重新给予完整 2500ms 窗口。
3. 候选若不是流式行，只在当前会话已经 `isProcessing=false` 且其后没有工具时视为最终正文。这样 Codex 等不流式发送最终文本的 Provider 会在整轮 terminal 后进入收起流程，preamble 不会误判。
4. 挂在 tool 消息 `displayText` 上的说明天然随 tool 排除。

`ChatMessagesPane` 对当前 `visibleMessages` 做一次从后向前的 O(n) 扫描：

1. 遇到 user 消息时重置本轮正文候选、后续工具标记和 thinking 序号。
2. 遇到工具消息时标记该轮候选之后存在工具；运行中工具同时阻止最终正文成立。
3. 遇到正文候选时按上述流式/terminal 规则判定。
4. 遇到 thinking 消息时，只让本轮最新一块成为正文驱动的自动收起候选；新块出现时，reducer 对此前最新且所有权仍为 `AUTO` 的 thinking 派发一次 supersede 收起动作。该动作仍经过 hover/focus/selection、上滑和导出 guard；guard 解除后再执行，不为所有旧块同时启动正文 timer。
5. 工具状态、子代理和任务通知不作为正文，也不重置轮次。

该映射放在 `ChatMessagesPane` 的现有 `useMemo` 邻近位置，仅供本次渲染传参。`visibleMessages` 是已加载消息的后缀切片，LazyMessageRow 只卸载 DOM 子树、不裁掉数组元素；因此 thinking 之后的正文不会因 DOM 虚拟化丢失。分页窗口若切在旧 turn 中间，信息不足时按 false 处理，宁可晚收。

不要直接使用当前 `getIntrinsicMessageKey` 作为展示状态键：无稳定 id 的流式文本会把 content preview 纳入 fallback key，内容增长时可能变化。`disclosureKey` 应由 `sessionId + thinking 行自身 timestamp + thinking 在本轮的序号` 组成，避免 user 行在 edit/rewind 替换时带动整轮 key 变化；finalize 保留 thinking timestamp，因此内容增长和流式结束前后键均不变。只有 thinking timestamp 缺失时，才退回当前窗口序号，并接受该历史行不跨重挂保留用户选择。

### 4.2 用户意图状态机

`ChatMessagesPane` 维护当前所选会话的非持久化 disclosure registry；`Reasoning` 只负责渲染与上报交互。registry 按 `disclosureKey` 保存用户所有权、自动收起状态和可见计时边界，使 LazyMessageRow 在 1200px 观察带外卸载子树后仍能恢复状态。`selectedSession.id` 改变时清空 registry，ChatInterface 卸载时自然释放；首期保证的是当前会话内的 DOM 虚拟化稳定，不承诺切换会话后保留展开偏好，也不写 session store 或浏览器存储。

registry 记录至少包含：

```ts
type ReasoningDisclosureState = {
  ownership: 'auto' | 'user_open' | 'user_closed';
  autoCollapsed: boolean;
  hasEverStreamed: boolean;
  deferAutoCollapseUntilTerminal: boolean;
  streamStartedAtMs?: number;
  visibleDurationSeconds?: number;
};
```

该类型会跨 `ChatMessagesPane`、`MessageComponent` 和 `Reasoning` 使用，实施时放入 `src/shared/types.ts` 的聊天消息相关分组并逐项注释。registry 固定使用 `useReducer` 更新，用户点击、supersede、晚到工具恢复和自动收起都作为 action；reducer 在处理自动 action 时基于最新 `ownership` 与 guard 快照二次校验，禁止陈旧 timer 覆盖同 tick 的用户操作。下传的读取器与 dispatch 包装使用 `useCallback` 保持稳定，避免破坏未变化消息行的 memo。1 秒耗时 tick 仍留在具体可见组件内，不写 registry。历史 settled thinking 若没有 registry 记录，保持当前默认收起；只有本次 UI 生命周期内实际流式过且没有正文的块才保持展开。

```text
                 thinking starts
AUTO ─────────────────────────────────▶ OPEN_AUTO
 │                                          │
 │ user toggles                             │ finalAnswerStarted + 2500ms
 ▼                                          │ + all guards pass
USER_OPEN / USER_CLOSED ◀───────────────────┘
 │                                          ▼
 └──────── program never overrides ─── COLLAPSED_AUTO
                                             │ late tool while processing
                                             └──────────────▶ OPEN_AUTO
```

状态语义：

- `AUTO`：用户尚未操作，程序可按默认规则管理。
- `USER_OPEN`：用户主动展开，本轮保持展开。
- `USER_CLOSED`：用户主动收起，本轮保持收起；后续 thinking delta 不得重新打开。
- `COLLAPSED_AUTO`：程序已自动收起；用户仍可重新打开，随后进入 `USER_OPEN`。

关键约束：

1. 不能只凭 Collapsible 的 `onOpenChange` 判断用户操作。只有 Trigger 的 pointer/keyboard 事件路径写入 `USER_OPEN`/`USER_CLOSED`；程序自动展开/收起走独立入口，不经过用户事件入口。
2. `isStreaming=true` 只在所有权仍为 `AUTO` 时自动展开。
3. `finalAnswerStarted=false` 时禁止启动收起 timer。
4. `finalAnswerStarted=true` 且所有权为 `AUTO` 时，启动 2500ms timer。
5. timer 到点重新检查全部 guard，而不是相信排队时状态。
6. 自动收起 action 在 reducer 内再次检查最新所有权；用户 action 与 timer 同 tick 时，用户所有权优先。
7. `finalAnswerStarted` 变回 false、组件卸载或任一 guard 失效时取消 timer；组件卸载不清除 pane registry。
8. 已自动收起后出现晚到工具且会话仍 processing，恢复展开并锁定到 terminal，避免 preamble/tool 周期反复开合。
9. 没有正文的中止/错误轮次保持思考展开，使它作为本轮唯一有意义的输出留在屏幕上。

### 4.3 阅读保护条件

以下任一条件成立时不得自动收起：

- `suppressAutoCollapse=true`，即用户已离开底部。
- 指针仍在思考块内。
- 焦点位于思考块内部。
- 当前 Selection 与思考块 DOM 相交。
- 用户所有权不是 `AUTO`。
- 导出模式。

信号归属与监听方式：

- `suppressAutoCollapse` 直接复用 `useChatSessionState` 已有的 `isUserScrolledUp`，从 `ChatInterface` 下传；不新增 scroll listener，也不写 scrollTop。
- hover 使用 Reasoning 根节点的 `pointerenter` / `pointerleave` 局部状态。
- focus 使用根节点的 `focusin` / `focusout` 局部状态。
- selection 由显式 `isAutoCollapseCandidate || isSupersededThinking` prop 控制，仅在本块可能发生程序收起时订阅 document `selectionchange`；用一个 rAF 合并同帧高频事件，再检查 range 是否与根 DOM 相交；候选取消或卸载时移除监听与 rAF。

若 2500ms 到期但 guard 不通过，不循环每 100ms 轮询。等 pointerleave、focusout、selection 清空或 `suppressAutoCollapse` 恢复 false 后，再启动一个新的完整 2500ms 阅读窗口，避免“鼠标刚移开立即塌陷”。iOS 长按选择行为不靠 jsdom 推断，列入真机验收。

### 4.4 折叠动画与滚动稳定

- 动画时长固定 200ms，落在 180–240ms 验收区间。
- `prefers-reduced-motion: reduce` 时取消高度/透明度动画，直接切换。
- 自动收起只在 `isUserScrolledUp=false` 时发生；因此不设计“非贴底自动收起后补偿”的死分支。
- 贴底时优先依赖浏览器 max-scroll clamp 与现有单帧跟底 writer，使视口继续锚定尾部。
- `Reasoning` 不读取或写入聊天容器 `scrollTop`，也不新增折叠相位回调。
- 阶段 0 分别实测桌面浏览器和 iOS WKWebView 的 200ms 高度变化。若任一端在贴底状态出现可见跳动，首期直接取消高度动画、保留透明度/chevron 过渡；不引入逐帧 scroll 补偿或冻结滚动。

这个裁决保持 `useChatSessionState` 为唯一程序化滚动 writer，也避免动画进度与补偿进度形成新的时序耦合。

### 4.5 思考折叠后的摘要

保留现有触发器布局，文案规则为：

| 状态 | 文案 |
| --- | --- |
| 正在流式 | `Thinking…`（继续使用 shimmer） |
| 已完成且有 duration | `Thought for {n} seconds` |
| 已完成但无 duration | `Thought for a few seconds` |
| 中止/异常但有思考内容 | 沿用完成文案，不额外制造错误含义 |

首期不增加字符数或 token 数，避免暴露不稳定且跨 Provider 不可比的指标。

这里的 duration 明确定义为 **CloudCLI 可见思考时长**，不是 Provider 隐藏计算耗时：起点取 thinking 消息的有效 timestamp；终点由 `ChatMessagesPane` 在 pane 级观察该行从 streaming 转为 settled 时记录本机接收时间并写入 disclosure registry，不依赖 Reasoning 是否因 LazyMessageRow 而挂载。历史加载或任一边界缺失时降级为 `Thought for a few seconds`，不回算、不伪造。该口径与命令执行耗时不同；命令完成耗时仍要求 Provider/结果 timestamp，因为它对诊断具有更强的精确性暗示。

### 4.6 命令耗时与结果摘要

#### 运行中

- Bash 行继续保持单行紧凑展示。
- spinner 旁显示 `Running · Ns`。
- 计时起点使用工具消息 timestamp；若 timestamp 无效，仅显示 `Running`。
- 每个正在运行的已挂载行使用本地 1 秒 tick。LazyMessageRow 离开 1200px 观察带后会卸载子树，timer 随 effect cleanup 停止；不新增第二套 IntersectionObserver 或可见性状态。
- 不把当前时间写入会话 store，避免每秒触发全消息列表派生和 merge。

#### 完成后

根据已有数据展示：

- 有输出：`Completed · 2.4s · 38 lines`
- 无输出：`Completed · 2.4s`
- 无可靠结束时间：`Completed · 38 lines`

结束时间优先取 `toolResult.timestamp`；没有时不伪造执行时长。首期不以 React 收到结果的本机时间冒充 Provider 执行耗时，因为页面后台、网络延迟和历史加载都会使该值失真。

#### 失败、拒绝与停止

- header 始终显示明确状态 badge。
- Bash 失败默认仍保持整体紧凑，但在 header 下直接显示最后 3 行错误预览；点击后展开完整输出。
- denied/stopped 不自动展开无意义的空输出。
- 普通工具组保持现有“异常自动展开”行为。

这会消除当前“Bash 失败收起、工具组失败展开且没有统一摘要”的认知差异，同时避免一个超长堆栈占满屏幕。

### 4.7 工具组摘要

折叠态摘要按现有消息计算，不新增 store 状态：

```text
Tools  x7     Other 3 · Search 2 · Edit 1 · Bash 1
Tools  x7     Running: npm test
Tools  x7     Failed: Bash
```

优先级：异常 > 当前运行活动 > 完成分类统计 > 现有 preview。

- 运行中不自动展开整个组，只在 header 显示当前活动。
- 用户主动展开后保持展开，不因组完成自动关闭。
- 组完成后不闪现 `Completed` badge；分类统计本身即完成摘要。
- diff 统计继续保留，并与状态摘要并列，不覆盖错误 badge。
- 保留当前 `label + xN` 圆角徽标，不替换为新的 `Tools · N` 结构；摘要追加在现有徽标之后，降低视觉和测试回归面。

当前 `toolGrouping.ts` 只有 grouping 和 preview，没有分类映射。实施时把 `ToolRenderer.tsx` 内现有 `getToolCategory` 迁移为 `toolGrouping.ts` 的模块内公开纯函数，并新增 `summarizeToolGroupActivity(messages)`：严格沿用现有 edit/search/bash/todo/task/agent/plan/question/default 口径，不新增 read 桶；摘要将 `default` 显示为 `Other`，因此 Read/WebSearch/WebFetch 当前均计入 Other。`ToolRenderer` 和 `ToolGroupContainer` 共同复用，不建立第二份映射。

### 4.8 子代理摘要

子代理仍默认收起，避免运行几十到几百个步骤时拖慢聊天页面。header 增加：

- `Running · Ns · 12 steps`
- 当前最后一条活动的短摘要，如 `Bash / npm test` 或 `Thinking`。
- 完成后显示 `Completed · 42 steps · 20 tools`；失败保持红色，并在关闭状态下显示最多两行结果/错误摘要，但不自动挂载完整 timeline。

`steps` 明确定义为 `subagent.activityCount ?? activity.length`，包含 tool/text/thinking 全部活动；`tools` 继续使用现有 `kind === 'tool'` 计数。若没有活动，只显示现有 `done`。完整 timeline 仍只在打开时挂载，保留当前 25 条初始渲染和 Show more 策略。

折叠态最后活动直接从已存在的 `activity` prop 末项派生。Provider 新活动本来就需要进入会话消息以更新子代理，本方案不增加局部事件/ref 数据通道；§2.2 的约束只针对本地 1 秒耗时 tick 不得写 session store。失败摘要从 `resultText` 截取并移到 `showTimeline` 条件之外，完整 Result 与 timeline 仍在展开后显示，不新增第二个展开 state。

### 4.9 明确不自动收起的交互

以下内容不接入统一自动收起机制：

- 等待用户选择的 `AskUserQuestion`。
- 等待 Build/Revise 的计划面板。
- 权限请求。
- 错误详情和被拒绝状态。
- 用户主动打开的命令、工具组或子代理。

“需要用户行动”的内容优先级高于页面紧凑度。

## 5. 文件级实施清单

### 5.1 第一阶段：思考状态机

| 文件 | 修改 |
| --- | --- |
| `src/modules/chat/transcript/Reasoning.tsx` | 替换固定 1 秒逻辑；程序/用户入口分离；实现局部 hover/focus/selection guard、候选 prop 和 2.5 秒最终正文窗口 |
| `src/modules/chat/transcript/MessageComponent.tsx` | 接收可选的正文、候选、supersede、上滑状态、稳定键与 registry 回调并传给 Reasoning；ToolGroupContainer 内调用无需提供 |
| `src/modules/chat/transcript/ChatMessagesPane.tsx` | 一次反向扫描派生最终正文与 thinking 接管关系；用 reducer 维护 disclosure registry；pane 级记录 settled 时间；接收用户是否上滑 |
| `src/modules/chat/ChatInterface.tsx` | 把现有 `isUserScrolledUp` 下传，不增加新状态源 |
| `src/modules/chat/hooks/useChatMessages.ts` | 给任务通知派生结果增加 `isTaskNotificationResult` 展示标记，使正文扫描可显式排除 |
| `src/shared/types.ts` | 新增跨三个展示组件使用的 `ReasoningDisclosureState`，并为 `ChatMessage` 增加任务通知结果标记；放入对应分组并补详细注释 |
| `src/modules/chat/transcript/LazyMessageRow.tsx` | 不改行为；测试注入 fake IntersectionObserver，真实触发卸载/重挂并验证 registry 恢复 |
| `src/modules/chat/tests/useChatMessages.test.ts` | 验证任务通知摘要与派生结果分别携带正确标记，普通 assistant 文本不误标 |
| `src/modules/chat/tests/reasoningDisclosure.test.tsx` | 新增状态机与 timer 契约测试 |
| `src/modules/chat/tests/messageStreamEnd.test.tsx` | 保留流式结束 DOM 稳定回归，补正文出现后的展示断言 |

### 5.2 第二阶段：命令与工具摘要

| 文件 | 修改 |
| --- | --- |
| `src/modules/chat/tools/BashCommandDisplay.tsx` | 运行耗时、完成摘要、失败末尾预览 |
| `src/modules/chat/tools/ToolStatusBadge.tsx` | 支持可选附加摘要；不改变状态枚举 |
| `src/modules/chat/transcript/MessageComponent.tsx` | 把顶层工具消息 timestamp 传给 ToolRenderer；把子代理容器 timestamp 传给 SubagentPanel |
| `src/modules/chat/tools/ToolRenderer.tsx` | 增加可选 start timestamp；传给 Bash；把分类函数迁移到 toolGrouping 供两处复用 |
| `src/modules/chat/utils/toolGrouping.ts` | 新增唯一分类函数与 group activity 摘要纯函数，不复制 ToolRenderer 映射 |
| `src/modules/chat/transcript/ToolGroupContainer.tsx` | 在保留 `label + xN` 的前提下追加当前活动与分类统计摘要，保持异常优先级 |
| `src/modules/chat/tools/SubagentPanel.tsx` | 运行耗时、steps/tools 口径、最后活动和关闭态失败摘要；子代理内 ToolRenderer 使用 SubagentActivity.timestamp |
| `src/modules/chat/tests/toolActivityDisclosure.test.tsx` | 新增命令、工具组、子代理展示测试 |
| `src/modules/chat/tests/toolGrouping.test.ts` | 补现有分类集合、Other 显示、分类统计输入和异常优先级纯函数测试 |

若摘要仅一个文件使用，函数留在组件文件内；chat 模块内的多个消费者继续使用 `src/modules/chat/utils/toolGrouping.ts`，只有跨两个以上模块复用时才移入 `src/shared/utils.ts`，并按前端规范补充共享注释。首期不创建模块级 `types.ts` 或 `constants.ts`。

### 5.3 文档同步

| 文件 | 修改 |
| --- | --- |
| `docs/research/thinking-streaming-plan.md` | 更新“结束约 1 秒自动收起”的旧验收事实，链接本方案 |
| `docs/architecture/05-scrolling.md` | 增加折叠导致布局变化时的滚动所有权规则 |
| 本文档 | 实施后回填测试、性能和人工验收结果 |

## 6. 测试方案

### 6.1 Reasoning 组件契约

使用 fake timers，至少覆盖：

1. `isStreaming=true` 且无用户操作时自动展开。
2. 思考结束但 `finalAnswerStarted=false` 时，推进任意 timer 都不收起。
3. `finalAnswerStarted=true` 后 2499ms 仍展开，2500ms 才收起。
4. timer 期间正文状态撤销会取消收起。
5. 用户手动收起后，新 thinking delta 不会重开。
6. 用户手动展开后，正文出现和 timer 都不会收起。
7. hover、focus、selection 和 `suppressAutoCollapse` 分别阻止收起。
8. guard 解除后重新获得完整 2500ms 窗口。
9. 自动收起后用户展开，程序不再次收起。
10. unmount 清理 timer，不发生 state-after-unmount。
11. 导出模式保持展开。
12. `prefers-reduced-motion` 路径不依赖动画结束事件。
13. hover 快速移入/移出不会遗留旧 timer，解除 guard 后获得完整新窗口。
14. selection 跨多个 DOM 节点且与思考块相交时仍阻止收起；同帧 selectionchange 只检查一次。
15. 注入 fake IntersectionObserver 并触发 `isNearViewport=false`，先断言 LazyMessageRow 子树真实卸载，再验证重挂后恢复 USER_OPEN、USER_CLOSED 和可见 duration；不得依赖 jsdom 的恒挂载 fallback。
16. 同一轮 3 个 thinking 块中，新块出现时仅接管并收起此前最新块；hover/focus/selection guard 仍有效，不让多个旧块在正文到达时同步塌陷。
17. 用户点击与自动 timer 同 tick 时，reducer 以最新 ownership 为准，程序 action 不覆盖用户选择。
18. 已自动收起后出现晚到工具，块恢复展开并保持到 terminal；本轮 processing 期间不重复开合。

### 6.2 正文关联契约

用一次完整消息列表测试反向扫描：

- thinking → 流式 text：thinking 的 `finalAnswerStarted=true`。
- thinking → 普通 assistant preamble → tool：false。
- thinking → 普通 assistant preamble，当前仍 processing：false。
- thinking → terminal 普通 assistant text 且其后无 tool：true。
- thinking → 流式 text → 2.5 秒已收起 → 晚到 tool：撤销正文候选、恢复展开并锁定到 terminal。
- thinking → tool → user：false。
- thinking → text → user → thinking：前一条 true，后一条 false。
- 多条 thinking → 同一正文：只有本轮最后一条 thinking 启动正文 timer，更早块已在后继 thinking 出现时逐块完成接管。
- assistant 空文本、工具消息、任务通知及任务通知派生结果不误判为正文。
- `disclosureKey` 在 thinking 内容增长和 finalize 前后保持完全一致；user edit/rewind 不改变 thinking 自身的 key。
- 历史分页只加载 thinking 尚未加载后续正文时保持 false；正文页合入后变 true。
- `visibleMessages` 窗口首元素位于 turn 中间时，后缀不变量仍保证窗口内 thinking 不被上一轮正文误判。

### 6.3 命令与活动契约

- 运行态耗时从 timestamp 起算并按秒变化。
- timestamp 无效时不显示虚假秒数。
- 有结果 timestamp 时显示稳定完成耗时，时间不再继续增长。
- 成功有输出显示行数；尾部换行不多算一行。
- 错误只预览最后 3 行，完整内容仍可展开。
- denied/stopped 无输出时不渲染空面板。
- 工具组摘要异常优先于 running，running 优先于分类统计。
- 工具组保留既有 `label + xN`、异常自动展开和 diff 统计，只追加摘要。
- 分类严格沿用现有集合；Read/WebSearch/WebFetch 计入摘要 `Other`，不出现无法产出的 Read 分类。
- 子代理关闭时不挂载 timeline；header 仍更新 step count 和当前动作。
- 子代理 steps 包含所有 activity，tools 只含 tool activity；失败关闭态只出现截断摘要。

### 6.4 回归验证命令

```bash
npx vitest run \
  src/modules/chat/tests/reasoningDisclosure.test.tsx \
  src/modules/chat/tests/messageStreamEnd.test.tsx \
  src/modules/chat/tests/toolActivityDisclosure.test.tsx \
  src/modules/chat/tests/toolGrouping.test.ts \
  src/modules/chat/tests/transcriptScrollOwnership.test.tsx

npm run test:client
npm run typecheck
npm run lint:client
npm run build:client
```

首期无服务端代码，毋须以当前工作区无关的服务端全量失败作为本方案阻塞条件。

## 7. 人工验收矩阵

| 场景 | 桌面预期 | iOS H5 预期 |
| --- | --- | --- |
| 长思考后正文开始 | 正文出现至少 2.5 秒后自然收起 | 同左；不得在用户触摸阅读时收起 |
| 思考后出现 preamble 再执行工具 | preamble 不触发收起；工具期仍能看到思考/活动 | 同左 |
| 流式 preamble 后工具晚于 2.5 秒到达 | 若已自动收起则恢复展开，并保持到本轮 terminal | 同左；不得反复开合 |
| 后台任务通知结果插入当前轮 | 不作为最终正文，不触发思考收起 | 同左 |
| 思考结束但无正文 | 保持展开 | 保持展开 |
| 流式时手动收起 | 后续 delta 不重开 | 同左 |
| 正文出现后手动展开 | 本轮保持展开 | 同左 |
| 用户上滑阅读历史 | 不自动收起、不改变视口 | 同左 |
| 鼠标 hover/文本选择 | 不自动收起 | 长按选择期间不收起 |
| 长 Bash 成功 | 行内耗时增长；完成后显示耗时和行数 | 紧凑、不横向溢出 |
| Bash 失败 | header 可识别，直接看到最后 3 行错误 | 同左 |
| 连续 20 个工具 | 折叠态能看到当前动作/统计，展开不卡顿 | 页面不明显掉帧 |
| 100 步子代理 | 折叠态持续反馈；未展开不挂载全部步骤 | 同左 |
| 同一轮含 3 个 thinking 块 | 新块逐次接管旧块；正在阅读的旧块受 guard 保护，正文出现时不发生多块同步塌陷 | 同左 |
| reduced motion | 无高度动画但状态正确 | 跟随系统设置 |

体验验收重点不是“动画好看”，而是用户在任意时刻都能回答三个问题：正在做什么、是否仍在运行、失败时去哪看原因。

## 8. 二期：真实命令输出 tail（本次不实施）

### 8.1 启动条件

只有同时满足以下条件才进入二期：

1. 至少两个主力 Provider 能提供命令 stdout/stderr 增量或可安全代理的子进程流。
2. 能为一次工具调用提供稳定 `toolId`。
3. 能明确区分 stdout、stderr、terminal 和 replay。
4. 历史加载与实时事件能去重，不会把 tail 与最终 `toolResult` 重复拼接。

### 8.2 候选协议

```ts
type ToolOutputDelta = {
  kind: 'tool_output_delta';
  sessionId: string;
  toolId: string;
  stream: 'stdout' | 'stderr';
  content: string;
  provider: LLMProvider;
};
```

服务端 Provider adapter 只负责映射原始事件，统一批次和顺序由共享服务负责；WebSocket route 不持有拼接业务逻辑。共享类型放 `server/shared/types.ts` 并通过 barrel 暴露，遵守后端模块规范。

前端按 `sessionId + toolId + stream` 累积，只渲染最后 20 行预览；用户展开后显示完整当前缓冲，终态以最终 `toolResult` 为权威并清理临时 buffer。

### 8.3 二期风险

- 不同 Provider 的输出时序和 replay 能力差异大。
- ANSI 控制符、`` 进度条和超长无换行输出需要终端语义，不是简单字符串 append。
- 后台会话持续输出会增加内存和 merge 成本，需要独立限频与大小上限。
- 最终结果与增量输出必须建立去重契约。

因此二期不得顺手塞进首期 UI 变更。

## 9. 分阶段执行与回滚

### 阶段 0：基线记录

- 录制桌面与 iOS 的“长思考→正文”“用户上滑”“长 Bash”“失败 Bash”“多工具组”视频。
- 记录当前 1 秒收起、视口位移和错误发现点击数。
- 按 Provider 采样“流式 preamble settled → 后续 tool 首次可见”的间隔，覆盖大 JSON tool input；记录超过 2.5 秒的样本，用于验证晚到工具恢复路径。
- 分别验证桌面浏览器和 iOS WKWebView 在“贴底 + 200ms 高度折叠”下是否保持尾部稳定；若任一失败，阶段 1 默认取消高度动画。

### 阶段 1：思考状态机

- 先写状态机和正文关联测试。
- 实现用户意图所有权、2.5 秒正文窗口和阅读保护。
- 单独人工验收后再进入工具摘要。

### 阶段 2：命令与工具摘要

- 先实现纯展示数据，不改 Provider 事件。
- Bash、工具组、子代理分别提交，避免一个组件回归阻塞全部。

### 阶段 3：全量验证与文档回填

- 执行 §6.4。
- 执行 §7 桌面/iOS 矩阵。
- 回填实际时序、滚动表现、未通过项和最终参数。

回滚边界：

- Reasoning 可恢复原 `isStreaming` 自动开关与 1000ms timer；无数据迁移。
- 命令耗时和摘要均为派生展示，可逐组件回滚。
- 首期不改协议、不改数据库，回滚不会留下不兼容数据。

## 10. 风险与控制

| 风险 | 表现 | 控制 |
| --- | --- | --- |
| 状态机过度复杂 | 用户操作后仍被程序切换 | 单独记录用户所有权，fake timer 穷举转移 |
| 正文关联跨轮误判 | 上一轮正文使新思考提前收起 | 遇 user 明确重置，反向扫描测试 |
| preamble 后工具晚到 | 思考已收起，工具期失去工作信号 | 晚到工具触发 reducer 恢复并锁定至 terminal；阶段 0 分 Provider 采样 |
| 后台任务结果误判正文 | 异步结果提前收起当前轮思考 | 投影时增加显式结果标记并从正文候选排除 |
| registry 并发覆盖 | timer 与用户点击同 tick，程序覆盖用户意图 | useReducer 原子 action；自动 action 二次校验最新 ownership |
| 分页导致关联信息暂缺 | 历史思考暂时展开 | 宁可晚收，不在信息不足时误收 |
| 自动折叠造成滚动跳动 | 贴底时正文锚点抖动 | 非贴底禁止自动收起；贴底端实测不通过则取消高度动画，不增加补偿 writer |
| 每个工具每秒 timer 增多 | 长工具列表 CPU 增长 | 只给 running 且已挂载的行计时；LazyMessageRow 卸载会清理 timer；终态立即清理 |
| Provider 无结束 timestamp | 显示虚假耗时 | 缺失就不显示完成耗时 |
| 错误预览泄露大量输出 | 屏幕噪音或敏感信息暴露 | 只显示现有完整输出的最后 3 行，不新增采集；仍服从现有会话权限 |
| 动画影响低端 iOS | 掉帧 | reduced-motion；200ms；性能不达标时取消高度动画而非增加节流状态 |

## 11. 审阅者重点问题

请其他 harness 优先批注以下决策：

1. 最终正文判定已区分流式正文、terminal 正文和普通 preamble；实现时是否还能找到 Provider 特例？
2. 2500ms 是否足以兼顾转场与阅读？首版固定 2.5 秒，不按字数动态计算。
3. 用户上滑、hover、focus、selection 四个 guard 是否还存在遗漏？
4. guard 解除后重新给完整 2.5 秒窗口是否合理？
5. 没有正文的中止/错误轮次保持思考展开，是否符合预期？
6. Bash 失败默认显示最后 3 行、完整输出按需展开，是否比整体自动展开更合适？
7. thinking duration 使用 CloudCLI 可见时长、命令 duration 只使用可靠结果 timestamp，这两个口径是否足够清晰？
8. 子代理失败关闭态显示两行摘要、完整 timeline 仍按需挂载，是否符合预期？
9. 首期明确排除真实命令输出 tail，是否需要调整优先级？
10. 已取消滚动补偿分支；贴底实测失败时直接取消高度动画，这个降级是否可接受？

## 12. 审阅批注

> 请审阅者仅在本节追加批注，不直接修改方案正文。推荐格式：
>
> `### <Harness 名称> 审阅（YYYY-MM-DD）`
>
> `- [严重程度：高/中/低] <对应章节>：<问题、证据、建议>`

### Pi 审阅（2026-09-12）

> [!CAUTION] **严重 · §4.4 折叠动画与滚动补偿的时序耦合**：折叠动画 200ms 内 `scrollHeight` 是渐变的，而方案约定「折叠完成后」才由滚动所有者补偿高度差。未贴底用户会先看到内容位移、动画结束再被拉回，产生两次可见跳动，恰违反 §2.2「视口内容保持原位」。且原生 scroll anchoring 在 iOS WKWebView 的支持度与 Chrome 不同，需分开验证。建议：补偿与动画同帧启动、按动画进度渐进补偿，或动画期间冻结滚动；把「折叠前记录 scrollTop/scrollHeight、动画结束稳定」作为一个集成验收项。

> [!CAUTION] **严重 · §4.2 用户所有权的事件来源判定**：`Reasoning.tsx:61` 的 `onOpenChange` 是受控回调，程序内部 `setIsOpen` 同样会触发它。若只用 `onOpenChange` 判定用户所有权，effect 里的程序切换（第 92 行 `isStreaming` 自动展开、第 99 行自动收起）可能被误记为 `USER_OPEN`/`USER_CLOSED`。一旦误入 `USER_CLOSED`，后续 thinking delta 永不重开——这是「程序不得覆盖用户」承诺的反向污染。建议：只有 pointer/keyboard 事件路径写入用户所有权，程序路径走独立受控 open 调用，不经过用户事件入口。

> [!WARNING] **中 · §4.3 阅读保护「明确变化」的监听机制未定义**：hover/focus/selection/suppress 涉及 `pointerenter/leave`、`focusin/focusout`、`selectionchange`、`scroll` 四类事件源，方案未说明统一订阅、去抖与 cleanup。`selectionchange` 在拖动选择期间高频触发，若每次直接重置 2500ms 窗口会导致 guard 抖动；且新增 scroll 监听可能与现有滚动 writer 冲突。建议补一个「阅读保护信号」订阅层与事件图，明确归谁所有。

> [!WARNING] **中 · §4.8 子代理折叠态 header 数据来源**：timeline 不挂载时，header 的「当前最后一条活动」（`Bash / npm test`）从哪来、以何频率更新，方案未说明。若经会话 store 刷新则违反 §2.2「不触发全会话消息重建」。建议：子代理活动摘要走局部事件/ref 通道，仅 header 重渲染，不写会话 store。

> [!WARNING] **中 · §4.7 工具分类映射现状未声明**：抽查 `toolGrouping.ts` 未发现 Read/Search/Edit/Bash 分类映射，方案直接引用「分类统计」摘要。若该映射当前不存在，§5.2 应显式列出需新增的纯函数及 `toolGrouping.test.ts` 的输入样例，避免实施期按猜测实现。

> [!WARNING] **低 · §4.1 反向扫描依赖 `visibleMessages` 完整性**：若列表为窗口化/虚拟渲染，`user` 重置消息可能落在窗口外，「遇 user 重置」兜底失效，跨轮误判风险回升。§10 虽已写「宁可晚收」，建议明确 `visibleMessages` 是否始终为完整列表，并补分页边界单测（§6.2 已有用例，但未覆盖窗口裁剪场景）。

> [!NOTE] **§2.2 「scrollTop 变化为 0」指标语义需澄清**：显式补偿必然先产生 scrollTop 变化再改回，瞬时值恒不为 0，该指标按字面验收恒失败。建议改为「折叠完成后 scrollTop 稳定值等于折叠前」或「视口内容原位」。

> [!NOTE] **§4.5 思考 duration 数据来源与 §4.6 不对称**：命令耗时明确依赖 `toolResult.timestamp`、缺失则不显示；但 `Thought for {n} seconds` 未说明 n 取自哪个字段。若 thinking 消息无可靠时间戳，应同样声明「缺失则降级为 `for a few seconds`」，并在 §11 增补该问题。

> [!TIP] **§6 测试缺口**：建议补 4 类用例——hover 快速移入移出的 guard 抖动、selection 跨多个节点与思考块相交、折叠动画与滚动补偿耦合、iOS 长按 selection 行为。其中动画-补偿耦合用例可直接进 `transcriptScrollOwnership.test.tsx`。

> [!TIP] **§11 问题 10（滚动单一所有者）**：赞成保持 `useChatSessionState` 单一 writer。但 Reasoning 的「折叠即将发生/已完成」回调需携带时序相位（动画前/中/后），否则补偿无法与动画对齐——正是第一条 CAUTION 的解药。

### WorkBuddy 审阅（2026-09-12）

> [!IMPORTANT] **高 · §4.1 + §11 问题 1：preamble 会把 `answerStarted` 提前点亮，思考在整段工具期消失**。方案只区分「thinking/tool vs 普通正文」，但 OpenAI preamble 的典型形态就是「工具之间的独立 assistant 文本消息」。当前实现里，挂在工具消息上的 preamble 走 `displayText`（`MessageComponent.tsx:230-234`），会被「非 tool」规则正确排除；但 Provider 单独发一条 assistant 文本时（方案自己引用的 OpenAI 文档场景），首次 preamble 就把 `answerStarted` 置真，2.5 秒后思考收起——而此时工具往往还要跑几十秒到几分钟，用户在整段工具期失去「模型在工作」的唯一信号，直接违反 §0/§2.1-1 的立意。建议把定义收紧为「同一轮次内、其后到下一个 user 之间不再出现 tool 调用的首条 assistant 文本」：反向扫描在遇到文本时继续向前看是否还有 tool，是 preamble 就不点亮。这同时正面回答 §11 问题 1——工具间 preamble 不应算正文。

> [!IMPORTANT] **高 · §4.3 与 §4.4 互斥：未贴底的滚动补偿分支在自动路径上不可达**。§4.3 规定 `suppressAutoCollapse=true`（用户已离开底部）时绝不自动收起；`suppressAutoCollapse` 的来源就是现有的 `isUserScrolledUp`（`useChatSessionState.ts:199,234`）。因此「自动收起 + 用户未贴底」这个组合不存在，§4.4 的「若用户未贴底…折叠完成后补偿高度差」与 §2.2 的「折叠导致非贴底用户 `scrollTop` 变化 0」都成了恒真/死分支。反过来说，自动收起只发生在贴底时，此时浏览器对 `scrollTop` 的 clamp（`scrollHeight` 变小后 max scrollTop 同步下移）已让原视口内容保持原位，配合现有 follow writer（`useChatSessionState.ts:418-421`）大概率足够。建议删掉未贴底补偿分支，或把补偿约束为「仅在贴底 + 实测 scroll anchoring 失效的浏览器上生效」，并在阶段 0 基线里把它作为实测项——这正是 §11 问题 10 要的「更小且同样安全」的实现。

> [!WARNING] **中 · §4.2 所有权与 §4.5 duration 都活在组件生命周期内，而 lazy row 会卸载整棵子树**。`LazyMessageRow.tsx:68-76` 在离开视口（`rootMargin` 1200px，`useLazyRowObserver.ts:5`）时把 `children` 置 `null`，子树整体卸载。于是：用户手动展开思考 → 上滑超过 1200px → 滚回时 Reasoning 重新挂载，所有权回到 `AUTO`、`defaultOpen=isStreaming=false`（`MessageComponent.tsx:288-289`），用户的手动展开被静默清零，违反 §2.1-2 与 §2.2「本轮程序反向切换次数为 0」。`duration` 同理会丢（`Reasoning.tsx:78-88` 的 `startTimeRef`/state 均为组件内），降级成 `Thought for a few seconds`。另外这处 duration 本身就是**本机 wall-clock 计时**，正是 §4.6 明确拒绝的「以 React 本机时间冒充 Provider 耗时」；若保留 `Thought for {n} seconds` 而不改口径，两条规则的论证自相矛盾。建议：把 ownership 与计时起点放到 `ChatMessagesPane` 级按 message key 的 ref/Map（首期不持久化，符合 §2.3），并明确 thinking duration 是「可见耗时」还是改读 Provider 时间戳。

> [!WARNING] **中 · §4.2/§4.4 未处理「多个 thinking 块同刻收起」的叠加位移**。§6.2 已承认「多条 thinking → 同一正文，本轮多条均为 true」，那么这些块的 timer 会在同一次渲染里一起启动、同一个 deadline 触发，k 个块在 200ms 内同时折叠，高度差叠加成一次大跳；若再叠加 §4.4 的补偿回调，就是 k 次写入排队。建议：只让本轮最新/最后一块自动收起，或由 pane 级单一 owner 汇总总高度差一次性补偿；并补一条「一轮含 3 个 thinking 块」的验收（§7 矩阵目前只有单块场景）。

> [!WARNING] **中 · §5.2 实施清单缺 `ToolRenderer.tsx` 与 `MessageComponent.tsx`，§4.6 的耗时/完成摘要接不上**。`BashCommandDisplay` 当前 props 里没有任何 timestamp（`BashCommandDisplay.tsx:10-18`），构建它的 `ToolRenderer.tsx:170-179` 自身 props 也不含消息时间戳，而 `MessageComponent` 传下去的是 `toolName/toolInput/toolResult/toolId/...`（`MessageComponent.tsx:236-249`）。所以「运行中 `Running · Ns`」和「完成 `Completed · 2.4s`」必须先给 `ToolRenderer` 加 timestamp 入口并由 `MessageComponent` 提供消息 timestamp；`ToolRenderer` 还是唯一渲染路由（子代理时间线也走它，`SubagentPanel.tsx:197-207`），改动会同时影响子代理内的 Bash 行，需要一起纳入。建议把这两个文件写进 §5.2，并说明子代理耗时起点用 `SubagentActivity.timestamp`（该字段存在，`types.ts:260`，可选）。顺带：若 phase 1 把 `answerStarted/suppressAutoCollapse` 做成必填，`ToolGroupContainer.tsx:164` 这个 `MessageComponent` 调用点也要改；做成可选则无需。

> [!WARNING] **中 · §4.8「失败只展开结果摘要、不挂载完整 timeline」是结构性改动，§5.2 一行带过**。`SubagentPanel.tsx:113` 是 `showTimeline = isOpen || isExporting`，Result 块嵌在该条件内部（`:231-236`），所以「展开结果摘要但不挂载时间线」必须把 Result 移出 `showTimeline` 或新增独立 state，还要与既有的 25 条初始渲染 / `Show more` 语义对齐。另外 `Completed · 42 steps` 与现有 `toolCount`（只统计 `kind === 'tool'`，`SubagentPanel.tsx:124`）口径不同：若 steps 含 thinking/text 注释则数字会变，若不含则名不副实。建议在 §4.8 明确定义 steps，并保留现有 `N tools`/`done` 作为回退标签，避免同一 header 出现两套计数。

> [!NOTE] **§4.1 反向扫描对可见窗口截断是安全的，但缺一条不变量测试**。`visibleMessages` 是分页后缀切片而非 DOM 虚拟化，截断只丢更旧的消息；扫描自底向上，因此「某 thinking 之后的正文」必然在窗口内，且当前轮次的 user 一定在窗口内——不会产生「上一轮正文让新思考提前收起」的误判。建议把这条后缀不变量写成显式断言（新增用例：`visibleMessages` 首元素既非 user 也非 thinking 时，最旧 thinking 仍得到正确判定），补上 §6.2 目前只覆盖「正文页未合入」而未覆盖「窗口边界切在 turn 中间」的空白。

> [!NOTE] **§4.6/§4.7「离开可见区域停止 tick」无需新增可见性订阅**。`LazyMessageRow.tsx:68-76` 在远离视口时直接卸载子树，`BashCommandDisplay`/`SubagentPanel` 的本地 1s tick 随 unmount 自动清理，§10「每个工具每秒 timer 增多」风险天然有解。建议在风险表里注明这一依赖，避免实施期再加一套 IntersectionObserver 或 visibility state。

> [!TIP] **§4.7 的 `xN` → `Tools · 7` 是既有 header 形态变更，注意回归面**。当前 header 用 `label` + `x{group.messages.length}` 圆角徽标（`ToolGroupContainer.tsx:147-150`），并已具备「异常自动展开」（`:117-121`）与 diff 统计（`:158`）。方案说的「不闪现 Completed badge」现状已满足（该组件只渲染 issue badge）。建议在 §5.2/§6.3 明确 `xN` 是被替换还是并列，并把 `toolGrouping.test.ts` 的既有断言纳入回归范围。

### 牵头结论

- 采纳：用户所有权不能从通用 `onOpenChange` 推断，Trigger 的 pointer/keyboard 用户入口与 effect 程序入口必须分离（来源：Pi）。正文 §4.2 已写死事件来源，避免程序动作污染 `USER_OPEN`/`USER_CLOSED`。
- 采纳：阅读保护信号必须定义订阅、合并和 cleanup（来源：Pi）。正文 §4.3 已明确复用现有上滑状态、局部 pointer/focus，以及仅在候选期启用并用 rAF 合并的 `selectionchange`；不新增 scroll listener。
- 部分采纳：动画与滚动补偿的时序风险（来源：Pi）。风险成立，但不采用逐帧补偿或动画冻结；WorkBuddy 进一步证明“非贴底自动收起 + 补偿”是死分支。正文 §4.4 已删除补偿与折叠相位回调，限定只在贴底时自动收起，桌面/iOS 实测失败则取消高度动画。
- 不采纳：为子代理摘要增加独立局部事件/ref 数据通道（来源：Pi）。`activity` prop 已是现有权威数据，最后活动可直接派生；新增旁路会形成第二套同步协议。已采纳其“不因耗时 tick 写 session store”的目标，并在 §4.8 澄清边界。
- 采纳：工具分类映射、窗口边界、duration 来源与测试缺口需补齐（来源：Pi）。正文 §4.1、§4.5、§4.7、§5 和 §6 已补稳定 disclosure key、后缀窗口不变量、可见思考时长口径、唯一分类纯函数及对应测试。
- 不采纳：Reasoning 必须上报动画前/中/后相位（来源：Pi）。修订后不再执行 scroll 补偿，新增相位回调没有消费者，只会扩大状态面。
- 采纳：独立 assistant preamble 不能提前触发收起（来源：WorkBuddy）。正文 §4.1 改为 `finalAnswerStarted`：流式正文可在运行期成立，普通 settled 文本需等会话 terminal；后续工具会撤销候选并取消 timer。
- 采纳：未贴底补偿是不可达分支（来源：WorkBuddy）。已删除该设计和原来无法按字面验收的 `scrollTop 变化为 0` 指标，改为“非贴底禁止自动收起、贴底完成后仍稳定”。
- 采纳：LazyMessageRow 卸载会丢失 Reasoning 内部所有权与计时状态（来源：WorkBuddy）。正文 §4.1/§4.2 将用户所有权、自动状态和可见计时边界提升到 `ChatMessagesPane` 的非持久化 registry，并定义不依赖 content preview 的稳定 disclosure key。
- 采纳：同轮多 thinking 块不能同时启动收起（来源：WorkBuddy）。只让本轮最新 thinking 进入自动管理，补充三块 thinking 的自动化与人工验收。
- 采纳：命令耗时实施清单缺少上游 timestamp 传递文件（来源：WorkBuddy）。§5.2 已加入 `MessageComponent.tsx`、`ToolRenderer.tsx` 和 `toolGrouping.ts`，并明确顶层及子代理活动 timestamp 来源。
- 采纳：子代理失败摘要和 steps 口径需要落到现有结构（来源：WorkBuddy）。§4.8 定义 steps/tools 两套明确计数，失败摘要移到 `showTimeline` 外但不新增展开 state，完整 timeline 继续惰性挂载。
- 采纳：保留工具组既有 `label + xN`、异常展开和 diff 统计（来源：WorkBuddy）。新摘要只追加，不替换已有 header 结构；§6.3 已列回归契约。
- 采纳：运行耗时无需新建可见性订阅（来源：WorkBuddy）。依赖 LazyMessageRow 卸载清理本地 timer，已写入 §4.6 与风险表。
- 修订说明：本轮更新了状态、最终正文判定、用户所有权存放位置、阅读保护事件图、滚动裁决、duration 口径、工具分类、子代理结构、文件清单、测试矩阵、风险和待确认问题；Pi 与 WorkBuddy 原始批注完整保留，未改写。

### WorkBuddy 复审（2026-09-12）

对 18 条采纳项逐条回正文核对：未贴底补偿删除（§4.4）、耗时上游传递（§5.2 增 `MessageComponent`/`ToolRenderer`）、工具组保留 `label + xN`（§4.7:306）、子代理 steps/tools 双口径（§4.8:318）、lazy row 清理 timer（§4.6:268）均已落到可实施描述。以下 8 条是修订后仍存在或新引入的问题。

> [!WARNING] **中高 · §4.1 规则 2 与 §4.2 约束 5：流式 preamble 的竞态只是被收窄，没有被关闭**。规则 2 让「流式文本候选」立刻成立 `finalAnswerStarted`，靠「随后出现工具则撤销候选并取消 timer」兜底。但撤销只在 2.5 秒内有效：一旦 timer 已把状态推进到 `COLLAPSED_AUTO`，`finalAnswerStarted` 变回 false 并无反向动作（§4.2 状态图里 `COLLAPSED_AUTO` 没有回到 `OPEN_AUTO` 的边）。真实场景：模型流式输出一段 preamble 并 settled，随后开始生成一个很大的 `tool_use` 块（大段 JSON 编辑器负载，几秒到十几秒），工具行在 2.5 秒之后才出现——思考已经收起，用户在整个工具期失去「模型在工作」的信号，与 §0/§2.1-1 的立意冲突。规则 3（settled 文本要求 `isProcessing=false`）覆盖不了这种情况，因为它是**流式**文本。§6.2 的「thinking → 流式 text → tool：先 true，tool 到达后撤销」只断言了标志位与 timer，没有断言「若已收起则如何」，因此测试全绿而界面仍错。建议：阶段 0 按 Provider 记录「preamble settled → tool_use 首次可见」的实际间隔；任一 Provider 超过 2.5 秒，就对流式候选追加「其后 2.5 秒内无工具事件」之外的判据（例如把流式候选的窗口延长到「工具事件或 text settled + 无后续工具」二者之一成立），并在 §6.2 补一条「已收起后 tool 到达」的断言。

> [!IMPORTANT] **高 · §4.1 规则 1 无法排除「任务通知派生结果行」，它会被判成最终正文**。`useChatMessages.ts:222-228` 把任务通知的结果再 push 成一条**普通 assistant 文本行**——只有通知行带 `isTaskNotification: true`（`:212-219`），结果行既无 `isTaskNotification` 也无 `isThinking`/`isToolUse`。规则 1 的「非 thinking、非 tool、非任务通知且内容非空」对它全部通过，而它的来源是 `role === 'user'` 的异步通知（后台任务完成），完全可以在一轮仍在进行时到达。结果：背景任务的产出会把当前轮的思考提前收起。这正是 §11 问题 1 问的 Provider 特例之一。建议在投影里给该派生行打上显式标记（如 `isTaskNotificationResult`），规则 1 与 §6.2 各补一条「task notification 结果行不算正文」；仅靠现有字段无法区分。

> [!IMPORTANT] **中 · §4.1 规则 4 治好了「多块同刻塌陷」，但留下「更早的块无人收起」新洞**。规则 4 只让本轮最新 thinking 块成为自动管理候选，同时 §4.2 约束 2 仍规定 `isStreaming=true` 且所有权为 `AUTO` 时自动展开。于是第 1 个 thinking 块在自己的流式期间已被自动展开，当第 2 个块出现后它既不是候选、也没有 timer，谁都不会关它——一轮含 3 个 thinking 块的会话最终在正文上方堆着 2 个展开的思考块，与 §0「不长期挤压正文」的取舍相反。§6.1 用例 16 只断言「更早的 settled 块不同时启动 timer」，恰好把这个错误状态固化下来。建议补一条明确规则：本轮出现更新的 thinking 块时，前一块按同一 200ms 收起（作为该次决策的一部分，而非再开一套 timer），并把用例 16 改成断言「第一块被收起 + 整轮只发生一次高度变化」。

> [!WARNING] **中 · §6.1 用例 15 在 jsdom 里无法走通卸载路径，会「假绿」**。`useLazyRowObserver.ts:26` 在 `typeof IntersectionObserver === 'undefined'` 时返回 `null`（代码注释明确写了这是 jsdom 行为），`LazyMessageRow.tsx:68` 随即 `isMounted = true` 恒成立——测试环境里 LazyMessageRow 永远不会卸载子树。用例 15「LazyMessageRow 卸载/重挂后恢复 USER_OPEN、USER_CLOSED 和可见 duration」按当前描述写出来必然通过，但完全没有覆盖它要证明的路径。建议：注入 fake IntersectionObserver（触发 `isNearViewport=false` 的 entry），或把 registry 的存取提成纯函数直接单测，再补一个真实卸载断言。

> [!WARNING] **中 · §4.2 registry 的原子性：自动收起必须走 reducer 内二次校验，否则用户点击与 timer 同帧会互相覆盖**。所有权从 Reasoning 内部提升到 pane registry 后，「程序不得覆盖用户」这条保证变成跨组件往返：timer 到点在 Reasoning 里触发，却要经 registry 写入才生效。若 Registry 更新用普通 `setState(closure)`，用户点击（`USER_CLOSED`）与同一次渲染里排队的自动收起会按陈旧闭包互相覆盖，直接违反 §2.2「本轮程序反向切换次数为 0」。建议：收起动作做成 reducer action，在 reducer 内基于最新 `ownership` 再判一次；并补「用户点击与 timer 同 tick 触发」的用例。同理，传给 `MessageComponent` 的 registry 读取/写入回调必须 `useCallback` 稳定，否则 `memo` 对未变化的行全部失效。

> [!WARNING] **低中 · §4.7 的分组示例与它自己声明的分类集合不一致**。`getToolCategory`（`ToolRenderer.tsx:35-45`）只有 edit/search/bash/todo/task/agent/plan/question/default，**没有 read 桶**：`Read` 落 `default`，`WebSearch`/`WebFetch` 也落 `default`。但 §4.7:295 的示例仍是 `Read 3 · Search 2 · Edit 1 · Bash 1`，实现时无法产出。要么示例改成实际口径（`Default N` 作为主导分类会很难看，说明该示例需要重新设计），要么明确在迁移时新增 `read` 桶并写进 `toolGrouping.test.ts` 的输入样例——不能一边说「沿用现有口径」一边给出集合外的分类名。

> [!NOTE] **§5.2:363 的共享判定标准与仓库前端规范不符**。规范（`.agents/skills/frontend-module-standards/SKILL.md:85`）是「两个以上**模块**」才进 `src/shared/utils.ts`；AGENTS.md 要求前端改动遵守该规范。`ToolRenderer`（`chat/tools`）与 `ToolGroupContainer`（`chat/transcript`）同属 chat 模块，按规范应留在 `src/modules/chat/utils/toolGrouping.ts`，不应因「两个以上文件」外提。建议把这句判定改成「跨模块复用才外提」，避免实施时把 chat 内部工具放进 shared。

> [!NOTE] **§4.1 `disclosureKey` 的锚点建议换成 thinking 行自身，而不是「最近 user 的 timestamp」**。`ChatMessage.transcriptAnchorId`/`replacesAnchorId` 的存在说明 user 行是可被替换/重写的（`types.ts:289-301`，以及 `:424-433` 记录的「provider 用副本的时间戳写入副本」的 rewind 场景），以它为锚会把整轮的 key 一起改掉。既然方案已确认「finalize 保留 thinking timestamp」，直接用 **thinking 行自身 timestamp + 轮内序号**（sessionId 作前缀）即可避开这个不稳定源；`getIntrinsicMessageKey` 之所以不可用，只是因为它无 id 时会退化成含 `content.slice(0,48)` 的键（`messageKeys.ts:35-37`），而非时间戳本身不稳。建议同时补一条键不变性单测：同一 thinking 行在（a）内容增长中、（b）finalize 前后，`disclosureKey` 完全一致。

### Pi 复审（2026-09-12）

牵头结论对 Pi 与 WorkBuddy 首轮批注的处理方向正确，正文修订大体落实。但注意：**WorkBuddy 复审的 8 条追加在牵头结论之后，尚无裁决**——其中 3 条我核实代码后确认成立且为中高/高风险，进入实施前需要牵头再裁一轮，否则文档头部「审阅已汇总」不准确。以下为逐条独立评估与补充。

> [!CAUTION] **高 · WorkBuddy 复审 #3（§4.1 规则 4）「更早 thinking 块无人收起」确认成立**：规则 4 只让最新块成为自动管理候选，但更早块在自身流式期已按 §4.2 约束 2 自动展开，之后既非候选也无 timer，一轮 3 个 thinking 块会在正文上方永久堆 2 个展开块，与 §0「不长期挤压正文」相悖。§6.1 用例 16 只断言「更早 settled 块不启动 timer」，恰好固化该错误态。采纳 WorkBuddy 建议（新块出现时前一块随同一决策收起）时补一条约束：该收起仍需过 hover/focus/selection 阅读保护，避免关掉用户正在读的块；并把用例 16 改为断言「第一块被收起 + 整轮仅一次高度变化」。

> [!CAUTION] **高 · WorkBuddy 复审 #2（§4.1 规则 1/3）「任务通知结果行被判为正文」代码确认**：`useChatMessages.ts:223-229` 把 `taskNotif.result` 以普通 assistant 消息 push，无 `isTaskNotification` 标记，content 还经 `formatUsageLimitText` 处理。它满足规则 1 全部条件；是否误判最终取决于规则 3 的 `isProcessing` 守卫在「后台任务挂起/完成」时的取值——若完成时 `isProcessing=false`，该行按 terminal 正文触发思考收起，而它只是后台任务产物、不是本轮回答。建议采纳 `isTaskNotificationResult` 显式标记（最稳）；实施时先确认 `isProcessing` 语义，并在 §6.2 补一条「任务通知结果行不算正文」的断言，不要依赖现有字段的间接判定。

> [!WARNING] **中高 · WorkBuddy 复审 #1（§4.1 规则 2）流式 preamble 竞态认同，补数据采集**：2.5 秒窗口内「撤销候选」只在 timer 未到点前有效；流式文本 settled 后模型生成大 `tool_use` 块（几秒到十几秒）的间隔内思考已收起，撤销没有反向动作，§4.2 状态图 `COLLAPSED_AUTO` 无回边，确认无解。建议：阶段 0 基线把「preamble settled → tool_use 首次可见」间隔作为采样项记录；任一 Provider 超过 2.5 秒，则对流式候选追加「工具事件或 text settled 且无后续工具二者之一」的判据，并在 §6.2 补一条「已收起后 tool 到达」的断言。

> [!WARNING] **中 · WorkBuddy 复审 #4（§6.1 用例 15）jsdom 假绿代码确认**：`useLazyRowObserver.ts:26` 在无 `IntersectionObserver` 时返回 null，LazyMessageRow 恒挂载，卸载路径在 jsdom 里走不到。用例 15 按现描述写必然通过但不覆盖目标路径。采纳注入 fake IntersectionObserver（触发 `isNearViewport=false` entry）或把 registry 存取提成纯函数直测，并补真实卸载断言。

> [!WARNING] **中 · WorkBuddy 复审 #5（§4.2 registry 原子性）认同，明确 useReducer**：§4.2:185 只写「React state/reducer 更新」，未定 useState 还是 useReducer。若用 `setState(closure)`，用户点击与同帧排队的自动收起会按陈旧闭包互相覆盖，直接违反 §2.2「本轮程序反向切换次数为 0」。建议写死 useReducer，自动收起做成 action 并在 reducer 内基于最新 `ownership` 二次校验；传入 Reasoning 的 registry 回调一律 `useCallback` 稳定，避免 memo 对未变化行全部失效。

> [!WARNING] **中 · WorkBuddy 复审 #6（§4.7 示例与分类集合矛盾）代码确认**：`ToolRenderer.tsx:35-47` 的 `getToolCategory` 无 read 桶，Read/WebSearch/WebFetch 均落 default；§4.7:295 示例 `Read 3 · Search 2 · Edit 1 · Bash 1` 无法产出，且 §4.7:308 自称「沿用现有口径」与示例矛盾，牵头本轮未回应该条。必须在「新增 read 桶并明确 WebSearch/WebFetch 归属」与「改写示例」二选一，并写入 §5.2 与 `toolGrouping.test.ts` 输入样例，不能两边都对不上。

> [!NOTE] **WorkBuddy 复审 #7/#8 均认同，无异议**：#7 §5.2:363「两个以上文件」与前端规范「两个以上模块」不符，应改「跨模块复用才外提」（§4.7 已把函数放 `toolGrouping.ts`，该句是残留）；#8 disclosureKey 以 user 行为锚在 rewind 时会整轮换 key（`types.ts:294/301/409/420` 与 `:427` 注释确认），改用 thinking 行自身 timestamp + 轮内序号更稳。

> [!NOTE] **补充 §4.5：duration 终点在「卸载期间 streaming→settled 转换」会丢失**。终点取「转为 settled 时的本机接收时间」并写入 registry，但 LazyMessageRow 卸载（上滑超 1200px）后 Reasoning 已卸载，settled 事件到达时无人记录终点，该块降级为 `for a few seconds`。既然 §4.1 反向扫描已在 pane 级看到 settled 状态，建议把终点记录放到 pane 级扫描（扫描到块转 settled 时取 `Date.now()`），不依赖组件存活，与 registry 归属一致。

> [!NOTE] **补充 §4.3：Reasoning 需显式知道「我是自动收起候选」才能按候选期订阅 selectionchange**。候选判定在 pane 扫描（最新 thinking + `finalAnswerStarted`），若某块挂载时非候选、后续正文出现后才变候选，需要新 prop 驱动订阅开关。建议在 props 中显式传 `isAutoCollapseCandidate`（或并入 `disclosureKey` 语义），否则 selection 订阅时机悬空，§4.3「仅候选期订阅」无法实现。

### 第二轮牵头结论（2026-09-13）

- 部分采纳：流式 preamble 后工具晚到会穿透 2.5 秒窗口（来源：WorkBuddy，Pi 复核确认）。采纳 Provider 时序采样和“已收起后工具到达”测试；实现上不无限延长所有流式正文的等待，而是在晚到工具证明误判时由 reducer 恢复 `OPEN_AUTO`，并锁定到本轮 terminal，兼顾最终正文及时收起与工具期工作信号。
- 采纳：任务通知派生结果不能作为最终正文（来源：WorkBuddy，Pi 复核确认）。`useChatMessages` 投影增加 `isTaskNotificationResult`，正文扫描显式排除，并补对应测试；不依赖 `isProcessing` 的间接语义。
- 采纳：只管理最新 thinking 会让更早的已展开块残留（来源：WorkBuddy，Pi 复核确认）。新 thinking 出现时由 pane reducer 逐次 supersede 此前最新块；该动作仍遵守 hover/focus/selection、上滑和导出 guard，不在正文到达时同时收起全部旧块。
- 采纳：jsdom 默认缺少 IntersectionObserver 会让懒卸载测试假绿（来源：WorkBuddy，Pi 复核确认）。测试必须注入 fake IntersectionObserver、先证明子树真实卸载，再验证 registry 在重挂后恢复状态。
- 采纳：disclosure registry 需要原子更新和稳定回调（来源：WorkBuddy，Pi 复核确认）。实现写死 `useReducer`；自动 action 在 reducer 内基于最新 ownership 二次校验，registry 回调使用 `useCallback`，并增加用户点击与 timer 同 tick 的竞态测试。
- 采纳：工具组示例与现有分类集合矛盾（来源：WorkBuddy，Pi 复核确认）。首期不扩大分类集合，摘要将既有 `default` 展示为 `Other`；Read/WebSearch/WebFetch 均按当前分类归入 Other，测试固定该口径。
- 采纳：模块内部两个文件复用不应迁移到 shared（来源：WorkBuddy，Pi 认同）。分类与摘要继续放在 chat 模块的 `utils/toolGrouping.ts`；只有跨两个以上模块复用才进入 `src/shared/utils.ts`。
- 采纳：disclosureKey 不应锚定可能被 edit/rewind 替换的 user 行（来源：WorkBuddy，Pi 认同）。改为 `sessionId + thinking 自身 timestamp + 轮内序号`，并补内容增长、finalize、user rewind 三类键稳定测试。
- 采纳：LazyMessageRow 卸载期间 thinking settled 会丢 duration 终点（来源：Pi）。settled 边界改由始终持有消息数组的 ChatMessagesPane 记录，不依赖 Reasoning 子树存活。
- 采纳：selectionchange 订阅缺少明确候选输入（来源：Pi）。新增 `isAutoCollapseCandidate` 与 `isSupersededThinking` 展示 prop，仅在块可能发生程序收起时启用 selection 监听。
- 修订说明：第二轮已更新结论、正文候选排除项、晚到工具恢复状态、thinking 接管规则、registry reducer、稳定键、duration 终点、selection 订阅、分类口径、文件清单、自动化测试、人工矩阵、阶段 0 数据采样和风险表。两位审阅者的复审批注原文均保留未改写。
