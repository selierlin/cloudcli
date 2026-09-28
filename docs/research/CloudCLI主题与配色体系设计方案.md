# CloudCLI 主题与配色体系设计方案

> 编写日期：2026-09-24 ｜ 修订：2026-09-25（v5：阶段 0-A / 0-B / 0-C 已实施并验收，记录见 §6）
> 状态：**已定稿并正在实施**（§8 无遗留待定项；阶段 0 已完成 0-A / 0-B / 0-C / 0-D / 0-E0 / 0-E1 / 0-E1b / 0-E2a / 0-E2b / 0-E2c / 0-E2d / 0-E2e / 0-E2f / 0-E2g / 0-E2h / 0-E2i / 0-E2j / 0-E2k / 0-E2l / 0-E2m / 0-E2n / 0-E2o / 0-E2p / 0-E2q / 0-E2r / 0-E2s / 0-E2t / 0-E2u / 0-E2v / 0-E2w / 0-E2x / 0-E2y / 0-E2z / 0-E3a / 0-E3b / 0-E3c / 0-E3d / 0-E3e / 0-E3f / 0-E3g / 0-E3h / 0-E3i / 0-E3j / 0-E3k / 0-E3l / 0-E3m / 0-E3n / 0-E3o / 0-E3p / 0-E3q / 0-E3r / 0-E3s / 0-E3t / 0-E3u / 0-E3v / 0-E3w / 0-E3x / 0-E3y / 0-E3z / 0-E4a / 0-E4b / 0-E4c / 0-E4d / 0-E4e / 0-E4f / 0-E4g / 0-E4h / 0-E4i / 0-E4j / 0-E4k / 0-E4l / 0-E4m / 0-E4n / 0-E4o / 0-E4p / 0-E4q / 0-E4r / 0-E4s / 0-E4t / 0-E4u / 0-E4v / 0-E4w / 0-E4x / 0-E4y / 0-E4z / 0-E5a / 0-E5b / 0-E5c / 0-E5d / 0-E5e / 0-E5f / 0-E5g / 0-E5h / 0-E5i / 0-E5j / 0-E5k / 0-E5l / 0-E5m / 0-E5n / 0-E5o / 0-E5p / 0-E5q / 0-E5r / 0-E5s / 0-E5t / 0-E5u / 0-E5v / 0-E5w / 0-E5x / 0-E5y / 0-E5z / 0-E6a / 0-E6b / 0-E6c / 0-E6d 一百一十五片，**阶段 0 的迁移分片已全部实施**；0-E2 暴露的护栏缺口已由 0-E2c 的守恒律闭合，0-E2d 是第一个在"双绿"门槛下通过的迁移片，0-E2e 闭合了扫描器的**覆盖面缺口**——轴限定中性色此前完全不在任何护栏视野内；0-E3i 修正了产物核对脚本的**前提假设缺口**——脚本原假设"被测文件迁移前不含 `n-*` 令牌"，随分片推进（前片已令牌化的文件被再次触碰）必然被打破；0-E6d 又暴露一处**护栏前提失效**——守恒律反空转护栏里"必须扫到 ≥1 处带透明度修饰的**字面**中性色"这条断言，随阶段 0 归零而失去可满足前提（仓库计数无论捕获组是否健在都读 0），改为对解析形状的合成名断言。截至 0-E6d：中性具名硬编码剩余 **0 处 / 0 文件**（起点 1517 / 105；阶段 0 迁移完成，仅余 1 处豁免 `border-gray-150`）。**阶段 1 已开工**：1-A（主题骨架：`ThemeManifest` + `BUILTIN_THEMES` + `<html data-theme>`）与 1-B 第一步（随 `appearance` 在 `<html>` 写 `color-scheme`，本线**第一个有意的视觉变更**）均已实施并验收；1-B2 的三个子片（删 2 行已失效的 `color-scheme: dark`、textarea 的 `color-scheme` 改为随应用外观、68 处暗色补偿改走既有令牌）也已完成；**其前置 0-F 也已实施**（Git 图 lane 色抽为 `--graph-lane-1..10` ＋ 移动端终端选区菜单 7 处色值令牌化，拆 0-F1 / 0-F2 两片），切片表与记录见 §6）；**1-C 与 1-D 也已完成**（1-C：`theme-color` 与 iOS status-bar 改由令牌派生，`ThemeContext` 里两处手写 hex 删除、两个分支合并，`ThemeManifest` 的 `themeColor` / `statusBar` 覆盖字段一并落地；1-D：新增 `themeId` 偏好键，`ThemeContext` 暴露 `themeId` / `resolvedThemeId` / `setThemeId`，跨设备"未安装该主题"的回落不再静默——**1-E 也已完成**（覆盖层机制 ＋ 两套示范主题 `cc-ocean`（`accent`）/ `cc-polar`（`full`）＋ 注册表扩充，三片各自独立 commit；修正了 §5.2 的 cascade 假设、定了 `appearance` 的两角色模型——**1-F 也已完成**（`f2e03c6f`：外观设置页的配色主题选择器 ＋ `coverage` 徽标 ＋ 跨设备未安装的回落提示，i18n 实补 en ＋ zh-CN；原计划"只补 zh-CN"的前提经实测不成立——仓库现状是 zh-CN ⊆ en——**1-G 也已完成**（`7b406986`：刷新 effect 补 `resolvedThemeId` 依赖，覆盖层的切换 / 清除都会让 xterm 重读 `--term-*`；**另两路经核查无需刷新**——编辑器的 chrome 与 highlight 全是 `var()`、Git 图是 SVG 表现属性；范围据此收窄并回写 §5.6 v10。**1-H 也已完成**（`38ef8d8e` / `13b9c696`：§5.10 对比度断言落地为 `contrast.spec.ts`，覆盖"基色 ＋ 每套覆盖层"× 明暗两态的 6 个配对；§5.11 的遍历补上反向守卫，堵住"块存在但未注册"的死 CSS——这是"遍历每套覆盖层"按构造会跳过的那一类；**并含一处有意视觉变更**——基色 `--palette-sand-500` 由 `44%` 调至 `43%`，因宽读下它只到 4.42:1、低于 AA 4.5:1，而 accent 类覆盖层不重调 substrate 会继承它。**1-I 也已完成**（`e4f5cb70`：首帧 chrome 色改为随外观——`<head>` 末尾的内联同步脚本按 `localStorage['theme']` 决定 `<html data-appearance>` / `color-scheme` / `theme-color`，splash 据此出浅色变体，消掉"深色启动画面 ＋ 白色状态栏"的同屏矛盾；**含一处有意视觉变更**——浅色外观的启动画面由深变浅；`manifest` 与 `msapplication` 的安装期静态色如实记为不可达）——**阶段 1 至此全部完成**；**阶段 2 已开工**：2-A（服务端主题目录：`server/modules/themes/` 列举 `~/.cloudcli/themes/` ＋静态只读服务，§5.8 的五道闸门全部落地；并据此改判 §5.6 v3 那句"直接复用 plugins 的 resolveAsset、不必新写目录遍历与校验"——见 §5.6 v11 与 §5.8 v3）已实施；**2-B 也已实施**：前端加载链路（清单 store ＋ 样式 store ＋ 解析并入 ＋ 选择器合并与回落提示 ＋ 启动期缓存注入），并据此改判 §5.6 框图的"首次加载走 `<link>`"——实际统一走 `fetch` ＋ `<style>`，见 §5.6 v12）；**2-C 也已实施**：选项 A 令牌编译（白名单 ＋ 值形状校验 ＋ `appearance` 作用域）＋ 文件自带 `name` / `coverage` 的读取——含一处口径裁定（文件里的 `appearance` 是"作用域"而非"角色"，§5.6 v13）与一处示例改判（`--term-*` 必须三元组，写 hex 会静默坏）；**2-D 也已实施**：设置页用户主题分区（文件列表只读 ＋ 粘贴主题的增 / 选 / 删）＋ 粘贴线（同一校验器、`paste-` 前缀、大小上限）＋ 与粘贴一同提前落地的 §5.6 强制恢复通道（`?theme=default`）——含两处裁定（`source` 采三值而非两值，§5.3 v11；恢复通道由 2-E 提前到 2-D 并取三条中的第 ③ 条，§5.6 v14）；**2-E 也已实施**：B2 的 `.tmTheme` 编译器（`src/shared/tmTheme.ts`）——plist 解析走 `DOMParser`；全局色对终端转 **HSL 三元组**、对编辑器 / 语法留 hex；`scope`→槽位是一张十行投影表（最长匹配 / 后写赢 / 未提及回落全局前景色），且语法变量名一个数字都不手写、一律经 `SYNTAX_TOKEN_MAP` 取；`fontStyle` 不携带但上报、非 hex 值丢弃并上报（§5.5 v4）。本片另核实"选项 B 的原始 CSS"早在 2-B / 2-C 就已在文件线交付（故 2-E 实际只剩 B2），并修掉一处真实隐患——语法基色表此前被**追加**到 `<head>` 末尾，而覆盖层也是追加、同权重按文档顺序定胜负，故改为插到最前（`ensureSyntaxStyleElement`）。**选项 B 的粘贴线 ＋ 高级模式 ＋ §5.10 对比度警告因此另立 2-F**；**2-F1 也已实施**：选项 B 的**粘贴**线（粘贴框收原始 CSS ＋ 高级模式开关 ＋ 信任确认 ＋ 粘贴侧的 `@import` 闸门；格式成为**存储条目自己的属性**，`compilePastedTheme` 一个函数按它分派、在"粘贴时"与"应用时"各用一次；`themePasteFormat` 成为第三个与主题相关的偏好键；并据此改判 §5.8 v5② 那句"粘贴线在构造上进不来 `@import`"——raw CSS 带得进、且粘贴前没有服务端，见 §5.8 v6）——**开工时核出 2-F 的对比度警告那一半不可与粘贴线同片落地**（选项 A 的令牌是 `var()` 可链、声明值静态算不出对比度），故 2-F 重划为 **2-F1（本片）／ 2-G（§5.10 对比度警告）／ 2-H（高级模式编辑器：语法高亮 ＋ 实时预览）**，三者都是切片边界重划、不是范围缩水；**2-G 也已实施**：§5.10 的"用户主题对比度只警告不阻断"——新增 `src/shared/userThemeContrast.ts`（`CONTRAST_PAIRS` 抽出为**单一来源**、由契约测试与用户主题警告共用；一张只放被点名令牌的**出厂基色表**，由 `contrast.spec.ts` 逐字钉住、并与算法一并"与浏览器对齐"；HSL→8 位通道→WCAG 比值的纯函数；`findContrastWarnings`），编译器把"字面三元组 / `var()` 引用"两种形状交出，`warnings` 与 `ignored` **分成两个字段**（非阻断：样式表照出），粘贴时显示在设置页、文件主题与应用时走 `console.warn`——**开工第一件事是把 §5.10 读全**（主语是校验器、不是界面；2-C 只做了形状，"非阻断警告"这一半一次都没做过）并拍板一处**契约级分叉**：未声明的那一侧以**出厂基色**为准（三条候选里 ① 对整个 accent 主题类失明、③ 只能在应用后说且 `system` 只查一半），故本文档 §5.5 自己的示例恰得 1 条警告（浅色 `--primary-foreground` 落该青绿仅 3.49:1）；另核实 2-F1 那句"`var()` 可链 ⇒ 算不出"**否掉的是阻断式预检、不是这件事本身**，故本片不构成对它的改判（详见 §5.10 v2 / §5.11 v9）；**2-H 也已实施**：高级模式的语法高亮编辑器 ＋ 实时预览——新增 `src/modules/settings/ThemeCssEditor.tsx`（CodeMirror 6 ＋ `@codemirror/lang-css`，调色板经 `SYNTAX_TOKEN_MAP` 取 `var()`）与 `hooks/useThemeCssPreview.ts`；**预览是"页面穿上草稿"而非保存**（经提交时同一个 `compilePastedTheme` 编译、注入为文档级 `<style data-cloudcli-theme-preview>`、不落库不建缓存、**刷新即消**，`?theme=default` 一并清掉）；只在高级模式且草稿非空时预览，防抖 300ms 且"上一次的结论不评价这一份草稿"；两个注入者同权重、靠**文档顺序**定胜负，故预览恒在 `<head>` 末尾且每次 apply 后重挂回末尾（由真引擎 spec 读颜色守着，jsdom 不做级联）；256KB 闸门从"加"移进"编译"使预览与提交由同一处决定——"预览渲染在哪"是开工时拍板的一处**契约级分叉**（三候选取 ①，见 §5.5 v6）——**阶段 2 的切片表至此全部实施完毕**；**2-I 也已实施**：`.tmTheme` 的可选 `cloudcli` 内嵌键——plist 顶层 `<key>cloudcli</key><dict>` 收选项 A 的 `{ tokens, appearance }` 载荷、由 `compileUserThemeTokens` 本身以 JSON 编译（一份实现、两种语法），内嵌块排 TextMate 半块之后（撞令牌时为本 app 写的键赢）、块被拒不牵连整份文件，coverage 由作者在键内自述、服务端窄式读取（与 `.json` 同一信任模型），对比度警告随之生效（`8b182f05`，见 §5.5 v7）；**2-J 也已实施**：§5.12 的 ">10 lane 参数化回退"——lane ≥ 11 走 `--graph-lane-base-hue` / `--graph-lane-hue-step` 两参数的 HSL 旋转（默认 315.3 / 95.1，搜索选出），不再回绕到 lane 1..10，前 10 条 lane 逐位不变；这是本线又一处有意视觉变更、也是**最后一处待拍板项**（随开工拍板，见 §5.12 v3）——**待拍板清单至此清空**，阶段 2 切片表（2-A..2-J）全部实施完毕；**2-K 也已实施**（`.tmTheme` 的 plist 顶层 `name` 服务端读取，2-I 边界 1 的收账，见 §5.8 v7）；**2-L 也已实施**（文件主题的可读性警告上界面，2-G 边界 1 的收账，见 §5.10 v3）；**2-M 也已实施**（令牌预览页——§6 阶段 1 的可选随附功能、文档最后一笔未做项，见 2-M 记录）——主题线全部收口。**2026-09-26 实施轮审阅（Claude 五路深审＋Pi 独立复核，见文末两节）核出：收官清账两处失实——B3 的触屏 hover 选择器账"交阶段 2 重排"从未重排入账、"阶段 2 的语义化改名"在文档多处挂账而实际阶段 2 做的是用户主题线，故"可做未做账清零 / 文档再无未实施条款"两句均不成立——另有 7 条风险发现全部经作者实证确认，作者已逐条回应并给出处置批次，见文末"作者回应（实施轮第一轮）"）；**2-N 也已实施**（预制主题 `cc-catppuccin`——Codex TUI 的默认色板 Catppuccin，暗 = Mocha、浅 = Latte；清账后由用户"参考 Codex 弄一个配色主题"的新需求驱动。开工先取证出参照物的真面目：**Codex 没有 UI 色板**，它的"主题"是纯语法主题、外壳借用终端颜色、默认按终端背景自适应 `catppuccin-mocha` / `catppuccin-latte`——故语法那半已有 `.tmTheme` 通道、本片只补外壳那半。含两处取值修正：Latte 自己的次级文字 `subtext0` 在 Latte 基色上只有 **4.37:1**、改用 `subtext1`（与 1-H 同族的"照抄参照物会被自家契约拦下"）；Mocha 的红作 `--destructive` 填充配浅字只有 2.0:1，故暗色半边保留基色 `danger-800`（有意不对称）。另**纠正本片开工前我自己的一个错判**："graph lane 不动"与 `coverage: full` 的 `MUST_MOVE` 直接冲突（`cc-polar` 其实也动了 lane），改按同色相同序、S=55%、L 取两底较差者最大重挑十色（全部 ≥3.76:1）；并**如实记一笔既有红**——`theme-chrome.spec.ts:118` 两引擎在 HEAD 上就红（期望 `#ffffff`、实得 `#f7f6f3`，成因是 1-I 改了 `index.html` 与 `FALLBACK_THEME_COLOR` 却漏同步这条断言），同时修订"theme-tokens 102 全过"的旧记录为 **102 passed / 2 failed**，见 2-N 记录）**
> 参照物：WorkBuddy（`/Applications/WorkBuddy.app`，app.asar 解包 + 本机皮肤包实物）、Codex CLI（`@openai/codex@0.155.1`，Rust 二进制字符串解析）
> 目标读者：评审 AI / 后续实施者

---

## 0. 结论先行

1. **cloudcli 现在只有"明暗模式"，没有"主题"这个概念。** `src/index.css` 有 44 个令牌，但界面样式的**主路径不是令牌**：实测 TSX/TS 中 Tailwind 具名色原子类（`bg-gray-900` 等）约 **3227 处**，反而多于语义令牌类（约 2498 处），另有终端 / 编辑器 / 语法高亮 / Git 图各自硬编码。换肤时这些面必然不跟随。
   > v2 修正：初稿"主 UI 已令牌化、绝大部分自动跟随"的判断被三方审计推翻，见 §1.2 #10 / #11 与 §1.3。
   > v5 状态：0-A / 0-B / 0-C 之后，`index.css` 共声明 **109** 个自定义属性（39 palette + 26 终端 + 44 其他）；**终端与语法高亮两条路径已令牌化**，编辑器与 Git 图仍待做。§1.2 的表已按片更新状态。
2. **两个参照物是两种哲学**：
   - **WorkBuddy = 云端皮肤包**：主题是"带元数据的云资源"（后端目录 + zip 包 + VIP 分级 + 有效期 + CDN 白名单），重，但适合商业化运营。
   - **Codex = 文件即主题**：主题是"放进目录的一个文件"（`.tmTheme`，Sublime/TextMate 标准格式），零后端，直接吃到现成主题生态。
3. **推荐采用 Codex 式模型**（文件/数据即主题），并借用 WorkBuddy 的**令牌分层**与**包契约安全约束**。理由见 §3.3。
4. 回答"新增主题/皮肤是不是更优雅的配置"：**是**。采用该模型后，新增一套主题从"改代码 + 发版"降级为"加一个文件"，且不需要后端配合。这是本方案的核心价值。
5. **落地口径已在 v3 定稿**（三方评审 + 两轮拍板，§8 无待定项）：阶段 0 按**七片文件集群**推进、以**机器可校验豁免清单**与 **DoD 三件套**（grep 清零 / 视觉基线阈值 0 / 计算值等值断言）验收；`dark:` 走**三分法**而非二选一；`--cc-syntax-N` 本轮不升语义名、只加映射快照与 denylist 护栏。首片（0-A：palette + L2 引用改写）可立即开工。

---

## 1. cloudcli 现状排查

### 1.1 已有资产（可复用）

| 资产 | 位置 | 评价 |
|---|---|---|
| 语义令牌 + 明暗两套值 | `src/index.css:45-239`（`:root` / `.dark`） | shadcn 风格 HSL 三元组，结构正确；0-A 后全部颜色类令牌已引用 palette 层，0-C 又为终端补了 `--palette-term-*` / `--term-*`（终端板只在 `:root` 声明，明暗共用同一深色板） |
| 主题上下文 | `src/shared/context/ThemeContext.tsx` | light/dark/system、`<html class="dark">`、meta theme-color、跨设备持久化 |
| 主题切换 UI | `src/shared/ui/ThemeModeSelector.tsx`（挂在外观设置页） | 三选一胶囊，可扩展为多主题选择器 |
| 语法高亮已令牌化 | `src/shared/syntaxTheme.ts` + `Markdown.tsx:182` | **亮点**：把 Prism 的 oneLight/oneDark 编译成 `--cc-syntax-N`，主题切换只是变量翻转，tokenization 不重跑。0-B 片后由 chat 与编辑器两条 markdown 路径**共用同一单例** |
| 字体令牌 | `--ui-font-family` / `--ui-font-size` / `--ui-code-font-*`；**`--term-font-family`**（终端字体，2026-09-28 追加），外观设置页已有 UI | `--ui-font-*` / `--ui-code-font-*` 与主题**正交，无需改动**；但 **`--term-font-family` 属 `--term-*` 令牌家族、与主题相关**——覆盖层主题可自行维护一个值。改判依据与三层优先级（用户设置 ＞ 主题令牌 ＞ 硬编码兜底）见《CloudCLI 终端字体动态配置方案》§3.1 / §4 |
| 外观设置页 | `src/modules/settings/tabs/AppearanceSettingsTab.tsx` | 主题选择器的天然落点 |

### 1.2 缺口（撑不起"主题"的原因）

| # | 缺口 | 证据 |
|---|---|---|
| 1 | **无 palette 层**：语义值直接写 HSL 三元组，没有原始色板可替换 | `src/index.css` 中 `--background: 44 22% 96%` 等，直接是终值 |
| 2 | **无主题扩展点**：只有 light/dark 二元，无 `data-theme`，无主题注册表 | `ThemeContext.tsx:11` 类型写死 `'light' \| 'dark' \| 'system'` |
| 3 | ~~终端完全硬编码~~ ✅ **0-C 已修复** | `useShellTerminal.ts` 曾写死 VSCode Dark+（38 处 hex），已改为 `--term-*` 令牌 + 运行期解析（见 §6 阶段 0 之 0-C 记录） |
| 4 | ~~编辑器主题来自第三方，不可调~~ ✅ **0-D 已修复** | `CodeEditorSurface.tsx:76` 曾用 `oneDark`（`@codemirror/theme-one-dark`，该包同时提供 UI 主题与语法高亮）；`editorStyles.ts:13-79` 有 **13 处** `isDarkMode ? A : B` 三元色值（v2 修正：初稿记 7 处）。已改为自建 `EditorView.theme()` + `HighlightStyle`，全部颜色走 `--editor-*` / `--cc-syntax-*`（见 §6 阶段 0 之 0-D 记录） |
| 5 | ~~语法高亮存在第二条未令牌化路径~~ ✅ **0-B 已修复** | `MarkdownCodeBlock.tsx` 曾用 `isDarkMode ? prismOneDark : prismOneLight`，绕过了 `--cc-syntax-*`；已改为与 chat 共用 `src/shared/syntaxTheme.ts` 单例（见 §6 阶段 0 之 0-B 记录） |
| 6 | ~~**Git 图颜色硬编码**~~ ✅ **0-F1 已修复** | `src/modules/git-panel/utils/commitGraph.ts:20-29` 曾把 10 个 lane 色写死为 hex 数组；已抽为 L1 `--palette-graph-1..10` ＋ L2 `--graph-lane-1..10`，`laneColor` 返回 `hsl(var(--graph-lane-N))`，`CommitHistoryItem` 里 `'#0ea5e9'` 的 lane fallback 一并去掉。§5.12 的参数化回退（>10 lane）**已由 2-J 落地**（base / step 两参数 HSL 旋转，见该节 v3） |
| 7 | ~~**零散硬编码**~~ ✅ **0-F 已修复**（品牌色除外） | `mobileTerminalSelection.ts` 的 7 处（v2 修正：初稿记 4 处）与 `git-panel/history/CommitHistoryItem.tsx` 的 `'#0ea5e9'` lane fallback 均已令牌化（0-F2 / 0-F1）。剩下的 `AgentSelectorSection.tsx` 的 5 处 agent 品牌色**保持硬编码**——§5.7 把它归入"品牌标识，不随主题变化"的豁免清单 |
| 8 | ~~**`index.css` 后半段仍有 66 处硬编码色值**~~ ✅ **1-B2 已收口** | `src/index.css` 后半段（滚动条 / checkbox / radio / textarea / placeholder 的暗色补偿）；多为 `rgb()/rgba()` 形式并带 `!important`，**不走令牌**。**前提已具备且已重审**：`<html>` 的 `color-scheme` 由 1-B 加上；1-B2 重审把锚点校正到累计 +223 偏移后的实位，得 **69 处色值声明**，并改判"不能成批删除、只能令牌化"。**已实施**：1-B2a 删掉 2 行已失效的 `color-scheme: dark`；1-B2b 把 `textarea` 的 `color-scheme: light dark` 改为继承 `<html>`（唯一有意的视觉变更）；1-B2c 把其余 **68 处**改走既有令牌（方案 A 保形间接），仅 `rgb(237 235 230)` 因无等值令牌保留字面（见 §6 的 1-B2 记录） |
| 9 | 无主题包 / 注入机制 | — |
| **10** | **Tailwind 具名色原子类不走令牌（最大缺口）** | 实测 TSX/TS 中 `bg-slate-800` / `text-zinc-400` / `prose-pre:bg-gray-900` 这类具名色原子类约 **3227 处**（中性色 1502 + 彩色系 1725），是 #8 那 66 处的**约 49 倍**，且多于语义令牌类的 2498 处。无 `dark:` 者任何主题下固定不变；有 `dark:` 者只随明暗翻转、不随主题变化。集中分布：`TaskDetailModal.tsx`、`fileIcons.ts`、`AskUserQuestionPanel.tsx`、`TaskEmptyState.tsx`、`VersionUpgradeModal.tsx`、`toolConfigs.ts` 等 |
| **11** | **`dark:` 前缀 = 明暗规则硬编码** | 上述具名色中约 **529 处**带 `dark:` 前缀（含 `dark:hover:` 等复合变体约 640 处）。它在编译期固化"暗色下用哪个色"，与"运行期改令牌换肤"结构性冲突——深色主题要让卡片从 `gray-800` 变 `slate-900`，这些组件不接受接管 |

> 注：各 harness 的 Logo（`ClaudeLogo.tsx` / `PiLogo.tsx` / `DshLogo.tsx`）与 agent 品牌色属于**品牌标识**，不应随主题变化，建议保留硬编码并显式标注为例外。

### 1.3 规模

- `src/` 下只有 **1 个 CSS 文件**（`src/index.css`，v5 时 1236 行）——样式绝大多数以 Tailwind 原子类写在 TSX 中。**v2 修正**：初稿把这一点判定为"只要令牌层设计到位，绝大部分 UI 自动跟随"，审计后不成立。原子类的色值分两类：走令牌的语义类（`bg-background` 等，约 2498 处）与**不走令牌的具名色类**（`bg-gray-900` 等，约 3227 处）。后者才是大头，且 `dark:` 前缀进一步把明暗规则写死（§1.2 #10 / #11）。
- `index.css` 现声明 **109** 个自定义属性（0-A / 0-C 后：39 palette + 26 终端 + 44 其他）；`src/` 中被 `var()` 引用到的唯一变量 78 个，其余是主题覆盖面（见附录 A）。
- `index.css` 后半段沉淀了 **66 处 `rgb()/rgba()` 硬编码**（滚动条、checkbox/radio、textarea、placeholder 的暗色补偿，见 §1.2 #8）。**审计时必须同时匹配 `rgb()/rgba()`，只看 hex 会漏掉全部 66 处。**
- **令牌值格式不止 HSL 三元组**：还有 HSL+alpha（`--nav-glass-bg: 44 22% 96% / 0.7`）与尺寸类（`calc()` / `env()`）。任何"令牌白名单校验器"必须按令牌逐一定制值格式规则，不能按单一格式校验。

---

## 2. 参照物 A：WorkBuddy「外观主题」（云端皮肤包）

### 2.1 资源模型

主题不是枚举，而是**带元数据的资源**：

| 字段 | 取值 | 说明 |
|---|---|---|
| `kind` | `theme` / `color` | 整套皮肤 / 只换配色 |
| `appearance` | `light` / `dark` / `system` | 主题自身的明暗归属 |
| `series` | `craft` / `collection` / `coop` | 主题系列（分栏展示） |
| `vipLevel` | free / pro / advanced / ultimate | 商业化分级 |
| `validity_type` | `permanent` / `limited` + `valid_from`/`valid_to` | 限时皮肤 |
| 资源 | `cover_url` / `preview_url` / `zip_url` | 封面 / 预览 / 主题包 |

接口：`operation-platform/appearance/resources`（目录）+ `user-asset/appearance/get|set`（用户选择），选择结果 24h 同步。

特性开关 `ProductFeature.EnableAppearance`（`main/common.js:1722`）默认关闭，由发行版下发。

### 2.2 令牌体系：三层 + 三命名空间

- **三层**：`--wb-palette-*`（原始色板，brand-8 = `#00C29A`）→ `--wb-color-*` / `--wb-*`（语义）→ 组件级（button/icon/status/sidebar）
- **三命名空间并存**：`--wb-*`（产品语义）、`--cb-*`（agent-ui 组件，经 bridge 层别名到 wb）、`--vscode-*`（编辑器/IDE 集成）
- light 默认落 `:root`；dark 由 `data-theme=dark` / `.dark` / `.cb-dark` / `.vscode-dark` / `body[data-vscode-theme-name="IDE Night"]` 覆盖

### 2.3 皮肤包契约（实物验证）

本机 `~/.workbuddy/appearance-resources/<resourceKey>-<updatedAt>/` 已有真实皮肤（张韶涵主题皮肤-v11，skin.css 1408 行 / 681 变量；激战金秋-龙狮城 v10，62KB）。契约要点：

1. zip 内**单个 CSS**（约定名 `skin.css`）+ `assets/` 资源目录
2. 只写覆盖值，**全部 `!important`**
3. 选择器需**穷举所有 light/dark 标记**
4. **变量覆盖 + 选择器补丁两层**：纯变量不够，组件级硬编码要用 `.notifications-panel {...}`、`[class*=mainArea] ...` 这类补丁对抗特异性
5. 图片走相对 `url()`，注入前重写为 `local-file://` 绝对 URL（扩展名白名单）
6. 工作流是"从源模板 remap/retune"，注释记录取色来源与改动计数（`modified: 313/569`）
7. 安全：zip bomb 防护（≤20MB / ≤500 条目）、路径穿越校验、CDN 主域白名单

### 2.4 代价评估

该模型为商业化运营而生（分级、限时、审核、下架、遥测）。对 cloudcli 这种**自托管开源**项目，直接照搬会引入一整套后端目录服务、CDN 白名单与包安全加固——**收益不匹配成本**。值得借鉴的是它的**令牌分层**与**契约安全约束**，不是它的分发链路。

---

## 3. 参照物 B：Codex CLI 主题（文件即主题）★ 主参考

### 3.1 机制（解包证据）

二进制 `/…/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex`（229MB，Mach-O）中提取到：

```
$CODEX_HOME/themes/                                          ← 自定义主题目录
Custom .tmTheme files can be added to the  … directory.       ← 文档说明
Theme "X" not found. Using the default theme.
  To use a custom theme, place a .tmTheme file at $CODEX_HOME/themes/
Custom theme "X" at <path> could not be loaded (invalid .tmTheme format).
  Falling back to the default theme.
Theme "X" not recognized; using default theme
```

- 主题模块：`tui/src/theme/mod.rs`
- 依赖 `syntect-5.3.0` + `two-face-0.5.1`：**直接用 Sublime/TextMate 的 `.tmTheme` 格式**，语法高亮与主题共用同一体系
- 内置主题来自库，实测字符串中包含：Catppuccin（Latte/Frappe/Macchiato/Mocha）、Dracula、Monokai Extended（含 Bright/Light/Origin）、Nord、Solarized (dark/light)、base16-ocean/eighties/mocha、gruvbox、OneHalf、TwoDark、Sublime Snazzy、InspiredGitHub、1337、Zenburn 等
- 失败策略明确：**目录里找不到 / 格式非法 → 回落默认主题，并给出可操作的提示**

### 3.2 与 cloudcli 的形态相似性

Codex 的 TUI 同样不是"一个 CSS 文件能搞定一切"的界面，它有 markdown、diff、streaming、status card、picker 等多种渲染面（源文件路径可见 `tui/src/markdown.rs`、`tui/src/status/card.rs`、`tui/src/streaming/code_fence.rs` 等）。它用**一套标准主题格式贯穿所有渲染面**，这正是 cloudcli 缺的那一环。

### 3.3 为什么 Codex 式更优雅

| 维度 | WorkBuddy 云端皮肤包 | Codex 文件即主题 |
|---|---|---|
| 新增一套主题 | 上传后端 → 审核 → 上架 → 客户端下发 | **把文件放进目录** |
| 是否需要后端 | 是（目录接口 / VIP / 有效期 / CDN） | **否** |
| 格式 | 私有 `skin.css` 契约 | **标准 `.tmTheme`**（Sublime/TextMate） |
| 生态复用 | 无 | **直接吃现成主题库** |
| 内置主题来源 | 运营驱动，数量少 | **库自带几十套** |
| 安全面 | zip 解压 / 路径穿越 / CDN 白名单 | 本地文件，攻击面小 |
| 失效处理 | 有效期 / 下架 / `invalid_resources` | 文件在即有效 |
| 适合场景 | 商业化、分级、运营 | **开源工具、自托管** |

结论：对 cloudcli，**"主题 = 一个文件/一段数据"** 才是优雅解。WorkBuddy 的分发链路可作为未来可选的"远程主题源"扩展，不进核心。

---

## 4. 设计目标与原则

**目标**

1. 新增主题（内置或用户自定义）**不需要修改任何组件代码**
2. 主题可**增量覆盖**：只改 3 个变量就能得到一套"换强调色"的主题
3. 主题切换后**全站一致**——"一致"定义为**结构性一致**（所有渲染面都从令牌取色、无硬编码旁路），**不是内容性一致**（不要求每套主题都覆盖每一个面）。增量主题（只改 `--primary`）不会动终端 / 编辑器 / Git 图，这是预期行为；主题选择器上须以 badge 标注覆盖范围（`coverage: accent | full`），避免用户预期错位
4. 与现有 light/dark/system、字体设置、`--cc-syntax-*` 机制**兼容共存**
5. 不引入后端依赖

**非目标（明确不做）**

- 不做主题商店 / 账号体系 / VIP 分级 / 限时皮肤
- 不做主题的可视化编辑器
- 不引入 Tailwind 之外的 CSS 框架或运行时 CSS-in-JS
- 不改变现有令牌的**语义命名**（避免大面积重构 Tailwind 配置）
- **不对 Tailwind 具名色原子类做全量语义化**（约 3227 处）：阶段 0 只收口**中性色系**中的界面骨架部分，彩色系 / 状态色 / 图标色按语义豁免并标注理由（见 §5.7）

---

## 5. 设计方案

### 5.1 令牌分层

```
L1 palette（原始色板，新增）
  --palette-gray-1 … --palette-brand-8 …
        ↓ 被引用
L2 semantic（现有，保持命名不变）
  --background / --foreground / --primary / --card / --border / --ring /
  --nav-* / --cc-syntax-N / 新增 --term-* / --editor-* / --graph-*
        ↓ 被引用
L3 component（Tailwind 原子类 + 少量组件内样式）
  bg-background / text-muted-foreground / border-border …
```

**关键性质**：主题只需覆盖 L1 或 L2，L3 自动跟随。这就是"增量换肤"的机制基础。

L2 是**主题契约面**：约定一组令牌即构成一个可换肤的完整主题；未覆盖的令牌自动继承 base。

> **v2 补充（这是初稿最大的技术空洞）**：L1 必须在**定义上**被 L2 引用，否则"覆盖 L1 即可换肤"是假的——现状 L2 全是直接写终值（`--background: 44 22% 96%`），新增的 `--palette-*` 无人引用，覆盖它不会改变任何 UI。因此阶段 0 的 palette 层改造包含**两步**：
>
> 1. 定义 L1（新增色板）；
> 2. **把 L2 的值改写为引用 L1**。对 HSL 语义令牌，采用通道拆分：`--primary: 175 84% var(--palette-brand-light-4)`（hue / sat 保持字面、lightness 走 L1），或在需要整色替换时直接 `--primary: var(--palette-brand-8)`——后者若 L1 存 hex，需同步调整 Tailwind 消费方式（当前 `index.css` 有 16 处 `hsl(var(--x))` 包裹）。
>
> **v4（0-A 已实施）——选整色引用，且消费端零改动**：上面那句"整色引用需调整消费方式"**只在 L1 存 hex 时成立**。实施把 L1 也定义为 **HSL 三元组**（与 L2 同格式），于是 `hsl(var(--primary))` 的解析路径完全不变，Tailwind 配置与 16 处 `hsl(var(--x))` **一行未动**；带 alpha 的导航令牌写成 `var(--palette-x) / 0.7` 同样等值。未采用通道拆分，因为它会让 palette 退化为"亮度档位"（hue/sat 仍是字面值），无法整组换色——palette 的换色能力正是本层的存在理由。实测见 §6 阶段 0-A 记录。
>
> **范围界定**（避免与 §4 非目标"不改变语义命名"冲突）：命名不变，只改**值的来源**。对无法自然拆分通道的令牌（`--nav-*` 的 HSL+alpha、尺寸类），L1 可暂不覆盖、保持字面值。`coverage: accent` 类增量主题通过覆盖 L2 实现；`coverage: full` 类主题可选择同时覆盖 L1 与 L2。
>
> **L1 的定位必须写进主题开发文档**：它是"内置主题的组织约定 + 完整主题的换色入口"，**不是所有主题的唯一入口**——否则主题作者会误以为改 L1 就能生效。
>
> **v9（1-E 已实施）——"最小增量主题"的最短路径落在 L1 上，与上文"accent 类覆盖 L2"相左**：上一段的"`coverage: accent` 类增量主题通过覆盖 L2 实现"被实施结果修正。示范主题 `cc-ocean` 只声明了 **L1 的两个值**（`--palette-brand-500` / `--palette-brand-400`），一个 L2 令牌都没写——因为 L2 的强调色令牌本来就是 L1 的引用（`--primary: var(--palette-brand-500)`），而 `--ring`、`--nav-tab-glow`、`--nav-input-focus-ring` 全部经由同一个 brand 族解析，于是**覆盖 L1 一处、四个强调面在两个外观下同时移动**。若按字面覆盖 L2，需要写四条、还要各补一个 `.dark` 分支，且会**绕过 palette**（触犯契约测试的"no colour token holds a literal value outside the palette"）。故本线的实际分工是：**`accent` 主题 = 覆盖 L1 的一个色族；`full` 主题 = 覆盖 L1 的多个色族**。L2 仍是主题契约面（主题完全可以覆盖它，用户主题尤甚），只是"最小增量主题"的最短路径落在 L1 上。

> **v10（2-N 已实施）——预制主题从两套增到三套，并记一处"照抄参照物会被自家契约拦下"的取值修正。** 新增 `cc-catppuccin`（`appearance: system`、`source: builtin`、`coverage: full`），即 Codex TUI 默认色板 Catppuccin（暗 = Mocha、浅 = Latte）。它是**第一个把两个外观都映射到某个外部色板的具体 flavour** 的覆盖层（`cc-ocean` 只动 brand 族、`cc-polar` 是自选的冷调），因此也是第一个会撞上 §5.11 对比度契约的"外来色板"：Latte 自己的次级文字 `subtext0`（`#6c6f85`）在 Latte 基色上只有 **4.37:1**，低于 AA —— 与 1-H 的 `--palette-sand-500` 44%→43% 是同一类账，处置也一样（改用 `subtext1`，5.53:1），只是这次的**成因不是基色不达标、而是参照物本身不达标**。详见 §6 阶段 2 的 2-N 记录。

> **v11（2-O 已实施）——预制主题增至四套；`full` 覆盖层第一次动到"标签色"这一档 L1。** 新增 `cc-islands`（`appearance: system`、`source: builtin`、`coverage: full`），即 IntelliJ IDEA 的 Islands Dark / Islands Light。它与 2-N 的形态差别值得记下：Codex **没有**外壳色板（只有语法主题），所以 2-N 是"借"；Islands 随包发行一整套 329/330 条的分层色板（`layer-0/1/2` ＋ `text-*` ＋ `accent-*`），所以本片是"**译**"——`ui` 的默认键 `*` 把背景绑在 `tool-window-bg`（= `layer-0-bg`）上，这一条就定下了 `--background` 的落点。取值上第一次出现"**参照物的顶层在 cloudcli 里不可移动**"：Islands Light 的编辑器/弹窗页是纯白，而纯白即 `--palette-white`（被 `--n-white` 共用、属 `fixed` 组），且 `MUST_MOVE.full` 又要求 `--editor-bg` 必须动 —— 两条约束不可能同时成立，取后者（照 `cc-polar` / `cc-catppuccin` 的先例，编辑器页取基材色）。另有一处**新形态的 L1 移动**：`--palette-frost-50`（`--primary-foreground` / `--destructive-foreground` 唯一的来源）第一次被主题改动 —— 理由不是审美而是 §5.11 的硬约束，Islands 的按钮蓝 `#3871E1` 配出厂那档偏白标签只有 4.34:1。详见 §6 阶段 2 的 2-O 记录，其中还如实记了一处**既有护栏的覆盖面缺口**（浅色半整块没写 `:not(.dark)` 的主题会被泄漏守卫整体跳过）。

### 5.2 主题选择器：`data-theme` 与 `.dark` 双轨共存

现状 `<html class="dark">` 需要保留（Tailwind `darkMode: ["class"]`、大量 `dark:` 原子类依赖它）。方案：

```html
<html data-theme="cc-ocean" class="dark">
```

- **`class="dark"`** 继续表示"暗色基底"，驱动现有 `dark:` 原子类与 base 语义值 → 由主题的 `appearance` 字段决定
- **`data-theme="<id>"`** 选择主题的覆盖层，优先级高于基底：

```css
/* base（现有，不动） */
:root { --background: 44 22% 96%; … }
.dark { --background: 0 0% 8%; … }

/* 主题覆盖层（新增，可只写需要改的） */
[data-theme="cc-ocean"] {
  --palette-brand-8: #0f766e;
  --primary: 175 84% 32%;
  --ring: 175 84% 32%;
}
[data-theme="cc-ocean"].dark {
  --palette-brand-8: #2dd4bf;
  --primary: 172 66% 50%;
}
```

`appearance: system` 时主题不绑定明暗，跟随明暗胶囊在 `data-theme` 的两个分支间切换。**（v9：上面那段示例 CSS 只是机制示意，不是 1-E 的落地形态——实际的 `cc-ocean` 只写 L1 的两行，不写 `--primary` / `--ring`；理由见 §5.1 v9。）**

**必须写明的硬约束（否则双轨方案不成立）**：现状 `:root` / `.dark` 全部位于 `@layer base` 内（`src/index.css:45`、`:207`）。CSS Cascade Layers 中 layered 样式恒低于任何 **unlayered** 样式——因此**主题覆盖层必须是普通 CSS，严禁放进任何 `@layer`**。满足此约束时 `[data-theme="x"]` 稳定压过 `@layer base` 内的 base 值，**完全不依赖文件加载顺序**，并顺带消解 §7"`data-theme` 与 `dark:` 原子类叠加优先级困惑"的一半。

> **v9（1-E 已实施）——一处实测修正：处理后没有 `@layer`，这条约束改判为"健壮性约定"**。硬约束段落里"现状 `:root` / `.dark` 全部位于 `@layer base` 内"是**源文件**的事实，但**处理后的样式表里没有任何 `@layer`**——Tailwind v3 把源文件的 `@layer base` 展平成了普通规则。实测（fixture 与构建产物两条路径）：fixture 探针读回 `sheets: 1, rules: 2034, layers: []`，产物 CSS 命中 `@layer` at-rule **0** 次。因此覆盖层今天**靠文档顺序取胜**（它排在文件末尾），不是靠"layered 恒低于 unlayered"。
>
> 这一发现不推翻那条约束，而是**改判它的性质**：它从"取胜的机制"降为"在会发出真 layer 的管线下的健壮性约定"——覆盖层一旦被包进 `@layer`，就会被排进那个 layer 的桶里，胜负取决于 layer 顺序（只有 unlayered 才压过全部 layer）。故它由覆盖层测试**结构性**强制（`layerDepthAt` 花括号匹配出 `@layer` 包围层数，要求每个 `[data-theme]` 块都为 0），**不指望 resolved 值能证明它**。反面证据：把覆盖层临时包进 `@layer base` 后，六条浏览器断言**全绿**——这正是"仅凭值断言抓不到它"的证明，也是为什么这条要单独做成结构断言。

### 5.3 主题数据模型

```ts
// 放在 src/shared/types.ts（两个以上文件使用）
/** 一套主题的元数据；由内置注册表或用户主题清单产生，供主题选择器与 ThemeContext 消费。 */
export type ThemeManifest = {
  /** 唯一 id，同时作为 <html data-theme> 的值；用户主题从文件名派生并做 sanitize。 */
  id: string;
  /** 展示名（选择器与 aria-label 使用）。 */
  name: string;
  /**
   * 两个角色（v9）：'light' / 'dark' 是**外观默认**（基底 `:root` / `.dark` 的别名，
   * 选择器不提供）；'system' 是**覆盖层主题**（跟随明暗胶囊，选择器提供的那一类）。
   * "没有覆盖层"由 `themeId === null` 表达，不是第三个取值。
   * 决定 <html class="dark"> 与 color-scheme 的始终是用户选的明暗，与主题 id 正交。
   */
  appearance: 'light' | 'dark' | 'system';
  /**
   * 来源（v11 起三个取值）：`builtin` 随包内置、不可删；`user` 是主机 `~/.cloudcli/themes`
   * 里的文件（只读、不同步，删它得改那个目录）；`user-paste` 是设置页粘贴进来的，
   * 存在用户偏好里（**是它的唯一副本**，UI 必须能删）。设置页按此分区展示。
   */
  source: 'builtin' | 'user' | 'user-paste';
  /** 可选：作者与描述，用户主题在 UI 中展示。 */
  author?: string;
  description?: string;
  /** 可选：覆盖范围。accent=只改强调色；full=完整覆盖（含终端/编辑器/Git 图）。选择器上以此显示 badge，呼应 §4 目标 3 的"结构性一致"。 */
  coverage?: 'accent' | 'full';
  /** 可选：是否允许用户在其基础上再自定义强调色（为"主题 + 个人强调色"双层定制留口）。默认 false。 */
  supportsAccentOverride?: boolean;
  /** 可选：首帧自愈哨兵类名，用于"加载成功但内容有害"的判定（见 §5.6）。 */
  sentinelClass?: string;
};
```

**注意**：`ThemeManifest` 是"元数据"，**不含色值**。色值只有两个来源——内置主题的 CSS 文件，或用户主题文件/内容。这样元数据可枚举、可校验，色值不受约束。

> **v9（1-E 已实施，两处模型收敛）**：
>
> **一、`appearance` 的两个角色别混用**（上文代码注释已按此修正）。`light` / `dark` 是**外观默认**：`ThemeContext` 在没选主题时往 `data-theme` 写的 id，也就是基底 `:root` / `.dark` 的别名，注册表里是 `cc-light` / `cc-dark`。`system` 是**覆盖层主题**：选择器真正提供给用户的那一类（`cc-ocean` / `cc-polar`）。"没有覆盖层"这件事由 `themeId === null` 表达，**不是** `appearance` 的第三个取值。覆盖层测试因此用 `appearance === 'system'` 筛出"要遍历的覆盖层主题"；而"外观默认不带覆盖层"由另一条断言反向钉住（`the accent theme is the identity when no overlay is picked`：对 `cc-light` / `cc-dark` 分别设置 `data-theme` 后，令牌必须与基底逐位相同）——若日后有人给默认别名加了 `[data-theme]` 规则，它会红。**这同时回答了 1-D 留下的模型问题**（§5.6 v8 边界一）：既然 `cc-light` / `cc-dark` 是外观默认而非可选覆盖层，它们就不该出现在选择器里，"显式选了默认别名再切胶囊"这个场景根本不会发生，那一问随之消解。
>
> **二、`:not(.dark)` 不是风格选择，是构造上的防漏**。一套主题若其值随外观不同（编辑器 chrome 是**唯一**一处——它的基底是"外观专属字面量"而非 L1 引用），浅色那一半必须写成 `[data-theme="x"]:not(.dark)`，**不能**写成裸 `[data-theme="x"]`。裸选择器在暗色下也命中，只会因特异性输给 `.dark` 块——于是**两半都重复的令牌**照常解析正确、其他断言也看不见问题；但**只在浅色半声明、忘了写进暗色半**的令牌会静默地把浅色值带进暗色。`:not(.dark)` 让这种遗漏在构造上不可能发生。测试里有一条专门钉它：既要求"确实存在浅色限定的块"（否则反空转失败——最初的裸选择器变异正是**全绿**通过，促成这条补强），又要求"浅色半独有的令牌在暗色下回落到基底值"。

> **v10（1-F 已实施）——`coverage` 有了消费者，并带出一条选中态的不变量**。`ThemeSelector` 把 `coverage` 渲染成每项右侧的徽标（`accent` → 强调色 / `full` → 完整），这就是 §4 目标 3"结构性一致"的 UI 落点：徽标是**承诺**，覆盖层契约测试按令牌逐条核对，两边说的是同一件事。**未声明 `coverage` 的条目不渲染徽标**（不为它编一个默认值）——内置主题都有，这条是为将来的用户主题留的：一个不说自己改多少的主题，选择器就不替它宣称。
>
> **选中态的不变量**：选择器判断"哪一项被选中"时**必须先过一遍"是不是覆盖层 id"**，不能直接拿 `themeId` 去比。因为 `setThemeId` 接受任意字符串，而 `cc-light` / `cc-dark` 这两个**默认别名**是合法输入（1-D 记录里的边界一）——不过滤的话该状态下**没有任何一项被标记**，界面读起来像"什么都没选"。过滤后别名归到「默认」项，与实际生效的配色一致（别名本就无覆盖层）。
>
> 反过来说清一件**不必**证明的事：把选中态改从 `resolvedThemeId` 推导，在当前注册表下**每个可达状态都标记同一项**（已安装的覆盖层解析回自身；其余一律解析到无覆盖层的外观默认），故这是一个**行为等价的实现选择**，测试有意不去钉它（钉了也是空转）。真正需要两个 id 同时用到的是回落提示（见 §5.6 v9）。

> **v11（2-D 已实施）——`source` 从两个取值扩到三个，这是 §5.4 v3 那条"设置页须按 `source` 区分展示"兑现的前提。**
>
> **为什么非加不可**：v3 说"文件主题"与"粘贴主题"是两条存储线，前者只读、内容不跨设备，后者存偏好、内容跨设备，"设置页须按 `ThemeManifest.source` 区分展示"。可 `source` 当时只有 `builtin` / `user` 两个取值，而 `user` 已经被"来自主机主题目录的文件"占用了——**照 v3 的字面去实现，模型上根本分不出粘贴主题**。另两条读法都被否：① 用 id 前缀判定（`user-` / `paste-`）——那"来源"就成了从 id 字符串反推的东西，而 `source` 正是为此存在的字段，等于把它架空；② 给粘贴主题也标 `user`、另开一个布尔位——那是在一个已经指名道姓"来源"的字段旁边再放一个同义字段，两处会各自漂移。
>
> **裁定**：`source` 取三个值 `'builtin' | 'user' | 'user-paste'`。判据是**这个字段问的是"它从哪来"，而来源确实有三种**，且三种在"这台设备上有没有它"与"UI 能不能删它"这两问上给出三种不同答案（内置：有、不能删；文件：本机可能有、不能从 UI 删；粘贴：一定由偏好而来、必须能删）。一个字段承载三种互不等价的答案，就不是两值字段能表达的了。
>
> **一处刻意的不对称**：`appearance` 那个同名的坑在 2-C 已裁定为"文件里的 `appearance` 是作用域不是角色"（§5.6 v13），而 `source` 这里**没有**类似的二次解释——它就是来源本身。`userThemeManifest(id, name, source, coverage)` 的 `source` 由调用方按数据来路传入（列表中继 `'user'`，偏好里的条目传 `'user-paste'`）。

### 5.4 三种主题来源与优先级

| 来源 | 载体 | 生效方式 | 阶段 |
|---|---|---|---|
| 内置主题 | 仓库内 CSS 文件（随构建产物打包） | Vite 静态 import 或独立 `<link>` | 1 |
| 用户主题（文件） | 服务器主机 `~/.cloudcli/themes/<id>.{css,json,tmTheme}` | 由服务端列目录 + 静态提供，前端统一 `fetch` 取文本后 `<style>` 注入（2-B 改判，见 §5.6 v12） | 2 |
| 用户主题（粘贴） | 设置页文本框内容 | 存于用户偏好（选项 A 的令牌 JSON，与文件走**同一套校验器**），注入 `<style>` | **2（2-D 已实施）** |

优先级：用户主题 > 内置主题 > base（light/dark）。

### 5.5 用户主题格式：三种选项

**选项 A：令牌 JSON（约束式，推荐作为默认）**

```json
{
  "name": "深海",
  "appearance": "light",
  "coverage": "accent",
  "tokens": {
    "--primary": "175 84% 32%",
    "--ring": "175 84% 32%",
    "--term-background": "210 45% 8%"
  }
}
```

- 优点：**可校验**（白名单令牌、值格式），无法写选择器 → 不可能破坏布局，也不可能用 `url()` 外联
- 缺点：只能改已令牌化的东西
- 实现：读取后**校验并编译**成 `[data-theme="x"]{ --a: b; … }` 注入；`name` / `coverage` 由服务端列举时读出，`appearance` 限定这套规则只在某一外观下生效

> **v3（2-C 已实施）——三处落定，其中一处是本示例自己的 bug：**
>
> **一、`appearance` 在这里是"限定作用的外观"，不是 §5.3 那个"角色"。** 两个问题共用一个名字，必须分清：`ThemeManifest.appearance` 是**角色**（`light` / `dark` = 外观默认、不进选择器；`system` = 覆盖层、进选择器），而文件里的 `appearance` 是**作用域**（这套规则写给哪个外观）。用户主题永远是覆盖层，角色恒为 `system`，所以作用域由**编译期**处理：`light` → `[data-theme="x"]:not(.dark)`、`dark` → `[data-theme="x"].dark`、`system` 或缺省 → 裸 `[data-theme="x"]`（＝`.css` 主题今天的行为）。这条读法是两处文档相左时的裁定，取舍与另两种读法见 §5.6 v13。
>
> **二、`--term-background` 原示例值写的是 hex，那是错的。** `--term-*` 由 `readTerminalTheme` 以 `hsl(var(--term-…))` 解析（`src/modules/shell/utils/terminalTheme.ts:60`），所以 `#0b1220` 会编译成 `hsl(#0b1220)`、被浏览器丢弃，终端**静默**保留上一个颜色。正确写法是三元组（示例已改为 `210 45% 8%`）。2-C 的校验器按同一判据把这种形状**丢弃并上报**，于是这类错误从"静默无效果"变成"控制台说得出哪一条令牌错了"。**判据与 §5.9 那两条消费者判据同源**：色值最终交给 `hsl(...)` 解析的令牌收三元组，交给 `EditorView.theme()` 之类直接写规则的收完整表达式。
>
> **三、`coverage` 现在读得到，`name` 也是。** 服务端列举 `.json` 时读它自带的 `name` 与 `coverage`（`readDeclaredMetadata`）；未声明则回落文件名、不画徽标（§5.8 v4）。

**选项 B：原始 CSS（自由式，作为进阶）**

```css
[data-theme="my-theme"] {
  --primary: 175 84% 32%;
}
[class*=toolbar] { background: #123 !important; }
```

- 优点：与 WorkBuddy/Codex 能力对齐，能补组件级硬编码
- 缺点：可写任意选择器与 `url()`（自托管场景下风险可接受，但仍应提示"主题来自你信任的来源"）
- 约束（借 WorkBuddy 契约）：单文件、文件名 sanitize、大小上限、不允许 `@import`

**选项 B2：标准 `.tmTheme`（Sublime / TextMate，选项 B 的官方变体）**

```xml
<plist version="1.0"><dict>
  <key>name</key><string>Dracula</string>
  <key>settings</key><array>
    <dict><key>settings</key><dict>
      <key>background</key><string>#282a36</string>
      <key>foreground</key><string>#f8f8f2</string>
      <key>caret</key><string>#f8f8f0</string>
    </dict></dict>
    <dict><key>scope</key><string>keyword</string>
      <key>settings</key><dict><key>foreground</key><string>#ff79c6</string></dict></dict>
    …
  </array>
</dict></plist>
```

- **为什么必须有它**：§3.3 把"直接吃现成主题库（`.tmTheme`）"列为 Codex 式模型的核心理由；若用户拿到 Dracula / Nord / Catppuccin 官方 `.tmTheme` 却无法使用，"文件放进目录即生效"的承诺对生态内主题不成立，方案自相矛盾。
- **实现**：tmTheme 是 plist XML，结构简单（`settings` 数组，首元素为全局 `background/foreground/caret/selection/lineHighlight`，其余为 `scope` + `foreground/fontStyle`）。前端做轻量解析后映射到 `--cc-syntax-*` / `--editor-*` / `--term-*` 一族令牌——这与本方案"把第三方主题编译成变量"的既有思路（`src/shared/syntaxTheme.ts` 从 Prism 主题编译）**同构**，可复用同一套编译与测试路径。
- **边界**：`.tmTheme` 只管色、不提供布局令牌，因此编译产物只覆盖语法 / 终端 / 编辑器子集；主 UI 令牌需由可选的内嵌扩展键（`cloudcli` 键）或同名 `.css` 补足。

> **v4（2-E 已实施）——B2 已落地为 `src/shared/tmTheme.ts`；上面那条"边界"里的"同名 `.css` 补足"经核实走不通，改判。四件事：编译要做的两次翻译、scope 映射的规则、它到底能覆盖什么、以及 `fontStyle`。**
>
> **一、两次翻译都是"值形状"问题，与 §5.9 同源。**
>
> ① `--term-*` 由 `readTerminalTheme` 以 `hsl(var(--term-…))` 解析，所以全局色必须转成 **HSL 三元组**再写进去；直接写 hex 会编译成 `hsl(#282a36)`、被浏览器丢弃、终端静默保留上一个颜色——这正是 §5.5 v3 记在选项 A 示例上的那个 bug，同一个坑在 B2 上重演一次。编辑器与语法令牌相反：它们被当成**完整值**消费，hex 原样保留（连 alpha 一起，那属主题作者的表达）。alpha 只在终端侧丢掉，因为三元组没有它的位置。
>
> ② 语法槽的**变量名是编号**，而编号由 `buildSyntaxTheme` 遍历两张 Prism 主题时遇到差异的先后顺序决定。这里一个数字都不手写，全部经 `SYNTAX_TOKEN_MAP` 取（§5.9 已把"名字 ↔ 编号的绑定只存在一处"立成规矩）；于是 Prism bump 重排编号时编译产物跟着走，不会把主题绑死在旧编号上。这一条的取舍见 §5.9 v9。
>
> **二、scope → 槽位是一张十行的表，不是白名单。** TextMate 的 scope 有几十上百个，本 app 只消费十个语义槽。规则：scope 选择器**等于某模式或是它的点分子孙**（`keyword.control` 归 `keyword`）；多个模式命中时**取最长**（`constant.numeric` 归 `number` 而非 `constant`）；同一槽位**后写的规则赢**（TextMate 的同类）；`scope` 里的逗号列表逐个匹配。没有任何规则提到的槽位**回落全局前景色**而不是保留基色——TextMate 里没提到的 scope 就是前景色，留着基色会让一个文件里混进两套配色。表里没有的 scope **不报**：这是刻意的十槽投影而非白名单，落到表外是常态，逐条报会把控制台变成噪音。
>
> **三、它到底覆盖什么（改判上一条"边界"）**：`cloudcli` 内嵌扩展键**本片未做**；而"同名 `.css` 补足"这条**不可能成立**——服务端按 id 去重（`Nord.tmTheme` 与 `nord.css` 同为 `user-nord`），同名的两个文件只有一个会被列出（2-A 第 5 条决策），所以"`.tmTheme` 管色 ＋ 同名 `.css` 管布局"这种组合在当前设计下拿不到。于是 `.tmTheme` 单独存在时就是一套**局部主题**：语法 / 编辑器 / 终端随它变，主 UI 留在基色。`coverage` 因此不声明，选择器不画徽标（§5.8 v4 的"知道什么说什么"）。要主 UI 也变就写 `.css`——它会取代同名的 `.tmTheme`。这是**如实边界，不是遗漏**；唯一还没做的补足途径是那个可选的 `cloudcli` 内嵌键，与 §5.12 同列为待定项。**（2-I 已结清：内嵌键落地、coverage 可声明，见 §5.5 v7；"同名 `.css` 补足不可能成立"的改判维持不变。）**
>
> **四、`fontStyle` 不携带。** 语法的粗体 / 斜体在本 app 没有承载它的令牌（`--cc-syntax-*` 是颜色），所以声明 `fontStyle` 的主题会丢掉这部分——但在 `ignored` 里**报一行**，因为静默丢字体样式会被读成编译器 bug。
>
> **五、解析用 `DOMParser`，不手写 plist 解析器。** 该格式就是 XML，浏览器已经有引擎；自己写要重新实现实体处理、自闭合标签与 CDATA，收益为零。非 plist（含畸形 XML）一律拒绝并给出 `unreadable-plist`，与"是个 plist 但一条可用颜色都没有（`nothing-usable`）"分开——前者是拒绝、后者是丢。

**推荐**：默认走 A；设置页提供"高级模式"开关切到 B（原始 CSS，带语法高亮编辑器 + 实时预览）；B2 与 B 同档，按文件扩展名自动分派。三种格式共用同一套加载 / 生效链路，差异只在"解析 / 校验函数"。

> **v2 说明（§8.1 的结论）**：审阅中对"默认 A 还是默认 B"有分歧——Pi 主张默认 CSS 编辑器（目标用户是开发者，写 CSS 零门槛）；Claude / DSH 的证据链指向 A 的安全性（A 只能写白名单令牌，天然免疫"加载成功但破坏 UI"）。**本方案维持默认 A**：cloudcli 是自托管服务，主题会被分享 / 跨设备同步，A 的"不可能破坏布局"是可验证的护栏；同时把切到 B 的成本降到最低（一个开关 + 一次信任确认），并允许用户在设置中把"默认打开模式"改为 B。

> **v5（2-F1 已实施）——选项 B 的粘贴线已可用。四件事：格式是条目的属性、两条格式的闸门不同、css 粘贴写什么选择器、以及"提问 ≠ 决定"。**
>
> **一、一个粘贴的格式记在条目自己身上。** 文件主题的格式在扩展名里（列举时读到），而粘贴没有文件名；故 `PastedUserTheme.format` 记下它，`compilePastedTheme` 是唯一按它分派的函数，在"粘贴时"（决定收不收）与"应用时"（重新编译存储的文本）各用一次。旧条目（无 `format`）读作 `json`——这不是猜测，是它唯一可能的值；未知格式丢自己、不丢列表（同 `readEntry` 对未知文件格式的处理）。
>
> **二、选项 A 与选项 B 的闸门不同，因为它们能逃逸的方式不同。** 选项 A 走上 `compileUserThemeTokens`（白名单 ＋ 值形状，`unsafe-value` 整份拒绝，产物是纯声明块）；选项 B **原样注入**，一份带 `@import` 的样式表会拉进服务端从未审过的规则——粘贴前面没有服务端，故这道闸门在粘贴侧另设（`IMPORT_RULE_PATTERN`，**与服务端同一个模式**）。除 256KB ＋ `@import` 两条外，css 粘贴的内容不被校验——这正是开关所警告的：页面可能读不出、点不动，逃生口是 §5.6 的 `?theme=default`。改判见 §5.8 v6。
>
> **三、css 粘贴不必写出主题名。** 它没有文件名，粘贴框无从告诉作者该写哪个 `[data-theme="…"]`；而这条规则只在**主题被选中时**才在文档里，所以 `:root` 与 `.dark` 直接可用——`:root` 压过基色的 `:root`，靠的是**文档顺序**（覆盖层追加到 `<head>`）。设置页的 `mode.cssNote` 把这条写给作者。
>
> **四、提问不等于决定。** 把"默认打开模式"改到 B 就是一次信任确认：它是与存储格式**分开**的一份状态（`confirmingCss`），确认才写偏好；若不分开，一次刷新就会静默套用用户没确认过的格式——§5.5 v2 说的"一个开关 + 一次信任确认"由此落到代码。切回 A 不是提问、立即生效。模式偏好 `themePasteFormat` 的读法**单向宽松**（非 `css` 一律读作 `json`）：不认识的值，安全的那一种是正确答案。

> **v6（2-H 已实施）——高级模式有了编辑器与实时预览。六件事：预览是什么、它在哪一半、防抖里"上一次的结论"算什么、两个注入者共处一文档、它的风险与逃生门、以及编辑器为什么是薄的一层。**
>
> **一、预览是"页面穿上草稿"，不是保存。** 设置页把草稿交给**提交时用的同一个编译函数**（`compilePastedTheme`），把结果注入为文档级覆盖层 `<style data-cloudcli-theme-preview>`：打字时看到的就是提交后会得到的。它既不落库也不建缓存——预览只活在文档里，**刷新即消**，这是它比"先提交再改回来"更安全的地方。
>
> **二、它只在高级模式，且只在草稿非空时。** 上面那句推荐行把"带语法高亮编辑器 ＋ 实时预览"写在切到 B 的括号里，本片照此只对原始 CSS 生效：选项 A 的令牌 JSON 仍是纯 `textarea`、不预览。只有空白的草稿同样不预览——空白不是样式表，把它放上页面只会白白清掉已选主题。
>
> **三、防抖 300ms，且"上一次的结论不评价这一份草稿"。** 逐字编译并重绘整页会让输入变重，半写完的规则也很少是作者想看的；但防抖期间**不能**拿上一份草稿的结论（尤其"无法预览：…"）去描述当前这一份——那会让人去改一处并没有问题的文本。故每个结论带上它所属的那份草稿，不一致时报 idle。已被接受的草稿在下一份到来之前**保持显示**（不在暂停的间隙闪回旧主题）。
>
> **四、两个注入者共处一个文档，顺序即语义。** 预览与已应用主题都是 `<style>`、同权重，谁在文档后面谁赢（与 §5.2 的覆盖层同一条判据）。预览因此永远被放到 `<head>` 末尾，且**每次应用主题之后都会被重新挂回末尾**——否则一次 apply 就会把预览埋在下面，预览会"时灵时不灵"。两个元素用**不同属性**标记（`data-cloudcli-theme-preview` / `data-cloudcli-user-theme`），各自的移除都不会带走另一个。这条顺序约定由 §5.11 的浏览器断言守着（真引擎里读颜色，jsdom 不做级联）。
>
> **五、风险与逃生门都写清楚。** 预览能把页面弄坏——这与"原始 CSS 原样注入"是同一件已接受的设定（v5 第二条），预览只是把它提前到编辑时；它比提交多一条逃生路径：**刷新即消**。§5.6 的强制通道（`?theme=default`）也把它一并清掉——一条逃生门必须能逃开正在显示的东西。另：256KB 的尺寸闸门自本片起**落在 `compilePastedTheme` 里**（原先只在 `addPastedTheme`），这样"预览看到的"与"提交得到的"由同一处决定，预览不会演示一份提交时会被拒的文本。
>
> **六、编辑器是薄的一层。** 设置页没有复用 code-editor 模块的文件编辑表面（它带路径、脏标记、保存这些**文档**概念，与设置框里的一个草稿无关），而是另建了一个只认 CSS 的编辑表面；两者共享的是**调色板**——经 `SYNTAX_TOKEN_MAP` 取色，与文件编辑器同一套语法令牌，色值全是 `var()`、随主题重绘而无需重建扩展（同 §5.6 v10 的性质）。
>
> **v7（2-I 已实施）——`cloudcli` 内嵌扩展键落地，`.tmTheme` 不再只能是局部主题。** 上一版记过：`coverage` 因此不声明、选择器不画徽标，唯一没做的补足途径就是这个键。本版把它定下，共五条：
>
> **一、键的形状逐字镜像选项 A。** plist 顶层 `<key>cloudcli</key><dict>` 里放 `tokens`（令牌名 → 字符串值的 `<dict>`）与可选 `appearance`（`light` / `dark` / `system`，缺省 `system`）——就是一个 `.json` 主题的 `{ tokens, appearance }` 换了种语法写。`coverage` 也在这个键里声明（见第四条）；键内其它名字不予理会（与 `.json` 顶层未知键同待遇）。
>
> **二、它由选项 A 的编译器亲自编译，绝无第二份实现。** 编译器把读出的 dict 以 JSON 交回 `compileUserThemeTokens`——白名单、值形状、`unsafe-value` 整块拒绝、`appearance` 作用域与 §5.10 对比度警告**全部只有一份**，plist 因此不可能与同内容的 `.json` 漂移。产物是第二个 `[data-theme]` 块，**排在 TextMate 半块之后**：两块同权重、由文档顺序定胜负（§5.2 的老规矩），而为本 app 写的键是更刻意的那句话，故当内嵌令牌与 TextMate 全局色落到同一个令牌（如 `--term-background`）时内嵌块赢。每条上报都带 `cloudcli.` 前缀，控制台里不会与 TextMate 半边的丢弃混读。
>
> **三、内嵌块被拒，拒的是块、不是文件。** 编译器的裁决只及于交给它的载荷：`unsafe-value` 丢整个内嵌块并点名令牌，`no-tokens` / `nothing-usable` 丢块并说明原因，TextMate 半边按自己的规则受审、照常成立。`nothing-usable` 的判据随之从"语法半块为空"放宽为"**两块皆空**"——一份只有 `cloudcli` 键有颜色的 `.tmTheme` 是合法的。
>
> **四、`coverage` 由作者在键内自述、服务端读取，与 `.json` 同一信任模型。** `.json` 的徽标从不校验"声明 full 的文件真覆盖了全部"，只转述作者的话；`.tmTheme` 现在也能说这句话——服务端在 `readDeclaredMetadata` 里对 `tmTheme` 窄式读取（文件里第一处 `<key>coverage</key>` 后随的 `<string>`，仍只认 `accent` / `full`，未知值告警、不画徽标）。plist 的 `name` **仍不读**：显示名留在文件名，那是另一笔可做未做的账，不在本片。**（2-K 已结清：`name` 自此由同一条通道读出、显示名不再留在文件名，coverage 的读取射程也收窄到键内，见 §5.8 v7。）**
>
> **五、对比度警告随之生效。** 内嵌令牌就是选项 A 令牌，§5.10 对它的每句话都成立：`TmThemeCompileResult` 自此带 `warnings`，`.tmTheme` 与 `.json` 走同一条 `warnContrast` 通道（文件主题照旧只到控制台）。§5.10 v2 决策 11 那句"`.tmTheme` 一律带空 warnings"自本片起**只对无内嵌键的文件成立**——有键则按键内令牌判。

### 5.6 加载与生效链路（含首帧防闪烁）

```
启动
 ├─ 同步读取本地偏好（localStorage + 服务端偏好镜像，沿用现有机制）
 ├─ 解析出 { themeId, resolvedAppearance }
 ├─ 立即在首帧前设置 <html data-theme=… class=…> 与 color-scheme、meta theme-color
 │   （现有 ThemeContext 已是同步首帧，需保持该性质）
 ├─ 用户主题：先用 localStorage 缓存的 CSS 内容同步注入 <style>（首帧不闪）
 │   └─ 后台拉取 /api/themes/<id>.css?v=<mtime> 校验是否有更新
 │        · 有更新 → 热替换并更新缓存
 │        · 失败 / 文件消失 → 回落默认 + 告警，清缓存
 └─ 首次加载（无缓存）：<link rel="stylesheet" href="/api/themes/<id>.css?v=<mtime>">
     · onload 后把内容缓存进 localStorage
     · 加载失败 → 回落默认主题 + 控制台告警（对齐 Codex 的失败策略）
     · 切换主题时：先加新 <link>，onload 后再移除旧的，避免闪白
```

要点：

- **内置主题**可在构建期打包，避免运行期请求
- **用户主题**必须走运行期注入，且要处理"加载中 / 失败"两态
- 现有 `ThemeContext` 对 `<html>` 的 class 与 meta 操作（`ThemeContext.tsx:67-95`）需扩展为同时维护 `data-theme` 与 `color-scheme`
- **首帧防闪烁靠缓存，不靠 `<link>` 时序**（v2 修正）：`<link>` 是异步的，首帧必然先按 base 渲染再闪变，与"同步首帧"要求矛盾。解法是**缓存上次成功加载的主题内容**（或编译后的令牌 JSON）到 localStorage，下次启动同步注入 `<style>`，再在后台校验更新——这正是 WorkBuddy `applyCachedCssSync` 的机制。
- **`color-scheme` 必须显式设置**（v2 新增）：在 `<html>` 上随 `appearance` 写 `color-scheme: light|dark`，浏览器据此自动渲染原生滚动条、checkbox / radio、`<input>`、`<textarea>` 与 `::placeholder`，使 §1.2 #8 的 66 处暗色补偿大部分可删（现状这些补偿正是在手写模拟 `color-scheme`）。**执行顺序：先加 `color-scheme`，再重审 66 处是否仍需保留**，避免先令牌化一堆本可删除的补偿。
- **JS 消费者需要主动刷新**（v2 新增）：CSS 变量变化不触发任何事件，xterm 的 `ITheme` 不支持 `var()`，CodeMirror 的 `EditorView.theme()` 在扩展创建时求值。因此主题切换后必须显式重读——xterm 走 `getComputedStyle(document.documentElement)` 重读 `--term-*` 后重设 `terminal.options.theme`；CodeMirror 走 compartment reconfigure。Git 图无此问题：`CommitGraphStrip.tsx` 是 SVG，`stroke` 可直接写 `var(--graph-lane-N)`。
- **"加载成功但破坏 UI"必须有恢复通道**（v2 新增）：失败回落只覆盖"文件缺失 / 格式非法"，覆盖不了选项 B 的 `body{display:none}` / `font-size:0` / `visibility:hidden` 这类**合法但有害**的 CSS——此时用户连切回默认主题的入口都看不到。必须提供强制恢复通道（三选一）：① 全局快捷键（如 `Ctrl/Cmd+Shift+Alt+R` 重置主题）；② 启动参数 / 环境变量 `CLOUDCLI_RESET_THEME=1`；③ URL 查询参数 `?theme=default`。建议**再加**一道自愈哨兵：注入主题 CSS 后 300ms 内若 `<html>` 未出现该主题预设的 `sentinelClass`，判定异常、自动回落并告警。选项 A 因只能写白名单令牌而天然免疫，这一点应在设置页"高级模式"开关处以文案明示。**（2-D 已实施：三条通道中落地第 ③ 条，理由与边界见下方 v14；"自愈哨兵"未做，`sentinelClass` 仍是预留字段。）**
- **用户主题 URL 必须带版本参数**（v2 新增，v3 补注）：`/api/themes/<id>.css` 若无 `?v=`，浏览器 / 中间层会缓存旧文件——用户改了 `~/.cloudcli/themes/` 里的文件、刷新后看不到变化，与阶段 2 验收冲突。服务端列目录时返回每文件 mtime（或内容 hash），前端拼 `?v=<mtime>`。服务端实现**直接复用 `server/modules/plugins/plugins.routes.ts:26` 的 `/:name/assets/*` + `resolveAsset` 模式**（已含路径安全 + 扩展名约束），不必新写目录遍历与校验。**v3 补注**：该模式已发 `Content-Type` 与 `Cache-Control: no-store, no-cache, must-revalidate`（`plugins.routes.ts:29-30`），因此浏览器侧本就无缓存，`?v=` 属"兜住中间层 / 代理缓存 + 便于排障"的加固而非硬性必需——若复用该模式就顺手保留。**（"直接复用该模式"这个前提经 2-A 实测不成立，见下方 v11；v3 补注里"该模式已发 `Cache-Control`"与"`?v=` 属加固而非必需"两条仍然成立并被 2-A 沿用。）**
- **"文件主题"与"粘贴主题"是两条存储线**（v3 新增）：前者在服务端目录（只读、随部署卷走、**内容不跨设备同步**），后者存用户偏好（**内容跨设备同步**）。二者的删除、失效、跨设备语义均不同，设置页须按 `ThemeManifest.source` 区分展示，文档写明。**（2-D 已实施：`source` 为此从两个取值扩到三个，见 §5.3 v11；两条线各自的解析与删除语义见 §5.6 v14。）**
- **跨设备同步的边界**（v2 新增）：偏好镜像会把 `themeId` 同步到未安装该主题文件的设备，届时应**显式提示"此设备缺少该主题，已回落默认"**而非静默回落。另注意现状怪癖：`setTheme('system')` 不写偏好（`ThemeContext.tsx:113-121`，仅 light/dark 才 `writeUserPreference`），新增 `themeId` 键时需决定 `system` 分支是否同样豁免，避免把本机临时态覆盖成跨设备永久态。

> **v7（1-C 追加）**：上面的启动链路写着"立即在首帧前设置 … `meta theme-color`"，**当前实现并非如此**——`ThemeContext` 的写入在 effect 里，首帧前生效的是 `index.html` 的静态 `<meta name="theme-color" content="#ffffff">`（另 `public/manifest.json` 的 `theme_color`、以及 `mobile/www/index.html` 这个 Capacitor 服务器选择页自成一套 media 查询式 theme-color）。1-C 只把运行期这一环接上令牌（见该片记录），"JS 跑起来之前的那一段"仍是静态值，与首帧防闪烁同属一组问题，**已由 1-I 落地**（见下方 v8）。

> **v8（1-I 已实施）**：上面那句"首帧前生效的是 `index.html` 的静态 `<meta name="theme-color" content="#ffffff">`"**已不再成立**。1-I 在 `<head>` 末尾放了一段同步脚本，读 `localStorage['theme']`（与 `ThemeContext.tsx:74` 同一个键）、缺省回落到系统外观，据此写 `<html data-appearance>`、`color-scheme` 与一条精确的 `theme-color`；splash 增加 `:root[data-appearance='light']` 变体，取令牌解析值（`#f7f6f3` / `#0d0b08` / `#736f68`），交接到 React 首帧时颜色逐位相同。**启动链路那句"立即在首帧前设置 meta theme-color"至此才成立。** 两条 media 限定的 `theme-color` 保留为"脚本未运行"的声明式兜底，脚本运行时会移除它们——所以运行时恒只有一条；脚本必须放在 `<head>` 末尾（先能选到那两条才能移除，否则会留下两条让浏览器自己挑）。
>
> **有意视觉变更**：浅色外观的启动画面由深（`#0b0d10`）变浅（`#f7f6f3`）。理由见 1-I 记录——只改 `theme-color` 不动 splash 只是把跳变从深色用户搬到浅色用户；让 splash 一并跟随，两侧才都零矛盾、零跳变。按 1-B / 1-H 体例单独记账。spinner 在浅底上取 green-700（`#15803d`，4.64:1）而非 green-600（仅 3.05:1，余量太薄）。
>
> **如实边界**：`manifest.json` 的 `theme_color` / `background_color` 与 `msapplication-TileColor` 是**安装期**静态色，运行时改不了（平台限制），未改并记账——不要把"能跟随外观"当成它们的能力；`mobile/www/index.html` 已有 media 双条、且不加载主题令牌，未动；脚本只能读 `localStorage`，跨设备同步来的偏好要等 bundle 才可达，故该情形（以及手动偏好与系统不符时）首帧按系统外观、挂载后纠正——这是**能做到的最好**，不是遗漏。

> **v8（1-D 追加）**：上面那条"跨设备同步的边界"里的两处待决，已在 1-D 落地（见该片记录）。**决策一**：`system` 分支的豁免**只属于明暗键**，不延伸到 `themeId`——`theme` 键豁免是为了不让"本机跟随系统"这个**临时态**覆盖跨设备的永久选择，而挑主题本身就是一次显式选择、没有 system 对应物，所以 `setThemeId` 无条件写偏好（已断言"system 下选主题仍写入 `themeId`、而 `theme` 仍不写"）。**决策二**：回落不再可能静默——解析层 `resolveTheme(themeId, appearance)` 查不到该 id 时返回外观默认，`ThemeContext` 把**生效 id** 与**用户所选 id** 分开暴露（`resolvedThemeId` / `themeId`），并在 effect 里 `console.warn` 报出"此设备未安装 X、已回落 Y"。**提示 UI 留到 1-F**（届时判 `themeId !== null && themeId !== resolvedThemeId` 即可渲染），1-D 只负责让回落可被观测、可被判据。另记一条本片**未定、不阻塞**的边界：用户显式选了与外观同名的默认别名（`cc-light` / `cc-dark`）之后再切换明暗胶囊，`data-theme` 应留在所选别名还是回到外观默认——这属 1-E 扩充注册表时要一并定的模型问题（1-D 阶段这两个 id 都无覆盖层，两种解释视觉等值，故不影响本片）。

> **v9（1-F 追加）**：v8 写的"**提示 UI 留到 1-F**"已落地——`ThemeSelector` 在 `themeId !== null && themeId !== resolvedThemeId` 时渲染一行 `role="status"` 说明（点名缺失的 id）。两点补记：① **判据用的是"两个 id 不相等"，不是"所选 id 不在注册表里"**——`resolveTheme` 已经是唯一的解析入口，再让选择器自己查一遍注册表就是第二份真源，而这个真相（本机没装 → 已回落）正是它算出来的。② 该提示**是 v8 决策二唯一的消费者**：1-D 之所以把 `resolvedThemeId` 与 `themeId` 分开暴露，图的就是这一处；此前它只有 `console.warn` 一个出口，属"可观测但不可见"。v8 里那条"默认别名与胶囊的关系"**已由 1-E 消解**（默认别名不进选择器，见 §5.3 v9）。

> **v10（1-G 已实施）——上面那条"JS 消费者需要主动刷新"的取值范围，被实测收窄到只剩 xterm**。逐条核过三个"JS 消费者"，结论是**只有把一个解析后的色值塞进 JS 对象的那类才需要刷新**：
>
> - **xterm：确实需要**（唯一真需要的一路）。它把**具体色值**放进 `options.theme` 供 canvas 绘制，`var()` 根本不参与。两处校正：① **实现与该 bullet 写的不一样**——不是读 `getComputedStyle(document.documentElement)`，而是 `readTerminalTheme()` 建一个探针 `div`、写 `hsl(var(--term-x))` 再读回 computed color，并带 `transition: none` 绕开 `index.css` 的 200ms 过渡（一个探针、一个读取）。② **触发点原来只覆盖明暗**：`useShellTerminal` 的刷新 effect 只依赖 `isDarkMode`，1-G 补上 `resolvedThemeId`，覆盖层的**切换与清除**才同样触发重读。
> - **CodeMirror：不需要**。该 bullet 说它"在扩展创建时求值"，但 0-D 的落地把 `EditorView.theme()` 与 `HighlightStyle.define()` 的**每个色值都写成了 `var()` 字符串**——它们是注入样式表的普通 CSS 规则，由浏览器在绘制时解析，覆盖层换值即重绘，**无需 compartment reconfigure**。这是 0-D"实现比草案更强"的直接后果（同 0-D 记录里的体例）；本片只核对并记录，未改代码，结论由 `editorThemeTokens.test.ts` 常驻（它拒绝任何不是 `var(--editor-*)` 的 chrome 值）。
> - **Git 图：不需要**（原 bullet 已对），`CommitGraphStrip.tsx` 是 SVG，表现属性直接吃 `var(--graph-lane-N)`。
>
> 判据可复述为一句：**看色值最终交给谁**——交给 CSS（注入的样式表、SVG 表现属性、内联 `style`）就不用刷新；交给 JS 数值对象（xterm 的 `ITheme`）才要。

> **v11（2-A 已实施）——上面 v3 那句"服务端实现**直接复用** `plugins.routes.ts` 的 `/:name/assets/*` + `resolveAsset` 模式（已含路径安全 + 扩展名约束），**不必新写目录遍历与校验**"作为字面前提不成立，2-A 改为新写 `server/modules/themes/`。两条实测理由：**
>
> **一、那个函数绑在 plugins 注册表上，接不了任意目录。** `resolvePluginAssetPath(name, assetPath)` 先过 `getPluginDir(name)`，而后者是 `scanPlugins()` 的结果里按 name 找、路径固定为 `getPluginsDir()/plugin.dirName`（`plugin-registry.service.ts:227-232`）；`scanPlugins` 只认带 `manifest.json` 的目录。主题文件既不是插件、也不在 plugins 目录下——"复用"得先假装它是插件，语义不成立。
>
> **二、它没有任何扩展名约束，v3 那句括号里只有前半为真。** 函数体只做 realpath 规范化 + 包含检查（`plugin-registry.service.ts:238-249`），`contentType` 仅用于响应头；而且它以 `*` 通配**嵌套**路径，与"主题目录是平铺的单层文件"形态不同。
>
> **真正值得沿用、也确实被沿用的**是两条：① v3 后半句说的 `Content-Type` + `Cache-Control` ——2-A 照此发了 `no-store`；② 目录包含检查的写法——2-A 用的是 assets 模块那份 `path.resolve(root) + path.sep` 直系子项判据（对应 §5.8"只读该目录"），**未**照搬 plugins 的 realpath 加固，理由与到期条件见 §5.8 v3 的"如实边界"。这条 v11 与 0-D / 1-G 那两条同体例：**文档写的实现前提被更强的实测取代时，改判并回写条款**。

> **v12（2-B 已实施）——上面框图里"首次加载（无缓存）：`<link rel="stylesheet" href="/api/themes/<id>.css?v=<mtime>">`"这一支被取消，2-B 起一切用户主题都走「`fetch` 取文本 ＋ `<style>` 注入」，`<link>` 一条不留。**
>
> 框图里最要害的机制没变，也不需要变——那正是 v2 修正的结论："**首帧防闪烁靠缓存，不靠 `<link>` 时序**"。变的只是"文件内容怎么进文档"这一步，而 `fetch` ＋ `<style>` 恰好是同一句话的自然延伸：
>
> **一、`<link>` 没法带 `Authorization`，而路由在 `authenticateToken` 之后。** 这条路**能**走通——`authenticateToken` 接受 `?token=`（`server/modules/auth/auth.middleware.ts:47`，当年为 SSE 加的，因为 `EventSource` 不能设请求头）——但把 bearer token 放进 URL 意味着它会落进访问日志、`Referer` 与浏览器历史。而同源的 `fetch` 走既有的 `authenticatedFetch`，头里带 token、URL 里不留痕。**所以这不是"`<link>` 不可行"，而是两条都可行时 `<link>` 在令牌暴露上严格更差**——这一点必须在文档里说清，否则下一个人会以为这是个能力缺口而去"补"它。
>
> **二、框图自己要求"`onload` 后把内容缓存进 localStorage"，而 `<link>` 不给文本。** 缓存是首帧防闪烁的**全部**依据，所以走 `<link>` 得**再发一次请求**才能拿到要缓存的字节。一次 `fetch` 同时得到元素与缓存条目，请求数从 2 降到 1。这一条与上一条无关、单独成立。
>
> **框图里明确保留、且 2-B 逐条落实的**：`?v=<mtime>` 版本参数（"用户主题 URL 必须带版本参数"那条）；"切换主题时先加新的、再移除旧的"（`injectStyle` 先 `appendChild` 再删旧元素，是两条 mutation、其间文档始终有一个主题元素——2-B 用 `MutationObserver` 把这条顺序钉成了回归测试）；"加载失败 → 回落默认主题 ＋ 控制台告警"；以及"缓存同步注入 → 后台校验更新"这套两段式。
>
> **框图未要求、2-B 补上的**：失败不只是 `console.warn`，而是**上屏可见**——`failedId` 经解析层变成选择器里一行 `role="status"`。上面"跨设备同步的边界"只要求提示"未安装"，2-B 把"装了但读不出来"也一并提示，这才是验收里"失败回落可观测"的完整读法。另外框图写的"后台校验是否有更新"落成了**清单即校验**：`applyUserThemeStyle` 以 `(id, mtime)` 为键，mtime 未变是空转、变了才重取——不额外发探测请求。

> **v13（2-C 已实施）——上面"读取后编译成 `[data-theme="x"]{ … }` 注入"这一步已落地，并在此定死一个两处文档相左的问题：`.json` 文件里的 `appearance` 是"这套规则写给哪个外观"（作用域），不是 §5.3 那个"角色"。**
>
> **一、编译步骤落在哪**。`src/shared/userThemeTokens.ts` 把 `.json` body 编译成覆盖层样式表：逐条查令牌白名单、按令牌家族校验值形状，通过的写成 `  --token: value;`（**保持文件里的声明顺序**），拼进 `[data-theme="…"] { … }`。`.css` 不经此步（它本来就是样式表，原样注入），`.tmTheme` **显式拒绝**——把 plist 当 CSS 注入会往文档里放一个匹配不到任何东西的元素，选择器会显示"已生效"而页面从未变过；拒绝让这个缺口可见，等 2-E 来填。
>
> **二、口径裁定（本片唯一停下拍板处）**。§5.3 定义 `ThemeManifest.appearance` 是**角色**：`light` / `dark` 是外观默认、不进选择器，`system` 是覆盖层、进选择器（§5.3 v9）。若文件自带的 `appearance` 也照"角色"读，一个用户文件永远只能是 `system`（文件主题一定是覆盖层），这个键便毫无作用。故取**作用域**读法、在**编译期**生效：`light` → `[data-theme="x"]:not(.dark)`、`dark` → `[data-theme="x"].dark`、`system` 或缺省 → 裸 `[data-theme="x"]`（＝`.css` 主题今天的行为）。**`:not(.dark)` 不是可有可无**：裸选择器在暗外观下同样匹配，只是靠特异性输给 `.dark`，那正是内置覆盖层 `cc-polar` 当初被给同一形状来避免的静默泄漏。
>
> **三、被否掉的另两种读法（留档以便回退）**：① **"删掉这个键"**——则用户主题无法表达"我这套值只适用于浅色"，一个自带浅色板又没有保护的主题会在暗外观下把两套基值混在一起；② **"按角色读、即只接受 `system`"**——等于把键变成恒真，读者会以为它有作用。两种都否。若将来改判，只需改 `selectorFor` 一处。
>
> **四、值形状的判据与 §5.9 同源**：色值最终交给 `hsl(...)` 解析的令牌收**三元组**，交给 `EditorView.theme()` 之类直接写规则的收**完整表达式**。示例里的 hex bug 与本条白名单落地同源于此，见 §5.8 v4。

> **v14（2-D 已实施）——粘贴主题上线，并把上面那条"必须提供强制恢复通道"从 2-E 提前到这里落地。四件事：内容从哪来、解析为何不动清单、通道取哪一条、以及没做什么。**
>
> **一、粘贴主题的内容在偏好镜像里，不在服务器上。** 新偏好键 `userThemePastes` 存 `PastedUserTheme[]`（`{ id, name, content }`，`content` 即选项 A 的令牌 JSON，`name` / `coverage` 由同一个 JSON 自带、按 §5.8 v4 的宽严读法读）。因此它**不需要 `?v=`、不需要往 localStorage 再缓存一份、也不等清单**——`applyBootUserThemeStyle` 直接编译注入，首帧与"文件主题走缓存"一样早。`userThemeStyles` 收成一个入口，两条线的差异只留在一个接缝上：
>
> ```ts
> export type UserThemeStyleTarget =
>   | { kind: 'file'; entry: UserThemeEntry }    // 取文本：fetch /api/themes/<file>?v=<mtime>
>   | { kind: 'paste'; theme: PastedUserTheme }; // 内容已在手：直接编译
> ```
>
> "这一版要不要重取"的键（`revision`）对文件是 mtime、对粘贴是**内容本身**——粘贴没有 mtime 可用，比较文本比造一个更准。**不为两条线各建一个 store** 是刻意的：文档只能穿一套主题，两个 store 会各自持有一份"当前应用了什么"，而真正需要分开的只有"文本从哪来"这一步。
>
> **二、解析不动清单，因为没有可等的东西。** `ThemeContext` 新增 `pickedPaste`（从偏好列表里找），`themeFallback` 对 `paste-` 前缀的 id 直接判"在列表里就还没有结论、不在就 missing"，**没有"仍在加载"这一态**。这不是简化而是判据：一个不需要请求就能判定的主题，不该等一个它不依赖的请求——否则选择器会先报"未安装"再收回，而"下一帧要收回的提示比等待更糟"是 2-B 已经立过的规矩（§5.6 v12）。删除粘贴主题时 `removePastedTheme` 会**连带清掉指向它的 `themeId`**：留着会让选择器把用户自己的删除报成"未安装"。
>
> **三、恢复通道取第 ③ 条 `?theme=default`。** 三条里只有它**不依赖键盘、也不依赖本机配置，且能在启动前生效**：`applyThemeResetRequest()` 在 `main.tsx` 最前面跑（早于任何主题恢复），所以重置在首帧就已经在生效；随后参数被 `history.replaceState` 抹掉——留着会让每次刷新都再重置一次，用户就再也留不住别的主题。它丢的是**选择**不是主题：条目留在列表里，把值改好还能再选回来。还有一处不显眼但必须做的：客户端在 boot 时**还没有会话**，`themeId: null` 这个写只能进镜像，**紧随其后的 hydrate 会把服务端那份坏选择原样搬回来**——所以 `userSettings` 新增 `preferLocalValueOnHydrate(key, value)`，让这个清空在 hydrate 时压过服务端那份、并反过来推上去（`hydrateOverrides`，登出时清）。
>
> **如实边界（三条）**：① **自愈哨兵未做**，`sentinelClass` 保持预留——它要判定"主题加载了却没生效"，而选项 A 的编译产物只有自定义属性、拿不到 `html` 上的类名，照原样做出来会是个演示不出的机制（与 §5.8 v4 对"结构闸门当前挡不住东西"的记法同体例）；② 这条通道在**没有地址栏的宿主**（Capacitor 打包的移动端）里够不着，那类客户端要另想办法；③ 设置页把这个用法写成了文案（`userThemes.resetHint`）——"能在页面不可读时生效"与"能被页面上的按钮触发"互斥，文档化是能读的页面为不能读的页面能做的最多的事。
>
> **四、这条通道为什么必须跟着粘贴线一起上。** 粘贴主题**不在磁盘上**，坏了没有文件系统可以绕过——它正是粘贴线一上线就需要的逃生门。跟着 2-E（原始 CSS）走等于先把 footgun 发给用户再补退路，所以本片把"恢复通道"从 2-E 挪到 2-D，2-E 只留原始 CSS（选项 B）与 `.tmTheme`（B2）。选项 A 的粘贴内容**天然免疫"破坏布局"**（只能写白名单令牌），但**不免疫"合法但有害"**——`--foreground` 与 `--background` 写成同一个三元组就能把界面变成看不清（§5.10 的对比度只警告不阻断），这正是通道要覆盖的情形。

> **v15（实施轮批 2 追加，TIP ⑧）——首帧"不闪"隐性依赖 splash 盖屏，记为已知依赖。** `data-theme` 由 `ThemeContext` 在 useEffect（首帧绘制**之后**）写入，`data-appearance` / `color-scheme` / `theme-color` 由 1-I 的内联脚本在首帧前写好——所以"启动不闪默认基色"这一保证，其时间轴是「内联脚本管首帧 → splash 盖住其余 → useEffect 接管」。splash 提前消失（路由重构、SSR、桌面壳去除 splash）会把 useEffect 之前那一段暴露出来。三个写者的分段职责已在 `main.tsx` 的 splash 注释里就地注明（代码注释比文档记录更难被后人漏掉，Pi 复核建议照办）。

### 5.7 硬编码收口清单（阶段 0 的施工面）

| 目标 | 文件 | 收口方式 |
|---|---|---|
| **Tailwind 具名中性色（界面骨架）** → 三分法**第一类**（v3 定为必做） | 中性色 **1502 处**（设计期 grep 口径；0-E2e 发现该口径漏了轴限定形态，真实口径为 **1517 处**，见该片记录），分布于 **105 个文件**（热点：`AskUserQuestionPanel.tsx` 84、`TaskDetailModal.tsx` 72、`McpServerFormModal.tsx` 69、`TaskBoardToolbar.tsx` 60、`AgentConnectionsStep.tsx` 60、`VersionUpgradeModal.tsx` 55…） | **v4 定案（A1 保值档位令牌）**：`bg-gray-100 dark:bg-gray-700` → `bg-n-gray-100 dark:bg-n-gray-700`——只把字面档位换成令牌引用，取值**逐档等于现状 Tailwind 中性值**。初稿写的 `bg-slate-800 → bg-card` / `text-zinc-400 → text-muted-foreground` **不可行**：实测本片存在 **89 种不同的 `(light, dark)` 元组**，而一个令牌类只能承载**一对**值，折叠到 ~15 个角色令牌必然改色（light 整体偏暖、dark 卡片 `#1f2937 → #1f1f1f`，单点 ΔRGB 最大 100），DoD 的"阈值 0"当场作废。保值档位层由 0-E1（`gray`）与 0-E1b（`zinc` / `slate` / `neutral`）建设（见下方实施记录）。**按文件集群分片，热点文件（>50 处）单独成片**；`bg-x dark:bg-y` 是成对结构（实测同文件对 ≥ 335 处，本仓粗测 414），**替换必须一次完成、同时消灭两半，不设中间态**。**代价（记账）**：`dark:` 双写结构保留（§5.7 第一类字面要求未满足），且档位跨角色耦合（`--n-gray-700` 同时承载 light 正文色与 dark 抬升面）；两者原本记由**阶段 2 的语义化改名**收口——该收口**未立项**（见下方"语义化改名（显式未做）"小节），与 `--cc-syntax-N` 本轮"只加间接与护栏、改名以立项为前提"（§8.9）同构。**进度**：**0-E6d 后剩余 0 处 / 0 文件**（`AskUserQuestionPanel.tsx` 84、`TaskDetailModal.tsx` 72、`McpServerFormModal.tsx` 69、`TaskBoardToolbar.tsx` 60、`VersionUpgradeModal.tsx` 55、`CodeEditorHeader.tsx` 52、`FolderBrowserModal.tsx` 46、`TaskEmptyState.tsx` 46、`AccountContent.tsx` 41、`toolConfigs.ts` 38、`QuestionAnswerContent.tsx` 35、`NextTaskBanner.tsx` 33、`TaskMasterSetupModal.tsx` 32、`GithubAuthenticationCard.tsx` 31、`PrdEditorHeader.tsx` 30、`GenerateTasksModal.tsx` 30、`CreateTaskModal.tsx` 30、`TaskHelpModal.tsx` 30、`TaskCard.tsx` 30、`fileIcons.ts` 28、`TaskListContent.tsx` 24、`MessageComponent.tsx` 24、`CodeEditorBinaryFile.tsx` 23、`CodeEditorMediaPreview.tsx` 22、`TaskFiltersPanel.tsx` 22、`TaskQuickSortBar.tsx` 18、`OverwriteConfirmModal.tsx` 18、`StepReview.tsx` 18、`SidebarProjectItem.tsx` 16、`taskKanban.ts` 16、`ImageViewer.tsx` 14、`ProjectCreationWizard.tsx` 14、`ShellHeader.tsx` 14、`TaskBoardContent.tsx` 14、`ToolDiffViewer.tsx` 12、`MarkdownPreview.tsx` 12、`UserMessageStickyHeader.tsx` 12、`TerminalShortcutsPanel.tsx` 11、`TextContent.tsx` 11、`BrowserUsePanel.tsx` 11、`QuickSettingsHandle.tsx` 10、`WorkspacePathField.tsx` 10、`ProviderLoginModal.tsx` 9、`WizardProgress.tsx` 9、`SidebarModals.tsx` 8、`ExecutionProcessSummary.tsx` 8、`PrdEditorFooter.tsx` 8、`ChatMessagesPane.tsx` 8、`StepConfiguration.tsx` 8、`ShellConnectionOverlay.tsx` 7、`MarkdownCodeBlock.tsx` 7、`Shell.tsx` 7、`CommandMenu.tsx` 6、`SessionOptions.tsx` 6、`SidebarContent.tsx` 6、`SidebarRecentConversations.tsx` 6、`MessageSpeakControl.tsx` 5、`CodeEditorLoadingState.tsx` 5、`PrdEditorLoadingState.tsx` 5、`ShellEmptyState.tsx` 5、`StandaloneShellEmptyState.tsx` 5、`StandaloneShellHeader.tsx` 5、`FileListContent.tsx` 4、`ToolStatusBadge.tsx` 4、`ChatMessageImages.tsx` 4、`MessageCopyControl.tsx` 4、`CodeEditorFooter.tsx` 4、`EditorSidebar.tsx` 4、`FileTree.tsx` 4、`TaskIndicator.tsx` 4、`ProviderSkills.tsx` 4、`Tooltip.tsx` 4、`LoadAllMessagesOverlay.tsx` 3、`CodeEditorSurface.tsx` 3、`MermaidDiagram.tsx` 3、`PrdEditorWorkspace.tsx` 3、`OneLineDisplay.tsx` 2、`GitPanelHeader.tsx` 2、`ConfirmActionModal.tsx` 2、`RemoveWorktreeModal.tsx` 2、`WizardFooter.tsx` 2、`WorkspaceTabs.tsx` 2、`NotificationsSettingsTab.tsx` 2、`DarkModeToggle.tsx` 2、`ComposerAttachment.tsx` 1、`PromptInput.tsx` 1、`VoiceInputButton.tsx` 1、`CommandResultModal.tsx` 1、`Markdown.tsx` 1、`CodeEditor.tsx` 1、`MergeWorktreeModal.tsx` 1、`NewBranchModal.tsx` 1、`NewWorktreeModal.tsx` 1、`AgentConnectionCard.tsx` 1、`Onboarding.tsx` 1、`OnboardingStepProgress.tsx` 1、`PluginSettingsTab.tsx` 1、`WorkspaceErrorBoundary.tsx` 1、`SettingsToggle.tsx` 1、`AgentSelectorSection.tsx` 1、`ShellMinimalView.tsx` 1、`SidebarModeTabs.tsx` 1、`TaskMasterPanel.tsx` 1、`Dialog.tsx` 1 均已清零）。沿革：0-E0 全量 **1502 处 / 105 文件** → 0-E2 后 1439 / 104 → 0-E2c 不变（纯护栏片）→ 0-E2d −84 → **0-E2e 扩面 +15 又同片清零 −15，剩余量不变**（但覆盖面从 1502 增至 **1517**，见 0-E2e 记录的口径变化）→ 0-E2f −72 → 0-E2g −69 → 0-E2h −60 → 0-E2i −55 → 0-E2j −52 → 0-E2k −46 → 0-E2l −46 → 0-E2m −41 → 0-E2n −38 → 0-E2o −35 → 0-E2p −33 → 0-E2q −32 → 0-E2r −31 → 0-E2s −30 → 0-E2t −30 → 0-E2u −30 → 0-E2v −30 → 0-E2w −30 → 0-E2x −28 → 0-E2y −24 → 0-E2z −24 → 0-E3a −23 → 0-E3b −22 → 0-E3c −22 → 0-E3d −18 → 0-E3e −18 → 0-E3f −18 → 0-E3g −16 → 0-E3h −16 → 0-E3i −14 → 0-E3j −14 → 0-E3k −14 → 0-E3l −14 → 0-E3m −12 → 0-E3n −12 → 0-E3o −12 → 0-E3p −11 → 0-E3q −11 → 0-E3r −11 → 0-E3s −10 → 0-E3t −10 → 0-E3u −9 → 0-E3v −9 → 0-E3w −8 → 0-E3x −8 → 0-E3y −8 → 0-E3z −8 → 0-E4a −8 → 0-E4b −7 → 0-E4c −7 → 0-E4d −7 → 0-E4e −6 → 0-E4f −6 → 0-E4g −6 → 0-E4h −6 → 0-E4i −5 → 0-E4j −5 → 0-E4k −5 → 0-E4l −5 → 0-E4m −5 → 0-E4n −5 → 0-E4o −4 → 0-E4p −4 → 0-E4q −4 → 0-E4r −4 → 0-E4s −4 → 0-E4t −4 → 0-E4u −4 → 0-E4v −4 → 0-E4w −4 → 0-E4x −4 → 0-E4y −3 → 0-E4z −3 → 0-E5a −3 → 0-E5b −3 → 0-E5c −2 → 0-E5d −2 → 0-E5e −2 → 0-E5f −2 → 0-E5g −2 → 0-E5h −2 → 0-E5i −2 → 0-E5j −2 → 0-E5k −1 → 0-E5l −1 → 0-E5m −1 → 0-E5n −1 → 0-E5o −1 → 0-E5p −1 → 0-E5q −1 → 0-E5r −1 → 0-E5s −1 → 0-E5t −1 → 0-E5u −1 → 0-E5v −1 → 0-E5w −1 → 0-E5x −1 → 0-E5y −1 → 0-E5z −1 → 0-E6a −1 → 0-E6b −1 → 0-E6c −1 → 0-E6d −1。另处置 2 处旧式 `*-opacity-*` 共现隐雷，见 0-E2 记录。**0-E2c** 补上配对层守恒律——0-E0 时代的全量字面命中数（1439 剩余 ＋ 1 豁免 ＋ 62 已迁移 = 1502）即冻结总量起点，从数字上追溯确认了 0-E2b 的迁移守恒 |
| **状态色（成功 / 错误 / 警告 / 信息）** → 三分法**第二类** | 约 300 处（如 `bg-green-500 dark:bg-green-600`） | **保留 `dark:`，作为"主题不应控制的色"**。`--status-*` 令牌的**定义与替换捆绑为同一个后续片（可晚于阶段 0），阶段 0 不引入**——否则会重演 DSH 指出的"无消费者死令牌"覆辙（保留 `dark:` 的组件不读令牌，覆盖 `--status-*` 无效）。替换完成前，主题开发文档须诚实写明"状态色暂不受主题控制" |
| **品牌色 / 文件图标色 / 装饰色** → 三分法**第三类** | 约 1000 处（`fileIcons.ts`、agent 品牌色、渐变色） | **明确豁免**，写入机器可校验的豁免清单（§6），主题不覆盖 |
| **`dark:` 前缀总览**（v3 定口径） | 实测 `dark:` 共约 **1302 处** = 中性具名 **529** + 彩色具名 **581** + 语义令牌类 **6** + 结构性变体（`dark:prose-invert` 等）约 186。**注意：`dark:` + 具名色合计约 1110 处（86%），均为硬编码**，须按三分法分流 | **验收只统计"`dark:` + 具名色"**（目标收敛到豁免清单），**不统计"`dark:` 总数归零"**——`dark:bg-card` 这类**指向令牌**的 dark 变体天然无害、主题完全接管，计入会白费力气。另：全项目语义令牌类的 `dark:` 用法仅 6 处，说明现状暗色处理基本是"具名色双写"模式 |
| xterm 终端 ✅ | ~~`src/modules/shell/hooks/useShellTerminal.ts:36-75`（38 处 hex）~~ | **0-C 已完成**：改为 `--term-*` 令牌，由 `src/modules/shell/utils/terminalTheme.ts` 在运行期解析；`extendedAnsi` 已按附录 A **废弃**（见 §6 阶段 0 之 0-C 记录） |
| CodeMirror 主题 ✅ | ~~`src/modules/code-editor/CodeEditorSurface.tsx:76`（`oneDark`）~~ | **0-D 已完成**：`src/modules/code-editor/utils/editorTheme.ts` 建了 `EditorView.theme()`（UI：背景 / 光标 / 选区 / 行号 / 搜索 / tooltip）与 `HighlightStyle.define()`（token 色）两套。UI 面走 `--editor-*`，语法面经 `SYNTAX_TOKEN_MAP` **与 chat 侧 Prism 共用** `--cc-syntax-N` |
| 编辑器 diff 样式 ✅ | ~~`src/modules/code-editor/utils/editorStyles.ts:13-79`（**13 处** `isDarkMode ? A : B`）~~ | **0-D 已完成**：改为 `--editor-diff-add/del-*` 等令牌，函数退化为常量（`EDITOR_STYLES` / `EDITOR_LOADING_STYLES`），`isDarkMode` 参数消失 |
| 第二处语法高亮 ✅ | `src/modules/code-editor/markdown/MarkdownCodeBlock.tsx:69` | **0-B 已统一**：改走 `src/shared/syntaxTheme.ts` 的 `syntaxTheme.style`，直连 Prism 主题的分支已删除 |
| Git 图 lane 色 ✅ | ~~`src/modules/git-panel/utils/commitGraph.ts:20-29`（10 lane）＋ `git-panel/history/CommitHistoryItem.tsx`（`'#0ea5e9'` fallback）~~ | **0-F1 已完成**：抽为 L1 `--palette-graph-1..10` ＋ L2 `--graph-lane-1..10`（**只在 `:root` 声明**——这 10 色本就是"明暗都看得清"的一套，同 term board 的性质，不做 `.dark` 镜像）；`laneColor` 返回 `hsl(var(--graph-lane-N))`，`RefBadge` 的 HEAD 底色新增 `laneTint` 给 `hsl(var(--graph-lane-N) / calc(34 / 255))`（原为 `${hex}22`，`0x22`＝34/255）。**§5.12 的参数化回退已由 2-J 落地**（见该节 v3） |
| 终端选区菜单 ✅ | ~~`src/modules/shell/utils/mobileTerminalSelection.ts:179-228`（**7 处**）~~ | **0-F2 已完成**：7 处字面色值改走令牌（`--palette-brand-400` / `--n-white` / `--n-black` / `--n-gray-800` / `--n-gray-50`）。这块 chrome 贴在终端上、终端板明暗恒深，所以用**外观无关**的令牌而非语义令牌（写 `--card` / `--foreground` 会让它随浅色外观翻白，是可见改变）。**只动色值，事件处理一行未改**（长按 / 拖拽 / 惯性滚动），故行为面无回归；配色面由新增的 `tests/theme-tokens/mobile-terminal-selection.spec.ts` 常驻断言覆盖（真正装上 `installMobileTerminalSelection` 读回 computed 值） |
| 滚动条 / 表单件 / placeholder ✅ | `src/index.css`（滚动条 / checkbox / radio / textarea / placeholder 的暗色补偿，0-C 时代记 66 处） | **先加 `color-scheme`（§5.6），再重审这批补偿**。**第一步已做**：1-B 把 `color-scheme` 写上了 `<html>`。**重审已完成且改判**（见 §6 的 1-B2 记录）：① 锚点累计偏移 +223，实得 **69 处色值声明**；② **"这些补偿是在手写模拟 `color-scheme`"的前提不成立**——实测真正失效的只有 2 行 `color-scheme: dark`，同段的 `background-color` / `border-color` 与 placeholder 的 `gray-600` 都是刻意的外观选择，**不能成批删除，只能令牌化**；③ 68/69 处与既有令牌像素级等值。**已实施（1-B2a/b/c）**：删 2 行失效 `color-scheme`、textarea 改为继承 `<html>`、68 处按**方案 A**（复用既有令牌保形间接）改走令牌——中性档走 `--n-*`，两处 blue 走外观无关的 L1 `--palette-brand-500` / `-400`（`.dark` 块内写 L2 `--primary` / `--ring` 会解析成 dark 值），`.dark` 内的 `rgb(20 20 20)` / `rgb(31 31 31)` 走 L2 `--background` / `--card`，仅 `rgb(237 235 230)` 无等值令牌保留字面。**最终没有新建 `--scrollbar-*` / `--control-*` / `--placeholder` 三组**：那三组的原意（"承接删不掉的部分"）随结论 ② 一并作废，新建只会多出约 20 个令牌并让未来的语义化改名多做一遍（改名轮未立项，见 §5.7"语义化改名（显式未做）"）
| agent 品牌色 / Logo | `AgentSelectorSection.tsx`、`*Logo.tsx` | **保持硬编码**，在 `index.css` 顶部集中声明豁免清单并注明"品牌标识，不随主题变化" |

验收（v3 定口径）：grep 必须**同时匹配字面色值与具名色原子类**，只匹配前者会漏掉占比约 98% 的具名色；对 `dark:` 则**只统计 `dark:` + 具名色**，不统计 `dark:` + 令牌类。

```bash
# ① 字面色值
grep -rnE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(' src --include='*.css' --include='*.ts' --include='*.tsx' | grep -vE 'hsl\(var\('
# ② Tailwind 具名色原子类（初稿完全遗漏）
rg -o -e '(bg|text|border|ring|stroke|fill|from|to|via|decoration|placeholder|shadow|outline|divide|accent|caret)-(slate|gray|zinc|neutral|stone|black|white)(-[0-9]{2,3})?(/[0-9]{1,3})?' src --glob '*.tsx' --glob '*.ts' | wc -l
# ③ dark: + 具名色（验收对象；dark: + 令牌类不计入）
rg -o -e 'dark:(bg|text|border|ring|stroke|fill|from|to|via|decoration|placeholder|shadow|outline|divide|accent|caret)-(slate|gray|zinc|neutral|stone|black|white|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-[0-9]{2,3})?(/[0-9]{1,3})?' src --glob '*.tsx' --glob '*.ts' | wc -l
```

剩余命中**必须全部落在机器可校验的豁免清单内**（§6 阶段 0），清单外命中即验收失败。**0-E0 已把它落成两份独立资产**：`src/shared/tests/themeHardcodedAllowlist.ts`（**永不**迁移项，逐条 `file + token + 理由`）与 `src/shared/tests/theme-hardcoded-baseline.json`（**派生快照 = 待迁移项**，逐片收敛到空）；护栏 `themeHardcodedAtoms.test.ts` 断言"剩余命中 ⊆ 基线"且"豁免清单无死项"，并在失败时报出**具体文件与原子**的计数漂移。注意口径：二者只覆盖**中性族**——扫描器 `themeHardcodedAtoms.ts` 在构造上就只找中性具名色，彩色 / 状态 / 品牌 / 图标色（约 1700 处）不经此清单。**注意：grep 只能证明"没有硬编码"，证明不了"每套主题的令牌全集可解析"——后者由 §5.11 的契约测试承担。**

**口径附注（TIP ⑦，实施轮批 3 归档）——`prose-gray` 的三分法归属**：`prose-gray` 5 处（`MessageComponent.tsx` 4 处、`PrdEditorBody.tsx` 1 处）不在 1517 口径与守恒律内（扫描器 ATOM 只认工具类前缀，认不出 `prose-gray` 这个 prose 插件修饰符）。归属裁定：它落在本表**第一类**（界面骨架的中性文字色，随明暗成对、语义上应受主题控制）——但它是 prose 排版域的默认配套而非独立硬编码，**不追加入迁移清单、不刷新冻结基准**；若未来做第一类的残余收口或语义化改名，应把它一并纳入口径（届时属"护栏覆盖面变化"事项）。此归属只记文档，不改扫描器。

### 语义化改名（显式未做；前提：改名轮立项）

实施轮审阅（P3）核出：文档多处把收口动作记给"阶段 2 的语义化改名"，而实际实施的阶段 2 是用户主题线（2-A..2-M）——**这是命名撞车**：本节与 §6 记录里的"阶段 2"一直指改名轮，实施排期里的"阶段 2"做的是用户主题。改名轮**至今未立项**，以下到期条款全部悬置，逐条标注前提：

1. **§5.7 v4 的 `dark:` 双写与档位耦合**：A1 保值层保留了 `bg-n-gray-100 dark:bg-n-gray-700` 的双写结构与"一个令牌承载一对值"的档位耦合，原记"阶段 2 一次收口"。**前提：改名轮立项**（届时按新语义名消除双写、拆耦合）。
2. **附录 A 的 `--n-*` 层**：原记"阶段 2 改名后整层删除"。**前提已由 2026-09-26 拍板取代：`--n-*` 是永久契约面**——1520 处消费者＋已进用户主题白名单（`userThemeTokens.ts`），依赖只增不减，"将来整层删除"是破坏性变更。改名轮若立项，`--n-*` 是改名后的**保留层**而非删除对象。
3. **0-E1 记录的 tailwind `n-*` 键**：原记"阶段 2 改名后本键删除"。按同一条拍板改写：改名轮若立项，键随改名一并调整，但不因"改名完成"而删除。
4. **§8.9 的 `--cc-syntax-N` 改名**：编号仍是实现细节、白名单仍不授权（§5.8 v4），不受 `--n-*` 拍板影响。**前提：改名轮立项**（届时一次到位升语义名，白名单同步扩充——即 2-C 记录的"到期条件"）。
5. **2-C 白名单注释的扩充到期条件**：白名单是当前样式表的快照，`--cc-syntax-*` / 几何族 / `--tw-*` 未授权。扩充随改名轮立项触发，**此前白名单边界维持现状**。

触发条件与去向：改名轮是否立项属排期决策、不在主题线范围内；立项时上述 5 条应整体重估（届时本小节转为实施记录）。


### 5.8 安全与健壮性（借 WorkBuddy 的约束）

用户主题文件由服务端读取并提供：

- 文件名 `sanitize`（仅 `[a-zA-Z0-9._-]`，拒绝 `.` / `..`），防路径穿越
- **id 前缀强制**（v2 新增）：内置主题 id 固定 `cc-` 前缀，用户主题强制 `user-` 前缀（或枚举时去重并告警），避免用户文件 sanitize 出的 id 与内置 id 相同、按 §5.4 优先级**静默遮蔽**内置主题
- **选择器注入防护**（v2 新增）：`data-theme` 值会写进属性选择器 `[data-theme="…"]`，sanitize 若放宽到 `[a-zA-Z0-9._-]` 之外，必须排除 `]`、引号、空格等会破坏选择器语法或造成注入的字符
- 大小上限（建议 256KB），拒绝 `@import`
- 目录固定为 `~/.cloudcli/themes/`，只读该目录，只返回 `*.css` / `*.json` / `*.tmTheme`
- 前端注入位置固定（`<link>` 或 `<style>`），不做 HTML 解析
- **恢复通道**：见 §5.6 的强制重置手段 + 自愈哨兵

> **v3（2-A 已实施）——上面的约束已成代码，落在 `server/modules/themes/services/theme-files.service.ts`，不再只是文档：**
>
> | §5.8 约束 | 2-A 落地 |
> |---|---|
> | 文件名 sanitize（仅 `[a-zA-Z0-9._-]`，拒绝 `.` / `..`） | `THEME_FILE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/` ＋显式拒 `..`（模式本身允许点）＋首字符须为字母数字（顺带挡掉 dotfile） |
> | id 前缀强制 | `user-` ＋文件名主干小写；内置 `cc-` 与它由构造成不可能撞车 |
> | 选择器注入防护 | **同一条模式**——"文件名安全"与"选择器安全"共用一个字符集，不是两套规则 |
> | 大小上限 256KB | 文件侧：`MAX_THEME_FILE_BYTES`，**列举与下发两处都查**（下发处再查一次，挡"列出后被改"）。粘贴侧：`MAX_PASTE_BYTES`（同值），在 `addPastedTheme` 首查、按字节量，见 v5 第二条第 ① 项 |
> | 拒绝 `@import` | 只扫 `.css`——另两种格式没有规则体 |
> | 目录固定 / 只读该目录 / 只返回三种扩展名 | `getUserThemesDir()`（§8.2 的平行常量）＋扩展名白名单＋直系子项包含检查 |
> | 前端注入位置固定 | **已由 2-B 落地**：注入点是 `<style>`（不复用 `<link>`，理由见 §5.6 v12），文件文本经 `element.textContent` 进入文档、**从不** `innerHTML`——即"不做 HTML 解析"这条由 API 选择本身保证，无需额外校验 |
> | 恢复通道 | **已由 2-D 落地三条中的第 ③ 条**（`?theme=default`，`themeReset.ts`）：它丢的是"选择"而非主题，且在 boot 最先跑；自愈哨兵未做，理由见 §5.6 v14 |
>
> **如实边界（两条）**：
>
> ① **目录内的符号链接会被跟随**。名单来自 `readdir`，而 `path.resolve` 不解析符号链接，故 `themes/evil.css -> /etc/passwd` 这类会被读出。**未**做 plugins / `image-attachments.ts` 那种 realpath 二次校验：能写该目录的只有服务进程的 OS 用户，而该用户本就能读目标文件，不构成越权提升——多写一次 realpath 换不到安全性。**到期条件**：一旦新增"网页上传主题文件"的入口（网页用户可写该目录），这条边界必须重评。
>
> ② **元数据只读该读的**。2-A 时元数据全由文件名派生；2-C 起 `.json` 文件自带的 `name` 与 `coverage` 会被读出（`readDeclaredMetadata`，名字上限 80 字符、未知 `coverage` 告警并丢该字段），`appearance` **仍不读**——它不属于服务端：它决定规则写进哪个选择器，是编译期的事（见 §5.6 v13）。选择器对未声明 `coverage` 的条目不渲染徽标（1-F 已如此），所以"不编一个默认值"是刻意的、不是漏写。

> **v4（2-C 已实施）——令牌白名单与值校验已成代码（`src/shared/userThemeTokens.ts`）。三件事：授权面、有意不授权的三族、以及拒绝粒度。**
>
> | 授权面 | 令牌 | 值形状 |
> |---|---|---|
> | L2 语义令牌（**逐个列出**） | `--background` / `--foreground` / `--border` / `--input` / `--ring` / `--card(-foreground)` / `--popover(-foreground)` / `--primary(-foreground)` / `--secondary(-foreground)` / `--accent(-foreground)` / `--destructive(-foreground)` / `--muted(-foreground)`（共 19 个） | 三元组，或指向另一个**可授权**令牌的 `var()` |
> | L1 色板 | `--palette-*` | 三元组（原始色板恒为三元组） |
> | 兼容档位 / Git lane | `--n-*`、`--graph-lane-1..10` | 三元组或 `var()` |
> | 终端板 | `--term-*` | 三元组或 `var()`——**不能是 hex**：`readTerminalTheme` 以 `hsl(var(--term-…))` 解析，hex 会编译成 `hsl(#0b1220)` 被丢弃、终端静默不变（§5.5 v3 已据此改了示例） |
> | 编辑器 chrome | `--editor-*` | 完整 CSS 表达式（这些令牌直接写进 `EditorView.theme()` 规则，不经 `hsl()`，见 §5.11 v5） |
> | 导航玻璃板 | `--nav-glass-blur` / `--nav-glass-saturate`；其余 `--nav-*` | 数值（可带单位）；三元组或 `var()`，可选 ` / <alpha>` 后缀 |
> | 圆角 | `--radius` | 长度 |
>
> **一、按家族授权，不按枚举**：`--palette-*` / `--n-*` / `--term-*` 是**样式表自己的清单**、会长会变（`--palette-gray-*` 随阶段 2 退役），逐个枚举会让一个写给旧版本的合法主题在退役当天开始失败。L2 语义令牌则**逐个列出**——一个覆盖它们的模式会放进任何"看着像"的名字。
>
> **二、有意不授权的三族（不是遗漏）**：`--cc-syntax-*`（编号尚无稳定语义名、语义名要等阶段 2，授权会让主题绑上会重排的编号，见 §5.9）；几何族 `--safe-area-*` / `--mobile-*` / `--header-*`（不是主题该管的事）；`--tw-*`（框架内部，藏在 `--ring` 后面）。**`var()` 引用的目标也必须自身可授权**——否则主题能借一个引用去读它不能直接写的令牌，白名单漏空。
>
> **三、拒绝粒度分两层，这是"结构闸门"真正买到的东西**：值里出现会提前结束声明或引入 at-rule 的字符（`}` / `;` / `@` / `!` / `\` / `<>` / 换行 / `url(` / `/*`）⇒ **整份文件拒绝**（写原始 CSS 的人用错了格式，该整份退回）；未知令牌、非字符串、或值形状不对 ⇒ **丢这一条 ＋ 上报**，文件照常可用。**如实记**：以今天的规则集，每条值规则自己的字符类已经排除了所有能逃逸的字符，故这个结构闸门**当前挡不住任何东西**，任何变异测试都证明不出它；它买的是"这份承诺写在一处、将来放宽某条规则时不会静默开洞"与上面这层**拒绝语义**。模块注释已按此改写，不声称一个演示不出的防御。
>
> **四、drop 而非 fatal 是刻意的**：一个写给更新版 CloudCLI 的主题（用了本版还不认识的令牌）应当在认识的部分照常工作，丢失的只是颜色、不是安全。丢失项由 `warnIgnored` 以一行 `console.warn` 报出。服务端与客户端对 `coverage` 的读法刻意不同——服务端严格（未知 ⇒ 告警 ＋ 丢该字段）、客户端宽松（未知 ⇒ 不画徽标但条目存活），因为客户端上"丢一个主题"的代价大于"少一个徽标"。

> **v5（2-D 已实施）——上表原本是为"服务端读文件"写的（后两行是 2-B/2-D 追加的客户端约束），而粘贴主题无论哪一行都不在它的射程内；下面三处要说清，免得下一个人以为这里缺闸门、或者以为有闸门其实没有。**
>
> **一、id 前缀放宽到两个，字符类不变。** `THEME_ID_PATTERN` 从 `/^user-[a-z0-9._-]+$/` 改为 `/^(?:user|paste)-[a-z0-9._-]+$/`。放宽的只是"哪个来源"，**选择器安全的那一半（字符类）一个字符没动**——因为那半是选择器的要求，与来源无关。粘贴主题的 id 由 `nextPasteId` 生成（`paste-` ＋ 最小未用序号），**不来自任何用户输入**，所以 §5.8 那条"文件名 sanitize"在粘贴线上没有对应物：没有文件名，也没有会被拼进路径或选择器的外来字符串。
>
> **二、三条文件侧约束在粘贴线的对应关系（如实）**：① **大小上限 256KB**——粘贴线**有**这条闸门：`MAX_PASTE_BYTES = 256 * 1024`，与 `MAX_THEME_FILE_BYTES` 同值（一个"本来可以做成文件"的主题不该仅仅因为被粘贴进来就被拒），在 `addPastedTheme` 里**第一件事**就查，超限 ⇒ `{ ok: false, reason: 'too-large' }`、什么都不存（新失败原因，两种语言的 `settings.json` 各有一条文案）。**按字节量**（`TextEncoder`）而不是 `.length`：后者是 UTF-16 码元数，一段纯中文 CSS 的 `.length` 只有实际字节的约三分之一，用它会放进三倍于上限的内容。这条有测试覆盖——夹具刻意用**未知键**（`padding`）去撑大，而不是把一个合法令牌的值写长：否则可能是某条令牌规则先丢掉了填充、尺寸闸门根本没被触发，测试会在"闸门缺失"时照样通过。② **拒绝 `@import`**——粘贴线走选项 A 的编译路径，产物是纯声明块，`@import` 在构造上进不来（它需要 at-rule 语法，而值规则与结构闸门都不放行）。③ **不做 HTML 解析**——同样由 API 选择保证：内容经 `element.textContent` 进文档（与文件主题同一条 `injectStyle`），**不需要额外校验**。
>
> **三、存储形状在客户端各校验一遍。** `readList` 逐条筛 `{ id, name, content }`，坏行**丢自己、不丢列表**——这与 `userThemes.readEntry` 同一条理由：这些字节来自可被用户或更新版本写入的镜像，一行坏数据不该赔上全部粘贴主题。`coverage` 按客户端宽读处理（未知 ⇒ 丢弃该字段但保留条目）。

> **v6（2-F1 已实施）——v5 第二条的第 ② 项（"粘贴线在构造上进不来 `@import`"）已不成立，此处改判；至此两条闸门都在。**
>
> v5② 原话："粘贴线走选项 A 的编译路径，产物是纯声明块，`@import` 在构造上进不来"。这在"粘贴线只收选项 A"时**是对的**——值规则的字符类与结构闸门都不放行 at-rule 语法，一份令牌 JSON 不可能产出 `@import`。但 2-F1 让粘贴框收**原始 CSS**，它会**原样注入**，`@import` 于是真的带得进；而粘贴**前面没有服务端**（v3 那道闸门只拦磁盘上的文件），所以这道闸门只能落在粘贴侧：`userThemePastes.ts` 的 `IMPORT_RULE_PATTERN = /@import/i`，**与服务端 `theme-files.service.ts` 同一个模式**——同一条规则的两道闸门应当对"什么算这条规则"给出一致的答案。它按**整份拒绝**处理（`reason: 'import-rule'`），与 `unsafe-value` 同属"写错了格式、整份退回"那一层。
>
> 于是上表"拒绝 `@import`"一行的射程由"`.css` 文件"扩到"`.css` 文件 ＋ css 粘贴"；其余三行（文件名 sanitize / id 前缀 / 选择器注入）仍不适用于粘贴——粘贴没有文件名、id 由 `nextPasteId` 生成，见 v5 第一条。**未变**：`json` 粘贴（选项 A）本就不需要这道闸门，因为它的产物是声明块。**另一处未变**：本片没动服务端，`server/` 树与 2-E 逐字节相同。

> **v7（2-K 已实施）——`.tmTheme` 的元数据窄式读取升级为一次深度感知的扫描，plist 顶层 `name` 自此可读。**
>
> 2-I 落地 coverage 读取时留了两笔边界：`name` 不读（边界 1）、窄式正则不辨嵌套（边界 2）。2-K 一次收两笔：`readTmThemeDeclaredMetadata` 沿 `<dict>/<array>/<key>/<string>` 四种标签记 dict/array 深度，**`name` 只在深度一取、`coverage` 只在 `cloudcli` dict 内取**。`name` 必须带深度门槛的原因是嵌套同名键——TextMate 文件合法地携带嵌套 `name`（一个 `shellVariables` 条目就是一个），"文件里第一处命中即取"会捡错；coverage 的读取射程随之从"文件里第一处"收窄到"键内"，与"键内自述"的语义对齐（原射程下作者把 coverage 放在键外也会被读到，那不是信任模型的本意）。仍不引 plist 解析器：两种事实各一个槽位，深度追踪就是全部所需。信任模型与值校验照旧：`name` trim / 非空 / 80 字符上限、超限回落文件名、不告警；未知 coverage 告警、不画徽标。客户端零改动——`ThemeContext` 本就直接消费服务端条目的 `name`。

### 5.9 与既有能力的关系

| 既有能力 | 关系 |
|---|---|
| `--cc-syntax-N` 变量化 | **继承；本轮不升语义名，只做三件事挡风险**（v3 已决）。现状：编号由"遍历 selector×property 时遇到差异的先后顺序"决定（`src/shared/syntaxTheme.ts:33-75`），源主题增删任一差异属性则其后编号整体重排；评估时消费者实测仅 4 个文件、全在 chat 模块内，但 **0-B 已使其跨出 chat**（chat 的 `Markdown.tsx`、code-editor 的 `MarkdownCodeBlock.tsx` + 3 个测试共用 `src/shared/syntaxTheme.ts`），编号不再只是模块内部实现，故下文三件事由加固升级为**必要**。**0-D 已完成**：**①** 导出 `SYNTAX_TOKEN_MAP` 常量（`{ keywordColor: 3, … }` 形态）把编号与语义绑定一次，内部引用走常量而非手写 `--cc-syntax-3`；**②** 加**黄金映射测试**——现有测试只断言 `var(--cc-syntax-\d+)` 的**形状**（`src/shared/tests/syntaxTheme.test.ts` 的 `assert.match`），未锁住具体映射，Prism 依赖 bump 导致编号重排时测试照绿；因 `buildSyntaxTheme()` 是纯函数，用 **inline snapshot** 固化 `{ style, css }` 即可（快照即对照表、零维护、diff 可读），并叠加"变量总数不变"作第一道信号；**③** 加 **denylist grep 护栏**——生成器与快照之外**禁止任何文件手写 `--cc-syntax-[0-9]` 字面量**，新消费者只允许消费 `style` / `css` 产物或 `SYNTAX_TOKEN_MAP`，CI 命中即红。**语义名草案（本轮定方向不实现）**：以 Prism 语义类别为根（comment / string / keyword / function / number / operator / punctuation / tag / attr-name / constant）、属性作后缀（`-color` / `-style` / `-weight`），如 `--cc-syntax-comment-color`；CodeMirror `HighlightStyle` 的 tag 名向同一套类别对齐，chat 与编辑器共用一套命名，**阶段 2 前一次到位改名**。<br>**0-D 实现偏差（比草案更强）**：`SYNTAX_TOKEN_MAP` 不是手写编号表，而是由 `deriveTokenMap` 从 `buildSyntaxTheme` 的产物**反查派生**——编号一旦因 Prism bump 重排，映射自动跟着走，不会出现"常量表与实际编号不一致"的中间态；找不到槽位时在模块加载期 `throw`，把改名变成构建期失败。黄金对照改用 `collectSyntaxVariables` 的完整"selector.property → 变量"快照 + 变量总数，另把每个语义槽位的 One Dark 色值冻结成表——后者能抓住"两个槽位对调"这类快照看不出的错误。<br>**2-C 补**：用户主题的令牌白名单据此**不授权** `--cc-syntax-*`（族不授权，`var()` 引用的目标也不授权），把"编号未稳定"这条约束挡在白名单之外——见 §5.8 v4 |
| 字体设置（`--ui-font-*` / `--ui-code-font-*`） | 正交，不动。主题可选择性覆盖，但默认不应覆盖用户字体选择——**后半句此前一直落不了地**：终端把字形交给 canvas 里的 xterm（字体由 JS 传、不经 CSS），主题**没有任何覆盖字体的入口**，所谓"可选择性覆盖"是句空头承诺。《CloudCLI 终端字体动态配置方案》（2026-09-28）新增 `--term-font-family` 后这半句**第一次真正可被覆盖**，而该方案的**三层优先级**（用户设置 ＞ 主题令牌 ＞ 硬编码兜底）正是"可选择性覆盖、且不覆盖用户选择"的实现——主题能被用户的选择盖过，用户也能用"跟随主题"把决定权交回主题 |
| `meta[name=theme-color]` | 由主题的 `appearance` 决定。**取值链已闭环（1-C 已实施，`1a9a7b78`）**：`--background` 是 HSL 三元组而 `meta[content]` 只接受具体颜色，原设计为此要求"统一解析函数（HSL→hex、alpha 与背景合并）"——1-C 改用**探针法**（把 `hsl(var(--token))` 交给浏览器解析再回读），浏览器即完成 HSL→hex 这一半，只保留真正必要的 alpha 合成。iOS `apple-mobile-web-app-status-bar-style` 原按明暗二值硬编码写死，现与 theme-color 一起由 `applyThemeChrome(appearance, manifest)` 统一发布；`ThemeManifest` 的两个可选覆盖字段（`themeColor` 取**令牌名**、`statusBar` 取 iOS 关键字）已落地并被断言覆盖 |
| 跨设备偏好同步 | 沿用现有偏好存储，新增 `themeId` 一个键即可；边界见 §5.6 |

### 5.10 可访问性（a11y）约束

初稿完全未覆盖 a11y。用户主题（尤其选项 B）可轻易写出不可用界面，须写入契约：

- **对比度**：内置主题必须过 WCAG AA（正文小字 ≥ 4.5:1，大字 / 图形 ≥ 3:1）；选项 A 的令牌校验器附带**非阻断**对比度警告
- **焦点可见性**：`--ring` 与 `--background` 对比度 ≥ 3:1，作为**硬性条款**（键盘用户依赖它定位焦点）
- **不以颜色单独传达状态**：diff 增删、Git lane、状态标签可以换色，但不得去掉非颜色标识（图标 / 符号 / 纹理），保证色盲可用
- **验收**：内置主题纳入 §5.11 契约测试的对比度断言

> **v1（1-H 落地）**：上面那条"正文 ≥ 4.5:1"的**主语是有分叉的**——"正文小字"若只指 `--foreground`，基色浅色以 18.20:1 轻松通过；若含 `--muted-foreground`（次要文字，UI 里大量小字），基色浅色只有 **4.42:1**，低于下限。1-H 按后者（宽读）落地：主句"必须过 WCAG AA"是规则、括号是举例，故让主句为真，而不是削弱它。为此**有意改动出厂配色**：`--palette-sand-500` `40 5% 44% → 43%`（4.42:1 → 4.59:1）。这不是可选项——accent 类覆盖层不重调 substrate，基色不达标会连带拉垮它们（`cc-ocean` 同为 4.42，只有自带 `sand-500` 的 `cc-polar` 幸免），把基色修好等于同时修好一类主题。断言实际纳入 6 个配对（见 §5.11 v8），其中按钮文字一对由两套覆盖层的作者注释锚定为在范围内；**这不是穷举的文字×表面矩阵**，其余成对令牌（`--secondary-*` / `--accent-*` / `--popover-*` 等）留待逐对论证后再加。

> **v2（2-G 落地"用户主题只警告不阻断"这一半）**：句子里的两半此前只落地了前一半——内置主题的对比度由 §5.11 的浏览器断言守着（1-H），**用户主题那一半**（"选项 A 的令牌校验器附带**非阻断**对比度警告"）原写"留给选项 A 的校验器"，2-C 落地校验器时只做了形状、没做可读性，本片补上。落地形态是新增 `src/shared/userThemeContrast.ts`，把 §5.11 那 6 个配对抽成**单一来源**（`CONTRAST_PAIRS`，契约测试改为引用它，两处不可能再漂移），再加上三件东西：一张**出厂基色表**（`BASE_PAIR_COLORS`，7 个令牌 × 明暗）、一处 `HSL 三元组 → 8 位通道 → WCAG 比值`的纯函数、以及 `findContrastWarnings`。
>
> **关键裁定：未声明的那一侧以"出厂基色"为准。** §5.10 只写了"附带警告"，没写**另一侧的色值从哪来**——而选项 A 的主题经常只改一侧（文档自己的示例只改 `--primary` / `--ring`，全 `coverage: accent` 类都是这么写的），故这是必须拍板的分叉。三条候选里取第 ② 条（**基准＝出厂基色**，客户端新增一份基色真源 ＋ 一道契约测试钉住它）：① 只查"文件两侧都声明"的配对，对整个 accent 主题类失明，包括本文档自己的示例——交付它会得到一个"已实现"却抓不到它那个例子的警告；③ 应用后用既有探针读 computed 值，最准，但**只能在被应用之后**才说话（而这条警告最有用的一刻是"作者刚写完"），且 `system` 主题的另一半无话可说。② 同时满足"是校验器附带（编译期、纯函数）"与"抓得到记录里那类失败"。**它不是新发明的数据**：`tests/theme-tokens/token-baseline.json` 就是同一份基色的签入副本 ＋ 守护测试，②只是把它用到客户端。
>
> **射程与三处"不判"**：一份主题里，**未声明的配对也照判**（两侧都落回基色，而基色由 §5.11 断言过自己的下限，故任何一条返回的警告都是关于作者写过的东西）——这条替代了"未触及的配对就跳过"那种写法，后者与基色守卫重复且**不可观测**（实测基色 12 个配对全过、最紧 4.624）。真正停止判断的只有三种情形，各自都是真边界：① 一侧的值只有样式表能解析（引用跑到文件外）；② 引用成环；③ 值带 alpha（读作三元组会拿一个页面从未画过的颜色去判）。**沉默不是通过**——配对是被"不判"而不是被"通过"。**非阻断**照 §5.10 原意：`warnings` 与 `ignored` 是两个字段，`ignored` 是"这条没发生"、`warnings` 是"发生了、你可能不想要"，样式表照出。**通道**沿用既有分法：粘贴时在设置页显示（与失败文案同一位置、`role="status"` 而非 `alert`），**文件**主题与"应用时"走 `console.warn`（与 2-C 那些被丢条目同一通道）——设置页列文件不读内容，故控制台是文件作者唯一的通道。
>
> **手算示例（就是本文档 §5.5 那个示例）**：`{ "tokens": { "--primary": "175 84% 32%" } }` 恰得 **1 条**警告——浅色基色的 `--primary-foreground`（`210 40% 98%`）落在这个青绿上只有 **3.49:1**；深色基色落的是近黑，5.04:1，过。**该示例被抓到正是选 ② 的理由。**
>
> **v3（2-L 落地"文件主题的警告上界面"）**：v2 定下的通道分法里，文件主题只有控制台一条通道——那是从"设置页列文件不读内容"（2-D 特意如此）推出来的结论，但把"列文件不读内容"推成"永不显示"多推了一步：**应用时**的编译本来就要读内容，其报告只是从未被接进任何状态。本片把报告接进 `UserThemeStyleState.warnings`（与 `appliedId` 同进出：失败 / 清空即清、**替换加载期间保留旧报告**——页面穿的还是旧的那件），并随缓存存取（boot 恢复不重编译，报告不随缓存走则同一主题跨一次刷新就有两种可读性；无该字段或形状不合的缓存条目整条拒，与 fingerprint 失配同型）。设置页文件区在"已应用条目是文件"时显示报告；**粘贴主题不走此块**——它的报告有自己的时刻（粘贴成功时），同一份警告显示两遍会被读成两个问题。`console.warn` 保留：设置页不常开，文件作者常看的是终端——界面通道是加、不是换。

### 5.11 契约测试（比 grep 验收更可靠）

grep 只能证明"没有字面硬编码"，证明不了"每套主题的令牌全集可解析、明暗双分支都有值"。新增一组自动化契约测试：

- 遍历内置主题 CSS 与用户主题编译产物，断言 §5.9 定义的 L2 令牌全集在 `:root`、`.dark`、每套 `[data-theme]` 覆盖层中**取值非空且可解析**（含 `hsl(0 0% 8% / 0.7)` 这类 HSL+alpha 格式）
- 断言 `--ring` / `--background` 对比度 ≥ 3:1、正文对比度 ≥ 4.5:1
- 阶段 1 起：对"切换主题后终端 / 编辑器 / Git 图同时变化"做 `getComputedStyle`（含 xterm `options.theme` 重读后值）断言 / 快照
- **现成资产**：`src/shared/tests/syntaxTheme.test.ts`（0-B 由 chat 迁入）、`src/modules/chat/tests/markdownSyntaxThemeInjection.test.tsx`、`src/modules/code-editor/tests/markdownCodeBlockSyntaxTheme.test.tsx`（0-B 新增）已是语法高亮路径的护栏，予以保留并扩展；0-D 又补 `src/shared/tests/syntaxThemeTokenMap.test.ts`（编号冻结）与 `src/modules/code-editor/tests/editorThemeTokens.test.ts`（编辑器令牌）各一组

> **v4（0-A 已实现其中两项）**：`tests/theme-tokens/` 已落地"令牌全集可解析"与"明暗双分支都有值/无漂移"——它导入生产样式表，对每套明暗取全部自定义属性的 resolved 值并与签入基线逐位比对，另加 palette 无死令牌、颜色声明不绕过 palette 两项护栏（详见 §6 阶段 0-A 记录）。**对比度断言**（`--ring`/`--background` ≥ 3:1、正文 ≥ 4.5:1）与**遍历 `[data-theme]` 覆盖层**留待阶段 1——后者需要主题注册表先存在。运行：`npm run test:theme-tokens`（`UPDATE_THEME_BASELINE=1` 用于有意变更后刷新基线）。

> **v5（0-D 追加）**：fixture 的探针新增 `wrap: 'raw'` 形态，覆盖 `--editor-*` 这类"值即完整颜色表达式"的令牌（Tailwind 的 `hsl(var(--x))` 形态对它们会拼出无效的 `hsl(#282c34)`）。38 个编辑器颜色令牌已纳入基线的 `rendered` 层。**明暗两态共用同一规则集**这一点由 `editorThemeTokens.test.ts` 断言（`--cc-syntax-N` 槽位在两侧解析出不同值），可作为阶段 1"切换主题后编辑器同时变化"的最小前置证据。

> **v6（0-F 追加）**：fixture 多了"**消费者守卫**"这一层——不是查令牌自身，而是**把 JS 消费者真的装上再读它画出来的颜色**。已落地三份：`terminal-tokens.spec.ts`（xterm 主题）、`graph-lanes.spec.ts`（0-F1 新增：lane 色 ＋ `RefBadge` 的 HEAD 底色，后者用"同场渲染 `${hex}22` 作参考值"的方式断言，不写死 alpha）、`mobile-terminal-selection.spec.ts`（0-F2 新增：用桩 terminal 真装 `installMobileTerminalSelection` 后读回手柄 / 菜单的 computed 值）。三份都回到"改造前那串字面量/hex"，与 `terminal-tokens.spec.ts` 同一个思路——**JS 消费者是令牌契约的盲区，`readTokens` 那层看不到它们**。

> **v7（1-E 追加，覆盖面扩到覆盖层，并记一处如实边界）**：契约测试新增 `tests/theme-tokens/theme-overlays.spec.ts`，把"遍历每套覆盖层"这半做掉——它按 `BUILTIN_THEMES` 中 `appearance === 'system'` 的主题逐个遍历，断言（以 `coverage` 的承诺为准）每个覆盖层声明的值在浏览器里**按写的解析**、且"移动的令牌集合"**恰等于**它宣称的可达范围（正向 must-move ＋ 反向 must-not-move ＋ 第三重的 `derivedMoves` 收敛）；再加"覆盖层必须在任何 `@layer` 之外"（结构断言）与"浅色半不泄漏进暗色"两条机制性护栏。**对比度断言（§5.10）仍未做，连同"遍历"的完整化留 1-H。**
>
> **如实边界：语法高亮本轮不在任何覆盖层的可达范围内**。`--cc-syntax-1..7` 在 L1 里**没有对应的 `--palette-*` 条目**（是直接字面值），而 §8.9 已决"本轮不升语义名"。因此 `cc-polar` 这类 `full` 主题**不改语法高亮配色**——覆盖层测试的 `SURFACES` 里没有 `syntax` 组，是**如实反映边界而非漏写**。要把它纳入主题覆盖，得先做 §8.9 的改名／映射决策，属后续片。

> **v8（1-H 追加，对比度落地 ＋ 遍历闭合）**：新增 `tests/theme-tokens/contrast.spec.ts`，对"基色 ＋ 每套覆盖层" × 明暗两态断言 6 个配对（`--foreground` / `--muted-foreground` 各落 `--background` 与 `--card`、`--primary-foreground` 落 `--primary`、`--ring` 落 `--background` ≥ 3:1）。**基色纳入遍历是刻意的**：它是未选主题时的出厂外观，且 accent 覆盖层不重调 substrate，只走覆盖层会漏掉真正在发货的那一面（变异 A 即此证）。颜色取 fixture 的 `rendered` 层而非 `tokens`——令牌是三值对，只有被消费才成为颜色；为此给 `PROBES` 补 `--card` / `--primary-foreground` / `--ring`（基线随之 +6 行）。**未加探针的配对先断言令牌在 `rendered` 里、缺则点名报错**，否则 `undefined` 参与比较会恒假通过。遍历侧补反向守卫：样式表里每个 `[data-theme]` 块都必须属于已注册覆盖层、每个注册覆盖层都必须有块——"块存在但未注册"是这类遍历**按构造**会跳过的死 CSS。**用户主题的对比度仍只警告不阻断**（§5.10 留给选项 A 的校验器，属阶段 2），本片只覆盖内置主题。

> **v9（2-G 追加：配对表成为单一来源 ＋ 新增一道"基色表＝浏览器"的护卫）**：§5.10 的对比度警告落地时需要一份**校验器能离线使用的基色**，而"校验器用的基色"和"本片量的基色"若是两份数据，就会各自漂移。故本片做了两件事：① 把 6 个配对抽到 `src/shared/userThemeContrast.ts` 的 `CONTRAST_PAIRS`，`contrast.spec.ts` 改为引用它——**一处定义，两处消费**，契约测试与用户主题警告不可能对"哪些配对、各是什么下限"给出两个答案；② 对每个被配对点名的令牌，逐字断言 `BASE_PAIR_COLORS[外观][令牌]` **等于**样式表解析出的值，并断言用它算出的比值与浏览器画出的比值**相差 < 0.01**——**同一条测试同时钉住表与算法**。这条护卫不是形式：一条与守卫不一致的警告比没有警告更糟，因为警告是会被照做的。
>
> 顺带记两处实现约束：① 比值必须按**8 位通道取整后**算（`--muted-foreground` 落 `--background`：取整 **4.62**、不取整 4.59），否则校验器会与上面那条浏览器断言在边界主题上给出不同答案；② `BASE_PAIR_COLORS` **只放被配对点名的 7 个令牌**，不放整份基色盘——它要回答的是"未声明的那一侧是什么"，而只有配对里的令牌会被问到。

### 5.12 Git 图 lane 色的数量上限（避免穷举）

`--graph-lane-1..10` 假设 lane ≤ 10，但活跃分支多的仓库（monorepo 尤甚）易超。方案：

- 默认保留 `--graph-lane-1..10` 显式令牌（便于主题精调）
- 超过 10 条时用参数化回退：定义 `--graph-lane-base-hue` / `--graph-lane-hue-step`，第 N 条 lane 取 `hsl(calc(base + step × (N-1)), 70%, 55%)`——在 `commitGraph.ts` 的 JS 侧计算最稳妥（不依赖 `@property` 的浏览器支持），主题只需覆盖两个参数即可控制整张图色系

> **v2（0-F1 实施后）**：0-F1 只做了上一条——10 个显式令牌已落地（L1 `--palette-graph-1..10` ＋ L2 `--graph-lane-1..10`），`laneColor` 对 `lane % 10` 回绕到 1..10，**与改造前的 `GRAPH_COLORS[lane % 10]` 行为逐位一致**（零变化片，由 `graph-lanes.spec.ts` 常驻断言）。**第二条参数化回退未做，且不能顺手做**：回绕与 HSL 旋转在 lane ≥ 10 时给出**不同的颜色**，落地它就是一处**有意的视觉变更**（只影响活跃分支 >10 的仓库，但"零变化"承诺会被破掉），须按本线规矩先列取舍、单独拍板、单独记账。故 §5.12 的这一半当前状态为**待拍板**。

> **v3（2-J 已实施，2026-09-26）**：第二条已落地。`laneColor` / `laneTint` 对 lane ≥ 10（0 基索引，即第 11 条起）改走 `hsl(calc(var(--graph-lane-base-hue) + var(--graph-lane-hue-step) × lane) 70% 55%)`（tint 带 ` / calc(34 / 255)`），**前 10 条 lane 的显式令牌路径逐位不变**——§5.12 原文的公式（`step × (N-1)`，N 为 1 基 lane 号）在 JS 的 0 基索引下就是 `step × lane`；S / L 固定 `70% / 55%`，不参数化（原文只授了两个参数）。两个参数声明在 `:root`（主题可覆盖），JS 只引用 `var()`、不依赖 `@property`（照原文"JS 侧计算最稳妥"）。**默认值 `315.3` / `95.1` 由搜索选出**：目标函数是 min(与出厂 10 色的最近色相距离, 回退 lane 彼此的最近距离) 在前 14 条回退 lane 上最大化，得 **8.1° / 20.4°**——与 10 个固定色相共享 360° 色环时这已是数学上限附近（整数网格穷举证明 ≤8°）；"step=137 黄金角"的直觉被否——它对这套出厂色相最近只有 3°。**有意视觉变更随开工拍板**（用户在 2-I 收官汇报"做它需要先拍板那次颜色变化"后回"继续"）：活跃分支 >10 的仓库里 lane 11+ 不再重复 lane 1..10 的颜色；≤10 lane 的仓库逐位不变。护栏：`graph-lanes.spec.ts` 两条新用例（calc 与纯数字 reference 在真引擎逐字节同色、回退 lane 不撞令牌 lane 且彼此互异、参数可覆盖且回原）；参数默认值由 `token-baseline.json` 逐字钉住（＋4 行）；`commitGraph.test.ts` 两条单测钉住表达式形状。变异 8/8 RED。

---

## 6. 落地路径

### 阶段 0：令牌收口（无新功能，纯重构）

**拆分口径（v3 已决）：按模块分片 + 机器可校验豁免清单，每片独立合入 / 独立验收 / 独立可回滚。严禁一次性大 PR。**

分片序列（按依赖顺序）：

| 片 | 内容 | 为什么在这个位置 |
|---|---|---|
| 0-A ✅ | **palette 层 + L2 引用改写**（§5.1 的两步）——**已实施，见本节末 0-A 记录** | 纯 CSS，不碰 JS，最容易验证 |
| 0-B ✅ | **语法高亮路径统一**：`MarkdownCodeBlock.tsx` 从直连 Prism 切到 `--cc-syntax-*`——**已实施，见本节末 0-B 记录** | 已有测试护栏（`syntaxTheme.test.ts`、`markdownSyntaxThemeInjection.test.tsx`） |
| 0-C ✅ | **终端（xterm）令牌化**——**已实施，见本节末 0-C 记录** | 独立模块，改动集中，可单独测 |
| 0-D ✅ | **编辑器（CodeMirror）令牌化**：UI 主题 + `HighlightStyle` 两套——**已实施，见本节末 0-D 记录**；同时补完 §5.9 要求的 `SYNTAX_TOKEN_MAP` 三件事（0-B 漏做） | 改动较深，单独一片便于回滚 |
| 0-E0 ✅ | **豁免清单 + 待迁移基线 + 护栏**——**已实施，见本节末 0-E0/0-E1 记录** | 与 A1/B 选型无关，先建验证设施，后续每片才有可测的收敛口径 |
| 0-E1 ✅ | **保值档位令牌层**（`--palette-gray-*` / `--n-*` / Tailwind `n-*` 键）+ **等值护栏**——**已实施，见本节末 0-E0/0-E1 记录** | A1 的地基；类替换本身属 0-E2+ |
| 0-E1b ✅ | **非 gray 族档位层**（`zinc` / `slate` / `neutral` 各 11 档；`stone` 不建）+ 等值护栏泛化到 `(族, 档)`——**已实施，见本节末 0-E1b 记录** | 122 处非 gray 替换的地基；同样不改 TSX |
| 0-E2a ✅ | **类级等值护栏 + 旧式 opacity 共现护栏**（并处置实测到的 2 处隐雷）——**已实施，见本节末 0-E2 记录** | 补上"令牌类**可以**正确承载值"的机器证明；共现护栏清掉一个改名即静默丢透明度的陷阱 |
| 0-E2b ✅ | **首个文件集群**：`AgentConnectionsStep.tsx` 60 → 0——**已实施，见本节末 0-E2 记录** | 非 gray 最集中（50/60）；同时含 gray 与 zinc/neutral，一次覆盖三种族 |
| 0-E2c ✅ | **配对层：中性色守恒律**（字面 byUsage ＋ 折叠后 `n-*` byUsage ≡ 冻结原始 byUsage，含防空转守卫）——**已实施，见本节末 0-E2c 记录** | 补上"换上去的令牌**是对的**"这一半机器证明；0-E2 的 V2（错档位）/ V3（丢修饰符）此前完全无人管 |
| 0-E2d ✅ | **首个热点文件集群**：`AskUserQuestionPanel.tsx` 84 → 0——**已实施，见本节末 0-E2d 记录** | 全仓 #1 热点；且构成最纯（84 处只有 gray / white 两族），是 A1 改名的最简形态。也是第一片在 0-E2c 的"双绿"门槛下通过的迁移 |
| 0-E2e ✅ | **扫描器覆盖面**：轴限定中性色（`border-t/b/l/r/x/y-*`、`divide-x/y-*`、`ring-offset-*`）纳入扫描器与守恒律，并同片清零新纳入的 15 处——**已实施，见本节末 0-E2e 记录** | 闭合"主题生效一半"的最后一类漏洞：此前这 15 处不在任何护栏视野内，阶段 0 收工也不会被扫到 |
| 0-E2f ✅ | **热点榜第二的文件集群**：`TaskDetailModal.tsx` 72 → 0——**已实施，见本节末 0-E2f 记录** | 0-E2d 之后最大单片；72 处只有 gray / white / black 三族、`text`/`bg`/`border` 三类工具、`dark:`/`hover:` 两种变体，是最标准的 A1 形态 |
| 0-E2g ✅ | **热点榜第三的文件集群**：`McpServerFormModal.tsx` 69 → 0——**已实施，见本节末 0-E2g 记录** | 密度最高的一片（69 处压在 17 行内）；族仅 gray / white / black，工具仅 `bg`/`text`/`border`，是最标准的 A1 形态 |
| 0-E2h ✅ | **热点榜第四的文件集群**：`TaskBoardToolbar.tsx` 60 → 0——**已实施，见本节末 0-E2h 记录** | 首个**零透明度修饰符**的片（60 处全无 `/alpha`）；族仅 gray / white；同文件品牌色 purple / blue 未动 |
| 0-E2i ✅ | **热点榜第五的文件集群**：`VersionUpgradeModal.tsx` 55 → 0——**已实施，见本节末 0-E2i 记录** | **token 数至今最多（31 个）**、档位最杂（同片 11 个档位）；首个自带**独占拼写**的片，首次实测条件式断言的 `0 → dist 为 0` 方向；首个拿到带透明度真实值链样本的片 |
| 0-E2j ✅ | **热点榜第六的文件集群**：`CodeEditorHeader.tsx` 52 → 0——**已实施，见本节末 0-E2j 记录** | 首个 `text` 远多于 `bg`（36 : 16）且完全不用 `border` 的片；`dark:` 系变体占一半（26/52）；同文件品牌色 blue / green（含带透明度拼写）未动 |
| 0-E2k ✅ | **热点榜第七的文件集群**：`FolderBrowserModal.tsx` 46 → 0——**已实施，见本节末 0-E2k 记录** | 首个带模态遮罩拼写（`bg-black/50`）的片；`border` 类占 8 处，在前七片热点里首次成规模；19 个 token 含 2 处带透明度，值链样本再次拿到 |
| 0-E2l ✅ | **热点榜第八的文件集群**：`TaskEmptyState.tsx` 46 → 0——**已实施，见本节末 0-E2l 记录** | 带透明度 4 处**全部集中在同一 token**（`dark:bg-gray-800/60`）——首个透明度不分散的片；`border` 仅 2 处、`black` 0 处；`white` 12 处 |
| 0-E2m ✅ | **热点榜第九的文件集群**：`AccountContent.tsx` 41 → 0——**已实施，见本节末 0-E2m 记录** | **首个跨四族混合片**（gray 16 / zinc 13 / neutral 11 / white 1）；**40 个 distinct token 至今最多**（41 处几乎一 token 一次）；首次**批量**拿到独占拼写（27 个，前九片仅 0-E2i 有 1 个）；带透明度样本首次覆盖非 gray 族（`zinc-900/20`、`neutral-900/20`）；首现 950 档（`active:bg-gray-950` / `active:bg-zinc-950`） |
| 0-E2n ✅ | **热点榜第十的文件集群**：`toolConfigs.ts` 38 → 0——**已实施，见本节末 0-E2n 记录** | 首个**类名映射表**（`.ts` 配置，`primary` / `secondary` / `border` / `icon` 四类槽位）的片；**纯 `gray`、零 `bg`**（`text` 32 ／ `border` 6）；token 同质度最高（9 个 token 覆盖 38 处） |
| 0-E2o ✅ | **热点榜第十一的文件集群**：`QuestionAnswerContent.tsx` 35 → 0——**已实施，见本节末 0-E2o 记录** | **首个含豁免的片**（`border-gray-150` 保留，迁移脚本首次引入豁免过滤）；**带透明度 5 处、历片最多**，首次覆盖 `dark:hover:` 复合变体的透明度值链；档位跨度最广（gray 50 起） |
| 0-E2p ✅ | **热点榜第十二的文件集群**：`NextTaskBanner.tsx` 33 → 0——**已实施，见本节末 0-E2p 记录** | **首个 `slate` 主导的片**（slate 20 / gray 8 / white 5）；首次在产物里验证 `slate` 族完整令牌链（`hsl(var(--n-slate-900) / .3)`）；22 个 token 压在 13 行内 |
| 0-E2q ✅ | **热点榜第十三的文件集群**：`TaskMasterSetupModal.tsx` 32 → 0——**已实施，见本节末 0-E2q 记录** | 三工具最均衡的片（`bg` 12 ／ `border` 8 ／ `text` 12）；含模态遮罩 `bg-black/50` 与卡面 `dark:bg-gray-800/50` 两处带透明度；`bg-black/50` ⊂ `bg-black` 前缀陷阱再次实测安全 |
| 0-E2r ✅ | **热点榜第十四的文件集群**：`GithubAuthenticationCard.tsx` 31 → 0——**已实施，见本节末 0-E2r 记录** | 中段档位最集中的片（`gray-300/400/500/600/700` 五档合计 21/31）；带透明度 1 处 `dark:bg-gray-900/50`；无独占拼写（字面全部仍被其他文件消费） |
| 0-E2s ✅ | **热点榜第十五的文件集群**：`PrdEditorHeader.tsx` 30 → 0——**已实施，见本节末 0-E2s 记录** | 零透明度片；工具类含 `placeholder` 2 处（`placeholder-gray-400` / `dark:placeholder-gray-500`）；**2 个原子归零**（`placeholder: gray-400` / `placeholder: gray-500` 各 1→0），与 2 个"迁移后全仓零消费"的字面一一对应 |
| 0-E2t ✅ | **热点榜第十六的文件集群**：`GenerateTasksModal.tsx` 30 → 0——**已实施，见本节末 0-E2t 记录** | 三工具最均衡（`bg` 11 ／ `border` 8 ／ `text` 11）；含模态遮罩 `bg-black/50`（本片唯一带透明度）；档位缺 `gray-500`、含 `black`；21 个字面在 `src/` 均仍有其他消费者（**0 独占拼写**，最小 2 处） |
| 0-E2u ✅ | **热点榜第十七的文件集群**：`CreateTaskModal.tsx` 30 → 0——**已实施，见本节末 0-E2u 记录** | 与 0-E2t **逐 token 同构的姊妹文件**（21 个 token 及计数完全一致，仅品牌色族 `purple-*` → `blue-*`）；三工具均衡（`bg` 11 ／ `border` 8 ／ `text` 11）；含模态遮罩 `bg-black/50`；**0 独占拼写**（最小 1 处） |
| 0-E2v ✅ | **热点榜第十八的文件集群**：`TaskHelpModal.tsx` 30 → 0——**已实施，见本节末 0-E2v 记录** | `text` 为主（`text` 17 ／ `bg` 7 ／ `border` 6）；**带透明度 2 处**（`bg-black/50` 与 `dark:bg-gray-800/50`），两处值链均实测；密度 30 处 / 13 行 |
| 0-E2w ✅ | **热点榜第十九的文件集群**：`TaskCard.tsx` 30 → 0——**已实施，见本节末 0-E2w 记录** | 跨两族（`gray` 24 ＋ `slate` 4 ＋ `white` 2）；**4 个 slate 原子归零**（`slate-100/400/500/900` 各 1→0，本片是其字面唯一消费者）；零透明度（值链检查真空转） |
| 0-E2x ✅ | **热点榜第二十的文件集群**：`fileIcons.ts` 28 → 0——**已实施，见本节末 0-E2x 记录** | **token 数与 `byAtom` 减量条目都只有 2 个**（`text-gray-500` ×21、`text-gray-400` ×7，28 处全落在这两个桶内）；纯 `text`、零 `bg` / `border` / 透明度；28 处落在 28 行（一行一处） |
| 0-E2y ✅ | **热点榜第二十一的文件集群**：`TaskListContent.tsx` 24 → 0——**已实施，见本节末 0-E2y 记录** | 纯 `gray` 单族、8 档（`gray-100…800`）；`text` 18 ／ `bg` 4 ／ `border` 2；零透明度；密度 24 处 / 10 行；**0 独占拼写**（最小 1 处 = `dark:text-gray-100`） |
| 0-E2z ✅ | **热点榜第二十二的文件集群**：`MessageComponent.tsx` 24 → 0——**已实施，见本节末 0-E2z 记录** | 无 `border`（`text` 19 ／ `bg` 5）；含 `dark:bg-gray-800/60`（**60% 透明度**）；**2 个字面归零但 0 个原子桶归零**——首次实证"桶粒度粗于字面粒度"，修正了此前"桶归零 ⟺ 字面归零"的简化理解 |
| 0-E3a ✅ | **热点榜第二十三的文件集群**：`CodeEditorBinaryFile.tsx` 23 → 0——**已实施，见本节末 0-E3a 记录** | 密度最高的片之一（**23 处仅落在 6 行**，同一 className 串被三处按钮复用）；跨三色 `gray` 17 ＋ `white` 5 ＋ `black` 1；`text` 16 ／ `bg` 7、零 `border`；含 `md:bg-black/50`（**首个 `md:` 变体**）；**0 独占拼写**（最小 3 处） |
| 0-E3b ✅ | **热点榜第二十四的文件集群**：`CodeEditorMediaPreview.tsx` 22 → 0——**已实施，见本节末 0-E3b 记录** | 与 0-E3a **同模块姊妹组件**（同一 6 类 className 串被 3 处复用）；跨三色 `gray` 16 ＋ `white` 5 ＋ `black` 1；`text` 14 ／ `bg` 8、零 `border`、含 `bg-white`（PDF iframe 背景）；含 `md:bg-black/50`；**首次触发产物核对脚本的覆盖面缺口**——`index.css` 以字面类名作选择器目标，脚本却只扫 `.tsx?` |
| 0-E3c ✅ | **热点榜第二十五的文件集群**：`TaskFiltersPanel.tsx` 22 → 0——**已实施，见本节末 0-E3c 记录** | 与 0-E2h 的 `TaskBoardToolbar.tsx` 同模块（本片由后者渲染）；跨 `gray` 19 ＋ `white` 3；`bg` 8 ／ `text` 8 ／ `border` 6；**22 处仅落 8 行**（3 个 `<select>` 复用同一 `w-full rounded-md border … dark:bg-gray-800` 串）；零透明度；**0 独占拼写**（最小 2 处） |
| 0-E3d ✅ | **热点榜第二十六的文件集群**：`TaskQuickSortBar.tsx` 18 → 0——**已实施，见本节末 0-E3d 记录** | 与 0-E2h / 0-E3c 同属 `TaskBoardToolbar` 一族；**6 个 token 各恰好 ×3**（3 个按钮复用同一 `bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:…` 串），18 处仅落 3 行；纯 `gray`、零 `border` / 透明度；含 `hover:` / `dark:hover:` 变体；**1 个字面（`hover:bg-gray-200`）迁移后全仓零消费**（`src=0` 且 `dist=0`，Tailwind 不再生成该规则） |
| 0-E3e ✅ | **热点榜第二十七的文件集群**：`OverwriteConfirmModal.tsx` 18 → 0——**已实施，见本节末 0-E3e 记录** | 18 处落在 **17 个不同 token** 上（16 个各仅 1 次、唯 `bg-white` 2 次）——与 0-E3d 的"6 token 各 ×3"互为另一极端；跨 `gray` / `white` / `black`；含模态遮罩 `bg-black/50`（值链实测 50%）；`hover:bg-gray-50` 是 `index.css` 选择器目标之一（迁后仍有 2 个 src 消费者）；**1 字面归零但 0 桶归零**（`dark:hover:bg-gray-600`） |
| 0-E3f ✅ | **热点榜第二十八的文件集群**：`StepReview.tsx` 18 → 0——**已实施，见本节末 0-E3f 记录** | 18 处落 8 行；`text` 14 ／ `bg` 2 ／ `border` 2；纯 `gray` ＋ `white`；含 `dark:bg-gray-900/50`（50% 透明度，值链实测）；同文件蓝色信息卡（`border-blue-200` / `dark:bg-blue-900/20` 等）未触碰；**0 独占拼写**（最小 1 处） |
| 0-E3g ✅ | **热点榜第二十九的文件集群**：`SidebarProjectItem.tsx` 16 → 0——**已实施，见本节末 0-E3g 记录** | 16 处 / 12 token / 7 行；含 `bg-gray-500/10`（10%）与 `dark:bg-gray-900/30`（30%）**两处透明度**，值链均实测；`bg-gray-500` 一族（裸 / `/10` / `hover:` / `dark:hover:`）在本片集中；**7 个派生字面迁后 `src=0`（本片是其唯一消费者）、其中 2 个原子桶归零**（`bg: gray-400`、`border: gray-800` 各 1→0） |
| 0-E3h ✅ | **热点榜第三十的文件集群**：`taskKanban.ts` 16 → 0——**已实施，见本节末 0-E3h 记录** | 16 处 / 16 token / **4 行**（每 token 恰好 ×1）——`color` + `headerColor` 两串各 4 个 token、两列复用；跨 `slate` 8 ＋ `gray` 8；`bg` 8 ／ `border` 4 ／ `text` 4；含 `dark:bg-slate-900/50` 与 `dark:bg-gray-900/50` **两处 50% 透明度**，值链均实测；**同一 `KANBAN_COLUMN_CONFIG` 里 6 列语义色交错**——pending=slate、cancelled=gray 属中性待迁，in-progress=blue ／ done=emerald ／ blocked=red ／ deferred=amber 四列语义彩色**非本线范围、未触碰**；**9 个派生字面迁后 `src=0`（本片是其唯一消费者）、其中 7 个原子桶归零** |
| 0-E3i ✅ | **热点榜并列第十四的文件集群**：`ImageViewer.tsx` 14 → 0——**已实施，见本节末 0-E3i 记录** | 14 处落 **7 行**（每行 light＋dark 成对）；纯 `gray` ＋ `white`；档位 `gray-50/400/500/600/800/900` ＋ `white`；`text` 9 ／ `bg` 4 ／ **零 `border`**；**零透明度**（同文件第 62 行遮罩 `bg-black/50` 已是前片令牌 `bg-n-black/50`，本片未触碰）；**该文件已含前片遗留令牌——首次触发产物核对脚本的"前提假设缺口"**：脚本原假设被测文件迁移前不含 `n-*`，反向还原会把遗留令牌一并还原、永远无法等于备份，已改为**正向重放**并回归验证（见 0-E3i 记录）；**0 字面迁后归零、0 桶归零**（本片 9 个派生字面在全仓都有别的消费者，最小 4 处） |
| 0-E3j ✅ | **热点榜并列第十四的文件集群**：`ProjectCreationWizard.tsx` 14 → 0——**已实施，见本节末 0-E3j 记录** | 14 处落 **5 行**（其中 3 行是同一模态外壳串的复用）；跨 `gray` 12 ＋ `white` 1 ＋ `black` 1；`bg` 6 ／ `border` 4 ／ `text` 4；含模态遮罩 `bg-black/50`（值链实测 50%）与**响应式 `sm:` 前缀**（全屏 → `sm:rounded-lg sm:border`）；变体含 `hover:` / `dark:hover:`；**0 字面迁后归零、0 桶归零**（本片 12 个派生字面在全仓都有别的消费者，最小 2 处） |
| 0-E3k ✅ | **热点榜并列第十四的文件集群**：`ShellHeader.tsx` 14 → 0——**已实施，见本节末 0-E3k 记录** | 14 处落 **6 行**；族 `gray` 13 ＋ `white` 4（`text-white` 与 `hover:text-white` 各 2）；`text` 8 ／ `border` 3 ／ `bg` 3；**两处透明度**（`border-gray-600/80` 80%、`bg-gray-700/70` 70%，值链均实测）；含 `disabled:text-gray-500` 伪类状态；**同一 className 串内语义彩色（orange / red / blue）未触碰**；**文件含 3 处前片遗留令牌 `focus:ring-offset-n-gray-800`——正向重放第二次复用（遗留令牌还原出的字面在备份中不存在、自动落选）**；**3 字面迁后全仓零消费、0 桶归零**（同桶另有别变体字面存活） |
| 0-E3l ✅ | **热点榜并列第十四的文件集群**：`TaskBoardContent.tsx` 14 → 0——**已实施，见本节末 0-E3l 记录** | 14 处落 **7 行**；族 `gray` 12 ＋ `white` 1 ＋ `black` 1；`text` 8 ／ `bg` 6（无 `border`）；**两处透明度**（`bg-white/60` 60%、`dark:bg-black/20` 20%，值链均实测）；变体含裸类 / `dark:`；属于看板"暂无任务"空态与卡片计数徽标；**4 字面迁后全仓零消费、1 桶归零**（`bg: gray-300` 1→0；同桶另有别变体字面存活，`dark:bg-gray-600` 字面已全仓零消费但 `bg: gray-600` 桶仍存 1） |
| 0-E3m ✅ | **热点榜并列第十二的文件集群**：`ToolDiffViewer.tsx` 12 → 0——**已实施，见本节末 0-E3m 记录** | 12 处落 **4 行**（含一行状态串、一行容器、一行头部、一行文本）；族 `gray` 12；档位 `gray-50 / 100 / 200 / 500 / 600 / 700 / 800`；`text` 4 ／ `border` 4 ／ `bg` 4；**4 类透明度 / 6 处**（`border-gray-200/60`、`dark:border-gray-700/50` 各 ×2，`bg-gray-50/80`、`dark:bg-gray-800/40` 各 ×1，值链均实测）；变体含裸类 / `dark:`；属工具 diff 视图的头部条与状态文字；**3 字面迁后全仓零消费、0 桶归零**（同桶另有别变体字面存活） |
| 0-E3n ✅ | **热点榜并列第十二的文件集群**：`MarkdownPreview.tsx` 12 → 0——**已实施，见本节末 0-E3n 记录** | 12 处落 **5 行**（markdown 渲染器的引用块 / 表格 / 表头 / 单元格等 element 映射）；族纯 `gray` 12；档位 `gray-50 / 200 / 300 / 400 / 600 / 700 / 800`；`border` 8 ／ `text` 2 ／ `bg` 2；**零透明度**；变体含裸类 / `dark:`；**2 字面迁后全仓零消费、1 桶归零**（`border: gray-300` 1→0；`dark:border-gray-600` 字面已全仓零消费但 `border: gray-600` 桶仍存 2） |
| 0-E3o ✅ | **热点榜并列第十二的文件集群**：`UserMessageStickyHeader.tsx` 12 → 0——**已实施，见本节末 0-E3o 记录** | 12 处落 **4 行**（一条 sticky 提示条外壳串 + 两处图标 + 一处文本）；族 `gray` 11 ＋ `white` 1；档位 `gray-100 / 200 / 400 / 500 / 700 / 800` ＋ `white`；`text` 6 ／ `bg` 4 ／ `border` 2；**两处透明度均 95%**（`bg-white/95`、`dark:bg-gray-800/95`，值链实测）；变体含裸类 / `hover:` / `dark:hover:`；**2 字面迁后全仓零消费、0 桶归零**（同桶另有别变体字面存活） |
| 0-E3p ✅ | **热点榜并列第十一的文件集群**：`TerminalShortcutsPanel.tsx` 11 → 0——**已实施，见本节末 0-E3p 记录** | 11 处落 **4 行**（含两行按钮串复用 ＋ 一行蓝底按钮 ＋ 一行外壳）；族 `gray` 8 ＋ `white` 3；档位 `gray-100 / 600 / 700 / 900` ＋ `white`；`text` 5 ／ `bg` 3 ／ `border` 3；**两处透明度**（`border-gray-700/80` 80%、`bg-gray-900/95` 95%，值链均实测）；变体含裸类 / `active:`；**同一 className 串内语义彩色（blue-500/600）未触碰**；**3 字面迁后全仓零消费、1 桶归零**（`border: gray-600` 2→0；`active:text-white` / `bg-gray-900/95` 字面已全仓零消费但 `text: white` / `bg: gray-900` 桶仍有存活） |
| 0-E3q ✅ | **热点榜并列第十一的文件集群**：`TextContent.tsx` 11 → 0——**已实施，见本节末 0-E3q 记录** | 11 处落 **3 行**（两行 `<pre>` 代码块串 ＋ 一行纯文本 `<div>`）；族纯 `gray` 11；档位 `gray-50 / 100 / 200 / 300 / 700 / 800 / 900 / 950`；`text` 5 ／ `bg` 4 ／ `border` 2；**三处透明度均 50%**（`border-gray-200/50`、`dark:border-gray-700/50`、`dark:bg-gray-800/50`，值链均实测）；变体含裸类 / `dark:`（4 个）；**4 字面迁后全仓零消费、0 桶归零**（9 个桶均仍有别变体字面存活，如 `bg: gray-950` 4→3） |
| 0-E3r ✅ | **热点榜并列第十一的文件集群**：`BrowserUsePanel.tsx` 11 → 0——**已实施，见本节末 0-E3r 记录** | 11 处落 **9 行**（插件面板空态 ＋ 截图热点标记 ＋ 全屏遮罩覆盖层）；族 `white` 5 ＋ `neutral` 4 ＋ `black` 2；档位 `white` / `black` / `neutral-100 / 400 / 500 / 950`；`text` 5 ／ `bg` 4 ／ `border` 2；**五处透明度（4 类）**（`border-white/90` 90%、`border-white/10` ×2 10%、`bg-black/90` 90%、`text-white/80` 80%，值链均实测）；变体全为裸类；**8 字面迁后全仓零消费、4 桶归零**（`bg: neutral-950`、`text: neutral-100 / 400 / 500` 1→0；`border: white` 4→1、`bg: black` 19→17、`bg: white` 14→13、`text: white` 40→39 仍有别变体存活） |
| 0-E3s ✅ | **热点榜并列第十的文件集群**：`QuickSettingsHandle.tsx` 10 → 0——**已实施，见本节末 0-E3s 记录** | 10 处落 **4 行**（快捷设置面板滑出把手的外壳串与两枚方向图标）；族 `gray` 9 ＋ `white` 1；档位 `gray-100 / 200 / 400 / 600 / 700 / 800` ＋ `white`；`text` 4 ／ `bg` 4 ／ `border` 2；**零透明度**；变体含裸类 / `hover:` / `dark:` / `dark:hover:`；**0 字面全仓零消费、0 桶归零**（8 个字面迁后全仓均另有存活，src 最小 2） |
| 0-E3t ✅ | **热点榜并列第十的文件集群**：`WorkspacePathField.tsx` 10 → 0——**已实施，见本节末 0-E3t 记录** | 10 处落 **4 行**（工作区路径自动补全下拉：建议列表外壳 ＋ 单条建议项 ＋ 两行名称/路径）；族 `gray` 9 ＋ `white` 1；档位 `gray-100 / 200 / 400 / 500 / 700 / 800 / 900` ＋ `white`；`text` 5 ／ `bg` 3 ／ `border` 2；**零透明度**；变体含裸类 / `hover:` / `dark:` / `dark:hover:`；**10 token 各 ×1、0 字面全仓零消费、0 桶归零** |
| 0-E3u ✅ | **热点榜并列第九的文件集群**：`ProviderLoginModal.tsx` 9 → 0——**已实施，见本节末 0-E3u 记录** | 9 处落 **4 行**（供应商登录模态框：对话框外壳 ＋ 标题栏 ＋ 关闭按钮）；族 `gray` 8 ＋ `white` 1；档位 `gray-200 / 300 / 400 / 600 / 700 / 800 / 900` ＋ `white`；`text` 5 ／ `bg` 2 ／ `border` 2；**本片零透明度**；变体含裸类 / `hover:` / `dark:` / `dark:hover:`；**文件含前片遗留令牌 `bg-n-black/50`（第 3 次撞上，未动）**；**9 token 各 ×1、0 字面全仓零消费、0 桶归零** |
| 0-E3v ✅ | **热点榜并列第九的文件集群**：`WizardProgress.tsx` 9 → 0——**已实施，见本节末 0-E3v 记录** | 9 处落 **5 行**（项目创建向导步骤条：步骤圆点状态三元 ＋ 步骤标签）；族 `gray` 7 ＋ `white` 2；档位 `gray-200 / 300 / 500 / 700` ＋ `white`；`text` 5 ／ `bg` 4；**零透明度**；变体含裸类 / `dark:`；**同一 className 串内语义彩色 `bg-green-500` / `bg-blue-500` 未触碰**；**0 字面全仓零消费、0 桶归零** |
| 0-E3w ✅ | **热点榜并列第八的文件集群**：`SidebarModals.tsx` 8 → 0——**已实施，见本节末 0-E3w 记录** | 8 处落 **8 行**（4 个侧栏模态框，各含一行遮罩 `bg-black/60` ＋ 一行危险操作按钮 `text-white`）；族 `black` 4 ＋ `white` 4；仅 2 个 token 各 ×4；`bg` 4 ／ `text` 4；**四处 60% 透明度**（`bg-black/60`，值链实测）；变体全为裸类；**同一 className 串内语义红 `bg-red-600` / `hover:bg-red-700` 未触碰**；**0 字面全仓零消费、0 桶归零** |
| 0-E3x ✅ | **热点榜并列第八的文件集群**：`ExecutionProcessSummary.tsx` 8 → 0——**已实施，见本节末 0-E3x 记录** | 8 处落 **2 行**（执行过程折叠摘要：供应商标签行 ＋ 折叠按钮行）；族 `gray` 7 ＋ `white` 1；档位 `gray-100 / 200 / 400 / 500 / 700 / 800 / 900` ＋ `white`；`text` 6 ／ `bg` 2；**零透明度**；变体含裸类 / `hover:` / `dark:` / `dark:hover:`；**两行 className 串内无语义彩色**；**3 字面迁后全仓零消费、0 桶归零** |
| 0-E3y ✅ | **热点榜并列第八的文件集群**：`PrdEditorFooter.tsx` 8 → 0——**已实施，见本节末 0-E3y 记录** | 8 处落 **3 行**（PRD 编辑器页脚：外壳行 ＋ 统计行 ＋ 快捷键提示行）；族纯 `gray` 8；档位 `gray-50 / 200 / 400 / 500 / 600 / 700 / 800`；`border` 2 ／ `bg` 2 ／ `text` 4；**零透明度**；变体含裸类 4 / `dark:` 4；**无伪类**；**3 行 className 串内无语义彩色**；**0 字面归零、0 桶归零** |
| 0-E3z ✅ | **热点榜并列第八的文件集群**：`ChatMessagesPane.tsx` 8 → 0——**已实施，见本节末 0-E3z 记录** | 8 处落 **4 行**（聊天消息面板：模块级顶部饰条槽位类常量 ＋ 加载态提示行 ＋ 两处加载旋转器）；族纯 `gray` 8；档位 `gray-200 / 400 / 500 / 700`；`border` 4 ／ `text` 4；**零透明度**；变体含裸类 5 / `dark:` 3；**无伪类**；**触碰 4 行串内无语义彩色**（文件他处 `text-blue-600` / `dark:text-blue-400` 链接色未触碰）；**1 字面归零、1 桶归零**（`border: gray-400` 2→0） |
| 0-E4a ✅ | **热点榜并列第八（榜末）的文件集群**：`StepConfiguration.tsx` 8 → 0——**已实施，见本节末 0-E4a 记录** | 8 处落 **4 行**（项目创建向导配置步骤，与 0-E3j 同模块：两处 `label` 字段标签 ＋ 两处 `p` 帮助文案，`label`/`p` 各成对复用同一串）；族纯 `gray` 8；档位 `gray-300 / 400 / 500 / 700`；工具类 `text` 8；**零透明度**；变体裸类 4 / `dark:` 4；**无伪类**；**4 行串内无语义彩色**（文件全仓零语义彩色）；**2 字面归零、1 桶归零**（`text: gray-700` 2→0） |
| 0-E4b ✅ | **热点榜并列第七的文件集群**：`ShellConnectionOverlay.tsx` 7 → 0——**已实施，见本节末 0-E4b 记录** | 7 处落 **7 行**（Shell 连接遮罩三态：loading / connect / connecting 各含一行全屏遮罩串）；族 `gray` 6 ＋ `white` 1；档位 `gray-100 / 300 / 950` ＋ `white`；`bg` 3 ／ `text` 4；**带透明度 1 类 / 3 处，均 90%**（`bg-gray-950/90`，值链实测达 `--n-gray-950`）；变体**全为裸类**；**文件含前片遗留令牌 `focus:ring-offset-n-gray-950`（第 4 次撞上，未动）**；**同一 className 串内语义 emerald 未触碰**，他处 `text-blue-300` / `text-yellow-300` 亦未触碰；**2 字面归零、1 桶归零**（`bg: gray-950` 3→0） |
| 0-E4c ✅ | **热点榜并列第七的文件集群**：`MarkdownCodeBlock.tsx` 7 → 0——**已实施，见本节末 0-E4c 记录** | 7 处落 **2 行**（Markdown 行内代码 className：一 string 内 6 token、light/dark 成对，＋ 代码块语言角标）；族纯 `gray` 7；档位 `gray-100 / 200 / 400 / 700 / 800 / 900`；`border` 2 ／ `bg` 2 ／ `text` 3；**零透明度**；变体裸类 4 / `dark:` 3；**无伪类**；**两行串内无语义彩色**；**1 字面归零、1 桶归零**（`text: gray-100` 1→0） |
| 0-E4d ✅ | **热点榜并列第七的文件集群**：`Shell.tsx` 7 → 0——**已实施，见本节末 0-E4d 记录** | 7 处落 **4 行**（Shell 容器 ＋ 移动端底部条 ＋ 蓝色主按钮行 ＋ 灰色次按钮行）；族 `gray` 6 ＋ `white` 1；档位 `gray-600 / 700 / 800 / 900` ＋ `white`；`bg` 3 ／ `border` 1 ／ `text` 2 ／ `hover:bg` 1；**透明度 2 类 2 处**（`border-gray-700/80`、`bg-gray-800/95`）；变体裸类 6 / `hover:` 1；**同串语义蓝 `bg-blue-600` / `hover:bg-blue-700` 未触碰**；**1 桶归零**（`bg: gray-600` 1→0） |
| 0-E4e ✅ | **热点榜并列第七的文件集群**：`CommandMenu.tsx` 6 → 0——**已实施，见本节末 0-E4e 记录** | 6 处落 **1 行**（命令面板分组样式常量：常量对象字符串值，非 JSX 属性）；族纯 `gray` 6；档位 `gray-50 / 200 / 500 / 600`；`border` 2 ／ `bg` 2 ／ `text` 2；**透明度 2 类 2 处**（`dark:border-gray-500/20`、`dark:bg-gray-500/10`）；变体裸类 3 / `dark:` 3；**无伪类**；**串内无语义彩色**；**2 桶归零**（`bg: gray-500`、`border: gray-500`，均 1→0） |
| 0-E4f ✅ | **热点榜并列第七的文件集群**：`SessionOptions.tsx` 6 → 0——**已实施，见本节末 0-E4f 记录** | 6 处落 **2 行**（会话选项删除按钮：图标容器串 ＋ `X` 图标）；族纯 `gray` 6；档位 `gray-50 / 100 / 400 / 600 / 900`；`bg` 4 ／ `text` 2；**透明度 2 类 2 处**（`dark:bg-gray-900/20`、`dark:hover:bg-gray-900/40`）；变体裸类 2 / `hover:` 1 / `dark:` 1 / `dark:hover:` 1；**两行串内无语义彩色**；**0 桶归零** |
| 0-E4g ✅ | **热点榜并列第七的文件集群**：`SidebarContent.tsx` 6 → 0——**已实施，见本节末 0-E4g 记录** | 6 处落 **2 行**（侧栏会话项删除按钮，与 0-E4f 同构的复制串）；族纯 `gray` 6；档位 `gray-50 / 100 / 400 / 600 / 900`；`bg` 4 ／ `text` 2；**透明度 2 类 2 处**（`dark:bg-gray-900/20`、`dark:hover:bg-gray-900/40`）；变体裸类 2 / `hover:` 1 / `dark:` 1 / `dark:hover:` 1；**两行串内无语义彩色**；**0 桶归零** |
| 0-E4h ✅ | **热点榜并列第六的文件集群**：`SidebarRecentConversations.tsx` 6 → 0——**已实施，见本节末 0-E4h 记录** | 6 处落 **2 行**（侧栏"最近会话"项删除按钮：图标容器串 ＋ `X` 图标）；族纯 `gray` 6；档位 `gray-50 / 100 / 400 / 600 / 900`；`bg` 4 ／ `text` 2；**透明度 2 类 2 处**（`dark:bg-gray-900/20`、`dark:hover:bg-gray-900/40`）；变体裸类 2 / `hover:` 1 / `dark:` 1 / `dark:hover:` 1；**两行串内无语义彩色**（文件他处 purple/amber/green/red 未触碰）；**0 桶归零** |
| 0-E4i ✅ | **热点榜第六的文件集群**：`MessageSpeakControl.tsx` 5 → 0——**已实施，见本节末 0-E4i 记录** | 5 处落 **2 行**（语音播报控件：错误提示气泡串 ＋ 语音按钮串）；族 `gray` 4 ＋ `white` 1；档位 `gray-300 / 400 / 500 / 600` ＋ `white`；工具类 `text` 5；**零透明度**；变体裸类 / `hover:` / `dark:` / `dark:hover:` 齐备；**气泡串内语义 `bg-red-600` 未触碰**；**0 桶归零** |
| 0-E4j ✅ | **热点榜第六的文件集群**：`CodeEditorLoadingState.tsx` 5 → 0——**已实施，见本节末 0-E4j 记录** | 5 处落 **3 行**（内联加载文案 ＋ 全屏遮罩 ＋ 遮罩内加载文案）；族 `gray` 2 ＋ `white` 2 ＋ `black` 1；档位 `gray-900` ＋ `white` ＋ `black`；`text` 4 ／ `bg` 1；**透明度 1 类 1 处**（`md:bg-black/50` 50%）；变体裸类 / `dark:` / `md:`；**同串语义 `border-blue-600` 未触碰**；**0 桶归零** |
| 0-E4k ✅ | **热点榜第六的文件集群**：`PrdEditorLoadingState.tsx` 5 → 0——**已实施，见本节末 0-E4k 记录** | 5 处落 **3 行**（全屏遮罩 ＋ 加载卡片 ＋ 加载文案）；族 `gray` 2 ＋ `white` 2 ＋ `black` 1；档位 `gray-900` ＋ `white` ＋ `black`；`bg` 3 ／ `text` 2；**透明度 1 类 1 处**（`md:bg-black/50` 50%）；变体裸类 / `dark:` / `md:`；**同串语义 `border-blue-600` 未触碰**；**0 桶归零** |
| 0-E4l ✅ | **热点榜第六的文件集群**：`ShellEmptyState.tsx` 5 → 0——**已实施，见本节末 0-E4l 记录** | 5 处落 **3 行**（空态容器 ＋ 圆形图标容器 ＋ `svg` 图标）；族纯 `gray` 5；档位 `gray-100 / 400 / 500 / 800`；`text` 3 ／ `bg` 2；**零透明度**；变体裸类 / `dark:`；**文件全仓零语义彩色**；**0 桶归零** |
| 0-E4m ✅ | **热点榜第六的文件集群**：`StandaloneShellEmptyState.tsx` 5 → 0——**已实施，见本节末 0-E4m 记录** | 5 处落 **3 行**（独立壳空态：容器 ＋ 圆形图标容器 ＋ `svg` 图标，与 0-E4l 同构）；族纯 `gray` 5；档位 `gray-100 / 400 / 500 / 800`；`text` 3 ／ `bg` 2；**零透明度**；变体裸类 / `dark:`；**文件全仓零语义彩色**；**0 桶归零** |
| 0-E4n ✅ | **热点榜第六的文件集群**：`StandaloneShellHeader.tsx` 5 → 0——**已实施，见本节末 0-E4n 记录** | 5 处落 **3 行**（独立壳头部容器 `border-b` ＋ `bg` ＋ 标题 `h3` ＋ 关闭按钮）；族 `gray` 4 ＋ `white` 1；档位 `gray-200 / 400 / 700 / 800` ＋ `white`；`border` 1 ／ `bg` 1 ／ `text` 3；**零透明度**；变体裸类 / `hover:`；**同串语义 `text-green-400` 未触碰**；**2 桶归零**（`bg: gray-800`、`text: gray-200`，均 1→0） |
| 0-E4o ✅ | **热点榜并列第四的文件集群**：`FileListContent.tsx` 4 → 0——**已实施，见本节末 0-E4o 记录** | 4 处落 **2 行**（文件列表头部提示串 ＋ 行内分隔符 span）；族纯 `gray` 4；档位 `gray-300 / 400 / 500 / 600`；工具类纯 `text` 4；**零透明度**；变体裸类 2 / `dark:` 2；**无伪类**；**同文件语义 blue 链接色未触碰**；**0 桶归零** |
| 0-E4p ✅ | **热点榜并列第四的文件集群**：`ToolStatusBadge.tsx` 4 → 0——**已实施，见本节末 0-E4p 记录** | 4 处落 **1 行**（状态徽标配置对象的 className 字符串值，非 JSX 属性）；族纯 `slate` 4；档位 `slate-100 / 300 / 700 / 900`；`bg` 2 ／ `text` 2；**透明度 1 类 1 处**（`dark:bg-slate-900/30`）；变体裸类 2 / `dark:` 2；**同对象其余条目 blue/green/red/orange 语义色未触碰**；**2 桶归零**（`bg: slate-100`、`bg: slate-900`） |
| 0-E4q ✅ | **热点榜并列第四的文件集群**：`ChatMessageImages.tsx` 4 → 0——**已实施，见本节末 0-E4q 记录** | 4 处落 **2 行**（图片查看全屏遮罩 ＋ 右上关闭按钮）；族 `white` 3 ＋ `black` 1；档位 `white` ＋ `black`；`text` 1 ／ `bg` 3；**透明度 3 类 3 处**（`bg-black/80`、`bg-white/10`、`hover:bg-white/20`）；变体裸类 3 / `hover:` 1；**文件全仓零语义彩色**；**0 桶归零** |
| 0-E4r ✅ | **热点榜并列第四的文件集群**：`MessageCopyControl.tsx` 4 → 0——**已实施，见本节末 0-E4r 记录** | 4 处落 **1 行**（复制按钮状态类的三元字符串常量）；族纯 `gray` 4；档位 `gray-300 / 400 / 500 / 600`；工具类纯 `text` 4；**零透明度**；变体裸类 / `hover:` / `dark:` / `dark:hover:` 齐备；**文件全仓零语义彩色**；**1 桶归零**（`text: gray-300`） |
| 0-E4s ✅ | **热点榜并列第四的文件集群**：`CodeEditorFooter.tsx` 4 → 0——**已实施，见本节末 0-E4s 记录** | 4 处落 **2 行**（编辑器页脚左侧信息串 ＋ 右侧快捷键提示串）；族纯 `gray` 4；档位 `gray-400 ×2 + gray-500 + gray-600`；工具类纯 `text` 4；**零透明度**；变体裸类 2 / `dark:` 2；**文件全仓零语义彩色**；**1 桶归零**（`text: gray-600`） |
| 0-E4t ✅ | **热点榜并列第四的文件集群**：`EditorSidebar.tsx` 4 → 0——**已实施，见本节末 0-E4t 记录** | 4 处落 **2 行**（可拖拽分隔条（`bg`）＋ 侧栏容器（`border-l`））；族纯 `gray` 4；档位 `gray-200 ×2 + gray-700 ×2`；`bg` 2 ／ `border` 2；**零透明度**；变体裸类 2 / `dark:` 2；**分隔条同串语义 `hover:bg-blue-500` / `dark:hover:bg-blue-600` 未触碰**；**2 桶归零**（`bg: gray-200`、`bg: gray-700`） |
| 0-E4u ✅ | **热点榜并列第四的文件集群**：`FileTree.tsx` 4 → 0——**已实施，见本节末 0-E4u 记录** | 4 处落 **3 行**（删除确认遮罩 ＋ 确认按钮 ＋ 两处条件类三元串）；族 `white` 3 ＋ `black` 1；档位 `white` ＋ `black`；`text` 3 ／ `bg` 1；**透明度 1 类 1 处**（`bg-black/50`）；变体**全为裸类**；**同串语义 `bg-red-600` / `hover:bg-red-700` 未触碰**，他处 red/green/blue 未触碰；**0 桶归零** |
| 0-E4v ✅ | **热点榜并列第四的文件集群**：`TaskIndicator.tsx` 4 → 0——**已实施，见本节末 0-E4v 记录** | 4 处落 **2 行**（指示器配置对象的 `colorClassName` / `backgroundClassName` 类名常量）；族纯 `gray` 4；档位 `gray-50 / 400 / 500 / 900`；`text` 2 ／ `bg` 2；**零透明度**；变体裸类 2 / `dark:` 2；**同对象其余条目 green/blue/amber 语义色未触碰**；**3 桶归零**（`bg: gray-50`、`text: gray-400`、`text: gray-500`） |
| 0-E4w ✅ | **热点榜并列第四的文件集群**：`ProviderSkills.tsx` 4 → 0——**已实施，见本节末 0-E4w 记录** | 4 处落 **1 行**（provider 分类样式表的 `system` 条目）；族纯 `slate` 4；档位 `slate-300 / 500 ×2 / 700`；`border` 1 ／ `bg` 1 ／ `text` 2；**透明度 2 类 2 处**（`border-slate-500/30`、`bg-slate-500/10`）；变体裸类 3 / `dark:` 1；**同表其余条目 emerald/sky/amber/orange/rose 语义色未触碰**；**4 桶归零**（`bg: slate-500`、`border: slate-500`、`text: slate-300`、`text: slate-700`） |
| 0-E4x ✅ | **热点榜并列第四的文件集群**：`Tooltip.tsx` 4 → 0——**已实施，见本节末 0-E4x 记录** | 4 处落 **1 行**（tooltip 气泡基础样式串，含 `dark:bg-gray-100` 反色写法）；族 `gray` 3 ＋ `white` 1；档位 `gray-100 / 900 ×2` ＋ `white`；`text` 2 ／ `bg` 2；**零透明度**；变体裸类 2 / `dark:` 2；**文件含 0-E2e 遗留令牌（10 处轴限定 `border-*-n-gray-*`）**；**2 桶归零**（`bg: gray-100`、`text: gray-900`） |
| 0-E4y ✅ | **热点榜并列第五的文件集群**：`LoadAllMessagesOverlay.tsx` 3 → 0——**已实施，见本节末 0-E4y 记录** | 3 处落 **3 行**（绿色「加载全部」按钮 ＋ 蓝色重试按钮 ＋ 旋转器 `border-t` 环）；族纯 `white` 3；档位白色；`text` 2 ／ `border` 1；**透明度 1 类 1 处**（`border-white/30`）；变体**全为裸类**；**同串 green/blue 语义色未触碰**；**文件含前片遗留令牌 `border-t-n-white` 1 处（第 6 次撞上，未动）**；**1 桶归零**（`border: white`） |
| 0-E4z ✅ | **热点榜并列第五的文件集群**：`CodeEditorSurface.tsx` 3 → 0——**已实施，见本节末 0-E4z 记录** | 3 处落 **2 行**（Markdown 预览滚动容器 ＋ `prose` 排版容器）；族 `gray` 2 ＋ `white` 1；档位 `gray-900` ＋ `white`；工具类纯 `bg` 3；**零透明度**；变体裸类 1 / `dark:` 1 / `prose-pre:` 1；**同串 `prose-a` 语义蓝（`text-blue-600` / `dark:text-blue-400`）未触碰**；**0 桶归零** |
| 0-E5a ✅ | **热点榜并列第五的文件集群**：`MermaidDiagram.tsx` 3 → 0——**已实施，见本节末 0-E5a 记录** | 3 处落 **2 行**（源码回退 `pre`（light 用 `bg-muted/50` 语义令牌，仅 dark 底色为字面）＋ `svg` 渲染容器）；族 `zinc` 2 ＋ `white` 1；档位 `zinc-900` ＋ `white`；工具类纯 `bg` 3；**零透明度**；变体裸类 1 / `dark:` 2；**同串 `border-border` / `text-muted-foreground` 语义令牌未触碰**；**0 桶归零** |
| 0-E5b ✅ | **热点榜并列第五的文件集群**：`PrdEditorWorkspace.tsx` 3 → 0——**已实施，见本节末 0-E5b 记录** | 3 处落 **2 行**（移动端全屏遮罩 ＋ 编辑器面板容器）；族 `black` 1 ＋ `white` 1 ＋ `gray` 1；档位 `black` / `white` / `gray-900`；工具类纯 `bg` 3；**透明度 1 类 1 处**（`md:bg-black/50`）；变体 `md:` 1 / 裸类 1 / `dark:` 1；**0 桶归零** |
| 0-E5c ✅ | **热点榜并列第六的文件集群**：`OneLineDisplay.tsx` 2 → 0——**已实施，见本节末 0-E5c 记录** | 2 处落 **1 行**（单行 shell 命令展示块底色串，等宽文本在内层 `span`）；族 `gray` 1 ＋ `black` 1；档位 `gray-900` ＋ `black`；工具类纯 `bg` 2；**零透明度**；变体裸类 1 / `dark:` 1；**0 桶归零** |
| 0-E5d ✅ | **热点榜并列第六的文件集群**：`GitPanelHeader.tsx` 2 → 0——**已实施，见本节末 0-E5d 记录** | 2 处落 **2 行**（绿色拉取按钮 ＋ 橙色推送按钮的文字色）；族纯 `white` 2；档位白色；工具类纯 `text` 2；**零透明度**；变体**全为裸类**；**同串 green/orange 语义色未触碰**；**0 桶归零** |
| 0-E5e ✅ | **热点榜并列第六的文件集群**：`ConfirmActionModal.tsx` 2 → 0——**已实施，见本节末 0-E5e 记录** | 2 处落 **2 行**（全屏遮罩 ＋ 确认按钮文字色）；族 `black` 1 ＋ `white` 1；档位 `black` ＋ `white`；`bg` 1 ／ `text` 1；**透明度 1 类 1 处**（`bg-black/60`）；变体**全为裸类**；**映射表内语义色未触碰**；**0 桶归零** |
| 0-E5f ✅ | **热点榜并列第六的文件集群**：`RemoveWorktreeModal.tsx` 2 → 0——**已实施，见本节末 0-E5f 记录** | 2 处落 **2 行**（全屏遮罩 ＋ 危险确认按钮文字色）；族 `black` 1 ＋ `white` 1；档位 `black` ＋ `white`；`bg` 1 ／ `text` 1；**透明度 1 类 1 处**（`bg-black/60`）；变体**全为裸类**；**同串语义红 `bg-red-600` / `hover:bg-red-700` 未触碰**；**0 桶归零** |
| 0-E5g ✅ | **热点榜并列第六的文件集群**：`WizardFooter.tsx` 2 → 0——**已实施，见本节末 0-E5g 记录** | 2 处落 **1 行**（向导页脚顶边分隔线 light/dark 成对）；族纯 `gray` 2；档位 `gray-200` ＋ `gray-700`；工具类纯 `border` 2；**零透明度**；变体裸类 1 / `dark:` 1；**2 桶归零**（`border: gray-200`、`border: gray-700`） |
| 0-E5h ✅ | **热点榜并列第六的文件集群**：`WorkspaceTabs.tsx` 2 → 0——**已实施，见本节末 0-E5h 记录** | 2 处落 **1 行**（标签条内阴影串，本批唯一 `shadow` 工具类片）；族纯 `black` 2；档位黑色；工具类纯 `shadow` 2；**透明度 2 类 2 处**（`shadow-black/[0.025]` 任意值、`dark:shadow-black/10`）；变体裸类 1 / `dark:` 1；**同串 `border-border/40` / `bg-muted/50` 语义令牌未触碰**；**1 桶归零**（`shadow: black`） |
| 0-E5i ✅ | **热点榜并列第六的文件集群**：`NotificationsSettingsTab.tsx` 2 → 0——**已实施，见本节末 0-E5i 记录** | 2 处落 **2 行**（两处开关激活态三元串的文字色，串内结构逐字同构）；族纯 `white` 2；档位白色；工具类纯 `text` 2；**零透明度**；变体**全为裸类**；**同串 blue 语义色未触碰**；**0 桶归零** |
| 0-E5j ✅ | **热点榜并列第六的文件集群（本批收尾片）**：`DarkModeToggle.tsx` 2 → 0——**已实施，见本节末 0-E5j 记录** | 2 处落 **2 行**（开关滑块位移态三元串底色 ＋ 太阳图标文字色）；族纯 `white` 2；档位白色；`bg` 1 ／ `text` 1；**零透明度**；变体**全为裸类**；**同串 `bg-foreground/60` / `dark:bg-foreground/80` / `dark:text-background` 语义令牌未触碰**；**0 桶归零** |
| 0-E5k ✅ | **阶段 0 收尾批（余量 1 处文件）**：`ComposerAttachment.tsx` 1 → 0——**已实施，见本节末 0-E5k 记录** | 1 处落 **1 行**（附件错误遮罩内的叉号图标文字色）；族纯 `white` 1；档位白色；工具类纯 `text` 1；**零透明度**；变体**为裸类**；**同串 `bg-red-500/50` 语义色未触碰**；**0 桶归零** |
| 0-E5l ✅ | **阶段 0 收尾批（余量 1 处文件）**：`PromptInput.tsx` 1 → 0——**已实施，见本节末 0-E5l 记录** | 1 处落 **1 行**（工具提示快捷键 `<kbd>` 的半透明底色）；族纯 `white` 1；档位白色；工具类纯 `bg` 1；含 20% 一处透明度；变体**为裸类**；**文件全仓零语义彩色**；**0 桶归零** |
| 0-E5m ✅ | **阶段 0 收尾批（余量 1 处文件）**：`VoiceInputButton.tsx` 1 → 0——**已实施，见本节末 0-E5m 记录** | 1 处落 **1 行**（语音输入错误气泡的文字色）；族纯 `white` 1；档位白色；工具类纯 `text` 1；**零透明度**；变体**为裸类**；**同串 `bg-red-600` 语义色未触碰**；**0 桶归零** |
| 0-E5n ✅ | **阶段 0 收尾批（余量 1 处文件）**：`CommandResultModal.tsx` 1 → 0——**已实施，见本节末 0-E5n 记录** | 1 处落 **1 行**（进程健康状态 Badge 的文字色）；族纯 `white` 1；档位白色；工具类纯 `text` 1；**零透明度**；变体**为裸类**；**同串 `bg-emerald-500` 等语义色未触碰**；**0 桶归零** |
| 0-E5o ✅ | **阶段 0 收尾批（余量 1 处文件）**：`Markdown.tsx` 1 → 0——**已实施，见本节末 0-E5o 记录** | 1 处落 **1 行**（代码块容器 dark 态底色）；族纯 `zinc` 1；档位zinc-900；工具类纯 `bg` 1；**零透明度**；变体**`dark:` 1**；**同串主题令牌未触碰**；**1 桶归零**（`bg: zinc-900`） |
| 0-E5p ✅ | **阶段 0 收尾批（余量 1 处文件）**：`CodeEditor.tsx` 1 → 0——**已实施，见本节末 0-E5p 记录** | 1 处落 **1 行**（非侧栏模式外层容器 `md` 断点遮罩底色）；族纯 `black` 1；档位黑色；工具类纯 `bg` 1；含 50% 一处透明度；变体**`md:` 1**；**同串布局类未触碰**；**0 桶归零** |
| 0-E5q ✅ | **阶段 0 收尾批（余量 1 处文件）**：`MergeWorktreeModal.tsx` 1 → 0——**已实施，见本节末 0-E5q 记录** | 1 处落 **1 行**（模态遮罩层的半透明黑底）；族纯 `black` 1；档位黑色；工具类纯 `bg` 1；含 60% 一处透明度；变体**为裸类**；**文件全仓零语义彩色**；**0 桶归零** |
| 0-E5r ✅ | **阶段 0 收尾批（余量 1 处文件）**：`NewBranchModal.tsx` 1 → 0——**已实施，见本节末 0-E5r 记录** | 1 处落 **1 行**（模态遮罩层的半透明黑底）；族纯 `black` 1；档位黑色；工具类纯 `bg` 1；含 60% 一处透明度；变体**为裸类**；**文件全仓零语义彩色**；**0 桶归零** |
| 0-E5s ✅ | **阶段 0 收尾批（余量 1 处文件）**：`NewWorktreeModal.tsx` 1 → 0——**已实施，见本节末 0-E5s 记录** | 1 处落 **1 行**（模态遮罩层的半透明黑底）；族纯 `black` 1；档位黑色；工具类纯 `bg` 1；含 60% 一处透明度；变体**为裸类**；**文件全仓零语义彩色**；**0 桶归零** |
| 0-E5t ✅ | **阶段 0 收尾批（余量 1 处文件）**：`AgentConnectionCard.tsx` 1 → 0——**已实施，见本节末 0-E5t 记录** | 1 处落 **1 行**（登录按钮模板串的文字色）；族纯 `white` 1；档位白色；工具类纯 `text` 1；**零透明度**；变体**为裸类**；**模板内插既有语义令牌未触碰**；**0 桶归零** |
| 0-E5u ✅ | **阶段 0 收尾批（余量 1 处文件）**：`Onboarding.tsx` 1 → 0——**已实施，见本节末 0-E5u 记录** | 1 处落 **1 行**（向导完成按钮的文字色）；族纯 `white` 1；档位白色；工具类纯 `text` 1；**零透明度**；变体**为裸类**；**同串 `bg-emerald-600` 语义色未触碰**；**0 桶归零** |
| 0-E5v ✅ | **阶段 0 收尾批（余量 1 处文件）**：`OnboardingStepProgress.tsx` 1 → 0——**已实施，见本节末 0-E5v 记录** | 1 处落 **1 行**（已完成步骤圆点的文字色）；族纯 `white` 1；档位白色；工具类纯 `text` 1；**零透明度**；变体**为裸类**；**同串 emerald 语义色与主题令牌未触碰**；**0 桶归零** |
| 0-E5w ✅ | **阶段 0 收尾批（余量 1 处文件）**：`PluginSettingsTab.tsx` 1 → 0——**已实施，见本节末 0-E5w 记录** | 1 处落 **1 行**（开关滑块伪元素圆点的白色底色）；族纯 `white` 1；档位白色；工具类纯 `bg` 1；**零透明度**；变体**`after:` 1**；**同串 `bg-muted` / `peer-checked:bg-emerald-500` 未触碰**；**0 桶归零** |
| 0-E5x ✅ | **阶段 0 收尾批（余量 1 处文件）**：`WorkspaceErrorBoundary.tsx` 1 → 0——**已实施，见本节末 0-E5x 记录** | 1 处落 **1 行**（错误边界重试按钮的文字色）；族纯 `white` 1；档位白色；工具类纯 `text` 1；**零透明度**；变体**为裸类**；**同串 `bg-red-600` / `focus:ring-red-500` 未触碰**；**0 桶归零** |
| 0-E5y ✅ | **阶段 0 收尾批（余量 1 处文件）**：`SettingsToggle.tsx` 1 → 0——**已实施，见本节末 0-E5y 记录** | 1 处落 **1 行**（开关滑块选中态圆点的底色）；族纯 `white` 1；档位白色；工具类纯 `bg` 1；**零透明度**；变体**为裸类**；**同串 `bg-foreground/60` 语义令牌未触碰**；**1 桶归零**（`bg: white`） |
| 0-E5z ✅ | **阶段 0 收尾批（余量 1 处文件）**：`AgentSelectorSection.tsx` 1 → 0——**已实施，见本节末 0-E5z 记录** | 1 处落 **1 行**（品牌色映射链中 opencode 分支的圆点底色）；族纯 `zinc` 1；档位zinc-500；工具类纯 `bg` 1；**零透明度**；变体**为裸类**；**同链品牌十六进制色未触碰**；**1 桶归零**（`bg: zinc-500`） |
| 0-E6a ✅ | **阶段 0 收尾批（余量 1 处文件）**：`ShellMinimalView.tsx` 1 → 0——**已实施，见本节末 0-E6a 记录** | 1 处落 **1 行**（极简终端视图根容器底色）；族纯 `gray` 1；档位gray-900；工具类纯 `bg` 1；**零透明度**；变体**为裸类**；**文件全仓零语义彩色**；**1 桶归零**（`bg: gray-900`） |
| 0-E6b ✅ | **阶段 0 收尾批（余量 1 处文件）**：`SidebarModeTabs.tsx` 1 → 0——**已实施，见本节末 0-E6b 记录** | 1 处落 **1 行**（运行中会话数角标的文字色）；族纯 `white` 1；档位白色；工具类纯 `text` 1；**零透明度**；变体**为裸类**；**同串 `bg-emerald-500` 等语义色未触碰**；**0 桶归零** |
| 0-E6c ✅ | **阶段 0 收尾批（余量 1 处文件）**：`TaskMasterPanel.tsx` 1 → 0——**已实施，见本节末 0-E6c 记录** | 1 处落 **1 行**（PRD 完成通知浮层的文字色）；族纯 `white` 1；档位白色；工具类纯 `text` 1；**零透明度**；变体**为裸类**；**同串 `bg-green-600` 未触碰**；**1 桶归零**（`text: white`） |
| 0-E6d ✅ | **阶段 0 收尾批（余量 1 处文件）（**阶段 0 归零片**）**：`Dialog.tsx` 1 → 0——**已实施，见本节末 0-E6d 记录** | 1 处落 **1 行**（共享 Dialog 遮罩层的底色）；族纯 `black` 1；档位黑色；工具类纯 `bg` 1；含 50% 一处透明度；变体**为裸类**；**文件全仓零语义彩色**；**1 桶归零**（`bg: black`） |
| 0-E2j+ | **其余按文件集群施工**：`bg-gray-100 dark:bg-gray-700 → bg-n-gray-100 dark:bg-n-gray-700`（非 gray 同理走 `n-zinc` / `n-slate` / `n-neutral`），热点文件单独成片。**热点榜已更新到 0-E6d 之后**：**剩余 0 处 / 0 文件**（原「20 个文件全部并列 1 处」的尾巴已由 0-E5k~0-E6d 二十片逐文件清零），**热点榜清空，阶段 0 的中性具名硬编码迁移到此结束**（仅余 1 处豁免 `border-gray-150`） | 见 §6 下"切片粒度"；每片跑基线快照收敛 + 守恒律**双绿**才算过；**迁移前先点名确认每个档位在 `index.css` 有 L1+L2 双声明**（见 0-E2i 的前置检查）。**注意**：stone 全仓 0 处，故 `--n-stone-*` 从未建设 |
| 0-F ✅ | **Git 图 + 其余零散硬编码**（`MobileTerminalSelection` 等）——**已实施，见本节末 0-F 记录** | **0-F1 / 0-F2 两片全部实施**（2026-09-25）：Git 图 10 个 lane hex 抽为 L1 `--palette-graph-1..10` ＋ L2 `--graph-lane-1..10`，`laneColor` 改返 `hsl(var(--graph-lane-N))`、新增 `laneTint` 供 `RefBadge` 的 HEAD 底色（原 `${hex}22`），并去掉 `'#0ea5e9'` 的 lane fallback；`mobileTerminalSelection.ts` 的 7 处色值改走令牌（该文件 0 处字面色值）。它是阶段 1 验收（"切换主题后 Git 图与终端同时变化"）的**前置**——1-G 依赖 `var(--graph-lane-*)` 存在，**该前置现已就位**。**已做（2-J）**：§5.12 的 >10 lane 参数化回退（有意视觉变更，已拍板并记账，见 §5.12 v3） |
| 0-G | **`index.css` 后半段 66 处暗色补偿** | **已拆入阶段 1**：第一步（加 `<html color-scheme>`）由 **1-B** 完成，逐条重审归 **1-B2**；本行不再单独实施（依赖关系即 §5.6 的"必须先有 color-scheme"） |

**切片粒度（v3）**：按**文件集群**而非色值类型切片——中性色分布在 **0 个文件**（0-E6d 后；含轴限定形态，覆盖面口径见 0-E2e 记录），同模块语义一致、review 上下文完整。热点文件必须单独成片（余下 20 文件各 1 处，已由 0-E5k~0-E6d 二十片逐片清零），避免单个 PR 塞进几十处替换。**已落地一百零六片**：`AgentConnectionsStep.tsx` 60 → 0（0-E2b，首批含非 gray 族）、`AskUserQuestionPanel.tsx` 84 → 0（0-E2d，#1 热点、纯 gray）、`Tooltip.tsx` 等 4 文件的 15 处轴限定形态 → 0（0-E2e，扫描器覆盖面片）、`TaskDetailModal.tsx` 72 → 0（0-E2f，#2 热点、纯 gray）、`McpServerFormModal.tsx` 69 → 0（0-E2g，#3 热点、密度最高）、`TaskBoardToolbar.tsx` 60 → 0（0-E2h，#4 热点、零透明度）、`VersionUpgradeModal.tsx` 55 → 0（0-E2i，#5 热点、token 最多）、`CodeEditorHeader.tsx` 52 → 0（0-E2j，#6 热点、text 为主且无 border）、`FolderBrowserModal.tsx` 46 → 0（0-E2k，#7 热点、含模态遮罩）、`TaskEmptyState.tsx` 46 → 0（0-E2l，#8 热点、透明度集中于同一 token）、`AccountContent.tsx` 41 → 0（0-E2m，#9 热点、四族混合、独占拼写批量样本）、`toolConfigs.ts` 38 → 0（0-E2n，#10 热点、类名映射表、纯 gray 零 bg）、`QuestionAnswerContent.tsx` 35 → 0（0-E2o，#11 热点、含豁免、透明度最多）、`NextTaskBanner.tsx` 33 → 0（0-E2p，#12 热点、slate 主导）、`TaskMasterSetupModal.tsx` 32 → 0（0-E2q，#13 热点、三工具均衡）、`GithubAuthenticationCard.tsx` 31 → 0（0-E2r，#14 热点、中段档位集中）、`PrdEditorHeader.tsx` 30 → 0（0-E2s，#15 热点、零透明度、两原子归零与两字面全仓零消费一一对应）、`GenerateTasksModal.tsx` 30 → 0（0-E2t，#16 热点、三工具均衡、含模态遮罩 `bg-black/50`）、`CreateTaskModal.tsx` 30 → 0（0-E2u，#17 热点、与 0-E2t 逐 token 同构）、`TaskHelpModal.tsx` 30 → 0（0-E2v，#18 热点、`text` 为主、带透明度 2 处）、`TaskCard.tsx` 30 → 0（0-E2w，#19 热点、跨 gray/slate 两族、4 个 slate 原子归零）、`fileIcons.ts` 28 → 0（0-E2x，#20 热点、仅 2 个 token、28 行一行一处）、`TaskListContent.tsx` 24 → 0（0-E2y，#21 热点、纯 gray 单族 8 档）、`MessageComponent.tsx` 24 → 0（0-E2z，#22 热点、无 border、2 字面归零但 0 桶归零）、`CodeEditorBinaryFile.tsx` 23 → 0（0-E3a，#23 热点、23 处仅落 6 行的高密度片、首个 `md:` 变体）、`CodeEditorMediaPreview.tsx` 22 → 0（0-E3b，#24 热点、与 0-E3a 同模块姊妹组件、首次暴露 `index.css` 选择器级消费者缺口）、`TaskFiltersPanel.tsx` 22 → 0（0-E3c，#25 热点、与 0-E2h 同模块、22 处落 8 行）、`TaskQuickSortBar.tsx` 18 → 0（0-E3d，#26 热点、6 token 各 ×3、1 字面迁移后全仓零消费）、`OverwriteConfirmModal.tsx` 18 → 0（0-E3e，#27 热点、18 处落 17 token、含遮罩 `bg-black/50`）、`StepReview.tsx` 18 → 0（0-E3f，#28 热点、`text` 14／`bg` 2／`border` 2、含 `dark:bg-gray-900/50`）、`SidebarProjectItem.tsx` 16 → 0（0-E3g，#29 热点、两处透明度、7 字面迁后全仓零消费且 2 桶归零）、`taskKanban.ts` 16 → 0（0-E3h，#30 热点、16 处落 4 行、中性/语义彩色在同一配置表交错、9 字面迁后全仓零消费且 7 桶归零）、`ImageViewer.tsx` 14 → 0（0-E3i，#31 热点、14 处落 7 行、文件含前片遗留令牌、首次修正产物核对脚本的前提假设缺口）、`ProjectCreationWizard.tsx` 14 → 0（0-E3j，#32 热点、14 处落 5 行、含模态遮罩与 `sm:` 响应式）、`ShellHeader.tsx` 14 → 0（0-E3k，#33 热点、14 处落 6 行、含前片遗留令牌、3 字面归零而 0 桶归零），`TaskBoardContent.tsx` 14 → 0（0-E3l，#34 热点、14 处落 7 行、空态与卡片计数徽标、4 字面归零而 1 桶归零），`ToolDiffViewer.tsx` 12 → 0（0-E3m，#35 热点、12 处落 4 行、纯 gray、4 类透明度 6 处、3 字面归零而 0 桶归零），`MarkdownPreview.tsx` 12 → 0（0-E3n，#36 热点、12 处落 5 行、markdown element 映射、2 字面归零而 1 桶归零），`UserMessageStickyHeader.tsx` 12 → 0（0-E3o，#37 热点、12 处落 4 行、含 `hover:` / `dark:hover:` 伪类与两处 95% 透明度、2 字面归零而 0 桶归零），`TerminalShortcutsPanel.tsx` 11 → 0（0-E3p，#38 热点、11 处落 4 行、含 `active:` 伪类、语义蓝未触碰、3 字面归零而 1 桶归零），`TextContent.tsx` 11 → 0（0-E3q，#39 热点、11 处落 3 行、两行 `<pre>` 代码块串 ＋ 一行纯文本 `<div>`、三处 50% 透明度、4 字面归零而 0 桶归零），`BrowserUsePanel.tsx` 11 → 0（0-E3r，#40 热点、11 处落 9 行、跨 white/neutral/black 三族、五处透明度、8 字面归零且 4 桶归零），`QuickSettingsHandle.tsx` 10 → 0（0-E3s，#41 热点、10 处落 4 行、含 `hover:` / `dark:hover:` 伪类、零透明度、8 字面全仓均另有存活故 0 归零），`WorkspacePathField.tsx` 10 → 0（0-E3t，#42 热点、10 处落 4 行、自动补全下拉、10 token 各 ×1、零透明度、0 字面归零），`ProviderLoginModal.tsx` 9 → 0（0-E3u，#43 热点、9 处落 4 行、含前片遗留令牌、零透明度、9 token 各 ×1、0 字面归零），`WizardProgress.tsx` 9 → 0（0-E3v，#44 热点、9 处落 5 行、步骤条状态三元、`bg-green-500` / `bg-blue-500` 语义色未触碰、零透明度、0 字面归零），`SidebarModals.tsx` 8 → 0（0-E3w，#45 热点、8 处落 8 行、4 个模态框的遮罩＋危险按钮、仅 2 token 各 ×4、四处 60% 透明度、`bg-red-600` 语义红未触碰、0 字面归零）、`ExecutionProcessSummary.tsx` 8 → 0（0-E3x，#46 热点、8 处落 2 行、执行过程折叠摘要的标签行＋按钮行、7 档 gray ＋ white、`text` 6 ／ `bg` 2、含裸类/`hover:`/`dark:`/`dark:hover:`、零透明度、3 字面归零而 0 桶归零）、`PrdEditorFooter.tsx` 8 → 0（0-E3y，#47 热点、8 处落 3 行、PRD 编辑器页脚的外壳行＋统计行＋快捷键提示行、纯 gray 8 档、`border` 2 ／ `bg` 2 ／ `text` 4、含裸类/`dark:`、无伪类、零透明度、0 字面归零而 0 桶归零）、`ChatMessagesPane.tsx` 8 → 0（0-E3z，#48 热点、8 处落 4 行、聊天消息面板的模块级槽位类常量＋加载提示行＋两处旋转器、纯 gray 4 档、`border` 4 ／ `text` 4、含裸类/`dark:`、无伪类、零透明度、1 字面归零且 1 桶归零）、`StepConfiguration.tsx` 8 → 0（0-E4a，#49 热点、8 处落 4 行、项目创建向导配置步骤的两处 label＋两处 p 帮助文案、纯 gray 4 档、`text` 8、含裸类/`dark:`、无伪类、零透明度、2 字面归零且 1 桶归零）、`ShellConnectionOverlay.tsx` 7 → 0（0-E4b，#50 热点、7 处落 7 行、Shell 连接遮罩三态的全屏遮罩串、gray 6 ＋ white 1、`bg` 3 ／ `text` 4、含 `bg-gray-950/90` 90% 透明度、裸类、含前片遗留令牌、emerald/blue/yellow 语义色未触碰、2 字面归零且 1 桶归零）、`MarkdownCodeBlock.tsx` 7 → 0（0-E4c，#51 热点、7 处落 2 行、Markdown 行内代码串＋语言角标、纯 gray 6 档、`border` 2 ／ `bg` 2 ／ `text` 3、含裸类/`dark:`、无伪类、零透明度、1 字面归零且 1 桶归零）、`Shell.tsx` 7 → 0（0-E4d，#52 热点、7 处落 4 行、Shell 容器＋移动底栏＋蓝/灰按钮行、gray 6 ＋ white 1、`bg` 3 ／ `border` 1 ／ `text` 2 ／ `hover:bg` 1、含 80%/95% 两处透明度、裸类＋`hover:`、`bg-blue-600` 语义蓝未触碰、1 桶归零）、`CommandMenu.tsx` 6 → 0（0-E4e，#53 热点、6 处落 1 行、命令面板分组样式常量串、纯 gray 4 档、`border` 2 ／ `bg` 2 ／ `text` 2、含裸类/`dark:`、含 20%/10% 两处透明度、2 桶归零）、`SessionOptions.tsx` 6 → 0（0-E4f，#54 热点、6 处落 2 行、会话项删除按钮图标容器串＋X 图标、纯 gray 5 档、`bg` 4 ／ `text` 2、含裸类/`hover:`/`dark:`/`dark:hover:`、含 20%/40% 两处透明度、0 桶归零）、`SidebarContent.tsx` 6 → 0（0-E4g，#55 热点、6 处落 2 行、与 0-E4f 同构复制串、纯 gray 5 档、`bg` 4 ／ `text` 2、含裸类/`hover:`/`dark:`/`dark:hover:`、含 20%/40% 两处透明度、0 桶归零）、`SidebarRecentConversations.tsx` 6 → 0（0-E4h，#56 热点、6 处落 2 行、最近会话项删除按钮图标容器串＋X 图标、纯 gray 5 档、`bg` 4 ／ `text` 2、含裸类/`hover:`/`dark:`/`dark:hover:`、含 20%/40% 两处透明度、0 桶归零）、`MessageSpeakControl.tsx` 5 → 0（0-E4i，#57 热点、5 处落 2 行、语音控件错误提示气泡串＋语音按钮串、gray 4 ＋ white 1、`text` 5、含裸类/`hover:`/`dark:`/`dark:hover:`、零透明度、气泡串内 `bg-red-600` 语义红未触碰、0 桶归零）、`CodeEditorLoadingState.tsx` 5 → 0（0-E4j，#58 热点、5 处落 3 行、内联加载文案＋全屏遮罩＋遮罩内文案、gray 2 ＋ white 2 ＋ black 1、`text` 4 ／ `bg` 1、含裸类/`dark:`/`md:`、含 50% 一处透明度、5 token 派生 3 字面、`border-blue-600` 语义蓝未触碰、0 桶归零）、`PrdEditorLoadingState.tsx` 5 → 0（0-E4k，#59 热点、5 处落 3 行、全屏遮罩＋加载卡片＋加载文案、gray 2 ＋ white 2 ＋ black 1、`bg` 3 ／ `text` 2、含裸类/`dark:`/`md:`、含 50% 一处透明度、`border-blue-600` 语义蓝未触碰、0 桶归零）、`ShellEmptyState.tsx` 5 → 0（0-E4l，#60 热点、5 处落 3 行、空态容器＋圆形图标容器＋svg 图标、纯 gray 4 档、`text` 3 ／ `bg` 2、含裸类/`dark:`、零透明度、文件全仓零语义彩色、0 桶归零）、`StandaloneShellEmptyState.tsx` 5 → 0（0-E4m，#61 热点、5 处落 3 行、与 0-E4l 同构的独立壳空态、纯 gray 4 档、`text` 3 ／ `bg` 2、含裸类/`dark:`、零透明度、文件全仓零语义彩色、0 桶归零）、`StandaloneShellHeader.tsx` 5 → 0（0-E4n，#62 热点、5 处落 3 行、独立壳头部容器 border-b＋bg＋标题 h3＋关闭按钮、gray 4 ＋ white 1、`border` 1 ／ `bg` 1 ／ `text` 3、含裸类/`hover:`、零透明度、`text-green-400` 语义绿未触碰、2 桶归零）、`FileListContent.tsx` 4 → 0（0-E4o，#63 热点、4 处落 2 行、文件列表头部提示＋行内分隔符 span、纯 gray 4 档、`text` 4、含裸类/`dark:`、零透明度、blue 语义链接色未触碰、0 桶归零）、`ToolStatusBadge.tsx` 4 → 0（0-E4p，#64 热点、4 处落 1 行、状态徽标配置对象 className 串、纯 slate 4 档、`bg` 2 ／ `text` 2、含裸类/`dark:`、含 30% 一处透明度、blue/green/red/orange 语义色未触碰、2 桶归零）、`ChatMessageImages.tsx` 4 → 0（0-E4q，#65 热点、4 处落 2 行、图片查看全屏遮罩＋右上关闭按钮、white 3 ＋ black 1、`text` 1 ／ `bg` 3、含裸类/`hover:`、含 80%/10%/20% 三处透明度、文件全仓零语义彩色、0 桶归零）、`MessageCopyControl.tsx` 4 → 0（0-E4r，#66 热点、4 处落 1 行、复制按钮三元字符串常量、纯 gray 4 档、`text` 4、含裸类/`hover:`/`dark:`/`dark:hover:`、零透明度、文件全仓零语义彩色、1 桶归零）、`CodeEditorFooter.tsx` 4 → 0（0-E4s，#67 热点、4 处落 2 行、页脚左侧信息串＋右侧快捷键提示串、纯 gray 3 档、`text` 4、含裸类/`dark:`、零透明度、5 处 4 token 派生 3 字面、文件全仓零语义彩色、1 桶归零）、`EditorSidebar.tsx` 4 → 0（0-E4t，#68 热点、4 处落 2 行、可拖拽分隔条（bg）＋侧栏容器（border-l）、纯 gray 2 档、`bg` 2 ／ `border` 2、含裸类/`dark:`、零透明度、分隔条同串 `hover:bg-blue-500` / `dark:hover:bg-blue-600` 语义蓝未触碰、2 桶归零）、`FileTree.tsx` 4 → 0（0-E4u，#69 热点、4 处落 3 行、删除确认遮罩＋确认按钮＋两处条件类三元串、white 3 ＋ black 1、`text` 3 ／ `bg` 1、全为裸类、含 50% 一处透明度、同串 `bg-red-600`/`hover:bg-red-700` 未触碰、0 桶归零）、`TaskIndicator.tsx` 4 → 0（0-E4v，#70 热点、4 处落 2 行、指示器配置对象 colorClassName/backgroundClassName、纯 gray 4 档、`text` 2 ／ `bg` 2、含裸类/`dark:`、零透明度、green/blue/amber 语义色未触碰、3 桶归零）、`ProviderSkills.tsx` 4 → 0（0-E4w，#71 热点、4 处落 1 行、provider 分类样式表 system 条目、纯 slate 4 档、`border` 1 ／ `bg` 1 ／ `text` 2、含裸类 3 ／ `dark:` 1、含 30%/10% 两处透明度、emerald/sky/amber/orange/rose 语义色未触碰、4 桶归零）、`Tooltip.tsx` 4 → 0（0-E4x，#72 热点、4 处落 1 行、tooltip 气泡基础样式串含 dark:bg-gray-100 反色、gray 3 ＋ white 1、`text` 2 ／ `bg` 2、含裸类/`dark:`、零透明度、含 0-E2e 遗留令牌 10 处、2 桶归零）、`LoadAllMessagesOverlay.tsx` 3 → 0（0-E4y，#73 热点、3 处落 3 行、加载遮罩的「加载全部」按钮＋重试按钮＋旋转环、纯 white 族、`text` 2 ／ `border` 1、全裸类、含 30% 一处透明度、green/blue 语义色未触碰、含前片遗留令牌、1 桶归零）、`CodeEditorSurface.tsx` 3 → 0（0-E4z，#74 热点、3 处落 2 行、Markdown 预览滚动容器＋prose 排版容器、gray 2 ＋ white 1、纯 `bg` 3、含裸类/`dark:`/`prose-pre:`、零透明度、prose-a 语义蓝未触碰、0 桶归零）、`MermaidDiagram.tsx` 3 → 0（0-E5a，#75 热点、3 处落 2 行、源码回退 pre＋svg 渲染容器、zinc 2 ＋ white 1、纯 `bg` 3、含裸类/`dark:`、零透明度、border-border/text-muted-foreground 未触碰、0 桶归零）、`PrdEditorWorkspace.tsx` 3 → 0（0-E5b，#76 热点、3 处落 2 行、移动端全屏遮罩＋编辑器面板容器、black/white/gray 三族各 1、纯 `bg` 3、含 `md:`/裸类/`dark:`、含 50% 一处透明度、0 桶归零）、`OneLineDisplay.tsx` 2 → 0（0-E5c，#77 热点、2 处落 1 行、单行 shell 命令展示块底色串、gray 1 ＋ black 1、纯 `bg` 2、含裸类/`dark:`、零透明度、0 桶归零）、`GitPanelHeader.tsx` 2 → 0（0-E5d，#78 热点、2 处落 2 行、绿色拉取＋橙色推送按钮文字色、纯 white 族、纯 `text` 2、全裸类、零透明度、green/orange 语义色未触碰、0 桶归零）、`ConfirmActionModal.tsx` 2 → 0（0-E5e，#79 热点、2 处落 2 行、全屏遮罩＋确认按钮文字色、black 1 ＋ white 1、`bg` 1 ／ `text` 1、全裸类、含 60% 一处透明度、0 桶归零）、`RemoveWorktreeModal.tsx` 2 → 0（0-E5f，#80 热点、2 处落 2 行、全屏遮罩＋危险确认按钮文字色、black 1 ＋ white 1、`bg` 1 ／ `text` 1、全裸类、含 60% 一处透明度、语义红未触碰、0 桶归零）、`WizardFooter.tsx` 2 → 0（0-E5g，#81 热点、2 处落 1 行、向导页脚顶边分隔线、纯 gray 族、纯 `border` 2、含裸类/`dark:`、零透明度、2 桶归零）、`WorkspaceTabs.tsx` 2 → 0（0-E5h，#82 热点、2 处落 1 行、标签条内阴影串、纯 black 族、纯 `shadow` 2、含裸类/`dark:`、含任意值 `[0.025]` 与 10% 两处透明度、1 桶归零）、`NotificationsSettingsTab.tsx` 2 → 0（0-E5i，#83 热点、2 处落 2 行、两处开关激活态三元串文字色、纯 white 族、纯 `text` 2、全裸类、零透明度、blue 语义色未触碰、0 桶归零）、`DarkModeToggle.tsx` 2 → 0（0-E5j，#84 热点、2 处落 2 行、开关滑块位移态底色＋太阳图标文字色、纯 white 族、`bg` 1 ／ `text` 1、全裸类、零透明度、前景语义令牌未触碰、0 桶归零）、`ComposerAttachment.tsx` 1 → 0（0-E5k，#85 热点、1 处落 1 行、附件错误遮罩内叉号图标文字色、纯 white 族、纯 `text` 1、全裸类、零透明度、`bg-red-500/50` 语义色未触碰、0 桶归零）、`PromptInput.tsx` 1 → 0（0-E5l，#86 热点、1 处落 1 行、工具提示快捷键 `<kbd>` 半透明底色、纯 white 族、纯 `bg` 1、全裸类、20% 一处、文件全仓零语义彩色、0 桶归零）、`VoiceInputButton.tsx` 1 → 0（0-E5m，#87 热点、1 处落 1 行、语音输入错误气泡文字色、纯 white 族、纯 `text` 1、全裸类、零透明度、`bg-red-600` 语义色未触碰、0 桶归零）、`CommandResultModal.tsx` 1 → 0（0-E5n，#88 热点、1 处落 1 行、进程健康状态 Badge 文字色、纯 white 族、纯 `text` 1、全裸类、零透明度、`bg-emerald-500` 语义色未触碰、0 桶归零）、`Markdown.tsx` 1 → 0（0-E5o，#89 热点、1 处落 1 行、代码块容器 dark 态底色、纯 zinc 族、纯 `bg` 1、`dark:` 1、零透明度、主题令牌未触碰、1 桶归零（bg: zinc-900））、`CodeEditor.tsx` 1 → 0（0-E5p，#90 热点、1 处落 1 行、非侧栏模式外层容器 `md` 断点遮罩底色、纯 black 族、纯 `bg` 1、`md:` 1、50% 一处、布局类未触碰、0 桶归零）、`MergeWorktreeModal.tsx` 1 → 0（0-E5q，#91 热点、1 处落 1 行、模态遮罩层半透明黑底、纯 black 族、纯 `bg` 1、全裸类、60% 一处、文件全仓零语义彩色、0 桶归零）、`NewBranchModal.tsx` 1 → 0（0-E5r，#92 热点、1 处落 1 行、模态遮罩层半透明黑底、纯 black 族、纯 `bg` 1、全裸类、60% 一处、文件全仓零语义彩色、0 桶归零）、`NewWorktreeModal.tsx` 1 → 0（0-E5s，#93 热点、1 处落 1 行、模态遮罩层半透明黑底、纯 black 族、纯 `bg` 1、全裸类、60% 一处、文件全仓零语义彩色、0 桶归零）、`AgentConnectionCard.tsx` 1 → 0（0-E5t，#94 热点、1 处落 1 行、登录按钮模板串文字色、纯 white 族、纯 `text` 1、全裸类、零透明度、模板内插语义令牌未触碰、0 桶归零）、`Onboarding.tsx` 1 → 0（0-E5u，#95 热点、1 处落 1 行、向导完成按钮文字色、纯 white 族、纯 `text` 1、全裸类、零透明度、`bg-emerald-600` 语义色未触碰、0 桶归零）、`OnboardingStepProgress.tsx` 1 → 0（0-E5v，#96 热点、1 处落 1 行、已完成步骤圆点文字色、纯 white 族、纯 `text` 1、全裸类、零透明度、emerald 语义色与主题令牌未触碰、0 桶归零）、`PluginSettingsTab.tsx` 1 → 0（0-E5w，#97 热点、1 处落 1 行、开关滑块伪元素圆点白色底色、纯 white 族、纯 `bg` 1、`after:` 1、零透明度、`bg-muted` / `peer-checked:bg-emerald-500` 未触碰、0 桶归零）、`WorkspaceErrorBoundary.tsx` 1 → 0（0-E5x，#98 热点、1 处落 1 行、错误边界重试按钮文字色、纯 white 族、纯 `text` 1、全裸类、零透明度、`bg-red-600` / `focus:ring-red-500` 未触碰、0 桶归零）、`SettingsToggle.tsx` 1 → 0（0-E5y，#99 热点、1 处落 1 行、开关滑块选中态圆点底色、纯 white 族、纯 `bg` 1、全裸类、零透明度、`bg-foreground/60` 语义令牌未触碰、1 桶归零（bg: white））、`AgentSelectorSection.tsx` 1 → 0（0-E5z，#100 热点、1 处落 1 行、品牌色映射链 opencode 分支圆点底色、纯 zinc 族、纯 `bg` 1、全裸类、零透明度、同链品牌十六进制色未触碰、1 桶归零（bg: zinc-500））、`ShellMinimalView.tsx` 1 → 0（0-E6a，#101 热点、1 处落 1 行、极简终端视图根容器底色、纯 gray 族、纯 `bg` 1、全裸类、零透明度、文件全仓零语义彩色、1 桶归零（bg: gray-900））、`SidebarModeTabs.tsx` 1 → 0（0-E6b，#102 热点、1 处落 1 行、运行中会话数角标文字色、纯 white 族、纯 `text` 1、全裸类、零透明度、`bg-emerald-500` 语义色未触碰、0 桶归零）、`TaskMasterPanel.tsx` 1 → 0（0-E6c，#103 热点、1 处落 1 行、PRD 完成通知浮层文字色、纯 white 族、纯 `text` 1、全裸类、零透明度、`bg-green-600` 未触碰、1 桶归零（text: white））、`Dialog.tsx` 1 → 0（0-E6d，#104 热点、1 处落 1 行、共享 Dialog 遮罩层底色、纯 black 族、纯 `bg` 1、全裸类、50% 一处、文件全仓零语义彩色、1 桶归零（bg: black））。**每片的通过门槛是"双绿"**：快照基线按预期减少（证明字面在消失）＋ 守恒律零漂移（证明换上去的令牌对且保形），见 0-E2c 记录。

**`dark:` 处置不设独立片**：它必须并入各文件集群片的同一个 diff（`bg-x dark:bg-y` 是成对结构，见 §5.7）。本阶段对 `dark:` 的产出只是纸面工作（分类清单），不是独立施工片。

**豁免清单是单一事实源（v3）**：必须**机器可校验**，不能只写在 `index.css` 顶部注释里（注释会漂移）。建议独立清单文件（`文件:行号` 或 `模式 + 理由`），验收脚本以 allowlist 排除方式执行；新代码引入硬编码时先过清单。**§5.7 的三分法分类清单与本豁免清单是同一份资产，一次建设、共同消费。**

**每片完成的定义（DoD 三件套，固定化）**：

1. **该片 grep 清零**（对机器可校验 allowlist）：§5.7 的 ①②③ 三条命令在该片覆盖文件上收敛到豁免清单内
2. **视觉基线比对，阈值 0**：Playwright 截图（`toHaveScreenshot` 或 + `pixelmatch`），对聊天页 / 设置页 / 终端页 / 编辑器 diff / Git 图 / 权限面板在 light、dark 下各拍基线图。这是把"零变化"这一**定量承诺**定量验收——纯人工肉眼回归发现不了 alpha 偏移 5%、光标色微差、滚动条宽 1px
3. **计算值等值断言（0-A 片必做，其余片可选）**：改写前后对全部令牌取 `getComputedStyle` 的 resolved value，逐位相等断言。0-A 片的"视觉零变化"最难验证（`hsl(var(--x))` 包裹与 HSL 通道拆分是否等值，像素比对受反锯齿与字体渲染干扰），纯 JS 断言比截图回归更精确、更轻、可逐令牌定位失败点

**额外要求**：`npm run test:client`、`npm run build:client`、`npm run typecheck`、`npm run lint` 全绿；§5.11 的令牌契约测试通过。

**阶段 0 的定量终点**：整仓中性色具名类从 1502 处收敛到"仅豁免清单命中"，**而非"计划内的片改完就算完"**。0-E0 已把它变成可测的：`src/shared/tests/theme-hardcoded-baseline.json` 的 `total` 即当前待迁移量，终点是 **`total = 0`**（豁免项不计入），护栏在每片提交时强制显式刷新该数。

**配对层护栏（0-E2c 补，固定化）**：DoD 第 1 项只证明"字面在减少"，对"换上去的类是否等于被换掉的类"零约束——0-E2 的 V2（错档位）/ V3（丢透明度）/ V4（丢变体）实测都能穿过它。现以 `src/shared/tests/themeAtomConservation.test.ts` 的**守恒律**补齐：中性色按 `变体链 工具类: 族-档/透明度` 建成仓库级普查，**在 `src/` 中字面拼写与 `n-*` 拼写共享同一个桶**，冻结快照 `theme-atom-conservation.json`（当前总量 **1517**，0-E2e 扩面后；含轴限定工具类）。因此每片的通过门槛是"双绿"——快照 `total` 按预期减少 **且** 守恒律零漂移；新增中性色（字面或 `n-*`）需在同一个 commit 里刷新冻结值并逐桶核对 diff。

**价值**：立即解决"终端 / 编辑器配色与界面不搭"的实际问题，且是 1/2 的前置。

#### 0-A 实施记录（2026-09-25）

**改动**：`src/index.css` 的 `:root` / `.dark`——19 个 L1 palette 令牌（命名见附录 A），全部颜色类 L2 令牌（含 `--nav-*` 的 alpha 项）改写为 `var(--palette-*)` 引用。**语义命名未动、尺寸类令牌未动、Tailwind 配置未动、16 处 `hsl(var(--x))` 未动**（理由见 §5.1 v4）。

**新增契约测试**：`tests/theme-tokens/`（独立 Vite fixture + Playwright，照 `tests/transcript-layout/` 模式；`npm run test:theme-tokens`、`npm run typecheck:theme-tokens`）。四项检查：

| 检查 | 作用 |
|---|---|
| resolved 值与签入基线逐位相等 | 把"视觉零变化"变成可测断言（令牌字符串 + 经 `hsl(var(--x))` 真实解析的颜色双层） |
| 基线覆盖样式表声明的全部令牌 | 新增令牌必须显式入库，否则不受护栏 |
| 每个 palette 令牌都有消费者 | 防 DSH #3 那类"死令牌"（覆盖它却不改变任何 UI） |
| 无颜色声明绕过 palette | 0-A 的收口护栏 |

后两项读**声明文本**而非 resolved 值：`getComputedStyle` 会先展开 `var()`，间接层在那里不可见（这是实施中踩到的第一个坑）。

**验收证据**：

- **零漂移**：改写后用**改写前**的基线跑检查 1，全部令牌 resolved 值跨 chromium / webkit 逐位相等（该次运行中"基线覆盖"一项因"新增 palette 令牌未入库"而红，恰好反证了"只有新增、没有改动"）；随后固化新基线，8 项检查全绿
- `npm run test:client` 122 文件 / 847 用例通过；`typecheck`、`typecheck:theme-tokens`、`lint`（0 error）、`build:client` 全绿
- 生产产物核对：19 个 palette 令牌均进入 `dist` CSS，且 minifier **保留** `var()` 引用（`--background: var(--palette-sand-50)`）——若被展开成字面值，主题覆盖就失效了，这一步是必须的

**替代截图回归的理由**：DoD 第 2 项要求阈值 0 的视觉基线。0-A 用**计算值等值断言**替代（DoD 第 3 项本就把这一项标为"0-A 片必做"，理由是"纯 JS 断言比截图回归更精确、更轻、可逐令牌定位失败点"）：截图比对受反锯齿与字体渲染干扰、跨机漂移，而计算值断言能定位到具体令牌。0-A 是纯变量来源改写，令牌值不变即渲染不变，该替代在此片是**更强**的保证。真实渲染路径由 fixture 的 probe（`hsl(var(--x))` 实解析颜色）覆盖。

**实施中发现的坑（对后续片与主题机制有用）**：`src/index.css:328-337` 给所有 `div`/`span`/`p` 等加了 `transition: background-color/border-color/color 200ms`（"Color transitions for theme switching"）。这意味着**主题/明暗切换时全站颜色是渐变过渡的**，任何"切换后立即读颜色"的验收代码都会读到过渡起始值。fixture 用内联 `transition: none` 规避；阶段 1 的"首帧无闪烁"验收与主题切换动画设计都应把这条既存行为纳入考虑。

**行号偏移说明**：0-A 在 `:root` 内新增 palette 层，使 `index.css` **176 行之后的内容整体下移 35 行**（逐行核对：原 382/592/654/746/964/1019/1062/1063 → 417/627/689/781/999/1054/1097/1098）。**正文引用已全部同步**；文末批注区保留审阅者写作时刻的原始行号，未做改动。

#### 0-B 实施记录（2026-09-25）

**改动**：语法高亮主题从"chat 模块私有"提升为共享形态。

| 文件 | 变化 |
|---|---|
| `src/shared/syntaxTheme.ts`（新增） | `buildSyntaxTheme` / `PrismStyleSheet` / `SyntaxTheme` 由 `src/modules/chat/utils/syntaxHighlightTheme.ts` 迁入（构建逻辑一字未改，`:33-75`）；新增 `syntaxTheme` 单例（`:82`）与 `cc-syntax-theme` 样式注入（`:84-95`） |
| `src/shared/tests/syntaxTheme.test.ts`（迁移） | 原 `src/modules/chat/tests/syntaxHighlightTheme.test.ts`，改指 shared 模块（lossless 断言不变） |
| `src/modules/chat/transcript/Markdown.tsx` | 删除本地 `buildSyntaxTheme` 调用与样式注入，改导入共享单例（`:14`、`:182`） |
| `src/modules/code-editor/markdown/MarkdownCodeBlock.tsx` | `style={isDarkMode ? prismOneDark : prismOneLight}` → `style={syntaxTheme.style}`（恒定，`:69`）；直连 Prism 主题的导入删除 |
| `src/modules/code-editor/tests/markdownCodeBlockSyntaxTheme.test.tsx`（新增） | 4 项护栏 |
| `.oxlintrc.json` | `boundaries/elements` 的 `frontend-shared-file` 清单加入 `src/shared/syntaxTheme.ts` |

**为什么必须迁移，而不是"让 code-editor 从 chat 的 barrel 导入"**：`Markdown.tsx:9` 已 `import { MermaidDiagram } from '@/modules/code-editor'`——**chat 依赖 code-editor**。若 code-editor 反向依赖 chat 的主题模块，即构成模块环；规范也要求跨模块只经 `index.ts`。shared 是唯一合法落点。

**为什么保留 `isDarkMode`**：`MarkdownCodeBlock` 的 `customStyle`（light 下 `background: hsl(var(--muted))`）与 `codeTagProps` 不是语法高亮配色，而是**容器背景策略**，且已是变量引用。0-B 只替换 `style` prop 的来源，保留该分支即实现视觉零变化——dark 下 `<pre>` 背景由 `syntaxTheme.style` 的 `pre` 规则提供，取值等于改前的 `prismOneDark`。

**护栏与反向验证**：新增 4 项测试断言 ① 每个 token 颜色都是 `var(--cc-syntax-N)`；② `<pre>` 自身颜色也是变量；③ light 与 dark 渲染出的 token 颜色序列**完全相同**；④ 注入样式表声明了被引用的变量。为确认护栏不是"假绿"，用 `git stash` 把 `MarkdownCodeBlock.tsx` 临时回退到改写前实现重跑——**4 项全红**（`token colour "rgb(166, 38, 164)" is not a variable`、明暗 token 颜色不同、样式表未注入），随后 `git stash pop` 复原。

**验收证据**：

- `npm run test:client` 123 文件 / 851 用例通过（基线 122/847；净增 = 新增 1 文件 4 用例，迁移不改计数）
- `typecheck`、`lint`（153 warnings / **0 error**，与 0-A 后基线一致）、`build:client` 全绿
- 该片 grep 清零：`from 'react-syntax-highlighter/dist/esm/styles/prism'` 全仓仅剩 `src/shared/syntaxTheme.ts`（单一事实源）与其测试；`cc-syntax-theme` 注入点唯一
- code-editor 路径**自足**：护栏测试只导入 `MarkdownCodeBlock`（不经 chat），仍断言到样式表已注入——证明编辑器单独加载时主题可用

**实施中发现的坑（对阶段 1/2 有用）**：本仓的架构边界（`.oxlintrc.json:43-120`）把 `src/shared/` 下的**单文件逐个登记**在 `frontend-shared-file` 清单里，`boundaries/include` 也只收录 `src/shared/*.ts` 这一层。新增 shared 文件若不登记，`boundaries(no-unknown)` 会直接报 **error**（不是 warning），使 `npm run lint` 失败。阶段 1 若新增 shared 级模块（如主题注册表），必须同步登记。

#### 0-C 实施记录（2026-09-25）

**改动**：终端配色从"JS 里写死"改为"CSS 令牌 + 运行期解析"。

| 文件 | 变化 |
|---|---|
| `src/index.css` | L1 新增 20 个 `--palette-term-*`（`:80-105`）；L2 新增 22 个 `--term-*`（6 基础 + 8 正常 + 8 bright，`:142-168`）与 4 个语义别名（`:170-177`）。**只在 `:root` 声明**——终端明暗共用同一深色板（§8.3 已决） |
| `src/modules/shell/utils/terminalTheme.ts`（新增） | `TERMINAL_THEME_TOKENS`（token→xterm 键）+ `readTerminalTheme()`：探针元素写 `hsl(var(--token))`，用 `getComputedStyle` 把令牌解析成 xterm 需要的具体颜色 |
| `src/modules/shell/hooks/useShellTerminal.ts` | 删除 38 处 hex 与 `extendedAnsi`；构造 Terminal 时 `theme: readTerminalTheme()`；新增"切换明暗时重读令牌重设 theme"的 effect |
| `tests/theme-tokens/main.ts` | PROBES 增加全部终端令牌（含 4 个别名），并暴露 `readTerminalTheme` 供浏览器内直调 |
| `tests/theme-tokens/terminal-tokens.spec.ts`（新增） | 4 项护栏 |

**为什么必须引入运行期解析**：xterm 把内容画进 canvas，`ITheme` 只接受具体色值、不支持 `var()`——这正是 §5.7 与 §5.6 早已标明的"JS 消费者"约束。解析用**探针元素**而不是 `getPropertyValue('--x')`：后者返回的是三元组字符串（`0 0% 11.8%`），而 xterm 5.5.0 的颜色解析器（`common/Color.ts` 的 `toColor`）只可靠支持 `#rgb[a]` / `#rrggbb[aa]` / `rgb()` / `rgba()`；探针经浏览器解析后返回规范的 `rgb(r, g, b)`，与 Tailwind 的 `hsl(var(--x))` 消费路径完全一致，且把格式风险挡在构建期测试里。

**L1 格式沿用三元组**：终端板的 hex 值按 CSS 的 HSL 算法换算（1 位小数即可精确往返）；20 个 `--palette-term-*` 覆盖 19 个不同色值（`--palette-term-cursor` 与 `--palette-term-bright-white` 同为 `#ffffff`，按角色分开命名）。**往返精度可证，不是"看着对"**——护栏断言每个 xterm 主题键解析出的颜色等于改造前那串 hex 的 `rgb()`。

**`extendedAnsi` 废弃 —— 本片唯一有意的渲染变更**：附录 A 建议废弃这 16 个值；执行时确认了比"减少变量"更硬的理由：xterm 把 `theme.extendedAnsi[i]` 写入 `colors.ansi[16..31]`（`browser/services/ThemeService.ts`），而这 16 个槽位是 **256 色 6×6×6 立方体的前 16 项**（`#000000` / `#00005f` / `#000087` …），并非第二套 ANSI 梯度。原硬编码的 VGA 板（`#800000` / `#008000` / …）会把这 16 个槽位画错、破坏立方体。故**未采用"由 bright 系列推导"的字面做法**（那仍会占用这 16 个槽位），而是**删掉该字段**，把槽位交回 xterm 的标准立方体。

- 影响面：仅 `\e[38;5;16m`…`\e[38;5;31m` 这类显式 256 色码。**ANSI 0–15（`\e[31m` 等）与 232–255 灰阶不受影响**；终端页截图也不经过这些槽位
- 这**违反阶段 0"视觉零变化"的字面要求，属明知并有意**的例外（依据是附录 A 的既有处置意见），故在此显式记账。若要求严格零变化，恢复方式即补回 16 个令牌

**护栏与反向验证**：

- **类型层面**：`TERMINAL_THEME_TOKENS` 用 `satisfies Record<ThemedColourKey, string>` 约束，键集由 xterm 的 `ITheme` 推导（排除 `selectionInactiveBackground`——终端从未设置它，xterm 默认的半透明白没有对应令牌）。**实测删掉 `brightWhite` 一行，`npm run typecheck` 立即报 TS1360**，证明漏键在编译期就被拦住
- **行为层面 4 项**：token 颜色解析回原 hex 板、语义别名与 `--term-ansi-*` 同色、明暗两态同板、`extendedAnsi` 不再被覆写。**反向验证**：把 `--palette-term-red` 临时改成 `0 61.4% 70%`，护栏报 `red: expected rgb(205, 49, 49), got rgb(225, 132, 132)`
- **顺带确认了两层护栏的分工**：把该值改成 `49.9%`（渲染结果不变）时，只有"令牌字符串 vs 基线"那条报错，终端护栏仍绿——**字符串层保令牌同一性，渲染层保视觉同一性**

**验收证据**：

- **零漂移**：用 0-C 前的基线跑契约测试，**"resolved token values match the checked-in baseline" 全绿**（既有令牌逐位未变）；唯一红灯是"baseline covers every token"，未覆盖项**恰好只有新增的 46 个令牌**（20 palette + 26 L2），反证"只新增、未改动"。随后固化基线，16 项检查（8 × chromium/webkit）全绿
- `npm run test:client` 123 文件 / 851 用例通过（与 0-B 相同——终端护栏落在 Playwright fixture 而非 vitest：该行为只在真实浏览器里可验）
- `typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`build:client` 全绿
- 生产产物：20 个 `--palette-term-*` 全部进入 `dist` CSS，且 minifier **保留**整条间接链（`--term-ansi-red: var(--palette-term-red)`、`--term-error: var(--term-ansi-red)`）
- 该片 grep 清零：`useShellTerminal.ts` 与 `terminalTheme.ts` 已无任何 hex / rgb 字面量

**实施中发现的坑**：终端的明暗刷新只能靠 `useTheme().isDarkMode` 触发，而 `.dark` 的 class 切换是本项目当前**唯一**的"主题信号"。阶段 1 引入 `data-theme` 后必须扩展这个信号，否则换主题不会刷新已打开的终端——这与 §5.6"JS 消费者需要主动刷新"是同一条约束，CodeMirror 侧同理。

**行号偏移**：0-C 在 `index.css` 的 `:root` 内共插入 64 行，`:root` 之后的全部内容下移 64 行（逐行核对：原 382/592/654/746/964/1019/1062/1063 → 481/691/753/845/1063/1118/1161/1162）。正文引用已同步（`:root`/`.dark` 区间改为 `45-239`、`.dark` 起点改为 `:207`、暗色补偿段改为 `481-691` 等）；文末批注区与两轮牵头结论保留写作时刻的原始行号，未做改动。

#### 0-D 实施记录（2026-09-25）

**改动**：编辑器配色从"第三方主题 + `isDarkMode` 三元"改为"CSS 令牌 + 自建 CodeMirror 主题"。

| 文件 | 变化 |
|---|---|
| `src/index.css` | L2 新增 **43 个** `--editor-*`（29 个 UI/面板/搜索/折叠/tooltip/自动补全 + 13 个 diff/toolbar/minimap/loading + 1 个 invalid）。`:root` 写 light 值（= CodeMirror base theme 与 `defaultLightThemeOption` 当前渲染值），`.dark` 覆盖为 oneDark 值 |
| `src/modules/code-editor/utils/editorTheme.ts`（新增） | `editorChrome`（两态共用的 `EditorView.theme()` 规则，颜色全 `var()`）、`editorLightTheme` / `editorDarkTheme`（共用规则集，仅 `dark` 标志与一条 `.cm-content ::selection` 不同）、`editorHighlightStyle` / `editorHighlightExtension`（`HighlightStyle.define()`，颜色经 `SYNTAX_TOKEN_MAP` 指向 `--cc-syntax-N`） |
| `utils/editorStyles.ts` | 13 处 `isDarkMode ? A : B` → `var(--editor-diff-*)` / `var(--editor-toolbar-*)`；两个 getter 退化为常量 `EDITOR_STYLES` / `EDITOR_LOADING_STYLES` |
| `CodeEditorSurface.tsx` | `theme={isDarkMode ? oneDark : undefined}` → `theme={isDarkMode ? editorDarkTheme : editorLightTheme}`，`oneDark` 导入删除 |
| `CodeEditor.tsx` | `<style>{EDITOR_STYLES}</style>`；extensions 数组加 `editorHighlightExtension` |
| `CodeEditorLoadingState.tsx` | `isDarkMode` 成为孤儿 prop（样式不再需要），连同调用点一并删除 |
| `src/shared/syntaxTheme.ts` | 新增 `SYNTAX_SELECTORS`（语义名 → Prism `selector.property`）、`collectSyntaxVariables`、`deriveTokenMap`、`SYNTAX_TOKEN_MAP` |
| `tests/theme-tokens/main.ts` | PROBES 支持 `wrap: 'raw'`，为 38 个编辑器颜色令牌加裸 `var()` 探针 |
| `src/shared/tests/syntaxThemeTokenMap.test.ts`、`src/modules/code-editor/tests/editorThemeTokens.test.ts`（新增） | 6 + 5 项护栏 |

**关键判断：编辑器不需要 xterm 那样的运行期解析**。CodeMirror 由 CSS 驱动——`EditorView.theme()` 与 `HighlightStyle.define()` 的样式值经 style-mod 原样写进规则，可直接写 `var(--x)`，明暗与主题切换都靠变量翻转，不必重建扩展。这与 0-C 的 xterm（canvas 消费者、`ITheme` 不收 `var()`）恰成对照。**仍是两套规则而非一套**：两态唯一的结构差异是 dark 额外给 `.cm-content ::selection` 上色（light 交给浏览器默认），其余规则共用 `editorChrome`。

**语法面：为什么"共用令牌"必然带来可见变化（本片有意的渲染变更）**。`@codemirror/theme-one-dark` 与 `react-syntax-highlighter` 的 One Dark **不是同一个色板**——前者多出 `chalky #e5c07b`（typeName / className / number / changed / annotation / modifier / self / namespace）与 `stone #7d8799`（meta / comment），Prism 侧无同值槽位。共用 `--cc-syntax-N` 后：

- **dark**：上述 8 个常见 tag 由 `#e5c07b` 变 `#d19a66`，comment 由 `#7d8799` 变 `#5c6370`；其余 tag 与 Prism 同值（同源调色板），如 keyword `#c678dd`、operator/variable/function `#61afef`
- **light**：编辑器语法高亮从 CodeMirror 内置 `defaultHighlightStyle`（`#708` / `#a11` / `#940`）**整体切换为 One Light**，与 chat 代码块一致
- `tags.invalid` 在 Prism 无对应槽位，另立 `--editor-invalid`（light `#f00` / dark `#ffffff`，即原值）保零变化

映射按"**色值组优先、组内取语义最近类别**"选取（如 CM 的 operator 组在 Prism 中同值的只有 `url` 槽位），故少数 tag 的语义名与实际槽位并不对应——这正是阶段 2 语义化改名要重新决策的部分，已在 §5.9 记账。

**有意豁免（本片唯一未令牌化处）**：`editorExtensions.ts` 的 minimap gutter 色（`rgba(34, 197, 94, 0.8/1)`）——`@replit/codemirror-minimap` 用 canvas `fillStyle` 绘制，与 xterm 同属"canvas 消费者"，`var()` 无效。影响面仅 diff minimap 的绿条，且 minimap 背景已令牌化（`--editor-minimap-bg`）。

**护栏与反向验证**：

- `syntaxThemeTokenMap.test.ts` 6 项：语义映射都能解析到真实变量、名字互不重复、变量总数冻结（136）、完整 `selector.property → 变量` 快照、10 个语义槽位的 One Dark 色值冻结、全仓无手写 `--cc-syntax-N`
- `editorThemeTokens.test.ts` 5 项：chrome 全是令牌引用、引用的 `--editor-*` 都已声明、highlight spec 全是 `var()`、借用的 `--cc-syntax-N` 都在 Prism 表中、code-editor 模块不再 import `one-dark`
- **反向验证（逐条确认不是假绿）**：① `keyword` 槽位改指 `number.color` → "名字互不重复"与"One Dark 色值"**双红**（`"keyword" (--cc-syntax-28) moved off its One Dark colour`）；② highlight 颜色写成 `#c678dd` → 红（`a highlight spec holds a literal colour`）；③ chrome 背景写成 `#ffffff` → 红（`chrome holds a literal value`）；④ 两处 `--editor-caret` 声明改名（模拟拼错）→ 红（`referenced but never declared`）。四项改回后均恢复全绿

**验收证据**：

- **零漂移（既有令牌）**：固化基线**之前**先跑一次契约测试——"resolved token values match the checked-in baseline" 14 项全绿（既有令牌逐位未变），唯一红灯是"baseline covers every token"，未覆盖项**恰好只有新增的 86 项**（43 × 明暗），反证"只新增、未改动"；随后固化基线，16 项全绿
- **新令牌探针非假绿**：基线 `rendered` 中 38 个编辑器颜色令牌都解析出具体颜色（light `--editor-bg = rgb(255, 255, 255)`、dark `= rgb(40, 44, 52)`；light `--editor-fg = rgb(13, 11, 8)` 即 `--palette-sand-950`），而非探针失败时的默认值
- `npm run test:client` **125 文件 / 862 用例**通过（0-C 基线 123/851；净增 = 2 文件 11 用例）
- `typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`build:client` 全绿
- 生产产物：43 个 `--editor-*` **全部**进入 `dist` CSS，minifier **保留**间接链（`--editor-bg: hsl(var(--palette-white))`、`--editor-toolbar-bg: hsl(var(--palette-white))` / `#1f2937`）；`var(--editor-invalid)` 与 `cc-syntax-theme` 注入点都在 bundle 里。**注**：`--cc-syntax-N` 字符串**不在**产物中是预期行为——它由 `deriveTokenMap` 在运行期从 Prism 主题对象算出，因此该层的令牌同一性只能由 vitest 断言（specs 全为 `var()`）保证，对产物 grep 不适用
- 该片 grep 清零：`src/` 下 `@codemirror/theme-one-dark` **零导入**（由护栏测试扫描 code-editor 模块持续保证）；`editorStyles.ts` 已无 hex/rgb 字面量

**实施中发现的坑（对后续片与阶段 1 有用）**：

1. `@uiw/react-codemirror` 的 `theme` prop 变化走 `StateEffect.reconfigure`（`useCodeMirror.js:141-148`），保留文档与撤销历史、不重建 view——"切明暗会重建编辑器"的担心不成立
2. `theme={undefined}` 会落到 uiw 的默认参数 `'light'`（`getDefaultExtensions.js`），注入 `defaultLightThemeOption`（仅 `background:#fff`）——**`undefined` 不等于"无主题"**，这也解释了现状 light 侧语法色其实来自 `basicSetup` 的 `defaultHighlightStyle` 兜底
3. 令牌值的形态决定探针写法：`--editor-*` 是**完整颜色表达式**，用 `hsl(var(--x))` 探针会得到无效的 `hsl(#282c34)`，必须用裸 `var(--x)`（`tests/theme-tokens/main.ts` 的 `wrap` 字段）
4. `Array.prototype.flatMap` 的回调**返回 string 会被展开成字符数组**——`match ? [m[1]] : []` 不能简写成 `exec()?.[1] ?? []`；本次调试中该 bug 让"令牌是否已声明"护栏报出全部令牌缺失

**行号偏移**：0-D 在 `index.css` 的 `:root` 内插入 58 行（编辑器块 `:179-236`）、`.dark` 内插入 49 行（编辑器块 `:298-344`），二者合计使 `.dark` 之后的内容整体下移 **107 行**。`:root` / `.dark` 区间由 `45-239` 变为 `45-346`，`.dark` 起点由 `:207` 变为 `:265`，暗色补偿段的 `Color transitions for theme switching` 注释现位于 `:434`。正文引用已按需同步；文末批注区与两轮牵头结论保留写作时刻的原始行号，未做改动。

#### 0-E0 / 0-E1 实施记录（2026-09-25）

二者合成一批交付：0-E0 是**验证设施**（与 A1/B 选型无关），0-E1 是 A1 的**令牌地基**。本批**不做任何类替换**——替换属 0-E2+，按文件集群逐片进行。

**为什么是 A1（保形间接）而不是语义化折叠**：实测本片有 **89 种不同的 `(light, dark)` 元组**（如 `gray-50→gray-800`、`white→gray-800`、`gray-100→gray-700` 各算一种），覆盖约 570 处原子；而**一个令牌类只能承载一对值**。因此"折叠到 ~12–15 个角色令牌"与"像素零变化"不可兼得，实测色差：`text-gray-700→gray-300` 一处 light ΔRGB 100、`bg-white→gray-700` 一处 dark Δ 65。A1 保留档位粒度、恒等映射，把零变化做成**可证明**而非可猜。同族方案对比：A0（config 里把 `gray` 键指向令牌）虽 0 处 TSX 改动，但保留 `bg-gray-100` 字面、使 §5.7 的具名色审计失去意义，且正是 §8.8 拍板排除的路线；A2（折叠语义令牌）干净但放弃零变化。

**0-E0 交付**

| 文件 | 作用 |
|---|---|
| `src/shared/tests/themeHardcodedAtoms.ts`（新增；本批同时收敛） | variant-aware 扫描器：认 `hover:` / `dark:` / `prose-pre:` / `bg-gray-900/50` / `shadow-black/[0.025]`。与 §5.7 的 grep 逐条对齐；**测试目录整体排除**（spec 里引用类名是描述行为，不画产品 UI；审计资产自身也必须能写出它要找的类名），故只度量 `src/` 下的渲染代码——排除后命中恰为 **1502 处 / 105 文件**，与 §5.7 一致 |
| `src/shared/tests/themeHardcodedAllowlist.ts`（新增） | **永不**迁移项：`file + token + 理由`，逐条窄匹配（同 token 出现在别处即失败——"豁免"不能悄悄变成"遗忘"）。当前仅 1 条，见下方"发现的既有 bug" |
| `src/shared/tests/theme-hardcoded-baseline.json`（新增） | **待迁移**派生快照：`total` + `byFile` + `byAtom` 计数。**计数而非行号**（行号随无关编辑漂移），`byAtom` 另可抓住"同文件内一增一减"的替换 |
| `src/shared/tests/themeHardcodedAtoms.test.ts`（新增） | 2 项护栏：① 豁免清单无死项；② 剩余命中 ⊆ 基线（失败时逐条报出 `file …: baseline 1, now 0` / `atom text: white: …`）。刷新：`UPDATE_THEME_HARDCODED_BASELINE=1` |

**0-E1 交付**

| 文件 | 变化 |
|---|---|
| `src/index.css` | L1 新增 **11 个** `--palette-gray-50..950`（Tailwind `gray` 逐档值，**1 位小数 HSL 三元组精确往返**，55 个档位全族实测 0 失配）；L2 新增 **13 个** `--n-gray-50..950` + `--n-white` + `--n-black`。**只在 `:root` 声明**：档位表与外观无关，"明暗差异"仍由各站点选哪个档位表达（`bg-n-gray-100 dark:bg-n-gray-700`），与原字面类行为一致。两个极值**复用**既有 `--palette-white` / `--palette-black`，不另造同值令牌 |
| `tailwind.config.js` | 注册 `n-gray`（11 档）、`n-white`、`n-black` → `hsl(var(--n-*))`。类名形态 `bg-n-gray-100`：`n` = neutral，且不再被 §5.7 的具名色 grep 命中（这正是 A1 让审计可清零的原因）。**改名轮若立项，本键随改名一并调整；`--n-*` 令牌层本身是永久契约面（2026-09-26 拍板，见 §5.7），不因改名删除** |
| `src/shared/tests/neutralScale.ts`（新增） | 档位表的单一事实源：`GRAY_STEPS`、`grayHex`（**运行期读 `tailwindcss/colors`**，不重述字面值）、`hexToHslTriplet` / `hslTripletToHex`、命名与声明读取助手 |
| `src/shared/tests/neutralScale.test.ts`（新增） | 31 项等值护栏，见下 |
| `tests/theme-tokens/main.ts` | 13 个 `--n-*` 加 `hsl()` 探针，进契约基线 |

**等值护栏：四段链条，逐段可定位**。承诺是"浏览器画出同一个颜色"，这只在整条链都成立时才为真，故四段分别断言：

```
class  →  tailwind config  →  hsl(var(--n-gray-100))  →  --n-gray-100  →  --palette-gray-100  →  Tailwind 的字面值
        ① test：loadConfig 解析真实配置，12 个键逐一相等      ② test：转发到对应 palette    ③ test：等于 colors.gray[100]
                                                        ④ tests/theme-tokens 基线：浏览器解析出的 rgb() 与 Tailwind 的 rgb 一致
```

其中 ③ 有意做成**非自洽**：`hexToHslTriplet` 必须对全族**无损**（`hslTripletToHex(hexToHslTriplet(hex)) === hex`，31 项中单独一条），否则整条链会"忠实地"保留一个**近似**值。用 `tailwindcss/loadConfig.js` 解析真实配置（而非正则读文本），这样 `n-gray` 少一档、写错变量名、多出未登记的键都会红。**读声明文本而非 `getComputedStyle`**：后者会展开 `var()`，恰好把要考的间接层抹掉（0-B 的教训）。

**反向验证（5 条，逐条确认不是假绿）**：① `--palette-gray-100` 的 `95.9%` 改成 `95%` → 红；② `--n-gray-100` 转发改指 `--palette-gray-200` → 红；③ config 里 `500` 键写成 `hsl(var(--n-gray-5000))` → 红；④ 在 `ComposerAttachment.tsx` 加一处 `bg-gray-500` → 红（`file …: baseline 1, now 2`）；⑤ 把该文件真实的 `text-white` 迁移成 `text-n-white` → 红（`file …: baseline 1, now 0` + `atom text: white: baseline 143, now 142`）。**⑤ 第一次跑时是绿的**——原因是我挑的 `bg-gray-100` 在该文件根本不存在，`sed` 空转；换成真实命中后如期变红。这条提醒：反向验证必须挑**真实命中**，否则"绿"什么也证明不了。

**验收证据**

- **零漂移（既有令牌）**：固化基线**之前**先跑契约测试——"resolved token values match the checked-in baseline" 14 项全绿，唯一红灯是"baseline covers every token"，未覆盖项**恰好只有新增的 26 项**（13 × 明暗），反证"只新增、未改动"；随后固化基线，16 项全绿
- **新令牌探针非假绿**：基线 `rendered` 里 13 个 `--n-*` 都解析出具体 `rgb()`，且 **light 与 dark 完全相同**：`--n-gray-100 = rgb(243, 244, 246)`（= `#f3f4f6`）、`--n-gray-950 = rgb(3, 7, 18)`（= `#030712`）、`--n-white = rgb(255, 255, 255)`、`--n-black = rgb(0, 0, 0)`——逐档与 Tailwind 的 hex 一致
- `npm run test:client` **127 文件 / 895 用例**通过（0-D 基线 125/862；净增 = 2 文件 33 用例）
- `typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**，与 0-D 持平）、`build:client` 全绿
- 生产产物：13 个 `--n-*` 与 11 个 `--palette-gray-*` 全部进入 `dist` CSS，minifier 保留间接链（`--n-gray-100: var(--palette-gray-100)`、`--palette-gray-100: 220 14.3% 95.9%`）；因暂无消费者，**不产出** `bg-n-gray-*` 工具类（预期）
- 该片"grep 清零"**尚未达成**（本批不做替换）：`src/shared/tests/theme-hardcoded-baseline.json` 的 `total` 当前为 **1501**（1502 − 1 条豁免），随 0-E2+ 逐片收敛，终点为 0

**发现的既有 bug（未修，交回负责人）**：`src/modules/chat/tools/ContentRenderers/QuestionAnswerContent.tsx:62` 的 `border-gray-150`——Tailwind 没有 `gray-150` 档位，该类**不生成任何 CSS**，那条边框实际不渲染。按 AGENTS.md"发现无关死代码只报告、不删除"，它以豁免项形式留在清单里，理由写明"要改成 `gray-200` 属于改设计、超出零变化范围"。**这是全仓唯一一条豁免**。

**实测热点榜（中性族口径，`byFile` 前 7）**：`AskUserQuestionPanel.tsx` 84、`TaskDetailModal.tsx` 72、`McpServerFormModal.tsx` 69、`AgentConnectionsStep.tsx` 60、`TaskBoardToolbar.tsx` 60、`VersionUpgradeModal.tsx` 55、`CodeEditorHeader.tsx` 52。与 §5.7 记的前 5 名一致（`VersionUpgradeModal` 55 亦一致），第 7 名起与附录 B 那份含彩色系的 grep 开始分叉。

**非 gray 族的处置（122 处，占 8%）—— 已定 (a)**。实测各族档位用量：`zinc` 57（10 档）、`slate` 40（10 档）、`neutral` 25（10 档）、`stone` **0**；三族各用到 10 个档位（共 30/33 个槽），所以"按需建档"与"全族建档"只差 6 行，**省不下令牌**。两条路里 **(a) 每族各自建档位令牌**被采纳，理由：① (b) 的归并要给等值护栏开 122 条例外，全称断言降级为人工目检——用 60 行 CSS 换掉刚建好的验收设施；② `--n-*` 是阶段 2 前的过渡层，多 3 个命名空间只是一次性成本；③ 与 0-D 的 `--editor-*` 同构（照抄第三方字面值来保零变化）。另一个变体 **config 别名**（在 `tailwind.config.js` 里把 `zinc` / `slate` / `neutral` 指向令牌，0 处 TSX 改动、同样零位移）**已否决**：它使 §5.7 的"1502 → 0"定量终点不可测——grep 再也分不清"合法间接"与"漏改"，省 122 处机械改动换来整套护栏失明，不值。实施见下一小节。

**行号偏移**：0-E1 在 `index.css` 的 `:root` 内插入 **41 行**（L1 档位块 11 行 + 7 行注释 + 空行；L2 `--n-*` 块 16 行 + 6 行注释 + 空行），插入点之前的行号不变，之后整体下移 41 行。**实测**：`:root` 起点仍为 `:46`、区间 `45-346 → 45-387`；`@layer base` 内的 `.dark` 起点 `:265 → :306`（区间 `306-386`）；暗色补偿段的 `.dark` 起点 `:623 → :664`；`Color transitions for theme switching` 注释 `:434 → :475`。

**一处欠账（顺带记账）**：§1.2 #8 与 §5.7 里那组暗色补偿锚点（`481-691`、`:753`、`:845`、`:1063-1118`、`:1161-1162`）写于 **0-C 时代**，0-D 的 +107 当时未同步，本片再 +41，**累计偏移 +148**——按此读作 `629-839`、`:901`、`:993`、`:1211-1266`、`:1309-1310`（抽查 8 个锚点均落在预期的 `!important` 色值行上）。本轮**不逐一改写这两处正文引用**：0-G 施工该块时会按内容重新定位，届时一并校正，避免现在写下的数字再漂一次。

#### 0-E1b 实施记录（2026-09-25）

非 gray 族取 (a)：每族各自建档位令牌；`stone` 不建（0 处消费者，避免死令牌）。**本批不改任何 TSX**，替换仍属 0-E2+。

**交付**

| 文件 | 变化 |
|---|---|
| `src/index.css` | L1 新增 **33 个** `--palette-{zinc,slate,neutral}-50..950`（Tailwind 逐档值，四族 44 档实测**全部精确往返**）；L2 新增 **33 个** `--n-*`。仍**只在 `:root` 声明**（档位与外观无关） |
| `tailwind.config.js` | 注册 `n-zinc` / `n-slate` / `n-neutral`（各 11 档）→ `hsl(var(--n-*))`；注释由 "named greys" 更正为 "named neutrals" 并写明为何不归并 |
| `src/shared/tests/neutralScale.ts` | 由 gray 单族泛化为 `(family, step)` 坐标系：`NEUTRAL_FAMILIES` / `NEUTRAL_STEPS` / `familyHex` / `SCALE_TOKEN_NAMES`；`paletteName`、`tokenName` 改双参 |
| `src/shared/tests/neutralScale.test.ts` | 31 → **100 项**；新增"族内档位封闭"断言——`^--palette-(gray\|zinc\|slate\|neutral)-` 的声明集合必须**精确等于**四族 × 11 档 |
| `tests/theme-tokens/main.ts` | 探针列表由硬编码改为**从 `SCALE_TOKEN_NAMES` 派生**，后续加族/档不必二次编辑 |

**泛化后为什么还是"全称"**：四段链条（`class → config → token → palette → Tailwind 字面值`）对**每族每档**逐条断言，共 44 档 × 3 段。"档位封闭"是原 `no step exists outside the Tailwind ramp` 的推广：正则扩到四族并做**集合相等**（实测给已有族多一个 `--palette-zinc-1000` 会红）。

**一个刻意的职责边界**：新增 `--palette-stone-100` 这类**全新族**不会让本测试变红——正则只认已登记的四族。这不是漏洞而是分工：无消费者的 palette 令牌归 `tests/theme-tokens` 的 `every palette token is consumed by at least one declaration` 管。两条都已实测（下表 N1/N2）。

**反向验证（7 条，全部实测；还原后 100 项复绿）**

| # | 注入的破坏 | 结果 |
|---|---|---|
| M1 | `--palette-zinc-800` 的 `15.9%` → `15%` | 红 |
| M2 | `--n-slate-100` 转发改指 `--palette-slate-200` | 红 |
| M3 | config 里 `n-neutral` 的 `800` 键指到 `--n-neutral-900` | 红 |
| M4 | 新增 `--palette-stone-100` | **绿** → 见 N2，属职责划分 |
| M5 | `--n-zinc-50` 重复声明两次 | 红（"declared exactly once"） |
| N1 | 新增 `--palette-zinc-1000`（已有族多档位） | 红（证明"档位封闭"确实生效，M4 的绿不是断言整体失效） |
| N2 | 新增 `--palette-stone-100` 后跑 `test:theme-tokens` | 红（`palette tokens no declaration references`） |

M4 的绿是本片唯一"预期外"结果，追查后确认是职责划分而非空洞。教训同 0-E1 的 ⑤：**绿必须问清归谁管**。

**验收证据**

- **零漂移（既有令牌）**：固化基线**之前**先跑契约测试，`resolved token values match the checked-in baseline` 全绿；唯一红灯是 `baseline covers every token`，未覆盖项**恰好 66 个**（33 个新 `--palette-*` + 33 个新 `--n-*`，去重后无一落在既有令牌上），反证"只新增、未改动"
- **新令牌探针非假绿**：`--n-zinc-800 = rgb(39, 39, 42)`（= `#27272a`）、`--n-slate-100 = rgb(241, 245, 249)`（= `#f1f5f9`）、`--n-neutral-950 = rgb(10, 10, 10)`（= `#0a0a0a`），且 **light 与 dark 完全相同**
- `npm run test:client` **127 文件 / 964 用例**通过（0-E1 基线 127/895；净增 69 = `neutralScale.test.ts` 由 31 增至 100）
- `typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`build:client` 全绿
- 生产产物：66 个新声明全部进 `dist` CSS；因暂无消费者**不产出** `bg-n-zinc-*` 等工具类（预期）
- `theme-hardcoded-baseline.json` 的 `total` 仍为 **1501**，终点 0 不变（替换未开始）

**行号偏移**：0-E1b 在 `index.css` 的 `:root` 内插入 **75 行**（L1 三族块 33 行 + 4 行注释/空行 + 原 gray 注释扩写 2 行；L2 三族块 33 行）。**实测**：`:root` 起点仍为 `:46`、区间 `45-387 → 45-462`；`@layer base` 内的 `.dark` 起点 `:306 → :381`（区间 `381-461`）；暗色补偿段的 `.dark` 起点 `:664 → :739`；`Color transitions for theme switching` 注释 `:475 → :550`。
**累计偏移**：§1.2 #8 与 §5.7 那组 0-C 时代锚点现为 **+223**（0-D 的 107 + 0-E1 的 41 + 本片 75），按此读作 `704-914`、`:976`、`:1068`、`:1286-1341`、`:1384-1385`（抽查 `:914`/`:976`/`:1068` 落在 `opacity: 1 !important`、`:1384` 落在色值行）。沿用 0-E1 的处置：**不逐一改写正文引用**，0-G 施工该块时按内容重新定位。

#### 0-E2 实施记录（2026-09-25）

**范围**：首个文件集群 ＋ 类级等值护栏的透明度路径 ＋ 实测到的两处隐雷。

**交付**

1. **`AgentConnectionsStep.tsx` 60 → 0**：7 个 provider 卡片的 class 串，gray 10 ＋ zinc 40 ＋ neutral 10；`blue` / `purple` 属三分法第二/三类，不动。18 行改动，逐 token 保形（变体前缀与 `/50` 修饰符原样保留）。
2. **类级等值护栏（第五段链条）**：新增 `neutralScaleCompiler.ts` 的 `compileUtilities()`——用真实 `tailwind.config.js`、经 Tailwind 自带 PostCSS 插件编译探针类名，对 `4 族 × 11 档 ＋ 2 极值` × `3 种 utility` × `3 种 modifier 形态`（plain / `/50` / `/[0.025]`，共 414 个类）逐条断言声明文本恰为 `hsl(var(--n-X))` 或 `hsl(var(--n-X) / α)`，且**只此一条声明**。存在的理由：全仓有 **121 处**中性色命中带透明度修饰符，而具名色走 `rgb(… / var(--tw-bg-opacity, 1))`、令牌色走 `hsl(var(…) / α)`，是两条不同的声明形态——此前这条路径没有任何机器护栏。
3. **旧式 opacity 共现护栏**：扫描器新增 `findOpacityCoupledAtoms()`（同一行同时出现中性色原子与旧式 `*-opacity-*` 工具类即命中），**不设豁免口**——唯二的合法解都是折叠，没有"可以留着"的情形。

**隐雷（实测发现并处置）**

`ImageViewer.tsx:62` 与 `ProviderLoginModal.tsx:128` 的 `bg-black bg-opacity-50`（两个模态遮罩）。具名色经 `--tw-bg-opacity` 渲染，令牌形态 `hsl(var(--n-black))` 不读该变量，**改名即静默丢掉半透明**——遮罩会从半透明变成全黑。折叠为 `bg-n-black/50` 后可证等价：`--n-black = rgb(0, 0, 0)`（明暗相同）⇒ `hsl(0 0% 0% / .5)` ≡ `rgb(0 0 0 / 0.5)`。全仓共 2 处，已清零；护栏从此常驻（先跑护栏确认它**恰好**报出这 2 处真实命中，再修）。

**一处返工与教训**：`compileUtilities` 初版直接写在 `neutralScale.ts` 里，而该模块被 `tests/theme-tokens/main.ts` 打进**浏览器 fixture**；`node:path` 与 Tailwind 编译器的引入让 fixture 整体崩掉（`test:theme-tokens` 由 16 绿变 12 红，报错信息完全指不到根因）。现拆为两文件：`neutralScale.ts` 保持纯数据，Node-only 部分进 `neutralScaleCompiler.ts`。**结论：`src/shared/tests/` 不等于"只在 Node 跑"，改动前先看谁 import 它。**

**零漂移证据（迁移部分）**：刷新基线**之前**先跑护栏，漂移清单**全部为减少、无一增加**，且每个原子级 delta 都能逐条归因——`total 1501 → 1439`（−62 = 本片 60 ＋ 隐雷 2）；`bg: black −2`、`bg: gray-100 −2 / gray-600 −1 / gray-700 −1 / gray-800 −3 / gray-900 −1`、`border: gray-300 −1 / gray-600 −1`、`bg: zinc-* 合计 −32`、`border: zinc-* −8`、`bg: neutral-* −8`、`border: neutral-* −2`。

**反向验证 5 组**（每组先用脚本打印实际替换次数，命中数为 0 即报错退出，杜绝空转假绿；全部突变事后核对残留为 0）

| 突变 | 规模 | 预期 | 实测 |
|---|---|---|---|
| V1 回退一处迁移（`bg-n-zinc-100 → bg-zinc-100`） | 8 处 | 红 | ✅ 红（快照 `total` 与 file/atom 三处漂移） |
| V2 迁到**错档位**（`bg-n-zinc-100 → bg-n-zinc-200`） | 8 处 | ? | ❌ **绿（未检出）** |
| V3 **丢掉透明度修饰符**（`dark:bg-n-zinc-800/50 → dark:bg-n-zinc-800`） | 4 处 | ? | ❌ **绿（未检出）** |
| V4 重新引入旧式共现（`bg-n-black/50 → bg-black bg-opacity-50`） | 1 处 | 红 | ✅ 红（共现护栏 ＋ 快照各一条） |
| V5 令牌值退化为字面 `hsl(240 3.7% 15.9%)` | 1 处 | 红 | ✅ 红（4 项） |

**本片暴露的护栏缺口（重要）**：V2 / V3 未检出，根因是**迁移后的类完全不在任何护栏视野内**——`theme-hardcoded-baseline.json` 只统计"尚未迁移的字面命中"，`n-*` 类不被扫描，`neutralScale.test.ts` 只证明令牌类**能够**正确承载值。也就是说当前护栏能证明的命题是"**字面色在减少**"，**不是**"**换上去的令牌是对的**"。DoD 承诺的"类↔令牌映射表 ＋ 等值断言护栏"正是为此；本片交付了其中的**值层**，**配对层**仍无约束。（**已由 0-E2c 闭合**，见下节。）

**下一步决策点（已由 0-E2c 拍板）**：补配对层，两个候选都能抓 V1 / V2 / V3

- **守恒律** ← **选定**：`扫描到的字面命中 byUsage ＋ 折叠后的 n-* byUsage ≡ 冻结的原始 byUsage`。一次性写完、全派生，后续集群零登记；代价是新增 UI 代码若使用 `n-*`，需随基线一起刷新冻结值（同现有基线刷新仪式）。实施见下节。
- **逐片映射表**（未选）：每个集群登记"该文件迁移前 byAtom → 迁移后 byAtom"，逐文件断言相等。记录更直白、历史可查；代价是 ~40 片各一条登记，且需防止登记本身被复制粘贴带错。

**验收**：`test:client` **127 文件 / 968 用例**（0-E1b 基线 127/964，净增 4 = 3 形态 ＋ 1 共现）；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`build:client`、`test:theme-tokens` 16 项全绿；`--n-*` 探针与令牌基线**未变动**（本片不新增令牌）。产物：迁移后的类产出令牌形态（`bg-n-gray-800\/50` → `hsl(var(--n-gray-800) / .5)`，透明度保留）；`bg-zinc-100` / `bg-neutral-100` 已从 `dist` **消失**（该文件是其唯一消费者）；`.bg-opacity-50` 也从 `dist` 消失（见下）。

**顺带修正**：写在注释里的**合法**类名会被 Tailwind 的 content 扫描（`./src/**/*.{js,ts,jsx,tsx}`，不排除测试）采进生产产物——本片新写的文档注释一度让 `.bg-opacity-50` 继续产出。现一律写成 `bg-opacity-*` 这类**非法**类名，并在注释里说明原因。

#### 0-E2c 实施记录（2026-09-25）

**范围**：闭合 0-E2 暴露的配对层缺口。**不改任何 TSX**，本片是纯护栏片——转移基线仍为 **1439 处 / 104 文件**。

**交付**

1. **守恒律**（`src/shared/tests/themeAtomConservation.test.ts` ＋ `theme-atom-conservation.json`）：仓库级中性色普查，键为 `usageKey`＝`变体链 工具类: 族-档/透明度`（如 `dark:hover bg: gray-100/50`）。字面与 `n-*` 两种拼写**落进同一个桶**，于是一次忠实迁移（纯改名）不动任何桶；而改档位、改工具类、改族、丢 `/50`、丢 `dark:` 都会把计数挪到邻桶，当场红。冻结文件与基线同为快照产物，同一套刷新仪式（`UPDATE_THEME_ATOM_CONSERVATION=1`）。
2. **跨零自洽的免费验证**：冻结总量 **1502**，恰好等于 0-E0 时代的全量字面命中数（当前字面 1439 剩余 ＋ 1 豁免 ＋ 已迁移 62）。也就是说 0-E2b 的 60 处迁移 ＋ 2 处折叠，在**没有任何登记**的情况下被这套普查追溯证明为守恒——守恒律对既有迁移是自洽的，不是只对新片生效。
3. **反空转守卫**（同文件的第一个用例）：逐条断言普查的每个键位**真的有取值**——`n-*` 命中数、带变体的 `n-*`、带透明度的 `n-*`、带透明度的字面量，四条各自 `> 0`。存在的理由：若 `n-*` 正则失效，两侧普查会一起退化成"只有字面量"，冻结文件随刷新照单全收，守恒律将**永远静默通过**。快照类护栏无法自证这一点，只能直接断言扫描形状。
4. **顺手修掉一个死字段**：`ATOM` 的透明度后缀是**非捕获组**，所以 `AtomHit.opacity` 自 0-E0 起恒为 `null`（形式上有字段、事实上无数据）。守恒律必须以透明度建键（否则 V3 不可见），故把它改为捕获组。该改动对既有基线**零漂移**（基线的 `byAtom` 标签不含透明度）。

**边界（写在明处的"不管"）**

- 普查**不记位置**：键里没有文件名。把类从 A 文件搬到 B 文件不会红——迁移是替换，不会搬类；按文件的收敛由基线快照负责。
- 普查**不记唯一性或顺序**：只记重数。同一行写两次同类会被计两次（`TOKEN` 分词器按 token 匹配），这符合"重数守恒"的定义。
- **新增**中性色会红（无论写成字面还是 `n-*`）：这是设计的一部分，不是误报——约定是"与迁移同 commit 刷新冻结值，并逐桶核对 JSON diff"。这也是本方案唯一的日常成本。
- 折叠（`bg-black bg-opacity-50` → `bg-n-black/50`）**不在守恒律视野内**：它是"一次性变化"，冻结值取自当前状态，历史变换被吸收进初值。它的证明在别处——共现护栏 ＋ 类级等值断言（第五段链条）＋ `--n-black` 取值，三者在 0-E2 已交付。

**对草案的一处有意加强**：决策点原文只要求抓 V1 / V2 / V3，键**没有**包含变体链。实测发现全仓 `variants` 被扫描但**没有任何护栏消费**（`grep -rn variants src/shared/tests`），即"丢 `dark:`"属"没人管"而非"归别人管"。变体链在多一个字段的前提下即可纳入，故把它并入 `usageKey`。代价：变体上下文发生合法变化（如给一处加 hover 态）时需刷新冻结值，与"新增颜色"共用同一仪式。

**反向验证 10 组**（每组先打印实际替换次数，命中数为 0 即中止以防空转；全部突变事后 `diff` 核对字节级还原）

Mutation 侧：

| 突变 | 规模 | 预期 | 实测 |
|---|---|---|---|
| V1 回退一处迁移（`bg-n-zinc-100 → bg-zinc-100`） | 8 处 | 快照红 | ✅ 红（**快照**一条；守恒律按设计保持绿——同一桶内挪计数） |
| V2 迁到**错档位**（`bg-n-zinc-100 → bg-n-zinc-200`） | 8 处 | 守恒律红 | ✅ 红（0-E2 时未检出，缺口已闭合） |
| V3 **丢掉透明度修饰符**（`dark:bg-n-zinc-800/50 → dark:bg-n-zinc-800`） | 4 处 | 守恒律红 | ✅ 红（0-E2 时未检出） |
| V4 **丢掉 `dark:` 变体**（`dark:bg-n-zinc-800 → bg-n-zinc-800`） | 8 处 | 守恒律红 | ✅ 红（加强后新覆盖） |
| V5 **换工具类**（`bg-n-zinc-100 → text-n-zinc-100`） | 8 处 | 守恒律红 | ✅ 红 |
| V6 **换族**（`bg-n-zinc-100 → bg-n-gray-100`，即"折进 gray"那个诱惑） | 8 处 | 守恒律红 | ✅ 红 |

守卫侧（先破扫描器、再**盲目重刷冻结值**，确认是守卫而非普查在报警）：

| 突变 | 预期 | 实测 |
|---|---|---|
| V7 令牌正则失效（`-n-(` → `-m-(`） | 守卫红 | ✅ 红（`token pattern matched nothing`；且此时的守恒律是**绿**的，正说明守卫不可省） |
| V8 `variants` 一律记空 | 守卫红 | ✅ 红 |
| V9 字面侧透明度不再捕获 | 守卫红 | ✅ 红 |
| V10 令牌侧透明度不再捕获（两个分支都断） | 守卫红 | ✅ 红 |

**反向验证自身的两次打偏（教训）**：V9 / V10 初版各只改了一个分支——V9 改的是字面量分支（令牌分支未动，断言照过），V10 只断 `TOKEN_SCALED`（`TOKEN_EXTREME` 仍在提供带透明度的 `bg-n-black/50`，断言照过）。两次都表现为"守卫没红"，看起来像护栏缺口。**结论：突变探针必须覆盖提供该属性的全部代码路径，否则"未检出"是探针的问题而非护栏的问题**——与 0-E0"先用不存在的类做突变导致假绿"是同一类错误的不同形态。

**验收**：`test:client` **128 文件 / 970 用例**（0-E2 基线 127/968，净增 1 文件 2 用例）；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`build:client`、`test:theme-tokens` 16 项全绿。基线 **未漂移**（1439 不变，本片不改 TSX）。产物：`bg-n-zinc-100` / `bg-n-gray-800` / `bg-n-black\/50` 在 `dist` 中；`.bg-opacity-50` 仍为 0（延续 0-E2 的结论）。**行号偏移不变**（累计 +223，本片未改 `index.css`）。

**顺带发现的遗留（未改，非本片范围）**：`themeHardcodedAtoms.ts` **顶部注释**里引用了 4 个真实类名（`hover:bg-gray-100` / `dark:bg-gray-800` / `prose-pre:bg-gray-900` / `bg-gray-900/50`），会被 content 扫描采进产物——目前这 4 个类各有活消费者，产物里看不出差异；但等最后一个消费者迁移完，注释会让该字面工具类**留在 `dist`**，使阶段 0"字面清零"的产物核对无法达成。修法是把注释里的类名写成通配形式（同 0-E2 的 `bg-opacity-*` 处置），本片不动它。


**行号偏移**：本片未改 `index.css`，偏移不变（累计 **+223**）。

#### 0-E2d 实施记录（2026-09-25）

**范围**：全仓 #1 热点文件 `AskUserQuestionPanel.tsx` 84 → 0。这也是第一片在 0-E2c 新门槛（基线收敛 ＋ 守恒律零漂移，"双绿"）下通过的迁移，因此它的价值一半在文件本身、一半在验证门槛可用。

**文件构成（先量化再动手）**：扫描器给出 **84 处命中 / 42 个不同 token / 25 行**，族只有 **gray 与 white**（无 zinc / slate / neutral / black），透明度修饰符 14 处。变体覆盖 `dark:` / `hover:` / `group-hover:` / `placeholder:` / `dark:hover:` / `dark:group-hover:` / `dark:placeholder:`。全文件**无动态色构造**（无模板串插值、无色名变量），所以是 A1 改名的最纯形态。选它而不是 41 处的 `AccountContent.tsx`，理由：单位收益最大（占剩余量 5.8%），且单一族使"改动=纯前缀插入"可被机械证明。

**手法：脚本化 + 双向守恒的写法约束**

- 替换走一次性脚本，正则**镜像扫描器的 atom 形状**（工具类＋族＋可选档位＋可选透明度修饰符，带前后界）；替换次数必须**等于扫描器报出的命中数**，不等则**拒绝写入**——避免"人手猜什么算颜色类"。
- 改完再证明一次"改动只是插入 `-n-`"：把新文件里所有 `-n-(gray|white|black)` 反向还原成 `-(gray|white|black)`，与改前备份 **`diff` 字节级相同**。这条比逐行读 diff 更强——它排除了"顺手改了点别的"。

**双绿证据**

- **守恒律零漂移且未刷新**：普查总量 **1502 = 1502**，**200 个桶逐桶相等**。这是纯改名的应有结果，也是第一片实证"守恒律不需要跟着迁移片刷新"——它只在新增/删除颜色时才需要动。
- **基线按预期收敛**：`total 1439 → 1355`（**−84**）。刷新前先读漂移清单：`byFile` 只有 `AskUserQuestionPanel.tsx` 一项 `84 → 0`（其余文件无一变化），`byAtom` **22 条全部为减、无一增加**，且每条都能与该文件自己的 42 个 token 逐一对上（如 `bg: gray-50` −4 = 该文件 `bg-gray-50` 1 ＋ `bg-gray-50/50` 1 ＋ `hover:bg-gray-50/60` 2；`text: gray-400` −9 = `text-gray-400` 7 ＋ `dark:text-gray-400` 1 ＋ `placeholder:text-gray-400` 1）。22 条合计 −84，与 `total` 的差一致。

**产物核对**：42 个 token **全部**在 `dist` 中有令牌形态（0 个缺失）；该文件**独占**的 15 个字面类已从 `dist` 消失（`border-gray-200/80`、`dark:bg-gray-800/90`、`dark:bg-gray-900/60`、`dark:border-gray-700/60`、`dark:group-hover:border-gray-600`、`dark:hover:bg-gray-700/40`、`dark:hover:bg-gray-700/60`、`dark:hover:border-gray-600`、`dark:placeholder:text-gray-600`、`dark:ring-gray-700`、`group-hover:border-gray-300`、`hover:bg-gray-50/60`、`hover:border-gray-300`、`placeholder:text-gray-400`、`ring-gray-200`）；仍在 `dist` 里的同名字面类来自**别的文件**（迁移按文件分片，符合预期）。`placeholder:` 与 `dark:placeholder:` 各产出 **2 条**（`::placeholder` ＋ `::-moz-placeholder`）。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`build:client`、`test:theme-tokens` 16 项全绿。**行号偏移不变**（累计 +223，本片未改 `index.css`）。

**工具侧两个坑（记账，避免重犯）**

1. **产物核对不能靠"看着像"的 grep**：CSS 类名本身在产物里是**转义**形态（`dark\:hover\:bg-n-gray-700\/40`），而 BSD grep 的 BRE **不认 `\:`**（实测 `grep '\.b\:c'` 对 `a.b\:c` 返回 0）。本片第一版核对脚本因此把 9 个**确实存在**的令牌类报成"缺失"，差点写成"产物没生成"。正解：按 CSS 规则转义（非 `[A-Za-z0-9_-]` 一律加反斜杠）＋ `grep -oF`，或直接在 Node 里按字符串切分数匹配。
2. **正则字符类的 JS 陷阱**：`/[]/` 在 JS 里是**空字符类**（匹配不到任何字符），不像 POSIX 把开头的 `]` 当字面量。我写的转义类 `/[][\\/:....]/` 因此静默地不做任何转义——**不报错、不命中**，正是"空转"的典型形态。

**顺带发现：扫描器覆盖面缺口（未改，待拍板）**

`COLOUR_UTILITIES` 只做**前缀**匹配 `(util)-(族)`，因此"轴/侧限定"的工具类**扫描器与守恒律都看不见**：`border-t|b|l|r-*`、`border-x|y-*`、`divide-x|y-*`、`ring-offset-*`。实测 **10 处**中性色落在外面：

- `src/shared/ui/Tooltip.tsx` 5 处 `border-t/b/l/r-gray-900 dark:border-t/b/l/r-gray-100`（成对结构，正是 A1 的目标形态）
- `src/modules/chat/transcript/LoadAllMessagesOverlay.tsx:74` 1 处 `border-t-white`
- `src/modules/shell/ShellConnectionOverlay.tsx:41` 1 处 `ring-offset-gray-950`
- `src/modules/shell/ShellHeader.tsx:72/92/104` 3 处 `ring-offset-gray-800`

**后果**：阶段 0 的定量终点（"1502 → 0"）**不覆盖这 10 处**，收工后它们仍是硬编码、不随主题变化——正是 §5.7 警告的那类"主题生效一半"的残留。修法是把这几类形态并入扫描器（`COLOUR_UTILITIES` 需从"前缀"扩为"前缀＋可选轴"，并同步扩 `ATOM` / `usageKey`），代价是阶段 0 的基准量从 **1502 → 1512**、文件数 105 → 108，且需要重新冻结守恒普查（届时已迁移的 62 ＋ 84 处不受影响，因为守恒律按桶记账）。**属独立一片（扫描器覆盖面），本片未动**。

#### 0-E2e 实施记录（2026-09-25）

**范围**：闭合 0-E2d 暴露的**扫描器覆盖面缺口**——把"轴/侧限定"的中性色工具类纳入扫描器与守恒律，并**同一片内清零**新纳入的命中。属"会改变阶段 0 基准量"的变更，已获拍板。

**量化（先量再动，更正 0-E2d 的口径）**：精确命中 **15 个 token / 10 行 / 4 文件**。0-E2d 记的"10 处"是**按行**数的，漏算了 `Tooltip.tsx` 每行各有 light/dark **两个** token：

| 文件 | token | 形态 |
|---|---|---|
| `src/shared/ui/Tooltip.tsx` | 10 | 5 行 ×（`border-t/b/l/r-gray-900` ＋ `dark:border-t/b/l/r-gray-100`），四个箭头各一对 |
| `src/modules/shell/ShellHeader.tsx` | 3 | `focus:ring-offset-gray-800` |
| `src/modules/shell/ShellConnectionOverlay.tsx` | 1 | `focus:ring-offset-gray-950` |
| `src/modules/chat/transcript/LoadAllMessagesOverlay.tsx` | 1 | `border-t-white` |

`outline-offset-*` **零命中**，且 Tailwind 的 `outlineOffset` 只接受宽度、不接受颜色——它本来就不是颜色工具，**不纳入**（纳入会产生永不匹配的死模式）。

**实现**：新增 `UTILITY` 常量作为"工具类半边"的唯一 alternation，`ATOM` / `TOKEN_SCALED` / `TOKEN_EXTREME` **三者共用同一份**。轴形式为 `border(?:-[trblxy])?`、`divide(?:-[xy])?`，`ring-offset` 单列于 `ring` 之前。两个设计约束：

1. **轴组必须是非捕获组**：`ATOM` 的组号（`family` / `step` / `opacity`）是守恒律键的一部分，任何新的捕获组都会静默错位整条链。
2. **三个正则共用一份 `UTILITY`**（而非各写一遍）——这直接消灭了 0-E2c 踩过的"探针只堵一半路径"：不存在"字面侧支持轴、令牌侧不支持"这种半通状态。反向验证 V-D 印证了这一点。

**无需改 `tailwind.config.js` 或 `src/index.css`**：`n-*` 注册在**统一 `colors` 键**下，Tailwind 会让所有颜色工具类（含 `borderColor` 的轴限定、`ringOffsetColor`）继承它，因此现有令牌**已能**承载轴限定形态，本片只扩了"看得见"的部分。

**冻结账（扩面的既定代价）**：守恒普查 **1502 → 1517**（+15 命中 / +11 桶），刷新前漂移清单为 **11 条、全部是 `frozen 0, now N`**，每条都点名来源文件行——即"新纳入的视野"，而非回归。基线快照 `theme-hardcoded-baseline.json` 的 `total` **未刷新**（见下，扩面与迁移精确抵消）。

**双绿证据**

- **基线零刷新即绿**：`total` 仍为 **1355**。这是本片最强的证据——扫描器扩面把基线**推高 15**，同一片内迁移又把它**拉低 15**，两次抵消到**未刷新就相等**。若迁移了 14 处或 16 处（或误迁移了一处非轴限定），基线会在**不刷新**的情况下报 `total: baseline 1355, now 1356` 或反方向的死项——**"零刷新通过"本身就是"恰好 15 处、一处不多不少"的机器证明**。
- **守恒律零漂移**：扩面后刷新一次（1517），迁移后 **1517 = 1517、211 桶逐桶相等、未再刷新**——纯改名不动桶，与 0-E2d 同构。

**反向验证 4 组**（每组先量化确认突变已命中，再评分；全部命中）

| # | 突变 | 守恒律 | 基线 | 判定 |
|---|---|---|---|---|
| V-A | `border-t-n-gray-900` → `-gray-800`（错档位，2 处） | **红** | 绿 | 新纳入的领地**在守恒律视野内** |
| V-B | `border-t-n-gray-900` → `border-n-gray-900`（丢轴限定，2 处） | **红** | 绿 | 轴限定是键的一部分，丢轴即换桶 |
| V-C | `border-t-n-gray-900` → `border-t-gray-900`（回退字面，2 处） | 绿 | **红** | 扩面**未削弱**快照对"回退"的检出（同桶，守恒律按设计不拦） |
| V-D | 扫描器的 `UTILITY` 撤销全部轴支持 | **红** | 绿 | 冻结普查里的 15 个轴命中**无法再被产出**，且反空转守卫同步报红——**证明守卫非空转** |

**反空转守卫补强**：守恒律测试新增第 5 条断言——`[...literals, ...tokens]` 中 `utility` 含 `-` 的命中必须 > 0。这正是本片扩面若"扩了但没生效"（正则写错、常量没接上）时会**立刻变红**的那条；V-D 实测它确实会红。

**产物核对**：11 个迁移后的拼写**全部**在 `dist` 有令牌形态，值链全部到达 `--n-*`——`border-t-n-gray-900` → `border-top-color:hsl(var(--n-gray-900))`；`dark:border-t-n-gray-100` → `hsl(var(--n-gray-100))`；`focus:ring-offset-n-gray-800` → `--tw-ring-offset-color: hsl(var(--n-gray-800))`（**`ring-offset` 走的是 `--tw-ring-offset-color` 变量，不是 `border-color`，本片首次验证该链**）。8 个被迁走的字面拼写（`border-t/b/l/r-gray-900`、`dark:border-t-gray-100`、`border-t-white`、`ring-offset-gray-800/950`）在 `src/` 与 `dist` **双双归零**（这些拼写在本仓**仅此一处**消费者，故可直接核对消失）。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`build:client`、`test:theme-tokens` 16 项全绿。**行号偏移不变**（累计 +223，本片未改 `index.css`）。

**口径变化（记账，需知悉）**：阶段 0 的定量终点从"覆盖 **1502** 处"变为"覆盖 **1517** 处"，但**当前剩余量不变**（1355），因为新纳入的 15 处已在本片清零。换言之：*之前报的 1355 是"扫描器可见的剩余"，真实的硬编码中性色剩余是 1370；本片把盲区纳入视野并立即归零，两者重新对齐到 1355*。

**与既有账的关系**：0-E2b（60）＋ 0-E2（2 隐雷）＋ 0-E2d（84）＋ 本片（15）＝ 阶段 0 至今迁移 **161** 处；守恒普查的冻结总量因此恒等于"剩余 ＋ 豁免 ＋ 已迁移"。

#### 0-E2f 实施记录（2026-09-25）

**范围**：热点榜第二 `src/modules/task-master/modals/TaskDetailModal.tsx` **72 → 0**。0-E2d 之后的最大单片。

**量化（先量再动）**：扫描器给出 **72 处命中 / 22 个不同 token / 28 行**；族只有 **gray 65 / white 6 / black 1**（无 zinc / slate / neutral），工具类只有 `text` / `bg` / `border` 三类，变体只有 `dark:` 与 `hover:`（含 `dark:hover:` 复合），带透明度修饰符 1 处（`bg-black/50`）。**无动态色构造**（无模板串插值、无色名变量），是 A1 改名的纯形态。选它而非 69 处的 `McpServerFormModal.tsx`：纯粹按热度取榜第二，且本片不复用 0-E2e 的覆盖面（该文件无轴限定形态），可作为"扩面片之后、门槛未受影响"的对照。

**手法**：与 0-E2d / 0-E2e 同一套写法约束——替换走脚本、**以扫描器输出为唯一事实源**（命中 72 = 改写 72，不等则拒绝写入）；改完把 `-n-(gray|white|black)` 反向还原，与改前备份 **`diff` 字节级相同**（`/tmp` 备份 → 还原 → `diff -q` 无输出）。

**双绿证据**

- **守恒律零漂移且未刷新**：普查 **1517 = 1517、211 桶逐桶相等**。纯改名不动桶。
- **基线按预期收敛**：`total **1355 → 1283**（**−72**）`，`byFile` 只有该文件 `72 → 0`；`byAtom` **19 条全部为减、无一增加**。22 个 token 因**变体不计入原子键**（`byAtom` 的键是 `工具类: 族-档`，不含 `dark:`/`hover:`）而折叠成 19 个原子，每条都能逐一配对：

  | 原子 | Δ | 来源 token |
  |---|---|---|
  | `bg: gray-800` | −9 | `dark:bg-gray-800` 4 ＋ `dark:hover:bg-gray-800` 5 |
  | `text: gray-300` | −10 | `dark:text-gray-300` 10 |
  | `text: gray-700` | −9 | `text-gray-700` 9 |
  | `border: gray-200` / `border: gray-700` | 各 −6 | `border-gray-200` 6 / `dark:border-gray-700` 6 |
  | …（其余 15 条同理） | | 19 条合计 **−72**，与 `total` 差一致 |

**产物核对**：22 个 token **全部**在 `dist` 有令牌形态；值链到达 `--n-*`，**透明度保留**——`bg-n-black/50` → `background-color:hsl(var(--n-black) / .5)`（本片唯一的修饰符，是 A1"改名不丢 alpha"的实测点）。**与 0-E2d 的差异（记账）**：该文件的 22 个字面拼写在**别的文件里仍有消费者**（`src_left` 实测 8~100 不等），因此**不能**用"字面类从 `dist` 消失"作为证据——那里残留的是别人的用量。本片的证据落在**令牌形态全产出 ＋ 守恒律零漂移 ＋ 基线 19 条全减**。核对脚本据此写成"token 必须产出；字面类若在 `src/` 已无消费者则 `dist` 必须为 0，否则允许存在"，避免把"别人还在用"误判成泄漏。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`build:client`、`test:theme-tokens` 16 项全绿。**行号偏移不变**（累计 +223，本片未改 `index.css`，也未改 `tailwind.config.js`）。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ **72** ＝ **233** 处。

#### 0-E2g：`McpServerFormModal.tsx` 69 → 0（热点榜第三，已实施）

**范围**：`src/modules/mcp/McpServerFormModal.tsx`。**69 处 / 16 个 token / 17 行**——族 `gray` 64 ＋ `white` 3 ＋ `black` 2；工具类只有 `bg` 30 ／ `text` 23 ／ `border` 16；变体只有 `dark:` / `hover:`（含 `dark:hover:` 3 处）；带透明度 **3 处**（`bg-black/50` ×2 为遮罩、`dark:bg-gray-900/50` ×1）。**无动态色构造、无轴限定形态、无 stone/zinc/slate/neutral**——标准 A1 形态。位于密度极高的 `mcp` 模块，17 行承载 69 处（平均每行 4 处），是全仓最"密"的一片。

**手法**：沿用既定约束——替换脚本以扫描器输出为唯一事实源（**69 = 69**，不等则拒写），改完把新文件的 `-n-(gray|zinc|slate|neutral|stone|black|white)` 反向还原，与改前备份 **`diff` 字节级相同**，证明"只是插入了 `-n-`"。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新**（纯改名；也再次实证守恒律只在增删颜色时才需刷新） |
| **基线** | **1283 → 1214（−69）**，文件数 **102 → 101**（`byFile` 该文件 `69 → 0` 是唯一文件级 delta）；`byAtom` **16 条全为减、无一增**，每条与 16 个 token 逐一对上（例：`bg: gray-800` −10 = `dark:bg-gray-800` 10；`text: white` −3 = `text-white` 3；`bg: black` −2 = `bg-black/50` 2，原子键不含透明度故与透明拼写合桶），合计恰 **−69** |

**产物核对（本片把核对精度又提高一格）**：16 个 token **全部**在 `dist` 有令牌形态；值链到达 `--n-*`，**透明度保留**——`bg-n-black/50` → `hsl(var(--n-black) / .5)`、`dark:bg-n-gray-900/50` → `hsl(var(--n-gray-900) / .5)`。沿用 0-E2f 的**条件式**判法：本片 16 个字面拼写在 `src/` 中**仍各有消费者**（实测 10~63 处），故**允许**留在 `dist`（`src_left > 0 ⟺ dist > 0` 双向成立即通过）。同文件的非中性色（`ring-blue-500` 7 ／ `border-blue-500` 7 ／ `bg-blue-600` 3 ／ `text/-border-red-500` 各 1）**未被触碰**。

**核对脚本自身的两处修正（记账）**：
1. **前缀误计**：初版用"裸子串出现次数"判产物，`dark:bg-gray-80` 这种不存在的拼写会被 `…-800` 前缀喂出虚高计数（实测虚报 9），使"令牌已产出"这条证据变软。现改为**两侧都类精确**——`src` 侧按 Tailwind 候选边界 `TOKEN` 正则整词相等，`dist` 侧按选择器边界（后随 `{` 或 `:`，且不得是 `\`／`/`／`-`／字母数字）。
2. **非空转探针**：给脚本故意混入 `dark:bg-gray-80` / `text-fuchsia-999` 两个假拼写，确认它**报 FAILED**（前者走双向守卫、后者走"token 必须产出"守卫），证明两条断言都有活性。**同一探针也暴露了本片证据的一个覆盖缺口**：16 个字面拼写**没有一个是本文件独占**，于是双向守卫只被实测了 `>0 → dist>0` 一半，`0 → dist 为 0` 那一半本片无真实样本（0-E2d 曾以 `AskUserQuestionPanel.tsx` 的独占拼写覆盖过）。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`build:client`、`test:theme-tokens` 16 项全绿。未改 `index.css` / `tailwind.config.js`（**累计行号偏移仍为 +223**）。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ **69** ＝ **302** 处；剩余 **1214 处 / 101 文件**，余下最大单片 `TaskBoardToolbar.tsx` 60。

#### 0-E2h：`TaskBoardToolbar.tsx` 60 → 0（热点榜第四，已实施）

**范围**：`src/modules/task-master/TaskBoardToolbar.tsx`。**60 处 / 22 个 token / 17 行**——族 `gray` 47 ＋ `white` 13（**无 black**）；工具类 `text` 30 ／ `bg` 20 ／ `border` 10；变体 `dark:` / `hover:`（含 `dark:hover:` 6 处）；**带透明度 0 处**，是首批"零修饰符"的片。**无动态色构造、无其他中性族**；同文件的品牌色（`purple-*` 11 ／ `blue-*` 10）**未触碰**。

**手法**：与 0-E2g 相同（脚本以扫描器为唯一事实源，**60 = 60**，不等则拒写；反向还原后与备份 `diff` 字节级相同）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **1214 → 1154（−60）**，文件数 **101 → 100**；`byAtom` **16 条全为减、无一增**（22 个 token 折叠成语义原子后 16 条），每条可配对（例：`text: gray-400` −5 = `dark:text-gray-400` 4 ＋ `text-gray-400` 1；`text: white` −7 = `text-white` 3 ＋ `dark:text-white` 4；`bg: gray-700` −6 = `dark:bg-gray-700` 3 ＋ `dark:hover:bg-gray-700` 3），合计恰 **−60** |

**产物核对（脚本升级为"派生式"）**：本片把核对脚本改成**通用件**——迁移前拼写不再手抄，而是**从迁移后文件自己的 `n-*` token 反向去掉 `-n-` 派生**，所以"迁移漏了一个 token"不可能悄悄退出核对范围；且把"反向还原 ≡ 备份"的纯前缀插入证明内联进同一脚本。结果：纯插入 **YES**；22 个 token **全部**在 `dist` 有令牌形态；22 个字面拼写在 `src/` 中**仍各有消费者**（实测 2~96 处），故按条件式断言**允许**留在 `dist`（`src_left > 0 ⟺ dist > 0` 双向成立）。本片无带透明度 token，值链检查为空转，已如实标注而非默认通过。

**核对脚本自身的一处修正（记账）**：初版"纯前缀插入"判据报 **NO**——根因是我在 `untokenise` 正则里加了 `(?=[-/]|$)` 尾部守卫，而 **JS 正则的 `$` 是"输入末尾"而非"行尾"**，于是行中 `text-n-white` 后跟空格时无法还原，与备份产生大片差异。**迁移本身无问题**（早先的 sed 反向 `diff` 是 IDENTICAL），是探针过严造成的**假失败**——与 0-E2g 的"裸子串过松造成假通过"恰好是一对镜像。去掉 lookahead 后 YES。已用 `text-fuchsia-999` / `dark:bg-gray-80` 假拼写做非空转探针，确认脚本能报 **FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`build:client`、`test:theme-tokens` 16 项全绿。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ **60** ＝ **362** 处；剩余 **1154 处 / 100 文件**，余下最大单片 `VersionUpgradeModal.tsx` 55。

#### 0-E2i：`VersionUpgradeModal.tsx` 55 → 0（热点榜第五，已实施）

**范围**：`src/modules/version-upgrade/VersionUpgradeModal.tsx`。**55 处 / 31 个 token / 21 行**——族 `gray` 46 ＋ `white` 8 ＋ `black` 1；工具类 `text` 28 ／ `bg` 21 ／ `border` 6；变体 `dark:` / `hover:`（含 `dark:hover:` 4 处）；带透明度 **3 处**。**31 个 token 是至今单片最多**（此前最多 22），档位也最杂——同片出现 `gray-50/100/200/300/400/500/600/700/800/900/950` 共 **11 个档位**，其中 `dark:bg-gray-950`、`text-gray-800`、`dark:text-gray-200`、`hover:text-gray-600`、`dark:hover:bg-gray-600` 五个拼写在全仓都属少见。**无动态色构造、无其他中性族、无轴限定形态**；同文件品牌/状态色（`blue-*` 23 ／ `red-*` 6 ／ `green-*` 1）与备份 **逐项 diff 相同**。

**前置检查（本片新增一步，但经核对属"快检"而非"补洞"）**：迁移前先点名确认这 11 个档位在 `src/index.css` 里**同时**有 L1 `--palette-gray-<step>` 与 L2 `--n-gray-<step>` 声明（含 `n-white` / `n-black`）——本片是首个用到 `gray-950` 与 `gray-800` 等少见档位的片，先确认没有任何新令牌要建（结论：11 个档位 L1／L2 双声明齐全，无需改 `index.css`）。

这类"档位没建令牌"的失败**在护栏视野内**：`neutralScale.test.ts` 已断言每个 `--n-<family>-<step>` 等于 `var(--palette-<family>-<step>)`、令牌恰好声明一次，`tests/theme-tokens` 的浏览器基线又断言每个 `--n-*` 在明暗两种外观下都能解析。**记录时的自我更正**：本节初稿写的是"L2 缺失时类存在、产物存在、护栏全绿，是结构上抓不到的失败"——**该说法未经验证且不成立**，读一遍 `neutralScale.test.ts` 即可否证。故前置检查的定位是"迁移前的一次快速点名"，不是"护栏缺口"。

**手法**：与 0-E2g／0-E2h 相同（扫描器为唯一事实源，**55 = 55**，不等则拒写）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **1154 → 1099（−55）**，文件数 **100 → 99**；`byAtom` **23 条全为减、无一增**，每条与 31 个 token 逐一对上（例：`bg: gray-700` −5 = `dark:bg-gray-700` 2 ＋ `dark:bg-gray-700/50` 2 ＋ `dark:hover:bg-gray-700` 1；`text: gray-300` −5 = `dark:text-gray-300` 4 ＋ `dark:hover:text-gray-300` 1；`bg: gray-950` −1 = `dark:bg-gray-950` 1），合计恰 **−55** |

**产物核对（通用脚本首次遇到"独占拼写"，补上了两片前记在案的覆盖缺口）**：纯前缀插入 **YES**；31 个 token **全部**产出；**带透明度 3 处首次拿到真实值链样本**——`bg-n-black/50` → `hsl(var(--n-black) / .5)`、`dark:bg-n-gray-700/50` → `hsl(var(--n-gray-700) / .5)`（0-E2h 该检查迭代零次，属真空转）。更关键的是：本片**首次出现两个独占拼写**——`border-white` 与 `dark:bg-gray-700/50` 在 `src/` 已无任何消费者，核对里 `src = 0 且 dist = 0`，于是条件式断言 **`0 → dist 为 0`** 这一半方向**首次被真实数据实测**（0-E2g／0-E2h 两片都因"每个拼写都有别的消费者"而无样本，已在各自记录中标注为覆盖缺口）。非空转探针（注入 `text-fuchsia-999`）如预期报 **FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`build:client`、`test:theme-tokens` 16 项全绿。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ **55** ＝ **417** 处；剩余 **1099 处 / 99 文件**，余下最大单片 `CodeEditorHeader.tsx` 52。

#### 0-E2j：`CodeEditorHeader.tsx` 52 → 0（热点榜第六，已实施）

**范围**：`src/modules/code-editor/CodeEditorHeader.tsx`。**52 处 / 13 个 token / 10 行**——族 `gray` 44 ＋ `white` 8（**无 black**）；工具类 `text` 36 ／ `bg` 16（**无 border**）；变体 `dark:` 系 26 ／ `hover:` 系 16 ／ 裸用 10；**带透明度 0 处**。**无动态色构造、无其他中性族、无轴限定形态**——标准 A1 形态；同文件品牌/状态色（`blue-*` 7 ／ `green-*` 3，含 `dark:bg-blue-900/30`、`dark:bg-green-900/30` 等带透明度拼写）**未被触碰**。

**前置检查（沿用 0-E2i 的一次点名）**：迁移前确认本片用到的 9 个档位（`gray-100/200/400/500/600/700/800/900` ＋ `white`）在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**（`index.css:52,92-100,249-259`），无需新建令牌。

**手法**：与 0-E2g／0-E2h／0-E2i 相同（扫描器为唯一事实源，**52 = 52**，不等则拒写；反向还原后与备份 `diff` 字节级相同）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **1099 → 1047（−52）**，文件数 **99 → 98**；`byFile` 该文件 `52 → 0` 是唯一文件级 delta；`byAtom` **9 条全为减、无一增**，每条与 13 个 token 折叠后逐一对上（`bg: gray-100` −8 = `hover:bg-gray-100` 8；`bg: gray-800` −8 = `dark:hover:bg-gray-800` 8；`text: gray-200` −1 = `dark:hover:text-gray-200` 1；`text: gray-400` −9 = `dark:text-gray-400` 8 ＋ `text-gray-400` 1；`text: gray-500` −2 = `dark:text-gray-500` 1 ＋ `text-gray-500` 1；`text: gray-600` −7 = `text-gray-600` 7；`text: gray-700` −1 = `hover:text-gray-700` 1；`text: gray-900` −8 = `hover:text-gray-900` 7 ＋ `text-gray-900` 1；`text: white` −8 = `dark:hover:text-white` 7 ＋ `dark:text-white` 1），合计恰 **−52** |

**产物核对（通用脚本第 4 次复用，本片无新形态）**：纯前缀插入 **YES**；13 个 token **全部**在 `dist` 有令牌形态；13 个字面拼写在 `src/` 中**仍各有消费者**（实测 1~86 处），故按条件式断言**允许**留在 `dist`（`src_left > 0 ⟺ dist > 0` 双向成立）。两点如实记账：① 本片**无独占拼写**，`0 → dist 为 0` 那一半方向仍无新样本（0-E2i 已以真实数据实测过该方向）；② 本片**无带透明度 token**，值链检查迭代零次，属**真空转**而非通过。非空转探针（注入 `dark:bg-gray-80` / `text-fuchsia-999`）如预期报 **FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`build:client`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ **52** ＝ **469** 处；剩余 **1047 处 / 98 文件**，余下最大单片 `FolderBrowserModal.tsx` 46。

#### 0-E2k：`FolderBrowserModal.tsx` 46 → 0（热点榜第七，已实施）

**范围**：`src/modules/project-creation-wizard/FolderBrowserModal.tsx`。**46 处 / 19 个 token / 19 行**——族 `gray` 41 ＋ `white` 4 ＋ **`black` 1**；工具类 `text` 23 ／ `bg` 15 ／ `border` 8；变体 `dark:` 系 20 ／ `hover:` 系 11 ／ 裸用 15。**带透明度 2 处**：`bg-black/50`（模态遮罩）与 `dark:bg-gray-900/50`。**无动态色构造、无其他中性族、无轴限定形态**。同文件品牌/状态色（`blue-*` 等）未触碰。

**前置检查（沿用既定一次点名）**：迁移前确认本片用到的 12 个档位（`gray-50/100/200/300/400/500/600/700/800/900` ＋ `white` ＋ `black`）在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**（共 24 条声明），无需新建令牌。

**手法**：与 0-E2g…0-E2j 相同（扫描器为唯一事实源，**46 = 46**，不等则拒写；反向还原后与备份 `diff` 字节级相同）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **1047 → 1001（−46）**，文件数 **98 → 97**；`byFile` 该文件 `46 → 0` 是唯一文件级 delta；`byAtom` **16 条全为减、无一增**，每条与 19 个 token 折叠后逐一对上（`bg: black` −1 = `bg-black/50` 1；`bg: gray-900` −1 = `dark:bg-gray-900/50` 1；`bg: gray-700` −5 = `dark:hover:bg-gray-700` 5；`border: gray-200` −4 = `border-gray-200` 4；`border: gray-700` −4 = `dark:border-gray-700` 4；`text: gray-300` −4 = `dark:hover:text-gray-300` 3 ＋ `dark:text-gray-300` 1；`text: gray-400` −7 = `text-gray-400` 5 ＋ `dark:text-gray-400` 2；`text: gray-600` −4 = `hover:text-gray-600` 3 ＋ `text-gray-600` 1；其余 8 条各 −1），合计恰 **−46** |

**产物核对（通用脚本第 5 次复用）**：纯前缀插入 **YES**；19 个 token **全部**在 `dist` 有令牌形态；19 个字面拼写在 `src/` 中**仍各有消费者**（实测 1~84 处），条件式断言 `src_left > 0 ⟺ dist > 0` 双向成立。**带透明度 2 处再次拿到真实值链样本**：`bg-n-black/50` → `hsl(var(--n-black) / .5)`、`dark:bg-n-gray-900/50` → `hsl(var(--n-gray-900) / .5)`（0-E2h 该检查曾迭代零次）。本片仍无独占拼写，`0 → dist 为 0` 方向无新样本（0-E2i 已实测）。非空转探针（注入 `dark:bg-gray-80` / `text-fuchsia-999`）如预期报 **FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`build:client`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ **46** ＝ **515** 处；剩余 **1001 处 / 97 文件**，余下最大单片 `TaskEmptyState.tsx` 46。

#### 0-E2l：`TaskEmptyState.tsx` 46 → 0（热点榜第八，已实施）

**范围**：`src/modules/task-master/TaskEmptyState.tsx`。**46 处 / 16 个 token / 22 行**——族 `gray` 34 ＋ `white` 12（**无 `black`、无其他中性族**）；工具类 `text` 32 ／ `bg` 12 ／ `border` 2；变体 `dark:` 系 22 ／ `hover:` 系 1 ／ 裸用 23。**带透明度 4 处**：全部为同一 token `dark:bg-gray-800/60`——九片里首个透明度**不分散**的片。**无动态色构造、无轴限定形态**。同文件品牌/状态色未触碰。

**前置检查（沿用既定一次点名）**：迁移前确认本片用到的 10 个档位（`gray-100/200/300/400/500/600/700/800/900` ＋ `white`）在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**（共 20 条声明），无需新建令牌。

**手法**：与 0-E2g…0-E2k 相同（扫描器为唯一事实源，**46 = 46**，不等则拒写；反向还原后与备份 `diff` 字节级相同）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **1001 → 955（−46）**，文件数 **97 → 96**；`byFile` 该文件 `46 → 0` 是唯一文件级 delta；`byAtom` **15 条全为减、无一增**，合计恰 **−46**（`text: gray-400` −8 = `dark:text-gray-400` 8；`text: white` −8 = `dark:text-white` 6 ＋ `text-white` 2；`bg: gray-800` −4 = `dark:bg-gray-800/60` 4；`bg: white` −4 = `bg-white` 4；`text: gray-900` −6、`text: gray-600` −6 各 = 同名字面 6；`text: gray-500` −2 = `text-gray-500` 2；`bg: gray-100`／`bg: gray-200`／`bg: gray-600`／`bg: gray-700`／`border: gray-200`／`border: gray-700`／`text: gray-300`／`text: gray-700` 各 −1） |

**产物核对（通用脚本第 6 次复用）**：纯前缀插入 **YES**；16 个 token **全部**在 `dist` 有令牌形态；16 个字面拼写在 `src/` 中**仍各有消费者**（实测 2~76 处），条件式断言 `src_left > 0 ⟺ dist > 0` 双向成立。**带透明度 4 处再次拿到真实值链样本**：`dark:bg-n-gray-800/60` → `hsl(var(--n-gray-800) / .6)`。本片仍无独占拼写，`0 → dist 为 0` 方向无新样本（0-E2i 已实测）。非空转探针（注入 `dark:bg-gray-80` / `text-fuchsia-999`）如预期报 **FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`build:client`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ **46** ＝ **561** 处；剩余 **955 处 / 96 文件**，余下最大单片 `AccountContent.tsx` 41。

#### 0-E2m：`AccountContent.tsx` 41 → 0（热点榜第九，已实施）

**范围**：`src/modules/settings/tabs/agents-settings/sections/content/AccountContent.tsx`。**41 处 / 40 个 token / 16 行**——**首个跨四族混合片**：`gray` 16 ＋ `zinc` 13 ＋ `neutral` 11 ＋ `white` 1；工具类 `bg` 20 ／ `text` 15 ／ `border` 6；变体形态至今最多——裸用 17 ／ 仅 `dark:` 15 ／ 仅 `hover:` 3 ／ 仅 `active:` 3 ／ `dark:hover:` 2 ／ `dark:active:` 1。**带透明度 2 处**：`dark:bg-zinc-900/20`、`dark:bg-neutral-900/20`——**透明度样本首次覆盖非 gray 族**（历片均为 gray / black）。**首现 950 档**：`active:bg-gray-950`、`active:bg-zinc-950`。**无动态色构造、无轴限定形态**。同文件品牌/状态色未触碰。

**前置检查（沿用既定一次点名）**：迁移前逐一确认本片用到的 **24 个档位**在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**（gray 100/300/500/600/700/800/900/950 ＋ zinc 50/100/200/300/600/700/800/900/950 ＋ neutral 50/100/300/700/800/900 ＋ white，共 48 条声明），并确认 `tailwind.config.js` 的 `n-gray` / `n-zinc` / `n-slate` / `n-neutral` 四组键均含 50 与 950 两端，无需新建令牌。

**手法**：与 0-E2g…0-E2l 相同（扫描器为唯一事实源，**41 = 41**，不等则拒写；反向还原后与备份 `diff` 字节级相同）。本片 token 含前缀包含关系（`bg-gray-800` ⊂ `dark:bg-gray-800`、`bg-zinc-900` ⊂ `dark:bg-zinc-900/20`），脚本按**长度降序**替换，长者先落地后短者不再命中，逐条对照确认未串味。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新**——首次在**四族同片**上验证折叠后拼写仍逐桶守恒 |
| **基线** | **955 → 914（−41）**，文件数 **96 → 95**；`byFile` 该文件 `41 → 0` 是唯一文件级 delta；`byAtom` **36 条全为减、无一增**，合计恰 **−41**（`bg: zinc-900` −2 = `bg-zinc-900` 1 ＋ `dark:bg-zinc-900/20` 1；`bg: neutral-900` −2 = `dark:bg-neutral-900/20` 1 ＋ `active:bg-neutral-900` 1；`bg: gray-800` −2 = `bg-gray-800` 1 ＋ `dark:bg-gray-800` 1；`text: gray-300` −2 = `dark:text-gray-300` 2；其余 32 条各 −1，逐条与 token 对上） |

**产物核对（通用脚本第 7 次复用）**：纯前缀插入 **YES**；40 个 token **全部**在 `dist` 有令牌形态；**首次批量拿到独占拼写样本 —— 27 个 token 的字面在 `src/` 与 `dist` 双双归零、其令牌形态在 `dist` 存在**（0-E2i 仅 1 个；这是"本片清掉了仓内最后一处该字面"的实证）。条件式断言 `src_left > 0 ⟺ dist > 0` 双向成立。**带透明度 2 处值链**：`dark:bg-n-zinc-900/20` → `hsl(var(--n-zinc-900) / .2)`、`dark:bg-n-neutral-900/20` → `hsl(var(--n-neutral-900) / .2)`。非空转探针（注入 `dark:bg-gray-80` / `text-fuchsia-999`）如预期报 **FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`build:client`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ **41** ＝ **602** 处；剩余 **914 处 / 95 文件**，余下最大单片 `toolConfigs.ts` 38。

#### 0-E2n：`toolConfigs.ts` 38 → 0（热点榜第十，已实施）

**范围**：`src/modules/chat/tools/configs/toolConfigs.ts`。**38 处 / 9 个 token / 20 行**——**首个类名映射表片**：这是 `.ts` 配置而非 TSX，38 处全部是**类名字符串字面量**，按 `primary` / `secondary` / `border` / `icon` 四类槽位重复出现。族**纯 `gray`**（38，零 `white` / `black`）；工具类 `text` 32 ／ `border` 6、**零 `bg`**；**零透明度**。token 同质度至今最高：**9 个 token 覆盖 38 处**，单 token 最多 8 处（`text-gray-700` / `dark:text-gray-300`）。**无动态色构造、无轴限定形态**。同文件彩色（各工具品牌色）未被计入也未被触碰。

**前置检查（沿用既定一次点名）**：迁移前确认本片用到的 5 个档位（`gray-300/400/500/600/700`）在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**（共 10 条声明），无需新建令牌。

**手法**：与 0-E2g…0-E2m 相同（扫描器为唯一事实源，**38 = 38**，不等则拒写；反向还原后与备份 `diff` 字节级相同）。token 含前缀包含关系（`text-gray-400` ⊂ `dark:text-gray-400`），按长度降序替换后短者不再命中，逐条对照确认未串味。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **914 → 876（−38）**，文件数 **95 → 94**；`byFile` 该文件 `38 → 0` 是唯一文件级 delta；`byAtom` **8 条全为减、无一增**，合计恰 **−38**（`text: gray-400` −9 = `dark:text-gray-400` 7 ＋ `text-gray-400` 2；`text: gray-300` −8 = `dark:text-gray-300` 8；`text: gray-700` −8 = `text-gray-700` 8；`text: gray-500` −7 = `text-gray-500` 7；`border: gray-400` −2 = `border-gray-400` 2；`border: gray-500` −2 = `dark:border-gray-500` 2；`border: gray-300` −1 = `border-gray-300` 1；`border: gray-600` −1 = `dark:border-gray-600` 1） |

**产物核对（通用脚本第 8 次复用）**：纯前缀插入 **YES**；9 个 token **全部**在 `dist` 有令牌形态——**这同时证明 `.ts` 配置里的类名字符串确实被 Tailwind 的 content 扫描覆盖**（`src/**/*.{ts,tsx}`），不是"只写在 TS 里没进 CSS"的死字符串；9 个字面拼写中 8 个在 `src/` 仍各有消费者、1 个（`dark:border-gray-500`）**独占拼写**（src 0 / dist 0，令牌形态 dist 存在）。条件式断言 `src_left > 0 ⟺ dist > 0` 双向成立。本片**无带透明度 token**，"值链"检查属真空转（与 0-E2h 同类）。非空转探针（注入 `dark:bg-gray-80` / `text-fuchsia-999`）如预期报 **FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`build:client`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ **38** ＝ **640** 处；剩余 **876 处 / 94 文件**，余下最大单片 `QuestionAnswerContent.tsx` 35（该文件另有 1 处豁免 `border-gray-150`，不在基线口径内）。

#### 0-E2o：`QuestionAnswerContent.tsx` 35 → 0（热点榜第十一，已实施）

**范围**：`src/modules/chat/tools/ContentRenderers/QuestionAnswerContent.tsx`。扫描器原始命中 **36** 处，其中 **1 处是唯一豁免** `border-gray-150`（见下"阻断点"），**实际迁移 35 处 / 21 个 token**。族 `gray` 33 ＋ `white` 2；工具类 `text` 22 ／ `bg` 8 ／ `border` 5；**带透明度 5 处——历片最多**（`bg-gray-50/50`、`dark:bg-gray-800/30`、`dark:hover:bg-gray-800/50`、`dark:border-gray-700/50`、`dark:border-gray-700/40`）。档位跨度含 `gray-50` 与 `gray-100` 低端。**无动态色构造、无轴限定形态**。

**阻断点与处置（本片独有）**：`border-gray-150` 的豁免理由是 **Tailwind 无 `gray-150` 档，该类根本不生成 CSS**——"没有颜色可令牌化，边框压根不渲染"，迁移它只会把"不渲染"伪装成"已令牌化"，且 `--n-gray-150` 并不存在、产物核对必然报红。此前 22 片都没有豁免文件，`migrate-slice.ts` 直接吃扫描器原始输出即可；本片首次给脚本**加入豁免过滤**（按 `file + token` 跳过 `NEUTRAL_EXEMPTIONS`），并新增 `exempt` 计数行以便复核。迁移后实测 `border-gray-150` 原样留在第 62 行、同一行的 `bg-gray-50/50` 等已正常迁移。

**前置检查（沿用既定一次点名）**：迁移前确认本片用到的 10 个档位（`gray-50/100/300/400/500/600/700/800/900` ＋ `white`）在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**（共 20 条声明），无需新建令牌。

**手法**：扫描器为唯一事实源（`scanner hits: 36  exempt: 1  migratable: 35  rewrites: 35`，不等则拒写）；反向还原后与备份 `diff` 字节级相同。token 含前缀包含关系（`dark:bg-gray-800` ⊂ `dark:bg-gray-800/30`），按长度降序替换后逐条对照确认未串味。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新**（豁免项不参与折叠，未造成漂移） |
| **基线** | **876 → 841（−35，而非 −36 —— 豁免项不计入基线口径）**，文件数 **94 → 93**；`byFile` 该文件 `35 → 0` 是唯一文件级 delta；`byAtom` **15 条全为减、无一增**，合计恰 **−35**（`text: gray-400` −8 = `text-gray-400` 7 ＋ `dark:text-gray-400` 1；`text: gray-500` −6 = `dark:text-gray-500` 6；`bg: gray-800` −3 = `dark:bg-gray-800` 1 ＋ `dark:bg-gray-800/30` 1 ＋ `dark:hover:bg-gray-800/50` 1；`bg: gray-50` −2 = `hover:bg-gray-50` 1 ＋ `bg-gray-50/50` 1；`border: gray-700` −2 = `dark:border-gray-700/50` 1 ＋ `dark:border-gray-700/40` 1；`text: gray-100` −2 = `dark:text-gray-100` 2；`text: gray-600` −2 = `text-gray-600` 1 ＋ `dark:text-gray-600` 1；`text: white` −2 = `text-white` 2；`text: gray-900` −2 = `text-gray-900` 2；其余 6 条各 −1，其中 **`border: gray-100` 归零**） |

**产物核对（通用脚本第 9 次复用）**：纯前缀插入 **YES**；21 个 token **全部**在 `dist` 有令牌形态；**5 个独占拼写**（`bg-gray-50/50`、`border-gray-100`、`dark:bg-gray-800/30`、`dark:border-gray-700/40`、`dark:hover:bg-gray-800/50`）。**带透明度 5 处值链全部实测**，首次覆盖 **`dark:hover:` 复合变体**：`dark:hover:bg-n-gray-800/50` → `.dark\:hover\:bg-n-gray-800\/50:hover:is(.dark *){background-color:hsl(var(--n-gray-800) / .5)}`（其余 4 条为 `.5 / .3 / .5 / .4`）。非空转探针（注入 `dark:bg-gray-80` / `text-fuchsia-999`）如预期报 **FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`build:client`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ **35** ＝ **675** 处；剩余 **841 处 / 93 文件**，余下最大单片 `NextTaskBanner.tsx` 33。

#### 0-E2p：`NextTaskBanner.tsx` 33 → 0（热点榜第十二，已实施）

**范围**：`src/modules/task-master/NextTaskBanner.tsx`。**33 处 / 22 个 token / 13 行**——**首个 `slate` 主导的片**：`slate` 20 ＋ `gray` 8 ＋ `white` 5（此前非 gray 族只在 0-E2b 作为少数出现，0-E2m 是四族均分）；工具类 `text` 19 ／ `bg` 8 ／ `border` 6；**带透明度 1 处**（`dark:bg-slate-900/30`）。**无动态色构造、无轴限定形态**。同文件品牌/状态色未触碰。

**前置检查（沿用既定一次点名）**：迁移前确认本片用到的 16 个档位（`gray-100/400/500/600/800/900` ＋ `slate-50/100/200/300/400/600/700/800/900` ＋ `white`）在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**（共 32 条声明），无需新建令牌。

**手法**：与 0-E2g…0-E2o 相同（扫描器为唯一事实源，`scanner hits: 33  exempt: 0  migratable: 33  rewrites: 33`；反向还原后与备份 `diff` 字节级相同）。token 含前缀包含关系（`text-white` ⊂ `dark:text-white`、`text-gray-400` ⊂ `dark:text-gray-400`），按长度降序替换后逐条对照确认未串味。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新**——首次在 **`slate` 主导**的片上验证折叠守恒 |
| **基线** | **841 → 808（−33）**，文件数 **93 → 92**；`byFile` 该文件 `33 → 0` 是唯一文件级 delta；`byAtom` **20 条全为减、无一增**，合计恰 **−33**（`text: white` −5 = `text-white` 3 ＋ `dark:text-white` 2；`text: slate-600` −3 = `text-slate-600` 3；`bg: slate-100` −2 = `hover:bg-slate-100` 2；`bg: slate-800` −2 = `dark:hover:bg-slate-800` 2；`border: slate-300` −2 = `border-slate-300` 2；`border: slate-600` −2 = `dark:border-slate-600` 2；`text: slate-300` −2 = `dark:text-slate-300` 2；`text: gray-400` −2、`text: gray-900` −2 各 = 同名字面；其余 12 条各 −1。**`border: slate-300`、`border: slate-600`、`text: slate-600` 三条归零**） |

**产物核对（通用脚本第 10 次复用）**：纯前缀插入 **YES**；22 个 token **全部**在 `dist` 有令牌形态——**首次实测 `slate` 族的完整令牌链**：`dark:bg-n-slate-900/30` → `hsl(var(--n-slate-900) / .3)`（此前 slate 只作为 0-E2b/0-E2m 的少数族出现，未单独验证过值链）。**5 个独占拼写**（`border-slate-300`、`dark:border-slate-600`、`dark:hover:bg-slate-800`、`hover:bg-slate-100`、`text-slate-600`）。条件式断言 `src_left > 0 ⟺ dist > 0` 双向成立。非空转探针（注入 `dark:bg-gray-80` / `text-fuchsia-999`）如预期报 **FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`build:client`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ 35 ＋ **33** ＝ **708** 处；剩余 **808 处 / 92 文件**，余下最大单片 `TaskMasterSetupModal.tsx` 32。

#### 0-E2q：`TaskMasterSetupModal.tsx` 32 → 0（热点榜第十三，已实施）

**范围**：`src/modules/task-master/modals/TaskMasterSetupModal.tsx`。**32 处 / 26 个 token / 11 行**——族 `gray` 26 ＋ `white` 4 ＋ `black` 2；**三工具最均衡的一片**：`bg` 12 ／ `border` 8 ／ `text` 12（此前各片都明显偏 `text`）；**带透明度 2 处**：模态遮罩 `bg-black/50` 与卡面 `dark:bg-gray-800/50`；变体含 `hover:` / `dark:hover:` 双层。**无动态色构造、无轴限定形态**。同文件品牌/状态色未触碰。

**前置检查（沿用既定一次点名）**：迁移前确认本片用到的 11 个档位（`gray-50/200/300/400/500/600/700/800/900` ＋ `white` ＋ `black`）在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**（共 22 条声明），无需新建令牌。

**手法**：与 0-E2g…0-E2p 相同（扫描器为唯一事实源，`scanner hits: 32  exempt: 0  migratable: 32  rewrites: 32`；反向还原后与备份 `diff` 字节级相同）。本片含两处前缀包含关系——`bg-black/50` ⊂ `bg-black`、`text-gray-400` ⊂ `dark:text-gray-400`——按**长度降序**替换，长者先落地后短者不再命中，迁移后对照 `bg-black/50` 与裸 `bg-black` 各自独立确认未串味。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **808 → 776（−32）**，文件数 **92 → 91**；`byFile` 该文件 `32 → 0` 是唯一文件级 delta；`byAtom` **19 条全为减、无一增**，合计恰 **−32**（`bg: black` −2 = `bg-black/50` 1 ＋ `bg-black` 1；`bg: gray-800` −2 = `dark:hover:bg-gray-800` 1 ＋ `dark:bg-gray-800/50` 1；`bg: gray-50` −2 = `bg-gray-50` 1 ＋ `hover:bg-gray-50` 1；`bg: white` −2 = `bg-white` 2；`border: gray-200` −3 = `border-gray-200` 3；`border: gray-700` −3 = `dark:border-gray-700` 3；`text: gray-300` −2 = `dark:text-gray-300` 1 ＋ `dark:hover:text-gray-300` 1；`text: gray-400` −3 = `dark:text-gray-400` 2 ＋ `text-gray-400` 1；`text: gray-600` −2 = `text-gray-600` 1 ＋ `hover:text-gray-600` 1；`text: white` −2 = `text-white` 1 ＋ `dark:text-white` 1；其余 10 条各 −1），**无原子归零** |

**产物核对（通用脚本第 11 次复用）**：纯前缀插入 **YES**；26 个 token **全部**在 `dist` 有令牌形态；**本片 0 个独占拼写**（26 个字面在 `src/` 均仍有其他消费者，如实记账，非空转）。**带透明度 2 处值链实测**：`bg-n-black/50` → `hsl(var(--n-black) / .5)`、`dark:bg-n-gray-800/50` → `hsl(var(--n-gray-800) / .5)`。非空转探针（注入 `dark:bg-gray-80` / `text-fuchsia-999`）如预期报 **FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`build:client`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ 35 ＋ 33 ＋ **32** ＝ **740** 处；剩余 **776 处 / 91 文件**，余下最大单片 `GithubAuthenticationCard.tsx` 31。

#### 0-E2r：`GithubAuthenticationCard.tsx` 31 → 0（热点榜第十四，已实施）

**范围**：`src/modules/project-creation-wizard/GithubAuthenticationCard.tsx`。**31 处 / 18 个 token / 14 行**——族 `gray` 27 ＋ `white` 4（无 `black`）；工具类 `text` 21 ／ `bg` 6 ／ `border` 4；**带透明度 1 处**（`dark:bg-gray-900/50`）。档位**集中在中段**：`gray-300/400/500/600/700` 五档合计 **21/31**，两端（`gray-50` / `gray-900`）各仅 1 处。**无动态色构造、无轴限定形态**。同文件品牌色（`green-*` 等 GitHub 语义色）未触碰。

**前置检查（沿用既定一次点名）**：迁移前确认本片用到的 10 个档位（`gray-50/200/300/400/500/600/700/800/900` ＋ `white`）在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**（共 20 条声明），无需新建令牌。

**手法**：与 0-E2g…0-E2q 相同（扫描器为唯一事实源，`scanner hits: 31  exempt: 0  migratable: 31  rewrites: 31`；反向还原后与备份 `diff` 字节级相同）。token 含前缀包含关系（`text-white` ⊂ `dark:text-white`、`text-gray-400` ⊂ `dark:text-gray-400`），按长度降序替换后逐条对照确认未串味。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **776 → 745（−31）**，文件数 **91 → 90**；`byFile` 该文件 `31 → 0` 是唯一文件级 delta；`byAtom` **17 条全为减、无一增**，合计恰 **−31**（`text: gray-700` −4 = `text-gray-700` 4；`text: gray-300` −4 = `dark:text-gray-300` 4；`text: gray-400` −4 = `dark:text-gray-400` 4；`text: gray-500` −3 = `text-gray-500` 3；`text: white` −3 = `text-white` 2 ＋ `dark:text-white` 1；`text: gray-600` −2 = `text-gray-600` 2；其余 11 条各 −1。**无原子归零**） |

**产物核对（通用脚本第 12 次复用）**：纯前缀插入 **YES**；18 个 token **全部**在 `dist` 有令牌形态；**0 个独占拼写**（18 个字面在 `src/` 均仍有其他消费者，最小 2 处，如实记账、非空转）。**带透明度 1 处值链实测**：`dark:bg-n-gray-900/50` → `hsl(var(--n-gray-900) / .5)`。非空转探针（注入 `dark:bg-gray-80` / `text-fuchsia-999`）如预期报 **FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`build:client`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ 35 ＋ 33 ＋ 32 ＋ **31** ＝ **771** 处；剩余 **745 处 / 90 文件**，余下最大单片 `PrdEditorHeader.tsx` 30。

#### 0-E2s：`PrdEditorHeader.tsx` 30 → 0（热点榜第十五，已实施）

**范围**：`src/modules/prd-editor/PrdEditorHeader.tsx`。**30 处 / 18 个 token / 11 行**——族 `gray` 24 ＋ `white` 6（无 `black`）；工具类 `text` 18 ／ `bg` 6 ／ `border` 4 ／ `placeholder` 2；**零透明度**（全片无 `/NN` 修饰）。档位跨两端：`gray-50/100/200/400/500/600/700/800/900` ＋ `white`（缺 `gray-300`）。变体含 `hover:` / `dark:hover:` 双层。**无动态色构造、无轴限定形态**。同文件品牌色（`purple-*` / `green-*`）未触碰。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 10 个档位（`gray-50/100/200/400/500/600/700/800/900` ＋ `white`）在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **10 / 10**，无缺失，无需新建令牌。

**手法**：与 0-E2g…0-E2r 相同（扫描器为唯一事实源，`scanner hits: 30  exempt: 0  migratable: 30  rewrites: 30`；反向还原后与备份 `diff` 字节级相同）。token 含三段前缀包含关系（`text-white` ⊂ `dark:text-white` ⊂ `dark:hover:text-white`、`text-gray-400` ⊂ `dark:text-gray-400`、`text-gray-900` ⊂ `hover:text-gray-900`），按**长度降序**替换后逐条对照确认未串味。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **745 → 715（−30）**，文件数 **90 → 89**；`byFile` 该文件 `30 → 0` 是唯一文件级 delta；`byAtom` **14 条全为减、无一增**，合计恰 **−30**（`text: white` −6 = `text-white` 3 ＋ `dark:text-white` 1 ＋ `dark:hover:text-white` 2；`text: gray-400` −5 = `dark:text-gray-400` 4 ＋ `text-gray-400` 1；`text: gray-900` −3 = `hover:text-gray-900` 2 ＋ `text-gray-900` 1；`bg: gray-100` −2 = `hover:bg-gray-100` 2；`bg: gray-800` −2 = `dark:hover:bg-gray-800` 2；`border: gray-200` −2 = `border-gray-200` 2；`text: gray-500` −2 = `text-gray-500` 2；`text: gray-600` −2 = `text-gray-600` 2；其余 6 条各 −1），其中 **2 条归零**：`placeholder: gray-400` 1→0、`placeholder: gray-500` 1→0 |

**产物核对（通用脚本第 13 次复用）**：纯前缀插入 **YES**；18 个 token **全部**在 `dist` 有令牌形态；**本片 2 个字面在迁移后于 `src/` 归零**（`placeholder-gray-400`、`dark:placeholder-gray-500`——迁移前本片是其全仓唯一消费者），`dist` 同步不再生成，条件式断言 `(src>0)===(dist>0)` 在这两列同为 0 时成立；**零透明度**，无值链实测项。非空转探针（注入 `bg-gray-999`）如预期报 **FAILED**。

**一处自洽印证**：`byAtom` 归零的 2 条原子（均为 `placeholder` 工具类）与产物侧"迁移后全仓零消费的 2 个字面"是同一组事实的两个视角——原子桶归零 ⟺ 该字面全仓再无消费者。两条独立路径给出同一个"2"，互为佐证。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ 35 ＋ 33 ＋ 32 ＋ 31 ＋ **30** ＝ **801** 处；剩余 **715 处 / 89 文件**，余下最大单片 `GenerateTasksModal.tsx` 30（与 `CreateTaskModal.tsx` / `TaskHelpModal.tsx` / `TaskCard.tsx` 并列）。

#### 0-E2t：`GenerateTasksModal.tsx` 30 → 0（热点榜第十六，已实施）

**范围**：`src/modules/prd-editor/modals/GenerateTasksModal.tsx`。**30 处 / 21 个 token / 10 行**——族 `gray` 24 ＋ `white` 5 ＋ `black` 1；工具类 `bg` 11 ／ `border` 8 ／ `text` 11（**三工具最均衡**，此前各片 `text` 普遍占优）；**带透明度 1 处**（模态遮罩 `bg-black/50`）。档位 `gray-50/100/200/300/400/600/700/800/900` ＋ `white` ＋ `black`——**缺 `gray-500`**，两端与中段齐备。**无动态色构造、无轴限定形态**。同文件品牌色（`purple-*`）与半透明卡片面（`dark:bg-purple-900/50`、`dark:bg-purple-900/20`）未触碰。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 11 个档位（`gray-50/100/200/300/400/600/700/800/900` ＋ `white` ＋ `black`）在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **11 / 11**，无缺失，无需新建令牌。

**手法**：与 0-E2g…0-E2s 相同（扫描器为唯一事实源，`scanner hits: 30  exempt: 0  migratable: 30  rewrites: 30`；反向还原后与备份 `diff` 字节级相同）。token 含前缀包含关系（`text-gray-600` ⊂ `hover:text-gray-600`、`text-gray-400` ⊂ `dark:text-gray-400`），按**长度降序**替换后逐条对照确认未串味；本片另有 `bg-black/50` 但**不存在裸 `bg-black`**，故该形态的包含陷阱在本片不成立（仍按长度降序处理）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **715 → 685（−30）**，文件数 **89 → 88**；`byFile` 该文件 `30 → 0` 是唯一文件级 delta；`byAtom` **17 条全为减、无一增**，合计恰 **−30**（`bg: white` −3 = `bg-white` 3；`border: gray-200` −3 = `border-gray-200` 3；`border: gray-700` −3 = `dark:border-gray-700` 3；`bg: gray-700` −2 = `dark:bg-gray-700` 1 ＋ `dark:hover:bg-gray-700` 1；`bg: gray-800` −2 = `dark:bg-gray-800` 2；`text: gray-300` −2 = `dark:text-gray-300` 1 ＋ `dark:hover:text-gray-300` 1；`text: gray-400` −2 = `dark:text-gray-400` 1 ＋ `text-gray-400` 1；`text: gray-600` −2 = `hover:text-gray-600` 1 ＋ `text-gray-600` 1；`text: gray-900` −2 = `text-gray-900` 2；`text: white` −2 = `dark:text-white` 2；其余 7 条各 −1），**无原子归零** |

**产物核对（通用脚本第 14 次复用）**：纯前缀插入 **YES**；21 个 token **全部**在 `dist` 有令牌形态；**0 个独占拼写**（21 个字面在 `src/` 均仍有其他消费者，最小 2 处——`dark:hover:bg-gray-600`、`hover:bg-gray-50`，如实记账、非空转）。**带透明度 1 处值链实测**：`bg-n-black/50` → `hsl(var(--n-black) / .5)`。非空转探针（注入 `bg-black/95`）如预期报 **FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ 35 ＋ 33 ＋ 32 ＋ 31 ＋ 30 ＋ **30** ＝ **831** 处；剩余 **685 处 / 88 文件**，余下最大单片 `CreateTaskModal.tsx` 30（与 `TaskHelpModal.tsx` / `TaskCard.tsx` 并列）。

#### 0-E2u：`CreateTaskModal.tsx` 30 → 0（热点榜第十七，已实施）

**范围**：`src/modules/task-master/modals/CreateTaskModal.tsx`。**30 处 / 21 个 token / 10 行**——族 `gray` 24 ＋ `white` 5 ＋ `black` 1；工具类 `bg` 11 ／ `border` 8 ／ `text` 11；**带透明度 1 处**（模态遮罩 `bg-black/50`）。档位 `gray-50/100/200/300/400/600/700/800/900` ＋ `white` ＋ `black`（缺 `gray-500`）。

**与 0-E2t 的关系（可机械核对的同构）**：本片与上一片 0-E2t `GenerateTasksModal.tsx` 是**逐 token 同构的姊妹文件**——扫描器给出的 **21 个 token 及其出现次数完全一致**（`bg-white` 3、`dark:bg-gray-800` 2、`border-gray-200` 3、`dark:border-gray-700` 3、`bg-black/50` 1……），两片的 `byAtom` 减量也因此呈**逐条相同的 17 条模式**。唯一差别是模块品牌色族：0-E2t 用 `purple-*`，本片用 `blue-*`（两者均不属中性色、均未触碰）。核对方式不是"看起来像"，而是把两片的 token 清单直接比对——相同项数与计数一一对上。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 11 个档位（`gray-50/100/200/300/400/600/700/800/900` ＋ `white` ＋ `black`）在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **11 / 11**，无缺失，无需新建令牌。

**手法**：与 0-E2g…0-E2t 相同（扫描器为唯一事实源，`scanner hits: 30  exempt: 0  migratable: 30  rewrites: 30`；反向还原后与备份 `diff` 字节级相同）。token 含前缀包含关系（`text-gray-600` ⊂ `hover:text-gray-600`、`text-gray-400` ⊂ `dark:text-gray-400`），按**长度降序**替换后逐条对照确认未串味；本片有 `bg-black/50` 但**无裸 `bg-black`**，故该包含陷阱在本片不成立。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **685 → 655（−30）**，文件数 **88 → 87**；`byFile` 该文件 `30 → 0` 是唯一文件级 delta；`byAtom` **17 条全为减、无一增**，合计恰 **−30**，且**模式与 0-E2t 逐条相同**（`bg: white` −3、`border: gray-200` −3、`border: gray-700` −3、`bg: gray-700` / `bg: gray-800` / `text: gray-300` / `text: gray-400` / `text: gray-600` / `text: gray-900` / `text: white` 各 −2、其余 7 条各 −1；构成分解同 0-E2t），**无原子归零** |

**产物核对（通用脚本第 15 次复用）**：纯前缀插入 **YES**；21 个 token **全部**在 `dist` 有令牌形态；**0 个独占拼写**（21 个字面在 `src/` 均仍有其他消费者，最小 1 处——`dark:hover:bg-gray-600`、`hover:bg-gray-50`，如实记账、非空转）。**带透明度 1 处值链实测**：`bg-n-black/50` → `hsl(var(--n-black) / .5)`。非空转探针（注入 `bg-black/95`）如预期报 **FAILED**。

**一处连锁可观测**：`dark:hover:bg-gray-600` 与 `hover:bg-gray-50` 的 `src` 计数在本片迁移后为 **1**，而在 0-E2t 的产物核对里为 **2**——本片消费掉其中 1 处后余 1 处，与上文"最小 1 处"一致；两片的产物核对在数字上相互咬合。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ 35 ＋ 33 ＋ 32 ＋ 31 ＋ 30 ＋ 30 ＋ **30** ＝ **861** 处；剩余 **655 处 / 87 文件**，余下最大单片 `TaskHelpModal.tsx` 30（与 `TaskCard.tsx` 并列）。

#### 0-E2v：`TaskHelpModal.tsx` 30 → 0（热点榜第十八，已实施）

**范围**：`src/modules/task-master/modals/TaskHelpModal.tsx`。**30 处 / 19 个 token / 13 行**——族 `gray` 23 ＋ `white` 6 ＋ `black` 1；工具类 `text` 17 ／ `bg` 7 ／ `border` 6；**带透明度 2 处**（`bg-black/50` 与 `dark:bg-gray-800/50`）。档位 `gray-50/200/300/400/600/700/800/900` ＋ `white` ＋ `black`——**缺 `gray-100` 与 `gray-500`**。**无动态色构造、无轴限定形态**。同文件品牌色（`blue-*` / `emerald-*` / `amber-*` / `purple-*`，含 `steps[].accent` 模板串里的四组 accent 组合）未触碰。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 10 个档位（`gray-50/200/300/400/600/700/800/900` ＋ `white` ＋ `black`）在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **10 / 10**，无缺失，无需新建令牌。

**手法**：与 0-E2g…0-E2u 相同（扫描器为唯一事实源，`scanner hits: 30  exempt: 0  migratable: 30  rewrites: 30`；反向还原后与备份 `diff` 字节级相同）。token 含前缀包含关系（`text-white` ⊂ `dark:text-white`、`text-gray-400` ⊂ `dark:text-gray-400`、`text-gray-300` ⊂ `dark:text-gray-300`、`text-gray-600` ⊂ `hover:text-gray-600`），按**长度降序**替换后逐条对照确认未串味；`bg-black/50` 与 `dark:bg-gray-800/50` 均无对应的裸形态并存。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **655 → 625（−30）**，文件数 **87 → 86**；`byFile` 该文件 `30 → 0` 是唯一文件级 delta；`byAtom` **15 条全为减、无一增**，合计恰 **−30**（`text: white` −5 = `dark:text-white` 3 ＋ `text-white` 2；`border: gray-200` −3 = `border-gray-200` 3；`border: gray-700` −3 = `dark:border-gray-700` 3；`text: gray-400` −3 = `dark:text-gray-400` 2 ＋ `text-gray-400` 1；`text: gray-600` −3 = `text-gray-600` 2 ＋ `hover:text-gray-600` 1；`text: gray-900` −3 = `text-gray-900` 3；`text: gray-300` −2 = `dark:text-gray-300` 1 ＋ `dark:hover:text-gray-300` 1；其余 8 条各 −1），**无原子归零** |

**产物核对（通用脚本第 16 次复用）**：纯前缀插入 **YES**；19 个 token **全部**在 `dist` 有令牌形态；**0 个独占拼写**（19 个字面在 `src/` 均仍有其他消费者，最小 1 处——`dark:bg-gray-800/50`，如实记账、非空转）。**带透明度 2 处值链均实测**：`bg-n-black/50` → `hsl(var(--n-black) / .5)`、`dark:bg-n-gray-800/50` → `hsl(var(--n-gray-800) / .5)`。非空转探针（注入 `bg-black/95`）如预期报 **FAILED**。

**密度观察**：30 处落在 **13 行**（≈2.3 处/行），是近几片里最密的一类——原因是标题区与步骤列表把 `text-*` 成串写在同一 `className` 上，替换仍是逐 token 纯插入，无结构性风险。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ 35 ＋ 33 ＋ 32 ＋ 31 ＋ 30 ＋ 30 ＋ 30 ＋ **30** ＝ **891** 处；剩余 **625 处 / 86 文件**，余下最大单片 `TaskCard.tsx` 30。

#### 0-E2w：`TaskCard.tsx` 30 → 0（热点榜第十九，已实施）

**范围**：`src/modules/task-master/TaskCard.tsx`。**30 处 / 19 个 token / 13 行**——族 `gray` 24 ＋ `slate` 4 ＋ `white` 2；工具类 `text` 20 ／ `bg` 8 ／ `border` 2；**零透明度**（值链检查真空转，见下）。档位 `gray-100/200/300/400/500/700/800` ＋ `slate-100/400/500/900` ＋ `white`（共 12 档，两个族的档位互不重叠）。**无动态色构造、无轴限定形态**。同文件品牌/状态色未触碰。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 12 个档位（`gray` 7 档 ＋ `slate` 4 档 ＋ `white`）在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **12 / 12**，无缺失，无需新建令牌。

**手法**：与 0-E2g…0-E2v 相同（扫描器为唯一事实源，`scanner hits: 30  exempt: 0  migratable: 30  rewrites: 30`；反向还原后与备份 `diff` 字节级相同）。token 含前缀包含关系（`text-gray-400` ⊂ `dark:text-gray-400`、`text-gray-500` ⊂ `dark:text-gray-500`），按**长度降序**替换后逐条对照确认未串味；`dark:text-slate-100/400` 与 `text-slate-500/900` 无长短包含关系。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **625 → 595（−30）**，文件数 **86 → 85**；`byFile` 该文件 `30 → 0` 是唯一文件级 delta；`byAtom` **17 条全为减、无一增**，合计恰 **−30**（`text: gray-400` −6 = `dark:text-gray-400` 5 ＋ `text-gray-400` 1；`text: gray-500` −6 = `dark:text-gray-500` 1 ＋ `text-gray-500` 5；`bg: gray-100` −2 = `bg-gray-100` 2；`bg: gray-700` −2 = `dark:bg-gray-700` 2；`bg: gray-800` −2 = `dark:bg-gray-800` 2；其余 12 条各 −1），其中 **4 条归零**且**全在 `slate` 族**：`text: slate-100`、`text: slate-400`、`text: slate-500`、`text: slate-900` 各 1→0 |

**产物核对（通用脚本第 17 次复用）**：纯前缀插入 **YES**；19 个 token **全部**在 `dist` 有令牌形态；**4 个字面在迁移后于 `src/` 归零**（`dark:text-slate-100`、`dark:text-slate-400`、`text-slate-500`、`text-slate-900`——迁移前本片是其全仓唯一消费者），这四个的 `dist` 表单同样为 **0**、而对应令牌 `dist` 各为 **1**——即"字面规则不再生成、令牌规则新生成"在同一行上同时可读。其余 15 个字面仍有其他消费者（最小 5 处 = `bg-gray-200`）。**零透明度，值链检查迭代零次（真空转），如实标注**。非空转探针（注入 `bg-slate-999`）如预期报 **FAILED**。

**与 0-E2s 的对照**：这是本线第二次出现"独占拼写归零"，但规模更大（**4 个 vs 2 个**）且**跨族**（0-E2s 是同一 `placeholder` 工具类的两个档位，本片是 `slate` 族四个不同工具类位置的独立字面）。两片的 `byAtom` 归零条数与产物侧 `src` 归零字面数依旧一一对应。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ 35 ＋ 33 ＋ 32 ＋ 31 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ **30** ＝ **921** 处；剩余 **595 处 / 85 文件**，余下最大单片 `fileIcons.ts` 28。

#### 0-E2x：`fileIcons.ts` 28 → 0（热点榜第二十，已实施）

**范围**：`src/modules/file-tree/utils/fileIcons.ts`。**28 处 / 2 个 token / 28 行**。这是本线**结构最简单的一片**：扫描器只报出两个 token——`text-gray-500` ×21 与 `text-gray-400` ×7；族只有 `gray`，工具类只有 `text`，**零 `bg` / 零 `border` / 零透明度 / 零变体**（无 `dark:`、无 `hover:`）。档位只有 2 个（`gray-400` / `gray-500`）。文件其余部分是各语言/文件类型的品牌色图标映射（`text-blue-*`、`text-amber-*` 等）与 lucide 图标导入，均未触碰。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 2 个档位（`gray-400` / `gray-500`）在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **2 / 2**，无缺失。

**手法**：与 0-E2g…0-E2w 相同（扫描器为唯一事实源，`scanner hits: 28  exempt: 0  migratable: 28  rewrites: 28`；反向还原后与备份 `diff` 字节级相同）。本片**无任何前缀包含关系**（两个 token 都是裸 `text-gray-*`，无 `dark:`/`hover:` 长形态可与之竞争），长度降序替换在此退化为无关紧要的顺序。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **595 → 567（−28）**，文件数 **85 → 84**；`byFile` 该文件 `28 → 0` 是唯一文件级 delta；`byAtom` **仅 2 条**、均为减：`text: gray-400` **74 → 67（−7）**、`text: gray-500` **55 → 34（−21）**，合计恰 **−28**，**无原子归零** |

**产物核对（通用脚本第 18 次复用）**：纯前缀插入 **YES**；2 个 token **全部**在 `dist` 有令牌形态；**0 个独占拼写**（两个字面在 `src/` 仍有 19 / 21 处其他消费者）。**零透明度，值链检查迭代零次（真空转），如实标注**。非空转探针（注入 `text-gray-999`）如预期报 **FAILED**。

**一处结构性观察**：本片 28 处**恰好落在 28 行**（每行一处，无一行承载两处），与 0-E2v 的"30 处 / 13 行"（≈2.3 处/行）形成两端对照——两片都通过同一套门槛，说明核对流程对"密度"不敏感，只对"token 内容"敏感；这正是"从产物反推清单"设计的收益。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ 35 ＋ 33 ＋ 32 ＋ 31 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ **28** ＝ **949** 处；剩余 **567 处 / 84 文件**，余下最大单片 `TaskListContent.tsx` 24（与 `MessageComponent.tsx` 并列）。

#### 0-E2y：`TaskListContent.tsx` 24 → 0（热点榜第二十一，已实施）

**范围**：`src/modules/chat/tools/ContentRenderers/TaskListContent.tsx`。**24 处 / 15 个 token / 10 行**——**纯 `gray` 单族**（无 `white` / `black` / 非 gray 族）；工具类 `text` 18 ／ `bg` 4 ／ `border` 2；**零透明度**；档位 8 个（`gray-100/200/300/400/500/600/700/800`，缺 `50` 与 `900`）。变体含 `dark:` 与 `dark:border-*`。**无动态色构造、无轴限定形态**。同文件语义色（success / warning 等）未触碰。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 8 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **8 / 8**，无缺失。

**手法**：与 0-E2g…0-E2x 相同（扫描器为唯一事实源，`scanner hits: 24  exempt: 0  migratable: 24  rewrites: 24`；反向还原后与备份 `diff` 字节级相同）。token 含前缀包含关系（`text-gray-300/400/500` ⊂ 对应 `dark:text-gray-*`），按**长度降序**替换后逐条对照确认未串味。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **567 → 543（−24）**，文件数 **84 → 83**；`byFile` 该文件 `24 → 0` 是唯一文件级 delta；`byAtom` **13 条全为减、无一增**，合计恰 **−24**（`text: gray-400` −7 = `dark:text-gray-400` 4 ＋ `text-gray-400` 3；`text: gray-500` −4 = `dark:text-gray-500` 3 ＋ `text-gray-500` 1；`text: gray-600` −3 = `text-gray-600` 3；其余 10 条各 −1），**无原子归零** |

**产物核对（通用脚本第 19 次复用）**：纯前缀插入 **YES**；15 个 token **全部**在 `dist` 有令牌形态；**0 个独占拼写**（15 个字面在 `src/` 均仍有其他消费者，**最小 1 处 = `dark:text-gray-100`**——本片迁走后全仓恰好还剩 1 处，属于"贴边非独占"的临界样本，如实记账）。**零透明度，值链检查迭代零次（真空转），如实标注**。非空转探针（注入 `text-gray-999`）如预期报 **FAILED**。

**一处临界观察**：`dark:text-gray-100` 的 `src` 计数为 **1**——它距"独占拼写归零"只差一步。若下一片恰好是它最后的消费者，那条 `byAtom` 会归零、产物核对那一行会变成 `0 0`（与 0-E2s / 0-E2w 同形）。这条记录因此可以当作后续片次的"预期锚点"。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ 35 ＋ 33 ＋ 32 ＋ 31 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 28 ＋ **24** ＝ **973** 处；剩余 **543 处 / 83 文件**，余下最大单片 `MessageComponent.tsx` 24。

#### 0-E2z：`MessageComponent.tsx` 24 → 0（热点榜第二十二，已实施）

**范围**：`src/modules/chat/transcript/MessageComponent.tsx`。**24 处 / 16 个 token / 12 行**——族 `gray` 20 ＋ `white` 4；工具类 `text` 19 ／ `bg` 5（**无 `border`**、无 `placeholder` / `ring` 等）；**带透明度 1 处**（`dark:bg-gray-800/60`，**60% 档**）。档位 `gray-300/400/500/600/700/800` ＋ `white`（共 7 档，缺 `50` / `100` / `900`）。变体含 `dark:` / `dark:hover:` / `hover:`。**无动态色构造、无轴限定形态**。同文件语义状态色未触碰。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 7 个档位（`gray` 6 档 ＋ `white`）在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **7 / 7**，无缺失。

**手法**：与 0-E2g…0-E2y 相同（扫描器为唯一事实源，`scanner hits: 24  exempt: 0  migratable: 24  rewrites: 24`；反向还原后与备份 `diff` 字节级相同）。token 含前缀包含关系（`text-white` ⊂ `dark:text-white`、`text-gray-300/400/500` ⊂ 对应 `dark:text-gray-*` ＋ `dark:hover:text-gray-300`），按**长度降序**替换后逐条对照确认未串味。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **543 → 519（−24）**，文件数 **83 → 82**；`byFile` 该文件 `24 → 0` 是唯一文件级 delta；`byAtom` **12 条全为减、无一增**，合计恰 **−24**（`text: gray-400` −5 = `dark:text-gray-400` 3 ＋ `text-gray-400` 2；`text: gray-500` −5 = `dark:text-gray-500` 2 ＋ `text-gray-500` 3；`text: white` −4 = `dark:text-white` 1 ＋ `text-white` 3；`text: gray-300` −2 = `dark:text-gray-300` 1 ＋ `dark:hover:text-gray-300` 1；其余 8 条各 −1），**0 个原子桶归零**（最接近的是 `bg: gray-400`，迁后余 **1**） |

**产物核对（通用脚本第 20 次复用）**：纯前缀插入 **YES**；16 个 token **全部**在 `dist` 有令牌形态；**2 个字面在迁移后于 `src/` 归零**（`bg-gray-600`、`dark:bg-gray-500`——迁移前本片是其全仓唯一消费者），这两个的 `dist` 同为 **0**、对应令牌各为 **1**。**带透明度 1 处值链实测**：`dark:bg-n-gray-800/60` → `hsl(var(--n-gray-800) / .6)`（**首见 60% 档**，此前的透明度样本是 `/20` `/30` `/40` `/50`）。非空转探针（注入 `bg-gray-999`）如预期报 **FAILED**。

**本片最有价值的一处认知修正——"桶"比"字面"粗**：0-E2s 与 0-E2w 曾经呈现"`byAtom` 归零条数 = 产物侧 `src` 归零字面数"（各 2 与 4），容易让人以为两者恒等。本片给出反例：**2 个字面归零，`byAtom` 却 0 条归零**。原因是两者的聚合粒度不同——
- **原子桶**的键是 `变体链 工具类: 族-档`（如 `bg: gray-600`），同一档位下**所有变体字面**（`bg-gray-600`、`dark:bg-gray-600`、`hover:bg-gray-600`…）共享一个桶；
- **产物核对的 `src` 计数**是**字面级**（`bg-gray-600` 与 `dark:bg-gray-600` 分别统计）。

本片迁走的是裸 `bg-gray-600`（它唯一），但 `bg: gray-600` 桶里还有别的变体字面存活，故桶减 1（6 → 5）而不归零。同理 `bg: gray-500` 桶因 `dark:bg-gray-500` 之外仍有消费者，也是 6 → 5。所以正确表述是：**字面归零 ⇒ 该字面所属桶必然减计数；桶归零 ⟺ 该桶下所有变体字面都全仓零消费**——后者是更强的条件，只有在"该档位只剩这一个变体字面在消费"时才与前者的条数相等（0-E2s 的 `placeholder` 桶、0-E2w 的 `slate` 桶恰好满足）。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

#### 0-E3a：`CodeEditorBinaryFile.tsx` 23 → 0（热点榜第二十三，已实施）

**范围**：`src/modules/code-editor/CodeEditorBinaryFile.tsx`。**23 处 / 9 个 token / 6 行**——族 `gray` 17 ＋ `white` 5 ＋ `black` 1；工具类 `text` 16 ／ `bg` 7（**无 `border`**、无 `placeholder` / `ring` 等）；**带透明度 1 处**（`md:bg-black/50`）。档位 `gray-100/400/600/800/900` ＋ `white` ＋ `black`（共 7 档，缺 `50` / `200` / `300` / `700`）。变体含 `dark:` / `dark:hover:` / `hover:` / `md:`。**无动态色构造、无轴限定形态**。同文件语义状态色（`bg-background` / `text-muted-foreground` / `bg-primary` 等）未触碰。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 7 个档位（`gray` 5 档 ＋ `white` ＋ `black`）在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **7 / 7**，无缺失。

**手法**：与 0-E2g…0-E2z 相同（扫描器为唯一事实源，`scanner hits: 23  exempt: 0  migratable: 23  rewrites: 23`；反向还原后与备份 `diff` 字节级相同）。token 含前缀包含关系（`text-gray-900` ⊂ `hover:text-gray-900`；`text-white` ⊂ `dark:text-white` / `dark:hover:text-white`；`bg-black` ⊂ `md:bg-black/50`），按**长度降序**替换后逐条对照确认未串味。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **519 → 496（−23）**，文件数 **82 → 81**；`byFile` 该文件 `23 → 0` 是唯一文件级 delta；`byAtom` **7 条全为减、无一增**，合计恰 **−23**（`text: white` −5 = `dark:hover:text-white` 3 ＋ `dark:text-white` 2；`text: gray-900` −5 = `hover:text-gray-900` 3 ＋ `text-gray-900` 2；`bg: gray-800` −3 = `dark:hover:bg-gray-800` 3；`bg: gray-100` −3 = `hover:bg-gray-100` 3；`text: gray-400` −3 = `dark:text-gray-400` 3；`text: gray-600` −3 = `text-gray-600` 3；`bg: black` −1 = `md:bg-black/50` 1），**0 个原子桶归零** |

**产物核对（通用脚本第 21 次复用）**：纯前缀插入 **YES**；9 个 token **全部**在 `dist` 有令牌形态；**无字面在迁移后归零**（9 个字面的 `src` 计数最小为 **3**——`dark:hover:text-white` 与 `hover:text-gray-900` 各 3，即 **0 独占拼写**，本片没有任何字面是全仓唯一消费者）。**带透明度 1 处值链实测**：`md:bg-n-black/50` → `hsl(var(--n-black) / .5)`。非空转探针（注入 `bg-gray-999`）如预期报 **FAILED**。

**本片特征——"高密度复用"**：23 处落在仅 **6 行**。原因是三处按钮（侧栏关闭、全屏切换、关闭）共用**完全相同的 className 串** `flex items-center justify-center rounded-md p-1.5 text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white`（该串含 6 个中性色类，出现 3 次即 18 处；另加两个标题行的 `text-gray-900 dark:text-white` 各 2 处 = 4，与模态遮罩 1 处，合计 23）。这是继 0-E2l「同一 token 多处复用」之后第二个"低行数、高命中"样本，也是 `md:` 变体在本线首次出现（`md:bg-black/50`，桌面端遮罩）。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

#### 0-E3b：`CodeEditorMediaPreview.tsx` 22 → 0（热点榜第二十四，已实施）

**范围**：`src/modules/code-editor/CodeEditorMediaPreview.tsx`。**22 处 / 10 个 token / 6 行**——族 `gray` 16 ＋ `white` 5 ＋ `black` 1；工具类 `text` 14 ／ `bg` 8（**无 `border`**、无 `placeholder` / `ring` 等）；**带透明度 1 处**（`md:bg-black/50`）；含 `bg-white`（PDF `<iframe>` 背景）。档位 `gray-100/400/600/800/900` ＋ `white` ＋ `black`（共 7 档）。变体含 `dark:` / `dark:hover:` / `hover:` / `md:`。**无动态色构造、无轴限定形态**。同文件语义状态色（`bg-muted/30` / `text-muted-foreground` 等）未触碰。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 7 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **7 / 7**，无缺失。

**手法**：与 0-E2g…0-E3a 相同（扫描器为唯一事实源，`scanner hits: 22  exempt: 0  migratable: 22  rewrites: 22`；反向还原后与备份 `diff` 字节级相同）。token 含前缀包含关系（`text-gray-900` ⊂ `hover:text-gray-900`；`text-white` ⊂ `dark:text-white`；`bg-black` ⊂ `md:bg-black/50`），按**长度降序**替换后逐条对照确认未串味。本片与 0-E3a 共享同一段按钮 className，**6 个中性类完全相同**，是"同模块姊妹组件"的第二个样本。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **496 → 474（−22）**，文件数 **81 → 80**；`byFile` 该文件 `22 → 0` 是唯一文件级 delta；`byAtom` **8 条全为减、无一增**，合计恰 **−22**（`text: white` −4 = `dark:hover:text-white` 3 ＋ `dark:text-white` 1；`text: gray-900` −4 = `hover:text-gray-900` 3 ＋ `text-gray-900` 1；`bg: gray-800` −3；`bg: gray-100` −3；`text: gray-400` −3；`text: gray-600` −3；`bg: black` −1；`bg: white` −1），**0 个原子桶归零** |

**产物核对（通用脚本第 22 次复用）——首次报 FAILED，归因是脚本自身的覆盖面缺口**：首跑输出 `hover:text-gray-900` 一行 `src=0 / dist=1`，触发脚本的镜像断言 `(litSrc > 0) !== (litDist > 0)`。**这不是迁移缺陷**。追查到 `src/index.css:1082` 有一条**手写的、带 CSS 转义的选择器** `.hover\:text-gray-900:hover`（与 `a:hover` / `.hover\:bg-gray-50:hover` 等并列，见下）。核对脚本的 `srcExact` 只遍历 `src` 下的 `.tsx?` 文件，**完全看不见 CSS 里的类名引用**，于是把一个合法消费者判成"凭空多出的 dist 规则"。**修法**：给 `srcExact` 增加 `.css` 分支——按 `/\.((?:[A-Za-z0-9_-]|\\.)+)/g` 提取类选择器并反转义后再比较（*不能*用裸 token 扫描：CSS 选择器 token 化后是 `.hover:text-gray-900:hover`，带前导点与伪类，永不等于裸候选名）。修复后该行 `src` 由 0 变 **1**（即 index.css 那处），与 `dist=1` 一致，**ARTIFACT CHECK PASSED**。非空转双对照同时成立：**不注入 PASSED、注入 `bg-gray-999` FAILED**（`/tmp/0e2j-probe.cjs` 同缺口、同修复）。

**新发现——`index.css` 的选择器级消费者（阶段 0 口径缺口，已拍板 B3）**：`src/index.css` 的两段 `@media (hover: none) and (pointer: coarse)`（触屏禁用 hover）把**字面中性类名当作选择器目标**：

```css
.hover\:bg-gray-50:hover,
.hover\:bg-gray-100:hover,
.hover\:text-gray-900:hover { background-color: inherit !important; color: inherit !important; opacity: inherit !important; }
```

（`hover\:bg-gray-50` / `hover\:bg-gray-100` 各出现在 1044/1045 与 1080/1081 两段，`hover\:text-gray-900` 在 1082。）阶段 0 把**使用处**改成 `n-*` 后，这些选择器**不再命中已迁移元素**。量化：
- `hover:text-gray-900`——本片之后 `.tsx` 消费者**归零**，该 CSS 规则现匹配 **0** 个元素（完全失效），而它本该覆盖的那 6 处（0-E3a 3 ＋ 0-E3b 3）已改用 `hover:text-n-gray-900`，不再被重置；
- `hover:bg-gray-50` / `hover:bg-gray-100`——`.tsx` 仍有未迁移消费者（后者 `src` 计数 11），规则对**未迁移元素**仍有效，但对 0-E2t / 0-E2u 等已迁移元素已失配。

**影响面**：仅在触屏（`hover:none`）且发生 sticky hover 时可观测，视觉差异是"hover 态未被强制 `inherit`"。**取舍（已拍板，用户 2026-09-25）**：选项为 **B1** 逐片把这三行补成 `n-*` 选择器；**B2** 旧＋新两套并存（零行为变化，阶段 0 末删旧）；**B3** 不动，作为已知差异记账、交阶段 2 语义化改名时统一重排这些引用。**结论：采纳 B3**——理由：实际影响需触屏 sticky hover 才可观测，且阶段 2 本就要重排 `index.css` 的这些引用。配套决定：**扫描器 `themeHardcodedAtoms.ts` 暂不把 CSS 选择器级引用纳入口径**（若纳入须刷新冻结基准量 1517，属"护栏覆盖面变化"事项，本阶段不做）。这三行**不改、不删**，作为阶段 2 的显式待办保留。（探针侧的 `.css` 支撑已就地修复——那是核对工具的覆盖面，不入库。）

> **B3 账状态更新（2026-09-26，实施轮批 3 `fe86d589`）**：实施轮审阅（P1-1）核出 B3 的前提——"阶段 2 本就要重排这些引用"——随改名轮未立项而失效，四个字面选择器自消费者改名起就**从未命中**，死码持续发布到 `dist`。账已按当年被否的 B1 收口：触屏抑制块的选择器改对齐 `n-*` 保值档位（零视觉变更——规则本就不匹配，只是让它们重新命中），`.dark .bg-gray-800 textarea` 两处同源全死规则一并删除；并新增结构护栏钉住"抑制块不得再引用退役字面档位"（含反空转断言）。本记录的"待办保留"状态就此关闭。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ 35 ＋ 33 ＋ 32 ＋ 31 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 28 ＋ 24 ＋ 24 ＋ 23 ＋ **22** ＝ **1042** 处；剩余 **474 处 / 80 文件**，余下最大单片 `TaskFiltersPanel.tsx` 22。

#### 0-E3c：`TaskFiltersPanel.tsx` 22 → 0（热点榜第二十五，已实施）

**范围**：`src/modules/task-master/TaskFiltersPanel.tsx`。**22 处 / 9 个 token / 8 行**——族 `gray` 19 ＋ `white` 3；工具类 `bg` 8 ／ `text` 8 ／ `border` 6；**零透明度**；档位 `gray-50/300/400/600/700/800` ＋ `white`（共 7 档），变体仅 `dark:`。**无动态色构造、无轴限定形态**。同文件品牌色（`text-blue-600` / `hover:text-blue-700` / `dark:text-blue-400` / `dark:hover:text-blue-300`）未触碰。本片是 0-E2h 的 `TaskBoardToolbar.tsx` 的下游组件（由后者渲染），3 个 `<select>` 复用**同一段** `w-full rounded-md border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800`，是 22 处仅落 8 行的原因。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 7 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **7 / 7**，无缺失。

**手法**：与 0-E2g…0-E3b 相同（扫描器为唯一事实源，`scanner hits: 22  exempt: 0  migratable: 22  rewrites: 22`；反向还原后与备份 `diff` 字节级相同）。token 含前缀包含关系（`bg-gray-50` 与 `text-gray-600` 等互为不同字面但同族；`dark:border-gray-600` ⊃ `border-gray-600`），按**长度降序**替换后逐条对照确认未串味。**本片是 0-E3b 之后、不带 `index.css` 选择器命中形态的常见片**，迁移后无新增"选择器级消费者"暴露。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **474 → 452（−22）**，文件数 **80 → 79**；`byFile` 该文件 `22 → 0` 是唯一文件级 delta；`byAtom` **9 条全为减、无一增**，合计恰 **−22**（`bg: gray-800` −4；`border: gray-300` −3、`border: gray-600` −3；`text: gray-300` −3、`text: gray-700` −3；`bg: white` −3；`bg: gray-50` −1、`text: gray-400` −1、`text: gray-600` −1），**0 个原子桶归零** |

**产物核对（通用脚本第 23 次复用，含 0-E3b 新增的 `.css` 分支）**：**ARTIFACT CHECK PASSED**。9 个派生字面在 `src`（`.tsx` ＋ `.css`）均仍有其他消费者（`bg-gray-50` 12、`bg-white` 14、`border-gray-300` 2、`dark:bg-gray-800` 17、`dark:border-gray-600` 2、`dark:text-gray-300` 6、`dark:text-gray-400` 34、`text-gray-600` 19、`text-gray-700` 7）——**0 独占拼写，最小 2 处**；`dist` 侧 9 个 `n-*` 令牌规则各 1 条，值链检查**真空转**（0 个带透明度 token），纯插入证明 `reversed ≡ backup: YES`。非空转对照：**不注入 PASSED、注入 `bg-gray-999` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ 35 ＋ 33 ＋ 32 ＋ 31 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 28 ＋ 24 ＋ 24 ＋ 23 ＋ 22 ＋ **22** ＝ **1064** 处；剩余 **452 处 / 79 文件**，余下最大单片 `OverwriteConfirmModal.tsx` 18（与 `StepReview.tsx` / `TaskQuickSortBar.tsx` 并列）。

#### 0-E3d：`TaskQuickSortBar.tsx` 18 → 0（热点榜第二十六，已实施）

**范围**：`src/modules/task-master/TaskQuickSortBar.tsx`。**18 处 / 6 个 token / 3 行**——**6 个 token 各恰好 ×3**，是三个排序按钮复用**同一段** className（`bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700`）的直接结果，18 处仅落 3 行，是"密度最高"形态的又一极端样本。纯 `gray` 单族、6 档（`gray-100/200/400/600/700/800`），变体含 `hover:` / `dark:hover:` / `dark:`；零 `border` / `white` / `black` / 透明度。**无动态色构造、无轴限定形态**。同文件品牌色（`bg-blue-100` / `dark:bg-blue-900` / `text-blue-700` / `dark:text-blue-300`，选中态）未触碰；本片由 0-E2h 的 `TaskBoardToolbar.tsx` 渲染（`TaskFiltersPanel.tsx` 亦同族）。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 6 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **6 / 6**，无缺失。

**手法**：与 0-E2g…0-E3c 相同（扫描器为唯一事实源，`scanner hits: 18  exempt: 0  migratable: 18  rewrites: 18`；反向还原后与备份 `diff` 字节级相同）。本片 6 个 token 之间无前缀包含关系，替换无串味风险，仍逐条对照确认。**不含 `index.css` 选择器命中形态**（`hover:bg-gray-200` 不在那三行选择器目标内）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **452 → 434（−18）**，文件数 **79 → 78**；`byFile` 该文件 `18 → 0` 是唯一文件级 delta；`byAtom` **6 条全为减、各 −3**，合计恰 **−18**（`bg: gray-100` −3、`bg: gray-200` −3、`bg: gray-700` −3、`bg: gray-800` −3、`text: gray-400` −3、`text: gray-600` −3），**0 个原子桶归零** |

**产物核对（通用脚本第 24 次复用，含 0-E3b 新增的 `.css` 分支）**：**ARTIFACT CHECK PASSED**。6 个派生字面中 5 个在 `src` 仍有其他消费者（`bg-gray-100` 7、`dark:bg-gray-800` 14、`dark:hover:bg-gray-700` 4、`dark:text-gray-400` 31、`text-gray-600` 16），**唯 `hover:bg-gray-200` 迁移后 `src=0`**——它是本片 3 处独占的字面，迁完即全仓零消费，Tailwind 也随之**不再生成**该规则（`dist=0`）。这与 0-E2z 的"2 字面归零但 0 桶归零"同源：`hover:bg-gray-200` 归零而 `bg: gray-200` 桶仍存 4（其他变体字面仍在），**再次印证桶粒度粗于字面粒度**。值链检查**真空转**（0 个带透明度 token），纯插入证明 `reversed ≡ backup: YES`。非空转对照：**不注入 PASSED、注入 `bg-gray-999` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ 35 ＋ 33 ＋ 32 ＋ 31 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 28 ＋ 24 ＋ 24 ＋ 23 ＋ 22 ＋ 22 ＋ **18** ＝ **1082** 处；剩余 **434 处 / 78 文件**，余下最大单片 `OverwriteConfirmModal.tsx` 18（与 `StepReview.tsx` 并列）。

#### 0-E3e：`OverwriteConfirmModal.tsx` 18 → 0（热点榜第二十七，已实施）

**范围**：`src/modules/prd-editor/modals/OverwriteConfirmModal.tsx`。**18 处 / 17 个 token / 6 行**——**18 处落在 17 个不同 token 上**（16 个各仅 1 次、唯 `bg-white` 2 次），是"几乎每个类名各出现一次"的模态框典型形态（与 0-E3d 的"6 token 各 ×3"互为另一极端）。跨三色 `gray` / `white` / `black`，档位 `gray-50/200/300/400/600/700/800` ＋ `white` ＋ `black`（共 9 档），变体含 `dark:` / `hover:` / `dark:hover:`。**无动态色构造、无轴限定形态**。同文件语义状态色（`bg-yellow-100` / `text-yellow-600` 等警示样式）未触碰。**含模态遮罩 `bg-black/50`**（与 0-E2k / 0-E2q / 0-E2t 同类）。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 9 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **9 / 9**，无缺失。

**手法**：与 0-E2g…0-E3d 相同（扫描器为唯一事实源，`scanner hits: 18  exempt: 0  migratable: 18  rewrites: 18`；反向还原后与备份 `diff` 字节级相同）。token 含前缀包含关系（`bg-black` ⊂ `bg-black/50`），按**长度降序**替换后逐条对照确认未串味。**注意 `hover:bg-gray-50` 属 `index.css` 选择器目标三行之一**（见 0-E3b 的 B3 决策）——本片迁后该字面在 `src` 仍有 2 个消费者，规则未整体失效，但本片这 1 处已改用 `hover:bg-n-gray-50`、不再被那三行选择器命中，属 B3 记账范围内的既有差异，本片不处理。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **434 → 416（−18）**，文件数 **78 → 77**；`byFile` 该文件 `18 → 0` 是唯一文件级 delta；`byAtom` **16 条全为减、无一增**，合计恰 **−18**（`bg: white` −2、`text: white` −2；`bg: black`、`bg: gray-50`、`bg: gray-600`、`bg: gray-700`、`bg: gray-800`、`border: gray-200`、`border: gray-300`、`border: gray-600`、`border: gray-700`、`text: gray-300`、`text: gray-400`、`text: gray-600`、`text: gray-700`、`text: gray-900` 各 −1），**0 个原子桶归零**（`border: gray-300` 由 2 → **1**，进入临界） |

**产物核对（通用脚本第 25 次复用，含 0-E3b 新增的 `.css` 分支）**：**ARTIFACT CHECK PASSED**。17 个派生字面中 16 个在 `src` 仍有其他消费者（最小 `border-gray-300` 1、`dark:border-gray-600` 1），**唯 `dark:hover:bg-gray-600` 迁后 `src=0`**——由本片独占，迁完即全仓零消费，Tailwind 随之不再生成（`dist=0`），与 0-E2z / 0-E3d 同源：该字面归零而 `bg: gray-600` 桶仍存 4，**第三次印证桶粒度粗于字面粒度**。`hover:bg-gray-50` 两侧均 2（迁后仍有 2 个 src 消费者，含 `index.css` 那处选择器，`.css` 分支正确计入）。值链检查：`bg-n-black/50` → `.bg-n-black\/50{background-color:hsl(var(--n-black) / .5)}`，**50% 透明度实测到达 `--n-black`**（本片 1 个带透明度 token）；纯插入证明 `reversed ≡ backup: YES`。非空转对照：**不注入 PASSED、注入 `bg-gray-999` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ 35 ＋ 33 ＋ 32 ＋ 31 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 28 ＋ 24 ＋ 24 ＋ 23 ＋ 22 ＋ 22 ＋ 18 ＋ **18** ＝ **1100** 处；剩余 **416 处 / 77 文件**，余下最大单片 `StepReview.tsx` 18。

#### 0-E3f：`StepReview.tsx` 18 → 0（热点榜第二十八，已实施）

**范围**：`src/modules/project-creation-wizard/StepReview.tsx`。**18 处 / 8 个 token / 8 行**——族 `gray` ＋ `white`（无 `black`）；工具类 `text` 14 ／ `bg` 2 ／ `border` 2；档位 `gray-50/200/400/600/700/900` ＋ `white`（共 7 档），变体仅 `dark:`。**带透明度 1 处**（`dark:bg-gray-900/50`）。**无动态色构造、无轴限定形态**。同文件蓝色信息卡（`border-blue-200` / `bg-blue-50` / `dark:border-blue-800` / `dark:bg-blue-900/20` / `text-blue-800` / `dark:text-blue-200` 等）未触碰。**含 `index.css` 选择器目标外的普通 hover 形态**（本片无 `hover:` 变体）。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 7 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **7 / 7**，无缺失。

**手法**：与 0-E2g…0-E3e 相同（扫描器为唯一事实源，`scanner hits: 18  exempt: 0  migratable: 18  rewrites: 18`；反向还原后与备份 `diff` 字节级相同）。token 含前缀包含关系（`text-gray-600` 与 `text-gray-900` 同族不同档；`dark:bg-gray-900/50` ⊃ `bg-gray-900`），按**长度降序**替换后逐条对照确认未串味。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **416 → 398（−18）**，文件数 **77 → 76**；`byFile` 该文件 `18 → 0` 是唯一文件级 delta；`byAtom` **8 条全为减、无一增**，合计恰 **−18**（`text: gray-900` −4、`text: white` −4；`text: gray-400` −3、`text: gray-600` −3；`bg: gray-50` −1、`bg: gray-900` −1、`border: gray-200` −1、`border: gray-700` −1），**0 个原子桶归零** |

**产物核对（通用脚本第 26 次复用，含 0-E3b 新增的 `.css` 分支）**：**ARTIFACT CHECK PASSED**。8 个派生字面在 `src` 均仍有其他消费者（`bg-gray-50` 11、`border-gray-200` 17、`dark:border-gray-700` 15、`dark:text-gray-400` 27、`dark:text-white` 8、`text-gray-600` 12、`text-gray-900` 9、`dark:bg-gray-900/50` 1）——**0 独占拼写，最小 1 处**。值链检查：`dark:bg-n-gray-900/50` → `.dark\:bg-n-gray-900\/50:is(.dark *){background-color:hsl(var(--n-gray-900) / .5)}`，**50% 透明度实测到达 `--n-gray-900`**（本片 1 个带透明度 token）；纯插入证明 `reversed ≡ backup: YES`。非空转对照：**不注入 PASSED、注入 `bg-gray-999` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ 35 ＋ 33 ＋ 32 ＋ 31 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 28 ＋ 24 ＋ 24 ＋ 23 ＋ 22 ＋ 22 ＋ 18 ＋ 18 ＋ **18** ＝ **1118** 处；剩余 **398 处 / 76 文件**，余下最大单片 `SidebarProjectItem.tsx` 16（与 `taskKanban.ts` 并列）。

#### 0-E3g：`SidebarProjectItem.tsx` 16 → 0（热点榜第二十九，已实施）

**范围**：`src/modules/sidebar/SidebarProjectItem.tsx`。**16 处 / 12 个 token / 7 行**——族 `gray` ＋ `white`（无 `black`）；档位 `gray-200/400/500/600/800/900` ＋ `white`（共 7 档）；变体含 `hover:` / `dark:hover:` / `dark:`。**带透明度 2 处**（`bg-gray-500/10` 10%、`dark:bg-gray-900/30` 30%）。**`bg-gray-500` 一族在本片集中**（裸 `bg-gray-500`、`bg-gray-500/10`、`hover:bg-gray-500`、`dark:hover:bg-gray-500` 四种变体同现），是本片 token 多样性的主要来源。**无动态色构造、无轴限定形态**。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 7 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **7 / 7**，无缺失。

**手法**：与 0-E2g…0-E3f 相同（扫描器为唯一事实源，`scanner hits: 16  exempt: 0  migratable: 16  rewrites: 16`；反向还原后与备份 `diff` 字节级相同）。token 含多重前缀包含关系（`bg-gray-500` ⊂ `bg-gray-500/10`；`hover:bg-gray-500` ⊂ `dark:hover:bg-gray-500`），按**长度降序**替换后逐条对照确认未串味。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **398 → 382（−16）**，文件数 **76 → 75**；`byFile` 该文件 `16 → 0` 是唯一文件级 delta；`byAtom` **9 条全为减、无一增**，合计恰 **−16**（`bg: gray-500` −4、`text: white` −4；`bg: gray-600` −2；`bg: gray-400` −1、`bg: gray-900` −1、`border: gray-200` −1、`border: gray-800` −1、`text: gray-400` −1、`text: gray-600` −1），**其中 2 个原子桶归零**：`bg: gray-400`（1 → 0）、`border: gray-800`（1 → 0） |

**产物核对（通用脚本第 27 次复用，含 0-E3b 新增的 `.css` 分支）**：**ARTIFACT CHECK PASSED**。12 个派生字面中 **7 个迁后 `src=0`**（`bg-gray-400`、`bg-gray-500`、`bg-gray-500/10`、`dark:bg-gray-900/30`、`dark:border-gray-800`、`dark:hover:bg-gray-500`、`hover:bg-gray-500`）——**本片是它们的唯一消费者**，迁完即全仓零消费，Tailwind 也随之不再生成（各 `dist=0`），与 0-E2z / 0-E3d / 0-E3e 的"桶粒度粗于字面"格局一致：**7 个字面归零、其中仅 2 个桶归零**（`bg: gray-400`、`border: gray-800` 桶恰好只剩这一个变体字面，故同步归零；其余 5 个与别处同档不同变体的字面共享桶）。存活侧最小 `dark:bg-gray-600` = 1。值链检查：`bg-n-gray-500/10` → `.bg-n-gray-500\/10{background-color:hsl(var(--n-gray-500) / .1)}`、`dark:bg-n-gray-900/30` → `.dark\:bg-n-gray-900\/30:is(.dark *){background-color:hsl(var(--n-gray-900) / .3)}`，**10% 与 30% 两处透明度均实测到达 `--n-*`**；纯插入证明 `reversed ≡ backup: YES`。非空转对照：**不注入 PASSED、注入 `bg-gray-999` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ 35 ＋ 33 ＋ 32 ＋ 31 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 28 ＋ 24 ＋ 24 ＋ 23 ＋ 22 ＋ 22 ＋ 18 ＋ 18 ＋ 18 ＋ **16** ＝ **1134** 处；剩余 **382 处 / 75 文件**，余下最大单片 `taskKanban.ts` 16。

#### 0-E3h：`taskKanban.ts` 16 → 0（热点榜第三十，已实施）

**范围**：`src/modules/task-master/utils/taskKanban.ts`（纯 `.ts` 工具模块，非 TSX）。**16 处 / 16 个 token / 4 行**——族 `slate` 8 ＋ `gray` 8；档位 `slate-50/100/200/700/800/900` ＋ `gray-50/100/200/700/800/900`；变体 `dark:` 与裸类。**带透明度 2 处**（`dark:bg-slate-900/50`、`dark:bg-gray-900/50`，均 50%）。**该文件是 `KANBAN_COLUMN_CONFIG` 的六列语义色配置表**：pending=`slate`、cancelled=`gray`（中性，本片迁），in-progress=`blue`、done=`emerald`、blocked=`red`、deferred=`amber`（语义彩色，**非本线范围、未触碰**）——**同一数据结构里中性色与语义色交错，是本片独有的样本**。16 处落在 `color` 与 `headerColor` 两串，每串 4 个 token，slate 列与 gray 列复用同一形状。**无动态色构造、无轴限定形态**。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 12 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **12 / 12**，无缺失。

**手法**：与 0-E2g…0-E3g 相同（扫描器为唯一事实源，`scanner hits: 16  exempt: 0  migratable: 16  rewrites: 16`；反向还原后与备份 `diff` 字节级相同）。**16 个 token 各恰好 ×1**；脚本核对确认本文件 16 个 token **两两互不为子串**（不存在 `bg-slate-50` / `bg-slate-500` 一类的包含对，子串对计数为 0），故按**长度降序**替换后无需担心串味——仍逐条对照确认（含斜杠的两处透明度 token 最长，先替换）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **382 → 366（−16）**，文件数 **75 → 74**；`byFile` 该文件 `16 → 0` 且从表中消失，是唯一文件级 delta；`byAtom` **16 条全为减、无一增**，合计恰 **−16**（`bg: gray-800` −1、`bg: gray-900` −1、`bg: gray-100` −1、`bg: gray-50` −1、`bg: slate-100` −1、`bg: slate-50` −1、`bg: slate-800` −1、`bg: slate-900` −1、`border: gray-200` −1、`border: gray-700` −1、`border: slate-200` −1、`border: slate-700` −1、`text: gray-200` −1、`text: gray-800` −1、`text: slate-200` −1、`text: slate-800` −1），**其中 7 个原子桶归零**：`bg: slate-50`、`bg: slate-800`、`border: slate-200`、`border: slate-700`、`text: gray-800`、`text: slate-200`、`text: slate-800`（各 1 → 0） |

**产物核对（通用脚本第 28 次复用，含 0-E3b 新增的 `.css` 分支）**：**ARTIFACT CHECK PASSED**。16 个派生字面中 **9 个迁后 `src=0`**（`bg-slate-50`、`border-slate-200`、`dark:bg-slate-800`、`dark:bg-slate-900/50`、`dark:border-slate-700`、`dark:text-slate-200`、`text-slate-800`、`text-gray-800`、`dark:bg-gray-900/50`）——**本片是它们的唯一消费者**，迁完即全仓零消费、Tailwind 随之不再生成（各 `dist=0`）；**9 个字面归零、其中 7 个桶归零**（`dark:bg-slate-900/50` 与 `dark:bg-gray-900/50` 虽各自归零，但其桶内尚有别处的同档不同变体字面存活，故桶只减不归零——`bg: slate-900` 2→1、`bg: gray-900` 19→18），**再次印证"桶粒度粗于字面"**（0-E2z / 0-E3d / 0-E3e / 0-E3g 同一格局）。存活侧最小 `bg-slate-100` = 1。值链检查：`dark:bg-n-slate-900/50` → `.dark\:bg-n-slate-900\/50:is(.dark *){background-color:hsl(var(--n-slate-900) / .5)}`、`dark:bg-n-gray-900/50` → `.dark\:bg-n-gray-900\/50:is(.dark *){background-color:hsl(var(--n-gray-900) / .5)}`，**两处 50% 透明度均实测到达 `--n-*`**；纯插入证明 `reversed ≡ backup: YES`。非空转对照：**不注入 PASSED、注入 `bg-gray-123,text-slate-456` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ 35 ＋ 33 ＋ 32 ＋ 31 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 28 ＋ 24 ＋ 24 ＋ 23 ＋ 22 ＋ 22 ＋ 18 ＋ 18 ＋ 18 ＋ 16 ＋ **16** ＝ **1150** 处；剩余 **366 处 / 74 文件**，余下最大单片 `ImageViewer.tsx` / `ProjectCreationWizard.tsx` / `ShellHeader.tsx` / `TaskBoardContent.tsx` 四者并列 14。

#### 0-E3i：`ImageViewer.tsx` 14 → 0（热点榜第三十一，已实施）

**范围**：`src/modules/file-tree/ImageViewer.tsx`。**14 处 / 9 个 token / 7 行**——族 `gray` ＋ `white`（无 `black`）；档位 `gray-50/400/500/600/800/900` ＋ `white`；变体 `dark:` 与裸类。**14 处每处都是 light＋dark 成对**（行内结构固定）。**零透明度**（本片不含 `/xx` 形式 token）。**零 `border`**（`text` 9 ／ `bg` 4）。**该文件已含一处前片遗留令牌 `bg-n-black/50`**（模态遮罩，0-E2 系列遮罩片所留），本片未触碰。**无动态色构造、无轴限定形态**。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 7 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **7 / 7**，无缺失。

**手法**：与 0-E2g…0-E3h 相同（扫描器为唯一事实源，`scanner hits: 14  exempt: 0  migratable: 14  rewrites: 14`；正向重放证明下与备份逐字节一致）。**9 个 token**：`dark:text-gray-400` ×3、`dark:bg-gray-800` ×2、`text-gray-500` ×2、`bg-gray-50` ×2，余 5 个各 ×1。脚本核对确认本文件 9 个 token **两两互不为子串**。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **366 → 352（−14）**，文件数 **74 → 73**；`byFile` 该文件 `14 → 0` 且从表中消失，是唯一文件级 delta；`byAtom` **9 条全为减、无一增**，合计恰 **−14**（`text: gray-400` −3、`bg: gray-50` −2、`bg: gray-800` −2、`text: gray-500` −2、`bg: gray-900` −1、`bg: white` −1、`text: gray-600` −1、`text: gray-900` −1、`text: white` −1），**无桶归零**（9 个桶迁后均仍有剩余） |

**产物核对（通用脚本第 29 次复用，本次修正前提假设）**：**ARTIFACT CHECK PASSED**（修正后）。脚本第一次跑出 **FAILED**，根因**不是本片迁移有误，而是脚本的前提假设被打破**：脚本第 1 项证明为"把当前文件的 `-n-` 反向还原，应逐字节等于备份"，这隐含假设"被测文件迁移前不含 `n-*` 令牌"。本片文件携带前片遗留的 `bg-n-black/50`，反向还原会把这一处也还原成 `bg-black/50`，于是**永远无法等于备份**（0-E3b 是脚本**覆盖面**缺口，本条是脚本**前提假设**缺口）。修法：改为**正向重放**——从备份出发，把本片 token 的字面→令牌替换回放一遍，结果须逐字节等于当前文件；并用"还原后确实存在于备份中的字面"筛出本片字面（前片遗留令牌还原出的字面在备份中不存在，自动落选）。该证明**不弱于**原证明：它同样能抓"漏迁"（未替换的字面会存活）与"多插"（`n-n-` 会与期望不符），且不受前片遗留令牌干扰。**变异测试**：把某处 `bg-n-gray-50` 改回 `bg-gray-50`（漏迁）→ FAILED；改成 `bg-n-n-gray-50`（多插）→ FAILED；恢复后 PASSED。**回归**：用同法重跑 0-E3h（纯字面文件）仍 PASSED。9 个派生字面在 `src` 均仍有其他消费者（`dark:text-gray-400` 23、`text-gray-500` 15、`bg-white` 11、`dark:bg-gray-800` 10、`text-gray-600` 10、`bg-gray-50` 8、`text-gray-900` 8、`dark:text-white` 7、`dark:bg-gray-900` 4）——**0 独占拼写，最小 4 处**。值链检查：本片无透明度 token；脚本另核对文件内既有的 `bg-n-black/50` → `.bg-n-black\/50{background-color:hsl(var(--n-black) / .5)}` 仍在。非空转对照：**不注入 PASSED、注入 `bg-gray-123,text-slate-456` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ 35 ＋ 33 ＋ 32 ＋ 31 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 28 ＋ 24 ＋ 24 ＋ 23 ＋ 22 ＋ 22 ＋ 18 ＋ 18 ＋ 18 ＋ 16 ＋ 16 ＋ **14** ＝ **1164** 处；剩余 **352 处 / 73 文件**，余下最大单片 `ProjectCreationWizard.tsx` / `ShellHeader.tsx` / `TaskBoardContent.tsx` 三者并列 14。

#### 0-E3j：`ProjectCreationWizard.tsx` 14 → 0（热点榜第三十二，已实施）

**范围**：`src/modules/project-creation-wizard/ProjectCreationWizard.tsx`。**14 处 / 12 个 token / 5 行**——族 `gray` 12 ＋ `white` 1 ＋ `black` 1；档位 `black`、`gray-100/200/300/400/600/700/800/900`、`white`；变体含裸类 / `hover:` / `dark:` / `dark:hover:`。**带透明度 1 处**（`bg-black/50`，模态遮罩，50%）。**该文件是模态外壳**：第 135–137 行是全屏遮罩 ＋ 卡片容器 ＋ 头部（同一 `border-b border-n-gray-200 p-6 dark:border-n-gray-700` 串在容器与头部各复用一次，故 `border-gray-200` / `dark:border-gray-700` 各 ×2），并含**响应式 `sm:` 前缀**（全屏 → `sm:rounded-lg sm:border`）。**无前片遗留令牌、无动态色构造、无轴限定形态**。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 10 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **10 / 10**，无缺失。

**手法**：与 0-E2g…0-E3i 相同（扫描器为唯一事实源，`scanner hits: 14  exempt: 0  migratable: 14  rewrites: 14`；正向重放证明下与备份逐字节一致）。**12 个 token**：`border-gray-200` ×2、`dark:border-gray-700` ×2，余 10 个各 ×1。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **352 → 338（−14）**，文件数 **73 → 72**；`byFile` 该文件 `14 → 0` 且从表中消失，是唯一文件级 delta；`byAtom` **12 条全为减、无一增**，合计恰 **−14**（`border: gray-200` −2、`border: gray-700` −2；`bg: black` −1、`bg: gray-100` −1、`bg: gray-700` −1、`bg: gray-800` −1、`bg: white` −1、`text: gray-300` −1、`text: gray-400` −1、`text: gray-600` −1、`text: gray-900` −1、`text: white` −1），**无桶归零** |

**产物核对（通用脚本第 30 次复用，正向重放版）**：**ARTIFACT CHECK PASSED**。12 个派生字面在 `src` 均仍有其他消费者（`border-gray-200` 13、`text-gray-400` 13、`dark:border-gray-700` 12、`bg-white` 10、`hover:bg-gray-100` 10、`dark:bg-gray-800` 9、`text-gray-900` 7、`dark:text-white` 6、`dark:hover:bg-gray-700` 3、`dark:hover:text-gray-300` 3、`hover:text-gray-600` 3、`bg-black/50` 2）——**0 独占拼写，最小 2 处**。值链检查：`bg-n-black/50` → `.bg-n-black\/50{background-color:hsl(var(--n-black) / .5)}`，**50% 透明度实测到达 `--n-black`**（本片 1 个带透明度 token）。非空转对照：**不注入 PASSED、注入 `bg-gray-123,text-slate-456` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ 35 ＋ 33 ＋ 32 ＋ 31 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 28 ＋ 24 ＋ 24 ＋ 23 ＋ 22 ＋ 22 ＋ 18 ＋ 18 ＋ 18 ＋ 16 ＋ 16 ＋ 14 ＋ **14** ＝ **1178** 处；剩余 **338 处 / 72 文件**，余下最大单片 `ShellHeader.tsx` / `TaskBoardContent.tsx` 二者并列 14。

#### 0-E3k：`ShellHeader.tsx` 14 → 0（热点榜第三十三，已实施）

**范围**：`src/modules/shell/ShellHeader.tsx`。**14 处 / 9 个 token / 6 行**——族 `gray` 13 ＋ `white` 4；档位 `gray-100/400/500/600/700/800` ＋ `white`；变体含裸类 / `hover:` / `disabled:`。**带透明度 2 类**（`border-gray-600/80` 80%、`bg-gray-700/70` 70%，各 ×2）。**同一 className 串内语义彩色与中性色交错**：`border-orange-500/70 bg-orange-600/80 … focus:ring-orange-400/70`（`hover:`/`focus:` 态）与 `bg-red-600` / `hover:bg-blue-600/80` 等语义色**非本线范围、未触碰**。**文件含 3 处前片遗留令牌 `focus:ring-offset-n-gray-800`**（焦点环偏移，0-E2 系列片所留），本片未触碰——这是 0-E3i 修正后的**正向重放第二次复用**。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 7 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **7 / 7**，无缺失。

**手法**：与 0-E2g…0-E3j 相同（扫描器为唯一事实源，`scanner hits: 14  exempt: 0  migratable: 14  rewrites: 14`；正向重放证明下与备份逐字节一致）。**9 个 token**：`text-white` / `hover:text-white` / `border-gray-600/80` / `bg-gray-700/70` / `text-gray-100` 各 ×2，余 4 个各 ×1（前缀包含对 `text-white` ⊂ `hover:text-white` 按长度降序先替长项，逐条对照确认未串味）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **338 → 324（−14）**，文件数 **72 → 71**；`byFile` 该文件 `14 → 0` 且从表中消失，是唯一文件级 delta；`byAtom` **9 条全为减、无一增**，合计恰 **−14**（`text: white` −4、`bg: gray-700` −2、`border: gray-600` −2、`text: gray-100` −2、`bg: gray-800` −1、`border: gray-700` −1、`text: gray-400` −1、`text: gray-500` −1），**无桶归零** |

**产物核对（通用脚本第 31 次复用，正向重放版）**：**ARTIFACT CHECK PASSED**。文件共 17 个中性 token（含 3 处遗留令牌），正向重放筛出**本片 9 个派生字面**、遗留令牌自动落选。**3 个字面迁后 `src=0`**（`bg-gray-700/70`、`border-gray-600/80`、`disabled:text-gray-500`）——本片是它们的唯一消费者，迁完即全仓零消费、Tailwind 随之不再生成（各 `dist=0`）；**3 个字面归零、其中 0 个桶归零**（`bg: gray-700` 11→9、`border: gray-600` 5→3、`text: gray-500` 23→22，同桶另有别变体字面存活），**再次印证"桶粒度粗于字面"**。存活侧最小 `border-gray-700` = 1。值链检查：`border-n-gray-600/80` → `.border-n-gray-600\/80{border-color:hsl(var(--n-gray-600) / .8)}`、`bg-n-gray-700/70` → `.bg-n-gray-700\/70{background-color:hsl(var(--n-gray-700) / .7)}`，**80% 与 70% 两处透明度均实测到达 `--n-*`**。非空转对照：**不注入 PASSED、注入 `bg-gray-123,text-slate-456` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 60 ＋ 2 ＋ 84 ＋ 15 ＋ 72 ＋ 69 ＋ 60 ＋ 55 ＋ 52 ＋ 46 ＋ 46 ＋ 41 ＋ 38 ＋ 35 ＋ 33 ＋ 32 ＋ 31 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 30 ＋ 28 ＋ 24 ＋ 24 ＋ 23 ＋ 22 ＋ 22 ＋ 18 ＋ 18 ＋ 18 ＋ 16 ＋ 16 ＋ 14 ＋ 14 ＋ **14** ＝ **1192** 处；剩余 **324 处 / 71 文件**，余下最大单片 `TaskBoardContent.tsx` 14。

#### 0-E3l：`TaskBoardContent.tsx` 14 → 0（热点榜第三十四，已实施）

**范围**：`src/modules/task-master/TaskBoardContent.tsx`。**14 处 / 10 个 token / 7 行**——族 `gray` 12 ＋ `white` 1 ＋ `black` 1；档位 `gray-200 / 300 / 400 / 500 / 600 / 700` ＋ `white` / `black`；变体含裸类 / `dark:`。**带透明度 2 类**（`bg-white/60` 60%、`dark:bg-black/20` 20%）。属看板**"暂无任务"空态**（`text-gray-400` 提示 ＋ `bg-gray-200` / `bg-gray-300` 两级同心圆占位 ＋ `text-gray-500` / `text-gray-400` 双行文案）与**卡片计数徽标**（`bg-white/60 dark:bg-black/20`）。无 `border` 工具类。**文件不含前片遗留令牌**（`scanScaleTokenAtoms` 报 0）。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 8 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **8 / 8**，无缺失。

**手法**：与 0-E2g…0-E3k 相同（扫描器为唯一事实源，`scanner hits: 14  exempt: 0  migratable: 14  rewrites: 14`；正向重放证明下与备份逐字节一致）。**10 个 token**：`text-gray-400` / `dark:text-gray-500` / `text-gray-500` / `dark:text-gray-400` 各 ×2，余 6 个（`bg-white/60` / `dark:bg-black/20` / `bg-gray-200` / `dark:bg-gray-700` / `bg-gray-300` / `dark:bg-gray-600`）各 ×1（前缀包含对按长度降序先替长项，逐条对照确认未串味）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **324 → 310（−14）**，文件数 **71 → 70**；`byFile` 该文件 `14 → 0` 且从表中消失，是唯一文件级 delta；`byAtom` **8 条全为减、无一增**，合计恰 **−14**（`text: gray-400` −4、`text: gray-500` −4、`bg: black` −1、`bg: gray-200` −1、`bg: gray-300` −1、`bg: gray-600` −1、`bg: gray-700` −1、`bg: white` −1），**1 桶归零**（`bg: gray-300` 1→0） |

**产物核对（通用脚本第 32 次复用，正向重放版）**：**ARTIFACT CHECK PASSED**。文件共 **14 个中性 token**（本片全部为新迁移，无遗留令牌），正向重放筛出**10 个派生字面**。**4 个字面迁后 `src=0`**（`bg-gray-300`、`bg-white/60`、`dark:bg-black/20`、`dark:bg-gray-600`）——本片是它们的唯一消费者，迁完即全仓零消费、Tailwind 随之不再生成（各 `dist=0`）；**4 个字面归零、其中 1 个桶归零**（`bg: gray-300`；`bg: gray-600` / `bg: white` / `bg: black` 同桶另有别变体字面存活）——**再次印证"桶粒度粗于字面"，本次方向为字面多、桶少**。存活侧最小 `bg-gray-200` = 3、`dark:bg-gray-700` = 4。值链检查：`bg-n-white/60` → `.bg-n-white\/60{background-color:hsl(var(--n-white) / .6)}`、`dark:bg-n-black/20` → `.dark\:bg-n-black\/20:is(.dark *){background-color:hsl(var(--n-black) / .2)}`，**60% 与 20% 两处透明度均实测到达 `--n-*`**。非空转对照：**不注入 PASSED、注入 `bg-gray-123,text-slate-456` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 1192 ＋ **14** ＝ **1206** 处；剩余 **310 处 / 70 文件**，余下最大单片 `ToolDiffViewer.tsx` / `UserMessageStickyHeader.tsx` / `MarkdownPreview.tsx` 三者并列 12。

#### 0-E3m：`ToolDiffViewer.tsx` 12 → 0（热点榜第三十五，已实施）

**范围**：`src/modules/chat/tools/ToolDiffViewer.tsx`。**12 处 / 9 个 token / 4 行**——族纯 `gray` 12；档位 `gray-50 / 100 / 200 / 500 / 600 / 700 / 800`；工具类 `text` 4 ／ `border` 4 ／ `bg` 4；变体含裸类 / `dark:`。**带透明度 4 类 / 6 处**（`border-gray-200/60` ×2、`dark:border-gray-700/50` ×2、`bg-gray-50/80` ×1、`dark:bg-gray-800/40` ×1）。属工具 diff 视图的头部条（`border-gray-200/60 dark:border-gray-700/50` ＋ `bg-gray-50/80 dark:bg-gray-800/40`）与状态/文本串。**文件不含前片遗留令牌**（`scanScaleTokenAtoms` 报 0）。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 7 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **7 / 7**，无缺失。

**手法**：与 0-E2g…0-E3l 相同（扫描器为唯一事实源，`scanner hits: 12  exempt: 0  migratable: 12  rewrites: 12`；正向重放证明下与备份逐字节一致）。**9 个 token**：`dark:border-gray-700/50` / `dark:text-gray-400` / `border-gray-200/60` 各 ×2，余 6 个（`dark:bg-gray-800` / `dark:bg-gray-800/40` / `text-gray-500` / `bg-gray-50/80` / `text-gray-600` / `bg-gray-100`）各 ×1（前缀包含对按长度降序先替长项，逐条对照确认未串味；`dark:bg-gray-800` ⊂ `dark:bg-gray-800/40` 一类的斜杠后缀尤需先长后短）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **310 → 298（−12）**，文件数 **70 → 69**；`byFile` 该文件 `12 → 0` 且从表中消失，是唯一文件级 delta；`byAtom` **8 条全为减、无一增**，合计恰 **−12**（`bg: gray-800` −2、`border: gray-200` −2、`border: gray-700` −2、`text: gray-400` −2、`bg: gray-100` −1、`bg: gray-50` −1、`text: gray-500` −1、`text: gray-600` −1），**无桶归零** |

**产物核对（通用脚本第 33 次复用，正向重放版）**：**ARTIFACT CHECK PASSED**。文件共 **12 个中性 token**（本片全部为新迁移，无遗留令牌），正向重放筛出**9 个派生字面**。**3 个字面迁后 `src=0`**（`bg-gray-50/80`、`border-gray-200/60`、`dark:bg-gray-800/40`）——本片是它们的唯一消费者，迁完即全仓零消费、Tailwind 随之不再生成（各 `dist=0`）；**3 个字面归零、其中 0 个桶归零**（`bg: gray-50`、`border: gray-200`、`bg: gray-800` 同桶另有别变体字面存活），**再次印证"桶粒度粗于字面"**。存活侧最小 `dark:border-gray-700/50` src = 1（仅本片外 1 处消费者）。值链检查：`border-n-gray-200/60` → `hsl(var(--n-gray-200) / .6)`、`dark:border-n-gray-700/50` → `.5`、`bg-n-gray-50/80` → `.8`、`dark:bg-n-gray-800/40` → `.4`，**4 类透明度 6 处均实测到达 `--n-*`**。非空转对照：**不注入 PASSED、注入 `bg-gray-123,text-slate-456` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 1206 ＋ **12** ＝ **1218** 处；剩余 **298 处 / 69 文件**，余下最大单片 `MarkdownPreview.tsx` / `UserMessageStickyHeader.tsx` 二者并列 12。

#### 0-E3n：`MarkdownPreview.tsx` 12 → 0（热点榜第三十六，已实施）

**范围**：`src/modules/code-editor/markdown/MarkdownPreview.tsx`。**12 处 / 8 个 token / 5 行**——族纯 `gray` 12；档位 `gray-50 / 200 / 300 / 400 / 600 / 700 / 800`；工具类 `border` 8 ／ `text` 2 ／ `bg` 2；变体含裸类 / `dark:`。**零透明度**。属 markdown 渲染器的 element 映射：引用块（`border-l-4 border-gray-300 … dark:border-gray-600`）、表格（`border-gray-200 dark:border-gray-700`）、表头 `thead`（`bg-gray-50 dark:bg-gray-800`）、`th` / `td`。**文件不含前片遗留令牌**（`scanScaleTokenAtoms` 报 0）。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 7 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **7 / 7**，无缺失。

**手法**：与 0-E2g…0-E3m 相同（扫描器为唯一事实源，`scanner hits: 12  exempt: 0  migratable: 12  rewrites: 12`；正向重放证明下与备份逐字节一致）。**8 个 token**：`dark:border-gray-700` / `border-gray-200` 各 ×3，余 6 个（`border-gray-300` / `text-gray-600` / `dark:border-gray-600` / `dark:text-gray-400` / `bg-gray-50` / `dark:bg-gray-800`）各 ×1（前缀包含对按长度降序先替长项，逐条对照确认未串味）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **298 → 286（−12）**，文件数 **69 → 68**；`byFile` 该文件 `12 → 0` 且从表中消失，是唯一文件级 delta；`byAtom` **8 条全为减、无一增**，合计恰 **−12**（`border: gray-200` −3、`border: gray-700` −3、`bg: gray-50` −1、`bg: gray-800` −1、`border: gray-300` −1、`border: gray-600` −1、`text: gray-400` −1、`text: gray-600` −1），**1 桶归零**（`border: gray-300` 1→0） |

**产物核对（通用脚本第 34 次复用，正向重放版）**：**ARTIFACT CHECK PASSED**。文件共 **12 个中性 token**（本片全部为新迁移，无遗留令牌），正向重放筛出**8 个派生字面**。**2 个字面迁后 `src=0`**（`border-gray-300`、`dark:border-gray-600`）——本片是它们的唯一消费者，迁完即全仓零消费、Tailwind 随之不再生成（各 `dist=0`）；**2 个字面归零、其中 1 个桶归零**（`border: gray-300`；`border: gray-600` 同桶另有别变体字面存活 2 处），**再次印证"桶粒度粗于字面"**。存活侧最小 `bg-gray-50` = 7、`dark:bg-gray-800` = 7。值链检查：**本片 0 个带透明度 token**，脚本输出 `(transparency-bearing tokens: 0)`。非空转对照：**不注入 PASSED、注入 `bg-gray-123,text-slate-456` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 1218 ＋ **12** ＝ **1230** 处；剩余 **286 处 / 68 文件**，余下最大单片 `UserMessageStickyHeader.tsx` 12。

#### 0-E3o：`UserMessageStickyHeader.tsx` 12 → 0（热点榜第三十七，已实施）

**范围**：`src/modules/chat/transcript/UserMessageStickyHeader.tsx`。**12 处 / 10 个 token / 4 行**——族 `gray` 11 ＋ `white` 1；档位 `gray-100 / 200 / 400 / 500 / 700 / 800` ＋ `white`；工具类 `text` 6 ／ `bg` 4 ／ `border` 2；变体含裸类 / `hover:` / `dark:hover:`。**带透明度 2 类 / 2 处**（`bg-white/95`、`dark:bg-gray-800/95`，均 95%）。属用户消息"吸附顶栏"提示条：外壳串（`border-gray-200 bg-white/95 … hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800/95 dark:hover:bg-gray-800`）＋ 两处图标 ＋ 一处文本。**文件不含前片遗留令牌**（`scanScaleTokenAtoms` 报 0）。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 7 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **7 / 7**，无缺失。

**手法**：与 0-E2g…0-E3n 相同（扫描器为唯一事实源，`scanner hits: 12  exempt: 0  migratable: 12  rewrites: 12`；正向重放证明下与备份逐字节一致）。**10 个 token**：`text-gray-400` / `dark:text-gray-500` 各 ×2，余 8 个（`border-gray-200` / `bg-white/95` / `hover:bg-gray-100` / `dark:border-gray-700` / `dark:bg-gray-800/95` / `dark:hover:bg-gray-800` / `text-gray-700` / `dark:text-gray-200`）各 ×1（前缀包含对按长度降序先替长项，逐条对照确认未串味；`dark:bg-gray-800/95` 与 `dark:hover:bg-gray-800` 分属不同变体链，未串味）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **286 → 274（−12）**，文件数 **68 → 67**；`byFile` 该文件 `12 → 0` 且从表中消失，是唯一文件级 delta；`byAtom` **9 条全为减、无一增**，合计恰 **−12**（`bg: gray-800` −2、`text: gray-400` −2、`text: gray-500` −2、`bg: gray-100` −1、`bg: white` −1、`border: gray-200` −1、`border: gray-700` −1、`text: gray-200` −1、`text: gray-700` −1），**无桶归零** |

**产物核对（通用脚本第 35 次复用，正向重放版）**：**ARTIFACT CHECK PASSED**。文件共 **12 个中性 token**（本片全部为新迁移，无遗留令牌），正向重放筛出**10 个派生字面**。**2 个字面迁后 `src=0`**（`bg-white/95`、`dark:bg-gray-800/95`）——本片是它们的唯一消费者，迁完即全仓零消费、Tailwind 随之不再生成（各 `dist=0`）；**2 个字面归零、其中 0 个桶归零**（`bg: white`、`bg: gray-800` 同桶另有别变体字面存活），**再次印证"桶粒度粗于字面"**。存活侧最小 `dark:hover:bg-gray-800` src = 1、`dark:text-gray-200` src = 1。值链检查：`bg-n-white/95` → `.bg-n-white\/95{background-color:hsl(var(--n-white) / .95)}`、`dark:bg-n-gray-800/95` → `.dark\:bg-n-gray-800\/95:is(.dark *){background-color:hsl(var(--n-gray-800) / .95)}`，**两处 95% 透明度均实测到达 `--n-*`**。非空转对照：**不注入 PASSED、注入 `bg-gray-123,text-slate-456` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 1230 ＋ **12** ＝ **1242** 处；剩余 **274 处 / 67 文件**，余下最大单片 `TerminalShortcutsPanel.tsx` / `TextContent.tsx` / `BrowserUsePanel.tsx` 三者并列 11。

#### 0-E3p：`TerminalShortcutsPanel.tsx` 11 → 0（热点榜第三十八，已实施）

**范围**：`src/modules/shell/TerminalShortcutsPanel.tsx`。**11 处 / 7 个 token / 4 行**——族 `gray` 8 ＋ `white` 3；档位 `gray-100 / 600 / 700 / 900` ＋ `white`；工具类 `text` 5 ／ `bg` 3 ／ `border` 3；变体含裸类 / `active:`。**带透明度 2 类 / 2 处**（`border-gray-700/80` 80%、`bg-gray-900/95` 95%）。属终端快捷键面板的按钮样式串（两行复用风格串 ＋ 一行蓝底主按钮 ＋ 一行外壳）。**同一 className 串内语义彩色 `blue-500` / `blue-600` 未触碰**。**文件不含前片遗留令牌**（`scanScaleTokenAtoms` 报 0）。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 5 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **5 / 5**，无缺失。

**手法**：与 0-E2g…0-E3o 相同（扫描器为唯一事实源，`scanner hits: 11  exempt: 0  migratable: 11  rewrites: 11`；正向重放证明下与备份逐字节一致）。**7 个 token**：`active:text-white` / `border-gray-600` / `bg-gray-700` / `text-gray-100` 各 ×2，余 3 个（`text-white` / `border-gray-700/80` / `bg-gray-900/95`）各 ×1（前缀包含对 `text-white` ⊂ `active:text-white` 按长度降序先替长项，逐条对照确认未串味）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **274 → 263（−11）**，文件数 **67 → 66**；`byFile` 该文件 `11 → 0` 且从表中消失，是唯一文件级 delta；`byAtom` **6 条全为减、无一增**，合计恰 **−11**（`text: white` −3、`bg: gray-700` −2、`border: gray-600` −2、`text: gray-100` −2、`bg: gray-900` −1、`border: gray-700` −1），**1 桶归零**（`border: gray-600` 2→0） |

**产物核对（通用脚本第 36 次复用，正向重放版）**：**ARTIFACT CHECK PASSED**。文件共 **11 个中性 token**（本片全部为新迁移，无遗留令牌），正向重放筛出**7 个派生字面**。**3 个字面迁后 `src=0`**（`active:text-white`、`bg-gray-900/95`、`border-gray-600`）——本片是它们的唯一消费者，迁完即全仓零消费、Tailwind 随之不再生成（各 `dist=0`）；**3 个字面归零、其中 1 个桶归零**（`border: gray-600`；`text: white` / `bg: gray-900` 同桶另有别变体字面存活），**再次印证"桶粒度粗于字面"**。存活侧最小 `bg-gray-700` src = 1、`border-gray-700/80` src = 1。值链检查：`border-n-gray-700/80` → `.border-n-gray-700\/80{border-color:hsl(var(--n-gray-700) / .8)}`、`bg-n-gray-900/95` → `.bg-n-gray-900\/95{background-color:hsl(var(--n-gray-900) / .95)}`，**80% 与 95% 两处透明度均实测到达 `--n-*`**。非空转对照：**不注入 PASSED、注入 `bg-gray-123,text-slate-456` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 1242 ＋ **11** ＝ **1253** 处；剩余 **263 处 / 66 文件**，余下最大单片 `TextContent.tsx` / `BrowserUsePanel.tsx` 二者并列 11。

#### 0-E3q：`TextContent.tsx` 11 → 0（热点榜第三十九，已实施）

**范围**：`src/modules/chat/tools/ContentRenderers/TextContent.tsx`。**11 处 / 9 个 token / 3 行**——族纯 `gray` 11；档位 `gray-50 / 100 / 200 / 300 / 700 / 800 / 900 / 950`；工具类 `text` 5 ／ `bg` 4 ／ `border` 2；变体含裸类 / `dark:`（4 个）。**带透明度 3 类 / 3 处，均为 50%**（`border-gray-200/50`、`dark:border-gray-700/50`、`dark:bg-gray-800/50`）。属工具输出内容的文本/代码块渲染器——两行 `<pre>` 代码块串（一行深色底、一行浅色底）＋ 一行纯文本 `<div>`。**文件不含前片遗留令牌**（`scanScaleTokenAtoms` 报 0）。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 8 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **8 / 8**，无缺失。

**手法**：与 0-E2g…0-E3p 相同（扫描器为唯一事实源，`scanner hits: 11  exempt: 0  migratable: 11  rewrites: 11`；正向重放证明下与备份逐字节一致）。**9 个 token**：`text-gray-700` / `dark:text-gray-300` 各 ×2，余 7 个各 ×1（`dark:border-gray-700/50` / `dark:bg-gray-800/50` / `border-gray-200/50` / `dark:bg-gray-950` / `text-gray-100` / `bg-gray-900` / `bg-gray-50`；token 间存在前缀包含对，按长度降序替换后逐条对照确认未串味）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **263 → 252（−11）**，文件数 **66 → 65**；`byFile` 该文件 `11 → 0` 且从表中消失，是唯一文件级 delta；`byAtom` **9 条全为减、无一增**，合计恰 **−11**（`text: gray-700` −2、`text: gray-300` −2、`bg: gray-50` −1、`bg: gray-800` −1、`bg: gray-900` −1、`bg: gray-950` −1、`border: gray-200` −1、`border: gray-700` −1、`text: gray-100` −1），**0 桶归零** |

**产物核对（通用脚本第 37 次复用，正向重放版）**：**ARTIFACT CHECK PASSED**。文件共 **11 个中性 token**（本片全部为新迁移，无遗留令牌），正向重放筛出**9 个派生字面**。**4 个字面迁后 `src=0`**（`dark:bg-gray-950`、`dark:border-gray-700/50`、`dark:bg-gray-800/50`、`border-gray-200/50`）——本片是它们的唯一消费者，迁完即全仓零消费、Tailwind 随之不再生成（各 `dist=0`）；**4 字面归零而 0 桶归零**（`gray-950` 桶 4→3、其余桶均另有别变体字面存活），**再次印证"桶粒度粗于字面"**。存活侧最小 `bg-gray-900` src = 4、`text-gray-700` src = 3。值链检查：`border-n-gray-200/50` → `.border-n-gray-200\/50{border-color:hsl(var(--n-gray-200) / .5)}`、`dark:border-n-gray-700/50` → `.dark\:border-n-gray-700\/50:is(.dark *){border-color:hsl(var(--n-gray-700) / .5)}`、`dark:bg-n-gray-800/50` → `.dark\:bg-n-gray-800\/50:is(.dark *){background-color:hsl(var(--n-gray-800) / .5)}`，**三处 50% 透明度均实测到达 `--n-*`**。非空转对照：**不注入 PASSED、注入 `bg-gray-123,text-slate-456` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 1253 ＋ **11** ＝ **1264** 处；剩余 **252 处 / 65 文件**，余下最大单片 `BrowserUsePanel.tsx` 11。

#### 0-E3r：`BrowserUsePanel.tsx` 11 → 0（热点榜第四十，已实施）

**范围**：`src/modules/browser-use/BrowserUsePanel.tsx`。**11 处 / 10 个 token / 9 行**——族 `white` 5 ＋ `neutral` 4 ＋ `black` 2；档位 `white` / `black` / `neutral-100 / 400 / 500 / 950`；工具类 `text` 5 ／ `bg` 4 ／ `border` 2；变体**全为裸类**（本片零伪类、零 `dark:`）。**带透明度 4 类 / 5 处**（`border-white/90` 90%、`border-white/10` 10% ×2、`bg-black/90` 90%、`text-white/80` 80%）。属浏览器控制面板——插件空态提示、截图热点标记（十字准星）与全屏遮罩覆盖层。**文件不含前片遗留令牌**（`scanScaleTokenAtoms` 报 0）。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 6 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **6 / 6**，无缺失（含 `black` / `white` 两档）。

**手法**：与 0-E2g…0-E3q 相同（扫描器为唯一事实源，`scanner hits: 11  exempt: 0  migratable: 11  rewrites: 11`；正向重放证明下与备份逐字节一致）。**10 个 token**：`border-white/10` 各 ×2，余 9 个各 ×1（`text-neutral-500` / `text-neutral-100` / `text-neutral-400` / `border-white/90` / `bg-neutral-950` / `text-white/80` / `bg-black/90` / `bg-white` / `bg-black`；token 间存在前缀包含对，按长度降序替换后逐条对照确认未串味）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **252 → 241（−11）**，文件数 **65 → 64**；`byFile` 该文件 `11 → 0` 且从表中消失，是唯一文件级 delta；`byAtom` **8 条全为减、无一增**，合计恰 **−11**（`border: white` −3、`bg: black` −2、`bg: white` −1、`text: white` −1、`bg: neutral-950` −1、`text: neutral-100` −1、`text: neutral-400` −1、`text: neutral-500` −1），**4 桶归零**（`bg: neutral-950`、`text: neutral-100`、`text: neutral-400`、`text: neutral-500` 各 1→0） |

**产物核对（通用脚本第 38 次复用，正向重放版）**：**ARTIFACT CHECK PASSED**。文件共 **11 个中性 token**（本片全部为新迁移，无遗留令牌），正向重放筛出**10 个派生字面**。**8 个字面迁后 `src=0`**（`bg-black/90`、`bg-neutral-950`、`border-white/10`、`border-white/90`、`text-neutral-100`、`text-neutral-400`、`text-neutral-500`、`text-white/80`）——本片是它们的唯一消费者，迁完即全仓零消费、Tailwind 随之不再生成（各 `dist=0`）；**8 字面归零、其中 4 个桶归零**（`bg: neutral-950`、`text: neutral-100 / 400 / 500`；`border: white` 4→1、`bg: black` 19→17、`bg: white` 14→13、`text: white` 40→39 同桶另有别变体字面存活），**再次印证"桶粒度粗于字面"**。存活侧最小 `bg-black` src = 1、`bg-white` src = 9。值链检查：`border-n-white/90` → `.border-n-white\/90{border-color:hsl(var(--n-white) / .9)}`、`bg-n-black/90` → `.bg-n-black\/90{background-color:hsl(var(--n-black) / .9)}`、`border-n-white/10` → `.border-n-white\/10{border-color:hsl(var(--n-white) / .1)}`、`text-n-white/80` → `.text-n-white\/80{color:hsl(var(--n-white) / .8)}`，**五处透明度（4 类，90% / 10% ×2 / 90% / 80%）均实测到达 `--n-*`**。非空转对照：**不注入 PASSED、注入 `bg-gray-123,text-slate-456` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 1264 ＋ **11** ＝ **1275** 处；剩余 **241 处 / 64 文件**，余下最大单片 `QuickSettingsHandle.tsx` / `WorkspacePathField.tsx` 二者并列 10。

#### 0-E3s：`QuickSettingsHandle.tsx` 10 → 0（热点榜第四十一，已实施）

**范围**：`src/modules/quick-settings-panel/QuickSettingsHandle.tsx`。**10 处 / 8 个 token / 4 行**——族 `gray` 9 ＋ `white` 1；档位 `gray-100 / 200 / 400 / 600 / 700 / 800` ＋ `white`；工具类 `text` 4 ／ `bg` 4 ／ `border` 2；变体含裸类 / `hover:` / `dark:` / `dark:hover:`。**零透明度**。属快捷设置面板滑出把手——一行 `borderClass` 三元表达式、一行把外壳串（含 `hover:` / `dark:hover:` 悬停态）、两行方向图标（`ChevronRight` / `ChevronLeft`）。**文件不含前片遗留令牌**（`scanScaleTokenAtoms` 报 0）。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 7 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **7 / 7**，无缺失。

**手法**：与 0-E2g…0-E3r 相同（扫描器为唯一事实源，`scanner hits: 10  exempt: 0  migratable: 10  rewrites: 10`；正向重放证明下与备份逐字节一致）。**8 个 token**：`text-gray-600` / `dark:text-gray-400` 各 ×2，余 6 个各 ×1（`border-gray-200` / `dark:border-gray-700` / `bg-white` / `dark:bg-gray-800` / `hover:bg-gray-100` / `dark:hover:bg-gray-700`；前缀包含对按长度降序替换后逐条对照确认未串味）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **241 → 231（−10）**，文件数 **64 → 63**；`byFile` 该文件 `10 → 0` 且从表中消失，是唯一文件级 delta；`byAtom` **8 条全为减、无一增**，合计恰 **−10**（`text: gray-400` −2、`text: gray-600` −2、`bg: gray-100` −1、`bg: gray-700` −1、`bg: gray-800` −1、`bg: white` −1、`border: gray-200` −1、`border: gray-700` −1），**0 桶归零** |

**产物核对（通用脚本第 39 次复用，正向重放版）**：**ARTIFACT CHECK PASSED**。文件共 **10 个中性 token**（本片全部为新迁移，无遗留令牌），正向重放筛出**8 个派生字面**。**0 个字面迁后 `src=0`**——8 个字面在全仓均另有消费者（`bg-white` src = 8、`border-gray-200` src = 8、`hover:bg-gray-100` src = 8、`dark:text-gray-400` src = 16 等，最小 `dark:hover:bg-gray-700` src = 2），故本片**0 字面归零、0 桶归零**——这是与 0-E3q / 0-E3r（同量级但含独享字面）相反的形态：**本片所有字面都是仓库级共享写法**，迁完只减计数不改"是否还存在"。**零透明度 token**（`transparency-bearing tokens: 0`），无需值链透明度核对。非空转对照：**不注入 PASSED、注入 `bg-gray-123,text-slate-456` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 1275 ＋ **10** ＝ **1285** 处；剩余 **231 处 / 63 文件**，余下最大单片 `WorkspacePathField.tsx` 10。

#### 0-E3t：`WorkspacePathField.tsx` 10 → 0（热点榜第四十二，已实施）

**范围**：`src/modules/project-creation-wizard/WorkspacePathField.tsx`。**10 处 / 10 个 token / 4 行**——族 `gray` 9 ＋ `white` 1；档位 `gray-100 / 200 / 400 / 500 / 700 / 800 / 900` ＋ `white`；工具类 `text` 5 ／ `bg` 3 ／ `border` 2；变体含裸类 / `hover:` / `dark:` / `dark:hover:`。**零透明度**。属项目创建向导的工作区路径自动补全下拉——一行建议列表外壳串、一行单条建议项（含 `hover:` / `dark:hover:` 悬停态）、两行建议名称与路径（含 `dark:text-white`）。**文件不含前片遗留令牌**（`scanScaleTokenAtoms` 报 0）。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 8 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **8 / 8**，无缺失。

**手法**：与 0-E2g…0-E3s 相同（扫描器为唯一事实源，`scanner hits: 10  exempt: 0  migratable: 10  rewrites: 10`；正向重放证明下与备份逐字节一致）。**10 个 token 各 ×1**（`border-gray-200` / `bg-white` / `dark:border-gray-700` / `dark:bg-gray-800` / `hover:bg-gray-100` / `dark:hover:bg-gray-700` / `text-gray-900` / `dark:text-white` / `text-gray-500` / `dark:text-gray-400`；前缀包含对按长度降序替换后逐条对照确认未串味）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **231 → 221（−10）**，文件数 **63 → 62**；`byFile` 该文件 `10 → 0` 且从表中消失，是唯一文件级 delta；`byAtom` **10 条全为减、各 −1、无一增**，合计恰 **−10**（`text: gray-400 / gray-500 / gray-900 / white` 各 −1、`bg: gray-100 / gray-700 / gray-800 / white` 各 −1、`border: gray-200 / gray-700` 各 −1），**0 桶归零** |

**产物核对（通用脚本第 40 次复用，正向重放版）**：**ARTIFACT CHECK PASSED**。文件共 **10 个中性 token**（本片全部为新迁移，无遗留令牌），正向重放筛出**10 个派生字面**。**0 个字面迁后 `src=0`**——10 个字面在全仓均另有消费者（`dark:text-gray-400` src = 15、`text-gray-500` src = 11、`bg-white` src = 7 等，最小 `dark:hover:bg-gray-700` src = 1，其值由 0-E3s 迁移后的 2 降至本片的 1），故本片**0 字面归零、0 桶归零**——与 0-E3s 同属"仓库级共享写法"形态。**零透明度 token**（`transparency-bearing tokens: 0`），无需值链透明度核对。非空转对照：**不注入 PASSED、注入 `bg-gray-123,text-slate-456` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 1285 ＋ **10** ＝ **1295** 处；剩余 **221 处 / 62 文件**，余下最大单片 `ProviderLoginModal.tsx` / `WizardProgress.tsx` 二者并列 9。

#### 0-E3u：`ProviderLoginModal.tsx` 9 → 0（热点榜第四十三，已实施）

**范围**：`src/modules/provider-auth/ProviderLoginModal.tsx`。**9 处 / 9 个 token / 4 行**——族 `gray` 8 ＋ `white` 1；档位 `gray-200 / 300 / 400 / 600 / 700 / 800 / 900` ＋ `white`；工具类 `text` 5 ／ `bg` 2 ／ `border` 2；变体含裸类 / `hover:` / `dark:` / `dark:hover:`。**本片零透明度**。属供应商登录模态框——一行对话框外壳串（含 `max-md:` / `md:` 响应式）、一行标题栏、一行标题文字（`dark:text-white`）、一行关闭按钮（`hover:` / `dark:hover:`）。**文件含前片遗留令牌 `bg-n-black/50`（第 3 次撞上，本片未动）**——`scanScaleTokenAtoms` 报 10 token，其中 1 个为遗留遮罩令牌。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 8 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **8 / 8**，无缺失。

**手法**：与 0-E2g…0-E3t 相同（扫描器为唯一事实源，`scanner hits: 9  exempt: 0  migratable: 9  rewrites: 9`；**正向重放**证明下与备份逐字节一致——因文件含遗留令牌，反向还原不适用，见 0-E3i 的前提假设修正）。**9 个 token 各 ×1**（`bg-white` / `dark:bg-gray-800` / `border-gray-200` / `dark:border-gray-700` / `text-gray-900` / `dark:text-white` / `text-gray-400` / `hover:text-gray-600` / `dark:hover:text-gray-300`；前缀包含对按长度降序替换后逐条对照确认未串味）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **221 → 212（−9）**，文件数 **62 → 61**；`byFile` 该文件 `9 → 0` 且从表中消失，是唯一文件级 delta；`byAtom` **9 条全为减、各 −1、无一增**，合计恰 **−9**（`text: gray-300 / gray-400 / gray-600 / gray-900 / white` 各 −1、`bg: gray-800 / white` 各 −1、`border: gray-200 / gray-700` 各 −1），**0 桶归零** |

**产物核对（通用脚本第 41 次复用，正向重放版）**：**ARTIFACT CHECK PASSED**。文件共 **10 个中性 token**（9 个本片新迁移 ＋ 1 个前片遗留 `bg-n-black/50`）；正向重放以"还原后确实存在于备份中"筛出**9 个派生字面**，遗留令牌自动落选（`distinct literals derived: 9` ≠ token 总数 10，正是这一筛选在起作用）。**0 个字面迁后 `src=0`**——9 个字面全仓均另有消费者（`text-gray-400` src = 7、`bg-white` src = 6、`border-gray-200` src = 6 等，最小 `dark:hover:text-gray-300` / `hover:text-gray-600` src = 2），故本片**0 字面归零、0 桶归零**。**透明度清单仅 1 项且为遗留令牌**（`bg-n-black/50` → `.bg-n-black\/50{background-color:hsl(var(--n-black) / .5)}`），本片新增零透明度。非空转对照：**不注入 PASSED、注入 `bg-gray-123,text-slate-456` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 1295 ＋ **9** ＝ **1304** 处；剩余 **212 处 / 61 文件**，余下最大单片 `WizardProgress.tsx` 9。

#### 0-E3v：`WizardProgress.tsx` 9 → 0（热点榜第四十四，已实施）

**范围**：`src/modules/project-creation-wizard/WizardProgress.tsx`。**9 处 / 6 个 token / 5 行**——族 `gray` 7 ＋ `white` 2；档位 `gray-200 / 300 / 500 / 700` ＋ `white`；工具类 `text` 5 ／ `bg` 4；变体含裸类 / `dark:`。**零透明度**。属项目创建向导的步骤条——两处步骤圆点状态三元表达式（完成态绿底白字 / 当前态蓝底白字 / 未达态灰底灰字）＋ 一行步骤标签 ＋ 一行进度连接条状态三元。**同一 className 串内语义彩色 `bg-green-500` / `bg-blue-500` 未触碰**。**文件不含前片遗留令牌**（`scanScaleTokenAtoms` 报 0）。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 5 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **5 / 5**，无缺失。

**手法**：与 0-E2g…0-E3u 相同（扫描器为唯一事实源，`scanner hits: 9  exempt: 0  migratable: 9  rewrites: 9`；正向重放证明下与备份逐字节一致）。**6 个 token**：`text-white` / `bg-gray-200` / `dark:bg-gray-700` 各 ×2，余 3 个（`text-gray-500` / `text-gray-700` / `dark:text-gray-300`）各 ×1（前缀包含对按长度降序替换后逐条对照确认未串味）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **212 → 203（−9）**，文件数 **61 → 60**；`byFile` 该文件 `9 → 0` 且从表中消失，是唯一文件级 delta；`byAtom` **6 条全为减、无一增**，合计恰 **−9**（`bg: gray-200` −2、`bg: gray-700` −2、`text: white` −2、`text: gray-300` −1、`text: gray-500` −1、`text: gray-700` −1），**0 桶归零**（`bg: gray-200` 3→1、`bg: gray-700` 4→2 已逼近但未清零） |

**产物核对（通用脚本第 42 次复用，正向重放版）**：**ARTIFACT CHECK PASSED**。文件共 **9 个中性 token 出现（6 个不同 token）**（本片全部为新迁移，无遗留令牌），正向重放筛出**6 个派生字面**。**0 个字面迁后 `src=0`**——6 个字面在全仓均另有消费者（`text-white` src = 30、`text-gray-500` src = 10、`dark:bg-gray-700` / `dark:text-gray-300` / `text-gray-700` src = 2、`bg-gray-200` src = 1），故本片**0 字面归零、0 桶归零**。**零透明度 token**（`transparency-bearing tokens: 0`），无需值链透明度核对。非空转对照：**不注入 PASSED、注入 `bg-gray-123,text-slate-456` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 1304 ＋ **9** ＝ **1313** 处；剩余 **203 处 / 60 文件**，余下最大单片 `SidebarModals.tsx` / `StepConfiguration.tsx` / `PrdEditorFooter.tsx` / `ExecutionProcessSummary.tsx` / `ChatMessagesPane.tsx` 五者并列 8。

#### 0-E3w：`SidebarModals.tsx` 8 → 0（热点榜第四十五，已实施）

**范围**：`src/modules/sidebar/SidebarModals.tsx`。**8 处 / 2 个 token / 8 行**——族 `black` 4 ＋ `white` 4；工具类 `bg` 4 ／ `text` 4；变体**全为裸类**（本片零伪类、零 `dark:`）。**带透明度 1 类 / 4 处，均 60%**（`bg-black/60`）。属侧栏的四个模态框——每个模态各含一行全屏遮罩串（`bg-black/60` ＋ `backdrop-blur-sm`）与一行危险操作按钮（`bg-red-600 text-white hover:bg-red-700`）。**同一 className 串内语义红 `bg-red-600` / `hover:bg-red-700` 未触碰**。**文件不含前片遗留令牌**（`scanScaleTokenAtoms` 报 0）。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 2 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **2 / 2**，无缺失。

**手法**：与 0-E2g…0-E3v 相同（扫描器为唯一事实源，`scanner hits: 8  exempt: 0  migratable: 8  rewrites: 8`；正向重放证明下与备份逐字节一致）。**2 个 token 各 ×4**（`bg-black/60`、`text-white`；无前缀包含对，替换后逐条对照确认未串味）。本片是 token 数最少、而"处/行 = 1"（8 处落 8 行）的形态。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **203 → 195（−8）**，文件数 **60 → 59**；`byFile` 该文件 `8 → 0` 且从表中消失，是唯一文件级 delta；`byAtom` **2 条全为减、各 −4、无一增**（`bg: black` 17→13、`text: white` 35→31），合计恰 **−8**，**0 桶归零** |

**产物核对（通用脚本第 43 次复用，正向重放版）**：**ARTIFACT CHECK PASSED**。文件共 **8 个中性 token 出现（2 个不同 token）**（本片全部为新迁移，无遗留令牌），正向重放筛出**2 个派生字面**。**0 个字面迁后 `src=0`**——2 个字面在全仓均另有消费者（`text-white` src = 26、`bg-black/60` src = 5），故本片**0 字面归零、0 桶归零**。值链检查：`bg-n-black/60` → `.bg-n-black\/60{background-color:hsl(var(--n-black) / .6)}`，**四处 60% 透明度均实测到达 `--n-*`**（`transparency-bearing tokens: 4`，即 4 处出现）。非空转对照：**不注入 PASSED、注入 `bg-gray-123,text-slate-456` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 1313 ＋ **8** ＝ **1321** 处；剩余 **195 处 / 59 文件**（首次跌破 200），余下最大单片 `StepConfiguration.tsx` / `PrdEditorFooter.tsx` / `ExecutionProcessSummary.tsx` / `ChatMessagesPane.tsx` 四者并列 8。

#### 0-E3x：`ExecutionProcessSummary.tsx` 8 → 0（热点榜第四十六，已实施）

**范围**：`src/modules/chat/transcript/ExecutionProcessSummary.tsx`。**8 处 / 8 个 token / 2 行**——族 `gray` 7 ＋ `white` 1；档位 `gray-100 / 200 / 400 / 500 / 700 / 800 / 900` ＋ `white`；工具类 `text` 6 ／ `bg` 2；变体**四类各 2 处**（裸类 `text-gray-900` / `text-gray-500`、`hover:` `hover:bg-gray-100` / `hover:text-gray-700`、`dark:` `dark:text-white` / `dark:text-gray-400`、`dark:hover:` `dark:hover:bg-gray-800` / `dark:hover:text-gray-200`）。**零透明度**。属执行过程的折叠摘要——一行供应商标签（`text-sm font-medium text-gray-900 dark:text-white`）与一行折叠按钮串（6 个中性 token 连续排列，含 `ChevronRight` 图标与 `truncate` 截断标签；同串另含 `bg-background/95` 等语义间接写法及滚动吸顶三元，均未触碰）。**两行 className 串内均无语义彩色**。**文件不含前片遗留令牌**（迁移前 `scanScaleTokenAtoms` 报 0；迁移后报 8，全部为本片新增）。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 8 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **8 / 8**，无缺失。

**手法**：与 0-E2g…0-E3w 相同（扫描器为唯一事实源，`scanner hits: 8  exempt: 0  migratable: 8  rewrites: 8`；正向重放证明下与备份逐字节一致）。**8 个 token 各 ×1**（无前缀包含对，替换后逐条对照确认未串味）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **195 → 187（−8）**，文件数 **59 → 58**；`byFile` 该文件 `8 → 0` 且从表中消失，是唯一文件级 delta；`byAtom` **8 条全为减、各 −1、无一增**（`bg: gray-100` 8→7、`bg: gray-800` 7→6、`text: gray-200` 4→3、`text: gray-400` 22→21、`text: gray-500` 13→12、`text: gray-700` 3→2、`text: gray-900` 6→5、`text: white` 31→30），合计恰 **−8**，**0 桶归零**（8 个原子迁后均仍有别处消费者） |

**产物核对（通用脚本第 44 次复用，正向重放版）**：**ARTIFACT CHECK PASSED**。文件共 **8 个中性 token 出现（8 个不同 token）**（本片全部为新迁移，无遗留令牌），正向重放筛出**8 个派生字面**。**3 个字面迁后 `src=0`**——`hover:text-gray-700`、`dark:hover:bg-gray-800`、`dark:hover:text-gray-200` 三者在全仓（含 `.tsx` 与 `.css` 选择器口径）再无消费，`dist` 亦同步为 0；其余 5 字面在本文件外仍有消费者（`dark:text-gray-400` src = 14、`text-gray-500` src = 9、`hover:bg-gray-100` src = 6、`text-gray-900` src = 4、`dark:text-white` src = 3），`dist` 均 > 0。故本片**3 字面归零、0 桶归零**。值链检查：本片**零透明度 token**（`transparency-bearing tokens: 0`）。非空转对照：**不注入 PASSED、注入 `text-gray-999,bg-gray-123` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 1321 ＋ **8** ＝ **1329** 处；剩余 **187 处 / 58 文件**，余下最大单片 `StepConfiguration.tsx` / `PrdEditorFooter.tsx` / `ChatMessagesPane.tsx` 三者并列 8。

#### 0-E3y：`PrdEditorFooter.tsx` 8 → 0（热点榜第四十七，已实施）

**范围**：`src/modules/prd-editor/PrdEditorFooter.tsx`。**8 处 / 7 个 token / 3 行**——族**纯 `gray` 8**；档位 `gray-50 / 200 / 400 / 500 / 600 / 700 / 800`；工具类 `border` 2 ／ `bg` 2 ／ `text` 4；变体**裸类 4 ＋ `dark:` 4**（无伪类）。**零透明度**。属 PRD 编辑器页脚——一行外壳（`border-t` 上边框 ＋ 底色 ＋ `dark:` 成对）＋ 一行统计（`Lines/Characters/Words/Format`）＋ 一行快捷键提示。**三行 className 串内无语义彩色**（本文件全仓零语义彩色）。**文件不含前片遗留令牌**（迁移前 `scanScaleTokenAtoms` 报 0；迁移后报 8，全部为本片新增）。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 7 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **7 / 7**，无缺失。

**手法**：与 0-E2g…0-E3x 相同（扫描器为唯一事实源，`scanner hits: 8  exempt: 0  migratable: 8  rewrites: 8`；正向重放证明下与备份逐字节一致）。**7 个 token 中 `dark:text-gray-400` ×2、其余各 ×1**（无前缀包含对，替换后逐条对照确认未串味）；`bg-gray-50` / `bg-gray-800` 与 `border-gray-200` / `border-gray-700` 各为一对 `bg` / `border` 的明暗成对。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **187 → 179（−8）**，文件数 **58 → 57**；`byFile` 该文件 `8 → 0` 且从表中消失，是唯一文件级 delta；`byAtom` **7 条全为减、无一增**（`bg: gray-50` 6→5、`bg: gray-800` 6→5、`border: gray-200` 6→5、`border: gray-700` 7→6、`text: gray-400` 21→**19**（−2）、`text: gray-500` 12→11、`text: gray-600` 9→8），合计恰 **−8**，**0 桶归零**（7 个原子迁后均仍有别处消费者） |

**产物核对（通用脚本第 45 次复用，正向重放版）**：**ARTIFACT CHECK PASSED**。文件共 **8 个中性 token 出现（7 个不同 token）**（本片全部为新迁移，无遗留令牌），正向重放筛出**7 个派生字面**。**0 个字面迁后 `src=0`**——7 个字面在全仓均另有消费者（`dark:text-gray-400` src = 12、`text-gray-500` src = 8、`bg-gray-50` src = 5、`border-gray-200` src = 5、`text-gray-600` src = 5、`dark:border-gray-700` src = 4、`dark:bg-gray-800` src = 3），`dist` 均 > 0。故本片**0 字面归零、0 桶归零**。值链检查：本片**零透明度 token**（`transparency-bearing tokens: 0`）。非空转对照：**不注入 PASSED、注入 `text-gray-999,bg-slate-123` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 1329 ＋ **8** ＝ **1337** 处；剩余 **179 处 / 57 文件**，余下最大单片 `StepConfiguration.tsx` / `ChatMessagesPane.tsx` 二者并列 8。

#### 0-E3z：`ChatMessagesPane.tsx` 8 → 0（热点榜第四十八，已实施）

**范围**：`src/modules/chat/transcript/ChatMessagesPane.tsx`。**8 处 / 5 个 token / 4 行**——族**纯 `gray` 8**；档位 `gray-200 / 400 / 500 / 700`；工具类 `border` 4 ／ `text` 4；变体**裸类 5 ＋ `dark:` 3**（无伪类）。**零透明度**。属聊天消息面板——一行**模块级顶部饰条槽位类常量**（`TOP_CHROME_SLOT_CLASS`，本片唯一的非 JSX 落点）＋ 一行加载态提示 ＋ 两处加载旋转器（`border-b-2 border-gray-400` 的 `animate-spin` 圆环）。**触碰的 4 行串内无语义彩色**；文件他处含 `text-blue-600` / `hover:text-blue-700` / `dark:text-blue-400` 链接色，**未触碰**。**文件不含前片遗留令牌**（迁移前 `scanScaleTokenAtoms` 报 0；迁移后报 8，全部为本片新增）。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 4 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **4 / 4**，无缺失。

**手法**：与 0-E2g…0-E3y 相同（扫描器为唯一事实源，`scanner hits: 8  exempt: 0  migratable: 8  rewrites: 8`；正向重放证明下与备份逐字节一致）。**5 个 token 中 `text-gray-500` / `dark:text-gray-400` / `border-gray-400` 各 ×2、其余各 ×1**（无前缀包含对，替换后逐条对照确认未串味）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **179 → 171（−8）**，文件数 **57 → 56**；`byFile` 该文件 `8 → 0` 且从表中消失，是唯一文件级 delta；`byAtom` **5 条全为减、无一增**（`border: gray-200` 5→4、`border: gray-400` 2→**0**（该键从表中消失）、`border: gray-700` 6→5、`text: gray-400` 19→17（−2）、`text: gray-500` 11→9（−2）），合计恰 **−8**，**1 桶归零**（`border: gray-400` 迁后全仓再无消费者） |

**产物核对（通用脚本第 46 次复用，正向重放版）**：**ARTIFACT CHECK PASSED**。文件共 **8 个中性 token 出现（5 个不同 token）**（本片全部为新迁移，无遗留令牌），正向重放筛出**5 个派生字面**。**1 个字面迁后 `src=0`**——`border-gray-400` 在全仓（含 `.tsx` 与 `.css` 选择器口径）再无消费，`dist` 亦同步为 0，与本片**唯一的桶归零**互为印证；其余 4 字面在本文件外仍有消费者（`dark:text-gray-400` src = 10、`text-gray-500` src = 6、`border-gray-200` src = 4、`dark:border-gray-700` src = 3），`dist` 均 > 0。故本片**1 字面归零、1 桶归零**。值链检查：本片**零透明度 token**（`transparency-bearing tokens: 0`）。非空转对照：**不注入 PASSED、注入 `border-zinc-999,text-stone-123` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 1337 ＋ **8** ＝ **1345** 处；剩余 **171 处 / 56 文件**，余下最大单片 `StepConfiguration.tsx` 单者 8。

#### 0-E4a：`StepConfiguration.tsx` 8 → 0（热点榜第四十九，已实施）

**范围**：`src/modules/project-creation-wizard/StepConfiguration.tsx`。**8 处 / 4 个 token / 4 行**——族**纯 `gray` 8**；档位 `gray-300 / 400 / 500 / 700`；工具类**全部为 `text` 8**；变体**裸类 4 ＋ `dark:` 4**（无伪类）。**零透明度**。属项目创建向导的配置步骤（与 0-E3j `ProjectCreationWizard.tsx` 同模块）——两处字段标签 `label`（`mb-2 block text-sm font-medium …`，**同串完全复用**）与两处帮助文案 `p`（`mt-1 text-xs …`，**同串完全复用**），即 4 行实为**两个串各 ×2**。**4 行串内无语义彩色**（本文件全仓零语义彩色）。**文件不含前片遗留令牌**（迁移前 `scanScaleTokenAtoms` 报 0；迁移后报 8，全部为本片新增）。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 4 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **4 / 4**，无缺失。

**手法**：与 0-E2g…0-E3z 相同（扫描器为唯一事实源，`scanner hits: 8  exempt: 0  migratable: 8  rewrites: 8`；正向重放证明下与备份逐字节一致）。**4 个 token 各 ×2**（`text-gray-700` / `dark:text-gray-300` / `text-gray-500` / `dark:text-gray-400`；无前缀包含对，替换后逐条对照确认未串味）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **171 → 163（−8）**，文件数 **56 → 55**；`byFile` 该文件 `8 → 0` 且从表中消失，是唯一文件级 delta；`byAtom` **4 条全为减、各 −2、无一增**（`text: gray-300` 7→5、`text: gray-400` 17→15、`text: gray-500` 9→7、`text: gray-700` 2→**0**（该键从表中消失）），合计恰 **−8**，**1 桶归零**（`text: gray-700` 迁后全仓再无消费者） |

**产物核对（通用脚本第 47 次复用，正向重放版）**：**ARTIFACT CHECK PASSED**。文件共 **8 个中性 token 出现（4 个不同 token）**（本片全部为新迁移，无遗留令牌），正向重放筛出**4 个派生字面**。**2 个字面迁后 `src=0`**——`dark:text-gray-300` 与 `text-gray-700` 在全仓（含 `.tsx` 与 `.css` 选择器口径）再无消费，`dist` 亦同步为 0；`text: gray-300` 的 `byAtom` 仍为 5 而字面 `dark:text-gray-300` 已归零，正是已记载的**「桶粒度粗于字面」**形态——存活的是裸类 `text-gray-300`（`FileListContent` ×1、`ShellConnectionOverlay` ×2）与 `dark:hover:text-gray-300`（`MessageSpeakControl` / `MessageCopyControl` 各 ×1），与此字面不同变体。另 2 字面在本文件外仍有消费者（`dark:text-gray-400` src = 8、`text-gray-500` src = 4），`dist` 均 > 0。故本片**2 字面归零、1 桶归零**。值链检查：本片**零透明度 token**（`transparency-bearing tokens: 0`）。非空转对照：**不注入 PASSED、注入 `text-gray-999,dark:bg-gray-123` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 1345 ＋ **8** ＝ **1353** 处；剩余 **163 处 / 55 文件**；热点榜 8 档**全部清零**，余下最大单片为 `MarkdownCodeBlock.tsx` / `Shell.tsx` / `ShellConnectionOverlay.tsx` 三者并列 7。

#### 0-E4b：`ShellConnectionOverlay.tsx` 7 → 0（热点榜第五十，已实施）

**范围**：`src/modules/shell/ShellConnectionOverlay.tsx`。**7 处 / 4 个 token / 7 行**——族 `gray` 6 ＋ `white` 1；档位 `gray-100 / 300 / 950` ＋ `white`；工具类 `bg` 3 ／ `text` 4；变体**全为裸类**（本片零伪类、零 `dark:`）。**带透明度 1 类 / 3 处，均 90%**（`bg-gray-950/90`）。属 Shell 连接遮罩的三态渲染——`loading` / `connect` / `connecting` **各含一行同串的全屏遮罩**（`absolute inset-0 z-20 flex items-center justify-center bg-gray-950/90`，第三态另加 `p-6`），另含一行加载文案、一行连接按钮（含 `text-white`）、两行说明文案（`text-gray-300`，同串复用）。**同一 className 串内语义 emerald 未触碰**（连接按钮上的 `bg-emerald-600` / `hover:bg-emerald-500` / `focus:ring-emerald-300` / `shadow-emerald-950/30` / `active:bg-emerald-700`，其中 `shadow-emerald-950/30` 与中性 `gray-950` 同档不同族，未受本片影响）；他处 `text-blue-300`（loading 图标）/ `text-yellow-300`（connecting 图标）亦未触碰。**文件含前片遗留令牌 `focus:ring-offset-n-gray-950`（第 4 次撞上，未动；正向重放自动排除）**。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的 4 个档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **4 / 4**，无缺失。

**手法**：与 0-E2g…0-E4a 相同（扫描器为唯一事实源，`scanner hits: 7  exempt: 0  migratable: 7  rewrites: 7`；正向重放证明下与备份逐字节一致）。**4 个 token 中 `bg-gray-950/90` ×3、`text-gray-300` ×2、其余各 ×1**（无前缀包含对，替换后逐条对照确认未串味）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | **163 → 156（−7）**，文件数 **55 → 54**；`byFile` 该文件 `7 → 0` 且从表中消失，是唯一文件级 delta；`byAtom` **4 条全为减、无一增**（`bg: gray-950` 3→**0**（该键从表中消失）、`text: gray-100` 2→1、`text: gray-300` 5→3（−2）、`text: white` 30→29），合计恰 **−7**，**1 桶归零**（`bg: gray-950` 迁后全仓再无消费者；`byAtom` 键为 `工具类: 族-档`，**不含变体与透明度**，故此处 3 处 `/90` 与任何同档无色透明度变体一并计入） |

**产物核对（通用脚本第 48 次复用，正向重放版）**：**ARTIFACT CHECK PASSED**。文件共 **8 个中性 token 出现（4 个本片 token ＋ 1 个前片遗留令牌 `focus:ring-offset-n-gray-950` 共 5 个不同 token）**，正向重放按"字面确实存在于备份"筛选，**遗留令牌自动落选**，筛出**4 个本片派生字面**。**2 个字面迁后 `src=0`**——`bg-gray-950/90`、`text-gray-100` 在全仓（含 `.tsx` 与 `.css` 选择器口径）再无消费，`dist` 亦同步为 0；另 2 字面在本文件外仍有消费者（`text-white` src = 25、`text-gray-300` src = 1），`dist` 均 > 0。故本片**2 字面归零、1 桶归零**。值链检查：`bg-n-gray-950/90` → `.bg-n-gray-950\/90{background-color:hsl(var(--n-gray-950) / .9)}`，**三处 90% 透明度均实测到达 `--n-gray-950`**（`transparency-bearing tokens: 3`）。非空转对照：**不注入 PASSED、注入 `bg-gray-999,text-zinc-123` FAILED**。

**验收**：`test:client` **128 文件 / 970 用例**；`typecheck`、`typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`npm run build`、`test:theme-tokens` 16 项全绿；守恒律 2/2、基线 3/3。未改 `index.css` / `tailwind.config.js`。

**与既有账的关系**：阶段 0 至今迁移 1353 ＋ **7** ＝ **1360** 处；剩余 **156 处 / 54 文件**，余下最大单片 `MarkdownCodeBlock.tsx` / `Shell.tsx` 二者并列 7。

#### 0-E4c：`MarkdownCodeBlock.tsx` 7 → 0（热点榜并列第七，已实施）

**范围**：`src/modules/code-editor/markdown/MarkdownCodeBlock.tsx`。**7 处 / 7 个 token / 2 行**——族纯 `gray` 7；档位 `gray-100 / 200 / 400 / 700 / 800 / 900`；工具类 `border` 2 ／ `bg` 2 ／ `text` 3；变体裸类 4 ＋ `dark:` 3（零伪类、**零透明度**）。属 Markdown 代码块渲染——行内代码 className（一串 6 token、light/dark 成对：`border-gray-200 bg-gray-100 text-gray-900 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-100`）＋ 代码块语言角标（`text-gray-400`）。**两行串内无语义彩色**；**文件不含前片遗留令牌**（`scanScaleTokenAtoms` 迁移前报 0）。



**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **6 / 6**，无缺失。

**手法**：与 0-E2g…0-E4b 相同（扫描器为唯一事实源；反向还原证明下与备份逐字节一致，`scanner hits` 与 `rewrites` 相等、`exempt: 0`）。7 → 0 个 token **各 ×1**（无前缀包含对）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****156 → 149（−7）****，文件数 ****54 → 53****；`byAtom` **7 条全为减、无一增（`bg: gray-100` 7→6、`bg: gray-800` 5→4、`border: gray-200` 4→3、`border: gray-700` 5→4、`text: gray-100` 1→**0**、`text: gray-400` 15→14、`text: gray-900` 5→4），合计恰 −7**，**1 桶归零**（`text: gray-100` 迁后全仓再无消费者） |

**产物核对（通用脚本第 49 次复用，正向重放版）**：**ARTIFACT CHECK PASSED**。7 个 token / 7 个派生字面全达 `dist`；`text-gray-100` 迁后 `src = dist = 0`（**1 字面归零**，与桶归零互印），其余 6 字面在本文件外仍有消费者故 `src`、`dist` 均 > 0。非空转对照：**不注入 PASSED、注入 `text-gray-999,bg-slate-123` FAILED**（本批五片统一探针）。

**验收**：见本节末"批次 0-E4c~0-E4g 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1360 ＋ **7** ＝ **1367** 处；剩余 ****149 处 / 53 文件****。

#### 0-E4d：`Shell.tsx` 7 → 0（热点榜并列第七，已实施）

**范围**：`src/modules/shell/Shell.tsx`。**7 处 / 7 个 token / 4 行**——族 `gray` 6 ＋ `white` 1；档位 `gray-600 / 700 / 800 / 900` ＋ `white`；工具类 `bg` 3 ／ `border` 1 ／ `text` 2 ／ `hover:bg` 1；变体裸类 6 ＋ `hover:` 1。**带透明度 2 类 / 2 处**（`border-gray-700/80`、`bg-gray-800/95`）。属 Shell 外壳——根容器（`bg-gray-900`）＋ 移动端底部条（`border-gray-700/80 bg-gray-800/95`）＋ 蓝色主按钮行（含 `text-white`）＋ 灰色次按钮行（`bg-gray-700 text-gray-200 hover:bg-gray-600`）。**同一 className 串内语义蓝 `bg-blue-600` / `hover:bg-blue-700` 未触碰**；**文件不含前片遗留令牌**。



**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **5 / 5**，无缺失。

**手法**：与 0-E2g…0-E4b 相同（扫描器为唯一事实源；反向还原证明下与备份逐字节一致，`scanner hits` 与 `rewrites` 相等、`exempt: 0`）。7 → 0 个 token **各 ×1**（无前缀包含对）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****149 → 142（−7）****，文件数 ****53 → 52****；`byAtom` **7 条全为减、无一增（`bg: gray-600` 1→**0**、`bg: gray-700` 2→1、`bg: gray-800` 4→3、`bg: gray-900` 15→14、`border: gray-700` 4→3、`text: gray-200` 3→2、`text: white` 29→28），合计恰 −7**，**1 桶归零**（`bg: gray-600`） |

**产物核对（通用脚本第 49 次复用，正向重放版）**：**ARTIFACT CHECK PASSED**。7 个 token / 7 个派生字面全达 `dist`；`bg-gray-600`（`hover:` 变体）迁后 `src = dist = 0`（**1 字面归零**），`bg-gray-700` / `bg-gray-800/95` / `border-gray-700/80` 等在本文件外仍有消费者故 `src`、`dist` 均 > 0；`bg-n-gray-800/95` 值链实测达 `--n-gray-800` 95%。非空转对照：**不注入 PASSED、注入 `text-gray-999,bg-slate-123` FAILED**（本批五片统一探针）。

**验收**：见本节末"批次 0-E4c~0-E4g 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1367 ＋ **7** ＝ **1374** 处；剩余 ****142 处 / 52 文件****。

#### 0-E4e：`CommandMenu.tsx` 6 → 0（热点榜并列第七，已实施）

**范围**：`src/modules/chat/composer/CommandMenu.tsx`。**6 处 / 6 个 token / 1 行**——族纯 `gray` 6；档位 `gray-50 / 200 / 500 / 600`；工具类 `border` 2 ／ `bg` 2 ／ `text` 2；变体裸类 3 ＋ `dark:` 3。**带透明度 2 类 / 2 处**（`dark:border-gray-500/20`、`dark:bg-gray-500/10`）。落点是命令面板的分组样式常量——**常量对象字符串值，非 JSX 属性**（`other: 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-500/20 dark:bg-gray-500/10 dark:text-gray-200'`）。**串内无语义彩色**；**文件不含前片遗留令牌**。



**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **4 / 4**，无缺失。

**手法**：与 0-E2g…0-E4b 相同（扫描器为唯一事实源；反向还原证明下与备份逐字节一致，`scanner hits` 与 `rewrites` 相等、`exempt: 0`）。6 → 0 个 token **各 ×1**（无前缀包含对）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****142 → 136（−6）****，文件数 ****52 → 51****；`byAtom` **6 条全为减、无一增（`bg: gray-50` 5→4、`bg: gray-500` 1→**0**、`border: gray-200` 3→2、`border: gray-500` 1→**0**、`text: gray-200` 2→1、`text: gray-600` 8→7），合计恰 −6**，**2 桶归零**（`bg: gray-500` 与 `border: gray-500` 各 1→0；两者均为 `/20` 与 `/10` 透明度变体，`byAtom` 键不含透明度故一并计入） |

**产物核对（通用脚本第 49 次复用，正向重放版）**：**ARTIFACT CHECK PASSED**。6 个 token / 6 个派生字面全达 `dist`；`bg-gray-500/10` 与 `border-gray-500/20` 迁后 `src = dist = 0`（**2 字面归零**，与 2 桶归零互印）；`bg-n-gray-500/10`、`border-n-gray-500/20` 值链实测分别达 `--n-gray-500` 10% / 20%。非空转对照：**不注入 PASSED、注入 `text-gray-999,bg-slate-123` FAILED**（本批五片统一探针）。

**验收**：见本节末"批次 0-E4c~0-E4g 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1374 ＋ **6** ＝ **1380** 处；剩余 ****136 处 / 51 文件****。

#### 0-E4f：`SessionOptions.tsx` 6 → 0（热点榜并列第七，已实施）

**范围**：`src/modules/sidebar/SessionOptions.tsx`。**6 处 / 6 个 token / 2 行**——族纯 `gray` 6；档位 `gray-50 / 100 / 400 / 600 / 900`；工具类 `bg` 4 ／ `text` 2；变体裸类 2 ＋ `hover:` 1 ＋ `dark:` 1 ＋ `dark:hover:` 1。**带透明度 2 类 / 2 处**（`dark:bg-gray-900/20`、`dark:hover:bg-gray-900/40`）。属会话选项的删除按钮——图标容器串（`bg-gray-50 hover:bg-gray-100 dark:bg-gray-900/20 dark:hover:bg-gray-900/40`）＋ `X` 图标（`text-gray-600 dark:text-gray-400`）。**与 0-E4g 逐 token 同构**（复制串），两片同批迁移。**两行串内无语义彩色**；**文件不含前片遗留令牌**。



**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **5 / 5**，无缺失。

**手法**：与 0-E2g…0-E4b 相同（扫描器为唯一事实源；反向还原证明下与备份逐字节一致，`scanner hits` 与 `rewrites` 相等、`exempt: 0`）。6 → 0 个 token **各 ×1**（无前缀包含对）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****136 → 130（−6）****，文件数 ****51 → 50****；`byAtom` **5 条全为减、无一增（`bg: gray-100` 6→5、`bg: gray-50` 4→3、`bg: gray-900` 14→12（−2）、`text: gray-400` 14→13、`text: gray-600` 7→6），合计恰 −6**，**0 桶归零**（五个原子在本文件外均另有消费者） |

**产物核对（通用脚本第 49 次复用，正向重放版）**：**ARTIFACT CHECK PASSED**。6 个 token / 6 个派生字面全达 `dist`；**0 字面归零**（含 `dark:bg-gray-900/20` 与 `dark:hover:bg-gray-900/40` 在内，六个字面全仓均有其他消费者，`src`、`dist` 均 > 0）；`bg-n-gray-900/20`、`bg-n-gray-900/40` 值链实测达 `--n-gray-900` 20% / 40%。非空转对照：**不注入 PASSED、注入 `text-gray-999,bg-slate-123` FAILED**（本批五片统一探针）。

**验收**：见本节末"批次 0-E4c~0-E4g 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1380 ＋ **6** ＝ **1386** 处；剩余 ****130 处 / 50 文件****。

#### 0-E4g：`SidebarContent.tsx` 6 → 0（热点榜并列第七，已实施）

**范围**：`src/modules/sidebar/SidebarContent.tsx`。**6 处 / 6 个 token / 2 行**——族纯 `gray` 6；档位 `gray-50 / 100 / 400 / 600 / 900`；工具类 `bg` 4 ／ `text` 2；变体裸类 2 ＋ `hover:` 1 ＋ `dark:` 1 ＋ `dark:hover:` 1。**带透明度 2 类 / 2 处**（`dark:bg-gray-900/20`、`dark:hover:bg-gray-900/40`）。属侧栏会话项的删除按钮——**与 0-E4f 逐 token 同构的复制串**（同两行结构），两片同批迁移。**两行串内无语义彩色**；**文件不含前片遗留令牌**。



**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——脚本点名 **5 / 5**，无缺失。

**手法**：与 0-E2g…0-E4b 相同（扫描器为唯一事实源；反向还原证明下与备份逐字节一致，`scanner hits` 与 `rewrites` 相等、`exempt: 0`）。6 → 0 个 token **各 ×1**（无前缀包含对）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****130 → 124（−6）****，文件数 ****50 → 49****；`byAtom` **5 条全为减、无一增（`bg: gray-100` 5→4、`bg: gray-50` 3→2、`bg: gray-900` 12→10（−2）、`text: gray-400` 13→12、`text: gray-600` 6→5），合计恰 −6**，**0 桶归零**（同 0-E4f，五个原子全仓仍有消费者） |

**产物核对（通用脚本第 49 次复用，正向重放版）**：**ARTIFACT CHECK PASSED**。6 个 token / 6 个派生字面全达 `dist`；**0 字面归零**（六个字面全仓均有其他消费者）；`bg-n-gray-900/20`、`bg-n-gray-900/40` 值链实测达 `--n-gray-900` 20% / 40%。非空转对照：**不注入 PASSED、注入 `text-gray-999,bg-slate-123` FAILED**（本批五片统一探针）。

**验收**：见本节末"批次 0-E4c~0-E4g 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1386 ＋ **6** ＝ **1392** 处；剩余 ****124 处 / 49 文件****。

#### 批次 0-E4c ~ 0-E4g 共同验收（五片共用同一轮重量级门槛）

**构建 / 产物核对 / 探针 / 全量测试在同一次调用里完成**（这是本批相对逐片流程唯一的合并项）：`npm run build` exit 0（`✓ built in 7.57s`）；通用产物核对脚本对五片**逐一**运行（各用自己迁移前的备份），**五片全部 ARTIFACT CHECK PASSED**（`pure -n- insertion: YES`，token 数 7 / 7 / 6 / 6 / 6，distinct literals 同值）；探针注入 `text-gray-999,bg-slate-123`，**五片全部 FAILED**（证明核对不是空转）；`test:client` **128 文件 / 970 用例**、`typecheck` 与 `typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`test:theme-tokens` 16 项全绿。**未改 `index.css` / `tailwind.config.js`**。守恒律在批次起点跑一次即 **1517 = 1517 / 211 桶零漂移**（迁移不触碰冻结文件，故一次即覆盖五片）。

**同批的理由与边界**：五片是热点榜并列第七的集群（7 / 7 / 6 / 6 / 6），互相独立（无共享 className 串、无跨文件依赖），但同处聊天面板 / Shell / 侧栏三模块邻域。批次化**只合并重量级门槛的调用次数**（构建一次、全量测试一次、产物核对循环），**每片仍是独立的迁移、独立的基线快照 diff、独立的 commit**——基线刷新严格发生在"只有一个文件相对 HEAD 变动"的时刻，因此五片的 `byAtom` delta 逐片可配对（见上五段），任一片都可单独回退。

#### 0-E4h：`SidebarRecentConversations.tsx` 6 → 0（热点榜并列第六，已实施）

**范围**：`src/modules/sidebar/SidebarRecentConversations.tsx`。**6 处 / 6 个 token / 2 行**——族纯 `gray` 6；档位 `gray-50 / 100 / 400 / 600 / 900`；工具类 `bg` 4 ／ `text` 2；变体裸类 2 / `hover:` 1 / `dark:` 1 / `dark:hover:` 1；**透明度 2 类 2 处**（`dark:bg-gray-900/20`、`dark:hover:bg-gray-900/40`）。落点为侧栏"最近会话"项删除按钮（图标容器串 ＋ `X` 图标）。

**前置检查（沿用既定一次点名）**：迁移前点名确认本片用到的档位在 `src/index.css` 里 **L1 `--palette-*` 与 L2 `--n-*` 双声明齐全**——批次一次点名 **12 / 12**（`gray-50`~`gray-900` ＋ `white` ＋ `black`），无缺失。

**手法**：与 0-E2g…0-E4g 相同（扫描器为唯一事实源；反向还原证明下与备份逐字节一致）。6 个 token **各 ×1**（无前缀包含对）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****124 → 118（−6）****，文件数 ****49 → 48****；`byAtom` **5 条全为减、无一增**（`bg: gray-100` 4→3、`bg: gray-50` 2→1、`bg: gray-900` 10→8（−2）、`text: gray-400` 12→11、`text: gray-600` 5→4），**0 桶归零** |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**。6 个 token / 6 个派生字面全达 `dist`；`bg-n-gray-900/20`、`bg-n-gray-900/40` 值链均实测。

**验收**：见本节末"批次 0-E4h~0-E4n 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1392 ＋ **6** ＝ **1398** 处；剩余 ****118 处 / 48 文件****。

#### 0-E4i：`MessageSpeakControl.tsx` 5 → 0（热点榜第六，已实施）

**范围**：`src/modules/chat/transcript/MessageSpeakControl.tsx`。**5 处 / 5 个 token / 2 行**——族 `gray` 4 ＋ `white` 1；档位 `gray-300 / 400 / 500 / 600` ＋ `white`；工具类纯 `text` 5；变体裸类 / `hover:` / `dark:` / `dark:hover:` 齐备；**零透明度**。落点为语音播报控件的错误提示气泡（`text-white`）＋ 语音按钮串；**气泡串内语义 `bg-red-600` 未触碰**。

**手法**：反向还原与备份逐字节一致。5 个 token **各 ×1**。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****118 → 113（−5）****，文件数 ****48 → 47****；`byAtom` **5 条全为减、无一增**（`text: gray-300` 3→2、`text: gray-400` 11→10、`text: gray-500` 7→6、`text: gray-600` 4→3、`text: white` 28→27），**0 桶归零** |

**产物核对**：**ARTIFACT CHECK PASSED**；5 token / 5 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E4h~0-E4n 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1398 ＋ **5** ＝ **1403** 处；剩余 ****113 处 / 47 文件****。

#### 0-E4j：`CodeEditorLoadingState.tsx` 5 → 0（热点榜第六，已实施）

**范围**：`src/modules/code-editor/CodeEditorLoadingState.tsx`。**5 处 / 5 个 token / 3 行**——族 `gray` 2 ＋ `white` 2 ＋ `black` 1；档位 `gray-900` ＋ `white` ＋ `black`；`text` 4 ／ `bg` 1；变体裸类 / `dark:` / `md:`；**透明度 1 类 1 处**（`md:bg-black/50` 50%）。落点为内联加载文案 ＋ 全屏遮罩 ＋ 遮罩内加载文案；**同串语义 `border-blue-600` 未触碰**。**5 个 token 仅派生 3 个不同字面**（`text-gray-900`、`dark:text-white` 各 ×2）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****113 → 108（−5）****，文件数 ****47 → 46****；`byAtom` **3 条全为减、无一增**（`bg: black` 13→12、`text: gray-900` 4→2（−2）、`text: white` 27→25（−2）），**0 桶归零** |

**产物核对**：**ARTIFACT CHECK PASSED**；`pure -n- insertion: YES`（token 5 / distinct literals 3，差值是同串重复）。

**验收**：见本节末"批次 0-E4h~0-E4n 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1403 ＋ **5** ＝ **1408** 处；剩余 ****108 处 / 46 文件****。

#### 0-E4k：`PrdEditorLoadingState.tsx` 5 → 0（热点榜第六，已实施）

**范围**：`src/modules/prd-editor/PrdEditorLoadingState.tsx`。**5 处 / 5 个 token / 3 行**——族 `gray` 2 ＋ `white` 2 ＋ `black` 1；档位 `gray-900` ＋ `white` ＋ `black`；`bg` 3 ／ `text` 2；变体裸类 / `dark:` / `md:`；**透明度 1 类 1 处**（`md:bg-black/50` 50%）。落点为全屏遮罩 ＋ 加载卡片（`bg-white` / `dark:bg-gray-900`）＋ 加载文案；**同串语义 `border-blue-600` 未触碰**。与 0-E4j 镜像同构（编辑器 / PRD 两处 loading）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****108 → 103（−5）****，文件数 ****46 → 45****；`byAtom` **5 条全为减、无一增**（`bg: black` 12→11、`bg: gray-900` 8→7、`bg: white` 10→9、`text: gray-900` 2→1、`text: white` 25→24），**0 桶归零** |

**产物核对**：**ARTIFACT CHECK PASSED**；5 token / 5 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E4h~0-E4n 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1408 ＋ **5** ＝ **1413** 处；剩余 ****103 处 / 45 文件****。

#### 0-E4l：`ShellEmptyState.tsx` 5 → 0（热点榜第六，已实施）

**范围**：`src/modules/shell/ShellEmptyState.tsx`。**5 处 / 5 个 token / 3 行**——族纯 `gray` 5；档位 `gray-100 / 400 / 500 / 800`；`text` 3 ／ `bg` 2；变体裸类 / `dark:`；**零透明度**。落点为空态容器 ＋ 圆形图标容器 ＋ `svg` 图标；**文件全仓零语义彩色**。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****103 → 98（−5）****，文件数 ****45 → 44****；`byAtom` **4 条全为减、无一增**（`bg: gray-100` 3→2、`bg: gray-800` 3→2、`text: gray-400` 10→8（−2）、`text: gray-500` 6→5），**0 桶归零** |

**产物核对**：**ARTIFACT CHECK PASSED**；5 token / 5 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E4h~0-E4n 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1413 ＋ **5** ＝ **1418** 处；剩余 ****98 处 / 44 文件****。

#### 0-E4m：`StandaloneShellEmptyState.tsx` 5 → 0（热点榜第六，已实施）

**范围**：`src/modules/standalone-shell/StandaloneShellEmptyState.tsx`。**5 处 / 5 个 token / 3 行**——与 0-E4l **同构**（独立壳空态：容器 ＋ 圆形图标容器 ＋ `svg` 图标）；族纯 `gray` 5；档位 `gray-100 / 400 / 500 / 800`；`text` 3 ／ `bg` 2；变体裸类 / `dark:`；**零透明度**；**文件全仓零语义彩色**。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****98 → 93（−5）****，文件数 ****44 → 43****；`byAtom` **4 条全为减、无一增**（`bg: gray-100` 2→1、`bg: gray-800` 2→1、`text: gray-400` 8→6（−2）、`text: gray-500` 5→4），**0 桶归零** |

**产物核对**：**ARTIFACT CHECK PASSED**；5 token / 5 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E4h~0-E4n 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1418 ＋ **5** ＝ **1423** 处；剩余 ****93 处 / 43 文件****。

#### 0-E4n：`StandaloneShellHeader.tsx` 5 → 0（热点榜第六，已实施，本批收尾）

**范围**：`src/modules/standalone-shell/StandaloneShellHeader.tsx`。**5 处 / 5 个 token / 3 行**——族 `gray` 4 ＋ `white` 1；档位 `gray-200 / 400 / 700 / 800` ＋ `white`；`border` 1 ／ `bg` 1 ／ `text` 3；变体裸类 / `hover:`；**零透明度**。落点为独立壳头部容器（`border-b` ＋ `bg`）＋ 标题 `h3` ＋ 关闭按钮；**同串语义 `text-green-400` 未触碰**。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****93 → 88（−5）****，文件数 ****43 → 42****；`byAtom` **5 条全为减、无一增**（`bg: gray-800` 1→0、`border: gray-700` 3→2、`text: gray-200` 1→0、`text: gray-400` 6→5、`text: white` 24→23），**2 桶归零**（`bg: gray-800`、`text: gray-200`） |

**产物核对**：**ARTIFACT CHECK PASSED**；5 token / 5 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E4h~0-E4n 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1423 ＋ **5** ＝ **1428** 处；剩余 ****88 处 / 42 文件****（本批合计 −36 处 / −7 文件）。

#### 批次 0-E4h ~ 0-E4n 共同验收（七片共用同一轮重量级门槛）

**构建 / 产物核对 / 探针 / 全量测试在同一次调用里完成**（这是本批相对逐片流程唯一的合并项）：`npm run build` exit 0（`✓ built in 9.13s`）；通用产物核对脚本对七片**逐一**运行（各用自己迁移前的备份），**七片全部 ARTIFACT CHECK PASSED**（`pure -n- insertion: YES`，token 数 6 / 5 / 5 / 5 / 5 / 5 / 5，distinct literals 6 / 5 / 3 / 5 / 5 / 5 / 5）；探针注入 `text-gray-999,bg-zinc-123`，**七片全部 FAILED**（证明核对不是空转）；`test:client` **128 文件 / 970 用例**、`typecheck` 与 `typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`test:theme-tokens` **16 通过**、守恒律 **1517 = 1517 / 211 桶零漂移**。七片均**无前片遗留令牌**（迁移前 grep `-n-` 全零），也未改动 `index.css` / `tailwind.config.js`。

**同批的理由与边界**：七片是热点榜并列第六及其后的集群（6 / 5 / 5 / 5 / 5 / 5 / 5），互相独立（无共享 className 串、无跨文件依赖），覆盖聊天 / 编辑器 / Shell / 独立壳 / 侧栏五模块邻域。批次化**只合并重量级门槛的调用次数**（构建一次、全量测试一次、产物核对循环），**每片仍是独立的迁移、独立的基线快照 diff、独立的 commit**——基线刷新严格发生在"只有一个文件相对 HEAD 变动"的时刻，因此七片的 `byAtom` delta 逐片可配对（见上七段），任一片都可单独回退。

#### 0-E4o：`FileListContent.tsx` 4 → 0（热点榜并列第四，已实施）

**范围**：`src/modules/chat/tools/ContentRenderers/FileListContent.tsx`。**4 处 / 4 个 token / 2 行**——族纯 `gray` 4；档位 `gray-300 / 400 / 500 / 600`；工具类纯 `text` 4；变体裸类 2 / `dark:` 2；**零透明度**。落点为文件列表头部提示串 ＋ 行内分隔符 span；同文件语义 blue 链接色未触碰。

**手法**：与 0-E2g…0-E4n 相同（扫描器为唯一事实源；反向还原证明下与备份逐字节一致）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****88 → 84（−4）****，文件数 ****42 → 41****；`byAtom` **4 条全为减、无一增**（`text: gray-300` 2→1、`text: gray-400` 5→4、`text: gray-500` 4→3、`text: gray-600` 3→2），**0 桶归零** |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；4 token / 4 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E4o~0-E4x 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1428 ＋ **4** ＝ **1432** 处；剩余 ****84 处 / 41 文件****。

#### 0-E4p：`ToolStatusBadge.tsx` 4 → 0（热点榜并列第四，已实施）

**范围**：`src/modules/chat/tools/ToolStatusBadge.tsx`。**4 处 / 4 个 token / 1 行**——族纯 `slate` 4；档位 `slate-100 / 300 / 700 / 900`；`bg` 2 ／ `text` 2；**透明度 1 类 1 处**（`dark:bg-slate-900/30`）；变体裸类 2 / `dark:` 2。落点为状态徽标配置对象的 `className` 字符串值（非 JSX 属性）；同对象其余条目的 blue / green / red / orange 语义色未触碰。

**手法**：与 0-E2g…0-E4n 相同（扫描器为唯一事实源；反向还原证明下与备份逐字节一致）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****84 → 80（−4）****，文件数 ****41 → 40****；`byAtom` **4 条全为减、无一增**（`bg: slate-100` 1→0、`bg: slate-900` 1→0、`text: slate-300` 2→1、`text: slate-700` 2→1），**2 桶归零**（`bg: slate-100`、`bg: slate-900`） |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；4 token / 4 派生字面全达 `dist`；`bg-n-slate-900/30` 值链实测。

**验收**：见本节末"批次 0-E4o~0-E4x 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1432 ＋ **4** ＝ **1436** 处；剩余 ****80 处 / 40 文件****。

#### 0-E4q：`ChatMessageImages.tsx` 4 → 0（热点榜并列第四，已实施）

**范围**：`src/modules/chat/transcript/ChatMessageImages.tsx`。**4 处 / 4 个 token / 2 行**——族 `white` 3 ＋ `black` 1；档位 `white` ＋ `black`；`text` 1 ／ `bg` 3；**透明度 3 类 3 处**（`bg-black/80`、`bg-white/10`、`hover:bg-white/20`）；变体裸类 3 / `hover:` 1。落点为图片查看全屏遮罩 ＋ 右上关闭按钮；**文件全仓零语义彩色**。

**手法**：与 0-E2g…0-E4n 相同（扫描器为唯一事实源；反向还原证明下与备份逐字节一致）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****80 → 76（−4）****，文件数 ****40 → 39****；`byAtom` **3 条全为减、无一增**（`bg: black` 11→10、`bg: white` 9→7（−2）、`text: white` 23→22），**0 桶归零** |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；4 token / 4 派生字面全达 `dist`；`bg-n-black/80`、`bg-n-white/10`、`bg-n-white/20` 值链均实测。

**验收**：见本节末"批次 0-E4o~0-E4x 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1436 ＋ **4** ＝ **1440** 处；剩余 ****76 处 / 39 文件****。

#### 0-E4r：`MessageCopyControl.tsx` 4 → 0（热点榜并列第四，已实施）

**范围**：`src/modules/chat/transcript/MessageCopyControl.tsx`。**4 处 / 4 个 token / 1 行**——族纯 `gray` 4；档位 `gray-300 / 400 / 500 / 600`；工具类纯 `text` 4；变体裸类 / `hover:` / `dark:` / `dark:hover:` 齐备；**零透明度**。落点为复制按钮状态类的三元字符串常量（与 0-E4i 同形）；**文件全仓零语义彩色**。

**手法**：与 0-E2g…0-E4n 相同（扫描器为唯一事实源；反向还原证明下与备份逐字节一致）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****76 → 72（−4）****，文件数 ****39 → 38****；`byAtom` **4 条全为减、无一增**（`text: gray-300` 1→0、`text: gray-400` 4→3、`text: gray-500` 3→2、`text: gray-600` 2→1），**1 桶归零**（`text: gray-300`） |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；4 token / 4 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E4o~0-E4x 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1440 ＋ **4** ＝ **1444** 处；剩余 ****72 处 / 38 文件****。

#### 0-E4s：`CodeEditorFooter.tsx` 4 → 0（热点榜并列第四，已实施）

**范围**：`src/modules/code-editor/CodeEditorFooter.tsx`。**4 处 / 4 个 token / 2 行**——族纯 `gray` 4；档位 `gray-400 ×2 + gray-500 + gray-600`；工具类纯 `text` 4；变体裸类 2 / `dark:` 2；**零透明度**。落点为编辑器页脚左侧信息串 ＋ 右侧快捷键提示串；**文件全仓零语义彩色**。**4 个 token 仅派生 3 个不同字面**（`dark:text-gray-400` ×2）。

**手法**：与 0-E2g…0-E4n 相同（扫描器为唯一事实源；反向还原证明下与备份逐字节一致）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****72 → 68（−4）****，文件数 ****38 → 37****；`byAtom` **3 条全为减、无一增**（`text: gray-400` 3→1（−2）、`text: gray-500` 2→1、`text: gray-600` 1→0），**1 桶归零**（`text: gray-600`） |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；`pure -n- insertion: YES`（token 4 / distinct literals 3，差值是同串重复）。

**验收**：见本节末"批次 0-E4o~0-E4x 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1444 ＋ **4** ＝ **1448** 处；剩余 ****68 处 / 37 文件****。

#### 0-E4t：`EditorSidebar.tsx` 4 → 0（热点榜并列第四，已实施）

**范围**：`src/modules/code-editor/EditorSidebar.tsx`。**4 处 / 4 个 token / 2 行**——族纯 `gray` 4；档位 `gray-200 ×2 + gray-700 ×2`；`bg` 2 ／ `border` 2；变体裸类 2 / `dark:` 2；**零透明度**。落点为可拖拽分隔条（`bg`）＋ 侧栏容器（`border-l`）；**分隔条同串语义 `hover:bg-blue-500` / `dark:hover:bg-blue-600` 未触碰**。

**手法**：与 0-E2g…0-E4n 相同（扫描器为唯一事实源；反向还原证明下与备份逐字节一致）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****68 → 64（−4）****，文件数 ****37 → 36****；`byAtom` **4 条全为减、无一增**（`bg: gray-200` 1→0、`bg: gray-700` 1→0、`border: gray-200` 2→1、`border: gray-700` 2→1），**2 桶归零**（`bg: gray-200`、`bg: gray-700`） |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；4 token / 4 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E4o~0-E4x 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1448 ＋ **4** ＝ **1452** 处；剩余 ****64 处 / 36 文件****。

#### 0-E4u：`FileTree.tsx` 4 → 0（热点榜并列第四，已实施）

**范围**：`src/modules/file-tree/FileTree.tsx`。**4 处 / 4 个 token / 3 行**——族 `white` 3 ＋ `black` 1；档位 `white` ＋ `black`；`text` 3 ／ `bg` 1；**透明度 1 类 1 处**（`bg-black/50`）；变体**全为裸类**。落点为删除确认遮罩 ＋ 确认按钮 ＋ 两处条件类三元串；**同串语义 `bg-red-600` / `hover:bg-red-700` 未触碰**，他处 red / green / blue 亦未触碰。**4 个 token 仅派生 2 个不同字面**（`text-white` ×3）。

**手法**：与 0-E2g…0-E4n 相同（扫描器为唯一事实源；反向还原证明下与备份逐字节一致）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****64 → 60（−4）****，文件数 ****36 → 35****；`byAtom` **2 条全为减、无一增**（`bg: black` 10→9、`text: white` 22→19（−3）），**0 桶归零** |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；`pure -n- insertion: YES`（token 4 / distinct literals 2）。

**验收**：见本节末"批次 0-E4o~0-E4x 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1452 ＋ **4** ＝ **1456** 处；剩余 ****60 处 / 35 文件****。

#### 0-E4v：`TaskIndicator.tsx` 4 → 0（热点榜并列第四，已实施）

**范围**：`src/modules/sidebar/TaskIndicator.tsx`。**4 处 / 4 个 token / 2 行**——族纯 `gray` 4；档位 `gray-50 / 400 / 500 / 900`；`text` 2 ／ `bg` 2；变体裸类 2 / `dark:` 2；**零透明度**。落点为指示器配置对象的类名常量（`colorClassName` / `backgroundClassName`）；**同对象其余条目 green / blue / amber 语义色未触碰**。

**手法**：与 0-E2g…0-E4n 相同（扫描器为唯一事实源；反向还原证明下与备份逐字节一致）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****60 → 56（−4）****，文件数 ****35 → 34****；`byAtom` **4 条全为减、无一增**（`bg: gray-50` 1→0、`bg: gray-900` 7→6、`text: gray-400` 1→0、`text: gray-500` 1→0），**3 桶归零**（`bg: gray-50`、`text: gray-400`、`text: gray-500`） |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；4 token / 4 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E4o~0-E4x 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1456 ＋ **4** ＝ **1460** 处；剩余 ****56 处 / 34 文件****。

#### 0-E4w：`ProviderSkills.tsx` 4 → 0（热点榜并列第四，已实施）

**范围**：`src/modules/skills/ProviderSkills.tsx`。**4 处 / 4 个 token / 1 行**——族纯 `slate` 4；档位 `slate-300 / 500 ×2 / 700`；`border` 1 ／ `bg` 1 ／ `text` 2；**透明度 2 类 2 处**（`border-slate-500/30`、`bg-slate-500/10`）；变体裸类 3 / `dark:` 1。落点为 provider 分类样式表的 `system` 条目；**同表其余条目 emerald / sky / amber / orange / rose 语义色未触碰**。

**手法**：与 0-E2g…0-E4n 相同（扫描器为唯一事实源；反向还原证明下与备份逐字节一致）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****56 → 52（−4）****，文件数 ****34 → 33****；`byAtom` **4 条全为减、无一增**（`bg: slate-500` 1→0、`border: slate-500` 1→0、`text: slate-300` 1→0、`text: slate-700` 1→0），**4 桶归零**（`bg: slate-500`、`border: slate-500`、`text: slate-300`、`text: slate-700`） |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；4 token / 4 派生字面全达 `dist`；`border-n-slate-500/30`、`bg-n-slate-500/10` 值链均实测。

**验收**：见本节末"批次 0-E4o~0-E4x 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1460 ＋ **4** ＝ **1464** 处；剩余 ****52 处 / 33 文件****。

#### 0-E4x：`Tooltip.tsx` 4 → 0（热点榜并列第四，已实施）

**范围**：`src/shared/ui/Tooltip.tsx`。**4 处 / 4 个 token / 1 行**——族 `gray` 3 ＋ `white` 1；档位 `gray-100 / 900 ×2` ＋ `white`；`text` 2 ／ `bg` 2；**零透明度**；变体裸类 2 / `dark:` 2。落点为 tooltip 气泡基础样式串（含 `dark:bg-gray-100` 反色写法）。**文件含 0-E2e 遗留令牌 10 处**（轴限定 `border-t/b/l/r-n-gray-900 dark:border-*-n-gray-100`），**反向还原因此不适用（第 5 次撞上），改用正向重放证明**：从备份回放本片 4 个字面替换后逐字节等于当前文件，遗留令牌自动落选（`tokens in file: 14` = 10 遗留 ＋ 4 本片，`pure -n- insertion: YES`）。

**手法**：与 0-E2g…0-E4n 相同（扫描器为唯一事实源；反向还原证明下与备份逐字节一致）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****52 → 48（−4）****，文件数 ****33 → 32****；`byAtom` **4 条全为减、无一增**（`bg: gray-100` 1→0、`bg: gray-900` 6→5、`text: gray-900` 1→0、`text: white` 19→18），**2 桶归零**（`bg: gray-100`、`text: gray-900`） |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**（正向重放版，遗留令牌已排除）；4 token / 4 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E4o~0-E4x 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1464 ＋ **4** ＝ **1468** 处；剩余 ****48 处 / 32 文件****（本批合计 −40 处 / −10 文件）。

#### 批次 0-E4o ~ 0-E4x 共同验收（十片共用同一轮重量级门槛）

**构建 / 产物核对 / 探针 / 全量测试在同一次调用里完成**（这是本批相对逐片流程唯一的合并项）：`npm run build` exit 0（`✓ built in 8.27s`）；通用产物核对脚本对十片**逐一**运行（各用自己迁移前的备份），**十片全部 ARTIFACT CHECK PASSED**（`pure -n- insertion: YES`；token 数 4 / 4 / 4 / 4 / 4 / 4 / 4 / 4 / 4 / 14（含 0-E4x 的 10 处 0-E2e 遗留令牌），distinct literals 4 / 4 / 4 / 4 / 3 / 4 / 2 / 4 / 4 / 4）；探针注入 `text-gray-999,bg-stone-123`，**十片全部 FAILED**（证明核对不是空转）；`test:client` **128 文件 / 970 用例**、`typecheck` 与 `typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`test:theme-tokens` **16 通过**、守恒律 **1517 = 1517 / 211 桶零漂移**。十片均未改动 `index.css` / `tailwind.config.js`。

**同批的理由与边界**：十片是热点榜并列第四的集群（各 4 处），互相独立（无共享 className 串、无跨文件依赖），覆盖聊天工具 / 消息 / 编辑器 / 文件树 / 侧栏 / 技能 / 共享 UI 七模块邻域。本批**首次出现"反向还原因遗留令牌不适用"的收尾片（0-E4x）**——`Tooltip.tsx` 的 0-E2e 遗留令牌使 `untokenise` 无法还原，改由正向重放证明（既有机制，0-E3i 已建立）。批次化**只合并重量级门槛的调用次数**（构建一次、全量测试一次、产物核对循环），**每片仍是独立的迁移、独立的基线快照 diff、独立的 commit**——基线刷新严格发生在"只有一个文件相对 HEAD 变动"的时刻，因此十片的 `byAtom` delta 逐片可配对（见上十段），任一片都可单独回退。

#### 0-E4y：`LoadAllMessagesOverlay.tsx` 3 → 0（热点榜并列第五，已实施）

**范围**：`src/modules/chat/transcript/LoadAllMessagesOverlay.tsx`。**3 处 / 3 个 token / 3 行**——族纯 `white` 3；档位白色（无档位）；`text` 2 ／ `border` 1；**透明度 1 类 1 处**（`border-white/30`）；变体**全为裸类**。落点为加载遮罩的三行：绿色「加载全部」按钮 ＋ 蓝色重试按钮 ＋ 旋转器 `border-t` 环。**文件含前片遗留令牌 1 处**（`border-t-n-white`），**反向还原因此不适用（第 6 次撞上），改用正向重放证明**：从备份回放本片 3 个字面替换后逐字节等于当前文件，遗留令牌自动落选（`tokens in file: 4` = 1 遗留 ＋ 3 本片，`pure -n- insertion: YES`）。

**手法**：与 0-E2g…0-E4x 相同（扫描器为唯一事实源；反向还原证明下与备份逐字节一致）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****48 → 45（−3）****，文件数 ****32 → 31****；`byAtom` **2 条全为减、无一增**（`border: white` 1→0、`text: white` 18→16），**1 桶归零**（`border: white`） |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；4 token / 2 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E4y~0-E5j 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1468 ＋ **3** ＝ **1471** 处；剩余 ****45 处 / 31 文件****。

#### 0-E4z：`CodeEditorSurface.tsx` 3 → 0（热点榜并列第五，已实施）

**范围**：`src/modules/code-editor/CodeEditorSurface.tsx`。**3 处 / 3 个 token / 2 行**——族 `gray` 2 ＋ `white` 1；档位 `gray-900` ＋ `white`；工具类纯 `bg` 3；**零透明度**；变体裸类 1 / `dark:` 1 / `prose-pre:` 1。落点为 Markdown 预览分支的滚动容器 ＋ `prose` 排版容器。同串 `prose-a` 语义蓝（`text-blue-600` / `dark:text-blue-400`）未触碰。**无遗留令牌**。

**手法**：与 0-E2g…0-E4x 相同。正向重放证明下与备份逐字节一致（`pure -n- insertion: YES`）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****45 → 42（−3）****，文件数 ****31 → 30****；`byAtom` **2 条全为减**（`bg: gray-900` 5→3、`bg: white` 7→6），**0 桶归零** |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；3 token / 3 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E4y~0-E5j 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1471 ＋ **3** ＝ **1474** 处；剩余 ****42 处 / 30 文件****。

#### 0-E5a：`MermaidDiagram.tsx` 3 → 0（热点榜并列第五，已实施）

**范围**：`src/modules/code-editor/markdown/MermaidDiagram.tsx`。**3 处 / 2 个 token / 2 行**——族 `zinc` 2 ＋ `white` 1；档位 `zinc-900` ＋ `white`；工具类纯 `bg` 3；**零透明度**；变体裸类 1 / `dark:` 2。落点为源码回退 `pre`（light 底由 `bg-muted/50` 语义令牌承载，仅 dark 底色为字面）＋ `svg` 渲染容器（light `bg-white` / dark 字面）。同串 `border-border` / `text-muted-foreground` 语义令牌未触碰。**3 token 派生 2 字面**（`dark:bg-zinc-900` 出现 2 次）。**无遗留令牌**。

**手法**：与 0-E2g…0-E4x 相同。正向重放证明下与备份逐字节一致（`pure -n- insertion: YES`）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****42 → 39（−3）****，文件数 ****30 → 29****；`byAtom` **2 条全为减**（`bg: white` 6→5、`bg: zinc-900` 3→1），**0 桶归零** |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；3 token / 2 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E4y~0-E5j 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1474 ＋ **3** ＝ **1477** 处；剩余 ****39 处 / 29 文件****。

#### 0-E5b：`PrdEditorWorkspace.tsx` 3 → 0（热点榜并列第五，已实施）

**范围**：`src/modules/prd-editor/PrdEditorWorkspace.tsx`。**3 处 / 3 个 token / 2 行**——族 `black` 1 ＋ `white` 1 ＋ `gray` 1；档位 `black` / `white` / `gray-900`；工具类纯 `bg` 3；**透明度 1 类 1 处**（`md:bg-black/50` 遮罩）；变体 `md:` 1 / 裸类 1 / `dark:` 1。落点为移动端全屏遮罩层 ＋ 编辑器面板容器。**无遗留令牌**、无同串语义色。

**手法**：与 0-E2g…0-E4x 相同。正向重放证明下与备份逐字节一致（`pure -n- insertion: YES`）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****39 → 36（−3）****，文件数 ****29 → 28****；`byAtom` **3 条全为减**（`bg: black` 9→8、`bg: gray-900` 3→2、`bg: white` 5→4），**0 桶归零** |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；3 token / 3 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E4y~0-E5j 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1477 ＋ **3** ＝ **1480** 处；剩余 ****36 处 / 28 文件****。

#### 0-E5c：`OneLineDisplay.tsx` 2 → 0（热点榜并列第六，已实施）

**范围**：`src/modules/chat/tools/OneLineDisplay.tsx`。**2 处 / 2 个 token / 1 行**——族 `gray` 1 ＋ `black` 1；档位 `gray-900` ＋ `black`；工具类纯 `bg` 2；**零透明度**；变体裸类 1 / `dark:` 1。落点为单行 shell 命令展示块的底色串（等宽文本在内层 `span`，非 `<code>`，见源码注释）。**无遗留令牌**、无同串语义色。

**手法**：与 0-E2g…0-E4x 相同。正向重放证明下与备份逐字节一致（`pure -n- insertion: YES`）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****36 → 34（−2）****，文件数 ****28 → 27****；`byAtom` **2 条全为减**（`bg: black` 8→7、`bg: gray-900` 2→1），**0 桶归零** |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；2 token / 2 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E4y~0-E5j 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1480 ＋ **2** ＝ **1482** 处；剩余 ****34 处 / 27 文件****。

#### 0-E5d：`GitPanelHeader.tsx` 2 → 0（热点榜并列第六，已实施）

**范围**：`src/modules/git-panel/GitPanelHeader.tsx`。**2 处 / 1 个 token / 2 行**——族纯 `white` 2；档位白色；工具类纯 `text` 2；**零透明度**；变体**全为裸类**。落点为绿色拉取按钮 ＋ 橙色推送按钮的文字色（`bg-green-600` / `bg-orange-600` 语义底色未触碰）。**同 token 出现 2 次，派生 1 字面**。**无遗留令牌**。

**手法**：与 0-E2g…0-E4x 相同。正向重放证明下与备份逐字节一致（`pure -n- insertion: YES`）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****34 → 32（−2）****，文件数 ****27 → 26****；`byAtom` **1 条全为减**（`text: white` 16→14），**0 桶归零** |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；2 token / 1 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E4y~0-E5j 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1482 ＋ **2** ＝ **1484** 处；剩余 ****32 处 / 26 文件****。

#### 0-E5e：`ConfirmActionModal.tsx` 2 → 0（热点榜并列第六，已实施）

**范围**：`src/modules/git-panel/modals/ConfirmActionModal.tsx`。**2 处 / 2 个 token / 2 行**——族 `black` 1 ＋ `white` 1；档位 `black` ＋ `white`；`bg` 1 ／ `text` 1；**透明度 1 类 1 处**（`bg-black/60` 遮罩）；变体**全为裸类**。落点为全屏遮罩层 ＋ 确认按钮文字色（按钮配色由 `CONFIRMATION_BUTTON_CLASSES[action.type]` 映射表决定，表内语义色未触碰）。**无遗留令牌**。

**手法**：与 0-E2g…0-E4x 相同。正向重放证明下与备份逐字节一致（`pure -n- insertion: YES`）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****32 → 30（−2）****，文件数 ****26 → 25****；`byAtom` **2 条全为减**（`bg: black` 7→6、`text: white` 14→13），**0 桶归零** |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；2 token / 2 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E4y~0-E5j 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1484 ＋ **2** ＝ **1486** 处；剩余 ****30 处 / 25 文件****。

#### 0-E5f：`RemoveWorktreeModal.tsx` 2 → 0（热点榜并列第六，已实施）

**范围**：`src/modules/git-panel/modals/RemoveWorktreeModal.tsx`。**2 处 / 2 个 token / 2 行**——族 `black` 1 ＋ `white` 1；档位 `black` ＋ `white`；`bg` 1 ／ `text` 1；**透明度 1 类 1 处**（`bg-black/60` 遮罩）；变体**全为裸类**。落点为全屏遮罩层 ＋ 危险确认按钮文字色（同串 `bg-red-600` / `hover:bg-red-700` 语义红未触碰）。**与 0-E5e 逐 token 同构**。**无遗留令牌**。

**手法**：与 0-E2g…0-E4x 相同。正向重放证明下与备份逐字节一致（`pure -n- insertion: YES`）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****30 → 28（−2）****，文件数 ****25 → 24****；`byAtom` **2 条全为减**（`bg: black` 6→5、`text: white` 13→12），**0 桶归零** |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；2 token / 2 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E4y~0-E5j 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1486 ＋ **2** ＝ **1488** 处；剩余 ****28 处 / 24 文件****。

#### 0-E5g：`WizardFooter.tsx` 2 → 0（热点榜并列第六，已实施）

**范围**：`src/modules/project-creation-wizard/WizardFooter.tsx`。**2 处 / 2 个 token / 1 行**——族纯 `gray` 2；档位 `gray-200` ＋ `gray-700`；工具类纯 `border` 2；**零透明度**；变体裸类 1 / `dark:` 1。落点为向导页脚顶边分隔线（light 浅线 / dark 深线成对）。**无遗留令牌**、无同串语义色。

**手法**：与 0-E2g…0-E4x 相同。正向重放证明下与备份逐字节一致（`pure -n- insertion: YES`）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****28 → 26（−2）****，文件数 ****24 → 23****；`byAtom` **2 条全为减**（`border: gray-200` 1→0、`border: gray-700` 1→0），**2 桶归零**（`border: gray-200`、`border: gray-700`） |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；2 token / 2 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E4y~0-E5j 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1488 ＋ **2** ＝ **1490** 处；剩余 ****26 处 / 23 文件****。

#### 0-E5h：`WorkspaceTabs.tsx` 2 → 0（热点榜并列第六，已实施）

**范围**：`src/modules/project-workspace/WorkspaceTabs.tsx`。**2 处 / 2 个 token / 1 行**——族纯 `black` 2；档位黑色；工具类纯 `shadow` 2；**透明度 2 类 2 处**（`shadow-black/[0.025]` 任意值、`dark:shadow-black/10`）；变体裸类 1 / `dark:` 1。落点为标签条内阴影串（**本批唯一 `shadow` 工具类片**）。同串 `border-border/40` / `bg-muted/50` 语义令牌未触碰。**无遗留令牌**。

**手法**：与 0-E2g…0-E4x 相同。正向重放证明下与备份逐字节一致（`pure -n- insertion: YES`）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****26 → 24（−2）****，文件数 ****23 → 22****；`byAtom` **1 条全为减**（`shadow: black` 2→0），**1 桶归零**（`shadow: black`） |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；2 token / 2 派生字面（含任意值透明度值链）全达 `dist`。

**验收**：见本节末"批次 0-E4y~0-E5j 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1490 ＋ **2** ＝ **1492** 处；剩余 ****24 处 / 22 文件****。

#### 0-E5i：`NotificationsSettingsTab.tsx` 2 → 0（热点榜并列第六，已实施）

**范围**：`src/modules/settings/tabs/NotificationsSettingsTab.tsx`。**2 处 / 1 个 token / 2 行**——族纯 `white` 2；档位白色；工具类纯 `text` 2；**零透明度**；变体**全为裸类**。落点为两处开关激活态（三元串）的文字色，两串逐字同构（`bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600`，语义蓝未触碰）。**同 token 出现 2 次，派生 1 字面**。**无遗留令牌**。

**手法**：与 0-E2g…0-E4x 相同。正向重放证明下与备份逐字节一致（`pure -n- insertion: YES`）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****24 → 22（−2）****，文件数 ****22 → 21****；`byAtom` **1 条全为减**（`text: white` 12→10），**0 桶归零** |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；2 token / 1 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E4y~0-E5j 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1492 ＋ **2** ＝ **1494** 处；剩余 ****22 处 / 21 文件****。

#### 0-E5j：`DarkModeToggle.tsx` 2 → 0（热点榜并列第六，批次收尾片，已实施）

**范围**：`src/shared/ui/DarkModeToggle.tsx`。**2 处 / 2 个 token / 2 行**——族纯 `white` 2；档位白色；`bg` 1 ／ `text` 1；**零透明度**；变体**全为裸类**。落点为开关滑块位移态三元串的底色（`translate-x-[22px] bg-white`）＋ 太阳图标文字色。同串 `bg-foreground/60` / `dark:bg-foreground/80`、`dark:text-background` 语义令牌未触碰。**无遗留令牌**。

**手法**：与 0-E2g…0-E4x 相同。正向重放证明下与备份逐字节一致（`pure -n- insertion: YES`）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****22 → 20（−2）****，文件数 ****21 → 20****；`byAtom` **2 条全为减**（`bg: white` 4→3、`text: white` 10→9），**0 桶归零** |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；2 token / 2 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E4y~0-E5j 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1494 ＋ **2** ＝ **1496** 处；剩余 ****20 处 / 20 文件****（本批合计 −28 处 / −12 文件）。

#### 批次 0-E4y ~ 0-E5j 共同验收（十二片共用同一轮重量级门槛）

**构建 / 产物核对 / 探针 / 全量测试在同一次调用里完成**（这是本批相对逐片流程唯一的合并项）：`npm run build` exit 0；通用产物核对脚本对十二片**逐一**运行（各用自己迁移前的备份），**十二片全部 ARTIFACT CHECK PASSED**（`pure -n- insertion: YES`；token 数 4 / 3 / 3 / 3 / 2 / 2 / 2 / 2 / 2 / 2 / 2 / 2，distinct literals 2 / 3 / 2 / 3 / 2 / 1 / 2 / 2 / 2 / 2 / 1 / 2；**0-E4y 的 4 token 含 1 处前片遗留 `border-t-n-white`**）；探针注入 `text-gray-999,bg-stone-123`，**十二片全部 FAILED**（证明核对不是空转）；`test:client` **128 文件 / 970 用例**、`typecheck` 与 `typecheck:theme-tokens`、`lint`（153 warnings / **0 error**）、`test:theme-tokens` **16 通过**、守恒律 **1517 = 1517 / 211 桶零漂移**。十二片均未改动 `index.css` / `tailwind.config.js`。

**同批的理由与边界**：十二片 = 热点榜并列第五的四个 3 处文件 ＋ 并列第六的八个 2 处文件，互相独立（无共享 className 串、无跨文件依赖），覆盖聊天转录 / 代码编辑器 / Markdown / PRD 编辑器 / 聊天工具 / Git 面板 / 项目创建 / 工作区 / 设置 / 共享 UI 十模块邻域。本批**收尾片 0-E5j 使剩余量降到 20 处 / 20 文件，热点榜再无并列（余下 20 文件各 1 处）**；0-E4y 是**第 6 次**撞上前片遗留令牌的片（`border-t-n-white`），仍走正向重放证明。批次化**只合并重量级门槛的调用次数**（构建一次、全量测试一次、产物核对循环），**每片仍是独立的迁移、独立的基线快照 diff、独立的 commit**——基线刷新严格发生在"只有一个文件相对 HEAD 变动"的时刻，因此十二片的 `byAtom` delta 逐片可配对（见上十二段），任一片都可单独回退。

**文档勘误（本批一并修复）**：§5 的"沿革"链此前停在第 50 片（`0-E4b −7`），**0-E4c…0-E4x 的 22 个历史分片值从未补入**；本批在追加 0-E4y…0-E5j 之前，先按 §6 各片记录逐片补齐 `−7/−7/−6/−6/−6/−6/−5/−5/−5/−5/−5/−5/−4×10`，使链恢复逐片单调、与切片表一一对应。同理，§5"进度"括号内的"均已清零"清单此前冻结在 0-E4b 时代（止于 `ShellConnectionOverlay.tsx` 7，"余下最大单片为 MarkdownCodeBlock/Shell 二者并列 7"），本批补齐至 0-E5j 并把尾句改为"余下 20 个文件各 1 处"。

#### 0-E5k：`ComposerAttachment.tsx` 1 → 0（热点榜余量片之一，已实施）

**范围**：`src/modules/chat/composer/ComposerAttachment.tsx`。**1 处 / 1 个 token / 1 行**——族纯 `white` 1；档位白色；工具类纯 `text` 1；**零透明度**；变体**全为裸类**。落点为附件错误遮罩内的叉号图标文字色（同串底色 `bg-red-500/50` 为语义色，未触碰）。**无遗留令牌**。

**手法**：与 0-E2g…0-E5j 相同。正向重放证明下与备份逐字节一致（`pure -n- insertion: YES`）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****20 → 19（−1）****，文件数 ****20 → 19****；`byAtom` **1 条全为减**（`text: white` 9→8），**0 桶归零** |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；1 token / 1 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E5k~0-E6d 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1496 ＋ **1** ＝ **1497** 处；剩余 ****19 处 / 19 文件****。

#### 0-E5l：`PromptInput.tsx` 1 → 0（热点榜余量片之一，已实施）

**范围**：`src/modules/chat/composer/PromptInput.tsx`。**1 处 / 1 个 token / 1 行**——族纯 `white` 1；档位白色；工具类纯 `bg` 1；含 20% 一处透明度；变体**全为裸类**。落点为工具提示快捷键 `<kbd>` 的半透明底色。**无遗留令牌**。

**手法**：与 0-E2g…0-E5j 相同。正向重放证明下与备份逐字节一致（`pure -n- insertion: YES`）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****19 → 18（−1）****，文件数 ****19 → 18****；`byAtom` **1 条全为减**（`bg: white` 3→2），**0 桶归零** |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；1 token / 1 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E5k~0-E6d 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1497 ＋ **1** ＝ **1498** 处；剩余 ****18 处 / 18 文件****。

#### 0-E5m：`VoiceInputButton.tsx` 1 → 0（热点榜余量片之一，已实施）

**范围**：`src/modules/chat/composer/VoiceInputButton.tsx`。**1 处 / 1 个 token / 1 行**——族纯 `white` 1；档位白色；工具类纯 `text` 1；**零透明度**；变体**全为裸类**。落点为语音输入错误气泡的文字色（同串底色 `bg-red-600` 为语义色，未触碰）。**无遗留令牌**。

**手法**：与 0-E2g…0-E5j 相同。正向重放证明下与备份逐字节一致（`pure -n- insertion: YES`）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****18 → 17（−1）****，文件数 ****18 → 17****；`byAtom` **1 条全为减**（`text: white` 8→7），**0 桶归零** |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；1 token / 1 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E5k~0-E6d 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1498 ＋ **1** ＝ **1499** 处；剩余 ****17 处 / 17 文件****。

#### 0-E5n：`CommandResultModal.tsx` 1 → 0（热点榜余量片之一，已实施）

**范围**：`src/modules/chat/modals/CommandResultModal.tsx`。**1 处 / 1 个 token / 1 行**——族纯 `white` 1；档位白色；工具类纯 `text` 1；**零透明度**；变体**全为裸类**。落点为进程健康状态 Badge 的文字色（同串 `bg-emerald-500` 及 hover 态均为语义色，未触碰）。**无遗留令牌**。

**手法**：与 0-E2g…0-E5j 相同。正向重放证明下与备份逐字节一致（`pure -n- insertion: YES`）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****17 → 16（−1）****，文件数 ****17 → 16****；`byAtom` **1 条全为减**（`text: white` 7→6），**0 桶归零** |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；1 token / 1 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E5k~0-E6d 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1499 ＋ **1** ＝ **1500** 处；剩余 ****16 处 / 16 文件****。

#### 0-E5o：`Markdown.tsx` 1 → 0（热点榜余量片之一，已实施）

**范围**：`src/modules/chat/transcript/Markdown.tsx`。**1 处 / 1 个 token / 1 行**——族 `zinc` 1；档位zinc-900；工具类纯 `bg` 1；**零透明度**；变体**`dark:` 1**。落点为代码块容器 className 的 dark 态底色（同串 `border-border` / `bg-muted/50` 为主题令牌，未触碰）。**无遗留令牌**。

**手法**：与 0-E2g…0-E5j 相同。正向重放证明下与备份逐字节一致（`pure -n- insertion: YES`）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****16 → 15（−1）****，文件数 ****16 → 15****；`byAtom` **1 条全为减**（`bg: zinc-900` 1→0），**1 桶归零**（`bg: zinc-900`） |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；1 token / 1 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E5k~0-E6d 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1500 ＋ **1** ＝ **1501** 处；剩余 ****15 处 / 15 文件****。

#### 0-E5p：`CodeEditor.tsx` 1 → 0（热点榜余量片之一，已实施）

**范围**：`src/modules/code-editor/CodeEditor.tsx`。**1 处 / 1 个 token / 1 行**——族纯 `black` 1；档位黑色；工具类纯 `bg` 1；含 50% 一处透明度；变体**`md:` 1**。落点为非侧栏模式外层容器模板串的 `md` 断点遮罩底色（同串 `fixed` / `inset-0` / `z-[9999]` 布局类未触碰）。**无遗留令牌**。

**手法**：与 0-E2g…0-E5j 相同。正向重放证明下与备份逐字节一致（`pure -n- insertion: YES`）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****15 → 14（−1）****，文件数 ****15 → 14****；`byAtom` **1 条全为减**（`bg: black` 5→4），**0 桶归零** |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；1 token / 1 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E5k~0-E6d 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1501 ＋ **1** ＝ **1502** 处；剩余 ****14 处 / 14 文件****。

#### 0-E5q：`MergeWorktreeModal.tsx` 1 → 0（热点榜余量片之一，已实施）

**范围**：`src/modules/git-panel/modals/MergeWorktreeModal.tsx`。**1 处 / 1 个 token / 1 行**——族纯 `black` 1；档位黑色；工具类纯 `bg` 1；含 60% 一处透明度；变体**全为裸类**。落点为模态遮罩层 div 的半透明黑底。**无遗留令牌**。

**手法**：与 0-E2g…0-E5j 相同。正向重放证明下与备份逐字节一致（`pure -n- insertion: YES`）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****14 → 13（−1）****，文件数 ****14 → 13****；`byAtom` **1 条全为减**（`bg: black` 4→3），**0 桶归零** |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；1 token / 1 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E5k~0-E6d 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1502 ＋ **1** ＝ **1503** 处；剩余 ****13 处 / 13 文件****。

#### 0-E5r：`NewBranchModal.tsx` 1 → 0（热点榜余量片之一，已实施）

**范围**：`src/modules/git-panel/modals/NewBranchModal.tsx`。**1 处 / 1 个 token / 1 行**——族纯 `black` 1；档位黑色；工具类纯 `bg` 1；含 60% 一处透明度；变体**全为裸类**。落点为模态遮罩层 div 的半透明黑底（与 0-E5q / 0-E5s 同族同档，三处遮罩形态一致）。**无遗留令牌**。

**手法**：与 0-E2g…0-E5j 相同。正向重放证明下与备份逐字节一致（`pure -n- insertion: YES`）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****13 → 12（−1）****，文件数 ****13 → 12****；`byAtom` **1 条全为减**（`bg: black` 3→2），**0 桶归零** |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；1 token / 1 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E5k~0-E6d 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1503 ＋ **1** ＝ **1504** 处；剩余 ****12 处 / 12 文件****。

#### 0-E5s：`NewWorktreeModal.tsx` 1 → 0（热点榜余量片之一，已实施）

**范围**：`src/modules/git-panel/modals/NewWorktreeModal.tsx`。**1 处 / 1 个 token / 1 行**——族纯 `black` 1；档位黑色；工具类纯 `bg` 1；含 60% 一处透明度；变体**全为裸类**。落点为模态遮罩层 div 的半透明黑底（本批 git-panel 三个模态遮罩至此齐平）。**无遗留令牌**。

**手法**：与 0-E2g…0-E5j 相同。正向重放证明下与备份逐字节一致（`pure -n- insertion: YES`）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****12 → 11（−1）****，文件数 ****12 → 11****；`byAtom` **1 条全为减**（`bg: black` 2→1），**0 桶归零** |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；1 token / 1 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E5k~0-E6d 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1504 ＋ **1** ＝ **1505** 处；剩余 ****11 处 / 11 文件****。

#### 0-E5t：`AgentConnectionCard.tsx` 1 → 0（热点榜余量片之一，已实施）

**范围**：`src/modules/onboarding/AgentConnectionCard.tsx`。**1 处 / 1 个 token / 1 行**——族纯 `white` 1；档位白色；工具类纯 `text` 1；**零透明度**；变体**全为裸类**。落点为登录按钮模板串的文字色（模板内插 `${loginButtonClassName}` 决定底色，属既有语义令牌）。**无遗留令牌**。

**手法**：与 0-E2g…0-E5j 相同。正向重放证明下与备份逐字节一致（`pure -n- insertion: YES`）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****11 → 10（−1）****，文件数 ****11 → 10****；`byAtom` **1 条全为减**（`text: white` 6→5），**0 桶归零** |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；1 token / 1 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E5k~0-E6d 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1505 ＋ **1** ＝ **1506** 处；剩余 ****10 处 / 10 文件****。

#### 0-E5u：`Onboarding.tsx` 1 → 0（热点榜余量片之一，已实施）

**范围**：`src/modules/onboarding/Onboarding.tsx`。**1 处 / 1 个 token / 1 行**——族纯 `white` 1；档位白色；工具类纯 `text` 1；**零透明度**；变体**全为裸类**。落点为向导完成按钮的文字色（同串 `bg-emerald-600` 及 hover / shadow 态均为语义色，未触碰）。**无遗留令牌**。

**手法**：与 0-E2g…0-E5j 相同。正向重放证明下与备份逐字节一致（`pure -n- insertion: YES`）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****10 → 9（−1）****，文件数 ****10 → 9****；`byAtom` **1 条全为减**（`text: white` 5→4），**0 桶归零** |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；1 token / 1 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E5k~0-E6d 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1506 ＋ **1** ＝ **1507** 处；剩余 ****9 处 / 9 文件****。

#### 0-E5v：`OnboardingStepProgress.tsx` 1 → 0（热点榜余量片之一，已实施）

**范围**：`src/modules/onboarding/OnboardingStepProgress.tsx`。**1 处 / 1 个 token / 1 行**——族纯 `white` 1；档位白色；工具类纯 `text` 1；**零透明度**；变体**全为裸类**。落点为已完成步骤圆点的文字色（三元串内；同串 `border-emerald-500` / `bg-emerald-500` 为语义色，另两分支 `border-primary` / `bg-card` / `text-muted-foreground` 为主题令牌，均未触碰）。**无遗留令牌**。

**手法**：与 0-E2g…0-E5j 相同。正向重放证明下与备份逐字节一致（`pure -n- insertion: YES`）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****9 → 8（−1）****，文件数 ****9 → 8****；`byAtom` **1 条全为减**（`text: white` 4→3），**0 桶归零** |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；1 token / 1 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E5k~0-E6d 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1507 ＋ **1** ＝ **1508** 处；剩余 ****8 处 / 8 文件****。

#### 0-E5w：`PluginSettingsTab.tsx` 1 → 0（热点榜余量片之一，已实施）

**范围**：`src/modules/plugins/PluginSettingsTab.tsx`。**1 处 / 1 个 token / 1 行**——族纯 `white` 1；档位白色；工具类纯 `bg` 1；**零透明度**；变体**`after:` 1**。落点为开关滑块伪元素的白色圆点底色（同串 `bg-muted` / `peer-checked:bg-emerald-500` 未触碰）。**无遗留令牌**。

**手法**：与 0-E2g…0-E5j 相同。正向重放证明下与备份逐字节一致（`pure -n- insertion: YES`）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****8 → 7（−1）****，文件数 ****8 → 7****；`byAtom` **1 条全为减**（`bg: white` 2→1），**0 桶归零** |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；1 token / 1 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E5k~0-E6d 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1508 ＋ **1** ＝ **1509** 处；剩余 ****7 处 / 7 文件****。

#### 0-E5x：`WorkspaceErrorBoundary.tsx` 1 → 0（热点榜余量片之一，已实施）

**范围**：`src/modules/project-workspace/WorkspaceErrorBoundary.tsx`。**1 处 / 1 个 token / 1 行**——族纯 `white` 1；档位白色；工具类纯 `text` 1；**零透明度**；变体**全为裸类**。落点为错误边界重试按钮的文字色（同串 `bg-red-600` 及 hover / `focus:ring-red-500` 均为语义色，未触碰）。**无遗留令牌**。

**手法**：与 0-E2g…0-E5j 相同。正向重放证明下与备份逐字节一致（`pure -n- insertion: YES`）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****7 → 6（−1）****，文件数 ****7 → 6****；`byAtom` **1 条全为减**（`text: white` 3→2），**0 桶归零** |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；1 token / 1 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E5k~0-E6d 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1509 ＋ **1** ＝ **1510** 处；剩余 ****6 处 / 6 文件****。

#### 0-E5y：`SettingsToggle.tsx` 1 → 0（热点榜余量片之一，已实施）

**范围**：`src/modules/settings/SettingsToggle.tsx`。**1 处 / 1 个 token / 1 行**——族纯 `white` 1；档位白色；工具类纯 `bg` 1；**零透明度**；变体**全为裸类**。落点为开关滑块选中态三元串的圆点底色（另一分支 `bg-foreground/60` / `dark:bg-foreground/80` 为语义令牌，未触碰）。**无遗留令牌**。

**手法**：与 0-E2g…0-E5j 相同。正向重放证明下与备份逐字节一致（`pure -n- insertion: YES`）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****6 → 5（−1）****，文件数 ****6 → 5****；`byAtom` **1 条全为减**（`bg: white` 1→0），**1 桶归零**（`bg: white`） |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；1 token / 1 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E5k~0-E6d 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1510 ＋ **1** ＝ **1511** 处；剩余 ****5 处 / 5 文件****。

#### 0-E5z：`AgentSelectorSection.tsx` 1 → 0（热点榜余量片之一，已实施）

**范围**：`src/modules/settings/tabs/agents-settings/sections/AgentSelectorSection.tsx`。**1 处 / 1 个 token / 1 行**——族 `zinc` 1；档位zinc-500；工具类纯 `bg` 1；**零透明度**；变体**全为裸类**。落点为 Agent 品牌色映射链中 opencode 分支的圆点底色（同链其余分支为品牌十六进制 `bg-[#...]` / `bg-foreground`，未触碰）。**无遗留令牌**。

**手法**：与 0-E2g…0-E5j 相同。正向重放证明下与备份逐字节一致（`pure -n- insertion: YES`）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****5 → 4（−1）****，文件数 ****5 → 4****；`byAtom` **1 条全为减**（`bg: zinc-500` 1→0），**1 桶归零**（`bg: zinc-500`） |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；1 token / 1 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E5k~0-E6d 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1511 ＋ **1** ＝ **1512** 处；剩余 ****4 处 / 4 文件****。

#### 0-E6a：`ShellMinimalView.tsx` 1 → 0（热点榜余量片之一，已实施）

**范围**：`src/modules/shell/ShellMinimalView.tsx`。**1 处 / 1 个 token / 1 行**——族 `gray` 1；档位gray-900；工具类纯 `bg` 1；**零透明度**；变体**全为裸类**。落点为极简终端视图根容器底色（终端 xterm 主题依赖的深底，改为令牌后仍指向同一 HSL 三元组）。**无遗留令牌**。

**手法**：与 0-E2g…0-E5j 相同。正向重放证明下与备份逐字节一致（`pure -n- insertion: YES`）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****4 → 3（−1）****，文件数 ****4 → 3****；`byAtom` **1 条全为减**（`bg: gray-900` 1→0），**1 桶归零**（`bg: gray-900`） |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；1 token / 1 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E5k~0-E6d 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1512 ＋ **1** ＝ **1513** 处；剩余 ****3 处 / 3 文件****。

#### 0-E6b：`SidebarModeTabs.tsx` 1 → 0（热点榜余量片之一，已实施）

**范围**：`src/modules/sidebar/SidebarModeTabs.tsx`。**1 处 / 1 个 token / 1 行**——族纯 `white` 1；档位白色；工具类纯 `text` 1；**零透明度**；变体**全为裸类**。落点为运行中会话数角标的文字色（同串 `bg-emerald-500` / `text-emerald-500` / `ring-background` 未触碰）。**无遗留令牌**。

**手法**：与 0-E2g…0-E5j 相同。正向重放证明下与备份逐字节一致（`pure -n- insertion: YES`）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****3 → 2（−1）****，文件数 ****3 → 2****；`byAtom` **1 条全为减**（`text: white` 2→1），**0 桶归零** |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；1 token / 1 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E5k~0-E6d 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1513 ＋ **1** ＝ **1514** 处；剩余 ****2 处 / 2 文件****。

#### 0-E6c：`TaskMasterPanel.tsx` 1 → 0（热点榜余量片之一，已实施）

**范围**：`src/modules/task-master/TaskMasterPanel.tsx`。**1 处 / 1 个 token / 1 行**——族纯 `white` 1；档位白色；工具类纯 `text` 1；**零透明度**；变体**全为裸类**。落点为 PRD 完成通知浮层的文字色（同串 `bg-green-600` 与 `shadow-lg` 未触碰）。**无遗留令牌**。

**手法**：与 0-E2g…0-E5j 相同。正向重放证明下与备份逐字节一致（`pure -n- insertion: YES`）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****2 → 1（−1）****，文件数 ****2 → 1****；`byAtom` **1 条全为减**（`text: white` 1→0），**1 桶归零**（`text: white`） |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；1 token / 1 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E5k~0-E6d 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1514 ＋ **1** ＝ **1515** 处；剩余 ****1 处 / 1 文件****。

#### 0-E6d：`Dialog.tsx` 1 → 0（**本批收尾片，阶段 0 归零片**，已实施）

**范围**：`src/shared/ui/Dialog.tsx`。**1 处 / 1 个 token / 1 行**——族纯 `black` 1；档位黑色；工具类纯 `bg` 1；含 50% 一处透明度；变体**全为裸类**。落点为共享 Dialog 的遮罩层底色。**无遗留令牌**。

**手法**：与 0-E2g…0-E5j 相同。正向重放证明下与备份逐字节一致（`pure -n- insertion: YES`）。

**双绿**：

| 门槛 | 结果 |
|---|---|
| **守恒律** | **1517 = 1517、211 桶逐桶相等，未刷新** |
| **基线** | ****1 → 0（−1）****，文件数 ****1 → 0****；`byAtom` **1 条全为减**（`bg: black` 1→0），**1 桶归零**（`bg: black`） |

**产物核对（通用脚本正向重放版）**：**ARTIFACT CHECK PASSED**；1 token / 1 派生字面全达 `dist`。

**验收**：见本节末"批次 0-E5k~0-E6d 共同验收"。

**与既有账的关系**：阶段 0 至今迁移 1515 ＋ **1** ＝ **1516** 处；剩余 ****0 处 / 0 文件****。
#### 批次 0-E5k ~ 0-E6d 共同验收（二十片共用同一轮重量级门槛）

**构建 / 产物核对 / 探针 / 全量测试在同一次调用里完成**（批次化只合并这一层）：`npm run build` exit 0；通用产物核对脚本对二十片**逐一**运行（各用自己迁移前的备份），**二十片全部 ARTIFACT CHECK PASSED**（`pure -n- insertion: YES`；每片 1 token / 1 派生字面）；探针注入 `text-gray-999,bg-stone-123`，**二十片全部 FAILED**（证明核对不是空转）；`test:client` **128 文件 / 970 用例**、`typecheck` 与 `typecheck:theme-tokens` 干净、`lint`（153 warnings / **0 error**）、`test:theme-tokens` **16 通过**、守恒律 **1517 = 1517 / 211 桶零漂移**（冻结文件全程未刷新）。二十片均未改动 `index.css` / `tailwind.config.js`，每片的提交只有"该文件 ＋ 基线快照"两项。

**同批的理由与边界**：二十片 = 阶段 0 剩下的**全部**余量，每文件恰 1 处、互不共享 className 串。覆盖聊天输入区 / 聊天模态 / 转录 Markdown / 代码编辑器 / Git 面板三模态 / 新手引导 / 插件设置 / 工作区错误边界 / 设置开关 / Agent 选择 / 极简终端壳 / 侧栏标签 / TaskMaster 通知 / 共享 Dialog 十四处模块邻域。批次化**只合并重量级门槛的调用次数**，**每片仍是独立的迁移、独立的基线快照 diff、独立的 commit**——基线刷新严格发生在"只有一个文件相对 HEAD 变动"的时刻，因此二十片的 `byAtom` delta 逐片可配对（见上二十段），任一片都可单独回退。**无一片撞上前片遗留令牌**（本批 20 个文件迁移前 `n-*` 计数均为 0），故二十片全部适用反向还原核对。

**归零**：本批把阶段 0 推到最后一片——`total` 20 → **0**、文件 20 → **0**，累计迁移 1496 ＋ 20 ＝ **1516** 处（起点 1517，余 1 处豁免 `border-gray-150`）。**6 个桶全部清零**，各自落在不同的片上：`bg: zinc-900`（0-E5o）、`bg: white`（0-E5y）、`bg: zinc-500`（0-E5z）、`bg: gray-900`（0-E6a）、`text: white`（0-E6c）、`bg: black`（0-E6d）。`text: white` 是本批最长的一条衰减链（9→8→7→6→…→0），跨 0-E5k / 0-E5m / 0-E5n / 0-E5t / 0-E5u / 0-E5v / 0-E5x / 0-E6b / 0-E6c 九片。

**本批的唯一非迁移改动：护栏前提失效（0-E6d 之后，独立 commit `b116a255`）**。归零把守恒律测试里一条断言的前提吃掉了：反空转护栏的第四条——"必须扫到 ≥1 处**带透明度修饰的字面中性色**"——在 `src/` 里最后一个字面中性色消失后**无论捕获组是否健在都读 0**，既可能假绿也不再覆盖它当初要守的东西（对比之下基线快照那三条护栏不依赖字面残留——配对层 `*-opacity-*` 检测、豁免无死规则、快照逐桶相等——归零后仍全部成立，故未动）。处置：把这条改为对**解析形状**的直接断言——扫描器的 `matchUsage` 导出给测试，护栏用拼接出的名字（Tailwind 会把测试文件当内容扫描，所以不能写出活的工具类名）断言 `bg-gray-100/50` 解析出的透明度为 `50`、而 `bg-gray-100` 为 `null`，即"两半不得塌进同一个桶"。**它不能被守恒律那条替代**：变异测试（删掉 `ATOM` 的透明度捕获组）下"中性色守恒"仍然通过——字面侧已无命中，census 看不到差别——只有这条护栏变红。其余四条断言仍按仓库计数（`tokens` 1516、带变体 779、带透明度 123、轴限定 15），前提未失效故未改。重建后 dist CSS 文件名哈希未变（`index-BZ-B_5--`），拼接名未把字面工具类带进产物。

#### 0-F 实施记录（2026-09-25，拆 0-F1 / 0-F2 两片）

**为何排在 1-B2 之后**：0-F 是 **1-G 的前置**——1-G 要让 Git 图随主题变化，前提是 `var(--graph-lane-*)` 先存在。它是 1-B 片核验时复查出来的欠账：阶段 0 的"迁移完成"只覆盖 Tailwind 具名中性色那一类（§5.7 第一类），0-F / 0-G 一直挂在阶段 0 表里没执行（0-G 已改判入阶段 1）。

**0-F1 · Git 图 lane 色令牌化（`7cb60343`）**

*范围*：`src/index.css`（L1 新增 10 个 `--palette-graph-*` ＋ L2 新增 10 个 `--graph-lane-*`）、`src/modules/git-panel/utils/commitGraph.ts`（删 `GRAPH_COLORS` 数组；导出 `GRAPH_LANE_COUNT`、改 `laneColor`、新增 `laneTint`）、`src/modules/git-panel/history/CommitHistoryItem.tsx`（`RefBadge` 改收 `lane`、去掉 `'#0ea5e9'` fallback）、`tests/theme-tokens/`（新增 `graph-lanes.spec.ts`、`main.ts` 加 10 个 lane 探针、刷新 `token-baseline.json`、`tsconfig.json` 与 README 同步）。**`CommitGraphStrip.tsx` 一行未动**。

*格式与换算*：L1 沿用全表约定——**HSL 三元组**，按 CSS 的 HSL 算法从原 hex 换算；10 个色值**1 位小数即精确往返**（换算脚本先用 `index.css` 里 7 个已知三元组验证算法本身，再逐个反解，不以"看着对"收工）。

*三处判断*：① **不做 `.dark` 镜像**——这 10 色本就是"明暗都看得清"的一套，与 term board 同性质（外观无关），镜像一份同值是纯重复；② **SVG 表现属性能不能吃 `var()`** 设计文档没定论，实测定论：chromium 与 webkit 下 `stroke="hsl(var(--x))"` / `fill` 与字面 hex 的 computed 值逐位相同，故 `CommitGraphStrip` 不改走 `style`（避免无谓的 DOM 结构变化）；③ `RefBadge` 的 HEAD 底色原是 `${hex}22`（附加 alpha 字节），`var()` 串接不了，改由 `laneTint` 给 `hsl(var(--graph-lane-N) / calc(34 / 255))`——`0x22`＝34/255，实测两引擎下与 `${hex}22` 的 computed 值逐位相同。

*证据*：

| 证据 | 结果 |
|---|---|
| 契约测试（**先不刷基线**跑一遍） | "既有令牌逐位未漂移"**绿**；唯一红的是"基线未覆盖"，未覆盖项**恰好 40 条**＝20 个新令牌 × 明暗两态——反证"只新增、未改动" |
| 基线 diff | **60 行纯新增**（40 token ＋ 20 rendered）、**0 删除**；10 条 rendered 值逐条等于原 hex 的 `rgb()` |
| 常驻断言（新增） | `graph-lanes.spec.ts` 三项 × 双引擎：lanes 渲染值＝原 hex 数组、明暗两态一致、`laneTint`＝浏览器**同场渲染**的 `${hex}22`（参考值现渲，不写死 alpha） |
| 产物逐规则 diff | 临时 worktree 构建 0-F 前版本，两份 CSS 按规则拆行比对：规则数 **2591 → 2591 未变**，变化只有 `:root` 一条，其内 **＋20 声明 / −0**（10 个 `--palette-graph-*` ＋ 10 个 `--graph-lane-*`）；产物 JS 里 `GRAPH_COLORS` 与各旧 hex 均 **0 命中** |

*已做（2-J，2026-09-26）*：§5.12 的 >10 lane 参数化回退已落地——lane ≥ 11 走 HSL 旋转（`--graph-lane-base-hue` / `--graph-lane-hue-step`，默认 315.3 / 95.1），不再回绕；那次**有意的视觉变更**已随开工拍板并记账（见 §5.12 v3）。

**0-F2 · 移动端终端选区菜单 7 处令牌化（`03a8e86e`）**

*范围*：`src/modules/shell/utils/mobileTerminalSelection.ts`（7 处字面色值）、`tests/theme-tokens/`（新增 `mobile-terminal-selection.spec.ts`、`main.ts` 加 `readMobileSelectionChrome()`、README 补"消费者守卫"一节）。**无 CSS 改动、无新令牌**（用到的令牌全部已存在）。

*映射*：手柄底 `#3b82f6` → `hsl(var(--palette-brand-400))`；白描边 `#fff` → `hsl(var(--n-white))`；手柄阴影 `rgba(0,0,0,.3)` → `hsl(var(--n-black) / 0.3)`；菜单底 `#1f2937` → `hsl(var(--n-gray-800))`；菜单描边 `rgba(255,255,255,.12)` → `hsl(var(--n-white) / 0.12)`；菜单阴影 `rgba(0,0,0,.4)` → `hsl(var(--n-black) / 0.4)`；按钮字 `#f9fafb` → `hsl(var(--n-gray-50))`。

*为什么用外观无关的令牌*：这块 chrome 贴在终端上，而终端板在明暗两种外观下**恒为深色**（0-C 已决、§8.3），所以它的配色本就与外观无关；写 `--card` / `--foreground` 这类语义令牌会让它在浅色外观下翻成浅色——那是可见改变，不是令牌化。

*证据与方法（探针转常驻）*：这次不是"替换引理"，而是**真装真读**——给 fixture 加 `readMobileSelectionChrome()`，用桩 terminal 真正调用 `installMobileTerminalSelection`，读回手柄 / 菜单 / 按钮的 computed 背景、边框、阴影、字色。**改前先跑一遍**记录 7 个值（确认期望来自字面代码，且两引擎序列化一致），改后再跑，7 个值逐位相同、明暗两态相同；随后把该探针转成常驻断言（两项 × 双引擎）。

*关于"移动端高发区需专项回归"*：§5.7 原要求改后在 iOS Safari 实机 / 模拟器验长按菜单、手柄与滚动。本片**只动色值，事件处理一行未改**（长按计时、拖拽、惯性滚动、菜单定位全部原样），行为面无回归面；配色面由上述常驻断言覆盖。该要求因此降级为"配色已自动覆盖、行为未触碰"，不再需要手工回归。

**共同门槛**：`build` exit 0；`test:client` **128 文件 / 973 用例**（本批不动前端用例，新增的是 playwright 侧）；`typecheck`（含 server）与 `typecheck:theme-tokens` 干净；`lint` **153 warnings / 0 error**；`test:theme-tokens` **16 → 26 通过**（0-F1 ＋6、0-F2 ＋4，均 × 双引擎）。

**对既有账的关系**：阶段 0 的迁移账（1517 → 0，余 1 处豁免）不受影响——0-F 处理的是 **JS 里的 hex**，不在 `theme-hardcoded-baseline.json` 与守恒律的口径内；B3 账户（`index.css` 选择器级消费者）也不受影响，本批未碰那些选择器。

### 阶段 1：主题扩展点

引入 `data-theme` + `ThemeManifest` + 内置主题注册表，内置 3–4 套主题（默认明 / 暗 + 2 套示范）。外观设置页加入主题选择器，并按 `coverage` 显示覆盖范围 badge。

**验收**：切换主题后主 UI、终端、编辑器、语法高亮、Git 图**同时**变化；`appearance: system` 主题跟随系统；首帧无闪烁；`theme-color` 与 iOS status-bar 随 `appearance` 同步更新；§5.11 契约测试与 §5.10 对比度断言通过。

**可选随附功能**：设置页内的"令牌预览页"——读 `getComputedStyle(document.documentElement)` 过滤出 `--` 变量、按命名空间分组渲染当前值与明暗对比色块。对主题作者是调试工具、对用户是透明度，实现成本不高，不进核心验收路径。（**已由 2-M 落地**，见切片表与 2-M 记录。）

**切片表（v1，1-A / 1-B / 1-B2 已实施；其前置 0-F 亦已实施）**

| 片 | 范围 | 状态 |
|---|---|---|
| 1-A | 主题骨架：`ThemeManifest` + `BUILTIN_THEMES` 注册表 + `<html data-theme>` | ✅ 已实施 |
| 1-B | **第一步**：随 `appearance` 在 `<html>` 显式写 `color-scheme`（本线第一个有意的视觉变更） | ✅ 已实施 |
| 1-B2 | **第二步**：逐条重审 `index.css` 里那批"暗色补偿"（§5.7 / §1.2 #8） | ✅ 重审完成（行号校正：0-C 时代锚点累计偏移 +223，实得 **69 处**色值声明；结论与 §5.7 原假设相左，改判"不能成批删除、只能令牌化"），拆为 a/b/c 三子片并**全部实施**，见本节 1-B2 记录 |
| 1-B2a | 删 B 段两行已失效的 `color-scheme: dark`（checkbox / radio） | ✅ 已实施（零变化，`73222abb`） |
| 1-B2b | C 段首 `textarea { color-scheme: light dark }` 改为随应用外观 | ✅ 已实施（**有意的视觉变更**，单独 `90785d25`） |
| 1-B2c | 68 处等值字面值改指令牌 | ✅ 已实施（**方案 A**：复用既有令牌保形间接，零变化，`fdf3f879`） |
| 1-C | `theme-color` 与 iOS `status-bar` 改由 `appearance` 驱动：去掉 `ThemeContext` 里两处硬编码 hex | ✅ 已实施（`1a9a7b78`）。**实现偏差**：不手写 HSL→hex，改用探针把 `hsl(var(--token))` 交给浏览器解析，只保留 alpha 合成；`ThemeManifest` 的 `themeColor` / `statusBar` 覆盖字段一并落地。**唯一有意的视觉变更**：浅色 theme-color `#f6f4ef → #f7f6f3`（原字面已与 `--background` 对不上），暗色逐位不变。见本节 1-C 记录 |
| 1-D | `themeId` 偏好键 + `ThemeContext` 暴露 `themeId` / `resolvedThemeId` / `setThemeId`（含 §5.6 的跨设备回落边界） | ✅ 已实施（`7ce0fbda`）。两处决策见 §5.6 v8：**system 豁免只属明暗键**（`setThemeId` 无条件写偏好）、**回落不静默**（生效 id 与所选 id 分开暴露 ＋ `console.warn`，选择器提示 UI 留 1-F）。未取主题时行为与改动前逐位一致（无 CSS 改动、产物 CSS 逐字节相同） |
| 1-E | 两套示范主题的覆盖层（**unlayered** `[data-theme]` 规则，含 `.dark` 分支）+ 注册表扩充 + `coverage` 标注 | ✅ 已实施（`695a6c1b` / `29fb85fa` / `08236ef0`，三片）。机制 ＋ `cc-ocean`（`accent`，只覆盖 L1 一个色族）＋ `cc-polar`（`full`：42 条基材/终端/图 ＋ 编辑器浅暗两半）；新增 `theme-overlays.spec.ts`（6 用例 ×2 引擎，逐主题参数化）与 fixture `readWithTheme`。**修正 §5.2 的 cascade 假设**（处理后无 `@layer`，改判为结构约定）；`cc-light` / `cc-dark` 定为外观默认、不进选择器（消解 1-D 边界一）。详见 §6 阶段 1 末 1-E 记录 |
| 1-F | 外观设置页主题选择器 + `coverage` badge（i18n 只补 zh-CN） | ✅ 已实施（`f2e03c6f`）。`settings/ThemeSelector` 列出 `appearance === 'system'` 的覆盖层主题（外观默认不进列表）＋ 一个「默认」项；徽标按 `coverage` 渲染；`themeId !== resolvedThemeId` 时出一行回落提示，补上 1-D 留下的消费者。归属按 `shared/ui` 准入线放 **settings 模块**（只有一个消费者）。**原计划"i18n 只补 zh-CN"的前提不成立**：实测仓库现状是 zh-CN ⊆ en（en 为键集基准），故实补 en ＋ zh-CN 两处。详见 §6 阶段 1 末 1-F 记录 |
| 1-G | JS 消费者随主题刷新：xterm 重读 `--term-*` 重设 `options.theme`、CodeMirror compartment reconfigure、Git 图 SVG 直接用 `var(--graph-lane-*)` | ✅ 已实施（`7b406986`）。**实测三路里只有 xterm 需要做**：编辑器（0-D 落地时 chrome 与 highlight 的每个色值都是 `var()`，由注入样式表在绘制时解析）与 Git 图（SVG 表现属性）都无需刷新，故代码改动仅"刷新 effect 补 `resolvedThemeId` 依赖"一处。新增 `shellTerminalThemeRefresh.test.tsx`（桩终端 ＋ 计数读取，4 例）与 `terminal-tokens.spec.ts` 一例（覆盖层确实移动色板 ＝ 刷新的前提）。§5.6 的"JS 消费者需要刷新"已按此收窄（v10）。详见本片记录 |
| 1-H | §5.11 契约测试扩到"遍历每套 `[data-theme]` 覆盖层"与 §5.10 对比度断言（`--ring`/`--background` ≥ 3:1、正文 ≥ 4.5:1） | ✅ 已实施（`38ef8d8e` / `13b9c696`）。对比度落地为 `tests/theme-tokens/contrast.spec.ts`：对"基色 ＋ 每套覆盖层"× 明暗两态断言 6 个配对（`--foreground`/`--muted-foreground` 各落 `--background` 与 `--card`、按钮文字落 `--primary`、`--ring` 落 `--background`），颜色读 fixture 的 `rendered` 层。**"正文"的读法是个口径分叉**：窄读（仅 `--foreground`）零改动即可落地，宽读（含 `--muted-foreground`）则基色浅色仅 4.42:1 不达标——用户拍板按宽读，并把 `--palette-sand-500` 由 `44%` 调到 `43%`（4.59:1，浏览器序列化后 4.62）。遍历侧补反向守卫：样式表里每个 `[data-theme]` 块都必须属于已注册覆盖层。详见阶段 1 末 1-H 记录 |
| 1-I | 首帧 chrome 色（JS bundle 执行之前的那一段）：splash 跟随明暗 ＋ `theme-color` 改由 `<head>` 末尾的内联同步脚本按存储偏好决定 ＋ `manifest` / `msapplication` 记为不可达 | ✅ 已实施（`e4f5cb70`）。由 1-C 顺带核出、用户拍板"按推荐"落地。**决定让 splash 也一起跟随明暗**——只改 `theme-color` 只是把"跳变"从深色用户搬到浅色用户（splash 恒深时，浅色用户的"深启动画面 → 浅界面"依然在）；一起跟随之后两侧都零矛盾、零跳变。机制不是新引入的，`mobile/www/index.html` 的 theme-color 早已是 media 查询式。含**有意视觉变更**：浅色外观的启动画面由深（`#0b0d10`）变浅（`#f7f6f3`，＝浅色 `--background`）。三处写者（脚本 / splash 规则 / media 兜底）的值按"必须一致"断言，而非各钉字面值。详见本片记录 |

**分片口径**：与阶段 0 同——每片独立迁移、独立验收、独立 commit、可单独回退；批次化（若合批）只合并重量级门槛的调用次数，片内仍逐片验。

#### 1-A 实施记录（2026-09-25）

**范围**：`src/shared/types.ts`（新增 `ThemeManifest`）、`src/shared/constants.ts`（新增 `BUILTIN_THEMES`）、`src/shared/context/ThemeContext.tsx`（写 `data-theme`）、`src/shared/tests/themeContext.test.tsx`（补 2 条）。**无 CSS 改动**。

**做了什么**：按 §5.2 的双轨模型建立骨架——`<html>` 同时携带 `class="dark"`（驱动 `dark:` 原子类与 base 语义值）与 `data-theme="<id>"`（选择主题覆盖层）。本片只建立后者：`ThemeContext` 在既有"应用外观"的 effect 里解析出与当前外观对应的内置主题 id 并写 `document.documentElement.dataset.theme`。注册表缺某一档位时**模块期抛错**，不静默留下无主题 id 的文档。

**模型澄清（与 §8.4 字面的关系，重要）**：§8.4 说"把「默认明 / 默认暗」建模为两套内置主题"，本片按字面落地——注册表确实含 `cc-light` / `cc-dark` 两套默认主题，id 保持 `cc-` 前缀（§5.8 的保留名约束）；但**主题选择语义按 §5.2 落地，即主题 id 与明暗正交**：一套具体主题用自己的 `[data-theme="<id>"]` 与 `[data-theme="<id>"].dark` 两条规则同时覆盖明暗两态，`cc-light` / `cc-dark` 只是基底（`index.css` 的 `:root` / `.dark`）的 id 别名，**light/dark/system 胶囊仍是唯一的明暗控制**，不出现第二个明暗选择器。这样 §8.4 的"避免双层选择器心智负担"与 §5.2 的 `.dark` 复合选择器结构同时成立；后续示范主题（1-E）按此模型只需一份覆盖层即可覆盖明暗两态。**（v9 补正：对绝大多数令牌"一份覆盖层"成立，1-E 的两套示范主题都验证了；唯一例外是编辑器 chrome——它的基底值是外观专属字面量而非 L1 引用，浅色半必须用 `:not(.dark)` 显式限定、暗色半另写 `.dark`，见 §5.3 v9 与 1-E 记录。）**

**视觉零变化的三路证据**：

| 证据 | 结果 |
|---|---|
| 令牌契约（浏览器解析值） | `test:theme-tokens` **16 通过**，`token-baseline.json` **逐位未动**（改动前后浏览器解析出的令牌值逐字节相同） |
| 构建产物 | 重建后 dist CSS 文件名哈希**未变**（`index-BZ-B_5--`），产物 CSS 中 `data-theme` 命中 **0** |
| 消费者普查 | 全仓（含 `tailwind.config.js`，`darkMode` 仍为 `["class"]`）**无任何 `[data-theme]` 消费者**，属性当前是纯接口 |

**门槛**：`test:client` **128 文件 / 972 用例**（原 970 ＋ 本片 2）；`typecheck` ×2 干净；`lint` **153 warnings / 0 error**；`build` exit 0。

**与既有账的关系**：阶段 0 的迁移账（1516 处 / 豁免 1 处）不受影响；阶段 1 不计处数，按片计。

#### 1-B 实施记录（第一步：`color-scheme`，2026-09-25）

**范围**：`src/shared/context/ThemeContext.tsx`（应用外观的 effect 里多写一行 `documentElement.style.colorScheme`）、`src/shared/tests/themeContext.test.tsx`（补 1 条 ＋ 在"首帧应用"那条加 1 断言 ＋ `beforeEach` 重置该属性）。**无 CSS 改动**。

**为什么单独成片、且记为"有意的视觉变更"**：`color-scheme` 是这条线上第一个**真改得动**的东西——前面所有片（阶段 0 全部 ＋ 1-A）都以"令牌基线逐位不动"为通过条件，而 `color-scheme` 恰恰**不在令牌基线的视野内**：它不参与任何 CSS 变量解析，只指挥 UA 渲染我们自己不画的部分。于是"令牌零变化仍成立"与"视觉确实变了"同时为真，两者不矛盾，但必须分开记账，否则这条线的"零变化"承诺会被悄悄破掉。

**实测（一次性 playwright 探针，chromium，读 `getComputedStyle`，跑完即删）**：

| 元素 | 改前 light | 改前 dark | 改后 light | 改后 dark |
|---|---|---|---|---|
| `html` / `select` / 无 `scrollbar-thin` 的滚动容器 | `normal` | `normal` | `light` | `dark` |
| `checkbox` / `radio` | `normal` | `dark` | `light` | `dark` |
| `textarea` | `light dark` | `light dark` | `light dark` | `light dark` |

三条结论：

1. **改前是真缺陷**：`select` 弹层与无 `scrollbar-thin` 的滚动容器在暗色界面下仍按 OS 渲染（headless 下即浅色）——`color-scheme` 缺位时 `normal` 的含义是"跟随 OS"，不是"跟随应用外观"。
2. **两行补偿在 `color-scheme` 这一项上已冗余**：`.dark input[type="checkbox"]` / `[type="radio"]` 里的 `color-scheme: dark` 现在与继承值相同。但**同块内的 `background-color` / `border-color` / `color` / `--tw-ring-*` 是另一回事**——它们把控件画成 `rgb(31 41 55)` / `rgb(75 85 99)` 这类具体灰阶，删掉就改由 UA 自绘，颜色随之变化。逐条判"删 / 留"是 1-B2 的工作。
3. **`textarea` 不随之变化**：元素级 `color-scheme: light dark` 压过继承，两种外观下都读 `light dark`——即 textarea 的原生件（滚动条 / 调整手柄 / 选区）仍跟随 OS 而非应用外观。这既是 1-B2 要处理的遗留，也是"不能只看静态 CSS 就断言补偿已多余"的反例。

**令牌面零变化仍成立**：`test:theme-tokens` **16 通过**、`token-baseline.json` **逐位未动**；`index.css` / `tailwind.config.js` 本次未改。

**门槛**：`test:client` **128 文件 / 973 用例**（972 ＋ 本片 1）；`typecheck` ×2 与 `typecheck:theme-tokens` 干净；`lint` **153 warnings / 0 error**；`build` exit 0。

**顺带核验出的一处欠账（发现即记账，未在本片修）**：核对 §5.7 表的前置条件时确认，**（当时）0-F 尚未实施**——`--graph-lane-*` 在 `index.css` 命中 **0**，`commitGraph.ts:20-29` 的 10 个 lane hex 与 `mobileTerminalSelection.ts` 的手柄 / 右键菜单 hex 全部仍在。阶段 0 的"迁移完成"只覆盖 §5.7 的第一类（Tailwind 具名中性色）；0-F / 0-G 两行一直挂在阶段 0 表里未执行。0-G 已改判入阶段 1（本片 ＋ 1-B2）；**0-F 当时保持未实施并注明它是 1-G 的前置——该欠账已于 2026-09-25 由 0-F1 / 0-F2 关闭，见本节（阶段 0）的 0-F 记录**。

#### 1-B2 重审结果（2026-09-25，**结论与 §5.7 的原假设相左；已拆三子片并全部实施，见下节记录**）

**枚举口径**：按 §1.2 #8 / §5.7 那组 0-C 时代锚点（0-D ＋ 0-E1 ＋ 0-E1b 累计偏移 **+223** 后即 `:701-742`、`:756-790`、`:792-841`、`:842-915`、`:970-1070`、`:1276-1345`、`:1375-1390`）逐行枚举，实得 **69 处色值声明 ＋ 3 处 `color-scheme` 声明**。设计文档记作"66 处"，差异来自计数口径（同一行两值算一处 / 是否含 tap-highlight）。分段：

| 段 | 行 | 色值声明 |
|---|---|---|
| A 滚动条补偿（`.scrollbar-thin` / `.dark::-webkit-scrollbar` / Firefox） | 701-742 | 9 |
| B checkbox / radio | 756-790 | 14（＋2 行 `color-scheme: dark`） |
| C textarea 文字 / 背景 / 聚焦 / `@supports` 分支 | 792-841 | 14（＋1 行 `color-scheme: light dark`） |
| D placeholder（四种前缀 ＋ `.chat-input-placeholder`） | 842-915 | 16 |
| E `-webkit-tap-highlight-color` | 970-1070 | 2 |
| F chat-input 滚动条 / 展开阴影 / `ring-offset` | 1276-1345 | 12 |
| G `select option` | 1375-1390 | 2 |
| **合计** | | **69** |

**结论 ①（最重要）：§5.7 那句"现状这些补偿正是在手写模拟 `color-scheme`"基本不成立，因此"能靠 `color-scheme` 自动跟随的成批删除"这条计划落不了地。** 一次性探针（chromium，读 `getComputedStyle`，跑完即删）把"有 `.dark` 覆盖"与"无 `.dark` 覆盖、仅靠 `<html>` 继承"两条路径并列：

| 量 | 有 `.dark` 覆盖 | 无覆盖（仅继承） | 读法 |
|---|---|---|---|
| checkbox 的 `color-scheme` | `dark` | `dark` | **该行已失效** |
| radio 的 `color-scheme` | `dark` | `dark` | **该行已失效** |
| checkbox 的 `background-color` | `rgb(31, 41, 55)` | `rgba(0, 0, 0, 0)` | **该行是活的** |
| textarea 的 `color-scheme` | `light dark` | `light dark` | 元素级声明压过继承 |

即：**真正因 1-B 而失效的只有 B 段那 2 行 `color-scheme: dark`**。同段的 `background-color: rgb(31 41 55)` / `border-color: rgb(75 85 99)` 是**刻意的外观选择**（灰 800 底 ＋ 灰 600 边），不是 `color-scheme` 的替身——删掉会让控件改由 UA 自绘，是看得见的变化。D 段的 `.dark textarea::placeholder { gray-600 }` 更明显：注释自己写着 `/* gray-600 - darker gray */`，是手工选定的"更暗灰"，与 `color-scheme` 无关。**故这批不删，改走令牌化。**

**结论 ②：真正让"应用外观到不了原生件"的遗留只有一处**——C 段首 `textarea { color-scheme: light dark }`：元素级声明压过继承，两种外观下都读 `light dark`，于是 textarea 的原生件（滚动条 / 调整手柄 / 选区）仍跟随 OS 而非应用外观。

**结论 ③：另查出 2 处已成死码**——`.dark .bg-gray-800 textarea`（`:825`）与 `.dark .bg-gray-800 textarea::placeholder`（`:854`，与仍活着的 `.dark textarea.bg-transparent::placeholder` 同在一条规则里）。阶段 0 把类名迁成 `bg-n-gray-800` 后，全仓（`src/` ＋ `index.html`）已无任何元素的类是 `bg-gray-800`，这两个选择器永不匹配；而它们**仍在产物里**（`dist/assets/index-*.css` 含 `.dark .bg-gray-800 textarea{…}`），即阶段 0 的"字面清零"在**产物侧**还留着 `bg-gray-800` 字样。这与 B3 记的"选择器级消费者"同类但根因不同（B3 是被迁移的 hover 选择器失配；此处是类名迁走后选择器全死）。**建议并入 B3 账户、阶段 2 统一收口，本片不删**，与 B3 已拍板的"不改不删、记账到阶段 2"一致。

**结论 ④：69 处里 68 处与既有令牌像素级等值**，只有 `rgb(237 235 230)`（G 段 `select option` 的暗色前景）找不到等值令牌。等值表（按次数）：

| 字面值 | 次数 | 等值令牌 |
|---|---|---|
| `rgb(243 244 246)` | 13 | `--n-gray-100` |
| `rgb(75 85 99)` | 12 | `--n-gray-600` |
| `rgb(156 163 175)`（含 `/0.3` `/0.5` `/0.7`） | 12 | `--n-gray-400` |
| `rgb(107 114 128)`（含 `/0.3` `/0.5` `/0.7`） | 6 | `--n-gray-500` |
| `rgb(37 99 235)` | 6 | 与 light `--ring` / `--primary` 等值，**但它们在 `.dark` 块内**，指向 `--ring` 会解析成 dark 的 blue-500 ≠ 现值 → 不可直接替换 |
| `rgb(31 41 55)` | 4 | `--n-gray-800` |
| `rgb(20 20 20)` | 3 | `--background`（dark） |
| `rgb(38 38 38)`（`/0.3` `/0.5`） | 3 | `--n-neutral-800` |
| `rgb(59 130 246)` | 2 | 与 dark `--ring` 等值（同上，语义蓝非中性，不替换） |
| `rgb(115 115 115)` | 1 | `--n-neutral-500` |
| `rgb(31 31 31)` | 1 | `--card` / `--popover`（dark） |
| `rgba(0, 0, 0, ·)` | 5 | `--n-black`（alpha 照写） |
| `rgb(237 235 230)` | 1 | **无等值令牌** |

**建议的 1-B2 拆法（2026-09-25 已拍板并全部实施，见下节记录）**：

| 子片 | 内容 | 视觉 |
|---|---|---|
| **1-B2a** | 删 B 段两行已失效的 `color-scheme: dark` | **零变化**（已实测证明） |
| **1-B2b** | C 段首 `textarea { color-scheme: light dark }` 改为随应用外观（删该声明让其继承） | **有变化**：textarea 原生件从"跟 OS"改为"跟应用外观" |
| **1-B2c** | 把 68 处等值字面值改指令牌（`rgb(237 235 230)` 一处需定：新建令牌 or 留字面） | **零变化**（可逐条用 `getComputedStyle` 探针证明等值） |

**当时待拍板的两点（已于 2026-09-25 拍板，答复见下节记录）**：① 1-B2b 是否按"跟随应用外观"改（这是本片唯一有意的视觉变更，且它取代的正是 §5.7 设想的"成批删除"）；② 1-B2c 指令牌的形态——直接复用 `--n-*`（改动最小，但语义偏松、阶段 2 语义化时还要再改名一次），或按 §5.7 原计划新建 `--scrollbar-*` / `--control-*` / `--placeholder` 三组（语义正，但要为这 69 处声明多建约 20 个令牌，且 §5.7 那三个组的原意"承接删不掉的部分"已随结论 ① 改变）。

#### 1-B2a / 1-B2b / 1-B2c 实施记录（2026-09-25，**已拍板并实施，三片各自独立 commit**）

**拍板结论**：① 1-B2b 按"跟随应用外观"改（推荐项）；② 1-B2c 取**方案 A**——复用既有令牌做保形间接，`rgb(237 235 230)` 一处记豁免。三片按"1-B2a → 1-B2b → 1-B2c"顺序实施，每片独立迁移、独立验收、独立 commit（`73222abb` / `90785d25` / `fdf3f879`），可分别回退。三片都只动 `src/index.css`。

**1-B2a（`refactor(theme)`，零变化）**：删掉 `.dark input[type="checkbox"]` / `[type="radio"]` 里的 `color-scheme: dark`（各 1 行），并在两处注释里写明 `color-scheme` 改由 `<html>` 提供。同块的 `background-color` / `border-color` / `color` 原封不动（它们是刻意的外观选择，交由 1-B2c）。

**1-B2b（`fix(theme)`，唯一有意的视觉变更）**：删掉 C 段首的 `textarea { color-scheme: light dark }`（连同其空规则），并把原注释扩写为"为何此处**故意不**钉 `color-scheme`"。这是 1-B2 认定的唯一一处"应用外观到不了原生件"的遗留。

**1-B2c（`refactor(theme)`，零变化）**：68 处按段改走令牌，映射如下（完整表见 commit body）：

| 字面值 | 次数 | 令牌表达 |
|---|---|---|
| `rgb(243 244 246)` | 13 | `hsl(var(--n-gray-100))` |
| `rgb(75 85 99)` | 12 | `hsl(var(--n-gray-600))` |
| `rgb(156 163 175)` ＋ `/0.3` `/0.5` `/0.7` | 6 ＋ 2＋3＋1 | `hsl(var(--n-gray-400)[ / a])` |
| `rgb(31 41 55)` | 4 | `hsl(var(--n-gray-800))` |
| `rgb(107 114 128, a)`（`/0.3` `/0.5` `/0.7`） | 2＋2＋1 | `hsl(var(--n-gray-500) / a)` |
| `rgba(38, 38, 38, a)`（`/0.3` `/0.5`） | 1＋2 | `hsl(var(--n-neutral-800) / a)` |
| `rgba(115, 115, 115, 0.5)` | 1 | `hsl(var(--n-neutral-500) / 0.5)` |
| `rgba(0, 0, 0, a)`（`.05` `.1` `.2` `.3`） | 1＋3＋1＋1 | `hsl(var(--n-black) / a)` |
| `rgb(37 99 235)` | 6 | `hsl(var(--palette-brand-500))` |
| `rgb(59 130 246)` | 2 | `hsl(var(--palette-brand-400))` |
| `rgb(20 20 20)`（只在 `.dark` 内） | 3 | `hsl(var(--background))` |
| `rgb(31 31 31)`（只在 `.dark` 内） | 1 | `hsl(var(--card))` |
| `rgb(237 235 230)` | 1 | **豁免**，保留字面（无等值令牌） |

两处刻意的选择：**① 两个 blue 用 L1 而非 L2**——`--n-*` 是中性兼容刻度，装不下 blue；而这两组声明位于 `.dark` 块内，写 L2 的 `--primary` / `--ring` 会解析成 dark 分支的值（blue-400 / blue-500）而非现值，故取外观无关的 L1 `--palette-brand-500` / `-400`。**② `rgb(20 20 20)` / `rgb(31 31 31)` 用 L2**——它们本来就只在 `.dark` 里消费，解析结果正分别是 ink-950（`--background`）与 ink-900（`--card`），语义也更准。行尾的步数标注（`/* gray-800 */` 等）一律保留，使该 commit 的 diff 是一份**纯粹的"值替换"**，无任何结构或注释改动，便于逐行配对复核。

**零变化的两层证据（一次性 playwright 探针，chromium ＋ webkit，跑完即删）**：

| 层 | 做法 | 结果 |
|---|---|---|
| **替换引理** | 对每一组 (字面, 令牌表达式) 在探针元素上并列渲染并比 `getComputedStyle`，共 26 组（含两条复合 `box-shadow`） | 逐位相同；**改前先跑一遍**验证期望值确实来自字面代码，**改后跑一遍**证明等值——两遍都过，排除了"探针写错期望值"与"探针空转"两种假绿 |
| **真实选择器** | 按真实选择器读规则落地的值：checkbox / radio 的 `background-color` / `color`、textarea 的 `color` / `-webkit-text-fill-color` / `caret-color`、滚动条伪元素、`select option`、`chat-input-expanded` 的 `box-shadow`、`ring-offset` 自定义属性（经继承子元素解析） | 20 条断言在两种外观下命中字面等值。webkit 上只有 `scrollbar-color` **属性本身不支持**（两侧都读空），故该属性只在 chromium 断言，其余 17 条两浏览器同值 |

探针顺带查明两处**浏览器固有遮蔽**，已写进探针注释备查（它们让"看起来最该用来证明相等"的两条通道其实无效）：`appearance: auto` 的表单件 `border-color` 由原生主题回报而非作者声明（探针 checkbox 还带 `border-width: 0`）；`::placeholder` 的 computed `color` 由元素的 `-webkit-text-fill-color` 回报。因此 D 段 16 处 placeholder 值**不能**用伪元素读数证明相等，靠替换引理覆盖。

**产物级核对（前后各构建一次，逐规则比对）**：规则数 **2592 → 2591**，减少的正是 `textarea{color-scheme:light dark}` 这一条规则；1-B2a 只减声明不减规则。逐规则文本 diff 共 129 行变动，**全部**落在三片预期内：68 处值替换（minifier 把字面折成 `#9ca3af80` 之类的形式一并换成 `hsl(var(--n-…))`）、两处 `color-scheme:dark` 消失、一条规则消失。顺带可见 Tailwind 为 `bg-transparent` / `bg-gray-800` 等类名生成的变体垃圾规则也同步令牌化，无"一半令牌一半字面"的劈叉。

**门槛**：`test:client` **128 文件 / 973 用例**全绿；`typecheck`（含 `typecheck:theme-tokens`）干净；`lint` **153 warnings / 0 error**；`build` exit 0；`test:theme-tokens` **16 通过**（含 token 契约 4 项），`token-baseline.json` 与 `theme-hardcoded-baseline.json` **均逐位未动**——`rgb()` 属性声明不在两者的口径内（前者只覆盖**自定义属性**的解析值，后者只覆盖 Tailwind 具名中性色**原子类**；契约里那条"颜色不得持字面值"也只把 HSL 三元组形式的自定义属性判为颜色），**这正是本片必须自建探针而不能只靠既有门槛的原因**。改后该块只剩 1 处 `rgb()` 字面，即上表豁免项——已用逐行 grep 定量确认。

**顺带修正 1-B2 记录的两处按值计数笔误**：`rgb(107 114 128, …)` 是 **5 处**（原记 6），`rgba(0, 0, 0, …)` 是 **6 处**（原记 5），一多一少相抵，合计仍是 69。

**与既有账的关系**：B3 账户（`index.css` 里选择器级消费者 ＋ `.dark .bg-gray-800 textarea` 死码）**不受影响**——B3 记的是"选择器永不匹配"，本片只换值不动选择器，故死码选择器原样留在产物里（`dist` 中仍是 `.dark .bg-gray-800 textarea{color:hsl(var(--n-gray-100))!important;…}`），阶段 2 一并收口。

#### 1-C 实施记录（2026-09-25，`1a9a7b78`）

**范围**：`src/shared/utils.ts`（新增 THEME CHROME 组：`applyThemeChrome` 及其三个私有帮手）、`src/shared/context/ThemeContext.tsx`（删两处 hex、合并两分支）、`src/shared/types.ts`（`ThemeManifest` 加 `themeColor` / `statusBar` 可选覆盖）、`tests/theme-tokens/`（fixture 加 `readThemeChrome` ＋ 新增 `theme-chrome.spec.ts` ＋ tsconfig ＋ README）、`src/shared/tests/themeContext.test.tsx`。**无 CSS 改动**。

**做了什么**：浏览器 chrome（iOS 状态栏 / 地址栏）在页面之外，读不到 token，所以改由 JS 桥接——`applyThemeChrome` 用探针把 `hsl(var(--token))` 交给浏览器解析再回读，样式表仍是唯一真源。原 dark / light 两分支里重复的四个 `querySelector` 收成一次，`builtinThemeIdFor` 改为 `builtinThemeFor` 直接返回 manifest（`id` 之外还要用它的覆盖字段）。

**实现偏差（比 §5.9 草案更强，同 0-D 的记录体例）**：§5.9 设想的"统一解析函数（HSL→hex、alpha 与背景合并）"前提是**自己解析令牌字符串**。探针法让浏览器完成 HSL→hex 这一半（`hsl(var(--x))` 正是 Tailwind 发的声明形状），只保留草案里真正必要的另一半——把 alpha 合成到不透明底色上。合成失败（底色缺失或也带 alpha）返回空，调用方保留 `index.html` 的 `#ffffff`，**不发布解析失败的残留值**。

**三处判断**：

1. **先查令牌是否已声明，再探针**。否则未声明的令牌会让 `hsl(garbage)` 落回探针元素的继承色 `rgb(0,0,0)`，被当作主题色发布出去（jsdom 与首帧前都会走到这条路径）。同理，令牌若持完整颜色表达式（`#282c34`）则声明非法，浏览器丢弃后也落到同一处——两者都判为"解析失败"。
2. **`ThemeManifest.themeColor` 取令牌名**（默认 `--background`）而非字面色值：与"样式表是真源"一致，且用户主题只需在自己的覆盖层里定义该令牌即可。`statusBar` 取 iOS 关键字（`default` / `black` / `black-translucent`）。这是对 §5.9"避免解析误差"的字面偏离——探针法下"解析误差"已不存在，故改为更强的形态（记录在此，§5.9 同步）。
3. **不做外观无关的特判**：`--background` 两个外观各有取值，由其所属规则决定；本片不额外处理。

**唯一有意的视觉变更**（已按纪律先拍板，单独量化）：

| 外观 | 原手写字面 | 派生真值 | 差异 |
|---|---|---|---|
| light | `#f6f4ef`（实为 hsl(42.9 28% 95.1%)） | `#f7f6f3`（hsl(44 22% 96%)） | **Δ +1 / +2 / +4** |
| dark | `#141414` | `#141414`（hsl(0 0% 8%)） | 逐位相同 |

浅色那个字面**和当前 `--background` 已经对不上**（注释还写着 "warm cream"），派生即把该不一致修掉；暗色外观零变化。三选一里的另两条（保留字面覆盖 / 只做结构改造不接令牌）已在该片拍板时否决——后者会让 1-E 之后主题覆盖 `--background` 时 chrome 不跟随，1-C 等于白做。

**证据**：

| 层 | 做法 | 结果 |
|---|---|---|
| **探针（双引擎）** | 改前先跑一遍记录全部分支 | light `#f7f6f3` / dark `#141414`；statusBar `default` / `black-translucent`；覆盖生效；未知令牌落 `#ffffff`；alpha 用真实令牌 `--nav-tab-glow`（`/ 0.18`）合成得 `#d1dcf2`，与独立算式逐位一致 |
| **变异测试（两条）** | ① 绕开 alpha 合成（`alpha >= 1` 改 `>= 0`）② 忽略主题覆盖（`overrides?.themeColor ?? '--background'` 改死） | ① **有且仅有**第三条断言变红；② 恰好第三、四条变红（前两条不依赖覆盖，仍绿）。两条都证明对应断言不是空转 |
| **常驻断言** | 探针转 `tests/theme-tokens/theme-chrome.spec.ts`，4 项 × 双引擎 | 期望值由**另一条路径**交叉验证（fixture 直接渲染 `hsl(var(--background))` / `hsl(var(--nav-tab-glow))` 后由 spec 自行换算），不照抄数字；含"覆盖 `--background` 后 chrome 跟随"一条，防硬编码回归。JS 消费者守卫 README 补成四份 |
| **产物前后对照** | 临时 worktree 构建 `bf0e4824` | `f6f4ef` **1 → 0**、`141414` **4 → 3**（余 3 处全来自 react-scan 浮层，与本片无关）、`apple-mobile-web-app-status-bar-style` 与 `theme-color` 各 **2 → 1**（两分支收成一个）；**CSS 逐字节相同**（md5 一致）——本片未触碰任何样式 |

**门槛**：`test:client` **128 文件 / 974 用例**（+1 为本片新增）；`typecheck`（含 server）与 `typecheck:theme-tokens` 干净；`lint` **153 warnings / 0 error**；`build` exit 0；`test:theme-tokens` **26 → 34 通过**；两个基线文件均未动（本片不改令牌）。

**顺带记账（均未在本片处理）**：

1. ~~**JS 跑起来之前的 chrome 色**~~ **已由 1-I（`e4f5cb70`）落地**：`index.html` 的静态 `<meta name="theme-color" content="#ffffff">` 曾是首帧生效值，且与 splash 的固定深色底**自相矛盾**（深色外观下＝白色状态栏压着一屏深色）；1-I 用一段 `<head>` 末尾的同步脚本把它改为随外观决定，并给 splash 补了浅色变体。`public/manifest.json` 的 `theme_color` 与 `mobile/www/index.html` 的 media 双条**仍在原状**——前者是安装期静态色、运行时改不了（平台限制，记账为不可达），后者是 Capacitor 选择页的独立色板（不加载令牌，方向本就正确）。详见 §5.6 v8 与 1-I 记录。
2. **`react-scan` 进了生产产物**：`src/main.tsx:3` 静态导入 `scan`，`:18` 才用 `import.meta.env.DEV` 在**运行期**关掉——即关闭的是执行而非打包，整个库（含自带硬编码色的浮层）仍在 bundle 里（产物中 3 处 `#141414` 即出自它的 FPS 面板）。属既有问题、与主题线无关，但既是体积问题也是"未入册的硬编码色"来源，建议单独一句记账。

#### 1-D 实施记录（2026-09-26，`7ce0fbda`）

**范围**：`src/shared/userSettings.ts`（`UserPreferences` 新增 `themeId: string | null` ＋ `LEGACY_STORAGE_KEYS` 给一个空 legacy 位置——该键从来没有浏览器本地来源）、`src/shared/context/ThemeContext.tsx`（新增 `builtinThemeById` / `resolveTheme`、`themeId` 状态、`resolvedThemeId` 派生、`setThemeId`、远端同步、回落告警；`data-theme` 与浏览器 chrome 的取值来源由"外观默认主题"改为"生效主题"）、`src/shared/tests/themeContext.test.tsx`（+5）。**无 CSS 改动**。

**做了什么**：把"用户选的主题"从零变成一条可持久化、可跨设备同步、可由设置页读写的独立状态。按 §5.2 的双轨模型，`themeId` 只决定 `[data-theme]` 覆盖层，明暗仍由 `theme` 键（胶囊）唯一控制——因此 `setThemeId('cc-dark')` 在浅色外观下把 `data-theme` 写成 `cc-dark`，胶囊不动。解析统一走 `resolveTheme(themeId, appearance)`：注册表里有就用它，否则返回外观默认。偏好键本身复用既有镜像与 hydrate 链路，故跨设备同步零新增代码。

**两处决策**（§5.6 v2 明写"需决定"，已回写该节 v8）：

1. **`system` 分支的豁免不延伸到 `themeId`**。`setTheme('system')` 不写偏好的原意是"本机临时态别覆盖跨设备的永久选择"；而挑主题本身就是一次显式选择、没有 system 对应物，所以 `setThemeId` 无条件 `writeUserPreference`。断言直接压住这对不对称：system 外观下选主题 → `themeId` 有值、`theme` 仍为 null。
2. **回落不静默**。既不"静默回落"也不"阻止选择"：`resolveTheme` 返回外观默认，`ThemeContext` 把**生效 id**（`resolvedThemeId`）与**用户所选 id**（`themeId`）分开暴露，effect 里 `console.warn` 报出"此设备未安装 X、已回落 Y"。**选择器上的提示 UI 留给 1-F**（届时的判据就是 `themeId !== null && themeId !== resolvedThemeId`），本片不引入无消费者的提示状态字段。

**两条边界（本片未定，不阻塞）**：

1. **默认别名与胶囊的关系**：用户显式选了 `cc-light` / `cc-dark`（与外观同名的默认别名）之后再切明暗胶囊，`data-theme` 应留在所选别名还是回到外观默认——属 1-E 扩充注册表时要一并定的模型问题。1-D 阶段这两个 id 都无覆盖层，两种解释视觉等值，故不影响本片；已记入 §5.6 v8。
2. **提示 UI**：见决策 2，随 1-F。

**证据**：

| 层 | 做法 | 结果 |
|---|---|---|
| **变异测试（三条）** | ① 解析忽略 `themeId`（`resolveTheme` 恒返回 `builtinThemeFor`）② 删远端同步（subscribe 里不再 `setThemeIdState`）③ 删回落告警 | ① **恰 3 红**（"选主题生效" / "清除回默认" / "远端采纳"），而**"不豁免"那条仍绿**——它只断言偏好写入，正确地不依赖解析；② **恰 1 红**（"an overlay picked elsewhere is adopted here"）；③ **恰 1 红**，失败信息即 `the fallback must be announced rather than silent`。三条各证明对应断言非空转 |
| **默认零变化** | 既有 9 条测试**一行未改** | 仍全绿：`data-theme` 跟随外观（`cc-light` / `cc-dark`）、`color-scheme`、chrome、system 本机豁免。未选主题时 `resolvedThemeId` 恒等于外观默认 |
| **产物前后对照** | 临时 worktree 构建 `1ab5622f` | dist CSS 文件名哈希（`index-B0eB4Ybq.css`）与 md5（`3c2985b7…`）**均与改动前逐字节相同**；`git diff --name-only` 无 `.css`（本片不碰任何样式） |
| **令牌基线** | `test:theme-tokens` | **34 通过**（未新增），`token-baseline.json` 逐位未动 |

**门槛**：`test:client` **128 文件 / 979 用例**（974 ＋ 本片 5）；`typecheck`（含 server）与 `typecheck:theme-tokens` 干净；`lint` **153 warnings / 0 error**；`build` exit 0。

**与既有账的关系**：阶段 0 迁移账（0 处 / 余 1 处豁免）与 B3 账户（`index.css` 选择器级消费者）均不受影响——本片未碰任何 CSS；阶段 1 不计处数，按片计。


#### 1-E 实施记录（2026-09-26，`695a6c1b` / `29fb85fa` / `08236ef0` 三片）

**范围**：三片围绕同一个机制，按"机制 → 覆盖面 → 唯一需要 `.dark` 分支的面"递进。

| 子片 | commit | 内容 |
|---|---|---|
| 1-E1 | `695a6c1b` | 覆盖层机制 ＋ 第一套示范主题 `cc-ocean`（`coverage: accent`）：`src/index.css` 新增 unlayered `[data-theme="cc-ocean"]` 块；`BUILTIN_THEMES` 由 2 增至 3（新增 `cc-ocean`）；`ThemeManifest.appearance` 注释扩写为两角色；fixture 新增 `readWithTheme(id, appearance)`；新增 `tests/theme-tokens/theme-overlays.spec.ts`（4 用例 ×2 引擎）＋ README ＋ tsconfig；`themeContext.test.tsx` 把"用作数据"的覆盖层 id 从 `cc-dark` 换成 `cc-ocean`、未安装样本改 `cc-not-installed`、注册表测试改为"外观默认与覆盖层主题分开"（仍 14 用例） |
| 1-E2 | `29fb85fa` | 注册表增至 4（新增 `cc-polar`，`coverage: full`）＋ 第二套示范主题的**基材**（12 条）＋**终端**（20 条）＋**Git 图**（10 lane）共 42 条声明；`SURFACES` 新增 `cardSurface` 组（`--card` / `--popover` 只在暗色外观进入 full 主题的可达范围） |
| 1-E3 | `08236ef0` | `cc-polar` 的**编辑器**覆盖层——本线第一个必须拆 `.dark` 分支的面（它基底是外观专属字面量而非 L1 引用）：浅色 `[data-theme="cc-polar"]:not(.dark)` 23 条 ＋ 暗色 `[data-theme="cc-polar"].dark` 28 条；测试新增 `resolve()` 与"浅色半不泄漏进暗色"守卫 |

**做了什么**：把 §5.2 的双轨模型从"骨架"落成"能换肤"。`<html data-theme>` 选覆盖层，`<html class="dark">` 仍唯一控制明暗；每套主题的覆盖层是**跟在 `index.css` 末尾的普通规则**（任何 `@layer` 之外），与基底同处一个文档，靠文档顺序取胜。两套示范主题覆盖了 §4 目标 3 要的两种形态：`cc-ocean` 是**最小增量**（只换强调色），`cc-polar` 是**完整换肤**（基材 / 强调 / 终端 / Git 图 / 编辑器全部换到冷色轴）。

**关键决策**：

1. **`accent` 主题覆盖 L1 而非 L2**（与 §5.1 原字面相反，已回写 §5.1 v9）。`cc-ocean` 只声明 `--palette-brand-500` / `--palette-brand-400` 两个值，`--primary` / `--ring` / `--nav-tab-glow` / `--nav-input-focus-ring` 四个强调面在两个外观下同时移动。收益有三：写法最短、不必写 `.dark` 分支（基底 `:root` / `.dark` 已各自挑好 brand 档位）、且不触犯契约测试"no colour token holds a literal value outside the palette"。
2. **L1-only 覆盖层不需要 `.dark` 分支**，因为 L1 只在 `:root` 声明一次、不在 `.dark` 镜像；两态差异由基底引用哪个档位承担。**需要 `.dark` 分支的只有"基底值是外观专属字面量"的令牌**——全仓仅编辑器 chrome 一处，这正是 `cc-polar` 拆两半的原因。
3. **`appearance` 的两个角色落定**（已回写 §5.3 v9）：`light` / `dark` 是外观默认（基底别名，不进选择器），`system` 是覆盖层主题（选择器提供的那一类）。"没有覆盖层"由 `themeId === null` 表达。**这顺带消解了 1-D 记录的模型问题**（§5.6 v8 边界一）：`cc-light` / `cc-dark` 既不是可选覆盖层，"显式选默认别名再切胶囊"这个场景不会发生。
4. **浅色半用 `:not(.dark)` 限定**（已回写 §5.3 v9）。裸 `[data-theme]` 在暗色下也命中、只输给 `.dark` 块——两半都重复的令牌照样正确，但**只在浅色半声明、忘在暗色半补**的令牌会静默泄漏浅色值。`:not(.dark)` 让这种遗漏构造上不可能。**这条是被变异测试逼出来的**（见下，最初版本全绿）。
5. **§5.2 的 cascade 硬约束改判性质**（已回写 §5.2 v9）：实测处理后样式表**没有 `@layer`**（fixture `layers: []`、产物 0 at-rule），覆盖层今天靠文档顺序取胜。那条约束从"取胜机制"降为"真 layer 管线下的健壮性约定"，故改由**结构断言**（`layerDepthAt` 数 `@layer` 包围层数 = 0）强制，不指望值断言能证明。
6. **有意不覆盖的令牌，都写了理由**（留在 CSS 注释里）：`--palette-white` 不覆盖（浅色卡片保持纯白坐在染色基材上，与基底"纯白卡片坐在暖砂上"同构）；`--n-white` / `--n-black` 不覆盖（永远暗色的终端选区 chrome 的白描边 / 黑阴影，本就与外观无关）；`gray` / `zinc` / `slate` / `neutral` 四条兼容 ramp 不覆盖（承载约 1.5k 个工具类站点，设计靠明暗档位而非色相）。

**如实边界（本片未做，不阻塞）**：

1. **语法高亮不在覆盖层可达范围内**：`--cc-syntax-1..7` 在 L1 里没有对应条目，§8.9 又已决"本轮不升语义名"，故 `full` 主题也不改语法高亮。`SURFACES` 里没有 `syntax` 组是**如实反映边界而非漏写**（已记入 §5.11 v7）。
2. **对比度断言未做**，连同"遍历完整化"随 1-H。本片另跑了一次性对比度自检（见证据表），结论已足以让 1-H 从已知状态起步。
3. **选择器 / `coverage` badge 未做**（1-F）；**JS 消费者刷新未做**（1-G）。

**证据**：

| 层 | 做法 | 结果 |
|---|---|---|
| **变异测试（三条，均已复跑确认）** | ① 把 `cc-ocean` 覆盖层**临时包进 `@layer base`**（补上闭合括号，保持 CSS 合法）② 浅色半**去掉 `:not(.dark)`** 写成裸 `[data-theme="cc-polar"]` ③ 给 `cc-ocean` **越界加一条基材覆盖** `--palette-sand-100` | ① **恰 2 红**——只有结构断言（`every overlay theme is declared outside any @layer`，两引擎各一）变红，**44 条值/浏览器断言全绿**：这正是"仅凭 resolved 值抓不到 layering"的证明，也是它必须单独做成结构断言的原因 ② **恰 2 红**——只有泄漏守卫（两引擎各一）变红。**注意：这条守卫是为这个变异补的**——最初版本此变异**全绿**，因为它只查"浅色半独有的令牌在暗色下是否回落"，而裸选择器下测试甚至不认为存在"浅色半"；补上"必须存在浅色限定块"的反空转断言后才红 ③ **恰 2 红**——`cc-ocean (accent)` 逐主题测试两引擎各一，证明 `coverage` 的**反向** must-not-move 非空转 |
| **产物核对** | 构建产物 grep `[data-theme` | 三块 `[data-theme=cc-polar]`、`[data-theme=cc-polar]:not(.dark)`、`[data-theme=cc-polar].dark` 均在，且三者 `layerDepthAt` **均为 0**（结构断言常驻，非一次性） |
| **cascade 实测** | 临时探针（`_probe.spec.ts`，用后即删）读服务端样式表形状 | `sheets: 1, rules: 2034, layers: [], hasUtility: true`；产物命中 `@layer` **0** 次。据此把 §5.2 的"layered 恒低于 unlayered"改判为健壮性约定 |
| **零变化边界** | 外观默认为恒等 | 新增 `the accent theme is the identity when no overlay is picked`：对 `cc-light` / `cc-dark` 设 `data-theme` 后令牌与基底**逐位相同**——**未选主题时的现有外观零变化**，这张断言也是"日后有人给默认别名加覆盖层"的绊线 |
| **对比度自检** | 一次性脚本从 HSL 三元组算 sRGB 相对亮度比（未入库，为 1-H 探路） | `cc-polar` 浅色：fg/bg **17.12**、muted/bg **4.58**、primaryFg/primary **4.62**、ring/bg **4.42**；暗色：**13.95 / 5.83 / 6.13 / 6.13**。基底浅色 muted/bg **4.43** 是全仓唯一低于 4.5 的值，`cc-polar` 反而改善。Git lane 最差比 **2.12（浅）/ 4.00（暗）** vs 基底 1.77 / 4.12。修掉两处回归：浅色编辑器 gutter 从 `sand-500` on `sand-100`（**4.15:1**，比基底 4.82 更差）改到 `sand-50`（**4.58:1**）；`cc-ocean` 浅色强调色从文档示例的 `175 84% 32%`（对白字只有 **3.49:1**）改为 `173 75% 27%`（**≈4.9:1**） |
| **令牌基线** | `test:theme-tokens` | 计数 **34 → 42 → 44 → 46**（1-E1 ＋4 用例×2，1-E2 ＋1×2 逐主题给 `cc-polar`，1-E3 ＋1×2 泄漏守卫）；`token-baseline.json` **逐位未动**——基线读的是不带 `data-theme` 的 `<html>`，覆盖层永不会进基线，这正是覆盖层要用 `readWithTheme` 单独读的原因 |

**门槛**（三片各自跑过；此处为收尾片的最终值）：`test:theme-tokens` **46 通过**；`test:client` **128 文件 / 979 用例**；`typecheck`（含 server）与 `typecheck:theme-tokens` 干净；`lint` **153 warnings / 0 error**；`build` exit 0。

**与既有账的关系**：阶段 0 迁移账（0 处 / 余 1 处豁免）与 B3 账户（`index.css` 选择器级消费者）均不受影响——覆盖层新增的是 `[data-theme]` 选择器块，不是 Tailwind 具名色，故不计入迁移账；阶段 1 不计处数，按片计。三片共改 8 个文件（`src/index.css`、`src/shared/constants.ts`、`src/shared/types.ts`、`src/shared/tests/themeContext.test.tsx`、`tests/theme-tokens/{main.ts, theme-overlays.spec.ts, README.md, tsconfig.json}`），**未触碰任何组件**。


#### 1-F 实施记录（2026-09-26，`f2e03c6f`）

**范围**：`src/modules/settings/ThemeSelector.tsx`（新，98 行）、`src/modules/settings/tabs/AppearanceSettingsTab.tsx`（把选择器接进「主题」卡片，该卡片转 `divided`）、`src/modules/settings/tests/themeSelector.test.tsx`（新，5 用例）、`src/modules/i18n/locales/{en, zh-CN}/settings.json`（各新增 `themeSelector` 组，6 个叶子键）。**无 CSS 改动**——选择器只用既有令牌类。

**做了什么**：给 1-E 造出来的覆盖层一个入口。在此之前 `cc-ocean` / `cc-polar` 只能靠直接改 `localStorage` 生效，用户在界面上看不见也点不到——1-E 的产物缺的就是这个消费者。

**关键决策**：

1. **归属是 settings 模块，不是 `shared/ui`**。`ThemeModeSelector` 住在 `shared/ui` 是因为它有**两个**消费者（settings 与 quick-settings-panel），而 `shared/ui/index.ts` 的注释把"第二个消费者"定为准入线。`ThemeSelector` 本片只有一个消费者，故放 `src/modules/settings/` 且**不进任何 barrel**（barrel 规则：只导出有真实消费者的东西）。它仍消费共享的 `ThemeContext`——那是**上下文所有权**（`ThemeContext` 无明确功能归属 → 共享），与 **UI 归属**是两条独立的规则。（本片收尾自查时按此线把组件从 `shared/ui` 移回，同一次 amend 内完成。）
2. **列表只列 `appearance === 'system'` 的主题**。外观默认（`cc-light` / `cc-dark`）是基底别名、不进选择器——即 1-E 定的模型（§5.3 v9）。
3. **选中态必须先过"是不是覆盖层 id"这一层过滤**（已记入 §5.3 v10）。`setThemeId` 接受任意字符串，`cc-dark` 是合法输入（1-D 的边界一）；不过滤则该项状态下**没有任何一项被标记**，界面读起来像"什么都没选"。过滤后别名归到「默认」项，与实际生效的配色一致（别名本就无覆盖层）。
4. **徽标按 `coverage` 渲染，未声明则不渲染**——不替主题编一个默认值。§4 目标 3 的"结构性一致"落点就在此，而徽标说的正是覆盖层契约测试逐令牌核对的那件事。
5. **回落提示是 §5.6 v8 决策二唯一的消费者**（已记入 §5.6 v9）。判据取"两个 id 不相等"而非"所选 id 不在注册表里"——`resolveTheme` 已是唯一解析入口，选择器再查一遍注册表就是在养第二份真源。
6. **i18n 同时加 en 与 zh-CN**。实测仓库现状是 **zh-CN ⊆ en**（zh-CN 无独有键，en 独有 155 个），说明 **en 才是键集基准**，故两处都加，而不是只加 zh-CN。**主题显示名不走 i18n**：它读 `manifest.name`，因为用户主题（§5.5）会自带名字，名字是**主题元数据**而非界面文案。
7. **无 CSS、无新令牌**：选择器复用 `border-primary` / `bg-background` / `text-muted-foreground` / `ring-ring` 等既有语义类，所以本片对令牌契约面与覆盖层面都是零影响。

**如实边界（本片未做，不阻塞）**：

1. **只接了外观设置页**。`quick-settings-panel` 的 `QuickSettingsContent` 也渲染 `ThemeModeSelector`，但本片没把覆盖层选择器放进去——1-F 的定义就是"外观设置页主题选择器"。若日后要加，按同一准入线应把组件**提升到 `shared/ui`**。
2. **不做色块预览**。徽标是**文本**（强调色 / 完整）而非色板缩略图；缩略图需要把子树按 `[data-theme]` 作用域渲染（或另开取色通道），属独立片。1-F 的既定范围只写"选择器 + `coverage` badge"。
3. **对比度断言仍未做**（1-H）。

**证据**：

| 层 | 做法 | 结果 |
|---|---|---|
| **变异测试（三条）** | ① `selectedId` 去掉"是不是覆盖层 id"的过滤（直接取 `themeId`）② 去掉回落提示（`missingId = null`）③ 把选中态改从 `resolvedThemeId` 推导 | ① **恰 2 红**（默认别名那条 ＋ 未安装那条——正是两个"id 不在覆盖层集合里"的状态）② **恰 1 红**（未安装提示那条）③ **0 红**。**③ 的 0 红是结论而非缺陷**：当前注册表下两值在每个可达状态标记同一项（已安装的覆盖层解析回自身，其余一律解析到无覆盖层的外观默认），所以这是一个**行为等价的实现选择**——测试有意不钉它，并把这条判断写进组件与测试的注释，避免后人误当"漏测"去补一条永远为真的断言 |
| **归属自查** | 按 `shared/ui` 准入线核消费者数 | `ThemeSelector` 消费者 = 1 → 移到 `src/modules/settings/`；`shared/ui/index.ts` **回到改动前的逐字节内容**（amend 内完成） |
| **产物核对** | 构建产物 grep | 新文案进包（`配色主题` / `强调色` / `themeSelector` 均命中 `dist/assets/index-*.js`）；**`src/index.css` 与 `tests/theme-tokens/` 逐字节未动**（`git diff --stat` 为空） |
| **lint 不增负** | 全仓 `oxlint` | **153 warnings / 0 error**，与 1-E 收官时**逐位相同**（本片新增 2 个源文件、1 个测试文件，未引入任何新告警） |
| **令牌基线** | `test:theme-tokens` | **46 通过**（未新增、未改动）——本片无 CSS 改动，覆盖层规则与令牌基线都不在这条链上 |

**门槛**：`test:client` **129 文件 / 984 用例**（1-E 收官 128/979 ＋ 本片 1 文件 5 用例）；`typecheck`（含 server）与 `typecheck:theme-tokens` 干净；`lint` **153 warnings / 0 error**；`build` exit 0（构建期那 4 条 `Unexpected "{"` CSS 警告是既有噪声，非本片引入）。

**与既有账的关系**：阶段 0 迁移账（0 处 / 余 1 处豁免）与 B3 账户（`index.css` 选择器级消费者）均不受影响——本片未碰任何 CSS，也未新增 Tailwind 具名色；阶段 1 不计处数，按片计。


#### 1-G 实施记录（2026-09-26，`7b406986`）

**范围**：`src/modules/shell/hooks/useShellTerminal.ts`（刷新 effect 加一个依赖 ＋ 注释重写）、`src/modules/shell/tests/shellTerminalThemeRefresh.test.tsx`（新，4 用例）、`tests/theme-tokens/terminal-tokens.spec.ts`（+1 用例，即 +2 引擎）。**无 CSS 改动、无 i18n 改动。**

**做了什么——先核范围，发现原计划的三路里只有一路需要做**。1-G 的既定描述是"xterm 重设 `options.theme`、CodeMirror compartment reconfigure、Git 图 SVG 直接用 `var()`"。逐条核查消费者形态后：

| 消费者 | 色值最终交给谁 | 需要刷新？ | 依据 |
|---|---|---|---|
| xterm | JS 数值对象（`options.theme` → canvas） | **需要** | `var()` 不参与，CSS 变化不传导 |
| CodeMirror | 注入样式表的 CSS 规则 | **不需要** | 0-D 落地时 `EditorView.theme()` / `HighlightStyle.define()` 的**每个色值都是 `var()` 字符串**，浏览器绘制时解析；已有 `editorThemeTokens.test.ts:45` 常驻断言"chrome 里不存在字面值" |
| Git 图 | SVG 表现属性 | **不需要** | 0-F1 已实测（§5.6 v6 / v10） |

于是**代码改动只有 xterm 一路**：`useTheme()` 多取一个 `resolvedThemeId`，刷新 effect 的依赖由 `[isDarkMode, terminalRef]` 变为 `[isDarkMode, resolvedThemeId, terminalRef]`。原来的注释写着"本阶段明暗两态色板相同，写进去的就是终端打开时的值"——这句**随 1-E 引入覆盖层而失效**（一个主题现在会移动 `--term-*`），故一并重写。

**关键决策**：

1. **两个依赖都留**。`resolvedThemeId` 在明暗翻转时也会变（`cc-light` ↔ `cc-dark`），单靠它似乎就够；但 `--term-*` 今天是**外观无关**的（`terminal-tokens.spec.ts` 有"明暗两态色板相同"的断言），若将来某个主题让 `--term-*` 随外观分叉，`resolvedThemeId` 对"有覆盖层时"这一点**不再变化**（同一个 id 贯穿两态），只留它就会漏。保留 `isDarkMode` 是把这个假设置于依赖之外。**代价是二者会同时变化时多走一次 effect**——无害（同一帧内幂等重读，`readTerminalTheme` 本来就是"再读一次"的语义）。
2. **不引入"主题版本号"这类更粗的信号**。曾考虑在 `ThemeContext` 暴露一个每次变更自增的 revision，让消费者只依赖它；但那要新增一个无第二个消费者的状态字段，而当前两个依赖已覆盖全部变化源（外观 ＋ 覆盖层 id）。**等真有第三个变化源再抽**（同 1-D"不提前引入无消费者的状态字段"的判据）。
3. **测试用桩终端而非真 xterm**。抄 `shellErrorFrame.test.ts` 的做法：给 `terminalRef` 一个 `{ options: {} }` 桩，让"构造终端"的 effect 提前 return（既省掉 canvas，也顺带验证该 effect 的守卫），再把 `readTerminalTheme` 桩成**每次调用返回不同哨兵**——这样才能把"effect 真的重跑"和"重读到了同样的值"区分开。
4. **契约面补一条"前提成立"的断言**。刷新只有在覆盖层真的会移动色板时才有意义，故 `terminal-tokens.spec.ts` 新增一例：`readWithTheme('cc-polar')` 之后再 `readTerminalTheme()`，断言 `background` 与 `red` **确实变了**，并断言"不切换主题时连续两次读取**相同**"（排除 per-call 噪声，反空转）。

**如实边界（本片未做，不阻塞）**：

1. **对比度断言仍未做**（1-H）；**§5.12 的 >10 lane 参数化回退**仍待拍板。
2. **`readTerminalTheme()` 没有缓存**：每次主题变更建一个探针 `div` 再移除。这是 0-C 就有的设计（`probe.remove()` 有注释说明），本片未改；若将来刷新频率变高（如逐帧），才需要考虑按 `(appearance, themeId)` 记忆化。

**证据**：

| 层 | 做法 | 结果 |
|---|---|---|
| **变异测试（两条）** | ① 刷新 effect 的依赖**去掉 `resolvedThemeId`**（回到改动前）② 让 `cc-polar` **不再覆盖** `--palette-term-bg` | ① **恰 2 红**——两条覆盖层用例（选主题 / 清主题）变红，而**外观翻转那条仍绿**：两条依赖正是各自独立生效的，互为对照；② **恰 4 红**——本片新增的契约用例两引擎各一，**加上**既有的 `theme-overlays.spec.ts` cc-polar 覆盖范围用例两引擎各一（它也承诺 `--term-background` 移动）。两者从不同层报红，说明新增用例提供的不是重复覆盖 |
| **归属与空转自查** | 首版守卫用例（"无关 re-render 不得重读"）**报红** | 排查为**夹具自身的缺陷**：我在 `renderHook` 回调里每次新建 ref 对象，而 `terminalRef` 正是依赖 → 每次渲染都重跑 effect。改为在夹具外建一次 ref（与 `useRef` 语义一致）后转绿。**这条红不是噪声，恰是"依赖清单真的在起作用"的旁证**，也说明该守卫值得保留 |
| **既有护栏复用** | 编辑器"无需刷新"的结论 | 不新增断言：`editorThemeTokens.test.ts:45` 的 `/^var\(--editor-[a-z0-9-]+\)$/` 已经拒绝任何字面 chrome 值，正是"浏览器自己会重解析"的机器可校验形式 |
| **令牌基线** | `test:theme-tokens` | **46 → 48**（本片 +1 用例 ×2 引擎）；`token-baseline.json` 逐位未动 |
| **零 CSS** | `git diff --stat src/index.css` | 空——覆盖层、令牌、基线三层都不受本片影响 |

**门槛**：`test:client` **130 文件 / 988 用例**（1-F 收官 129/984 ＋ 本片 1 文件 4 用例）；`test:theme-tokens` **48 通过**；`typecheck`（含 server）与 `typecheck:theme-tokens` 干净；`lint` **153 warnings / 0 error**（与 1-F 收官逐位相同）；`build` exit 0。

**与既有账的关系**：阶段 0 迁移账与 B3 账户均不受影响（未碰 CSS）；阶段 1 不计处数，按片计。**本片是本线第一片"先核范围再做"的片**：既定描述里的三路，实测两路早已由更强的实现满足——这与 0-D"实现偏差（比草案更强）"、1-C"探针取代手写 HSL→hex"同体例，故按同样要求**回写 §5.6 v10**（把"JS 消费者需要主动刷新"收窄为"把解析值塞进 JS 对象的那类才需要"）。

#### 1-H 实施记录（2026-09-26，`38ef8d8e` / `13b9c696` 两片）

**范围**：`tests/theme-tokens/contrast.spec.ts`（新，4 用例：基色 ＋ 两套覆盖层，×2 引擎）、`tests/theme-tokens/theme-overlays.spec.ts`（+1 反向守卫）、`tests/theme-tokens/main.ts`（+3 探针）、`tests/theme-tokens/token-baseline.json`（+6 行）、`tests/theme-tokens/README.md`，以及 **`src/index.css` 的一次有意取值变更**（`--palette-sand-500`）。**无 i18n、无组件、无 server 改动。**

**这一片卡在一个口径分叉上，交由用户拍板后按 (b) 落地。** §5.10 首条写"内置主题必须过 WCAG AA（正文小字 ≥ 4.5:1…）"，§5.11 的断言写"正文对比度 ≥ 4.5:1"——两处对"正文"是否含 `--muted-foreground`（次要文字）给了不同读法，而读法决定结论：

| 读法 | 基色浅色 `--muted-foreground` / `--background` | 后果 |
|---|---|---|
| 窄（正文 ＝ `--foreground`） | 18.20:1；该对不在断言范围内 | 零改动即可落地 |
| 宽（所有正常字号文字） | **4.42:1 不达标** | 须改色板或放宽阈值 |

实测该值 **4.42:1**（`--palette-sand-500` `40 5% 44%` 落在 `--palette-sand-50` 上），且 **accent 类覆盖层不重调 substrate、会继承它**——`cc-ocean` 同为 4.42，只有自带 `sand-500: 215 12% 45%` 的 `cc-polar` 幸免。故窄读等于把一条低于 AA 的比值永久豁免。

**关键决策**：

1. **按宽读，调暗基色到刚好达标**（用户拍板 (b)）：`--palette-sand-500` `44% → 43%`，比值 4.42 → **4.59**（浏览器序列化后实测 **4.62**）。依据是 §5.10 主句"必须过 WCAG AA"为规则、括号为举例，(b) 让主句为真而不必削弱任何条款；仓库已有同体例先例——`cc-ocean` 的注释就记录了"浅色步从示例值调暗，因为只到 3.5:1"。
2. **取最小步长而非留余量**：43% 仅比阈值高 0.09（序列化后 0.12）。选"刚好达标"是因为该值是设计师肉眼可辨的界；若将来某个主题步骤逼近，应当调整那个主题，而不是继续压基色。
3. **配对取"契约点名的 ＋ 主题作者自己锚定的"**：6 对 = `--foreground` / `--muted-foreground` 各落在 `--background` 与 `--card`、按钮文字落 `--primary`、`--ring` 落 `--background`。按钮一对既未见于 §5.10/§5.11 字面，但**两套覆盖层的注释都以它为标**（cc-ocean 记 3.5:1 不达标、cc-polar 记"4.6:1 才够"），故纳入。**这不是穷举的文字×表面矩阵**，边界写在 spec 头注释里。
4. **基色纳入遍历，而非只走覆盖层**：基色就是"未选主题"时的出厂外观，且（见上）accent 覆盖层不重调 substrate——只走覆盖层会漏掉**真正在发货的那一面**。变异 A 正是这条的证明。
5. **颜色读 `rendered` 层而非 `tokens`**：令牌是三值对（`40 5% 43%`），只有被消费时才成为颜色；对比度算的是浏览器实际绘制的色，`rendered` 就是它。为此给 fixture 补 `--card` / `--primary-foreground` / `--ring` 三个探针——`--ring` 此前**没有任何检查把它解析成颜色**。
6. **未加探针的配对必须点名报错，不能静默 NaN**：`undefined` 参与比较会恒假通过，故先断言两个令牌都在 `rendered` 里，缺则报出令牌名并指向 `PROBES`。
7. **反向守卫堵"死 CSS"**：所有既有用例都是从 `OVERLAY_THEMES` 走向样式表，于是"存在 `[data-theme]` 块但未注册"这一形态**按构造被跳过**；新增一条断言两个方向都闭合（块 ↔ 注册表）。

**如实边界（不阻塞）**：

1. **用户主题的对比度只警告不阻断**——§5.10 把"非阻断对比度警告"留给选项 A 的令牌校验器，而该校验器属阶段 2，本片未做；本片只覆盖内置主题。
2. **配对表不是穷举矩阵**：`--secondary-foreground`/`--secondary`、`--accent-foreground`/`--accent`、`--popover-*`、`--card-foreground` 等成对令牌未纳入。纳入的是"样式表确实在画"的那些；扩充需按同样依据逐对论证，不能凭对称感批量加。
3. **`--ring` / `--card` / `--primary-foreground` 的探针属新增基线面**：基线新增 6 行（3 令牌 × 2 外观），是本片造成的唯一基线变化（片一的 4 行则来自色板取值变更）。

**证据**：

| 层 | 做法 | 结果 |
|---|---|---|
| **变异 A（基色退回）** | `--palette-sand-500` 退回 `44%` | **恰 6 红**：基线 ×2、基色对比度 ×2、`cc-ocean` 对比度 ×2；**`cc-polar` 保持绿**。同时证明"基色被继承"与"逐主题独立"两件事，也是 (b) 选择的核心依据 |
| **变异 B（覆盖层改浅）** | `cc-ocean` 的 `--palette-brand-500` 浅色步 `27% → 80%` | **恰 2 红**（仅 `cc-ocean` 对比度 ×2 引擎），且**基线 0 红**——覆盖层不进基线（基线在无 `data-theme` 下读取），可达性用例也不查对比度。失败信息形如 `light --primary-foreground on --primary: 1.22:1 < 4.5:1 (rgb(248, 250, 252) on rgb(166, 242, 233))` |
| **变异 C（孤儿块）** | 追加一个未注册的 `[data-theme="cc-ghost"]` 块 | **恰 2 红**（孤儿守卫 ×2 引擎），其余 54 项全绿——正是"按构造会被跳过"的形态被抓住 |
| **基线 diff 可预测** | `git diff token-baseline.json` | 片一恰 **4 行**（light 的 `--muted-foreground` 与 `--palette-sand-500`、light.rendered 的 `--muted-foreground`、dark 的 `--palette-sand-500`）；片二恰 **+6 行**（3 探针 × 2 外观）。深色 `--muted-foreground` 走 `--palette-ink-400`，未动 |
| **产物核对** | `grep -- '--palette-sand-500:[^;}]*' dist/assets/*.css` | `40 5% 43%`（基色）＋ `215 12% 45%`（cc-polar）；旧值 `40 5% 44%` **0 处残留** |

**门槛**：`test:theme-tokens` **48 → 56**（4 新用例：1 守卫 ＋ 3 对比度，×2 引擎）；`typecheck:theme-tokens` 干净；`test:client` **130 文件 / 988 用例**（与 1-G 逐位相同）；`lint` **153 warnings / 0 error**；`build` exit 0（取真实退出码，非管道值）。

**与既有账的关系**：阶段 0 迁移账与 B3 账户不受影响。**本片是本线唯一带"出厂色板取值变更"的片**：`--palette-sand-500` 44%→43%，按 1-B / 1-C 的体例单独记账为有意视觉变更（受影响的只有浅色次要文字，1% 亮度）。**阶段 1 的计划内切片至此全部完成**（随后补做的 1-I 见下）。

#### 1-I 实施记录（2026-09-26，`e4f5cb70`）

**范围**：`index.html`（`<head>` 末尾的首帧外观脚本 ＋ splash 的浅色变体 ＋ `theme-color` 改 media 双条）、`tests/theme-tokens/first-paint.spec.ts`（新，4 用例 × 2 引擎）、`tests/theme-tokens/verify-first-paint.mjs`（新，真实文档行为验证器）、`tests/theme-tokens/README.md`。**无 `src/` 改动、无 i18n、无 server 改动、无基线改动。**

**这一片是 1-C 的尾巴**：1-C 把运行期 `theme-color` 接上了令牌，但"JS bundle 执行之前"那一段仍是静态值——而 §5.6 的启动链路写着"立即在首帧前设置 meta theme-color"，那句话当时**并不成立**。本片让它成立。

**问题不是"少一个属性"，是两处值互相矛盾**：`index.html` 的静态 `theme-color` 是 `#ffffff`，而 splash 的底色是固定的深色 `#0b0d10`。splash 是 `position: fixed; inset: 0; z-index: 99999`，首帧铺满视口；状态栏在它之上。于是"深色启动画面 ＋ 白色状态栏"在**深色外观下**最刺眼（白色状态栏压着一屏深色），浅色外观下也自相矛盾。另记：splash 的存活时间不是"渲染一帧"——它由 `ProtectedRoute` 在认证落定后才撤（`src/utils/splash.ts`），所以这段配色在首次连接时**可见数秒**，不是一闪而过。

**关键决策**：

1. **让 splash 一起跟随明暗，而不是只改 `theme-color`**（本片唯一有意的视觉变更）。splash 恒深时，只把 `theme-color` 改成与 splash 一致，只是把"跳变"从深色用户搬到浅色用户——浅色用户的"深启动画面 → 浅界面"依然存在。让 splash 一并跟随，才是两侧都"零矛盾、零跳变"：浅色用户看到浅启动画面 ＋ 浅状态栏，深色用户看到深启动画面 ＋ 深状态栏。**机制不是新引入的**——`mobile/www/index.html` 的 theme-color 早就是 media 查询式。**记账**：浅色外观的启动画面由深变浅（此前对所有外观都是 `#0b0d10`）。
2. **浅色 splash 取令牌解析值，不另造一套色**：底色 `#f7f6f3`（＝ `--palette-sand-50`，即浅色 `--background`）、主文字 `#0d0b08`（`--palette-sand-950`）、次文字 `#736f68`（`--palette-sand-500`，1-H 刚钉到 43%）。这样 splash 交接到 React 首帧时**颜色逐位相同**，不发生闪烁。
3. **spinner 在浅底上用 green-700（`#15803d`）而非 green-600**：绿是"加载中"的语义色，深色底上的 `#4ade80`（11.17:1）保留不动；浅底上 `#16a34a` 只有 **3.05:1**，余量 0.05 太薄，改 `#15803d` 得 **4.64:1**——沿用 1-H 的同一门槛（图形 ≥3:1），并主动留厚。
4. **用一个内联同步脚本决定外观，而不是纯 media 查询**：media 只反映**系统**外观，而用户可以在应用内手动选明暗。脚本读的正是 `ThemeContext` 读的那个键（`localStorage['theme']`，`ThemeContext.tsx:74`），所以"手动选过"的用户首帧就正确。
5. **脚本必须放在 `<head>` 末尾，不能放开头**：它要先 `querySelectorAll` 到前面那两条 media meta 才能 `remove()` 掉，否则文档里会留下两条 `theme-color` 让浏览器自己挑（多条时取哪条由浏览器决定，是未定义行为）。
6. **media 双条保留为"脚本未运行"的声明式兜底**：值取与 splash 相同的两个色。脚本运行时会移除它们并写一条精确的——所以运行时恒只有 **1 条**（行为验证实测）。
7. **三处写者的值必须一致，断言按"一致"写而非各钉字面**：同一外观的颜色有三个写者（脚本 / splash 规则 / media 兜底）。若各钉一个字面值，一处漂移后其余仍绿。故断言是"每个外观的颜色在它出现的**每一处**都相同"——**契约是一致性本身，不是某个 hex**。
8. **脚本的 `data-appearance` 挂载后不再维护**（如实边界）：React 挂载后写自己的 `data-theme` / `.dark`，chrome 由 `applyThemeChrome` 重新发布；splash 保持首帧配色直到 `ProtectedRoute` 撤掉它。**不能"挂载即清掉这个标记"**——splash 的存活跨越首次渲染，清掉会让浅色用户的 splash 在认证期间突然变深。

**如实边界（不阻塞）**：

1. **`manifest.json` 的 `theme_color` / `background_color` 不跟随**——PWA 启动画面与安装期磁贴色由 manifest 静态决定，运行时改不了（平台限制）。故**未改**（`#ffffff` 与浅色基准 `#f7f6f3` 肉眼几乎不可辨），已记账。同理 `msapplication-TileColor` 是安装期色、不参与运行期跟随。**不要把"能跟随外观"当成它们的能力。**
2. **`mobile/www/index.html` 未动**：它是 Capacitor 的服务器选择页，已有 media 双条（`#f7f9fc` / `#0f1115`），方向正确；但它不加载主题令牌，是一套独立色板（用户此时还没连上服务器，没有主题偏好可读）。
3. **跨设备同步的偏好首帧读不到**：脚本只能读 `localStorage`；`ThemeContext` 还能读同步偏好镜像（`readUserPreference`），那需要 bundle。故"只在另一台设备设过偏好"的用户首帧按系统外观、挂载后被纠正（一次跳变）。手动偏好与系统不符时同理——这是**能做到的最好**，不是遗漏。
4. **结构断言证明不了行为**：spec 读的是 `index.html` 源文本。"脚本真的跑对"由 `verify-first-paint.mjs` 对**真实文档**做行为验证（见证据表），但它不在 `test:theme-tokens` 里——fixture 加载的是样式表、不是文档，跑不到这段脚本，需要显式调用。

**证据**：

| 层 | 做法 | 结果 |
|---|---|---|
| **真实浏览器行为**（`verify-first-paint.mjs`） | 加载真实 `index.html`，跑「系统外观 × 存储偏好」6 组 | 6 组全部一致：`data-appearance` 与 `color-scheme` 都等于"存储偏好、否则系统"；`theme-color` 与 splash 的 computed 背景**逐行相同**（`#0b0d10` ↔ `rgb(11, 13, 16)`、`#f7f6f3` ↔ `rgb(247, 246, 243)`）；`theme-color` meta **恒为 1 条** |
| **变异 A** | 脚本的深色值改 `#ffffff`（与 splash 矛盾） | **恰 1 红**（"三处一致"） |
| **变异 B** | 写坏浅色选择器（`data-appearance='lite'`） | **恰 2 红**（一致性 ＋ splash 对比度，各在 light 缺值） |
| **变异 C** | media 双条换成一条无 media 的静态白 | **恰 2 红**（"必须 media 限定" ＋ 一致性） |
| **变异 D** | 浅色次文字改 `#cccccc` | **恰 1 红**（splash 对比度） |
| **变异 E** | 脚本读错键（`themeMode`） | **恰 1 红**（"读的是同一个键"） |
| **变异 F** | 删掉移除兜底 meta 的循环 | **第一次 0 红 —— 抓到一条空转断言**：原断言只查 `querySelectorAll(...)` 存在、没查真的调用 `remove()`。补上 `.remove()` 后再变异，**恰 1 红** |
| **产物核对** | `dist/index.html` | 脚本进产物；浅色 splash 3 条规则齐；`theme-color` 恰两条 media 式；静态白 `theme-color` **0 处**；`msapplication-TileColor` 按预期仍为白 |

**门槛**：`test:theme-tokens` **56 → 64**（4 新用例 ×2 引擎）；`typecheck:theme-tokens` 干净；`test:client` **130 文件 / 988 用例**（与 1-H 逐位相同）；`lint` **153 warnings / 0 error**；`build` exit 0（取真实退出码）；`verify-first-paint.mjs` **6/6**。

**与既有账的关系**：阶段 0 迁移账、B3 账户、1-H 的色板账均不受影响。**这是本线第三处有意视觉变更**（1-B 的 `color-scheme` 随外观、1-H 的基色步调暗、本片的浅色启动画面），按同一体例单独记账。**阶段 1 至此真正全部完成**——计划内切片全部收官，顺带开出的 1-I 也一并落地。


### 阶段 2：用户主题

服务端提供主题目录列举与静态文件下发（**新写 `server/modules/themes/`**，而非复用 plugins 的 `resolveAsset`——见 §5.6 v11）；前端加载链路含"缓存同步注入 / 后台校验更新 / 加载中 / 失败回落"；设置页支持选择与粘贴内容（**已由 2-D 落地**：文件区只读列举、粘贴区可增 / 选 / 删）。选项 A 的令牌白名单校验已由 2-C 落地；B2 的 `.tmTheme` 编译已由 2-E 落地（`.tmTheme` 此前是显式拒绝，自 2-E 起可用）；**选项 B 的原始 CSS 在文件线上自 2-B / 2-C 起即已可用，"粘贴原始 CSS" 已由 2-F1 落地；§5.10 的对比度警告已由 2-G 落地（用户主题的非阻断可读性警示，见 §5.10 v2），高级模式的语法高亮 / 实时预览已由 2-H 落地（见 §5.5 v6）；`.tmTheme` 的可选 `cloudcli` 内嵌键已由 2-I 落地（见 §5.5 v7）**。

**验收**：往 `~/.cloudcli/themes/` 放一个文件，刷新后主题出现在选择器中并可生效（改文件后刷新能看到变化，即 `?v=` 生效）；非法文件被拒绝且不影响启动；删除文件后回落默认；**"合法但有害"的 CSS 可用 §5.6 的恢复通道退出**（通道由 2-D 落地，`?theme=default` 丢的是"选择"而非主题、且在 boot 最先跑；**可写原始 CSS 的那一半**——放一个写坏布局的 `.css` 文件——自 2-B / 2-C 起就成立，故此条**文件线已可完整跑通**；剩下的"粘贴原始 CSS 也能这么退出"已由 2-F1 落地——粘贴原始 CSS 的入口与信任确认已可用，`?theme=default` 对粘贴主题同样有效）；跨设备同步到未安装主题的设备时给出显式提示而非静默回落（**前半"回落可观测"已由 1-D 提供**：生效 id 与所选 id 分离 ＋ `console.warn`；剩余的选择器提示 UI 随 1-F 落地）；**粘贴的主题经同一校验器进偏好镜像、可跨设备取用、可删且删除时连带清掉指向它的选择**（已由 2-D 落地）。

**切片表（v13，2-A / 2-B / 2-C / 2-D / 2-E / 2-F1 / 2-G / 2-H / 2-I / 2-J / 2-K / 2-L / 2-M 已实施）**

| 片 | 范围 | 状态 |
|---|---|---|
| 2-A | 服务端主题目录：列举 `~/.cloudcli/themes/` ＋ 静态只读下发（§5.8 的闸门；**不做内容解析**） | ✅ 已实施（`bdfd5bbb`），见下方记录 |
| 2-B | 前端加载链路：拉清单 → 合并进选择器 → 注入 ＋ 缓存（`?v=<mtime>`）＋ 加载中 / 失败两态的回落可观测 | ✅ 已实施（`7a5c77ce`），见下方记录 |
| 2-C | 选项 A：令牌白名单 ＋ 值格式校验，并开始读文件自带的元数据（`name` / `coverage`），编译成 `[data-theme]` 覆盖层（含 `appearance` 作用域） | ✅ 已实施（`463772bd`），见下方记录 |
| 2-D | 设置页用户主题分区：文件区只读列举 / 选用；粘贴区增 / 选 / 删；按 `ThemeManifest.source` 区分展示；连同粘贴提前落地的 §5.6 强制恢复通道 | ✅ 已实施（`540e6fba`），见下方记录 |
| 2-E | B2：`.tmTheme` → 语法 / 终端 / 编辑器令牌（原定与它同片的"选项 B 原始 CSS"经核实已由 2-B / 2-C 交付，见下） | ✅ 已实施（`a2d0a515`），见下方记录 |
| 2-F1 | 选项 B 的**粘贴**线：粘贴框收原始 CSS ＋ 高级模式开关 ＋ 信任确认 ＋ 粘贴侧 `@import` 闸门（格式成为**条目自己的属性**） | ✅ 已实施（`d3ebe1e6`），见下方记录 |
| 2-G | §5.10 的"用户主题对比度只警告不阻断"：选项 A 令牌的可读性警示（非阻断）——基准＝出厂基色，配对表成为单一来源 | ✅ 已实施（见下方记录） |
| 2-H | 高级模式编辑器增强：语法高亮 ＋ 实时预览（§5.5 推荐行明列，2-F1 未做） | ✅ 已实施（`85ba658b`），见下方记录 |
| 2-I | `.tmTheme` 的可选 `cloudcli` 内嵌键 ＋ coverage 声明（§5.5 v4 记为待定的补足途径） | ✅ 已实施（`8b182f05`），见下方记录 |
| 2-J | §5.12 的 >10 lane 参数化回退（本线最后一处待拍板项，随开工拍板） | ✅ 已实施，见下方记录 |
| 2-K | `.tmTheme` 的 plist 顶层 `name` 服务端读取（2-I 边界 1 的收账，§5.8 v7） | ✅ 已实施，见下方记录 |
| 2-L | 文件主题的可读性警告上界面（2-G 边界 1 的收账，§5.10 v3） | ✅ 已实施，见下方记录 |
| 2-M | 令牌预览页（§6 阶段 1 的"可选随附功能"，主题线最后一笔未做项） | ✅ 已实施，见下方记录 |
| 2-N | 预制主题 `cc-catppuccin`：Codex TUI 的默认色板（暗 = Mocha、浅 = Latte），清账后由用户新需求驱动的增量 | ✅ 已实施，见下方记录 |
| 2-O | 预制主题 `cc-islands`：IntelliJ IDEA 的 Islands Dark / Islands Light（IDE 当前默认外观），清账后由用户新需求驱动的增量 | ✅ 已实施，见下方记录 |

**为什么 2-G 接着做（本片开工时的范围裁定）**：2-F1 的记录把这条挂成"待 2-G"时只写了一句话，本片开工第一件事是把它读全——§5.10 的原文是"选项 A 的令牌校验器附带**非阻断**对比度警告"，**主语是校验器、不是界面**。读全之后有两点变了：① 2-C 落地校验器时只做了形状，"非阻断警告"这一半**一次都没做过**（不是"做得不够"），所以本片不是补丁而是首做；② 2-F1 记的"`var()` 可链 ⇒ 编译期算不出"这条理由**只否掉了"把警告做成阻断式的预检"**（含"算不准就别做"），并**不否掉**这件事本身能做成一个诚实的、有明确射程的警告——把"算不出"读成"做不了"会把它永久搁置。故本片把射程划清（见 §5.10 v2：基准＝出厂基色、三处不判、沉默不是通过）后照做，**没有改判 2-F1 的范围裁定**（它说的"不可与粘贴线同片落地"依然成立，本片独立成片正是那个裁定的结果）。**2-H 不阻塞**：编辑器控件与"警告是否可达"无关。

**为什么 2-F 拆成 2-F1 / 2-G / 2-H（本片开工时的范围裁定）**：原 2-F 一行写着三件事——粘贴线、高级模式、§5.10 对比度警告。开工时逐条核，发现它们的落地条件是三种：**粘贴线**（2-F1）自成一片，与格式编译有关；**§5.10 的对比度警告**（2-G）**不能**与粘贴线同片落地——本片是把原始 CSS 放进粘贴框，而那条警告约束的是**选项 A 的令牌**，且选项 A 的令牌是 `var()` 可链的（一个 `.json` 可以写 `"--primary": "var(--brand)"`，`--brand` 又在别处定义或干脆没定义），于是"这份声明值的对比度"在没有浏览器、没有实际表面的编译期**算不出来**；能算的只有主题里**字面**的色值与它自己声明的表面，而那既不是全部、也不是本片新增的东西——把一条算不准的警告塞进本片，等于给它一个演示不出的承诺。**高级模式编辑器增强**（2-H）——§5.5 推荐行写的"带语法高亮编辑器 ＋ 实时预览"——是编辑器**控件本身**的事，与"粘贴框收不收 CSS"正交：2-F1 交付的是"能粘、粘了能用、能用开关退出"，把编辑器换个控件不影响它成立。故三件事拆三片，都是**切片边界重划**（与 2-E 把"选项 B 原始 CSS"划掉同源），不是范围缩水。2-G / 2-H 均不阻塞任何后续片。

**为什么 2-E 只剩 B2（本片开工时的范围裁定）**：切片表原把 2-E 写成"选项 B（原始 CSS）＋ B2"。开工时读代码确认，"选项 B"在**文件**这条线上早已交付——`.css` 就是覆盖层，2-B 的加载链路把它原样注入，2-C 又把 `compileThemeSource` 的格式分派写死为"`.css` 直接透传"（§5.6 v13）。也就是说"往 `~/.cloudcli/themes/` 放一个 `.css` 就能改任意选择器"这条自 2-B 起就成立，2-E 再去写一遍是重复。**真正没做的只有两件**：B2 的 `.tmTheme` 编译器（本片做掉），以及**选项 B 的粘贴线**——粘贴区至今只收选项 A 的令牌 JSON，写不了原始 CSS。后者连同它的"高级模式"开关与 §5.10 的对比度警告另立 2-F（见上表），因为它们是**粘贴面**的事，与 `.tmTheme` 的解析无关——这一片的顺序调整属"切片边界按实测重划"，不是范围缩水。

**为什么 2-A 先做**：它是 2-B 的前置——前端要的清单、`?v=` 用的 mtime、以及"文件被拒"这一态都出自这两个端点；整片落在服务端，可独立验收（放文件 → 列表出现；坏文件 → 被拒且不影响启动）。2-C / 2-E 是解析层、2-D 是 UI 层，都不阻塞"放一个 `.css` 就能生效"这条最小闭环——`.css` 本身就是覆盖层，只需 2-A ＋ 2-B。

**为什么 2-B 接着做**：它是那条最小闭环的另一半，做完之后**验收的第一句就可以真跑**（往 `~/.cloudcli/themes/` 放一个 `.css` → 刷新 → 出现在选择器里 → 选中即生效），其余四句中的三句也同时成立（改文件后刷新能看到变化、删除文件后回落默认、跨设备同步来的未安装主题给出显式提示）。剩下 2-C / 2-D / 2-E 都只让这条闭环**更厚**：2-C 让文件能自带 `name` / `appearance` / `coverage` 并限权令牌，2-D 给设置页加用户主题分区（并把"合法但有害"的恢复通道一同提前落地），2-E 才是选项 B 的原始 CSS 与 `.tmTheme` 解析。2-B 也因此是**唯一一片能独立证明"运行期注入的样式真的压过基色"**的片子——那是个浏览器行为问题，jsdom 证不了，所以本片附带了一条真引擎 spec。

**为什么 2-C 接着做**：最小闭环只对 `.css` 成立——`.json` 走到 2-B 的 `compileThemeSource` 时还是个"不是样式表的 body"，不被编译就等于**放进去也没用**；所以 2-C 是把选项 A（默认格式，§5.5）从"文档里的承诺"变成"能用的格式"的那一片，也是三条格式里唯一需要"解析"而非"透传"的一条。它同时兑现两笔欠账：§5.10 那句"用户主题的对比度只警告不阻断、留给选项 A 的校验器"，以及 §5.8 边界② 记的"文件自带的元数据不读"。2-D 仍可独立成片（UI 层，与解析无关），2-E 则是选项 B 的原始 CSS 与 `.tmTheme`。

**为什么 2-D 接着做（v2：切片顺序在本片做过一次调整）**：2-C 之后"文件主题"从格式到选择器到加载全通了，但**用户没有任何入口能碰到它**——设置页没有用户主题分区，粘贴这条线一行代码都没有；2-D 是把已具备的能力交到用户手上的那一片，也是三片里唯一落在 UI 的。**本片把 §5.6 的强制恢复通道从 2-E 提前过来**：恢复通道原本跟着"有害的原始 CSS"（2-E）走，但**粘贴主题同样需要它**——粘贴内容进的是偏好镜像、磁盘上没有文件，一个把界面搞坏的主题（即便是选项 A 白名单内的令牌，也能写出低对比度到看不清设置页的配色）在 2-E 之前就已经可能出现，而它**没有 §5.8 那条文件系统的逃生口**（删文件即恢复）。通道的落点因此与"粘贴能不能用"同片。裁定、三条候选的取舍与没做自愈哨兵的理由见 §5.6 v14；2-E 剩下的只是"能写原始 CSS"这一件事与 `.tmTheme`。

#### 2-A 实施记录（2026-09-26，`bdfd5bbb`）

**范围**：新增 `server/modules/themes/`（`themes.routes.ts` 薄路由 ＋ `services/theme-files.service.ts` ＋ `index.ts` barrel）＋ `server/shared/utils.ts` 的 `getUserThemesDir()`；`server/index.ts` 把 router 挂到 `/api/themes` 的 `authenticateToken` 之后。两个端点：`GET /api/themes` 列清单、`GET /api/themes/:fileName` 原样下发。

**决策（6 条）**

1. **元数据全部由文件名派生**：`id = 'user-' + 主干小写`、`name = 主干原样`、`format` 由扩展名定、`modifiedAt` 取 mtime（供 2-B 拼 `?v=`）。文件自己写的 `name` / `appearance` 这一版不读——那属于选项 A 的解析片。代价：一个 `.json` 里写的 `"name": "深海"` 现在显示为文件名，这是**有意的分片边界**而非遗漏。
2. **新写服务而非复用 plugins 的 `resolveAsset`**：§5.6 v3 原句"直接复用、不必新写目录遍历与校验"经核实站不住（该函数绑在 plugins 注册表上、且没有扩展名约束），改判并回写 §5.6 v11。真正沿用过来的是 `Content-Type` + `Cache-Control: no-store` 与"直系子项包含检查"的写法。
3. **`getUserThemesDir()` 放 `server/shared/utils.ts`**：§8.2 要求"新增一个与 assets 平行的目录常量、严禁主题模块另写第二套拼接"。它与后端规范"只用一处的工具放组件文件内"相冲突，此处按 §8.2（已决条款）优先，并在函数注释里写明是 `getGlobalImageAssetsDir` 的平行物。
4. **列表对不合格文件是跳过并告警，不是报错**：对应验收里"非法文件被拒绝且**不影响启动**"——一个坏文件不该让整个列表 500。告警点名文件与原因。
5. **去重按 id、排序大小写不敏感**：`Nord.tmTheme` 与 `nord.css` 同为 `user-nord`，若都列出会让两份清单争同一个 `[data-theme]` 值。排序用确定性的折叠比较（不用 `localeCompare`，它随 ICU 变），同题时 `.css` 因比较序取胜——恰好是全保真的那个格式。
6. **服务层每个入口显式收 `themesDir`**：生产调用方传 `getUserThemesDir()`，测试传临时目录。这是为了让 §5.8 那几道闸门（上限 / `@import` / 去重）能在临时目录里被真正跑到，而不是只测纯函数——`npm test` 里没有任何一处会碰真实 `~/.cloudcli/themes/`。

**如实边界（2 条）**：目录内符号链接会被跟随、`appearance` 恒为 `system` 且不声明 `coverage`——两条的完整理由与到期条件写在 §5.8 v3。

**证据**

| 项 | 预期 | 实测 |
|---|---|---|
| 服务层测试 | — | 9 项（扩展名映射 / 主干 / 名字安全 / 路径解析 / 空目录 / 列举过滤 / 去重 / 读取内容类型 / 读取拒绝） |
| 路由层测试 | — | 3 项，把真 router 挂到 express 上真发 HTTP（仓库无 supertest）；靠覆写 `process.env.HOME` 指向临时目录驱动，路由按请求解析该路径 |
| 变异：去文件名模式检查 | 名字类 | **恰 2 红** |
| 变异：去扩展名闸门 | 名字类 ＋ 路径解析 | **恰 2 红** |
| 变异：去大小上限 | 列表 ＋ 下发 | **恰 2 红** |
| 变异：去 `@import` 闸门 | 列表 ＋ 下发 | **恰 2 红** |
| 变异：去 id 去重 | 去重 | **恰 1 红** |
| 变异：id 前缀 `user-` → `cc-` | 列表 ＋ 去重 | **恰 2 红**——直接证明 §5.8 的前缀规则被断言，而非只写在文档里 |
| 变异：`appearance` `system` → `dark` | 列表 | **恰 1 红** |
| 变异：**去掉目录包含检查** | 名字类 | **0 红 —— 被前一层完全屏蔽**：名字闸门已不许任何分隔符，逃逸路径在 `path.resolve` 之前就被拒。如实记为**纵深防御行、当前无测试可命中**（不是漏测，是"归前一层管"） |
| 变异：路由 `400` → `500` | 路由状态映射 | **恰 1 红** |
| 变异：路由 `no-store` → `public` | 路由缓存头 | **恰 1 红** |
| 端到端（真 HOME ＋ 真 HTTP） | — | 列表只给合法两项（超限 / `@import` 被跳并告警）；下发的内容类型 / `nosniff` / `no-store` 正确；`@import` 与超限 → 400、缺失 → 404、`..%2Fauth.db` → 400 |
| 基线对照 | 服务端失败集不变 | `git stash` 前后各跑一次 `npm test`，**失败集逐行一致**（20 行，全在 Codex / WorkBuddy / Claude 路径解析 / OpenCode 区域，均为预存在的环境相关失败） |
| 产物核对 | 新模块进产物 | `dist-server/server/modules/themes/*.js` 齐；`dist-server/server/index.js` 有 `app.use('/api/themes', authenticateToken, themesRoutes)`；平台常量（`user-` / 256KB / `@import`）都在 |

**门槛**：`npm test` 1012 项（992 通过 / 19 失败 / 1 跳过，与 stash 基线逐行一致，净新增 0 失败）；`typecheck`（前后端两个 project）干净；`lint` **153 warnings / 0 error**（与基线相同，无新增）；`build` exit 0（取真实退出码）；`test:client` **130 文件 / 988 用例**（与 1-I 逐位相同）。

**与既有账的关系**：**本片无任何视觉变更**——它只新增只读端点，不进前端。阶段 0 迁移账、B3 账户、1-H 的色板账、1-I 的首帧账均不受影响。

#### 2-B 实施记录（2026-09-26，`7a5c77ce`）

**范围**：新增 `src/shared/userThemes.ts`（清单 store）与 `src/shared/userThemeStyles.ts`（样式 store）；`src/shared/api.ts` 加 `themes.list` / `themes.file`；`src/shared/context/ThemeContext.tsx` 把两个 store 接进解析（新增 `userThemes` / `themeFallback`）；`src/modules/settings/ThemeSelector.tsx` 合并用户主题并渲染回落提示；`src/main.tsx` 在 React 挂载前恢复缓存样式；i18n 加 `themeSelector.loadFailed`（en ＋ zh-CN）；`.oxlintrc.json` 登记两个 shared 模块。测试：4 个新文件 **30 项** ＋ 真浏览器 spec **3 项**（2 引擎）。

**决策（11 条）**

1. **两个模块级 store，不是一个 React state**：清单与样式都必须能被**非 React 的启动路径**写——`main.tsx` 要在 React 挂载前注入缓存样式——而 `ThemeProvider` 只是订阅者。同 `userSettings` 的偏好镜像体例。
2. **`<style>` 而非 `<link>`**：理由与"不是能力缺口"的说明见 §5.6 v12。
3. **"算不算生效"的判据从「注册表里有」改为「样式在文档里」**：用户主题的规则不在 bundle 里，**仅有 id 不足以选中它**。若沿用内置主题的判据，样式还在路上时就会写下一个没有规则匹配的 `[data-theme=…]`；改成看样式后，样式未到达即回落外观默认——这正是"加载中"这一态的落点。
4. **清单未答 ≠ 主题不存在**：`applyUserThemeStyle(entry, listingComplete)` 把"这份缺席算不算证据"显式交给解析层，**未答时不拆已上屏的样式**——否则一个尚未返回的请求就能把能用的主题换成没人要的回落。同理 `themeFallback` 在 `idle` / `loading` 时返回 `null`：一个下一帧就要收回的提示比等待更糟。
5. **失败分两类并各给理由**：`missing`（清单已答却没有它／非 `user-` 前缀的内置 id）与 `loadFailed`（清单请求本身失败、或文件读不出来）。
6. **`failedId` 是第二份状态，不是派生值**：读失败后 `appliedId` 归零，但"为什么归零"只能由 store 说出口。否则选择器只看到一个不再是所选 id 的值，会把它当"已回落"而不是"读失败"——两种原因的文案与后续行为都不同。
7. **操作计数器而非 `AbortController`**：`operation` 在每个 `await` 之后核对，丢弃迟到的响应。选计数器的理由是 `api.themes.file` 复用既有 `get()`（不传 `signal`），为这一处改 API 客户端签名不划算；且需求本就是"我这份已经过期"，与是否真取消请求无关。
8. **内部 `applied`（带 mtime）与对外 `appliedId`（只带 id）分开**：前者供"同 id 同 mtime 是空转"判定，后者是订阅者要的东西。**切版本时保留旧的 `appliedId`**（`publish({ appliedId: applied?.id ?? null })`），使 1-G 那条"xterm 消费令牌需要刷新"在换版本的下游看不到 id 空档。
9. **缓存只在 id 与当前所选相同时才注入**：`applyCachedUserThemeStyle` 的这条判据就是"这份缓存是哪个主题的证据"。两处 `try/catch` 只包 localStorage：写失败损失的是首帧优化，不是主题。
10. **选择器要把「已上屏、但清单还没答」的主题补进选项**：否则首帧缓存上屏的那个主题在选择器里查无此 id，`selectedId` 落到 `null`，于是把"默认"标成已选——而文档正穿着那个主题。名字只能取 id 本身（清单还没答，没有更好的来源），这是有意的将就。
11. **`.oxlintrc.json` 必须登记这两个新 shared 模块**：不登记会被 boundaries 规则判 3 个 error。这是 `src/` 树三重身份的既有约束（记忆里的"新增 shared 文件要登记"），不是本片新问题。

**如实边界（5 条）**

1. **清单每会话只读一次**（`status === 'ready'` 后不再拉）：运行期新增／删除文件不反映，刷新才反映——与验收写的"刷新后"一致，是有意取舍，不是遗漏。
2. **失败不重试**：同一会话内一个读不出的主题不会被反复重试（`failedId === entry.id` 直接返回），`console.warn` 是唯一记录，修好文件靠刷新。这是为了不把"失败"变成每次渲染一次请求。
3. **无会话时不发请求、停在 `idle`**：登录页上不会刷出 401 噪声；代价是"未登录时选择器看不到用户主题"，等有会话后由 `themeId` 变化或选择器挂载再触发。
4. **符号链接**（承 2-A）：主题目录内的 symlink 会被跟随，到期条件见 §5.8 v3。
5. **`coverage` 恒不声明**：文件派生的主题不宣称覆盖范围，选择器因此不渲染徽标（承 2-A / §5.8 v3）。

**证据**

| 项 | 预期 | 实测 |
|---|---|---|
| 新增单测 | — | 4 文件 30 项：`userThemes` 8（含无会话不请求 / 四态流转 / 条目形状过滤 / 前缀 / 非有限 mtime）、`userThemeStyles` 11（含 mtime 版本 / 空转 / 换版本替换 / 失败清缓存 / 未答不拆 / 迟到丢弃 / 注入顺序）、`userThemeResolution` 6、`themeSelectorUserThemes` 5 |
| 真浏览器 spec（jsdom 做不到的那一段） | 注入的样式表**真的**压过基色 | 3 项 × chromium ＋ webkit 全绿；断言 `--background` 读到文件里的颜色（`120 60% 40%`），并证明被替换的那份没留在文档里、"被拒"后回落到出厂基色 |
| 变异：去掉"已就绪就不再拉"幂等闸门 | 清单 | **恰 1 红** |
| 变异：去掉"无会话不发请求"令牌闸门 | 清单 | **恰 1 红** |
| 变异：清单条目不再过滤 | 清单 | **恰 1 红** |
| 变异：前缀 `user-` → `cc-` | 清单 | **恰 1 红** |
| 变异：请求失败谎报 `ready` | 清单 ＋ 解析 ＋ 选择器 | **恰 3 红** |
| 变异：**去掉 `Number.isFinite` 校验** | — | **起初 0 红 —— 是测试没打到边界，不是防线不可达**：原用例只喂字符串（被前面的 `typeof` 拦下），而 **JSON 本身能携带 `1e999`**（`JSON.parse` 得 `Infinity`），只是 `JSON.stringify` 会把它压成 `null` 而建不出这种 body。改用手写 JSON 文本后 → **恰 1 红** |
| 变异：**注入改为"先删旧、再挂新"** | — | **起初 0 红 —— jsdom 里无人观测这个顺序**。补一条 `MutationObserver` 用例，按文档看到 mutation 的顺序回放、断言其间主题元素数**从不为 0**，之后 → **恰 1 红** |
| 变异：启动期恢复不校验缓存归属 | 缓存 | **恰 1 红** |
| 变异：拉回的样式不写缓存 | 缓存 | **恰 1 红** |
| 变异：`?v=` 退化为 `0` | 版本 | **恰 2 红** |
| 变异：迟到响应不再丢弃 | 竞态 | **恰 1 红** |
| 变异：取消选择时不作废在途响应 | 竞态 | **恰 1 红** |
| 变异：读失败不清缓存 | 失败态 | **恰 1 红** |
| 变异：读失败不上报 `failedId` | 失败态 | **恰 5 红**——回落可观测是它唯一的出口 |
| 变异：同 id 同 mtime 也重取 | 空转 | **恰 1 红** |
| 变异：已失败的每次渲染都重试 | 重试 | **恰 1 红** |
| 变异：用户主题毋需样式在文档里就算生效 | 解析 | **恰 8 红**——本片改动的判据就是这个，红面最广 |
| 变异：清单未答也报 `missing` | 解析 | **恰 2 红** |
| 变异：清单失败与"确认不存在"混为一谈 | 解析 | **恰 1 红** |
| 变异：内置 id 也不等清单 | 解析 | **恰 2 红** |
| 变异：清单答了就当作样式已上屏 | 解析 | **恰 2 红** |
| 变异：不再把已上屏主题补进选项 | 选择器 | **恰 1 红** |
| 变异：不再把用户主题并进选项 | 选择器 | **恰 3 红** |
| 变异：不再出回落提示 | 选择器 | **恰 3 红** |
| 变异：list 之外的 id 也标为已选 | 选择器 | **恰 2 红** |
| 变异：**注释掉 `main.tsx` 的启动期调用** | — | **0 红 —— 归产物核对层管**：入口文件不被任何单测导入，这一行的存在由下方产物核对代替断言（不是漏测，是"归另一层管"的如实记账） |
| 产物核对（防启动期调用被删） | 未压缩产物里该调用在 `dismissSplash` 之后、`createRoot` 之前 | 命中，且上下文正是 `window.setTimeout(dismissSplash, 15e3); applyCachedUserThemeStyle(); const rootElement = document.getElementById("root")` |
| 产物核对 | 主 chunk 含端点与键名 | `/api/themes` 1 处、`cloudcli.user-theme-style` 1 处、`data-cloudcli-user-theme` 1 处 |
| 基线对照 | 服务端失败集不变 | `git stash push -u` 前后各跑一次 `npm test`，**失败集逐行一致**（各 20 行，全在 Codex / WorkBuddy / Claude 路径解析 / OpenCode 区域，均为预存在的环境相关失败） |

**门槛**：`npm test` 1015 项（994 通过 / 20 失败 / 1 跳过，与 stash 基线**逐行一致**，净新增 0 失败）；`typecheck`（两个 project）干净；`lint` **153 warnings / 0 error**（与 2-A 相同）；`build` exit 0（取真实退出码）；`test:client` **134 文件 / 1018 用例**（2-A 时为 130 / 988，差 **＋4 文件 / ＋30 用例**，与本片新增逐位吻合）；浏览器套件 `theme-tokens` **70 项全过**（含新 spec 3 项 × 2 引擎）。

**与既有账的关系**：**本片无任何视觉变更**——用户主题文件在出厂状态下不存在，`~/.cloudcli/themes/` 为空时清单返回空数组，选择器只多出零项、`data-theme` 与首帧 chrome 色全走原路径。1-H 的对比度账、1-I 的首帧账、B3 的"选择器级消费者"账均不受影响；阶段 0 迁移账不变。

**顺带记一条与本片无关的基线事实**：记录里"`npm test` 1012 项 / 19 失败"与本次"1015 / 20"都不是稳定值——已验证与本次改动无关（stash 前后同值）。已查明的一处来源是 `npm test` 的 glob 为 `server/**/*.test.ts` **＋** `server/**/*.test.js`，而仓库里恰好有一个已入库的 `.js` 测试（`server/modules/providers/list/opencode/opencode-runtime.provider.test.js`），故文件集是 **131** 而非 130。**结论：服务端套件只能做 A/B 红集对照，不能拿绝对计数当基线。**

#### 2-C 实施记录（2026-09-26，`463772bd`）

**范围**：新增 `src/shared/userThemeTokens.ts`（令牌白名单 ＋ 值形状规则 ＋ 结构闸门 ＋ `.json` → 覆盖层编译）；`src/shared/userThemeStyles.ts` 加 `compileThemeSource` 格式分派与 `warnIgnored`，并把**编译产物**（而非原文）注入与写缓存；`src/shared/userThemes.ts` 加 `coverage`（`isEntry` 改为宽松的 `readEntry`）；`server/modules/themes/services/theme-files.service.ts` 加 `readDeclaredMetadata`；`ThemeContext` / `ThemeSelector` 透传 `coverage`；`tests/theme-tokens/main.ts` 加 `format` 选项，新增真引擎 spec。测试：新文件 1 个 18 项，既有三处补 7 项，服务端补 3 项，真引擎 spec 3 项（2 引擎）。`.oxlintrc.json` 登记新 shared 模块。

**决策（11 条）**

1. **文件里的 `appearance` 取"作用域"读法，编译期生效**——这是本片唯一停下拍板处。§5.3 的 `ThemeManifest.appearance` 是**角色**（`light` / `dark` 是外观默认、`system` 是覆盖层），照角色读则文件这个键恒为 `system`、毫无作用。改为作用域：`light` → `:not(.dark)`、`dark` → `.dark`、`system` / 缺省 → 裸选择器。另两种被否读法（删键 / 只收 `system`）留档于 §5.6 v13；将来改判只动 `selectorFor` 一处。
2. **服务端只读"显示用"的元数据**：`name` / `coverage` 在列举时读出，`appearance` 不读。分工判据是**这个字段改变的是列表还是样式表**——前者归服务端，后者归编译器。
3. **白名单按家族授权，L2 逐个列出**：家族（`--palette-*` / `--n-*` / `--term-*` / `--editor-*` / `--nav-*`）会随样式表演化，逐个枚举会让写给旧版的合法主题在令牌退役当天开始失败；L2 语义令牌（19 个）逐个列出，因为一个模式会放进任何"看着像"的名字。
4. **`var()` 引用的目标也须自身可授权**：否则一次引用就能读到白名单外的令牌，白名单等于漏空。
5. **值形状按"色值最终交给谁"定**（与 §5.9 两条消费者判据同源）：交给 `hsl(...)` 的收**三元组**，交给 `EditorView.theme()` 的收**完整表达式**；`--term-*` 因此**拒绝 hex**——`#0b1220` 会编译成 `hsl(#0b1220)`、被浏览器丢弃、终端静默不变。这条同时修掉 §5.5 示例自身的 hex bug（§5.5 v3）。
6. **结构闸门如实定性**：它当前**挡不住任何东西**——每条值规则自己的字符类已排除逃逸字符，关掉它的真引擎变异是 0 红（见下方证据）。它买的是"整份拒绝 vs 丢一条"的**拒绝语义**，以及"将来放宽某条规则不会静默开洞"的单一承诺点。模块注释与测试注释据此改写，不声称一个演示不出的防御。
7. **拒绝粒度分两层**：逃逸形状 ⇒ **整份拒绝**（写原始 CSS 的人用错格式）；未知令牌 / 非字符串 / 形状不合 ⇒ **丢该条 ＋ `warnIgnored` 报出**，文件照常可用；一条都不剩 ⇒ `nothing-usable` 整份拒绝（不注入一个空块）。
8. **`.tmTheme` 显式拒绝**：不静默把 plist 当 CSS 注入——那会往文档里放一个匹配不到东西的元素，选择器显示"已生效"而页面没变。缺口可见，等 2-E。
9. **缓存编译产物而非原文**：启动期恢复是纯同步注入（`main.tsx` 在 React 挂载前调），存原文就得在启动路径再编译一次；存编译产物让恢复保持一行 `textContent`，编译失败也只需在加载路径处理一次。
10. **`coverage` 两端读法不同**：服务端严格（未知 ⇒ 告警 ＋ 丢字段）、客户端宽松（未知 ⇒ 只不画徽标、条目存活）。理由：客户端上"丢一个主题"的代价大于"少一个徽标"。
11. **`readEntry` 取代 `isEntry`**：只有 `coverage` 宽松，`format` 仍严格——未知格式没有编译器可用，留着也没法注入。

**如实边界（4 条）**

1. **`.tmTheme` 未支持**（显式拒绝），归 2-E。
2. **§5.10 的"用户主题对比度只警告不阻断"仍未实现**：2-C 的校验器是**形状校验器**，只问"值能不能被消费端解析"，不问"读了清不清楚"。一个形状完全合法、但 `--foreground` 落 `--background` 不足 3:1 的主题，2-C **照收不误**。把"合法但不可读"变成可见警告仍待后续片（可并入 2-D 或独立成片）。
3. **被丢条目只在控制台**：`warnIgnored` 写 `console.warn`，选择器 / 设置页看不到"你写的哪一条被丢了"。呈现归 2-D。
4. **白名单是当前样式表的快照**：`--cc-syntax-*` / 几何族 / `--tw-*` 未授权（§5.8 v4），随语义化改名立项时同步扩充——这是**到期条件**（改名轮未立项，见 §5.7"语义化改名（显式未做）"），不是永久边界。另：`--n-*` 兼容档位层已拍板为**永久契约面**（同见 §5.7），不在"随改名调整"的范畴内。

**证据**

| 项 | 预期 | 实测 |
|---|---|---|
| 新增 / 补测单测 | — | `userThemeTokens` 18；`userThemeStyles` 16（＋5）；`userThemes` 9（＋1）；`themeSelectorUserThemes` 6（＋1）；合计 **＋25**，与 `test:client` 增量逐位吻合 |
| 服务端单测 | — | 14 项（service 11 ＋ routes 3）全过 |
| 真引擎 spec | 浅色限定的覆盖层**只在浅色生效、不泄漏进暗色** | 3 项 × chromium ＋ webkit 全绿（jsdom 证不了"不泄漏"，故用真引擎） |
| 变异：id 模式放宽 | 选择器安全 | 恰 1 红 |
| 变异：白名单兜底成 `expression` | 白名单 | 恰 3 红 |
| 变异：语义集合漏掉 `--primary` | 编译 | 恰 10 红（红面最广——`--primary` 是示例主题的主角） |
| 变异：alpha 变回必填 | 导航玻璃板 | 恰 1 红 |
| 变异：`triplet` 规则放松 | 三元组 | 恰 1 红（**改瞄后**：原用例没喂到"规则恰为 `triplet`"的令牌，补 `--palette-brand-500: '#2f6fdb'` 后命中） |
| 变异：`expression` 规则收紧 | 编辑器 chrome | 恰 1 红 |
| 变异：`light` 限定去掉 `:not(.dark)` | 作用域 | 恰 1 红 |
| 变异：`dark` 限定去掉 `.dark` | 作用域 | 恰 2 红 |
| 变异：非法 `appearance` 静默吞掉 | 作用域上报 | 恰 1 红 |
| 变异：空 `tokens` 闸门关掉 | 编译 | 恰 1 红 |
| 变异：`nothing-usable` 闸门关掉 | 编译 | 恰 2 红 |
| 变异：**非字符串值强制 `String()`** | — | 起初 0 红——**变异点落在 `typeof` 闸门之后，是死代码**（与 2-A 那处被屏蔽的包含检查同类）；改瞄到闸门自己的理由串 → 恰 1 红 |
| 变异：值长上限去掉 | 编译 | 恰 1 红 |
| 变异：声明顺序反转 | 编译 | 恰 2 红 |
| 变异：`json` 分支关掉 | 格式分派 | 恰 4 红 |
| 变异：`.tmTheme` 直接当 CSS 注入 | 格式分派 | 恰 1 红 |
| 变异：缓存存原始 body | 缓存 | 恰 1 红 |
| 变异：被丢弃令牌静默 | 上报 | 恰 1 红 |
| 变异：服务端不读元数据 | 元数据 | 恰 2 红 |
| 变异：`coverage` 不做校验 | 元数据 | 恰 1 红 |
| 变异：名字长上限去掉 | 元数据 | 恰 1 红 |
| 变异：名字不再回落文件名 | 元数据 | 恰 1 红 |
| 变异：客户端 `coverage` 不再白名单化 | 清单 | 恰 1 红 |
| 变异：**结构闸门关掉** | — | 单测 **恰 2 红**（拒绝语义），**真引擎 0 红**（逃逸形状到不了文档——值规则已排除逃逸字符）。两数之差正是决策 6 那句话的证据 |
| 产物核对（客户端） | 编译器进主 chunk | 五个失败原因串（`unsafe-id` / `unreadable-json` / `no-tokens` / `unsafe-value` / `nothing-usable`）＋ 白名单与作用域文案各命中 1 处 |
| 产物核对（服务端） | 元数据读取进产物 | `dist-server/server/modules/themes/services/theme-files.service.js` 含 `readDeclaredMetadata` / `declares an unknown coverage` / `MAX_DECLARED_NAME_LENGTH` |
| 基线对照 | 服务端失败集不变 | `git stash push -u` 前后各跑一次 `npm test`（基线 1015 项 / 本片 1017 项，＋2 为本片新增服务端用例）；`# fail` 随运行在 **19~21** 间漂移。把 `ok N - ` 前缀归一后做**名字集**对照：基线有而 2-C 无为 **0 行**、2-C 有而基线无为 **2 行**（`getStatus detects a codebuddy executable on PATH`、`workbuddy run closes one stdin…`）——两条都在已知的 WorkBuddy / CodeBuddy 抖动区，**同一棵树重跑本身就会变**，非本片回归 |

**门槛**：`npm test` **1017 项、1 跳过**，失败数随运行在 **20~21** 间漂移（本记录复核两次分别为 995 通过 / 21 失败与 996 / 20），漂移的正是上述两条环境抖动——按名字集与 stash 基线**仅差它们**；`typecheck`（前后端两个 project）与 `typecheck:theme-tokens` 均干净；`lint` **153 warnings / 0 error**（与 2-A / 2-B 相同，无新增）；`test:client` **135 文件 / 1043 用例全过**（2-B 为 134 / 1018，差 **＋1 文件 / ＋25 用例**，与本片新增逐位吻合）；`build` exit 0；浏览器套件 `theme-tokens` **76 项全过**（2-B 70，＋6 ＝ 新 spec 3 项 × 2 引擎）。

**与既有账的关系**：**本片在出厂状态下无视觉变更**——`~/.cloudcli/themes/` 为空时新代码路径都不执行，基色 / 覆盖层 / 首帧 chrome / 阶段 0 迁移账 / B3 账均不变。**但有一处对已存在用户文件的定义变更**：2-B 时任何格式的文件都**原样注入**，故一个 `.json` 文件此前是"把 JSON 当 CSS 注入"（大多被解析器丢弃、等于没用）；2-C 起 `.json` 必须通过白名单与形状校验，畸形 JSON 会被**拒**而不再注入。这是本片的目的而非回归，仅影响已有用户文件，在此点明。

#### 2-D 实施记录（2026-09-26，`540e6fba`）

**范围**：新增 `src/shared/userThemePastes.ts`（粘贴主题 store）、`src/shared/themeReset.ts`（§5.6 的强制恢复通道）、`src/modules/settings/UserThemesSection.tsx`（设置页用户主题分区）；`src/shared/userThemeStyles.ts` 由"只认文件条目"改为**单入口 ＋ 目标联合**（`UserThemeStyleTarget`），并改名 `applyCachedUserThemeStyle` → `applyBootUserThemeStyle`；`src/shared/userSettings.ts` 加 `userThemePastes` 偏好键（及其 `LEGACY_STORAGE_KEYS` 条目）与新原语 `preferLocalValueOnHydrate`；`src/shared/types.ts` 的 `source` 扩为三值并新增 `PastedUserTheme`；`ThemeContext` 订阅粘贴 store、把两类用户主题合并进 `userThemes`、补 `paste-` 的回落分支；`AppearanceSettingsTab` 渲染新分区；`src/main.tsx` 启动序改为"先 `applyThemeResetRequest()`、后 `applyBootUserThemeStyle()`"；两个 locale 各加 23 条 `userThemes.*`（含新的 `too-large`）；`.oxlintrc.json` 登记两个新 shared 模块；`tests/theme-tokens/main.ts` 加 `paste` 选项（绕过桩文件服务器）。测试：3 个新文件 **23 项**（`userThemePastes` 12 ／ `themeReset` 5 ／ `userThemesSection` 6）＋ 既有三处补测 10 项 ＋ 真引擎 spec 1 项（2 引擎）。

**决策（11 条）**

1. **`source` 采三值（`builtin` / `user` / `user-paste`），不从 id 前缀派生**——本片第一处裁定。字段问的是"它从哪来"，而来源真的有三个答案，每个对"本机有没有它"与"UI 能不能删它"各给一对不同答复（内置：有 / 不可删；文件：可能这台没有、且 UI 不可删；粘贴：随偏好恒在、**必须可删**）。另两种被否读法留档于 §5.3 v11：① 由 id 前缀（`user-` / `paste-`）派生——那会绕开这个字段本身（它存在的意义就是别让大家去解析 id）；② 保留 `user` 加一个并列布尔——两个会漂移的字段。
2. **一个 store、一条缝，不是两个 store**——`UserThemeStyleTarget = { kind:'file'; entry } | { kind:'paste'; theme }`。粘贴与文件的差别**恰好只有一步：文本怎么拿到**；而文档同一时刻只能穿一套主题，两个 store 各存各的"当前生效"必然打架。
3. **"还算不算当前"的版本键按来源分两种**：文件用 `modifiedAt`（同 `?v=` 的缓存键），粘贴用**内容字符串本身**——粘贴没有 mtime，而比文本既更简单也更准（`nextPasteId` 会复用最小空号，所以"同 id、换内容"确有可能）。
4. **粘贴不建缓存镜像**：文件的编译产物进 `localStorage`，是因为 fetch 是异步的、首帧等不得；粘贴的内容本来就在偏好镜像里，`applyBootUserThemeStyle` 首帧直接编译即可——少一份要同步的副本（`writeCache` 因此被收进 `if (target.kind === 'file')`）。
5. **粘贴没有"加载中"这一态**：`themeFallback` 对 `paste-` id 只凭清单就定论（`failedId` ⇒ `loadFailed`，否则 `pickedPaste ? null : missing`）。承 2-B 的判据——**下一帧就要收回的提示比等待更糟**，而这里根本没有可等的东西。
6. **删掉一个粘贴主题时连带清掉指向它的选择**（`removePastedTheme` 同时写 `themeId: null`），否则选择器会把用户自己的删除报成"未安装"。
7. **恢复通道取三条候选中的第 ③ 条（`?theme=default`）**：不需要键盘、不需要设备配置、能在首帧之前生效、能在测试浏览器里被真跑到。它丢的是**选择而非主题**（条目还在，修好可重选）；参数在应用时即从 URL 删掉（`history.replaceState`），否则每次刷新都重置、再也留不住别的主题。三条候选的取舍与自愈哨兵未做的理由见 §5.6 v14。
8. **重置必须压过紧随其后的 hydrate**：boot 时没有会话，`themeId: null` 只写得进镜像；随后 auth 落定触发的 hydrate（`AuthContext.tsx:147`）会把那个不能用的选择原样放回。为此新增一个**通用**原语 `preferLocalValueOnHydrate(key, value)` → `hydrateOverrides`，由 `hydrateUserPreferences` **覆写 `serverPreferences[key]` 并排进 migrations**（服务器最终也同意）、在 `resetUserPreferences` 清空。**这不是 2-B"hydration 取消 pre-hydrate 写入"那条的例外**——那条防的是**过时**的值（另一台设备的旧写入不得盖回服务器），这条是**蓄意的、更新的**决定，且是**发出去**而非只留在本地。
9. **同一校验器，只放宽 id 前缀**：`THEME_ID_PATTERN` 由 `/^user-[a-z0-9._-]+$/` 改为 `/^(?:user|paste)-[a-z0-9._-]+$/`，**字符类一个字符没动**——那半是选择器的要求，与来源无关。
10. **粘贴补上与文件同值的大小上限**（`MAX_PASTE_BYTES = 256 * 1024`）：新失败原因 `too-large`，在 `addPastedTheme` **首查**、**按字节量**（`TextEncoder`，不是 `.length`——后者是 UTF-16 码元数，一段中文 CSS 会因此放进约三倍于上限的内容）。见 §5.8 v5。
11. **客户端 store 读法保持宽松，且"知道什么说什么"**：`readList` 坏行**丢自己、不丢列表**（同 `readEntry`）；未知 `coverage` 丢字段、保留条目；名字取 JSON 自带的 `name`、缺则回落 id（不编一个）。

**如实边界（6 条）**

1. **`.tmTheme` 仍只显式拒绝**（承 2-C），归 2-E。**（2-E 已结清：`.tmTheme` 自 `a2d0a515` 起可用。）**
2. **§5.10 的"用户主题对比度只警告不阻断"仍未实现**（承 2-C）：本片把"被丢条目"的**呈现**做出来了（分区里的失败文案），但校验器仍只管**形状**、不管可读性。**（仍开放，改归 2-F；2-F1 复核后再改归 2-G——它不能与粘贴线同片落地，理由见切片表下范围裁定。）** **（2-G 已结清：新增 `src/shared/userThemeContrast.ts`，未声明的那一侧以**出厂基色**为准，非阻断、两处通道；那个把"形状"与"可读性"分开的观察正是本片的落点——`ignored` 与 `warnings` 成了两个字段。见 §5.10 v2。）**
3. **原始 CSS（选项 B）还不能粘贴**：粘贴线只走选项 A 的令牌 JSON。`?theme=default` 已落地，但"有害 CSS 可用它退出"这条验收要等 2-E 才能完整跑通。**（2-E 复核后改判：这条的后半归属错了——可写原始 CSS 的**文件**线自 2-B / 2-C 起就成立，故该验收**文件线已可完整跑通**；真正待做的是选项 B 的**粘贴**线，改归 2-F。见切片表下"为什么 2-E 只剩 B2"。2-F1 已结清：`d3ebe1e6` 起粘贴框可收原始 CSS。）**
4. **设置页的文件区没有删除 / 编辑按钮**——§5.8 的目录是**只读**的，文件的增改删只能在磁盘上做。这是有意的，不是漏做（粘贴区才是唯一可删的地方）。
5. **清单每会话只读一次**（承 2-B）：粘贴列表**不**受此限（它来自偏好镜像、随偏好同步），但文件的增删仍要刷新才反映。
6. **自愈哨兵未做**：`sentinelClass` 是保留位；本片只落地三条恢复通道里的 URL 一条。

**证据**

| 项 | 预期 | 实测 |
|---|---|---|
| 新增 / 补测单测 | — | 新 3 文件 23 项（`userThemePastes` 12 含 `too-large` ／ `themeReset` 5 含"在途 fetch 不得重注"与"重置要压过 hydrate" ／ `userThemesSection` 6）；`userThemeStyles` 16→21、`userThemeResolution` 6→9、`userSettings` 补 2（合计 ＋33，与 `test:client` 增量逐位吻合） |
| 真引擎 spec | 粘贴主题经偏好镜像注入后**真的**压过基色 | 1 项 × chromium ＋ webkit 全绿（`paste` 选项完全绕过桩文件服务器，证明这条线不依赖 host） |
| 变异 · `userThemePastes`（12 处） | 每处新行为都有测试管 | M1 删主题不清连带选择 **1** ／ M2 连带判据放松 **1** ／ M3 id 序列退化为 `paste-1` **2** ／ M4 不校验 id 模式 **1** ／ M5 存储 `coverage` 不白名单化 **1** ／ M6 清单缓存恒失效 **1** ／ M7 不查编译结果 **2** ／ M8 名字不回落 JSON 自带 `name` **1** ／ M9 `isPastedThemeId` 恒 false **2** ／ M10 元数据 `coverage` 不白名单化 **1** ／ M11 不复制元数据 `coverage` **1** ／ **M28 删掉大小上限那一整段检查 1** |
| 变异 · `userThemeStyles`（4 处） | 目标联合的中缝 | M12 缓存写入不分来源 **1** ／ M13 启动期不恢复粘贴主题 **2** ／ M25 粘贴版本键由内容改成 id **1** ／ M27 `clearAppliedUserThemeStyle` 不递增 `operation`（在途 fetch 可重注）**1** |
| 变异 · `themeReset` ＋ `userSettings`（4 处） | 恢复通道与 hydrate 覆写 | M14 重置不清 URL 参数 **1** ／ M15 重置不写 hydrate 覆写 **1** ／ M16 `hydrateUserPreferences` 不应用覆写 **2** ／ M17 `resetUserPreferences` 不清覆写 **1** |
| 变异 · `ThemeContext`（4 处） | 解析并入与回落 | M18 粘贴 `source` 标成 `user` **1** ／ M19 `paste-` 回落分支整段删 **2** ／ M20 粘贴订阅空转 **2** ／ M29 回落判据删（永远报 `missing`）**1** |
| 变异 · `UserThemesSection`（4 处） | 分区展示 | M21 文件区筛选条件改 `user-paste` **2** ／ M22 粘贴区筛选条件改 `builtin` **3** ／ M23 添加成功不清输入框 **1** ／ M24 失败原因不上报 **1** |
| 变异 · `userThemeTokens`（1 处） | 前缀放宽 | **M26 id 前缀收回 `user-` 只 ⇒ 9 红**——粘贴侧全线塌，红面最宽 |
| 变异总计 | — | **29/29 RED、0 UNPROVEN**；单点最准的是 M28（尺寸上限）与 M25（版本键）各恰 1 红，说明这两条不是"写在文档里而没被断言" |
| 产物核对（客户端） | 新代码进产物 | `userThemePastes` / `deleteAria` / `resetHint` / `too-large` / `theme=default` / `nothing-usable` / `is not a token a theme may set` / 重置告警串各命中 **1** 个 `dist/assets/*.js`；`paste-` 字面 1 处 |
| 基线对照 | 服务端失败集不变 | **`git diff e7973876 HEAD -- server/` = 0 行**——本片服务端树与 2-C **逐字节相同**，故红集不可能变（这一片无需 stash A/B，因为无可对照的差异）。实跑 `npm test` 复核：**1015 项 / 994 通过 / 20 失败 / 1 跳过**，20 条全在已知的环境相关抖动区（Codex catalog ×9、WorkBuddy ×3、Claude 路径解析 ×4、OpenCode ×3、`agent.routes.test.ts` 文件级 ×1，其中 `synchronizer` 一条重复计数），与 2-A / 2-B / 2-C 的记录同区 |

**门槛**：`npm test` **1015 项、1 跳过、20 失败**（全在已知抖动区，服务端零改动见上）；`typecheck`（前后端两个 project）与 `typecheck:theme-tokens` 均干净；`lint` **153 warnings / 0 error**（与 2-A / 2-B / 2-C 相同，无新增）；`test:client` **138 文件 / 1076 用例全过**（2-C 为 135 / 1043，差 **＋3 文件 / ＋33 用例**，与本片新增逐位吻合）；`build` exit 0（取真实退出码）；浏览器套件 `theme-tokens` **78 项全过**（2-C 76，＋2 ＝ 新 spec 1 项 × 2 引擎）。

**与既有账的关系**：**本片在出厂状态下无视觉变更**——粘贴列表为空、`themeId` 为空时新路径都不执行；恢复通道只在 URL 带 `?theme=default` 时才动作，出厂 URL 不带。基色 / 覆盖层 / 首帧 chrome / 阶段 0 迁移账 / B3 账均不变。**两处需要点明的语义新增**：① 偏好接口自此会承载 **`userThemePastes`** 这个可跨设备同步的键，其值最大 256KB/条（服务端 `user.service.ts` 只限键长 200、不限值长；实际约束来自 `localStorage` 的约 5MB 总量与这条 256KB 单条上限，故**多条大主题可能撞上镜像容量**——届时写入静默失败、损失的是"这台设备记住它"，不是主题本身，因为内容仍在服务器的偏好行里）；② `?theme=default` 是**用户可见**的新 URL 语义，只此一个值有意义。

#### 2-E 实施记录（2026-09-26，`a2d0a515`）

**范围**：新增 `src/shared/tmTheme.ts`（`.tmTheme` → 覆盖层编译器）与 `src/shared/tests/tmTheme.test.ts`（16 项）；`src/shared/userThemeStyles.ts` 的 `.tmTheme` 分支由"显式拒绝"改为真编译，缓存条目新增派生 `fingerprint`；`src/shared/userThemeTokens.ts` 导出 `isThemableThemeId` / `themeOverlaySelector`，两个编译器共用同一份 id 规则与同一种选择器形状（不再各存一份）；`src/shared/syntaxTheme.ts` 的注入改为插到 `<head>` 最前，并拆出导出函数 `ensureSyntaxStyleElement`；`tests/theme-tokens/main.ts` 加 `readSyntaxToken` / `reinjectSyntaxStyleSheet` 两个探针，新增真引擎 spec `user-theme-tmtheme.spec.ts`（2 项）；`tests/theme-tokens/tsconfig.json` 的 `types` 补 `react-syntax-highlighter`；`markdownSyntaxThemeInjection.test.tsx` 补一条 `<head>` 次序断言（放诱饵元素后重跑注入）；两个 locale 的 `userThemes.files.empty` 由两种扩展名扩到三种；`.oxlintrc.json` 登记新 shared 模块。测试：新文件 1 个 16 项、`userThemeStyles` 21→25（＋4）、`markdownSyntaxThemeInjection` 4→5（＋1），合计 **＋1 文件 / ＋21 项**。

**决策（10 条）**

1. **本片实际只剩 B2，切片边界按实测重划**——开工时读代码确认，"选项 B 的原始 CSS"早在 2-B（原样注入）／2-C（`compileThemeSource` 里 `.css` 直接透传）就在文件线上交付，再写一遍是重复。真正缺的是 **B2** 与**选项 B 的粘贴线**；后者与"高级模式"开关、§5.10 的对比度警告一并另立 **2-F**。这不是范围缩水，是把一个已经被交付的东西从片里划掉。
2. **一次编译、两种取值形状**：全局色写终端时转 **HSL 三元组**，写编辑器 / 语法时留 **hex**。这不是两种意见，是同一条 §5.9 规则（值要长成消费者要的样子）在两个消费者处的两次落笔——`--term-*` 由 `hsl(var(--term-…))` 解析（`terminalTheme.ts:60`），写 hex 会编译成 `hsl(#282a36)`、被浏览器丢弃、终端静默保留上一个颜色；这正是 §5.5 v3 记在选项 A 示例上的同一个 bug。alpha 只在终端侧丢掉，因为三元组没有它的位置；hex 侧连 alpha 一起保留（那属主题作者的表达）。
3. **语法变量名一个数字都不手写**：全部经 `SYNTAX_TOKEN_MAP` 取。于是 Prism bump 导致编号重排时编译产物自动跟着走，主题不会绑死在旧编号上——这正是 0-D 立下"名字 ↔ 编号的绑定只存在一处"时想要的收益。
4. **`scope` → 槽位是一张十行投影表，不是白名单**：匹配规则＝**等于**某模式或是它的**点分子孙**（`keyword.control` 归 `keyword`）；多模式命中**取最长**（`constant.numeric` 归 `number` 而非 `constant`）；同一槽位**后写赢**；`scope` 的逗号列表逐个匹配。没有任何规则提到的槽位**回落全局前景色**而不是保留基色——TextMate 里没提到的 scope 就是前景色，留着基色会让一个文件里混进两套配色。表里没有的 scope **不报**：落到表外是常态，逐条报会把控制台变成噪音。
5. **`fontStyle` 不携带，但上报**：本 app 没有承载字体样式的令牌（`--cc-syntax-*` 是颜色），声明了它的主题会丢掉那部分——但在 `ignored` 里报一行，因为静默丢字体样式会被读成编译器 bug。
6. **解析用 `DOMParser`，不手写 plist 解析器**：该格式就是 XML，浏览器已有引擎；自己写要重新实现实体处理、自闭合标签与 CDATA，收益为零。判定分两层：非 plist（含畸形 XML）⇒ `unreadable-plist`（**拒绝**）；是个 plist 但一条可用颜色都没有 ⇒ `nothing-usable`（**丢**）。
7. **`.tmTheme` 是局部主题；"同名 `.css` 补足"经核实不成立**：服务端按 id 去重（`Nord.tmTheme` 与 `nord.css` 同为 `user-nord`，2-A 决策 5），两个同名文件只有一个会被列出，所以"`.tmTheme` 管色 ＋ 同名 `.css` 管布局"这个组合拿不到。于是单独一个 `.tmTheme` 只覆盖语法 / 编辑器 / 终端，主 UI 留在基色；`coverage` 不声明、选择器不画徽标（§5.8 v4 的"知道什么说什么"）。改判记于 §5.5 v4。
8. **基色表必须落在 `<head>` 最前（本片修掉的一处真实隐患）**：用户主题的样式表是**追加**到 `<head>`，`:root` 与 `[data-theme="…"]` 都匹配 `<html>`、权重相同，胜负由**文档顺序**定，后到的赢。语法基色表此前也是追加，一旦它晚于覆盖层落位（例如这个模块将来不再被入口图静态引入、而由后加载的 chunk 带入），覆盖层的 `--cc-syntax-*` 就会被基色表静静压掉。改为 `insertBefore(styleElement, head.firstChild)`；模块注释写明这是"基色层必须在前"的结构约定，并导出 `ensureSyntaxStyleElement` 让测试能驱动"晚注入"这一情形。
9. **缓存指纹派生而非手维护**：`COMPILED_OUTPUT_FINGERPRINT = JSON.stringify(SYNTAX_TOKEN_MAP)`。缓存里存的是**编译产物**，而 `.tmTheme` 的产物里嵌着构建期派生的编号——Prism 重排编号后，上一版编译的缓存会在首帧恢复**旧编号**，并且因为比对的是文件的 `modifiedAt`（没动）而看着"最新"。boot 恢复因此要求缓存指纹相符；不符的**留在原地但不画**（清单随即重读并覆写，它仍是当下唯一知道该主题版本的东西）。指纹由映射派生，理由与映射本身同（0-D）：需要有人记得去 bump 的常量一定会被忘记。
10. **id 与选择器两处原语共用**：`isThemableThemeId` / `themeOverlaySelector` 从 `userThemeTokens` 导出，`.tmTheme` 编译器据此强制同一条 id 规则、写出同一种选择器形状——两个编译器写同一种选择器，不该各存一份"什么能安全放进去"的判断。

**如实边界（4 条）**

1. **`.tmTheme` 覆盖不了主 UI**：它只谈代码的颜色，没有布局 / 面层令牌。要主 UI 也变就写 `.css`（它会取代同名的 `.tmTheme`）；唯一还没做的补足途径是那个可选的 `cloudcli` 内嵌扩展键，与 §5.12 同列待定。**（2-I 已结清：`cloudcli` 内嵌键落地，`.tmTheme` 自此可覆盖主 UI 并声明 coverage，见 §5.5 v7。）**
2. **`fontStyle` 丢失；非 hex 值丢弃**（两者都上报）。表外的 scope **不报**（决策 4）。
3. **§5.10 的"用户主题对比度只警告不阻断"仍未实现**（承 2-C / 2-D）：`.tmTheme` 编译器和选项 A 的校验器一样只管**形状**、不管可读性。归 2-F。**（2-F1 复核后改归 2-G——它不能与粘贴线同片落地：选项 A 的令牌 `var()` 可链，声明值的对比度在编译期算不出，见切片表下范围裁定。）** **（2-G 已结清：`.tmTheme` 那条分支如实带空 `warnings`——它说的是语法 / 编辑器 / 终端槽位，没有一个是 §5.10 配对里的令牌。见 §5.10 v2 决策 11。2-I 复核：该结论只对无内嵌键的文件成立——`cloudcli` 键落地后 `.tmTheme` 可携带选项 A 令牌，其 warnings 走同一条通道，见 §5.5 v7 第五条。）**
4. **选项 B 的原始 CSS 仍不能粘贴**（承 2-D）：粘贴线只走选项 A 的令牌 JSON。归 2-F。**（2-F1 已结清：`d3ebe1e6` 起粘贴框可收原始 CSS。）**

**证据**

| 项 | 预期 | 实测 |
|---|---|---|
| 变异 · `tmTheme`（16 处） | 每条新行为都有测试管 | M1 非 hex 不再拒 **1** ／ M2 终端不转三元组 **3** ／ M3 三 / 四位数不展开 **1** ／ M4 取最短匹配 **1** ／ M5 同槽先写赢 **1** ／ M6 槽位不回落前景色 **2** ／ M7 多写一个 `--<key>` 声明 **1** ／ M8 逗号列表不拆 **1** ／ M9 点分子孙不认 **2** ／ M10 `fontStyle` 不报 **1** ／ M11 plist 拒绝理由串改成 `nothing-usable` **2** ／ M12 空声明闸门关掉 **1** ／ M13 id 不校验 **1** ／ M14 `selectionForeground` 多喂编辑器 **1** ／ **M15 语法名硬编码成 `--cc-syntax-3` 9 红**（红面最广——十个槽位全塌）／ M16 `lineHighlight` 不映射 **1** |
| 变异 · `userThemeStyles`（5 处） | 缓存指纹与 `.tmTheme` 分派 | M17 恢复不看指纹 **1** ／ **M18 指纹的类型闸门去掉** 由 **`tsc` 捕获**（TS2322：`unknown` 不可赋给 `string`——这条闸门买的是类型诚实，运行期由下游比较兜住，故单测无红、编译器有红，见下）／ M19 `.tmTheme` 当 CSS 注入 **2** ／ M22 写缓存时指纹写错 **1** |
| 变异 · `syntaxTheme`（1 处） | 基色表落位 | M20 改回 `appendChild` **1 红**（jsdom 次序断言）；同一条另经真引擎 A/B 确认——手工把 `insertBefore` 改回 `appendChild`，`user-theme-tmtheme` 两个引擎各 1 项红，正是那条"覆盖层压过基色表"的用例 |
| 变异 · `userThemeTokens`（1 处） | id 原语 | M21 id 校验恒 true **1** |
| 变异总计 | — | **22/22 RED、0 UNPROVEN**。其中 M18 的判据是"**有没有可区分输入**"——没有（下游 `===` 对非字符串恒假，行为等价），故改瞄到**编译器**这一层：它买的是 destructure 之后的类型诚实 |
| 新增 / 补测单测 | — | `tmTheme` 16（新文件）、`userThemeStyles` 21→25（＋4）、`markdownSyntaxThemeInjection` 4→5（＋1）＝ **＋1 文件 / ＋21 项**，与 `test:client` 增量逐位吻合 |
| 真引擎 spec | `.tmTheme` 的编辑器 / 终端令牌**真的**动、且语法覆盖**真的**压过基色表 | 2 项 × chromium ＋ webkit ＝ **＋4** 全绿（jsdom 证不了文档顺序与 `hsl()` 解析，故用真引擎） |
| 产物核对（客户端） | 编译器进产物 | `unreadable-plist` 1 ／ `is not a usable .tmTheme` 1 ／ `has a foreground that is not a hexadecimal colour` 1 ／ `is not carried: no token in this app takes a font style` 1 ／ `is not a hexadecimal colour` 2（＝独立那条 ＋ 上一条的子串）／ `nothing-usable` 4（`.tmTheme` 与选项 A 共用该词） |
| 产物核对（服务端） | 本片不得出现在服务端 | `dist-server` 里的 21 处 `tmTheme` **全部来自 2-A**（`theme-files.service.js` 的扩展名表 / `Content-Type` 表 / 去重注释 ＋ 其编译后的测试），`unreadable-plist` 与 `ensureSyntaxStyleElement` 均 **0** |
| 基线对照 | 服务端失败集不变 | **`git diff e7973876 HEAD -- server/` = 0 行**、工作区 `server/` 亦 **0 处**——服务端树与 2-C **逐字节相同**，故红集不可能变（无需 stash A/B）。实跑 `npm test` 复核：**1017 项 / 996 通过 / 20 失败 / 1 跳过**，20 条按名归：Codex catalog ×9、`resolveClaudeCodeExecutablePath` ×4、WorkBuddy / CodeBuddy `getStatus` ×3 ＋ `workbuddy run` ×1、OpenCode `spawnOpenCode` ×1、`synchronizer` ×2（**同一用例重复计数**）——与 2-A…2-D 记录的同一环境抖动区 |

**门槛**：`npm test` **1017 项、1 跳过、20 失败 / 996 通过**（全在已知抖动区，服务端零改动见上）；`typecheck`（前后端两个 project）与 `typecheck:theme-tokens` 均干净；`lint` **153 warnings / 0 error**（与 2-A…2-D 相同，无新增）；`test:client` **139 文件 / 1097 用例全过**（2-D 为 138 / 1076，差 **＋1 文件 / ＋21 用例**，与本片新增逐位吻合）；`build` exit 0（客户端 chunk 与 `dist-server` 均重新产出，取真实退出码）；浏览器套件 `theme-tokens` **82 项全过**（2-D 78，＋4 ＝ 新 spec 2 项 × 2 引擎）。

**与既有账的关系**：**本片在出厂状态下无视觉变更**——`~/.cloudcli/themes/` 为空、`themeId` 为空时新路径都不执行；基色表移到 `<head>` 最前在一次求值时看不出差别（那时 `<head>` 里只有它）；缓存指纹只在有用户主题文件时才被写入与比对。**三处需要点明的语义新增**：① 设置页文件区的**空态文案**由"`.css` 或 `.json`"扩到"`.css`、`.json` 或 `.tmTheme`"（en ＋ zh-CN 各一条，用户可见）；② `.tmTheme` 自本片起**可用**（此前是显式拒绝）——一个此前被拒的文件现在会生效，这是本片的目的；③ 缓存条目多了一个 `fingerprint` 字段，**旧版本写入的条目（无该字段）不会被恢复**，代价是升级后首次加载的**首帧**按基色渲染、随后由清单重读补上，不丢任何东西。

#### 2-F1 实施记录（2026-09-26，`d3ebe1e6`）

**范围**：`src/shared/types.ts` 的 `PastedUserTheme` 加 `format: 'json' | 'css'`（`content` 的注释随之改写）；`src/shared/userThemePastes.ts` 新增 `PastedThemeFormat` / `FORMATS` / `IMPORT_RULE_PATTERN` / `compilePastedTheme` 与 `PastedThemeCompileResult`，`AddPastedThemeFailure` 扩 `import-rule`，`readList` 校验格式、`addPastedTheme` 收 `format` 参数且只对 `json` 读元数据；`src/shared/userThemeStyles.ts` 抽出 `toPastedCompiledSource`（`loadCompiledSource` 与 `applyBootUserThemeStyle` 两处调用点均改走它）；`src/shared/userSettings.ts` 加 `themePasteFormat` 偏好键（及其 `LEGACY_STORAGE_KEYS` 空键）；新增 `src/modules/settings/hooks/useThemePasteFormat.ts`；`src/modules/settings/UserThemesSection.tsx` 加模式开关（`role="radiogroup"`）＋ 信任确认面板 ＋ 按格式切换的占位符与 `cssNote`；两个 locale 各加 9 条 `userThemes.*`（`mode.{label,json,css,hint,cssNote}` / `trust.{title,body,confirm,cancel}` / `reason.import-rule`）并改写 `pasteLabel` / `pasteInvalid` / `description` 三条既有文案。测试：`userThemePastes` 12→18、`userThemeStyles` 25→28、`userThemesSection` 6→15；真引擎 spec `user-theme-paste.spec.ts` 1→2 项，`main.ts` 加 `pasteFormat` 选项。

**决策（11 条）**

1. **一个粘贴的格式是"条目自己的属性"，不是"这次应用调用的参数"**——本片第一处裁定。文件主题的格式在扩展名里、列举时就读到了；**粘贴没有文件名**，`PastedUserTheme.format` 是唯一还记得它是哪种格式的地方。因此 `compilePastedTheme(theme)` 按条目分派，且**故意用两次**：`addPastedTheme` 里用它决定"收不收这份内容"（粘贴是它唯一经过的闸门），`userThemeStyles` 里用它重新编译存储的文本（含启动期恢复）。若改成"应用时传格式"，从偏好镜像读回来的条目就无从知道该怎么编译。
2. **两种格式的逃逸面不同，所以闸门不同**：选项 A 的令牌走上 `compileUserThemeTokens`（白名单 ＋ 值形状，`unsafe-value` 整份拒绝）；选项 B 是**原样注入**，一份带 `@import` 的样式表会真的拉进服务端从未审过的规则。故粘贴侧另加 `IMPORT_RULE_PATTERN = /@import/i`——**与服务端 `theme-files.service.ts` 同一个模式**：同一条规则的两道闸门应当对"什么算这条规则"给出一致的答案。
3. **据此改判 §5.8 v5②**：那条写着"粘贴线走选项 A 的编译路径，产物是纯声明块，`@import` 在构造上进不来"。这在"粘贴线只收选项 A"时是对的；raw CSS 进来后不再成立，且粘贴**前面没有服务端**，这道闸门只能落在粘贴侧。见 §5.8 v6。
4. **旧条目的向后兼容不是猜测**：`readList` 读 `candidate.format === undefined ? 'json' : candidate.format`——一行没有 `format` 的条目是本 store 在"粘贴线只有一个格式"时写的，`json` 不是猜的、是它唯一可能的值。**未知**的格式按 `readEntry` 对未知文件格式的同一种严格处理：丢自己、不丢列表，因为"拿它没法编译"。
5. **`format` 默认 `'json'`，默认值写在签名里**：`addPastedTheme(content, format: PastedThemeFormat = 'json')`——这既是 §5.5 写明的默认，也是开关存在之前一个粘贴唯一可能的格式。
6. **css 粘贴不声明任何元数据**：`name` / `coverage` 来自选项 A 的 JSON 键（`readDeclaredMetadata`），所以 `addPastedTheme` 只在 `format === 'json'` 时调它；一个 css 粘贴以 id 为名展示，正如一个 `.css` **文件**由文件名命名——§5.8 v4 的"知道什么说什么"。选择器对它不画徽标。
7. **模式偏好是 `themePasteFormat: 'json' | 'css'`**：`UserPreferences` 里的**第三个**与主题相关的偏好键（前两个是 `themeId` 与 `userThemePastes`），同样带一个空的 legacy 键。经**模块私有**的 `useThemePasteFormat` 读取（不进共享偏好 hook）——它只有一个消费者。
8. **读者宽松是单向的**：`readStoredFormat` 只在字面是 `'css'` 时返回 `'css'`，**其余一切（含坏值）读作 `'json'`**——安全的那一种格式，正是这个 build 不认识某个值时该给的答案；反过来默认则会把一个坏偏好交到两种格式里更危险的那个手上。
9. **css 粘贴的选择器不必写出主题名，这是后果而非遗漏**：粘贴主题没有文件名，粘贴框无从告诉作者该写哪个 `[data-theme="…"]`；而这条规则只在**主题被选中时**才在文档里（选中即换表），所以 `:root` 与 `.dark` 直接可用——`:root` 能压过基色的 `:root`，靠的是**文档顺序**（`injectStyle` 追加到 `<head>`）。i18n 的 `mode.cssNote` 把这条写给作者看。
10. **css 粘贴的内容除了两条边界什么都不校验**（256KB ＋ `@import`）——这正是开关所警告的事：页面可能变得读不出、点不动，逃生通道是 §5.6 的强制通道（`?theme=default`）。
11. **提问不等于决定**：信任确认是**与存储格式分开的一份状态**（`confirmingCss`）——若没有它，偏好会在确认面板一出现时就被写下去，一次刷新便会静默套用用户根本没确认过的格式，正是 §5.5 警告的那个坑、只隔一次刷新。确认与取消都把开关拨回**当前**格式；切回 `json` 不是提问、立即生效。

**如实边界（3 条）**

1. **§5.10 的"用户主题对比度只警告不阻断"仍未实现**（承 2-C / 2-D / 2-E）：本片把原始 CSS 的**入口**做出来了，但校验器（选项 A 与 css 两条）都只管**形状**、不管可读性。改归 **2-G**——理由见切片表下的范围裁定（选项 A 的令牌 `var()` 可链，声明值的对比度在编译期算不出）。**（2-G 已结清：选项 A 那条分支自本片起附上 `warnings`，css 那条如实带空——样式表能自己写选择器，令牌级检查对它无话可说。见 §5.10 v2 决策 11。）**
2. **高级模式只到"能粘"，未到"好写"**：§5.5 推荐行写的"带语法高亮编辑器 ＋ 实时预览"两样都没做，粘贴框仍是纯 textarea。改归 **2-H**。
3. **css 粘贴不画 `coverage` 徽标**：它没有地方声明 `coverage`（§5.8 v4 的"知道什么说什么"），与一个不声明 `coverage` 的 `.css` 文件同形——**如实，不是漏画**。

**证据**

| 项 | 预期 | 实测 |
|---|---|---|
| 新增 / 补测单测 | — | `userThemePastes` 12→18（＋6：css 原件按 id 存储且 `compilePastedTheme` 是恒等 ／ 任意处的 `@import` 以 `import-rule` 拒绝 ／ 该闸门只属样式表格式——同一文本在选项 A 是 `unsafe-value` ／ 无格式的旧条目读作 `json` ／ 未知格式丢自己 ／ 形似 JSON 的 css 粘贴仍不声明元数据）；`userThemeStyles` 25→28（＋3：css 粘贴原样到达文档 ／ `@import` 闸门在应用时也跑 ／ css 选择由启动路径原样恢复）；`userThemesSection` 6→15（＋9：两种格式都提供 ／ 选项 A 被写入 ／ 差异被说明（含占位符与无 `cssNote`）／ 未识别存储格式按 A 打开 ／ 挂载后到达的偏好搬动开关 ／ 切到 css 先问且偏好仍未写 ／ 拒绝 ／ css 模式按该格式存储 ／ 已存 css 偏好打开时不再问 ／ 回 A 不是提问 ／ 已在 css 时再点 css 不问）＝ **＋18 项、文件数不变**（2-E 为 139 文件 / 1097 用例 → 本片 139 / 1115） |
| 真引擎 spec | 原始 CSS 粘贴经偏好镜像注入后**真的**压过基色（`:root` 无 `[data-theme]` 这条只有真引擎证得了） | 1 项 × chromium ＋ webkit ＝ **＋2** 全绿（`CSS_THEME = ':root { --background: 280 60% 40% }'` 断言解析为 `rgb(122, 41, 163)`；两个引擎都不向桩文件服务器要文件） |
| 变异 · `userThemePastes`（9 处） | 每条新行为都有测试管 | M1 `format` 不读存储值恒 `json` **1** ／ M2 删格式校验 **1** ／ M3 `@import` 闸门恒 false **1** ／ M4 模式收紧为 `/^@import/i` **1** ／ **M5 css 分支改走令牌编译器 1** ／ M6 元数据不按格式分派 **1** ／ **M7 `format` 默认改 `css` 3** ／ **M8 存储格式写死 `json` 4**（红面最广——按格式分派、元数据、占位符全塌） ／ M9 删大小上限检查 **1** |
| 变异 · `userThemeStyles`（2 处） | 粘贴线走新函数 | M10 `loadCompiledSource` 的粘贴分支退回旧路径 **2** ／ M11 启动恢复退回旧路径 **1** |
| 变异 · `useThemePasteFormat`（3 处） | 单向宽松与订阅 | M12 读者不再单向宽松（坏值原样返回）**1** ／ M13 不用 `useSyncExternalStore`（不订阅）**1** ／ **M14 设置时不写偏好 3** |
| 变异 · `UserThemesSection`（8 处） | 开关与确认 | M15 去掉"同格式直接返回" **1** ／ M16 切回 json 不再立即生效 **1** ／ **M17 切到 css 直接写偏好（跳过提问）3**——正是"提问 ≠ 决定"那条 ／ M18 确认时不写格式 **2** ／ M19 取消时写了格式（取消被当成确认）**1** ／ M20 占位符不随格式 **1** ／ M21 `cssNote` 恒显示 **1** ／ M22 提交时不传格式 **1** |
| 变异总计 | — | **22/22 RED、0 UNPROVEN**（无 NO-MATCH），其中 M17 恰 3 红、M8 恰 4 红，说明"确认才写"与"存储格式是条目属性"这两条都不是写在文档里而没被断言 |
| 产物核对（客户端） | 新代码进产物 | `themePasteFormat` ／ `import-rule` ／ `pastePlaceholder` 各命中 **1** 个 `dist/assets/*.js`；可见文案"原始 CSS" 1、"直接写 :root 与 .dark" 1 |
| 产物核对（服务端） | 本片不得出现在服务端 | `dist-server/` 里 `themePasteFormat` / `confirmingCss` / `useThemePasteFormat` 均 **0**；`IMPORT_RULE_PATTERN` 1（来自 2-A 自己，证明其闸门未被本片动过） |
| i18n 键集 | 两端同步 | `userThemes` 子树 zh-only **0** / en-only **0**（新增 9 键 ＋ 改写 3 键都在 en 与 zh-CN 各落一次） |
| 基线对照 | 服务端失败集不变 | **`git diff f8649b9d HEAD -- server/` = 0 行**、工作区 `server/` 亦 **0 处**——服务端树与 2-E **逐字节相同**，故红集不可能变（无需 stash A/B）。实跑 `npm test` 复核：**1017 项 / 995 通过 / 21 失败 / 1 跳过**，21 条全在已知的环境相关抖动区（Codex catalog ／ WorkBuddy ／ Claude 路径解析 ／ OpenCode ／ `agent.routes.test.ts` 等），与 2-A…2-E 记录同一区 |

**门槛**：`npm test` **1017 项、1 跳过、21 失败 / 995 通过**（全在已知抖动区，服务端零改动见上）；`typecheck`（前后端两个 project）与 `typecheck:theme-tokens` 均干净；`lint` **153 warnings / 0 error**（与 2-A…2-E 相同，无新增）；`test:client` **139 文件 / 1115 用例全过**（2-E 为 139 / 1097，差 **＋18 用例 / 文件数不变**，与三处新增逐位吻合）；`build` exit 0（客户端 chunk 与 `dist-server` 均重新产出）；浏览器套件 `theme-tokens` **84 项全过**（2-E 82，＋2 ＝ 新 spec 1 项 × 2 引擎）。

**与既有账的关系**：**本片在出厂状态下无视觉变更**——`themeId` 为空、粘贴列表为空时新路径都不执行；模式偏好缺省即 `json`，与开关存在前完全一致；`?theme=default` 只丢"选择"。基色 / 覆盖层 / 首帧 chrome / 阶段 0 迁移账 / B3 账均不变。**两处需要点明的语义新增**：① 粘贴框自本片起可收**原始 CSS**——一个此前会被令牌校验器以 `unsafe-value` 拒绝的内容（它既不是合法 JSON、也不是合法令牌表）现在被当作样式表接受，这是本片的目的；② 偏好接口自此多承载 **`themePasteFormat`** 这个可跨设备同步的键（值只有 `json` / `css` 两种），与 `themeId` / `userThemePastes` 同在主题这组偏好里。**一处交叉引用**：切片表下方新增 2-G / 2-H 两行与它们的范围裁定，是 2-E"切片边界按实测重划"之后同一类操作的第二次——这次拆的是**能力**（粘贴线可独立交付）与**控件增强 / 另一条格式的校验**。

#### 2-G 实施记录（2026-09-26，`c1b75331`）

**范围**：新增 `src/shared/userThemeContrast.ts`（`CONTRAST_PAIRS` 单一来源 ＋ `BASE_PAIR_COLORS` 基色表 ＋ HSL→8 位通道→WCAG 比值的纯函数 ＋ `findContrastWarnings`）；`src/shared/userThemeTokens.ts` 编译时把"字面三元组 / `var()` 引用"两种形状归一化后交给它，`ok` 结果多一个 `warnings`；`src/shared/userThemePastes.ts` 与 `src/shared/userThemeStyles.ts` 的 `ok` 分支把 `warnings` 透传下去，`applyUserThemeStyle` 在注入前调 `warnContrast` 走 `console.warn`；`src/modules/settings/UserThemesSection.tsx` 在粘贴成功后展示警告块（`role="status"`、复用既有令牌类）；`tests/theme-tokens/contrast.spec.ts` 的配对表改为引用 `CONTRAST_PAIRS` 并新增一道"基色表＝浏览器"的护卫；`.oxlintrc.json` 的 `frontend-shared-file` 登记新文件；两个 locale 各加 3 键 `userThemes.contrastTitle` / `contrastWarning` / `contrastAppearance.{light,dark}`。测试：新增 `userThemeContrast.test.ts`（9 项）；`userThemeTokens` 18→22、`userThemePastes` 18→19、`userThemeStyles` 28→30（新增断言、不新增用例）、`userThemesSection` 15→19。

**决策（11 条）**

1. **未声明的那一侧以"出厂基色"为准**——本片唯一一处契约级分叉，开工时先量化三条候选并停下拍板（②，理由与被否的①③见 §5.10 v2）。要点：① 对整个 `coverage: accent` 类失明（含本文档 §5.5 自己的示例），③ 只能在被应用之后说话且 `system` 主题只查一半；② 是"校验器附带"（编译期、纯函数）又能抓到记录里那类失败，且它依赖的基色不是新发明的数据（`token-baseline.json` 是同源的签入副本）。
2. **配对表成为单一来源**：`CONTRAST_PAIRS` 由 `contrast.spec.ts`（内置主题）与 `userThemeContrast`（用户主题）共同消费——**一处定义、两处消费**，两处不可能对"哪些配对、各是什么下限"给出两个答案。
3. **基色表只放被配对点名的 7 个令牌**，不放整份色盘：它要回答的是"未声明的那一侧是什么"，而只有配对里的令牌会被问到。多放会变成第二份需要同步的色板。
4. **表与算法由同一条测试钉住**：`contrast.spec.ts` 新增的那道护卫逐字断言 `BASE_PAIR_COLORS` 等于样式表解析值，**并**断言同一对用表算出的比值与浏览器画出的比值相差 < 0.01。两半都必要——表对了、算法不对，警告照样会与守卫打架。
5. **比值按 8 位通道取整后算**：`--muted-foreground` 落 `--background` 取整 4.62、不取整 4.59，而浏览器断言量的是 4.62。一条与守卫不一致的警告比没有警告更糟——**警告是会被照做的**。
6. **"未触及的配对也照判"，而"未触及就跳过"被否**：两侧都落回基色的配对，其结论由基色守卫保证（实测基色 12 个配对全过、最紧 4.624），故"跳过"与"照判"**不可观测**；既然不可观测，就不留一条需要读者相信的例外——留下一句"任何返回的警告都是关于作者写过的东西"即可，而这句由基色守卫支撑。
7. **沉默不是通过**：只有三种情形不判——一侧的值只有样式表能解析（引用跑到文件外）、引用成环、值带 alpha（读作三元组会拿一个页面从未画过的颜色去判）。三处各自是真边界，且都**不**产出警告（不是"通过"）。
8. **形状在编译器读、不在对比度模块读**：`userThemeTokens` 是值规则所在处，只有它能判断某个合法值是不是"一个三元组"或"一个 `var()`"；对比度模块只接受这两种形状，其余（`--radius` 的长度、`--editor-*` 的表达式、`--nav-*` 的 alpha 形式）**根本不被提供**。
9. **非阻断落成"两个字段"而不是"一个字段的两种取值"**：`ignored` 是"这条没发生"（值被丢了），`warnings` 是"发生了、你可能不想要"（样式表照出）。合成一个字段会让"主题被拒绝"和"主题被接受但难读"在下游无法分辨。
10. **通道沿用既有分法**：粘贴时显示在设置页（与失败文案同一位置，`role="status"` 而非 `alert`——它没失败），**文件**主题与"应用时"走 `console.warn`。设置页列文件**不读内容**（2-D 特意如此），故控制台是文件作者唯一的通道。
11. **css 粘贴 / `.css` 文件 / 无内嵌键的 `.tmTheme` 一律带空 `warnings`**：它们不是令牌表——一份样式表可以自己写选择器，令牌级的检查对它无话可说；`.tmTheme` 说的是语法 / 编辑器 / 终端槽位，那些都不是 §5.10 配对里的令牌。**（2-I 修订：带 `cloudcli` 内嵌键的 `.tmTheme` 自此**有**令牌表——键内的选项 A 令牌照判，见 §5.5 v7 第五条。）**

**如实边界（4 条）**

1. **文件主题的可读性警告只到控制台，不进设置页**：要让文件主题的警告也显示在界面上，得让设置页逐个读主题文件内容——那是 2-D 特意没做的新能力（"文件区只读"）。归后续片，不阻塞 2-H。**（2-L 已结清——但结清的方式证明这条归因多推了一步：设置页"列文件"仍不读内容，警告走的是应用时编译本来就产出的报告，随样式状态进设置页，见 §5.10 v3。）**
2. **只判 `CONTRAST_PAIRS` 那 6 对**，不是穷举的文字 × 表面矩阵（承 §5.11 v8 的同一条边界）。
3. **两处"不判"是射程而非遗漏**：引用跑到文件外的配对（如 `--foreground: var(--palette-sand-950)`）与带 alpha 的值，都**没有**被拿基色顶替去判——那会是一个关于页面从未画过的颜色的结论。
4. **本片顺带修掉测试工具的一处坑，非行为变更**：`assert.equal(<jsdom 元素>, null)` 在**失败**时会让 node 去描述那个 DOM 节点，深度足够把 vitest worker 打死（表现为 `Channel closed`、`passed=0` 被误读成"绿"）。`userThemesSection.test.tsx` 里四处此类断言改成 `assert.ok(<元素> === null, …)`，失败时正常报红。这条是变异探针查出来的——**探针自己的运行环境也属于要核实的对象**。

**证据**

| 项 | 预期 | 实测 |
|---|---|---|
| 新增 / 补测单测 | — | 新增 `userThemeContrast` **9 项**（基色自清下限 ／ 文档示例恰 1 条且比值 3.49 ／ 焦点环走自己的 3:1 ／ 单外观作用域只判那一套 ／ 引用沿文件内链解析 ／ 出文件的引用不猜 ／ 成环不挂 ／ 基色表对每个被点名的令牌都有答案 ／ 比值是浏览器画的那个 4.62）；`userThemeTokens` 18→22（＋4：编译成功但不可读带警告且仍出样式表 ／ alpha 型令牌不被当作三元组 ／ 长度与编辑器表达式同样不被提供 ／ **引用以引用的形状交出**）；`userThemePastes` 18→19（＋1：`ok` 带上警告）；`userThemeStyles` 28→30（＋2 断言：警告走 `console.warn` 且点名配对 / 比值 / 下限；**清白的主题不产生 `WCAG AA` 那一行**）；`userThemesSection` 15→19（＋4：警告以 `role="status"` 呈现且不是 `alert` ／ 无事可报时不渲染该块 ／ 失败的粘贴清掉上一条警告 ／ **深色作用域的警告指名深色**）＝ **＋20 项、＋1 文件**（2-F1 为 139 文件 / 1115 用例 → 本片 140 / 1135） |
| 真引擎 spec | 基色表与算法都要与浏览器一致 | `contrast.spec.ts` 配对表改为引用 `CONTRAST_PAIRS`，新增 1 项 × chromium ＋ webkit ＝ **＋2**（84 → **86** 全过） |
| 变异 · `userThemeContrast`（11 处） | 数学、解析、作用域、跳过规则都有测试管 | G1 作用域恒 `light` **1** ／ G2 去掉基色回落 **3** ／ G3 字面值解析为 null **3** ／ G4 关掉成环守卫 **1** ／ G5 不取整 **2** ／ **G6 比较方向反向 7**（红面最广）／ G7 焦点环用 4.5 下限 **3** ／ G8 去掉"数字不足三个"守卫 **1** ／ G9 亮度系数写错 **4** ／ **G10 基色表改一个值 6** ／ G24 引用改为在基色里查 **2** |
| 变异 · 编译链（4 处） | 归一化与透传 | G11 把任何合法值都当三元组交出 **1** ／ G12 不识别引用 **1** ／ **G13 `warnings` 恒空 6**（牵连 tokens / pastes / 设置页三处）／ G14 `addPastedTheme` 不透传 **1** |
| 变异 · 应用与呈现（7 处） | 通道与界面 | G15 不调 `warnContrast` **2** ／ G16 去掉"无警告即返回" **1**（清白的主题开始刷屏）／ G17 不把警告交给界面 **3** ／ G18 警告块恒渲染 **2** ／ G19 失败的粘贴不清上一条警告 **1** ／ G20 比值不取两位小数 **1** ／ G21 外观标签写死浅色 **1** |
| 变异 · 真引擎护栏（2 处） | 守卫本身要能被证伪 | G22 基色表改一个值 → 浏览器套件 **2 红** ／ G23 不取整 → **2 红**（两处都是"表/算法与浏览器不一致"这条断言直接报出） |
| 变异总计 | — | **24/24 RED、0 UNPROVEN、0 NO-MATCH**（G6 恰 7 红＝比较方向一错则全盘翻转，G13 恰 6 红＝警告若恒空则三个消费者同时塌） |
| 产物核对（客户端） | 新代码进产物 | `WCAG AA` ／ `contrastAppearance` ／ `contrastWarning` ／ 基色三元组 `44 22% 96%` 与 `221.2 83.2% 53.3%` 各命中 **1** 个 `dist/assets/*.js` |
| 产物核对（服务端） | 本片不得出现在服务端 | `dist-server/` 里 `WCAG AA` / `contrastAppearance` / `BASE_PAIR_COLORS` / `findContrastWarnings` / `userThemeContrast` 均 **0**；服务端自己的 `@import` 闸门测试产物业在，证明未被动到 |
| i18n 键集 | 两端同步 | `userThemes` 子树 zh-only **0** / en-only **0**（**38 = 38**，新增 3 键在两侧各落一次） |
| 基线对照 | 服务端失败集不变 | **`git diff 9613952e HEAD -- server/` = 0 行**、工作区 `server/` 亦 **0 处**——服务端树与 2-F1 **逐字节相同**，故红集不可能变（无需 stash A/B）。实跑 `npm test` 复核：**1017 项 / 996 通过 / 20 失败 / 1 跳过**，全在已知的环境相关抖动带（20~21）内 |

**门槛**：`npm test` **1017 项、1 跳过、20 失败 / 996 通过**（服务端零改动见上）；`typecheck`（前后端两个 project）与 `typecheck:theme-tokens` 均干净；`lint` **153 warnings / 0 error**（与 2-A…2-F1 相同）；`test:client` **140 文件 / 1135 用例全过**（2-F1 为 139 / 1115，差 **＋20 用例 / ＋1 文件**，与五处新增逐位吻合）；`build` exit 0；浏览器套件 `theme-tokens` **86 项全过**（2-F1 84，＋2 ＝ 新护卫 1 项 × 2 引擎）。

**与既有账的关系**：**本片在出厂状态下无视觉变更**——警告块只在"刚粘贴了一份会告警的主题"时渲染，控制台只在真有配对不达标时说话（基色自清、两个内置覆盖层由 1-H 断言、用户主题列表为空时都不触发）。1-H 那 6 个配对断言自本片起读的是 `CONTRAST_PAIRS`，**断言内容不变**；基色 / 覆盖层 / 首帧 chrome / B3 账均不变。**一处需要点明的语义新增**：用户主题的"合法但不可读"从本片起**可被观测**（此前只有"形状不对"会被报出来）——这是 §5.10 那句话的兑现，不是行为收紧：主题照旧生效、什么都不阻断。**一处记账**：`.oxlintrc.json` 的 `frontend-shared-file` 名单多一行（新增 `src/shared/` 文件必须登记，否则每个 import 它的文件各报一条 `boundaries(no-unknown)` **error**，本片开工时正是 5 条）。

---

#### 2-H 实施记录（2026-09-26，`85ba658b`）

**范围**：新增 `src/modules/settings/ThemeCssEditor.tsx`（CSS 编辑表面：CodeMirror 6 ＋ `@codemirror/lang-css`，高亮调色板经 `SYNTAX_TOKEN_MAP` 取 `var()`，chrome 用 `EditorView.theme`）；新增 `src/modules/settings/hooks/useThemeCssPreview.ts`（防抖 300ms 的预览 hook，结论带"所属草稿"标记）；`src/shared/userThemeStyles.ts` 新增第二个注入者 `previewUserThemeStyle(css | null)`（元素属性 `data-cloudcli-theme-preview`，与已应用主题的 `data-cloudcli-user-theme` **分开**），`injectStyle` 在每次移除陈旧已应用元素后**把预览重新挂回 `<head>` 末尾**，`clearAppliedUserThemeStyle` 一并清预览；`src/shared/userThemePastes.ts` 把 256KB 尺寸闸门从 `addPastedTheme` 移进 `compilePastedTheme`；`src/modules/settings/UserThemesSection.tsx` 高级模式由纯 `textarea` 换成 `ThemeCssEditor` 并在其下渲染预览状态行；两个 locale 各加 2 键 `userThemes.previewing` / `previewUnavailable`。测试：新增 `useThemeCssPreview.test.tsx`（9 项）；`userThemeStyles` 30→35、`userThemePastes` 19→20、`userThemesSection` 19→23；`tests/theme-tokens/` 的 fixture 桥接 `previewUserThemeStyle` 并新增 1 条真引擎 spec。

**决策（8 条）**

1. **预览渲染在真实界面上**——本片开工时唯一一处契约级分叉。§5.5 的推荐行只说"带语法高亮编辑器 ＋ 实时预览"，**没写预览画在哪**，而它直接决定用户可见语义与安全模型（半写完的 CSS 草稿要不要影响真实界面）。三候选：① 应用在真实界面（防抖注入为文档级覆盖层，不落库，关闭 / 取消时收回，保留 `?theme=default` 逃生门）；② 隔离的预览窗格；③ 不预览、只做高亮。选 ①，理由：它与"原始 CSS 原样注入"是**同一件已接受的设定**（§5.5 v5 第二条），只是提前到编辑时，并且**多一条逃生路径**（刷新即消）；② 要另建一套渲染宿主、与"看到的就是提交后的样子"相左；③ 与推荐行明列的"实时预览"不符。
2. **只在高级模式（css），且只在草稿非空时预览**：推荐行把两件事都写在对"切到 B（原始 CSS）"的括号里，故选项 A 的令牌 JSON 仍是纯 `textarea`、不预览。纯空白草稿同样不预览——空白不是样式表，把它放上页面只会白白清掉已选主题。
3. **防抖 300ms，且"上一次的结论不评价这一份草稿"**：逐字编译并重绘整页会让输入变重，半写完的规则也很少是作者想看的；但防抖期间**不能**拿上一份的结论（尤其"无法预览：…"）去描述当前这一份。故每个结论带上它所属的草稿，不一致时报 `idle`；已被接受的草稿在下一份到来前**保持显示**（不在暂停的间隙闪回旧主题）。
4. **两个注入者共处一个文档，顺序即语义**：预览与已应用主题都是 `<style>`、同权重，靠**文档顺序**定胜负（同 §5.2 的覆盖层判据）。故预览永远在 `<head>` 末尾，且**每次 apply 之后重新挂回末尾**——否则一次 apply 就把预览埋在下面，预览会"时灵时不灵"。两元素用**不同属性**标记，各自的移除不会带走另一个。这条顺序约定由真引擎 spec 守着（jsdom 不做级联）。
5. **256KB 闸门移进 `compilePastedTheme`**：预览走的就是提交时用的同一个编译函数，故尺寸上限也必须在同一处——若它仍留在 `addPastedTheme`，预览会演示一份提交时会被拒的文本（显示一个不可能存在的主题）。`IMPORT_RULE_PATTERN` 同源。
6. **强制恢复通道一并清预览**：`?theme=default` 是"合法但有害"的逃生门，而"把页面弄得不可读的草稿"正是它必须能逃开的东西——故它清掉的是正在显示的一切，不只是已应用的。
7. **编辑器是薄的一层，共享调色板而非复用组件**：不复用 code-editor 模块的文件编辑表面（它带路径、脏标记、保存这些**文档**概念，与设置框里的一个草稿无关），另建只认 CSS 的表面；两者共享的是**调色板**（经 `SYNTAX_TOKEN_MAP`），以免设置框漂成第二套命名。色值全是 `var()`，随主题重绘而无需重建扩展（同 §5.6 v10 的性质）。
8. **不登记的例外**：新增 `src/modules/settings/*` 文件**不需要** `.oxlintrc.json` 登记（那份名单是 `frontend-shared-file`，只针对 `src/shared/*.ts`）；模块内新文件由 `boundaries/include` 的 `src/modules/**/*.tsx` glob 自动纳入。故本片无 i18n 之外的新登记项。

**如实边界（4 条）**

1. **预览不是保存**：它不落库、不建缓存，只活在文档里——刷新即消。这是设计（逃生门之一），不是缺陷；也正因此它比"先提交再改回来"更安全。
2. **选项 A 不预览**是射程而非遗漏：推荐行把编辑器与预览都写在"切到 B"的括号里，令牌 JSON 的实时呈现归后续（若要做，是另一个可读性可视化的问题，与 CSS 编译无关）。
3. **预览只在设置页的高级模式里存在**：它不接管"文件主题"线，也不在设置页之外可用——文件主题仍是"改文件 → 刷新"，其内容不在界面里被编辑。
4. **"顺序即语义"这条不能靠 jsdom 证**：jsdom 不做级联，故"草稿压过它正在对之起草的主题"只在真引擎 spec 里读颜色证明；jsdom 侧只留一条 `compareDocumentPosition` 代理断言（预览在已应用主题之后）。

**证据**

| 项 | 预期 | 实测 |
|---|---|---|
| 新增 / 补测单测 | — | 新增 `useThemeCssPreview` **9 项**（草稿成为文档里的样式表 ／ 打字暂停前不上页面 ／ 后一份替换而非追加 ／ 被拒的草稿说话**且把上一份带走** ／ 不拿上一份草稿的结论评价这一份 ／ 选项 A 不预览 ／ 清空即收回 ／ 纯空白不预览 ／ 卸载即移除）；`userThemeStyles` 30→35（＋5：预览进文档但不成为已应用主题 ／ **预览停在已应用样式表之后**（`compareDocumentPosition` ／ `DOCUMENT_POSITION_FOLLOWING`）／ 后一份预览替换前一份 ／ 移除预览不动已应用主题 ／ 强制恢复通道把预览一并清掉）；`userThemePastes` 19→20（＋1：尺寸闸门在编译步，预览不会演示一份提交时会被拒的文本）；`userThemesSection` 19→23（＋4：高级模式的草稿被放上页面且报为预览 ／ 无法预览时说出口**且清掉上一份** ／ 选项 A 不预览也不提预览 ／ **高级模式改的是编辑器里的草稿而非纯文本框**）＝ **＋19 项、＋1 文件**（2-G 为 140 文件 / 1135 用例 → 本片 141 / 1154，与逐文件实测 35 / 20 / 23 / 9 逐位吻合） |
| 真引擎 spec | "草稿压过它正在对之起草的主题"要与真浏览器一致 | `tests/theme-tokens/user-theme-style.spec.ts` 新增 1 项 × chromium ＋ webkit ＝ **＋2**（86 → **88** 全过）；读的是真引擎里画出的颜色、`previewCount`、`isLast`，清掉后回落 `FIXTURE_COLOR` |
| 变异 · `userThemeStyles`（6 处） | 第二个注入者的生命周期与顺序 | A1–A6 全 RED（预览元素属性混用 / 不重新挂末尾 / 清已应用时不带预览 / 清除时不带预览 / `null` 不删 ／ 加而不替换——最广的一处牵连两文件） |
| 变异 · `useThemeCssPreview`（7 处） | 防抖、结论归属、射程 | B1–B7 全 RED（去防抖 / 结论不带草稿标记 / 恒定 idle / 只对 css 判据放宽 / 空白也预览 / 失败不动上一份 / 卸载不清） |
| 变异 · 编译与界面（5 处） | 闸门位置与呈现 | C1（尺寸闸门挪回 `addPastedTheme`）RED ／ D2（编辑器调色板不经 `SYNTAX_TOKEN_MAP`）RED ／ E1–E3 RED（高级模式仍用纯文本框 / 不渲染预览状态行 / 失败不清上一份） |
| 变异总计 | — | **18/18 RED、0 UNPROVEN、0 NO-MATCH**（B2 与 E1 起初 GREEN，查出的都是**探针自己的前提**不可表达：B2 的夹具先喂坏草稿、此前并无"上一份"可留；E1 的 CodeMirror 桩渲染成裸 `textarea`、与选项 A 的文本框无从分辨——两处都改成能表达该前提的夹具 / 加 `data-testid` 后转 RED，见 §8 v10） |
| 产物核对（客户端） | 新代码进产物 | `data-cloudcli-theme-preview` ／ `paste-preview` ／ `userThemes.previewUnavailable` ／ `userThemes.previewing` 各命中 **1** 个 `dist/assets/*.js`（4/4） |
| 产物核对（服务端） | 本片不得出现在服务端 | `dist-server/` 里上述 4 个标记均 **0** |
| i18n 键集 | 两端同步 | `userThemes` 子树 zh-only **0** / en-only **0**（**40 = 40**，新增 2 键在两侧各落一次） |
| 基线对照 | 服务端失败集不变 | **`git diff 3e4f0582 HEAD -- server/` = 0 行**、工作区 `server/` 亦 **0 处**——服务端树与 2-G **逐字节相同**，故红集不可能变（无需 stash A/B）。实跑 `npm test` 复核：**1017 项 / 996 通过 / 20 失败 / 1 跳过**，全在已知的环境相关抖动带（20~21）内 |

**门槛**：`npm test` **1017 项、1 跳过、20 失败 / 996 通过**（服务端零改动见上）；`typecheck`（前后端两个 project）与 `typecheck:theme-tokens` 均干净；`lint` **153 warnings / 0 error**（与 2-A…2-G 相同；本片一度因 hook 在 effect 里同步 `setState` 涨到 154，改写为渲染期派生后回落——**不抑制规则**）；`test:client` **141 文件 / 1154 用例全过**（2-G 为 140 / 1135，差 **＋19 用例 / ＋1 文件**，与逐文件实测逐位吻合）；`build` exit 0；浏览器套件 `theme-tokens` **88 项全过**（2-G 86，＋2 ＝ 新 spec 1 项 × 2 引擎）。

**与既有账的关系**：**本片在出厂状态下无视觉变更**——设置页高级模式未打开时编辑框与预览均不出现；令牌 JSON（选项 A）的框未动；文件主题线未动；基色 / 覆盖层 / 首帧 chrome / B2 →B3 账均不变。**一处需要点明的结构性约定**：`src/shared/userThemeStyles.ts` 自此拥有**两个**注入元素，且"预览在已应用主题之后"由真引擎断言守着——这是 §5.2 覆盖层判据的又一次应用（**顺序即语义**），不是新的模型问题。**一处提前落地的安全相关移动**：256KB 尺寸闸门从"加"移到"编译"，使预览与提交由同一处决定（决策 5）——这是**收紧而非放宽**（预览从此看不到提交会被拒的文本）。**一处如实欠账**：预览只在设置页可见，文件主题作者仍无界面内的编辑 / 预览，与 2-G 的"文件主题警告只到控制台"同源（设置页列文件不读内容，2-D 特意如此）。

#### 2-I 实施记录（2026-09-26，`8b182f05`）

**范围**：§5.5 v4 记为待定的那个可选 `cloudcli` 内嵌扩展键——`.tmTheme` 补足主 UI 的唯一可行通道（"同名 `.css`" 已被 2-E 证伪）。随带结清两笔挂在它名下的账：coverage 徽标语义、§5.10 对比度警告的 `.tmTheme` 分支。

**决策（8 条，全记录于 §5.5 v7）**：

1. **键的形状**：plist 顶层 `<key>cloudcli</key><dict>`，内含 `tokens` 与可选 `appearance`——**逐字镜像选项 A 的 `{ tokens, appearance }`**，只是换 plist 语法写。不发明第二份契约。
2. **由选项 A 编译器亲自编译**：把 dict 以 JSON 交回 `compileUserThemeTokens`——白名单、值形状、`unsafe-value`、对比度警告**一份实现**，plist 不可能同 `.json` 漂移。被否的替代（抽出共用的逐令牌循环）留两个调用点各写块拼装，能漂。
3. **内嵌块排在 TextMate 半块之后**：同权重靠文档顺序定胜负（§5.2 老规矩），为本 app 写的键是更刻意的话，与 TextMate 全局色撞令牌时内嵌块赢。
4. **块被拒不牵连文件**：编译器裁决只及于交给它的载荷——`unsafe-value` 丢块并点名，TextMate 半边照常成立；`nothing-usable` 判据放宽为"两块皆空"。
5. **上报一律带 `cloudcli.` 前缀**：控制台行不能与 TextMate 半边的丢弃混读。
6. **coverage 由作者在键内自述、服务端窄式读取**（第一处 `<key>coverage</key>` 后随 `<string>`，仍只认 `accent` / `full`）——与 `.json` 同一信任模型：徽标转述作者的话、不校验工作量。plist 的 `name` 仍不读（另一笔账，不在本片）。**（2-K 已结清：`name` 读出，coverage 射程收窄到键内，见 §5.8 v7。）**
7. **warnings 随内嵌令牌生效**：`TmThemeCompileResult` 带 `warnings`，与 `.json` 走同一条 `warnContrast` 通道；§5.10 v2 决策 11 相应修订（"一律带空"只对无内嵌键的文件成立）。
8. **键内未知名字不理会**（含未来键的向前兼容），与 `.json` 顶层未知键同待遇。

**如实边界（3 条）**：

1. **`.tmTheme` 的显示名仍取文件名**：plist 自带的 `name` 服务端照旧不读——那与内嵌键无关，是另一笔可做未做的账。**（2-K 已结清，见 §5.8 v7。）**
2. **coverage 的窄式读取不辨嵌套**：正则不解析 plist 结构，作者若把 coverage 放在键外某处也会被读到——第一处命中即取，与"自述"的信任模型一致，不值得为此上 plist 解析器。**（2-K 已收窄：深度感知扫描把 coverage 的读取收进 `cloudcli` dict，见 §5.8 v7。）**
3. **粘贴线仍不收 `tmTheme` 格式**：`PastedThemeFormat` 仍只有 `json` / `css`。粘贴内容没有文件名，格式要靠开关选；`tmTheme` 粘贴是一个真实但无人要求的能力，不顺手加。

**证据**：

| 项 | 值 |
|---|---|
| 内嵌键→第二块、排后 | `tmTheme.test.ts`："an embedded cloudcli key compiles into a second block, placed after the TextMate half" |
| 撞令牌时内嵌块赢 | 同文件 "an embedded token that meets a TextMate global wins" |
| 块拒不牵连文件 ＋ `nothing-usable` 放宽 | "an unsafe embedded value refuses the whole embedded block"；"a file whose only colours are the embedded key's still compiles" |
| 前缀 | "a token the whitelist refuses is dropped with the cloudcli prefix" |
| appearance 作用域 ＋ 回落 | "an embedded appearance scope scopes the block, and an unknown one is reported" |
| 对比度警告 | 编译器层＋apply 层各一（3.49:1，§5.5 自己的例子） |
| 服务端 coverage | `theme-files.service.test.ts`："a .tmTheme may claim a coverage through its cloudcli key"（full / accent / 无 / 未知值四态） |

**门槛**：`typecheck`（client + server + theme-tokens）0；`lint` **153 warnings / 0 errors**（986 文件，无新增）；`test:client` **141 文件 / 1165 用例全过**（2-H 141/1154 → ＋11：`tmTheme` 16→26、`userThemeStyles` 35→36，逐文件 stash A/B 51→62 逐位吻合）；`npm test` **1018 / 997 通过 / 20 失败 / 1 跳过**——**本片动了 `server/`（+1 服务端测试），"树同跳 A/B"不可用，红集名字集做了 stash A/B：基线 20 条与当前 20 条逐字节相同**；`theme-tokens` 88 全过（未变）；`build` exit 0；变异 **11/11 RED、0 NO-MATCH、0 UNPROVEN**（A1 键被忽略 / A2 块序颠倒 / A3 前缀丢失 / A4 warnings 清空 / A5 非字符串放行 / A6 appearance 丢失 / A7 nothing-usable 判据回退 / A8 丢报告 / B1 通道硬编码空 / C1 服务端不读 / C2 未知值照画徽标）。

**与既有账的关系**：**本片在出厂状态下无视觉变更**——`~/.cloudcli/themes/` 为空、无文件带 `cloudcli` 键时新路径都不执行；基色 / 覆盖层 / 首帧 chrome / 阶段 0 迁移账 / B3 账均不变。**一处如实修订**：§5.10 v2 决策 11 的"`.tmTheme` 一律带空 warnings"被本片收窄（见决策 7），该句在新前提下不再对全量成立——这不是改判 2-G，而是它的前提（`.tmTheme` 无令牌表）被新能力取代。**两笔账就此结清**：§5.5 v4 的"唯一还没做的补足途径"与 §8 的"`cloudcli` 键待定"；**余下待定项只剩两笔**：§5.12 的 ">10 lane 参数化回退"（唯一待拍板）、文件主题可读性警告只到控制台（2-G 边界 1）。

#### 2-J 实施记录（2026-09-26）

**范围**：§5.12 的第二条——>10 lane 的参数化回退（**本线最后一处待拍板项**；阶段 2 切片表 2-A..2-I 实施完毕后由用户点名开工，那次有意的视觉变更随开工一并拍板）。

**决策（6 条，全记录于 §5.12 v3）**：

1. **前 10 条 lane 逐位不变**：显式令牌路径（`hsl(var(--graph-lane-N))` 与 tint 的 alpha 拼写）原样保留；回退只在 lane ≥ 10（0 基索引，即第 11 条起）生效，由 `lane < GRAPH_LANE_COUNT` 显式比较判定，取代 `lane % GRAPH_LANE_COUNT` 回绕。
2. **公式照 §5.12 原文**：`hsl(calc(base + step × (N-1)) 70% 55%)`，N 为 1 基 lane 号——JS 侧 0 基索引下即 `step × lane`；S / L 固定 `70% / 55%` 不参数化，原文只授了两个参数。
3. **参数放 `:root` 两个自定义属性、JS 只引用 `var()`**：主题覆盖两个参数即可整图调色，不依赖 `@property`（照原文"JS 侧计算最稳妥"）。
4. **默认值 `315.3` / `95.1` 由搜索选出**：目标函数 min(与出厂 10 色的最近距离, 回退 lane 彼此最近距离) 在 14 条回退 lane 上最大化（8.1° / 20.4°，已近数学上限）；"step=137 黄金角"的直觉对这套出厂色相最近只有 3°，被否。
5. **`laneTint` 同形带回退分支**，alpha 沿用 `calc(34 / 255)`，与令牌板同一拼写。
6. **`laneToken` 返回 `null` 表示"超出令牌板"**，两个导出各自分派——不在 `laneColor` 里藏第二次判断。

**如实边界（2 条）**：

1. **这是一处有意的视觉变更**：活跃分支 >10 的仓库里 lane 11+ 的颜色与 2-J 前不同（不再是 lane 1..10 的重复）；≤10 lane 的仓库逐位不变，`graph-lanes.spec.ts` 原 3 条用例原样绿。
2. **回退只保证色相距离**：S / L 固定 `70% / 55%`，与部分出厂 lane 的饱和 / 明度差异是额外的视觉区分；未做感知均匀性调优——参数就是主题的逃逸门。

**证据**：

| 项 | 值 |
|---|---|
| 令牌板形状不变 | `commitGraph.test.ts` "lanes within the token board resolve through the explicit tokens" |
| 回退表达式形状 ＋ 不复用令牌 | 同文件 "lanes past the token board rotate hue instead of wrapping onto lane 1" |
| 公式真引擎解析 ＋ 不撞色 | `graph-lanes.spec.ts` "lanes past the token board rotate hue and never repeat a token lane"（calc 结果与纯数字 reference 在 chromium / webkit 逐字节同色；不撞 10 条令牌 lane；彼此互异；tint alpha 同） |
| 参数可覆盖且回原 | "the hue parameters retune the fallback lanes and leave the token board alone"（改 `step` → 变色；移除 → 回原；令牌 lane 不动） |
| 参数默认值逐字钉住 | `token-baseline.json` 收入两参数（＋4 行 ＝ 2 令牌 × 2 外观） |

**门槛**：`typecheck`（client + theme-tokens）0；`lint` **153 warnings / 0 errors**（986 文件，无新增）；`test:client` **141 文件 / 1167 用例全过**（2-I 141/1165 → ＋2：`commitGraph` 5→7）；`npm test` **1018 / 997 通过 / 20 失败 / 1 跳过**——服务端树与 2-I 逐字节相同（`git diff 8b182f05 HEAD -- server/` ＝ 0 行），按纪律跳过 A/B；`theme-tokens` **90 全过**（88 → ＋2 新用例 × 2 引擎；基线 ＋4 行经"先不刷跑出恰 4 条未覆盖、且值漂移 0"反证只新增）；`build` exit 0；变异 **8/8 RED、0 NO-MATCH、0 UNPROVEN**（M1 边界改 ≤ / M2 乘数偏移 / M3 改 L / M4 tint 丢 alpha / M5 参数名拼错 / M6 复活回绕 / M7 step 默认值 / M8 base 默认值——M7 / M8 由浏览器套件与基线接住，其余由单测接住）。

**与既有账的关系**：§5.12 两条至此全部落地，该节状态从"待拍板"清空，**§8 的待拍板清单为空**。0-F1 的"零变化"承诺在 ≤10 lane 域内仍然成立；>10 lane 域的变更按本线规矩单独记账（§7 风险表同步）。**主题线余下只剩两笔无人要求的可做未做账**：文件主题可读性警告只到控制台（2-G 边界 1）、`.tmTheme` 的 plist `name` 读取（2-I 边界 1）——都不阻塞任何事。

#### 2-K 实施记录（2026-09-26）

**范围**：2-I 边界 1 的收账——`.tmTheme` 的 plist 顶层 `name` 服务端读取，选择器显示名不再回落文件名。阶段 2 切片表之外的一笔清账（用户在主题线清账后回"继续"，两笔可做未做账中取此片：它小、自洽、不与既有拍板冲突；另一笔要推翻 2-D"设置页列文件不读内容"的特意边界，属设计级重开，维持不做）。

**决策（3 条，全记录于 §5.8 v7）**：

1. **一次深度感知的窄扫描替代两处正则**：`readTmThemeCoverage` 改为 `readTmThemeDeclaredMetadata`，沿 `<dict>/<array>/<key>/<string>` 四种标签记 dict/array 深度——`name` 只在深度一读、`coverage` 只在 `cloudcli` dict（深度二、scope 锁定）内读。不引 plist 解析器：两种事实各一个槽位，深度追踪就是全部所需。
2. **`name` 不能用裸子串匹配的原因是嵌套同名键**：TextMate 文件合法地携带嵌套 `name`（`shellVariables` 条目是一个），"第一处命中即取"会捡错——这与 coverage 不同，`coverage` 是本 app 发明的键。深度门槛顺带把 coverage 的读取射程从"文件里第一处"收窄到"键内"，与"键内自述"的语义对齐（2-I 边界 2 一并结清）。
3. **信任模型与值校验不变**：`name` 与 `.json` 同一待遇——trim、非空、80 字符上限（超限回落文件名、不告警）；未知 coverage 照旧告警、不画徽标。客户端零改动（`ThemeContext` 本就直接消费服务端条目的 `name`）。

**证据**：

| 项 | 值 |
|---|---|
| 声明名赢文件名（含大小写区分） | `theme-files.service.test.ts`："a .tmTheme may claim a coverage…"（夹具声明 `Nord Night`、文件名 `Nord`）与 "a .tmTheme's declared name labels the picker…" |
| 嵌套 `name` 不被捡 | 同文件后一条：`shellVariables` 条目**先于**顶层 name 出现——无深度门槛的扫描会先捡到它（变异 A1 曾因此假绿，夹具重排后转 RED） |
| 长名 / 空名回落文件名 | "…declared name labels…"（81 字符 / 纯空白两个夹具） |
| coverage 仍在 cloudcli 内读 | "…declared name labels…"（claim 夹具：name ＋ `cloudcli{coverage, tokens}` 并存，tokens dict 内的键不牵连） |
| 变异 6/6 RED、0 NO-MATCH | A1 depth 门槛移除 / A2 scope 永不入 cloudcli / A3 长度上限移除 / A4 trim 移除 / A5 未知 coverage 告警移除 / A6 关闭标签一律降深度（`</key>` 也降，深度追踪崩坏） |

**门槛**：`typecheck`（client + server）0；`lint` **153 warnings / 0 errors**（无新增）；`test:client` **141 文件 / 1167 用例全过**（未变）；`npm test` **1019 / 998 通过 / 20 失败 / 1 跳过**（＋1 服务端测试）——动了 `server/`，红集名字集 stash A/B 真做：基线 20 条与当前 20 条实质逐字节同（唯一差异是 `agent.routes.test.ts` 的**文件级**条目，单文件复跑 3×7/7 全绿、其失败子测两边红集都有，判为时序抖动非本片引入）；`theme-tokens` **92 全过**——**并修订 2-J 的记录读数**：theme-tokens 树与 2-J 提交逐字节相同（`git diff 0cc6d63f HEAD -- tests/theme-tokens/` ＝ 0 行）而两次实测均为 92，2-J 记录的 90 是早于最后一次编辑启动的旧读数（2-I 的 1164 同款陷阱再现）；`build` exit 0。

**与既有账的关系**：出厂状态无色彩视觉变更；一处如实点明的**呈现变化**——带声明 `name` 的 `.tmTheme` 文件在选择器里从此显示声明名（无 `name` 的文件行为不变）。**可做未做账自此只剩一笔**：文件主题可读性警告只到控制台（2-G 边界 1）。

#### 2-L 实施记录（2026-09-26）

**范围**：2-G 边界 1 的收账——文件主题的可读性警告不再只到控制台。主题线清账后用户回"继续，按你推荐的"，在最后一笔可做未做账上开工（同族的前一笔已由 2-K 结清）。

**开工先读全账**：2-G 边界 1 把"不进设置页"归因于"设置页列文件不读内容"（2-D 特意如此）。重读发现那个归因多推了一步——**列文件**不读内容是真的，但**应用时**的编译（2-B 起）本来就要读内容，其报告只是从未被接进任何状态。故本片不需要推翻 2-D 的边界，只需要把已有的编译结论接到消费者面前——与 2-F1 那次"否掉阻断式预检 ≠ 否掉整件事"同一形状的改判：**归因里的"做不到"其实是"没接"**。

**决策（5 条，全记录于 §5.10 v3）**：

1. **报告跟着样式表走**：`UserThemeStyleState` 增 `warnings` 字段，语义是"文档里现在这件样式表的编译结论"——与 `appliedId` 同进出：成功 apply 带上、失败 / 清空即清、**替换加载期间保留旧报告**（页面穿的还是旧的那件——与"换版本时保留旧 `appliedId` 给 xterm 留一致窗口"是同一条逻辑）。
2. **报告随缓存走**：`CachedStyle` 增 `warnings`，与编译产物同源同存。boot 恢复**不重编译**（同 id 同 revision 直接 no-op），报告若不随缓存走，同一主题跨一次刷新就有两种可读性。缓存校验收窄：无 `warnings` 字段或形状不合的条目**整条拒**（与 fingerprint 失配同型）——旧缓存一次性重编译，首帧回落一次，与指纹 bump 的既有代价一致。
3. **UI 通道在文件区**：`UserThemesSection` 自己订阅 style store（模块订阅，ThemeContext 先例），在文件列表下方显示"已应用文件主题"的报告块——条件是 `appliedId` 命中某个文件条目且报告非空。粘贴主题不走此块：它的报告有自己的时刻（粘贴成功时），同一份警告显示两遍会被读成两个问题。
4. **零新增 i18n 键**：`contrastTitle` / `contrastWarning` / `contrastAppearance.*` 的措辞与来源无关（"主题仍会生效"对文件同样成立），逐字复用；报告块抽成共享的 `ContrastReport` 组件，两处一个形状。
5. **`console.warn` 保留**：设置页不常开，文件作者常看的是终端——界面通道是加、不是换。

**证据**：

| 项 | 值 |
|---|---|
| 状态随 apply 带报告 / 失败清空 | `userThemeStyles.test.ts`："a theme that applies but cannot be read is warned about…"（扩展为同时断言 state 里的配对、比值与下限）；"switching to a theme that fails takes the old warning off the state" |
| 加载期保留旧报告 | "the old warning stays while the replacement is still loading"（deferred 响应夹具） |
| 报告随缓存跨 boot | "the warnings of the applied file theme travel with the cache to the next boot" |
| 坏报告条目整条拒 | "a cache entry that cannot state its warnings is not restored" |
| 文件区显示 / 切走即消 / 无警告不渲染 | `userThemesSection.test.tsx` 三条新用例 |
| 粘贴不进文件区 | "an applied paste keeps its report out of the file list" |
| 真引擎 state 形状 | `user-theme-{tokens,paste}.spec.ts` 的 `toEqual` 逐条钉住实际报告——tokens 夹具（`appearance: light`）实得 **2 条**（`--muted-foreground` / `--ring` 落绿色 `--background`）、paste 夹具（无 `appearance` ⇒ system 作用域）实得 **5 条**（暗色侧再添 3 条）：未声明侧落出厂基色、`system` 两侧都判，恰是 §5.10 v2 裁定在真引擎的再现 |
| 变异 7/7 RED、0 NO-MATCH | M1 成功发布丢报告 / M2 缓存写入丢 / M3 boot 恢复丢 / M4 形状校验跳过 / M5 失败保留旧报告 / M6 加载期清空旧报告 / M7 UI 丢"appliedId 是文件"门槛 |

**门槛**：`typecheck` 0；`lint` **153 warnings / 0 errors**（无新增）；`test:client` **141 文件 / 1175 用例全过**（2-K 1167 → ＋8：`userThemeStyles` 36→40、`userThemesSection` 23→27；另 `userThemeResolution` / `themeSelectorUserThemes` 的缓存夹具补 `warnings: []`——被收窄的缓存校验拒了旧形状夹具，M4 的语义在测试基建上的再现）；`npm test` **1019 / 998 通过 / 20 失败 / 1 跳过**（服务端零改动，A/B 豁免可用）；`theme-tokens` **92 全过**；`build` exit 0。

**与既有账的关系**：**本片在出厂状态下无视觉变更**——报告块只在"已应用的用户主题确有低对比配对"时出现，出厂主题与空主题目录都不触发；出现时的样式复用 2-G 的粘贴报告块。**如实边界（1 条）**：跨设备同步来的粘贴主题应用后仍无界面报告通道——账只记了文件主题，粘贴主题的报告时刻仍在粘贴时。**可做未做账至此清零**；主题线全部收口，无待拍板、无待定项。

#### 2-M 实施记录（2026-09-26）

**范围**：§6 阶段 1 的"可选随附功能"——令牌预览页，主题线最后一笔未做项（清账后用户回"继续"，候选清点：回到底部方案状态行陈旧实为已实施、iOS 冷启动 P4 被阻塞、唯此一笔可做）。外观设置页新增折叠的预览区：文档当前解析出的**全部**自定义属性，按家族分组、明暗两列并排，值旁带色块。

**实现**：新增 `src/shared/tokenSnapshot.ts`（已登记 oxlint `frontend-shared-file`）——
- **明暗双读**：`.dark` 类是唯一作用域两态的东西（`ThemeContext` 切它；`:root` / `.dark` / 覆盖层全挂在类上），故同一任务内切类 → 两次 `getComputedStyle` → `finally` 恢复，浏览器无绘制窗口可乘；恢复在 `finally`，抛错也不落错态。
- **枚举**：按下标遍历 computed style、过滤 `--` 前缀——不解析样式表，浏览器替我们做完 `var()` 链的替换，读到的就是页面穿着的叶子值（含运行时注入的用户主题令牌）。
- **分组**（纯显示层）：已知前缀家族（palette / term / editor / graph / …）各自成组、按表序；其余——L2 语义面（`--background` 等）——合成"语义令牌"组排第一；后来才出现的新家族落语义组而非失踪（**错组好过丢令牌**，调试工具的唯一契约是"文档解析出的每个令牌都可见"）。
- **色块分类**：裸 HSL 三元组（色板与 L2 的存储形状，样式表从不裸用 `var(--primary)`、必包 `hsl()`）按同一方式包裹；`#hex` / `rgb(` / `hsl(` 等原样；其余（字体栈、数字）不配色块。
- 新增 `src/modules/settings/TokenPreviewSection.tsx`（薄 UI：折叠开关 + 分组表；**快照在点击时取、不在渲染期取**——读取会切 `.dark` 类，只允许发生在事件处理器里；再开一次就重读，不重放旧快照）；`AppearanceSettingsTab` 在 `UserThemesSection` 之后挂载；i18n 两端各 6 键（`tokenPreview.*`）。

**真引擎验证**（fixture 暴露 `readTokenPreviewSnapshot`，新增 `token-preview.spec.ts` 4 条 ×2 引擎）：① 枚举到达静态清单的每个家族（语义 / 色板 / 编辑器 / Git 图 / 终端）；② **运行时注入**的令牌（applyUserTheme 加的新名字）也被枚举到——"注入的样式表就是文档的一部分"；③ 明暗两列不同、且暗列与 fixture 的静态读取同串；④ 类恢复守卫在真引擎成立。**webkit / chromium / firefox 都通过**——"computed style 枚举含自定义属性"这一浏览器行为假设在全部三引擎得到证实。

**变异 8/8 RED**，含两次**假绿复盘**（夹具表达力问题，修夹具不动被测代码）：M1（双读被拆）锚点命中 if 分支（dark 起始）而 dark 起始用例只断言类恢复没断言两列值——补值断言；M5（枚举不过滤标准属性）的假 `getComputedStyle` 里只有自定义属性、无可被误收之物——夹具补一条标准属性并断言被排除。

| 变异 8/8 RED、0 NO-MATCH | M1 双读拆掉（暗列＝亮列）/ M2 恢复改一律清除 / M3 前缀匹配丢连字符门槛 / M4 色块不包裹 hsl / M5 枚举不过滤 / M6 并集改交集 / M7 语义组不排第一 / M8 快照在渲染期执行 |

**门槛**：`typecheck` 0；`lint` **153 warnings / 0 errors**；`test:client` **143 文件 / 1186 用例全过**（2-L 141/1175 → ＋2 文件 / ＋11 用例：`tokenSnapshot` 7 ＋ `tokenPreviewSection` 4）；`npm test` **1019 / 998 / 20 / 1**（服务端树与 2-L 逐字节相同，A/B 豁免）；`theme-tokens` **100 全过**（92 → ＋8：4 条 ×2 引擎）；`build` exit 0。

**与既有账的关系**：**本片是纯新增 UI**（§6 早已"部分采纳"裁定过的可选增值项，不属零变化片，无需另拍板）；出厂默认折叠、不展开即零视觉影响。**主题线至此再无任何账目**：切片表 2-A..2-M 全绿、待拍板清单空、可做未做账空。

#### 2-N 实施记录（2026-09-27）

**范围**：新增第三套预制主题 `cc-catppuccin`。来源不是文档里的计划项，而是用户的一次新要求——"参考 Codex 的主题与配色，弄一个配色主题"。2-M 收官后主题线已清账（无待拍板、无待办），故本片是**用户驱动的新增量**，切片表顺延编号。

**开工先看清参照物是什么**（本片最有价值的一步）。逐条取证后结论与直觉相反：**Codex 根本没有自己的 UI 色板**。

| 事实 | 证据 |
|---|---|
| 主题 = **纯语法高亮主题**，没有界面配色可配 | `codex-rs/tui/src/render/highlight.rs`，`set_theme_override`（`OnceLock`，只能设一次） |
| 内置 27 套，全来自 `two-face` / `syntect` 生态 | 本机 `codex-cli 0.155.1` 二进制里的 kebab 名单：`dracula` / `gruvbox-dark` / `nord` / `one-half-dark` / `solarized-*` / `catppuccin-{latte,frappe,macchiato,mocha}` … |
| **默认按终端背景自适应** | `adaptive_default_theme_selection()`：终端背景判为浅色 → `catppuccin-latte`，否则 → `catppuccin-mocha` |
| 自定义主题 = 往 `$CODEX_HOME/themes/` 放 `.tmTheme` | 本机 `~/.codex/themes/` 与 `config.toml` 都未设，跑的即默认 |

关键推论：Codex 的外壳（背景、边框、状态栏）用的是**用户终端自己的颜色**，主题只管代码 / diff 的着色。所以"Codex 的配色"在暗色终端下 ≈ **Catppuccin Mocha**，而这恰好是两件事：

1. **语法那半** cloudcli 已有通道（选项 B2 的 `.tmTheme`，2-E / 2-I），**不需要新东西**；
2. **外壳那半**在 Codex 里由终端承担、在 cloudcli 里得自己给 —— 这就是本片要交付的：一套 Catppuccin 的 `[data-theme]` 覆盖层，暗 = Mocha、浅 = Latte。

**开工时拍板的三件事**（用户回"按你推荐的"）：做成**内置主题**（而非只往 `~/.cloudcli/themes/` 丢一个文件——那样漏在护栏外、别人也拿不到）；**两半都做**（`coverage: full`，浅色半边是 Latte）；accent 取 **Catppuccin blue**（`89b4fa` / `1e66f5`），而非招牌的 mauve。

**一处我自己的错判，被契约当场纠正**：上一轮调研末尾我建议"graph lane 先不动"。这条与 `coverage: full` **直接冲突**——`theme-overlays.spec.ts:115` 的 `MUST_MOVE.full` 按定义包含 `SURFACES.graph`（`--graph-lane-1/5/10`），一个 `full` 覆盖层不动 graph lane 会直接红。参照 `cc-polar` 复核后确认：它也**动**了 graph lane（`--palette-graph-1..10`），只是"同色相、同序、降饱和"，注释里写着"so a lane still reads as itself"。故本片照同一方法重挑十色：**色相与顺序照旧、饱和度统一压到 55%、明度取"两底较差者最大"的那一点**——结果是每条 lane 在 Mocha 与 Latte 上都不低于 **3.76:1**，比 `cc-polar` 自己把这条线画在 2:1 更宽裕。**教训**：给"coverage: full 要做什么"提建议之前，先把契约测试里那个 coverage 的正向清单读一遍，而不是按 `cc-polar` 的注释印象推断。

**一处"照抄参照物会被自家契约拦下"**：Catppuccin Latte 的次级文字 `subtext0`（`#6c6f85`）在 Latte 自己的基色 `#eff1f5` 上只有 **4.37:1**，低于 AA 4.5:1。这与 1-H 的 `--palette-sand-500` 44%→43% 是同一类账，但成因相反——那次是**基色不达标**，这次是**被参照的色板本身不达标**。处置同样：换成 `subtext1`（`#5c5f77`，5.53:1）。这条**不修就会红**：`contrast.spec.ts` 的 `SUBJECTS` 由 `BUILTIN_THEMES.filter(appearance === 'system')` 自动展开，新主题注册当天就进契约。

**一处先被自家预检拦下、没走到契约**：Catppuccin 的红（`#f38ba8`）是为**在深色面上读**而设计的粉彩，拿来当 `--destructive` 的**填充**、上面压浅色标签只有 **2.0:1**。处置按 §5.10 的精神分两半：浅色半边取 Latte 红 `#d20f39`（配 frost 标签 **5.19:1**，优于基色自己的 3.60:1）；**暗色半边不动** `--palette-danger-800`，保留基色深红——它与 Mocha 的 `text` 配出 **6.93:1**。这是**有意的不对称**，注释里如实写明。

**实现**（`src/shared/constants.ts` 注册 ＋ `src/index.css` 三块）：

- **L1 覆盖块**（`[data-theme="cc-catppuccin"]`，无 `.dark` 分支）：`sand` 族 → Latte（`base` / `mantle` / `surface0` / `subtext1` / `text`），`ink` 族 → Mocha（`base` / `surface0` / `surface1` / `surface2` / `subtext0` / `text`），`brand` 族两档，`danger-500` 一档，`term` 族 20 项，`graph` 族 10 项。全部是 L1，故两态各自取步、一处生效——与 `cc-polar` 同构，也顺带满足契约测试的"颜色令牌不得持 palette 之外的字面值"。
- **不改**：`--palette-white`（浅色 card 保持纯白，与基色 / `cc-polar` 一致）、`--palette-frost-50`、`--palette-danger-800`（见上）、以及 `gray` / `zinc` / `slate` / `neutral` 兼容斜坡与 `--n-*`。
- **editor 两块**（`:not(.dark)` ＋ `.dark`）：形状照 `cc-polar` 的两分支（其基值是外观相关的字面值，单块会泄漏浅色 chrome 进暗色），值全走 `hsl(var(--palette-*))` 引用。浅色块不声明 `--editor-fg`——它跟随 `sand-950`，与 `cc-polar` 的浅色块同一处理。
- **终端的 board 是 appearance-agnostic 的**（`:root` 声明一次、`.dark` 不镜像），故取一个 flavour：Mocha 的 ANSI-16。Catppuccin 只发布 14 个 accent 供 16 个槽位，故 `bright-*` 半轴复用同名 accent，只让两端分开（`bright-black` → `surface2`、`bright-white` → `text`）——这是如实映射，不是省事。

**证据**：新增主题自动进入既有四道遍历型护栏（`contrast.spec.ts` 的 SUBJECTS、`theme-overlays.spec.ts` 的 `MUST_MOVE`/`MUST_NOT_MOVE`/`derivedMoves`/`@layer` 结构断言/浅色块不泄漏、`token-baseline` 的"每个 palette 令牌至少被消费一次"）；`themeContext.test.tsx` 与 `themeSelector.test.tsx` 都是遍历 `BUILTIN_THEMES` 的形态，新增条目零改测试即被覆盖。取值本身用**仓库自己的对比度算法**（`userThemeContrast.ts` 的同一套 HSL→8 位通道→WCAG，脚本复现出文档记载的基色 4.62 以证明没算错）预检：**6 配对 × 明暗两态全过**，最低浅色 `--primary-foreground` on `--primary` = 4.70；`ring` on `background` 浅色 4.34（下限 3）。34 个 Catppuccin hex 转 HSL 三元组**逐个精确往返**（`paintedChannels` 取整后与原 hex 逐字节相同）。

**门槛**：`lint` **153 warnings / 0 errors**（无新增）；`test:client` **144 文件 / 1208 用例全过**（未变——选择器与注册表测试都是遍历式，新增主题不增用例）；`npm test` **1021 / 1000 通过 / 20 失败 / 1 跳过**（未动 `server/`）；`theme-tokens` **108 passed / 0 failed**（基线 102 passed / 2 failed → ＋4 passed 为新增主题在 `contrast.spec.ts` 与 `theme-overlays.spec.ts` 各 ＋1 用例 × 2 引擎；另 −2 failed 为陈旧断言修复后转绿，见下）；`build` exit 0。

**一处既有红，如实记账（不是本片引入）**：`theme-chrome.spec.ts:118` 在 chromium / webkit 两引擎都红——断言"未知名 token 回落到 `index.html` 的 `#ffffff`"，实测回落到 `#f7f6f3`。成因是 **1-I（`e4f5cb70`）把浅色首帧 chrome 从 `#ffffff` 改成派生值**，同步改了 `index.html:93` 与 `src/shared/utils.ts:368` 的 `FALLBACK_THEME_COLOR.light`，但这条断言（及其上方那句"`index.html` ships `#ffffff`"的注释）没跟上。**HEAD `6de6904f` 上就红**：本片以 `git stash` 做全量 A/B，基线读数与加片后**逐字节同名同数**（同为这两条）。**同时修订一处旧记录**：2-M 与实施轮把 `theme-tokens` 记作"102 全过"，实为 **102 passed / 2 failed**——那两个数此前被当成一个"全过"的读数。修断言属改护栏，未擅自动手，留给用户定夺。**已修（2026-09-27，后续会话）**：按用户批复把期望值与上方注释一并更新为 `#f7f6f3`（= `FALLBACK_THEME_COLOR.light`，与 `index.html:93` 同值），保留了"不可解析的令牌必须回落到出厂基色、而不是发布探针的继承色"这条原意——**实现侧未动**，两条红纯粹是期望值陈旧。修后 `theme-tokens` 读数为 108 passed / 0 failed。

**与既有账的关系**：**出厂状态无视觉变更**（新增主题只在用户主动选中时生效）。**待拍板清单仍为空**；上述 `theme-chrome.spec.ts:118` 的陈旧断言**已就地结清**（本片曾记为新增的一笔可做未做账，2026-09-27 后续会话修毕）。没有自动顺延的下一片。

---

#### 2-O 实施记录（2026-09-28）

**范围**：新增第四套预制主题 `cc-islands`。来源同 2-N，也是用户的新要求——"参考 IntelliJ IDEA 设置里外观下的 Islands Dark / Islands Light，看看能否获取到主题信息，参考并给 cloudcli 定制一下"。清账后主题线无待拍板、无待办，故同样是用户驱动的新增量，切片表顺延编号。

**开工先看清参照物是什么**（本片最有价值的一步，结论与 2-N 相反）。参照物就在本机：`~/Applications/IntelliJ IDEA.app`。主题不是外部文档、也不必联网，而是**随包发行的资源**：

| 事实 | 证据 |
|---|---|
| 主题 JSON 在 `Contents/lib/intellij.platform.ide.impl.jar` 的 `themes/islands/` 下 | `unzip -l` 列出 `ManyIslandsDark.theme.json`（54 KB）/ `ManyIslandsLight.theme.json`（55 KB）/ `ManyIslandsDarcula.theme.json` / `HighContrast.theme.json` |
| **文件名不叫 Islands，认 `name` 字段** | 两者 `name` 分别是 `Islands Dark` / `Islands Light`；`parentTheme` 为内部的 `ExperimentalDark` / `ExperimentalLightWithLightHeader`。按文件名找会一无所获 |
| **Islands 有一套完整的 UI 色板**，不是 Codex 那种"只有语法" | `colors` 段 329 / 330 条：`gray-10..160`＋七个色相各 16 档＋语义层（`layer-0/1/2-bg`、`text-default/muted/secondary`、`accent-*-bg`、`control-*`…）；`ui` 段 110 组键把它们绑到具体控件 |
| 用户当前用的就是它 | `options/colors.scheme.xml` 写着 `<global_color_scheme name="Islands Dark" />`；`colors/` 里另有一份用户导出的 `_@user_Islands Dark.icls`（`partialSave`，只存了字体与行距） |

推论：2-N 是"借"（Codex 没有外壳色板，只能借 Catppuccin 的板），**本片是"译"**——把 Islands 自己的板译进 cloudcli 的令牌模型。

**板的结构决定了映射**。Islands 的每个界面面都指向三层之一，而 `ui` 里的默认键 `*` 把 `foreground / background / borderColor` 绑到 `text-default / **tool-window-bg** / tool-window-border`——`tool-window-bg` 就是 `layer-0-bg`。也就是说 Islands 的**主导面是 layer-0**，这直接定下 `--background ← layer-0-bg`，其余按基色既有的高低次序顺推：

| cloudcli L1 落点 | Islands 令牌 | 暗（= Islands Dark） | 浅（= Islands Light） |
|---|---|---|---|
| `--background` | `layer-0-bg`（`*` / `tool-window-bg`） | `gray-10` `#191A1C` | `gray-150` `#E9EAEE` |
| `--card` / `--popover` | `layer-1-bg`（popup / main window） | `gray-30` `#26282C` | 纯白（见下） |
| `--muted` / `--secondary` / `--accent` / `--border` | `layer-2-bg` / `layer-1-border` | `gray-40` `#33353B` | `gray-140` `#DDDFE4` |
| `--input` | `control-border` | `gray-50` `#40434A` | `gray-130` `#D1D3D9` |
| `--muted-foreground` | `text-muted` | `gray-100` `#9FA2A8` | `gray-70` `#5F6269` |
| `--foreground` | `text-default` | `gray-130` `#D1D3D9` | `black` `#000000` |
| `--primary` / `--ring` | `accent-brand-bg` = `blue-80` | `blue-100`（见下） | `blue-80` `#3871E1` |

**三处有意偏离，各有必须偏离的理由**（都写进了 CSS 注释）：

1. **`--palette-frost-50` 从 `210 40% 98%` 提到纯白**。这是本线**第一次动"标签色"这一档 L1**（前几套主题只动 substrates / accent / 板）。理由：Islands 的按钮填充是 `accent-brand-bg = blue-80 #3871E1`、标签是 `text-over-accent = white`，而基色那档偏白的 `frost-50` 压上去只有 **4.34:1**——低于基色自己守住的 4.94:1。纯白读到 **4.55:1**，于是标签保持 Islands 的原值、配对也仍然合法。
2. **`--palette-danger-500` 取 red-80（`#C54E58`）而非浅色 flavour 自己的 `accent-error-bg`（red-90 `#E4656E`）**：red-90 配白标签只有 **3.31:1**，比基色已经勉强的 3.76:1 还差。同色阶深一档的 red-80 读 **4.56:1**。（这一对 §5.10 不守，但守不守是运气，好不好用是事实。）
3. **`--palette-danger-800` 取 red-60（`#80383E`）而非暗色 flavour 的 red-80**：暗色的标签是浅字而非 IntelliJ 那种小字号白压强调色，red-80 配 `ink-100` 只有 **3.03:1**，red-60 读 **5.50:1**。

**一处"参照物的顶层在这个令牌模型里不可移动"**：Islands Light 的编辑器页是它的**顶层**（`layer-2-bg` = 纯白），而纯白正是 `--palette-white`——被 `--n-white`（终端选区的白描边）共用，属 `theme-overlays.spec.ts` 的 `fixed` 组，任何主题都不得动。于是浅色半边照 `cc-polar` / `cc-catppuccin` 的先例走：**card 保持纯白坐在染色基材上**（这恰好就是 Islands Light 的观感），编辑器页则取基材色——而 `MUST_MOVE.full` 明列 `--editor-bg` 必须动，这条硬约束与"编辑器页=白"在 Islands 这里不可能同时成立，取前者。

**终端板：Islands 的既有值取一半、色阶补一半**。Islands 的编辑器 scheme（`themes/islands/IslandSchemeDark.xml`）只给了 `CONSOLE_BACKGROUND_KEY` `#191A1C`、`CONSOLE_NORMAL_OUTPUT` `#BCBEC4`、`CARET_COLOR` `#CED0D6` 三个——**没有 ANSI-16**；新版 IDE 的终端 ANSI 色由主题色阶派生，不在任何资源文件里。故 board 的 bg / fg / cursor 取其既有值（bg 恰好等于暗色 `layer-0`，面板因此不显得是外来面），十六个槽位从色阶读：`-90` 档作工作半轴（彼此相差不到 0.08、在 console 背景上都在 5.3:1 附近），`-100` 档作 `bright-*` 半轴，槽位语义照旧（红=错误/删除、绿=成功/新增、蓝=信息）。board 与基色一样**声明一次、两态都用暗版**。

**graph lane** 沿用 2-N 记录下来的那条方法（也在本片被再次验证有效）：十色相与顺序照旧，饱和度统一 60%，明度取"两底较差者最大"的那一点——每条在 `#E9EAEE` 与 `#191A1C` 上都不低于 **3.79:1**（比 2-N 的 3.76 略宽）。Islands 只发布七个色相、不是十条 lane，所以这里"留色相、只动温度与档位"是必要的，不是偷懒。

**证据**（全部为本片实测，非推算）：

| 手段 | 结果 |
|---|---|
| 对比度（真引擎，两引擎同值） | 浅 `fg/bg 17.47`、`fg/card 21.00`、`muted-fg/bg 5.08`、`muted-fg/card 6.11`、`label/primary 4.55`、`ring/bg 3.78`；暗 `11.64 / 9.86 / 6.81 / 5.77 / 6.83 / 6.83` —— **6 配对 × 2 态全过** |
| 34 个 Islands hex → HSL 三元组 | **逐个精确往返**（取整 8 位通道后与原 hex 逐字节相同） |
| `theme-tokens` A/B | 无本片改动 **124 passed** → 有本片改动 **128 passed**，**恰 +4** = `contrast.spec.ts` 与 `theme-overlays.spec.ts` 各 ＋1 用例 × 2 引擎（新主题自动进 `SUBJECTS` 与 `OVERLAYS`），与预测逐位吻合 |
| 产物核对 | `dist/assets/*.css` 里三块 `[data-theme=cc-islands]` / `:not(.dark)` / `.dark` 均在，全表零 `@layer` |
| 真机观感 | transcript fixture 真组件、明暗两态截图；`--n-white` 与 `--n-gray-*` 读数未动（固定组守住） |

**反向验证（4 组变异，全部按预期报红）**：

| 变异 | 结果 |
|---|---|
| M1 浅色 `brand-500` 调亮到 blue-90 | **恰 2 红**（仅 `contrast.spec.ts` × 2 引擎）——4.55 → 3.29，标签配对被抓住 |
| M2 删掉浅色编辑器块 | **恰 2 红**（`theme-overlays.spec.ts`）：`cc-islands claims coverage "full" but left these unchanged in light: --editor-bg …` |
| M4 改动 `--palette-gray-100` 的值 | **恰 2 红**：`moved surfaces it does not advertise: --n-gray-100`（固定组护栏有效） |
| M5 浅色块选择器写成 `:not(.dark), [data-theme="cc-islands"]` | **恰 2 红**，命中"该主题的泄漏检查覆盖不到任何东西"那条反空转断言 |

**一处既有护栏的覆盖面缺口，如实记账（不是本片引入，未擅自动手）**：`theme-overlays.spec.ts` 的"浅色块不泄漏进暗色"用例**对整块浅色半没写 `:not(.dark)` 的主题整体跳过**——它先做 `if (!blocks.some(b => b.selector.includes(':not(.dark'))) continue;`，之后那句 `expect(owned.length).toBeGreaterThan(0)` 才跑得到。实测：把 `cc-islands` 的浅色块改成裸选择器（M3）会让 `--editor-panel-border` / `--editor-fold-placeholder-bg` / `--editor-tooltip-border` / `--editor-tooltip-arrow-border` 四条泄漏进暗色，而**全套 6 例仍全绿**（其余主题守着 `guarded` 非空，所以那条全局断言也过）。测试自身的注释写着"forces the light half to be scoped"，按主题读并不成立。修它属**改护栏**，留给用户定夺——本片的实际文件写对了（`:not(.dark)`），缺口只是"下一个人写错时没人拦"。

**门槛**：`lint` **153 warnings / 0 errors**（无新增）；`typecheck` ＋ `typecheck:theme-tokens` 均 exit 0；`test:client` **147 文件 / 1230 用例全过**（未变——选择器与注册表测试都是遍历式，新增主题不增用例）；`theme-tokens` **128 passed / 0 failed**；`build` exit 0；`npm test` **1029 / 1004 通过 / 24 失败 / 1 跳过**，而 `git diff HEAD -- server/` **= 0 行**且 `git status --short -- server/` 为空、服务端测试无一读取 `src/` 或 `dist/` ⇒ **红集不可能因本片改变**（比 stash A/B 更硬）。本次失败名集仍是既有那批（Codex 目录 / Claude 路径解析 / WorkBuddy 引擎 / OpenCode / DSH 权限），条数 24 高于 2-N 记的 20，属该基线自身的漂移。

**与既有账的关系**：**出厂状态无视觉变更**（新增主题只在用户主动选中时生效）；`--palette-white`、`gray`/`zinc`/`slate`/`neutral` 兼容斜坡、`--n-*` 一律未动。**待拍板清单仍为空**；新增两笔可做未做账（都不阻塞、也无人要求）：① 上述泄漏守卫的覆盖面缺口（属改护栏）；② `.icls` 编辑器**语法**配色不在任何覆盖层可达范围内（§8.9 的既有边界，Islands 的 editor scheme 里另有 30 余条语法色本片未接线）。没有自动顺延的下一片。

---

## 7. 风险与取舍

| 风险 | 说明 | 缓解 |
|---|---|---|
| 阶段 0 触及终端/编辑器 | 这两处逻辑较深（xterm 实例生命周期、CodeMirror 扩展） | 阶段 0 只做"取值来源替换"，不改行为；对 xterm/CodeMirror 补测试 |
| 令牌契约面覆盖不全 | 主题作者可能发现某个角落不受令牌控制 | §5.7 两条 grep + §5.11 契约测试共同界定可信边界；对未令牌化处以注释声明豁免；数量类令牌（Git lane 等）用参数化回退（§5.12，**已由 2-J 落地**；lane > 10 的颜色变化属已拍板的有意视觉变更） |
| `data-theme` 与 `dark:` 原子类叠加 | 两套机制并存可能产生优先级困惑 | ① 主题覆盖层严禁放进 `@layer`（§5.2），稳定压过 `@layer base`；② 选项 A 强制 `data-theme` 只写变量不写选择器；③ `dark:` 前缀按 §5.7 策略 ① 消除，或按策略 ② 在主题契约中声明 |
| **具名色原子类规模（约 3227 处）远超初稿预估** | 阶段 0 若全量收口，工作量与回归面都很大 | 按文件集群分片（105 文件）、热点单独成片、每片 DoD 三件套、机器可校验豁免清单；定量终点 = 收敛到豁免清单（§6 阶段 0） |
| **死令牌（定义了但无消费者）** | `--status-*` / `--palette-*` 若先定义再换消费者，期间主题作者覆盖无效 | L1 必须与 L2 引用改写同片（§5.1）；`--status-*` 与状态色替换捆绑、阶段 0 不引入（附录 A）；§5.11 契约测试断言令牌"有取值"且"被引用" |
| **阶段 0"视觉零变化"不可验证** | 人工回归漏判（alpha 偏移、1px 差异） | 引入视觉回归基线（Playwright 截图比对，阈值 0），见 §6 阶段 0 验收 |
| **用户主题"合法但有害"** | 选项 B 可写 `body{display:none}` 等，用户失去恢复入口 | **强制恢复通道已由 2-D 落地三条中的第 ③ 条**（`?theme=default`：丢"选择"不丢主题、在 boot 最先跑，见 §5.6 v14）；**能写出有害 CSS 的路径**：选项 B 的**文件**线自 2-B / 2-C 起即可用（放一个 `.css`），其**粘贴**线自 2-F1 起可用（粘贴框可选"原始 CSS"、带一次信任确认，`?theme=default` 对粘贴主题同样有效），**高级模式的实时预览自 2-H 起又添一条**——它在编辑时就把草稿放上真实界面（见 §5.5 v6），但它是**瞬时**的（刷新即消、`?theme=default` 也一并清），是三条路径里唯一自带"弃用即回收"的；选项 A（含粘贴线）天然免疫；2-I 的 `cloudcli` 内嵌键走选项 A 白名单、值形状照审，天然进不来规则形状；自愈哨兵未做 |
| **a11y 退化** | 主题可写出低对比度 / 焦点不可见 / 仅靠颜色传达状态 | §5.10 硬性条款 + §5.11 契约测试断言；**用户主题那一半自 2-G 起可被观测**（选项 A 的令牌过 6 个配对，未声明的一侧以出厂基色为准，**非阻断**；粘贴时显示在设置页、文件主题与应用时走 `console.warn`，见 §5.10 v2）；"不以颜色单独传达状态"与"焦点可见"仍是纸面条款，前者未纳入任何自动断言 |
| 用户主题权限 | 选项 B 可写任意 CSS | 默认 A，B 需显式开启并提示信任来源 |
| 主题数量膨胀导致选择器难用 | — | 内置主题保持少而精；用户主题分区展示 |

---

## 8. 待评审确认的问题（v3：全部已决）

> v2 收敛了 1/3/4/5/6；v3（2026-09-25，三方补充拍板后）2/7/8/9 也已决。**当前无遗留待定项**——由实施新开出来的两项都不阻塞任何后续片：① 0-F1 顺带核出的 §5.12 ">10 lane 参数化回退"（已记在该节 v2，属**可选增强**）；② ~~1-C 顺带核出的"JS 跑起来之前的 chrome 色"~~ **已由 1-I 落地**（`e4f5cb70`，见 §5.6 v8 与 1-I 记录；其中 `manifest.json` 与 `mobile/www` 两处如实记为不可达 / 独立色板）。
>
> **v4（2026-09-26 补记）**：阶段 2 的 2-A / 2-B 实施**均未开出新的 §8 项**——两片都只落地已决条款或改判已写的实现前提（分别见 §5.6 v11 / v12），没有产生需要拍板的模型问题。故截至 2-B：**§5.12 的 ">10 lane 参数化回退"仍是唯一一处待拍板项，且仍是可选增强、不阻塞 2-C / 2-D / 2-E 任何一片**。
>
> **v5（2026-09-26 补记）**：2-C 实施**也未开出新的 §8 项**——它遇到并解决的是文档内部的一处口径相左（`.json` 文件里的 `appearance` 是"作用域"还是"角色"），属"改判已写条款并回写"而非"新待拍板"，裁定与另两种被否读法记在 §5.6 v13。故截至 2-C：**§5.12 的 ">10 lane 参数化回退"仍是唯一一处待拍板项**（可选增强，不阻塞 2-D / 2-E）。
>
> **v6（2026-09-26 补记）**：2-D 实施**开出两处需要拍板的模型问题**，两处均已拍板并回写，故**仍未留下新的未决项**：① `ThemeManifest.source` 该采三值（`builtin` / `user` / `user-paste`）还是维持两值另加派生——裁定**三值**，另两种读法（由 id 前缀派生 / 加并列布尔）留档于 §5.3 v11；② §5.6 的强制恢复通道原属 2-E，本片把它**提前到 2-D**（粘贴主题不在磁盘上、没有"删文件即恢复"这条逃生口，而它在本片就已可能出现），并取三条候选中的第 ③ 条 `?theme=default`——裁定与未做自愈哨兵的理由记在 §5.6 v14，故 **2-E 只剩选项 B 的原始 CSS 与 `.tmTheme`**。故截至 2-D：**§5.12 的 ">10 lane 参数化回退"仍是唯一一处待拍板项**（可选增强，不阻塞 2-E）。
>
> **v7（2026-09-26 补记）**：2-E 实施**也未开出新的 §8 项**，但它做了三件与"待拍板"不同类的事，逐条记下以免被当成漏记：① **改判一处被当成实现前提的文档措辞**——§5.5 的 B2 边界原写"主 UI 令牌可由内嵌 `cloudcli` 键或**同名 `.css`** 补足"，后一条经核实**不可能成立**（服务端按 id 去重，`Nord.tmTheme` 与 `nord.css` 同为 `user-nord`，只有一个会被列出，2-A 决策 5），故 `.tmTheme` 单独存在时就是一套只覆盖语法 / 编辑器 / 终端的**局部主题**——这是如实边界而非遗漏，改判记于 §5.5 v4；那条"内嵌 `cloudcli` 键"仍未做，与 §5.12 同列待定。② **发现并修掉一处只在运行时才暴露的正确性隐患**——语法基色表此前是**追加**到 `<head>`，而用户主题的覆盖层也是追加、`:root` 与 `[data-theme="…"]` 同权重、由**文档顺序**定胜负，于是覆盖层一旦早于基色表落位就会**静默失效**；改为插到 `<head>` 最前（`ensureSyntaxStyleElement`），§5.5 v4 与 `syntaxTheme.ts` 模块注释均已写明——这是"基色层必须在前"的结构约定，不是新的模型问题。③ **按实测重划了切片边界**——原 2-E 含"选项 B 的原始 CSS"，核实它自 2-B 起就在文件线上交付（2-C 又写死 `.css` 透传），真正缺的是**选项 B 的粘贴线**，故它与"高级模式"开关、§5.10 的对比度警告一起另立 **2-F**。故截至 2-E：**§5.12 的 ">10 lane 参数化回退"仍是唯一一处待拍板项**（可选增强，不阻塞 2-F）。
>
> **v8（2026-09-26 补记）**：2-F1 实施**也未开出新的 §8 项**（无新待拍板），但它做了两件与此前同源的事：① **按实测重划切片边界**——原 2-F 一行含三件事，开工时按"能不能与粘贴线同片落地"重划为 **2-F1**（粘贴线，本片）／ **2-G**（§5.10 对比度警告）／ **2-H**（高级模式编辑器：语法高亮 ＋ 实时预览）。关键裁定：§5.10 那条警告约束的是**选项 A 的令牌**，而令牌是 `var()` 可链的（一个 `.json` 可写 `"--primary": "var(--brand)"`），声明值的对比度在编译期**算不出**，故它不能与"把原始 CSS 放进粘贴框"同片落地，须独立成片并单独设计取证方式。② **改判一处被当成实现前提的文档措辞**——§5.8 v5② 写"粘贴线在构造上进不来 `@import`"，这在"粘贴线只收选项 A"时成立，但 raw CSS 会原样注入、且粘贴前面没有服务端，故粘贴侧另有闸门（§5.8 v6）。两件都是"改判 / 重划"而非"新待拍板"。故截至 2-F1：**§5.12 的 ">10 lane 参数化回退"仍是唯一一处待拍板项**（可选增强，不阻塞 2-G / 2-H）。
>
> **v9（2026-09-26 补记）**：2-G 实施**开出并当场拍板了一处契约级分叉**，故仍无遗留项，但把它记下来，因为它是本线**第三类"需要拍板的例外"**——前两类是"模型决定"（2-C 的 `appearance` 两种读法、2-D 的 `source` 该采几个值）与"切片顺序"（2-D 把恢复通道提前）。这一类是**"另一侧的色值从哪来"**：§5.10 只写了"选项 A 的令牌校验器附带非阻断对比度警告"，没写未声明的那一侧以什么为准——而选项 A 的主题**经常只改一侧**（文档自己的示例只改 `--primary`）；三条候选（仅文件内 / 基准＝出厂基色 / 应用后浏览器实测）一个抓到 0 条、一个抓得到、一个只能在应用后说且 `system` 只查一半，**选哪条直接决定"§5.10 是否只是空头承诺"**，故必须先摆清再动手（裁定与理由见 §5.10 v2）。除这处之外，2-G 还做了三件与前几片同源的事：① **把一处"文档写了但从未落地"的条款补上**——不是"做得不够"，是 2-C 落地校验器时只做了形状，这一半**一次都没做过**（`ignored` 与 `warnings` 此前是同一个字段的设想）；② **把"配对表"从两份数据收成一份**（`CONTRAST_PAIRS` 由契约测试与用户主题警告共同消费，见 §5.11 v9），并给校验器用的基色表配了一道"表与算法同时与浏览器对齐"的护卫；③ **如实记下 2-F1 那句"`var()` 可链 ⇒ 算不出"的射程**——它否掉的是"把警告做成阻断式预检"，不否掉这件事本身，故 2-G 不是对 2-F1 的改判，而是按它的裁定独立成片。故截至 2-G：**§5.12 的 ">10 lane 参数化回退"仍是唯一一处待拍板项**（可选增强，不阻塞 2-H）。
>
> **v10（2026-09-26 补记）**：2-H 实施**开出并当场拍板了一处契约级分叉**，故仍无遗留项，但记下它——它是本线**第四类"需要拍板的例外"**：前三是"模型决定"、"切片顺序"、"契约自己缺一个操作数"（2-G）。这一类是**"一个从未写下的用户可见语义"**：§5.5 的推荐行明列"带语法高亮编辑器 ＋ **实时预览**"，却**始终没写预览画在哪**——而它直接决定"半写完的 CSS 草稿要不要影响真实界面"，是安全模型的一部分。三候选（① 应用在真实界面：防抖注入为文档级覆盖层、不落库、关闭 / 取消时收回、保留 `?theme=default`；② 隔离的预览窗格；③ 不预览、只做高亮）在开工前摆清并停下拍板，取 **①**，理由：它与"原始 CSS 原样注入"是**同一件已接受的设定**（§5.5 v5 第二条），只是提前到编辑时，且**多一条逃生路径**（刷新即消）；② 要另建渲染宿主、与"看到的就是提交后的样子"相左，③ 与推荐行明列的"实时预览"不符（裁定与 8 条决策见 §5.5 v6）。2-H 也顺带做了两件与前几片同源的事：① **切片边界重划的又一次应用**——2-H 本身正是 2-F1 按"能不能与粘贴线同片落地"重划出来的（原 2-F 一行含三件事），故它落成不是"新增范围"，而是那个裁定的最后一片；② **两处假绿查出的是「探针自己的前提不可表达」**——变异 B2 的夹具先喂坏草稿、此前并无"上一份预览"可留，E1 的 CodeMirror 桩渲染成裸 `textarea`、与选项 A 的文本框无从分辨，两处都不是"护栏缺口"而是"我的夹具表达不出被测命题"，改成能表达该前提的夹具后均转 RED（这类与 2-E / 2-G 记录的假绿同源：**0 红先怀疑验证手段**）。故截至 2-H：**§5.12 的 ">10 lane 参数化回退"仍是唯一一处待拍板项**（可选增强，不阻塞任何片）；两笔**待定但非待拍板**的如实欠账不变——`.tmTheme` 的那个可选 `cloudcli` 内嵌扩展键（§5.5 v4，与 §5.12 同列），以及"文件主题的可读性警告只到控制台、不进设置页"（2-G 边界 1，同源于"设置页列文件不读内容"）。**2-H 是 2-F 拆分里最后一片**，其完成不影响 §5.12 的待定状态。

> **v11（2026-09-26 补记）**：2-I 实施（用户在阶段切片表告罄后于三项待定项中点名此片，另两项——§5.12 与"文件主题警告上界面"——维持待定）**结清的是两笔挂账而非新开分叉**：`.tmTheme` 的 `cloudcli` 内嵌键（§5.5 v4 即记，2-E 又核出它是唯一可行补足途径）与它名下的 coverage / warnings 两问——两问都按"与既有格式同一信任模型、同一实现"就地裁定（§5.5 v7 第四、五条），没有出现需要单独拍板的新契约分叉，故 §8 的待拍板清单不变。实施上值得一提的有二：① **复用是本片的主设计决策**——内嵌 dict 以 JSON 交回 `compileUserThemeTokens` 本身，两种语法一份实现；"抽出共用循环、两个编译器各自拼块"的替代被否，理由是块拼装、上报前缀与裁决作用域会在两个调用点各自演化。② **"树同跳 A/B"的豁免本片不可用**——服务端为 coverage 读取动了 `readDeclaredMetadata`，`npm test` 红集按名字集做了 stash A/B（基线 20 条与当前 20 条逐字节相同），这是 2-C 以来第一次重新需要 A/B。故截至 2-I：**待拍板项仍只有 §5.12 的 ">10 lane 参数化回退"**；待定项剩"文件主题的可读性警告只到控制台"一笔（2-G 边界 1）；`.tmTheme` 的 plist `name` 读取是新记下的可做未做账（2-I 边界 1，无人要求）。

> **v12（2026-09-26 补记）**：2-J 实施**清掉了最后一处待拍板项**——§5.12 的 ">10 lane 参数化回退"自 v2 起挂"待拍板"（有意视觉变更），用户在 2-I 收官汇报"继续做它需要先拍板那次颜色变化"后回"继续"，即视为对该变更的批复；实现按 §5.12 原文的两个参数与公式落地，细节与默认值搜索见 §5.12 v3。本片**没有开出新分叉**：参数命名、S / L 固定值、"前 10 条 lane 逐位不变"都照原文执行，唯一的裁量是默认值的数值（搜索选出并记录了目标函数与上限）。故截至 2-J：**待拍板清单为空**；待定项只剩两笔无人要求的可做未做账（"文件主题的可读性警告只到控制台"与"`.tmTheme` 的 plist `name` 读取"）。阶段 2 的切片表（含追加的 2-I / 2-J）全部实施完毕。

> **v13（2026-09-26 补记）**：2-K 实施（用户在主题线清账后回"继续"，按既定节奏在两笔可做未做账中取 2-I 边界 1——`.tmTheme` 的 plist `name` 读取；另一笔"文件主题警告上界面"因要推翻 2-D"设置页列文件不读内容"的特意边界、属设计级重开，维持不做）**结清一笔可做未做账，未开出新分叉**。故截至 2-K：**待拍板清单仍为空**；可做未做账只剩"文件主题的可读性警告只到控制台"一笔（2-G 边界 1）。另修订一处前片记录读数：`theme-tokens` 的 2-J 终读数为 92 而非 90（树同两次实测，90 是早于最后一次编辑的旧读数，见 2-K 记录门槛）。

> **v14（2026-09-26 补记）**：2-L 实施（用户回"继续，按你推荐的"，在最后一笔可做未做账上开工）**结清了最后这笔账，未开出新分叉**：显示通道沿用 2-G 的既有分法（粘贴走粘贴块、文件走文件区），没有出现需要拍板的模型问题——开工时把 2-G 边界 1 的归因读全后发现"设置页列文件不读内容"推不出"警告永不上界面"（应用时的编译本来就读内容），故本片是**接线、不是翻案**（§5.10 v3）。故截至 2-L：**待拍板清单为空；可做未做账为空**。主题线全部收口，下一步待用户决定。

> **v15（2026-09-26 补记）**：2-M 实施（主题线收口后用户回"继续"，候选清点后取 §6 的"可选随附功能"——令牌预览页，全文档最后一笔未做项）**未开出新分叉**：范围与形态 §6 原文已裁定（"部分采纳"、实现途径"读 `getComputedStyle` 过滤 `--` 变量、按命名空间分组"），本片裁量只在实现细节（明暗双读走 `.dark` 类同步翻转、分组表纯显示层、快照取在点击时），均记录于 2-M 记录。故截至 2-M：**待拍板清单为空；可做未做账为空；设计文档再无未实施条款**。

1. **用户主题格式**：→ **已决**：三格式并行（A 令牌 JSON 默认 / B 原始 CSS 高级 / B2 `.tmTheme` 生态），见 §5.5。默认维持 A，理由见该节 v2 说明。
2. **用户主题存放位置**：→ **已决**：采用 `~/.cloudcli/themes/`，Docker 仅文档标注、不做代码适配。**实施约束**：路径解析必须复用 server 现有的 `path.join(os.homedir(), '.cloudcli', …)` 模式，新增一个与 assets 平行的目录常量，严禁主题模块另写第二套拼接。依据：`docker/` 下仅 `claude-code` / `codex` 构建环境 + `shared` + README，无应用 Dockerfile、无 compose，Docker 非分发形态；而 `~/.cloudcli` 已是既有持久化约定（`server/shared/image-attachments.ts:22`、`server/load-env.ts:43`、`server/index.ts:323`）。若 README 补 Docker 说明，须同时覆盖 themes 与 assets 两个挂载点。
3. **阶段 0 的终端配色**：→ **已决**：**终端默认保持恒深色**（把 `--term-*` 的 light 值就设为现用深色板），浅色终端作为主题覆盖能力实现，不内置翻转。
4. **第二层选择器**：→ **已决**：把"默认明 / 默认暗"建模为两套内置主题，保留 light/dark/system 三选一胶囊，使"主题"与"明暗"正交，避免双层选择器的心智负担。
5. **品牌色边界**：→ **已决**：agent 品牌色与各 harness Logo 保留硬编码，走 §8.7 的机器可校验豁免清单声明。
6. **远程主题源扩展点**：→ **已决**：只留扩展点（`ThemeManifest.source` 已是可扩展字符串枚举，未来加 `'remote'` 值成本近零），不实现。
7. **阶段 0 拆分口径**：→ **已决**：**按模块分片（文件集群为粒度）+ 机器可校验豁免清单，每片独立合入 / 验收 / 回滚，严禁一次性大 PR**。详见 §6 阶段 0。
8. **`dark:` 前缀处置**：→ **已决**：**不做"全消除 vs 暗底保证"的二选一**——该二分是伪命题（`dark:bg-gray-800` 生成 `.dark\:bg-gray-800:is(.dark *)`，特异性 ≥ (0,2,0) 且直接写死色值，`[data-theme="x"]` 的 (0,1,0) 压不过；因此**凡主题应控制的色，只能换成语义令牌类；主题不应控制的色（状态 / 品牌 / 图标）保留 `dark:` 并豁免**）。落地方案是**三分法**，详见 §5.7。
9. **`--cc-syntax-N` 语义化命名**：→ **已决**：**本轮不升语义名**，本轮只做三件事挡风险（导出 `SYNTAX_TOKEN_MAP` 常量 + 黄金映射 snapshot 测试 + denylist grep 护栏），语义名草案定方向、阶段 2 与编辑器令牌化一并实施。详见 §5.9。

---

## 附录 A：令牌清单（草案）

**L1 palette（阶段 0-A / 0-C / 0-E1 已实施，命名以此为准）**

| 色族 | 令牌 | 用途 |
|---|---|---|
| 中性极值 | `--palette-white` `--palette-black` | 卡片/浮层底、阴影基色 |
| 暖沙 `sand` | `--palette-sand-50/-100/-200/-500/-800/-950` | 浅色界面基底（档位越高越深） |
| 冰白 `frost` | `--palette-frost-50` | 强调色填充上的前景 |
| 中性墨 `ink` | `--palette-ink-100/-400/-800/-850/-900/-950` | 深色界面基底 |
| 品牌 `brand` | `--palette-brand-400/-500` | 主色（light 取 500，dark 取 400） |
| 危险 `danger` | `--palette-danger-500/-800` | 破坏性操作（light 取 500，dark 取 800） |
| 终端 `term` | `--palette-term-bg/-fg/-cursor/-selection` + `--palette-term-{black..white}` + `--palette-term-bright-{black..white}` | 0-C 新增。终端板（VSCode Dark+）自成一族，因为它的 hue 与界面族不同；**只在 `:root` 声明**，明暗共用（§8.3 已决） |
| 兼容档位族 `gray` / `zinc` / `slate` / `neutral` | 每族 `--palette-<族>-50/-100/-200/…/-900/-950`（各 11 档） | `gray` 于 0-E1 新增、其余三族于 0-E1b 新增。**Tailwind 默认中性档位的原值**（逐档 1 位小数三元组，四族 44 档往返**全部无损**），为的是把 ~1.5k 处 `bg-gray-100 dark:bg-gray-700` 类字面档位换成令牌引用而**不动像素**（§5.7 v4 / §6 之 0-E 记录）。它**不是策展色族**（与 `sand` / `ink` 无关），是**过渡层**：阶段 2 把消费者改成语义名后本族退场。**只在 `:root` 声明**（档位值与外观无关）。四族并列而不归并的理由见 0-E1b 记录（归并等于 122 处改色 + 给等值护栏开例外）；`stone` 不建（0 处消费者） |

**格式 = HSL 三元组，与 L2 同格式**（`44 22% 96%`，非 hex）。这是实施时定下的关键选择：Tailwind 用 `hsl(var(--border))` 消费令牌，只要 L1 与 L2 同为三元组，`--background: var(--palette-sand-50)` 就等价于原字面值——**Tailwind 配置与 `index.css` 中 16 处 `hsl(var(--x))` 全部无需改动**。若 L1 用 hex，才需要按 §5.1 的说明调整消费方式。带 alpha 的导航令牌写成 `var(--palette-x) / 0.7`（var 嵌套合法，解析结果与原字面值一致）。

**L2 semantic（现有，保持）**

`--background` `--foreground` `--card` `--card-foreground` `--popover` `--popover-foreground` `--primary` `--primary-foreground` `--secondary` `--secondary-foreground` `--muted` `--muted-foreground` `--accent` `--accent-foreground` `--destructive` `--destructive-foreground` `--border` `--input` `--ring` `--radius`

导航：`--nav-glass-bg` `--nav-glass-blur` `--nav-glass-saturate` `--nav-tab-glow` `--nav-tab-ring` `--nav-float-shadow` `--nav-float-ring` `--nav-divider-color` `--nav-input-bg` `--nav-input-focus-ring`

语法：`--cc-syntax-0..N`（由 Prism 主题编译产生）

**L2 semantic（新增，阶段 0 引入）**

终端（0-C 已落地；L1 对应 **20 个** `--palette-term-*`，下面这行 L2 是 **22 个**）：`--term-background` `--term-foreground` `--term-cursor` `--term-cursor-accent` `--term-selection-bg` `--term-selection-fg` `--term-ansi-{black,red,green,yellow,blue,magenta,cyan,white}` `--term-ansi-bright-{black,red,green,yellow,blue,magenta,cyan,white}`。**`--term-font-family`（v4 追加，2026-09-28）** 是本家族首个**非颜色**成员——终端字体栈（基色层默认 `Menlo, Monaco, "Courier New", monospace`，覆盖层主题可重定义；三层优先级与授权面见《CloudCLI 终端字体动态配置方案》）。该家族由此 **22 颜色 + 1 字体 = 23 个**（另有 4 个语义别名，见下条）

终端语义别名（v2 新增，0-C 已落地）：`--term-error` `--term-success` `--term-warning` `--term-info`。ANSI 色在 CLI 生态里是**语义色而非装饰色**——`git diff`、`ls`、`grep`、`npm` 都靠红=错误 / 删除、绿=成功 / 新增、黄=警告、蓝=信息来传达状态。主题作者若把"红"改蓝，diff 增删将无法区分。开发文档须写明"改 hue 可以，但保持语义对应关系"。（实现注：别名目前无 UI 消费者，属**给主题作者的契约命名**，由 `tests/theme-tokens` 断言其与 `--term-ansi-*` 的映射关系。）

终端 `extendedAnsi`（v2 处置，0-C 已执行废弃）：`useShellTerminal.ts` 原先硬编码的 16 个 `extendedAnsi` 值**已删除**，不再由 `--term-ansi-bright-*` 推导——那 16 个槽位是 256 色 6×6×6 立方体的**前 16 项**（`ansi[16..31]`），覆盖它们会破坏立方体而非定义第二套 ANSI 梯度。删除后这些槽位交回 xterm 的标准立方体。**这是本片唯一有意的渲染变更**，详见 §6 阶段 0 之 0-C 记录。

编辑器：`--editor-background` `--editor-gutter-bg` `--editor-toolbar-bg` `--editor-toolbar-border` `--editor-toolbar-fg` `--editor-diff-add` `--editor-diff-add-strong` `--editor-diff-del` `--editor-diff-del-strong`

兼容档位（0-E1 已落地，13 个）：`--n-gray-50..950` + `--n-white` + `--n-black`，全部 `var(--palette-*)`。这是 **A1 保值层**——**唯一一类不承载语义、只承载"原 Tailwind 档位"的令牌**（见 §5.7 v4）。Tailwind 侧以 `n-gray` / `n-white` / `n-black` 三个键注册，类名为 `bg-n-gray-100`。**`--n-*` 是永久契约面（2026-09-26 拍板，见 §5.7）**：1520 处消费者＋已进用户主题白名单意味着依赖只增不减，"改名后整层删除"是破坏性变更、已排除——改名轮若立项，本层作为改名后的**保留层**继续存在。两个极值直接复用既有 `--palette-white` / `--palette-black`，不另造同值令牌（避免死令牌）。

图表（0-F1 已落地）：`--graph-lane-1..10`（L1 对应 `--palette-graph-1..10`，10 个色值即改造前 `commitGraph.ts` 的 hex 数组，**只在 `:root` 声明**——明暗共用）。消费形态与其它令牌不同：lane ≤ 10 时 `laneColor` 返回**完整颜色表达式** `hsl(var(--graph-lane-N))`（SVG `stroke` / `fill` 与内联 `style` 直接吃），`laneTint` 给 `hsl(var(--graph-lane-N) / calc(34 / 255))`；lane ≥ 11 走 **§5.12 的参数化回退**（**v4 订正：2-J 已引入**，2026-09-26，原文「未引入」是 0-F1 时点的快照）——`--graph-lane-base-hue` / `--graph-lane-hue-step`（出厂默认 `315.3` / `95.1`），由 `commitGraph.ts:30` 生成 `hsl(calc(var(--graph-lane-base-hue) + var(--graph-lane-hue-step) * lane) 70% 55%)`（0 基索引；`laneTint` 再带 ` / calc(34 / 255)`），**前 10 条 lane 的显式令牌路径逐位不变**；两个参数已进选项 A 白名单（`number`，允许小数）。详见该节 v3

状态色（v2 新增，**v3 标注引入时机**）：`--status-success` `--status-warning` `--status-error` `--status-info`——**阶段 0 不引入**。其定义必须与"状态色 `dark:` 类的替换"捆绑为同一个后续片：替换完成前定义它只会产出**无消费者的死令牌**（保留 `dark:` 的组件不读令牌，覆盖 `--status-error` 无任何效果），正是 DSH 在 L1 上指出的同一类覆辙。替换完成前，主题开发文档须写明"状态色暂不受主题控制"。

---

## 附录 B：解包取证索引

**WorkBuddy**（`/Applications/WorkBuddy.app/Contents/Resources/app.asar`，298MB；asar header 位于偏移 16，数据区 = 16 + headerSize）

| 内容 | 位置 |
|---|---|
| 特性开关 `EnableAppearance` | `main/common.js:1722-1726` |
| 资源模型 / 校验 / DTO 映射 | `main/daemon-bootstrap.js:773-1010` |
| zip 下载 / 解压 / URL 重写 / 缓存 | `main/daemon-bootstrap.js:1010-1260`（`skin.css`、`local-file://`、`ALLOWED_ASSET_EXTS`、20MB/500 条上限） |
| 令牌定义（palette + semantic，light/dark） | `renderer/assets/safe-delete-events-Cb4BnJzK.css:1690-2250` |
| dark 选择器集合 | `renderer/assets/esm-pzWMy03t.css`、`automation-panel-TLOWWMiC.css`（`data-theme="dark"` / `.vscode-dark` / `.cb-dark`） |
| 运行时宿主 / skin manager | `renderer/assets/*`（`appearance-runtime-host.tsx`、`applyCachedCssSync`、catalog 重试退避） |
| 真实皮肤包 | `~/.workbuddy/appearance-resources/theme-tkhlwz-*/skin.css`、`theme-tkmw7j-*/skin.css` |

**Codex CLI**（`@openai/codex@0.155.1`；二进制 `…/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex`，229MB）

| 内容 | 证据 |
|---|---|
| 主题目录 | 字符串 `$CODEX_HOME/themes/` |
| 主题格式 | `.tmTheme`（Sublime/TextMate），依赖 `syntect-5.3.0` + `two-face-0.5.1` |
| 主题模块 | `tui/src/theme/mod.rs` |
| 失败回落文案 | `Theme "X" not found. Using the default theme.` / `invalid .tmTheme format` / `not recognized; using default theme` |
| 内置主题名 | Catppuccin（4 变体）、Dracula、Monokai Extended（4 变体）、Nord、Solarized（dark/light）、base16-ocean/eighties/mocha、gruvbox、OneHalf、TwoDark、Sublime Snazzy、InspiredGitHub、1337、Zenburn 等 |

---

## 审阅批注

### Claude

> [!CAUTION]
> 严重风险：换肤契约面被系统性低估——Tailwind 具名色原子类是 §1.3 / §5.7 / 阶段 0 审计与验收的盲区，数量约为 66 处 `rgb()/rgba()` 的 50 倍。实测 `src/**/*.tsx|ts` 中 `bg-slate-800`、`text-zinc-400`、`prose-pre:bg-gray-900` 这类具名色原子类共 **3240 处**（中性色系 1504 处、彩色系 1731 处、其中带 `dark:` 前缀 1127 处；集中分布：`fileIcons.ts` 160、`AskUserQuestionPanel.tsx` 137、`PermissionsContent.tsx` 122、`TaskDetailModal.tsx` 98 等）。这些类不经过任何令牌：无 `dark:` 的在任何主题下都固定不变；有 `dark:` 的只随明暗翻转、不随主题变化。而 §5.7 与阶段 0 的 grep 验收只匹配字面色值（`#hex`、`rgb()/hsl()`），**一行都匹配不到它们**。后果：按当前清单完成阶段 0 后切主题，任务面板、权限页、问答面板等大面积 UI 停留在原配色——"主题生效一半"的破碎观感恰是 §1.2 批评现状的问题原样复现，"新增主题=加一个文件"的承诺对这部分 UI 不成立。建议：(a) 验收命令增加具名色匹配（如 `grep -rnoE '(bg|text|border|ring|stroke|fill|from|to|via|decoration|placeholder|prose-[a-z:-]*)-(slate|gray|zinc|neutral|stone|black|white)(-[0-9]{2,3})?(/[0-9]{1,3})?' src --include='*.tsx'`）；(b) 按语义二分处置——状态色、文件类型图标色（`fileIcons.ts`）、品牌色可显式豁免并注释理由，中性色系的背景/文字/边框应纳入阶段 0 收口清单或逐处标注例外；(c) 据此重估阶段 0 工作量与 §1.3"绝大部分 UI 自动跟随"的表述。文档点名的文件自身就是实例：`CodeEditorSurface.tsx:62-63` 的 `bg-white dark:bg-gray-900`、`prose-pre:bg-gray-900` 目前不在 §5.7 该文件条目的收口范围内。

> [!WARNING]
> 潜在风险：§5.7"CodeMirror 用 `EditorView.theme()` 基于令牌自建明暗两套，替换第三方 oneDark"只覆盖了一半问题。`@codemirror/theme-one-dark` 的 oneDark 同时提供 UI 主题与语法高亮两部分；`EditorView.theme()` 只生成背景/光标/选区/行号等 UI 面 CSS，代码 token 颜色（keyword/string/comment…）必须另用 `HighlightStyle.define()` 定义。照当前表述实施，替换后会出现"新背景 + oneDark 残留或缺失的语法色"（现状 `CodeEditorSurface.tsx:76` light 分支传 `undefined` 依赖默认浅色，也说明语法色从未被显式管理）。建议 §5.7 该行明确两个 API 都要建，且编辑器语法色与 chat 侧 Prism 路径共用同一套语义令牌，避免出现第二套平行命名。

> [!WARNING]
> 潜在风险：`--cc-syntax-N` 目前不是稳定契约，§5.9 将其提升为"全局唯一语法高亮路径"前必须先解决命名稳定性。实现在 `src/shared/syntaxTheme.ts:33-75`：编号由"遍历 selector×property 时遇到差异的先后顺序"决定，`--cc-syntax-3` 的含义完全取决于两个源 Prism 主题的内容——源主题增删任一差异属性，其后编号整体重排。用户主题作者无从针对"关键字色"写覆盖，写了也会随编译漂移失效。建议：升级为契约面前把编号改为从 selector+property 推导的语义名（如 `--cc-syntax-keyword-color`），或至少固化映射表并导出常量，供选项 A 的令牌白名单校验与主题作者文档使用。

> [!WARNING]
> 潜在风险：§5.6 对用户主题的"首帧防闪烁"实际无解。用户主题走运行期 `<link rel="stylesheet">`，首帧必然先按 base 渲染、CSS 到达后再闪变，与"保持 ThemeContext 同步首帧性质"的要求自相矛盾。附录 B 已取证 WorkBuddy 的 `applyCachedCssSync`（缓存上次皮肤 CSS、启动时同步注入）正是解此问题的机制，但正文未借鉴。建议 §5.6 补充：首次加载成功后将用户主题内容（或编译后的令牌 JSON）缓存至 localStorage，下次启动同步注入 `<style>`，后台再校验目录中的更新，校验失败回落默认并告警。

> [!TIP]
> 建议：xterm 是 JS 对象消费者，§5.7"抽 --term-*，xterm theme 从 CSS 变量读取"需展开为实现契约——CSS 变量变化不触发任何事件，且 xterm 的 ITheme 不支持 `var()`，主题切换后必须主动 `getComputedStyle` 重读 `--term-*` 并重设 `terminal.options.theme`。建议把该刷新机制写进 §5.6 生效链路，与 CodeMirror 扩展刷新并列说明。Git 图无此问题：`CommitGraphStrip.tsx` 是 SVG，`stroke` 可直接写 `var(--graph-lane-N)`，令牌化可行、无需刷新。

> [!TIP]
> 建议：显式利用 `@layer base` 的现成优先级保障。现状 `:root`/`.dark` 全部位于 `@layer base` 内（`index.css:45-141`），layered 样式天然低于任何 unlayered 样式——主题覆盖层只要写成普通 CSS（**严禁放进任何 @layer**），`[data-theme="x"]` 就稳定压过 base，完全不依赖 CSS 文件加载顺序，并顺带消解 §7 中"data-theme 与 dark: 原子类叠加优先级困惑"的一半。建议在 §5.2 把这一约束写明，它是双轨方案成立的关键前提而非可选优化。

> [!TIP]
> 建议：`mobileTerminalSelection.ts` 属于本项目移动端高发区，收口需专项回归。实测该文件 179-228 行共 **8 处**硬编码（179/180/181/197/198/200/228），多于 §1.2 #7 记录的 4 处；它是移动端长按选择菜单的运行时注入样式，改令牌后需在 iOS Safari 实机/模拟器验证长按菜单、选区手柄与滚动行为。

> [!TIP]
> 建议：跨设备同步 themeId 的边界场景应进阶段 2 验收：偏好镜像会把 themeId 同步到未安装该主题文件的设备，届时应显式提示"此设备缺少该主题，已回落默认"而非静默回落。另外注意现状怪癖：`setTheme('system')` 不写偏好（`ThemeContext.tsx:116-120`，仅 light/dark 才 `writeUserPreference`），新增 themeId 键时需决定 system 分支是否同样豁免，避免把本机临时态覆盖成跨设备永久态。

> [!NOTE]
> 补充说明：若干引用细节修正（均不改变结论）：① `editorStyles.ts` 的色值三元实为 13 处（§1.2 #4 记 7 处）；② §5.7 Git 图条目应补 `CommitHistoryItem.tsx:72` 的 `#0ea5e9` fallback 硬编码；③ Markdown.tsx 实际路径为 `src/modules/chat/transcript/Markdown.tsx`；④ 现有令牌值格式不止 HSL 三元组，还有 `44 22% 96% / 0.7`（HSL+alpha，`--nav-*`）与 `calc()/env()`（尺寸类），选项 A 的校验器需按令牌白名单逐一定制值格式规则，不能按单一格式校验。语法高亮已有测试护栏（`syntaxHighlightTheme.test.ts`、`markdownSyntaxThemeInjection.test.tsx`），是阶段 0 的现成验收资产，建议保留并扩展。

> [!NOTE]
> 补充说明：对 §8 待确认问题的审阅意见——§8.3：建议终端默认保持恒深色（把 `--term-*` 的 light 值就设为现用深色板），浅色终端作为主题覆盖能力实现，不内置翻转；§8.4：建议把"默认明/默认暗"建模为两套内置主题并保留三选一胶囊，使"主题"与"明暗"正交，避免双层选择器的 UI 心智负担；§8.5：同意品牌色与 Logo 保留硬编码，建议在 `index.css` 顶部集中注释声明豁免清单；§8.6：同意只留扩展点——`ThemeManifest.source` 当前已是可扩展字符串枚举，未来加 `'remote'` 值即可，成本近零。

### DSH · `3579500d-…`

> [!WARNING]
> 潜在风险：**§3 的"生态复用"卖点与 §5 的交付格式脱节**。§3.3 表格把"直接吃现成主题库（.tmTheme）"列为 Codex 式模型的核心理由，但 §5.5 推荐的两个用户主题格式——令牌 JSON（A）与原始 CSS（B）——**都不是 .tmTheme**：用户拿到 Dracula / Nord / Catppuccin 官方 `.tmTheme` 文件时，A/B 均无法直接使用，"文件放进目录即生效"的承诺对生态内现成主题不成立。建议：(a) 把 `.tmTheme` 作为选项 B 的官方变体（B2）写入 §5.5——tmTheme 是 plist 结构的 XML，可服务端预编译为 §5.5 的令牌 JSON 或直接经轻量解析转 CSS 变量，解析成本可控，且与本方案"把第三方主题编译成变量"的既有思路（`syntaxHighlightTheme.ts`）同构；(b) 若不做 B2，则 §3.3 该行应降级表述为"内置主题由编译产生、用户主题吃自家格式"，避免方案自相矛盾。

> [!WARNING]
> 潜在风险：**用户主题"加载成功但破坏 UI"没有任何恢复路径**。§5.6 与 §5.8 只覆盖"加载失败 → 回落默认 + 告警"，但选项 B 的原始 CSS 完全可能成功加载却把界面搞坏——`body{display:none}`、设置面板文字 `font-size:0`、`visibility:hidden` 之类，此时用户连切回默认主题的入口都看不到（Codex/WorkBuddy 的回落只针对"文件缺失 / 格式非法"，不针对"内容有害"）。建议增加强制恢复通道：内置快捷键 / 启动参数 / `?theme=default` 查询参数三者任一即可；或启动自愈哨兵——注入主题 CSS 后若 300ms 内 `<html>` 上未出现主题预设的哨兵类则判定异常、自动回落。顺带说明：选项 A（令牌 JSON）因只能写白名单令牌而天然免疫此问题，这一点应作为 A 的卖点在设置页"高级模式"开关处明示。

> [!NOTE]
> 补充说明：**L1 palette 层目前没有任何消费者，"覆盖 L1 即可换肤"（§5.1 关键性质）在现状下不成立**。附录 A 新增 `--palette-*`，但现有 L2 全是直接写的终值（`--background: 44 22% 96%`），L1 定义后无人引用——覆盖 `--palette-brand-8` 不会改变任何 UI，除非把 L2 定义改为引用 L1（HSL 通道拆分，如 `--primary: 175 84% var(--palette-brand-light-4)`）。这实质上是比"补一层"大得多的重构，且 §4 非目标明确"不改变现有令牌的语义命名"，两者需要对齐。建议二选一明确写入方案：要么定义 L1→L2 的引用规则并评估其对 44 个现有令牌的重写量；要么把 L1 定位为"可选约定层"，并澄清"主题只需覆盖 L1 或 L2"实际只有 L2 生效、L1 仅供内置主题内部组织用。

> [!TIP]
> 建议：**显式设置 `color-scheme`，原生控件随主题自动跟随，§1.2 #8 的 66 处补偿可能大幅缩减**。文档只在 §5.7 说"评估暗色补偿是否仍必要"，但没给机制——`color-scheme: dark|light`（随 `appearance` 设置在 `<html>` 上）会让浏览器原生滚动条、checkbox/radio、`<input>`、`<textarea>` 及 `::placeholder` 的默认渲染自动跟随，`index.css:382-592` 的滚动条/表单件/placeholder 暗色补偿很可能因此成批可删（现状这些补偿正是手写模拟 `color-scheme` 的行为）。建议在阶段 0 收口时把"先加 `color-scheme`、再重审 66 处是否保留"作为执行顺序写进 §5.7，避免先令牌化一堆本可删除的补偿。

> [!TIP]
> 建议：**用户主题 URL 需带版本参数，且服务端可复用 plugins 模块的静态资源路由模式**。`<link href="/api/themes/<id>.css">` 若无 `?v=` 参数，浏览器（尤其本地 HTTP 服务 + 可能的缓存层）会缓存旧文件，用户改了 `~/.cloudcli/themes/` 里的文件、刷新后却看不到变化——与阶段 2 验收"刷新后主题出现在选择器中并可生效"冲突。建议服务端目录枚举时返回每文件 mtime（或内容 hash），前端拼 `?v=<mtime>` 实现缓存失效。另外本仓库 `server/modules/plugins/plugins.routes.ts:26` 已有 `/:name/assets/*` + `resolveAsset`（路径安全 + 扩展名约束）的现成静态提供模式，阶段 2 的 `/api/themes/` 直接复用该模式即可，不必新写一套目录遍历与校验逻辑。

> [!NOTE]
> 补充说明：**主题 id 的 sanitize 规则需要补两类约束**。① 保留名冲突：用户文件 sanitize 出的 id 可能与内置 id（如 `cc-ocean`）相同，按 §5.4 优先级会静默遮蔽内置主题——建议内置 id 固定 `cc-` 前缀、用户主题强制 `user-` 前缀（或枚举时去重并告警）；② `data-theme` 值会被写进属性选择器 `[data-theme="…"]`，sanitize 若只允许 `[a-zA-Z0-9._-]`（§5.8）尚安全，但若未来放宽需排除 `]`、引号、空格等会破坏选择器语法或造成注入的字符。另：`useShellTerminal.ts:36-75` 的 xterm theme 实际含 **16 个 `extendedAnsi` 值**（共 38 处 hex），附录 A 的 `--term-ansi-*` / `--term-ansi-bright-*`（16 值）未覆盖它——需决定 extendedAnsi 是收口为令牌还是明确废弃（由 bright 推导），否则 §5.7 该条目会漏掉半块 ANSI 板。

> [!NOTE]
> 补充说明：**§4 目标 2 与目标 3 存在张力，建议精确定义"全站一致"**。只覆盖 `--primary` 的增量主题不会动终端/编辑器/Git 图——"只改 3 个变量得到换强调色主题"（目标 2）与"主题切换后全站一致"（目标 3）在字面上矛盾。建议把"一致"定义为**结构性一致**（所有渲染面都从令牌取色、无硬编码旁路），而非**内容性一致**（每个主题都覆盖所有面），并在主题选择器上给每套主题标注覆盖范围（如 badge：仅强调色 / 完整），避免用户对增量主题的预期错位。

> [!TIP]
> 建议：**把"令牌契约面"做成自动化测试，而不是只靠 grep 验收**。阶段 0/1 验收目前依赖 §5.7 的 grep 命令 + 人工检查，但 grep 只能证明"没有字面色值"，证明不了"每套主题的 L2 全集都可解析、双分支都有值"（`CSS.supports('color', 'hsl(0 0% 8% / 0.7)')` 这类格式校验）。建议新增一组契约测试：遍历内置主题 CSS，断言 §5.9 定义的 L2 令牌全集（44 + 新增）在 `:root` 与 `.dark` 分支、以及每套 `[data-theme]` 覆盖层中取值非空且可解析；阶段 1 的"切换主题后终端/编辑器/Git 图同时变化"改为按主题截图或 `getComputedStyle` 断言（terminal.options.theme 重读后的值）的快照测试。这也直接缓解 §7"令牌契约面覆盖不全"——测试跑一遍比人眼扫一遍可靠。

> [!NOTE]
> 补充说明：**`meta theme-color` / iOS status-bar 的取值链没有闭环**。§5.9 说 theme-color "改为读 `--background` 或主题元数据"，但 `--background` 是 HSL 三元组（`44 22% 96%`），`meta[content]` 只接受 hex/rgb；且 `ThemeContext.tsx:77-93` 同时硬编码了 iOS `apple-mobile-web-app-status-bar-style`（`black-translucent` / `default`），这是按明暗二值写的，主题化后必须改为由 `appearance` 驱动。建议：(a) 定义统一解析函数（HSL→hex、alpha 与背景合并）并注明 `ThemeContext.tsx` 两处 meta 更新点都要改；(b) 允许 `ThemeManifest` 可选携带 `themeColor` / `statusBar` 覆盖字段，避免解析误差；(c) 阶段 1 验收补一条"切换 system 主题 + 系统明暗变化时，theme-color 与 status-bar 同步更新"。

### Pi

> [!CAUTION]
> 严重风险：**阶段 0 "视觉零变化"的验收缺少可量化手段，纯人工肉眼回归几乎必然漏判**。阶段 0 是纯重构——补 palette 层、抽终端/编辑器/Git 图令牌、收口 66 处暗色补偿——文档承诺"现有 light/dark 视觉零变化"，但验收标准里只有 `npm run test:client` / `build` / `typecheck` / `lint` 全绿 + grep 收敛。这些都能通过的情况下，单个色值的 alpha 通道偏移 5%、终端光标色从 `#AEAFAD` 写成 `#ADAFAD`、滚动条宽了 1px，**没有任何自动化手段能发现**。而终端/编辑器/滚动条/表单件这些恰好是交互密集、视觉敏感的区域。建议：阶段 0 开工前先引入一套轻量视觉回归工具（如 Playwright 截图 + `pixelmatch` 对比，或直接 `storybook` + `chromatic` 模式），对关键页面（聊天页 / 设置页 / 终端页 / 编辑器 diff / Git 图 / 权限面板）在 light 和 dark 下各拍一张基线图，重构后逐像素比对，差值阈值设为 0。这不是过度设计——"零变化"本身就是定量承诺，理应定量验收。

> [!WARNING]
> 潜在风险：**`dark:` 前缀的 Tailwind 原子类是"暗色模式硬编码"，与主题系统存在结构性冲突，且和 Claude 指出的具名色问题不是同一维度**。具名色（`bg-gray-900`）是色值硬编码，`dark:bg-gray-800` 则是**明暗规则硬编码**——它在编译期就确定了"暗色模式下用哪个色"，主题系统运行时改令牌完全影响不到这些类。后果：一套深色主题如果想让卡片背景从 gray-800 换成 slate-900，`dark:bg-gray-800` 的组件会全部留在原地，主题覆盖面被打穿。这比具名色更难修——具名色还能靠"替换为 bg-card + 令牌"来收口，`dark:` 前缀的存在意味着组件对"暗色模式下长什么样"有自己的主张，不接受主题接管。建议：阶段 0 的具名色收口需同时评估 `dark:` 前缀的处置策略——要么组件层面消除 `dark:` 类、全部走语义令牌（让令牌自身带明暗分支），要么明确声明 `dark:` 类是"主题的暗底保证"、主题覆盖层必须同时覆盖 `.dark` 选择器下的具名色映射，并把这条写入主题契约文档的限制章节。

> [!WARNING]
> 潜在风险：**主题的可访问性（a11y）完全没有进入方案视野**。文档通篇讨论视觉自由度与工程收口，但没有任何 WCAG 对比度约束或焦点可见性保障。用户主题（尤其选项 B 原始 CSS）可以轻易写出：(a) 正文对比度低于 4.5:1（小号文字的 WCAG AA 底线）；(b) `--ring` 与 `--background` 对比度不足，键盘用户完全看不见焦点在哪；(c) 用颜色 alone 传达状态（如 diff 的 add/del 只有色差异、无形状/符号辅助），色盲用户无法区分。建议在方案中补一个 a11y 小节：(1) 内置主题需过 WCAG AA 对比度校验；(2) 选项 A 的令牌白名单校验器可附带对比度警告（非阻断，仅提示）；(3) 明确 `--ring` 必须与 `--background` 拉开至少 3:1 对比度，作为主题契约的硬性条款；(4) Git 图 lane 色、diff 增删色等状态指示，主题可换色但不能去掉非颜色标识（如图标、符号、纹理）。

> [!TIP]
> 建议：**终端 16 色 ANSI 板要补充语义命名，否则主题作者会误用**。附录 A 只列了 `--term-ansi-red` / `--term-ansi-green` 等纯颜色名，但在 CLI 生态里这些颜色是有约定语义的：红=错误/危险、绿=成功/通过、黄=警告/注意、蓝=信息/链接、洋红=强调/调试、青=路径/代码。很多终端程序（ls、git、grep、diff、npm 输出）依赖这套语义来传达状态。如果主题作者把"红色"改成了蓝色，`git diff --color` 的删除行会变成蓝色、新增行也是蓝色，用户完全分不清。建议：在 `--term-ansi-*` 旁边加一组语义别名（如 `--term-error` / `--term-success` / `--term-warning` / `--term-info`），或至少在主题开发文档里明确写"ANSI 色是语义色，不是装饰色，改 hue 可以但要保持语义对应关系"。另外 extendedAnsi（DSH 已指出 16 个值）建议明确废弃、由 bright 系列推导，避免 24 个变量让主题作者无所适从。

> [!TIP]
> 建议：**设置页内藏一个"令牌预览页"，既是调试工具也是契约可视化**。展示所有 L2 令牌的当前值、明暗对比色块、以及在哪些组件中被引用（可从构建期的令牌使用统计生成）。价值有三：(a) 主题作者调颜色时不用在整个应用里到处找效果；(b) 契约测试的可视化载体，"令牌是否全、值是否合法"一眼可见；(c) 对用户是透明度——"你的主题改了哪些地方"有明确清单。实现成本不高：读 `getComputedStyle(document.documentElement)` 过滤出 `--` 开头的变量，按命名空间分组渲染即可。建议作为阶段 1 的随附功能，不是核心路径但能显著降低后续维护成本。

> [!TIP]
> 建议：**Git 图 lane 色避免数量天花板，用 fallback 或 HSL 旋转动态扩展**。`--graph-lane-1..10` 假设 lane 最多 10 条，但活跃分支多的仓库很容易超（monorepo 场景尤甚）。一旦超了，要么继续硬编码加变量（没完没了），要么 fallback 到固定色（视觉跳跃）。更优雅的做法：定义 `--graph-lane-base-hue` / `--graph-lane-hue-step` 两个令牌，第 N 条 lane 的颜色由 `hsl(calc(var(--graph-lane-base-hue) + var(--graph-lane-hue-step) * (N - 1)), 70%, 55%)` 动态生成；主题只需覆盖这两个参数就能控制整张图的色系，且数量无上限。前提是用 `@property` 注册 hue 为 `<number>` 以便 CSS calc，或在 JS 侧的 `commitGraph.ts` 里做计算。比硬编码 10 个变量更灵活，主题作者也好理解。

> [!NOTE]
> 补充说明：**对 §8.1 用户主题格式的默认选项建议翻转**。文档推荐默认用令牌 JSON（A）、高级模式切原始 CSS（B），但 cloudcli 的核心用户群是开发者——写 CSS 对他们是零门槛，而令牌 JSON 需要先查白名单、理解 HSL 三元组格式、不能用浏览器 DevTools 实时调，反而学习成本更高。选项 A 的核心价值是"安全"（不会破坏布局），但安全是对"不信任的第三方主题"而言的。用户自己写的主题、或从信任来源拷的 CSS，安全性不是首要诉求，便利性才是。建议：默认展示 CSS 编辑器（带语法高亮 + 实时预览），令牌 JSON 作为"安全模式/简单模式"可切换；设置页在切换到 CSS 模式时弹一次风险确认即可。这也和 Codex "文件放进去就生效"的直觉更一致。

> [!NOTE]
> 补充说明：**`ThemeManifest` 建议预留两个可扩展字段，成本近零但避免未来打破契约**。(1) `coverage?: 'accent' | 'full'`——标注主题是只改强调色还是完整覆盖，在主题选择器上显示对应 badge，直接缓解 DSH 指出的"目标 2 与 3 张力"问题；(2) `supportsAccentOverride?: boolean`——声明主题是否允许用户在其基础上再自定义强调色（类似 macOS 的"强调色"设置），为未来"主题 + 个人强调色"双层定制留口子。两个字段都是可选、有默认值，不影响现有方案，但避免了未来加字段时旧主题元数据的兼容处理。

---

## Pi 对 §8 待确认项的拍板

### §8.2 主题目录与 Docker 挂卷

**结论：采用 `~/.cloudcli/themes/`，Docker 场景做文档标注，不做特殊适配。**

理由：
- 本仓库 `docker/` 下只有 `claude-code`、`codex` 两个构建环境 Dockerfile，没有应用主 Dockerfile，也没有 docker-compose，README 未提 docker 部署——**Docker 不是主要分发形态**，为它设计额外目录结构属于过度设计。
- `~/.cloudcli/themes/` 对齐 Codex 的 `$CODEX_HOME/themes/` 惯例，开发者直觉一致。
- Docker 用户挂载卷是常规操作，只需在文档里加一行"若使用 Docker 部署，将 `/root/.cloudcli/themes/` 挂载到宿主机目录"即可，无需代码改动。
- 未来若推出一键部署镜像，再考虑 `/data/themes/` 之类的标准化路径不迟，当前不做预设。

### §8.7 阶段 0 拆分口径：一次性收口 vs 按模块分片 + 豁免

**结论：按模块分片 + 豁免清单，每片独立可回滚。严禁一次性大改。**

理由：
- 阶段 0 承诺"视觉零变化"，改动面越大、验证越难，出问题越难定位。一次性收口等于把所有风险压在一次 PR 里，回滚成本极高。
- 分片建议（按依赖顺序）：
  1. **palette 层 + L2 引用改写**：纯 CSS 改动，不碰 JS，最容易验证。
  2. **语法高亮路径统一**：把 `MarkdownCodeBlock.tsx` 从直连 Prism 主题切到 `--cc-syntax-*`，已有测试护栏（`syntaxHighlightTheme.test.ts`、`markdownSyntaxThemeInjection.test.tsx`）。
  3. **终端（xterm）令牌化**：独立模块，改动集中在 `useShellTerminal.ts`，可单独测。
  4. **编辑器（CodeMirror）令牌化**：UI 主题 + 语法高亮两套，改动较深，单独一片方便回滚。
  5. **Git 图 + 其他零散硬编码**：体量小，最后收尾。
  6. **index.css 后半段 66 处暗色补偿**：等 `color-scheme` 先上，再决定哪些可删、哪些需令牌化。
- 每片的验收标准：该模块视觉零变化 + 该模块的 grep 命中清零（品牌豁免除外）+ 截图对比通过。
- **豁免清单**必须显式维护（建议放 `src/index.css` 顶部注释），包括：agent 品牌色、各 harness Logo、文件图标色（`fileIcons.ts`）、状态色（成功/错误/警告的语义色值）。

### §8.8 `dark:` 前缀（529 处中性色具名色）：全消除 vs 暗底保证

**结论：不追求全消除。按语义分类处置，目标是"主题关键路径不受 dark: 硬编码阻挡"，不是零 dark:。**

数据核实：`dark:` 前缀总数 **1303 处**，其中中性色具名色相关约 **529 处**，其余为彩色系（状态色、品牌色、文件图标色等）。

处置策略分三类：

| 类别 | 举例 | 处置 | 占比（估） |
|---|---|---|---|
| **语义背景/文字/边框** | `bg-gray-50 dark:bg-gray-900`、`text-gray-700 dark:text-gray-300`、`border-gray-200 dark:border-gray-800` | **替换为令牌类**（`bg-card`、`text-muted-foreground`、`border-border`），由令牌的 light/dark 分支接管 | ~200 处 |
| **状态色（成功/错误/警告/信息）** | `bg-green-500 dark:bg-green-600`、`text-red-500 dark:text-red-400` | **保留 dark:，作为主题暗底保证**。新增 `--status-success` / `--status-error` / `--status-warning` / `--status-info` 令牌，dark: 类可逐步替换但不是阶段 0 必须 | ~300 处 |
| **品牌色 / 文件图标色 / 装饰色** | Agent 品牌色、`fileIcons.ts`、渐变色 | **明确豁免**，写入豁免清单，主题不覆盖 | ~1000 处 |

理由：
- 1303 处全改工作量巨大，且大部分是状态色和品牌色，本来就不该随主题变——为了"零 dark:"而改是为手段而手段。
- 第一类（语义背景/文字）是主题能否"换肤"的关键路径，约 200 处，工作量可控，改完主题就已经能覆盖 80% 以上的视觉面。
- 状态色建议新增独立令牌（`--status-*`），主题可选择性覆盖，但默认保持现有语义色，这是"主题一致性"与"状态可识别性"的平衡。

### §8.9 `--cc-syntax-N` 是否本轮升语义名

**结论：本轮不升。做两件轻量事情把风险挡住即可，等阶段 2 用户主题上线前再升。**

理由：
- `--cc-syntax-N` 当前的消费者只有 **4 个文件**，全在 chat 模块内，且都是内部实现——编号不稳定对外界零影响。
- 升语义名需要梳理所有 selector×property 组合（keyword / string / comment / function / number... 至少十几个），还要决定命名粒度（是 `--syntax-keyword-color` 还是 `--syntax-keyword` 一个对象式？要不要分 font-weight？），设计成本不低。
- 更关键的是：**编辑器语法高亮如果也要共用同一套令牌，命名必须同时覆盖 Prism 和 CodeMirror 两套 token 体系**，这件事应该和 §5.7 编辑器令牌化一起做，而不是现在孤立地给 chat 侧改名。
- 本轮先做两件事挡风险：
  1. 在 `buildSyntaxTheme()` 旁边导出一个 `SYNTAX_TOKEN_MAP` 常量（`{ keywordColor: 3, commentColor: 5, ... }`），把编号和语义绑定一次。内部代码如果需要引用具体语义，走这个常量而不是手写 `--cc-syntax-3`。
  2. 在 CSS 注释里明确标注 "`--cc-syntax-N` 是内部实现，不保证编号稳定，主题作者请勿直接覆盖"。
- 升级时机：阶段 2 做用户主题（选项 A 令牌白名单）时，语法令牌必然要进入白名单，那时再统一升语义名、同时覆盖 Prism 和 CodeMirror 两条路径，一次到位。

---

## DSH 对 §8 待确认项的拍板

### §8.2 主题目录与 Docker 挂卷

**结论：采用 `~/.cloudcli/themes/`，Docker 仅文档标注、不做代码适配；但目录解析必须收敛到服务端现成的 home 解析方式，不许新写第二套路径逻辑。**

- 同意 Pi：实测 `docker/` 下只有 `claude-code` / `codex` / `shared` 构建环境与 README，无应用 Dockerfile、无 compose——Docker 不是分发形态，为它设计 `/data/themes/` 属过度设计。
- 补强（实施约束）：`~/.cloudcli` 本就是服务器所有持久化的既有约定（auth.db、`assets/`、`local-server.json`，见 `server/index.ts:198/268/323` 的 `path.join(os.homedir(), '.cloudcli', ...)` 模式）。主题目录必须**复用同一解析方式**（新增一个与 assets 平行的目录常量，而不是在主题模块里另写 `~/.cloudcli/themes` 字符串拼接）。这样 Docker / systemd / 非标准 HOME 场景的挂卷点与 assets 完全一致，README 一句话即可覆盖。
- 补一条：若日后在 README 写 Docker 说明，应同时覆盖"主题目录 + assets 目录"两个挂载点，避免只挂 themes 不挂 assets 的认知偏差。

### §8.7 阶段 0 拆分口径

**结论：按模块分片 + 显式豁免清单，每片独立合入、独立验收、独立可回滚；严禁一次性大 PR。同意 Pi 的分片顺序，补强四点。**

1. **豁免清单必须是机器可校验的单一事实源**，不能只写在 `index.css` 顶部注释里——注释会漂移。建议维护一个独立清单文件（`*豁免清单*.txt` 或 TS 常量，按 `文件:行号` 或 `模式 + 理由` 记录），验收 grep 用排除该清单的方式执行（`grep -vf` 或脚本化 allowlist）；品牌色 / `fileIcons.ts` / 状态色豁免全部走它，新代码引入硬编码时先过清单。
2. **按"文件集群"切片，而非按色值类型切片**：实测 1502 处中性色分布在 **105 个文件**，热点集中（`AskUserQuestionPanel.tsx` 84、`TaskDetailModal.tsx` 72、`McpServerFormModal.tsx` 69、`TaskBoardToolbar.tsx` 60…）。每个 PR 覆盖一组同模块文件（同模块语义一致、review 上下文完整）；热点文件（>50 处）单独成片，避免单 PR 塞进 84 处替换。
3. 分片顺序的依赖依据（与 Pi 一致，补因果）：palette/L2（纯 CSS，不碰 JS）→ 语法高亮（有现成测试护栏）→ 终端 / 编辑器（改动深、独立回滚）→ Git 图 / 零散 → 66 处暗色补偿（必须等 `color-scheme` 先上，否则会令牌化一堆本可删除的补偿）。
4. **阶段 0 的定量终点**：整仓中性色具名类从 1502 处收敛到"仅豁免清单命中"，而非"计划内的片改完就算完"；每片验收 = 该片 grep 清零 + 视觉回归基线（阈值 0）+ 契约测试通过。

### §8.8 `dark:` 前缀（529 处中性色具名色）：全消除 vs 暗底保证

**结论：同意 Pi 的三分法，但把决策表述修正为"按类别选择策略"，并给出技术依据——"① vs ②"是伪二选一。**

- 技术依据（决定策略边界，已核实）：`dark:bg-gray-800` 生成的规则形如 `.dark\:bg-gray-800:is(.dark *)`（特异性 ≥ (0,2,0)），且在元素上直接写死具体色值——CSS 变量继承与 `[data-theme="x"]` 覆盖（特异性 (0,1,0)）都压不过它。因此"策略②暗底保证"在技术上**只对主题不应控制的色**（状态色、品牌色）成立；对主题应控制的色，**不存在绕过替换的选择，只能换成语义令牌类**。真实决策是"哪些类别交给主题（必须换令牌），哪些保留 `dark:`（豁免 / 语义色）"，这正是 Pi 三分法的内容，拍板确认。
- 三分法确认：语义背景/文字/边框（约 200 处）→ 阶段 0 换令牌类，主题关键路径，必做；状态色（约 300 处）→ 保留 `dark:` + `--status-*` 令牌可选覆盖，语义色不该随主题乱变；品牌 / 文件图标 / 装饰（约 1000 处）→ 豁免清单。
- 补强（验收口径，防矫枉过正）：**验收必须区分 `dark:` + 具名色（必须收敛）与 `dark:` + 令牌类（无害，允许保留）**。`dark:bg-card` 这类 dark 变体指向令牌、没有硬编码任何色值，主题完全接管，不应计入验收命中——否则阶段 0 会为消灭无害用法白费力气。建议验收命令单独统计"dark: 具名色"（现 529 处），目标收敛到豁免清单；而不是"dark: 总数归零"（1302 处中大部分无害）。

### §8.9 `--cc-syntax-N` 是否本轮升语义名

**结论：本轮不升语义名，同意 Pi 的时机判断；但"导出常量 + 写注释"还不够，必须补一条黄金映射锁测试。**

- 事实支撑（已核实）：消费者仅 4 个文件、全在 chat 模块内部（`syntaxHighlightTheme.ts`、`Markdown.tsx` + 2 个测试），编号不稳定对外零影响；生成器对任意属性（color / fontStyle / fontWeight…）统一编号，"语义名"需覆盖 selector × property 两个维度，命名粒度本身需要设计——这正是应该 defer 的原因之一。
- 补强 1（本轮必做）：现有测试只断言 `var(--cc-syntax-\d+)` 的**形状**（`syntaxHighlightTheme.test.ts:81,100`），**没有锁住具体映射**——一旦源 Prism 主题依赖升级（oneLight/oneDark 迟早 bump）导致"遍历遇到差异的顺序"变化，编号会整体重排而测试照绿。本轮应加一条**黄金映射测试**：固化"selector×property → 编号"的完整对照（或至少固化变量总数 + 每个 selector 的变量分布），依赖升级时编号漂移则 CI 红，逼出有意的 remap 决策。这是把"编号不稳定"从静默风险变成显式变更的关键一步，成本一条测试。
- 补强 2：语义名草案现在就在文档定方向（不实现），让阶段 2 不被命名 bikeshed 卡住：以 Prism 语义类别为根（comment / string / keyword / function / number / operator / punctuation / tag / attr-name / constant…），属性维度作后缀（`-color` / `-style` / `-weight`），如 `--cc-syntax-comment-color`；编辑器 `HighlightStyle` 的 token 名向同一套 Prism 类别对齐，保证两条路径共用一套命名（呼应 §5.7 编辑器令牌化）。
- 与 §8.8 的关系：语法高亮令牌属于"主题应控制的色"，但走编译产物（变量）路径，不涉及 `dark:` 具名色问题，两件事独立、可并行推进。

## 牵头结论（第 1 轮：27 条批注汇总）

> 三方对 §8 四项待定项的拍板见紧随其后的 Pi / DSH / Claude 三节，汇总与落地见文末「牵头结论（第 2 轮）」。

**汇总（2026-09-24，三方共 27 条批注）**：采纳 22 条 / 部分采纳 5 条 / 不采纳 0 条。三条批注被判为**核心修正**并改写正文骨架：Claude #1（具名色原子类是审计盲区）、DSH #3（L1 palette 无消费者的结构空洞）、DSH #1（`.tmTheme` 与交付格式脱节）。

**验证说明**：结论中所有量化断言均已在本仓库用 `rg` 实测复核。与批注数字不一致处已在对应条目标注（`mobileTerminalSelection` 为 7 处而非 8 处；`editorStyles.ts` 为 14 处 hex / 13 处三元）。

### Claude（10 条）

| # | 批注 | 意见 | 理由 / 处置 |
|---|---|---|---|
| 1 | 具名色原子类是 §1.3 / §5.7 / 阶段 0 的审计盲区（[CAUTION]） | **采纳（核心）** | 实测确认：中性色 1502 + 彩色系 1725 ≈ **3227 处**，约为 66 处 `rgb()` 的 49 倍，且多于语义令牌类 2498 处——初稿"绝大部分 UI 自动跟随"不成立。已写入 §1.2 #10、§1.3、§4 非目标、§5.7（新增两行 + 验收命令 ②）、§6 阶段 0 范围 |
| 2 | §5.7 CodeMirror 只覆盖一半，须建 `HighlightStyle.define()`（[WARNING]） | **采纳** | 已核实 `CodeEditorSurface.tsx:4` 导入 `oneDark`（该包同时提供 UI 主题与语法高亮）。只做 `EditorView.theme()` 会残留 / 缺失语法色。已写入 §5.7 |
| 3 | `--cc-syntax-N` 编号不是稳定契约（[WARNING]） | **部分采纳** | 编号确由遍历顺序决定（`syntaxHighlightTheme.ts:29-48`，已核实）。采纳"升为契约面前先固化编号"；**语义重命名**是否本轮做列为 §8.9 待定——selector+property 未必能一一派生出简洁语义名 |
| 4 | §5.6 首帧防闪烁对用户主题无解（[WARNING]） | **采纳** | `<link>` 异步，与"同步首帧"自相矛盾。已按 WorkBuddy `applyCachedCssSync` 机制改写 §5.6（缓存同步注入 + 后台校验更新） |
| 5 | xterm 需主动重读；Git 图可直接 `var()`（[TIP]） | **采纳** | CSS 变量变化不触发事件、xterm `ITheme` 不支持 `var()`，须 `getComputedStyle` 重读后重设。已写入 §5.6 |
| 6 | 显式利用 `@layer base` 优先级保障（[TIP]） | **采纳** | 已核实 `:root` / `.dark` 位于 `@layer base`（`index.css:45`、`:143`）。已写入 §5.2 作为"双轨方案成立的硬约束" |
| 7 | `mobileTerminalSelection.ts` 8 处、属移动端高发区需专项回归（[TIP]） | **部分采纳** | 实测 **7 处**（行 179 / 180 / 181 / 197 / 198 / 200 / 228），非 8 处；但"初稿记 4 处是错的 + 需移动端专项回归"成立。已按 7 处修正 §1.2 #7、§5.7 |
| 8 | 跨设备 themeId 边界；`system` 分支不写偏好需决定（[TIP]） | **采纳** | 已核实 `setTheme` 的 `system` 分支 early return、不调 `writeUserPreference`（`ThemeContext.tsx:113-121`）。已写入 §5.6 与 §6 阶段 2 验收 |
| 9 | 引用细节修正（[NOTE]） | **采纳** | ① `editorStyles.ts` 实为 14 处 hex / 13 处三元 ✓；② `CommitHistoryItem.tsx` 的 `'#0ea5e9'` fallback ✓（路径为 `git-panel/history/`，非 `components/`）；③ `Markdown.tsx` 路径为 `chat/transcript/` ✓；④ 令牌值格式多样 ✓；⑤ 已有测试护栏 ✓ |
| 10 | 对 §8 各问题的意见（[NOTE]） | **采纳** | 8.3 恒深色 / 8.4 建模为两套内置主题 / 8.5 豁免清单注释 / 8.6 扩展点，全部采纳，见 §8 |

### DSH（9 条）

| # | 批注 | 意见 | 理由 / 处置 |
|---|---|---|---|
| 1 | §3"生态复用"与 §5 交付格式脱节，建议加 `.tmTheme` 变体（[WARNING]） | **采纳（核心）** | 这是方案自相矛盾，必须修。已新增 §5.5 选项 B2，并说明其与 `syntaxHighlightTheme.ts` 的编译思路同构 |
| 2 | 用户主题"加载成功但破坏 UI"无恢复路径（[WARNING]） | **采纳** | 已写入 §5.6 强制恢复通道（快捷键 / 启动参数 / 查询参数）+ 自愈哨兵；A 免疫作为卖点在设置页明示。**处置更新（2-D）**：三条候选中落地第 ③ 条 `?theme=default`（§5.6 v14）；自愈哨兵**未做**、`sentinelClass` 留作保留位 |
| 3 | L1 palette 无消费者，"覆盖 L1 即可换肤"在现状下不成立（[NOTE]） | **采纳（核心）** | 初稿最大技术空洞。已改写 §5.1：L1→L2 引用规则（通道拆分）+ 范围界定，并把"两步改造"写入 §6 阶段 0 |
| 4 | 显式 `color-scheme`，66 处补偿可能大幅缩减（[TIP]） | **采纳** | 已写入 §5.6，并定执行顺序"先加 `color-scheme`，再重审 66 处"，§5.7 同步 |
| 5 | URL 需版本参数；复用 plugins 静态资源路由（[TIP]） | **采纳** | 已核实 `plugins.routes.ts:26` 的 `/:name/assets/*` + `resolveAsset` 模式存在。已写入 §5.6 |
| 6 | sanitize 两类约束 + `extendedAnsi` 未覆盖（[NOTE]） | **采纳** | 已核实 `extendedAnsi` 在 `useShellTerminal.ts:59`。已写入 §5.8（`cc-` / `user-` 前缀、选择器注入字符）与附录 A（废弃 `extendedAnsi`） |
| 7 | §4 目标 2 与 3 张力，建议定义"结构性一致"（[NOTE]） | **采纳** | 已改写 §4 目标 3，并落地为 `coverage` 字段（§5.3）+ 选择器 badge |
| 8 | 把令牌契约面做成自动化测试（[TIP]） | **采纳** | 已新增 §5.11 |
| 9 | `theme-color` / iOS status-bar 取值链未闭环（[NOTE]） | **采纳** | 已核实 iOS `apple-mobile-web-app-status-bar-style` 硬编码（`ThemeContext.tsx:77-93`）。已写入 §5.9 + `ThemeManifest` 覆盖字段。**已由 1-C 实施闭环**（`1a9a7b78`）：两处 hex 删除，改由 `applyThemeChrome` 从令牌派生；实现比本条设想的更强（探针替代手写 HSL→hex），`themeColor` 取令牌名而非字面色 |

### Pi（8 条）

| # | 批注 | 意见 | 理由 / 处置 |
|---|---|---|---|
| 1 | 阶段 0"视觉零变化"缺可量化验收（[CAUTION]） | **采纳** | "零变化"是定量承诺，须定量验收。已写入 §6 阶段 0 验收（Playwright 截图比对，阈值 0） |
| 2 | `dark:` 前缀是明暗规则硬编码，与主题系统冲突（[WARNING]） | **采纳** | 实测带 `dark:` 的具名色约 529 处（含复合变体约 640 处），与 Claude #1 同源但维度不同（色值 vs 规则）。已写入 §1.2 #11、§5.7，处置策略列为 §8.8 待定（推荐策略 ①） |
| 3 | a11y 完全未进视野（[WARNING]） | **采纳** | 已新增 §5.10：AA 对比度、`--ring` ≥ 3:1 硬条款、不得仅以颜色传达状态，并纳入 §5.11 |
| 4 | ANSI 色需语义命名 + `extendedAnsi` 处置（[TIP]） | **采纳** | 已写入附录 A（`--term-error/success/warning/info`），与 DSH #6 合并处置 |
| 5 | 设置页"令牌预览页"（[TIP]） | **部分采纳** | 价值认可，但属**阶段 1 可选增值项**，不进核心验收路径。已列为 §6 阶段 1 的可选随附功能 |
| 6 | Git lane 用 HSL 旋转动态扩展（[TIP]） | **部分采纳** | 采纳"避免 10 条天花板"的目标（新增 §5.12）；但 `@property` 注册 hue 的浏览器兼容性有风险，改为**在 `commitGraph.ts` 的 JS 侧计算**，并保留 `--graph-lane-1..10` 供主题精调 |
| 7 | §8.1 建议默认翻转为原始 CSS（[NOTE]） | **部分采纳** | 与 DSH #2 的安全论证存在张力。**维持默认 A**（免疫"破坏 UI"，自托管分享 / 跨设备同步场景更需要护栏），但把 B 的入口做浅（一键开关 + 语法高亮 + 实时预览），并允许用户改"默认打开模式"。已写入 §5.5 v2 说明 |
| 8 | `ThemeManifest` 预留 `coverage` / `supportsAccentOverride`（[NOTE]） | **采纳** | 与 DSH #7 呼应。已写入 §5.3（另加 `sentinelClass` 支撑 §5.6 自愈哨兵） |

**未采纳**：无。

**部分采纳的 5 条**（Claude #3、Claude #7、Pi #5、Pi #6、Pi #7）均已给出替代方案：或降级为可选增值项、或修正数字后采纳、或以"安全优先"的理由保留初稿取向并说明。

**遗留待定（需项目所有者拍板）**：§8.2（主题目录与 Docker 挂卷）、§8.7（阶段 0 拆分口径）、§8.8（`dark:` 处置策略）、§8.9（`--cc-syntax-N` 是否本轮语义化）。

**修订说明（本次对方案做了哪些调整）**：

1. 修正三处系统性低估 / 空洞：具名色原子类规模（§1.2 #10 / #11、§1.3、§5.7）、L1→L2 引用规则（§5.1）、`.tmTheme` 生态缺口（§5.5 B2）。
2. 修正 5 处事实性引用错误：`editorStyles.ts` 13 处三元、`mobileTerminalSelection.ts` 7 处、`CommitHistoryItem.tsx` 的 `#0ea5e9`、令牌值格式多样性、`Markdown.tsx` 路径。
3. 新增 4 个章节：§5.10 a11y、§5.11 契约测试、§5.12 Git lane 数量上限、§5.5 选项 B2。
4. 强化 5 处机制：首帧缓存注入（§5.6）、`color-scheme` 与 66 处补偿的执行顺序（§5.6 / §5.7）、JS 消费者主动刷新（§5.6）、用户主题恢复通道与哨兵（§5.6）、`?v=` 缓存失效与 plugins 路由复用（§5.6）。
5. 重估 §6 阶段 0 的范围与验收方式（视觉回归 + 两条 grep + 契约测试），并提示分片拆分。
6. §8 待评审问题从 6 条更新为 9 条（4 条已决 → 待定 4 条 + 已决 5 条，其中 3 条为新增）。

**代码改动**：无。本轮只修订设计文档，等待审批结果后再进入实施。

---

## Claude 对 §8 待确认项的拍板（补充轮）

> 2026-09-25，应项目所有者要求，对 Pi / DSH 已拍的四项给出独立结论。本轮所有数字断言均已在当前工作区重新实测，与 v2 记录不一致处已标注；三方结论一致处不再重复论证，只列增量。

### §8.2 主题目录与 Docker 挂卷

**结论：采用 `~/.cloudcli/themes/`，Docker 仅文档标注、不做代码适配；路径解析必须复用 server 现有 `path.join(os.homedir(), '.cloudcli', …)` 模式（新增与 assets 平行的目录常量），严禁主题模块另写第二套拼接。与 Pi / DSH 完全一致，复核支撑采纳：**

- 已实测 `docker/` 下仅 `claude-code` / `codex` / `shared` 三个构建环境与 README，无应用 Dockerfile、无 compose——Docker 非分发形态，为其预设 `/data/themes/` 属过度设计。
- 已实测 `server/index.ts:323`（`path.join(os.homedir(), '.cloudcli', 'local-server.json')`）与 `plugins.routes.ts` 的 `/:name/assets/*` + `resolveAsset` 模式（`Content-Type` / `Cache-Control` 已齐）均存在，阶段 2 静态提供直接复用。**2-A 修正**：后半句不成立——那个 `resolveAsset` 绑在 plugins 注册表上（`getPluginDir` 只认带 `manifest.json` 的已扫描插件），且其函数体**没有**扩展名约束，故 2-A 新写了 `server/modules/themes/`；真正沿用过来的是 `Content-Type` + `Cache-Control: no-store` 与"直系子项包含检查"的写法。见 §5.6 v11 与 §5.8 v3。
- 一处补充进 README 口径的要求：**"文件主题"与"粘贴主题"是两条存储线**——前者在服务端目录（只读、随部署卷走、内容不跨设备同步），后者存用户偏好（跨设备同步内容）。二者的删除、失效、跨设备语义均不同，设置页须按 `source` 区分展示，文档写明。

### §8.7 阶段 0 拆分口径

**结论：按模块分片（文件集群为粒度）+ 机器可校验豁免清单，每片独立验收、独立合入、独立回滚，严禁一次性大 PR。同意 Pi / DSH，四处补强：**

1. **`dark:` 收敛不设独立片**。Pi 阶段 0 第 4 项"dark: 处置策略定案"的产出应限定为纸面工作（策略 + 分类清单），施工动作并入各文件集群片——`bg-gray-50 dark:bg-gray-900` 是成对结构（实测相邻成对至少 **335 处**），消灭 `dark:` 与替换具名色必须是同一个 diff（见 §8.8 修正 ①）。分片计划里不应出现独立的"dark: 片"。
2. **第一片（palette + L2 引用改写）加计算值等值断言**。该片的"视觉零变化"最难验证——`hsl(var(--x))` 包裹与 HSL 通道拆分是否等值，像素比对受反锯齿与字体渲染干扰。固定加一条：改写前后对全部 44 个令牌取 `getComputedStyle` 的 resolved value，逐位相等断言。纯 JS 断言、可逐令牌定位失败点，比截图回归更精确且更轻。
3. **每片 DoD 三件套固定化**：该片 grep 清零（对机器可校验 allowlist）+ 视觉基线比对（阈值 0）+ 计算值等值断言（palette/L2 片必做，其余片可选）。
4. DSH 四点补强（allowlist 单一事实源、文件集群切片、依赖顺序、定量终点）全部同意；§8.8 的三分法分类清单与豁免清单是**同一份资产**，一次建设、共同消费。

### §8.8 `dark:` 前缀处置

**结论：三分法（语义骨架换令牌 / 状态色后置 / 品牌豁免）成立并拍板采纳；附一处数据勘误、两处执行修正。**

**数据勘误（本轮实测钉死口径）**：`dark:` 总数 **1302** = 中性色具名 **534** + 彩色系具名 **590** + 语义令牌类仅 **6** + 其余约 172 为 `dark:` + 非色 utility（`dark:block`、`dark:prose-invert` 等结构性变体，天然无害）。**`dark:` + 具名色合计 1124 处、占 86%**——DSH"1302 中大部分无害"按字面不成立，应改为"结构性变体与令牌类（约 178 处）无害，具名色 1124 处均为硬编码、按三分法分流"。另：全项目 `dark:bg-card` 这类令牌类用法仅 6 处，说明暗色处理基本是"具名色双写"模式——第一类替换完成后这些 `dark:` 自然消失，验收口径维持 DSH 提法定：只统计 `dark:` + 具名色（本轮实测 534，v2 记 529，差 5 属口径/时点漂移，不影响结论），收敛目标 = 豁免清单命中。

**修正 ①（原子性）**：`bg-x dark:bg-y` 是成对结构，替换必须一次完成（一次换成 `bg-card` 同时消灭两半），不存在"先去 dark: 再换色"的中间态，也不允许同一文件拆两片处理。这同时约束 §8.7：dark: 处置并入文件集群片。

**修正 ②（`--status-*` 纪律）**：Pi 三分表"状态色 → 保留 dark: + 新增 --status-* 令牌"自相矛盾——保留 `dark:` 的组件不读令牌，此时覆盖 `--status-error` **没有任何效果**，主题作者以为能改、实际改了无效，这正是 DSH 在 L1 上指出的"无消费者令牌"覆辙的重演。拍板：**`--status-*` 的定义与状态色 `dark:` 类的替换捆绑为同一个后续片（可晚于阶段 0），阶段 0 不引入**；替换完成前，主题开发文档诚实写明"状态色暂不受主题控制"。附录 A 的 `--status-*` 条目应标注引入时机，防止阶段 0 实施者顺手定义出死令牌。

### §8.9 `--cc-syntax-N` 是否本轮升语义名

**结论：本轮不升语义名（同意 Pi / DSH 时机判断）；黄金映射测试采纳，实现形态定为 inline snapshot；另加一条 denylist 护栏；语义名本轮只定草案方向。**

- **黄金映射 = inline snapshot**：`buildSyntaxTheme()` 是纯函数，对输出 `{ style, css }` 直接做 inline snapshot 即固化"selector×property → 编号"全表——快照本身就是对照表、零额外维护，prism 主题依赖 bump 导致编号重排时 CI 红，且 diff 直接可读（哪个编号从 comment 变成 string 一目了然）。比手工维护对照文件更省力，可叠加"变量总数不变"断言作第一道信号。`SYNTAX_TOKEN_MAP` 常量仍建议导出（消费者出现前可仅供测试消费）。
- **denylist 护栏（本轮必做）**：收口 `MarkdownCodeBlock.tsx` 后消费者跨出 chat 模块，"内部实现"的边界开始外溢。护栏：生成器与快照之外**禁止任何文件手写 `--cc-syntax-[0-9]` 字面量**，新消费者只允许消费 `style` / `css` 产物或 `SYNTAX_TOKEN_MAP`。CI grep 检查命中即红，把"编号不稳定"从注释约定升级为机器强制。

**v4 补记（0-E1 实施后，对上面"修正 ①"的再修正）**：原拍板假设第一类可"换成 `bg-card` 同时消灭两半"，从而让 class-1 的 `dark:` 双写自然消失。**实测证伪**（理由与数据见 §5.7 v4 / 0-E 记录）：本片存在 **89 种不同的 `(light, dark)` 元组**，语义令牌类只能承载一对值，强行折叠必然改色。故 0-E 采用 **A1 保值档位**——`bg-gray-100 dark:bg-gray-700 → bg-n-gray-100 dark:bg-n-gray-700`：**成对替换的原子性不变**（一次改完两半、不设中间态），但**两半都保留**，`dark: + 具名色` 收敛为 `dark: + 令牌类`。

这对验收口径的影响：§5.7 与上面的"只统计 `dark:` + **具名色**"现在正是 A1 的收敛对象（`bg-n-gray-100` 不再被具名色 grep 命中，`dark:bg-n-gray-700` 亦不计入），**所以口径不用改，只是"具名色"的终点从"换成 `bg-card`"变成"换成 `bg-n-gray-*`"**。代价（`dark:` 双写在 class-1 内继续存在、档位跨角色耦合）已在 §5.7 v4 记账，由**阶段 2 语义化改名**一次收口——与 §8.9 对 `--cc-syntax-N` 的"本轮只加间接、阶段 2 改名"完全同构。（**后续记账，2026-09-26**：语义化改名轮未立项，见 §5.7"语义化改名（显式未做）"；本条改名决策只涉 `--cc-syntax-N`——编号仍是实现细节、白名单仍不授权——不受 `--n-*` 永久契约面拍板的影响，但仍以改名轮立项为前提。）
- **语义名草案（本轮定方向不实现，同意 DSH）**：以 Prism 语义类别为根（comment / string / keyword / function / number / operator / punctuation / tag / attr-name / constant …）、属性作后缀（`-color` / `-style` / `-weight`），CodeMirror `HighlightStyle` 的 tag 名向同一套类别对齐——chat 与编辑器两条高亮路径共用一套命名，阶段 2 前一次到位改名，避免两次重命名。

### 四项总表

| 项 | Claude 结论 | 与 Pi / DSH 的关系 |
|---|---|---|
| §8.2 | `~/.cloudcli/themes/`，Docker 仅文档标注；路径复用 homedir 模式；文件/粘贴两线存储语义写明 | 完全一致（无分歧） |
| §8.7 | 分片 + 机器可校验豁免清单；dark: 不设独立片；palette 片加计算值等值断言 | 一致 + 两处补强 |
| §8.8 | 三分法采纳；勘误（dark: + 具名色 1124 处占 86%）；--status-* 与消费者捆绑、阶段 0 不引入 | 一致 + 一处勘误 + 两处修正 |
| §8.9 | 本轮不升；黄金映射 = inline snapshot；加 denylist 护栏；草案本轮定方向 | 一致 + 实现形态细化 |

**留给项目所有者的净分歧**：无——四项三方结论方向一致，分歧仅在执行细节（§8.8 的 `--status-*` 引入时机与 Pi 表述冲突、§8.7 的 dark: 是否独立片与 Pi 分片顺序冲突，本拍板均给出修正理由，建议采纳本轮表述）。

---

## 牵头结论（第 2 轮：§8 四项拍板汇总与落地）

**日期**：2026-09-25 ｜ **输入**：Pi / DSH / Claude 三方对 §8.2 / §8.7 / §8.8 / §8.9 的独立拍板 ｜ **产出**：§8 全部标记已决，正文 v3 落地

### 一、四项拍板汇总

| 项 | 三方方向 | 最终落地（已写入正文） |
|---|---|---|
| **§8.2 主题目录** | 完全一致，无分歧 | `~/.cloudcli/themes/`，Docker 只写文档、不做代码适配；**路径解析必须复用 server 现有 `path.join(os.homedir(), '.cloudcli', …)` 模式**，新增与 assets 平行的目录常量，严禁第二套拼接。见 §8.2、§5.6 |
| **§8.7 拆分口径** | 一致（分片 + 机器可校验豁免清单） | 0-A…0-G **七片序列** + **按文件集群切片**（105 文件，热点单独成片）+ **DoD 三件套**（grep 清零 / 视觉基线阈值 0 / 计算值等值断言）+ **dark: 不设独立片**；定量终点 = 收敛到豁免清单。见 §6 阶段 0 |
| **§8.8 `dark:` 处置** | 一致采纳三分法；Claude 作了勘误与两处修正 | 弃"全消除 vs 暗底保证"伪二选一；**三分法**（语义骨架换令牌 ~200 处必做 / 状态色保留 `dark:` 且 `--status-*` 阶段 0 不引入 ~300 处 / 品牌图标豁免 ~1000 处）；**验收只统计 `dark:` + 具名色，不统计 `dark:` 总数**。见 §8.8、§5.7、附录 A |
| **§8.9 语法令牌命名** | 一致同意本轮不升 | 本轮三件事：`SYNTAX_TOKEN_MAP` 常量 + **黄金映射 inline snapshot 测试** + **denylist grep 护栏**；语义名草案定方向、阶段 2 与编辑器令牌化一并实施。见 §8.9、§5.9 |

### 二、本轮数字复核结果（牵头实测）

| 断言 | 来源 | 实测 | 判定 |
|---|---|---|---|
| 中性色具名类分布 **105 个文件** | DSH §8.7 | **105** | ✅ 精确一致 |
| 热点文件 84 / 72 / 69 / 60 | DSH §8.7 | `AskUserQuestionPanel` **84**、`TaskDetailModal` **72**、`McpServerFormModal` **69**、`TaskBoardToolbar` **60** | ✅ 四项全部一致 |
| `dark:` + 中性具名 **534** / 彩色 **590** / 令牌类 **6** | Claude §8.8 | **529** / **581** / **6** | ✅ 一致（±5 属口径漂移） |
| `dark:bg-card` 类令牌用法仅 6 处 | Claude §8.8 | 字面 `dark:bg-card` = **0**，语义令牌类合计 **6** | ✅ 成立（"这类"指类别） |
| 成对结构 ≥ 335 处 | Claude §8.7 | 同文件成对 **414** | ✅ 成立 |
| `--cc-syntax-N` 消费者 4 个文件 | Pi / DSH §8.9 | **4**（`syntaxHighlightTheme.ts`、`Markdown.tsx` + 2 测试） | ✅ 精确一致 |
| 现有测试只断言编号形状、未锁映射 | DSH §8.9 | `assert.match(value, /^var\(--cc-syntax-\d+\)$/)` | ✅ 成立 |
| `resolveAsset` 路由已带 `Content-Type` / `Cache-Control` | Claude §8.2 | `plugins.routes.ts:29-30` 均存在（`Cache-Control: no-store`） | ✅ 成立（详见下"补充发现"） |
| `darkMode: ["class"]`、Tailwind v3 | DSH §8.8（特异性论证前提） | `tailwind.config.js` = `darkMode: ["class"]`，`tailwindcss ^3.4.0` | ✅ 前提成立 |
| `docker/` 无应用 Dockerfile | Pi / DSH / Claude §8.2 | 仅 `claude-code/` `codex/` `shared/` + README | ✅ 成立 |

### 三、牵头发现的两处需修正

1. **DSH §8.2 的引用行号有误**（不影响结论）：DSH 称 `~/.cloudcli` 解析见 `server/index.ts:198/268/323`，实测 `server/index.ts` **只有 :323** 一处（`local-server.json`）。同模式的实际位置是 `server/shared/image-attachments.ts:22`（assets）、`server/load-env.ts:43`（auth.db）、`server/modules/browser-use/browser-use.service.ts:84`。"复用同一解析方式"的结论完全成立，正文引用已改为准确位置。
2. **`?v=` 参数的性质需降级表述**：Claude 建议"阶段 2 复用 plugins 路由"，而该路由已发 `Cache-Control: no-store, no-cache, must-revalidate`——浏览器侧本就无缓存。故 `?v=` 应表述为"兜住中间层 / 代理缓存 + 便于排障"的**加固**，而非阶段 2 验收的必要条件。已在 §5.6 补注。**这也意味着阶段 2 验收里"改文件后刷新能看到变化"由 `no-store` 即已满足，`?v=` 是双保险。**

### 四、采纳与收敛

- **采纳**：三方 §8 全部拍板（方向一致）；Claude 的两处修正（`--status-*` 捆绑消费者、dark: 不设独立片）与一处勘误（`dark:` 分母口径）**全部采纳**——前者避免了"死令牌"覆辙，后者纠正了 DSH"1302 中大部分无害"的字面误读。
- **修正后采纳**：§8.7 的"dark: 处置策略定案"从阶段 0 的**施工项**降为**纸面产出**（分类清单），施工并入文件集群片。
- **不采纳**：无。
- **口径统一**：全文的 `dark:` 相关数字统一为"`dark:` + 具名色"口径（中性 529 / 彩色 581 / 合计约 1110），**不再使用"`dark:` 总数"作为验收指标**。

### 五、本轮对正文的改动清单

| 章节 | 改动 |
|---|---|
| §8 | 标题改 v3，2/7/8/9 由"待定"改为"已决"，补实施约束与依据；**当前无遗留待定项** |
| §6 阶段 0 | 重写为 0-A…0-G 七片序列表 + 切片粒度 + dark: 不设独立片 + 豁免清单单一事实源 + DoD 三件套 + 定量终点 |
| §5.7 | 三行具名色/dark: 条目重写为**三分法**；新增 `dark:` 总览行（含 1302 分解与验收口径）；验收段落加入第 ③ 条命令与 allowlist 要求 |
| §5.9 | `--cc-syntax-N` 条目重写为 v3 三件事 + 语义名草案方向 |
| §5.6 | `?v=` 补注 `no-store` 性质；新增"文件主题 vs 粘贴主题两条存储线" |
| 附录 A | `--status-*` 标注**阶段 0 不引入**及与消费者捆绑的理由 |
| §7 | 更新规模风险缓解；新增"死令牌"风险行 |
| §8 / 头部 | 版本状态更新为 v3 |

**代码改动**：无。本轮仍只修订设计文档。§8 已无待定项，**下一步可直接进入阶段 0 的 0-A 片实施**（palette 层 + L2 引用改写，含计算值等值断言）。

---

## Claude 代码审阅（实施轮）

> 2026-09-26，应项目所有者要求，对阶段 0–2 全量实现做代码审查。基线 `6219a60e..aca23d31`（166 个主题提交、218 个文件、约 2.3 万行）。审查方式：五路并行深审（服务端安全 / 前端加载链路 / 编译器与校验器 / 阶段 0 令牌体系 / 测试套件与验收命令），全部结论经实证复核（含真实 Chromium 注入实验、Express 解码顺序实测、手工 HSL 逐位验算），未改动任何仓库文件。
>
> **总评**：实现质量高于预期，**无严重级问题**——`test:client` 143 文件 / 1186 用例全绿，typecheck / lint（0 error）/ build:client 全过；§5.7 三条验收 grep 达标（② 生产代码仅剩 1 条已申报豁免、③ 中性族清零）；`n-*` 保值档位层是 §5.7 v4 有记录的正确设计演进；"视觉零变化"经手工逐位验算 + Playwright 真引擎契约双途径核实成立。以下为需作者回应的发现，按优先级排列。

> [!WARNING]
> 潜在风险（**P1-1，移动端行为回归**）：B3 触屏 hover 抑制已实际失效。`src/index.css:1087-1091、1123-1126` 的触屏禁用块仍写字面选择器 `.hover\:bg-gray-50:hover` 等，而这批消费者已全部改名为 `hover:bg-n-gray-*`（实测现存 `hover:bg-n-gray-100` 40 处、`hover:bg-n-gray-50` 12 处、`dark:hover:bg-n-gray-700` 25 处）——**四个中性选择器全部永不匹配**。移动端（`hover:none, pointer:coarse`）点击非 button/a 元素时的 sticky hover 灰底回归，且 `dist` 持续发布死码字面类名（同族死码 `.dark .bg-gray-800 textarea` 见 `index.css:868,897`）。B3 拍板"交阶段 2 统一重排"，但 2-A..2-M 从未重新入账，与收官清账"可做未做账为空"冲突。**建议**：最省修法即当年被否掉的 B1（各补一行 `n-*` 选择器）——属移动端高发区，建议立即收口而非等语义化改名。

> [!WARNING]
> 潜在风险（**P1-2，阶段 1 验收句被打破**）：PRD 编辑器 oneDark 残留。`src/modules/prd-editor/PrdEditorBody.tsx:3,43` 仍 `import { oneDark }` + `theme={isDarkMode ? oneDark : undefined}`——正是 0-D 宣称消灭的形态。该文件在本线 166 个提交中从未被触碰、设计文档 0 次提及；而文档断言"`src/` 下 `@codemirror/theme-one-dark` 零导入"，护栏 `editorThemeTokens.test.ts:85-93` 只扫 code-editor 模块目录，恰好漏网（`package.json` 依赖仍在，与残留自洽）。切 `cc-polar` 或任何用户主题时 PRD 编辑器纹丝不动，与阶段 1 验收"编辑器同时变化"矛盾。**建议**：切到 `editorLightTheme` / `editorDarkTheme` + `editorHighlightExtension`，护栏扫描范围改为全 `src` 的 import 扫描；或至少修正文档断言为"code-editor 模块零导入"。

> [!WARNING]
> 潜在风险（**P1-3，§5.6"避免闪白"未达成**）：用户主题之间切换闪默认基色。`ThemeContext.tsx:247-262`：`userThemeInForce` 要求 `appliedId === themeId`，切换时 themeId 先变而 appliedId 仍旧值 → manifest 解析为默认别名 → `data-theme` 立即翻成 `cc-light/cc-dark` → 旧主题规则**即刻失配**，新主题等 fetch 往返，期间整页画基色（数百 ms 级）。`injectStyle` 的 append-then-remove（`userThemeStyles.ts:412-427`，有 MutationObserver 测试钉住）只保证元素共存，不保证规则同时命中。注释表明这是有意取舍（"宁可默认也不空匹配"），但"加载 B 期间保持 `data-theme=A`"这条第三选项未被覆盖。附带不一致：若旧主题是带裸 `:root{}` 全局规则的 `.css`，切换期间旧样式继续生效——同一"切换"操作两种视觉结果。**建议**：放宽 in-force 判定为"appliedId 非空且 pick 未被否定"，B 就绪后同帧翻属性 + 删旧元素；或按体例把该取舍记为 v12 的显式边界，别让"避免闪白"留在验收句里。

> [!WARNING]
> 潜在风险（**P1-4，韧性与文档自相矛盾**）：清单请求一次失败即拆掉在屏缓存主题并清缓存。`ThemeContext.tsx:312-317` 把 `status === 'error'` 也当 `listingComplete=true` 传入，触发 `applyUserThemeStyle(null, true)` → `removeInjectedStyles() + clearCache()`（`userThemeStyles.ts:551-557`）。启动时缓存恢复成功、主题正常在屏，`GET /api/themes` 一次 401/网络抖动 → 拆样式 + 抹首帧缓存（下次启动失去首帧保护）+ 选择器报"无法加载"。且无重试触发点：`refreshUserThemes` 只由 themeId 变化与选择器打开触发，token 重新登录后 themeId 不变（相同值 bail out）、effect 不重跑。更糟的是 `userThemeStyles.ts:526-533` 的模块契约文档原文说的是反话（"tearing down a working stylesheet on a request that…has failed would trade a working theme for a fallback nobody asked for"），同一事实两处文档相左，后续维护者会按其中一份去"修"另一份。**建议**：二选一并统一口径——error 时保留缓存样式在屏、仅提示"暂时无法核对"；或维持现行为但把模块文档改写成与 ThemeContext 注解一致。另在 token 就绪事件上补一次 `refreshUserThemes()`（接口现成、对 ready 幂等）。

> [!WARNING]
> 潜在风险（**P2-1，闸门承诺被实证绕过，两路审查独立发现**）：`@import` 闸门可被 CSS 转义绕过。`server/modules/themes/services/theme-files.service.ts:75` 与 `src/shared/userThemePastes.ts:77` 同用字面正则 `/@import/i`；实测 `@im\70 ort url(...)` 与 `@\69mport` 在真实 Chromium 中解析为 `CSSImportRule` 并真的发起远程请求（CSS 规范中 at-rule 名是 ident，ident 允许 `\xx` 转义，浏览器在 tokenize 阶段解码——字面正则看不见）。文件线服务端列举与下发两道检查均放行 → 客户端 `textContent` 原样注入 → 远程样式表被拉进页面，可再做属性选择器式 CSS 探测/exfil。威胁模型（能写目录/能粘贴 = OS 用户本人）压低现实可利用性，但 §5.8"拒绝 @import"的书面保证已不成立。**建议**：postcss 已在依赖树里，服务端改真解析（walk at-rule 节点名 `import` 即拒）；粘贴线复用同一逻辑——两侧必须同步修（文档自立的规矩："同一条规则的两道闸门给出一致的答案"）。修时补一条 `@im\70 ort` 测试用例钉住。

> [!WARNING]
> 潜在风险（**P2-2，白名单纯度承诺被打破**）：`--editor-*` 的 expression 值可 `var()` 引用未授权令牌。`userThemeTokens.ts:136`（`EXPRESSION_PATTERN`）与 `:257`（expression 分支不经 `referencesThemableToken`）：`{"tokens":{"--editor-fg":"var(--cc-syntax-3)"}}` 通过校验（按源码正则复现）。§5.8 v4 明文"var() 引用的目标也必须自身可授权"，该约束只在 triplet-or-reference 三条规则里实现，expression 这条漏了。Prism 依赖 bump 导致编号重排时，编辑器前景色**静默漂到另一个语义槽**——正是 §5.9 三件事要防的失败模式；`var(--safe-area-*)`、`var(--tw-*)` 也能从这条缝进来。**建议**：expression 值提取全部 `var(--x)` 目标逐一过 `referencesThemableToken`（一行修法），`hsl(var(--palette-sand-50))` 类合法写法不受影响。

> [!WARNING]
> 潜在风险（**P2-3，§5.12 拍板未落地到授权面**）：2-J 的 lane 参数没进选项 A 白名单。`--graph-lane-base-hue` / `--graph-lane-hue-step`（`index.css:338-339`，§5.12 v3 拍板"主题可覆盖"）不匹配 `userThemeTokens.ts:203` 的族规则（只认 `--graph-lane-1..10`），A 格式主题写它会被拒"is not a token a theme may set"——**默认格式作者无法兑现"覆盖两个参数即控制整张图色系"**，只有选项 B 能设；即便授权，现有 ValueRule 也没有"纯数字（可带小数，如 315.3）"这一档。2-J 落地时没回头补 §5.8 v4 授权面表。**建议**：两参数各加 exact 规则（number、允许小数），同步更新授权面表。

> [!IMPORTANT]
> 关键信息（**P3，收官清账需修正**）："阶段 2 语义化改名"整条工作流未发生，与"文档再无未实施条款"的收官断言冲突。文档多处把欠账显式记给阶段 2——§5.7 v4"dark: 双写与档位耦合由阶段 2 的语义化改名收口"、附录 A"阶段 2 语义化改名后**整层删除**"（n-* 层）、0-E1 记录"阶段 2 改名后本键删除"（tailwind `n-*` 键）、§8.9"阶段 2 前一次到位改名"、2-C 白名单注释"随阶段 2 语义化改名同步扩充——**这是到期条件**"。实际 2-A..2-M 全部是用户主题线：`--cc-syntax-1..136` 仍是编号、n-* 层与约 1520 处消费者原样、到期条件未兑现。代码自洽、护栏全绿，**失实的是清账**。且 `--n-*` 已进用户主题白名单（`userThemeTokens.ts:201-202`）——已有主题文件可能开始依赖它，将来真删层是破坏性变更。**建议**：补"语义化改名（显式未做）"一节，并**现在就明确 `--n-*` 白名单的兼容承诺**（保留为永久契约面，还是迁移期条款）——这个决定宜早不宜晚，晚一天依赖者多一分。

> [!TIP]
> 建议（P3 打磨项，按需采纳，不必逐条回应）：① symlink 边界虽已自申报（§5.8 v3 边界①），plugins 有现成 realpath 加固（`plugin-registry.service.ts:240-247`），建议低成本照抄收口，并至少加一条测试钉住"当前行为是跟随"，让到期条件触发时改动会红；② `theme-files.service.ts:379-388` stat 与 readFile 之间的 TOCTOU——readFile 后按 Buffer 长度复核一次即可；③ `themes.routes.ts:13,22` 裸 async handler 对齐仓库 `asyncHandler` 惯例（Express 4.21 下 rejected promise 不进 error middleware，未来引入可 throw 调用时故障形态会退化为悬挂）；④ `utils.ts:363` 的 `FALLBACK_THEME_COLOR='#ffffff'` 无条件兜底——暗色下一旦触发是白状态栏，按 appearance 取兜底或保留 meta 不动；⑤ denylist 护栏扫描范围只有 `src/`（`syntaxThemeTokenMap.test.ts:222-255`），建议纳入 `server/` 与 `tests/theme-tokens/`，或至少在测试注释写明范围即边界；⑥ `token-contract.spec.ts:140` 测试名承诺"no colour token holds a literal value outside the palette"但实际只匹配 HSL 三元组形态，建议扩到 hex/rgb() 并对 `--editor-*`（0-D 有意字面）显式豁免，或改测试名注明口径；⑦ `prose-gray` 5 处（`MessageComponent.tsx:226/418/435/496`、`PrdEditorBody.tsx:32`）不在 1517 口径与守恒律内（ATOM 只认工具类前缀），建议在三分法里给它明示归属；⑧ 首帧"不闪"隐性依赖 `#app-splash` 盖屏——`data-theme` 在 useEffect（首帧绘制之后）才写，任何让 splash 提前消失的改动（路由重构、SSR、桌面壳）都会暴露这层，建议在文档记为已知依赖；⑨ 语法高亮 denylist 与 §8.9 一致已落地，唯扫描范围见 ⑤。

> [!NOTE]
> 补充说明（已核实成立的承诺，供作者对照，无需回应）：`n-*` 是 §5.7 v4 定案的保值档位层（语义折叠实测 89 种明暗元组、一个令牌类只能承载一对值、ΔRGB 最大 100，否决有据），46 声明 / 6 键 / 约 1520 消费者 / 已进契约面，记录完备；守恒律（usageKey 冻结普查 1517、字面与 `n-*` 同桶）+ 基线 JSON（total=0）+ `neutralScale` 四段链条 + `token-contract.spec.ts` 计算值契约 + 5 条反空转守卫，护栏体系扎实；L1→L2 19 令牌逐位等值（唯 `--palette-sand-500` 44%→43% 为 1-H 有意记账变更）、终端 20 令牌与 Git lane-1 精确往返（HSL 算法手算验证）、68 处替换抽查全等值；B2 `.tmTheme` 的 XML 面实测安全（外部实体不解析、实体膨胀被引擎拒绝、UI 全走 React 文本节点无 XSS 通道）；A 格式三道闸门收口且九种逃逸值有测试钉住（结构闸门"整份拒绝"策略评价高）；黄金映射为真 inline snapshot（136 项全对照）且 `SYNTAX_TOKEN_MAP` 由产物反查派生（缺槽位模块加载期 throw）；恢复通道 reset 竞态（operation token / hydrate 回填压制 / `replaceState` 抹参）被测试钉住，回落为临时态、reset 为持久清 pick 的语义清晰；服务端安全五大面（穿越/鉴权/嗅探/信息泄漏/前缀）全部收敛且被路由级真 Express 测试钉住。验收 grep：① 221 处全落文档豁免类（编辑器字面令牌/品牌色/状态色/参数化回退/颜色处理代码/测试夹具）、② 生产 1 处与 `NEUTRAL_EXEMPTIONS` 精确对应、③ 中性清零（581 处彩色为记录在案的有意保留）。

> [!NOTE]
> 补充说明（回应指引）：以上 **7 条 WARNING（P1-1 ~ P2-3）与 1 条 IMPORTANT 建议逐条回应**——修 / 有意保留并按体例记账 / 改文档口径，三选一均可；TIP 与 NOTE 无需逐条回应。审查期间未改动任何仓库文件；Playwright 契约套件（`test:theme-tokens` 16 项）本次未独立重跑，按文档记录为全绿，作者若要闭环可在回应时补一次实跑记录。

## Pi 代码审阅（实施轮，独立复核）

> 2026-09-26，对阶段 0–2 全量实现 + 同期 5 个非主题提交做独立代码审查。基线 `4d13958c..aca23d31`（168 个未推送提交、827 个文件）。审查方式：按模块分层深入（服务端安全 / 前端加载链路 / 编译与校验 / 主题核心机制 / 非主题新功能），结论经源码阅读 + 关键路径手工 tracing 验证。
>
> **总评**：实现质量很高，工程纪律强——每片改动有测试、有基线、有变异测试证明护栏非空转。与 Claude 审查结论大部分重合（P1-1 / P1-2 / P1-4 / P2-1 / P2-3 / P3 我也独立发现了，不重复写），以下只列我这边有**增量视角**或**不同关注点**的发现，以及 5 个非主题提交的审查结论。

> [!WARNING]
> 潜在风险（**主题 · 失败主题重试死锁**，与 P1-4 相关但角度不同）：`userThemeStyles.ts` 的 `state.failedId === id` 短路不仅影响"清单失败"场景，还影响**用户手动重试**。用户主题加载失败后，用户切到默认再切回来，`failedId` 没有清，`applyUserThemeStyle` 直接 return——主题永远加载不回来，用户只能刷新页面。P1-4 讲的是"清单 error 时该不该拆缓存"，这个问题是"`failedId` 的生命周期缺一个 reset 入口"——清单刷新成功、用户主动重选、主题文件 mtime 变化，都应该清掉失败标记。建议：`refreshUserThemes` 拿到 ready 状态时，遍历 `failedId` 若在新清单里则清除；或 `applyUserThemeStyle` 增加 `force` 参数供选择器主动调用。

> [!WARNING]
> 潜在风险（**全局网络代理 · 服务端自身请求不走代理**，非主题，P1 级）：`server/modules/network/network.service.ts` 的代理实现只通过 `process.env` 下发给子进程（各 harness CLI），但 **Node.js 服务端自身的 HTTP 请求不走代理**——`NODE_USE_ENV_PROXY` 是 Bun 的 flag，Node.js 的 `fetch` / `undici` 不认。后果：在需要代理的网络环境下，CLI 调用能通、但服务端自身的请求（OAuth 回调验证、插件市场、通知服务、浏览器 use MCP 服务等）直连失败，出现"同一份代理设置，有的功能能用有的不能"的分裂状态。建议：① 如果服务端确实不需要走代理（同机部署），在注释里明确写出来，避免后人误以为全覆盖；② 如果需要，引入 `undici` 的 `ProxyAgent` 并设为全局 fetch agent。

> [!WARNING]
> 潜在风险（**全局网络代理 · 环境变量写入时机与已有会话的关系**，非主题，P2 级）：`applyProxyToProcessEnv()` 在保存后立即写入 `process.env`，注释说"对下一次 spawn 的会话生效"。但实际有两个边界场景未说明：① **正在运行中的会话**——它们的子进程环境不受影响（正确），但服务端代表它们发起的 HTTP 请求（如果有的话）会用新代理，可能造成同一会话内网络环境不一致；② `process.env` 的修改是全局的，如果有并发请求在读取环境变量（比如多个 session 同时 spawn），理论上存在竞态——虽然写入只有一行赋值、原子性没问题，但"读取代理值"和"启动子进程"之间不是原子的。低风险，建议在文档或注释里明确这两个边界。

> [!WARNING]
> 潜在风险（**Codex 配置档案 · 相对路径解析不一致**，非主题，P2 级）：`server/shared/codex-config.ts` 的 `resolveCodexConfigOverrides` 里，`model_catalog_json` 的相对路径按档案文件所在目录解析，这是对的。但其他可能含路径的字段（如 `web_search` 下的某些配置、`model_providers` 表里的 base_url / api_base 之类）没有做同样处理。如果用户在档案里写了相对路径，Codex CLI 会按 `CODEX_HOME` 解析，而这里通过 `-c` 覆盖传入的值，CLI 可能按不同基准解析——**行为与直接用档案文件不一致**。建议：明确记录"只有 `model_catalog_json` 会被重解析，其他路径字段由 CLI 自己按 CODEX_HOME 解析"，或者对所有可能是路径的字段统一做解析。

> [!WARNING]
> 潜在风险（**OpenCode 推理累积 · 同 message 内 think→text→think 可能错合并**，非主题，P2 级）：`opencode-sessions.provider.ts` 中 `thinkingRun` 的重置条件是"遇到非 reasoning partType"，但**重置后没有把 messageId 也清掉的逻辑检查**。如果同一条 message 内的 part 顺序是 `reasoning → text → reasoning`（先出思考、再出正文、再思考——虽然不太常见但流式模型可能发生），第二个 reasoning 块会被追加到前面的 thinking 消息上，因为 `thinkingRun.messageId === row.message_id` 仍然成立。实际 OpenCode 的存储结构是不是这样我没有数据验证，但从代码逻辑看存在这个缝隙。建议：加一条测试覆盖 "同一 message 内 think → text → think" 的场景，确认实际数据形态；如果确实有此情况，切 text 后再切回 reasoning 时应新建一条 thinking 消息。

> [!TIP]
> 建议（**主题 · `color-scheme` 行内样式优先级**）：`ThemeContext.tsx` 把 `color-scheme` 写在 `document.documentElement.style` 上，行内样式优先级高于任何 CSS 规则——用户主题（选项 B）无法覆盖 `color-scheme`。虽然主题确实不该改 `color-scheme`（它由 appearance 驱动），但和"覆盖层稳定压过 base"的约定不一致，且如果未来主题想声明"我同时支持明暗"会被挡住。建议：改成通过 `data-color-scheme` 属性 + CSS 规则控制，或至少在注释里标注这是故意的例外。

> [!TIP]
> 建议（**主题 · 选择器频繁切换的偏好写入抖动**）：`setThemeId` 每次调用都 `writeUserPreference` 并触发跨设备同步。用户在主题选择器里快速划过多个主题时（比如用键盘上下键试效果），会触发多次写入和跨设备同步。低优先级，可以加个 200ms 防抖，或者只在用户确认选择时写入。

> [!TIP]
> 建议（**Codex 配置档案 · 白名单键的版本兼容风险**）：`PROFILE_OVERRIDE_KEYS` 硬编码了 6 个可覆盖键。如果未来 Codex CLI 新增了同样应该被档案覆盖的配置项（比如 `temperature`、`top_p` 等推理参数），这里需要手动更新，否则用户档案里写了也不生效。建议：在代码注释里标注"新增配置项时记得同步此白名单"，或者加一条测试——从 Codex 官方文档/类型里拉取已知配置键，对比白名单，有差异时告警。

> [!TIP]
> 建议（**快捷设置面板迁移 · 功能可达性回归**）：`ba293c65` 把"显示参数 / 显示思考 / Ctrl+Enter 发送"三项从快捷设置面板移到了设置对话框的聊天页。好处是入口统一，但代价是**操作路径变长了**——原来点开浮窗就能切，现在要打开设置对话框 → 切到聊天页。对于"显示思考"这种用户可能频繁切换的功能（调试时打开、平时关掉），路径变长是体验回退。建议：至少保留"显示思考"在快捷面板里，或者提供一个更快的切换方式（命令面板、快捷键）。

> [!NOTE]
> 补充说明（**5 个非主题提交总评**）：
> - **全局网络代理**（4d13958c）：设计清晰、安全有保障（URL 格式校验、NO_PROXY、清除继承值），核心问题是服务端自身请求是否走代理未明确——这是设计选择不是 bug，但需要明确文档化。
> - **Codex 配置档案**（6219a60e）：实现质量高，白名单策略、命名空间防污染、相对路径解析都考虑到了。测试覆盖充分（26 个用例）。注意版本兼容风险即可。
> - **快捷设置迁移**（ba293c65）：纯 UI 重构，逻辑没问题。主要关注点是功能可达性，见上面 TIP。
> - **OpenCode 推理修复**（b13046ac）：修复方向正确（累积连续 reasoning、不 trim 空白）。同 message 内 think/text 交错的边界场景建议补测。
> - **Sidebar 菜单排序**（2be05258）：纯排序调整，无风险。

> [!NOTE]
> 补充说明（**与 Claude 审查的重合项确认**）：以下问题我独立审查时也发现了，与 Claude 结论一致，不赘述：移动端 hover 抑制失效（P1-1）、PRD 编辑器 oneDark 残留（P1-2）、主题切换闪默认基色（P1-3）、清单失败拆缓存（P1-4）、@import CSS 转义绕过（P2-1）、`--graph-lane-*` 两参数未进白名单（P2-3）、`n-*` 语义化改名未完成（P3）。这些的严重等级和修复建议我都认同。

---

## 作者回应（实施轮第一轮）

> 2026-09-26，作者对上两节审阅逐条核验后作答。核验方式：**每条发现对照当前源码实证**——死选择器逐个 grep、分支条件逐行读、白名单规则逐条比对、正则与转义路径复核——不依赖审阅者转述。**结论先行：7 条 WARNING（P1-1 ~ P2-3）、1 条 IMPORTANT（P3）与 Pi 的"failedId 重试死锁"全部属实，无误报。** Pi 的两条非主题 WARNING（网络代理、Codex 路径等）与其余非主题 TIP 未在本轮核验范围，转交对应负责人另行安排。据此先认领**收官清账两处失实**：
>
> 1. **"可做未做账为空"失实**（P1-1 指出）——B3 的"交阶段 2 统一重排"自 0-F1 记录起就挂在账上，2-A..2-M 实施时从未把它重排进切片表，收官对账也没有对出来。审阅者的质问（"与收官清账'可做未做账为空'冲突"）成立，状态行已随本节一并修正。
> 2. **"设计文档无未实施条款"失实**（P3 指出）——文档至少 5 处把收口动作显式记给"阶段 2 的语义化改名"（§5.7 v4、§6 的 1-B2 记录、§8.9、2-C 白名单注释、附录 A），而实际实施的阶段 2 是用户主题线。这是**命名撞车**：文档里的"阶段 2"一直指改名轮，实施排期里"阶段 2"做的是用户主题。已在 §5.7 补"语义化改名（显式未做）"小节，处置见下。

### 逐条处置（三选一体例；标注"修"的均按本线规矩走完整门槛：测试＋变异＋双绿）

**P1-1 触屏 hover 抑制失效——修（采纳审阅建议，即当年被否的 B1）。**
四个死选择器各补对应 `n-*` 行（`.hover\:bg-n-gray-50:hover` 等），字面旧行删除，`dist` 死码同批消失；`.dark .bg-gray-800 textarea` 两处全死选择器同源同批清掉。当年 B3 的理由是"阶段 2 本就要重排这些引用"——该前提随改名轮未做而失效，维持 B3 只会让死码继续发布。修后更新 0-F 记录里 B3 账的状态（"由 2-N 收口"）。**已实施（批 3，`fe86d589`；0-F 记录的 B3 账状态随本节文档提交一并更新；新增结构护栏钉住"抑制块不得再引用退役字面档位"）**。

**P1-2 PRD 编辑器 oneDark 残留——修。**
`PrdEditorBody.tsx` 切 `editorLightTheme` / `editorDarkTheme` ＋ `editorHighlightExtension`（与 code-editor 同源；按 1-G 判据，其色值经 `var()` 交给 CSS，无需 JS 数值刷新）；护栏扫描范围从 code-editor 模块目录扩为**全 `src` 的 import 扫描**（`@codemirror/theme-one-dark` 全仓零导入才算过），文档断言同步改回全称。修复前如实记账：阶段 1 验收"编辑器同时变化"在 PRD 编辑器上自始未达成。**已实施（批 3，`fe86d589`）**。

**P1-3 切换闪默认基色——修（放宽 in-force 判定）。**
作者拍板取"放宽"：`userThemeInForce` 改为"appliedId 非空且该 pick 未被否定（未失败、未被清）"，B 就绪后同帧翻属性＋删旧元素。理由：数百 ms 的整页基色闪烁是用户可感知的，且与 §5.6"避免闪白"验收直接冲突；"宁可默认也不空匹配"的注释取舍由本拍板取代。审阅指出的附带不一致（裸 `:root{}` 的 `.css` 切换期间继续生效）在实现时一并处理并以测试钉住。**已实施（批 2，`e5e2d07b`）。实施注记**：放宽的承重点最终落在 manifest 解析分支——manifest 改按"文档里穿着的那份"解析（pick 先行、新样式表在途时续穿旧主题，按在途 id 从粘贴镜像或清单条目查身份；`failedId === themeId` 例外回落默认），`userThemeInForce` 只是随行放宽；变异 M2 曾打在已不承重的 `userThemeInForce` 上假绿，换锚点打 manifest 本体后转红。

**P1-4 清单失败拆缓存 ＋ failedId 重试死锁（Pi）——合并修。**
两问同根（失败态的生命周期），一并处理：
- error **保留**在屏样式与缓存，仅提示"暂时无法核对"；`listingComplete` 语义收窄为"ready 才算证据"——回到 `userThemeStyles.ts` 模块注释本来主张的那句话；
- `failedId` 补 reset 入口：清单 ready 时若失败 id 仍在新清单中则清除（Pi 建议①）；用户重选同 id 不再被 `state.failedId === id` 短路（Pi 建议②的 force 语义随重选自带）；
- 两处相左的模块文档统一改写为与实现一致，并各配一条测试（error 不拆缓存 / 失败后重试可恢复）。

  **已实施（批 2，`e5e2d07b`）。实施注记（与原方案的两处出入，如实记）**：① Pi 建议①的"清单 ready 时清除 failedId"未采纳——userThemes store 是"ready 冻结"设计（整个会话只拉一次清单，`refreshUserThemes` 在 ready 态直接 return），"ready 时再清"没有第二次 ready 可等；改为**移除 `state.failedId === id` 的请求短路（重复请求即重试）**＋在 `ThemeContext` 监听 `AUTH_TOKEN_REFRESHED_EVENT`（登录不改变 pick，该事件是失败清单唯一合理的重试触发点）。② 跨源切换（粘贴 → 文件）续穿的用例曾补入又撤去：它依赖清单重列，而 ready 冻结下重列不发生——**"清单是否回答了当前 pick"的 epoch 方案整组撤掉**，只留三处真修复；这是 store 冻结设计对新机制的硬边界，如实记账而非硬塞。

**P2-1 `@import` 转义绕过——修（两侧同步真解析）。**
服务端与粘贴线同批改 postcss 解析（依赖已在树内）：walk 到 at-rule 节点名 `import` 即拒，不再字面匹配；补 `@im\70 ort` 测试用例钉住（审阅已给真实 Chromium 证据）。两道闸门用同一份实现或同一份测试向量，维持文档自立的规矩——"同一条规则的两道闸门给出一致的答案"。**已实施（批 1，`bc4d88d1`）。实施时改判**：postcss 方案否——它是 devDependency（运行时不可用）且同样**不解码 at-rule 名转义**（`@im\70 ort` 在它眼里也是 `im\70 ort`）；改为自写**转义感知的 at-rule 名扫描器**（新增共享模块 `cssAtRules.ts`，按 CSS Syntax §4.3.7 解析 ident：hex 转义 1–6 位＋可选单空格终止、`\` 后任意字符、非 ASCII），服务端文件线与客户端粘贴线调同一份实现、共享同一组 17 条测试向量（`cssImportVectors.ts`），含近失误报（`@importx` / `@2import` 不拒）与保守误报（注释/字符串里的字面 `@import` 拒掉——闸门宁可误报）的取舍测试。这是上面三处拍板中唯一在实施时改判的一处，判据：审阅建议的工具自身满足不了审阅指出的威胁模型。

**P2-2 expression 白名单纯度——修（一行级）。**
expression 值提取全部 `var(--x)` 目标逐一过 `referencesThemableToken`（审阅确认 `hsl(var(--palette-sand-50))` 类合法写法不受影响——以回归测试证明，不以转述为准）。**已实施（批 1，`bc4d88d1`）**。

**P2-3 lane 参数未进授权面——修。**
`--graph-lane-base-hue` / `--graph-lane-hue-step` 各加 exact 规则（number，允许小数——315.3 / 95.1 是 §5.12 v3 的出厂默认值），授权面表同步；补"选项 A 主题覆盖两参数即整图调色"的真引擎用例——这是 §5.12 v3 拍板时承诺、却没有兑现到授权面的能力。**已实施（批 1，`bc4d88d1`；真引擎用例并证明覆盖层在同等特异性下按文档顺序压过 `:root`）**。

**P3 语义化改名未发生——改文档＋一项拍板。**
- §5.7 补"语义化改名（显式未做）"小节：列出全部 5 处到期条款（§5.7 v4 的 `dark:` 双写与档位耦合、附录 A 的 `--n-*` 整层删除、0-E1 记录的 tailwind `n-*` 键删除、§8.9 的 `--cc-syntax-N` 改名、2-C 白名单注释的扩充到期条件），逐条标注"前提：改名轮立项"；
- **作者拍板：`--n-*` 兼容承诺为永久契约面。** 1520 处消费者＋已有用户主题可能开始依赖它，"将来整层删除"在依赖者只增不减的今天是破坏性变更；改名轮若立项，`--n-*` 是改名后的**保留层**而非删除对象。附录 A、0-E1 记录等处的"删除"措辞按此改写；
- §8.9 的 `--cc-syntax-N` 改名不受该拍板影响（编号仍是实现细节、白名单仍不授权）。

  **已实施（文档动作随本节提交落地）**：§5.7 已补"语义化改名（显式未做；前提：改名轮立项）"小节（列全 5 处到期条款）；附录 A、0-E1 记录、2-C 白名单注释、§5.9 记账、§8.9 拍板结论处的"删除 / 阶段 2 收口"措辞已按"永久契约面"改写并互指。

**TIP 逐条简答：**
① symlink realpath 照抄 plugins 加固＋"当前行为是跟随"测试——采纳，随批 1（**已实施，`bc4d88d1`**：`canonicalWithin` realpath 双向包容，逃逸即拒、目录内跟随由测试钉住）；
② TOCTOU readFile 后按 Buffer 长度复核——采纳，随批 1（**已实施，`bc4d88d1`**：取更强做法——`fs.open` 单句柄读，闸门判定与下发字节同一句柄）；
③ themes 路由 `asyncHandler` 对齐——采纳，随批 1（**已实施，`bc4d88d1`**）；
④ `FALLBACK_THEME_COLOR` 按 appearance 取兜底——采纳，随批 2（**已实施，`e5e2d07b`**：`{ light: '#f7f6f3', dark: '#141414' }`，对应两外观的 `--background` 基色）；
⑤ denylist 护栏扫描范围——采纳"扩 `server/` 与 `tests/theme-tokens/`，并在测试注释写明范围即边界"（**已实施，`bc4d88d1`**：`SCAN_ROOTS` 三根，offenders 报完整路径）；
⑥ token-contract 测试名口径——采纳"扩 hex/rgb() 形态＋对 `--editor-*` 显式豁免＋改测试名注明口径"（**已实施，批 3 `fe86d589`**：扩网后 71 处字面全落编辑器板）；
⑦ `prose-gray` 归属——采纳"在三分法明示归属"（**已随本节文档提交落地**，见 §5.7 口径附注：归第一类、不追加入迁移清单）；
⑧ splash 依赖——采纳"§5.6 记为已知依赖"（**已随本节文档提交落地**，见 §5.6 v15；`main.tsx` 的 splash 注释同步补三个写者的分段职责）；
⑨ 同⑤。
另 Pi 的 `color-scheme` 行内样式 TIP——**采纳"注释标注为故意例外"**：主题声明 `color-scheme` 本就不该发生（它由 appearance 驱动），行内样式是最强的保证而非缺陷；偏好写入防抖 TIP——**暂不采纳**（写入频率无实测证据，先观察）。

### 实施批次（供审阅者复核工作量与顺序）

按性质分三批，每批独立门槛＋变异，顺序即依赖序：

- **批 1（校验器与闸门，纯服务端/shared）**：P2-2、P2-3、P2-1、TIP ①②③⑤⑨；
- **批 2（加载链路与状态生命周期）**：P1-3、P1-4＋failedId、TIP ④⑧；
- **批 3（收尾与文档）**：P1-1、P1-2、TIP ⑥⑦、P3 全部文档动作。

其中三处是**作者的拍板**而非审阅者的建议，若审阅者有异议请在下一轮直接反驳，作者在对应批开工前接受改判：
1. **P1-3 取"放宽 in-force"**（另一个候选是"保持现行为、记 v12 显式边界"——不改行为、只改文档）；
2. ~~**P2-1 取 postcss 真解析**~~（**实施时改判为自写转义感知扫描器**，见上方 P2-1 的实施注记——postcss 是 devDependency 且同样不解码 at-rule 名转义，满足不了审阅指出的威胁模型；改判属"审阅建议的工具失效"，威胁模型与"真解析、挡转义"的拍板意图不变）；
3. **P3 取 `--n-*` 永久契约面**（另一个候选是"迁移期条款＋破坏性删除"——需改名轮立项并发布公告）。

以上处置在回应时未动任何代码。**三批已全部实施**：批 1 `bc4d88d1`（校验器与闸门）、批 2 `e5e2d07b`（加载链路与状态生命周期）、批 3 `fe86d589`（触屏 hover 与 PRD 编辑器）；各批均走完整门槛（测试＋变异全 RED＋双绿＋红集对照），实施注记与两处实施时改判已逐条回填上文学内标注，文档侧动作（P3、TIP ⑦⑧、0-F 的 B3 账状态）随本节提交落地。

---

## Pi 复核（作者回应 · 实施轮第一轮）

> 2026-09-26，对作者回应做逐条复核。结论：**作者回应质量很高——逐条实证核验、三选一处置明确、分三批实施顺序合理、主动认领两处清账失实**。全部 7 条 WARNING + 1 条 IMPORTANT + Pi 的 failedId 问题均已接受并给出修复方案，无误漏。以下就三个作者拍板项表态，并对未纳入本轮的非主题问题做跟进确认。

### 三处作者拍板——全部同意

**1. P1-3 取"放宽 in-force" ✅ 同意。**
这是正确的选择。用户切换主题时几百 ms 的整页基色闪烁是可感知的体验缺陷，且与 §5.6 "避免闪白" 验收直接冲突。"保持现行为、记 v12 边界"等于承认一个已知的用户可感知 bug 为设计，不可取。附带的裸 `:root{}` 不一致问题也一并处理，合理。

**2. P2-1 取 postcss 真解析 ✅ 同意。**
正确的工程选择。CSS 转义形态远不止 `\70` 一种（还可以有 `\i`、`\@`、unicode 区间转义、换行续行等），字面正则永远追不完规范的可能性。postcss 已在依赖树中，用真解析一次性封堵所有 at-rule 逃逸路径，且两侧闸门共用同一逻辑，是最稳的做法。

**3. P3 取 `--n-*` 永久契约面 ✅ 同意。**
这是务实的决定。1520 处消费者 + 已进用户主题白名单，意味着依赖者只增不减，"将来整层删除" 是空头支票，真删那天就是破坏性变更。现在就明确永久保留，反而给主题作者一个稳定的契约预期。建议后续在文档和白名单注释里把这条承诺写死（"`--n-*` 是公共契约的一部分，保证向后兼容"），避免将来有人看到"兼容层"三个字就想删。

### 三批实施顺序——合理

批 1（校验器与闸门）→ 批 2（加载链路）→ 批 3（收尾与文档），按依赖从底到上，顺序正确。每批独立门槛＋变异，符合本线工程纪律。无异议。

### 对非主题问题的跟进

作者说"Pi 的两条非主题 WARNING（网络代理、Codex 路径等）与其余非主题 TIP 未在本轮核验范围，转交对应负责人另行安排"——这个分工合理，主题线的审阅不应越俎代庖。但我提一个**流程风险**：

> [!WARNING]
> 潜在流程风险：**非主题问题转交后无跟踪机制，可能石沉大海**。本次审查发现的网络代理（P1 级）、Codex 档案（P2 级）、OpenCode 推理（P2 级）三个 WARNING 级问题，"转交对应负责人" 后，如果没有明确的记录载体和闭环时间，很容易被遗忘——尤其网络代理那个 P1 级问题（服务端自身请求不走代理），在需要代理的环境下是实打实的功能缺陷。**建议**：至少在本设计文档或某个 TODO 列表里挂一条待办（"非主题审查问题追踪"），列清问题、等级、转交对象、预期闭环时间，避免审阅发现的问题在交接过程中丢失。

### 补充追问（小问题，不影响批 1 开工）

1. **P1-4 修复后的 "暂时无法核对" 提示**：清单 error 时保留缓存样式在屏，这个决策我同意。但用户在选择器里看到的是什么状态？是"已应用"（因为样式确实在屏）还是"无法确认"？如果选择器显示"已应用"，但实际文件可能已被删除——用户可能产生"我选了但文件没了也不知道"的困惑。建议在选择器 UI 上给一个轻度提示（如黄色圆点 + tooltip "暂时无法验证主题文件"），不要完全静默。

2. **P1-3 放宽 in-force 后的回落语义**：当 appliedId 非空但 pick 是新的（加载中），`resolvedThemeId` 返回旧的还是新的？如果返回旧的，那 "当前生效主题" 的展示和 data-theme 的实际值一致；如果返回新的，就会出现"选择器高亮了新主题但页面还是旧的"。建议明确 `resolvedThemeId` 的语义——它是"当前视觉上生效的主题"还是"用户选择的主题"？两者在加载期不一致，必须选一个并文档化。

3. **批 2 的 `splash 依赖` 文档化（TIP ⑧）**：作者说随批 2 做，我同意。建议补充时不仅记 §5.6，还要在 `main.tsx` 的 splash 相关代码旁加 inline 注释——"本 splash 不仅是品牌展示，还承担首帧防闪烁的功能，移除或提前消失需谨慎"。代码里的注释比文档里的记录更不容易被后来人漏掉。

---

## Claude 复核（作者回应 · 实施轮第一轮）

> 2026-09-26，对作者回应逐条复核。**总判定：通过。** 8 项的处置（6 修 / 1 修＋拍板 / 1 改文档＋拍板）与我方证据链完全对得上，无误报无漏项；两处清账失实的认领诚实、修正方案正确（"阶段 2 ＝改名轮"的命名撞车解释合理）。三处作者拍板**均不反驳**，依据如下。

### 三处拍板的表态（作者邀请反驳，此处为"不反驳"）

**1. P1-3 取"放宽 in-force"——同意，并替 Pi 追问 2 给出裁定依据。**
`resolvedThemeId` 在加载期必须返回**旧值（当前视觉生效的主题）**，证据在消费端：`useShellTerminal.ts:360-361` 的刷新触发 deps 是 `[isDarkMode, resolvedThemeId]`——若它在加载期提前翻成新 id，xterm 会在新主题 CSS 注入**之前**重读令牌（读到旧值）且之后没有第二次触发，终端停在旧主题，恰好复刻 1-G 修掉的问题；返回旧值则刷新恰好在 data-theme 翻转那一拍发生一次、读到新值。因此 **`resolvedThemeId` ＝ 视觉生效**、选择器高亮另行消费用户 pick，两个语义分离并写进注释。另给实现划一条硬边界：**"append 新 style → 翻 data-theme → 删旧 style"三步必须在同一同步任务内完成（不跨 await）**——同一 task 内无绘制，顺序无所谓；一旦跨 await，中间的绘制帧就会露出基色或双主题叠加态。

**2. P2-1 取 postcss 真解析——同意，补一条客户端 bundle 注意事项。**
粘贴校验（`userThemePastes.ts`）跑在浏览器端，而 postcss 是构建期工具链依赖——"已在树内"指 node_modules，不代表适合进客户端 bundle（百 KB 级解析器代码）。若 bundle 代价不可接受，**粘贴线可改用浏览器自带 CSSOM**：`new CSSStyleSheet().replaceSync(text)` 后遍历 `cssRules`，凡 `CSSImportRule` 即拒——用"将要解释这段 CSS 的同一个引擎"做校验，对转义形态天然免疫（本审阅在 Chromium 实证时用的正是这个判定法）。两侧实现不同，但作者已留口"同一份实现**或同一份测试向量**"——把 `@im\70 ort` / `@\69mport` / `@i\6d port` 等转义样本做成共享测试向量分别钉住两道闸门，"一致的答案"规矩不破。

**3. P3 取 `--n-*` 永久契约面——同意，这是我留给作者的二选一里对的那一个。**
1520 处消费者＋白名单已放开＝依赖只增不减，"将来删层"是空头支票。操作建议：把承诺**写进白名单代码注释**（`--n-*` 是公共契约与向后兼容保证的一部分，删除即破坏性变更）——与 Pi 对 splash 的 inline 注释同理，代码里的注释比文档记录更难被后人漏掉。

### 对批次顺序的一个建议（不构成反对，供作者斟酌）

批 3 装着 P1-1 与 P1-2，而两片对批 1/批 2 **零依赖**（P1-1 是几行 CSS 选择器＋死码清理，P1-2 是 import 切换）。建议把 **P1-1 提进批 1**：改动最小、无依赖、属移动端高发区，且是三批里唯一"用户今天就在承受的行为回归"。P1-2 留批 3 无妨（属收口补遗而非回归）。三批反正都在推送前落地，顺序不阻塞，此条只是顺手优化。

### 其余表态

- **failedId 死锁并入 P1-4 合并修**：正确。两问同根（失败态生命周期），我方复核过 P1-4 证据链，无补充。
- **Pi 追问 1（清单 error 期间选择器显示什么）**：支持"轻度提示"方案（状态点＋"暂时无法验证主题文件"）——完全静默会把"文件可能已删"变成用户隐性风险；但也不要升级成 alert（样式在屏是正常态而非错误态）。
- **Pi 的非主题问题流程风险**：背书。网络代理那条（服务端自身 fetch 不走代理）是 P1 级功能缺陷，转交不能等于蒸发——建议开一条 tracked TODO 列明问题/等级/转交对象/预期闭环时间。**闭环责任人与时间只有项目所有者能定**，本审阅只负责把发现留在可追溯的载体里（已随本节进入文档）。
- **TIP 逐条简答**全部合理。"偏好写入防抖暂不采纳（先观察）"接受，但建议给"观察"留一个判定条件（例如观察到实际的同步写入风暴再议），避免"先观察"变成"永不关闭"。

### 闭环建议

三批落地后、推送前，建议做一次**修复核验轮**：7 条 WARNING 逐条对照修复 diff（每条修法都有可勾的验收断言）、重跑 `test:client`＋`test:theme-tokens` 16 项、§5.7 三条 grep 复测、变异测试证明新护栏非空转（作者体例里已含"测试＋变异＋双绿"，建议并入同一次核验记录）。我或 Pi 均可执行该轮，作者定即可。
