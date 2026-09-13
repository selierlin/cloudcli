#!/usr/bin/env node
/** ZCode SQLite 会话格式兼容性检查器。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const REQUIRED_COLUMNS = {
  session: ['id', 'directory', 'title', 'time_created', 'time_updated', 'time_archived'],
  message: ['id', 'session_id', 'time_created', 'data', 'sequence'],
  part: ['id', 'message_id', 'session_id', 'time_created', 'data', 'sequence'],
};
const KNOWN_ROLES = new Set(['user', 'assistant']);
const KNOWN_RENDERED_PARTS = new Map([
  ['text', '文本消息（user / assistant）'], ['reasoning', '思考消息'],
  ['tool', '工具调用及 state.output / state.error'], ['step-finish', '回合结束标记'],
  ['patch', 'Patch 工具卡片'], ['agent', 'Agent 工具卡片'],
]);
const KNOWN_NON_RENDERED_PARTS = new Map([
  ['step-start', '回合开始元数据'], ['file', '附件元数据（当前不单独渲染）'], ['timeline', '时间线元数据（当前不单独渲染）'],
]);
const KNOWN_TOOL_STATUSES = new Set(['pending', 'running', 'completed', 'error']);

function resolveUserPath(value, baseDir) {
  const trimmed = value.trim();
  if (trimmed === '~' || trimmed.startsWith('~/')) return path.join(os.homedir(), trimmed.slice(1));
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(baseDir, trimmed);
}

function resolveDatabasePath() {
  const home = path.join(os.homedir(), '.zcode');
  try {
    const config = JSON.parse(fs.readFileSync(path.join(home, 'cli', 'config.json'), 'utf8'));
    if (typeof config?.storage?.sessionDbPath === 'string' && config.storage.sessionDbPath.trim()) {
      return resolveUserPath(config.storage.sessionDbPath, home);
    }
  } catch { /* 和 provider 一样回退默认位置。 */ }
  return path.join(home, 'cli', 'db', 'db.sqlite');
}

function jsonRecord(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

function checkSchema(db) {
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
  const issues = [];
  for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
    if (!tables.has(table)) { issues.push(`缺少表 ${table}`); continue; }
    const actual = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
    for (const column of required) if (!actual.has(column)) issues.push(`${table} 缺少字段 ${column}`);
  }
  return issues;
}

function analyzeSession(db, session) {
  const roles = new Map();
  const partTypes = new Map();
  const toolStatuses = new Map();
  let malformedMessages = 0;
  let malformedParts = 0;
  const rows = db.prepare(`
    SELECT m.id AS message_id, m.data AS message_data, p.id AS part_id, p.data AS part_data
    FROM message m LEFT JOIN part p ON p.message_id = m.id AND p.session_id = m.session_id
    WHERE m.session_id = ?
    ORDER BY COALESCE(m.time_created, 0), COALESCE(m.sequence, 0), m.id,
             COALESCE(p.time_created, 0), COALESCE(p.sequence, 0), p.id
  `).all(session.id);
  const messageIds = new Set();
  for (const row of rows) {
    if (!messageIds.has(row.message_id)) {
      messageIds.add(row.message_id);
      const message = jsonRecord(row.message_data);
      if (!message) malformedMessages += 1;
      else {
        const role = typeof message.role === 'string' ? message.role : '(缺 role)';
        roles.set(role, (roles.get(role) ?? 0) + 1);
      }
    }
    if (!row.part_id) continue;
    const part = jsonRecord(row.part_data);
    if (!part) { malformedParts += 1; continue; }
    const type = typeof part.type === 'string' ? part.type : '(缺 type)';
    partTypes.set(type, (partTypes.get(type) ?? 0) + 1);
    if (type === 'tool') {
      const status = typeof part.state?.status === 'string' ? part.state.status : '(缺 state.status)';
      toolStatuses.set(status, (toolStatuses.get(status) ?? 0) + 1);
    }
  }
  const orphanParts = Number(db.prepare(`
    SELECT COUNT(*) AS count FROM part p WHERE p.session_id = ? AND NOT EXISTS (
      SELECT 1 FROM message m WHERE m.id = p.message_id AND m.session_id = p.session_id
    )
  `).get(session.id).count);
  const issues = [];
  if (!session.directory) issues.push('session.directory 缺失：同步器无法确定项目路径');
  if (malformedMessages) issues.push(`${malformedMessages} 条 message.data 不是有效对象 JSON：历史会跳过`);
  if (malformedParts) issues.push(`${malformedParts} 条 part.data 不是有效对象 JSON：历史会跳过`);
  if (orphanParts) issues.push(`${orphanParts} 条 part 没有同 session 的 message：历史查询不会读取`);
  return { rows: rows.length, roles, partTypes, toolStatuses, issues };
}

function printCounts(title, counts, describe) {
  console.log(`\n[${title}]`);
  if (!counts.size) console.log('  无');
  for (const [value, count] of [...counts].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(5)}  ${value}  — ${describe(value)}`);
  }
}

function printReport(dbPath, session, schemaIssues, report) {
  console.log('\n=== ZCode 会话格式兼容性检查 ===\n');
  console.log(`检查数据库: ${dbPath.replace(os.homedir(), '~')}`);
  console.log(`会话: ${session.id}`);
  console.log(`更新时间: ${new Date(session.time_updated ?? session.time_created).toISOString()}，${report.rows} 条 message/part 联结行`);
  printCounts('message.data.role', report.roles, (role) => KNOWN_ROLES.has(role) ? '项目已适配' : '需评估');
  printCounts('part.data.type', report.partTypes, (type) => KNOWN_RENDERED_PARTS.get(type) ?? KNOWN_NON_RENDERED_PARTS.get(type) ?? '需评估');
  printCounts('tool state.status', report.toolStatuses, (status) => KNOWN_TOOL_STATUSES.has(status) ? '项目已适配' : '需评估');
  const unknownRoles = [...report.roles.keys()].filter((role) => !KNOWN_ROLES.has(role));
  const unknownParts = [...report.partTypes.keys()].filter((type) => !KNOWN_RENDERED_PARTS.has(type) && !KNOWN_NON_RENDERED_PARTS.has(type));
  const unknownStatuses = [...report.toolStatuses.keys()].filter((status) => !KNOWN_TOOL_STATUSES.has(status));
  const issues = [...schemaIssues, ...report.issues];
  console.log('\n[与项目读取逻辑对照]');
  if (!issues.length && !unknownRoles.length && !unknownParts.length && !unknownStatuses.length) console.log('  ✅ 本会话结构与项目读取基线完全匹配');
  for (const issue of issues) console.log(`  ⚠️  ${issue}`);
  for (const role of unknownRoles) console.log(`  🆕 未识别 message role: ${role}`);
  for (const type of unknownParts) console.log(`  🆕 未识别 part type: ${type}`);
  for (const status of unknownStatuses) console.log(`  🆕 未识别 tool state.status: ${status}`);
  console.log('\n[下一步]');
  console.log('  1. 新 role / part type：确认字段后在 zcode-sessions.provider.ts 的 normalizeHistoryRows() 补分支。');
  console.log('  2. 新表或字段缺失：复核查询与 zcode-session-synchronizer.provider.ts 的索引逻辑。');
  console.log('  3. 用新格式构造 SQLite fixture，补 zcode-sessions.test.ts 后运行 typecheck 与相关测试。\n');
}

const args = process.argv.slice(2);
const explicitPath = args.find((arg) => !arg.startsWith('--'));
const dbPath = path.resolve(explicitPath ?? resolveDatabasePath());
if (!fs.existsSync(dbPath)) {
  console.error(`未找到 ZCode 会话数据库: ${dbPath}`);
  process.exit(1);
}
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
try {
  db.pragma('busy_timeout = 2000');
  const schemaIssues = checkSchema(db);
  if (schemaIssues.some((issue) => issue.startsWith('缺少表'))) {
    console.error(`无法读取 ZCode 会话表：${schemaIssues.join('；')}`);
    process.exitCode = 1;
  } else {
    const sessions = db.prepare(`
      SELECT id, directory, title, time_created, time_updated FROM session WHERE time_archived IS NULL
      ORDER BY COALESCE(time_updated, time_created, 0) DESC, id DESC LIMIT ?
    `).all(args.includes('--all') ? 5 : 1);
    if (!sessions.length) console.log('未找到未归档的 ZCode 会话。');
    for (const session of sessions) printReport(dbPath, session, schemaIssues, analyzeSession(db, session));
  }
} finally { db.close(); }
