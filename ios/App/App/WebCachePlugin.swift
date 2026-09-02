import Foundation
import UIKit
import Capacitor
import WebKit

protocol CloudCLIServerSessionHandling: AnyObject {
    func showServerPicker(from controller: CloudCLIBridgeViewController)
    func showServer(_ url: URL, from controller: CloudCLIBridgeViewController)
    func discardInactiveServerSessions(keeping controller: CloudCLIBridgeViewController)
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

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        show(pickerController)
    }

    func showServerPicker(from controller: CloudCLIBridgeViewController) {
        // 旧版选择页可能把自身整页导航到了服务器；回到选择页时若发现
        // picker webview 已不在本地 App 内容上，重新加载选择页。
        if !pickerController.isShowingLocalApp {
            pickerController.reloadLocalApp()
        }
        show(pickerController)
    }

    func showServer(_ url: URL, from controller: CloudCLIBridgeViewController) {
        let key = url.absoluteString
        let serverController: CloudCLIBridgeViewController

        if let cachedController = serverControllers[key] {
            serverController = cachedController
            // 缓存的 webview 可能已被旧版前端整页导航到选择页，复用前
            // 确认它仍在显示对应服务器，否则重新加载。
            if !serverController.isShowingLoadedServerOrigin {
                serverController.loadServer(url)
            }
        } else {
            serverController = CloudCLIBridgeViewController()
            serverControllers[key] = serverController
            serverController.loadServer(url)
        }

        touchServer(key)
        show(serverController)
        trimServerCache()
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
