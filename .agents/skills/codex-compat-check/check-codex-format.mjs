#!/usr/bin/env node
/**
 * CodeX rollout 格式兼容性检查器
 *
 * 解析 ~/.codex/sessions 下最新的 rollout JSONL，对比 cloudcli 读取逻辑
 * （codex-sessions.provider.ts 的 getCodexSessionMessages / 搜索服务）已知的事件
 * 结构，找出可能因 CodeX 版本升级而变化的格式点。
 *
 * 用法：
 *   node check-codex-format.mjs                  # 自动找最新会话
 *   node check-codex-format.mjs <rollout文件路径>  # 检查指定会话
 *   node check-codex-format.mjs --all            # 最近 5 个会话
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const SESSIONS_ROOT = path.join(os.homedir(), '.codex', 'sessions');

/**
 * 项目读取逻辑（getCodexSessionMessages）已知的事件结构基线。
 * event 签名格式：`event_msg:${payload.type}` 或 `response_item:${payload.type}`，
 * item_completed 展开为 `event_msg:item_completed:${item.type}`。
 */
const PROJECT_READS = [
  { event: 'event_msg:user_message', label: '用户消息（旧格式 ≤0.146）', adapted: true, replacedBy: 'event_msg:item_completed:UserMessage' },
  { event: 'event_msg:sub_agent_activity', label: '子任务活动（旧格式）', adapted: true, replacedBy: 'event_msg:item_completed:SubAgentActivity' },
  { event: 'event_msg:item_completed:UserMessage', label: '用户消息（新格式 ≥0.150）', adapted: true, replacedBy: 'event_msg:user_message' },
  { event: 'event_msg:item_completed:SubAgentActivity', label: '子任务活动（新格式 ≥0.150）', adapted: true, replacedBy: 'event_msg:sub_agent_activity' },
  { event: 'event_msg:token_count', label: 'token 统计', adapted: true },
  { event: 'response_item:message', label: '消息（assistant/user/developer）', adapted: true },
  { event: 'response_item:reasoning', label: '思考过程 reasoning', adapted: true },
  { event: 'response_item:todo_list', label: '待办列表', adapted: true },
  { event: 'response_item:agent_message', label: '子任务消息（新格式）', adapted: true },
  { event: 'response_item:function_call', label: '函数调用', adapted: true },
  { event: 'response_item:function_call_output', label: '函数调用结果', adapted: true },
  { event: 'response_item:custom_tool_call', label: '自定义工具调用', adapted: true },
  { event: 'response_item:custom_tool_call_output', label: '自定义工具结果', adapted: true },
];

const PROJECT_READ_EVENTS = new Set(PROJECT_READS.map((r) => r.event));

/**
 * 已评估、当前无需适配的事件（有冗余来源或纯元数据）。当 CodeX 未来把这些
 * 类型迁移到仅有的数据来源时，它们会再次以 🆕 出现在报告中 —— 那才是信号。
 */
const KNOWN_NOT_READ = [
  { event: 'event_msg:item_completed:Reasoning', reason: '有冗余 response_item:reasoning，项目已读' },
  { event: 'event_msg:item_completed:CommandExecution', reason: '有冗余 response_item:custom_tool_call（命令文本）；exit_code 等细节新旧一致均不展示' },
  { event: 'event_msg:item_completed:AgentMessage', reason: '有冗余 response_item:agent_message，项目已读' },
  { event: 'event_msg:item_completed:FileChange', reason: '文件编辑新旧一致均不展示（旧格式 patch_apply_end 也不读），非回归' },
  { event: 'event_msg:item_completed:CollabAgentToolCall', reason: 'subagent 协作 wait 调用元数据；生命周期已由 function_call 覆盖' },
  { event: 'event_msg:task_started', reason: 'turn 生命周期元数据，无展示价值' },
  { event: 'event_msg:task_complete', reason: 'turn 生命周期元数据；last_agent_message 是 response_item 冗余快照' },
  { event: 'event_msg:thread_settings_applied', reason: '配置元数据，无展示价值' },
];
const KNOWN_NOT_READ_MAP = new Map(KNOWN_NOT_READ.map((k) => [k.event, k.reason]));

function eventSignature(entry) {
  const type = entry.type;
  if (type === 'event_msg') {
    const payloadType = entry.payload?.type;
    if (payloadType === 'item_completed') {
      return `event_msg:item_completed:${entry.payload.item?.type ?? '?'}`;
    }
    return `event_msg:${payloadType ?? '?'}`;
  }
  if (type === 'response_item') {
    return `response_item:${entry.payload?.type ?? '?'}`;
  }
  return `other:${type}`;
}

function extractTextBlocks(content) {
  const blocks = new Set();
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && typeof block === 'object' && typeof block.type === 'string') {
        blocks.add(block.type);
      }
    }
  }
  return blocks;
}

async function analyzeRollout(filePath) {
  const counts = new Map();
  const blockTypes = new Map(); // 每个 response_item.message 的 content block 类型
  const reasoningSummaries = { total: 0, nonEmpty: 0 };
  const execCmdKeys = { total: 0, cmdKey: 0, commandKey: 0 };
  const messageRoles = new Map();
  const functionNames = new Map();
  let isSubagentSession = false;

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;

    // session_meta 顶层 type，payload 含 session_id/id/source；与
    // CodexSessionSynchronizer.isSubagentSessionMeta 同逻辑判断子代理线程。
    if (entry.type === 'session_meta' && entry.payload) {
      const p = entry.payload;
      const source = p.source;
      if (p.thread_source === 'subagent' || (source && typeof source === 'object' && 'subagent' in source)) {
        isSubagentSession = true;
      }
    }

    const sig = eventSignature(entry);
    counts.set(sig, (counts.get(sig) ?? 0) + 1);

    const payload = entry.payload ?? {};
    if (entry.type === 'response_item' && payload.type === 'message') {
      const role = payload.role ?? '?';
      messageRoles.set(role, (messageRoles.get(role) ?? 0) + 1);
      const blocks = extractTextBlocks(payload.content);
      for (const b of blocks) {
        const key = `message:${role}:${b}`;
        blockTypes.set(key, (blockTypes.get(key) ?? 0) + 1);
      }
    }
    if (entry.type === 'response_item' && payload.type === 'reasoning') {
      reasoningSummaries.total += 1;
      if (Array.isArray(payload.summary) && payload.summary.length > 0) {
        reasoningSummaries.nonEmpty += 1;
      }
    }
    if (entry.type === 'response_item' && payload.type === 'custom_tool_call') {
      const input = String(payload.input ?? '');
      if (/tools\.(?:exec_command|shell_command)\s*\(/.test(input)) {
        execCmdKeys.total += 1;
        if (/"cmd"\s*:/.test(input)) execCmdKeys.cmdKey += 1;
        if (/"command"\s*:/.test(input)) execCmdKeys.commandKey += 1;
      }
    }
    if (entry.type === 'response_item' && payload.type === 'function_call') {
      const name = payload.name ?? '?';
      functionNames.set(name, (functionNames.get(name) ?? 0) + 1);
    }
  }

  return { counts, blockTypes, reasoningSummaries, execCmdKeys, messageRoles, functionNames, isSubagentSession };
}

function findRolloutFiles(limit) {
  const files = [];
  if (!fs.existsSync(SESSIONS_ROOT)) return files;
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) walk(full);
      else if (name.endsWith('.jsonl')) files.push(full);
    }
  };
  walk(SESSIONS_ROOT);
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files.slice(0, limit);
}

function versionInfo() {
  const info = {};
  // codex CLI 版本
  const cli = spawnSync('codex', ['--version'], { encoding: 'utf8', timeout: 5000 });
  if (cli.status === 0) info.cli = cli.stdout.trim();
  // version.json 已知最新版
  try {
    const v = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.codex', 'version.json'), 'utf8'));
    info.knownLatest = v.latest_version;
    info.checkedAt = v.last_checked_at;
  } catch {}
  // 项目 codex-sdk
  const pkgPath = path.join(process.cwd(), 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    info.sdk = pkg.dependencies?.['@openai/codex-sdk'] ?? pkg.devDependencies?.['@openai/codex-sdk'];
  } catch {}
  return info;
}

function printReport(filePath, data) {
  const { counts, blockTypes, reasoningSummaries, execCmdKeys, messageRoles, functionNames, isSubagentSession } = data;
  const rel = path.relative(SESSIONS_ROOT, filePath);

  console.log('\n=== CodeX rollout 格式兼容性检查 ===\n');
  console.log(`检查文件: ~/.codex/sessions/${rel}`);
  console.log(`文件修改时间: ${fs.statSync(filePath).mtime.toISOString()}`);
  if (isSubagentSession) {
    console.log('  会话类型: 子代理线程（thread_source=subagent，synchronizer 跳过，不索引展示）');
  }

  const info = versionInfo();
  console.log('\n[版本]');
  if (info.cli) console.log(`  codex-cli:  ${info.cli}`);
  if (info.knownLatest) console.log(`  已知最新版: ${info.knownLatest}（${info.checkedAt ?? '时间未知'} 检查）`);
  if (info.sdk) console.log(`  项目 codex-sdk: ${info.sdk}`);

  console.log('\n[事件结构]');
  for (const [sig, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${sig}`);
  }

  console.log('\n[与项目读取逻辑对照]');
  const missing = PROJECT_READS.filter((r) => (counts.get(r.event) ?? 0) === 0);
  const unread = [...counts.entries()]
    .filter(([sig]) => !PROJECT_READ_EVENTS.has(sig) && !sig.startsWith('other:'))
    .sort((a, b) => b[1] - a[1]);

  if (missing.length > 0) {
    console.log('  项目读取但本会话缺失:');
    for (const r of missing) {
      if (isSubagentSession) {
        console.log(`    ℹ️  ${r.label}  (${r.event}) — 子代理线程不索引展示，缺失属正常`);
        continue;
      }
      const replaced = r.replacedBy && (counts.get(r.replacedBy) ?? 0) > 0;
      const tag = replaced ? '已被新格式替代，预期迁移' : '需确认';
      console.log(`    ${replaced ? 'ℹ️' : '⚠️'}  ${r.label}  (${r.event}) — ${tag}`);
    }
  }
  const unreadUnclassified = [];
  if (unread.length > 0) {
    console.log('  本会话存在但项目未读取:');
    for (const [sig, n] of unread) {
      const known = KNOWN_NOT_READ_MAP.get(sig);
      if (known) {
        console.log(`    ℹ️  ${String(n).padStart(4)}  ${sig} — 已评估: ${known}`);
      } else {
        unreadUnclassified.push([sig, n]);
        console.log(`    🆕 ${String(n).padStart(4)}  ${sig} — 需评估是否要适配`);
      }
    }
  }
  if (missing.length === 0 && unreadUnclassified.length === 0) {
    console.log('  ✅ 本会话事件结构与项目读取逻辑完全匹配');
  }

  console.log('\n[关键格式点]');
  const hasLegacyUser = (counts.get('event_msg:user_message') ?? 0) > 0;
  const hasModernUser = (counts.get('event_msg:item_completed:UserMessage') ?? 0) > 0;
  if (hasModernUser) console.log('  ✅ 用户消息: item_completed.UserMessage（新格式，项目已适配）');
  if (hasLegacyUser) console.log('  ✅ 用户消息: event_msg.user_message（旧格式，项目仍兼容）');
  if (!hasLegacyUser && !hasModernUser) {
    if (isSubagentSession) {
      console.log('  ℹ️ 无 UserMessage/user_message 记录：子代理线程不索引展示，且主会话输入由其 thread_spawn 上下文承载，属正常');
    } else {
      console.log('  ⚠️ 未检测到任何用户消息记录（主会话，需确认是真无输入还是格式迁移）');
    }
  }

  const hasLegacySub = (counts.get('event_msg:sub_agent_activity') ?? 0) > 0;
  const hasModernSub = (counts.get('event_msg:item_completed:SubAgentActivity') ?? 0) > 0;
  if (hasModernSub) console.log('  ✅ 子任务: item_completed.SubAgentActivity（新格式，项目已适配）');
  if (hasLegacySub) console.log('  ✅ 子任务: event_msg.sub_agent_activity（旧格式，项目仍兼容）');

  if (reasoningSummaries.total > 0) {
    const note = reasoningSummaries.nonEmpty > 0
      ? `summary 非空 ${reasoningSummaries.nonEmpty}/${reasoningSummaries.total}，思考过程可展示`
      : 'summary 全部为空（内容在 encrypted_content），思考过程不展示（新旧一致，非回归）';
    console.log(`  ℹ️  reasoning: ${reasoningSummaries.total} 条，${note}`);
  }

  if (execCmdKeys.total > 0) {
    const key = execCmdKeys.cmdKey > 0 ? 'cmd' : (execCmdKeys.commandKey > 0 ? 'command' : '?');
    console.log(`  ℹ️  exec 命令: ${execCmdKeys.total} 条，参数键「${key}」（项目按 command 提取，若为 cmd 则翻译率低，新旧一致）`);
  }

  if (messageRoles.size > 0) {
    const roles = [...messageRoles.entries()].map(([r, n]) => `${r}:${n}`).join(', ');
    console.log(`  ℹ️  message role 分布: ${roles}`);
  }
  if (functionNames.size > 0) {
    const names = [...functionNames.entries()].map(([n, c]) => `${n}(${c})`).join(', ');
    console.log(`  ℹ️  function_call 名称: ${names}`);
  }

  console.log('\n[下一步]');
  console.log('  1. 对照「与项目读取逻辑对照」的 ⚠️/🆕 项，判断是否为格式变化。');
  console.log('  2. 若 ⚠️ 缺失项对应旧格式事件且本会话已有新格式替代 → 属预期迁移，无需处理。');
  console.log('  3. 若 🆕 新增项影响会话展示（用户消息/子任务/回复），需在 codex-sessions.provider.ts 适配。');
  console.log('  4. 完整基线见 SKILL.md「格式基线」章节。\n');
}

const args = process.argv.slice(2);
const allFlag = args.includes('--all');
const explicitPath = args.find((a) => !a.startsWith('--') && (a.endsWith('.jsonl') || a.includes('rollout')));

(async () => {
  let files = [];
  if (explicitPath) {
    files = [path.resolve(explicitPath)];
  } else {
    files = findRolloutFiles(allFlag ? 5 : 1);
  }

  if (files.length === 0) {
    console.log('未找到任何 CodeX rollout 会话文件。');
    console.log(`请先使用 CodeX 创建/进行一个会话（会话文件位于 ~/.codex/sessions/ 下），或指定路径：`);
    console.log('  node check-codex-format.mjs <rollout.jsonl>');
    process.exit(1);
  }

  for (const file of files) {
    if (!fs.existsSync(file)) {
      console.error(`文件不存在: ${file}`);
      continue;
    }
    const data = await analyzeRollout(file);
    printReport(file, data);
  }
})();
