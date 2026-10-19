#!/usr/bin/env python3
"""按 provider 抽取会话对话脉络（只读）。

用法:
  python3 extract.py <a.jsonl> [b.jsonl ...] [--provider auto|...] [--max N]
                     [--start 1] [--limit 8]
  python3 extract.py --provider zcode --id sess_xxxx [--id sess_yyyy] [--db PATH]

输出每轮 USER 首行与末答，用于快速判断一条会话的内容与价值。

分批/分片读取：一次可给多个路径（小会话成批读）；--start/--limit 按轮切片
（长会话逐片读，避免一次灌满上下文）。--limit 0（默认）＝不限。
"""
import argparse
import json
import os
import sqlite3
import sys

HOME = os.path.expanduser("~")
ZCODE_DB = os.path.join(HOME, ".zcode/cli/db/db.sqlite")

_USER_KEY = {"input_text", "text"}
_AGENT_KEY = {"output_text", "text", "Text"}


def _join_blocks(content, kinds):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for b in content:
            if isinstance(b, dict) and b.get("type") in kinds:
                t = b.get("text") or ""
                if t.strip():
                    parts.append(t)
        return "\n".join(parts)
    return ""


def _noise(text):
    t = (text or "").strip()
    if not t:
        return True
    if t.startswith("<") or t.startswith("Caveat:"):
        return True
    if "tool_result" in t[:30] or "environment_context" in t[:80]:
        return True
    return False


def detect_provider(path, sample=120):
    """按文件前若干行嗅探 provider。"""
    for i, line in enumerate(open(path, errors="ignore")):
        if i >= sample:
            break
        line = line.strip()
        if not line:
            continue
        try:
            o = json.loads(line)
        except Exception:
            continue
        t = o.get("type")
        if t == "event_msg":
            return "codex"
        if t == "message" and "role" in o:
            return "workbuddy"
        if t == "message" and isinstance(o.get("message"), dict) and "role" in o["message"]:
            return "pi"
        if t in ("user", "assistant") and isinstance(o.get("message"), dict):
            return "claude"
    return "generic"


def parse_jsonl(path, provider):
    """返回 [(user, [agent_text, ...]), ...]（只含真实用户轮）。"""
    turns = []
    cur_user = None
    agents = []
    seen = set()

    def flush():
        if cur_user is not None:
            turns.append((cur_user, agents[:]))

    for line in open(path, errors="ignore"):
        line = line.strip()
        if not line:
            continue
        try:
            o = json.loads(line)
        except Exception:
            continue

        if provider == "codex":
            if o.get("type") != "event_msg":
                continue
            pl = o.get("payload") or {}
            if pl.get("type") != "item_completed":
                continue
            it = pl.get("item") or {}
            ty = it.get("type")
            if ty == "UserMessage":
                u = _join_blocks(it.get("content"), _USER_KEY).strip()
                if _noise(u) or u in seen:
                    continue
                seen.add(u)
                flush()
                cur_user = u.replace("\n", " ")
                agents = []
            elif ty == "AgentMessage":
                a = _join_blocks(it.get("content"), _AGENT_KEY).strip()
                if a:
                    agents.append((it.get("phase"), a.replace("\n", " ")))
            continue

        if provider == "pi":
            if o.get("type") != "message":
                continue
            msg = o.get("message") or {}
            role = msg.get("role")
            if role == "user":
                u = _join_blocks(msg.get("content"), _USER_KEY).strip()
                if _noise(u) or u in seen:
                    continue
                seen.add(u)
                flush()
                cur_user = u.replace("\n", " ")
                agents = []
            elif role == "assistant":
                a = _join_blocks(msg.get("content"), _AGENT_KEY).strip()
                if a:
                    agents.append((None, a.replace("\n", " ")))
            continue

        if provider == "claude":
            ty = o.get("type")
            msg = o.get("message") if isinstance(o.get("message"), dict) else None
            if ty == "user" and msg:
                u = _join_blocks(msg.get("content"), _USER_KEY).strip()
                if _noise(u):
                    continue
                flush()
                cur_user = u.replace("\n", " ")
                agents = []
            elif ty == "assistant" and msg:
                a = _join_blocks(msg.get("content"), _AGENT_KEY).strip()
                if a:
                    agents.append((None, a.replace("\n", " ")))
            continue

        # workbuddy / generic
        if o.get("type") == "message":
            role = o.get("role")
            if role == "user":
                u = _join_blocks(o.get("content"), _USER_KEY).strip()
                if _noise(u) or u in seen:
                    continue
                seen.add(u)
                flush()
                cur_user = u.replace("\n", " ")
                agents = []
            elif role == "assistant":
                a = _join_blocks(o.get("content"), _AGENT_KEY).strip()
                if a:
                    agents.append((None, a.replace("\n", " ")))

    flush()
    return turns


def zcode_turns(sid, db=ZCODE_DB):
    """从一个 zcode 会话 id 读 message/part 组装对话。"""
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    msgs = con.execute(
        "select id, data from message where session_id=? order by time_created, id", (sid,)
    ).fetchall()
    parts = con.execute(
        "select message_id, data from part where session_id=? order by time_created, id", (sid,)
    ).fetchall()
    con.close()

    by_msg = {}
    for mid, data in parts:
        try:
            d = json.loads(data)
        except Exception:
            continue
        if d.get("type") == "text" and (d.get("text") or "").strip():
            by_msg.setdefault(mid, []).append(d["text"])

    turns = []
    cur_user = None
    agents = []
    for mid, data in msgs:
        try:
            d = json.loads(data)
        except Exception:
            continue
        role = d.get("role")
        text = "\n".join(by_msg.get(mid, []))
        if role == "user":
            u = text.strip()
            if _noise(u):
                continue
            if cur_user is not None:
                turns.append((cur_user, agents[:]))
            cur_user = u.replace("\n", " ")
            agents = []
        elif role == "assistant" and text.strip():
            agents.append((None, text.replace("\n", " ")))
    if cur_user is not None:
        turns.append((cur_user, agents[:]))
    return turns


def show(turns, cap, start=1, limit=0):
    """打印一轮窗口。start 为 1-based 轮号，limit=0 表示到末尾。"""
    total = len(turns)
    s = max(1, start)
    e = total if not limit else min(total, s - 1 + limit)
    if total == 0:
        print("共 0 轮（无真实用户轮）")
        return
    if s > total:
        print(f"共 {total} 轮；--start {s} 已超出末尾，无内容")
        return
    head = f"共 {total} 轮"
    if s > 1 or e < total:
        head += f"；本片 {s}-{e}" + ("" if e >= total else f"，剩 {total - e} 轮")
    print(head + "\n")
    for i in range(s - 1, e):
        u, agents = turns[i]
        print(f"--- [{i + 1}] USER: {u[:300]}")
        if agents:
            finals = [t for ph, t in agents if ph == "final"]
            show_agents = finals if finals else [agents[-1][1]]
            for t in show_agents:
                print(f"    AGENT: {t[:cap]}")
        print()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("paths", nargs="*", help="transcript 路径，可给多个（zcode 用 --id）")
    ap.add_argument("--provider", default="auto",
                    choices=["auto", "claude", "codex", "workbuddy", "generic", "zcode"])
    ap.add_argument("--id", action="append", dest="ids", help="zcode 会话 id（可重复）")
    ap.add_argument("--db", default=ZCODE_DB, help="zcode 库路径")
    ap.add_argument("--max", type=int, default=400, help="每轮答案截断长度")
    ap.add_argument("--start", type=int, default=1, help="从第几轮开始（1-based）")
    ap.add_argument("--limit", type=int, default=0, help="本片最多几轮，0=不限")
    args = ap.parse_args()

    if args.provider == "zcode" and not args.ids:
        ap.error("zcode 没有 transcript 文件，必须用 --id <sid>")

    if args.ids:
        for sid in args.ids:
            print(f"# zcode id={sid}")
            show(zcode_turns(sid, args.db), args.max, args.start, args.limit)
        return

    if not args.paths:
        ap.error("需要 transcript 路径（可多个），或 --provider zcode --id <sid>")
    for path in args.paths:
        if not os.path.isfile(path):
            # 批量读时单条缺失不该拖垮整批（路径手抄错/文件已删/误传目录都常见）。
            print(f"# SKIP（不是可读文件）: {path}\n")
            continue
        try:
            prov = detect_provider(path) if args.provider == "auto" else args.provider
            print(f"# {os.path.basename(path)}  provider={prov}  {path}")
            show(parse_jsonl(path, prov), args.max, args.start, args.limit)
        except OSError as exc:
            # 权限不足、读一半被删等同样只跳这一条。
            print(f"# SKIP（读取失败: {exc}）: {path}\n")


if __name__ == "__main__":
    main()
