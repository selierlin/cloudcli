# AionUi 项目设计分析

> 分析日期：2026-08-29
> 仓库：`/Users/selier/Projects/open_projects/aionui`（分支 `main`，v2.2.0）
> 配套后端：AionCore（Rust），见 [aioncore-analysis.md](./aioncore-analysis.md)

## 1. 项目定位

AionUi 是一个**免费开源的 AI Cowork 桌面应用**（Electron），把内置 AI agent 和 Claude Code、Codex、Qwen Code、Cursor、Gemini CLI 等几十种外部 CLI agent 统一到一个界面里，并通过 WebUI / Telegram / 飞书 / 钉钉 / 微信远程访问，支持 cron 定时任务 7×24 无人值守运行。

产品特性概览：

- 内置 agent 引擎（零配置，粘贴 API key 即用）
- 多 agent 统一接入（ACP 协议）+ Team 多 agent 协作模式
- WebUI 远程访问 + 聊天平台机器人（Telegram/Lark/DingTalk/WeChat）
- 定时任务（cron，三种调度模式，会话绑定）
- 21 个内置专业助手（PPT/Word/Excel 生成等）+ 三层技能体系
- 文件预览面板（PDF/Office/代码/Markdown/图片/Diff 等 10+ 格式）

## 2. 技术栈

| 层 | 选型 |
|---|---|
| 桌面壳 | Electron 37 + electron-vite 5 |
| 前端 | React 19 + Arco Design + UnoCSS + i18next + SWR |
| 编辑器 | CodeMirror（代码编辑）、Monaco（预览） |
| 数据 | better-sqlite3（仅遗留迁移用，生产库在 AionCore） |
| 协议 | ACP（Agent Client Protocol）+ MCP（Model Context Protocol） |
| 包管理 | npm workspaces（`packages/*`），锁文件 `bun.lock` |
| 构建 | electron-vite + electron-builder + Sentry |

## 3. 顶层目录结构

```
aionui/
├── package.json            # workspace 根，aioncoreVersion 固定 "v0.2.0"
├── scripts/                # 构建/工具脚本
│   ├── webui.ts            # bun run webui —— 无 Electron 启动 WebUI
│   ├── prepareAioncore.js  # 从 GitHub Releases 下载 aioncore 二进制
│   └── build-mcp-servers.js# 编译内置 MCP server（esbuild）
├── packages/
│   ├── desktop/            # Electron 主应用
│   ├── web-host/           # @aionui/web-host —— 无 Electron 拉起后端 + 静态服务器
│   ├── web-cli/            # @aionui/web-cli —— 独立 aionui-web 命令（bun 编译）
│   └── shared-scripts/     # 构建辅助
├── docs/  tests/  resources/  public/  patches/  homebrew/
```

## 4. 真实架构（重要）

> ⚠️ **关键结论**：AionUi 虽然是个 Electron 仓库，但**真正的业务后端是独立的 Rust 二进制 `aioncore`**（来自 AionCore 仓库，版本固定在根 `package.json` 的 `aioncoreVersion`）。
>
> 因此：**Electron 主进程 + React 渲染层 = 薄客户端**。Agent 引擎（ACP）、HTTP 服务、SQLite 数据库、bot、cron 全部在 Rust 侧。TS 渲染层通过 HTTP REST + WebSocket 调 aioncore 完成几乎所有业务。
>
> 另外注意：仓库内 `AGENTS.md` 和 `.claude/skills/architecture/` 文档描述的是**迁移前旧架构**（`process/agent/`、`channels/`、`webserver/`、`worker/` 等目录），这些目录当前代码里**已不存在**，文档未跟上迁移。

### 4.1 数据流总览

```
Electron 主进程 (TS 薄壳) ──spawn──▶ aioncore (Rust 二进制)
   · 窗口/托盘/单实例/自动更新             · HTTP API (axum)
   · 拉起并管理 aioncore 子进程            · ACP Agent 引擎 ──▶ Claude Code / Codex /
   · 注入 window.__backendPort            · SQLite 数据库      Qwen / Cursor / Gemini…
                                         · Bot / Cron
                ▲
                │ HTTP REST /api/* + WebSocket /ws
                │
         React 渲染层 (SPA)
   ipcBridge ──▶ httpGet/Post → aioncore REST
            └──▶ wsEmitter → aioncore WS 事件 (message.stream 等)
            └──▶ bridge.buildProvider → 原生 IPC (窗口/对话框/更新/主题)
```

### 4.2 进程模型

| 层 | 位置 | 职责 | 禁止 |
|---|---|---|---|
| **Main** | `packages/desktop/src/process/` + `src/index.ts` | 窗口生命周期、单实例锁、托盘、deep-link、自动更新、桌宠、**拉起并管理 aioncore 子进程** | DOM/React |
| **Preload** | `packages/desktop/src/preload/main.ts` | `contextBridge` 暴露 `electronAPI.emit/on`（单一通道 `ADAPTER_BRIDGE_EVENT_KEY`）、注入 `window.__backendPort` 等 | Node 业务 API |
| **Renderer** | `packages/desktop/src/renderer/` | React UI，通过 `ipcBridge`（HTTP/WS）或 `bridge`（原生 IPC）取数 | Node API |
| **Common** | `packages/desktop/src/common/` | 跨进程类型 + 适配器层（`adapter/`）+ 传输无关事件总线 | — |

## 5. 通信机制（核心）

底层是 `common/platform/bridge.ts` 的**传输无关事件总线**（基于 EventEmitter3），Electron 和浏览器 WebUI 共用同一套桥。业务 API 面集中在 `common/adapter/ipcBridge.ts`（约 2500 行），分三类：

| 类型 | 路径 | 用途 |
|---|---|---|
| **HTTP REST → aioncore** | `common/adapter/httpBridge.ts` | 会话、assistants、providers、MCP、cron、fs、skills、agents、webui、settings、projects、remote-agents |
| **WebSocket 事件** | `wsEmitter/wsMappedEmitter` | `message.stream`、`conversation.listChanged`、`confirmation.add`、`cron.job-*`、`turn.completed` |
| **原生 IPC** | `bridge.buildProvider` | 窗口控制、原生对话框、自动更新、主题、托盘、通知、桌宠、deep-link、CDP |

三种运行形态下的端口解析：

- **Electron 渲染层**：读 `window.__backendPort`（preload 注入）
- **WebUI 浏览器**：走同源反代，`getBaseUrl()` 返回 `''`
- **主进程**：读 `globalThis.__backendPort`

## 6. 主进程薄壳（packages/desktop/src/process/）

实际只剩 8 个薄层子目录：

```
process/
├── backend/    # aioncore 二进制解析（binaryResolver）
├── bridge/     # 原生 IPC handlers（窗口/对话框/更新/主题/托盘）
├── startup/    # backend 启动编排、损坏 DB 恢复、单实例门控
├── services/   # 自动更新/i18n/skills/遗留数据库驱动
├── resources/builtinMcp/  # 内置 MCP server（browserServer/cdpBridge/imageGen）
├── pet/        # 桌宠系统
├── feedback/   # 反馈
└── utils/      # 窗口、托盘、deep-link、CDP、GPU 恢复
```

内置 MCP server 是独立 Node 进程（`browserServer.ts`、`cdpBridge.ts`、`imageGenServer.ts`），由 `scripts/build-mcp-servers.js` 打包；浏览器控制走 CDP 单目标通道。

## 7. 渲染层（React 19）

- **入口**：`renderer/main.tsx` → `BackendStartupGate`（starting/failure/app 三态）→ `AppProviders`（SWRConfig[`revalidateOnFocus:false`] → Auth → Theme → Preview → Feedback）→ `Config`（Arco ConfigProvider，按语言 locale + RTL）→ `Router`
- **路由**：`components/layout/Router.tsx`（HashRouter + `React.lazy` 分包）：`/guid`、`/conversation/:id`、`/team/:id`、`/login`、`/settings/{...}`、`/scheduled`、`/test/components`
- **页面模块**：
  - `pages/conversation/`：`Messages/`（消息列表、ACP 工具卡片 `MessageAcpToolCall.tsx`、权限面板、思维展示）、`GroupedHistory/`、`Preview/`（文件预览）、`PlanBar/`
  - `pages/settings/`、`pages/cron/ScheduledTasksPage`、`pages/team/`、`pages/guid/`、`pages/login/`
- **状态管理**：React Context（Auth/Theme/Conversation/Preview/Feedback/Layout）+ SWR + WebSocket 事件推送（关掉 focus 重取，靠 WS 保持新鲜）
- **UI 规范**：Arco Design 组件 + `@icon-park/react` 图标 + UnoCSS 原子类 + CSS Modules + 语义色 token（`uno.config.ts`）；新文案必须走 i18n

## 8. workspace 包

| 包 | 作用 | 关键文件 |
|---|---|---|
| **`@aionui/web-host`** | 拉起 aioncore 子进程 + SPA 静态服务器 + `/api`、`/ws` 反代；**无 Electron 依赖** | `src/backend-launcher.ts`（BackendLifecycleManager：spawn/健康检查/崩溃重启，60s 窗口最多 3 次）、`src/static-server.ts`（Node 原生 http + serve-handler，**不是 Express**） |
| **`@aionui/web-cli`** | 独立 Web 运行时 `aionui-web` 命令（bun 编译单文件），`start` / `resetpass` | `bin/aionui-web.js`、`src/index.ts` |
| **`@aionui/shared-scripts`** | 从 GitHub AionCore Releases 下载二进制、校验打包资源 | `src/prepare-aioncore.js` |

WebUI 三种启动方式：`bun run webui`（scripts/webui.ts）、独立命令 `aionui-web`、Electron `--webui` 标志（复用已启动的 backend）。

## 9. 数据层

- **生产库**：aioncore 管理的 SQLite（Rust），macOS 数据目录 `~/Library/Application Support/AionUi-Dev/aionui`（用 `~/.aionui-dev` 符号链接指向，避免空格破坏 CLI 命令）
- TS 渲染层**不直接碰 DB**，全走 aioncore REST（`ipcBridge.database` → `/api/conversations/{id}/messages`）
- TS 侧 `process/services/database/` 是**遗留代码**，只做一次性 v26 旧库迁移交接 + 损坏恢复（`repairLegacyHandoffSchema.ts`）

## 10. 与 AionCore 的关系

| AionUi（TS 薄壳） | AionCore（Rust 后端） |
|---|---|
| `common/adapter/ipcBridge.ts` HTTP 面 | `/api/*` 端点（各 crate `routes.rs`） |
| WS 事件监听 | `/ws` 单一端点 + `BroadcastEventBus` |
| Agent 管理 UI（/api/agents/*） | `aionui-ai-agent` crate（ACP 引擎） |
| cron 页面 | `aionui-cron` crate |
| 渠道配置 | `aionui-channel` crate（feature-gated 插件） |

## 11. 关键文件速查

| 目的 | 路径 |
|---|---|
| 主进程入口 | `packages/desktop/src/index.ts` |
| Preload 桥 | `packages/desktop/src/preload/main.ts` |
| 业务 API 面 | `packages/desktop/src/common/adapter/ipcBridge.ts` |
| HTTP 桥 | `packages/desktop/src/common/adapter/httpBridge.ts` |
| 事件总线抽象 | `packages/desktop/src/common/platform/bridge.ts` |
| WebUI 后端拉起 | `packages/web-host/src/backend-launcher.ts` |
| 静态服务器/反代 | `packages/web-host/src/static-server.ts` |
| 渲染入口 | `packages/desktop/src/renderer/main.tsx` |
| ACP 工具卡片渲染 | `packages/desktop/src/renderer/pages/conversation/Messages/acp/MessageAcpToolCall.tsx` |

## 12. 工程规范（AGENTS.md）

- 目录 ≤10 个直接子项；组件 PascalCase / 工具 camelCase / 样式 kebab-case
- 硬性 blocker：进程边界违规、TS 报错、测试失败、i18n 缺失、裸交互 HTML
- 工具链：`oxlint` + `oxfmt` + Vitest（覆盖率目标 ≥80%）
- 提交走 Conventional Commit，禁止 AI 签名
