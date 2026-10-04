# 评估与沉淀线（triage-sediment）

目标：把会话**分诊**成三堆——**已沉淀（可删）／无价值（可删）／值得沉淀（交沉淀技能）**。

## 流程

1. **列候选**。用户说「评估已归档会话」→ `python3 scripts/inventory.py --archived-only`；说「评估所有会话」→ 不带参数。会带出体积、轮数、首问。
2. **已沉淀判定**：`python3 scripts/sediment_refs.py`（`--archived-only` 可选）。它采集 `~/.memory-bank/**/*.md` 里的 `s:` 引用，与会话的 `session_id`/`provider_session_id` 精确或**截断前缀**匹配。
3. **逐条判价值**（见下）。看首问不够时用 `extract.py` 抽脉络。
4. **无价值 + 已沉淀** → 按 `cleanup.md` 的流程物理删除（还记得 SKILL.md §0 的快照与干跑）。
5. **值得沉淀** → **停下，等用户点名**，再逐条走 §交接。

## 已沉淀判定：`s:` 引用

- 判定来源＝`session-sediment` 写进 `~/.memory-bank/<project>/entries/*.md` 的 `s: <provider>:<id>` 行，**不是** cloudcli DB 字段。
- 正则：`s:\s*([A-Za-z]+):\s*`?([0-9a-fA-F][0-9a-fA-F\-]{3,})`。
- 同一引用可能匹配**多条**会话（如一条原始会话 + 它的一条 fork）——都算命中，分别处置。
- **大量 `s:` 引用指向早已删除的会话**（引用悬空、只剩沉淀），是正常态，不用追、不用清。
- 删已沉淀会话前确认「对应条目确已在 OV 镜像里」——本地 `entries/` 有、OV 没推的话，删了会话仍不丢（本地是权威副本），但要在报告里点明。
- 一条会话可能「内容值得沉淀但从未沉淀」——`s:` 命中为空不等于无价值，两者别混。

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

判断一条会话的内容时，抽它的提问脉络（USER 轮 + 末答），别只看名字：

```bash
python3 scripts/extract.py <transcript.jsonl> [--provider auto|claude|codex|workbuddy|generic] [--max 400]
python3 scripts/extract.py --provider zcode --id sess_xxxxxxxx      # zcode 从自己的库读
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

## 收尾

- 沉淀完成后，源会话通常「留着只占地方」——**提议**按应用内「永久删除」语义清掉（DB 行 + 磁盘 transcript + superseded），由用户决定。
- 报告里给：本轮删了几条、释放多少、`integrity_check`、快照路径、以及「已沉淀会话 100% 清完/还有哪些未沉淀」。
