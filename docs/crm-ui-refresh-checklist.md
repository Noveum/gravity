# CRM UI refresh checklist

Requested 2026-10-08. Each item is tracked separately for implementation and browser verification.

- [x] Replace the oversized, sparse overview presentation with a useful, restrained layout.
- [x] Expand expected revenue into a full-width report with amount, probability and weighted revenue.
- [x] Expand open pipeline value into a useful report with product, stage and owner details.
- [x] Make outreach activity readable with counts, axes and actionable genuine-zero state.
- [x] Diagnose empty Replies to handle, Promises we made and Awaiting them without inventing actions.
- [x] Diagnose empty Outreach and distinguish loading errors, missing data and filtered results.
- [x] Make product selection clearly visible and removable; stop year-long hidden scope persistence.
- [x] Fix dropdown labels, chevron overlap, popup placement and keyboard behavior throughout shared controls.
- [x] Keep record and outreach filters visible above the content at all times.
- [x] Organize filters compactly with useful owner, tag and amount controls first.
- [x] Preserve advanced qualification/status/attribution access while avoiding redundant primary controls.
- [x] Support every business filter and sort through the operations registry and MCP with the same authorization.
- [x] Make Opportunities default to Board, with an accessible List alternative.
- [x] Combine products and pipelines into exactly one board across the full available width.
- [x] Preserve product/pipeline identity and authorization when moving cards across merged columns.
- [x] Use independently scrollable stage columns, readable compact cards and useful totals.
- [x] Keep the product and pipeline scope controls available above the board.
- [x] Make board search useful for deal, person and company names.
- [x] Supply helpful numeric minimum/maximum examples while preserving unbounded default results.
- [x] Put Sort by at the top right and make all offered sort orders work.
- [x] Preserve and expand keyboard shortcuts, with discoverable hints and no typing interference.
- [x] Verify defaults, combined filters, clearing, scope changes, refresh and empty states.
- [x] Research current component documentation and inspect Orbit's modern UI patterns.
- [x] Verify overview, opportunities, outreach, actions and shared dropdowns in the browser in light/dark themes and narrow widths.
- [x] Fix any additional issues discovered during the browser review.
- [x] Run typecheck, tests, lint and production build; record material limits.
- [x] Create and attach a new pull request containing only this task's changes: [PR #70](https://github.com/Noveum/gravity/pull/70).

No real contact data, screenshots containing real contacts, credentials, uploaded files or transcripts belong in this PR. Browser fixtures are fictional and remain separate from domain code.

## Implementation and review notes

The overview uses compact metrics, full-width revenue tables and an activity chart with actual counts, scale and date labels. Empty activity explains that only synced, visible messages count. Revenue reports keep unknown values explicit and report currencies separately.

Opportunities open as one Board. Columns merge matching stage names and outcome categories across readable products and pipelines. Cards retain their real product and pipeline IDs; a drop resolves only inside the card’s existing pipeline, and ambiguous targets are rejected. Each column scrolls independently and retains bounded pagination. Deal, person, title and company search is available above the board. Board/List shortcuts are B/L and pause while typing or using a dialog.

Filters are visible and sticky, with owner, tags, currency and amount controls first and sorting at the top right. Amount placeholders are numeric examples; blank inputs preserve unbounded defaults. View-only URL changes merge against the current URL so rapid amount, owner and layout changes cannot discard other filters. Product selection has an explicit clear button, clears incompatible filters, and lasts for the browser session. Existing persistent product cookies are converted when the app loads.

HTTP and MCP list operations share the full filter schemas and authorized domain services. Amount ranges in the UI use major units; MCP schemas explicitly accept integer currency minor units. Actions, relationships, due touches and outreach queues support the same applicable owner, tag, qualification, status, size, currency, amount and sort controls. Filters run before paging. Current membership, product grants and private source histories remain enforced.

Outreach reads existing queues immediately while planning runs separately. Slow or forbidden planning cannot hide readable queued work. Failed loads and cached responses are scoped to the current user, organization and readable products. Message report responses also hide immediately when snapshot visibility or request scope changes.

Saved views use actual action kind and owed-by state. Imported contact tags or historical notes do not establish a current reply, scheduled commitment or running enrollment. Empty saved views explain this and offer all-products or all-actions recovery. No production data was backfilled and no message was sent.

## Component research

Reviewed the current [Radix Select documentation](https://www.radix-ui.com/primitives/docs/components/select), [shadcn Select implementation](https://ui.shadcn.com/docs/components/radix/select) and [Base UI Combobox](https://base-ui.com/react/components/combobox). Reused the repository’s installed Radix primitive, which provides keyboard/typeahead behavior, portalled collision-aware menus and accessible selection, without introducing another component framework. Inspected Orbit’s select, filter bar and view controls for compact layout patterns. Native selectors elsewhere receive consistent chevron spacing.

## Browser verification

Used the local fictional demo through the browser UI at normal desktop size and 390px narrow width. Checked:

- Expected revenue exposes amount, probability, weighted value, product, stage, owner and close date; open pipeline includes unpriced deals.
- Activity counts and bars are readable at low volume; a genuinely empty owner/channel selection shows useful recovery copy.
- One opportunity board includes cards from multiple products; product/pipeline controls, list alternative, sort and B/L help work.
- Minimum/maximum edits combine, survive refresh and recover through Clear filters; selected filters remain labelled after search returns no rows.
- Saved promises recover from an empty product to the actual commitment; replies and awaiting views show the correct actions.
- Outreach drafts load, sort by name, show filtered emptiness and recover after clearing.
- Light and dark controls, mobile dropdown positioning and filter wrapping remain usable. Narrow pages have no whole-page horizontal overflow; boards and tabs intentionally scroll horizontally.

Additional defects found and fixed during review: rapid URL edits overwriting one another, active owner controls disappearing after zero-result search, relationship name sorts differing between MCP and the UI, and stale private message previews surviving a scope change.

## Validation

Typecheck, lint, license inventory, production build and the public-site smoke test passed. The complete Node 22 suite passed in three shards: 988 passing tests and two production PostgreSQL skips across 122 files. PostgreSQL checks require a local server and have a dedicated CI job. Targeted filter, scope, queue, revenue, board and keyboard regressions also passed.

A monolithic local run stalled in PGlite's WebAssembly trap recovery. The complete sharded run used the runner-only `NODE_OPTIONS=--disable-wasm-trap-handler` diagnostic flag; application and CI runtime configuration were unchanged. Validation also exposed a send-reservation test that counted a UTC day instead of the workspace day. Its fictional fixture now uses the same timezone bounds as the policy and restores rules even after a failed preflight; production sending rules were unchanged.

Fictional demo captures are included in [ui-refresh](ui-refresh/): overview and board in light/dark themes, plus the expanded revenue report. The real-contact screenshots supplied in the request are excluded.
