---
name: session-cleanup
description: CloudCLI 会话清理与沉淀——清理无用会话（口水/smoke test、邻接垃圾、已归档无价值、已沉淀）与沉淀有价值会话到 memory-bank / OpenViking。含物理删除语义、先快照→干跑→确认→apply 纪律、各 provider 的 transcript 与残留布局、价值判定口径、以及向 session-sediment 的交接。触发词：清理口水会话、清理垃圾、清理无用会话、清会话、清理残留、清理孤儿目录、归档会话评估、哪些会话值得沉淀、会话沉淀、会话治理。
disable-model-invocation: true
---

# CloudCLI 会话清理（session-cleanup）

两条线，可单跑也可连跑。**本 skill 只负责「选出」——真正的内容沉淀交给 `session-sediment`。**

| 线 | 目的 | 做什么 | 分册 |
|---|---|---|---|
| **清理** | 让侧边栏与磁盘只剩有用的会话 | 口水会话、邻接垃圾、残留目录/文件、已沉淀会话 | `references/cleanup.md` |
| **评估与沉淀** | 把有价值的会话内容留下 | 评估会话价值 → 无价值的删、值得的交给沉淀技能 | `references/triage-sediment.md` |

典型连跑顺序（就是本 skill 来源的那轮）：**清口水 → 清邻接垃圾 → 评估列表 → 沉淀值得的 → 删已沉淀的**。

**评估沉淀线默认是「一批一停」的循环，不是一次评完** —— 先读 §1 再动手。

## 0. 铁律（先读这一节）

1. **任何写操作前先做一致性快照**：`sqlite3 ~/.cloudcli/auth.db ".backup <path>"`，命名 `auth.db.before-<场景>-<YYYYMMDD-HHMMSS>.backup`。涉及 zcode / opencode 库时同样快照它们。服务在跑不用停（WAL 下直接写安全）。
2. **删除 = 物理删除**，不是归档、不是隐藏：删 DB 行（`sessions` 行 + 该会话的 `superseded_provider_sessions` 行）+ `fs.unlink` 主 transcript 及**所有** superseded 路径；**zcode / opencode 还要删它们共享库里的行**（否则复活）。等价于应用内 `permanentlyDeleteArchivedSessions({force:true, deletedFromDisk:true})`。用户说「删」就是这个语义（2026-09-24 明确补过一句「还要物理删除」）。
3. **干跑 → 贴清单 → 等确认 → `--apply`**。不要边发现边删。评估沉淀线例外：§1 分诊表里带删除明细的条目**本身就是该批的干跑清单**，用户在批回话里点「删」即确认，不必再跑一遍。
4. **活的东西一律不碰**：本机其它 harness 正在跑的会话（用 `-newermt '-10 minutes'` 兜底）、`auth.db-wal`/`auth.db-shm`、目录仍在的空项目行、WorkBuddy **应用本体**会话（不是 cloudcli 库里的，见 cleanup §WorkBuddy），以及**当前这次对话自己的会话行**——它就在 `sessions` 表里，名字常常正好等于本次命令原文、transcript mtime 就在刚刚，最容易被当成口水会话删掉。**`purge.py` 没有这条守卫**（漏写不报错，直接 unlink 活 transcript，重建后文件头部永久丢失），必须人工排除：名字等于本次命令、或 transcript mtime 在 10 分钟内，一律跳过。
5. **删前查 fork**：`select count(*) from sessions where forked_from_session_id=<sid>`，有下游就停下问。
6. 收尾必做**回归核对**：被删数=预期、其余行 `jsonl_path` 未变、其余 transcript 0 丢失、`pragma integrity_check` = ok。**zcode / opencode 另核它们库的 `session` 表行数**——只核 cloudcli 库会漏掉复活源。

## 1. 工作节奏：分批循环，停止点由用户给

**清理线**（判据确定、不需要读内容）可以一口气干完，按 §0 铁律走「干跑 → 确认 → apply」即可。

**评估沉淀线必须分批**：一批读一点 → 出一份分诊表 → **停下来等用户回话** → 用户回话后才取下一批。理由：整库会话内容一次灌进上下文，前面的结论会污染后面的判断，而且信息过载时「值不值得沉淀」很容易退化成拍脑袋。

**循环**

1. **划批一次**：`inventory.py` 只跑一次，拿全量清单（体积/轮数/首问）。按「小会话」组批：每批 6~10 条、预览合计 ≤ 约 30KB；**同 provider / 同项目优先同批**（口径一致、方便用户一次拍）。
   - **划批按清单逐条打勾，不按 provider 手感挑**：踩过 opencode 那条归档会话连着 8 批没被带出来，因为每批都在 workbuddy 里挑。每批结束核一次「已处理 + 剩余 = 总数」，差额就是漏掉的。
   - 分批只看归档/全部的范围参数，别在中途换口径（换了就会漏或多）。
2. **读一批**：小会话用一次 `extract.py` 多路径调用**读完**（`--max 200` 只压答案长度；控制预算靠批内条数，别用 `--limit` 把短会话截断）。
3. **出分诊表**：每条一行「处置 + 一句理由 + 依据」。建议删的条目必须附「将删什么」（DB 行 / transcript 路径 / superseded / 共享库行）——**这份表就是干跑输出，用户点「删」即可直接 apply**，不要再来一轮干跑。
4. **停**。不预读下一批、不替用户拍板、边界项不自己选。
   - **「按你推荐的」只授权当前这张表**：它覆盖的是本批已列出的条目，**不构成对下一批的预授权**。下一批照样要贴表、照样要等回话。踩过：第 6 批获批后顺手读了第 7 批并直接 apply，11 条没经同意就删了。批与批之间是新的决策点，不是同一决策的延续。
   - 同理，用户说「继续」= 继续读下一批，不是「继续删」。
5. 用户回复 → **先执行本批的删与沉淀**，再取下一批，回第 2 步。

**每批只回三块**（别写成长文）

```
本批 7 条 · 累计 13/48 · 第 2 批
[分诊表]
下一批：第 3 批，9 条，共约 24KB —— 继续？
```

**上下文卫生**：批与批之间只带「一行结论」，不把上一批的对话细节带下去。分诊表要能独立看懂（带 sid 前缀、名字、体积、轮数），不依赖上一批的上下文。

**长会话不进批，分片读**（怕一条会话吃满上下文）

1. 阈值：**真实轮数 > 12**，或**预估预览量（轮数 × 每轮截断）> 30KB** 才算长会话。**别用 transcript 体积判**——workbuddy 的体积绝大部分是工具结果，31M/59 轮和 1.1M/2 轮读起来的成本差得远；体积只用于估「读全」的成本，不用于判是否分片。
2. 先看头：`extract.py <path> --limit 8` 拿首问与前几轮，判断主题。
3. **有明确价值信号就收口**：看到业务规则/架构决策/根因/字段口径，直接给「本会话值得沉淀，落在 X」，不必读完。
4. 没定性 → 报「读到第 1-8/40 轮，暂未见可沉淀内容，继读？」→ **等用户回话** → `--start 9 --limit 8` 续读。
5. 每片都带「已读到 x/y，剩 z 轮」，让用户能决定还要不要读。
6. 也可以直接给「整条看起来是调试过程，建议判无价值、不必逐片读」——但**由用户拍**。

**唯一的例外**：用户明确说「别问了，一次评完」，才可退出批模式；否则默认就是一批一停。

## 2. 目标模型

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

**zcode / opencode 是共享库**：app 行只是索引，删它不删 provider 库 ⇒ 会话必然复活。这两个 provider 必须**两侧都清**才叫删干净。

**沉淀库**：本地权威副本 `~/.memory-bank/<project>/entries/*.md`；OV 检索镜像 `viking://resources/<project>/session-sediments/`。

**服务**：`~/.cloudcli/local-server.json` 里有端口（本机现值 3011）。删完 UI 若还列着旧会话，那是服务端 `sessionHistoryCache` 内存缓存，重启即消（应用自身的删除路径也不清它）。

## 3. 判据速查

**清理线（是不是该删）**

| 类别 | 判据 | 出处 |
|---|---|---|
| 口水会话 | 单轮/一行口令、体积仅几十 KB、名字就是那句口令或 `Untitled`/`New session` | cleanup §口水 |
| 邻接垃圾 | 旧备份、目录已不存在的空项目行、孤儿会话行、provider 侧空目录 | cleanup §垃圾 |
| 已沉淀会话 | memory-bank 的 `s:` 引用能匹配到它 → 内容已在 OV，删掉不丢信息 | cleanup §已沉淀 |
| WorkBuddy 孤儿目录 | uuid 不在库 **且** 无同名 `.jsonl` 才是死残留；有同名 `.jsonl` 的是应用本体会话，**不能删** | cleanup §WorkBuddy |

**沉淀线（值不值得留）**

| 桶 | 判据 | 处置 |
|---|---|---|
| 已沉淀 | `s:` 引用命中 | 可删 |
| 无价值 | 一次性 ops/分析/脚本、结论已在代码或 bank、transcript 已丢的孤儿、含明文密钥 | 可删 |
| 值得沉淀 | 业务规则、架构决策、字段/接口口径、排障根因、进行中任务 | 交 `session-sediment` |
| 边界 | 主题 bank/文档里「多半已有」但没确证 | **停下问**，别自己拍 |

## 4. 脚本（`scripts/`，默认只读/干跑）

路径按本机默认值写，可用参数覆盖。

| 脚本 | 作用 | 默认 |
|---|---|---|
| `inventory.py` | 只读盘点：会话表 + 体积 + 真实用户轮数 + 磁盘状态 + 首问预览（zcode / opencode 行另读各自库；并列出 cloudcli 未收录的「provider 库独有」会话） | 只读 |
| `purge.py` | 物理删除（DB 行 + transcript + superseded + WorkBuddy 残留目录 + zcode / opencode 共享库） | **干跑**；`--apply` 需 `--backup` |
| `sediment_refs.py` | 采集 memory-bank 的 `s:` 引用并与会话交叉匹配 | 只读 |
| `extract.py` | 按 provider 抽取对话脉络（USER/末答）；**可一次给多个路径**（成批读），`--start/--limit` 按轮切片（长会话续读） | 只读 |

用法示例见各分册；`python3 scripts/<name>.py --help` 也可查。

## 5. 交接

选中「值得沉淀」的会话后，**不在这里写条目**——点名调用用户级 skill `session-sediment`（`/session-sediment`）：它负责起草、写 `s:` 引用、落 `~/.memory-bank/`、同步 OV。本 skill 只负责评估与选择。

## 6. 红线与失败处理

- 服务在跑时**不要**删 `auth.db-wal`/`auth.db-shm`；`.backup` 产物是完整的独立库，其边车里 `-wal` 恒 0 字节，删边车无损。
- `.backup` 产物是 WAL 库，只读打开须加 `?mode=ro&immutable=1`，否则报 `unable to open database file`。
- **反过来，读「活动中的」WAL 库（如 zcode `db.sqlite`、opencode `opencode.db`）不能加 `immutable=1`**——它会跳过 WAL，未 checkpoint 的提交读不到（曾把已存在的会话读成 0 行）。用 `?mode=ro`。`immutable` 只给静态快照用。
- 别用 `.backup` 快照反推磁盘文件是否删除（快照只救 DB 行，**文件删了不可恢复**）——删除前想清楚。
- **zcode / opencode：只删 cloudcli 侧 ≠ 删掉**。它们是共享库 provider（`jsonl_path` 恒 NULL、无 `resolveTranscriptPath`），app 行只是索引；provider 库里的行还在时，watcher 必然把它重新索引回来。应用内「永久删除」现已同时清两侧（`deleteProviderSession`），脚本也必须照做。两库路径见 §2，删除顺序与要手清的表见 cleanup §zcode / opencode。
- 遇到「删了但 UI 还显示」：是内存缓存，先重启确认，别重复删。**但如果过一会儿会话自己回来了**，那是复活（上一条），不是缓存。
