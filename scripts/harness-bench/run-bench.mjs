/**
 * harness-bench runner: cross-harness comparison on one shared model
 * (glm-5.3-flash).
 *
 * Channel split is dictated by what each CLI speaks, not by preference:
 * copilot.tencent.com (WorkBuddy's own upstream) only serves OpenAI chat
 * completions, so the harnesses that can talk to it run there; claude needs
 * the anthropic messages API and codex needs the responses API, so both stay
 * on volcano-ark. dsh is on ark as well: copilot rejects `role: developer`
 * outright (400 code 11128) and dsh's `compat.supportsDeveloperRole` does not
 * take effect, so its runs on copilot fail at the first request.
 * The report must keep the two groups apart — same model name, two serving
 * stacks.
 *
 * Executes S1–S15 scenarios × 8 providers × N rounds, sequentially and
 * interleaved (round → provider → scenario) so server-side load drift hits
 * every provider evenly. Metrics come from chat websocket frame timestamps:
 * TTFT (first text/thinking delta), total turn time, channel char counts,
 * plus token usage read back over REST.
 *
 * Results are one JSON file per turn under results/<runId>/, so an
 * interrupted run resumes by skipping already-present files.
 *
 * Usage:
 *   node scripts/harness-bench/run-bench.mjs              # full run
 *   node scripts/harness-bench/run-bench.mjs --smoke      # 1 round, S1/S3/S4 only
 *   node scripts/harness-bench/run-bench.mjs --providers codex,pi --scenarios S1,S4
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const BASE = 'http://127.0.0.1:3011';
const WS_BASE = 'ws://127.0.0.1:3011/ws';
const ROOT = '/tmp/harness-bench';
const BENCH_DIR = path.dirname(new URL(import.meta.url).pathname);

// ---------------------------------------------------------------- CLI args
const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(name);
const csvOpt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1]?.split(',').filter(Boolean) : undefined;
};
const SMOKE = hasFlag('--smoke');
const RUN_ID = (() => {
  const i = args.indexOf('--run-id');
  return i >= 0 ? args[i + 1] : undefined;
})();
const NO_WARMUP = hasFlag('--no-warmup');
const ONLY_PROVIDERS = csvOpt('--providers');
const ONLY_SCENARIOS = csvOpt('--scenarios');
const ROUND_OVERRIDE = (() => {
  const i = args.indexOf('--rounds');
  return i >= 0 ? Number(args[i + 1]) : undefined;
})();

// -------------------------------------------------------------- providers
// effort only where the harness exposes a switch for this model; the
// intersection across codex/pi/omp/workbuddy is `high`. dsh ignores the
// per-turn model entirely — it runs whatever the acp profile pins, so its
// entry stays null and `~/.dsh/profiles/acp/cordis.patch.yml` must point at
// volcano-ark/glm-5.3-flash for the duration of a run.
const PROVIDERS = [
  { id: 'claude', channel: 'ark', model: 'glm-5.3-flash', effort: null },
  { id: 'codex', channel: 'ark', model: 'glm-5.3-flash', effort: 'high' },
  { id: 'opencode', channel: 'workbuddy', model: 'workbuddy/glm-5.3-flash', effort: null },
  { id: 'dsh', channel: 'ark', model: null, effort: null },
  { id: 'pi', channel: 'workbuddy', model: 'workbuddy/glm-5.3-flash', effort: 'high' },
  { id: 'zcode', channel: 'workbuddy', model: 'workbuddy/glm-5.3-flash', effort: null },
  { id: 'omp', channel: 'workbuddy', model: 'workbuddy/glm-5.3-flash', effort: 'high' },
  { id: 'workbuddy', channel: 'workbuddy', model: 'glm-5.3-flash', effort: 'high' },
];

// -------------------------------------------------------------- scenarios
// rounds: 5 default; expensive scenarios (S7 real code task, S8 32k context) 3.
const TOOLFILE_SECRET = 'MOON-7391';
const NEEDLE_PASSWORD = 'BENCH-8271';
const NEEDLE_PASSWORD_2 = 'BENCH-4417';
const FORGET_CODE = 'BENCH-9942';
// S13 fixture: the agent has to read a config, edit one field, then run a
// checker — the closest thing here to an actual work task, so the cost of
// "thinking a lot" shows up in wall time rather than in token count.
const APP_CONFIG = `${JSON.stringify({ name: 'bench', retries: 3 }, null, 2)}\n`;
const CHECK_JS = `const c = require('./config.json');\nconsole.log(c.retries === 5 ? 'PASS' : 'FAIL: ' + c.retries);\n`;

const buildLongText = () => {
  const lines = [];
  for (let i = 1; i <= 420; i++) {
    lines.push(
      `第${i}段：这是一段用于填充上下文窗口的说明文字。数据条目 ${i} 的取值为 ${(i * 37) % 1000}，` +
        `状态标记为 ${i % 7 === 0 ? '活跃' : '休眠'}，备注字段记录了第 ${i} 批次在运输过程中的温度、湿度与交接时间。`
    );
    if (i === 260) lines.push(`在这一批次的交接单上写着一行醒目的机密密码：${NEEDLE_PASSWORD}。请妥善保管。`);
    if (i === 410) lines.push(`末尾一批的封条编号是普通的 ${i}，另附一个备用密码：${NEEDLE_PASSWORD_2}，仅在主密码失效时启用。`);
  }
  return lines.join('\n');
};
const LONG_TEXT = buildLongText();

const SUM_JS = `function sumRange(a, b) {\n  let s = 0;\n  for (let i = a; i < b; i++) s += i;\n  return s;\n}\nmodule.exports = { sumRange };\n`;
const SUM_TEST = `const { sumRange } = require('./sum.js');\nconsole.log(sumRange(1, 5) === 15 ? 'PASS' : 'FAIL: ' + sumRange(1, 5));\n`;

const SCENARIOS = [
  {
    id: 'S1', name: '基础问答', rounds: 5, timeoutMs: 120_000,
    prompt: '光在真空中的速度大约是多少千米每秒？只回答数字和单位，不要解释。',
    check: (text) => /299,?792|30万|300000|3[×x*]10(\^?5|⁵)/.test(text.replace(/\s/g, '')),
  },
  {
    id: 'S2', name: '复杂推理', rounds: 5, timeoutMs: 240_000,
    prompt: '一项工程，甲单独做12天完成，乙单独做18天完成，丙单独做24天完成。三人合作3天后甲离开，乙和丙继续做，那么还需要多少天才能完成？请给出精确分数。',
    check: (text) => /\\frac\{33\}\{7\}|33\/7|4又5\/7|七分之三十三/.test(text.replace(/\s/g, '')),
  },
  { id: 'S3', name: '最小输入开销', rounds: 5, timeoutMs: 120_000, prompt: 'hi', check: () => true },
  {
    id: 'S4', name: 'JSON格式服从', rounds: 5, timeoutMs: 120_000,
    prompt: '把下面的信息转换成一个 JSON 对象，只输出 JSON 本身，不要输出任何其他文字或代码块标记：姓名张三，年龄30，城市北京，职业工程师。',
    check: (text) => {
      const t = text.trim();
      if (!t.startsWith('{')) return false;
      try { JSON.parse(t); return true; } catch { return false; }
    },
  },
  {
    id: 'S5', name: '字数上限服从', rounds: 5, timeoutMs: 120_000,
    prompt: '用不超过50个字介绍长城。只输出介绍内容本身。',
    check: (text) => text.replace(/\s/g, '').length <= 55,
  },
  {
    id: 'S6', name: '工具调用-读文件', rounds: 5, timeoutMs: 180_000,
    prompt: '当前目录下有一个 toolfile.txt 文件，读取它并告诉我里面记录的口令是什么。只回答口令内容。',
    check: (text) => text.includes(TOOLFILE_SECRET),
  },
  {
    id: 'S7', name: '真实代码任务', rounds: 3, timeoutMs: 300_000,
    prompt: '当前目录下 sum.js 的 sumRange(a, b) 函数有 bug：它应该返回 a 到 b（含两端）的整数和，但现在结果不对。请修复它，然后运行 node sum.test.js 确认输出 PASS。完成后只回复 DONE。',
    check: null, // graded by running the test after the turn
  },
  {
    id: 'S8', name: '长上下文32k', rounds: 3, timeoutMs: 300_000,
    prompt: LONG_TEXT + '\n\n上面文章中提到的机密密码是什么？只回答密码本身。',
    check: (text) => text.includes(NEEDLE_PASSWORD),
  },
  {
    id: 'S9', name: '多轮上下文', rounds: 5, timeoutMs: 240_000, multiTurn: true,
    turns: [
      { prompt: `请记住这个编号：${FORGET_CODE}。只需回复“已记住”。`, check: () => true },
      { prompt: '我刚才告诉你的编号的最后两位是什么？只回答那两位数字。', check: (text) => /42/.test(text) },
      { prompt: '现在把完整编号倒序写出（保持连字符位置）。只回答倒序结果。', check: (text) => text.replace(/\s/g, '').toUpperCase().includes('2499-HCNEB') },
    ],
  },
  {
    id: 'S10', name: 'Markdown完整性', rounds: 5, timeoutMs: 120_000,
    prompt: '用 Markdown 输出以下内容，不要任何额外解释：一个二级标题“语言一览”；一个表格，表头为 语言|首发年份，两行数据 Python|1991、Rust|2010；一段同时包含 **加粗** 和 `行内代码` 的文字；一个 python 代码块，内容是 print("hello")。',
    check: (text) => ['##', '|', '**', '```'].every((m) => text.includes(m)),
  },
  {
    // The floor of the fixed cost: one token of content requested. Anything
    // above a few hundred ms here is startup + system prompt, not the model.
    id: 'S11', name: '极简回复', rounds: 4, timeoutMs: 120_000,
    prompt: '只回复一个字：好',
    check: (text) => {
      const t = text.trim();
      return t.includes('好') && t.length <= 4;
    },
  },
  {
    // Five short questions in one session: catches harnesses that re-read or
    // re-plan the whole context on every short turn.
    id: 'S12', name: '快问快答连发', rounds: 2, timeoutMs: 180_000, multiTurn: true,
    turns: [
      { prompt: '中国的首都是哪里？只回答城市名。', check: (t) => t.includes('北京') },
      { prompt: '3 的平方是多少？只回答数字。', check: (t) => t.replace(/\s/g, '') === '9' },
      { prompt: 'HTTP 200 状态码表示什么？只回答两个字。', check: (t) => t.includes('成功') },
    ],
  },
  {
    // Read → edit → run → report. Graded by executing the checker, like S7,
    // but with one more hop so the "keeps thinking on real work" behaviour
    // shows up as wall time.
    id: 'S13', name: '多步工作任务', rounds: 2, timeoutMs: 480_000,
    prompt: '当前目录下 app/config.json 里的 retries 当前是 3。请把它改成 5，然后运行 node app/check.js 确认输出 PASS。完成后只回复 DONE。',
    check: null, // graded by running the checker after the turn
  },
  {
    // Recovery from a tool failure: the file does not exist and the honest
    // answer must say so instead of inventing contents.
    id: 'S14', name: '工具失败恢复', rounds: 3, timeoutMs: 180_000,
    prompt: '当前目录下有一个 missing.txt 文件，读取它的第一行并告诉我。只回答那一行的内容。',
    check: (text) => /不存在|找不到|无法|没有|no such file|not exist|ENOENT|empty/i.test(text),
  },
  {
    // Second needle, placed in the last tenth of the text: the first needle is
    // the one S8 asks for, so a harness that over-compresses loses this one.
    id: 'S15', name: '长上下文第二针', rounds: 2, timeoutMs: 300_000,
    prompt: LONG_TEXT + '\n\n上面文章中提到的「备用密码」是什么？只回答密码本身。',
    check: (text) => text.includes(NEEDLE_PASSWORD_2),
  },
];

// ---------------------------------------------------------------- helpers
const token = execFileSync('node', ['scripts/mint-auth-token.mjs', '--stdout'], {
  cwd: path.resolve(BENCH_DIR, '../..'),
  encoding: 'utf8',
}).trim();

const api = async (reqPath, options = {}) => {
  const res = await fetch(`${BASE}${reqPath}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${reqPath} → HTTP ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  return body;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs one chat turn over the websocket. Auto-approves permission requests
 * (claude emits them for file reads/edits). Collects per-frame timings.
 */
function runTurn({ sessionId, content, options, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}?token=${encodeURIComponent(token)}`);
    const t0 = Date.now();
    let firstTextMs = null;
    let firstThinkingMs = null;
    let lastFrameMs = t0;
    let textChars = 0;
    let thinkingChars = 0;
    let toolUseCount = 0;
    let permissionCount = 0;
    let terminal = null;

    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error(`turn timeout after ${timeoutMs}ms (frames=${toolUseCount + textChars + thinkingChars ? 'partial' : 0})`));
    }, timeoutMs);

    const finish = (fn, arg) => {
      clearTimeout(timer);
      try { ws.close(); } catch {}
      fn(arg);
    };

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'chat.send', sessionId, content, options }));
    };
    ws.onmessage = (event) => {
      let frame;
      try { frame = JSON.parse(event.data); } catch { return; }
      const now = Date.now();
      lastFrameMs = now;

      if (frame.kind === 'stream_delta') {
        const len = (frame.content ?? '').length;
        if (frame.streamChannel === 'thinking') {
          thinkingChars += len;
          if (firstThinkingMs === null) firstThinkingMs = now - t0;
        } else {
          textChars += len;
          if (firstTextMs === null) firstTextMs = now - t0;
        }
      } else if (frame.kind === 'tool_use') {
        toolUseCount += 1;
      } else if (frame.kind === 'permission_request') {
        permissionCount += 1;
        ws.send(JSON.stringify({ type: 'chat.permission-response', requestId: frame.requestId, allow: true }));
      } else if (frame.kind === 'complete' || frame.kind === 'error' || frame.kind === 'protocol_error') {
        terminal = { kind: frame.kind, error: frame.error ?? null, exitCode: frame.exitCode };
        finish(resolve, {
          t0, firstTextMs, firstThinkingMs, totalMs: now - t0,
          textChars, thinkingChars, toolUseCount, permissionCount, terminal,
        });
      }
    };
    ws.onerror = () => finish(reject, new Error('websocket error'));
    ws.onclose = (event) => {
      if (!terminal) finish(reject, new Error(`websocket closed prematurely (code ${event.code})`));
    };
  });
}

const createSession = async (provider, cwd) => {
  const body = await api('/api/providers/sessions', {
    method: 'POST',
    body: JSON.stringify({ provider, projectPath: cwd, initialMessage: '' }),
  });
  const sessionId = (body.data ?? body).sessionId;
  if (!sessionId) throw new Error('create session failed: ' + JSON.stringify(body).slice(0, 200));
  return sessionId;
};

const fetchAssistantRows = async (sessionId) => {
  const body = await api(`/api/providers/sessions/${sessionId}/messages?pageMode=rows&limit=200`);
  return ((body.data ?? body).messages ?? []);
};

const turnOptions = (p) => {
  const options = {};
  if (p.model) options.model = p.model;
  if (p.effort) options.effort = p.effort;
  // workbuddy in -p mode has no interactive approver: `default`/`acceptEdits`/
  // `plan` wait for one forever (Read is auto-allowed, which is why S6 passed
  // while S7 timed out). `auto` is the mode the app now ships as the workbuddy
  // default — it approves in-process, keeps the guardrail, and is what the
  // benchmark should measure. Every other provider runs with approvals
  // effectively bypassed, so this keeps the footing equal.
  if (p.id === 'workbuddy') options.permissionMode = 'auto';
  return options;
};

// -------------------------------------------------------------- fixtures
const setupFixtures = (provider, scenarioId) => {
  const cwd = `${ROOT}/${provider}`;
  mkdirSync(cwd, { recursive: true });
  if (scenarioId === 'S6') {
    writeFileSync(path.join(cwd, 'toolfile.txt'), `本次巡检口令：${TOOLFILE_SECRET}\n`, 'utf8');
  }
  if (scenarioId === 'S7') {
    writeFileSync(path.join(cwd, 'sum.js'), SUM_JS, 'utf8');
    writeFileSync(path.join(cwd, 'sum.test.js'), SUM_TEST, 'utf8');
  }
  if (scenarioId === 'S13') {
    mkdirSync(path.join(cwd, 'app'), { recursive: true });
    writeFileSync(path.join(cwd, 'app', 'config.json'), APP_CONFIG, 'utf8');
    writeFileSync(path.join(cwd, 'app', 'check.js'), CHECK_JS, 'utf8');
  }
  return cwd;
};

const gradeS7 = (provider) => {
  const cwd = `${ROOT}/${provider}`;
  const r = spawnSync('node', ['sum.test.js'], { cwd, encoding: 'utf8', timeout: 30_000 });
  const result = { stdout: (r.stdout ?? '').trim(), pass: (r.stdout ?? '').includes('PASS') };
  // restore the buggy file so the next round starts from the bug again
  writeFileSync(path.join(cwd, 'sum.js'), SUM_JS, 'utf8');
  return result;
};

const gradeS13 = (provider) => {
  const cwd = `${ROOT}/${provider}`;
  const r = spawnSync('node', ['app/check.js'], { cwd, encoding: 'utf8', timeout: 30_000 });
  const result = { stdout: (r.stdout ?? '').trim(), pass: (r.stdout ?? '').includes('PASS') };
  // restore the pre-edit config so the next round starts from 3 again
  writeFileSync(path.join(cwd, 'app', 'config.json'), APP_CONFIG, 'utf8');
  return result;
};

// ------------------------------------------------------------------ main
const runId = RUN_ID ?? new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const resultsDir = path.join(BENCH_DIR, 'results', runId);
mkdirSync(resultsDir, { recursive: true });
console.log(`bench run ${runId} → ${resultsDir}`);

const providers = ONLY_PROVIDERS ? PROVIDERS.filter((p) => ONLY_PROVIDERS.includes(p.id)) : PROVIDERS;
let scenarios = ONLY_SCENARIOS ? SCENARIOS.filter((s) => ONLY_SCENARIOS.includes(s.id)) : SCENARIOS;
if (SMOKE) scenarios = scenarios.filter((s) => ['S1', 'S3', 'S4'].includes(s.id));

// execution plan: [ {provider, scenario, round} ] interleaved round → provider → scenario
const roundsOf = (s) => ROUND_OVERRIDE ?? (SMOKE ? 1 : s.rounds);
const plan = [];
const maxRounds = Math.max(...scenarios.map((s) => roundsOf(s)));
for (let round = 1; round <= maxRounds; round++) {
  for (const p of providers) {
    for (const s of scenarios) {
      if (round <= roundsOf(s)) plan.push({ provider: p.id, scenario: s.id, round });
    }
  }
}

const resultFile = (provider, scenarioId, round, turn = 0) =>
  path.join(resultsDir, `${provider}_${scenarioId}_r${round}${turn ? `_t${turn}` : ''}.json`);

const pending = plan.filter((item) => !existsSync(resultFile(item.provider, item.scenario, item.round)));
console.log(`plan: ${plan.length} turns, ${pending.length} pending, ${plan.length - pending.length} already done`);
const tBegin = Date.now();

// warmup: one discarded minimal turn per provider (bridge spawn, first connect)
if (!SMOKE && !NO_WARMUP && pending.length > 0) {
  for (const p of providers) {
    if (!pending.some((x) => x.provider === p.id)) continue;
    process.stdout.write(`warmup ${p.id} ... `);
    try {
      const cwd = `${ROOT}/${p.id}`;
      mkdirSync(cwd, { recursive: true });
      const sessionId = await createSession(p.id, cwd);
      await runTurn({ sessionId, content: 'hi', options: turnOptions(p), timeoutMs: 120_000 });
      console.log('ok');
    } catch (err) {
      console.log('failed: ' + String(err.message ?? err).slice(0, 100));
    }
  }
}

let done = 0;
for (const item of pending) {
  const p = providers.find((x) => x.id === item.provider);
  const s = SCENARIOS.find((x) => x.id === item.scenario);
  const label = `${item.provider}/${item.scenario}/r${item.round}`;
  process.stdout.write(`[${++done}/${pending.length}] ${label} ... `);

  const record = {
    runId, provider: item.provider, scenario: item.scenario, round: item.round,
    requestedModel: p.model, channel: p.channel, effort: p.effort, startedAt: new Date().toISOString(),
  };

  try {
    const cwd = setupFixtures(item.provider, item.scenario);
    const options = turnOptions(p);
    const turns = [];

    if (s.multiTurn) {
      const sessionId = await createSession(item.provider, cwd);
      for (let i = 0; i < s.turns.length; i++) {
        const t = s.turns[i];
        const metrics = await runTurn({ sessionId, content: t.prompt, options, timeoutMs: s.timeoutMs });
        const rows = await fetchAssistantRows(sessionId);
        const lastText = rows.filter((r) => r.role === 'assistant' && r.kind === 'text').at(-1);
        const turnRecord = {
          ...metrics,
          promptIndex: i,
          replyText: (lastText?.content ?? '').slice(0, 500),
          recordedModel: lastText?.model ?? null,
          checkPass: t.check(lastText?.content ?? ''),
        };
        turns.push(turnRecord);
      }
    } else {
      const sessionId = await createSession(item.provider, cwd);
      const metrics = await runTurn({ sessionId, content: s.prompt, options, timeoutMs: s.timeoutMs });
      const rows = await fetchAssistantRows(sessionId);
      const textRow = rows.filter((r) => r.role === 'assistant' && r.kind === 'text').at(-1);
      const thinkingRows = rows.filter((r) => r.kind === 'thinking');
      const usage = await api(`/api/providers/sessions/${sessionId}/token-usage`).catch((e) => ({ error: String(e) }));

      record.replyText = (textRow?.content ?? '').slice(0, 800);
      record.recordedModel = textRow?.model ?? null;
      record.checkPass = s.check ? s.check(textRow?.content ?? '') : null;
      record.thinkingRows = thinkingRows.length;
      record.thinkingContentChars = thinkingRows.reduce((n, r) => n + (r.content ?? '').length, 0);
      record.tokenUsageRaw = usage;
      record.turn = metrics;

      if (item.scenario === 'S7') {
        const grade = gradeS7(item.provider);
        record.s7 = grade;
        record.checkPass = grade.pass;
      }
      if (item.scenario === 'S13') {
        const grade = gradeS13(item.provider);
        record.s13 = grade;
        record.checkPass = grade.pass;
      }
    }

    record.turns = turns;
    record.ok = true;
    console.log(`ok ${record.turn?.totalMs ?? turns.at(-1)?.totalMs ?? '?'}ms ttft=${record.turn?.firstTextMs ?? '-'}ms pass=${record.checkPass}`);
  } catch (err) {
    record.ok = false;
    record.error = String(err.message ?? err).slice(0, 300);
    console.log('FAIL ' + record.error);
  }

  writeFileSync(resultFile(item.provider, item.scenario, item.round), JSON.stringify(record, null, 2));

  // small gap so consecutive turns never queue within the same millisecond
  await sleep(500);
}

console.log(`\nbench done in ${Math.round((Date.now() - tBegin) / 1000)}s → ${resultsDir}`);
