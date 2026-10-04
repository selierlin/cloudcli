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


def turns_and_first(path, provider):
    try:
        turns = extract.parse_jsonl(path, provider)
    except Exception as e:  # noqa: BLE001
        return -1, f"(parse error: {e})"
    first = turns[0][0] if turns else ""
    return len(turns), first


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

    items = []
    for sid, prov, psid, name, proj, jp, isarch, upd in rows:
        size = -1
        nturns = -1
        first = ""
        if jp and os.path.exists(jp):
            size = os.path.getsize(jp)
            nturns, first = turns_and_first(jp, prov)
        elif prov == "zcode":
            size = 0
        items.append((sid, prov, psid, name, proj, jp, isarch, upd, size, nturns, first))

    keyf = {"size": lambda r: r[8], "turns": lambda r: r[9], "updated": lambda r: str(r[7])}
    items.sort(key=keyf[args.sort], reverse=(args.sort != "updated"))

    print(f"{'sid':10} {'prov':9} {'arch':4} {'turn':>4} {'size':>9}  {'name':34} 首问")
    for sid, prov, psid, name, proj, jp, isarch, upd, size, nturns, first in items:
        if size < 0:
            sz = "MISSING" if jp else "(no path)"
        elif prov == "zcode":
            sz = "(zcode)"
        else:
            sz = f"{size // 1024}K" if size < 1024 * 1024 else f"{size / 1024 / 1024:.1f}M"
        prev = "" if args.no_preview else first[:60]
        print(f"{sid[:10]:10} {prov:9} {str(isarch):4} {str(nturns):>4} {sz:>9}  {(name or '')[:34]:34} {prev}")


if __name__ == "__main__":
    main()
