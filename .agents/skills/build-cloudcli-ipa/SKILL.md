---
name: build-cloudcli-ipa
description: 从本地 Capacitor iOS 项目构建可由 AltStore 安装的 CloudCLI IPA，并同步移动端服务器选择页资源。默认生成未签名 IPA（安装时由 AltStore 签名），设置 `CLOUDCLI_IOS_SIGN=1` 可用开发证书签名。用于打 IPA、打包、构建 IPA、部署到 iCloud/AltStore、装到手机；不用于重启本机服务或仅构建浏览器可访问的 Web 资源（使用 deploy-cloudcli），也不安装或启动实体设备上的 App。
disable-model-invocation: true
---

# Build CloudCLI IPA (AltStore)

本 skill 从本地 Capacitor 8 iOS 项目（`ios/`）产出一个可被 AltStore
安装的 `CloudCLI` IPA。App 是薄客户端，服务器选择器（server picker）位于
`mobile/www`；每当这些资产或原生 iOS 工程变化时，都需要重新构建 IPA。

> 说明：skill 的唯一物理副本是 `.agents/skills/build-cloudcli-ipa/`（git 跟踪）；
> `.claude/skills`、`.codex/skills`、`.codebuddy/skills` 都是指向 `../.agents/skills`
> 的软链接，改一处即全部生效。脚本按「上三级 = 仓库根」计算路径。

## Invariants

- 构建必须运行在 `cloudcli-dev`（可用 `CLOUDCLI_IOS_BRANCH` 覆盖）且工作区干净。
  mobile 分支 `feat/capacitor-ios-mobile` 已完全并入 `cloudcli-dev`，不再单独构建。
- 默认产出 **unsigned** IPA —— AltStore 在安装时用你的 Apple ID 重签
  （与 Remodex/AltServer 相同流程）。不需要 Xcode 账号。
- 签名构建是可选开关 `CLOUDCLI_IOS_SIGN=1`；需要 Xcode 已登录 Apple ID，
  team 配置在 `~/.cloudcli/ios-build.conf` 或 `CLOUDCLI_IOS_TEAM_ID`。
- 不要在本 skill 中把 App 安装或启动到真机；只产出 IPA，安装交给 AltStore。

## 灵动岛 extension（CloudCLIActivityWidget）

`ios/App/CloudCLIActivityWidget/` 是一个 WidgetKit app extension（bundle id
`ai.cloudcli.mobile.activity`），提供实时活动 / 灵动岛渲染，由 `App` target 的
"Embed Foundation Extensions" 拷贝阶段嵌进 `Payload/CloudCLI.app/PlugIns/`。

- **不占免费账号的 3 个 App 槽位**（那说的是"同时安装的 App 数"，extension 属于主
  App 的一部分），但它**要单独注册 1 个 App ID** —— CloudCLI 从 1 个变 2 个。
  App ID 上限 10 个、每个 7 天过期；手机上 `AltStore → My Apps → View App IDs`
  可核对，撞上限就等过期或先 `Deactivate` 别的 App 腾位。
- **免费账号没有 App Group**：主 App 与 extension 互不可见，所以活动数据全部经
  `ContentState` 传递（`CloudCLIActivityAttributes.swift` 必须同时编进两个
  target）。不要给 extension 勾任何 entitlement（App Groups / Push / iCloud 都会
  让 AltStore 重签失败），也不要在 extension 里读 UserDefaults。
- `NSSupportsLiveActivities` 只在主 App 的 Info.plist；桥接里 `pushType` 恒为
  `nil`——免费签名没有 aps entitlement，服务端推不动活动，真正的后台通知由 Bark
  通道负责。
- 真机验证（iPhone 设置 → Safari → 高级 → 网页检查器 需打开）。用
  `registerPlugin` 取插件，**不要**用 `Capacitor.Plugins.X` —— 后者只有在有人调用过
  `registerPlugin` 之后才被填充，新会话里必然是 `undefined`：

```js
void (async () => {
  const LA = window.Capacitor.registerPlugin('CloudCLIActivity');
  console.log(await LA.isSupported());                  // { supported, hasActivity }
  await LA.end({ phase: 'done', dismissImmediately: true });  // 先清场，否则 start 会走复用分支
  console.log(await LA.start({
    sessionTitle: '测试会话', serverLabel: location.host, detail: 'Bash',
    deepLink: 'cloudcli://open?url=' + encodeURIComponent(location.href),
  }));
  await LA.update({ phase: 'waiting', detail: '等待确认' });   // 岛变黄色手形
  await LA.end({ phase: 'done' });                            // 收岛，锁屏留 ✓ 卡片
})();
```

已验证（2026-11-22，免费 Apple ID + AltStore 重签）：`isSupported` 为
`{supported:true}`；start 后切后台岛上是绿点 + 走动的计时器；update 到 `waiting`
变黄色手形；end 收岛并在锁屏留下完成卡片。**未验证**：前端自动触发、切会话跟随、
重启接管 —— 这些只走 `LiveActivityTracker`，与打包无关。

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
./.agents/skills/build-cloudcli-ipa/build-cloudcli-ipa.sh
```

签名构建（可选，需要 Xcode 登录 + team 配置）：

```bash
CLOUDCLI_IOS_SIGN=1 ./.agents/skills/build-cloudcli-ipa/build-cloudcli-ipa.sh
```

3. 校验产物（本地 + iCloud 副本）：

```bash
IPA="/Users/selier/Projects/open_projects/cloudcli/ios/App/build/CloudCLI-AltStore.ipa"
stat -f 'path=%N size=%z modified=%Sm' "$IPA"
unzip -l "$IPA" | rg 'Payload/CloudCLI.app/?$|Payload/CloudCLI.app/Info.plist'
# 灵动岛 extension 必须真的嵌进去了，否则主 App 正常但岛上永远空白
unzip -l "$IPA" | rg 'PlugIns/CloudCLIActivityWidget.appex/Info.plist'
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
