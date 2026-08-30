import Foundation
import Capacitor
import WebKit

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
            call.resolve()
        }
    }
}

final class CloudCLIBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        // The bridge auto-registers configured plugins, so registerPluginType(_:) is
        // intentionally a no-op here. This app-local plugin must be registered as
        // an instance to be exported to the JavaScript bridge.
        bridge?.registerPluginInstance(WebCachePlugin())
    }
}
