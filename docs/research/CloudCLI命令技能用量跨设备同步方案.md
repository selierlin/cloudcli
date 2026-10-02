# CloudCLI 命令与技能用量跨设备同步方案

> 状态：**第 1 轮批注已处置：10 条全部属实并采纳，无一条驳回；正文已按处置回写，逐条见文末「作者回应（第 1 轮）」**
> 范围：前端（`src/`）。服务端、i18n、主题令牌**均零改动**
> 关联文档：无。本文自包含，审阅无需先读其他文档
> 起因：聊天界面命令/技能菜单的"常用"记录目前只存浏览器 `localStorage`，换设备即丢失

---

## 0. 结论先行

把命令/技能的用量计数从「按项目的 localStorage 键」改为「**全局一份、存进用户偏好**」，一次成片。

三条关键判断：

1. **键改用技能名，不用项目标识。** 技能名由技能文件自身派生（frontmatter / 目录名），**跨设备稳定**；而 `projectId` 是本机 `randomUUID()`，**跨设备不稳定** —— 这是本方案能成立的根因，也是"按项目隔离 + 跨设备同步"这个组合此前不成立的原因（§1.3）。
2. **"项目里没有的技能不显示"不需要写代码。** 现有两处消费点都在**当前项目扫描出的命令列表**上操作，历史里躺着别的项目的技能名也进不来（§3.4）。这是一条**隐式契约**，必须用断言钉住 —— 这是本方案唯一新增的守卫。
3. **不做数据迁移。** 迁移买到的只是"先升级那台设备的老历史"，而这份数据只影响排序前 5；不做的实现成本为零（§4.1）。**同步能力不受影响** —— 新键从零开始照样跨设备累积。

**决策项共 5 条，均已由用户拍板**，集中列在 §8。

---

## 1. 现状排查

### 1.1 已有资产（可复用）

| 资产 | 位置 | 本方案如何用 |
| --- | --- | --- |
| 用量读写在三个消费点 | `src/modules/chat/hooks/useSlashCommands.ts:37-55`（`getCommandHistoryKey` / `readCommandHistory` / `saveCommandHistory`） | **整体替换**，三个调用点共 5 处引用 |
| 消费者一：列表排序 | 同文件 `:213-218`，按 `parsedHistory[command.name]` 降序 | 改成读偏好键 |
| 消费者二：常用分组 | 同文件 `:247-262`，从 `slashCommands` 派生、取前 5 | 改成读偏好键 + 增减版本号依赖 |
| 消费者三：点选累加 | 同文件 `:264-275`，`:347` 无条件调用 | 改成写偏好键 |
| **偏好通道** | `src/shared/userSettings.ts`：`readUserPreference`（`:227`，同步读内存镜像）/ `writeUserPreference`（`:233`，写镜像 + 400ms 防抖 PATCH） | **本方案的核心复用点**：同步、防抖、登出清理、跨标签事件全部现成 |
| 偏好白名单 | 同文件 `UserPreferences`（`:22-69`）+ `LEGACY_STORAGE_KEYS`（`:94-136`） | 新增一个键照抄 |
| **偏好变更订阅先例** | `src/modules/chat/hooks/useChatProviderState.ts:516-519`：`window.addEventListener(USER_PREFERENCES_CHANGED_EVENT, …)` + `setXxxRevision(r => r + 1)` | **同目录同构先例**，直接照抄 |
| 服务端偏好表 | `server/modules/database/schema.ts:203-212`，`PK(user_id, preference_key)`，`preference_value` 为 JSON | **任意 key-value，服务端零改动** |
| 测试模板 | `src/modules/chat/tests/useInputHistory.test.ts:32-45`（`renderHook` + `localStorage.clear()`，测的就是同类"历史"hook） | 新测试照抄 |

### 1.2 缺口

1. **用量不跨设备**：存在 `localStorage['command_history_<projectId>']`，键见 `useSlashCommands.ts:37`（形参名写作 `projectName`，实参传的是 `projectId`，`:213/252/270/272`）。
2. **换设备/清缓存即清零**，且**不随账号同步**。

### 1.3 一个必须先说清的前提：`projectId` 不跨设备

`projectId` 是**每台设备各自生成的随机 UUID**：

- `server/modules/database/repositories/projects.db.ts:23` —— `const attemptedId = randomUUID();`
- `server/modules/database/schema.ts:89-97` —— `project_id TEXT PRIMARY KEY NOT NULL`

同一个项目目录，在两台设备上注册得到的是**两个不同的 `projectId`**；同一台机器上删掉再加也是新 id（无 id 复用）。因此：

> **"按 projectId 隔离"与"跨设备同步"在当前的键上是互相打架的。** 云端会堆着一批没有任何设备能认领的记录。

这不是要放弃"按项目"这个诉求，而是说明**"按项目"不能落在 `projectId` 这个键上**。本方案的做法是：**根本不在键里编码项目**，把"项目归属"这件事完全交给展示层的候选列表（§3.4）。

---

## 2. 设计目标与非目标

### 2.1 目标

- **G1**：命令/技能用量随账号跨设备同步。
- **G2**：键跨设备稳定，不依赖任何本机生成物。
- **G3**：项目级技能**不会**在自己不在的项目里露出（"依据项目有这个才显示"）。
- **G4**：零新增服务端接口、零新增存储通道。

### 2.2 非目标（明确不做，理由见 §4）

- 数据迁移（把老 `command_history_*` 搬上云）。
- 跨设备冲突合并（merge-max / 累加）。
- 按技能作用域（`user` / `project` / `plugin`）拆分存储。
- 用量过期、上限裁剪、按项目维度的任何统计。

---

## 3. 设计方案

### 3.1 数据形状与键的选型

```ts
// user_preferences 里的一个新键
commandUsage: Record<string, number>   // { "/review": 7, "/dsh:foo": 2 }
```

键 = `SlashCommand.name`。对技能而言它就是 `skill.command`，由 `skills.provider.ts:107-109` 生成：`${commandPrefix}${definition.name}`，`definition.name` 来自技能 markdown 自身的 frontmatter（plugin 技能则是 `/${pluginName}:${name}`，`claude-skills.provider.ts:208,255`，`pluginName` 读自 `plugin.json`）。

**全是从文件内容派生的，不含任何本机路径或设备信息** —— 这就是它相对 `projectId` 的实质优势。

值 = 非负整数计数。不做上限、不做清理。

### 3.2 存储通道：复用 `user_preferences`

**选它的理由**（对照备选"仿 `chatDrafts` 另开一条 project-scoped 通道"）：

- 服务端**零改动**（`schema.ts:203-212` 本来就是任意 key-value，白名单只活在前端）。
- 现成拿到：400ms 写防抖（`:84`）、登出清理（`resetUserPreferences`，`:459-476`）、跨标签 `storage` 事件、以及 `preferences` 整体进 localStorage 镜像 —— 意味着**首屏同步读自动获得**，不需要另做快速路径。
- 同族先例：`quickReplies` 就是一个 blob 存在偏好里（`:65`、`:130`）。

**改动两处**（`src/shared/userSettings.ts`）：

1. `UserPreferences` 加 `commandUsage: Record<string, number>`（`:22-69`）。
2. `LEGACY_STORAGE_KEYS` 加 `commandUsage: ''`（`:94-136`）。

> **第 2 条是必填项，但理由与初稿写的不一样（实施期更正）。** 初稿写"漏了这个条目，`hydrateUserPreferences` 就不会遍历它、`commandUsage` 永远不会被 hydrate，同步彻底失效" —— **实测不成立**。`hydrateUserPreferences` 收尾是整体采纳服务端副本（`:439` 的 `preferences = { ...serverPreferences, ...migrated }`），`PREFERENCE_KEYS` 只喂**迁移循环**（`:423`），而 `commandUsage` 的 legacy 键是空串、本就不迁移。把该键从 `PREFERENCE_KEYS` 里剔除（变异）后，本方案的同步用例全部照旧全绿。
>
> 真正强制它存在的是**类型**：`LEGACY_STORAGE_KEYS` 声明为 `Record<UserPreferenceKey, string>`（`:94`），少一个键就编译不过。所以"必填"由编译器保证，不由运行期语义保证。空串哨兵的含义仍是"没有单一 legacy 来源" —— 与 `quickReplies: ''`（`:130`）同一写法。

### 3.3 消费侧改造（`src/modules/chat/hooks/useSlashCommands.ts`）

1. 删 `getCommandHistoryKey` / `readCommandHistory` / `saveCommandHistory`（`:37-55`），并删掉随之成为孤儿的 `safeLocalStorage` 导入（`:5`）。
2. 读：`:213`、`:252` 改为 `readUserPreference('commandUsage', EMPTY_COMMAND_USAGE)`（**模块级空对象常量**，不是 `{}` 字面量 —— 理由见下）。
3. 写：`:264-275` 改为 `writeUserPreference('commandUsage', next)`，不再传 `projectId`。

   **硬性要求：必须先拷贝再改。** `readUserPreference` 返回的是 `preferences` 里那个**对象本体**，不是拷贝（`:227-231`）；而 `writeUserPreference` 开头就是 `JSON.stringify(preferences[key]) === JSON.stringify(value)` 相等即早退（`:234-236`）。旧路径每次 `getItem` 都从 JSON 字符串重新 parse 出新对象，所以"读→改→存"天然安全；**把这个模式原样移植到新路径就会静默丢计数** —— 改的是本体，写入时两边 stringify 相等 → 早退，不落镜像、不进 PATCH 队列、不派发事件，只有内存里那个对象"碰巧"有值，还要等下一次无关的偏好写入才被 `writeMirror` 带出去。唯一正确写法：

   ```ts
   const next = { ...readUserPreference('commandUsage', EMPTY_COMMAND_USAGE) };
   next[command.name] = (next[command.name] ?? 0) + 1;
   writeUserPreference('commandUsage', next);
   ```
4. `!selectedProject` 的两处守卫（`:248`、`:266`）保留 —— 没选项目时不该计数。
5. **新增偏好变更订阅**（下述）。

**为什么必须订阅 —— 以及为什么只在 `frequentCommands` 上加依赖：**

`readUserPreference` 读的是内存镜像，而 hydrate 是**登录后异步**完成的。`frequentCommands` 的 memo 依赖是 `[selectedProject, slashCommands]`（`:262`），hydrate 落地时两者都没变 → **memo 不会重算**，换设备首用会看到空的"常用"，直到切一次项目。

**订阅走仓库主流 API `subscribeToUserPreferences`（`userSettings.ts:278-284`），不用裸 window 事件。**

10 处生产消费者全走前者：ThemeContext（`:343`）、UiPreferencesContext（`:56`）、useQuickReplies（`:27`）、useSidebarController（`:197`）、useSelectedProvider（`:17`）、useCodeEditorSettings（`:20`）、TasksSettingsContext（`:79`）、i18n config（`config.ts:336`）、useThemePasteFormat（`:41`）、userThemePastes（`:149`）；裸 `USER_PREFERENCES_CHANGED_EVENT` 只有 `useChatProviderState.ts:516-519` 一处。两者语义等价（`notifyListeners` 既回调 listeners 也派发事件），但订阅 API 自带退订函数、是既有接缝，新增第二种订阅姿势没有收益。

**读法照 `useThemePasteFormat.ts:41` 的 `useSyncExternalStore` 先例**（比手写 revision state 更省）：

```ts
const commandUsage = useSyncExternalStore(
  subscribeToUserPreferences,
  () => readUserPreference('commandUsage', EMPTY_COMMAND_USAGE),
);
```

**快照必须引用稳定**，所以 fallback 用**模块级常量** `EMPTY_COMMAND_USAGE`，不能写 `{}` 字面量：键未设置时 `readUserPreference` 直接返回 fallback，每次新建对象会让 `getSnapshot` 恒返回新引用、触发无限重渲染。已设置时返回的是 `preferences.commandUsage` 本体，只在真写入时换引用（`:238`），天然稳定。`commandUsage` 因此可以直接进 `frequentCommands` 的 memo 依赖，**不需要手写 revision 计数器**。

**排序 effect（`:213-218`）刻意不加这个依赖。** 加了会让 fetch effect 重跑，**连带重新拉一次 commands 与 skills 的网络请求** —— 为了刷新"非常用分组内部的排序"付一次网络往返，不划算。代价见 §5。

### 3.4 "项目里没有的技能不显示" —— 靠现状，并把它钉住

现有两处消费点**都已经在当前项目的命令列表上操作**：

- 排序：`:213-218`，从 `allCommands`（= `api.commands.list(workspacePath)` + `api.providers.skills(workspacePath)`）里取 `parsedHistory[command.name]`；
- 常用分组：`:247-262`，`slashCommands.map(…).filter(usageCount > 0)`，输入就是当前项目扫描出的技能。

技能列表本就随 `workspacePath` 不同而不同（`skills.provider.ts:95-128` 按 `getSkillSources(workspacePath)` 扫目录：claude 的项目级是 `<workspace>/.claude/skills`，`claude-skills.provider.ts:94-98`）。**所以历史里就算躺着别的项目的技能名，也进不了候选列表。**

> **这是一条隐式契约**：它靠"输入来自当前项目扫描"成立，不是一层显式的白名单。哪天有人把 `frequentCommands` 的数据源改成"直接从全局历史列前 5"，就会漏出别的项目的技能。**必须用断言钉住**（§7）—— 这是本方案唯一新增的守卫。

菜单分组顺序 `frequent → project → user → skill → builtin → other` 见 `CommandMenu.tsx:235-237`；`frequent` 组跨 namespace（`useSlashCommands.ts:247-262` 不过滤 namespace），项目级与用户级技能混排 —— 这是刻意如此。

**渲染层还有第二道网（记入，防止被当成冗余"简化"掉）。** 除 hook 层"从当前项目扫描列表派生"外，`CommandMenu` 会把每条 frequent 行按 `getCommandKey`（`name::namespace::path`，`CommandMenu.tsx:84-85`）回映进 `commands`：`getFrequentCommandIndex`（`:198-204`）找不到匹配时 `commandIndex` 为 -1，`:224-234` 的 `.filter(row => row.commandIndex >= 0)` 就把它从渲染里丢掉。即便 hook 契约将来被破坏，外来技能名今天也漏不出来。**断言仍钉在 hook**（它是唯一数据源，钉在那里才有预警意义），但 `:224-234` 这道兜底 filter **不得删除**。

---

## 4. 明确不做（被否方案与理由）

### 4.1 不做数据迁移

**否掉的形态**：新函数 `readLegacyCommandUsage()`，遍历所有 `command_history_*` 键合并成一个 map，接进 `hydrateUserPreferences` 的特判链（`:409-415` 的写法）。

**理由**：

1. **它买到的只是"先升级那台设备的老历史"。** 迁移闸门是"服务端还没有这个键才跑"（`:405-407`），所以第一台设备写成功后，**其他设备永久跳过迁移**，各自的本机历史都迁不上来。为一个只影响排序前 5 的字段，换来"A 有历史、B 没有"的**不一致观感**，未必更好。
2. **同步能力不受它影响。** 新键从零开始照样跨设备累积：设备 A 用 3 次 → 写进 `commandUsage` → 同步 → 设备 B hydrate 拉到 → B 也有。**迁移是"历史搬运"，不是"同步能力"。**
3. **不做的成本是零。** `LEGACY_STORAGE_KEYS.commandUsage` 设空串且**不加特判分支**，则 `readLegacyPreference` 在 `:293-296` 因 `storageKey` 为空串直接 `return undefined` → 迁移自动是空操作。
4. **写它要付一串真实的坑**（均已在讨论中核出）：累加式迁移**不幂等**（回推失败 + 登出重登会重复累加，计数翻倍）；"迁移后清旧键"会在回推失败的窗口里永久丢数据，且仓库**从不清理 legacy 键**（全文件只有 `:471` 删镜像键）；无旧键时必须返回 `undefined` 而非 `{}`，否则会往服务端写一个空 map、**导致所有其他设备永久跳过迁移**。不写它，这一串全部作废。

### 4.2 不做 merge-max

跨设备冲突沿用现有"**服务端赢、整键替换**"（`:439`）。

merge-max 能挽回的只是"极端时序下的 1 次计数"，代价却是往通用 `hydrateUserPreferences` 的整键替换逻辑里开一个**单消费者特判洞**。按仓库既有口径「两条来源只差一步就用一条缝，不给通用通道开洞」，**不值得**。将来若确有需要，作为独立小片加。

> 注意 §4.1 里提到的"迁移函数内部用 max 保证幂等"是**另一回事**：它只活在迁移函数内部，不碰通用通道 —— 但既然迁移本身不做了，这条也随之作废。

### 4.3 不按作用域拆分存储

曾考虑"只同步 `user` 级技能、`project` 级保持本地"。这个切分在技术上成立（项目级技能只在该项目出现），但**没必要**：既然键是技能名、展示层天然按项目过滤，`project` 级历史同步过来也**只会被它自己那个项目看见**，不会污染别的项目 —— 唯一的副作用是同名合并（§5），而拆分并不能消除它（同名仍会在 `user` 与 `project` 之间撞）。拆分的收益为零，分支却多出一条。

### 4.4 不用 `projectId`（也不改用 `project_path`）做键

`projectId` 的问题见 §1.3。`project_path`（`schema.ts:89-97` 里是 UNIQUE）看似是跨设备候选，但路径同样不稳：换用户名、换挂载点、Docker 内路径都不同。**任何本机环境的派生值都不适合做这个键**，而技能名是技能文件本身的一部分。

---

## 5. 已知限制与记账

| 限制 | 影响 | 性质 |
| --- | --- | --- |
| 同名技能跨项目/跨作用域**共享计数** | 项目 A 用出来的次数会让项目 B 的同名技能也排进常用。**仅排序偏移**，不会显示不该显示的技能 | 契约级语义变化 |
| "常用"语义从"我在**这个项目**里常用"变为"我**在任何地方**用过这个技能名的总用量" | 同上，需写进文档 | 契约级语义变化 |
| **非常用分组内部的排序**在 hydrate 后不立即更新（§3.3 刻意不给 fetch effect 加订阅依赖） | 切一次项目即恢复。常用组本身是准的（它有自己的 sort，`:260`） | 权衡取舍 |
| **hydrate 会吞掉预 hydrate 的点选，且分三种分支** | 见 §5.1 —— 三种分支丢失程度不同，第三种最彻底 | 沿既有偏好行为，非本方案新引入 |
| **同设备多标签并发也会丢计数** | `:491-499` 的 `storage` handler 在收到对端写入时 `preferences = readMirror()`（`:496`）＋ `pendingServerWrites = {}`（`:497`）。本标签刚点、还没 PATCH 出去的计数直接蒸发。`commandUsage` 是第一个**高频 read-modify-write 整键**的偏好（其余都是低频设置），暴露面比其余偏好大 | 沿既有机制，非本方案新引入 |
| **点选会实时重排菜单（行为变化）** | `writeUserPreference` → `notifyListeners`（`:241` → `:187`）→ 订阅回调 → `frequentCommands` 重算。现状（localStorage 路径）点选后菜单内顺序不动；新路径下菜单开着时每点一次，常用组顺序/成员立即变化。**大概率是改进**（顺带修了现状"点选后计数不立即反映"的迟滞），但用户可感知 | 行为变化，§7.1 用测试固化预期 |
| **点选会 fan-out 到全部偏好订阅者** | 多数订阅者状态不变会 bailout，但 `useChatProviderState.ts:515` 的 `setDshPreferenceRevision(r => r + 1)` **无条件递增** → 每次点选都重渲染聊天提供者状态子树。点选本身通常伴随重渲染（关菜单/插入输入），边际成本小 | 偏好写入从低频设置变成高频操作的固定代价；若将来点选卡顿，先查这个无条件递增 |
| **`commandUsage` 自身的死键残留** | 技能改名、卸载插件（`/plugin:name` 键）、内置命令改名后，旧键**永久残留在服务端，并随每次 PATCH/GET 全量同步到所有设备** —— 比老的 `command_history_*`（只困在本机）更广。键数量级通常几十，无实害 | 与"非目标：用量裁剪"是两回事（那是用量上限，这是死键清理），未来可作独立小片 |
| **同步可能静默失效** | `user.service.ts:41` 的注释写着 "preference keys are fixed"，与实际"任意 key-value"（`user-preferences.db.ts:76` 直接 stringify 入库）不符。将来服务端若真收紧成白名单，本方案的 PATCH 400 会被 `userSettings.ts:203-209` 的 catch **静默吞掉**，只剩一行 `console.error`，现象是"同步悄悄不工作了" | §7.3 加一步把静默失效变成可发现的 |
| 升级后"常用"清零一次 | 需重新积累几次 | **有意为之**（§4.1） |
| 老的 `command_history_*` 键留着不管 | 几 KB 僵尸数据 | 与仓库既有做法一致（从不清理 legacy 键） |
| 多设备并发仍是 LWW | 极端时序丢计数 | §4.2 |

### 5.1 hydrate 吞掉预 hydrate 点选：三种分支

`hydrateUserPreferences` 的收尾（`:435-439`）在三种情况下行为不同：

1. **服务端没有该键**（首装设备首次使用）：`:435-437` 无键可删 → pending 留存 → 400ms 后 flush 到服务端 ✓；但 `:439` 的 `preferences = { ...serverPreferences, ...migrated }` 不含该键 → **内存与镜像里消失**，显示为空，直到下次 hydrate 才回来。**最终收敛。**
2. **服务端已有该键**（**日常使用的每台非首装设备，每天都在**）：`:435-437` 把 pending 里的 `commandUsage` **删掉**（服务端赢），`:439` 再整体覆盖内存与镜像 → 那次点选**既不 flush 也不留在任何地方**，比分支 1 更彻底，且没有"下次 hydrate 回来"的收敛。
3. **未登录**：`hydrateUserPreferences` 根本不跑（只在 `AuthContext.tsx:147` 有会话时调）。写入只进镜像；`savePreferences` 会 401，被 `:203-209` 静默 catch。登录后的首次 hydrate 走分支 1 或 2 → **这次是真的丢**。

共同点：三者都是"预先存在的值被服务端副本整体取代"这个既有语义的结果，不是本方案新引入 —— 但 `commandUsage` 是第一个"每次交互都写"的偏好，**命中频率远高于其余偏好**。窗口都很小（hydrate 在登录后立刻发起）。处置是记账而非修：修法要给通用 hydrate 开洞，与 §4.2 否掉 merge-max 是同一条理由。

---

## 6. 改动清单

| 文件 | 改动 |
| --- | --- |
| `src/shared/userSettings.ts` | `UserPreferences` 加 `commandUsage: Record<string, number>`；`LEGACY_STORAGE_KEYS` 加 `commandUsage: ''`。**无其他改动** |
| `src/modules/chat/hooks/useSlashCommands.ts` | 删三个旧函数与 `safeLocalStorage` 导入；写入改为"**先拷贝再改**"（§3.3 第 3 条）；读取经 `useSyncExternalStore(subscribeToUserPreferences, …)`，含模块级 `EMPTY_COMMAND_USAGE` |
| `src/modules/chat/tests/commandUsageSync.test.ts` | **新增**（§7） |
| 服务端 | **零改动** |
| i18n | **零改动**（文案不变） |
| `src/shared/tests/userSettings.test.ts` | **零改动**（无迁移逻辑可测） |

---

## 7. 验证方式

### 7.1 新增测试（`src/modules/chat/tests/commandUsageSync.test.ts`）

照 `useInputHistory.test.ts:32-45` 的 `renderHook` 模板：

1. **展示过滤（承重）**：喂一份含"当前项目没有的技能名"的 `commandUsage` → 断言 `frequentCommands` **不含**它。
   - 顺手加一条"排序后 `slashCommands` 长度不变"的断言（`sort` 只重排、不引入新元素），一句话成本，把排序点（`:213-218`）也一并钉住。
   - 变异测试：把 `frequentCommands` 的数据源改成"直接从全局历史列前 5" → 本条必须**红**。这是证明"那条隐式契约真的被钉住"的唯一方式。
2. **点选后计数落盘**：**必须打真实 store**（真的走 `writeUserPreference`），并断言三件事——`readUserPreference` 读回的值、localStorage 镜像、以及跨过防抖后的 PATCH 载荷。
   - **必须是"同一命令连点两次"**，只点一次测不出这个坑（见「实施期更正」第 2 条）：判等早退只在**该键已存在**时才可能触发，首次写入时 `preferences[key]` 还是 `undefined`，原地改也照样写得进去。承重的断言是镜像与 PATCH 载荷那两条 —— `readUserPreference` 那条在被测代码原地改时**仍会通过**（内存里那个对象确实被改成了新值），正是这个坑"看起来正常"的表现。
   - **不得 mock `writeUserPreference`** —— §3.3 第 3 条那个"改本体 → 判等早退"的坑，mock 掉就测不出来，而那正是它唯一能被暴露的地方。
3. hydrate 完成后常用列表刷新（覆盖 §3.3 那个坑）。
4. **固化"点选实时重排"的预期**（§5）：点选后 `frequentCommands` 立即反映新计数 —— 写成断言，否则将来有人按"点选不该动菜单"的旧印象把它当回归"修"掉。

### 7.2 回归

- `server/` 零改动 ⇒ 按仓库既有口径「树同 ⇒ 红集同」可跳过 A/B，但仍跑 `npm test` + `test:client` 对照基线。
- `npm run lint` 0 error、`npm run build` exit 0。
- 门禁须含 `npm run typecheck`（`build` 走 vite/esbuild，**不校验客户端类型**）。

### 7.3 真机

1. 清掉 localStorage 后重新登录，确认"常用"从服务端拉回。
2. **开发者工具确认 `savePreferences` 返回 200，且 GET 能拉回 `commandUsage`** —— 把 §5 那条"服务端将来收紧白名单导致静默失效"变成可发现的（否则现象只是"同步悄悄不工作了"，`userSettings.ts:203-209` 的 catch 只留一行 `console.error`）。

---

## 8. 决策项（均已由用户拍板）

| # | 决策 | 结论 | 依据 |
| --- | --- | --- | --- |
| D1 | 键用什么 | **技能名**，不在键里编码项目 | §1.3：`projectId` 不跨设备 |
| D2 | 是否仍"按项目" | **是**，但由展示层保证，不由键保证 | §3.4 |
| D3 | 是否迁移老数据 | **不迁移** | §4.1 |
| D4 | 跨设备冲突策略 | **沿用服务端赢（LWW）**，不做 merge-max | §4.2 |
| D5 | 存储通道 | **复用 `user_preferences`** | §3.2 |

**无遗留待拍板项。** 第 1 轮批注未产生新的待拍板项（10 条均为技术处置，逐条见文末「作者回应（第 1 轮）」）。

---

## 审阅批注

### Claude

> [!WARNING] 潜在风险：同设备多标签页并发丢计数的面比 §5 记账的大
> §5 只记了"多设备并发 LWW"，但 `commandUsage` 是第一个**高频 read-modify-write 整键**的偏好（其余偏好都是低频设置）。同一浏览器开两个 CloudCLI 标签时，两个标签各持一份 `preferences` 内存快照，各自"读-改-写"整键，后写覆盖先写；且 `userSettings.ts:491-499` 的 storage 事件处理会在对端写入时把本标签 `pendingServerWrites` 清空（`:497`），本标签刚点、还没 PATCH 出去的计数直接蒸发。建议 §5 表格补一行"同设备多标签并发同样丢计数"，或明确确认可接受。

> [!WARNING] 潜在风险：§5 的 hydrate 记账漏了"服务端已有该键 + hydrate 前点选"分支
> §5 只写了"服务端无该键"（flush 到服务端、最终收敛）和"未登录"（真丢）两个分支。还有第三种：**服务端已有 `commandUsage`**（即日常使用的每台非首装设备），此时 `hydrateUserPreferences` 的 `:435-437` 会把 pendingServerWrites 里的 `commandUsage` **删掉**（服务端赢），`:439` 整体覆盖内存与镜像 —— hydrate 前那次点选**既不 flush 也不留在任何地方**，比"无该键"分支丢得更彻底、且无"下次 hydrate 才回来"的收敛。窗口小（登录后 hydrate 完成前），但每天都在。建议补进 §5 那一行。

> [!TIP] 建议：断言可顺带钉住排序点，一句话成本
> §3.4 的隐式契约，排序点（`:213-218`）天然安全——`sort` 只重排 `allCommands`，不引入新元素；承重风险确实只在 `frequentCommands`。但 §7.1 测试 1 顺手加一条"排序后 `slashCommands` 长度不变"的断言，能把两个消费点都钉住，成本一行。

> [!TIP] 建议：7.3 真机步骤补一条"确认 PATCH 返回 200"
> "服务端零改动"已核实成立（`user.service.ts:61-78` 只校验键长，无键白名单；`user-preferences.db.ts:76` 直接 stringify 入库）。但两点值得留意识别：① `user.service.ts:41` 注释写着 "preference keys are fixed"，与"任意 key-value"的实际行为有出入，将来服务端若真收紧成白名单，本方案的 PATCH 400 会被 `userSettings.ts:203-209` 的 catch **静默吞掉**（只剩 console.error），现象就是"同步悄悄失效"；② 7.3 建议明确加一步"开发者工具确认 `savePreferences` 返回 200 且 GET 拉回 `commandUsage`"，把静默失效变成可发现的。

> [!NOTE] 补充说明：点选实时重排是一个未记账的行为变化
> `writeUserPreference` 会 `notifyListeners`（`userSettings.ts:241` → `:187` 派发事件），§3.3 的 revision 随之 +1 → `frequentCommands` 重算。现状（localStorage 路径）点选后菜单内顺序不动；新路径下**菜单开着时每点一次，常用组顺序/成员立即抖动**。大概率是改进（也顺带修了现状"点选后计数不立即反映"的迟滞），但属于用户可感知的行为变化，建议补进 §5 并在测试里固化预期。

> [!NOTE] 补充说明：`commandUsage` 自身的死键残留与 §5 最后一行是两回事
> §5 记账了老的 `command_history_*` 僵尸键，但没记新键自己的：技能改名、卸载插件（`/plugin:name` 键）、内置命令改名后，旧键**永久残留在服务端并随每次 PATCH/GET 全量同步到所有设备**——比老键（只困在本机）更广。键数量级通常几十，无实害，但建议在 §5 补一行，与"非目标：用量裁剪"区分开（那是用量上限，这是死键清理，未来可作独立小片）。

### Pi

> [!WARNING] 潜在风险：`readUserPreference` 返回的是活引用，"读-改-写"不先拷贝会静默丢计数
> `readUserPreference`（`userSettings.ts:227-231`）直接返回 `preferences` 里存的对象本体，不拷贝；而 `writeUserPreference`（`:233-241`）先做 `JSON.stringify(preferences[key]) === JSON.stringify(value)` 判等、相等即早退。旧 localStorage 路径每次 `getItem` 都从 JSON 字符串重新 parse 出新对象，"读→改→存"天然安全；新路径下把这个模式原样移植（先 `parsedHistory[command.name] = …` 再把同一引用或其拷贝写回），两者 stringify 必然相等 → 写入被静默跳过：不落镜像、不进 PATCH 队列、不派发事件，revision 不动、UI 不重排，只有内存里被顺手改掉的对象"碰巧"有值，还要等下一次无关的偏好写入才被 `writeMirror` 带出去。唯一正确顺序是**先拷贝再改**：`const next = { ...readUserPreference('commandUsage', {}) }` 后只动 `next`。建议把这条硬性要求写进 §3.3 第 3 条，且 §7.1 测试 2 必须打真实 store（断言 `readUserPreference` 的值并推进防抖计时器看 PATCH），mock 掉 `writeUserPreference` 就测不出这个坑。

> [!TIP] 建议：订阅先例选 `subscribeToUserPreferences`，而不是裸 window 事件
> 文档钉的先例是 `useChatProviderState.ts:516-519` 的 `window.addEventListener(USER_PREFERENCES_CHANGED_EVENT)`，但仓库主流约定是 `subscribeToUserPreferences(listener)`（`userSettings.ts:278-284`）：ThemeContext、UiPreferencesContext、useQuickReplies、useSidebarController、useSelectedProvider、useCodeEditorSettings、TasksSettingsContext、i18n config、useThemePasteFormat、userThemePastes 共 10 处全走这个 API，走裸事件的只有 useChatProviderState 一处。两者语义等价（`notifyListeners` 既回调 listeners 也派发事件），但订阅 API 自带退订函数、是既有接缝，建议照多数派写，新增第二种订阅姿势没有收益。

> [!NOTE] 补充说明：每次点选现在会 fan-out 到全部偏好订阅者，其中一个无条件 setState
> 命令点选变成偏好写入后，`notifyListeners` 会通知所有订阅者：多数能靠状态不变 bailout（`useChatProviderState` 的 setProviderModels/setProviderEfforts 不变时返回 previous），但 `setDshPreferenceRevision((r) => r + 1)`（`useChatProviderState.ts:515`）无条件递增 → 每次点选都重渲染聊天提供者状态子树。点选本身通常伴随重渲染（关菜单/插入输入），边际成本小，但这是"偏好写入"从低频设置变成高频操作后的固定代价，建议 §5 记一笔；若将来出现点选卡顿，先查这个无条件递增。

> [!NOTE] 补充说明：§3.4 的契约今天其实有两层网，渲染层还有一道兜底过滤
> 除 hook 层"从当前项目扫描列表派生"外，CommandMenu 还会把每条 frequent 行按 `getCommandKey`（`name::namespace::path`，`CommandMenu.tsx:84-85`）回映进 `commands`：`getFrequentCommandIndex`（`:198-204`）找不到匹配时 `commandIndex` 为 -1，`CommandMenu.tsx:224-234` 的 `.filter(row => row.commandIndex >= 0)` 会把它从渲染中丢掉。也就是说即便 hook 契约将来被破坏，外来技能名今天也漏不出来。钉断言的位置选在 hook（唯一数据源）没问题，但建议把这道兜底记进 §3.4，并防止将来有人把 `:224-234` 的 filter 当冗余"简化"掉。

---

## 作者回应（第 1 轮）

> 2026-10-01，作者对两位审阅者共 10 条批注逐条核验后作答。核验方式：**每条对照当前源码实证** —— `subscribeToUserPreferences` 的消费者用全仓 grep 计数并逐条对行号、storage handler 逐行读、`readUserPreference` / `writeUserPreference` 的返回指针与判等逻辑逐行读、`CommandMenu` 的 filter 链逐行读，不依赖审阅者转述。
>
> **结论先行：10 条全部属实并采纳，无一条驳回。** 其中 1 条（Pi-1）是**致命级** —— 它指出旧路径的安全前提（每次 `getItem` 都 parse 出新对象）在新路径下不成立，照搬会**静默丢计数而 UI 看起来正常**；2 条是初稿的实质疏漏或选型偏差：Claude-2（§5 的 hydrate 记账**漏写了一种分支**，且漏的那一种恰恰是最常见的）、Pi-2（订阅引用了非主流先例 —— 仓库 10 处走 `subscribeToUserPreferences`、裸事件仅 1 处）。

**编号说明**：`C*` 属 Claude，`Pi-*` 属 Pi。它们与 §8 的决策项编号（`D1`～`D5`）是**两套独立编号**。

### 逐条处置

**C1 同设备多标签并发 —— 采纳（§5 补行）。**
已核实 `userSettings.ts:491-499`：对端写入触发本标签 `storage` handler → `preferences = readMirror()`（`:496`）＋ `pendingServerWrites = {}`（`:497`）。同意"面比原记账大"：`commandUsage` 是第一个高频整键读改写偏好，两标签同开时暴露面显著高于其余低频设置。已补进 §5 表格。

**C2 hydrate 第三分支 —— 采纳（原记账确实漏了，且漏的是最常见的一种）。**
初稿 §5 只写了"服务端无该键"与"未登录"，把**服务端已有该键**这一支（每天都会命中的日常设备）漏掉了，而它恰恰丢失最彻底（`:435-437` 删 pending ＋ `:439` 覆盖，既不 flush 也不留任何痕迹）。已改写为 §5.1 的三分支专段。

**C3 断言顺带钉住排序点 —— 采纳。**
`sort` 只重排、不引入新元素，判断正确，承重风险确实只在 `frequentCommands`。§7.1 测试 1 已加"排序后 `slashCommands` 长度不变"。

**C4 PATCH 200 ＋ `user.service.ts:41` 注释与行为不符 —— 采纳。**
§7.3 已加第 2 步；§5 已补"同步可能静默失效"一行，点名 `user.service.ts:41` 的注释措辞与服务端实际行为（`user-preferences.db.ts:76` 直接 stringify 入库）的出入。

**C5 点选实时重排 —— 采纳（补 §5 ＋ §7.1 固化）。**
机制正确：`writeUserPreference` → `notifyListeners`（`:241` → `:187`）→ 重算。已列为"行为变化"，并在 §7.1 加第 4 条测试固化预期（防将来被当回归"修"掉）。

**C6 `commandUsage` 自身死键残留 —— 采纳（§5 补行）。**
与"老的 `command_history_*` 僵尸键"确实是两回事（一个困在本机，一个随 PATCH/GET 全量同步到所有设备）。已按建议与"非目标：用量裁剪"区分开。

**Pi-1 `readUserPreference` 活引用 —— 采纳（本片最重要的一条）。**
已逐行核实两条前提都成立：`readUserPreference`（`:227-231`）返回 `preferences[key]` 本体；`writeUserPreference`（`:234-236`）相等即早退。二者叠加的后果与批注描述一致，且**尤其危险在它不报错** —— 内存里那个对象被改过，"看起来有值"，只是没落盘，要等下一次无关的偏好写入才被 `writeMirror` 带出去。§3.3 第 3 条已改写为硬性要求并给出正确写法；§7.1 测试 2 已明确"必须打真实 store、不得 mock `writeUserPreference`"。

**Pi-2 订阅 API 选主流 —— 采纳（并顺势升级为 `useSyncExternalStore`）。**
已 grep 核实 10 处生产消费者全部走 `subscribeToUserPreferences`，裸事件仅 `useChatProviderState.ts:516-519` 一处。§3.3 已改为该 API；同时指出 `useThemePasteFormat.ts:41` 已用 `useSyncExternalStore(subscribeToUserPreferences, …)`，本片照此可**省掉手写 revision state**。附带约束：快照必须引用稳定，故 fallback 必须是模块级常量 `EMPTY_COMMAND_USAGE`。

**Pi-3 点选 fan-out ＋ `setDshPreferenceRevision` 无条件递增 —— 采纳（§5 补行）。**
已核实 `useChatProviderState.ts:515` 的确无条件递增。已记账，并注明"若将来点选卡顿，先查这个无条件递增"。

**Pi-4 渲染层第二道网 —— 采纳（记入 §3.4）。**
已核实 `CommandMenu.tsx:84-85` 的 `getCommandKey`、`:198-204` 的 `getFrequentCommandIndex`、`:224-234` 的 filter 链。§3.4 已补该段，并明确"断言仍钉在 hook，但兜底 filter 不得删除"。

### 作者自查（审阅未点出）

1. **§3.3 原有的"fallback 不能进依赖"与 Pi-2 的建议合流后，约束更强了。** 初稿把它写成"revision 计数器的理由"（属于性能权衡）；改用 `useSyncExternalStore` 后，它变成 `getSnapshot` 必须返回稳定引用 —— **同一个约束，但这次是硬性的**：违反的症状是无限重渲染，不是性能退化。两条已合并成一段。

### 实施期更正（审阅未点出）

1. **§3.2 对"`LEGACY_STORAGE_KEYS` 条目为什么必填"的说明是错的。** 更正与依据见 §3.2 注。一句话：`PREFERENCE_KEYS` 只影响迁移循环，而 `commandUsage` 不迁移；条目必填是**类型**（`Record<UserPreferenceKey, string>`）强制的。变异验证：从 `PREFERENCE_KEYS` 剔除该键后，同步用例仍全绿。
2. **§7.1 测试 2 的夹具原本表达不出它要测的那个坑。** 初稿写"点选一次、断言落盘"。但 `writeUserPreference` 的判等早退只在**该键已存在**时才可能触发 —— 键未设置时 `readUserPreference` 返回的是 `EMPTY_COMMAND_USAGE` 常量而非 `preferences[key]`，原地改也照样写得进去。变异验证：把写入改成原地改（不拷贝），"点选一次"那版**照样全绿**。改成**连点两次**后，原地改版本精确报红（镜像停在 1、PATCH 载荷停在 1）。
