# CloudCLI 动态对话流布局稳定性场景与验证方案

> 状态：两位 Harness 复审已汇总，评审意见已收敛；阶段 -1 基础设施及阶段 1 首批共同根因修复已落地，继续实施中
> 日期：2026-09-13
> 范围：聊天消息区中所有会改变内容高度、滚动位置、组件身份或可见视口的动态事件
> 关联文档：`agent-activity-experience-optimization-plan.md`、`streaming-output-experience-optimization-plan.md`、`../architecture/05-scrolling.md`

## 0. 结论先行

本轮暴露的“长思考收起时出现大块空白，随后下一段内容闪到下方”不是孤立动画问题，而是动态对话流的**布局交接一致性**问题。只验证“思考 → 工具”一条路径不足以阻止同类故障再次出现，因为正文增长、工具分组、结果自动展开、懒加载换壳、键盘变化和 iOS 异步滚动都可能在同一时间改变几何。

本文采用两层覆盖：

1. **单事件覆盖**：每一种会改变消息区 `scrollHeight`、`clientHeight`、`scrollTop`、DOM 身份或绘制成本的事件都单独验证。
2. **组合覆盖**：对最危险的“缩高 + 增高”“换壳 + 流式”“视口变化 + 自动交接”等并发事件做成确定性场景，而不是只依赖人工随机复现。

本文不是实施方案，不预先指定一定使用 `ResizeObserver`、锚点差量补偿或取消高度动画。评审通过后，再由验证结果选择最小且稳定的修复路径。

### 0.1 实施进度（2026-09-13）

- 已建立独立 Playwright transcript fixture，使用生产消息 store、消息投影、分组和渲染组件，在锁定版本的 Chromium 与 WebKit 中运行；fixture 不进入生产 bundle。
- 已建立逐帧 `scrollTop/scrollHeight/clientHeight/bottomGap/anchorTop` 时间线、程序化滚动 API 透传记录，以及失败 trace、截图、录像和浏览器版本产物。
- 已保留稳定基线、360px 错位负向样本和真实主线程忙等校准；CI 档每场景重复 5 次，release 档重复 20 次。
- 已修复“单工具 → 工具组”换壳导致首个工具卸载、展开态丢失和高度突变的问题，并由真实浏览器断言首个工具 DOM 节点身份存续。
- 已修复长思考收起与正文接管时，正文新增高度在绘制后一帧才被跟底纠正的问题；跟随循环改为“最短协调窗口 + 连续两个渲染帧几何稳定”，不再由墙钟单独宣告结束。
- 当前自动化覆盖的是首批高风险共同根因，不代表 §3–§11 的全场景、Safari 实机和 iOS WKWebView 发布门槛已经完成；后续仍按阶段 0–3 扩展。

## 1. 目标、边界与判定口径

### 1.1 目标

- 覆盖用户已经观察到的空白、闪现、二次跳动。
- 主动发现用户尚未遇到但由同一机制可能触发的视口漂移、误跟底、内容回弹和状态错乱。
- 为桌面浏览器、移动浏览器和 Capacitor iOS WKWebView 建立可重复的验收基线。
- 将“状态逻辑正确”和“视觉连续”分开验证，避免 jsdom 中写过 `scrollTop` 就被误判为体验正确。
- 让后续修复具备明确的完成条件和回归保护。

### 1.2 非目标

- 不修改 Provider 协议或服务端事件格式。
- 不评价思考内容本身是否应该展示。
- 不在本文决定具体动画参数或引入用户设置。
- 不要求穷举无限状态空间；使用事件清单、边界值和高风险组合获得工程上可审计的覆盖。

### 1.3 核心不变量

任何场景都必须满足以下不变量：

1. **贴底不变量**：交接前处于底部且用户没有主动离开时，交接全过程底部间隙不得出现可见突增。
2. **阅读不变量**：用户已上滑、选择文字、聚焦或主动展开内容时，程序不得改变其阅读锚点或所有权。
3. **单调交接不变量**：上一段退出、下一段进入只能形成一次连续交接，不得先消失、回弹、再消失。
4. **身份不变量**：实时记录换成持久记录、单工具换成工具组时，当前仍可见或已由用户展开的逻辑内容不得被卸载重建；断言必须覆盖最外层 row 和第一条工具内容节点的挂载次数、可见性与用户展开状态，不能依赖滚动补偿掩盖 remount。
5. **终态不变量**：动画和流式结束后，DOM 展开状态、registry 状态和屏幕显示必须一致。
6. **中断不变量**：用户触摸滚动后，所有自动跟随必须在下一次视觉位移前停止。
7. **内容不变量**：任何布局协调不得丢字、重复消息、交换 thinking/text/tool 顺序或隐藏需用户处理的交互。
8. **性能不变量**：长内容交接不得持续制造 long task、全量 Markdown 重算或高频无效滚动写入。
9. **默认所有权不变量**：正常打开会话尾部时默认是 `AUTO_FOLLOW`；只有真实 wheel/touch/keyboard/拖动意图才能进入 `USER_DETACHED`，程序定位使用临时 claim。没有输入时，单帧 `bottomGap` 或纯布局变化只能作为诊断数据，不能取得或翻转用户所有权。

### 1.4 视觉失败定义

以下任一现象即判失败：

- 一帧或更久出现不属于设计留白的大面积空白。
- 后继内容先出现在一个位置，随后跳到另一个位置。
- 视口在交接中出现两个方向的移动或明显回弹。
- 用户阅读的文本离开原位置超过 8px，且不是用户手势导致。
- following 时相对交接前稳态基线的底部间隙正向尖峰超过 24px，或超过两个显示帧仍未恢复。
- 收起后的触发器、正文或工具行出现重复、消失、重新闪入。
- 同一次交接触发两次以上程序折叠或多个滚动控制器竞争。

## 2. 覆盖模型

### 2.1 事件类型

| 维度 | 取值 |
| --- | --- |
| 上一段内容 | 短思考、长思考、超长思考、多段思考、正文、工具、工具组、子代理、权限/问答卡片 |
| 后继内容 | 下一段思考、流式正文、稳定正文、首个工具、第二个工具、工具结果、错误、完成状态、无后继内容 |
| 消息内容几何 | `scrollHeight` 仅缩高、仅增高、先缩后增、同时缩增、DOM 换壳、字体/图片晚到 |
| 容器可视几何 | `clientHeight` 被键盘/活动栏等程序事件压缩、被 Composer 多行输入等用户事件压缩、宽度变化引发全文重排、与 `scrollHeight` 同帧变化 |
| 用户位置 | 精确贴底、距底 1–49px、距底 50px、已上滑一屏、正在惯性滚动、正在拖动 |
| 用户所有权 | AUTO、用户主动展开、用户主动收起、hover、focus、文字选择、导出 |
| 流速 | 单步、低速、20Hz、高速批量、同帧多事件、主线程阻塞后集中提交 |
| 平台 | Chromium 桌面、Safari 桌面、移动 Safari、Capacitor WKWebView、窄屏触控、reduced motion |
| 生命周期 | 前台、后台、切换会话、切换工作区 Tab、重连、历史刷新、冷启动、旧 WebView 复用 |

### 2.2 高风险组合原则

全部笛卡尔积没有工程价值，必须至少覆盖以下组合类别：

- 大幅缩高 × 后继内容同步增高。
- 大幅缩高 × DOM key/容器类型变化。
- 大幅缩高 × iOS 惯性滚动或异步滚动。
- 自动交接 × 用户在临界时刻取得所有权。
- 流式临时记录结束 × 持久记录刷新。
- 第二条工具出现 × 第一条工具已有展开输出。
- 长 Markdown × 低帧率/主线程阻塞。
- 消息区高度变化 × 键盘或底部活动栏高度变化。
- 懒加载挂载边界 × 大幅滚动补偿。

### 2.3 Provider 事件形态验证矩阵

该表用于路由场景，不把尚未真机采样的行为写成事实。源码中存在对应事件路径，只代表“支持该形态”，不代表每个 Provider 的所有版本都会稳定发出。阶段 -1 必须从真实运行时间线回填“实测状态”。

| Provider | 当前代码可见形态 | 必跑场景 | 实测状态 |
| --- | --- | --- | --- |
| Claude | thinking/text delta、`stream_end`、tool use/result、complete | T07、A06、L03、L05、L08 | 待按当前 CLI 版本采样 |
| `workbuddy`（内嵌引擎 CodeBuddy） | thinking/text delta、`stream_end`、tool use/result、complete | T07、A06、L03、L05、L09 | 待按当前版本采样 |
| Pi | stream delta、`stream_end`、tool use/result、complete | L03、L05、L08、L12 | 待按当前版本采样 |
| OpenCode | stream delta、`stream_end`、tool use/result、complete | L03、L05、L08、L12 | 待按当前版本采样 |
| Cursor | stream delta；存在依赖 complete 收尾的兼容路径 | L02、L06、L08、L12 | 待按当前版本采样 |
| Codex | realtime/持久 transcript 均可能产生 thinking、text、tool 与 complete，身份来源不同 | T08、L04、L08、L09、L11 | 待按当前 CLI 版本采样 |
| DSH | 压缩 transcript 与实时事件需分别投影 | L08、L09、L11、L12 | 待按当前版本采样 |

每个 Provider 至少记录：thinking 是逐 delta 还是一次性行、thinking 是否在 tool 前 settle、是否发 `stream_end`、tool input/result 是否同批、abort 是否仍有 complete、实时与持久内容是否字节相等。任何一项变化都要重新路由并执行对应 P0 场景。

## 3. 基线与思考交接场景

### 3.1 基线场景

| ID | 场景与事件序列 | 预期 | 优先级 | 验证 |
| --- | --- | --- | --- | --- |
| B01 | 短思考持续流式，无后继内容 | 内容平滑增长；贴底稳定；不自动收起 | P0 | 自动化 + 三端人工 |
| B02 | 长思考持续流式到 3 屏以上 | 不因 Markdown 重排离底；滚动写入不过量 | P0 | 浏览器性能脚本 + 真机 |
| B03 | 超长思考达到 10 屏以上 | 无整屏白闪、无进程卡死；内存稳定 | P0 | 压测 + 真机录屏 |
| B04 | 用户在思考流式中上滑 | 后续 delta 不拉回底部 | P0 | 浏览器集成 |
| B05 | 用户重新回到底部 | 只发生一次贴底恢复，后续继续跟随 | P1 | 浏览器集成 |
| B06 | 思考为空、空白或只含换行 | 不创建零高或闪入后消失的面板 | P1 | 单测 |
| B07 | 思考包含长代码块、表格、列表 | 高亮和换行完成后不产生二次跳动 | P1 | 浏览器集成 |
| B08 | 思考含超长不换行文本 | 不横向撑宽，不改变纵向滚动判定 | P1 | 响应式人工 |

### 3.2 思考到思考

| ID | 场景与事件序列 | 预期 | 主要风险 | 优先级 |
| --- | --- | --- | --- | --- |
| T01 | 短思考 A → 思考 B | B 稳定出现后 A 单次收起，无闪白 | timer 顺序 | P0 |
| T02 | 长思考 A → 思考 B | B 的视觉位置连续；A 收起不产生空洞 | 大幅缩高 | P0 |
| T03 | 超长思考 A → 思考 B | 不逐帧重排数千像素导致掉帧或白屏 | WebKit 合成 | P0 |
| T04 | A → B → C 在 500ms 内连续到达 | latest-wins；不发生 A/B 同时或级联塌陷 | timer 叠加 | P0 |
| T05 | B 只出现一小段后被 C 替代 | B 至少满足最短可见约束，且不回弹 | 短命段 | P1 |
| T06 | A 正在收起时 B 继续快速增长 | B 保持可见锚点；收缩与增长合并处理 | 同时缩增 | P0 |
| T07 | A 尚标记 streaming，B 已出现 | A 不得在滚动保护过期后突然收起 | streaming 覆盖 open | P0 |
| T08 | 多段思考内容完全相同 | registry 不得因内容匹配歧义丢失身份 | fallback key | P0 |
| T09 | 多段思考 timestamp 相同 | React key/disclosure key 仍稳定唯一 | key 冲突 | P1 |
| T10 | 思考 B 到达时 A 在动画中途离开懒加载 1200px 观察带 | 只允许在 `transitionend` 后或连续两次布局观测高度稳定后保存占位；占位值必须等于终态高度 | IO 时序 | P0 |

### 3.3 思考到正文

| ID | 场景与事件序列 | 预期 | 主要风险 | 优先级 |
| --- | --- | --- | --- | --- |
| A01 | 短思考 → 流式最终正文 | 正文先可读，2.5s 后思考平滑收起 | 基线 | P0 |
| A02 | 长思考 → 流式最终正文 | 正文首屏位置稳定，不出现空白后跳动 | 大幅缩高 | P0 |
| A03 | 思考 → 正文首 token 极快到达 | 状态批量提交仍保持交接顺序 | 同帧事件 | P0 |
| A04 | 思考 → 正文很慢逐字到达 | 不重复启动折叠窗口 | timer 重启 | P1 |
| A05 | 正文达到 2.5s 前 settled，但会话仍 processing | 候选撤销时不得误收或先收后开 | 候选反转 | P0 |
| A06 | 流式 preamble 超过 2.5s，随后出现工具 | 已收起的思考不回弹；工具连续接棒 | preamble 误判 | P0 |
| A07 | 非流式 terminal 正文在 complete 后出现 | 收起只触发一次，终态一致 | 刷新顺序 | P0 |
| A08 | 正文为空或只有附件 | 不误判为最终正文 | 空内容 | P1 |
| A09 | 后台任务通知结果插入当前轮 | 不触发当前思考收起 | 类型误判 | P0 |
| A10 | 正文 Markdown 后续因代码高亮/图片加载增高 | 思考收起结束后仍能维持正确贴底 | 二次布局 | P0 |
| A11 | 正文首段在思考收起过程中被持久记录替换 | 不重新挂载闪入，不重置计时 | 身份替换 | P0 |
| A12 | 思考 → 错误/中止，无最终正文 | 保持可检查状态；不得留下空白壳 | 异常终态 | P1 |

## 4. 工具、工具组与子代理场景

### 4.1 思考到工具

| ID | 场景与事件序列 | 预期 | 主要风险 | 优先级 |
| --- | --- | --- | --- | --- |
| U01 | 短思考 → 首个普通工具 | 工具行先稳定出现，思考再单次收起 | 基线 | P0 |
| U02 | 长思考 → 首个普通工具 | 工具行在整个交接中保持可见位置 | 大幅缩高 | P0 |
| U03 | 超长思考 → Bash | 无白屏、无整屏跳跃、无严重掉帧 | 重排成本 | P0 |
| U04 | 思考 → 工具输入和结果同帧到达 | 不先显示 running 再因结果重建闪烁 | 批量提交 | P0 |
| U05 | 思考 → 工具输入到达，结果 50–500ms 后到达 | 结果增高不打断正在进行的折叠协调 | 二次布局 | P0 |
| U06 | 思考 → 工具失败，错误预览立即出现 | 错误摘要可见且不造成第二次跳动 | 错误增高 | P0 |
| U07 | 思考 → AskUserQuestion | 交互卡不得被自动收起或移出可视区 | 用户行动 | P0 |
| U08 | 思考 → 权限请求 | 权限 UI 始终可操作；活动栏切换不跳动 | 多容器变化 | P0 |
| U09 | 思考 → plan/exit-plan | 计划卡片状态变化不参与错误的自动折叠 | 特殊工具 | P1 |
| U10 | 思考 → 子代理容器 | 子代理摘要稳定接棒，计时更新不改行高 | 运行摘要 | P1 |

### 4.2 工具自身变化

| ID | 场景与事件序列 | 预期 | 主要风险 | 优先级 |
| --- | --- | --- | --- | --- |
| G01 | 第一条工具单独显示 → 第二条工具到达并形成工具组 | 第一条不得先消失再以组形式闪入 | DOM 换壳 | P0 |
| G02 | 第一条 Bash 已展开输出 → 第二条工具形成组 | 产品规则明确为“不得自动隐藏已经可见或由用户展开的工具”；第一条工具内容节点继续存续、保持展开且视口不动 | 极端缩高 | P0 |
| G03 | 工具组 running → completed 摘要变化 | 行高不变化或变化被稳定协调 | 文案宽度 | P1 |
| G04 | 工具组新增第三至第二十条工具 | 组容器身份稳定，不按每条工具重新挂载 | group key | P0 |
| G05 | 工具组中隐藏思考穿插 | 分组连续且隐藏行不制造几何占位 | 过滤顺序 | P1 |
| G06 | 工具结果让 Bash 自动展开长输出 | 用户贴底时无二次跳；上滑时不改锚点 | 自动增高 | P0 |
| G07 | Bash 运行中每秒计时更新 | 数字宽度变化不造成纵向抖动 | 周期更新 | P2 |
| G08 | Bash 成功/失败状态切换 | badge、耗时、错误预览一次性稳定出现 | 多字段提交 | P1 |
| G09 | 工具结果从空变成一万行输出 | 页面响应，内部滚动与 transcript 滚动不竞争 | 超长输出 | P0 |
| G10 | 用户主动展开/收起单工具 | 只遵循用户操作；其他程序事件不得反转 | 所有权 | P0 |
| G11 | 用户主动展开/收起工具组 | 组内结果更新不得抢走用户状态 | 所有权 | P0 |
| G12 | 工具结果包含异步图片、diff、文件列表 | 子内容晚到后不改变阅读锚点 | 异步尺寸 | P1 |
| G13 | 工具成组、prepend 或 `showThinking` 切换改变本次渲染顺序 | 对仍可见的逻辑内容，外层 row 与第一条工具内容节点均不得 remount，挂载计数保持一次；已折叠且不可见的详情可按产品规则不挂载 | occurrence key | P0 |

### 4.3 子代理

| ID | 场景与事件序列 | 预期 | 主要风险 | 优先级 |
| --- | --- | --- | --- | --- |
| S01 | 折叠子代理持续新增 100 个活动 | 只更新摘要；未挂载完整 timeline | 性能 | P0 |
| S02 | 展开子代理持续新增活动 | 新活动增长遵循用户是否贴底，不抢滚动 | 嵌套增长 | P0 |
| S03 | 子代理完成时摘要与结果同时到达 | 不重新挂载，不发生高度双跳 | 多源更新 | P1 |
| S04 | 子代理失败并显示两行错误摘要 | 摘要增高只发生一次 | 错误终态 | P1 |
| S05 | 子代理中连续工具和思考嵌套 | 内层 disclosure 不控制外层 transcript 滚动 | 嵌套控制器 | P0 |
| S06 | 子代理被中止、重试或结果晚到 | 状态单调，旧结果不使面板回弹 | 乱序事件 | P1 |

## 5. 流式生命周期、记录身份与消息顺序

| ID | 场景与事件序列 | 预期 | 主要风险 | 优先级 |
| --- | --- | --- | --- | --- |
| L01 | thinking stream_delta → thinking settled | DOM 和 disclosure 身份连续 | 临时 ID 替换 | P0 |
| L02 | text stream_delta → text settled | 正文不闪空，不重新从头渲染 | 临时 ID 替换 | P0 |
| L03 | thinking/text 同一批次更新 | 两通道顺序固定，只提交一次布局 | 原子性 | P0 |
| L04 | tool_use 插入两个流式通道之间 | 视觉顺序与 Provider 顺序一致 | merge 排序 | P0 |
| L05 | stream_end 与 complete 连续到达 | 只 finalize 一次，无重复行 | 双收尾 | P0 |
| L06 | 只有 complete，没有 stream_end | 最后一批内容同步可见，状态正常收尾 | Provider 差异 | P0 |
| L07 | 用户中止且没有最终正文 | 思考/工具保持可检查，无空占位 | 中止路径 | P1 |
| L08 | 持久历史在实时记录仍存在时刷新 | 去重过程不改变可见几何 | prune/dedupe | P0 |
| L09 | 持久记录内容与实时记录差一个字符、尾换行或规范化空白 | 精确内容匹配失败时，用户不得看到立即折叠、重复行或可见内容 remount；本文只约束可观察行为，关联机制留给阶段 1。若最终选择回传共享 id，必须另行评审并修订“不得扩展 Provider 协议”的边界 | 内容匹配 | P0 |
| L10 | 两条相同思考内容同时存在 | 不通过内容唯一性错误迁移状态 | 状态串行 | P0 |
| L11 | timestamp 无效、相同或顺序逆转 | 使用稳定后备身份且不跨轮关联 | 数据边界 | P1 |
| L12 | WebSocket 断线重连后 replay 多条事件 | 不批量级联折叠、不重复工具组换壳 | 重放突发 | P0 |
| L13 | 外部历史刷新在收起动画中完成 | 刷新不得取消或重新启动错误动画 | 并发刷新 | P0 |
| L14 | 旧会话后台继续流式，用户切入后同步追平 | 首帧直接稳定在最新状态，不补播中间布局 | 后台积压 | P1 |

## 6. 滚动位置与用户意图边界

| ID | 场景与事件序列 | 预期 | 优先级 |
| --- | --- | --- | --- |
| R01 | 精确贴底时发生大幅缩高 | 全程保持尾部，无空白和回弹 | P0 |
| R02 | 初始底部间隙为 1px、24px、49px，且用户仍处于 following 所有权时发生交接 | 继续 following；判定相对各自基线，不要求绝对间隙小于 24px | P0 |
| R03 | 初始底部间隙为 50px、51px，且用户已通过真实手势取得 detached 所有权 | 即使后续缩高使差值跌破阈值，也不得自动恢复 following | P0 |
| R04 | 已上滑一屏时长思考被后继替代 | 不自动收起，不改变可见文本位置 | P0 |
| R05 | 折叠 timer 到期前一帧用户开始拖动 | 用户手势优先，自动交接取消 | P0 |
| R06 | 自动协调过程中用户触摸拖动 | 下一次视觉位移前停止程序滚动 | P0 |
| R07 | iOS 惯性滚动尚未停止时后继到达 | 不打断惯性、不跳到底部 | P0 |
| R08 | 程序滚动触发 scroll 事件 | 必须存在可审计的程序滚动 claim；“假用户离底”计数为 0 | P0 |
| R09 | 后继内容增高使底部差值瞬间超过 50px | 用户所有权由 wheel/touch/keyboard 等真实意图决定，不由单次布局差值翻转 | P0 |
| R10 | 用户点击回到底部时恰逢思考收起 | 合并为一次稳定定位 | P1 |
| R11 | 加载更早消息的 restore 与自动交接重叠 | prepend restore 优先，不执行跟底 | P0 |
| R12 | 搜索 smooth 跳转与自动交接重叠 | 搜索锚点从开始到 `scrollend` 或静默稳定判据成立前持续独占；交接不得拉回尾部 | P0 |
| R13 | 初始 settle、折叠协调、懒加载挂载和流式跟底在同一帧请求滚动 | 同一 rAF 周期至多一次程序化 `scrollTop` 写入，每次写入携带可审计来源；不限定具体协调架构 | P0 |
| R14 | 工作区 Tab 恢复位置时发生消息批量更新 | detached/following 意图准确恢复 | P1 |
| R15 | 短会话本身不可滚动时发生收起/展开 | 不产生负偏移、橡皮筋或空白底部 | P1 |
| R16 | detached 用户的底部差值因内容增缩在 45–55px 间多次跨越 | 所有权保持 detached，writer 不反复启停；是否采用双阈值由基线决定，不能只靠滞回替代事件来源判定 | P0 |
| R17 | 初始 `bottomGap` 为 50px/51px，无任何用户输入，仅由内容增缩反复跨越阈值 | 默认保持 `AUTO_FOLLOW`，单帧几何差值不得自行取得 `USER_DETACHED`；与 R03/R16 共同覆盖所有权的获得与保持 | P0 |

## 7. 视口、平台与系统状态

| ID | 场景与事件序列 | 预期 | 主要风险 | 优先级 |
| --- | --- | --- | --- | --- |
| P01 | Chromium 桌面 60Hz | 基准连续，无布局偏移 | 基线 | P0 |
| P02 | Safari 桌面 | 不依赖 Chromium 的滚动锚定特性 | 引擎差异 | P0 |
| P03 | iPhone WKWebView 60Hz | 无异步滚动白闪 | 合成线程 | P0 |
| P04 | iPhone ProMotion 120Hz | 不因时间/帧数换算提前结束 | 高刷新率 | P1 |
| P05 | 低电量模式或 30Hz 模拟 | 掉帧时仍以实际布局完成为准 | 低帧率 | P0 |
| P06 | `prefers-reduced-motion: reduce` | 无动画也必须同一绘制周期稳定定位 | 瞬时缩高 | P0 |
| P07 | iOS 文本大小 100%/135%/最大辅助字号 | 换行增多后仍无大幅闪现 | 动态字体 | P1 |
| P08 | 竖屏 ↔ 横屏旋转时正在流式/折叠 | 不丢底部意图、不产生永久空白 | clientHeight 变化 | P1 |
| P09 | 键盘显示状态下思考转正文/工具 | 键盘高度与消息高度变化统一处理 | 双重视口变化 | P0 |
| P10 | 交接中键盘隐藏 | Composer 与 transcript 不分两次跳动 | VisualViewport | P0 |
| P11 | App 进入后台后在 timer 到期后恢复 | 不播放过期动画或一次性级联收起 | timer 节流 | P0 |
| P12 | App 内切换服务器再返回缓存 WebView | 不使用过期状态/资源误判修复无效 | WebView 复用 | P1 |
| P13 | 页面缩放、显示缩放或安全区改变 | 不出现底部可滚动空带 | 可视视口 | P2 |
| P14 | 桌面拖动窗口宽度或展开/收起侧栏时正在流式或折叠 | 文本重排不造成永久离底、错误 auto-collapse 或多次回弹 | 横向重排 | P0 |

## 8. 内容规模、性能与渲染边界

| ID | 场景与事件序列 | 预期 | 优先级 |
| --- | --- | --- | --- |
| F01 | 思考高度 100、500、1500、5000、10000px 分档收起 | 每档均无视觉断层；找出安全边界 | P0 |
| F02 | 100 条可见消息 + 长思考交接 | commit 和 layout 无持续 long task | P0 |
| F03 | 1000 条已加载消息、尾部 30 条挂载 | 懒加载不放大交接抖动 | P1 |
| F04 | 20Hz thinking 与 text 交替更新 | 每帧最多一次有效协调 | P0 |
| F05 | 主线程以忙等实际阻塞 100/300/600ms 后交接 | 实际阻塞时长须达到目标的 95%；墙钟、rAF timestamp 或 WAAPI 时间跳跃都不能单独结束协调；恢复后完成同帧几何校正，并严格按 §12.3 对应驱动类型的完成信号与跨帧几何稳定判据收敛 | P0 |
| F06 | 一帧内追加 thinking、tool、tool_result、complete | 最终画面一次稳定提交 | P0 |
| F07 | Markdown 高亮耗时超过动画时长 | 协调结束条件不早于真实布局稳定 | P0 |
| F08 | 图片无尺寸，加载后高度突增 | detached 用户不动；贴底用户稳定 | P1 |
| F09 | 字体加载后全页重新换行 | 不产生永久离底或错误 auto-collapse | P1 |
| F10 | 连续十轮思考/工具交接 | 无 timer、observer、rAF 泄漏或累计漂移 | P0 |
| F11 | 页面长时间运行后一百次交接 | 内存、CPU 和滚动误差不随次数增长 | P1 |

## 9. 用户所有权、可访问性与交互冲突

| ID | 场景与事件序列 | 预期 | 优先级 |
| --- | --- | --- | --- |
| O01 | 用户主动展开已自动收起的思考 | 后续正文/工具不得再次收起 | P0 |
| O02 | 用户主动收起正在流式的思考 | 新 delta 不得重开 | P0 |
| O03 | 用户点击与自动 timer 同一 tick | reducer 以用户动作优先 | P0 |
| O04 | 桌面 hover 覆盖折叠时间点 | 离开后重新获得完整阅读窗口 | P1 |
| O05 | 键盘 focus 在 trigger/copy 控件 | focus 离开前不自动收起 | P1 |
| O06 | iOS 长按选择文字并拖动选择柄 | selection 期间内容和视口均稳定 | P0 |
| O07 | selection 跨思考块与正文 | 任一相交即保护，不因 DOM 收缩丢选择 | P0 |
| O08 | VoiceOver 聚焦思考内容 | 自动变化不移动辅助技术焦点 | P0 |
| O09 | 流式进行中触发导出 | 点击时冻结当前消息数组快照；包含当时已经投影的部分流式内容，不等待 settle，之后到达的 delta 不进入该次导出；全部思考展开且不运行自动折叠 timer | P1 |
| O10 | `showThinking` 在运行中切换 | 隐藏/显示不破坏工具分组或滚动身份 | P1 |
| O11 | 用户展开工具输出后上滑阅读 | 新结果不收起、不拉回底部 | P0 |
| O12 | 触控设备出现粘滞 hover | 不永久阻止交接，也不误把触摸当 hover | P1 |

## 10. 部署、缓存与诊断可信度

| ID | 场景与事件序列 | 预期 | 优先级 |
| --- | --- | --- | --- |
| D01 | 构建并重启服务后浏览器硬刷新 | HTML 引用最新哈希资源 | P0 |
| D02 | Capacitor 已缓存服务器 WebView，仅重启后端 | 明确提示或验证前端是否真正刷新 | P0 |
| D03 | Service Worker 已缓存旧哈希资源 | 新 HTML 仍加载新哈希，不混用新旧 JS/CSS | P0 |
| D04 | App 切后台/杀进程/重新打开 | 能区分 WebView 复用与完整页面重载 | P1 |
| D05 | 网络慢速导致 JS/CSS 到达顺序不同 | 不出现新 JS 配旧 CSS 的中间状态 | P1 |
| D06 | 真机报告问题时记录资源 hash、UA、iOS 版本 | 每次复现都能证明运行版本 | P0 |

## 11. 必测组合场景

以下组合是单事件测试无法替代的发布门槛：

| ID | 组合 | 通过条件 |
| --- | --- | --- |
| C01 | 5000px 思考收起 + 下一段思考高速增长 + iOS 30Hz | 后继段位置连续，无白屏，无终态跳动 |
| C02 | 5000px 思考收起 + Bash 结果自动展开 2000px | 缩高和增高作为同一布局变化处理 |
| C03 | 长思考收起 + 第二条工具触发工具组换壳 | 已经可见或由用户展开的第一条工具内容节点不卸载、不隐藏、不丢展开态，视口不跳 |
| C04 | 思考仍 streaming + tool_use + 稍后 stream_end | 真正视觉收起时滚动保护仍有效 |
| C05 | 思考收起 + 实时记录被持久记录替换 | disclosure/React key 连续，动画只发生一次 |
| C06 | 思考收起 + 用户在临界帧开始上滑 | 用户手势优先，不被下一帧拉回 |
| C07 | 思考收起 + 程序 scroll 事件 + 后继内容增高 | 不误判用户离底，不自我取消 |
| C08 | 思考收起 + IntersectionObserver 卸载邻近行 | 占位高度稳定，无第二次几何变化 |
| C09 | 思考收起 + 键盘隐藏 + 活动栏退出 | 三个高度变化不形成三级跳 |
| C10 | 后台节流 3 秒后恢复 + 多个过期 timer | 只提交最终合法状态，不补播动画 |
| C11 | reduced motion + 超长思考瞬时收起 | 同一绘制周期保持视觉锚点 |
| C12 | WebSocket 重连 replay 思考、工具、结果、complete | 不级联折叠、不重复行、不闪空 |
| C13 | 搜索跳转进行中 + 尾部自动交接 | 搜索结果位置稳定，尾部 writer 不介入 |
| C14 | prepend restore + 懒加载挂载 + 新流式 delta | 老消息锚点不动，新消息不强制跟底 |
| C15 | VoiceOver/文字选择 + 后继工具出现 | 阅读所有权保持，交互内容不消失 |
| C16 | Composer 从 1 行增至 5 行 + 长思考收起 + following | 用户输入造成的 `clientHeight` 压缩与内容 `scrollHeight` 缩短一次协调，不产生双跳 |
| C17 | 折叠协调 + 懒加载挂载 + 流式跟底同一个 rAF 周期排队 | 同一 rAF 周期至多一次程序化 `scrollTop` 写入，且该写入携带可审计来源；不限定最终采用仲裁器、claim 或其他实现 |
| C18 | 长思考收起 + WebFont 晚到导致全文重排 + following | 二次高度变化仍在协调生命周期内，无永久离底 |
| C19 | 浏览器 `visualViewport.resize` + 长思考收起；Capacitor `keyboardWillHide` + 长思考收起 | 两条键盘机制分别验收，事件来源明确，均无空白或三级跳 |

## 12. 验证层级与工具要求

### 12.1 纯状态单测

适合验证：

- disclosure ownership、latest-wins、timer 取消。
- final answer 与 preamble 判定。
- streaming → settled 身份迁移。
- 相同内容、相同 timestamp、乱序事件。
- 工具分组输入和稳定 key。

纯状态测试不得声称验证了“无闪现”。

### 12.2 DOM 组件测试

适合验证：

- React 节点是否重新挂载。
- transition class、reduced-motion 分支。
- 用户点击、focus、selection guard。
- 工具结果和分组对 DOM 结构的影响。

jsdom 没有真实 layout，因此不得用伪造 `scrollHeight` 写入次数代替视觉验收。当前 `IntersectionObserver` 在 jsdom 中不存在，`useLazyRowObserver` 会返回 `null` 并让全部行永久挂载；除非测试显式注入真实等价的 observer 行为，否则 DOM/组件测试不能声称覆盖 T10/C08。

### 12.3 真实浏览器集成测试

至少需要：

- Chromium 与 WebKit 两个引擎。
- 真实 CSS transition、`ResizeObserver`、`IntersectionObserver`。
- 可控制的 30/60Hz 帧节奏和 100–600ms 主线程阻塞。
- 每帧采集 `scrollTop`、`scrollHeight`、`clientHeight`、后继锚点 `getBoundingClientRect().top`。
- 对 DOM key/挂载次数、程序滚动来源和 observer 回调做诊断标记。默认由测试 runner 通过现有 `data-message-timestamp`、`MutationObserver`、observer 包装，以及在业务脚本之前安装的纯透传拦截器采集；拦截清单必须覆盖 `scrollTop/scrollLeft` setter、`scrollTo`、`scrollBy` 和 `scrollIntoView`，不得改变同步返回或原生语义。搜索场景至少记录一次 program claim。不为此向生产 bundle 增加常驻状态或布局属性；只有真机远程诊断证明外部采集不足时，才评审零布局开销的生产诊断标记。

建议断言：

```text
bottomGap = scrollHeight - scrollTop - clientHeight
baselineBottomGap = 交接触发前最后 3 个稳定帧的 bottomGap 均值
positiveBottomGapSpike = max(0, bottomGap(frameN) - baselineBottomGap)
anchorDrift = successorTop(frameN) - 交接前稳定 anchorTop
```

following 场景以交接前最后 3 个 `scrollHeight/clientHeight/anchorTop` 均不再变化的帧为基线；若事件本身从同帧开始，则使用事件提交前同步采样值。交接期间 `positiveBottomGapSpike` 不应超过 24px。detached 阅读场景使用相对基线的最大绝对 `anchorDrift`，不得超过 8px，同时单独记录相邻帧位移和最终漂移，以捕获“先跳再回来”。两类指标互不替代。阈值最终由真机基线校准，但不能只看最终帧。

原生 scroll anchoring 只能视为平台优化，不能成为正确性前提。runner 必须记录 `overflow-anchor` 支持情况，并至少执行一次禁用或不可用锚定的路径；`.chat-messages-pane` / `.chat-message` 的 containment 与锚定行为一并纳入样式矩阵。旧版 WebKit 不支持时仍必须靠 CloudCLI 自己满足核心不变量。

收敛证据按驱动类型区分：

- CSS transition/animation：以目标属性的 `transitionend`/`animationend` 为首选完成信号，随后仍需两个不同 rAF 帧的几何稳定采样。
- JS 驱动或 reduced-motion：以两个帧标识/时间戳不同的 rAF 回调中，同一 `data-message-timestamp` 锚点 `getBoundingClientRect().top` 与 `scrollHeight` 均不变为主判据。
- 时间类信号只允许作为“测试超时失败”兜底，不能单独宣告成功；页面必须处于 visible，避免后台 rAF 暂停产生伪稳定。

### 12.4 iOS 真机验收

真机是 P0 发布门槛，至少记录：

- iPhone 型号、iOS 版本、WKWebView/独立 Safari。
- 60Hz/120Hz、低电量模式、减少动态效果、动态字体。
- 当前前端 JS/CSS hash，确认不是旧 WebView。
- 60fps 屏幕录制；必要时逐帧检查空白和锚点位置。
- 复现前是否精确贴底、是否存在惯性滚动、键盘是否显示。

## 13. 建议的自动化场景生成器

为了避免每次手写新 Provider 会话，建议后续实现一个仅测试环境可用的 transcript fixture 驱动器：

```ts
type TranscriptFixtureStep = {
  atMs: number;
  action:
    | 'append-thinking'
    | 'settle-thinking'
    | 'append-text'
    | 'append-tool'
    | 'attach-tool-result'
    | 'finalize-stream'
    | 'replace-with-history'
    | 'set-processing'
    | 'set-viewport'
    | 'block-main-thread';
  payload?: unknown;
};
```

约束：

- fixture 必须调用真实 store、消息投影、分组和 transcript 组件，不能另造简化 UI。
- 可注入内容高度和事件时间，但滚动与布局必须交给真实浏览器。
- 每个场景输出时间线、几何采样和屏幕录像/截图，失败时能还原是哪一次事件引起。
- fixture 只作为测试入口，不进入生产 bundle，也不扩展 Provider 协议。

## 14. 分阶段执行建议

### 阶段 -1：建立浏览器验证基础设施

- 新增真实浏览器 runner，至少能运行 Chromium 与 WebKit；不得把 jsdom 当成替代。
- 完成 §13 fixture 驱动器，能够注入事件时序、主线程阻塞、视口变化和用户滚动意图。
- 每帧产出 `scrollTop/scrollHeight/clientHeight/anchorTop` 时间线，并可记录 DOM 节点身份、挂载次数、滚动 claim 来源和 observer 回调。
- 测试失败时保留可回放录像或逐帧截图及资源 hash。
- 用一个稳定基线场景和一个故意制造 remount/空白的负向 fixture 证明 runner 能分别判通过与失败，之后才进入阶段 0。
- Chromium/WebKit 版本通过锁文件和固定 runner 镜像锁定，版本号写入每份失败产物；升级版本必须重跑基线。
- correctness 类不变量零容忍；几何阈值在 CI 每场景重复 5 次，release/nightly 重复 20 次并以 P95 判定，同时禁止任一次超过阈值 2 倍。基线与负向 fixture 永久保留且每轮都运行，防止 runner 悄悄失去识别能力。
- `block-main-thread` 必须使用可校准忙等，在阻塞前后回读 `performance.now()` 并断言实际时长达到目标的 95%；未达到即判 fixture 失效，不能把场景记为通过。

### 阶段 0：建立可观测基线

- 先实现 C01、C02、C03、C04、C06、C09、C11，以及评审补入的 C16–C19。
- 记录当前实现每帧几何，不修改行为。
- 分清“浏览器没有滚动写入”“写入发生但未同帧绘制”“其他布局二次变化”三类原因。

### 阶段 1：修复共同根因

- 依据基线选择统一布局协调机制。
- 优先覆盖大幅缩高、同时增高、DOM 换壳和用户中断。
- 结束条件必须来自 §12.3 的动画完成与跨两个不同 rAF 帧的几何稳定；墙钟只能使测试超时失败，不能宣告布局已经完成。
- “单工具 → 工具组”必须保证仍可见或由用户展开的第一条工具内容节点不因换父路径、默认折叠或外层 key 变化而卸载，并保留其展开态与测量状态；不能把内容 remount 交给通用滚动补偿掩盖，同类 occurrence key 变化一并由 G13 固化。
- 用户 detached/following 所有权必须由真实输入意图和程序滚动 claim 仲裁，不能让任意 `scroll` 事件按单帧底部差值直接改写。

### 阶段 2：补齐非思考路径

- 工具分组、工具结果、子代理、活动栏、键盘、历史替换、懒加载全部接入相同不变量。
- 不允许每种组件各自新增独立滚动 writer。

### 阶段 3：真机与降级策略

- 桌面通过后仍必须单独验证 WKWebView。
- 若旧版 WebKit 无法稳定执行大幅高度动画，应按内容高度和能力检测采用更保守的视觉降级，而不是继续堆叠 rAF timer。
- reduced motion 必须有独立的同步稳定路径。

## 15. 发布门槛

以下条件全部满足才可认为该类问题解决：

1. 阶段 -1 的 runner、fixture、几何时间线和失败录像均可重复执行；浏览器版本、重复次数、P95 口径及单次极值规则已固定，正向与负向 fixture 均持续通过各自预期。
2. 所有 P0 单场景通过。
3. C01–C19 组合场景全部通过。
4. Chromium、Safari 和至少一台 iOS WKWebView 真机通过。
5. 自动化检查整个交接时间线，而不只检查最终 `scrollTop`。
6. 用户上滑、选择文字和辅助技术焦点场景无回归。
7. 连续 100 次交接无累计漂移、句柄泄漏或显著 CPU 增长。
8. 真机复现材料包含资源 hash，排除旧 bundle 干扰。
9. 真机校准后的几何阈值已回写本文和测试配置；任何阈值变更都触发对应平台与场景维度的全量重跑。
10. 架构文档更新为实际采用的唯一滚动/布局所有权规则。

## 16. 请审阅者重点评估

1. 事件类型是否还遗漏任何会改变 transcript 几何或 DOM 身份的来源？
2. P0/P1 分级是否合理，是否有被低估的 Provider 特例？
3. C01–C19 是否覆盖最危险的并发组合？
4. following 的相对基线 `positiveBottomGapSpike ≤ 24px`、detached 阅读锚点最大绝对漂移 `≤ 8px` 是否适合作为初始阈值？
5. 是否同意纯 jsdom 测试不能作为“无闪现”的验收证据？
6. 对旧版 iOS WebKit，超长内容是否应明确允许取消整段高度动画作为降级？
7. 测试 fixture 是否应进入现有前端测试体系，还是独立为浏览器视觉回归套件？
8. 工具成组时“已可见或由用户展开的第一条工具内容不得被自动隐藏”这一产品规则，是否存在必须允许隐藏的反例？
9. 在不扩展 Provider 协议的边界内，L09 的可观察验收是否足以约束实时记录到持久记录的替换缺陷？
10. 发布门槛是否足以避免“自动测试通过、真机仍闪”的重复发生？

## 17. 审阅批注

> 请审阅者仅在本节追加批注，不直接修改正文。推荐格式：
>
> `### <Harness 名称> 审阅（YYYY-MM-DD）`
>
> `- [严重程度：高/中/低] <对应章节或场景 ID>：<问题、证据、建议>`

### Claude · 审阅（2026-09-13）

> [!WARNING] R02/R03：50px 贴底判定缺少滞回，存在边界抖动风险
> 方案把 49px 视为贴底、50px 视为阅读，实现中已有 `< 50` 判据（`useChatSessionState`）。风险点：缩高事件会让距底差值从 50+ 落回 50 以下，恰好越过阈值，触发 auto-follow 在临界帧重新介入并把用户正在读的内容拽回底部；内容再增高又跌回 50+，形成开-关抖动。R03 只验证了“恰好 50/51px”单点，没覆盖差值在阈值两侧反复跨越的场景。建议：① 定义双阈值滞回（进入跟随 `<50`、退出跟随 `>80`，退出后不立即回跟随）；② 新增组合场景：距底 45–55px 之间因内容增/缩反复抖动多次，断言用户阅读锚点始终被动、writer 不反复介入。

> [!WARNING] 12.3：bottomGap ≤ 24px 的判定口径未定义（绝对值 vs 增量），与 R02 自相矛盾
> R02 把“距底 1–49px”都算贴底，那么贴底用户在交接前的 bottomGap 可能已接近 49px，大于 24px。若 24px 是绝对值上限，则从 49px 起点开始的“贴底通过”必然失败；若是相对交接前基线的增量尖峰，则需明确基线帧、窗口期与累计口径。建议：明确为“相对交接前稳态基线的正向增量尖峰 ≤ 24px”，并规定基线采样规则（如交接触发帧前最后 3 帧均值），同时说明与 8px 锚点漂移的计量关系（同帧瞬时 vs 全程累计）。

> [!WARNING] P09/P10/C09：Composer 自身多行增高与键盘/活动栏归在同一桶，未区分“外部压缩 clientHeight”与“内部增长 scrollHeight”
> 消息区是 flex 布局，Composer 从 1 行增到 5 行同样压缩 transcript 的 clientHeight，但它是用户主动输入的结果，与键盘弹起、活动栏展开（系统/程序事件）性质不同，治理路径也不同。方案 2.2 只列了“消息区高度变化 × 键盘或底部活动栏高度变化”。建议：2.1 的几何变化维度显式拆成“scrollHeight 增长 / clientHeight 被外部压缩 / 两者同帧”，并补一条 C 组场景：Composer 增高 × 思考收起 × 贴底。

> [!WARNING] 第 7 节：桌面窗口/侧栏宽度变化导致的重排未覆盖（P08 只覆盖旋转）
> 旋转之外，桌面窗口宽度调整或侧栏展开/收起会改变 transcript 宽度 → 文本重排 → scrollHeight 变化，与 P08 同机制但触发源不同，且在桌面端比旋转更常见。建议新增 P 组场景：拖动窗口宽度/收起侧栏期间发生流式或折叠，断言不产生永久离底或错误 auto-collapse。

> [!WARNING] 12.3 的诊断埋点与 13 节“fixture 不进生产 bundle”的原则存在张力
> 12.3 要求“对 DOM key/挂载次数、程序滚动来源和 observer 回调做诊断标记”，这在真实浏览器里意味着生产代码要暴露这些信息；13 节又说 fixture 只作测试入口、不进生产。两者需明确取舍：埋点采用生产常驻且零布局开销的 `data-*` 属性（如 `data-message-key`、`data-scroll-source`），还是通过测试专用构建注入？否则验收方式不可复现、也难以回看线上问题。

> [!WARNING] C 组缺少“多来源同帧争抢滚动写入”的仲裁验收场景
> 实现里已有单一 rAF writer + 墙钟 deadline（`useChatSessionState` 单 writer），方案 14.2 也强调“不允许各组件新增独立滚动 writer”。但 C01–C15 没有一条专门验证“折叠协调 + 懒加载行挂载 + 流式跟底在同一个 rAF 周期内排队”时只有一个 writer 生效、其余被合并/丢弃。R13 只覆盖“初始 settle 循环”。建议：把 R13 扩展为多来源同帧请求写入的仲裁场景，断言最终只有一次程序写入且事件顺序合法。

> [!CAUTION] F05：主线程阻塞后的“结束条件时钟源”未规定
> 阻塞 100–600ms 后，`setTimeout`/`performance.now()` 的墙钟已跳跃；方案只写“不按过期墙钟时间直接跳终态”，却没指定以哪个时钟判定动画完成。现状实现正是 `Date.now() < deadline` 型墙钟判据，阻塞后仍会误判“动画已结束”而跳终态，与 F05 目标直接冲突。建议：改用 `requestAnimationFrame` 的 timestamp（主线程阻塞期间不前进）或 Web Animations 的 currentTime 判定完成，并把“阻塞期间计时不前进”写进 F05 的断言。

> [!TIP] 第 2 节：建议补一张“Provider 事件形态差异表”
> 多 Provider 下 reasoning 到达方式不同：逐 delta / final 一次性、有无 stream_end、tool_use 与 result 是否同帧合并、abort 是否发 complete。方案在 L06/T07/A06 里已隐含这些差异，但分散在场景行里，不利于回答 Q2（P0/P1 分级是否有被低估的 Provider 特例）。建议在 2.1 之后加一张一页内可扫读的差异表，标注哪些 Provider 必须单独跑 L06/T07/A06，同时直接支撑 Q9（内容不完全相等的 Provider 路径）。

> [!TIP] 12.3/15：阈值定标后缺少“回写并重跑”闭环
> 12.3 说阈值最终由真机基线校准，但 15 节发布门槛只要求“所有 P0 通过”“自动化检查整个交接时间线”，没有一条要求“校准后的阈值已入档并据此全量重跑回归”。若真机把 24px/8px 校准成其他值，门槛应同步更新并重新验证。建议在 15 节追加：真机校准结果记录为回归基线，任何阈值变更触发该维度全量重跑。

> [!NOTE] O09：导出发生在流式进行中的行为未定义
> O09 说导出模式“全部内容展开且无运行 timer/自动折叠”，但导出若恰逢流式仍在增长，快照与实时 transcript 的一致性未定义。建议补充：导出是否冻结当前已 settled 状态，还是允许导出时流式继续。

> [!NOTE] Q3 评价：C01–C15 整体覆盖度很高，可补一条“字体加载晚到 × 缩高”组合
> F08/F09（图片、字体晚到）目前是单测/人工级，且未与“大幅缩高”组合。字体晚到触发的全页重排若恰逢思考收起，会出现二次高度变化，是最接近本轮故障的机制之一。建议在 C 组补：思考收起 + 字体晚到重排 + 贴底。

### WorkBuddy · 审阅（2026-09-13）

> [!CAUTION] §12.3 / §13 / §15：验收口径所依赖的浏览器测试基础设施在本仓库并不存在
> 方案把发布门槛写成“Chromium + WebKit + 至少一台 iOS 真机、每帧采集几何、可控制 30/60Hz 与 100–600ms 主线程阻塞”，但当前仓库只有 jsdom + vitest（`package.json:52` `test:client` = `vitest run`；`vitest.config.ts` 为 `environment: 'jsdom'`），没有 `playwright.config.*`、没有 `e2e/`，`playwright` 甚至不是依赖。§14 的“阶段 0 先跑 C01/C02/C03/C04/C06/C09/C11”因此没有可执行载体。建议：把“浏览器 runner + §13 fixture 驱动器”显式立为**阶段 -1 的独立交付物**，并给出它自己的完成条件（能注入事件时序、能逐帧采样、能产出可回放录像）；否则 §15 的 8 条门槛无法被判定，只能退回人工真机，等于方案的核心承诺落空。

> [!CAUTION] C03 / G01 / Q8：“单工具 → 工具组”在当前实现中**必然** remount，不是“可能”
> `ChatMessagesPane.tsx:345` 单条消息用 `key={getMessageKey(item)}`，而 `:309` 工具组用 `key={\`tool-group-${getMessageKey(item.messages[0])}\`}`——key 的形状在成组瞬间改变，React 会卸载旧子树并挂载新子树。连带后果是 `LazyMessageRow` 的 `measuredHeight`（`LazyMessageRow.tsx:47,54`）与 IntersectionObserver 订阅（`:62-66`）一起丢失，占位退回 `ESTIMATED_ROW_HEIGHT_PX = 100`（`:25`），这正是 C03 想排除的“第一条工具消失重现”。因此 Q8 的答案应是：**把容器改为 key 形状不变**（键取首条消息的稳定身份即可），而不是交给通用布局协调器补偿——若 key 会变，再强的补偿也无法消除 DOM 身份断裂。另需注意 `getMessageKey` 是**按本次渲染顺序**推导的（`ChatMessagesPane.tsx:186-203` 用 occurrence 下标消歧），所以它在 prepend（L08/R11）、成组（G01）、`showThinking` 切换（O10）时都不是持久身份；方案应把“key 形状/挂载次数不变”列为代码级不变量并直接断言 remount 次数，而不是只放在视觉场景里。

> [!CAUTION] F05 / P11 / F01：结束条件是墙钟，且窗口是**固定 350ms**，与实际动画时长和收缩距离解耦
> `ChatInterface.tsx:52` `REASONING_COLLAPSE_FOLLOW_MS = 350`；`:194` 以 `followTranscriptLayout(REASONING_COLLAPSE_FOLLOW_MS)` 把跟底窗口钉死为 350ms；`useChatSessionState.ts:442-445` 记 `Date.now() + durationMs`，`:463` 用 `Date.now() < followUntilRef.current` 决定是否续帧。而 CSS 侧 `--reasoning-collapse-duration` 是 220ms（桌面）/280ms（coarse pointer，`index.css:600,606`），**与收缩距离无关**：5000px 与 100px 的思考同样只花 220ms 动画，但 5000px 的 reflow/paint 在低端 WKWebView 上很容易超过 350ms → 跟底窗口先于布局稳定关闭 → 正是 F01 分档要找的失败。F05 只写了“不按过期墙钟时间直接跳终态”，但没规定替代时钟；P11 的后台节流同样会让 `Date.now()` 跳跃。建议：① 完成条件改用 `requestAnimationFrame` 时间戳或 `transitionend`/WAAPI `currentTime`（主线程阻塞期间不前进）；② 把固定窗口改为**收敛判据**（连续两帧 `scrollHeight` 与 `scrollTop` 不再变化即结束），并把“阻塞期间计时不前进”“窗口不早于布局稳定关闭”写进 F05 断言。此条与 Claude 的 F05 CAUTION 同向，补充的是这个 350ms 常量与“距离无关”这一具体反例。

> [!WARNING] R08 / R09：当前**没有任何程序化滚动来源标记**，`handleScroll` 无条件把“非贴底”判为用户上滑
> `useChatSessionState.ts:547-553`：每个 scroll 事件都执行 `setIsUserScrolledUp(!isNearBottom())`，而贴底判据是 `scrollHeight - scrollTop - clientHeight < 50`（`:480-485`），且 `handleScroll` 是**唯一**的用户意图来源（`:1051-1056` 只挂了一个 listener），没有任何 wheel/touch/程序来源区分。于是收缩过程中底部间隙只要有一帧超过 50px，程序自己的写入或收缩本身触发的 scroll 事件就会把 `isUserScrolledUp` 置真，进而让跟底永久退出（`:438`、`:1029`）——这正是本轮“大块空白”的直接机制。R09 的预期（不把布局变化误判成用户上滑）因此当前是**被违反**而非“未被测试”。建议：加显式 program-scroll guard（写入前后置标志、忽略由此产生的 scroll 事件，仅把 wheel/touch/keyboard 当作离开意图），并把 R08/R09 提为 P0 阻断项，断言“无假用户离底”计数为 0；同时说明 `transcriptScrollOwnership.test.tsx` 因伪造几何（该文件注释自陈 jsdom 无 layout）不能作为此条证据。

> [!WARNING] R12 / R13 / C13：搜索跳转的“独占”标志在 smooth 滚动**开始时**就被释放，而非完成时
> `useChatSessionState.ts:953-958`：`targetElement.scrollIntoView({ behavior: 'smooth' })` 之后立即 `searchScrollActiveRef.current = false`。而 smooth 滚动是持续数百毫秒、逐帧产生 scroll 事件的异步过程，这些事件会全部落到 `handleScroll` 并按当前位置判定 `isUserScrolledUp`，同时跟底 writer 已不再被 `searchScrollActiveRef` 拦截（`:437`、`:1029`）——于是搜索平滑滚动与 follow writer 可能同帧竞争，C13 的“尾部 writer 不介入”缺少保障。建议：把 `searchScrollActiveRef` 的释出改到滚动停止之后（监听滚动静默一帧或 `scrollend`），并在 C13 断言“搜索跳转全程程序写入来源唯一”。

> [!WARNING] T10 / C08 / L02：懒加载占位高度会**冻结动画中间值**，且当前依赖原生 scroll anchoring
> `LazyMessageRow.tsx:50-57` 在 IntersectionObserver 退场回调里读 `offsetHeight` 并落盘，`useLazyRowObserver.ts:47` 的回调相对 layout 是异步的，紧接着 `:74,:76` 就卸载内容。若行离开 1200px 带（`useLazyRowObserver.ts:5`）时恰逢收起动画或 markdown/图片异步增高中，冻结的就是中间高度，并一直保留到该行再次进出。另外从未测量过的行用 100px，注释明说“rely on browser scroll anchoring”（`LazyMessageRow.tsx:20-21`）——这与 P02“不依赖 Chromium 滚动锚定特性”直接冲突，方案全文也未提及 `.chat-messages-pane { contain: layout style paint }`（`index.css:611-613`）对锚定/包含策略的影响。建议：① 明确 `overflow-anchor` 策略并说明与现有原生锚定依赖的取舍；② 把 T10 的“占位高度取稳定终值”从期望改为**规则**（`transitionend` 后或连续两帧高度稳定再测量），并断言测量值等于终值；③ 补一条“行在动画中途离开视口带”的显式场景。

> [!WARNING] L09 / Q9：L09 的预期与实现行为**相反**
> `reasoningDisclosureRegistry.ts:33-43` 的 `findStreamedReplacement` 要求 `entry.content === content` 且唯一匹配。内容差一个字符时不命中，于是走 `:74-81` 新建 entry，而落库行 `isStreaming` 为 false → `autoCollapsed: !row.isStreaming` = `true` → **立即收起**；同时该行 key 已变（见上条 key 形状问题）→ remount。这与 L09 期望的“不误匹配旧 disclosure，也不瞬间关闭”正好相反，且是全链路上最脆的一环：任何 Provider/客户端侧的规范化（尾换行、空白 trim、markdown 重写）都会命中这条路径。Q9 的答案因此是 **“存在”**，且更严重——它不只是“内容不完全相等”，而是“不相等即瞬时收敛高 + 重挂载”。建议：身份迁移改用 id/sequence 等非内容判据（或内容判据 + 唯一性 + 时间窗），并把“精确匹配未命中时不得立即收起”写成断言。

> [!WARNING] P09 / P10 / C09：键盘路径在 Capacitor 与浏览器走**不同机制**，单一 C09 无法覆盖两端
> `useVisualViewportKeyboardOffset.ts:27-45` 在 Capacitor 下用 `@capacitor/keyboard` 的 `keyboardWillShow/Hide`，浏览器下只用 `visualViewport.resize`（`:47-63`）；配合 `capacitor.config.ts:22-27` 的 `resize: 'none'` 与 `index.html:6` 的 `interactive-widget=resizes-content`，iOS 上键盘主要改**视觉视口**而未必改布局视口，Android/浏览器则可能改布局视口。P09/P10/C09 假设“键盘高度与消息高度变化统一处理”，但两端根本不是同一代码路径，同一个场景在两端断言的对象不同。建议：按平台拆分 C09（visualViewport 路径 / keyboard 事件路径各一条），并在每条里断言“是哪种机制触发了几何变化”。

> [!NOTE] §12.3 / 现有测试：`data-message-timestamp` 已是最合适的锚点抓手，但 jsdom 下懒加载被整体旁路
> `LazyMessageRow.tsx:73` 已给每个行元素输出 `data-message-timestamp`（卸载时仍在 DOM），正是 §12.3 采样 `successorTop` 所需的稳定锚点，可直接复用而不必新增 `data-scroll-source` 之外的埋点。反过来要警惕：`useLazyRowObserver.ts:26` 在 `IntersectionObserver` 不存在时返回 `null`，使 jsdom 下**所有行永久挂载**，因此现有 vitest 的 DOM/组件测试天然覆盖不到 C08/T10 这一整类“卸载换占位”缺陷。建议在 §12.2 明确写出这一点，避免把既有组件测试误当成本类覆盖。

### 牵头结论（2026-09-13）

- **部分采纳 Claude R02/R03**：新增 R16，明确 detached 所有权不得因 45–55px 几何抖动恢复 following；暂不把 50/80px 双阈值写成既定实现，因为滞回不能替代真实用户输入与程序滚动的来源判定，阈值需由阶段 -1/0 基线决定。
- **采纳 Claude 的指标口径修正**：`bottomGap` 改为相对交接前 3 个稳定帧基线的正向尖峰；阅读锚点改为相对基线的最大绝对漂移，并额外记录相邻帧与最终漂移。
- **采纳 Claude 的几何维度、Composer、桌面重排建议**：拆分 `scrollHeight` 与 `clientHeight`，新增 C16 和 P14。
- **部分采纳 Claude 的诊断埋点建议**：先用现有 `data-message-timestamp`、MutationObserver、滚动 setter 拦截和 observer 包装做测试外部采集；不预先向生产 bundle 增加常驻 `data-*`，只有真机远程诊断证明不足时再单独评审。
- **采纳 Claude 的同帧仲裁、Provider 矩阵、阈值闭环、导出语义和字体组合建议**：新增/修订 R13、C17、§2.3、发布门槛第 9 条、O09 和 C18。
- **部分采纳两位审阅者的 F05 意见**：确认固定 350ms + `Date.now()` 是现存高风险；不采纳“改用 rAF timestamp 或 WAAPI currentTime 即可保证阻塞期间不前进”的具体判断，因为这些时间轴在阻塞后也会跳到当前进度。修订为：恢复后的同帧几何校正 + 动画/滚动结束 + 连续两次布局观测稳定共同证明收敛。
- **采纳 WorkBuddy 的阶段 -1 阻断意见**：真实浏览器 runner 和 fixture 驱动器成为独立前置交付物，并要求用正向/负向 fixture 证明能识别闪现；没有它不能宣称完成发布门槛。
- **采纳 WorkBuddy 的工具组身份结论**：当前“单工具 → 工具组”是必然 remount，不能依赖通用补偿；身份不变量已升级为外层 React key/DOM 节点不变，新增 G13 并在阶段 1 明确先修稳定容器身份。
- **采纳 WorkBuddy 的程序滚动来源与搜索所有权结论**：R08/R09 明确要求 program-scroll claim 和零“假用户离底”；R12 要求 smooth search 从开始到 `scrollend` 或静默稳定前保持独占。
- **采纳 WorkBuddy 的懒加载与原生锚定结论**：T10 升为 P0 并规定只保存稳定终态高度；§12.2 明确 jsdom 会旁路 IntersectionObserver；§12.3 明确原生 scroll anchoring 只能作为优化，不能成为正确性前提。
- **采纳 WorkBuddy 的 L09 结论**：当前精确内容不等会新建 settled/collapsed 状态并伴随 remount，和原预期相反；L09 已改为稳定身份或受约束时间窗迁移，且精确匹配失败不得立即收起。
- **采纳 WorkBuddy 的键盘路径拆分**：C19 分别覆盖浏览器 `visualViewport.resize` 与 Capacitor `keyboardWillHide`，不得以单一 C09 代替两条实现路径。
- **修订说明**：新增 Provider 路由矩阵、3 个单场景（G13、R16、P14）和 4 个组合场景（C16–C19），并强化 T10、L09、R08/R09、R12/R13、F05、O09；组合发布门槛从 C01–C15 扩为 C01–C19；保留两位审阅者原始批注不改写。

### WorkBuddy · 复审（2026-09-13）

首轮 9 条已被逐条处置，其中数处修订是正确的方向，先予确认：§1.3.4 把身份不变量提升到「外层 key/DOM 节点不变 + 挂载计数为一次」、§14 新增阶段 -1 并要求**正/负 fixture 各一**证明 runner 真能识别闪现、§12.3 把原生 scroll anchoring 降级为平台优化并纳入样式矩阵与锚定不可用路径、§12.2 显式声明 jsdom 旁路 IntersectionObserver、§12.3 把基线定义为交接前 3 个稳定帧并同时记录相邻帧与最终漂移，都是比原文更可判定的写法。**关于 F05，牵头不采纳「改用 rAF timestamp 或 WAAPI currentTime 即可保证阻塞期间不前进」是技术上正确的**：document timeline 与 rAF 时间戳都以 wall clock 为基准，主线程阻塞后同样会跳到当前进度，因此「连续两次布局观测稳定」才是可靠的主判据。以下为复审新增意见。

> [!CAUTION] L09：修订后的验收要求在本方案自身的非目标下**不可实现**
> 新 L09 要求「必须通过稳定身份或受约束的时间窗迁移」。但经核对源码，assistant 的 `text`/`thinking` 在实时记录与持久记录之间**不存在**可共享的身份字段：实时 id 由客户端/服务端随机生成（`server/shared/utils.ts:337-339` `generateMessageId` → `${kind}_${randomUUID()}`），持久 id 来自 Provider 命名空间（如 `claude-sessions.provider.ts:958-979` `${baseId}_text`、`codex-sessions.provider.ts:2120` `raw.uuid`），并且代码里已有明确注释承认「sessions API 会以不同 id 返回同一条回复」（`useSessionStore.ts:293-295`）。客户端侧的关联字段 `replacesAnchorId` 被标注为「Local to this client / Never sent by the backend」（`src/shared/types.ts:441-462`），不会随持久化回传。因此现存的唯一迁移手段就是**内容相等 + 同一 user-turn 窗口**（`useSessionStore.ts:235-258`、`:279-290`、`:373-389`），而 §1.2 又明确「不修改 Provider 协议」。建议二选一：① 把 L09 的验收从**机制**（稳定身份）改写为**可观察行为**——「精确内容匹配失败时不得立即折叠、不得 remount」，机制留给修复阶段选择；② 若确实要 id 级迁移，则必须承认这需要「持久化回传实时 `normalized.id`」这一规范化改动，并相应修订 §1.2 与 §13 的「不扩展 Provider 协议」。另注：`tool_use` 目前是唯一共享稳定键（`toolId`，`useSessionStore.ts:395-399`），身份类断言对工具与对 text/thinking 的可行性并不相同，建议分开表述。

> [!CAUTION] G01 / G02 / C03 / G13：工具成组的真实根因不是「换壳补偿不足」，而是**成组时第一条工具的内容被整体卸载**
> `ToolGroupContainer.tsx:116` `useState(Boolean(groupIssueStatus))` 使普通成功组的 `isExpanded` 默认为 `false`，`:122` `showChildren = isExpanded || isExporting`，`:161` 用 `showChildren &&` 门控 children。也就是说第二条工具到达、分组形成的瞬间：① 第一条工具的内容从顶层 `ChatMessagesPane.tsx:345` 的 `MessageComponent` 迁入 `ToolGroupContainer.tsx:163-177` 的 children；② 该 children 因默认折叠而**根本不渲染**；③ 于是「已展开的 Bash 多屏输出」不是被动画隐藏，而是被真实卸载——这是一次确定性的、无动画的多屏 `scrollHeight` 收缩，任何滚动补偿都无法抵消（内容确实不在 DOM 里）。这恰好是 G02「不得突然吞掉多屏高度」与 C03「第一条工具不消失重现」的机制本身。由此两点：**§1.3.4 与 G13 的「最外层 key 不变」是必要条件但不充分**——外层 wrapper 类型虽然同为 `LazyMessageRow`、稳定 key 即可保住 wrapper，但第一条工具自身的 `MessageComponent` 已经换了父路径、必然 remount，其内部展开态与已测量高度一并丢失。建议：① 断言对象下沉到「第一条工具内容的 DOM 节点」而非仅外层 row，直接计数其 mount 次数与存续性；② 明确回答「成组是否允许隐藏一条当前可见/已展开的工具」这一产品问题，并据此改写 G02/C03 的通过条件；③ G13 增补「成组」为该场景的第一类触发源（目前只写了 prepend / `showThinking`）。

> [!WARNING] §14 阶段 -1 / §15 门槛 1：把浏览器视觉时序测试设为发布阻断，却没有确定性策略
> 门槛第 1 条只要求「runner、fixture、几何时间线和失败录像均可重复执行」，但逐帧几何 + 时序断言是典型的易抖测试：未固定浏览器/WebKit 版本、未给抖动预算与重试口径、未规定运行环境（CI 还是本机），实践中会在数周内被人以「又是 flaky」为由跳过，反而使门槛失效。建议在阶段 -1 的完成条件里补三条：① 固定 runner 的 Chromium/WebKit 版本并写入失败产物；② 给出可接受的抖动口径（例如同场景重复 N 次、几何阈值取 P95），以及阈值内波动不算失败的判定规则；③ 明确稳定基线 fixture 与负向 fixture 必须长期保留——负向 fixture 是防止「runner 悄悄失去识别能力」的唯一守卫。

> [!WARNING] F05：修订后的判据正确，但缺少「跳跃检测」这一步，目前不可实施
> 新表述「墙钟、rAF timestamp 或 WAAPI 时间跳跃都不能单独结束协调」是结论，但没有给出实现路径：若不检测跳跃，就无法在执行层阻止「按时间结束」。建议把「连续两次布局观测稳定」定为**唯一主判据**（时间类信号一律降级为辅助/超时兜底），并明确规定稳定判据的比较对象（同一锚点 `getBoundingClientRect().top` 与 `scrollHeight` 连续两帧相等）；同时要求 fixture 的 `block-main-thread`（§13）必须是忙等实现并**回读实际阻塞时长**，否则 600ms 场景可能只阻塞了 0ms 而测试静默通过。

> [!WARNING] R03 改写后：50/51px 的**所有权获取边界**不再被任何场景覆盖
> 原 R03 的意义是测「差值恰好跨过阈值时所有权如何判定」；修订后 R03 的前置条件变成「用户已通过真实手势取得 detached」，于是它测的其实是「detached 不因几何变化被夺回」——这正是 R16 的内容。与此同时 R02 的前置条件是「仍处于 following」，覆盖 1/24/49px。结果：**「无任何手势、差值 50/51px」这一情形没有任何场景**，而它恰恰是 Claude 首轮 R02/R03 想钉住的歧义点。牵头把阈值推迟到阶段 -1/0 基线的理由成立，但即便如此，仍应有一条与阈值取值无关的断言：所有权**不得由单帧布局差值获取**（必须来自真实输入意图）。这与本方案自己的 R09 原理一致，建议补为 R03 的第二行或新增 R17，并与 R16 一起构成「滞回不替代来源判定」的双向验证。

> [!NOTE] R13 / C17：把「中央仲裁器」写进验收条件，与 §0「不预先指定机制」冲突
> R13「中央仲裁器只提交一次合法写入」与 C17「中央仲裁器只产生一次合法程序写入」把一种具体架构固化为通过条件，而 §0 明确「本文不是实施方案，不预先指定一定使用 `ResizeObserver`、锚点差量补偿……」、§12.3 也刚把原生锚定降为可选优化。建议改为**可观察性质**：「同一 rAF 周期内至多一次程序化 `scrollTop` 写入，且每次写入携带可审计的来源」，这样无论最终用单一仲裁器、写入守卫还是其他机制都能验收，也避免验收条件反向锁定实现。

> [!NOTE] §2.3 矩阵与代码核对：7 行与真实 Provider 集合一一对应，未虚构造；仅标签需修正
> 已核对 `src/shared/types.ts:8` 与 `server/modules/providers/provider.registry.ts:12-20`，真实 Provider id 恰为 `claude | cursor | codex | opencode | dsh | workbuddy | pi` 七个，矩阵行数与映射均正确；下游指向也有实证：Cursor 行标 L06 是对的（Cursor 不发 `stream_end`，代码注释直言「its only teardown path」，`useChatRealtimeHandlers.ts:233-237`），Codex 行标 L09/L11 也对（实时用 `item.id`、持久用 `raw.uuid`/`itemId`，`codex-sessions.provider.ts:2120,2253-2258`），DSH 行与压缩 transcript + 实时 ACP 双路径一致（`dsh-sessions.provider.ts:21-26`）。唯一需修正的是标签：`codebuddy` **不是** Provider id，CodeBuddy 是 `workbuddy` 背后内嵌的 CLI 引擎（`server/modules/providers/list/workbuddy/workbuddy-auth.provider.ts:7-8,107,127`），写成「WorkBuddy/CodeBuddy」容易被后续读者误读为 8 个 Provider，建议标注为 `workbuddy`（引擎 CodeBuddy）。

### Claude · 复审（2026-09-13）

牵头对我首轮 11 条批注逐条处置，其中 F05 的技术更正成立：rAF timestamp 与 document timeline 都以墙钟为基准，主线程阻塞后会同样跳到当前进度，我原先「改用 rAF timestamp 即可保证阻塞期间不前进」的具体判断有误，应以「恢复后几何校正 + 布局稳定收敛」为准。以下为复审新增意见，其中两处是对 WorkBuddy CAUTION 的独立核实背书，其余为新补充。

> [!WARNING] 所有权状态机还缺「无输入时的默认所有权」定义，50/51px 无手势情形因此悬空（R02/R03/R09/R16 交界）
> 修订后 detached 必须由真实手势取得、following 由显式意图/程序 claim 取得，但没有定义「尚无任何输入时的默认所有权」。当前实现只有 `scroll 事件 + !isNearBottom()` 一个来源（`useChatSessionState.handleScroll`，贴底判据 `<50`）；引入 program-scroll claim 后，「用户滚到恰好 50px 停住」与「布局变化把差值推到 50px」在事件流上无法靠差值区分——前者由 wheel/touch 产生 scroll（是手势），后者不是。若默认所有权随差值翻转，前者会被误判为布局变化而不置 detached，用户会被拉回底部；若不翻转，后者会被误判为 detached。建议：① 明确定义默认所有权为 AUTO，AUTO 只在收到真实输入事件或程序 claim 时迁移，单帧布局差值永不翻转所有权（写入 R09 并同步到 §1.3）；② 补一个场景钉死「初始 50/51px、无任何输入、仅内容增缩使差值跨越」的期望——无论归入 R17（与 WorkBuddy 建议同向）还是 R03 第二行，这里补充的是「默认态定义」这半边。

> [!WARNING] §12.3 的「原型级滚动写入拦截」若只覆盖 `scrollTop`/`scrollTo`，会漏掉 C13/R12 依赖的 `scrollIntoView`，搜索 smooth 滚动会被误记为用户滚动
> 搜索跳转用的是 `targetElement.scrollIntoView({ behavior: 'smooth' })`（`useChatSessionState.ts:953`），它不经过 `scrollTop` setter 也不经过 `scrollTo`。R12/C13 的全部前提是「能区分程序滚动与用户滚动」；若 runner 只拦截 `scrollTop/scrollLeft` setter 与 `scrollTo/scrollBy`，搜索这条程序来源就采集不到，`scrollIntoView` 产生的数百毫秒 scroll 事件会全部落入 `handleScroll` 被当作用户意图，C13 的「尾部 writer 不介入」无法被判定。建议：把拦截清单明写为 `scrollTop/scrollLeft` setter + `scrollTo/scrollBy/scrollIntoView`；拦截器必须是纯透传记录器（不改语义、同步返回、先于业务脚本安装），并断言「搜索跳转全程至少被标记一次程序 claim」。

> [!TIP] F05 的「连续两次布局观测稳定」需限定为 rAF 帧且带帧时间戳；CSS 驱动动画优先用 `transitionend`/`animationend`
> 若稳定采样用 setInterval 或未校验帧号的回调，主线程阻塞期间可能取到两个内容相同的快照（CSS 高度过渡在阻塞期间不推进），误判为「已稳定」而提前收尾。建议：① 稳定判定只接受两个「实际渲染过且帧时间戳不同」的 rAF 帧；② 对 CSS transition/animation 驱动的缩高，`transitionend`/`animationend` 是跨阻塞可靠的完成信号（时间线阻塞后跳到终值，事件按终态触发），应作为「动画/滚动结束」的首选证据；③ 连续两帧稳定作为 JS 驱动路径的判据，墙钟只作超时兜底——与 WorkBuddy 的「跳跃检测 / 忙等回读实际阻塞时长」要求互补。

> [!NOTE] 背书 WorkBuddy 的 L09 CAUTION（已独立核实源码）
> `generateMessageId` 用 randomUUID（`server/shared/utils.ts`），text/thinking 在实时与持久记录间没有共享身份字段；唯一迁移手段是「同一 user-turn 窗口内内容相等」（`useSessionStore.isContentEchoedInSameTurnOnServer`），`replacesAnchorId` 标注为 client-local、不回传（`types.ts`）。因此修订后 L09 的「必须通过稳定身份迁移」在 §1.2「不修改 Provider 协议」约束下不可实现。建议按 WorkBuddy 的路径二选一：L09 改写为可观察行为（「精确内容匹配失败时不得立即折叠、不得 remount」，机制留给修复阶段），或承认需要「持久化回传实时 normalized.id」并相应修订 §1.2。

> [!NOTE] 背书 WorkBuddy 的 G01/G02 CAUTION（已独立核实源码），并补充：身份断言必须下沉到内容节点
> `ToolGroupContainer` 普通组 `isExpanded` 默认 false、`showChildren` 门控 children，成组瞬间第一条工具内容被真实卸载（非动画缩高），`scrollHeight` 发生确定性多屏收缩，任何滚动补偿无法抵消。§1.3.4/G13 的「外层 key 不变」是必要不充分——保住 wrapper 不改变第一条工具 `MessageComponent` 换父路径导致的必然 remount 与内部展开态丢失。建议：断言对象下沉到「第一条工具内容 DOM 节点的挂载计数与存续性」，并先明确回答「成组时是否允许隐藏一条当前可见/已展开的工具」这一产品问题，再定 G02/C03 的通过条件。

> [!NOTE] 支持 WorkBuddy 对 R13/C17 的改写建议
> 「中央仲裁器」把一种具体架构固化进验收条件，与 §0「不预先指定机制」、§14 阶段 1「依据基线选择机制」冲突。改为可观察性质「同一 rAF 周期至多一次程序化 `scrollTop` 写入，且每次写入携带可审计来源」更合适，仲裁器、写入守卫或其它实现都能据此验收。

### 第二轮牵头结论（2026-09-13）

- **采纳两位审阅者对 L09 的共同结论**：在“不修改 Provider 协议”的边界下，不再把共享稳定 id 或特定迁移机制写成验收前提；L09 只约束精确内容匹配失败时不得立即折叠、出现重复行或使可见内容 remount。若实施阶段确需回传共享 id，必须另行扩展范围并评审。
- **采纳两位审阅者对工具成组的共同结论**：外层 row 稳定只是必要条件。产品规则确定为：成组不得自动隐藏已经可见或由用户展开的工具。G02、G13、C03 和身份不变量均已下沉到第一条工具内容节点，要求节点存续、展开态不丢且视口不跳；阶段 1 同步排除换父路径、默认折叠和外层 key 变化造成的卸载。
- **采纳 WorkBuddy 对阶段 -1 确定性的要求**：固定 Chromium/WebKit 版本，CI 每场景重复 5 次，release/nightly 重复 20 次并使用 P95，同时保留单次极值限制；正向和负向 fixture 永久运行，失败产物记录浏览器版本。
- **采纳两位审阅者对 F05 的补充**：CSS 驱动路径先等 `transitionend`/`animationend`，再采集两个不同 rAF 帧；JS/reduced-motion 路径以两个不同 rAF 帧中同一锚点与 `scrollHeight` 稳定为主判据；墙钟仅作超时失败兜底。`block-main-thread` 使用忙等并回读实际阻塞时长，至少达到目标的 95%。
- **采纳两位审阅者对所有权边界的补充**：默认所有权明确为 `AUTO_FOLLOW`；只有真实用户输入才能取得 `USER_DETACHED`，程序定位使用临时 claim，纯布局变化不得翻转所有权。新增 R17 覆盖 50/51px、无输入、仅几何跨阈值的路径。
- **采纳两位审阅者对 R13/C17 的共同结论**：删除“中央仲裁器”这一实现限定，验收只要求同一 rAF 周期至多一次程序化 `scrollTop` 写入，且来源可审计。
- **采纳 Claude 对测试拦截面的补充**：纯透传拦截器除 `scrollTop/scrollLeft`、`scrollTo/scrollBy` 外必须覆盖 `scrollIntoView`，并在业务脚本前安装；搜索跳转至少记录一次 program claim。
- **采纳 WorkBuddy 对 Provider 标签的修正**：矩阵使用真实 Provider id `workbuddy`，CodeBuddy 仅标注为其内嵌引擎。
- **收敛判断**：两位审阅者的复审意见互相印证，没有剩余方向性分歧。本文已达到进入实施阶段的条件，但必须先完成阶段 -1，不能直接以现有 jsdom 测试或人工观感宣称问题已解决。
