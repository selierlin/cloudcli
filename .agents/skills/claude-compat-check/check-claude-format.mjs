#!/usr/bin/env node
/**
 * Claude Code 会话格式兼容性检查器
 *
 * 解析 ~/.claude/projects 下最新的 Claude 会话 JSONL，对照 cloudcli 的
 * normalizeMessage 读取基线，找出可能因 Claude Code 升级而变化的消息结构
 * （新增顶层 type / 新增 content block 类型 / 系统注入前缀变化等）。
 *
 * 用法：
 *   node check-claude-format.mjs                  # 自动找最新会话
 *   node check-claude-format.mjs <jsonl路径>       # 检查指定会话
 *   node check-claude-format.mjs --all            # 最近 5 个会话
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const PROJECTS_ROOT = path.join(os.homedir(), '.claude', 'projects');

/**
 * 项目 normalizeMessage（claude-sessions.provider.ts）认识并会产生消息的
 * 顶层 type / 分支。`user`/`assistant` 走 message.role 分支。
 */
const KNOWN_MESSAGE_TYPES = new Set([
  'user', 'assistant', 'thinking', 'tool_use', 'tool_result',
]);

/**
 * 项目读取的其他事件（不产生聊天消息，但被同步器/搜索消费）。
 */
const KNOWN_METADATA_TYPES = new Map([
  ['ai-title', '会话名来源（同步器）'],
  ['last-prompt', '会话名来源（同步器）'],
  ['custom-title', '会话名来源（同步器）'],
  ['summary', '会话摘要（搜索服务）'],
  ['content_block_delta', '流式增量（实时，非历史）'],
  ['content_block_stop', '流式结束（实时，非历史）'],
]);

/**
 * 已评估无影响：无 message.role 或不在 normalize 分支，返回空不展示。
 */
const KNOWN_NOT_READ_TYPES = new Map([
  ['mode', '会话模式元数据'],
  ['permission-mode', '权限模式元数据'],
  ['system', '系统消息元数据（含 compact_boundary 摘要边界，无 message.role 不展示）'],
  ['attachment', '无 message.role，normalize 返回空'],
  ['file-history-snapshot', '文件历史快照'],
  ['file-history-delta', '文件历史增量'],
  ['queue-operation', '队列操作元数据'],
  ['atis-latch', '内部元数据'],
  ['agent-name', '子代理命名元数据'],
  ['cost-state', '成本状态元数据'],
  ['started', '内部事件'],
  ['result', '内部事件'],
]);

/**
 * normalizeMessage 认知的 content block 类型。
 */
const KNOWN_BLOCK_TYPES = new Set([
  'text', 'tool_use', 'tool_result', 'thinking', 'image',
]);

/**
 * isInternalContent 的已知前缀（claude-sessions.provider.ts
 * INTERNAL_CONTENT_PREFIXES）。内容以这些前缀开头会被过滤不展示。
 */
const KNOWN_INTERNAL_PREFIXES = [
  '<system-reminder>',
  'Caveat:',
  '[Request interrupted',
  'Base directory for this skill:',
];

/**
 * parseLocalCommandPayload 认识的本地命令标签。
 */
const KNOWN_COMMAND_TAGS = [
  'command-name', 'command-message', 'command-args', 'local-command-stdout',
];

/**
 * 前端特殊渲染的内容前缀（不属 isInternalContent 过滤，但被前端识别为
 * 特殊消息，如后台任务通知卡片），无需人工评估。
 */
const KNOWN_FRONTEND_RENDERED_PREFIXES = [
  '<task-notification>',
];

async function analyzeSession(filePath) {
  const typeCounts = new Map();
  const blockTypes = new Map();
  const unknownPrefixHits = [];
  const messageRoles = new Map();
  let totalLines = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    totalLines += 1;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;

    const type = entry.type ?? '?';
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);

    const role = entry.message?.role;
    if (role) messageRoles.set(role, (messageRoles.get(role) ?? 0) + 1);

    const content = entry.message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block && typeof block.type === 'string') {
          blockTypes.set(block.type, (blockTypes.get(block.type) ?? 0) + 1);
        }
      }
    }

    // 检测 isInternalContent 前缀列表覆盖不到的 `<...>` 注入内容。
    if (
      (type === 'user' || type === 'assistant')
      && typeof content === 'string'
    ) {
      const trimmed = content.trim();
      if (trimmed.startsWith('<') || trimmed.startsWith('#')) {
        const matched = KNOWN_INTERNAL_PREFIXES.some((p) => trimmed.startsWith(p));
        const frontendRendered = KNOWN_FRONTEND_RENDERED_PREFIXES.some((p) => trimmed.startsWith(p));
        const localCommand = KNOWN_COMMAND_TAGS.some((tag) => trimmed.includes(`<${tag}>`));
        if (!matched && !frontendRendered && !localCommand) {
          unknownPrefixHits.push({ type, preview: trimmed.slice(0, 80) });
        }
      }
    }
  }

  return { typeCounts, blockTypes, messageRoles, unknownPrefixHits, totalLines };
}

function findSessionFiles(limit) {
  const files = [];
  if (!fs.existsSync(PROJECTS_ROOT)) return files;
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        // Claude 子代理/工具结果目录，与同步器一致跳过。
        if (name === 'subagents' || name === 'tool-results') continue;
        walk(full);
      } else if (name.endsWith('.jsonl') && !name.startsWith('agent-')) {
        files.push(full);
      }
    }
  };
  walk(PROJECTS_ROOT);
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files.slice(0, limit);
}

function printReport(filePath, data) {
  const { typeCounts, blockTypes, messageRoles, unknownPrefixHits, totalLines } = data;
  const rel = path.relative(PROJECTS_ROOT, filePath);

  console.log('\n=== Claude Code 会话格式兼容性检查 ===\n');
  console.log(`检查文件: ~/.claude/projects/${rel}`);
  console.log(`文件修改时间: ${fs.statSync(filePath).mtime.toISOString()}，共 ${totalLines} 行`);

  console.log('\n[顶层 type]');
  for (const [type, n] of [...typeCounts.entries()].sort((a, b) => b[1] - a[1])) {
    const tag = KNOWN_MESSAGE_TYPES.has(type)
      ? '项目会渲染'
      : KNOWN_METADATA_TYPES.has(type)
        ? `已读(${KNOWN_METADATA_TYPES.get(type)})`
        : KNOWN_NOT_READ_TYPES.has(type)
          ? `已评估(${KNOWN_NOT_READ_TYPES.get(type)})`
          : '需评估';
    console.log(`  ${String(n).padStart(5)}  ${type}  — ${tag}`);
  }

  console.log('\n[content block 类型]');
  if (blockTypes.size === 0) {
    console.log('  无 content block（消息可能为 string 或无 content）');
  }
  for (const [block, n] of [...blockTypes.entries()].sort((a, b) => b[1] - a[1])) {
    const tag = KNOWN_BLOCK_TYPES.has(block) ? '项目已适配' : '需评估';
    console.log(`  ${String(n).padStart(5)}  ${block}  — ${tag}`);
  }

  console.log('\n[关键格式点]');
  if (messageRoles.size > 0) {
    const roles = [...messageRoles.entries()].map(([r, n]) => `${r}:${n}`).join(', ');
    console.log(`  ℹ️  message.role 分布: ${roles}`);
  }
  for (const type of ['ai-title', 'last-prompt', 'custom-title']) {
    if ((typeCounts.get(type) ?? 0) > 0) {
      console.log(`  ✅ 会话名事件 ${type}: ${typeCounts.get(type)} 条，同步器已适配`);
    }
  }
  if ((typeCounts.get('summary') ?? 0) > 0) {
    console.log(`  ✅ 摘要事件 summary: ${typeCounts.get('summary')} 条，搜索服务已适配`);
  }

  if (unknownPrefixHits.length > 0) {
    console.log(`\n[潜在未过滤注入内容]（isInternalContent 前缀覆盖不到）`);
    for (const hit of unknownPrefixHits.slice(0, 8)) {
      console.log(`  🆕 ${hit.type} 行以未识别前缀开头: ${hit.preview}`);
    }
  } else {
    console.log('\n[潜在未过滤注入内容]  ✅ 未发现 isInternalContent 覆盖不到的前缀');
  }

  console.log('\n[与项目读取逻辑对照]');
  const unclassifiedTypes = [...typeCounts.entries()]
    .filter(([type]) => !KNOWN_MESSAGE_TYPES.has(type)
      && !KNOWN_METADATA_TYPES.has(type)
      && !KNOWN_NOT_READ_TYPES.has(type))
    .sort((a, b) => b[1] - a[1]);
  const unclassifiedBlocks = [...blockTypes.entries()]
    .filter(([block]) => !KNOWN_BLOCK_TYPES.has(block))
    .sort((a, b) => b[1] - a[1]);

  if (unclassifiedTypes.length === 0 && unclassifiedBlocks.length === 0 && unknownPrefixHits.length === 0) {
    console.log('  ✅ 本会话结构与项目读取基线完全匹配');
  }
  if (unclassifiedTypes.length > 0) {
    console.log('  🆕 项目未识别的新顶层 type:');
    for (const [type, n] of unclassifiedTypes) console.log(`    🆕 ${String(n).padStart(5)}  ${type}`);
  }
  if (unclassifiedBlocks.length > 0) {
    console.log('  🆕 项目未识别的新 content block 类型:');
    for (const [block, n] of unclassifiedBlocks) console.log(`    🆕 ${String(n).padStart(5)}  ${block}`);
  }

  console.log('\n[下一步]');
  console.log('  1. 顶层 type 若出现 🆕 需评估：确认它是否有 message.role / content。');
  console.log('  2. 有 message.role 的消息类 type 需要 normalizeMessage 加分支；无 role 的元数据类加入 KNOWN_NOT_READ。');
  console.log('  3. content block 出现新类型（text/tool_use/tool_result/thinking/image 之外）需评估是否要渲染。');
  console.log('  4. 完整基线见 SKILL.md「格式基线」章节。\n');
}

const args = process.argv.slice(2);
const allFlag = args.includes('--all');
const explicitPath = args.find((a) => !a.startsWith('--') && a.endsWith('.jsonl'));

(async () => {
  let files = [];
  if (explicitPath) {
    files = [path.resolve(explicitPath)];
  } else {
    files = findSessionFiles(allFlag ? 5 : 1);
  }

  if (files.length === 0) {
    console.log('未找到任何 Claude Code 会话文件。');
    console.log(`请先使用 Claude Code 进行一个会话（会话文件位于 ~/.claude/projects/ 下），或指定路径：`);
    console.log('  node check-claude-format.mjs <session.jsonl>');
    process.exit(1);
  }

  for (const file of files) {
    if (!fs.existsSync(file)) {
      console.error(`文件不存在: ${file}`);
      continue;
    }
    const data = await analyzeSession(file);
    printReport(file, data);
  }
})();
