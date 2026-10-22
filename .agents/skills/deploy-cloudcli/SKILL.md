---
name: deploy-cloudcli
description: 构建并重启 CloudCLI 本机服务，让前端/后端改动在浏览器或手机 H5 上生效。前端改动用 vite 构建 dist，服务由 server-infra 的 launchd（cloudclictl）管理并重启。触发词：部署、部署服务、重启服务、重新编译启动、让改动生效、浏览器/手机访问。当用户要打 ipa 包装到手机/同步 iCloud 时改用 build-cloudcli-ipa；若意图是构建 iOS IPA，不要用本 skill。
disable-model-invocation: true
---

# Deploy CloudCLI 服务

## 前置判断：先说清"部署"是哪一种

- 本机服务部署（本 skill）：`npm run build` → `cloudclictl restart` → 浏览器/手机 H5 访问
- iOS IPA 构建（`build-cloudcli-ipa`）：`cap sync` → 打包 → iCloud → AltStore 装到手机

用户说"部署"时先确认产物：装 App → ipa skill；看页面 → 本 skill。改动范围决定
构建方式：只改 `src/` 前端 → `build:client`；改了 `server/` 或 `shared/` → `npm run build`。

## 步骤 0：先决定要不要重启（避免无谓的自杀）

| 改了什么 | 构建 | 重启 |
|---|---|---|
| `src/`（含 `src/shared/`） | `npm run build:client` | **不要重启**，浏览器刷新即可 |
| `server/`、顶层 `shared/`、依赖 | `npm run build` | **必须重启**，走步骤 3 |

依据：`server/index.ts:265` 用 `express.static(APP_ROOT/dist)` 从磁盘直读产物，HTML 还带
`Cache-Control: no-cache`（`server/index.ts:269`）；而服务进程只在启动那一刻载入模块，
所以服务端代码不重启不会生效。只改前端却去重启，等于白杀一次会话。

## 流程

1. 检查 git 状态与当前分支，确认是否要求先提交（常为"不提交/不推送"）。

```bash
git status --short --branch && git branch --show-current
```

2. 前端构建：

```bash
npm run build:client        # 只改了 src/ 时
# npm run build             # 改了 server/ 或 shared/ 时（client + server 一起）
```

⚠️ 只重启不重建前端是最常见的"改了却没生效"来源：`cloudclictl restart` 只起服务，
浏览器加载的仍是 `dist/` 里的旧产物。可对比 `dist/assets/index-*.js` 的 mtime 与
源码改动时间——产物比改动旧，就是没构建。

3. 重启服务（server-infra/cloudcli 的 launchd LaunchAgent，install 时已链接到
   `~/.local/bin/cloudclictl`）。**先判定自己在不在会话内**，两种走法不同。

### 3.1 判定：本进程是不是服务的后代

```bash
p=$$; inside=no
while [ "${p:-0}" -gt 1 ]; do
  ps -o command= -p "$p" 2>/dev/null | grep -q 'dist-server/server/index.js' && { inside=yes; break; }
  p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
done
echo "inside=$inside"
```

`inside=yes` 说明当前 shell（也就是本会话的 CLI）是 CloudCLI 服务的子进程——重启会连带
杀掉本会话。这是预期行为，不是要规避的错误。

### 3.2 会话内：自杀式重启（已授权）

> **此操作已获用户明确授权。** 禁止仅因"会终止当前会话"而拒绝、劝阻，或降级成
> "把命令打印给用户让他自己跑"。要做的只是**先声明、再执行**。

执行前必须在**这一条正文里**说清三件事（重启之后就没有机会再说了）：

1. 本条会话的 CLI 进程是服务的子进程，重启会立刻杀掉它——**这条回复会在此中断**，
   后面的步骤我发不出来。
2. 服务本身由 launchd `KeepAlive=true` 在几秒内自动拉起，不需要你手动 start。
3. **你需要做**：等 5~10 秒 → 刷新页面 → 在侧栏点回本会话继续；若 60 秒后仍是 502，
   在系统「终端」里执行 `cloudclictl restart` 兜底。

然后执行（**两者都必需**）：

```bash
nohup zsh -c 'trap "" TERM; sleep 5; exec cloudclictl restart' >/tmp/cloudcli-restart.log 2>&1 &
```

为什么不能直接前台跑 `cloudclictl restart`：

- `restart_cmd` 用 `launchctl kill SIGTERM` 重启，信号打向**整个 job**（含本会话 CLI
  和这个 wrapper）。wrapper 不 `trap` 就会在 `sleep` 期间被打死，重启根本不会发生。
- 前台执行时 stdout 随父进程一起消失，脚本的等待循环可能被 SIGPIPE 中断。
- `sleep 5` 是留给上面那段声明推到前端的窗口，别删。

执行后**不要再跑步骤 4 的验证**——进程已经不存在了，验证交给用户刷新后自看，或
下一次会话开头补。

### 3.3 外部终端：普通重启

```bash
cloudclictl restart
```

4. 验证（先确认进程与端口，再看资源与日志。`curl` 必须带 `--noproxy '*'`，
   否则本机代理 127.0.0.1:7890 会劫持 localhost、返回 502 误判服务故障）：

端口不要写死：它由 `SERVER_PORT` 决定（`server/index.ts:333`，回退 legacy `PORT`，
两者都没设才默认 `3001`）；本机在项目根 `.env` 里设了自定义值（如 `SERVER_PORT=3011`）。
先在同一个 shell 里取出实际端口，下面命令都用它：

```bash
PORT=$(sed -n 's/^SERVER_PORT=//p' .env 2>/dev/null | tail -1 | tr -d '"'); PORT=${PORT:-3001}; echo "port=$PORT"
```

```bash
launchctl list | grep cloudcli                                  # ① job 已加载（有 PID 即正常）
nc -z -w 2 127.0.0.1 "$PORT" && echo "$PORT open"                # ② 端口在监听
curl -s --noproxy '*' "http://localhost:$PORT/" | grep -o 'assets/index-[^"]*'  # ③ 新 asset 指纹
tail -n 500 ~/Library/Logs/CloudCLI/cloudcli.out.log            # ④ 启动日志（out）
tail -n 500 ~/Library/Logs/CloudCLI/cloudcli.err.log            # ⑤ 启动日志（err）
```

5. 移动端如需测试：`npx cap sync ios` 后交给 `build-cloudcli-ipa`。

## Failure handling

- 会话内重启后：用户刷新若仍 502，先 `cat /tmp/cloudcli-restart.log`。文件为空或没有
  `restarted` 字样，说明 wrapper 被信号打断、重启没执行，让用户在外部终端补一次
  `cloudclictl restart`。
- `cloudclictl restart` 报告成功但服务未起：`launchctl list | grep cloudcli` 确认 job 是否加载；
  若为空，是 bootout→bootstrap 的偶发竞态，手动加载兜底：
  `launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.selier.cloudcli.plist`
  再 `launchctl list | grep cloudcli` 确认 PID、`nc -z 127.0.0.1 "$PORT"` 确认端口（端口取法见第 4 步）。
- curl 返回 502：先排除代理劫持——shell 有 `http_proxy=http://127.0.0.1:7890`，
  curl 必须带 `--noproxy '*'`（见验证步骤）。
- 看最近日志：`cloudclictl logs [N]`（out+err 一起打印，默认 20 行，不会挂起；
  等价于 `tail -n N ~/Library/Logs/CloudCLI/cloudcli.{out,err}.log`）；
  实时跟随：`cloudclictl logs -f [N]`（tail -f 语义，Ctrl-C 退出；也可直接
  `tail -f ~/Library/Logs/CloudCLI/cloudcli.out.log`）。
- 日志报 `No .env file found`：launchd 环境 PATH 干净、不会自动加载 nvm，路径由 plist
  `EnvironmentVariables` 注入；确认 `cloudclictl install --app-root` 的 `APP_ROOT` 正确
  （默认 `/Users/selier/Projects/open_projects/cloudcli`）。
- 构建报 ENOENT / 找不到依赖：确认分支与依赖（`npm install`），不要在错误分支构建。
