# CloudCLI 终端字体动态配置方案

> 状态：**审定完毕（10 条决策项全部已裁定）＋ 批 1／批 2／批 3 全部实施完毕**，第 1、2、3 轮批注与作者回应见文末，正文已按三轮处置与**实施期更正**更新
> **P1 / P2 由第 3 轮审阅者裁定取 A（与作者主张一致，见 §8.1）；P3～P8 由用户拍板「按作者推荐」全部取 A；P9 / P10 作者已拍板。无遗留待拍板项。**
> **实施：令牌 ＋ 授权面 ＋ 解析层 ＋ 生效链路 ＋ 设置项全部落地，双绿（`test:client` 147/1230 全绿、主题令牌套件 124/0、`lint` 0 error、`build` exit 0）。实施期核出三处计划级更正（fallback 哨兵是死代码、§6.1 的「逐字节相等」是 chromium-only、§6.3 的 `cols/rows` 断言不可证伪），正文已回写，证伪过程见 §10。**
> 范围：前端（`src/`）＋ 主题令牌（`src/index.css`）
> 关联文档：《CloudCLI 主题与配色体系设计方案》（下称「主题文档」），本方案改判其第 34 行、第 649 行两条立场（**三处改判已于 2026-09-28 回写主题文档，互指闭环，见 §4**）
> 本文自包含：审阅无需先读主题文档

---

## 0. 结论先行

做三件事，一次成片：

1. **设置里加「终端字体」**（`terminalFontFamily`），补上「有终端字号、没终端字体」这个不对称。
2. **给 `--term-*` 令牌家族补一个非颜色成员**：`--term-font-family`，由基色层给默认、覆盖层主题可重定义 —— 这就是「配色主题自己维护一个值」。
3. **在 JS 侧按三层优先级解析**：用户设置 ＞ 主题令牌 ＞ 硬编码兜底。

三条关键承诺：

- **零视觉变化**：`--term-font-family` 的基色层默认值 = 现硬编码串，默认设置是「跟随主题」，故未动过设置的用户看到的终端与本方案前**逐字节相同**。
- **零层叠战争**：用户层不进 CSS（走 `localStorage`），主题层走 CSS 变量，两者名字与通道都不同，**不存在「谁压谁」的 CSS 权重设计**，优先级明写在 JS 里一行三元表达式。
- **通道不新建**：`readTerminalTheme()`（`src/modules/shell/utils/terminalTheme.ts:59`）已经是「CSS 令牌 → 浏览器解析 → JS」的桥，字体只是让同一个探针多读一个属性。

**决策项共 10 条**，集中列在 §8，**现已全部裁定**：P1 / P2 由第 3 轮审阅者裁定取 A（作者主张，展开见 §8.1）；P3～P8 由用户拍板「按作者推荐」全部取 A；P9 / P10 作者已拍板。其余章节为实现细节，不需逐条拍。

---

## 1. 现状排查

### 1.1 已有资产（可复用）

| 资产 | 位置 | 本方案如何用 |
| --- | --- | --- |
| 终端字体被硬编码 | `src/modules/shell/hooks/useShellTerminal.ts:28` `fontFamily: 'Menlo, Monaco, "Courier New", monospace'` | 原样搬进基色层默认值，作为零变化基线 |
| 终端字号的读取/持久化 | `src/shared/utils.ts:62` `readFontSettings()`，键 `fontSettings.terminalFontSize` | 新增字段照抄同一模式 |
| 设置变更广播 | `FONT_SETTINGS_CHANGED_EVENT`（`utils.ts:31`），`useShellTerminal.ts:334-346` 已监听 | 扩展到字体，无需新事件 |
| **CSS 令牌 → JS 的桥** | `terminalTheme.ts:59` `readTerminalTheme()`：建隐藏探针 → `probe.style.color = 'hsl(var(--term-x))'` → `getComputedStyle` 读回 | **本方案的核心复用点**：同一招读 `font-family` |
| 主题令牌真源 | `src/index.css:225-251`（22 个 `--term-*` 颜色令牌，`--term-background: var(--palette-term-bg)` 形式；另有 `257-260` 的 4 个语义别名） | 新令牌并列声明在同一块 |
| 覆盖层可压基色层 | 覆盖层 `<style>` 每次 apply 后重挂在 `<head>` 末尾，同权重靠文档顺序取胜（主题文档 1-E/2-H 已实证） | 主题改终端字体**天然可行**，无需新机制 |
| 颜色侧的零变化测试范式 | `tests/theme-tokens/terminal-tokens.spec.ts` 用 `ORIGINAL_BOARD`（原 hex）钉住整条链 | **字体照抄**：`ORIGINAL_FONT_STACK` |
| 令牌预览页 | `src/shared/tokenSnapshot.ts:54` `GROUP_PREFIXES` **已含 `term`**；非颜色值 `swatchColorFor()` 返回 `null` 不配色块（主题文档 4485 行） | 新令牌**自动**出现在预览页，零改动 |

### 1.2 缺口

1. **终端字体不可配置**：硬编码在 `TERMINAL_OPTIONS`，用户选不了。
2. **主题够不着终端字体**：`--term-*` 家族只有颜色；xterm 是 canvas 渲染，CSS 改不动它，必须 JS 读。
3. **两处「不对称」**：设置页有终端字号（`AppearanceSettingsTab.tsx:171-184`）却无终端字体；`--term-*` 家族 22 项全是颜色。

### 1.3 一个反直觉的前提：主题改终端字体**今天做不到**

`console.css`（用户自定义 `.css` 主题）把 `body` 钉成了 JetBrains Mono，但终端仍是 Menlo —— 原因不是主题没写，而是 xterm 的 `fontFamily` 是 JS 字符串，CSS 完全够不着。本方案是这个能力**第一次**被打开。

---

## 2. 设计目标与非目标

### 2.1 目标

- G1：设置页可独立选择终端字体，且能与「跟随主题」互切。
- G2：覆盖层 `.css` 主题与内置主题可通过 `--term-font-family` 改终端字体。
- G3：默认渲染与本方案前逐字节相同。
- G4：切换字体后终端**列数正确**（不是只换字形）。

### 2.2 非目标（明确不做，见 §9）

连字（`fontLigatures`）、`.json` 用户主题开放字体令牌、`.tmTheme` 携带字体、快速设置面板同步、移动端手势缩放时的字体档位。

---

## 3. 设计方案

### 3.1 三层来源与优先级

| 层 | 落在哪 | 谁写 | 作用 |
| --- | --- | --- | --- |
| 兜底 | TS 常量 | 代码 | 主题令牌被删空时的最后一道 |
| **主题层** `--term-font-family` | `src/index.css` 的 `:root` 终端块 | 基色层给默认，覆盖层主题可重定义 | **「配色主题自己维护的那个值」** |
| **用户层** `fontSettings.terminalFontFamily` | `localStorage` | 设置页 | 用户的选择；值 `theme` 表示「不表态，听主题的」 |

**解析优先级（JS 内显式，非 CSS 层叠）**：

```
用户设置（≠ 'theme'） ＞  主题令牌（已声明且非空） ＞  硬编码兜底
```

### 3.2 为什么用户层不进 CSS（被否方案的取舍）

上轮讨论曾提出「双变量」：用户层写 `--ui-terminal-font-family`（内联在 `<html>`）、主题层写 `--term-font-family`。**本方案改为用户层走 `localStorage`**，判据是：

> **一个值该不该落成 CSS 变量，看它有没有「非 JS 的消费者」。**

- 聊天字体 `--ui-font-family` 落 CSS 变量，是因为 `index.css:576-578` 的规则要读它 —— 有 CSS 消费者。
- 终端字体只有 xterm 一个消费者，而 xterm 是 JS（canvas）。落 CSS 变量是**多余的间接层**。

附带好处：用户层不进 CSS ⇒ 两层不成层叠关系 ⇒ 不需要「两个不打架的变量名」这种约定，也少一处「变量为空」的边界。代价是用户选择不出现在令牌预览页 —— 可接受（预览页描述的是**基色与主题**，不是用户偏好）。

**层叠麻烦不是抽象的，仓库里有现成参照。** 审阅第 3 轮 P2A 指出：用户层的既有落点 `useFontSettings.ts:15-19` 把聊天字体写到 `document.documentElement.style` —— 那是**内联样式**（specificity 最高）；而内置主题覆盖层是 `<style>` 里的 `[data-theme="cc-ocean"]` 等规则（`index.css:1525`，specificity `(0,1,0)`）。由此得到一条普适判据：**用户层一旦带上 CSS 表示，优先级就只能由层叠或「读两个值再判」来定，两条都是隐式规则** —— 内联会锁死主题层（G2 失效），读值顺序则把「谁赢」藏进 JS。

（严格的边界：B 的原始形态用 `--ui-terminal-font-family` ＋ `--term-font-family` **两个不同名**变量，本身不成层叠关系，审阅者的结论严格说只对**同名变量**变体成立。写进本节是因为它把「为什么不让 CSS 层叠决定优先级」讲实了。A 让用户层完全不进 CSS、只剩 `localStorage` 一个真源，从根上消灭了这条隐式规则 —— 这是 A 相对 B 的实质优势，不是洁癖。）

**被否方案：属性驱动 + CSS 权重法。** 即设置项写 `<html data-terminal-font="fira-code">`，`index.css` 为每个选项写一条 `:root[data-terminal-font='x'] { --term-font-family: … }`，靠属性选择器 `(0,2,0)` 压过覆盖层的 `:root` `(0,1,0)`。否决理由：新增一个字体选项要在 **CSS 与 TS 两处**各维护一份，是必然漂移；且「设置赢」这件事被藏进权重算术里，读代码看不出来。

### 3.3 令牌：`--term-font-family`

声明在 `src/index.css` 现有终端块内（`225-251` 行同段），紧跟注释之后：

```css
    --term-font-family: Menlo, Monaco, "Courier New", monospace;
```

- **默认值逐字取用 `useShellTerminal.ts:28` 的现状字符串**，这是 G3 的凭据。
- 与颜色令牌不同，它**不参与 `hsl()` 包装**，消费者用裸 `var()`。
- 它**不加入** `TERMINAL_THEME_TOKENS`（`terminalTheme.ts:23`）：那个 map 的键约束是 `satisfies Record<ThemedColourKey, string>`，而 `fontFamily` 属于 `ITerminalOptions` 而非 `ITheme`，类型上就进不去 —— 这是设计正确性的副产品，不是疏漏。
- **它是 `--term-*` 家族首个、也是唯一一个非颜色成员**（审阅第 2 轮 W1a）。核实了 `token-contract.spec.ts` 的现状：**没有任何族级断言会被它绊到** —— `:144` 那条名字写作「no colour token holds a literal value…」，但实际过滤是**按值形状**的（先跳过 `--palette-*` 与 `--editor-*`，再看值是否命中 HSL 三元组 / hex / `rgb()`），字体栈不命中、天然通过；该测试注释里本就有「Size, duration and env() tokens are out of scope」这句先例。处置：**把 font stacks 加进那句 out-of-scope 清单**（一处词级改动），把「term 家族现在不同质」这件事固化在它旁边 —— 将来有人给该家族补族级断言时会先看到这个例外。
- **它必须声明在基色层，这不是可选项。** `theme-overlays.spec.ts:351` 有一条制度性闸门：「an overlay may only redeclare tokens the base stylesheet declares」—— 覆盖层不能引入基色层没有的令牌名（否则该名字只由覆盖层提供，`<html>` 上读为空，基线套件会报 uncovered，所以在这里就被更清楚地拒掉）。因此基色层这一行是**任何主题能改终端字体的前提**，而不是顺手给个默认值。

### 3.4 主题能改，但**不纳入**覆盖层遍历

`tests/theme-tokens/theme-overlays.spec.ts` 用 `SURFACES` / `MUST_MOVE` / `MUST_NOT_MOVE` 静态断言各 coverage 类「承诺动哪些面」。

该文件的遍历集合是 `OVERLAY_THEMES = BUILTIN_THEMES.filter((theme) => theme.appearance === 'system')`（`theme-overlays.spec.ts:45`），即覆盖层主题，其 coverage 实测为（`src/shared/constants.ts:330-374`）：

| 主题 | coverage |
| --- | --- |
| `cc-ocean` | `accent` |
| `cc-polar` | `full` |
| `cc-catppuccin` | `full` |
| `cc-islands` | `full` |

（`cc-light` / `cc-dark` 是 appearance 默认，不带覆盖层，被上述过滤器排除。下表与本节其余文字写于只有三套覆盖层时，结论对**任何** `full` 覆盖层同样成立 —— 2-O 新增 `cc-islands` 后实测未变。）

**关键结论：`--term-font-family` 不得加入 `SURFACES.terminal`。** 两个方向都会错，且这是**机械结果**而非文档约定（`moved` 的定义见 `derivedMoves()`，`theme-overlays.spec.ts:236-249`：**覆盖层只要重新声明就计入 `moved`，与值是否等于基线无关**）：

- `MUST_MOVE.full` 含 `SURFACES.terminal`，其断言是 `mustMove = MUST_MOVE.filter((name) => !moved.has(name))` ⇒ **不声明**就进 `mustMove`、直接红。于是 `cc-polar` / `cc-catppuccin` 被**强制**必须声明终端字体 —— 它们只是配色主题，不该被要求改字体。
- `MUST_NOT_MOVE.accent` 同样含 `SURFACES.terminal`，其断言是 `mustNotMove = MUST_NOT_MOVE.filter((name) => moved.has(name))` ⇒ **声明了**就进 `mustNotMove`、直接红。于是 `cc-ocean` 被**禁止**声明终端字体 —— 一个 accent 主题顺手想改字体都不行。

因此字体令牌对覆盖层是**可选**的，不纳入该遍历（本方案**不改** `theme-overlays.spec.ts`）。它的「覆盖层能不能改」由 §6.2 的独立断言证明。

**另一条相关测试的影响（审阅第 2 轮 W2）**：`theme-overlays.spec.ts:484` 的 `the accent theme is the identity when no overlay is picked` 断言「挂上 appearance 默认 id（`cc-light` / `cc-dark`）时，整张已解析令牌表与无主题态无差异」。`--term-font-family` 只在基色层 `:root` 声明一次、两种 appearance 下都解析，故该测试**仍通过**。但它的覆盖面比名字窄：它只遍历 `BUILTIN_THEMES.filter((t) => t.appearance !== 'system')`，**不覆盖三套覆盖层主题**，因此拦不住「有人把字体令牌误加进 `cc-polar` 的 overlay」—— 那归本节的 `SURFACES` 约定与 §6.2 的独立断言。

**由此得一条硬约束（同时写进 §6.5）**：本片**不改任何 `[data-theme]` 块**，`--term-font-family` 在整仓只出现一次（基色层 `:root`）。这既是「既有键 0 漂移」的成立条件，也是 W2 那条恒等测试保持通过的原因。

### 3.5 设置项

- 选项集合：`'theme'` ＋ 复用 `CODE_FONT_FAMILY_OPTIONS` 的 7 项（`system` / `jetbrains-mono` / `fira-code` / `cascadia-code` / `source-code-pro` / `hack` / `ibm-plex-mono`）。终端是等宽场景，与代码字体同集合，语义正好。
- 字体栈表：复用 `CODE_FONT_FAMILY_CSS`（`utils.ts:55`）。**不新建表** —— 单一来源，避免两份 "Fira Code" 栈漂移。`'theme'` 是伪 id，无对应栈，由 §3.6 的解析短路。
- 默认值：`'theme'`。**老用户没有 `fontSettings.terminalFontFamily` 这个键 → `get()` 返回 `null` → 回落 `'theme'` → 拿到基色层默认串 → 零变化**（G3 的第二条凭据）。
- **与「代码字体」下拉的形态差异是刻意的**（审阅第 3 轮 P1A）：同一个设置页里，`codeFontFamily` 默认是具体值 `'system'`（`utils.ts:59`），下拉直接遍历 `CODE_FONT_FAMILY_OPTIONS`（`AppearanceSettingsTab.tsx:231-235`）、**没有**伪选项；而 `terminalFontFamily` 默认 `'theme'`、多一个伪选项。根据是**通道不同**：代码字体没有 `--code-*` 式主题令牌通道，给不出「跟随主题」；终端字体因本片新增 `--term-font-family` 而**必须**有这一档 —— 否则用户一旦选了具体字体就再也回不到主题默认。**不要为「两个下拉长得一样」而删掉伪选项**，那等于关掉 G2。
- UI 文案复用：7 个具体字体的 label 复用 `appearanceSettings.fontSettings.codeFontFamilyOptions.*`，只新增一个键给 `theme`。

### 3.6 解析链路（本方案最需要小心的一处）

新增到 `src/modules/shell/utils/terminalTheme.ts`（同模块，复用探针模式，零新文件）：

```ts
/**
 * 主题层声明的终端字体栈，未声明时返回 null。
 *
 * 判「有没有值」与判「解析成什么」分成两步 —— 不能只留后者：
 * `font-family` 是可继承属性，令牌无值时探针那条声明在计算值阶段失效、
 * 对该属性等价于 `inherit`，于是它会静默读到 body 的字体栈 —— 一个真实
 * 的字体栈，下游无从分辨它是不是主题声明的。
 *
 * 所以先问令牌的 computed value：自定义属性无值时 `getPropertyValue`
 * 返回 `''`，把「无人声明」与「声明为空」归到同一处置（这两类都该回落）。
 */
export function readThemedTerminalFontFamily(): string | null
```

实现要点：

1. 先读 `getComputedStyle(document.body).getPropertyValue('--term-font-family').trim()`；**为空串 ⇒ 返回 `null`**。实测：令牌**完全未声明**、声明在 `:root` 的**空值**、声明在 `body` 的**空值**，三者在 `body` 上都读回 `''`（同形 —— 都该回落，同形正好）；正常值（基色层默认串）则原样继承可见。
   - **它同时覆盖「空值」那一类**：`.css` 主题可以写 `--term-font-family: ;`。空的自定义属性**不是** guaranteed-invalid，它替换为空 token 流，于是整条声明在计算值阶段失效，而 `var()` 的 **fallback 参数不会启用**（实测：宿主 `--x: ;` + `var(--x, "__S__")` 读回 `"Body Font", monospace`，不是哨兵）。
   - **读原始值必须读 `body`，不能读 `documentElement`** —— 与探针同一观测点。否则会重新引入 C1 那处作用域分裂（html 读空、body 有值）。这条不是顺手，是 C1 的教训。
2. 非空 ⇒ 探针写 `probe.style.fontFamily = 'var(--term-font-family)'`，读 `getComputedStyle(probe).fontFamily` 并返回。
3. 探针沿用 `readTerminalTheme()` 的三条既有约定：`display: none`、`transition: none`（绕开 `index.css` 的 200ms 颜色过渡）、以及 `try/finally` 里 `probe.remove()`。
4. **探针必须与颜色通道挂在同一观测点（`document.body`）**。这不是随意选择：`readTerminalTheme()` 的探针就在那里（`terminalTheme.ts:63`）。两条通道的「作用域可见范围」若不一致，就会出现「`.css` 主题把令牌写在 `body` 时颜色生效、字体不生效」的分裂（审阅第 1 轮 C1/W3）。第 1 步读原始值同样读 `body`，两处对齐后**不需要**额外约定「必须写在 `:root`」 —— `body` 层声明照常生效。
5. **为什么没有 `var()` 的 fallback 哨兵**：原设计用哨兵承担「未声明」这一档（`var(--term-font-family, <哨兵>)`），理由是「未声明会让探针读到 body 栈」。**实施期实测证伪**：未声明的令牌同样让原始值读回 `''`，第 1 步已完整覆盖该档；删掉哨兵后负样本**一条都不红**（11 passed / 0 failed）—— 哨兵是**无可区分输入的死代码**，已删。证伪过程见 §10。

**已知限制（`.css` 路径上仍开着的一条）**：原始值非空、但替换后的 token 流对 `font-family` **不合法**时（如 `--term-font-family: 0 0% 0%`），价值检查不触发 —— 声明在计算值阶段被丢弃，探针读到 body 的字体栈，函数把它当主题字体返回。这与 R10 是**同一个症状的两个入口**：R10 堵的是 `.json` / `.tmTheme` 的令牌路由，这条是 `.css` 主题原样注入、无校验的残余缺口。

处置：**如实记为已知限制，不加启发式**。曾考虑「读回值等于 body 的 `fontFamily` 即视为可疑」的温和防御，**否决**：主题若用 `var(--ui-font-family)` 之类**有意**把终端字体对齐 UI 字体，原始值与被解析值不同，该启发式会误判并把它降级成 Menlo。代价（一个会误伤的启发式）大于收益（一个需要作者写错才会出现的退化态）。后果如实说明：此时终端拿到的是 body 的字体栈，若它是比例字体，等宽前提被破坏（xterm 仍按量出的宽度排版，表现为字形错位而非崩溃）。

解析函数：

```
terminalFontFamily === 'theme'  →  readThemedTerminalFontFamily() ?? FALLBACK_TERMINAL_FONT_FAMILY
否则                            →  CODE_FONT_FAMILY_CSS[terminalFontFamily]
```

**兜底值的唯一来源**：把它作为**导出的常量**（`FALLBACK_TERMINAL_FONT_FAMILY`）定义在 `terminalTheme.ts`，由 `useShellTerminal.ts` 的 `TERMINAL_OPTIONS.fontFamily`（`:28`）**引用它**，不再自带字面量。

> **方向不能反。** 必须是「hook → theme 模块」：`useShellTerminal.ts` 本来就导入 `terminalTheme.ts`（`readTerminalTheme`），而 `terminalTheme.ts` **不导入** hook —— 若把兜底常量放在 hook 里再让 `terminalTheme.ts` 去引用（审阅 Pi-P4 建议的字面做法），就形成**循环导入**。写成 `terminalTheme.ts` 导出、hook 引用即可避开。

`index.css` 的 `--term-font-family` 是该常量在 CSS 侧的镜像（无法消灭 —— §3.3 的制度闸门要求基色层必须声明），两处互相注释，并由 §6.1 的真引擎断言把两者钉在一起。**字面量总数：1（TS）＋ 1（CSS）。**

**注意值形状**：`getComputedStyle().fontFamily` 返回的是**浏览器规范化后的字体栈**，且规范化规则**因引擎而异**：

- **引号形态由「串里有没有空格」决定**：带引号但无空格的 `"FiraCode"` → 读回去掉引号；无引号但含空格的 `Fira Code Retina` → 读回**加上**引号。
- **WebKit 还会把基色层默认串里的 `"Courier New"` 也去掉引号**（chromium 保留）。所以 **§6.1 的「逐字节相等」只在 chromium 成立**，跨引擎的契约是**去引号后的家族列表相同** —— 那才是 xterm 真正消费的东西，G3 的语义由它保证。断言按此写，详见 §6.1 与 §10。

**调用时机的前提**（审阅第 3 轮新发现）：本函数读 `getComputedStyle(document.body)` 并往 `document.body` 挂探针，因此**假定 `document.body` 已存在**。生产侧无虞（`useShellTerminal` 的 effect 在 React 挂载后运行）；fixture 侧也已由现有结构保证 —— `tests/theme-tokens/index.html` 用 `<script type="module" src="/main.ts">` 且置于 `</body>` 之前，模块脚本默认 defer，执行时 body 必已就绪（同页顶层的 `buildProbes()` 本就依赖同一前提）。**新增调用需守这个前提**：脚本若改在 `<head>` 同步执行，`document.body` 会是 `null`，`getComputedStyle(null)` 抛 TypeError。

### 3.7 生效链路与字体加载时序

`useShellTerminal.ts` 四处改动（实施后的形态）：

1. **初始化**：`fontFamily: resolveTerminalFontFamily(fontSettings.terminalFontFamily)`，且首个 fit 走共用的 `fitAfterFontReady()`（见下）。
2. **设置变更**（扩展原 `:334-346` 的 effect）：字体与字号一并处理，走同一个 `fitAfterFontReady()`；**字号路径也改成 fit + 发 resize**（§3.8）。
3. **主题变更**（扩展原 `:354-361` 的 effect）：与颜色一并重读。因 `--term-font-family` 与其他 `--term-*` 同为覆盖层可改的令牌，这里同样调用 `applyTerminalFont()` —— 一套覆盖层的明暗两块甚至可能声明不同字体。
4. **`TERMINAL_OPTIONS.fontFamily`** 改为引用 `FALLBACK_TERMINAL_FONT_FAMILY`，不再自带字面量（§3.6）。

**两条路径共用同一个原语** `fitAfterFontReady(terminal, terminalRef, fitAddonRef, wsRef)`：**等字体就位 → 清字形图集 → `fit()` → 发 `resize`**，并在等待之后重新确认终端未被销毁。初始化与「字体/字号/主题变更」四个调用点全部走它，所以 §6.3 的次序断言按构造同时覆盖初始化与切换两条路径 —— 这是把原先分成两段的重复代码收成一个原语的直接收益。

**为什么清字形图集**：`terminal.clearTextureAtlas()` 确实存在于 `@xterm/xterm`（typings `:1249`）。字形宽度接近时 `fit()` 可能不改变 `cols/rows`，纹理图集里会残留旧字形的位图（审阅第 1 轮 C3）。jsdom 桩终端没有该方法，故生产代码写 `?.()`。

**必须处理：Web 字体的度量时序。** 先纠正一处易犯的事实错误：

- `src/index.css` 只有两个 `@font-face`：**Encode Sans（`:8`）与 JetBrains Mono（`:19`）**。
- 因此 `CODE_FONT_FAMILY_CSS` 的 7 个选项里，**只有 `jetbrains-mono` 是应用自托管的 Web 字体**；`fira-code` / `cascadia-code` / `source-code-pro` / `hack` / `ibm-plex-mono` 全是**系统字体**。
- 系统字体的「有 / 没有」是二值的：本机有就立刻可用，没有就永久回落 —— **不存在「稍后到达」**。所以度量时序问题**只对 `jetbrains-mono` 真实存在**（而它恰是最可能被选中的那一个）。

处置：**在 fit 之前**确保字体就位 —— 两个调用点都通过 `fitAfterFontReady()`：

- **初始化路径**：`:262-272` 的 `setTimeout(..., TERMINAL_INIT_DELAY_MS = 100)` 等的是**容器布局**，不是字体 —— 而「用户在设置里选了 Web 字体」是持久化的，这意味着**每次冷开终端**初始字体都是 Web 字体（比手动切换常见得多）。处置：首次 fit 走同一个原语，即「布局等待」与「`document.fonts.load(...)`」**两者都完成之后**才 fit。
- **切换路径**（设置变更 / 主题变更）：同一个原语，同样 `await` 之后再 fit + resize。
- **防御性调用**：`test:client` 跑在 **jsdom**（`vitest.config.ts:17`），`document.fonts` 是 `undefined` —— 直接调用会抛 TypeError。生产代码写成 `document.fonts?.load(...)`（`await undefined` 立即完成）。
- **家族名与 `@font-face` 逐字一致**（审阅第 2 轮 W4）：`@font-face` 是 `font-family: 'JetBrains Mono'`（`index.css:19`），`CODE_FONT_FAMILY_CSS['jetbrains-mono']` 的栈首正是 `"JetBrains Mono"` —— 已核实逐字一致（含内部空格）。`fonts.check` / `fonts.load` 的家族名必须与 `@font-face` 逐字相同，否则 §6.3 的前置断言会从「门」变成「常红」。断言对象是**栈首那个自托管 face**，不是整条栈。
- **不加「仅当栈首是自托管 face 才 `await`」的分支**（审阅第 2 轮 C4 的备选，**否决**）：默认用户的栈 —— `theme` → `Menlo, Monaco, "Courier New", monospace`，`system` → `ui-monospace, SFMono-Regular, Menlo, …` —— **都不含自托管 face**，`load()` 立即 resolve、无可测开销；为一个不存在的开销加一个前置判定，等于把「栈首是不是 `@font-face` 家族」这个脆弱判断塞进初始化路径。采纳其另一半：jsdom 下 `document.fonts?.` 必须真的短路（`undefined?.load(...)` 返回 `undefined`，`await undefined` 立即完成），§6.3 的初始化路径断言顺带验证它。

**为什么首选 `load()` 而不是 `document.fonts.ready`**：`ready` 表示「当前所有已开始的加载都完成」，对**尚未被请求**的字体可能立即 resolve —— 那正好是我们需要等待的那种情况。`load()` 会主动请求并等它。字体名不存在时 `load()` 也会 resolve（返回空数组），所以「用户选了本机没装的系统字体」不会卡住流程。

**照哪段代码写**：照 `:173-187` 的 `onFontSizeChange`（它 **fit ＋ 发 resize** 都做了）。注意该 handler 与 `:334-346` 的 `applyFontSize` 是**同一个 effect**（同一个 `FONT_SETTINGS_CHANGED_EVENT` 监听器），故本片统一为 fit + resize —— 见 §3.8。

### 3.8 与字号路径的合并（原「相邻问题」升级为本片动作）

`useShellTerminal.ts:334-346` 处理「设置页改终端字号」时只调用 `terminal.refresh()`，既未 `fit()` 也未向 pty 发 `resize`；而移动端手势缩放走的 `:173-187` 两件都做了。

本方案**一并修复这个缺口**，理由三条：

1. 字体变更**必须** fit（否则 G4 不成立），而它与字号**共用同一个事件监听器**（`:335-342` 是 `FONT_SETTINGS_CHANGED_EVENT` 的唯一 handler）—— 实现者无法做到「只给字体 fit、给字号保持 refresh」而不显式拆分支；
2. 字号变更同样需要 fit（字号变了 `cols/rows` 也变），现状的「只 refresh」本身就是缺口；
3. 若只给字体加分支，会留下「同一个 handler 里两种处置」的怪形状，后来者极可能「顺手统一」回去 —— 那等于把缺口永久化。

代价：本片范围扩到修复该既有缺口，并补一条**字号路径**的 resize 断言（§6.3）。

---

## 4. 与主题文档的冲突与改判

| 主题文档原条款 | 原立场 | 本方案改判 |
| --- | --- | --- |
| 第 34 行 | 「字体令牌…与主题正交，无需改动」 | 改为：`--ui-font-*` / `--ui-code-font-*` 与主题正交；**新增 `--term-font-family` 属 `--term-*` 令牌家族，与主题相关** |
| 第 649 行 | 「主题可选择性覆盖，但默认不应覆盖用户字体选择」 | **本方案让这半句第一次真正落地**：终端此前是 canvas，主题根本没有覆盖能力；现在有能力了，而 §3.1 的三层优先级正是「可选择性覆盖，且不覆盖用户选择」的实现 |
| 附录 A 令牌清单 | 终端颜色令牌一栏 | 追加 `--term-font-family`（该家族首个非颜色成员；顺带订正该清单对终端令牌的计数） |

> **回写状态（2026-09-28）**：上表三处**已全部在主题文档落笔**，主题文档侧并反向标注本方案为改判来源——§1.1「字体令牌」行（第 34 行）、§5.9「字体设置」行（第 649 行）、附录 A 终端栏（追加 `--term-font-family`，并把 L1 `--palette-term-*` 与该行 L2 的计数分别写明为 **20 / 22**，家族含字体共 23）。本方案与主题文档的互指至此闭环，无遗留。

---

## 5. 实现清单

### 5.1 生产代码

| 文件 | 改动 |
| --- | --- |
| `src/shared/types.ts` | 新增 `TerminalFontFamilyId = CodeFontFamilyId \| 'theme'`；`FontSettingsState`（`:1610`）加 `terminalFontFamily` |
| `src/shared/utils.ts` | 新增 `TERMINAL_FONT_FAMILY_OPTIONS`（`theme` + `CODE_FONT_FAMILY_OPTIONS`）；`DEFAULT_FONT_SETTINGS`（`:59`）加 `terminalFontFamily: 'theme'`；`readFontSettings()`（`:62`）加校验回落；`writeFontSettings()` 无需改 |
| `src/shared/userThemeTokens.ts` | **授权面收紧**（不是顺带改，见 §8-P3 与回应 Pi-P1／Pi-P3）：`--term-font-family` 落在 `/^--term-[a-z-]+$/` → `triplet-or-reference`，会让 `.json` / `.tmTheme` 主题写进一个「通过校验但 `font-family` 无效」的值。须在 `FAMILY_RULES` **之前**显式不授权 |
| `src/index.css` | 终端块（`:225-251`）加 `--term-font-family: Menlo, Monaco, "Courier New", monospace;`（**须与 `FALLBACK_TERMINAL_FONT_FAMILY` 逐字相同**，见 §3.6） |
| `src/modules/shell/utils/terminalTheme.ts` | 新增 `readThemedTerminalFontFamily()`、解析函数，以及**导出的兜底常量** `FALLBACK_TERMINAL_FONT_FAMILY`（§3.6；定义在这里是为了避开循环导入）。解析只做两步：**价值检查**（读原始值，空即 `null`）＋ 探针读回；**不含哨兵**（实施期证伪删除，§10 更正 1） |
| `src/modules/shell/hooks/useShellTerminal.ts` | 六处：初始化传 `fontFamily`；首个 fit 等字体就位；设置变更 effect 扩展；主题变更 effect 扩展；改字体后 `clearTextureAtlas()`；§3.8 的 fit + resize 统一。**`TERMINAL_OPTIONS.fontFamily`（`:28`）改为引用 `FALLBACK_TERMINAL_FONT_FAMILY`**，不再自带字面量 |
| `src/modules/quick-settings-panel/hooks/useChatFontSettings.ts` | **本片必需项**（审阅第 1 轮 W6）：该 hook 在 `:59-70` **显式** return 5 个字段 + 5 个 setter，新增字段不会自动透出；而设置页正是经它读值（`AppearanceSettingsTab.tsx:13,46`）。须加 `terminalFontFamily` getter 与 `setTerminalFontFamily` setter（setter 内一并 `writeFontSettings` ＋ 派发事件） |
| `src/modules/settings/tabs/AppearanceSettingsTab.tsx` | 在「终端字号」（`:171-184`）**之后**插入「终端字体」`SettingsRow`（与终端字号相邻成组，语义优于挂在末尾） |
| `src/modules/i18n/locales/{en,zh-CN,zh-TW}/settings.json` | 各加 3 键：`fontSettings.terminalFontFamily.{label,description}`、`fontSettings.terminalFontFamilyOptions.theme`。**三端而非两端**：实测 en / zh-CN / zh-TW 的 `fontSettings` 键集**完全相同**（差集为空），zh-TW 是一套完整翻译；只加两端会让 zh-TW 的同一个下拉里新增项回落成英文（`fallbackLng: 'en'`）而其余项是中文。**三端与否取决于 §8-P8 的裁定**：补则三端；不补则改回两端并在验收记一条已知不一致 |

**i18n 纪律**（沿用本仓库既有约定）：键集基准是 `en`，`zh-CN` 为子集，新增键**一起写**。7 个具体字体的 label 复用 `codeFontFamilyOptions.*`，不复制一份。

### 5.2 测试

| 文件 | 改动 |
| --- | --- |
| `tests/theme-tokens/main.ts` | fixture 暴露 `readThemedTerminalFontFamily()`、`resolveTerminalFontFamily()`、`fallbackTerminalFontFamily`，以及**零防御对照** `probeFontFamilyWithoutFallback()`（照 `:530` 暴露 `readTerminalTheme` 的写法）。**硬约束：不得把它加进 `TERMINAL_PROBE_TOKENS`（`:49-55`）** —— 那个数组经 `:158` 映射为 `{ property: 'color' }` 的探针，会给字体令牌写 `hsl(var(--term-font-family))`，非颜色值下该声明无效、`rendered` 段会读到继承色，凭空多出一条语义无意义的基线记录并打破 §6.5 的增量预言。**增量只应出现在 `tokens` 段** |
| `tests/theme-tokens/terminal-tokens.spec.ts` | 新增 `ORIGINAL_FONT_STACK` 常量（原硬编码串；注释按 §6.1 写「以**去引号后的家族列表**为契约，引号形态因引擎而异」）＋ §6.2 的**七档**优先级与作用域断言、§6.3 的度量与初始化路径断言、§6.4 的单条价值检查变异夹具（未声明 ＋ 空值两档） |
| `tests/theme-tokens/token-contract.spec.ts` | **注释级改动 ＋ 一行显式豁免**：把 `font stacks` 加进 `:144` 那条的 out-of-scope 清单（§3.3），把「term 家族不再同质」固化在家族断言旁边。**无颜色断言改动** —— 该测试按值形状过滤（`:148-157` 判 `HSL_TRIPLET` / hex / `rgba?(`），字体栈天然通过。**审阅第 3 轮建议的代码级守卫（断言读回值不含 `hsl(`）不采纳**：风险在这条按值形状过滤的**实现**里，而读回值恒不含 `hsl(`（非法值落 body、合法值是字体栈）⇒ 无区分输入、不可证伪，锁不到那个重构。对症形式是把豁免从**形状隐式**改为**显式名单**：在 `:151-152` 两个 `continue` 旁显式列出 `--term-font-family` 并注明「字体栈不是颜色（§3.3）」——一行、位置就在过滤逻辑内（按族重构时必被读到）。**如实标注：它同样不可被当前测试证伪**（形状本就豁免），买的是「重构时被看见」而非「红灯」 |
| `tests/theme-tokens/token-preview.spec.ts` | 新增「`term` 组存在 `--term-font-family` 条目且两个 swatch 均为 `null`」（§6.6） |
| `tests/theme-tokens/token-baseline.json` | **需刷基线**（见 §6.5） |
| `tests/theme-tokens/vite.config.ts` | **夹具基础设施**：加 `publicDir` 指向仓库的 `public/`。否则 `index.css` 的 `@font-face` URL（`/fonts/jetbrains-mono.woff2`）在 fixture 里 404，`document.fonts.load()` 抛 `NetworkError` —— §6.3 的「字体确实迟到」那条会红在错误的原因上（实施期实测到过） |
| `src/shared/tests/userThemeTokens.test.ts` | `--term-font-family` 提交任何值都必须被 `ignored`（回应 Pi-P1／Pi-P3 的授权面收紧） |
| `src/shared/tests/fontSettings.test.ts` | **新增**：`readFontSettings()` 的终端字体 —— 缺键 → `'theme'`、非法值 → `'theme'`、合法值原样保留 |
| `src/modules/shell/tests/shellTerminalThemeRefresh.test.tsx` | **本片必需项**：该文件的 `vi.mock('@/modules/shell/utils/terminalTheme', …)`（`:26-28`）原先**只桩了 `readTerminalTheme`** —— hook 一旦导入并调用新函数就会拿到 `undefined`、调用即 TypeError，**现有测试直接崩**。扩桩后补四条：字体选择落到 `options.fontFamily` ＋ 清图集 ＋ fit ＋ 发 resize；字号变化同样 fit ＋ 发 resize（§3.8）；无变化的事件不重排；**`fit()` 在 `document.fonts.load()` 之后**（§6.3）。 |
| `src/modules/settings/tests/appearanceTerminalFont.test.tsx` | **新增**：终端字体下拉渲染（`theme` 伪选项 ＋ 全部等宽 face，label 键逐个点名）与写回 `fontSettings.terminalFontFamily` |

**两套环境的分工（写进测试注释，避免后来者误以为 jsdom 覆盖了解析层）**：`readThemedTerminalFontFamily()` 依赖 `var()` 解析与 `getComputedStyle`，**只有** `tests/theme-tokens/`（Playwright 真引擎）能真跑；vitest/jsdom 侧只能测纯逻辑（`readFontSettings` 的回落）与**调用行为**（桩终端上 `options.fontFamily` 是否被写入、`fit`/`resize` 被调用的次数、事件派发是否触发重读）。

---

## 6. 验收标准（DoD）

### 6.1 零变化（G3）

**前提：零变化基线取「无主题态」** —— 即 `<html data-theme>` 清空、且无用户项时读。理由：`--term-font-family` 是覆盖层可改的令牌，一旦 `<html>` 上挂着 `data-theme="cc-polar"`，读到的就是该覆盖层的值。`token-contract.spec.ts:45-53` 的 `captureSnapshot` 每次 `page.goto('/')` 后直读、不设 `data-theme`，故基线天然是这一态。同一前提也解释了 §6.5 里新键的**值形状是字体栈**（不是 HSL 三元组）。

- **真实引擎**：不设任何用户项时，`readThemedTerminalFontFamily()` 读回的**家族列表（去引号后）**等于 `ORIGINAL_FONT_STACK`，也就是 `FALLBACK_TERMINAL_FONT_FAMILY` 的家族列表（该常量的字面量取自 `useShellTerminal.ts:28` 的现状串）—— 两个常量本身逐字节相同，跨引擎要比较的是读回之后、去引号之前的那一层。
- **这条相等的性质是「以浏览器序列化后的形状为契约」，且契约跨引擎只能定到「家族列表」一级**（审阅第 2 轮 C3 ＋ 实施期更正 2，见 §10）。实测：
  - 引号形态由「串里有没有空格」决定：含空格的 `"Courier New"` 在 chromium 保留双引号；无空格的 `Menlo` / `Monaco` / `monospace` 本就不带引号。
  - **反例（证明规则的方向）**：`Fira Code Retina, monospace` → 读回 `"Fira Code Retina", monospace`（无引号但含空格的名字**被加上**引号）；`"FiraCode", monospace` → 读回 `FiraCode, monospace`（无空格的多余引号**被去掉**）。
  - **跨引擎差异（实施期实测，chromium vs webkit）**：基色层默认串 `Menlo, Monaco, "Courier New", monospace` 在 chromium 读回**同形**（逐字节相等成立），在 **WebKit 读回 `Menlo, Monaco, Courier New, monospace`（`"Courier New"` 的引号被去掉）**。⇒ **「逐字节相等」是 chromium-only 的断言**，不能写成跨引擎契约；把它写成字符串全等会让 6 条断言在 webkit 全红。改为「**去引号后的家族列表相同**」后两引擎皆绿，G3 语义（xterm 解析出的家族与顺序不变、渲染逐像素相同）不受影响 —— 引号只在名字含空格时才承载语法意义，去掉后家族名不变。
  - 故 `ORIGINAL_FONT_STACK` 的常量注释须写：「本串的**家族列表**在 `getComputedStyle().fontFamily` 序列化下不变（引号形态因引擎而异，比较前统一去掉）；**若将来改基色层串，常量与断言都按读回形状同步改**，不要按源码字面量改，否则一次合法改串会被当成回归。」
- **令牌契约**：`token-baseline.json` 刷新后，`token-contract.spec.ts` 第一条（已解析令牌值不得漂移）**0 漂移**。
- **颜色不受牵连**：`terminal-tokens.spec.ts` 既有的 `ORIGINAL_BOARD` 全部断言不变（本方案不碰颜色）。

### 6.2 三层优先级与作用域（G1／G2）

七条断言，覆盖每一档：

| # | 夹具 | 期望 |
| --- | --- | --- |
| 1 | 无用户设置、基色层 | 原硬编码串的**家族列表**（引号形态因引擎而异，见 §6.1） |
| 2 | 注入测试覆盖层 `[data-theme="<测试 id>"]:not(.dark) { --term-font-family: "Fira Code", monospace }` | 读到 Fira Code 栈 |
| 3 | 覆盖层如 #2，且用户设为 `fira-code` / `jetbrains-mono` | 读到**用户**的栈（用户赢） |
| 4 | 覆盖层如 #2，用户设为 `theme` | 读到**覆盖层**的栈 |
| 5 | 令牌声明在 **`body`**（模拟 `.css` 主题的既有书写习惯） | **读到该栈** —— 证明探针观测点与颜色通道一致，`body` 层声明不被静默忽略 |
| 6 | 令牌**完全未声明**（负样本） | 解析函数返回 `null`、回落 `FALLBACK_TERMINAL_FONT_FAMILY` —— 证明 §3.6 第 1 步的**价值检查**生效，未声明**不会**静默读到 `body` 的字体栈 |
| 7 | 令牌**声明为空**（`--term-font-family: ;`） | 同上返回 `null`、回落 —— 同一条价值检查也覆盖空值（空值不是 guaranteed-invalid，`var()` fallback 对它**不启用**，见 §6.4 实测表） |

**第 2 档的选择器必须是真实主题的形态**（审阅第 2 轮 W1b）：内置覆盖层由 `themeOverlaySelector()`（`userThemeTokens.ts:308-311`）生成 `[data-theme="<id>"]:not(.dark)` / `[data-theme="<id>"].dark`，`.css` 用户主题也走同一套作用域写法。若夹具注入一个裸 `:root` 规则，测的就是一个真实主题不会写的作用域。

第 5～7 条直接回应审阅第 1 轮的 C1 / W3 与第 2 轮的 C1，逐条对应 §6.4 实测表的第 2、5、6 行。第 6、7 两档共用**同一条**价值检查（原设计的哨兵在实施期被证伪删除，见 §10）。

### 6.3 度量正确（G4）

**先说清这条能被测到什么程度**（实施期更正 3，见 §10）：原计划拿 `cols/rows` 比较「等字体就位 vs 不等」，**那条断言不可能失败** —— 7 个选项与全部回落栈都是等宽字体、字宽都在 0.6em 附近。实测（chromium，14px，canvas `measureText('M')`）：

| 字体 | 字宽 |
| --- | --- |
| `Menlo, Monaco, monospace` | 8.4287 |
| `ui-monospace, SFMono-Regular, Menlo, Monaco, monospace` | 8.4287 |
| `monospace`（通用回落） | 8.4014 |
| `"JetBrains Mono", monospace`（**未加载**） | 8.4014 |
| `"JetBrains Mono", monospace`（**已加载**） | 8.4000 |

差值 0.03px 量级：任意现实宽度下取整后的 `cols` 都相同（400px 宽两种栈都是 47 列）。**夹具选不出一条能分辨的字体，所以这条不写** —— 一条不可能失败的断言比没有更糟。

**把命题拆成两段，各自可证伪**：

1. **「字体确实迟到」**（真引擎，`tests/theme-tokens/terminal-tokens.spec.ts`）：`document.fonts.check('14px "JetBrains Mono"')` 先 `false`、`await document.fonts.load(...)` 后 `true`。**夹具字体用 `jetbrains-mono`** —— 它是 7 个选项里**唯一由应用自托管**（`index.css:19` 的 `@font-face`）的 face；其余 6 个是系统字体，「有 / 没有」是二值的，不存在「稍后到达」（§3.7）。这条对「字体到底能不能到」是敏感的：实施期 fixture **没有**把仓库的 `public/` 挂出去，字体 URL 404、`load()` 抛 `NetworkError` ⇒ 该测试红；`tests/theme-tokens/vite.config.ts` 补上 `publicDir` 后才绿。
2. **「我们确实等了」**（jsdom，`src/modules/shell/tests/shellTerminalThemeRefresh.test.tsx`）：把 `document.fonts` 桩成记录调用次序的对象，断言 `fit()` 发生在 `load()` **之后**。删掉等待 ⇒ 恰 1 红。

**两条路径的覆盖**（审阅第 1 轮 Pi-P3 指出初始化路径才是高频路径）：

1. **切换路径**：设置事件 → 等 `load` → 清图集 → `fit()` → 发 `resize`（`cols/rows` 用当前值）。
2. **初始化路径**：与切换路径**共用同一个 `fitAfterFontReady()`**（§3.7），因此第 2 条次序断言按构造也覆盖初始化路径 —— 这正是把两段重复代码收成一个原语的收益。

另补一条**字号路径**断言（§3.8 的范围扩张）：改字号后同样 `clearTextureAtlas` + `fit` + 发 `resize`（删掉那条 fit ⇒ 恰 1 红）。

**resize 次数的预期（审阅第 2 轮 W5）**：不承诺跨路径去重，但要把各路径的预期写清。已核实两条路径的触发频率：

- 手势缩放（`mobileTerminalSelection.ts:703-725`）**已节流**（`ZOOM_THROTTLE_MS`），且只在**整数档位真的变化**时回调 ⇒ 一次捏合产生的是若干个离散档位、每档一次 fit + resize，不是逐帧风暴。
- 设置页事件每派发一次 ⇒ 一次 fit + resize。
- 两条路径由不同触发器驱动（触摸手势 vs `FONT_SETTINGS_CHANGED_EVENT`），**不存在常规的交叠路径**（除非用户同时捏合又改设置）。

故断言写成「**每个档位变化 ⇒ 恰一次 fit + 一次 resize**」，**不做跨路径去重**。若将来实测 pty 侧对连续 resize 有可感抖动，再单独立项加去重 —— 而不是在实现期顺手塞一个「最近一次」时间窗（那会让「一次交互几次 resize」变成不可断言的行为）。

### 6.4 价值检查不是多余的（实测 + 变异可证伪）

§3.6 的**价值检查**必须能被证伪，否则是一段无法被测试的防御代码。它要覆盖的档由一张**实测表**决定（2026-09-27，chromium，宿主 `body { font-family: "Body Font", monospace }`，探针挂 body）：

| 宿主对 `--x` 的声明 | `var(--x, "__S__")` | `var(--x, __S__)` | 裸探针 `var(--x)` |
| --- | --- | --- | --- |
| 未声明 | `__S__` ← **引号被规范化掉** | `__S__` | **body 字体栈** |
| `--x: ;`（空值） | **body 字体栈** | **body 字体栈** | body 字体栈 |
| `--x: invalid` | `invalid` | `invalid` | `invalid` |
| `--x: 0 0% 0%` | **body 字体栈** | **body 字体栈** | body 字体栈 |
| `--x: "Fira Code", monospace` | `"Fira Code", monospace` | 同 | 同 |
| `--x: "__cloudcli sentinel__"`（含空格串） | `"__cloudcli sentinel__"` | 同 | 同 |

三条读数直接决定设计：

1. **空值与「替换后对 `font-family` 非法」都会落回 body 栈**（`var()` 的 fallback **不启用**）⇒ fallback 参数**独自**关不住这两类，必须另有价值检查（§3.6 第 1 步）。
2. **未声明的令牌，`getPropertyValue` 也返回 `''`**（实施期实测，见 §10 更正 1）：⇒ 价值检查**已经**覆盖「未声明」这一档，原设计里专门为它准备的 `var()` fallback 哨兵**没有可区分输入** —— 删掉它后负样本一条不红。哨兵因此被删，本节由「两条防御」收成**一条**。
3. **引号形态由「串里有没有空格」决定**（`"__S__"` → `__S__`，`"__cloudcli sentinel__"` → 保留双引号）。这条不再服务于哨兵选样（哨兵已删），但**仍决定 §6.1 断言该按哪种形状写** —— 而且跨引擎还多一层差异（webkit 对基色层串去引号），见 §6.1 与 §10 更正 2。
4. **`--x: invalid` 落回的是 `invalid` 而不是 body 栈** —— 它是合法的 `<custom-ident>` 家族名，声明有效。**修正 Claude 第 2 轮 C1 的举例**：退化态不是「非空即可能落回 body」，只有「替换后不是合法字体列表」的才落回。

**变异（一条，对着唯一的防御）**：
- **删掉价值检查**（`if (!declared) return null;` 改为恒不触发）→ **未声明（#6）与空值（#7）两档都必须红**（返回 body 字体栈而非 `null`）。实测恰 **2 红**。
- ~~M-a 删掉哨兵~~：**该变异不存在**。实施期实测删掉哨兵后 `terminal-tokens`（chromium）**11 passed / 0 failed**，一条不红 —— 这不是「防御太强」，而是**无可区分输入**（价值检查先返回了，哨兵那行永远执行不到）。原 M-a 是**一条假的变异预言**，已删（§10 更正 1）。

**哨兵碰撞（原 R13）随之消失**：既然没有哨兵串参与判定，`.css` 主题写什么字体名都不会被误判为「未声明」。原 R13 整条删除。

**夹具**：第 6 档用「令牌完全不存在」（如 `--term-font-family-nonexistent`，或把基色层声明整体 `initial` 掉）＋ 一个 `body` 上有明确字体栈的 fixture；第 7 档用一个写入 `--term-font-family: ;` 的 `.css` 形态样式块。两档都要断言「生产函数返回 `null`」**且**「裸探针读到 body 栈」—— 后半句是「不做价值检查就会静默继承」的可执行证据。

### 6.5 门槛

**实测基线（2026-09-27，HEAD `1e5940fc`，工作区含并存改动）**：

| 项 | 实测基线 | 本片后（批 1／2／3 全实施） |
| --- | --- | --- |
| `npm test` | 1029 项 / 1008 通过 / **20 失败** / 1 跳过 | 失败集**不得新增名字**（只比名字集，不比绝对项数）。**本片未动 `server/` ⇒ 不适用** |
| `test:client` | 145 文件 / 1220 用例，全绿 | **147 文件 / 1230 用例，全绿**（＋2 文件 / ＋9 用例；逐文件对账见下） |
| 主题令牌套件 | **108 passed / 0 failed** | **124 passed / 0 failed**（双引擎），含 §6.2 七档 ＋ §6.4 的变异夹具 ＋ §6.3 的字体迟到断言 |
| `lint` | 154 warnings / **0 error** | **153 warnings / 0 error**；warning 数随工作区浮动，不作门槛 |
| `build` | exit 0 | exit 0 |
| 变异 | — | §6.2 的**七档** ＋ §6.4 的**删掉价值检查** ＋ §6.3 的**两条**（删等待、删字号路径的 fit），逐条 RED（逐条读数见 §10） |

> **实施进度**：批 1（令牌与授权面）、批 2（解析层）、批 3（生效链路 ＋ 设置项）**全部实施完毕**，上表「本片后」列是最终实测。实施期核出的三处计划级更正见 §10。

> **这两条读数前提必须一起读，否则会把别人的改动算到本片头上**：
> 1. **工作区含并存改动**：`server/modules/providers/list/opencode/opencode-auth.provider.ts`、账户状态文案、chat transcript 等文件的改动**不属于本方案**；`test:client` 的 147 文件与 `lint` 的 153 里含它们的增量。要一条**净基线**须先扣除，或在一份干净 worktree 上复测。
>    - **主题令牌套件那行则不受影响**（审阅第 3 轮新发现）：该套件只读 `src/index.css` 与 fixture 的少量模块（import 集合见 `tests/theme-tokens/main.ts:1-16`，含 `terminalTheme` / `tokenSnapshot` / `userThemeStyles` / `syntaxTheme` / `utils` / `mobileTerminalSelection` / `commitGraph` / `neutralScale`），而 `git diff --name-only HEAD` 与该集合**无交集** ⇒ `108 / 0` 是净读数（最终的 `124 / 0` 同理）。门槛表每一行因此都有净度归属：`test:client` / `lint` 含并存增量，主题令牌套件不含。
> 2. **读数必须晚于最后一次编辑**：本仓的绝对项数会随工作区漂移（同一棵树历史上读出过 1015 / 1017 / 1019 / 1021），故门槛只钉**失败名字集**与**逐文件增量**，不钉绝对项数。

**本片新增的 `test:client` 用例（逐文件对账）**：相对基线 `145 文件 / 1220 用例`，最终 `147 文件 / 1230 用例` —— **＋2 文件 / ＋10 条**，逐文件如下：

| 文件 | 增量 | 覆盖 |
| --- | --- | --- |
| `src/shared/tests/userThemeTokens.test.ts` | ＋1 | 字体令牌必须被 `ignored`（批 1） |
| `src/shared/tests/fontSettings.test.ts` | ＋3（新文件） | 缺键 → `'theme'`、非法值 → `'theme'`、合法值保留 |
| `src/modules/settings/tests/appearanceTerminalFont.test.tsx` | ＋2（新文件） | 下拉渲染（`theme` ＋ 全部等宽 face）＋ 写回 |
| `src/modules/shell/tests/shellTerminalThemeRefresh.test.tsx` | ＋4（4 → 8） | 字体落位 ＋ 清图集 ＋ fit ＋ 发 resize / 字号同样 / 无变化不重排 / **`fit` 在 `load` 之后** |

`145 → 147` 与 `1220 → 1230` 逐位吻合，无未指名差额。

**令牌基线预言的数字**（供审阅者核对增量是否只来自新增）：

- 新增 1 个 L2 令牌 ⇒ `token-contract.spec.ts` 第二条「baseline covers every token」报 uncovered **恰 2 项**（`light --term-font-family`、`dark --term-font-family`）。
- 第一条（值漂移）**0 项**。
- 故刷基线前后的 diff 应**恰为**：`token-baseline.json` 的 light/dark 各新增 1 条键值，**无任何既有键的值改变**；且**增量只出现在 `tokens` 段，`rendered` 段一条不动**（`rendered` 段由 `PROBES` 决定，而字体令牌按 §5.2 的硬约束不进 `PROBES`）。若既有键漂移、或 `rendered` 段冒出 `--term-font-family`，说明动到了不该动的东西。
- **前提：本片不改任何 `[data-theme]` 块**（审阅第 2 轮 W2，见 §3.4）。`--term-font-family` 全仓只出现一次，在基色层 `:root`；若它出现在某个 `cc-*` 的覆盖层块里，既会打破上面的增量预言，也会让 `theme-overlays.spec.ts:484` 的恒等测试的前提不成立。

### 6.6 预览页（令牌预览）

`--term-font-family` 会自动进入 `term` 组（`GROUP_PREFIXES` 已含 `term`），且 `swatchColorFor()` 对非颜色返回 `null` ⇒ 不写色块、**零代码改动**。但验收不能停在「人眼确认无异常」，落成一条可断言：

- `readTokenPreviewSnapshot()`（`main.ts:547`）的快照里，`term` 组存在名为 `--term-font-family` 的条目，且其 `lightSwatch` 与 `darkSwatch` **均为 `null`**。

复用现成入口、成本极低，同时堵住「未来有人把它误当颜色令牌」的路（审阅第 1 轮 W5）。

---

## 7. 风险与坑（逐条给出处置）

| # | 坑 | 处置 |
| --- | --- | --- |
| R1 | **未声明变量静默继承**：`var()` 未定义 ⇒ `font-family` 等价 `inherit` ⇒ 探针读到 `body` 的字体栈（`console.css` 恰把 body 钉成 JetBrains Mono，会伪装成「变量生效了」） | §3.6 第 1 步先读令牌的 computed value（**无值 ⇒ `''` ⇒ 返回 `null`**，未声明与空值同形同时被覆盖）＋ §6.2 第 6 条的负样本变异。原设计的 `var()` fallback 哨兵在实施期被证伪删除（§10 更正 1） |
| R2 | **层叠战争**：两个来源写同一个变量 | §3.2 用户层不进 CSS，通道分离 |
| R3 | **Web 字体度量时序**：字体未加载就 fit ⇒ 列数错。**实际范围比直觉小**：只有 `jetbrains-mono` 是自托管 Web 字体，其余 6 个选项是系统字体（不存在「稍后到达」） | §3.7 首次 fit 前 `await document.fonts?.load(...)`；初始化与切换**两条路径**都要 ＋ §6.3 双路径断言 |
| R4 | **误入 `SURFACES.terminal`**：会**强制** `cc-polar` / `cc-catppuccin` 声明字体，同时**禁止** `cc-ocean` 声明（机械结果，见 §3.4 的 `moved` 定义） | §3.4 明确排除，并写清 `moved` 的机械定义供后来者自查 |
| R5 | **值形状规范化**：`'Fira Code'` 读回成 `"Fira Code"`；且规则**因引擎而异** —— WebKit 会把基色层串里的 `"Courier New"` 也去引号 | 断言按**去引号后的家族列表**写（`§6.1`）—— 字符串全等只是 chromium-only。§10 更正 2 |
| R6 | **令牌基线必须显式刷新**（否则第二条测试红） | §6.5 给了确切的增量预言（恰 2 项、只在 `tokens` 段） |
| R7 | 新增令牌进预览页 | 已核实 `GROUP_PREFIXES` 含 `term`、非颜色值不配色块 ⇒ **零代码改动**；验收落成 §6.6 的可断言条目（不停在「人眼确认」） |
| R8 | 主题把所有令牌删空 | `FALLBACK_TERMINAL_FONT_FAMILY` 兜底（§3.6 的唯一 TS 字面量） |
| R9 | **jsdom 下 `document.fonts` 为 `undefined`**，且 `shellTerminalThemeRefresh.test.tsx:26-28` 的 `vi.mock` **只桩了 `readTerminalTheme`** ⇒ hook 一导入新函数，现有测试即 TypeError | §5.2 列为**本片必需项**：生产代码防御性调用 ＋ 现有 mock 扩桩 |
| R10 | **授权面假开放**（比拒绝更危险）：`/^--term-[a-z-]+$/` 认下 `--term-font-family` ⇒ `.json` / `.tmTheme` 主题能写进一个「过校验但 `font-family` 无效」的值，浏览器丢弃该声明后探针读到继承的 body 字体 | §5.1 的 `userThemeTokens.ts` 授权面收紧 ＋ 一条 `ignored` 断言（回应 Pi-P1／Pi-P3） |
| R11 | **系统字体夹具假绿**：用 `cascadia-code` 做度量夹具，CI 上没装该字体 ⇒ `cols` 不变 ⇒ 断言恒真 | §6.3 夹具改用 `jetbrains-mono` ＋ `document.fonts.check` 前置断言（回应 W4 附注） |
| R12 | **`.css` 侧退化态**（R10 的姐妹）：主题写 `--term-font-family: ;` 或写成一个对 `font-family` 非法的值（如 `0 0% 0%`）⇒ 声明在计算值阶段被丢弃、探针读到 **body 字体栈** | **空值由 §3.6 第 1 步的价值检查精确堵住**（空的自定义属性不是 guaranteed-invalid、`var()` fallback 对它不启用，只有读原始值才抓得住；同一步顺带覆盖「引用断裂 `var(--undefined)`」——该属性无 computed value、同样读回 `''`）；**非空非法值如实记为已知限制**，不加「等于 body 栈即可疑」的启发式（会误伤用 `var()` 有意对齐 UI 字体的主题）；§6.2 第 7 档固化。**暴露面只在 `.css`**：字体令牌对 `.json` / `.tmTheme` 不授权（§8-P3），故不存在「编译侧本可拦」的一层 —— 不必去找一个缺失的校验点。将来若 P3 改判开放，`CSS.supports('font-family', v)`（实测对 `0 0% 0%` = `false`）是自然的第一道闸门，但**它拦不住 `var()` 引用**（实测 `CSS.supports('font-family', 'var(--x)')` = `true`），那一类靠价值检查闭合 |
| ~~R13~~ | ~~**哨兵碰撞**：`.css` 主题恰好把 `--term-font-family` 写成哨兵串 ⇒ 被误判为「未声明」~~ **整条消失** | 哨兵在实施期被证伪删除（§10 更正 1）—— 没有哨兵串参与判定，`.css` 主题写什么字体名都不会被误判为「未声明」 |

---

## 8. 决策项

状态：**P1 / P2 已由第 3 轮审阅者裁定取 A**（展开与理由见 §8.1）；**P3～P8 已按作者主张裁定取 A（第 4 轮，用户拍板「按作者推荐」）**；**P9 / P10 作者已拍板**。**10 条全部已裁定，无遗留待拍板项。**

| # | 事项 | 本方案主张 | 备选 |
| --- | --- | --- | --- |
| P1 ✅ **已裁定 = A** | 默认值语义（**详见 §8.1**） | `'theme'`（跟随主题） | 默认 `system`（会让 macOS 从 Menlo 变 SF Mono，**破坏 G3**） |
| P2 ✅ **已裁定 = A** | 用户层落点（**详见 §8.1**） | `localStorage` 单值 | 双 CSS 变量（`--ui-terminal-font-family` ＋ `--term-font-family`） |
| P3 ✅ **已裁定 = A** | `.json` 用户主题开放字体令牌 | **不开**，且必须**显式不授权** —— 不是「形状自然会被拒」：实测 `ruleForToken` 会经 `/^--term-[a-z-]+$/` 认下它（见 R10） | 开（需扩白名单 ＋ 新值形状并同步扩校验器；现有 `EXPRESSION_PATTERN`（`userThemeTokens.ts:139`）不含引号，`"Fira Code", monospace` 会被判非法） |
| P4 ✅ **已裁定 = A** | 设置页插入位置 | 终端字号**之后**（两项相邻成组） | 字体块末尾（保持现有行序不变） |
| P5 ✅ **已裁定 = A** | 快速设置面板同步 | **不同步**（该面板 `QuickSettingsContent.tsx:74-76` 现有且仅有聊天字体，语义是「快捷」） | 同步 |
| P6 ✅ **已裁定 = A** | 连字 `fontLigatures` | **不同片**（独立行为，混入会让本片验收说不清） | 同片 |
| P7 ✅ **已裁定 = A** | `--term-font-family` 入 `SURFACES.terminal` 遍历 | **不入**（理由见 §3.4） | 入（须给 `cc-polar` / `cc-catppuccin` 各补一条声明，并接受 `cc-ocean` 不得声明，等于扩大本片范围） |
| P8 ✅ **已裁定 = A** | i18n 是否补 **zh-TW** | **补**（实测 en / zh-CN / zh-TW 的 `fontSettings` 键集**完全相同**，zh-TW 是一套完整翻译；只补两端会让同一个下拉里新增项是英文、其余项是中文） | 不补（保持仓库「只维护 zh-CN」的既有策略，改为在验收里记一条**已知不一致**） |

### 8.1 P1 与 P2：展开与裁定（第 3 轮均取 A）

这两项会改动方案骨架，送审时作者保留了两种选项、不预设结论；**第 3 轮审阅者已逐项裁定，两项均取 A（与作者主张一致）**。每项按：背景 → 两个选项 → 连锁后果 → 作者的取舍依据 → 裁定 展开。

#### P1｜默认值语义

**背景**：新增的 `terminalFontFamily` 需要一个默认值。现状终端字体是**硬编码** `Menlo, Monaco, "Courier New", monospace`（`useShellTerminal.ts:28`），没有任何设置项能改它。

| 选项 | 语义 | 连锁后果 |
| --- | --- | --- |
| **A（主张）`'theme'`** | 默认「跟随主题」，实际字体由 `--term-font-family` 决定 | 基色层该令牌 = 现状串 ⇒ 未动过设置的用户**逐字节不变**，§6.1 的 G3（零视觉变化）成立。代价：设置下拉多一个「跟随主题」伪选项（i18n 键已计入） |
| B `system` | 默认直接选中「系统等宽」 | `CODE_FONT_FAMILY_CSS.system`（`utils.ts:56`）= `ui-monospace, SFMono-Regular, Menlo, Monaco, …`；macOS 上 `ui-monospace` 解析为 **SF Mono**，栈首从 Menlo 变为 SF Mono ⇒ **所有未设置用户升级后终端字体当场改变**，**G3 作废**（§6.1 须重写、§0 第一条承诺须撤下） |

**作者的取舍依据**：A 用「多一个伪选项」换「零视觉变化」；B 的代价不是「换个字体好不好看」，而是**推翻本方案的第一条承诺**（§0 与 §6.1 都建立在它上面）。

**裁定（第 3 轮）**：**取 A**。B 被无条件排除 —— 它同时作废 §0 第一条承诺与 §6.1 的 G3；第三选项亦否决，理由与作者一致：默认值一旦是具体字体，用户层 `≠ 'theme'`，§3.1 的三层里**主题层被永久短路**，G2 名存实亡。附带采纳一项加固：§3.5 补记「与代码字体下拉的形态差异是刻意的」。

#### P2｜用户层落点

**背景**：用户在设置里选的终端字体需要持久化。现有字体设置走 `localStorage`（`readFontSettings` / `writeFontSettings`，`utils.ts:62/76`，键形如 `fontSettings.<field>`）。

| 选项 | 落点 | 判据／代价 |
| --- | --- | --- |
| **A（主张）** | `localStorage` 单值，复用现成读写 | 判据（§3.2）：**一个值该不该落成 CSS 变量，看它有没有非 JS 的消费者**。终端字体的唯一消费者是 xterm（canvas，JS），没有任何样式表读它 ⇒ 落变量是多余的间接层 |
| B | 双 CSS 变量：用户层写 `--ui-terminal-font-family`（内联 `<html>`），主题层写 `--term-font-family` | 引入一个无人读的变量；且用户层若与主题层**同名**会成层叠关系（用户层既有的内联落点 `documentElement.style` 权重最高，主题永远压不过用户层），须另设「谁压谁」规则 —— 详见 §3.2 的仓库内实证 |

**作者的取舍依据**：A 的依据是「消费者决定形态」（与 `--ui-font-family` 的对比见 §3.2）。

**裁定（第 3 轮）**：**取 A**。判据经核验成立 —— `--ui-font-family` 确有 CSS 消费者（`index.css:578`），终端字体则**无任何样式表消费者**；B 的两条「好处」被认定为伪好处（预览页描述基色与主题、不描述用户偏好，把用户偏好塞进去反而让那份快照随人漂移）。附带采纳一项加固：§3.2 补入仓库内的层叠实证。若将来改判取 B，§3.1 / §3.2 / §5.1 / §6.2 需一并改判。

---

**作者已拍板项**（若审阅者有异议请直接反驳，作者在开工前接受改判）：

- **P9：设置页改字号的 fit 缺口一并修**（原 §3.8 只是「记账不修」）。理由见 §3.8 —— 字体与字号共用同一个 `FONT_SETTINGS_CHANGED_EVENT` handler，只给字体加 fit 会留下一个怪形状。这不只是范围扩张，也是把 §3.8 那条缺口从「待核实」变成「已修复」。
- **P10：不为「声明了但对 `font-family` 非法」加启发式防御**。理由见 §3.6 末段 —— 「读回值等于 body 栈即可疑」会误伤**有意**用 `var()` 把终端字体对齐 UI 字体的主题；该退化态需要主题作者写错才会出现，记为已知限制（R12）比引入一个会误判的启发式划算。**注意范围**：只有「非空非法值」这一类被记为限制；「空值」（`--term-font-family: ;`）已由 §3.6 第 3 步**精确**堵住，不属本条。

---

## 9. 非目标

1. **连字**（`fontLigatures`）：选 Fira Code 的用户多半想要连字，但它是独立一档行为（xterm 在 WebGL/Canvas 渲染器下的支持程度另有变数），另片。
2. **`.tmTheme` 携带字体**：主题文档第 383 / 4188 行已定「`fontStyle` 不携带但上报」，本方案不改变该立场。
3. ~~**终端字号的相邻缺口**（§3.8）：只记账，不修。~~ **已改判为本片动作**（见 §3.8 与 §8-P9）—— 字体与字号共用同一个事件监听器，无法「只给字体加 fit」。
4. **移动端手势缩放新增字体档位**：`mobileTerminalSelection.ts` 的 `onFontSizeChange` 只调字号，不涉字体。
5. **`.json` 用户主题的字体令牌**：见 §8-P3，本方案主张不开。

---

## 10. 实施期更正（实施全程）

> 送审稿在落地时被自己的实测推翻了**三**处。三处都是**计划级**的（改的是正文的机制、契约或验收方式，不是措辞），因此不静默绕过 —— 正文相关章节已按更正后的形态改写，此处留完整的证伪过程供第三轮审阅者与后来者核对。
>
> 三处有一个共同形状：**原计划所依赖的那条「能被测出来」的假设，本身没有先被测过**。哨兵以为有可区分输入、逐字节以为跨引擎成立、cols 以为夹具能分辨 —— 三次都是先写断言、后验前提。

### 更正 1｜`var()` fallback 哨兵是死代码（已删）

**原文**：§3.6 / §6.4 / R1 把「哨兵（抓未声明）＋ 价值检查（抓空值）」当作**两层**防御，§6.4 还为它们各配了一条变异（M-a / M-b）。

**实测**：令牌**完全未声明**时，`getComputedStyle(document.body).getPropertyValue('--term-font-family')` **同样返回 `''`** —— 与「声明为空」同形。价值检查（`if (!declared) return null`）**已经覆盖**「未声明」这一档，哨兵那一行永远执行不到。

**证伪**：把哨兵从探针声明里删掉（`var(--term-font-family, <哨兵>)` → `var(--term-font-family)`），跑 `terminal-tokens`（chromium）：**11 passed / 0 failed —— 一条都不红**。这是典型的**等价变异**：护栏在，但没有任何输入能让改前改后不同。

**处置**：哨兵删除。§3.6 由两条防御收成一条；§6.2 第 6／7 档共用同一条价值检查；§6.4 的 **M-a 作为一条假预言删除**；R13（哨兵碰撞）整条消失。价值检查本身仍**承重** —— 把它改成恒不触发后，未声明与空值两档**恰 2 红**。

**为什么原来会错**（可复用的教训）：审阅第 2 轮 C1 指出「哨兵救不了空值」，我据此**增加**了价值检查，却没有回头问「哨兵是否还必要」。新增的那层吸收了旧层的唯一职责，旧层就地变成死代码。**加一层防御时，要重新问旧的一层还有没有可区分输入。**

### 更正 2｜§6.1 的「逐字节相等」是 chromium-only

**原文**：§6.1 断言读回值 `=== ORIGINAL_FONT_STACK`（逐字节），依据是 chromium 实测「基色层默认串读回同形」。

**实测（chromium vs webkit）**：基色层串 `Menlo, Monaco, "Courier New", monospace` —— chromium 读回**同形**；**WebKit 读回 `Menlo, Monaco, Courier New, monospace`**（`"Courier New"` 的引号被去掉）。据此写成的断言在 **webkit 全红、chromium 全绿**。

**处置**：契约降到「**去引号后的家族列表相同**」一级。这不是放宽验收 —— 引号只在名字含空格时才承载语法意义，去掉后家族名不变，xterm 解析出的家族与顺序完全一致，**G3 的语义（渲染逐像素相同）不受影响**；受影响的是断言的形状。§6.1 / §6.2 第 1 档 / §3.6 的值形状注 / R5 已同步。

**顺带确认**（不受引擎差异影响的部分）：production 的 `null` 判定（价值检查）在两引擎**都通过** —— 跨引擎差异只出现在**引号序列化**上，不在行为上。

### 更正 3｜§6.3 的 `cols/rows` 断言不可证伪（已换掉）

**原文**：§6.3 要求「切换路径 / 初始化路径」各断言一次 `cols/rows` 与「字体已就位时」一致，用 `jetbrains-mono` 做夹具。

**实测**：7 个选项与全部回落栈**都是等宽字体，字宽都在 0.6em 附近**（14px 下 chromium canvas 实测：`JetBrains Mono` 8.4000、通用回落 `monospace` 8.4014、`Menlo` 栈 8.4287）。400px 宽下两种栈都算出 **47 列** —— 取整把 0.03px 的差吃掉了。所以「等字体就位 vs 不等」得到的 `cols` 恒等，**这条断言不可能失败**。

**处置**：不写这条 —— 一条不可能失败的断言比没有更糟（它会让读者以为这条风险已被看护）。把命题拆成两段各自可证伪的断言（§6.3）：

1. **「字体确实迟到」**：真引擎下 `document.fonts.check('14px "JetBrains Mono"')` 先 `false`、`await load()` 后 `true`。这条**曾经真红过** —— fixture 没挂 `public/`，字体 404、`load()` 抛 `NetworkError`；补 `tests/theme-tokens/vite.config.ts` 的 `publicDir` 后才绿。可见它对「字体到底能不能到」敏感。
2. **「我们确实等了」**：jsdom 里把 `document.fonts` 桩成记录次序的对象，断言 `fit()` 在 `load()` **之后**。删掉等待 ⇒ **恰 1 红**（实测）。

**顺带的收益**：实施期把两段重复代码收成一个原语 `fitAfterFontReady()`（等字体 → 清图集 → fit → 发 resize），初始化与切换两条路径共用它 ⇒ 第 2 条的次序断言**按构造**同时覆盖初始化路径 —— 而初始化路径正是审阅第 1 轮 Pi-P3 指出的高频路径。原计划要为两条路径各写一套 cols 断言，现在是「一个原语 ＋ 一条断言」。

### 批 1 ／ 批 2 ／ 批 3 的实测门槛

| 项 | 读数 |
| --- | --- |
| `test:client` | **147 文件 / 1230 用例，全绿**（自 145/1221 起：＋2 文件 `fontSettings.test.ts` / `appearanceTerminalFont.test.tsx`，＋9 用例 —— shell 测试 4→8，加 3 ＋ 2） |
| 主题令牌套件 | **124 passed / 0 failed**（双引擎；自 108 起） |
| `lint` | **153 warnings / 0 error** |
| `build` | exit 0 |
| 变异 | 删哨兵 → **0 红（记录为等价变异）**；删价值检查 → **恰 2 红**；删字号路径的 fit → **恰 1 红**；删 `clearTextureAtlas` → **恰 1 红**；删无变化短路 → **3 红**；删字体等待 → **恰 1 红**；用户选择不生效 → **恰 1 红** |
| `npm test` | 未跑 —— 本片未动 `server/`，与失败名字集无关 |

> `test:client` / `lint` 的读数含工作区并存改动（口径见 §6.5 的两条前提）；主题令牌套件是净读数。
> **批 1 ／ 批 2 ／ 批 3 全部实施完毕**，本方案的生产代码改动到此为止。

---

## 附录 A：改动文件总表

**生产（9）**：`src/shared/types.ts`、`src/shared/utils.ts`、`src/shared/userThemeTokens.ts`（授权面收紧）、`src/index.css`、`src/modules/shell/utils/terminalTheme.ts`、`src/modules/shell/hooks/useShellTerminal.ts`、`src/modules/quick-settings-panel/hooks/useChatFontSettings.ts`、`src/modules/settings/tabs/AppearanceSettingsTab.tsx`、`src/modules/i18n/locales/{en,zh-CN,zh-TW}/settings.json`（三端 —— §8-P8 已裁定取 A：补 zh-TW）

**测试（10）**：`tests/theme-tokens/main.ts`、`tests/theme-tokens/terminal-tokens.spec.ts`、`tests/theme-tokens/token-preview.spec.ts`、`tests/theme-tokens/token-contract.spec.ts`（注释级 ＋ 一行显式豁免）、`tests/theme-tokens/token-baseline.json`、`tests/theme-tokens/vite.config.ts`（夹具 `publicDir`，见 §6.3）、`src/shared/tests/userThemeTokens.test.ts`、`src/shared/tests/fontSettings.test.ts`（新文件）、`src/modules/shell/tests/shellTerminalThemeRefresh.test.tsx`、`src/modules/settings/tests/appearanceTerminalFont.test.tsx`（新文件）

**文档（2）**：本文件；《CloudCLI 主题与配色体系设计方案》第 34 / 649 行与附录 A

**不使用的新文件**：0 个（解析函数并入既有 `terminalTheme.ts`，选项表复用既有 `CODE_FONT_FAMILY_CSS`）

---

## 附录 B：实施顺序

1. **令牌先行**：`index.css` 加 `--term-font-family` → 跑令牌契约测试，核对 uncovered 恰 2（第 0 步就验证 §6.5 的预言）→ 刷基线 → 确认既有键 0 漂移。
2. **解析层**：`terminalTheme.ts` 加函数 ＋ fixture 暴露 ＋ §6.1／§6.4 断言（此时设置项还不存在，先把「主题层」这一档做实）。
3. **接入 xterm**：`useShellTerminal.ts` **六处** ＋ 字体加载时序 ＋ §6.3 断言（用覆盖层夹具即可验证，不依赖设置项）。
4. **设置项**：类型 / 选项表 / `useChatFontSettings` facade / 设置页 / i18n **三端（en + zh-CN + zh-TW，§8-P8 已裁定取 A）** ＋ §6.2 的 #3 #4 断言。
5. **收口**：全量门槛 ＋ 变异 ＋ 文档改判（§4）＋ 主题文档附录 A 补一条。

每一步单独刷一次令牌基线／测试基线，便于定位是哪一步引入的偏差。

> **实施状态**：步骤 1～4 全部落地（批 1／2／3），步骤 5（收口）的门槛与变异已在本文件 §6.5 与 §10 记账；与《CloudCLI 主题与配色体系设计方案》的条款改判（§4）待随该文档一并回写。

---

## 审阅批注

### Claude · `claude`

> [!WARNING] **G2 落地条件与判空作用域的分裂（§3.6 vs §1.3/§3.2）**
> §3.6 判空与取值都读 `getComputedStyle(document.documentElement)`（**html** 作用域），但 §1.3 自述用户 `.css` 主题 `console.css` 是把 **`body`** 钉成 JetBrains Mono —— 即用户 CSS 主题的既有书写习惯是作用在 `body`。若某覆盖层把 `--term-font-family` 声明在 `body`（而非 `:root`），判空读 html 返回空 → 判为「未声明」→ 直接回落，该主题改字体**不生效**，与 G2「覆盖层 .css 主题可改」冲突。
> **建议**：(a) 在文档 §3.3 明确「`--term-font-family` 必须声明在 `:root` 层级才算数，声明在 `body` 等更低作用域不生效」作为 G2 的边界写进限制；(b) 或让探针与判空都挂到同一作用域（探针也 `append` 到 `document.documentElement`），消除「判空用 html、探针继承 body」的两套观测点不一致。

> [!WARNING] **hook 生效链路的验证载体缺口（§3.7 三处改动 + `document.fonts.load` 时序）**
> §5.2/§6 的 DoD 只覆盖 themes-tokens（Playwright 真浏览器）的令牌/优先级断言，以及 `readFontSettings()` 的纯逻辑回落（jsdom）。但 §3.7 的**核心生效改动**——初始化传 `fontFamily`、设置/主题变更 effect 扩展、`await document.fonts.load` 后再 fit+resize——没有对应的行为单测计划。而该逻辑若放在 `test:client`（`vitest.config.ts:17` 为 **jsdom**），`document.fonts` 是 `undefined`，`document.fonts.load(...)` 会直接抛 TypeError。
> **建议**：在 DoD 明确 hook 时序的验证载体——要么用 Playwright 写「真实终端开一倍、切字体后 cols/rows 与加载一致」的集成断言，要么在 vitest 里 mock `FontFaceSet`；否则 §3.7 这段最易回归的代码将无测试看护。

> [!TIP] **换字体后需考虑 xterm 字符纹理缓存（§3.7，服务 G4）**
> 方案只提「`document.fonts.load()` 后 `fit()` + 发 `resize`」。但 xterm 渲染器对已绘字形有字符/纹理图集缓存（char/texture atlas）：当新旧字体的字形宽度度量恰好接近、`fit()` 后 `cols/rows` 未变时，xterm 可能不触发实质重绘，残留旧字形。建议在改 `fontFamily` 后同步调用 `terminal.clearTextureAtlas()`（或相应 renderer 的清缓存入口）作为兜底，并在实现步骤里验证「非 Web 字体→Web 字体→回切」多次往返不残留。

> [!NOTE] **`document.fonts.load()` 只加载指定尺寸的 face（§3.7）**
> `load(\`${fontSize}px ${stack}\`)` 请求的是与当前 `fontSize` 精确匹配的字体面；若 xterm 因缩放或 `options.deriveFonts` 以非整数/其他尺寸渲染该字体，该尺寸的 face 未预加载，仍会闪回落再换。建议 load 用覆盖实际渲染尺寸的字符串（或同时请求附近整数尺寸），并确认终端渲染字号恒等于 `fontSize` 而非派生值。

> [!NOTE] **解析函数的三层测试分布在两套环境，读者需先识破（§5.2）**
> `readThemedTerminalFontFamily()`（依赖 `var()` 解析 + `getComputedStyle`）只有 `tests/theme-tokens/`（Playwright 真浏览器，`main.ts` fixture 暴露）能真跑；vitest/jsdom 侧只能测 `readFontSettings()` 的键回落/非法值等纯逻辑。文档已隐含此分工（`readFontSettings` 放 `src/shared/tests/`），但未点破「为何 jsdom 不测探针」。建议在 §5.2 的测试表加一句注记，避免后续维护者误以为 jsdom 覆盖了解析层而漏测。

---

### WorkBuddy

> [!CAUTION] **§3.4 的警示有一个空洞，且这个空洞可能被实现期「好心补上」而变成静默丢字体（§3.4 / §3.3 / §5.1）**
> §3.4 论证 `--term-font-family` 不得进 `SURFACES.terminal`，理由是进了会被 `MUST_MOVE.full` 强制声明、被 `MUST_NOT_MOVE.accent` 禁止声明。但逐行读 `theme-overlays.spec.ts:113-127`：`MUST_MOVE`/`MUST_NOT_MOVE` 断言的是「实际被移动的 token 集合」与「承诺的集合」是否一致（`:400-416`），而**声明了但值等于基线的 token 不会被计入 moved**。所以一个 full 主题若写了 `--term-font-family` 但值恰是原串，**既不会被强红、也不会被禁止** —— 文档描述的是「意图」，不是「当前测试的机械结果」。
> **真正的硬闸门是另一条**：`theme-overlays.spec.ts:351` 的「overlay 只能重声明基色层已声明的 token」（`:365` `if (!(name in base.tokens))`），`base.tokens` 来自 `read(...).tokens`（`main.ts:322-324`，整表读 `<html>` 所有声明）。这才是 §3.3 那句「必须先有基色层声明」的依据，结论没错，但**支撑它与支撑 §3.4 的测试不是同一条**，文档把两者混着说，会误导实现者。
> **建议**：(a) §3.4 把「MUST_MOVE 强制/MUST_NOT_MOVE 禁止」改述为「不在遍历集合内 ⇒ 声明/不声明都不会被判违规」，并明确「不进 `SURFACES.terminal`」是**纯文档约定**，无测试强制；(b) 划清红线：**不得**把 `--term-font-family` 加进 `SURFACES.terminal`（一旦加入，full 主题的 mustMove 才会真正强制它移动）；(c) §7 的 R4 与 P7 同步订正，避免后来者按「会被测试拦住」的印象行事。

> [!WARNING] **base 声明写入 `:root` 而默认主题把 `data-theme` 写到 `<html>`，令牌基线里这个值会随用户状态漂移（§3.3 / §3.6 / §6.1）**
> 现有实测（本地核查）：`src/index.css` 的终端块在 `@layer base` 规则的 `:root` 内（`:230-251`），基色层唯一处声明；`readComputedTokens()`（`tokenSnapshot.ts:106-115`）读 `getComputedStyle(document.documentElement)`，而 `main.ts:490` / `ThemeContext.tsx:367` 都会把 `<html data-theme>` 设为当前主题 id。真实链路上用户可能在 `<html>` 上挂着 `data-theme="cc-polar"`（full 覆盖层），此时 `--term-font-family` 会解析成该覆盖层的值。
> **影响**：`--term-font-family: Menlo, Monaco, "Courier New", monospace` 里的字体名带引号，`swatchColorFor()`（`tokenSnapshot.ts:97-103`）判为非颜色返回 `null`，令牌预览页会把它当一个普通「字体值」行渲染（不是色块）。§6.1 的「逐字节等于现状串」只有在**用户未选主题**时成立（`readWithTheme(null)`）。作为基线值它够稳，但请把此前提写进 §3.6/§6.1，否则换主题后若有人重跑基线核对会困惑「基线值为什么不等于源码里的串」。
> **建议**：明确「零变化基线取无主题态（`data-theme` 清空）」；并在 §6.5 增量预言旁注一句：新增键的值形状是 `Menlo, Monaco, "Courier New", monospace`，非 HSL 三元组。

> [!WARNING] **§1.3 的「console.css 把 body 钉成 JetBrains Mono」是举例，但它揭示的真实机制会打破 §3.1「逐字节相同」的一个隐含前提**
> 我已核实：`console.css` 是**用户自定义 `.css` 主题**（`userThemeStyles.ts:207-210`，`entry.format === 'css'` 原样注入 `<style>`），不是仓库内置文件，因此它**不受** `theme-overlays.spec.ts` 基色层声明闸门的约束，可以直接写 `body { … }` 甚至 `html { --term-font-family: … }`。
> 问题在于 §3.6 的判空读 `getComputedStyle(document.documentElement)`（`html` 作用域），而 §1.3 自述的既有习惯是作用在 `body`。若某 `.css` 主题把 `--term-font-family` 写在 `body`，探针取的是 `html` 的继承值 → 判空返回 `null` → 主题改字体**不生效**，与 G2 冲突。Claude 已在上一节指出「必须声明在 `:root`」，我补一条落点：**这等于给 `.css` 主题作者加了一条未在 §3.3 写明的限制**，且 `.css` 主题恰恰是最自由、最容易写错作用域的一类。
> **建议**：§3.3 或 §3.7 显式写「`--term-font-family` 仅当声明在 `:root`/`html` 层（含 `.dark`、`[data-theme]`）才被读取；声明在 `body` 及更低层不生效」，并考虑在 §6.2 的覆盖层夹具里**补一个 body 作用域的负样本**，把这条边界固化成测试。

> [!TIP] **do ron：`useShellTerminal` 的「设置变更」effect 只刷新，不 fit —— 换字体后列数要重新算（§3.7 第 2 点）**
> 我核对了 `useShellTerminal.ts:334-346`：现有 `applyFontSize` 只 `terminal.options.fontSize = …; terminal.refresh(…)`，**没有** `fit()` 也不发 `resize`；而移动端手势路径 `:173-187` 两者都做了。§3.8 已如实记账这个既有缺口，但要点是：**字体变更比字号变更更需要 fit**——字号变化沿用 refresh 只是画面不糊，字体变化若只 refresh，`cols/rows` 直接用旧度量，G4 会直接不满足。§3.7 说「照 `:173-187` 写」方向对，但请把「字体变更 effect 必须 fit + resize，**不能照抄 `:334-346` 的 applyFontSize**」写成硬约束，否则实现时极易顺手复制最近的 `applyFontSize`。
> **另附**：`document.fonts.load()` 对**非 Web 字体**（`cascadia-code` 等仓库未自托管、仅系统可能有的字体）返回空数组即 resolve，这没问题；但对**首次 `@font-face` 加载**，`load()` 完成仅代表字型数据到位，不等同于「xterm 用该字体重新量过一次」。§6.3 的夹具选用 `cascadia-code` 是对的（字形宽度差大），但需确认该字体在测试机/CI 上**确实存在**，否则回落到 `ui-monospace` 后 cols 不变，断言 6.3 会变成假绿。

> [!NOTE] **令牌预览页的零改动结论按现有实现成立，但请把「无异常分组」验收量化（§1.1 / R7）**
> 我核实了 `tokenSnapshot.ts`：`GROUP_PREFIXES` 含 `term`（`:52-66`），`swatchColorFor()` 对非颜色返回 `null`，`TokenPreviewSection.tsx:68/80` 对 `null` 不写 `style.background`；且该组件已有「非颜色值渲染无 swatch 样式」的单测（`tokenPreviewSection.test.tsx:128-134`）。故「字体令牌自动出现、不配色块」属实，**零改动**成立。
> 但 §6 只留了「需人眼确认分组显示无异常」这种弱验收。建议把它落成可断言的一条：令牌预览快照里 `term` 组存在名为 `--term-font-family` 的条目，且其 `lightSwatch`/`darkSwatch` 均为 `null`——这正好复用 `readTokenPreviewSnapshot()`（`main.ts:547`），成本极低，也顺手堵住「未来有人误把它当颜色 token」的路。

> [!TIP] **实现清单漏了展示层的半边：`useChatFontSettings` 不会自动长出 `terminalFontFamily`（§5.1）**
> §5.1 把 i18n 与设置页改了，但设置页读值的 facade 是 `useChatFontSettings`（`useChatFontSettings.ts:59-70`），它**显式** return 了 6 个字段＋setter，新增 `terminalFontFamily` 后不会自动透出。同样，类型 `FontSettingsState` 加字段后，`readFontSettings()`（`utils.ts:62-73`）的返回对象也需同步补键，否则类型报错或运行期缺字段。
> **建议**：§5.1 生产清单里把 `src/modules/quick-settings-panel/hooks/useChatFontSettings.ts` 一并列入（至少加 getter `terminalFontFamily` 与 `setTerminalFontFamily`，并 `writeFontSettings` 一起写），否则设置页拿不到该值。这不是「顺带改」，是本片必需项。

---

### Pi · `01a0e339-6239-727f-9237-9c504f488486`

> [!WARNING] **P3 的「不开」在代码里是「假开放」，而假开放比拒绝更危险（§3.3 / §8-P3）**
> P3 主张 `.json` 用户主题不开放字体令牌，理由是 `EXPRESSION_PATTERN`（`userThemeTokens.ts:139`）不含引号、`"Fira Code", monospace` 会被判非法。这个理由只描述了**一种**输入，而白名单的实际路由不是 `expression`：`ruleForToken('--term-font-family')`（`userThemeTokens.ts:230-238`）先查 `EXACT_RULES`（只有 `--radius` 与两个 graph 旋钮）、再查 `SEMANTIC_TOKENS`，都没有，最后落到 `FAMILY_RULES` 的 `{ pattern: /^--term-[a-z-]+$/, rule: 'triplet-or-reference' }`（`:221`）。
> 于是 `{ "tokens": { "--term-font-family": "0 0% 0%" } }` 会**通过**形状校验（`TRIPLET_PATTERN` 匹配）、写进覆盖层样式表，`.css` 主题作者与 `.tmTheme` 的 `cloudcli.embedded` 块（`tmTheme.ts:452-461` 走同一编译器）都能写进去。后果不是「被警告忽略」，而是**声明存在但值对 `font-family` 无效**：浏览器把 `font-family: 0 0% 0%` 判为无效声明丢弃，探针 `getComputedStyle(probe).fontFamily` 返回**继承自 body 的字体栈** —— 于是 §3.6 的第 2 步会给出一个「看起来是主题字体、实际是 body 字体」的值，而第 1 步判空非空、不会兜底。这正是 §3.6 注释自己警告过的静默继承，只不过入口从「未声明」换成了「声明了但值非法」。
> **建议**：把 P3 的「不开」从「形状自然会被拒」升级为**显式不授权** —— 在 `FAMILY_RULES` 之前为它加一条 `null` 规则（或把 `--term-*` 家族规则拆成「颜色子族授权 / 其余不授权」，例如把规则收紧为 `^--term-(?:ansi-|background|foreground|cursor|selection|error|success|warning|info)`），让 `.json`/`.tmTheme` 拿到的是「is not a token a theme may set」这条清晰警告；并在 §5.2 测试表补一条「`--term-font-family` 提交 HSL 三元组必须被 ignored」的断言。否则本片会留下一个「写了不报错、也不生效」的死角，比拒绝更难排查。

> [!WARNING] **§3.7 与 §3.8 互相矛盾：同一个 `FONT_SETTINGS_CHANGED_EVENT` handler 不可能既 fit 又只 refresh（§3.7 第 2 点 / §3.8）**
> §3.7 第 2 点要求「扩展 `:334-346` 的 effect」并「照 `:173-187` 写（fit ＋ 发 resize）」，而 §3.8 明确「本方案不动」`applyFontSize` 只 refresh 不发 resize 的既有缺口。这两条在代码上是**同一个函数**：`useShellTerminal.ts:335-342` 的 `applyFontSize` 是此事件唯一的监听器，字号与字体共用一次事件派发，实现者不可能「对字体 fit、对字号保持 refresh」而不显式拆分支。
> 请择一并写进文档：(a) **统一 fit ＋ resize** —— 顺手修掉字号缺口，但必须把 §3.8 从「记账不修」改为「本片一并修复」，并补 `resolvedThemeId` 之外的字号断言；(b) **显式双分支** —— 标明「字体变更走 fit ＋ resize，字号变更维持 refresh」是**刻意的**，并说明为什么同一事件里两种处置不同（否则后人在 review 时会当成不一致而「修正」回去）。当前文档两种读法都成立，是本片最容易在实现期产生歧义的一处。

> [!IMPORTANT] **字体加载时序的缺口在「初始化」而不是「切换」（§3.7 第 1 点 vs 处置段）**
> §3.7 的处置段只写了「**换字体后** `await document.fonts.load(...)` 再 fit ＋ resize」，但初始化路径（`:144-148`）同样会把 `fontFamily` 交给 `new Terminal`。用户在设置页选了 `jetbrains-mono` 后该值持久化在 `localStorage`，于是**以后每次打开终端**（比手动切换常见得多）初始字体就是 Web 字体，而首次度量发生在 `:262-272` 的 `setTimeout(..., TERMINAL_INIT_DELAY_MS=100)`（`constants.ts:218`）—— 那 100ms 是等容器布局，**不是等字体**。字体未到就 fit，量出的是回落字体宽度，列数随后错误地经 `sendSocketMessage({type:'resize'})` 发给 pty。
> **建议**：把「首个 fit 之前也要确保字体就位」写成显式的初始化步骤（初始化时 `await document.fonts.load()` 再走那 100ms 的 fit，或把 fit 挪到字体 promise 之后），并在 §6.3 的度量断言里补一条**初始化路径**（而不仅是切换路径）的 cols/rows 断言；否则 G4 只在「切字体」这一路径被验证，「刷新后打开终端」这条更常用的路径无人看护。

> [!IMPORTANT] **Menlo 串将从两处变三处，与本方案自己的「单一来源」理由相抵（§3.1 / §3.3 / §3.6 / §5.1）**
> §3.5 用「单一来源，避免两份 'Fira Code' 栈漂移」否决了复制字体栈，但同一个论证没有施加到兜底串上：本片会同时存在 `useShellTerminal.ts:28` 的 `TERMINAL_OPTIONS.fontFamily`（§5.1 清单未交代其去留）、`index.css` 新增的基色层默认值（§3.3「逐字取用现状字符串」）、以及 §3.6 解析函数里的 `HARDCODED` 常量。§3.6 只写了 `?? HARDCODED`，没写 `HARDCODED` 从哪来 —— 若在 `terminalTheme.ts` 再写一遍字面量，就是**三份**同一个串，任何一次编辑都可能只改到一处。
> **建议**：让兜底值从唯一来源导出（例如保留 `TERMINAL_OPTIONS.fontFamily` 作为兜底来源并让解析函数引用它，`index.css` 那行加注释指明它是该串的镜像；或反向以 `index.css` 为源、TS 常量注明「必须与 `src/index.css` 的 `--term-font-family` 一致」），并在 §5.1 的 `useShellTerminal.ts` 一行里写明 `TERMINAL_OPTIONS.fontFamily` 是删除还是保留。§6.1 已想到「逐字节等于 `:28` 的串」，把它升级为「该串在仓库中只有一处字面量」会更省事。

> [!NOTE] **i18n 只改两端会漏掉 zh-TW，而 zh-TW 的 `fontSettings` 块是完整的（§5.1）**
> 实测各语言包：含完整 `appearanceSettings.fontSettings` 块（8 个键，含 `codeFontFamilyOptions`）的是 **en、zh-CN、zh-TW** 三套；fr / es / ko / ja / ru / de / tr / it / id 九套**整块缺失**。方案按「en 为基准、zh-CN 为子集」只改两端：对整块缺失的九套无碍（整块 fallback 到 en），但 zh-TW 会因为**整块存在、仅缺新键**而出现同一下拉里「Fira Code / 系统等宽 …」是中文、新增的 `theme` 项因 `fallbackLng: 'en'`（`i18n/config.ts`）回落成英文的混排。
> **建议**：§5.1 的 i18n 行改为「en ＋ zh-CN ＋ zh-TW 三端一起写」，或至少注明 zh-TW 是「已有完整块但本片不补」的**已知不一致**，别让它在验收时才被发现。

> [!NOTE] **别把 `--term-font-family` 加进 `TERMINAL_PROBE_TOKENS`，否则 §6.5 的增量预言不成立（§3.3 / §5.2 / §6.5）**
> §3.3 已正确声明新令牌「不参与 `hsl()` 包装」，但 §5.2 只说 fixture「暴露 `readThemedTerminalFontFamily()`」，没有排除「顺手把它加进 `main.ts:49-53` 的 `TERMINAL_PROBE_TOKENS`」。那个数组经 `:158` 被映射为 `{ token, property: 'color' }` 的探针（`buildProbes`，`:174-191`），会给它写入 `hsl(var(--term-font-family))`；非颜色值下这条声明无效，`rendered['--term-font-family']` 会读到**继承色**并进入 `token-baseline.json` 的 `rendered` 段 —— 于是 §6.5「恰 2 项、无既有键改变」的预言会被一条额外的 `rendered` 漂移打破，且是一条语义无意义（颜色探针测字体）的记录。
> **建议**：在 §3.3 或 §5.2 补一句硬约束「`--term-font-family` 不得进入 `PROBES` / `TERMINAL_PROBE_TOKENS`（它由 §6.1 的专用读法验证），`token-baseline.json` 的增量只出现在 `tokens` 段」。

---

## 作者回应（第 1 轮）

> **本节是历史记录**：描述的是第 1 轮当时的处置。第 2 轮及以后的批注可能**取代**其中某些结论（例如本节末「原文的『两步读』删除」—— 第 2 轮因空值退化态又把「读原始值」以另一种形式加了回来，见 §3.6 第 3 步与第 2 轮回应 C1）。以正文与最新一轮回应为准。

> 2026-09-27，作者对三份审阅共 17 条批注逐条核验后作答。核验方式：**每条对照当前源码实证** —— `moved` 的定义读 `derivedMoves()`、令牌路由逐条比对 `ruleForToken` 与 `FAMILY_RULES`、`@font-face` 逐个数、i18n 键集用脚本求差集、xterm API 查 typings，不依赖审阅者转述。
>
> **结论先行：17 条中 15 条属实并采纳；1 条（W1）的指控不成立、但采纳其加固建议；1 条（Pi-P5 / zh-TW）因涉及仓库 i18n 策略转为待拍板（§8-P8）。另有 1 项作者拍板（§8-P9，由 W4 与 Pi-P2 合并而来）。此外作者自查出审阅未点出的 4 处问题，其中 1 处是原文的事实错误、1 处是审阅建议照字面做会踩的坑。**
>
> **作者主动认领（审阅未点出）**
>
> 1. **原文 §3.7 有一处事实错误。** 原文写「JetBrains Mono / Fira Code / Cascadia Code 都是应用自带 `@font-face` 的 Web 字体」—— 实测 `src/index.css` 只有两个 `@font-face`：`Encode Sans`（`:8`）与 `JetBrains Mono`（`:19`）。**Fira Code / Cascadia Code / Source Code Pro / Hack / IBM Plex Mono 全是系统字体。** 因此度量时序问题**只对 `jetbrains-mono` 真实存在**，范围比原文描述的小；同时 W4 附注指出的「用 `cascadia-code` 做夹具」是**必然假绿**（CI 上没装该字体 ⇒ `load()` 立即 resolve ⇒ `cols` 不变 ⇒ 断言恒真），不是偶发。§3.7 与 §6.3 已重写。
> 2. **C2 比审阅者说的更严重：现有测试会直接崩，不只是「缺测试」。** `shellTerminalThemeRefresh.test.tsx:26-28` 的 `vi.mock('@/modules/shell/utils/terminalTheme', () => ({ readTerminalTheme: … }))` **只桩了 `readTerminalTheme`** —— hook 一旦导入并调用新函数，拿到的是 `undefined`，调用即 TypeError。已列为本片必需项（§5.2）。
> 3. **C1 的解法比审阅者给的两个建议都更彻底。** 审阅建议「限定必须写在 `:root`」或「让探针也挂到 documentElement」，两者都只是把观测范围收窄到 html，仍与颜色通道（探针挂 `body`，`terminalTheme.ts:63`）不一致。改用 **`var()` 的 fallback 哨兵**（`var(--term-font-family, "<哨兵>")`）后：探针留在与颜色通道相同的观测点、「未声明」变成探针自己可返回的值、`body` 层声明照常生效 —— 那条「必须写在 `:root`」的限制**不再需要**。
> 4. **审阅 Pi-P4 的建议照字面做会形成循环导入。** Pi-P4 建议「保留 `TERMINAL_OPTIONS.fontFamily` 作为兜底来源并让解析函数引用它」—— 但 `useShellTerminal.ts` 本来就导入 `terminalTheme.ts`，反向引用即构成循环导入。改法：兜底常量定义在 `terminalTheme.ts` 并导出（`FALLBACK_TERMINAL_FONT_FAMILY`），由 hook 侧引用它，方向仍是 hook → theme 模块。§3.6、§5.1 已按此写。

### 逐条处置（三选一体例）

**编号说明**：本节条目按「审阅者-编号」命名 —— `C*` 属 Claude、`W*` 属 WorkBuddy、`Pi-*` 属 Pi。它们与 §8 的**决策项编号**（`§8-P1`～`§8-P10`）是**两套独立编号**，引用 §8 时一律写「§8-Pn」以示区分。（§8 原题为「待拍板项」，第 3 轮 P1 / P2 裁定后改名为「决策项」。）

**C1 G2 落地条件与判空作用域的分裂 —— 修（解法升级，见「主动认领 3」）。**
§3.6 整段改为 fallback 哨兵读法；§6.2 补第 5 条（`body` 层声明必须生效）与第 6 条（完全未声明必须回落）两条断言，把这条边界固化成测试。原文的「两步读」删除。

**C2 hook 生效链路的验证载体缺口 —— 修（并扩大为「现有测试会崩」）。**
三重处置：① 生产代码对 `document.fonts` 防御性调用（jsdom 下为 `undefined`）；② `shellTerminalThemeRefresh.test.tsx` 的 mock 扩桩（本片必需项）；③ DoD 明确载体 —— 行为断言（`cols/rows`）归 Playwright 真终端，jsdom 侧只断言调用行为（`options.fontFamily` 被写入、`fit`/`resize` 调用次数）。§3.7、§5.2、§6.3 已更新。

**C3 char / texture atlas —— 采纳。**
已核实 `clearTextureAtlas(): void` 存在于 `@xterm/xterm` typings（`:1249`）。列为 §3.7 第 4 点，并注明 jsdom 桩终端无此方法（断言用可选调用或同步扩桩）。

**C4 `fonts.load()` 只加载指定尺寸 —— 采纳为实现时确认项。**
`load()` 传 `${fontSize}px ${stack}` 已覆盖实际渲染尺寸；实现时确认 xterm 渲染字号恒等于 `options.fontSize`（无派生字号）。写入 §3.7。

**C5 三层解析的测试分布跨两套环境 —— 采纳（加注记）。**
已写入 §5.2 末段，避免后来者误以为 jsdom 覆盖了解析层。

**W1 §3.4 的「空洞」—— 说明（指控不成立，采纳其加固建议）。**
核验：`derivedMoves()`（`theme-overlays.spec.ts:236-249`）对 `replaced`（覆盖层**重新声明**的 token）逐个 `allowed.add(name)` —— **声明即计入 `moved`，与值是否等于基线无关**。于是：
- 不声明 ⇒ 不在 `moved` ⇒ 进 `mustMove` ⇒ **红**（「被强制声明」成立）；
- 声明了 ⇒ 进 `moved` ⇒ 若该面在 `MUST_NOT_MOVE` 里则进 `mustNotMove` ⇒ **红**（「被禁止声明」成立）。

审阅所指的「声明了但值等于基线不会被强红」针对的是 `mustMove` 方向，而强制力的来源是「不声明会红」—— 原表述与机械结果一致。审阅另称「§3.3 与 §3.4 混着说」，核验亦不成立（两处分别引用 `:351` 与 `MUST_MOVE`/`MUST_NOT_MOVE`，未混）。**但加固建议有价值**：§3.4 已补上 `moved` 的机械定义与两条断言的原文，R4 同步更新，供后来者自查。

**W2 base 声明与 `data-theme` 的漂移 —— 说明 + 采纳其注记。**
核验：`captureSnapshot`（`token-contract.spec.ts:45-53`）每次 `page.goto('/')` 后直读，`readTokens`（`main.ts:318-325`）只切 `.dark`、**不设 `data-theme`** ⇒ 基线恒为无主题态，漂移不成立。但「写明前提」成本为零，已写入 §6.1（含新键的值形状是字体栈、非 HSL 三元组）。

**W3 `.css` 主题的作用域限制 —— 修（与 C1 同一处置，且该限制消失）。**
采纳；因改用 fallback 哨兵 ＋ 探针挂 `body`，`body` 层声明也生效 —— **那条「必须写在 `:root`」的限制不必存在**。§6.2 第 5 条即为此边界。

**W4 字体变更必须 fit + resize —— 采纳，并升级为作者拍板（§8-P9，由 Pi-P2 与本条合并而来）。**
见下 Pi-P2。

**W4 附注 系统字体夹具假绿 —— 采纳，核验后范围更大。**
见「主动认领 1」。§6.3 夹具改用 `jetbrains-mono` ＋ `document.fonts.check` 前置断言。

**W5 预览页量化验收 —— 采纳。**
新增 §6.6，落成可断言条目（`term` 组存在该条目、两个 swatch 均为 `null`），复用 `readTokenPreviewSnapshot()`。

**W6 `useChatFontSettings` 漏列 —— 采纳（本片必需项）。**
已核实 `useChatFontSettings.ts:59-70` 显式 return，且设置页正由它读值（`AppearanceSettingsTab.tsx:13,46`）。§5.1 已列为必需项并写明要加 getter 与 setter。

**Pi-P1／Pi-P3 的「不开」是假开放 —— 采纳，核验完全属实。**
`FAMILY_RULES` 的 `/^--term-[a-z-]+$/` → `triplet-or-reference`（`userThemeTokens.ts:221`），`ruleForToken`（`:230-238`）会认下 `--term-font-family`。同段注释自己就记着同族教训（“a hex here compiles to `hsl(#0b1220)` and the declaration is dropped — the terminal silently keeps the previous colour”）。处置：在 `FAMILY_RULES` **之前**加一条显式不授权（令 `ruleForToken` 返回「主题不可设」），并补一条 `ignored` 断言。§5.1 与 §8-P3 已更新。

**Pi-P2 §3.7 与 §3.8 互相矛盾 —— 修（作者拍板取「统一 fit + resize」）。**
审阅指出的矛盾属实（`:335-342` 是 `FONT_SETTINGS_CHANGED_EVENT` 的唯一 handler）。取 (a)：字体必须 fit、字号同样需要 fit，且只加字体分支会留下「同一 handler 两种处置」的怪形状。§3.8 由「记账不修」改为「本片动作」，§9 第 3 条同步改判，§8 记为 §8-P9。

**Pi-P3 加载时序的缺口在「初始化」—— 采纳。**
属实且比「切换」更常见（用户选了 Web 字体后，每次冷开终端初始字体都是它）。§3.7 改为「首次 fit 挪到布局等待与 `fonts.load` 两者都完成之后」，§6.3 补初始化路径断言。

**Pi-P4 Menlo 串两处变三处 —— 采纳（定唯一来源），但落点按「主动认领 4」改正。**
核验属实：原文 §3.6 只写 `?? HARDCODED`，未交代它从哪来。采纳时改了落点 —— 兜底常量不能放在 hook 里被 `terminalTheme.ts` 引用（循环导入）。最终：`FALLBACK_TERMINAL_FONT_FAMILY` 定义在 `terminalTheme.ts`，`TERMINAL_OPTIONS.fontFamily` 引用它；`index.css` 那份是 CSS 侧镜像（无法消灭 —— §3.3 的制度闸门要求基色层必须声明）。**字面量总数 2（TS 1 ＋ CSS 1），并由 §6.1 的真引擎断言钉住两者逐字节一致。** §3.6、§5.1 已更新。

**Pi-P5 i18n 漏 zh-TW —— 采纳（转为待拍板 §8-P8）。**
核验比审阅者说的更强：en / zh-CN / zh-TW 的 `fontSettings` **键集完全相同**（差集为空），zh-TW 是完整翻译而非残缺块。主张补三端，但因涉及仓库 i18n 策略，列为 §8-P8 待拍板。

**Pi-P6 别加进 `TERMINAL_PROBE_TOKENS` —— 采纳（写成硬约束）。**
属实：`TERMINAL_PROBE_TOKENS`（`main.ts:49-55`）经 `:158` 变成 `{ property: 'color' }` 探针，会给字体令牌写 `hsl(var(--term-font-family))`，让 `rendered` 段多出一条语义无意义的记录并打破 §6.5 的预言。§5.2 已写硬约束，§6.5 补「增量只在 `tokens` 段」。

### 实施批次（供审阅者复核工作量与顺序）

按依赖序，每批独立门槛 ＋ 变异（沿用本线规矩：测试 ＋ 变异全 RED ＋ 双绿 ＋ 红集名字集对照）：

- **批 1（令牌与授权面，无 UI）**：§3.3 的 `index.css` 声明 ＋ §6.5 的基线预言与刷新；§8-P3 的授权面收紧（`userThemeTokens.ts`）＋ 一条 `ignored` 断言；`token-contract.spec.ts` 的 out-of-scope 注释（§3.3）。
- **批 2（解析与生效链路）**：`terminalTheme.ts` 的 fallback 哨兵 **＋ 空值检查**（C1 解法 ＋ 第 2 轮 C1）；§3.7 的四处改动（`document.fonts` 防御、`clearTextureAtlas`、首次 fit 时序）；§3.8 的 fit + resize 统一；`shellTerminalThemeRefresh.test.tsx` 的 mock 扩桩。
- **批 3（设置项与 i18n）**：`types.ts` / `utils.ts` / `useChatFontSettings` / 设置页 / 三端 i18n。

§6.2 的**七档**断言按批次分落：第 1~2 档在批 1~2，第 3~4 档在批 3，第 5~7 档（作用域、未声明、空值）在批 2。

---

### WorkBuddy（第 2 轮）

> 已在正文按处置更新的基础上复核我方第 1 轮 W1～W6。**W1 的撤回**：作者核验 `derivedMoves()`（`theme-overlays.spec.ts:236-249`）对覆盖层**重新声明**的 token 逐个 `allowed.add(name)`，即「声明即计入 `moved`，与值是否等于基线无关」——我第 1 轮称「声明但值等于基线不计入 moved」，此点在代码上**不成立**，撤回。§3.4 现补的 `moved` 机械定义与两条断言原文正确，R4 同步无误。**W2～W6 均已落地**：§6.1 前提、§3.6/§6.2 的 fallback 哨兵（比原两建议更彻底）、§3.8 升级为本片动作、§6.6 量化验收、§5.1 列 `useChatFontSettings` 为必需项——确认无异议。以下为第 2 轮的新增，其中 2 条是对**新解法**的复核。

> [!WARNING] **`--term-font-family` 可能被 `.css`/`.tmTheme` 主题写成非颜色值，但令牌契约的「every term token has a literal」不变量没有任何守卫（§3.3 / §6.5）**
> 新授权面收紧只堵住了 `.json` / `.tmTheme` 的 token 路由（`userThemeTokens.ts:212-238`）。但 §1.1 / §1.3 已确认 `console.css` 这类 **`.css` 主题原样注入 `<style>`**（`userThemeStyles.ts:207-210`），不经过任何校验——它可以写 `[data-theme="x"] { --term-font-family: "Comic Sans MS", cursive; }`，而且这正是 G2 要支持的用法。
> 问题在契约侧：§3.3 把 `--term-font-family` 说成「对应 22 个颜色令牌的 term 家族」，但这个家族现在**不再是同质的**。我已核实 `token-contract.spec.ts` 里**不存在**「term 家族每个令牌都持字面值」这类断言（`uncovered` 检查按 token 名逐条，不看族）：既没有「term 家族必须都是颜色」的守卫，也没有「term 家族值必须非空 / 非关键字」的守卫。
> **风险**：将来若有人给 term 家族补一条「值不得为空 / 不得为 `inherit`」的族级断言或文档，`--term-font-family` 会**默默成为例外**（它的合法值是字体栈，不是 `var(--palette-*)`），而没有任何测试会说「这是有意的异质成员」。
> **建议**：(a) §3.3 明确声明「`--term-font-family` 是 `--term-*` 家族**首个且唯一**的非颜色成员，后续针对 term 家族的族级断言必须显式排除它」，并在 §6.5 或 `token-contract.spec.ts` 加一条注释/断言把这条异质点固化——验证 §6.5 已要求的「既有键 0 漂移」里**不包含**按族遍历，否则新增成员会被误判为漂移；(b) 顺带确认 §6.2 第 2 档（注入覆盖层声明字体栈）注入的样式表作用域与真实 `.css` 主题一致（`[data-theme="…"]`），以免测的是一个真实主题写不出的作用域。

> [!WARNING] **`theme-overlays.spec.ts:484-501` 的「默认主题是恒等」会因新令牌的 `:root` 声明而改变含义，但 §3.4 未提及这条测试受影响（§3.3 / §3.4 / §6.5）**
> 我复核了这条测试：它在 `read(page, defaultTheme.id, appearance)`（`cc-light` / `cc-dark` 的 id）与 `read(page, null, …)` 之间断言 `differing(...)` 为空，即「挂上 appearance 默认 id 时，整张已解析令牌表不得与无主题态有任何差异」。
> `--term-font-family` 放在 `:root` 基色层（`index.css:230-251` 同一块，`:root` 声明在**两种 appearance 下都解析**），因此这条测试**仍应通过**——无主题态与 `data-theme="cc-light"` 态都会读到同一个基色层默认串，diff 为空。这点没问题。
> 但要注意它的**覆盖面比名字看起来窄**：该测试只走 `BUILTIN_THEMES` 里 `appearance !== 'system'` 的 id（`cc-light` / `cc-dark`），不覆盖三个覆盖层主题。所以它**不会**拦住「有人把 `--term-font-family` 误加进 `cc-polar` 的 overlay」——那属于 §3.4 的 `SURFACES` 问题，得靠 §6.2 独立断言。§6.5 的「既有键 0 漂移」预言应补一句：确认刷基线时**未**触碰 `cc-*` 的 `[data-theme]` 块。
> **建议**：§3.4 或 §6.5 加一句「本片不改任何 `[data-theme]` 块，`--term-font-family` 只在基色层 `:root` 出现一次」，把「既有键 0 漂移」的成立条件写清。

> [!TIP] **§3.6 的 fallback 哨兵值形状需在实现期确认：带引号的字符串 token 在 `getComputedStyle().fontFamily` 里可能被规范化为不带引号（§3.6 / §6.4）**
> 新解法用 `var(--term-font-family, "<哨兵>")`，靠「读回值 `===` 哨兵」判未声明。但 §3.6 自己已指出 `getComputedStyle().fontFamily` 会**规范化**字体栈（`'Fira Code'` → `"Fira Code"`）。哨兵既然是「带引号的字符串 token」，读回形状同样受这条规范化支配——实现时须以**读回后的实际形状**做相等比较，而不是以源码里写的哨兵字面量。
> **建议**：在 §6.4 的哨兵断言里明确「哨兵常量与比较基准都以 `getComputedStyle` 的读回形状为准」，并选一个**规范化为自身**的哨兵（例如一个明显不是字体名的裸标识符，或一个不会触发引号规范化的形态），避免「实现时按字面量比较、真引擎读回被规范化导致恒不等」的假红/假绿。§6.4 的双读法（生产函数 vs 裸探针）设计正确，只需补这条形状约定。

> [!NOTE] **§6.3 用 `document.fonts.check('14px "JetBrains Mono"')` 作前置断言很稳，但 `load()` 的实参在字体名归一化上仍需对齐（§3.7 / §6.3）**
> 我已确认 `src/index.css` 确实只有两个 `@font-face`（`Encode Sans:8`、`JetBrains Mono:19`），`jetbrains-mono` 是唯一自托管 Web 字体——§3.7 的更正属实。`fonts.check('14px "JetBrains Mono"')` 作前置门是对的。
> 只需注意：`CODE_FONT_FAMILY_CSS['jetbrains-mono']` 的栈首是 `"JetBrains Mono"`，而 `fonts.load()` 若传整条栈（含其后 `"JetBrainsMono Nerd Font Mono"` 等系统字名）也可，但**断言对象应是栈首那个自托管 face**；`check`/`load` 的家族名要与 `@font-face` 的 `font-family: 'JetBrains Mono'` 逐字一致（含内部空格）。§3.7 的 `${fontSize}px ${stack}` 已覆盖尺寸，这里只补「家族名逐字一致」这一条，避免 `check` 恒 `false` 使前置断言从门变成常红。

> [!NOTE] **§3.8 改判为本片动作后，`test:client` 基线（144 / 1208）需要同步预期，且移动端手势路径与设置页路径现在都 fit——请确认两条路径不会互相 resize 风暴（§3.8 / §6.3）**
> §3.8 合并后，设置页事件与移动端手势 (`:173-187`) 都会 `fit()` + 发 `resize`。二者若在某次交互中同时触发（例如移动端手势缩放后紧跟一次设置重读），会产生两次 `resize` 消息。xterm 侧应能容忍，但 pty 侧收到连续 resize 是否引发重排抖动，文档未提。
> **建议**：§6.3 的字号路径断言里，声明「同一交互只预期一次 resize，或明确接受两次并说明幂等」，避免实现期把「多一次 resize」当成 bug 去压，或反过来漏测真实风暴。另 §6.5 的 `test:client` 基线（144 / 1208）在 §3.8 扩大范围后应列出**新增用例的预期增量**，否则「逐文件增量与全量读数须吻合」这句没有可核对的数字。§6.6 的预览页断言随批 1。

---

### Claude（第 2 轮）

已对照源码核验作者对第 1 轮我方 C1~C5 的处置，**全部属实**：

- **C1（判空作用域分裂）**：改用 fallback 哨兵 ＋ 探针留挂 `body` 后，`body` 层声明的 `--term-font-family` 会被 `body` 子元素的探针继承到、`var()` 解析生效 —— 我原担心的「`html` 判空 vs `body` 值」分裂从根上消除，原 WARNING 撤销。§6.2 补第 5 条（`body` 层生效）与第 6 条（未声明回落）为边界固化，合理。
- **C2（hook 验证载体）**：三重处置（`document.fonts` 防御性调用 ＋ mock 扩桩 ＋ 载体明确分工）满意；作者主动认领 2 指出的「现有 `vi.mock` 只桩 `readTerminalTheme` ⇒ hook 一导入新函数即 TypeError」比我原来以为的严重，已列必需项，恰当。
- **C3/C4/C5**：分别以采纳、采纳为实现项、加注记落地，均确认。
- **作者主动认领 4（循环导入）**：`FALLBACK_TERMINAL_FONT_FAMILY` 定义在 `terminalTheme.ts` 导出、hook 引用，方向 `hook → theme` 不构成循环 —— 核验 `useShellTerminal.ts:21` 确已导入 `terminalTheme.ts`，改法正确。

以下为第 2 轮新增，均针对**新解法与拍板后引入**、且尚未被 WorkBuddy 第 2 轮覆盖的点。

> [!NOTE] **fallback 哨兵只判别「未声明」，判别不了「声明了但空/值非法」的退化态（§3.6 / §6.2 第 6 条）**
> 哨兵把「变量不存在」变成探针可返回的值，但它覆盖不了这三种退化态：`.css` 主题（G2 主角，`userThemeStyles.ts` 原样注入、**不校验**）可写 `--term-font-family: ;`（空）或 `--term-font-family: invalid`（非栈）。两种都会让该声明 "invalid at computed-value time" 而丢弃，探针读到**继承的 body 字体**、且不等于哨兵 → `readThemedTerminalFontFamily()` **返回 body 栈而非 `null`** → 解析层走 `body` 栈，不会回落到 `FALLBACK_TERMINAL_FONT_FAMILY`。这不是「未声明」，是「声明了但写坏」，哨兵救不了。
> **建议**：在 §3.6 或 §7 把这条记为**已知限制**（`.css` 主题写坏 = 用户错误，终端显示 body 字体是合理可观测的结果，不强制兜底），并可选加一道温和防御 —— 读回值非空且 `=== document.body` 的 `fontFamily` 时，可视为可疑。至少要写清它与 R10 的分工：R10 堵 `.json`/`.tmTheme` 侧，这条是 `.css` 侧仍残余的同类缺口。

> [!NOTE] **哨兵在开放的字体名空间存在理论碰撞（§3.6 哨兵选择 / §6.4）**
> CSS `<family-name>` 是 `<string>` 或 `<custom-ident>`，语法**开放** —— 一个 `.css` 主题完全可写 `--term-font-family: "哨兵"`（用户自定义字体名任意，本机没有也照常被 `getComputedStyle` 原样读回）。若该串恰等于哨兵，读回 `===` 哨兵 → **误判为未声明** → 返回 `null`。WorkBuddy 已提「哨兵选规范化为自身的形态」，我在其基础上补碰撞维度：哨兵还应选「字体名空间**极难自然出现**的形态」——例如含空格 + 明显非字体的串（如 `"__term_fallback_sentinel__"`），并把「哨兵必须带一个在真实字体名里几乎不会出现的特征」写成 §6.4 的选样约束。完全杜绝做不到（`<string>` 理论上可含任意字符），接受为极低概率已知项即可，但别用单单词的裸标识符（如 `sentinel`，它既是合法 custom-ident 又可能是某字体名）。

> [!TIP] **§6.1「逐字节相等」是隐性契约，依赖浏览器 font-family 序列化规则（§6.1 / §6.2 第 1 档）**
> 我核验当前基色层串 `Menlo, Monaco, "Courier New", monospace` 在 `getComputedStyle().fontFamily` 序列化下**确实逐字节稳定**：含空格的 `"Courier New"` 保留双引号、无空格的 `Menlo/Monaco/monospace` 本就无引号。但这依赖一条规则——「含空格或特殊字符的 family 保留引号，无空格 ident 被规范化去引号」。**只要基色层串保持"引号只出现在含空格名上"这个形态，§6.1 就成立**；但将来若有人把默认串改成 `Fira Code Retina, monospace`（无空格、但仍带引号擅自加的引号）之类，读回会被去引号、断言假红。
> **建议**：§6.1 的断言注释写明「该全等以浏览器序列化后的形状为契约」，并给 `ORIGINAL_FONT_STACK` 常量补一条注释「若将来改基色层串，断言与常量须按**读回形状**同步改，而不是按源码字面量」，避免实现者误以为它是 `===` 字面量恒等式、把未来一次合法改串当成回归去压。

> [!TIP] **§3.7 初始化路径 async 化需保证不拖慢默认（系统字体）用户的首屏（§3.7 / §6.3 初始化路径）**
> 作者把首次 fit 挪到「`TERMINAL_INIT_DELAY_MS=100` 布局等待」与「`document.fonts.load`」都完成之后。对默认用户（Menlo 系统字体，非 Web 字体），`load()` 立即 resolve，几乎无开销，可接受；但初始路径从「纯 setTimeout」变成「setTimeout + await」时序，需确认 await 链不意外串行拖慢首屏（例如 `document.fonts?.load` 在 jsdom 为 `undefined` 时的短路要分支写对，别让默认路径也走到一个解析的 await）。
> **建议**：实现时把「是否 Web 字体」做成一个前置判定，仅当解析出的栈首是个 `@font-face` 自托管家族名时才走 `await`，系统字体路径保持原时序；§6.3 初始化路径断言正好能验证这一点。

---

## 作者回应（第 2 轮）

> 2026-09-27，作者对第 2 轮 9 条批注（WorkBuddy 5 ＋ Claude 4）逐条核验后作答。核验方式**以实测为主**：用 chromium（`@playwright/test`）跑了一张「自定义属性退化态 × fallback 写法」的真引擎表（结果落在 §6.4），其余对照源码。两位审阅者各自撤回了第 1 轮的一条指控（W1、C1），作者确认撤回属实。
>
> **结论先行：9 条批注（W1 内含两条建议，按 10 条处置）指向的问题全部采纳。其中 3 条修正了审阅者给的表述或建议形态** —— C1 的举例（`invalid` 其实是合法家族名、不会落回 body 栈）、C2 的形态建议（含空格串会把引号规范化拉回来）、W3 的形态方向（实测确认）；另有 1 条（C4 的初始化分支）**否决其建议做法、采纳其另一半**。此外作者新拍板 1 项（P10），并把 §6.5 的门槛数字从记忆值换成**实测值**。

### 逐条处置

> W1 那条批注里含两条独立建议（家族异质 / 夹具作用域），分开处置，故下面有 **10 条**。

**W1a term 家族异质、且无族级守卫 —— 采纳（并核出比审阅者更具体的机制）。**
核实 `token-contract.spec.ts`：`uncovered` 检查按 token 名逐条（`:94-109`）；`:144` 那条虽名为「no colour token holds a literal value…」，实际过滤是**按值形状**（`:148-157`：先跳过 `--palette-*` / `--editor-*`，再看值是否命中 HSL 三元组 / hex / `rgb()`）。字体栈不命中 ⇒ **不需要新增断言**；但该测试注释里已有「Size, duration and env() tokens are out of scope」这句先例，把 `font stacks` 加进该清单即可。§3.3 已写明「首个且唯一非颜色成员」，§5.2 与附录 A 记了这条注释级改动。

**W1b 夹具作用域须与真实主题一致 —— 采纳。**
核实 `themeOverlaySelector()`（`userThemeTokens.ts:308-311`）生成 `[data-theme="<id>"]:not(.dark)` / `[data-theme="<id>"].dark`；§6.2 第 2 档已改成该形态。

**W2 恒等测试的含义与覆盖面 —— 采纳（结论已核实）。**
`theme-overlays.spec.ts:484` 确实只遍历 `appearance !== 'system'` 的两套（`cc-light` / `cc-dark`），故 `--term-font-family` 加在基色层不破坏它、它也拦不住「误加进覆盖层」。§3.4 补了该测试的覆盖面说明，§6.5 补了硬约束「本片不改任何 `[data-theme]` 块」。

**W3 哨兵形状的规范化 —— 采纳，实测确认了审阅者的方向。**
实测：`var(--x, "__S__")` 在 `--x` 未声明时读回 **`__S__`**（引号被去掉）；`var(--x, "__cloudcli sentinel__")`（含空格）读回**保留双引号**。处置：哨兵改**裸标识符**（唯一不必考虑引号形态的选法）＋ 比较基准写成读回形状。§3.6 / §6.4 已改。

**W4 `fonts.check` / `load` 的家族名逐字一致 —— 采纳（核实无冲突）。**
`@font-face` 是 `font-family: 'JetBrains Mono'`（`index.css:19`），`CODE_FONT_FAMILY_CSS['jetbrains-mono']` 的栈首是 `"JetBrains Mono"` —— 逐字一致。已写清断言对象是**栈首那个自托管 face**，不是整条栈。§3.7 已补。

**W5 resize 次数与 `test:client` 增量 —— 采纳。**
核实手势路径**已节流**（`ZOOM_THROTTLE_MS`，`mobileTerminalSelection.ts:708-724`）且只在整数档位变化时回调；两条路径由不同触发器驱动、无常规交叠。§6.3 写成「每个档位变化 ⇒ 恰一次 fit + resize，不做跨路径去重」；§6.5 列出预期新增用例 7～10 条的逐文件分解。

**C1 哨兵判别不了「声明了但空/非法」—— 属实，但举例需修正；空值那一类已精确堵住。**
实测（§6.4 表）：
- `--x: ;`（空值）→ `var()` 的 fallback **不启用**，落回 body 栈 ✅ 属实 ⇒ **已用「读原始值为空即视同未声明」精确堵住**；并写明读原始值必须与探针同一观测点（`body`），否则会重犯 C1 的作用域分裂。
- `--x: 0 0% 0%` → 同样落回 body 栈 ✅ 属实 ⇒ 记为**已知限制**（R12）。
- `--x: invalid` → 读回 **`invalid`**，**不落回** body 栈 ❌ 不成立 —— `invalid` 是合法的 `<custom-ident>` 家族名，声明有效。故退化态不是「非空即可能落回」，而是「**替换后不是合法字体列表**」才落回；缺口比原述更窄。
- 建议的「读回值 === body 栈即可疑」启发式：**否决**，理由见 §8-P10（会误伤用 `var()` 有意对齐 UI 字体的主题）。

**C2 哨兵碰撞 —— 采纳碰撞维度，修正其形态建议。**
碰撞维度成立（`<family-name>` 是开放语法，`.css` 主题可写任意串）。但审阅建议的「含空格 + 非字体串」会把引号规范化拉回来（实测：含空格串读回保留双引号），于是多一个形状约定。**裸标识符 ＋ 非字体名特征**同时满足「读回不变」与「极难碰撞」，取 `__cloudcli_term_font_family_unset__`。§6.4 写成选样约束。

**C3 §6.1 的「逐字节相等」是序列化契约 —— 采纳（实测确认了审阅者给的规则方向）。**
实测：基色层串 `Menlo, Monaco, "Courier New", monospace` 读回**同形** ⇒ G3 凭据稳；审阅举的两类反例都成立（`Fira Code Retina, monospace` → 被**加上**引号；`"FiraCode", monospace` → 被**去掉**引号）。§6.1 补了「以读回形状为契约」与 `ORIGINAL_FONT_STACK` 的常量注释要求。

**C4 初始化 async 不拖慢首屏 —— 部分采纳：采纳 jsdom 短路那一半，否决「仅 Web 字体才 `await`」的分支。**
否决依据：默认用户的栈（`theme` → `Menlo, Monaco, "Courier New", monospace`；`system` → `ui-monospace, SFMono-Regular, Menlo, …`）**都不含自托管 face**，`load()` 立即 resolve、无可测开销；为一个不存在的开销把「栈首是不是 `@font-face` 家族」这个脆弱判断塞进初始化路径不划算。采纳其另一半：jsdom 下 `document.fonts?.` 必须真的短路，由 §6.3 的初始化路径断言验证。若将来实测出可感延迟，再引入该判定（记账）。§3.7 已写。

### 门槛数字已换成实测（2026-09-27）

`npm test` 1029 / 1008 通过 / 20 失败 / 1 跳过；`test:client` 145 文件 / 1220 用例全绿；主题令牌套件 108 passed / 0 failed；`lint` 154 warnings / 0 error；`build` exit 0。**两条前提一并写进 §6.5**：工作区含并存改动（opencode auth、账户状态文案、chat transcript 等，非本方案），以及「读数必须晚于最后一次编辑」。原文那组数字（1021 / 1000、144 / 1208、lint 153）取自记忆，与实测不符，已替换。

---

### Claude（第 3 轮）

已对照源码核验作者第 2 轮对我方四项（C1~C4）与 P10 的处置，**全部属实并接受**；其中作者用实测纠正了我一处举例错误，我正式认账：

- **C1 举例纠正 —— 认账。** 我原写 `--term-font-family: invalid` 会让声明 invalid 丢弃、落回 body；作者实测 `invalid` 是合法 `<custom-ident>` 家族名、声明有效读回 `invalid`，不落 body。我第 2 轮对退化态的界定过宽，作者修正为「**替换后不是合法字体列表**才落 body」更精确。接受。
- **组合收口确认（这是作者比任何一位审阅者都整理得干净的一点）。** 作者把退化态分成三类并各给处置：空值 `--x: ;` → 读原始值为空视同未声明（且作者自己强调判空与探针须同一 `body` 观测点，防重犯 C1）；引用断裂 `--term-font-family: var(--undefined)` → 自定义属性应无 computed-value、哨兵 fallback 生效、返回 `null`（**两类都被闭合**）；替换后非合法列表（如无引号 `0 0% 0%`）→ 落 body，记为 R12 已知限制。三类之外无残余。此收口闭环。
- **关键不变量背书。** 我复核确认「默认态读回的是 `:root` 基色层默认串、而非 `body` 字体」：`--term-font-family` 是自定义属性，即便 `console.css` 把 body 的 `font-family` 钉成 JetBrains Mono，body 的 `--term-font-family` 仍继承自 `:root`（body 未覆盖），探针 `var()` 解析到的是 `:root` 默认串。故 §6.1 的「逐字节等于 `Menlo, Monaco, "Courier New", monospace`」（`useShellTerminal.ts:28`）**不依赖「body 恰好没有字体」这个巧合**，仅当 R8 整块删空或 R12 写坏时才可能读 body —— 零变化凭据成立。
- **C2/C3/C4/P10 处置确认。** C2 采纳碰撞维度、把哨兵改为裸标识符 `__cloudcli_term_font_family_unset__`（既读回不变、又极难碰撞），比我的「含空格串」建议更稳（含空格会被序列化拉回引号）；C3 采纳并补读回形状契约与 `ORIGINAL_FONT_STACK` 常量注释；C4 我方那条「仅 Web 字体才 await」的分支被我认同地否决（默认 `theme`/`system` 栈都不含自托管 face，`load()` 无开销，为不存在的问题加一个「栈首是否 `@font-face`」的脆弱判断不划算，采纳其 jsdom 短路另一半即可）；P10 否决「读回 === body 栈即可疑」启发式的理由成立（会误伤 `--term-font-family: var(--ui-font-family)` 这类有意对齐主题）。

> [!TIP] **W1a 的「异质成员」标记目前是注释级，可选补一条极便宜的断言级守卫（§3.3 / token-contract.spec.ts:144）**
> 作者核出 `:144` 那条「no colour token holds a literal value」实际是**按值形状**过滤（`:148-157` 跳过 `--palette-*`/`--editor-*` 后看是否命中 HSL/hex/rgb），字体栈天然不命中 ⇒ 现设计下字体令牌自动豁免、加 out-of-scope 注释已够。但 WorkBuddy 第 2 轮 W1a 的原始担忧是**将来**若有人把它按「族」重构（而非按值形状），注释可能被一起带偏。若要更强的代码级锁，可加一条最小不变量：`readThemedTerminalFontFamily()` 的读回值**不得包含 `hsl(` / `rgb(`**（或断言非空且非哨兵即视为合法家族列表）—— 极便宜，且把「字体令牌不是颜色」从注释变成可执行守卫。**非必需**：作者已用按值形状 + 注释闭合，这条是可选加固，供收口时成本为零地顺手加上。

---

### WorkBuddy（第 3 轮 · 回应 §8.1 的 P1 / P2 裁定请求）

> 本轮响应送审重点。我按 P1/P2 各给**明确裁定 + 理由 + 落点**，并对两条此前无人点出的**证据级发现**作补充（均已对照源码核验）。

#### 裁定 P1：取 A（默认 `'theme'`）。B 确实是 G3 的对立面，无条件排除。

> [!IMPORTANT] **P1 裁定 = A。理由不是"B 不好看"，而是 B 会让本方案的 §0 第一条承诺与 §6.1 的 G3 同时作废。**
> 我已核验 B 的连锁后果属实：`CODE_FONT_FAMILY_CSS.system`（`utils.ts:56`）首项为 `ui-monospace`，在 macOS/iOS 上解析为 SF Mono，而现状硬编码串首项是 `Menlo` —— 两者字形宽度不同（SF Mono 更窄），**升级后所有未设置用户的终端会当场换字体、且 `cols/rows` 随之改变**。这不是"风格偏好"，是"推翻已被 §0 写死的核心承诺"。A 用「多一个伪选项」换「零变化」，代价小一个数量级。

> [!WARNING] **但 A 有一个作者未评估的**先例断裂**，它不改变裁定结论、却要求 A 补一条说明（§3.5 / P1A）**
> 方案论证 A「设置下拉多一个『跟随主题』伪选项」时，未回答一个必然会被人问的问题：**同一个设置页里，代码字体（`codeFontFamily`）默认是具体值 `'system'`（`utils.ts:59`）、且**没有**「跟随主题」伪选项（`AppearanceSettingsTab.tsx:231-235` 直接遍历 `CODE_FONT_FAMILY_OPTIONS`）。** 而终端字体却默认 `'theme'`、并多一个伪选项。两个同为等宽的字体下拉，形态却不一致。
> 这**不构成反对 A 的理由**（代码字体没有主题令牌通道，给不了"跟随主题"；终端字体是本片新开的主题可调面，形态本就该不同），但**必须写进 §3.5**，否则 reviewer 会把它当"不一致"要求对齐，而一对齐就会把终端字体的主题通道关掉。建议 §3.5 加一句：「代码字体无 `--term-*` 式主题通道，故无 `theme` 伪选项；终端字体因新增主题令牌而必须有，两者形态差异是有意的。」
> 第三选项（默认具体字体 + 保留主题可调）我亦否决，理由与作者一致：默认值一旦是具体字体，用户层 `≠ 'theme'`，§3.1 的三层里主题层被永久短路，等于 G2 名存实亡。

#### 裁定 P2：取 A（`localStorage` 单值）。判据在本场景成立，B 的"好处"是伪好处。

> [!IMPORTANT] **P2 裁定 = A。判据（消费者决定形态）经核验成立，且 B 的层叠关系在仓库里有现成反例佐证。**
> 我核验了判据的两半：(a) `--ui-font-family` 确实**有非 JS 消费者**（`index.css:574-578` 的 `.chat-messages-pane … { font-family: var(--ui-font-family, …) }`），所以它落变量是对的；(b) 终端字体的唯一消费者是 xterm（canvas），**仓库里没有任何样式表读终端字体**（我 grep 过 `--ui-terminal-font-family` 不存在、也无任何 CSS 引用它）。故 A「落变量是多余间接层」成立。
> B 列的"用户选择能在令牌预览页可见"是**伪好处**：§3.2 已定预览页描述的是"基色与主题"、不是用户偏好；把用户偏好塞进去反而会污染那份快照的语义（用户一改设置，`token-baseline.json` 类的快照就会随人漂移）。B 的"与 `--ui-*` 命名体系统一"也站不住：`--ui-*` 那批是为了服务 CSS 消费者才存在的，终端字体没有 CSS 消费者，为"命名统一"引入一个无人读的变量是本末倒置。

> [!TIP] **P2 的落点补一条：`--ui-*` 与覆盖层的层叠麻烦在仓库里有实证，正好作为 B 的反面教材写进 §3.2（§3.2 / P2A）**
> §3.2 用「B 会引入层叠战争」论证否决，但给的是抽象理由。仓库里有现成机制可引：`useFontSettings.ts:15-19` 把用户字体**内联到 `document.documentElement.style`**（`--ui-font-size` 等），这是**内联样式**（specificity 最高）；而主题覆盖层是 `<style>` 里的 `[data-theme]` 规则（`index.css:1525` 等）。两者若写同一个变量名，内联必胜、主题永远压不过用户层 —— 这正是 §1.3 你说的"内联压不过覆盖层"那类麻烦的成因。
> **建议**：§3.2 把这段具体化为「B 一旦让用户层与主题层写同名变量，`useFontSettings` 式内联会以最高优先级锁死主题层，G2 直接失效」，用一个仓库内已有机制说明为什么 A 的"通道分离"是必要的、而非洁癖。

#### 补充：两条本轮新发现（均在作者已写内容之外）

> [!WARNING] **§3.6 第 3 步的空值防御写到 `body` 上，新增了一处「`body` 必须存在」的隐式依赖，而 §3.6 第 1 步的探针也挂 `body`——在 `readThemedTerminalFontFamily()` 的调用时机上需要确认 `document.body` 已就绪（§3.6）**
> 我复核了新增的空值检查：它读 `getComputedStyle(document.body)`。这比原方案多了一个前置条件——`document.body` 必须是当前文档里那个承载覆盖层的 body 元素。`useShellTerminal` 的初始化 effect 在 React 挂载后运行，此时 body 必在；但 `readThemedTerminalFontFamily()` 若被 `tests/theme-tokens/main.ts` 在模块顶层或极早期调用（fixture 是 framework-free、可能早于 `body` 构建），`document.body` 可能为 `null`。`getComputedStyle(null)` 会抛 TypeError。
> **建议**：§3.6 或 §5.2 注明「该函数假定 `document.body` 已存在；fixture 暴露它时须在 `DOMContentLoaded` 之后」。这属实现期注意项，不是设计缺陷。

> [!NOTE] **§6.5 的净基线提醒很好，但"在一份干净 worktree 上复测"这条建议本身会踩一个坑：`test:client` 的 145/1220 含并存改动，而主题令牌套件的 108 passed 是否也含并存改动未说明（§6.5）**
> 作者区分了"工作区含并存改动"与"读数必须晚于最后一次编辑"两条前提，方向正确。但表里只对 `test:client` 与 `lint` 标了"含并存增量"，**主题令牌套件那行 `108 passed / 0 failed` 没标**——而本片会往该套件加断言，若它也被并存改动影响，则"108 → 全绿"这个门槛同样不干净。
> **建议**：§6.5 在主题令牌套件那行补一句是否含并存改动的说明；若不含，也明说"该套件读数不受工作区改动影响"，让门槛表每一行都有同样的净度声明，避免 reviewer 只对 `test:client` 打问号、却漏看其余行。

> [!TIP] **P3 的授权面收紧可顺手消掉 R12 的一半：把 `.css` 主题的 `--term-font-family` 也做一次「替换后是否合法」的落点校验（§8-P3 / R12 / §3.6）**
> R12 记为"已知限制"的是 `.css` 主题写 `--term-font-family: 0 0% 0%` 这类**非空但非法**值 → 落 body 栈。作者已明确拒绝"等于 body 栈即可疑"的启发式（理由成立：会误伤 `var(--ui-font-family)` 对齐主题）。但 `.json` / `.tmTheme` 侧既然已在 P3 收紧授权面，可顺带把**验证标准从"形状规则"上移一层**：不只判值是否符合 `triplet-or-reference`，还在**编译产物**层面拒绝任何"通过 `font-family` 语法检查"失败的值（`CSS.supports('font-family', value)`，真引擎可用）。
> **建议**：这是可选项——若采纳，`.json`/`.tmTheme` 的 R12 残余可闭合；`.css` 侧因原样注入、无编译步骤，仍只能是 R12 已知限制。至少别让两处的"验证层级不同"被误读为疏漏，可在 R12 注明「校验发生在编译侧（json/tmTheme 可拦）、注入侧（css 不可拦）」。

---

## 作者回应（第 3 轮）

> 本轮两份：Claude（确认第 2 轮处置 ＋ 一条可选加固）、WorkBuddy（**对 §8.1 的 P1 / P2 给出裁定**，另附 4 条发现/建议）。
>
> **结论先行：P1、P2 均被裁定取 A（与作者主张一致），已回写正文（§8 / §8.1）；WorkBuddy 的 4 条中 3 条采纳、1 条修正事实前提后采纳；Claude 的加固是唯一不采纳项，但换成了一个对症的替代形式，两者都写进了 §5.2。**

### P1 / P2 的裁定（WorkBuddy）

两项均取 A，正文已改：**§8** 标题由「待拍板项」改为「决策项」、P1 / P2 标 `✅ 已裁定 = A`；**§8.1** 标题改为「P1 与 P2：展开与裁定（第 3 轮均取 A）」、每项末尾的「请审阅者裁定」改为「裁定（第 3 轮）」；**文首状态与 §0** 同步为「三审完毕」。

其中唯一超出作者原评估的是 WorkBuddy 为 P1 补的**先例断裂**：同一个设置页里，`codeFontFamily` 默认具体值 `'system'` 且下拉无伪选项（`AppearanceSettingsTab.tsx:231-235` 直接遍历 `CODE_FONT_FAMILY_OPTIONS`），而 `terminalFontFamily` 默认 `'theme'` 且多一个伪选项。核实属实（`utils.ts:59`），已写进 §3.5 并注明**差异是有意的**。

### 逐条处置

**P1A 先例断裂 —— 采纳。** §3.5 新增一条 bullet，写明两个下拉形态差异的根据是**通道不同**（代码字体没有 `--code-*` 主题令牌，给不出「跟随主题」），并点明「不要为对齐长相而删掉伪选项」——那等于关掉 G2。

**P2A 层叠实证 —— 采纳，但修正其表述。** 机制属实：`useFontSettings.ts:15-19` 把聊天字体内联到 `document.documentElement.style`（**内联样式**、specificity 最高），而覆盖层是 `<style>` 里的 `[data-theme="cc-ocean"]` 规则（`index.css:1525`，`(0,1,0)`）——已写进 §3.2。**修正**：审阅者说的是「B 一旦让用户层与主题层写**同名**变量」内联会锁死主题层，但 B 的原始形态用 `--ui-terminal-font-family` ＋ `--term-font-family` **两个不同名**变量，本身不成层叠关系；该结论严格说只对**同名变量**变体成立。已按「由此得到一条普适判据」改写并标出边界。另：审阅者引述的「§1.3 你说的『内联压不过覆盖层』」在 §1.3 原文里并不存在（§1.3 讲的是「xterm 的字体在 JS 里、CSS 够不着」），已按实际机制落笔，未沿用该引述。

**新发现 1（`document.body` 时序）—— 采纳「注明前提」的形式，修正其事实前提。** 实测本 fixture 不会出现 `body === null`：`tests/theme-tokens/index.html` 用 `<script type="module" src="/main.ts">` 且置于 `</body>` 之前，模块脚本默认 defer，执行时 body 必已就绪；**而同页顶层的 `buildProbes()`（`main.ts:555` → `:190` 的 `document.body.appendChild`）本就依赖同一前提**。所以这不是新隐患，是既有前提的延续。已在 §3.6 末尾注明「函数假定 `document.body` 已存在」并附依据，另写明：新增调用若改到 `<head>` 同步执行，`getComputedStyle(null)` 会抛 TypeError。

**新发现 2（§6.5 净度）—— 采纳。** 实测确认：`git diff --name-only HEAD` 与 `tests/theme-tokens/main.ts:1-16` 的 import 集合**无交集**，故 `108 / 0` 是净读数。§6.5 的前提 1 下已补一条，把门槛表每一行的净度归属写明（`test:client` / `lint` 含并存增量，主题令牌套件不含）。

**P3 建议（`CSS.supports` 编译侧校验）—— 不采纳其对象，采纳其洞察并修正 R12。** 建议的前提不成立：P3 主张**不授权**字体令牌给 `.json` / `.tmTheme`，那两个编译器**根本遇不到** `--term-font-family`，不存在「编译产物层面」可校验的对象；照写「校验发生在编译侧（json/tmTheme 可拦）」反而是**错的**。已改为在 R12 注明**暴露面只在 `.css`**（字体令牌无 `.json` / `.tmTheme` 路径），并把实测的 `CSS.supports` 适用边界记下备用：它拦得住字面非法值（`CSS.supports('font-family', '0 0% 0%')` = `false`），但**拦不住 `var()` 引用**（`'var(--x)'` = `true`）——后者由 §3.6 的哨兵独立闭合。将来 P3 若改判开放，这两条正是它的实现指引。

**Claude · W1a 加固（断言读回值不含 `hsl(` / `rgb(`）—— 不采纳其形式，换成对症的替代。** 两点：

1. **对象错位**：风险点在 `token-contract.spec.ts:148-157` 那条**按值形状过滤**的实现（若将来改成按族过滤，字体令牌会被误判为颜色）；而来函断言观测的是 `readThemedTerminalFontFamily()` 的**运行时读回值**，两者不在同一处，锁不到那个重构。
2. **不可证伪**：读回值**恒不含** `hsl(` / `rgb(` —— 非法值落 body（读到 body 字体栈）、合法值是字体栈，没有任何输入能把改前改后区分开（等价变异，见反向验证第十层）。写出来只会是一条恒真项。

替代形式（已写进 §5.2）：把豁免从**形状隐式**改为**显式名单** —— 在 `:151-152` 两个 `continue` 旁显式列出 `--term-font-family` 并注明「字体栈不是颜色（§3.3）」。一行、位置就在过滤逻辑内，按族重构时必被读到。**如实标注：它同样不可被当前测试证伪**（形状本就豁免），买的是「重构时被看见」而非「红灯」。

### 本轮之后的状态

- **P3～P8 已按作者主张裁定取 A**（第 4 轮用户拍板「按作者推荐」），均为范围取舍、不影响方案骨架。
- **P9 / P10 作者已拍板**，本轮无人反驳。
- 正文已按三轮处置更新；**尚未动一行生产代码**。
