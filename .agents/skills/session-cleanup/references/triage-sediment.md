# 评估与沉淀线（triage-sediment）

目标：把会话**分诊**成三堆——**已沉淀（可删）／无价值（可删）／值得沉淀（交沉淀技能）**。**不要一次判完**：一批一停，用户回话才继续。

## 流程（分批循环 —— 见 SKILL.md §1）

**准备（只做一次）**

1. **列候选**。用户说「评估已归档会话」→ `python3 scripts/inventory.py --archived-only`；说「评估所有会话」→ 不带参数。会带出体积、轮数、首问。
2. **已沉淀判定**：`python3 scripts/sediment_refs.py`（`--archived-only` 可选）。它采集 `~/.memory-bank/**/*.md` 里的 `s:` 引用，与会话的 `session_id`/`provider_session_id` 精确或**截断前缀**匹配。
3. **分桶组批**：`>12 轮` 或**预估预览量 >30KB** 的长会话单独排队（**不要按 transcript 体积判**——workbuddy 的体积多是工具结果，31M/59 轮未必比 1.1M/2 轮更贵）；其余按「6~10 条 / ≤30KB」组批，同 provider、同项目优先同批。把批次号与总数记下来（后面每批都要报「累计 k/M」）。

**每批循环**

4. **读这一批**：小会话一次读完（见 §抽取脉络的多路径用法）；长会话按 §长会话分片 逐片读。
5. **出分诊表 → 停**。表要能独立看懂，不依赖上一批上下文。
6. 用户回话后 → **先执行本批的删 / 沉淀**（删除照 `cleanup.md` 与 SKILL.md §0 铁律；沉淀见 §交接）→ 再取下一批，回第 4 步。

**分诊表模板**（每批就这一张表 + 一句「下一批…继续？」）

| # | sid | 名字 | 体积 / 轮 | 处置 | 依据 |
|---|---|---|---|---|---|
| 1 | `13a8b351` | 侧栏圆点含义 | 320K/59 | 沉淀 | 圆点三态定义与时间窗，代码里没有 |

- 「处置」只有四种：`删` / `沉淀` / `沉淀后删` / `存疑`。
- 建议删的条目在表下补一行**删除明细**（这份表即干跑输出，用户点「删」就直接执行，不再二次干跑）：

```
将删：[1] DB 行 1 + transcript 1 + superseded 0 · [3] DB 行 2（zcode 共享库 1）
```

- 估算体积时**把同名目录一起算进去**（workbuddy 的 `<psid>/` 里有子代理与 tool-results）：只算 `.jsonl` 会低估，实测一条估 30.9M、实删 41.7M。
- 估算只是预告；**执行时以 `purge.py` 干跑输出的「文件 N，目录 N，约释放 X MB」为准**，两者差得多就在报告里说明（不是错误，是有目录）。

- `存疑` 只放「bank 里多半已有但没确证」这类，写清差哪一步确证，交给用户一句话定。

## 长会话分片

一条会话就能吃满上下文，所以不长读，按窗口读（`extract.py --start/--limit`）：

```bash
python3 scripts/extract.py <path> --max 200 --limit 8              # 首片：主题定性
python3 scripts/extract.py <path> --max 200 --start 9 --limit 8    # 续片
```

纪律：

- **有明确价值信号就收口**——看到业务规则/架构决策/根因/字段口径，直接给「值得沉淀，落在 X」，不必读完全文。读全是为了定性，不是为了抄全文。
- 没定性就报「读到 1-8/40 轮，暂未见可沉淀内容，继读？」，**等回话**再续。
- 也可以建议「整条像调试过程，判无价值、不必逐片读」，但由用户拍。
- 每片报「已读 x/y，剩 z 轮」，用户才知道还要不要读。
- 一片读完就把细节丢掉，只留一句结论——分片的意义就在这。

## 已沉淀判定：`s:` 引用

- 判定来源＝`session-sediment` 写进 `~/.memory-bank/<project>/entries/*.md` 的 `s: <provider>:<id>` 行，**不是** cloudcli DB 字段。
- 正则：`s:\s*([A-Za-z]+):\s*`?([0-9a-fA-F][0-9a-fA-F\-]{3,})`。
- 同一引用可能匹配**多条**会话（如一条原始会话 + 它的一条 fork）——都算命中，分别处置。
- **大量 `s:` 引用指向早已删除的会话**（引用悬空、只剩沉淀），是正常态，不用追、不用清。
- 删已沉淀会话前确认「对应条目确已在 OV 镜像里」——本地 `entries/` 有、OV 没推的话，删了会话仍不丢（本地是权威副本），但要在报告里点明。
- 一条会话可能「内容值得沉淀但从未沉淀」——`s:` 命中为空不等于无价值，两者别混。

## 同主题多会话：先对齐时间，再下结论

同一处代码常被反复问「这版改对了吗」，**后一次才是最终结论**（实测踩过：15:22 那条判「不对」，4 分钟后 15:27 那条判「对」——它们是同一行的两个版本）。

- 判价值前先比 `updated_at`；已删会话可从快照库查：`sqlite3 "file:<backup>?mode=ro&immutable=1"`。
- **以最晚那条为准**；写沉淀时把「前一版被判有问题 → 后一版确认」的时序写清，不要把过时判断沉进去。
- 两条都只是单点确认、结论又跟随代码时，可以都删——但删之前必须确认没有把最终结论一起删掉。

## fork 父子：先找分叉点，别读两遍

fork 出来的子会话**前半段是父 transcript 的原样复制**（实测父 61 轮 / 子 40 轮，前 39 轮 USER 文本逐字相同）。

```python
# 比对 USER 序列找分叉点（需先 import scripts/extract.py）
a = [u[:40] for u, _ in extract.parse_jsonl(parent, prov)]
b = [u[:40] for u, _ in extract.parse_jsonl(child, prov)]
n = 0
while n < min(len(a), len(b)) and a[n] == b[n]: n += 1
```

- 只读「父全部 + 子从第 n+1 轮起」，省掉一半以上。
- **父子必须同批处置**：父删子留会留下悬空 `forked_from_session_id`（转录本身是独立副本，不会坏，但语义脏）；子删父留则父子关系断一半。
- 父已不存在（悬空 fork）时按独立会话读，别去找父。

## 项目归属：按 `project_path` 反查 bank 目录

写沉淀前先取 `sessions.project_path`，映射到 `~/.memory-bank/<project>/`；没有对应目录就新建（`entries/` + `_index.md`），并在 OV 侧先 `ov mkdir`。

- **别按 provider 猜项目**：同一条 workbuddy 会话可能属 cloudcli、ToC-Admin、rea、ai-center 中任一个，判据只有 `project_path`。
- 已有同主题条目时**更新而不是新建**（先 `grep` `entries/` 标题与正文，再 `ov find`）。


## 价值判定

### 无价值（可删）

- **一次性 ops / 分析 / 脚本**：设备异常登录报告、Doris 同比环比、日志一次性分析、订单明细小改、退款脚本等——产出了用过就完，无需复用。
- **改动已落代码**：`resetDictCache` 告警修复、切面监控改动等——结论已在代码里，会话无额外信息。
- **已被 bank 覆盖**：主题与 bank 某条目一一对应（如「输入框弹起」→ `20260916-01 移动端键盘避让`）。判时要真找到对应条目，别凭印象。
- **transcript 已丢的孤儿行**（`jsonl_path` 为空且非 zcode）。
- **含明文密钥/敏感信息的转写**：先删（不必沉淀）。沉淀流程本身也有隐私边界，但会话文件留着就是风险。

### 值得沉淀

未来最可能被检索、且不能从代码/git 直接复原的内容：

- 业务规则与实现口径（抽奖规则、数据导出任务中心、Redis key 规范…）；
- 架构/技术决策（服务拆分边界、共库共 jar、写权唯一…）；
- 字段 / 接口 / 数据口径（OpenAPI 签名模式、token 回填…）；
- 排障根因（`drawPrize` off-by-one、对账不平口径…）；
- 进行中的任务与恢复点（状态带 `investigating`/`active`，后续需再更新）。

### 边界（停下问）

主题「bank/文档里多半已有」但没确证时，**别自己拍**——列出候选、说明理由，交用户一句话定。经验：这类「多半已有」的批量候选，用户往往一句「删掉」即可。

## 抽取脉络（判断辅助）

判断一条会话的内容时，抽它的提问脉络（USER 轮 + 末答），别只看名字。

**路径别手抄 `sqlite3` CLI 的列输出**：默认 column 模式会把空格渲染成 `·`、把中文渲染成 `\u{...}`，抄出来必然「文件不存在」。要路径就用 `python3` 读库（`os.path.exists` 直接判）、或 `sqlite3 -json`。

```bash
# 小会话成批读：一条命令读多条（读完；--max 只压答案长度）
python3 scripts/extract.py <a.jsonl> <b.jsonl> <c.jsonl> --max 200
# 长会话分片读
python3 scripts/extract.py <path> --max 200 --start 9 --limit 8
# zcode 从自己的库读（--id 可重复）
python3 scripts/extract.py --provider zcode --id sess_aaa --id sess_bbb
# opencode 也走 zcode 解析器，但要指它的库（jsonl_path 恒 NULL，没有文件可给）
python3 scripts/extract.py --provider zcode --db ~/.local/share/opencode/opencode.db --id ses_xxx
```

各 provider 的行结构差异（`extract.py` 已内置，供排障参考）：

| provider | 行特征 | 用户消息在 | 助手答案在 |
|---|---|---|---|
| claude | `type` = `user`/`assistant`，`message.content` 块 | `type=='user'` | `type=='assistant'` 的 text 块 |
| workbuddy | `type=='message'` + `role`，content 块 `input_text`/`text` | `role=='user'` | `role=='assistant'` |
| codex | `type=='event_msg'`，`payload.type=='item_completed'`，`item.type` | `item.type=='UserMessage'` | `item.type=='AgentMessage'`（取 `phase=='final'`） |
| zcode | sqlite `message.data.role` + `part.data.type` | role=='user' | role=='assistant' 的 `text` part |

过滤噪声：跳过以 `<` 开头、`Caveat:`、含 `tool_result`/`environment_context`、以及重复的用户消息。

## 交接给 `session-sediment`

选定后，**本 skill 不写条目**。调用用户级技能 `session-sediment`（`/session-sediment`），它负责：

- 先按主题检索已有条目（本机 `entries/` + OV），决定**更新**还是**新建**；
- 选 `kind`（`checkpoint`/`knowledge`/`case`）与模板，建事实账本、过质量门；
- 写 `s: <provider>:<id>` 引用、落 `~/.memory-bank/<project>/entries/`、更新 `_index.md`；
- 同步 OV `viking://resources/<project>/session-sediments/`。

交给它时把「哪几条会话、各自归到哪个项目、拟定 kind、是否有同主题旧条目」一次说清（分项目分批发，每批贴草案给用户过）。

**注意 OV 行为**：`ov add-resource` 对**已导入**条目不覆盖，会生成 `..._1` 并列副本；正确做法是先 `ov rm -r` 旧条目、`--wait` 等任务 `completed`，再重导（细节见 `session-sediment` 与 `reference_openviking_import_shape`）。

**新项目第一次沉淀**：`--parent` 指向不存在的目录会直接 `[NOT_FOUND] Resource not found`。先 `ov mkdir viking://resources/<project>/session-sediments/` 再导。`@` 等字符在生成 URI 时会被替换成 `_`（文件名与 bank 条目名不变，别以为导错了）。

**「沉淀后删」必须同批落地**：条目写进 bank + OV 之后，把这条会话的 sid **立刻加进本批删除清单**，别只在报告里写「已沉淀（可删）」。一旦留到下一批，它就会沉在池子里被反复重读（踩过：一条已沉淀会话连过 5 批还在列表里）。

## 收尾

- 沉淀完成后，源会话通常「留着只占地方」——**提议**按应用内「永久删除」语义清掉（DB 行 + 磁盘 transcript + superseded），由用户决定。
- 报告里给：本轮删了几条、释放多少、`integrity_check`、快照路径、以及「已沉淀会话 100% 清完/还有哪些未沉淀」。
