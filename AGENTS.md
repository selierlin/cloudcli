# Repository guidance

## Backend code

For every task that creates, modifies, refactors, or reviews backend code under `server/`, load and follow `$backend-module-standards` from `.agents/skills/backend-module-standards/SKILL.md`. Apply it only to backend code; do not impose those architecture rules on the frontend.

## Frontend code

For every task that creates, modifies, refactors, or reviews frontend code under `src/`, load and follow `$frontend-module-standards` from `.agents/skills/frontend-module-standards/SKILL.md`. Apply it only to frontend code; do not impose those architecture rules on the backend.

## Verifying UI changes in a real browser

The browser MCP is always headless (`browser-use.service.ts` hardcodes `headless: true`) and the app reads its session token from `localStorage['auth-token']` with a 7-day lifetime, so a persisted browser profile cannot keep a verification session signed in. Sign in by injection:

1. `node scripts/mint-auth-token.mjs` signs a 7-day token from `~/.cloudcli/auth.db` and writes it to `~/.cloudcli/browser-use/auth-token` (`--out <path>`, `--stdout`).
2. `browser_create_session({ authTokenFile, authOrigin })` — the server reads that file and seeds `localStorage['auth-token']` before every navigation, only when `location.origin === authOrigin`, so the token is never written into third-party pages and never has to appear in the transcript.
3. `browser_evaluate` — `page.evaluate` returning JSON. Assert layout with `getBoundingClientRect()` / `getComputedStyle()` instead of eyeballing screenshots.

Traps that have already cost time:

- `/api/auth/status` always answers `isAuthenticated: false` (the route is unauthenticated). Test the token against a protected route: `/api/projects` returns 200 with it, 401 without.
- nginx listens on `127.0.0.1:3012` and proxies to the daemon on 3011. A throwaway server that lands on a port nginx already owns looks alive but answers from the **old** code. Run `lsof -nP -iTCP:<port> -sTCP:LISTEN` and confirm the listener is your own node before trusting a result.
- Server changes need `npm run build:server` plus a daemon restart, and a restart issued from inside a session kills that session (harness sessions are children of the daemon). To verify before restarting, run a throwaway instance against a database snapshot: `sqlite3 ~/.cloudcli/auth.db ".backup /tmp/verify/auth.db"`, then `DATABASE_PATH=/tmp/verify/auth.db SERVER_PORT=<free port> npx tsx --tsconfig server/tsconfig.json server/index.ts`.
- The MCP tools expose no pointer drag. For gesture-driven changes drive `playwright` from `node_modules/playwright` directly; a synthetic `pointerdown` cannot work because `setPointerCapture` rejects an inactive pointer id.
