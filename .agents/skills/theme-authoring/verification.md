# 验证配方

用户 CSS 主题**没有任何守卫**（通道 A 的守卫只覆盖源码）。所以「文件写好了」不等于「它生效了」。
下面六步按成本排序，3 和 4 是主力手段。

命令里的引号一律用外层单引号、内层双引号，避免嵌套转义。
`npx tsx` 的输出要 `grep -v "UNDICI\|trace-warnings"` 滤掉噪声。

## 1. 过闸门

直接调服务端真实的扫描函数，别靠肉眼读正则：

```bash
cd /Users/selier/Projects/open_projects/cloudcli && npx tsx -e '
import { scanThemeFiles } from "./server/modules/themes/services/theme-files.service.ts";
import os from "node:os"; import path from "node:path";
console.log(JSON.stringify(await scanThemeFiles(path.join(os.homedir(), ".cloudcli/themes")), null, 2));
' 2>&1 | grep -v "UNDICI\|trace-warnings"
```

判据：你的主题出现在清单里，`bytes` 与磁盘文件一致。**没出现 = 被闸门 skip 了**，
原因看服务端 `console.warn`（每条都会写文件名和理由）。

顺手自查 `@import`（这条最容易在注释里踩到，见 SKILL.md）：

```bash
npx tsx -e '
import { containsImportAtRule as f } from "./src/shared/cssAtRules.ts";
import fs from "node:fs";
console.log(f(fs.readFileSync(process.env.HOME + "/.cloudcli/themes/<name>.css", "utf8")));
' 2>&1 | grep -v "UNDICI\|trace-warnings"
```

必须 `false`。若为 `true` 却仍出现在清单里，说明你看的不是同一个文件。

## 2. 令牌名自查

令牌名**拼错不报错**，只是那条规则静默失效。

```bash
cd /Users/selier/Projects/open_projects/cloudcli && python3 - <<'PY'
import re, os
raw = open(os.path.expanduser('~/.cloudcli/themes/<name>.css')).read()
theme = re.sub(r'/\*.*?\*/', '', raw, flags=re.S)   # 注释不生效，先剥掉再扫
css   = open('src/index.css').read()
declared = set(re.findall(r'(--[a-z0-9-]+)\s*:', theme))
known    = set(re.findall(r'(--[a-z0-9-]+)\s*:', css))
print('主题声明令牌数:', len(declared))
print('疑似拼错:', [d for d in declared if d not in known and not d.startswith('--<你的前缀>-')] or '无')
used = set(re.findall(r'var\((--[a-z0-9-]+)', theme))
print('var() 引用但未定义:', sorted(u for u in used if u not in known and u not in declared) or '无')
PY
```

（不剥注释的话，注释里的示意写法如 `hsl(var(--x))` 会被报成未定义。）

## 3. 免登录验证选择器（主力）

云端要登录，但仓库自带两个 **免鉴权** 的 fixture：

| fixture | 端口 | 画布 |
|---|---|---|
| `tests/transcript-layout/` | 4174 | **真聊天组件**（消息、气泡、代码块、工具行） |
| `tests/theme-tokens/` | 4175 | 令牌 / 主题展示页 |

### 启动（有个坑）

vite 在 stdin 关闭时会自退，所以要挂一个不结束的 stdin：

```bash
cd /Users/selier/Projects/open_projects/cloudcli
(tail -f /dev/null | npx vite --config tests/transcript-layout/vite.config.ts > /tmp/vite-fixture.log 2>&1 & echo $! > /tmp/vite-fixture.pid)
for i in $(seq 1 120); do c=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4174/); [ "$c" = 200 ] && break; sleep 0.5; done
echo "fixture → $c"
```

### 脚本骨架

playwright 要通过 `createRequire` 从仓库根解析（`node_modules/@playwright/test`）：

```js
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/Users/selier/Projects/open_projects/cloudcli/');
const { chromium } = require('playwright');

const CSS = readFileSync(process.env.HOME + '/.cloudcli/themes/<name>.css', 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:4174/', { waitUntil: 'load' });

// 真数据（fixture 自带控制器，action 见 fixture.tsx）
await page.waitForFunction(() => Boolean(window.__TRANSCRIPT_FIXTURE__));
await page.evaluate(async () => {
  await window.__TRANSCRIPT_FIXTURE__.dispatch({ action: 'seed-stable' });
  await window.__TRANSCRIPT_FIXTURE__.dispatch({ action: 'append-text', payload: '检查等宽的中文正文。' });
  await window.__TRANSCRIPT_FIXTURE__.dispatch({ action: 'append-tool' });
});
await page.waitForTimeout(800);

// 注入主题（模拟覆盖层追加到 <head>）
await page.evaluate((css) => {
  const s = document.createElement('style');
  s.textContent = css;
  document.head.appendChild(s);
}, CSS);

// 读数
const read = (sel, props) => page.evaluate(([s, ps]) => {
  const el = document.querySelector(s);
  if (!el) return 'NOT FOUND';
  const cs = getComputedStyle(el);
  return Object.fromEntries(ps.map((p) => [p, cs.getPropertyValue(p)]));
}, [sel, props]);

console.log(JSON.stringify(await read('html', ['--background', '--radius']), null, 2));
await page.screenshot({ path: '/tmp/theme-light.png' });
await browser.close();
```

其它可用 action：`append-thinking` / `seed-wrapping-samples` / `finalize-stream` /
`set-top-chrome` / `scroll-bottom` / `block-main-thread`（完整清单见 `fixture.tsx`）。

### 反例必须一起测

一个过宽的选择器在**只看正例**时完全正常。每次都要带上反例证明「不该命中的没被命中」：

| 反例 | 断言 |
|---|---|
| `class="… border-red-200 …"` | `border-right-color` 未被改动 |
| `class="… border-r-n-gray-900"` | `border-right-color` 未被改动 |
| 移动端抽屉（`fixed inset-0 flex`，无 `bg-background`） | 未被当成工作区壳 |
| 设置弹窗左栏（`flex-shrink-0 border-r`） | 未被当成侧栏卡片 |
| 状态圆点（`rounded-full bg-blue-500`） | 仍是圆的（只有 `bg-blue-600` 那个头像该被削方） |

### 断点也要测

`page.setViewportSize({ width: 420, height: 900 })` 重跑一遍，确认窄屏下几何改动归零
（与 `isMobile` 的 768 阈值对齐）。

## 4. 真引擎读最终颜色

两个 `<style>` 注入者同权重，靠**文档顺序**定胜负。jsdom 不做级联，所以这件事只能由
**真 chromium** 证明：改完顺序后读 `getComputedStyle` 的实际色值，不是读声明。

⚠️ 探针前先查令牌**是否已声明**。读未声明的令牌得到空串；把垃圾值塞进 `hsl()` 会落回
继承色 `rgb(0,0,0)`——看着像「黑色主题生效了」。发布值要合成成不透明 hex 再断言。

## 5. 对比度核算

动了颜色就要跑。复用仓库自己的算法（`src/shared/userThemeContrast.ts` 导出
`contrastRatioOfTriplets`）。**比值按 8 位通道取整算**——浏览器量的是取整后的值
（`--muted-foreground`/`--background` 取整 4.62、不取整 4.59）。与守卫不一致的警告比没有警告更糟。

```bash
cd /Users/selier/Projects/open_projects/cloudcli && npx tsx -e '
import { contrastRatioOfTriplets as R } from "./src/shared/userThemeContrast.ts";
const base = { 500: "220 8.9% 46.1%", 600: "215 13.8% 34.1%" };   // 出厂值
const mine = { 500: "155 10% 41.2%",  600: "155 12% 30%"   };     // 你的值
let bad = 0, worst = [0, ""];
for (const i of Object.keys(base)) for (const j of Object.keys(base)) {
  if (i === j) continue;
  const b = R(base[i], base[j]) ?? 0, m = R(mine[i], mine[j]) ?? 0;
  if (b >= 4.5 && m < 4.5) { bad += 1; console.log("AA 失守", i, "on", j, b.toFixed(2), "->", m.toFixed(2)); }
  if (m - b < worst[0]) worst = [m - b, i + " on " + j];
}
console.log("AA 由过转失守:", bad, "| 最大退化:", worst[1], worst[0].toFixed(2));
' 2>&1 | grep -v "UNDICI\|trace-warnings"
```

判据：**`AA 由过转失守` 必须是 0**。最大退化要报出来并解释为什么可接受
（发生在多大的余量上——在 7.93:1 的配对上退化 0.34 是 1.7 倍余量，无所谓）。

## 6. 收尾

```bash
kill "$(cat /tmp/vite-fixture.pid)" 2>/dev/null; sleep 1
lsof -nP -iTCP:4174 -sTCP:LISTEN   # 无输出＝已释放
git status --short                 # 必须干净：用户主题不在仓库里
ls -l ~/.cloudcli/themes/          # 交付物
```

## 一处诚实的边界

以上验证的是**外壳合成**（把逐字抄自源码的类名节点塞进 fixture 页）与**真组件的会话区**。
**登录后真机的逐屏观感**（终端、编辑器、设置弹窗、有编辑器侧栏分出第三列时）只能靠真机，
不能靠这套替代——report 里要把这条边界写出来。
