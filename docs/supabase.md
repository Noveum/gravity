# Supabase PostgreSQL

Gravity uses Supabase as managed PostgreSQL. Better Auth owns the application login and MCP OAuth flows; Supabase Auth and public browser database clients are not required.

## Connections and credentials

Copy the exact session-pooler hostname and project reference from Supabase's **Connect → Direct → Session pooler** screen. Use port 5432 with Postgres.js. The transaction pooler on port 6543 is rejected because Postgres.js pipelining and transactions are not supported reliably there. Direct IPv6 connections are also supported where the deployment network allows them. [Connection options](https://supabase.com/docs/guides/database/connecting-to-postgres), [Postgres.js limitations](https://supabase.com/docs/guides/database/postgres-js).

`DATABASE_URL` belongs to a dedicated runtime login that inherits `gravity_app`. It must not own tables, bypass RLS, create roles/databases, create objects in `public`, or truncate tables. Use a small connection limit. The driver opens at most one connection per app instance, releases idle connections after 20 seconds and disables prepared statements. This bounds per-instance use; it does not impose a global connection cap across Vercel instances.

`DATABASE_MIGRATION_URL` is an administrative connection used only on a trusted workstation or migration job. Keep it out of Vercel application environments. Apply reviewed migrations with `bun run db:migrate`; run `bun run db:check` with the runtime credentials afterward. Scripts load local environment files without executing them or expanding characters inside passwords. URL-encode credentials before writing connection strings.

Remote connections verify the CA and hostname. Download the CA from the project's **Database → Settings → SSL configuration** screen and put the PEM in `DATABASE_SSL_CA` (quoted with escaped newlines if stored in an environment file). `DATABASE_SSL_MODE=verify-full` is the default. `disable` is accepted only for a loopback database in development. Enable Supabase SSL enforcement as well; it briefly restarts the database. [SSL configuration](https://supabase.com/docs/guides/platform/ssl-enforcement).

## Tables and access boundaries

The generated `0006_server_database_access` migration enables RLS on all CRM, Better Auth and MCP OAuth tables. Its only policy permits the non-login `gravity_app` server group. It grants that group SELECT/INSERT/UPDATE/DELETE and revokes table privileges from PUBLIC and existing Supabase `anon`, `authenticated` and `service_role` roles. Supabase's own schemas and unrelated application tables are untouched.

The server group is trusted for every organization. Tenant/product permissions are enforced by the shared domain services used by both HTTP and MCP; this is not a database session carrying individual user's claims. Do not expose the runtime URL or grant this role to a browser/API identity. Every new table must include the server access policy, RLS, runtime grants and API-role revocations in its reviewed migration. [Securing Supabase's API](https://supabase.com/docs/guides/api/securing-your-api).

Never run the fictional demo seed against a supplied database. Schema migrations create the required tables; the first real login completes onboarding, atomically creating its organization, admin membership, product, folders and stages. Test remote writes inside an explicitly rolled-back transaction, without leaving test contacts or users.

## Production and recovery

Configure the runtime URL, verified CA, `CRM_DEMO_MODE=false`, stable HTTPS `APP_URL` and a separate persistent `BETTER_AUTH_SECRET` in the production Vercel environment. Social providers also require their production callback URL (`<APP_URL>/api/auth/callback/google` or `/github`) in the provider console. Preview branches must use a separate database and OAuth origin; never populate general preview settings with production credentials.

`GET /api/health` checks authentication configuration plus actual access to migrated CRM and session tables. It returns only `ready`/`unavailable`, forbids caching and emits a bounded `gravity.health` event with status and duration to Vercel Runtime Logs. This is a database/configuration check, not proof that Google sign-in, Gmail, calendar, storage or MCP consent work end to end. Those need separate live qualification.

Review the project's backup policy and existing objects before external migrations. Supabase Pro retains seven daily backups, but storage object contents and custom-role passwords are not part of those backups. After a restore, reset the runtime role password, update the runtime URL, redeploy and verify access. Back up material files separately. Review organization-level quota warnings before relying on availability. No PITR, compute upgrade or IPv4 add-on is required by this setup. [Backups and restore limitations](https://supabase.com/docs/guides/platform/backups).
