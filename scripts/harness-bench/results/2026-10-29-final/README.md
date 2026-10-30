# 2026-10-29-final —— 公平口径的合并数据集

> **已失效的部分**：本目录里 zcode 的 69 条（判据通过 57/69、13 次 `terminal=error`）
> 已在 2026-10-30 被 `../2026-10-30-zcode-fix` 取代——根因是 CloudCLI 把 `acceptEdits`
> 映射成 zcode 的 `--mode edit`，而无头运行没有任何权限应答通道，工具一律被拒。修复后
> 为 67/69、0 次 error。`REPORT.md` 中的 zcode 行请以那批为准，其余七家不变。

这个目录是 `2026-10-29-full` 的修订版，只替换了与「用户全局指令」冲突的六个格式类场景，
其余 14 个场景（工具、任务、长上下文）原样取自 `2026-10-29-full`。

## 为什么要重跑那六个

`~/dotfiles/agents/.agents/AGENTS.md`（被 claude / codex / pi / zcode 软链为各自的全局指令文件）
含一句「每次回复时都叫我[亮]」。它进了 system prompt，于是：

- S11「只回复一个字：好」→ 实际回 `好\n\n亮，已收到指令。`
- S5「不超过 50 字」→ 多出「亮，介绍如下：」而超限
- S12「3 的平方」→ 回 `9，亮。`

把指令临时清空（`~/dotfiles/agents/.agents/AGENTS.md` 截断为 0 字节，软链不变，
跑完立即还原，`shasum` 校验一致）后重跑 S1/S4/S5/S10/S11/S12 共 208 条，
八家全部给出干净的 `好` / `9` / 合规 JSON。六个场景 26 项的通过数对比：

| harness | 带全局指令（full） | 干净（fmt） | 差值 |
| --- | --- | --- | --- |
| claude | 23/26 | 26/26 | +3 |
| codex | 22/26 | 26/26 | +4 |
| opencode | 22/26 | 26/26 | +4 |
| dsh | 24/26 | 26/26 | +2 |
| pi | 21/26 | 26/26 | +5 |
| zcode | 22/26 | 26/26 | +4 |
| omp | 23/26 | 26/26 | +3 |
| workbuddy | 23/26 | 26/26 | +3 |

也就是说：指令开着，格式类场景对谁都不公平，不是某一家的问题，也不是模型能力差异。

## 空回复竞态（已修）

`complete` 帧可能早于 assistant 消息行落库，而 runner 原来在收到 complete 后立刻读
`/messages`，于是 `textChars > 0` 却记成空回复。旧数据里有 23 条（claude 16、workbuddy 3、
codex 1，另有 3 条在多轮里）。

修复后 `runTurn` 同时保留流式正文，落库行缺失时以流式正文兜底；`fetchTurnReply` 还会短暂
轮询（3s，不计入计时），多轮场景按「上一轮结束时的行数」切分，避免某轮空回复继承上一轮文本。

这 23 条已用修复后的 runner 重跑替换，判定一并重算。

## 口径

- 18 场景 × 8 家 × 2~5 轮，552 条记录，与 `2026-10-29-full` 一一对应（同场景同轮次）
- 空回复不再算通过（宽松判据如「不超过 50 字」会被空字符串满足）
- 通道仍是 claude/codex/dsh 走 ark，其余五家走 copilot.tencent.com

## 复现

```bash
# 关闭全局指令 → 重跑六个格式场景 → 还原
: > ~/dotfiles/agents/.agents/AGENTS.md
node scripts/harness-bench/run-bench.mjs --run-id <new> \
  --scenarios S1,S4,S5,S10,S11,S12
git -C ~/dotfiles checkout agents/.agents/AGENTS.md
```
