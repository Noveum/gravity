# CI and preview deployment

## Continuous integration

Pushes to `main` and pull requests run the `foundation` check on GitHub Actions: frozen Bun install, dependency audit, TypeScript, Biome, all SQL/HTTP/OAuth tests and production build. No cloud credentials are required. Actions are pinned to verified full commit SHAs, checkout credentials are not persisted, permissions are read-only and superseded runs are cancelled. Dependabot proposes weekly Bun and action updates; updates are reviewed rather than auto-merged. [GitHub action security](https://docs.github.com/en/actions/reference/security/secure-use), [Bun support](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories).

## Optional Vercel preview

The manual `Vercel preview` workflow is inactive by default. It only runs trusted `main` source after `VERCEL_PREVIEW_ENABLED=true`; it repeats tests, pulls preview configuration, builds with pinned Vercel CLI 62.2.0 and deploys the prebuilt preview artifact. There is no production deployment or automatic external migration in this workflow. It has not been executed against a configured project.

To activate after reviewing the production gates:

1. Create a separate Gravity Vercel project and isolated staging PostgreSQL/private bucket. Keep the existing Twenty CRM domain untouched. Configure Node 22, root directory `/`, Next.js and the committed build/install commands.
2. Review and apply migrations to staging with a limited migration role and backup/restore plan; supply a separate least-privileged runtime database URL. Never use the fictional local database or demo identity in deployed environments.
3. Set preview application variables described in [setup](setup-and-mcp.md), including HTTPS `APP_URL`, `CRM_DEMO_MODE=false`, auth secret and social callbacks. Use a stable staging hostname for OAuth resource/callback binding; an arbitrary changing preview URL is insufficient.
4. Set GitHub environment `preview`, secret `VERCEL_TOKEN`, and repository variables `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` for that reviewed project. Do not paste credentials into issues or source. Enable `VERCEL_PREVIEW_ENABLED` only when the target is ready.
5. Run the workflow on `main`. Qualify Google/GitHub login, two-user membership boundaries, Codex/Claude consent, private storage and disconnect/revocation on that exact HTTPS origin before promoting any real-data installation.

Do not independently enable automatic Git production deployments while assuming they wait for this GitHub CI; that needs an explicit deployment gate. [Vercel Git behavior](https://vercel.com/docs/git/vercel-for-github).

Direct authenticated object uploads/downloads must replace function-proxied large transfers before files are enabled on Vercel. Provider connection UX, encrypted credentials, durable ingestion, historical-event handling, invites and production backups remain unfinished. No production project, credentials, database, domain transfer or paid service was created by this release preparation.
