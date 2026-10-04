# End to end tests

These tests drive the running development stack. They do not start a server.

Before `bun run test:e2e` in `apps/web`:

1. `bun run infra:up` for Postgres and Redis.
2. The web server on port 3300 and the realtime server on port 3400 are running.
   Point at another web origin with `GRAVITY_E2E_BASE_URL`.
3. `ALLOWED_EMAIL_DOMAINS` in the web server's environment admits the generated
   test addresses, or is empty, so the dev sign-in route accepts them.

Global setup writes a workspace named `E2E <suffix>` into the database that
`DATABASE_URL` points at, and the realtime smoke test fails when a teammate's
page reads `/api/leads` during the measured window, because the lead must
arrive by delta rather than by refetch.

The MCP test drives the OAuth consent page, which only accepts a decision from the
page's own origin, so `NEXT_PUBLIC_APP_URL` in the web server's environment must be
the same origin as `GRAVITY_E2E_BASE_URL` (both default to `http://localhost:3300`).
It registers an OAuth client named `E2E agent` per run and revokes it from
Settings, then checks the token is refused. The redirect it registers is a
loopback address the test intercepts in the browser, so nothing listens on it.

The import test imports three leads per run into a second brand and pipeline that
global setup creates for it, because the realtime smoke test expects its own
pipeline to start empty. It checks that a teammate's open list receives the rows
within a 10 second poll without reading `/api/leads`, and that a second run of the
same file adds nothing.

The performance test enforces the UI spec budgets: a keystroke to the visible change under
16ms and a route change from the cache under 100ms, each checked against the median of its
samples. Both are timed inside the page, from a capture-phase `keydown` to the
`MutationObserver` callback that sees the result, so Playwright's own round trips do not
count. The route sample holds the People list response for 1.5 seconds, so a row that shows
inside the budget can only have come from the cache. It seeds 40 leads per run into a third
brand and pipeline that global setup creates for it, and prints the medians and every
sample. The budgets hold against `next dev` with React strict mode on, which is the slower
case, so no check is limited to a production build.
