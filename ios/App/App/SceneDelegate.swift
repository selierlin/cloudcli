import UIKit
import Capacitor

/// 通知点击跳转（Bark 的 `url` 参数）走自定义 scheme：系统只会用 App 打开
/// 自定义 scheme，http(s) 链接会落到 Safari。目标网页地址放在 `url` 查询参数里，
/// 由服务端拼好（它知道部署的路径前缀），App 只负责加载，不重复实现路由拼接。
func cloudCLIDeepLinkTarget(from url: URL) -> URL? {
    guard url.scheme?.lowercased() == "cloudcli",
          url.host?.lowercased() == "open" else {
        return nil
    }

    // 只允许 http(s)：scheme 是外部可触发的入口，若放行 file:// 等，
    // 通知里的一条链接就能让 WebView 加载任意本地内容。
    guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
          let raw = components.queryItems?.first(where: { $0.name == "url" })?.value,
          let target = URL(string: raw),
          let scheme = target.scheme?.lowercased(),
          ["http", "https"].contains(scheme),
          target.host != nil else {
        NSLog("[CloudCLI] deep link: 目标 URL 不可用，已忽略")
        return nil
    }

    return target
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        // 冷启动由系统在 connectionOptions 里交付 URL。必须先写还原标记：
        // 容器 viewDidLoad 的 attemptRestore 会直接加载目标会话，晚于它就只能
        // 在还原流程之上再切一次，用户会看到还原浮层。
        if let opened = connectionOptions.urlContexts.first?.url,
           let target = cloudCLIDeepLinkTarget(from: opened) {
            RestoreTargetStore.writeTargetURL(target)
        }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = CloudCLIContainerViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)

        // App 已在运行时点击通知：切到目标服务器并加载目标会话。
        guard let opened = URLContexts.first?.url,
              let target = cloudCLIDeepLinkTarget(from: opened) else {
            return
        }

        RestoreTargetStore.writeTargetURL(target)
        (window?.rootViewController as? CloudCLIContainerViewController)?.openDeepLink(target)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
