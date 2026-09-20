#!/usr/bin/env node
/**
 * OpenCode 格式兼容性检查器
 *
 * CloudCLI 只读 OpenCode 的两处输出：
 *   1. 历史 —— `~/.local/share/opencode/opencode.db`（SQLite：session / message / part / project）
 *   2. 实时 —— `opencode run --format json` 的 stdout 事件信封
 *
 * 本脚本对照 `opencode-sessions.provider.ts`（normalizeMessage / normalizeHistoryRows /
 * token 汇总）、`opencode-session-synchronizer.provider.ts`（索引 / 首条用户文本）、
 * `opencode-runtime.provider.js`（信封词汇表）、`opencode-models.provider.ts`（目录与
 * session.model 解析）的读取基线，找出可能因 OpenCode 升级而变化的结构。
 *
 * 两路取证：
 *   - 数据面：真实 opencode.db 的表/列、part 类型、role、session 行。
 *   - 契约面：从本机 opencode 二进制离线提取「part 类型 union」与「run 信封类型」，
 *     即使某类型还没出现在本地 DB 里也能发现漂移（1.18.31 的 union 有 10 个 part 类型，
 *     真实 DB 里只出现了 5 个）。
 *
 * 用法：
 *   node check-opencode-format.mjs                    # 最新会话
 *   node check-opencode-format.mjs <sessionId>         # 指定会话
 *   node check-opencode-format.mjs --all              # 最近 5 个会话
 *   node check-opencode-format.mjs /path/to/opencode.db
 *   node check-opencode-format.mjs --no-binary        # 跳过二进制契约提取
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

/**
 * CloudCLI 的 `getOpenCodeDatabasePath()` 是硬编码的，无 env 覆盖；这里加一个只属于
 * 检查器的覆盖口，便于对 fixture / 其他安装位置取证。
 */
function databasePath() {
  return process.env.OPENCODE_DB_PATH?.trim()
    || path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
}

/**
 * CloudCLI 实际查询的列。分两类：
 *   required —— 缺了会让 SQL 直接抛错（这些是升级信号）。
 *   optional —— 代码用 PRAGMA 探测后走回退分支（缺了只是能力降级，不是断裂）。
 */
const READ_COLUMNS = {
  session: {
    required: [
      'id', 'project_id', 'parent_id', 'directory', 'title', 'model', 'agent',
      'version', 'time_created', 'time_updated', 'time_archived',
    ],
    optional: ['tokens_input', 'tokens_output', 'tokens_reasoning', 'tokens_cache_read', 'tokens_cache_write'],
  },
  message: { required: ['id', 'session_id', 'time_created', 'data'], optional: [] },
  part: { required: ['id', 'message_id', 'session_id', 'time_created', 'data'], optional: [] },
  project: { required: ['id', 'worktree'], optional: [] },
};

/**
 * `part.data.type` 全集 —— 1.18.31 二进制里 `switch(D.type)` 的 case 列表（见
 * extractBinaryContract）。rendered 表示 normalizeHistoryRows 会产出消息；
 * 不在此表里的类型就是 🆕 升级信号（normalizeHistoryRows 是白名单 if 链，未知类型静默跳过）。
 */
const KNOWN_PART_TYPES = new Map([
  ['text', { rendered: true, note: 'user/assistant 文本（<images_input>/<files_input> 标签还原附件）' }],
  ['reasoning', { rendered: true, note: 'thinking' }],
  ['tool', { rendered: true, note: 'tool_use + 结果（state.status completed/error 时挂 output/error）' }],
  ['step-finish', { rendered: true, note: 'stream_end' }],
  ['patch', { rendered: true, note: 'Patch 工具卡片' }],
  ['agent', { rendered: true, note: 'Agent 工具卡片' }],
  ['step-start', { rendered: false, note: 'step 生命周期（含快照跟踪），无 UI 行' }],
  ['snapshot', { rendered: false, note: '快照元数据' }],
  ['file', { rendered: false, note: '文件元数据' }],
  ['subtask', { rendered: false, note: '子任务 prompt/description/command 元数据' }],
]);

/**
 * `opencode run --format json` 的信封 type —— 二进制里 `Z("<type>", {part})` 的调用集合。
 * 信封形如 `{ type, timestamp, sessionID, part }`，正文在 `part` 里。
 */
const KNOWN_ENVELOPE_TYPES = new Map([
  ['text', { rendered: true, note: 'stream_delta（读 part.text/part.delta/part.message）' }],
  ['reasoning', { rendered: true, note: 'thinking（同上；CLI 仅在带 --thinking 时发出）' }],
  ['tool_use', { rendered: true, note: 'tool_use（读 part.tool/callID/part.state.input/output）' }],
  ['step_finish', { rendered: true, note: 'stream_end' }],
  ['error', { rendered: true, note: 'error（读顶层 error，不带 part）' }],
  ['step_start', { rendered: false, note: 'normalizeMessage 无分支，静默跳过' }],
]);

/**
 * message.data.role —— normalizeHistoryRows / readFirstUserText 只区分 user 与其他。
 */
const KNOWN_MESSAGE_ROLES = new Set(['user', 'assistant']);

/** 已登记类型 → 报告标签；未登记 → 需评估。 */
function knownTag(registry, type) {
  const known = registry.get(type);
  if (!known) return '需评估';
  return known.rendered ? `会渲染（${known.note}）` : `已知不渲染（${known.note}）`;
}

// ---------------------------------------------------------------------------
// 二进制契约提取（离线，权威源就是这份安装）
// ---------------------------------------------------------------------------

const PART_SWITCH_ANCHOR = 'case"step-start"';
const PART_CASE_PATTERN = /case"([a-z][a-z0-9-]{1,24})":/g;
const PART_SANITY = ['text', 'tool', 'step-start', 'step-finish'];

const ENVELOPE_ANCHOR = '{type:N,timestamp:Date.now(),sessionID:W,..._}';
const ENVELOPE_CALL_PATTERN = /Z\("([a-z][a-z0-9_]{1,24})",\{/g;
const ENVELOPE_SANITY = ['text', 'step_finish', 'step_start', 'tool_use'];

function resolveOpenCodeBinary() {
  const explicit = process.env.OPENCODE_BIN?.trim();
  if (explicit) {
    return fs.existsSync(explicit) ? explicit : null;
  }

  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, 'opencode');
    try {
      // npm 装的是软链（bin/opencode -> ../lib/node_modules/opencode-ai/bin/opencode.exe）
      if (fs.existsSync(candidate)) return fs.realpathSync(candidate);
    } catch {
      // 不可解析的 PATH 条目直接跳过。
    }
  }

  return null;
}

/**
 * 在 anchor 周围逐级放大窗口，取「第一个通过健全性检查」的 case/call 并集。
 * 放大是为了扛上游重排；健全性检查是为了避免窗口里混进无关 switch。
 */
function extractUnion(text, anchor, pattern, windowAfter, sanity, minCount) {
  const results = [];
  let from = 0;
  while (true) {
    const index = text.indexOf(anchor, from);
    if (index === -1) break;
    from = index + anchor.length;

    for (const after of windowAfter) {
      const window = text.slice(Math.max(0, index - 2200), index + after);
      const seen = [];
      for (const match of window.matchAll(pattern)) {
        if (!seen.includes(match[1])) seen.push(match[1]);
      }
      if (sanity.every((name) => seen.includes(name)) && seen.length >= minCount) {
        results.push({ offset: index, windowAfter: after, values: seen });
        break;
      }
    }
  }
  return results;
}

/**
 * 从本机二进制提取契约。二进制是 Bun 单文件产物（源码内联且压缩过），所以只能靠
 * anchor + 正则提取；提取不到就返回 null，报告里如实说明，不猜。
 */
function extractBinaryContract(binaryPath) {
  let text;
  try {
    // latin1 让字节与字符一一对应，ASCII anchor 能稳定匹配，也不会因非法 UTF-8 报错。
    text = fs.readFileSync(binaryPath, 'latin1');
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  const parts = extractUnion(
    text, PART_SWITCH_ANCHOR, PART_CASE_PATTERN, [1600, 2400, 4000], PART_SANITY, 8,
  );
  const envelopes = extractUnion(
    text, ENVELOPE_ANCHOR, ENVELOPE_CALL_PATTERN, [5200, 8000, 12000], ENVELOPE_SANITY, 4,
  );

  if (parts.length === 0 && envelopes.length === 0) {
    return { error: '二进制里找不到契约 anchor（上游可能改了压缩/打包方式），本次跳过契约对照' };
  }

  return {
    partTypes: parts[0]?.values ?? [],
    envelopeTypes: envelopes[0]?.values ?? [],
  };
}

// ---------------------------------------------------------------------------
// 数据面分析
// ---------------------------------------------------------------------------

const quoteIdentifier = (name) => `"${name.replace(/"/g, '""')}"`;

function openDatabase(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  // 会话进行中会持锁；只读连接等一小会儿通常就能拿到快照。
  db.pragma('busy_timeout = 3000');
  return db;
}

function tableColumns(db, table) {
  try {
    return new Set(db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all().map((row) => row.name));
  } catch {
    return null;
  }
}

/**
 * 表/列完整性 —— 索引、历史、token 汇总三条链路都会因缺表或改名直接失效。
 */
function checkSchema(db) {
  const issues = [];
  const notes = [];
  for (const [table, spec] of Object.entries(READ_COLUMNS)) {
    const columns = tableColumns(db, table);
    if (!columns) {
      issues.push(`表 ${table} 不存在 —— 依赖它的查询会抛错并回退成空历史`);
      continue;
    }
    for (const column of spec.required) {
      if (!columns.has(column)) {
        issues.push(`表 ${table} 缺必需列 ${column}`);
      }
    }
    const missingOptional = spec.optional.filter((column) => !columns.has(column));
    if (missingOptional.length > 0) {
      notes.push(`表 ${table} 缺可选列 ${missingOptional.join(', ')}（token 汇总会回退到逐条 message.data，属已支持的降级）`);
    }
  }
  return { issues, notes };
}

function groupJsonField(db, table, field) {
  const counts = new Map();
  const rows = db.prepare(`
    SELECT json_extract(data, '$.${field}') AS value, COUNT(*) AS total
    FROM ${quoteIdentifier(table)}
    GROUP BY value
    ORDER BY total DESC
  `).all();
  for (const row of rows) {
    counts.set(row.value ?? '<null>', row.total);
  }
  return counts;
}

/**
 * 全局统计：契约面的对照基线。用整库而不是单会话，因为新类型可能只出现在别的会话里。
 */
function analyzeDatabase(db) {
  const schema = checkSchema(db);

  const sessions = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN time_archived IS NOT NULL THEN 1 ELSE 0 END) AS archived,
      SUM(CASE WHEN parent_id IS NOT NULL THEN 1 ELSE 0 END) AS child,
      SUM(CASE WHEN directory IS NULL OR directory = '' THEN 1 ELSE 0 END) AS noDirectory
    FROM session
  `).get();

  const versions = new Map();
  for (const row of db.prepare('SELECT version AS value, COUNT(*) AS total FROM session GROUP BY value').all()) {
    versions.set(row.value ?? '<null>', row.total);
  }

  // 首个 user prompt 被存成 JSON 字符串字面量（"hello"）—— unwrapJsonStringLiteral 的适用面。
  const quoted = db.prepare(`
    SELECT COUNT(*) AS total
    FROM part
    WHERE json_extract(data, '$.type') = 'text'
      AND json_extract(data, '$.text') LIKE '"%"'
  `).get();

  return {
    schema,
    sessions,
    versions,
    partTypes: groupJsonField(db, 'part', 'type'),
    roles: groupJsonField(db, 'message', 'role'),
    quotedTextParts: quoted?.total ?? 0,
  };
}

function listSessionIds(db, limit) {
  return db.prepare(`
    SELECT id
    FROM session
    WHERE time_archived IS NULL
    ORDER BY COALESCE(time_updated, time_created, 0) DESC, id DESC
    LIMIT ?
  `).all(limit).map((row) => row.id);
}

function analyzeSession(db, sessionId) {
  const session = db.prepare(`
    SELECT id, title, directory, version, time_created, time_updated, parent_id, time_archived
    FROM session
    WHERE id = ?
  `).get(sessionId);
  if (!session) {
    return null;
  }

  const partTypes = new Map();
  for (const row of db.prepare(`
    SELECT json_extract(p.data, '$.type') AS value, COUNT(*) AS total
    FROM part p
    WHERE p.session_id = ?
    GROUP BY value
    ORDER BY total DESC
  `).all(sessionId)) {
    partTypes.set(row.value ?? '<null>', row.total);
  }

  const roles = new Map();
  for (const row of db.prepare(`
    SELECT json_extract(data, '$.role') AS value, COUNT(*) AS total
    FROM message
    WHERE session_id = ?
    GROUP BY value
    ORDER BY total DESC
  `).all(sessionId)) {
    roles.set(row.value ?? '<null>', row.total);
  }

  const toolStates = new Map();
  for (const row of db.prepare(`
    SELECT json_extract(data, '$.state.status') AS value, COUNT(*) AS total
    FROM part
    WHERE session_id = ? AND json_extract(data, '$.type') = 'tool'
    GROUP BY value
    ORDER BY total DESC
  `).all(sessionId)) {
    toolStates.set(row.value ?? '<null>', row.total);
  }

  const assistantErrors = db.prepare(`
    SELECT COUNT(*) AS total
    FROM message
    WHERE session_id = ? AND json_extract(data, '$.error') IS NOT NULL
  `).get(sessionId).total;

  const firstUserText = db.prepare(`
    SELECT json_extract(p.data, '$.text') AS text
    FROM message m
    INNER JOIN part p ON p.session_id = m.session_id AND p.message_id = m.id
    WHERE m.session_id = ?
      AND json_extract(m.data, '$.role') = 'user'
      AND json_extract(p.data, '$.type') = 'text'
    ORDER BY COALESCE(m.time_created, 0), COALESCE(p.time_created, 0)
    LIMIT 1
  `).get(sessionId);

  return {
    session,
    partTypes,
    roles,
    toolStates,
    assistantErrors,
    firstUserText: firstUserText?.text ?? null,
    messageCount: [...roles.values()].reduce((sum, n) => sum + n, 0),
  };
}

// ---------------------------------------------------------------------------
// 报告
// ---------------------------------------------------------------------------

function printReport({ dbPath, binaryNote, contract, database, sessions, missingSessionIds }) {
  console.log('\n=== OpenCode 格式兼容性检查 ===\n');
  console.log(`数据源: ${dbPath}`);
  console.log(`二进制: ${binaryNote}`);

  const unclassifiedPartTypes = [...database.partTypes.keys()].filter((type) => !KNOWN_PART_TYPES.has(type));
  const unclassifiedRoles = [...database.roles.keys()].filter((role) => !KNOWN_MESSAGE_ROLES.has(role));
  const unclassifiedContractParts = (contract?.partTypes ?? []).filter((type) => !KNOWN_PART_TYPES.has(type));
  const unclassifiedEnvelopes = (contract?.envelopeTypes ?? []).filter((type) => !KNOWN_ENVELOPE_TYPES.has(type));

  console.log('\n[DB 结构]');
  if (database.schema.issues.length === 0) {
    console.log('  ✅ session / message / part / project 的必需列齐全');
  }
  for (const note of database.schema.notes) console.log(`  ℹ️ ${note}`);
  for (const issue of database.schema.issues) console.log(`  ⚠️ ${issue}`);

  console.log('\n[session 行]');
  const s = database.sessions;
  console.log(`  共 ${s.total} 条（归档 ${s.archived ?? 0} 条，子会话 parent_id 非空 ${s.child ?? 0} 条 —— 同步器会 prune 后者）`);
  if (s.noDirectory > 0) {
    console.log(`  ⚠️ ${s.noDirectory} 条 session 的 directory 为空 —— upsertSession 取不到 project_path，直接跳过不索引`);
  }
  for (const [version, count] of [...database.versions.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ℹ️ session.version=${version} × ${count}（这是**写入它的 CLI 版本**，不是格式世代号，跟着升级走属正常）`);
  }
  if (database.quotedTextParts > 0) {
    console.log(`  ℹ️ ${database.quotedTextParts} 条 text part 是 JSON 字符串字面量（"hello"）—— unwrapJsonStringLiteral 的适用面`);
  }

  console.log('\n[part.data.type]（整库）');
  for (const [type, count] of database.partTypes) {
    console.log(`  ${String(count).padStart(5)}  ${type}  — ${knownTag(KNOWN_PART_TYPES, type)}`);
  }

  console.log('\n[message.data.role]（整库）');
  for (const [role, count] of database.roles) {
    const tag = KNOWN_MESSAGE_ROLES.has(role) ? '已适配' : '需评估';
    console.log(`  ${String(count).padStart(5)}  ${role}  — ${tag}`);
  }

  console.log('\n[二进制契约对照]');
  if (contract?.error) {
    console.log(`  ℹ️ ${contract.error}`);
  } else if (contract) {
    console.log(`  part 类型 union（${contract.partTypes.length}）: ${contract.partTypes.join(', ')}`);
    console.log(`  run --format json 信封（${contract.envelopeTypes.length}）: ${contract.envelopeTypes.join(', ')}`);
    const missingInBaseline = contract.partTypes.filter((type) => ![...database.partTypes.keys()].includes(type));
    if (missingInBaseline.length > 0) {
      console.log(`  ℹ️ 其中 ${missingInBaseline.join(', ')} 在本地 DB 里还没出现过 —— 只靠数据面会漏掉，故契约面是必需的`);
    }
  } else {
    console.log(`  ℹ️ 本次未做契约提取（${binaryNote}）`);
  }

  for (const detail of sessions) {
    const { session, partTypes, roles, toolStates, assistantErrors, messageCount, firstUserText } = detail;
    console.log(`\n[会话 ${session.id}]`);
    console.log(`  标题: ${session.title ?? '<空>'}`);
    console.log(`  目录: ${session.directory ?? '<空>'}   版本: ${session.version ?? '<空>'}`);
    console.log(`  父会话: ${session.parent_id ?? '<无>'}   归档: ${session.time_archived ?? '<未归档>'}`);
    console.log(`  message ${messageCount} 条（role: ${[...roles.entries()].map(([role, n]) => `${role}×${n}`).join(', ') || '<无>'}）`);
    console.log(`  assistant 错误: ${assistantErrors} 条`);
    if (toolStates.size > 0) {
      console.log(`  tool.state.status: ${[...toolStates.entries()].map(([status, n]) => `${status}×${n}`).join(', ')}`);
    }
    console.log('  part 类型:');
    for (const [type, count] of partTypes) {
      console.log(`    ${String(count).padStart(5)}  ${type}  — ${knownTag(KNOWN_PART_TYPES, type)}`);
    }
    if (firstUserText !== null) {
      const quotedLiteral = firstUserText.startsWith('"') && firstUserText.endsWith('"');
      console.log(`  首条 user 文本: ${JSON.stringify(firstUserText.slice(0, 60))}${quotedLiteral ? '（JSON 字符串字面量，靠 unwrapJsonStringLiteral 去引号）' : ''}`);
    } else {
      console.log('  ⚠️ 取不到首条 user 文本 —— readFirstUserText 返回 undefined，会话名只能靠 session.title');
    }
  }

  console.log('\n[与项目读取逻辑对照]');
  const problems = [
    ...database.schema.issues,
    ...(s.noDirectory > 0 ? [`${s.noDirectory} 条 session 缺 directory（同步器跳过，不进侧栏）`] : []),
    ...missingSessionIds.map((id) => `指定的会话 ${id} 不在库里（已归档或 id 有误）—— 本次没有取到它的数据面证据`),
  ];
  if (unclassifiedPartTypes.length > 0) {
    console.log('  🆕 整库出现未识别的 part.data.type（normalizeHistoryRows 是白名单 if 链，会静默跳过）:');
    for (const type of unclassifiedPartTypes) console.log(`    🆕 ${type}`);
  }
  if (unclassifiedRoles.length > 0) {
    console.log('  🆕 整库出现未识别的 message.data.role:');
    for (const role of unclassifiedRoles) console.log(`    🆕 ${role}`);
  }
  if (unclassifiedContractParts.length > 0) {
    console.log('  🆕 二进制契约里出现基线未登记的类型（可能还没落库）:');
    for (const type of unclassifiedContractParts) console.log(`    🆕 ${type}`);
  }
  if (unclassifiedEnvelopes.length > 0) {
    console.log('  🆕 二进制契约里出现未识别的 run --format json 信封 type:');
    for (const type of unclassifiedEnvelopes) console.log(`    🆕 ${type}`);
  }
  for (const problem of problems) console.log(`  ⚠️ ${problem}`);

  if (
    unclassifiedPartTypes.length === 0 && unclassifiedRoles.length === 0
    && unclassifiedContractParts.length === 0 && unclassifiedEnvelopes.length === 0
    && problems.length === 0
  ) {
    console.log('  ✅ 数据面与契约面都与 CloudCLI 的读取基线匹配');
  }

  console.log('\n[下一步]');
  console.log('  1. 🆕 part 类型：确认它是否携带要展示的内容。历史 → 在 normalizeHistoryRows 加分支；');
  console.log('     仅实时 → 在 normalizeMessage 加分支。');
  console.log('  2. 🆕 信封 type：确认正文位置。信封恒为 {type,timestamp,sessionID,part}，');
  console.log('     但 type 是 snake_case、part 内是 kebab-case —— 历史事故就出在这层错位上。');
  console.log('  3. ⚠️ 表/列：改 SQL 与 PRAGMA 探测，别只改历史读取（索引与 token 汇总各有一条链路）。');
  console.log('  4. 前缀核查：`opencode run --format json` 的 text 信封只在 part.time.end 后发一次，');
  console.log('     属块级粒度而非 token 级，不是 bug。');
  console.log('  5. 完整基线见 SKILL.md「格式基线」章节。\n');

  return problems.length === 0
    && unclassifiedPartTypes.length === 0 && unclassifiedRoles.length === 0
    && unclassifiedContractParts.length === 0 && unclassifiedEnvelopes.length === 0;
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const allFlag = args.includes('--all');
const noBinary = args.includes('--no-binary');
const dbArg = args.find((arg) => !arg.startsWith('--') && arg.endsWith('.db'));
const sessionArgs = args.filter((arg) => !arg.startsWith('--') && !arg.endsWith('.db'));

const dbPath = dbArg ? path.resolve(dbArg) : databasePath();
if (!fs.existsSync(dbPath)) {
  console.log(`未找到 OpenCode 数据库: ${dbPath}`);
  console.log('请先使用 OpenCode CLI 进行一个会话，或用 OPENCODE_DB_PATH 指定；也可直接传 .db 路径。');
  process.exit(1);
}

let db;
try {
  db = openDatabase(dbPath);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.log(`无法以只读方式打开 ${dbPath}: ${message}`);
  console.log('若提示 database is locked，OpenCode 正在写入；稍后重跑即可（检查器绝不改动该库）。');
  process.exit(1);
}

try {
  const binaryPath = noBinary ? null : resolveOpenCodeBinary();
  const binaryNote = noBinary
    ? '已跳过（--no-binary）'
    : binaryPath ?? '未找到（PATH 里没有 opencode，跳过契约对照）';
  const contract = binaryPath ? extractBinaryContract(binaryPath) : null;
  const database = analyzeDatabase(db);

  const ids = sessionArgs.length > 0
    ? sessionArgs
    : listSessionIds(db, allFlag ? 5 : 1);
  const analyzed = ids.map((id) => ({ id, detail: analyzeSession(db, id) }));
  const sessions = analyzed.filter((entry) => entry.detail).map((entry) => entry.detail);
  const missingSessionIds = analyzed.filter((entry) => !entry.detail).map((entry) => entry.id);
  if (ids.length === 0) {
    missingSessionIds.push('（库里没有未归档会话，未取到数据面证据）');
  }

  const compatible = printReport({
    dbPath,
    binaryNote,
    contract,
    database,
    sessions,
    missingSessionIds,
  });
  process.exitCode = compatible ? 0 : 2;
} finally {
  db.close();
}
