# 合并前审查报告：DSH 会话 / MCP 写入 / 附件回收 / 定时任务

- 项目：`cloudcli`（TypeScript，`server/` 后端 + `src/` React 前端）
- 审查对象：当前工作区未提交改动（81 个已跟踪文件 +3628/−562，另有 19 个新增源码文件）
- 审查日期：2026-11-06
- 用途：交给另一个 AI 或另一位工程师逐条复核结论是否成立、修复方案是否安全
- 编译与测试状态：`npm run typecheck` 通过；`scheduled-tasks` 18 项、`dsh-*` + `assets` 106 项、前端相关 1181 项测试全部通过。**以下问题都不是编译错误或测试失败**，而是测试未覆盖的逻辑缺口。

## 给审批者的阅读方式

每个条目固定六段：**结论 → 代码证据 → 触发路径 → 影响 → 现有防护为何失效 → 修复建议与验证**。文末有「已推翻/降级的原判断」和「审批判定清单」两节，请优先看那两节——它们说明这份报告与第一版口头审查结论的差异。

严重度定义：

- **S（严重）**：会导致用户数据或配置静默丢失/损坏，或让用户看到与事实相反的状态。
- **H（潜在）**：当前不必然触发，或影响可自愈；但在特定条件（多进程、开发模式、未来功能接入）下会变成真实缺陷。
- **置信度**：已按当前代码逐行核对。标注「条件性」的条目依赖某个外部事实，报告里写明了如何确认。

与第一版口头清单的对应关系（便于对照审批）：

| 第一版 | 本文 | 变化 |
| --- | --- | --- |
| #1 MCP 托管块被清空 | S1 | 保留严重；补充了 `<redacted>` 密钥覆盖与 `removeServer` 静默不一致两个同源后果，删除了不可达的 `writeScopedServers` 路径 |
| #2 transcript 只按 UTF-8 读 | H1 | **降级**：DSH 当前不消费附件，暂不触发 |
| #3 `markAssetReferences` 无调用方 | H2 | 保留，补充"前端也没有 localStorage 持久化" |
| #4 失败任务记成 completed | S2 | **升级为严重**：Claude 同形，影响所有 provider；批注补充了定时消息与排队消息两个消费方 |
| #5 每次目录请求 spawn dsh | H3 | 保留，修正了每操作的实际调用次数（1–5 次） |
| #6 权限变 0600 | H4 | 保留，补充属主/xattr 丢失 |
| #7 表单清空输入 | H5 | 保留 |
| #8 对象 URL 在 render 创建 | H6 | 保留，明确仅影响开发模式 |
| #9 updater 内副作用 | H7 | 保留，明确当前可自愈 |
| #10 启动无条件 fail running | H8 | 保留，把"重复执行"提到首位后果 |
| — | H9 | 新增观察：transcript 是唯一保命线，无第二道保险 |

**修订记录（2026-11-06，依据 WorkBuddy 批注）**

- S2：补入定时消息与排队消息两个消费方；纠正"`dispatchRun` 是唯一调用点"的说法，补上 `getRunner` → `agentRoutes` / `gitRoutes` 两个入口。
- S1：修复方案从"加一次门禁"改为"门禁 + 透传 baseline + 结构性不变量"，并补了 TOCTOU、单槽备份的补救路径。
- H1：跳过分支要求留下可观测信号；与 H9 合并为同一个判定。
- 判定清单：从 8 条扩到 11 条，把 S1 的 TOCTOU/补救、S2 的消费方、H1+H9 拆成独立问题。

---

# 一、严重问题

## S1. DSH dump 失败时，改一个 MCP server 会把整个托管块清空

**结论**：`dsh --dump-config` 失败（CLI 未安装、升级后参数变化、配置文件本身有语法错误、10s 超时）时，`readDshComposedMcpServers()` 返回 `{ok:false, all:{}, managed:{}}`。`upsertServer` 把这个空对象当成"当前没有任何托管条目"，随后用「只有一个条目」的映射重建整块。`applyDshManagedMcpBlock` 是整块重建语义，于是块内其余所有 CloudCLI 托管的 MCP server 被静默删除。更糟的是写入前的校验被主动跳过，这次破坏不会被回滚。

**代码证据**

1. 失败时返回空集合，且丢掉了 `ok` 标记的使用者：

```ts
// server/modules/providers/list/dsh/dsh-cordis.provider.ts:405
export function readDshComposedMcpServers(): DshComposedMcpServers {
  const { ok, document } = readDshComposedDocument();
  if (!ok) {
    return { ok: false, all: {}, managed: {} };   // 空集合 + ok:false
  }
  return { ok: true, ...splitDshMcpServerConfigs(parseDshComposedEntries(document)) };
}
```

2. `upsertServer` 只读 `managed`/`all`，从不读 `ok`：

```ts
// server/modules/providers/list/dsh/dsh-mcp.provider.ts:685
const composed = readDshComposedMcpServers();
const persisted = this.normalizeServerConfig(scope, name, composed.all[name]); // undefined → null

if (Object.prototype.hasOwnProperty.call(composed.managed, name)) {
  await writeManagedServers({ ...composed.managed, [name]: config });   // :695 不可达（managed 为空）
} else if (readHomePatchServerNames().has(name)) {
  await writePatchLayer(/* 只改 config: 体，安全 */);
} else if (Object.prototype.hasOwnProperty.call(composed.all, name)) {
  throw externallyManagedError(name);                                    // :703 不可达（all 为空）
} else {
  await writeManagedServers({ ...composed.managed, [name]: config });    // :705 ← 实际走到这里
}
```

3. 写入层是"整块重建"，不是"增加一条"：

```ts
// server/modules/providers/list/dsh/dsh-mcp.provider.ts:231
export function applyDshManagedMcpBlock(content: string, servers: Record<string, unknown>): string {
  const block = renderDshManagedMcpBlock(servers);   // 由传入的完整映射重新渲染
  ...
  return `${before}${block}${after}`;                // 标记行之间整段替换
}
```

4. 写入校验因基线不可用而被跳过，破坏不会回滚：

```ts
// server/modules/providers/list/dsh/dsh-mcp.provider.ts:526
const baseline = readDshComposedMcpServers();
...
await writeFileAtomicThroughLinks(filePath, nextContent);

if (!baseline.ok) {
  // The CLI cannot dump on this machine, so the write cannot be verified.
  // Keeping it is safer than deleting a file the user can still inspect.
  restartDshAcpServerIfIdle();
  return;                       // :534-540 直接保留写入
}
```

5. 同源的第二处后果（密钥被写成字面量）：

```ts
// server/modules/providers/list/dsh/dsh-mcp.provider.ts:812
const restoreSecrets = (requested?, persisted?) => {
  if (!requested || !persisted) return requested;   // persisted 为 null 时原样返回
  ...
};
```

`persisted` 来自 `composed.all[name]`。dump 失败时它是 `undefined`，于是旧表单提交的 `<redacted>` 占位符会被原样写进 `cordis.patch.yml`，真实 token/header 被覆盖成字符串 `<redacted>`。这条路径仍需前端配合：`src/modules/mcp/hooks/useMcpServers.ts:216` 的 `saveProviderServer` 仍挂在 `src/modules/settings/tabs/agents-settings/sections/AgentCategoryContentSection.tsx` 里（`McpServers` 组件），所以**是可达的**，不是纯理论。

6. 删除路径的静默不一致（同根因，影响较轻）：`removeServer`（:731）在 dump 失败时 `composed.managed` 为空、`readHomePatchServerNames()` 也不含该名字，于是返回 `{removed:false}`。上层据此删掉目录行并清掉开关，但 `cordis.patch.yml` 里的条目还在，harness 重启后依然挂载一个 UI 里已经消失的 server。

**触发路径**

1. 用户机器上 `dsh` 不在 PATH，或 `dsh --dump-config` 因配置损坏/版本变化退出非 0，或耗时超过 `DUMP_TIMEOUT_MS = 10_000`（`dsh-cordis.provider.ts:27`）。
2. 用户在设置里新增/编辑任意一个 DSH MCP server（走目录矩阵或 provider 级表单均可）。
3. `readDshComposedMcpServers()` 返回空集合 → 走 `:705` → `applyDshManagedMcpBlock(content, {新条目})` → 块内原有条目全部消失。
4. `writePatchLayer` 的 `baseline.ok === false` → 不校验、不回滚 → 写入落盘。
5. 文件是原子替换的，用户即使发现也只剩 `.bak` 备份（`copyFile(filePath, backupPath)`，但备份只保留最后一次写入前的内容，且不是恢复入口）。

**影响**

- 用户此前通过 CloudCLI 配置的所有 DSH MCP server 一次性消失，且没有任何报错。下次启动 harness 后工具能力静默减少，表现为"模型突然不会用某个工具"。
- 若用户正在编辑一个带密钥的 server，密钥会被字面量 `<redacted>` 覆盖（见上）。
- 目录矩阵里那些 server 仍显示为"已启用"，因为数据库是 SSOT，UI 与实际配置文件从此不一致。

**现有防护为何失效**

- 单条读取有 `ok` 字段，但**只有** `writePatchLayer` 读取它，而且读它是为了"跳过校验"，不是为了"拒绝写入"。
- `writeManagedServers` 的校验 `isApplied` 是"我写的名字都在 managed 里"，清空后只剩新名字，条件依然满足（虽然此处因 baseline 不可用根本没跑）。
- 文件级 `applyDshManagedMcpBlock` 是纯函数，拿不到"这次传入的映射是否完整"这个信息。
- 测试只钉住了 `{ok:false}` 的返回形状（`server/modules/providers/tests/dsh-mcp.test.ts:202`），没有覆盖"dump 失败 + 已有托管条目"的写入路径。

**修复建议（最小改动）**

第一道是前置门禁，宁可 409 也不盲写：

```ts
const composed = readDshComposedMcpServers();
if (!composed.ok) {
  throw new AppError(
    'DSH 的配置暂时无法读取（dsh --dump-config 失败），现在改写 MCP 配置块会丢失已有条目。',
    { code: 'DSH_MCP_UNREADABLE', statusCode: 409 },
  );
}
```

第二道是**把门禁读到的 `composed` 透传给写入层复用**，不要让 `writePatchLayer` 在 `:526` / `:541` 再各 dump 一次：

```ts
// 现在：门禁 1 次 + baseline 1 次 + after 1 次（3 次 dump，且三次之间状态可变）
// 改为：门禁 1 次 + after 1 次（2 次），写入层用调用方已验证的 baseline
const writeManagedServers = (
  servers: Record<string, unknown>,
  baseline: DshComposedMcpServers,          // ← 由调用方传入，内部不再 readDshComposedMcpServers()
) => writePatchLayer(/* ... */, baseline);
```

这一点是评审批注指出的 TOCTOU：如果第一次 dump 成功、第二次失败，门禁会放行，而写入层拿到 `!baseline.ok` 后走 `:534` 的"保留写入、不校验"分支。透传之后，"放行"与"能校验"来自同一次读取，不存在中间态。

第三道是**结构性不变量**：写入前断言本次映射包含 baseline 的全部托管键（删除操作只允许少一个指定键）。这条比 `ok` 判定更强，能同时挡住"空映射重建"和未来新增调用点：

```ts
const unexpectedMissing = Object.keys(baseline.managed)
  .filter((key) => !(key in servers) && key !== allowedRemoval);
if (unexpectedMissing.length > 0) {
  throw new AppError(`拒绝重建：本次写入会丢掉 ${unexpectedMissing.join(', ')}`, {
    code: 'DSH_MCP_WRITE_INCOMPLETE', statusCode: 409,
  });
}
```

不建议的做法：dump 失败时"按文件原文解析托管块"来构造映射。托管块的解析器只处理 `serverName`/`config:` 的固定结构，对用户手写的 YAML 变体（锚点、折叠标量、`!!js`）并不完备，用它重建等于把可靠性押在一个只用于渲染的解析器上。

**事故补救（已经清空过的用户怎么办）**

现有代码只保留一个 `${filePath}.bak` 槽位（`dsh-mcp.provider.ts:532` `copyFile(filePath, backupPath)`），且每次写入前覆盖。这意味着：

- 清空发生的那一刻，`.bak` 里通常是清空前的完整内容——这是**唯一可用的恢复源**。
- 但用户只要再做一次写入（哪怕只是改另一个 server），`.bak` 就被"已被清空的内容"覆盖，恢复窗口彻底关闭。
- 代码里没有任何读取 `.bak` 的路径，也没有提示用户它存在。

建议随修复一起做：

1. 改为带时间戳的多槽备份（`cordis.patch.yml.bak-20261106T091000Z`），保留最近 3–5 份；写入前先确认备份可读。
2. 提供一个明确的恢复入口（CLI 子命令或设置页的"恢复 MCP 配置"，列出备份及条目数量，选一份写回）。
3. 最低限度：在写入成功后检查"本次写入删除的托管键数 > 1"时，向用户发一条通知并指出 `.bak` 路径——即使不做恢复入口，也别让事故无声无息。

**验证**

- 单测：准备一个含 2 条 `cloudcli-mcp-*` 条目的 patch 文件，注入一个 `spawnSync` 必然失败的 PATH，调用 `upsertServer('new')`，断言：抛 409，且文件字节未变。
- TOCTOU 单测：第一次 dump 成功、第二次失败（用可控 stub 计数），断言写入被拒绝或回滚，而不是"保留未校验的写入"。
- 不变量单测：直接调 `writeManagedServers({ new: cfg }, baselineWithTwoEntries)`，断言抛 `DSH_MCP_WRITE_INCOMPLETE`。
- 手工：`PATH=/tmp/fake-bin:$PATH` 放一个 `dsh` 脚本 `exit 1`，在 UI 里改一个 server，`git diff` 看 `cordis.patch.yml`。

**风险与副作用**

- 前置门禁会让"CLI 暂时不可用时的编辑"直接失败。这是有意取舍：当前行为是静默毁配置，失败更安全。
- 若产品希望 dump 不可用时仍能编辑，需要另做"只在文件内定位单条并替换"的写入器，而不是复用整块重建。

**置信度**：高（全部路径已逐行核对；`writeScopedServers` 那条不算，见文末修正）。

---

## S2. 一次失败的轮次会被下游记成"已完成/已发送"（影响所有 provider 与全部调度链路）

**结论**：`runDetachedChatTurn` / `dispatchRun` 只在 `runtime.run(...)` **抛异常**时返回 `error`。Claude 与 DSH 的运行时都把失败处理成「发一条 `error` 事件 + 发 `complete(exitCode:1)` + 正常 return」，于是 `dispatchRun` 返回 `{started:true, error:null}`。

这同一个返回值被**三个**下游当成成败判据，全部判错：

| 下游 | 判定方式 | 失败后的实际结果 |
| --- | --- | --- |
| 定时任务 `scheduled-task-dispatcher.service.ts:106` | `!result.started \|\| result.error` → `failed` | 写成 `completed` |
| 定时消息 `scheduled-message-dispatcher.service.ts:103` | `!result.started \|\| result.error` → `recordFailure` | **保持 `sent`**（`claimDue` 在发送前就把状态改成 `sent`，见 `scheduled-messages.db.ts:94`） |
| 排队消息 `scheduled-message-dispatcher.service.ts:41-53` | 只特判 `error === 'A run was already in progress…'`，其余情况直接 `deleteEmptyDraft` | **排队内容被静默丢弃**：`claimQueuedMessage` 已把 `queued_message` 置空，之后不再恢复 |

定时消息那条比定时任务更难发现：用户等一条永远不会来的回复，列表里却是"已发送"。排队消息那条更糟：连失败记录都没有，用户只看到输入框里的排队卡片消失了。

**代码证据**

```ts
// server/modules/websocket/services/chat-websocket.service.ts:314
try {
  await beforeRun?.(run);
  await dependencies.runtime.run(provider, command, runtimeOptions, run.writer);
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);   // 只有抛异常才有 failure
} finally {
  chatRunRegistry.completeRunIfCurrent(run, { exitCode: 1 });
}
return { started: true, error: failure };                             // :328
```

```ts
// server/modules/providers/list/dsh/dsh-runtime.provider.ts:688
} catch (error) {
  const message = ...;
  writer.send(createNormalizedMessage({ kind: 'error', ... }));
  writer.send(createCompleteMessage({ provider: 'dsh', sessionId: appSessionId, exitCode: 1 }));
  notifyRunFailed({ ... });
  return;                                    // ← 正常返回，异常被吞掉
}
```

```ts
// server/modules/providers/list/dsh/dsh-runtime.provider.ts:766（turn 非正常结束）
const message = error instanceof Error ? error.message : String(error);
writer.send(... kind: 'error' ...);
writer.send(createCompleteMessage({ ..., exitCode: 1 }));
notifyRunFailed({ ... });
```

Claude 有完全相同的形态（`server/modules/providers/list/claude/claude-runtime.provider.ts:1787-1790`）：

```ts
deltaBatcher.send(createNormalizedMessage({ kind: 'error', ... }));
if (!turnCompleteSent) {
  deltaBatcher.send(createCompleteMessage({ ..., exitCode: 1 }));
}
notifyRunFailed({ ... });     // catch 内部，不 rethrow
```

```ts
// server/modules/scheduled-tasks/services/scheduled-task-dispatcher.service.ts:106
if (!result.started || result.error) {
  scheduledTasksDb.finishRun(runId, { status: 'failed', ... });
  return;
}
scheduledTasksDb.finishRun(runId, { status: 'completed', sessionId });   // :115
```

```ts
// server/modules/scheduled-messages/services/scheduled-message-dispatcher.service.ts:103
if (!result.started || result.error) {
  recordFailure(row, result.error ?? 'The session was unavailable when this was due.');
}
// 否则什么都不做 —— 而 claimDue 已在发送前写入 status='sent'
```

```ts
// server/modules/scheduled-messages/services/scheduled-message-dispatcher.service.ts:41
const result = await runDetachedChatTurn({ ... }, { runtime });

// 只把这一个竞态放回队列，其他任何失败都继续往下走
if (!result.started && result.error === 'A run was already in progress for this session.') {
  sessionDraftsDb.restoreQueuedMessage(candidate);
  return;
}
sessionDraftsDb.deleteEmptyDraft(candidate.userId, candidate.sessionId);   // queued_message 早已被置空，内容丢失
```

**触发路径**

1. 定时任务到点，`executeTask` 创建会话并调用 `runDetachedChatTurn`。
2. 运行时启动成功，但这一轮失败：模型不可用、provider 鉴权过期、resume 失败、DSH stopReason 不是 `end_turn`/`max_tokens`/`max_turn_requests`、进程中途崩溃后 `prompt()` reject 等。
3. 运行时走 catch，发 `error` + `complete(exitCode:1)`，随后 `return`。
4. `dispatchRun` 的 `await` 正常 resolve，`failure` 仍为 `null`。
5. 调度器写 `status='completed'`。

**影响**

- 定时任务：运行历史把失败显示为成功，用户失去"这个任务已经连坏三天"的唯一信号。
- 定时消息：状态停在 `sent`，用户以为消息已送达，实际这条消息从未进入会话。
- 排队消息：`claimQueuedMessage` 已把 `queued_message` 置空，失败后不恢复、也不记录，内容直接消失；若同时没有输入框草稿，整行还会被 `deleteEmptyDraft` 删掉。用户只看到排队卡片没了。
- 依赖运行状态的产品逻辑（重试、告警、连续失败自动禁用）全部失效。
- 与 `notifyRunFailed` 行为矛盾：用户可能收到一条失败通知，但历史里是"已完成"。
- 附带影响：`agent.routes.ts` 直接调用 runner（`getRunner` 注入的 `queryDsh`/`queryCodex` 等），失败后仍会继续执行"创建分支/PR"逻辑（`agent.routes.ts:1236` 起，只根据 `aborted` 判断）。方案 A 让异常冒到 `:1467` 的 catch，反而会阻止"跑挂了还去开 PR"。

**现有防护为何失效**

- `chatRunRegistry` 记录了终态，但**没有记录 exitCode**（`ChatRun` 类型只有 `status/lastSeq/events/completedAt`，`server/modules/websocket/services/chat-run-registry.service.ts:26-36`），且完成记录 5 分钟后被驱逐（`:43`），调用方无法事后查询。
- `notifyRunFailed` 只发通知，不改变调度器读取的返回值。
- 唯一能反映失败的事件在 `run.events` 里，但 `replayEvents` 是给 WS 订阅用的接口，不是给调度器判断状态用的。

**修复建议（二选一，推荐 A）**

A. 让运行时的失败分支**继续抛**（在 `writer.send(complete)` 之后 `throw new Error(message)`）。这是最小改动，且与 `dispatchRun` 的契约一致：

```ts
// dsh-runtime.provider.ts:688 的 catch 末尾
writer.send(createCompleteMessage({ ..., exitCode: 1 }));
notifyRunFailed({ ... });
throw error;                    // 让 dispatchRun 拿到失败
```

安全性已验证：`completeRunIfCurrent` 在 `run.status === 'completed'` 时是 no-op（`chat-run-registry.service.ts:324-330`），所以 `dispatchRun` 的 `finally` 不会再发第二条 `complete`；交互式会话只会多一行 `[Chat] Provider runtime failed` 日志，行为不变。Claude 的 `:1787` 同样处理。

注意：**方案 A 不足以修好排队消息**。即使 `result.error` 变成非空，`sendClaimedQueuedMessage` 仍只会对 `'A run was already in progress…'` 恢复，其余错误继续删草稿。这条路径必须单独改：

```ts
if (!result.started || result.error) {
  sessionDraftsDb.restoreQueuedMessage(candidate);          // 先把内容放回去
  if (result.error) notifyQueuedMessageFailed(candidate, result.error);   // 再让用户知道
  return;
}
```

B. 在 `runDetachedChatTurn` 内包装 writer，捕获终态 `complete` 的 `exitCode`，随返回值一起返回 `{started, error, exitCode}`。改动面更大，但不需要改各 runtime，且三个下游都能直接用同一个判定。

**验证**

- 单测：`dispatchDueScheduledTasks` 注入 fake runtime，其 `run` 先 `writer.send(error)` 再 `writer.send(complete{exitCode:1})` 然后正常 return；断言 run 行最终为 `failed`。
- 反向用例：`stopReason === 'cancelled'`（用户中止）应保持现有语义，不要被记成 failed。

**风险与副作用**

- 方案 A 会让所有 provider 的交互式失败在服务端日志里多一条 `console.error`；不影响前端渲染（`complete` 已经先发过了）。
- **"`dispatchRun` 是唯一调用点"这句话不成立**（第一版写错了）。真实入口是 `providerRuntimeService.run`（`server/modules/providers/services/provider-runtime.service.ts:72-79`），它被两类调用方使用：
  - `dispatchRun`（`chat-websocket.service.ts:315`）——有 try/catch。
  - `getRunner`（`server/index.ts:104-121`）注入的 `agentRoutes` 与 `gitRoutes`：
    - `agent.routes.ts` 直接调 `queryDsh`/`queryCodex` 等（`:1149`、`:1173`），最外层 `catch` 在 `:1467`，会发 `error` 事件并清理克隆目录。
    - `git.routes.ts:1188` 调 `queryClaudeSDK` 生成提交信息，整段在 `try` 内，`catch` 回退到 `chore: update N file(s)`。
  结论：方案 A 仍然安全，但审批时请按这三个入口核，而不是只看 `dispatchRun`。另外 `agent.routes.ts` 在失败后仍会继续走"建分支/PR"（`:1236`，只看 `aborted`），方案 A 会让它提前进 catch，这是行为修正而非回归；`git.routes.ts` 则会落到既有的兜底提交信息，同样是预期的失败路径。

**置信度**：高。这是第一版审查中低估的一条——原判断写成"DSH 特有"，实际 Claude 同形，**所有 provider 都受影响**。

---

# 二、潜在隐患

## H1. 附件回收只按 UTF-8 读 transcript，DSH 的 zstd 日志读不出引用

> **相对第一版的修正：严重度从「会删掉 DSH 图片」降为「当前不触发的潜在缺陷」，理由见下。**

**结论**：`collectTranscriptReferences` 对所有 `sessions.jsonl_path` 一律 `fs.readFile(..., 'utf8')`。DSH 的日志是 `session[.vN].jsonl.zstd`（多帧 zstd），按 UTF-8 读出来是二进制乱码，`assets/<name>` 永远匹配不到。**但 DSH runtime 目前根本不消费 `options.attachments/images/files`**（全仓只有 zcode/claude/omp/pi/workbuddy/codex 消费），所以 DSH 的 prompt 里不会出现附件路径，当前没有"只被 DSH 日志引用"的文件。这条现在是防御性缺陷，一旦 DSH 接入附件就会立刻变成真实的数据丢失。

**代码证据**

```ts
// server/modules/assets/services/asset-gc.service.ts:157
for (const row of rows) {
  let text: string;
  try {
    text = await fs.readFile(row.jsonl_path, 'utf8');     // :160 无后缀分支
  } catch { continue; }
  for (const match of text.matchAll(assetPathPattern)) { ... }
}
```

```ts
// server/modules/providers/list/dsh/dsh-session-synchronizer.provider.ts:170
return sessionsDb.createSession(..., logPath, ...);        // jsonl_path = ...jsonl.zstd
```

DSH 已有现成解码器，但只在自己的读取路径里用：

```ts
// server/modules/providers/list/dsh/dsh-sessions.provider.ts:49
export function decodeSessionLogBuffer(buffer: Buffer, logPath: string): string {
  return path.basename(logPath).endsWith('.zstd')
    ? decodeZstdFrames(buffer)
    : buffer.toString('utf8');
}
```

附件路径进入 transcript 的机制（供未来接入时参考）：

```ts
// server/shared/image-attachments.ts:195
export function appendImagesInputTag(prompt, images) {
  // 生成 <images_input> 1. /abs/path/.cloudcli/assets/xxx.png
}
```

**触发条件（未来）**：DSH runtime 开始把 `images/files` 拼进 prompt 或作为 ACP content block 发送 → 附件路径写入 zstd transcript → 该会话超过 24h 后 sweep 扫不到引用 → 图片被回收 → 历史消息变成破图。

**当前影响**

- 无数据丢失。
- 每次 sweep（启动 + 每 6h）都会把所有 DSH 会话日志按 UTF-8 全量读一遍，读的是压缩字节，纯浪费 IO；大历史下这是启动后的第一波磁盘压力。

**现有防护为何失效**

- `decodeSessionLogBuffer` 是 DSH 模块私有语义，资产模块没有复用。
- `collectTranscriptReferences` 的注释只讨论"transcript 被删除"，没有讨论"transcript 是二进制"。

**修复建议**

三选一，按成本排序：

1. 跳过压缩日志（最小）：

```ts
if (row.jsonl_path.endsWith('.zstd')) {
  // DSH: 日志为 zstd，这里不解析；见 H1 的"未来接入"说明
  skippedCompressedLogs += 1;
  continue;
}
```

2. 复用解码器（推荐，顺带为未来接入做好准备）：把 `decodeSessionLogBuffer` 提到 `server/shared/`，资产模块按后缀解码。
3. 让资产模块只读"最近 N 天有更新的会话"，先控制 IO 再谈正确性。

**无论选哪个，都不要只写注释**（评审批注第 4 条）：跳过分支要留下可观测信号——启动与每轮 sweep 输出一行 `[assets] skipped N compressed transcript(s)`，或写进现有的 sweep 统计。这样"DSH 接入了附件、但没人回来改这里"会以日志/指标的形式暴露，而不是以"用户历史里的图片某天开始变破图"的形式暴露。

**与 H9 是同一个决策**：H1 是"读不到引用"，H9 是"除了 transcript 没有第二道保险"。两者的结论必须一起定——要么解码（两道都通），要么跳过 + 明确接受"DSH 附件不保历史"并让 GC 不去碰它（例如给 DSH 会话的附件打一个不回收标记）。不要出现"H1 跳过了、H9 又假设 transcript 有效"的组合。

**验证**

- 造一个 `.jsonl.zstd` 会话，内容含 `assets/<name>.png`，跑 `collectAbandonedAssets(now, 0)`，断言该文件未被删（修复后）／被删（修复前）。

**置信度**：高（对"当前不触发"的判断基于 `options.attachments` 的全仓消费点核对）。

---

## H2. `markAssetReferences` 与它的前端调用都是死代码

**结论**：资产模块注释声称"浏览器把仍在编辑的附件 descriptors 上报回来重新锚定 mtime"，路由 `/api/assets/mark` 和前端封装 `api.assets.markReferences` 都写好了，但**没有任何调用方**；前端也从未把草稿附件写进 localStorage。整套"重新锚定"安全网没有接线。

**代码证据**

```ts
// server/modules/assets/services/asset-gc.service.ts:93
/**
 * Marks uploaded assets the browser is still holding in an unsent composer as
 * referenced right now, by bumping their mtime.
 * The frontend calls this on page load with the descriptors mirrored in
 * `localStorage`, so a draft that survives a restart is not collected ...
 */
export async function markAssetReferences(descriptors: unknown[]): Promise<void> { ... }  // :101
```

```ts
// server/modules/assets/assets.routes.ts:199
router.post('/mark', async (req, res) => { ... await markAssetReferences(descriptors); ... });
```

```ts
// src/shared/api.ts:629
markReferences: (descriptors: unknown[]) => post('/api/assets/mark', { descriptors }),
```

全仓检索 `markReferences` 只有这一处定义；`src/modules/chat` 下没有任何 localStorage 写附件描述符的代码（`grep localStorage` 只命中模型/历史/语音偏好）。

**触发路径**

1. 用户在会话 A 选了两张图（已上传，未发送），切到会话 B 或直接放着。
2. 24h 后 sweep 运行：这些文件既不在 `session_drafts.queued_message`（没进队列），也不在 transcript（没发送）。
3. 文件被回收。用户回到会话 A 点发送 → 服务端 `filterAttachmentsToUploadStore` 丢弃并回 `attachment_missing`。

**影响**：低频但真实的"隔夜草稿丢附件"。用户看到的是"图片发送失败"，不会知道是被自己服务器的清理器删了。

**现有防护为何失效**

- 24h grace（`ASSET_GRACE_MS`）是唯一保护，且按 mtime 计，不随"用户还在编辑"延长。
- 注释描述的前端行为不存在，读代码的人会以为已经覆盖。

**修复建议**

- 要么接线：composer 在草稿里持久化 descriptors（仅文件名/路径，不含 File），挂载时调 `api.assets.markReferences(...)`，并在 `beforeunload`/定时器里续期。
- 要么删掉 `/mark` 路由、`markAssetReferences`、前端封装与这段注释，明确"未发送附件只保 24h"。**不要保留一个声称已生效但没人调用的安全机制**——它会让后续维护者做出错误假设。

**验证**

- 若选择删除：`grep -r "markReferences\|/api/assets/mark" src server` 应只剩 0 命中。
- 若选择接线：用一个 25h 前 mtime 的文件模拟草稿，触发 mark 后再 sweep，断言文件存活。

**置信度**：高。

---

## H3. 每次打开/切换 MCP 目录都会同步 spawn `dsh`，每个写入路径最多 5 次

**结论**：`readDshComposedMcpServers()` 内部是 `spawnSync('dsh', ['--profile','acp','--dump-config'], { timeout: 10_000 })`，没有任何缓存。MCP 目录的读接口会为**所有** provider 调一次 `listExternallyManagedNames()`（包括跟当前操作无关的 DSH），写入路径还会额外调用多次。daemon 是单线程，`spawnSync` 期间整个进程（所有 WebSocket、所有会话流）停摆。

**代码证据**

```ts
// server/modules/providers/list/dsh/dsh-cordis.provider.ts:291
export function readDshComposedDocument(): { ok: boolean; document: string } {
  const dump = spawnSync('dsh', ['--profile', DSH_ACP_PROFILE, '--dump-config'], {
    encoding: 'utf8',
    timeout: DUMP_TIMEOUT_MS,          // 10_000
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, DSH_HOME: getDshHome() },
  });
  ...
}
```

```ts
// server/modules/providers/services/mcp-catalog.service.ts:262
const readExternallyManagedNames = (): Map<LLMProvider, Set<string>> => {
  for (const provider of providers.listProviders()) {
    const supplied = provider.mcp.listExternallyManagedNames?.() ?? [];   // DSH 这里一次 dump
  }
};
```

调用点与次数（已逐个核对）：

| 操作 | dump 次数 | 位置 |
| --- | --- | --- |
| `GET` 目录列表 | 1 | `mcp-catalog.service.ts:431` |
| 新增条目（不投影） | 1 | `decorateEntry` 默认参数（`:283`，调用点 `:449`） |
| 编辑条目（投影 + 返回） | 2 | `projectEntry`（`:361`）+ 返回前 `decorateEntry`（`:459`） |
| 切换某个 harness 开关 | 1 | `decorateEntry`（`:535`）；`projectUpsert` 不再读外部名单 |
| 以上任意操作发生在 DSH 上 | 再 +3 | `upsertServer` 读一次（:685）+ `writePatchLayer` 的 baseline（:526）与 after（:541） |
| `resyncCatalogToProviders` | 每 provider 1 次 | `:556` |

注：`projectEntry` 用得到"外部托管名单"，是为了跳过 harness 自己挂载的名字；`projectUpsert` 不做这个判断，所以切换开关只在返回前读一次。单次操作最高是"编辑 DSH 条目"= 2 + 3 = 5 次。

**触发路径**：用户打开设置里的 MCP 矩阵 → 后端为每个 provider 调 `listExternallyManagedNames` → DSH 的实现 `spawnSync` → 在 `dsh` 已安装且配置较大的机器上，每次请求阻塞数百毫秒到数秒；若 `dsh` 卡住，最长 10s。期间任何正在流式输出的会话都会"卡住不动"。

**影响**

- 交互卡顿，且与用户当前操作的 provider 无关（用 Claude 的人也被 DSH 拖累）。
- 阻塞发生在事件循环，不是单个请求变慢——所有会话的 token 流一起停。
- 高频轮询（若前端有轮询）会叠加成持续卡顿。

**现有防护为何失效**

- 注释说"每次操作只读一次"（`:258-261`），确实做到了一次——但一次就等于一次 `spawnSync`，且对所有 provider 都做。
- 没有 TTL 缓存、没有异步化；`listExternallyManagedNames` 是同步签名，天然倾向 `spawnSync`。

**修复建议**

1. 最小：在 `readDshComposedDocument()` 外层加 2–5s 的 TTL 缓存（同一 tick 内的多次调用复用结果），足以把"一次写入 3 次 dump"压到 1 次。
2. 更好：把 `listExternallyManagedNames` 改成异步（`execFile` + promise），让 daemon 在等待期间继续服务；接口是 `?:` 可选的，改动局限在 DSH adapter 与目录服务。
3. 顺带：非 DSH 的目录请求不应触发 DSH 的 dump。可给 `listExternallyManagedNames` 加一个 `providers` 过滤参数，或让目录服务按"当前 tab 的 provider 集合"取。

**验证**

- 用 shell 包装 `dsh` 记录调用次数与耗时（`echo >> /tmp/dsh-calls`），打开一次 MCP 页面，数行数。
- 在 `dsh` 包装脚本里 `sleep 3`，同时开一个会话观察 token 流是否停顿。

**置信度**：高（调用点与次数已逐行核对；具体阻塞时长取决于本机 `dsh` 启动成本，需实测）。

---

## H4. 原子写把 patch 文件权限改成 0600，注释说"保留权限"

**结论**：`writeFileAtomicThroughLinks` 的文档写 "keeping its symlink and its permissions"，实现是把内容写进 `mode: 0o600` 的临时文件再 `rename`。目标文件原来是 0644 就会变成 0600。此外 `rename` 会替换 inode，原文件的 ACL、xattr（macOS quarantine 等）和属主一并丢失。

**代码证据**

```ts
// server/modules/providers/list/dsh/dsh-mcp.provider.ts:460
/** Atomically replaces `filePath`, keeping its symlink and its permissions. */
const writeFileAtomicThroughLinks = async (filePath: string, content: string): Promise<void> => {
  const target = await resolveWriteTarget(filePath);          // 跟随 symlink，这点是对的
  const temp = `${target}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(temp, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(temp, target);                               // 权限来自 temp
  } catch (error) { await rm(temp, { force: true }); throw error; }
};
```

**触发路径**：任何一次 MCP 写入（新增/编辑/删除），只要 `cordis.patch.yml` 存在且不是 0600。

**影响**

- 同机其他用户/其他 uid 的进程（例如以 root 跑的 daemon 与以普通用户跑的编辑器）会出现"文件存在但读不了"。
- dotfiles 仓库里的文件权限被悄悄改掉，`git` 看不出（git 只跟踪可执行位），`stow` 重链后又会变回去，形成来回漂移。
- 属主变化在 daemon 以 root 运行时更明显：用户自己的文件变成 root 所有，之后手动编辑需要 sudo。

**现有防护为何失效**

- 只 `lstat` 判断了是不是 symlink（`:455`），没有读取并复用 `stat.mode`。
- 注释与实际不一致，review 时容易被"已经处理了"误导。

**修复建议**

```ts
const stats = await lstat(target).catch(() => null);
const mode = stats?.isFile() ? stats.mode & 0o777 : 0o600;
await writeFile(temp, content, { encoding: 'utf8', mode, flag: 'wx' });
```

若还要保留属主/xattr，需 `chown`/`copyFile` 元数据，或改用"写临时文件 + `copyFile` 覆盖内容"而非 `rename`（会牺牲原子性）。对当前场景，恢复 mode 即可，属主问题建议在文档里注明"daemon 应与用户同 uid 运行"。

**验证**

- `chmod 644 cordis.patch.yml`，走一次 upsert，`stat -f '%Lp'` 应仍为 644。
- symlink 场景：`ln -s` 到 dotfiles，写入后 `readlink` 不变、目标文件 mode 不变。

**置信度**：高（行为确定）；影响面取决于部署方式，故列潜在。

---

## H5. 定时任务表单缺校验：清空间隔 → 每分钟一次；清空时间 → 抛裸错

**结论**：`canSubmit` 只校验名称、提示词、weekly 的星期，不校验 `onceAt` 与 `everyAmount`。清空数字输入后 `Number('') === 0`，`Math.max(1, 0)` 得到 1 分钟；清空 `datetime-local` 后 `new Date('').toISOString()` 抛 `RangeError: Invalid time value`，被 `catch` 捕获后把英文原始错误直接显示在表单里。

**代码证据**

```ts
// src/modules/scheduled-tasks/ScheduledTaskDialog.tsx:358
const canSubmit = form.name.trim() !== ''
  && form.prompt.trim() !== ''
  && (form.scheduleKind !== 'weekly' || form.weekdays.length > 0);   // 没有 onceAt / everyAmount
```

```ts
// :164
scheduleSpec: { at: new Date(form.onceAt).toISOString() },          // 空串 → Invalid Date → 抛
```

```ts
// :169-175
const amount = Number(form.everyAmount);                            // '' → 0
everyMinutes: Math.max(1, Math.round(amount * (form.everyUnit === 'hours' ? 60 : 1))),  // → 1
```

```ts
// :386-388
} catch (submitError) {
  setError(submitError instanceof Error ? submitError.message : String(submitError));
}
```

**触发路径**

1. 新建任务，选"间隔"，把数字框清空（或输入 `-5`，`min=1` 属性不阻止键入），保存 → 得到一个每 1 分钟运行的任务。
2. 选"一次"，清空时间框，保存 → 表单显示 `Invalid time value`，用户不知道要填什么。

**影响**

- 每分钟启动一个 agent CLI：CPU/额度被持续消耗，且这是用户自以为"填错了会被拦下"的操作。
- 一次任务被写成 1 分钟间隔后很难察觉（运行历史会被大量记录淹没）。
- `Invalid time value` 是未本地化的内部错误，属于最低质量的报错。

**修复建议**

```ts
const intervalAmount = Number(form.everyAmount);
const canSubmit = form.name.trim() !== ''
  && form.prompt.trim() !== ''
  && (form.scheduleKind !== 'weekly' || form.weekdays.length > 0)
  && (form.scheduleKind !== 'once' || Number.isFinite(Date.parse(form.onceAt)))
  && (form.scheduleKind !== 'interval'
      || (Number.isFinite(intervalAmount) && intervalAmount >= 1));
```

并在 `handleSubmit` 里对 `once` 加一个明确的本地化错误文案，而不是让 `toISOString()` 抛。

**验证**

- 组件测试：清空间隔 → 保存按钮 disabled；清空时间 → disabled 且不抛异常。
- 服务端也应有一道兜底（`everyMinutes >= 1`），但这是既有校验，不在本报告范围。

**置信度**：高。

---

## H6. 附件缩略图对象 URL 在 render 阶段创建，StrictMode 下预览空白

**结论**：`useMemo(() => URL.createObjectURL(file))` 在 render 阶段产生副作用；`useEffect` 只做 revoke。开发模式 `React.StrictMode`（`src/main.tsx:61`）会执行 mount → cleanup → mount，cleanup 把 URL 撤销，第二次 mount 的 effect 体为空，于是图片空白。并发的、被丢弃的 render 还会泄漏一个 URL。

**代码证据**

```tsx
// src/modules/chat/composer/ComposerAttachment.tsx:41
// Derived during render: the object URL outlives no render of this chip, so
// there is nothing to synchronize and nothing to paint before it exists.
const preview = useMemo(() => (isImage ? URL.createObjectURL(file) : undefined), [file, isImage]);
useEffect(() => () => {
  if (preview) URL.revokeObjectURL(preview);
}, [preview]);
```

**触发路径**：`npm run dev` → 选一张图 → 缩略图位置显示空白/裂纹图。生产构建不受影响（StrictMode 不双跑 effect），所以这条只在开发与测试环境可见。

**影响**

- 开发/演示时"附件功能看起来坏了"，浪费排查时间。
- render 阶段副作用违反 React 约定；将来开启并发特性后，被中断的 render 会真的泄漏。

**修复建议**：回到 effect 里创建：

```tsx
const [preview, setPreview] = useState<string>();
useEffect(() => {
  if (!isImage) { setPreview(undefined); return; }
  const url = URL.createObjectURL(file);
  setPreview(url);
  return () => URL.revokeObjectURL(url);
}, [file, isImage]);
```

**验证**：开发模式选图，缩略图正常；反复挂载/卸载后 `performance.memory` 或 `chrome://blob-internals` 不增长。

**置信度**：高（StrictMode 已确认启用）。

---

## H7. `setState` updater 里做副作用（release / 赋值给外部变量）

**结论**：`removeAttachment` 在 `setAttachedFiles` 的 updater 内调用 `attachmentUploads.release()`（进而触发另一个 `setState`）；拖拽处理在 updater 内给外部变量 `accepted` 赋值，再据此启动上传。两者都依赖"updater 会被同步求值"这一 React 实现细节。

**代码证据**

```ts
// src/modules/chat/hooks/useChatComposerState.ts:651
const removeAttachment = useCallback((index: number) => {
  setAttachedFiles((previous) => {
    const file = previous[index];
    if (!file) return previous;
    attachmentUploads.release([file]);          // ← updater 内的副作用（会 setUploadVersion）
    return previous.filter((_, i) => i !== index);
  });
}, [attachmentUploads]);
```

```ts
// :633
// Read the current list inside the updater: the drop handler is registered
// once, so a captured `attachedFiles` would be stale.
let accepted: File[] = [];
setAttachedFiles((previous) => {
  accepted = validFiles.slice(0, Math.max(0, MAX_ATTACHMENT_COUNT - previous.length));
  return accepted.length > 0 ? [...previous, ...accepted] : previous;
});
if (accepted.length > 0) {                       // ← 依赖 updater 已被同步执行
  attachmentUploads.track(...);
}
```

**触发条件**：fiber 上已有待处理更新时，React 不会 eager 求值 updater，`accepted` 保持 `[]`，该次拖拽的上传不会立即开始。StrictMode 下 updater 会被调用两次，`release` 也会执行两次。

**影响**

- 拖拽上传偶尔"要等一下才开始"——因为有兜底 effect（`:665-672` 会对没有 upload 的文件补 `track`），功能自愈，用户通常察觉不到。
- `release` 双跑会发两次删除请求（第二次幂等），不致命。
- 真正的问题是**可维护性**：这段代码的正确性依赖 React 内部行为，React 版本升级或重构时容易变成真实 bug。

**修复建议**

- `removeAttachment`：先在 updater 外读取 ref 或 `attachedFiles` 的 ref 镜像拿到目标文件，再 `setAttachedFiles`，副作用放在外面。
- 拖拽：用 `useRef` 保存当前附件列表（每次 render 同步），在 handler 里同步计算 `accepted`，再 `setAttachedFiles(prev => ...)`。

**验证**：在拖拽前先触发一次同组件的 setState（例如同时点击一个按钮），确认上传仍立即开始；StrictMode 下 `release` 只调一次。

**置信度**：中高（行为依赖 React 内部，已按源码语义推断；建议用测试固定）。

---

## H8. 启动时无条件把 `running` 的 run 标成 failed，多进程共享 DB 时会误杀

**结论**：`initializeScheduledTaskDispatcher` 无条件 `failInterruptedRuns()`，注释假设"启动时还 running 的都属于已消失的进程"。同一份 `auth.db` 被两个进程同时打开时（dev + 生产、两个 daemon、桌面端 + CLI），后启动的进程会把先启动进程**正在执行**的 run 标为 failed。

**代码证据**

```ts
// server/modules/database/repositories/scheduled-tasks.db.ts:325
/**
 * Closes runs a previous process left open.
 * ... Anything still running at startup belongs to a process that is gone.
 */
failInterruptedRuns(reason: string): number {
  return getConnection().prepare(
    `UPDATE scheduled_task_runs
     SET status = 'failed', error = ?, finished_at = CURRENT_TIMESTAMP
     WHERE status = 'running'`,          // 没有 owner / pid / 时间条件
  ).run(reason).changes;
}
```

```ts
// server/modules/scheduled-tasks/services/scheduled-task-dispatcher.service.ts:267
scheduledTasksDb.failInterruptedRuns('The server restarted before this run finished.');
```

同文件另一处注释明确考虑过多进程：

```ts
// scheduled-tasks.db.ts:204
// or two server processes sharing one database — from running one cycle
```

**触发路径与后果（按严重度排序）**

1. **重复执行（最重）**：进程 B 启动把 A 的 run 标 failed → `hasRunningRun` 与 `countRunningRuns` 都归零 → B 的下一轮 poll 可能为同一个 task 再起一次 → 同一个定时任务被并发执行两遍（发两封邮件、提两个 PR、扣两次费）。
2. **历史错乱**：A 之后正常结束时 `finishRun` 又把该行改成 `completed`，用户看到一条"失败后又完成"的记录。
3. **额度失真**：并发上限 `MAX_CONCURRENT_RUNS` 被短暂突破。

**现有防护为何失效**

- 表里没有 `pid` / `process_started_at` / owner token，无法区分"自己的"和"别人的"。
- `inFlightTaskIds` 是进程内内存，跨进程不可见。
- 注释把"多进程"这个前提直接排除掉了。

**修复建议（按成本）**

1. 最小止血：只清理"开始时间早于本次进程启动时间"的 run，仍需 `pid` 才能判断进程是否真的死了。
2. 推荐：`createRun` 写入 `owner_pid` + `owner_boot_id`（或随机 owner token），`failInterruptedRuns` 只处理 `owner_pid <> ?` 且 `started_at < now - 阈值` 的行。
3. 更稳：调度器启动时拿一个 DB 级 advisory lock（SQLite 可用 `BEGIN IMMEDIATE` + 一行 `dispatcher_owner` 表），只有持锁进程才 dispatch。

**部署前提需要确认**：如果产品保证"一台机器只有一个 daemon、且不与 dev 共用 `~/.cloudcli/auth.db`"，这条可以降为文档约束；否则应按 2 修。仓库 `AGENTS.md` 已经提醒过"用 DB 快照起临时实例"，说明共享 DB 是现实存在的操作。

**验证**

- 起两个实例指向同一 DB，实例 A 跑一个长任务（sleep 60 的 fake runtime），实例 B 启动，观察 A 的 run 是否被改成 failed、B 是否重复起同一 task。

**置信度**：高（代码行为确定）；是否构成风险取决于部署形态，因此列潜在。

---

## H9. 附件回收只保护"服务器端队列草稿"，不保护"已发送但只在 UI 里可见"的历史？

> 这条是第一版没有单列的补充观察。**不做独立决策**：判定清单 #4 把 H1 与 H9 作为一个问题问，修复时也必须一起定。

**结论**：`collectAbandonedAssets` 的引用来源只有两处：`session_drafts.queued_message` 和 provider transcript。前者覆盖"排队未发送"，后者覆盖"已发送"。对 Claude/Codex 等明文 JSONL，第二处有效；对 DSH 的 zstd 日志无效（见 H1）。因此**当前 DSH 会话里已发送消息若带附件，理论上没有任何引用保护**——但因为 DSH runtime 尚未消费附件（H1），实际暂时没有这种消息。

**与 H1 的关系**：H1 讲的是"读不到"，H9 讲的是"除了 transcript 没有第二道保险"。修复 H1 后两者一起消失；不修 H1 则应至少给 DSH 会话的附件加一个"不回收"标记（或把引用写进 DB），而不是依赖一个读不出来的 transcript。单独列出只是提醒审批者：**不要把它当成"未来某天再说"的问题，DSH 一旦支持附件当天就会命中。**

**置信度**：中（依赖 DSH 附件能力的演进方向）。

---

# 三、已推翻 / 降级的原判断（请审批者重点看）

第一版口头审查中有三条结论在逐行核对后需要修正。列出差异，避免审批基于错误前提。

## 1. `writeScopedServers` 会复制 harness 自带条目 —— **实际不可达，降级为死代码风险**

`DshMcpProvider` 覆写了 `upsertServer` 与 `removeServer`，而基类中调用 `writeScopedServers` 的**唯一两处**就在这两个方法里（`server/modules/providers/shared/mcp/mcp.provider.ts:150`、`:191`）。因此 DSH 的 `writeScopedServers`（`dsh-mcp.provider.ts:642`）当前没有任何调用路径。

- 真实风险只剩 `upsertServer` 的 `:705` 分支（S1）。
- `writeScopedServers` 仍建议加同样的 `ok` 门禁，否则将来基类新增调用点时会以更隐蔽的方式触发（它会用空映射清空整块）。

## 2. DSH 图片会被 24h 回收 —— **当前不触发，降级为潜在（H1）**

DSH runtime（`dsh-runtime.provider.ts`）不读取 `options.attachments/images/files`，全仓消费附件的只有 claude/codex/cursor/zcode/omp/pi/workbuddy（`grep "options.attachments\|options.images"`）。附件路径不会进入 DSH 的 prompt，也就不会进入它的 zstd 日志。H1 因此是"接入附件当天才会爆炸"的潜在缺陷，不是正在丢数据。

## 3. `toggle` 每次触发两次 `dsh --dump-config` —— **数字不准，实际 1–5 次**

修正后的计数见 H3 的表格：非 DSH 的开关操作只触发 1 次（`decorateEntry` 返回前），编辑 DSH 条目最高 5 次（2 次目录层 + 3 次写入层）。结论不变（无缓存、同步阻塞），但不要用"两次"来评估成本。

## 4. 仍然成立但需要补一句的：S2 的影响面比原判断大

原判断写成"DSH 运行时的失败路径"，核对后发现 Claude 同形（`claude-runtime.provider.ts:1787-1790`），所以**所有 provider 都受影响**。此外还有两个不在 `scheduled_tasks` 里的消费方（评审批注补充，已核实）：定时消息（状态停在 `sent`）与排队消息（草稿被静默删除）。修 S2 时如果只改 `scheduled-task-dispatcher`，这两条仍然是坏的。

---

# 四、修复顺序建议

| 顺序 | 条目 | 理由 |
| --- | --- | --- |
| 1 | S1 | 唯一会静默破坏用户已有配置的路径，必须合入前修 |
| 2 | S2 | 影响所有 provider 与三条调度链路；改动可控（runtime throw + 排队路径恢复草稿），但需确认交互式日志与 `agentRoutes` 行为变化可接受 |
| 3 | H5 | 用户可感知、可复现、修复成本最低 |
| 4 | H3 | 性能问题，先用 TTL 缓存止血，异步化可作为后续 |
| 5 | H4 / H6 / H7 | 质量与开发体验，可在同一波清理 |
| 6 | H2 / H8 / H9 | 需要产品决策（是否接线、是否支持多进程、DSH 是否接入附件） |

不建议把 H1/H2 的"删除死代码"与 S1 的"加门禁"放在同一个 commit：前者是行为删除，后者是行为收紧，混在一起会让回归定位变难。

---

# 五、给审批 AI 的判定清单

请逐条回答，用来决定是否放行：

1. **S1 门禁**：是否同意"dump 失败时拒绝写入"优于"盲写"？如果产品要求 dump 不可用时仍可编辑，是否接受另写一个"只改单条、不重建整块"的写入器？
2. **S1 TOCTOU 与不变量**：是否接受"把门禁读到的 `composed` 透传给写入层"（少一次 dump，且消除中间态）？是否接受"本次映射必须包含 baseline 全部托管键"这条硬断言（删除操作例外）？
3. **S1 补救**：现有单槽 `.bak` 只能撑一次写入，是否要做时间戳多备份 + 恢复入口？如果只做"删除超过 1 条时通知用户"，能否接受？
4. **S1 附带**：`<redacted>` 被写成字面量的路径依赖旧的 provider 级表单（`McpServers` 组件仍挂在 AgentCategoryContentSection）。是否确认这条路径仍在产品范围内？
5. **S2 判定**：是否接受"运行时在发完 `complete` 后继续抛异常"？请按三个入口确认（`dispatchRun`、`agentRoutes`、`gitRoutes`），不只 `dispatchRun`。
6. **S2 消费方**：定时消息（`scheduled-message-dispatcher.service.ts:103`）与排队消息（`:41`）是否一起纳入本次修复？排队消息需要额外改"失败时恢复草稿"——方案 A 单独不会修好它。
7. **H1 + H9（合并决策）**：DSH 近期是否会接入附件？若不接入，选择"跳过 `.zstd` + 可观测计数"还是"复用解码器"？无论选哪个，请确认 H9 的"第二道保险"是否要做（不修 H1 时必须做）。
8. **H2**：`/mark` 这套安全网是"待接线"还是"应删除"？两者都合理，但不能保持现状（注释与实现不符）。
9. **H3**：能否接受给 `readDshComposedMcpServers` 加 TTL 缓存？异步化会改 `listExternallyManagedNames` 的签名（可选方法），是否愿意扩大改动面？
10. **H4**：`cordis.patch.yml` 的权限从 0644 变 0600 是否可接受？如果 daemon 以 root 运行，属主变化是否需要单独处理？
11. **H8**：产品是否存在"两个进程共享同一 `auth.db`"的部署形态？如果不存在，是否接受在文档中写成明确约束而不改代码？

判定用结论请按 `S1: 同意/反对/需补充` 的格式返回，并指出任何你认为**证据不足**的条目（我会补测试或补代码路径）。

---

# 附录：关键文件与行号索引

| 文件 | 相关行 | 用途 |
| --- | --- | --- |
| `server/modules/providers/list/dsh/dsh-cordis.provider.ts` | 27, 291-305, 405-412 | dump 超时、`spawnSync`、`ok:false` 返回 |
| `server/modules/providers/list/dsh/dsh-mcp.provider.ts` | 231-255, 455-471, 507-547, 642-663, 673-729, 731-768, 812-826 | 托管块重建、原子写、校验跳过、upsert/remove、密钥还原 |
| `server/modules/providers/services/mcp-catalog.service.ts` | 262-270, 283, 361, 431, 525-538, 556 | dump 调用点与次数 |
| `server/modules/assets/services/asset-gc.service.ts` | 101-114, 117-139, 142-173, 215-240 | 引用收集与回收 |
| `server/modules/assets/assets.routes.ts` | 183, 199, 211 | release/mark/collect 路由 |
| `src/shared/api.ts` | 629 | `markReferences` 封装（无调用方） |
| `server/modules/websocket/services/chat-websocket.service.ts` | 314-328 | `dispatchRun` 的失败语义 |
| `server/modules/websocket/services/chat-run-registry.service.ts` | 26-36, 43, 120-127, 324-330 | run 记录（无 exitCode）、驱逐、幂等 complete |
| `server/modules/providers/list/dsh/dsh-runtime.provider.ts` | 688-699, 733-779 | 失败被吞的两处 |
| `server/modules/providers/list/claude/claude-runtime.provider.ts` | 1787-1790 | 同形失败处理 |
| `server/modules/scheduled-tasks/services/scheduled-task-dispatcher.service.ts` | 106-115, 267 | `completed` 误记、启动清理 |
| `server/modules/scheduled-messages/services/scheduled-message-dispatcher.service.ts` | 41-53, 103-107 | 排队消息静默丢弃、定时消息停在 `sent` |
| `server/modules/database/repositories/scheduled-messages.db.ts` | 79-99, 102-109 | `claimDue` 先写 `sent`、`markFailed` |
| `server/modules/database/repositories/session-drafts.db.ts` | 149-158, 167-182 | `claimQueuedMessage` 置空、唯一恢复分支 |
| `server/modules/providers/services/provider-runtime.service.ts` | 72-95 | `run` 的另一个入口（`getRunner`） |
| `server/modules/agent/agent.routes.ts` | 1130-1250, 1467 | 直接调 runner 与最外层 catch |
| `server/modules/git/git.routes.ts` | 1186-1214 | 直接调 runner，catch 回退默认提交信息 |
| `server/modules/database/repositories/scheduled-tasks.db.ts` | 204, 310-323, 325-341 | 并发计数、无条件 fail |
| `src/modules/scheduled-tasks/ScheduledTaskDialog.tsx` | 164, 169-175, 358-360, 386-388 | 表单校验缺口 |
| `src/modules/chat/composer/ComposerAttachment.tsx` | 41-48 | render 期对象 URL |
| `src/modules/chat/hooks/useChatComposerState.ts` | 633-644, 651-660, 665-672 | updater 内副作用与兜底 |
| `src/main.tsx` | 61 | StrictMode |

# 附录：快速复核命令

```bash
# S1：确认 dump 失败会被当成"没有托管条目"
grep -n "ok: false" server/modules/providers/list/dsh/dsh-cordis.provider.ts
grep -n "composed.managed" server/modules/providers/list/dsh/dsh-mcp.provider.ts

# S2：确认失败只发事件不抛出
grep -n "notifyRunFailed" server/modules/providers/list/dsh/dsh-runtime.provider.ts \
  server/modules/providers/list/claude/claude-runtime.provider.ts
grep -n "catch (error)" -A 12 server/modules/websocket/services/chat-websocket.service.ts | tail -20

# S2：确认三个下游都只看 result.error
grep -n "result.started || result.error\|result.error ===" \
  server/modules/scheduled-tasks/services/scheduled-task-dispatcher.service.ts \
  server/modules/scheduled-messages/services/scheduled-message-dispatcher.service.ts
grep -n "claimDue\|status = 'sent'" server/modules/database/repositories/scheduled-messages.db.ts
grep -n "claimQueuedMessage\|queued_message = NULL" server/modules/database/repositories/session-drafts.db.ts

# H1：确认 zstd 日志与 utf8 读取
grep -n "jsonl.zstd\|zstd" server/modules/providers/list/dsh/dsh-session-path.ts
grep -n "readFile(row.jsonl_path" server/modules/assets/services/asset-gc.service.ts

# H2：确认没有调用方
grep -rn "markReferences" src server | grep -v "api.ts" | grep -v "asset-gc.service.ts"

# H3：统计一次页面打开触发几次 dump
grep -n "readExternallyManagedNames()" server/modules/providers/services/mcp-catalog.service.ts

# H8：确认清理没有 owner 条件
grep -n "WHERE status = 'running'" server/modules/database/repositories/scheduled-tasks.db.ts
```

---

## 审阅批注

### WorkBuddy

> [!IMPORTANT] S2 的影响面还漏了一处。`server/modules/scheduled-messages/services/scheduled-message-dispatcher.service.ts:41` 与 `:103` 用同一个 `result.error` 判成败（`if (!result.started || result.error) recordFailure(...)`）。所以"失败被记成成功"不只影响定时任务的运行历史，**定时消息也会被记成"已发送"**——后者更难被发现：用户等一条永远不会来的回复，历史里却是成功。修复方案 A 改的是 runtime，两处会自动受益，但报告的影响面和判定清单 #3 应把这两个消费方补上，否则审批者会以为范围只在 `scheduled_tasks`。

> [!NOTE] S2 里"`dispatchRun` 是唯一调用点"这句不准确：`server/modules/providers/services/provider-runtime.service.ts:79` 也直接调 `provider.runtime.run(...)`。这不影响方案 A 的安全性（抛出的异常落在 `dispatchRun` 的 try 内被捕获，不会外泄到 WS handler），但"确认没有别的调用方依赖 `run` 不抛异常"这个前提应按这个入口再核一遍，而不是只看 `dispatchRun`。

> [!WARNING] S1 的 409 门禁存在 TOCTOU：门禁读一次 `readDshComposedMcpServers()`，`writePatchLayer` 内部 `:526`（baseline）与 `:541`（after）又各自读一次，三次 dump 之间状态可能变化。最坏的组合正是"第一次成功、第二次失败"——门禁放行，写入层又拿到空 baseline 从而跳过校验。建议把门禁那次 `composed` 透传给 `writePatchLayer` 复用，或在写入层断言"本次传入的映射必须包含 baseline 的全部 managed 键"，而不是新增一次独立读取。

> [!TIP] H1 与 H9 是同一根因的两个切面，判定清单 #4 也只问了一次，建议合并成一条，避免审批者把"跳过 zstd"和"给附件加第二道保险"当成两个独立决策。另外修复建议 1（跳过 `.zstd`）只解决 IO 浪费，不解决未来的引用缺失：DSH 接入附件时若没人回来改，静默删图会以"这里已经处理过"的形式复发。建议在跳过分支留一个可观测信号（日志或计数），不要只写注释。

> [!NOTE] S1 的修复建议只给了"拒绝写入"，没有给"已经发生过一次清空"的补救路径。文中自己写了 `.bak` 只保留最后一次写入前的内容、且不是恢复入口——这句话等于承认事故后没有可操作的出路。建议把备份策略一并写进建议（至少"每次写入前保留一份，恢复时取最近一份未损坏的"），否则修复上线后已经踩过的用户仍只能手写 YAML。

### 对批注的回应（2026-11-06，已按批注改稿）

| 批注 | 处理 | 核对后的事实与改动位置 |
| --- | --- | --- |
| S2 漏了定时消息 | 采纳 | 已核实：`claimDue` 在发送**前**就把状态写成 `sent`（`scheduled-messages.db.ts:79-99`），只有 `recordFailure` 会翻成 `failed`，所以 `result.error` 为空时状态永久停在 `sent`。已补进 S2 的证据、影响表与清单 #6。 |
| 同上，`:41` 也用 `result.error` | 部分修正 | `:41` 处并不判 `result.error`：它只特判 `'A run was already in progress…'`，其余任何失败都继续执行 `deleteEmptyDraft`。而 `claimQueuedMessage` 已把 `queued_message` 置空，所以排队内容是被**静默丢弃**，连 failed 记录都没有。这比"记成已发送"更隐蔽。已按实际机制改写，并注明方案 A 单独修不好它（需要额外恢复草稿）。 |
| "dispatchRun 是唯一调用点"不准确 | 采纳 | 已改为三个入口：`dispatchRun`、`getRunner` 注入的 `agentRoutes`（外层 catch 在 `agent.routes.ts:1467`）与 `gitRoutes`（`git.routes.ts:1188` 在 try 内，catch 回退默认提交信息）。并补了一条附带影响：`agent.routes.ts` 目前在失败后仍会继续建分支/PR（只看 `aborted`），方案 A 会让它提前进 catch。 |
| S1 门禁 TOCTOU | 采纳 | 已改为"门禁 + 把 `composed` 透传给 `writePatchLayer`（不再内部重复 dump）+ 结构性不变量（本次映射必须包含 baseline 全部托管键）"。并补了"第一次成功、第二次失败"的单测。 |
| H1/H9 应合并判定 | 采纳 | 清单 #4 → #7，问题改成"H1+H9 合并决策"；H1 的跳过分支要求输出 `skipped N compressed transcript(s)` 计数。 |
| S1 缺补救路径 | 采纳 | 已补"事故补救"小节：单槽 `.bak` 的窗口只够一次写入 → 改时间戳多槽（保留 3–5 份）+ 恢复入口；最低限度在"一次写入删除超过 1 个托管键"时通知用户并指出 `.bak` 路径。 |

未采纳的部分：无。批注里的三条事实性补充（定时消息、调用入口、TOCTOU）都成立，其中"`:41` 与 `:103` 同一判据"这一句按实际代码做了修正。


---

# 六、第一轮修复记录（2026-11-06 上午）

已按"修复顺序建议"落地 S1、S2、H3、H4、H5、H6、H7。H1+H9、H2、H8 与备份多槽当时未动，当天下午的第二轮补上了 H9、H2、备份多槽，逐条见第七节。

| 条目 | 状态 | 改动 |
| --- | --- | --- |
| S1 | 已修 | `upsertServer` / `removeServer` / `writeScopedServers` 先过 `requireDshComposedMcpServers()`：dump 失败抛 `DSH_MCP_UNREADABLE`（409），不写文件。门禁读到的 `composed` 透传给 `writePatchLayer`，写入层不再各自 dump（消除批注指出的 TOCTOU）。新增 `assertManagedKeysPreserved`：托管块重建时少任何未指定删除的键即抛 `DSH_MCP_ENTRIES_DROPPED`（500）。备份、校验、回滚未改。 |
| S2 | 已修 | 采用方案 B：`ChatRun` 记录终态 `exitCode` 与最后一条 `error` 文本（`chat-run-registry.service.ts`），`dispatchRun` 在 `runtime.run` resolve 后据此返回 `error`。无需改 8 个 runtime，`agentRoutes` / `gitRoutes` 行为不变。排队消息失败后 `restoreQueuedMessage`，不再静默删草稿。 |
| H3 | 已修 | `readDshComposedDocument` 加 3s TTL 缓存（按 `DSH_HOME` 分键），写入成功后 `invalidateDshComposedDocument()` 失效，保证写入后校验读到新文件。 |
| H4 | 已修 | 原子写保留目标文件权限位（`stat().mode & 0o7777`，写完 `chmod` 到临时文件再 rename）。另加凭据收紧：整份文件出现 `headers:` / `authorization:` 时，权限取 `原权限 & 0o600`（只收紧不放松，回滚同样按被写回的内容计算，所以回滚到无凭据版本会恢复原权限）。属主与 xattr 未处理（见判定清单 #10）。 |
| H5 | 已修 | `canSubmit` 校验 interval ≥ 1、once 为非空且可解析的日期。 |
| H6 | 已修 | 对象 URL 回到 `useEffect` 内创建 + cleanup 撤销，StrictMode 下会重建。 |
| H7 | 已修 | 新增 `attachedFilesRef`；drop 与 remove 先在事件处理器里算好结果并做副作用，再 `setAttachedFiles`。 |
| H1+H9 | 部分已修 | H9 已做（见第七节）：附件走 ACP image block / resource_link。H1 未做：`asset-gc.service.ts` 仍按 UTF-8 读 transcript，读不到 `.zstd`，DSH 会话引用的附件 24 小时后仍会被回收。 |
| H2 | 已删 | `/mark` 整条链路删除，理由见第七节。 |
| H8 | 不修 | 自用单进程，改为文档约束（见第七节）。 |
| S1 补救（备份多槽） | 已修 | 单槽 `.cloudcli.bak` 改为带毫秒时间戳的多份，保留最近 5 份（见第七节）。 |

新增测试：

- `dsh-mcp.test.ts`：dump 失败时 upsert/remove 均抛 `DSH_MCP_UNREADABLE` 且文件字节不变；写入保留 0644。
- `scheduled-tasks.test.ts`：runtime 发 `error` + `complete(1)` 后正常返回，run 记为 `failed` 且错误文本来自运行时。
- `scheduled-messages.test.ts`：同类失败下排队消息被放回队列（含附件描述符），不再消失。
- `dsh-mcp.test.ts`：0644 文件写入含 `headers.Authorization` 的内容后变 0600；0644 无凭据保持 0644（已有）；0400 有凭据仍为 0400（cap 只收紧不放松）。

# 七、第二轮修复记录（2026-11-06 下午）

## 7.1 DSH 接附件（H9）

先说结论：模型不是瓶颈，卡点在**声明**。

`dsh-acp` 的图片能力判定是 `supportsAcpImagePrompts()` → `llm.resolveModelInfo(provider, model).inputModalities?.includes('image')`，而 `inputModalities` 来自模型条目里的 `input` 字段，`dsh-llm-pi-ai` 的默认值是 `DEFAULT_INPUT = ['text']`。profile 里所有模型都只写了 `- id: xxx`，所以换哪个模型都是 text-only。

实测（96×96 左蓝右绿，问左右两色）：

| 配置 | `promptCapabilities.image` |
| --- | --- |
| 原样（volcano-ark / glm-5.3-flash） | false |
| 只换模型为 deepseek-v4.1-flash | false |
| 保留原模型 + 模型条目加 `input: [text, image]` | true |

绕过 dsh 直接打方舟接口，两个模型都能正确识图（"左蓝，右绿"），所以不存在"模型不支持"的问题。

**配置**：`~/dotfiles/dsh/.dsh/profiles/acp/cordis.patch.yml` 给 `glm-5.3-flash` 加一行 `input: [text, image]`。

**代码**（三段）：

1. `acp.client.ts` — `prompt()` 收 `string | AcpPromptBlock[]`，新增 `AcpPromptBlock` 联合类型（`text` / `image` / `resource_link`）。字符串调用保持原行为。
2. `dsh-prompt.ts`（新增）— `buildDshPromptBlocks()`：按 `isAllowedImageSourcePath` + `realpath` 的同一套信任边界读图，转成 ACP image block；只内联 dsh 能解码的 4 种媒体类型（png/jpeg/webp/gif），其余（含 SVG）走 `resource_link`；路径逃逸、读不到、realpath 跨出允许根的一律丢弃并 warn，不失败整轮。
3. `dsh-runtime.provider.ts` — 用 blocks 发 prompt。DSH 在 initialize 时按**默认模型**宣告能力，却在**每一轮**按会话当前模型复核，所以切到纯文本模型时会被拒（`model "x" does not declare image input`）。`isAcpImageRejection()` 识别这类错误后，用 `inlineImages: false` 重发一次（路径引用），避免整轮失败。重试安全：admission 在消息入队前，拒绝后会话状态不变。

**端到端实测**（隔离 DSH_HOME，跑的是上面这套真实代码 + 真实 `dsh --profile acp`）：

```
promptCapabilities: {"image":true,...}
[1] image attachment   blocks: text,image           → "左蓝，右绿"
[2] non-image (txt)    blocks: text,resource_link   → "ORANGUTAN"（模型按路径读到内容）
[3] image + deepseek   rejected: model "deepseek-v4.1-flash" does not declare image input
    isAcpImageRejection=true → 降级重发 → 仍作答
```

## 7.2 `/mark` 删除（H2）

`POST /api/assets/mark` + `markAssetReferences()` + 前端 `api.assets.markReferences` 全删，`asset-gc.service.ts` 顶部那段"浏览器把描述符存 localStorage 再上报"的注释一并改成正事实（未发送的附件只靠 24 小时宽限期保护，刷新即失去保护）。

理由：它保护的场景不存在——composer 无 localStorage 镜像，`session_drafts` 只存 `text` + `queuedMessage`，未发送的附件不落库；前端 0 处调用。留着反而让人以为草稿附件有保护。

## 7.3 MCP 备份多槽

`dsh-mcp.provider.ts`：`cordis.patch.yml.cloudcli.bak` 单槽改为 `cordis.patch.yml.cloudcli-<ISO 毫秒>.bak`，保留最近 5 份。毫秒是必需的——同一秒内连写两次会互相覆盖（测试用连写 7 次验证恰好剩 5 份，且最新一份是被替换掉的那版内容）。

为什么只有 dsh 需要：其他 harness 写的是 CloudCLI 自己生成的整份 JSON，写坏了重生成即可；`cordis.patch.yml` 是用户手写、带注释、被 stow 软链到 dotfiles 的文件，CloudCLI 只是往里插托管块。

## 7.4 `writeJsonConfig` 改原子写

`server/shared/utils.ts`：先写同目录临时文件（`wx` + 独占），再 `rename` 覆盖。覆盖一次修好 claude / cursor / pi / workbuddy 四条路径。

两个细节：

- **保留权限位**：rename 换 inode，临时文件必须显式带上目标原权限，否则 `~/.claude.json`（0600）之外的文件会被进程默认值收窄。
- **写穿软链**：目标是软链时写 realpath 再 rename，否则会把 stow 管理的软链替换成普通文件。

新增 4 条测试：父目录自动创建 + 尾随换行、保留 0644、写穿软链且链接仍在、不留临时文件。用 `~/.claude.json` 副本实测：内容逐字节一致（唯一差异是原本缺失的尾随换行，属既有行为），权限 0644 保留。

## 7.5 其余清理

| 项 | 改动 |
| --- | --- |
| ⌘K 提示 | `SidebarHeader.tsx` 搜索框空态右侧显示 `⌘K` / `Ctrl+K`，有输入时让位给清除按钮；`title` 复用 `tooltips.openCommandPalette` |
| 折叠 runs | `useTaskRuns.ts` 去掉 `refresh` 的 `isExpanded` 守卫（方案 A），轮询条件只看 `running`；折叠卡片的"运行中"圆点现在会亮。`isExpanded` 参数随之从 hook 签名删除 |
| 换行事故 | `scheduled-tasks.service.ts` 的 `function readText(...): string {  const text = ...` 拆回两行 |
| `anchorFor` | `dsh-sessions.provider.ts` 改手写二分（`firstTurnEndAtOrAfter`），去掉每条消息 `[...turnEnds].reverse()` 的数组拷贝，O(n²) → O(log n) |
| 目录文案 | `settings.json` 的 `scheduledTasks.projectPathHint` 从"留空=用户主目录"改为 `~/.cloudcli/scheduled-tasks`（只有 en / zh-CN 有这个键，其余语种走 en 回退） |
| i18n 死键 | 删除 15 个语种 `sidebar.json` 的整个 `navigation` 对象（chat/files/git/terminal/tasks，代码 0 引用）。`tooltips.scheduledTasks` 仍是活键，未动 |
| 仓库卫生 | `.gitignore` 加 `__pycache__/` + `*.pyc`；删除 `.agents/skills/session-cleanup/scripts/__pycache__/` 和 `pentest_1921685_4/` |
| 主题基线 | `themeHardcodedAtoms` 把 H6 引入的 `text-white` 加进豁免列表（压在自绘红色错误蒙层上，跟随主题变色会看不见），写明理由 |

## 7.6 第三轮：H1 与 deepseek 图片能力

**H1（`asset-gc` 读 `.zstd`）已修。**

`collectTranscriptReferences()` 原来用 `fs.readFile(path, 'utf8')` 读 transcript，DSH 的 `session.v4.jsonl.zstd` 是 zstd 帧流，UTF-8 解出来是二进制乱码，正则一条也匹配不到 —— DSH 会话引用的附件在 24 小时后照删。

改动：

- 新增 `server/shared/session-log.ts`，把 `decodeZstdFrames` / `decodeSessionLogBuffer` 从 `dsh-sessions.provider.ts` 上移；provider 侧改为 re-export，现有调用方不用动。
- `asset-gc.service.ts` 改为先读 Buffer 再按后缀解码。
- 新增 `server/modules/assets/tests/asset-gc.transcripts.test.ts`：在临时 HOME（GC 的资产目录取自 `os.homedir()`）里放两个已过期文件，一个被 zstd transcript 引用、一个没有，断言只删没被引用的那个。把 GC 改回 UTF-8 读取时该测试失败，验证过它确实能抓到这个回归。

**deepseek 的图片能力是声明问题，不是模型问题。**

用户在自己的会话（workbuddy / `deepseek-v4.1-flash`）里发图，模型正确读出「SDGV-ESQ5、两个点、左蓝右红」，证明模型有 vision。DSH 侧判定的是 `inputModalities.includes('image')`，而 `cordis.patch.yml` 里两个 provider 的 `deepseek-v4.1-flash` 条目都没有声明 `input`。

已给 `workbuddy` 和 `volcano-ark` 两处 `deepseek-v4.1-flash` 加 `input: [text, image]`，实测（真实 `dsh --profile acp`，隔离 DSH_HOME）：

```
workbuddy/deepseek-v4.1-flash    blocks: text,image → stopReason=end_turn → "左蓝，右绿"
volcano-ark/deepseek-v4.1-flash  blocks: text,image → stopReason=end_turn → "左蓝，右绿"
```

不再触发路径引用的降级重试。`wuanai` 的 `deepseek-v4.1-flash` 未验证，保持未声明。

## 7.7 仍未处理

| 项 | 原因 |
| --- | --- |
| H8（多进程误杀 run） | 定位于自用单进程，不写代码；约束是"同一个 auth.db 只能跑一个 daemon" |
| assets 权限面 | `/release`、`/collect` 任何登录用户可调、不校验归属。单用户自用不加；要多租户时把 `Set<文件名>` 换成 `Map<文件名, {kind,id}>` 即可 |
| codex 丢注释 | `~/.codex/config.toml` 整份 `TOML.stringify` 重写会吃掉所有注释，与 `writeJsonConfig` 无关，需单独拆 |
| 提交 | 全部改动仍未提交 |
