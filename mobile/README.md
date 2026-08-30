# CloudCLI 移动端（Capacitor）

基于 **Capacitor 8**（Swift Package Manager，无需 CocoaPods）的 iOS 薄客户端。

## 架构

手机端无法运行 CloudCLI 后端（Node + Claude CLI），因此本 App 是**薄客户端**：

- `mobile/www/` 是 Capacitor 的 webDir，包含一个**服务器选择页**（原生 JS + `@capacitor/preferences` 持久化服务器列表）
- 选择服务器后，WKWebView 直接导航到该服务器地址（如 `http://192.168.x.x:3001`）
- 前端严格同源（相对路径 `/api` + `window.location.host`），加载服务器 origin 后**登录 / API / WebSocket 全部天然工作**，React 前端无需任何改动
- 冷启动总是回到选择页

## 开发

```bash
# 前置：Xcode 26+，Node 22+；iOS 模拟器

npm install            # 安装依赖（含 @capacitor/*）
npx cap add ios        # 首次生成 ios/ 原生工程（SPM）

# 只改选择页（mobile/www/）后同步：
npm run mobile:sync    # = cap sync ios

# 构建模拟器版：
npm run mobile:build   # = cap sync + xcodebuild (iPhone 17 Pro)

# 打开 Xcode（真机调试 / 改签名 / Archive 用）：
npm run mobile:open
```

## 真机运行

1. `npm run mobile:open` 打开 Xcode
2. 选中你的真机，在 **Signing & Capabilities** 里选择你的 Apple Developer Team（个人免费账号即可）
3. 运行

无需改代码即可连任意服务器：在 App 的「添加服务器」里填 CloudCLI 服务器地址即可。
局域网内为 `http://电脑IP:3001`（iOS 14+ 会弹本地网络权限提示）。

## 连接测试服务器（MVP 阶段用，可选）

不依赖选择页、直接加载固定服务器（用于快速验证）：

```bash
CLOUDCLI_SERVER_URL=http://192.168.31.202:3001 npx cap sync ios
npm run mobile:build
```

模拟器里 `http://localhost:3001` 即指向 Mac 本机。取消该环境变量并 `cap sync` 即回到选择页模式。

## iOS 原生配置要点

- `ios/App/App/Info.plist`：已配置 ATS（`NSAllowsArbitraryLoadsInWebContent` + `NSAllowsLocalNetworking`，允许 WKWebView 加载明文 HTTP）与本地网络权限描述（`NSLocalNetworkUsageDescription`）
- App 图标：`ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`（1024×1024，当前独立维护；不随 Web Logo 更新）

## 注意

- 首次 `xcodebuild` 会通过 SPM 从 GitHub 拉取 `capacitor-swift-pm`，需能访问 GitHub（本机走代理）
- `ios/` 由 `npx cap add ios` 生成；构建产物 `ios/App/build/` 已加入 `.gitignore`
