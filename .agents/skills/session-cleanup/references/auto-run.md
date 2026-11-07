# 全自动评估跑批（auto-run）

**一次跑批只做三件事：判秒杀、判价值、出沉淀方案。不删会话、不写 Memory Bank / OV。**
删除与沉淀是 P（用户批准）之后的第二阶段，见 `cleanup.md` 与 `SKILL.md` §4。

## 0. 铁律

遵守 `SKILL.md` §0。流水线特有的只两条：

1. **报告不完整要显式说**：有 `pending` / `blocked` 时先列出来，不许给「全部评估完」的假象。
2. **一条会话只派一个子代理**：批量塞给同一个子代理会让多条正文挤进同一段上下文，判定互相污染。

## 1. 目录与命令

```
~/.memory-bank/_cleanup/<run-id>/
  run.json              范围 / 时间 / 库内计数
  ledger.jsonl          追加式事件流；同一 sid 以最后一条为准
  findings/<sid>.json   逐会话结论（唯一交付物）
  report.md             汇总（由 ledger 生成，每次全量重写）
  execution.md          P 阶段的人工执行记录（另存，report 不碰）
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

## 2. 阶段

```
init 盘点 → 逐条判定（并发子代理，一批 5 条）→ sync 复查 → report
```

### 2.1 盘点

`init` 会一次性登记全部候选，包含 `turns` / `size` / `fork_parent`。检查两件事：

- `turns = -1`：解析失败（多为压缩格式或未知 provider）。先修 `extract.py`；修不了就把这条标 `blocked`，别猜。
- `fork_parent` 非空：`next` 已按「父先子后」排序；子会话的 prompt 里要带父会话的 findings 摘要，允许复用前缀结论，但**分叉点之后必须自己读**，判定独立。分叉点用父子 USER 文本逐轮比对得出（`extract.parse_jsonl`），不要猜。

### 2.2 判定（一批 5 条）

循环：

1. `next --limit 5` 拿一批。
2. 每条派一个 `Explore` 子代理（§3 模板），并行。
3. 收齐后逐条写 `findings/<sid>.json`，`mark`。被拒就按校验错误回修（最多两次），仍不过标 `blocked`。
4. `status` 确认本批已从 pending 消失。**一批没落完不开下一批。**

一批不超过 8 条：主代理要收 8 份 JSON，再多就是自己制造膨胀。

### 2.3 秒杀

秒杀不是独立阶段，是 `verdict=kill`。判据仍是四条全中，且 `ledger.py` 强制 `turns=1`。
候选可以先看 `inventory.py --archived-only` 的首问；确认要看回答再读那 1 轮。

### 2.4 收尾

1. `sync`：把跑批期间新归档的会话补进台账，继续判完。
2. `report`：生成报告。
3. 向用户汇报时**只引用 `report.md`**，不重新组织结论。

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
     ov 连不上 → 不判 discard，改判 sediment 或 keep，并在 notes 写「③ 未查」。

判定只能选一个：
  kill      单轮纯 ops，四条全中（轮数=1 + 内容简单 + 部署/重启/清理/安装 + 无下次须知）
  discard   读完全部轮次，①②不成立且 ③ 已覆盖（或 0 轮空会话）
  sediment  有代码外信息，且值得写成条目
  keep      有价值但已有等价载体，或删除风险大于收益
  blocked   读不到 / 解析失败 / 依赖未决

只输出一个 JSON 对象，不要任何解释文字：
{
  "sid": "{{sid}}",
  "verdict": "kill|discard|sediment|keep|blocked",
  "read": "1-{{turns}}/{{turns}}",
  "value": "一句话价值（sediment/keep 必填）",
  "reason": "判定理由（kill/discard/blocked 必填）",
  "evidence": [{"turns": "12-14", "quote": "原文，≤80 字"}],
  "ov": [{"query": "dwd_device_snapshot_day", "result": "未检索到"}],
  "sediments": [{"kind": "knowledge|case|checkpoint", "target": "bank:<项目> 或 db:<域文件>",
                 "title": "条目标题", "summary": "2~4 句，写结论/被否方案/坑，直接可读"}],
  "conflicts": [{"with": "OV 或 bank 现有条目标识", "detail": "哪里相反"}],
  "keep_reason": "keep 时必填",
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
| 全部 | `sid`、`read`、`verdict` | `read` 没覆盖 `1..turns`；总轮数与盘点不符 |
| `kill` | `reason`、`evidence` | `turns != 1` |
| `discard` | `reason`、`ov`（turns>0） | 没查 OV |
| `sediment` | `value`、`evidence`、`sediments[*].{kind,target,title,summary}` | 缺任一字段；kind 非法 |
| `keep` | `value`、`evidence`、`keep_reason` | 缺 keep_reason |
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

`report` 生成 `report.md`，固定结构：

1. 概览（总数 / 未处理 / 五类计数 / 体积）
2. 秒杀区
3. 无价值可删（附 OV 查询记录）
4. 有价值 · 待沉淀（每条：一句话价值 + 依据轮次 + kind/落点/标题/摘要 + 冲突）
5. 有价值 · 保留
6. 阻塞（如有）
7. 落地（P 之后的命令）
8. 附录：全部判定表

**`report.md` 是纯生成物**，每次 `report` 都全量重写。P 阶段的执行记录（谁批准了什么、沉淀落在哪、删了哪些、快照路径）写到同目录的 `execution.md`，不要追加到 `report.md`——旧版本留下的手写尾段会在下次 `report` 时自动迁到 `execution.md`，不会丢，但也别指望它继续留在报告里。

给用户的回话就是这份报告的口头版：**先给数字，再给「秒杀哪些」「沉淀哪些、落到哪」两组清单，最后点冲突与阻塞**。不要逐条复述摘要。

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
