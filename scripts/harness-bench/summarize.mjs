/**
 * harness-bench summarizer: aggregates results/<runId>/*.json into a
 * markdown comparison report + a compact metrics JSON.
 *
 * Pass/fail is RECOMPUTED here from stored reply text rather than trusted
 * from the result files (the in-run checker has been fixed since; stored
 * verdicts from older checker versions would otherwise leak in).
 *
 * Usage: node scripts/harness-bench/summarize.mjs <runId>
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const runId = process.argv[2];
if (!runId) {
  console.error('usage: node summarize.mjs <runId>');
  process.exit(1);
}
const resultsDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'results', runId);
if (!existsSync(resultsDir)) {
  console.error(`no results dir: ${resultsDir}`);
  process.exit(1);
}

// ---- check functions (kept in sync with run-bench.mjs SCENARIOS; duplicated
// here on purpose so the summarizer never imports/executes the runner) ----
const TOOLFILE_SECRET = 'MOON-7391';
const NEEDLE_PASSWORD = 'BENCH-8271';
const NEEDLE_PASSWORD_2 = 'BENCH-4417';
const CHECKS = {
  S1: (t) => /299,?792|30万|300,?000|3[×x*]10(\^?5|⁵)/.test(t.replace(/\s/g, '')),
  S2: (t) => {
    const s = t.replace(/\s/g, '').replace(/\\[dt]?frac/g, '/').replace(/[{}]/g, '');
    return /33\/7|七分之三十三/.test(s) || /4\/5\/7/.test(s);
  },
  S3: () => true,
  S4: (t) => {
    const s = t.trim();
    if (!s.startsWith('{')) return false;
    try { JSON.parse(s); return true; } catch { return false; }
  },
  S5: (t) => t.replace(/\s/g, '').length <= 55,
  S6: (t) => t.includes(TOOLFILE_SECRET),
  S8: (t) => t.includes(NEEDLE_PASSWORD),
  S10: (t) => ['##', '|', '**', '```'].every((m) => t.includes(m)),
  S11: (t) => {
    const s = t.trim();
    return s.includes('好') && s.length <= 4;
  },
  S14: (t) => /不存在|找不到|无法|没有|no such file|not exist|ENOENT|empty/i.test(t),
  S15: (t) => t.includes(NEEDLE_PASSWORD_2),
};

// Multi-turn scenarios are graded per turn, then rolled up to one verdict.
const MULTI_TURN = {
  S9: [
    () => true,
    (t) => /42/.test(t),
    (t) => {
      const s = t.replace(/\s/g, '').toUpperCase();
      return s.includes('2499-HCNEB') || s.includes('HCNEB-2499');
    },
  ],
  S12: [
    (t) => t.includes('北京'),
    (t) => /(^|[^\d])9([^\d]|$)/.test(t.replace(/\s/g, '')),
    (t) => t.includes('成功'),
  ],
};
// Scenarios graded by executing a fixture checker after the turn. S19 is
// multi-turn but graded the same way, once per turn (see TURN_GRADED).
const GRADED = { S7: 's7', S13: 's13', S16: 's16', S17: 's17', S18: 's18', S20: 's20' };
// Multi-turn scenarios whose verdict comes from running a checker per turn
// rather than from matching the reply text.
const TURN_GRADED = { S19: 3 };

const SCENARIO_NAMES = {
  S1: '基础问答', S2: '复杂推理', S3: '最小输入开销', S4: 'JSON格式服从',
  S5: '字数上限服从', S6: '工具调用-读文件', S7: '真实代码任务', S8: '长上下文32k',
  S9: '多轮上下文', S10: 'Markdown完整性', S11: '极简回复', S12: '快问快答连发',
  S13: '多步工作任务', S14: '工具失败恢复', S15: '长上下文第二针',
  S16: '定位修复', S17: '跨文件重命名', S18: '连环缺陷修复', S19: '多轮工具任务',
  S20: '模糊需求排查',
};
// Scenarios whose cost is dominated by harness overhead rather than the model.
const OVERHEAD_SCENARIOS = ['S3', 'S11'];
const PROVIDER_ORDER = ['claude', 'codex', 'opencode', 'dsh', 'pi', 'zcode', 'omp', 'workbuddy'];

const files = readdirSync(resultsDir).filter((f) => f.endsWith('.json') && f !== 'summary.json');
const records = files.map((f) => JSON.parse(readFileSync(path.join(resultsDir, f), 'utf8')));

const median = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const mean = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
/**
 * Linearly interpolated percentile. Nearest-rank collapses to the max for the
 * 3~5 sample groups this bench produces, which would make p90 useless here.
 */
const pct = (xs, p) => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  if (v.length === 1) return v[0];
  const pos = ((v.length - 1) * p) / 100;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
};
const cv = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x));
  if (v.length < 2) return null;
  const m = mean(v);
  if (!m) return null;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
  return sd / m;
};
const fmt = (v, unit = '', digits = 0) =>
  v === null || v === undefined ? '—' : `${Number(v).toFixed(digits)}${unit}`;
const rate = (xs) => (xs.length ? `${xs.filter(Boolean).length}/${xs.length}` : '—');

// group: provider → scenario → [records]
const groups = {};
for (const r of records) {
  if (r.ok === false) continue;
  ((groups[r.provider] ??= {})[r.scenario] ??= []).push(r);
}

const usage = (r, key) => {
  const d = r.tokenUsageRaw?.data;
  if (!d) return null;
  // dsh reports all-zero usage (ACP doesn't surface tokens) → treat as no data
  let v = d.breakdown?.[key] ?? d[key] ?? null;
  // Only the 2026-10-26 run predates the ZCode reader fix, where `input` still
  // had cache.read folded into it on top of its own count. Newer runs record
  // the corrected figure, so subtracting again would corrupt them.
  if (runId === '2026-10-26T03-03-32' && r.provider === 'zcode' && key === 'input' && v > 0) {
    v -= d.cacheReadTokens ?? 0;
  }
  return v > 0 ? v : null;
};
// non-streaming providers (opencode/dsh) emit no text stream deltas — fall
// back to the stored history reply length (capped at 800 by the runner).
const textLen = (r) =>
  r.turn?.textChars > 0 ? r.turn.textChars
  : r.replyText != null ? r.replyText.length
  : (r.turns ?? []).reduce((a, t) => a + (t.textChars ?? 0), 0);
const thinkingLen = (r) => {
  if (r.turn) return (r.turn.thinkingChars ?? 0) + (r.thinkingContentChars ?? 0);
  if (r.replyText != null) return r.thinkingContentChars ?? 0;
  return (r.turns ?? []).reduce((a, t) => a + (t.thinkingChars ?? 0), 0);
};
// S9 is multi-turn: turn metrics live in a `turns` array
const turnStat = (r, key) => {
  if (r.turn?.[key] != null) return r.turn[key];
  const sum = (r.turns ?? []).reduce((acc, t) => acc + (t[key] ?? 0), 0);
  return sum > 0 ? sum : null;
};
/** How long the harness sat silent before showing any text, beyond thinking. */
const thinkingGapMs = (r) => {
  const t = r.turn ?? (r.turns ?? [])[0] ?? {};
  if (t.firstTextMs == null || t.firstThinkingMs == null) return null;
  return t.firstTextMs - t.firstThinkingMs;
};

/**
 * Per-record verdict, plus why it failed. The three failure classes are kept
 * apart because they mean different things: `error` is infrastructure (timeout,
 * crashed process), `empty` is a lost reply, `wrong` is the model answering
 * badly. Only the last one is evidence about the model.
 */
const verdict = (r) => {
  const sid = r.scenario;
  if (r.ok === false) return { pass: false, cls: 'error' };
  if (GRADED[sid]) {
    const g = r[GRADED[sid]];
    // `pass` is authoritative when the grader reported one (it folds in checks
    // like "the harness did not rewrite the checker"); stdout is the fallback
    // for records written before that field existed.
    const pass = g?.pass !== undefined ? Boolean(g.pass) : /PASS/.test(g?.stdout ?? '');
    if (pass) return { pass: true, cls: 'pass' };
    return { pass: false, cls: (r.turn?.terminal?.kind ?? 'complete') === 'complete' ? 'wrong' : 'error' };
  }
  if (TURN_GRADED[sid]) {
    const turns = r.turns ?? [];
    const pass = turns.length === TURN_GRADED[sid] && turns.every((t) => t.checkPass === true);
    if (pass) return { pass: true, cls: 'pass' };
    const ran = turns.some((t) => (t.gradeLog ?? '').trim() !== '');
    return { pass: false, cls: ran ? 'wrong' : 'error' };
  }
  if (MULTI_TURN[sid]) {
    const turns = r.turns ?? [];
    const checks = MULTI_TURN[sid];
    const pass = turns.length === checks.length
      && turns.every((t) => (t.replyText ?? '').trim() !== '')
      && checks.every((c, i) => c(turns[i].replyText ?? ''));
    if (pass) return { pass: true, cls: 'pass' };
    const emptyTurn = turns.some((t) => (t.replyText ?? '').trim() === '');
    return { pass: false, cls: emptyTurn ? 'empty' : 'wrong' };
  }
  const text = r.replyText ?? '';
  const pass = CHECKS[sid] ? CHECKS[sid](text) : null;
  if (pass) return { pass: true, cls: 'pass' };
  return { pass: false, cls: text.trim() === '' ? 'empty' : 'wrong' };
};

const cell = (rows, scenarioId) => {
  if (!rows || rows.length === 0) {
    return {
      total: null, ttft: null, pass: null, textChars: null, thinkingChars: null,
      toolUse: null, input: null, output: null, p50: null, p90: null, max: null,
      cv: null, thinkGap: null, thinkShare: null, samples: 0,
    };
  }
  const firstTurn = (r) => (r.turns ?? [])[0] ?? {};
  const totals = rows.map((r) => turnStat(r, 'totalMs'));
  const thinkChars = rows.map(thinkingLen);
  const texts = rows.map(textLen);
  const total = median(totals);
  const ttft = median(rows.map((r) => r.turn?.firstTextMs ?? firstTurn(r).firstTextMs));
  const textChars = median(texts);
  const thinkingChars = median(thinkChars);
  const toolUse = median(rows.map((r) => r.turn?.toolUseCount ?? (r.turns ?? []).reduce((a, t) => a + (t.toolUseCount ?? 0), 0)));
  const input = median(rows.map((r) => usage(r, 'input')));
  const output = median(rows.map((r) => usage(r, 'output')));
  const verdicts = rows.map(verdict);
  const pass = rate(verdicts.map((v) => v.pass));
  // Thinking share: of the characters the model produced, how many were
  // reasoning. High share with slow wall time = "thinks too much".
  const shares = rows
    .map((r, i) => (thinkChars[i] + texts[i] > 0 ? thinkChars[i] / (thinkChars[i] + texts[i]) : null))
    .filter((x) => x !== null);

  const finiteTotals = totals.filter((x) => Number.isFinite(x));

  return {
    total, ttft, pass, textChars, thinkingChars, toolUse, input, output,
    p50: median(totals), p90: pct(totals, 90), max: finiteTotals.length ? Math.max(...finiteTotals) : null,
    cv: cv(totals), thinkGap: median(rows.map(thinkingGapMs)), thinkShare: median(shares),
    samples: rows.length,
  };
};

const table = (header, rows) =>
  [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');

const providers = PROVIDER_ORDER.filter((p) => groups[p]);
const scenarios = Object.keys(SCENARIO_NAMES).filter((s) => records.some((r) => r.scenario === s));

// ---- channel table (which upstream each harness actually ran against)
const channelOf = (p) => {
  const r = (groups[p]?.[scenarios[0]] ?? [])[0];
  return r?.channel ?? '—';
};
const modelOf = (p) => {
  const rows = Object.values(groups[p] ?? {}).flat();
  const reported = rows.map((r) => r.recordedModel).find(Boolean);
  return reported ?? (p === 'dsh' ? 'profile 默认' : '—');
};
const channelRows = providers.map((p) => [
  p, channelOf(p), modelOf(p), groups[p] ? Object.values(groups[p]).flat().length : 0,
]);
const channelTable = table(['harness', '通道', '记录到的模型', '样本'], channelRows);

// ---- timing table
const timingRows = [];
for (const s of scenarios) {
  for (const metric of ['total', 'ttft']) {
    timingRows.push([
      SCENARIO_NAMES[s],
      metric === 'total' ? '总时长(ms)' : '首字TTFT(ms)',
      ...providers.map((p) => fmt(cell(groups[p][s], s)[metric])),
    ]);
  }
}
const timingTable = table(['场景', '指标', ...providers], timingRows);

// ---- tail table: median hides exactly the stalls that shape how a harness feels
const tailRows = scenarios.map((s) => [
  SCENARIO_NAMES[s],
  ...providers.map((p) => {
    const c = cell(groups[p][s], s);
    if (c.p50 === null) return '—';
    return `${fmt(c.p50)} / ${fmt(c.p90)} / ${fmt(c.max)} · cv${c.cv === null ? '—' : Math.round(c.cv * 100) + '%'}`;
  }),
]);
const tailTable = table(['场景', ...providers], tailRows);

// ---- thinking table
const thinkRows = scenarios.map((s) => [
  SCENARIO_NAMES[s],
  ...providers.map((p) => {
    const c = cell(groups[p][s], s);
    if (c.thinkShare === null && c.thinkGap === null) return '—';
    const share = c.thinkShare === null ? '—' : `${Math.round(c.thinkShare * 100)}%`;
    return `${share} · ${c.thinkGap === null ? '—' : `${fmt(c.thinkGap)}ms`}`;
  }),
]);
const thinkTable = table(['场景', ...providers], thinkRows);

// ---- quality table
const qualityRows = scenarios.map((s) => [
  SCENARIO_NAMES[s],
  ...providers.map((p) => {
    const c = cell(groups[p][s], s);
    if (OVERHEAD_SCENARIOS.includes(s)) return `${fmt(c.input)} in / ${fmt(c.output)} out`;
    if (MULTI_TURN[s]) return `${c.pass ?? '—'} · 累计${fmt(c.total)}ms`;
    return `${c.pass ?? '—'} · ${fmt(c.textChars)}字${c.thinkingChars ? ` · 思${fmt(c.thinkingChars)}` : ''}`;
  }),
]);
const qualityTable = table(['场景', ...providers], qualityRows);

// ---- overhead table
const overheadRows = providers.map((p) => {
  const c = cell(groups[p].S3 ?? [], 'S3');
  const minimal = cell(groups[p].S11 ?? [], 'S11');
  return [p, fmt(c.input), fmt(c.output), fmt(c.total), fmt(minimal.total)];
});
const overheadTable = table(['harness', 'input tokens(hi)', 'output tokens', 'hi 总时长ms', 'S11 总时长ms'], overheadRows);

// ---- failure attribution
const failureRows = providers.map((p) => {
  const all = Object.values(groups[p] ?? {}).flat();
  const failedAll = records.filter((r) => r.provider === p && r.ok === false);
  const verdicts = all.map(verdict);
  const wrong = verdicts.filter((v) => v.cls === 'wrong').length;
  const empty = verdicts.filter((v) => v.cls === 'empty').length;
  const errored = verdicts.filter((v) => v.cls === 'error').length + failedAll.length;
  const total = all.length + failedAll.length;
  return [p, String(total), String(total - wrong - empty - errored), String(empty), String(wrong), String(errored)];
});
const failureTable = table(['harness', '样本', '通过', '空回复', '答错', '运行失败'], failureRows);

const streamingMissing = providers.filter((p) => cell(groups[p].S1, 'S1').ttft === null);
const stalled = providers
  .map((p) => {
    const worst = Object.values(groups[p] ?? {}).flat()
      .map((r) => turnStat(r, 'totalMs'))
      .filter((x) => Number.isFinite(x))
      .sort((a, b) => b - a)[0];
    return { p, worst };
  })
  .filter((x) => x.worst > 60_000)
  .sort((a, b) => b.worst - a.worst);

const report = `# harness 横向对比（glm-5.3-flash）— run ${runId}

样本：常规场景 5 轮、重场景 2~3 轮，逐轮取中位数；尾部另给 p90 与最大值。
"—" = 无数据；TTFT 为 "—" 表示该 harness 没有流式帧（整段返回后一次性出字）。

## 通道（同一模型，两套服务）

${channelTable}

\`workbuddy\` 指 copilot.tencent.com（WorkBuddy 自己的上游），\`ark\` 指火山方舟。
claude 只说 anthropic messages、codex 只说 responses，这两家在 copilot 上没有可用端点；
dsh 在 copilot 上会被 \`role: developer\` 拦掉（400 code 11128）。**跨组的耗时只能读作「本机现状」，不能横向比快慢。**

## 时效（中位数 ms）

${timingTable}

## 尾部（p50 / p90 / max · 变异系数）

中位数会掩盖卡顿。同一家在同一场景里撞上一次几十秒的停顿，体感就完全变了，而中位数看不出来。

${tailTable}

## 思考（思考字符占比 · 思考开始到正文开始的间隔）

占比 = 思考字符 /（思考字符 + 正文）。间隔 = 首字出现时刻 − 首个思考增量时刻，衡量「憋」多久才出正文。

${thinkTable}

## 质量 / 输出量

pass 为程序判据重放结果（S7 / S13 / S16 / S17 / S18 / S20 = 事后运行 fixture 检查器，
其中 S16 / S18 / S20 还会校验检查器未被改写；S19 = 每轮跑一次检查器，全对才算过；
其余多轮场景 = 各轮文案判据全对才算过）。

${qualityTable}

## 最小输入开销（S3：「hi」的 input tokens ≈ system prompt + 工具定义）

${overheadTable}

无流式帧的 harness：${streamingMissing.length ? streamingMissing.join('、') : '无'}
${stalled.length ? `\n出现过单轮超过 60s 的 harness：${stalled.map((x) => `${x.p}（最差 ${Math.round(x.worst / 1000)}s）`).join('、')}` : ''}

## 失败归因

空回复 = 回合正常结束但正文为空（多为 runtime 丢输出，不是模型答错）；运行失败 = 超时 / 进程异常 / 判据执行失败。
**只有「答错」是模型的证据**，另外两类要先修产品或改判据。

${failureTable}

## 口径与已知盲区

- 每轮都新起一个 CLI 进程，所以读作「单次调用成本」，不是长会话稳态成本。
- dsh 不上报 token 用量，且不接受逐轮 model 参数——它的模型由 acp profile 固定。
- codex 的消息不带 model 字段，模型只能从其自身 rollout 的 turn_context 佐证。
- claude 的 transcript 用 anthropic 兼容层命名（\`glm-5-3-flash\`），与 \`glm-5.3-flash\` 是同一模型。
- 跨 harness 的 token 数只作量级参考：各家计法不同，缓存命中是否计入不一致。
- 只有一个模型、一台机器、一段连续时间窗口；没有置信区间，相差几百毫秒的格子都在噪声里。
`;

writeFileSync(path.join(resultsDir, 'REPORT.md'), report);
writeFileSync(path.join(resultsDir, 'summary.json'), JSON.stringify(
  Object.fromEntries(providers.map((p) => [p, Object.fromEntries(scenarios.map((s) => [s, cell(groups[p][s], s)]))])),
  null, 2,
));
console.log(report);
console.log(`\nwritten: ${resultsDir}/REPORT.md, summary.json`);
