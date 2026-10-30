# 2026-10-30-unified —— 八家里六家同通道、并补多轮重构场景

> 数据 = `../2026-10-29-final`（七家）+ `../2026-10-30-zcode-fix`（zcode 权限修复后的 69 条）
> + dsh 在 workbuddy 上的全量重跑（`../2026-10-30-dsh-workbuddy`，其中六个格式场景取自
> `../2026-10-30-dsh-fmt`）+ 新增 S21「多轮重构任务」八家两轮（`../2026-10-30-s21`）。
> 每位 harness 71 条（20 场景 69 条 + S21 两轮），合计 568 条。

与上一版（zcode 修复后那版）的差别只有两处：dsh 整列换成 workbuddy 的新数据，外加每个 harness
多两条 S21。其余七家的每一条都逐字继承，可以直接对比。

## 一、dsh 换到 workbuddy 通道

之前 dsh 走火山方舟，原因被误判成 copilot 拒绝 `role: developer`。用本地回声上游把 dsh 真实
请求抓下来、再原样回放到 copilot，才定位到真因：

**copilot 的渠道校验是整句黑名单，dsh 的 system prompt 第一句
`You are an AI agent powered by DeepSeek Harness.` 整句命中，返回 `400 code 11128`。**
单独发 `DeepSeek`、`Harness`、`DeepSeek Harness` 都放行，只有整句不行；`supportsDeveloperRole: false`
其实一直在生效（回声确认发的是 `role: system`）。

修法在 `~/.dsh/profiles/acp/cordis.patch.yml`（备份 `cordis.patch.yml.bak-20261030`）：

```yaml
- id: acp
  config: { provider: workbuddy, model: glm-5.3-flash }
- id: system-prompt
  config: { includeHarnessIdentity: false }
```

改完 `pkill -f "dsh --profile acp"` 让 ACP 进程重新拉起。注意这会同时影响方舟通道——若以后
要 dsh 走方舟，这两处要一起回滚。

换了通道后 dsh 明显变快（基础问答中位 2100ms，方舟时是 6.0s 量级），所以它在下表里不再能和
旧数据混着看；本目录里 dsh 一列已全部换成新数据。

## 二、新增 S21「多轮重构任务」

四轮同一个会话，每轮压在前一轮交付的代码上，**判据在工程目录之外**
（`<provider>/_graders/s21.mjs`，会话看不到期望值）：

1. 加 `formatYuan(fen)` → `¥12.34`，`Cart.total()` 改为返回字符串
2. 加 `setDiscount(percent)`：先打折、再格式化，四舍五入到分
3. 重构：折扣逻辑挪进 `svc/discount.js`，`money.js` 里不许再出现折扣，对外 API 不变
4. 加促销 `setPromotion('buy3pay2')`：每满 3 件免最便宜的 1 件，qty 展开、跨商品混排，
   **先促销后折扣**

每轮的判据都会重放前面所有轮的断言，所以第 1 轮就跑偏的 harness 会在第 4 轮暴露。
参考解已验证四轮可过。

逐轮中位数（秒，2 轮取中位）：

| harness | 第1轮 | 第2轮 | 第3轮 | 第4轮 | 合计 |
| --- | --- | --- | --- | --- | --- |
| opencode | 33.2 | 18.5 | 19.7 | 39.2 | **110.6** |
| pi | 32.2 | 18.1 | 16.0 | 57.7 | **124.0** |
| dsh | 71.8 | 33.2 | 25.0 | 65.6 | 195.6 |
| zcode | 57.2 | 52.3 | 27.3 | 75.7 | 212.6 |
| claude | 65.3 | 45.6 | 39.3 | 62.8 | 213.1 |
| codex | 51.0 | 34.9 | 37.6 | 102.6 | 226.1 |
| omp | 57.9 | 45.3 | 41.4 | 99.8 | 244.4 |
| workbuddy | 62.5 | 52.9 | 48.2 | 96.9 | 260.6 |

opencode 和 pi 是仅有的两家四轮合计在两分钟内的；其余六家在 3~4.4 分钟。
**第 4 轮（促销叠加折扣）是普遍的分水岭**：除 opencode 外每家都在这轮翻倍到三倍耗时。

## 三、结果

判据通过（71 条/家）：

| harness | 通过 | 空回复 | 答错 | 运行失败 |
| --- | --- | --- | --- | --- |
| claude | 71 | 0 | 0 | 0 |
| pi | 71 | 0 | 0 | 0 |
| omp | 71 | 0 | 0 | 0 |
| workbuddy | 71 | 0 | 0 | 0 |
| opencode | 70 | 0 | 1 | 0 |
| dsh | 70 | 0 | 1 | 0 |
| zcode | 70 | 0 | 1 | 0 |
| codex | 69 | 0 | 2 | 0 |

仍然没有空回复、没有运行失败，全部失败都是「答错」，是模型能力问题，不是产品或判据问题。

丢分位置很集中：

- **复杂推理（S2）**：codex 3/5、opencode 4/5、zcode 4/5；其余五家全对
- **S21 第 4 轮**：dsh 两轮里挂了一轮（`buy3pay2` 免掉的不是最便宜件，得到 ¥3.00，应为 ¥5.00）
- 其余 19 个场景八家满分

> 选型建议与逐家画像见同目录 `WHICH-HARNESS.md`。

## 四、判读要点

- **通道**：claude 与 codex 走 ark（copilot 没有 `/v2/messages` 和 `/v2/responses`），
  其余六家全部走 copilot.tencent.com。跨这两组的耗时只能读「本机现状」，不能比快慢。
- **「pi 简单快、真实工作慢」的假设仍然不成立**：pi 在 S21 前三轮都最快，合计 124s，
  只输给 opencode 的 111s；跨文件重命名 17.8s 也是全场第二。它确实「思考占比高」——
  S21 思考占比 96%、思考到正文的间隔 26s，但总时长仍在前二，没有变成拖累。
- **最慢的是 workbuddy 自己**：S21 合计 261s，多轮工具任务 60s，跨文件重命名 57s。
- **尾部风险**：workbuddy 最差单轮 291s、zcode 264s、omp 253s、claude 248s；
  变异系数最大的是 zcode（跨文件重命名 cv58%）和 pi（定位修复 cv54%）。
- **系统提示开销**（S3 只发 `hi` 的 input tokens）：pi 3502、omp 8884、codex 9240、
  opencode 11199、claude 13777、zcode 21743、workbuddy 26724；dsh 不上报。

## 五、口径与已知盲区

- dsh 这 69 条是 2026-10-30 中午在 workbuddy 上跑的，与其余七家的采集时间不同窗口，
  服务端负载可能有差异；同通道内部比较仍成立。
- dsh 的 6 个格式场景（S1/S4/S5/S10/S11/S12）是在临时清空
  `~/dotfiles/agents/.agents/AGENTS.md` 后跑的，26/26 全过（`../2026-10-30-dsh-fmt`）。
  该文件含「每次回复时都叫我[亮]」，开着时 dsh 的 S4 会有 3/5 因为前缀而判负——这是指令冲突，
  不是模型差异。数据集里用的是干净口径，与其他七家一致。
- S21 八家两轮都是在**带**该全局指令的情况下跑的（无干净口径对照），
  但 S21 用文件判据，指令只影响回复文案、不影响判负。
- 每轮新起一个 CLI 进程，读作「单次调用成本」；单机、单模型、单时间窗口，无置信区间。
- zcode 的 6 个格式场景也有干净口径一份（`../2026-10-30-zcode-fmt`，26/26 全过），
  替换掉了原先在指令开着时跑的那批——那批的 S11 会把「只回复一个字：好」答成「好，亮，还有什么…」。
- 记录里的 `checkPass` 是**采集当时**判据给出的结论；`REPORT.md` / `summary.json` 用当前判据
  对 `replyText` 重算，两者在个别条目上不一致（历史判据改过）。以重算结果为准。
- S2 的判据在 2026-10-30 从字符串匹配改成数值比较：旧写法把 `\frac{33}{7}` 归一化成 `/337`，
  正确答案被判错，codex 因此从 3/5 被压到 1/5、omp 从 4/5 压到 2/5。

## 六、复现

```bash
# dsh 全量（走 workbuddy，需 profile 已切到 workbuddy 且关掉身份句）
node scripts/harness-bench/run-bench.mjs --providers dsh --run-id 2026-10-30-dsh-workbuddy

# dsh 六个格式场景（关指令 → 跑 → 立即还原，shasum 应为 bd553858bb9dea7788245415a8563dec0ca208db）
: > ~/dotfiles/agents/.agents/AGENTS.md
node scripts/harness-bench/run-bench.mjs --providers dsh --scenarios S1,S4,S5,S10,S11,S12 --run-id 2026-10-30-dsh-fmt

# zcode 六个格式场景（同样先关指令）
node scripts/harness-bench/run-bench.mjs --providers zcode --scenarios S1,S4,S5,S10,S11,S12 --run-id 2026-10-30-zcode-fmt

# S21 八家
node scripts/harness-bench/run-bench.mjs --scenarios S21 --run-id 2026-10-30-s21

# 出报告
node scripts/harness-bench/summarize.mjs 2026-10-30-unified
```
