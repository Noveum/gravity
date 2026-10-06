# Contributing to Gravity

Thanks for being here. Gravity is a free, open-source CRM for teams that sell
several products to overlapping people, and it gets better with every bug report,
docs fix and pull request.

This guide covers everything from a first typo fix to a change that touches the
database, the HTTP API and the MCP server at once.

- [Ways to contribute](#ways-to-contribute)
- [Set up your machine](#set-up-your-machine)
- [Find something to work on](#find-something-to-work-on)
- [The development loop](#the-development-loop)
- [How the code fits together](#how-the-code-fits-together)
- [Rules that are not negotiable](#rules-that-are-not-negotiable)
- [Writing tests](#writing-tests)
- [Database migrations](#database-migrations)
- [Sending a pull request](#sending-a-pull-request)
- [Review and merge](#review-and-merge)
- [Getting help](#getting-help)

## Ways to contribute

You do not need to write TypeScript to make Gravity better.

| Contribution | Where it goes |
| --- | --- |
| Fix a bug | A pull request, ideally with a failing test first |
| Improve the docs | Anything under `docs/`, or the README |
| Report a bug | [New bug report](https://github.com/Noveum/gravity/issues/new?template=bug_report.yml) |
| Suggest a feature | [New feature request](https://github.com/Noveum/gravity/issues/new?template=feature_request.yml) |
| Ask or answer a question | [Discussions](https://github.com/Noveum/gravity/discussions) |
| Translate the interface | Strings live in `packages/i18n/translations/en.json`; open an issue to coordinate a new locale |
| Improve accessibility | Always welcome |
| Design | Open an issue with a screenshot or mock-up |

## Set up your machine

You need **Node.js 22.12 or newer** and **[Bun](https://bun.sh) 1.3.14**. No
Docker, database, cloud account or API key is required.

```bash
git clone https://github.com/Noveum/gravity.git
cd gravity
bun install --frozen-lockfile
bun run dev
```

Open <http://127.0.0.1:3014>. The first run creates an embedded PostgreSQL
database (PGlite) in `.data/postgres`, applies the migrations and seeds fictional
workspaces. You are signed in automatically as a demo user. Both `.data/` and
`.env*` are ignored by Git.

Things to click on straight away:

- **Northstar Collective** has three products sharing some of the same people.
  Open **Next actions**, select Mira's blocked follow-up, read her reply in the
  inspector and rework the draft.
- **Lunar Studio** is a separate organization, useful for checking that nothing
  leaks between tenants.
- Press <kbd>?</kbd> for every keyboard shortcut, or <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> <kbd>K</kbd>
  for the command menu.

You only need a `.env` file when you work on real sign-in, a real PostgreSQL
database or provider connections. Copy `.env.example` and read
[setup and MCP](docs/setup-and-mcp.md) for each variable.

### Resetting the local database

Stop the dev server, delete `.data/`, and start it again. To run
`bun run db:migrate` or `bun run db:seed` by hand, stop the dev server first:
PGlite supports one process at a time.

## Find something to work on

- [**Good first issues**](https://github.com/Noveum/gravity/labels/good%20first%20issue)
  are small and name the files involved.
- [**Help wanted**](https://github.com/Noveum/gravity/labels/help%20wanted) are
  larger pieces we would like a hand with.
- The [**roadmap**](docs/roadmap.md) lists the next slices and production gates.

Comment on an issue before you start so nobody duplicates your work. For anything
bigger than a bug fix, agree the approach on the issue first; it saves rewriting
a finished pull request.

## The development loop

```bash
bun run dev          # app on http://127.0.0.1:3014 with hot reload
bun run verify       # the CI checks in one command (CI also runs bun audit)
bun run format       # apply Biome formatting and safe lint fixes
```

Run a single test file while you work:

```bash
bun run test tests/records.test.ts
```

`bun run verify` runs these in order, and CI runs the same steps in parallel:

| Command | What it checks |
| --- | --- |
| `bun run lint` | Biome formatting and lint rules |
| `bun run licenses:check` | Every installed dependency declares a license |
| `bun run typecheck` | Strict TypeScript |
| `bun run test` | The Vitest suites |
| `bun run build` | Production Next.js build |
| `bun run test:public` | Starts the built app with no database or demo identity and checks the public pages |

CI additionally runs `bun audit` for known vulnerabilities in locked dependencies.
While iterating, `bun run typecheck && bun run test` is the fast subset.

## How the code fits together

```text
src/app/                 Next.js App Router: pages, HTTP routes, sign-in, OAuth, /mcp
src/components/          Queue, inspector, records, dialogs, command menu
packages/operations/     The business API registry: one definition per operation
packages/core/           Authorized domain services, permissions, outreach logic
packages/database/       Drizzle schema, PostgreSQL and PGlite clients, fictional seed
packages/auth/           Better Auth configuration, social and email sign-in
packages/mcp/            MCP server that registers a tool for every operation
packages/connectors/     Gmail, Calendar, Unipile LinkedIn and Fireflies adapters
packages/storage/        Private file storage and validation
packages/i18n/           Interface strings
drizzle/                 Generated SQL migrations
tests/                   Vitest suites: SQL, HTTP, OAuth, MCP and React
```

The most important idea: **every business operation is defined once** in
`packages/operations/catalog.ts`. The HTTP adapter and the MCP server both execute
that registry, so a new operation automatically becomes an API route and an
assistant tool, with the same schema and the same permission checks. Read
[architecture](docs/architecture.md) for tenant boundaries and storage decisions.

## Rules that are not negotiable

These come from [`AGENTS.md`](AGENTS.md), which your editor or coding assistant
can read directly.

- **Bun manages packages.** Do not add `package-lock.json`, `yarn.lock` or
  `pnpm-lock.yaml`. Shipped code runs on Node.
- **TypeScript is strict.** Fix the type, do not cast around it.
- **Every tenant-owned row has an organization ID**, and product-owned children
  belong to the same product. Queries filter by both.
- **Never add an HTTP-only business handler.** Add the operation to
  `packages/operations/catalog.ts` so MCP gets it too. Transport protocols (auth,
  OAuth consent, callbacks, signed webhooks, cron, SSE) stay separate.
- **Nothing sends a message implicitly.** Only the explicit `send_touch` and
  `send_action` operations dispatch, and only with a current approval, provider
  consent, owner and product authorization and a durable idempotency key. A due
  date, approval, sequence step or webhook is never permission to send, and an
  unknown outcome is never retried automatically.
- **Interface strings go in `packages/i18n/translations/en.json`.**
- **Fictional data only.** Never commit real contacts, credentials, transcripts,
  message bodies or uploaded files. Keep fixtures separate from domain code.
- **The demo is never production.** Demo identities and PGlite must stay disabled
  when `CRM_DEMO_MODE` is off or `DATABASE_URL` is set.

## Writing tests

Tests live in `tests/` and run with Vitest. SQL tests run against real migrations
on PGlite, so constraints and foreign keys are exercised, not mocked. React tests
use Testing Library with jsdom.

A feature is done when it has a test that would fail if the feature broke. For
anything that reads or writes CRM data, include the cases that matter most:

- a user from **another organization** cannot see or change it,
- a member **restricted to another product** cannot see or change it,
- another user cannot read a **private conversation** they were not shared on,
- an **approved draft is invalidated** when its content, recipient or a new reply
  changes the situation.

Look at `tests/records.test.ts`, `tests/mcp-write.test.ts` and
`tests/conversation-sharing.test.tsx` for the patterns.

## Database migrations

1. Change `packages/database/schema.ts`.
2. Run `bun run db:generate` to create a migration in `drizzle/`.
3. Delete `.data/` and run the app, or run the SQL tests, to apply it from a clean
   database.
4. Commit the schema change and the generated migration together.

Never edit a migration that has already shipped. Never point migration commands at
a shared or production database without reviewing the target and its backup.

## Sending a pull request

1. Fork the repository and create a branch from `main`.
2. Make a focused change. Unrelated refactors make review slower.
3. Run `bun run verify`.
4. Open the pull request and fill in the template: what changes, how you know it
   works, screenshots for UI changes (light and dark), and anything unfinished.

UI changes should be checked in light and dark themes, with the keyboard, at a
narrow width, and in their loading and error states.

Dependency updates must keep `bun.lock` in sync, pass `bun audit`, and refresh
the license inventory with `bun run licenses`.

## Review and merge

A maintainer reviews within a few working days. CI must be green. The
`CI ok` check gates merging. We usually squash-merge, so the pull request title
becomes the commit message: write it as a sentence describing the change.

By contributing you agree that your contribution is licensed under the
[Apache License 2.0](LICENSE). Everyone taking part is expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Getting help

- Stuck on setup or unsure about an approach: [Discussions](https://github.com/Noveum/gravity/discussions).
- Found a bug: [open an issue](https://github.com/Noveum/gravity/issues/new/choose).
- Found a security problem: follow [SECURITY.md](SECURITY.md), privately.
