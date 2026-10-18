# CloudCLI Bark 推送接入与多服务通知方案

> 状态：**P0 已实现（2026-10-18），待真机验收。**
> 日期：2026-10-18（同日记录第一轮拍板：2 台服务器 / 自建 Bark / 两台均可直达 Bark / 不做前台抑制 / 不做同会话覆盖）
> 基线：`3941561e`，工作区干净。
> 证据强度：机制结论来自代码静态阅读；Bark 协议结论来自官方文档（2026-10-18 核对）；**均未做端到端实机验证**。
> 关联代码：`server/modules/notifications/*`、`server/modules/settings/*`、`src/modules/settings/*`、`src/shared/favicon.ts`、`ios/App/App/public/picker.js`。

## 0. 结论先行

1. **失败态 favicon 是固定的，不闪。** 红色叉号（`favicon-failed-32.png`）在 `BLINK_PHASE_MS.failure = 0` 时只画一次；只有完成（600ms）与审批（1200ms）会闪烁（`src/shared/favicon.ts:33-37`）。它也不是永久常驻：标签页在前台时 2 秒后自动消失；在后台时一直保留到用户回来，再等 2 秒消失（`favicon.ts:213-236`）。
2. **Bark 可以接，而且不用改数据库。** 现有通知模块已经把「通道」和「端点」抽象好了：`notification_channel_endpoints` 表是通用的，偏好 JSON 也接受任意布尔通道键（`notification-channel-endpoints.ts:51`、`notification-preferences.ts:41-66`）。新增 Bark 基本等于「加一个 channel + 一张设置卡片」。
3. **多服务本身不会造成重复推送。** 每个 run 只属于一个服务端进程，事件源天然分区；同一台服务器上重复添加同一个 device key 会被 `UNIQUE(user_id, channel, endpoint_id)` 挡住（`schema.ts:73-86`）。多服务真正要解决的是两件事：**来源识别**（哪台服务器发的）和**配置分发**（要在 N 台机器上各配一次）。
4. **推荐路线**：Bark 作为独立通道接入，**2 台服务器、自建 Bark**，配置存每台服务器自己的 DB；用 Bark 的 `group`/`subtitle` 带服务器标识；v1 不做重试、不做点击跳转、不做前台抑制、不做同会话覆盖。**唯一的硬前提是两台服务器各自能访问到自建 Bark**（§5.5）。

## 1. 现状：一条通知是怎么发出去的

### 1.1 服务端链路

所有 provider 在 run 结束、失败、请求权限时调用同一个入口：

| 环节 | 位置 | 行为 |
| --- | --- | --- |
| 事件创建 | `notification-orchestrator.service.ts:322-402` | `notifyRunStopped` / `notifyRunFailed` / 权限请求，统一成 `kind + code + meta` |
| 事件过滤 | `notification-orchestrator.service.ts:71-87` | 按 `events.actionRequired/stop/error` 过滤；20 秒内存去重 |
| 载荷生成 | `notification-orchestrator.service.ts:205-232` | `title` = 会话名或 `CloudCLI`；`body` = `Provider: 文案` |
| 通道分发 | `notification-orchestrator.service.ts:261-278` | 目前只有 `webPush` 与 `desktop` 两个通道 |
| 发送 | `:234-259`（web push）、`desktop-notification-clients.service.ts:86-124`（桌面） | fire-and-forget，失败只打日志 |

通道接口只有两个方法：

```ts
// notification-orchestrator.service.ts:261-278
{
  id: 'bark',
  isEnabled: (preferences) => Boolean(preferences.channels.bark),
  send: ({ userId, payload }) => sendBarkNotification(userId, payload),
}
```

### 1.2 前端链路（与 Bark 无关，但决定体验）

- favicon、声音、震动由前端在收到 `complete` 终态事件时触发（`useChatRealtimeHandlers.ts:352-383`）。
- 失败只亮红叉，**不响、不震**。
- `aborted` 的 run 直接跳过，不亮任何标记。

### 1.3 为什么必须用 Bark

iOS 客户端是开发者签名、无 APNs 证书的 WKWebView 壳，进入后台后 WebSocket 与 JS 都会被挂起，既收不到 Web Push，也无法在本地轮询。Bark 走它自己的 APNs 通道，是绕开这个限制的最短路径。

## 2. 失败态 favicon 的事实核对

| 问题 | 事实 | 依据 |
| --- | --- | --- |
| 报错时是红叉吗 | 是，`/icons/favicon-failed-32.png` | `favicon.ts:20-24` |
| 固定还是闪烁 | **固定**，周期为 0，不启动定时器 | `favicon.ts:33-37`、`:102-105` |
| 为什么固定 | 设计注释：失败不紧急，且第二个闪烁态会与审批态在标签尺寸下混淆 | `favicon.ts:26-32` |
| 会一直留着吗 | 前台：2 秒后消失；后台：留到用户回来再 2 秒后消失 | `favicon.ts:213-236`、`:252-272` |
| 与其它标记的优先级 | `approval > failure > completion`，同时只显示一个 | `favicon.ts:113-128` |
| 失败会响铃/震动吗 | 不会，只有成功路径触发声音与震动 | `useChatRealtimeHandlers.ts:374-383` |

如果希望失败也闪，只改 `BLINK_PHASE_MS.failure` 一处即可（例如 800ms），但会重新引入「红叉闪烁 vs 琥珀审批闪烁」的辨识问题。**这一条待确认是否要改。**

## 3. Bark 协议事实（已核对）

官方与自建 `bark-server` 使用同一套 API（`https://api.day.app` / 自建域名）：

```http
POST {barkServer}/push
Content-Type: application/json

{
  "device_key": "xxxxxxxx",
  "title": "会话名",
  "subtitle": "Mac mini",
  "body": "Claude: ✅ 回复已完成",
  "group": "CloudCLI · Mac mini",
  "level": "active",
  "sound": "minuet",
  "url": "https://cloudcli.example.com/session/<id>",
  "isArchive": "1"
}
```

响应为 `{ "code": 200, "message": "success", "timestamp": ... }`。`code` 非 200 要当作失败，不能只看 HTTP 状态。

自建 `bark-server` 使用同一套 `/push` 接口。注意 `/push` 属于 v2 API，较老的自建版本只支持 `GET /{key}/{title}/{body}`；部署前先确认版本，测试按钮会直接暴露 404。批量字段 `device_keys` 需要 v2.1.9+，本方案逐端点发送，用不到。

可用字段中与本方案相关的：

| 字段 | 用途 | 本方案 |
| --- | --- | --- |
| `group` | 通知中心按组堆叠，可整组静音 | **用作服务器标识** |
| `subtitle` | 标题下方的次级文本 | 服务器名（可选） |
| `level` | `active` / `timeSensitive` / `passive` / `critical` | 默认 `active`；`passive` 可做「只进通知中心不亮屏」 |
| `sound` | 内置铃声名 | 可留空走 Bark 全局设置 |
| `url` | 点击跳转 | v1 不做（见 §8） |
| `icon` | 通知图标 URL | 可选，需要服务器公网地址 |
| `device_keys` | 批量推送（JSON 请求） | 不必要，逐端点发即可 |
| `id` | 通知标识，同 id 可覆盖 | 可选，用于避免同一会话堆叠 |

## 4. 推荐方案：Bark 作为独立通知通道

### 4.1 数据模型（零迁移）

复用 `notification_channel_endpoints`：

| 字段 | 值 |
| --- | --- |
| `channel` | `bark` |
| `endpoint_id` | Bark device key |
| `label` | 用户可读名称（如「iPhone 17」） |
| `metadata_json` | `{ serverUrl, group, subtitle, sound, level, publicUrl? }` |
| `enabled` | 开关 |

偏好侧只需新增 `channels.bark`。`normalizeNotificationPreferences` 已经会保留未知布尔通道（`notification-preferences.ts:46-49`），所以服务端不需要迁移。

**但前端必须同步加键**：`NotificationPreferencesState` 是封闭类型（`src/shared/types.ts:1749-1763`），`useSettingsController` 保存时也只重建已知的五个通道（`useSettingsController.ts:200-205`）。如果只加后端不改这两处，用户任何一次保存设置都会把 `channels.bark` 丢掉。这是本方案最容易踩的坑。

**实现口径（P0）**：投递以**端点行存在且 `enabled`** 为准，`channels.bark` 只是 endpoints 路由写入的镜像，不作为通道的 `isEnabled` 判据（Bark 通道返回 `true`，服务内部再查端点）。这样即使客户端拿着一份过期的偏好快照保存，也不会把已配置的设备静默关掉；偏好里的 `bark` 仍然被前端完整 round-trip，便于以后展示与统计。

### 4.2 发送实现

新增 `server/modules/notifications/services/bark-notification.service.ts`，形态对齐桌面通道：

```ts
const BARK_TIMEOUT_MS = 5000;

export async function sendBarkNotification(userId: number, payload: NotificationPayload) {
  const endpoints = notificationChannelEndpointsDb.getEnabledEndpoints(userId, 'bark');
  const results = await Promise.allSettled(endpoints.map(async (endpoint) => {
    const meta = notificationChannelEndpointsDb.parseMetadata(endpoint.metadata_json);
    const base = normalizeBaseUrl(meta.serverUrl);
    if (!base) {
      throw new Error('bark serverUrl is missing');
    }
    const response = await fetch(`${base}/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_key: endpoint.endpoint_id,
        title: payload.title,
        subtitle: meta.subtitle || undefined,
        body: payload.body,
        group: meta.group || undefined,
        sound: meta.sound || undefined,
        level: meta.level || 'active',
      }),
      signal: AbortSignal.timeout(BARK_TIMEOUT_MS),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.code !== 200) {
      throw new Error(`Bark ${response.status}/${body?.code ?? 'unknown'}: ${body?.message ?? ''}`);
    }
  }));

  // 失败只记录，不抛出：通知不能影响 run 的收尾。
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(`[bark] delivery failed for endpoint ${endpoints[index].id}`, result.reason);
    }
  });
}
```

要点：

- **`serverUrl` 必填，不回落到官方 `api.day.app`**。自建场景下把内容发到第三方是隐私事故；缺失时该端点记失败，不猜。
- **超时 5 秒**，使用仓库已有的 `AbortSignal.timeout` 写法（`workbuddy-credits.client.ts:240`）。
- **不重试**。超时可能发生在 Bark 已投递之后，重试会造成重复推送。若以后要重试，必须先引入 Bark `id` 做幂等。
- **不影响主流程**：通道是 fire-and-forget，异常只打日志（`notification-orchestrator.service.ts:315-317` 已有兜底）。
- **日志脱敏**：绝不打印带 device key 的完整 URL；只打印端点行 id。

### 4.3 载荷映射

保持现有 `buildNotificationPayload` 不变，只在 Bark 侧追加：

| Bark 字段 | 来源 |
| --- | --- |
| `title` | `payload.title`（会话名，回落到 `CloudCLI`） |
| `body` | `payload.body`（`Claude: ✅ 回复已完成`） |
| `group` | `metadata.group`，默认 `CloudCLI · <hostname>` |
| `subtitle` | `metadata.subtitle`，默认空 |
| `level` | `metadata.level`，默认 `active` |

注意：**事件类型开关是全局的**。Bark 会继承 `events.actionRequired/stop/error`，无法做到「Bark 只收完成、Web Push 收全部」。v1 接受这个限制，见 §9.2 第 4 条。

### 4.4 设置界面

在 `NotificationsSettingsTab.tsx` 增加一张 Bark 卡片（位置放在 Web Push / Desktop 之后、Sound 之前）：

- Bark 服务器地址（**必填**，例如 `http://bark.home:8080` 或反向代理后的 HTTPS 域名；不预填官方地址）
- Device Key（支持直接粘贴 `https://bark.example.com/<key>`，前端拆成 origin + key）
- 来源名称（默认 `os.hostname()`，写进 `group`/`subtitle`）
- 铃声、级别（可折叠的「高级」区）
- 「发送测试」按钮：同步调用专用测试接口，把 Bark 的 `message` 原样回显，失败可见
- 已配置端点列表：可禁用/删除；key 显示为掩码

端点增删走已有的通用路由（`notifications.routes.ts:42-125`），不需要新 CRUD。需要新增的只有：

1. `src/shared/api.ts` 的 endpoints 客户端方法（目前前端没有调用方）。
2. 一个测试接口，例如 `POST /api/notifications/test`，body `{ channel: 'bark' }`。它**绕过事件偏好与去重**，直接对已启用端点发一条固定载荷，并返回每个端点的结果。

i18n：15 个 locale（`src/modules/i18n/locales/*/settings.json`）。新增键可先用 `defaultValue` 兜底英文，再统一补翻译。

### 4.5 安全

- device key 是 bearer 凭据，存 `metadata_json` 明文，与 `push_subscriptions` 的 endpoint/keys 同级；单用户自托管可接受，但不要写进日志、不要出现在错误上报里。
- `serverUrl` 是用户可控的出站目标。限制 `http/https`、去尾部斜杠、长度上限；**不封禁内网地址**，因为自建 Bark 常在 LAN（这是有意的取舍，写在文档里）。自建常用 `http://`，但 HTTP 下 device key 和通知正文在链路上明文，只在可信内网使用；跨网段或公网必须走 HTTPS 反向代理。
- `GET /endpoints` 会返回完整 key（`notifications.routes.ts:11-23`）。UI 保存后应掩码显示，避免肩窥；这是展示层约束，不是权限边界。

## 5. 多服务分析

### 5.1 拓扑事实

- 每台服务器一个独立 SQLite（`~/.cloudcli/auth.db`），单用户；用户 id 通常都是 1。
- iOS 客户端的服务器选择页把 `{ name, url }` 存在本机（`ios/App/App/public/picker.js:9-13`），可以保存多个服务器，切换时整页导航到目标 origin。
- 服务端目前**不知道自己叫什么**：没有 server name 配置，也没有把 hostname 暴露给前端。

### 5.2 会不会重复推送

**不会，前提是拓扑正常。** 理由：

1. 通知事件的源头是 run 的生命周期，一个 run 只由一个服务端进程驱动；其它服务器即使挂载了同一个项目目录，也不会为这个 run 发停止/失败事件。
2. 同一服务器上同一个 key 只能有一条端点记录，唯一约束挡住了重复添加（`schema.ts:84`）。
3. 同一台机器用两个域名访问（LAN + Tailscale）仍是同一个进程、同一份内存去重表，只发一次。

唯一会重复的拓扑是「两个进程共享同一个 DB」——SQLite 单写者模型本来就不支持，不在讨论范围。

### 5.3 来源识别

一个手机收多台服务器的推送时，必须能一眼看出是哪台。三个可选位置：

| 位置 | 效果 | 建议 |
| --- | --- | --- |
| `group` | 通知中心按服务器分组，可整组静音 | **采用**；默认 `CloudCLI · <hostname>` |
| `subtitle` | 标题下方显示服务器名 | 采用；仅当用户填了才发 |
| `body` 前缀 | 横幅内一定可见 | 不做，避免污染正文 |

hostname 只是默认值，允许在 Bark 卡片里改（例如「Mac mini」「公司服务器」）。它存在每台服务器的 endpoint metadata 里，不需要新的全局设置。

### 5.4 配置分发：四选一

| 方案 | 做法 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- | --- |
| **A. 每实例 DB 配置** | 每台服务器在设置页配一次 | 复用现有表/路由；无迁移；各服务器可指向各自的 Bark 服务（含内网自建） | N 次手工配置 | **采用（N=2，手工 ×2 可接受）** |
| B. 环境变量 | `CLOUDCLI_BARK_URL/KEY/GROUP` | 可放 dotfiles，一处改多处生效；无 UI；适合无头实例 | 密钥进环境变量；改配置要重启；App 内不可开关 | **暂不做**（2 台量级不值得引入 env 分支） |
| C. 共享配置文件 | 所有机器挂同一份 JSON | 同步简单 | 需要额外解析/热加载；与现有 endpoint 模型重复 | 不采纳 |
| D. 中央 relay | 各服务器 POST 到 hub，hub 统一推 Bark | 一处配置、统一限流与去重 | 多一个服务、鉴权、重试、单点故障 | 不采纳 |

定案：**A**。2 台服务器各配一次的成本低于维护一套 env 解析与优先级规则；等服务器数量继续增长再考虑 B。

### 5.5 可达性与离线

- **出站方向**：每台服务器要能访问它配置的 Bark 地址。这是本方案在多服务下唯一真正的硬前提。
- **2 台 + 自建 + 可能内网的实际画法**：**已确认两台服务器都能直达 Bark**，直接按「各填各的 `serverUrl`」落地。下表保留其余拓扑的备查路径（本方案不触发）：

| 情况 | 做法 | 评价 |
| --- | --- | --- |
| 两台都能直达 Bark（含同一内网） | 两台都填 Bark 的内网/公网地址 | **本方案采用**；最简单 |
| 一台内网、一台公网 VPS | 两台加入同一个 Tailscale/WireGuard 虚拟网，VPS 填 Bark 的虚拟网地址 | 备选；不把 Bark 暴露到公网 |
| 无法组虚拟网 | 用 HTTPS 反向代理把 Bark 暴露到公网，并在反代层加 IP 白名单或 Basic Auth | 备选；多一层暴露面 |
| 公网服务器完全无法访问 Bark | 只能退回 Web Push/声音/桌面 | 本方案不适用 |

- **中继方案不推荐**：让公网服务器把事件转发给内网服务器、再由内网服务器推 Bark，等于把 §5.4 的 D 缩小做一遍，新增接口、鉴权与重试，收益只有「少配一次」。
- **验证方式**：测试按钮必须在**每台服务器上各点一次**。在 A 上测通不代表 B 能出网；这是多服务验收里最容易漏的一步。
- **离线语义**：Bark 请求失败就是丢一条通知，没有队列、没有补发。v1 接受；不建议为此引入 SQLite 队列表（收益低、复杂度高）。
- **网络抖动**：5 秒超时 + 不重试，最坏情况是用户晚一点从其它通道（声音/桌面）感知。

### 5.6 前台抑制

服务端无法可靠判断「手机 App 是否在前台」：

- WebSocket 在 iOS 进入后台后不会立刻断，存在一段系统宽限期；用「有 WS 连接」当判据会**恰好漏掉**用户最需要的那条（正在后台等回复）。
- 用延迟 N 秒再检查会引入定时器与状态，且宽限期长度不可控。

因此 v1 **不做前台抑制**。代价是：用户盯着 App 时也会收到 Bark。若觉得吵，可把 `level` 设为 `passive`（只进通知中心、不亮屏）。已拍板（§9.1 第 3 条）。

## 6. 备选方案与不采纳理由

| 方案 | 不采纳理由 |
| --- | --- |
| 直接 APNs | 需要证书与 App 的 push entitlement；当前开发者签名包没有，正是用户已经排除的路 |
| Web Push | iOS 上只有「添加到主屏幕」的 PWA 才稳定；WKWebView 壳不满足，且同样依赖证书链路 |
| ntfy / Gotify | 能力相近，但用户已装 Bark；换一套等于多装一个 App |
| Telegram Bot | 需要科学上网与 bot 配置；iOS 通知体验不如原生 |
| 通用 Webhook | 灵活但用户端要自己写接收器；可以作为 P2 的泛化，不作为 v1 |
| 客户端轮询 | 后台被挂起，轮询不成立 |

## 7. 实施拆分

### P0（可用）

1. 服务端：`bark-notification.service.ts` + 注册进 `notificationChannels`。
2. 服务端：`POST /api/notifications/test`（Bark 专用或按 channel 分发）。
3. 前端：`channels.bark` 类型与 controller 透传。
4. 前端：Bark 设置卡片（服务器地址、key、来源名称、测试、启用/禁用）。
5. 前端：`api.ts` 增加 endpoints 与 test 调用。
6. 单测：URL 归一化、`code !== 200` 判失败、超时不抛、偏好关闭时不发。

### P0 落地记录（2026-10-18）

| 文件 | 内容 |
| --- | --- |
| `server/modules/notifications/services/bark-notification.service.ts` | `POST {serverUrl}/push`、5 秒超时、`code !== 200` 判失败、失败不抛；`sendBarkTestNotification` 供测试按钮使用 |
| `notification-orchestrator.service.ts` | 注册 `bark` 通道；端点存在性是开关 |
| `notifications.routes.ts` | `POST /api/notifications/test` |
| `notification-preferences.ts` | `channels.bark` 默认值与归一化 |
| `src/shared/types.ts`、`useSettingsController.ts` | 前端偏好类型与 round-trip |
| `src/shared/api.ts` | endpoints / test 客户端方法 |
| `src/modules/settings/hooks/useBarkNotifications.ts` | 端点加载、保存、启停、删除、测试 |
| `src/modules/settings/tabs/notifications-settings/BarkSettingsCard.tsx` | 设置卡片；支持粘贴完整推送 URL |
| `server/modules/notifications/tests/bark-notification.test.ts` | 5 例：载荷、禁用端点、缺 URL、Bark 业务错误、编排器接线 |
| `src/modules/settings/tests/settingsControllerBarkPreferences.test.ts` | `channels.bark` 在设置保存后不丢 |

验证结果：`npm run typecheck`、`npm run build`、`npm run lint`（0 error）、通知模块 9 例、Bark 5 例、前端 round-trip 1 例均通过。**尚未做真机 Bark 实测。**

### P1（多服务体验）

7. `group`/`subtitle` 默认值与编辑。
8. 多端点列表与掩码显示。
9. 15 个 locale 的文案。

### P2（可选）

10. 环境变量兜底自动注册（多机首次启动）。
11. 点击跳转（需要 `publicUrl` 配置；跳到 Safari 还是 App 另议）。
12. `level=passive` 等高级项、按通道的事件过滤、限流。

## 8. 验收

### 8.1 自动化

- `buildNotificationPayload` 不变，Bark 只消费它 → 现有测试不应改动。
- 新增通道测试：
  - 端点为空：不发请求，也不抛。
  - `channels.bark=false`：不进 `send`。
  - Bark 返回 HTTP 200 + `code:200`：成功。
  - Bark 返回 HTTP 200 + `code:400`：记失败、不抛。
  - `fetch` 超时/拒绝：记失败、不抛，其它端点仍继续（`Promise.allSettled`）。
  - 事件关闭（如 `events.stop=false`）：完成事件不发 Bark。
- 前端：设置保存后 `channels.bark` 不被丢弃（针对 §4.1 的回归测试）。

### 8.2 手工（必须有）

1. 自建 Bark + 真机 key：完成、失败、审批各触发一次，确认三条都到、文案正确。
2. 两台服务器各配一次，`group` 分别为 `CloudCLI · A/B`：确认通知中心分组正确、能整组静音。
3. 把 key 改错：确认测试按钮显示 Bark 的原始错误，正式推送只打日志、不影响 run。
4. 关闭 Bark 通道：确认不再收到，但 favicon/声音/桌面不受影响。
5. 自建 Bark：在**两台服务器上分别**点测试按钮，确认各自网络可达；不能只在 A 上测通就收工。

## 9. 拍板记录与剩余问题

### 9.1 已拍板（2026-10-18）

| # | 问题 | 决定 | 对方案的影响 |
| --- | --- | --- | --- |
| 1 | 多服务形态 | **2 台，可能含内网** | 采用 §5.4 的 A（每实例手工配置）；不做 env 方案；网络可达性按 §5.5 先确认 |
| 2 | Bark 部署 | **自建** | `serverUrl` 必填、不回落官方；先确认自建版本支持 `POST /push` |
| 3 | 前台是否抑制 | **不做** | 盯着 App 时也会收到 Bark；觉得吵就把 `level` 设为 `passive` |
| 4 | 同会话是否覆盖 | **不覆盖，保留全部** | 不使用 Bark `id`；审批与完成是两条独立通知，覆盖会丢信息 |
| 5 | 网络可达性 | **两台服务器均可直达 Bark** | 无需 Tailscale/反代/中继；§5.5 的后三行不触发 |
| 6 | Bark 地址与版本 | **运行时在设置里填写** | 不作为设计输入；`/push` 版本兼容由测试按钮暴露 |

第 4 条的理由：审批请求与完成通知可能落在同一会话上，用 `id` 让后者替换前者会把「需要你处理」的那条顶掉。长会话堆叠的问题先观察，真成问题时再按「同 code 才覆盖」加 `id`。

第 6 条的含义：服务器地址、device key、来源名称都从设置页读，不在代码里写死，也不用为了多服务引入环境变量。自建 `bark-server` 是否支持 `POST /push` 只影响那一台机器的实测结果，不改变方案结构。

### 9.2 仍需确认

1. **失败 favicon 是否改闪烁**：与 Bark 无关，是本次第一问的后续；不改就保持固定红叉。
2. **是否按通道区分事件**：v1 不做，Bark 继承全局 `events.*`。
3. **点击通知跳转**：v1 不做；要做需要先定跳 Safari 还是给 iOS 壳加 URL Scheme。

## 10. 审阅批注

> 本节留给其它 harness / 审阅者逐条批注；正文在批注后统一修订，批注原文保留。

### 10.1 待审阅的关键判断

| 编号 | 判断 | 依据 | 希望被挑战的点 |
| --- | --- | --- | --- |
| B-1 | 失败 favicon 固定不闪 | `favicon.ts:33-37`、`:102-105` | 是否有其它路径会重启闪烁（例如 appearance 切换、重复 raise） |
| B-2 | Bark 接入无需 DB 迁移 | `schema.ts:73-86`、`notification-preferences.ts:41-66` | 是否遗漏了某个把偏好写死的序列化路径 |
| B-3 | 多服务不会重复推送 | run 生命周期单进程驱动 | 是否存在「同一 provider session 被两个服务端同时 resume」的实际用法 |
| B-4 | 不做前台抑制 | iOS 后台 WS 宽限期不可控 | 是否有比 WS 更可靠的在线信号 |
| B-5 | v1 不重试 | 超时可能导致已投递 | 是否值得用 Bark `id` 换幂等重试 |
| B-6 | 配置按实例存放 | 已拍板 2 台；两台均可直达 Bark | 是否存在比手工 ×2 更省事、又不引入 relay 的分发方式 |

### 10.2 批注区

- （待填）
