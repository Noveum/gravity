# CI and deployment

## Continuous integration

Pushes to `main` and pull requests run the `CI` workflow on GitHub Actions as parallel jobs: dependency audit, declared-license coverage, TypeScript and Biome; the Vitest suites split across three shards; the production-driver suite (`tests/outreach-postgres.test.ts`) against a PostgreSQL 17 service container; the Next.js production build followed by public-page HTTP smoke checks with demo access disabled, then the Cloudflare Worker build; and the Playwright file-browser suite (`bun run test:files`) against the local demo. A final `CI ok` job passes only when every job passed, and is the single check to require in branch protection. No cloud credentials are required. Actions are pinned to verified full commit SHAs, checkout credentials are not persisted, permissions are read-only, superseded pull request runs are cancelled and every `main` commit keeps its own result. Dependabot proposes weekly Bun and action updates; updates are reviewed rather than auto-merged. [GitHub action security](https://docs.github.com/en/actions/reference/security/secure-use), [Bun support](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories).

Separate workflows run CodeQL security analysis, Markdown link checks, area labels on pull requests, a greeting for first-time contributors and stale-thread handling. `bun run verify` runs the same lint, license, type, test, build and smoke steps locally. To run the PostgreSQL suite locally, point `GRAVITY_POSTGRES_TEST_URL` at a local superuser URL.

## Deployment and previews

Gravity deploys only to Cloudflare Workers, through Workers Builds. The Worker `gravity` is built and deployed from `main`. A second Worker, `gravity-pr`, receives every other branch as an uploaded version with its own preview URL; it has its own database and secrets, no Cron Trigger, and never receives production credentials. [Deploy on Cloudflare Workers](cloudflare.md#workers-builds) lists the exact build settings.

Workers Builds does not wait for GitHub Actions. Merge to `main` only after `CI ok` passes, and require that check in branch protection, so an unchecked change cannot reach production. Neither Worker applies migrations: they are reviewed and applied from a trusted workstation before the code that needs them is merged.

## Managed PostgreSQL deployment

The database setup adds migrations, a non-owner runtime role, certificate verification, table RLS and a sanitized `/api/health` endpoint. A push must not bypass the repository checks or silently apply external migrations. Production application environments receive only runtime credentials; schema migrations are reviewed and applied separately. Preview environments still require an isolated database and callback origin. See [Supabase setup](supabase.md).

Uploads and downloads travel between the browser and the private bucket through short-lived signed URLs. Gmail/Calendar consent, owner-configured Unipile/Fireflies, encrypted credentials, idempotent ingestion and import review are implemented. Workspace invitations use copied links bound to a verified recipient email, with admin role/product access management. Provider login, two-user permissions and actual assistant consent need live qualification before relying on the installation for real sales work. Daily database backups do not cover uploaded file contents. A new installation supplies its own database, authentication and private storage; it never inherits hosted credentials.


## Provider sync deployment

Migration 0007 and persistent `INTEGRATION_ENCRYPTION_KEY`/`CRON_SECRET` are required before deploying the provider connection slice. Never run migrations from the web runtime. The Worker's Cron Trigger calls the private background route every five minutes; any other scheduler can call the same route with `Authorization: Bearer <CRON_SECRET>`. Configure Google’s separate integration callback and enable the APIs, then complete owner consent. LinkedIn and Fireflies require their own account credentials and signed webhook setup; see [connectors](connectors.md). No provider secrets are required by CI.

## Public deployment options

The landing page and README link to [the Cloudflare guide](cloudflare.md), which covers runtime and migration roles, callbacks, independent credentials and the scheduled sync. No deploy button supplies settings: each installation creates its own Worker, database and secrets.
