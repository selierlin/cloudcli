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
  python3 ledger.py land --sid X --target bank:proj --file entries/x.md --action new
  python3 ledger.py report [--run-id ID]
  python3 ledger.py result [--run-id ID] [--note ...] [--write] [--detail]
  python3 ledger.py detail [--run-id ID] [--write] [--check]   # 逐会话明细（内容+引文）

设计要点：ledger.jsonl 只追加、永不改写；上下文被压缩或中断后，
`status` + `next` 两个命令即可恢复进度，不依赖对话记忆。
"""
import argparse
import datetime as dt
import glob
import json
import os
import re
import sqlite3
import sys
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import inventory  # noqa: E402

ROOT = os.path.expanduser("~/.memory-bank/_cleanup")
EXECUTION_FILE = "execution.md"
# 报告里的固定章节。`report.md` 每次全量重写，人工写在这些标题之外的内容
# 会先迁到 execution.md，避免重跑 report 时被静默覆盖。
GENERATED_SECTIONS = (
    "## 0. 未处理（报告不完整）",
    "## 1. 秒杀区（四条全中）",
    "## 2. 无价值可删（读过全部轮次 + OV 已覆盖，或产物已在会话外载体）",
    "## 2. 无价值可删（读过全部轮次 + OV 已覆盖）",
    "## 3. 沉淀后删（点头后写入条目并删除原文）",
    "## 4. 保留（仅非归档范围）",
    "## 4. 阻塞",
    "## 5. 阻塞",
    "## 落地（点头之后）",
    "## 附录：全部判定",
    # 旧版报告的标题：重渲染时按生成物剥掉，别当成人工写在 report 里的内容。
    "## 3. 有价值 · 待沉淀（P 后写入）",
    "## 4. 有价值 · 保留（不沉淀）",
    "## 落地（P 之后）",
)
VERDICTS = ("kill", "discard", "sediment", "keep", "blocked")
# 归档范围的终态只有「删」（2026-11-12 用户口径）：沉淀后删 或 直接删。
# keep 在归档范围不合法——归档会话放着没有价值，不存在「有价值所以留着」。
ARCHIVED_VERDICTS = ("kill", "discard", "sediment", "blocked")

VERDICT_ZH = {
    "kill": "秒杀",
    "discard": "无价值可删",
    "sediment": "沉淀后删",
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
            elif ev.get("ev") == "land":
                base = state.get(sid, {"sid": sid})
                base.setdefault("lands", []).append(
                    {"target": ev.get("target"), "file": ev.get("file"),
                     "action": ev.get("action") or "new"})
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
    db = os.path.expanduser(args.db or inventory.DB)
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
    shown = ARCHIVED_VERDICTS if run["scope"] == "archived" else VERDICTS
    print("  " + " · ".join(f"{VERDICT_ZH[v]} {counts[v]}" for v in shown))
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


# 共享库 provider：没有单会话 transcript，只能按 psid 读 provider 库。
# 两库的 session/message/part 同构（inventory.py 的 SHARED_DB_PROVIDERS 同理）。
SHARED_DB_PATHS = {
    "zcode": os.path.expanduser("~/.zcode/cli/db/db.sqlite"),
    "opencode": os.path.expanduser("~/.local/share/opencode/opencode.db"),
}


def read_cmd(here, s):
    """给子代理的精确读取命令（路径已加引号，直接可跑）。

    `extract.py` 的 `--id` 分支不读 `--provider`，所以这里只保证 `--db` 正确；
    其它 provider 既没有 transcript 也没有已知的库，直接给结论性提示——不要
    让子代理去跑一条 `--db ?` 的命令，那只会换来 `no such table` 的 traceback。
    """
    base = f"python3 {here}/extract.py"
    if s.get("jsonl_path"):
        return f'{base} "{s["jsonl_path"]}" --max 200 --start <n> --limit 5'
    db = SHARED_DB_PATHS.get(s.get("provider"))
    if not db:
        return "# 无读取路径（既无 transcript 也无已知 provider 库），判 blocked"
    return (f'{base} --db "{db}" --id {s.get("psid") or s["sid"]} '
            f"--max 200 --start <n> --limit 5")


def shape_errors(finding):
    """类型闸门：判定与报告都直接对字段调字符串/字典方法，形状不对必须先挡在这里。

    只校验「元素是对象、子字段是非空字符串」这一层；字段在不在、值合不合理由
    validate 的判据部分负责。`mark` 会在形状错误时就返回，让人先修形状。
    """
    if not isinstance(finding, dict):
        return [f"findings 必须是 JSON 对象，收到 {type(finding).__name__}"]
    errs = []
    for key in ("sid", "verdict", "read", "value", "reason", "keep_reason",
                "why_not", "next_action", "carrier", "notes"):
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


def validate(finding, state_row, scope="archived"):
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
    elif scope == "archived" and verdict not in ARCHIVED_VERDICTS:
        # 归档范围没有 keep：不是「留着的理由」，而是没有留的资格。
        # 有仓库载体 → discard；有代码外信息 → sediment；读不到 → blocked。
        errs.append("归档范围不许判 keep：终态只有删（sediment 后删 / discard 直删）。"
                    "已有仓库文档/代码载体 → discard；有代码外信息 → sediment；"
                    "读不到 → blocked")

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
        # 两条合法路径：OV 已覆盖，或会话产物已落在会话外的持久载体
        # （仓库文档批注 / 迁移脚本 / 代码提交）。后者不是「能重建」——
        # 是这条会话亲手写进去了，原文再留就是重复。
        if turns > 0 and not finding.get("ov") and not finding.get("carrier"):
            errs.append("discard 必须有 ov（查过 OV）或 carrier（产物已落会话外载体）")
        if finding.get("carrier") and not (finding.get("carrier") or "").strip():
            errs.append("carrier 必须写载体路径 + 定位（例：docs/x.md 第 1446 行 ### CodeBuddy）")
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
        if scope == "archived" and finding.get("delete_after") is False:
            errs.append("归档范围不许 delete_after=false：条目落盘后原文必须删，"
                        "要留原文就不是归档会话该走的路")
    elif verdict == "keep":
        # 只在非归档范围可达。归档范围在判定闸门就拒绝 keep（见 ARCHIVED_VERDICTS）。
        # 未归档会话可以短期挂起，但长期仍必须落 sediment 或删，所以要写归口。
        if not (finding.get("value") or "").strip():
            errs.append("keep 必须写 value（这条会话在聊什么、留下了什么）")
        if not finding.get("evidence"):
            errs.append("keep 必须给 evidence")
        if not (finding.get("next_action") or "").strip():
            errs.append("keep 必须写 next_action（归口：转 sediment / 转 kill / 转 discard）")
        if not (finding.get("why_not") or "").strip():
            errs.append("keep 必须写 why_not（为什么现在不能直接沉淀或删）")
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
    errs = validate(finding, row, load_run(path).get("scope") or "archived")
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
    # delete_after=false 的会话不进删除清单，提示里别再说「沉淀后删」。
    label = VERDICT_ZH[finding["verdict"]]
    if finding["verdict"] == "sediment" and finding.get("delete_after") is False:
        label = "沉淀后留原文"
    print(f"✓ {finding['sid'][:8]} {label}"
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
    items, total, archived = inventory.collect(
        os.path.expanduser(run.get("db") or args.db or inventory.DB),
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
    # 报告头部写的是库现状；补扫后不刷新，标题会把「本次纳入 N」与旧的归档数
    # 并列，读起来像少收了几条。
    run["db_total"] = total
    run["db_archived"] = archived or 0
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


# ---- 结果块（固定骨架，四段）----------------------------------------------
# 这是给用户看的唯一形态：`result` 一次生成，SKILL 要求原样贴出，不手写。
# 结构常量集中在这里，改结构必须同时改 references/result-skeleton.md 和
# `result --check`，否则自检直接失败。
RESULT_TITLE = "结果 · {run_id} · {scope} · {count} 条 · {size}"
# 归档范围不写「保留」：库里的每一条都是待删，只差一次点头。
RESULT_TOTAL_ARCHIVED = "落地 {entries} 条目 → {files} 文件｜已删 {deleted} · 待删 {pending}"
RESULT_TOTAL_OTHER = "落地 {entries} 条目 → {files} 文件｜删除 {deleted} · 保留 {kept}"
SECTION_SESSION = "### ① 会话"
SECTION_TARGET = "### ② 落点"
SECTION_ANOMALY = "### ③ 异常"
SECTION_NOTE = "### ④ 备注"
HINT_TARGET = "*排序：条目数降序 → 落点名*"
HINT_ANOMALY = "*无则写「无」*"
HINT_NOTE = "*最多 3 条*"
COLS_SESSION = ("sid", "轮", "判定", "内容", "处置", "处置理由")
COLS_TARGET = ("落点", "条目", "沉淀什么", "文件", "新建", "更新", "来源")
COLS_ANOMALY = ("类型", "对象", "说明")
# ① 的读法是「这条讲了什么 → 处置是待删还是已删 → 凭什么这个处置」。
# 「为什么这么判定」不在这里：那是 findings/report 的事，塞进来只会把内容挤扁。
# 条目/文件/落点属于账目，归 ②。
W_SESSION = (8, 4, 12, 72, 12, 120)
R_SESSION = (False, True, False, False, False, False)
W_TARGET = (24, 6, 60, 6, 6, 6, 40)
R_TARGET = (False, True, False, True, True, True, False)
W_ANOMALY = (12, 10, 240)
R_ANOMALY = (False, False, False)
GROUP_ORDER = ("sediment", "keep", "kill", "discard", "blocked")
GROUP_ORDER_ARCHIVED = ("sediment", "kill", "discard", "blocked")
MAX_NOTES = 3


def _group_order(scope):
    """归档范围没有 keep 组，排序文字也不能写它。"""
    return GROUP_ORDER_ARCHIVED if scope == "archived" else GROUP_ORDER


def _hint_session(scope):
    return "*排序：" + "→".join(_group_order(scope)) + "，组内体积降序*"


def _counts_line(counts, scope):
    order = ARCHIVED_VERDICTS if scope == "archived" else VERDICTS
    return "判定 " + " · ".join(f"{v} {counts[v]}" for v in order)
# 宽列：不补空格、分隔行只给 `---:`，否则 240 宽的③说明列会把源码撑成横条。
WIDE_COL = 20


def _width(text):
    return sum(2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1 for ch in text)


def _clip(text, width):
    if _width(text) <= width:
        return text
    out, used = "", 0
    for ch in text:
        step = 2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1
        if used + step > width - 1:
            break
        out += ch
        used += step
    return out + "…"


def _md(text, width):
    """表格单元格：转义竖线、压掉换行，超宽才截。"""
    body = "" if text is None else str(text)
    body = body.replace("\n", " ").replace("|", "\\|")
    return _clip(body, width) if width else body


def _pad(text, width):
    """按显示宽度补空格（CJK 记 2），让源码里的竖线也对齐。"""
    return text + " " * max(0, width - _width(text))


def _row(values, widths, rights):
    """一行表格。宽列（内容/沉淀什么/说明）不补空格：补了只是几百个尾空格，
    渲染结果一样，源码反而变成竖排不了眼的横向滚动条。"""
    out = []
    for v, w in zip(values, widths):
        cell = _md(v, w)
        out.append(cell if w >= WIDE_COL else _pad(cell, w))
    return "| " + " | ".join(out) + " |"


def _sep(widths, rights):
    if not widths:
        return "| " + " | ".join("---:" if r else "---" for r in rights) + " |"
    cells = []
    for w, r in zip(widths, rights):
        if w >= WIDE_COL:
            # 宽列（文本列）不铺满宽度：GFM 的 `---` 已足够，也不给右对齐
            cells.append("---")
        else:
            cells.append(("-" * max(3, w - 1) + ":") if r else ("-" * max(3, w)))
    return "| " + " | ".join(cells) + " |"


def _live_sessions(db):
    """库内仍存在的会话 → {sid: isPinned}；库读不到返回 None（不猜）。"""
    if not os.path.exists(db):
        return None
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            return {r[0]: bool(r[1]) for r in
                    con.execute("select session_id, isPinned from sessions")}
        finally:
            con.close()
    except sqlite3.Error:
        return None


def _disposition(sid, live, verdict=None, scope="archived"):
    if live is None:
        return "-"
    if sid not in live:
        return "已删"
    if scope == "archived":
        # 归档范围只有两种在库状态：能判的都在等删除，判不了的写卡住。
        return "卡住" if verdict == "blocked" else "待删"
    return "保留(置顶)" if live[sid] else "保留"


def _delete_targets(rows, live, scope):
    """从判定行里挑出真要删的：§3 就是 purge 的目标清单，列进来等于要求删。

    归档范围全删（validate 已挡住 keep 与 delete_after=false）。非归档范围
    与 `_disposition` 同口径：置顶不删，delete_after=false 原文留作证据。
    库读不到（live=None）时无法判断置顶，保持原样列出；此时处置列也是 `-`，
    提醒这份清单没核对过在库状态。
    """
    if scope == "archived":
        return list(rows)
    return [s for s in rows
            if not (live or {}).get(s["sid"]) and s.get("delete_after") is not False]


def _one_line(text, limit):
    """把一段话压成一行：压掉换行与竖线，按句读截到 limit 显示宽度。

    截断点优先落在最近的句读处（；。，、,;），否则硬切再补「…」——半句话
    末尾带个省略号，人至少知道被截了。
    """
    body = "" if text is None else str(text)
    body = re.sub(r"\s+", " ", body.replace("|", "／")).strip()
    if _width(body) <= limit:
        return body
    cut, used = "", 0
    for ch in body:
        step = 2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1
        if used + step > limit - 1:
            break
        cut += ch
        used += step
    # 优先在最近的句读处收尾，读起来是「一句」而不是「半句」
    for sep in ("；", "。", "，", ";", ",", " "):
        i = cut.rfind(sep)
        if i >= limit // 2:
            cut = cut[:i]
            break
    return cut + "…"


def _topic(item):
    """沉淀条目的主题：标题，必要时补摘要首句。"""
    title = (item.get("title") or "").strip()
    summary = re.sub(r"\s+", " ", (item.get("summary") or "").replace("|", "／")).strip()
    if title and _width(title) <= 44:
        return title
    if title:
        return _one_line(title, 60)
    return _one_line(summary, 60)


KILL_LEAD_RE = re.compile(r"^秒杀区?[四条逐条命中：:]*")


def _session_gist(s):
    """① 内容列：这条会话到底在聊什么、留下了什么。

    优先级按「人能不能凭这一行决定删不删」排：判定的 value → 秒杀的口令 →
    保留/阻塞的说明 → 会话名。截断由列宽统一处理。
    """
    verdict = s.get("verdict")
    if verdict == "kill":
        for ev in s.get("evidence") or []:
            if (ev.get("quote") or "").strip():
                return _one_line(ev["quote"], 160)
        return _one_line(s.get("name") or "", 160)
    for key in ("value", "keep_reason", "reason"):
        if (s.get(key) or "").strip():
            return str(s[key])
    return s.get("name") or "-"


def _dispose_why(s, live, scope="archived"):
    """① 处置理由：凭什么现在是「待删 / 已删」，而不是反过来。

    只写事实，不写「与现状一致」这类复述——处置列本身已经说了它还在库里，
    理由列再说一遍等于没写。判定（verdict）与处置（disposition）是两件事：
    判定说知识上该怎么处理，处置说库里现在是什么，两者不一致就是待办缺口。
    """
    verdict = s.get("verdict")
    if live is None:
        return "库读不到"
    disp = _disposition(s["sid"], live, verdict, scope)
    n_sed = len(s.get("sediments") or [])
    n_land = len({ld["file"] for ld in (s.get("lands") or [])})
    pinned = bool(live.get(s["sid"]))
    pin = "｜isPinned=1，一并删（不需先取消置顶）" if pinned else ""
    if disp == "卡住":
        return "读取失败未判：" + _one_line(s.get("reason") or "无 reason", 80)
    if disp.startswith("待删"):
        if verdict in ("kill", "discard"):
            return f"判定该删（{verdict}），待你点头后 purge" + pin
        if verdict == "sediment":
            if n_land:
                return f"沉淀已落（{n_land} 个文件），待你点头后 purge" + pin
            return f"待沉淀（{n_sed} 条）后删" + pin
        if verdict == "keep":
            return f"短期挂起，归口：{_one_line(s.get('next_action') or '未写归口', 60)}"
        return "未判定"
    if disp.startswith("保留"):
        if disp.endswith("(置顶)"):
            return "isPinned=1：非归档范围，置顶不删"
        if verdict in ("kill", "discard"):
            return f"判定该删（{verdict}），尚未执行 purge —— 待办"
        if verdict == "sediment":
            # delete_after 先判：留档的会话落地后也不该出现「尚未 purge」，
            # 否则处置理由会跟 §4 的「原文留作证据」对着干。
            if s.get("delete_after") is False:
                return (f"delete_after=false：原文留作证据（条目已落 {n_land} 个文件）"
                        if n_land else "delete_after=false：待沉淀，原文不删")
            if n_land:
                return f"沉淀已落（{n_land} 个文件），尚未 purge —— 待办"
            return f"判定 sediment（{n_sed} 条），尚未沉淀"
        if verdict == "keep":
            return f"短期挂起，归口：{_one_line(s.get('next_action') or '未写归口', 60)}"
        if verdict == "blocked":
            return "读取失败未判：" + _one_line(s.get("reason") or "无 reason", 80)
        return "未判定"
    if disp.startswith("已删"):
        if verdict == "sediment":
            return (f"沉淀已落（{n_land} 个文件）后才删的" if n_land
                    else "无 land 记录 —— 需核对沉淀是否真落")
        if verdict in ("kill", "discard"):
            return f"判定 {verdict} 后已 purge"
        return "已在库外，判定与现状不一致 —— 需核对"
    return "未判定"


def _why(s):
    """① 为什么列：凭什么这么判、接下来归到哪。

    删掉的会话最需要这一列：人看「删了」只会问「凭什么」。秒杀的 reason
    开头是固定的「秒杀区四条逐条命中：」，剥掉这层壳，先给能区分它的那一句。
    """
    verdict = s.get("verdict")
    if verdict == "kill":
        reason = re.sub(r"\s+", " ", (s.get("reason") or "").replace("|", "／")).strip()
        head = KILL_LEAD_RE.sub("", reason)
        # 只剩壳没内容时退回 reason 本身，别把整列为空
        return _one_line(head or reason, 400)
    if verdict == "discard":
        return _one_line(s.get("reason") or "-", 400)
    if verdict == "sediment":
        titles = [i.get("title") or "" for i in s.get("sediments") or []]
        # 沉淀的「为什么」= 它凭什么值得落库：value 首句已经说明，这里给落什么
        if titles:
            return "落库：" + _one_line("；".join(titles), 380)
        return _one_line(s.get("value") or "-", 400)
    if verdict == "keep":
        why = _one_line(s.get("why_not") or s.get("keep_reason") or "-", 260)
        nxt = _one_line(s.get("next_action") or "未写归口", 120)
        return f"{why}（归口：{nxt}）"
    if verdict == "blocked":
        return _one_line(s.get("reason") or "-", 400)
    return _one_line(s.get("reason") or s.get("keep_reason") or "-", 400)


def _quote_cell(text):
    """引文进表格前压成一行（`|` 交给 _md 转义），引号原样保留。"""
    return re.sub(r"\s+", " ", "" if text is None else str(text)).strip()


def _quote_weights(rows):
    """按引文长度挑宽度：取 80 分位并夹在 [40, 88]。

    固定 60 宽会把「读到了一个什么结论」砍在半句上；按数据分布挑宽既能装下
    多数引文，又不会让某一条超长引文把整列拉成横向滚动条。
    """
    lens = sorted(_width(r["quote"]) for r in rows) or [0]
    q = lens[min(len(lens) - 1, int(len(lens) * 0.8))]
    return max(40, min(88, q))


def _detail_result(path, notes=(), db=None):
    """① 的逐会话明细：一行一条会话，证据引文单独成列。

    这是扫读视图：内容与理由仍按列宽截断，未删的全文在 findings/<sid>.json
    和 report 的对应小节里。
    """
    run = load_run(path)
    scope = run.get("scope") or "archived"
    state = replay(path)
    live = _live_sessions(os.path.expanduser(db or run.get("db") or inventory.DB))
    judged = [s for s in state.values() if s.get("status") == "judged"]
    pending = [s for s in state.values() if s.get("status") == "pending"]

    rows = []
    for verdict in _group_order(scope):
        group = sorted((s for s in judged if s.get("verdict") == verdict),
                       key=lambda s: (-(s.get("size") or 0), s["sid"]))
        for s in group:
            evidence = s.get("evidence") or []
            quote = max((_quote_cell(e.get("quote")) for e in evidence),
                        key=_width, default="")
            rows.append({"s": s, "verdict": verdict, "quote": quote,
                         "turns": " / ".join(e.get("turns") or "?" for e in evidence[:3])})

    qw = _quote_weights(rows) if rows else 60
    # 内容与理由按列宽截断：明细是扫读视图，全文在 findings 与 report 里。
    widths = (8, 4, 12, 96, 18, qw, 26, 12, 240)
    rights = (False, True, False, False, False, False, False, False, False)
    cols = ("sid", "轮", "判定", "内容（会话总结）",
            "依据轮", "证据引文", "落点", "处置", "处置理由")

    L = ["### ① 会话 · 明细（长文本按列宽截断，全文见 findings/<sid>.json）",
         _hint_session(scope).rstrip("*") + "；引文列宽随数据自适应*",
         ""]
    if rows:
        L.append(_row(cols, widths, rights))
        L.append(_sep(widths, rights))
        for r in rows:
            s = r["s"]
            targets = ",".join(sorted({i.get("target") or "-"
                                       for i in s.get("sediments") or []})) or "-"
            L.append(_row((s["sid"][:8], s.get("turns"), r["verdict"],
                           _session_gist(s), r["turns"] or "-",
                           r["quote"] or "-", targets,
                           _disposition(s["sid"], live, r["verdict"], scope),
                           _dispose_why(s, live, scope)), widths, rights))
    else:
        L.append("无")
    if pending:
        L.append("")
        L.append(f"未处理 {len(pending)} 条不在明细里："
                 + " ".join(s["sid"][:8] for s in sorted(pending, key=lambda x: x["sid"])))
    return "\n".join(L)


def cmd_ledger_check(args):
    """明细自检：同一份台账，明细行数必须等于已判定条数，且每行都有 sid。"""
    path = run_dir(args)
    scope = load_run(path).get("scope") or "archived"
    state = replay(path)
    judged = [s for s in state.values() if s.get("status") == "judged"]
    # 与 ① 同口径：归档范围的旧版 keep 行不进明细，只进 ③ 异常。
    expected = [s for s in judged
                if scope != "archived" or s.get("verdict") in ARCHIVED_VERDICTS]
    lines = _detail_result(path, db=args.db).splitlines()
    header = next((i for i, l in enumerate(lines) if l.startswith("| sid ")), None)
    rows = []
    if header is not None:
        rows = [l for l in lines[header + 2:] if l.startswith("| ")]
    problems = []
    if len(rows) != len(expected):
        problems.append(f"明细 {len(rows)} 行 vs 已判定 {len(expected)} 条")
    for s in expected:
        if s["sid"][:8] not in "\n".join(rows):
            problems.append(f"{s['sid'][:8]} 不在明细里")
    if problems:
        for p in problems:
            print("  - " + p, file=sys.stderr)
        sys.exit(1)
    print(f"明细 OK：{len(rows)} 行 = 已判定 {len(expected)} 条")


def render_result(path, notes=(), db=None):
    run = load_run(path)
    state = replay(path)
    scope = run.get("scope") or "archived"
    # db 优先级：命令行 > run.json（init 时记下的那个）> 默认库。
    # run.json 里存的是展开后的绝对路径；只有缺 db 键时才需要再展开默认值。
    live = _live_sessions(os.path.expanduser(db or run.get("db") or inventory.DB))
    judged = [s for s in state.values() if s.get("status") == "judged"]
    pending = [s for s in state.values() if s.get("status") == "pending"]
    counts = {v: sum(1 for s in judged if s.get("verdict") == v) for v in VERDICTS}

    entries_total = sum(len(s.get("sediments") or []) for s in judged)
    files_all = {land["file"] for s in judged for land in (s.get("lands") or [])}
    # 库读不到时不写 0：0 会被读成「什么都没删」，而 ① 的处置列此时是 `-`，
    # 同一份输出里两个字段对同一事实给出相反答案。统一按「不知道」写。
    # 计数必须与 ① 的行同口径：归档范围里旧版 keep 行只进 ③ 异常，
    # 不进 ①，也不该算进「待删」，否则摘要 4 条而表里 3 行。
    counted = [s for s in judged
               if scope != "archived" or s.get("verdict") in ARCHIVED_VERDICTS]
    if live is None:
        deleted = kept = "-"
    else:
        deleted = sum(1 for s in counted if s["sid"] not in live)
        # 与 ① 的处置列同口径：归档范围里在库的 blocked 行写「卡住」，不是
        # 「待删」。算进来会让摘要暗示一条还没判定的会话点头后就能删。
        # 非归档范围 _disposition 不会返回「卡住」，计数不变。
        kept = sum(1 for s in counted if s["sid"] in live
                   and _disposition(s["sid"], live, s.get("verdict"), scope) != "卡住")

    L = []
    # 三行摘要用行尾双空格硬换行，否则 markdown 会把它们并成一段。
    L.append(RESULT_TITLE.format(run_id=run["run_id"], scope=scope,
                                 count=len(state), size=inventory.fmt_size(bytes_of(state))) + "  ")
    L.append(_counts_line(counts, scope) + "  ")
    if scope == "archived":
        total = RESULT_TOTAL_ARCHIVED.format(entries=entries_total, files=len(files_all),
                                             deleted=deleted, pending=kept)
        if pending:
            total += f"｜未判定 {len(pending)} 条"
        if kept not in ("-", 0):
            total += "｜待你点头后执行沉淀 / 删除"
    else:
        total = RESULT_TOTAL_OTHER.format(entries=entries_total, files=len(files_all),
                                          deleted=deleted, kept=kept)
    L.append(total)
    L.append("")

    # ① 会话：判定组序 → 体积降序 → sid
    L.append(SECTION_SESSION)
    L.append(_hint_session(scope))
    L.append("")
    if judged:
        L.append(_row(COLS_SESSION, W_SESSION, R_SESSION))
        L.append(_sep(W_SESSION, R_SESSION))
        for verdict in _group_order(scope):
            group = sorted((s for s in judged if s.get("verdict") == verdict),
                           key=lambda s: (-(s.get("size") or 0), s["sid"]))
            for s in group:
                L.append(_row((s["sid"][:8], s.get("turns"), verdict,
                               _session_gist(s),
                               _disposition(s["sid"], live, verdict, scope),
                               _dispose_why(s, live, scope)),
                              W_SESSION, R_SESSION))
    else:
        L.append("无")
    L.append("")

    # ② 落点
    agg = {}
    for s in judged:
        for item in s.get("sediments") or []:
            slot = agg.setdefault(item.get("target") or "-",
                                  {"entries": 0, "files": set(), "new": set(),
                                   "update": set(), "sids": [], "topics": []})
            slot["entries"] += 1
            topic = _topic(item)
            if topic and topic not in slot["topics"]:
                slot["topics"].append(topic)
            if s["sid"] not in slot["sids"]:
                slot["sids"].append(s["sid"])
        for land in s.get("lands") or []:
            slot = agg.setdefault(land.get("target") or "-",
                                  {"entries": 0, "files": set(), "new": set(),
                                   "update": set(), "sids": [], "topics": []})
            slot["files"].add(land["file"])
            slot["new" if land.get("action") != "update" else "update"].add(land["file"])
            if s["sid"] not in slot["sids"]:
                slot["sids"].append(s["sid"])
    L.append(SECTION_TARGET)
    L.append(HINT_TARGET)
    L.append("")
    if not agg:
        L.append("无")
    else:
        L.append(_row(COLS_TARGET, W_TARGET, R_TARGET))
        L.append(_sep(W_TARGET, R_TARGET))
        for target, slot in sorted(agg.items(), key=lambda kv: (-kv[1]["entries"], kv[0])):
            L.append(_row((target, slot["entries"],
                           "；".join(slot["topics"]) or "-", len(slot["files"]),
                           len(slot["new"]), len(slot["update"]),
                           ",".join(s["sid"][:8] for s in
                                    sorted((state[i] for i in slot["sids"]),
                                           key=lambda s: s["sid"]))),
                          W_TARGET, R_TARGET))
    L.append("")

    # ③ 异常：固定四类，顺序不变
    L.append(SECTION_ANOMALY)
    L.append(HINT_ANOMALY)
    L.append("")
    anomalies = []
    # 置顶不再是保留理由，但删一条置顶会话仍是显式越权动作，必须在 ③ 里点名，
    # 让人在点头前看见「这条是我置顶过的」。
    for s in sorted(judged, key=lambda s: s["sid"]):
        if scope == "archived" and live and live.get(s["sid"]):
            verdict = s.get("verdict")
            if verdict != "blocked":
                anomalies.append(("置顶待删", s["sid"][:8],
                                  "isPinned=1：点头后随目标一并删，不需先取消置顶"))
    for s in sorted(judged, key=lambda s: s["sid"]):
        if scope == "archived" and s.get("verdict") == "keep":
            anomalies.append(("旧判定", s["sid"][:8],
                              "归档范围已废弃 keep：重判为 discard（有载体）或 sediment"))
    for s in sorted(judged, key=lambda s: s["sid"]):
        for c in s.get("conflicts") or []:
            anomalies.append(("冲突", s["sid"][:8],
                              f"与 {c.get('with')} 相反：{c.get('detail')}"))
    for s in sorted(judged, key=lambda s: s["sid"]):
        if s.get("verdict") == "blocked":
            anomalies.append(("阻塞", s["sid"][:8], s.get("reason") or "-"))
    for s in sorted(judged, key=lambda s: s["sid"]):
        if (s.get("verdict") == "sediment" and live and s["sid"] not in live
                and not s.get("lands")):
            anomalies.append(("沉淀待核", s["sid"][:8],
                              "判定 sediment 且已在库外，但无 land 记录 —— 沉淀可能没真落"))
    for s in sorted(pending, key=lambda s: s["sid"]):
        anomalies.append(("未处理", s["sid"][:8], "尚未判定，结果不完整"))
    if anomalies:
        L.append(_row(COLS_ANOMALY, W_ANOMALY, R_ANOMALY))
        L.append(_sep(W_ANOMALY, R_ANOMALY))
        for row in anomalies:
            L.append(_row(row, W_ANOMALY, R_ANOMALY))
    else:
        L.append("无")
    L.append("")

    # ④ 备注：外部传入，硬上限 3 条
    L.append(SECTION_NOTE)
    L.append(HINT_NOTE)
    L.append("")
    if notes:
        for note in notes:
            L.append(f"- {note}")
    else:
        L.append("无")
    return "\n".join(L)


def cmd_land(args):
    path = run_dir(args)
    state = replay(path)
    row = state.get(args.sid) or next(
        (s for s in state.values() if s["sid"].startswith(args.sid)), None)
    if row is None:
        sys.exit(f"sid {args.sid} 不在本跑批台账里")
    if row.get("status") != "judged":
        print(f"⚠ {row['sid'][:8]} 还没有判定，先 mark 再 land", file=sys.stderr)
    if args.action not in ("new", "update"):
        sys.exit("--action 只能是 new 或 update")
    append(path, {"ev": "land", "ts": now(), "sid": row["sid"],
                  "target": args.target, "file": args.file, "action": args.action})
    print(f"✓ {row['sid'][:8]} landed {args.action} · {args.target} · {args.file}")


def cmd_result(args):
    notes = list(args.note or [])
    if len(notes) > MAX_NOTES:
        sys.exit(f"备注最多 {MAX_NOTES} 条，多出的写进 execution.md")
    path = run_dir(args)
    text = render_result(path, notes, args.db)
    out_name = "result.md"
    if args.detail:
        # 明细不替换结果块：它回答的是「这条会话讲了什么」，不是账目。
        text = text + "\n\n" + _detail_result(path, db=args.db)
        out_name = "result-detail.md"
    print(text)
    if args.write:
        out = os.path.join(path, out_name)
        tmp = out + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(text + "\n")
        os.replace(tmp, out)
        print(f"\n已写入 {out}", file=sys.stderr)


def cmd_detail(args):
    path = run_dir(args)
    text = _detail_result(path, db=args.db)
    print(text)
    if args.write:
        out = os.path.join(path, "detail.md")
        tmp = out + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(text + "\n")
        os.replace(tmp, out)
        print(f"\n已写入 {out}", file=sys.stderr)


def cmd_result_check(args):
    """结构自检：改骨架忘了同步文档/样例时，这里直接失败。"""
    path = run_dir(args)
    text = render_result(path, [], args.db)
    lines = text.splitlines()
    problems = []
    want = [SECTION_SESSION, SECTION_TARGET, SECTION_ANOMALY, SECTION_NOTE]
    for header in want:
        if header not in lines:
            problems.append(f"缺小节：{header}")
    if not any(line.startswith("| ---") for line in lines):
        problems.append("没有 markdown 表格分隔行——表格不会渲染成表格")
    if len(lines) < 3 or not lines[0].startswith("结果 · "):
        problems.append("首行不是「结果 · …」")
    if problems:
        for p in problems:
            print("  - " + p, file=sys.stderr)
        sys.exit(1)
    print("结构 OK：" + " / ".join(h.lstrip("# ") for h in want))


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
    live = _live_sessions(os.path.expanduser(run.get("db") or inventory.DB))

    L = []
    L.append(f"# 会话清理评估报告 · {run['run_id']}\n")
    L.append(f"- 范围：`{run['scope']}` · 库内 {run['db_total']} 条 / 归档 {run['db_archived']} 条")
    L.append(f"- 本次纳入：{len(state)} 条 · 合计 {inventory.fmt_size(bytes_of(state))}")
    L.append(f"- 盘点：{run['inventory_at']} · 报告：{now()}")
    vorder = ARCHIVED_VERDICTS if run["scope"] == "archived" else VERDICTS
    L.append(f"- 状态：未处理 {len(pending)} · "
             + " · ".join(f"{VERDICT_ZH[v]} {len(by[v])}" for v in vorder) + "\n")
    L.append("> 本报告只做判定，不删会话、不写 Memory Bank / OV。")
    L.append("> 默认跑批到此为止；用户点头后才执行 §落地（沉淀 → 删原文）。\n")

    if pending:
        L.append("## 0. 未处理（报告不完整）\n")
        L.append("| sid | 项目 | 轮 | 体积 |\n|---|---|---|---|")
        for s in pending:
            L.append(f"| `{s['sid'][:8]}` | {s.get('project') or '-'} | {s.get('turns')} | "
                     f"{inventory.fmt_size(s.get('size') or 0)} |")
        L.append("")

    # §1-§3 就是 purge 的目标清单，一律按「处置」而不是「判定」出：非归档范围
    # 的置顶会话与 delete_after=false 不进这几节，改列 §4，免得报告一边说
    # 「置顶不删」一边把它写进删除清单。
    del_kill = _delete_targets(by["kill"], live, run["scope"])
    del_discard = _delete_targets(by["discard"], live, run["scope"])
    del_sediment = _delete_targets(by["sediment"], live, run["scope"])
    del_sids = {d["sid"] for d in del_kill + del_discard + del_sediment}
    held = [s for v in ("kill", "discard", "sediment") for s in by[v] if s["sid"] not in del_sids]

    L.append("## 1. 秒杀区（四条全中）\n")
    if not del_kill:
        L.append("无。\n")
    else:
        L.append("| sid | 会话 | 轮 | 体积 | 判据命中 |\n|---|---|---|---|---|")
        for s in del_kill:
            L.append(f"| `{s['sid'][:8]}` | {(s.get('name') or '')[:38]} | {s.get('turns')} | "
                     f"{inventory.fmt_size(s.get('size') or 0)} | {s.get('reason', '').replace(chr(10), ' ')[:60]} |")
        L.append("")

    L.append("## 2. 无价值可删（读过全部轮次 + OV 已覆盖，或产物已在会话外载体）\n")
    if not del_discard:
        L.append("无。\n")
    else:
        for s in del_discard:
            L.append(f"### `{s['sid'][:8]}` · {(s.get('name') or '')[:50]}")
            L.append(f"- 轮次：{s.get('read')} · 体积：{inventory.fmt_size(s.get('size') or 0)}")
            L.append(f"- 理由：{s.get('reason')}")
            if s.get("carrier"):
                L.append(f"- 载体：{s['carrier']}")
            for q in s.get("ov") or []:
                L.append(f"- OV：`{q.get('query')}` → {q.get('result')}")
            L.append("")

    L.append("## 3. 沉淀后删（点头后写入条目并删除原文）\n")
    if not del_sediment:
        L.append("无。\n")
    else:
        for s in del_sediment:
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

    # 归档范围没有「保留」这一节：终态只有删，留在库里的条目在 §1-§3 已经
    # 按「待删」口径列清楚了，再开一节保留只会把待办伪装成结论。
    if run["scope"] != "archived":
        retained = [(s, s.get("keep_reason") or "") for s in by["keep"]]
        for s in held:
            why = []
            if (live or {}).get(s["sid"]):
                why.append("置顶")
            if s.get("delete_after") is False:
                why.append("delete_after=false，原文留作证据")
            retained.append((s, "、".join(why)))
        L.append("## 4. 保留（仅非归档范围）\n")
        if not retained:
            L.append("无。\n")
        else:
            L.append("| sid | 会话 | 轮 | 为什么留 |\n|---|---|---|---|")
            for s, why in retained:
                L.append(f"| `{s['sid'][:8]}` | {(s.get('name') or '')[:34]} | {s.get('turns')} | "
                         f"{why.replace(chr(10), ' ')[:60]} |")
            L.append("")

    if by["blocked"]:
        blocked_no = 5 if run["scope"] != "archived" else 4
        L.append(f"## {blocked_no}. 阻塞\n")
        for s in by["blocked"]:
            L.append(f"- `{s['sid'][:8]}`：{s.get('reason')}")
        L.append("")

    L.append("## 落地（点头之后）\n")
    buckets = [
        ("秒杀区（直接删）", del_kill),
        ("无价值可删（直接删）", del_discard),
        ("沉淀后删", del_sediment),
    ]
    if run["scope"] == "archived":
        # 上面刻意不输出「保留」节，旧台账的 keep 行就只剩附录里一行判定，
        # 读起来像已定结论；单独列桶，写明它还得重判。
        buckets.append(("旧判定·需重判", by["keep"]))
    L.append("| 桶 | 条数 | 体积 |\n|---|---|---|")
    for label, rows in buckets:
        L.append(f"| {label} | {len(rows)} | {inventory.fmt_size(sum(s.get('size') or 0 for s in rows))} |")
    L.append("")
    L.append("1. 沉淀：逐条 `/session-sediment`，原料用 `findings/<sid>.json` 的 `sediments`，写完删原会话。")
    L.append("2. 删除：先快照，再 `purge.py --targets` 干跑，贴清单让用户点头，再 `--apply`。")
    if run["scope"] == "archived":
        L.append("3. 置顶会话不豁免：干跑清单的条目行会标 `pin=1`，随目标一并删。")
    else:
        L.append("3. 置顶会话不删，已归入 §4；干跑清单里若出现 `pin=1` 说明目标文件抄错了。")
    L.append("4. 台账保留在本目录，作为这轮的执行账。\n")

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
          + " · ".join(f"{VERDICT_ZH[v]} {len(by[v])}" for v in vorder))


def main():
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--root", default=ROOT, help="台账根目录")
    common.add_argument("--run-id")
    common.add_argument("--db", default=None, help="会话库路径；不传则用 run.json 记录的那个，再退回默认库")

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

    p = sub.add_parser("land", parents=[common])
    p.add_argument("--sid", required=True)
    p.add_argument("--target", required=True, help="与 findings 里的落点一致，如 bank:cloudcli")
    p.add_argument("--file", required=True, help="实际写出的文件（相对 memory-bank 或绝对路径）")
    p.add_argument("--action", default="new", choices=["new", "update"])
    p.set_defaults(func=cmd_land)

    p = sub.add_parser("result", parents=[common])
    p.add_argument("--note", action="append", default=None, help="备注，最多 3 条")
    p.add_argument("--write", action="store_true", help="同时写 result.md")
    p.add_argument("--check", action="store_true", help="只做结构自检")
    p.add_argument("--detail", action="store_true",
                   help="追加 ① 的逐会话明细（内容按列宽截断 + 证据引文）")
    p.set_defaults(func=lambda a: cmd_result_check(a) if a.check else cmd_result(a))

    p = sub.add_parser("detail", parents=[common])
    p.add_argument("--check", action="store_true", help="只做明细自检")
    p.add_argument("--write", action="store_true", help="写 detail.md")
    p.set_defaults(func=lambda a: cmd_ledger_check(a) if a.check else cmd_detail(a))

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
