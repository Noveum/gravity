# Personal Unipile settings qualification — 5 October 2026

Users configure their own V2 Unipile key in Connections, then save the signing secret for the generated configuration-specific webhook. Credentials are encrypted with organization/owner/configuration AAD. The server returns setup metadata only; configuration operations require a current human session. Neither MCP nor another member inherits the key. Deployment-wide Unipile credentials are deliberately unused.

Migration 0008 adds the protected `provider_configurations` table and namespaces provider account IDs by setup, preserving a separate uniqueness constraint for legacy Gmail/Calendar/Fireflies accounts. It was exercised by PGlite migrations and the full test suite. The supplied production target was reviewed as Gravity in Tokyo with a physical backup dated 4 October 2026 21:16:39 UTC. There were no existing Unipile accounts. After migration, all 40 application/auth tables passed the restricted runtime-role, RLS and verified-TLS health checks. No fictional seed or provider credentials were inserted in production. Backup restoration was not exercised.

## Verification

- Full suite: 154 tests across 21 files, including 9 personal-provider tests and integration UI/HTTP tests.
- TypeScript, lint, production build, built public-site smoke, dependency audit and license inventory passed.
- Separate owners and organizations use separate settings and hosted-auth keys.
- Credentials are absent from public setup/overview responses; encryption rejects a different owner context.
- Human-session and organization policies apply before provider calls. Cross-origin and unauthenticated HTTP mutations are rejected.
- Identical external account IDs in different setups cannot cross-route replies. Unscoped ambiguous ingestion is rejected.
- A signed delivery for one setup cannot authenticate another or claim its account. Removed setups reject ingress even with the previous signature.
- Removing a setup deletes saved credentials, disconnects its accounts, clears leases and expires pending flows. Duplicate/delayed callbacks cannot restore it.
- Changing an API key before connecting resets the old webhook secret and expires pending authentication. Connected setups require explicit removal before replacement.
- Masked two-step forms retain errors, prevent duplicate submissions, move focus into the next step and require explicit removal confirmation.

## Limits

Provider API calls and signed events were qualified with fictional responses. A real LinkedIn account still requires its owner's Unipile application, API key, signed webhook setup and hosted consent. Saving a signing secret does not independently prove delivery; that is verified when a real signed event arrives. No subscription was purchased. No outbound messaging is enabled. Fireflies similarly requires a user-owned key. Existing Google connections use separate read-only consent and scheduled polling.

The supplied Supabase organization still reports a quota warning with possible restrictions from 7 October 2026. No billing or plan changes were made.
