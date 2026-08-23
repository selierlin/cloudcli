#!/usr/bin/env bash
set -euo pipefail

# Build an AltStore-installable CloudCLI IPA from the Capacitor iOS project.
#
# Default: build an UNSIGNED IPA — AltStore re-signs on install with your
# Apple ID (same flow as Remodex/AltServer). No Xcode login required.
#
# Optional signed build: set CLOUDCLI_IOS_SIGN=1 (and the team in
# ~/.cloudcli/ios-build.conf or CLOUDCLI_IOS_TEAM_ID) to have xcodebuild sign
# with a development certificate. This needs the Apple ID logged into Xcode.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Skill 位于 .claude/skills/<name>/（或 .codex/skills/<name>/），上三级才是仓库根
PROJECT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"

branch="${CLOUDCLI_IOS_BRANCH:-feat/capacitor-ios-mobile}"
current="$(git -C "$PROJECT_DIR" branch --show-current)"
if [[ "$current" != "$branch" ]]; then
  echo "error: build must run on $branch (currently: $current). Override with CLOUDCLI_IOS_BRANCH." >&2
  exit 1
fi

if [[ -n "$(git -C "$PROJECT_DIR" status --porcelain)" ]]; then
  echo "error: working tree is not clean; commit or stash changes first" >&2
  exit 1
fi

# Proxy defaults (user-authorized for the GitHub SPM fetch of capacitor-swift-pm).
export HTTPS_PROXY="${HTTPS_PROXY:-http://127.0.0.1:7890}"
export HTTP_PROXY="${HTTP_PROXY:-http://127.0.0.1:7890}"
export ALL_PROXY="${ALL_PROXY:-socks5://127.0.0.1:7890}"

# Sync Capacitor web assets (server picker in mobile/www) into the iOS project.
(cd "$PROJECT_DIR" && npx cap sync ios)

# Decide signing: signed only when explicitly opted in.
SIGN="${CLOUDCLI_IOS_SIGN:-0}"
SIGN_ARGS=()
if [[ "$SIGN" == "1" ]]; then
  CONF="${CLOUDCLI_IOS_CONF:-$HOME/.cloudcli/ios-build.conf}"
  if [[ -f "$CONF" ]]; then
    # shellcheck disable=SC1090
    source "$CONF"
  fi
  TEAM_ID="${CLOUDCLI_IOS_TEAM_ID:-${TEAM_ID:-}}"
  if [[ -z "$TEAM_ID" ]]; then
    echo "error: CLOUDCLI_IOS_SIGN=1 but no Apple team ID. Set CLOUDCLI_IOS_TEAM_ID or create $CONF" >&2
    exit 1
  fi
  SIGN_ARGS=(-allowProvisioningUpdates CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM="$TEAM_ID")
  echo "> signed build (team $TEAM_ID)"
else
  SIGN_ARGS=(CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO)
  echo "> unsigned build (AltStore will sign on install)"
fi

CONFIGURATION="${CLOUDCLI_IOS_CONFIGURATION:-Debug}"

BUILD_DIR="$PROJECT_DIR/ios/App/build"
ARCHIVE="$BUILD_DIR/CloudCLI.xcarchive"
rm -rf "$ARCHIVE"

xcodebuild \
  -project "$PROJECT_DIR/ios/App/App.xcodeproj" \
  -scheme App \
  -configuration "$CONFIGURATION" \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" \
  "${SIGN_ARGS[@]}" \
  archive

# Package the app into an AltStore-style IPA (Payload/<AppName>.app).
IPA_DIR="$BUILD_DIR/CloudCLI-ipa"
rm -rf "$IPA_DIR"
mkdir -p "$IPA_DIR/Payload"
cp -R "$ARCHIVE/Products/Applications/App.app" "$IPA_DIR/Payload/CloudCLI.app"
IPA="$BUILD_DIR/CloudCLI-AltStore.ipa"
rm -f "$IPA"
(cd "$IPA_DIR" && zip -qry "$IPA" Payload)

# Copy to iCloud Drive so AltStore can import it (same convention as Remodex).
ALTSTORE_DIR="${IOS_DEPLOY_ALTSTORE_DIR:-$HOME/Library/Mobile Documents/com~apple~CloudDocs/工具}"
mkdir -p "$ALTSTORE_DIR"
base_name="$(basename "$IPA" .ipa)"
timestamp="$(date +%Y%m%d-%H%M%S)"
TARGET_IPA="$ALTSTORE_DIR/${base_name}-${timestamp}.ipa"
ditto "$IPA" "$TARGET_IPA"

echo "IPA: $IPA"
echo "iCloud copy: $TARGET_IPA"
echo "Import: iPhone 文件 → iCloud Drive → 工具 → 长按 IPA → 共享 → AltStore (AltServer 需在 Mac 上运行)"
