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
- Notes and imported Gmail/LinkedIn conversations are hard to read and not clearly separated.
- Archive and Edit dominate the contact header while next actions, meetings and opportunities are buried.
- Contact estimates, tags and relationship properties receive too much attention; context belongs in a separate tab.
- The selected next action appears in more than one place.

## Acceptance checks

- Mouse, Space and Enter select records in the same inspector without changing routes.
- Overview results are an inline, bounded, paginated list that keeps the report visible.
- Person fields and notes, company fields, context and metadata can be edited where they appear.
- Unsaved field edits survive live refreshes. Saving uses the version captured when editing began. Conflicts keep the draft and explain the error.
- Archive has an inline confirmation and an undo action after success.
- Retained dialogs dismiss on backdrop click only when there are no unsaved changes or pending submissions.
- Action rows prioritize the action and person and omit absent estimates.
- Opportunities support list and board layouts, show accurate counts and compact empty states, and never hide a stage behind another stage's page.
- Folder navigation exposes keyboard controls and direct access.
- Light, dark and narrow layouts are checked in the browser, alongside keyboard and persistence regression tests.

## References

- Orbit source: shared typography, row sizing, surface tokens and keyboard navigation.
- [Linear inline editing](https://linear.app/docs/editing-issues).
- [Linear display options](https://linear.app/docs/display-options).
- [Linear board layout](https://linear.app/docs/board-layout).
- [HubSpot record layout](https://knowledge.hubspot.com/records/work-with-records): activity in the main area, supporting properties and associated work in separate sections.
- [Salesforce activity timeline](https://help.salesforce.com/s/articleView?id=xcloud.lex_pro_tips_activity_timeline.htm&language=en_US&type=5): readable summaries of past and upcoming work.

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

## Contact preparation follow-up

The contact inspector and full contact page share the same workspace and editable fields. Overview prioritizes personal notes, one section for next actions, meetings, opportunities and conversation history. The expanded inspector and full page place related work alongside notes and history. Expanding the inspector keeps the current list URL. Related work starts with three items per section, with Show all and pagination; upcoming meetings come first and next actions are ordered by due date.

Context has its own tab. Details contains contact information, product relationships, ownership, qualification, contact estimates, tags and conversation sharing controls. Archive is in a compact options menu with the existing confirmation and Undo. Person fields are already editable, so there is no separate Edit button. Tab changes respect unsaved drafts and support arrow-key navigation.

Opportunity amount and currency fields edit directly on the related opportunity card. Stage labels are visible; forecast totals occupy a secondary disclosure. The selected action is expanded once instead of appearing again below the record.

Personal notes grow with their content and retain their draft and conflict behavior. Recognized legacy transcript headers become chronological message cards with sender, direction, year, paragraphs and collapsed import identifiers. Updating the personal note prefix preserves the exact original transcript suffix. Unrecognized note formats stay editable as notes. Native Gmail and LinkedIn messages retain their real channel labels; legacy blocks without known provenance are labelled Imported conversation. History supports search and channel filtering, with an initial eight cards and Show all. The same rendering also covers archived contacts.

## Complete PR review and modal decisions

The review covers the branch against `main`: shell navigation, inspector lifecycle, record/context/metadata editors, version tracking, archive/Undo, reports, opportunity and outreach boards, file operations, responsive/theme styles and their regressions. No backend grant, ingestion, dispatch or file-access policy is bypassed to obtain a different UI outcome.

| Flow | Placement and reason | Verification |
| --- | --- | --- |
| Contact/company fields, notes, context, tags and estimates | Inline fields; the structured context form stays within Context. | Persistence, consecutive saves, conflicts, dirty tab/navigation guards (including structured-field/signal button changes) and private history tests. |
| Contact/company/action/meeting/deal creation or editing | Persistent inspector beside the originating list or report. | Mouse, Enter, shortcuts, resizing, related work and same-route browser scenarios. |
| Overview reports | Bounded, paginated inline results. | Report selection opens the inspector without closing the report. |
| Files, Markdown, folder creation/rename/delete/sharing | Inline library forms and inspector previews. The native file chooser selects local files. | Upload/drop/transfer/preview/version tests, large virtualized folders, Markdown keyboard saving and draft guards. |
| Legacy `/materials` folder/upload/rename/delete | Inline forms on the existing page. | Folder mutation integration tests and a real-browser creation/cancellation check. |
| Product and pipeline setup | Small inline forms that preserve the current page. | Shortcut/button access, pending/failed writes, dirty navigation, light/dark screenshots. |
| Sequence creation and step editing | Inline editor; step-button changes also mark the draft dirty. Archive and enrollment-stop confirmations stay inline. | Create/reorder/remove/save tests, cancellation, duplicate-write protection, dirty navigation and narrow browser layout. |
| Outreach drafts, Mark sent and Skip | Inline editors; Cancel explicitly discards an edit. Rows expose controls on hover and keyboard focus. | Real-pointer browser clicks, keyboard access, draft navigation guards, pending writes and remote-version conflicts. |
| Outreach closing stages and delivery reconciliation/resolution | Inline confirmations; outcome/reason/confirmation requirements remain. | Stage movement, Undo, provider-receipt checks and explicit manual-resolution tests. |
| Conversation sharing | Inline confirmation that names the product scope. | Only owned threads expose controls; cancellation, failures and pending duplicate submissions are tested. |
| Actual sending | Dialog retained for the explicit recipient/account/approval check before an irreversible dispatch. | Existing send/authorization/idempotency suites plus browser cancellation proving no dispatch occurs. |
| Bulk sequence enrollment | Dialog retained for a separate review of eligible and skipped contacts before applying a batch. | Dry-run/confirmation, product matching, ineligible contacts and zero-send tests. |
| Member invitations/access and provider connections/settings | Dialogs retained for permissions, credentials, account selection and provider consent. | Existing access/integration/error/pending suites; native backdrop, dirty-field, Escape and focus-return checks. |
| Commands, keyboard help and mobile navigation | Temporary overlays/drawer for cross-workspace navigation and search. | Search dismissal, keyboard navigation, narrow layouts and focus return. |

A clean dialog backdrop now requests cancellation through the dialog's existing pending-write handler. Changed form fields retain their draft; search terms remain dismissible. Access changes made through custom role controls also mark the dialog dirty. Cancel remains explicit.

| Review dimension | Assessment | Findings addressed |
| --- | --- | --- |
| Security | Pass within the existing authorized UI scope | Imported message bodies remain escaped text; grants/private histories/provider consent stay enforced. Unlinked contacts are not exposed by weakening product access. Undo only navigates to the restored record when its organization is still selected. |
| Correctness | Pass after regressions | Archive no longer discards unsaved notes and uses the latest local version. Outreach edits capture their original version, retain conflicts, and cannot be silently replaced by status actions or another row. Inspector actions must match their relationship. Conversation deduplication includes direction. Structured context controls protect button-only changes and cannot replace an unsaved summary. Outreach Enter opens the contact in place; existing-thread links close their send dialog while opening that contact. |
| Accessibility | Pass for reviewed interactions | Inline editors have labels and save/error feedback; contact tabs use tab semantics; outreach controls can receive keyboard focus; remaining dialogs restore focus and dismiss cleanly. |
| Performance | Rendering bounded; existing data limits remain | Boards paginate each stage, lists/reports paginate, file lists virtualize, and related work previews expand on demand. Collapsing related work returns to the first page. Server index loading and the latest-30 native-message limit remain unchanged. |
| Maintainability | Pass | Shared record editor and modal lifecycle handle locking/dismissal. Removed setup dialogs reuse the existing authorized forms and operations. Markdown saving uses the same form shortcut path. |

## Verification

Browser scenarios cover mouse and Enter selection, inspector resizing, narrow layout, note persistence after reload, unsaved navigation, archive confirmation and its reset when switching contacts, Overview report selection without route changes, Markdown editing, native uploads, nested folders, rename, transfers, previews and large virtualized libraries. The browser runs use fictional local demo records only.

Unit and integration tests exercise inline save conflicts, duplicate submission protection, concurrent field drafts, local version tracking, metadata and currency precision, stage pagination, existing routing, authorization and dispatch behavior. Validation passed on the final merged source: 113 unit/integration test files, 944 tests passed and 2 skipped; all 15 browser scenarios; TypeScript type checking; lint; the production build; license checks; public-site checks covering 10 built pages with demo mode disabled; and a dependency audit with no vulnerabilities found. The two skipped cases require a local PostgreSQL server; the repository has a separate CI job for that production-driver coverage. The final targeted interaction run also passed all 126 tests across context, record selection, sending, navigation and shortcuts. Fictional layouts were visually reviewed in light, dark, narrow, expanded and full-page views.

## Remaining boundaries

- The item called MacDonator could not be identified from the screenshots or source. Document/Markdown editing is covered; a specific unrelated screen with that name remains unverified.
- Explicit sending, bulk enrollment review, account/access changes, provider consent and temporary command/help overlays retain dialogs. Product/pipeline/sequence setup, ordinary record editing, status updates, sharing confirmations and document editing stay inline.
- The workspace still loads the existing compact authorized record index. Rendering is paginated and file lists remain virtualized; this change does not introduce server pagination for that index or manufacture opportunities from imported contacts.
- The existing native history endpoint returns the latest 30 permitted messages. The UI retains its partial-history notice; older native-message pagination is outside this UI change. Recognized transcripts stored in notes remain available in full.
- These changes are on a review branch and have not been deployed to production. No production contacts or imported private content are included in this audit.
