#!/usr/bin/env python3
"""采集 memory-bank 的 s: 引用，与 CloudCLI 会话交叉匹配（只读）。

用法:
  python3 sediment_refs.py [--db PATH] [--bank DIR] [--archived-only] [--unmatched]
"""
import argparse
import glob
import os
import re
import sqlite3

DB = os.path.expanduser("~/.cloudcli/auth.db")
BANK = os.path.expanduser("~/.memory-bank")

REF_RE = re.compile(r"s:\s*([A-Za-z]+):\s*`?([0-9a-fA-F][0-9a-fA-F\-]{3,})")


def collect_refs(bank):
    """返回 {(provider, id): {源文件名, ...}}。"""
    refs = {}
    for f in glob.glob(os.path.join(bank, "**", "*.md"), recursive=True):
        src = os.path.basename(f)
        try:
            text = open(f, encoding="utf-8", errors="ignore").read()
        except OSError:
            continue
        for m in REF_RE.finditer(text):
            refs.setdefault((m.group(1).lower(), m.group(2)), set()).add(src)
    return refs


def _match(rid, ref_id):
    if not rid:
        return None
    if rid == ref_id:
        return "exact"
    if len(ref_id) >= 8 and rid.startswith(ref_id):
        return "prefix(ref<row)"
    if len(rid) >= 8 and ref_id.startswith(rid):
        return "prefix(row<ref)"
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=DB)
    ap.add_argument("--bank", default=BANK)
    ap.add_argument("--archived-only", action="store_true")
    ap.add_argument("--unmatched", action="store_true", help="只列未命中的会话")
    args = ap.parse_args()

    refs = collect_refs(args.bank)
    print(f"memory-bank 中 s: 引用（去重）= {len(refs)} 条\n")

    con = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    q = ("select session_id, provider, provider_session_id, custom_name, jsonl_path,"
         " isArchived, updated_at from sessions")
    if args.archived_only:
        q += " where isArchived=1"
    q += " order by updated_at desc"
    rows = con.execute(q).fetchall()

    hit = 0
    for sid, prov, psid, name, jp, isarch, upd in rows:
        hits = {}
        for (rp, rid), srcs in refs.items():
            for mine in (sid, psid):
                how = _match(mine, rid)
                if how:
                    hits[f"{rp}:{rid}"] = (how, srcs)
        if hits:
            hit += 1
            if args.unmatched:
                continue
            sz = os.path.getsize(jp) // 1024 if jp and os.path.exists(jp) else -1
            print(f"★已沉淀 [{'归档' if isarch else '未归档'}] {prov:9} {sid[:12]} "
                  f"{('%dK' % sz) if sz >= 0 else '(no path)':>8}  {(name or '')[:38]}")
            for ref, (how, srcs) in sorted(hits.items()):
                print(f"        ref {ref}  [{how}]  <- {', '.join(sorted(srcs))}")
        else:
            if not args.unmatched:
                continue
            sz = os.path.getsize(jp) // 1024 if jp and os.path.exists(jp) else -1
            print(f"  未沉淀 [{'归档' if isarch else '未归档'}] {prov:9} {sid[:12]} "
                  f"{('%dK' % sz) if sz >= 0 else '(no path)':>8}  {(name or '')[:38]}")

    print(f"\n命中会话 {hit} / 列出总数 {len(rows)}")
    print("提示：s: 引用大量指向早已删除的会话（引用悬空、只剩沉淀）属正常态。")


if __name__ == "__main__":
    main()
