# CI and preview deployment

## Continuous integration

Pushes to `main` and pull requests run the `CI` workflow on GitHub Actions as parallel jobs: dependency audit, declared-license coverage, TypeScript and Biome; the Vitest suites split across three shards; the production-driver suite (`tests/outreach-postgres.test.ts`) against a PostgreSQL 17 service container; the production build followed by public-page HTTP smoke checks with demo access disabled; and the Playwright file-browser suite (`bun run test:files`) against the local demo. A final `CI ok` job passes only when every job passed, and is the single check to require in branch protection. No cloud credentials are required. Actions are pinned to verified full commit SHAs, checkout credentials are not persisted, permissions are read-only, superseded pull request runs are cancelled and every `main` commit keeps its own result. Dependabot proposes weekly Bun and action updates; updates are reviewed rather than auto-merged. [GitHub action security](https://docs.github.com/en/actions/reference/security/secure-use), [Bun support](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories).

Separate workflows run CodeQL security analysis, Markdown link checks, area labels on pull requests, a greeting for first-time contributors and stale-thread handling. `bun run verify` runs the same lint, license, type, test, build and smoke steps locally. To run the PostgreSQL suite locally, point `GRAVITY_POSTGRES_TEST_URL` at a local superuser URL.

## Optional Vercel preview

The manual `Vercel preview` workflow is inactive by default. It only runs trusted `main` source after `VERCEL_PREVIEW_ENABLED=true`; it repeats tests, pulls preview configuration, builds with pinned Vercel CLI 62.2.0 and deploys the prebuilt preview artifact. There is no production deployment or automatic external migration in this workflow. The separate hosted production installation uses reviewed CLI deployments and promotion.

To activate after reviewing the production gates:

1. Create a separate Gravity Vercel project and isolated staging PostgreSQL/private bucket. Configure Node 22, root directory `/`, Next.js and the committed build/install commands.
2. Review and apply migrations to staging with a limited migration role and backup/restore plan; supply a separate least-privileged runtime database URL. Never use the fictional local database or demo identity in deployed environments.
3. Set preview application variables described in [setup](setup-and-mcp.md), including HTTPS `APP_URL`, `CRM_DEMO_MODE=false`, auth secret and social callbacks. Use a stable staging hostname for OAuth resource/callback binding; an arbitrary changing preview URL is insufficient.
4. Set GitHub environment `preview`, secret `VERCEL_TOKEN`, and repository variables `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` for that reviewed project. Do not paste credentials into issues or source. Enable `VERCEL_PREVIEW_ENABLED` only when the target is ready.
5. Run the workflow on `main`. Qualify Google/GitHub login, two-user membership boundaries, Codex/Claude consent, private storage and disconnect/revocation on that exact HTTPS origin before promoting any real-data installation.

Do not independently enable automatic Git production deployments while assuming they wait for this GitHub CI; that needs an explicit deployment gate. [Vercel Git behavior](https://vercel.com/docs/git/vercel-for-github).

## Managed PostgreSQL deployment

The database setup adds Supabase migrations, a non-owner runtime role, certificate verification, table RLS and a sanitized `/api/health` endpoint. A separate Vercel project can run this foundation against managed PostgreSQL. The deployment configuration disables automatic Git deployments; a push must not bypass the repository checks or silently apply external migrations. Production application environments receive only runtime credentials; schema migrations are reviewed and applied separately. Preview environments still require an isolated database and callback origin. See [Supabase setup](supabase.md).

Direct authenticated object uploads/downloads must replace function-proxied large transfers before files are enabled on Vercel. Gmail/Calendar consent, owner-configured Unipile/Fireflies, encrypted credentials, idempotent ingestion and import review are implemented. Workspace invitations use copied links bound to a verified recipient email, with admin role/product access management. Provider login, two-user permissions and actual assistant consent need live qualification before relying on the installation for real sales work. Daily database backups do not cover uploaded file contents. A new installation supplies its own database, authentication and private storage; it never inherits hosted credentials.


## Provider sync deployment

Migration 0007 and persistent `INTEGRATION_ENCRYPTION_KEY`/`CRON_SECRET` are required before deploying the provider connection slice. Never run migrations from the web runtime. The default `vercel.json` uses manual sync and has no cron. `vercel.scheduled.json` schedules a five-minute private background route on compatible plans; self-hosters can call the same route from their scheduler. Configure Google’s separate integration callback and enable the APIs, then complete owner consent. LinkedIn and Fireflies require their own account credentials and signed webhook setup; see [connectors](connectors.md). No provider secrets are required by CI.

## Public deployment options

The landing page and README offer a Vercel clone button with environment **names** and non-sensitive flag defaults. [Vercel setup](vercel.md) covers runtime/migration roles, callbacks, independent credentials, basic and scheduled profiles. The hosted instance uploads the scheduled profile as the canonical `vercel.json` when deploying, then verifies the actual production project cron definitions after promotion. A custom `--local-config` filename alone does not configure the remote build.
