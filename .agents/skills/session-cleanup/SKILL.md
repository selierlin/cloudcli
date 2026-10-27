---
name: session-cleanup
description: CloudCLI 会话清理与沉淀——两步制：秒杀区（单轮纯 ops）批量清掉，其余会话逐条精读（每段 1~5 轮、读段即落草稿、一条一停），三问判据（可重建 / 代码外信息 / OV 是否已覆盖）决定删或沉淀。含物理删除语义、快照→干跑→确认→apply 纪律、各 provider 的 transcript 与残留布局、向 session-sediment 的交接。触发词：清理口水会话、清理垃圾、清理无用会话、清会话、清理残留、清理孤儿目录、归档会话评估、哪些会话值得沉淀、会话沉淀、会话治理。
disable-model-invocation: true
---

# CloudCLI 会话清理（session-cleanup）

**秒杀区一次清完；剩下的一条一条读，读一段落一段，一条一停。**

| 线 | 对象 | 节奏 | 分册 |
|---|---|---|---|
| **秒杀区** | 单轮纯 ops（四条全中，§1.1） | 干跑 → 清单 → 确认 → apply，可批量 | `references/cleanup.md` |
| **精读区** | 其余**全部**（含 1 轮的查询类） | **一条会话 = 一个停止点**，段 1~5 轮 | `references/triage-sediment.md` |
| 邻接垃圾 | 备份堆积、空项目行、孤儿目录、共享库残留 | 判据确定，可批量 | `references/cleanup.md` |

典型连跑：**秒杀区 → 邻接垃圾 → 逐条精读（一条一停）→ 沉淀 → 删**。

**本 skill 只负责「选出」，正式条目由 `session-sediment` 写。**

## 0. 铁律（先读这一节）

1. **任何写操作前先做一致性快照**：`sqlite3 ~/.cloudcli/auth.db ".backup <path>"`，命名 `auth.db.before-<场景>-<YYYYMMDD-HHMMSS>.backup`。涉及 zcode / opencode 库时同样快照。服务在跑不用停（WAL 下直接写安全）。
2. **删除 = 物理删除**：DB 行（`sessions` + 该会话的 `superseded_provider_sessions`）+ `fs.unlink` 主 transcript 及**所有** superseded 路径；**zcode / opencode 还要删共享库里的行**（否则复活）。等价于应用内 `permanentlyDeleteArchivedSessions({force:true, deletedFromDisk:true})`。
3. **干跑 → 贴清单 → 等确认 → `--apply`**，不要边发现边删。精读线例外：§3.3 的清单本身即干跑输出，用户在那个回话里点「删」即确认。
4. **活的东西一律不碰**：其它 harness 正在跑的会话（`-newermt '-10 minutes'` 兜底）、`auth.db-wal`/`auth.db-shm`、目录仍在的空项目行、WorkBuddy **应用本体**会话，以及**当前这次对话自己的会话行**——名字常常正好等于本次命令原文、transcript mtime 就在刚刚。**`purge.py` 没有这条守卫**，必须人工排除：名字等于本次命令、或 transcript mtime 在 10 分钟内，一律跳过。
5. **删前查 fork**：`select count(*) from sessions where forked_from_session_id=<sid>`，有下游就停下问。
6. **删目录必须正向匹配 UUID，不许用排除法**（2026-10-27 新增，代价是永久数据丢失）。
   - `~/.workbuddy/projects/<project>/` 下**混着非会话目录**，最要命的是 `memory/`（WorkBuddy 持久记忆库）。它「不叫 psid + 无同名 jsonl + 不在 sessions 表」——排除法三条全中，但它是**最不能删**的。已实际误删过 16 个项目的 `memory/`，`rmtree` 不走废纸篓、无快照，正文不可恢复。
   - 规则：目录名必须匹配 `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` 才进入删除候选；**禁止对 `~/.workbuddy/projects/`、`~/.claude/projects/` 这类项目级容器做 `find -delete` 或整目录递归删**。详见 `references/cleanup.md` §反判据失效。
7. 收尾必做**回归核对**：被删数=预期、其余行 `jsonl_path` 未变、其余 transcript 0 丢失、`pragma integrity_check` = ok。**zcode / opencode 另核它们库的 `session` 表行数**。
8. **同题 ≠ 同内容**（2026-10-24 新增）。同 provider、同项目、同题目，只说明可以排在一起读，**不构成删的理由**。
   - 实测教训：把三条同题会话（ov 查「按摩订单已完成无核销」）按「题目重复」打包判删。它们各自 18~36 轮、5.8~9.6 MB，主题之外挂着被否方案、坑、权宜值。当时写的「重复」是**题目**重复，不是**内容**比对过。
   - fork 父子：**读可以复用前缀**（子会话前半段是父的原样复制），**判定必须各自独立**。
9. **没读过的不许进判据**（2026-10-24 新增）。任何处置的理由必须能指到「读了第几轮」。指不到 → 处置栏留空，不许填「删」。

## 1. 两种节奏

### 1.1 秒杀区（不读直接可删）：四条必须同时成立

1. **真实用户轮数 = 1**（按轮算，不是 transcript 行数）
2. 内容简单：一句话口令 / `Untitled` / `New session` / smoke test
3. 属于 **部署 / 重启 / 清理 / 安装** 这类纯操作
4. 不产生任何「下次干活前必须先知道」的东西

**不满足第 3 条就不进秒杀区，哪怕只有 1 轮。** 典型反例（都走 §3 的精读，不是秒杀）：

| 例子 | 为什么不是秒杀 |
|---|---|
| `grafana mcp 怎么关钉钉通知`（1 轮 165K） | 是**查询**，不是 ops |
| `数独鸭小程序有没有`（2 轮） | **事实询问** |
| `gitlab 能不能改项目备注` | **能力探询**，往往附带权限边界 |

这三类走**快速评估**：不切片（本来就只有一两段），读一遍出结论，但它**仍是一条独立的停止点**——结论必须带理由 + 重查成本 + ③ 的查询记录（例：「结论是 UI 路径；`ov find grafana-通知` → 未检索到；重查约 1 分钟；无被否方案、无坑、无口径」）。写不出这句话的，升级到完整精读。

### 1.2 精读区：一条一停

- **段 = 1~5 轮**，切点由我按「话题是否连续」定，不硬凑条数。
- **读一段落一段**：每段读完先写草稿，不攒到最后。
- **读完一条就停**：出「这条建议沉淀什么 + 冲突项 + 删除建议」，等回话，才动下一条。
- **一条读完 ≠ 一批读完**：用户说「继续」= 继续下一条会话，不是「继续删」。
- **唯一的加速口**：用户当轮明确说「别问了 / 一次评完 / 连读 N 条」，才可跳过停止点。**即便如此，仍要逐段读、逐段落盘**——省的只是回话，不是读法。

## 2. 判据：三问 + 证据锚点

### 2.1 三问

| # | 问题 | 谁回答 | 在判定里的角色 |
|---|---|---|---|
| ① | 结论能从代码/库/git 现状重建？ | 我，看代码 | **只能否决**：答「不能重建」→ 有价值。答「能重建」**不构成删的理由**。 |
| ② | 有代码外信息吗？（被否方案及理由 / 踩坑路径 / 不可逆写操作的口径 / 权宜标记） | 我，读会话 | **直接判有价值**，此后不再问 ③。 |
| ③ | OV 里这个口径已经有了、而且比这段更全吗？ | **查了才知道**（`ov find`） | **删的必要条件**：没查就没有删除资格。 |

**判删的唯一路径 = ①②③ 同时成立。**

为什么 ③ 不能当准入门槛：OV 覆盖稀疏、滞后，「未检索到」只说明检索没命中，不能反推没价值。反过来，③ 命中也不证明这段没价值（条目可能来自另一条会话、写得更浅、是旧口径）——所以它只是「不必留」的旁证，必须和 ①② 一起才成立。

**① 的失效模式**：判「能重建」靠的是我对代码的印象，而不是当场读。**没读过的东西，最容易觉得「代码里肯定有」**。所以 ① 只能用来发现价值，不能用来批准删除。

### 2.2 证据锚点（写不出就不许删）

| 结论 | 必须写出 |
|---|---|
| 有价值 | **引原句** + 轮次区间：`第 12–14 轮：「XX 方案被否，因为 YY」` |
| 无价值 | `读了第 x–y 轮` **且** `ov find "<query>" → 未检索到`（或「命中 <条目>，比本段更全」） |

缺任一样 → 处置栏留空。这样判断失准时能一眼分清是「判错了」还是「压根没查」。

### 2.3 措辞纪律

查 OV 的结论只能写 **「未检索到」**，不许写「OV 里没有」。前者是检索事实，后者是覆盖断言——后者正是「以为已经沉淀过」的成因。

检索词用**具体对象名**（表名、类名、接口路径、报错片段），别用自然语言长句。

## 3. 精读循环（一条会话内部）

```
读第 x–y 轮（1~5 轮）
  ↓
① 这段能不能只靠代码/库/git 复述？
  ├─ 不能 → 有价值
  └─ 能   → ② 有代码外信息吗？
            ├─ 有 → 有价值（不再问 ③）
            └─ 没有 → ③ ov find "<具体对象名>"
                      ├─ 命中且更全 → 这段可以不留
                      └─ 未检索到   → 「不确证」，留到整条读完后判
  ↓
把本段结论写进草稿（有货才展开；无货写一行「第 x–y 轮：无」）
  ↓
还有轮次 → 回到第一行
读完 → 出「沉淀建议 + 冲突项 + 删除建议」→ 停
```

**查询预算**：只有走到 ③ 的段落才查 OV；同会话连续几段同主题可合并成一次 `find`。段段先查是浪费上下文。

### 3.1 草稿落点与形态

`~/.memory-bank/<project>/drafts/<sid前8位>.md`；项目按 `sessions.project_path` 反查（**别按 provider 猜**）。

```markdown
---
sid: <完整 session_id>
provider: workbuddy
project: <project_path>
started: <updated_at>
read: 1-15 / 40        # 每段读完更新，也是被压缩后的恢复锚点
---

## 第 1–5 轮
- 有价值：<一句话> — 原句「…」

## 第 6–10 轮
- 无
```

三条硬规矩：

- **只写不可重建的部分**。代码现状、过程叙述、我当时怎么试的，一律不写——写进去过几个月会失真，是负债不是资产。
- **草稿里用 `sid:` 前缀，不许写 `s:`**。`sediment_refs.py` 扫 `~/.memory-bank/**/*.md` 的 `s:` 引用；草稿写成 `s:` 会被当成「已沉淀」，让未定稿的会话凭空获得删除资格。`s:` 只由 `session-sediment` 在正式条目里写。
- **草稿是抗压缩锚点**：上下文被压缩后，先读草稿的 `read:` 行确认读到哪，再续读，不靠记忆。

### 3.2 每段回给用户什么（一行，别写长文）

```
第 7 条 · 66dc5b0b · 读到 6–10/28 · 本段：「核销口径第三条被否，原因是…」→ 记 bank
第 7 条 · 66dc5b0b · 读到 11–15/28 · 本段：无
```

### 3.3 一条读完：只出这三样，然后停

1. **沉淀建议**：`kind`（knowledge / case / checkpoint）+ 落点（bank 条目名 / db dict 域文件）+ 一句话标题
2. **冲突项**：本会话口径与 OV/bank 现有口径相反的，单列，**不许静默覆盖**
3. **删除建议**：仅当 ①②③ 全成立；附将删明细（DB 行 / transcript / superseded / 共享库行）

用户点头 → 交 `session-sediment` 落正式条目 → 才取下一会话。

同一轮治理里若多条会话命中同一个 db dict 域文件，**改动先聚合再写**：合并成一份 diff、一次签核，不许按会话逐条 apply（否则前一次的 diff 被后一次踩掉）。聚合时若两条会话对同一张表给出相反口径，**单独列出来问**。

## 4. 目标模型

**DB**：`~/.cloudcli/auth.db`

- `sessions`：PK `session_id`；另有 `provider`、`provider_session_id`、`custom_name`、`project_path`、`jsonl_path`、`isArchived`、`isPinned`、`forked_from_session_id`、`name_source`、`updated_at`。
- `superseded_provider_sessions`：PK `(provider_session_id, provider)`；含 `session_id`、`jsonl_path`。一条会话被 provider 换过 id 时，旧 transcript 记在这里——**删会话必须连它一起删**，否则 watcher 会把旧文件当新会话重新索引。
- `projects`：`project_id`、`project_path`、`isStarred`、`isArchived`。

**磁盘 transcript（按 provider）**：

| provider | 主 transcript | 备注 |
|---|---|---|
| claude | `~/.claude/projects/**/<uuid>.jsonl` | |
| workbuddy | `~/.workbuddy/projects/**/<psid>.jsonl` | 同名 `<psid>/` 目录＝子代理 + tool-results 残留 |
| codex | `~/.codex/sessions/**/rollout-*.jsonl` | |
| pi / omp | `~/.pi/agent/sessions/**`、`~/.omp/agent/sessions/**` | |
| zcode | **无**（`jsonl_path` 恒 NULL） | 会话在共享库 `~/.zcode/cli/db/db.sqlite`；另有 `~/.zcode/cli/rollout/model-io-<sid>.jsonl` |
| opencode | **无**（`jsonl_path` 恒 NULL） | 会话在共享库 `~/.local/share/opencode/opencode.db`（**不在 `~/.opencode/`**） |
| dsh | `~/.dsh/sessions/<proj>/<session-uuid>/` | 常见只剩 0 字节 `session.lock` 残留 |

**zcode / opencode 是共享库**：app 行只是索引，删它不删 provider 库 ⇒ 会话必然复活。两个 provider 必须**两侧都清**才叫删干净。

**沉淀库**：`~/.memory-bank/<project>/entries/*.md` 是**本机产出**的副本（只覆盖本机，不是全集）；`viking://resources/<project>/session-sediments/` 是跨机器**唯一共享汇聚层**。别机条目本机没有属正常态，不做反向补齐（见 session-sediment §多机环境）。
**db dict**：`~/Projects/lemobar/ToC-Admin/docs/db-dictionary/`（OV 镜像 `viking://resources/ToC-Admin/2026-09-20-db-dictionary/`）。只收 ToC-Admin 业务库，cloudcli 自己的库仍落 memory-bank。

**服务**：`~/.cloudcli/local-server.json` 里有端口（本机现值 3011）。删完 UI 若还列着旧会话，那是服务端 `sessionHistoryCache` 内存缓存，重启即消。

## 5. 脚本（`scripts/`，默认只读/干跑）

| 脚本 | 作用 | 默认 |
|---|---|---|
| `inventory.py` | 只读盘点：会话表 + 体积 + 真实用户轮数 + 磁盘状态 + 首问预览（zcode / opencode 行另读各自库；并列出 cloudcli 未收录的「provider 库独有」会话） | 只读 |
| `purge.py` | 物理删除（DB 行 + transcript + superseded + WorkBuddy 残留目录 + zcode / opencode 共享库） | **干跑**；`--apply` 需 `--backup` |
| `sediment_refs.py` | 采集 `s:` 引用（memory-bank + db dict）并与会话交叉匹配；`--bank` / `--dict` 可重复，`--no-dict` 跳过 db dict | 只读 |
| `extract.py` | 按 provider 抽取对话脉络（USER/末答）；可一次给多个路径，`--start/--limit` 按轮切片（**精读分段就靠这两个参数**） | 只读 |

分段读法（1-based）：

```bash
python3 scripts/extract.py <path> --max 200 --start 1  --limit 5
python3 scripts/extract.py <path> --max 200 --start 6  --limit 5
```

## 6. 交接

选中「值得沉淀」的会话后，**不在这里写条目**——点名调用用户级 skill `session-sediment`（`/session-sediment`）：它负责起草、写 `s:` 引用、落 `~/.memory-bank/`、同步 OV。**一次交一条**，说清「这一条会话、归到哪个项目、草稿路径、拟定 kind、是否有同主题旧条目」。草稿（`drafts/<sid>.md`）作为原料一并交出，**正式条目落地后删掉草稿**，别让它长期躺在 bank 里被当成沉淀。

## 7. 红线与失败处理

- 服务在跑时**不要**删 `auth.db-wal`/`auth.db-shm`；`.backup` 产物是完整的独立库，其边车里 `-wal` 恒 0 字节，删边车无损。
- `.backup` 产物是 WAL 库，只读打开须加 `?mode=ro&immutable=1`，否则报 `unable to open database file`。
- **反过来，读「活动中的」WAL 库（zcode `db.sqlite`、opencode `opencode.db`）不能加 `immutable=1`**——它会跳过 WAL，未 checkpoint 的提交读不到（曾把已存在的会话读成 0 行）。用 `?mode=ro`。
- 别用 `.backup` 快照反推磁盘文件是否删除（快照只救 DB 行，**文件删了不可恢复**）。
- **zcode / opencode：只删 cloudcli 侧 ≠ 删掉**。应用内「永久删除」已覆盖两侧（`deleteProviderSession`），脚本也必须照做。两库路径见 §4，要手清的表见 cleanup 分册。
- 遇到「删了但 UI 还显示」：是内存缓存，先重启确认，别重复删。**但如果过一会儿会话自己回来了**，那是复活，不是缓存。
- **上下文被压缩 / 记忆混乱时**：以草稿的 `read:` 行为准恢复进度，不复述上一段的细节；发现草稿与记忆冲突，信草稿。草稿丢了就重读那一段，别猜。
