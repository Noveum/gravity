# MCP business API parity · 6 October 2026

The prior MCP adapter exposed 23 tools, including selected writes. Record editing, archive/restore, sequence management, outreach touch controls and account management were available only through HTTP or were blocked for all assistant principals.

Every current business HTTP operation now lives in `packages/operations/catalog.ts`. CRM, outreach, integrations, materials and grant revocation execute it; MCP automatically registers every operation. The inventory contains 57 shared operations (41 mutations) plus eight existing context/compatibility helpers, for 65 tools. `get_capabilities` provides the current HTTP mapping and supported features. New business operations belong in this registry by repository policy.

Verified `crm:write` allows the same record, draft and outreach actions as the UI, with current organization/product grants, membership, owner/privacy checks, optimistic versions, approval invalidation, durable audit events and live revision hints. Legacy read-only tokens remain read-only. Product/workspace creation requires admin/all-products access; organization-wide contact rules and personal provider configuration also require all-products access. A newly created organization still requires separate consent. Verified writers can retrieve archived record versions for restoration; legacy read-only archive history restrictions remain.

Account management is owner scoped. Google/LinkedIn authorization returns a consent URL; provider login and consent remain interactive. Unipile/Fireflies credentials are explicitly supplied for private owner setup, encrypted at rest and never returned as provider keys. Fireflies can return its webhook signing secret to the owner for setup, matching the existing HTTP flow. Another user's connections/configuration/imports remain private. No provider credentials were changed in this implementation.

New operations also create a sequence, read its detail/enrollments and page readable workspace record types. Paged record output filters an authorized snapshot; database-level pagination remains future work. PDF/text/Markdown upload/download uses the same file permissions, MIME/header checks and private storage as the UI. The MCP route bounds request bodies after authentication and allows the existing 120-second provider-sync budget. Hosting request/response limits still apply.

Contracts are currently material documents. There is no dedicated contract lifecycle/signature API. `record_touch_sent` records an externally sent message; no tool dispatches messages. Auth/consent, provider callbacks, signed webhooks, private cron, browser preference cookies and SSE remain transport protocols rather than replayable business tools.

## Verification

- 506 tests pass; two platform-specific tests remain skipped, across 46 test files.
- Real stateless MCP transport tests exercise complete tool discovery/schema generation, record edits/archive/restore, sequence creation/update/enrollment/dry-run, touch edits/approval/invalidation/skip/reopen/pause/stop, atomic follow-up planning, contact policies/preferences, workspace creation without grant widening, PDF byte/hash round trips, provider-setup redaction, connection ownership, provider OAuth initiation and grant revocation.
- HTTP-created sequences are read through MCP against the same SQL database; the existing official SDK OAuth/PKCE/write/isolation/refresh/revocation tests still pass.
- TypeScript, Biome, production build, built public-site checks, dependency audit and installed-license inventory pass.
- No new dependency, database schema/migration, paid service, runtime size increase or outbound message was introduced.

These results verify code and the local protocol/SQL flows. Newly added write operations still require a fresh authenticated production/client qualification; anonymous challenge/readiness checks alone do not prove a live write. Reconnect a cached or read-only client at `https://gravity.noveum.ai/mcp`, consent to `crm:read crm:write`, then inspect `get_me`, `get_capabilities` and `tools/list`.
