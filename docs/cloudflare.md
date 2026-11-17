# Deploy Gravity on Cloudflare Workers

Gravity runs on Cloudflare Workers through [vinext](https://github.com/cloudflare/vinext), which serves the same `src/app` routes on the Workers runtime. `bun run build` still produces the Next.js build used by [Vercel](vercel.md); `bun run build:vinext` produces the Worker. Application code is shared. Only the pieces below are specific to Workers.

| Piece | On Workers |
| --- | --- |
| Entry | `worker/index.ts` hands requests to vinext and runs the Cron Trigger |
| Configuration | `cloudflare.config.ts` (name, compatibility, assets, cron, bindings) and `vite.config.ts` |
| PostgreSQL | One connection per invocation, through Hyperdrive or a direct `DATABASE_URL` |
| Scheduled sync | Cron Trigger every five minutes, calling `/api/integrations/cron` with `CRON_SECRET` |
| Files | The existing S3 client, pointed at R2's S3 endpoint |
| Settings | Worker secrets with the same names as the Vercel environment variables |

## Requirements

- The Workers Paid plan. The Worker is about 3.3 MiB compressed, above the 3 MiB limit of the free plan.
- Node.js 22.23.4, as pinned in `.nvmrc`. Node releases before 22.22.2 skip `src/app/.well-known` during the build, which removes the OAuth discovery routes that assistants need.
- `cf`, the Cloudflare CLI installed with the project. It keeps its own sign-in, separate from Wrangler: run `npx cf auth login` once, or set `CLOUDFLARE_API_TOKEN` in CI. `cf` and `@cloudflare/vite-plugin` are release candidates and must be upgraded together; `cf deploy` rejects a build written by an older plugin.

## PostgreSQL

A Worker opens TLS only to a server whose certificate chains to a public certificate authority. It has no setting for a private CA, so `DATABASE_SSL_CA` has no effect on Workers.

- **Supabase, or any database with a private CA:** connect through [Hyperdrive](https://developers.cloudflare.com/hyperdrive/). Hyperdrive holds the connection string and the CA, verifies the certificate and hostname itself, and pools connections. It is included in the Workers Paid plan.
- **A database with a public certificate:** set the `DATABASE_URL` secret and leave Hyperdrive out. Verified TLS applies as on Vercel.

Each open request holds one database connection for as long as it runs, and a live-update stream runs for 25 seconds at a time. Without Hyperdrive every open browser tab therefore holds a connection of the runtime role. With Hyperdrive the Worker holds a connection to the pool, and the database only sees the pool.

Create the Hyperdrive configuration once, with the restricted runtime role from [Supabase setup](supabase.md). Use the direct connection string, not a Supabase pooler. Query caching must stay off: Gravity reads its own writes and checks permissions on every read.

```sh
npx wrangler cert upload certificate-authority --ca-cert supabase-ca.pem --name gravity-database-ca
npx wrangler hyperdrive create gravity \
  --connection-string="postgres://RUNTIME_ROLE:PASSWORD@HOST:5432/postgres" \
  --ca-certificate-id <CA_CERTIFICATE_ID> --sslmode verify-full \
  --caching-disabled true --origin-connection-limit 10
```

Keep the origin connection limit below the connection limit of the runtime role, with room for any other deployment that uses the same role. Pass the configuration ID to every build and deploy as `GRAVITY_HYPERDRIVE_ID`. Migrations are still applied from a trusted workstation with `bun run db:migrate`, never from the Worker.

## Settings

Set the same names as in [the Vercel guide](vercel.md#environment) as Worker secrets. `APP_URL`, `BETTER_AUTH_SECRET`, `INTEGRATION_ENCRYPTION_KEY` and `CRON_SECRET` are required, plus `DATABASE_URL` when Hyperdrive is not used; a deploy fails while one of them is missing. Leave out `DATABASE_URL`, `DATABASE_SSL_MODE` and `DATABASE_SSL_CA` when Hyperdrive is used. Reuse the existing `BETTER_AUTH_SECRET` and `INTEGRATION_ENCRYPTION_KEY` when moving an installation: new values sign every user out and make stored provider credentials unreadable.

Put the values in a JSON file outside the repository, as one object of names to strings, and upload them with the first deploy. Prefer JSON to a dotenv file: `cf` expands `$NAME` inside dotenv values, which corrupts a password that contains a dollar sign. Change a single value later with `npx cf workers secrets update`.

```sh
GRAVITY_HYPERDRIVE_ID=<ID> bun run build:vinext
GRAVITY_HYPERDRIVE_ID=<ID> npx cf deploy --prebuilt --secrets-file ../gravity.secrets.json
```

## Files on R2

Uploads and downloads use signed URLs that the browser sends straight to storage, so Gravity keeps the S3 API instead of an R2 binding.

1. Create a private R2 bucket and an R2 API token limited to that bucket with object read and write.
2. Set `S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com`, `S3_REGION=auto`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`.
3. Add a bucket CORS rule that allows `PUT` and `GET` from the exact application origin with the `Content-Type` header.
4. When moving an installation, copy every object under the same key before switching. File records store object keys, so a missing object is a broken download.

## Build and deploy

```sh
bun install --frozen-lockfile
GRAVITY_HYPERDRIVE_ID=<ID> bun run deploy:vinext
```

The first deploy uses the two commands under [Settings](#settings) instead, so the secrets arrive with the Worker.

For Workers Builds, connect the repository, set the build command to `bun run build:vinext` and the deploy command to `npx cf deploy --prebuilt`, and add the build variable `GRAVITY_HYPERDRIVE_ID`. The build image reads the Node.js version from `.nvmrc` and the Bun version from `packageManager`. Keep production deploys gated on the repository checks, as with Vercel.

After a deploy, check that `/api/health` returns `ready`, sign in, save a record, and confirm in the dashboard that the `*/5 * * * *` trigger ran. Register the OAuth callbacks from [the Vercel guide](vercel.md#domain-and-callbacks) for the new origin before sending users to it.

## Run the Worker locally

```sh
cp .env.example .dev.vars   # then fill in the values the Worker should receive
GRAVITY_HYPERDRIVE_ID=local \
GRAVITY_HYPERDRIVE_LOCAL_URL=postgres://user:password@localhost:5432/gravity \
  bun run build:vinext && bun run start:vinext
```

The local runtime passes only the names listed in `.dev.vars`, and a deploy from the same checkout then requires each of those names on the Worker, so move the file away before deploying. The production build requires an `https` `APP_URL`, so put a local TLS proxy in front of the preview port when exercising sign-in. Set `GRAVITY_HYPERDRIVE_LOCAL_URL` only for local runs: the build writes it into `.cloudflare/output`, so do not hand that directory on as a deploy artifact. `bun run dev` remains the quickest loop for interface work and is the only way to run the fictional demo, which needs a local disk.

## Differences from Vercel

- **Durations.** `maxDuration` is ignored. A request runs for as long as its caller stays connected; CPU time is limited to 30 seconds per request. The Cron Trigger gets 15 minutes of wall time and 30 seconds of CPU time.
- **Disconnects.** When a caller disconnects, the Worker keeps a started request alive for up to 30 more seconds, then stops it. A sync or send interrupted that way is left as it would be after a crash: the lease expires, and an unclear delivery is recorded as unknown and never retried automatically.
- **Live updates.** A change reaches other open tabs within one second through the stream's SQL check. The same-process wake-up that made it immediate on a single Node server does not exist across Worker requests.
- **Region.** Smart Placement runs the Worker near the database instead of a fixed `hnd1` region.
- **Caching and images.** No response or data cache and no image optimizer are configured; the application uses none.
