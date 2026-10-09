# CloudCLI 的 MCP 管理矩阵方案

> 状态：设计稿（**S1–S7 全部已实施**；S7 后经真机验收修了一处 portal 浮层被模态遮挡的层级 bug，见 §13.11；**S8 把 Pi 纳入矩阵**，见 §15-S8）。本文件是唯一真源；实施分片与各片实施记录见 §15；外部审阅（Pi / WorkBuddy / OpenCode）的裁定与回写见 §17。
> 定位：在 CloudCLI「设置」中新增一个**跨 harness 的 MCP 管理矩阵**，把 MCP 服务器定义收归 App 侧集中存储（目录），并在界面上一键投影到各 harness 的原生配置文件。

---

## 0. 摘要

现状：CloudCLI **已有一套完整但"单 harness"的 MCP 管理**——真源是各 harness 的原生配置文件，界面是「选中一个 harness → 看它一列」。本方案在**不推倒已有适配层**的前提下，补上两样东西：

1. **App 侧目录（SSOT）**：新建 `mcp_servers` 表，集中存放 MCP 服务器定义 + 每个 harness 的启用开关。
2. **矩阵视图**：新设置主页签「MCP」，行 = 目录条目、列 = harness；点格子 = 把定义**投影**（写/删）进该 harness 的用户级配置文件。

已有资产全部复用：9 个 `McpProvider` 适配器、`sanitizeServerForResponse` 脱敏、各 harness 自己的写盘安全（原子写 / symlink 防护 / 冲突检测）、能力位表（scope / transport / 可写性）。

**范围**：目录**只做 `user` scope**；`local`/`project` 级 MCP 仍为文件原生、不进目录（见 §4、§11.3）。

---

## 1. 背景：CloudCLI 现有 MCP 能力（已读实）

| 层 | 现状 | 位置 |
|---|---|---|
| 抽象基类 | `McpProvider`：`listServers / listServersForScope / upsertServer / removeServer` + 4 个抽象方法（`readScopedServers`/`writeScopedServers`/`buildServerConfig`/`normalizeServerConfig`）；`assertScopeAndTransport` 在写入前校验 scope/transport | `server/modules/providers/shared/mcp/mcp.provider.ts:56` |
| 适配器 | 每 harness 一个：9 个（claude/cursor/codex/opencode/dsh/workbuddy/pi/zcode/omp） | `server/modules/providers/list/<id>/<id>-mcp.provider.ts` |
| 服务 | 单 harness CRUD + **全局投影**（best-effort 遍历所有 harness） | `server/modules/providers/services/mcp.service.ts:32,43,61,88` |
| REST | `GET/POST /:provider/mcp/servers`、`DELETE /:provider/mcp/servers/:name`、`POST /mcp/servers/global` | `server/modules/providers/provider.routes.ts:770,788,798,813` |
| 前端 | 单 harness 列表 + 表单 + 全局添加 | `src/modules/mcp/McpServers.tsx`、`hooks/useMcpServers.ts`、`McpServerFormModal.tsx` |
| 宿主 | 设置 → Agents → 选 harness → 分类页签 `mcp` | `.../agents-settings/AgentsSettingsTab.tsx:52`、`.../sections/AgentCategoryContentSection.tsx:143` |
| 能力表 | 每 harness 的 scope / transport / 是否可写 / 是否支持 cwd | `src/shared/constants.ts:122-197` |

**读出的三条关键语义**（决定了后续所有设计）：

1. **写盘是"按 name 增量"**：`upsertServer` 只写/改一个 name，不动文件里其它条目（`mcp.provider.ts:107-116`）；`removeServer` 只删一个 name（`:145-161`）。→ **投影天然不碰"目录里没有的条目"**。
2. **scope/transport 由各 harness 自己校验**：`assertScopeAndTransport` 在 `upsertServer` 里抛 `MCP_SCOPE_NOT_SUPPORTED` / `MCP_TRANSPORT_NOT_SUPPORTED`（`mcp.provider.ts:191-199`）。
3. **`cloudcli-` 前缀的 server 由功能开关自动写入**（如浏览器 MCP），用户不可编辑（`McpServers.tsx:64`）；harness 自管的 harness（dsh/omp）写一律被拒——闸门是**适配器在 `writeScopedServers` 里直接 `throw`**（`dsh-mcp.provider.ts:50-59`），**不是** `MCP_ADD_BLOCKED_REASON`（该常量只在 `src/` 侧消费、`server/` 内零命中，仅驱动前端"禁新增"与影响预览）。

### 1.1 现有能力位（`src/shared/constants.ts`）

- `MCP_PROVIDER_NAMES`（`:122`）：9 个 harness 显示名。
- `MCP_SUPPORTED_SCOPES`（`:135`）：**支持 `user` 的** = claude / cursor / codex / opencode / dsh / workbuddy / pi / zcode（8 个）；`omp` 为 `[]`。（`pi` 自 **S8** 起为 `['user']`——Pi 1.0+ 原生支持 MCP；在此之前它被记为 `[]`。）
- `MCP_SUPPORTED_TRANSPORTS`（`:151`）：`cursor`/`codex`/`opencode`/`dsh` 只支持 `stdio`+`http`（无 `sse`）；`claude`/`workbuddy`/`zcode` 支持全部三种。
- `MCP_ADD_BLOCKED_REASON`（`:172`）：`dsh`=`harnessManaged`、`omp`=`harnessManaged`（`pi` 在 **S8** 起为 `null`；`noNativeSupport` 这个值自此无 provider 归属，保留给未来的 harness）。
- `MCP_SUPPORTS_WORKING_DIRECTORY`（`:187`）：只有 `codex` 为 `true`。

---

## 2. 与 cc-switch 的对照及模型裁定

cc-switch 的模式正是"**App 侧 SSOT + 投影**"：`McpServer { id, name, server, apps: {claude,codex,...} }` 存 SQLite（`app_config.rs:277`），界面是「server × app」矩阵，点格子 = 写进该 app 的原生文件。

| 维度 | cc-switch | CloudCLI 现状 | 本方案 |
|---|---|---|---|
| 真源 | App 侧（SSOT）+ 投影 | 各 harness 文件（无副本） | **App 侧目录 + 投影** |
| 视图 | 矩阵（server × app） | 单 harness 列表 | **矩阵（新增主页签）** |
| scope | 仅 user | user / local / project | **仅 user（目录）**；其余保留文件原生 |
| 不支持的 harness | `McpApps` 里直接排除 → 不显示列 | 能力位表里标注 | 见 §12 禁格规则 |
| 不支持的 transport | **不在 UI 禁格，写入时拒绝 → 格子 fail** | 表单/服务校验 | **按能力位禁格**（更强，见 §12） |
| 导入 | 常驻"从各 app 导入" | 无 | **一次性种子**（无常驻功能，见 §9） |
| 同名冲突 | 按 id（=name）去重，先到者赢、不覆盖定义 | — | name 即身份；种子期冲突出提示（见 §9.3） |

**裁定**：采用 cc-switch 的"目录 + 投影"模型（用户拍板 B），但保留 CloudCLI 的 scope 语义与能力位表这两处更强的资产。

---

## 3. 目标与非目标

**目标**
- 集中存放 MCP 服务器定义（App 侧目录），一处编辑、多处投影。
- 提供跨 harness 矩阵视图，格子可点、可批量、可重试失败。
- 复用全部现有适配层与写盘安全，不绕过 `McpProvider`。
- 现有用户无感迁移：升级后自动把各 harness 的 user 级 server 灌入目录一次。

**非目标**
- **不**管理 `local`/`project` scope 的 MCP（保留文件原生，见 §11.3）。
- **不**提供常驻"从各 harness 导入"功能（只有 §9 的一次性种子）。
- **不**改动各 harness 适配器的读写实现（只新增调用方）。
- **不**做 `cloudcli-` 前缀（功能托管）server 的目录化。

---

## 4. 架构总览

```
┌──────────────────────── CloudCLI 设置 ────────────────────────┐
│  新主页签「MCP」= McpMatrix          Agents→harness→MCP（旧页）│
│  ┌───────────────────────────┐       ┌──────────────────────┐ │
│  │ 行=目录条目  列=harness     │       │ user: 只读目录视图    │ │
│  │ [ ] [✓] [ ] [✓] ...        │       │ local/project: 原样   │ │
│  └───────────────────────────┘       └──────────────────────┘ │
└───────────────┬───────────────────────────────┬───────────────┘
                │ REST (/api/providers/mcp/catalog)
        ┌───────▼────────┐         ┌─────────────▼──────────────┐
        │ mcpCatalogService│──────▶│ mcp_servers 表（SSOT）      │
        │  §6.1            │        │ id/name/config/enabled_<p> │
        └───────┬──────────┘        └────────────────────────────┘
                │ 投影（逐 harness，best-effort）
                ▼
   providerRegistry.listProviders()[p].mcp.upsertServer / removeServer（scope=user）
                │
                ▼
   各 harness 原生文件（~/.claude.json、~/.codex/config.toml、…）
```

**目录是 SSOT；文件是投影产物。** 投影复用现有适配器，因此写盘安全、脱敏、格式翻译全部不变。

---

## 5. 拍板记录（本方案依据）

| # | 决定 | 备注 |
|---|---|---|
| ① | 存储模型 = **B：App 侧目录（SSOT）+ 投影** | 投影复用适配器，天然按 name 增量 |
| ② | 入口 = **新增独立设置主页签「MCP」** | 见 §11.1 的 5 处注册 |
| ③ | 范围 = **目录只做 `user` scope** | 见 §4、§11.3 |
| ④ | 不支持的组合 = **按能力位禁格**（灰格 + hover 说明原因） | 见 §12 |
| ⑤ | 导入 = **一次性种子迁移**（无常驻 UI/路由） | 见 §9 |
| A | 旧页 user 部分 = **该 harness 的目录筛选视图，只读** | 见 §11.3 |
| B' | 旧页 **非 user scope（local/project）保留既有 full CRUD** | file-native，不进目录 |

---

## 6. 数据模型

### 6.1 表 `mcp_servers`

新增到 `server/modules/database/schema.ts`（并加入 `INIT_SCHEMA_SQL` 与 `runMigrations`，见 `migrations.ts:584`）：

```sql
CREATE TABLE IF NOT EXISTS mcp_servers (
    id TEXT PRIMARY KEY,                     -- uuid；路由身份（见 §8），不可变
    name TEXT NOT NULL UNIQUE,               -- 目录内身份（= 各 harness 文件里的 key）；UNIQUE 已隐式建唯一索引
    transport TEXT NOT NULL
        CHECK (transport IN ('stdio', 'http', 'sse')),
    -- 连接定义的规范形态：ProviderMcpServer 去掉 provider/scope/name/transport 后的形状
    -- （command/args/env/cwd/url/headers/envVars/bearerTokenEnvVar/envHttpHeaders）。
    -- 存“原始未脱敏”值——脱敏只在 REST 响应层做（见 §13.9）。各适配器自行翻译。
    server_config TEXT NOT NULL,
    -- 每个 harness 一个开关：是否把本条投影到该 harness（仅 user scope）
    enabled_claude BOOLEAN DEFAULT 0,
    enabled_cursor BOOLEAN DEFAULT 0,
    enabled_codex BOOLEAN DEFAULT 0,
    enabled_opencode BOOLEAN DEFAULT 0,
    enabled_dsh BOOLEAN DEFAULT 0,
    enabled_workbuddy BOOLEAN DEFAULT 0,
    enabled_pi BOOLEAN DEFAULT 0,
    enabled_zcode BOOLEAN DEFAULT 0,
    enabled_omp BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

设计说明：
- **`id`（uuid）是路由身份**：不可变、无特殊字符，避免用 `name` 作路径参数时含 `/`（如 `@modelcontextprotocol/server-filesystem`）需 percent-encode 而静默 404（见 §8、§17-A4）。
- **`name` 唯一即文件身份**（对齐 cc-switch 的 `id = name`，见 §2）。这样一格 = 一个 (name, harness) 对，矩阵不会出现"同名两行"。
- **`server_config` 的基准类型是 `ProviderMcpServer`（去 `provider/scope/name/transport`）**，不是 `UpsertProviderMcpServerInput`：后者多一个 `workspacePath`（`server/shared/types.ts:937`），而只做 user scope 的目录里，机器本地项目路径毫无意义、不该固化进 SSOT（`ProviderMcpServer` 本身无此字段，`:911-925`）。翻译在投影时交回各适配器 `buildServerConfig`。
- **`transport` 只存列、不进 `server_config`**：避免同表两份真源；投影时由服务层把列值合并回 input（见 §17-A2 与 Pi-P5）。
- **9 个 `enabled_<p>` 列**：镜像 cc-switch 的 `McpApps`。布尔列对 toggle 的并发原子更新更友好（一条 `UPDATE ... SET enabled_x=?`）。
  - 备注（可替代）：也可用一张 `mcp_server_enabled(server_id, provider)` 关联表。本方案取列式，理由是 toggle 频率高、列式单条 UPDATE 更简单；**代价是新增 harness 要 ALTER TABLE + migration + 常量表三处同改**（`provider_models` 的 `CHECK (provider IN (...))` 同此，`schema.ts:184`）。这条债已在 §16.3 记录。
- **不设 `description/homepage/docs/tags` 列**：矩阵与旧页共用 `McpServerFormModal`，其字段只有 name/transport/command/args/cwd/url/env/headers/envVars（已逐字段核），这四列没有任何编辑入口、恒为 NULL（§17-W7）。待确有消费场景再作为新分片补。
- 新增仓储 `server/modules/database/repositories/mcp-servers.db.ts`，并在 `server/modules/database/index.ts` 导出（照 `provider-models.ts` 的范例）。

### 6.2 与 harness 文件的关系（投影语义）

**投影是"按 name 增量"，不是"以目录为准清空重写"。** 对每条目录条目 S：

- `enabled_P = true` → `providerRegistry.resolveProvider(P).mcp.upsertServer({ ...S.config, name: S.name, scope: 'user' })`
- `enabled_P = false` → `...removeServer({ name: S.name, scope: 'user' })`

由此得到的**固有性质**（也是"能否不做导入"的前提，见 §9）：
- 文件里**不属于目录**的条目（例如 `cloudcli-*`、他人手写、或从未种子进来的旧 server）**不会被投影碰到**。
- 因此**目录从空开始也不会破坏用户现有 server**；代价是这些条目在矩阵里不可见（见 §13 风险 5）。

### 6.3 投影的失败与并发

- **best-effort**：逐 harness `try/catch`，一个 harness 写失败不阻断其它（照 `mcp.service.ts:61` 的写法）；失败聚合成逐格 `fail` 状态回报。
- **同一文件的写必须串行化（S2 必做，不是可选项）**：`writeJsonConfig` 只是一句 `mkdir + writeFile(path, JSON.stringify(...))`（`server/shared/utils.ts:928-931`）——**无 temp+rename、无锁**；claude / codex / workbuddy 的 `writeScopedServers` 都走它（`writeTomlConfig` 同理），只有 zcode 真做了原子写 + 冲突检测（`zcode-mcp.provider.ts:115-153`）、workbuddy 有 symlink 防护（`workbuddy-mcp.provider.ts:66-77`）。矩阵"点一下 = 开/关都整份重写"，批量与失败重试会连发多次，因此：① 进程写中途被杀 ⇒ 用户的 `~/.claude.json`（远不止 MCP）被截断；② 与会话中写 MCP、切换 profile 并发 ⇒ 后写者用陈旧快照覆盖前写者。服务层必须对**同一文件路径**的投影串行化（**S2 已做**），并与既有"切换供应商/项目 profile"的切换锁互斥（**S2 未做**，见下）。**更好的选择**是在 `writeJsonConfig`/`writeTomlConfig` 补 temp+rename 原子化（惠及所有消费者），实施时评估其影响面后择一（见 §13.3、§15-S2）。
  - **S2 的评估结论：本轮不补原子化，只落"逐 harness 投影串行化"。** 理由是 temp+rename 会把**目标路径上的符号链接整条替换成普通文件**——用户把 `~/.claude.json` 软链进 dotfiles 仓库是常见做法，rename 会静默断掉链接（这正是 workbuddy 适配器专门做 symlink 防护要防的场景）。而"同路径串行化"在服务层即可完成、作用域只在目录投影，不改变任何既有写盘语义。**原子化仍待办**（作为独立分片评估 symlink 语义后再定），本方案不改 `writeJsonConfig`/`writeTomlConfig`。
  - 串行化只覆盖**目录投影**这一条通道；legacy 的 `providerMcpService.upsertProviderMcpServer`、切换供应商/项目 profile 仍各自写盘（workbuddy 自带锁，其余没有）。即 §6.3 原句的"与切换锁互斥"**未实现**——项目里不存在这样的锁（全仓无 mutex/lock 工具），要做得新造一层全局文件锁，属独立议题。

- **不更新非目录条目**：投影永不 `removeServer` 一个不在目录里的 name。

---

## 7. 后端：服务层

新增 `server/modules/providers/services/mcp-catalog.service.ts`（或在 `services/mcp.service.ts` 内扩展，实施时按"单一职责"择一）。对外能力（条目一律以不可变 `id` 认，`name` 仅作显示/文件键）：

```ts
mcpCatalogService = {
  listCatalog(): McpCatalogEntry[];                                   // 目录全量 + 每 harness 开关（同步读库）
  upsertCatalogEntry(input): Promise<{ entry; outcomes }>;            // 建/改目录条目 + 投影已启用 harness
  deleteCatalogEntry(id): Promise<{ removed: boolean; outcomes }>;    // 先逐 harness 移除，全成才删行（§13.10）
  toggleCatalogApp(id, provider, enabled): Promise<{ entry; outcomes }>; // 改一列布尔（原子）+ 投影单条
  resyncCatalogToProviders(): Promise<McpCatalogProjectionOutcome[]>; // 逃生门：按目录开关重投影
  seedCatalogOnce(): Promise<{ seeded: number; conflicts: string[] }>; // §9
};
```

`outcomes: McpCatalogProjectionOutcome[]`（`server/shared/types.ts`）——逐 harness 的投影结果，供路由响应与矩阵 `fail` 态消费。

要点：
- `upsertCatalogEntry` / `deleteCatalogEntry`：**写库与投影分开**——库写成功即提交点；投影按开关逐 harness 尽力执行，失败进 `outcomes`、不回滚库（与 cc-switch"先改库再写文件 + UI fail 态"一致，受 §13 风险 2 约束）。**建**（新条目）开关全关，故无投影、`outcomes` 为空。
- **改名要连带清理**：若 `upsertCatalogEntry` 改了某条目的 `name`（`foo`→`bar`），必须先对**曾启用**的 harness `removeServer` 旧 `name`、再写新 `name`（两者在同一把逐 harness 写锁内，见 §6.3）；否则文件里会同时留下 `foo` 与 `bar` 两个 key、`foo` 从此不在目录、矩阵不可见（见 §17-O4）。**服务层已实现该清理路径**，所以 §16.5 的"UI 是否锁掉改名"从此纯粹是 UI 取舍，不再是正确性开关。
- `toggleCatalogApp`：先**原子地**改一列布尔并取回权威行（避免并发 toggle 互相覆盖），再投影该单条。**投影失败不回滚开关**——开关是用户意图，`fail` 格可由重试或 `resync` 收敛。
- `resyncCatalogToProviders`：按目录开关重投影，`enabled` 则 upsert、否则 remove；逐 harness 返回 outcome。**只遍历"至少有一条启用条目"的 harness**：从未被目录写过的 harness 没有残留要清（§6.2 的增量语义），而结构性不可写的 harness（无 `user` scope 的 `omp`、自管的 `dsh`；`pi` 自 S8 起有 user scope，不再属于此列）永远拿不到启用条目——遍历它们只会造出一批**任何重试都清不掉**的失败 outcome（§14 的"失败被聚合回报"会被这些噪声淹没）。
- **脱敏归属**：目录读写用**原始值**，脱敏（`sanitizeServerForResponse`）只发生在**响应组装层**（见 §6.1、§13.9）。目录没有绑定某个 harness，故服务端复用共享的 `redactMcpValues`（`mcp.provider.ts`，S7 起导出）而非某个适配器的 `sanitizeServerForResponse`；**四条出参路径**（`listCatalog` / `upsertCatalogEntry` 建与改 / `toggleCatalogApp`）都经过它（§15-S7 第 2 条）。反向的"还原创"同样在服务层：编辑载荷里回显的 `<redacted>` 要与**库内已有原始值**对照还原后再落库（复用 `restoreRedactedMcpValues`，`mcp.provider.ts:37`），否则占位符会被当成真值存进 SSOT、再被投影字面写进 harness 文件。
- 依赖方向：`mcpCatalogService` → `providerRegistry`（既有）→ 各 `McpProvider`。路由只做解析与转发。


---

## 8. 后端：路由

新增到 `server/modules/providers/provider.routes.ts`，统一挂 `/api/providers`（`server/index.ts:247`）。**采用独立前缀 `mcp/catalog`**，避开既有 `/:provider/mcp/servers`（3 段）与 `mcp/servers/global`（3 段）的语义：

```
GET    /api/providers/mcp/catalog                 → { entries: McpCatalogEntry[] }
POST   /api/providers/mcp/catalog                 → { entry, outcomes }   // 建/改条目
DELETE /api/providers/mcp/catalog/:id             → { removed, outcomes }
POST   /api/providers/mcp/catalog/:id/toggle      → { entry, outcomes }   // body: { provider, enabled }
POST   /api/providers/mcp/catalog/resync          → { outcomes }         // 逃生门
```

- **每条写路由的响应都必须带 `outcomes`**（`McpCatalogProjectionOutcome[]` = 逐 harness `{ provider, action: 'upsert'|'remove', ok, error? }`）：§11.1 的四态里有 `fail`，而失败态**推不出来**——目录只存开关，"这次写文件成没成"只存在于投影那一刻，只能由响应回报（§14 也要求"失败被聚合回报"）。`toggle`/`upsert` 的 `outcomes` 只含本次真正尝试的 harness。
- **`DELETE` 的 `removed` 为 `false`** 表示"有 harness 拒绝移除、目录行被保留"（§13.10 的选项 2，避免留下矩阵与 `resync` 都够不着的孤儿）。`removed: true` 才是行已删。

- **路径参数用 `:id`（uuid），不用 `:name`**：MCP 常见名含 `/`（如 `@modelcontextprotocol/server-filesystem`），用 `:name` 时客户端必须 percent-encode、漏了就静默 404；且 Express 会自动 percent-decode、`readPathParam`（`provider.routes.ts:28-41`）只做类型检查不解码，name 在"路由 → service"间会经历一次未声明的归一（§17-A4：WorkBuddy-W6 / OpenCode-O5）。uuid 无特殊字符，天然规避。
- **路由顺序注意**：`/mcp/catalog`（2 段）与 `/:provider/...`（均 ≥2 段但次段不同）路径不重叠，Express 不依赖顺序；但本项目有过"顺序坑"，实施时仍**加一条测试钉住**（见 §14）。
- 薄路由：`parseProvider` / 载荷解析 → service → `createApiSuccessResponse`。业务逻辑、写盘、编排一律在 service（`backend-module-standards` §45-50）。
- **`GET` 返回的是目录 + 每 harness 开关**；"某 harness 能否接收本条"由前端按能力位计算（§12），后端不重复下发。
- **载荷校验**：把既有 `parseMcpUpsertPayload`（`provider.routes.ts`，直连路由用）的连接字段读取抽成 `parseMcpConfigFields`，目录条目载荷从**嵌套的 `config`** 读同一批字段，并固定 scope 为 `user`（目录没有 scope 维度）。

---

## 9. 一次性种子导入（决定 ⑤）

### 9.1 形态

**不是常驻功能**：不新增"导入"路由、不在 UI 放按钮、不做增量对账。只在服务端启动时跑一次（`server/index.ts` 的 `startServer()` 内、`initializeDatabase()` 之后）：

```ts
// 启动侧只负责调用与告警；"跑一次"的守卫在服务内部（见下）
const seeded = await mcpCatalogService.seedCatalogOnce();
if (seeded.conflicts.length) {
  console.warn('[WARN] MCP catalog seed found conflicting definitions for:', seeded.conflicts.join(', '));
}
```

- **幂等守卫放在服务内部**：`seedCatalogOnce()` 自己读写 `app_config` 的标记键（`mcp.catalog.seeded`），经可注入的 flag store（默认 `appConfigDb`）；已跑过则直接返回 `{ seeded: 0, conflicts: [] }`，连 harness 都不读。**不放在启动脚本里**，是为了让"跑一次 / 已跑过就跳过"能被单测覆盖（§14）；启动侧只做 `try/catch` 不阻断启动 + 冲突告警。
- **只种子"可写回"的 harness**：判据是适配器自己的 `listWritableScopes()`——基类默认＝`supportedScopes`，`dsh` 覆写为 `[]`（可读不可写）；`omp` 本就无 scope（`pi` 自 S8 起为 `['user']`，因此会像其余 harness 一样参与种子）。**不引用** `MCP_ADD_BLOCKED_REASON`——那是前端常量、`server/` 内零命中（§17-A3；dsh 的真闸门是 `writeScopedServers` 直接 `throw`）。否则会给 dsh 灌入"读得到、删不掉、改不了"的死行。
- **走 raw 读取路径**：种子用新增的 `listRawServersForScope('user')`——它不经 `sanitizeServerForResponse`，故 `env`/`headers`/`envHttpHeaders` 仍是原值。若用 `listServersForScope`，入库的就是 `<redacted>`，投影时会把占位符字面写进 harness 文件（§17-P1、§13.9）。
- **逐 harness best-effort**：某个 harness 的配置文件损坏（`readJsonConfig` 对非法 JSON 会 `throw`）只跳过该 harness，不阻断其余；它保持 file-native、不进目录。
- **可重入**：行写入前先按 name 查重，跳过已存在的条目——若上一次种子在设置标记前崩溃，重跑不会因 `UNIQUE(name)` 失败。
- **不回写任何文件**：种子只入库（与"导入是单向的"一致）。

### 9.2 为什么不做"业务代码"也可行

因为投影是**按 name 增量**（§6.2）：
- **方案 i（零导入）**：目录从空开始，现有 server 仍照常工作。矩阵只读目录，故这些条目在矩阵里看不见；旧页 user 段作为"未纳管文件条目"仍可见（只读，见 §11.3 / §13.5），但要纳入矩阵管理需手动重加。真正的零导入代码。
- **方案 ii（本方案）**：一个受 `app_config` 标记守卫的一次性启动任务，跑完即止，**不进任何产品路径、无常驻 UI/路由、后续可删**。

### 9.3 同名冲突（决定 ⑤ 与 Q5）

- 目录内 `name` 唯一 → **不存在"同名两行"**。
- **种子期的真实冲突**：同一 name 在不同 harness 的 user 文件里**定义不同**。cc-switch 的做法是"先到者赢、不覆盖定义、连提示都没有"（`services/mcp.rs:470-480`）。本方案**更严格**：种子保留先到者定义，把冲突 name 收集进 `conflicts` 并在启动日志 `warn`，且**只对"定义所属的那个 harness"置 `enabled_<p>=1`、其余保持 0**。绝不能对**每个**出现过该 name 的 harness 都置 1——否则后续任何 toggle/resync 都会用 `upsertServer` 把先到者那份定义写进另一 harness，静默改写用户的配置，且这属于"目录合法行为"、连 resync 都不报错（见 §17-W5）。
- **同名同定义则合并**：若两个 harness 报出的定义**一致**，则该条目对**两者都**置 `enabled_<p>=1`（投影写回的是同一份定义，是幂等的）——这与上面的冲突分支互斥，由定义是否相等区分。定义相等性按 harness 无关形态逐字段比较，并把空/缺省字段归一（见 §15-S3 记录）。

---

## 10. 前端：主页签注册（决定 ②）

新增主页签 `mcp`，**必须同步改 6 处**（缺一处导航/校验/分发就不一致）：

1. `src/shared/types.ts:1561` — `SettingsMainTab` 联合类型加 `'mcp'`。
2. `src/shared/constants.ts:59` — `SETTINGS_MAIN_TABS` 加一项 `{ id: 'mcp', label: 'MCP', keywords: 'mcp model context protocol servers', icon: Server }`（顶部补 `Server` 图标 import）。**这一处同时驱动命令面板**（`CommandPalette.tsx:260`）。
3. `src/modules/settings/SettingsSidebar.tsx:19` — `NAV_ITEMS` 加 `{ id: 'mcp', labelKey: 'mainTabs.mcp', icon: Server }`。
4. `src/modules/settings/hooks/useSettingsController.ts:73` — `KNOWN_MAIN_TABS` 加 `'mcp'`。
5. `src/modules/settings/Settings.tsx` — 新增 `import McpMatrix...` 与 `{activeTab === 'mcp' && <McpMatrix ... />}` 分支（照 `:247-315`）。
6. i18n — `settings` namespace 的 `mainTabs.mcp`（**en + zh-CN 两端**，见 §11.4）。

---

## 11. 前端：组件与改造

### 11.1 新矩阵页（`src/modules/mcp/`）

在**现有 `src/modules/mcp/` 内扩展**，不新建平行模块（`frontend-module-standards` §27）：

```
src/modules/mcp/
|-- index.ts                 // barrel：McpServers + McpMatrix（按需）
|-- McpMatrix.tsx            // 行/列容器、搜索、列头批量
|-- McpMatrixCell.tsx        // on/off/fail/disabled 四态
|-- hooks/useMcpCatalog.ts   // 目录读取 + toggle/upsert/delete mutation
|-- hooks/useMcpServers.ts   // （既有）单 harness 读取
|-- McpServerFormModal.tsx   // （既有）表单，矩阵与旧页共用
-- tests/
```

- **行 = 目录条目**；**列 = harness**（列集合见 §12）。
- **四态单元格**：`on`（已投影）/ `off` / `fail`（写失败，⚠ 可重试）/ `disabled`（能力位不允许，灰格 + hover 原因）。这与 cc-switch 的 `on/off/fail` 同构，多出 `disabled`（我们比它强的一档，决定 ④）。**取值优先级 `disabled` > `fail` > `on`/`off`**（能力位是终局判据，不可能"写失败"在一个本就拒写的格里）；**`fail` 格的点击语义是"重放这次写入想达到的值"，不是取反**（开关已按用户意图落库，取反会把意图反过来执行），与 cc-switch `UnifiedMcpPanel.tsx:286-289` 的 `failure.desired` 同构 —— 因此"把一个失败的格关掉"没有格级入口，靠行级/列级批量（S5b）或 `resync`（S7）。实现在 §15-S5a。
- **写进行中的呈现（第五种呈现，文档原未列）**：写期间该格 `aria-busy` + 惰性 + 降透明度，防连点。`McpMatrixCell` 加可选 `isBusy`（默认 `false`，S4 契约不变）。见 §15-S5a。
- **列头**：点开批量菜单（本列全开/全关），作用范围跟随搜索（现行写法），执行后给**面板内局部撤销条**（原写"撤销 toast"——本仓无 toast 基础设施，§16.7 已裁定取 (a)；**S5b 已实施**）。
- **行操作**：编辑与新增（**S5c 已实施**，都复用 `McpServerFormModal`：写目录 → 服务端再投影到该条目已启用的 harness；表单载体裁定见 §16.9）、删除（删目录 + 从所有 harness 移除）、启用全部/关闭全部（删除与行级批量 **S5b 已实施**）。**新增入口在面板标题右侧**（§16.8 裁定并入 S5c，不单列片）。
- **搜索范围是显式 allow-list**：只搜非机密字段（`name` / `command` / `args` / `cwd` / `url`）；`env` / `headers` / `envHttpHeaders` / `bearerTokenEnvVar` **永不进搜索词**（可能含密钥）。当前 `src/modules/mcp/` 尚无搜索功能，此为**新增要求**、无现成基线可抄（原文误引了 cc-switch 的 `UnifiedMcpPanel.tsx`，该文件在本仓不存在，见 §17-W2）。**S4 已按本条原样实施**（`mcpMatrixRules.ts` 的 `getSearchText`，正负两张清单都逐字照此，未扩面）。
- **编辑路径也要禁格（决定 ④ 的缺口）**：§12 的禁格只覆盖"点格"；行内"编辑"保存时若新 `transport` 与某些**已勾选列**不兼容（如把条目改成 `sse`，而 `cursor`/`codex`/`opencode` 已勾选），**保存时自动取消这些列的勾选并在提交后提示**（默认规则；备选：在表单里就按已勾选列求交集、限制 transport 选项）。不允许"编辑绕过禁格"把不支持的定义投影出去（§17-O6）。**S7 已按默认规则实施**（顺序＝先保存后取消，记录见 §15-S7 第 3 条）。
- **`fail` 态必须由响应回报**：`toggle` 与 `upsert` 的 `outcomes` 是 `fail` 格的唯一来源——"这次写文件成没成"只存在于投影那一刻。**原文只点了 `toggle`，S5c 因此漏了 `upsert`**：把响应里的 `outcomes` 丢掉，一次被拒的投影会表现为"已完成"。S7 已补齐（§15-S7 第 4 条）。
- **脱敏**：**响应读取**走 `sanitizeServerForResponse`（`mcp.provider.ts:165`），`env`/`headers`/`envHttpHeaders` 显示 `<redacted>`；编辑提交时靠 `restoreRedactedMcpValues` 还原（`:37`）。**但目录库内保存的是原始值**（§6.1、§13.9）。**目录一侧的正向脱敏是 S7 才补上的**：S1–S5 只做了还原方向，`listCatalog`/`upsertCatalogEntry`/`toggleCatalogApp` 当时原样返回原始定义（§15-S7 第 2 条）。
- **`cloudcli-` 前缀**：不在目录里，故不出现在矩阵（见 §13 风险 5）。

### 11.2 缓存失效

现有 `useMcpServers` 有**模块级 30s 缓存** `mcpServersCache`（`useMcpServers.ts:66`，TTL 见 `:65`），是模块私有 `Map`、外部不可直接触达。矩阵 toggle 成功后**必须失效**对应 `cacheKey`（文件内 `:455`/`:483`/`:511` 已有 delete/clear 先例），否则旧页 user 视图读到旧值。**交付物**：从 `useMcpServers.ts` 导出一个失效函数（如 `invalidateMcpServersCache(provider?)`）供 `useMcpCatalog` 调用——列入 §15-S5。

**S5a 实施记录**：落点即该文件顶部导出。**注意键不是"一个 harness 一个键"**：`getCacheKey` 产出 `${provider}:${sortedProjectPaths}`（`useMcpServers.ts:231-234`），所以按 provider 失效**必须按 `${provider}:` 前缀匹配**（`projectKey` 为空时键就退化成 `claude:`）；省略 provider 则 `clear()` 全清（对应 §11.3 的"全局添加会重写每个 provider"）。**只在写入成功时失效**：`ok:false` 时文件未被改动，且 `fail` 态本身要留给用户重试（见 §15-S5a）。

### 11.3 旧页改造（`McpServers.tsx`，决定 A / B'）

现状：一张列表把 **user/local/project 混在一起**展示（scope 徽标区分），有一个 `ActionMenu`，其两项是 `global`（全局添加）与 `provider`（本 harness 添加）——**没有 scope 维度**（`McpServers.tsx:167,175`）；scope 是在表单里选的（`McpServerFormModal` 的 `availableScopes`）。

改造：
- **user scope 段 → 只读**：展示两部分的并集，**均只读**（这是 §13.5 与 Pi-P2 矛盾的正式解法）：
  1. **目录条目**：目录中勾选了本 harness 的条目，标"由 MCP 矩阵管理"并提供跳转；
  2. **未纳管的文件条目**：该 harness user 文件里存在、但不在目录中的条目（`cloudcli-*` 托管项、手写项），标"未纳管（只读）"。
  两部分都隐藏 Edit/Delete——user 的统一编辑入口在矩阵页。
- **`ActionMenu` 两项保持可用，只从表单里去掉 `user`**：原文"停用 ActionMenu 的两条新增"与代码不符——ActionMenu 无 scope 维度，按字面停用会连 local/project 的新增一起停掉，恰与决定 B' 相反（§17-W4）。
- **表单 scope 选项去 `user` 的落点**：**不要**改 `MCP_SUPPORTED_SCOPES`——§12 的"支持 user 才出列"判据依赖它，改了会让 claude/cursor/… 的列全消失、旧页 user 只读视图也失去依据。正确做法是在**表单边界传一个剔除 `user` 的 `supportedScopes`**：该 prop 已存在（`McpServerFormModal.tsx:22,96`），`McpServers.tsx:339` 传 `MCP_GLOBAL_SUPPORTED_SCOPES` 就是先例（§17-W3）。
- **local/project scope 行 → 原样保留**：照旧可新增/编辑/删除，file-native、直写文件（`POST/DELETE /:provider/mcp/servers`）。
- 数据来源：旧页同时渲染"目录 user 段（只读）"与"文件 local/project 段（可写）"，实施时**分段渲染、不混**。

**S6 实施记录（三处超出本节字面的裁定 + 一处已回写）**：
- **去重按 `name`**："两部分的并集"落地为"目录已启用条目 ∪ 文件名不在该集合里的条目"，同名只渲染目录行一次——否则同一台服务器会出现两行。
- **目录行从目录渲染、不读文件**：投影失败时文件里没有该条目，若从文件渲染它就消失了，而"它已被勾选"才是要传达的事实。
- **两个表单都去掉 `user`**（本节只说"表单"，而 `ActionMenu` 的两项都开 user-capable 表单）；**跳转做成段级入口**（user 段标题右侧），未传 `onOpenMcpMatrix` 则整条链接不渲染。详见 §15-S6。
- **§13.5 与本节的矛盾已按"并集（去重）"正式解法收口**（Pi-P2），两节现在同口径：非目录条目（`cloudcli-*`、手写项）仍在旧页 user 段可见、只读。

### 11.4 i18n

- `settings` namespace，**en + zh-CN 两端同时加**（键集基准是 `en`）：`mainTabs.mcp` + 新块 `mcpMatrix.*`（标题、列头 aria、四态标签、批量弹层、失败提示、只读提示、禁格原因 tooltip）。
- 沿用既有 `mcpServers.*`（旧页）命名；矩阵用 `mcpMatrix.*`。
- **新增 `src/shared/` 文件时**须同步登记 `.oxlintrc.json` 的 `frontend-shared-file` 白名单，否则每个 import 它的文件各报一条 `boundaries/no-unknown` **error**（本项目踩过）。

---

## 12. 能力位禁格规则（决定 ④）

矩阵**只针对 user scope 目录**，故列与格的可用性完全由能力位决定；但**能力位的真源分两处**，实现时别混：

- **前端能力表**（`src/shared/constants.ts`）：`MCP_SUPPORTED_SCOPES`（`:135`）、`MCP_SUPPORTED_TRANSPORTS`（`:151`）、`MCP_ADD_BLOCKED_REASON`（`:172`）——驱动**列的存在与格的禁用**。
- **后端真闸门**：各适配器的 `assertScopeAndTransport`（`mcp.provider.ts:191-199`）与 `writeScopedServers` 的 `throw`——是**防前端绕过的第二道闸门**。注意 `MCP_ADD_BLOCKED_REASON` **只在 `src/` 侧消费**，`server/` 内零命中（§17-A3 / WorkBuddy-W10）。

**列（harness）**
- 支持 `user` scope 才可能成为可写列：`MCP_SUPPORTED_SCOPES[p].includes('user')`。
- `omp`：`MCP_SUPPORTED_SCOPES` 为 `[]` → **不出列**（无法接收任何 user 写入；对齐 cc-switch"不支持 MCP 的 app 不显示列"）。
- `pi`：**S8 起有 `user` scope（Pi 1.0+ 原生支持 MCP）→ 出列**；transport 表只给 `stdio`/`http`，故 Pi×`sse` 走本节的 transport 禁格分支（`getCellDisabledReason` 的第二条判据），格子显示"该 transport 不支持"而非点了才报错。
- `dsh`：**整列只读/禁用**（harness 自管）。其写被拒的真闸门是 `DshMcpProvider.writeScopedServers` 直接 `throw`（`dsh-mcp.provider.ts:50-59`），前端据此禁格。
- 默认可写列 = **claude / cursor / codex / opencode / workbuddy / zcode**（6 列）。

**格（条目 × harness）**
- 该 harness 不支持该条目的 `transport`（如对 `sse` 条目：`cursor`/`codex`/`opencode` 不支持）→ **禁用格**，hover 显示原因（如"Codex 不支持 SSE"）。
- 其余情况可点。

**禁格必须覆盖"编辑路径"，不只是"点格"**：行内编辑把 transport 改成某已勾选列不支持的组合时，须按 §11.1 的规则自动取消勾选（或限制表单选项），否则编辑会绕过禁格把不支持的定义投影出去（§17-O6）。**S7 已实施**：保存后对不兼容的已勾选列逐个取消勾选并提示（§15-S7 第 3 条）；写清一条边界——服务端适配器本来就会在 `upsertServer` 首行拒掉不支持的 transport，所以"投影出去"实际不会发生，本条的收益是**不留 `fail` 死格 + 明确告知**，不是补上一个会漏的闸门。

> 与 cc-switch 的差异（用户问过）：**cc-switch 不在 UI 禁格**——它对 Pi×SSE 是"允许点、写入时适配器报错 → 格子转 fail"（`pi.rs:89-95`）。本方案改为**事前禁格 + 说明原因**，因为 CloudCLI 已有 `MCP_SUPPORTED_TRANSPORTS` 这张表，禁格体验优于"点了才报错"。

**待定（本方案默认值，见 §16 开放项）**：是否把 `dsh` 列也**隐藏**（而非只读展示）。默认**保留 dsh 列但整列禁用**，以贯彻"禁格"。**S4 已按默认实施**（`dsh` 列存在、整列 `disabled`，hover 说明 `harnessManaged`）。

---

## 13. 风险与取舍

1. **双真源漂移**：目录（SSOT）与文件可能不一致——harness 自管、`cloudcli-*` 自动写入、用户手改文件都会造成。缓解：投影是幂等的、可重放；`resync` 是逃生门；但**"文件 → 目录"方向的漂移不自动收敛**（这是不做常驻导入的必然后果）。
2. **写库与写文件的顺序**：本方案"先写库、再投影"，写文件失败时库已变，靠 UI `fail` 态 + 重试/resync 兜底（与 cc-switch 多数 harness 一致）。若某 harness 更适合"先写文件再入库"，实施时单独评估。
3. **写盘并非处处安全——不能靠"适配器"这个词背书**：只有 zcode 真做了原子写 + 冲突检测（`zcode-mcp.provider.ts:115-153`）、workbuddy 有 symlink 防护（`workbuddy-mcp.provider.ts:66-77`，但也无原子、无锁）；**claude / codex 的 `writeScopedServers` 走 `writeJsonConfig`/`writeTomlConfig`，即 `mkdir + writeFile`，无 temp+rename、无锁**（`server/shared/utils.ts:928-931`）。矩阵"点一下 = 整份重写"，故 **S2 必须做同一文件路径的投影串行化**（§6.3），并优先评估在 `writeJsonConfig`/`writeTomlConfig` 补原子化（§17-W1）。
4. **脱敏**：响应读取经 `sanitizeServerForResponse`，`env`/`headers`/`envHttpHeaders` 显示 `<redacted>`，编辑还原；**但目录库内存原始值**（见 9）。
5. **非目录条目在矩阵不可见，但仍在旧页 user 段可见（只读）**：`cloudcli-*`、手写、未种子进来的 server 不会出现在矩阵（矩阵读目录）；它们在该 harness 旧页的"未纳管（只读）"段列出，浏览器 MCP 等托管项照旧只读（§11.3）。
6. **scope 边界**：只做 user；`local`/`project` 不在目录，旧页保留 full CRUD。矩阵与旧页因此是"目录视图 + 文件视图"两段并存，UI 需明确区分。
7. **缓存**：`useMcpServers` 的 30s 模块缓存与矩阵共享时须失效（§11.2）。
8. **种子不可逆性**：种子只入库、不回写文件；一旦目录被用户改动，文件与目录会分叉（属正常 B 模型行为）。
9. **目录库装原始机密（务必落实）**：`server_config` 存**未脱敏**的 `env`/`headers` 等；脱敏只在 REST 响应层做。若沿用"经 `listServersForScope` 读种子"的写法（它过了 `sanitizeServerForResponse`），入库的就是 `<redacted>`，投影落到"文件条目已被删"的场景时会把占位符字面写进 harness 文件、**密钥永久丢失**（§17-P1）。这是本方案最高优先的正确性约束。
10. **改名 / 删除的残留**：改名不清理旧 name ⇒ 文件里留孤儿键（§17-O4）；删除"先删目录行、后逐 harness remove"在中途失败时会留下不可见、也救不回的孤儿（§17-P6）。删除应返回逐 harness outcome 并在 UI 明示残留，或改为"先逐 harness remove 成功、最后删目录行"。
11. **portal 浮层丢在模态之下（S7 真机才暴露，已修）**：`McpMatrix` 的行内 `…` 与列头批量都用 `ActionMenu` 的 `portal`（渲染到 `<body>`），而 `ActionMenu` 的 portal 菜单默认 `z-[70]`；`Settings` 弹窗同样 portal 到 `<body>` 且为 `z-[9999]`（`Settings.tsx:208`）。两者同处 body 层叠上下文 ⇒ **菜单被弹窗整片盖住**：手机端弹窗全屏，点 `…` 像"完全没反应"，这正是 S7 编辑路径真机上没被触发的原因。修复＝两处加 `menuClassName={MATRIX_MENU_CLASS}`（`z-[10000]`）；守卫＝`mcpMatrix.test.tsx` 两条断言（行/列菜单 className 含 `z-[10000]`）。**同类隐患**：任何在 `z-[9999]` 模态内使用 portal 菜单的组件都要显式抬 z（`ProviderSkills` 的 `DialogContent` 已用 `z-[10000]` 规避）。

---

## 14. 验收与测试清单

**后端（`server/modules/providers/tests/mcp-catalog.test.ts`，node:test）**
- 路由存在性与**顺序**：`GET /mcp/catalog` 不被 `/:provider/...` 误匹配；`mcp/servers/global` 不受影响（各一条）。
- **路由用 `id`**：`DELETE /:id`、`POST /:id/toggle` 命中；含 `/`、空格的名字（如 `@a/b c`）经 `id` 往返无损。
- 目录 CRUD：建/改/删；`name` 唯一冲突被拒。
- **改名清理**：`foo`→`bar` 后，所有曾启用 harness 的文件里只留 `bar`、不留 `foo`（若实现选择"禁止改名"，则断言改名被拒）。
- toggle 原子性：并发 toggle 同一条目不同 harness，最终状态正确。
- 投影 best-effort：某 harness 写失败时其它 harness 仍成功，且失败被聚合回报。
- **投影串行化（§6.3）**：并发触发对同一文件的两次投影，最终文件是完整 JSON（不被截断/交错覆盖）。
- **投影不碰非目录条目**：文件里预置一个非目录 name，投影后它仍在。
- 能力位闸门：对不支持的 (scope/transport) 组合，服务层抛 `MCP_*_NOT_SUPPORTED`（不依赖前端常量）。
- **种子（§9）**：`app_config` 标记缺失时跑、存在时跳过；**不改文件**；**排除不可写 harness（dsh/omp）与无 user scope（omp）**（`pi` 自 S8 起有 user scope，参与种子）；**存原始值**（`env` 断言非 `<redacted>`）；同名不同定义进 `conflicts` 且**只有定义所属 harness 的 `enabled` 为 1、其余为 0**。
- 测试基建：`os.homedir` 覆写 + `fs.mkdtemp` 临时目录（照现有 MCP 测试范式）。

**前端（`src/modules/mcp/tests/McpMatrix.test.tsx`，vitest + RTL）**
- `vi.mock('@/shared/api')` + 稳定 `t`。
- 四态渲染：on/off/fail/disabled 各自外观与可点性。
- 禁格规则：`sse` 条目对 codex/cursor/opencode 显示 disabled + 正确 tooltip；`dsh` 列整列禁用。
- **编辑路径禁格（§11.1/§12）**：把已勾选 codex 的条目改成 `sse` 保存 → codex 勾选被取消（或表单不允许），并出现提示。**（S7 已覆盖；用例同时钉住"兼容的 claude 不被取消"与"提示只在真取消时出现"）**
- **`resync` 逃生门（S7 补）**：一次被拒的投影 → 点格转 `fail`；`resync` 成功返写 ⇒ 该格回落 `on/off` 且缓存失效；同一 harness 有任一失败 ⇒ 保留 `fail` 并在错误条指名它；目录为空 ⇒ 按钮禁用。
- **`upsert` 的 `outcomes` 也要进 `fail` 态（S7 补，S5c 漏项）**：保存后某 harness 拒绝投影 ⇒ 该格 `fail`（含原因）且**不**失效它的缓存；点格重放同一值。
- **目录响应脱敏（S7 补）**：`GET /mcp/catalog` 与写入响应里 `env`/`headers`/`envHttpHeaders` 为 `<redacted>`，而库内与投影仍是原值（三处断言）。
- 批量：列头全开/全关作用于当前搜索范围；撤销 toast。
- 缓存失效：toggle 后旧页 user 视图刷新（可断言导出的失效函数被调用）。
- 旧页 user 段：目录条目与未纳管文件条目**均只读**、local/project 仍可写。
- 主页签注册一致性：6 处同改（可加一条断言遍历校验）。
- **浮层层级（S7 真机暴露，已补）**：行内 `…` 与列头批量菜单（均 portal 到 `<body>`）的 className 含 `z-[10000]`；低一档会落在 `Settings`（`z-[9999]`）之后而整片不可见。

**门禁**
- `npm test`、`npm run test:client`、`npm run typecheck`、`npm run build`、`npm run lint`（主题/前端三查同规格，按仓库惯例）。
- i18n key 两端一致（en/zh-CN 子树对照）。
- 若新增 `src/shared/` 文件：`.oxlintrc.json` boundaries 已登记。

---

## 15. 分片实施计划（建议）

> 每个分片完成后各自刷基线、记账（与仓库既有推进节奏一致）。

- **S1 后端目录骨架**：`mcp_servers` 表 + 仓储 + `mcpCatalogService`（list / upsert / delete / toggle 的**目录持久化部分**，不含种子）。无视觉变更。
  - 边界说明：`resyncCatalogToProviders` 是**纯投影**（无投影就无意义），随 S2 交付；`toggleCatalogApp` 在 S1 只落一列布尔，S2 在其上追加投影。
- **S2 后端路由 + 投影**：`/mcp/catalog` 路由（用 `id`）；投影复用适配器；把 `toggle` / `delete` / `upsert` 接到投影并补 `resyncCatalogToProviders`；**同一文件路径的投影串行化**（§6.3，必做）；能力位闸门测试。
  - **S2 实施记录（已完成）**
    1. **路由**：`GET/POST /mcp/catalog`、`DELETE /mcp/catalog/:id`、`POST /mcp/catalog/:id/toggle`、`POST /mcp/catalog/resync`；载荷解析在路由层（抽出 `parseMcpConfigFields` 供直连路由与目录共用），业务全在服务层。
    2. **响应补 `outcomes`**（§8）：原文的 `{ entry }` / `{ removed }` 无法表达 §11.1 的 `fail` 态——目录只存开关，写文件成没成只存在于投影那一刻。
    3. **投影语义**：`enabled → upsertServer`、`!enabled → removeServer`（§6.2）；`delete` 改为**先逐 harness 移除、全成才删行**（§13.10 的选项 2）；`resync` 只遍历"至少有一条启用条目"的 harness（§7）。
    4. **串行化**：服务层逐 harness promise 队列；`writeJsonConfig`/`writeTomlConfig` 的原子化**本轮不做**，评估结论见 §6.3。
    5. **脱敏还原**：`restoreRedactedMcpValues`（`mcp.provider.ts:25`）改为导出，`upsertCatalogEntry` 用它把编辑载荷里的 `<redacted>` 对照库内原始值还原后再落库——补上 §13.9 在**编辑路径**（不只种子路径）的同一条约束。
    6. **能力位闸门**：不新增前置判据，靠各适配器既有的 `assertScopeAndTransport` / `writeScopedServers` throw，服务层 catch 成 `outcomes` 的 `ok:false`（§12 的"第二道闸门"）。

- **S3 一次性种子**：`seedCatalogOnce` + `app_config` 守卫 + **raw 读取路径** + 排除不可写 harness + 冲突只置所属 harness 的 `enabled`（见 §9）。
  - **S3 实施记录（已完成）**
    1. **raw 读取路径落点**：在 `McpProvider` 抽出 `listRawServersForScope`（不经 `sanitizeServerForResponse`），`listServersForScope` 改为它的 redact 包装；`IProviderMcp` 同步加此方法（§17-P1 的"internal raw list"选项）。
    2. **可写性判据**：`IProviderMcp.listWritableScopes()`，基类默认＝`supportedScopes`，`dsh` 覆写为 `[]`。种子据此跳过 `dsh`（可读不可写）与 `pi`/`omp`（无 scope），全程不引用前端常量（§17-A3）。
    3. **守卫落点**：`seedCatalogOnce()` 自己读写 `app_config` 标记（`mcp.catalog.seeded`，flag store 可注入、默认 `appConfigDb`），启动脚本只调用 + 告警。这样 §14 的"标记缺失时跑 / 存在时跳过"可被单测覆盖（原文伪代码把守卫放在启动脚本，无法单测）。
    4. **冲突语义**：首到者（`providerRegistry` 顺序）持有定义；同名同定义的多 harness 一并 `enabled=1`；同名不同定义只启用定义所属 harness，其余留 0 并记入 `conflicts`（§9.3、§17-W5）。
    5. **可重入**：写行前按 name 查重跳过，避免"上次崩溃未设标记"时重跑撞 `UNIQUE(name)`。
    6. **启动接入**：`server/index.ts` 的 `startServer()` 在 `initializeDatabase()` 后调用，`try/catch` 不阻断启动。
- **S4 前端矩阵（只读）**：主页签 6 处注册 + `McpMatrix` 三/四态渲染 + 禁格规则 + i18n。
  - **S4 实施记录（已完成）**
    1. **主页签 6 处**（§10）：`types.ts` 的 `SettingsMainTab`、`constants.ts` 的 `SETTINGS_MAIN_TABS`、`SettingsSidebar.tsx` 的 `NAV_ITEMS`、`useSettingsController.ts` 的 `KNOWN_MAIN_TABS`、`Settings.tsx` 的 `{activeTab === 'mcp' && <McpMatrix />}` 分支、`en` + `zh-CN` 的 `mainTabs.mcp`。命令面板由 `SETTINGS_MAIN_TABS` 驱动，自动获得该命令，无需第七处。
    2. **能力位只读一次、不新增常量**：新增 `src/modules/mcp/utils/mcpMatrixRules.ts`，`MCP_MATRIX_PROVIDERS` = `MCP_SUPPORTED_SCOPES[p].includes('user')` 的 harness（claude/cursor/codex/opencode/dsh/workbuddy/zcode，7 列；pi/omp 无 scope 故不出列）；`getCellDisabledReason` 先看 `MCP_ADD_BLOCKED_REASON[p]`（dsh ⇒ 整列禁用），再看 `MCP_SUPPORTED_TRANSPORTS[p].includes(entry.transport)`（`sse` ⇒ cursor/codex/opencode 禁格）。两个判据都只读既有的 `src/shared/constants.ts` 能力表，`server/` 侧真闸门不变（§12 的"双真源"未动）。
    3. **四态单元格**：`McpMatrixCell.tsx` 支持 `on/off/fail/disabled`。只读切片只产出 `on/off/disabled`——`fail` 由写响应的 `outcomes` 驱动，属 S5；组件本身四种态齐备且可测（`data-state` 属性 + `aria-label`）。
    4. **只读的可点性表述**：未传 `onToggle`（本切片即如此）或能力位为 `disabled` 时按钮 `disabled`；S5 传入 handler 后 `on/off/fail` 自动变为可点，不需要改组件契约。
    5. **搜索 allow-list 已实现**（§11.1 的新要求；这条要求既不在 S4 行也不在 S5 行，按"只读且承重"归入本片）：`getSearchText` 严格照 §11.1 的正清单收 `name/command/args/cwd/url`，**未扩面**；`env`/`headers`/`envHttpHeaders` **永不进搜索词**（可能含密钥），并由一条用例（把密钥写进 `env` 后搜它必须 0 命中）钉住。
    6. **读取通道**：`src/shared/api.ts` 加 `providers.mcpCatalog()`（`GET /api/providers/mcp/catalog`）；`hooks/useMcpCatalog.ts` 只做读取（`entries/isLoading/error/reload`），mutation 归 S5。
    7. **`dsh` 列**：按 §16.1 默认值**保留 + 整列禁用**（不隐藏）。
    8. **未新增 `src/shared/` 文件 ⇒ `.oxlintrc.json` 的 `frontend-shared-file` 白名单无需改动**（已核）。
    9. **变异反向验证 5/5 全红、零 NO-MATCH**：删 transport 禁格 ⇒ 仅 `sse` 用例红；把 `env` 值加进搜索 ⇒ 仅 allow-list 用例红；列集合放开到全部 harness ⇒ 列存在 + 两个标签计数用例红；删 `MCP_ADD_BLOCKED_REASON` 分支 ⇒ 两个 dsh 断言用例红；`isInert` 恒假 ⇒ 四态可点性 + 只读惰性两用例红。（一次中间变异体自身语法错导致 7 红，属"假红"、已按合法变异重跑，见记忆"红数超出变异可触及对象范围先怀疑变异体"。）
    10. **门禁**：`npm run typecheck` 0；本片文件 `oxlint` 0 error 0 warning；`npm run test:client` 180 文件 / 1458 用例全绿（本片 +2 文件 / +13 用例）；`npm run build:client` 通过；15 个改动文件 `U+FFFD` 计数 0。
- **S5 前端矩阵（写）**：`useMcpCatalog` mutation（toggle / upsert / delete / 批量）+ **从 `useMcpServers` 导出缓存失效函数并调用**（§11.2）+ 失败重试。
  - **拆片裁定（S5a 实施时）**：这一行横跨两类消费者——**格级写入**（`toggle`，只被单元格用）与 **行级/列级批量**（`upsert` / `delete` / 批量，只被行操作与列头用）。按"不写无用代码"拆成 **S5a = 格级写入**、**S5b = 批量写入与行删除**、**S5c = 行新增/编辑表单**（S5b 实施时的二次拆分：批量/撤销/删除都不碰表单，而表单撞上 §16.9 的契约不匹配，见下）。批量不新增服务端形状：逐格 fan-out `POST /mcp/catalog/:id/toggle`，语义等同 §11.1 的"作用范围跟随搜索"。
  - **S5a 实施记录（已完成）**
    1. **端点与类型**：`api.providers.mcpCatalogToggle(entryId, { provider, enabled })`（`src/shared/api.ts`）→ `POST /api/providers/mcp/catalog/:id/toggle`；前端新增 `McpCatalogProjectionOutcome`（`src/shared/types.ts`，镜像服务端同名类型，值域一致）。
    2. **写态模型**：`McpCatalogCellWrite = { status: 'pending' } | { status: 'failed'; desired: boolean; error?: string }`，按 `getMcpCellKey(entryId, provider)` 索引；成功即从表里删除该键（单元格只在"正在写/写失败过"时非空）。**`desired` 必须落库**：服务端是"先翻开关、再投影"，投影失败时开关已经是用户想要的值，重试要重放 `desired`——存成"取反"就会把用户的意图反向执行（§11.1 该条）。
    3. **HTTP 级失败同样落 `fail`**：`readApiJson` 对非 2xx 抛错（`src/shared/api.ts:101-114`），`catch` 分支写 `desired = enabled`——请求可能根本没到服务端，所以只有记住"当时想写什么"才能重试正确。
    4. **缓存失效只在写成功时**：投影 `ok:false`（文件未改）与 HTTP 失败都不调用 `invalidateMcpServersCache`，由三条用例各钉一次。
    5. **四态取值**：`getCellState(entry, provider, hasFailedWrite = false)`；`disabled` 优先于 `fail`。新参数有默认值，S4 的只读语义与既有断言逐字不变。
    6. **写进行中（`isBusy`）**：`McpMatrixCell` 加可选 prop，`aria-busy` + 惰性 + 降透明度；默认 `false` 故 S4 契约不变（既有"四态可点性"用例顺带钉了"非写态时无 `aria-busy`"）。
    7. **i18n**：`mcpMatrix.cell.fail`（含 `{{error}}`）+ `mcpMatrix.errors.unknown`，en / zh-CN 两端齐（子树 15=15）。
    8. **变异反向验证 7/7 精确命中、零 NO-MATCH**：M1 失效函数退化成全清 ⇒ 仅"drops only the harness it names"红；M2 去掉成功后的失效调用 ⇒ 仅"格翻 ON"与"请求失败后重试成功"两条红；M3 重试值取反 ⇒ 仅"拒写重试"红；M4 格级点击不读 `desired` ⇒ 同上一条红；M5 `fail` 抢在 `disabled` 前 ⇒ 仅"能力位优先"红；M6 `isInert` 丢掉 `isBusy` ⇒ 仅"写进行中惰性"红；M7 不写 `pending` ⇒ 同上一条红。
    9. **门禁**：`npm run typecheck` 0；本片文件 `oxlint` 0 error（`useMcpServers.ts` 2 条 warning 来自该文件 S4 之前就有的 effect，非本片引入）；`npm run test:client` **181 文件 / 1467 用例全绿**（S4 基线 180/1458 ⇒ ＋1 文件 / ＋9 用例，逐条吻合）；`npm run build:client` 通过；改动文件 `U+FFFD` 计数 0（全仓 modified 145 文件一并扫）。
    10. **服务端本片零改动**；但本片期间 `server/` 下若干**内容干净**的文件（`server/shared/frontmatter.ts`、`server/modules/worktrees/worktrees.routes.ts`、`server/shared/tests/slice-tail-page.test.ts`）mtime 被外部进程刷新（同 S3 的并发写者现象）。故服务端面改用"跑该面测试"取证：`mcp-catalog.service` / `mcp` / `provider.routes` / `mcp-servers.db.integration` 四文件 **65 项全绿**。
    11. **测试夹具坑（值得记）**：给 `useMcpServers` 传 `currentProjects: []` 字面量时，每次 render 都是新数组 ⇒ `projectTargets` → `cacheKey` → `refreshServers` 全换身份 ⇒ 加载 effect 自激，vitest worker **堆 OOM / `Channel closed`**（不是断言失败、不是内存泄漏）。测该 hook 必须传模块级稳定数组；`passed=0` 类假绿的第一问再次适用。
- **S5b 批量写入与行删除（已完成）**
  1. **入口**：列头 = `ActionMenu`（本列"全部启用 / 全部关闭"），行尾 = 一列 `ActionMenu`（"对所有智能体启用 / 关闭 / 删除"）。两者都用 `portal`（表格在 `overflow-x-auto` 容器内，非 portal 菜单会被裁切）。
  2. **作用范围**：列头批量作用于**当前可见行**（`visibleEntries`）。无搜索时 `visibleEntries === entries`，有搜索时等于搜索结果——即 cc-switch `AppMatrix.tsx:22-32 resolveBulkScope` 的语义；弹层 `header` 写明范围（`bulk.scopeAll` / `bulk.scopeSearch`）。
  3. **批量语义**（`useMcpCatalog.applyBatch`）：**串行**逐格 `writeCell`；跳过两类格——(a) 能力位禁格（列/行的 hover 已说明原因），(b) **已持有目标值**的格（写它只会为无变化重写一次配置文件）。剩下的才构成撤销集。
  4. **撤销**（§16.7 裁定取 (a)）：面板内 `<div role="status">`，文案 `undo.enabled` / `undo.disabled`（带 `count`）+ "撤销" + 关闭。`McpCatalogUndo = { targets, enabled }`——撤销 = 对这些格写 `!enabled`。**撤销本身不再产生撤销**（执行前先 `setUndo(null)`）。撤销时 targets 会**按最新 `entries` 重建**（批量期间 entries 已被服务端返回值刷新，直接拿快照会写出错值）。
  5. **删除**：`window.confirm`（与旧页 `useMcpServers.ts:529` 同先例，不引入新弹窗原语）→ `DELETE /mcp/catalog/:id` → 成功则从 `entries` 移除并**全清** `invalidateMcpServersCache()`（删除触及该条目启用的每一个 harness）。`removed:false`（部分 harness 拒绝移除，服务端 §13.10 选项 2 保行）时**行保留**并把失败明细（`provider: error`）显示在错误条。
  6. **列级禁用**：该列**所有可见行**都禁格时（如 `dsh` 整列）禁用列头菜单，而不是给一个点了没反应的入口。
  7. **i18n**：`mcpMatrix.{actionsColumn,bulk.*,row.*,undo.*}`，`undo.enabled/disabled` 用 `_one`/`_other` 复数键（en 有 `_one`+`_other`，zh 只有 `_other` ⇒ 键集仍 `zh ⊆ en`）。
  8. **变异反向验证 9/9 精确命中、零 NO-MATCH**：M1 批量不跳禁格 ⇒ 列批量/行批量/撤销 3 条红；M2 不跳未变值 ⇒ 行批量 + 零改变 2 条红；M3 不记撤销 ⇒ 撤销红；M4 撤销写错方向 ⇒ 撤销红；M5 撤销不清自身条 ⇒ 撤销红；M6 列批量无视搜索 ⇒ 收窄 + 零改变 2 条红；M7 删除不确认 ⇒ 取消用例红；M8 拒绝移除仍删行 ⇒ 失败用例红；M9 删除不清缓存 ⇒ 删除用例红。
  9. **门禁**：`npm run typecheck` 0；本片文件 `oxlint` 0 error 0 warning；`npm run test:client` **181 文件 / 1475 用例全绿**（S5a 基线 181/1467 ⇒ ＋8 用例、无新文件，逐位吻合）；`npm run build:client` 通过；本片 6 个改动文件 `U+FFFD` 计数 0。
  10. **本片服务端零改动**，故未重跑服务端面（S5a 已跑四文件 65 项）。
- **S5c 行新增/编辑表单（已完成）**
  1. **入口**：面板标题右侧一个`新增`主按钮（空目录时也在，那正是最需要它的时候）；行尾菜单首项`编辑`。两者共用同一表单。
  2. **表单载体＝方案 (A)**（§16.9 裁定）：`provider={MCP_CATALOG_FORM_PROVIDER}`（`'codex'`，常量落在 `src/shared/constants.ts`，与 `showCodexOnlyFields` / `MCP_SUPPORTS_WORKING_DIRECTORY` 的依据同处一文件）+ `supportedScopes={CATALOG_FORM_SCOPES}`（`['user']`）+ `supportedTransports={MCP_GLOBAL_SUPPORTED_TRANSPORTS}` + `title`/`description`/`submitLabel` 三个覆盖 prop。**零改表单代码**。
  3. **载荷映射**：`mcpFormatting.ts` 的 `createMcpCatalogEntryPayload(entryId, formData)` 复用既有 `createMcpPayloadFromForm`，再把扁平载荷压成 `{ id?, name, transport, config }`（`scope`/`workspacePath` 丢弃——目录恒为 user scope）。`id` 存在即更新、不存在即新建（与服务端 `parseMcpCatalogEntryPayload` 一致）。
  4. **稳定性要求（本片踩实）**：`supportedScopes` 在 `useMcpServerForm` 的 reload effect 依赖里，**必须是模块级常量数组**——写成内联 `['user']` 会让每次父组件重渲染都重置表单字段。`currentProjects` **不在**该依赖里（只喂一个 memo），故内联 `[]` 即可，不设常量。
  5. **`editingServer` 必须 memo**：`toFormServer(entry)` 每次调用都产新对象，而 `editingServer` 也在上述依赖里——不 memo 就会在父组件重渲染时把用户正在编辑的字段重置掉。用例「keeps what the user typed when the panel re-renders」钉住这一点。
  6. **失败不关窗**：保存被拒（重名 409 / 条目已被删 404）时 `upsert` 抛错 → 表单的 `alert` 报错并**保持打开**、输入不丢、表格不变。关窗只在 `upsert` 成功后。
  7. **缓存失效**：更新后对**该条目已启用的每个 harness**逐个 `invalidateMcpServersCache(provider)`；新建时全 off、零失效（没写过任何文件）。
  8. **i18n**：`mcpMatrix.{addEntry,row.edit,form.*}`，两端齐（`zh ⊆ en`）。
  9. **变异反向验证 10/10 精确命中、零 NO-MATCH**：M1 载荷丢 `id` ⇒ 编辑用例红；M2 不失效缓存 ⇒ 编辑用例红；M3 只追加不替换 ⇒ 编辑用例红；M4 行「编辑」开成新建 ⇒ 编辑用例红；M5 载荷丢 `cwd` ⇒ 字段用例红；M6 丢 `envVars` ⇒ 字段用例红；M7 借位 harness 改 `claude` ⇒ 字段用例红；M8 失败也关窗 ⇒ 拒绝用例红；M9 `editingServer` 不 memo ⇒ 重渲染用例红；M10 `supportedScopes` 内联 ⇒ 重渲染用例红。**M9/M10 首轮为绿**：初版把「新建路径」当靶子，而新建时 `toFormServer` 根本不被调用（`entry` 为 null），memo 与否无差别；改用**编辑路径 + 父组件重渲染**（搜索框改字，触发 `McpMatrix` 重渲染）才成为可证伪的命题。
  10. **门禁**：`npm run typecheck` 0；本片 7 个改动文件 `oxlint` 0 error 0 warning；`npm run test:client` **181 文件 / 1480 用例全绿**（S5b 基线 181/1475 ⇒ ＋5 用例、无新文件）；`npm run build:client` 通过；本片 9 个改动文件 `U+FFFD` 计数 0；本片**服务端零改动**（`createMcpCatalogEntryPayload` / `MCP_CATALOG_FORM_PROVIDER` / `mcpCatalogUpsert` 在 `server/` 命中 0）。
- **S6 旧页改造（已完成）**：user 段只读（目录条目 + 未纳管文件条目）+ local/project 保留 + **表单边界传剔除 user 的 `supportedScopes`**（§11.3）。
  1. **行模型归一**：`McpServers.tsx` 内新增模块级 `McpServerRow`，其 `owner: 'matrix' | 'cloudcli' | 'harness' | 'unmanaged' | null` 同时决定徽章、提示与可写性——**`owner` 非空即只读、为空即可写**，所以"哪些行只读"只有一处判据。两类行共用同一段行 JSX（不复制）。
  2. **user 段的两组（均只读）**：
     - **目录行**：`entries.filter(e => e.enabled[selectedProvider])`，**从目录渲染、不读文件**——投影失败时文件里没有该条目，可它仍是"已勾选"的事实；行显示目录侧的 name/transport/config。徽章 `mcpServers.userScope.managedBadge`，提示 `managedHint`。
     - **文件行**：文件 user 段里 name 不在"目录已启用集合"的条目。手写项用 `unmanagedBadge`；`cloudcli-*` 托管项沿用既有 `managed.badge` + `managed.hint`（CloudCLI 功能自管，且继续隐藏连接详情），harness-managed harness（dsh）沿用 `managed.harnessHint`（§13.5 的可见性要求由此落地）。
     - **同名去重**：文件名与目录已启用条目同名时**只渲染目录行一次**（有用例钉住"文件仍带着它也只出一行"）。§11.3 的"并集"因此读作"并集去重按 name"。
  3. **local/project 段原样保留** full CRUD：`owner === null`；`cloudcli-*` 与 harness-managed 仍只读，判据不变。
  4. **分段渲染**：`sections.userScope` / `sections.fileScopes` 两个小标题，各自**仅在有行时**渲染（§13.6 的"UI 需明确区分"）。
  5. **跳转**：`onOpenMcpMatrix?: () => void` 从 `Settings.tsx` 的 `setActiveTab('mcp')` 经 `AgentsSettingsTab` → `AgentCategoryContentSection` 下传（3 层，`useCallback` 保身份）；**未传该 prop 时整条链接不渲染**（没有去处就不给入口）。链接只放在 user 段标题右侧——每行一个链接会把列表淹掉，而"提供跳转"由段级入口满足。
  6. **表单去 user（两个表单都去）**：§11.3 只说"表单"，但 `ActionMenu` 的两条新增都会开到 user-capable 表单，而决定 A 把 user 的编辑入口统一到矩阵，故 provider 表单传 `formScopes`、global 表单传模块级 `GLOBAL_FORM_SCOPES`（`MCP_GLOBAL_SUPPORTED_SCOPES` 过滤 user）。**不改 `MCP_SUPPORTED_SCOPES`**（§17-W3：改它会让矩阵列与本次的只读视图一起失去依据）。两个 scope 列表都必须是**稳定身份**（`useMemo` / 模块级常量）——它在 `useMcpServerForm` 的 reload effect 依赖里，内联数组会在页面每次重渲染时清空用户正在填的字段（本片补了针对性用例，见 9 的 M8）。
     - **副作用（有意）**：新增表单的默认 scope 由 `user` 变成剩余列表的第一项（claude→`project`、workbuddy→`local`），与"user 只能在矩阵里建"一致。
  7. **目录读取**：旧页复用 `useMcpCatalog()`（只取 `entries` 与 `error`）；目录加载失败时其错误进入既有错误条，此时 user 文件行退化为"未纳管"标签——**不静默**。
  8. **i18n**：`mcpServers.{sections.userScope,sections.fileScopes,openMatrix,userScope.{managedBadge,managedHint,unmanagedBadge,unmanagedHint}}`，en/zh-CN 两端齐（`mcpServers`/`mcpMatrix` 子树逐键对照：zh 独有 0；en 独有仅 `mcpMatrix.undo.*_one` 两个复数键）。
  9. **变异反向验证 10/10 精确命中、零 NO-MATCH**：M1 user 行恢复可写 ⇒ 只读用例 + 去重用例红；M2 目录行不渲染 ⇒ 同上两条红；M3 不与目录去重 ⇒ 只去重用例红；M4 provider 表单留 user ⇒ provider 表单用例红；M5 global 表单留 user ⇒ global 表单用例红；M6 链接无条件渲染 ⇒ "无 handler 不出链接"红；M7 user 段标题键改错 ⇒ 分段用例红；M8 `formScopes` 不 memo ⇒ 重渲染用例红；M9 不切段（回到单列表）⇒ 分段用例红；M10 目录行也变可写 ⇒ 两条红。
  10. **三处验证方法坑（本片踩实，均可复用）**：
      - **`useMcpServers` 的 30s 缓存是"文件级共享状态"**：同一测试文件里连挂两次同 provider+projects，第二次会命中上一次的缓存而**不发请求**，于是该用例的文件行永远不出现——M3 首轮"绿"正是此故（断言在文件行提交前就成立，缓存又保证它永不提交）。修法＝`beforeEach` 调 `invalidateMcpServersCache()`，与既有 `mcpServersCacheInvalidation.test.tsx` 同款。
      - **`waitFor` 等到"任意一行出现"就返回**：若断言的是另一行/计数，就会在旧状态上通过。判据＝**等最后提交的那一项**（本页 loader 先提交 user、再 append project/local，故等 project 行；纯文件行则用一个只存在于文件里的名字等）。
      - **`assert.equal(<jsdom 节点>, null)` 再次打死 vitest worker**（`Channel closed`、exit=1 却没有任何用例行），改用 `assert.ok(x === null, msg)`——与 2-G 记录的同一条。
  11. **门禁**：`npm run typecheck` 0；本片 6 个 TS/TSX 文件 `oxlint` 0 error（`AgentsSettingsTab.tsx` 的 `set-state-in-effect` warning 是本片之前既有）；`npm run test:client` **182 文件 / 1486 用例全绿**（S5c 基线 181/1480 ⇒ ＋1 文件 / ＋6 用例，即新用例文件全量）；`npm run build:client` 通过；本片 8 个改动文件 `U+FFFD` 计数 0；**服务端零改动**。
- **S7 收口（已完成）**：`resync` 逃生门接线 + 目录响应脱敏 + 编辑路径禁格 + 改名/删除残留边界 + 文档回写。
  1. **`resync` 逃生门（前端接线）**：`api.providers.mcpCatalogResync()` → `useMcpCatalog.resync()` → 面板标题右侧「重新同步」（`RefreshCw`）。服务端路由与语义 S2 已交付，本片只补前端。
     - **清 `fail` 的判据＝"该 harness 本次尝试的每一次写都成功"**：`attempted \ failed`（在 `outcomes` 里出现过、且没有任何 `ok:false`）。一次失败就保留该 harness 的全部 `fail` 格——空格子不区分"哪一次写"，清掉它会谎报。
     - 只对 `repaired` 逐个 `invalidateMcpServersCache(provider)`；目录为空时按钮禁用（没有可重放的东西）。
     - 失败明细进既有错误条（`mcpMatrix.resyncFailed`）；成功的静默——格从 `fail` 变 `on/off` 本身就是反馈。
     - **一处简化（变异暴露）**：初版写的是"按 `ok` 过滤的 `writtenProviders`"＋循环内 `if (!failedProviders.has(p))` 两道条件，等价变异恒绿——两个集合在语义上恒等（`attempted \ failed` ≡ `ok` 过滤集），条件冗余；改成单一 `attempted \ failed` 后每个条件都可被变异证伪。
  2. **目录响应脱敏（补 S1–S5 的缺口；设计早已写明）**：§11.1/§13.9 要求"响应读取走脱敏、库内原始"，而 S1–S5 只做了**还原**方向。本片补上正向：`redactMcpValues` 由 `mcp.provider.ts` 导出，`mcp-catalog.service.ts` 在**全部返回路径**（`listCatalog` / `upsertCatalogEntry` 的建与改 / `toggleCatalogApp`）经 `redactCatalogEntry` 出参。
     - 判据：**库内与投影用原始值，只有出参脱敏**——三处都有断言（响应是 `<redacted>`、库内是 `super-secret`、适配器收到的是 `super-secret`）。
     - 副作用（正确）：矩阵编辑表单现在回显 `<redacted>`，保存走 S2 已有的 `restoreConfigSecrets` 还原；旧页 user 段的 `maskSecret` 因此与文件行同口径。
  3. **编辑路径禁格（§12/§17-O6 的缺口，按 §16.6 默认值实施）**：`useMcpCatalog.upsert` 保存成功后，对"已勾选但 `getCellDisabledReason` 非空"的列**逐个 `writeCell(..., false)` 关闭**，并把列名交回调用方（`upsert` 返回值由 `Promise<void>` 变 `Promise<McpProvider[]>`），`McpMatrix` 提交后以 `mcpMatrix.form.droppedColumns` 提示。
     - **顺序＝先保存、后取消**（§17-O6 的措辞"编辑保存后…自动取消勾选"即此序）：保存失败（重名 409 / 条目已被删 404）时勾选不动、不留半改状态；而"不支持的定义被投影出去"不会发生——服务端 `assertScopeAndTransport` 在 `upsertServer` 首行就拒，文件不被改写（这条拒绝恰好就是被 `fail` 报回来的那笔 outcome）。
     - 取消走既有 `writeCell`，因此复用其缓存失效与失败回报，不新增写入路径。
  4. **补齐 S5c 漏掉的一环：`upsert` 的 `outcomes` 必须进 `fail` 态**。§11.1 写着"`upsert` 的 `outcomes` 只含本次真正尝试的 harness"、失败态"只能由响应回报"，但 S5c 把响应里的 `outcomes` 丢了——于是一次投影失败（典型：改名清理被拒、文件只读）在矩阵上表现为"已完成"，而文件其实还是旧定义。现在按 `writeCell` 同款形状写 `{status:'failed', desired: saved.enabled[p], error?}`，点格重放该值。**顺带修对缓存失效**：失败/被取消的 harness 不再 `invalidateMcpServersCache`（没写过文件就不该丢缓存）——S5c 的循环把所有已启用 harness 都失效了。
  5. **改名/删除残留边界（两条新用例 + 一条记债）**：
     - **改名清理被拒** ⇒ `projectUpsert` 在写新名之前返回 `action:'remove', ok:false`，**新名不写**，harness 仍持旧键；目录行仍落新名（行是提交点）。该残留经第 4 条在格上可见（`fail`）。
     - **旧键已不在文件里**（开关 stale）⇒ `removeServer` 返回 `removed:false`，**不是错误**，改名照常成功——否则一次清理失败会把该 harness 的改名永久锁死。
     - **已知残留（记债，不修）**：改名清理失败后，点格重试走 `toggleCatalogApp`（服务端不带 `previousName`），`resync` 同样不带 ⇒ 旧键无法自动清除，只能手改文件；而旧页 user 段在 S6 后是只读的，UI 里也没有清除入口。要根治需把"待清理的旧名"落库（schema 变更），超出本片范围。
     - 删除侧的残留 S5b 已覆盖（`removed:false` 保行 + 错误条列明拒绝的 harness），本片未重复。
  6. **i18n**：`mcpMatrix.{resync,resyncFailed,form.droppedColumns}`，en/zh-CN 两端齐（`mcpMatrix` 子树 43/41，差 2 仅为既有的 `undo.*_one`）。
  7. **变异反向验证 18/18 精确命中、零 NO-MATCH**：resync 5（清 `fail` 的判据、`attempted` 取全集、不清、不清缓存、空目录可点）；编辑路径与保存失败 7（不 drop、全 drop、无提示、恒提示、失败不落 `fail` 态、失败也清缓存、重试方向取反）；目录脱敏 5（`redactCatalogEntry` 空转、建/改/toggle 三条返回路径各去掉脱敏、去掉还原）；改名残留 1（把"旧键不存在"当失败）。**另有 1 个等价变异恒绿 ⇒ 处置不是补测试而是删冗余条件**（见 1）。
  8. **门禁**：`npm run typecheck` 0；本片 10 个改动文件 `oxlint` 0 error 0 warning；`npm run test:client` **182 文件 / 1492 用例全绿**（S6 基线 182/1486 ⇒ ＋6 用例、无新文件）；`npm run build:client` 通过；10 个改动文件 `U+FFFD` 计数 0；服务端 4 个目标测试文件 **68/68 绿**（`mcp-catalog.service` 22 / `provider.routes` 27 / `mcp` / `mcp-servers.db.integration`）；全量 `npm test` 的 11 条红全部落在 opencode-sessions / workbuddy / claude 可执行路径解析 / app-session 同步器，与本片零交集。

- **S8 Pi 纳入矩阵（已完成）**：把 `pi` 从"无原生 MCP"改为真实现在内（对齐 cc-switch 的 Pi 契约；起因＝用户问"Pi 是不是没实现"，并核出 cc-switch 已实现）。
  1. **能力位（`src/shared/constants.ts`）**：`MCP_SUPPORTED_SCOPES.pi = ['user']`、`MCP_SUPPORTED_TRANSPORTS.pi = ['stdio','http']`（**无 sse**）、`MCP_ADD_BLOCKED_REASON.pi = null`、`MCP_SUPPORTS_WORKING_DIRECTORY.pi = true`。矩阵列由 `MCP_MATRIX_PROVIDERS`（＝有 user scope 的 harness）推导 ⇒ **只改常量就出列、无需动矩阵代码**（7 → 8 列）。
  2. **适配器重写（`pi-mcp.provider.ts`）**：真读写 `~/.pi/agent/mcp.json`（复用 `getPiAgentDir()`，尊重 `PI_CODING_AGENT_DIR`）；条目在顶层 `mcpServers` 下；**不写 `type`**——Pi 靠字段推断传输（`command` ⇒ stdio、`url` ⇒ http），本机实测 `pi mcp add` 亦不写。
     - **名字规则**：只允许 `[A-Za-z0-9_-]`；且 Pi 把只差 `-` 与 `_` 的名字视为同一服务器 ⇒ 写入前做归一同名冲突检测（`MCP_SERVER_NAME_CONFLICT`）。
     - **保留 Pi 自有字段**：`timeout` / `description` / `exposure` / `toolExposure` / `oauth` / `auth` 在编辑时原样保留，只替换连接字段；**未被改动的条目逐字节不变**（`mergePiEntry` 以序列化比较短路），因此一次投影不会给无关条目补 `enabled`。
     - 写入 `enabled: true`（开＝启用）；只替换 `mcpServers`，顶层其它字段保留（照 `claude-mcp.provider.ts` 的"重读整份文档、只改自己那段"范式）。
     - SSE 由基类 `assertScopeAndTransport` 拒（`MCP_TRANSPORT_NOT_SUPPORTED`）；scope 仅 `user`。
  3. **与 cc-switch 的一处有意差异（关闭语义，已知取舍）**：cc-switch 对 Pi 用**软禁用**——取消勾选只写 `enabled:false`、条目与 Pi 自有字段都留着，只有"删除"才移除条目（`pi.rs:175-186`）。CloudCLI 的投影语义是**关闭即移除**：矩阵关格与删除目录条目都落到同一个 `removeServer`，适配器层分不出意图。故本片**关闭 = 从 `mcp.json` 删掉该条目**，代价是那条目上的 Pi 自有字段（含 OAuth 凭据）一并消失。要照搬软禁用需给 `IProviderMcp` 增加"意图"参数（关闭 vs 删除），属独立分片、未做。
  4. **前端**：**零生产代码改动**——列、禁格、表单 `cwd` 可见性全部由能力位派生；只适配 6 条既有断言（列数 7→8；stdio 行的 off 5→6；sse 行的 disabled 4→5；行批量 5→6；Pi 的 skip 原因由 `noNativeSupport` 变 `scopeUnsupported`；`MCP_ADD_BLOCKED_REASON` 的非空集合由 `['dsh','pi','omp']` 变 `['dsh','omp']`，并新增一条"当前无 provider 属 `noNativeSupport`"的显式断言）。
  5. **本机实证（Pi 1.0.0）**：`pi mcp add/list/remove/login/logout` 存在；读 `~/.pi/agent/mcp.json`（受信项目另读 `.pi/mcp.json`，CloudCLI **不管**项目级）；`--env`/`--cwd`/`--header`/`--bearer-token-env-var`（后者落成 `headers.Authorization = "Bearer ${VAR}"`）；`pi mcp list --json` 佐证结构。
  6. **变异 3/3 精确命中**：不保留 Pi 自有字段 ⇒ 编辑用例红；去掉 `-`/`_` 归一冲突检测 ⇒ 名字用例红；http 分支不写 `enabled` ⇒ http 用例红。
  7. **门禁**：`typecheck` 0；本片 5 个改动/新增文件 `oxlint` 0 error 0 warning；`npm run test:client` **182 文件 / 1494 用例全绿**（与 S7 同量，仅适配、无新增前端用例）；本片后端目标组 **59/59**（含新增 `pi-mcp.test.ts` 7 条）；全量 `npm test` 的 **11 条红与 S7 基线逐条一致**（opencode-sessions / workbuddy / claude 可执行路径解析 / app-session 同步器，与本片零交集）；`npm run build` 通过。

依赖：S1 → S2 → S3；S4 → S5a → S5b → S5c → S6 → S7；**S8 独立于上述链路**（只依赖能力位表与 `McpProvider` 基类）。全部分片已交付。

---

## 16. 开放项（不影响开工，实施前确认）

1. **dsh 列**：默认"保留 + 整列禁用"（贯彻禁格）。可选改为隐藏。
2. **pi/omp 列**：`omp` 默认不出列（无可写 scope），可选改为"显示 + 整列禁用"。**`pi` 已裁定并入矩阵（S8，见 §15-S8）**——Pi 1.0+ 原生支持 MCP，出列且只接受 `stdio`/`http`（Pi×`sse` 事前禁格）。
3. **`enabled_<p>` 列式 vs 关联表**：默认列式（§6.1）。**已知债**：列式把 provider 集合硬编码进表结构，每新增一个 harness 都要 `ALTER TABLE` + migration + 改常量表（`provider_models` 同此）。关联表 `mcp_server_enabled(server_id, provider)` 在这条演进线下更稳，代价是 toggle 的原子更新要走 upsert。见 §17-O2。
4. **目录是否也承载 `cloudcli-*` 只读行**：默认不承载（矩阵不显示托管项），以保持"目录 = 用户可管的 user 条目"这一清晰边界。
5. **改名策略**：默认在 UI 层**禁用改名**（`id` 不变、`name` 一并锁定）；备选是"允许改名 + 服务层连带清理旧 name"（§7、§17-O4）。
6. **编辑路径禁格的实现**：默认"保存时自动取消不兼容列的勾选 + 提示"；备选是"表单按已勾选列求交集、限制 transport 选项"（§11.1、§17-O6）。**已实施（S7）：取默认值**，顺序＝先保存后取消（保存被拒时勾选不动）。
7. **列头批量的"撤销 toast"没有载体（S5a 期间查实，S5b 开工前需拍板）**：全仓**没有 toast 基础设施**——`src/shared/ui/` 无 Toast 组件，`src/` 内 `useToast` / `ToastProvider` 零命中。§11.1 写的"执行后给撤销 toast"因此是一条**缺载体的能力声明**。三条候选：(a) 为矩阵造一个局部撤销条（面板内 inline，不进 `src/shared/ui`）；(b) 顺手建一个全局 toast 原语（超出本方案范围、影响面大）；(c) 用"逐 harness outcome 结果行 + 重试"替代撤销（与 §8 的 `outcomes` 一致，但撤销语义变成"再点一次批量"）。**判据：文档明列一项能力却没说它画在哪，那个载体就是契约本身**（同 §17-O6 的处理方式）。**已裁定（S5b）：取 (a)** —— 面板内局部撤销条（`role="status"` + "撤销" + 关闭），不进 `src/shared/ui`；撤销 = 对**本次批量真正改变过的格**写回反值（原本已持目标值的格不进撤销集，避免为无变化重写配置文件）。

8. **矩阵页缺"新增 user 条目"入口（S5b 实施时查实，S5c 已裁定）**：§11.1 的"行操作"只列了编辑 / 删除 / 启用全部 / 关闭全部，**没有新增**；但 §11.3 明确"user 的统一编辑入口在矩阵页"，而 ③（目录只做 user）+ ⑤（一次性种子）+ A（旧页 user 段只读）三者合起来，一旦 S6 落地，**user scope 的新增能力就无处可达**——这是功能倒退，不是可选项。cc-switch 的对应形态是 `UnifiedMcpPanel.tsx:461 openAdd`（统一面板内的新增抽屉）。**已裁定（S5c）：并入 S5c** —— 新增与编辑共用同一表单，拆成两片只会让同一份接线写两遍。实现在 §15-S5c。

9. **编辑/新增表单的载体与"复用 `McpServerFormModal`"的契约不匹配（S5b 实施时查实，S5c 已裁定）**：§11.1 写"编辑（复用 `McpServerFormModal`）"，但该组件的 `provider: McpProvider` 是**必填**且牵动四处行为——`availableTransports = supportedTransports ?? MCP_SUPPORTED_TRANSPORTS[provider]`（不给覆盖就会被单个 harness 的 transport 集合限死，与 §11.1"保存时自动取消不兼容列的勾选"的默认规则冲突、退化成备选方案）、`showCodexOnlyFields = provider === 'codex'`（`envVars` / `bearerTokenEnvVar` 只在 codex 下可见，而目录 `McpCatalogConfig` 含这两个字段）、`MCP_SUPPORTS_WORKING_DIRECTORY[provider]`（`cwd` 字段可见性）、`MCP_PROVIDER_NAMES[provider]` 与 `mcpForm.scope.*` 文案。**已裁定（S5c）：取"可行适配"方案 (A)，不建目录模式分支**——`provider={MCP_CATALOG_FORM_PROVIDER}`（`'codex'`，唯一同时给出 `cwd` 与 codex 专属字段的取值；常量与那三张表同放 `src/shared/constants.ts`，借位关系写在常量注释里）+ `supportedScopes={['user']}` + `supportedTransports={MCP_GLOBAL_SUPPORTED_TRANSPORTS}`（既有全集常量）+ `title`/`description`/`submitLabel` 覆盖 prop（否则首个 harness 会漏网：默认提交文案是 `mcpForm.actions.addServerTo`，即"添加到 Codex"）。**原条目的一处前提已复核为误**：文中说"遗留瑕疵是 scope 文案仍是 `mcpForm.scope.userGlobal`（"this provider" 措辞）"——实测 `userGlobal` = "User (Global)"／"用户（全局）"、其描述 `userProviderDescription` = "在任意项目可用"，**两串都不含 provider 字样**（含 `{{provider}}` 的是 `local*` 分支，而目录只用 user scope，永远走不到）。故该反对理由不成立、可划掉。**真正的代价只剩一条**：`provider` 这个 prop 在这里是"借来的能力位开关"而非事实声明——由常量注释点名 + 字段可见性用例（`cwd`/`envVars`/`bearerTokenEnvVar` 三件套）钉死，防它静默退化。实现在 §15-S5c。

---

## 审阅批注

### Pi · `01a11aa1-8b94-7688-aa15-31df06f7e2bf`

> [!CAUTION] 潜在严重风险：**目录 SSOT 会存入脱敏值，投影可能把 `<redacted>` 字面写进 harness 文件，造成密钥永久丢失。** 链路如下：§9.1 种子调 `listServersForScope('user')`，而该方法对每条结果都过 `sanitizeServerForResponse`（`mcp.provider.ts:98`），env/headers 已是 `<redacted>` 占位符——这些脱敏值会被原样写入 `mcp_servers.server_config`。之后投影走 `upsertServer`，靠 `restoreRedactedMcpValues`（`mcp.provider.ts:111-113`）从**文件里仍存在的旧条目**还原真实值；但这只在文件条目未被删除时成立。一旦用户 toggle off（`removeServer` 删掉文件条目）再 toggle on，文件里已无原值，目录里的 `<redacted>` 会被字面写入；用户手动删文件条目后重新开启同理。建议：**DB 存原始（未脱敏）配置，脱敏只在 REST 响应层做**；种子需新增一条不经 `sanitizeServerForResponse` 的 raw 读取路径（或在适配器上暴露 internal raw list）。这是本方案目前最大的正确性缺口，建议在 §6/§9/§11.1 三处同步修正表述。

> [!WARNING] §11.3 与 §13.5 自相矛盾：§11.3 把旧页 user 段改成"只读目录视图（读目录中勾选了本 harness 的条目）"，但 §13.5 又说非目录条目（`cloudcli-*`、手写 user 条目）"仍在旧页（文件视图）里可见"。旧页改造后 user 段只剩目录内容，这些条目在旧页也不可见了——用户会丢失对托管项和手写条目的所有可见性。需明确：旧页 user 段是"目录条目 + 目录外文件条目（只读）"混合展示，还是接受不可见并修订 §13.5。

> [!WARNING] dsh（`harnessManaged`）经种子灌入目录后会产生"死行"：§9.1 会把 dsh 的 user 条目入库并置 `enabled_dsh=1`，但 §12 把 dsh 整列禁用——用户既不能 toggle，`deleteCatalogEntry` 对 dsh 的 `removeServer` 也会被适配器拒绝（写入类操作一律被拒），结果目录里留下删不掉、改不了、与文件永久绑定的行，`resync` 同样对它无能为力。建议种子**排除 harnessManaged 的 harness**（dsh），或入库但不置 enabled 开关、矩阵中标注"仅查看"。

> [!TIP] 目录 `name` 的唯一性校验应放在 `normalizeServerName` **之后**：`upsertServer` 会先 normalize name 再写文件（`mcp.provider.ts:105`），若目录允许 `Foo Bar` 与 `foo_bar` 两行（唯一性按原文判），投影后它们是文件里的同一个 key，互相覆盖。建议仓储层统一以 normalize 后的 name 建行、做唯一约束。

> [!TIP] `transport` 双写易漂移：§6.1 说 `server_config` 与 `UpsertProviderMcpServerInput` 去 scope/name 后形状一致——那里面含 `transport` 字段，与同表的 `transport` 列构成两份真源。建议 `server_config` 落库时剥离 `transport`（以列为准），投影时由服务层合并回 input，避免编辑条目只改列不改 JSON（或反之）后投影行为不一致。

> [!TIP] `deleteCatalogEntry` 的"删目录 + 从所有曾启用 harness 移除"若部分失败（某 harness 写盘报错），目录行已删、文件里残留孤儿条目且矩阵不再可见（比 §13.1 更糟：连 resync 都救不回，因为目录行没了）。建议：删除操作返回逐 harness outcome 并在 UI 明示残留；或采用"先逐 harness remove 成功、最后删目录行"的顺序，失败则保留行。

> [!NOTE] §6.1 中 `name TEXT NOT NULL UNIQUE` 已隐式创建唯一索引，末尾的 `CREATE UNIQUE INDEX idx_mcp_servers_name` 与之重复，二者留一即可（建议留列约束、删显式索引，或反之并注明意图）。

> [!NOTE] §11.2 缓存失效的实现归属未写明：`mcpServersCache` 是 `useMcpServers.ts:66` 的模块级私有 Map，`useMcpCatalog` 无法直接触达。需从 `useMcpServers.ts` 导出失效函数（如 `invalidateMcpServersCache(provider?)`），建议在 §15 S5 分片中显式列入交付物。

### WorkBuddy · `d299c1f7-c60b-4689-9380-e49c63664744`

> [!CAUTION] 矩阵的高频写入会踩到「非原子整文件重写 + 无锁」这条既有暗线，§13.3「写盘安全不能退化」是错觉。已逐条核实：`claude` 的 `writeScopedServers` 读整个 `~/.claude.json`、赋 `config.mcpServers` 后调 `writeJsonConfig`（`claude-mcp.provider.ts:52-56`），而 `writeJsonConfig` 就是一句 `writeFile(path, JSON.stringify(data, null, 2))`（`server/shared/utils.ts:928-931`）——**无 temp+rename、无锁**；`codex` 同理走 `writeTomlConfig`（`codex-mcp.provider.ts:33`）。§13.3 把「原子写 + 操作锁 + symlink 防护」当成适配器的普遍属性来背书，实际只有 zcode 真做了原子写＋symlink 拒绝＋冲突检测（`zcode-mcp.provider.ts:115-153`），workbuddy 只有 symlink 防护（`O_NOFOLLOW`，`workbuddy-mcp.provider.ts:66-77`，同样无原子、无锁），claude/codex 两者皆无。旧路径一次只写一个 name、偶发为之，尚可容忍；矩阵点一下＝一次全量重写（开/关都要 mark 整份文件），批量与失败重试连发多次，于是：① 进程在 `writeFile` 中途被杀 ⇒ 用户的 `~/.claude.json`（远不止 MCP）被截断；② 与会话运行中写 MCP、切换 profile 并发 ⇒ 后写者用陈旧快照覆盖前写者（读-改-写全程无锁）。建议把 §6.3 的「切换互斥、实施时确认落点」从可选项升为 S2 的必做交付（服务层对同一文件串行化投影），并把 §13.3 改成如实描述；或先在 `writeJsonConfig`/`writeTomlConfig` 补原子化再谈矩阵。

> [!WARNING] §11.1 引用的安全基线文件不存在：`UnifiedMcpPanel.tsx:52,70`。已核 `find . -name "UnifiedMcpPanel*"`（排除 node_modules）为空，`git log --all -- "*UnifiedMcpPanel*"` 也无任何历史。矩阵搜索的 allow-list 借这份不存在的文件背书，S5 会找不到参照。请换成真实存在的消费者/基线，或删掉该引用。

> [!WARNING] §11.3「表单 scope 选项去掉 `user`」没写实现落点，而唯一现成机制恰是 §12 依赖的那张表。`McpServerFormModal` 的 scope 列表来自 `availableScopes = supportedScopes ?? MCP_SUPPORTED_SCOPES[provider]`（`McpServerFormModal.tsx:96`，`:286` 渲染）；若按字面去改 `MCP_SUPPORTED_SCOPES`，会连带把 §12 的「支持 user 才出列」判据打空（claude/cursor/… 的列全消失），旧页 user 只读视图也失去依据。正确落点是在**表单边界**传一个剔除 `user` 的 `supportedScopes`——该 prop 已存在，`McpServers.tsx:339` 就是先例——共享能力表一个字都别动。建议在 §11.3 / S6 写明。

> [!WARNING] §11.3 第一条「`ActionMenu` 的两条'新增'对 user scope 停用」与代码事实不符，且与同条第二句自相矛盾。`McpServers.tsx:160-188` 的 `ActionMenu` 只有 `global`/`provider` 两项，**没有 scope 维度**——scope 是在表单里选的（`McpServerFormModal` 的 `availableScopes`）。按字面「停用这两条新增」会把 local/project 的新增一起停掉，正是第二条要保留的东西。应改为：ActionMenu 两项保持可用，仅从表单里去掉 `user`（即上一条的过滤）。请改写这半句。

> [!WARNING] 种子期的同名冲突不只是「记日志」，它会把先到者的定义反向盖进后者的 harness 文件。§9.3 说冲突只 `warn`，但 §9.1 仍会给**每个**出现该 name 的 harness 置 `enabled_<p>=1`。于是保留下来的是先到者那份定义，此后任何 toggle/resync 都会用 `upsertServer` 把这份定义写进另一 harness——用户的 codex 配置被 claude 的定义静默改写，且这属于「目录合法行为」，连 resync 都不报错。建议：冲突 name 只对「定义所属的那个 harness」置 enabled=1，其余保持 0（或干脆不入库、单独列出）。§9.3 与 §14 的种子用例应补这条断言。

> [!WARNING] 路由用 `:name` 当身份，对含 `/` 的名字不可用，而 §6.1 定义的 `id` 全程没派上用场。`DELETE /mcp/catalog/:name`、`POST /mcp/catalog/:name/toggle` 在名字含 `/` 时（MCP 常见名如 `@modelcontextprotocol/server-filesystem`）必须由客户端 percent-encode 才能命中，文档没写这条约定，漏了就静默 404；`readPathParam`（`provider.routes.ts:28-41`）只做类型检查，既不拦也不还原。建议二选一：路由改走 §6.1 已声明的 `id`（顺带让 `id` 不再是死列），或明确规定所有客户端 `encodeURIComponent` 并补一条含 `/` 名字的路由测试。

> [!NOTE] §6.1 新加的 `description`/`homepage`/`docs`/`tags` 四列没有任何编辑入口。矩阵与旧页共用 `McpServerFormModal`，而它的字段只有 name/transport/command/args/cwd/url/env/headers/envVars（已逐字段核）。这四列要么补表单字段并说明用途，要么删掉——否则是四个永远为 NULL 的死列。

> [!TIP] Pi 的一条 TIP 前提不成立，请牵头复核后再采纳。该条说「`upsertServer` 会先 normalize name 再写文件…若目录允许 `Foo Bar` 与 `foo_bar` 两行，投影后它们是文件里的同一个 key，互相覆盖」。实测 `normalizeServerName`（`mcp.provider.ts:41-51`）**只做 `trim()`**，各适配器无二次归一化（grep `server/modules/providers/list/*/*-mcp.provider.ts` 无命中），`parseMcpUpsertPayload` 也不动 name（`provider.routes.ts:160-175`）。因此 `Foo Bar` 与 `foo_bar` 是两个不同 key，不会互相覆盖（codex 走 TOML 会自行给带空格的键加引号，也不炸）。「入口统一校验/归一 name」本身值得做，但理由要换。

> [!TIP] 脱敏面是 3 个字段，不是 2 个。`restoreRedactedMcpValues` 处理 `env`/`headers`/`envHttpHeaders`（`mcp.provider.ts:111-113`），Pi 的修正案只点了前两个。另外 §6.1 注释里「command/args/env/cwd/url/headers/envVars/...」的字段清单漏了 `bearerTokenEnvVar`、`envHttpHeaders`、`workspacePath`（真实类型见 `server/shared/types.ts:933-947`），而 `server_config` 号称「与 `UpsertProviderMcpServerInput` 去 scope/name 后一致」——清单不齐会让实现者漏字段。

> [!NOTE] 已复核为**正确**的引用（供牵头判断其余条目可信度）：§1/§7/§8 的行号（`mcp.provider.ts:56/98/107-116/145-161/191-199`、`mcp.service.ts:32/43/61/88`、`provider.routes.ts:770/788/798/813`、`server/index.ts:247` 及 `startServer` 内的 `initializeDatabase()`）；§1.1 能力位四个常量（`constants.ts:122/135/151/172/187` 逐值一致）；§10 的 6 处注册点确实是全部（types:1561 / constants:59 / SettingsSidebar:19 / useSettingsController:73 / Settings.tsx 分支 / i18n），额外引用它的只有 `CommandPalette.tsx:260`，由 `SETTINGS_MAIN_TABS` 驱动、无需单独注册；§8/§14 的「`/mcp/catalog` 与 `/:provider/...` 不重叠」成立（全量路由已枚举，无 2 段的 `/:provider/catalog`）。另：§12 说 dsh「写一律被拒」是对的，但闸门是 `DshMcpProvider.writeScopedServers` 直接 throw（`dsh-mcp.provider.ts:50-59`），**不是** `MCP_ADD_BLOCKED_REASON`——该常量只在 `src/` 侧消费，`server/` 内零命中。

### OpenCode · `ses_ee4ab4702ffefsIA044nQdlQkb`

> [!WARNING] §6.1 把 `server_config` 的形状定义为「`UpsertProviderMcpServerInput` 去掉 scope/name」。但这个类型的字段集**比投影实际需要的多一个 `workspacePath`**（`server/shared/types.ts:937`），而种子读取侧的 `ProviderMcpServer` 恰恰**没有** `workspacePath`（`:911-925`）。两头不对称：写库若照 §6.1 存整份 input，就会把一个**机器本地项目路径**固化进 SSOT，且它对本方案「仅 user scope」的目录毫无意义。正确基线应是 **`ProviderMcpServer` 去掉 `provider`/`scope`/`name`**（即 `transport/command/args/env/cwd/url/headers/envVars/bearerTokenEnvVar/envHttpHeaders`）。Pi 已指出字段清单漏项，但漏的根因是**选错了基准类型**——建议 §6.1 直接改挂 `ProviderMcpServer`，一并消掉 `transport` 双写（同表已有 `transport` 列）。

> [!WARNING] `mcp_servers` 的 9 个 `enabled_<p>` 列把 provider 集合**硬编码进了表结构**，与 `provider_models` 的 `CHECK (provider IN (...))`（`schema.ts:184`）一样，是「新增 harness 必须 ALTER TABLE」的耦合。§16.3 只讨论「列式 vs 关联表」的并发取舍，没点出真正代价：本仓库 harness 列表短期已从少数扩到 9 个（`dsh`/`pi`/`omp`/`zcode` 都是新增），每加一个 harness 就要再一次 migration 加列、改 `MCP_PROVIDER_NAMES`、改常量表。关联表 `mcp_server_enabled(server_id, provider)` 在这条演进线下更稳；若坚持列式，建议在 §16.3 明确「新增 harness 的迁移成本」作为已知债务，而不是只比 toggle 原子性。

> [!WARNING] §9.1 的种子只读 `listServersForScope('user')`，但该方法**只遍历 `supportedScopes` 里含 `user` 的 harness**（`mcp.provider.ts:89-91` 对不含 user 的直接返回 `[]`）。这意味着：一个 harness 若在 `listServersForScope` 上做了**行为裁剪**（例如 `DshMcpProvider` 把 user 侧读成「harness 合成结果」而非用户可写文件，`dsh-mcp.provider.ts:42-46`），种子会把**一份用户并不拥有、也删不掉的配置**灌进目录——叠加 WorkBuddy 指出的 dsh「死行」，问题比单看 §12 更早发生。建议种子对每个 harness 先用 `MCP_ADD_BLOCKED_REASON`（或等价的「可写性」判据）过滤，只种子**真正可由 CloudCLI 写回**的 harness。

> [!CAUTION] §7 的 `deleteCatalogEntry(name)` 签名用 `name` 而非 `id`，但 §6.1 明确 `name` 是「目录内身份」且给了 `id`（uuid）主键。二者在**改名场景**下语义分歧：若用户把条目从 `foo` 改成 `bar`（`upsertCatalogEntry` 按 name 主键），旧 name 的 harness 文件条目不会自动被 `removeServer`，`bar` 会被 upsert 进去 → **文件里同时留下 `foo` 和 `bar` 两个 key**，其中 `foo` 从此不在目录、矩阵不可见（正是 §13.1「文件→目录不收敛」的最坏形态，且由本方案自己的编辑动作制造，不是用户手改）。建议 `upsertCatalogEntry` 在改名时先对旧 name 做一次全 harness `removeServer` 再写新 name；或让入口按不可变 `id` 认条目、`name` 仅作显示，从根上禁用「改名」这条路径。

> [!TIP] §8 的路由用 `:name` 作路径参数（`/mcp/catalog/:name`、`/:name/toggle`），WorkBuddy 已指出含 `/` 名字的 encode 问题。补充一个**同源但不同层**的隐患：`readPathParam`（`provider.routes.ts:28-41`）只做类型检查、不做 decode，而 Express 默认会 **percent-decode** `req.params`——于是 `%2F` 到 `readPathParam` 时已经变成 `/`，服务层拿到的 name 与文件 key 是否一致取决于「谁在做归一化」。建议在 §8 明确「路由 → service 全程以 decode 后的原始 name 为准」，并在 §14 补一条含空格/斜杠/`%` 名字的往返用例，否则这类名字会在路由层静默错位。

> [!NOTE] §5 拍板表把「旧页 user 段 = 只读目录视图」记为决定 A，§11.3 据此实现，但**没有任何一条拍板决定「目录条目的编辑入口是否也受能力位限制」**。§12 只规定**格**（toggle）按 transport 禁格，而 §11.1 的「编辑」操作（`McpServerFormModal` → 写目录 + 投影已勾选列）允许用户把一条 `sse` 条目直接投影到 codex——绕过了格子的 transport 禁格。建议明确：编辑保存后对「已勾选但与新 transport 不兼容」的列，是自动取消勾选、还是标 `fail`，或在表单里就按已勾选列求交集限制 transport 选项。这是 §12 禁格规则在**编辑路径**上的缺口，S5 会直接撞上。
>
> **裁定+实施（S7）**：取"保存后自动取消勾选 + 提示"（§16.6 默认值）。§11.1/§12 已补实施记录。同时查实一处原文没说清的边界：适配器在 `upsertServer` 首行 `assertScopeAndTransport` 就会**拒掉**不支持的 transport，所以"把不支持的定义投影出去"实际不会发生（该拒绝以 `ok:false` 回报）——缺口的真实代价是**留下一格任何重试都清不掉的 `fail`（`resync` 也清不掉，因为开关是 on）**，以及用户不知道被拒的原因。

---

## 17. 审阅裁定与回写记录

> 三份外部审阅（Pi / WorkBuddy / OpenCode，全文见上）的逐条处置。**A 类 = 审阅者之间直接互斥，已按代码复算裁定**；**B 类 = 审阅者与文档冲突，已就地回写**；**C 类 = 文档自相矛盾**。回写后本方案条款以 §1–§16 的当前文本为准。

### 17.1 A 类：审阅者之间"直接互斥"（已裁定）

| # | 互斥双方 | 复算事实（本机实测） | 裁定 |
|---|---|---|---|
| **A1** | Pi（"`upsertServer` 先归一 name，`Foo Bar`≡`foo_bar` 会互相覆盖"）↔ WorkBuddy（"只 `trim()`，两者不同 key"） | `normalizeServerName` **只做 `trim()`**（`mcp.provider.ts:41-51`），各适配器无二次归一 | **采 WorkBuddy**，驳回 Pi 的"覆盖"论证；"入口统一校验/归一 name"降级为**加固**保留 |
| **A2** | WorkBuddy-W9（"§6.1 清单漏 `workspacePath` → 补齐"）↔ OpenCode-O1（"`workspacePath` 不该进 SSOT → 换基准类型"） | `UpsertProviderMcpServerInput` 有 `workspacePath`（`types.ts:937`），`ProviderMcpServer` 无（`:911-925`） | **采 O1**：§6.1 基准改挂 `ProviderMcpServer` 去 `provider/scope/name/transport`；并叠加 Pi-P5（`transport` 只存列、不进 `server_config`） |
| **A3** | OpenCode-O3（"种子用 `MCP_ADD_BLOCKED_REASON` 过滤"）↔ WorkBuddy-W10（"该常量 `server/` 零命中"） | 全仓 grep：仅 `src/shared/constants.ts` 等前端文件命中，`server/` 无 | **采目标、换机制**：种子只种 server 侧可写 harness；判据不引用前端常量（§9.1） |
| **A4**（轻微） | WorkBuddy-W6（"路由改用 `id`"）↔ OpenCode-O5（"保留 `name` + 明确 decode"） | MCP 名常含 `/`；Express 自动 percent-decode、`readPathParam` 不解码（`provider.routes.ts:28-41`） | **采 W6**：路由身份改 `id`（uuid），顺带解掉改名孤儿（O4） |

### 17.2 B 类：审阅者与文档冲突（已回写）

| 命中节 | 审阅者 | 处置 | 回写到 |
|---|---|---|---|
| §1 归因 | WorkBuddy-W10 | 采纳：dsh 写被拒的闸门是适配器 `throw`，非前端常量 | §1 |
| §6.1 基准/字段 | Pi-P5、Pi-P7、W7、W9、O1 | 采纳：换基准、剥 `transport`、删无入口死列、删重复唯一索引 | §6.1 |
| §6.3 并发 | WorkBuddy-W1 | 采纳：同一文件投影串行化升为 **S2 必做** | §6.3、§13.3、§15 |
| §7 删除/改名 | Pi-P6、O4 | 采纳：改名须清理旧 name；删除顺序与残留回报 | §7、§13.10 |
| §8 路由身份 | WorkBuddy-W6、O5 | 采纳：路径参数改 `id` | §8 |
| §9 种子 | Pi-P1、Pi-P3、W5、O3 | 采纳：存原始值 + raw 读取 + 排除不可写 harness + 冲突只置所属 harness | §9、§13.9 |
| §11.1 引用/搜索 | WorkBuddy-W2 | 采纳：删除不存在的 `UnifiedMcpPanel.tsx` 引用；搜索 allow-list 改为新要求 | §11.1 |
| §11.2 缓存 | Pi-P8 | 采纳：从 `useMcpServers` 导出失效函数，列为 S5 交付物 | §11.2、§15 |
| §11.3 改造 | Pi-P2、W3、W4 | 采纳：修 ActionMenu 论述、表单去 user 的落点、与 §13.5 的可见性矛盾 | §11.3、§13.5 |
| §12 禁格 | WorkBuddy-W10、O6 | 采纳：修 dsh 归因；补"编辑路径禁格" | §12、§11.1 |
| §16.3 列式 | OpenCode-O2 | 记录：列式的迁移债（默认未改） | §16.3 |

### 17.3 C 类：文档自相矛盾（已修）

- **§11.3 ↔ §13.5**（Pi-P2）：旧页 user 段改为"**目录条目 + 未纳管文件条目**"两段并集、**均只读**；§13.5 同步改写。
- **§11.3 内部**（W4）：删掉"停用 ActionMenu 两条新增"，改为"ActionMenu 保持可用、只从表单去 `user`"。
- **§6.1 索引重复**（Pi-P7）：删除显式 `CREATE UNIQUE INDEX`，保留列约束。
- **§1/§12 dsh 归因**（W10）：改为适配器 `throw`。

### 17.4 复核为**正确**、无需改动的引用（采信 WorkBuddy-W10）

§1/§7/§8 的行号（`mcp.provider.ts:56/98/107-116/145-161/191-199`、`mcp.service.ts:32/43/61/88`、`provider.routes.ts:770/788/798/813`、`server/index.ts:247` 及其 `startServer` 内的 `initializeDatabase()`）；§1.1 四个能力位常量（`constants.ts:122/135/151/172/187`）；§10 的 6 处注册点（`types:1561` / `constants:59` / `SettingsSidebar:19` / `useSettingsController:73` / `Settings.tsx` 分支 / i18n）；§8 的"`/mcp/catalog` 与 `/:provider/...` 路径不重叠"。

### 17.5 仍未闭环（实施时留意）

- ~~**Pi-P1 最高优先**~~ **已闭环（S2 + S3）**：S2 完成编辑路径那一半（`restoreRedactedMcpValues` 对照库内原始值还原），S3 完成种子路径那一半（新增 `listRawServersForScope`，种子不经 `sanitizeServerForResponse`）。落点裁定＝在适配器上新增 internal raw 方法，而非在服务层绕过脱敏。§13.9 的两条供应路径（编辑、种子）都已堵死。
- **W1 的原子化**：**S2 已裁定 = 不补 temp+rename，只落"逐 harness 投影串行化"**；理由（symlink 语义）与遗留范围见 §6.3。原子化本身仍待办，作为独立分片评估。
- **§16 开放项 5（改名策略）**：服务层已实现改名清理（§7），此项**降级为纯 UI 取舍**（锁不锁改名都不影响正确性）。
- **§16 开放项 6（编辑路径禁格）**：S2 未做——当前后端的表现是"投影失败 → 该格 `ok:false`、开关仍为 on"，即 §11.1 说的"绕过禁格"只是**报错**而非被阻止。前端按默认值（保存时自动取消不兼容列的勾选）实现后，这条才闭环；S7 收口。

