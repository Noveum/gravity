# Gravity foundation release review · 3 October 2026

Reviewed application, permissions, SQL migrations, OAuth/MCP, connectors, private materials, frontend flows, packaging and CI. This is a foundation preview suitable for local review with fictional data, not a qualified production CRM.

| Dimension | Assessment | Evidence and remaining work |
|---|---|---|
| Security | Foundation boundaries tested; production review pending | Composite tenant/product constraints, current membership and immutable MCP grants, private-source filtering, exact-body HMAC, bounded request bodies and origin checks. Distributed rate limits, provider credential encryption, role hardening and operational review remain gates. |
| Correctness | Tested foundation flows | 76 SQL/HTTP/OAuth/UI tests, including retries, concurrent operations, stale drafts, cross-account replies and route errors. Live providers, actual assistant compatibility, sender execution and meeting imports are unqualified. |
| Performance | Local responsiveness verified; scale unqualified | Immediate local interaction and revision delivery, bounded local context cache and cross-runtime polling. Snapshots still load complete permitted lists; pagination, durable jobs, fan-out and realistic high-volume qualification are required. |
| Maintainability | Clear domain boundaries; frontend needs further separation | HTTP and MCP share policy/services. Shared client helpers now avoid circular imports; keyboard routing, modal lifecycle, settings forms and snapshot projection have separate modules. The main app component remains large and should be split along view/controller boundaries before broad feature expansion. |

## Findings resolved in this review

- **P1: cross-product scheduling from a filtered view.** Modal product choices included all permitted products while its people and assignees came from the filtered list. Person/action forms now fetch the complete authorized organization scope, block submission until it loads, provide retry, and return the created product so the app opens the correct context. Browser verification created a Services action from an AI Platform view.
- **P2: repeated submissions and unstable pending fields.** Settings lacked a submission guard; contact/action fields remained editable during writes. Explicit synchronous guards and disabled pending controls now keep a single submitted form state. Add-product is shown only to admins.
- **P2: duplicate product names returned a generic failure.** The unique insertion now produces a specific 409 `PRODUCT_EXISTS` without partial folders/stages; the UI retains the name for correction.
- **P2: development dependency advisories.** Drizzle's legacy loader pulled vulnerable esbuild. A pinned esbuild 0.28.1 override removes both known dev-server advisories. Frozen install, audit, migration generation, tests and build qualify the override; no schema changes were generated. [Original advisory](https://github.com/advisories/GHSA-67mh-4wv8-2f99), [Windows advisory](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr).
- **P2: unknown HTTP read operations silently returned snapshots.** GET operations are validated and unknown operations now return 400.
- **P2: release metadata and CI supply-chain hygiene.** Repository/license/package metadata, frozen lockfile identity, pinned actions, dependency updates, contribution/security guidance, license inventory and an opt-in preview workflow are included.

## Strengths supported by tests

Tenant and product isolation is enforced in domain queries and composite foreign keys. Read-only MCP shares the same authorization and rechecks active grants/memberships rather than trusting token validity alone. Connector retries are transactional and idempotent; private replies preserve their visibility. Approvals bind to content/version and invalidate on a new reply or saved edit. Native modals, keyboard-aware shortcuts and resizable panels support the daily queue without adding sending side effects.

## Keyboard and responsiveness review

Arrow-driven command selection skips disabled commands and exposes its active option through ARIA. All record views support focus movement without incidental activation. Dialogs restore trigger focus, scope-loading forms focus their primary field when ready, failed values stay editable, and material/settings submissions have synchronous guards. Product switches use authorized local projection; acknowledged writes invalidate pre-commit reads and reconcile in the background. SQL action ordering now has a deterministic ID tie-breaker. UI regression tests cover these event/focus and concurrency boundaries.

## Known unfinished flows

Guided onboarding creates an organization/first product/defaults atomically. Settings creates additional organizations/products and displays members; editing organization/time zone, invitations and permission management are not implemented. Records show company/person/related work but editing/imports are pending. Sequences are planning/review views, not an execution worker. Connections explicitly show providers as disconnected. Signed synthetic HTTP events verify the adapter contract, not a live Gmail/LinkedIn account or provider subscription. The OAuth tests use a test identity provider on local HTTP; actual Google/GitHub and Codex/Claude consent must still be qualified.

Historical inbound events currently follow the same reply-pause logic as new events. Before enabling backfill, add a historical-event policy so old imported messages cannot pause a new enrollment. Durable ingestion/reconciliation and unmatched-thread triage must precede live high-volume operation. Function-proxied material transfer must be replaced with direct private object transfer on Vercel.

## Publication boundaries

The repository is application source, intentionally `private: true` in package.json to prevent accidental npm publication. It includes Apache-2.0, fictional seed data and the lockfile; local databases/uploads, pulled deployment settings and credentials are ignored. Current source and committed history were screened for common credential/private-key patterns before push. Pattern screening cannot prove absence of every secret.

CI runs without provider/database credentials. Preview deployment is manually enabled and target-bound; production deployment, real database migrations and paid provider accounts remain unconfigured. See [verification](verification.md), [deployment setup](ci-and-deployment.md), [roadmap](roadmap.md) and [dependency notices](../THIRD_PARTY_NOTICES.md).

## Full-flow review, 4 October

The follow-up [flow review](flow-review-2026-10-04.md) resolves first-time onboarding and assistant-flow continuity, stale OAuth choices/consent, canonical MCP rendering and pending grant controls. Nine onboarding/auth/connection interaction tests, one app-level first-workspace test and two SQL HTTP setup tests augment the previous suite; the current total is 76 tests. Live providers remain unconfigured.
