# Contributing to Gravity

Gravity is a foundation preview. Check [requirements](docs/requirements.md) and [roadmap](docs/roadmap.md) before building a feature; incomplete adapters must remain visibly disconnected.

Use Node from `.nvmrc` and Bun 1.3.14. Clone the repository, run `bun install --frozen-lockfile`, then `bun run dev`. The demo uses fictional records and local PGlite; do not introduce a production database or real mail into the development fixture. Keep `.data`, `.env*`, uploads and tokens out of Git.

Create a feature branch and a focused pull request. Run `bun run typecheck`, `bun run lint`, `bun run test`, `bun run build` and `bun audit`. CI repeats these checks on Linux without cloud credentials. Include the problem, resulting behavior, relevant verification and any remaining limitations. UI changes need light/dark, keyboard, narrow-screen and pending/error-state review.

Interface strings belong in `packages/i18n/translations/en.json`. HTTP and MCP must call the same authorized domain services. Every tenant/product child needs consistent composite foreign keys and permission checks; test another tenant, a restricted product member and a private conversation owner. Demo identity is never production authentication. Provider normalization must preserve idempotency, source account, chronology and visibility.

Generate migrations with `bun run db:generate` and exercise a clean local database through the SQL tests. Stop the app before standalone local migration commands. External migrations need a reviewed target and recovery plan. Never modify a previously shipped migration to change existing data.

Dependency updates must retain the lockfile, pass the audit and exercise the affected CLI/runtime path. Refresh the dependency license inventory with `bun run licenses` and inspect new license terms. Do not publish npm artifacts from this application repository; `private: true` is intentional. Contributed code is licensed under Apache-2.0. Report security concerns privately using [SECURITY.md](SECURITY.md).
