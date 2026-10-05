# Public-site and MCP qualification review — 4 October 2026

This change adds public content and strengthens protocol evidence; it does not enable a live inbox, publish the private GitHub repository or deploy production. The CRM remains at `/`, and the new landing page is `/welcome`.

## Implementation

Eight independent public routes: landing page; docs index and three guides; journal index and two original articles. All copy lives in the English translation catalog. The guides explain local setup, scoped OAuth MCP and deployment prerequisites. Public metadata/robots/sitemap require an explicit production origin and indexing opt-in, exclude private app routes, and stay disabled in previews/development.

Competitor observations and decisions are recorded in [positioning](positioning-2026-10-04.md). The landing page has an explicitly fictional preview, implemented/planned feature lists and no invented social proof or paid/free hosted offers.

## Verification

- 87 tests across 11 files pass: the previous 76 plus an official SDK OAuth-to-tool round trip and ten public content/indexing checks.
- The official MCP client completes discovery, dynamic registration, S256 PKCE, resource/issuer-bound authorization, product consent, token exchange, initialization and tool calls over real HTTP backed by SQL. An explicit request for an ungranted product returns an error, all exposed tools advertise read-only behavior, and revocation blocks a subsequent call. The SDK fixture preserves discovery state across the callback.
- TypeScript and Biome pass. Frozen install is unchanged; dependency audit reports no known vulnerabilities. All 196 installed locked packages declare licenses; platform-specific absent artifacts remain listed in the inventory.
- Production build passes. HTTP smoke checks verify all eight built public pages, two missing-article 404s, robots and empty sitemap with demo access disabled, without requiring auth/database configuration.
- In-app browser checks cover light/dark appearance, docs navigation, assistant commands and TOC anchors, journal navigation and native FAQ click/Enter toggling. Content pages use native links, semantic headings and a focusable skip target. Desktop layouts have no horizontal overflow. CRM spot checks also confirm G/P keyboard navigation, a person/company inspector and explicit disconnected provider/MCP status. CSS defines narrow layouts; physical mobile-device qualification remains pending.
- Existing application interaction/domain tests continue to cover onboarding, settings, forms, keyboard navigation, live reconciliation, tenant isolation, reply ingestion and private materials. No live provider account is involved in these tests.

CI now performs declared-license checks and post-build public-route smoke checks. Manual preview deployment also checks declared licenses before building; it remains opt-in and awaits the reviewed staging target. See [CI/deployment](ci-and-deployment.md).

## Limits before real data

[Client qualification](mcp-client-qualification.md) distinguishes SDK interoperability from actual Codex/Claude social-login qualification. The installed shell Codex CLI is too old for MCP commands; the desktop client has not signed into this new Gravity implementation. Client metadata discovery is configured but actual Codex CIMD remains unqualified.

Managed PostgreSQL, Vercel project, stable HTTPS auth origin, private direct object transfer, backup/restore, two-user membership/invitation handling, encrypted provider connection setup, durable ingestion and historical-import policy remain gates. Gmail, LinkedIn, Calendar and Fireflies are explicitly disconnected. API keys and dispatch are not implemented. Do not load real sales data into the fictional demo.

Screenshots are saved outside the repository under `gravity-review-2026-10-04/public-site`; they contain fictional examples and local preview pages, not credentials or real contacts. The source remains prepared under Apache-2.0 but GitHub visibility is currently private.
