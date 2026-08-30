---
name: build-cloudcli-ipa
description: 从本地 Capacitor iOS 项目构建可由 AltStore 安装的 CloudCLI IPA，并同步移动端服务器选择页资源。默认生成未签名 IPA（安装时由 AltStore 签名），设置 `CLOUDCLI_IOS_SIGN=1` 可用开发证书签名。用于打 IPA、打包、构建 IPA、部署到 iCloud/AltStore、装到手机；不用于重启本机服务或仅构建浏览器可访问的 Web 资源（使用 deploy-cloudcli），也不安装或启动实体设备上的 App。
---

# Build CloudCLI IPA (AltStore)

本 skill 从本地 Capacitor 8 iOS 项目（`ios/`）产出一个可被 AltStore
安装的 `CloudCLI` IPA。App 是薄客户端，服务器选择器（server picker）位于
`mobile/www`；每当这些资产或原生 iOS 工程变化时，都需要重新构建 IPA。

> 说明：本 skill 与 `.codex/skills/build-cloudcli-ipa/` 互为副本，内容保持一致；
> 脚本可执行文件在两个位置各有一份，路径计算（上三级=仓库根）两者通用。

## Invariants

- 构建必须运行在 mobile 分支（`feat/capacitor-ios-mobile`，可用
  `CLOUDCLI_IOS_BRANCH` 覆盖）且工作区干净。
- 默认产出 **unsigned** IPA —— AltStore 在安装时用你的 Apple ID 重签
  （与 Remodex/AltServer 相同流程）。不需要 Xcode 账号。
- 签名构建是可选开关 `CLOUDCLI_IOS_SIGN=1`；需要 Xcode 已登录 Apple ID，
  team 配置在 `~/.cloudcli/ios-build.conf` 或 `CLOUDCLI_IOS_TEAM_ID`。
- 不要在本 skill 中把 App 安装或启动到真机；只产出 IPA，安装交给 AltStore。

## Workflow

1. 先检查状态，绝不丢弃用户改动：

```bash
git -C /Users/selier/Projects/open_projects/cloudcli status --short --branch
git -C /Users/selier/Projects/open_projects/cloudcli branch --show-current
```

若工作区不干净，先停下询问，再决定是否切换/暂存。

2. 构建 IPA（默认 unsigned）。脚本同时把结果复制到 iCloud Drive `工具`
   （AltStore 导入目录），与 Remodex 惯例一致：

```bash
cd /Users/selier/Projects/open_projects/cloudcli
./.claude/skills/build-cloudcli-ipa/build-cloudcli-ipa.sh
```

签名构建（可选，需要 Xcode 登录 + team 配置）：

```bash
CLOUDCLI_IOS_SIGN=1 ./.claude/skills/build-cloudcli-ipa/build-cloudcli-ipa.sh
```

3. 校验产物（本地 + iCloud 副本）：

```bash
IPA="/Users/selier/Projects/open_projects/cloudcli/ios/App/build/CloudCLI-AltStore.ipa"
stat -f 'path=%N size=%z modified=%Sm' "$IPA"
unzip -l "$IPA" | rg 'Payload/CloudCLI.app/?$|Payload/CloudCLI.app/Info.plist'
ls -lt "$HOME/Library/Mobile Documents/com~apple~CloudDocs/工具/" | head -3
```

4. iPhone 手动导入（iCloud 副本是 AltStore 应导入的那个）：
   iPhone「文件」→ iCloud Drive →「工具」→ 长按 IPA →「共享」→ AltStore。
   AltServer 需要在 Mac 上保持运行。已存在同 bundle id 的直装版本时，先删除
   再导入。

Report: 分支 + 工作区状态、构建配置（Debug/Release）、签名或未签名、本地 IPA
路径、iCloud `工具` 副本路径。

## Failure handling

- 工作区不干净或分支不对：停下报告，未经询问不要 stash 或切换分支。
- 签名构建报 `No Account for Team ...` / `No profiles for
  'ai.cloudcli.mobile' were found`：Apple ID 未登录 Xcode。让用户去
  Xcode → Settings → Accounts → + → Apple ID，或回退到默认 unsigned 构建
  （AltStore 在安装时重签）。
- `xcodebuild archive` 在免费 Apple 账号上失败（发行归档需要付费账号）：
  用 `CLOUDCLI_IOS_CONFIGURATION=Debug` 重试——默认就是 Debug。
- IPA 缺少 `Payload/CloudCLI.app`：视为无效，报告打包失败。
