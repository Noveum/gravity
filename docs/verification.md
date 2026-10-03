# Foundation verification · 3 October 2026

Verified locally on Node 22.15.1 and Bun 1.3.14.

- `bun run test`: 32 tests passed, using actual SQL migrations/constraints in PGlite and a real local HTTP OAuth/MCP server.
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

These results do not establish cloud PostgreSQL/S3 operation, production backups, Google/GitHub login, live Gmail or LinkedIn synchronization, Fireflies import, actual Codex/Claude OAuth compatibility, Vercel deployment, large files there, high-volume queue performance, or outbound reliability. Those are recorded in the roadmap. GitHub Actions is prepared but has not run remotely because this repository has not been published.

## Gravity UI and live update checks

The selected Gravity brand and exact Orbit light/dark colors were applied. Reviewed both palettes, compact density, the desktop queue/inspector, searchable commands and the next-action form. Created a fictional Follow-up 2 task through the command menu with an explicit due date; it appeared in a second browser tab without reload. Owner choices are narrowed to product members, with server-side authorization as the final check.

The actual SSE endpoint returned 200 and `text/event-stream`. A committed HTTP draft save changed the permitted stream revision from 9 to 10; one local sample observed 18 ms from starting the write to receiving the changed revision. This is a local functional sample, not a production benchmark. SQL tests also verify private-source revision filtering and membership revocation closing an existing stream.

While a local draft was unsaved, a remote HTTP save preserved the local text and exposed a conflict. Attempting Save kept the conflict and did not overwrite the committed draft. Explicit discard/reload showed the remote version. Buffers are page-session memory only.

Keyboard routing tests cover typing/IME/modal suppression, platform command modifiers, navigation prefixes and preservation of browser shortcuts. The command menu and form were exercised through browser controls; physical-key and screen-reader qualification remain pending. A revised 390 × 844 layout had no document-level horizontal overflow and uses a compact horizontal navigation row and modeless inspector drawer.

## Resizing and connected record navigation

Reviewed the compact desktop header at 49 pixels high with both themes. Dragged both dividers, used the detail divider's physical ArrowRight/Home/End keys, and confirmed the maximum width retained a 320-pixel list. Navigation/detail widths persisted after full reload. Expanded a person to fill the workspace, inspected the three-column related-work layout, and restored the split view. Tables retain readable column widths with local horizontal scrolling when the inspector grows.

Clicked People → Mira Chen → Northstar Labs → Back; the company showed its readable contacts and product relationships, and Back restored the person. Person/meeting and person/opportunity links focused the corresponding record. A sequence enrollment opened the person inspector. Awaiting them showed only the two fictional tasks owed by the other party, excluding our own scheduled review. The revised drawer and action header had no document overflow at 390 × 844. A Next.js development hot-reload router error appeared during source edits; a full reload cleared it and the subsequent clean page had no issue overlay.

Additional SQL checks enforce product-scoped company/person detail, private-action filtering, immutable MCP product grants, and product-authorized owners for meeting commitments. The real MCP tool transport calls `get_company_context` and excludes the ungranted product and its opportunity. These are foundation read flows; record editing, live providers and deployment remain subject to the gaps above.
