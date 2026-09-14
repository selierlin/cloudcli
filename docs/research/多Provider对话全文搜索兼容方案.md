# 多 Provider 对话全文搜索兼容方案（审批草案）

**状态：** 待复审；已根据多 Harness 审阅意见修订，本文不包含代码改动。
**目标：** 让侧边栏“对话”搜索在明确的可检索内容范围内，找出**所有**包含关键词的历史会话；结果可以分页展示，但不得因展示或命中上限遗漏会话。保持现有 Claude/Codex、归档会话与搜索跳转行为不回归。

## 1. 背景与已确认问题

当前 `GET /api/providers/search/sessions` 的标题搜索读取所有 session 行；正文搜索则只支持 Claude 和 Codex。正文搜索服务把 Provider 类型和白名单固定为 `claude | codex`，其他会话在进入文件筛选前被跳过。

这会产生一个容易误解的结果：同一会话可按标题搜索到，却无法按正文关键词搜索到。归档不是根因；归档会话已被纳入候选集，但 WorkBuddy、Cursor、Pi、DSH、OpenCode 没有正文搜索适配器。

已复现的 WorkBuddy 归档会话中，原始记录含 `AxiosResponseResult`，但搜索 `AxiosResponse` 没有结果。

## 2. 范围与非目标

### 范围

- Provider：Claude、Codex、Cursor、WorkBuddy、Pi、DSH、OpenCode。
- 主入口：侧边栏的“对话”搜索；保留现有 SSE 进度、标题结果优先、归档标记、恢复与删除交互。
- 搜索对象（建议默认）：用户文本、助手正文、可展示的工具结果文本。工具输入、系统注入、隐式上下文、二进制附件和已脱敏/加密内容不搜索。
- 支持活跃会话与 CloudCLI 已归档会话。
- “全量”定义为：本次搜索成功完成时，每一个在上述范围内含关键词的可读 session 都出现在结果集合中；每个 session 的片段数量可以受 UI 分页限制，但 session 本身不可因上限省略。

### 非目标

- 不为原始 transcript 建立永久全文索引或迁移数据库。
- 不搜索工具输入、系统注入、隐式上下文、二进制附件、加密 reasoning 或已标注脱敏的值；工具结果是否可搜取决于其是否以文本形式展示给用户。
- 不解决 Provider 自身已删除、损坏或无法读取的历史记录。

## 3. 设计原则与不变量

1. **搜索可见语义，而不是原始文件。** 只有最终会展示给用户的 user/assistant 文本与可展示工具结果文本可进入命中结果；这避免系统提示、工具密钥和内部事件泄露到侧边栏。
2. **Provider 负责解码，编排层不理解私有格式。** JSONL、Zstd、SQLite 的读取细节不能散落在统一服务中。
3. **先廉价筛选，再精确解析。** JSONL 默认用 ripgrep 粗筛；DSH 用流式解压；OpenCode 用 SQLite 查询。粗筛必须是 over-approximation；遇到 JSON 转义敏感查询时，JSONL Provider 必须退化为精确解析，不能漏会话。
4. **发现与展示分离。** 搜索完成前不得以全局命中上限停止 session 发现；UI 的分页、单 session 片段上限和响应体大小都不得改变“哪些 session 命中”的事实。
5. **归档只是 session 属性。** Adapter 不得因为 `isArchived` 跳过 session；归档徽标由统一层生成。
6. **失败隔离且状态诚实。** 单会话损坏、单个 SQLite 行不可解析或单个 Zstd 文件损坏，只跳过该 session，不中断其他项目和 Provider；搜索响应必须标记 `complete` / `cancelled` / `partial`，不得把部分结果称为全量结果。
7. **确定性结果。** Adapter 不得共享、递增全局命中计数；无论并发调度如何，最终结果必须按稳定键排序后再分页，SSE 进度不承诺结果顺序。

## 4. Provider 存储盘点

| Provider | 历史来源 | 首选候选筛选 | 精确文本提取 | 适配复杂度 |
| --- | --- | --- | --- | --- |
| Claude | JSONL | `rg --fixed-strings` | 现有 Claude message/summary 规则 | 已支持，迁入新契约 |
| Codex | JSONL | `rg --fixed-strings` | 现有可见 user/assistant/reasoning 规则 | 已支持，迁入新契约 |
| WorkBuddy | JSONL | `rg --fixed-strings` | `message.content` 的 `input_text` / `output_text`；user 文本经 `extractUserPrompt` 去除注入上下文 | 第一优先级 |
| Cursor | 每工作区 `store.db`（SQLite blob DAG）；`jsonl_path` 仅为索引元数据 | 先按 session 归一化 blob 扫描；仅在真实 schema 验证后才引入 SQL 粗筛 | 复用 `normalizeCursorBlobs` 的可见文本映射 | 第三优先级 |
| Pi | JSONL（分支树） | `rg --fixed-strings` | 只读取当前叶子对应分支的可见消息，不能把废弃分支混入结果 | 第二优先级 |
| DSH | Zstd 压缩 JSONL | 流式解压并逐行检查 | 复用 DSH 日志解码与消息归一化规则 | 第三优先级 |
| OpenCode | 共享 SQLite | SQL 按 session 查询已验证的消息字段 | 复用 OpenCode 历史归一化；`part` 表仅在真实 schema 证实后使用 | 第三优先级 |

OpenCode 的 session 行刻意没有 `jsonl_path`，因为多个会话共用 `opencode.db`；Cursor 的 `jsonl_path` 是会话索引元数据而非正文来源；DSH 则必须先解压。因此三者不能复用文件版 ripgrep 预筛。

## 5. 目标架构

```text
HTTP/SSE 路由
    ↓
ConversationSearchService（统一编排）
    ├─ 标题/ID 搜索（现有 DB 查询，所有 Provider）
    ├─ 聚合 active + archived session，并计算项目/归档元数据
    ├─ 按 provider 分组，调用 ProviderConversationSearchAdapter
    ├─ 统一限额、取消、排序、snippet/highlight 与 SSE progress
    ↓
ProviderConversationSearchAdapter（每个 Provider）
    ├─ selectCandidates(sessions, query, signal) // 可选的低成本粗筛，按来源粒度返回候选
    └─ inspectSession(session, matcher, signal)  // 精确解析，返回命中与摘要
```

### 5.1 建议的内部契约

以下为内部 TypeScript 接口草图，不作为跨模块 API 直接暴露：

```ts
type SearchableConversationSession = {
  sessionId: string;
  providerSessionId: string | null;
  provider: LLMProvider;
  projectPath: string | null;
  transcriptPath: string | null; // 文件型 Provider 的正文来源；Cursor 中仅为索引元数据，不得用于正文搜索
  customName: string | null;
  isArchived: boolean;
};

type SearchCandidate =
  | { kind: 'session'; sessionId: string }
  | { kind: 'transcript'; transcriptPath: string; sessionIds: string[] };

type ConversationSearchMatch = {
  role: 'user' | 'assistant';
  text: string;
  timestamp: string | null;
};

type SessionSearchInspection = {
  sessionId: string;
  sessionSummary: string;
  firstMatch: ConversationSearchMatch | null;
  sourceVersion: string | null; // 文件 stat 或 DB 数据版本；用于识别搜索期间变更
  status: 'matched' | 'not_matched' | 'unreadable' | 'changed_during_search';
};

interface ProviderConversationSearchAdapter {
  readonly provider: LLMProvider;
  selectCandidates?(
    sessions: SearchableConversationSession[],
    rawQuery: string,
    words: string[],
    signal: AbortSignal,
  ): Promise<SearchCandidate[]>;
  inspectSession(
    session: SearchableConversationSession,
    context: ConversationSearchContext,
  ): Promise<SessionSearchInspection>;
}
```

统一层保有 `ConversationSearchContext`：现有 matcher、`buildSnippet`、取消状态和可检索文本规范化函数。Adapter 产出完整可见文本、稳定摘要与一次 session 检查结论；统一层才判断是否命中、生成 snippet/highlight、映射归档/项目字段并在稳定排序后分页。这样不会让不同 Provider 产生不一致的关键词语义。

`SearchCandidate` 必须表达**真实来源粒度**：Claude 等一个文件可能承载多个 provider session，因此 JSONL 粗筛返回 transcript 及其 session 集合，再由精确解析按 provider session id 归位；OpenCode 返回 session 级候选。候选归一化也必须按 Provider 分流：文件型 Provider 验证 transcript 路径；OpenCode 验证非空 `providerSessionId`，不得再要求 `jsonl_path`。

### 5.2 与既有历史读取器的关系

优先抽取 Provider 历史读取器已验证的“原始事件 → 可见文本”函数，而不是复制一份解析器。若历史读取器直接返回完整 `NormalizedMessage[]`，搜索 adapter 可以复用其事件归一化的私有 helper，但不得通过 `fetchHistory(limit: null)` 无上限地构造完整 UI 消息数组。Claude 的 compact summary / pending summary 与 Codex 的最新用户文本摘要必须由各自 adapter 产出，不能由命中片段反推。

原因：搜索只需要文本、角色、时间和稳定摘要；构造工具卡片、图片 data URL 与 Todo 状态会增加不必要的 CPU、内存和敏感数据暴露面。搜索与聊天跳转共用文本规范化函数：snippet 必须能在最终渲染文本中定位；跨行文本不得只在一侧被替换为空格。

## 6. 执行流程与效率方案

### 6.1 JSONL Provider（Claude、Codex、WorkBuddy、Pi）

1. 按现有行为把 query 分成词；单词逐个 `rg --files-with-matches --fixed-strings --ignore-case`，多词取文件交集。
2. 只流式读取粗筛命中的 transcript。
3. Adapter 逐行 JSON 解析并提取可见文本；统一 matcher 做最终短语和词边界校验。
4. 每个候选 session 在找到首条命中后可停止读取该 session，但所有候选 session 都必须完成检查；不得在达到全局展示上限后停止。
5. 当 query 含 JSON 转义敏感字符（引号、反斜杠或控制字符）或文件被 ripgrep 二进制探测跳过时，禁用该文件的粗筛，直接流式精确解析，避免假阴性。

Pi 例外：粗筛可命中整份文件，但精确解析必须沿当前分支回溯，避免已分叉且不在当前会话历史中的文本出现在结果中。

### 6.2 DSH（Zstd JSONL）

不尝试对压缩文件调用 ripgrep。Adapter 按 session 解压并逐行处理；找到首条命中后可停止消费，但必须继续检查其他候选 session。首期不并发解压多个文件：由统一并发池限制为 1 个 DSH 解压任务，以避免输入搜索时 CPU 峰值。损坏文件用例仅验证“跳过 + 结构化日志 + 不中断其他 session”，不承诺修复损坏文件。

可选优化（不在首期）：以文件 `mtime + size` 为 key 缓存最近一次解压后的轻量文本块，采用小容量 LRU，并在文件变更时失效。

### 6.3 SQLite Provider（OpenCode、Cursor）

OpenCode 不扫描数据库文件，也不把 `opencode.db` 当作某一 session 的 transcript。Adapter 以只读连接查询指定 session 的消息数据，只选取可能含用户/助手正文或可展示工具结果的字段；解析 JSON 后做同一套精确 matcher。Phase 2 必须先用真实 `opencode.db` 验证 schema：现有历史读取器只读 `message` 表，`part` 表是否存在以及工具结果是否在其中均不得假定。查询必须按 provider-native session id 限定，且连接在 `finally` 关闭。

Cursor 不得读取其 `jsonl_path` 作为聊天正文。Adapter 按 `providerSessionId + projectPath` 定位会话 `store.db`，复用 Cursor 历史读取器的 blob DAG 归一化与 session 归位逻辑；首期按 session 扫描已归一化的 blob，确保不漏。只有真实 schema 与基准数据证明安全时，才对 blob 数据加入 SQL 粗筛。

首期不引入 SQLite FTS：OpenCode schema 由外部工具拥有，创建索引会修改第三方数据库，且需要处理迁移/锁竞争。先用按 session 的顺序扫描取得正确性；性能数据不足时再评估本地派生索引。

### 6.4 统一资源边界

搜索发现与传输采用两阶段协议：

1. 服务端先完成所有候选 session 的检查，生成稳定排序的**完整命中 session 集合**；SSE 期间只推送标题结果和 `scanned / total / failed` 进度，不能把并发完成顺序当成最终结果顺序。
2. 完成事件带 `completionStatus`、`matchedSessionCount`、`failedSessionCount` 和首个结果页。后续页面通过 cursor 读取同一搜索快照；页面大小只限制响应体，不限制发现结果。
3. 搜索被取消或源在检查期间变更时，状态为 `cancelled` 或 `partial`，UI 必须显示“结果不完整”，并不得显示全量计数。静态来源上的 `complete` 才能宣称全量。

资源边界如下：

- 不再用“默认 50 / 最大 200 命中”终止扫描；这些值改为单页最多展示的 session 数，或由新的 `pageSize` 取代。
- 每个命中 session 至少保存 1 个可跳转片段；额外片段可按页面需要延迟计算，不影响其是否被计入命中 session。
- JSONL ripgrep 文件块大小为 40、并发为 6；迁移后这些参数只用于 JSONL adapter。
- 最多 4 个 session 精确解析任务可以并发，但 adapter 之间不得共享可变的全局计数；统一层只在全部 inspection 结束后按 `project → session 最近活动时间 → sessionId` 的稳定键排序和分页。DSH 同时最多 1 个。
- `scannedProjects` 的含义固定为“该项目的全部候选 session 已检查且已合并”；SSE progress 必须单调递增。
- 搜索快照只保存轻量 session id、摘要、首个 snippet 与来源版本，使用小容量 TTL LRU；缓存逐出只影响翻页（客户端收到“请重新搜索”），不得把旧快照伪装为最新完整结果。
- 任何 `AbortSignal` 取消后不再发送后续 SSE project result 或完成事件。

首期应加入耗时/错误结构化日志（Provider、候选 session 数、粗筛命中数、精确命中数、耗时），不得记录 query 原文或消息正文。

## 7. 分期交付

### Phase 0：框架迁移与不回归

- 建立 adapter registry 与统一编排层。
- 将现有 Claude/Codex 逻辑迁入 adapter，结果快照与现有测试保持一致。
- 增加 registry 完整性测试：已注册且具备历史读取能力的 Provider 必须显式声明 `supported` 或 `unsupported(reason)`，防止未来静默遗漏。该状态只说明实施进度，**不能**作为“全部 Provider 已可搜索”的验收依据。
- 改造 API/UI 契约，区分“完整发现结果”和“结果页”；取消全局命中截断，保留稳定排序、取消和不完整状态展示。

### Phase 1：解决当前用户问题与同类 JSONL

- 实现 WorkBuddy adapter；覆盖普通 user/assistant、`<user_query>` 注入提取、归档会话和 `AxiosResponse` 子串搜索。
- 实现 Pi adapter，覆盖当前分支过滤。
- 每个 Provider 增加活跃与归档 session 的正文命中测试。
- 完成后，Claude、Codex、WorkBuddy、Pi 均必须是 `supported`，且都通过“所有命中 session 均返回”的测试。

### Phase 2：异构存储

- 实现 DSH Zstd adapter，测试损坏文件隔离与取消。
- 实现 OpenCode SQLite adapter，先确认真实 schema，再测试 provider-session-id 映射、共享 DB 多 session 隔离及连接关闭。
- 实现 Cursor SQLite/blob-DAG adapter，测试忽略索引 JSONL、同一 `store.db` 的多 session 归位与分支/压缩语义。
- 完成后，DSH、OpenCode 与 Cursor 必须从 `unsupported` 翻转为 `supported`，并通过各自的“所有命中 session 均返回”测试；这是全 Provider 功能完成的必要条件。

### Phase 3：实测优化（仅在需要时）

- 使用 Phase 1/2 的匿名性能日志评估慢查询来源。
- 仅针对已证明的瓶颈增加 LRU、批量 SQL 或派生索引；任何缓存必须以文件版本/数据库修改时间失效。

## 8. 测试与验收

### 必测场景

- 每个 Provider：用户文本、助手文本、大小写不敏感、单词边界、多词短语、无结果。
- 每个 Provider：活跃 session、直接归档 session、归档项目下的 session。
- WorkBuddy：含 `AxiosResponseResult` 的原始 user `input_text` 命中 `AxiosResponse`；含系统注入时只显示 `<user_query>` 内文本。
- Pi：命中当前分支，忽略被分叉淘汰分支。
- DSH：正常 Zstd、损坏 Zstd、取消中止。
- OpenCode：两个 session 共用一个 DB 时不可串结果；测试 fixture 必须声明实际使用的 schema。
- Cursor：关键词仅存在于索引 JSONL 时不得误命中；关键词存在于 `store.db` 当前 session blob 时必须命中，同一 DB 的其他 session 不得串结果。
- 全局：结果总数/每会话上限、取消后无残留 SSE、标题搜索仍涵盖所有 Provider。

### 通过条件

1. WorkBuddy 的目标归档会话按 `AxiosResponse` 能命中，并带归档标记。
2. 对每个处于 `supported` 状态的 Provider，构造多 session fixture：所有包含关键词的 session 必须返回，任何不包含关键词的 session 不得返回；结果分页前后的 session 集合必须相同。
3. “全部 Provider 搜索完成”仅在 7 个 Provider 都为 `supported` 且各自通过第 2 条时成立；`unsupported(reason)` 仅允许用于未完成 Phase 的中间版本。
4. 每个 Provider 都验证命中后跳转：snippet 经与聊天相同的规范化后能定位到对应渲染消息；不能定位时必须显式使用时间戳回退并有测试覆盖。
5. Claude/Codex 既有搜索测试和归档搜索测试不回归。
6. 在本机包含当前历史规模的冷查询中，输入取消后服务能停止后续扫描；搜索完成状态、失败计数和翻页快照必须正确。最终性能阈值以 Phase 1 基准数据审批，不在无数据时虚构毫秒承诺。

## 9. 可行性评估

### 9.1 结论

方案**可行，但不能以现有单次 SSE、全局 50 条即停止的实现小修完成**。必须将“发现所有命中 session”与“分页传输结果”解耦，并为每种底层存储保留专用 adapter。现有 Provider 历史读取器已能读取七种来源，因此不需要猜测或反向工程新的文件格式；主要工作是抽取安全的可见文本、统一结果语义和增加测试。

| 维度 | 评估 | 依据与前提 |
| --- | --- | --- |
| 架构可行性 | 高 | 七个 Provider 均已有会话同步或历史读取 adapter；新层只补搜索专用的候选与文本提取。 |
| 正确性风险 | 中高 | 关键风险是系统注入、Pi 分支、Claude 多 session 同文件、Cursor blob DAG 与 OpenCode schema/会话映射；均须用真实最小 fixture 约束。 |
| 性能可行性 | 中 | 普通 JSONL 查询先用 ripgrep 缩小范围；最坏情况仍须检查全部候选，以满足全量保证。DSH 解压、Cursor blob 归一化和 OpenCode JSON 字段解析需要专用限流。 |
| 可靠性 | 中高 | 通过来源版本、完成状态、失败隔离和稳定合并，可避免把取消/变更中的部分结果误报为全量。 |
| 运维复杂度 | 中 | 需要短期搜索快照缓存、失效和分页 API；不引入永久索引或外部数据库写入。 |

### 9.2 性能模型与准入

全量保证意味着最坏复杂度无法低于 `O(全部候选来源的可读字节数)`：没有持久化索引时，罕见关键词或转义敏感查询必须检查全部候选，才能证明“未命中”。因此首期策略是优化常见路径、诚实暴露慢路径，而不是用结果截断伪造快速完成。

- **常见 JSONL 查询：** ripgrep 按词粗筛后，只精确解析命中文件；首条命中后停止该 session 的正文读取。
- **最坏 JSONL 查询：** 粗筛不能安全使用时退化为流式读取；限制精确解析并发，优先支持取消。
- **DSH：** 单并发解压，防止多个大日志同时占用 CPU/内存。
- **Cursor：** 每次查询只打开相关 workspace 的 `store.db`，按 session 归一化 blob；数据库型路径不能错误复用 JSONL ripgrep。
- **OpenCode：** 只读、按 provider session id 查询，连接短生命周期；不向外部拥有的 DB 建索引。
- **结果传输：** 只缓存并分页 session 级轻量结果，不缓存完整 transcript 或附件。

Phase 0 先记录匿名指标：各 Provider 候选数、完成/取消/失败数、粗筛命中数、搜索总耗时、单来源读取耗时、快照缓存命中率。Phase 1 用真实本机历史规模跑冷/热查询、常见词/罕见词/中文多词/转义敏感词四组基准；再由审批者基于数据确定延迟目标。不得在没有实际基准时承诺固定毫秒数。

### 9.3 可靠性边界

- “完整”只针对搜索开始后来源未变化、可读取且在可检索内容范围内的 session。
- 文件或数据库来源在检查中变更时，adapter 比较起止版本；可安全重试一次，仍变化则标记 `changed_during_search`，使整次结果为 `partial`。
- 单个 session 读失败不影响其他 session；失败 id/数量随完成事件返回，前端不得隐藏。
- 取消操作优先于完整性：取消后返回已发现的结果仅供临时查看，明确标记 `cancelled`，不能用于“无匹配”的判断。

## 10. 审批决策项

请审批者明确以下策略，实施前不得自行扩大范围：

1. **搜索范围：** 是否确认“全量”指所有命中 session，而非原始文件的每一个字节？建议默认搜用户、助手和可展示工具结果文本；不搜工具输入、系统注入和二进制附件。
2. **明文 reasoning：** 是否纳入 Codex reasoning、WorkBuddy `reasoning_text` 等明文 thinking？加密 reasoning 一律不搜。（建议：不纳入新增 Provider；Codex 既有行为在兼容期保持，随后用单独变更统一口径。）
3. **中文多词：** 是否对 CJK 查询改为词级 AND，使“会话 恢复方案”可匹配“会话恢复方案”？（建议：是；需作为独立 matcher 行为变更并更新既有快照测试。）
4. **Phase 1 范围：** 是否同时交付 WorkBuddy 与 Pi，还是只优先 WorkBuddy？（建议：WorkBuddy + Pi；两者同为 JSONL，Cursor 已确认属于 SQLite/blob-DAG，转入 Phase 2。）
5. **DSH/OpenCode/Cursor：** 是否接受作为独立的 Phase 2，而不是为了“全 Provider”在首期引入解压缓存或外部 SQLite/blob 索引？（建议：接受；但最终“全 Provider”验收须待 Phase 2 完成。）
6. **性能验收：** 是否接受先采集匿名耗时/候选数量，再为具体机器规模制定延迟阈值？（建议：接受。）
7. **架构边界：** 是否确认 Provider adapter 为内部后端能力，不向前端暴露 transcript 格式？（建议：确认。）

## 11. 主要风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 复制历史解析逻辑后与聊天展示不一致 | 复用或下沉已验证的文本提取 helper；同一真实 fixture 同时覆盖 history 与 search |
| 原始 transcript 含系统提示或敏感工具参数 | Adapter 只提交可见文本，统一层不直接展示原始行 |
| 大会话/DSH 解压导致输入卡顿 | 流式读取、取消、确定性合并的 Provider 并发池；DSH 单并发 |
| OpenCode 外部 SQLite 被锁 | 只读短连接、失败隔离、不得创建/迁移第三方 DB 索引 |
| 新 Provider 再次遗漏搜索 | registry 完整性测试与 capability 声明将遗漏变成测试失败 |
| 全量目标被页面大小误截断 | 发现集合与结果页分离，完成事件返回完整命中数，分页测试比较全量 session 集合 |
| 并发导致结果和 SSE 不稳定 | adapter 无共享计数；完成后稳定排序分页；进度只表示已完成检查的项目 |

## 12. 关联实现位置

- 现有搜索编排：`server/modules/providers/services/session-conversations-search.service.ts`
- 路由与 SSE：`server/modules/providers/provider.routes.ts`
- WorkBuddy 历史读取：`server/modules/providers/list/workbuddy/workbuddy-sessions.provider.ts`
- Pi 历史读取：`server/modules/providers/list/pi/pi-sessions.provider.ts`
- DSH 历史读取：`server/modules/providers/list/dsh/dsh-sessions.provider.ts`
- OpenCode 历史读取：`server/modules/providers/list/opencode/opencode-sessions.provider.ts`
- Cursor 历史读取：`server/modules/providers/list/cursor/cursor-sessions.provider.ts`

## 审阅批注

> 审阅者：WorkBuddy（2026-09-11）。审阅范围：本文档与当前 `server/` 实现的一致性、契约完备性与可验收性。总体结论：方向正确、范围克制、分期合理，同意 §9 第 1/3/4/5 项建议；第 2 项建议保持「WorkBuddy + Cursor + Pi 一次交付」，但需先补齐下列契约问题。以下 6 条按严重度排序，均有代码实证。

### W1（阻塞，§6.4 / §6.1）并发池会让「全局上限」与 SSE 顺序失去确定性

现状严格串行：`session-conversations-search.service.ts:1273-1317` 逐 bucket、逐 session `await`，`runtime.totalMatches` 顺序累加，因此「哪 50 条进入结果」与 SSE 推送顺序都是确定的，既有快照测试按此断言。§6.4 新增「最多 4 个 session 精确解析任务」的全局并发池后，多个 adapter 会并发读写共享 `totalMatches`，`addSessionMatch`（:849-860）的「达到 limit 即丢弃」变成竞态：同一输入在不同调度下可能返回不同结果集，SSE 顺序也不稳定。

建议二选一并写进 §6.4：(a) 解析保持串行，并发只用于 DSH 解压等 CPU 密集步骤，不用于计数与产出；或 (b) 允许并发解析但把计数/截断后移——adapter 只收集候选，统一层在全部解析后按确定顺序（bucket→session→timestamp）排序再截断。无论哪种，都需明确「限额截断发生在确定性排序之后」。

### W2（阻塞，§5.1 / §5.2）adapter 契约没有 `sessionSummary` 的产出位置

`ConversationSearchMatch` 只有 role/text/timestamp/anchor，adapter 也只「产出完整可见文本」，但每个 session 结果必须带 `sessionSummary`（`SessionConversationResult.sessionSummary`，:30）。当前该字段在 Claude 解析中由 `resolvedSummary / fallbackUserText / fallbackAssistantText`（:1019-1023）推导，依赖 `isCompactSummary`、pending summary、local-command 一整套状态机；Codex 用 `latestUserMessageText`（:1150）。契约把文本提取下沉给 adapter，却把 summary 来源悬空——统一层无法只凭 match 列表重建 summary（无命中消息时更不可能）。

建议在 §5.1 明确 summary 归属：`findMatches` 额外产出 summary（如返回 `AsyncIterable<Match | SummarySignal>`，或迭代结束后提供 `getSummary()`），或新增 `summarize(session)`。否则 Phase 0 的「Claude/Codex 迁入新契约且快照不变」无法落地。

### W3（阻塞，§4 vs §5）OpenCode/DSH 过不了现有候选归一化门槛

§4 已正确指出 OpenCode 的 session 行刻意没有 `jsonl_path`。但 §5 架构图没有说明该门槛要改：`normalizeSearchableSessions`（:548-598）对任何 session 都要求 `jsonl_path` 非空且文件存在，否则静默 `continue` 丢弃。照此实现，OpenCode adapter 即便写好也拿到 0 个候选，且无任何报错。

建议在 §5 显式写明：候选归一化按 provider 分流（JSONL 走 path 存在性校验；DB 型走 `provider_session_id` 非空校验），并把「DB 型 Provider 的 `providerSessionId` 必须非空」列为契约前置条件（§5.1 该字段目前可空，OpenCode 无法接受 null）。

### W4（重要，§3.3 / §6.1）ripgrep 粗筛存在假阴性，与「假阴性不可接受」不变量冲突

§3 原则 3 把「假阴性不可接受」写成硬不变量，但 §6.1 用 `rg --fixed-strings` 扫**原始 JSONL 字节**：JSON 会把 `"` 转义为 `\"`、`\` 转义为 `\\`、控制字符转义为 `\n` 等。查询一旦含这类字符（如搜含反斜杠的路径片段），ripgrep 在原始字节上永远匹配不到 → 文件不会被打开 → 内存中解码后的正确文本也无从命中。这是方案自身引入的一类假阴性（Claude/Codex 现在同样存在，但文档把它提升成了绝对不变量）。另需注意 ripgrep 的二进制探测可能跳过含 NUL 字节的 transcript。

建议在 §3 或 §6.1 明确「粗筛为 over-approximation，含 JSON 转义字符的查询属于已知假阴性类别」并给出处置（如命中转义敏感字符时对该 Provider 退化为直接精确解析，或改用 JSON-aware 预筛）。至少不要把它写成绝对不变量。

### W5（重要，§2 / §8）「搜索跳转不回归」未进入验收，且 `anchor` 目前无消费者

§2 把「保持…搜索跳转行为不回归」列为目标，但 §8 的必测场景与通过条件只验证「命中」与「总数/上限」，没有一条验证「跳转能定位到正确消息」。跳转实际由 `src/modules/chat/utils/searchTargetLocator.ts:55-95` 完成：将 snippet 去掉首尾 `...`、截断 80 字符后 `.includes()` 匹配**渲染文本**（`displayText`/`content`/`toolInput`/`toolResult`，:26-38），失败才用 timestamp 兜底。即 snippet 必须是渲染文本的子串——而 `buildSnippet` 会把换行替换为空格（`session-conversations-search.service.ts:333`），跨行 snippet 会因此定位失败并静默退化为时间戳。另外 `messageUuid` 在 `src/shared/types.ts:1495` 有定义但前端无消费者，§5.1 新引入的 `anchor` 同理，目前没有用途。

建议：(1) §8 为每个 Provider 增加「命中后跳转定位」验收（可扩测现有 `searchTargetLocator.test.ts` 的 fixture）；(2) 说明 `anchor` 用途或删去，避免实现者为无消费者字段设计格式；(3) 明确新 Provider 的 snippet 与聊天渲染文本的一致性要求（§10 现有风险行只讲「解析逻辑不一致」，未落到「snippet 无法在渲染文本中定位」这一具体后果）。

### W6（重要，§4 / §2 / §9.1）「助手可见文本」是否含明文 reasoning，各 Provider 口径不一致

Codex 目前把 `agent_reasoning` 与 reasoning summary 当作可搜文本（:1080-1108），而 §4 给 WorkBuddy 的映射只有 `input_text` / `output_text`（排除 `reasoning_text`）；§2 非目标只排除「加密 reasoning」，§9.1 也只问「user/assistant 可见文本」，未单独定义 reasoning。结果是同一条「搜索可见语义」原则在不同 Provider 落到不同结果，与 §5.1「不让不同 Provider 产生不一致语义」相冲突。

建议把 §9.1 拆为两条明确裁决：①明文 reasoning（Codex reasoning / WorkBuddy `reasoning_text` / 其他 Provider 的 thinking）是否可搜；②加密 reasoning 一律不可搜。并在 §4 表格逐 Provider 写死，避免实现各自解释。

### W7（次要，不阻塞，§5.1）`mayContain` 的 session 粒度与真实文件粒度不一致

§5.1 把粗筛抽象为 `mayContain(sessions[], …) → Set<sessionId>`，但真实粗筛是**文件粒度**：Claude 一个 JSONL 可含多个 session（`:1208-1227` 的 `sessionsByPathKey`，以及 :885-894 按 provider session id 反查内部 id）。建议在契约中注明「JSONL adapter 的 `mayContain` 返回文件级 over-approximation，需展开为该文件下全部 session；精确解析再按 provider session id 归位」，否则迁移 Claude 时易丢失多 session 共文件的处理。

### Claude

审阅范围：本文档与 `server/modules/providers/services/session-conversations-search.service.ts` 现有匹配语义、registry 验收口径与 SSE 进度实现的一致性。总体结论：方向与分期认可；在 WorkBuddy 已提的 W1-W7 之外，补充 4 条侧重「审批口径」与「中文搜索语义」的问题，其中 C1、C2 建议并入 §9 决策项一并裁决。以下均有代码实证。

> [!WARNING] C1（§8 通过条件 2 / §7 Phase 0 / §9.3）「`unsupported(reason)` 即通过验收」会形成假完整
> §7 Phase 0 的 registry 完整性测试允许 Provider 以 `unsupported(reason)` 显式声明，§8 通过条件 2 又把「所有 7 个 Provider 都有明确状态」当成通过标准。DSH/OpenCode 在 Phase 2 落地前只需声明 `unsupported('phase 2: 异构存储')` 即可双双通过，但用户实际仍不可搜——目标从「不再静默不可搜」退化成「不再静默」。建议把通过条件 2 拆成两层：① registry 层「每个 Provider 状态显式」；② 用户层「状态为 `supported` 的 Provider 必须通过 §8 的正文命中必测」。并在 §7 Phase 2 的完成标准里显式写出「DSH/OpenCode 必须从 `unsupported` 翻转为 `supported` 且通过各自命中测试」，否则假完整会在验收时被误判为已完成。

> [!IMPORTANT] C2（§2 / §9.1 / §6.1）中文多词查询的「连续短语 + 词间必须空白」语义对中文用户近乎不可用，且白解析会随 5 个 JSONL Provider 放大
> 代码实证：`createWordMatcher` 在 `words.length > 1` 时置 `requireExactPhrase = true`（:267-270），`phrasePattern` 用 `\s+` 连接各词，`matchesQuery` 对多词只走 `phraseRegex.test(text)`（:280-282）——词间必须有空白字符。中文正文几乎不插空格，用户输入「会话 恢复方案」这类带空格的多词查询时，源文本「会话恢复方案」无空白 → 恒零命中。而 §6.1 的 rg 粗筛是词级文件交集（两词各自 `--files-with-matches` 再取交集），只要两词同处一文件即放行 → 文件被精确解析后 0 命中，白解析在 5 个 JSONL Provider 上成倍放大。§2 把该语义列为「不改变」而非待裁决项，但这是本产品（中文主用户）最可见的搜索语义问题。建议并入 §9 审批：维持现状 / 对 CJK 查询退化为「词级 AND」（粗筛与精确 matcher 同口径），并说明该改动是否破坏现有快照测试。

> [!TIP] C3（§6.4）并发解析下 SSE 的 `scannedProjects` 进度语义与 project result 推送顺序未定义
> 现状 `scannedProjects` 在单个 bucket 串行处理完才自增（:1299-1303），`onProjectResult` 推送顺序因此确定。§6.4 引入「最多 4 个 session 并发解析」后：若进度按「bucket 完成」计数则仍单调，但推送顺序由并发完成次序决定、不确定；若按「开始解析」计数则进度会先虚高、再回摆。建议在 §6.4 明确：`scanned` 定义为「该 bucket 全部 session 已结束解析且结果已合并」，且 `onProjectResult` 只在该定义达成时发送（或明确前端可容忍乱序）。

> [!NOTE] C4（§2 vs §8）「不解决损坏历史」与「损坏 Zstd 必测」的表述张力，建议在 §8 点明测试目的
> §2 非目标写「不解决 Provider 自身已删除、损坏或无法读取的历史记录」，§8 又列「DSH：正常 Zstd、损坏 Zstd」，读起来像要修损坏文件。§3.6 的不变量其实已给出边界（损坏只跳过该 session 并做失败隔离）。建议在 §8 的 DSH 用例后补一句「损坏文件用例只验证 §3.6 的失败隔离（跳过 + 结构化日志，不中断其他 session），不承诺修复」，避免实现者朝「修复损坏文件」方向设计。

### 牵头结论

- 采纳 W1 / C3：结果发现允许受控并发，但 Adapter 不共享全局计数；最终在稳定排序后分页，SSE 只报告单调的检查进度。
- 采纳 W2：`SessionSearchInspection` 明确由 Provider Adapter 返回 `sessionSummary`，保留 Claude/Codex 的既有摘要语义。
- 部分采纳 W3：OpenCode 必须取消 `jsonl_path` 前置条件，改为 `providerSessionId` 前置条件；DSH 已有日志路径，问题是压缩读取适配而非候选路径缺失。
- 采纳 W4：转义敏感查询与二进制探测异常时，JSONL Provider 退化为精确流式解析，避免粗筛假阴性。
- 采纳 W5：删除当前无消费者的 `anchor`；补充 search jump 的端到端验收，并要求 snippet 与渲染文本使用同一规范化规则。
- 采纳 W7：候选契约区分 transcript 级与 session 级，保留 Claude 多 session 共文件的归位能力。
- 采纳 C1：`unsupported(reason)` 只允许用于阶段中间状态，不能作为“全部 Provider 已可搜索”的验收；最终验收要求七个 Provider 全部 `supported`。
- 采纳 C4：明确损坏 Zstd 只验证失败隔离，不承诺修复文件。
- 采纳 D1：Cursor 的正文来源更正为 `store.db` blob DAG，索引 JSONL 不得用于正文搜索；Cursor 从 Phase 1 移入与异构存储同组的 Phase 2。
- 采纳 D2：OpenCode 不再预设 `part` 表；Phase 2 先以真实数据库 schema 确认可检索字段，再实现查询。
- 待审批 W6 / C2：明文 reasoning 是否纳入搜索、中文多词是否改为 CJK 词级 AND，已列入 §10；二者会改变既有搜索语义，不能由实施阶段自行决定。
- 修订说明：方案现将“全量”定义为完整发现命中 session，发现与展示分页解耦；新增完整性状态、来源变更处理、性能模型与可行性评估。

### Claude · 二次核查（2026-09-12）

本轮按 §11 逐个核对了 5 个待接入 Provider 的历史读取实现，验证 §4 存储盘点与真实代码的一致性。结果：WorkBuddy（JSONL，`extractUserPrompt` 提取 `<user_query>` 注入）、Pi（JSONL 分支树，`fetchHistory` 沿 parentId 从叶子回溯）、DSH（`session.jsonl.zstd` 拼接 zstd 帧）、OpenCode（共享 SQLite）与文档描述一致；**唯有 Cursor 的分类与实际实现不符**，且会直接误导 Phase 1 实现。另有 OpenCode 的一个小口径差异。以下 2 条均有代码实证。

> [!CAUTION] D1（§4 / §6.1 / §6.4 / §7 Phase 1）Cursor 不是 JSONL Provider，实际历史源是每会话 `store.db`（SQLite content-addressed blob DAG），按文档实现会整 Provider 搜不到
> 文档 §4 给 Cursor 的「历史来源」是 JSONL、「首选候选筛选」是 `rg --fixed-strings`，§6.1 把 Cursor 归入「JSONL Provider（Claude、Codex、WorkBuddy、Cursor、Pi）」组。但真实实现：`cursor-sessions.provider.ts:229-236` 明确注释「Cursor history is stored as content-addressed blobs rather than JSONL」，`fetchHistory` 打开 `store.db`（:239-250）`SELECT rowid, id, data FROM blobs` 读整张 blob 表；而 DB `jsonl_path` 指向的 `.jsonl` 只被 `cursor-session-synchronizer.provider.ts` 用来从**首个 user 消息**提取 sessionId/projectPath/sessionName（:75-97、:136-156），不是会话正文。`session-history-cache.service.ts:22-24` 也把 Cursor 明确排除在 jsonl_path 缓存之外。后果链：
> 1. 若照 §6.1 对 Cursor 跑 `rg --fixed-strings`，扫的是元数据 `.jsonl`（只含首个 user 消息文本），命中面几乎为 0 → 系统性假阴性，直接违反 §3.3「假阴性不可接受」；
> 2. §6.4「ripgrep 文件块 40/并发 6 只用于 JSONL adapter」会把 Cursor 错误计入 JSONL 组；
> 3. Phase 1 把 Cursor 与 WorkBuddy/Pi 并列「同类 JSONL」的排期假设不成立——Cursor 的候选筛选必须针对 `store.db`（如 blob 表 LIKE 或按 session 扫描），策略上更接近 Phase 2 的异构组（OpenCode/DSH），首期复杂度被低估；
> 4. 契约 `SearchableConversationSession.transcriptPath` 对 Cursor 指向的是元数据 `.jsonl`，adapter 必须忽略它，改用 `providerSessionId + projectPath` 定位 `store.db`（`fetchHistory` 入口就强制依赖 projectPath，:408-413）。
>
> 建议：把 §4 Cursor 行改为「历史来源 = 每会话 SQLite store.db；首选候选筛选 = 待定（blob LIKE / 按 session 扫描）；精确文本提取 = 复用 `normalizeCursorBlobs`（:440）」，§6.1 的 JSONL Provider 名单删掉 Cursor，并在 §4 显式注明「Cursor 的 `transcriptPath` 是索引文件，不得作为正文来源」。

> [!NOTE] D2（§6.3）OpenCode 当前实现只查 `message` 表，文档写「查询 message / part」需在实现前确认
> `opencode-sessions.provider.ts:165` 现有历史读取是 `SELECT data FROM message WHERE session_id = ?`，没有访问 `part` 表；文档 §6.3 的「查询 `message` / `part`」可能对应更新版本的 opencode.db schema，也可能只是臆测。建议 Phase 2 实现前用真实 `opencode.db` 确认 `part` 表是否存在、工具调用文本落在哪张表，避免按文档写出查询空表的 adapter。
