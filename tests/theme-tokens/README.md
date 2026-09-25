# Theme token contract tests

This suite is the real-browser gate for the stylesheet's design tokens. Its Vite
entry imports the production stylesheet verbatim and exposes the resolved value
of every custom property it declares, in both appearances.

Run in pinned Chromium and WebKit:

```sh
npm run test:theme-tokens
```

Install the browser revisions pinned by `@playwright/test` after a fresh clone:

```sh
npx playwright install chromium webkit
```

Type-check the fixture with:

```sh
npm run typecheck:theme-tokens
```

## Why this exists

A palette refactor rewrites declarations such as

```css
--background: 44 22% 96%;
```

into an indirection:

```css
--palette-sand-50: 44 22% 96%;
--background: var(--palette-sand-50);
```

That change is only provably neutral if every resolved value is byte-identical
afterwards. `token-baseline.json` is that ground truth: it records what the
browser resolves each token to, so the suite measures the promise instead of
trusting it.

## The four checks

| Check | Guards against |
|---|---|
| `resolved token values match the checked-in baseline` | Any edit that silently changes what the UI renders — token strings plus colours resolved through the same `hsl(var(--x))` path Tailwind emits |
| `baseline covers every token the stylesheet declares` | Adding a token without recording it, which would leave it unguarded |
| `every palette token is consumed by at least one declaration` | A dead palette token — one nothing references, so overriding it would change nothing |
| `no colour token holds a literal value outside the palette` | A colour declaration that bypasses the palette, so a theme cannot reach it |

The last two read declaration text rather than resolved values: `getComputedStyle`
expands `var()` before returning, which makes an indirection invisible there.

## Guards for tokenized consumers

Some surfaces consume tokens from JavaScript rather than from a utility class. The
fixture mounts those consumers directly, so their colours are pinned in the browser
too:

| Spec | Pins |
|---|---|
| `terminal-tokens.spec.ts` | the xterm theme back to the hex board it shipped with |
| `graph-lanes.spec.ts` | the commit-graph lanes and the ref-badge tint back to the hex array `commitGraph.ts` shipped with |
| `mobile-terminal-selection.spec.ts` | the long-press handle and context menu back to the literals `mobileTerminalSelection.ts` shipped with |
| `theme-chrome.spec.ts` | the `theme-color` / iOS status-bar metas to the resolved `--background`, plus the token override, translucent flattening and unknown-token fallback paths |
| `theme-overlays.spec.ts` | each `[data-theme]` overlay: that it is declared outside any `@layer`, that it resolves as written, and that it moves exactly the surfaces its `coverage` advertises |

## Overlay themes

`readWithTheme(themeId, appearance)` is the same read with `<html data-theme>`
set, so an overlay can be compared against the base palette token by token
(`null` clears the attribute). `theme-overlays.spec.ts` drives it from
`BUILTIN_THEMES`, so a newly registered overlay is covered as soon as it is
added.

Two things are worth knowing before touching that spec. First, an overlay
declared *inside* a `@layer` is rejected even though it resolves correctly
today: Tailwind v3 flattens the source's `@layer base` away (the fixture and the
build both contain zero `@layer` at-rules), so the win currently rests on
document order, and the constraint is what keeps it true under a pipeline that
emits real layers. Second, the layer check is the only guard that covers that —
the browser check cannot see it.

## Updating the baseline

Regenerate only when a token change is intended, and review the diff as part of
the change:

```sh
UPDATE_THEME_BASELINE=1 npm run test:theme-tokens
```

## Known trap

`src/index.css` gives every `div` a 200ms colour transition ("Color transitions
for theme switching"). A probe read immediately after an appearance flip would
otherwise return the value the transition started from, so the fixture opts its
probes out with an inline `transition: none`. Keep that opt-out if you add
probes.
