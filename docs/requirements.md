# Gravity requirements and delivery checklist

This consolidates the conversation through October 4, 2026. “Local” means implemented and reviewable with fictional data; it does not imply a production integration. This document supersedes earlier Relay/Novastave naming proposals and the original Twenty deployment direction.

| Requirement | Current status | Remaining work |
|---|---|---|
| Gravity by Noveum, generic open-source CRM | Local brand and Apache-2.0 source | New public GitHub repository, release inventory, landing page and deployment |
| Orbit's fast, clean UI and blue palette | Exact Orbit light/dark semantic colors; system preference, persistent theme and density | Accessibility and high-volume performance qualification |
| Multiple organizations by default | Guided atomic organization/first-product/time-zone setup, switching and isolated records | Invitations, membership management, organization profile/time-zone editing |
| Multiple products inside each organization | Product creation and membership enforcement | Product settings and member permissions UI |
| One person/company, several product contexts | Canonical identities; clickable company/contact/relationship navigation; connected actions, meetings and opportunities | Editing, reviewed imports and merge review |
| Several salespeople, clear ownership | Member/owner filters and product-authorized scheduling | Invitations, assignment handoff, collision warnings and owner capacity |
| Hundreds of outreach messages daily | Action queue separate from opportunity board | Pagination, virtualized rows, reviewed bulk actions and realistic load tests |
| First, second and third follow-ups | Explicit task templates with owner/channel/due date; sequence views | Sequence editor/enrollment, working hours, retries, collision checks |
| Product/company/person context and evidence | Separate relationship context, evidence inspector, fact/hypothesis and coverage disclosures | Evidence editing, enrichment providers, sourced hiring/signals and freshness |
| Gmail replies and external sends | Signed normalized ingestion and mailbox-identity handling in code | Real OAuth account UX, encrypted credentials, bounded history sync and reconciliation |
| LinkedIn replies | Tested Unipile v2 message normalization | Qualified provider account setup, encrypted credentials, durable job processing |
| Optional Unipile or own webhooks | Adapter boundaries and HMAC verification | Choose one authoritative adapter per account; subscription and permissions qualification |
| Replies stop stale follow-ups | Incoming replies pause enrollment, block/invalidate approvals and coalesce reply tasks | Live-provider qualification and send-time race/lease checks |
| Review and approval before sending | Draft hashes, user or verified assistant approval and version checks | No dispatch today; opt-outs, limits, ambiguous-send recovery before execution |
| Meetings, calendar and Fireflies notes | Meeting outcome and reviewed commitment creation; Calendar status/setup guide | Calendar/Fireflies connection, source citations and idempotent transcript imports |
| Who/when/what to follow up | Persisted next actions, promises, waiting views and conversation timeline | Due-date editing, snooze, recurrence and saved filters in URLs |
| Product enablement materials | Private PDF/Markdown/text upload, nested folders, stage associations and download | Direct object-store transfer for Vercel, extraction, scanning, versions/approval and stage/persona kits |
| Codex and Claude access via MCP from day one | OAuth CRM read/write tools over the same SQL services and permissions, including analytics, deals and pipelines; tested consent/refresh | Qualify each assistant client and installation; outbound sending remains unfinished |
| Sales and outreach analytics | Clickable Overview with live pipeline values, deal outcomes, synced message counts, follow-ups, owner/product filters and multiple pipelines | Historical stage conversion, time in stage, delivery/open tracking and custom report builder |
| Prefer OAuth without a personal API key | PKCE, resource-bound tokens, immutable org/product grants, revocation | Live Google/GitHub client configuration and signing-key operations; webhook HMAC is separate |
| Google and GitHub login; possible Orbit connection | Auth implementation/configuration points | Real credentials and invitations; future shared identity/SSO, avoid sharing session secrets |
| Real-time and instant interaction | Immediate local filters/navigation; post-save refresh; SSE revisions, same-runtime wakeups and server reconciliation | Production fan-out, measured latency, incremental patches, pagination and offline/conflict UX |
| Keyboard map | Search, command menu, safe navigation, queue movement, task creation and native modal Escape | Screen-reader/manual qualification and further shortcuts guided by real use |
| Use screen space well | Compact desktop toolbar; persistent, resizable navigation and inspector; expanded detail mode; independent scrolling and responsive drawer | Larger-display and screen-reader qualification |
| Cron/agents can add context and follow-up work | Domain model supports reviewed promises and change records | Audited ingestion/write tools and durable scheduled jobs; no automation created |
| Vercel deployment, supplied database later | Single Node application and portable PostgreSQL/S3 interfaces | Identify supplied database, backup/restore and runtime-role review; staging and HTTPS deployment |
| Keep cost modest for two initial users | Local demo requires no paid provider; no Kubernetes infrastructure | Account-specific Vercel/DB/storage/provider estimates before subscribing |

The earlier RepoCloud/Twenty setup and Cloud Run MCP endpoint are historical infrastructure, not Gravity's endpoint. Nothing in this implementation modifies them. Gravity's future production MCP URL will be its deployed HTTPS origin plus `/mcp`; the local route is not a verified live assistant connection.

## Interaction decisions

The default work surface is the due-action queue, not a single board shared by every product. Choose an organization, optionally narrow to a product, then filter ownership and action type. Open the person inspector without losing the list. Product badges on People open the corresponding relationship, so one person's histories are not mixed.

Desktop panel dividers can be dragged or focused and resized with arrow keys (10 pixels; Shift for 40), Home/End for the permitted bounds, and double-click to restore defaults. Widths persist on the device, and the layout keeps at least 320 pixels for the list. Expand detail hides the list while preserving its state; Restore split view returns it. At narrow widths, the inspector uses the existing drawer. Names link to people and companies across the directory, sequence enrollments, meetings and opportunity cards; related-work links focus the matching record. The Waiting view filters by who owes the next step, rather than treating every review task as a promise from another person.

A task has a product relationship, responsible teammate, channel, owed-by party, title, context and UTC deadline. The form labels its input in the device time zone; the queue displays dates in the organization's time zone. Templates label initial/follow-up 1/2/3 tasks without pretending that a message was sent or that a sequence advanced. Scheduling cannot route a task into a spoofed product or assign someone who cannot read that product.

Live updates never approve, send, or replace an unsaved draft. Draft edits are buffered per action in the current page session and keep the version the user edited. A remote revision exposes a conflict and requires a deliberate discard/reload or a successful version-checked save. Buffers are not an offline durable store and are lost on page reload.

## Keyboard map

| Key | Action |
|---|---|
| Cmd/Ctrl K | Searchable commands; Up/Down selects an enabled match; Enter opens it |
| ? | Searchable shortcut guide |
| / | Focus search in the current view; Escape clears it, then returns to the view |
| Cmd/Ctrl Shift L | Toggle light and dark theme |
| [ | Toggle the sidebar |
| J/K or Down/Up | Focus visible records in every record view |
| Home / End | Focus first / last visible record |
| Space / Enter | Peek at the focused row / open its record |
| X | Select or clear the focused row |
| Shift J/K or Shift Down/Up | Extend the selection down / up |
| C | Create in the current view; a person where the view has no create of its own |
| Shift P | Add a product to the current organization (admins only) |
| Shift O | Start creating a new organization |
| N | Open next-action scheduling |
| G then A/P/C/S/M/O/F/I/T/R | Actions / People / Companies / Sequences / Meetings / Opportunities / Materials / Connections / Settings / Outreach |
| O / P | Focus organization / product selector; native arrows and Enter choose |
| D / S / A | On the actions list: mark done / snooze to the next working morning / assign to a teammate |
| Cmd/Ctrl Z | Undo the last action or outreach change |
| D / S / Shift S / E | On outreach touch lists: record a send that already happened / snooze / skip with a reason / edit the draft |
| Shift Left / Shift Right | Move a focused board card to the previous / next stage |
| M | Move a focused pipeline card to any stage, including closing |
| H / L | Focus the record list / detail panel |
| E | Expand or restore the detail panel; edit the open record |
| 1 / 2 / 3 | Conversation / Evidence / Draft, when available |
| B | Return to the previous inspected record |
| Cmd/Ctrl Enter | Submit a create/settings form after native validation; save an edited draft |
| Escape | Back out one level: close an inspector and restore its trigger; native dialogs cancel unless saving |
| Tab / Shift Tab | Standard focus navigation; native modal focus containment |

Single-key shortcuts pause while typing, during IME composition, and behind modals or menus. Child controls retain consumed keys, and dividers/inspectors keep their own arrow navigation. Go-to chords expire after 900 ms. Record movement changes focus rather than opening links or downloading files; Enter activates the focused control. No shortcut approves a draft, accepts a meeting commitment, or sends a message. Native validation and synchronous submission guards apply to modifier submission. The complete searchable guide uses the same view mapping as navigation and hides unavailable creation actions. Visible key hints accompany navigation links, workspace/product selectors, creation buttons, modal submission/cancellation, and commands. Cmd/Ctrl hints adapt to the device after hydration. Add product is available from the Products sidebar, view toolbar, empty state, settings, and command palette.

## Live delivery contract

The browser subscribes to an authenticated SSE revision stream. Each check recomputes current organization/product/private-conversation permissions; only the visible revision is emitted, never raw change records. The current runtime wakes streams immediately after committed HTTP/material/webhook changes. A one-second SQL reconciliation sees changes from other runtimes; five-second fallback checks and focus recovery operate when SSE is unavailable. Streams rotate after 25 seconds and reconnect, keeping a bounded serverless request.

This is near-live delivery, not a guarantee of instant distributed synchronization. Before production, measure realistic concurrent sessions and database cost, and replace per-client reconciliation with durable outbox fan-out (for example managed pub/sub) if needed. MCP reads committed SQL state directly and uses the same domain permission rules; MCP writes publish through the same change log. No optimistic UI may bypass a server approval/version check.

## Next implementation order

1. Qualify this local design and scheduling flow, both themes, keyboard and live-update conflicts.
2. Add editable records, URL-backed saved views, reviewed imports and bounded lists.
3. Configure the supplied database, invitations/social login and real OAuth MCP client checks.
4. Connect one mailbox, reconcile replies and external sends, then add LinkedIn and meetings.
5. Qualify direct private storage and approved enablement material before deployment.
6. Add controlled outbound execution only after suppression, fresh approval and retry recovery pass.

Product switches project the already-authorized organization snapshot synchronously; they do not issue a new list request or reconnect SSE. Server checks remain authoritative. Overlapping refreshes are coalesced, delayed responses from a previous organization are discarded, and reads started before an acknowledged write cannot replace its confirmed result. Confirmed action writes update the queue before background reconciliation. Complete snapshots still require pagination and volume qualification before production.
