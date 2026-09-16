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
直接面向用户的助手正文 Segment；同一 Turn 可以包含多个 Answer，不能只把最后一段正文视为答案。
_Avoid_: Final message, focus message

**Process Segment**:
解释或执行任务过程的 Reasoning、Tool Activity 或 Progress Segment；只有边界已经封口时才允许自动折叠。
_Avoid_: Hidden message, metadata

**Disclosure Ownership**:
决定 Segment 展开状态的控制权；用户选择优先于程序默认，并在同一次会话打开期间跨流式更新、分页和懒卸载保持稳定。
_Avoid_: Expanded state, local toggle

**Attention Segment**:
包含失败、等待用户、权限请求或仍在运行状态，因而必须保持可见的 Segment。
_Avoid_: Error row

