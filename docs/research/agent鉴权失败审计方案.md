# agent 鉴权失败审计方案（登录审计 phase 2）

> 状态：**草案 v1，待审阅批注**（尚未动任何代码）
> 日期：2026-10-13
> 用途：审阅时请重点核验 ① §3.1 事件类型的同步点清单是否还有遗漏；② §3.3 容量闸「共享单一计数器」的取舍；③ §1 现状表述是否与当前代码一致（`file:line` 已按工作区核过）；④ §8 五个开放问题的作者倾向是否成立
> 参考规范：`.agents/skills/backend-module-standards/SKILL.md`（后端）、`.agents/skills/frontend-module-standards/SKILL.md`（前端）；上游 `docs/research/登录审计功能方案.md`（phase 1，三轮审阅闭环，已实现并本地提交 C1–C6）

---

## 0. 前置：复用 phase 1 的既有设施（不重建）

| 已有 | 位置 |
|---|---|
| `auth_events` 表（`event_type TEXT`，**无 CHECK 约束**） | `schema.ts:346-356` |
| 写仓储 `authEventsDb.record(input)`（best-effort，异常自吞） | `auth-events.ts:87-124` |
| 容量闸（当前**只护 `login_failure`**），阈值 `MAX_LOGIN_FAILURE_ROWS = 100_000` | `auth-events.ts:89-103`、`:46` |
| 读端点 `GET /api/settings/auth-events`（JWT 保护） | `settings.routes.ts:50-56` |
| 设置页「登录日志」Tab（分页 / 按类型过滤 / 本地时区） | `LoginLogSettingsTab.tsx` |

phase 1 的边界继续遵守：审计**绝不阻断**认证（best-effort，G4）；平台模式**不写审计**（D9）；`ip` 是传输地址、非身份证明（不建索引）。

---

## 1. 背景与现状（实测）

agent 接口（`/api/agent`，`index.ts:257` 挂载，**无 JWT**）是给外部程序/脚本/CI 用的机器口，只认 API key（`x-api-key` 头或 `?apiKey=` 查询参数）。

`validateExternalApiKey`（`agent.routes.ts:91-123`）的失败出口：

| 分支 | 行为 | 现有日志 |
|---|---|---|
| 缺 key | `401 {error:'API key required'}`（`:111-113`） | **无** |
| key 无效 / 停用 | `401 {error:'Invalid or inactive API key'}`（`:117-119`） | **无** |
| 平台模式 | 取首个用户放行（`:94-106`） | 仅 DB 出错时 `console.error`（`:103`） |

即 **agent 口是当前唯一一个「外部可触达、却零日志」的鉴权面**。一次成功校验只更新 `last_used`（`api-keys.ts:87-91`）；失败不留任何痕迹。

对比：网页登录已有 `last_login` + 请求日志 + 本方案的 `login_failure`；WS 至少有一行 console WARN（`websocket-auth.service.ts:52`）。只有 agent 口完全静默。

> 注：若部署设置了 `process.env.API_KEY`，`/api/agent` 会**先**过全局 env-key 中间件（`index.ts:201`，`auth.middleware.ts:12-23`）。该分支的失败**不在本方案范围**（见 §2）。

---

## 2. 目标 / 非目标

**目标**

- G1：agent 鉴权失败（缺 key / key 无效）落库，可按 IP、时间过滤查询。
- G2：新事件与既有四类**共用同一张表、同一读端点、同一设置页 Tab**——不新增 UI。

**非目标**

- 不做 **WS 鉴权失败**（留 phase 3，理由见 §8-Q1）。
- 不做限流 / 封禁 / 告警推送（phase 1 的 D1 立场不变：审计 = 可见性，不是拦截）。
- **不记**尝试的 key 内容或任何前缀 / 哈希（秘密，见 §3.2 硬约束）。
- 不管全局 env `API_KEY` 中间件的失败（另一条路径，YAGNI）。
- 不改 agent 成功路径语义（成功仍只更新 `last_used`；是否另记 `agent_success` 见 §8-Q2，倾向不做）。

---

## 3. 设计

### 3.1 事件类型扩展：新增 `agent_auth_failure`

`AuthEventType` 是**封闭 union**，多处硬编码需同步（DB 无约束，改的是 TS 与 i18n）：

| # | 位置 | 改法 |
|---|---|---|
| 1 | `auth-events.ts:14` `AuthEventType` | 加 `'agent_auth_failure'` |
| 2 | `settings.service.ts:44-49` `AUTH_EVENT_TYPES` 白名单 | 加，否则读端点会拒绝该过滤值 |
| 3 | `src/shared/types.ts:1824` 前端 `AuthEventType` | 加 |
| 4 | `LoginLogSettingsTab.tsx:11` `EVENT_TYPES` | 加，否则过滤下拉里没有该选项 |
| 5 | 15 个 locale 的 `loginLog.event.*` | 加 `agent_auth_failure` 标签 |

**无需改** `auth.service.ts:20` 的 `AuthAuditEvent.type`——它只描述 **auth service 会发出**的事件，agent 不走 auth service。保持它窄，反而收窄了误用面（是否合并两份同形类型见 §8-Q3）。

`schema.ts:349` 的列注释（列举四个值）应同步追加新值，仅为文档准确性，不影响运行。

### 3.2 写路径：在 `validateExternalApiKey` 的 401 分支写

**落点**：`agent.routes.ts` 的 `validateExternalApiKey`（`:91-123`），两个 401 出口（`:111-113` 缺 key、`:117-119` 无效 key）各写一条，**然后照常** `return res.status(401)...`。

**依赖注入**：`AgentRouterDependencies`（`:18-41`）加 `audit: { record(event: AuthEventInput): void }`；由 `agent.module.ts`（`:31-61`）注入 `authEventsDb.record`，平台模式注入 no-op（与 `auth.module.ts:23-25` 同型）。

**上下文**：`req.ip`（Express，`trust proxy` 已生效）+ `req.headers['user-agent']`——与 auth 路由的 `requestContext()`（`auth.routes.ts:9-12`）同源、可信。**不像 WS**（裸 socket 地址）那样有反代后失真问题。

**字段**：

- `type: 'agent_auth_failure'`
- `userId: null`、`username: null`——key 无效时无从得知归属，**不得**回填（对齐 phase 1 D8 的精神）
- `ip` / `userAgent`

**硬约束 1（承接 G4）——审计绝不改变结果**：写入必须 try/catch 包住（或复用 auth 的 `recordAudit` 守卫模式），异常只 `console.error`，401 语义不受影响。

**硬约束 2——`@ts-nocheck` 的坑**：`agent.routes.ts` 首行是 `// @ts-nocheck`（`:1`），TypeScript **不会**帮你查字段名/类型错误。测试必须显式断言写入事件的内容，否则写错也无声。

**不记 key 片段**：key 是秘密，任何前缀 / 哈希都是泄漏面（对齐 §8-Q4）。**只记来源**（ip / ua）。

### 3.3 容量闸泛化：从「只护 login_failure」到「护所有外部可写的失败类型」

**现状**：闸门判定写死 `input.type === 'login_failure'`（`auth-events.ts:89`），计数器 `inserted` 也只对 `login_failure` 递增（`:116`）。

**问题**：`agent_auth_failure` **同样**是外部零成本可写（`/api/agent` 无 JWT）。若不纳入闸门，等于**新开一个存储 DoS 口**，违背 phase 1 C1 的结论。

**改法**：

- 抽出受闸集合常量，例如 `GATED_FAILURE_TYPES = new Set(['login_failure', 'agent_auth_failure'])`；判定与计数都改用它。
- `MAX_LOGIN_FAILURE_ROWS`（`:46`）与工厂参数名（`:68`）**更名去掉 "login"**（如 `maxFailureRows`），告警文案同步（当前文案写死 "login_failure recording paused"）。

**语义保留**：单一计数器 = 两类失败**共享**同一上限（先到先占），保持 O(1) 且不查库。不拆成两个计数器——拆了要维护两套状态与两套告警，YAGNI。触顶仍**粘滞至重启 / 手动清理**（phase 1 D11 / N4 的已知限制）。

### 3.4 平台模式

`IS_PLATFORM` 在 `agent.routes.ts:94` **先于** key 校验短路 → 平台模式天然不产生 `agent_auth_failure`；同时 `audit` 也注入 no-op。两侧一致，无需额外分支。

### 3.5 读侧与 i18n

读端点逻辑**无需改**（`listAuthEvents` 已按 `event_type` 过滤，白名单加值即可）。前端只需 §3.1 的第 3–5 项：union + `EVENT_TYPES` 数组 + 15 个 locale 标签。

---

## 4. 决策记录（承接 phase 1 的 D1–D16，续编 D17–D22）

| # | 决策 | 依据 |
|---|---|---|
| D17 | 范围**只做 agent**，WS 留 phase 3 | §8-Q1；用户拍板「按推荐」 |
| D18 | 新类型独立命名 `agent_auth_failure`（**不**合并为通用 `auth_failure` + `surface` 列） | 避免改 schema 加列；每条事件语义清晰、各有一枚 i18n 标签 |
| D19 | **缺 key** 与 **无效 key** 都记，共用同一事件类型 | 两者都是未授权探测信号；不为「缺 key」单开类型（避免枚举膨胀） |
| D20 | **不记** key 内容 / 前缀 / 哈希 | 秘密不落日志 |
| D21 | 容量闸**泛化**为受闸失败类型集合，两类**共享**单一计数器 | 防新开储 DoS 口；实现最简 |
| D22 | 成功请求**不**加 `agent_success` 事件 | 无检测价值；`last_used` 已覆盖成功侧 |

---

## 5. 改动清单（按文件）

**后端**

1. `server/modules/database/repositories/auth-events.ts`：`AuthEventType` 加值；新增受闸集合常量并用于判定 / 计数；`MAX_*` 与工厂参数更名；告警文案。
2. `server/modules/agent/agent.routes.ts`：`AgentRouterDependencies` 加 `audit`；两个 401 分支写事件（守卫包住）。
3. `server/modules/agent/agent.module.ts`：注入 `audit`（平台 no-op）。
4. `server/modules/settings/settings.service.ts`：`AUTH_EVENT_TYPES` 加值。
5. `server/modules/database/schema.ts`：`:349` 列注释同步（可选，纯文档）。

**前端**

6. `src/shared/types.ts`：`AuthEventType` 加值。
7. `src/modules/settings/tabs/LoginLogSettingsTab.tsx`：`EVENT_TYPES` 加值。
8. `src/modules/i18n/locales/*/settings.json`（15 个）：`loginLog.event.agent_auth_failure`。

**测试**

9. `server/modules/agent/tests/`（若已有则扩展，否则新建）：缺 key / 无效 key → `audit.record` 被调用且字段正确；`audit.record` 抛错 → 仍返回 401。
10. `server/modules/database/tests/auth-events.db.integration.test.ts`：`agent_auth_failure` 纳入容量闸（与 `login_failure` 共享计数）。

---

## 6. 验收清单（DoD）

- [ ] 无效 key / 缺 key 请求 → 设置页「登录日志」出现 `agent_auth_failure` 行，IP 与 UA 正确、用户名列为 `—`。
- [ ] 事件类型过滤下拉含该类型，且能筛出对应记录。
- [ ] 让 `audit.record` 抛错 → 请求仍返回 401（认证结果不变）。
- [ ] 容量闸：`agent_auth_failure` 与 `login_failure` 共享计数，触顶后两者都停写（不查库）。
- [ ] 平台模式下不产生该行。
- [ ] 15 个 locale 均含新键（en / zh-CN / zh-TW 有译文，其余英文占位，与 phase 1 一致）。
- [ ] `npm run typecheck`（server + client）、lint、相关测试通过。

---

## 7. 风险

| 风险 | 级别 | 缓解 |
|---|---|---|
| `agent.routes.ts` 有 `@ts-nocheck`，字段/类型写错不报错 | 中 | §5-9 测试显式断言写入字段 |
| 无 key 的健康检查 / 误配客户端刷日志 | 低 | 这正是可见性目标；容量闸兜底 |
| 容量闸共享计数被 login 攻击先占满 → agent 失败停记 | 低 | 已知粘滞限制（D11 / N4），告警文案注明 |
| 15 locale 漏改 | 低 | i18n fallback = en；DoD 显式校验 |
| 枚举在 5+ 处硬编码，将来再加易漂移 | 低 | 本方案已列出全部同步点；§8-Q3 讨论是否收敛类型 |

---

## 8. 开放问题（附作者倾向）

| # | 问题 | 倾向 |
|---|---|---|
| Q1 | 本方案是否一并做 WS 鉴权失败？ | **不做**（D17）。WS 已有 console WARN；升级请求只有裸 socket 地址，反代后 IP 不可信；且良性噪声多（过期 token、重连）。留 phase 3 |
| Q2 | 成功的 agent 请求是否也记一条（如 `agent_success`）？ | **不记**。无检测价值，`last_used` 已覆盖成功侧 |
| Q3 | `auth.service.ts` 的 `AuthAuditEvent` 与 repo 的 `AuthEventInput` 是同形两份 union，是否趁机合并？ | **不合并**。auth 侧保持窄 union（只列它自己会发的值）可收窄误用面；合并要动已完成并测试过的 phase 1 代码，收益低 |
| Q4 | 缺 key 是否要单独一个类型（如 `agent_auth_missing`）？ | **不拆**。都用 `agent_auth_failure`，避免枚举膨胀；区分价值低 |
| Q5 | 容量闸共享一个计数器，还是两类各一个？ | **共享**（D21）。实现最简、语义即「失败事件总量有界」 |

---

## 审阅批注

### 审阅者：（待填）

| 章节 | 批注 | 作者响应 |
| --- | --- | --- |
|  |  |  |

> 处理流程：作者收到批注后**逐条回源码核验前提**（不照单接受），裁决为「采纳 / 采纳但修正处方 / 不采纳并给理由」，回写正文并在修订处标注轮次，最后追加 `### 作者响应：<名>（<日期>）` 段落。**审阅者原文不得覆盖或删改**。

