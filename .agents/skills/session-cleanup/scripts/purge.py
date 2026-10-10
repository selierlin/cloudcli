#!/usr/bin/env python3
"""物理删除 CloudCLI 会话（默认干跑；--apply 必须先做快照）。

用法:
  python3 purge.py --targets FILE
  python3 purge.py --targets FILE --apply --backup /path/auth.db.before-*.backup
  # 可选: --db PATH  --zcode-db PATH  --no-zcode  --opencode-db PATH  --no-opencode

--targets FILE: 每行一个 session_id 或 provider_session_id（支持前缀；'#' 注释与空行忽略）。

语义 = 应用内 permanentlyDeleteArchivedSessions({force:true, deletedFromDisk:true})：
  sessions 行 + superseded_provider_sessions 行 + 主/超期 transcript + WorkBuddy 同名残留目录。
  zcode / opencode 目标另清各自provider 库（--no-zcode / --no-opencode 关闭）。

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
DEFAULT_OPENCODE = os.path.join(HOME, ".local/share/opencode/opencode.db")
ROLLOUT = os.path.join(HOME, ".zcode/cli/rollout")

# providers whose sessions live in one shared sqlite store instead of per-session
# files: the app row is only an index, so deleting it alone leaves the session
# behind and the next scan re-indexes it (this is why the app calls the
# provider's deleteProviderSession; the script must do the same).
#
# Each entry: db path, tables addressed by `session_id` (in deletion order —
# `part` precedes `message` because its FK points at message, not session), and
# tables addressed by `aggregate_id` (the event tree, which has no session
# column). Mirrors ZCODE_SESSION_REFERENCING_TABLES and
# OPENCODE_SESSION_REFERENCING_TABLES / OPENCODE_EVENT_TABLES in the providers;
# every table carrying `session_id` is listed rather than relying on cascades.
SHARED_DB_PROVIDERS = {
    "zcode": {
        "db": DEFAULT_ZCODE,
        "flag": "no_zcode",
        "path_flag": "zcode_db",
        "id_column": "id",
        "session_id_tables": [
            "part",
            "message",
            "session_entry",
            "todo",
            "session_target",
            "session_input",
            "model_usage",
            "turn_usage",
            "tool_usage",
            "input_history",
            "dwf_actor",
        ],
        "aggregate_id_tables": [],
    },
    "opencode": {
        # NB: not ~/.opencode/ — that directory does not exist; opencode stores
        # its database under the XDG data dir.
        "db": DEFAULT_OPENCODE,
        "flag": "no_opencode",
        "path_flag": "opencode_db",
        "id_column": "id",
        "session_id_tables": [
            "part",
            "message",
            "session_context_epoch",
            "session_input",
            "session_message",
            "todo",
            "session_share",
        ],
        "aggregate_id_tables": ["event", "event_sequence"],
    },
}


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
    ap.add_argument("--opencode-db", default=DEFAULT_OPENCODE)
    ap.add_argument("--no-opencode", action="store_true")
    args = ap.parse_args()

    shared_dbs = {}
    for provider, spec in SHARED_DB_PROVIDERS.items():
        if getattr(args, spec["flag"]):
            continue
        spec = dict(spec, db=getattr(args, spec["path_flag"]))
        shared_dbs[provider] = spec

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

    # 共享库独有目标：cloudcli 未收录它们（增量游标/DB 重建会漏掉），
    # 因此上面永远匹配不到 —— 但它们的会话仍在 provider 库里占地方，
    # 且 watcher 会把它们重新索引回来。
    store_only = {p: [] for p in shared_dbs}
    known_ids = set()
    for r in all_rows:
        known_ids.update(x for x in (r["session_id"], r["provider_session_id"]) if x)
    for provider, spec in shared_dbs.items():
        if not os.path.exists(spec["db"]):
            continue
        # 活动库不能加 immutable=1：它会跳过 WAL，读不到未 checkpoint 的提交。
        s = sqlite3.connect(f"file:{spec['db']}?mode=ro", uri=True)
        try:
            store_ids = [x[0] for x in s.execute(f"select {spec['id_column']} from session")]
        except sqlite3.Error:
            continue
        finally:
            s.close()
        for p in prefixes:
            for sid in store_ids:
                if sid.startswith(p) and sid not in known_ids and sid not in store_only[provider]:
                    store_only[provider].append(sid)

    store_only_total = sum(len(v) for v in store_only.values())
    if not targets and not store_only_total:
        sys.exit("没有会话匹配这些前缀（先跑 inventory.py 核对 id）")

    tgt_sids = {r["session_id"] for r in targets}
    live_psids = {r["provider_session_id"] for r in all_rows
                  if r["provider_session_id"] and r["session_id"] not in tgt_sids}

    store_note = "，".join(f"{len(v)} 条 {p} 库独有（cloudcli 未收录）"
                          for p, v in store_only.items() if v)
    print(f"{'APPLY' if args.apply else 'DRY-RUN'}：命中 {len(targets)} 条会话"
          f"{f'，另有 {store_note}' if store_note else ''}\n")

    for provider, ids in store_only.items():
        for sid in ids:
            print(f"### {sid[:12]} [{provider}] 库外（cloudcli 未收录） arch=- fork_dep=0 sup=0")

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

    # ---- 共享库 provider（zcode / opencode）----
    # 会话没有各自的 transcript 文件，provider 库才是真源；只删 cloudcli 行的话
    # watcher 会把会话重新索引回来（应用内的 deleteProviderSession 同理）。
    for provider, spec in shared_dbs.items():
        ids = set(store_only[provider])
        for r in targets:
            if r["provider"] == provider:
                ids |= {x for x in (r["session_id"], r["provider_session_id"]) if x}
        if not ids or not os.path.exists(spec["db"]):
            continue

        store = sqlite3.connect(spec["db"])
        try:
            store.execute("PRAGMA foreign_keys=ON")
            have = {x[0] for x in store.execute(f"select {spec['id_column']} from session")}
            hit = sorted(ids & have)
            # opencode 的子会话（parent_id 指向父会话）跟着父会话一起删：
            # 扫描 SQL 有 `parent_id IS NULL`，留下的子会话既不会被索引也永远
            # 不会被清掉，是看不见的死数据。
            if provider == "opencode" and hit:
                qh = ",".join("?" * len(hit))
                children = [x[0] for x in store.execute(
                    f"select id from session where parent_id in ({qh})", hit)
                    if x[0] not in hit]
                if children:
                    print(f"    （含 {len(children)} 条子会话）")
                    hit = sorted(set(hit) | set(children))
            print(f"\n--- {provider} 库：命中 {len(hit)} 条 ---")
            if hit:
                q = ",".join("?" * len(hit))
                # 先只读统计所有候选表，让清单说清每张表会少多少行。
                counted = {}
                for t in spec["session_id_tables"]:
                    try:
                        n = store.execute(
                            f"select count(*) from {t} where session_id in ({q})", hit).fetchone()[0]
                    except sqlite3.Error:
                        continue
                    if n:
                        counted[t] = n
                        print(f"    {t}: {n} 行")
                for t in spec["aggregate_id_tables"]:
                    try:
                        n = store.execute(
                            f"select count(*) from {t} where aggregate_id in ({q})", hit).fetchone()[0]
                    except sqlite3.Error:
                        continue
                    if n:
                        counted[t] = n
                        print(f"    {t}: {n} 行")
                if args.apply:
                    # 顺序：先按 session_id 清空从属表（part 挂在 message 上，
                    # 先 part 后 message 才不依赖级联是否生效），再删 session。
                    for t in spec["session_id_tables"]:
                        try:
                            store.execute(f"delete from {t} where session_id in ({q})", hit)
                        except sqlite3.Error:
                            pass  # 该 schema 版本没有这张表
                    for t in spec["aggregate_id_tables"]:
                        try:
                            store.execute(f"delete from {t} where aggregate_id in ({q})", hit)
                        except sqlite3.Error:
                            pass
                    store.execute(f"delete from session where {spec['id_column']} in ({q})", hit)
                    store.commit()
        finally:
            store.close()

        if provider == "zcode":
            for f in sorted(glob.glob(os.path.join(ROLLOUT, "model-io-*.jsonl"))):
                rid = os.path.basename(f).replace("model-io-", "").replace(".jsonl", "")
                if rid in ids:
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
