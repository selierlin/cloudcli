---
name: session-cleanup
description: CloudCLI 会话清理与沉淀——清理无用会话（口水/smoke test、邻接垃圾、已归档无价值、已沉淀）与沉淀有价值会话到 memory-bank / OpenViking。含物理删除语义、先快照→干跑→确认→apply 纪律、各 provider 的 transcript 与残留布局、价值判定口径、以及向 session-sediment 的交接。触发词：清理口水会话、清理垃圾、清理无用会话、清会话、清理残留、清理孤儿目录、归档会话评估、哪些会话值得沉淀、会话沉淀、会话治理。
---

# CloudCLI 会话清理（session-cleanup）

两条线，可单跑也可连跑。**本 skill 只负责「选出」——真正的内容沉淀交给 `session-sediment`。**

| 线 | 目的 | 做什么 | 分册 |
|---|---|---|---|
| **清理** | 让侧边栏与磁盘只剩有用的会话 | 口水会话、邻接垃圾、残留目录/文件、已沉淀会话 | `references/cleanup.md` |
| **评估与沉淀** | 把有价值的会话内容留下 | 评估会话价值 → 无价值的删、值得的交给沉淀技能 | `references/triage-sediment.md` |

典型连跑顺序（就是本 skill 来源的那轮）：**清口水 → 清邻接垃圾 → 评估列表 → 沉淀值得的 → 删已沉淀的**。

## 0. 铁律（先读这一节）

1. **任何写操作前先做一致性快照**：`sqlite3 ~/.cloudcli/auth.db ".backup <path>"`，命名 `auth.db.before-<场景>-<YYYYMMDD-HHMMSS>.backup`。涉及 zcode 库时同样快照它。服务在跑不用停（WAL 下直接写安全）。
2. **删除 = 物理删除**，不是归档、不是隐藏：删 DB 行（`sessions` 行 + 该会话的 `superseded_provider_sessions` 行）+ `fs.unlink` 主 transcript 及**所有** superseded 路径。等价于应用内 `permanentlyDeleteArchivedSessions({force:true, deletedFromDisk:true})`。用户说「删」就是这个语义（2026-09-24 明确补过一句「还要物理删除」）。
3. **干跑 → 贴清单 → 等确认 → `--apply`**。不要边发现边删。
4. **活的东西一律不碰**：本机其它 harness 正在跑的会话（用 `-newermt '-10 minutes'` 兜底）、`auth.db-wal`/`auth.db-shm`、目录仍在的空项目行、WorkBuddy **应用本体**会话（不是 cloudcli 库里的，见 cleanup §WorkBuddy）。
5. **删前查 fork**：`select count(*) from sessions where forked_from_session_id=<sid>`，有下游就停下问。
6. 收尾必做**回归核对**：被删数=预期、其余行 `jsonl_path` 未变、其余 transcript 0 丢失、`pragma integrity_check` = ok。

## 1. 目标模型

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
| zcode | **无**（`jsonl_path` 恒 NULL） | transcript 在 `~/.zcode/cli/db/db.sqlite`；另有 `~/.zcode/cli/rollout/model-io-<sid>.jsonl` |
| dsh | `~/.dsh/sessions/<proj>/<session-uuid>/` | 常见只剩 0 字节 `session.lock` 残留 |

**沉淀库**：本地权威副本 `~/.memory-bank/<project>/entries/*.md`；OV 检索镜像 `viking://resources/<project>/session-sediments/`。

**服务**：`~/.cloudcli/local-server.json` 里有端口（本机现值 3011）。删完 UI 若还列着旧会话，那是服务端 `sessionHistoryCache` 内存缓存，重启即消（应用自身的删除路径也不清它）。

## 2. 判据速查

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

## 3. 脚本（`scripts/`，默认只读/干跑）

路径按本机默认值写，可用参数覆盖。

| 脚本 | 作用 | 默认 |
|---|---|---|
| `inventory.py` | 只读盘点：会话表 + 体积 + 真实用户轮数 + 磁盘状态 + 首问预览（zcode 行另读 zcode 库；并列出 cloudcli 未收录的「zcode 库独有」会话） | 只读 |
| `purge.py` | 物理删除（DB 行 + transcript + superseded + WorkBuddy 残留目录 + zcode 库） | **干跑**；`--apply` 需 `--backup` |
| `sediment_refs.py` | 采集 memory-bank 的 `s:` 引用并与会话交叉匹配 | 只读 |
| `extract.py` | 按 provider 抽取对话脉络（USER/末答） | 只读 |

用法示例见各分册；`python3 scripts/<name>.py --help` 也可查。

## 4. 交接

选中「值得沉淀」的会话后，**不在这里写条目**——点名调用用户级 skill `session-sediment`（`/session-sediment`）：它负责起草、写 `s:` 引用、落 `~/.memory-bank/`、同步 OV。本 skill 只负责评估与选择。

## 5. 红线与失败处理

- 服务在跑时**不要**删 `auth.db-wal`/`auth.db-shm`；`.backup` 产物是完整的独立库，其边车里 `-wal` 恒 0 字节，删边车无损。
- `.backup` 产物是 WAL 库，只读打开须加 `?mode=ro&immutable=1`，否则报 `unable to open database file`。
- **反过来，读「活动中的」WAL 库（如 zcode `db.sqlite`）不能加 `immutable=1`**——它会跳过 WAL，未 checkpoint 的提交读不到（曾把已存在的会话读成 0 行）。用 `?mode=ro`。`immutable` 只给静态快照用。
- 别用 `.backup` 快照反推磁盘文件是否删除（快照只救 DB 行，**文件删了不可恢复**）——删除前想清楚。
- zcode：应用内「永久删除」对 zcode 磁盘**零删除**（`jsonl_path` 恒 NULL，后端无该 provider 的 `resolveTranscriptPath`），必须额外清 zcode 库与 rollout。
- 遇到「删了但 UI 还显示」：是内存缓存，先重启确认，别重复删。
