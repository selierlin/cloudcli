#!/usr/bin/env node
// S1/S2 probe: turn a real DSH session log into a hand-built seed and ask a
// real `dsh --profile acp` child to resume it.
//
// S1 (`--question` omitted): does `session/resume` accept the seed at all?
// S2 (`--question` given): does a turn on the resumed session actually see the
// inherited history?
//
// Everything is written under a throwaway DSH_HOME: `sessions/` and `storages/`
// are private, while `profiles/` is symlinked to the real install so provider
// routes resolve. Note that resuming against an *empty* DSH_HOME fails with a
// bare `Internal error` — that is a missing provider registration, not a broken
// seed.
//
// Usage:
//   node scripts/spikes/dsh-acp-resume-probe.mjs --source <session.v4.jsonl.zstd>
//   node scripts/spikes/dsh-acp-resume-probe.mjs --source <log> --question "…"
//   node scripts/spikes/dsh-acp-resume-probe.mjs --source <log> --keep --verbose

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const PROFILE_FILES = ['.credentials.yaml', 'cordis.patch.yml', 'prompt-inject.md', '.agent-presets'];

/** Reads a DSH session log, which may be plain JSONL or concatenated zstd frames. */
function decodeLog(file) {
  const buffer = fs.readFileSync(file);
  if (!file.endsWith('.zstd')) {
    return buffer.toString('utf8');
  }
  let index = buffer.indexOf(ZSTD_MAGIC);
  let text = '';
  while (index !== -1) {
    const next = buffer.indexOf(ZSTD_MAGIC, index + 4);
    const frame = buffer.subarray(index, next === -1 ? buffer.length : next);
    try {
      text += zlib.zstdDecompressSync(frame).toString('utf8');
    } catch {
      // A frame this Node build cannot inflate is skipped, matching the reader.
    }
    index = next;
  }
  return text;
}

/**
 * Builds the seed artifact DSH itself would write for a fork: a new header with
 * `isSeeded: true`, the source events up to `boundary`, and one inherited
 * `session/end-seed` marker at the end. `parentSession` is deliberately absent —
 * ACP rejects such sessions on resume.
 */
function buildSeed(lines, boundary) {
  const fileHeader = JSON.parse(lines[0]);
  const events = lines.slice(1).map((line) => JSON.parse(line));
  const id = crypto.randomUUID();
  const header = {
    version: 4,
    id,
    createdAt: Date.now(),
    cwd: fileHeader.cwd,
    isSeeded: true,
    delegationDepth: fileHeader.delegationDepth ?? 0,
  };
  const seedEvents = events.slice(0, boundary + 1).map((event) => structuredClone(event));
  seedEvents.push({
    type: 'session/end-seed',
    seq: boundary + 1,
    time: events[boundary].time,
    data: { inherited: true },
  });
  return { id, header, events: seedEvents };
}

/** Writes the seed into the same project directory the source belongs to. */
function writeSeed(home, sourceFile, seed, compressed) {
  const projectName = path.basename(path.dirname(path.dirname(sourceFile)));
  const directory = path.join(home, 'sessions', projectName, seed.id);
  fs.mkdirSync(directory, { recursive: true });
  const headerLine = `${JSON.stringify({ type: 'session', ...seed.header })}\n`;
  const body = `${seed.events.map((event) => JSON.stringify(event)).join('\n')}\n`;
  const target = path.join(directory, compressed ? 'session.v4.jsonl.zstd' : 'session.v4.jsonl');
  // Frame 0 must hold exactly the header line; the reader rejects a frame that
  // carries header and events together.
  const payload = compressed
    ? Buffer.concat([
      zlib.zstdCompressSync(Buffer.from(headerLine, 'utf8')),
      zlib.zstdCompressSync(Buffer.from(body, 'utf8')),
    ])
    : Buffer.from(`${headerLine}${body}`, 'utf8');
  fs.writeFileSync(target, payload);
  return target;
}

/** Creates an isolated DSH_HOME that reuses the real profile (provider routes, dependencies). */
function createHome(realHome) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-resume-probe-'));
  prepareHome(home, realHome);
  return home;
}

/**
 * Fills a DSH_HOME with the private directories and links the real profile in.
 *
 * Split from `createHome` so a home that already holds an artifact (e.g. one a
 * production fork wrote) can be completed in place instead of being recreated
 * around it.
 */
function prepareHome(home, realHome) {
  fs.mkdirSync(path.join(home, 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(home, 'storages'), { recursive: true });
  const linkedProfile = path.join(home, 'profiles');
  const profiles = path.join(realHome, 'profiles');
  if (fs.existsSync(profiles) && !fs.existsSync(linkedProfile)) {
    fs.symlinkSync(profiles, linkedProfile, 'dir');
  }
  for (const name of PROFILE_FILES) {
    const source = path.join(realHome, name);
    const target = path.join(home, name);
    if (fs.existsSync(source) && !fs.existsSync(target)) {
      fs.cpSync(source, target, { recursive: true });
    }
  }
}

/** Spawns `dsh --profile acp` and exposes request/notification plumbing. */
function startAcp(dshCommand, env, onText, verbose) {
  const child = spawn(dshCommand, ['--profile', 'acp'], { stdio: ['pipe', 'pipe', 'pipe'], env });
  const pending = new Map();
  let nextId = 0;
  let buffer = '';

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      if (!line) {
        continue;
      }
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (verbose) {
        console.error(`[acp] ${line.slice(0, 200)}`);
      }
      if (message.method === 'session/update') {
        const content = message.params?.update?.content;
        if (content?.type === 'text' && typeof content.text === 'string') {
          onText(content.text);
        }
        continue;
      }
      if (typeof message.id === 'number' && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    }
  });
  child.stderr.on('data', (chunk) => {
    if (verbose) {
      process.stderr.write(`[acp] ${chunk}`);
    }
  });

  const request = (method, params, timeoutMs = 30_000) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    pending.set(id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });

  const stop = () => {
    try {
      child.kill('SIGKILL');
    } catch {
      // Already gone.
    }
  };
  return { request, stop };
}

function parseArgs(argv) {
  const options = {
    source: '',
    seed: '',
    question: '',
    afterClose: false,
    home: '',
    keep: false,
    verbose: false,
    dsh: process.env.DSH_BIN || 'dsh',
    boundary: 'last',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--source') options.source = argv[++index] ?? '';
    else if (arg === '--seed') options.seed = argv[++index] ?? '';
    else if (arg === '--question') options.question = argv[++index] ?? '';
    else if (arg === '--close-then-prompt') options.afterClose = true;
    else if (arg === '--home') options.home = argv[++index] ?? '';
    else if (arg === '--dsh') options.dsh = argv[++index] ?? 'dsh';
    else if (arg === '--boundary') options.boundary = argv[++index] ?? 'last';
    else if (arg === '--keep') options.keep = true;
    else if (arg === '--verbose') options.verbose = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
  }
  return options;
}

function printHelp() {
  console.log(`用法：
  node scripts/spikes/dsh-acp-resume-probe.mjs --source <日志> [选项]
  node scripts/spikes/dsh-acp-resume-probe.mjs --seed <产物> --home <目录> [选项]

选项：
  --source <日志>     从一份真实日志现造 seed
  --seed <产物>       直接 resume 一份已存在的产物（例如生产 DshForkProvider 写的）
  --question <文本>   resume 后追发一轮 prompt（S2）；缺省只验证 resume（S1）
  --close-then-prompt 关闭会话（P3）：断言日志不再增长，且再 prompt 被拒绝
  --boundary <n|last> 截断到第 n 个 turn/end；默认最后一个
  --home <目录>       使用给定的 DSH_HOME；默认新建临时目录
  --keep              保留临时 DSH_HOME
  --dsh <路径>        dsh 可执行文件；默认取 PATH 里的 dsh
  --verbose           打印 ACP 原始帧与 stderr
  --help              显示本帮助`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || (!options.source && !options.seed)) {
    printHelp();
    process.exit(options.help ? 0 : 1);
  }

  const realHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const home = options.home || createHome(realHome);
  if (options.home) {
    prepareHome(home, realHome);
  }

  let seed;
  let seedPath = '';
  if (options.seed) {
    if (!fs.existsSync(options.seed)) {
      throw new Error(`seed artifact not found: ${options.seed}`);
    }
    const artifactLines = decodeLog(options.seed).split('\n').filter(Boolean);
    const header = JSON.parse(artifactLines[0]);
    seed = { id: header.id, header, events: artifactLines.slice(1).map((line) => JSON.parse(line)) };
    seedPath = options.seed;
    console.log(`seed   ${seed.id}  events=${seed.events.length}  (existing artifact)`);
    console.log(`file   ${options.seed}`);
  } else {
    if (!fs.existsSync(options.source)) {
      throw new Error(`source log not found: ${options.source}`);
    }
    const lines = decodeLog(options.source).split('\n').filter(Boolean);
    const events = lines.slice(1).map((line) => JSON.parse(line));
    const turnEnds = events.filter((event) => event.type === 'turn/end').map((event) => event.seq);
    if (!turnEnds.length) {
      throw new Error('source log has no turn/end; nothing to cut at');
    }
    const boundaryIndex = options.boundary === 'last'
      ? turnEnds.length - 1
      : Number.parseInt(options.boundary, 10);
    const boundary = turnEnds[boundaryIndex];
    if (boundary === undefined) {
      throw new Error(`boundary ${options.boundary} is out of range (${turnEnds.length} turn ends)`);
    }
    seed = buildSeed(lines, boundary);
    const seedFile = writeSeed(home, options.source, seed, options.source.endsWith('.zstd'));
    seedPath = seedFile;
    console.log(`seed   ${seed.id}  boundary=${boundary}  events=${seed.events.length}`);
    console.log(`file   ${seedFile}`);
  }

  let reply = '';
  const acp = startAcp(options.dsh, { ...process.env, DSH_HOME: home }, (text) => {
    reply += text;
  }, options.verbose);

  try {
    const initialized = await acp.request('initialize', { protocolVersion: 1, clientCapabilities: {} });
    const capabilities = initialized.result?.agentCapabilities?.sessionCapabilities ?? {};
    console.log(`caps   resume=${capabilities.resume !== undefined} close=${capabilities.close !== undefined}`);

    const resumed = await acp.request('session/resume', {
      sessionId: seed.id,
      cwd: seed.header.cwd,
      mcpServers: [],
    }, 60_000);
    if (resumed.error) {
      // DSH reports most failures as a bare "Internal error"; the actionable
      // text is in `data.details`.
      const details = resumed.error.data?.details;
      throw new Error(`session/resume rejected: ${resumed.error.message}${details ? ` — ${details}` : ''}`);
    }
    const optionCount = Array.isArray(resumed.result?.configOptions) ? resumed.result.configOptions.length : 0;
    console.log(`S1     PASS  (configOptions=${optionCount})`);

    if (options.question) {
      const prompted = await acp.request('session/prompt', {
        sessionId: seed.id,
        prompt: [{ type: 'text', text: options.question }],
      }, Number(process.env.DSH_PROBE_PROMPT_TIMEOUT_MS) || 300_000);
      if (prompted.error) {
        throw new Error(`session/prompt failed: ${prompted.error.message}`);
      }
      console.log(`stop   ${prompted.result?.stopReason ?? 'unknown'}`);
      console.log('--- reply ---');
      console.log(reply.trim());
    }

    if (options.afterClose) {
      // P3: btw deletes the transcript right after closing, so the child must
      // really forget the session. Two things to prove — it stops writing, and
      // it refuses the next prompt instead of silently reopening the log.
      const closed = await acp.request('session/close', { sessionId: seed.id }, 30_000);
      if (closed.error) {
        const details = closed.error.data?.details;
        throw new Error(`session/close rejected: ${closed.error.message}${details ? ` — ${details}` : ''}`);
      }
      const sizeAtClose = fs.statSync(seedPath).size;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const sizeAfterIdle = fs.statSync(seedPath).size;
      if (sizeAfterIdle !== sizeAtClose) {
        throw new Error(`the transcript grew after close: ${sizeAtClose} -> ${sizeAfterIdle}`);
      }
      console.log(`S3     PASS  (closed; transcript idle at ${sizeAfterIdle} bytes)`);

      const again = await acp.request('session/prompt', {
        sessionId: seed.id,
        prompt: [{ type: 'text', text: 'ping' }],
      }, 60_000);
      if (!again.error) {
        throw new Error('a closed session still accepted a prompt');
      }
      const details = again.error.data?.details;
      console.log(`S3b    PASS  (prompt refused: ${again.error.message}${details ? ` — ${details}` : ''})`);
    }
  } finally {
    acp.stop();
    if (!options.keep && !options.home) {
      fs.rmSync(home, { recursive: true, force: true });
    } else {
      console.log(`home   ${home}`);
    }
  }
}

main().catch((error) => {
  console.error(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
