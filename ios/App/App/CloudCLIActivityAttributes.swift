import ActivityKit
import Foundation

/// 灵动岛 / 实时活动的**共享契约**。
///
/// 同一份源文件同时编进两个 target：主 App（`App`）用它请求与更新活动，
/// Widget extension（`CloudCLIActivityWidget`）用同一类型渲染。ActivityKit 按类型名
/// 匹配两侧的活动，所以这份文件必须**两边都在 Sources 里**，改字段也要一起改；
/// 任何一侧漏编都会表现为「活动起来了但灵动岛空白」。
///
/// 免费 Apple ID 签名没有 App Group，主 App 与 extension 是两个互不可见的沙盒，
/// 不能靠 UserDefaults/文件共享状态。因此**所有要显示的数据都必须随
/// `ContentState` 全量传给系统**，extension 侧只做纯渲染、不读任何本地存储。
struct CloudCLIActivityAttributes: ActivityAttributes {
    /// 每次 `update` 整体替换的状态快照。
    public struct ContentState: Codable, Hashable {
        /// 当前阶段，决定岛上的图标、颜色与「计时器是否还在走」。
        var phase: Phase
        /// 本轮开始时间。用于 `Text(timerInterval:)` —— 由系统自己绘制，
        /// App 被挂起后依然会走，是零成本方案里「看起来还活着」的关键。
        var startedAt: Date
        /// 一行补充说明（当前工具名 / 等待审批的原因等）。保持低频变化，
        /// 因为 App 挂起后这段文本会冻结在最后一帧。
        var detail: String
        /// 本轮已完成的工具调用数，给扩展视图做进度感，不追求精确。
        var toolCalls: Int
    }

    /// 活动生命周期内不变的部分。
    var sessionTitle: String
    /// 服务器标识（host[:port]），多机用户区分「是哪台机器在跑」。
    var serverLabel: String
    /// 点按灵动岛/锁屏卡片时交给系统的 URL，形如
    /// `cloudcli://open?url=<encodeURIComponent(会话地址)>`。
    /// 由 JS 侧拼好（只有它知道部署前缀），原生侧不重复实现路由拼接。
    /// 空串表示不可点。
    var deepLink: String
}

extension CloudCLIActivityAttributes {
    /// 与 JS 侧字符串一一对应；rawValue 参与 Codable 编码，改名即破坏兼容。
    public enum Phase: String, Codable, Hashable {
        case running
        case waiting
        case done
        case failed
    }
}

extension CloudCLIActivityAttributes.ContentState {
    /// 活动被系统判定过期（`staleDate`）后仍会显示，只是内容变暗。用于没有
    /// push、App 又被挂起时告诉用户「这条状态可能已经旧了」。
    static func staleDate(afterMinutes minutes: Double) -> Date {
        Date().addingTimeInterval(max(minutes, 0) * 60)
    }
}
