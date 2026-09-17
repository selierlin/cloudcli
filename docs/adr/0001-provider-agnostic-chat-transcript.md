---
status: accepted
---

# Project provider events into stable chat turns and segments

CloudCLI supports harnesses whose streaming boundaries, reasoning delivery and tool lifecycles differ. We will keep Provider adapters responsible for facts, then project their normalized events into stable `Turn` and `Segment` identities before rendering; the UI will not infer Provider behavior from names, timestamps, adjacency, or a missing result. This preserves one interaction model without pretending that every harness has WorkBuddy's event model.

## Considered options

- Copy WorkBuddy's event model and visuals. Rejected because other harnesses do not expose the same boundaries or capabilities.
- Keep the flat message list and improve components in place. Rejected because content-derived identity and overlapping disclosure projections are direct causes of remounts and unstable folding.
- Give every Provider its own chat UI. Rejected because it duplicates interaction logic and prevents a consistent CloudCLI experience.

## Decisions

- Every rendered Segment has a deterministic identity derived from stable source facts. Content growth, realtime finalization, persistence reconciliation, pagination and lazy unmounting must not change that identity.
- A Turn may emit multiple assistant prose Segments, but only its rightmost provisional prose remains an Answer. Earlier prose becomes Phase Narration in the Turn's single Process Run as defined by [ADR 0003](./0003-merge-turn-process-into-one-run.md).
- Attention Segments remain visible while unrelated completed Process Segments may fold.
- User disclosure ownership survives updates during the current open session and outranks automatic defaults. It is not persisted across application restarts.
- Historical pages prefer complete Turns within a byte budget. Oversized Turns may be partial, but must expose stable identity, missing direction and an opaque continuation cursor.
- Full-session search seeks directly to a stable anchor instead of loading all earlier history.
- Large tool details use one provider-agnostic preview/detail contract; each Provider may implement the detail reference using its native storage capabilities.
- Transcript data pagination and viewport windowing are separate responsibilities and will both be used.
- Scroll ownership is ordered: real user input, user-requested navigation, pagination anchor restoration, then automatic tail following.

## Consequences

The migration ships behind a temporary internal switch. Work proceeds in gates: stabilize identity and disclosure behavior; introduce the Turn/Segment projection; add versioned pagination, seek and lazy details; then adopt measured windowing and WorkBuddy-inspired presentation. A gate must pass before the next begins, and the old path is removed after representative Provider, desktop and mobile verification plus one release cycle.

WorkBuddy remains a behavioral reference rather than a specification. Further bundle reverse engineering is out of scope; only meta-fold timing and oversized-Turn pagination need targeted real-application comparison before their respective implementation gates.
