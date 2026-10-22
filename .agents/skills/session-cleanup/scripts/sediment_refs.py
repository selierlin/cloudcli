#!/usr/bin/env python3
"""采集 s: 引用（memory-bank + db dict），与 CloudCLI 会话交叉匹配（只读）。

用法:
  python3 sediment_refs.py [--db PATH] [--bank DIR]... [--dict DIR]... [--no-dict]
                           [--archived-only] [--unmatched]

判据提示：单处命中只证明「有东西落过」，不证明「全部落过」。
一条会话若同时产出 bank 与 db dict 两类知识，两处都要命中才算可删。
"""
import argparse
import glob
import os
import re
import sqlite3

DB = os.path.expanduser("~/.cloudcli/auth.db")
BANK = os.path.expanduser("~/.memory-bank")
DICT = os.path.expanduser("~/Projects/lemobar/ToC-Admin/docs/db-dictionary")

REF_RE = re.compile(r"s:\s*([A-Za-z]+):\s*`?([0-9a-fA-F][0-9a-fA-F\-]{3,})")


def collect_refs(roots):
    """roots=[(label, dir)] → {(provider, id): {"bank:entries/x.md", "dict:mysql-lmb-toc/05-activity.md"}}。"""
    refs = {}
    for label, root in roots:
        if not os.path.isdir(root):
            print(f"⚠️  跳过不存在的根：{root}")
            continue
        for f in glob.glob(os.path.join(root, "**", "*.md"), recursive=True):
            try:
                text = open(f, encoding="utf-8", errors="ignore").read()
            except OSError:
                continue
            src = f"{label}:{os.path.relpath(f, root)}"
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
    ap.add_argument("--bank", action="append", default=None, help="memory-bank 根（可重复）")
    ap.add_argument("--dict", dest="dict_roots", action="append", default=None,
                    help="db dict 根（可重复）")
    ap.add_argument("--no-dict", action="store_true", help="跳过 db dict")
    ap.add_argument("--archived-only", action="store_true")
    ap.add_argument("--unmatched", action="store_true", help="只列未命中的会话")
    args = ap.parse_args()

    roots = [("bank", d) for d in (args.bank or [BANK])]
    if not args.no_dict:
        roots += [("dict", d) for d in (args.dict_roots or [DICT])]

    refs = collect_refs(roots)
    n_bank = sum(1 for v in refs.values() if any(s.startswith("bank:") for s in v))
    n_dict = sum(1 for v in refs.values() if any(s.startswith("dict:") for s in v))
    print(f"s: 引用（去重）= {len(refs)} 条（bank {n_bank} · dict {n_dict}）\n")

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
    print("提示1：s: 引用大量指向早已删除的会话（引用悬空、只剩沉淀）属正常态。")
    print("提示2：命中≠可删——先核对该会话的落点（bank / db dict）是否全部落地。")


if __name__ == "__main__":
    main()
