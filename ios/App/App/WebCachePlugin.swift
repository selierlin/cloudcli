import Foundation
import UIKit
import Capacitor
import WebKit

/// @capacitor/preferences 在 iOS 上写入 UserDefaults.standard，键名前缀固定为
/// "CapacitorStorage."（插件默认 group）。原生侧直接读写同一份存储，避免为冷启动
/// 还原新增桥接方法。该前缀是插件实现细节，升级 @capacitor/preferences 时须回归
/// §8.5-①。
enum RestoreTargetStore {
    private static let prefix = "CapacitorStorage."
    private static let targetKey = prefix + "cloudcli.restoreTarget"
    private static let serversKey = prefix + "cloudcli.servers"

    /// 唯一读取入口。**必须区分「无键」与「键存在但 url 不可用」**：后者是坏值（写入被
    /// 中断、存储损坏、旧版本残留格式），就地清除整个键。否则一个坏值会让恢复从此永久
    /// 静默失效且无自愈路径——与本方案已两次踩到的「静默失效」型坑（事实 12、14）同类（决策 10）。
    static func readTargetURL() -> URL? {
        guard let raw = UserDefaults.standard.string(forKey: targetKey) else { return nil }
        guard let data = raw.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let value = object["url"] as? String,
              let url = URL(string: value),
              let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              url.host != nil else {
            clearTarget()          // 键存在但 url 不可用 → 坏值，清整键
            return nil
        }
        return url
    }

    /// 写还原目标。**所有写入路径（tracker / picker connect / 路径 B / 路径 C）都走这里**，
    /// 契约统一为 `{ "url": <绝对 URL> }`（第十轮起不含计数，见决策 15）。
    static func writeTargetURL(_ url: URL) {
        guard let data = try? JSONSerialization.data(withJSONObject: ["url": url.absoluteString]),
              let json = String(data: data, encoding: .utf8) else { return }
        UserDefaults.standard.set(json, forKey: targetKey)
    }

    static func clearTarget() {
        UserDefaults.standard.removeObject(forKey: targetKey)
    }

    /// 该 origin 是否仍在选择页保存的服务器列表中；服务器被删则不再还原。
    /// 本函数与 `cloudcli.servers` 的写入 schema 是隐式契约（§8.2-8）：字段名一变，
    /// 这里会一律判「已删」并让恢复永久静默失效，故对结构级失配留一条可诊断日志。
    /// 端口比较用原始 `url.port`；默认端口规约见 §8.7 延后项（决策 18/19）。
    static func isKnownServerOrigin(_ url: URL) -> Bool {
        guard let raw = UserDefaults.standard.string(forKey: serversKey),
              let data = raw.data(using: .utf8),
              let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            NSLog("[CloudCLI] restore: cloudcli.servers 不可解析，跳过还原（schema 可能已变）")
            return false
        }
        if !list.isEmpty, list.allSatisfy({ $0["url"] == nil }) {
            NSLog("[CloudCLI] restore: cloudcli.servers 条目缺少 url 字段，还原将被静默跳过——检查 picker 的写入 schema")
        }
        return list.contains { entry in
            guard let value = entry["url"] as? String, let saved = URL(string: value) else { return false }
            return saved.scheme?.lowercased() == url.scheme?.lowercased()
                && saved.host == url.host
                && saved.port == url.port
        }
    }
}

protocol CloudCLIServerSessionHandling: AnyObject {
    func showServerPicker(from controller: CloudCLIBridgeViewController)
    func showServer(_ url: URL, from controller: CloudCLIBridgeViewController)
    func discardInactiveServerSessions(keeping controller: CloudCLIBridgeViewController)
}

/// WebView 缓存键统一为 origin（scheme://host[:port]），消除「同一服务器不同路径各建一个
/// WebView」。端口归约见 §8.7 延后项——现存所有写入路径都先过 JS 的 WHATWG 序列化、已剥掉
/// 默认端口，故当前直接用 `url.port` 即可（决策 18/19 延后）。
func normalizedOriginKey(_ url: URL) -> String {
    guard let scheme = url.scheme?.lowercased(), let host = url.host else {
        return url.absoluteString
    }
    if let port = url.port { return "\(scheme)://\(host):\(port)" }
    return "\(scheme)://\(host)"
}

/// 冷启动还原的三岔口。抽成纯函数（无 Capacitor/UIKit 依赖），便于手工验证分支；
/// 入参由调用方从原生配置与存储映射而来。
enum RestoreDecision: Equatable {
    case skip                 // 直连模式或无可还原目标
    case forget               // 目标服务器已删：清标记后走选择页
    case restore(URL)
}

func decideRestore(isDirectConnect: Bool, targetURLString: String?, isServerSaved: Bool) -> RestoreDecision {
    if isDirectConnect { return .skip }
    guard let value = targetURLString, let url = URL(string: value),
          let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme),
          url.host != nil else { return .skip }
    return isServerSaved ? .restore(url) : .forget
}

@objc(WebCachePlugin)
final class WebCachePlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "WebCachePlugin"
    let jsName = "WebCache"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise)
    ]

    @objc func clear(_ call: CAPPluginCall) {
        let dataStore = bridge?.webView?.configuration.websiteDataStore ?? WKWebsiteDataStore.default()
        let dataTypes = WKWebsiteDataStore.allWebsiteDataTypes()

        dataStore.removeData(ofTypes: dataTypes, modifiedSince: .distantPast) {
            URLCache.shared.removeAllCachedResponses()
            HTTPCookieStorage.shared.removeCookies(since: .distantPast)
            DispatchQueue.main.async {
                guard let controller = self.bridge?.viewController as? CloudCLIBridgeViewController else { return }
                controller.serverSessionHandler?.discardInactiveServerSessions(keeping: controller)
            }
            call.resolve()
        }
    }
}

@objc(ServerSessionPlugin)
final class ServerSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "ServerSessionPlugin"
    let jsName = "ServerSession"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "showPicker", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "switchToServer", returnType: CAPPluginReturnPromise)
    ]

    @objc func showPicker(_ call: CAPPluginCall) {
        guard let controller = bridge?.viewController as? CloudCLIBridgeViewController,
              let handler = controller.serverSessionHandler else {
            call.reject("服务器切换不可用")
            return
        }

        DispatchQueue.main.async {
            handler.showServerPicker(from: controller)
            call.resolve()
        }
    }

    @objc func switchToServer(_ call: CAPPluginCall) {
        guard let rawURL = call.getString("url"),
              let url = URL(string: rawURL),
              let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              url.host != nil,
              let controller = bridge?.viewController as? CloudCLIBridgeViewController,
              let handler = controller.serverSessionHandler else {
            call.reject("服务器地址无效")
            return
        }

        DispatchQueue.main.async {
            handler.showServer(url, from: controller)
            call.resolve()
        }
    }
}

/**
 * 触感反馈插件：iOS 的 WKWebView 从未实现 Vibration API（`navigator.vibrate` 无效），
 * 聊天完成/需要处理的震动只能经原生桥触发。
 *
 * 方法名与参数对齐 `@capacitor/haptics` 的 `notification`，日后若换用官方插件，
 * 前端调用点无需改动。无 Taptic Engine 的设备（iPad）或系统关闭「声音与触感 →
 * 系统触感」时，`UINotificationFeedbackGenerator` 静默不震，不视为错误。
 */
@objc(HapticsPlugin)
final class HapticsPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "HapticsPlugin"
    let jsName = "Haptics"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "notification", returnType: CAPPluginReturnPromise)
    ]

    @objc func notification(_ call: CAPPluginCall) {
        let type = call.getString("type") ?? "success"

        DispatchQueue.main.async {
            let generator = UINotificationFeedbackGenerator()
            switch type {
            case "warning":
                generator.notificationOccurred(.warning)
            case "error":
                generator.notificationOccurred(.error)
            default:
                generator.notificationOccurred(.success)
            }
            call.resolve()
        }
    }
}

final class CloudCLIBridgeViewController: CAPBridgeViewController {
    weak var serverSessionHandler: CloudCLIServerSessionHandling?

    /** 最近一次 loadServer 加载的服务器地址；nil 表示尚未加载过远程服务器。 */
    private var loadedServerURL: URL?

    override func capacitorDidLoad() {
        // The bridge auto-registers configured plugins, so registerPluginType(_:) is
        // intentionally a no-op here. This app-local plugin must be registered as
        // an instance to be exported to the JavaScript bridge.
        bridge?.registerPluginInstance(WebCachePlugin())
        bridge?.registerPluginInstance(ServerSessionPlugin())
        bridge?.registerPluginInstance(HapticsPlugin())
    }

    func loadServer(_ url: URL) {
        loadViewIfNeeded()
        bridgedWebView?.stopLoading()
        _ = bridgedWebView?.load(URLRequest(url: url))
        loadedServerURL = url
    }

    /** 重新加载本地 App 内容（选择页）。 */
    func reloadLocalApp() {
        loadViewIfNeeded()
        if let startURL = bridge?.config.appStartServerURL {
            _ = bridgedWebView?.load(URLRequest(url: startURL))
        }
    }

    /**
     * 该 webview 是否仍显示 loadServer 所加载服务器的 origin。
     * 服务器页面是 SPA（路由只改路径），因此只比对 scheme/host/port。
     * 旧版前端会把「返回服务器列表」做成整页导航，可能把这个 webview
     * 导到选择页或其它 origin，此时不能按原样复用。
     */
    var isShowingLoadedServerOrigin: Bool {
        guard let current = bridgedWebView?.url, let loaded = loadedServerURL else {
            return false
        }
        return current.scheme?.lowercased() == loaded.scheme?.lowercased()
            && current.host == loaded.host
            && current.port == loaded.port
    }

    /** 该 webview 是否仍在显示本地 App（选择页）内容。 */
    var isShowingLocalApp: Bool {
        guard let current = bridgedWebView?.url, let local = bridge?.config.localURL else {
            return false
        }
        return current.scheme == local.scheme && current.host == local.host
    }
}

final class CloudCLIContainerViewController: UIViewController, CloudCLIServerSessionHandling {
    // 当前服务器与上一台服务器各保留一个 WebView；再多会明显增加 iOS 内存压力。
    private let maxCachedServers = 2
    private let pickerController = CloudCLIBridgeViewController()
    private var serverControllers: [String: CloudCLIBridgeViewController] = [:]
    private var recentServerKeys: [String] = []

    /** 正在等待挂载探测的服务器页；nil 表示当前没有进行中的还原。 */
    private weak var restoringController: CloudCLIBridgeViewController?
    /** 还原期间盖在容器上的自绘浮层；nil 表示未显示。 */
    private var restoreOverlay: UIView?

    private let restorePollInterval: TimeInterval = 0.5
    private let restoreUnmountedGrace: TimeInterval = 1.5   // W
    private let restoreAbsoluteTimeout: TimeInterval = 30   // C
    private let mountProbeScript = "!!(document.getElementById('root') && document.getElementById('root').children.length)"

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        show(pickerController)
        // 必须在 show(pickerController) 之后：bridge 在 loadView() 里才创建（事实 14）。
        attemptRestore()
    }

    func showServerPicker(from controller: CloudCLIBridgeViewController) {
        // 用户主动进入选择页才清还原标记：失败被动回退不走这里（决策 4）。
        RestoreTargetStore.clearTarget()
        // 旧版选择页可能把自身整页导航到了服务器；回到选择页时若发现
        // picker webview 已不在本地 App 内容上，重新加载选择页。
        if !pickerController.isShowingLocalApp {
            pickerController.reloadLocalApp()
        }
        show(pickerController)
    }

    func showServer(_ url: URL, from controller: CloudCLIBridgeViewController) {
        _ = presentServer(url)
    }

    func discardInactiveServerSessions(keeping controller: CloudCLIBridgeViewController) {
        let inactiveKeys = serverControllers.compactMap { key, cachedController in
            cachedController === controller ? nil : key
        }
        for key in inactiveKeys {
            guard let cachedController = serverControllers.removeValue(forKey: key) else { continue }
            remove(cachedController)
            recentServerKeys.removeAll { $0 == key }
        }
    }

    /**
     取出（或新建）该服务器 origin 对应的 WebView 并显示它。
     **按 origin 而非完整 URL 作键**：同一服务器的不同路径共用同一个 WebView，否则
     `maxCachedServers = 2` 的预算会被同一台服务器挤占。
     */
    @discardableResult
    private func presentServer(_ url: URL) -> CloudCLIBridgeViewController {
        let key = normalizedOriginKey(url)
        let serverController: CloudCLIBridgeViewController

        if let cachedController = serverControllers[key] {
            serverController = cachedController
            // 缓存的 webview 可能已被旧版前端整页导航到选择页，复用前
            // 确认它仍在显示对应服务器，否则重新加载。
            if !serverController.isShowingLoadedServerOrigin {
                serverController.loadServer(url)
            }
            // 缓存命中且无需重载时，该 WebView 转回可见会触发前端 tracker 的 visibilitychange
            // 自写（P1-2），无需在此落盘。仅当 V7 破、实施 P4 时才加回路径 C（决策 17）。
        } else {
            serverController = CloudCLIBridgeViewController()
            serverControllers[key] = serverController
            serverController.loadServer(url)
        }

        touchServer(key)
        show(serverController)
        trimServerCache()
        return serverController
    }

    // MARK: - 冷启动还原

    /**
     冷启动时尝试直接还原上次的服务器与路由。必须在 `show(pickerController)` 之后调用：
     `bridge` 直到 `loadView()` 才创建（事实 14）。
     */
    private func attemptRestore() {
        guard let config = pickerController.bridge?.config else { return }
        // 直连包（构建期设了 CLOUDCLI_SERVER_URL）根本不加载选择页，不参与还原（事实 12）。
        // 不能拿 `appStartServerURL` 判空——它恒非 nil。
        let isDirectConnect = config.serverURL != config.localURL
        let target = RestoreTargetStore.readTargetURL()
        let isSaved = target.map(RestoreTargetStore.isKnownServerOrigin) ?? false

        switch decideRestore(isDirectConnect: isDirectConnect,
                             targetURLString: target?.absoluteString,
                             isServerSaved: isSaved) {
        case .skip:
            return
        case .forget:
            // 目标服务器已被删除：清标记后停在选择页（决策 4 的半程）。
            RestoreTargetStore.clearTarget()
            return
        case .restore(let url):
            let controller = presentServer(url)
            showRestoreOverlay()
            watchMount(controller)
        }
    }

    /**
     挂载探测（策略 I）：乐观加载，轮询 `#root` 是否有子节点（事实 15）；计时以
     `isLoading == false` 为门控，超时或连续未挂载达宽限期即回退到选择页。
     */
    private func watchMount(_ controller: CloudCLIBridgeViewController) {
        restoringController = controller
        pollMount(controller, deadline: Date().addingTimeInterval(restoreAbsoluteTimeout), notLoadingSince: nil)
    }

    private func pollMount(_ controller: CloudCLIBridgeViewController, deadline: Date, notLoadingSince: Date?) {
        guard restoringController === controller, let webView = controller.bridgedWebView else { return }
        webView.evaluateJavaScript(mountProbeScript) { [weak self, weak controller, weak webView] result, _ in
            guard let self, let controller, let webView else { return }
            // 浮层可能已被「返回服务器列表」取消（restoringController 置 nil）；迟到的回调不得再收尾。
            guard self.restoringController === controller else { return }
            if (result as? Bool) == true {
                self.finishRestore(success: true)
                return
            }

            let now = Date()
            if now >= deadline {
                self.finishRestore(success: false)
                return
            }

            var next = notLoadingSince
            // isLoading 由 false 翻回 true 会重置计时窗口。这是**刻意**的保守选择：只推迟
            // 回退、不会误杀合法慢加载，兜底由 C 负责。不要当 bug「修」掉。
            if webView.isLoading {
                next = nil                                   // 合法慢加载：不计时
            } else if next == nil {
                next = now                                   // 页面已结束加载，开始累计
            }
            if let since = next, now.timeIntervalSince(since) >= self.restoreUnmountedGrace {
                self.finishRestore(success: false)           // 覆盖 5xx / DNS / 连接被拒
                return
            }

            DispatchQueue.main.asyncAfter(deadline: .now() + self.restorePollInterval) { [weak self] in
                self?.pollMount(controller, deadline: deadline, notLoadingSince: next)
            }
        }
    }

    private func finishRestore(success: Bool) {
        restoringController = nil
        removeRestoreOverlay()
        guard !success else { return }   // 成功：撤轮询与浮层即可，目标保留
        // 失败**不**清标记（决策 15）：临时离线不应让用户永久丢失续接能力，下次启动会再试。
        // 永久失效的服务器由用户主动「返回服务器列表」一次摆脱（决策 4 会 clearTarget）。
        show(pickerController)
        showRestoreFailureToast()
    }

    // MARK: - 还原浮层

    private func showRestoreOverlay() {
        guard restoreOverlay == nil else { return }

        let overlay = UIView()
        overlay.backgroundColor = .systemBackground
        overlay.translatesAutoresizingMaskIntoConstraints = false

        let spinner = UIActivityIndicatorView(style: .medium)
        spinner.startAnimating()

        let label = UILabel()
        label.text = "正在恢复上次会话…"
        label.font = .preferredFont(forTextStyle: .subheadline)
        label.textColor = .secondaryLabel
        label.textAlignment = .center

        let button = UIButton(type: .system)
        button.setTitle("返回服务器列表", for: .normal)
        button.addTarget(self, action: #selector(cancelRestore), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [spinner, label, button])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        overlay.addSubview(stack)

        view.addSubview(overlay)
        NSLayoutConstraint.activate([
            overlay.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            overlay.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            overlay.topAnchor.constraint(equalTo: view.topAnchor),
            overlay.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            stack.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: overlay.centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: overlay.leadingAnchor, constant: 32),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: overlay.trailingAnchor, constant: -32)
        ])
        restoreOverlay = overlay
    }

    private func removeRestoreOverlay() {
        restoreOverlay?.removeFromSuperview()
        restoreOverlay = nil
    }

    /** 浮层上的「返回服务器列表」：放弃本次还原，走用户主动路径（内含决策 4 的清标记）。 */
    @objc private func cancelRestore() {
        restoringController = nil
        removeRestoreOverlay()
        showServerPicker(from: pickerController)
    }

    /** 还原失败的非阻塞提示：自动消失，不用阻断式弹窗（§6 问题 3）。 */
    private func showRestoreFailureToast() {
        let container = UIView()
        container.backgroundColor = UIColor.black.withAlphaComponent(0.82)
        container.layer.cornerRadius = 10
        container.layer.masksToBounds = true
        container.translatesAutoresizingMaskIntoConstraints = false

        let label = UILabel()
        label.text = "未能恢复上次会话，已返回服务器列表"
        label.font = .preferredFont(forTextStyle: .footnote)
        label.textColor = .white
        label.textAlignment = .center
        label.numberOfLines = 0
        label.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(label)

        view.addSubview(container)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 14),
            label.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -14),
            label.topAnchor.constraint(equalTo: container.topAnchor, constant: 10),
            label.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -10),
            container.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            container.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -32),
            container.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 24),
            container.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -24)
        ])

        UIView.animate(withDuration: 0.25, delay: 3, options: [.curveEaseIn], animations: {
            container.alpha = 0
        }, completion: { _ in
            container.removeFromSuperview()
        })
    }

    private func show(_ controller: CloudCLIBridgeViewController) {
        if controller.parent == nil {
            addChild(controller)
            controller.serverSessionHandler = self
            let childView = controller.view!
            childView.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(childView)
            NSLayoutConstraint.activate([
                childView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                childView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                childView.topAnchor.constraint(equalTo: view.topAnchor),
                childView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
            ])
            controller.didMove(toParent: self)
        }

        for child in children {
            child.view.isHidden = child !== controller
        }
    }

    private func touchServer(_ key: String) {
        recentServerKeys.removeAll { $0 == key }
        recentServerKeys.append(key)
    }

    private func trimServerCache() {
        while recentServerKeys.count > maxCachedServers {
            let key = recentServerKeys.removeFirst()
            guard let controller = serverControllers.removeValue(forKey: key) else { continue }
            remove(controller)
        }
    }

    private func remove(_ controller: CloudCLIBridgeViewController) {
        controller.willMove(toParent: nil)
        controller.view.removeFromSuperview()
        controller.removeFromParent()
    }
}
