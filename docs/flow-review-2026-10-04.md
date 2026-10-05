# Full-flow review · 4 October 2026

Gravity remains a local foundation preview. This pass exercises onboarding through the daily queue, settings, connected records, materials and assistant setup. It does not configure live providers or certify production readiness. The existing Twenty instance, public CRM domain and Cloud Run bridge were not modified.

## Flow status

| Flow | Verified evidence | Remaining work |
|---|---|---|
| Sign-in | Social buttons appear only outside demo with configured provider pairs; repeated clicks are guarded, external callback origins fall back to `/`, unsafe navigation schemes are rejected | Real Google/GitHub credentials, callback registration, invitations and two-user live qualification |
| First workspace | `/onboarding` creates organization, admin membership, first product, Overview folder and four pipeline stages in one SQL transaction; selects that organization/product after save | Invites, organization profile editing, retry idempotency for ambiguous network failures |
| Assistant-first onboarding | A user with no organizations can create a workspace and return to the original OAuth selection request; no caller-selected external redirect is followed | Deployed social-provider and actual assistant qualification |
| First person and daily work | Empty workspace offers Add person/Review connections; native Cmd Enter creates a fictional person and research action; inspector includes product context and contact information | Company creation/editing, imports and bulk workflows |
| Multi-product settings | Added a second fictional product using Cmd Enter; product appears in selector and settings | Member/product permission management and profile edits |
| People → company → Back | Mira's fictional product relationships and history open; company contact/related-work links open; Back restores the person | Full editing and provenance/enrichment UX |
| Sequences | First/three follow-up steps and paused-after-reply enrollment render; contact links navigate | Sequence editor, enrollment and execution worker |
| Meetings | Held and scheduled states stay distinct; reviewed promise requires owner/due date; SQL tests establish deduplication and permissions | Google Calendar and Fireflies imports, sourced transcript retrieval |
| Opportunities | Separate product stages and contact links render | Deal creation/editing and forecasting |
| Sales materials | Product/folder/stage filters and authenticated download links render; existing SQL/file tests exercise private bytes and cross-tenant rejection | Vercel direct transfer, extraction, scanning and approved versions |
| Gmail / LinkedIn | Synthetic signed webhook routes and normalization tests exercise incoming/outgoing/retry/account boundaries | Hosted connection or direct Gmail client, encrypted credentials, durable ingestion, history and reconciliation |
| Google Calendar | Dedicated disconnected card and future authorization/sync guide; MCP explicitly reports `calendarSync: false` | Calendar adapter, cursors, watch renewal, cancellations and reconnect |
| MCP consent | Organization switches hide old products; aborted responses cannot replace current choices; pending fields lock, duplicate submission is suppressed; old consent grant cannot approve a new request | Deployed Google/GitHub and real Codex/Claude test |
| MCP transport | Real local HTTP OAuth/PKCE/consent/refresh tests and authorized tool calls remain passing; get_capabilities reports unavailable providers and sending accurately | Operational HTTPS auth configuration; actual client interoperability |
| Keyboard / themes / live updates | Existing interaction/SSE/conflict tests pass; browser uses G P, Cmd Enter, theme controls and record links; compact desktop navigation fits shorter screens | Manual screen-reader qualification and production/high-volume latency measurements |

## Fixes in this pass

- Replaced blank first-time startup with a guided workspace form and actionable empty queue.
- Kept workspace defaults atomic; invalid names/time zones fail before insertion and failed membership insertion rolls back all writes.
- Selected the just-created organization/product instead of opening the first alphabetic organization. Requests cannot pick an unreadable product.
- Preserved an assistant's OAuth request through workspace creation. Direct `/authorize` or `/consent` visits without a request show recovery guidance.
- Bound asynchronous product reads to the chosen organization and consent metadata to its current request; stale results and navigation cannot continue another flow.
- Added synchronous submission guards, disabled pending choices and readable retry/error states in authentication forms.
- Extracted Connections from the app component, added Calendar, provider setup explanations, a server-supplied canonical MCP URL, copy/recovery feedback and guarded grant revocation.
- Removed client-location-dependent MCP markup, preventing the server and browser from rendering different endpoint strings.
- Reduced compact-mode desktop navigation spacing so the brand and bottom links remain visible on a 720-pixel-high display.

## Endpoint checks on the actual development server

| Request | Result |
|---|---|
| POST `/mcp` with an MCP initialize request | 503 `AUTH_UNAVAILABLE` |
| GET `/.well-known/oauth-protected-resource` | 503 `AUTH_UNAVAILABLE` |
| GET `/.well-known/oauth-authorization-server` | 503 `AUTH_UNAVAILABLE` |
| POST `/api/webhooks/unipile` | 503 `CONNECTOR_NOT_CONFIGURED` |
| POST `/api/crm` from another origin | 403 `FORBIDDEN` |

The first four are expected while credentials are absent. They establish that demo mode does not silently expose an anonymous assistant endpoint or accept provider deliveries. They are not successful live connection tests. The separate test auth server is configured explicitly and exercises discovery challenges, registered clients, S256 PKCE, token exchange, consent, refresh, scope enforcement and revocation.

Gravity's configured endpoint is `<APP_URL>/mcp`. Current local UI shows `http://127.0.0.1:3014/mcp`; this is not a public URL and is not configured for Codex login. The earlier Cloud Run MCP URL belongs to the Twenty bridge. OAuth provides user/assistant consent and revocable tokens; HMAC authenticates provider webhook deliveries. OAuth does not require users to paste a CRM API key.

## Next live integration slice

Qualify a staging HTTPS origin and database first, then Google/GitHub sign-in and two-user membership, then a real Codex read-only connection. Build one reliable Gmail reply loop before adding other mailbox adapters. Select one ingestion authority per account.

For direct Gmail, notifications provide change hints, not complete messages. Renew watches and use persisted history cursors, hydration and gap recovery. Google recommends daily watch renewal and requires renewal within seven days. [Google Gmail push guide](https://developers.google.com/workspace/gmail/api/guides/push).

Calendar requires a separate connection and incremental synchronization, including changes/cancellations; a booking must not create a held-meeting outcome or approved promise. Push and synchronization need their own adapter rather than reusing Gmail notifications. [Google Calendar push guide](https://developers.google.com/workspace/calendar/api/guides/push).

Google login remains distinct from mailbox/calendar consent. Provider tokens stay server-side; the core app and read-only MCP should never expose refresh tokens. [Google web-server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server).

## Screenshots

Screenshots contain fictional data only and remain outside the repository at `../gravity-review-2026-10-04/` on the review machine. Files cover sign-in, onboarding, empty workspace, first person, light Connections, OAuth MCP instructions, dark settings, dark person/company context, sequences, meetings, opportunities and materials. They are local review artifacts, not a deployed demonstration.

See [verification](verification.md), [connector contract](connectors.md), [setup/MCP](setup-and-mcp.md) and [roadmap](roadmap.md) for the outstanding qualification gates.
