# session-cleanup 技能审计与修复方案（待审批）

- 审计对象：`.agents/skills/session-cleanup/`（`SKILL.md` 207 行 + `references/` 3 份 + `scripts/` 5 份，共 2761 行）
- 审计时间：2026-11-11
- 状态：**仅审计，未改任何代码**。第 5 节是建议执行顺序，等审批结论后再动手。
- 交付对象：亮 / 外部评审 AI

---

## 0. 给评审者的三句话

1. 这个技能做**会话清理**：盘点已归档会话 → 逐条判定（删 / 沉淀 / 保留）→ 出固定形态结果块 → 用户批准后才沉淀与物理删除。
2. 本轮审计找到 **16 处问题**：4 处会产出错误结论或破坏数据，7 处会误导执行者，5 处是冗余/可维护性。其中 2 处已用命令复现（A2、A4），1 处无法实测只能按代码推断（A1，已标注）。
3. 需要你判断的不是「要不要修」，而是**三个取舍**（第 4 节）：openclaw 补还是标、`--db` 语义怎么定、文档冗余清到什么程度。

**审批方式**：对第 3 节每项勾「接受 / 驳回 / 改方案」，对第 4 节三个取舍各选一个。若不同意某项，请指出代码里反驳它的具体行——本审计的每条结论都带 `file:line`，可以直接对质。

> **阅读顺序提示（2026-11-11 复核后追加）**：第 3~5 节是审计初稿，第 6 节是外部批注，**第 7 节是审计方对批注的复核回应，覆盖前文的结论**。已知初稿有 3 处误判（B4 / B7 / C4 后半），复核时被 CodeBuddy 与 Claude 用生成器源码推翻，详见 §7.1。以 §7 为准。

---

## 1. 被审对象与设计约束

### 1.1 执行链路

```
ledger.py init（盘点归档区，写台账）
  → 循环：next（出一批 read_cmd）→ 派 Explore 子代理读 transcript → 回 JSON → mark
  → sync（补跑批期间新归档的）
  → report（人看的完整报告）
  → result（唯一对外形态，四段固定骨架，原样贴给用户）
  → 用户 P 之后：沉淀（session-sediment）→ purge.py 干跑 → 确认 → --apply
```

数据源：`~/.cloudcli/auth.db`（`sessions` / `superseded_provider_sessions`）+ 各 provider transcript。台账落在 `~/.memory-bank/_cleanup/<run>/`。

### 1.2 技能自身的硬约束（本次审计的判据来源）

- **三问判据**（`SKILL.md` §2）：①能否只靠代码/库/git 重建（只能否决，不能批准删）②有无代码外信息（被否方案、踩坑、不可逆口径、权宜标记）③OV 是否已覆盖且更全（删的必要条件）。判删 = ①②③ 同时成立。
- **铁律 15 条**（§0）：其中 10/11/14 各自背着一笔真实数据损失。
- **结果块固定形态**（§1.2 + `references/result-skeleton.md`）：四段、列固定、空集写「无」、块外不写散文。
- **删除语义**（`purge.py` 文件头）：等价于应用内 `permanentlyDeleteArchivedSessions({force:true, deletedFromDisk:true})`。

### 1.3 本次审计的红线（也是给评审者的约束）

用户上一轮明确担心「硬性输出会让 AI 一直返工」，因此：

- **不新增机制**：不加配置文件、不加模板引擎、不让 `--check` 去比对文档。
- **不加校验门**：不因为「可能写错」就给 `mark` / `land` 加更多拦截。
- **只做最小修正**：每条修法都必须能追到某一行的具体错误；能改注释就不改逻辑，能改一行就不改函数签名。
- 若你的建议违反以上三条，请在审批意见里单列理由。

---

## 2. 核验方法

| 手段 | 范围 |
|---|---|
| 静态读 | 5 个脚本全文 + 3 份文档关键段 |
| 实跑复现 | `ledger.py result` 对真实台账 `20261111-archived`（22 条、15 sediment / 7 keep）执行，含 `--check` |
| 对照实现 | 用 `server/modules/database/repositories/sessions.db.ts` 的应用删除逻辑对照 `purge.py` |
| 未实测 | A1（本机库内已无 opencode 会话，见该项说明） |

复现环境：macOS / Python 3 / 台账快照 `~/.memory-bank/_cleanup/20261111-archived/`。审计时该台账的 15 条 sediment 会话均已物理删除，因此 `result` 显示「删除 15」。

---

## 3. 问题清单

总览：

| ID | 级别 | 一句话 | 位置 | 是否需拍板 |
|---|---|---|---|---|
| A1 | 中 | `read_cmd` 对所有共享库会话硬编码 `--provider zcode`（死参数），未知 provider 落 `--db ?` | `ledger.py:266-274` | 否 |
| A2 | 高 | 库读不到时表头写「删除 0 · 保留 0」，明细写 `-` | `ledger.py:578-579` | 否 |
| A3 | 高 | `purge.py` 不释放 `parent_session_id`，删父后子会话悬空 | `purge.py:297-304` | 否 |
| A4 | 中高 | `result --db` 参数存在但被静默忽略 | `ledger.py:571` + `:886` | **是（D2）** |
| B1 | 中 | openclaw 只在 `purge.py` 接入，盘点/读取/文档全无 | `purge.py:30-62` vs `inventory.py:22-26` | **是（D1）** |
| B2 | 中 | `description` 仍承诺「给一份总结（秒杀清单+摘要）」 | `SKILL.md:3` | 否 |
| B3 | 中 | 引用「铁律 7」，但同题不构成删理由是铁律 6 | `cleanup.md:224` | 否 |
| ~~B4~~ | — | **驳回（审计误判）**：`cleanup.md:174` 是对的，错的是 `auto-run.md:178-186`，见 E1 | `cleanup.md:174` | 已订正 |
| B5 | 中 | 批大小同时写「一批 5 条」和「不超过 8 条」 | `auto-run.md:51,60` | 否 |
| B6 | 中 | 注释说「直接删 read_state 会留孤儿」，因果写反 | `purge.py:299-303` | 否 |
| ~~B7~~ | — | **驳回（审计误判）**：`SKILL.md:78` 是对的，§0 由 `ledger.py:781` 条件输出 | `SKILL.md:78` | 已订正 |
| **E1** | **高** | `auto-run.md` 的报告结构清单错位：概览被编成 §1，全体 +1，凭空编 7/8，漏 §0 | `auto-run.md:178-186` | 否 |
| C1 | 低 | 说「常量在 `ledger.py` 顶部」，实际在 493-512 行 | `SKILL.md:59`、`result-skeleton.md:3` | 否 |
| C2 | 低 | §1.2 排在 §1.1 之前 | `SKILL.md:50,76` | 否 |
| C3 | 低 | golden 实例被截断但未标注，会被当成完整输出 | `result-skeleton.md:44-73` | 否 |
| C4 | 低 | 三处收尾重复（成立）；「判定表与报告桶重复」不成立（后半驳回） | `SKILL.md:61,110` + `auto-run.md:189` | 否 |
| C5 | 中 | 老库缺 `session_read_state` 时抛错，且跳过收尾核对与汇总 | `purge.py:303` | 否 |

---

### A1 `read_cmd` 硬编码 `--provider zcode`

**位置**：`scripts/ledger.py:266-274`

```python
db = {"zcode": "~/.zcode/cli/db/db.sqlite",
      "opencode": "~/.local/share/opencode/opencode.db"}.get(s.get("provider"), "?")
return (f'{base} --provider zcode --db {db} --id {s.get("psid") or s["sid"]} '
        f"--max 200 --start <n> --limit 5")
```

**现象**：`db` 按 provider 正确取到了 opencode 的库路径，但 `--provider` 这一侧写死 `zcode`。provider 不在映射表内时 `db="?"`，命令变成 `--provider zcode --db ?`。

**影响**：`extract.py` 的 `--provider` 决定解析器（`extract.py:315` 的 choices 里根本没有 `opencode`），所以 opencode 会话会被要求用 zcode 的读法打开 opencode 的库。`inventory.py:21-24` 的注释声称两者 `session/message/part` 结构一致，若属实则**碰巧能读**——但这是巧合，不是设计；`openclaw` 则连库路径都会落到 `?`。

**诚实标注**：本机库内当前已无 opencode / openclaw 会话（`select provider,count(*)` 只剩 claude 1 / dsh 5 / pi 6 / workbuddy 5），**未能实测**是否真的读不出内容。因此本条定级为「必然注入错误参数」，不是「必然读不出」。要坐实功能影响，需造一条 opencode 会话跑一次 `read_cmd`。

**建议**：`--provider` 改用 `s["provider"]`；`extract.py` 的 choices 补 `opencode`（复用 zcode 读法并注释说明共用结构）；无读取路径的 provider 直接返回一句 `# 无读取路径，标 blocked`，不要让子代理去跑一个参数错误的命令。

---

### A2 库不可达时表头显示「删除 0 · 保留 0」

**位置**：`scripts/ledger.py:578-579`

```python
deleted = sum(1 for s in judged if live is not None and s["sid"] not in live)
kept    = sum(1 for s in judged if live is not None and s["sid"] in live)
```

**复现**（把台账复制到 `/tmp`，`run.json` 的 `db` 指向不存在的路径）：

```
结果 · 20261111-archived · archived · 22 条 · 10.5M
判定 sediment 15 · keep 7 · kill 0 · discard 0 · blocked 0
落地 31 条目 → 27 文件｜删除 0 · 保留 0          ← 这里是 0
① 会话 …  cbe71bb7  9  sediment  4  3  bank:lemobar-toc-power  -   ← 这里是 -
```

**影响**：同一份输出里两个字段对同一事实给出相反答案。0 读作「什么都没删」，`-` 读作「不知道」。换机、改路径、库被锁时都会命中，而「删除 0」是最容易被当成真实结论继续往下走的形态——正是这个技能最不该出的错。

**建议**：`deleted` / `kept` 在 `live is None` 时取 `"-"`，与 `_disposition()` 的约定一致（`RESULT_TOTAL` 是 `str.format`，接受字符串）。

---

### A3 `purge.py` 不释放 `parent_session_id`

**位置**：`scripts/purge.py:300-304`；对照 `server/modules/database/repositories/sessions.db.ts:121-125`

应用侧删除是三步一个事务：

```sql
UPDATE sessions SET parent_session_id = NULL
 WHERE parent_session_id IN (SELECT session_id FROM sessions WHERE ...);
DELETE FROM session_read_state WHERE session_id IN (...);
DELETE FROM sessions WHERE ...;
```

`purge.py` 只做了后两步。`parent_session_id` 是「用户把会话归档到某个父会话下」的归属链接（`schema.ts:220-226`，注释明写「Deliberately NOT a foreign key … delete paths clear it explicitly so children survive their parent」）。

**影响**：删掉被归档的父会话后，子会话的 `parent_session_id` 指向一条已不存在的行。子会话数据还在，但归属链断了——UI 上可能整组消失或渲染异常，而这类现象最容易被误诊成「缓存」，技能里恰好又有「UI 还显示 → 重启」的既有结论，会往错误方向排查。

**为什么之前没发现**：`purge.py` 只查 `forked_from_session_id`（fork 下游，见 `:258`）。这两个字段是**不同维度**——`forked_from_session_id` 是分支来源（informational），`parent_session_id` 是用户维护的归档归属。技能文档把两者都叫「fork」，掩盖了差异。

**建议**：删除行之前补一句 `update sessions set parent_session_id=NULL where parent_session_id=?`，与 `session_read_state` 同事务。顺带在 `SKILL.md` 铁律 15 里点明这是两个字段。

---

### A4 `result --db` 被静默忽略

**位置**：`ledger.py:886`（`common` 里定义 `--db`）、`:571`（`render_result` 只用 `run.get("db")`）

**复现**：

```
python3 ledger.py result --run-id 20261111-archived --db /nonexistent/auth.db
→ 输出与不传 --db 完全一致（删除 15 · 保留 7）
```

**影响**：`result` 的「处置」列依赖读库，而 `--db` 唯一的用途就是换库（核对快照、验证删除结果）。参数存在、不报错、也不生效——三种最坏的组合同时具备。想在备份库上复核「应该显示未删」时，会得到一个看起来正常的错误答案。

**建议**：两种改法二选一，见 D2。

---

### B1 openclaw 半接入

**位置**：`purge.py:30-62,148-149,215-233,385-407`；对照 `inventory.py:22-26`、`extract.py:315`、`SKILL.md:160-168`、`cleanup.md`

**现象**：`purge.py` 完整实现了 openclaw（每个 agent 一个 store、`agent:<id>:<key>` 形态、三张 window 表），但：

- `inventory.py` 的 `SHARED_DB_PROVIDERS` 只有 zcode / opencode → openclaw 会话不会被列进「provider 库独有」，也不会从库里取volume/轮数；
- `extract.py` 的 `--provider` choices 没有 openclaw → 无法读取；
- `SKILL.md` §5 的 provider 表只有 7 个 provider，没有 openclaw；
- `cleanup.md` 的库路径与表清单一字未提。

**影响**：能力存在但不可用。更糟的是**不对称**——清理阶段能删，评估阶段看不见，等于绕过了三问判据直接进删除。若真有人拿 `--targets` 去删 openclaw 会话，它们从未被判过。

**建议**：见 D1。

---

### B2 `description` 与 §1.2 矛盾

**位置**：`SKILL.md:3`

> 「最后给一份总结（秒杀清单 + 每条有价值会话的沉淀落点与摘要）」

而 §1.2 已改成「正文 = `result` 输出块，原样粘贴，不追加散文」。

**影响**：`description` 是模型决定「要不要用这个技能、怎么收尾」的第一手材料。它和正文规则打架时，最可能的失败是收尾又写回散文总结——正是这一轮改造要消灭的形态。

**建议**：把 description 末句改成「最后出固定四段结果块（`ledger.py result`）」。

---

### B3 铁律编号引错

**位置**：`cleanup.md:224`

> 「题目相同不构成理由，见 SKILL.md 铁律 7」

铁律 7 是 fork 父子；同题 ≠ 同内容是**铁律 6**。铁律 6 背后是 2026-10-24 三条 18~36 轮会话被误删的事故，引错等于把最贵的那条教训指到了无关条目。

**建议**：7 → 6。

---

### B4 入口指向的 report 小节号不存在 —— **【驳回，本项为审计误判，见 §7.1】**

**位置**：`cleanup.md:174`

> 「目标直接取 `report.md` 的 §1 秒杀区 / §2 无价值可删 / §3 沉淀后可删」

实际 `auto-run.md:178-181` 的结构是：1 概览 / **2** 秒杀区 / **3** 无价值可删 / **4** 待沉淀。全部错位一位。

**影响**：执行者按 §3 去找「沉淀后可删」，会读到「无价值可删」，进而删掉尚未沉淀的会话。这是**会直接导致误删**的文档错误，不是排版问题。

**建议**：改成 §2 / §3 / §4，或在 `cleanup.md` 里改用小节名而非编号（编号会随报告增删漂移）。

---

### B5 批大小 5 与 8 并存

**位置**：`auto-run.md:51`「判定（一批 5 条）」、`:55`「`next --limit 5`」、`:60`「一批不超过 8 条」；`SKILL.md:123`「一次最多 8 份 JSON」

**影响**：执行者要自己决定信哪个。默认 5、上限 8 本身可以自洽，但两处都没说「默认/上限」的关系，读起来就是矛盾。批太大伤上下文，太小多轮往返——两种都有人会照做。

**建议**：统一成「默认 5（`--limit 5`），上限 8」，两处措辞一致即可。

---

### B6 `read_state` 注释因果写反

**位置**：`purge.py:300-303`

> 「这里直接删行会绕过 `reclaimReadStateFor`，于是「用户读过该会话」就必然留下读水位孤儿」

对照 `sessions.db.ts:81-97`：`reclaimReadStateFor` 做的事就是 `DELETE FROM session_read_state WHERE session_id IN (即将被删的 sessions)`。`purge.py` 的 `delete ... where session_id=?` 与它**等价**，不会留下孤儿；真正会留孤儿的是「不删」。

**影响**：注释把一个正确操作描述成有副作用，下一个维护者可能因此加一层「补偿清理」，或者反过来误以为读水位需要单独处理。

**建议**：改注释为「与 `reclaimReadStateFor` 等价，无外键故需显式删」。

---

### B7 「报告 §0 会列出未处理」，但 report 没有 §0 —— **【驳回，本项为审计误判，见 §7.1】**

**位置**：`SKILL.md:78`（§1.1 只点名一条会话时）

> 「先判那一条，判完 `report`，其余留 pending——报告 §0 会列出未处理，不会假装全评完。」

`report` 的结构（`auto-run.md:178`）第 1 节是「概览（总数 / 未处理 / …）」，没有 §0。而 `result` 的「未处理」在 ③ 异常里。

**影响**：轻微，但这类「指向不存在的小节」会让执行者在报告里找不到自证材料，进而怀疑「是不是没跑」。

**建议**：改成「概览会列出未处理条数，`result` 的 ③ 会逐条列 sid」。

---

### C1 「常量在 `ledger.py` 顶部」实为中部

**位置**：`SKILL.md:59`、`references/result-skeleton.md:3`

实际 `SECTION_*` / `COLS_*` / `W_*` 在 `ledger.py:493-512`（全文 933 行）。『顶部』会让维护者在前 50 行里找，找不到就以为常量在别处（或以为不存在）。

**建议**：改成「`ledger.py` 的结果块段落（493 行起）」，或直接写「搜 `SECTION_SESSION`」。

---

### C2 §1.2 排在 §1.1 之前

**位置**：`SKILL.md:50`（§1.2 收尾输出）在 `:76`（§1.1 只点名一条会话）之前。

**影响**：编号与顺序不一致，读者会以为漏了 §1.1，或者以为 §1.2 是 §1 的子节。纯排版，但改起来零成本。

**建议**：正文交换两节（收尾放最后更符合执行顺序）。

---

### C3 golden 实例被截断但未标注

**位置**：`references/result-skeleton.md:44-73`

实例里：① 用 `...` 省略了 14 行；② 只列了 3 个落点（真实输出 7 个）；③ 只有 1 行、说明以 `…` 截断。文件里没有任何「本实例已省略」的字样。

**影响**：`result-skeleton.md` 的作用是「长什么样算合法」。一个被截断的样例如果被当成完整样例，后续核对时会以为少了行就是 bug，或者反过来把截断当成允许行为。

**建议**：在实例前加一行「以下为节选：① 省略 14 行，② 省略 4 行，③ 说明列截断」。保留真实输出，不改内容。

---

### C4 report / result 分工讲了三遍；判定表与报告桶重复 —— **【前半成立，后半驳回，见 §7.1】**

**位置**：

- `SKILL.md:61-67`（§1.2 表：四段内容与排序）
- `auto-run.md:59-61`（§2.4 收尾三步，又把「原样粘贴、不改写」说一遍）
- `auto-run.md:191-193`（§6 末尾，第三次说「回话就是 result.md 逐字粘贴」）
- `SKILL.md:110-116`（五种判定表，带「报告里的位置」列）与 `auto-run.md:178-186`（报告八节结构）互相定义对方

**影响**：三处措辞略有差异，改一处忘另两处就会自相矛盾（B2 就是这么来的）。判定表里「报告里的位置」列是三处里最容易过期的一处——报告结构一改就要同步改表。

**建议**：保留 `SKILL.md` §1.2 为唯一权威；`auto-run.md` §2.4 只留一句「按 §1.2 执行」；§6 末尾删掉重复段落。判定表去掉「报告里的位置」列，让报告结构只在 `auto-run.md` 定义一次。

---

### C5 老库缺表时中断在文件删完之后

**位置**：`purge.py:303`

```python
con.execute("delete from session_read_state where session_id=?", (sid,))
```

同一批 `if args.apply:` 里，**文件与目录在此前已经 `os.remove` / `shutil.rmtree`**（`:271`、`:292`），DB 删除则在最后 `commit()`。

`session_read_state` 是后加的表（`schema.ts:384` 的 `CREATE TABLE IF NOT EXISTS` + `migrations.ts:720` 的索引），老库或手工快照可能没有它。此时 `delete` 抛 `OperationalError`，事务未提交，但**文件已经删了**。

**影响**：不是静默错误，是「半删除」——transcript 永久丢失、DB 行还在，重跑时会被报 `MISS`。技能里已有「快照只救 DB 行，文件删了不可恢复」的告诫，这条正好是它的现实版本。

**建议**：删除前用 `select name from sqlite_master where type='table' and name='session_read_state'` 判存在，不存在则跳过并打印一行提示；不要用 try/except 吞掉其它错误。

---

## 4. 需要拍板的三个取舍

### D1 openclaw：补齐还是标注？

| 选项 | 内容 | 代价 | 风险 |
|---|---|---|---|
| **D1-a 补齐** | `inventory.py` 加共享库、`extract.py` 加读法、`SKILL.md`/`cleanup.md` 补 provider 行 | 约 60~80 行代码 + 2 处文档；openclaw 库结构需要读 `server/` 侧的 synchronizer 才能写对 | 写错会污染判定（读成 0 轮 → 误判 discard） |
| **D1-b 只标** | `purge.py` 头注释与 `--targets` 提示里写明「openclaw 仅支持删除，不参与盘点与判定」；`SKILL.md` §5 加一行注 | 5 行文档 | 「能删不能评」的不对称仍在，但显式化之后不会被误用 |
| **D1-c 摘掉** | 删掉 `purge.py` 的 openclaw 分支 | 删除约 30 行 | 真需要清 openclaw 时要重新写 |

**建议 D1-b**，理由：本机库里 0 条 openclaw 会话，没有实测样本；补一个读不出内容就判 blocked 的读法，反而制造假进度。等真出现 openclaw 归档会话再补，成本更低、样本更真。

### D2 `result --db` 的语义

| 选项 | 内容 | 影响面 |
|---|---|---|
| **D2-a 让它生效** | `cmd_result` 传 `args.db`，`render_result` 优先用它 | 只改 2 行；`--db` 与 `run.json` 冲突时以命令行为准，符合直觉 |
| **D2-b 删掉这个参数** | `common` 的 `--db` 只给 `init`/`sync` 用，`result` 不继承 | 要拆 `parents=[common]`，改动面更大 |
| **D2-c 报错** | `result` 检测到显式 `--db` 就退出并提示「处置列固定读 run.json 的库」 | 1 行；但把「想核对快照」这个正当用途堵死 |

**建议 D2-a**。注意坑：`argparse` 的默认值无法区分「没传」和「传了默认值」，所以 `--db` 的 default 要改成 `None`，`init`/`sync` 里回落 `inventory.DB`。

### D3 文档冗余清到什么程度

| 选项 | 内容 |
|---|---|
| **D3-a 只修错** | 只做 A2/B2/B3/B4/B5/B7/C1 这些「说错了」的；重复段落原样保留 |
| **D3-b 修错 + 去重** | 在 a 的基础上做 C4：三处合一、判定表去掉「报告位置」列 |
| **D3-c 重构文档** | 重排 SKILL.md 结构、合并 references |

**建议 D3-b**。C4 的三处重复已经实际产生过一次矛盾（B2），且去重是减法、不增加执行负担。c 会带来你说的「返工」风险：文档结构一变，所有引用它的地方都要跟着改。

---

## 5. 建议执行顺序

分两批，**每批都能独立验证，不依赖下一批**。

**第一批：脚本（A2 → A4 → A3 → C5 → A1）**

| 步 | 改什么 | 验证 |
|---|---|---|
| 1 | A2：`live is None` 时 `deleted`/`kept` 取 `-` | 用 `/tmp` 台账复现实验，表头应显示 `删除 - · 保留 -` |
| 2 | A4：`--db` 生效（按 D2 结论） | `result --db <快照库>` 应显示 `保留` 而非 `已删` |
| 3 | A3：补 `parent_session_id` 释放 | 造父子两行，删父，子行 `parent_session_id` 应为 NULL |
| 4 | C5：`session_read_state` 存在性判断 | 用不含该表的库跑 `--apply` 干跑，应提示跳过而不是崩 |
| 5 | A1：`--provider` 用真实 provider（按 A1 结论，含 openclaw 分支处理） | 造一条 opencode 会话，`next` 输出的 `read_cmd` 里 `--provider` 应为 `opencode` |

每步跑一次 `ledger.py result --check`，确认结构自检仍通过。

**第二批：文档（B2 → B3 → B4 → B7 → B5 → C1 → C2 → C3 → C4）**

纯文档，无验证成本。B4 优先——它是唯一会导致误删的一条。

**不建议做的**（评审时请一并确认）：

- 不给 `result --check` 加「比对 `result-skeleton.md`」的能力（用户已否决，怕返工）。
- 不引入 `execution.md` 之外的任何新文件类型。
- 不把 `purge.py` 改成「调用应用内的删除函数」（跨语言，收益小于风险）。
- 不为 `parent_session_id` 加一层新的 fork 检查——它是归属不是分支，加检查会误伤正常归档。

---

## 6. 审批表

请对每项给出结论；「驳回」请附反驳依据。

| ID | 结论 | 备注 |
|---|---|---|
| A1 | ☐ 接受 ☐ 驳回 ☐ 改方案 | |
| A2 | ☐ 接受 ☐ 驳回 ☐ 改方案 | |
| A3 | ☐ 接受 ☐ 驳回 ☐ 改方案 | |
| A4 | ☐ 接受 ☐ 驳回 ☐ 改方案 | |
| B1 | ☐ 接受 ☐ 驳回 ☐ 改方案 | 采纳哪个选项见 D1 |
| B2 | ☐ 接受 ☐ 驳回 ☐ 改方案 | |
| B3 | ☐ 接受 ☐ 驳回 ☐ 改方案 | |
| B4 | ☐ 接受 ☐ 驳回 ☐ 改方案 | |
| B5 | ☐ 接受 ☐ 驳回 ☐ 改方案 | |
| B6 | ☐ 接受 ☐ 驳回 ☐ 改方案 | |
| B7 | ☐ 接受 ☐ 驳回 ☐ 改方案 | |
| C1 | ☐ 接受 ☐ 驳回 ☐ 改方案 | |
| C2 | ☐ 接受 ☐ 驳回 ☐ 改方案 | |
| C3 | ☐ 接受 ☐ 驳回 ☐ 改方案 | |
| C4 | ☐ 接受 ☐ 驳回 ☐ 改方案 | |
| C5 | ☐ 接受 ☐ 驳回 ☐ 改方案 | |

**取舍**：

| 决策 | 选择 | 理由 |
|---|---|---|
| D1 openclaw | ☐ a 补齐 ☐ b 只标 ☐ c 摘掉 | |
| D2 `--db` | ☐ a 生效 ☐ b 删参数 ☐ c 报错 | |
| D3 文档冗余 | ☐ a 只修错 ☐ b 修错+去重 ☐ c 重构 | |

**开放问题**（需要评审者补充的，不在上表内）：

1. A1 是否需要先造 opencode 样本实测，再决定「修复」还是「标注为已知限制」？
2. `purge.py` 的「语义 = 应用内删除」这一定义是否还成立？若不成立（少了 `parent_session_id` 释放），是补实现还是改定义？
3. 结果块的「处置」列是否应该同时区分 `已删(本批)` 与 `已删(历史)`？目前两者都显示 `已删`。

---

## 审阅批注

### CodeBuddy

> [!CAUTION] B4 是假阳性，按它改会制造它声称要消除的误删风险。已核：`report.md` 由 `ledger.py:782-846` 生成，小节是 `## 0. 未处理（报告不完整）`（仅 pending 非空时）/ `## 1. 秒杀区` / `## 2. 无价值可删` / `## 3. 有价值 · 待沉淀` / `## 4. 有价值 · 保留` / `## 5. 阻塞` / `## 落地` / `## 附录`。真实产物 `~/.memory-bank/_cleanup/20261111-archived/report.md` 同样是 1 秒杀 / 2 无价值 / 3 待沉淀 / 4 保留 /（无 5）。所以 `cleanup.md:174` 的「§1 / §2 / §3」**是对的**，被拿来当权威的 `auto-run.md:178-186` 才是错的——它把「概览」编号成 §1 导致全体 +1，又给「落地 / 附录」凭空编了 7 / 8（生成器里这两节无编号），还漏了 §0。建议：驳回 B4；把第二批的「优先项」换成修 `auto-run.md:178-186` 这张结构清单，并按生成器补一句「§0 只在有未处理时出现、落地与附录无编号」。

> [!IMPORTANT] B7 同样假阳性。`ledger.py:781-787` 明确在 `pending` 非空时输出 `## 0. 未处理（报告不完整）` 并列出 sid / 项目 / 轮 / 体积，这正是 `SKILL.md:78` 描述的场景（「先判那一条，其余留 pending」），批注建议驳回 B7。真正缺的只是 nobody 说过「§0 是条件节」，这一句并到上面 `auto-run.md` 的修正里即可，不必动 `SKILL.md:78`。

> [!IMPORTANT] C4 的后半（删掉判定表「报告里的位置」列）建立在与 B4 相同的前提上，且证据方向相反。`SKILL.md:110-116` 的 §1~§5 与生成器 `ledger.py:789-841` 逐条对齐；反而 `auto-run.md:178-186` 是全篇唯一对不上的描述。若按 C4 执行（删列、让报告结构只由 `auto-run.md` 定义一次），保留下来的恰好是错的那份，等于把唯一正确的映射删掉。建议：C4 前半（三处收尾重复，实测是 `auto-run.md:21 / :71 / :189 / :191` 四处）照做，后半改为「修 `auto-run.md` 的结构清单」。

> [!IMPORTANT] 第 5 节的验证手段对本次改动基本是空转。`result --check`（`ledger.py:705-721`）只断言四段标题各出现一次、首行以 `结果 · ` 开头，不校验列名、列宽、排序、计数口径。A1 / A2 / A4 都是改这些「它不看的」东西，改完 `--check` 必然通过，不能当作回归证据。建议换成定点断言：A2 用 `ledger.py result --run-id … | sed -n 3p` 确认是 `删除 - · 保留 -`；A4 对同一台账跑两次（默认库 / 快照库）做 `diff`；A1 直接 `grep 'provider ' ` 看 `next` 输出的 `read_cmd` 里是 `--provider opencode`。第 5 节第 384 行「每步跑一次 `--check`」建议保留为附带动作，不要写成主验证。

> [!IMPORTANT] A1 的修法少写了两处。除了 `extract.py:315` 的 choices，还有 `:323` 的 `if args.provider == "zcode"` 门（不加就会出现「opencode 已进 choices、但走不进库读分支，转去要求 paths」）。同一处还有 `--db` 的 default 写死 `ZCODE_DB`（`:317`）。另：`--provider auto` 对共享库会话无意义，`read_cmd` 必须显式传真实 provider，否则修完仍靠传入的 `--db` 兜底——建议在 `ledger.py:266-274` 里对无读取路径的 provider 直接返回 `# 无读取路径，标 blocked`，别让子代理跑一条会「成功但读空」的命令。

> [!WARNING] A2 修完必须同步 `result-skeleton.md`，否则骨架文档立刻变成错的。`references/result-skeleton.md:10` 的模板写的是 `删除 <n> · 保留 <n>`，「稳定规则」表也只定义了 ① 处置列的 `-`（第 40 行），没有表头 `-` 的口径。只改 `ledger.py:578-579` 而不补这两行，下一个读骨架的人会判定 `删除 -` 非法。补充一句：修完后 ③ 异常（`ledger.py:641-654`）依然不会出现「库读不到」这一行（`live` 为 None 时置顶判断 `live and live.get(...)` 直接跳过），`-` 是唯一信号——这一点值得在 `SKILL.md` §1.2 口径里明说，但**不要**为此给 ③ 加第五类，那会破坏固定骨架。

> [!WARNING] A3 建议加一行「将释放 N 条子会话」的干跑打印。`cleanup.md` 的流程第 3 步把干跑清单当作确认清单（「干跑清单即确认清单，用户点头后不再二次干跑」，`SKILL.md:146`），而现在 `parent_session_id` 的释放完全不可见（`purge.py` 只打印 `fork_dep=`，是 `forked_from_session_id`）。用户批准时看不到这一步的影响面，等于让他批准一个没见过的副作用。一行 `select count(*) ... where parent_session_id=?` 就够，不增机制。另核过：置顶父会话会被 `purge.py:183-188` skip，此时子会话也不动，与 A3 的修法不冲突。

> [!TIP] D1-b 的落点要小心。`SKILL.md:160-168` 那张表是「磁盘 transcript」，openclaw 没有主 transcript、只有 per-agent store（`purge.py:47-62`），塞进表行会让「主 transcript」列无值可填。加在表下方作为注更合适。另外 `purge.py:251` 已经会打印 openclaw 的「库外（cloudcli 未收录）」会话——也就是说「能删不能评」的不对称在干跑输出里其实已经可见，b 的真正价值不是补注，而是在 `--targets` 命中 openclaw 时提示一句「该 provider 未经判定」。1 行，比 5 行文档更有效。

> [!TIP] D2-a 的具体落点比文档写的更靠前。`--db` 的 default 改成 `None` 后，第一个炸的不是 `result`，而是 `cmd_init`：`ledger.py:174` `os.path.expanduser(args.db)` 收到 `None` 直接 TypeError；`cmd_sync`（`:463`）同样把 `args.db` 当兜底值。建议显式写成 `db = os.path.expanduser(args.db or inventory.DB)`（两处），run.json 仍记展开后的路径，`render_result` 的 `run.get("db") or inventory.DB` 不用动。这样 A4 的改动面是 3 行而非 2 行。

> [!NOTE] 开放问题 3（区分 `已删(本批)` / `已删(历史)`）建议不加列。结果块已经承担「跨轮对比」，而 `result` 每次从库现状重算，本来就不该知道「哪一轮删的」；硬加需要台账记录删除时刻，属于新增机制，且与「不让硬性输出膨胀」直接冲突。现成的答案是 ④ 备注里写一句「本批删除 N 条」，`--note` 已支持，零成本。

### Claude · `session-cleanup-audit-review`

> [!TIP] 总体判断：16 项里 A2 / A3 / A4 / B2 / B3 / B5 / B6 / C1 / C2 / C5 我认为成立且修法对味（B3 的「铁律 7 → 6」已对 `SKILL.md:21-23` 核实：铁律 6 才是「同题 ≠ 同内容」，铁律 7 是 fork 父子）。但 **B4 / B7 / C4 后半 / 第 5 节验证手段** 这四处都需要退回：它们共用同一个错误前提——把 `auto-run.md:178-186` 那张手写清单当成了报告结构的权威。CodeBuddy 已经给出了生成器层面的证据，我不重复论证，只补一条**可执行的验证方式**：`grep -n 'L.append("## ' .agents/skills/session-cleanup/scripts/ledger.py`，输出就是 1 秒杀 / 2 无价值 / 3 待沉淀 / 4 保留 / 5 阻塞 / 落地 / 附录，`## 0.` 在 `:781-783` 且由 `if pending:` 控制。这份报告本身违反了它第 2 节「实跑复现」的自证标准——A2、A4 都跑了，B4、B7 却只静态读了一张二手清单。**建议**：把 B4 / B7 改判为「驳回，反向修 `auto-run.md:178-186`」，并把它列进第二批的**第一项**（它才是唯一会诱导误删的文档错误）。

> [!TIP] `extract.py` 的门比审计写的更好修，但 A1 的诊断要改一句。实读 `:340-345`：`--provider` 只在**有 `paths`** 时参与（`prov = detect_provider(path) if args.provider == "auto" else args.provider`），而走 `--id` 的分支（`:333-338`）**完全不看** `args.provider` —— 只 `print("# zcode id=…")` + `zcode_turns(sid, args.db)`。也就是说 `ledger.py:270-273` 里写死的 `--provider zcode` 当前是**无效果的死参数**，真正的变量只有 `--db`。我实测了两个共享库的表结构：`~/.zcode/cli/db/db.sqlite` 与 `~/.local/share/opencode/opencode.db` 的 `part` 表列集合完全一致（`id, message_id, session_id, time_created, time_updated, data[, sequence]`），`message` 也同构——所以 `inventory.py:21-24` 的「结构一致」注释是**可验证的事实，不是巧合**，opencode 走 zcode 读法能读出内容。**结论**：A1 的影响被高估为「必然注入错误参数」（对，但注入的参数不生效），真实的坑只剩两个——① `extract.py:317` 的 `--db` default 写死 `ZCODE_DB`，`ledger.py` 不传 `--db` 时会静默读错库；② 不在映射表内的 provider 落到 `db="?"`，命令变成 `--db ?`，且**没有任何提示**。建议把 A1 的修法从「补 choices」降级为：`read_cmd` 的 `--provider` 用 `s["provider"]`（为将来铺路）+ 未知 provider 返回 `# 无读取路径，标 blocked`，并把 `choices` 补 `opencode` 写成「共用 zcode 读法」的注释。改动面比审计估计的（含 `:323` 的门）更小。

> [!WARNING] 审计漏了一条比 B1 更直接的同源问题：`--targets` 命中 openclaw 时，`purge.py:256` 的循环按 `r["provider"]` 分派，但**没有任何一处校验该 provider 是否参与过判定**。B1 的「能删不能评」被描述成文档不对称（D1-b「补 5 行注释」），实际它是**代码里缺一个 provider 白名单**。补注释不改变任何行为；按 D1-b 落地后，一次误用 `--targets` 命中的 openclaw 会话仍然会被无声删掉。**建议**在 D1-b 里加一行代码而不是五行文档：`for r in targets: if r["provider"] not in JUDGEABLE_PROVIDERS: print("!!未经判定：<sid> [openclaw]" )` 并让它进 `fore_warn` 汇总段（`:446-449` 已有同类汇总位）。这属于「能改一行就不改函数签名」，不违反红线。

> [!IMPORTANT] C5 被低估了：它不是「老库才会命中」。`schema.ts` 里 `session_read_state` 是 `CREATE TABLE IF NOT EXISTS`，而 `purge.py:303` 的 `delete` 发生在**文件已删之后、`commit()` 之前**，一旦抛 `OperationalError`，脚本以异常退出，但 `:305` 的逐条 `commit` 对**当前这条**没执行、对**之前几条**已经执行 —— 结果是目标列表被切成「已彻底删 / 只剩文件没了」两段，而且脚本不会再打印 `:440` 的 `integrity_check` 与 `:449` 的汇总。审计写的是「半删除」，实际还多一层：**收尾核对被整个跳过**，而 `cleanup.md:214` 的「四个数都要干净」正是在这一步。**建议**修法从「判表存在」升级为「判表存在 + 把 `delete from sessions` 提前到文件删除之前」不可行（顺序必要），所以至少把 `:303-305` 包进 `try/finally`，保证 `commit` 与汇总一定执行。这一条应当从「低」提到「中高」。

> [!NOTE] 审计对 A2 的定级准确，但修法要连带改三处，不止两处。`result-skeleton.md:10` 的模板（`删除 <n> · 保留 <n>`）、`:40` 的处置列口径（只定义 ① 列的 `-`）、以及 `SKILL.md:70` 的「处置…库读不到 → `-`」都会在改完后变成**只对一半**（表头 `-` 无出处）。CodeBuddy 的第 7 条已指出前两处，补第三处：`SKILL.md` §1.2 的口径表必须同步加一句「表头计数与 ① 列同一口径」。另外 `--check`（`:705-721`）只验四段标题与首行前缀，**改完必然通过**，不能作为 A2 的回归证据——第 5 节第 378 行「表头应显示 `删除 - · 保留 -`」这个断言必须人工 `sed -n 3p` 看，别指望 `--check`。

> [!NOTE] 第 5 节的顺序有两处会互相打脸。① 清单里 A1 排第 5，但 A1 的修法（`read_cmd` 返回 `# 无读取路径`）依赖 D1 的结论——若采纳 D1-b，A1 第 5 步要顺带处理 openclaw 分支，否则改完仍会对 openclaw 吐出 `--db ?`。② 第 384 行「每步跑一次 `ledger.py result --check`」：`result` 在没有已判会话的台账上只输出四段空壳，`--check` 照样 OK，对 A1/A2/A4 是**零信息**。**建议**把第一批的验证改成「每个 ID 一条可 diff 的前后输出」（A2：`sed -n 3p`；A4：同台账两库 `diff`；A1：`next | grep read_cmd`），`--check` 只保留为「没改坏骨架」的附带断言，写在表格备注列里。

> [!WARNING] 三个取舍里我不同意 D3-b。理由不是「冗余不该去」，而是**本轮审计对「哪一份是权威」的判断在 B4/B7/C4 上已经错过一次**（把二手的 `auto-run.md` 当权威、把一手的生成器当错的）。在权威判断还没修好的情况下做「三处合一」，最可能的结果是把正确的删掉、把错误的留下——C4 后半就是这个错误的直接产物。**建议**顺序反过来：先按 D3-a 只修错，且**第一项是修 `auto-run.md:178-186`**；等改完再跑一次 `grep '## ' ledger.py` 与文档逐条对齐，确认没有第二处权威漂移，那时再谈 D3-b。这不增加机制，只是把「去重」从这一轮挪到下一轮，符合第 1.3 节「能改一行就不改函数签名」的精神。

> [!TIP] D2-a 我赞成，但审计写的「改 2 行」不对，实测是 3 处 + 1 个陷阱（与 CodeBuddy 第 9 条独立吻合，可用 `grep -n 'args\.db' ledger.py` 复核：`:174`、`:463`，加 `:886` 的 default）。补一个陷阱：`run.json` 里的 `db` 是**展开后**的绝对路径（`cmd_init` 存的就是 `os.path.expanduser` 结果），所以 `render_result` 里 `run.get("db") or inventory.DB` 拿到的永远是真路径，**只有当 `run.json` 缺 `db` 键时**才回落——也就是说 A4 修完后，`--db` 生效的前提是 `cmd_result` 真的把 `args.db` 传进 `render_result`，而不是靠 `run.get("db")` 兜底。请在改法里明写这条依赖，否则会「改完看起来没变化」。

---

## 7. 审计方回应（2026-11-11 复核）

两份批注（CodeBuddy、Claude）在核心结论上一致。我逐条回代码复核，**确认其中 3 条推翻了我的初稿**，另有 8 条修正了我的修法，还有 4 条我判定价值不足、建议不做（1 条可顺手）。

### 7.1 我错了：B4 / B7 / C4 后半

**证据**（@CodeBuddy、@Claude 都指出了，我复核确认）：

```
$ grep -n 'L.append("## ' .agents/skills/session-cleanup/scripts/ledger.py
782:  ## 0. 未处理（报告不完整）      ← 仅 pending 非空时输出
789:  ## 1. 秒杀区（四条全中）
799:  ## 2. 无价值可删（读过全部轮次 + OV 已覆盖）
811:  ## 3. 有价值 · 待沉淀（P 后写入）
830:  ## 4. 有价值 · 保留（不沉淀）
841:  ## 5. 阻塞                      ← 仅存在时输出
846:  ## 落地（P 之后）               ← 无编号
860:  ## 附录：全部判定               ← 无编号
```

真实产物 `~/.memory-bank/_cleanup/20261111-archived/report.md` 与之一致：概览是头部四行 `- 范围 / - 本次纳入 / - 状态`，**不占编号**。

因此：

| 初稿结论 | 复核结果 |
|---|---|
| B4「`cleanup.md:174` 的 §1/§2/§3 错位」 | **驳回**。§1 秒杀 / §2 无价值 / §3 待沉淀，完全正确。 |
| B7「`SKILL.md:78` 说报告 §0，但报告没有 §0」 | **驳回**。§0 存在，且只在有未处理时输出。 |
| C4 后半「删掉判定表『报告里的位置』列」 | **驳回**。该列 §1~§5 与生成器逐条对齐，是**唯一正确**的映射；删掉它等于保留错的那份。 |

**根因**：我把 `auto-run.md:178-186` 那张手写清单当成了权威，没查生成器。这份清单才是错的——它把概览编号成 §1 导致全体 +1，给「落地 / 附录」凭空编了 7 / 8，又漏了 §0。这直接违反我在 §2 写的「实跑复现」标准：A2、A4 我都跑了命令，B4、B7 却只读了一张二手清单。

**新增 E1（级别：高）**：修 `auto-run.md:178-186` 的结构清单，按生成器写成

```
0. 未处理（仅 pending 非空时出现）
1. 秒杀区  2. 无价值可删  3. 待沉淀  4. 保留  5. 阻塞（如有）
落地（无编号）  附录：全部判定（无编号）
```

并补一句「概览是报告头部，不占编号」。**这是两份批注里唯一新增的高价值项，应排第二批第一项。**

### 7.2 采纳并修正了我原方案的

| 条目 | 批注指出 | 我复核 | 结论 |
|---|---|---|---|
| A1 | `--provider` 在 `--id` 分支**不被读取**（`extract.py:333-338`），是死参数；真实坑只有未映射 provider 落 `--db ?`。实测 `--db ?` 抛 `no such table: message`，硬失败、非静默 | 属实 | A1 从「高」降「中」；修法收窄，见 §7.3 |
| A2 | 只改 `ledger.py:578-579` 会让 `result-skeleton.md:10`（`删除 <n>`）、`:40`（只定义 ① 列的 `-`）、`SKILL.md:70`（同）三处变成「只对一半」 | 属实，三处都要补「表头计数与 ① 列同一口径」 | 采纳 |
| A3 | 干跑清单即确认清单（`SKILL.md:146`），但 `parent_session_id` 释放量在干跑里不可见，用户等于批准一个没见过的副作用 | 属实，`purge.py` 只打印 `fork_dep=` | 采纳：干跑加一行「将释放 N 条子会话」 |
| A4 / D2 | `--db` default 改 `None` 会先炸 `cmd_init`（`:174` `expanduser(None)`）和 `cmd_sync`（`:463`）；且 `render_result` 必须真的接收 `args.db`，不能靠 `run.get("db")` 兜底 | 属实，实测 `grep -n 'args\.db'` 只有这两处 + `:886` 的 default | 采纳：3 处而非 2 处 |
| C5 | 不止「半删除」：异常退出还会跳过 `pragma integrity_check` 与汇总（`purge.py:438-452`），而 `cleanup.md:214` 的「四个数都要干净」就在这一步 | 属实 | 提级到「中」；修法仍是「判表存在」，见 §7.3 对 try/finally 的意见 |
| §5 验证 | `result --check` 只验四段标题与首行前缀，A1/A2/A4 改的东西它一个都不看，改完必然通过 | 属实 | 采纳：改成定点断言（`sed -n 3p` / 两库 `diff` / `grep read_cmd`），`--check` 降为附带动作 |
| D3 | 权威判断刚错过一次，此时做「三处合一」容易删对留错 | 属实 | 采纳：本轮只做 D3-a（只修错），去重推迟 |
| 开放问题 3 | 加「已删(本批)」列需要台账记删除时刻，属于新增机制 | 与红线冲突 | 采纳：不加列，用 `--note` |

### 7.3 我判定价值不足、建议不做的

这一节是给亮的结论：以下 4 条批注虽然技术上对，但不值得改；第 5 条可顺手做。

1. **A1 的「`--provider` 改用真实 provider + 补 choices」** —— 不做。
   `extract.py:333-338` 的 `--id` 分支根本不读 `args.provider`，改了零行为差异；补 `opencode` 进 choices 反而新增一个「choices 与读法必须同步」的维护点。真正有收益的只有一句：未映射 provider 返回 `# 无读取路径，标 blocked`，别让子代理去撞 traceback。**1 行，替代 4 行。**

2. **C2 交换 §1.2 / §1.1 顺序** —— 不做。
   纯排版，零信息增益，且会让所有外部引用（`auto-run.md:71` 的「见 SKILL.md §1.2」）失去意义。

3. **C5 的 `try/finally` 保证汇总打印** —— 不做。
   判表存在之后，剩余异常是真实的 sqlite 故障，traceback 本身就在告诉人「没跑完」。强行在异常路径打印一份「汇总」，会让失败看起来像完成——这比不打印更危险。

4. **D1-b 的「purge 加 provider 白名单提示」** —— 不做。
   两个前提都不成立：① openclaw 会话在 inventory 里 `turns=-1`（`inventory.py:31-35` 捕获 `open(None)` 异常），会走 `blocked`，本来就进不了 report 的删除区；② `--targets` 是人手逐条写、干跑逐行打印、用户点头才 `--apply`。再加机器提示，边际收益低于它带来的「扫一眼就行」的错觉。

5. **C3 golden 加「节选」说明** —— 可做可不做。
   一行注释，成本近零，但也不会改变任何行为。放在最后顺手做。

### 7.4 修订后的执行清单

**第 0 步（文档，最高优先）**：E1 —— 修 `auto-run.md:178-186`。它是唯一会让人去找错小节的错误，且是 B4/B7/C4 误判的源头。

**第一批（脚本，每条带定点验证）**

| 步 | 改什么 | 定点验证（不是 `--check`） |
|---|---|---|
| 1 | A2：`live is None` 时表头取 `-`；同步 `result-skeleton.md:10/:40`、`SKILL.md:70` | 库指向 `/nonexistent` 跑 `result`，`sed -n 3p` 应为 `删除 - · 保留 -` |
| 2 | A4：`--db` 生效（3 处，含 `cmd_init`/`cmd_sync` 的 `or inventory.DB`） | 同一台账默认库 / 快照库各跑一次 `diff`，处置列应不同 |
| 3 | A3：补 `parent_session_id` 释放 + 干跑打印释放条数 | 造父子两行，干跑应打印「释放 1 条」，`--apply` 后子行 `parent_session_id` 为 NULL |
| 4 | C5：`session_read_state` 存在性判断 | 用不含该表的库跑 `--apply`，应提示跳过而不是抛错 |
| 5 | A1：未映射 provider 返回 `# 无读取路径，标 blocked` | 造一条 openclaw 行，`next` 的 `read_cmd` 应是该提示而非 `--db ?` |

**第二批（文档）**：E1 → B3（铁律 7→6）→ B2（description）→ B6（注释）→ C1（常量位置）→ B5（批大小措辞）→ C4 前半（三处收尾合一）→ C3（顺手）。

**结论**：初稿 16 项 → 复核后 **14 项成立 + 1 项新增（E1）+ 2 项驳回（B4/B7）+ 1 项部分驳回（C4 后半）**；其中 5 条批注建议我判定不做。若亮认可，我按 §7.4 执行，不再回文档确认。

---

## 8. 执行记录（2026-11-11）

§7.4 清单已全部落地，改动范围：`SKILL.md`、`references/auto-run.md`、`references/cleanup.md`、`references/result-skeleton.md`、`scripts/ledger.py`、`scripts/purge.py`。

| 项 | 改了什么 | 验证结果 |
|---|---|---|
| E1 | `auto-run.md` §6 结构清单按 `ledger.py:771-860` 重写：0~5 编号 + 落地/附录无编号 + 概览不占编号；补「改生成器必须同步 `cleanup.md` 取目标的编号」 | `grep 'L.append("## ' ledger.py` 逐条对齐 |
| A2 | `live is None` 时 `deleted`/`kept` 取 `-`；同步 `result-skeleton.md`（新增「表头计数」规则行）、`SKILL.md` §1.2 | `result --db /nonexistent` → `删除 - · 保留 -` |
| A4 | `--db` 默认改 `None`；`cmd_init`/`cmd_sync` 回落 `inventory.DB`；`render_result(path, notes, db)` 接收命令行库 | 默认库 `删除 15 · 保留 7`、① 显示 `已删`；删除前快照 `删除 0 · 保留 22`、① 显示 `保留` |
| A3 | 删除前 `update sessions set parent_session_id=NULL`；干跑/apply 都打印 `child=N` 与「release N 条子会话的归属」 | 造父子两行：干跑打印 `child=1`，`--apply` 后子行 `parent_session_id` 为 NULL |
| C5 | 循环前查 `sqlite_master`，缺 `session_read_state` 时提示并跳过；注释改为「与 `reclaimReadStateFor` 等价，不删才留孤儿」 | `drop table` 后 `--apply`：提示跳过，会话删除与 `integrity_check` 正常 |
| A1 | `read_cmd` 不再传死参数 `--provider`；共享库路径展开为绝对路径；未映射 provider 返回 `# 无读取路径…判 blocked` | `next`：openclaw → blocked 提示；zcode → `--db "/Users/…/db.sqlite"`，无 `--provider` |
| B… | B2 description 改为「固定四段结果块」；B3 铁律 7→6；B5 统一「默认 5、上限 8」；C1 常量位置改「493 行起，搜 `SECTION_SESSION`」；C3 golden 加「以下为节选」；C4 前半删掉 `auto-run.md:71/:189` 的重复表述，形态只在 `SKILL.md` §1.2 定义 | 纯文档，无回归项 |

附带验证：`py_compile` 四脚本通过；`result --check` 通过；`purge.py` 对真实库干跑冒烟通过（`child=0`，文件与汇总正常）。

未做（§7.3 判定价值不足）：A1 的 `--provider`/choices 扩展、C2 章节换序、C5 的 `try/finally`、D1-b 的 provider 白名单。
