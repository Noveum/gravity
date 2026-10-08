# Remaining CRM features · 8 October 2026

The investigation checked each requested feature in the database/domain services, shared operation registry, UI and MCP. Deal amount and currency already belong to opportunities; this change does not add a second deal-size model.

| Requirement | Investigation finding | Implemented behavior |
| --- | --- | --- |
| Native historical messages | Provider imports existed, but native imports could only remain untrusted prose/JSON. | `ingest_history` creates explicitly native private message threads with immutable source IDs and exact timestamps. Identical retries are safe; changed evidence conflicts. The contact timeline exposes import controls, provenance and paginated history through `list_message_history`. |
| Undated drafts | Scheduled actions required a due instant; importing a draft meant inventing a date. | `ingest_draft`, paginated `list_native_drafts` and `edit_native_draft` manage private unscheduled drafts. An immutable source hash keeps retries safe after edits. `schedule_native_draft` explicitly creates one unapproved dated action; scheduling never sends. |
| Send history/exclusion/cross-channel checks | Historical outbound messages did not affect cooldowns, and old outbound imports could complete present reply actions. Legacy alias matches covered only direct identities. | Imported outbound contributes to cooldown and daily caps. Canonical email/profile aliases share exclusions, history and pending-delivery checks across channels. Inaccessible or unresolved matching history blocks dispatch without exposing its contents. New history invalidates approval, historical imports preserve action/enrollment status, and serialized claims recheck current policy and history. |
| Verified Yodu occurrences | No lifecycle connector or authoritative webhook contract existed. Yodu's public developer API excludes billing. | A documented product-scoped signed backend bridge authenticates immutable signup/onboarding/payment/activation receipts. Explicit external-subject mappings associate them with contacts. Sources and mappings are managed in Connections; receipts appear in Evidence. UI/MCP writes cannot manufacture authenticated receipts. |
| Product-wide fields and exact times | Custom fields were per-relationship arrays; list filters omitted them. Signal editing truncated occurrence times to midnight. | Typed `fieldFilters` match field name/type across authorized products, with all predicates correlated to one relationship. UI and SQL preserve false/zero and exact datetime comparisons. Datetime inputs retain seconds/milliseconds and use the workspace zone. |
| Recurring internal tasks | All actions were contact-bound and had no recurrence. | Standalone product-owned tasks have optional same-product contact links, owners, precise due times and calendar recurrence in an IANA zone. Completing an occurrence atomically advances to the next future occurrence, retains monthly anchors and skips nonexistent DST times. Internal tasks never create approvals or deliveries. |
| Legacy JSON action reasons | Reasons were readable but had no edit operation. | `update_action_reason` exposes versioned editing in the contact's action summary. The original source is preserved, editing invalidates approval, and blocked/completed states and private-thread access are retained. |

Every business operation is defined in `packages/operations/catalog.ts`, so HTTP and MCP execute the same schemas and authorized services. Verified assistants require current organization/product membership and the appropriate read/write grant; explicit dispatch still separately requires verified `crm:send`, provider consent, current approval, sender ownership and durable idempotency. Unknown message outcomes are never retried automatically.

## Rollout and verification

Migration `0025_remaining_crm_features.sql` adds native provenance/drafts, original reason archives, internal tasks and Yodu sources/mappings/receipts. It preserves existing provider messages, action reasons, dates, statuses and versions. New tables use the trusted server RLS policy and restricted runtime grants. The migration is generated and exercised locally, including upgrading populated pre-change fixtures and running the migration twice.

This work does not apply migrations to an external database, import real customer records or deploy the application. Review the target and backup policy before production migration. The signed Yodu bridge needs `INTEGRATION_ENCRYPTION_KEY`, source setup, explicit subject mapping and an authoritative Yodu backend emitter; it is an authenticated source attestation, not an independent payment-processor query or proof of a current subscription. See [Yodu bridge setup](yodu-lifecycle-bridge.md) and [field filters/internal tasks](field-filters-internal-tasks.md).

Validation completed locally:

- `bun run typecheck`, `bun run lint` and `bun run build` pass.
- `bun run test --reporter=verbose`: 124 files pass, with 1,000 passing tests. Two optional production-driver tests require a separate PostgreSQL server and are skipped.
- An additional 64 focused tests pass after hardening send-readiness responses to suppress cooldown timestamps derived from private history. Dispatch enforcement still uses the full history.
- `bun run test:public` verifies 11 built public pages with demo mode disabled, including the Yodu bridge guide.
- Focused regressions cover tenant/product/owner isolation, native import retries and conflicts, private history, approval invalidation, alias and cross-channel dispatch gates, unknown outcomes, exact timestamps, field comparisons, recurrence, legacy reason editing, signed receipts, and draft/customer-mapping pagination beyond 100/200 records.
