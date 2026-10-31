#!/bin/zsh
# 基线测试：摘掉全局 AGENTS.md（五条软链共用的同一实体文件），跑完强制还原
set -u
SRC="$HOME/dotfiles/agents/.agents/AGENTS.md"
BAK=/tmp/bench-baseline/AGENTS.md.bak
EXPECT_SHA=ad7d0f3e582c1a13e51cc362539314708bc1939936ce6e5c1d8ce2c38a1ed12c

cp -p "$SRC" "$BAK"
GOT=$(shasum -a 256 "$BAK" | awk '{print $1}')
echo "[backup] $GOT"
if [ "$GOT" != "$EXPECT_SHA" ]; then
  echo "[abort] 备份指纹与预期不符，未做任何修改"
  exit 1
fi

restore() {
  cp -p "$BAK" "$SRC"
  NOW=$(shasum -a 256 "$SRC" | awk '{print $1}')
  echo "[restore] $NOW bytes=$(wc -c < "$SRC")"
  if [ "$NOW" != "$EXPECT_SHA" ]; then echo "[restore][FAIL] 指纹不一致，需要手工检查"; fi
}
trap restore EXIT INT TERM HUP

: > "$SRC"
echo "[stripped] bytes=$(wc -c < "$SRC")  grep叫我=$(grep -c '叫我' "$SRC" 2>/dev/null || echo 0)"

cd /Users/selier/Projects/open_projects/cloudcli || exit 1
node scripts/harness-bench/run-bench.mjs \
  --run-id baseline-cat \
  --prompt "昨天猫一会的订单量有多少" \
  --rounds 3 --shuffle --no-warmup
echo "[bench exit] $?"
