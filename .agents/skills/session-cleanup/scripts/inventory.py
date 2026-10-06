#!/usr/bin/env python3
"""只读盘点 CloudCLI 会话库。不修改任何东西。

用法:
  python3 inventory.py [--db PATH] [--archived-only] [--provider P]
                       [--sort size|turns|updated] [--no-preview]
"""
import argparse
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import extract  # noqa: E402

DB = os.path.expanduser("~/.cloudcli/auth.db")
ZCODE_DB = os.path.expanduser("~/.zcode/cli/db/db.sqlite")


def turns_and_first(path, provider):
    try:
        turns = extract.parse_jsonl(path, provider)
    except Exception as e:  # noqa: BLE001
        return -1, f"(parse error: {e})"
    first = turns[0][0] if turns else ""
    return len(turns), first


def load_zcode_index(db=ZCODE_DB):
    """读 zcode 库，返回 id -> {turns, first, size, title, project, updated}。

    zcode 的 jsonl_path 恒为 NULL，不走文件；体积用 message+part 的 JSON 字节
    近似（与其它 provider 的 transcript 体积同量纲），轮数/首问复用 extract。
    必须用 ?mode=ro（不带 immutable）——immutable 会跳过 WAL，把未 checkpoint
    的会话读成不存在。库缺失时返回空表。
    """
    if not os.path.exists(db):
        return {}
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    out = {}
    try:
        rows = con.execute(
            "select id, title, directory, time_created, time_updated, time_archived from session"
        ).fetchall()
        for sid, title, directory, tcreated, tupdated, tarch in rows:
            size = 0
            for tbl in ("message", "part"):
                try:
                    size += con.execute(
                        f"select coalesce(sum(length(data)), 0) from {tbl} where session_id=?", (sid,)
                    ).fetchone()[0]
                except sqlite3.Error:
                    pass
            out[sid] = {
                "title": title or "",
                "project": directory or "",
                "size": size,
                "updated": tupdated or tcreated or 0,
                "archived": tarch is not None,
            }
    finally:
        con.close()

    for sid, info in out.items():
        try:
            turns = extract.zcode_turns(sid, db)
            info["turns"] = len(turns)
            info["first"] = turns[0][0] if turns else ""
        except Exception:  # noqa: BLE001
            info["turns"] = -1
            info["first"] = ""
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=DB)
    ap.add_argument("--archived-only", action="store_true")
    ap.add_argument("--provider")
    ap.add_argument("--sort", default="size", choices=["size", "turns", "updated"])
    ap.add_argument("--no-preview", action="store_true")
    args = ap.parse_args()

    con = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    q = ("select session_id, provider, provider_session_id, custom_name, project_path,"
         " jsonl_path, isArchived, updated_at from sessions")
    cond = []
    if args.archived_only:
        cond.append("isArchived=1")
    if args.provider:
        cond.append(f"provider={args.provider!r}")
    if cond:
        q += " where " + " and ".join(cond)
    rows = con.execute(q).fetchall()

    arch = con.execute("select count(*), sum(case when isArchived=1 then 1 else 0 end) from sessions").fetchone()
    print(f"库中共 {arch[0]} 条会话，已归档 {arch[1]} 条；本次列出 {len(rows)} 条\n")

    zindex = load_zcode_index()

    items = []
    known_zids = set()
    for sid, prov, psid, name, proj, jp, isarch, upd in rows:
        size = -1
        nturns = -1
        first = ""
        if jp and os.path.exists(jp):
            size = os.path.getsize(jp)
            nturns, first = turns_and_first(jp, prov)
        elif prov == "zcode":
            # zcode 没有单会话文件：体积/轮数/首问都从 zcode 库取。
            zinfo = zindex.get(psid) or zindex.get(sid)
            if zinfo:
                size, nturns, first = zinfo["size"], zinfo["turns"], zinfo["first"]
            else:
                size = 0
        if prov == "zcode":
            known_zids.update(x for x in (sid, psid) if x)
        items.append((sid, prov, psid, name, proj, jp, isarch, upd, size, nturns, first))

    # zcode 库里存在、但 cloudcli 从未收录的会话 —— 它们在库外，此前完全不可见，
    # 也就永远进不了清理候选。列出来供挑选（--provider zcode 时尤其重要）。
    if not args.archived_only and (not args.provider or args.provider == "zcode"):
        for zid, zi in sorted(zindex.items(), key=lambda kv: kv[1]["updated"], reverse=True):
            if zid in known_zids:
                continue
            items.append((zid, "zcode", zid, zi["title"], zi["project"], "", "-",
                          zi["updated"], zi["size"], zi["turns"], zi["first"]))

    keyf = {"size": lambda r: r[8], "turns": lambda r: r[9], "updated": lambda r: str(r[7])}
    items.sort(key=keyf[args.sort], reverse=(args.sort != "updated"))

    print(f"{'sid':10} {'prov':9} {'arch':4} {'turn':>4} {'size':>9}  {'name':34} 首问")
    zonly = 0
    for sid, prov, psid, name, proj, jp, isarch, upd, size, nturns, first in items:
        if isarch == "-":
            zonly += 1
        if size < 0:
            sz = "MISSING" if jp else "(no path)"
        else:
            sz = f"{size // 1024}K" if size < 1024 * 1024 else f"{size / 1024 / 1024:.1f}M"
        prev = "" if args.no_preview else first[:60]
        print(f"{sid[:10]:10} {prov:9} {str(isarch):4} {str(nturns):>4} {sz:>9}  {(name or '')[:34]:34} {prev}")
    if zonly:
        print(f"\n注：{zonly} 条为 zcode 库独有（cloudcli 未收录，arch 列显示 '-'），此前不在任何清理候选内。")


if __name__ == "__main__":
    main()
