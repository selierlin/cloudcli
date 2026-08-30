---
name: deploy-cloudcli
description: 构建并重启 CloudCLI 本机服务，让前端/后端改动在浏览器或手机 H5 上生效。前端改动用 vite 构建 dist，服务由 server-infra 的 launchd（cloudclictl）管理并重启。触发词：部署、部署服务、重启服务、重新编译启动、让改动生效、浏览器/手机访问。当用户要打 ipa 包装到手机/同步 iCloud 时改用 build-cloudcli-ipa；若意图是构建 iOS IPA，不要用本 skill。
---

# Deploy CloudCLI 服务

## 前置判断：先说清"部署"是哪一种

- 本机服务部署（本 skill）：`npm run build` → `cloudclictl restart` → 浏览器/手机 H5 访问
- iOS IPA 构建（`build-cloudcli-ipa`）：`cap sync` → 打包 → iCloud → AltStore 装到手机

用户说"部署"时先确认产物：装 App → ipa skill；看页面 → 本 skill。改动范围决定
构建方式：只改 `src/` 前端 → `build:client`；改了 `server/` 或 `shared/` → `npm run build`。

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

3. 重启服务（server-infra/cloudcli 的 launchd LaunchAgent，install 时已链接到
   `~/.local/bin/cloudclictl`）：

```bash
cloudclictl restart
```

4. 验证（先确认进程与端口，再看资源与日志。`curl` 必须带 `--noproxy '*'`，
   否则本机代理 127.0.0.1:7890 会劫持 localhost、返回 502 误判服务故障）：

```bash
launchctl list | grep cloudcli                                  # ① job 已加载（有 PID 即正常）
nc -z -w 2 127.0.0.1 3001 && echo "3001 open"                   # ② 端口在监听
curl -s --noproxy '*' http://localhost:3001/ | grep -o 'assets/index-[^"]*'  # ③ 新 asset 指纹
tail -n 500 ~/Library/Logs/CloudCLI/cloudcli.out.log            # ④ 启动日志（out）
tail -n 500 ~/Library/Logs/CloudCLI/cloudcli.err.log            # ⑤ 启动日志（err）
```

5. 移动端如需测试：`npx cap sync ios` 后交给 `build-cloudcli-ipa`。

## Failure handling

- `cloudclictl restart` 报告成功但服务未起：`launchctl list | grep cloudcli` 确认 job 是否加载；
  若为空，是 bootout→bootstrap 的偶发竞态，手动加载兜底：
  `launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.selier.cloudcli.plist`
  再 `launchctl list | grep cloudcli` 确认 PID、`nc -z 127.0.0.1 3001` 确认端口。
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
