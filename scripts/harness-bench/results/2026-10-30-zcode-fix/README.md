# 2026-10-30-zcode-fix —— zcode 权限模式修复后的重跑

zcode 单家 69 轮，场景与轮次同 `2026-10-29-final`，用于替换那批里 zcode 的 69 条。
其余七家的记录没有重跑，仍在 `2026-10-29-final`。

## 为什么重跑

`2026-10-29-final` 里 zcode 有 9 次 `terminal=error`（外加 4 次工具连带失败），
全部落在需要跑命令的场景（S7/S13/S16/S17/S18/S20），格式类场景 0 次。根因是权限模式：

- CloudCLI 把 `acceptEdits` 映射成 `--mode edit`（`zcode-runtime.provider.ts` 的
  `PERMISSION_MODE_MAP`），而 `zcode --prompt` 无头运行装的是 ZCode 自己的
  `DenyPermissionBroker`——**没有任何通道能应答 `permission.requested`**。
- 实测 0.17.0 的 `edit` 不只是拦高危写操作，连普通 `Bash` 都判 deny
  （`No permission client configured for Bash`），累计 3 次触发
  `ZCODE_PERMISSION_CIRCUIT_OPEN`，回合被杀。
- 同环境实测各档位：`guarded` 放行普通工具（Bash、文件写入）仍拦 `rm -rf`，
  最接近 `acceptEdits` 的意图；`yolo` 全放行；`build` / `edit` 同样拒。

修复：`acceptEdits` 改映射到 `guarded`（`bypassPermissions` 仍是 `yolo`），
拒绝提示语同步改口，`zcode-runtime.test.ts` 的 `--mode` 断言改为 `guarded`。

## 修复前后

| 指标 | 2026-10-29-final | 本次 |
| --- | --- | --- |
| 判据通过 | 57/69 | **67/69** |
| 空回复 | 0 | 0 |
| 答错 | 0 | 2 |
| 运行失败 / `terminal=error` | 13 | **0** |
| S16~S20 单轮工具调用数 | 1~4 次即中断 | 3~17 次跑完 |

旧的 13 次 error 里有 11 次同时被判为答错（回合被杀，没有产出），修复后这些回合跑完并通过。
剩下 2 条是真实能力问题：

- `S2_r4`：算成 11/7（正确 33/7），把乙丙效率当成 7/24 而非 7/72
- `S11_r4`：要求「只回复一个字：好」，回了 `好\n\n亮，有什么需要我做的吗？`

## 拼回八家视图

本目录只含 zcode，跨家对比需要和 `2026-10-29-final` 合并后再出报告：

```bash
cd scripts/harness-bench/results
mkdir 2026-10-30-final && cp 2026-10-29-final/*.json 2026-10-30-final/
cp 2026-10-30-zcode-fix/zcode_*.json 2026-10-30-final/
node ../summarize.mjs 2026-10-30-final
```

合并结果（一次性生成，未入库）：zcode 由 57/69 升到 67/69，其余七家不变。

## 复现本次跑批

```bash
# 先对临时实例验证，避免动真实服务
sqlite3 ~/.cloudcli/auth.db ".backup /tmp/verify/auth.db"
DATABASE_PATH=/tmp/verify/auth.db SERVER_PORT=<free> npx tsx --tsconfig server/tsconfig.json server/index.ts
BENCH_BASE=http://127.0.0.1:<free> node scripts/harness-bench/run-bench.mjs \
  --providers zcode --scenarios S7,S13,S16,S17,S18,S20

# 全量 69 轮（978s）
node scripts/harness-bench/run-bench.mjs --providers zcode --run-id <new>
```
