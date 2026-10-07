# CRM request audit · 7 October 2026

This review checks contact-attribution PR #66 against the preceding CRM requests.
The branch includes merged PRs #61, #64 and #65; the attribution feature remains
unmerged and its production migrations have not been applied. This is a source,
local regression and CI review, not a fresh live-production write qualification.

| Request | Implemented behavior | Evidence |
| --- | --- | --- |
| Make imported contact data readable | Contact facts lead; long notes move to the main activity panel. Context has typed sections, signals and custom fields; original imports remain expandable/downloadable. No invented messages replace imported notes. | `tests/record-usability-ui.test.tsx`, `tests/relationship-context-ui.test.tsx`, [field audit](crm-usability-review.md), [context guide](relationship-context.md) |
| Bound meeting descriptions without losing data | Lists show bounded previews, complete disclosure and searchable descriptions. Editing preserves the original content and workspace time zone. Commitments require review. | `tests/record-usability-ui.test.tsx`, `tests/records.test.ts` |
| Make sidebar product selection open its overview | Sidebar products and All products clear the old record and open Overview. The toolbar product picker filters the current area. | `tests/record-usability-ui.test.tsx`, `src/components/crm-app.tsx` |
| Review fields and monetary reporting | Contact/company/relationship estimates, tags and currency use versioned edits. Opportunities record amount, currency, probability, owner, stage, outcome and expected close date. Expected revenue is amount × probability; currencies stay separate and missing values stay unknown. Estimates are excluded from forecasts to avoid counting a deal repeatedly. | `tests/record-usability.test.ts`, `tests/analytics.test.ts`, `tests/app-navigation.test.tsx`, [analytics definitions](analytics.md) |
| Preserve existing data | Populated migration tests compare all legacy people/relationship columns, notes, owners and versions, then repeat the upgrade. Attribution migrations add tables and constraints without fabricating historical importers. | `tests/contact-attribution-migration.test.ts`, `tests/relationship-context-migration.test.ts`, `tests/analytics-migration.test.ts` |
| Let agents use the same business actions as the UI | HTTP and MCP use the shared operation registry and schemas. Sequence creation/editing/enrollment, record/context edits, file access, approvals and provider-account management retain their authorization and versions. | `packages/operations/catalog.ts`, `tests/mcp-write.test.ts`, `tests/account-privacy.test.ts`, `tests/oauth.test.ts` |
| Keep sending explicit and safe | Verified assistants need `crm:send`, fresh approval, current membership/product grants, an owned authorized provider and a stable delivery key. Planning, sync and due dates do not dispatch; unknown delivery outcomes are not automatically resent. | `tests/outbound.test.ts`, `tests/send-ui.test.tsx`, [sending rules](mcp-permissions-2026-10-06.md) |
| Distinguish my submissions from Aditi's | Authenticated submitter, declared source member and current relationship owner are separate. People filters select submitter/source independently. Existing confirmed contacts accept additional submissions without replacing their original creator. Member names are dynamic; no teammate name is hard-coded. | `tests/contact-attribution.test.ts`, `tests/contact-attribution-ui.test.tsx`, [attribution workflow](contact-attribution.md) |
| Record assistant and provider provenance | Verified MCP client/grant identity is recorded from authentication. Provider sync records system activity and the source account owner; explicit linking retains the human/assistant actor. Private source history and filter identifiers stay with that account owner. | `tests/integrations.test.ts`, `tests/oauth.test.ts`, `tests/contact-attribution.test.ts` |
| Share screenshots and prepare the PR | Fictional screenshots demonstrate contributor history and filtering. The PR describes migrations, validation and scope; no real contact data is committed. | [history screenshot](assets/screenshots/contact-attribution-history.jpg), [filter screenshot](assets/screenshots/contact-attribution-filters.jpg) |

## Fixes and deeper checks from this review

The import-source form previously reused one immutable batch key after a partial
failure even when a member corrected the batch details. It now retains keys per
batch declaration: exact retries remain safe after a lost response, while corrected
labels, kinds or declared sources create a new batch. A regression reproduces the
failure after the first batch commits and verifies one final contact contribution.

Additional tests verify simultaneous batch retries, conflicting declarations,
cross-tenant person/product references, mismatched batch products, private provider
account references, missing source hashes and duplicate source rows. Existing UI
pagination/product-switch, revoked membership, archived-contact and actor-spoofing
tests remain part of the full suite. The earlier provider-label and People lookup
review fixes remain present. The tenant lock serializes batch creation; a suggested
extra conflict fallback is unnecessary while that lock remains in place.

## Latest-main integration

PR #65 landed while this review was underway. Its shared contact workspace and
inline editing replace the older person/inspector layout. Attribution now lives in
**Details → Import attribution** in that shared workspace, and its source form stays
inline. Both transports and all provenance remain unchanged. UI regressions cover
this placement and the source form after a partial failure. Archived contact
records also retain readable provenance; new declarations are disabled for
archived people and products.

## Validation of this review

The pre-merge Node 22 local run passes all 110 test files: 934 tests passed and two
environment-dependent PostgreSQL tests skipped. TypeScript, Biome and the production
build pass. The GitHub PostgreSQL job separately exercises the production driver.
Local browser review confirms toolbar filtering retains Companies, sidebar product
selection opens Overview, contributor filtering returns the expected fictional
contact, and the contact view exposes bounded notes and probability-weighted revenue.
Fresh browser captures contain fictional data only. No production data was mutated.

## Remaining release steps and explicit limits

Apply additive migrations 0023/0024 only after reviewing the production target and
backup/recovery policy; deploy the matching code and qualify authenticated MCP
reads/writes against the published release. A merge alone does not publish this
feature. Production amounts and probabilities must come from reviewed deal evidence.

Historical importer identities cannot be recovered from current ownership alone.
A reviewed declaration can associate an existing contact with Aditi's list; it
records the current submitter and declared source, not proof of a past uploader.
Creator/history reads follow selected-product and private-account visibility.

This feature does not include a CSV parser, a bulk-upload UI, or a unified audit
panel for every outbound operation. Agents submit parsed rows through the shared
import operations; sender/approver and delivery records remain in their existing
outreach workflows. Long legacy imports are preserved and readable, but are not
bulk rewritten or summarized into asserted facts without review.
