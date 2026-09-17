# Chat Transcript

CloudCLI 将多个 AI harness 的不同事件语义呈现为一致、可连续阅读的对话记录。本词汇表定义聊天记录中的稳定领域概念，避免把 Provider 的原始事件直接当成界面结构。

## Language

**Transcript Event**:
Provider adapter 产出的最小事实记录；它描述已经发生的文本、思考、工具活动或生命周期变化，但不等同于一个可见界面行。
_Avoid_: Message row, UI message

**Turn**:
从一次可见用户输入开始，到对应助手活动完成为止的对话范围；边界不完整时仍是同一 Turn，但必须标记为 partial。
_Avoid_: Request, message group

**Segment**:
Turn 内一个有稳定身份和单一语义的有序内容单元，例如 Answer、Reasoning、Tool Activity、Progress 或 Summary。
_Avoid_: Row, block

**Answer**:
当前位于 Turn 最右侧、直接面向用户的助手正文 Segment；Turn 活跃时它是暂定的，若之后又发生过程活动则转为 Phase Narration。
_Avoid_: Any assistant text, message row

**Phase Narration**:
在 Turn 结束前汇报阶段结果或预告行动的助手正文 Segment；它属于该 Turn 的 Process Run，而不与最终 Answer 争夺注意力。
_Avoid_: Answer, disposable text

**Process Run**:
Turn 内唯一的普通执行轨迹，按原始顺序容纳 Reasoning、Tool Activity、Progress 和 Phase Narration；Phase Narration 构成直接可读的过程主干，Reasoning 和 Tool Activity 是按需展开的证据。
_Avoid_: Process Stage, tool wall, stage accordion

**Process Segment**:
解释或执行任务过程的 Reasoning、Tool Activity、Progress 或 Phase Narration Segment；它在 Process Run 中保留原始时序和稳定身份。
_Avoid_: Hidden message, metadata

**Disclosure Ownership**:
决定 Segment 展开状态的控制权；用户选择优先于程序默认，并在当前会话页停留期间跨流式更新、分页和懒卸载保持稳定。
_Avoid_: Expanded state, local toggle

**Attention Segment**:
包含失败、等待用户、权限请求或仍在运行状态，因而必须保持可见的 Segment。
_Avoid_: Error row
