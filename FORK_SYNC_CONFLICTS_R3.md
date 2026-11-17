# 第三轮同步（2026-11-16）

> 本文件是 [FORK_SYNC_CONFLICTS.md](./FORK_SYNC_CONFLICTS.md) 的第三轮拆分；第一、二轮记录仍在原文件。

> **同步模式**：`main-first`（upstream → fork `main` → `cloudcli-dev`）
> **基线**：`13e9ef64`（fork `main` = v1.37.7）
> **上游目标**：`upstream/main` = `f86543fa`（v1.37.9）
> **规模**：32 个提交、250 个文件、+25788/−1066
> **冲突**：upstream → `main` 为 **fast-forward（0 冲突）**；upstream → `cloudcli-dev` 共 **80 个文件 / 197 个冲突块**（73 UU + 3 AA + 4 DU）
> **本篇粒度**：逐文件、逐冲突块，先读合并现场及前后上下文，再写结论；每块一条，编号 001–197，与预演 worktree `git merge --no-commit --no-ff upstream/main` 的行号一一对应。
> **重要背景**：本地 `cloudcli-dev` 始终用 `git checkout upstream/main -- <file>` 之类的方式逐文件复刻上游，本轮 250 个上游改动文件中 **19 个已与上游逐字节一致**（含整套 webhook 通知、browser_upload_file、Copy Path、二进制下载等），因此冲突集中于「接线点」与「两套同名功能」，不是从零合入。

## R3.0 阅读说明

- **HEAD 侧** = fork 当前代码（`cloudcli-dev` @ `fbdb39d5`）；**upstream 侧** = `upstream/main`（`f86543fa`）。
- **类别**：`A` 机械合并（两侧互不相关，取并集）、`B` 功能叠加（并集但需调整接线）、`C` 路线取舍（同一能力两套实现，必须产品决策）、`DU` fork 删除 vs upstream 修改。
- 每条都给出「建议动作」之一：**取本地** / **取上游** / **并集** / **手工融合（说明要点）**。
- 行号为预演 worktree 中合并后文件的行号（冲突标记 `<<<<<<<` 所在行）。
- **完成状态**：197 / 197 块已逐块读完并记录（001–197 连续无缺号）；块外必须一并处理的问题汇总在 **R3.2**。
- **基线复核（2026-11-17，HEAD 前进到 `fbdb39d5`）**：fork 新增两个提交 `372854fb fix(chat): 自动链接不再误伤中文加粗`、`fbdb39d5 feat(scheduled-tasks): 定时任务可选权限模式`。在 `fbdb39d5` 上重做了预演（worktree `/tmp/fork-sync-audit-r4`，分支 `sync-audit-r4`），结果与上一版（`669384e3`）**逐文件块数完全相同：80 个文件 / 73 UU + 3 AA + 4 DU / 197 块**，因此 R3.1 的编号与行号全部仍然有效。
  - 新增提交触及的 10 个文件**没有一个落在 80 个冲突文件里**，所以没有新冲突、也没有块内行号漂移。
  - 两侧都碰到的 3 个文件（`chat/transcript/Markdown.tsx`、`locales/en/settings.json`、`locales/zh-CN/settings.json`）合并结果与 `fbdb39d5` **逐字节相同**——上游那部分改动在 fork 里早已复刻，本轮没有新的上游增量，不存在"被本地版本静默覆盖"的丢失。
  - 新提交的运行时依赖都不受合入内容影响：`MCP_PROVIDER_NAMES`（`shared/constants.ts:130`，位于冲突块 L359 之前）、`usePermissionModes`、`PillBar`、`ScheduledTaskInput.permissionMode`（合并后的 `shared/types.ts:2800` 仍在）；服务端 `server/modules/scheduled-tasks/*` 上游本轮未改（上游只动了 `scheduled-messages` 的派发器，与定时任务功能无关）。`usePermissionModeCopy` 的改名保留了同名 hook 包装，`ChatInterface.tsx` 的调用点也都在冲突块之外。

## R3.0.1 决策清单（D17–D23，2026-11-17 已由 亮 拍板）

D1–D16 见 [FORK_SYNC_CONFLICTS.md](./FORK_SYNC_CONFLICTS.md) §7。第三轮新增 7 项，**已于 2026-11-17 由 亮 全部拍板**，下表"最终选择"即执行依据。

| 编号 | 决策 | 选项 | 最终选择 | 波及 |
|---|---|---|---|---|
| **D17** | 上游 side questions 与本地 btw 抽屉 | 甲 只保本地 btw，成片删除上游侧问；乙 只接上游侧问，删本地 btw；丙 两套并存但**只留 btw 一个前端入口** | **丙**：后端侧问路由/service 原样保留，前端不接 `useAskSideQuestion`、`ComposerSendMenu` 的旁问项不渲染（092/095 对应分支删掉，避免 unused） | `claude-runtime`、`codex-runtime`、`opencode-*`、`provider.routes`、`ComposerSendMenu`、`useSideQuestions`、chat 导出 |
| **D18** | 项目会话列表渲染哪棵树 | A 上游 fork 树；B 本地一层树；C 融合 | **C-lite（融合，手动归类优先）**：树结构取上游（连接线/折叠/`treeRow`），`buildProjectSessionTree` 多读一条 `parentSessionId` 边并优先使用，拖拽后行**真的移动到父会话下**；选择模型仍用本地 props（映射见 171） | 165–171、174、175–177、179/181/183/184 |
| **D19** | 归档/删除入口是否统一 | 甲 补回归档项；乙 统一改成"删除" | **甲**：`SidebarContent`×4、`SidebarRecentConversations`×2 恢复"归档会话 + 删除会话"两项，删除仍走永久删除确认，归档点击即执行 | 156、182、`SidebarContent`、`SidebarRecentConversations`、`mobileSessionFork.test` |
| **D20** | 上游 steering（`chat.steer` + `SteeredMessageCard`） | 保留 / 只留后端 / 删除 | **保留** | 056、090、099–103、130 |
| **D21** | 上游 `/clear`（`clearSessionContext`） | 保留 / 本轮不接 UI | **保留**（当前仅 `claude` 声明 `supportsContextClearing`） | 013–015、061、091、096 |
| **D22** | opencode 连续 reasoning 分片是否继续合并 | 保留本地累加 / 退回上游"一分片一气泡" | **保留**（须同步改 `countShownPartMessages` 的 outline 计数，见 054） | 054 |
| **D23** | 批量选择模型 | 本地 `isManaging` + `Set` / 上游 `selectedSessionIds` | **本地选择 + 批量弹窗加"永久删除"**：保留本地选择（项目列表与最近会话都覆盖），`BatchSessionArchiveConfirmation` 弹窗改成"归档 / 永久删除 / 取消"；上游 controller 选择 API 与其 `sessionBulkSelection.test.ts` 仍然删除 | 169、171、176–177、158/159、R3.2 §1 |

## R3.1 逐块记录

### 001 · `docs/architecture/02-realtime-stream.md` 第 1 块（L76）· A · **并集**

**冲突块**：架构表两行的描述。

- 本地：`useChatSessionState` 是「subscribe、requestLatestMessages、投影 store 行、调度带护栏的 follow 帧」；`useChatComposerState` 出站为 `chat.send/edit-send/abort/permission-response`。
- 上游：`useChatSessionState` 多了 `resetStreamingState` 与 `chatMessages` memo；`useChatComposerState` 多了 **`chat.steer`**。

**上下文**：表下方 L87 的 `chat-websocket.service.ts` 行在上游侧已含 `chat.steer`（该行未冲突，自动合并进来了），所以文档内已出现「表里没写、下文写了」的不一致。

**建议**：`useChatSessionState` 行取**本地**（本地实现是 guarded follow frame，上游描述对应的是上游实现）；`useChatComposerState` 行取**本地并补 `chat.steer`**（是否保留 steer 取决于决策 D20）。这不是纯文档问题——若 D20 采纳上游 steering，L87 已自动带入，必须同步补这一行。

### 002 · `electron/scripts/generate-macos-icon.js` 第 1 块（L11）· C · **取本地（并修自动合并的 import）**

**冲突块**：本地在文件内定义 `renderSvg`/`renderPng`；上游把这两个函数抽到新文件 `electron/scripts/logo-svg.js`，冲突块内 upstream 侧为空（即删除）。

**上下文**：
- 本地 `renderSvg` 画的是 **fork 自己的图标**：`#EAF2FF` 圆角底 + `public/cloud-terminal-mark-flat.svg` 居中贴图，`renderPng` 用 `sharp` 栅格化。
- 上游 `logo-svg.js`（新文件，已自动合入）画的是**完全不同的图案**：`#2563eb` 纯色方底 + 一个聊天气泡 path，且不引用 fork 的 mark。
- 自动合并后文件第 2 行变成了 `import { renderPng } from './logo-svg.js';`，**本地的 `import sharp from 'sharp'` 被吃掉**——若直接保留本地函数体，`sharp is not defined` 会在打包脚本运行时才炸。

**两侧意图**：上游为 Linux `.deb` 抽公共美术资源；fork 早已替换成自己的图标。

**建议**：取**本地**函数体，同时手工做两件事：① 恢复 `import sharp from 'sharp';`；② 删除自动合入的 `import { renderPng } from './logo-svg.js';`。另需跟进：上游新增的 `generate-linux-icons.js` 仍会用 `logo-svg.js` 的上游图案，Linux 包图标会与 macOS 不一致，建议后续把 `logo-svg.js` 换成 fork 图案，或让 Linux 脚本复用本文件的 `renderSvg`。

### 003 · `package-lock.json` 第 1 块（L3）· A · **取上游（1.37.9）**

**冲突块**：顶层 `"version"`：本地 `1.37.8` vs 上游 `1.37.9`。

**上下文**：本地版本号比 fork 的 `main`（1.37.7）还高一位，说明上一轮同步后本地自行 bump 过；本次目标是合到 v1.37.9。

**建议**：取**上游 `1.37.9`**，并与 `package.json` 的版本保持一致。lockfile 最终会被 `npm install` 重写，此块只需保证与 `package.json` 同版本，避免 `npm ci` 报 `version` 不一致。

### 004 · `package-lock.json` 第 2 块（L13）· A · **并集**

**冲突块**：`packages[""]` 的 `version` 与 `dependencies` 头部。

- 本地：`version 1.37.8` + `@anthropic-ai/claude-agent-sdk ^0.3.165` + 5 个 `@capacitor/*`（cli/core/ios/keyboard/preferences）。
- 上游：`version 1.37.9` + `@anthropic-ai/claude-agent-sdk ^0.3.311`。

**上下文**：capacitor 是 fork 的 iOS 版依赖，上游没有；SDK 升级是上游本轮的核心依赖变更（Codex/Claude 运行时的类型与行为都跟着变）。两侧改动互不覆盖。

**建议**：**并集**——`version 取 1.37.9`、SDK 取 `^0.3.311`、保留 5 个 capacitor 依赖。其余依赖项按字母序自动合并无冲突。

### 005 · `package-lock.json` 第 3 块（L42）· A · **取上游（新增）**

**冲突块**：`@openai/codex-sdk` 一行。

- 本地：无此行（`@openai/codex` 已是 `0.166.0`）。
- 上游：新增 `"@openai/codex-sdk": "^0.166.0"`。

**上下文**：上游把 Codex 的 app-server 客户端从直接抓 CLI 输出改为经 SDK 驱动（对应 `codex-app-server.client.ts` 的大改），SDK 与 CLI 同版本号是硬约束；本地 Codex 也走 app-server，但用的是本地封装的协议层。

**建议**：**取上游**新增该依赖。若后续 Codex 接入仍走本地实现、确认无人 `import '@openai/codex-sdk'`，可以在代码合完后再决定是否移除；但本轮先按上游补上，避免 `codex-app-server.client.ts` 合并后缺依赖。

### 006 · `package-lock.json` 第 4 块（L5605）· A · **取上游（新增）**

**冲突块**：`node_modules/@openai/codex-sdk` 的完整 lock 条目。

- 本地：空（该包未安装）。
- 上游：`0.166.0`，`resolved` 指向 registry，`dependencies: { "@openai/codex": "0.166.0" }`，`engines.node >=18`。

**上下文**：与 005 配套的实体条目；`@openai/codex` 的图 0.166.0 与本地现有版本一致，不会造成重复安装。

**建议**：**取上游**。实际执行 `npm install` 后此块由 npm 重算，人工只需保证合并后不残留冲突标记。

### 007 · `package.json` 第 1 块（L3）· A · **取上游（1.37.9）**

**冲突块**：`"version"`：本地 `1.37.8` vs 上游 `1.37.9`。

**上下文**：紧随其后的 `"desktopName": "ai.cloudcli.desktop.desktop"` 已由上游自动合入，与本地 `build.appId = "ai.cloudcli.desktop"` 并存，是 electron-builder 的 Linux 桌面文件名用途，不冲突。

**建议**：**取上游 `1.37.9`**，与 003 保持一致。

### 008 · `package.json` 第 2 块（L193）· A · **并集**

**冲突块**：`dependencies` 头部。

- 本地：`claude-agent-sdk ^0.3.165` + 5 个 `@capacitor/*`。
- 上游：`claude-agent-sdk ^0.3.311`。

**上下文**：SDK 从 0.3.165 跳到 0.3.311 是上游本轮所有 Claude 行为的基线（steering 的 `replay-user-messages`、elicitation 回调、side question fork 都依赖新版类型）。本地 `claude-runtime.provider.ts` 里大量直接读 SDK 选项（`settings`、`extraArgs`、`includePartialMessages`），合并后必须按新版类型重新过一遍。

**建议**：**并集**——SDK 取 `^0.3.311`，保留 5 个 capacitor 依赖。合并 `claude-runtime.provider.ts` 后先跑 `npx tsc --noEmit`，SDK 类型不兼容会集中在这里暴露。

### 009 · `package.json` 第 3 块（L214）· A · **取上游（新增）**

**冲突块**：`@openai/codex-sdk`。

- 本地：无。
- 上游：`"@openai/codex-sdk": "^0.166.0"`，紧邻本地已有的 `"@openai/codex": "0.166.0"`。

**上下文**：与 lockfile 的 005/006 是同一件事。本地 Codex 运行时目前不依赖 SDK 包，但合并 `codex-app-server.client.ts` 后需要它（上游 470 行的客户端改动以 SDK 类型为基础）。

**建议**：**取上游**。若最终决定 Codex 仍走本地协议实现，可在代码合完后单独移除本依赖并重锁。

### 010 · `server/modules/agent/agent.routes.ts` 第 1 块（L1148）· A · **取上游**

**冲突块**：Claude 分支调用 `queryClaudeSDK` 时的 `unattended` 参数。

- 本地：写死 `unattended: true`（注释：没有人能回答 MCP 表单）。
- 上游：透传 `unattended` 变量（注释：只读响应的调用方无法回答表单；有人在 UI 里看这次运行的调用方传 `false`）。

**上下文**：合并后的文件 L977 已自动合入上游的 `const unattended = !(req.body.unattended === false || req.body.unattended === 'false');`，L750 的 JSDoc 也已被上游改写。也就是说变量已存在，本地写死 `true` 会让该 API 参数**静默失效**（传 `false` 也不生效）。

**建议**：**取上游 `unattended`**。这是纯「本地旧实现 → 上游新参数」的更替，无 fork 特有语义需要保留。合并后确认 `/api/agent/run` 的文档（`public/api-docs.html` 已自动合入 6 行）与该参数一致。

### 011 · `server/modules/database/migrations.ts` 第 1 块（L434）· A/B · **并集**

**冲突块**：在 `addForkedFromSessionIdColumn` 之前，两侧各插了一段「函数/注释」。

- 本地：`forked_from_session_id` 列的 JSDoc（注释本体 + 紧随其后的函数在冲突块外，L452）。
- 上游：新增 `addSupersededReasonColumn`，给 `superseded_provider_sessions` 加 `reason TEXT NOT NULL DEFAULT 'edit'`。

**上下文**：注册处两侧都已自动合入——L736 调 `addSupersededReasonColumn(db)`，L748–749 调 `addForkedFromSessionIdColumn` 与 `addSessionParentColumn`。若这里把上游函数丢掉，L736 会 **TS/运行时立刻报未定义**；若把本地注释丢掉，L452 的函数会变成无注释裸函数。

**建议**：**并集**——保留本地的 `forked_from_session_id` 注释，并在其前插入上游的 `addSupersededReasonColumn` 整个函数。顺序建议：`addSupersededReasonColumn` → 本地注释 + `addForkedFromSessionIdColumn` → `addSessionParentColumn`，与 L736/L748/L749 的调用顺序一致。

### 012 · `server/modules/database/repositories/sessions.db.ts` 第 1 块（L4）· A · **并集**

**冲突块**：文件头部 import。

- 本地：`normalizeContentTimestamp`、`normalizeProjectPath`、`SessionNameSource`（unread 水位与标题来源）。
- 上游：`normalizeProjectPath`、`ClearedContextSegment`、`SessionForkAncestor`（清空上下文分段与 fork 祖先）。

**上下文**：L20–L26 的 `SessionRow` 已自动合入两侧字段（`name_source`、`isPinned` 等），说明本文件确实两套功能都在用。缺任何一个 import，合并后 `tsc` 会在对应函数处报错。

**建议**：**并集**四条全保留：`normalizeContentTimestamp, normalizeProjectPath` 与 `ClearedContextSegment, SessionForkAncestor, SessionNameSource`。合并后跑 `oxlint` 确认没有未使用 import（若某个决策砍掉上游能力，再按实际使用裁剪）。

### 013 · `sessions.db.ts` 第 2 块（L820）· B · **手工融合（保留两个方法）**

**冲突块**：同一个方法位上，本地是 `supersedeAndDetachSession(...)`，上游是 `clearProviderSessionContext(...)`。两侧都调用 `db.transaction(...)()` 并以共享的 `})();\n},` 收尾。

- 本地：`supersedeAndDetachSession(sessionId, {providerSessionId, provider, jsonlPath})` —— 「首个 prompt 被编辑（start over）」用，事务内 `markProviderSessionSupersededIn(db, ...)` + UPDATE detach，返回 `void`。
- 上游：`clearProviderSessionContext(sessionId)` —— `/clear` 用，事务内先查行，再 `sessionsDb.markProviderSessionSuperseded({..., reason: 'context_cleared'})` + `detachProviderSession`，返回 `boolean`（无可清上下文时 false）。

**上下文**：两者是**不同语义的两条路径**（编辑重来 vs 主动清空上下文），不是新旧替代，必须共存。共享尾部只能服务一个方法，另一个要补写自己的 `})(); },`。另注意：本地 `markProviderSessionSupersededIn`（L146）**目前不写 `reason` 列**，而 011 刚给表加了该列；上游的公开方法签名已含 `reason?: 'edit' | 'context_cleared'`（L918）。

**建议**：**并集**——
1. 保留 `supersedeAndDetachSession` 原样（编辑路径默认 `reason='edit'`）。
2. 追加 `clearProviderSessionContext` 完整方法，并让它走本地 helper。**注意不能直接展开会话行**：`markProviderSessionSupersededIn` 的入参是 camelCase（`providerSessionId`/`provider`/`sessionId`/`jsonlPath`，见 `sessions.db.ts:146-165`），而查出来的行是 snake_case（`provider_session_id`/`jsonl_path`，见 `SESSION_ROW_COLUMNS`），且 `provider_session_id` 可为 null。按字面写 `{ ...session, sessionId, reason }` 会同时触发"缺必填字段"和"多余属性"两类 `tsc` 错误。改成显式映射：
   ```ts title=sessions.db.ts - 显式字段映射
   markProviderSessionSupersededIn(db, {
     providerSessionId: session.provider_session_id,
     provider: session.provider,
     sessionId,
     jsonlPath: session.jsonl_path,
     reason: 'context_cleared',
   });
   ```
   （`provider_session_id` 为 null 时该行无可清上下文，方法应提前返回 `false`，不进入事务。）
3. 把 `markProviderSessionSupersededIn` 的入参扩展出可选 `reason`，INSERT 列表补 `reason` 列，值取 `input.reason ?? 'edit'`；**保留本地现有的 `jsonl_path = COALESCE(excluded.jsonl_path, superseded_provider_sessions.jsonl_path)`**——上游写法是直接覆盖，会把已记录的正确路径抹成 NULL。
4. `supersedeAndDetachSession` 在事务里继续用 `markProviderSessionSupersededIn(db, ...)`，不要改成 `sessionsDb.markProviderSessionSuperseded`（后者另开语句、破坏「同一事务」的初衷）。

### 014 · `sessions.db.ts` 第 3 块（L881）· B · **取上游（新增方法）**

**冲突块**：本地空，上游新增 `getClearedContextSegments(sessionId)`。

**上下文**：查询 `superseded_provider_sessions WHERE session_id=? AND reason='context_cleared' ORDER BY created_at, rowid`，把行映射成 `{providerSessionId, jsonlPath, clearedAt}`。它依赖 011 新增的 `reason` 列（默认 `'edit'`，清空路径显式写 `'context_cleared'`），是本轮 `/clear` 后回读旧对话的唯一入口。`normalizeTimestamp` 是本地已有函数（L60），不需要额外 import。

**建议**：**取上游**整段方法，前置的 `/**` 注释也一并保留。若 D21 决定不接 `/clear`，该方法与 `ClearedContextSegment` 可以整体不引入；但既然 `reason` 迁移已在自动合并里（L736），建议至少保留数据层，避免后续再接时补迁移。

### 015 · `sessions.db.ts` 第 4 块（L920）· B · **手工融合**

**冲突块**：`markProviderSessionSuperseded` 的方法体，以及紧随其后的上游新方法 `recordSupersededTranscriptPath`。

- 本地：方法体只有一行 `markProviderSessionSupersededIn(getConnection(), input);`。
- 上游：内联 INSERT（含 `reason` 列，`ON CONFLICT` 时 `jsonl_path = excluded.jsonl_path`、`reason = excluded.reason`），随后新增 `recordSupersededTranscriptPath(providerSessionId, provider, jsonlPath)`（仅当 `jsonl_path IS NULL` 时补写路径）。

**上下文**：合并后 L912–L919 的签名已自动合入上游的 `reason?: 'edit' | 'context_cleared'`（默认 `'edit'`）。也就是说公开方法已声明 reason，但本地 helper（L146）不写该列——若只保留本地一行，`reason` 会被**静默丢弃**，`getClearedContextSegments`（014）永远查不到 `context_cleared` 行，`/clear` 后旧对话回读为空。`recordSupersededTranscriptPath` 则被上游 `claude-session-synchronizer.provider.ts`（第 1 块）直接调用。

**建议**：**手工融合**——
1. 方法体保留本地一行委托。
2. 扩展 `markProviderSessionSupersededIn`：入参加 `reason?`，INSERT 列补 `reason`，冲突更新补 `reason = excluded.reason`；**`jsonl_path` 继续用本地的 `COALESCE(excluded.jsonl_path, superseded_provider_sessions.jsonl_path)`**，不要照抄上游的 `excluded.jsonl_path`（会把已有路径抹 NULL，与 014 的「回读旧对话」直接冲突）。
3. 保留上游新增的 `recordSupersededTranscriptPath` 方法（L935–L950），它是 `session-synchronizer` 补路径的落点。
4. 补完 `reason` 后，把 `isProviderSessionSuperseded` 上方的 JSDoc（当前写的是 "left behind by an edit or rewind"）改成 "edit / rewind / context cleared"，否则下一轮同步时又会有人以为 `/clear` 产生的行不该被跳过索引。

### 016 · `notifications.routes.ts` 第 1 块（L5）· A · **取本地**

**冲突块**：import 行。

- 本地：`import { sendBarkTestNotification } from '.../bark-notification.service.js';`
- 上游：无此行（上游没有 Bark 通道）。

**上下文**：紧随其后的 L9–L12 已自动合入上游的 `WEBHOOK_CHANNEL / webhookNotificationsService` import，说明本文件合并后同时承载 **Bark（fork 独有）** 与 **Webhook（两侧都有且实现一致）**。Bark 服务文件 `bark-notification.service.ts` 只在 fork 存在，不能删。

**建议**：**取本地**保留 Bark import。合并后确认 `notifications/index` 或 orchestrator 里 Bark 通道仍在（本地 `notification-orchestrator.service.ts` 是 fork 从上游 `.js` 改名而来，见 DU 记录）。

### 017 · `notifications.routes.ts` 第 2 块（L170）· C · **取本地**

**冲突块**：`router.post('/test', ...)`。

- 本地：只接受 `channel === 'bark'`，调用 `sendBarkTestNotification(userId, endpointId)`，返回 `{success, results}`。
- 上游：没有这条路由（upstream 侧为空）。

**上下文**：逐条对照两侧路由表，上游只有 `/endpoints*` 与 `/webhook*`（webhook 自带测试端点），**从未有通用 `/test`**；本地的 `/test` 是 Bark 专用，且前端 `src/shared/api.ts` 的 `notifications.test({channel, endpointId})` 仍指向它（该 API 段在 `api.ts` 冲突块里被本地保留）。删掉它会 404。

**建议**：**取本地**保留整条 Bark `/test` 路由。合并时注意它与上游 `POST /webhook/test`（L214 附近）**不要合并成一个**：两者入参、通道与返回结构都不同。

### 018 · `projects-with-sessions-fetch.service.ts` 第 1 块（L17）· A · **并集**

**冲突块**：`SessionSummary` 类型字段。

- 本地：`contentUpdatedAt`、`isUnread`、`isPinned`、`parentSessionId`（未读水位 / 置顶 / 父子归档）。
- 上游：`forkedFromSessionId`、`forkAncestors`（fork 树）。

**上下文**：文件头 L8 的 `import type { ..., SessionForkAncestor }` 已自动合入上游，若这里丢掉上游字段，该 import 会变成未使用并触发 lint；反之若丢本地字段，sidebar 的未读/置顶/父子会全部退化为 undefined。这两个字段组描述的是**不同维度**，不互斥。

**建议**：**并集**全部保留。若 D18 决定不渲染 `forkAncestors`，字段仍建议留在服务端（不传前端即可），避免每轮同步重复冲突。

### 019 · `projects-with-sessions-fetch.service.ts` 第 2 块（L55）· A · **并集**

**冲突块**：`SessionRepositoryRow`（数据库行）字段。

- 本地：`content_updated_at`、`isPinned`、`parent_session_id`、`is_ephemeral`（btw 副本标记）。
- 上游：`forked_from_session_id`。

**上下文**：这是 L11 `SessionSummary` 的**数据来源**；本地字段后面用于组装 `contentUpdatedAt/isUnread/isPinned/parentSessionId`，`is_ephemeral` 用于过滤侧问副本。上游字段用于组装 `forkedFromSessionId/forkAncestors`。两侧字段在 `sessions` 表里都真实存在（本地迁移有 `parent_session_id`、上游有 `forked_from_session_id`）。

**建议**：**并集**五个字段全保留。合并后核对本文件下方 `SELECT` 列表是否也把 `forked_from_session_id` 查出来了（若上游的查询列被自动合并进来，字段缺失只会在运行时表现为 undefined）。

### 020 · `projects-with-sessions-fetch.service.ts` 第 3 块（L189）· B · **并集**

**冲突块**：`mapSessionRowToSummary` 的返回字段。

- 本地：`contentUpdatedAt`（L182 已算好）、`isUnread: isSessionContentUnread(...)`、`isPinned`、`parentSessionId`。
- 上游：`forkedFromSessionId`、`forkAncestors`（有 fork 来源时再查 `sessionsDb.getForkAncestors`）。

**上下文**：这是项目列表/分页共用的映射函数，`readProjectSessionsIncludingArchived`（L201）和 `readProjectSessionsPageByPath`（L218）都走它。本地在 L182 已经预先算好 `contentUpdatedAt`，与上游的字段没有冲突。

**建议**：**并集**六行全保留。性能提醒：上游的 `getForkAncestors` 是**每行一次查询**（N+1），本地项目列表本来就做了分页，建议合并后按 D18 决定——若暂不渲染 fork 树，可直接返回 `[]`，避免为不用的数据付 N+1。

### 021 · `server/modules/providers/index.ts` 第 1 块（L8）· A · **并集**

**冲突块**：两个 service 的 re-export。

- 本地：`mcpCatalogService`（MCP 用户级目录 SSOT，MCP matrix 路由读写）。
- 上游：`providerCapabilitiesService`（provider 能力表，本轮 `/clear`、side question、steer 的能力判定都读它）。

**上下文**：紧随其后的 L15 已自动合入 `providerRuntimeService`。上游新增的 `sessions.service.ts` 里 `providerCapabilitiesService.getProviderCapabilities(provider)?.supportsContextClearing` 直接依赖这个导出（见 `sessions.service.ts` 第 3 块的 upstream 侧）。

**建议**：**并集**两条 export 都保留。删上游会让 `sessions.service.ts` 的 `supportsContextClearing` 判定无法 import；删本地会让 MCP 矩阵路由失效。

### 022 · `providers/index.ts` 第 2 块（L31）· C（依赖 D17）· **取本地**

**冲突块**：文件尾部导出区。

- 本地：`closeEphemeralCleanup/initializeEphemeralCleanup`（btw 副本回收）、`providerSettingsSourceService`（`claude --settings` 等价物）、`getWorkbuddyCommand`/`getPiCommand`/`getZcodeCommand`/`getOpenclawCommand`（4 家 CLI 绝对路径）。
- 上游：`createSideQuestionsService`、`MAX_CONCURRENT_SIDE_QUESTIONS_PER_SESSION`、`MAX_SIDE_QUESTIONS_PER_SESSION`、`sideQuestionsService`。

**上下文**：本地这 6 个导出都有明确消费方：`server/index.ts` 的启动/清理、`websocket/shell` 的 CLI 启动。上游这 4 个导出只服务 side-question 路由与 `chat.side_question` 处理器。**若 D17 选甲（保本地 btw）**，上游这组导出无人引用，保留会变成死代码并触发 lint。

**建议**：**取本地**。若 D17 改选乙/丙（接入上游侧问），则改为**并集**，并同时接入 `sideQuestionsService` 的消费方；注意本地 `ephemeral-cleanup` 与上游 side-question store 是两套不同的临时资源管理，不要互相替换。

### 023 · `claude-runtime.provider.ts` 第 1 块（L46）· A · **并集**

**冲突块**：`@/shared/utils.js` 与 `@/shared/tool-approval.js` 的 import。

- 本地：`createCompleteMessage, createDeltaBatcher, createNormalizedMessage, omitStreamedAssistantBlocks` + `createToolApprovalRegistry, MCP_ELICITATION_TOOL_NAME, toElicitationAnswer`。
- 上游：`createCompleteMessage, createNormalizedMessage, errorMessage`。

**上下文**：
- 本地三个本地 helper 是 fork 流式体系的核心：`createDeltaBatcher`（批量 delta）、`omitStreamedAssistantBlocks`（历史去重）、`tool-approval`（统一审批抽象，含 Codex 工具审批）。
- 上游的 `errorMessage` 供其新增的错误分支使用（`steer` 拒绝、side question 失败等），合并后上游那些分支若保留就会引用它。
- ⚠️ **L33 的 `import { askClaudeSideQuestion } from '.../claude-side-question.provider.js'` 是自动合并进来的**，该文件本地不存在、由本次合并新增。若 D17 选甲（保 btw），这个 import 会悬空，需要连同新文件一起处理（删除 import，或保留文件但接入）。

**建议**：**并集**保留两侧 utils 与 tool-approval 的 import。合并完成后按 D17 处理 L33 的 side-question import：选甲则删 import 与 `claude-side-question.provider.ts`（或保留但不引用并加注释），否则接入 `askClaudeSideQuestion`。

### 024 · `claude-runtime.provider.ts` 第 2 块（L64）· C（依赖 D17）· **取本地**

**冲突块**：`@/shared/types.js` 的 type import 列表。

- 本地：`ToolApprovalDecision`（`tool-approval.js` 统一审批的决策类型）。
- 上游：`SideQuestionRequest, SideQuestionSink, SideQuestionOutcome`（原生侧问的三件套）。

**上下文**：这三个上游类型只被 `askClaudeSideQuestion`、`runtime.askSideQuestion` 与上游侧问分支使用。D17 若选甲（保本地 btw，走 `btw.service.ts` + 独立 CLI 会话），这三个类型在 `claude-runtime.provider.ts` 里没有消费方。

**建议**：**取本地**（保留 `ToolApprovalDecision`）。若 D17 选乙/丙，则改为**并集**并把三个类型接到 `askSideQuestion` 实现上。不要为了「看起来完整」保留未使用的 type import——oxlint 会报。

### 025 · `claude-runtime.provider.ts` 第 3 块（L110）· B · **手工融合（保留 StreamStats + Steer 两类型，丢弃上游两个审批类型别名）**

**冲突块**：顶层类型定义。

- 本地：`StreamStats`（`CLAUDE_STREAM_DEBUG=1` 的每轮计数：sdkTypes/kinds/deltas/frames/maxGap…）。
- 上游：`SteerRequest`、`SteerInput`、`ToolApprovalDecision = AnyRecord | null`、`ToolApprovalResolver`。

**上下文（本块的三个硬事实）**：
1. 冲突块外 L107 的 `steerInput: SteerInput | null;` 已被自动合入 → `SteerInput`/`SteerRequest` **必须保留**，否则 `tsc` 直接报未定义。
2. 上游的 `type ToolApprovalDecision = AnyRecord | null` 与 L65 **从 `@/shared/types.js` import 的同名类型重复**，且 `server/shared/types.ts:2170` 的定义一字不差（同为 `AnyRecord | null`）→ 保留上游本地别名会触发 `TS2440: Import declaration conflicts with local declaration`。
3. `ToolApprovalResolver` 在合并后的文件中**只有定义、没有使用**（上游的 `pendingToolApprovals`/`waitForToolApproval` 区域已被本地的 `createToolApprovalRegistry` 取代，没有自动合入）→ 保留会变成未使用类型。

**建议**：**手工融合**——保留本地 `StreamStats`；保留上游 `SteerRequest` + `SteerInput`；**删除**上游的 `ToolApprovalDecision` 与 `ToolApprovalResolver` 两个别名，审批决策统一走共享类型 + `shared/tool-approval.ts`。若 D20 选乙（不接 steering），则 `SteerRequest/SteerInput` 连同 L107 一起删。

### 026 · `claude-runtime.provider.ts` 第 4 块（L197）· A · **取本地（不要重复定义常量）**

**冲突块**：`MCP_ELICITATION_TOOL_NAME` 常量。

- 本地：无（L53 已从 `@/shared/tool-approval.js` import 同名常量）。
- 上游：本地定义 `const MCP_ELICITATION_TOOL_NAME = 'McpElicitation';`。

**上下文**：`server/shared/tool-approval.ts:28` 的定义值**完全相同**（`'McpElicitation'`）。合并后 L53 的 import 与 L203 的本地 const 会构成 `TS2440`（import 与本地声明冲突）。L1580/L1582/L1600 三处使用该常量，走 import 即可。

**建议**：**取本地**——删除上游的本地定义，统一用 `shared/tool-approval.ts` 的导出。这样 Codex 工具审批与 Claude elicitation 共用同一个名字常量。

### 027 · `claude-runtime.provider.ts` 第 5 块（L212）· A · **取本地**

**冲突块**：`toElicitationResult` 的函数体。

- 本地：`return toElicitationAnswer(decision, mode);`（一行委托）。
- 上游：内联 30 行——`cancel` → `decline` → `url` 直接 accept → 逐字段过滤 `updatedInput.content`（只保留 primitive 与 string[]）。

**上下文**：逐行比对 `server/shared/tool-approval.ts:178` 的 `toElicitationAnswer`，分支顺序、`url` 处理、字段过滤规则与上游内联版**完全一致**，连 `AnyRecord` 断言都相同。区别只是本地把它抽成共享函数，供 Codex 审批复用。

**建议**：**取本地**一行委托，删除上游内联实现。不要两边都留（重复逻辑，且后续 SDK 类型变化要改两处）。

### 028 · `claude-runtime.provider.ts` 第 6 块（L1475）· B · **并集（两段都要）**

**冲突块**：构造 `sdkOptions` 之后、`query` 之前的准备逻辑。

- 本地：**settings 文件合并**——`settingsFile` 是路径时先 `fs.access`，不可读就删掉 `sdkOptions.settings`；若是 ultracode 的内联对象，则把文件内容 `JSON.parse` 后 `{...parsed, ...sdkOptions.settings}` 合到内联对象之下。配套 `providerSettingsSourceService`（`claude --settings` 等价物）。
- 上游：`sdkOptions.extraArgs = { ...(sdkOptions.extraArgs || {}), 'replay-user-messages': null };`——让 CLI 回显从 stdin 读到的消息，供 steering 判断「Claude 何时/是否真的读到了」。

**上下文**：两段互不依赖。上游这行是 steering 的**必要条件**：没有它，`message.isReplay` 的 echo 永远不会出现，`pendingSteerIds` 永远清不掉，`steerFollowUpTimer` 会空等 30s（见第 11 块）。本地那段是 fork 的配置体系，与 steering 无关。

**建议**：**并集**——保留本地 settings 块，并在其后（或之前，二者无顺序耦合）加上游的 `extraArgs` 合并行。注意用展开合并的写法，不要直接赋值覆盖可能已有的 `extraArgs`。若 D20 决定不接 steering，这行可去掉，但要同时去掉所有 `message.isReplay` 分支，避免半套逻辑。

### 029 · `claude-runtime.provider.ts` 第 7 块（L1554）· A · **取上游（仅注释）**

**冲突块**：`onElicitation` 回调上方的注释。

- 本地：unattended = 「agent API、commit-message 生成」。
- 上游：unattended = 「commit-message 生成，以及**没有传 `unattended: false` 的 agent-API 运行**」。

**上下文**：紧随其后的 `if (!options.unattended)` 逻辑没变，变的是语义来源——与第 10 块（agent.routes 透传 `unattended`）是同一件事。本地注释在合并后会**说错**：agent API 现在可以显式要求 attended。

**建议**：**取上游**注释，与第 10 块保持一致。纯文档改动，无行为风险。

### 030 · `claude-runtime.provider.ts` 第 8 块（L1579）· B · **取本地**

**冲突块**：elicitation 的 `permission_request` 帧由谁发出。

- 本地：`deltaBatcher.send(...)`
- 上游：`ws.send(...)`

**上下文**：`deltaBatcher` 在 L1330 创建，内部就是 `ws.send`，并额外做三件事：① 发送非 delta 帧前先 `flush()` 待发的文本 delta（**保证审批卡片不会插到已流式输出之后**）；② terminal 后丢弃迟到的 delta；③ 统计 `framesSent`。也就是说 `deltaBatcher.send` 是 `ws.send` 的超集，**行为不丢帧、只改善顺序**。同文件 L296 的 `const waitForToolApproval = claudeApprovals.wait;` 也来自本地 `createToolApprovalRegistry`，说明这条审批链路本地已完整实现。

**建议**：**取本地** `deltaBatcher.send`。这是三条同构冲突（030/031/032）的同一原则：所有出站帧统一走 batcher。

### 031 · `claude-runtime.provider.ts` 第 9 块（L1605）· B · **取本地**

**冲突块**：`onCancel` 回调里发 `permission_cancelled`。

- 本地：`deltaBatcher.send(...)`
- 上游：`ws.send(...)`

**上下文**：与 030 同构。`onCancel` 由 `claudeApprovals.wait` 在 abort/超时时调用，此时很可能还有尚未 flush 的文本 delta；先 flush 再发 cancelled，客户端才不会出现「取消提示先到、半截文本后到」的乱序。

**建议**：**取本地** `deltaBatcher.send`。

### 032 · `claude-runtime.provider.ts` 第 10 块（L1614）· B · **取本地**

**冲突块**：审批已答复后发 `permission_resolved`。

- 本地：`deltaBatcher.send(...)`
- 上游：`ws.send(...)`

**上下文**：与 030/031 同构，且这段紧接 `await waitForToolApproval` 返回——用户可能在流式输出中途作答，此时 pending delta 仍可能有未发的文本，必须先 flush 再撤回审批卡片。

**建议**：**取本地** `deltaBatcher.send`。三块一起改，合并时不要只改一两处，否则同一批事件两种发送路径，顺序保证会失效。

### 033 · `claude-runtime.provider.ts` 第 11 块（L1855）· **C · 手工融合（两套事件逻辑叠加）**

**冲突块**：`for await (const rawMessage of queryInstance)` 循环体头部的四段逻辑。

- 本地：
  1. **delta gate 重开**：`heldForBackgroundWork && message.type === 'stream_event' && event.type === 'message_start'` → `terminalSent = false`（后台保持期间收到后续 turn 时，允许 delta 继续流）。
  2. **流式统计**：`streamStats` 累加 sdkTypes / text·thinking delta / maxGap。
- 上游：
  1. **steer follow-up timer 清除**：`system` + `subtype === 'init'` → `clearTimeout(steerFollowUpTimer)`。
  2. **steer echo 处理**：`user` + `isReplay === true` → 清理 `pendingSteerIds`，若是被 steer 的消息则先 `context.normalizeMessage` 再 `ws.send`，最后 **`continue`**（跳过后续所有处理）。

**上下文**：
- 这四段解决的是**四个互不重叠的问题**：后台保持的 delta gate（本地）、可观测性（本地）、steering 的等待与回显（上游）。不能互相替代。
- 上游第 2 段末尾的 `continue` 会跳过循环剩余部分，因此它必须**放在本地两段之后**，否则 `message_start` 重开 gate 与统计都会漏掉这条消息（虽然 user 回显不进 streamStats，但顺序上更安全）。
- ⚠️ 上游用 `ws.send(steered)` 直发，绕过了 `deltaBatcher`；本地全链路约定「出站帧统一走 batcher」（见 030–032 与 L1326 注释）。steer 回显发生在流式中途，前面很可能有未 flush 的文本 delta。

**建议**：**手工融合**，顺序为：本地 `terminalSent` 重开 → 本地 `streamStats` → 上游 steer timer 清除 → 上游 isReplay 回显；并把回显的 `ws.send(steered)` 改为 **`deltaBatcher.send(steered)`**，与本文件其余出站帧保持一致。合并后必跑 `claude-steer.test.ts` + `claude-runtime-hold.test.ts`，两者分别锁住上游/本地这两条时序。

### 034 · `claude-runtime.provider.ts` 第 12 块（L2013）· **C · 手工融合（本轮最高风险）**

**冲突块**：`message.type === 'result'` 分支。

- 本地（内联 60 行）：streamStats flush + 调试日志 → `abortPending/stillOutstanding` → 发 `complete`（经 `deltaBatcher.send`）+ `notifyRunStopped` → 后台完成通知 → **`terminalSent = true`** → `holdForTurn` 判定 → hold 则 `scheduleRelease()`，否则 `releasePromptStream()`。
- 上游（4 行）：`abortPending` → 若 `pendingSteerIds.size > 0 && !abortPending` 则 `awaitSteerFollowUp()`，否则 `settleTurnResult()`。

**上下文（关键）**：上游把上面那整段逻辑**抽成了 `settleTurnResult()`**（合并文件 L1756–L1811，已被自动合入）。逐行对照，它与本地的内联版**有四处不同**：
1. `complete` 用 `ws.send(...)`，本地是 `deltaBatcher.send(...)`（非 delta 帧会先 flush，见 L1326 注释；用 `ws.send` 会让最后一批 delta 排在 complete 之后）；
2. **没有 `terminalSent = true`**（本地 delta gate 的关门信号，D11 的核心；漏掉会让后续 delta 穿过 complete 复活已完成的行）；
3. 释放用 `maybeReleasePromptStream()`，本地是直接 `releasePromptStream()`（上游多一层「原生侧问在飞时延后释放」的包装，对本地是无害超集）；
4. 没有 streamStats 的 flush/日志。

同时，合并文件里本地内联版**仍然存在**（就是本冲突块 HEAD 侧），若不处理会出现「同一 result 事件结算两次」：先按本地逻辑发 complete / 置 terminalSent，再走上游分支又 `settleTurnResult()` 一次（`turnCompleteSent` 挡住重复 complete，但 hold/release 会执行两次，且 `backgroundWorkPending` 被提前清零）。

**建议**：**手工融合，删掉本地内联版，改为调用上游抽取的 `settleTurnResult()`**，并把本地四处语义折进该函数：
1. `settleTurnResult` 内 `complete` 改 `deltaBatcher.send(...)`；
2. **`terminalSent = true` 不能写在 `if (!turnCompleteSent && !abortPending)` 分支里**。用户主动中止时不会发 `complete`，但同样必须关掉 delta gate，否则后续 delta 会穿过门把已完成的行复活。位置应照本地内联版：在 `if / else if`（complete / error 发送）**之后、`holdForTurn` 判定之前无条件置位**。`deltaBatcher` 的包装在发出 `complete`/`error` 帧时其实**已经同步置过一次** `terminalSent = true`（见合并文件 L1330–1337），但那只是 complete 路径上的冗余，**不能替代 abort 路径**——两处都留是安全的；
3. 保留上游的 `maybeReleasePromptStream()`；
4. 本地的 streamStats flush/日志放在 `result` 分支调用 `settleTurnResult()` **之前**（顺序：flush → 统计日志 → 判定 steer → settle）。
最终分支形如：
```ts
if (message.type === 'result') {
  if (streamStats) { deltaBatcher.flush(); /* log */ }
  const abortPending = sessionKey() ? abortedSessionIds.has(sessionKey()) : false;
  if (pendingSteerIds.size > 0 && !abortPending) awaitSteerFollowUp();
  else settleTurnResult();
}
```
**验收**：必须跑 `claude-runtime-hold.test.ts`（上游）+ `claude-steer.test.ts`（上游）+ 本地流式缓冲相关测试；并人工确认「complete 之后不再有 delta」与「后台任务保持期间 follow-up turn 的 delta 能重新流」。

### 035 · `claude-session-synchronizer.provider.ts` 第 1 块（L228）· B · **并集**

**冲突块**：`processSessionFile` 里「已 superseded 则跳过索引」的分支。

- 本地：先算 `const contentUpdatedAt = await this.extractContentUpdatedAt(...)`（注释说明所有 return 路径都要带它），再判断 `isProviderSessionSuperseded`，命中就 `return null`。
- 上游：同一判断里多了 `sessionsDb.recordSupersededTranscriptPath(parsed.sessionId, this.provider, filePath)`，注释解释「清空上下文时文件可能还没被索引，历史读取需要这个路径」。

**上下文**：合并后 `superseded_provider_sessions` 有 `reason` 列，**两种来源**都会进来：编辑重来（`edit`）与 `/clear`（`context_cleared`）。本地注释只提「edited off」，上游只提「context cleared」，合并后都不完整。本地下方的三个 return 路径（L264 preserved-name、标题解析尾部等）确实都带 `contentUpdatedAt`，不能删。

**建议**：**并集**——保留 `contentUpdatedAt` 计算；在 `if (isProviderSessionSuperseded)` 内补上 `recordSupersededTranscriptPath`；注释合并成「被编辑放弃或被清空上下文的 transcript」。注意 `recordSupersededTranscriptPath` 依赖 015 的保留，且只对有 `jsonl_path IS NULL` 的行生效。

### 036 · `codex-app-server.client.ts` 第 1 块（L7）· C（依赖 D17）· **并集**

**冲突块**：文件头 import。

- 本地：`ProviderQuota/ProviderQuotaWindow`、`CodexConfigOverrides`/`toCodexConfigArgs`、`AppError, readObjectRecord, readOptionalString`。
- 上游：`AppError, SIDE_CONVERSATION_BOUNDARY_PROMPT, SIDE_CONVERSATION_DEVELOPER_INSTRUCTIONS, SIDE_QUESTION_ANSWER_SEPARATOR`。

**上下文**：本地这组 import 服务 Codex 的配额展示与配置覆盖（fork 独有）；上游这组是侧问（side question）在 app-server 里跑一个隔离 turn 的提示词常量。上游在本文件新增了约 470 行侧问协议（`thread/fork` + 侧问 turn 超时），**这些新增代码是自动合入的**（见第 2 块的 `SIDE_QUESTION_TURN_TIMEOUT_MS`），所以如果只保留本地 import，上游那些区域会立刻缺常量。

**建议**：**并集**两侧 import 全保留。若 D17 最终选甲（保 btw）并决定彻底移除上游侧问，则需要**成片删除**本文件里上游的侧问方法（`askSideQuestion` 及其辅助），再一并删这组 import——不能只删 import。

### 037 · `codex-app-server.client.ts` 第 2 块（L40）· A · **并集**

**冲突块**：两个超时常量。

- 本地：`SHUTDOWN_GRACE_MS = 2_000`（SIGTERM 后强制 kill 的宽限）。
- 上游：`SIDE_QUESTION_TURN_TIMEOUT_MS = 5 * 60_000`（侧问 turn 的兜底上限）。

**上下文**：名字、单位、用途完全不同，且各自有消费方：本地常量被 `stop()`/进程退出路径使用；上游常量被侧问 turn 的 `turn/completed` 等待使用。`REQUEST_TIMEOUT_MS` 在两者上方（L38）未冲突。

**建议**：**并集**两个常量都保留（D17 选甲则可去掉侧问那个，同时删侧问方法）。

### 038 · `codex-app-server.client.ts` 第 3 块（L85）· A · **取本地**

**冲突块**：`CodexThreadFork` 之后的一整组本地类型与函数（upstream 侧为空）。

- 本地：`CodexRateLimitWindow`、`CodexAccountRateLimits`（配额面板用，结构化声明避免跟 CLI 包类型漂移）、`resolveCodexLauncher()`（解析 `node_modules` 内的 `codex.js`，缺包时抛 `CODEX_APP_SERVER_UNAVAILABLE`）、`APP_SERVER_FEATURE_FLAGS`（`--disable apps --disable plugins`，规避第三方 baseURL 上的重试开销）、`resolveCodexAppServerCommand()`。

**上下文**：逐项 grep 上游版本，**这些符号在上游一个都不存在**（`resolveCodexLauncher`、`APP_SERVER_FEATURE_FLAGS`、`CodexAccountRateLimits`、`resolveCodexAppServerCommand` 命中数均为 0）。合并后它们仍是唯一实现，且被 L183、L657、L767 引用（spawn、fork、配额读取）。

**建议**：**取本地**整段保留，upstream 侧为空无需补。

### 039 · `codex-app-server.client.ts` 第 4 块（L182）· **C · 手工融合（并触发一处合并后必然的运行时错误）**

**冲突块**：`withAppServer` 内部如何启动子进程。

- 本地：`const spawnSpec = resolveCodexAppServerCommand(); spawn(spawnSpec.command, spawnSpec.args, ...)`——支持 `CODEX_APP_SERVER_COMMAND` 覆盖、`--disable apps --disable plugins` 特性开关、node_modules 内 launcher。
- 上游：`const launcher = codexAppServer.resolveLauncher(); spawn(process.execPath, [launcher, 'app-server'], ...)`——走导出对象上的 `resolveLauncher`，便于测试替换。

**上下文（两个关键发现）**：
1. 合并文件里 `codexAppServer` 对象**同时**有上游新增的 `resolveLauncher()`（L692）与本地原有的 `forkThread`/`readQuota`；上游的侧问测试正是通过替换 `codexAppServer.resolveLauncher` 来注入 fake app-server。如果直接用本地 `resolveCodexAppServerCommand()`，上游测试的替换点失效。
2. **`withAppServer` 的回调签名被上游改了**：从 `(call) => ...` 改成 `({ call, onNotification, onExit }) => ...`（L166–L179）。上游的 `forkThread` 已跟着改（L724 `async ({ call })`），但本地的 **`readQuota`（L765）仍然是 `async (call) =>`**——自动合并后它会拿到对象却当函数用，运行时必报 `call is not a function`，而 **tsc 不一定拦得住**（取决于参数类型推断）。

**建议**：**手工融合**——
1. `withAppServer` 内保留本地的 `resolveCodexAppServerCommand()`，但把其中的 launcher 来源改为 `codexAppServer.resolveLauncher()`（保留 `CODEX_APP_SERVER_COMMAND` 覆盖与 `APP_SERVER_FEATURE_FLAGS`，同时保住上游测试的替换点）：
```ts
return { command: process.execPath, args: [codexAppServer.resolveLauncher(), 'app-server', ...tail] };
```
2. 全文件搜查 `withAppServer(` 的调用点，把本地遗留的 `(call)` 改为 `({ call })`——至少 L765 的 `readQuota`，以及任何本地新增的调用（`grep -n "withAppServer("` 应为 3 处，合并后必须全部是新签名）。
3. 合并后跑 Codex 相关测试（`codex-models.test.ts`、上游 `codex-side-question.test.ts`），并手工打开一次 Codex 配额面板（`readQuota` 路径）。

### 040 · `codex-app-server.client.ts` 第 5 块（L757）· B（依赖 D17）· **并集**

**冲突块**：`codexAppServer` 对象内的下一个方法。

- 本地：`readQuota()`——调 `account/rateLimits/read`，把 primary/secondary 转成 `ProviderQuotaWindow`，额度面板用；注释明确「读它不消耗配额」。
- 上游：`askSideQuestion(...)`——在 `thread/fork` 出来的只读分支上跑一个隔离 turn 并拼接答案（配套文件头的 `SIDE_CONVERSATION_*` 常量与 `SIDE_QUESTION_TURN_TIMEOUT_MS`）。

**上下文**：两者都是对象方法，不互斥。但本地 `readQuota` 的 `withAppServer(async (call) =>` **必须改成新签名**（见 039 的发现），否则合并后直接抛错。

**建议**：**并集**——保留 `readQuota`（并修签名 `async ({ call }) =>`），追加上游 `askSideQuestion`。若 D17 选甲，可删 `askSideQuestion` 及其常量，但 `readQuota` 必须保留（配额面板是 fork 独有功能）。

### 041 · `codex-models.provider.ts` 第 1 块（L189）· A · **取上游**

**冲突块**：`gpt-5.5` 条目的 `description` 字段。

- 本地：无该字段。
- 上游：`description: 'Frontier model for complex coding, research, and real-world work.'`

**上下文**：模型目录其余条目（如 gpt-5.6-luna）本地已有 `effort` 但同样没有 description；上游本轮为 GPT 6.1 系列统一补了描述。这是展示层文案，不影响 `DEFAULT: 'gpt-5.6-sol'` 或模型解析。

**建议**：**取上游**补上 description。合并后核对该文件其余上游新增模型（`codex-models.test.ts` 第 1/2 块有对应断言）是否也带描述，保持同一目录内文案一致。

### 042 · `codex-runtime.provider.ts` 第 1 块（L26）· B（依赖 D17）· **并集**

**冲突块**：import 区。

- 本地：`resolveCodexConfigOverrides`（配置覆盖）、`createToolApprovalRegistry / MCP_ELICITATION_TOOL_NAME / toElicitationAnswer`（统一审批，Codex 工具确认走这里）、完整的 notifications 四件套、`createDeltaBatcher / readObjectRecord / readOptionalString`、以及 `CodexAppServerConnection / isCodexNotificationForActiveTurn / startCodexAppServerConnection`。
- 上游：精简版 notifications（只有 failed/stopped）、侧问类型 `SideQuestionOutcome/Request/Sink`、`codexAppServer`。

**上下文**：本地这组是 Codex 运行时的主干（批处理、审批、连接管理、配额）；上游只多出侧问三类型与 `codexAppServer` 对象（`askSideQuestion` 用）。合并后上游侧问方法所在区域会引用 `SideQuestion*` 与 `codexAppServer`，两侧都要在。

**建议**：**并集**——保留本地全部 import，追加 `SideQuestion*` 三类型与 `codexAppServer`。若 D17 选甲，删侧问三类型与 `codexAppServer`（后者若还被别处使用则保留）。

### 043 · `codex-runtime.provider.ts` 第 2 块（L683）· **C · 手工融合（两套失败状态必须统一）**

**冲突块**：run 作用域内的失败/中止状态声明。

- 本地：`let terminalMessage: string | null = null;` + `const failureText = () => terminalMessage ?? 'Codex turn failed';` + 一段「错误已从流里报过就丢弃 stderr 包装」的注释。
- 上游：`const notifyCodexRunAborted = () => notifyRunStopped({..., stopReason: 'aborted' })` + `let terminalFailure: { message: string } | null = null;` + 同类注释。

**上下文（实测合并后的引用分布）**：
- `terminalMessage`：赋值于 L879（流内 error 事件），读取于 L1027/L1127/L1137，`failureText()` 在 L1046/L1058 用作错误内容。
- `terminalFailure`：**只有声明（L703）与两处读取（L1101、L1147），全文件没有任何赋值**——因为给 `terminalFailure` 赋值的上游代码区域在自动合并时被本地的 `terminalMessage = ...` 取代了。结果是它恒为 `null`，两处 `!terminalFailure` 判断**永远为真**：失败已经报过 `notifyRunFailed` 之后，终止路径还会再发一次 `notifyRunStopped(aborted)`，产生重复通知；而 L1137 的本地守卫本来用 `!terminalMessage` 是可以挡住的。
- `notifyCodexRunAborted` 本身不依赖任何状态，可安全保留。

**建议**：**统一到本地的 `terminalMessage`**——保留 `terminalMessage`/`failureText` 与 `notifyCodexRunAborted`，**删除 `terminalFailure` 声明**，把 L1101、L1147 的 `!terminalFailure` 改为 `!terminalMessage`。这样既保留上游抽出的通知函数，又消除「恒真守卫 + 重复通知」。

### 044 · `codex-runtime.provider.ts` 第 3 块（L1136）· **B · 手工融合（取上游条件 + 本地守卫）**

**冲突块**：`catch` 中「确实是用户中止」的分支。

- 本地：`else if (!terminalMessage) { notifyRunStopped({..., stopReason: 'aborted' }) }`——条件只看 `!terminalMessage`，而外层 `wasAborted` 的判定包含 `runError.message.toLowerCase().includes('aborted')`。
- 上游：`else if (!terminalFailure && (session?.status === 'aborted' || abortController.signal.aborted)) { notifyCodexRunAborted(); }`——额外要求「会话状态是 aborted 或 abortController 已置位」，避免把**仅仅是消息里含 "aborted" 字样的真实错误**误判为用户中止。

**上下文**：上游的条件是对本地 `wasAborted` 过宽的收窄，属于正确性改进；但它的 `!terminalFailure` 因 043 的问题恒真，守卫失效。

**建议**：**手工融合**——保留上游的收窄条件 `(session?.status === 'aborted' || abortController.signal.aborted)` 与 `notifyCodexRunAborted()` 调用，把守卫改为 `!terminalMessage`。改完与 043 一起核对：正常结束路径（L1101）与异常路径（L1147）都只发一次停止/失败通知。

### 045 · `codex-runtime.provider.ts` 第 4 块（L1212）· **C · 手工融合（必须合并成一个导出对象）**

**冲突块**：`codexRuntime` 导出对象，以及上游新增的 `askCodexSideQuestion` 函数。

- 本地：`export const codexRuntime = { run, abort, permissions: { resolve, listPending } }`。
- 上游：先新增 `async function askCodexSideQuestion(request, sink, _context)`（调 `codexAppServer.askSideQuestion`，永不抛错，失败返回 `{status:'error'}`），再**另起一个** `export const codexRuntime = { run, abort, askSideQuestion }`。

**上下文**：合并后的文件里 **`export const codexRuntime` 出现了两次**（L1214 与 L1259），属于重复声明，`tsc` 直接报错。同时本地有 `permissions`（Codex 工具审批的 `resolve/listPending`），上游有 `askSideQuestion`，两者都不能丢；上游对象还丢了 `permissions`。上游那行注释「SDK turns」也是旧的（本地已改为 app-server turns）。

**建议**：**手工融合为一个对象**：
```ts
export const codexRuntime = {
  run: queryCodex,
  abort: abortCodexSession,
  permissions: { resolve: codexApprovals.resolve, listPending: codexApprovals.listPending },
  ...(保留侧问时) askSideQuestion: askCodexSideQuestion,
};
```
保留本地注释（app-server turns）。若 D17 选甲，删掉 `askCodexSideQuestion` 函数和 `askSideQuestion` 属性，只留一个对象。

### 046 · `opencode-auth.provider.ts` 第 1 块（L31）· B · **并集（并补回丢失的 `os` 导入）**

**冲突块**：常量 `OPENCODE_CONFIG_FILES` vs 函数 `isCredentialPresent`。

- 本地：`const OPENCODE_CONFIG_FILES = ['config.json', 'opencode.json', 'opencode.jsonc']`，被 L178 的 `hasConfiguredProvider()` 使用（检查 `provider.<id>.options` 是否有 baseURL/apiKey）。
- 上游：`isCredentialPresent(credential)`，按 `literal/env/file` 判凭据存在，被 L149 的凭据轮询使用（上游新增的 `opencode-config.ts` 提供 `listConfiguredProviders`/`readOpenCodeConfigs`）。

**上下文**：合并后两者**都在被引用**（L149 用于 `getStatus` 的凭据判断，L178 用于 `hasConfiguredProvider`），所以不能二选一。**但有一个自动合并引入的隐患**：本地文件头原本有 `import os from 'node:os';`，上游版本没有，合并后该 import 被丢弃，而 L176 的 `path.join(os.homedir(), '.config', 'opencode')` 仍在——`os is not defined`。

**建议**：**并集**——两个常量/函数都保留，并**补回 `import os from 'node:os';`**。另外记录一个语义漂移：本地 `hasConfiguredProvider` 只读 v1 的 `provider` 块且不解析 JSONC，而上游 `opencode-config.ts` 已支持 v1/v2 与 JSONC；后续若用户只用 v2 `providers` 配置，本地这条判断会误报「未配置」。建议合并后改用 `listConfiguredProviders(await readOpenCodeConfigs())` 实现 `hasConfiguredProvider`，与上游口径统一。

### 047 · `opencode-models.provider.ts` 第 1 块（L445）· A · **并集（注释合并）**

**冲突块**：`readOpenCodeConfigState` 的 JSDoc 中段。

- 本地：强调「只有 provider id 描述不了自带 `provider` 块的网关（WorkBuddy、自建端点），所以返回值有第二半 `configuredOptions`；`OPENCODE_CONFIG`/`OPENCODE_CONFIG_CONTENT` 也会读」。
- 上游：强调「v1 `provider` 与 v2 `providers` 都算，带不带 key 都算；但 v2 条目**自己不会启动过滤**；内联配置按 **JSONC** 解析」。

**上下文**：两段说的是不同事实，缺一不可：本地那句解释了为什么函数要返回 `configuredOptions`（后两个块的核心），上游那句解释了 v2 的特殊规则（第 4 块的实际逻辑）。注意两侧措辞已出现口径差异——本地写 "inline JSON"，上游写 "inline JSONC"，而实际解析能力取决于第 3 块用哪套实现。

**建议**：**并集**合并注释：保留本地「网关/self-hosted 需要 configuredOptions」段，接上游「v1/v2、JSONC、v2 不单独启动过滤」段。合并后注释必须与 049/050 的最终实现一致（尤其 JSONC）。

### 048 · `opencode-models.provider.ts` 第 2 块（L473）· B · **手工融合（留 map，去 configDir）**

**冲突块**：函数体开头的局部变量。

- 本地：`const configuredOptions = new Map<string, ProviderModelOption>();` 与 `const configDir = path.join(os.homedir(), '.config', 'opencode');`
- 上游：空。

**上下文（本文件的结构性事实）**：基点的函数叫 `readConnectedOpenCodeProviderIds(): Promise<Set<string> | null>`；**本地把它改名为 `readOpenCodeConfigState` 并把返回值扩成 `{connectedProviderIds, configuredOptions}`**；上游保留原名、只加 v2/JSONC 逻辑。合并文件 L468–L471 的签名是**本地的**（对象返回），而 L477 之后上游的 `listConfiguredProviders(...)` 代码被塞了进来——这是一次「两个不同函数被 git 对齐」的假冲突，不能简单两侧相加。

**建议**：**手工融合**——保留 `configuredOptions` map；**删掉 `configDir`**，因为 049 会改用上游的 `readOpenCodeConfigs()`（它自己处理 XDG / `OPENCODE_CONFIG_DIR` / JSONC），再自己拼 `~/.config/opencode` 会重复且与 XDG 语义冲突。

### 049 · `opencode-models.provider.ts` 第 3 块（L486）· **C · 手工融合（两套配置读取合为一套）**

**冲突块**：provider id / 自定义模型来源。

- 本地：手工拼 `OPENCODE_CONFIG_FILES` 三个全局文件 → 叠加 `OPENCODE_CONFIG`（路径）与 `OPENCODE_CONFIG_CONTENT`（**`JSON.parse`**）→ 遍历 `config.provider`，既 `providerIds.add` 又 `collectConfiguredOpenCodeModelOptions(...)` 收集 `configuredOptions`。
- 上游：`listConfiguredProviders(await readOpenCodeConfigs())`，只收 `section === 'provider'`（v1）的 id；**不再收集 configuredOptions**（上游没有网关模型目录的需求）。

**上下文**：
- 上游的 `readOpenCodeConfigs()`（`opencode-config.ts:90`）已经覆盖：三个全局文件、`OPENCODE_CONFIG_DIR`、`OPENCODE_CONFIG`、`OPENCODE_CONFIG_CONTENT`，并且用 `stripJsonComments + stripTrailingCommas` 解析 **JSONC**，还支持 `XDG_CONFIG_HOME`。本地的实现是它的子集（无 JSONC、无 XDG、无 CONFIG_DIR）。
- 但上游的 `listConfiguredProviders` 只返回 `{id, section, credential}`，**不带 models 原文**，而本地的 `collectConfiguredOpenCodeModelOptions` 需要 `provider.models` 才能生成 `configuredOptions`（WorkBuddy/自建网关的模型只存在于 config）。
- 幸运的是 `readOpenCodeConfigs()` 返回的是 `{config, sourceDir}[]` 原文，可以直接遍历。

**建议**：**手工融合**——用上游的读取器，保留本地的模型收集：
```ts
const sources = await readOpenCodeConfigs();
const configuredProviders = listConfiguredProviders(sources);
for (const { id, section } of configuredProviders) {
  if (section === 'provider') providerIds.add(id);
}
for (const { config } of sources) {
  for (const sectionKey of ['provider', 'providers'] as const) {
    for (const [providerId, rawProvider] of Object.entries(readObjectRecord(config[sectionKey]) ?? {})) {
      const provider = readObjectRecord(rawProvider);
      collectConfiguredOpenCodeModelOptions(
        providerId,
        readOptionalString(provider?.name) ?? providerId,
        provider?.models,
        configuredOptions,
      );
    }
  }
}
```
注意：① 本地原先只收集 `provider`（v1），这里补上 v2 的 `providers`，否则 v2 网关模型仍会缺；② `providerIds` 的 v1 过滤语义保持上游（v2 只在后面「已有过滤」时加入）；③ 删掉本地对 `OPENCODE_CONFIG_FILES`/`JSON.parse` 的手工读取，避免两套解析口径（JSONC vs JSON）。

### 050 · `opencode-models.provider.ts` 第 4 块（L532）· **B · 手工融合（本地返回形状 + 上游 v2 规则）**

**冲突块**：函数结尾的 return。

- 本地：`return { connectedProviderIds: providerIds.size > 0 ? providerIds : null, configuredOptions: [...configuredOptions.values()] };`
- 上游：`if (providerIds.size === 0) return null;` → 再把 v2 `providers` 的 id 加入 → `return providerIds;`

**上下文**：本地返回对象（`configuredOptions` 是调用方 L728 取用的第二半）；上游返回裸 `Set|null`。上游的两段语义必须保留：① **空集时必须返回 null**（否则调用方会拿空 filter 把整个目录裁没）；② **v2 条目只能加入已有过滤，不能自己启动过滤**（v2 的登录在它自己的数据库里，这里读不到，误判会把所有 v2 登录模型的 provider 全隐藏）。

**建议**：**手工融合**，保留本地对象形状并植入上游规则：
```ts
const options = [...configuredOptions.values()];
if (providerIds.size === 0) {
  return { connectedProviderIds: null, configuredOptions: options };
}
for (const { id, section } of configuredProviders) {
  if (section === 'providers') providerIds.add(id);
}
return { connectedProviderIds: providerIds, configuredOptions: options };
```
`configuredOptions` 无论 `connectedProviderIds` 是否为 null 都要返回（本地调用方用它补网关模型）。合并后跑 `opencode-models.test.ts`，重点看本地 WorkBuddy/网关断言与上游 v2 过滤断言是否同时通过。

### 051 · `opencode-session-synchronizer.provider.ts` 第 1 块（L204）· B · **手工融合（参数顺序按最终 SQL 排）**

**冲突块**：`params` 数组与两个上游过滤子句的构造。

- 本地：`[sinceMillis, sinceMillis, sinceMillis]`（可选加 `limit`）——对应下方 WHERE 的三个 `since` 占位符（含本地新增的 `content_time` 条件）。
- 上游：`forkIdsClause = this.registeredForkIdsClause()`、`pendingForkClause = this.pendingForkWindowClause()`、`agentFilterClause`（有 `agent` 列时排除侧问 agent），`params = [since, since, ...forkIds.ids, ...pending.params, ...(limit?[limit]:[])]`。

**上下文**：合并文件里上游的三个辅助方法都存在（`hasAgentColumn` L285、`registeredForkIdsClause` L291、`pendingForkWindowClause` L305，`SIDE_QUESTION_AGENT` L37），说明这些是自动合入的上游新增能力。本地的第三个 `since` 参数**不能删**，因为第 2 块保留了 `content_time` 条件。SQL 占位符顺序 = WHERE 文本顺序。

**建议**：**手工融合**——保留上游三个子句的构造，`params` 改为：
```ts
const params = [
  sinceMillis, sinceMillis, sinceMillis,      // 本地 content_time 条件的三处
  ...forkIdsClause.ids,
  ...pendingForkClause.params,
  ...(limit ? [limit] : []),
];
```
合并后务必用真实 `opencode.db` 跑一次同步（或跑 `opencode-history-pages.test.ts`），占位符数量与顺序错位在 better-sqlite3 里会直接抛 `RangeError`。

### 052 · `opencode-session-synchronizer.provider.ts` 第 2 块（L242）· B · **手工融合（保留本地时间条件与排序，插入上游三个过滤）**

**冲突块**：`WHERE` / `ORDER BY` 本体。

- 本地：
  ```sql
  AND (
    ? IS NULL
    OR COALESCE(s.time_updated, s.time_created, 0) >= ?
    OR COALESCE((SELECT MAX(m.time_created) FROM message m WHERE m.session_id = s.id), 0) >= ?
  )
  ORDER BY MAX(COALESCE(s.time_updated, s.time_created, 0), COALESCE(content_time, 0)) DESC, s.id DESC
  ```
- 上游：`AND (? IS NULL OR COALESCE(s.time_updated, s.time_created, 0) >= ?)` + `${agentFilterClause}` + `${forkIdsClause.sql}` + `${pendingForkClause.sql}`，`ORDER BY COALESCE(s.time_updated, s.time_created, 0) DESC`。

**上下文**：两者解决的是不同问题。本地的第三臂是"`time_updated` 不随消息追加而动"的修正（文件顶部 L88–102 的注释已说明），而 `synchronizeFile` 用 `LIMIT 1` 拿最新一条做侧边栏刷新，所以 `ORDER BY` 必须也按"会话时钟与最后消息时钟取大"来排，否则一个只追加了消息、`time_updated` 没变的活跃会话会排到后面，被别的会话抢走 `LIMIT 1`。上游那段 `ORDER BY COALESCE(...)` 是推出侧问功能前的写法。上游新增的三个子句（`agent` 列排除侧问 agent、已登记 fork id、pending fork 目录+时间窗）与本地时间条件互不冲突，且都作用在同一个 `session s` 别名上。

**建议**：**手工融合**——取本地完整的 `AND (...)` 三参数条件与 `ORDER BY MAX(...)`，在其后依次插入上游的 `${agentFilterClause}`、`${forkIdsClause.sql}`、`${pendingForkClause.sql}`；`limitClause` 保持在末尾。注意 `content_time` 只是 SELECT 别名，WHERE 里不能引用，本地用的子查询写法必须原样保留（`ORDER BY` 里可以引用别名，两种写法都对，保持本地即可）。

> 与 051 联动：若 D17 决定放弃上游 side questions（保留本地 `btw`），则 `agentFilterClause`、`forkIdsClause`、`pendingForkClause` 及 `opencode-side-question-forks` 整个模块都应一并去掉；若两套并存，则按上面融合。

### 053 · `opencode-sessions.provider.ts` 第 1 块（L946）· C · **取上游，并把本地的 `thinkingRun` 上移到页作用域**

**冲突块**：`normalizeHistoryRow` 开头的局部变量声明。

- 本地（`normalizeHistoryRows`，整文件一次性归一化）：`emittedMessageErrors`、`thinkingRun`、**`const runIsLive = isOpenCodeSessionActive(sessionId)`**。
- 上游（新的逐行 `normalizeHistoryRow`）：`timestamp`、`baseId`（用 `placement.start` 而非 `normalized.length`，跨页稳定）、`messageInfo`、`messageRole`。

**上下文**：合并文件的函数签名（L938–944）已被上游改成 `(row, placement, db, sessionId, runIsLive)`，`runIsLive` 是**参数**——本地那行 `const runIsLive = ...` 与参数同名，会直接 `TS2451 Cannot redeclare block-scoped variable`，**不能照抄**。`emittedMessageErrors` 也已由上游的 outline（`placement.showsMessageError`，见 L618–641 的去重逻辑）取代，属于被淘汰的旧写法。真正需要保留的本地新增只有 `thinkingRun`——OpenCode 把 reasoning 按 token 分片各存一行 part，本地把它累加成一个 thinking 消息，这是本地特意修的显示问题（`git show 13e9ef64:` 的旧版里没有 `thinkingRun`，是本轮之前的本地提交）。

**建议**：**取上游四个声明**（`timestamp`/`baseId`/`messageInfo`/`messageRole`），删掉 `emittedMessageErrors` 与 `const runIsLive`；`thinkingRun` 不再在本函数声明，而是由 `normalizeHistoryPage` 持有可变容器传入（见 054）。`baseId` 用上游的 `placement.start` 版本，本地 `normalized.length` 那个写法在分页下会导致同一行在不同页 id 不同。

### 054 · `opencode-sessions.provider.ts` 第 2 块（L980）· C · **取上游主体 + 复用 `readShownTextPart` + 保留 reasoning 累加（须改 outline 计数）**

**冲突块**：整个 part 分发体。本地是"循环所有 part、`continue` 跳过"，上游是"一行 part 一个返回值、`return normalized`"。

**上下文**：本地分支的内容与上游并不对立——本地 `text` 分支里的 `<images_input>` / `<files_input>` 解析，与上游新抽出的 `readShownTextPart`（L489–512）**逐行等价**；本地 `tool` / `step-finish` / `patch` / `agent` 分支与上游也一致，只有返回方式不同。因此主体直接取上游：`if (partType === 'text') { const shownText = readShownTextPart(partData, messageRole); if (shownText) push(...) } return normalized;` 这样 `countShownPartMessages`（L526）与归一化逻辑不会分叉——该函数的注释明确要求两者保持一致，`opencode-history-pages.test.ts` 会用真实 SQLite 逐 part 类型校验。

**唯一的真冲突是 reasoning 累加**：本地把同一消息的连续 reasoning 分片合成一个 thinking 消息；上游的 outline 把**每个 reasoning part 计为 1 条**（`countShownPartMessages` 的 `case 'reasoning': return readShownReasoning(...) === null ? 0 : 1`），`start`/`count` 就是分页切片的位置表。若只是把本地累加塞回来，`total`、`start` 全部错位，翻页会跳消息或重复。

**建议**（按此顺序做）：

1. **主体**取上游，`text` 用 `readShownTextPart`，删掉本地内联的 `parseImagesInputTag`/`parseFilesInputTag` 调用（`readShownTextPart` 里已有）。
2. **累加状态上移**：`normalizeHistoryPage` 里声明 `const thinkingRun: { messageId: string; message: NormalizedMessage } | null` 的可变容器，传给 `normalizeHistoryRow`。
3. **本函数内**在执行分发前加一行 `if (partType !== 'reasoning') run.clear()`（放在 `if (!partType) return normalized;` 之后，保持本地"未知类型不清空"的行为）；reasoning 分支沿用本地逻辑：同 `messageId` 就 `message.content += content`，否则 push 新消息并把 `id` 用上游的 `baseId`、同时写入容器。
4. **outline 计数同步**：`countShownPartMessages` 需要知道"这是不是同一消息的 reasoning 续片"，续片返回 0。`readOpenCodeHistoryOutline` 的消息内 part 循环里本来就按顺序遍历，可用一个 `previousPartWasReasoning` 标志（每个 message 重置）传入，`start` 随之正确累计。
5. **页边界对齐**：`from` 若落在某个 reasoning 续片上，把 `from` 回退到该消息的 `start`（`sliceTailPage` 之后对 `page[0]` 做一次修正）。否则页首的续片既无处累加、也会让 `count` 与实际产出的条数不符。

> **这一步不是机械合并，是设计选择**：若不想动 outline，替代方案是**放弃本地的 reasoning 累加**、接受上游"一个分片一个 thinking 气泡"。那是肉眼可见的回归（本地修它的理由就写在 L948–950 的注释里）。**D22 已拍板（2026-11-17）：保留累加**，所以上面前 5 步照做，`opencode-history-pages.test.ts` 与 `opencode-sessions.test.ts` 必须各补一条"连续 reasoning 分片合并成一条且分页总数不变"的用例——这是唯一能防住位置表错位的手段。

### 055 · `provider.routes.ts` 第 1 块（L33）· A · **并集（一行 import 合并）**

**冲突块**：
- 本地：`import { AppError, asyncHandler, createApiSuccessResponse, readObjectRecord } from '@/shared/utils.js';`
- 上游：同上但末位换成 `SIDE_QUESTION_ID_PATTERN`。

**上下文**：两者在合并后都被使用——`readObjectRecord` 在 L487（`parseMcpConfigFields(readObjectRecord(body.config) ?? {})`，本地自定义 MCP 目录写回），`SIDE_QUESTION_ID_PATTERN` 在 L82（上游侧问路由的 id 校验）。合并文件里 `btwService`（L5，本地 btw 抽屉）与 `sideQuestionsService`（L17，上游侧问）**同时存在**，各自的 `/btw/*`（L1480–1498）与侧问路由（L1412、L1579）也都还在。

**建议**：**并集**——
```ts
import { AppError, asyncHandler, createApiSuccessResponse, readObjectRecord, SIDE_QUESTION_ID_PATTERN } from '@/shared/utils.js';
```

> 提醒：本文件是 D17（是否保留上游 side questions）的落点之一。若决定丢弃上游侧问，需要连带删除 L82 的校验、L1412/L1579 的路由以及 `sideQuestionsService` 导入；若两套并存，则前后端都各有两个"旁问"入口，需要在 UI 与权限语义上至少有一处收敛，否则用户会看到两个功能重叠的按钮。

### 056 · `services/provider-runtime.service.ts` 第 1 块（L116）· A · **并集（两侧各加了一个方法，抢同一个收尾 `},`）**

**冲突块**：本地新增 `disposeSession(providerName, sessionId)`（注释说明消费者是 `btw.service.ts` 删除隐藏副本与 edit-rewind），上游新增 `steer(providerName, sessionId, command, options)`。两者都把方法插在 `stopBackgroundTask` 之后、对象字面量结尾的 `},` 之前，所以 git 把它们判成同一处冲突。

**上下文**：`IProviderRuntime` 接口里两个成员**都已存在**（`disposeSession?` 在 `server/shared/interfaces.ts:70`，`steer?` 在 `:93`，都是可选方法，自动合并成功）。调用侧也都真实存在：`btw.service.ts:428` 调 `providerRuntimeService.disposeSession(...)`；`chat-websocket.service.ts:689` 通过 `dependencies.runtime.steer(...)` 走进来（`chat.steer` 协议）。两者语义独立、无重叠。

**建议**：**并集**——保留两个方法，各自带自己的 JSDoc 与闭合 `},`：
```ts
async disposeSession(providerName, sessionId) { ... },
async steer(providerName, sessionId, command, options) { ... },
```
不要只留一个，否则对应的运行时会静默失去能力（可选链会吞掉缺失）。

### 057 · `services/sessions.service.ts` 第 1 块（L240）· A · **并集（两侧都在同一个位置插入了顶层函数）**

**冲突块**：L240–L414，跨三个完整函数。
- 本地侧：`decorateRunningEntries(entries)`（给运行中条目补 `projectId` 与 `pendingPermissions`）+ `toRunningPendingPermission(value)`。
- 上游侧：`readClearedContextSegment(sessionId, provider, projectPath, segment)`（读 `/clear` 之前的旧 transcript，并追加一条 `contextCleared` 的 "Context cleared" 分隔行）+ `readCurrentContextHistory(session, limit, offset)`（只读最近一次 clear 之后的当前上下文）。

**上下文**：两者修饰的是完全不同的问题域——本地是"运行中会话的侧边栏详情"，上游是"`/clear` 之后的历史分段"。四个函数在合并文件里**都有调用点**：`decorateRunningEntries` 在 L481（`listRunningSessions` 内），`readClearedContextSegment` 在 L1120、`readCurrentContextHistory` 在 L1128 与 L1144（历史读取入口）。相关类型/导入也都已是并集状态：`RunningSessionPendingPermission`（本地，L26–29）、`ClearedContextSegment`/`FetchHistoryResult`/`sliceTailPage`/`sessionHistoryCache`（上游）。

**建议**：**并集**，按本地函数 → 上游函数顺序拼接。**注意 JSDoc 归属**：冲突区上方的 `/**`（L239）是两侧共用的文档开头，本地侧从 `* Attaches the sidebar-facing...` 接上即可；而上游侧的 `* Reads one earlier part...` 缺少 `/**` 开头，拼接时必须给上游这一段补一个 `/**`，否则 ` * Reads one earlier part...` 会变成顶层裸语句 → `tsc` 在这一行直接报语法错，而报错位置本身看起来像注释，容易被误判成别的问题。

### 058 · `services/sessions.service.ts` 第 2 块（L924）· A · **并集（两个新方法共用一个 JSDoc 开头）**

**冲突块**：`rewindSessionForEdit` 之后新增方法的**注释与签名**。
- 本地：`async detachSessionForScratchEdit(sessionId): Promise<void>` —— "改第一条消息"时把会话从旧 transcript 上摘掉（旧 transcript 标 superseded，行 `detach`），让下一次运行拿到的 provider id 绑回**同一个** app 会话，而不是多出一条侧边栏条目。
- 上游：`async clearSessionContext(sessionId): Promise<{ sessionId, cleared }>` —— `/clear`：会话 id、名字、可见历史都保留，下一条消息开一个新的 provider session。

**上下文**：两者都插在同一个位置，所以共享了 L923 的 `/**` 与本块被截断的 `*/`。合并文件里两个方法**都有调用点**：`detachSessionForScratchEdit` ← `chat-websocket.service.ts:636`（edit-rewind 网关），`clearSessionContext` ← `provider.routes.ts:1462`（`/clear` 路由）。语义不同且不重叠：前者为"编辑首条消息"换 transcript，后者为"清空上下文"换 transcript；但底层动作相邻（都涉及 supersede + detach），所以第 3 块（L956）的 body 是同一类分叉。

**建议**：**并集**——写两个独立方法，各自补全 `/** ... */`：

```ts
/** ...本地注释... */
async detachSessionForScratchEdit(sessionId: string): Promise<void> { ... },

/** ...上游注释... */
async clearSessionContext(sessionId: string): Promise<{ sessionId: string; cleared: boolean }> { ... },
```

两边各自需要一份 `const session = sessionsDb.getSessionById(sessionId)` 与 404 抛错（合并文件 L948–954 那份只能服务一个方法），见 059。

### 059 · `services/sessions.service.ts` 第 3 块（L956）· A · **并集（两个方法的 body 各归各家）**

**冲突块**：L956–L1006，两个新方法的实现体。

- 本地：`if (session.provider_session_id) markProviderSessionSuperseded({... jsonlPath})` + `sessionsDb.detachProviderSession(sessionId)`。
- 上游：`supportsContextClearing` 能力闸 → `SESSION_BUSY`（运行中 / 后台任务未结束则 409）→ 需要时先 `synchronize(new Date(session.created_at))` 把 `jsonl_path` 落到行上（best effort）→ `clearProviderSessionContext(sessionId)` → 成功后 `sessionHistoryCache.invalidate` + `broadcastSessionUpserted` → `return { sessionId, cleared }`。

**上下文**：仓库层两个方法都已存在且都有人用——本地 `supersedeAndDetachSession`（dsh 用，`dsh-sessions.provider.ts:474`）、上游 `clearProviderSessionContext`（本块上游侧用）。它们做的事相近但**不是同一件事**：本地上游各自封装了语义（本地带 `jsonlPath` 入参、供"改首条消息"用；上游自己查行、返回 `cleared` 布尔、供 `/clear` 用），且都不在同一事务外裸调用两步（本地 service 的这两行是分开的执行，而 `supersedeAndDetachSession` 明确注释了原子性的理由）。

**建议**：**并集**，两个方法各自的 body 都完整保留；L948–954 的 `getSessionById` + 404 prologue 复制给两个方法。要点：

1. `clearSessionContext` 原样取上游（能力闸、`SESSION_BUSY`、清理前 index、缓存失效、广播缺一不可；`cleared:false` 是"本来就没东西可清"的正常返回，不是错误）。
2. `detachSessionForScratchEdit` 取本地两行，但**建议顺手改成 `sessionsDb.supersedeAndDetachSession(sessionId, {...})`**——同一文件里已经有原子版本，注释里写明了"分开做会在失败顺序上出错"（detach 成功而 mark 失败 → 旧 transcript 仍可被索引；反之 → 行指向一个已被拒绝交回的 transcript）。这是一行改动，且和本轮上游把 `/clear` 收进单事务的方向一致。
3. 两个方法都不要去动 `sessionHistoryCache`：本地路径由调用方（edit-rewind）负责，上游路径自己 invalidate。

### 060 · `services/sessions.service.ts` 第 4 块（L1021）· C · **取上游（删掉本地的空历史提前返回）**

**冲突块**：`fetchHistory` 开头的 `if (!session.provider_session_id) return 空历史`，本地有、上游没有。

**上下文**：上游把这段搬进了新抽出的 `readCurrentContextHistory`（本文件 L351–361）：`if (!session.provider_session_id)` 直接返回 `{ messages: [], total: 0, hasMore: false, offset: requestedOffset, limit: requestedLimit }`。形状与本地完全一致（连 `offset`/`limit` 回显都相同），差别只有本地还在这里套了一次 `paginateHistoryByTurn`——而统一的 turn 分页收尾（见 061）作用在最终 `result` 上，空结果同样会被包住。

**建议**：**取上游**，删除本地这一段。保留它反而有副作用：本地提前返回之后 `provider`/`projectPath` 等局部变量就与后面的融合逻辑脱节，而融合后 `fetchHistory` 要先用 `getClearedContextSegments` 判断路径，提前 return 会把"已 clear 但尚未产生新 provider 会话"的会话读成空历史——那正是上游 `/clear` 之后要显示旧分段 + 分隔行的场景。

### 061 · `services/sessions.service.ts` 第 5 块（L1051）· C · **手工融合：本地 turn 分页 / transcript 缓存 + 上游 `/clear` 分段**

**冲突块**：`fetchHistory` 的主体，两侧几乎重构了同一个方法。
- 本地：`transcriptPath` 判定（claude/codex/**workbuddy/pi**）→ `sessionHistoryCache.getFullHistory` → 命中就 `sliceTailPage` / 未命中就直连 provider → `pageMode === 'turns'` 时 `paginateHistoryByTurn` → 统一改写 `sessionId`。
- 上游：有 cleared 分段时逐段读旧 transcript + 追加 `contextCleared` 标记行 + 读当前上下文，`sliceTailPage` 后返回；否则整体交给新的 `readCurrentContextHistory(session, limit, offset)`。

**上下文**：两边的关注点正交——本地关心"同一段历史的**分页与缓存**"，上游关心"一次会话被 `/clear` 切成了**多段历史**"。上游的 `readCurrentContextHistory`（L344–416）已经把本地的缓存 + `sliceTailPage` + `sessionId` 改写全部实现了一遍，**且它只把 `claude`/`codex` 当作"读 jsonl 文件"的 provider**（L373、L314），而本地名单是 `claude`/`codex`/`workbuddy`/`pi`（L1057 的注释与判断）。直接取上游 = workbuddy/pi 丢掉 stat 校验缓存、每次请求全量重解析（正确但变慢，且 `pi` 的 jsonl 很大）。

**建议**：以上游结构为骨架，把本地剩余的两个能力（**turn 分页**、**扩展的 transcript 名单**）补回去：

```ts
const clearedSegments = sessionsDb.getClearedContextSegments(sessionId);
let result: FetchHistoryResult;
if (clearedSegments.length > 0) {
  const messages: NormalizedMessage[] = [];
  for (const segment of clearedSegments) {
    messages.push(...await readClearedContextSegment(sessionId, provider, projectPath, segment));
  }
  let tokenUsage: unknown = null;
  if (session.provider_session_id) {
    const current = await readCurrentContextHistory(session, null, 0);
    messages.push(...current.messages);
    tokenUsage = current.tokenUsage;
  }
  const { page, hasMore } = sliceTailPage(
    messages,
    usesTurnPagination ? null : requestedLimit,
    usesTurnPagination ? 0 : Math.max(0, requestedOffset),
  );
  result = { messages: page, total: messages.length, hasMore, offset: requestedOffset, limit: requestedLimit, tokenUsage };
} else {
  result = await readCurrentContextHistory(
    session,
    usesTurnPagination ? null : requestedLimit,
    usesTurnPagination ? 0 : requestedOffset,
  );
}

if (usesTurnPagination) {
  result = paginateHistoryByTurn({
    sessionId,
    history: result,
    byteBudget: options.byteBudget ?? 256 * 1024,
    cursor: options.cursor,
    seek: options.seek,
  });
}

return { ...result, messages: result.messages.map((m) => ({ ...m, sessionId })) };
```

配套两点（**必须一起改，否则是静默回归**）：

1. **provider 名单必须补齐（不是"顺带核对"）**。`readClearedContextSegment` L314 与 `readCurrentContextHistory` L373 各有一份硬编码名单，合并后两处都要改，并抽成一个 `const READS_SESSION_TRANSCRIPT_FILE: ReadonlySet<LLMProvider>`（或 `readsSessionTranscriptFile(provider)` 小函数），两处共用，杜绝下次再分叉。名单的真实构成（已逐个核对 `server/modules/providers/list/*`）：
   - 读 per-session 文件、**必须加入**：`claude`、`codex`、`workbuddy`、`pi`、`dsh`、`omp`。
     - `workbuddy`（`workbuddy-sessions.provider.ts:882`）、`pi`（`pi-sessions.provider.ts:628`）读 jsonl；
     - `omp`（`omp-sessions.provider.ts:579`）、`dsh`（`dsh-sessions.provider.ts:345`）同样解码 jsonl 日志。
   - 读共享 SQLite / agent store、**必须排除**：`zcode`（`zcode-sessions.provider.ts:361`，shared session db）、`openclaw`（`openclaw-sessions.provider.ts:717`，agent db）、`opencode`、`cursor`。给它们传 `transcriptPath` 只会让缓存 stat 与真实来源脱钩。
2. **名单之外的第二个前提：这些 reader 必须真的尊重 `options.transcriptPath`**（`server/shared/types.ts:995` 的注释就是给这条立的契约："Only readers that parse a per-session file honour it"）。当前实现并不满足，加名单而不修 reader 会读到**当前**会话当作被清空的那一段（`clearProviderSessionContext` 先 `detachProviderSession` 把该行的 `provider_session_id`/`jsonl_path` 置 NULL，下一轮 run 又把它指向新 transcript，而旧 transcript 只在 `superseded_provider_sessions` 里）：
   - `dsh`（`dsh-sessions.provider.ts:345`）与 `workbuddy`（`:882`）连 `options.providerSessionId` 都不看，直接取 `row.provider_session_id`，更没有 `transcriptPath` 分支；
   - `omp`（`:587`）、`pi`（`:636`）看 `providerSessionId`，但文件路径优先取 `row.jsonl_path`，只有缺失时才用 `resolveOmp/PiTranscriptPath`，同样忽略 `transcriptPath`。
   - 改法一致：`const filePath = options.transcriptPath ?? (row?.jsonl_path && existsSync(row.jsonl_path) ? row.jsonl_path : await resolve…(options.providerSessionId ?? row?.provider_session_id, …))`；`dsh` 还要先用 `options.transcriptPath` 短路 `resolveSessionLogPath/findNewestSessionLog`。
3. **现状与验收**：`provider-capabilities.service.ts` 里目前只有 `claude` 声明 `supportsContextClearing: true`（cursor/codex/openclaw 明确 false，其余未声明即 false），所以第 2 条今天不会在生产触发——但名单和 `transcriptPath` 支持要**同一次改完**，否则哪个 provider 一开 clear 就静默读错会话。验收：在 `dsh-sessions`/`omp-sessions`/`workbuddy-sessions`/`pi-sessions` 各自的历史测试里，用 sinon/mock 包住 `readFile`（或 db 查询）数调用次数，断言同一 segment 连读两次只命中一次 transcript 缓存，且第二次读到的 `sessionId` 是目标 segment 而非当前行。
4. 本地分支里 `providerSessions`/`providerSessionId` 两个局部变量随之消失（上游的两个 helper 内部各自声明，L301/L364），删除即可，否则 `oxlint` 报未使用。

### 062 · `tests/claude-elicitation.test.ts` 第 1 块（L59）· C · **取本地（测试的 context 必须补齐本地新增的两个必填字段）**

**冲突块**：`withRun` 里构造的 `ProviderRuntimeContext` 字面量。
- 本地：多出 `resolveProviderConfigDir: () => null`、`resolveSettingsFile: () => null`。
- 上游：没有这两个字段。

**上下文**：合并后的 `ProviderRuntimeContext`（`server/shared/types.ts:896`）里，这两个成员是**必填**——本地为多引擎（WorkBuddy/CodeBuddy 的配置根目录、`claude --settings` 等价物）加的，注释也一起合进来了；上游的版本根本没有这两个成员（上游 `types.ts` 里 `ProviderRuntimeContext` 只有 6 个成员）。所以这里不是"上游删掉了"，而是上游不知道它们存在。

**建议**：**取本地**——保留两行 `: () => null`。若取上游，`npx tsc --noEmit` 会在这一行报 `Property 'resolveProviderConfigDir' is missing`，属于纯编译错误，改回来即可。注意这是测试夹具，返回 null 表示"没有自定义配置"，与生产默认一致，不会影响被断言的 elicitation 行为。

### 063 · `tests/claude-elicitation.test.ts` 第 2 块（L186）· C · **取本地（同 062）**

**冲突块**：`startedWith` 内另一处 `ProviderRuntimeContext` 字面量，同样是本地多出 `resolveProviderConfigDir` / `resolveSettingsFile` 两个必填字段。

**上下文**：与 062 完全同因——`ProviderRuntimeContext` 在合并结果里保留的是本地版本（含这两个**必填**成员）。这一处是 `unattended` 测试的夹具，两个字段都返回 null（"无自定义配置"）。

**建议**：**取本地**，保留两行。两个夹具（L59、L186）要一起改，漏一处 `tsc` 就会报缺属性。

### 064 · `tests/claude-elicitation.test.ts` 第 3 块（L210）· B · **取上游（纯新增断言）**

**冲突块**：`an unattended run sets no callback` 用例末尾，本地为空、上游多三条：
```ts
const attendedBypass = await startedWith({ unattended: false, permissionMode: 'bypassPermissions' });
assert.equal(attendedBypass.permissionMode, 'bypassPermissions');
assert.equal(typeof attendedBypass.onElicitation, 'function');
```

**上下文**：这是上游为"`bypassPermissions` 不得顺带关掉 elicitation"补的回归断言（对应本轮上游"attended 的 agent-API 运行"语义）。它只调用本文件已有的 `startedWith`，不依赖任何本地结构。上方 L208–209 的两条断言（`unattended: true` → 无 callback；默认 → 有 callback）是两侧共有内容。

**建议**：**取上游**，原样并入。合并后该用例会多跑一次 `queryClaudeSDK`，仍走脚本化 `createQuery`，不启动外部进程。

### 065 · `tests/claude-models.test.ts` 第 1 块（L7）· A · **并集（两侧各加了导入）**

**冲突块**：`claude-models.provider.js` 的导入列表 + 本地额外的一行数据库导入。
- 本地：`appConfigDb, closeConnection, initializeDatabase`（单独一行）+ `ClaudeProviderModels`、`applyClaudeModelMappings`、`pickClaudeModelMappings`。
- 上游：`CLAUDE_ULTRACODE_EFFORT`、`findClaudeModelOption`。
- 共有：`CLAUDE_PREDEFINED_MODELS`、`extractClaudeEventModel`。

**上下文**：合并后的文件里**每一个符号都有使用点**（逐个确认）：`appConfigDb`/`closeConnection`/`initializeDatabase` 在 L295–305 的"读取 activeFile 设置"用例，`ClaudeProviderModels` L301，`pickClaudeModelMappings` L259–288，`applyClaudeModelMappings`/`findOption` L178–254，`findClaudeModelOption`/`CLAUDE_ULTRACODE_EFFORT` L53–93（上游新增的 pinned models 用例）。

**建议**：**并集**，得到 8 个模型函数 + 3 个数据库符号：
```ts
import { appConfigDb, closeConnection, initializeDatabase } from '@/modules/database/index.js';
import {
  ClaudeProviderModels,
  CLAUDE_PREDEFINED_MODELS,
  CLAUDE_ULTRACODE_EFFORT,
  applyClaudeModelMappings,
  extractClaudeEventModel,
  findClaudeModelOption,
  pickClaudeModelMappings,
} from '@/modules/providers/list/claude/claude-models.provider.js';
```

### 066 · `tests/claude-models.test.ts` 第 2 块（L26）· A · **并集（本地 `findOption` 辅助 + 上游 pinned models 整组用例）**

**冲突块**：本地保留 `findOption(value)` 辅助（断言预置项存在并返回）；上游在这里放了 `PINNED_MODELS` 常量表（13 个 pinned 模型 + 默认 effort + 是否提供 xhigh）及 4 个 pinned models 用例（L40–94）。

**上下文**：两者不冲突且**都被后面的代码依赖**——`findOption` 在 L194–207、L250–254 被多处使用（`applyClaudeModelMappings` 相关用例）；上游这段在 L60–95 之后还有 `for` 循环体（已自动合并在冲突区外）继续使用 `findClaudeModelOption`/`CLAUDE_ULTRACODE_EFFORT`。上游这段是本轮"Claude pinned models"特性的断言主体，不能丢。

**建议**：**并集**，顺序：先 `findOption` 辅助，再 `PINNED_MODELS` 常量，再上游的 5 个用例（L40–94 完整：pinned 版本 effort 表、ultracode 只在 xhigh 与非 Haiku 上、别名顺序与 id 唯一、Haiku 的 effort 档位）。上游这一段是自洽完整的，直接整块追加在 `findOption` 之后即可，不要删任何断言。

### 067 · `tests/codex-models.test.ts` 第 1 块（L3）· A · **取本地（`writeFile` 仍在使用）**

**冲突块**：`node:fs/promises` 的导入——本地 `{ mkdtemp, rm, writeFile }`，上游 `{ mkdtemp, rm }`。

**上下文**：合并文件里 `writeFile` 有两处使用：L45 `writeFile(path.join(homeDir, 'config.toml'), configBody, 'utf8')` 与 L47（`writeTempCodexConfig` 写多个配置文件）。这两处是本地为"多配置文件/自定义 provider 目录"用例加的工具函数（`writeTempCodexConfig` 在 L39 起，上游没有对应内容）。

**建议**：**取本地**，保留 `writeFile`。取上游会导致 `writeTempCodexConfig` 里 `writeFile is not defined` 的运行时失败（`tsc` 也会报未定义）。

### 068 · `tests/codex-models.test.ts` 第 2 块（L321）· C · **取上游、删掉本地的重复定义（否则 `const` 重名直接编译失败）**

**冲突块**：`runChatCodexCli` 辅助的**第二份定义**。合并文件里它出现了两次：
- L284（自动合并进来的上游版本）：`createRequire(import.meta.resolve('@openai/codex-sdk'))` → 通过 SDK 自己的解析链找 `@openai/codex/package.json`，注释说明"SDK 会启动装在它旁边的 `@openai/codex-<platform>` 原生二进制"。
- L327（本地版本，就是本冲突块）：`createRequire(import.meta.url)` + `require.resolve('@openai/codex/package.json')`，注释写明"**this fork does not depend on the SDK**"。

**上下文**：两个都是 `const` 箭头函数，同名同作用域 → 保留两份必然 `TS2451 Cannot redeclare block-scoped variable`。这个 helper 的具体用途见 L371：`runChatCodexCli(['debug', 'models', '--bundled'])`，真正去跑 Codex CLI 校验预置模型表。判据是合并后的 `package.json`：L213 `"@openai/codex": "0.166.0"`、L216 `"@openai/codex-sdk": "^0.166.0"` **两者都在**，且 `tests/provider-abort-notifications.test.ts:8` 直接 `import { Codex } from '@openai/codex-sdk'`——本轮同步后 fork 已经依赖 SDK，"不依赖 SDK"的前提不成立。

**建议**：**取上游（L284 那份），删除本地 L321–345 的定义**。理由：它是沿 SDK 的解析链走，不依赖 npm 提升把 `@openai/codex` 放在测试文件可解析的位置；本地那份在 pnpm/严格布局下会 `MODULE_NOT_FOUND`。删除本地定义后，L273 的 `const require = createRequire(import.meta.url)` **仍要保留**——文件下方 L394、L403 还在用它读 `@openai/codex/package.json` 的 `version`（打印 CLI 版本用），不要顺手当成孤儿删掉。

> 若亮想坚持"测试不依赖 SDK"，那就必须反过来删掉上游那份并保留本地——但**不能两份都留**，且要接受 `@openai/codex` 必须能被测试文件直接解析。

### 069 · `tests/fixtures/fake-opencode-serve.ts` 第 1 块（L43）· A · **并集（`PartStep` 同时要有 `chunks` 和 `deltas`）**

**冲突块**：`Step` 联合类型里 text/reasoning 分片的形状。
- 本地：`| { type: 'text'; text: string; deltas?: number } | { type: 'reasoning'; text: string; deltas?: number }`——`deltas` 表示"把 text 切成 N 段增量推送"。
- 上游：`| PartStep`，而 `PartStep`（L40，自动合并进来的）是 `{ type: 'text' | 'reasoning'; text: string; chunks?: string[] }`——`chunks` 是显式分片数组，并按 opencode 1.18.30 的真实节奏发 `text-start` → `message.part.delta` → `text-end`。

**上下文**：合并文件里**两条路径都在**，且都被使用：上游的 `chunks` 分支在 L287–302（`if ((step.type === 'text' || step.type === 'reasoning') && step.chunks)`），本地的 `deltas` 分支在 L304–318（`if (!step.deltas)` 整段发布，否则空 part → N 个 delta → 完整 part）。两个分支各自 `continue`，互不干扰，这个自动合并结果是对的。类型若只保留 `PartStep`，L305/L313 的 `step.deltas` 会报 `Property 'deltas' does not exist`。

**建议**：**并集**，把两个可选字段并入同一个 `PartStep`：
```ts
type PartStep = { type: 'text' | 'reasoning'; text: string; chunks?: string[]; deltas?: number };
```
联合里只留 `| PartStep`，删掉本地那两行显式变体（它们是 `PartStep` 的子集，留着只是重复且容易与 L40 的定义漂移）。同时补一句注释说明 `deltas` 是本地脚本用、`chunks` 是上游侧问/1.18.30 节奏用。

### 070 · `tests/fixtures/fake-opencode-serve.ts` 第 2 块（L147）· A⚠ · **并集，但必须处理 `emitPart` 被同名内层函数遮蔽的合并缺陷**

**冲突块**：模块级辅助函数。
- 本地：`emitPart(sessionID, part, id?)`（带可选 partID 的 `message.part.updated` 发布）+ `splitInto(text, count)`（把文本切成 count 段）。
- 上游：`publishPart(sessionID, part)`（返回发出去的完整 part）+ `storeMessage` + `publishMessages` + `flushCopies` + `sleep`。

**上下文**：五加二**全部被使用**：本地两个在 `playTurn` 的 deltas 分支（L312–316 用 partID、L313 用 `splitInto`），上游的 `publishPart`（L252/288）、`storeMessage`（L253/266）、`publishMessages`（L529）、`flushCopies`（L533/576/582）、`sleep`（L453/499）贯穿侧问 fork 的复制/迟到 flush 逻辑。两者无重叠，应当并存。

**⚠ 合并已经在 `playTurn` 里制造了一个遮蔽 bug**：上游 L246 在 `playTurn` 内部声明了
```ts
const emitPart = (_sessionID: string, part: Record<string, unknown>) => {
  assistant.parts.push(publishPart(sessionID, { messageID: shape.assistantMessageID, ...part }));
};
```
它**遮蔽了模块级的 `emitPart`**（本地的，签名是 `(sessionID, part, id?)`）。同一函数内 L312/L316 调 `emitPart(sessionID, {...}, partID)` 传了第三个参数 → `TS2554 Expected 2 arguments, but got 3`；即便绕过类型检查，L246 的版本也不会沿用传入的 `partID`，导致 start/delta/end 三段属于不同的 part id，本地"增量同 id"的断言随之失真。

**建议**：**并集 + 改名消歧，且改动面要最小**。核心约束有两条：(1) 上游那 4 处 `emitPart` 调用（L306/337/387/401）会 `assistant.parts.push(...)` 把 part 记进消息体，`GET /session/:id/message` 与 fork 复制都读它，**行为要保留**；(2) 本地 deltas 分支（L312/316）当初**故意不入库**，只推动 SSE 帧。

所以：**上层的 L246 内层 `emitPart` 原样不动**（所有非 delta 调用点一个都不改），只把模块级本地 helper 改名为不会与它冲突的名字，并在 `playTurn` 内加一个专供流式分片的小包装：

```ts
// 模块级（原本地 emitPart 改名）
const emitPartWithId = (sessionID: string, part: Record<string, unknown>, id?: string) => {
  emit('message.part.updated', {
    sessionID,
    part: { id: id ?? `prt_${++partCounter}`, sessionID, messageID: 'msg_assistant', ...part },
    time: Date.now(),
  });
};

// playTurn 内，紧随 L246 的内层 emitPart
const emitStreamedPart = (part: Record<string, unknown>, id: string) =>
  emitPartWithId(sessionID, { messageID: shape.assistantMessageID, ...part }, id);
```
L312、L316 两处改为 `emitStreamedPart({...}, partID)`，其余调用点不动。这样 start/delta/end 三段共用同一个 part id（本地断言依赖它），又不会把流式 part 塞进 `assistant.parts`（保持本地原有语义，避免历史里出现一条空 part + 一条完整 part）。

### 071 · `tests/opencode-models.test.ts` 第 1 块（L803）· C · **取本地（fork 装饰了静态目录，`deepEqual` 不成立）**

**冲突块**：`OpenCode still gives up on, and kills, an 'opencode models' that never answers` 用例里，CLI 被 kill 之后的回落断言。
- 本地：只比 `OPTIONS.map(o => o.value)` 与 `DEFAULT`，注释写明 "**This fork decorates the static catalog with shared descriptions and channel groups, so compare the model ids and the default only.**"
- 上游：`assert.deepEqual(await pending, OPENCODE_PREDEFINED_MODELS)`。

**上下文**：opencode 目录装饰（共享描述表 + 渠道分组 + WorkBuddy 网关）是本 fork 既有特性——同一文件 L862 起的本地用例就在断言 `description` / `group`。装饰之后 `OPTIONS[i]` 与 `OPENCODE_PREDEFINED_MODELS` 不再逐字段相等，`deepEqual` 必然失败。

**建议**：**取本地**。若将来想恢复严格比较，正确做法是比"装饰后的基线快照"，而不是比未装饰的 `OPENCODE_PREDEFINED_MODELS` 常量。

### 072 · `tests/opencode-models.test.ts` 第 2 块（L845）· C · **取本地（同 071，另一处回落断言）**

**冲突块**：`OpenCode ignores the output of an 'opencode models' that fails, and copes with none on PATH` 用例中，`{ exitCode: 1 }` / `{ missing: true }` 两种配置下的回落断言，与 071 是同一处分歧的第二次出现。

**上下文**：上面是 `for (const config of [{ exitCode: 1 }, { missing: true }])`，两次回调都走 `getSupportedModels()` 的静态兜底；兜底目录被装饰过，所以只有 id 与 `DEFAULT` 可比。用例末尾的 `fake.leftoverTempEntries()` 断言是两侧共有的。

**建议**：**取本地**，与 071 保持一致（两处若不一致，测试会因为同一原因一半过一半挂）。

### 073 · `tests/opencode-models.test.ts` 第 3 块（L862）· B · **取本地（整段新增用例，上游这里没有）**

**冲突块**：本地新增一个 100 行的用例 `OpenCode offers the models a configured provider declares`，上游为空。

**上下文**：用例覆盖三件事，全部是本 fork 的 opencode 目录装饰能力：
1. 配置里带自定义 `provider` 块（WorkBuddy 这类网关）时，其模型**只存在于配置中**，必须能进选择器——"只读 provider id 会把这些全过滤掉"正是这条用例防的回归；
2. 配置模板里的 `description` 被忽略，副标题统一来自共享映射表；每个配置 provider 一个 `group` 标题；配置没写 `name` 时回退到 id；`DEFAULT` 不能停在 CLI 拒绝运行的精选模型上；
3. 后续两段 `withOpenCodeHome`：精选项排在配置项之前、重复的配置项不得列两次。

**建议**：**取本地**，整段保留。这条用例同时是 047–050（`opencode-models.provider.ts` 的 v1 `provider` / v2 `providers` 融合）的**验收标准**——它写的是 v1 的 `provider: {...}` 形态。如果融合时只保留上游的 v2 读取路径，这条用例会红，正好拦住"升级 v2 时悄悄丢掉 v1 配置"的回归。融合后请确认 `writeOpenCodeConfig` 写入的文件名（`.config/opencode/opencode.json`）仍被上游的 JSONC/XDG 搜索路径命中，否则用例会因"读不到配置"而失败——那是搜索路径漏了，不是断言错了。

### 074 · `websocket/services/chat-websocket.service.ts` 第 1 块（L1）· A · **并集（两个 Node 内置导入）**

**冲突块**：文件头第一行——本地 `import { existsSync } from 'node:fs'`，上游 `import { randomUUID } from 'node:crypto'`。

**上下文**：两个都在合并后的文件里被使用：`existsSync` 在 L307（`chat.send` 的附件校验，判断 `path.resolve(descriptor.path)` 是否真存在——本地"绝对路径附件"语义），`randomUUID` 在 L677（上游 `chat.steer` 为 steer 消息生成 transcript id，`UUID_PATTERN.test(requestedId) ? requestedId : randomUUID()`）。

**建议**：**并集**，两行都留：
```ts
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
```

### 075 · `websocket/services/chat-websocket.service.ts` 第 2 块（L291）· B · **手工融合：上游抽出的 `readVerifiedAttachments` + 本地的"文件已被回收就丢弃并提示"**

**冲突块**：`dispatchRun` 里附件去重/校验。
- 本地：三段 `normalizeAttachmentDescriptors` → `filterAttachmentsToUploadStore` → 按 `path` 去重 → **再 `.filter(existsSync)`，缺失的文件 `console.warn` 并给该 run 发 `attachment_missing`**（注释说明：上传可能在 composer 发送与本轮启动之间被回收，硬发路径会让 provider 静默丢图或整轮失败）。
- 上游：把前三步抽成 `readVerifiedAttachments(clientOptions)`（L227–237），这里只有一行调用。

**上下文**：上游的抽取**不包含**第四步——`readVerifiedAttachments` 只做 candidates + upload-store 过滤 + 去重，既没有 `existsSync` 也没有 `attachment_missing`。而 `attachment_missing` 是本 fork 的 UI 协议消息（前端据此提示用户重传）。若只取上游一行，用户在上传被回收后会看到"消息发出去了但图没了"，没有任何提示。

**建议**：**手工融合**——保留上游的调用与抽取，把本地的缺失检查接在它后面（`run.writer.send` 需要 `run`，所以不能塞进 helper）：

```ts
const uniqueAttachments = readVerifiedAttachments(clientOptions).filter((descriptor) => {
  if (existsSync(path.resolve(descriptor.path))) {
    return true;
  }
  console.warn(`[Chat] Dropping attachment missing from the upload store: ${descriptor.path}`);
  run.writer.send({
    kind: 'attachment_missing', sessionId, provider,
    path: descriptor.path, name: descriptor.name ?? null,
  });
  return false;
});
```

⚠ 两点提醒（**不要在本轮顺手改**，只记下来）：
- `path.resolve(descriptor.path)` 对**相对路径**是按进程 cwd 解析，而 `filterAttachmentsToUploadStore` 是按 `~/.cloudcli/assets` 解析的。如果前端可能传相对路径（仅文件名），这里的 `existsSync` 会误判为缺失并把合法附件丢掉。当前行为来自本地既有代码，本轮不动；但这是个潜在 bug，值得单独确认。
- `attachment_missing` 是本地自定义的 writer 消息类型，`ProviderRuntimeWriter` 的 send 参数若是 `NormalizedMessage`，这里用的是 `run.writer.send({kind:'attachment_missing', ...})` 的宽松签名——合并后跑一次 `tsc` 确认没被上游的类型收紧拦住。

### 076 · `services/session-upsert-broadcast.service.ts` 第 1 块（L5）· A · **并集（去重后只剩 `SessionUpsertChange` + `broadcastToConnectedClients`）**

**冲突块**：文件头导入。
- 本地：`isSessionContentUnread`（`@/shared/index.js`）、`connectedClients, WS_OPEN_STATE`（`websocket-state.service.js`）、`type { SessionUpsertChange, SessionUpsertedEvent }`。
- 上游：`broadcastToConnectedClients`（同一个 `websocket-state.service.js`）、`type { SessionUpsertedEvent }`。

**上下文**：`isSessionContentUnread` 在 L78（本地未读判定）、`SessionUpsertChange` 在 L33/127/140/158（`change` 分类，上游文件也在用）——两者必须保留。分歧在广播函数：本地自带 `sendToConnectedClients`（见第 3 块），上游用 `websocket-state.service.ts:32` 的 `broadcastToConnectedClients`，**两者实现逐行相同**，只是上游版还接受 `string | string[]`。因此真正保留哪些导入取决于第 3 块怎么处理。

**建议**：按 078 的推荐（删本地重复 helper）→ 导入为：
```ts
import { isSessionContentUnread } from '@/shared/index.js';
import { broadcastToConnectedClients } from '@/modules/websocket/services/websocket-state.service.js';
import type { SessionUpsertChange, SessionUpsertedEvent } from '@/shared/types.js';
```
`connectedClients` / `WS_OPEN_STATE` 随之删除（它们只被本地那个 helper 使用）。

### 077 · `services/session-upsert-broadcast.service.ts` 第 2 块（L76）· A · **并集（六个字段全都有人读）**

**冲突块**：`buildSessionUpsertedEvent` 里 `session` 对象的字段。
- 本地：`contentUpdatedAt`、`isUnread`（`isSessionContentUnread(row.content_updated_at ?? null, lastSeenAt)`）、`change`、`parentSessionId`。
- 上游：`forkedFromSessionId`、`forkAncestors`（`row.forked_from_session_id ? sessionsDb.getForkAncestors(row.session_id) : []`）。

**上下文**：客户端 `SessionSummary`（`src/shared/types.ts:105–145`）里 `contentUpdatedAt`、`isUnread`、`parentSessionId`、`forkedFromSessionId`、`forkAncestors` 都在（`change` 走索引签名）。语义各不相同：本地的四者服务"未读胶囊 + 手动会话树 + 元数据刷新不留未读"，上游两者服务"fork 树/祖先上下文（Projects 专用，Conversations 分页排除）"。`row.forked_from_session_id`、`row.parent_session_id` 两个列在 `SessionRow` 与 SELECT 列表里都已存在（sessions.db.ts:28/30/50）。

**建议**：**并集**，六个字段全留：
```ts
contentUpdatedAt: row.content_updated_at ?? null,
isUnread: isSessionContentUnread(row.content_updated_at ?? null, lastSeenAt),
change,
parentSessionId: row.parent_session_id ?? null,
forkedFromSessionId: row.forked_from_session_id ?? null,
forkAncestors: row.forked_from_session_id ? sessionsDb.getForkAncestors(row.session_id) : [],
```

> 性能备注（不在本轮改）：`getForkAncestors` 在每次 `session_upserted` 广播里都会为**有 fork 源**的会话跑一次递归查询，而该事件在 watcher 批量刷新时逐条构造；本地已有的 `parentSessionId` 只是读列、零成本。若 fork 树深度大，这里会成为热点，值得后续合并进批量查询。

### 078 · `services/session-upsert-broadcast.service.ts` 第 3 块（L99）· C · **取本地内容、删掉重复的广播 helper，统一用上游的 `broadcastToConnectedClients`**

**冲突块**：本地新增了 `sendToConnectedClients(payloads: string[])` 与 `stampFallbackContentTimestamp(entry)`；上游同位置为空（它用 `websocket-state.service.ts` 里已有的 `broadcastToConnectedClients`）。

**上下文**：
- `sendToConnectedClients` 与 `broadcastToConnectedClients`（`websocket-state.service.ts:32–45`）**实现完全一致**（判空、遍历 `connectedClients`、`readyState === WS_OPEN_STATE` 才 send），后者额外支持单个字符串。合并文件里另外两个导出函数（`broadcastSessionUpserted` L145、`broadcastSessionUpsertedBatch` L169）都已在调上游那个，只有本地新增的 `broadcastSessionRemoved`（L183）还在调本地这个。
- `stampFallbackContentTimestamp` 则**只有本地有**，且被 `broadcastSessionUpserted`（L142）与 `broadcastSessionUpsertedBatch`（L162）调用——它是本地"未读版本号"机制的一部分（`change === 'content'` 时才用 `backfillContentUpdatedAt` 打时间戳，`metadata` 刷新不动版本），**必须保留**。

**建议**：
1. **保留** `stampFallbackContentTimestamp` 原样。
2. **删除** `sendToConnectedClients`，把 `broadcastSessionRemoved` 的最后一行改成 `broadcastToConnectedClients([JSON.stringify({...})]);`。
3. 顺带删掉第 1 块里只为它存在的 `connectedClients, WS_OPEN_STATE` 导入。

行为零变化（两个函数逐行等价），换来文件里只有一条广播路径；若亮更保守，也可以保留本地 helper 并让 `broadcastSessionRemoved` 继续用它——代价是同一文件里两套等价实现，后来人容易改一半。

### 079 · `server/shared/interfaces.ts` 第 1 块（L60）· A · **并集（`IProviderRuntime` 三个可选成员各归各家）**

**冲突块**：`IProviderRuntime` 末尾——本地加了 `disposeSession?(sessionId)`，上游加了 `askSideQuestion?(request, sink, context)` 与 `steer?(sessionId, command, options)`。

**上下文**：三者都是**可选**成员，各自的实现与调用方都存在：
- `disposeSession`：`btw.service.ts:428` 调用，DSH 的 ACP 子进程用它释放会话日志；也是 `provider-runtime.service.ts` 第 1 块（056）的本地方法。
- `steer`：`chat-websocket.service.ts:689`（`chat.steer` 协议）经 `providerRuntimeService.steer` 调用；Claude 运行时实现。
- `askSideQuestion`：上游侧问能力的运行时入口，`providerRuntimeService.askSideQuestion` 回退到历史路径。

**建议**：**并集**，三个方法连同各自的 JSDoc 全部保留。缺任何一个都是静默降级（可选链吞掉），表现为"功能无声消失"，不是编译错误——比编译错误更难发现。

### 080 · `server/shared/types.ts` 第 1 块（L466）· A · **并集（`SessionUpsertedEvent.session` 六个字段，与 077 一一对应）**

**冲突块**：`SessionUpsertedEvent['session']` 的字段声明。
- 本地：`contentUpdatedAt: string | null`、`isUnread: boolean`、`change: SessionUpsertChange`、`parentSessionId: string | null`（都带较长的语义注释）。
- 上游：`forkedFromSessionId?: string | null`、`forkAncestors?: SessionForkAncestor[]`。

**上下文**：这是 077（产出方 `buildSessionUpsertedEvent`）的类型对侧，两边必须一致，否则 `tsc` 会在 077 的对象字面量处报"多余属性/缺属性"。`SessionForkAncestor` 类型在本文件 L500+ 由上游新增，已自动合并进来。

**建议**：**并集**，六个字段全留，本地的四个保持**必填**（它们确实总是被写入）、上游的两个保持**可选**（`forkedFromSessionId` 为 null 时 `forkAncestors` 可以省略）。注释一并保留——`isUnread` 那段"单用户部署假设"的说明解释了为什么不是按连接下发，删了这段以后很难重建上下文。

### 081 · `server/shared/types.ts` 第 2 块（L963）· A · **并集（`transcriptPath` + 本地整组 turn 分页字段/类型）**

**冲突块**：`FetchHistoryOptions` 尾部。
- 本地：`pageMode?: 'rows' | 'turns'`、`byteBudget?`、`cursor?`、`seek?: HistorySeekTarget`，随后 `};` 闭合，并新增两个类型 `HistorySeekTarget` 与 `TurnHistoryPageInfo`（L974–993）。
- 上游：`transcriptPath?: string`。

**上下文**：`transcriptPath` 是上游 `/clear` 分段读取的关键（`readClearedContextSegment` 用它读"旧的那份 transcript"），已在本文件 L953–956 的 JSDoc 里被描述（那段注释是自动合并的上游内容）。本地的 turn 分页四个字段由 `sessions.service.ts` 的 `paginateHistoryByTurn` 消费（`pageMode`/`byteBudget`/`cursor`/`seek`），`FetchHistoryResult.pageInfo?: TurnHistoryPageInfo`（L1011）也依赖本地新增的类型。

**建议**：**并集**——把 `transcriptPath?: string;` 插在 `providerSessionId?: string;` 之后（JSDoc 顺序也一致），其余保持本地原样的字段 + `};` + 两个类型定义：
```ts
export type FetchHistoryOptions = {
  projectPath?: string;
  limit?: number | null;
  offset?: number;
  providerSessionId?: string;
  transcriptPath?: string;
  pageMode?: 'rows' | 'turns';
  byteBudget?: number;
  cursor?: string;
  seek?: HistorySeekTarget;
};
```
注意**不要**把上游的 `transcriptPath` 放在本地 `};` 之后（那会变成 `};` 后面的孤立语句，语法错误），这正是冲突块末尾 `=======` 附近的样子。

### 082 · `src/modules/chat/ChatInterface.tsx` 第 1 块（L29）· A · **并集（本地的 17 个本地模块导入 + 上游 1 个）**

**冲突块**：文件头的一批本地模块导入。
- 本地：`streamingBufferRegistry`、`revealPacer`、`chatProviderLabel`、`forkFailureMessage`、`sendOptions`、`useBtwSession`（含类型 `BtwAnchorRequest`）、`useBtwRestore`、`useSideAskPlacement`、`BtwDrawer`、`chatExport`（含类型 `PartialExportFormat`）、`messageKeys`、`transcriptSelection`、`executionProcess`。
- 上游：`useEscapeToAbortSession`。

**上下文**：逐个统计了引用次数，**上述每个符号在合并后的文件里都仍有 2 次以上出现**（导入 + 使用），没有因为合并被淘汰的孤儿。而 `useEscapeToAbortSession` 是上游把本地那段全局 Escape 监听抽成 hook 后的新依赖（见 086），也必须留。

**建议**：**并集**，本地 17 行原样保留（含两个 `import type`），在上游那行所在位置补：
```ts
import { useEscapeToAbortSession } from '@/modules/chat/hooks/useEscapeToAbortSession';
```
导入顺序按文件既有习惯（`@/modules/chat/...` 与 `@/shared/...` 分区），不用刻意重排。

### 083 · `src/modules/chat/ChatInterface.tsx` 第 2 块（L128）· C · **取本地（`user` 仍在用）**

**冲突块**：`const { user } = useAuth();`（本地有、上游无）。

**上下文**：`user` 在 L534 被用于 `isAuthReady: Boolean(user)`——本地把"是否已登录"传给下游（`useChatComposerState` 或会话状态的初始化参数）。上游没有这个推导。

**建议**：**取本地**。删掉会让 L534 的 `user` 未定义（TS 报错）；若坚持删，必须同时删掉 `isAuthReady` 那一行并确认下游对未登录态的处理仍然正确——那是功能改动，不属于合并。

### 084 · `src/modules/chat/ChatInterface.tsx` 第 3 块（L425）· B · **并集，但 `scrollToBottom` 必须换成 `scrollToLatest`（合并后它已不在作用域）**

**冲突块**：`useChatComposerState({...})` 的实参。
- 本地：`scrollToLatest`。
- 上游：`onClearContext: handleClearContext`、`scrollToBottom`。

**上下文**：
- `onClearContext` 是上游 `/clear` 功能的接线（`handleClearContext` 定义在 L306–343，本地文件里本来就有这个函数——它由上游引入并自动合并进来）。**必须留**，否则 `/clear` 按钮与输入框的清除动作没有回调。
- `scrollToBottom`：合并后的 `useChatSessionState` **并不导出**它——它只是 hook 内部的 `useCallback`（`useChatSessionState.ts:849`），公开返回的是 `scrollToLatest`（L2551）与 `scrollToBottomAndReset`（L2552）。上游能传是因为上游的 `useChatSessionState` 导出了 `scrollToBottom`（本地这一侧在 104 块的选择会决定最终导出什么）。照抄上游这一行会得到 `Cannot find name 'scrollToBottom'`。
- 本地传的 `scrollToLatest`（`useChatSessionState.ts:1326`）语义上是 `scrollToBottom` 的超集：额外重置 `isUserScrolledUp` 并走 `followTranscriptLayout` 跟随布局。

**建议**：**并集 + 改名**：
```ts
onClearContext: handleClearContext,
scrollToLatest,
```
然后在 `useChatComposerState` 里把上游新用的 `scrollToBottom` 参数统一接到 `scrollToLatest`（该 hook 的冲突见 094–098）。若评审更愿意保留上游命名，另一条路是在 `useChatSessionState` 的返回里补 `scrollToBottom`——但那等于把一个内部实现细节变成公开 API，且同一文件里已有两个滚动入口，不推荐。

### 085 · `src/modules/chat/ChatInterface.tsx` 第 4 块（L726）· A · **并集（本地 btw 五个回调 + 上游 steer 一个回调）**

**冲突块**：`useChatRealtimeHandlers({...})` 的实参尾部。
- 本地：`sideAskSessionId: btw.sessionId`、`setSideAskPermissionRequests`、`onSideAskSessionGone: handleSideAskGone`、`onSideAskSubscribed: handleBtwSubscribeAck`、`onSessionProcessingFromFrame: onSessionProcessing`。
- 上游：`onSteerOutcome: handleSteerOutcome`。

**上下文**：这些全是**可选参数**，缺一个不会编译失败，只会让功能静默失灵：本地的五个撑起 btw 抽屉的权限隔离（侧问的审批请求不能渲染到主会话横幅）、抽屉被服务端回收后的自愈、重载后订阅 ack 的恢复判定；上游的 `onSteerOutcome` 是 `steering`（运行中插话）卡片的落定信号（`accepted` / `refused` / `delivered`，见 `useChatRealtimeHandlers.ts` 中的使用点）。合并后的 hook 参数类型两侧都已存在（见 099–103）。

**建议**：**并集**，六个全留。`onSessionProcessingFromFrame: onSessionProcessing` 与上面已有的 `onSessionProcessing` 看似重复，但一个走"帧驱动的处理态"、一个走正声明回调，本地注释解释过用途，不要合并。

### 086 · `src/modules/chat/ChatInterface.tsx` 第 5 块（L760）· C · **取上游 hook + 补回本地的两个例外（IME 组合态、btw 抽屉）**

**冲突块**：全局 Escape 中止当前轮。
- 本地：内联 `useEffect` + `document.addEventListener('keydown', …, { capture: true })`，例外只有三条：`event.repeat`/`defaultPrevented`、**IME 组合态**（`isImeKeyEvent`，否则拼音候选的 Esc 会把用户的话打断）、**焦点在 btw 抽屉内**（`sideAskOpen && isInsideSideAskDrawer(event.target)`，抽屉自己拥有 Esc，"关面板"不能被理解成"停掉被旁观的轮次"）。
- 上游：抽出 `useEscapeToAbortSession({ canAbortSession, onAbortSession, composerRef })`，例外换成两条：焦点在**除 composer 以外的文本输入**（内联重命名、终端、编辑器）→ 不中止；页面上存在 `ESCAPE_LAYER_SELECTOR`（`[data-escape-layer]`, `[aria-modal="true"]`, `[role="menu"]`）→ 不中止。

**上下文**：**两者互有对方没有的例外**，谁全取谁都会退回一个已修的 bug：
- 只取上游 → **CJK 用户按 Esc 选拼音会直接中止当前轮**（`useEscapeToAbortSession.ts` 里没有任何 IME 判断）；且 btw 抽屉里按 Esc 会停掉主会话的轮次。
- 只取本地 → 在内联重命名输入框里按 Esc 会中止当前轮；打开中的菜单/模态也挡不住（这是上游这条 hook 明确修掉的问题，注释里写了"rename input calling stopPropagation cannot shield its Escape"）。

**建议**：**取上游 hook，并加一个"额外例外"回调**，把本地两条判断传进去：

```ts
// ChatInterface.tsx
useEscapeToAbortSession({
  canAbortSession,
  onAbortSession: handleAbortSession,
  composerRef: textareaRef,
  isEscapeReserved: (event) =>
    isImeKeyEvent(event) || (sideAskOpen && isInsideSideAskDrawer(event.target)),
});
```

```ts
// useEscapeToAbortSession.ts（这是上游新增、本轮无冲突的文件，需手工加一行参数）
type UseEscapeToAbortSessionArgs = {
  canAbortSession: boolean;
  onAbortSession: () => void;
  composerRef: RefObject<HTMLTextAreaElement>;
  /** Extra places where Escape means something else for this page. */
  isEscapeReserved?: (event: KeyboardEvent) => boolean;
};
// useEffect 内，排在默认三条判断之后：
if (isEscapeReserved?.(event)) return;
```

`isImeKeyEvent` 已在 L15 从 `@/shared/utils` 导入，`isInsideSideAskDrawer` 就在本文件 L98，无需新增依赖。副作用数组补 `isEscapeReserved` 不必——它是内联箭头，交给人留意即可；若 lint 报 `exhaustive-deps`，把回调提到 `useCallback` 再入依赖。

### 087 · `composer/ChatComposer.tsx` 第 1 块（L14）· A · **并集（两套图标都要）**

**冲突块**：`lucide-react` 图标导入。
- 本地：`PaperclipIcon, MessageSquareIcon, Loader2, ArrowUpIcon, PencilIcon`。
- 上游：`EraserIcon, PaperclipIcon, MessageSquareIcon, XIcon, Loader2, PencilIcon`（无 `ArrowUpIcon`，多 `EraserIcon`、`XIcon`）。

**上下文**：合并文件里 **7 个图标全部有引用**（`ArrowUpIcon` 2 处、`EraserIcon` 2 处为上游"清除上下文"按钮、`XIcon` 2 处为上游"清空输入"按钮）。本地独有的是发送按钮的箭头图标。

**建议**：**并集**：
```ts
import { ArrowUpIcon, EraserIcon, Loader2, MessageSquareIcon, PaperclipIcon, PencilIcon, XIcon } from 'lucide-react';
```

### 088 · `composer/ChatComposer.tsx` 第 2 块（L23）· A · **并集（本地三类型 + 上游 `PendingSteer`）**

**冲突块**：`@/shared/types` 的导入。
- 本地：`… QueuedDraft, QuickReply, ScheduledMessage …`（另有 `LLMProvider`）。
- 上游：`… PendingSteer, QueuedDraft, ScheduledMessage …`。

**上下文**：`ComposerAttachmentUpload`、`QuickReply`、`LLMProvider`（本地，QuickReplyMenu 与 token 行用）、`PendingSteer`（上游 steering 卡片用，合并文件里 3 处引用）都要留。

**建议**：**并集**，一行导入里合并：
```ts
import type { BackgroundSendChoice, BackgroundSendPrompt, ComposerAttachmentUpload, QueuedDraft, PendingSteer, QuickReply, ScheduledMessage, SlashCommand, SessionActivity, PendingPermissionRequest, PermissionMode, ProviderModelOption, LLMProvider } from '@/shared/types';
```

### 089 · `composer/ChatComposer.tsx` 第 3 块（L51）· A · **并集（`QuickReplyMenu` 与 `ComposerSendMenu` 是两个不同控件）**

**冲突块**：本地 `import QuickReplyMenu from '@/modules/chat/composer/QuickReplyMenu'` vs 上游 `import ComposerSendMenu from '@/modules/chat/composer/ComposerSendMenu'`。

**上下文**：两者都在合并文件里被渲染（各 2 处引用）：
- `QuickReplyMenu`（本地）：footer 左侧工具区里的快捷回复菜单，`onSend={onSendQuickReply}`；
- `ComposerSendMenu`（上游）：发送按钮在有输入且处于运行/后台状态时替换成"队列 / 插话 / 旁问 / 发送"菜单（`onSendMenuChoice`、`supportsSteering`、`supportsSideQuestions`）。
`ComposerSendMenu.tsx` 已被 git 作为上游新文件加入（`git status` 里是 `A`）。

**建议**：**并集**，两个 import 都留。

### 090 · `composer/ChatComposer.tsx` 第 4 块（L410）· C · **结构冲突：以本地骨架为准，插入上游的 steer 卡片与提问态 token 行**

**冲突块**：输入区外层容器与并列区块，两侧的 DOM 结构不同，**不是加几行能解决的**。
- 本地：`<div className="relative mx-auto max-w-[60.5rem]">` → 绝对定位的 ActivityIndicator（顶部有长注释解释为什么不用 shell 宽度）+ `{queuedDraft && <QueuedMessageCard/>}` → `{!hasQuestionPanel && <div className="relative">…下拉/CommandMenu/PromptInput…}`。
- 上游：无外层容器，直接 `pendingSteers.map(<SteeredMessageCard/>)` → `{queuedDraft && <QueuedMessageCard/>}` → `{hasQuestionPanel && <div className="mx-auto flex max-w-[54.25rem] justify-end"><TokenUsageSummary/></div>}` → `{!hasQuestionPanel && <div className="relative mx-auto max-w-[54.25rem]">…}`。

**上下文**：冲突之后的尾巴（L476 起）是**本地**的收尾（`</div> )}`、`{queuedDraft && …}`、`{!hasQuestionPanel && <div className="relative">`），所以现状等于"上游的头部 + 本地的尾部"，会渲染出**两个队列卡片、两层未闭合的 div、两套最大宽度**。必须手工重排。另外上游这一侧引用了 `TokenUsageSummary`——**本 fork 没有这个文件，而且合并结果里连 import 都没有**：本地在 `c4c9c622 feat(chat): 输入框下方展示 token 统计行` 里把 `TokenUsageSummary.tsx` 换成了 `TokenStatsLine.tsx`，上游本轮没碰这个文件，于是 import 段按本地版本合入（只有 `import TokenStatsLine from …TokenStatsLine'`，L43），而上游的 JSX 引用散落在冲突块**之外**的两处（合并结果 L442、L718）被原样保留。所以 `tsc` 报的是 **`Cannot find name 'TokenUsageSummary'`（不是 `Cannot find module`）**——这两处必须改成 `TokenStatsLine`，并补齐它要求的 `provider` 属性（`TokenStatsLine.tsx` 的 props 是 `{ usage, provider, onShowDetails }`，没有 `onClick`）。

**建议**：**以本地骨架为准重排**，插入上游两段：

```jsx
<div className="relative mx-auto max-w-[60.5rem]">
  {/* 本地注释 + 活动指示条，原样保留 */}
  {!hasPendingPermissions && (
    <div className="pointer-events-none absolute bottom-full left-0 right-0 z-10 translate-y-[var(--activity-tab-overlap)] bg-transparent">
      <ActivityIndicator activity={activity} onAbort={onAbortSession} isInputFocused={isInputFocused} />
    </div>
  )}

  {pendingSteers.map((steer) => (
    <SteeredMessageCard key={steer.messageId} steer={steer} providerLabel={providerLabel} />
  ))}

  {queuedDraft && (
    <QueuedMessageCard content={queuedDraft.content} … />
  )}

  {/* 提问面板顶掉输入框时，token 用量仍然要能看到（上游的用例 questionPanelTokenUsage 在守这条） */}
  {hasQuestionPanel && (
    <div className="mx-auto flex max-w-[60.5rem] justify-end">
      <TokenStatsLine usage={tokenBudget} provider={provider} onShowDetails={onShowTokenUsage} />
    </div>
  )}

  {!hasQuestionPanel && <div className="relative">
    …本地原有的文件下拉、CommandMenu、PromptInput…
```

要点：
1. **删掉上游侧那段重复的 `queuedDraft`**（本地尾部已经有一份）。
2. 上游的 `max-w-[54.25rem]` 一律不要——本地外层已经是 60.5rem，且注释解释了宽度必须跟输入列一致（否则有滚动条时会偏移）。
3. `TokenUsageSummary` → **`TokenStatsLine`**，三处一起改：本冲突块内的提问态那行（`usage` / `provider` / `onShowDetails`），以及**冲突块之外**被原样保留下来的两处（合并结果 L442、L718，它们是上游在别的分支里引用的 `TokenUsageSummary usage={tokenBudget} onClick={onShowTokenUsage}`，改法是 `usage={tokenBudget} provider={provider} onShowDetails={onShowTokenUsage}`）。两者都渲染 `formatTokenCount(usedTokens)` 且 `aria-label` 同为 `t('chat:misc.showTokenUsage')`，所以上游那个 `questionPanelTokenUsage.test.tsx` 依然能通过（`42_000` → `42K`，且无提问时页面上只有一个这样的按钮——因为输入框下方那行在提问态是 `{!hasQuestionPanel && …}` 里）。漏改 L442/L718 任意一处，`tsc` 都停在 `Cannot find name 'TokenUsageSummary'`。
4. 拼接后数一遍 `</div>`：本地骨架 = 外层 div + 内层 div 各一个闭合；上游那两段是插入到内层 div **之前**的并列节点，不新增嵌套层级。

### 091 · `composer/ChatComposer.tsx` 第 5 块（L707）· C · **取本地（页脚提示行），把上游的"清除上下文"按钮挪进工具区**

**冲突块**：`PromptInputFooter` 末尾。
- 本地：一个 `basis-full` 的提示行 `<div className={…opacity…}>`，结尾在冲突区外的 L737–739（`>` `{parkedSendLabel ?? submitHint}` `</div>`）。注释解释了它存在的理由：**输入时不显示提示，于是上传慢的时候桌面端只有按钮里一个转圈，看起来像卡死**。
- 上游：`<TokenUsageSummary …/>` + `onClearContext && (<PromptInputButton …><EraserIcon/></PromptInputButton>)` + 一个 **重复的** `showAllCommands` 按钮开头（`className="relative"`，但它的 `>`、内容、闭合都被本地那段尾巴占用了）。

**上下文**：上游这一侧在合并结果里是**结构破损**的——它把 `PromptInputButton` 开在冲突里、却指望冲突外的 `>` + `{parkedSendLabel ?? submitHint}` + `</div>` 收尾，那三个 token 是本地提示行的。而 `showAllCommands` 按钮在自动合并的 L610–630 里**已经有一份完整的**（带 `slashCommandsCount` 徽标），这里再来一份就是重复按钮。`TokenUsageSummary` 在本 fork 不存在（见 090），不能保留。

**建议**：
1. `PromptInputFooter` 末尾**取本地**（提示行原样，连同 L737–739 的收尾）。
2. 把上游的"清除上下文"按钮**搬进 `PromptInputTools`**，位置放在 `QuickReplyMenu` 之后、`showAllCommands` 按钮之前：
```jsx
{onClearContext && (
  <PromptInputButton
    tooltip={{ content: t('misc.clearContext') }}
    onClick={onClearContext}
    disabled={isLoading}
    aria-label={t('misc.clearContext')}
  >
    <EraserIcon />
  </PromptInputButton>
)}
```
3. **不要**再插一份 `showAllCommands`；**不要**在页脚放 `TokenUsageSummary`（token 行由 092 的 `TokenStatsLine` 承担）。

### 092 · `composer/ChatComposer.tsx` 第 6 块（L743）· C · **取本地收尾 + 把上游两件事补进来（清空输入按钮、`ComposerSendMenu`）**

**冲突块**：`</PromptInput>` 之后。本地只剩三样：`<TokenStatsLine …/>`、`</div>}`（关 `{!hasQuestionPanel && <div className="relative">`）、`</div>`（关外层）。上游这一侧把**整个页脚 + 菜单 + 发送按钮**又写了一遍（`clear-input` 的 X 按钮、`PromptInputTools` 闭合、`ml-auto` 右侧三菜单、`ComposerSendMenu`/`PromptInputSubmit` 二选一、提示行、`</PromptInputFooter>`、`</PromptInput>`、`</div>}`）。

**上下文**：这些在合并文件里**已经有本地的一份**（L610–705）。所以上游这一侧整段都是重复内容，直接保留会渲染两套菜单、两套发送按钮。上游真正新增的只有两件东西：
1. **清空输入的 X 按钮**（`hasInput && <PromptInputButton onClick={onClearInput}><XIcon/></PromptInputButton>`，`hidden sm:flex`）；
2. **`ComposerSendMenu`**：轮次进行中（或后台工作中）且输入框有内容时，发送键变成"队列 / 插话 / 旁问 / 发送"菜单，`stop` 走 `onAbortSession`，其余走 `onSendMenuChoice`。
另外上游 `PromptInputSubmit` 的 `disabled` 判断里引用了 `canAbortSession`、`isTranscribing`，本地版本则另有 `isSubmitting`、`canQueueDraft`、`parkedSendLabel`、`ArrowUpIcon`——两套语义不同，不能直接用上游那版覆盖。

**建议**：

1. **收尾取本地**：`<TokenStatsLine …/>` + `</div>}` + `</div>`，其余上游内容全部删除。
2. **X 按钮**插到本地 `PromptInputTools` 的 `</PromptInputTools>`（L634）之前，放在 `QuickReplyMenu` 之后：
```jsx
{hasInput && (
  <PromptInputButton
    tooltip={{ content: t('input.clearInput', { defaultValue: 'Clear input' }) }}
    onClick={onClearInput}
    className="hidden sm:flex"
  >
    <XIcon />
  </PromptInputButton>
)}
```
3. **`ComposerSendMenu`** 插到本地 `ml-auto` 容器里、`PromptInputSubmit`（L661）之前，用上游的条件包住，`else` 分支**不能原样放本地那版 submit**——本地 `disabled` 写的是 `isLoading ? false : …`（"运行中永远可点"），而上游本轮刚修掉这个问题。必须把 `PromptInputSubmit` 换成"本地骨架 + 上游的转录/不可中止分支"，`disabled` 的判定顺序按下面的优先级重排（`canQueueDraft` 必须排在 `isLoading` 之前，否则有输入时排队键会被当成 Stop 禁用）：
```jsx title=ChatComposer.tsx - 发送键二选一
{(isLoading || activity?.background) && hasAnyInput && !isRecording && !isTranscribing ? (
  <ComposerSendMenu
    state={isLoading ? 'responding' : 'background'}
    hasInput={hasAnyInput}
    hasText={Boolean(input.trim())}
    canAbortSession={canAbortSession}
    supportsSideQuestions={supportsSideQuestions}
    supportsSteering={supportsSteering}
    sendByCtrlEnter={sendByCtrlEnter}
    onSelect={(choice) => {
      if (choice === 'stop') { onAbortSession(); return; }
      onSendMenuChoice?.(choice);
    }}
  />
) : (
  <PromptInputSubmit
    onClick={
      isTranscribing
        ? undefined
        : canQueueDraft
          ? (e: MouseEvent<HTMLButtonElement>) => { e.preventDefault(); onSubmit(e); }
          : isLoading
            ? onAbortSession
            : isRecording
              ? (e: MouseEvent<HTMLButtonElement>) => { e.preventDefault(); voiceStop({ send: true }); }
              : undefined
    }
    disabled={
      isTranscribing ? true
        : isSubmitting ? true
        : canQueueDraft ? false
        : isLoading ? (!isRecording && !canAbortSession)
        : isRecording ? false
        : !input.trim() && attachedFiles.length === 0
    }
    aria-label={parkedSendLabel ?? submitAriaLabel}
    title={parkedSendLabel ?? submitAriaLabel}
    className="h-10 w-10 sm:h-10 sm:w-10"
  >
    {isTranscribing || isSubmitting
      ? <Loader2 className="h-4 w-4 animate-spin" />
      : canQueueDraft
        ? <ArrowUpIcon />
        : undefined}
  </PromptInputSubmit>
)}
```
   为什么不能照抄本地：`chatComposerSendMenu.test.tsx` 有两处会红——`turn running, composer empty, cannot be interrupted` 断言一键 Stop **必须 disabled**（本地恒可点），`turn running, transcribing` 断言 `name: 'Send'` 且 disabled（本地在 `isLoading` 下会算成 `Queue next message` 且不禁用）。另外合并现场已在 L77/L178 自动合入 `canAbortSession`，submit 块若整段取本地，它就只剩解构、没有使用点，`oxlint` 报 unused。
4. **必须给 `ChatComposerProps` 补上两个可选 props**：`hasInput?: boolean` 与 `onClearInput?: () => void`。上游新增的两个测试（`src/modules/chat/tests/questionPanelTokenUsage.test.tsx`、`chatComposerSendMenu.test.tsx`）在构造 props 时**显式传了 `hasInput` / `onClearInput`**，而合并后的 props 类型里没有它们——`npx tsc --noEmit` 会在测试文件处报多余属性。补上类型后，再在 `useChatComposerState` 里给出真实实现（它本来就持有 `input` / `setInput`）：
```ts title=useChatComposerState.ts - 新增两个 props
hasInput: Boolean(input.trim() || attachedFiles.length > 0),
onClearInput: () => setInput(''),
```
   注意 `hasInput` 是"文本**或**附件"（`ComposerSendMenu.tsx:23-25` 的契约），按 `Boolean(input.trim())` 写会让"只拖了附件"的运行中会话退回普通发送键、拿不到 Send options 菜单。`hasText` 仍由 `ChatComposer` 内部用 `Boolean(input.trim())` 传给菜单（旁问不能带附件），不要复用 `hasInput`。最后要由 `ChatInterface` 传给 `<ChatComposer />`；否则按钮永远不显示（测试仍能过，但功能是死的）。

### 093 · `composer/ComposerMenuPrimitives.tsx` 第 1 块（L69）· A · **并集（只差注释：把两侧的使用者都写进去）**

**冲突块**：`ComposerMenuItem` 的 JSDoc。
- 本地：`Used by chat's ScheduleMessagePopover, ComposerModelMenu, ComposerPermissionMenu and QuickReplyMenu …`。
- 上游：`… ComposerModelMenu and ComposerPermissionMenu …, and by ComposerSendMenu for rows that can be disabled or need the destructive (Stop / Send anyway) styling.`

**上下文**：实现体是自动合并的，`disabled` / `destructive` 两个可选参数已在签名里（上游新增，本地三个调用方默认不传）。合并后的实际使用者是两侧之和：`ScheduleMessagePopover`、`ComposerModelMenu`、`ComposerPermissionMenu`、`QuickReplyMenu`（本地）+ `ComposerSendMenu`（上游）。

**建议**：**并集**，注释写成：
```
Used by chat's ScheduleMessagePopover, ComposerModelMenu, ComposerPermissionMenu and
QuickReplyMenu to render one selectable row with its checked state, and by
ComposerSendMenu for rows that can be disabled or need the destructive
(Stop / Send anyway) styling.
```
代码一行都不用改。

**执行前顺手核对一次（30 秒，避免"自绘菜单忽然不工作"）**：`grep -rn "ComposerMenuItem" src/` 后按行分类，除声明文件 `ComposerMenuPrimitives.tsx` 外应**恰好命中 5 个文件**：`ComposerSendMenu.tsx`（上游，4 处使用 + 1 处 import，唯一带 `disabled`/`destructive` 的消费者）、`ComposerModelMenu.tsx`（3+1）、`ComposerPermissionMenu.tsx`（1+1）、`QuickReplyMenu.tsx`（1+1）、`ScheduleMessagePopover.tsx`（1+1）。若出现第 6 个文件，说明并集注释要再补一句；若 `ComposerSendMenu` 缺失，说明 092 的菜单没插进去（那份 `ComposerMenuItem` 就只有本地四个使用者，注释里的"destructive styling"是死话）。

### 094 · `hooks/useChatComposerState.ts` 第 1 块（L16）· A · **并集，但上游那两个工具函数导入是多余的（本地已抽成共享 util）**

**冲突块**：`@/shared/types` 与两条工具导入。
- 本地：类型里多 `ComposerAttachmentUpload`、`QuickReply`。
- 上游：类型里多 `PendingSteer`、`SteerOutcome`，并新增两行 `import { PROVIDER_PERMISSION_PREFERENCE_KEYS } from '@/shared/constants'`、`import { readUserPreference } from '@/shared/userSettings'`。

**上下文**：类型四个都要（`ComposerAttachmentUpload`/`QuickReply` 给本地上传与快捷回复，`PendingSteer`/`SteerOutcome` 给上游插话卡片，合并文件里 `PendingSteer` 出现在 L432/1077/2092，`SteerOutcome` 在 L1134）。但**那两条 import 在合并文件里没有任何使用点**：上游引入它们是为了在自己内联的 `buildSendOptions` 里读 `toolsSettings`/`skipPermissions`（上游 L749），而本地版本把这段抽成了 `@/modules/chat/utils/sendOptions` 的 `buildChatSendOptions`（合并文件 L829 调用它，那个 util 内部自己 import 了这两个符号，见 `sendOptions.ts:1-3`）。

**建议**：**类型并集，工具导入删掉**：
```ts
import type { BackgroundSendChoice, BackgroundSendPrompt, CommandModalPayload, ComposerAttachmentUpload, CostCommandData, HelpCommandData, MarkSessionProcessing, ModelCommandData, PendingSteer, QueuedDraft, QuickReply, SessionActivityMap, StatusCommandData, SteerOutcome, QueuedSendOptions, ChatAttachment, ChatMessage, PendingPermissionRequest, PermissionMode, SessionEstablishedContext, Project, ProjectSession, LLMProvider, SlashCommand } from '@/shared/types';
```
留着会触发 `oxlint` 的 unused-import。**功能上没有损失**：`buildChatSendOptions` 已经包含 `toolsSettings` 与 `skipPermissions`（同一份 `readUserPreference` 逻辑），而且主输入框与 btw 抽屉共用它——这正是本地那条注释说的"两处不能各写一份"。

### 095 · `hooks/useChatComposerState.ts` 第 2 块（L41）· A · **并集（本地附件上传 hook + 上游侧问 hook）**

**冲突块**：本地 `composerAttachmentKey, useComposerAttachmentUploads`（`@/modules/chat/hooks/useComposerAttachmentUploads`）vs 上游 `useAskSideQuestion`（`@/modules/chat/hooks/useSideQuestions`）。

**上下文**：两者在合并文件里都紧跟着被调用：`useComposerAttachmentUploads(...)` 在 L323（本地上传进度/失败状态），`useAskSideQuestion(sendMessage)` 在 L359（上游旁问，`askSideQuestionAndClear` 里用）。本地的 `composerAttachmentKey` 另有 6 处使用（L192/736/759/762/1628/2073）。

**建议**：**并集**，两个 import 都留。

> 与 D17 联动：若 D17 选丙（后端两套并存、前端只留 btw 抽屉），`useAskSideQuestion` 的调用与 import 要一并删掉（连同 `askSideQuestionAndClear` 那条路径），否则 `oxlint` 报 unused；此时 092 的 `supportsSideQuestions` 由上层恒传 false，`ComposerSendMenu` 的旁问行自然不渲染，组件本身不用改。

### 096 · `hooks/useChatComposerState.ts` 第 3 块（L85）· B · **并集，`scrollToBottom` 换成 `scrollToLatest`**

**冲突块**：`UseChatComposerStateArgs` 的回调参数。
- 本地：`scrollToLatest: () => void`（注释说明由 `useChatSessionState` 拥有：清掉阅读者的"停在上面"状态并把底部钉住，直到新几何稳定）。
- 上游：`onClearContext?: () => void`（输入框里敲 `/clear` 时调用）+ `scrollToBottom: () => void`。

**上下文**：合并文件里 `onClearContext?.()` 在 L496（上游的 `/clear` 命令处理分支）**被真实调用**，必须留；`scrollToLatest()` 在 L1501（本地发送后的回滚到底部）被调用；`scrollToBottom` 只有声明与解构（L95/L270），**没有任何使用点**——上游其余的调用点都落在本地接管的那段逻辑里。

**建议**：
```ts
onClearContext?: () => void;
/** 本地：发送后回到尾部，清掉阅读者的 stand-down 并重新钉住底部。 */
scrollToLatest: () => void;
```
删掉 `scrollToBottom`。若想让上游语义完整，也可两个都声明、让 `scrollToBottom = scrollToLatest`，但没有调用方，属于多余 API。

### 097 · `hooks/useChatComposerState.ts` 第 4 块（L266）· B · **同 096：解构里取 `scrollToLatest` + `onClearContext`**

**冲突块**：函数参数解构。
- 本地：`scrollToLatest,`
- 上游：`onClearContext,` + `scrollToBottom,`

**上下文**：与 096 是同一处分歧的解构侧。`onClearContext` 在 L496 被调用（`/clear`），`scrollToLatest` 在 L1501 被调用。少解构任何一个 → 该处 `Cannot find name`。

**建议**：
```ts
  onClearContext,
  scrollToLatest,
```
并把作用域外的 `scrollToBottom` 一并去掉（见 096）。

### 098 · `hooks/useChatComposerState.ts` 第 5 块（L1547）· C · **取本地（发送后清空附件列表，且注释说明为什么不能取消上传）**

**冲突块**：发送成功后清理 composer 状态的两行。
- 本地：`// The uploads were released above as sent: clearing the composer must not cancel or delete files the transcript now references.` + `setAttachedFiles([]);`
- 上游：空。

**上下文**：上面几行（L1531）已经有 `setAttachedFiles((files) => files.filter((file) => !currentAttachments.includes(file)))`——那是"只移除本次发出的"。本地再补一个 `[]` 是**本轮同步之前就存在的本地行为**：发送流程已经把上传"作为已发送释放"（`attachmentUploads` 的 release），此时若 composer 还留着条目，后续 `setAttachedFiles` 触发的清理会取消/删除 transcript 正在引用的文件。注释写的就是这个理由。上游没有这套"发送即释放"的上传生命周期，所以它不需要这行。

**建议**：**取本地**，两行都保留。若只留上游（即删掉 `setAttachedFiles([])`），后果是同一次发送里剩下的附件（例如上传期间新加的）会继续留在 composer 并参与下一轮生命周期，可能把已发送文件的 blob 取消掉——这是本地早就修过的 bug，别退回去。

### 099 · `hooks/useChatRealtimeHandlers.ts` 第 1 块（L4）· A · **并集，但上游的 `showCompletionTitleIndicator` 变成孤儿导入**

**冲突块**：文件头导入。
- 本地：`showCompletionIndicator, showFailureIndicator`（`@/shared/favicon`）、`playChatCompletionSound, playNotificationSound, triggerNotificationHaptic`（`@/shared/utils`）。
- 上游：`showCompletionTitleIndicator`（`@/modules/chat/utils/pageTitleNotification`），类型里多 `SideQuestionEvent, SteerOutcome`。

**上下文**：
- 类型两个都要（`SideQuestionEvent` 在 L448 的 `side_question` 分支，`SteerOutcome` 在 args 类型）。
- 本地的五个函数也都在用（L594 favicon、L597/L621 触觉反馈、L599 失败图标、音频提示）。
- 上游的 `showCompletionTitleIndicator` **只在导入行出现**：它唯一调用点在合并时被本地的完成通知块替换掉了（本地用 favicon 指示 + 触觉 + 声音，是更完整的一套）。留着是 `oxlint` 的 unused-import。

**建议**：**类型并集 + 本地五个函数保留 + 删除 `showCompletionTitleIndicator` 导入**。如果评审希望把"页面标题指示"也保留（切到别的标签页时标题变化），那是新功能，应在本地的完成通知块里**额外**调用一次，而不是靠这个导入存在与否。

### 100 · `hooks/useChatRealtimeHandlers.ts` 第 2 块（L96）· A · **并集（本地 btw 五个参数 + 上游 `onSteerOutcome`）**

**冲突块**：`UseChatRealtimeHandlersArgs` 尾部。
- 本地：`sideAskSessionId?`、`setSideAskPermissionRequests?`、`onSideAskSessionGone?`、`onSideAskSubscribed?`、`onSessionProcessingFromFrame?`（每个都带解释性注释）。
- 上游：`onSteerOutcome?`。

**上下文**：全是可选参数（见 085 的同类提醒：漏一个不会编译失败，只会静默丢功能）。合并文件里本地五个参数在 hook 体内都有取值点（`sideAskSessionId` 用于订阅与权限分流、`onSideAskSubscribed` 处理订阅 ack、`onSideAskSessionGone` 处理 `session_deleted`），上游的 `onSteerOutcome` 在 L184/194/325 三处被调用（`accepted`/`refused`/`delivered`）。

**建议**：**并集**，六个全留。上游那条注释要保留——它解释了 `delivered` 为什么对**每条** live user message 都发（不只是插话），这是卡片能落定的关键。

### 101 · `hooks/useChatRealtimeHandlers.ts` 第 3 块（L173）· A · **并集（解构：五个本地 + 一个上游）**

**冲突块**：函数参数解构。
- 本地：`sideAskSessionId, setSideAskPermissionRequests, onSideAskSessionGone, onSideAskSubscribed, onSessionProcessingFromFrame,`
- 上游：`onSteerOutcome,`

**建议**：**并集**，六个全解构。与 100 一一对应；`ChatInterface` 侧已在 085 传入。

### 102 · `hooks/useChatRealtimeHandlers.ts` 第 4 块（L428）· A · **并集（`attachment_missing` 与 `side_question` 两个新 kind 并存）**

**冲突块**：`switch (msg.kind)` 里的两个新分支，各占一边。
- 本地：`case 'attachment_missing'` —— 附件在本轮启动前被回收时，往 transcript 追加一条 `error` 行（"Attachment no longer available: …"），让回复缺少图片这件事可见。它是服务端 075 里 `run.writer.send({kind:'attachment_missing', …})` 的消费端。
- 上游：`case 'side_question'` —— 侧问事件直接进 `sideQuestionStore.applyEvent(msg)`，**永不落到下面的消息处理**。

**上下文**：两侧共用紧随其后的 `return; }`。两个 kind 是完全不同的消息域（transcript 行 vs 侧问 store），互不影响。合并后 `attachment_missing` 的生产者是本地的 `chat-websocket.service.ts`（075），`side_question` 的生产者是上游的侧问路由。

**建议**：**并集**，两个 case 依次排列、各自 `return`：
```ts
case 'attachment_missing': {
  …sessionStore.appendRealtime(…)…
  return;
}
case 'side_question': {
  sideQuestionStore.applyEvent(msg as unknown as SideQuestionEvent);
  return;
}
```
注意保持本地 `case` 的块级 `{}`（里面有 `const` 声明，不加块会与相邻 case 冲突）。

### 103 · `hooks/useChatRealtimeHandlers.ts` 第 5 块（L752）· A · **并集（订阅回调的依赖数组）**

**冲突块**：`useEffect` 的依赖数组末尾。
- 本地：`onSideAskSessionGone,`
- 上游：`onSteerOutcome,`

**上下文**：该 useEffect 负责挂/解 websocket 监听，依赖变化会重建监听。`onSideAskSessionGone` 是本地抽屉自愈回调，`onSteerOutcome` 是上游插话卡片落定回调，都必须在依赖里，否则闭包里拿到的是旧引用（表现为回调失效或行为回退到首帧）。

**建议**：**并集**，两项都加：
```ts
    onSideAskSessionGone,
    onSteerOutcome,
```
`react-hooks/exhaustive-deps` 也会替你检查：漏谁就报谁。

### 104 · `hooks/useChatSessionState.ts` 第 1 块（L2444）· C · **取本地依赖数组，删掉上游新加的 `loadFullTranscript`（在合并结果里是死代码）**

**冲突块**：`loadAllMessages` 那个 `useCallback` 的收尾。
- 本地：`}, [armScrollRestore, isActive, selectedSession, selectedProject, isLoadingAllMessages, currentSessionId, sessionStore, setIsUserScrolledUp]);` —— 多两个依赖（`armScrollRestore`、`setIsUserScrolledUp`）。
- 上游：少这两个依赖，并在其后新增 `loadFullTranscript()`：把整条 transcript `fetchFromServer({limit:null, offset:0})` 拉进 store 并原样返回（注释："导出需要全部消息，屏幕不需要；这样导出一个长会话不会再只导出最后一页"）。

**上下文**：
1. 依赖数组取本地——`armScrollRestore` 与 `setIsUserScrolledUp` 在本地的 `loadAllMessages` 里被引用（前者在 L2461 的 `loadEarlierMessages` 与滚动恢复路径里出现），漏掉会拿到陈旧闭包。
2. `loadFullTranscript` 在合并文件里**只有定义（L2457）、没有任何调用点**：上游是在自己 hook 的返回对象里导出它（上游 L1185），再给上游的导出/分享流程用；而本地的返回对象（L2540–2558）是本地版本，没有它，`ChatInterface` 的导出走的是本地 `downloadTranscriptExport` + `chatMessages` + `wholeTranscriptLoaded`/`isExcerpt` 那套（"只有部分历史时明确标为节选"）。

**建议**：**依赖数组取本地；`loadFullTranscript` 整段删掉**（本轮保持最小面）。留着是未使用函数，`oxlint` 会报 `no-unused-vars`，而且它把 `t('sideQuestion.failed')` 的 `mergeSideQuestions` 依赖也一起带进来，容易让人误以为导出路径已经切换。

> 如果亮希望采纳上游"导出前强制拉全量"的做法，那就不是合并问题而是功能改动：把 `loadFullTranscript` 加进返回对象，并让 `ChatInterface` 的导出/分享在 `!wholeTranscriptLoaded` 时先 `await loadFullTranscript()`——本地现有的"节选"标记可以保留作为兜底。

### 105 · `hooks/useSessionStore.ts` 第 1 块（L14）· A · **并集（类型 4 个 + 三个工具函数）**

**冲突块**：文件头导入。
- 本地：类型 `SessionMessagesRequestOptions, StreamChannel, StreamingChannelUpdate, TurnHistoryPageInfo`；工具 `removeOptimisticUserEchoes, reportDuplicateServerIds, upsertRealtimeMessages`（`sessionMessageReconciliation`）。
- 上游：类型只有 `LLMProvider, NormalizedMessage`；工具 `removeOptimisticUserEchoes`（同名）+ `sideQuestionStore`（`useSideQuestions`）。

**上下文**：逐个统计引用次数，**全部仍有使用**：`SessionMessagesRequestOptions` 5 处（本地分页/游标请求参数）、`StreamChannel`/`StreamingChannelUpdate` 各 2 处（本地流通道模型）、`TurnHistoryPageInfo` 4 处（本地 turn 分页元数据）、`reportDuplicateServerIds` 2 处、`upsertRealtimeMessages` 3 处（本地实时消息合并与去重）、`sideQuestionStore` 2 处（上游侧问 store，`dropSession` 与侧问合并用）、`removeOptimisticUserEchoes` 4 处（两侧共有的乐观回声清理）。

**建议**：**并集**：合并成一个 `@/shared/types` 的 type import（5 个），保留 `sessionMessageReconciliation` 的三个函数与 `sideQuestionStore`。

### 106 · `chat/tests/mcpElicitationPanel.test.tsx` 第 1 块（L339）· B · **取本地（Codex 工具审批的两条本地用例，上游没有）**

**冲突块**：文件末尾，本地独有两段测试、上游为空（这个文件两侧都新建，属 AA 冲突，前面内容已自动合并）。

- `Codex's tool approval is written by the panel, not shown as its English message`：当 `input.approvalKind === 'mcp_tool_call'` 时，面板**不再显示 Codex 生成的英文原句**（"Allow the elicit-demo MCP server to run tool \"ask_me\"?"），改用可本地化的文案（"Allow elicit-demo to run tool \"ask_me\"?"），且按钮是 Allow/Decline 而不是 Submit。
- `a tool approval without a parsed tool name still says what it is asking`：`toolName: null` 时退化为 "Allow elicit-demo to run this tool?"。

**上下文**：上面共享部分（L313–338 那个"长表单可滚动、按钮在滚动区外"的用例）两侧一致，已自动合并。这两条本地用例是 `McpElicitationPanel` 里 `approvalKind === 'mcp_tool_call'` 分支的守卫（见 107–120），也是本 fork 相对上游多出来的 Codex 审批语义。

**建议**：**取本地**，两段原样保留。它们是判断面板改造是否成功的验收线：若 107–120 的融合把本地那套主题 token/Codex 分支丢了，这两条会立刻红。

### 107 · `McpElicitationPanel.tsx` 第 1 块（L42）· B · **取本地（`ElicitationInput` 的 Codex 审批字段）**

**冲突块**：`ElicitationInput` 类型尾部，本地多 `approvalKind?: string` 与 `toolName?: string | null`（注释说明 `mcp_tool_call` 是 Codex 自己的"可以运行这个工具吗"确认，复用同一通道但没有字段，`message` 是 Codex 二进制里生成的英文）。

**上下文**：这个面板是本分支独有的实现（文件两侧都新建，AA）；上游版本不知道 Codex 的审批复用。106 的两条用例、以及本文件后面所有 `approvalKind === 'mcp_tool_call'` 分支都依赖这两个字段。

**建议**：**取本地**，连注释一起保留。

### 108 · `McpElicitationPanel.tsx` 第 2 块（L249）· C · **取本地（主题 token，不用硬编码灰色）**

**冲突块**：表单输入框的 `inputClassName`。
- 本地：`bg-muted`、`text-foreground`、`ring-border`、`placeholder:text-muted-foreground` —— 全部走本 fork 的主题 token。
- 上游：`bg-gray-50 text-gray-900 ring-gray-200 … dark:bg-gray-900/60 dark:text-gray-100 dark:ring-gray-700 …` —— 硬编码灰阶 + `dark:` 变体。

**上下文**：本 fork 有一整套主题系统（自定义主题、`bg-card`/`text-foreground` 等语义 token），本文件其余类名（如 L40 附近的 `text-foreground`、`bg-popover` 之类）也都已用 token。取上游会让这一个输入框在自定义主题下变成一块与周围不一致的灰色。

**建议**：**取本地**。这也是合并里反复出现的同类分歧：**凡是 `gray-50 / gray-900 / dark:gray-*` 这类硬编码，一律换成本地的主题 token**。

### 109 · `McpElicitationPanel.tsx` 第 3 块（L387）· B · **取本地（`isToolApproval` 判定）**

**冲突块**：`const isToolApproval = input.approvalKind === 'mcp_tool_call';`（本地）vs 空（上游）。

**上下文**：这一行是本文件后续三处分支的开关：L420 的文案替换（112）、L618 的按钮文案（120）。上游没有 Codex 审批语义，所以不需要。

**建议**：**取本地**。删掉它会让 112/120 里对 `isToolApproval` 的引用直接编译失败（当前它们都在 HEAD 侧，反之若取上游则必须同时删掉那两处引用）。

### 110 · `McpElicitationPanel.tsx` 第 4 块（L395）· C · **取本地（卡片容器：`border-border bg-card` 代替白/灰）**

**冲突块**：面板卡片容器。
- 本地：`rounded-2xl border border-border bg-card shadow-lg dark:shadow-2xl`
- 上游：`rounded-2xl border border-gray-200/80 bg-white shadow-lg dark:border-gray-700/50 dark:bg-gray-800/90 dark:shadow-2xl`

**上下文**：与 108 同因——本 fork 的主题 token 体系。`bg-card` 在浅色下等价于白、深色下是卡片色，且在自定义主题里跟随主题；`bg-white dark:bg-gray-800/90` 会把这块面板固定在灰度调色板上。`dark:shadow-2xl` 两侧一致，保留。

**建议**：**取本地**：`className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-lg dark:shadow-2xl"`。

### 111 · `McpElicitationPanel.tsx` 第 5 块（L407）· C · **取本地（小标题：`text-muted-foreground` 代替 `gray-400/500`）**

**冲突块**：`<span>` 小标题（"{{server}} asks for your input"）的文字色。
- 本地：`text-[10px] font-medium uppercase tracking-wide text-muted-foreground`
- 上游：`text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500`

**建议**：**取本地**。主题 token，理由同 108/110。

### 112 · `McpElicitationPanel.tsx` 第 6 块（L416）· C · **取本地（标题/正文/描述三项：主题 token + Codex 文案替换）**

**冲突块**：标题、正文、描述三行。
- 本地：`text-foreground` 系；正文是 `{isToolApproval ? (input.toolName ? t('chat:mcpElicitation.allowTool', …) : t('chat:mcpElicitation.allowToolUnnamed', …)) : input.message}`。
- 上游：`text-gray-700/300`、`text-gray-900/100` 系；正文恒为 `{input.message}`。

**上下文**：正文分支是 Codex 审批的核心——`input.message` 由 Codex 二进制生成英文，无法本地化，所以在工具审批场景换成带 `{{server}}`/`{{tool}}` 参数的翻译键；无工具名时退化为通用问句。106 的两条用例正是在断言这个替换。颜色部分同 108。

**建议**：**取本地**整段（含 `input.title` 的 `text-foreground`、正文的 `isToolApproval` 三目、`input.description` 的 `text-muted-foreground`）。注意括号闭合：本地这句以 `</p>` + `{input.description && (…)}` 收尾，上游同样结构但少一层三目，拼接后只能留一份。

### 113 · `McpElicitationPanel.tsx` 第 7 块（L449）· C · **取本地（URL 展示 `<code>` 用 `bg-muted text-foreground`）**

**冲突块**：URL 模式下的 `<code>`：
- 本地：`bg-muted … text-foreground`
- 上游：`bg-gray-100 … text-gray-700 dark:bg-gray-900/60 dark:text-gray-300`

**建议**：**取本地**。主题 token。

### 114 · `McpElicitationPanel.tsx` 第 8 块（L471）· C · **取本地（"optional" 标记色）**

**冲突块**：字段标签后 `({t('chat:mcpElicitation.optional')})` 的 `<span>`：
- 本地：`ml-1 font-normal text-muted-foreground`
- 上游：`ml-1 font-normal text-gray-400 dark:text-gray-500`

**建议**：**取本地**。主题 token。

### 115 · `McpElicitationPanel.tsx` 第 9 块（L485）· C · **取本地（checkbox 字段的 `<label>` 颜色）**

**冲突块**：布尔字段 `<label>`：
- 本地：`flex items-center gap-2 text-[13px] font-medium text-foreground`
- 上游：`… text-gray-800 dark:text-gray-200`

**建议**：**取本地**。主题 token。下面的 checkbox `input` 与 `{labelText}` 是共享内容，不动。

### 116 · `McpElicitationPanel.tsx` 第 10 块（L498）· C · **取本地（布尔字段描述文字色）**

**冲突块**：
- 本地：`{field.description && <p className="ml-6 text-[11px] text-muted-foreground">{field.description}</p>}`
- 上游：同结构，`text-gray-500 dark:text-gray-400`

**建议**：**取本地**。主题 token。

### 117 · `McpElicitationPanel.tsx` 第 11 块（L511）· C · **取本地（多选 `fieldset` 的 legend/描述/选项行）**

**冲突块**：`field.kind === 'multi'` 分支的头三行：
- 本地：`legend … text-foreground`、描述 `text-muted-foreground`、选项 `<label> … text-foreground`
- 上游：`text-gray-800 dark:text-gray-200`、`text-gray-500 dark:text-gray-400`、`text-gray-700 dark:text-gray-300`

**上下文**：分支里的 checkbox 与 `choice.label`（L524–536）是共享内容；差异只在三个类名。

**建议**：**取本地**。主题 token，三行一起换。

### 118 · `McpElicitationPanel.tsx` 第 12 块（L545）· C · **取本地（普通字段的 label 与描述色）**

**冲突块**：`{field.kind === 'choice' ? … : …}` 上方的 `<label>` 与描述：
- 本地：`block text-[13px] font-medium text-foreground` + `text-muted-foreground`
- 上游：`text-gray-800 dark:text-gray-200` + `text-gray-500 dark:text-gray-400`

**建议**：**取本地**。主题 token；下面的 `<select>`/`<input>` 共用 `inputClassName`（已在 108 定为本地版）。

### 119 · `McpElicitationPanel.tsx` 第 13 块（L584）· C · **取本地（底部按钮条 + Decline 按钮配色）**

**冲突块**：`<div className="flex shrink-0 items-center justify-end …">` 与其内 Decline 按钮：
- 本地：`border-t border-border bg-muted/50`；按钮 `text-muted-foreground hover:bg-accent`
- 上游：`border-t border-gray-100 bg-gray-50/50 dark:border-gray-700/50 dark:bg-gray-800/50`；按钮 `text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700/60`

**上下文**：这一条正是 `mcpElicitationPanel.test.tsx` 里"按钮必须在滚动区之外"那条用例所依赖结构的**样式**部分（结构 `shrink-0` 两侧一致）。两条主按钮（`bg-blue-600`）是共享内容，保持不动。

**建议**：**取本地**。主题 token。

### 120 · `McpElicitationPanel.tsx` 第 14 块（L617）· B · **取本地（提交键文案在工具审批时变成 "Allow"）**

**冲突块**：提交按钮的文字。
- 本地：`{isToolApproval ? t('chat:mcpElicitation.allow', { defaultValue: 'Allow' }) : t('chat:mcpElicitation.submit', { defaultValue: 'Submit' })}`
- 上游：恒为 `t('chat:mcpElicitation.submit', …)`

**上下文**：Codex 的工具审批是一个"允许/拒绝"问题，不是表单提交；106 的用例断言此时**有 "Allow"、没有 "Submit"**。`chat:mcpElicitation.allow` 这个键需要存在于本地语言文件里（若只有 defaultValue，英文界面没问题，但其它语言会回落成英文——可按需补 `en`/`zh-CN`）。

**建议**：**取本地**。这是 106 用例的第二个断言点，与 109/112 配套。

### 121 · `transcript/ChatMessagesPane.tsx` 第 1 块（L869）· C · **取本地，删掉上游那一整段重复的消息列表**

**冲突块**：
- 本地（L870–873）：`{diagnosticsEnabled && (<Suspense fallback={null}><ScrollDiagnosticsPanel containerRef={scrollContainerRef} /></Suspense>` —— 调试用滚动诊断面板。
- 上游（L885–1018）：**整段消息列表再来一遍**——`<div className="mx-auto w-full max-w-[54.25rem] …">`、加载占位、`ProviderSelectionEmptyState`、`hasTopChrome`、`items.map` + `LazyMessageRow`/`MessageComponent`、`</div>` 收尾。

**上下文**：合并文件的 L559–868 **已经是本地那份完整实现**（`max-w-[62.5rem]`、`TOP_CHROME_SLOT_CLASS`、`executionGroup`、`reasoningPresentation` 等本地全部特性），并且已经包含 `ProviderSelectionEmptyState`（L566）、tail affordance（L859）。上游那一侧只是它自己的旧版本，被 diff 对齐硬塞进冲突里。直接保留 = 同一个 transcript 渲染两次，且上游那版用的是 `text-gray-500 dark:text-gray-400` 硬编码灰（本 fork 已全面 token 化）与 `max-w-[54.25rem]`（本地是 62.5rem）。另外上游那份给 `ProviderSelectionEmptyState` 传了 `currentSessionId`，而该组件的 props 里**没有**这个字段（`ProviderSelectionEmptyState.tsx` 全文只有 10 个 provider 元数据，无 `currentSessionId`），保留会直接报多余属性。

**建议**：**取本地**（含 `diagnosticsEnabled` 面板），把上游 L885–1018 整段删除。拼接后确认结构闭合：本地那段 `</Suspense>` 后应直接接共享的 `)}` `</div>` `);`（L1019 之后的 `)}` 与 `</div>`）。

### 122 · `transcript/LazyMessageRow.tsx` 第 1 块（L77）· A · **并集（本地 4 个 props + 上游 `className`）**

**冲突块**：`LazyMessageRowProps`。
- 本地：`estimatedHeight?`（内容感知的占位高度）、`isProcessCollapsed?`（折叠过程成员时 unmount 但保留时间戳锚点）、`programmaticScrollTopRef`（记录自己写入的 `scrollTop`，否则锚点修正会被 `handleScroll` 误判成"读者往上拉"而锁死跟随）、`dataAnchor?`（轮次起点的 section 锚点）。
- 上游：`className?`（行外框的附加类，列表用它控制间距）。

**上下文**：全部有人在用——本地的四个来自 `ChatMessagesPane`（L800–828 传了 `estimatedHeight`、`isProcessCollapsed`、`dataAnchor`、`programmaticScrollTopRef` 以及下游的 `reasoning*` 等），上游的 `className` 也在同一处被传（`className={item.sideQuestion && item.type === 'assistant' ? '!mt-0' : undefined}`，侧问答案要吃掉列表的 `space-y` 间距）。

**建议**：**并集**，五个字段全留，`programmaticScrollTopRef` 保持必填（本地已有调用方全部传入）。

### 123 · `transcript/LazyMessageRow.tsx` 第 2 块（L104）· A · **并集（解构：四个本地默认值 + `className`）**

**冲突块**：函数参数解构。
- 本地：`estimatedHeight = ESTIMATED_ROW_HEIGHT_PX, isProcessCollapsed = false, dataAnchor, programmaticScrollTopRef,`
- 上游：`className,`

**建议**：**并集**，五个全解构，本地两个默认值保留。

### 124 · `transcript/LazyMessageRow.tsx` 第 3 块（L286）· B · **手工融合：`className` 与 `isProcessCollapsed` 的 `hidden` 必须合并成一个字符串**

**冲突块**：行外层 `<div>` 的属性。
- 本地：
  ```jsx
  data-user-anchor={dataAnchor || undefined}
  aria-hidden={isProcessCollapsed || undefined}
  className={isProcessCollapsed ? 'hidden' : undefined}
  style={isMounted ? undefined : { height: measuredHeight ?? estimatedHeight }}
  ```
- 上游：
  ```jsx
  className={className}
  style={isMounted ? undefined : { height: measuredHeight ?? ESTIMATED_ROW_HEIGHT_PX }}
  ```

**上下文**：两侧的 `className` 表达的是**不同的事**——本地用它折叠（`hidden` 去掉父级 `space-y` 的间距，并配合 `aria-hidden` 让折叠内容对读屏也消失），上游用它给调用方（侧问答案行）传 `!mt-0`。直接二选一都会坏一半：取本地 → 侧问行的间距不再归零；取上游 → 折叠的过程行既占位又对读屏可见。`style` 则取本地的 `estimatedHeight`（上游没有按内容估算的能力，只有固定常量）。

**建议**：**手工融合**：
```jsx
data-user-anchor={dataAnchor || undefined}
aria-hidden={isProcessCollapsed || undefined}
className={[isProcessCollapsed ? 'hidden' : '', className].filter(Boolean).join(' ') || undefined}
style={isMounted ? undefined : { height: measuredHeight ?? estimatedHeight }}
```
（`|| undefined` 是为了在两者都为空时不留 `className=""`，与两侧原写法一致。）

### 125 · `transcript/MessageComponent.tsx` 第 1 块（L3）· A · **并集（11 个图标全在用）**

**冲突块**：`lucide-react` 图标导入。
- 本地：`CheckIcon, BrainIcon, ChevronDownIcon, GitBranchIcon, ListChecksIcon, MessageSquareDashed, MoreHorizontal, PencilIcon, Timer`
- 上游：`Bot, GitBranchIcon, PencilIcon, XIcon`

**上下文**：逐个统计引用次数，**11 个全部 ≥2**（导入 + 使用）：本地 9 个（复制反馈 `CheckIcon`、思考/推理 `BrainIcon`/`ChevronDownIcon`、计划 `ListChecksIcon`、旁问 `MessageSquareDashed`、更多菜单 `MoreHorizontal`、编辑 `PencilIcon`、耗时 `Timer`），上游新增 `Bot`（推理/助手标识）与 `XIcon`（关闭），`GitBranchIcon` 与 `PencilIcon` 共有。

**建议**：**并集**，合并成一行 11 个图标。

### 126 · `transcript/MessageComponent.tsx` 第 2 块（L15）· A · **并集（`ActionMenu` + `ActionMenuItem` + `Shimmer`）**

**冲突块**：`@/shared/ui` 导入。
- 本地：`ActionMenu, LLMProviderLogo, type ActionMenuItem`
- 上游：`LLMProviderLogo, Shimmer`

**上下文**：`ActionMenu`/`ActionMenuItem` 各 2 处（本地消息头部的操作菜单）、`Shimmer` 2 处（上游思考中的微光占位），`LLMProviderLogo` 两侧共有。

**建议**：**并集**：
```ts
import { ActionMenu, LLMProviderLogo, Shimmer, type ActionMenuItem } from '@/shared/ui';
```

### 127 · `chat/utils/chatExport.ts` 第 1 块（L35）· A · **并集（两侧字段都已接上实现）**

**冲突块**：`TranscriptExportInput` 类型字段。
- 本地：`totalMessages?`、`isExcerpt?`、`interactive?` 三个字段（分页导出 / 分享快照用）。
- 上游：`includeSideQuestions?`（导出时是否带上旁问行）。

**上下文**：合并后的 `buildTranscriptExport`（L124 起）已经同时消费了三组字段，不是只有类型、没有实现：
- L124–127：`input.includeSideQuestions ? input.messages : input.messages.filter(m => !isSideQuestionRow(m))`，且辅助函数 `isSideQuestionRow`（L62）在冲突块之后、合并结果里已存在。
- L148–163：`totalMessages`、`isExcerpt` 继续透传给 `buildTranscriptMarkdown`；`interactive` 透传给 `buildTranscriptHtml`。
- `totalMessages?` 仍留在合并后的类型头部（L36），说明本块两侧都是新加字段、互不覆盖。

**建议**：**并集**，字段顺序：`totalMessages?` → `isExcerpt?` → `interactive?` → `includeSideQuestions?`（本地三字段连续，上游字段追加在末尾，语义分组最清楚）。

### 128 · `code-editor/CodeEditorBinaryFile.tsx` 第 1 块（L65）· C · **取本地（主题 token）**

**冲突块**：头部下载按钮的 `className`。
- 本地：`text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 dark:hover:text-foreground`
- 上游：`text-gray-600 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white`

**上下文**：本文件是上游本轮新增（二进制文件下载视图），本地把它的调色板统一改成了主题 token（`bg-background` L78、`bg-muted` L81 已经是 token 写法且无冲突）。此处是同一轮 token 化的残留冲突，两侧的视觉意图完全一致，只是取色方式不同。`dark:hover:text-foreground` 与 `hover:text-foreground` 重复，但属本地原文，不必顺手删（见 §3 外科手术原则）。

**建议**：**取本地**（主题 token）。整条链路（后续 129/130 同理）统一为 token 后，本文件在自定义主题下才不会出现灰阶与主题脱节。

### 129 · `code-editor/CodeEditorBinaryFile.tsx` 第 2 块（L138）· C · **取本地（HEAD 侧为空，保留即会重复按钮组）**

**冲突块**：
- HEAD 侧：**空**。
- 上游侧：完整的 `<div className="flex shrink-0 items-center gap-0.5">`（`headerDownloadButton` + 关闭按钮）。

**上下文**：这是 diff 对齐错位造成的假冲突。两侧的 sidebar 头部结构逐行比对（`git show HEAD:` 与 `git show upstream/main:` 同段）完全一致，唯一的真实差异是类名：

| 位置 | 本地 | 上游 |
|------|------|------|
| `<h3>`（冲突块之前的公共上下文） | `text-foreground` | `text-gray-900 dark:text-white` |
| 关闭按钮 | `text-muted-foreground hover:bg-muted …` | `text-gray-600 hover:bg-gray-100 …` |

git 把本地版本整组匹配成了公共上下文，又把上游同结构整组当成新增。**如果取上游侧，页头会出现两个下载按钮和两个关闭按钮。**

**建议**：**取本地（HEAD 侧为空）**，即删掉上游侧那一整块；公共上下文里那份 token 版按钮组保留。合并后 sidebar 头部只有一个按钮组，且类名与本文件其余部分一致。

### 130 · `code-editor/CodeEditorBinaryFile.tsx` 第 3 块（L196）· C · **取本地（主题 token）**

**冲突块**：全屏/弹窗分支里关闭按钮的 `className`，类名与 128 完全同对被换成了 token / 灰阶两版。

**上下文**：这是本文件第 3 处同一语义的调色板冲突（128 头部下载按钮、130 弹窗关闭按钮）。同文件其余无冲突处已是 token：`bg-background`、`bg-primary`/`text-primary-foreground`、`border-border`、`text-foreground`、`bg-muted`、`md:bg-overlay/50`（上游此处为 `md:bg-black/50`，合并结果已落到 token 版）。`text-red-600 dark:text-red-400` 是错误提示色，两侧相同，不受影响。

**建议**：**取本地**（`text-muted-foreground hover:bg-muted hover:text-foreground dark:hover:text-foreground`），与 128/129 保持同一套 token。

### 131 · `file-tree/hooks/useFileTreeOperations.ts` 第 1 块（L241）· A · **取上游（删掉重复短注释）**

**冲突块**：注释行。
- HEAD：`// Copy path to clipboard`
- 上游：无（随后公共上下文是 `// Copy path to clipboard. The shared helper falls back to execCommand('copy') …` 四行长注释）

**上下文**：`git show HEAD:` 该位置**两行注释并存**——短注释 + 四行详细注释，是历史上一次合并残留的重复；上游把短注释删掉只留了详细版。两版描述的是同一个 `handleCopyPath`，无语义差异，代码本身（`copyTextToClipboard` + 单次 toast）两侧一致。

**建议**：**取上游侧（空）**，只留四行详细注释。

### 132 · `i18n/config.ts` 第 1 块（L113）· A · **并集（tr 的 browser + git 两个命名空间都在）**

**冲突块**：`tr` 语言的 JSON 导入。
- 本地：`// oxlint-disable-next-line importx/order` + `import trBrowser from '…/tr/browser.json'`
- 上游：`import trGit from '…/tr/git.json'`

**上下文**：`src/modules/i18n/locales/tr/` 目录下 **`browser.json` 与 `git.json` 都存在**（实测 `ls`），且两侧由不同功能引入：`browser` 是本地内嵌浏览器面板的文案，`git` 是上游本轮 Git 面板（`id`/`zh-TW`/`es` 等语言在合并结果里已带 `git` 命名空间）。丢掉任一都会让对应命名空间的 `t()` 回退到 key。

**建议**：**并集**，`git` 放在 `tasks` 之后（与上游 `en`/`es` 的 `git` 紧跟 `tasks` 的排法一致），`browser` 保持本地那行 `oxlint-disable-next-line`：
```ts
import trTasks from '@/modules/i18n/locales/tr/tasks.json';
import trGit from '@/modules/i18n/locales/tr/git.json';
// oxlint-disable-next-line importx/order
import trBrowser from '@/modules/i18n/locales/tr/browser.json';
```

### 133 · `i18n/config.ts` 第 2 块（L304）· A · **并集（`tr` resources 同时挂 browser 与 git）**

**冲突块**：`tr` 的 `resources` 映射。
- 本地：`browser: trBrowser,`
- 上游：`git: trGit,`

**上下文**：与 132 同一件事的注册侧。其余语言在合并结果里都是 `tasks` → `browser` → `git` 的顺序（`en` L220–222），`tr` 需与之对齐；`browser` 是本地新增，不能丢。

**建议**：**并集**：
```ts
        tasks: trTasks,
        browser: trBrowser,
        git: trGit,
```

### 134 · `locales/de/sidebar.json` 第 1 块（L194）· A · **并集（4 个本地键 + 保留本地措辞）**

**冲突块**：`deleteConfirmation` 里的归档/永久删除文案。
- 本地：`archiveSession`、`archiveSessionNotice`、`archivedSessionNotice`、`deleteSessionPermanently: "Dauerhaft löschen"`
- 上游：`deleteSessionPermanently: "Endgültig löschen"`

**上下文**：本地侧是单会话归档（隐藏但保留历史，可恢复）与"永久删除"两个按钮的文案；上游只是把同一个 key 的德语改成了 `Endgültig löschen`，没有新增键。同文件无冲突处的 `archiveProject`、`archiveSessionsAction`（"… archivieren"）、`permanentlyDeleteArchivedSessionsAction`（"… **dauerhaft** löschen"）都在，说明本地整套归档语义是自洽的。

**建议**：**并集**——三个归档键保留，`deleteSessionPermanently` 取本地 `"Dauerhaft löschen"`（与同文件 `dauerhaft löschen` 的用词一致；上游的 `Endgültig` 在同文件里没有任何呼应用法）。

### 135 · `locales/en/chat.json` 第 1 块（L179）· A · **取本地（上游侧只有 1 个键，且本地已含）**

**冲突块**：`validation` 对象尾部 + 紧随其后的 `permissionBanner` 对象。
- 本地：`notTheFormat`、`allowTool`、`allowToolUnnamed`、`allow`（`}` 收尾），然后是完整 `permissionBanner`（`title`/`toolLabel`/`viewToolInput`/`allowRule`/`deny`/`allowOnce`/`allowAndRemember`/`allowSaved`）。
- 上游：只有 `notTheFormat`，没有收尾 `}`。

**上下文**：
- 上游 `en/chat.json` 全文 **没有** `allowTool`/`allowToolUnnamed`/`permissionBanner`（`git show upstream/main:… | grep` 实测），说明这三个是本地独有的工具审批文案（对应 `McpElicitationPanel` 的 `allowTool`/`allowToolUnnamed` 以及权限横幅）。
- 上游侧缺尾逗号和 `}`，说明它只是 diff 对齐到本地新增块时被截断的片段；取上游侧会直接产出非法 JSON。
- 本地侧已包含 `notTheFormat`，上游在这里没有可回收内容。

**建议**：**取本地整块**（含 `permissionBanner`）。注意别把上游侧那句 `"notTheFormat": "Not a valid {{format}}"` 再追加一次——同一对象里它会变成重复键。

### 136 · `locales/en/chat.json` 第 2 块（L252）· A · **并集（attachments 与 steer 两个对象）**

**冲突块**：`queue` 之后的两个兄弟对象。
- 本地：`attachments`（`uploading`/`failed`/`uploadFailedNamed`/`expand`/`remove`）
- 上游：`steer`（`label`/`sending`/`willRead`/`attachments_one`/`attachments_other`，带复数键）

**上下文**：两者是不同功能的独立对象，键名无交集（`attachments` 是本地附件上传失败提示，`steer` 是上游"插话/引导"）。冲突块后公共上下文只有一个 `}`（收尾 `queue` 的父对象），所以两侧都必须补上自己的 `},`：

```json
    "attachments": { … },
    "steer": { … }
```

**建议**：**并集**，`attachments` 在前、`steer` 在后（保持本地插入位置不动，上游对象紧随其后）。注意 `steer` 里是 `attachments_one`/`attachments_other` 复数键，不要误合并成 `attachments`（`en` 之外的 `tr/chat.json` 同理，见 145/146）。

### 137 · `locales/en/chat.json` 第 3 块（L627）· A · **并集（导出文档文案 + 旁问开关）**

**冲突块**：`export` 对象尾部。
- 本地：`excerptMessages`、`messages`、`partialMessages`、`projectName`、`exportedAt`、`toggleTheme`（分页摘录、项目名、导出时间、HTML 主题切换）
- 上游：`includeSideQuestions`

**上下文**：与 127 的 `chatExport.ts` 一一对应——本地 6 个键服务于 `buildTranscriptHtml`/`buildTranscriptMarkdown`（`isExcerpt`/`totalMessages`/`selectedProject`/`interactive` 四条分支），上游 `includeSideQuestions` 是导出菜单里的复选框（`includeSideQuestions` 字段的 UI 入口）。两组键在同一 `export` 对象内、无重名。

**建议**：**并集**，本地 6 个键保留，`includeSideQuestions` 追加在 `json` 之后（上游原位置）。若执行时采用 127 的并集方案，这里的键一个都不能少，否则导出文档会渲染出未翻译的键名。

### 138 · `locales/es/sidebar.json` 第 1 块（L65）· A · **并集（`_other` 两侧同一句，追加 3 个上游键）**

**冲突块**：`batchSelection`（会话多选）尾部。
- 本地：`deleteSelected_one`、`deleteSelected_other`
- 上游：`deleteSelected_other`（与本地逐字相同）、`expandForks`、`collapseForks`、`deleteSelected_many`

**上下文**：
- `expandForks`/`collapseForks` 是上游本轮新增的"会话分叉树展开/收起"无障碍标签，全语言齐备（`en`/`de`/`fr`/`it`/`ja`/`ko`/`ru`/`zh-CN`/`tr` 都有），本地没有对应功能所以整块是新增。
- `deleteSelected_many` 是上游给"多"复数类别补的键，`ru`/`pt-BR`/`es` 三处都出现——说明上游是有意按语言的复数类别补的，**不要因为西语直觉上只有 one/other 就删掉**。
- 两侧 `deleteSelected_other` 完全一致，只出现一次。

**建议**：**并集**：
```json
    "deleteSelected_one": "Eliminar {{count}} sesión",
    "deleteSelected_other": "Eliminar {{count}} sesiones",
    "deleteSelected_many": "Eliminar {{count}} sesiones",
    "expandForks": "Expandir bifurcaciones de {{session}}",
    "collapseForks": "Contraer bifurcaciones de {{session}}"
```

### 139 · `locales/es/sidebar.json` 第 2 块（L199）· A · **取本地（上游侧为空）**

**冲突块**：`deleteConfirmation` 里的归档文案。
- 本地：`archiveSession`、`archiveSessionNotice`、`archivedSessionNotice`
- 上游：**空**

**上下文**：与 134（德语同名块）同构；本地单会话归档需要这三句，上游没有删除或改写它们，只是 diff 把本地新增块与上游同段对齐了。冲突块后的 `deleteSessionPermanently`、`archiveSessions*`、`permanentlyDeleteArchivedSessions*` 都在公共上下文里。

**建议**：**取本地**（保留三行）。

### 140 · `locales/fr/sidebar.json` 第 1 块（L194）· A · **取本地（上游侧为空）**

**冲突块**：`deleteConfirmation` 的 `archiveSession` / `archiveSessionNotice` / `archivedSessionNotice`。
- 本地：三行都在
- 上游：**空**

**上下文**：与 134/139 同一类——本地单会话归档文案，上游未改动。值得注意：本文件 `batchSelection` 段的 `expandForks`/`collapseForks`（L66–67，上游新增）**已经在无冲突区**，说明本文件的冲突只剩这一处本地新增块，`deleteSessionPermanently` 等其余键在公共上下文里完好。

**建议**：**取本地**（保留三行）。

### 141 · `locales/it/sidebar.json` 第 1 块（L194）· A · **取本地（上游侧为空）**

**冲突块**：同上，`deleteConfirmation` 的三个归档键。
- 本地：`archiveSession`、`archiveSessionNotice`、`archivedSessionNotice`
- 上游：**空**

**上下文**：本文件 `expandForks`/`collapseForks`（L66–67）同样已自动合入无冲突区，冲突仅此一处；`deleteSessionPermanently`（"Elimina definitivamente"）在公共上下文。

**建议**：**取本地**（保留三行）。

### 142 · `locales/ja/sidebar.json` 第 1 块（L178）· A · **取本地（上游侧为空）**

**冲突块**：`deleteConfirmation` 的三行归档文案（`archiveSession`/`archiveSessionNotice`/`archivedSessionNotice`）。
- 本地：三行都在
- 上游：**空**

**上下文**：与 134/139/140/141 同构。本文件 `deleteConfirmation` 用的是**无复数后缀**的 `sessionCount`（日语无复数变化），说明这一段的本地化是本地自己维护的，上游没有碰过这些行；`deleteSessionPermanently`（"完全に削除"）在公共上下文。

**建议**：**取本地**（保留三行）。

### 143 · `locales/ko/sidebar.json` 第 1 块（L194）· A · **取本地（上游侧为空）**

**冲突块**：`deleteConfirmation` 的三行归档文案。
- 本地：`archiveSession`（"세션 보관"）、`archiveSessionNotice`、`archivedSessionNotice`
- 上游：**空**

**上下文**：与 142 同构。公共上下文里 `sessionCount_one`/`sessionCount_other`、`deleteSessionPermanently`（"영구 삭제"）都在，本地所用的"보관"（归档）措辞与同文件 `archiveProject`/`archiveSessionsTitle` 一致。

**建议**：**取本地**（保留三行）。

### 144 · `locales/ru/sidebar.json` 第 1 块（L204）· A · **取本地（上游侧为空）**

**冲突块**：`deleteConfirmation` 的三行归档文案。
- 本地：`archiveSession`（"Архивировать сеанс"）、`archiveSessionNotice`、`archivedSessionNotice`
- 上游：**空**

**上下文**：与 142/143 同构。俄语这一段有完整四类复数键（`_one`/`_few`/`_many`/`_other`，L197–200），说明本文件是本地按 CLDR 规则手工补过复数的版本；归档三行同属本地新增。

**建议**：**取本地**（保留三行）。

### 145 · `locales/tr/chat.json` 第 1 块（L148）· A · **取上游（整块新增 `codex` + `voice`）**

**冲突块**：
- HEAD 侧：**空**
- 上游侧：`codex` 对象（`permissionMode`、`modes.*` 五种 Codex 权限模式、`descriptions.*`、`technicalDetails`）+ `voice` 对象（`input`/`stopRecording`/`transcribing`/`speak`/`stopSpeaking`/`loading`）

**上下文**：
- 合并结果里 `"codex"` 全文件只出现这一次（L150），没有重复键；`voice`（L168）同样只有一次。
- 位置在 `usageLimit` 之后、`input` 之前，与 `en` 的排法一致。
- 本地这边没有 Codex 专属权限模式文案（本地的 `composer.permissionHeading` 是通用问句，不含各模式的 `descriptions`），所以这是纯新增，不存在语义冲突。

**建议**：**取上游整块**（`codex` + `voice` 一起保留，别只留 `voice` 而丢掉 `codex`——两者在同一个 hunk 里）。

### 146 · `locales/tr/chat.json` 第 2 块（L385）· C · **两侧都删（内容已在文件别处，且会造重复顶层键）**

**冲突块**：`tasks` 之后的顶层对象。
- 本地：`composer`（`permissionHeading`/`permissionCycleHint`/`permissionTriggerLabel`/`editing`）
- 上游：`message`（`editAndResend`/`forkFromHere`/`answeredBy`）

**上下文**（关键，逐项核对过）：
- 合并文件 **L211 已经有一个完整 `composer`**，前 5 个键（`reasoning`/`model`/`effortDefault`/`loadingModels`/`modelMenu`）来自上游，后 4 个本地键（含 `permissionHeading` 等）来自本地，是自动合并的结果。冲突块里的本地 `composer` 是同一批键的**旧副本**，保留即产生第二个 `"composer"` 顶层键。
- 合并文件 **L17 已经有一个 `message`**（`branchFromHere`/`editAndResend`/`forkFromHere`/`answeredBy`），是本地版且是上游侧（只有 3 个键）的**超集**。保留上游侧同样产生第二个 `"message"` 顶层键。
- JSON 重复键不会报错，`JSON.parse` 静默取**后一个**，于是 `composer` 会被截断成只剩 4 个权限键、`reasoning`/`model` 等模型选择文案全部失效——这是本块最危险的失败模式。
- 冲突块后的公共 `},` 是给任一侧对象收尾的，删掉两侧后它也会变成多余的括号。

**建议**：**两侧内容都删掉，并删掉紧随其后的那行 `},`**，即从 `"tasks": { … },` 直接接到 `"export": {`。保留 L211 的合并版 `composer` 与 L17 的 `message`。

> **顺带修正（不在冲突块内，但同一文件）**：合并结果里 `mcpElicitation` 出现了**两次**（L106 上游版、L503 本地版）。本地版是超集（多了 `allowTool`/`allowToolUnnamed`/`allow`），按 `JSON.parse` 取后者，功能上侥幸正确，但建议删掉 L106 那份上游副本，避免以后有人只看前面那份。

### 147 · `locales/tr/settings.json` 第 1 块（L148）· A · **并集（`computer` + `loginLog`，并保留 `browser` 对象）**

**冲突块**：`mainTabs` 尾部。
- 本地：`loginLog: "Login Log"`，`}` 收尾 `mainTabs`，随后整个 `browser` 对象（`title`/`description`/`enable`/…/`installRuntimeError`，23 个键）
- 上游：`computer: "Bilgisayar Kullanımı"`（新的"计算机使用"设置页标签）

**上下文**：
- 公共上下文里 `mainTabs` 已经含 `git`/`browser`/`notifications`/`plugins` 等标签，两侧的 `computer` 与 `loginLog` 是并列的两个新标签，无冲突。
- 合并结果全文件 `"browser"` 这一顶层设置页对象**只由本地提供**（上游没有同名键冲突）；上游侧那句 `computer` 缺尾逗号，说明它是被截断的片段，直接取上游会让 `mainTabs` 丢 `loginLog` 并把 `browser` 对象孤立成语法错误。
- `loginLog: "Login Log"` 是本地未翻译的英文（与 149 里整段英文登录日志一致），这是本地的既有状态，本块不做翻译。

**建议**：**并集**，`computer` 插到 `about` 之后、`loginLog` 之前，并补回 `mainTabs` 的 `},` 与完整 `browser` 对象：
```json
    "about": "Hakkında",
    "computer": "Bilgisayar Kullanımı",
    "loginLog": "Login Log"
  },
  "browser": { … }
```

### 148 · `locales/tr/settings.json` 第 2 块（L300）· A · **并集（`theme` 与 `keepProjectsExpanded`）**

**冲突块**：`appearance` 对象的最后一项。
- 本地：`theme`（`label`/`description`/`light`/`dark`/`system`）
- 上游：`keepProjectsExpanded`（`section`/`label`/`description`）

**上下文**：两者同在 `appearance` 下、键名无交集：`theme` 是本地主题系统（与主题 token 改造配套），`keepProjectsExpanded` 是上游的侧边栏折叠偏好。冲突块之后公共上下文只有一个 `},` 收尾 `appearance`，所以并集需要在两者之间补逗号。

**建议**：**并集**，`theme` 在前（本地原位置）、`keepProjectsExpanded` 在后。

### 149 · `locales/tr/settings.json` 第 3 块（L848）· A · **并集（`loginLog` + 上游 7 个对象，注意括号衔接）**

**冲突块**：文件尾部顶层对象。
- 本地：`loginLog` 整个对象（14 个键，含 `column.*`、`event.*` 映射；文案目前仍是英文）
- 上游：`skillsPage`、`browserUse`、`browserUseSettings`、`mcpServersAdd`、`mcpTeamCard`、`mcpServersAddErrors`、`about` 共 **7 个顶层对象**

**上下文**：
- 实测合并文件里这 7 个上游对象**只出现在冲突块内**（`grep '^  "[A-Za-z]*":'` 在块外的命中为空），不存在与块外重复的顶层键；`about` 也是上游本轮挪到此处的新位置，块外没有旧 `about`。
- 本地 `loginLog` 是登录日志页文案，`en/settings.json` 中对应对象在 L1605，`tr` 尚未翻译——保持现状。
- 语法衔接：本地侧末尾停在 `event` 对象内部（`}` 由公共 `  }` 收尾），上游侧末尾停在 `about` 内部（同样靠公共 `  }` 收尾）。并集后必须**给 `loginLog` 补上自己的 `},`**，否则 `skillsPage` 会嵌进 `loginLog`。

**建议**：**并集**，顺序：`loginLog`（本地）→ `skillsPage` → `browserUse` → `browserUseSettings` → `mcpServersAdd` → `mcpTeamCard` → `mcpServersAddErrors` → `about`（严格保持上游侧内部顺序），`loginLog` 之后插 `},`。

### 150 · `locales/tr/sidebar.json` 第 1 块（L88）· A · **并集（4 个 tooltip 键 + `navigation` 对象）**

**冲突块**：`tooltips` 尾部。
- 本地：`expandAllProjects`、`locateSelectedProject`、`collapseAllProjects`
- 上游：`backgroundWorkIndicator`，随后 `}` 收尾 `tooltips`，再是整个 `navigation` 对象（`chat`/`files`/`git`/`terminal`/`tasks`）

**上下文**：
- `en/sidebar.json` 四类键都在（L96 `backgroundWorkIndicator`、L107–108 `expandAllProjects`/`locateSelectedProject`），说明两侧都是各自功能所需，不是同一键的不同译文。
- 合并结果中 `"navigation"` 只在冲突块内出现（L95），块外没有同名顶层键，不存在重复。
- 语法衔接：本地侧末尾缺 `}` 与 `},`（由上游侧的 `}` 收尾 `tooltips`、再由公共 `},` 收尾？注意——公共上下文在 `>>>>>>>` 之后还有一个 `},`，那是给 `navigation` 收尾的），所以并集必须自己补 `tooltips` 的 `}`，并保证 `navigation` 仍是完整对象。

**建议**：**并集**：
```json
    "attentionRequiredIndicator": "Oturum ilgi bekliyor",
    "expandAllProjects": "Tüm projeleri genişlet",
    "locateSelectedProject": "Geçerli oturumun projesini göster",
    "collapseAllProjects": "Tüm projeleri daralt",
    "backgroundWorkIndicator": "Arka planda çalışan iş var"
  },
  "navigation": { … }
```

### 151 · `locales/tr/sidebar.json` 第 2 块（L215）· A · **取本地（上游侧为空）**

**冲突块**：`deleteConfirmation` 的三行归档文案。
- 本地：`archiveSession`、`archiveSessionNotice`、`archivedSessionNotice`
- 上游：**空**

**上下文**：与 139–144 同构。公共上下文里 `deleteSessionPermanently`、`confirmDeleteSession`、`archiveSessions*`、`permanentlyDeleteArchivedSessions*` 都在。

**建议**：**取本地**（保留三行）。

> **顺带修正（不在冲突块内，同一文件，必须处理）**：合并结果里顶层键 `"recent"` 出现了**两次**且**语义不同**：
> - L178（本地）：`pinnedTitle` / `unpinnedTitle` —— 本地置顶会话区的标题
> - L199（上游）：`title` / `emptyTitle` / `emptyDescription` / `loadFailed` / `loadMore` / `loadingMore` —— 上游"最近对话"区
>
> `HEAD` 与 `upstream/main` 各自都只有一个 `recent`，是自动合并把两个同名键并排放进来的。`JSON.parse` 取后者，**本地的 `pinnedTitle`/`unpinnedTitle` 会被静默丢弃**（置顶区标题变回 key）。修法：把两处的键并成**一个** `recent` 对象（8 个键并存，键名无交集）。

### 152 · `locales/zh-CN/sidebar.json` 第 1 块（L233）· A · **取本地（上游侧为空）**

**冲突块**：`deleteConfirmation` 的三行归档文案。
- 本地：`archiveSession`（"归档会话"）、`archiveSessionNotice`、`archivedSessionNotice`
- 上游：**空**

**上下文**：与 139–144/151 同构。中文文案与同文件 `archiveProject`（"归档项目"）、`archiveSessionsTitle`（"归档 {{count}} 个会话"）用词一致；公共上下文里的 `permanentDeleteWarning`（磁盘会话文件会被一并删除）也是本地独有说明。

**建议**：**取本地**（保留三行）。

### 153 · `locales/zh-TW/sidebar.json` 第 1 块（L209）· A · **取本地（上游侧为空）**

**冲突块**：同上，`deleteConfirmation` 的三行归档文案。
- 本地：`archiveSession`（"封存工作階段"）、`archiveSessionNotice`、`archivedSessionNotice`
- 上游：**空**

**上下文**：与 152 同构，但繁体用词走的是"封存工作階段"，与同文件 `archiveProject`（"封存專案"）、`archiveSessionsTitle`（"封存 {{count}} 個工作階段"）一致——不要误改回"归档"。

**建议**：**取本地**（保留三行，维持"封存"用词）。

### 154 · `sidebar/SessionOptions.tsx` 第 1 块（L2）· A · **并集（`Archive` + `Pin`/`PinOff`）**

**冲突块**：`lucide-react` 图标导入。
- 本地：`Check, Edit2, GitBranch, MoreHorizontal, Pin, PinOff, Trash2, X`
- 上游：`Archive, Check, Edit2, GitBranch, MoreHorizontal, Trash2, X`

**上下文**：合并后的菜单项里三种图标都在用：`Pin`/`PinOff` 在 L202（置顶/取消置顶，本地功能），`Archive` 在 L237（上游新增的"归档会话"菜单项，L236–239 已自动合并进来，`onSelect: () => onArchiveSession(sessionId)`）。

**建议**：**并集**：
```ts
import { Archive, Check, Edit2, GitBranch, MoreHorizontal, Pin, PinOff, Trash2, X } from 'lucide-react';
```

### 155 · `sidebar/SessionOptions.tsx` 第 2 块（L38）· A · **并集（本地 6 个 Props + 采纳上游注释措辞）**

**冲突块**：`SessionOptionsProps` 的尾部字段。
- 本地：`isPinned?`、`onTogglePinned?`、`parentSessionId?`、`canAssignParent?`、`onRequestAssignParent?`、`onClearParent?`，以及 `canDelete` 的注释 "Withheld where the row has nowhere to send a delete."
- 上游：仅把 `canDelete` 的注释改成 "Withheld where the row has nowhere to send an **archive or** delete."（因为上游在删除之外又加了归档项）

**上下文**：本地这 6 个字段在合并结果里**逐一有消费者**：解构（L92–97，含默认值 `isPinned = false`/`canAssignParent = false`）、`Pin`/`PinOff` 菜单项（L202，`!(onTogglePinned) ? [] : [...]`）、`buildSessionOwnershipMenuItems({ parentSessionId: parentSessionId ?? null, canAssignParent, onRequestAssignParent, onClearParent, t })`（L228–234）。上游没有删除或重命名这些字段，只改了注释。

**建议**：**并集**——6 个字段保留，`canDelete` 的注释用上游的 "archive or delete"（更准确，因为上游确实在 `canDelete` 分支里同时放了 archive 与 delete 两项）。

### 156 · `sidebar/SessionOptions.tsx` 第 3 块（L242）· C · **取上游（`'Delete session'`）**

**冲突块**：`delete` 菜单项的 `label`。
- 本地：`t('sessions.archiveOrDeleteSession')`（"归档或删除会话"）
- 上游：`'Delete session'`

**上下文**：语义上归档已经从删除项里拆出去成了独立菜单项（上一条 L236 `Archive session` → `onArchiveSession`），所以"Archive or delete session"这个标签**已经名不副实**。上游还带了配套测试 `sidebar/tests/sessionOptionsArchiveDelete.test.tsx`，其中明确断言：

```ts
const remove = screen.getByRole('menuitem', { name: /Delete session/ });
assert.equal(screen.queryByRole('menuitem', { name: /Archive or delete/ }), null);
```

保留本地标签会直接让这条测试失败。另外上下相邻的 `Archive session` 在合并结果（L236）与 `SidebarSessionItem.tsx` L594 也都是硬编码英文，取上游后本菜单三项措辞一致。

**建议**：**取上游 `'Delete session'`**（硬编码英文与相邻一致；若以后要 i18n，应与 `Archive session` 一起改，不在本次合并里做）。

> **⚠️ 本轮已知的 UI 文案回退：只改这一处会变成"同一侧边栏里两种说法"。** 合并后还剩下 **7 处** `t('sessions.archiveOrDeleteSession')`（"归档或删除会话"），但它们点下去**只能永久删除**——本地弹窗里的"归档"次按钮（HEAD `SidebarModals.tsx:194-201` 的 `onConfirmDeleteSession(false)`）已被上游版整体取代（预演文件 L200–216 只剩 Delete permanently + Cancel）。逐处核对的结果：
> - `SidebarContent.tsx:202`（项目行桌面菜单）、`:410`（项目行移动端按钮）、`:598`（最近会话桌面菜单）、`:732`（最近会话移动端按钮，`isArchived ? deleteSession : archiveOrDeleteSession` 的三目也一并失效）；
> - `SidebarRecentConversations.tsx:570`（移动端按钮）、`:708`（桌面菜单）；
> - `SidebarSessionItem.tsx:581`（本文件移动端 sheet，182 已决定取上游的 Archive/Delete 两项，改完这一处即消失）。
>
> 这批不是冲突标记，而是"自动合并保留了本地标签 + 上游删掉了归档动作"的组合结果，属于**用户可见回退**（上一轮标签是准确的）。**D19 已定（2026-11-17）：补回归档，不改文案**——上述 6 处（`SidebarSessionItem:581` 由 182 处理）都要变成两个动作：
> - 桌面菜单：在"删除会话"前加 `{ key: 'archive', label: t('sessions.archiveSession'), icon: Archive, onSelect: () => onArchiveSession(sessionId) }`；
> - 移动端 sheet：加一个中性色的"归档会话"按钮，删除按钮保持红色；
> - 归档**不弹确认**（可撤销），删除仍走永久删除确认。
>
> 接线成本：`SidebarContent` 与 `SidebarRecentConversations` 目前都没有 archive prop，需要各加一个 `onArchiveSession: (sessionId: string) => void`，由 `Sidebar.tsx` 把 controller 现有的 `archiveSession` 传下去；`SidebarRecentConversations.tsx:1250` 那段 `sessionActions.onArchiveSession` 属于 174 要删的上游块，不要拿它当现成接线。
> 另外要新增 i18n key `sessions.archiveSession`（en + zh-CN 两份；现有只有 `archiveSelected`/`archiveSessions*`，没有单数）。`mobileSessionFork.test.tsx:107` 的旧标签断言随 187 一并改。

### 157 · `sidebar/Sidebar.tsx` 第 1 块（L261）· A · **并集（3 个回调都已在 controller 里解构）**

**冲突块**：传给 `SidebarProjectList` 的回调。
- 本地：`onTogglePinned: updateSessionPinned`、`onRequestBatchArchive: showBatchSessionArchiveConfirmation`
- 上游：`onArchiveSession: archiveSession`

**上下文**：三个变量在 `useSidebarController()` 的解构里**都已存在**（`Sidebar.tsx` L136 `archiveSession`、L147 `updateSessionPinned`、L151 `showBatchSessionArchiveConfirmation`；controller 内分别在 L1211/L1678/L1398 定义并 L1851–1867 导出），并且 `SidebarProjectList.tsx` 的 props 类型（L45–48）与向下透传（L125–128）在合并结果里已同时声明了这三个。只保留任一侧都会让 `SidebarProjectList` 收到 `undefined`，Pin / 归档 / 批量归档中至少一项静默失效。

**建议**：**并集**：
```ts
    onTogglePinned: updateSessionPinned,
    onRequestBatchArchive: showBatchSessionArchiveConfirmation,
    onArchiveSession: archiveSession,
```

### 158 · `sidebar/SidebarModals.tsx` 第 1 块（L24）· C · **取本地 props（上游的 `onConfirmDeleteSessions` 无消费者）**

**冲突块**：`SidebarModalsProps` 的删除确认相关字段。
- 本地：`onConfirmDeleteSession: (hardDelete?: boolean) => void` + 三组批量字段（`batchSessionArchiveConfirmation`/`onConfirmBatchSessionArchive`/`onCancelBatchSessionArchive`、`batchArchivedSessionDeleteConfirmation`/`onConfirmBatchArchivedSessionDelete`/`onCancelBatchArchivedSessionDelete`）
- 上游：`onConfirmDeleteSession: () => void`（带注释 "Deletes the pending session permanently; archiving has its own menu item."）+ `onConfirmDeleteSessions: (hardDelete?: boolean) => void`

**上下文**（逐项核对）：
- **主体只认本地那一套**：合并后的组件体使用 `onConfirmDeleteSession`（L203/206）、`batchSessionArchiveConfirmation`（L221/232/235/244/247/249）、`batchArchivedSessionDeleteConfirmation`（L258/269/272/281/284/286），**没有一处调用 `onConfirmDeleteSessions`**。上游的单一批量弹窗（其源码里 `onConfirmDeleteSessions(false/true)` 用于"归档 / 永久删除整批"）在合并结果里已被本地两个独立弹窗取代，没有残留。
- **调用方也只传本地那一套**：`Sidebar.tsx` L290–296 传入 `onConfirmDeleteSession` 与 6 个批量 props，**没有** `onConfirmDeleteSessions`。若把上游字段并进来，它会变成必填却无人提供的 prop，`tsc` 直接报错。
- controller 侧两套实现都在（上游 `confirmDeleteSessions(hardDelete=false)` 在 L1259，本地 `confirmBatchSessionArchive` 等），但既然 UI 走本地那套，就不该再声明上游字段。
- 签名取上游的 `() => void` 更准确：`useSidebarController` 的 `confirmDeleteSession`（L1215）**不接受参数**，本地声明里的 `hardDelete?` 从来没有真值传进来。

**建议**：**取本地字段集合 + 上游的签名与注释**：
```ts
  /** Deletes the pending session permanently; archiving has its own menu item. */
  onConfirmDeleteSession: () => void;
  batchSessionArchiveConfirmation: BatchSessionArchiveConfirmation | null;
  onConfirmBatchSessionArchive: () => void;
  onCancelBatchSessionArchive: () => void;
  batchArchivedSessionDeleteConfirmation: BatchArchivedSessionDeleteConfirmation | null;
  onConfirmBatchArchivedSessionDelete: () => void;
  onCancelBatchArchivedSessionDelete: () => void;
```
**不要**加入 `onConfirmDeleteSessions`。

> 与 196 联动：弹窗主体取上游版后，**只剩"永久删除"一个动作**，不再有"归档"次按钮（本地 HEAD 的 `onConfirmDeleteSession(false)` 已无意义），这正是签名从 `(hardDelete?)` 收敛成 `() => void` 的根因。归档入口仍在行菜单里，所以行为上不算 bug，但这是本轮的产品可见变化，报告里要写；剩余自绘菜单的文案处置见 D19。

### 159 · `sidebar/SidebarModals.tsx` 第 2 块（L201）· C · **混合：类名取本地 `text-n-white`，`onClick` 取上游无参调用**

**冲突块**：永久删除会话弹窗的主按钮。
- 本地：`className="… text-n-white …"`、`onClick={() => onConfirmDeleteSession(true)}`
- 上游：`className="… text-white …"`、`onClick={onConfirmDeleteSession}`

**上下文**：
- `text-n-white` 是本地主题系统的冻结白（`tailwind.config.js` L97 `"n-white": "hsl(var(--n-white))"`、`src/index.css` L344 `--n-white: var(--palette-white)`），`src/shared/tests/neutralConsumerWhitelist.ts` 里明确把"彩色底面上的白字（`text-n-white`）"列为合法用法。上游的 `text-white` 是普通 Tailwind 白，在本地主题下同样正确但绕过了主题框架的语义约定。
- `onConfirmDeleteSession` 在 158 里已定为 `() => void`（controller 实现无参），传 `true` 已无意义；上游写法与签名一致。
- 同一文件里两个批量弹窗的主按钮（L241、L262）都是 `bg-red-600 text-n-white`，本处保持 `text-n-white` 才与相邻一致。

**建议**：
```tsx
  className="w-full justify-start bg-red-600 text-n-white hover:bg-red-700"
  onClick={onConfirmDeleteSession}
```

### 160 · `sidebar/SidebarProjectItem.tsx` 第 1 块（L44）· A · **并集（本地 2 个可选回调 + 上游必填 `onArchiveSession`）**

**冲突块**：`SidebarProjectItemProps` 的会话行回调。
- 本地：`onTogglePinned?`、`onRequestBatchArchive?`
- 上游：`onArchiveSession`（必填）

**上下文**：三者是不同功能：置顶（本地）、批量归档（本地，带 `onCompleted(archivedSessionIds)` 回收）、单会话归档（上游，自 L2 版 SidebarModals 的"归档会话"菜单项而来）。下游 `SidebarProjectSessions` 的 props 里三者并存且都在用（其 L56–59 类型、L113–116 解构、L324 置顶、L344 批量归档、L524 传 `onArchiveSession` 给行），所以本组件必须同时接收并透传三者。

**建议**：**并集**：
```ts
  onTogglePinned?: (sessionId: string, isPinned: boolean) => void;
  onRequestBatchArchive?: (sessionIds: string[], onCompleted: (archivedSessionIds: string[]) => void) => void;
  onArchiveSession: (sessionId: string) => void;
```

### 161 · `sidebar/SidebarProjectItem.tsx` 第 2 块（L95）· A · **并集（同样的三个解构参数）**

**冲突块**：组件函数的参数解构。
- 本地：`onTogglePinned,`、`onRequestBatchArchive,`
- 上游：`onArchiveSession,`

**上下文**：与 160 一一对应：类型里声明了就必须解构，否则 162 的透传会拿到未定义标识符（`tsc` 报 "Cannot find name"）。三者都只用于往 `SidebarProjectSessions` 透传，没有其他用途。

**建议**：**并集**：
```ts
  onTogglePinned,
  onRequestBatchArchive,
  onArchiveSession,
```

### 162 · `sidebar/SidebarProjectItem.tsx` 第 3 块（L613）· A · **并集（透传给会话列表）**

**冲突块**：`<SidebarProjectSessions …>` 的 props。
- 本地：`onTogglePinned={onTogglePinned}`、`onRequestBatchArchive={onRequestBatchArchive}`
- 上游：`onArchiveSession={onArchiveSession}`

**上下文**：`SidebarProjectSessions` 这三项都是它自己要用的（L324 `onTogglePinned ?? NOOP_TOGGLE_PINNED` 传给每一行、L344 批量归档、L524 行内归档），其中 `onArchiveSession` 在该组件里是**必填**（L59 无 `?`），漏传会 `tsc` 报错。与本块相邻的 `onDeleteSession`/`onForkSession`/`onLoadMoreSessions` 已自动合并，无冲突。

**建议**：**并集**：
```tsx
        onTogglePinned={onTogglePinned}
        onRequestBatchArchive={onRequestBatchArchive}
        onArchiveSession={onArchiveSession}
```

### 163 · `sidebar/SidebarProjectList.tsx` 第 1 块（L44）· A · **并集（三项回调解构）**

**冲突块**：组件函数参数解构。
- 本地：`onTogglePinned,`、`onRequestBatchArchive,`
- 上游：`onArchiveSession,`

**上下文**：本文件 props 类型（L45/46/48）在合并结果里已同时声明 `onTogglePinned`、`onRequestBatchArchive`、`onArchiveSession`，且都往下传给 `SidebarProjectItem`（L125–128）。这里只解构一侧，另一侧在 JSX 里就是未定义标识符。

**建议**：**并集**：
```ts
  onTogglePinned,
  onRequestBatchArchive,
  onArchiveSession,
```

### 164 · `sidebar/SidebarProjectList.tsx` 第 2 块（L124）· A · **并集（透传给 `SidebarProjectItem`）**

**冲突块**：`<SidebarProjectItem …>` 的 props。
- 本地：`onTogglePinned={onTogglePinned}`、`onRequestBatchArchive={onRequestBatchArchive}`
- 上游：`onArchiveSession={onArchiveSession}`

**上下文**：`SidebarProjectItem` 侧（160–162）已确定三个 props 都要，其中 `onArchiveSession` 为必填；本处漏传即 `tsc` 报缺参，`onTogglePinned`/`onRequestBatchArchive` 漏传则置顶与批量归档静默失效（`SidebarProjectSessions` 里 `onTogglePinned ?? NOOP_TOGGLE_PINNED` 会退回空实现）。

**建议**：**并集**：
```tsx
                onTogglePinned={onTogglePinned}
                onRequestBatchArchive={onRequestBatchArchive}
                onArchiveSession={onArchiveSession}
```

### 165 · `sidebar/SidebarProjectSessions.tsx` 第 1 块（L1）· A · **并集（React 导入 + 上游 4 个图标）**

**冲突块**：文件头导入。
- 本地：`import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';` + `import type { DragEvent } from 'react';`
- 上游：`import { useMemo, useState } from 'react';` + `import { CheckSquare, ChevronRight, Plus, Trash2 } from 'lucide-react';`

**上下文**：合并结果里各符号都有消费者：`Fragment`（本地树形 map 的 key 包裹，L435）、`useCallback`（L213 `toggleBatchSelection`）、`useEffect`（L187 选择集修剪）、`DragEvent`（L275 起 4 个拖拽 handler）、`ChevronRight`（上游折叠箭头）、`Plus`（上游 new-session 按钮）。`CheckSquare`/`Trash2` 目前只在**上游侧被丢弃的 return 段**里出现，是否保留取决于 170/171 的结构决策（若采用“本地骨架 + 上游行渲染”，这两个图标在本文件无消费者，应删掉以免 lint 报未使用）。`useMemo`/`useState` 两侧共有。

**建议（D18 已定为 C-lite，按此收口）**：
```ts
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DragEvent } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
```
- `Fragment` **删掉**：它只服务于本地 `sessionTree.map` 的 key 包裹，而该 map 在 171 里已被上游的 `visibleRows.map` 取代。
- `CheckSquare`/`Trash2` **不加**：它们只出现在上游被丢弃的 return 段里；选择栏继续用本地的 `SidebarBatchSessionActions`。
- `useCallback`（`toggleBatchSelection`）、`useEffect`（选择集修剪）、`DragEvent`（拖拽四件套）、`ChevronRight`（上游折叠箭头）、`Plus`（上游 new-session 按钮）、`useMemo`/`useState` 都有消费者，保留。

### 166 · `sidebar/SidebarProjectSessions.tsx` 第 2 块（L15）· A · **并集（两套树的工具都在用）**

**冲突块**：内部模块导入。
- 本地：`SidebarBatchSessionActions`、`useSessionParentPicker`、`groupSessionsByParent`
- 上游：`useCompactSidebar`、`buildProjectSessionTree`，以及常量 `FORK_INDENT_PX = 12`、`MAX_FORK_INDENT_DEPTH = 4`

**上下文**：合并结果里这些引用**全部存在且都活着**——`useCompactSidebar` L126、`buildProjectSessionTree` L127、`MAX_FORK_INDENT_DEPTH`/`FORK_INDENT_PX` L172/457/464/476/484、`groupSessionsByParent` L235、`useSessionParentPicker` L240、`SidebarBatchSessionActions` L562。关键点：**两套树函数不是同一个东西**：
- `groupSessionsByParent` 按 `session.parentSessionId` 分组（本地"归到某个会话下"的一层树，深度 ≤1，数据由拖拽/菜单写入）。
- `buildProjectSessionTree` 按 `forkedFromSessionId` + `forkAncestors` 构建（上游分叉谱系，任意深度，带折叠与连接线）。

两者读的是**不同字段**，一套不能替换另一套的语义（见 170/171）。

**建议（D18 = C-lite）**：保留 `useCompactSidebar`、`buildProjectSessionTree`、两个缩进常量、`useSessionParentPicker`、`SidebarBatchSessionActions`；**删掉 `groupSessionsByParent` 的导入**（171 已把"手动归类"并成 `buildProjectSessionTree` 的一条边，单层分组函数不再有消费者，留着 `oxlint` 报 unused）。

### 167 · `sidebar/SidebarProjectSessions.tsx` 第 3 块（L55）· A · **并集**

**冲突块**：`SidebarProjectSessionsProps` 的会话行回调。
- 本地：`onTogglePinned?`、`onRequestBatchArchive?`
- 上游：`onArchiveSession`

**上下文**：与 160/163 同构；三个都由 `SidebarProjectItem` 透传进来（162/164），下游 `SidebarSessionItem`/批量栏都在用。

**建议**：**并集**（`onArchiveSession` 必填，两个本地回调保持可选）。

### 168 · `sidebar/SidebarProjectSessions.tsx` 第 4 块（L112）· A · **并集（三项解构）**

**冲突块**：函数参数解构。
- 本地：`onTogglePinned,`、`onRequestBatchArchive,`
- 上游：`onArchiveSession,`

**上下文**：`onTogglePinned` 用于 `onTogglePinned ?? NOOP_TOGGLE_PINNED`（L67/L324 的 no-op 常量就是为它准备的）；`onRequestBatchArchive` 用于 `requestBatchArchive`（L344）；`onArchiveSession` 用在行渲染（L524）。三者都有消费者。

**建议**：**并集**。

### 169 · `sidebar/SidebarProjectSessions.tsx` 第 5 块（L123）· C · **并集状态，但选择模型必须统一（推荐本地 `Set` + `isManaging`）**

**冲突块**：组件顶部状态。
- 本地：`const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set());`
- 上游：`isCompact`、`treeRows`（`buildProjectSessionTree`）、`selectedSessionId`、`targetAncestors`、`forkTreeState`（`collapsedForks`）、`visibleRows`、`hasForks`

**上下文**（这是本文件结构决策的第一环）：
- 两边的"批量选择"模型不同：本地是 **`Set<string>` + 父组件的 `isManaging` 布尔**（进入管理模式由 `SidebarProjectItem` 持有），上游是 **`Set<string> | null`**（`null` 表示不在选择态）。合并后若两边逻辑都留，会出现两个真相源，`isSelecting`（上游 L362 `selectedSessionIds !== null`）在本地 `Set` 下**永远为真**。
- 上游这组派生量全部服务于上游的树渲染（折叠、祖先行显示），且依赖 `treeRows`/`collapsedForks`，与本地 `Set` 选择互不干扰，可以并存。
- `useState` 的惰性初始化 + render 期 `setForkTreeState` 的写法（上游原样）是 React 允许的"渲染期修正 state"模式，不要顺手改写。

**建议**：**并集**，但把选择态统一为本地的一个模型：
```ts
const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set());
const isSelecting = isManaging;           // 不再用 selectedSessionIds !== null
```
其余上游状态（`isCompact`/`treeRows`/`selectedSessionId`/`targetAncestors`/`forkTreeState`/`visibleRows`/`hasForks`）整体保留。后续 170 的批量派生量需由 `selectedSessionIds`（Set）改写，不能直接沿用上游的 `selectedSessionIds ? … : []` 三目。

### 170 · `sidebar/SidebarProjectSessions.tsx` 第 6 块（L202）· C · **结构决策：本地骨架 + 上游派生量，删掉上游的 return**

**冲突块**：批量选择派生量 + 组件 `return` 开头。
- 本地：`hasSessions`（按 `sessions.length`）、`selectableSessionIds`、`areAllSelectableSessionsSelected`、`toggleBatchSelection`、`toggleSelectAll`、`sessionTree`（`groupSessionsByParent`）、`parentPicker`/`setSessionParent`、拖拽四件套 + 两个拖拽 UI 状态、`renderSessionRow`、`exitManaging`、`requestBatchArchive`，以及 `return (<> <div className={cn('grid …')}` 的**折叠动画骨架**
- 上游：`hasSessions`（按 `treeRows.length`）、`isSelecting`、`isSessionRunning`、`selectableSessionIds`（按 `treeRows`）、`effectiveSelectedIds`、`checkedSessionIds`、`allLoadedSelected`、`selectAllLabel`，以及一个**完全不同的 `return`**（`<div className="ml-1.5 space-y-1 …">` + `isCompact ? 圆形按钮 : <Button>` 的 "New session"）

**上下文**（逐项核对）：
1. **两个 `return` 不能同时存在**；而公共上下文（`      )}` → `    >` → `<div className="overflow-hidden">` → 带 `onDragOver/onDragLeave/onDrop` 的列表 div）只与**本地**骨架严格咬合：`className={cn(` 的参数列表正好由 `)}` 收尾、`>` 关闭本地那个折叠 div，`overflow-hidden` 与本地注释里"折叠动画 wrapper 即滚动容器"的解释一致，拖拽三个 handler 也只有本地定义。取上游侧会得到嵌套多一层的空 wrapper，且三个 handler 变成未定义。
2. **New session 入口会重复**：本地在 `SidebarProjectItem.tsx` L191（`startNewSession`，注释说明它要 `stopPropagation` 以免触发行展开）已经有项目行上的 "+"。上游把入口放进了会话列表顶部。两者并存 = 同一项目两个新建按钮。
3. **本地上游各自的 hasSessions 语义一致**（一个有会话 vs 树里有行），取本地（`sessions.length`）更直接：上游 `treeRows` 会把 `forkAncestors` 补出的"上下文父节点"也算进去，空项目时可能误判。
4. **批量派生量要重写**：上游的 `effectiveSelectedIds`/`checkedSessionIds`/`allLoadedSelected` 依赖 `selectedSessionIds` 为 `Set | null`；169 已定为 `Set`，直接照抄会让 `checkedSessionIds` 计算失效（`selectedSessionIds ? …` 恒真但类型不符）。本地对应的 `areAllSelectableSessionsSelected`/`toggleSelectAll` 用的是 `Set` 语义，可以直接沿用；上游多出来的价值是 `selectAllLabel`（区分 "Select all loaded" / "Clear" / "Select all"）与"运行中的行不计入可选中数量"的再派生。
5. 本地 `requestBatchArchive` 的 `onCompleted` 回调用**回调返回的已归档 id 集**修剪选择，并决定是否退出管理模式——上游没有等价逻辑（上游走 `onConfirmDeleteSessions`），这一段必须保留。

**建议**：**采用本地骨架**，把上游有价值的两点并进来：
- 保留本地 `hasSessions`、`selectableSessionIds`、`areAllSelectableSessionsSelected`、`toggleBatchSelection`、`toggleSelectAll`、拖拽全套、`renderSessionRow`、`exitManaging`、`requestBatchArchive`、以及本地 `return` 的折叠骨架；
- 删除上游的 `return`（含 `isCompact` 的 New session 按钮，避免与项目行 "+" 重复）；
- 并入上游 `isSessionRunning` 与 `selectAllLabel`，并把 `effectiveSelectedIds` 改写为基于本地 `Set` 的形式（`selectableSessionIds.filter(id => selectedSessionIds.has(id))`），供 171 的行渲染与批量栏使用；
- `sessionTree` 是否保留取决于 171 的决策（若采用上游行渲染则删掉 `sessionTree` 与 `groupSessionsByParent` 的 import）。

> 这是本文件最重要的决策点，与区块 171 绑定，建议执行时两处一起改并跑 `SidebarProjectSessions` 相关测试（`projectSessionTree.test.*`、`sidebarRowProps.test.tsx`、`mobileSessionFork.test.tsx`、批量归档测试）。

### 171 · `sidebar/SidebarProjectSessions.tsx` 第 7 块（L433）· C · **D18 已定：上游树结构 + 手动归类优先（C-lite）**

**冲突块**：会话行渲染。
- 本地：`sessionTree.map(({ session, children }) => <Fragment> {renderSessionRow(session)} {children.length > 0 && <div className="ml-4 …border-l">{children.map(renderSessionRow)}</div>}</Fragment>)` —— 一层父子缩进
- 上游：`<div data-testid="project-session-tree">` + `visibleRows.map(...)`：多级缩进（`paddingLeft`）、连接线（`data-fork-connector`）、延续竖线（`data-fork-continuation`）、分叉主干（`data-fork-stem`）、折叠按钮（`ChevronRight` + `expandForks`/`collapseForks`）、`treeRow={hasForks}` 的紧凑行

**上下文**（为什么这是决策而不是并集）：
- 两套渲染的**数据来源不同字段**：本地 `sessionTree` 来自 `session.parentSessionId`（人工"归到某会话下"，一层），上游 `visibleRows` 来自 `forkedFromSessionId` + `forkAncestors`（分叉谱系，多层）。同一行会话可能两者都有值，把两套同时渲染 = 同一会话出现两次；只用一套 = 另一条关系在列表里不可见。
- 两套行的 props 也不同：本地传 `isManaging`/`isBatchSelected`/`attentionLevel`/`onTogglePinned`/`onToggleBatchSelection`/拖拽四件套；上游传 `isSelecting`/`isChecked`/`onToggleSessionSelected`/`treeRow`/`onArchiveSession`/`needsAttention`。`SidebarSessionItem` 目前在合并结果里**同时**留着两套 props 与两套 UI（见 175 之后），必须二选一或做真正的融合。
- 上游渲染依赖 `data-testid="project-session-tree"`、`data-session-id`、`data-parent-session-id`、`data-fork-depth` 等属性，其测试（`projectSessionTree`、`sessionRowBackgroundWork` 等）直接按这些选择器断言；本地测试（`mobileSessionFork`、`sidebarRowProps`）则依赖 `isBatchSelected` 等。

**已定方案（D18 = C-lite，2026-11-17 亮 拍板）：上游树结构 + 手动归类优先，拖拽后行真的移动**

- **树结构与行渲染取上游**：`visibleRows.map`、缩进、连接线、折叠（`expandForks`/`collapseForks`）、`data-*`、`treeRow` 全部保留；删除本地的 `sessionTree.map` 与 `groupSessionsByParent` import。
- **树边多一条来源**：`buildProjectSessionTree` 在决定 `node.parentId` 时**优先用 `session.parentSessionId`**（该父节点在本次加载的列表里、provider 相同、且不成环），否则回退到 `forkedFromSessionId`。两处都要过现有的"每环断一条边"逻辑（`projectSessionTree.ts` 的 cycle-sever 循环已经能兜住手动归类造成的环）。
- **拖拽因此有真实反馈**：拖到谁下面，行就排到谁下面；手动归类过的会话不再按分叉树排（这是有意的：两种关系互斥时，用户刚做的动作优先）。
- **选择模型仍归本地**（D23）：`isManaging`/`isBatchSelected`/`onToggleBatchSelection` 不变，不引入上游的 `selectedSessionIds` controller API。
- **具体拼法**：保留上游 `visibleRows.map` 的外层 `<div>`（`data-session-id` / `data-parent-session-id` / `data-fork-depth` / 连接线 / 折叠按钮），把其中内联的 `<SidebarSessionItem …上游 props…>` 换成 `{renderSessionRow(session)}`。这样本地的 `renderSessionRow`（L304–336，含拖拽四件套、`attentionLevel`、`onTogglePinned`、`toggleBatchSelection`）原样复用，不用把 20 多个 props 手抄进 map，也不会留下未使用函数。注意 `renderSessionRow` 自带 `key`，外层 div 也有 `key`，把内层的去掉避免重复。

**两层 props 的映射（解决 171 与 176/177 的表面矛盾）**

映射发生在 `<SidebarProjectSessions>` 这一层，**不是把 `SidebarSessionItem` 的 props 改名**：

| 上游写法（`SidebarProjectSessions` 渲染体内） | 落地写法（本地 props） |
|---|---|
| `selectedSessionIds`（`Set`） | `isManaging` 下取行级 `isBatchSelected`（选择集仍在 `useSidebarController`） |
| `onToggleSessionSelected(id)` | `onToggleBatchSelection(id)` |
| `isSelecting` | `isManaging` |
| `isChecked` | `isBatchSelected` |
| `attentionSessionIds: Set` | `attentionSessions: ReadonlyMap<string, SessionAttentionLevel>` |
| `onSetSessionSelection` / `onCancelSessionSelection` / `onDeleteSelectedSessions` | **不引入**；批量入口是本地 `SidebarBatchSessionActions` + `onRequestBatchArchive` |
| `onArchiveSession` / `treeRow` | 保留（176 已定，`SidebarSessionItem` 只新增这两个上游 props） |

配套后果（执行时逐条落实）：
1. **上游 `projectSessionTreeView.test.tsx` 改写成本地 props，断言保留**：补 `isManaging`/`onManagingChange`、`attentionSessionIds`→`attentionSessions` Map、删掉 5 个上游选择 props；树结构断言（`data-session-id` 顺序、`data-fork-depth`、折叠/展开、`collapseForks`/`expandForks` 的 aria-label）全部保留。它的夹具里没有 `parentSessionId`，所以 C-lite 那条新边不影响这些断言。
2. **新增一条测试**（`projectSessionTree` 或 `sidebarProjectFormatting` 的现有测试文件里）：给 `child` 设 `parentSessionId: 'unrelated'`，断言 `rowIds` 变成 `['root','child','leaf','unrelated']` 之外的新顺序（child 挂到 unrelated 下、`data-parent-session-id` 指向 unrelated），再叠一条"手动归类成环"的用例验证不会死循环。
3. **166 里 `groupSessionsByParent` 的 import 必须删**（否则 `oxlint` unused）：单层分组逻辑已并入 `buildProjectSessionTree`，不要再保留第二套树函数。
4. 拖拽 handler（`onSessionDragStart` 等四件套）与 `draggingSessionId`/`isDropHighlighted` 继续传给上游行渲染；`sessionOwnsChildren`（`SidebarContent`/`SidebarRecentConversations`）仍按 `parentSessionId` 计算，逻辑不变。

### 172 · `sidebar/SidebarRecentConversations.tsx` 第 1 块（L1）· A · **并集（React 全量钩子 + 13 个图标）**

**冲突块**：文件头导入。
- 本地：`useCallback, useEffect, useMemo, useState` + `Check, ChevronRight, Edit2, Folder, Loader2, MessageSquare, MoreHorizontal, Pin, PinOff, Plus, Trash2, X` + `DragEvent, MouseEvent`
- 上游：`Loader2, MessageSquare` + `useEffect, useRef` + `MouseEvent`

**上下文**：逐个统计引用次数，**13 个图标全部都 ≥2**（含导入行本身），且都不是死代码：`Pin`/`PinOff`（置顶，L507/682）、`Check`（路径复制的勾选反馈）、`ChevronRight`（行尾箭头）、`Folder`、`Edit2`、`MoreHorizontal`（行内菜单）、`Plus`（新建会话控件）、`Trash2`/`X`（弹窗按钮）、`Loader2`/`MessageSquare`（加载与空态）。钩子侧：`useRef` 只在上游侧（L1018 起无限滚动）出现，但合并结果的尾部 L1276 已经在用 `loadMoreSentinelRef`，所以 `useRef` 必须留；`useCallback`（拖拽）、`useMemo`（`sessionsOwningChildren`）、`useState`（编辑态/管理模式）都是本地在用。

**建议**：**并集**：
```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, MouseEvent } from 'react';
import { Check, ChevronRight, Edit2, Folder, Loader2, MessageSquare, MoreHorizontal, Pin, PinOff, Plus, Trash2, X } from 'lucide-react';
```

### 173 · `sidebar/SidebarRecentConversations.tsx` 第 2 块（L764）· A · **并集（本地状态机 + 上游无限滚动）**

**冲突块**：组件体开头的状态与效果。
- 本地：编辑态（`editingSessionId`/`editingSessionName`）、管理模式（`isManaging`、`selectedSessionIds: Set`）、`setSessionParent`、拖拽三个状态、`beginConversationDrag`/`endConversationDrag`/`dropConversationOnRow`、三个列表级拖拽 handler、`sessionsOwningChildren`、选择集修剪 `useEffect`、编辑 4 个操作、`pinnedConversations`/`unpinnedConversations`/`selectableSessionIds`
- 上游：`loadMoreSentinelRef`、`onLoadMoreRef`、`autoLoadedAtLengthRef`、`canAutoLoadMore`、`conversationCount` 与 3 个 `useEffect`（同步 onLoadMore、重置滚动页码、IntersectionObserver 自动加载下一页）

**上下文**：
- 两组逻辑**互不相干**：本地是"选择/拖拽/归档"状态机，上游是"滚到底自动翻页"。没有同名声明冲突（已逐项比对）。
- **必须并集的关键理由**：公共尾部的 `<div ref={loadMoreSentinelRef} data-testid="recent-conversations-load-more">`（L1276）在合并结果里已经存在，只取了本地会让 `loadMoreSentinelRef` 未定义（`tsc` 报错）；上游新增测试 `recentConversationsInfiniteScroll.test.tsx`（L207 断言该 testid）也依赖这段。
- 本地 `selectableSessionIds` 基于 `conversations` 过滤（本文件没有 project 会话树，无需上游 `treeRows`），保持不动。

**建议**：**并集**，顺序：本地状态机在前（编辑/管理/拖拽/派生量），上游无限滚动 refs 与 3 个 `useEffect` 紧随其后（`canAutoLoadMore` 依赖 `hasMore`/`isLoading`/`isLoadingMore`/`hasError`，这几个都是 props，位置无依赖）。

### 174 · `sidebar/SidebarRecentConversations.tsx` 第 3 块（L1140）· C · **取本地（上游侧是并行实现的整行渲染，结构与本地不兼容）**

**冲突块**：未置顶会话区的开头。
- 本地（6 行）：`{unpinnedConversations.length > 0 && (<div>{pinnedConversations.length > 0 && (<div className="px-2 pb-1 …">{t('recent.unpinnedTitle', …)}`
- 上游（117 行）：整段行内渲染 `handleClick`（中键/修饰键放行、`preventDefault`、`onConversationSelect`）+ 注意力圆点 + `<a data-testid="recent-conversation-row">`（provider logo、标题、项目名、processing/background/age 三种角标）+ `<SessionOptions … onArchiveSession={sessionActions.onArchiveSession} …>` 

**上下文**：
- 公共尾部的 `</div> )} <div className="space-y-0.5">{unpinnedConversations.map(renderConversationRow)}</div> </div> )}` 与**本地那 6 行**严丝合缝；上游那 117 行是上游"扁平列表 + 每行 SessionOptions"的实现，塞进来会多出一层未闭合的 `<div>`，并把 `sessionActions`（本文件 props 里**不存在**，合并结果的 props 仍是本地那套 `onRenameSession`/`onTogglePinned`/`onDeleteSession`/`onRequestBatchArchive`）变成未定义引用。
- 上游行内的能力本地都有等价物：`RecentConversationRow`（同文件）已渲染 provider logo、标题、项目名、`Processing`/`BackgroundWork`/`Attention`/`Draft` 角标（`SessionStatusIndicators`）、置顶按钮，并用 `ActionMenu` + `buildSessionOwnershipMenuItems` 提供重命名/置顶/归档或删除/归到…（`t('sessions.archiveOrDeleteSession')`，L564/702）。
- 本地行同样带 `data-testid="recent-conversation-row"`（L593），所以上游 `projectSessionTreeView.test.tsx` L175 按该 testid 取 `href` 的断言仍能通过。

**建议**：**取本地那 6 行**，删掉上游那 117 行。本文件最终走"本地列表 + 上游无限滚动"的混合结构（173 已并入 sentinel），不引入上游的 `sessionActions` 聚合 props 与扁平行实现。

### 175 · `sidebar/SidebarSessionItem.tsx` 第 1 块（L2）· A · **并集（两套事件类型 + 图标，按融合方案留用）**

**冲突块**：`react` 类型导入与 `lucide-react` 图标。
- 本地：`import type { DragEvent } from 'react'`；`Check, Edit2, GitBranch, Loader2, MoreHorizontal, Pin, PinOff, Trash2, X`
- 上游：`import type { KeyboardEvent } from 'react'`；`Archive, Check, CheckSquare, Edit2, GitBranch, Loader2, MoreHorizontal, Square, Trash2, X`

**上下文**：逐个统计引用次数：
- 本地独有：`DragEvent`（L223/232/252 三个拖拽 handler）、`Pin`（行内置顶标记 L4xx 与菜单）、`PinOff`（取消置顶菜单项）。都是活的。
- 上游独有：`KeyboardEvent`（上游新增的行内键盘处理）、`Archive`（L593 移动端 sheet 的"Archive session"按钮，在上游侧的 sheet 里）、`CheckSquare`/`Square`（**只在导入行出现，count = 1**，消费者全在上游的 `selectionIcon` 里）。
- 共有：`Check`、`Edit2`、`GitBranch`、`Loader2`、`MoreHorizontal`、`Trash2`、`X`。

**建议**：**并集**，但以 176/182 的决策为准：若行内批量 UI 统一用本地那套（`role="checkbox"` + `Check`），则 **不要**加入 `CheckSquare`/`Square`（否则 lint 报未使用）；`Archive` 与 `KeyboardEvent` 是否保留取决于是否采用上游的 sheet/键盘处理。最小并集：
```ts
import type { DragEvent } from 'react';
import type { KeyboardEvent } from 'react';
import { Archive, Check, Edit2, GitBranch, Loader2, MoreHorizontal, Pin, PinOff, Trash2, X } from 'lucide-react';
```

### 176 · `sidebar/SidebarSessionItem.tsx` 第 2 块（L48）· C · **决策：统一到本地 props，另加 `onArchiveSession`**

**冲突块**：`SidebarSessionItemProps` 的交互回调。
- 本地：`onTogglePinned`、`onToggleBatchSelection`、`onDeleteSession`、`onForkSession?`、`draggingSessionId`、`isDropHighlighted`、`onSessionDragStart`、`onSessionDragEnd`、`onSessionDragOver`、`onSessionDropOnRow`
- 上游：`onArchiveSession`、`onDeleteSession`、`onForkSession?`、`isSelecting`、`isChecked`、`treeRow?`、`onToggleSessionSelected`

**上下文**：
- 公共区（本块之前）已经保留本地的 `isManaging`/`isBatchSelected`/`hasBackgroundWork`/`attentionLevel`，说明本地的管理模式语义已经落在类型里；上游又加了 `isSelecting`/`isChecked`，两套选择语义并存会让调用方必须同时传两套（且 169 已定本地 `Set` + `isManaging` 为唯一真相）。
- 本地 6 个拖拽/置顶 props 都有消费者：`onTogglePinned`（行内置顶点按/菜单）、拖拽四件套（L223–252 的 `startSessionDrag`/`acceptSessionDrag`/`completeSessionDrag` + 行的 data 属性）、`draggingSessionId`/`isDropHighlighted`（高亮与禁用）。
- 上游 `onArchiveSession` 有消费者（L589 移动端 sheet 归档按钮、L805 `SessionOptions` 的 `onArchiveSession`），且 `SessionOptions`（156 决议）已把归档拆成独立项——**这个能力要保留**。
- `treeRow` 只在 171 采用"上游树"方案时有意义；`onToggleSessionSelected` 是上游选择模型的入口，与本地 `onToggleBatchSelection` 语义重复。

**建议**：**统一到本地 props + 增加 `onArchiveSession: (sessionId: string) => void`**；`treeRow?` 视 171 的决策决定是否加入（推荐加入，用于密排行渲染）。`isSelecting`/`isChecked`/`onToggleSessionSelected` 不加入，行内改用本地 `isManaging`/`isBatchSelected`/`onToggleBatchSelection`。调用方（SidebarProjectSessions/RecentConversations）同步按此传参。

### 177 · `sidebar/SidebarSessionItem.tsx` 第 3 块（L106）· C · **与 176 同步的解构**

**冲突块**：参数解构。
- 本地：`onTogglePinned, onToggleBatchSelection, onDeleteSession, onForkSession, draggingSessionId, isDropHighlighted, onSessionDragStart, onSessionDragEnd, onSessionDragOver, onSessionDropOnRow`
- 上游：`onArchiveSession, onDeleteSession, onForkSession, isSelecting, isChecked, treeRow = false, onToggleSessionSelected`

**上下文**：解构必须与 176 的类型完全一致，否则要么 `tsc` 报未声明参数，要么解构出不存在的字段（运行期为 `undefined`）。`treeRow = false` 的默认值是上游密排行逻辑依赖的（`treeRow ? … : …` 多处三元）。

**建议**：按 176 的结论解构：本地 10 项 + `onArchiveSession` + （若采纳）`treeRow = false`。不要解构 `isSelecting`/`isChecked`/`onToggleSessionSelected`。

### 178 · `sidebar/SidebarSessionItem.tsx` 第 4 块（L287）· C · **取本地外观，补上游的 `treeRow` 分支**

**冲突块**：compact（移动端）行容器的 `className`。
- 本地：`'p-2 mx-3 my-0.5 rounded-md bg-card border active:scale-[0.98] transition-all duration-150 relative'` + 选中态 `border-primary/40 shadow-[inset_3px_0_0_0_hsl(var(--primary))]`（左侧内阴影条）+ 运行态 `border-border/60 bg-muted/20` / 默认 `border-border/30`
- 上游：`treeRow` 分支用透明边框密排（`mx-0.5 my-px … px-1.5 py-1`）、非 treeRow 用本地同款但多一个 `sessionView.isActive` 的绿色态、选中态 `bg-primary/5 border-primary/20`、`isChecked` 态 `border-primary/40 bg-primary/10`

**上下文**：
- 本地这组类名是主题 token 体系的一部分（`bg-card`、`border-primary/40`、`hsl(var(--primary))` 内阴影条），与本地主题评审结论一致；上游的 `bg-green-50/5`、`bg-primary/5` 是另一套表达。
- 本地没有 `sessionView.isActive` 的"最近活动"绿边（本地用 `AttentionSlot`/`ActivitySlot` 承担状态表达），上游用边框表达；两者并存会重复表达且颜色未走 token。
- `treeRow` 的密排样式本身是有价值的（分叉树缩进后行高需要收紧），且不涉及配色语义。

**建议**：**取本地作为基线**，仅在需要时前置上游的 `treeRow` 分支：
```tsx
  className={cn(
    treeRow
      ? 'mx-0.5 my-px rounded-md border border-transparent bg-transparent px-1.5 py-1 active:scale-[0.98] transition-colors duration-150 relative'
      : 'p-2 mx-3 my-0.5 rounded-md bg-card border active:scale-[0.98] transition-all duration-150 relative',
    isSelected
      ? 'border-primary/40 shadow-[inset_3px_0_0_0_hsl(var(--primary))]'
      : '',
    !isSelected && isProcessing ? 'border-border/60 bg-muted/20' : 'border-border/30',
  )}
```
（D18 已定为 C-lite：保留 `treeRow` 分支。）

### 179 · `sidebar/SidebarSessionItem.tsx` 第 5 块（L310）· C · **取本地（上游的 `selectionIcon` 在合并结果里没有定义）**

**冲突块**：compact 行第一行内容（复选框 + provider logo）。
- 本地：`isManaging && <span role="checkbox" aria-checked={isBatchSelected} aria-label={t('sessions.selectSession' 或 runningSessionCannotBeArchived)} …>{isBatchSelected && <Check/>}</span>` + `w-6 h-6` 容器 / `h-5 w-5` logo
- 上游：`{selectionIcon}` + `w-5 h-5` 容器（`isSelected ? bg-primary/10 : bg-muted/50`）/ `h-3 w-3` logo

**上下文**：**合并结果里 `selectionIcon` 只有两处使用（L334、L710），没有任何定义**——上游把它定义在 `return` 之前（`upstream/main` L133 `const selectionIcon = isSelecting ? (…)`），而那段代码在本文件的其他冲突块里已被本地版覆盖/丢弃。直接取上游侧会得到 "Cannot find name 'selectionIcon'"。本地这段是无障碍完整的（`role="checkbox"`、`aria-checked`、运行中不可选的 `aria-label` 与 `opacity-40`），且与本地 `isManaging` 语义一致（176 已定）。

**建议**：**取本地**。若采纳上游树（171 方案 A）并新增 `treeRow`，可把容器类名做成 `treeRow ? 'w-5 h-5' : 'w-6 h-6'`、logo 用 `treeRow ? 'h-3 w-3' : 'h-5 w-5'`；但**不要**引入 `selectionIcon`。

### 180 · `sidebar/SidebarSessionItem.tsx` 第 6 块（L353）· C · **取本地（置顶标记；上游侧与下方公共区重复渲染时间）**

**冲突块**：标题后的角标。
- 本地：`session.isPinned && (<Tooltip content={t('sessions.pinnedSession')}><span …><Pin className="h-3 w-3 fill-current"/></span></Tooltip>)`
- 上游：`isProcessing ? (<Tooltip content={t('tooltips.processingSessionIndicator')}><Loader2 …/></Tooltip>) : !treeRow && compactSessionAge && (<span className="ml-auto …">{compactSessionAge}</span>)`

**上下文**：冲突块**之后**的公共区已经有一句：
```tsx
<span className="ml-auto flex flex-shrink-0 items-center gap-1.5">
  {compactSessionAge && (<span className="text-[11px] text-muted-foreground">{compactSessionAge}</span>)}
  …<DraftSlot/><AttentionSlot/>
</span>
```
取上游会让 `compactSessionAge` 在同一行渲染两次（上游那句 `ml-auto` 与公共区的 `ml-auto` 争夺布局，间距也会错）。置顶标记是本地独有信息（上游没有 pin），本地行没有别处显示它。

**建议**：**取本地**（保留置顶 `Pin`）；上游的 processing spinner 若确实想在 compact 行展示，应作为**独立元素追加**在公共角标区（与 `DraftSlot`/`AttentionSlot` 并列），而不是取上游这一整块。

### 181 · `sidebar/SidebarSessionItem.tsx` 第 7 块（L391）· C · **取本地（i18n aria-label），按钮尺寸可按 `treeRow` 收紧**

**冲突块**：行尾"更多"按钮。
- 本地：`{!isManaging && <button … aria-label={t('sessions.sessionOptionsFor', { name: sessionView.sessionName })} … className="ml-1 flex h-8 w-8 …">}`
- 上游：`{!isSelecting && (<button … aria-label={`Session options for ${…}`} … className={cn(…, treeRow ? '-mr-0.5 h-7 w-7 rounded-md' : 'h-8 w-8 rounded-lg')}>)}`

**上下文**：
- 本地用 `t('sessions.sessionOptionsFor', { name })`，`en/sidebar.json` L37 的文案正是 `"Session options for {{name}}"`，**渲染结果与上游硬编码模板逐字相同**，所以上游按 `name: /Session options for …/` 的断言（如 `sessionOptionsArchiveDelete.test.tsx` 的 `openMenu`）在本地写法下同样成立；用本地写法还能让 zh-CN 等语言显示中文。
- 显隐条件两边语义等价（176 已定 `isManaging` 为唯一选择态）。
- 上游的 `treeRow` 尺寸收紧是密排树的配套样式，不涉及配色。

**建议**：**取本地 aria-label 与显隐条件**，`className` 可并上 `treeRow` 分支：
```tsx
className={cn(
  'ml-1 flex flex-shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted active:scale-95',
  treeRow ? '-mr-0.5 h-7 w-7 rounded-md' : 'h-8 w-8 rounded-lg',
)}
```
（D18 已定为 C-lite：保留 `treeRow` 分支。）

### 182 · `sidebar/SidebarSessionItem.tsx` 第 8 块（L571）· C · **取上游（归档/删除拆成两个按钮）**

**冲突块**：移动端 sheet 里的删除区。
- 本地：一个红色按钮 `t('sessions.archiveOrDeleteSession')` → `requestDeleteSession()`（即 `onDeleteSession(session.id, name)`）
- 上游：一个中性"Archive session"按钮 → `onArchiveSession(session.id)`，一个红色"Delete session"按钮 → `requestDeleteSession()`

**上下文**：
- `requestDeleteSession`（L174）只是转调 `onDeleteSession`；合并后的确认弹窗（`SidebarModals` L186–214）**只有"Delete permanently"和取消**，没有归档分支。所以本地方案里"归档或删除会话"这个标签名不副实——点下去只能永久删除。
- 上游把归档拆成独立项后，桌面 `SessionOptions`（156）、项目行与移动端 sheet 三处一致，且上游为 sheet 写了专门的断言（`mobileSessionFork.test.tsx`：归档只调 `onArchiveSession`、删除只调 `onDeleteSession`、运行中两者都隐藏）。
- 依赖：取上游需要 176 的 `onArchiveSession` 与 175 的 `Archive` 图标（两者都已列入并集）；sheet 里其它按钮（fork/rename）仍用本地 `t(...)`，本块的两个标签沿用上游英文硬编码（与桌面 `'Archive session'`/`'Delete session'` 一致，本地化留给后续统一处理）。

> 本块改完，`SidebarSessionItem.tsx:581` 那处旧标签自然消失；`SidebarContent.tsx`（4 处）与 `SidebarRecentConversations.tsx`（2 处）的同类菜单按 **D19（已定：补回归档）** 各自加回归档项，具体接法见 156 末尾。

> **已知 i18n 回退（记录在案，不在本轮修）**：改成硬编码英文后，中文界面在这个 sheet 里会出现 `Archive session` / `Delete session` 两个英文按钮，而相邻的 fork/rename 仍是 `t()`。已核对现有 key：`sessions.deleteSession`（`en/sidebar.json:29`，"Delete Session"）存在，但**没有单数的"Archive session" key**（只有 `archiveSelected`/`archiveSessions*`/`archiveOnlyTooltip`）。后续补法是新增 `sessions.archiveSession`（en + zh-CN 两份，D15），并让测试用 `t` 桩按 key 断言；本轮先合上，不要在 182 里顺手发明新 key。

**建议**：**取上游两块按钮**。测试断言随之按 187 的结论统一（那一块是同一件事的测试侧）。

### 183 · `sidebar/SidebarSessionItem.tsx` 第 9 块（L634）· C · **取本地外观（主题 token + 拖拽环），按需补 `treeRow` 分支**

**冲突块**：桌面（非 compact）行 `<a>` 的 `className`。
- 本地：`bg-card p-2 pr-11`、选中 `border-primary/40 shadow-[inset_3px_0_0_0_hsl(var(--primary))]`、运行态 `border-border/60 bg-muted/20`、`isManaging && isProcessing` 的禁用态、`isDragging && 'opacity-50'`、`isDropHighlighted && 'ring-2 ring-inset ring-primary/60'`
- 上游：`treeRow` 密排分支、`isSelecting ? 'pr-2' : 'pr-11'`、选中 `bg-primary/5`、`sessionView.isActive` 的绿色态、`isChecked` 态

**上下文**：
- 本地的 `isDragging`/`isDropHighlighted` 是拖拽功能的一部分（L6xx 的 `draggable`/`onDragStart` 等仍在本块之后的公共区），去掉即拖拽无视觉反馈。
- 本地选中态用内阴影条（`hsl(var(--primary))`）是主题体系的一部分；上游 `bg-primary/5` 是另一套视觉。两者取其一，避免"内阴影条 + 淡底"叠加。
- 上游 `isSelecting ? 'pr-2' : 'pr-11'` 的意图是：选择态没有"更多"按钮，可以收回右侧留白。本地 `isManaging` 与它语义相同，可以直接映射。
- `treeRow` 密排样式可用于 171 方案 A。

**建议**：**取本地**，并把上游的两个中性改进并进去（`isManaging ? 'pr-2' : 'pr-11'`、`treeRow` 的密排分支）：
```tsx
className={cn(
  buttonVariants({ variant: 'ghost' }),
  treeRow
    ? 'h-auto w-full justify-start rounded-md border border-transparent bg-transparent px-1.5 py-1 text-left font-normal transition-colors duration-150'
    : 'h-auto w-full justify-start rounded-md border bg-card p-2 text-left font-normal transition-all duration-150',
  isManaging ? 'pr-2' : 'pr-11',
  isSelected ? 'border-primary/40 shadow-[inset_3px_0_0_0_hsl(var(--primary))]' : 'border-border/30',
  !isSelected && isProcessing ? 'border-border/60 bg-muted/20 hover:bg-muted/25' : 'hover:bg-accent',
  isManaging && isProcessing && 'cursor-not-allowed opacity-60',
  isDragging && 'opacity-50',
  isDropHighlighted && 'ring-2 ring-inset ring-primary/60',
)}
```
不要并入 `sessionView.isActive` 绿边与 `isChecked` 态（前者与本地状态槽重复，后者属上游选择模型）。

### 184 · `sidebar/SidebarSessionItem.tsx` 第 10 块（L686）· C · **取本地（同 179，桌面行；`selectionIcon` 无定义）**

**冲突块**：桌面行的复选框 + provider logo。
- 本地：`isManaging && <span role="checkbox" aria-checked={isBatchSelected} aria-label={运行中 ? t('sessions.runningSessionCannotBeArchived') : t('sessions.selectSession', { name })} …>{isBatchSelected && <Check/>}</span>` + `h-6 w-6` 容器 / `h-5 w-5` logo
- 上游：`{selectionIcon}` + `h-5 w-5` 容器（`isSelected ? bg-primary/10 : bg-muted/50`）/ `h-3 w-3` logo

**上下文**：与 179 完全同构（compact/桌面两处重复的同一段），`selectionIcon` 在本文件**没有定义**（见 179）。本块之后的公共区含双击重命名（`onDoubleClick`，用的是本地 `isManaging` 判定），与本地选择模型一致。

**建议**：**取本地**；若采用 `treeRow`，logo/容器尺寸可跟随密排收紧（`h-5 w-5`/`h-3 w-3`），但不要引入 `selectionIcon`。

### 185 · `sidebar/SidebarSessionItem.tsx` 第 11 块（L766）· A · **并集（本地 pin/parent props + 上游 `onArchiveSession`）**

**冲突块**：桌面行的 `<SessionOptions>`。
- 本地：`{!isManaging && <SessionOptions … isPinned={session.isPinned} onTogglePinned={onTogglePinned} parentSessionId={parentPicker ? parentSessionId : undefined} canAssignParent={canAssignParent} onRequestAssignParent={requestAssignParent} onClearParent={clearParent} onDeleteSession={onDeleteSession} … />}`
- 上游：`{!isSelecting && (<SessionOptions … onArchiveSession={onArchiveSession} onDeleteSession={onDeleteSession} … />)}`

**上下文**：
- `SessionOptions` 在合并结果里 `onArchiveSession` 是**必填**（156 决议保留它），本地这里没传 → 取本地会直接 `tsc` 报缺参；这也说明归档菜单项在项目行侧必须补上。
- 本地独有的 `isPinned`/`onTogglePinned`（置顶菜单项）、`parentSessionId`/`canAssignParent`/`onRequestAssignParent`/`onClearParent`（归到…菜单项）都是本地功能入口，上游没有替代物。
- 条件表达式 `{!isManaging && <…/>}` 与 `{!isSelecting && (…)}` 语义相同（176 已定 `isManaging`），取本地写法即可。

**建议**：**并集**——本地写法 + 补 `onArchiveSession={onArchiveSession}`：
```tsx
        {!isManaging && <SessionOptions
          …
          onArchiveSession={onArchiveSession}
          onDeleteSession={onDeleteSession}
          onFork={onForkSession ? () => onForkSession(session) : undefined}
          isPinned={session.isPinned}
          onTogglePinned={onTogglePinned}
          parentSessionId={parentPicker ? parentSessionId : undefined}
          canAssignParent={canAssignParent}
          onRequestAssignParent={requestAssignParent}
          onClearParent={clearParent}
          t={t}
        />}
```

### 186 · `sidebar/hooks/useSidebarController.ts` 第 1 块（L1204）· C · **取本地 deps + 只留上游两个薄包装，删掉上游整套 `sessionSelection`**

**冲突块**：`removeSession` 的依赖数组，以及其后 140 行上游代码。
- 本地：仅 `}, [fetchArchivedSessions, onSessionDelete, pendingDeletion, reloadRecentConversations, t]);`
- 上游：`}, [fetchArchivedSessions, onSessionDelete, t]);` 之后依次是 `archiveSession`、`confirmDeleteSession`、`setProjectSessionSelection`、`toggleSessionSelected`、`cancelSessionSelection`、`showDeleteSelectedSessionsConfirmation`、`confirmDeleteSessions`

**上下文**（逐项核对合并后的 `removeSession` 函数体 L1150–1203）：
- 函数体实际引用：`api.deleteSession`、`onSessionDelete`、`setConversationResults`（setter，无需列入）、`fetchArchivedSessions`、`reloadRecentConversations`、`t`。**没有**引用 `pendingDeletion`。两侧依赖数组都不完全正确：本地多了 `pendingDeletion`，上游漏了 `reloadRecentConversations`（上游函数体不调它，但合并后的函数体调了，L1183）。
- 合并后的 `Sidebar.tsx` 需要 `archiveSession`（L136/L265）与 `confirmDeleteSession`（L137/L290），这两个只在上游侧定义。本地的旧 `confirmDeleteSession(hardDelete = false)` 已被 `removeSession` 抽取取代，合并结果里不存在重复定义。
- 上游那套 `setProjectSessionSelection`/`toggleSessionSelected`/`cancelSessionSelection`/`showDeleteSelectedSessionsConfirmation`/`confirmDeleteSessions` 依赖 **`SidebarSessionSelection` 与 `sessionIdsBeingDeletedRef`，这两个标识在合并后的文件里根本没有声明**（`grep` 全文件只有使用处 L1225/L1275），且 controller 的 return 对象（L1851–1880）导出的是本地的 `showBatchSessionArchiveConfirmation`/`confirmBatchSessionArchive`/`confirmBatchArchivedSessionDelete` 等——上游这套批量选择系统在本地 UI 里没有调用方。

**建议**：
```ts
  }, [fetchArchivedSessions, onSessionDelete, reloadRecentConversations, t]);

  // Archiving is reversible from the archive list, so it skips the confirmation
  // that guards a permanent delete.
  const archiveSession = useCallback((sessionId: string) => {
    void removeSession(sessionId, false);
  }, [removeSession]);

  const confirmDeleteSession = useCallback(async () => {
    if (pendingDeletion?.kind !== 'session') {
      return;
    }

    const { sessionId } = pendingDeletion;
    setPendingDeletion(null);
    await removeSession(sessionId, true);
  }, [pendingDeletion, removeSession]);
```
其余 5 个函数**整段删除**（不编译且无调用方）。

### 187 · `sidebar/tests/mobileSessionFork.test.tsx` 第 1 块（L104）· C · **混合：本地 `t()` 断言 + 上游的归档/删除断言与两个新用例**

**冲突块**：移动端 sheet 的断言。
- 本地：`FORK_TRIGGER`（`/sessions\.forkSession/`）、`'sessions.renameSession'`、`'sessions.archiveOrDeleteSession'`
- 上游：`/Fork session/`、`'Rename session'`、`'Archive session'`、`'Delete session'`，外加两个新用例（archive/delete 分别触发各自 handler；运行中两者都隐藏）

**上下文**（关键：本文件的 `t` 桩）：
- 本文件顶部 `const t = ((key: string) => key) as TFunction;`（L46），**`t()` 直接返回 key 原文**。所以凡是组件里用 `t('sessions.xxx')` 渲染的按钮，可访问名就是 `sessions.xxx`；上游的 `/Fork session/`、`'Rename session'` 断言在这个桩下**不可能通过**。
- 组件里 fork 按钮（`SidebarSessionItem` L559）与 rename 按钮仍用 `t(...)` → 保留本地断言。
- 按 182 的决议，归档/删除按钮取上游的**硬编码英文**（`'Archive session'` / `'Delete session'`）→ 上游这四条断言中的后两条成立。
- 上游新增的两个用例与 182 的实现完全匹配：点 'Archive session' 只调 `onArchiveSession(id)` 并关掉 sheet；点 'Delete session' 只调 `onDeleteSession(id, name)`；`isProcessing` 时两个按钮都不渲染。这两个用例要保留（它们正是 182 行为的回归保护）。
- 公共区 `rowProps`（L60–90）已经同时带本地 props 与 `onArchiveSession`，与本决议一致。

**建议**：**混合**：
```tsx
  assert.ok(sheet.getByRole('button', { name: FORK_TRIGGER }));
  assert.ok(sheet.getByRole('button', { name: 'sessions.renameSession' }));
  assert.ok(sheet.getByRole('button', { name: 'Archive session' }));
  assert.ok(sheet.getByRole('button', { name: 'Delete session' }));
});
```
并保留上游新增的两个测试用例（`mobile archive and delete are separate actions…`、`mobile withholds archive and delete while the session is running`）。旧的 `sessions.archiveOrDeleteSession` 断言随 182 一起废弃。

### 188 · `sidebar/tests/sessionDoubleClickRename.test.tsx` 第 1 块（L22）· A · **并集（本地 props + `onArchiveSession`）**

**冲突块**：`renderRow` 里传给 `SidebarSessionItem` 的 props。
- 本地：`onDeleteSession`、`isManaging: false`、`isBatchSelected: false`、`onToggleBatchSelection`、`onTogglePinned`、`draggingSessionId: null`、`isDropHighlighted: false`、四个拖拽回调
- 上游：`onArchiveSession`、`isSelecting: false`、`isChecked: false`、`onToggleSessionSelected`

**上下文**：本用例只验证"双击标题触发重命名"，但 props 必须满足 176 定下的类型：本地那批是必填项（`isManaging`/`isBatchSelected`/`onToggleBatchSelection`/`onTogglePinned`/拖拽四项 + `draggingSessionId`/`isDropHighlighted`），`onArchiveSession` 也是必填（176 决议）。上游的 `isSelecting`/`isChecked`/`onToggleSessionSelected` 在 176 中已决定不保留，传了反而会在类型上多出未知属性（`tsc` 报 excess property）。

**建议**：**取本地那行，补 `onArchiveSession: noop`**：
```ts
    onSessionSelect: select, onArchiveSession: noop, onDeleteSession: noop, isManaging: false, isBatchSelected: false,
    onToggleBatchSelection: noop, onTogglePinned: noop, draggingSessionId: null, isDropHighlighted: false,
    onSessionDragStart: noop, onSessionDragEnd: noop, onSessionDragOver: noop, onSessionDropOnRow: noop, t: …,
```

### 189 · `sidebar/tests/sessionRowBackgroundWork.test.tsx` 第 1 块（L70）· A · **并集（三个回调整齐保留）**

**冲突块**：`renderRow` 的 props。
- 本地：`onTogglePinned: noop`、`onToggleBatchSelection: noop`
- 上游：`onArchiveSession: noop`

**上下文**：本用例的公共区已经按本地模型传了 `isManaging: false`、`isBatchSelected: false`、拖拽四件套与 `draggingSessionId`/`isDropHighlighted`，说明这行 props 是按本地类型搭的；176 决议下 `onTogglePinned`、`onToggleBatchSelection`、`onArchiveSession` 三者都是必填。上游的 `isSelecting`/`isChecked`/`onToggleSessionSelected` 不需要（也没传，符合 176）。本用例通过 `recordedOptionsProps` 断言 `SessionOptions` 收到的 `isProcessing`，与这三个回调无关。

**建议**：**并集**：
```ts
    onTogglePinned: noop,
    onToggleBatchSelection: noop,
    onArchiveSession: noop,
```

### 190 · `shared/api.ts` 第 1 块（L327）· A · **并集（本地 3 个 btw 端点 + 上游 clearSessionContext）**

**冲突块**：`/api/providers/sessions/...` 下的会话端点。
- 本地：`btwSession`（`POST …/btw`）、`deleteBtwSession`（`DELETE …/btw`）、`promoteBtwSession`（`PATCH …/btw/promote`）
- 上游：`clearSessionContext`（`POST …/clear-context`）

**上下文**：两者是不同功能的不同路由，无重名：本地 `btw` 支撑"旁问抽屉"（隐藏会话副本、关闭时丢弃、可提升为正式会话），上游 `clearSessionContext` 支撑"清空上下文"（`/clear`）。合并后的 UI 里两套功能都在（`BtwDrawer`/`useBtwSession` 与 `ClearedContextSegment`），任一缺失都会让对应调用变成 `api.xxx is not a function`。

**建议**：**并集**：本地三个 `btw*` 保留在原位置，`clearSessionContext`（含两行注释）紧随其后。

### 191 · `shared/api.ts` 第 2 块（L755）· A · **取本地（上游侧为空）**

**冲突块**：`settings` 对象尾部 + 顶层 `notifications` 端点块。
- 本地：`authEvents`（带 `signal: AbortSignal` 的登录审计查询，注释说明可取消被下一次按键取代的查询）、`}` 收尾 `settings`、整个 `notifications` 顶层块（`endpoints`/`upsertEndpoint`/`setEndpointEnabled`/`removeEndpoint`/`test`）
- 上游：**空**

**上下文**：
- 上游本轮在 `settings` 里新增的是 `notificationWebhook.*`（L746–754，公共区已合入），与本地的 `authEvents` 并列、无冲突；上游没有删除 `authEvents` 或 `notifications` 块。
- 顶层的 `notifications` 端点 API 是本地多设备通知（含 Bark）的基础，`notifications` 这个键在合并文件里**只出现一次**（`settings.notificationWebhook` 是嵌套键，不冲突）。
- 语法衔接：本块之后共享的 `  },` 正好收尾本地 `notifications` 块。

**建议**：**取本地整块**。

### 192 · `shared/constants.ts` 第 1 块（L359）· A · **并集（本地大段常量 + 上游 `ESCAPE_LAYER_SELECTOR`）**

**冲突块**：文件尾部常量区。
- 本地（170 行）：`WORKBUDDY_SETTINGS_STORAGE_KEY`、原生存储键区（`CLOUDCLI_SERVERS_KEY`/`CLOUDCLI_SERVER_NAME_KEY`/`CLOUDCLI_PICKER_URL_KEY`）、主题区（`BUILTIN_THEMES`，含 `cc-light`/`cc-dark` 与多个 overlay 主题）、`SESSION_OWNERSHIP_DRAG_MIME`
- 上游（14 行）：`ESCAPE_LAYER_SELECTOR`（`'[data-escape-layer], [aria-modal="true"], [role="menu"]'`）

**上下文**：
- 两侧内容无同名导出，纯追加冲突。本地这段被多处引用：`useBtwSession`/主题 provider/设置面板（`BUILTIN_THEMES`）、`SidebarProjectSessions`/`SidebarRecentConversations`（`SESSION_OWNERSHIP_DRAG_MIME`）、WorkBuddy 设置控制器（`WORKBUDDY_SETTINGS_STORAGE_KEY`）。
- `ESCAPE_LAYER_SELECTOR` 是上游本轮新增的 Escape 分层机制，`useEscapeToAbortSession`/代码编辑器关闭逻辑会 `document.querySelector` 它；本地侧没有等价常量。

**建议**：**并集**：本地整段保持不动，`ESCAPE_LAYER_SELECTOR`（连同 `KEYBOARD ESCAPE LAYERS` 注释分隔线）追加在 `SESSION_OWNERSHIP_DRAG_MIME` 之后。

### 193 · `shared/types.ts` 第 1 块（L126）· A · **并集（4 个字段分属两套关系）**

**冲突块**：`ProjectSession`（会话列表项）字段。
- 本地：`isPinned?`、"归到某会话下"的 `parentSessionId?`
- 上游：`forkedFromSessionId?`、`forkAncestors?`

**上下文**：这 4 个字段是**三套不同语义**，不能互相替代：
- `isPinned` 是本地置顶（`applyOptimisticSessionPinState` 等都在读写）。
- `parentSessionId` 是本地"归到某会话下"的人工归属（侧边栏一层树、拖拽、父选择器的数据源）。
- `forkedFromSessionId` 是上游分叉谱系（`buildProjectSessionTree` 的边），`forkAncestors` 是上游给 Projects 树补齐分页缺口用的祖先快照（注释明确它不参与分页与 Conversations 列表）。
- `forkAncestors?: ProjectSession[]` 在这里形成自引用，但 `ProjectSession` 是类型别名/接口内的可选字段，TS 允许。

**建议**：**并集**，顺序：`isPinned` → `parentSessionId` → `forkedFromSessionId` → `forkAncestors`（与注释分组一致）。注意 171 的树结构决策会决定 `parentSessionId` 的视觉呈现，但**类型字段必须保留**——服务端仍在返回它，且父选择器/拖拽仍在写它。

### 194 · `shared/types.ts` 第 2 块（L2076）· A · **取本地（上游侧为空）**

**冲突块**：类型定义区。
- 本地：`AuthEventType`（5 种登录审计事件）、`AuthEventRow`（snake_case 行，`user_id` 可为 null）、`SavedServer`（原生服务器列表项，`url` 为裸 origin）
- 上游：**空**

**上下文**：三者都是本地独有功能的类型：登录审计（配套 191 的 `api.authEvents` 与 149 的 `loginLog` 文案）、iOS 服务器选择器（配套 192 的 `CLOUDCLI_SERVERS_KEY` 等）。上游本轮在紧接着的公共区新增的是 `NotificationWebhookDeliveryError`（webhook 失败原因），与本块并列无冲突。

**建议**：**取本地整块**（含两段 `KEYBOARD`/`SETTINGS` 分隔注释）。

### 195 · `shared/types.ts` 第 3 块（L2193）· A · **并集（本地 `options` 签名 + 上游 `onArchiveSession`）**

**冲突块**：`SessionRowActions` 的删除/归档回调。
- 本地：`onDeleteSession: (sessionId, sessionTitle, options?: { isArchived?: boolean }) => void`
- 上游：`onArchiveSession: (sessionId: string) => void` + `onDeleteSession: (sessionId, sessionTitle) => void`

**上下文**：
- `SidebarContent.tsx`（本地归档列表）**确实按三参调用**：L163/L391 `onDelete(session.sessionId, session.sessionTitle, { isArchived: true })`，且其 props 类型（L82/L544）也声明了 `options?`。删掉 `options` 会让这两处 `tsc` 报 excess property。
- 上游新增 `onArchiveSession` 是本轮"归档/删除拆分"的入口，`SidebarSessionItem`（185）与项目行都要用。
- 注意：`isArchived` 在合并后的 `useSidebarController.showDeleteSessionConfirmation` 里**已被上游改成两参（丢弃该选项）**，且没有消费方读取它；保留三参签名是为了不改动 `SidebarContent` 的调用形态（外科手术原则），不是因为它还有行为。

**建议**：**并集**：
```ts
  /** Archives the session straight away; it stays restorable from the archive. */
  onArchiveSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string, sessionTitle: string, options?: { isArchived?: boolean }) => void;
```

### 196 · `shared/types.ts` 第 4 块（L2358）· C · **取上游的 `session` 变体，删掉 `sessions` 变体**

**冲突块**：`PendingSidebarDeletion` 的联合类型。
- 本地：`| { kind: 'session'; sessionId: string; sessionTitle: string; isArchived: boolean };`
- 上游：`| { kind: 'session'; sessionId: string; sessionTitle: string }` + `| { kind: 'sessions'; sessionIds: string[] };`

**上下文**：
- 合并后的 `useSidebarController.showDeleteSessionConfirmation`（上游版，L1141）**只写入三个字段**，没有 `isArchived` → 保留本地的 `isArchived: boolean`（必填）会让该 `setPendingDeletion` 直接 `tsc` 报缺字段。而且全仓没有消费者读取 `pendingDeletion.isArchived`（`grep` 实测），它随上游的重构变成了死字段。
- `{ kind: 'sessions' }` 变体的唯一生产者是上游的 `showDeleteSelectedSessionsConfirmation`，而 186 已决定删除上游那套 `sessionSelection` 批量系统（本地用自己的 `BatchSessionArchiveConfirmation`/`BatchArchivedSessionDeleteConfirmation` 两条确认流）。保留这个变体会留下永远不会被构造的分支。

**建议**：
```ts
export type PendingSidebarDeletion =
  | { kind: 'project'; project: Project; sessionCount: number }
  | { kind: 'session'; sessionId: string; sessionTitle: string };
```

> **产品可见变化（要写进报告）**：删掉 `isArchived` 之后，配合 158/159 的弹窗取上游版，会话删除弹窗**只剩"永久删除"**——不再有"归档"次按钮，也不再显示"该会话已归档"的提示。归档入口仍在行菜单（`SessionOptions` 的 `Archive session`、移动端 sheet 的归档按钮）与批量归档里，所以不是功能缺陷，但用户路径变了：以前可以在删除弹窗里改主意，现在不能。156 末尾的 D19 决定这些剩余入口的文案是否统一。

### 197 · `shared/utils.ts` 第 1 块（L209）· A · **取本地（上游侧为空）**

**冲突块**：工具函数区。
- 本地：`afterNextPaint()`（双 `requestAnimationFrame` 等待绘制，无 rAF 时退化为 `setTimeout 0`），用于导出长会话时先让"生成中"提示出现在屏幕上
- 上游：**空**

**上下文**：这是本地导出体验的配套工具（`chatExport` 的调用方与 transcript 选择栏在用）。上游本轮在同文件新增的是 `ESCAPE_LAYER`/通知音相关工具（在公共区），与本块无关。两侧无同名函数。

**建议**：**取本地整块**（含两段分隔注释）。

---

## R3.2 冲突块之外必须手工处理的静默丢失

逐块审完 197 个冲突后，以下问题**没有冲突标记**，但同样会让合并结果编译失败或静默丢功能，执行合并时必须一并处理：

### 1. 上游批量选择系统 vs 本地批量归档系统（DU 类）

上游本轮 `b994762e feat(sidebar): separate Archive and Delete in the session menu (#1758)` 引入了一整套 controller 级选择模型：

- `src/shared/types.ts` 的 `SidebarSessionSelection` 类型 —— 合并结果里**已不存在**（本地在此之前把它删掉了，git 按"本地删除"处理）；
- `useSidebarController` 的 `sessionSelection` state、`sessionIdsBeingDeletedRef`、`setProjectSessionSelection`/`toggleSessionSelected`/`cancelSessionSelection`/`showDeleteSelectedSessionsConfirmation`/`confirmDeleteSessions` —— 这些函数的**函数体**还在冲突块上游侧（见 186），但它们的 state/ref 声明已随本地删除而消失（`grep` 全文件确认无声明）；
- 测试文件 `src/modules/sidebar/tests/sessionBulkSelection.test.ts` 在合并里是 **DU（fork 删除 / 上游修改）**，不是"上游新文件"：它在 `13e9ef64` 基线里就存在、被 fork 在上一轮删掉了，本轮上游又改了它。DU 的现场形态是——**工作树里放的是上游版本且没有冲突标记**，所以 `tsc`/`vitest` 会像普通文件一样扫到它，而它的导入 `SidebarSessionSelection` 与两个 controller 函数在合并结果里都不存在 → **必然失败**。处置必须是 `git rm`（显式确认保持删除），不能只是"合并完再删"。

本地方案用 `BatchSessionArchiveConfirmation` + `BatchArchivedSessionDeleteConfirmation`（`SidebarModals` 两个弹窗 + `SidebarProjectSessions` 的 `isManaging`）覆盖了同一需求。**D23 已定（2026-11-17）：保留本地选择模型，但把批量弹窗补齐成"归档 / 永久删除 / 取消"**——用户要的是上游那种"选中 → 删除 → 选归档还是删"的体验，而本地选择模型还多覆盖了"最近会话"列表，换掉不划算。执行动作：

1. **`BatchSessionArchiveConfirmation` 弹窗加第二个动作**：`SidebarModals` 里该弹窗增加一个 `onConfirmBatchDelete` 按钮（`variant="destructive"`，复用 `deleteConfirmation.deleteSessionPermanently` 文案），取消按钮不变。
2. **controller 增加 `confirmBatchSessionDelete`**：与现有 `confirmBatchSessionArchive` 同构，对每个 id 调 `api.deleteSession(id, true)`（`removeSession` 已支持 `hardDelete`），逐条 `Promise.allSettled`，部分失败时保留未成功的 id 并给出提示。
3. 归档按钮保留原行为（直接归档、失败回滚选择集），删除按钮走上面的硬删路径。
4. **上游 controller 的选择 API 仍然不要**：`showDeleteSelectedSessionsConfirmation`/`confirmDeleteSessions` 的函数体随 186 删除，`SidebarSessionSelection` 类型不恢复。
5. 用 `git rm src/modules/sidebar/tests/sessionBulkSelection.test.ts` 解决 DU（它测的 API 已不存在）；执行时在报告中明确记录这条测试被移除及原因。

**删除理由（要写进 commit message / 同步报告，不能只删不记）**：该文件测的 `showDeleteSelectedSessionsConfirmation` / `confirmDeleteSessions` / `SidebarSessionSelection` 三个符号在合并结果里一个都不存在（D23 选本地模型），不是"暂时失败"，而是**测试对象已被替代**。留着它每一轮 `main-first` 都会把它重新带回来，所以需要一份**同步排除清单**：

| 文件 | 合并状态 | 每轮动作 | 原因 |
|---|---|---|---|
| `src/modules/sidebar/tests/sessionBulkSelection.test.ts` | **DU** | `git rm`（保持删除） | 测上游 controller 级选择 API，本 fork 用 `isManaging` + `Set` + 两个批量弹窗 |
| `src/modules/sidebar/tests/projectSessionTreeView.test.tsx` | A（上游新增） | 改写 props，保留断言 | 见 §5；D18 = C-lite，树断言全部保留，另补手动归类用例 |
| `src/modules/sidebar/tests/recentConversationRowActions.test.tsx` | **DU** | `git rm`（保持删除）；若要恢复则整份按本地 `ActionMenu` 重写 | 见 §5：它依赖"每行一个 `SessionOptions`"，本地行是 `ActionMenu` |

**删除后必须补的本地回归（至少 2–3 条）**，因为"运行中会话不可选/不可批删""只对部分成功给提示"是本地批量归档自己承诺的行为，删了上游测试后就没有防线：

1. `SidebarBatchSessionActions`：`isProcessing` 的行复选框 `aria-checked` 恒 false 且点击不改变选择集；
2. `BatchSessionArchiveConfirmation`：`onConfirm` 返回部分成功（`archivedSessionIds` 不含某些 id）时，只对剩余项给提示，已成功的从选择集移除；
3. `BatchArchivedSessionDeleteConfirmation`：取消不触发删除、确认只删传入的已归档集合；
4. **新增的批量永久删除**（D23）：弹窗里点"永久删除"时对每个 id 调 `deleteSession(id, true)`；其中一个失败时其余仍要执行，未成功的 id 留在选择集里并给出提示；运行中的行不会被送进删除请求。

落在 `src/modules/sidebar/tests/` 下对应的 `*.test.tsx` 里（若这几个组件目前没有测试文件，就在 `SidebarContent.test.tsx` 的既有 setup 里加用例，不新建脚手架）。

### 2. `SessionOptions` 的 `onArchiveSession` 是必填，但本地多处调用没有传

`SessionOptions`（156 决议）保留上游的归档菜单项，因此 `onArchiveSession` 必填。合并结果里实际只有一处 `<SessionOptions>` 需要补：`SidebarSessionItem`（185 已给出补法）。`SidebarRecentConversations` 的 `RecentConversationRow` 与 `SidebarContent` 都用本地自绘的 `ActionMenu`（已用 `grep '<SessionOptions'` 确认全仓只有 `SidebarSessionItem` 一处），编译上无需处理；但它们的自绘菜单**没有**"归档会话"项、标签却仍写"归档或删除"——这 6 处的处置归决策项 **D19**（156 末尾有逐处行号清单），不是"不在本次合并范围"就能带过的问题。

### 3. `selectionIcon` / `sessionIdsBeingDeletedRef` / `SidebarSessionSelection` 三处"只使用未声明"

`SidebarSessionItem` 的 `selectionIcon`（179/184）、controller 的 `sessionIdsBeingDeletedRef`/`SidebarSessionSelection`（186）——都是上游侧片段被 git 保留、而其定义所在 hunk 被本地版覆盖造成的。按 179/184/186 的建议删除使用处即可。

### 4. 顶层 JSON 重复键（`tr/chat.json`、`tr/sidebar.json`）

见 146（`message`/`composer`/`mcpElicitation`）与 151（`recent`）。这类问题**不会报错**，`JSON.parse` 静默取后者，属于最难在测试里发现的一类。

### 5. 上游新测试 vs 合并后的本地 props（零冲突，但必然红）

上游本轮新增/改写的测试有几个**直接 import 上游版组件并按其 props 构造**，而合并结果里组件保留的是本地 props。它们没有冲突标记，逐块清单发现不了，`vitest` 一跑就是整文件失败（多数还会先被 `tsc` 拦下）。逐个处置如下：

| 测试文件 | 传了但组件没有的 props | 组件必填但测试没传 | 处置 |
|---|---|---|---|
| `sidebar/tests/projectSessionTreeView.test.tsx` | `selectedSessionIds`、`onSetSessionSelection`、`onToggleSessionSelected`、`onCancelSessionSelection`、`onDeleteSelectedSessions`、`sessionActions` 里的选择字段 | `isManaging`、`onManagingChange`；`attentionSessionIds`（Set）应为 `attentionSessions`（Map） | **D18 = C-lite**：改写 `props()` 成本地签名，树结构断言（`data-session-id` 顺序、`data-fork-depth`、折叠/展开、`collapseForks`/`expandForks` 文案）全部保留；再加一条"手动归类优先"的用例 |
| `sidebar/tests/recentConversationsInfiniteScroll.test.tsx` | `sessionActions`（上游聚合对象） | `activeSessions`、`attentionSessions`、`projects`、`selectedProject`、`onRenameSession`、`onTogglePinned`、`onDeleteSession`、`onRequestBatchArchive`、`onNewSession` | **改写**：无限滚动的 5 条断言（sentinel 只触发一次、翻页后仍在视口继续加载、`hasMore=false` 停止、error 后重试、auto-load 边界）是 173 并集进来的能力，必须留；只把渲染 props 换成本地那一套 |
| `sidebar/tests/recentConversationRowActions.test.tsx` | `sessionActions`（同上） | 同上 | **DU**（fork 已删除、上游本轮修改）：`git rm` 保持删除即可。若想恢复，则整份按本地 `ActionMenu` 重写——它 mock 了 `SessionOptions` 并断言"每行都拿到共享的会话控件"，而本地行用的是 `ActionMenu`，这个前提已不存在；不恢复时把"行内菜单可用"的断言并到 `mobileSessionFork.test.tsx` |
| `sidebar/tests/sessionBulkSelection.test.ts` | —— | —— | 删除（见 §1） |

另外**必须确认 `tsc` 真的会扫到这些测试文件**：`tsconfig.json` / `tsconfig.*.json` 的 `include` 若只覆盖 `src` 而排除 `**/*.test.tsx`，上面三类问题就只能在 `vitest` 运行时才暴露，且报错点离真实原因很远。执行前先跑一次 `npx tsc --noEmit --listFilesOnly | grep -c 'tests/'`（或直接看 `tsconfig` 的 `include`/`exclude`），确认测试在编译范围内。

### 6. 4 个 DU 文件的逐个处置

DU（fork 删除 / 上游修改）不会出现在冲突块清单里，但**工作树里放的是上游版本**，必须逐个 `git add` 或 `git rm` 明确表态，否则它们会带着上游内容进入合并结果：

| 文件 | fork 侧做了什么 | 上游本轮改了什么 | 处置 |
|---|---|---|---|
| `server/modules/notifications/services/notification-orchestrator.service.js` | 改名为 `.service.ts` 并加 Bark 通道 | 加 webhook 通道（import、channel 条目、`bypassesDedupe` 与去重判断） | `git rm` 保持删除。已核对：这三处改动在 fork 的 `.ts` 里**全部已存在**（`notification-orchestrator.service.ts:9/319-329/366`），没有移植缺口 |
| `src/modules/chat/transcript/ChatExportMenu.tsx` | 删除上游导出菜单，改用本地导出 UI（`chatExport` + `afterNextPaint`，见 197） | 修改该菜单 | 取决于原文档 §7 的 **D5**：`git rm` 保持删除，或恢复上游文件并按本地导出流程重写 |
| `src/modules/sidebar/tests/sessionBulkSelection.test.ts` | 上一轮删除 | 继续修改 | `git rm`（理由见 §1） |
| `src/modules/sidebar/tests/recentConversationRowActions.test.tsx` | 上一轮删除 | 继续修改 | `git rm`（理由见 §5） |

---

## R3.3 执行与验证清单

按顺序执行，**每一步不过就不进入下一步**。行号会随解块漂移，所以定位一律用"文件 + 冲突块首行的函数/字段名"作锚点，同一文件**从底往上**解。

### 0. 开工前
- [ ] 冲突标记计数 = 197，但**必须排除记录文档自身**：`FORK_SYNC_CONFLICTS.md` 在仓库里，且内含 27 行示例标记，直接 `git grep -c '^<<<<<<<'` 会得到 224。正确写法：`git grep -c '^<<<<<<<' -- ':!FORK_SYNC_CONFLICTS*.md'`，合计应为 197。另 `git status --porcelain` 为 80 个文件（73 UU + 3 AA + 4 DU）。
- [ ] 确认预演 worktree `/tmp/fork-sync-audit` 与自己要动手的分支不是同一个（执行应在 `cloudcli-dev` 上做，预演随时可丢弃重建）。
- [ ] `npx tsc --noEmit --listFilesOnly | grep -c 'tests/'` > 0（确认测试在编译范围内，见 R3.2 §5）。

### 1. A 类一次性解完 → 建立"剩余问题清单"
- [ ] 并集、删除孤儿 import、修复自动合并缺陷（002 `sharp`、046 `os`、045 重复 `export const codexRuntime`、039 `readQuota` 签名、090 `TokenUsageSummary`、179/184 `selectionIcon`、186 `sessionIdsBeingDeletedRef`）。
- [ ] `npx tsc --noEmit` 通过。**本步不需要任何产品决策**，先让编译器把非决策性错误清空。
- [ ] 此时仍红的 C 类文件，按 R3.1 的编号列成清单，逐条对照 R3.0.1 的 D 项。

### 2. 决策落定 → 解 C 类块
- [ ] D17–D23 全部有结论（R3.0.1）。**D17/D18/D19/D22 未定不要动手**，它们会推翻已写好的融合方案。
- [ ] 按每块"建议"落地，每解完一块即跑该块点名的测试（示例：034 → `claude-runtime` 的流式/后台/steer 三组；043 → codex 完成/失败通知；092 → `chatComposerSendMenu` + `questionPanelTokenUsage`；171 → `projectSessionTreeView`）。
- [ ] 每改完一个文件，`git grep -n '^<<<<<<<\|^=======$\|^>>>>>>>' <file>` 必须为空。

### 3. 全局静态验证
- [ ] `git diff --check`（无行尾空白冲突残渣）。
- [ ] `npx tsc --noEmit`。
- [ ] `npx tsc --noUnusedLocals --noUnusedParameters --noEmit` —— **硬门槛**。它专治"只声明不赋值/只使用未声明/孤儿 import"这三类本轮反复出现的问题（043 `terminalFailure`、045 重复导出、179/184 `selectionIcon`、061 的 `providerSessions`）。噪声允许人工判读，但**不允许有未处理的新增项**。
- [ ] `npx oxlint`（基线有 1 条既有 error，只比对集合，不修既有）。
- [ ] `npm run lint:locales`（D15：只维护 en/zh-CN，其余回退）。
- [ ] JSON 重复键扫描：对所有改动过的 `*.json` 跑一次带 `object_pairs_hook` 的 `json.load` 或等价的 Node 脚本（`JSON.parse` 与 `jq` 都会静默取后者，见 R3.2 §4）。
- [ ] `npm run build:server` 成功。

### 4. 测试
- [ ] `npm test`（server）与客户端 `vitest` 跑全量，与**基线**比对：server 9 条环境失败、client 8 文件/35 条失败、1 条既有 lint error。**只看新增失败**，不修既有。
- [ ] 新增/改写的测试：R3.2 §5 的三个文件按处置落地；R3.2 §1 的三条本地批量回归补上。
- [ ] 改动涉及 UI 的块，按仓库 `AGENTS.md` 的浏览器验证流程走一次（注入 token → 断言 `getBoundingClientRect`），至少覆盖：侧边栏树/文件夹、会话菜单（归档/删除）、输入框发送菜单三态。

### 5. SDK 升级（004/005，非冲突但风险最高）
- [ ] lockfile **不手改**，以 `npm install` 重写为准，只核对 capacitor 与版本号一致。
- [ ] 用新 SDK 实跑一次 claude 会话（流式 complete、后台保持、steer、配额面板）与一次 codex 会话，再跑 opencode 历史分页（054 的 reasoning 累加若保留，重点看翻页不跳消息）。

### 6. 零冲突文件的人工过审（"干净合上"的风险面）
- [ ] 列出"两侧都改过、但预演里没有冲突标记"的文件（`git diff --name-only HEAD...upstream/main` ∩ 本地提交触达的文件），按"上游是否重命名/改签名"排序人工过一遍。重点面：provider 注册表、store 事件形状、`server/shared/types.ts`、`src/shared/types.ts`。

### 7. 收尾（**需 亮 明确同意后才做**）
- [ ] 生成合并报告：197 块处置摘要、D17–D23 的最终选择、R3.2 的删除清单（含理由）、已知 UI 文案/i18n 回退（156/182/D19）、测试基线差异。
- [ ] `git commit`（不 push）；**push 需单独确认**。

## 审阅批注（第三轮，2026-11-17）

### WorkBuddy

> [!NOTE] 规模与账面已复核。预演 worktree（`/private/tmp/fork-sync-audit`，merge 进行中）共 224 个 `<<<<<<<`，扣掉本文档自身引用的 27 个正好 **197**；`git status --porcelain` 为 **73 UU + 3 AA + 4 DU = 80 文件**，76 个带标记文件 + 4 个 DU 文件，与 R3.0 完全对得上。高风险论断也逐条抽查成立：045 的重复 `export const codexRuntime`（L1214/L1259）、039 的 `readQuota` 仍是 `async (call)`（L765，另两处已是新签名）、043 的 `terminalFailure` 只有声明与两处读取、179/184 的 `selectionIcon` 只使用未声明、002 的 `sharp` 被 `logo-svg.js` 顶掉、046 的 `os` 丢失、061 的 provider 名单分叉（L314/L373 vs L1057）、084 的 `scrollToBottom` 确实不在 hook 返回对象里、196 的 `isArchived` 在弹窗主体里已无读取。文档的现场判断是可信的，下面的问题集中在执行缺口。

> [!CAUTION] **D17–D21 被引用了 24 处，但全文没有任何一处定义。** 第一轮 D1–D10、第二轮 D11–D16 都有决策表，R3 没有。而这些不是可选的旁注：022/024/036/042/045 的动作、051/052 的删除范围、L1037 的文档改法、L1177 的 `/clear` 数据层、L1224/L1246 的 N+1 取舍都由它们决定。执行者读到“若 D17 选甲……”只能靠猜。请在执行前补 `R3 决策清单（D17–D21）`，写清每个选项（如 D17 甲=保本地 btw / 乙=接入上游侧问 / 丙=两套并存）与默认项；并把 054（reasoning 累加是否保留）和 171（树方案 A/B/C）升级为有编号的决策项——它们现在只在正文里“请亮拍板”，无法在汇总表里追踪。

> [!IMPORTANT] **171 的推荐 A 与 176/177 的 props 决议互相矛盾。** 171 要求“上游行渲染做基础”，并写 `isManaging→isSelecting`、`isBatchSelected→isChecked`；176/177 又明确决定不加入 `isSelecting`/`isChecked`/`onToggleSessionSelected`，179/184 还要求不引入 `selectionIcon`。但上游 `visibleRows.map` 的调用处（预演 L527–530）恰恰按上游 props 传参。最终必须落成一个写法：要么组件保留上游 props、调用处传 `isSelecting={isManaging}`/`isChecked={isBatchSelected}`；要么组件用本地名、调用处改传本地名。照现在的表述，执行者会在 171 与 176 之间来回改。建议在 171 末尾补一句“若选 A，176/177 的 props 契约按以下映射落地”，并给 178/179/183/184 的 `treeRow` 分支定一个明确前置条件。

> [!IMPORTANT] **R3 没有全局验证闸门。** 197 块各自有“验收”，但没有第一轮第 5 节 / 第二轮第 10 节那样的统一顺序，也没说明 D16（沿用既有失败集合）在本轮是否仍有效。建议补 `R3.3 验证清单`：① `git grep -c '^<<<<<<<'` 必须为 0、`git diff --check` 干净；② 先 `npx tsc --noEmit`（045/090/179/002/046 都是它该拦下的），再 `npx oxlint`，再 `npm run build:server`，最后按“每解完一个 C 类块先跑该块列出的测试”；③ 明确本轮全量测试与已知失败基线，否则 73 个 UU 文件解完后无法判断哪些失败是合并引入的。

> [!IMPORTANT] **R3.2 只列了 4 条已知的静默丢失，但没有办法发现未知的。** 真正的风险在“两侧都改过、却零冲突”的文件里（本轮 57 个 M + 71 个 A）：上游重构了某个 API，fork 的独有调用点仍按旧形状使用，git 会干净地合上。建议在验证阶段额外产出一张清单——`git diff --name-only` 中两侧都触及、但在预演里没有冲突标记的文件——按“上游是否重命名/改签名”排序，人工过一遍。尤其关注 provider 注册、store 事件形状、`shared/types` 这几类被 fork 大量消费的接口。

> [!WARNING] **SDK 升级被当成 lockfile 的 A 类处理，但它是本轮最大的非冲突风险。** 004 把 `@anthropic-ai/claude-agent-sdk` 从 `^0.3.165` 提到 `^0.3.311`，005 新增 `@openai/codex-sdk`。claude-runtime 的 12 个手工融合块（023–034）全部建立在 SDK 的事件/类型形状上，“合并正确”不等于“运行正确”。建议：① lockfile 不手改，最终以 `npm install` 重写为准，只保留 capacitor 与版本号一致；② 单独列为验收项——用新 SDK 各跑一次 claude / codex 真实会话（流式 complete、后台保持、steer、配额面板），再跑 opencode 历史分页；③ 若 fork 有 patch-package 或版本钉死，确认没被上游覆盖。

> [!WARNING] **建议把“孤儿符号审计”做成机械步骤，而不是依赖逐块细心。** 本轮暴露的静默丢失有四类：只声明不赋值（043 的 `terminalFailure`，tsc 不会报，因为“读一个从未赋值的 let”是合法的）、只使用未声明（179 的 `selectionIcon`、186 的 `sessionIdsBeingDeletedRef`）、重复声明（045）、定义被删而引用还在（090 的 `TokenUsageSummary`、002 的 `sharp`）。合并后建议临时跑一次 `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`（噪声多，但能把两侧遗留的孤儿挑出来），再对“只出现 1–2 次”的标识符做人工判读；JSON 重复键单独用 `json.load(object_pairs_hook=…)` 扫，因为 `JSON.parse` 和 `jq` 都会静默取后者（R3.2 §4 自己点出的坑）。

> [!WARNING] **182/187 为了对齐上游，把移动端 sheet 的归档/删除改成硬编码英文，与 fork 的 i18n 约定冲突。** 按钮写成 `'Archive session'` / `'Delete session'`，测试也按这串英文断言；而 fork 默认走 `t()`，中文界面会出现两个英文按钮，以后想本地化还得同步改测试。建议改为复用已有 key（`deleteConfirmation.archiveSession`、`deleteConfirmation.deleteSession`），测试用 `t()` 桩的 key 断言；若本轮确实只想先合上，请在 182 显式记为“已知 i18n 回退 + 后续补键”，不要让它只停在讨论里。

> [!WARNING] **R3.2 §1 建议直接删除上游 `sessionBulkSelection.test.ts`，会连带删掉一组仍有价值的回归保护。** 它测的“运行中会话不能被勾选/批量删除”和“只对部分成功给出提示”，本地批量归档同样承诺。建议二选一：① 把与 controller 无关的用例（组件级 `selectedSessionIds`、运行中行不可选）移植到本地 `BatchSessionArchiveConfirmation` 的测试；② 至少把这批断言写成清单留在 R3.2。另外建议维护一份同步排除清单（文件 + 原因 + 每轮复核），因为 `main-first` 每轮都会把该文件重新带回来，删一次不代表下轮不用删。

> [!IMPORTANT] **061 里“顺带核对 dsh/zcode/omp/openclaw 是否也读 jsonl”被写成了可选动作，但它决定 4 个 fork 独有 provider 是否丢掉 transcript 缓存与 stat 校验；漏一个就是每次历史请求全量重解析。** 尤其 dsh 刚在 `669384e3` 改过 V4 会话日志，路径行为是新的。建议升为 061 的必做验收：逐个确认 `provider_session_id` / `jsonl_path` 来源，把名单抽成常量，并在对应 provider 测试里各留一条断言。

> [!TIP] **行号会随解块漂移。** 197 条的行号指向预演现场；解掉同一文件靠前的一块，后面所有 L 号就变了。建议每个文件从底往上解，或给每块加稳定锚点（冲突首行的函数名/字段名），执行时按锚点定位。顺带一处表述纠正：090 说“合并结果的 import 指向一个不存在的模块”，实际 `TokenUsageSummary` **根本没有 import**（只有 L442/L718 两处 JSX 引用），报错是 `Cannot find name 'TokenUsageSummary'`；按“找 import”去排查会白跑一趟。

> [!NOTE] **196 删掉 `PendingSidebarDeletion.isArchived`，与 158/159 合起来会带来一个产品可见变化。** 预演现场的会话删除弹窗主体已换成上游版：不再有“Archive session”次按钮，也不再显示“该会话已归档”的提示，只剩永久删除。行为上仍可从行菜单归档，所以不算 bug，但 158 只讨论了 props 签名，没有点出这个变化。建议在 158/196 各加一句“删除弹窗只剩永久删除，归档入口在行菜单”，以免评审误以为只是类型清理。

> [!NOTE] **执行顺序补充。** 建议先把 A 类一次性以并集解掉，再用 `tsc --noEmit` 建立“还剩哪些 C 类问题”的清单。A 类里已经藏着若干必崩点（002 的 `sharp`、039 的签名、046 的 `os`、045 的重复导出），先让编译器把非决策性错误清空，C 类的讨论才不会被噪声淹没；这一步不需要任何额外决策。

### WorkBuddy · 复核 2

> [!CAUTION] **092 的“把本地那版 `PromptInputSubmit` 原样放进 else 分支”会同时挂掉两条上游新测试、复活一个上游刚修掉的 bug，并留下一个未使用的 `canAbortSession`。** 本地版（`src/modules/chat/composer/ChatComposer.tsx:571-607`）的 `disabled` 是 `isLoading ? false : …`，即“运行中永远可点”；上游版（预演文件 L815–843）则明确写了 `isTranscribing ? true : isLoading ? !isRecording && !canAbortSession : …`。对照 `src/modules/chat/tests/chatComposerSendMenu.test.tsx`：
> - L129–140 `turn running, composer empty, cannot be interrupted` 断言一键 Stop **必须 disabled** → 本地写法恒可点，红；
> - L150–170 `turn running, transcribing` 断言 `name: 'Send'` 且 disabled → 本地写法在 `isLoading` 下 `aria-label` 会算成 `Queue next message`（因默认 `input: 'hello'` 使 `canQueueDraft` 为真）、且不禁用，双重红；
> - 合并现场已在 L77/L178 自动合入 `canAbortSession`，若 submit 块整段取本地，它就只剩解构、没有使用点，`oxlint` 报 unused。
>
> 建议 092 改成“取本地骨架 + 上游的转录/不可中止分支”，`disabled` 按下面的优先级重排（`canQueueDraft` 必须排在 `isLoading` 之前，否则有输入时排队键被当成 Stop 禁用）：
> ```tsx
> disabled={
>   isTranscribing ? true
>   : isSubmitting ? true
>   : canQueueDraft ? false
>   : isLoading ? (!isRecording && !canAbortSession)
>   : isRecording ? false
>   : !input.trim() && attachedFiles.length === 0
> }
> ```
> `onClick` 同样要补 `isTranscribing ? undefined` 前置分支。这样才满足“空输入 + 不可中止 + 运行中”禁用、有输入时排队可用、转录中不可中止这三种状态。

> [!CAUTION] **至少 3 个上游独有测试文件与合并后的组件 props 对不上，而它们**没有**冲突标记，197 块的逐块清单永远发现不了。** 实测（预演 worktree）：
> - `src/modules/sidebar/tests/projectSessionTreeView.test.tsx` L25–35：传 `selectedSessionIds` / `onSetSessionSelection` / `onToggleSessionSelected` / `onCancelSessionSelection` / `onDeleteSelectedSessions` / `onNewSession` / `attentionSessionIds`，同时**缺**合并后必填的 `isManaging`、`onManagingChange`；
> - `src/modules/sidebar/tests/recentConversationsInfiniteScroll.test.tsx:77` 与 `recentConversationRowActions.test.tsx:49`：传 `attentionSessionIds: Set`，而合并后的 props 是本地名 `attentionSessions: ReadonlyMap`（`SidebarRecentConversations.tsx:36`）；
> - `sessionBulkSelection.test.ts`（R3.2 §1 已列）。
>
> 这三处都会直接 `tsc` 报“缺属性 / 多余属性”，与被删掉的 controller 函数无关，属于另一类失败。建议在 R3.2 增一节「上游新测试 vs 本地 props 清单」，逐个写清处置（改写断言 / 删除 / 移植用例），并确认 `tsconfig` 的 `include` 覆盖 `tests` 目录——否则 `tsc --noEmit` 也拦不住，只能靠 vitest 运行时爆错。这也是“只按 197 块解完就能收敛”这一假设不成立的最直接证据。

> [!IMPORTANT] **034 的 `terminalSent = true` 如果放进 `if (!turnCompleteSent && !abortPending)` 分支里，abort 路径会漏置；而 `deltaBatcher` 其实已经替你置了一次。** 预演文件 L1330–1337 的 batcher 包装在发出 `complete`/`error` 帧时**同步**置 `terminalSent = true`；因此 034 第 1 步改成 `deltaBatcher.send(complete)` 后，第 2 步再补“发送之后”会让人误以为必须写在分支内。本地内联版（HEAD `claude-runtime.provider.ts` 的 `result` 分支）是在 `if / else if` **之后、`holdForTurn` 判定之前**无条件置位——这个位置才对：用户中止时虽然没有 complete，也必须关掉 delta gate，否则后续 delta 会穿过门复活行。建议 034 明确写成「在 `settleTurnResult` 的 `if/else if` 之后、`holdForTurn` 之前无条件 `terminalSent = true`」，并同时说明 batcher 的那次置位只是 complete 路径上的冗余，不替代 abort 路径。

> [!WARNING] **归档/删除的拆分只改了 2 处，另有 5 处菜单标签仍写着“归档或删除会话”，但点下去只能永久删除。** 本地弹窗原本有归档次按钮（HEAD `SidebarModals.tsx:194-201`，`onConfirmDeleteSession(false)`），合并后弹窗主体已被上游版整体取代、该按钮消失（预演文件 L200–216 只剩 Delete permanently + Cancel）。文档只处理了 `SessionOptions`（156）和移动端 sheet（182），以下位置的 `t('sessions.archiveOrDeleteSession')` 仍在且 `onSelect` 只走删除：
> - `src/modules/sidebar/SidebarContent.tsx:202`、`:410`、`:598`、`:732`（`isArchived ? deleteSession : archiveOrDeleteSession` 的三目也一样）；
> - `src/modules/sidebar/SidebarRecentConversations.tsx:570`、`:708`。
>
> 这是本轮合并引入的用户可见回退（上一轮标签是准确的），而 156 的“取上游 'Delete session'”只在 `SessionOptions` 生效，会让同一个侧边栏里项目行菜单说英文 Delete、最近会话菜单说中文“归档或删除”却只删。建议在 156/182 旁边补一条统一决定（要么这些自绘菜单也加归档项、恢复标签语义，要么一并改成 Delete 文案），不要只改一半；同时在本轮报告中记为“已知 UI 文案未统一”。

> [!WARNING] **013 第 2 步给的 `markProviderSessionSupersededIn(db, { ...session, sessionId, reason })` 写法过不了类型检查。** 该 helper 的入参是 camelCase（`providerSessionId` / `provider` / `sessionId` / `jsonlPath`，见 `sessions.db.ts:146-165`），而会话行是 snake_case（`provider_session_id` / `jsonl_path`，见 `SESSION_ROW_COLUMNS`），且行里的 `provider_session_id` 类型可为 null。直接展开会同时出现“缺必填字段”和“多余属性”两类错误。建议在 013/015 里写成显式映射，避免执行者按字面抄：
> ```ts
> markProviderSessionSupersededIn(db, {
>   providerSessionId: session.provider_session_id,
>   provider: session.provider,
>   sessionId,
>   jsonlPath: session.jsonl_path,
>   reason: 'context_cleared',
> });
> ```
> 另外 015 第 2 步加完 `reason` 后，顺手把 `isProviderSessionSuperseded` 上方的 JSDoc（“left behind by an edit or rewind”）改成“edit / rewind / context cleared”，否则下一轮同步时又会有人以为 `/clear` 的行不该被跳过索引。

> [!NOTE] **092 第 4 步的 `hasInput: Boolean(input.trim())` 与 `ComposerSendMenu` 的契约冲突，也与同一节的 JSX 自相矛盾。** 组件注释（`ComposerSendMenu.tsx:23-25`）写明 `hasInput` 是“文本**或**附件”——Queue / Send anyway 在有附件、无文本时也要出现；而 092 的 JSX 里写的是 `hasInput={hasAnyInput}`，第 4 步却要求从 `useChatComposerState` 传 `Boolean(input.trim())`。按后者落地会让“只拖了附件”的运行中会话退回普通发送键，拿不到 Send options 菜单。建议统一为：
> ```ts
> hasInput: Boolean(input.trim() || attachedFiles.length > 0),
> onClearInput: () => setInput(''),
> ```
> `hasText` 仍由 `ChatComposer` 内部用 `Boolean(input.trim())` 传给菜单（旁问不能带附件），不要复用 `hasInput`。

> [!NOTE] **051/052 的参数顺序经核对是对的，可以放心照抄。** `agentFilterClause` 把 `SIDE_QUESTION_AGENT` 直接内联进 SQL（`opencode-session-synchronizer.provider.ts:219-221`），不带占位符；`forkIdsClause` 的 id 按 `NOT IN (?, …)` 顺序展开；`pendingForkClause` 每个 fork 两个参数按 `directory, startedAt` 顺序 flatMap。因此文档给的 `[since×3, ...forkIds, ...pendingFork.params, ...(limit)]` 与建议的 WHERE 顺序（本地三参数条件 → agent → forkIds → pending → LIMIT）严格一致。唯一要提醒的是：若 052 最终决定保留本地 `ORDER BY MAX(...)`，`content_time` 在 WHERE 里仍必须用子查询写法，不能引用 SELECT 别名。

### Kiro · `01a08b89-...`

> [!IMPORTANT] 阅读完整份文档与两轮复核批注。方案规模、现场审计方法、以及对 C 类冲突的手工融合论证都是充分的。**关键风险已被充分识别、未被掩盖**。下面的评论针对决策缺口与执行就绪。

> [!WARNING] **D17–D21 缺失与决策表不一致的后果是每块可能需要重评。** WorkBuddy 复核 2 在 092 指出的"两条上游测试立刻失败"就是例子——若事先没有清楚 D17（侧问并存 vs 取舍），执行时就会因为"compoer menu 得空出一个并存分支"而推倒重来。建议在正式执行前补一份简明的 `§ D17–D21 决策清单`，每项用 One-liner 写清默认值与备选（不必长篇幅，有矩阵表格即可）。这样三份文档就形成"全局→细节→验收"的递进，不至于执行到第 N 块突然发现前置条件没定。

> [!IMPORTANT] **171 与 176–177 的"是否保留上游行渲染"没有给出明确答案，而这决定了 `SidebarSessionItem` 的三个 props 能否联动。** 171 说"以上游行渲染做基础、逐块改造回本地语义"，听起来是要保留；但 176/177 明确"不引入 `isSelecting`/`isChecked`/`onToggleSessionSelected`"。如果真的要保留上游行渲染，这三个 props 是必然产生的；如果要避免它们，就必须回到本地的逐行渲染。建议在 171 末尾显式决定：**A. 全面采用上游行渲染 + 选择状态，但用本地名映射（`isManaging → isSelecting`）**；**B. 完全回到本地逐行、不引入上游的选择 UI**。两个方案的执行工作量不一样，B 工作量反而更小（因为本地逐行已经跑通了），但影响最终的代码路数。当前表述倾向于"A + 部分反悔"，必然导致复核 2 列出的那三个测试失败。

> [!CAUTION] **R3.2 遗漏了"删除上游 `sessionBulkSelection.test.ts` 后本地还需不需要补测"这个问题。** WorkBuddy 复核 1 建议"把用例移植到 `BatchSessionArchiveConfirmation` 测试"或"至少留清单"。这不是小事——批量操作的"运行中行不可选、只对部分成功给提示"都是本地 feature，删了 controller 测试后需要有地方防守这些回归。建议 R3.2 补一条具体动作：① `sessionBulkSelection.test.ts` 整体删除，**注明删除理由和下轮同步排除清单**；② `BatchSessionArchiveConfirmation.test.tsx` 或 `SidebarContent.test.tsx` 里补 2–3 条"不可选 + 过滤通知"的用例，链接到被删除的测试。

> [!IMPORTANT] **R3.2 的"4 条已知静默丢失"清单虽然准确，但防护不够主动。** "只声明不赋值"与"只使用未声明"这两类问题 `tsc --noUnusedLocals --noUnusedParameters` 都能自动扫出来，不需要人工 grep。建议最终验收增一步：**`npx tsc --noUnusedLocals --noUnusedParameters --noEmit` 过不了就不能算完成**。这样 043 的 `terminalFailure`、179/184 的 `selectionIcon` 就无法漏掉。JSON 重复键的扫描可以靠脚本（Python `json.load(…, object_pairs_hook=…)` 或 Node `Object.keys` 去重），也建议列入验收。

> [!IMPORTANT] **061 的"顺带核对 dsh/zcode/omp/openclaw"现在是"可选"，应升为必做验收项。** 这四个 provider 都是本 fork 独有的，一旦漏掉 `jsonl_path` 查询，每次历史请求都是全量重解析，性能会有明显跳崖。建议在 061 末尾改成"必须"，并补一个具体清单：① `readClearedContextSegment` L314 与 `readCurrentContextHistory` L373 两处 provider 白名单都加四个名字、用常量共享；② 每个 provider 在对应的 history/pagination 测试里各验证一遍 transcript cache 命中（用 sinon/mock 数一下 db 查询次数）。不然下一轮同步时会很难追溯"为什么这个 provider 变慢了"。

> [!TIP] **两轮复核都没有明确说"执行时的检查点在哪里"。** 建议加一份 `R3.3 执行清单`，按以下顺序：
> 1. **A 类全解**（并集、删除孤儿、修复自动合并缺陷如 `sharp`、`os`、`import` 错误）→ `npm install && npx tsc --noEmit` 过
> 2. **C 类决策确认**（D17–D21 拍板、手工融合论证） → 补列出具体改动位置
> 3. **分块验收**（例：034 改完就跑 claude-runtime 的流式/后台/steer 三个测试、043 改完跑 codex 完成/失败通知两个用例）
> 4. **全局验证**（`git diff --check`、`npx tsc --noEmit`、`npx tsc --noUnusedLocals --noUnusedParameters --noEmit` 过、`npx oxlint --fix auto` 或手改、`npm run build:server` 成功）
> 5. **集成测试**（跑全量测试、记录既有失败baseline、筛出本轮新增失败）

> [!TIP] **两轮复核都看到了 092 的问题（`disabled` 优先级、菜单 vs submit 二选一），但没有汇总成一个具体的改法。** 这给了我完整改法的机会。核心是：`ComposerSendMenu` 的出现条件与本地 submit 的 disabled 逻辑必须反向，且三种状态（转录中、可中止、可排队）有明确优先级。建议文档在 092 改写成（不是附加细节，而是替换原推荐）：
> - 条件：`(isLoading || activity?.background) && (input.trim() || attachedFiles.length > 0) && !isRecording && !isTranscribing`
> - disabled：优先级 `isTranscribing → isSubmitting → canQueueDraft (false)` vs 其余 → `!isRecording && !canAbortSession`
> - `onClearInput` 对应 `Boolean(input.trim() || attachedFiles.length)`（两个检查独立）
> 这样文档就从"参考实现"变成"可直接执行的伪代码"。

> [!NOTE] **013 和 015 关于 `markProviderSessionSupersededIn` 的改法需要明确类型映射，避免执行者卡在类型检查。** 当前文档给的是"直接展开"（`{...session, sessionId, reason}`），但 session 行是 snake_case 而 helper 要 camelCase，同时 `provider_session_id` 可为 null 而 helper 要非 null。建议给一段具体的映射伪代码，这样执行者就不必再猜。

> [!NOTE] **093 的 JSDoc 并集建议没有问题，但应该在执行前验证"这五个消费方真的是全部"。** 找法是 `grep -rn "ComposerMenuItem"` 按代码行分类（import、声明、使用），确认新增的 `ComposerSendMenu` 是唯一上游消费者。这是个小检查，避免后来人为"自绘菜单忽然不工作"排 2 小时查。
