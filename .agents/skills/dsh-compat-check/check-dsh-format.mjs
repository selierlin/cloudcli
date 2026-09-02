#!/usr/bin/env node
/**
 * DSH session-log format compatibility checker.
 *
 * Reads DeepSeek Harness session.jsonl.zstd files and compares their logical
 * JSONL records with CloudCLI's dsh-sessions.provider.ts history decoder.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const ZSTD_FRAME_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const COMPRESSED_LOG = 'session.jsonl.zstd';
const PLAIN_LOG = 'session.jsonl';
const KNOWN_RENDERED_TYPES = new Set(['user/message', 'assistant/message']);
const KNOWN_NOT_READ_TYPES = new Map([
  ['session', '会话头（元数据）'],
  ['assistant/chunk', '流式增量已汇总到 assistant/message'],
  ['agent/inbox/spliced', '上下文拼接元数据'],
  ['step/start', '步骤生命周期'], ['step/end', '步骤生命周期'],
  ['tool/call', '工具元数据'], ['tool/result', '工具元数据'],
  ['turn/start', 'turn 生命周期'], ['turn/end', 'turn 生命周期'],
  ['request/header', '请求元数据'], ['request/context', '请求上下文'],
  ['sandbox/mode', '执行环境元数据'], ['approval/policy', '审批策略元数据'],
  ['permission/preset', '权限预设元数据'], ['session/title', '会话标题元数据'],
  ['session/title-llm-request', '标题生成 LLM 请求元数据'],
  ['session/end-seed', '种子阶段结束生命周期'], ['model/selection', '模型选择元数据'],
  ['reasoning-chunks', '压缩后的推理增量'], ['text-chunks', '压缩后的文本增量'],
  ['tool-call-chunks', '压缩后的工具调用增量'],
  ['hook/invoked', 'Hook 生命周期'], ['hook/result', 'Hook 生命周期'],
  ['subagent/descriptor', '子代理元数据'], ['todo/write', '待办元数据'],
  ['tool/code-dispatch-start', '代码工具调度元数据'], ['tool/code-dispatch', '代码工具调度元数据'],
  ['tool-workflow/run-start', '工具工作流生命周期'], ['tool-workflow/agent-start', '工具工作流生命周期'],
  ['tool-workflow/agent-end', '工具工作流生命周期'], ['tool-workflow/run-end', '工具工作流生命周期'],
  ['compaction/start', '压缩生命周期'], ['compaction/summary', '压缩摘要元数据'], ['compaction/end', '压缩生命周期'],
  ['llm/retry', '模型重试元数据'], ['llm/retry-started', '模型重试元数据'],
  ['approval/asked', '审批生命周期'], ['approval/decided', '审批生命周期'],
]);
const KNOWN_BLOCK_TYPES = new Set(['text', 'reasoning', 'tool-call', 'image']);

function sessionsRoot() {
  const explicit = process.env.DSH_SESSIONS_ROOT?.trim();
  if (explicit) return explicit;
  const harnessHome = process.env.DSH_HOME?.trim()
    || path.join(os.homedir(), '.dsh');
  return path.join(harnessHome, 'sessions');
}

function decodeZstdFrames(buffer) {
  let text = '';
  let badFrames = 0;
  let frames = 0;
  let index = buffer.indexOf(ZSTD_FRAME_MAGIC);
  while (index !== -1) {
    const next = buffer.indexOf(ZSTD_FRAME_MAGIC, index + ZSTD_FRAME_MAGIC.length);
    try {
      text += zlib.zstdDecompressSync(buffer.subarray(index, next === -1 ? buffer.length : next)).toString('utf8');
      frames += 1;
    } catch {
      badFrames += 1;
    }
    index = next;
  }
  return { text, frames, badFrames };
}

function increment(map, value) {
  map.set(value, (map.get(value) ?? 0) + 1);
}

function analyze(text) {
  const types = new Map();
  const blocks = new Map();
  const sourceKinds = new Map();
  const issues = [];
  let parsedLines = 0;
  let badLines = 0;
  let headers = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    let event;
    try {
      event = JSON.parse(rawLine);
      parsedLines += 1;
    } catch {
      badLines += 1;
      continue;
    }
    const type = typeof event?.type === 'string' ? event.type : '?';
    increment(types, type);
    if (type === 'session') {
      headers += 1;
      if (event.version !== 0) issues.push(`session header version 为 ${String(event.version)}（当前基线为 0）`);
      continue;
    }
    const data = event?.data && typeof event.data === 'object' ? event.data : {};
    if (type === 'user/message') {
      const source = data.source && typeof data.source === 'object' ? data.source : null;
      if (typeof source?.kind === 'string') increment(sourceKinds, source.kind);
      else issues.push('user/message 缺 data.source.kind（当前代码会把它渲染为用户输入）');
      collectBlocks(data.content, blocks);
    } else if (type === 'assistant/message') {
      const message = data.message && typeof data.message === 'object' ? data.message : {};
      collectBlocks(message.content, blocks);
    }
  }
  if (headers === 0) issues.push('未找到 session header（当前文件不是预期 DSH JSONL 格式，或解压失败）');
  return { types, blocks, sourceKinds, issues, parsedLines, badLines };
}

function collectBlocks(content, blocks) {
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (block && typeof block === 'object' && typeof block.type === 'string') increment(blocks, block.type);
  }
}

function findLogs(limit) {
  const root = sessionsRoot();
  if (!fs.existsSync(root)) return [];
  const logs = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === COMPRESSED_LOG || entry.name === PLAIN_LOG) logs.push(full);
    }
  };
  walk(root);
  logs.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return logs.slice(0, limit);
}

function printReport(filePath) {
  const plain = path.basename(filePath) === PLAIN_LOG;
  let decoded;
  try {
    const bytes = fs.readFileSync(filePath);
    decoded = plain ? { text: bytes.toString('utf8'), frames: 0, badFrames: 0 } : decodeZstdFrames(bytes);
  } catch (error) {
    console.log(`\n检查文件: ${filePath}\n  ⚠️ 无法读取：${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
  const data = analyze(decoded.text);
  const unclassifiedTypes = [...data.types.keys()].filter((type) => !KNOWN_RENDERED_TYPES.has(type) && !KNOWN_NOT_READ_TYPES.has(type));
  const unclassifiedBlocks = [...data.blocks.keys()].filter((type) => !KNOWN_BLOCK_TYPES.has(type));
  const compatible = !plain && decoded.badFrames === 0 && data.badLines === 0 && data.issues.length === 0
    && unclassifiedTypes.length === 0 && unclassifiedBlocks.length === 0;

  console.log(`\n=== DSH transcript 格式兼容性检查 ===\n\n检查文件: ${filePath}`);
  console.log(`文件修改时间: ${fs.statSync(filePath).mtime.toISOString()}，逻辑 JSONL ${data.parsedLines} 行`);
  if (plain) console.log(`  ⚠️ 发现未压缩 ${PLAIN_LOG}：CloudCLI 当前只发现并读取 ${COMPRESSED_LOG}`);
  if (!plain) console.log(`  ℹ️ Zstandard 帧: ${decoded.frames} 个成功${decoded.badFrames ? `，${decoded.badFrames} 个不可读` : ''}`);
  if (data.badLines) console.log(`  ⚠️ 解压后有 ${data.badLines} 条无效 JSONL 行`);

  console.log('\n[顶层事件]');
  for (const [type, count] of [...data.types.entries()].sort((a, b) => b[1] - a[1])) {
    const tag = KNOWN_RENDERED_TYPES.has(type) ? '项目会渲染'
      : KNOWN_NOT_READ_TYPES.has(type) ? `已评估（${KNOWN_NOT_READ_TYPES.get(type)}）` : '需评估';
    console.log(`  ${String(count).padStart(5)}  ${type} — ${tag}`);
  }

  console.log('\n[消息内容块]');
  if (data.blocks.size === 0) console.log('  无 user/message 或 assistant/message content block');
  for (const [type, count] of [...data.blocks.entries()].sort((a, b) => b[1] - a[1])) {
    const tag = type === 'text' ? '项目会渲染' : KNOWN_BLOCK_TYPES.has(type) ? '已知但当前不渲染' : '需评估';
    console.log(`  ${String(count).padStart(5)}  ${type} — ${tag}`);
  }

  if (data.sourceKinds.size > 0) {
    console.log(`\n[用户消息来源] ${[...data.sourceKinds.entries()].map(([kind, count]) => `${kind}:${count}`).join(', ')}`);
    const injected = [...data.sourceKinds.entries()].filter(([kind]) => kind !== 'user');
    if (injected.length > 0) console.log('  ✅ 非 user 来源是注入上下文，当前历史读取会跳过');
  }

  console.log('\n[与项目读取逻辑对照]');
  for (const issue of data.issues) console.log(`  ⚠️ ${issue}`);
  for (const type of unclassifiedTypes) console.log(`  🆕 未识别顶层事件: ${type}`);
  for (const type of unclassifiedBlocks) console.log(`  🆕 未识别内容块: ${type}`);
  console.log(compatible ? '  ✅ 本会话结构与 CloudCLI DSH 读取基线匹配' : '  ⚠️ 存在需要评估的兼容性信号');
  return compatible;
}

const args = process.argv.slice(2);
const explicitPath = args.find((arg) => !arg.startsWith('--'));
const files = explicitPath ? [path.resolve(explicitPath)] : findLogs(args.includes('--all') ? 5 : 1);
if (files.length === 0) {
  console.log(`未找到 DSH session log。请先使用 DSH，或设置 DSH_SESSIONS_ROOT；当前目录：${sessionsRoot()}`);
  console.log(`也可指定文件：node check-dsh-format.mjs /absolute/path/to/${COMPRESSED_LOG}`);
  process.exitCode = 1;
} else {
  let compatible = true;
  for (const filePath of files) compatible = printReport(filePath) && compatible;
  if (!compatible) process.exitCode = 2;
}
