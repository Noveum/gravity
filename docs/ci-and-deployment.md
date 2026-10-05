# CI and preview deployment

## Continuous integration

Pushes to `main` and pull requests run the `foundation` check on GitHub Actions: frozen Bun install, dependency audit, declared-license coverage for installed locked packages, TypeScript, Biome, all SQL/HTTP/OAuth/UI tests and production build, followed by public-page HTTP smoke checks with demo access disabled. No cloud credentials are required. Actions are pinned to verified full commit SHAs, checkout credentials are not persisted, permissions are read-only and superseded runs are cancelled. Dependabot proposes weekly Bun and action updates; updates are reviewed rather than auto-merged. [GitHub action security](https://docs.github.com/en/actions/reference/security/secure-use), [Bun support](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories).

## Optional Vercel preview

The manual `Vercel preview` workflow is inactive by default. It only runs trusted `main` source after `VERCEL_PREVIEW_ENABLED=true`; it repeats tests, pulls preview configuration, builds with pinned Vercel CLI 62.2.0 and deploys the prebuilt preview artifact. There is no production deployment or automatic external migration in this workflow. It has not been executed against a configured project.

To activate after reviewing the production gates:

1. Create a separate Gravity Vercel project and isolated staging PostgreSQL/private bucket. Keep the existing Twenty CRM domain untouched. Configure Node 22, root directory `/`, Next.js and the committed build/install commands.
2. Review and apply migrations to staging with a limited migration role and backup/restore plan; supply a separate least-privileged runtime database URL. Never use the fictional local database or demo identity in deployed environments.
3. Set preview application variables described in [setup](setup-and-mcp.md), including HTTPS `APP_URL`, `CRM_DEMO_MODE=false`, auth secret and social callbacks. Use a stable staging hostname for OAuth resource/callback binding; an arbitrary changing preview URL is insufficient.
4. Set GitHub environment `preview`, secret `VERCEL_TOKEN`, and repository variables `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` for that reviewed project. Do not paste credentials into issues or source. Enable `VERCEL_PREVIEW_ENABLED` only when the target is ready.
5. Run the workflow on `main`. Qualify Google/GitHub login, two-user membership boundaries, Codex/Claude consent, private storage and disconnect/revocation on that exact HTTPS origin before promoting any real-data installation.

Do not independently enable automatic Git production deployments while assuming they wait for this GitHub CI; that needs an explicit deployment gate. [Vercel Git behavior](https://vercel.com/docs/git/vercel-for-github).

## Managed PostgreSQL deployment

The database setup adds Supabase migrations, a non-owner runtime role, certificate verification, table RLS and a sanitized `/api/health` endpoint. A separate Vercel project can run this foundation against managed PostgreSQL. The deployment configuration disables automatic Git deployments; a push must not bypass the repository checks or silently apply external migrations. Production application environments receive only runtime credentials; schema migrations are reviewed and applied separately. Preview environments still require an isolated database and callback origin. See [Supabase setup](supabase.md).

Direct authenticated object uploads/downloads must replace function-proxied large transfers before files are enabled on Vercel. Provider connection UX, encrypted credentials, durable ingestion, historical-event handling and invites remain unfinished. Provider login, two-user permissions and actual assistant consent need live qualification before relying on the installation for real sales work. Daily database backups do not cover uploaded file contents. This setup does not upgrade compute, enable paid backup/IPv4 add-ons, or transfer the existing Twenty domain.


## Provider sync deployment

Migration 0007 and persistent `INTEGRATION_ENCRYPTION_KEY`/`CRON_SECRET` are required before deploying the provider connection slice. Never run migrations from the web runtime. `vercel.json` schedules a five-minute private background route on compatible plans; self-hosters can call the same route from their scheduler. Configure Google’s separate integration callback and enable the APIs, then complete owner consent. LinkedIn and Fireflies require their own account credentials and signed webhook setup; see [connectors](connectors.md). No provider secrets are required by CI.
