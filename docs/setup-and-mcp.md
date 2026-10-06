# Setup and OAuth MCP

## Hosted access

Gravity is hosted at [gravity.noveum.ai](https://gravity.noveum.ai). The public landing page is `/`; **Sign in** opens `/sign-in` and takes authenticated users into their workspace. Google, GitHub and email-code sign-in are available on the hosted app. Users create their own organization and product through onboarding, then connect personal provider accounts from Connections. No local installation or environment variables are needed to use the hosted workspace. For an independent installation, use **Deploy with Vercel** and follow [Vercel setup](vercel.md).

The hosted remote OAuth MCP endpoint is `https://gravity.noveum.ai/mcp`. When changing the application hostname, update the assistant URL and authenticate again: tokens are bound to the exact origin and resource. Existing organizations, contacts and connected provider credentials remain in the same database.

## Development and self-hosting configuration

The local fictional demo works without credentials. `CRM_DEMO_MODE=false` or any `DATABASE_URL` turns off its fixed identity; `NODE_ENV=production` always disables it. Production requires an HTTPS origin in `APP_URL`, a managed PostgreSQL `DATABASE_URL`, and a cryptographically random `BETTER_AUTH_SECRET` of at least 32 characters. Keep secrets outside Git and logs. Changing the public origin changes the OAuth issuer/resource and requires planned reauthorization.

| Variable | Purpose |
|---|---|
| `PUBLIC_SITE_URL`, `PUBLIC_SITE_INDEXING` | Optional HTTPS marketing origin and explicit production SEO opt-in; never indexes CRM/auth/API routes |
| `APP_URL` | Canonical origin, e.g. `https://crm.example.com`; no path/query |
| `DATABASE_URL` | Managed PostgreSQL connection, with provider-approved TLS and pooling |
| `BETTER_AUTH_SECRET` | Stable auth/encryption secret, generated and stored securely |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional Google login app |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Optional GitHub login app |
| `RESEND_API_KEY`, `EMAIL_FROM` | Optional passwordless email sign-in and invitation emails; sender must be verified in Resend |
| `ALLOWED_EMAIL_DOMAINS` | Optional comma-separated email domains that invitations may target and accept from. Empty means no deployment restriction; each workspace can narrow it further |
| `INTEGRATION_ENCRYPTION_KEY`, `CRON_SECRET` | Stable provider encryption key and private scheduled-sync credential |
| `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Private object storage credentials |
| `S3_ENDPOINT`, `S3_REGION` | Provider endpoint/region; region defaults to `auto` |

Users set up their own Unipile API key and webhook signing secret in Connections; deployment-wide Unipile keys are not used. Gmail/calendar use separate user consent and encrypted refresh tokens. Fireflies keys are entered by each account owner. See [connector setup and limits](connectors.md). Resend sends requested login codes; teammate invitations are still pending.

Email sign-in uses six-digit, single-use OTP codes that expire after five minutes, with three incorrect attempts allowed. Codes are hashed in the protected verification store. Atomic database rate limits work across serverless instances; each recipient can request one code per minute. A rejected resend leaves the original code usable. The browser handles delivery failures, code errors and resend cooldowns without losing the recipient or assistant authorization request. Login-code delivery is awaited, and its bounded log events never include the code, recipient or provider response body.

The social-login callback paths are `/api/auth/callback/google` and `/api/auth/callback/github`, under the exact configured origin. Register a distinct CRM client or explicitly review an additional callback in an existing app. Do not copy credentials from another project into code. Gmail connection scopes/callbacks are separate from login, and require the Google verification/security requirements relevant to the chosen scope.

Review `drizzle/` before applying `bun run db:migrate` to the supplied database. Confirm database/project/region, backups, restore procedure, pooling and least-privileged access first. Never use `db:seed` on a real database. Build with `bun run build`, then run on Node with production environment variables. See [Supabase PostgreSQL](supabase.md) for separate migration/runtime credentials, verified TLS, RLS, recovery and the production health check. Provider sign-in and client consent still require qualification on the actual production origin.

## Workspace onboarding

An authenticated user without organizations opens `/onboarding`. The native form creates the organization, first product, administrator membership, default material folder and a sales pipeline with five stages in one transaction, with the chosen organization time zone. It opens that organization/product after save. If initiated from assistant authorization, setup returns to the original OAuth selection request. Existing users can create another workspace from Settings. Invites and membership editing are still pending.

## MCP contract

The CRM route is `<APP_URL>/mcp`, using stateless HTTP POST. It is authenticated with OAuth; users do not need a pasted CRM API key. A bare URL is not sufficient until a real auth environment and organization membership exist. Local demo mode does not grant anonymous MCP access. Missing auth configuration returns an unavailable response instead of exposing fictional or real records.

OAuth and HMAC serve different purposes. OAuth gives a person an interactive assistant connection and scoped, revocable tokens. HMAC authenticates raw webhook deliveries using a provider/server secret. There is no user-facing “OAuth HMAC” login mode.

The Better Auth MCP plugin supplies the OAuth provider, metadata, PKCE, consent, JWT signing/validation and refresh-token handling. Client metadata discovery uses the library's safe network transport; explicit dynamic client registration remains enabled for compatible older MCP clients. Do not add a second OAuth provider plugin or implement custom token cryptography.

Connection sequence after deployment:

1. Add the remote HTTP server `<APP_URL>/mcp` in an OAuth-capable assistant client.
2. The client discovers OAuth metadata and starts authorization-code flow with S256 PKCE.
3. Sign into the CRM through Google, GitHub or an email code, according to the installation's enabled providers.
4. Select one organization and the products to share. The signed OAuth request binds that selection to this flow and session; parallel consent tabs cannot overwrite each other's tenant selection.
5. Review the client, organization/products and CRM read/write permission at consent.
6. The client exchanges the code and stores its tokens. Revoke the grant from Connections when needed.

Tokens are resource-bound to the MCP URL and expire after five minutes. On each request, the library validates signature, issuer, audience and required scope; domain code checks the current OAuth client, active user session, active grant and memberships. Revocation applies immediately even to an otherwise valid JWT. Organization grants are immutable. All-products grants explicitly cover current and future products the user can access; specific-product grants remain fixed. Empty product lists grant no product access. Existing read-only clients must reconnect to consent to `crm:write crm:send`; their old tokens are never silently elevated. The test suite verifies PKCE, consent, refresh preserving the original grant, product isolation and revocation. Actual Codex/Claude interoperability and Google/GitHub sign-in remain live verification gates.

## Complete business API access

The endpoint requires `crm:read crm:write crm:send`; include `offline_access` for refresh. AI assistants is a dedicated sidebar option (`G X`), and the MCP card appears first in Connections. Reconnect old read-only clients and refresh cached tool discovery after upgrading.

All current business HTTP operations are defined once in `packages/operations/catalog.ts`. The CRM, outreach, integrations, material upload/download and grant-revocation HTTP adapters execute that registry. MCP registers every definition automatically with the same domain schema, validation, permissions, audit events and real-time change hints. `get_capabilities` returns the current operation inventory and HTTP mapping; `tools/list` provides each tool's complete input schema. There are 82 shared operations (61 mutations), plus eight context and compatibility helpers. Members, product access, deactivation with work reassignment and invitations are managed through `list_members`, `change_member_role`, `set_member_products`, `deactivate_member`, `reactivate_member`, `create_invitation`, `resend_invitation`, `revoke_invitation`, `list_invitations` and `accept_invitation`. Invitation links open `/invite/<token>`; only a SHA-256 hash of the token is stored, and assistants cannot accept an invitation. Workspace settings (name, IANA time zone, slug and email domain allowlist) change through `update_workspace`. Products are renamed and recoloured from a fixed palette of theme colour keys with `update_product`, and archived or restored with `archive_product` and `restore_product`; archiving pauses running enrollments and the last active product cannot be archived. Deal and outreach stages are managed with `create_stage`, `update_stage`, `reorder_stages` and `archive_stage` (which moves the stage's records to another stage in the same pipeline), and deal pipelines are renamed with `update_pipeline`.

| Area | Tools |
|---|---|
| Records and clients | `list_records`, `get_workspace`, `get_person`, `get_person_context`, `get_company_context`, `create_person`, `update_person`, `archive_person`, `save_company`, `archive_company` |
| Organizations/products | `list_organizations`, `create_workspace`, `create_organization`, `create_product`, `list_products` |
| Deals and analytics | `save_deal`, `create_opportunity`, `change_opportunity`, `create_pipeline`, `get_overview`, `get_message_activity` |
| Follow-ups and meetings | `schedule_next_action`, `change_action`, `plan_actions`, `save_meeting`, `accept_meeting_commitment`, `list_next_actions`, `get_workspace_revision` |
| Sequences and outreach | `create_sequence`, `get_sequence`, `update_sequence`, `enroll_in_sequence`, `advance_sequences`, `list_due_touches`, `get_outreach_queue`, `get_touch`, `edit_touch_draft`, `approve_touch`, `record_touch_sent`, `skip_touch`, `reopen_touch`, `snooze_touch`, `change_enrollment`, `change_relationship` |
| Contact policies | `get_contact_rules`, `update_contact_rules`, `set_contact_preferences` |
| Connections and imports | `get_integrations`, `connect_integration`, `sync_integration`, `disconnect_integration`, `link_import`, `ignore_import`, `configure_unipile`, `remove_unipile` |
| Documents | `create_material_folder`, `upload_material`, `download_material`, `list_materials`, `read_material`, `create_material` |
| Identity and access | `get_me`, `get_permission_audit`, `get_capabilities`, `search_records`, `revoke_assistant` |

`list_records` returns up to 100 permitted records per page with `total` and `nextOffset`. It currently filters an authorized workspace snapshot before paging; this bounds response size, not database work. `get_workspace`, `get_person`, `get_sequence` and the queue/detail tools provide versions for subsequent edits. Mutations requiring a version reject stale values with `CONFLICT`. `plan_actions` changes up to 100 follow-ups atomically. Company/meeting create-versus-update refinements are identical across HTTP and MCP. Approval remains bound to the exact draft, recipient, channel and product; edits and replies invalidate it.

Organization and product grants remain immutable. Product and new-workspace creation require an organization administrator with an all-products grant. Creating another workspace does not grant access to that workspace; authorize it separately. Pipeline creation requires an administrator with access to the product. Organization-wide contact rules and personal Unipile setup changes require an all-products grant. MCP cannot impersonate another owner, widen the selected organization or bypass private conversation rules. Verified writers can inspect archived records by ID to obtain the version needed for restoration; legacy read-only assistants retain their archived-history restriction. Revoking the current assistant grant invalidates subsequent requests.

Connection management is account-owner scoped. `connect_integration` for Google/LinkedIn returns the provider authorization URL; the owner completes consent in a browser signed into Gravity. An assistant cannot bypass Google or LinkedIn account verification. `configure_unipile` and Fireflies connection accept an owner's provider key explicitly supplied for that setup; never put credentials in a public prompt or repository. Keys remain encrypted at rest and are not returned in tool results. Fireflies returns its newly provisioned webhook signing secret to the owner for setup, matching the UI. Sync, disconnect, import linking and ignoring use the same ownership and visibility rules as Connections.

`upload_material` accepts canonical base64 PDF, text or Markdown in a permitted product folder. `download_material` returns the authorized bytes as base64 and their hash. Maximum decoded file size is 10 MiB; hosting request/response limits also apply, so use small files on Vercel until direct storage transfer is added. Contract PDFs use this document workflow. A dedicated contracts lifecycle, signing and membership administration do not exist yet in either transport. Explicit sending uses `get_send_readiness`, `send_touch`, `send_action`, `get_delivery` and `reconcile_delivery`; Gmail requires separate gmail.send consent. `record_touch_sent` records an already externally sent message; it never sends one.

Authentication, OAuth selection/consent, provider callbacks, signed webhook delivery, private cron invocation, browser workspace cookies and SSE are transport protocols rather than additional CRM business tools. MCP exposes their meaningful business effects through connection/sync/grant tools, rather than replaying browser cookies or inventing webhook signatures. Future business operations must be added to the shared registry so both transports ship together. [Analytics definitions](analytics.md).

Primary implementation references: [Better Auth MCP](https://better-auth.com/docs/plugins/mcp), [OAuth provider](https://better-auth.com/docs/plugins/oauth-provider), and [official MCP authorization specification](https://modelcontextprotocol.io/specification/latest/basic/authorization).

[Client qualification and current Codex/Claude commands](mcp-client-qualification.md) distinguish official SDK protocol tests from live client sign-in. OAuth remains the first supported path; API keys are not implemented.

The MCP initialization response provides agent instructions. Four prompts (`daily-triage`, `manage-sequence`, `configure-connections`, `send-approved-message`) and resources `gravity://agent-guide` and `gravity://permissions` explain workflows and effective permissions. Existing tokens are not elevated; reconnect to accept the full scope set. [Execution and permission audit](mcp-permissions-2026-10-06.md) explains send-format, idempotency, provider consent and limitations.
