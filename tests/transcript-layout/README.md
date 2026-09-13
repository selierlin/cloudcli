# Transcript layout browser tests

This suite is the real-browser gate for dynamic transcript geometry. Its Vite
entry imports the production session store, message projection, grouping and
transcript components without adding the fixture to the production bundle.

Run once in pinned Chromium and WebKit:

```sh
npm run test:transcript
```

CI repeats every scenario five times; release/nightly repeats twenty times:

```sh
npm run test:transcript:ci
npm run test:transcript:release
```

Install the browser revisions pinned by `@playwright/test` after a fresh clone:

```sh
npx playwright install chromium webkit
```

Artifacts contain browser versions, per-frame transcript geometry and recorded
programmatic scroll APIs. Failed tests retain trace, screenshot and video. The
permanent negative fixture deliberately inserts a 360px layout gap; the test
passes only when the analyzer detects that regression.
