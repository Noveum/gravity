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
