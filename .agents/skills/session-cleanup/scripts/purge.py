#!/usr/bin/env python3
"""物理删除 CloudCLI 会话（默认干跑；--apply 必须先做快照）。

用法:
  python3 purge.py --targets FILE
  python3 purge.py --targets FILE --apply --backup /path/auth.db.before-*.backup
  # 可选: --db PATH  --zcode-db PATH  --no-zcode

--targets FILE: 每行一个 session_id 或 provider_session_id（支持前缀；'#' 注释与空行忽略）。

语义 = 应用内 permanentlyDeleteArchivedSessions({force:true, deletedFromDisk:true})：
  sessions 行 + superseded_provider_sessions 行 + 主/超期 transcript + WorkBuddy 同名残留目录。
  zcode 目标另清 ~/.zcode 库与 rollout（--no-zcode 关闭）。

安全：默认只打印计划；--apply 会强制要求 --backup 指向已存在的快照文件。
"""
import argparse
import glob
import os
import shutil
import sqlite3
import sys

HOME = os.path.expanduser("~")
DEFAULT_DB = os.path.join(HOME, ".cloudcli/auth.db")
DEFAULT_ZCODE = os.path.join(HOME, ".zcode/cli/db/db.sqlite")
ROLLOUT = os.path.join(HOME, ".zcode/cli/rollout")


def load_targets(path):
    out = []
    for line in open(path, encoding="utf-8", errors="ignore"):
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        out.append(s)
    return out


def dir_size(d):
    total = 0
    for dp, _, fn in os.walk(d):
        for f in fn:
            try:
                total += os.path.getsize(os.path.join(dp, f))
            except OSError:
                pass
    return total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--targets", required=True)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--backup", help="--apply 必填：已存在的一致性快照路径")
    ap.add_argument("--db", default=DEFAULT_DB)
    ap.add_argument("--zcode-db", default=DEFAULT_ZCODE)
    ap.add_argument("--no-zcode", action="store_true")
    args = ap.parse_args()

    prefixes = load_targets(args.targets)
    if not prefixes:
        sys.exit("目标文件为空")

    if args.apply:
        if not args.backup:
            sys.exit("--apply 需要 --backup <已存在的快照路径>（先做 sqlite3 .backup）")
        if not os.path.exists(args.backup):
            sys.exit(f"快照不存在: {args.backup}")

    con = sqlite3.connect(args.db if args.apply else f"file:{args.db}?mode=ro", uri=not args.apply)
    con.row_factory = sqlite3.Row
    all_rows = con.execute(
        "select session_id,provider,provider_session_id,custom_name,jsonl_path,isArchived "
        "from sessions").fetchall()

    targets = []
    for r in all_rows:
        for p in prefixes:
            if r["session_id"].startswith(p) or (r["provider_session_id"] or "").startswith(p):
                targets.append(r)
                break

    if not targets:
        sys.exit("没有会话匹配这些前缀（先跑 inventory.py 核对 id）")

    tgt_sids = {r["session_id"] for r in targets}
    live_psids = {r["provider_session_id"] for r in all_rows
                  if r["provider_session_id"] and r["session_id"] not in tgt_sids}

    print(f"{'APPLY' if args.apply else 'DRY-RUN'}：命中 {len(targets)} 条会话\n")

    files, dirs, missing, freed = [], [], [], 0
    fork_warn = []

    for r in targets:
        sid, prov, psid, name, jp = r["session_id"], r["provider"], r["provider_session_id"], r["custom_name"], r["jsonl_path"]
        nfork = con.execute("select count(*) from sessions where forked_from_session_id=?", (sid,)).fetchone()[0]
        if nfork:
            fork_warn.append((sid, nfork))
        sup = con.execute(
            "select provider_session_id,jsonl_path from superseded_provider_sessions where session_id=?",
            (sid,)).fetchall()
        print(f"### {sid[:12]} [{prov}] arch={r['isArchived']} fork_dep={nfork} sup={len(sup)}  {(name or '')[:42]}")

        paths = [p for p in [jp] if p] + [p[1] for p in sup if p[1]]
        for p in paths:
            if os.path.exists(p):
                sz = os.path.getsize(p)
                if args.apply:
                    os.remove(p)
                files.append(p)
                freed += sz
                print(f"    file  {sz // 1024:>7}K  {p.replace(HOME, '~')}")
            else:
                missing.append(p)
                print(f"    MISS            {p.replace(HOME, '~')}")

        if prov == "workbuddy" and jp:
            base = os.path.dirname(jp)
            for u in [psid] + [p[0] for p in sup if p[0]]:
                if not u:
                    continue
                d = os.path.join(base, u)
                if not os.path.isdir(d):
                    continue
                if u in live_psids:
                    print(f"    !!skip dir（仍是其它在库会话 psid）: {d.replace(HOME, '~')}")
                    continue
                sz = dir_size(d)
                if args.apply:
                    shutil.rmtree(d)
                dirs.append(d)
                freed += sz
                print(f"    dir   {sz // 1024:>7}K  {d.replace(HOME, '~')}")

        if args.apply:
            con.execute("delete from superseded_provider_sessions where session_id=?", (sid,))
            con.execute("delete from sessions where session_id=?", (sid,))
            con.commit()  # 逐条落库：中途任何崩溃不回滚已删目标（文件删除不可逆，DB 必须跟上）

    # ---- zcode ----
    if not args.no_zcode:
        zids = set()
        for r in targets:
            if r["provider"] == "zcode" or (r["session_id"] or "").startswith("sess_"):
                zids |= {x for x in (r["session_id"], r["provider_session_id"]) if x}
        if zids and os.path.exists(args.zcode_db):
            z = sqlite3.connect(args.zcode_db)
            z.execute("PRAGMA foreign_keys=ON")
            have = {x[0] for x in z.execute("select id from session")}
            zt = sorted(zids & have)
            print(f"\n--- zcode 库：命中 {len(zt)} 条 ---")
            if zt:
                q = ",".join("?" * len(zt))
                for t in ("message", "part", "session_entry", "todo", "session_target",
                          "session_input", "model_usage", "tool_usage", "turn_usage",
                          "input_history", "dwf_actor"):
                    try:
                        n = z.execute(f"select count(*) from {t} where session_id in ({q})", zt).fetchone()[0]
                        if n:
                            print(f"    {t}: {n} 行")
                    except sqlite3.Error:
                        pass
                if args.apply:
                    z.execute(f"delete from session where id in ({q})", zt)
                    for t in ("input_history", "dwf_actor", "part"):
                        z.execute(f"delete from {t} where session_id in ({q})", zt)
                    z.commit()
            if args.apply:
                z.close()
            else:
                z.close()
            # rollout
            for f in sorted(glob.glob(os.path.join(ROLLOUT, "model-io-*.jsonl"))):
                rid = os.path.basename(f).replace("model-io-", "").replace(".jsonl", "")
                if rid in zids:
                    sz = os.path.getsize(f)
                    if args.apply:
                        os.remove(f)
                    freed += sz
                    print(f"    rollout  {f.replace(HOME, '~')}")

    if args.apply:
        con.commit()
        ic = con.execute("pragma integrity_check").fetchone()[0]
        left = con.execute("select count(*), sum(case when isArchived=1 then 1 else 0 end) from sessions").fetchone()
        print(f"\nintegrity_check: {ic}；剩余 sessions {left[0]}（已归档 {left[1]}）")
    else:
        print("\n（干跑：未做任何修改。加 --apply --backup <快照> 执行。）")
    con.close()

    if fork_warn:
        print("\n⚠️ 以下目标有 fork 下游，确认前请三思：")
        for sid, n in fork_warn:
            print(f"   {sid} <- {n} fork(s)")
    print(f"汇总：文件 {len(files)}，目录 {len(dirs)}，缺失 {len(missing)}，约释放 {freed / 1024 / 1024:.1f} MB")


if __name__ == "__main__":
    main()
