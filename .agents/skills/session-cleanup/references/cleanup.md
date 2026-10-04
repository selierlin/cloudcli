# 清理线（cleanup）

把无用会话与垃圾从 DB 与磁盘清掉。**先读 SKILL.md §0 铁律**——先快照、干跑确认、物理删除、不动活物。

## 桶定义

### 口水（chatter）— 直接删

Smoke test / 一行口令型的空转会话。判定用三项即可，**不用逐字节读 transcript**：

- `custom_name` 就是那句口令（`reply with exactly: OK`、`收到请回复：收到`、`ping`、`pong`、`只回复ok`、`Bundled run`、`models`），或 `Untitled Codex Session` / `New session`；
- 真实用户轮数 ≈ 1；
- 体积只有几十 KB。

**只删「纯口水」。** 凡第二条及以后是真实问题的一律保留并单独标出（例：某条首问是「收到请回复：收到」、第二条却在问 clash party 代理日志——标出后交用户定）。transcript 已丢的孤儿行也保留（除非用户明确要清）。

用 `inventory.py` 出候选：按体积升序 + 轮数=1 + 名字像口令。

### 邻接垃圾（「清理下垃圾」时按桶确认）

比口水宽一档。经典五桶：

- **A 历史备份**：`~/.cloudcli/auth.db.before-*.backup*` 堆积。只留**最近两个**，其余连 `-shm`/`-wal` 边车一起删。**绝不动**活库的 `auth.db-wal`/`auth.db-shm`。
- **B 空项目行**（`projects`，0 会话）：目录**已不存在**的删行；目录在、只是暂时没会话的**保留**。
- **C 孤儿会话行**：`jsonl_path` 为空的（transcript 已丢）删——**zcode 除外**（它本来就恒 NULL，见下）。
- **D provider 侧空目录**：`~/.claude/projects`、`~/.workbuddy/projects`、`~/.pi`、`~/.omp`、`~/.codex`、`~/.dsh` 等下的空目录。**必须加 `! -newermt '-10 minutes'`**——用户常同时开着别的 harness 会话，正在跑的目录会被误清。
- **E 仓库产物**（`test-results/`、`playwright-report/`、`dist/`、`dist-server/`）：**别动**，属部署/构建产物。

```bash
# D：只删 10 分钟以上没动的空目录
for d in ~/.claude/projects ~/.workbuddy/projects ~/.pi ~/.omp ~/.codex ~/.dsh; do
  [ -d "$d" ] || continue
  find "$d" -mindepth 1 -depth -type d -empty ! -newermt '-10 minutes' -delete 2>/dev/null || true
done
```

### 已沉淀会话 — 内容已进 OV，可删

「已沉淀」的判定不是 cloudcli 的字段，而是 **memory-bank 的 `s:` 引用**（`session-sediment` 落的）。`s:` 引用绝大多数指向早已删除的会话（引用悬空、只剩沉淀），属正常态，不用追。

用 `sediment_refs.py` 交叉匹配，命中的就是已沉淀会话。删掉不丢信息（前提：确认对应条目已在 OV）。

### 残留目录 / 孤儿文件

- 已删会话在主 transcript 之外遗留的目录（尤其 WorkBuddy 子代理目录，见下）。
- 主 transcript 已不在库的**孤儿 transcript**（例：codex `~/.codex/sessions/**/rollout-*.jsonl`，DB 行早没了文件还在）——删。
- 复扫残留时**不要**按名字一刀切，先判活死（下节）。

## WorkBuddy 残留目录（易踩，必读）

- **布局**：主 transcript ＝ `<project>/<psid>.jsonl`；**子代理/tool 残留 ＝ 同名 `<psid>/` 目录**（内含 `subagents/agent-*.jsonl`、`tool-results/call_*.txt`）。两者同名并列。
- **应用内「永久删除」只 unlink `jsonl`，从不删那个 `<psid>/` 目录** ⇒ 每删一个会话就遗留一个目录，日积月累成堆。
- `~/.workbuddy/projects/` 下同时含**其它项目的会话**（不全是 cloudcli 管的）。
- 扫「孤儿目录」（uuid 既不在 `sessions` 也不在 `superseded_provider_sessions`）时**必须先按有无同名 `.jsonl` 分活/死**：
  - **有同名 `.jsonl` 的 ＝ WorkBuddy 应用本体会话**（只是不在 cloudcli 库）——**绝不能删**；
  - **无同名 `.jsonl` 的才是死残留**（主 transcript 已消失，纯子代理/tool 数据）——可删。
- 另加近 10 分钟活动兜底（刚启的会话可能还没写出 jsonl）。
- 一条会话若有 superseded 记录，删它会**连带删掉那几条 superseded 的 jsonl 文件**（App 语义）——这一步不能省。

判据一句话：**「名字不在我库里」≠「该删」，先问它有没有对应的主文件。**

`scripts/purge.py` 在删 WorkBuddy 会话时会顺手 `rmtree` 同名目录，并跳过「仍是别的在库会话 psid」的目录。

## zcode 的特殊口径

- zcode 会话在 `sessions` 表里 **`jsonl_path` 恒为 NULL**，后端**没有该 provider 的 `resolveTranscriptPath`** ⇒ **应用内「永久删除」对 zcode 磁盘零删除**，只删 DB 行。
- zcode 真实 transcript 在它自己的库 `~/.zcode/cli/db/db.sqlite`（表 `session`/`message`/`part`/`session_entry`/`model_usage`/`turn_usage`/`tool_usage`…）：
  - `PRAGMA foreign_keys=ON; delete from session where id in(...)` 级联掉大部分（多数表 `references session(id) on delete cascade`）；
  - 再手删**无 FK** 的 `input_history`、`dwf_actor`、`part`（`part.message_id` 有级联，但按 session_id 兜一层更稳）；
  - 最后 unlink rollout `~/.zcode/cli/rollout/model-io-<sid>.jsonl`。
- **动手前先 `.backup` 一份 zcode 库**：`db.sqlite.before-<场景>-<ts>.backup`。
- 这个范围用户拍板「要一起清」（2026-10-04）。`purge.py` 对 `provider=='zcode'` 的目标自动执行。

## 流程

1. **只读盘点**：`python3 scripts/inventory.py`（可 `--archived-only` / `--sort size`）。看一眼总量与候选。
2. **分桶**：按上面口径列出「净口水 / 边界」，**边界单独贴出交用户定**。
3. **快照**：`sqlite3 ~/.cloudcli/auth.db ".backup $HOME/.cloudcli/auth.db.before-chatter-cleanup-$(date +%Y%m%d-%H%M%S).backup"`（zcode 有目标时同样快照 zcode 库）。把 timestamp 存到 `/tmp` 备收尾用。
4. **干跑**：把候选 id 写成目标文件（每行一个 `session_id` 或 `provider_session_id`，支持前缀），
   `python3 scripts/purge.py --targets /tmp/targets.txt`（默认干跑）。核对：命中数、每条磁盘 EXISTS/absent、fork 依赖、superseded 数、WorkBuddy 目录、将被删的 zcode 行数。
5. **确认后 apply**：`python3 scripts/purge.py --targets /tmp/targets.txt --apply --backup <刚做的快照路径>`。
6. **回归核对**（见下）。
7. 若 UI 仍显示已删会话 → 重启服务刷新（`deploy-cloudcli`）或告知用户是内存缓存。

## 回归核对

用备份快照当 before，比较现在当 after：

```python
import sqlite3, os
cur=os.path.expanduser('~/.cloudcli/auth.db')
bak=os.path.expanduser('~/.cloudcli/auth.db.before-<场景>-<ts>.backup')
c=sqlite3.connect(f'file:{cur}?mode=ro',uri=True)
b=sqlite3.connect(f'file:{bak}?mode=ro&immutable=1',uri=True)   # 快照是 WAL 库，必须 immutable
before={r[0]:r[1] for r in b.execute("select session_id,jsonl_path from sessions")}
after ={r[0]:r[1] for r in c.execute("select session_id,jsonl_path from sessions")}
deleted=set(before)-set(after); added=set(after)-set(before)
print("删除", len(deleted), "预期", "<N>", "新增", len(added))
print("其余行 path 变更", [s for s in set(before)&set(after) if before[s]!=after[s]])
print("剩余 transcript 缺失", [(s,p) for s,p in after.items() if p and not os.path.exists(p)])
print("已删会话 transcript 残留", [before[s] for s in deleted if before[s] and os.path.exists(before[s])])
print("integrity_check:", c.execute("pragma integrity_check").fetchone()[0])
```

四个数都要干净：**被删数=预期、新增=0、其余 path 未变、已删 0 残留且剩余 0 缺失**。

## 常见坑

- 活动目录被误清 → 记得 `! -newermt '-10 minutes'`。
- 孤儿行（`jsonl_path` 为空）不是 zcode 独有；判 zcode 要看 `provider`。
- WorkBuddy 活会话误删（见上）。
- superseded 漏删 → 旧 transcript 被 watcher 重新索引成新会话。
- 备份命名不统一 → 收尾找不到对应快照。
- 服务在跑也能写 WAL 库，**不要**为清理停服务。
