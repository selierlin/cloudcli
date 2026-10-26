# CloudCLI 对话分享功能 — 审查问题修改清单

- **用途**：把一次代码审查里发现的「潜在隐患」落成可执行、可反驳的修改项，交给另一位审阅者复核后再实施。
- **审查对象**：工作区未提交改动（对话分享链接 / 选择导出 / workbuddy 权限模式收口 / zcode token 统计口径 / `scripts/harness-bench`）。
- **审查日期**：2026-10-26
- **基线**：改动前双端 `tsc --noEmit` 通过、`oxlint` 0 error、前端 1931 条 vitest 全绿、shares 12 条 + providers 73 条服务端测试全绿。**下列 7 条问题全部不在现有测试覆盖内**，测试全绿不代表它们不存在。

## 怎么读这份清单

每一条给出：位置 → 事实（可复核的代码依据）→ 影响（精确到触发条件）→ 改法 → 验证 → 风险。

「事实」一栏刻意写成可被推翻的形式。**如果审阅者认为某条不成立，请直接指认该栏里哪一句与代码不符**，而不是笼统地说「问题不大」。

## 总览

| 编号 | P 级 | 位置 | 一句话 | 需拍板 |
|---|---|---|---|---|
| A-1 | P1 | `src/modules/chat/ChatInterface.tsx:793`、`:844` | 分母判据拿「投影行数」比「原始行数」，凡有工具调用的会话恒不成立 | 否 |
| A-2 | P1 | `src/modules/chat/ShareTranscriptDialog.tsx:175` + `src/modules/quick-settings-panel/QuickSettingsExportSection.tsx:196` | 快速面板里打开的分享对话框被面板压在下面 | 否 |
| A-3 | P1 | `src/modules/quick-settings-panel/QuickSettingsPanelView.tsx:130-145` | 点对话框里任何按钮都会把快速面板关掉 | 否 |
| A-4 | P2 | `src/modules/settings/hooks/useSharedTranscripts.ts:72` | 撤销 404：设置页当失败、对话框当成功 | 否 |
| B-1 | P2 | `server/modules/shares/shares.routes.ts:41`、`server/modules/shares/shares.service.ts:89` | 分享页同源 + `unsafe-inline`，存储型 XSS 可窃取打开者 token | **是** |
| C-1 | P2 | `server/modules/shares/shares.service.ts:196` | 过期快照只在两个入口清扫，从不访问则永久残留 | 否 |
| C-2 | — | （前提不成立，已作废） | `/s/` 不进 `[REQ]` 日志：日志中间件只放行 `/api` | 否 |

---

## A. 前端：建议本批修复

### A-1（P1）整段已加载判据串了两个尺度

**位置**
- `src/modules/chat/ChatInterface.tsx:793`（判定）
- `src/modules/chat/ChatInterface.tsx:844`（导出调用）
- `src/modules/chat/ChatInterface.tsx:1137-1138`（分享调用）

**现状**

```ts
const wholeTranscriptLoaded = !hasMoreMessages && chatMessages.length >= totalMessages;
```

- 左边 `chatMessages.length` 是**投影后的 UI 行数**
- 右边 `totalMessages` 是**服务端 normalize 后的原始行数**
- 投影规则见 `src/modules/chat/hooks/useChatMessages.ts:563-601`：`stream_end / complete / status / permission_request / permission_resolved / permission_cancelled / session_created` **直接丢弃**，已配对的 `tool_result` **折进 `tool_use`**

⇒ 凡是产出 control 行、或产出**已配对** `tool_result` 的会话，该式**结构性恒为 false**。

**判定不依赖抽样**：claude 归一化同样产出带 `toolId` 的 `kind: 'tool_result'`（`claude-sessions.provider.ts:1611-1621`），投影会把它折进 `tool_use`（`useChatMessages.ts:597-601`）⇒ **有工具调用的 claude 会话同样不相等**。首版审查表里「claude / dsh 相等」那一行是样本恰好没有工具调用，不具代表性，已删除。

本机读到的两个样本（仅作量级参考）：

| provider | 服务端 `total` | 前端投影行数 | 说明 |
|---|---|---|---|
| workbuddy | 2748（含 877 条 `tool_result`） | ≈1871 | 差距最大 |
| zcode / opencode | 4（含 1 条 `stream_end`） | 3 | 差 1 条也足以判错 |

**影响的精确情形**（此处修正了首版审查报告的过度概括）

| 情形 | 应有标题 | 现状 |
|---|---|---|
| 整段已加载 + 全选 | `N 条消息` | `会话节选 · N` ← 因 `isExcerpt` 恒传 `true` |
| 整段已加载 + 部分勾选 | `N / 共 M 条消息` | `会话节选 · N`（**分母丢失，真实回退**） |
| 未整段加载 | `会话节选 · N` | 同左（正确） |

所以危害准确表述是「**部分勾选导出/分享时丢分母**」，而不是「整段被误判成节选」。后者是另一个独立文案缺陷（`isExcerpt: true` 硬编）。

另需注意「全选」这条路径实际不可达：选择模式**没有全选控件**（`TranscriptSelectionBar.tsx` 只有导出、分享、取消），可选行也只是 `chatMessages` 的真子集（`transcriptSelection.ts:27-33`：user turn 起点 + assistant 文本焦点行，过程组成员不可单独勾选），而窗口起点之前的游离行不属于任何 turn、永远进不了选中集合。因此第 3 步不能用数组长度比较。

**改法**

1. `src/modules/chat/hooks/useChatSessionState.ts` 新增 state `hasNewerMessages`，判定式：

   ```ts
   !slot.hasMore && !slot.turnPageInfo?.newerCursor
   ```

   该式已被既有四处使用，属先例：`loadOlderMessages`（:853、:875）、`loadNewerMessages`（:910）、搜索 seek（:1352）。`setHasMoreMessages` 实际有 **9 个写入点**（3 个是重置），必须与它同批更新，漏一个就会让判据停在旧值：

   | 行 | 场景 | 为什么必须写 |
   |---|---|---|
   | 444 | 会话切换重置 | 清掉上一会话的 `newerCursor` 结论 |
   | **511** | `refreshLatestFromServer` | 尾部刷新会重建 turn 窗口，`newerCursor` 可能重新出现 |
   | 841 | `loadOlderMessages` | 向上翻页 |
   | **901** | `loadNewerMessages` | **正是「又从别处追加了更新行」的入口**，漏它会把未整段报成整段 |
   | 1180 / 1213 | 重置 | 清空 |
   | 1243 | 初始加载 | 新会话第一页 |
   | 1352 | 搜索 seek | 中间窗口 |
   | 1621 | `loadAllMessages` | 整段拉取后重置 |

   然后从 hook 返回。

   **不复用 `allMessagesLoaded`**：它的 `ref` 在 `loadAllMessages` 发请求前就乐观置 `true`（:1594），失败才回滚（:1635、:1640）；读 ref 会在失败窗口内把「未整段」误报为「已整段」。读 state 虽无此问题，但该 state 还兼任 load-all 浮层的抑制信号，混用会让将来改浮层时踩到导出文案。新增一个只描述「更新方向还有未加载行」的窄 state 更省。

2. `ChatInterface.tsx:793` 改为：

   ```ts
   const wholeTranscriptLoaded = !hasMoreMessages && !hasNewerMessages;
   ```

3. `ChatInterface.tsx:844` 的 `isExcerpt: true` 改为**按可见条数**比较，不能用数组长度：

   ```ts
   import { countVisibleTranscriptMessages } from '@/modules/chat/utils/executionProcess';

   const selectedVisibleCount = countVisibleTranscriptMessages(selectedExportMessages, getExportMessageKey);
   const totalVisibleCount = countVisibleTranscriptMessages(chatMessages, getExportMessageKey);
   isExcerpt: !(wholeTranscriptLoaded && selectedVisibleCount === totalVisibleCount)
   ```

   理由：可选集合是 `chatMessages` 的真子集，数组长度比较依赖「逐 turn 勾满所有轮次」，而窗口起点的游离行永远进不了选中集合 ⇒ 长度恒小于总数。`buildTranscriptHtml.tsx:374` 内部虽有同样的等值判断，但它区分不了「恰好选满所有可见行」，所以调用侧仍要传对 `isExcerpt`。

   `:1138` 同理。

4. **不采用** `slot.offset >= slot.total`：realtime 追加会让 `offset` 落后于 `total`；cursor 判据与既有三处一致。

**验证**

- 直接断言 **`messageSummary` 文本**（分支在 `buildTranscriptHtml.tsx:372-377`），三态各一条，而不是断言 `totalMessages` 非 `undefined`（后者对任何非 undefined 值都成立，抓不到 `N / 共 N`）：
  - 整段 + 全部可见行选中 ⇒ `${N} 条消息`
  - 整段 + 部分选中 ⇒ `会话节选 · ${N} / 共 ${M} 条消息`
  - 未整段 ⇒ `会话节选 · ${N} 条消息`
- hook 级用例：给 slot 形如 `{ total: 2748, hasMore: false, turnPageInfo: { newerCursor: null } }`，断言 `wholeTranscriptLoaded === true`；再把 `newerCursor` 设为非空，断言变 `false`（覆盖 901 那条写入点）。
- 构造含 `tool_result` 的 storeMessages 走一遍 ChatInterface，确认整段判定成立。
- 文案键 `export.partialMessages` / `export.excerptMessages` 已存在，**无需 i18n 改动**。

**风险**：四个写入点漏一处会退化为「该有分母却没有」（安全方向）；若第 2、3 步判据不一致，会出现 `N / 共 N` 的荒谬标题，需要一条断言兜住。

---

### A-2（P1）快速面板里的分享对话框被面板压住

**位置**
- `src/modules/chat/ShareTranscriptDialog.tsx:175`（`<DialogContent>`）
- `src/modules/quick-settings-panel/QuickSettingsExportSection.tsx:196-204`
- `src/modules/quick-settings-panel/QuickSettingsPanelView.tsx:250`
- `src/shared/ui/Dialog.tsx:179`

**事实**

- `Dialog` 的 portal 根是 `fixed inset-0 z-50`（`Dialog.tsx:179`）
- 快速面板是 `fixed right-0 top-0 z-[9999]`（`QuickSettingsPanelView.tsx:250`）
- 同仓库先例：`src/modules/skills/ProviderSkills.tsx:629` 在 `z-[9999]` 的 Settings 里开对话框时显式写了 `wrapperClassName="z-[10000]"`
- `ShareTranscriptDialog` 目前**没有**透传 `wrapperClassName`

**影响**：阈值可解析算出。对话框固定居中、`max-w-md` = 448px，占 `[W/2 - 224, W/2 + 224]`；面板占 `[W - panelWidth, W]`。重叠条件：

```
W < 2 × (panelWidth + 224)
```

`panelWidth` 默认 320（`useQuickSettingsPanelWidth.ts:10`）⇒ 阈值 **1088px**：1024 宽窗口重叠 **32px**（`224 + 320 - 512`），1280 / 1440 在默认宽度下不重叠；面板拖到上限 400px 时阈值升到 **1248px**，1024 宽窗口重叠 **112px**。手机（浮层固定 `w-80`）必然重叠。

**改法**

1. `ShareTranscriptDialog` 增可选 prop `wrapperClassName?: string`，**默认值设为 `'z-[10000]'`**，即 `cn('fixed inset-0 z-50', wrapperClassName ?? 'z-[10000]')`。
2. **不逐调用点传参**。该对话框有两个入口，且都能在面板开着时打开：快速设置面板（`QuickSettingsExportSection.tsx:196`）与聊天选择栏（`ChatInterface.tsx:1131`）。逐点补传会让将来新增的入口再犯一次；而它本身就是一个不遮不挡的全屏模态，本就该压过一切面板。
3. **不改** `Dialog` 的默认 z：20+ 个调用点，风险大于收益。改在 `ShareTranscriptDialog` 这一层与「不动共享组件」并不冲突。

**验证**：浏览器四档实测，`document.elementFromPoint(dialogRect.right - 8, dialogRect.top + 8)` 必须落在 `[role=dialog]` 内：

| 视口 | 面板宽 | 期望 |
|---|---|---|
| 375 | 320（手机固定） | 修复前后都重叠，修复后对话框在上 |
| 1024 | 320 | 修复前重叠 32px（<1088 阈值） |
| 1024 | 拖到 400 | 修复前重叠 112px（<1248 阈值） |
| 1280 | 320 | 修复前不重叠，修复后仍不重叠（回归对照） |

jsdom 无布局，单测只能弱断言 className 透传，**以真机验收为准**。

---

### A-3（P1）在分享对话框内点击会关掉快速面板

**位置**：`src/modules/quick-settings-panel/QuickSettingsPanelView.tsx:130-145`

**事实**：外点关闭监听挂在 `document` 的 `mousedown` 上，只排除 `panelRef` 与 `handleRef`；而 `Dialog` 是 `createPortal(..., document.body)`（`Dialog.tsx:178`）⇒ 目标节点永远不在 `panelRef` 内。

**影响（按 pin 状态分岔，症状不同）**

- **浮层（默认，`pinned` 初值 `false`）**：`close()` 只让面板滑出，React 树仍在 ⇒ 对话框不消失；用户关掉对话框后落回一个已收起的面板。
- **停靠（用户 pin 过之后持久化）**：面板 body 只在 `isOpen` 时渲染（`QuickSettingsPanelView.tsx:222`），`close()` ⇒ 面板**卸载** ⇒ portal 里的对话框一起消失 ⇒ 随后的 `mouseup / click` 目标已不在树上 ⇒ **「创建链接」根本不执行，且没有任何反馈**。
- 两种模式下点对话框**遮罩**关闭，同样会顺带关面板。

**改法（必须改共享组件，`[role="dialog"]` 不够）**

`closest('[role="dialog"]')` 只能命中内容卡片（`Dialog.tsx:195`）；遮罩是它的**平级兄弟**（`Dialog.tsx:181-188`，`aria-hidden`、无 role），点遮罩时判据返回 null，面板照样关。所以：

1. `Dialog.tsx:179` 的 portal 根加 `data-dialog-layer=""`。
2. 面板侧 `handlePointerDown` 判 `target.closest('[data-dialog-layer]')`，命中即 return。
3. **Escape 通道同病，症状相反**：面板的 Escape 监听挂在 `window` capture 并 `stopPropagation()`（`QuickSettingsPanelView.tsx:109-124`），`window` 是 `document` 的祖先 ⇒ 事件到不了 `Dialog` 的 document capture（`Dialog.tsx:153`），而 Dialog 侧不检 `defaultPrevented` ⇒ 在分享对话框里按 Esc 会**关面板、留对话框**。在同一个 `useEffect` 的 `handleKeyDown` 里加同一条 `closest('[data-dialog-layer]')` 提前 return。
4. 该 Escape 监听在 `!isOpen || isPinned` 时不安装（`:104-107`）⇒ **键盘病灶只存在于浮层模式**；停靠模式下 Esc 由 Dialog 自己处理，修复前后都正常。

**验证**：`src/modules/quick-settings-panel/tests/QuickSettingsPanelView.test.tsx` 按 **2 模式 × 2 通道 = 4 格**写：

| 模式 | 通道 | 期望 |
|---|---|---|
| 浮层 | mousedown 落在对话框内容 / 遮罩上 | `onClose` 未调用 |
| 浮层 | Escape | 只关对话框，`onClose` 未调用 |
| 停靠 | mousedown 落在对话框内容上 | 面板不卸载、`onClose` 未调用 |
| 停靠 | Escape | `onClose` 未调用（监听本就未安装，属回归保护） |

另加一条反向断言：面板外 mousedown 仍要关面板。

**风险**：将来若有别的全局 dialog 盖在面板上，点它也不关面板——这正是期望行为。

---

### A-4（P2）撤销 404 的两处口径不一致

**位置**：`src/modules/settings/hooks/useSharedTranscripts.ts:72-75`；对照 `src/modules/chat/ShareTranscriptDialog.tsx:157`

**事实**：对话框用 `if (!response.ok && response.status !== 404) throw`；设置页用 `if (!response.ok) throw`。

**影响**：另一处先撤销（或行已被过期清扫）后，设置页弹「撤销失败」，且不刷新列表，那一行继续显示为 active。

**改法**：改为 `if (!response.ok && response.status !== 404) throw`，并补一行注释：404 = 已撤销或被过期清扫，与 `revokeShare` 返回 `false` 的语义一致。

**验证**：`src/modules/settings/tests/sharedTranscriptsTab.test.tsx` 新增 revoke → 404 用例：断言不设 `error`、仍调用 `fetchShares`。

---

## B. 安全设计：需拍板

### B-1（P2，**需拍板**）分享页与应用同源 + CSP 放开内联脚本

**位置**
- `server/modules/shares/shares.routes.ts:41-44`（CSP）
- `server/modules/shares/shares.service.ts:89-99`（上传校验）
- `server/index.ts:209-211`（挂载点）

**事实**

- `/s/:token` 挂在应用**同一源**上
- CSP：`default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: https:; font-src data: https: ...`
- 上传只校验 `^\s*<!DOCTYPE html` 与 `<html[\s>]`，其余**原样落盘**
- 页面里实际有**三处**可执行面：两段 `<script>`（`buildTranscriptHtml.tsx:521`、`:545`）＋ 一个内联事件处理器 `onclick="document.documentElement.classList.toggle('dark')"`（`:517`）。内联 handler **不受 nonce 管辖**，只能靠 `'unsafe-inline'` / `'unsafe-hashes'` 放行

**风险模型**（修正了首版报告）：发布者可以构造一个链接，让**任何打开它的人**（在该源上有登录态）执行任意 JS，读 `localStorage['auth-token']`（7 天有效），再经 `<img src="https://…">` 外发——`connect-src` 虽被 `default-src 'none'` 挡死，但 `img-src https:` 是放开的，图片请求可以携带数据。这是存储型 XSS，**受害者不是发布者自己**。

- 单用户本机部署（只自己开自己的链接）⇒ 危害≈0
- 多账号共用实例 / 对外暴露 ⇒ 账号接管

**选项与取舍（需拍板）**

| 选项 | 做法 | 成本 | 代价 |
|---|---|---|---|
| ① CSP 收紧（**推荐，安全边界**） | 删掉 `script-src 'unsafe-inline'`，让 `script-src` 回退 `default-src 'none'` | 极小 | 上传 HTML 里的 `<script>`、内联 handler、`javascript:` URL 全部不再执行 |
| ② 剥 `<script>` 块（纵深防御，非边界） | `createShare` 落盘前删掉 script 块 | 小 | **单独做挡不住** `<img onerror>` / `<svg onload>` / `<iframe srcdoc>`，必须与 ① 同时做 |
| ③ nonce 注入 | — | — | **无效**：无差别替换会让攻击者的 `<script>` 也拿到同一 nonce，等于没改；要区分只能做内容白名单 |
| ④ 独立源 | 子域 / 独立端口 | 大 | 彻底隔离，超出本次范围 |
| ⑤ 不改 | 只写注释 | 0 | 风险仍在 |

**推荐组合：①（必需）＋ 导出模板 `interactive` 开关（体验）＋ ②（可选）**

1. **服务端（安全边界）**：CSP 去掉 `script-src 'unsafe-inline'`。这一条**单独就能**阻断上传 HTML 里所有脚本执行，不依赖任何 HTML 改写。
2. **客户端（体验，非安全）**：给 `buildTranscriptHtml` 加 `interactive?: boolean`。为 `false` 时不渲染两段 `<script>`，也不渲染主题切换按钮（`:517`）。分享路径传 `false`，下载导出保持 `true`（离线文件没有 CSP，功能不受影响）。这样分享页不会出现「按钮点了没反应」。
3. ② 的剥脚本不是必需的——① 已经让 script 不执行，剥掉只是少让浏览器发一次被拦的请求。

**为什么不走「共享常量追加脚本」**：`server/tsconfig.json` 把 `@/*` 映射到 `server/*`、`include` 只含 `../shared`，并显式 `exclude: ["../src"]` ⇒ 脚本体**不能**放 `src/shared`（那条建议在现有构建下不可行）；要共享得放根级 `shared/` 或 `server/shared/`，并让前端跨目录相对引用。为两份静态 IIFE 引入这种耦合，收益不抵成本。

**CSS 外泄支线（写进注释即可，不阻塞）**：`style-src 'unsafe-inline'` 仍放开，配合 `img-src https:` 可用属性选择器 + `background: url(...)` 逐字符外泄**当前文档 DOM** 的内容。它读不到 `localStorage`，而分享页的 DOM 只有发布者自己的转写内容 ⇒ 不构成 token 泄露通道。但注释要写明：堵了脚本 ≠ 堵了外泄。

**验证**

- 服务端用例：上传 `<script>alert(1)</script>` 与 `<img src=x onerror=alert(1)>`，断言响应头 `script-src` 不含 `'unsafe-inline'`。
- 前端用例：`buildTranscriptHtml(..., { interactive: false })` 的输出不含 `<script` 与 `onclick=`。
- 真机：发布一条含代码块的分享，确认可读、外观是发布时的快照、复制按钮**不出现**（而不是出现后失效）。

**需要审批方回答**：按「① 必需 + `interactive` 开关 + ② 可选」实施，是否有异议；若要求彻底隔离（④），请明确由谁承担 nginx / 证书 / DNS 的改动。

---

## C. 服务端：低优先

### C-1（P2）过期快照只靠两个入口清扫

**位置**：`server/modules/shares/shares.service.ts:196-221`（`listShares` 是唯一 sweep）；`server/modules/shares/shares.module.ts`

**事实**

- `resolveShare` 只清「被打开的那一条」
- `listShares` 只在 `GET /api/shares`（设置页挂载）时触发
- `server/index.ts` 只有 `auth_events` 的 boot prune（`:403-410`），shares 没有

**影响**：发布后既不看设置页、链接也无人打开 ⇒ 过期 HTML 永久留在 `~/.cloudcli/shares`（单条上限 32MB）。7 天 TTL 在这里变成「只有被访问才生效」。

**改法**

1. 从 `listShares` 抽出 `sweepExpired(): Promise<void>`，`listShares` 内部复用。
2. `shares.module.ts` 导出 `sweepExpiredShares()`。
3. `server/index.ts` 的 `startServer` 在 `initializeDatabase()` 之后 best-effort 调用一次，照 `auth_events` 先例（失败只 `console.warn`，不阻断启动）。

**验证**：已有用例 `listShares sweeps expired rows and their files` 可平移到 `sweepExpired`；boot 调用本身不必单测（与 auth_events 同构）。

**风险**：boot 多一次全表 `list()`，分享条数为个位数，可忽略。

---

### C-2（P2）分享 token 全文进 `[REQ]` 日志

**位置**：清单首版写的是 `shares.routes.ts:34`（请求日志中间件）

**结论：前提不成立，未实施。** 实施时核对发现真正的请求日志在 `server/index.ts:162-178`，且第一行就是

```ts
if (!req.originalUrl.startsWith('/api')) { next(); return; }
```

`/s/:token` 不匹配 `/api` ⇒ **它根本不进日志**。`/api/shares/:shareId` 会进日志，但那是 UUID 行号，不是 bearer token。全仓库只有这一处 `[REQ]`（`grep -rn "\[REQ\]" server` 一条命中），没有 morgan 或其它访问日志。所以本机与远端都不存在「token 落进日志」的通道。

清单首版把这条件写成事实，是照着「路由里应该有日志中间件」的预期写的，没回去读索引。**保留本条仅为记录作废原因**：若将来把日志中间件扩到全路径（去掉 `startsWith('/api')` 的判断），这条会立刻变成真问题，届时按原改法（`/s/` 只打前 6 位）处理。

**验证**：`grep -rn "\[REQ\]" server` 只有 `server/index.ts:175` 一处；该 `app.use` 在 `/s` 挂载（`:211`）之前就 `next()` 掉了。

---

## D. 建议实施顺序与验收

顺序：**A-3 → A-1 → A-2 → A-4 → C-1 → C-2**；B-1 是安全边界，拍板后紧随 A-3 一起做。

A-3 排头是因为停靠模式下它让「创建链接」完全失效，已经不只是体验问题；A-1 只丢标题分母，内容不受影响。

```bash
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p server/tsconfig.json
export PATH="$HOME/.nvm/versions/node/v20.19.6/bin:$PATH" && npx vitest run      # 前端必须 Node 20
npx tsx --tsconfig server/tsconfig.json --test server/modules/shares/tests/*.test.ts
node scripts/check-locale-json.mjs
```

A-2 / A-3 必须补一次真机验收（jsdom 测不到层级与 portal 外点）。

---

## E. 未验证、请审批方重点看的地方

1. **A-1 的实测数字**只来自本机 2-3 个会话，不是全 provider 普查。但判定依据是**结构性**的（投影丢弃 control 行），不依赖抽样。
2. **A-2 的遮挡阈值**已解析算出（默认宽阈值 1088px、拖到 400px 时 1248px），但没在真机上量过像素；1024 宽窗口在默认面板宽下应重叠 32px，建议实测一次确认。
3. **B-1 的风险模型**经过一次修正（从「同实例其他账号拿你 token」改为「发布者窃取任何打开者的 token」）。这个模型的前提是分享链接会被别人打开——单用户本机不成立。
4. **A-3 的 `data-dialog-layer` 排除**依赖「对话框是唯一可能盖在面板上的浮层」这一假设。若将来面板上再叠 ActionMenu / Tooltip 等非 dialog 浮层，外点仍会关面板，需要一并复核。

---

## F. 审查范围内、但未纳入本清单的项

以下属于「值得关注」而非缺陷，不进本清单，避免审批时混淆优先级：

1. 发布失败重试可能留下一条用户看不见的孤儿分享（`ShareTranscriptDialog.tsx:120-138`）。
2. 选择导出成功后自动退出选择模式，是本次新增的行为变更（`ChatInterface.tsx:845-849`）。
3. `ShareTranscriptDialog` 按前端规范应放 `src/modules/chat/modals/`。
4. `scripts/harness-bench/` 430 文件 / 1.7MB，`results/` 是否入库需确认（已确认无硬编码密钥）。

原第 5 条（`/s/:token` 的 token 进日志）已升格为 **C-2**，不再留在观察区。

---

## 审阅批注

### CodeBuddy

> [!CAUTION] B-1 的推荐选项 ② 按清单写法**不成立**，它修不掉漏洞
> 清单把 ② 写成「CSP 改 `script-src 'nonce-X'`，serve 时读文件把 `<script>` → `<script nonce="X">`」。这个动作是**无差别**的：攻击者上传的 `<script>` 与模板自带的两段（`buildTranscriptHtml.tsx:521`、`:545`）拿到同一个 nonce，于是照样执行 —— 攻击面与现状等价，只是多了一次每请求读文件。
> ② 要成立，服务端必须能**区分**「模板脚本」与「用户内容」，那就回到清单自己否掉的「脚本内容白名单」；差别只是可以改成更硬的形态：**剥掉全部 `<script>` 后用共享常量追加那两段**（脚本体从 `buildTranscriptHtml.tsx` 挪到 `src/shared` 供服务端复用）。这等价于 ① 加上「保住打印展开与复制按钮」，成本与 ① 同量级，且不依赖哈希脆弱性。建议把它列为选项 ⑤ 并作为推荐项，而不是按 ② 拍板。

> [!IMPORTANT] A-3 的补丁只修了一半：遮罩层不在 `[role="dialog"]` 里
> `closest('[role="dialog"]')` 命中 `Dialog.tsx:195` 的内容卡片；而清单自己点名的第二种症状「点对话框遮罩关闭时同样会关面板」，遮罩是与该卡片**平级**的兄弟节点（`Dialog.tsx:181-188`，其 `onClick` 才调 `onOpenChange(false)`），没有 role ⇒ 判据返回 null，面板照样关。
> 所以「备选（更明确，但要动共享组件）」不是备选，是**唯一正确解**：给 portal 根（`Dialog.tsx:179` 那个 `fixed inset-0 z-50`）加 `data-dialog-layer`，面板侧判 `closest('[data-dialog-layer]')`，一次覆盖内容层与遮罩层。

> [!IMPORTANT] Escape 通道与 A-3 同病，且症状相反，A-3 的补丁完全管不到
> 面板的 Escape 监听挂在 **`window`** capture（`QuickSettingsPanelView.tsx:109-124`），并 `stopPropagation()`；`window` 是 `document` 的祖先 ⇒ 事件到不了 `Dialog` 的 document capture 监听（`Dialog.tsx:153`），而 Dialog 侧也不检 `defaultPrevented`。
> 净效果：在分享对话框里按 Esc ⇒ **面板关了、对话框还在**（浮层模式下）；停靠模式则因面板卸载把对话框一起带走。A-3 只加了 mousedown 判据，键盘这条仍是坏的。建议在同一个 `useEffect` 里给 Escape 分支加同一条 `closest('[data-dialog-layer]')` 提前 return。

> [!WARNING] A-3 的影响描述按 pin 状态不同，最坏是「按钮点了完全没反应」
> 停靠（`isPinned`）时面板 body 只在 `isOpen` 为真时渲染（`QuickSettingsPanelView.tsx:222`），mousedown 触发 `close()` ⇒ 面板**卸载** ⇒ 对话框一起消失；随后的 `mouseup/click` 目标已不在树上，React 的 `onClick` 不会触发 ⇒ 「创建链接」根本不执行。只有浮层模式才是清单写的「面板收起、对话框仍在」。
> 所以 A-3 的验收用例要分两种模式写；现有那条「body 下挂 `[role=dialog]` + dispatch mousedown」只覆盖浮层语义。

> [!IMPORTANT] A-1 第 3 步的 `isExcerpt` 判据结构性不可达，「全选」那一行改了也不会变
> 可选行是 `chatMessages` 的**真子集**：`isSelectableExportRow`（`transcriptSelection.ts:27-33`）只放行 user turn 起点与 assistant 文本焦点行，tool / thinking / 过程组成员都不可选；界面也没有「全选」控件（`TranscriptSelectionBar.tsx` 只有导出、分享、取消）。⇒ `selectedExportMessages.length === chatMessages.length` 在有工具调用的会话里恒 false，「整段已加载 + 全选 ⇒ `N 条消息`」这行仍然显示节选。
> 应比**可见条数**而非数组长度：`countVisibleTranscriptMessages(selectedExportMessages, key) === countVisibleTranscriptMessages(chatMessages, key)`（`executionProcess.ts:48`）。顺带：builder 里已经有 `totalVisibleCount === messageCount` 的等值判断（`buildTranscriptHtml.tsx:374`），但它区分不了「恰好选满所有可见行」，所以仍需要调用侧给对 `isExcerpt`。

> [!WARNING] A-1 的「四个写入点」少列两处，而漏掉的正是「又出现更新行」的入口
> `setHasMoreMessages` 实际有 6 处写入 + 3 处重置：511、841、901、1181、1213、1243、1352、1621。清单只列 1243/1352/841/1621，漏了 **511（`refreshLatestFromServer`）** 与 **901（`loadNewerMessages`）**——后者恰恰是「从别处追加了更新消息」的路径，正是 `newerCursor` 会重新出现的地方。漏它会让 `hasNewerMessages` 停在 `false` ⇒ 分母被错报，**不是安全方向**。
> 另外：901 已经在算 `loadedEveryDirection = !slot.hasMore && !slot.turnPageInfo?.newerCursor` 并写进既有 state `allMessagesLoaded`（:912），该 state 也已由 hook 返回（:1709）并被 `ChatInterface.tsx:224` 解构。**复用 `allMessagesLoaded` 比新增一个同义 state 更省**；但它在初次整段加载（:1243）与 511 都不写，直接复用会把「claude 单页会话整段已载」退化成节选，所以复用必须先补这两处。

> [!WARNING] A-1 实测表的「claude / dsh 相等」与代码不符，请重测（这会把爆炸半径说小了）
> claude 归一化确实产出 `kind: 'tool_result'` 且带 `toolId`（`claude-sessions.provider.ts:1611-1621`），而投影会把已配对的 tool_result 折进 tool_use（`useChatMessages.ts:597-601`）⇒ **有工具调用的 claude 会话同样 `chatMessages.length < total`**。若如此，受影响面比清单写的大，且验证项 3「claude 型回归」在真实会话里找不到样本。
> 建议用一条含工具调用的真实 claude 会话复核，而不是沿用 2-3 条抽样。

> [!TIP] A-2 的遮挡阈值可以解析算出来，不必留「未实测」
> 对话框固定居中、`max-w-md` = 448px ⇒ 重叠条件为 `viewport < 2 × (panelWidth + 224)`。`panelWidth` 默认 320（`useQuickSettingsPanelWidth.ts:10`）⇒ 阈值 **1088px**：1024 宽窗口必然重叠约 112px，1280 / 1440 在默认宽度下不重叠；但面板可拖宽，400px 时阈值升到 1248px。用这个式子定「只修浮层模式」比三档截图更稳。

> [!TIP] A-1 的验证断言太弱，抓不到它自己列的风险
> 「断言导出 payload 的 `totalMessages` 非 `undefined`」对任何非 undefined 值都成立，而清单风险一栏明确要兜 `N / 共 N`。建议直接断言渲染后的 `messageSummary` 文本，覆盖三态：`N 条` / `N / 共 M` / `节选 · N`（分支在 `buildTranscriptHtml.tsx:372-377`）。

> [!NOTE] 已逐条复核、事实成立的部分
> A-2 的 z 层级与先例（`Dialog.tsx:179` z-50 / `QuickSettingsPanelView.tsx:250` z-[9999] / `ProviderSkills.tsx:629` z-[10000]）、A-4 的两处 404 口径（`useSharedTranscripts.ts:73` vs `ShareTranscriptDialog.tsx:157`）、C-1 的「只有 `listShares` 与 `resolveShare` 清扫、boot 只有 auth_events prune」（`server/index.ts:406`，shares 无对应调用）——三处描述与代码一致，可直接实施。A-1 的机制（`total` 是服务端原始行数、投影丢 control 行与配对 `tool_result`）也成立。
>
> 唯一对**分级**的异议：A-1 标 P0，但清单自己已把影响修正为「部分勾选时丢分母」，且可达路径要求用户手工勾满全部轮次；按此证据 P1 更贴。反过来 A-3 的停靠模式症状（按钮点了没反应）比清单写的重要，实施顺序把 A-3 排在 A-2 前是对的。

### GLM

> [!IMPORTANT] B-1 漏了第三处内联脚本面：主题切换按钮的 `onclick` 属性
> `buildTranscriptHtml.tsx:517` 的 `<button ... onclick="document.documentElement.classList.toggle('dark')">` 是事件处理器属性，不在任何 `<script>` 块里。两个后果：② 的 nonce 方案对它**根本无效**（nonce 只作用于 `<script>` 元素，内联 handler 需要 `'unsafe-inline'` 或 `'unsafe-hashes'`，换 nonce 照样被 CSP 拦掉，按钮直接失效）；① 的代价清单也**少算了一项**——去掉 `script-src 'unsafe-inline'` 后不止失去打印展开与复制按钮，主题切换同时失效。无论选哪个方案，这个 handler 都必须挪进共享脚本常量（`addEventListener`），清单改法里应补上这一条，否则按 ①/② 落地都会引入新的功能回退。

> [!WARNING] B-1 ① 的安全性来自 CSP 收紧，不是来自「剥脚本」——实施时两者缺一不可
> 只删 `<script>` 块挡不住 `<img onerror>`、`<svg onload>`、`<iframe srcdoc>`、`<a href="javascript:…">`——上传校验（`shares.service.ts:97`）对 `<!DOCTYPE` 之后的内容原样落盘，这些变体全能进来。① 真正成立的前提是**同步去掉 `script-src 'unsafe-inline'`**：`script-src` 缺省时回退到 `default-src 'none'`，内联 handler 与 `javascript:` URL 一并被拦。建议把「剥脚本」明确定位为纵深防御、把「CSP 收紧」定位为安全边界，防止实施者只做前者。另：对 ⑤（CodeBuddy 提出的「剥脚本 + 服务端追加共享常量」），追加的两段脚本体来自共享常量 ⇒ 内容恒定 ⇒ 直接用 `script-src 'sha256-…'` 即可，比 per-request nonce 更省（不用每请求读文件改写），且清单否定的「哈希脆弱性」在「内容锁定为共享常量」这个前提下并不存在。

> [!WARNING] A-2 的 `wrapperClassName` 修法只堵住了快速面板这一个入口
> `ChatInterface.tsx:1126` 的选择栏路径同样能在快速面板（浮层）开着时打开这个对话框——面板盖着聊天区右缘，选择栏若在可视范围内即可点击——该调用点没人传 `wrapperClassName`，同样的压层会原样复现。与其逐调用点补传（将来新增入口还会漏），不如让 `ShareTranscriptDialog` 的 wrapper **默认** `z-[10000]`：它是不遮不挡的全屏模态，本就该压过一切面板（`ProviderSkills.tsx:629` 的先例语义相同，只是那次是显式传参）。清单第 3 步「不改 Dialog 默认 z」我同意，但「在 ShareTranscriptDialog 这一层改默认值」与「不改共享 Dialog 组件」并不冲突。

> [!IMPORTANT] A-3 补丁之外：面板 Escape 监听的安装条件使 pinned 模式键盘路径其实无恙，验收别按浮层结论外推
> 复核 `QuickSettingsPanelView.tsx:104-107`：`!isOpen || isPinned` 时 Escape 监听**不安装**，pinned 模式下 Esc 由 Dialog 的 document 监听（`Dialog.tsx:153`）正常处理、只关对话框——键盘通道的病灶仅存在于浮层模式。这与 CodeBuddy 指出的「窗口捕获 + stopPropagation」结论一致但边界更窄：修复与验收都只需覆盖浮层模式，pinned 模式两条通道（Esc、外点）在修复前就分别是好的和坏的（外点坏 = 面板卸载带走对话框）。验收矩阵应为 2 模式 × 2 通道，共四格，而不是一条用例。

> [!NOTE] 独立复核通过的事实（与代码逐一对上）
> A-4：`useSharedTranscripts.ts:73` 的 `if (!response.ok) throw` 与 `ShareTranscriptDialog.tsx:157` 的 `!== 404` 豁免，口径不一致属实，且对话框侧 404 置 `revoked=true` 的语义是对的，改法照抄即可。B-1：上传校验只看 DOCTYPE/`<html>`（`shares.service.ts:97`）、CSP 含 `script-src 'unsafe-inline'` 且 `img-src data: https:` 放开（`shares.routes.ts:43`），外发通道成立。C-1：`listShares` 是唯一全量清扫、`resolveShare` 只清被打开的那条、boot 无 shares 对应调用，属实。A-1 写入点清单：`setHasMoreMessages` 实际写入 9 处（444/511/841/901/1180/1213/1243/1352/1621），清单列的四处确漏 511 与 901，CodeBuddy 的补充成立。claude provider 确实产出带 `toolId` 的 `kind: 'tool_result'` 行（`claude-sessions.provider.ts:1611-1621`），投影折叠后 `chatMessages.length < total` ⇒ 实测表「claude / dsh 相等」一行需要重测，CodeBuddy 的质疑成立。分级异议（A-1 降 P1）我也同意：丢的是标题分母，不丢内容，可达路径窄。

> [!TIP] A-1 复用 `allMessagesLoaded` 的一个不对称要先想清楚
> 该 state 置 true 的位置：850/870（loadOlderMessages）、912（loadNewerMessages）、1356（搜索 seek）、1625（loadAllMessages）；初始加载（:1243 附近）与 `refreshLatestFromServer`（:511）确实不写——复用前先补这两处的结论成立。但另有 `loadAllMessages` 入口处在发请求**之前**就乐观置 `allMessagesLoadedRef.current = true`（`useChatSessionState.ts:1594`），失败路径靠 1635/1640 回滚。若新判据读 ref 而非 state，这个乐观写入在请求失败窗口内会把「未整段加载」误报为「已加载」；读 state 则无此问题。复用方案应明确只消费 state、不动 ref 语义。

> [!TIP] B-1 的威胁模型还有一条 CSS 外泄支线，写注释时一并说明
> `style-src 'unsafe-inline'` 放开了内联样式表，配合 `img-src https:`，攻击者可用属性选择器 + `background: url(https://…)` 逐字符外泄 `localStorage['auth-token']` 之外的页面内容——即使将来把脚本问题解决、只要 `img-src https:` 和内联 style 仍在，CSS 侧的外泄通道就还在。不要求本批修，但选项 ④ 的「写进注释」应把这条也写上，避免后来者以为堵了脚本就等于堵了外泄。

> [!TIP] F-5（token 进 `[REQ]` 日志）建议升格进清单而不是留在观察区
> 分享 token 是「知道 URL 即可打开」的 bearer 凭据，`shares.routes.ts:34` 把完整 token 写进日志等于把它长期落盘：日志的生命周期不受 7 天 TTL 管，也不随撤销消失；实例一旦多人使用或日志被采集，读取日志的人就拿到了仍可能有效的链接。修法很轻——日志中间件对 `/s/` 路径只打前 6 位——不值得为它单开一轮审批，建议并入 C-1 批次顺手做。

---

## 批注处置（2026-10-26 第二轮）

上面两段批注原文保留不动，便于对照。本节记录哪些已改回正文、哪些只改说法、哪些没采纳。

### 已采纳并改写正文

| 批注 | 改动 |
|---|---|
| CB：A-1 降 P1 | 标题与总览表改 P1，并写明「丢的是标题分母，内容不丢」 |
| CB：claude 也产出 `tool_result` | 删掉「claude / dsh 相等」那行，改为结构论证（`claude-sessions.provider.ts:1611`） |
| CB：写入点漏 511 / 901 | 改为 9 处完整清单，并说明 901 是会重新出现 `newerCursor` 的入口 |
| CB：`isExcerpt` 判据不可达 | 第 3 步改为按 `countVisibleTranscriptMessages` 比可见条数 |
| CB：验证断言太弱 | 改为断言 `messageSummary` 三态文本 |
| GLM：A-2 阈值可解析 | 补公式与 1088 / 1248 两个阈值 |
| GLM：A-2 只堵一个入口 | 改为 `ShareTranscriptDialog` 默认 `z-[10000]`，覆盖选择栏与快速面板两个入口 |
| CB：`[role=dialog]` 不覆盖遮罩 | 改为 `data-dialog-layer`（加在 portal 根，同时覆盖内容层与遮罩层） |
| CB：Escape 通道 | 并入 A-3 改法第 3 条 |
| CB：停靠模式按钮无反应 | 影响改为按 pin 分岔，验收改为 2 模式 × 2 通道 |
| CB：nonce 无差别 | 选项 ③ 直接判无效 |
| GLM：漏 `onclick` 内联面 | 事实补第三处可执行面；`interactive: false` 同时管住按钮 |
| GLM：① 的安全来自 CSP 收紧 | 推荐组合改为「CSP 收紧 = 边界，剥脚本 = 纵深防御」 |
| GLM：F-5 升格 | 新增 C-2，F 节注明迁移 |

### 采纳结论、但修正了批注自己的说法

1. **CB 说「全选恒 false」**——不准确。全选可由用户逐 turn 勾满实现（选中一个 turn 会把该 turn 所有行的 key 都加进去）。真正导致数组长度比较不可靠的是：没有全选控件、可选集合是真子集、窗口起点游离行永远不属于任何 turn。结论（必须换判据）不变。
2. **CB 说停靠模式的 Escape 也会关面板**——不准确。`QuickSettingsPanelView.tsx:104-107` 在 `!isOpen || isPinned` 时根本不安装该监听；停靠模式的 Esc 由 Dialog 自己处理，修复前后都正常。键盘病灶只在浮层模式（GLM 的边界判断是对的）。
3. **CB 建议脚本体放 `src/shared`**——现有构建下不可行。`server/tsconfig.json` 的 `@/*` → `server/*`，`include` 只含 `../shared`，且显式 `exclude: ["../src"]`。要共享必须放根级 `shared/` 或 `server/shared/`。而新方案（CSP 收紧 + `interactive` 开关）不需要共享常量。
4. **GLM 的 CSS 外泄支线**——技术成立，但危害要收窄：属性选择器只能读当前文档 DOM，读不到 `localStorage`；分享页 DOM 只有发布者自己的转写内容。写进注释即可，不构成 token 通道。
5. **GLM 的阈值结论对、像素数不对**——公式 `W < 2 × (panelWidth + 224)` 与 1088 / 1248 两个阈值都正确；但「1024 宽必然重叠约 112px」是 `panelWidth = 400` 的数，默认 320 时实际是 **32px**（`224 + 320 - 512`）。正文已按两种面板宽分别标注。

### 未采纳

1. **复用 `allMessagesLoaded`**（CB 与 GLM 都提了）。三点理由：
   - 它的 `ref` 在发请求前就乐观置 `true`（:1594），失败回滚，读 ref 会在失败窗口内误报；
   - 它是 load-all 浮层的抑制信号，兼任导出判据会让将来改浮层时踩到文案；
   - 新增 `hasNewerMessages` 只需改 9 个写入点，复用则要先补 2 处（1243、511）再处理 ref/state 分裂，改动量更大。
   
   GLM 对「ref 乐观写入」的提醒已被吸收：新 state 只从 `slot` 派生，不读任何 ref。

### 仍需人工拍板

（原为 B-1，2026-10-26 已批准按「CSP 收紧 + `interactive` 开关」实施，见文末实施记录。）

---

## 实施记录（2026-10-26）

用户批准「按推荐方案实施」后逐条落地。以下记的是**实际改了什么**，与上面的计划若有出入，以本节为准。

### 逐条落点

| 编号 | 状态 | 落点 |
|---|---|---|
| A-1 | 已实施 | `useChatSessionState.ts` 新增 `hasNewerMessages`（9 个写入点与 `setHasMoreMessages` 同批；判据 helper `hasNewerPageLeft(slot)`）；`ChatInterface.tsx:793` 改 `!hasMoreMessages && !hasNewerMessages`；`:844`/`:1157` 的 `isExcerpt` 改由 `selectionIsWholeTranscript` 决定，后者用 `countVisibleTranscriptMessages` 比可见条数 |
| A-2 | 已实施 | `ShareTranscriptDialog` 新增 `wrapperClassName?: string`，**默认 `z-[10000]`**，透传 `DialogContent`；两个入口都不用传 |
| A-3 | 已实施 | `Dialog.tsx:179` portal 根加 `data-dialog-layer=""`；面板 `mousedown` 判 `closest('[data-dialog-layer]')`；Escape 判 `document.querySelector('[data-dialog-layer]')`（不用 event.target：portal 的 rAF 聚焦前一帧焦点还在面板上） |
| A-4 | 已实施 | `useSharedTranscripts.revoke` 放行 404 并继续 `fetchShares()` |
| B-1 | 已实施（推荐组合的 ①+`interactive`） | CSP 去掉 `script-src 'unsafe-inline'`（回退 `default-src 'none'`）；`buildTranscriptHtml` 增 `interactive?: boolean`，`false` 时不渲染主题按钮与两段 `<script>`；`chatExport` 透传；`ShareTranscriptDialog` 的快照固定 `interactive: false`。**② 剥脚本未做**——① 已是边界，剥掉的只是被拦的请求 |
| C-1 | 已实施 | `shares.service.ts` 抽出 `sweepExpired()`，`listShares` 复用；`shares.module.ts` 导出 `sweepExpiredShares()`；`startServer` 在 `auth_events` prune 之后 best-effort 调用 |
| C-2 | **未实施（前提不成立）** | 见上文 C-2 节：`/s/:token` 不进 `[REQ]` 日志 |

### 与计划的两处出入

1. **A-1 第 3 步的实现形态**：计划写「`selectedVisibleCount === totalVisibleCount`」两块比较，实施时收成一个 `useMemo` 布尔（`selectionIsWholeTranscript`），两个调用点共用。理由同计划：两个入口若各写一遍，将来必然漂移。
2. **A-3 的 Escape 判据**用 `document.querySelector` 而不是 `target.closest`。计划写 `target.closest`，但 dialog 打开后的第一帧焦点仍在面板上（portal 在 `requestAnimationFrame` 里聚焦），那一帧按 Esc 会关面板。改判「文档里是否存在 dialog 层」更稳，代价是「面板上有任何 dialog 时 Esc 归 dialog 管」——正是期望语义。

### 验证

- `npx tsc --noEmit`（前端 + `server/tsconfig.json`）双绿。
- 新增/扩充的用例：
  - `quick-settings-panel/tests/QuickSettingsPanelDismiss.test.tsx`（7 条）：2 模式 × 2 通道 + 两条反向回归。
  - `chat/tests/sessionTranscriptCompleteness.test.tsx`（2 条）：中间窗口 ⇒ `hasNewerMessages === true`；最新页 ⇒ 两侧皆 false。
  - `chat/tests/transcriptExport.test.tsx`：`interactive: false` 无 `<script`/`onclick=`/主题按钮；默认仍保留。
  - `chat/tests/shareTranscriptDialog.test.tsx`：对话框落在 `z-[10000]` 的 `data-dialog-layer` 上，且构建参数 `interactive: false`。
  - `settings/tests/sharedTranscriptsTab.test.tsx`：撤销 404 仍刷新列表。
  - `shares.routes.test.ts`：`/s/:token` 的 CSP 不含 `script-src`；`shares.service.test.ts`：`sweepExpired` 独立可跑。
- **反向验证**：逐条把守卫改回旧行为（删 `isInDialogLayer` 判据、Escape 判据、初始加载写 `false`、404 放行、CSP 加回 `script-src`、`interactive` 恒 true、`sweepExpired` 空转），对应新增用例全部转红；还原后全绿。**「绿了不等于测到了」这条已实测**。

### 未覆盖（需人工验收）

1. **A-2 / A-3 的真机层级**：jsdom 无布局，单测只能断言 className 与事件不被消费。仍需浏览器四档（375 / 1024 / 1024 拖宽 / 1280）确认 `elementFromPoint` 落在 dialog 内。
2. **A-1 的调用侧接线**：`selectionIsWholeTranscript` 本身没有用例——仓库里没有渲染 `ChatInterface` 的测试骨架（现有三条只覆盖子组件），为它搭一整套 ws/store/provider 替身不划算。可验证的是它下游的 `messageSummary` 三态（已有用例）与上游的 `hasNewerMessages`（新增用例）。**残留风险**：两个计数在「答案行被折进过程组」时可能不等，方向是「本该说整段却仍说节选」——不比修前差，但可能不达理想。
3. **B-1 的真机观感**：发布一条含代码块的分享，确认可读、无主题按钮、无复制按钮；下载导出仍要有主题按钮与复制按钮。
4. **服务端改动需重启守护进程才生效**（`sweepExpired` 的 boot 调用、CSP 头）。本次未重启。
