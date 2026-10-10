#!/usr/bin/env node
/**
 * OpenClaw SQLite 会话格式兼容性检查器。
 *
 * CloudCLI 只读 OpenClaw 每个 agent 的 `openclaw-agent.sqlite`：会话索引在
 * `session_nodes`/`session_windows`，事件在 `transcript_events`，当前分支由
 * `session_transcript_active_events` 给出。升级若改表、改事件结构、或改注入
 * 头，CloudCLI 会静默漏消息或把注入内容显示成用户输入。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import Database from 'better-sqlite3';

// CloudCLI 读取逻辑真正依赖的表/字段（见 openclaw-sessions/session-synchronizer/token-usage）。
const REQUIRED_COLUMNS = {
  session_nodes: ['session_key', 'current_session_id', 'display_name', 'created_at', 'updated_at'],
  session_windows: ['session_id', 'session_key', 'created_at', 'updated_at'],
  transcript_events: ['session_id', 'seq', 'event_json', 'event_zstd'],
  session_transcript_active_events: ['session_id', 'active_position', 'event_seq'],
  session_transcript_index_state: ['session_id'],
};
// 历史渲染只认 entry.type === 'message'；其余为元数据。
const RENDERED_ENTRY_TYPES = new Set(['message']);
const KNOWN_METADATA_ENTRY_TYPES = new Map([
  ['session', '会话 header（seq=0，携带 cwd）'],
  ['custom', '自定义事件'],
  ['custom_message', '自定义消息事件'],
  ['thinking_level_change', '思考档位变更'],
  ['model_change', '模型切换'],
  ['leaf', '分支叶子标记'],
]);
const KNOWN_ROLES = new Set(['user', 'assistant', 'toolResult']);
const KNOWN_BLOCKS = new Map([
  ['text', '文本（user / assistant / toolResult）'],
  ['thinking', '思考'],
  ['toolCall', '工具调用'],
  ['image', '图片（user / toolResult）'],
  ['(string content)', 'user 消息的纯字符串内容（已适配）'],
]);
// CloudCLI 会剥离的注入特征（openclaw-sessions.provider.ts 的 strip 实现）。
const INJECTION_MARKER = '⟦openclaw:ctx⟧';
const ACTIVE_MEMORY_TAG = '<active_memory_plugin>';
const TIMESTAMP_PREFIX_RE = /^\[[A-Za-z]{3} \d{4}-\d{2}-\d{2} \d{2}:\d{2}[^\]]*\] /;
const SYNTHETIC_PROMPT_PREFIXES = ['A new session was started via /new or /reset', '[cron:'];

function resolveStateDir() {
  const override = process.env.OPENCLAW_STATE_DIR?.trim();
  if (override === '~' || override?.startsWith('~/')) return path.join(os.homedir(), override.slice(1));
  if (override) return path.isAbsolute(override) ? override : path.resolve(override);
  return path.join(os.homedir(), '.openclaw');
}

function listAgentDbs(stateDir) {
  const agentsDir = path.join(stateDir, 'agents');
  if (!fs.existsSync(agentsDir)) return [];
  const out = [];
  for (const agentId of fs.readdirSync(agentsDir)) {
    const dbPath = path.join(agentsDir, agentId, 'agent', 'openclaw-agent.sqlite');
    if (fs.existsSync(dbPath)) out.push({ agentId, dbPath });
  }
  return out;
}

function decodeEvent(row) {
  try {
    if (typeof row.event_json === 'string' && row.event_json) return JSON.parse(row.event_json);
    if (row.event_zstd) return JSON.parse(zlib.zstdDecompressSync(row.event_zstd).toString('utf8'));
  } catch { return null; }
  return null;
}

function checkSchema(db) {
  const tables = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name),
  );
  const issues = [];
  for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
    if (!tables.has(table)) { issues.push(`缺少表 ${table}`); continue; }
    const actual = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
    for (const column of required) if (!actual.has(column)) issues.push(`${table} 缺少字段 ${column}`);
  }
  return issues;
}

function bump(map, key) {
  const name = key === undefined || key === null ? '(缺失)' : String(key);
  map.set(name, (map.get(name) ?? 0) + 1);
}

function countInjectedUserText(text) {
  // 返回文本里出现的注入特征（用于确认剥离仍在生效）。
  const hits = [];
  if (text.includes(INJECTION_MARKER)) hits.push('ctx 头');
  if (text.includes(ACTIVE_MEMORY_TAG)) hits.push('active_memory');
  if (TIMESTAMP_PREFIX_RE.test(text)) hits.push('时间戳前缀');
  if (SYNTHETIC_PROMPT_PREFIXES.some((prefix) => text.startsWith(prefix))) hits.push('合成引导');
  return hits;
}

function analyzeSession(db, sessionKey, sessionId) {
  const rows = db.prepare(`
    SELECT t.event_json AS event_json, t.event_zstd AS event_zstd
    FROM session_transcript_active_events a
    INNER JOIN transcript_events t ON t.session_id = a.session_id AND t.seq = a.event_seq
    WHERE a.session_id = ? ORDER BY a.active_position
  `).all(sessionId);
  const entryTypes = new Map();
  const roles = new Map();
  const blocks = new Map();
  const injection = new Map();
  let malformed = 0;
  let userRows = 0;
  for (const row of rows) {
    const obj = decodeEvent(row);
    if (!obj || typeof obj !== 'object') { malformed += 1; continue; }
    bump(entryTypes, obj.type);
    if (obj.type !== 'message') continue;
    const message = obj.message;
    if (!message || typeof message !== 'object') continue;
    bump(roles, message.role);
    const content = message.content;
    if (Array.isArray(content)) {
      for (const block of content) if (block && typeof block === 'object') bump(blocks, block.type);
    } else if (typeof content === 'string') bump(blocks, '(string content)');
    if (message.role === 'user') {
      userRows += 1;
      const texts = typeof content === 'string'
        ? [content]
        : (Array.isArray(content) ? content.filter((b) => b?.type === 'text').map((b) => b.text) : []);
      for (const text of texts) {
        if (typeof text !== 'string') continue;
        for (const hit of countInjectedUserText(text)) bump(injection, hit);
      }
    }
  }

  const issues = [];
  const danglingActive = Number(db.prepare(`
    SELECT COUNT(*) AS count FROM session_transcript_active_events a WHERE a.session_id = ? AND NOT EXISTS (
      SELECT 1 FROM transcript_events t WHERE t.session_id = a.session_id AND t.seq = a.event_seq
    )
  `).get(sessionId).count);
  const activeCount = Number(db.prepare(
    'SELECT COUNT(*) AS count FROM session_transcript_active_events WHERE session_id = ?',
  ).get(sessionId).count);
  if (!rows.length) issues.push('当前分支为空：会话无可见历史');
  else if (activeCount !== rows.length) {
    issues.push(`active 索引 ${activeCount} 条，但仅 ${rows.length} 条能在 transcript_events 命中：可能存在悬挂引用`);
  }
  if (danglingActive) issues.push(`${danglingActive} 条 active 事件在 transcript_events 中找不到同 seq 事件`);
  if (malformed) issues.push(`${malformed} 条事件无法解码（event_json/event_zstd 均为坏值）：历史会跳过`);
  const info = [];
  if (userRows && injection.size === 0) {
    info.push('本会话无注入特征样本，剥离路径未被覆盖（信息性）');
  }
  return { sessionKey, sessionId, events: rows.length, entryTypes, roles, blocks, injection, issues, info };
}

function printCounts(title, counts, describe) {
  console.log(`\n[${title}]`);
  if (!counts.size) { console.log('  无'); return; }
  for (const [value, count] of [...counts].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(5)}  ${value}  — ${describe(value)}`);
  }
}

function printReport(dbPath, agentId, report) {
  console.log('\n=== OpenClaw 会话格式兼容性检查 ===\n');
  console.log(`数据库: ${dbPath.replace(os.homedir(), '~')}`);
  console.log(`agent: ${agentId}`);
  console.log(`会话: ${report.sessionKey}`);
  console.log(`当前分支事件: ${report.events} 条`);
  printCounts('entry.type', report.entryTypes, (type) =>
    RENDERED_ENTRY_TYPES.has(type) ? '项目渲染此类型' : (KNOWN_METADATA_ENTRY_TYPES.get(type) ?? '需评估'));
  printCounts('message.role', report.roles, (role) =>
    KNOWN_ROLES.has(role) ? '项目已适配' : '需评估');
  printCounts('content[].type', report.blocks, (type) =>
    KNOWN_BLOCKS.get(type) ?? '需评估');
  printCounts('注入特征', report.injection, (hit) => `CloudCLI 剥离：${hit}`);

  const unknownEntries = [...report.entryTypes.keys()]
    .filter((t) => !RENDERED_ENTRY_TYPES.has(t) && !KNOWN_METADATA_ENTRY_TYPES.has(t));
  const unknownRoles = [...report.roles.keys()].filter((r) => !KNOWN_ROLES.has(r));
  const unknownBlocks = [...report.blocks.keys()].filter((b) => !KNOWN_BLOCKS.has(b));
  console.log('\n[与项目读取逻辑对照]');
  if (!report.issues.length && !unknownEntries.length && !unknownRoles.length && !unknownBlocks.length) {
    console.log('  ✅ 本会话结构与项目读取基线完全匹配');
  }
  for (const issue of report.issues) console.log(`  ⚠️  ${issue}`);
  for (const note of report.info) console.log(`  ℹ️  ${note}`);
  for (const type of unknownEntries) console.log(`  🆕 未识别 entry.type: ${type}`);
  for (const role of unknownRoles) console.log(`  🆕 未识别 message.role: ${role}`);
  for (const block of unknownBlocks) console.log(`  🆕 未识别 content[].type: ${block}`);
  console.log('\n[下一步]');
  console.log('  1. 新 entry.type：确认真实样本；只有携带历史正文时才在 fetchHistory 的归一分支处理。');
  console.log('  2. 新 role / block：在 openclaw-sessions.provider.ts 的 normalizeOpenclawAgentMessage() 补最小映射。');
  console.log('  3. 缺表/字段：复核查询与 openclaw-session-synchronizer.provider.ts 的索引逻辑。');
  console.log('  4. 注入特征变样：同步 strip 实现，避免注入内容显示成用户输入。');
  console.log('  5. 用真实样本补 fixtures/openclaw-agent-db.ts 与 openclaw-sessions.test.ts，再跑 typecheck 与相关测试。\n');
}

const args = process.argv.slice(2);
const explicitPath = args.find((arg) => !arg.startsWith('--'));
const stateDir = resolveStateDir();
let targets;
if (explicitPath) {
  const resolved = path.resolve(explicitPath);
  targets = [{ agentId: path.basename(path.dirname(path.dirname(resolved))) || '?', dbPath: resolved }];
} else {
  targets = listAgentDbs(stateDir);
}
if (!targets.length) {
  console.error(`未找到 OpenClaw agent 数据库（state dir: ${stateDir}）。先运行一次 OpenClaw，或传入 db.sqlite 路径。`);
  process.exit(1);
}

let exitCode = 0;
for (const { agentId, dbPath } of targets) {
  if (!fs.existsSync(dbPath)) { console.error(`不存在: ${dbPath}`); exitCode = 1; continue; }
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('busy_timeout = 2000');
    const schemaIssues = checkSchema(db);
    if (schemaIssues.some((issue) => issue.startsWith('缺少表'))) {
      console.error(`无法读取 OpenClaw 会话表: ${schemaIssues.join('；')}`);
      exitCode = 1;
      continue;
    }
    let nodes = [];
    try {
      nodes = db.prepare(`
        SELECT session_key, current_session_id FROM session_nodes
        WHERE current_session_id IS NOT NULL
        ORDER BY COALESCE(last_activity_at, updated_at, created_at, 0) DESC, session_key DESC
        LIMIT ?
      `).all(args.includes('--all') ? 5 : 1);
    } catch (error) {
      console.error(`读取 session_nodes 失败: ${String(error)}`);
      exitCode = 1;
      continue;
    }
    if (!nodes.length) console.log(`${dbPath.replace(os.homedir(), '~')}: 未找到带 current_session_id 的会话。`);
    for (const node of nodes) {
      const report = analyzeSession(db, node.session_key, node.current_session_id);
      report.issues.unshift(...schemaIssues);
      printReport(dbPath, agentId, report);
    }
  } finally { db.close(); }
}
process.exit(exitCode);
