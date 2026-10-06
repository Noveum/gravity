# UI usability audit, October 7, 2026

The user's three screenshots and feedback are the acceptance criteria for this work. Reference products are Orbit and Linear. Record selection must preserve the list, filters, scroll position and URL. Editable data must have clear labels, save feedback and recoverable errors.

## Reported problems

- Overview cards open blocking report modals; choosing a result can navigate away.
- Click, Enter, arrow navigation and Next section behave inconsistently and unexpectedly open pages.
- Edit actions open a modal or a new tab instead of editing the selected record in place.
- Personal notes cannot be edited, long notes dominate the panel, and imported data is hard to interpret.
- Context, metadata and individual records each require another modal.
- Archive runs without checking the user's intent.
- Clicking outside a modal does not dismiss it reliably.
- Rows repeat Amount not set, hide useful labels and truncate important information.
- Typography, tabs, spacing, visual hierarchy and dark mode are hard to read.
- The Opportunities board wastes space on empty pipelines and will not scale to hundreds or thousands of records.
- Outreach and other large datasets need clear grouping, filtering, counts and useful empty states.
- Folders and frequently used destinations require too many clicks and lack discoverable shortcuts.
- The item referred to as MacDonator also opens a modal. Its exact location needs clarification.

## Acceptance checks

- Mouse, Space and Enter select records in the same inspector without changing routes.
- Overview results are an inline, bounded, paginated list that keeps the report visible.
- Person fields and notes, company fields, context and metadata can be edited where they appear.
- Unsaved field edits survive live refreshes. Saving uses the version captured when editing began. Conflicts keep the draft and explain the error.
- Archive has an inline confirmation and an undo action after success.
- Shared record-dialog forms dismiss on backdrop click only when there are no unsaved changes or pending submissions.
- Action rows prioritize the action and person and omit absent estimates.
- Opportunities support list and board layouts, show accurate counts and compact empty states, and never hide a stage behind another stage's page.
- Folder navigation exposes keyboard controls and direct access.
- Light, dark and narrow layouts are checked in the browser, alongside keyboard and persistence regression tests.

## References

- Orbit source: shared typography, row sizing, surface tokens and keyboard navigation.
- [Linear inline editing](https://linear.app/docs/editing-issues).
- [Linear display options](https://linear.app/docs/display-options).
- [Linear board layout](https://linear.app/docs/board-layout).

## Implementation

| Reported area | Result |
| --- | --- |
| Click, Space, Enter and record links | Select the same persistent, resizable inspector. Lists, filters, scroll position and routes stay available. Full-page navigation has an explicit separate control. |
| Overview reports and linked work | Reports expand in the page with bounded height and pagination. Deals and meetings open an editor beside the report or record. Pipeline headings expand a report. |
| Contact and company editing | Name, title, contact fields, company association, company description and notes are editable where displayed. Edit focuses a field. |
| Personal notes | Always available, including when empty. Labelled, resizable editors with Save, Cancel, saved feedback and keyboard saving. |
| Context and metadata | Summary and populated sections edit directly. Structured context editing stays inline; imported source data remains collapsed and read-only. Tags and estimates edit under their labelled disclosure. |
| Creation and record forms | Person, company, action, meeting and opportunity forms occupy the inspector. Folder creation, document creation, rename, sharing and delete confirmation occupy the file library. |
| Archive | Inline confirmation before sending a request, followed by Undo. Switching records resets the confirmation. |
| Unsaved changes and errors | Drafts survive live refreshes; navigation explains when saving or cancelling is required. Conflicts retain the draft. Consecutive saves of different fields preserve one another and use the current currency precision. |
| Repeated missing amounts | Absent estimates are omitted in rows, cards and report results. Recorded zero remains visible. Unknown is still an explicit filter option. |
| Typography and themes | More readable type sizes, row hierarchy, spacing, tabs, borders and layered dark surfaces. Narrow inspector and light/dark layouts checked visually. |
| Overview density | Metric cards respond to available panel width. Pipeline summaries omit empty pipelines. |
| Opportunity and outreach scale | Opportunities default to a paginated list with a board option. Each board stage has independent pagination, resets when search or filters change, and shows accurate counts; columns have bounded height and horizontal scrolling. Empty opportunities show one compact explanation. |
| Files and shortcuts | Previews and Markdown editing stay in the inspector. G F opens the library; Enter opens a selected entry, Alt+Up opens its parent and Alt+Home returns to the roots. Existing file search, column view and virtualization remain available. |

## Verification

Browser scenarios cover mouse and Enter selection, inspector resizing, narrow layout, note persistence after reload, unsaved navigation, archive confirmation and its reset when switching contacts, Overview report selection without route changes, Markdown editing, native uploads, nested folders, rename, transfers, previews and large virtualized libraries. The browser runs use fictional local demo records only.

Unit and integration tests exercise inline save conflicts, duplicate submission protection, concurrent field drafts, local version tracking, metadata and currency precision, stage pagination, existing routing, authorization and dispatch behavior. Validation passed: 110 unit/integration test files, 905 tests passed and 2 skipped; all 9 browser scenarios; TypeScript type checking; lint; the production build; license checks; and public-site checks covering 10 built pages with demo mode disabled. The two UI usability browser scenarios were rerun after the final archive-confirmation regression was added and passed.

## Remaining boundaries

- The item called MacDonator could not be identified from the screenshots or source. Document/Markdown editing is covered; a specific unrelated screen with that name remains unverified.
- Explicit send confirmation, account/access changes and pipeline/sequence configuration retain their dedicated dialogs. Ordinary record editing, context editing and document editing do not open them.
- The workspace still loads the existing compact authorized record index. Rendering is paginated and file lists remain virtualized; this change does not introduce server pagination for that index or manufacture opportunities from imported contacts.
- These changes are on a review branch and have not been deployed to production. No production contacts or imported private content are included in this audit.
