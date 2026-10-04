# Gravity

Open-source, realtime, keyboard-first CRM for teams that do a lot of outreach, with an MCP server for AI agents. The platform layer is copied from Orbit and adapted, see `docs/provenance.md`.

## Hard rules

1. **Bun is the package manager and the script runner.** There is no pnpm, no npm, no yarn, no Turbo, and no `node_modules` produced by anything but `bun install`. Every command in this file starts with `bun`. The deployed runtime is node, so shipped code must not import a Bun built-in.
2. **No comments in code.** Ever. `bun run check-comments` fails the build on any comment that is not a functional directive (`@ts-*`, `biome-ignore`, `eslint-*`, `/*! license */`). Make names and structure carry meaning.
3. **No AI attribution.** Never credit AI tooling in commits, branches, PRs, code, or docs.
4. **No em-dash characters** in code, copy, docs, or commit messages. Use commas, colons, or separate sentences.
5. **Strict types only.** `any` is a lint error. Non-null assertions are a lint error. `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on. Validate every external input with Zod.
6. **Every check green before you finish.** `bun run verify` runs lint, comment policy, source bytes, Bun import policy, dependency dedupe, typecheck, and tests.


## Bun is the toolchain, not the runtime

Bun installs, runs scripts, and runs tests. Shipped server code must not call a
Bun built-in, because the web app runs on Vercel's node runtime: that is the only
runtime where a Vercel function can upgrade a websocket, and `/api/ws` needs it.
Anything imported from `bun` fails there with `Cannot find module 'bun'`.

| Need | Use | Never use |
| --- | --- | --- |
| Postgres | `postgres.js` through `drizzle-orm/postgres-js` | `Bun.SQL`, `drizzle-orm/bun-sql`, `pg` |
| Redis and pub/sub | `ioredis` | `Bun.RedisClient`, `node-redis` |
| Object storage | `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` | `Bun.S3Client` |
| Reading and writing files | `node:fs/promises` | `Bun.file()`, `Bun.write()` |
| Hashing passwords | `@node-rs/argon2` (argon2id) | `Bun.password`, `bcrypt` |
| Sortable ids | `randomUUIDv7()` from `@gravity/shared/utils` | `Bun.randomUUIDv7()`, `ulid`, `nanoid` |
| WebSocket server | `ws`, upgraded by `@vercel/functions` | `Bun.serve({ websocket })` in shipped code |
| Running TypeScript | `bun file.ts` | `tsx`, `ts-node` |
| Tests | `bun test` | `vitest`, `jest` |
| Subprocesses | `Bun.spawn`, `Bun.$` | `node:child_process` |
| Workspace script running | `bun run --filter '<pattern>' <script>` | `turbo`, `nx`, `lerna` |
| Env files | `bun --env-file=...` | `dotenv` |

Test files and `apps/realtime` may use Bun built-ins, because both only ever run
under Bun. `packages/realtime-server` is imported by the web app, so it may not.

`bun run check-bun-imports` enforces that, and `bun run verify` runs it. It fails
on a value import, a bare import, a `require` or a dynamic `import()` of `bun` or
`bun:*` from anything the web app ships. A type-only import is allowed, because
it is erased before it reaches the runtime: `packages/realtime-server/src/socket.ts`
takes `ServerWebSocket` that way so `fromBunSocket` can adapt the development
server's socket without the node build ever resolving `bun`. Dev runs Next under
Bun and production runs it under node, so nothing else catches this before deploy.

Bun does not implement `process.loadEnvFile`. Load the repository `.env` with `bun --env-file=../../.env` in the script, never from inside a config file.

Bun does not load a parent directory `.env`, so a script running with its cwd inside a workspace package needs `--env-file=../../.env` to see the repository environment.

## Layout

```
apps/web                  Next.js app: UI, REST route handlers, auth, cron, and the
                          realtime socket at /api/ws
apps/realtime             Bun.serve WebSocket host, local development only, never deployed
packages/realtime-server  Connection hub: tickets, scopes, presence, Redis fan-out
packages/realtime-client  Browser socket client and React bindings
packages/services         Email layout, templates, and transports
packages/core             Domain services: organizations, members, invites, sync ids, outbox
packages/db               Drizzle schema, migrations, client
packages/shared           Zod validators, domain types, event contracts, policy, pure utils
scripts/                  repo tooling, written in TypeScript and run with bun
docs/                     specs, plans, provenance
```

Everything ships as one Next.js app. The realtime hub lives in a package so the app
stays thin and it keeps its own test suite. `apps/realtime` exists only so local
development has a socket server, because a node function cannot upgrade a connection
under `next dev`.

Cross-app code lives in `packages/shared`. If two apps need it, it belongs there, never duplicated.

## Commands

```
bun install              install every workspace dependency
bun run infra:up         start postgres, redis, minio
bun run db:push          apply schema to the dev database
bun run db:test-setup    create the per package test databases and push the schema
bun run dev              run web and realtime together
bun run verify           lint + comment policy + source bytes + Bun imports + dependency dedupe + typecheck + tests
bun test                 run one package's tests from inside that package
```

Ports: web 3300, realtime 3400, postgres 5436, redis 6382, minio 9030 (console 9031).
They avoid Orbit's ports so both projects run side by side. The realtime port is
development only. In production the socket is always served from the web app at
`/api/ws` on the page's own origin, and `NEXT_PUBLIC_REALTIME_URL` is a local
development override and nothing else. Never set it on a deployed environment.

Email goes out through Resend only. Set `RESEND_API_KEY` and an `EMAIL_FROM` on a
domain verified in Resend, otherwise every send fails.

## Conventions

- **Naming.** Files kebab-case. React components PascalCase. Hooks `use-*.ts`. Zod schemas `xSchema`, inferred types `X`. Database tables singular snake_case.
- **Imports.** Use workspace aliases `@gravity/db`, `@gravity/shared`. Inside `apps/web` use `@/`.
- **Validation.** Every route handler parses input with a Zod schema from `@gravity/shared`. Never trust a request body.
- **Errors.** Throw typed domain errors from `@gravity/shared/errors`. Route handlers map them to responses. Never swallow an error silently.
- **Server state.** TanStack Query for fetching, with optimistic mutations. The realtime stream invalidates and patches the cache; it never triggers a full refetch of a list the user is looking at.
- **Realtime.** Every mutation writes rows, bumps `sync_id` and inserts its `SyncAction`s into `outbox` in the same transaction; the route publishes after commit and the outbox job republishes anything left unpublished. The realtime server fans each action out to subscribed clients. Contract lives in `packages/shared/src/events`.
  A scope decides who is delivered a row, so it has to match who may read it.
- **Lock order.** A transaction that locks more than one kind of CRM row takes them in one order:
  person, then pipeline, then stage, then lead. `createLeadIn` share-locks the person before it locks the
  pipeline, `quickCreateLead` upserts the person before `createLeadIn` locks the pipeline, `createLeadsIn`
  (the import) locks the pipeline before it share-locks the stages, and stage edits lock the pipeline
  before the stage. Two writers that take the same rows in different orders can each hold what the other
  waits for, and Postgres then aborts one of them as a deadlock.
- **Socket lifetime.** A socket never outlives its session. Signing out publishes a session revocation on
  the control channel and the hub closes that connection, and the hub also sweeps the sessions behind every
  open connection on an interval, so an expired or deleted session is dropped even when nothing announced it.
- **Auth.** better-auth. Passkeys, Google, GitHub, email OTP. Email and password is
  optional, off unless `GRAVITY_PASSWORD_AUTH=true`, hashed with `@node-rs/argon2` (argon2id),
  rate limited, and never a replacement for the passwordless methods.
- **Email domains.** `ALLOWED_EMAIL_DOMAINS` is a comma-separated allowlist enforced on invite
  creation and on user creation, so it covers every provider. Empty means no restriction. A
  workspace can narrow it further with its own `allowedEmailDomains`.
- **Permissions.** All authorization goes through `packages/shared/src/policy`. Server routes enforce it. The UI reads the same policy to hide affordances, never as the only gate.
- **Motion.** No layout animation on the critical path, ever: nothing that triggers reflow may animate. Entrance, exit and gesture motion is transform and opacity only. Hover and focus state changes may additionally transition colour, which is what the task managers we measured against do, but only through the shared tokens in `apps/web/src/lib/interaction.ts` so the set stays auditable, never hand-rolled at a call site. Micro-interactions such as row and item highlights may go as fast as 80ms; nothing exceeds 200ms; everything respects `prefers-reduced-motion`.
- **Theming.** Light and dark both first class, driven by CSS custom properties and `next-themes`. Never hardcode a hex value in a component.
- **Accessibility.** Keyboard operable everywhere, visible focus rings, real semantics from Radix primitives.
- **Single instance dependencies.** A library whose types or runtime identity cross package boundaries,
  CodeMirror above all, must resolve to exactly one version. Bun keeps a transitive resolution that still
  satisfies its range, so bumping only the direct dependency leaves the old copy nested under every other
  package that wanted it. Two copies of `@codemirror/view` fail typecheck under `exactOptionalPropertyTypes`
  the moment a value crosses between them, and a facet or instance compared across the two copies is a
  runtime bug waiting for the next refactor to expose it. The `overrides` block
  in the root `package.json` is what collapses them, and `bun run check-deps` fails the build when an
  overridden package resolves twice or when a bump left in a manifest is one the override silently swallows.
  An override shadows a direct dependency too, so a real version move means editing both the manifest range
  and the override, then running `bun install`.

## Testing

- Unit and integration: `bun test`. Tests live in each package's own `tests/` tree, mirroring the
  layout of `src/`, never beside the code. `src/a/b/thing.ts` is tested by `tests/a/b/thing.test.ts`.
  Bun's scanner skips directories whose name starts with a dot, so a test for something under
  `src/app/.well-known/` goes in `tests/app/well-known/` or it silently never runs.
- Import test helpers from `bun:test`, never from `vitest`.
- A package that needs environment or a DOM configures it in its own `bunfig.toml` with a `tests-preload.ts`. DOM tests register happy-dom in that preload.
- Database tests run against the real Postgres from docker compose, in a transaction that rolls back. `scripts/test-env.ts` refuses to run against a database whose name does not match `/^gravity_test(?:_[a-z0-9]+)*$/`.
- Each package owns an isolated database (`gravity_test_core`, `gravity_test_db`, `gravity_test_svc`, `gravity_test_rts`, `gravity_test_rt`, `gravity_test_web`, `gravity_test_mcp`). Run `bun run db:test-setup` once after `bun run infra:up`, otherwise `bun run verify` fails on a clean checkout with connection errors rather than test failures.
- Two test runs at once need two lanes. Set `GRAVITY_TEST_LANE` to anything unique and the suite uses `gravity_test_core_<lane>` instead, where the lane is a readable stub plus a digest of the raw value so two lanes that normalise alike stay apart, cloned from the base database on first use, so a `resetDatabase` in one run cannot truncate tables out from under another. Without the variable nothing changes. This matters whenever several agents or worktrees run tests against the same Postgres: sharing one database shows up as deadlocks and foreign key violations that look like real failures.
- End to end: Playwright in `apps/web/e2e`.
- A feature is not done until it has tests that would fail if the feature broke.

## Git

- Branch per unit of work, PR into `main`, several small commits per PR.
- Commit subject in imperative mood, scoped: `feat(contacts): add table keyboard navigation`.
- Never commit `.env`, uploads, or recordings.

