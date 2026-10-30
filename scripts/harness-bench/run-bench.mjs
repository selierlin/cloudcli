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
 * Executes S1–S20 scenarios × 8 providers × N rounds, sequentially and
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
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// `BENCH_BASE` lets a run target a throwaway instance (see the deploy skill)
// without editing this file; it defaults to the daemon the app itself talks to.
const BASE = process.env.BENCH_BASE ?? 'http://127.0.0.1:3011';
const WS_BASE = `${BASE.replace(/^http/, 'ws')}/ws`;
const ROOT = '/tmp/harness-bench';
const BENCH_DIR = path.dirname(new URL(import.meta.url).pathname);

// A loose check (e.g. "at most 50 characters") is satisfied by an empty string,
// so an empty reply must never count as a pass: the runtime dropped the answer,
// the model did not comply. Same rule as summarise.mjs, which re-applies it.
const judge = (check, text) => {
  const body = text ?? '';
  return body.trim() !== '' && Boolean(check(body));
};

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

// ------------------------------------------------------- S16–S20 fixtures
// Everything below is a "real work" fixture: multi-file tree, no pointer to
// the defect, and a checker the harness is not allowed to weaken.

// S16: 18 modules, one of them wrong. check.js prints only the case index, so
// locating the defect takes read(checker) → grep(symbol) → read(candidate),
// which is what an actual repair costs. taxBase/taxRate/taxBand sit next to
// each other so a naive "read everything" pass pays for it.
const SVC_CASES = [
  ['add(2, 3)', 5],
  ['sub(9, 4)', 5],
  ['mul(6, 7)', 42],
  ['div(20, 4)', 5],
  ['round2(3.14159)', 3.14],
  ['taxBase(20000)', 18000],
  ['taxRate(2)', 0.072],
  ['taxBand(2)', 'B'],
  ['clamp(15, 0, 10)', 10],
  ['pct(25, 200)', 12.5],
  ['sumBy([1, 2, 3])', 6],
  ['avg([2, 4, 6])', 4],
  ['maxOf([3, 9, 2])', 9],
  ['minOf([3, 9, 2])', 2],
  ['fmtMoney(1234.5)', '¥1,234.50'],
  ['parseCents("¥1,234.50")', 123450],
  ['discount(200, 15)', 170],
  ['netTotal([200, 300])', 500],
];
const SVC_MODULES = {
  m01: 'module.exports = { add: (a, b) => a + b };',
  m02: 'module.exports = { sub: (a, b) => a - b };',
  m03: 'module.exports = { mul: (a, b) => a * b };',
  m04: 'module.exports = { div: (a, b) => a / b };',
  m05: 'module.exports = { round2: (v) => Math.round(v * 100) / 100 };',
  m06: 'module.exports = { taxBase: (v) => v * 0.9 };',
  // the defect: band 2 is 7.2%, not 7%
  m07: "module.exports = { taxRate: (band) => ({ 1: 0.03, 2: 0.07, 3: 0.15 }[band]) };",
  m08: "module.exports = { taxBand: (band) => ({ 1: 'A', 2: 'B', 3: 'C' }[band]) };",
  m09: 'module.exports = { clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)) };',
  m10: 'module.exports = { pct: (part, whole) => (part / whole) * 100 };',
  m11: 'module.exports = { sumBy: (xs) => xs.reduce((a, b) => a + b, 0) };',
  m12: 'module.exports = { avg: (xs) => xs.reduce((a, b) => a + b, 0) / xs.length };',
  m13: 'module.exports = { maxOf: (xs) => Math.max(...xs) };',
  m14: 'module.exports = { minOf: (xs) => Math.min(...xs) };',
  m15:
    "module.exports = { fmtMoney: (v) => '¥' + v.toFixed(2).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',') };",
  m16: "module.exports = { parseCents: (s) => Math.round(Number(String(s).replace(/[^\\d.]/g, '')) * 100) };",
  m17: 'module.exports = { discount: (v, p) => v - (v * p) / 100 };',
  m18: 'module.exports = { netTotal: (xs) => xs.reduce((a, b) => a + b, 0) };',
};
const SVC_INDEX = `const files = ${JSON.stringify(Object.keys(SVC_MODULES))};\nmodule.exports = Object.assign({}, ...files.map((f) => require('./' + f)));\n`;
const SVC_CHECK = `const C = require('./lib');\nconst cases = [\n${SVC_CASES.map(([expr]) => `  () => C.${expr},`).join('\n')}\n];\nconst want = ${JSON.stringify(SVC_CASES.map(([, v]) => v))};\nfor (let i = 0; i < want.length; i++) {\n  const got = cases[i]();\n  if (got !== want[i]) {\n    console.log('FAIL #' + (i + 1));\n    process.exit(1);\n  }\n}\nconsole.log('PASS');\n`;

// S17: rename a field across 5 files (json, two modules, test, readme). The
// test reads the field itself, so leaving any mention behind breaks the build.
const RENAME_FILES = {
  'cfg.json': `${JSON.stringify({ retries: 3 }, null, 2)}\n`,
  'src/reader.js': "const cfg = require('../cfg.json');\nmodule.exports = { attempts: () => cfg.retries };\n",
  'src/stats.js':
    "const cfg = require('../cfg.json');\nmodule.exports = { retriesLeft: (used) => cfg.retries - used };\n",
  'src/loop.js':
    "const { attempts } = require('./reader');\nmodule.exports = { run: (fn) => { for (let i = 0; i < attempts(); i++) fn(i); } };\n",
  'src/index.js': "module.exports = require('./loop');\n",
  'test/run.js':
    "const cfg = require('../cfg.json');\nconst { run } = require('../src');\nlet n = 0;\nrun(() => n++);\nconsole.log(n === cfg.retries ? 'PASS' : 'FAIL ' + n);\n",
  'README.md': '# rename 示例\n\n配置项 `retries` 控制重试次数，默认 3，取值为正整数。\n',
};
// the files that must mention the new name and no longer mention the old one
const RENAME_TOUCHED = ['cfg.json', 'src/reader.js', 'src/stats.js', 'test/run.js', 'README.md'];

// S18: two defects stacked behind an early-exit test, so the first run only
// reveals the first one — repair necessarily costs two edit→run cycles.
const TWOBUG_CALC = `const sumRange = (a, b) => {\n  let s = 0;\n  for (let i = a; i < b; i++) s += i;\n  return s;\n};\nconst avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;\nconst percent = (part, whole) => part / whole;\nmodule.exports = { sumRange, avg, percent };\n`;
const TWOBUG_TEST = `const { sumRange, avg, percent } = require('./calc');\nconst checks = [\n  ['sumRange(1,5)', sumRange(1, 5), 15],\n  ['avg([2,4,6])', avg([2, 4, 6]), 4],\n  ['percent(1,4)', percent(1, 4), 25],\n];\nfor (const [name, got, want] of checks) {\n  if (got !== want) {\n    console.log('FAIL ' + name + ': got ' + got + ' want ' + want);\n    process.exit(1);\n  }\n}\nconsole.log('PASS');\n`;

// S19: three turns on one session, each graded by running the checker against
// an expectation file that the harness never sees change between turns.
const FLOW_CONFIG = `${JSON.stringify({ timeout: 30, retries: 3 }, null, 2)}\n`;
const FLOW_CHECK = `const got = require('./config.json');\nconst want = require('./expected.json');\nconst bad = Object.keys(want).filter((k) => got[k] !== want[k]);\nif (bad.length) {\n  console.log('FAIL ' + bad.map((k) => k + ': got ' + got[k] + ' want ' + want[k]).join('; '));\n  process.exit(1);\n}\nconsole.log('PASS');\n`;
const FLOW_EXPECT = [
  { timeout: 60, retries: 3 },
  { timeout: 60, retries: 8 },
  { timeout: 60, retries: 3 },
];

// S20: the prompt says only "it won't start". Fixing the port type exposes a
// disabled flag, so the harness has to run the thing twice to finish.
const BROKEN_START = `const settings = require('./settings');\nif (typeof settings.port !== 'number' || !Number.isFinite(settings.port)) {\n  console.log('FAIL: port must be a number, got ' + typeof settings.port);\n  process.exit(1);\n}\nif (settings.enabled !== true) {\n  console.log('FAIL: service is disabled');\n  process.exit(1);\n}\nconsole.log('STARTED ' + settings.port);\n`;
const BROKEN_SETTINGS = `const config = require('./config.json');\nmodule.exports = { port: config.port, enabled: false };\n`;
const BROKEN_CONFIG = `${JSON.stringify({ port: '8080' }, null, 2)}\n`;

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
    check: (text) => /299,?792|30万|300,?000|3[×x*]10(\^?5|⁵)/.test(text.replace(/\s/g, '')),
  },
  {
    id: 'S2', name: '复杂推理', rounds: 5, timeoutMs: 240_000,
    prompt: '一项工程，甲单独做12天完成，乙单独做18天完成，丙单独做24天完成。三人合作3天后甲离开，乙和丙继续做，那么还需要多少天才能完成？请给出精确分数。',
    // models answer either 33/7 or 4 又 5/7, in plain text or LaTeX; normalise
    // \frac/\dfrac and braces before matching so the notation is not the verdict
    check: (text) => {
      const s = text.replace(/\s/g, '').replace(/\\[dt]?frac/g, '/').replace(/[{}]/g, '');
      return /33\/7|七分之三十三/.test(s) || /4\/5\/7/.test(s);
    },
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
      {
        prompt: '现在把完整编号倒序写出（保持连字符位置）。只回答倒序结果。',
        // 整串倒序（HCNEB-2499）与按段倒序（2499-HCNEB）都是「倒序」的合理读法，
        // 这个场景测的是跨轮记忆，不是读法，两种都算过
        check: (text) => {
          const s = text.replace(/\s/g, '').toUpperCase();
          return s.includes('2499-HCNEB') || s.includes('HCNEB-2499');
        },
      },
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
    // Three short questions in one session: catches harnesses that re-read or
    // re-plan the whole context on every short turn.
    id: 'S12', name: '快问快答连发', rounds: 2, timeoutMs: 180_000, multiTurn: true,
    turns: [
      { prompt: '中国的首都是哪里？只回答城市名。', check: (t) => t.includes('北京') },
      { prompt: '3 的平方是多少？只回答数字。', check: (t) => /(^|[^\d])9([^\d]|$)/.test(t.replace(/\s/g, '')) },
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
  {
    // Locate-then-fix: 18 modules, the prompt names no file and no symbol.
    // Graded by running the checker, which must also be unchanged afterwards.
    id: 'S16', name: '定位修复', rounds: 2, timeoutMs: 600_000,
    prompt: '当前目录下 svc/ 是一个小工具库。运行 node svc/check.js，它会报一个失败的用例；请找出是哪段代码不对并修好它，直到输出 PASS。不要修改 svc/check.js 或 svc/lib/index.js。完成后只回复 DONE。',
    check: null,
  },
  {
    // Multi-file consistency: one rename across json + 2 modules + test + doc.
    id: 'S17', name: '跨文件重命名', rounds: 2, timeoutMs: 420_000,
    prompt: '当前目录下 rename/ 这个模块把配置项 retries 改名为 maxRetries：配置、代码、测试和文档都要同步，全仓库不能再出现旧的拼写。改完运行 node test/run.js 确认输出 PASS。完成后只回复 DONE。',
    check: null,
  },
  {
    // Two defects behind an early-exit test: one run reveals only the first.
    id: 'S18', name: '连环缺陷修复', rounds: 2, timeoutMs: 420_000,
    prompt: '当前目录下 twobug/ 的 node test.js 会失败。请把 calc.js 修好直到 test.js 输出 PASS。不要修改 test.js。完成后只回复 DONE。',
    check: null,
  },
  {
    // Three tool turns on one session; turn 3 asks to undo only one of the two
    // earlier edits (a full revert fails), which needs the accumulated state.
    id: 'S19', name: '多轮工具任务', rounds: 2, timeoutMs: 300_000, multiTurn: true,
    turns: [
      {
        prompt: '把 app/config.json 里的 timeout 从 30 改成 60，然后运行 node app/check.js 确认输出 PASS。完成后只回复 DONE。',
        prepare: (cwd) => writeFileSync(path.join(cwd, 'app', 'expected.json'), `${JSON.stringify(FLOW_EXPECT[0])}\n`, 'utf8'),
        grade: (cwd) => runChecker(cwd, '.', 'app/check.js'),
      },
      {
        prompt: '接着把同一份配置里的 retries 改成 8，再运行 node app/check.js 确认输出 PASS。完成后只回复 DONE。',
        prepare: (cwd) => writeFileSync(path.join(cwd, 'app', 'expected.json'), `${JSON.stringify(FLOW_EXPECT[1])}\n`, 'utf8'),
        grade: (cwd) => runChecker(cwd, '.', 'app/check.js'),
      },
      {
        prompt: '现在把 retries 改回 3，timeout 保持 60 不变，再运行一次 node app/check.js。完成后只回复 DONE。',
        prepare: (cwd) => writeFileSync(path.join(cwd, 'app', 'expected.json'), `${JSON.stringify(FLOW_EXPECT[2])}\n`, 'utf8'),
        grade: (cwd) => runChecker(cwd, '.', 'app/check.js'),
      },
    ],
  },
  {
    // Vague ask: "it won't start", no symptom, no file. Two layered faults.
    id: 'S20', name: '模糊需求排查', rounds: 2, timeoutMs: 420_000,
    prompt: '当前目录下 broken/ 这个服务起不来：执行 node broken/start.js 看看怎么回事，把发现的问题修掉，直到它输出 STARTED。不要修改 broken/start.js。完成后只回复 DONE。',
    check: null,
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
    let text = '';
    let thinking = '';
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
          thinking += frame.content ?? '';
          if (firstThinkingMs === null) firstThinkingMs = now - t0;
        } else {
          textChars += len;
          text += frame.content ?? '';
          if (firstTextMs === null) firstTextMs = now - t0;
        }
      } else if (frame.kind === 'tool_use') {
        toolUseCount += 1;
      } else if (frame.kind === 'permission_request') {
        permissionCount += 1;
        ws.send(JSON.stringify({ type: 'chat.permission-response', requestId: frame.requestId, allow: true }));
      } else if (frame.kind === 'complete' || frame.kind === 'error' || frame.kind === 'protocol_error') {
        // Providers put the diagnostic in `content` (ZCode/pi emit
        // `{kind:'error', content}`), so keep it or the failure reason is lost.
        terminal = {
          kind: frame.kind,
          error: frame.error ?? null,
          content: frame.content ?? null,
          exitCode: frame.exitCode,
        };
        finish(resolve, {
          t0, firstTextMs, firstThinkingMs, totalMs: now - t0,
          textChars, thinkingChars, toolUseCount, permissionCount, terminal,
          text, thinking,
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

/**
 * The `complete` frame can arrive before the row is persisted, which used to
 * record a reply that the harness had actually produced as empty. Poll briefly
 * (outside the measured window) and take only rows appended after `baseline`,
 * so a turn that produced no text cannot inherit the previous turn's answer.
 */
const fetchTurnReply = async (sessionId, baseline) => {
  const deadline = Date.now() + 3000;
  for (;;) {
    const rows = await fetchAssistantRows(sessionId);
    const row = rows.slice(baseline).filter((r) => r.role === 'assistant' && r.kind === 'text').at(-1) ?? null;
    if ((row?.content ?? '').trim() !== '' || Date.now() >= deadline) return { row, rows };
    await new Promise((res) => setTimeout(res, 150));
  }
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
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** Runs a fixture checker in <provider>/<dir> and reports stdout + pass. */
const runChecker = (cwd, dir, entry, timeout = 60_000) => {
  const r = spawnSync('node', [entry], { cwd: path.join(cwd, dir), encoding: 'utf8', timeout });
  const stdout = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  return { stdout, pass: (r.stdout ?? '').includes('PASS') };
};

/**
 * One directory per (provider, scenario). Scenarios used to share a directory
 * per provider, which let a "rename everywhere" task rewrite another
 * scenario's leftovers — the S17 smoke did exactly that to S13's `app/`.
 */
const workDir = (provider, scenario) => `${ROOT}/${provider}/${scenario}`;

const setupFixtures = (provider, scenarioId) => {
  const cwd = workDir(provider, scenarioId);
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
  if (scenarioId === 'S16') {
    mkdirSync(path.join(cwd, 'svc', 'lib'), { recursive: true });
    for (const [name, src] of Object.entries(SVC_MODULES)) {
      writeFileSync(path.join(cwd, 'svc', 'lib', `${name}.js`), `${src}\n`, 'utf8');
    }
    writeFileSync(path.join(cwd, 'svc', 'lib', 'index.js'), SVC_INDEX, 'utf8');
    writeFileSync(path.join(cwd, 'svc', 'check.js'), SVC_CHECK, 'utf8');
  }
  if (scenarioId === 'S17') {
    for (const [rel, src] of Object.entries(RENAME_FILES)) {
      const file = path.join(cwd, 'rename', rel);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, src, 'utf8');
    }
  }
  if (scenarioId === 'S18') {
    mkdirSync(path.join(cwd, 'twobug'), { recursive: true });
    writeFileSync(path.join(cwd, 'twobug', 'calc.js'), TWOBUG_CALC, 'utf8');
    writeFileSync(path.join(cwd, 'twobug', 'test.js'), TWOBUG_TEST, 'utf8');
  }
  if (scenarioId === 'S19') {
    mkdirSync(path.join(cwd, 'app'), { recursive: true });
    writeFileSync(path.join(cwd, 'app', 'config.json'), FLOW_CONFIG, 'utf8');
    writeFileSync(path.join(cwd, 'app', 'check.js'), FLOW_CHECK, 'utf8');
  }
  if (scenarioId === 'S20') {
    mkdirSync(path.join(cwd, 'broken'), { recursive: true });
    writeFileSync(path.join(cwd, 'broken', 'start.js'), BROKEN_START, 'utf8');
    writeFileSync(path.join(cwd, 'broken', 'settings.js'), BROKEN_SETTINGS, 'utf8');
    writeFileSync(path.join(cwd, 'broken', 'config.json'), BROKEN_CONFIG, 'utf8');
  }
  return cwd;
};

const gradeS7 = (provider) => {
  const cwd = workDir(provider, 'S7');
  const r = spawnSync('node', ['sum.test.js'], { cwd, encoding: 'utf8', timeout: 30_000 });
  const result = { stdout: (r.stdout ?? '').trim(), pass: (r.stdout ?? '').includes('PASS') };
  // restore the buggy file so the next round starts from the bug again
  writeFileSync(path.join(cwd, 'sum.js'), SUM_JS, 'utf8');
  return result;
};

const gradeS13 = (provider) => {
  const cwd = workDir(provider, 'S13');
  const r = spawnSync('node', ['app/check.js'], { cwd, encoding: 'utf8', timeout: 30_000 });
  const result = { stdout: (r.stdout ?? '').trim(), pass: (r.stdout ?? '').includes('PASS') };
  // restore the pre-edit config so the next round starts from 3 again
  writeFileSync(path.join(cwd, 'app', 'config.json'), APP_CONFIG, 'utf8');
  return result;
};

/** hash of a fixture constant, to detect a harness that edits the grader */
const constHash = (src) => createHash('sha256').update(src).digest('hex');

const gradeS16 = (provider) => {
  const cwd = workDir(provider, 'S16');
  const intact =
    sha(path.join(cwd, 'svc', 'check.js')) === constHash(SVC_CHECK) &&
    sha(path.join(cwd, 'svc', 'lib', 'index.js')) === constHash(SVC_INDEX);
  const r = runChecker(cwd, 'svc', 'check.js');
  return { stdout: r.stdout, pass: r.pass && intact, checkerIntact: intact };
};

const gradeS17 = (provider) => {
  const cwd = workDir(provider, 'S17');
  const r = runChecker(cwd, 'rename', 'test/run.js');
  const stale = [];
  const missing = [];
  for (const rel of RENAME_TOUCHED) {
    const file = path.join(cwd, 'rename', rel);
    if (!existsSync(file)) { missing.push(rel); continue; }
    const s = readFileSync(file, 'utf8');
    if (/(^|[^A-Za-z])retries(?![\w])/.test(s)) stale.push(rel);
    if (!s.includes('maxRetries')) missing.push(rel);
  }
  return {
    stdout: `${r.stdout} stale=[${stale.join(',')}] missing=[${missing.join(',')}]`.trim(),
    pass: r.pass && stale.length === 0 && missing.length === 0,
    stale, missing,
  };
};

const gradeS18 = (provider) => {
  const cwd = workDir(provider, 'S18');
  const intact = sha(path.join(cwd, 'twobug', 'test.js')) === constHash(TWOBUG_TEST);
  const r = runChecker(cwd, 'twobug', 'test.js');
  return { stdout: r.stdout, pass: r.pass && intact, checkerIntact: intact };
};

const gradeS20 = (provider) => {
  const cwd = workDir(provider, 'S20');
  const intact = sha(path.join(cwd, 'broken', 'start.js')) === constHash(BROKEN_START);
  const r = spawnSync('node', ['broken/start.js'], { cwd, encoding: 'utf8', timeout: 60_000 });
  const stdout = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  return { stdout, pass: stdout.includes('STARTED 8080') && intact, checkerIntact: intact };
};

const GRADERS = { S7: gradeS7, S13: gradeS13, S16: gradeS16, S17: gradeS17, S18: gradeS18, S20: gradeS20 };

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
      const cwd = workDir(p.id, '_warmup');
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
      let baseline = 0;
      for (let i = 0; i < s.turns.length; i++) {
        const t = s.turns[i];
        // `prepare` stages what this turn should end up with; the harness never
        // sees it change, so it has to track its own edits across turns.
        if (t.prepare) t.prepare(cwd);
        const metrics = await runTurn({ sessionId, content: t.prompt, options, timeoutMs: s.timeoutMs });
        const { row: lastText, rows } = await fetchTurnReply(sessionId, baseline);
        baseline = rows.length;
        const { text: streamed, thinking: _thinking, ...turnMetrics } = metrics;
        // the row is authoritative when it exists; the stream is the fallback for
        // the window where the row has not been persisted yet
        const reply = (lastText?.content ?? '').trim() !== '' ? lastText.content : (streamed ?? '');
        const turnRecord = {
          ...turnMetrics,
          promptIndex: i,
          replyText: reply.slice(0, 500),
          recordedModel: lastText?.model ?? null,
          checkPass: t.check ? judge(t.check, reply) : null,
        };
        if (t.grade) {
          const grade = t.grade(cwd);
          turnRecord.checkPass = grade.pass;
          turnRecord.gradeLog = grade.stdout.slice(0, 200);
        }
        turns.push(turnRecord);
      }
      // cumulative session usage: multi-turn cost only makes sense as a total
      record.tokenUsageRaw = await api(`/api/providers/sessions/${sessionId}/token-usage`).catch((e) => ({ error: String(e) }));
      // roll the per-turn verdicts up so the console line and the JSON agree
      if (turns.length > 0 && turns.every((t) => typeof t.checkPass === 'boolean')) {
        record.checkPass = turns.every((t) => t.checkPass);
      }
    } else {
      const sessionId = await createSession(item.provider, cwd);
      const metrics = await runTurn({ sessionId, content: s.prompt, options, timeoutMs: s.timeoutMs });
      const { row: textRow, rows } = await fetchTurnReply(sessionId, 0);
      const thinkingRows = rows.filter((r) => r.kind === 'thinking');
      const usage = await api(`/api/providers/sessions/${sessionId}/token-usage`).catch((e) => ({ error: String(e) }));
      const { text: streamed, thinking: _thinking, ...turnMetrics } = metrics;
      const reply = (textRow?.content ?? '').trim() !== '' ? textRow.content : (streamed ?? '');

      record.replyText = reply.slice(0, 800);
      record.recordedModel = textRow?.model ?? null;
      record.checkPass = s.check ? judge(s.check, reply) : null;
      record.thinkingRows = thinkingRows.length;
      record.thinkingContentChars = thinkingRows.reduce((n, r) => n + (r.content ?? '').length, 0);
      record.tokenUsageRaw = usage;
      record.turn = turnMetrics;

      if (GRADERS[item.scenario]) {
        const grade = GRADERS[item.scenario](item.provider);
        record[item.scenario.toLowerCase()] = grade;
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
