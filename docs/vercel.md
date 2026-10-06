# Deploy Gravity on Vercel

Use [the hosted Gravity app](https://gravity.noveum.ai/sign-in) for immediate access. To run an independent instance, use **Deploy with Vercel** on the landing page or repository README, or import your own fork. The guided button uses email-code login through your own Resend account. Google/GitHub-only installations can use a normal repository import with those provider credentials instead.

The button clones this public source and creates your Vercel project. It never supplies Noveum's database, OAuth apps or provider credentials. Database migration and domain configuration are separate steps; a successful web build alone does not finish setup. [Vercel Deploy Button](https://vercel.com/docs/deploy-button), [environment parameters](https://vercel.com/docs/deploy-button/environment-variables).

## Database

1. Create a dedicated PostgreSQL database and review its backup/recovery policy.
2. Clone the repository and install the locked dependencies with Bun 1.3.14 and Node.js 22.12+.
3. Put a migration connection in ignored `.env.local` as `DATABASE_MIGRATION_URL`. Configure TLS and the provider CA if needed. Run `bun run db:migrate`.
4. Create a separate login role inheriting `gravity_app`; follow [Supabase setup](supabase.md) for the reviewed role pattern. Set `DATABASE_URL` to that restricted runtime connection and run `bun run db:check`.
5. Give Vercel only the runtime credentials. Do not deploy `DATABASE_MIGRATION_URL`, seed fictional records, or use a table-owning/bypass-RLS account as the application user.

Supabase uses the **session pooler on port 5432**, with its certificate authority in `DATABASE_SSL_CA`. Port 6543 transaction pooling is not supported by Gravity's current session behavior. Other PostgreSQL providers must support the application's session connection and verified TLS. Runtime regions default to Tokyo (`hnd1`); adjust your fork's deployment region to match your database when appropriate.

## Environment

The guided button asks for these environment values. Secrets belong in Vercel's environment settings, never the deploy URL, Git repository, issues or browser query strings.

| Variable | Value |
| --- | --- |
| `APP_URL` | Your stable HTTPS application origin, without a path or trailing slash. |
| `DATABASE_URL` | Your restricted PostgreSQL runtime connection. |
| `BETTER_AUTH_SECRET` | Persistent random secret, at least 32 characters. |
| `RESEND_API_KEY` | Your Resend key for email-code login. |
| `EMAIL_FROM` | A sender on your verified domain, e.g. `Gravity <login@your-domain.example>`. |
| `INTEGRATION_ENCRYPTION_KEY` | Persistent random **64-character hexadecimal** key for encrypted provider credentials. |
| `CRON_SECRET` | Independent random bearer secret, at least 32 characters, for authenticated background sync. |
| `CRM_DEMO_MODE` | Defaults to `false`; production never permits the fictional demo identity. |
| `DATABASE_SSL_MODE` | Defaults to `verify-full`. |
| `PUBLIC_SITE_INDEXING` | Defaults to `false` until your production public site is ready. |

Generate each secret independently with `openssl rand -hex 32`. Store the encryption key securely; replacing it makes previously encrypted account credentials unreadable.

Add `DATABASE_SSL_CA` when your provider needs a private certificate authority. Set `PUBLIC_SITE_URL` to the same origin as `APP_URL` before enabling indexing. Preview/staging installations need an isolated database, separate secrets and a stable callback origin.

For social sign-in, configure the corresponding complete pair: `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` or `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`. Social-only instances can omit Resend settings. Private storage uses the `S3_*` variables documented in [.env.example](../.env.example); review [storage design](architecture.md) before enabling real uploads.

## Deployment options

Use the repository root, Next.js framework and committed Bun install/build commands. Select Node.js 22 in your Vercel project settings.

Scheduled sync is not in the default `vercel.json`. The five-minute cron lives only in `vercel.scheduled.json`, and Vercel reads crons only from the root `vercel.json` it uploads. To deploy scheduled sync, copy `vercel.scheduled.json` over `vercel.json` in the source you deploy, deploy, then check that the production project lists the `/api/integrations/cron` cron. Deploying without that copy step ships no schedule, and provider sync then runs only when a user triggers it.

- **Basic Vercel:** the default `vercel.json` has no cron. Deploy normally; users can trigger provider sync manually. This avoids requiring a plan that supports a five-minute cron.
- **Scheduled Vercel:** copy `vercel.scheduled.json` over `vercel.json` in your deployment source before deploying on a plan that supports the included five-minute schedule. This is the configuration used by Noveum's hosted instance.
- **External scheduler:** keep the basic configuration and have your scheduler call `GET <APP_URL>/api/integrations/cron` with `Authorization: Bearer <CRON_SECRET>`. Keep the credential out of the URL. Provider account consent is still required.

Both configurations disable automatic Git deployments. Run checks on your fork, review any migrations, then deploy and promote the tested artifact. If you enable Git deployments, configure a deployment gate that enforces your CI. The existing optional preview workflow is separate and uses an isolated target; it does not migrate production.

Vercel's remote build reads the uploaded canonical `vercel.json`. A custom `--local-config` filename alone does not retain the cron schedule in a remote build. Review and commit your chosen root configuration in your fork. After promotion, verify the production project's cron definitions include `/api/integrations/cron` with `*/5 * * * *` when you selected scheduled sync.

```sh
bun run typecheck
bun run lint
bun run test
bun run build
bun run test:public

# Basic installation
bunx vercel@62.2.0 deploy --prod --skip-domain

# OR: five-minute provider sync on a compatible Vercel plan
cp vercel.scheduled.json vercel.json
bunx vercel@62.2.0 deploy --prod --skip-domain

# Verify the created artifact, then switch the production domain.
bunx vercel@62.2.0 promote <deployment-url>
bun run test:deployment https://your-gravity-domain.example
```

## Domain and callbacks

Add your domain in Vercel, configure its DNS, set `APP_URL` and `PUBLIC_SITE_URL`, then redeploy. Register the exact HTTPS callbacks:

| Feature | Callback |
| --- | --- |
| Google login | `<APP_URL>/api/auth/callback/google` |
| GitHub login | `<APP_URL>/api/auth/callback/github` |
| Gmail and primary Google Calendar | `<APP_URL>/api/integrations/callback/google` |

Email-code login requires your verified Resend sender and no social callback. Google sign-in does not connect Gmail or Calendar; each user separately authorizes their account in Connections. Unipile and Fireflies credentials are entered by their owner in the app rather than shared instance variables.

For Codex, Claude Code or another OAuth MCP client, connect to `<APP_URL>/mcp`, sign in, and review the organization/product grant. [Assistant setup](setup-and-mcp.md) covers consent and revocation.

## Verify and operate

Check `/api/health` returns `ready`, verify sign-in and onboarding, add a contact, save a deal, then refresh to confirm persistence. Qualify product restrictions with a second user and revoke/reconnect one assistant grant. Check each provider's actual consent and sync before relying on its imported data.

Sending is implemented for Gmail and LinkedIn. A message goes out only through an explicit `send_touch` or `send_action` call, made by an assistant holding `crm:send` or through the same operation on `/api/outreach`. In the workspace, an approved touch (Outreach > Approved, its row and its drawer) or an approved follow-up (the draft panel) has Send now, which shows readiness and asks you to confirm the recipient, account and channel. No keyboard shortcut sends. Unsettled deliveries appear under Outreach > Sent with Reconcile for the sender and Resolve for an admin. Each send needs a current approval, the owner's provider consent (Gmail asks for `gmail.send` separately from read access) and a durable idempotency key, and the contact rules apply. An outcome the provider leaves unclear is recorded as unknown and is never retried automatically: reconcile it with `reconcile_delivery`, or have an admin close it with `resolve_delivery`. Scheduled sync imports replies; it never sends.

Database backups do not include uploaded files. Keep private storage backups separately and rehearse recovery. Provider-key rotation, stable encryption-key retention and migration review remain the operator's responsibility.
