# 全自动评估跑批（auto-run）

**一次跑批只做三件事：判秒杀、判价值、出沉淀方案。不删会话、不写 Memory Bank / OV。**
删除与沉淀在用户点头之后执行，见 `cleanup.md` 与 `SKILL.md` §4。**默认跑批的终点是报告，不是删除。**

## 0. 铁律

遵守 `SKILL.md` §0。流水线特有的只两条：

1. **报告不完整要显式说**：有 `pending` / `blocked` 时先列出来，不许给「全部评估完」的假象。
2. **一条会话只派一个子代理**：批量塞给同一个子代理会让多条正文挤进同一段上下文，判定互相污染。

## 1. 目录与命令

```
~/.memory-bank/_cleanup/<run-id>/
  run.json              范围 / 库路径 db / 时间 / 库内计数
  ledger.jsonl          追加式事件流；同一 sid 以最后一条为准
  findings/<sid>.json   逐会话结论（唯一交付物）
  report.md             汇总（由 ledger 生成，每次全量重写）
  result.md             对外结果块（GFM markdown，回话原样粘贴，不包围栏）
  detail.md             逐会话明细（内容按列宽截断 + 依据轮 + 证据引文），`--detail --write` 生成
  execution.md          点头之后的人工执行记录（另存，report 不碰）
```

```bash
cd <skill>/scripts
python3 ledger.py init                     # 默认 --scope archived
python3 ledger.py status                   # 进度 + 待处理 sid
python3 ledger.py next --limit 5           # 下一批（JSON：read_cmd、路径、轮数、fork 父、bank_dirs）
python3 ledger.py mark --from findings/<sid>.json
python3 ledger.py show <sid前8位>
python3 ledger.py sync                     # 补跑批期间新归档的会话
python3 ledger.py report
```

`init` 默认只收 `isArchived=1`；`--scope all` 才覆盖未归档，此时用 `--exclude <当前会话 sid>` 把自己排除。`--run-id` 不传时用时间戳。

默认台账根 `~/.memory-bank/_cleanup`、默认库 `~/.cloudcli/auth.db`。**换根或换库（验证、快照核对）时**：`--root` 每条子命令都要带（没有别的地方记它）；`--db` 只在 `init` 传一次就够，之后由 `run.json` 记住。例外是 `sync` 恒用 `init` 记下的库（换库补扫会把两批会话混进同一份台账），`result` 则命令行 `--db` 优先——这两条相反是故意的。

## 2. 阶段

```
init 盘点 → 逐条判定（并发子代理，一批 5 条）→ sync 复查 → report
```

### 2.1 盘点

`init` 会一次性登记全部候选，包含 `turns` / `size` / `fork_parent`。检查两件事：

- `turns = -1`：解析失败（多为压缩格式或未知 provider）。先修 `extract.py`；修不了就把这条标 `blocked`，别猜。
- `fork_parent` 非空：`next` 已按「父先子后」排序；子会话的 prompt 里要带父会话的 findings 摘要，允许复用前缀结论，但**分叉点之后必须自己读**，判定独立。分叉点用父子 USER 文本逐轮比对得出（`extract.parse_jsonl`），不要猜。

### 2.2 判定（默认一批 5 条，上限 8 条）

循环：

1. `next --limit 5` 拿一批。
2. 每条派一个 `Explore` 子代理（§3 模板），并行。
3. 收齐后逐条写 `findings/<sid>.json`，`mark`。被拒就按校验错误回修（最多两次），仍不过标 `blocked`。
4. `status` 确认本批已从 pending 消失。**一批没落完不开下一批。**

一批默认 5 条，最多 8 条：主代理要收这么多份 JSON，再多就是自己制造膨胀。

### 2.3 秒杀

秒杀不是独立阶段，是 `verdict=kill`。判据仍是四条全中，且 `ledger.py` 强制 `turns=1`。
候选可以先看 `inventory.py --archived-only` 的首问；确认要看回答再读那 1 轮。

### 2.4 收尾

1. `sync`：把跑批期间新归档的会话补进台账，继续判完。
2. `report`：生成完整报告（人类排查用，不直接贴给用户）。
3. `result` 出来后先读摘要第三行的 `待删 N` 与 ③ 的 `沉淀待核`：前者是这轮要清掉的量，后者是沉淀没落地的缺口，写进 ④ 备注（≤3 条），别沉在表里。
4. `result --write --detail`：生成结果块 + 逐会话明细（markdown 表格，**不包代码围栏**），回话正文即其原文（形态与粘贴规则见 SKILL.md §1.2，本节不重复）。结果块回答「账目」，明细回答「这条会话讲了什么」，两者一起贴。看什么去哪：**结论看结果块**（内容 / 处置 / 处置理由），**判据看明细**（依据轮 + 证据原句），**完整理由与 OV 记录看 `findings/<sid>.json` 或 `report.md`**。

## 3. 子代理契约

每个子代理只能看到**一条**会话。Prompt 模板（替换 `{{...}}`）：

```
你在做会话价值评估。只读、只判断，不写任何文件，不删除任何东西。

会话：{{sid}} · {{provider}} · {{project}} · {{turns}} 轮
路径：{{jsonl_path}}
{{fork_parent_line}}

读法（必须逐段，禁止一次读完）。`next` 已给出精确命令，把 <n> 换成起始轮号：
  {{read_cmd}}
每段 1~5 轮，从第 1 轮读到第 {{turns}} 轮。zcode/opencode 不要找文件，命令里的 --db/--id 就是唯一入口。

逐段判三问：
  ① 结论能否只靠代码/库/git 现状重建？能重建 ≠ 可删，只说明没有独家事实。
  ② 有代码外信息吗？（被否方案及理由 / 踩坑路径 / 不可逆操作口径 / 权宜标记）
     有 → 有价值，不再问 ③。
  ③ 只有走到这里才查 OV：ov find "<具体对象名>"（表名/类名/接口/报错片段，别用长句）。
     记录 query 与结果；查不到只能写「未检索到」，不许写「OV 里没有」。
     ov 连不上 → 不判 discard，改判 sediment，并在**根级** notes 写「③ 未查」（`sediments[*]` 下写不渲染）；此时 §2 必然为空，备注里要说明「OV 未查，§2 未生效」。

判定只能选一个（每条都必须给出理由：kill/discard 写 reason，sediment 写 value + sediments，blocked 写 reason——**没有理由的判定 mark 会直接拒收**）：
  kill      单轮纯 ops，四条全中（轮数=1 + 内容简单 + 部署/重启/清理/安装 + 无下次须知）
  discard   读完全部轮次且满足其一：③ OV 已覆盖（或 0 轮空会话）；或产物已落在会话外的持久载体（仓库文档批注 / 迁移脚本 / 代码提交），写进 `carrier`
  sediment  有代码外信息，且值得写成条目；条目落盘后原文删（归档范围 `delete_after` 恒为 true）。
            非归档范围若原文本身要留作证据，写 `delete_after: false`：条目照落，原文不删
  blocked   读不到 / 解析失败 / 依赖未决
  keep      **归档范围不合法，mark 直接拒收**。只有 `--scope all` 的未归档会话可以用：
            必须写 why_not + next_action（转 sediment / kill / discard），写不出归口就该判 sediment 或删

只输出一个 JSON 对象，不要任何解释文字：
{
  "sid": "{{sid}}",
  "verdict": "kill|discard|sediment|blocked（--scope all 时另可用 keep）",
  "read": "1-{{turns}}/{{turns}}",
  "value": "一句话价值（sediment/keep 必填）",
  "reason": "判定理由（kill/discard/blocked 必填）",
  "carrier": "discard 且产物已落会话外载体时必填：路径 + 定位（例：docs/x.md 第 1446 行 ### CodeBuddy）",
  "evidence": [{"turns": "12-14", "quote": "原文，≤80 字"}],
  "ov": [{"query": "dwd_device_snapshot_day", "result": "未检索到"}],
  "sediments": [{"kind": "knowledge|case|checkpoint", "target": "bank:<项目> 或 db:<域文件>",
                 "title": "条目标题", "summary": "2~4 句，写结论/被否方案/坑，直接可读"}],
  "conflicts": [{"with": "OV 或 bank 现有条目标识", "detail": "哪里相反"}],
  "keep_reason": "仅未归档范围 keep 时填",
  "why_not": "仅未归档范围 keep 时填",
  "next_action": "仅未归档范围 keep 时填",
  "delete_after": true,
  "notes": "可选"
}

可选落点（bank 项目目录，取自 `next` 输出的 `bank_dirs`）：
  {{bank_dirs}}

硬约束：
- `target` 是**落点**，不是 kind：`bank:<上列目录名>` 或 `db:<db-dictionary 下的域文件>`。
  例：`bank:cloudcli`、`bank:server-ops`、`db:03-orders.md`。写 `bank:knowledge` 会被拒绝。
- `read` 只写 `起-止/总数` 三个数字：判完写 `1-{{turns}}/{{turns}}`；`blocked` 写实际读到的范围（如 `1-3/22`），不许假称读完。
- `sediments[].summary` 必须能让没读过会话的人看懂，不许写「详见上文」。
- `delete_after` 默认 true。只有 `--scope all` 的未归档会话可以写 false——沉淀条目照落、原文留作证据，报告把它列进 §4 而不是删除清单；归档范围写 false 会被 `mark` 拒收。
- 冲突不许静默覆盖：与本会话口径相反的现有条目，单列到 conflicts。
- 不要读别的会话；fork 子会话的父结论已在上方给出，只需从分叉点往后自己读。
- 不要写任何文件，不要运行 `purge.py` 或任何删除命令。
```

填模板时把 `next` 输出里的 `bank_dirs` 原样填进 `{{bank_dirs}}`——这是子代理能正确落点的唯一依据。

`{{fork_parent_line}}` 形如：

```
这是 fork 子会话，父会话 {{parent_sid}} 的结论：
<父 findings JSON 摘要>
分叉点约在第 {{n}} 轮。分叉点之前可复用父结论，之后必须逐段读。
```

## 4. findings 结构与校验

字段含义见上面模板。`ledger.py mark` 的硬校验：

| 判定 | 必须有 | 拒绝条件 |
|---|---|---|
| 全部 | `sid`、`read`、`verdict` | `read` 没覆盖 `1..turns`；总轮数与盘点不符；归档范围判 `keep` |
| `kill` | `reason`、`evidence` | `turns != 1` |
| `discard` | `reason`、`ov` 或 `carrier`（turns>0） | 既没查 OV 也没写载体 |
| `sediment` | `value`、`evidence`、`sediments[*].{kind,target,title,summary}` | 缺任一字段；kind 非法；归档范围 `delete_after=false` |
| `keep` | 仅非归档范围；`value`、`evidence`、`keep_reason`、`why_not`、`next_action` | 归档范围出现即拒收 |
| `blocked` | `reason` | — |

**形状闸门（先于上表）**：`evidence` / `ov` / `conflicts` 必须是对象数组，元素字段为非空字符串；`sediments` 必须是对象数组；`delete_after` 必须是布尔。形状错时只报形状错，改完再跑一次 `mark` 才看判据错——所以别把 `"ov": ["查询 → 未检索到"]` 这种简写喂进来。

`target` 只能是两类：`bank:<项目目录名>`（落 `~/.memory-bank/<项目>/entries/`）或 `db:<域文件>`（落 ToC-Admin 的 db-dictionary）。两条都有就写两条。

## 5. 压缩 / 中断后恢复

只做三步，不回忆：

```bash
python3 ledger.py status          # 看未处理数与 sid
python3 ledger.py next --limit 5  # 继续下一批
```

- 若正在等子代理：这批没 `mark` 的会仍在 pending，重派即可（幂等）。
- `findings/` 里已有但台账没有的：说明 `mark` 没跑，先补 `mark`。
- 台账与记忆冲突：信台账。
- 跑批目录被删：`init` 重开，已花的读取成本无法恢复，但结论若在子代理回包里可先落盘。

## 6. 报告

`report` 生成 `report.md`。结构以生成器为准（`grep -n 'L.append("## ' scripts/ledger.py`，别记行号），小节标题由 `L.append("## …")` 决定：

- **头部**：范围 / 纳入条数 / 盘点与报告时间 / 判定分布。**不占编号。**
- `## 0. 未处理（报告不完整）` —— **仅 pending 非空时出现**
- `## 1. 秒杀区（四条全中）`
- `## 2. 无价值可删（读过全部轮次 + OV 已覆盖，或产物已在会话外载体）` —— 附 OV 查询记录 / carrier
- `## 3. 沉淀后删（点头后写入条目并删除原文）` —— 每条：一句话价值 + 依据轮次 + kind/落点/标题/摘要 + 冲突
- `## 4. 阻塞` —— 仅存在时出现（归档范围；非归档范围此处是 `## 4. 保留`，含 keep 与 §1-§3 挪出的置顶/留档会话，阻塞顺延 §5）

**§1-§3 只列按处置该删的**：非归档范围的置顶会话、`delete_after=false` 不进这三节（否则报告一边写「置顶不删」一边把它列成删除目标），改列 §4；落地桶与这三节同步过滤。
- `## 落地（点头之后）` —— **无编号**
- `## 附录：全部判定` —— **无编号**

这套编号是 `cleanup.md` 取删除目标的依据（§1 秒杀 / §2 无价值 / §3 待沉淀），改生成器必须同步改那里。核对方式：`grep -n 'L.append("## ' scripts/ledger.py`，不要凭记忆写结构。

**`report.md` 是纯生成物**，每次 `report` 都全量重写。用户点头后的执行记录（谁批准了什么、沉淀落在哪、删了哪些、快照路径）写到同目录的 `execution.md`，不要追加到 `report.md`——旧版本留下的手写尾段会在下次 `report` 时自动迁到 `execution.md`，不会丢，但也别指望它继续留在报告里。

要人拍板的事写进 `result` 的 ④ 备注（≤3 条），更长的写 `execution.md`、备注里只给路径。结果块的形态只由 `SKILL.md` §1.2 定义，本节不重复。

`report.md` 与 `result.md` 的分工：报告给人排查（含理由、证据、OV 查询），结果块做**跨轮对比**（形态、列、排序、空集写法全部固定）。两者都由脚本生成，都不许手改。

## 附录：extract 读成 0 轮时

先确认 provider 判对：`.zstd` → dsh；出现 `user/message` / `assistant/message` → dsh；`event_msg` → codex；`type=message` + 顶层 `role` → workbuddy；`type=message` + `message.role` → pi；`type=user|assistant` → claude。行结构差异：

| provider | 用户消息在 | 助手答案在 |
|---|---|---|
| claude | `type=='user'` 的 `message.content` 块 | `type=='assistant'` 的 text 块 |
| workbuddy | `role=='user'` | `role=='assistant'` |
| codex | `item.type=='UserMessage'` | `item.type=='AgentMessage'`（取 `phase=='final'`） |
| pi | `message.role=='user'` | `message.role=='assistant'` |
| dsh | `type=='user/message'` 且 `data.source.kind=='user'` | `type=='assistant/message'` |
| zcode / opencode | sqlite `message.data.role` + `part.data.type` | 同为 text part |

噪声过滤：以 `<` 开头、`Caveat:`、含 `tool_result` / `environment_context`、重复用户消息，一律跳过。
