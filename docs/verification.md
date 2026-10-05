# Foundation verification · 3 October 2026

Verified locally on Node 22.15.1 and Bun 1.3.14.

- `bun run test`: 40 tests passed, using actual SQL migrations/constraints in PGlite and a real local HTTP OAuth/MCP server.
- `bun run typecheck`: passed.
- `bun run lint`: passed without warnings.
- `bun run build`: passed; the app, auth, discovery, webhook, materials, SSE and MCP routes compile.
- `bun run db:migrate`: applied the reviewed migrations to the fictional local database. No external database was targeted.

The tests cover tenant/product isolation, composite foreign keys, private conversation/action access and revision privacy, blocked approvals, stale writers, draft edit invalidation, one-time reviewed commitments, concurrent person creation and explicit relationship linking, inbound/outbound classification, folder moves, signed raw bodies, concurrent duplicate replies, coalesced reply tasks, retained unmatched threads, file access, immutable/revocable MCP grants, real tool transport and production demo rejection.

OAuth tests register a public client, use S256 PKCE, open simultaneous flows for different organizations/products, select independent grants, consent, exchange tokens, read only permitted products, refresh without changing the original grant, and reject revoked grants/disabled clients/expired sessions. An unauthenticated MCP request returns a discovery challenge, and following it yields protected-resource and authorization-server metadata.

Browser verification through the in-app browser:

- Organization switch removes the previous organization's products, folders, materials and context; Lunar Studio has its own product and empty material library.
- Product filtering narrows the queue and material/stage choices.
- Created a nested fictional folder through the UI; it persisted across app restart.
- Created a fictional contact through the UI and added a second product relationship without a duplicate person. Each retained separate context and created its requested research task.
- Draft rework, approval and later edit/save persisted; the saved edit removed approval. No message was sent.
- Native material dialog opened with focus inside the modal.
- A 390 × 844 viewport had no document-level horizontal overflow; the records layout was visually inspected.

HTTP verification uploaded a valid small fictional PDF through the actual application endpoint (201), downloaded identical bytes (200, private/no-store), rejected a cross-organization download (404), and rejected an unauthorized mutation origin (403). The UI showed the PDF under its product/folder, included it for Evaluation and excluded it for Proposal.

These results do not establish cloud PostgreSQL/S3 operation, production backups, Google/GitHub login, live Gmail or LinkedIn synchronization, Fireflies import, actual Codex/Claude OAuth compatibility, Vercel deployment, large files there, high-volume queue performance, or outbound reliability. Those are recorded in the roadmap. GitHub Actions repeats these checks remotely after publication; remote run results are recorded below.

## Gravity UI and live update checks

The selected Gravity brand and exact Orbit light/dark colors were applied. Reviewed both palettes, compact density, the desktop queue/inspector, searchable commands and the next-action form. Created a fictional Follow-up 2 task through the command menu with an explicit due date; it appeared in a second browser tab without reload. Owner choices are narrowed to product members, with server-side authorization as the final check.

The actual SSE endpoint returned 200 and `text/event-stream`. A committed HTTP draft save changed the permitted stream revision from 9 to 10; one local sample observed 18 ms from starting the write to receiving the changed revision. This is a local functional sample, not a production benchmark. SQL tests also verify private-source revision filtering and membership revocation closing an existing stream.

While a local draft was unsaved, a remote HTTP save preserved the local text and exposed a conflict. Attempting Save kept the conflict and did not overwrite the committed draft. Explicit discard/reload showed the remote version. Buffers are page-session memory only.

Keyboard routing tests cover typing/IME/modal suppression, platform command modifiers, navigation prefixes and preservation of browser shortcuts. The command menu and form were exercised through browser controls; physical-key checks are recorded in the later keyboard review; screen-reader qualification remains pending. A revised 390 × 844 layout had no document-level horizontal overflow and uses a compact horizontal navigation row and modeless inspector drawer.

## Resizing and connected record navigation

Reviewed the compact desktop header at 49 pixels high with both themes. Dragged both dividers, used the detail divider's physical ArrowRight/Home/End keys, and confirmed the maximum width retained a 320-pixel list. Navigation/detail widths persisted after full reload. Expanded a person to fill the workspace, inspected the three-column related-work layout, and restored the split view. Tables retain readable column widths with local horizontal scrolling when the inspector grows.

Clicked People → Mira Chen → Northstar Labs → Back; the company showed its readable contacts and product relationships, and Back restored the person. Person/meeting and person/opportunity links focused the corresponding record. A sequence enrollment opened the person inspector. Awaiting them showed only the two fictional tasks owed by the other party, excluding our own scheduled review. The revised drawer and action header had no document overflow at 390 × 844. A Next.js development hot-reload router error appeared during source edits; a full reload cleared it and the subsequent clean page had no issue overlay.

Additional SQL checks enforce product-scoped company/person detail, private-action filtering, immutable MCP product grants, and product-authorized owners for meeting commitments. The real MCP tool transport calls `get_company_context` and excludes the ungranted product and its opportunity. These are foundation read flows; record editing, live providers and deployment remain subject to the gaps above.

## Repository release preparation

Added eight HTTP contract tests for malformed/unknown reads, tenant/product restriction, admin-only transactional product creation and duplicate recovery, scheduling from a different product scope, tampered/stale/missing signatures, LinkedIn duplicate delivery, Gmail sent/inbox/archive classification, cross-account thread rejection and fail-closed connector configuration. Authentication is injected in these route tests; domain authorization and SQL are real. The separate OAuth tests continue to use a real local HTTP auth server.

Browser review created a fictional organization/product, switched tenant scope, confirmed duplicate-name correction retained the form value, and scheduled a Services action from a filtered AI Platform view. The header switched to Services and opened the saved task, Leena Rao and Cedar Systems. Connections showed Gmail/LinkedIn/Fireflies disconnected and disclosed that local OAuth MCP is unconfigured.

The dependency audit returned an empty advisory object after the esbuild 0.28.1 override. Drizzle generation reported no schema changes, and frozen install succeeded. The license inventory records 134 installed locked packages with no undeclared license fields; uninstalled platform dependencies are listed separately.

Final local checks passed with Node 22.15.1/Bun 1.3.14: TypeScript, Biome, all 40 tests and the production build. The tests also pass when the surrounding `CRM_DEMO_MODE` is false; Vitest explicitly configures its isolated local-file fixtures and production-mode rejection remains tested. Reviewed People in light/compact mode and Sequences in dark/comfortable mode. Appearance controls now dismiss on outside interaction or Escape instead of lingering over another view.

## Remote GitHub verification

The initial publication commit `8e1f85942977192597d8ac66ed57c672924a1492` passed the [first GitHub CI run](https://github.com/Noveum/gravity/actions/runs/37134125466) on a fresh Ubuntu runner: pinned checkout/runtime setup, frozen install, dependency audit, TypeScript, Biome, all 40 tests and production build. This verifies clean Linux packaging in addition to local macOS checks. The manual preview workflow remains disabled and has not deployed to Vercel.

The refreshed local browser verified that opening Appearance then pressing physical Escape closed it and returned focus to its summary; clicking Companies outside the open menu also closed it. The app was restarted successfully after its production build.

## Keyboard, form and responsiveness review

The expanded suite contains 64 tests across nine files: the original SQL/HTTP/OAuth/SSE suites, plus React/jsdom interactions, authorized product projection and refresh coalescing. UI tests use the real React components; where transport is injected, SQL fixtures and domain operations remain real in the app-level tests. jsdom dialog top-layer behavior is substituted, and native dialogs are checked separately in the browser.

Regression coverage includes disabled/empty/IME command selection, active-option ARIA, focus restoration, record movement without incidental activation, typed and consumed events, appearance/menu ownership, native required validation, scope-loading/retry, duplicate person/settings submissions and retained errors. App tests verify the view-title-to-record flow, synchronous product projection without another list read, discarded old-organization reads, confirmed completion surviving a pre-commit read, modifier draft save without approval/false conflict, and creation for another product appearing after the required full refresh.

Physical in-app keyboard checks exercised G P/C/S/M/O/T, J then Enter for people/company/sequence/meeting/opportunity records, evidence selection, inspector expansion/restoration and Escape focus return. Cmd K opened the palette; search plus Enter navigated to Companies. The ? guide opened and searched all view/work/inspector keys. C opened a native person dialog, which focused Name after scope loading; Cmd Enter created a fictional buyer. N and Cmd Enter scheduled a fictional follow-up, which appeared in a second tab without reload. Draft Cmd Enter saved the fictional text without approval. Material J focused its download link without downloading it. Light/compact and dark layouts were visually reviewed with the existing compact header and visible record focus rings.

Snapshot filtering uses Set membership rather than nested person/company scans. Product changes preserve the authorized snapshot and SSE connection. Refreshes coalesce overlapping requests; acknowledged actions update immediately and invalidate reads started before their commit. This establishes local functional responsiveness, not a high-volume or production latency benchmark.

The refreshed dependency license inventory records 186 installed locked packages with no undeclared license fields; Bun audit found no vulnerabilities. Production/provider/publication limits recorded above still apply. The repository remains private; no hosting or paid service was added in this pass.

Final local verification for this pass: TypeScript, Biome without warnings, all 64 tests, dependency audit and production build passed. Credential-pattern screening of 106 source/document files found no matches; local databases and uploads remain ignored. Screening is a limited check, not a proof against every possible secret.

## Onboarding through integration review · 4 October 2026

Current local suite: **76 passing tests across ten files**. Added atomic workspace/default/time-zone setup with rollback and tenant isolation, first-workspace UI paths, auth/consent races, pending submission guards, safe social redirects, assistant-first onboarding continuity, canonical MCP rendering/copy recovery and grant-revocation controls. Real MCP transport now verifies that Gmail, Calendar, LinkedIn, Fireflies, sending and approval capabilities are false while context reads are available.

Native browser review created Fictional Onboarding Review/Fictional Pilot, opened the selected workspace/product, created a fictional first buyer/research action with Cmd Enter and added a second product from Settings. People → Mira → company → Back, Sequences, Meetings, Opportunities, Sales materials and both themes were reviewed again. The 1280 × 720 compact layout had no document overflow, a 49-pixel header and a complete navigation sidebar fitting within 720 pixels. Thirteen screenshots were saved outside Git at `/Users/shashank/Projects/Noveum/gravity-review-2026-10-04/`.

The actual unconfigured demo returned 503 `AUTH_UNAVAILABLE` for MCP initialize and both discovery documents, 503 `CONNECTOR_NOT_CONFIGURED` for provider webhook ingress, and 403 for a CRM mutation from another origin. This verifies unavailable configuration remains closed; it does not demonstrate a live integration. OAuth/PKCE/consent/token/refresh interoperability is exercised by the separate configured local HTTP test server, not Google or a production assistant.

TypeScript, Biome without warnings, all 76 tests, Bun dependency audit (no vulnerabilities) and production build passed. The `/onboarding` route is included in the build. Credential-pattern screening of 112 text files found no matches before publication; this remains a limited pattern check. No dependencies, schema migrations, provider accounts, external database, paid subscription or production deployment were added.

The detailed [flow matrix](flow-review-2026-10-04.md) records outstanding record editing/invites, live mailbox/calendar/transcript adapters, durable jobs/backfill, Vercel file transfer, recovery, high-volume and actual Codex/Claude qualification. The source repository remains private.
