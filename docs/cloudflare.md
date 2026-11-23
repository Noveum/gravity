# Deploy Gravity on Cloudflare Workers

Gravity runs on Cloudflare Workers through [vinext](https://github.com/cloudflare/vinext), which serves the `src/app` routes on the Workers runtime. `bun run build:worker` produces the Worker; `bun run build` still produces the Next.js build that CI checks and that `bun run dev` serves locally. Application code is shared. Only the pieces below are specific to Workers.

Use [the hosted Gravity app](https://gravity.noveum.ai/sign-in) for immediate access. This guide is for an independent installation in your own Cloudflare account. Nothing in it uses Noveum's database, OAuth apps or provider credentials.

| Piece | On Workers |
| --- | --- |
| Entry | `worker/index.ts` hands requests to vinext and runs the Cron Trigger |
| Configuration | `cloudflare.config.ts` (name, compatibility, assets, cron, bindings) and `vite.config.ts` |
| PostgreSQL | One connection per invocation, through Hyperdrive or a direct `DATABASE_URL` |
| Scheduled sync | Cron Trigger every five minutes, calling `/api/integrations/cron` with `CRON_SECRET` |
| Files | The S3 client, pointed at R2's S3 endpoint or another S3-compatible bucket |
| Settings | Worker secrets |
| Branch previews | A second Worker, `gravity-pr`, built in the `pr` mode |

## Requirements

- The Workers Paid plan. The Worker is about 3.3 MiB compressed, above the 3 MiB limit of the free plan.
- Node.js 22.23.4, as pinned in `.nvmrc`, and Bun 1.3.14. Node releases before 22.22.2 skip `src/app/.well-known` during the build, which removes the OAuth discovery routes that assistants need.
- `cf`, the Cloudflare CLI installed with the project. It keeps its own sign-in, separate from Wrangler: run `npx cf auth login` once, or set `CLOUDFLARE_API_TOKEN` (and `CLOUDFLARE_ACCOUNT_ID` when the token reaches more than one account). `cf` and `@cloudflare/vite-plugin` are release candidates and must be upgraded together; `cf deploy` rejects a build written by an older plugin.

## Database

1. Create a dedicated PostgreSQL database and review its backup and recovery policy.
2. Clone the repository and install the locked dependencies with `bun install --frozen-lockfile`.
3. Put a migration connection in ignored `.env.local` as `DATABASE_MIGRATION_URL`, with TLS settings and the provider CA if needed. Run `bun run db:migrate`.
4. Create a separate login role inheriting `gravity_app`; [Supabase setup](supabase.md) has the reviewed role pattern. Point `DATABASE_URL` at that restricted runtime connection and run `bun run db:check`.
5. Give the Worker only the runtime credentials. Never deploy `DATABASE_MIGRATION_URL`, seed fictional records, or run the application as a table-owning or RLS-bypassing account. Migrations are applied from a trusted workstation, never from the Worker.

A Worker opens TLS only to a server whose certificate chains to a public certificate authority. It has no setting for a private CA, so `DATABASE_SSL_CA` has no effect on Workers.

- **Supabase, or any database with a private CA:** connect through [Hyperdrive](https://developers.cloudflare.com/hyperdrive/). Hyperdrive holds the connection string and the CA, verifies the certificate and hostname itself, and pools connections. It is included in the Workers Paid plan.
- **A database with a public certificate:** use Hyperdrive as well for its pool, or set the `DATABASE_URL` secret and leave Hyperdrive out.

Each open request holds one database connection for as long as it runs, and a live-update stream runs for 25 seconds at a time. Without Hyperdrive every open browser tab therefore holds a connection of the runtime role. With Hyperdrive the Worker holds a connection to the pool, and the database only sees the pool.

Create the Hyperdrive configuration once, with the restricted runtime role. For Supabase, use the direct connection string, not a Supabase pooler. Query caching must stay off: Gravity reads its own writes and checks permissions on every read. On the Hyperdrive connection the driver uses prepared statements, which Hyperdrive requires of postgres.js; without them queries can hang.

```sh
npx wrangler cert upload certificate-authority --ca-cert database-ca.pem --name gravity-database-ca
npx wrangler hyperdrive create gravity \
  --connection-string="postgres://RUNTIME_ROLE:PASSWORD@HOST:5432/DATABASE" \
  --ca-certificate-id <CA_CERTIFICATE_ID> --sslmode verify-full \
  --caching-disabled true --origin-connection-limit 10
```

Leave out the certificate upload and `--ca-certificate-id` when the database certificate comes from a public authority. Keep the origin connection limit below the connection limit of the runtime role. Pass the configuration ID to every build as `GRAVITY_HYPERDRIVE_ID`.

## Settings

Every setting is a Worker secret.

| Secret | Value |
| --- | --- |
| `APP_URL` | Required. The stable HTTPS origin, without a path or trailing slash. |
| `BETTER_AUTH_SECRET` | Required. A persistent random secret of at least 32 characters. |
| `INTEGRATION_ENCRYPTION_KEY` | Required. A persistent random **64-character hexadecimal** key for encrypted provider credentials. |
| `CRON_SECRET` | Required. An independent random bearer secret of at least 32 characters for the scheduled sync. |
| `DATABASE_URL` | Required without Hyperdrive: the restricted runtime connection. Leave it, `DATABASE_SSL_MODE` and `DATABASE_SSL_CA` out when Hyperdrive is used. |
| `RESEND_API_KEY`, `EMAIL_FROM` | Email-code sign-in through your Resend account, from a sender on your verified domain, such as `Gravity <login@your-domain.example>`. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in, and the Gmail and Calendar connections. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | GitHub sign-in. |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Private file storage. See [Files on R2](#files-on-r2). |
| `PUBLIC_SITE_URL` | The same origin as `APP_URL`, before indexing is turned on. |
| `PUBLIC_SITE_INDEXING` | `true` only on the production site, once its public pages are ready. Any other value keeps every page out of search engines. |
| `CRM_DEMO_MODE` | `false`. The Worker never runs the fictional demo. |

At least one sign-in method, email codes or a social provider, must be configured or `/api/health` reports `unavailable`. Generate each secret independently with `openssl rand -hex 32`. Reuse the existing `BETTER_AUTH_SECRET` and `INTEGRATION_ENCRYPTION_KEY` when moving an installation: new values sign every user out, make the stored signing keys unreadable so that session checks fail until the `jwks` rows are removed, and make stored provider credentials unreadable.

`cloudflare.config.ts` declares the required names. Upload them with the first deploy from a JSON file outside the repository, one object of names to strings. Prefer JSON to a dotenv file: `cf` expands `$NAME` inside dotenv values, which corrupts a password that contains a dollar sign. `cf` reads only the declared names from that file and ignores the rest, so add each optional setting on its own afterwards. Each change creates and deploys a new version:

```sh
npx cf workers secrets update RESEND_API_KEY --worker gravity --type secret_text --text "<value>"
```

Secrets stay on the Worker across later deploys. `cf deploy` and `cf workers versions create` upload new code with `keep_bindings` set for secrets, so a deploy without `--secrets-file` neither removes nor changes any secret, declared or not. A declared secret that is missing from both the Worker and the secrets file fails the deploy.

## Build and deploy

The first deploy carries the secrets:

```sh
bun install --frozen-lockfile
GRAVITY_HYPERDRIVE_ID=<ID> bun run build:worker
npx cf deploy --prebuilt --mode production --secrets-file ../gravity.secrets.json
```

Every later release is one build and one deploy:

```sh
GRAVITY_HYPERDRIVE_ID=<ID> bun run build:worker
bun run deploy:worker
```

`build:worker` builds in Vite's `production` mode and writes the result to `.cloudflare/output`. `deploy:worker` runs `cf deploy --prebuilt --mode production`, which refuses a build made in any other mode. Build variables are read by the build only.

| Build variable | Purpose |
| --- | --- |
| `GRAVITY_HYPERDRIVE_ID` | Hyperdrive configuration for the `HYPERDRIVE` binding. Unset, the Worker uses the `DATABASE_URL` secret. |
| `GRAVITY_PLACEMENT_REGION` | Runs the Worker beside a database in a known cloud region from the first request, in Cloudflare's `provider:region` form, for example `aws:us-east-1`. Unset, Smart Placement learns the location from traffic. The `cf-placement` response header shows where a request ran. |

After a deploy, check that `/api/health` returns `ready`, sign in, save a record, and confirm in the dashboard that the `*/5 * * * *` trigger ran. `bun run test:deployment https://your-domain.example` checks the public pages, sign-in, health endpoint, icons and the MCP OAuth challenge.

## Domain and callbacks

Add the domain to the Worker as a Custom Domain; Cloudflare creates the proxied record and the certificate. Set `APP_URL` and `PUBLIC_SITE_URL` to that origin. Then register the exact HTTPS callbacks:

| Feature | Callback |
| --- | --- |
| Google login | `<APP_URL>/api/auth/callback/google` |
| GitHub login | `<APP_URL>/api/auth/callback/github` |
| Gmail and primary Google Calendar | `<APP_URL>/api/integrations/callback/google` |

Email-code login needs your verified Resend sender and no social callback. Google sign-in does not connect Gmail or Calendar; each user separately authorizes their account in Connections. Unipile and Fireflies credentials are entered by their owner in the app rather than shared instance settings.

For Codex, Claude Code or another OAuth MCP client, connect to `<APP_URL>/mcp`, sign in, and review the organization and product grant. [Assistant setup](setup-and-mcp.md) covers consent and revocation. Tokens are bound to the exact origin, so changing `APP_URL` means signing assistants in again.

## Files on R2

Uploads and downloads use signed URLs that the browser sends straight to storage, so Gravity keeps the S3 API instead of an R2 binding.

1. Create a private R2 bucket and an R2 API token limited to that bucket with object read and write.
2. Set `S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com`, `S3_REGION=auto`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`.
3. Add a bucket CORS rule that allows `PUT` and `GET` from the exact application origin with the `Content-Type` header.
4. When moving an installation, copy every object under the same key before switching. File records store object keys, so a missing object is a broken download.

Database backups do not include uploaded files. Keep storage backups separately and rehearse recovery.

## Workers Builds

[Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) builds and deploys from the GitHub repository. Use two connections, one per Worker. The build image reads the Node.js version from `.nvmrc` and the Bun version from `packageManager`, and gives the build an API token for its account.

**`gravity`, production.** Connect the Worker `gravity` to the repository:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Builds for non-production branches | Off |
| Build command | `bun run build:worker` |
| Deploy command | `bun run deploy:worker` |
| Root directory | `/` |
| Build variables | `GRAVITY_HYPERDRIVE_ID`, and `GRAVITY_PLACEMENT_REGION` when pinned |

**`gravity-pr`, branch previews.** Deploy it once by hand first, so that its secrets exist (see [Branch previews](#branch-previews)). Then connect the Worker `gravity-pr` to the same repository:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Builds for non-production branches | On |
| Build command | `bun run build:worker:pr` |
| Deploy command | `npx cf deploy --prebuilt --mode pr` |
| Non-production branch deploy command | `bun run deploy:worker:pr` |
| Root directory | `/` |
| Build variables | `GRAVITY_HYPERDRIVE_ID` of the preview database's Hyperdrive configuration, and `GRAVITY_PLACEMENT_REGION` when pinned |

`deploy:worker:pr` uploads a new version of `gravity-pr` without deploying it. Its preview alias comes from the branch that Workers Builds names in `WORKERS_CI_BRANCH`: lowercased, every run of other characters turned into one dash, prefixed with `branch-` when it does not start with a letter, and shortened so that the alias and `-gravity-pr` fit in 63 characters. The branch `claude/crm-cloudflare-workers-00dac9` is served at `https://claude-crm-cloudflare-workers-00dac9-gravity-pr.<subdomain>.workers.dev`. Each push moves the branch's alias to the new version. Pushes to `main` deploy `gravity-pr` itself, so its own URL follows `main`.

GitHub Actions runs the repository checks, including the Worker build, on every pull request. Workers Builds does not wait for them. Merge to `main` only after `CI ok` passes, and require it in branch protection.

## Branch previews

`gravity-pr` is a separate Worker for previews, built with `--mode pr` from the same configuration. Compared with `gravity` it has:

- its own name, secrets, database and Hyperdrive configuration. Never give it production credentials or the production database.
- no Cron Trigger, so previews never sync provider accounts.
- `workers.dev` and version preview URLs turned on.
- the `PREVIEW_ALIASES` variable. With it, a request that arrives over `https` on a version's preview URL, `<alias>-gravity-pr.<subdomain>.workers.dev`, uses that origin in place of `APP_URL` for sign-in, cookies and origin checks. No other host qualifies. `APP_URL` stays `https://gravity-pr.<subdomain>.workers.dev`.

Set it up once:

1. Create a preview database and runtime role as under [Database](#database), migrate it with `bun run db:migrate`, and check it with `bun run db:check`.
2. Create a Hyperdrive configuration for the preview runtime role.
3. Generate preview-only secrets into a JSON file: `APP_URL` set to `https://gravity-pr.<subdomain>.workers.dev`, and new `BETTER_AUTH_SECRET`, `INTEGRATION_ENCRYPTION_KEY` and `CRON_SECRET` values.
4. Build and deploy it with that file:

   ```sh
   GRAVITY_HYPERDRIVE_ID=<PREVIEW_ID> bun run build:worker:pr
   npx cf deploy --prebuilt --mode pr --secrets-file ../gravity-pr.secrets.json
   ```

5. Add `CRM_DEMO_MODE=false`, `PUBLIC_SITE_INDEXING=false` and a sign-in method with `npx cf workers secrets update <NAME> --worker gravity-pr`. Google and GitHub redirect only to callback URLs registered with them, so on per-branch hostnames email-code sign-in is the method that works. Use a Resend key and sender kept for previews.
6. Upload a branch by hand with `bun run build:worker:pr` and then `WORKERS_CI_BRANCH=<branch> bun run deploy:worker:pr`, or let Workers Builds do it.

When Cloudflare Access protects the account's `workers.dev` hostnames, previews are reachable only by people its policy admits.

## Run the Worker locally

```sh
cp .env.example .dev.vars   # then fill in the values the Worker should receive
GRAVITY_HYPERDRIVE_ID=local \
GRAVITY_HYPERDRIVE_LOCAL_URL=postgres://user:password@localhost:5432/gravity \
  bun run build:worker && bun run start:worker
```

The local runtime passes only the names listed in `.dev.vars`, and a deploy from the same checkout then requires each of those names on the Worker, so move the file away before deploying. The production build requires an `https` `APP_URL`, so put a local TLS proxy in front of the preview port when exercising sign-in. Set `GRAVITY_HYPERDRIVE_LOCAL_URL` only for local runs: the build writes it into `.cloudflare/output`, so do not hand that directory on as a deploy artifact. `bun run dev` remains the quickest loop for interface work and is the only way to run the fictional demo, which needs a local disk.

## Runtime behaviour

- **Durations.** A request runs for as long as its caller stays connected; CPU time is limited to 30 seconds per request. The Cron Trigger gets 15 minutes of wall time and 30 seconds of CPU time. `maxDuration` in route files has no effect.
- **Disconnects.** When a caller disconnects, the Worker keeps a started request alive for up to 30 more seconds, then stops it. A sync or send interrupted that way is left as it would be after a crash: the lease expires, and an unclear delivery is recorded as unknown and never retried automatically.
- **Failed scheduled runs.** When a whole run fails, for example because the database is unreachable, `scheduled()` throws `INTEGRATION_CRON_503` and the invocation shows as failed in the Worker's Cron Events and in Workers Logs. Cloudflare does not retry it; the next run comes on schedule.
- **Live updates.** A change reaches other open tabs within one second through the stream's SQL check. There is no same-process wake-up across Worker requests.
- **Assistant client metadata.** When an assistant registers by a client metadata URL, the Node build resolves the host once, requires a public address and pins it for the connection. A Worker cannot pin an address. It checks that every DNS answer is public, then fetches over HTTPS without following redirects.
- **MCP on `workers.dev`.** Token checks fetch the Worker's own `/api/auth/jwks`, and a Worker cannot fetch its own `workers.dev` hostname, so MCP needs a Custom Domain.
- **Back-channel logout.** The OAuth library cannot deliver back-channel logout notices from a Worker. Sign-out itself is unaffected.
- **Caching and images.** No response or data cache and no image optimizer are configured; the application uses none.
