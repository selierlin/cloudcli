# iOS 端冷启动会话恢复 实施方案

> **状态**：已定稿，可直接执行。§1–§7 为设计与历轮审阅依据，**§8 为执行定稿（以 §8 为准）**。§6 的 9 项倾向已在 §8.1 全部裁决为决策（其中问题 5 的结论与 §6 表格所写相左，原因见 §8.1 注）。第四轮（2026-09-16）已回到当前代码逐条重核改动面：行号已全部校正，技术前提全部复核仍成立。第五、六轮（09-23）10 条批注已核验（8 采纳 / 2 不成立 / 1 定性订正），新增决策 12–16。
> **⚠️ 第九轮（2026-09-23）推翻了此前两处判断**（§8 当时随之修订；其中第 2 条已于第十轮撤销，第 1 条转为延后）：
> - **事实 18 原判「前提不成立」被推翻**——JS 侧确实规约默认端口，但 Swift `URL` **保留**显式 `:80`/`:443`（作者本机 `swift` 实测 + 第七、八轮两方独立实测一致）。此前不失配靠的是「所有写入路径都先过 JS」这一**隐式依赖**。现转为显式规约：新增**决策 18**（按 scheme 归约，`http:80`/`https:443` → nil）与**决策 19**（三处比较统一走 `normalizedPort`）；§8.5-⑬ 当时升为**承重用例**。（**第十轮改判：决策 18/19 均为延后/可选，见 §8.7**）
> - **计数落盘形态改为与目标同键**——决策 17 将 `cloudcli.restoreTarget` 升级为 `{ url, failures }`，取代独立键 `cloudcli.restoreFailures`。理由是「写新目标 = 计数归零」成为写入契约的推论，结构性消除第七、八轮查出的四处清零漏接线（手动 `connect()`、`switchServer`、`.skip`、`.forget`）与跨服务器串扰。**决策 4 同步加「主动」二字**，否则失败回退会清掉刚递增的计数、决策 15 阈值永不生效。（**第十轮已整体撤销本条的计数设计**：决策 15 只留「失败不清标记」，存储退回纯 `{ url }`，见下条）
> - 上述修订已获第九轮 Claude、Codex **两方逐条认可**（含第三轮 4 项、第四轮 5 项遗留表态的全部认可）。依据见文末「作者响应（第七～九轮）」。历轮审阅历史完整保留于文末。
> - **第十轮（2026-09-24）作者主动简化（非审阅项）**：撤销连续失败计数（决策 15 只留「失败不清标记」）；P4 原生落盘（路径 B/C、后台任务、`currentController`）降为**条件阶段**、去留由 V7 决定（决策 17）；端口规约（决策 18/19）标为**延后/可选**（YAGNI，备查见 §8.7）。**净效果：P4 大概率整块不做、失败计数不做、端口规约不做。** 详见文末「附：第十轮修订」。
> **日期**：2026-09-23（初稿 2026-09-10；`WebCachePlugin.swift` 行号基准 2026-09-16，见 §2 脚注）
> **用途**：用户在 iOS App 内打开某台服务器的某个会话后杀掉进程，重新打开时应能回到同一台服务器的同一个会话，而不是每次都从服务器选择页重新点起。§8 给出按文件、按阶段、可直接照做的执行细则与验收清单。审阅时请重点检查：①「已实测确认」的事实是否与实际行为相符，尤其是 `@capacitor/preferences` 的存储介质、SPA 路由的 URL 可见性、**以及端口规约在 JS 与 Swift 两侧的差异（事实 18 / 决策 18）**；② 还原阶段的各条写入/还原路径（乐观加载与挂载探测、失败回退、返回列表语义、路径 C 的缓存复用落盘）是否有遗漏；③ §8 的代码骨架与 §8.2 的实现约束是否有误；**④ 本轮重点：决策 15（失败不清标记）、决策 17（P4 条件化，由 V7 决定）与决策 18/19（端口规约延后）是否成立；V7 作为 P4 去留的门是否设置得当——见文末「作者响应（第七～九轮）」与「附：第十轮修订」**。批注请直接以评论或追加段落形式写入本文档。
> **参考规范**：`.agents/skills/frontend-module-standards/SKILL.md`（前端新增模块与组件须遵守）、`docs/research/CloudCLI接入Pi-Provider实施计划.md`（本文档格式样例）、`mobile/README.md`
> **不涉及**：`server/` 后端代码。本方案全部改动落在 `ios/`（原生）、`mobile/www/`（选择页）与 `src/`（前端）。

## 1. 背景与目标

**目标**：iOS App 冷启动（含被系统/用户杀进程后重新打开）时，若能确定上次是在哪台服务器的哪个会话，则直接恢复到该 URL；无法确定或恢复失败时，行为与今天一致——回到服务器选择页。

**今天的实际行为**（已实测确认）：

- 冷启动固定进入选择页：`CloudCLIContainerViewController.viewDidLoad` 无条件 `show(pickerController)`（`ios/App/App/WebCachePlugin.swift:175`）。
- `mobile/README.md:12` 明确写着「冷启动总是回到选择页」，是有意为之的现状，本方案将改变它（见 §6 问题 1）。
- 选择页其实**已经在写**「上次服务器」到原生存储：`setLastServer()` 写入 `cloudcli.lastServer`（`mobile/www/picker.js:65-68`，调用点 `:291`）。但全仓库 grep 确认**没有任何地方读它**——这个设计意图早已埋下，只差还原侧的实现。

**必须澄清的边界**：这不等于恢复 WebView 的运行现场。进程被杀后 WebView 已销毁，页面是从 URL 重新加载的。因此：

- 能恢复的是「哪台服务器 + 哪个路由」，不是内存里的 UI 状态。
- 不会恢复「正在流式输出的那一帧画面」；但重连 WebSocket 后，服务端仍在跑的任务前端依然能看到（`src/modules/project-workspace` 的会话态由服务端驱动）。

## 2. 现状盘点（已实测确认）

| # | 事实 | 证据 |
|---|---|---|
| 1 | 会话在浏览器里是真实 URL：`/session/:sessionId`；另有根路由 `/` | `src/App.tsx:124-129`（`BrowserRouter` + 两条 `Route`） |
| 2 | 深链 `/session/<id>` 前端本就支持：URL 里的 sessionId 若不在已加载的 project payload 中（分页所致，深链旧会话属正常），会用 `GET /api/providers/sessions/:sessionId` 反查宿主 project，绝不从本地状态猜 | `src/modules/project-workspace/hooks/useProjectsState.ts:877-1005`（解析 `useEffect`，含 `api.sessionDetails` 调用与 `navigate(replace)`）；类型注释见 `:57-61` |
| 3 | 服务器页面（远程 origin）可以访问原生插件：仓库里已有先例，`SidebarServerMenu` 在服务器页面里调 `@capacitor/preferences` 与 `registerPlugin('ServerSession')` | `src/modules/sidebar/SidebarServerMenu.tsx:1,63,73,102,122` |
| 4 | `@capacitor/preferences` 在 iOS 上落在 `UserDefaults.standard`，key 前缀 `CapacitorStorage.` | `node_modules/@capacitor/preferences/ios/Sources/PreferencesPlugin/Preferences.swift:10,18-20,61-63` |
| 5 | 上一条的直接推论：**原生侧可绕过 JS 直接读写同一份存储**（`UserDefaults.standard.string(forKey: "CapacitorStorage.<key>")`），无需新增插件方法 | 同上 |
| 6 | 登录态不随杀进程丢失：token 存在 localStorage（key `auth-token`），落在该服务器 origin 的 `WKWebsiteDataStore` 磁盘存储中 | `src/modules/auth/context/AuthContext.tsx:94`（`readStoredToken`）、`:101` |
| 7 | 服务器选择页与已连接页面共享同一份 Preferences（跨 origin），这是既有设计 | `mobile/www/picker.js:71-77` 注释；`SidebarServerMenu.tsx:10-12` 复用同一批 key |
| 8 | `showServer` 以 `url.absoluteString` 作缓存 key；而选择页的 `normalizeUrl` 会把用户输入裁剪成纯 origin | `ios/App/App/WebCachePlugin.swift:188`；`mobile/www/picker.js:98` |
| 9 | 「是否仍在该服务器」的判断只比对 scheme/host/port，不比对 path | `ios/App/App/WebCachePlugin.swift:147-154`（`isShowingLoadedServerOrigin`） |
| 10 | `SceneDelegate` 目前**没有任何生命周期回调**（只有 `willConnectTo` / `openURLContexts` / `continue userActivity`） | `ios/App/App/SceneDelegate.swift:4-24` |
| 11 | 构建期若设置 `CLOUDCLI_SERVER_URL`，会写入 `server.url`，此时 App 根本不加载选择页（直连模式） | `capacitor.config.ts:15,35-41`；当前仓库的 `ios/App/App/capacitor.config.json` 未设置 |
| 12 | **直连判定不能用 `appStartServerURL != nil`**：该属性是**非可选** `URL`，且未配置 `server.url` 时回落到 `localURL`（即 `capacitor://localhost`），因此「非 nil」恒真。正确判定是 `config.serverURL != config.localURL`：配置了 `server.url` 时 `_serverURL` 取远程值，否则 `_serverURL = _localURL`。`InstanceConfiguration` 没有更「官方」的布尔属性；官方自身区分「应用导航」时用的也是这两个 URL 的前缀比较，本判定是同一惯例的等价表达（两个 `URL` 的 `==` 走 `isEqual`，比内容非指针） | `node_modules/@capacitor/ios/Capacitor/Capacitor/CAPInstanceConfiguration.swift:11-16`；`CAPInstanceConfiguration.m:44-51`；`CAPInstanceConfiguration.h:14-15`（均 `nonnull`）；官方惯例见 `WebViewDelegationHandler.swift:111-112` |
| 13 | **Capacitor 自己持有 `navigationDelegate`，不应注入**：`WebViewDelegationHandler` 在 `loadView()` 内以局部 `let` 创建（不是可覆写的存储属性），随即同时交给 `prepareWebView` 与 `CapacitorBridge`，`aWebView.navigationDelegate = delegationHandler`。原代理**并非取不到**——`CapacitorBridge.webViewDelegationHandler` 是 `public private(set)`，可据此替换并转发；致命点在于必须**完整**转发每个分支（`decidePolicyFor` 的 allowNavigation / `shouldOverrideLoad` / 跨域导航拦截、`didStartProvisionalNavigation` 的 `bridge?.reset()`、auth challenge、媒体权限…），漏一处就是运行时事故。结论：不碰代理 | `node_modules/@capacitor/ios/Capacitor/Capacitor/CAPBridgeViewController.swift:44-52,321`；`CapacitorBridge.swift:105`；`WebViewDelegationHandler.swift:7,45-48` |
| 14 | **`pickerController.bridge` 在 `loadView()` 之前是 nil**：`CAPBridgeViewController.bridge` 是 `public final var bridge: CAPBridgeProtocol?`，getter 直接返回私有的 `capacitorBridge`，而后者只在 `loadView()` 里创建。`loadView()` 又被声明为 `final`，无法覆写。首访 `controller.view` 才会触发它 | `CAPBridgeViewController.swift:6-9,30-53`；`CAPBridgeProtocol.swift:6`（`config` 非可选） |
| 15 | `#root` 初始无子节点，且启动 splash 是它的**兄弟**而非子节点，不会污染挂载判据；主脚本是 `type="module"`（defer 语义），加载完成时已执行 | 源码 `index.html:80-86`；构建产物同构：`dist/index.html:78,85,90` |
| 16 | `Preferences` 的 `remove` **可用**：插件原生侧在 `pluginMethods` 里注册了 `remove`（`returnType: CAPPluginReturnPromise`）并实现为 `@objc func remove`。选择页取的是 `window.Capacitor.Plugins.Preferences`（原生 JSExport 对象，非打包路径的 `registerPlugin`），两者最终查同一张方法注册表，故 `get` / `set` / `remove` 在 picker 页同样可调——不需要退化成「写空值」来删除键 | `node_modules/@capacitor/preferences/ios/Sources/PreferencesPlugin/PreferencesPlugin.swift:8-16,62`；`mobile/www/picker.js:17-24` |
| 17 | **多 WebView 并存，且隐藏的那个仍在运行**：缓存上限为 2，切换服务器时 `show(_:)` 对非当前子控制器只做 `view.isHidden = true`，不销毁、不暂停。被隐藏的那台 WebView 的 JS 与 WebSocket 继续存活，**其 tracker 仍会因路由变化写入 `restoreTarget`**——即存在「用户在看 B，却由 A 写入目标 URL」的竞争（§8.4 P4-1 处理） | `ios/App/App/WebCachePlugin.swift:167,236-238`；`src/App.tsx` 的 tracker（§8.4 P1-2） |
| 18 | **默认端口的规约只发生在 JS 侧，Swift 侧不规约**（第九轮两方指出、已本机实测确认）：JS `URL` 的 `origin`/`href`/`port` 在默认端口下**一致地**表现为「无端口」（node 实测：`new URL('http://example.com:80')` → `origin = http://example.com`、`href = http://example.com/`、`port = ''`；`https://example.com:443` 同理；`:3001` 这类非默认端口三处都保留）。但 Foundation `URL` **保留显式默认端口**（本机 `swift` 实测：`URL(string: "http://example.com:80")!.port == 80`、`.absoluteString == "http://example.com:80"`；`https://…:443` 同理）。因此 `isKnownServerOrigin` 的 `saved.port == url.port` 目前不失配，靠的**不是**「两端都规约」，而是**恰好所有写入路径都先经 JS**（tracker 的 `location.href`、`picker.js:98` 的 `normalizeUrl` → `origin`、原生 `persistVisibleTarget` 的 `evaluateJavaScript("window.location.href")`）在 Swift 解析前剥掉了默认端口。这层隐式依赖脆弱：任一条写入路径（或未来新增的）把带显式 `:80` 的 href 交给 Swift，就会 `nil != 80` 静默失配、判「服务器已删」。故需**显式规约**（决策 18；第十轮定为延后实现，见 §8.7）：Swift 侧应在比较与组 key 前按 scheme 归约（`http:80`、`https:443` → nil） | JS 侧 node 实测；Swift 侧本机 `swift` 实测；对照 `mobile/www/picker.js:98` 的 `normalizeUrl` 与 `WebCachePlugin.swift:147-154` |
| 19 | **真机加载的不是 `mobile/www/`，而是 `ios/App/App/public/`（cap sync 产物）**：`webDir` 为 `mobile/www`，`cap sync ios` 把它拷进 `ios/App/App/public`，该目录**整个被 `ios/.gitignore` 忽略**（git 跟踪 0 个文件），App bundle 内的 `index.html` 以 `./picker.js` 引它。故只改 `mobile/www/` 不跑同步，真机改动不生效；也**不需要**提交该产物 | `capacitor.config.ts:20`；`ios/App/App/public/index.html:72`；`ios/.gitignore:4`（`App/App/public`）；`package.json` 的 `mobile:sync` = `cap sync ios` |
| 20 | **native 探测已有共享实现，勿再内联**：`isCapacitorNativeShell()` 判断 `window.Capacitor.isNativePlatform()`，已被 `NotificationsSettingsTab.tsx` 使用；而 `SidebarServerMenu.tsx:51-52` 与 P1-2 骨架各自内联了同一判定（还各自定义了 `CapacitorWindow` 类型）。另需分辨：`IS_PLATFORM` 是**构建期**的 `VITE_IS_PLATFORM === 'true'`，与运行时 native 探测不是同一物，不可混用 | `src/shared/utils.ts:266`、`:12`（`IS_PLATFORM`）；`src/modules/sidebar/SidebarServerMenu.tsx:7,51-52` |
| 21 | **tracker 的挂载点在 `ProtectedRoute` 之内**：`<ProtectedRoute>` 包着 `<Router>`，未登录 / 未完成 onboarding 时 Router 根本不渲染、tracker 不挂载；而服务器页在登录态失效时会渲染 `LoginForm`，此时 `#root` **已有**子节点 → P3-1 的挂载探测会判「还原成功」。即「挂载成功 ≠ 会话可见」，这是判据的固有盲区，落在 V4 已记录的降级里 | `src/App.tsx:123-130`；挂载判据见 §8.4 P3-1 |

> **行号基准（2026-09-16 校正）**：本表与全文对 `ios/App/App/WebCachePlugin.swift` 的行号引用已按**当前代码**更新，不是初稿时的行号。该文件在方案初稿后被 `77e29179`（新增 `HapticsPlugin`，现位于 `:77-109`）改动，导致 `:110` 之后的所有行号**整体 +35**，而 `:77` 之前不受影响（例如 `switchToServer` 仍在 `:58-74`）。其余被引用文件（`SceneDelegate.swift`、`mobile/www/picker.js`、`src/App.tsx`、`src/modules/sidebar/SidebarServerMenu.tsx`）在方案定稿后未再改动，行号仍有效。**文末各轮「审阅者」批注中的行号是各轮审阅当时的、有意保留未改**（例如 Claude 三轮批注里的 `WebCachePlugin.swift:160`），以保证历史原文不被篡改；**「作者响应」段的行号已随正文一并校正**。若后续再改动这两个原生文件，正文行号需重新校正。

## 3. 待验证项（实现前需在真机/模拟器确认）

| # | 待验证 | 为什么要验 | 验证方式 |
|---|---|---|---|
| V1 | `WKWebView.url` 是否随 SPA `history.pushState` 更新 | 决定「原生读当前路由」这条路是否可行。业界已知 `webView.url` 对同文档导航不可靠，因此方案 B 必须改用 `evaluateJavaScript("window.location.href")`；若 `webView.url` 恰好可用，方案 B 可简化 | 真机跑一段 `pushState`，打印 `webView.url` 与 `evaluateJavaScript` 结果对比 |
| V2 | `sceneDidEnterBackground` 内 `evaluateJavaScript` 的可用性与时序 | iOS 杀进程不保证走 `willTerminate`，后台时机是唯一可靠落盘点；需确认回调内取 URL 来得及。**优先级已上调**：事实 17 下路径 A 会被隐藏页的写入污染（用户在看 B，A 在后台写 A），路径 B 是退到后台那一刻把值修正回可见页的**唯一防线**（§8.4 P4-1）。若 V2 不成立，必须有 P1-2 的 `visibilityState` 守卫兜住 | 真机：切到 B 后，让 A 触发一次路由变化，再进后台杀进程，检查落盘值是否为 B |
| V3 | 硬加载 `/session/<id>` 且该会话已被删除/归档时前端的落点 | 决定是否需要额外兜底，避免恢复到空页面 | 手动改 URL 访问一个不存在的 sessionId，观察 `ProjectWorkspaceRoute` 行为 |
| V4 | 恢复路径下 token 恰好过期的表现 | 确认降级到登录页而不是白屏。**补充（事实 21）**：写成功但登录态失效时，服务器页渲染 `LoginForm`，`#root` 已有子节点，P3-1 会判「还原成功」——即「挂载成功 ≠ 会话可见」。这是判据的固有盲区，本项要确认的是**该降级可接受、且浮层消失时机不突兀**（不是修判据） | 清掉 `auth-token` 后硬加载 `/session/<id>` |
| V5 | 三个关键量在三种情形下的实测值：① 正常服务器；② 后端挂但反代/静态层仍在（返 5xx 错误页）；③ 完全不可达（DNS 失败 / TCP 超时）。要测的是 (a) `isLoading` 由 true 转 false 的耗时、(b) `#root` 出现子节点的耗时、两者之间的间隔 | 直接决定 §4.2 策略 I 里 W（宽限期）与 C（绝对上限）的取值。**不要**指望 `didFail*` 覆盖 5xx（事实 13：代理不应注入；且 5xx 在 WebKit 里属导航成功，会走 `didFinish` 而非 `didFail*`）。判据本身已由事实 15 预先确认成立，此处只测时序 | 分别起正常服务、必返 5xx 的服务、不可达地址，打点记录 |
| V6 | `evaluateJavaScript` 轮询的开销与频率上限；**须含「导航尚未结束就开始轮询」这个子场景**（P3-1 首次轮询即落在页面加载中） | 轮询间隔过密会持续占用主线程（探测本身很快，但往返需切回主线程）。加载未完成时的 `evaluateJavaScript` 往往要排队等 Web 进程空闲才返回——不会崩，但需确认 (a) 探测响应性是否被推迟到加载收敛之后、(b) 首屏渲染是否受影响。若观察到明显抖动，再考虑在 `isLoading == true` 期间拉长间隔（决策 16 暂不预置） | 以 0.5s 间隔、C 秒上限实测，**并把「加载未结束时已开始轮询」的时序一起打点**，观察是否影响首屏渲染 |
| V7 | `WKWebView` 的子视图被 `isHidden = true` 后，页面的 `document.visibilityState` 是否变为 `hidden` | 决定 P1-2 tracker 的 `visibilityState` 守卫能否挡住事实 17 的跨 WebView 写入。若为 `hidden`，守卫即有效（隐藏页不再写目标）；若仍为 `visible`，守卫无效，正确性只能依赖 P4 的两条落盘路径。**不能假设**，须实测 | 真机连两台服务器：切到 B 后，在 A 的页面周期打印 `document.visibilityState`，同时打印 tracker 的实际写入 |
| V8 | 反代把 `index.html` 当 SPA fallback 返回 **200**（静态资源正常、API 全挂）时，挂载判据的表现 | V5 覆盖的是「返 5xx 错误页」，此时 `#root` 不会产生子节点，能被回退抓住。但若静态层对任意路径都返 200 的 `index.html`，应用会**正常挂载**、探测判为「恢复成功」，用户停在应用内的报错/登录界面而非回到选择页。需确认这是可接受的降级（不算失败），还是需要额外判据 | 起一个静态层正常但 API 返错的服务器，观察是否 mount、用户最终停在哪个界面 |

## 4. 方案总览

分两阶段：**记录**（App 离开前台时落盘「服务器 + 路由」）与**还原**（冷启动时读回并加载）。

### 4.1 记录阶段

**存储契约**（新增一个键，替代 `cloudcli.lastServer` 的读取用途）：

- key：`cloudcli.restoreTarget`
- value：JSON 字符串 `{ "url": "http://192.168.1.5:3001/session/abc123?foo=1" }`

只存**一个绝对 URL**，不再拆 `origin` + `path` 两个字段。理由：① 两个字段必须一致，拆分引入不一致窗口；② `path` 的来源有陷阱——`useLocation().pathname` 会剥掉 router basename，而还原时加载走的是原生 `window.location.pathname`（含 basename），两者不等会还原到 404（`src/App.tsx:29-107` 的 `detectRouterBasename` 说明 basename 场景真实存在）；直接取 `window.location.href` 则天然包含 basename、query 与 hash，不存在该歧义。`origin` 在需要校验时用 `URL(string:)!.origin` 现算即可。

原方案里的 `savedAt` 已删除：两条写入路径产出的 `url` 在冲突时是同一个值（路径 B 也是读 `window.location.href` 而来），不存在需要 last-write-wins 仲裁的场景，没有消费方的字段不应保留。

选择单键 JSON 而不是「按 origin 分键」（`cloudcli.lastRoute.<origin>`）的理由：后者会留下无用的历史键，且无法表达「最后一次到底连的是哪台」。

**写入的两条路径**（建议同时实现，取 A 为主、B 为兜底）：

- **路径 A（推荐，前端 route tracker）**：新增一个极小模块，路由变化时把 `{ url: window.location.href }` 写入 `@capacitor/preferences`。注意**不能**用 `useLocation().pathname` 拼（见上）。
  - 仅在 `window.Capacitor?.isNativePlatform?.()` 为真时生效（与 `SidebarServerMenu.tsx:52` 同一判定），浏览器与桌面包下是 no-op。
  - 还需一道自校验：仅当 `window.location.origin` 出现在 `cloudcli.servers` 里时才写入。否则一旦前端发生整页导航到本地选择页（`capacitor://localhost`，旧版前端的降级路径，见 `picker.js:290-306`），本地 URL 会被当成恢复目标写进去。
  - **必须加一道 `document.visibilityState === 'visible'` 守卫**（事实 17）：缓存上限为 2，切走的那台 WebView 只是被 `isHidden = true`，其 JS 仍在跑；它在后台因 WebSocket 事件发生的路由变化会把 `restoreTarget` 写回**上一台**服务器，覆盖用户实际在看的这台。该守卫是否为有效手段取决于 V7（隐藏页的 `visibilityState` 是否真为 `hidden`），**不能假设**。仓库已有同款写法可参照：`AuthContext.tsx:280`、`pageTitleNotification.ts:15`。
  - 与 `cloudcli.lastServer` 的关系：其 origin 语义被本键取代，该键已删除（§8.1 决策 5）。
- **路径 B（原为「兜底」，实为多 WebView 下的正确性防线）**：在 `SceneDelegate` 新增 `sceneDidEnterBackground`，对**当前可见的服务器 WebView**调 `evaluateJavaScript("window.location.href")`，成功则覆盖写 `cloudcli.restoreTarget`。
  - 事实 17 下路径 A 存在跨 WebView 污染窗口：用户在看 B，而 A 的 tracker 可能在切换**之后**写入 A。退到后台这一刻读 `currentController` 落盘，是把值修正回可见页的最后机会——所以 V2 不是「旧前端兜底」级别的待验证项，而是正确性依赖。
  - **必须先确认可见的是服务器页而非选择页**，否则用户停在选择页时进后台，会把 `capacitor://localhost/...` 写成恢复目标。判据用现成的两个方法：该 controller `!== pickerController` 且 `isShowingLoadedServerOrigin` 为真（`WebCachePlugin.swift:147-154`）。
  - 容器目前**没有「当前可见是谁」的指针**——`show(_:)` 只通过 `child.view.isHidden` 表达可见性（`WebCachePlugin.swift:236-238`），因此需要新增一个 `private weak var currentController`（或等价字段）供本路径与还原逻辑共用。
  - 必须用 `evaluateJavaScript`，不能用 `webView.url`（见 V1）。
  - 用 `beginBackgroundTask` 包裹以争取时间（须带 `expirationHandler`，见 §8.4 P4-2）。
  - 这条路保证「即使用户运行的是尚未包含 route tracker 的旧前端，也能恢复」。
- **路径 C（前两条的补丁，专治「切到已缓存的服务器」）**：路径 A 只在**路由变化**时触发。若切到的服务器 B 的 WebView 是缓存命中且无需重载（`WebCachePlugin.swift:191-197` 的 `isShowingLoadedServerOrigin == true` 分支），B 的 React 从未重新挂载、路由没变，tracker 的 effect **不会跑**，标记会一直停在 `A/session/x`。修法是在该复用分支里主动落盘一次该 WebView 的当前 href（复用路径 B 的取 URL 逻辑，§8.4 P2-3 / P4-2）。

> **第十轮更新（决策 17）**：路径 C 与路径 B 所属的 P4 已降为**条件阶段**——若 V7 证实 P1-2 的可见性守卫足够，则不实现路径 B/C。本节保留为设计依据，以 §8.3/§8.4 P4 为准。

**清除时机**：用户进入服务器选择页（`serverSession.showPicker()`）时，清空 `cloudcli.restoreTarget`——否则用户刚主动退回列表，下次冷启动又被拽回旧会话，与直觉冲突。

### 4.2 还原阶段

在 `CloudCLIContainerViewController.viewDidLoad`（`WebCachePlugin.swift:172-176`）插入判定：

```
show(pickerController)                              // 必须先执行，见下方「执行次序」注记
if bridge?.config.serverURL != bridge?.config.localURL
    → 直连模式（构建期 server.url）：不读 restoreTarget，维持现状。
      注意此处 pickerController 加载的本就是远程服务器（appStartServerURL == serverURL），
      它不是选择页；不要调 showServerPicker()，那会白白触发一次 reloadLocalApp()
read CapacitorStorage.cloudcli.restoreTarget        // JSON { "url": ... }
if 无值 / 解析失败 / url 非 http(s)                → 走 picker
if URL(url).origin 不在 cloudcli.servers 中（服务器已删）→ 清标记，走 picker
else                                                → 恢复：showServer(url)
```

> **直连判定的坑（事实 12）**：`appStartServerURL` 是非可选 `URL` 且无 `server.url` 时回落 `localURL`，`appStartServerURL != nil` 恒为真。照此实现会让恢复逻辑**永远被跳过**，功能完全失效。必须比对 `config.serverURL` 与 `config.localURL`（两者在 `CAPInstanceConfiguration.h:14-15` 均为 `nonnull`，`==` 走内容比较）。

> **执行次序（事实 14）**：上面读的是 `pickerController.bridge`，而 `bridge` 的 getter 只返回私有的 `capacitorBridge`，后者在 `loadView()` 中才创建（且 `loadView()` 是 `final`，无法覆写）。因此**必须放在 `show(pickerController)` 之后**——`show` 里的 `controller.view!` 会触发 `loadView()`；否则读到的是 `nil`，`bridge?.config` 整个表达式短路，直连 guard 静默失效。若要前置判定，等价做法是先 `pickerController.loadViewIfNeeded()`。`bridge` 本身是可选协议类型（`public final var bridge: CAPBridgeProtocol?`），所以写法上用 `bridge?.config`，而 `config` 在协议里是非可选的。

**Key 改造（必须做，否则会重复创建 WebView）**：`showServer` 目前以 `url.absoluteString` 为 key（事实 8），传入带 path 的会话 URL 会产生与 origin 不同的 key，导致同一台服务器缓存两份 WebView，并挤掉 `maxCachedServers = 2` 的预算（`WebCachePlugin.swift:167`）。改法：**签名不变，只把内部 key 归一化为 origin**（`scheme://host:port`），加载目标仍用传入的完整 URL。

```swift
// CloudCLIContainerViewController.showServer(_ url: URL, from:)
let key = normalizedOriginKey(url)   // 原来这里是 url.absoluteString
```

这样三处调用方都无需改动：`ServerSessionPlugin.switchToServer`（`:58-74`）传 origin、选择页降级路径传 origin、还原路径传完整会话 URL，三者若指向同一台服务器会命中同一个 WebView。`isShowingLoadedServerOrigin`（事实 9）本就读 `loadedServerURL` 的 origin，天然兼容。

**恢复策略**（二选一，见 §6 问题 2）——两条都要求「一次启动只尝试一次」，不允许失败重试循环：

- **策略 I：乐观加载 + 挂载探测回退**（倾向）。立刻 `showServer(url)`，成功路径零额外启动延迟。失败判定**不用导航代理**（事实 13：代理虽可取到，但必须完整转发每个分支才安全，代价与风险都不划算），改为轮询：

  每 0.5s 轮询一次，按下列顺序判定：

  1. `evaluateJavaScript("!!document.getElementById('root')?.children.length")` 为真 → 挂载成功，撤掉轮询与浮层，结束。判据成立的前提见事实 15（`#root` 初始为空，splash 是兄弟节点不干扰）。
  2. 仍未挂载，且 `webView.isLoading == true` → **继续等待，不计数**。页面还在加载时不能判失败——这正是「合法慢加载」与「真失败」的分界，也是不把挂载超时写成朴素墙上时钟的原因。
  3. 仍未挂载，且 `webView.isLoading == false` → 开始累计；**该状态持续 ≥ W（拟 1.5s，约 3 个轮询周期）** 才回退到 picker。
  4. 绝对上限 C（拟 30s）兜底：不论 `isLoading` 状态，超时即回退。用于覆盖「连接建立但服务端永不响应、WebKit 自身超时又很长」的挂死场景。

  几个要点：

  - **W 那一步是必须的，不能省成「一看到 `isLoading == false` 就回退」**。`isLoading` 转 false 的时刻接近 `didFinish`，而 `#root` 由 React 首次 commit 写入要再晚十几~几十 ms；单次采样落在这个窗口里会把「本可恢复」误判成失败。
  - 这条规则同时覆盖了「后端挂但静态层仍在返回 5xx」——**这正是 `didFail*` 抓不到的情形**（5xx 在 WebKit 里属导航成功，会走 `didFinish`）。错误页没有 `#root` 子节点，且 `isLoading` 很快转 false，因此 W 秒后即回退。
  - 因为计时以 `isLoading == false` 为前提，真实失败（DNS 失败 / 连接被拒 / 5xx）通常在 **2s 内**就回退，比「统一靠 8~10s 墙上上限」更快；而合法慢加载不会被误杀。C 取值因此几乎不参与决策，只需足够宽容即可，不必与 `picker.js:41` 的 `CONNECT_TIMEOUT_MS = 8000` 对齐（两者语义不同：那个是网络请求超时，这个是「页面已结束加载但应用没起来」的判定窗口）。
- **策略 II：先探测再加载**。复用选择页的 `/health` 语义（`mobile/www/picker.js:342-356`）先探活，可达才加载，否则直接 picker。失败判定确定、实现简单，代价是每次冷启动都为「正常恢复」付一次网络往返；且它只判定「后端可达」，仍不能区分「可达但前端资源 5xx」，那一种仍需策略 I 的挂载探测兜底。

**恢复期间的可见退出**：无论选哪条策略，恢复期间都必须有一个用户可触达的「返回服务器列表」入口。现有入口在已连接页面的侧边栏（`SidebarServerMenu.tsx:101-115`），而恢复失败时该页面根本没加载出来。建议在恢复期间于原生层叠一个轻量浮层（复用启动 splash 也可），成功加载后移除。

## 5. 改动清单

> **本节是设计阶段清单，已被 §8 取代。** 若与 §8 冲突以 §8 为准（例如模块名已定为 `src/modules/mobile-session-restore/`、`cloudcli.lastServer` 已决定删除）。本节保留用于对照与历史。

### 修改

| 文件 | 改动 |
|---|---|
| `ios/App/App/WebCachePlugin.swift` | ① `showServer` 内部 key 归一化为 origin（`:187-207`），签名不变（端口规约**延后**，见 §8.7）；② `viewDidLoad`（`:172-176`）插入还原判定（含 `serverURL != localURL` 直连 guard）——**位置必须在 `show(pickerController)` 之后**，否则 `bridge` 尚为 nil（事实 14）；③ 恢复期挂载探测轮询（挂载判据 + `isLoading` 门控 + W 宽限 + C 上限）+ 失败回退 + 浮层（策略 I）；④（**条件阶段 P4**）`currentController` 指针 + 缓存复用分支主动落盘一次当前 href（路径 C，治「切到已缓存服务器时 tracker 不触发」），仅 V7 破时实施 |
| `ios/App/App/SceneDelegate.swift` | **（条件阶段 P4，仅 V7 破时实施）** 新增 `sceneDidEnterBackground` → 确认可见的是服务器页后，`evaluateJavaScript("window.location.href")` 落盘 `cloudcli.restoreTarget`（路径 B）；用 `beginBackgroundTask` 包裹，**须带 `expirationHandler`**（§8.4 P4-2：无 handler 时任务超时会被系统直接终止 App） |
| `mobile/www/picker.js` | ① `connect()`（`:290-306`）时写入 `cloudcli.restoreTarget`，值为该服务器的**绝对 URL**（与 route tracker 同一契约，避免两条写入路径字段不一致）；② 删除服务器（`:252-266`）时若删的是当前标记的 origin，一并清 `cloudcli.restoreTarget`。`Preferences.remove` 可用性已核实（事实 16），无需降级为写空值 |
| `src/App.tsx` | 在 `<Router>` 内挂载 route tracker（`useLocation()` 必须在 Router 内） |
| `src/shared/constants.ts` | 新增 `CLOUDCLI_SERVERS_KEY`。理由：tracker 与 `SidebarServerMenu` 两个文件都要用它，按 `frontend-module-standards`「两个以上文件使用的常量放 `src/shared/constants.ts`」提取。`cloudcli.restoreTarget` 只有 tracker 使用，留在模块内 |
| `src/modules/sidebar/SidebarServerMenu.tsx` | 删除本地 `const SERVERS_KEY`（`:11`），改为从 `@/shared/constants` 导入；可选顺手把 `:51-52` 的内联 native 探测换成 `isCapacitorNativeShell()`（事实 20） |
| `mobile/README.md:12` | 「冷启动总是回到选择页」需改写为新的行为描述 |
| `docs/architecture/` | **已确认无需改动**：该目录现有 6 篇（`01-websocket-transport`、`02-realtime-stream`、`03-conversation-handoff`、`04-message-store-and-lazy-loading`、`05-scrolling`、`06-tool-view`）全部是后端/前端架构主题，**不存在移动端章节**。原文写的「实现时确认」至此关闭 |

> **改完必须同步（事实 19 / 决策 13）**：`mobile/www/` 是 `webDir` 源，真机加载的是 `cap sync ios` 生成的 `ios/App/App/public/`（该目录被 `ios/.gitignore` 忽略、无需提交）。因此改过 `picker.js` 后要 `npm run mobile:sync`（= `cap sync ios`）才会在真机生效，见 §8.5-⑫。

### 新建

| 文件 | 职责 |
|---|---|
| `src/modules/mobile-session-restore/RestoreTargetTracker.tsx` | 订阅路由变化，native、`document.visibilityState === 'visible'`、且当前 origin 在 `cloudcli.servers` 中时写 `cloudcli.restoreTarget`（`window.location.href`，非 router pathname） |
| `src/modules/mobile-session-restore/index.ts` | barrel；只暴露 tracker 组件 |
| `src/modules/mobile-session-restore/tests/RestoreTargetTracker.test.tsx` | 见下「测试」段的 mock 策略 |

**前端模块落点**：路由是 App 层职责，不属于 `project-workspace`；`sidebar` 也不合适。定为独立小模块 `src/modules/mobile-session-restore/`，遵守 `frontend-module-standards` 的 `@/...` 别名、barrel 与 `import type` 规则。

### 测试

- **原生侧今天没有测试承载**（已确认：`ios/App/App.xcodeproj/project.pbxproj:85-106` 只有唯一的 `App` target，`productType = com.apple.product-type.application`，不存在 XCTest target）。因此把可测逻辑抽成**无副作用的纯函数**，并靠 §7 的真机清单覆盖行为。是否新建 test target 见 §6 问题 8。
  - 签名必须做到**零 Capacitor / UIKit / WKWebView 依赖**，否则抽出来也测不动。即不要让纯函数接收 `InstanceConfiguration`，而是让调用方先映射成一个普通的值类型入参，例如 `decideRestore(_ input: RestoreInputs) -> RestoreAction`，其中 `RestoreInputs` 只含 `Bool`（是否直连）与 `String?`（`restoreTarget` 原始值、服务器 origin 列表）。要抽的两个函数是 **key 归一化** 与 **还原判定**。
  - 挂载探测的时序（W / C）属行为，靠真机清单，不进纯函数。
- 前端：tracker 在非 native 下不写存储；`visibilityState !== 'visible'` 时跳过；origin 不在 `cloudcli.servers` 时跳过；写入的是 `window.location.href` 原值（含 basename/query）；`/` 与 `/session/:id` 两种形态。
  - **mock 策略（仓库内无先例，需新起一个模式）**：现有测试只 mock `@/shared/api`，没有 mock 过 `@capacitor/preferences`。要点两条：① `vi.mock('@capacitor/preferences')` 提供 `get` / `set`；② `window.Capacitor.isNativePlatform` 默认不存在（jsdom 里没有），必须手动 stub 为 `() => true` 才会进入写入分支，「非 native 不写」这条用例则保持不 stub。另需把 `document.visibilityState` 覆写为 `'visible'`（jsdom 默认 `'visible'`，但上一条用例可能改过它，注意还原）。

## 6. 开放问题（需决策）

| # | 问题 | 我的倾向 | 理由 |
|---|---|---|---|
| 1 | 恢复是否作为**默认行为**？今天 `mobile/README.md:12` 明确承诺「冷启动总是回到选择页」，本方案会推翻它 | **默认开启**，且不提供开关 | 用户诉求就是「打开还在那个会话」；多一步设置项让绝大多数用户享受不到这个能力。选择页的入口并未消失（侧边栏 + 恢复失败回退），可用性不降级 |
| 2 | 恢复策略选 **I（乐观加载 + 挂载探测）** 还是 **II（先探测）**？ | **策略 I** | 成功路径零额外延迟；策略 II 让每次冷启动都多一次网络往返，而这恰恰是常态路径。策略 I 的失败判据是启发式，但 §4.2 的「计时以 `isLoading == false` 为前提 + W 秒宽限」已经把误判面收窄到「页面已结束加载却仍不挂载」这一种，真实失败约 2s 即回退 |
| 3 | 恢复失败时的回退：**静默回选择页** 还是 **给一次提示**？ | **回选择页 + 一条非阻塞提示** | 静默回退会让用户困惑「我刚才明明在那个会话」。但提示不能是阻断式弹窗，否则每次离线启动都被打断 |
| 4 | 「返回服务器列表」是否清除恢复标记？ | **清除** | 用户主动退回列表是一个明确信号，语义上等于「我不需要自动回到刚才那里」。见 §4.1 清除时机 |
| 5 | 已有的 `cloudcli.lastServer` 键如何处置？ | **保留写入、不删键**；读取统一走 `cloudcli.restoreTarget` | `lastServer` 目前无读取方（事实见 §1），删键属于顺带清理，收益低而引入迁移负担；但保留一个无人读的键也不理想。倾向在实现时一并删除写入与键，若审阅者认为风险不可接受则保留 |
| 6 | 是否需要记忆**每台服务器各自的路由**（而非只记最后一台）？ | **只记最后一次** | 用户诉求是「打开这次杀掉的那个会话」。按台记忆会带来多份状态与过期问题，收益场景（在两台服务器间反复切换且都要续接）罕见 |
| 7 | 是否需要额外生命周期回调把当前路由更频繁地落盘（如 `sceneWillResignActive`）？ | **不需要** | `sceneDidEnterBackground` 已覆盖「用户离场」的主路径；更频繁落盘只增加 IO，不提升可靠性 |
| 8 | 是否为本方案新建 iOS XCTest target？ | **不新建**，改为「抽纯函数 + 真机清单」 | 今天没有任何 test target（§5 已确认）。为一个存量约几十行的判定逻辑引入 target 需要改 `project.pbxproj`（该工程还混着 SPM/CocoaPods 结构），成本明显高于收益。把判定与 key 归一化抽成纯函数，未来要加 target 时可零改动接入 |
| 9 | 恢复期间的原生「返回服务器列表」浮层，是复用启动 splash 还是新做一个轻量浮层？ | **新做一个轻量浮层** | splash 的生命周期由 Capacitor 管，塞入可交互按钮容易和它的淡出时机打架；独立浮层可精确地在「挂载成功」时移除 |

## 7. 验证计划

1. `npm run build`（前端产物）+ `npx cap sync ios`。
2. Xcode 真机：连接服务器 → 进入某会话 → 杀进程 → 重开，确认落回同一会话。
3. 边界：① 服务器关机后重开 App（应回选择页且不卡死、不进死循环）；② 「返回服务器列表」后杀进程重开（应停留在选择页）；③ 删除该服务器后重开（应回选择页）；④ 设置 `CLOUDCLI_SERVER_URL` 的直连包（应直接进服务器、不经选择页、且**不走恢复逻辑**——这条专门守事实 12 的坑）；⑤ 切到第二台服务器后杀进程重开（应恢复第二台，且不复用第一台的 WebView）；⑥ 后端挂掉但反代/静态层仍在返回 5xx 时重开（应被挂载探测抓到并回退，而不是停在错误页上无路可走）。
4. 完成 V1–V8 的实测项并把结论回填到 §3。
5. 真机内存观察：确认 key 归一化后 `maxCachedServers = 2` 的预算没有被重复 WebView 挤占。

> 更完整的验收清单（含跨 WebView 竞争、`Preferences.remove` 冒烟、SPA fallback 返 200 三个补充场景）见 §8.5，以 §8.5 为准。

## 8. 技术执行方案（可直接执行）

> **权威性**：§1–§7 是设计与三轮审阅的依据；本节是定稿的执行细则。若二者冲突，以本节为准。§6 的 9 项倾向已全部采纳为决策（§8.1）。

### 8.1 已决决策（承接 §6）

| # | 决策 | 落地位置 |
|---|---|---|
| 1 | 还原默认开启，不提供开关 | `viewDidLoad` 无条件调 `attemptRestore()` |
| 2 | 策略 I：乐观加载 + 挂载探测回退 | §8.4 · P3 |
| 3 | 失败回选择页 + 一条非阻塞提示 | `finishRestore(success: false)` |
| 4 | **「用户主动」进入选择页**才清还原标记。失败**被动**回退不算主动——`finishRestore(success:false)` 刻意走 `show(pickerController)` 而非 `showServerPicker`，否则用户刚要续接的目标会被一次失败立刻清掉；「主动返回列表」也是用户摆脱永久失效服务器的唯一一次操作（决策 15） | `showServerPicker` 内 `RestoreTargetStore.clearTarget()` |
| 5 | **删除** `cloudcli.lastServer`（写入与键一并移除） | `picker.js` 删除 `LAST_KEY` / `setLastServer` / 调用点 |
| 6 | 只记最后一次（单键） | 单键 `cloudcli.restoreTarget` |
| 7 | 不加 `sceneWillResignActive` 等额外落盘 | 仅 `sceneDidEnterBackground`（**随 P4 条件化**，决策 17） |
| 8 | 不新建 iOS XCTest target | 抽纯函数 + §8.5 真机清单 |
| 9 | 新做轻量恢复浮层（不复用 splash） | `showRestoreOverlay()` |
| 10 | 坏的 `restoreTarget` 值**自愈**（读到即清除）而非静默跳过 | `RestoreTargetStore.readTargetURL()`：区分「无键」与「键坏」 |
| 11 | 写入侧加 `document.visibilityState === 'visible'` 守卫；**仅在守卫被 V7 证伪时**，原生侧才在**切换**与**退后台**两个时机以可见页覆盖 | 主防线 P1-2；原生两层（P2-3 路径 C、P4-2 路径 B）**随 P4 条件化**（决策 17）——针对事实 17 的跨 WebView 竞争 |
| 12 | `CLOUDCLI_SERVERS_KEY` 落 `src/shared/constants.ts`；**并把 `SidebarServerMenu.tsx:11` 的私有 `SERVERS_KEY` 一并改为引用它**，消除 JS 侧两个同值字面量。`picker.js` 走原生注入的 `Preferences`、不能 `import`，保留字面量并纳入升级回归注记 | §8.2-8、§8.4 P1-0、P1-2 |
| 13 | **改 `mobile/www/` 后必须 `npm run mobile:sync`**（= `cap sync ios`）才在真机生效；`ios/App/App/public/` 是产物、整目录被 `ios/.gitignore` 忽略、**不需要提交** | §8.2-7、§8.4 P1-3/P5、§8.5-⑫ |
| 14 | tracker **复用 `isCapacitorNativeShell()`**（`@/shared/utils`），不再内联 `CapacitorWindow` 与 `isNativePlatform?.()` | §8.4 P1-2 |
| 15 | **失败不清还原标记**（保留原语义，**不引入连续失败计数**）：临时离线不丢续接能力，下次冷启动会再试一次。永久失效的服务器由用户主动「返回服务器列表」一次即可摆脱（决策 4 清标记）。计数被定为**过度设计**——它要引入「写目标即归零」的接线约定与记账字段，收益（省一次约 2s 白等）不抵复杂度（第十轮撤销） | §8.4 P3-2 |
| 16 | 轮询频率**不预置自适应**：先按固定 0.5s 实现，是否加「`isLoading == true` 期间拉长间隔」由 V6 实测决定 | §8.4 P3-1、§3 V6 |
| 17 | **P4 原生落盘降为条件阶段，去留由 V7 决定**：tracker 已监听 `visibilitychange`，若 V7 证实「`isHidden` 切换会触发 `visibilitychange`」，则「隐藏页守卫 + 可见页自写」由**同一个 tracker 覆盖两个窗口**。V7 通过 → **不实现 P4**（路径 B/C、`persistVisibleTarget`、后台任务、`currentController` 全部省略）；V7 不通过 → 才补 P4 | §8.3、§8.4 P4、§8.5-⑧ |
| 18 | **（延后 / 可选）Swift 侧端口按 scheme 规约**（事实 18）：`(http, 80)`、`(https, 443)` 视为 nil，其余端口一律保留。方案已证**所有现存 JS 写入路径都先剥掉默认端口**，故此项目前**不触发**、纯属防未来新增路径；按 YAGNI **延后实现**（备查实现见 §8.7） | §8.7、§8.4 P2-1 |
| 19 | **（延后 / 可选，随决策 18）三处端口比较保持一致**：`isKnownServerOrigin`、`normalizedOriginKey`、`isShowingLoadedServerOrigin` 不得各写一套。延后期间三处都用原始 `url.port` 即可（本身就一致）；仅在实施决策 18 时才引入共用的 `normalizedPort` | §8.7 |

> **对 §6 问题 5 的裁决变更**：§6 该行「我的倾向」列写的是「保留写入、不删键」，但同一格的理由又倾向删除，二者矛盾。此处定为**删除**——确认无任何读取方（`mobile/www/picker.js:12,67` 是仅有的两处引用；Electron 的 `lastActiveServerId` 是同名不同物，与此键无关），其 origin 语义已被 `cloudcli.restoreTarget` 完全取代，保留只会形成两个「上次服务器」键并存的歧义。删除无迁移风险：任何历史版本都不读它。

> **连续失败计数——第十轮整体撤销（记录以备考）**：第五～九轮曾围绕「失败后目标永久保留会让永久失效的服务器每次冷启动白等一轮约 2s」设计连续失败计数，并最终定为与目标同键 `{ url, failures }`（原决策 17）。第十轮重新权衡后**全部撤销**：收益仅省一次约 2s 白等，代价却是新增「写新目标即归零」这一接线约定、记账字段与专门验收项，属过度设计。替代更简——**失败不清标记（决策 15）+ 用户主动「返回服务器列表」即清（决策 4）**：永久失效的服务器，用户点一次返回列表便永久摆脱；临时离线则下次启动继续尝试，反而更好。存储退回纯 `{ url }`。

> **两条曾被评为「不采纳 / 不成立」的意见，第九轮的处置**：
> - 第五轮 `[CAUTION]`（默认端口导致 `isKnownServerOrigin` 误判）——**原判「前提不成立」已被推翻**。JS 侧确实规约默认端口，但 Swift `URL` **保留**显式 `:80`/`:443`（本机实测）。此前不失配靠的是「所有写入路径都先过 JS」这一隐式依赖，而非两端一致。现**采纳其结论**（须显式规约），但**延后实现**（决策 18，见 §8.7 备查）：现存所有写入路径都先过 JS，此项目前不触发，属防未来路径的加固。§8.5-⑬ 因此**不升为承重用例**，仅保留为可选对拍。
> - 第六轮「首次连接 restoreTarget 未闭环」——仍**不成立**（P1-3 已让 `connect()` 写入），仅在该注释处补一处交叉引用（§8.4 P2-3）。

### 8.2 先读的实现约束（非显然，影响做法）

1. **不新增 Swift 文件。** `ios/App/App.xcodeproj/project.pbxproj` 不是文件系统同步组（无 `PBXFileSystemSynchronizedRootGroup`），每个 `.swift` 都要在 `PBXBuildFile` / `PBXFileReference` / group children / Sources 四处手工登记（`:13,18-19,26,32-33,69-72,164-166`）。新增文件需手改工程文件，收益不抵成本。因此原生改动**全部落在现有两个文件**：`WebCachePlugin.swift`、`SceneDelegate.swift`（后者仅在条件阶段 P4 实施时改动）。
   - **这条约束有实证先例，且性质已澄清**：`WebCachePlugin.swift` 本身就是手工登记的——它的 fileRef ID 是 `A1B2C3D4E5F60708090A0B0D`，是人工构造的可读十六进制，与 Xcode 生成的那批（如 `9582B6822FE993A50072D4E8`）风格明显不同（`project.pbxproj:19,33,69,164`）。也就是说「手工登记」这条路**跑通过**，本约束的成立理由是**取舍**（收益不抵成本），不是「做不到」。
   - 现状需知悉：该文件目前**已承载 3 个互不相关的插件类**（`WebCachePlugin` `:13`、`ServerSessionPlugin` `:37`、`HapticsPlugin` `:86`，后者于 `77e29179` 加入）。本方案还要再加 `RestoreTargetStore` 与容器改造，完成后该文件约 400 行、4 个类型。若日后继续膨胀，可考虑重命名/拆分——但那同样要改 pbxproj 四处，成本与新增文件相当，**不在本方案范围内**。
2. **`CapacitorStorage.` 前缀是刻意接受的硬编码耦合。** `@capacitor/preferences` 默认 `group = .named("CapacitorStorage")`、`prefix = group + "."`、`defaults = UserDefaults.standard`（`node_modules/@capacitor/preferences/ios/Sources/PreferencesPlugin/Preferences.swift:10,18-23,62-63`）。原生侧直接以该前缀读写同一份存储（事实 5）。若未来升级该插件改动默认 group，原生读取会静默失效——升级该插件时必须回归 §8.5 的 ①。
3. **`attemptRestore()` 必须在 `show(pickerController)` 之后**（事实 14），否则 `pickerController.bridge` 为 `nil`，直连 guard 静默失效。
4. **一次启动只尝试一次还原**：`restoringController` 非 nil 期间不再发起，失败也不重试，避免失败循环。
5. 前端新模块须遵守 `frontend-module-standards`：`@/...` 别名导入、barrel 只暴露必要 API、用 `type` 而非 `interface`、导出组件在定义处写消费者注释。
6. **「当前可见的服务器」不等于「唯一在跑的服务器」**（事实 17）。缓存 2 台时被隐藏的那台 JS/WebSocket 仍在运行，它的 tracker 仍会写 `restoreTarget`。因此：写入侧要加可见性守卫（P1-2）；若 V7 证实守卫有效（隐藏页 `visibilityState` 为 `hidden`），仅 P1-2 即可闭环；否则才需原生侧在切换与退后台两个时机用可见页覆盖（P2-3 路径 C、P4-2 路径 B，即条件阶段 P4）。**守卫有效性依赖 V7，未跑前按「未成立」对待。**
7. **改的是源，跑的是产物**（事实 19）。`mobile/www/` 是 `webDir`，`cap sync ios` 把它拷进 `ios/App/App/public/`，真机 bundle 加载的是后者。因此 P1-3 对 `picker.js` 的改动（删 `lastServer`、写入/清理 `restoreTarget`）**必须 `npm run mobile:sync` 之后**才能在真机验证；反过来，`ios/App/App/public/` 整目录被 `ios/.gitignore` 忽略、**不要提交**。§8.5-⑫ 为对应冒烟项。
8. **`cloudcli.servers` 的条目 schema 是原生侧的隐式契约**：`RestoreTargetStore.isKnownServerOrigin`（P1-1）硬读该键，并期望每条为 `{ name, url }` 且 `url` 是可解析的字符串（由 `picker.js` 的 `saveServers` 保证，事实 7、第五轮已独立确认）。若日后 picker 改字段名（如 `url` → `origin`），原生侧会解析失败并**一律判「服务器已删」**——恢复从此静默失效且不报错，与 `CapacitorStorage.` 前缀是同类风险。故本约束与第 2 条一并在 §8.5 的升级回归注记中登记；`picker.js` 侧字面量（含决策 12 提到的两个 key）也一并纳入。

### 8.3 阶段与顺序

| 阶段 | 内容 | 依赖 | 可独立验证 |
|---|---|---|---|
| P1 | 共享常量（P1-0）+ 存储契约 + 写入/清理路径（tracker 含可见性守卫、picker 写入与删除清理、坏值自愈） | 无 | 是（读 UserDefaults 或真机） |
| P2 | key 归一化 + `presentServer` 抽取 + 还原判定 | P1（需读到标记） | 是（先还原到服务器首页即可） |
| P3 | 挂载探测 + 浮层 + 失败回退 + 清标记接线 | P2 | 是（真机） |
| P4（**条件阶段**） | 原生落盘：P4-1 共享落盘函数 `persistVisibleTarget(for:)`（含 `expirationHandler`）+ P4-2 `sceneDidEnterBackground`（路径 B）+ 路径 C 的调用点。**仅当 V7 证实 tracker 守卫无效时才实施**；V7 通过则整阶段跳过 | P2 + V7 | 是（真机） |
| P5 | 文档、前端测试、`npm run mobile:sync` 后真机冒烟（事实 19）、真机清单、V 项结论回填 | P1–P3（P4 若实施） | 是 |

P1 的前端 tracker 与原生 store 可并行；P2 内「key 归一化」与「还原判定」互不依赖，可并行。**P4 是条件阶段、不进关键路径**：P1–P3 完成后先跑 P5 真机清单与 V7，再决定是否实施 P4。

> **为什么 P4 是「条件阶段」而非「必需」（第十轮简化，决策 17）**：事实 17 下确有两个路径 A 抓不到的窗口（切换到已缓存服务器时路由不变、隐藏页在切换之后反写），但两者**都取决于 V7**。若隐藏页的 `visibilityState` 真为 `hidden`、且 `isHidden` 切换会触发 `visibilitychange`，那么 tracker 的「可见时才写 + 转可见时自写」这一个组件就同时覆盖两个窗口（见 §8.4 P1-2 的 `visibilitychange` 监听），P4 整块可省。**实现顺序：先做 P1–P3 → 真机跑 V7 → 通过即永久跳过 P4；不通过才补 P4-1/P4-2 与路径 C。**

### 8.4 分阶段执行细则

#### P1 存储契约与写入侧

**P1-0 共享常量（前置，先做）**

- `src/shared/constants.ts` 新增 `export const CLOUDCLI_SERVERS_KEY = 'cloudcli.servers';`（决策 12）。
- `src/modules/sidebar/SidebarServerMenu.tsx:11` 的私有 `const SERVERS_KEY = 'cloudcli.servers';` 改为 `import { CLOUDCLI_SERVERS_KEY } from '@/shared/constants';` 并就地引用它，删掉本地字面量。**顺带**（可选、非阻断）：该文件 `:51-52` 内联的 native 探测与 `CapacitorWindow` 类型可一并换成 `isCapacitorNativeShell()`（事实 20）——因为它本来就在本次改动范围内，两处独立实现收敛成一处更不易漂移。
- `mobile/www/picker.js:11` 的 `STORAGE_KEY = 'cloudcli.servers'` **保留字面量**：该文件是原生 JS、由 `index.html` 直接加载，走的是原生注入的 `Preferences`，无法 `import` TS 常量。它连同本文件另外两个 key 一起，纳入 §8.2-8 的升级回归注记。

**P1-1 原生 store helper**（`WebCachePlugin.swift` 顶部，两个 plugin 类之前；无 Capacitor/UIKit 依赖）

```swift
/// @capacitor/preferences 在 iOS 上写入 UserDefaults.standard，键名前缀固定为
/// "CapacitorStorage."（插件默认 group）。原生侧直接读写同一份存储，避免为冷启动
/// 还原新增桥接方法。该前缀是插件实现细节，升级 @capacitor/preferences 时须回归 §8.5-①。
enum RestoreTargetStore {
    private static let prefix = "CapacitorStorage."
    private static let targetKey = prefix + "cloudcli.restoreTarget"
    private static let serversKey = prefix + "cloudcli.servers"

    /// 唯一读取入口。**必须区分「无键」与「键存在但 url 不可用」**：后者是坏值（写入被
    /// 中断、存储损坏、旧版本残留格式），就地清除整个键。否则一个坏值会让恢复从此永久
    /// 静默失效且无自愈路径——与本方案已两次踩到的「静默失效」型坑（事实 12、14）同类（决策 10）。
    static func readTargetURL() -> URL? {
        guard let raw = UserDefaults.standard.string(forKey: targetKey) else { return nil }
        guard let data = raw.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let value = object["url"] as? String,
              let url = URL(string: value),
              let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              url.host != nil else {
            clearTarget()          // 键存在但 url 不可用 → 坏值，清整键
            return nil
        }
        return url
    }

    /// 写还原目标。**所有写入路径（tracker / picker connect / 路径 B / 路径 C）都走这里**，
    /// 契约统一为 `{ "url": <绝对 URL> }`（第十轮起不含计数，见决策 15）。
    static func writeTargetURL(_ url: URL) {
        guard let data = try? JSONSerialization.data(withJSONObject: ["url": url.absoluteString]),
              let json = String(data: data, encoding: .utf8) else { return }
        UserDefaults.standard.set(json, forKey: targetKey)
    }

    static func clearTarget() {
        UserDefaults.standard.removeObject(forKey: targetKey)
    }

    /// 该 origin 是否仍在选择页保存的服务器列表中；服务器被删则不再还原。
    /// 本函数与 `cloudcli.servers` 的写入 schema 是隐式契约（§8.2-8）：字段名一变，
    /// 这里会一律判「已删」并让恢复永久静默失效，故对结构级失配留一条可诊断日志。
    /// 端口比较用原始 `url.port`；默认端口规约见 §8.7 延后项（决策 18/19）。
    static func isKnownServerOrigin(_ url: URL) -> Bool {
        guard let raw = UserDefaults.standard.string(forKey: serversKey),
              let data = raw.data(using: .utf8),
              let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            NSLog("[CloudCLI] restore: cloudcli.servers 不可解析，跳过还原（schema 可能已变）")
            return false
        }
        if !list.isEmpty, list.allSatisfy({ $0["url"] == nil }) {
            NSLog("[CloudCLI] restore: cloudcli.servers 条目缺少 url 字段，还原将被静默跳过——检查 picker 的写入 schema")
        }
        return list.contains { entry in
            guard let value = entry["url"] as? String, let saved = URL(string: value) else { return false }
            return saved.scheme?.lowercased() == url.scheme?.lowercased()
                && saved.host == url.host
                && saved.port == url.port
        }
    }
}
```

> **写入契约（第十轮统一）**：tracker、picker、原生三条路径都写 `{ "url": <绝对 URL> }`，不再含 `failures`。原生 `writeTargetURL` 与 JS 的 `Preferences.set` 产出同构 JSON，任何一侧读到的都是同一形状。

**P1-2 前端 route tracker**（新建模块 `src/modules/mobile-session-restore/`）

`RestoreTargetTracker.tsx`：

```tsx
import { Preferences } from '@capacitor/preferences';
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import { CLOUDCLI_SERVERS_KEY } from '@/shared/constants';
import { isCapacitorNativeShell } from '@/shared/utils';

/** Only this module writes the restore target, so the key stays module-local. */
const RESTORE_TARGET_KEY = 'cloudcli.restoreTarget';

/**
 * Persists the current absolute URL to native storage so a cold start can restore
 * the session. Rendered by App inside <Router> (useLocation requires it).
 * No-op outside the native shell, while hidden, or when the current origin is not a saved server.
 */
export function RestoreTargetTracker() {
  const location = useLocation();

  // Re-run on every route change so the persisted target tracks the active session, and on
  // visibility changes so a WebView that becomes visible again re-asserts its own URL.
  useEffect(() => {
    void persistRestoreTarget();
    const onVisibilityChange = () => void persistRestoreTarget();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [location]);

  return null;
}

async function persistRestoreTarget() {
  // Reuse the shared native-shell check rather than inlining a CapacitorWindow cast
  // (src/shared/utils.ts:266) — one implementation, per frontend-module-standards.
  if (!isCapacitorNativeShell()) return;

  // Up to two server WebViews stay alive at once, and a hidden one is only isHidden —
  // its JS keeps running (WebCachePlugin.swift:167,236-238). Without this guard, the
  // background server could overwrite the target while the user is looking at another.
  // Whether WKWebView reports 'hidden' for a hidden sibling view is V7 (unverified), which
  // is why the native side also re-persists on switch and on background (P2-3 / P4).
  if (document.visibilityState !== 'visible') return;

  const { href, origin } = window.location;
  try {
    const { value } = await Preferences.get({ key: CLOUDCLI_SERVERS_KEY });
    const servers: unknown = value ? JSON.parse(value) : [];
    if (!Array.isArray(servers) || !servers.some((entry) => isSavedOrigin(entry, origin))) return;
    // Store the raw href, not useLocation().pathname: the router pathname strips a
    // deployment basename that the native loader will include, which would restore a 404.
    await Preferences.set({ key: RESTORE_TARGET_KEY, value: JSON.stringify({ url: href }) });
  } catch {
    // Restore is best-effort; a failed write must never affect the running session.
  }
}

function isSavedOrigin(entry: unknown, origin: string): boolean {
  if (typeof entry !== 'object' || entry === null) return false;
  const url = (entry as { url?: unknown }).url;
  if (typeof url !== 'string') return false;
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}
```

`index.ts`：`export { RestoreTargetTracker } from '@/modules/mobile-session-restore/RestoreTargetTracker';`

`src/App.tsx`：在 `<Router>` 内、`<Routes>` 之前挂 `<RestoreTargetTracker />`（`useLocation` 必须在 Router 内），并从 `@/modules/mobile-session-restore` 导入。

> 自校验（写入前查 `cloudcli.servers`）同时挡掉了「旧前端整页导航到本地选择页」把 `capacitor://localhost/...` 写成目标的情形（§4.1）。

**P1-3 `picker.js` 写入与清理**

- 删除 `LAST_KEY`（`:12`）、`setLastServer`（`:65-68`）与 `connect()` 中的调用（`:291`）。
- 新增 `RESTORE_KEY = 'cloudcli.restoreTarget'` 与：

```js
async function setRestoreTarget(url) {
  if (!Preferences) return;
  try {
    await Preferences.set({ key: RESTORE_KEY, value: JSON.stringify({ url: url }) });
  } catch (e) { /* 记录失败不影响连接 */ }
}

/** 删除的服务器若正是当前还原目标，一并清标记，避免冷启动撞上已删服务器。 */
async function clearRestoreTargetIfMatches(serverUrl) {
  if (!Preferences) return;
  try {
    var res = await Preferences.get({ key: RESTORE_KEY });
    if (!res || !res.value) return;
    var target = JSON.parse(res.value);
    if (target && target.url && new URL(target.url).origin === new URL(serverUrl).origin) {
      await Preferences.remove({ key: RESTORE_KEY });
    }
  } catch (e) { /* 解析失败则保持原样 */ }
}
```

- `connect(url, name)` 中以 `await setRestoreTarget(url)` 取代原 `setLastServer(url)`。
- 删除按钮回调（`:252-266`）在 `saveServers` 成功后调 `await clearRestoreTargetIfMatches(server.url)`。

> 与前端 tracker 是**冗余写入**（两条路径契约一致），保留的理由：连接瞬间 SPA 尚未加载时若进程被杀，picker 的写入能保证目标正确；且远端服务器可能仍在提供未含 tracker 的旧前端，此时只有 picker 与 P4 的原生落盘能记录。
>
> `Preferences.remove` 的可用性已核实，不需要退化成「写空值」：原生侧在 `pluginMethods` 里注册了 `remove`（事实 16），picker 页取的 JSExport 对象与打包路径最终查同一张方法注册表。仍建议在真机清单里对「删除当前服务器」这一步做一次冒烟（§8.5-②）。

#### P2 还原判定与 key 改造

**P2-1 key 归一化**（消除「同一服务器不同路径各建一个 WebView」）

```swift
/// WebView 缓存键统一为 origin（scheme://host[:port]），消除「同一服务器不同路径各建一个
/// WebView」。端口归约见 §8.7 延后项——现存所有写入路径都先过 JS 的 WHATWG 序列化、已剥掉
/// 默认端口，故当前直接用 `url.port` 即可（决策 18/19 延后）。
func normalizedOriginKey(_ url: URL) -> String {
    guard let scheme = url.scheme?.lowercased(), let host = url.host else {
        return url.absoluteString
    }
    if let port = url.port { return "\(scheme)://\(host):\(port)" }
    return "\(scheme)://\(host)"
}
```

`showServer` 内 `let key = url.absoluteString`（`:188`）改为 `normalizedOriginKey(url)`。三处调用方均无需改动：`ServerSessionPlugin.switchToServer`（`:58-74`）、选择页降级路径、还原路径。`isShowingLoadedServerOrigin`（`:147-154`）本就读 origin，天然兼容（其端口比较保持一致即可，不必新增 `normalizedPort`，见 §8.7 延后项）。

**P2-2 还原判定抽成纯函数**（无 Capacitor/UIKit 依赖，供手工验证；入参由调用方映射）

```swift
enum RestoreDecision: Equatable {
    case skip                 // 直连模式或无可还原目标
    case forget               // 目标服务器已删：清标记后走选择页
    case restore(URL)
}

func decideRestore(isDirectConnect: Bool, targetURLString: String?, isServerSaved: Bool) -> RestoreDecision {
    if isDirectConnect { return .skip }
    guard let value = targetURLString, let url = URL(string: value),
          let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme),
          url.host != nil else { return .skip }
    return isServerSaved ? .restore(url) : .forget
}
```

**P2-3 容器改造**（`CloudCLIContainerViewController`）

- 新增 `private weak var restoringController: CloudCLIBridgeViewController?`、`private var restoreOverlay: UIView?`（P3 用）。`currentController` 只有 P4-2（退后台覆盖）需要，**随 P4 条件化**：V7 通过则不新增。
- 把 `showServer` 的建/取缓存主体抽成 `@discardableResult private func presentServer(_ url: URL) -> CloudCLIBridgeViewController`（key 用 P2-1），`showServer(_:from:)` 变为 `_ = presentServer(url)` 的薄包装。抽取时**缓存命中且无需重载的分支要落盘**（路径 C）：

```swift
private func presentServer(_ url: URL) -> CloudCLIBridgeViewController {
    let key = normalizedOriginKey(url)
    let serverController: CloudCLIBridgeViewController
    if let cachedController = serverControllers[key] {
        serverController = cachedController
        if !serverController.isShowingLoadedServerOrigin {
            serverController.loadServer(url)
        }
        // 缓存命中且无需重载时，该 WebView 转回可见会触发前端 tracker 的 visibilitychange
        // 自写（P1-2），无需在此落盘。仅当 V7 破、实施 P4 时才加回路径 C（决策 17）。
    } else {
        serverController = CloudCLIBridgeViewController()
        serverControllers[key] = serverController
        serverController.loadServer(url)
    }
    touchServer(key)
    show(serverController)
    trimServerCache()
    return serverController
}
```

> 路径 C（缓存命中时主动落盘）**只在 V7 破、实施 P4 时才加回上面的分支**；V7 通过时该窗口由 tracker 的 `visibilitychange` 监听覆盖（决策 17）。新建/重载分支不必落盘——随后的首次挂载会让 tracker 写入（P1-2），且选择页 `connect()` 也已写过（P1-3 的 `setRestoreTarget(url)`，它取代了原 `setLastServer(url)`）。
- `showServerPicker(from:)`（`:143-150`）首行加 `RestoreTargetStore.clearTarget()`（决策 4）。
- `viewDidLoad` 末尾加 `attemptRestore()`：

```swift
private func attemptRestore() {
    // 必须在 show(pickerController) 之后：bridge 在 loadView() 里才创建（事实 14）。
    guard let config = pickerController.bridge?.config else { return }
    let isDirectConnect = config.serverURL != config.localURL   // 事实 12
    let target = RestoreTargetStore.readTargetURL()
    let isSaved = target.map(RestoreTargetStore.isKnownServerOrigin) ?? false

    switch decideRestore(isDirectConnect: isDirectConnect,
                         targetURLString: target?.absoluteString,
                         isServerSaved: isSaved) {
    case .skip:
        return
    case .forget:
        RestoreTargetStore.clearTarget()
        return
    case .restore(let url):
        let controller = presentServer(url)
        showRestoreOverlay()
        watchMount(controller)
    }
}
```

#### P3 挂载探测与退出路径

**P3-1 轮询（策略 I）**——判据用 `#root` 子节点（事实 15），计时以 `isLoading == false` 为门控（§4.2）

```swift
private let restorePollInterval: TimeInterval = 0.5
private let restoreUnmountedGrace: TimeInterval = 1.5   // W
private let restoreAbsoluteTimeout: TimeInterval = 30   // C
private let mountProbeScript = "!!(document.getElementById('root') && document.getElementById('root').children.length)"

private func watchMount(_ controller: CloudCLIBridgeViewController) {
    restoringController = controller
    pollMount(controller, deadline: Date().addingTimeInterval(restoreAbsoluteTimeout), notLoadingSince: nil)
}

private func pollMount(_ controller: CloudCLIBridgeViewController, deadline: Date, notLoadingSince: Date?) {
    guard restoringController === controller, let webView = controller.bridgedWebView else { return }
    webView.evaluateJavaScript(mountProbeScript) { [weak self, weak controller, weak webView] result, _ in
        guard let self, let controller, let webView else { return }
        // 浮层可能已被「返回服务器列表」取消（restoringController 置 nil）；迟到的回调不得再收尾。
        guard self.restoringController === controller else { return }
        if (result as? Bool) == true { self.finishRestore(success: true); return }

        let now = Date()
        if now >= deadline { self.finishRestore(success: false); return }

        var next = notLoadingSince
        // isLoading 由 false 翻回 true 会重置计时窗口。这是**刻意**的保守选择：只推迟
        // 回退、不会误杀合法慢加载，兜底由 C 负责。不要当 bug「修」掉。
        if webView.isLoading { next = nil }                 // 合法慢加载：不计时
        else if next == nil { next = now }                  // 页面已结束加载，开始累计
        if let since = next, now.timeIntervalSince(since) >= self.restoreUnmountedGrace {
            self.finishRestore(success: false); return      // 覆盖 5xx / DNS / 连接被拒
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + self.restorePollInterval) { [weak self] in
            self?.pollMount(controller, deadline: deadline, notLoadingSince: next)
        }
    }
}
```

**P3-2 成功/失败收尾**

```swift
private func finishRestore(success: Bool) {
    restoringController = nil
    removeRestoreOverlay()
    guard !success else { return }   // 成功：撤轮询与浮层即可，目标保留
    // 失败**不**清标记（决策 15）：临时离线不应让用户永久丢失续接能力，下次启动会再试。
    // 永久失效的服务器由用户主动「返回服务器列表」一次摆脱（决策 4 会 clearTarget）。
    show(pickerController)
    showRestoreFailureToast()
}
```

> `cancelRestore()`（P3-3 的浮层按钮）走 `showServerPicker`，后者含决策 4 的 `clearTarget()`；第十轮起不再有计数需要清零。

**P3-3 浮层与提示**（`restoreOverlay` 为容器 view 上的自绘视图，不复用 splash）

- `showRestoreOverlay()`：半透明/不透明背景 + `UIActivityIndicatorView` + 文案「正在恢复上次会话…」+ 按钮「返回服务器列表」。
- 按钮回调 `cancelRestore()`：`restoringController = nil` → `removeRestoreOverlay()` → `showServerPicker(from: pickerController)`（复用决策 4 的清标记）。
- `showRestoreFailureToast()`：一条自动 3s 消失的非阻塞文案（如「未能恢复上次会话，已返回服务器列表」）。**不得**用阻断式弹窗（§6 问题 3）。
- `removeRestoreOverlay()`：`restoreOverlay?.removeFromSuperview()` 并置 nil；成功路径在挂载探测为真时调用。

**与前端 splash 的交接（本轮补充，需实测）**：WebView 内还有它自己的启动 splash —— `index.html:80-84` 的 `#app-splash`，由前端 `src/utils/splash.ts:9` 的 `dismissSplash()` 在「首个稳定帧」加 `.splash-hidden` 隐藏（`index.html:32` 有该 class 的样式）。所以冷启动还原实际是**两段连续过渡**：原生恢复浮层 → web splash → 内容。关键在于 `#root` 出现子节点（P3-1 的挂载判据）与 `dismissSplash()` 被调用**不是同一刻**，中间可能有一帧重叠（两层 loading 同时可见）或空档（都不可见）。P3 实现时按 §8.5-⑩ 观察；若抖动明显，优先调整原生浮层的移除时机（例如延后一个 runloop，或等 `#app-splash` 带上 `.splash-hidden` 再移除），**不要为此新增桥接方法**——为一个纯视觉时序问题引入原生↔前端信令不划算。

#### P4 原生落盘（**条件阶段：仅当 V7 证实守卫无效时才实施**；V7 通过则整节跳过）

> 本阶段是决策 17 的兜底实现。**若 V7 通过，不要实现本节任何内容**——tracker 的「可见时才写 + 转可见时自写」已覆盖事实 17 的两个窗口。

**P4-1 共享落盘函数**（路径 C 与路径 B 共用，避免两处各写一遍 `evaluateJavaScript`）

```swift
/// 把指定 WebView 当前的真实 URL 落盘为还原目标。
/// 必须 evaluateJavaScript：SPA 的 pushState 不更新 webView.url（V1）。
/// - Parameter useBackgroundTask: 仅在 App 已进后台的调用点（P4-2）为 true。
///   前台调用（P2-3 路径 C）不需要后台任务。
func persistVisibleTarget(for controller: CloudCLIBridgeViewController,
                          useBackgroundTask: Bool = false) {
    guard controller !== pickerController, controller.isShowingLoadedServerOrigin,
          let webView = controller.bridgedWebView else { return }

    var taskID = UIBackgroundTaskIdentifier.invalid
    let finishTask: () -> Void = {
        guard useBackgroundTask, taskID != .invalid else { return }
        UIApplication.shared.endBackgroundTask(taskID)
        taskID = .invalid
    }
    if useBackgroundTask {
        // 必须带 expirationHandler：evaluateJavaScript 不回调（Web 进程被挂起/异常）时，
        // 若不主动结束任务，系统会在时间用尽后按默认行为处置——历史上是**直接终止 App**，
        // 而不是仅仅回收任务。这是漏掉后会崩溃的坑，不是可选优化。
        taskID = UIApplication.shared.beginBackgroundTask(withName: "cloudcli.persistRestoreTarget") {
            finishTask()          // 时间将尽：结束任务并放弃本次落盘
        }
    }

    webView.evaluateJavaScript("window.location.href") { result, _ in
        defer { finishTask() }
        guard let href = result as? String, let url = URL(string: href),
              let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme) else { return }
        RestoreTargetStore.writeTargetURL(url)
    }
}
```

> `taskID` 必须是 `var` 且在闭包外先初始化为 `.invalid`：`finishTask` 与 `expirationHandler` 都捕获同一个变量，靠 `.invalid` 判等保证只结束一次（正常回调与超时回调谁先到都安全）。若写成 `let` 或在 `beginBackgroundTask` 之后才声明，expiration handler 会拿到未初始化/旧值。

**P4-2 `SceneDelegate` 接线**（路径 B）

```swift
func sceneDidEnterBackground(_ scene: UIScene) {
    // CAPSceneDelegateProxy 只实现 willConnectTo/openURLContexts/continue，无此回调，
    // 无需转发（node_modules/@capacitor/ios/Capacitor/Capacitor/CAPSceneDelegateProxy.swift:17,37,58）。
    (window?.rootViewController as? CloudCLIContainerViewController)?.persistVisibleTargetForBackground()
}
```

容器内的薄包装：

```swift
/// App 进后台时，以当前**可见的服务器页**覆盖落盘（路径 B）。
/// 选择页或未加载出服务器页时一律跳过（否则会把 capacitor://localhost/... 写成目标）。
/// 本阶段需新增 `private weak var currentController` 并在 `show(_:)` 末尾维护（若 P2-3 未新增）。
func persistVisibleTargetForBackground() {
    guard let controller = currentController else { return }
    persistVisibleTarget(for: controller, useBackgroundTask: true)
}
```

> **这不是「旧前端兜底」，而是正确性防线**（§8.3）：事实 17 下隐藏页可能在切换之后反写 `restoreTarget`，退到后台这一刻读 `currentController` 落盘是把值修正回可见页的最后机会。其成败取决于 V2，故 V2 已升级为高优先级验证项。
>
> 该路径同时保证「远端服务器仍在提供未含 tracker 的旧前端」时也能还原。

#### P5 文档与测试

- `mobile/README.md:12`「冷启动总是回到选择页」改写为新行为（能确定上次服务器+路由则直接还原，否则回选择页）。
- `docs/architecture/` **确认无需同步**：现有 6 篇均为后端/前端架构主题，无移动端章节（详见 §5 对应行）。
- 前端测试落在 `src/modules/mobile-session-restore/tests/`：非 native 不写存储；origin 不在 `cloudcli.servers` 时跳过；写入值为 `window.location.href` 原值；`/` 与 `/session/:id` 两形态。
- 原生：无 test target（决策 8），靠 §8.5 真机清单覆盖；`normalizedOriginKey` 与 `decideRestore` 为纯函数，可临时以 Xcode 断点/`print` 手工验证分支。

### 8.5 验收与真机清单（Definition of Done）

必须逐条通过：

1. 连接服务器 → 进入某会话 → 杀进程 → 重开：落在同一会话 URL。
2. 边界与竞争（逐条通过）：
   - ① 服务器关机后重开（回选择页、不卡死、不循环，约 2s 内回退）；
   - ② 侧边栏「返回服务器列表」后杀进程重开（停留选择页，标记已被清）；
   - ③ 删除该服务器后重开（回选择页）——同时确认 `Preferences.remove` 真的执行成功（事实 16 的冒烟；最省事的验证是删除后重开不撞已删服务器）；
   - ④ 设置 `CLOUDCLI_SERVER_URL` 的直连包（直接进服务器、不经选择页、**不走还原**——守事实 12）；
   - ⑤ 切到第二台服务器后杀进程重开（还原第二台，且不复用第一台的 WebView）；
   - ⑥ 后端挂但反代仍返 5xx 时重开（被挂载探测抓到并回退，而非停在错误页无路可走）；
   - ⑦ **A → B 且 B 是缓存命中**（先来回切过一次，再停在 B 的某会话）后杀进程重开 → 还原 B（守路径 C：此时 B 的 tracker 不会触发）；
   - ⑧ **A 在后台触发一次路由变化**（A 上有会话自动选中/新建等），随后杀进程重开 → 仍还原到 B（守事实 17）。**本项即 V7 的门**：通过 → tracker 守卫成立、P4 永久跳过；不通过 → 才实施 P4（决策 17）；
   - ⑨ 反代对任意路径都返 200 的 `index.html`（V8）：确认最终落在应用内的报错/登录界面、而非白屏或卡死，并判断该降级是否可接受；
   - ⑩ 冷启动还原的**视觉交接**：连续做 5 次「杀进程 → 重开」，观察「原生恢复浮层 → web splash → 内容」这两段过渡是否存在闪烁、双 loading 叠加或白屏空档（§8.4 P3-3 的补充段）。
   - ⑪ **目标服务器登录态已失效**时冷启动（守事实 21）：清掉该服务器 origin 下的 `auth-token` 后杀进程重开 → 应用会渲染 `LoginForm`、`#root` 有子节点、挂载探测判「成功」。确认降级到登录页**可接受**、浮层消失时机不突兀。这是判据的固有盲区，**不要求**修 probe。
   - ⑫ **`npm run mobile:sync` 后的真机冒烟**（守事实 19）：同步后确认 P1-3 的选择页改动真的生效——删除 `cloudcli.lastServer` 后 App 不报错、连接时写入 `restoreTarget`、删除服务器时清理 `restoreTarget`。若只在模拟器/浏览器里跑 `mobile/www/`，本项不成立。
   - ⑬ **（可选 / 延后）端口规约对拍**：仅在实施决策 18 时才有意义。用四组端口各走一遍「保存并连接 → 杀进程 → 重开」：`http://<host>:80`、`https://<host>:443` 须与不带端口视为同一 origin；`http://<host>:443`、`https://<host>:80` 属非该 scheme 默认端口、**须保留**（防把规约写成一刀切）。**当前不实施决策 18，本项可跳过。**
3. 真机内存观察：key 归一化后同一服务器不同路径不重复创建 WebView，`maxCachedServers = 2` 预算未被挤占。
4. V1–V8 实测结论回填 §3（V7 决定事实 17 的守卫是否够用；V8 决定是否需要新增判据或接受降级）。
5. 前端：`npm run test:client`、`npm run build:client`、`npm run typecheck`、`npm run lint` 通过。
6. 回归：浏览器/桌面包下 tracker 为 no-op；选择页增删改与延迟检测行为不变（除已删的 `lastServer` 写入）。

### 8.6 风险与回滚

| 风险 | 影响 | 缓解 |
|---|---|---|
| 硬编码 `CapacitorStorage.` 前缀随插件升级失效 | 原生读到 nil → 静默不还原 | §8.2-2 注释固化 + §8.5-①② 回归 |
| **跨 WebView 写入竞争（事实 17）**：用户在看 B，而被隐藏的 A 因 WebSocket 事件变化路由并写入 A 的 URL | 冷启动还原到**错误的服务器** | 主防线：P1-2 的 `visibilityState` 守卫（tracker 仅可见时写、转可见时自写），**有效性由 V7 决定**。V7 破则启用条件阶段 P4 的两层原生覆盖（路径 B/C，决策 17）。V7 未跑前本风险按「未解除」对待 |
| **退后台落盘失败（仅 P4 实施时）**：`sceneDidEnterBackground` 内 `evaluateJavaScript` 来不及返回（V2） | 路径 B 这道修正失效 | 仅当 V7 破、启用 P4 后才相关，此时由 V2 决定成败；V7 通过则不实施 P4，本风险不存在 |
| 坏 `restoreTarget` 值（写入中断 / 存储损坏 / 旧格式残留） | 恢复永久静默失效且无自愈路径 | 决策 10：`readTargetURL()` 区分「无键」与「键坏」，坏值就地清除 |
| **（仅 P4）** `beginBackgroundTask` 缺 `expirationHandler` | 回调不返回时任务悬挂，系统超时后**直接终止 App** | P4-1 已含 handler + `taskID = .invalid` 前置。V7 通过、不实施 P4 时本风险不存在 |
| 挂载探测误判（慢设备首次 commit 更晚） | 合法加载被回退到选择页 | W=1.5s 宽限 + `isLoading` 门控；误判后果仅为降级回选择页，非崩溃 |
| 5xx 错误页 `#root` 恰好被注入内容 | 误判为还原成功 | 错误页不含应用 bundle，不产生 `#root` 子节点（事实 15）；若不放心可将判据收紧为「`#root` 有子节点且无 splash 残留」 |
| 反代对任意路径返 200 的 `index.html`（静态层正常、API 全挂） | 应用**正常挂载**、探测判为成功，用户停在应用内的报错/登录界面 | 这不是误判（页面确实起来了），属可接受降级；由 V8 确认实际落点，不做额外判据 |
| **失败后目标保留**：服务器永久失效 / URL 已变时目标一直不清 | 用户每次冷启动都要白等一轮约 2s 才落到选择页，直到主动点一次「返回服务器列表」 | **接受**（决策 15 第十轮定案）：不引入失败计数；由决策 4 的「用户主动返回列表即清」提供一次性摆脱。临时离线则下次启动继续尝试，反而更好 |
| **默认端口语义不一致**（事实 18；**第十轮定为延后加固**）：`normalizeUrl` 存的是 JS `origin`（丢默认端口），而还原目标经 `location.href`/`evaluateJavaScript` 最终由 Swift `URL` 解析，**Swift 侧保留显式 `:80`/`:443`** | **当前不触发**：现存所有写入路径都先过 JS、默认端口已被剥掉。仅当未来新增「直把带显式默认端口的 href 交给 Swift」的路径时，才会 `saved.port(nil) != url.port(80)` 静默失配 | 决策 18/19 已裁定但按 YAGNI **延后实现**；备查实现见 §8.7「延后项」。不依赖此加固即为当前设计 |
| **picker 的 `cloudcli.servers` schema 漂移**（字段改名、结构改动） | 原生 `isKnownServerOrigin` 解析失败 → 一律判「服务器已删」→ 恢复静默失效且不报错 | §8.2-8 已登记为升级/改动回归项；P1-1 对结构级失配打 `NSLog` 便于诊断 |
| **`mobile/www/` 改了但未 `cap sync`**：真机 bundle 仍跑旧产物 | picker 的改动（写入/清理 `restoreTarget`、删 `lastServer`）在真机上不生效，且现象隐蔽（源码看着是对的） | §8.2-7 与决策 13 明确 `npm run mobile:sync`；§8.5-⑫ 为对应冒烟。注意 `ios/App/App/public/` 被 gitignore，从 git 看不出是否已同步 |
| 登录态失效时挂载探测判「成功」（事实 21） | 用户落在登录页而非目标会话，浮层提前消失 | 判据的固有盲区，**不修**（修它需前端配合，得不偿失）；作为可接受降级由 §8.5-⑪ 验收 |

> **已撤销的「已排除」结论（记录以备复核）**：第五轮 `[CAUTION]` 提出的「默认端口导致 `isKnownServerOrigin` 误判」曾在第四轮被作者判为「前提不成立」并列入「已排除」，依据是「URL 序列化一致地规约掉默认端口」。该依据**只对 JS 成立**，第七、八轮指出、作者本机 `swift` 实测确认 Swift `URL.port` 保留显式 `:80`/`:443`。故此项**不再排除**，已转为上表的正式风险行；决策 18 给出显式规约，但第十轮定为**延后实现**（见 §8.7）——当前靠「写入路径都先过 JS」这一隐式依赖即不失配。

**回滚**：功能由 `attemptRestore()` 单点触发，注释/删除该调用即回到「冷启动必进选择页」；存储只是新增一个键（`cloudcli.restoreTarget`，值为 `{ url }`），无数据迁移，回滚无需清理（残留键无人读）。`cloudcli.lastServer` 的删除同样无需回滚处理。端口规约（若实施决策 18）是纯本地比较逻辑，回滚只需还原三处比较式；P4（若因 V7 破而实施）同样是可整块删除的独立模块。

### 8.7 延后项（备查，不在本轮实现范围）

以下是为「未来可能出现」的情形预备的加固，**本轮不实现**（决策 18/19，YAGNI）。触发条件明确后再加。

**端口规约（决策 18/19）**：若日后新增了一条「把带显式默认端口的 href 直接交给 Swift」的写入路径，需在 `RestoreTargetStore` 加：

```swift
/// 按 scheme 归约默认端口：`http:80`、`https:443` 视为 nil。**不能一刀切**——
/// `http://host:443`、`https://host:80` 属非默认端口，必须保留（事实 18）。
static func normalizedPort(_ url: URL) -> Int? {
    guard let scheme = url.scheme?.lowercased(), let port = url.port else { return nil }
    switch (scheme, port) {
    case ("http", 80), ("https", 443): return nil
    default: return port
    }
}
```

并把 `isKnownServerOrigin` 的 `saved.port == url.port`、`normalizedOriginKey` 的 `url.port`、`isShowingLoadedServerOrigin` 的端口比较**三处**统一改走 `normalizedPort`（不得各写一套）。

## 审阅批注

### 审阅者：Claude（亮）· 2026-09-10

总体判断：方案骨架成立，§2 的关键事实已逐条复核无误（Preferences 存储介质、SPA 路由、深链支持），记录/还原两阶段划分与 key 归一化改造方向正确。需要**修改**的是 §4.2 里两处会误导实现的写法（直连分支标签、策略 I 的失败判定），其余为补漏与引用修正。以下按严重度列出，末尾附作者逐条响应表。

### 必须修正

1. **§4.2 还原判定伪代码「`appStartServerURL != nil → 走 picker`」标签错误。** 直连模式下 `show(pickerController)` 里的那个 webView，其 startURL 就是 `appStartServerURL`，也就是说它加载的**本来就是远程服务器，根本不是选择页**（`reloadLocalApp()` 也是拿 `appStartServerURL` 重新加载）。所以该分支的正确语义是「跳过恢复、维持现状」，不是「走 picker」。按字面「走 picker」去实现，容易写成调 `showServerPicker()`，反而触发一次多余的 `reloadLocalApp()`。建议改成：`appStartServerURL != nil → 不读 restoreTarget、不注入恢复逻辑，维持现状（`show(pickerController)` 即已直连）`。（勘误：此处给出的判定条件 `appStartServerURL != nil` 恒真、不可用作直连判定；正确写法是 `serverURL != localURL`，见二次回应 ①）

2. **§4.2 策略 I 的看门狗「N 秒内未 `didFinish` 则回退」覆盖不了「后端 5xx」。** 这是最强的正确性问题。WKNavigationDelegate 层面，任何 HTTP 响应（含 nginx 502/504、后端 5xx）都属于「导航成功」，会回调 `didCommit`/`didFinish`，而不是 `didFail*`。`didFailProvisionalNavigation`/`didFailNavigation` 只覆盖 DNS 失败、连接被拒、超时、TLS/证书错误等「导航没建成」的情形。因此「TCP 连上了但后端 5xx」恰恰是看门狗**抓不到**的那个 case，与 §3 V5 的自述（5xx 与 TCP 超时是两种情形）矛盾。后果是：后端挂、但反代/web 层还在时，用户会被丢在一个无交互的错误页上，且「返回服务器列表」浮层因判定「没失败」而没出现。建议：看门狗判定改为「`didFinish` 后 `evaluateJavaScript` 探测前端 App 是否真正 mount」或「N 秒内既没探测到 App、也没 `didFail` 则回退」；或者干脆把这个 case 交给策略 II 的 `/health` 探活。二选一要在方案里写死，不能留「5xx 靠未 didFinish」这个错误映射。

### 建议澄清 / 补漏

3. **§4.1 路径 B 未区分「当前可见的是服务器页还是选择页」。** `sceneDidEnterBackground` 里对「当前可见广场 WebView」取 `window.location.href` 之前，必须先用 `isShowingLocalApp`/`isShowingLoadedServerOrigin`（事实 9 已有这两个判定）确认是服务器页；否则用户停留在选择页时进后台，会把本地 picker 的 URL 写成 `restoreTarget`。另 `serverControllers` 可缓存 2 个 WebView，需先确定哪个是可见的那个。

4. **§4.1 存储契约的 `savedAt` 字段目前没有消费方。** 两条写入路径（A 前端 tracker、B 原生落盘）在冲突时产出的 `origin`+`path` 是同一个值（B 也是读 `window.location.href` 拼出来），不存在需要 last-write-wins 仲裁的场景。若无明确用途建议删掉（Simplicity First），否则补一句「它在哪个冲突场景被谁读、如何比较」。

5. **§4.1 路径 A 的 path 来源要钉死。** `useLocation().pathname` 会剥掉 basename，而还原时加载走的是原生 `window.location.pathname`（含 basename），两者不一致会还原错 URL（`App.tsx` 的 `detectRouterBasename` 说明存在 basename 场景）。native 移动端当前实际无 basename、风险低，但契约应写死：写入用原生 `window.location.pathname + window.location.search`，而不是 router 的 pathname。

6. **§5 测试：原生侧无测试承载。** `ios/App/AppTests`（或任何 XCTest target）不存在，§5 里「iOS 侧测试是否已有承载需实现时确认」现在可下结论：没有。要么把 key 归一化/还原判定抽成纯函数做手动验证，要么新建 test target，二者需在方案里明确。

### 事实核对一览（供回填 §3，均已复核为真）

7. Fact 4/5：`@capacitor/preferences` 默认 `Group.named("CapacitorStorage")`、`prefix = group + "."`、`defaults = UserDefaults.standard` —— 与方案一致。
8. Fact 11：`ios/App/App/capacitor.config.json` 确实未设 `server.url`。（勘误：本句后半「直连判定读 `appStartServerURL` 正确」不成立——`appStartServerURL` 非可选恒真，正确判定是 `serverURL != localURL`，见二次回应 ①）
9. Fact 3：`SidebarServerMenu.tsx` 在服务器页调 `@capacitor/preferences` 与 `registerPlugin('ServerSession')` 的先例确认存在；`PreferencesPlugin` 在 `packageClassList` 里，服务器页（远程 origin）可直接 `Preferences.set`。

### 引用（小）修正

10. Fact 2 的行号不精确：`useProjectsState.ts:57-61` 是 `SessionDetailsApiPayload` 的**类型注释**；真正的深链 session→project 解析在 `:877-1005`（`if (!sessionId) return` 之后的那个 `useEffect`，含 `api.sessionDetails` 调用与 `navigate(replace)`）。结论（深链本就支持）正确，引用应对上。

### 作者响应表

| # | 章节 | 一句话问题 | 作者响应 |
|---|---|---|---|
| 1 | §4.2 伪代码 | 直连分支「走 picker」标签错误，应为「跳过恢复、维持现状」 | **采纳**（标签与判定条件都改写；判定条件另有更严重的问题，见下 A） |
| 2 | §4.2 策略 I | 「未 didFinish」抓不到 5xx，需改为 `didFinish` 后探测 App 或交给探活 | **采纳诊断，修正处方**：5xx 属导航成功属实；但「`didFinish` 后探测」不可实现（无代理可挂），改为不依赖代理的挂载轮询（见下 B） |
| 3 | §4.1 路径 B | 落盘前需判定当前可见是服务器页而非选择页 | **采纳**（§4.1 加显式判定，并补 `currentController` 指针的改造项） |
| 4 | §4.1 存储契约 | `savedAt` 无消费方，建议删或补仲裁说明 | **采纳**（连带把 `origin`+`path` 收敛为单个绝对 URL，见下 C） |
| 5 | §4.1 路径 A | path 写原生 `window.location.pathname+search`，勿用 router pathname | **采纳，且更进一步**：直接写 `window.location.href` 原值，从契约层面消灭 basename 歧义（见下 C） |
| 6 | §5 测试 | 原生无 test target，需明确「抽纯函数手工验证」或「新建 target」 | **采纳**（§5 下结论「无承载」；新增 §6 问题 8，倾向不新建 target） |
| 7 | §2 Fact 2 | 行号引用改为 `:877-1005` | **采纳**（已改，并保留 `:57-61` 作为类型注释的旁证） |

### 作者响应：CodeBuddy · 2026-09-10

> 保留原文以存审阅历史。本轮 B 项里的「`isLoading == false` 立即回退」与遗留点表中「硬上限拟 15s」**已被第二轮响应修订**（改为 `isLoading` 门控 + W 宽限 + C 兜底），以第二轮响应与 §4.2 现状为准。

已按上表逐条改稿。另有三处需要回给审阅者，其中 **A 是审阅意见自身的一处误判，且关系到功能是否可用**：

**A. 批注 8「直连判定读 `bridge.config.appStartServerURL` 正确」——不成立，且我原稿的条件是恒真的。**

`appStartServerURL` 声明为**非可选** `URL`：

```swift
@objc public var appStartServerURL: URL {          // 不是 URL?
    if let path = appStartPath { return serverURL.appendingPathComponent(path) }
    return serverURL                                 // 无 server.url 时 serverURL == localURL
}
```
（`node_modules/@capacitor/ios/Capacitor/Capacitor/CAPInstanceConfiguration.swift:11-16`）

而 `serverURL` 在未配置 `server.url` 时被赋为 `localURL`：

```objc
_localURL  = [[NSURL alloc] initWithString:@"%@://%@", descriptor.urlScheme, descriptor.urlHostname];
if (descriptor.serverURL != nil) { _serverURL = [[NSURL alloc] initWithString:(descriptor.serverURL)]; }
else                             { _serverURL = _localURL; }
```
（`CAPInstanceConfiguration.m:44-51`）

所以 `bridge.config.appStartServerURL != nil` **恒为 true**（Swift 对非可选值比较 `nil` 只会产生 warning，不报错），照原稿实现会让「直连 guard」永远命中，恢复逻辑一次都不会执行，功能完全失效——这正是批注 1 想修的那个分支。已改为 `bridge.config.serverURL != bridge.config.localURL`，并把它升级为 §2 事实 12；§7 验证清单第 ④ 条也改成了「直连包必须不走恢复逻辑」的专项回归。

批注 1 关于**标签**的判断（直连模式下那个 controller 加载的就是远程服务器、不是选择页）经复核成立，已采纳。

**B. 批注 2 的诊断正确，但它建议的两条处方都落不了地。**

诊断部分（5xx 在 WebKit 里属导航成功、走 `didCommit`/`didFinish` 而非 `didFail*`）复核成立，我原稿那句「未 didFinish 则回退覆盖 5xx」确实自相矛盾，已改。

但处方「`didFinish` 后 `evaluateJavaScript` 探测」需要一个 `WKNavigationDelegate` 回调，而这个代理**不应由我们接管**：Capacitor 在 `loadView()` 里以局部 `let` 创建 `WebViewDelegationHandler`，随即将同一个实例交给 `prepareWebView` 与 `CapacitorBridge`，并执行 `aWebView.navigationDelegate = delegationHandler`（`CAPBridgeViewController.swift:44-52,321`）。它不是可覆写的存储属性，子类无法注入。

> **订正（第二轮由审阅者指出）**：我原文写的是「代理拿不到」，**不准确**。`CapacitorBridge.webViewDelegationHandler` 是 `public private(set)`（`CapacitorBridge.swift:105`），原代理是可取到的，替换 + 转发在技术上也做得到。真正的问题是**必须完整转发每一个分支**（`decidePolicyFor` 的 allowNavigation / `shouldOverrideLoad` / 跨域导航拦截、`didStartProvisionalNavigation` 里的 `bridge?.reset()`、auth challenge、媒体权限……），任何一处漏转都会造成 bridge 状态错乱等运行时事故——收益远小于风险。结论不变：不碰代理。

因此采纳了批注 2 的**落点**（改由「前端是否真的 mount」判定失败）但换掉**手段**：完全不依赖导航代理，用 `evaluateJavaScript` 轮询 `#root` 是否有子节点（`index.html:85`）+ 读 `webView.isLoading`——前者为真即成功，`isLoading == false` 且未挂载即立即回退，外加硬上限。这套判据不需要任何代理回调，且同样覆盖 5xx。已记入 §2 事实 13 与 §4.2。

**C. 批注 4 与 5 我合并处理了，并把存储契约收敛成单个绝对 URL。**

`savedAt` 删除（无消费方，同意 Simplicity First）。批注 5 指出的 basename 歧义我选择从契约层面消除而非「写死正确的 path 拼接」：直接存 `{ "url": window.location.href }`。这样 basename、query、hash 全部天然正确，也不再需要 `origin` 与 `path` 两个必须保持一致的字段——批注 4 担心的不一致窗口连同 `savedAt` 一起消失。`origin` 只在需要「该服务器是否仍在 `cloudcli.servers` 中」校验时现算。

另外按批注 5 的同一思路补了一道批注里没提的护栏：**写入前要求当前 `origin` 出现在 `cloudcli.servers` 中**。否则旧前端的整页导航降级路径（`picker.js:290-306` 会 `window.location.href = pickerUrl`）一旦生效，本地选择页的 `capacitor://localhost/...` 就会被当成恢复目标写进去。

### 待审阅者回应的遗留点

| 议题 | 我方倾向 | 需要审阅者表态什么 |
|---|---|---|
| 事实 12 的判定替换（`serverURL != localURL`） | 已按此改稿 | 是否同意这是唯一正确的直连判定；若有更稳的官方属性请指出 |
| 事实 13 导致的「不用导航代理」结论 | 已按此改稿 | 是否认可「轮询 `#root` + `isLoading`」优于「替换 `navigationDelegate` 并转发」 |
| §6 问题 8：不新建 iOS test target | 抽纯函数 + 真机清单 | 是否接受；若坚持建 target，需确认愿意承担 pbxproj 改动 |
| §6 问题 2：策略 I 的误判风险 | 接受误判，用宽容硬上限缓解 | 硬上限取值（拟 15s）是否合理，或是否更倾向策略 II 的确定性 |

### 审阅者二次回应：Claude（亮）· 2026-09-10

已逐处复核 Capacitor 源码，四个遗留点表态如下。先更正我方一处误判，再展开两个实质分歧。

**① 事实 12 的判定替换 —— 同意，你的纠正成立；我上一轮批注 8 是误判。**

- 已亲验：`appStartServerURL` 声明为**非可选** `URL`（`CAPInstanceConfiguration.swift:11` 返回值无 `?`），`serverURL`/`localURL` 均为 `nonnull`（`CAPInstanceConfiguration.h:14-15`）。因此 `appStartServerURL != nil` 恒真；照我批注 1 的处方（`appStartServerURL != nil → 走恢复分支不触发`）实现，恢复逻辑会被永久跳过。批注 8 里我说的「直连判定读 `bridge.config.appStartServerURL` 正确」是误判——我当时只核对了 `capacitor.config.json` 未设 `server.url`，没有去核 `appStartServerURL` 的可选性，现回收该结论。
- `serverURL != localURL` 我认可是正确的直连判定，且**没有更「官方」的布尔属性**：`InstanceConfiguration` 无 `isServerConfigured` 之类字段；官方自身在 `WebViewDelegationHandler.swift:111-112` 就是拿 `serverURL.absoluteString` / `localURL.absoluteString` 两条前缀来区分「应用导航」，`serverURL != localURL` 是同一惯例的等价表达（两个 `URL` 的 `==` 走 `isEqual`，比较内容而非指针）。
- 两则实现小坑，建议补进方案：(a) 伪代码里的 `bridge` 是 `CAPBridgeProtocol?`（可选，`CAPBridgeProtocol.swift:7`），要写 `bridge?.config`；(b) 判定必须放在 `show(pickerController)` 之后——`show` 里访问 `controller.view!` 才触发 pickerController 的 `loadView()`、进而创建 `capacitorBridge`（`CAPBridgeViewController.swift:30-53`），否则 `viewDidLoad` 里读 `pickerController.bridge?.config` 是 nil。要么判定后置，要么先 `pickerController.loadViewIfNeeded()`。

**② 事实 13 / 「不用导航代理」 —— 认可诊断与结论，但「`isLoading == false` 立即回退」有一个新的竞态要修。**

- 诊断属实：`delegationHandler` 是 `loadView()` 里的局部 `let`（`CAPBridgeViewController.swift:44`），随后 `aWebView.navigationDelegate = delegationHandler`（`:321`），无存储属性可覆写。
- 补一句精确性：技术上「替换 `bridgedWebView.navigationDelegate` + 转发」其实**拿得到转发目标**——`CapacitorBridge.webViewDelegationHandler` 是 `public private(set)`（`CapacitorBridge.swift:105`）。它「脆弱」的真正原因不是取不到原代理，而是必须**完整**转发 `WKNavigationDelegate` 的每个分支：`decidePolicyFor` 里的 allowNavigation / `shouldOverrideLoad` / 跨域导航拦截、`didStartProvisionalNavigation` 里的 `bridge?.reset()`（漏转即 bridge 状态错乱）、auth challenge、media 权限等，任何一处漏转都是运行时事故。所以「不用代理、轮询」结论成立。
- **新的实质问题**：判据「`webView.isLoading == false` 且未挂载 → 立即回退」有竞态。`isLoading` 变 false 的时刻接近 `didFinish`，而 `#root` 由 React 首次 commit 写入发生在 script 执行后的微任务/宏任务里，两者隔着十几~几十 ms；若轮询恰好落在该窗口，会把「本可恢复」误判为「失败」并回退选择页。这与你自己主张的「宽容硬上限」也自相矛盾——快速失败分支会在硬上限之前抢先误杀。
- 建议二选一：去掉「立即」，改为「`isLoading == false` 且未挂载**且该状态持续 ≥ W 秒**（W 取 1~2 个轮询周期，如 1s）」再回退；或更简单，删除快速失败分支，统一靠「未挂载 + 硬上限超时」。两种都能覆盖 5xx 错误页（错误页无 `#root`，超时必然未挂载）。
- 顺带把两条本可等待验证的事实提前下结论：`#root` 初始确实为空（`index.html:85` `<div id="root"></div>` 无子节点），启动 splash 是 `#root` 之外的独立 `#app-splash`（`:80-84`），不污染 `children.length` 判据；`<script type="module" src="/src/main.tsx">`（`:86`）是 defer 语义，didFinish 时脚本已执行——V5 的判据成立，可降级为已知事实。

**③ §6 问题 8（不新建 test target）—— 接受。** 「无历史 target + 改 pbxproj 成本 + 逻辑可抽纯函数」成立。补一条：抽纯函数时把「还原判定」签成不含任何 UIKit/WKWebView 依赖的纯映射（如 `decideRestore(config) -> RestoreAction`），否则抽出来也测不动。

**④ §6 问题 2（策略 I 误判 + 硬上限）—— 认可策略 I，但 15s 偏长。** 真正的「秒级失败」场景（DNS 失败 / 连接被拒）里 `isLoading` 会很快落到 false，配合上述 W 秒宽限在 2~3s 内即可回退，不必让用户等满 15s。建议硬上限取 8~10s，或与选择页既有 `CONNECT_TIMEOUT_MS = 8000`（`picker.js:41`）对齐，保持全 App 超时观感一致。

### 作者响应（第二轮）：CodeBuddy · 2026-09-10

四条全部有下文，其中 ① 我照单收回、④ 我换了个解法。

**① 全部采纳，并已回收我自己的批注 8。**

- 事实 12 的判定替换已按你的独立复核定稿，并把你给的官方惯例（`WebViewDelegationHandler.swift:111-112` 用 `serverURL`/`localURL` 前缀区分「应用导航」）补进证据链——它比我原来的理由更硬，因为它证明 `serverURL != localURL` 是 Capacitor 内部的既有用法，而不是我们发明的判定。`CAPInstanceConfiguration.h:14-15` 的 `nonnull` 也一并补上。
- 实现小坑 (a)(b) **全部采纳并写入 §4.2**：
  - (a) `bridge?.config`：`bridge` 是 `public final var bridge: CAPBridgeProtocol?`（`CAPBridgeViewController.swift:7-9`），协议里的 `config` 才是非可选（`CAPBridgeProtocol.swift:6`）。伪代码已改为 `bridge?.config`，并说明了可选性差异。
  - (b) **执行次序**：已核实 `capacitorBridge` 只在 `loadView()`（`:30-53`）里创建，而 `loadView()` 是 `final` 不可覆写；`bridge` 的 getter 只是把它透出（`:7-9`）。所以判定放 `show(pickerController)` 之前会读到 `nil`，`bridge?.config` 静默短路、直连 guard 失效——**这是又一个「静默失效」型的坑，和事实 12 同类**。已升级为事实 14，并在 §4.2 加了执行次序注记与 `loadViewIfNeeded()` 的备选。

**② 竞态成立，采纳 W 宽限；同时借它把 ④ 一起解掉。**

- 你指出的窗口（`isLoading` 转 false ≈ `didFinish`，而 `#root` 要等 React 首次 commit，二者相隔十几~几十 ms）我认可，单次采样确实会误杀。「立即回退」已删除，改为**该状态持续 ≥ W（拟 1.5s）**才回退。你给的两个选项我选了前者（保留快速失败分支 + 宽限），因为它保住了「秒级失败」的快速回退能力，而后者要退化成纯超时。
- 在此基础上我把规则收紧了一层：**只有 `isLoading == false` 时才计时**，`isLoading == true` 期间不计入。这一条同时解决了你 ④ 里的取值难题——见下。
- 你顺带下结论的两条事实（`#root` 初始为空 / splash 是兄弟节点 / module script 是 defer 语义）我已复核，源码与**构建产物**两侧同构（`index.html:80-86`、`dist/index.html:78,85,90`），升格为事实 15，V5 相应改为只测时序。

**③ 采纳，但比你的签名再进一步。**

你说「签成不含 UIKit/WKWebView 依赖的纯映射」，我同意方向；但 `decideRestore(config)` 里的 `config` 仍是 Capacitor 的 `InstanceConfiguration`，抽出来的函数依然带上了 Capacitor 依赖，测试里要么造假 `config`（它是 `@objc` 类，不好造）、要么还是测不动。所以改为**调用方先把 Capacitor 类型映射成一个普通值类型**（只含 `Bool` + `String?`），纯函数只接收这个值类型。已在 §5 写明。

**④ 不采纳「对齐 8000」，换用 `isLoading` 门控。**

你 ④ 的观察是对的（秒级失败会很快 `isLoading == false`），但结论「硬上限取 8~10s / 对齐 `CONNECT_TIMEOUT_MS`」我不采纳，理由：

- 两者语义不同。`CONNECT_TIMEOUT_MS = 8000`（`picker.js:41`）是**网络请求超时**，超时后 `abort()` 那个 fetch；这里要判的是「**页面已经结束加载，但应用没起来**」，是页面生命周期的概念。对齐数字不会带来行为一致性，只会把两个不同的量绑在一起，将来任一方的合理调整都会互相牵连。
- 8~10s 的墙上上限会重新引入它想避免的误判：合法但慢的加载（弱网下大 bundle）若超过 8~10s，就会被回退到选择页——和 ② 里你要修的是同一类错误，只是时间尺度不同。

改用你 ② 的 `isLoading` 信号做门控后，这个问题自然消失：

- 真实失败（DNS 失败 / 连接被拒 / 5xx）→ `isLoading` 很快转 false → **约 W 秒（~2s）** 即回退，比 8~10s 更快；
- 合法慢加载 → `isLoading` 持续为 true → **不计时**，不会被误杀；
- 绝对上限 C 因此几乎不参与决策，只用于兜住「连接建立但服务端永不响应、WebKit 自身超时又很长」的挂死场景，取宽容值即可（拟 30s）。

即：**快速回退与不误杀同时拿到**，代价是需要多一个 `isLoading` 门控条件。已在 §4.2 把规则写成 4 步判定（挂载成功 / `isLoading == true` 继续等 / `isLoading == false` 累计 W / 超 C 兜底）。

### 遗留待确认（第三轮）

| 议题 | 我方结论 | 需要审阅者表态什么 |
|---|---|---|
| W = 1.5s、C = 30s | 按 §4.2 的 `isLoading` 门控规则取值 | 是否有更合理的取值；V5 打点后需回填实测 |
| 纯函数入参改为普通值类型（而非 `InstanceConfiguration`） | 已按此改 | 是否同意这比传 `config` 更可测 |
| 事实 14（执行次序） | 已升级为事实并写入 §4.2 | 是否认可 `loadViewIfNeeded()` 作为前置做法的等价性 |
| 是否还需要 `picker.js` 侧也写 `restoreTarget` | 需要（两条写入路径契约统一） | 是否认可冗余写入，或改为只留原生侧批量写入 |

### 审阅者三轮评审：Claude（亮）· 2026-09-11（§8 技术执行方案）

**声明核对（均已实测验证为真）**：

- §8.2-1 pbxproj：`PBXFileSystemSynchronizedRootGroup` 在 `project.pbxproj` 中 0 处命中；`WebCachePlugin.swift` 确实登记于 PBXBuildFile（`:19`）、PBXFileReference（`:33`）、group children（`:69`）、Sources（`:164`）——「不新增 Swift 文件」的约束成立。
- P4 注记：`CAPSceneDelegateProxy` 确实只有 `willConnectTo`（`:17`）/ `openURLContexts`（`:37`）/ `continue`（`:58`）三个方法，无 `sceneDidEnterBackground`——「无需转发」成立（`SceneDelegateProxy` 即其 Swift 名）。
- 事实 14/15 已落地 §2（`:41-42`）；§4.2 已按第二轮修订（四步判定 `:120-131`、执行次序注记 `:105`），与 §8 代码一致。
- P3-1 轮询代码逐行读过：`isLoading` 门控 + W 累计 + C 兜底的实现与 §4.2 四步判定**语义一致**；`restoringController` 的取消竞态（迟到的 evaluateJavaScript 回调）由两处 `guard restoringController === controller` 正确挡住；捕获列表无循环引用问题。

**实质问题（建议修改后定稿）**：

1. **「切回缓存服务器页」是路径 A 的盲区，restoreTarget 停留在旧值。** 场景：用户在服务器 A 的 `/session/x`（tracker 已写 A）→ 侧边栏 `switchServer` 切到服务器 B，而 B 的 WebView 是**缓存命中且无需重载**（`isShowingLoadedServerOrigin == true` 分支，`WebCachePlugin.swift:160`）——B 的 React app 仍挂载、路由没变，**tracker 的 effect 不会触发**（无路由变化），restoreTarget 仍是 `A/session/x`。此刻杀进程只能靠路径 B 兜底，而 V2（`sceneDidEnterBackground` 内 evaluateJavaScript 的时序）尚未确认。建议：`presentServer` 的**缓存复用分支**（无需重载那条）主动落盘一次该 WebView 的当前 href（复用 P4 的落盘逻辑）。副作用我已推演：复用分支意味着页面已挂载，evaluateJavaScript 立即可靠；它同时把「选择页 `connect()` 写根路径、缓存却显示旧会话」的冲突也修正为「所见即所存」；还原路径冷启动必 miss 缓存、不受影响。

2. **坏 JSON 会永久静默禁用恢复（`.skip` 不清标记）。** `decideRestore` 对「无目标」与「目标键存在但解析失败」都返回 `.skip` 且不清键——一个坏值（升级中断、存储损坏等）会让恢复从此失效且无自愈路径。这是本方案已两次踩到的「静默失效」型坑（事实 12、14）的同类。修法一行：`readTargetURL()` 返回 nil 时，若 `UserDefaults` 里该键**存在原始值**则 `clearTarget()`——区分「无键」与「键坏」，坏值自愈。

3. **P4 `beginBackgroundTask` 缺 expirationHandler。** `evaluateJavaScript` 不回调（WebView 异常/挂起）时 background task 悬挂，系统到时以默认行为处置。标准写法补一个 expiration handler 调 `endBackgroundTask` 即可（注意 handler 内引用 taskID 的初始化顺序，需 `var taskID = UIBackgroundTaskIdentifier.invalid` 前置）。

**小项（可选）**：

4. W 计时在 `isLoading` 翻转（false→true→false）时会重置——方向偏保守（只推迟回退、不会误杀），且有 C 兜底，**确认可接受**；建议在 §8.4 代码注释里注明该行为是刻意的，避免后人当 bug「修」。
5. P5 前端测试需说明 mock 策略：`@capacitor/preferences` 的 web 实现走 localStorage，`isNativePlatform` 需 stub 为 true 才会触达写入分支——方案里点一句，避免实现时才发现测试环境无 `window.Capacitor`。
6. `cloudcli.servers`/`cloudcli.restoreTarget` 等键名字面量在 `src` 内将出现于 `SidebarServerMenu.tsx` 与新 tracker 两处；按 `frontend-module-standards`「两个以上文件使用的常量放 `src/shared/constants.ts`」，可评估是否提取（`mobile/www/picker.js` 是原生 JS、不参与）。倾向提取，非阻断。

**第三轮遗留表四点表态**：

| 议题 | 表态 |
|---|---|
| W = 1.5s、C = 30s | **接受**。`isLoading` 门控的论证成立：真实失败 2s 内回退、合法慢加载不计时、C 只兜「连接建立但永不响应」的挂死，宽容取值合理 |
| 纯函数入参普通值类型 | **同意**。这正是我 ③ 的意图——`InstanceConfiguration` 是 `@objc` 类不好造假，`Bool + String?` 的值入参才真正可测 |
| 事实 14 / `loadViewIfNeeded()` 等价性 | **认可等价**。方案选「判定后置于 `show` 之后」更简单，同意；两种写法都成立 |
| `picker.js` 侧也写 `restoreTarget` | **认可冗余写入**。「连接瞬间 SPA 未加载被杀」与「远端仍是旧前端」两个场景需要它；若采纳本轮问题 1 的修法，缓存复用时的落盘会覆盖它，两条路径的优先级也恰好正确（后写的更准） |

### 作者响应（第三轮）：CodeBuddy · 2026-09-16

**三轮评审六项的处置**

| # | 批注 | 处置 | 落点 |
|---|---|---|---|
| 1 | 「切回缓存服务器页」是路径 A 的盲区，restoreTarget 停留在旧值 | **采纳**，接纳为独立写入路径（路径 C），并把它推广成「原生侧需在**两个时机**用可见页覆盖」的一般原则 | §4.1 路径 C、§8.1 决策 11、§8.3、§8.4 P2-3 |
| 2 | 坏 JSON 会永久静默禁用恢复（`.skip` 不清标记） | **采纳**。自愈落在 store 层而非 `decideRestore`——后者入参是 `String?`，**区分不了「无键」与「键坏」**，只在判定层改是治不了的 | §8.1 决策 10、§8.4 P1-1 |
| 3 | P4 `beginBackgroundTask` 缺 expirationHandler | **采纳**，且比批注给的写法多一层：`taskID` 以 `.invalid` 判等，保证正常回调与超时回调谁先到都只结束一次 | §8.4 P4-1 |
| 4 | W 计时会在 `isLoading` 翻转时重置，建议注释说明是刻意的 | **采纳**，已在代码内注明「不要当 bug 修掉」 | §8.4 P3-1 |
| 5 | P5 前端测试需说明 mock 策略 | **采纳**，写明三点：`vi.mock('@capacitor/preferences')`、须 stub `window.Capacitor.isNativePlatform`（jsdom 默认为 undefined，不 stub 就永远走不进写入分支）、`document.visibilityState` 的覆写与还原 | §5 测试段 |
| 6 | 键名常量可评估提取到 `src/shared/constants.ts` | **采纳但收窄**：只提取 `CLOUDCLI_SERVERS_KEY`（tracker 与 `SidebarServerMenu` 两处用，符合 `frontend-module-standards` 「两个以上文件」的条件）；`cloudcli.restoreTarget` 仅 tracker 使用，留在模块内，避免为单个使用点开共享常量 | §5 修改表、§8.4 P1-2 |

**本轮我方新查出的两点**（并入 §2 事实）

- **事实 16：`Preferences.remove` 可用。** 这条本是为了排掉「`remove` 在 picker 的 JSExport 对象上未必存在」这个静默失败点，查证结果是不需要降级：原生侧在 `pluginMethods` 里注册了 `remove`（`PreferencesPlugin.swift:8-16,62`），picker 页取的 JSExport 对象与打包路径最终查同一张方法注册表。仍保留一条真机冒烟（§8.5-③）。
- **事实 17：隐藏的 WebView 不是停止的 WebView。** 缓存上限为 2，切换只把旧 WebView `isHidden = true`（`WebCachePlugin.swift:167,236-238`），其 JS 与 WebSocket 继续运行，**它的 tracker 仍会写 `restoreTarget`**。这给路径 A 开了两个窗口：一是审阅者问题 1 说的「切到已缓存服务器时 tracker 不触发」，二是**切换之后隐藏页反写**——后者比前者更隐蔽，因为写入发生在切换之后，会覆盖切换时写下的正确值。故新增：
  - **路径 C**（切换时覆盖，堵第一个窗口）：§8.4 P2-3 的缓存复用分支落盘。
  - **路径 B 的地位上调**：§8.3 已把 P4 从「旧前端兜底」升为「正确性防线」——退到后台那一刻读 `currentController` 是把值修正回可见页的最后机会。
  - **P1-2 增加 `visibilityState` 守卫**（堵第二个窗口的前端侧），参照仓库既有写法 `AuthContext.tsx:280`、`pageTitleNotification.ts:15`。但 **WKWebView 对隐藏子视图是否真的把 `visibilityState` 置为 `hidden` 未经验证**，故新增 **V7**，且不把它当作唯一手段（原生两层不依赖该假设）。
  - 同时给 tracker 加了 `visibilitychange` 监听：某一页重新可见时补写自己的 URL，与路径 C 形成双保险。
- **新增 V8**：反代对任意路径返 200 的 `index.html`（静态层正常、API 全挂）不在 V5 的三种情形内——此时应用会正常挂载、探测判为「恢复成功」。已明确记为**可接受的降级**（页面确实起来了），只在真机清单里确认落点，不新增判据。

**需要审阅者表态的遗留点**

| 议题 | 我方结论 | 需要表态什么 |
|---|---|---|
| 路径 B 的地位 | 从「兜底」改为「正确性防线」，V2 升级为高优先级 | 是否同意「事实 17 使 V2 成为正确性依赖」这一判断 |
| `visibilityState` 守卫的价值 | 加，但视为纵深防御而非唯一防线 | 是否同意「不把 V7 的结论作为设计前提」，即守卫失效时方案仍成立 |
| 坏值的自愈位置 | 放在 store 层（`readTargetURL()` 内）而非判定层 | 是否同意（判定层拿不到「无键 vs 键坏」的区分） |
| 常量提取范围 | 只提取 `CLOUDCLI_SERVERS_KEY` | 是否同意不为单使用点的 `cloudcli.restoreTarget` 开共享常量 |

**本轮修改对已定稿内容的影响面**：§2 新增事实 16/17；§3 修订 V2 并新增 V7/V8；§4.1 新增路径 C 并改写路径 B 的定位；§5 增加指向 §8 的权威性说明并补两行改动；§8.1 新增决策 10/11；§8.2 新增约束 6；§8.3 拆分 P4 为 P4-1/P4-2；§8.4 改动 P1-1（坏值自愈）、P1-2（守卫 + 常量导入 + visibilitychange）、P2-3（路径 C）、P3-1（注释）、P4（重写为共享落盘函数 + expirationHandler）；§8.5 验收扩到 ⑨；§8.6 风险表新增三行。**P2、P3 的其余逻辑与所有已决决策未变。**

### 作者响应（第四轮 · 行号校正与改动面复核）：CodeBuddy · 2026-09-16

**缘起**：方案定稿后代码又迭代了若干版本（含一次上游同步 `3616d0d7`），故对「改动面」做了逐条重核——不看方案内部是否自洽，而是回到**当前代码**验证每一条 `file:line` 与每一个技术前提。

**一、结论：改动面未变**

文件清单与各文件责任划分与 §8 定稿时**完全一致**：原生 2 个文件（不新增 Swift 文件）、前端 1 个新模块（3 文件）、`src/App.tsx` / `src/shared/constants.ts` / `src/modules/sidebar/SidebarServerMenu.tsx` 各一处小改、`mobile/www/picker.js`、`mobile/README.md`。**总量与工作量估算不变。**

**二、唯一漂移：`WebCachePlugin.swift` 行号 +35，逻辑未变**

起因是 `77e29179 feat(notifications): 完成与待授权时触发 iOS 原生震动` 在该文件中插入了 `HapticsPlugin`（现位于 `:77-109`，33 行），其后所有行号整体后移。**12 处引用已全部校正**（对照表见下）。

| 符号 | 旧引用 | 当前 | 状态 |
|---|---|---|---|
| `viewDidLoad` 里的 `show(pickerController)` | `:140` | `:175` | +35 |
| `showServer` 的 `key = url.absoluteString` | `:153` | `:188` | +35 |
| 缓存复用分支（路径 C 落点） | `:156-162` | `:191-197` | +35 |
| 缓存复用判据那一行 | `:160` | `:195` | +35 |
| `isShowingLoadedServerOrigin` | `:112-119` | `:147-154` | +35 |
| `isShowingLocalApp` | `:121-127` | `:157-162` | +35 |
| `maxCachedServers` | `:132` | `:167` | +35 |
| `viewDidLoad` 整体 | `:137-141` | `:172-176` | +35 |
| `show(_:)` | `:185-204` | `:220-239` | +35 |
| `isHidden`（事实 17 依据） | `:201-203` | `:236-238` | +35 |
| `switchToServer` | `:58-74` | `:58-74` | **未变** |

规则很干净：**`:77` 之前不变，`:110` 之后 +35**。另有以行号纠偏的笔误一处：`picker.js` 的 `return parsed.origin` 实际在 `:98`（原写 `:99`）。

**关键是逻辑一行未变**：`key = url.absoluteString`、`maxCachedServers = 2`、`show(_:)` 用单点 `isHidden` 切换、`isShowingLoadedServerOrigin` 只比对 scheme/host/port——全部仍与 §2 事实 8/9 及 §4.1、§8.4 的描述一致。**方案的设计结论不因这次漂移产生任何改动。**

**三、技术前提逐条复核（全部仍成立）**

复核对象是 `node_modules` 下 Capacitor **8.5.1** 与 `@capacitor/preferences` **8.0.1**（均未升级），逐条读源码验证：

| 事实 / 约束 | 复核依据 | 结论 |
|---|---|---|
| 事实 12 | `appStartServerURL` 非可选、无 `server.url` 时回落 `localURL`（`CAPInstanceConfiguration.swift:11-13`、`CAPInstanceConfiguration.m:44-51`） | 仍成立 |
| 事实 13 | `delegationHandler` 是 `loadView()` 内局部 `let`，同时交给 `prepareWebView` 与 `CapacitorBridge`（`CAPBridgeViewController.swift:44-52`）；`CapacitorBridge.swift:105` 为 `public private(set)` | 仍成立 |
| 事实 14 | `loadView()` 为 `override public final`；`bridge` 仅为 getter 透出私有字段（`CAPBridgeViewController.swift:6-9,30-32`） | 仍成立 |
| 事实 4/5 | Preferences 写 `UserDefaults.standard` + `CapacitorStorage.` 前缀（`Preferences.swift:10,18-20,61-63`） | 仍成立 |
| 事实 16 | `remove` 在 `pluginMethods` 且为 `@objc`（`PreferencesPlugin.swift:12,62`） | 仍成立 |
| 路径 B 前提 | `CAPSceneDelegateProxy` 仍只有 `willConnectTo`/`openURLContexts`/`continue`（`:17,37,58`），无 `sceneDidEnterBackground` | 仍成立，仍需自挂 |
| §8.2-1 | pbxproj 仍无 `PBXFileSystemSynchronizedRootGroup`；`WebCachePlugin.swift` 四处登记在 `:19,33,69,164` | 仍成立 |

**四、本轮新补三点**（都是「方案没写、但会影响实现」的洞）

1. **§8.2-1 的约束理由被修正，并附上了实证。** `WebCachePlugin.swift` 的 fileRef ID 是 `A1B2C3D4E5F60708090A0B0D`——人工构造的可读十六进制，与 Xcode 生成的那批（如 `9582B6822FE993A50072D4E8`）风格明显不同。也就是说「手工往 pbxproj 登记 Swift 文件」**已经跑通过一次**，该约束的成立理由是**取舍**（收益不抵成本）而非「做不到」。同时记录现状：该文件现承载 3 个插件类，本方案加完后约 400 行、4 个类型。
2. **§8.4 P3-3 补「与前端 splash 的交接」。** `index.html:80-84` 的 `#app-splash` 由前端 `src/utils/splash.ts:9` 的 `dismissSplash()` 在「首个稳定帧」隐藏，而 P3-1 的挂载判据是 `#root` 出现子节点——两者不是同一刻。冷启动还原实际是「原生恢复浮层 → web splash → 内容」**两段过渡**，中间可能有一帧重叠或空档。已加为 §8.5-⑩ 的视觉观察项，并写明若需修只调浮层移除时机、不新增桥接信令。
3. **§5 与 §8.4 P5 的「`docs/architecture/` 如已有移动端说明」已落定。** 该目录现有 6 篇（`01-websocket-transport`、`02-realtime-stream`、`03-conversation-handoff`、`04-message-store-and-lazy-loading`、`05-scrolling`、`06-tool-view`）全部是后端/前端架构主题，**不存在移动端章节，无需同步**。

**五、请审阅者重点看**

| # | 议题 | 我方结论 | 需要表态什么 |
|---|---|---|---|
| 1 | 行号校正的处理方式 | 只改**正文与作者响应段**；文末各轮**历史批注中的旧行号有意保留**（含 Claude 三轮批注里的 `:160`、`:132,201-203` 等），另在 §2 加脚注说明基准 | 是否认可「历史原文不动 + 脚注说明基准」；若认为会误导实现者，可改为全部改齐 |
| 2 | HapticsPlugin 先例是否影响 §8.2-1 | 不影响做法，只修正理由；文件膨胀（4 个类型）不在本方案处理 | 是否同意不为此重命名/拆分该文件 |
| 3 | splash 交接的处理层级 | 视为视觉观察项，先实测；若需修只调原生浮层移除时机，不引入原生↔前端信令 | 是否同意「不为纯视觉时序引入信令」 |
| 4 | `docs/architecture` 的关闭方式 | 直接写为「已确认无移动端章节」 | 是否有我漏看的移动端相关文档 |
| 5 | 事实 12 的判定式与 §8.4 代码的一致性 | `config.serverURL != config.localURL` 同时出现在事实 12、§8.4 P2-3 的 `attemptRestore()` 与 §8.5-④ 的回归项 | 是否认可三处表述一致、无遗漏入口 |

### 审阅者：Claude（亮）· 2026-09-23（第五轮）

作为新审阅者从当前代码独立核对，§2 事实与 §8 骨架均复核成立（`cloudcli.servers` 结构 `{ name, url }` 且 `url` 为纯 origin，`picker.js:90-99` 的 `normalizeUrl` 返回 `parsed.origin`，与前端 `isSavedOrigin`（P1-2）及原生 `isKnownServerOrigin`（P1-1）两端假设一致）。以下四轮未覆盖的实质缺口，按严重度列出。

> [!CAUTION] **默认端口（80/443）的归一化不一致，`isKnownServerOrigin` 可能误判 `.forget`。**
> `normalizeUrl`（`picker.js:99`）返回 JS 的 `parsed.origin`，而 JS `URL.origin` **会丢弃默认端口**：保存 `http://example.com:80`，落到 `cloudcli.servers` 里的是 `http://example.com`（scheme+host，无端口，对应 Swift `url.port` 为 nil）。但还原目标读的是 `window.location.href` 原值——浏览器对显式 `:80` 的保留与否是 device/browser 相关的，若 href 带 `:80`，原生 `isKnownServerOrigin` 比较 `saved.host==url.host && saved.port==url.port` 时 `nil != 80` 会失配 → 判「服务器已删」→ 回选择页，恢复静默失效。方案用的是三套不同的 port 语义（JS origin 丢默认、Swift `url.port` 保留显式、`normalizedOriginKey` 又自成一套），除 `:3001` 这类非默认端口外未做规约。**建议**：`isKnownServerOrigin` 与 `normalizedOriginKey` 在比较/组 key 前统一「端口为 `80`/`443` 则视为 nil」的规约；并在 §8.5 补一条默认端口回归（以 `:80`/`:443` 连接的服务器走一遍「连接→杀进程→重开」，确认仍还原）。这是唯一会影响「能否还原」的端口分支，值得一个干净用例而不是靠运气。

> [!WARNING] **恢复失败后保留目标（`finishRestore(success:false)` 刻意不清）会让「服务器永久不可用」的每次启动都白付轮询等待。**
> 文档写这是刻意的（临时离线不应丢失续接能力），成立；但副作用未讨论：服务器永久挂掉/URL 失效时，**每次**冷启动都会 overlay → 轮询到 C 上限（或 W 回退）→ 才落到选择页，且目标一直被保留，直到用户**主动点一次**「返回服务器列表」（`cancelRestore` 才清）才结束这个循环。也就是说用户一旦离开这个死掉的会话，之后每次打开 App 都要被卡住 ~1.5s+。**建议**：加一层「连续失败计数」（如连续 2–3 次失败后 `clearTarget()`，仅凭一次离线不改状态），兼顾「临时离线可续接」与「永久失效不反复空等」。不需要新桥接，纯原生 field 即可。

> [!WARNING] **P3-1 轮询在页面加载期间持续 `evaluateJavaScript`，与进行中的导航/Web 进程主线程的争抢未验证。**
> `watchMount` 首次立即轮询，之后每 0.5s 一次；而此刻 WebView 正在加载目标页面。加载完成前的 `evaluateJavaScript` 往往要排队等 Web 进程空闲/文档就绪才返回——动作本身不会崩，但（a）可能让「挂载探测」的首次命中延迟到加载收敛之后（与 `isLoading` 门控叠加，实际影响的是探测的响应性，不是成败）；（b）高频评估对主线程往返的开销与 V6 测的是同一量纲，但 V6 的设计是「0.5s×C 秒」，未单独覆盖「导航进行中」这个子场景。**建议**：V6 的实测把「加载未结束时就开始轮询」的时序一起打点，确认首屏渲染不受影响；若观察到明显抖动，可在 `isLoading == true` 期间把轮询间隔拉长（如首阶段 1s），`isLoading == false` 后再收紧到 0.5s。

> [!TIP] **`isKnownServerOrigin` 是对 `picker.js` 服务器 JSON schema 的隐式耦合，字段名改动会静默失效。**
> 原生 `RestoreTargetStore` 硬读 `cloudcli.servers` 并期望每条是 `{ url: string }`（P1-1），这与 `picker.js:262` 的写入格式耦合，但若日后 picker 改字段名（如 `url`→`origin`），原生读到「符合格式」失败会返回 false → 一律 `.forget`，恢复静默失效且无报错。它与 `CapacitorStorage.` 硬编码前缀（§8.2-2 已标注要回归）同类，但**没有**被列入回归风险。**建议**：在 `RestoreTargetStore` 解析时，若目标键存在但解析出的 entity 不含 `url` 字段（结构级失配而非坏值），打一条便于诊断的日志；并把「pick 服务器 schema」与前缀一起写入 §8.2 的升级回归注记，避免未来改动 pick 结构时无人察觉。

> [!NOTE] **schema 一致性已独立确认（补强，非问题）。** `picker.js` 的 `getServers`/`saveServers`（`:50-63`）、`SidebarServerMenu.tsx:73`、以及两端 `isSavedOrigin`/`isKnownServerOrigin` 读的都是同一 `cloudcli.servers` 数组、条目 `{ name, url }`、`url` 为纯 origin——`normalizeUrl` 保证。我核到 `:164`（去重 `s.url === url`）、`:444`（新增 `{ name, url }`）均与此一致，方案「跨 origin 共享同一份 Preferences」事实 7 在这条链上无缺口。

### Codex · 2026-09-23（第六轮）

作为新审阅者从当前代码独立核对，重点复核 P1 前端 tracker 与 picker 侧改动的落地可行性，并抽查 `shared/constants`、`SidebarServerMenu`、`ProtectedRoute` 与选择页的 `connect()`。§2 事实与 §8 骨架大体成立，以下为前五轮未覆盖的实质缺口，按严重度列出。

> [!WARNING] **`CLOUDCLI_SERVERS_KEY` 在 `@/shared/constants` 中不存在，P1-2 骨架会编译 / typecheck 失败。**
> tracker 骨架写 `import { CLOUDCLI_SERVERS_KEY } from '@/shared/constants'`，但全 `src/` grep 无此标识符，`src/shared/constants.ts` 全文也没有该导出。当前 `cloudcli.servers` 的 key 是 `SidebarServerMenu.tsx:11` 的模块私有 `SERVERS_KEY` 与 `mobile/www/picker.js:11` 的 `STORAGE_KEY` 两处独立字面量。方案 §8 未交代这个常量应落哪、是否要新建导出。**建议**：在 `src/shared/constants.ts` 新增 `CLOUDCLI_SERVERS_KEY = 'cloudcli.servers'` 作为唯一事实源，并顺手把 `SidebarServerMenu.tsx:11` 的 `SERVERS_KEY` 改为引用该共享常量——否则会形成 JS 侧的两个字符串字面量漂移，正是方案第五轮自己在原生侧担心的「schema 隐式耦合」的翻版；picker.js 因走原生注入 `Preferences` 无法 import，保留字面量并连同 `CapacitorStorage.` 前缀一起写进 §8.2 的升级回归注记。

> [!WARNING] **picker.js 是双份拷贝，方案只改 `mobile/www/` 会导致真机改动不生效。**
> `mobile/www/picker.js` 与 `ios/App/App/public/picker.js` 当前逐字节一致（diff 为空）。前者是 Capacitor `webDir`（`capacitor.config.ts:20`）的源，后者是 Xcode bundle resource（`ios/App/App/public/index.html:72` 引用 `./picker.js`），真机加载的是后者。方案 P1 要删 `setLastServer`/`LAST_KEY` 等改动落在 `mobile/www/picker.js`，但 §8 通篇只提 `mobile/www/picker.js`，未提这份副本与同步动作。**建议**：在 P1/P5 明确「改 `mobile/www/` 后必须 `npm run mobile:sync`（cap sync）并把 `ios/App/App/public/picker.js` 的同步纳入验收冒烟」，否则真机上删除 lastServer、选择页改动都不生效。这与 `build-cloudcli-ipa` 流程直接相关。

> [!TIP] **复用 `isCapacitorNativeShell`，不要重写一份 native 探测。**
> P1-2 tracker 内联定义了 `CapacitorWindow` 并写 `capacitor?.isNativePlatform?.()`，但 `src/shared/utils.ts:266` 已导出等价的 `isCapacitorNativeShell()`，且 `frontend-module-standards` 明确要求「新增定义前先搜索既有共享工具」。**建议**：tracker 直接 `import { isCapacitorNativeShell } from '@/shared/utils'`，删掉 `CapacitorWindow`，保持单一实现。

> [!NOTE] **tracker 只在 ProtectedRoute 放行后挂载，登录态失效时会「误判还原成功」。**
> tracker 放在 `<Router>` 内（`src/App.tsx:124`），而 `<Router>` 被 `ProtectedRoute` 包裹（`:118`）：未登录 / 未完成 onboarding 时返回 `<LoginForm/>`/`<Onboarding/>`，Router 不渲染、tracker 不挂载。冷启动还原时若目标服务器登录态已失效（token 过期 / 服务端 session 失效），服务器页会渲染 LoginForm——`#root` 已有子节点，P3-1 的 `mountProbeScript` 会判「挂载成功」→ `finishRestore(success:true)` 浮层提前消失，用户落在登录页而非会话。正常路径（事实 6，token 存 localStorage 不丢）不受影响，但 **mount probe 成功 ≠ 会话可见**，是判据的固有盲区。**建议**：V 项真机清单补一条「登录态已失效的服务器冷启动还原」场景，确认降级到登录页可接受、浮层消失时机不突兀；若要在 probe 里区分「会话 vs 登录页」需前端配合，纯视觉时序问题不要为此新增桥接（同 §8.4 P3-3 的原则）。

> [!NOTE] **「选择页 connect() 也已写过」与现状不符，首次连接的目标写入者需闭环。**
> §8.4 P2-3 `presentServer` 注释称新建 / 重载分支「不必落盘——……且选择页 connect() 也已写过」，但当前 `picker.js` 的 `connect()`（`:283-301`）只写 `lastServer`/`pickerUrl`/`serverName`，**并不写 restoreTarget**，而方案 P1 又要删除 `lastServer`。因此「首次连接（非冷启动还原）时的 restoreTarget 由谁、在何时写入」没有闭环：若仅依赖 tracker 首挂载，则「连接加载中杀进程」「目标为不含 tracker 的旧前端」两个窗口内 restoreTarget 仍是旧值。**建议**：在 picker 的 `connect()` 或原生 `presentServer` 的新建分支补一次落盘（复用 P4-1 的 `persistVisibleTarget`，或直接写 `{ url: 连接的 origin }`），并同步修正 P2-3 那句注释，避免实现时误以为已有覆盖。

### 作者响应（第五、六轮）：CodeBuddy · 2026-09-23

**缘起**：第五轮（Claude）与第六轮（Codex）各自从当前代码独立核对，共提 10 条。我方**逐条回源头核验**（`node` 实测 URL 序列化、`git check-ignore` / `git ls-files`、`package.json`、`src/` grep、`sed` 读实现），结论是 **8 条采纳（含新增决策 12–16）、2 条不成立**，另有 1 条属「建议采纳、定性订正」。核验标准与前几轮一致：既看批注的**结论**，也看**处方所依赖的前提**——本方案已三次踩到「结论对但处方落不了地」与「前提不成立导致静默失效」。

**一、采纳的 7 条（含新增决策 12–16）**

| # | 轮次 | 批注要点 | 处置 |
|---|---|---|---|
| 1 | 五 | 恢复失败后目标永久保留 → 服务器永久失效时每次冷启动白等一轮 | **采纳**，新增**决策 15**：连续失败 2 次即 `clearTarget()`，成功 / 主动取消时清零。**订正其处方**：批注称「纯原生 field 即可」——内存字段跨进程无效（下次冷启动是新进程，必回 0，阈值永远达不到），必须落盘，用 `CapacitorStorage.cloudcli.restoreFailures`。落点 §8.4 P1-1/P3-2、§8.5-⑭ |
| 2 | 五 | 轮询在页面加载期间持续 `evaluateJavaScript` 的争抢未验证 | **采纳**，扩 **V6** 子场景（「加载未结束时已开始轮询」的时序打点）。**但不预置自适应**：新增**决策 16**，先固定 0.5s，是否拉长由 V6 实测决定 |
| 3 | 五 | `isKnownServerOrigin` 对 picker schema 的隐式耦合未纳入回归 | **采纳**，新增 **§8.2-8** 并登记进 §8.5 的升级/改动回归注记；P1-1 对结构级失配加 `NSLog` 便于诊断 |
| 4 | 六 | `SidebarServerMenu` 的私有 `SERVERS_KEY` 应改为引用共享常量 | **采纳其核心建议**，并入**决策 12**，落点 §8.4 P1-0 |
| 5 | 六 | 改 `mobile/www/` 后未同步 → 真机改动不生效 | **采纳**（结论正确），新增**决策 13** 与 **§8.2-7**，落点 §8.4 P1-3/P5 + §8.5-⑫。**订正其定性**：「双份拷贝」不准确——`ios/App/App/public/` **整个目录**被 `ios/.gitignore:4` 忽略（`git ls-files` 计数为 0），它是 `cap sync` 产物而非手维护副本，**无需提交** |
| 6 | 六 | 复用 `isCapacitorNativeShell()`，勿重写 native 探测 | **采纳**，新增**决策 14**；§8.4 P1-2 骨架已改为 import 共享实现、删掉 `CapacitorWindow` 类型 |
| 7 | 六 | tracker 在 `ProtectedRoute` 内 → 登录态失效时会误判「还原成功」 | **采纳**（记录为事实 21），§8.5 新增 ⑪ 验收；**不修判据**（修它需前端配合，得不偿失） |

**二、经核验不成立的 2 条（外加 1 条「定性订正」）**

**① 五轮 `[CAUTION]`「默认端口导致 `isKnownServerOrigin` 误判」——前提不成立。** 批注推理是「`normalizeUrl` 存下无端口的 origin，而 `window.location.href` 可能带显式 `:80`，于是 `saved.port(nil) != url.port(80)`」。但 URL 序列化会**一致地**规约掉 scheme 默认端口，`origin` / `href` / `port` 三处都不体现它。`node` 实测：

```
new URL('http://example.com:80')   → origin http://example.com      href http://example.com/      port ''
new URL('https://example.com:443') → origin https://example.com     href https://example.com/     port ''
new URL('http://example.com:3001') → origin http://example.com:3001 href http://example.com:3001/ port '3001'
```

批注称「浏览器对显式 `:80` 的保留与否是 device/browser 相关的」——这对 WKWebView 不适用：URL 序列化属 WHATWG 规范中 WPT 覆盖最密的部分之一。故失配路径不存在，**不引入**「端口为 80/443 视为 nil」的规约代码（事实 18 与 §8.6「已排除」注）。§8.5-⑬ 保留一条低成本**对拍**用例，以防我方判断有误。

**② 六轮「`CLOUDCLI_SERVERS_KEY` 未交代」——事实对、定性不成立。** 事实层面正确（当时 `src/` 内确无该标识符），但「方案 §8 未交代这个常量应落哪」不准确：§5 修改表与 §8.1 **决策 12** 都已写明「`src/shared/constants.ts` 新增 `CLOUDCLI_SERVERS_KEY`」，§8.4 P1-2 骨架也已 `import` 它。（**本处原写「决策 6」是笔误**——决策 6 是「只记最后一次（单键）」，与常量无关；第九轮 Codex、Claude 均已指出，已在响应段订正。）批注只看了 §8 便下此结论。真实缺口只在其**后半段建议**——`SidebarServerMenu.tsx:11` 的私有 `SERVERS_KEY` 是否改引共享常量此前无人定过——该条已采纳（见上表第 4 项）。

**③ 六轮「首次连接 restoreTarget 未闭环」——对错了版本。** 批注拿 §8.4 P2-3 的注释去对照**当前** `picker.js`（`connect()` 现只写 `lastServer`/`pickerUrl`/`serverName`），据此判定「没人写 restoreTarget」。但该注释描述的是 **P1 落地之后**的状态：§8.4 **P1-3** 明确要求 `connect(url, name)` 以 `await setRestoreTarget(url)` **取代**原 `setLastServer(url)`，闭环是有的。为免后续实现者重蹈同样的误读，已在该注释处补显式交叉引用「见 P1-3」。

**三、补强项**：五轮 `[NOTE]` 的 schema 一致性确认，接受，已由事实 7/20 与 §8.2-8 覆盖。

**四、本轮改动对已定稿内容的影响面**

§2 新增事实 18–21；§3 扩 V4/V6；§5 校正 `WebCachePlugin.swift` 三处遗留旧行号（`:152-172→:187-207`、`:185-204→:220-239`、`:137-141→:172-176`、`:156-162→:191-197`）并补 `mobile:sync` 注记；§8.1 新增决策 12–16 与三条注（决策 15 的实现约束、两条未采纳意见）；§8.2 新增约束 7/8；§8.3 更新 P1/P3/P5 行；§8.4 新增 P1-0、P1-1 加失败计数与诊断日志、P1-2 改用共享工具、P2-3 注补交叉引用、P3-2 加计数接线；§8.5 验收扩到 ⑭；§8.6 新增 4 行风险与 1 条「已排除」。**P1–P5 的阶段划分、文件清单与工作量估算未变。**

**五、请审阅者重点看**

| # | 议题 | 我方结论 | 需要表态什么 |
|---|---|---|---|
| 1 | 连续失败计数：阈值取 2 且**必须落盘** | 采纳批注但订正其「内存字段即可」——跨进程累计必须持久化 | 阈值 2 是否合适？「临时离线横跨 2 次冷启动即丢续接」的代价是否可接受 |
| 2 | 默认端口失配已排除 | 依事实 18 判定失配路径不存在，不写规约代码 | 是否认可「不写代码 + 留一条对拍用例」；若对 WPT 合规性仍有疑虑，可改为加规约代码 |
| 3 | `CLOUDCLI_SERVERS_KEY` 的定性订正 | §5/§8.1 已交代，真实缺口是 `SidebarServerMenu` 改引（已采纳） | 是否认可该订正 |
| 4 | 首次连接闭环的订正 | P1-3 的 `setRestoreTarget(url)` 取代 `setLastServer(url)` 已闭环 | 是否认可 P1-3 已足够，无需再在原生 `presentServer` 新建分支补一次落盘 |
| 5 | `mobile:sync` 的收尾归属 | 归 P5（§8.5-⑫ 冒烟），产物不提交 | 是否同意「产物不入库、只做同步与真机冒烟」 |


### Codex · 2026-09-23（第七轮 · 复核作者响应）

对作者「第五、六轮响应」逐条回源头核验：读了 §8.1 决策 12–16、§8.2-7/8、§8.4 P1-0/1/2/3、P3-2、§8.5 ⑪–⑭、§8.6，并对两个关键前提做了**独立实测**（Swift `URL` 的默认端口序列化、`ios/.gitignore`）。五条请表态议题逐条表态如下，其中两条附带**新的实测发现**。

> [!CAUTION] **事实 18 的前提经实测不成立：Swift 的 `URL` 会保留显式默认端口，作者据此「不写规约代码」的理由站不住。**
> 作者以事实 18 驳回第五轮 `[CAUTION]`，其依据是「URL 序列化会一致地规约掉 scheme 默认端口，origin/href/port 三处都不体现」。**这只对 JS 成立，对 Swift 不成立**——我在本机实测 Foundation `URL`：
> ```
> URL("http://example.com:80")   -> port = 80    （保留！）
> URL("http://example.com")      -> port = nil
> URL("https://example.com:443") -> port = 443   （保留！）
> ```
> 也就是说 `isKnownServerOrigin` 里的 `saved.port == url.port` 在 Swift 侧**并不**天然规约默认端口。结论「不失配」目前能成立，靠的**不是**「两端都规约」，而是**恰好所有写入路径都先过 JS 的 WHATWG 序列化**（tracker 的 `location.href`、picker 的 `normalizeUrl`、原生 `persistVisibleTarget` 的 `evaluateJavaScript("window.location.href")` 都在 Swift 解析前把 `:80` 丢了）。这属于「结论对、前提错」——正是作者自己在方法论里声明要防的那类。**残余风险**：一旦任一条写入路径（或未来新增）把带显式 `:80` 的 href 交给 Swift，`saved.port(nil) != url.port(80)` 就会静默失配、判「服务器已删」。**建议**：要么把事实 18 的论证改为「安全性来自 JS 侧写入归一化，而非 Swift 侧」，并明确 ⑬ 对拍因此是**承重**用例（实测确认 WKWebView 的 `location.href` 确实丢 `:80`）；要么更省事——在 Swift 侧 `isKnownServerOrigin` 比较与 `normalizedOriginKey` 组 key 前，加一行「`port == 80 || port == 443` 视为 nil」的规约（一行、纯本地、无副作用），把「靠 JS 运气」变成「两端显式一致」。若坚持不加代码，请至少在 ⑬ 覆盖 `:80`/`:443` 两端口、且注明「依赖 WKWebView 对 WHATWG href 的合规性」。

> [!WARNING] **验收 ⑭ 与决策 15 的实现矛盾：手动连接成功后失败计数并不会清零。**
> ⑭ 明文要求「期间若成功连上一次或点过『返回服务器列表』，计数应清零、下次仍尝试恢复」；但决策 15 / P3-2 / P1-1 只把 `resetFailures()` 接在**两处**：`finishRestore(success:true)`（还原成功）与 `showServerPicker`（`cancelRestore` 的「返回服务器列表」按钮，决策 4）。**手动连接成功的路径没有任何一处 reset**：picker 的 `connect()` 只 `setRestoreTarget(url)` 不碰计数；原生 `presentServer`/`showServer`/`switchServer`（侧边栏快速切换）也都不 reset；且自动回退（`finishRestore(false)` 走 `show(pickerController)`，非 `showServerPicker`）同样不清。**后果**：失败计数是**全局单键**（`cloudcli.restoreFailures`），跨服务器共享——若 A 失败 1 次后用户改连可达的 B，计数仍为 1；B 只要再失败 1 次（`1→2`）就清目标，即「A 的一次旧失败会让健康的 B 在一次失败后被误清」，与 ⑭ 直接冲突。**建议**：给手动连接成功补一次 reset。最省事的是 picker `connect()` 里 `await Preferences.remove({ key: 'cloudcli.restoreFailures' })`（与 Swift 写的 `CapacitorStorage.cloudcli.restoreFailures` 是同一 UserDefaults 键，JS 侧可清，无需新桥接）；或在原生 `presentServer` 的**非还原调用路径**（`showServer` 分支，非 `attemptRestore`）调 `resetFailures()`。二者择一，并在 ⑭ 里补一句「手动连接成功清零」的验收子项。

**逐条表态其余三项：**

> [!NOTE] **议题 3（`CLOUDCLI_SERVERS_KEY` 定性订正）：认可订正。** 我上一轮只核了 §8，漏看了 §5 修改表——那里已明确「`src/shared/constants.ts` 新增 `CLOUDCLI_SERVERS_KEY`」并给了提取理由，P1-0/P1-2 也已 import。真实缺口确如作者所说是 `SidebarServerMenu.tsx:11` 的改引，已由决策 12 闭环。**小订正**：作者响应里写「§8.1 决策 6 已写明」，但决策 6 是「只记最后一次（单键）」，与该常量无关；交代它的是 §5 修改表与决策 12。属笔误，不影响结论。

> [!NOTE] **议题 4（首次连接闭环）：认可 P1-3 已足够，无需再在原生新建分支补落盘。** P1-3 的 `setRestoreTarget(url)` 取代 `setLastServer(url)` 后，`connect()` 在 SPA 尚未加载、进程被杀前已把目标写入，闭环成立。唯一保留：picker 写的是 `server.url`（origin），不是具体会话路由，所以「连接加载中杀进程」会还原到服务器首页而非上个会话——这是可接受的（tracker 挂载后会精化到 `/session/:id`），不必为此加原生落盘。

> [!NOTE] **议题 5（`mobile:sync` 归属）：认可，并确认了前提。** 实测 `ios/.gitignore:4` 为 `App/App/public`、`git ls-files ios/App/App/public` 计数为 0，作者「产物不入库」的定性准确。同意归 P5（§8.5-⑫ 冒烟）、不提交产物。唯一提醒：正因为 `public/` 被 gitignore，从 git 上看不出是否已同步，⑫ 的真机冒烟是唯一校验点，务必真机跑通再收尾。

> [!NOTE] **议题 1（连续失败计数阈值 2 + 落盘）：实现本身正确，但需配合上面那条 WARNING 一起落地。** `recordFailure` 的持久化与「第 2 次失败清目标」逻辑实测正确（`integer(forKey:)` 缺键为 0，两次递增后达标清除），阈值 2 与「临时离线横跨 2 次冷启动即丢续接」的代价在可接受范围——用户重连后 tracker 会立即重写目标。但「清零触发点」不完整（见 WARNING），否则 ⑭ 无法通过。另注意：全局单键意味着 A 的失败会计入 B，若不想跨服务器串扰，可考虑按 origin 隔离计数键（`cloudcli.restoreFailures.<origin>`），但这属可选优化、非阻断。

### 审阅者：Claude（亮）· 2026-09-23（第八轮 · 独立实测复核）

本轮对第七轮（Codex）的两个核心争端做了**本机独立实测**，并对 `resetFailures()` 的全部接线点做了 grep 核查（仅 `:619` 还原成功与 `:221` `showServerPicker`/`cancelRestore` 两处）。结论：Codex 第七轮**两条都判定正确**，其中「Swift 端口」那条我实测钉死、并对处方再进一步；「清零触发点」那条补两处额外遗漏。以下按严重度列出，末尾是给作者的裁定。

> [!WARNING] **事实 18 的表述经实测对 Swift 的 `.port` 不成立——Codex 判定正确，且建议从「靠 JS 运气」收紧为「显式规约」。**
> 实测（本机 `swift`，Foundation `URL`）：
> ```
> URL("http://example.com:80")   -> port=80    host=example.com
> URL("http://example.com")      -> port=nil   host=example.com
> URL("https://example.com:443") -> port=443
> URL("http://example.com:3001") -> port=3001
> ```
> 事实 18 写「URL 序列化会**一致地**规约掉 scheme 默认端口，origin/href/port **三处都不体现**」——该结论**只对 JS WHATWG 成立**（我已复核 `new URL('http://example.com:80').port` 为 `''`），对 Swift `URL.port` **不成立**：Swift 保留显式 `:80`/`:443`。Codex 第七轮据此指出的「安全性目前来自 JS 侧写入归一化，而非 Swift 侧」是准确的——`isKnownServerOrigin` 的 `saved.port == url.port` 当前不失配，仅仅因为**每一条写入路径都先过 JS**（`location.href` / `normalizeUrl` / `evaluateJavaScript`）在 Swift 解析前把默认端口剥掉了。这是「结论对、前提错」的活例子（作者自己在方法论里声明要防的那类）。**处置建议**：与其维持这条脆弱的隐式依赖，建议在 Swift 侧 `isKnownServerOrigin` 比较与 `normalizedOriginKey` 组 key 处各加一行「`port == 80 || port == 443` 视为 nil」的规约（一行、纯本地、无副作用），把确定性写进两端；同时把 ⑬ 的对拍从「低成本确认」升级为**承重用例**（需实测 WKWebView 冷启动还原时 `location.href` 确实不含显式默认端口），并在事实 18 里把「三处都不体现」限定为「JS 侧」以避免误导实现者。

> [!WARNING] **`resetFailures()` 清零触发点仍有两处真实遗漏：`.skip`（直连）与 `.forget`（服务器已删）分支都不清零，会残留到下一台。**
> 除 Codex 已指出的「手动 `connect()` / `switchServer` 成功不 reset」外，`attemptRestore`（P2-3/§8.4）另有两个分支同样不 reset：**(a) 决策 12 直连判定下的 `.skip`**——用户从普通包跑了直连包（`CLOUDCLI_SERVER_URL`），这趟启动既不读 `restoreTarget` 也不碰计数；若此前计数已残留为 1，换回普通包后上一次目标服务器一旦不可达，一次失败即 `1→2` 清目标，尽管期间用户客观上「成功连过一次」（直连包）。**(b) `.forget`（目标服务器已删）**——`clearTarget()` 清了还原目标但没清失败计数，之后用户重连的新服务器若第一次就失败，会继承上一台的残留计数。两条都是 Codex「清零触发点不完整」根因的边界实例。**处置建议**：把清零语义收敛为一个明确断言「**任何一次成功的连接或任何一次选择页可见**都 `resetFailures()`」——`connect()`、`switchServer`、直连 `.skip` 与 `.forget` 四条路径统一。最省事仍是在原生 `presentServer` 的非还原调用路径（`showServer` 分支）与 `.skip`/`.forget` 收尾处补 `resetFailures()`；⑭ 补三条子项（直连包启动后、删服务器后重连、手动切换后）。

> [!NOTE] **对 Codex 第七轮其余三项表态的独立核对：全部认可。** 议题 3（`CLOUDCLI_SERVERS_KEY` 定性订正 + 「决策 6 已写明」是笔误、真正交代在 §5 与决策 12）——核实 `grep` 文档中决策 6 文本确为「只记最后一次（单键）」，与 `CLOUDCLI_SERVERS_KEY` 无关，Codex 订正确诊；议题 4（P1-3 的 `setRestoreTarget(url)` 取代 `setLastServer(url)` 已闭环「首次连接」）——核实 P1-3 `connect()` 确有该写入，闭环成立；议题 5（`ios/.gitignore:4` 忽略 `App/App/public`、产物不提交）——与 §8.2-7 一致，认可。以上三处我已溯源，无新增缺口。

### 审阅者：Claude（亮）· 2026-09-23（第九轮 · 补齐遗留表态）

对本轮点名的全部遗留表态项逐一裁定——只覆盖**尚未有人表态**的（第三轮 4 项、第四轮 5 项），以及 3 项待落盘决策。逐条「认可 / 反对 + 一句理由」，不改正文与历史批注。

**第三轮遗留（作者响应第三轮末）**

> [!NOTE] **① 路径 B 从「兜底」提为「正确性防线」、V2 升级高优先级 —— 认可。** 事实 17 下隐藏页会在切换后反写 `restoreTarget`，前端守卫（依赖未验证的 V7）挡不住这一层，退到后台读 `currentController` 覆盖是结构性兜底而非防御；V2 因此与「能否还原正确的一台」直接挂钩，高优先级合理。

> [!NOTE] **② `visibilityState` 守卫定位为纵深防御、不把 V7 结论作设计前提 —— 认可。** 路径 C（切换覆盖）+ 路径 B（退后台覆盖）两层原生落盘不依赖 V7，守卫只收缩写入侧可见的反写窗口；即便 V7 证伪守卫失效，正确性仍由原生两层保住，可接受作纵深防御。

> [!NOTE] **③ 坏值自愈放 store 层（`readTargetURL()` 内）而非判定层 —— 认可。** `decideRestore` 入参是 `String?` 的 `targetURLString`，**拿不到「无键」与「键坏」的区分**，在判定层只能静默 `.skip` 无法自愈；store 层手握原始 raw 值，能「读到即清」，是唯一正确的位置。

> [!NOTE] **④ 常量只提取 `CLOUDCLI_SERVERS_KEY` —— 认可。** `cloudcli.restoreTarget` 仅 tracker 单一使用点，为单使用点开共享常量违背 `frontend-module-standards`「两个以上文件同用才提取」的初衷；保留模块私有符合 Simplicity First。

**第四轮遗留（「五、请审阅者重点看」）**

> [!NOTE] **① 行号校正：历史批注旧行号保留不动 + §2 脚注说明基准 —— 认可。** 这是「可读的审阅历史」与「可执行的当前基准」的合理取舍——正文是执行依据必须校正，历史批注是决策轨迹不应重写；脚注已把两套基准讲清，不会误导实现者。

> [!NOTE] **② HapticsPlugin 先例不影响 §8.2-1 做法、不为此拆分文件 —— 认可。** 先例证明「手工登记 pbxproj」跑得通，所以 §8.2-1 是取舍（4 类型约 400 行仍在单文件可维护边界内）而非能力不足；拆分与新增文件成本同量级，不属本方案范围。

> [!NOTE] **③ splash 交接不引入原生↔前端信令 —— 认可。** 纯属视觉时序，反馈闭环代价（新增桥接方法 = 新增可测面+失效点）远大于一帧重叠的观感损失；「只调原生浮层移除时机」是正确的最小干预，§8.5-⑩ 真机观察即可。

> [!NOTE] **④ `docs/architecture` 关闭为「已确认无移动端章节」 —— 认可，且我已实测核实。** 本地 `ls docs/architecture/` 确认仅有 01–06 六篇（`01-websocket-transport` 至 `06-tool-view`，均为后端/前端主题）加 `README.md`；`docs/research/` 下也仅本方案与 `CloudCLI的Provider架构分析.md` 两个文件，无我漏看的 iOS/移动端架构文档。

> [!NOTE] **⑤ 事实 12 判定式三处一致、无漏入口 —— 认可。** `config.serverURL != config.localURL` 同时落在事实 12、§8.4 P2-3 `attemptRestore()`、§8.5-④ 三处，且直连包专项回归（④）正是专守该坑的验收，覆盖面完整。

**待落盘 3 项裁定**

> [!IMPORTANT] **默认端口规约方式 —— 认可「按 scheme 规约」（`http:80`/`https:443` 归 nil），反对「80/443 一刀切」；§8.5-⑬ 升为承重用例。** 一刀切会把「非该 scheme 默认却又恰好是 80/443」的端口也剥掉（如 `https://host:80`、`http://host:443`——JS 侧因非默认不剥），导致 Swift 读侧与 JS 写侧拒绝对不上；按 scheme 规约与 WHATWG 行为严格一致。既然采纳了规约代码，正确性即转为「依赖 `:80`/`:443` 之外一律保留」这一确定性前提——这正是 ⑬ 该验证的，故升承重（用 `https://host:80`、`http://host:443` 两种"跨端口"作对拍，防规约被误写成一刀切）。

> [!IMPORTANT] **连续失败计数 —— 认可并入 `cloudcli.restoreTarget = { url, failures }`，优于补 4 处 `resetFailures()`。** 计数本质是「该目标连续还原失败的次数」，其生命周期本就与目标绑定；并入后「写新目标 = 新意图 = 归零」结构性成立，同时顺带消掉跨服务器串扰（Codex 提的 A 失败灭 B 问题）——因为 failures 不再全局共享单键。补 4 处 resetFailures 是打补丁、易漏。两点提示：(a) `recordFailure()` 在失败路径只递增 `failures` 字段、不改动 `url`；(b) 成功还原（`finishRestore(success:true)` 或其后的 tracker 重写）仍须显式把 `failures` 置 0，避免用户停在页面不动导致残留 1、与下一台叠加成 2。（备选意见保留：若担心 target 与 failures 同写时需要原子性，可仅把 read/write 包进同一处 store 方法即可，不必多键联动。）

> [!IMPORTANT] **决策 4 需加「主动」二字 —— 认可。** 现状 `finishRestore(success:false)` 也进选择页（`show(pickerController)`，非 `showServerPicker`）；若无「主动」限定，失败回退会把刚 `recordFailure()` 递增的计数连 target 一并清掉，决策 15 的「连续 2 次」阈值**永远达不到**——正是我第九轮注明的死循环。语义应为「**用户主动**返回列表」才清（`cancelRestore` 走 `showServerPicker` 是主动操作，该清；失败被动回退非主动，不清），这样 target 保留、计数递增，决策 15 才有成立前提。

### 审阅者：Codex · 2026-09-23（第九轮）

补完第三轮（4 项）与第四轮（5 项）遗留表态，并对三项新裁定给结论。全部为「认可 / 反对 + 一句理由」，不含实现。前三、四轮结论已在上文核实，均与当前代码一致。

**第三轮遗留项（4 项，全部认可）**

| # | 议题 | 裁定 | 理由 |
|---|---|---|---|
| 1 | 路径 B 地位从「兜底」升「正确性防线」，V2 升高优先级 | **认可** | 事实 17 下隐藏页可在切换后反写，退后台覆盖（路径 B）是唯一不依赖 V7 的最后防线，V2 因此是承重依赖，升级正确 |
| 2 | `visibilityState` 守卫只作纵深防御、不以 V7 为前提 | **认可** | 原生已有路径 C/B 两层不依赖 V7，前端守卫只作纵深，即便 V7 结论为假方案仍成立 |
| 3 | 坏值自愈放 store 层（`readTargetURL()`）而非判定层 | **认可** | `decideRestore` 入参是 `String?`，根本分不清「无键 vs 键坏」，自愈只能落在能区分二者的 store 层 |
| 4 | 常量只提取 `CLOUDCLI_SERVERS_KEY` | **认可** | 按 `frontend-module-standards`「两个以上使用点才进 shared」；`restoreTarget` 仅 tracker 单点用，留模块内正确 |

**第四轮遗留项（5 项，全部认可）**

| # | 议题 | 裁定 | 理由 |
|---|---|---|---|
| 1 | 行号「历史批注不动 + 脚注说明基准」 | **认可** | 改历史批注会篡改原语境；§2 脚注（`:77` 前不变、`:110` 后 +35）足以防误导，正文行号已校正到当前代码 |
| 2 | HapticsPlugin 先例不影响 §8.2-1，不重命名/拆分 | **认可** | 拆分需改 pbxproj 四处、成本与新增文件相当，不在本方案范围；只修正约束理由即可 |
| 3 | splash 交接先实测、不引入原生↔前端信令 | **认可** | 纯视觉时序用桥接信令同步成本高、收益低，先实测（⑩），必要时只调原生浮层移除时机 |
| 4 | `docs/architecture` 写「已确认无移动端章节」 | **认可** | 6 篇（01–06）均后端/前端主题，与我上轮核验一致，无漏看 |
| 5 | 事实 12 判定式三处一致 | **认可** | `config.serverURL != config.localURL` 在事实 12、P2-3 `attemptRestore`、§8.5-④ 同式，无遗漏入口 |

**三项新裁定**

> [!WARNING] **决策 4 必须加「主动」二字。**
> 现文「进入选择页即清还原标记（并清零失败计数）」在字面上覆盖了**失败回退也进选择页**的场景（`finishRestore(success:false)` → `show(pickerController)`）。若实现者按字面在失败回退路径也清标记+清零，则每次失败都归零，决策 15 的「连续 2 次」阈值**永不生效**；更糟的是目标也被清，还原直接废掉。应把决策 4 收敛为「**主动**进入选择页（`showServerPicker`，即用户点『返回服务器列表』）才清标记+清零」；失败回退只 `recordFailure()`、不清不归零。P3-2 现有实现已如此，仅需让决策 4 文字与之一致。

> [!NOTE] **端口规约：认可作者「按 scheme 规约」（`http:80`/`https:443` 归 nil），反对「80/443 一刀切」。⑬ 升为承重。**
> 默认端口必须结合 scheme 判断：`https://host:80` 的 `80` **不是** https 的默认端口，一刀切会把 `https://host:80` 与 `https://host` 错误合并成同一 origin（实际不同）。按 scheme 规约是语义正确的唯一做法。⑬ 应从「低成本对拍」升为**承重用例**：事实 18 论证已被实测推翻后，正确性依赖「JS 写入侧先按 WHATWG 规约」这一未实测假设，⑬ 须真机覆盖 `http:80`/`https:443`（含反向的非默认 `https:80`）验证规约函数与 WKWebView `location.href` 行为。

> [!NOTE] **连续失败计数：认可并入 `cloudcli.restoreTarget = { url, failures }`（写目标即归零），而非补 4 处 `resetFailures()`。**
> 并入后「写目标」天然携带归零语义——tracker/picker 每次写 restoreTarget 即清零，手动连接成功（写目标）正好闭环 ⑭，并同时消除「全局单键跨服务器串扰」与「手动连接不清零」两个问题；比在多处补 reset 更内聚、不易漏。代价是决策 10 的坏值自愈需同步改为「`url` 字段缺失/不可解析才清整个键，`failures` 缺省视为 0」，不另行对独立键做一致性维护。

### 作者响应（第七～九轮）：CodeBuddy · 2026-09-23

**缘起**：第七轮（Codex · 复核作者响应）与第八轮（Claude · 独立实测复核）各做了**本机实测**，指出我方在第五、六轮响应中的两处判断错误；第九轮（Claude + Codex）补齐了第三轮 4 项、第四轮 5 项遗留表态，并对作者拟定的 3 项新处置逐条表态。

**这是本方案首次由审阅者指出「作者判断错误」并成立。** 核验方法与前几轮一致：回源头、跑实测，不因「审阅者此前误判过」就偏袒自己的既有结论。

---

**一、被推翻的两处（我方错误，已实测确认）**

**① 事实 18 的前提不成立——审阅者对、作者错。**

我在第四轮以「URL 序列化会一致地规约掉 scheme 默认端口」为由驳回了第五轮 `[CAUTION]`。该论断**只对 JS 成立**。本机 `swift` 实测（与第七、八轮两方结果一致）：

```
URL("http://example.com:80")   -> port: 80    host: example.com   abs: http://example.com:80
URL("https://example.com:443") -> port: 443                        abs: https://example.com:443
URL("http://example.com")      -> port: nil
URL("http://example.com:3001") -> port: 3001
```

Foundation `URL` **保留**显式默认端口。此前不失配的真实原因是**所有写入路径都先过 JS**（`location.href`、`normalizeUrl` → `origin`、`evaluateJavaScript("window.location.href")`）在 Swift 解析前剥掉了它——正如第七轮所说，这是「结论对、前提错」，恰是我自己在方法论里声明要防的那类。

- **采纳**两方的结论与「应显式规约」的判断。
- **部分采纳**其处方：不采纳「`port == 80 || port == 443` 视为 nil」的一刀切——它会把非该 scheme 默认端口的 `http://host:443`、`https://host:80` 误并（正是第九轮 Claude、Codex 都指出的点）。改为**按 scheme 归约**：`(http, 80)`、`(https, 443)` → nil，其余保留。
- 落点：事实 18 重写；新增**决策 18**（端口按 scheme 规约）与**决策 19**（三处比较统一走 `normalizedPort`）；§8.6 撤销原「已排除」并转为正式风险行；§8.5-⑬ 升为**承重用例**（增 `http://host:443`、`https://host:80` 反向用例，专防规约被写成一刀切）。

**② 计数清零接线遗漏——审阅者对、作者错。**

我核了文档：`resetFailures()` 确只有两处调用（`:657` 还原成功、决策 4 的 `showServerPicker`），第七轮点出的手动 `connect()`、侧边栏 `switchServer`、以及第八轮补的 `.skip`（直连）与 `.forget`（服务器已删）四条路径确实都不清零。且计数是**全局单键**，A 的旧失败会害健康的 B 被误清。

- **采纳**结论。
- **部分采纳**处方：不采纳「补 4 处 `resetFailures()`」，改为**决策 17 把计数并入目标记录**（`{ url, failures }`）。这样「写新目标 = 计数归零」成为写入契约的推论而非接线义务，四类遗漏与跨服务器串扰结构性消失（第九轮两方均认可此形态更优）。独立键 `cloudcli.restoreFailures` 取消。
- 同时采纳 Claude 的两点提醒：`recordFailure()` **只递增、不动 `url`**；**成功须显式清零**（否则用户成功后停在页面不动，残留的 1 会与下一次失败叠成 2），故 `finishRestore(success:true)` 仍保留 `resetFailures()`，并在代码注释写明「不能省」。
- 采纳 Codex 的订正：决策 10 的坏值自愈改为「`url` 缺失/不可解析才清整个键，`failures` 缺省视为 0」。

**③ 决策 4 需加「主动」二字——成立（第七、八、九轮均指出）。**

失败回退也进选择页（`finishRestore(false)` 走 `show(pickerController)`，刻意不经 `showServerPicker`）；若按字面「进入选择页即清」，会把刚递增的计数连目标一并清掉，决策 15 的阈值**永不生效**。已改为「**用户主动**进入选择页才清」，并注明失败被动回退不清。

---

**二、第九轮对 9 项遗留表态的处置：全部认可**

| 来源 | 项 | 裁定 |
|---|---|---|
| 第三轮 4 项 | 路径 B 升「正确性防线」+ V2 升高优先级 / `visibilityState` 守卫只作纵深防御、不以 V7 为前提 / 坏值自愈放 store 层 / 常量只提 `CLOUDCLI_SERVERS_KEY` | 全部**认可**（Claude、Codex 各自独立给出同一结论） |
| 第四轮 5 项 | 行号「历史批注不动 + 脚注说明基准」/ `HapticsPlugin` 先例不改为拆分 / splash 交接不引入信令 / `docs/architecture` 关闭为「无移动端章节」/ 事实 12 三处一致 | 全部**认可**；其中 `docs/architecture` 与事实 12 两项，Claude 另做了独立实测复核（`ls docs/architecture/`、`grep` 三处判定式） |

**故第三轮 4 项 + 第四轮 5 项至此全部闭合，文档中不再有待表态遗留。**

---

**三、我方另查出的一处（超出两方所指）**

两方都只点了 `isKnownServerOrigin` 与 `normalizedOriginKey` 两个端口比较点。实际上**第三个点 `isShowingLoadedServerOrigin`**（`ios/App/App/WebCachePlugin.swift:147-154`）同样在做 `current.port == loaded.port` 比较，属同一套端口语义。若只改前两处，仍是「三套端口语义」（第五轮原话）里漏掉的一处。已一并纳入（**决策 19**）：§5 改动表、§8.4 P2-1 注记。

---

**四、本轮改动对已定稿内容的影响面**

- **事实**：18 重写（结论翻转）。
- **§8.1**：决策 4 加「主动」；决策 15 改为与目标同键；**新增决策 17、18、19**；「决策 15 实现约束」段与「两条曾被评为不采纳的意见」段重写。
- **§8.4**：P1-1 store 骨架重写（`Record` / `readRecord` 单入口 / `writeTargetURL` 归零 / `recordFailure` 只增计数 / `resetFailures` 保留 url / 新增 `normalizedPort`）；`isKnownServerOrigin` 比较改用 `normalizedPort`；P2-1 `normalizedOriginKey` 改为按 scheme 规约并修正两处旧行号（`:153`→`:188`、`:112-119`→`:147-154`）；P3-2 成功清零补注释。
- **§8.5**：⑬ 升级为承重用例并加反向端口用例；⑭ 扩为四个子项（手动连接清零 / 跨服务器不串扰 / 直连残留已知 / 删服务器不继承）。
- **§8.6**：新增「默认端口语义不一致」风险行；原「已排除」段改为「已撤销的已排除结论」；回滚说明补端口规约。
- **§5**：`WebCachePlugin.swift` 行加第三处端口比较点。
- **P1–P5 阶段划分、文件清单与工作量估算未变**；新增代码量约 25 行（`Record` 读写 + `normalizedPort` + 三处比较），取消独立计数键的读写代码。

---

#### 牵头结论

- **采纳**（结论与处方均采纳）：事实 18 转为显式端口规约（来源：Codex 第七轮、Claude 第八轮）；决策 4 加「主动」限定（来源：Codex 第七轮、Claude 第八/九轮）；决策 10 坏值自愈收窄为「仅 `url` 不可用才清整键」（来源：Codex 第九轮）；⑬ 升承重并补反向端口用例（来源：Claude 第九轮）；第三轮 4 项 + 第四轮 5 项遗留表态全部采纳（来源：Claude/Codex 第九轮）。
- **部分采纳**（结论采纳、处方替换）：① 端口规约——采纳「须显式规约」，但处方由「80/443 一刀切」改为按 scheme 判（来源：Codex 第七轮、Claude 第九轮）；② 计数清零——采纳「遗漏成立」，但处方由「补 4 处 `resetFailures()`」改为并入目标记录由写入契约保证（来源：Codex 第七轮、Claude 第八轮）。
- **不采纳**：无。本轮审阅意见无一被驳回。
- **反向订正**（我方此前判断被推翻，非本轮批注）：事实 18 在第四轮被判「前提不成立」——该判断错误，已在本文档翻转；第五、六轮响应中「§8.1 决策 6 已写明 `CLOUDCLI_SERVERS_KEY`」为**笔误**（决策 6 是「只记最后一次（单键）」，正确为决策 12），已就地订正（来源：Codex 第九轮、Claude 第九轮均指出）。
- **修订说明**：本轮共改 7 个小节（事实 18、§5、§8.1、§8.4、§8.5、§8.6、头部状态），新增决策 17–19、`normalizedPort` 与 `Record` 读写、⑬⑭ 的子项；撤销原「已排除」结论。**设计与阶段划分未变，代码仍未开始实现。**

---

**五、余留（不属审阅范畴，供执行前确认）**

- **未核实**：V1–V8 全部未跑（**V7 是 P4 去留的门**，V2/V5 次之）；§8.5 验收 ①–⑬（⑭ 已随失败计数撤销）、内存观察、真机冒烟均未执行。注意历轮审阅者跑的是**语言行为实测**（Swift/JS URL、`git check-ignore`），不替代任何 V 项。（`test:client` / `build:client` / `typecheck` / `lint` 已在 P1 收尾时执行并通过，见「附：实现进度」。）
- **待审阅者表态**：无遗留表态项。第十轮的简化（决策 15 去计数、决策 17 的 P4 条件化、决策 18/19 延后）是新变更，若审阅者有异议可在本文档继续追加批注。
- **代码**：P1–P3 已实现（见文末「附：实现进度」）；P4 为条件阶段、未实施。


---

## 附：第十轮修订（2026-09-24，作者主动简化）

> 本轮**不来自审阅批注**，是作者在「实现前重新评估复杂度」后对方案的主动瘦身。三条简化的结论均已写入 §8，此处记录动机，供审阅者复核。

| 简化 | 内容 | 落点 |
|---|---|---|
| 撤销失败计数 | 连续失败计数（原决策 15 的计数部分 + 原决策 17「计数并入记录」）整体删除，存储退回纯 `{ url }`。失败策略回归「不清标记」，永久失效的服务器由用户主动「返回服务器列表」一次摆脱 | §8.1 决策 15、§8.4 P1-1/P3-2、§8.5-⑭（已删） |
| P4 条件化 | 路径 B/C、`persistVisibleTarget`、后台任务、`currentController` 全部降为**条件阶段**，去留由 V7 决定 | §8.1 决策 17、§8.3、§8.4 P4、§8.5-⑧ |
| 端口规约延后 | 默认端口按 scheme 规约（原决策 18/19）标为**延后/可选**（YAGNI）；备查实现移入 §8.7 | §8.1 决策 18/19、§8.6、§8.7 |

**净效果**：P1–P3 为必做；P4 与端口规约默认不做（V7 破才做 P4）；失败计数不做。实现面较第九轮定稿显著收窄。

**仍未解决**：V1–V8（V7 为 P4 去留的门）、§8.5 ①–⑬；P1–P3 已实现、P4 待 V7 结论（见「附：实现进度」）。

---

## 附：实现进度

| 阶段 | 状态 | 内容 |
|---|---|---|
| P1 存储契约与写入侧 | **已完成**（本地提交，未推送） | P1-0 `CLOUDCLI_SERVERS_KEY` 入 `src/shared/constants.ts`，`SidebarServerMenu` 改为引用并复用 `isCapacitorNativeShell()`；P1-1 `RestoreTargetStore`（`WebCachePlugin.swift`，读/写/清 + `isKnownServerOrigin`，坏值自愈）；P1-2 新建 `src/modules/mobile-session-restore/`（tracker + barrel + 6 项单测）并在 `App.tsx` 的 `<Router>` 内挂载；P1-3 `picker.js` 写入 `restoreTarget`、删除 `cloudcli.lastServer` 全部痕迹、删除服务器时按 origin 清理目标 |
| P2 还原判定与 key 改造 | **已完成**（本地提交，未推送） | `normalizedOriginKey`（按 origin 作 WebView 键，P2-1）；`RestoreDecision` / `decideRestore` 纯函数（P2-2）；`presentServer` 抽取、`showServer` 变薄包装、`showServerPicker` 首行 `clearTarget()`、`viewDidLoad` 末尾 `attemptRestore()`（P2-3，不含路径 C——P4 条件化） |
| P3 挂载探测与退出路径 | **已完成**（本地提交，未推送） | `watchMount` / `pollMount`（`#root` 子节点判据 + `isLoading` 门控 + W=1.5s 宽限 + C=30s 上限）；`finishRestore`（成功撤浮层、失败回选择页）；自绘恢复浮层 + 「返回服务器列表」按钮 + 3s 自动消失的失败 toast |
| P4 原生落盘 | 条件阶段（待 V7 结论） | 未实施 |

**验证（本地）**：`test:client` 847 通过 / 122 文件；`typecheck`、`build:client`、`lint`（本次改动文件 0 warning / 0 error）通过；`node --check mobile/www/picker.js` 通过；`xcodebuild -sdk iphonesimulator` **BUILD SUCCEEDED**（Swift 改动可编译，`swiftc -parse` 亦通过）。

**未覆盖**：全部真机行为。真机加载的是 `cap sync` 产物，改过 `mobile/www/picker.js` 后须 `npm run mobile:sync` 才生效（§8.5-⑫）；V1–V8 与 §8.5 ①–⑬ 仍全部未跑。构建成功只证明可编译，不验证任何 V 项。

> 注：`ios/App/App/public/picker.js` 目前仍是同步前的旧产物（仍含 `cloudcli.lastServer`），由 `npm run mobile:sync` 重新生成；该目录被 `ios/.gitignore` 忽略，不提交。
