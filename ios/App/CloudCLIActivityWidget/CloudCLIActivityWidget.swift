import ActivityKit
import SwiftUI
import WidgetKit

/// 灵动岛 / 锁屏实时活动的渲染端。
///
/// 设计约束来自「免费签名 + 无 push」（见 `CloudCLIActivityPlugin.swift` 头部注释）：
/// 主 App 退到后台就被挂起，`update()` 再也到不了这里。所以这里刻意只让**系统**
/// 负责「会动的东西」——`Text(timerInterval:)` 由系统绘制、没有进程也会走；
/// 其余文本类信息只放低频字段（会话名、阶段、当前工具），冻结在最后一帧时也不出戏。
///
/// 免费签名没有 App Group，这个 extension 读不到主 App 的任何存储，一切数据都来自
/// `ActivityViewContext`，别在这里加 UserDefaults / 文件读取。
@main
struct CloudCLIActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: CloudCLIActivityAttributes.self) { context in
            LockScreenCard(context: context)
                .activityBackgroundTint(Color.black.opacity(0.55))
                .activitySystemActionForegroundColor(.white)
                .widgetURL(context.attributes.targetURL)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(context.attributes.sessionTitle)
                            .font(.system(size: 14, weight: .semibold))
                            .lineLimit(1)
                            .truncationMode(.tail)
                        if !context.attributes.serverLabel.isEmpty {
                            Text(context.attributes.serverLabel)
                                .font(.system(size: 11))
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                    }
                }

                DynamicIslandExpandedRegion(.trailing) {
                    TrailingStatus(state: context.state, compact: false)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }

                DynamicIslandExpandedRegion(.bottom) {
                    HStack(spacing: 6) {
                        Image(systemName: context.state.phase.symbolName)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(context.state.phase.tint)
                        Text(bottomDetail(context))
                            .font(.system(size: 12))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .truncationMode(.tail)
                        Spacer(minLength: 0)
                    }
                }
            } compactLeading: {
                PhaseDot(phase: context.state.phase, size: 9)
            } compactTrailing: {
                TrailingStatus(state: context.state, compact: true)
            } minimal: {
                PhaseDot(phase: context.state.phase, size: 11)
            }
            .widgetURL(context.attributes.targetURL)
            .keylineTint(context.state.phase.tint)
        }
    }

    /// 展开态底部：优先展示「当前在跑什么」，没有再退回阶段名。
    private func bottomDetail(_ context: ActivityViewContext<CloudCLIActivityAttributes>) -> String {
        let detail = context.state.detail.trimmingCharacters(in: .whitespacesAndNewlines)
        guard detail.isEmpty else {
            return context.state.toolCalls > 0 ? "\(detail) · 第 \(context.state.toolCalls) 步" : detail
        }
        return context.state.phase.label
    }
}

// MARK: - 锁屏 / 通知中心卡片

private struct LockScreenCard: View {
    let context: ActivityViewContext<CloudCLIActivityAttributes>

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            PhaseDot(phase: context.state.phase, size: 10)

            VStack(alignment: .leading, spacing: 2) {
                Text(context.attributes.sessionTitle)
                    .font(.system(size: 14, weight: .semibold))
                    .lineLimit(1)
                    .truncationMode(.tail)
                Text(subtitle)
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }

            Spacer(minLength: 8)

            TrailingStatus(state: context.state, compact: false)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    private var subtitle: String {
        let detail = context.state.detail.trimmingCharacters(in: .whitespacesAndNewlines)
        let server = context.attributes.serverLabel
        switch (detail.isEmpty, server.isEmpty) {
        case (false, false): return "\(detail) · \(server)"
        case (false, true): return detail
        case (true, false): return server
        case (true, true): return context.state.phase.label
        }
    }
}

// MARK: - 部件

/// 阶段圆点：紧凑/极简区唯一的视觉元素，一眼分辨跑/等/成/败。
private struct PhaseDot: View {
    let phase: CloudCLIActivityAttributes.Phase
    let size: CGFloat

    var body: some View {
        Group {
            if phase == .running {
                Circle()
                    .fill(phase.tint)
                    .frame(width: size, height: size)
            } else {
                Image(systemName: phase.symbolName)
                    .font(.system(size: size + 2, weight: .bold))
                    .foregroundStyle(phase.tint)
            }
        }
        .accessibilityLabel(phase.label)
    }
}

/// 右侧状态：跑着时是系统自绘计时器（App 挂起也能走），结束后是结果图标。
private struct TrailingStatus: View {
    let state: CloudCLIActivityAttributes.ContentState
    let compact: Bool

    /// `Text(timerInterval:)` 按区间**最长可能值**预留宽度。上界若给
    /// `Date.distantFuture`，紧凑态（showsHours: false）会把分钟数算成十几位，
    /// 灵动岛被撑到系统允许的最大宽度（真机实测约 367pt）。给 24 小时上界后，
    /// 预留宽度落在「1440:00」这个量级，岛宽恢复正常。超过 24h 的 run 计时会停住，
    /// 但那时内容早已 stale，不值得为它留出上万亿分钟的宽度。
    private var timerEnd: Date {
        state.startedAt.addingTimeInterval(24 * 60 * 60)
    }

    var body: some View {
        switch state.phase {
        case .running:
            Text(timerInterval: state.startedAt...timerEnd,
                 countsDown: false,
                 showsHours: !compact)
                .monospacedDigit()
                .font(.system(size: compact ? 13 : 20,
                              weight: .semibold,
                              design: .rounded))
                .frame(minWidth: compact ? 38 : 62, alignment: .trailing)
        case .waiting, .done, .failed:
            Image(systemName: state.phase.symbolName)
                .font(.system(size: compact ? 13 : 18, weight: .semibold))
                .foregroundStyle(state.phase.tint)
                .frame(minWidth: compact ? 38 : 62, alignment: .trailing)
        }
    }
}

// MARK: - 阶段表现

extension CloudCLIActivityAttributes.Phase {
    var tint: Color {
        switch self {
        case .running: return Color(red: 0.22, green: 0.78, blue: 0.66)
        case .waiting: return Color(red: 1.0, green: 0.70, blue: 0.25)
        case .done: return Color(red: 0.35, green: 0.80, blue: 0.45)
        case .failed: return Color(red: 1.0, green: 0.42, blue: 0.42)
        }
    }

    var symbolName: String {
        switch self {
        case .running: return "circle.fill"
        case .waiting: return "hand.raised.fill"
        case .done: return "checkmark.circle.fill"
        case .failed: return "exclamationmark.triangle.fill"
        }
    }

    var label: String {
        switch self {
        case .running: return "运行中"
        case .waiting: return "等待确认"
        case .done: return "已完成"
        case .failed: return "已失败"
        }
    }
}

extension CloudCLIActivityAttributes {
    /// 点按卡片/灵动岛时交给系统的 URL（自定义 scheme，由 SceneDelegate 校验后加载）。
    var targetURL: URL? {
        guard !deepLink.isEmpty, let url = URL(string: deepLink) else { return nil }
        return url
    }
}
