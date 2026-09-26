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
| `first-paint.spec.ts` | the chrome that paints *before* the bundle runs: that the splash and the `theme-color` meta agree in both appearances, that the inline script reaches all three consumers, and that every declared `theme-color` is media-scoped |
| `theme-overlays.spec.ts` | each `[data-theme]` overlay: that it is declared outside any `@layer`, that it resolves as written, that it moves exactly the surfaces its `coverage` advertises, and that the traversal is complete in both directions (no unregistered `[data-theme]` block, no registered theme without one) |
| `user-theme-tmtheme.spec.ts` | a `.tmTheme` file's compiled overlay: that the editor and terminal tokens it names actually move (a hex written into a terminal token would resolve to nothing), and that its `--cc-syntax-*` overrides outrank the runtime-injected base syntax sheet even when that sheet is injected afterwards |
| `contrast.spec.ts` | the WCAG AA floors of §5.10 — body / secondary / button text at 4.5:1, the focus ring at 3:1 — for the base palette and every overlay |

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

An overlay whose values differ per appearance (the editor chrome, whose base
values are literals rather than palette references) has to split into a
`[data-theme="<id>"]:not(.dark)` block and a `[data-theme="<id>"].dark` one. The
`:not(.dark)` is load-bearing: a bare selector would match in both appearances
and still resolve correctly for any token the dark half repeats, so only a token
forgotten in the dark half would leak — and the leak check keys on the scoping to
catch exactly that.

## User themes and the syntax base layer

A user theme is a stylesheet appended to `<head>` at runtime, so it wins over the
base palette for the same reason the built-in overlays do: document order. That
makes one ordering a correctness requirement rather than a detail. The syntax
palette's variables are declared by a sheet `src/shared/syntaxTheme.ts` injects at
module scope, and a `.tmTheme` compiles to declarations naming exactly those
variables — so the base sheet has to land **ahead** of any overlay, which is what
`ensureSyntaxStyleElement` does by inserting at the front of `<head>`. Its one-shot
import always runs before an overlay exists, so the fixture exercises the case
that matters by removing the element and calling the function again through
`reinjectSyntaxStyleSheet`.

## Contrast floors (§5.10)

`contrast.spec.ts` measures six pairs — `--foreground` and `--muted-foreground`
on `--background` and `--card`, the button label on `--primary`, and `--ring` on
`--background` — for the base palette and each overlay, in both appearances. It
reads the fixture's `rendered` layer, so the ratio comes from the colour the
browser paints rather than from the triplet; a pair whose token is not probed
fails with a message naming it instead of reading `NaN` and passing.

The base palette is included on purpose. It is what ships when no theme is
picked, and an `accent` overlay inherits its substrate untouched — so a base
value below the floor takes every accent theme down with it, which is exactly how
`--palette-sand-500` came to be pinned at 43%.

## Before the bundle runs

Every check above applies the theme from JavaScript, so it only exists once the
bundle has downloaded. Until then the page is the static document: the splash
paints from literals in `index.html`, and the browser chrome takes its colour
from a `<meta name="theme-color">` no token can reach. The two are on screen
together, so `first-paint.spec.ts` pins the one thing that has to hold between
them — that they **agree**, in both appearances.

Each appearance's colour has three writers: the inline script at the end of
`<head>` (which resolves the appearance and rewrites the meta), the splash rules
(which select on `<html data-appearance>`), and the media-scoped metas left as
the no-script fallback. The assertion is therefore that the value is the same
everywhere it appears; pinning each occurrence to its own literal would keep
passing after one of them drifted.

That spec reads the source text, so it proves the document is wired consistently,
not that the script behaves — the fixture imports the stylesheet, not the
document, so nothing in this directory executes the inline script. The behaviour
is checked separately against the real `index.html`:

```sh
node tests/theme-tokens/verify-first-paint.mjs
```

It runs all six combinations of OS appearance and stored preference and fails
unless `data-appearance`, `color-scheme`, the single remaining `theme-color` meta
and the splash's computed background all agree.

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
