---
status: superseded by ADR-0003
---

# Fold intermediate assistant prose into local process stages

Harnesses such as WorkBuddy emit frequent assistant prose between tool batches. CloudCLI will show the rightmost prose in an active Turn as the provisional Answer, then reclassify it as Phase Narration if later process activity arrives; that narration joins the preceding local Process Stage, except an opening preamble joins the following stage. Completed normal stages fold independently after a short handoff delay, while attention stages stay open and search/export retain all narration. We rejected permanently displaying every prose Segment because it overwhelms the final answer, deleting intermediate prose because it can contain useful context, and merging the whole Turn because one disclosure would again reveal every tool call.
