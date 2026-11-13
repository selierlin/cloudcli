---
name: session-cleanup
description: CloudCLI 会话清理——默认全自动评估跑批：盘点已归档会话，判定秒杀区、无价值可删、沉淀后删、阻塞，用 ~/.memory-bank/_cleanup/<run>/ledger.jsonl 抗压缩抗中断记录进度，逐会话产出 findings/*.json，最后出固定四段结果块（`ledger.py result`：会话 / 落点 / 异常 / 备注）。归档范围的终态只有删，不存在 keep/保留；本阶段不删会话、不写 Memory Bank / OV，用户点头后才进入沉淀与物理删除。触发词：清理口水会话、清理垃圾、清理无用会话、清会话、清理残留、清理孤儿目录、归档会话评估、哪些会话值得沉淀、会话沉淀、会话治理、全自动清理、会话评估跑批。
disable-model-invocation: true
---

# CloudCLI 会话清理（session-cleanup）

**默认全自动：盘点 → 逐条判定 → 出报告。全程只读会话库，只写台账与 findings。**

| 阶段 | 产出 | 是否动数据 |
|---|---|---|
| **评估（默认）** | `~/.memory-bank/_cleanup/<run-id>/`：`ledger.jsonl` + `findings/<sid>.json` + `report.md` | 只读原件；只写新目录 |
| **落地（点头后）** | Memory Bank 条目 + OV + 物理删除 | 有写有删，按 §4 逐条确认 |

判断一条会话只回答一个问题：**它有没有「代码/库/git 里查不到、下次干活必须先知道」的东西**。有 → 沉淀；没有 → 可删；拿不准 → 也按沉淀走（宁可多留一条知识，也不把归档会话留成待办）。

## 0. 铁律

1. **主上下文只碰结论**。transcript 由子代理读；主代理只读子代理回的 JSON、`ledger.py status/next` 的输出、以及最终的 `report.md`。唯一例外：单轮会话的秒杀确认（1 轮、`--max 200`）。
2. **台账是唯一进度源**。开场先 `status`；上下文被压缩、会话中断、换人接手，都先 `status` + `next` 恢复，**不信对话记忆**。
3. **没读完不许判**。`read` 必须覆盖 `1..turns`，`ledger.py mark` 强制校验；校验不过就拒绝入库。任何处置都能指到「第几轮」。
4. **子代理只读**。派 `Explore`（无 Write/Edit），prompt 里明令：不写文件、不删会话、不写 bank/OV、不跑 `purge.py --apply`。
5. **判定不覆盖用户决定**。自动只拍「判什么」，不拍「删不删」。`kill` / `discard` 在报告里是建议，不是已执行。
6. **同题 ≠ 同内容**（2026-10-24）。同 provider、同项目、同题目只说明可以排在一起读，**不构成删的理由**。实测教训：三条同题会话（18~36 轮、5.8~9.6 MB）按「题目重复」打包判删，主题之外挂着被否方案、坑、权宜值。同题还要看时序：同一处反复问「这版改对了吗」，**以 `updated_at` 最晚那条为准**，沉淀里写清「前一版被判有问题 → 后一版确认」。
7. **fork 父子：读可复用前缀，判定必须独立**。子会话前半段是父的原样复制；分叉点之后必须自己读，证据自己给。
8. **任何写操作前先做一致性快照**（P 阶段才触发）：`sqlite3 ~/.cloudcli/auth.db ".backup <path>"`，命名 `auth.db.before-<场景>-<YYYYMMDD-HHMMSS>.backup`。涉及 zcode / opencode 库时同样快照。服务在跑不用停（WAL 下直接写安全）。
9. **删除 = 物理删除，不进废纸篓、不可恢复**：DB 行（`sessions` + 该会话的 `superseded_provider_sessions`）+ `fs.unlink` 主 transcript 及**所有** superseded 路径；zcode / opencode 还要删共享库里的行（否则复活）。等价于应用内 `permanentlyDeleteArchivedSessions({force:true, deletedFromDisk:true})`。
10. **归属必须来自同一行**（2026-11-01，代价是一条 2.8 MB transcript 永久丢失）。批量查询必须带 `substr(session_id,1,8)`；`--apply` 前逐个核对三件套在同一行：`session_id` ↔ `provider_session_id` ↔ `jsonl_path`；`purge.py` 输出的 `file` 必须与先前实际读过的路径逐字相同。
11. **删目录必须正向匹配 UUID，不许用排除法**（2026-10-27，永久数据丢失）。`~/.workbuddy/projects/<project>/` 下混着 `memory/` 等非会话目录，它「不叫 psid + 无同名 jsonl + 不在 sessions 表」三条全中，却是最不能删的。目录名必须匹配 `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` 才进候选；禁止对 `~/.workbuddy/projects/`、`~/.claude/projects/` 做整目录递归删。
12. **活的东西一律不碰**：其它 harness 正在跑的会话（`-newermt '-10 minutes'` 兜底）、`auth.db-wal`/`auth.db-shm`、目录仍在的空项目行、WorkBuddy **应用本体**会话，以及**当前这次对话自己的会话行**——名字常常正好等于本次命令原文、transcript mtime 就在刚刚。**`purge.py` 没有这条守卫**，必须人工排除。
13. **秒杀区 = 四条全中**：真实用户轮数 = 1（按轮算，不是 transcript 行数）+ 内容简单（一句话口令 / `Untitled` / `New session` / smoke test）+ 属于部署/重启/清理/安装这类纯操作 + 不产生任何「下次干活前必须先知道」的东西。`ledger.py` 强制 `kill` 的 `turns=1`。
14. **归档范围的终态只有「删」，置顶不豁免**（2026-11-12 用户口径）：`isPinned=1 AND isArchived=0` 本就不在默认范围；`isPinned=1 AND isArchived=1` 照走完整判据，**判定只能是 sediment / kill / discard / blocked，不许 keep**，落地时随目标一并删（`purge.py` 干跑在条目行标 `pin=1`，不再 skip）。归档范围不允许 `delete_after=false`——归档会话没有「留原文作证据」这条路（未归档范围可以，见 §1.2 判定表）。
15. **删前查 fork**：`select count(*) from sessions where forked_from_session_id=<sid>`，有下游就停下问。跨归档边界的 fork 家族要一起看（父/子/孙可能只有中间那条在归档区）。

## 1. 默认流程（全自动）

```
ledger.py init → 循环（next → 并发子代理 → mark → status）→ sync → report → result
```

**步骤、批次、子代理 prompt、findings 校验、压缩恢复全在 `references/auto-run.md`，动手前先读它。**

本节只留三处别处没写全、最容易错的：

- **开场先 `status`**：已有未跑完的 run 就续跑，不新开；`turns = -1` 的行先修 `extract.py`，修不了标 `blocked`，别猜。
- **一批判完再开下一批**：`status` 里本批不再 pending 才算完。
- **收尾贴 `result --detail` 的输出块**（结果块 + 逐会话明细，见 §1.2），不复述每条摘要：每条会话讲了什么由「内容」列回答，不许再另写一段人肉摘要。

### 1.2 收尾输出：固定形态（方案 C）

**最终回复的正文 = `ledger.py result` 的完整输出块，原样粘贴。** 它是 GFM markdown（三行摘要 + 四个 `###` 小节 + 表格），**不要再包代码围栏**——包了会渲染成灰色等宽文本、表格失效。不改列、不重排、不省略小节（空集写「无」）、块外不写任何散文（含「已完成、等你确认」这类收尾句）。需要人拍板的事项写进 ④ 备注（最多 3 条），更长的说明写 `execution.md`，备注里只给路径。

```bash
python3 scripts/ledger.py result --run-id <run-id> --write --detail \
  --note "3fb62569 与 d6ebf338 同文档，取后者" --note "…"
```

块由四段组成，结构常量搜 `ledger.py` 的 `SECTION_SESSION`（别记行号，代码一动就漂；`result --check` 会校验常量完整）：

| 段 | 内容 | 排序 |
|---|---|---|
| 表头 | 结果 · run · 范围 · 条数 · 体积；判定分布；落地条目→文件；已删/待删 | 固定 |
| ① 会话 | sid / 轮 / 判定 / **内容** / **处置** / **处置理由** | sediment→kill→discard→blocked，组内体积降序 |
| ② 落点 | 落点 / 条目 / **沉淀什么** / 文件 / 新建 / 更新 / 来源 | 条目数降序 → 落点名 |
| ③ 异常 | 类型 / 对象 / 说明 | 置顶待删 → 旧判定 → 冲突 → 阻塞 → 沉淀待核 → 未处理 |
| ④ 备注 | 最多 3 条 | 原样 |

**① 只回答三件事，多一个字都别加**：

- **内容**（宽 72）：这条会话在聊什么、留下了什么知识。取判定的 `value`（kill 取 `evidence.quote`，discard 取 `reason`、sediment 取 `value`）。
- **处置**：`已删 / 待删 / 卡住 / 未判定`，按 `sessions` 表现状反推，不是动作记录。归档范围**没有「保留」这个词**。
- **处置理由**（宽 120，紧跟处置列）：**凭什么待删、凭什么已删**，只写事实。

**「为什么这么判定」不在结果块里**（2026-11-11 移除）：判定理由是 `findings/<sid>.json` 的 `reason`/`value`/`evidence`，全文在 `report.md`；结果块塞它只会把「内容」挤扁，而人扫结果块时真正要判断的是「这条删不删、凭什么」。

处置理由的取值（**只许写事实，不许写「与现状一致」这类复述**）：

| 处置 | 事实 | 理由 |
|---|---|---|
| 待删 | 判定 kill/discard | `判定该删（discard），待你点头后 purge` |
| 待删 | 判定 sediment | `待沉淀（N 条）后删` |
| 待删 | sediment 且已有 land | `沉淀已落（N 个文件），待你点头后 purge` |
| 待删 | `isPinned=1` | 上述任一 + `｜isPinned=1，一并删（不需先取消置顶）` |
| 卡住 | 判定 blocked | `读取失败未判：<reason 首句>` |
| 已删 | sediment + 有 land | `沉淀已落（N 个文件）后才删的` |
| 已删 | sediment + 无 land | `无 land 记录 —— 需核对沉淀是否真落` |
| 已删 | kill/discard | `判定 kill 后已 purge` |

**判定与处置是两件事**，别混：判定说知识上该怎么处理，处置说库里现在是什么。归档范围内二者不一致是常态（全在等点头），所以摘要第三行直接写 `已删 N · 待删 M｜待你点头后执行沉淀 / 删除`；③ 会列 `沉淀待核`（判定 sediment、已在库外、却无 `land` 记录）与 `旧判定`（老台账里的 keep 行，必须重判）。

**判定必须有理由，没有理由的判定视为未完成。** 归档范围的判定只有四种：kill / discard / sediment / blocked，**`keep` 会被 `mark` 直接拒收**——归档会话没有「留着」这个终态。`blocked` 是「读不到所以判不了」，不是「选择保留」，必须在 ③ 里带具体卡点。② 的「沉淀什么」列取每条 `sediments[*].title`，宽 60。想看得更细（依据轮 + 证据原句 + 处置理由）就追加明细块：

```bash
python3 scripts/ledger.py result --run-id <run-id> --detail   # 结果块 + 明细
python3 scripts/ledger.py detail --run-id <run-id>            # 只看明细
```

明细是 `### ① 会话 · 明细（长文本按列宽截断，全文见 findings/<sid>.json）`，内容列 96 宽、处置理由 240 宽（超出补 `…`；未截断的全文在 findings 与 report 对应小节），另附「依据轮」与「证据引文」（引文列宽按数据 80 分位自适应）。明细则补上结果块省掉的证据原句——**要看判据翻明细，要看结论看结果块**。它**接在结果块后面，不替换任何小节**；`--write` 时写 `detail.md` / `result-detail.md`，不覆盖 `result.md`。骨架见 `references/result-skeleton.md`，自检 `detail --check`。

口径：

- **条目** = `findings.sediments` 的计划数；**文件** = `land` 事件记账的实际文件数。两者不等**就是合并**，属于要看到的信息，不是 bug。
- **处置** 由库现状反推，不靠回忆：归档范围内仍在库且有判定 → `待删`；仍在库且 blocked → `卡住`；已不在库 → `已删`；库读不到 → `-`。表头的 `已删 / 待删` 计数与这一列**同一口径**，库读不到时也写 `-`，不写 0。
- 每写一个条目文件就记一笔：`ledger.py land --sid <sid> --target bank:<项目> --file <文件名> --action new|update`。漏记会让「文件」列变成 0。
- 结构自检：`ledger.py result --check`。改骨架必须同步 `references/result-skeleton.md`，否则视为改坏。

### 1.1 只点名一条会话时

仍走同一套台账（`init` 会登记全部归档），先判那一条，判完 `report`，其余留 pending——报告 §0 会列出未处理，不会假装全评完。别为此另起流程，也别跳过 `mark`（否则结论进不了台账）。

## 2. 判据：三问 + 证据锚点

| # | 问题 | 谁回答 | 在判定里的角色 |
|---|---|---|---|
| ① | 结论能从代码/库/git 现状重建？ | 子代理看代码 | **只能否决**：答「不能重建」→ 有价值。答「能重建」**不构成删的理由**。 |
| ② | 有代码外信息吗？（被否方案及理由 / 踩坑路径 / 不可逆写操作的口径 / 权宜标记） | 子代理读会话 | **直接判有价值**，此后不再问 ③。 |
| ③ | OV 里这个口径已经有了、而且比这段更全吗？ | **查了才知道**（`ov find`） | **删的必要条件**：没查就没有删除资格。 |

**判删的两条路径**（满足任一即可，不必都成立）：

1. **①②③ 同时成立**：无代码外信息、OV 已覆盖。
2. **产物已在会话外的持久载体**：这条会话亲手把结论写进了仓库文档批注 / 迁移脚本 / 代码提交，原文再留就是同一份内容的第三份拷贝。findings 写 `carrier`（路径 + 定位），不必再等别的会话沉淀。
   这与 ① 的「能重建」不同：那是「没读过也能推出来」，这是「已经写出去、可独立阅读」。2026-11-12 的 31f44738 就是被混成「等 d6ebf338 沉淀后再删」，结果两条互锁、都留在库里。

③ 不能当准入门槛：OV 覆盖稀疏、滞后，「未检索到」只说明检索没命中，不能反推没价值；③ 命中也不证明这段没价值（条目可能来自另一条会话、更浅、是旧口径）。

**① 的失效模式**：判「能重建」靠印象而不是当场读。没读过的东西，最容易觉得「代码里肯定有」。所以 ① 只能用来发现价值，不能用来批准删除。

**② 的具体命中类型**（代码里永远查不到，最容易漏）：被否方案及理由；踩坑路径（什么姿势会静默失败）；一次性不可逆写操作的口径（权限边界、回读校验）；权宜标记（临时固定值 vs 正式值）；会写远端的一次性脚本。「操作是一次性的」不等于「没有知识」——2026-10-24 一批 8 条里 3 条因此被误判。

**OV 不可达**（代理/网络问题）：不判 `discard`，改判 `sediment`，**根级** `notes` 写「③ 未查」（不是 `sediments[*].notes`，那里不渲染）。此时报告 §2 必然为空，**§2 空 ≠ 筛干净了**，必须在 ④ 备注里说明「OV 未查，§2 未生效」。

**transcript 已丢的孤儿行**（`jsonl_path` 为空且非 zcode）：没有内容可判，标 `blocked`，留在库里等用户明确要清——不因为「没内容」自动删。

### 2.1 证据锚点

有价值必须引原句 + 轮次区间；无价值必须写「读了第 x–y 轮」**且**（`ov find` 的结果 或 `carrier` 载体路径）；秒杀必须四条判据逐条命中 + 那 1 轮原句。缺任一样 `ledger.py mark` 拒绝——拒收条件以 `auto-run.md` §4 的表格为准（那里与 `validate()` 一致）。

### 2.2 措辞纪律

查 OV 的结论只能写 **「未检索到」**，不许写「OV 里没有」。前者是检索事实，后者是覆盖断言——后者正是「以为已经沉淀过」的成因。检索词用**具体对象名**（表名、类名、接口路径、报错片段），别用自然语言长句。

### 2.3 判定（归档范围只有四种）

| verdict | 含义 | 报告里的位置 |
|---|---|---|
| `kill` | 秒杀区，四条全中 | §1 |
| `discard` | 读完全部轮次：无代码外信息且 OV 已覆盖（或 0 轮空会话），**或产物已在会话外载体** | §2 |
| `sediment` | 有代码外信息，需写条目；归档范围 `delete_after` 恒为 true，条目落盘后删原文；未归档范围写 `false` 则条目照落、原文留档（列 §4） | §3 |
| `blocked` | 读不到 / 解析失败 / 依赖未决；这是「判不了」，不是「保留」 | §4 |
| `keep` | **归档范围不合法**（`mark` 拒收）。只有 `--scope all` 的未归档会话可用 | 非归档报告 §4 |

## 3. 台账与并发

- 台账：`~/.memory-bank/_cleanup/<run-id>/`，append-only JSONL；同一个 sid 以最后一条事件为准。
- 只由主代理写；子代理不得碰。并发只发生在「读」，不发生在「写」。
- 子代理返回值必须是单个 JSON 对象，不允许夹带解释文字；不合格就重派一次，两次不合格标 `blocked`。
- 按批推进：默认一批 5 条、最多 8 条进主上下文。超过就是自己制造膨胀。

完整契约、prompt 模板、恢复步骤见 `references/auto-run.md`。

## 4. 用户点头之后

**默认跑批到报告（`result`）为止：不沉淀、不写 bank/OV、不删任何东西。** 报告贴出后等用户明确点头（「删」「执行」「P」），点头之前的任何写操作都越权。点头后分两条执行，按会话逐条落地：一条会话沉淀完就跟着删，不留到下一轮。

### 4.1 沉淀

按 `findings/<sid>.json` 的 `sediments` 交 `session-sediment`（`/session-sediment`）：一条会话一次，说清「哪条会话、归到哪个项目、kind、是否有同主题旧条目」，原料就是 `title` + `summary` + `target`，**不要再回读 transcript**。它负责写 `s:` 引用、落 `~/.memory-bank/<project>/entries/`、同步 OV。

- 同一轮多条命中同一个 db dict 域文件：**改动先聚合再写**，合并成一份 diff、一次签核，不许按会话逐条 apply（否则前一次被后一次踩掉）。
- 两条会话对同一张表给出相反口径：**单独列出来问**，不许静默覆盖。
- 落点按 `sessions.project_path` 反查 `~/.memory-bank/<project>/`，**别按 provider 猜**（同一条 workbuddy 会话可能属 cloudcli / ToC-Admin / rea）。
- **「沉淀后删」在本条落地时就做掉**，不要只写「已沉淀（可删）」留到下一轮（踩过：一条已沉淀会话连过 5 轮治理还在列表里）。
- **每落一个文件就 `ledger.py land`** 记一笔（`--target` 与 findings 一致，`--file` 写实际文件名，新建 `--action new`、给旧条目追加增补 `--action update`），否则 `result` 的「文件」列会是 0，§1.2 的结果块也就不可信。
- OV 导入两个坑：`ov add-resource` 对已导入条目不覆盖，会生成 `_1` 并列副本——先 `ov rm -r` 旧条目、等任务 `completed` 再重导；新项目先 `ov mkdir viking://resources/<project>/session-sediments/`，否则 `--parent` 直接 `[NOT_FOUND]`。

### 4.2 删除

读 `references/cleanup.md`，严格按「快照 → 干跑 → 贴清单 → 确认 → `--apply` → 回归核对」执行。

- 干跑清单即确认清单；用户点头后不再二次干跑。
- 置顶会话不跳过：`purge.py` 会在干跑清单的条目行标 `pin=1`，随目标一并删。若清单里出现没预期的置顶项，停下来问，不要硬删。
- 快照每轮 `--apply` 前做一份是必要的，但收尾只留最新一份，之前的删掉（一轮 20 条会留 20 份，批量时轻易堆出几百 MB）。
- 回归核对：被删数=预期、其余行 `jsonl_path` 未变、其余 transcript 0 丢失、`pragma integrity_check` = ok；zcode / opencode 另核它们库的 `session` 表行数。

## 5. 目标模型

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
| dsh | `~/.dsh/sessions/<proj>/<uuid>/session.v4.jsonl.zstd` | zstd 压缩，`extract.py` 透明解压；常见只剩 0 字节 `session.lock` 残留 |

**zcode / opencode 是共享库**：app 行只是索引，删它不删 provider 库 ⇒ 会话必然复活。两个 provider 必须**两侧都清**才叫删干净。

**沉淀库**：`~/.memory-bank/<project>/entries/*.md` 是**本机产出**的副本（只覆盖本机，不是全集）；`viking://resources/<project>/session-sediments/` 是跨机器**唯一共享汇聚层**。别机条目本机没有属正常态，不做反向补齐。
**db dict**：`~/Projects/lemobar/ToC-Admin/docs/db-dictionary/`（OV 镜像 `viking://resources/ToC-Admin/2026-09-20-db-dictionary/`）。只收 ToC-Admin 业务库，cloudcli 自己的库仍落 memory-bank。

**服务**：`~/.cloudcli/local-server.json` 里有端口（本机现值 3011）。删完 UI 若还列着旧会话，那是服务端 `sessionHistoryCache` 内存缓存，重启即消。

## 6. 脚本（`scripts/`，默认只读/干跑）

| 脚本 | 作用 | 默认 |
|---|---|---|
| `inventory.py` | 只读盘点：会话表 + 体积 + 真实用户轮数 + 磁盘状态 + 首问预览（zcode / opencode 行另读各自库；并列出 cloudcli 未收录的「provider 库独有」会话） | 只读 |
| `ledger.py` | 跑批台账：`init` / `status` / `next` / `mark` / `show` / `sync` / `land` / `report` / `result` / `detail`（`result` 是唯一对外的结果形态，`detail` 补逐会话内容与证据，见 §1.2） | 只读原件，只写 `_cleanup/` |
| `purge.py` | 物理删除（DB 行 + transcript + superseded + WorkBuddy 残留目录 + zcode / opencode 共享库） | **干跑**；`--apply` 需 `--backup` |
| `sediment_refs.py` | 采集 `s:` 引用（memory-bank + db dict）并与会话交叉匹配；`--bank` / `--dict` 可重复，`--no-dict` 跳过 db dict | 只读 |
| `extract.py` | 按 provider 抽取对话脉络（USER/末答）；可一次给多个路径，`--start/--limit` 按轮切片（**逐段判定就靠这两个参数**）；dsh 的 `.zstd` 透明解压 | 只读 |

分段读法（1-based）：

```bash
python3 scripts/extract.py <path> --max 200 --start 1  --limit 5
python3 scripts/extract.py <path> --max 200 --start 6  --limit 5
# zcode / opencode（无文件）：
python3 scripts/extract.py --provider zcode --db <provider 库> --id <psid> --max 200 --start 1 --limit 5
```

## 7. 红线与失败处理

- **评估阶段不许删、不许写 bank/OV。** 判完就停，出报告，等用户点头。
- 服务在跑时**不要**删 `auth.db-wal`/`auth.db-shm`；`.backup` 产物是完整的独立库，其边车里 `-wal` 恒 0 字节，删边车无损。
- `.backup` 产物是 WAL 库，只读打开须加 `?mode=ro&immutable=1`，否则报 `unable to open database file`。
- **反过来，读「活动中的」WAL 库（zcode `db.sqlite`、opencode `opencode.db`）不能加 `immutable=1`**——它会跳过 WAL，未 checkpoint 的提交读不到（曾把已存在的会话读成 0 行）。用 `?mode=ro`。
- 别用 `.backup` 快照反推磁盘文件是否删除（快照只救 DB 行，**文件删了不可恢复**）。
- **zcode / opencode：只删 cloudcli 侧 ≠ 删掉**（两侧要清的表、复活根因见 `cleanup.md` §zcode / opencode）。
- 遇到「删了但 UI 还显示」：是内存缓存，先重启确认，别重复删。**但如果过一会儿会话自己回来了**，那是复活，不是缓存。
- **上下文被压缩 / 记忆混乱时**：以 `ledger.py status` 与 `findings/*.json` 为准恢复进度，不复述上一段细节；发现台账与记忆冲突，信台账。台账丢了就重开跑批，别猜。
- 子代理连续两次返回不合格 JSON：标 `blocked`，不要用它的结论凑数。
- **含明文密钥 / 手机号等敏感信息的转写**：安全优先，读完即删，沉淀里也不许抄敏感值。
