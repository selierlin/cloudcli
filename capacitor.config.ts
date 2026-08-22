import type { CapacitorConfig } from '@capacitor/cli';

/**
 * CloudCLI 移动端（Capacitor 薄客户端）。
 *
 * 手机端无法运行 CloudCLI 后端（Node + Claude CLI），因此本 App 是
 * 一个薄客户端：WKWebView 直接加载用户配置的远程 CloudCLI 服务器。
 * 由于前端严格同源（相对路径 /api、window.location.host），
 * 加载服务器 origin 后登录/聊天/WebSocket 全部天然工作。
 *
 * MVP 阶段：通过环境变量 CLOUDCLI_SERVER_URL 指定要加载的服务器地址，
 * 例如 `CLOUDCLI_SERVER_URL=http://192.168.1.5:3001 npx cap sync ios`。
 * 未设置时回落到 webDir（mobile/www）的服务器选择页。
 */
const serverUrl = process.env.CLOUDCLI_SERVER_URL;

const config: CapacitorConfig = {
  appId: 'ai.cloudcli.mobile',
  appName: 'CloudCLI',
  webDir: 'mobile/www',
  server: {
    // 选择页会导航到用户输入的任意 CloudCLI 服务器主机（局域网 IP / 域名）。
    // 必须放行全部主机，否则 Capacitor 会把这些导航交给系统 Safari 打开。
    allowNavigation: ['*'],
    // MVP 阶段：CLOUDCLI_SERVER_URL 指定固定加载的服务器地址；
    // 未设置时回落 webDir 选择页。
    ...(serverUrl
      ? {
          url: serverUrl,
          // iOS 明文 HTTP 由 Info.plist 的 ATS 配置控制（见 ios/App/App/Info.plist）
          cleartext: true,
        }
      : {}),
  },
};

export default config;
