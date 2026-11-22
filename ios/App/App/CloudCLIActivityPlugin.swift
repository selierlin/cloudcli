import Capacitor
import Foundation

#if canImport(ActivityKit)
import ActivityKit
#endif

/// 灵动岛（Live Activity）的原生桥。
///
/// **为什么只能是本地更新**：AltStore 用免费 Apple ID 重签，拿不到 `aps-environment`
/// entitlement，也就拿不到 activity push token、服务端也没有可用的 APNs key。
/// 因此 `pushType` 恒为 `nil`，活动内容只能由「App 进程自己」更新——前台时实时，
/// 退到后台被系统挂起后冻结（计时器除外，它由系统绘制）。
///
/// 这也决定了岛屿的收尾策略：任务完成时 App 多半已被挂起，`end()` 调不到，
/// 所以 `start` 里必须带 `staleAfterMinutes`，让系统按时把内容标记为过期，
/// 而不是留一个「05:31:12 运行中」的僵尸挂在岛上。
///
/// JS 侧契约（`Capacitor.registerPlugin('CloudCLIActivity')`；`Capacitor.Plugins` 只有在
/// 有人调用过 `registerPlugin` 之后才被填充，别用它取值）：
/// ```js
/// await plugin.isSupported()            // → { supported, hasActivity }
/// await plugin.start({ sessionTitle, serverLabel, deepLink, phase, detail, startedAt, staleAfterMinutes })
/// await plugin.update({ phase, detail, toolCalls, staleAfterMinutes })
/// await plugin.end({ phase, detail, dismissImmediately })
/// ```
///
/// 真机验证（2026-11-22，免费 Apple ID + AltStore 重签）：`isSupported` 返回
/// `{supported:true}`；`start` 后切后台灵动岛显示绿点 + 计时器；`update` 到
/// `waiting` 变黄色手形；`end` 收岛并在锁屏留下完成卡片。未验证：前端自动触发、
/// 切会话跟随、重启接管（写在这里是为了下次不必重新推导哪些已验证）。
@available(iOS 16.2, *)
@objc(CloudCLIActivityPlugin)
final class CloudCLIActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "CloudCLIActivityPlugin"
    let jsName = "CloudCLIActivity"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise)
    ]

    /// 默认 15 分钟没有更新就把内容标记为过期：岛上内容变暗，代表「可能已经旧了」。
    private static let defaultStaleMinutes: Double = 15

    /// 同一时刻只维护一个活动。CloudCLI 的使用模型是「你正在看的那个会话在跑」，
    /// 多会话并行时岛上显示最后启动的那个，避免 iOS 对活动数量的隐式限制。
    private var activity: Activity<CloudCLIActivityAttributes>?

    /// 上一次写入的状态。用于 `update`/`end` 时只改变化的字段，其余保持不变。
    /// 缓存进 UserDefaults 是为了「App 被杀后重启」仍能接管遗留活动——免费签名
    /// 下 7 天过期、闪退都会留下没人管的活动。
    private var lastState: CloudCLIActivityAttributes.ContentState? {
        get {
            guard let data = UserDefaults.standard.data(forKey: Self.stateKey) else { return nil }
            return try? JSONDecoder().decode(CloudCLIActivityAttributes.ContentState.self, from: data)
        }
        set {
            guard let newValue, let data = try? JSONEncoder().encode(newValue) else {
                UserDefaults.standard.removeObject(forKey: Self.stateKey)
                return
            }
            UserDefaults.standard.set(data, forKey: Self.stateKey)
        }
    }

    private static let stateKey = "cloudcli.liveActivity.state"

    // MARK: - 桥接方法

    @objc func isSupported(_ call: CAPPluginCall) {
        // areActivitiesEnabled 是用户在「设置 → CloudCLI → 实时活动」里的总开关，
        // 关掉后 request 会抛错；先问一句能让前端安静地降级。
        call.resolve([
            "supported": ActivityAuthorizationInfo().areActivitiesEnabled,
            "hasActivity": existingActivity() != nil
        ])
    }

    @objc func start(_ call: CAPPluginCall) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            call.reject("实时活动未开启：设置 → CloudCLI → 实时活动")
            return
        }

        let attributes = CloudCLIActivityAttributes(
            // 空标题回落成 App 名：未命名的会话在灵动岛上显示一片空白是最差的结果。
            sessionTitle: readText(call, "sessionTitle").flatMap { $0.isEmpty ? nil : $0 } ?? "CloudCLI",
            serverLabel: readText(call, "serverLabel") ?? "",
            deepLink: readText(call, "deepLink") ?? ""
        )
        // 调用方显式传了本轮开始时间吗？传了就一律以 JS 为准（新的一轮、页面重挂载
        // 都由它给出真值）；没传（手动调试）才沿用既有活动的计时，避免清零。
        let explicitStart = call.getDouble("startedAt")
        let state = CloudCLIActivityAttributes.ContentState(
            phase: readPhase(call) ?? .running,
            // 传本轮真实开始时间：轮询发现一个已经跑了 40 秒的 run 时，岛上应显示 0:40，
            // 而不是从点开它的那一刻从 0:00 起算。
            startedAt: explicitStart.map { Date(timeIntervalSince1970: $0) } ?? Date(),
            detail: readText(call, "detail") ?? "",
            toolCalls: call.getInt("toolCalls") ?? 0
        )
        let content = ActivityContent(state: state, staleDate: staleDate(call))

        Task { @MainActor in
            do {
                // 同一轮（deepLink 相同）说明是页面重新挂载后再次 start：只更新状态，
                // 保住已经在走的计时器。结束再新建会让岛上的时间倒回 0:00。
                if let current = self.existingActivity(), current.attributes.deepLink == attributes.deepLink {
                    var merged = state
                    // 没有显式开始时间时才继承既有计时。反过来（总是继承）会让"上一轮在后台
                    // 结束、这一轮又复用同一会话的岛"把上一轮的时长累加进来。
                    if explicitStart == nil {
                        merged.startedAt = self.lastState?.startedAt ?? state.startedAt
                    }
                    await current.update(ActivityContent(state: merged, staleDate: self.staleDate(call)))
                    self.lastState = merged
                    call.resolve([
                        "id": current.id,
                        "reused": true,
                        "startedAt": merged.startedAt.timeIntervalSince1970
                    ])
                    return
                }

                // 已有活动（换会话、或上次没收尾）先立即收掉，避免岛上出现两条。
                if let previous = self.existingActivity() {
                    await previous.end(nil, dismissalPolicy: .immediate)
                    self.activity = nil
                }

                // pushType 为 nil：免费签名没有 aps entitlement，只能本地更新。
                let requested = try Activity<CloudCLIActivityAttributes>.request(
                    attributes: attributes,
                    content: content,
                    pushType: nil
                )
                self.activity = requested
                self.lastState = state
                call.resolve([
                    "id": requested.id,
                    "reused": false,
                    "startedAt": state.startedAt.timeIntervalSince1970
                ])
            } catch {
                call.reject("启动实时活动失败：\(error.localizedDescription)")
            }
        }
    }

    @objc func update(_ call: CAPPluginCall) {
        guard let activity = existingActivity() else {
            // 活动已过期/被用户滑掉：如实告诉前端，让它决定要不要重新 start。
            call.reject("没有正在运行的实时活动")
            return
        }

        var state = lastState ?? CloudCLIActivityAttributes.ContentState(
            phase: .running,
            startedAt: Date(),
            detail: "",
            toolCalls: 0
        )
        if let phase = readPhase(call) {
            state.phase = phase
        }
        if let detail = readText(call, "detail") {
            state.detail = detail
        }
        if let toolCalls = call.getInt("toolCalls") {
            state.toolCalls = toolCalls
        }
        if call.getBool("restartTimer") == true {
            state.startedAt = Date()
        }

        let content = ActivityContent(state: state, staleDate: staleDate(call))

        Task { @MainActor in
            await activity.update(content)
            self.lastState = state
            call.resolve()
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        guard let activity = existingActivity() else {
            call.resolve(["ended": false])
            return
        }

        var state = lastState ?? CloudCLIActivityAttributes.ContentState(
            phase: .done,
            startedAt: Date(),
            detail: "",
            toolCalls: 0
        )
        if let phase = readPhase(call) {
            state.phase = phase
        }
        if let detail = readText(call, "detail") {
            state.detail = detail
        }

        // `.default` 让完成态（✓ / ✗）在锁屏上多留一会儿；`.immediate` 立刻收掉。
        let policy: ActivityUIDismissalPolicy =
            call.getBool("dismissImmediately") == true ? .immediate : .default
        let content = ActivityContent(state: state, staleDate: nil)

        Task { @MainActor in
            await activity.end(content, dismissalPolicy: policy)
            self.activity = nil
            self.lastState = nil
            call.resolve(["ended": true])
        }
    }

    // MARK: - 私有

    /// 先看自己持有的句柄，再按系统里的现存活动接管（App 重启后句柄为空）。
    private func existingActivity() -> Activity<CloudCLIActivityAttributes>? {
        if let activity {
            return activity
        }
        activity = Activity<CloudCLIActivityAttributes>.activities.first
        return activity
    }

    private func staleDate(_ call: CAPPluginCall) -> Date {
        CloudCLIActivityAttributes.ContentState
            .staleDate(afterMinutes: call.getDouble("staleAfterMinutes") ?? Self.defaultStaleMinutes)
    }

    private func readText(_ call: CAPPluginCall, _ key: String) -> String? {
        guard let raw = call.getString(key) else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "" : trimmed
    }

    private func readPhase(_ call: CAPPluginCall) -> CloudCLIActivityAttributes.Phase? {
        guard let raw = call.getString("phase") else { return nil }
        return CloudCLIActivityAttributes.Phase(rawValue: raw)
    }
}
