# Setup and OAuth MCP

## Development versus production

The local fictional demo works without credentials. `CRM_DEMO_MODE=false` or any `DATABASE_URL` turns off its fixed identity; `NODE_ENV=production` always disables it. Production requires an HTTPS origin in `APP_URL`, a managed PostgreSQL `DATABASE_URL`, and a cryptographically random `BETTER_AUTH_SECRET` of at least 32 characters. Keep secrets outside Git and logs. Changing the public origin changes the OAuth issuer/resource and requires planned reauthorization.

| Variable | Purpose |
|---|---|
| `APP_URL` | Canonical origin, e.g. `https://crm.example.com`; no path/query |
| `DATABASE_URL` | Managed PostgreSQL connection, with provider-approved TLS and pooling |
| `BETTER_AUTH_SECRET` | Stable auth/encryption secret, generated and stored securely |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional Google login app |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Optional GitHub login app |
| `UNIPILE_WEBHOOK_SECRET` | Per-endpoint v2 signature secret; handler remains disabled in demo |
| `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Private object storage credentials |
| `S3_ENDPOINT`, `S3_REGION` | Provider endpoint/region; region defaults to `auto` |

No Unipile API key or Gmail mailbox refresh token is consumed by the foundation because hosted connection setup and synchronization clients are not implemented. Do not add credentials that no adapter uses. Resend invitation mail is also pending.

The social-login callback paths are `/api/auth/callback/google` and `/api/auth/callback/github`, under the exact configured origin. Register a distinct CRM client or explicitly review an additional callback in an existing app. Do not copy credentials from another project into code. Gmail connection scopes/callbacks will be separate from login, and require the Google verification/security requirements relevant to the chosen scope.

Review `drizzle/` before applying `bun run db:migrate` to the supplied database. Confirm database/project/region, backups, restore procedure, pooling and least-privileged access first. Never use `db:seed` on a real database. Build with `bun run build`, then run on Node with production environment variables. Vercel production verification is still a roadmap gate.

## Workspace onboarding

An authenticated user without organizations opens `/onboarding`. The native form creates the organization, first product, administrator membership, default material folder and four stages in one transaction, with the chosen organization time zone. It opens that organization/product after save. If initiated from assistant authorization, setup returns to the original OAuth selection request. Existing users can create another workspace from Settings. Invites and membership editing are still pending.

## MCP contract

The CRM route is `<APP_URL>/mcp`, using stateless HTTP POST. It is authenticated with OAuth; users do not need a pasted CRM API key. A bare URL is not sufficient until a real auth environment and organization membership exist. Local demo mode does not grant anonymous MCP access. Missing auth configuration returns an unavailable response instead of exposing fictional or real records.

OAuth and HMAC serve different purposes. OAuth gives a person an interactive assistant connection and scoped, revocable tokens. HMAC authenticates raw webhook deliveries using a provider/server secret. There is no user-facing “OAuth HMAC” login mode.

The Better Auth MCP plugin supplies the OAuth provider, metadata, PKCE, consent, JWT signing/validation and refresh-token handling. Client metadata discovery uses the library's safe network transport; explicit dynamic client registration remains enabled for compatible older MCP clients. Do not add a second OAuth provider plugin or implement custom token cryptography.

Connection sequence after deployment:

1. Add the remote HTTP server `<APP_URL>/mcp` in an OAuth-capable assistant client.
2. The client discovers OAuth metadata and starts authorization-code flow with S256 PKCE.
3. Sign into the CRM through the configured Google/GitHub provider.
4. Select one organization and the products to share. The signed OAuth request binds that selection to this flow and session; parallel consent tabs cannot overwrite each other's tenant selection.
5. Review the client, organization/products and read-only permission at consent.
6. The client exchanges the code and stores its tokens. Revoke the grant from Connections when needed.

Tokens are resource-bound to the MCP URL and expire after five minutes. On each request, the library validates signature, issuer, audience and required scope; domain code checks the current OAuth client, active user session, active grant and memberships. Revocation applies immediately even to an otherwise valid JWT. Grants are immutable; future product memberships do not silently widen an existing grant. New access requires another grant. The test suite verifies PKCE, consent, refresh preserving the original grant, product isolation and revocation. Actual Codex/Claude interoperability and Google/GitHub sign-in remain live verification gates.

| Tool | Current purpose |
|---|---|
| `get_me` | User and granted organization/products |
| `get_capabilities` | Implemented features and explicit integration gaps |
| `list_products` | Currently readable granted products |
| `list_next_actions` | Pending actions in a permitted product/all granted products |
| `search_records` | Search readable people/companies/relationships |
| `get_person_context` | Person, company, permitted product relationships, readable messages, evidence and related work |
| `get_company_context` | Company, permitted contacts, product relationships and related work |
| `list_materials` | Private material metadata for permitted products/stages |
| `read_material` | Bounded text/Markdown, or PDF metadata with extraction unavailable |

There are no MCP sending, draft-approval or membership-changing tools in this release. Later write tools need separate scopes, audit and idempotency contracts, with approval remaining a human decision.

Primary implementation references: [Better Auth MCP](https://better-auth.com/docs/plugins/mcp), [OAuth provider](https://better-auth.com/docs/plugins/oauth-provider), and [official MCP authorization specification](https://modelcontextprotocol.io/specification/latest/basic/authorization).
