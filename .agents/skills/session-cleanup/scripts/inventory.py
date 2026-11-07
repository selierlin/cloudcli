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
# NB: opencode 不在 ~/.opencode/（该目录不存在），opencode.db 在 XDG data 下。
OPENCODE_DB = os.path.expanduser("~/.local/share/opencode/opencode.db")

# provider -> (库路径, session 表里代表项目的列)
# 两者的 session/message/part 结构一致，所以轮数与体积都能复用同一条读法。
SHARED_DB_PROVIDERS = {
    "zcode": (ZCODE_DB, "directory"),
    "opencode": (OPENCODE_DB, "directory"),
}


def turns_and_first(path, provider):
    try:
        turns = extract.parse_jsonl(path, provider)
    except Exception as e:  # noqa: BLE001
        return -1, f"(parse error: {e})"
    first = turns[0][0] if turns else ""
    return len(turns), first


def load_zcode_index(db=ZCODE_DB, project_column="directory"):
    """读共享库（zcode / opencode），返回 id -> {turns, first, size, title, project, updated}。

    这些 provider 的 jsonl_path 恒为 NULL，不走文件；体积用 message+part 的 JSON 字节
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
            f"select id, title, {project_column}, time_created, time_updated, time_archived from session"
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


def collect(db=DB, archived_only=False, provider=None):
    """结构化盘点，返回 list[dict]。CLI 与 ledger.py 共用同一份口径。

    每项：sid / provider / psid / name / project / jsonl_path / archived /
    fork_parent / updated / size / turns / first / provider_only。
    size<0 表示路径登记了但文件不在；turns=-1 表示解析失败。
    """
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    q = ("select session_id, provider, provider_session_id, custom_name, project_path,"
         " jsonl_path, isArchived, forked_from_session_id, updated_at from sessions")
    cond = []
    if archived_only:
        cond.append("isArchived=1")
    if provider:
        cond.append(f"provider={provider!r}")
    if cond:
        q += " where " + " and ".join(cond)
    rows = con.execute(q).fetchall()
    total, archived = con.execute(
        "select count(*), sum(case when isArchived=1 then 1 else 0 end) from sessions"
    ).fetchone()
    con.close()

    # 各 provider 的索引：库里的会话 -> 体积/轮数/首问（无 transcript 文件可读）
    indexes = {prov: load_zcode_index(path, col) for prov, (path, col) in SHARED_DB_PROVIDERS.items()}

    items = []
    known_sids = set()
    for sid, prov, psid, name, proj, jp, isarch, fork_parent, upd in rows:
        size = -1
        nturns = -1
        first = ""
        if jp and os.path.exists(jp):
            size = os.path.getsize(jp)
            nturns, first = turns_and_first(jp, prov)
        elif prov in indexes:
            # 无单会话文件：体积/轮数/首问都从 provider 库里取。
            info = indexes[prov].get(psid) or indexes[prov].get(sid)
            if info:
                size, nturns, first = info["size"], info["turns"], info["first"]
            else:
                size = 0
        if prov in indexes:
            known_sids.update(x for x in (sid, psid) if x)
        items.append({
            "sid": sid, "provider": prov, "psid": psid, "name": name or "",
            "project": proj or "", "jsonl_path": jp or "", "archived": bool(isarch),
            "fork_parent": fork_parent or "",
            "updated": str(upd or ""), "size": size, "turns": nturns,
            "first": first, "provider_only": False,
        })

    # provider 库里存在、但 cloudcli 从未收录的会话 —— 它们在库外，此前完全不可见，
    # 也就永远进不了清理候选。列出来供挑选（--provider <p> 时尤其重要）。
    if not archived_only:
        for prov, index in indexes.items():
            if provider and provider != prov:
                continue
            for sid, info in sorted(index.items(), key=lambda kv: kv[1]["updated"], reverse=True):
                if sid in known_sids:
                    continue
                items.append({
                    "sid": sid, "provider": prov, "psid": sid, "name": info["title"],
                    "project": info["project"], "jsonl_path": "", "archived": info["archived"],
                    "fork_parent": "", "updated": str(info["updated"]),
                    "size": info["size"], "turns": info["turns"], "first": info["first"],
                    "provider_only": True,
                })
    return items, total, archived


def fmt_size(size):
    if size < 0:
        return "MISSING"
    return f"{size // 1024}K" if size < 1024 * 1024 else f"{size / 1024 / 1024:.1f}M"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=DB)
    ap.add_argument("--archived-only", action="store_true")
    ap.add_argument("--provider")
    ap.add_argument("--sort", default="size", choices=["size", "turns", "updated"])
    ap.add_argument("--no-preview", action="store_true")
    args = ap.parse_args()

    items, total, archived_n = collect(args.db, args.archived_only, args.provider)
    print(f"库中共 {total} 条会话，已归档 {archived_n} 条；本次列出 {len(items)} 条\n")

    keyf = {"size": lambda r: r["size"], "turns": lambda r: r["turns"],
            "updated": lambda r: r["updated"]}
    items.sort(key=keyf[args.sort], reverse=(args.sort != "updated"))

    print(f"{'sid':10} {'prov':9} {'arch':4} {'turn':>4} {'size':>9}  {'name':34} 首问")
    zonly = 0
    for it in items:
        if it["provider_only"]:
            zonly += 1
        size = it["size"]
        sz = "(no path)" if size < 0 and not it["jsonl_path"] else fmt_size(size)
        prev = "" if args.no_preview else it["first"][:60]
        arch = "-" if it["provider_only"] else str(int(it["archived"]))
        print(f"{it['sid'][:10]:10} {it['provider']:9} {arch:4} {str(it['turns']):>4} "
              f"{sz:>9}  {(it['name'] or '')[:34]:34} {prev}")
    if zonly:
        print(f"\n注：{zonly} 条为 provider 库独有（cloudcli 未收录，arch 列显示 '-'），"
              f"此前不在任何清理候选内。")


if __name__ == "__main__":
    main()
