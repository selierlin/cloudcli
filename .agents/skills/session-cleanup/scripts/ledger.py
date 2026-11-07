#!/usr/bin/env python3
"""会话清理跑批台账（append-only，只读会话库，不删不改）。

一次跑批 = 一个目录：
  ~/.memory-bank/_cleanup/<run-id>/
    run.json        范围、时间、库内计数
    ledger.jsonl    一行一个事件；同一 sid 以最后一条为准
    findings/<sid>.json  逐会话结论（子代理产出，mark 校验后落盘）
    report.md       最终总结（由本脚本全量重写，不写人工内容）
    execution.md    P 阶段的人工执行记录（报告重写不影响它）

用法:
  python3 ledger.py init [--scope archived|all] [--run-id ID] [--root DIR] [--force]
  python3 ledger.py status [--run-id ID]
  python3 ledger.py next --limit 5 [--run-id ID]
  python3 ledger.py mark --from findings/<sid>.json [--run-id ID]
  python3 ledger.py show <sid-prefix> [--run-id ID]
  python3 ledger.py sync [--run-id ID]        # 补跑批期间新归档的会话
  python3 ledger.py report [--run-id ID]

设计要点：ledger.jsonl 只追加、永不改写；上下文被压缩或中断后，
`status` + `next` 两个命令即可恢复进度，不依赖对话记忆。
"""
import argparse
import datetime as dt
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import inventory  # noqa: E402

ROOT = os.path.expanduser("~/.memory-bank/_cleanup")
EXECUTION_FILE = "execution.md"
# 报告里的固定章节。`report.md` 每次全量重写，人工写在这些标题之外的内容
# 会先迁到 execution.md，避免重跑 report 时被静默覆盖。
GENERATED_SECTIONS = (
    "## 0. 未处理（报告不完整）",
    "## 1. 秒杀区（四条全中）",
    "## 2. 无价值可删（读过全部轮次 + OV 已覆盖）",
    "## 3. 有价值 · 待沉淀（P 后写入）",
    "## 4. 有价值 · 保留（不沉淀）",
    "## 5. 阻塞",
    "## 落地（P 之后）",
    "## 附录：全部判定",
)
VERDICTS = ("kill", "discard", "sediment", "keep", "blocked")

VERDICT_ZH = {
    "kill": "秒杀",
    "discard": "无价值可删",
    "sediment": "沉淀后可删",
    "keep": "保留",
    "blocked": "阻塞",
}
READ_RE = re.compile(r"^(\d+)-(\d+)/(\d+)$")


def now():
    return dt.datetime.now().astimezone().isoformat(timespec="seconds")


def run_dir(args):
    root = os.path.expanduser(args.root or ROOT)
    if args.run_id:
        path = os.path.join(root, args.run_id)
        if not os.path.isdir(path):
            sys.exit(f"跑批不存在：{path}")
        return path
    runs = sorted(d for d in glob.glob(os.path.join(root, "*")) if os.path.isdir(d))
    if not runs:
        sys.exit(f"没有跑批记录：{root}（先执行 init）")
    return runs[-1]


def load_run(path):
    with open(os.path.join(path, "run.json"), encoding="utf-8") as f:
        return json.load(f)


def save_run(path, run):
    tmp = os.path.join(path, "run.json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(run, f, ensure_ascii=False, indent=2)
    os.replace(tmp, os.path.join(path, "run.json"))


def append(path, obj):
    with open(os.path.join(path, "ledger.jsonl"), "a", encoding="utf-8") as f:
        f.write(json.dumps(obj, ensure_ascii=False) + "\n")
        f.flush()
        os.fsync(f.fileno())


def replay(path):
    """返回 {sid: state}。状态行是全量快照，后写的覆盖先写的。"""
    state = {}
    ledger = os.path.join(path, "ledger.jsonl")
    if not os.path.exists(ledger):
        return state
    with open(ledger, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            sid = ev.get("sid")
            if not sid:
                continue
            if ev.get("ev") == "add":
                state[sid] = dict(ev, status="pending")
            elif ev.get("ev") == "verdict":
                base = state.get(sid, {"sid": sid})
                base.update(ev)
                base["status"] = "judged"
                state[sid] = base
    return state


def family_depth(state):
    """fork 深度：父先子后。父不在本批时按 0 处理。"""
    cache = {}

    def depth(sid, seen=()):
        if sid in cache:
            return cache[sid]
        parent = (state.get(sid) or {}).get("fork_parent") or ""
        if not parent or parent not in state or sid in seen:
            cache[sid] = 0
            return 0
        d = depth(parent, seen + (sid,)) + 1
        cache[sid] = d
        return d

    for sid in state:
        depth(sid)
    return cache


def bytes_of(state):
    return sum(max(0, s.get("size") or 0) for s in state.values())


def latest_pending(root):
    runs = sorted(d for d in glob.glob(os.path.join(root, "*")) if os.path.isdir(d))
    if not runs:
        return None, 0
    path = runs[-1]
    if not os.path.exists(os.path.join(path, "ledger.jsonl")):
        return None, 0
    n = sum(1 for s in replay(path).values() if s.get("status") == "pending")
    return path, n


def cmd_init(args):
    root = os.path.expanduser(args.root or ROOT)
    run_id = args.run_id or dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    path = os.path.join(root, run_id)
    db = os.path.expanduser(args.db)
    if os.path.exists(os.path.join(path, "ledger.jsonl")) and not args.force:
        sys.exit(f"已存在跑批：{path}（续跑用 status/next；重开加 --force）")
    prev, n = latest_pending(root)
    if prev and n and not args.force:
        sys.exit(f"上一轮 {os.path.basename(prev)} 还有 {n} 条未处理——先 status/next 续跑，"
                 f"确要新开加 --force")
    items, total, archived = inventory.collect(db, args.scope == "archived", None)
    exclude = set(args.exclude or [])
    items = [it for it in items if it["sid"] not in exclude]
    os.makedirs(os.path.join(path, "findings"), exist_ok=True)
    if args.force:
        for old in glob.glob(os.path.join(path, "findings", "*.json")):
            os.unlink(old)
    run = {
        "run_id": os.path.basename(path),
        "scope": args.scope,
        "db": db,
        "exclude": sorted(exclude),
        "started_at": now(),
        "inventory_at": now(),
        "db_total": total,
        "db_archived": archived,
    }
    save_run(path, run)
    with open(os.path.join(path, "ledger.jsonl"), "w", encoding="utf-8"):
        pass
    for it in items:
        append(path, {"ev": "add", "ts": now(), **it})

    print(f"跑批目录 {path}")
    print(f"范围 {args.scope} · 会话 {len(items)} 条 · 合计 {inventory.fmt_size(bytes_of({i['sid']: i for i in items}))}")
    fork_children = sum(1 for i in items if i.get("fork_parent"))
    if fork_children:
        print(f"其中 fork 子会话 {fork_children} 条（父先子后读）")


def cmd_status(args):
    path = run_dir(args)
    run = load_run(path)
    state = replay(path)
    counts = {v: 0 for v in VERDICTS}
    pending = 0
    for s in state.values():
        if s.get("status") == "pending":
            pending += 1
        elif s.get("verdict") in counts:
            counts[s["verdict"]] += 1
    print(f"run {run['run_id']} · 范围 {run['scope']} · 起始 {run['started_at']}")
    print(f"总数 {len(state)} | 未处理 {pending} | 已判定 {len(state) - pending}")
    print("  " + " · ".join(f"{VERDICT_ZH[v]} {counts[v]}" for v in VERDICTS))
    print(f"体积合计 {inventory.fmt_size(bytes_of(state))}")
    if pending:
        depth = family_depth(state)
        todo = sorted((s for s in state.values() if s.get("status") == "pending"),
                      key=lambda s: (depth.get(s["sid"], 0), -(s.get("size") or 0)))
        print("待处理 " + " ".join(s["sid"][:8] for s in todo[:12])
              + (" …" if len(todo) > 12 else ""))
    print(f"台账 {path}/ledger.jsonl")


def cmd_next(args):
    path = run_dir(args)
    state = replay(path)
    depth = family_depth(state)
    todo = sorted((s for s in state.values() if s.get("status") == "pending"),
                  key=lambda s: (depth.get(s["sid"], 0), -(s.get("size") or 0)))
    here = os.path.dirname(os.path.abspath(__file__))
    batch = []
    for s in todo[: args.limit]:
        batch.append({
            "sid": s["sid"], "provider": s.get("provider"), "project": s.get("project"),
            "name": s.get("name"), "turns": s.get("turns"), "size": s.get("size"),
            "jsonl_path": s.get("jsonl_path"), "psid": s.get("psid"),
            "fork_parent": s.get("fork_parent") or None,
            "read_cmd": read_cmd(here, s),
        })
    print(json.dumps({"remaining": len(todo), "bank_dirs": bank_dirs(), "batch": batch},
                     ensure_ascii=False))


def bank_dirs():
    """现有 memory-bank 项目目录，供子代理填写 bank:<项目> 落点。"""
    root = os.path.expanduser("~/.memory-bank")
    try:
        names = [d for d in os.listdir(root)
                 if os.path.isdir(os.path.join(root, d)) and not d.startswith(("_", "."))]
    except OSError:
        return []
    return sorted(names)


def read_cmd(here, s):
    """给子代理的精确读取命令（路径已加引号，直接可跑）。"""
    base = f"python3 {here}/extract.py"
    if s.get("jsonl_path"):
        return f'{base} "{s["jsonl_path"]}" --max 200 --start <n> --limit 5'
    db = {"zcode": "~/.zcode/cli/db/db.sqlite",
          "opencode": "~/.local/share/opencode/opencode.db"}.get(s.get("provider"), "?")
    return (f'{base} --provider zcode --db {db} --id {s.get("psid") or s["sid"]} '
            f"--max 200 --start <n> --limit 5")


def shape_errors(finding):
    """类型闸门：判定与报告都直接对字段调字符串/字典方法，形状不对必须先挡在这里。

    只校验「元素是对象、子字段是非空字符串」这一层；字段在不在、值合不合理由
    validate 的判据部分负责。`mark` 会在形状错误时就返回，让人先修形状。
    """
    if not isinstance(finding, dict):
        return [f"findings 必须是 JSON 对象，收到 {type(finding).__name__}"]
    errs = []
    for key in ("sid", "verdict", "read", "value", "reason", "keep_reason", "notes"):
        value = finding.get(key)
        if value is not None and not isinstance(value, str):
            errs.append(f"{key} 必须是字符串，收到 {type(value).__name__}")
    if "delete_after" in finding and not isinstance(finding["delete_after"], bool):
        errs.append("delete_after 必须是布尔值（true/false，不要加引号）")

    for key, fields in (
        ("evidence", ("turns", "quote")),
        ("ov", ("query", "result")),
        ("conflicts", ("with", "detail")),
    ):
        items = finding.get(key)
        if items is None:
            continue
        if not isinstance(items, list):
            errs.append(f"{key} 必须是数组，收到 {type(items).__name__}")
            continue
        for index, item in enumerate(items):
            if not isinstance(item, dict):
                errs.append(f"{key}[{index}] 必须是对象（字段 {', '.join(fields)}），"
                            f"收到 {type(item).__name__}")
                continue
            for field in fields:
                value = item.get(field)
                if not isinstance(value, str) or not value.strip():
                    errs.append(f"{key}[{index}].{field} 必须是非空字符串")

    sediments = finding.get("sediments")
    if sediments is not None:
        if not isinstance(sediments, list):
            errs.append(f"sediments 必须是数组，收到 {type(sediments).__name__}")
        else:
            for index, item in enumerate(sediments):
                if not isinstance(item, dict):
                    errs.append(f"sediments[{index}] 必须是对象（字段 kind/target/title/summary），"
                                f"收到 {type(item).__name__}")
                    continue
                for field in ("kind", "target", "title", "summary"):
                    value = item.get(field)
                    if not isinstance(value, str) or not value.strip():
                        errs.append(f"sediments[{index}].{field} 必须是非空字符串")
    return errs


def validate(finding, state_row):
    errs = shape_errors(finding)
    if errs:
        return errs

    sid = finding.get("sid") or ""
    if not sid:
        errs.append("缺 sid")
    elif state_row is None:
        errs.append(f"sid {sid} 不在本跑批台账里")

    verdict = finding.get("verdict")
    if verdict not in VERDICTS:
        errs.append(f"verdict 必须是 {VERDICTS} 之一")

    read = finding.get("read") or ""
    m = READ_RE.match(read)
    if not m:
        errs.append("read 必须写成 `起始-结束/总轮数`（例：1-28/28）")

    if verdict == "blocked":
        if not (finding.get("reason") or "").strip():
            errs.append("blocked 必须写 reason")
        return errs

    turns = state_row.get("turns", -1) if state_row else -1
    if turns < 0:
        errs.append("盘点轮数未知（turns=-1），不能判定；请先修读取或标 blocked")
    elif m:
        start, end, total = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if total != turns:
            errs.append(f"read 的总轮数 {total} 与盘点 {turns} 不一致")
        if turns == 0:
            if (start, end) != (0, 0):
                errs.append("0 轮会话的 read 必须是 0-0/0")
        elif end != turns or start != 1:
            errs.append(f"未读完全部轮次（{read}），不许判定；没读过的不进判据")

    if verdict == "kill":
        if turns != 1:
            errs.append(f"秒杀区要求真实用户轮数=1，本会话 {turns} 轮")
        if not (finding.get("reason") or "").strip():
            errs.append("kill 必须逐条写四条判据的命中情况（reason）")
        if turns > 0 and not finding.get("evidence"):
            errs.append("kill 必须给 evidence（读了哪一轮 + 原句）")
    elif verdict == "discard":
        if not (finding.get("reason") or "").strip():
            errs.append("discard 必须写 reason")
        if turns > 0 and not finding.get("ov"):
            errs.append("discard 必须至少查一次 OV 并记入 ov（query/result）")
    elif verdict == "sediment":
        if not (finding.get("value") or "").strip():
            errs.append("sediment 必须写 value（一句话价值）")
        if not finding.get("evidence"):
            errs.append("sediment 必须给 evidence（轮次 + 原句）")
        if not finding.get("sediments"):
            errs.append("sediment 必须给 sediments（kind/target/title/summary）")
        for s in finding.get("sediments") or []:
            for k in ("kind", "target", "title", "summary"):
                if not (s.get(k) or "").strip():
                    errs.append(f"sediments 缺 {k}")
            if s.get("kind") not in ("knowledge", "case", "checkpoint"):
                errs.append(f"sediments.kind 非法：{s.get('kind')}")
            target = s.get("target") or ""
            if not (target.startswith("bank:") or target.startswith("db:")):
                errs.append(f"sediments.target 必须以 bank: 或 db: 开头：{target}")
            elif target.split(":", 1)[1] in ("", "?", "knowledge", "case", "checkpoint"):
                errs.append(f"sediments.target 写的是 kind，不是落点：{target}（例：bank:cloudcli / db:03-orders.md）")
    elif verdict == "keep":
        if not (finding.get("value") or "").strip():
            errs.append("keep 必须写 value")
        if not finding.get("evidence"):
            errs.append("keep 必须给 evidence")
        if not (finding.get("keep_reason") or "").strip():
            errs.append("keep 必须写 keep_reason（为什么不沉淀/为什么留）")
    return errs


def cmd_mark(args):
    path = run_dir(args)
    src = args.from_file
    if not os.path.isabs(src):
        src = os.path.join(path, src)
    with open(src, encoding="utf-8") as f:
        finding = json.load(f)
    state = replay(path)
    sid = (finding.get("sid") or "").strip()
    row = state.get(sid)
    if row is None and len(sid) >= 8:
        matches = [s for s in state.values() if s["sid"].startswith(sid)]
        if len(matches) == 1:
            row = matches[0]
            finding["sid"] = row["sid"]
    errs = validate(finding, row)
    if errs:
        print("拒绝入库：", file=sys.stderr)
        for e in errs:
            print("  - " + e, file=sys.stderr)
        sys.exit(1)
    for s in finding.get("sediments") or []:
        target = s.get("target") or ""
        if target.startswith("bank:"):
            name = target.split(":", 1)[1]
            if not os.path.isdir(os.path.expanduser(f"~/.memory-bank/{name}")):
                print(f"⚠ bank:{name} 目录不存在——P 阶段需新建，或改到已有项目", file=sys.stderr)
    finding["ev"] = "verdict"
    finding["ts"] = now()
    append(path, finding)

    os.makedirs(os.path.join(path, "findings"), exist_ok=True)
    dst = os.path.join(path, "findings", finding["sid"] + ".json")
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(finding, f, ensure_ascii=False, indent=2)
    print(f"✓ {finding['sid'][:8]} {VERDICT_ZH[finding['verdict']]}"
          + (f" · 沉淀 {len(finding.get('sediments') or [])} 条" if finding.get("sediments") else ""))


def cmd_show(args):
    path = run_dir(args)
    state = replay(path)
    hits = [s for s in state.values() if s["sid"].startswith(args.sid)]
    if not hits:
        sys.exit("没有匹配的 sid")
    for s in hits:
        print(json.dumps(s, ensure_ascii=False, indent=2))


def cmd_sync(args):
    path = run_dir(args)
    run = load_run(path)
    state = replay(path)
    # 必须读 init 时记下的那个库：换库补扫会把两批会话混进同一份台账。
    items, _, _ = inventory.collect(os.path.expanduser(run.get("db") or args.db),
                                    run["scope"] == "archived", None)
    exclude = set(run.get("exclude") or [])
    items = [it for it in items if it["sid"] not in exclude]
    known = {s["sid"] for s in state.values()}
    added = []
    for it in items:
        if it["sid"] in known:
            continue
        append(path, {"ev": "add", "ts": now(), **it})
        added.append(it)
    # 已被移出归档区的行只做提示，不自动改判。
    gone = [s["sid"] for s in state.values()
            if s.get("status") == "pending" and s["sid"] not in {i["sid"] for i in items}]
    run["inventory_at"] = now()
    save_run(path, run)
    print(f"新增 {len(added)} 条" + ("：" + " ".join(i["sid"][:8] for i in added) if added else ""))
    if gone:
        print("注意：以下 pending 已不在当前范围（可能被移出归档）——" + " ".join(g[:8] for g in gone))


def _bullets(items, maxn=4):
    out = []
    for it in items[:maxn]:
        out.append(f"  - 第 {it.get('turns', '?')} 轮：「{it.get('quote', '')}」")
    if len(items) > maxn:
        out.append(f"  - …另 {len(items) - maxn} 处")
    return "\n".join(out)


def migrate_manual_sections(report_path):
    """Move hand-written sections out of report.md before it is regenerated.

    `report.md` is a generated artifact: every run rewrites it whole. Earlier
    runs had the P-phase execution log appended by hand, which a rerun silently
    deleted. Those sections now live in execution.md next to the report; this
    lifts any manual tail out of an existing report once, idempotently.
    """
    if not os.path.exists(report_path):
        return
    with open(report_path, encoding="utf-8") as f:
        lines = f.read().splitlines()
    start = next(
        (i for i, line in enumerate(lines)
         if line.startswith("## ") and not line.startswith(GENERATED_SECTIONS)),
        None,
    )
    if start is None:
        return
    manual = "\n".join(lines[start:]).strip()
    if not manual:
        return
    execution_path = os.path.join(os.path.dirname(report_path), EXECUTION_FILE)
    existing = ""
    if os.path.exists(execution_path):
        with open(execution_path, encoding="utf-8") as f:
            existing = f.read()
    if manual in existing:
        return
    with open(execution_path, "a", encoding="utf-8") as f:
        if existing and not existing.endswith("\n"):
            f.write("\n")
        if existing:
            f.write("\n")
        f.write(manual + "\n")
    print(f"人工执行记录已迁至 {execution_path}")


def cmd_report(args):
    path = run_dir(args)
    run = load_run(path)
    state = replay(path)
    depth = family_depth(state)
    order = sorted(state.values(), key=lambda s: (depth.get(s["sid"], 0), -(s.get("size") or 0)))
    by = {v: [s for s in order if s.get("verdict") == v] for v in VERDICTS}
    pending = [s for s in order if s.get("status") == "pending"]

    L = []
    L.append(f"# 会话清理评估报告 · {run['run_id']}\n")
    L.append(f"- 范围：`{run['scope']}` · 库内 {run['db_total']} 条 / 归档 {run['db_archived']} 条")
    L.append(f"- 本次纳入：{len(state)} 条 · 合计 {inventory.fmt_size(bytes_of(state))}")
    L.append(f"- 盘点：{run['inventory_at']} · 报告：{now()}")
    L.append(f"- 状态：未处理 {len(pending)} · "
             + " · ".join(f"{VERDICT_ZH[v]} {len(by[v])}" for v in VERDICTS) + "\n")
    L.append("> 本报告只做判定，不删会话、不写 Memory Bank / OV。")
    L.append("> P（批准）之后再执行 §落地。\n")

    if pending:
        L.append("## 0. 未处理（报告不完整）\n")
        L.append("| sid | 项目 | 轮 | 体积 |\n|---|---|---|---|")
        for s in pending:
            L.append(f"| `{s['sid'][:8]}` | {s.get('project') or '-'} | {s.get('turns')} | "
                     f"{inventory.fmt_size(s.get('size') or 0)} |")
        L.append("")

    L.append("## 1. 秒杀区（四条全中）\n")
    if not by["kill"]:
        L.append("无。\n")
    else:
        L.append("| sid | 会话 | 轮 | 体积 | 判据命中 |\n|---|---|---|---|---|")
        for s in by["kill"]:
            L.append(f"| `{s['sid'][:8]}` | {(s.get('name') or '')[:38]} | {s.get('turns')} | "
                     f"{inventory.fmt_size(s.get('size') or 0)} | {s.get('reason', '').replace(chr(10), ' ')[:60]} |")
        L.append("")

    L.append("## 2. 无价值可删（读过全部轮次 + OV 已覆盖）\n")
    if not by["discard"]:
        L.append("无。\n")
    else:
        for s in by["discard"]:
            L.append(f"### `{s['sid'][:8]}` · {(s.get('name') or '')[:50]}")
            L.append(f"- 轮次：{s.get('read')} · 体积：{inventory.fmt_size(s.get('size') or 0)}")
            L.append(f"- 理由：{s.get('reason')}")
            for q in s.get("ov") or []:
                L.append(f"- OV：`{q.get('query')}` → {q.get('result')}")
            L.append("")

    L.append("## 3. 有价值 · 待沉淀（P 后写入）\n")
    if not by["sediment"]:
        L.append("无。\n")
    else:
        for s in by["sediment"]:
            L.append(f"### `{s['sid'][:8]}` · {(s.get('name') or '')[:50]}")
            L.append(f"- {s.get('value')}")
            L.append(f"- 轮次：{s.get('read')} · 体积：{inventory.fmt_size(s.get('size') or 0)}")
            if s.get("evidence"):
                L.append("- 依据：\n" + _bullets(s["evidence"]))
            for item in s.get("sediments") or []:
                L.append(f"- **{item['kind']}** → `{item['target']}`")
                L.append(f"  - 标题：{item['title']}")
                L.append(f"  - 摘要：{item['summary']}")
            if s.get("conflicts"):
                for c in s["conflicts"]:
                    L.append(f"- ⚠️ 冲突：与 `{c.get('with')}` —— {c.get('detail')}")
            L.append("")

    L.append("## 4. 有价值 · 保留（不沉淀）\n")
    if not by["keep"]:
        L.append("无。\n")
    else:
        L.append("| sid | 会话 | 轮 | 为什么留 |\n|---|---|---|---|")
        for s in by["keep"]:
            L.append(f"| `{s['sid'][:8]}` | {(s.get('name') or '')[:34]} | {s.get('turns')} | "
                     f"{s.get('keep_reason', '').replace(chr(10), ' ')[:60]} |")
        L.append("")

    if by["blocked"]:
        L.append("## 5. 阻塞\n")
        for s in by["blocked"]:
            L.append(f"- `{s['sid'][:8]}`：{s.get('reason')}")
        L.append("")

    L.append("## 落地（P 之后）\n")
    buckets = [
        ("秒杀区", by["kill"]),
        ("无价值可删", by["discard"]),
        ("沉淀后可删", [s for s in by["sediment"] if s.get("delete_after", True)]),
    ]
    L.append("| 桶 | 条数 | 体积 |\n|---|---|---|")
    for label, rows in buckets:
        L.append(f"| {label} | {len(rows)} | {inventory.fmt_size(sum(s.get('size') or 0 for s in rows))} |")
    L.append("")
    L.append("1. 沉淀：逐条 `/session-sediment`，原料用 `findings/<sid>.json` 的 `sediments`，写完删原会话。")
    L.append("2. 删除：先快照，再 `purge.py --targets` 干跑，核对后 `--apply`。")
    L.append("3. 台账保留在本目录，作为这轮的执行账。\n")

    L.append("## 附录：全部判定\n")
    L.append("| sid | provider | 项目 | 轮 | 体积 | 判定 | 沉淀落点 |\n|---|---|---|---|---|---|---|")
    for s in order:
        targets = " / ".join(f"`{i['target']}`" for i in (s.get("sediments") or [])) or "-"
        L.append(f"| `{s['sid'][:8]}` | {s.get('provider')} | {(s.get('project') or '-')[:28]} | "
                 f"{s.get('turns')} | {inventory.fmt_size(s.get('size') or 0)} | "
                 f"{VERDICT_ZH.get(s.get('verdict'), '未判')} | {targets} |")

    out = os.path.join(path, "report.md")
    # report.md 是纯生成物：人工执行记录先迁到 execution.md，再全量重写。
    migrate_manual_sections(out)
    # 先写临时文件再替换：报告是 P 阶段删除清单的来源，半截或过期的 report.md
    # 比没有报告更危险。
    tmp = out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")
    os.replace(tmp, out)
    print(f"报告 {out}")
    print(f"总数 {len(state)} · 未处理 {len(pending)} · "
          + " · ".join(f"{VERDICT_ZH[v]} {len(by[v])}" for v in VERDICTS))


def main():
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--root", default=ROOT, help="台账根目录")
    common.add_argument("--run-id")
    common.add_argument("--db", default=inventory.DB)

    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("init", parents=[common])
    p.add_argument("--scope", default="archived", choices=["archived", "all"])
    p.add_argument("--exclude", action="append", default=None,
                   help="排除的 session_id（可重复；--scope all 时用来排除当前会话）")
    p.add_argument("--force", action="store_true")
    p.set_defaults(func=cmd_init)

    sub.add_parser("status", parents=[common]).set_defaults(func=cmd_status)

    p = sub.add_parser("next", parents=[common])
    p.add_argument("--limit", type=int, default=5)
    p.set_defaults(func=cmd_next)

    p = sub.add_parser("mark", parents=[common])
    p.add_argument("--from", dest="from_file", required=True)
    p.set_defaults(func=cmd_mark)

    p = sub.add_parser("show", parents=[common])
    p.add_argument("sid")
    p.set_defaults(func=cmd_show)

    sub.add_parser("sync", parents=[common]).set_defaults(func=cmd_sync)
    sub.add_parser("report", parents=[common]).set_defaults(func=cmd_report)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
