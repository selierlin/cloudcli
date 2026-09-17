---
status: accepted
---

# Merge a turn's ordinary process into one run

Real WorkBuddy turns can emit dozens of intermediate prose boundaries, and presenting each boundary as an independently folded Process Stage replaces prose noise with a wall of identical disclosure rows. CloudCLI will instead project at most one ordinary Process Run per assistant Turn: reasoning, intermediate prose, progress and tool batches retain their original order inside it, while only the rightmost prose remains the Answer. The run is folded by default, attention content remains directly visible, and opening the run reveals narration as its readable spine while reasoning and tool batches remain independently folded evidence.

## Considered options

- Keep local stages and add a turn-level parent disclosure. Rejected because opening the parent still exposes a second layer of repetitive stage controls.
- Keep local stages but improve spacing and labels. Rejected because most harness phase narration is status reporting rather than a meaningful navigation boundary.
- Delete intermediate prose. Rejected because it can explain the purpose and result of surrounding tool activity and remains useful in search and export.

## Consequences

Process disclosure identity belongs to the Turn rather than to intermediate Answer boundaries. Live provisional prose can move into the folded run without automatically opening a potentially very large subtree; its first line may temporarily label the active run. Search reveals the one run and only the matching reasoning or tool batch. Inner user choices survive closing the outer run for the current session, while folded content defers mounting its expensive detail DOM.
