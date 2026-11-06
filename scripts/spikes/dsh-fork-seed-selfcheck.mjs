#!/usr/bin/env node
/**
 * S0 — DSH fork seed 离线自检。
 *
 * 对应 docs/research/DSH会话派生编辑与侧边提问实施方案.md 的 §5.1 / §5.3 / §11 S0：
 * 用 DSH 自己的格式校验（restoreReleasedV4Artifact）与真实读取层
 * （JsonlSessionPersistence.open）验证「手工构造的 seed 能被读出来」。
 *
 * 不写 ~/.dsh，不碰产品代码；所有产物落在 mkdtemp 出来的临时目录，默认跑完即删。
 *
 * 用法：
 *   node scripts/spikes/dsh-fork-seed-selfcheck.mjs
 *   node scripts/spikes/dsh-fork-seed-selfcheck.mjs --limit-files 3 --verbose
 *   node scripts/spikes/dsh-fork-seed-selfcheck.mjs \
 *     --dsh-root ~/.nvm/versions/node/v26.11.1/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai
 *
 * 退出码：0 = 全绿；1 = 有失败；2 = 环境不满足（找不到 DSH / 日志 / zstd）。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const LOG_NAME = /^session(?:\.v(\d+))?\.jsonl(?:\.zstd)?$/;
const DELIVERY_TYPE = 'session-log-deepseek/delivery-accepted';

main().catch((error) => {
  console.error(`FATAL: ${error?.stack ?? error}`);
  process.exit(2);
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (typeof zlib.zstdCompressSync !== 'function') {
    throw new Error(`当前 Node ${process.version} 不支持 zstd（需要 >= 22.15）`);
  }

  const dshRoot = resolveDshRoot(options.dshRoot);
  const modules = await loadDshModules(dshRoot);

  const sessionsRoot = options.sessionsRoot;
  const allFiles = walkLogs(sessionsRoot);
  if (allFiles.length === 0) {
    throw new Error(`没有在 ${sessionsRoot} 下找到 session*.jsonl[.zstd]`);
  }
  const files = options.limitFiles > 0 ? allFiles.slice(0, options.limitFiles) : allFiles;

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-fork-s0-'));
  const stats = {
    dshRoot,
    sessionsRoot,
    tempRoot,
    files: 0,
    seededSources: 0,
    seededBoundaries: 0,
    boundaries: 0,
    restored: 0,
    opened: 0,
    badFrames: 0,
    failures: [],
    controls: [],
  };
  const persistence = new Map();

  for (const file of files) {
    let log;
    try {
      log = decodeLog(file);
    } catch (error) {
      recordFailure(stats, file, null, `decode: ${error.message}`);
      continue;
    }
    stats.files += 1;

    if (log.badFrames > 0) {
      stats.badFrames += log.badFrames;
      recordFailure(stats, file, null, `${log.badFrames} 个 zstd 帧解压失败，跳过该日志`);
      continue;
    }
    if (log.header.version !== 4) {
      recordFailure(stats, file, null, `不支持的 header.version=${log.header.version}`);
      continue;
    }
    try {
      assertDense(log.events);
    } catch (error) {
      recordFailure(stats, file, null, error.message);
      continue;
    }
    if (log.header.isSeeded) stats.seededSources += 1;

    const boundaries = log.events.filter((event) => event.type === 'turn/end');
    if (boundaries.length === 0) continue;

    const compression = file.endsWith('.zstd') ? 'zstd' : 'none';
    const projectName = sourceProjectName(file);
    const store = getPersistence(persistence, modules, path.join(tempRoot, compression), compression);

    for (const boundaryEvent of boundaries) {
      if (options.maxBoundaries > 0 && stats.boundaries >= options.maxBoundaries) break;
      if (typeof boundaryEvent.seq !== 'number') {
        recordFailure(stats, file, null, 'turn/end 缺少 seq');
        continue;
      }
      const boundary = boundaryEvent.seq;
      stats.boundaries += 1;
      if (log.header.isSeeded) stats.seededBoundaries += 1;

      const seed = buildSeed(log, boundary);
      try {
        modules.restoreReleasedV4Artifact(seed.artifact, modules.knownEventTypes);
        stats.restored += 1;
      } catch (error) {
        recordFailure(stats, file, boundary, `restore: ${error.message}`);
        continue;
      }

      try {
        await writeAndOpen({
          store,
          root: path.join(tempRoot, compression),
          projectName,
          seed,
          compression,
          expectedCut: seed.cut,
          keep: options.keep,
        });
        stats.opened += 1;
      } catch (error) {
        recordFailure(stats, file, boundary, `open: ${error.message}`);
      }

      if (options.verbose) {
        console.log(`ok  ${path.relative(sessionsRoot, file)} @${boundary}`);
      }
    }
  }

  const controlSource = pickControlSource(files);
  if (controlSource) {
    stats.controls = await runNegativeControls(controlSource, modules, tempRoot);
  }

  printSummary(stats, options);
  if (!options.keep) fs.rmSync(tempRoot, { recursive: true, force: true });
  else console.log(`\n临时目录保留在 ${tempRoot}`);

  const controlsFailed = stats.controls.filter((control) => !control.ok);
  process.exit(stats.failures.length === 0 && controlsFailed.length === 0 ? 0 : 1);
}

//---------------------------- seed 构造 ----------------------------

function buildSeed(log, boundary) {
  const sourceHeader = log.header;
  const id = `session-${crypto.randomUUID()}`;
  const header = {
    version: 4,
    id,
    createdAt: Date.now(),
    isSeeded: true,
    delegationDepth: sourceHeader.delegationDepth ?? 0,
  };
  if (sourceHeader.cwd !== undefined) header.cwd = sourceHeader.cwd;
  if (sourceHeader.agentPreset !== undefined) header.agentPreset = sourceHeader.agentPreset;

  const prefix = log.events.slice(0, boundary + 1).map((event) => structuredClone(event));
  for (const event of prefix) {
    // 方案 §5.1：不写 parentSession 就没有 delivery 豁免，必须把旧 id 改写掉。
    if (event.type === DELIVERY_TYPE && event.data && typeof event.data === 'object') {
      event.data.sessionId = id;
    }
  }

  const cut = boundary + 1;
  const events = prefix.concat({
    type: 'session/end-seed',
    seq: cut,
    time: log.events[boundary].time ?? Date.now(),
    data: { inherited: true },
  });

  return {
    id,
    cut,
    header,
    fileHeader: { type: 'session', ...header },
    events,
    artifact: { header, inheritedEventCount: cut, events },
  };
}

/**
 * 在前缀内插入一条 delivery marker（seq = boundary+1），end-seed 顺延到 +2。
 * 原事件 seq 不动，因此不会破坏引用；cut 变成 boundary+2，marker 落在前缀内。
 */
function buildSeedWithDelivery(log, boundary, { sessionId, parentSession }) {
  const base = buildSeed(log, boundary);
  const deliverySeq = boundary + 1;
  const cut = boundary + 2;
  const time = log.events[boundary].time ?? Date.now();

  if (parentSession !== undefined) base.header.parentSession = parentSession;
  base.fileHeader = { type: 'session', ...base.header };

  const delivery = {
    type: DELIVERY_TYPE,
    seq: deliverySeq,
    time,
    data: { sessionFormatVersion: 4, throughSeq: boundary, sessionId },
  };
  const endSeed = { type: 'session/end-seed', seq: cut, time, data: { inherited: true } };
  const events = base.events.slice(0, -1).concat(delivery, endSeed);

  return {
    ...base,
    cut,
    events,
    artifact: { header: base.header, inheritedEventCount: cut, events },
  };
}

//---------------------------- 负向控制 ----------------------------

async function runNegativeControls(source, modules, tempRoot) {
  const results = [];
  const boundary = source.log.events.find((event) => event.type === 'turn/end')?.seq;
  if (boundary === undefined) return results;

  const base = buildSeed(source.log, boundary);

  const expectReject = (name, artifact, pattern) => {
    try {
      modules.restoreReleasedV4Artifact(artifact, modules.knownEventTypes);
      results.push({ name, ok: false, message: '预期被拒，实际通过' });
    } catch (error) {
      results.push({ name, ok: pattern.test(error.message), message: error.message });
    }
  };
  const expectAccept = (name, artifact, note = '通过') => {
    try {
      modules.restoreReleasedV4Artifact(artifact, modules.knownEventTypes);
      results.push({ name, ok: true, message: note });
    } catch (error) {
      results.push({ name, ok: false, message: error.message });
    }
  };

  // 1) isSeeded:false + inherited marker 必须被拒。
  expectReject(
    'unseeded + inherited marker',
    { ...base.artifact, header: { ...base.header, isSeeded: false } },
    /unseeded .* inherited/i,
  );

  // 2) v4 头不接受 seedLength。
  expectReject(
    'header.seedLength',
    { ...base.artifact, header: { ...base.header, seedLength: base.cut } },
    /unexpected field seedLength/i,
  );

  // 3) 写 parentSession 时格式本身合法；拒绝它的是 ACP resume，不是 restore。
  expectAccept(
    'parentSession is format-legal',
    { ...base.artifact, header: { ...base.header, parentSession: source.log.header.id } },
    'restore 通过（ACP resume 会拒，S1/S2 验证）',
  );

  // 4) delivery marker 在前缀内：改写 sessionId 通过。
  const rewritten = buildSeedWithDelivery(source.log, boundary, {
    sessionId: 'placeholder-will-be-replaced',
  });
  rewritten.events[rewritten.events.length - 2].data.sessionId = rewritten.id;
  expectAccept('delivery marker rewritten to new id', rewritten.artifact);

  // 5) 保留旧 id、不写 parentSession：必须被拒。
  const stale = buildSeedWithDelivery(source.log, boundary, {
    sessionId: source.log.header.id,
  });
  expectReject(
    'delivery marker keeps old id',
    stale.artifact,
    /delivery marker names the wrong Session/i,
  );

  // 6) 保留旧 id、但写 parentSession：豁免生效，restore 通过——这就是不能写它的原因。
  const staleWithParent = buildSeedWithDelivery(source.log, boundary, {
    sessionId: source.log.header.id,
    parentSession: source.log.header.id,
  });
  expectAccept(
    'delivery marker + parentSession (exemption trap)',
    staleWithParent.artifact,
    'restore 通过（证明豁免条件确实是 parentSession）',
  );

  // 7) 头与事件压进同一帧，读取层必须拒绝（仅 zstd 有意义）。
  const compression = source.file.endsWith('.zstd') ? 'zstd' : 'none';
  if (compression === 'zstd') {
    const root = path.join(tempRoot, compression);
    const store = getPersistence(new Map(), modules, root, compression);
    const singleFrame = buildSeed(source.log, boundary);
    try {
      await writeAndOpen({
        store,
        root,
        projectName: sourceProjectName(source.file),
        seed: singleFrame,
        compression,
        expectedCut: singleFrame.cut,
        singleFrame: true,
        keep: false,
      });
      results.push({ name: 'header and events in one frame', ok: false, message: '预期被拒，实际通过' });
    } catch (error) {
      results.push({
        name: 'header and events in one frame',
        ok: /first frame is not exactly one header line/i.test(error.message),
        message: error.message,
      });
    }
  }

  // 8) compression:'none' 的根：产物必须是 .jsonl（无 .zstd），读取层能打开。
  const plainRoot = path.join(tempRoot, 'none');
  const plainStore = getPersistence(new Map(), modules, plainRoot, 'none');
  const plainSeed = buildSeed(source.log, boundary);
  try {
    await writeAndOpen({
      store: plainStore,
      root: plainRoot,
      projectName: sourceProjectName(source.file),
      seed: plainSeed,
      compression: 'none',
      expectedCut: plainSeed.cut,
      keep: false,
    });
    results.push({ name: 'compression:none (.jsonl)', ok: true, message: 'read layer 通过' });
  } catch (error) {
    results.push({ name: 'compression:none (.jsonl)', ok: false, message: error.message });
  }

  return results;
}

//---------------------------- 读写 ----------------------------

async function writeAndOpen({
  store,
  root,
  projectName,
  seed,
  compression,
  expectedCut,
  singleFrame = false,
  keep,
}) {
  const dir = path.join(root, projectName, seed.id);
  fs.mkdirSync(dir, { recursive: true });
  const filename = `session.v4.jsonl${compression === 'zstd' ? '.zstd' : ''}`;
  const file = path.join(dir, filename);

  const headerLine = `${JSON.stringify(seed.fileHeader)}\n`;
  const body = `${seed.events.map((event) => JSON.stringify(event)).join('\n')}\n`;

  if (compression === 'zstd') {
    const frames = singleFrame
      ? [zlib.zstdCompressSync(Buffer.from(headerLine + body, 'utf8'))]
      : [
          zlib.zstdCompressSync(Buffer.from(headerLine, 'utf8')),
          zlib.zstdCompressSync(Buffer.from(body, 'utf8')),
        ];
    fs.writeFileSync(file, Buffer.concat(frames));
  } else {
    fs.writeFileSync(file, headerLine + body);
  }

  try {
    const handle = await store.open(seed.id, 'read');
    try {
      const result = await handle.read();
      if (handle.inheritedEventCount !== expectedCut) {
        throw new Error(`inheritedEventCount=${handle.inheritedEventCount}，预期 ${expectedCut}`);
      }
      if (result.events.length !== expectedCut + 1) {
        throw new Error(`读回 ${result.events.length} 条事件，预期 ${expectedCut + 1}`);
      }
      if (!handle.header.isSeeded) throw new Error('读回的 header.isSeeded 不是 true');
    } finally {
      await handle.close();
    }
  } finally {
    if (!keep) fs.rmSync(dir, { recursive: true, force: true });
  }
}

//---------------------------- 解码 ----------------------------

function decodeLog(file) {
  const buffer = fs.readFileSync(file);
  let text = '';
  let badFrames = 0;

  if (file.endsWith('.zstd')) {
    let index = buffer.indexOf(ZSTD_MAGIC);
    while (index !== -1) {
      const next = buffer.indexOf(ZSTD_MAGIC, index + 4);
      const frame = buffer.subarray(index, next === -1 ? buffer.length : next);
      try {
        text += zlib.zstdDecompressSync(frame).toString('utf8');
      } catch {
        badFrames += 1;
      }
      index = next;
    }
  } else {
    text = buffer.toString('utf8');
  }

  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  if (lines.length === 0) throw new Error('空日志');

  const header = JSON.parse(lines[0]);
  const events = lines.slice(1).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`第 ${index + 1} 行不是合法 JSON: ${error.message}`);
    }
  });

  return { header, events, badFrames };
}

function assertDense(events) {
  for (const [index, event] of events.entries()) {
    if (event.seq !== index) {
      throw new Error(`事件不稠密：index=${index} seq=${event.seq}`);
    }
  }
}

//---------------------------- 环境 ----------------------------

function parseArgs(argv) {
  const options = {
    sessionsRoot: process.env.DSH_SESSIONS_ROOT || path.join(os.homedir(), '.dsh', 'sessions'),
    dshRoot: process.env.DSH_INTERNAL_ROOT,
    limitFiles: 0,
    maxBoundaries: 0,
    verbose: false,
    keep: false,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${arg} 缺少值`);
      index += 1;
      return value;
    };
    if (arg === '--sessions-root') options.sessionsRoot = path.resolve(next());
    else if (arg === '--dsh-root') options.dshRoot = path.resolve(next());
    else if (arg === '--limit-files') options.limitFiles = Number.parseInt(next(), 10);
    else if (arg === '--max-boundaries') options.maxBoundaries = Number.parseInt(next(), 10);
    else if (arg === '--verbose') options.verbose = true;
    else if (arg === '--keep') options.keep = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('用法: node scripts/spikes/dsh-fork-seed-selfcheck.mjs [--sessions-root DIR] [--dsh-root DIR]');
      console.log('      [--limit-files N] [--max-boundaries N] [--verbose] [--keep] [--json]');
      process.exit(0);
    } else throw new Error(`未知参数 ${arg}`);
  }
  return options;
}

function resolveDshRoot(explicit) {
  const candidates = [];
  if (explicit) candidates.push(explicit);
  if (process.env.DSH_INTERNAL_ROOT) candidates.push(process.env.DSH_INTERNAL_ROOT);

  const npmRoot = tryExec('npm', ['root', '-g']);
  if (npmRoot) {
    candidates.push(path.join(npmRoot, '@deepseek-ai/dsh/node_modules/@deepseek-ai'));
  }

  const nvmVersions = path.join(os.homedir(), '.nvm/versions/node');
  if (fs.existsSync(nvmVersions)) {
    for (const version of fs.readdirSync(nvmVersions).sort().reverse()) {
      candidates.push(
        path.join(nvmVersions, version, 'lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'),
      );
    }
  }

  candidates.push(path.join(os.homedir(), '.dsh/profiles/node_modules/@deepseek-ai'));

  const required = [
    'cordis/lib/index.js',
    'dsh-session/lib/index.js',
    'dsh-session-format-v3-to-v4/lib/index.js',
    'dsh-session-persistence-jsonl/lib/index.js',
  ];
  for (const candidate of candidates) {
    if (required.every((relative) => fs.existsSync(path.join(candidate, relative)))) {
      return candidate;
    }
  }
  throw new Error(
    '找不到 DSH 内部包。用 --dsh-root 指向 <dsh>/node_modules/@deepseek-ai，或设置 DSH_INTERNAL_ROOT。',
  );
}

async function loadDshModules(root) {
  const load = (relative) => import(pathToFileURL(path.join(root, relative)).href);
  const [format, session, persistence, cordis] = await Promise.all([
    load('dsh-session-format-v3-to-v4/lib/index.js'),
    load('dsh-session/lib/index.js'),
    load('dsh-session-persistence-jsonl/lib/index.js'),
    load('cordis/lib/index.js'),
  ]);
  return {
    restoreReleasedV4Artifact: format.restoreReleasedV4Artifact,
    knownEventTypes: session.KNOWN_SESSION_EVENT_TYPES,
    Persistence: persistence.default,
    Context: cordis.Context,
  };
}

function getPersistence(cache, modules, root, compression) {
  const key = `${root}:${compression}`;
  if (!cache.has(key)) {
    const ctx = new modules.Context();
    cache.set(key, new modules.Persistence(ctx, { root, compression }));
  }
  return cache.get(key);
}

function sourceProjectName(file) {
  // 目标目录必须从源日志路径推出，不按 header.cwd 重算（方案 §5.1）。
  return path.basename(path.dirname(path.dirname(file)));
}

function walkLogs(root) {
  const out = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (LOG_NAME.test(entry.name)) out.push(full);
    }
  };
  if (fs.existsSync(root)) visit(root);
  return out.sort();
}

function tryExec(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function pickControlSource(files) {
  for (const file of files) {
    try {
      const log = decodeLog(file);
      if (log.badFrames > 0 || log.header.version !== 4) continue;
      if (!log.events.some((event) => event.type === 'turn/end')) continue;
      return { file, log };
    } catch {
      // 下一份
    }
  }
  return null;
}

function recordFailure(stats, file, boundary, message) {
  stats.failures.push({ file, boundary, message });
}

function printSummary(stats, options) {
  const controlsFailed = stats.controls.filter((control) => !control.ok);
  const summary = {
    dshRoot: stats.dshRoot,
    sessionsRoot: stats.sessionsRoot,
    files: stats.files,
    seededSources: stats.seededSources,
    seededBoundaries: stats.seededBoundaries,
    boundaries: stats.boundaries,
    restored: stats.restored,
    opened: stats.opened,
    badFrames: stats.badFrames,
    failures: stats.failures,
    controls: stats.controls,
    ok: stats.failures.length === 0 && controlsFailed.length === 0,
  };

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log('\nDSH  S0 offline self-check');
  console.log(`  dsh root       ${stats.dshRoot}`);
  console.log(`  sessions root  ${stats.sessionsRoot}`);
  console.log(`  files          ${stats.files}（其中 seeded ${stats.seededSources}）`);
  console.log(`  boundaries     ${stats.boundaries}（其中 fork-of-fork ${stats.seededBoundaries}）`);
  console.log(`  restore        ${stats.restored}/${stats.boundaries}`);
  console.log(`  read layer     ${stats.opened}/${stats.boundaries}`);
  if (stats.badFrames > 0) console.log(`  bad zstd frames ${stats.badFrames}`);
  for (const control of stats.controls) {
    console.log(`  control  ${control.ok ? 'ok  ' : 'FAIL'} ${control.name} — ${control.message}`);
  }
  if (stats.failures.length > 0) {
    console.log('\n失败：');
    for (const failure of stats.failures) {
      const where = failure.boundary === null ? failure.file : `${failure.file} @${failure.boundary}`;
      console.log(`  - ${where}: ${failure.message}`);
    }
  }
}
