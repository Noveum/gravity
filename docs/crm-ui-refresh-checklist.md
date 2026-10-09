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
- [x] Show record and outreach filters by default; allow hiding them with a remembered user/workspace preference.
- [x] Fit compact owner, tag and value controls in one line at laptop widths, with exact amounts and a range slider in the value popover.
- [x] Preserve advanced qualification/status/attribution access while avoiding redundant primary controls.
- [x] Support every business filter and sort through the operations registry and MCP with the same authorization.
- [x] Make Opportunities default to Board, with an accessible List alternative.
- [x] Combine products and pipelines into exactly one board across the full available width.
- [x] Preserve product/pipeline identity and authorization when moving cards across merged columns.
- [x] Use independently scrollable stage columns, readable compact cards and useful totals.
- [x] Keep the product and pipeline scope controls available above the board.
- [x] Make board search useful for deal, person and company names.
- [x] Supply helpful numeric minimum/maximum examples and an accessible range slider while preserving unbounded default results.
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

Filters start visible in one sticky row, with owner and tags first, a Deal value popover for amount/currency, compact qualification/status controls and sorting at the top right. The popover combines an accessible two-handle Radix slider with exact numeric inputs. Its terminal stops unset amount bounds; exact inputs retain currency precision, including JPY and KWD. Optional attribution fields use a separate popover. A hide/show button remembers an explicit choice per user and organization, retains active filters and leaves their count and Clear filters available. Amount placeholders are numeric examples; blank inputs preserve unbounded defaults. View-only URL changes merge against the current URL so rapid amount, owner and layout changes cannot discard other filters. Product selection has an explicit clear button, clears incompatible filters, and lasts for the browser session. Existing persistent product cookies are converted when the app loads.

HTTP and MCP list operations share the full filter schemas and authorized domain services. Amount ranges in the UI use major units; MCP schemas explicitly accept integer currency minor units. Actions, relationships, due touches and outreach queues support the same applicable owner, tag, qualification, status, size, currency, amount and sort controls. Filters run before paging. Current membership, product grants and private source histories remain enforced.

The integration review preserves the custom fields, internal tasks and reversible deal removal landed in PR #69. Custom-field rules use a compact popover, survive reload through a canonical URL and clear on product changes. Numeric zero, boolean false and precise date/time values remain typed. A workspace timezone change preserves the saved UTC instant. The shared server predicate applies identical rules to record, action and outreach queries. Empty searches keep active controls available; clearing and changing rules reset board pagination. Archive confirmation fits its card, retired-stage restoration uses the shared Select, and Undo restores the current layout, filters and sort.

Outreach reads existing queues immediately while planning runs separately. Slow or forbidden planning cannot hide readable queued work. Failed loads and cached responses are scoped to the current user, organization and readable products. Message report responses also hide immediately when snapshot visibility or request scope changes.

Saved views use actual action kind and owed-by state. Imported contact tags or historical notes do not establish a current reply, scheduled commitment or running enrollment. Empty saved views explain this and offer all-products or all-actions recovery. No production data was backfilled and no message was sent.

## Component research

Reviewed the current [Radix Select documentation](https://www.radix-ui.com/primitives/docs/components/select), [shadcn Select implementation](https://ui.shadcn.com/docs/components/radix/select) and [Base UI Combobox](https://base-ui.com/react/components/combobox). Reused the repository’s installed Radix Select and added the same library’s [Popover](https://www.radix-ui.com/primitives/docs/components/popover) and [Slider](https://www.radix-ui.com/primitives/docs/components/slider) primitives, pinned to verified versions 1.2.0 and 1.5.0. Their accessible keyboard and focus behavior supports the compact value filter without adding another component framework. Inspected Orbit’s select, filter bar and view controls for compact layout patterns. Native selectors elsewhere receive consistent chevron spacing.

## Browser verification

Used the local fictional demo through the browser UI at 1440px and 1280px laptop widths, 945px panel width and 390px mobile width. The 21-case automated browser suite also covers the file library, record inspector, sharing/revocation, custom fields, internal tasks, reversible deal removal and send preparation without dispatch. Checked:

- Expected revenue exposes amount, probability, weighted value, product, stage, owner and close date; open pipeline includes unpriced deals.
- Activity counts and bars are readable at low volume; a genuinely empty owner/channel selection shows useful recovery copy.
- One opportunity board includes cards from multiple products; product/pipeline controls, list alternative, sort and B/L help work.
- Minimum/maximum edits combine, survive refresh and recover through Clear filters; selected filters remain labelled after search returns no rows.
- Saved promises recover from an empty product to the actual commitment; replies and awaiting views show the correct actions.
- Outreach drafts load, sort by name, show filtered emptiness and recover after clearing.
- Light and dark controls, mobile dropdown positioning and the single-line filter bar remain usable. All controls fit at laptop widths; narrow filter rows scroll within their own container.
- Slider keyboard changes and exact amounts preserve other filters and sort; hidden bars survive reload, show active counts, clear correctly and stay isolated between workspaces.
- Opportunities appears directly below Overview in Work, in the sidebar and keyboard help; G O still opens it.
- Revenue cards remain readable with the detail panel open, and metrics use balanced 6/3/2/1 columns based on available content width. Narrow pages have no whole-page horizontal overflow; boards, filter rows and tabs intentionally scroll horizontally when needed.

Additional defects found and fixed during review: rapid URL edits overwriting one another, active owner controls disappearing after zero-result search, relationship name sorts differing between MCP and the UI, and stale private message previews surviving a scope change. The follow-up review also fixed revenue cards wrapping to three lines beside an inspector, orphaned metric rows at intermediate widths, native chevrons being erased or overlapped, hidden Select sentinel values leaking into named forms, nested value menus painting behind their popover, compact currency formatting differing between Node and Chrome during hydration, currency precision in range summaries, and slider endpoints exceeding the supported minor-unit ceiling.

The final merge-readiness review fixed two later review findings. An explicit `status=completed` in `list_next_actions` now overrides the pending-only default, with HTTP/MCP regressions preserving omitted/false/true `includeCompleted` behavior and strict schemas. Opportunities clears both local and pending custom-field drafts through the shared browser reset, then clears pipeline/stage/search without losing a pending layout change. Malformed field rules also expose empty-state recovery. The new UI regressions reproduced the failures before the fix and pass afterward.

## Validation

Typecheck, lint, license inventory, dependency audit, production build, Markdown links and the public-site smoke test passed. The final Node 22 suite passed in three shards across **144 files: 1,297 passing tests and 11 cases requiring PostgreSQL** (428 / 335 / 534 passing cases). The production driver suite subsequently passed **12/12 tests** against a newly initialized, isolated local PostgreSQL 17 instance, covering all 11 skipped cases and exercising the current migrations. The test instance was shut down and removed afterward. The prior **21-case browser suite passed**, and both populated laptop filter workflows passed again after the label-width adjustment. The later filter-reset fixes passed **31 targeted UI regressions**; a fresh interactive localhost check was blocked by the browser tool’s URL policy. Coverage includes filter/transport parity, precise custom fields and timezone changes, isolation, private sources, queue recovery, merged-board moves, archive/Undo, approval invalidation, idempotent sending and unknown-outcome safety.

GitHub did not start any hosted checks on the updated PR head: [PR checks](https://github.com/Noveum/gravity/pull/70/checks) report that the account is locked due to a billing issue. This affects CI, CodeQL and hosted link checks; they remain unverified on that head. Local checks above passed, and the PR has no merge conflicts. The required `CI ok` branch gate remains enforced. No billing or account settings were changed.

A monolithic local run stalled in PGlite's WebAssembly trap recovery. The local sharded run used the runner-only `NODE_OPTIONS=--disable-wasm-trap-handler` diagnostic flag; application and CI runtime configuration were unchanged. Validation also exposed a send-reservation test that counted a UTC day instead of the workspace day. Its fictional fixture now uses the same timezone bounds as the policy and restores rules even after a failed preflight; production sending rules were unchanged. Browser runs interrupted by dev-cache failures were repeated on a clean server with their original interaction, privacy and geometry assertions intact.

Fresh fictional demo captures are included in [ui-refresh](ui-refresh/): overview and board in light/dark themes, expanded revenue, the deal-value slider and the inspector layout. The real-contact screenshots supplied in the request are excluded.


## Evidence for all 27 items

| # | Verified result | Regression evidence |
| --- | --- | --- |
| 1 | Compact overview, balanced metrics and chart height | [Overview browser checks](../tests/browser/ui-usability.spec.ts) |
| 2 | Full-width expected revenue with precise amount, probability and weighted value | [Revenue UI](../tests/revenue-ui.test.tsx) |
| 3 | Open pipeline table includes unknown amounts, product, stage and owner | [Overview UI](../tests/overview-ui.test.tsx) |
| 4 | Activity counts, axes, low-volume bars and genuine-zero recovery | [Overview UI](../tests/overview-ui.test.tsx) |
| 5 | Saved views use actual kind and owed-by state, with recoverable emptiness | [Record usability](../tests/record-usability-ui.test.tsx) |
| 6 | Outreach loads independently of slow/forbidden planning | [Queue races](../tests/ui-refresh-queues.test.tsx) |
| 7 | Explicit removable product scope, session cookie and incompatible-filter reset | [Navigation](../tests/app-navigation.test.tsx) |
| 8 | Keyboard/typeahead, modal portal, native chevron spacing and real form values | [Select control](../tests/select-control.test.tsx), [file browser](../tests/browser/files.spec.ts) |
| 9 | Visible by default; hide/show preference survives reload and respects user/workspace scope | [Preference tests](../tests/filter-visibility.test.tsx), [browser checks](../tests/browser/ui-usability.spec.ts) |
| 10 | One compact filter row at 1440, 1280, 945 and 390px; laptop controls fully contained | [Browser geometry](../tests/browser/ui-usability.spec.ts) |
| 11 | Qualification/status remain available; attribution has a compact control where applicable | [Browser filters](../tests/browser/ui-usability.spec.ts), [attribution UI](../tests/contact-attribution-ui.test.tsx) |
| 12 | Full filters/sorts run before paging through shared authorized HTTP/MCP operations | [Transport and filter parity](../tests/ui-refresh-filters.test.ts), [custom outreach rules](../tests/outreach-field-filters.test.ts) |
| 13 | Board default, List alternative and B/L shortcuts | [Keyboard map](../tests/keyboard-map.test.tsx) |
| 14 | Exactly one merged board across readable products and pipelines | [Board model](../tests/opportunity-board.test.ts), [browser checks](../tests/browser/ui-usability.spec.ts) |
| 15 | Real product/pipeline IDs retained; ambiguous or unauthorized moves rejected | [Board moves](../tests/opportunity-board.test.ts) |
| 16 | Independently scrolling/paged columns, compact cards and accurate totals | [Record usability](../tests/record-usability-ui.test.tsx), [board browser](../tests/browser/ui-usability.spec.ts) |
| 17 | Product/pipeline selectors above the board | [Browser scope checks](../tests/browser/ui-usability.spec.ts) |
| 18 | Deal/person/company search, with active facets editable after zero matches | [Browser URL regressions](../tests/ui-refresh-browser.test.tsx) |
| 19 | Slider plus exact inputs, numeric hints, unbounded defaults and legal currency endpoints | [Value filter](../tests/value-filter.test.tsx), [integration](../tests/ui-refresh-browser.test.tsx) |
| 20 | Top-right sort and stable name/amount/currency/unknown-value ordering | [Filter sorting](../tests/ui-refresh-filters.test.ts), [browser checks](../tests/browser/ui-usability.spec.ts) |
| 21 | Discoverable keyboard hints; editing and open layers guard shortcuts | [Keyboard map](../tests/keyboard-map.test.tsx), [Select](../tests/select-control.test.tsx) |
| 22 | Rapid combined edits, clearing, scope changes, refresh and empty recovery | [URL and filter integration](../tests/ui-refresh-browser.test.tsx), [typed field rules and timezone changes](../tests/fields-tasks-ui.test.tsx), [browser checks](../tests/browser/ui-usability.spec.ts) |
| 23 | Official component research and Orbit pattern inspection | Component research above; pinned Radix dependencies and license inventory |
| 24 | Light/dark, laptop/mobile, inspector, outreach and shared dropdown verification | [Browser suite](../tests/browser/ui-usability.spec.ts), fresh [screenshots](ui-refresh/) |
| 25 | Additional race, privacy, density, dropdown, precision and hydration defects repaired | [Message scope](../tests/overview-message-scope.test.tsx), [value filter](../tests/value-filter.test.tsx), [browser reload checks](../tests/browser/ui-usability.spec.ts) |
| 26 | Typecheck, lint, licenses, complete tests, production build and public smoke | Validation above and PR checks |
| 27 | Changes remain in the requested, attached PR #70 | [Pull request](https://github.com/Noveum/gravity/pull/70) |

The latest navigation request is also complete: Opportunities moved directly below Overview in Work. Empty stage columns are genuine workflow drop targets, and unknown values remain explicit; this review did not fabricate records to fill space.
