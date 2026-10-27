# 清理线（cleanup）

把无用会话与垃圾从 DB 与磁盘清掉。**先读 SKILL.md §0 铁律**——先快照、干跑确认、物理删除、不动活物。

## 桶定义

### 秒杀区 — 不读直接可删（四条全中）

**必须四条同时成立**（判据原文见 SKILL.md §1.1）：

1. 真实用户轮数 = 1；
2. 内容简单：一句话口令（`reply with exactly: OK`、`收到请回复：收到`、`ping`、`只回复ok`、`Bundled run`、`models`）或 `Untitled Codex Session` / `New session` / smoke test；
3. 属于**部署 / 重启 / 清理 / 安装**这类纯操作；
4. 不产生任何「下次干活前必须先知道」的东西。

**第 3 条是分水岭。** 单轮但属于**查询 / 事实询问 / 能力探询**的，不进秒杀区：

| 例子 | 处置 |
|---|---|
| `grafana mcp 怎么关钉钉通知`（1 轮 165K） | 查询 → 快速评估 |
| `数独鸭小程序有没有`（2 轮） | 事实询问 → 快速评估 |
| `gitlab 能不能改项目备注` | 能力探询（常带权限边界）→ 快速评估 |

**快速评估**：不切片（单轮/两轮本来就只有一段），读一遍出结论，但它**仍是一条独立的停止点**：结论必须带**理由 + 重查成本 + ③ 的查询记录**，例如「结论是 UI 路径；`ov find grafana-通知` → 未检索到；重查约 1 分钟；无被否方案、无坑、无口径」。写不出这句话的，升级到 `triage-sediment.md` 的完整精读。

**只删纯秒杀。** 凡第 2 轮及以后是真实问题的，一律留在精读区（例：首问「收到请回复：收到」、第二条在问 clash 代理日志）。transcript 已丢的孤儿行也保留，除非用户明确要清。

用 `inventory.py` 出候选：`--sort size` + 轮数=1 + 名字像口令，再逐条过第 3 条。

### 邻接垃圾（「清理下垃圾」时按桶确认）

比秒杀区宽一档：不需要读会话内容，只看磁盘与库的结构性垃圾。

- **A 历史备份**：`~/.cloudcli/auth.db.before-*.backup*` 堆积。只留**最近一份**（即本轮快照），其余连 `-shm`/`-wal` 边车一起删。**绝不动**活库的 `auth.db-wal`/`auth.db-shm`。
- **B 空项目行**（`projects`，0 会话）：目录**已不存在**的删行；目录在、只是暂时没会话的**保留**。
- **C 孤儿会话行**：`jsonl_path` 为空的（transcript 已丢）删——**zcode 除外**（它本来就恒 NULL，见下）。
- **D provider 侧空目录**：`~/.claude/projects`、`~/.workbuddy/projects`、`~/.pi`、`~/.omp`、`~/.codex`、`~/.dsh` 等下的空目录。**必须加 `! -newermt '-10 minutes'`**——用户常同时开着别的 harness 会话，正在跑的目录会被误清。
- **E 仓库产物**（`test-results/`、`playwright-report/`、`dist/`、`dist-server/`）：**别动**，属部署/构建产物。
- **F bench 跑批会话**：项目路径含 `harness-bench`，且 user 轮**全部**命中 `scripts/harness-bench/run-bench.mjs` 的固定 `prompt`（S1 光速 / S2 工程分数 / S3 只有 `hi` / S4 JSON / S5 长城 / S6 `toolfile.txt` / S7 `sum.js` / S8 长文密码 / S11 记忆编号 `BENCH-9942` …），无一条自由输入 → 整批可删（2026-10-26 一次清掉 473 条）。**先报总条数让用户确认**；bench 工作目录（`/tmp/harness-bench/*`）可一并删，删完再按 B 清掉对应空项目行。

```bash
# D：只删 10 分钟以上没动的空目录
# 安全前提是 -empty：memory/ 这类非空目录不会被命中。
# 绝不能去掉 -empty，也不能换成 -name '*' 之类的「按名字删」——那样会把 memory/ 一起带走。
for d in ~/.claude/projects ~/.workbuddy/projects ~/.pi ~/.omp ~/.codex ~/.dsh; do
  [ -d "$d" ] || continue
  find "$d" -mindepth 1 -depth -type d -empty ! -newermt '-10 minutes' -delete 2>/dev/null || true
done
```

### 已沉淀会话 — 只是「③ 成立」，不等于可删

「已沉淀」的判定不是 cloudcli 的字段，而是 **`s:` 引用**（`session-sediment` 落的）：memory-bank 与 **db dict**（`docs/db-dictionary/_sediment-log.md`）两处都算。`s:` 引用绝大多数指向早已删除的会话（引用悬空、只剩沉淀），属正常态，不用追。

用 `sediment_refs.py` 交叉匹配（默认同时扫 bank 与 db dict，`--no-dict` 可关）。

**`s:` 命中只买到一张「③ 候选」的门票，买不到删除资格。** 三个理由：

1. **命中只证明有东西落过，不证明全部落过。** 一条会话同时产出 bank 与 db dict 两类知识，只落了 bank 那半就删 = db 那半永久丢失，原料没了无法补救。要逐项核对该会话在草稿里的每个落点是否都有对应命中。
2. **沉淀条目往往是「主结论」，会话里可能还挂着附加内容**：被否方案的完整理由、踩坑路径、临时固定值、权限边界——这些通常不会进条目，但删了就没了。这正是 2026-10-24 三条同题会话被打包误删的成因。
3. **条目可能比会话更浅，甚至来自另一条会话。** 命中 ≠ 覆盖。

所以走完：**先按 §精读把该会话的段落过一遍（至少确认没有条目外内容）**，再让 ①②③ 同时成立，才允许进删除清单。

删除时那条会话的 `s:` 引用会变悬空，这是正常态——沉淀还在，别去清引用。

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

### 反判据失效：先正向证明它是 psid，再谈删

上面这条「无同名 `.jsonl` ＝ 死残留」是**排除法**，它只在「目录名一定是 psid」的前提下成立。这个前提不成立：

- `~/.workbuddy/projects/<project>/` 下**混着非会话数据**。已确认的一类是 **`memory/`**——WorkBuddy 的持久记忆库（`MEMORY.md` + 主题 `.md`，自动记忆系统落点）。它既不叫 psid、也没有同名 `.jsonl`、更不在 `sessions` 表里，**三条排除法全部命中，但它是最不该删的东西**。
- 后果不可逆：`shutil.rmtree` 不走废纸篓，~/.workbuddy 下无第二份副本，APFS 本地快照/Time Machine 常常也没有（本案就没有）。删掉 = 正文永久丢失，只剩 `MEMORY.md` 索引行。
- 实际发生过：一次「清 workbuddy 死残留」按排除法扫，把 16 个项目的 `memory/` 全删了，约 1.4 MB、含本项目全部记忆。

**改为白名单式判据**（三条同时满足才可删）：

1. 目录名**匹配 UUID 形态** `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` —— 不匹配就跳过，文件名叫 `memory`、`drafts`、`subagents`、`.cache` 的一律不碰；
2. 无同名 `.jsonl`；
3. 既不在 `sessions` 也不在 `superseded_provider_sessions`，且 mtime 早于 10 分钟。

**不要对 `~/.workbuddy/projects/` 用 `find -type d -delete` / 递归删除脚本**，只按上述三条逐个 `rmtree`。同类风险存在于别的 harness 目录：`~/.claude/projects/` 下也按项目分目录，凡遇到「项目级目录里除了会话还有别的子目录」的布局，都必须先 `ls` 看清再动手。

`scripts/purge.py` 在删 WorkBuddy 会话时会顺手 `rmtree` 同名目录，并跳过「仍是别的在库会话 psid」的目录。

## WorkBuddy 的 trace 与心跳（`purge.py` 不覆盖）

这两个位置不在 `purge.py` 的处理范围里，但能比 transcript 还大。

- **trace**：`~/.workbuddy/traces/<pid>/trace_<uuid>.json`（一个进程一个目录）。实测 2026-10-26 清一条 546 MB 的 transcript 时，该会话专属 trace **46 个共 337 MB**。
- **心跳**：`~/.workbuddy/sessions/<pid>.json`，字段 `pid` / `sessionId` / `lastHeartbeat` / `kind`。进程退出后文件仍留着。

**归属判定靠文件内容，不靠文件名**：trace 是 JSON，读全文抽 UUID 集合——

- 集合里**只有**该会话 id ⇒ 专属，可删；
- 同时含多个会话 id ⇒ 同批并发跑共用，删了会误伤别人的记录，**必须保留**（那次 8 个共 24 MB 全部保留）。

```bash
# 先筛再删：只打印，不删除
python3 - <<'EOF'
import glob, os, re
target = "<session-id>"
pat = r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
only, shared = [], []
for f in glob.glob(os.path.expanduser("~/.workbuddy/traces/*/trace_*.json")):
    ids = set(re.findall(pat, open(f, errors="ignore").read()))
    if target in ids:
        (only if ids == {target} else shared).append((f, os.path.getsize(f)))
print("专属", len(only), sum(s for _, s in only) // 1024 // 1024, "MB")
print("共用保留", len(shared), sum(s for _, s in shared) // 1024 // 1024, "MB")
EOF
```

**心跳按 pid 判活**，`kill -0` 失败（进程已退）才删；pid 还活着的一律不动——那可能是正在跑的会话。

```bash
for f in ~/.workbuddy/sessions/*.json; do
  pid=$(basename "$f" .json)
  kill -0 "$pid" 2>/dev/null || echo "dead $f $(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["sessionId"])' "$f")"
done
```

## zcode / opencode 的特殊口径（**单侧删除必然复活**）

这两个 provider 把所有会话放在**一个共享 sqlite 库**里，没有各自的 transcript 文件：

| provider | 库路径 |
|---|---|
| zcode | `~/.zcode/cli/db/db.sqlite`（另有 `~/.zcode/cli/rollout/model-io-<sid>.jsonl`）|
| opencode | `~/.local/share/opencode/opencode.db` —— **不在 `~/.opencode/`**，那个目录根本不存在 |

**头号坑：只删 cloudcli 侧等于没删。** app 行删了、provider 库里的行还在 ⇒ watcher 下一轮就把会话重新索引回来，用户看到「删掉的会话又出现了」。这已不是"可能"，是必然。

- 应用内「永久删除」现已覆盖两侧（服务端为两个 provider 实现了 `deleteProviderSession`，见 `sessions.service.ts:deleteOrArchiveSessionById`）；**脚本必须照做**，否则同样的复活会再来一次。`purge.py` 已同时清两侧。
- 两侧删除都**在删 app 行之前**完成：失败时两侧都还在、可以重试。若先删 app 行再把异常吞掉，就会留下一个只有 provider 库知道的"游魂会话"。

**复活是怎么发生的（判据）**：两个 provider 的 `synchronizeFile` 都是 `synchronizeRows(undefined, LIMIT 1)` —— 不看扫描游标，只按 `time_updated DESC` 取**最新 1 条**。所以只要 provider 库被写过（哪怕你只是删掉了别的会话），库里仅剩的那条就会被当成"最新"捞回来。

判据一句话：**清完 provider 库要看它的 `session` 表是否真的少了那几行，不能只看 cloudcli 库。**

删除要点：
- **读活动中的库不能加 `immutable=1`**（会跳过 WAL，把未 checkpoint 的会话读成 0 行）；用 `?mode=ro`。`immutable` 只给静态快照用。
- 破坏性操作**不依赖级联生效**：`PRAGMA foreign_keys=ON` 之外，还要按 `session_id` 显式删从属表（schema 版本之间会变，赌不起）。
  - zcode：`part` / `message` / `input_history` / `dwf_actor`。`part` 挂在 `message` 上，**不是**挂在 `session` 上。
  - opencode：`part` / `message` / `session_context_epoch` / `session_input` / `session_message` / `todo` / `session_share`，外加 `event` / `event_sequence` 两张以 **`aggregate_id`** 为键的表（没有 session 列）。
- 动手前先 `.backup`：`db.sqlite.before-<场景>-<ts>.backup` / `opencode.db.before-<场景>-<ts>.backup`。

**cloudcli 对这两个 provider 是增量收录**（服务端游标 `scan_state.last_scanned_at` + watcher 只补最新 1 条）⇒ **早于游标、之后不再被写到的会话永不补录**。所以它们的垃圾可能**根本不在 cloudcli 库**：`inventory.py` 会额外列出「provider 库独有」会话（arch 列显示 `-`），`purge.py` 也接受这类目标。

若某条会话**同时**在 cloudcli 库和 provider 库里查不到，别急着当已清理——先跑 `inventory.py` 看「库独有」那一段。

## 流程

1. **只读盘点**：`python3 scripts/inventory.py`（可 `--archived-only` / `--sort size`）。看一眼总量与候选。
2. **二分成两堆，不许分第三堆**：
   - **秒杀区**：四条全中（§秒杀区），可以直接进干跑清单；
   - **其余全部**：进 `triage-sediment.md` 的逐条精读，**包括单轮查询类、包括「同题重复」、包括 fork 父子**。

   禁止按「题目一样」「看起来像重复」把会话并进秒杀区——这是本 skill 被改造的直接原因（SKILL.md 铁律 7）。
3. **快照**：`sqlite3 ~/.cloudcli/auth.db ".backup $HOME/.cloudcli/auth.db.before-<场景>-$(date +%Y%m%d-%H%M%S).backup"`。**zcode / opencode 有目标时同样快照它们的库**。把 timestamp 存到 `/tmp` 备收尾用。
4. **干跑**（秒杀区 + 邻接垃圾）：把候选 id 写成目标文件（每行一个 `session_id` 或 `provider_session_id`，支持前缀），
   `python3 scripts/purge.py --targets /tmp/targets.txt`（默认干跑）。核对：命中数、每条磁盘 EXISTS/absent、fork 依赖、superseded 数、WorkBuddy 目录、**将被删的各 provider 库行数**。
5. **确认后 apply**：`python3 scripts/purge.py --targets /tmp/targets.txt --apply --backup <刚做的快照路径>`。
6. **回归核对**（见下）—— **含 provider 库的 `session` 表行数**。
7. 若 UI 仍显示已删会话 → 重启服务刷新（`deploy-cloudcli`）或告知用户是内存缓存。

> 精读区的删除**不在这里干跑**：这些会话的删除明细写在每条读完时的清单里（SKILL.md §3.3），用户点头后同样走第 4~6 步。

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

**zcode / opencode 另加一项**：两个 provider 库里各表也要核对（`session` 行数按预期减少、`message`/`part` 无孤儿）。只核 cloudcli 库会漏掉「provider 侧没删干净」这种复活源——见 §zcode / opencode 的特殊口径。

## 常见坑

- 活动目录被误清 → 记得 `! -newermt '-10 minutes'`。
- 孤儿行（`jsonl_path` 为空）不是 zcode 独有；判 zcode 要看 `provider`。
- **WorkBuddy 活会话误删**（见上）。
- **trace / 心跳不在 `purge.py` 范围**：删完大会话要单独筛 `~/.workbuddy/traces/<pid>/`，共用文件不能删（见「WorkBuddy 的 trace 与心跳」）。
- superseded 漏删 → 旧 transcript 被 watcher 重新索引成新会话。
- 备份命名不统一 → 收尾找不到对应快照。
- 服务在跑也能写 WAL 库，**不要**为清理停服务。
- **provider 库只删一侧 ⇒ 会话必然复活**（zcode / opencode，见上）。
- **opencode 库不在 `~/.opencode/`**，在 `~/.local/share/opencode/`——那个目录不存在，别照着路径猜。
- 干跑时 provider 库「命中 0 条」要分清是「已清空」还是「路径写错」：后者会静默什么都不删。
- **按「同题/像重复」打包删** —— 最贵的一次错（2026-10-24，3 条 18~36 轮的会话）。题目相同不构成理由，见 SKILL.md 铁律 7。
- **单轮 ≠ 秒杀** —— `grafana 怎么关通知` 这类查询单轮也进精读；秒杀的第 3 条（纯 ops）才是分水岭。
