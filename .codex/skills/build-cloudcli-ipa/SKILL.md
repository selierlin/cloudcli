---
name: build-cloudcli-ipa
description: Build an AltStore-installable CloudCLI IPA from the local Capacitor iOS project, syncing the mobile server-picker web assets. Produces an unsigned IPA by default (AltStore signs on install); optionally signs with a development certificate when CLOUDCLI_IOS_SIGN=1. Use when the user asks to build/refresh the CloudCLI mobile IPA, or prepare a device-installable IPA for CloudCLI. Do not install or launch the app on a physical device from this skill.
---

# Build CloudCLI IPA (AltStore)

This skill produces a `CloudCLI` IPA for AltStore from the local Capacitor 8
iOS project under `ios/`. The app is a thin client whose server picker lives
in `mobile/www`; the IPA must be rebuilt whenever those assets or the native
iOS project change.

## Invariants

- The build must run on the mobile branch (`feat/capacitor-ios-mobile`,
  override with `CLOUDCLI_IOS_BRANCH`) with a clean working tree.
- Default output is an **unsigned** IPA — AltStore re-signs on install with the
  user's Apple ID (same flow as Remodex/AltServer). No Xcode account needed.
- Signed builds are opt-in via `CLOUDCLI_IOS_SIGN=1`; they need the Apple ID
  logged into Xcode and the team in `~/.cloudcli/ios-build.conf` or
  `CLOUDCLI_IOS_TEAM_ID`.
- Do NOT install or launch the app on a device; only produce the IPA. AltStore
  handles the install.

## Workflow

1. Inspect state first; never discard user changes:

```bash
git -C /Users/selier/Projects/open_projects/cloudcli status --short --branch
git -C /Users/selier/Projects/open_projects/cloudcli branch --show-current
```

If the working tree is dirty, stop and ask before switching/stashing.

2. Build the IPA (unsigned by default). The script also copies the result to
   iCloud Drive `工具` (AltStore import dir), same convention as Remodex:

```bash
cd /Users/selier/Projects/open_projects/cloudcli
./.codex/skills/build-cloudcli-ipa/build-cloudcli-ipa.sh
```

Signed build (optional, needs Xcode login + team config):

```bash
CLOUDCLI_IOS_SIGN=1 ./.codex/skills/build-cloudcli-ipa/build-cloudcli-ipa.sh
```

3. Verify the artifact (local + iCloud copy):

```bash
IPA="/Users/selier/Projects/open_projects/cloudcli/ios/App/build/CloudCLI-AltStore.ipa"
stat -f 'path=%N size=%z modified=%Sm' "$IPA"
unzip -l "$IPA" | rg 'Payload/CloudCLI.app/?$|Payload/CloudCLI.app/Info.plist'
ls -lt "$HOME/Library/Mobile Documents/com~apple~CloudDocs/工具/" | head -3
```

4. Manual import on the iPhone (the iCloud copy is the one AltStore should
   import):
   iPhone「文件」→ iCloud Drive →「工具」→ 长按 IPA →「共享」→ AltStore。
   AltServer 需要在 Mac 上保持运行。已存在同 bundle id 的直装版本时，先删除
   再导入。

Report: branch + working-tree state, build configuration (Debug/Release),
signed or unsigned, local IPA path, and the iCloud `工具` copy path.

## Failure handling

- If the working tree is dirty or the branch is wrong, stop and report; do not
  stash or switch without asking.
- If a signed build fails with `No Account for Team ...` / `No profiles for
  'ai.cloudcli.mobile' were found`, the Apple ID is not logged into Xcode. Ask
  the user to add it (Xcode → Settings → Accounts → + → Apple ID), or fall back
  to the default unsigned build (AltStore signs on install).
- If `xcodebuild archive` fails on a free Apple account (distribution archive
  needs a paid account), retry with `CLOUDCLI_IOS_CONFIGURATION=Debug` — the
  default already is Debug.
- If the IPA is missing `Payload/CloudCLI.app`, treat it as invalid and report
  the packaging failure.
