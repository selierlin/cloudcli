#!/bin/zsh
# 第二轮基线提问：生产环境 + 已完成（state=3）。摘全局指令，跑完强制还原。
set -u
SRC="$HOME/dotfiles/agents/.agents/AGENTS.md"
BAK=/tmp/bench-baseline2/AGENTS.md.bak
EXPECT_SHA=ad7d0f3e582c1a13e51cc362539314708bc1939936ce6e5c1d8ce2c38a1ed12c

mkdir -p /tmp/bench-baseline2
cp -p "$SRC" "$BAK"
GOT=$(shasum -a 256 "$BAK" | awk '{print $1}')
echo "[backup] $GOT"
if [ "$GOT" != "$EXPECT_SHA" ]; then echo "[abort] 指纹不符"; exit 1; fi

restore() {
  cp -p "$BAK" "$SRC"
  NOW=$(shasum -a 256 "$SRC" | awk '{print $1}')
  echo "[restore] $NOW bytes=$(wc -c < "$SRC")"
  [ "$NOW" = "$EXPECT_SHA" ] || echo "[restore][FAIL] 需人工检查"
}
trap restore EXIT INT TERM HUP

: > "$SRC"
echo "[stripped] bytes=$(wc -c < "$SRC")"

cd /Users/selier/Projects/open_projects/cloudcli || exit 1
node scripts/harness-bench/run-bench.mjs \
  --run-id baseline-done \
  --prompt "昨天生产环境猫一会的已完成订单量有多少" \
  --rounds 3 --shuffle --no-warmup
echo "[bench exit] $?"
