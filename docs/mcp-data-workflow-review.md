# Existing data and MCP workflow review

PR #30 changes navigation, presentation and forecast discovery. It contains no schema migration, import rewrite, enrollment backfill or opportunity backfill. Long notes retain their complete stored text. Contact, company and relationship estimates remain separate from actual opportunities.

## Existing records

The live MCP read path was checked through identity, capabilities, permissions, workspace, person context, sequence, integration and outreach queue tools. Existing contacts, companies, relationships, review tasks, meetings and sequence definitions remain readable. A sampled legacy record retained its imported JSON and long person notes while reporting partial conversation coverage. Unmatched provider imports remain in the owner's review queue; their presence does not create linked messages or grant permission to contact someone.

Imported prose and JSON are historical evidence. Review each identity, product and conversation before using `link_import`. That operation links all unmatched messages in the selected thread, not just one displayed item. Keep private conversation content out of shared notes unless its owner authorizes that use. Missing linked history does not establish that a person has never been contacted.

Large imports make full workspace responses unsuitable as an agent's default read. Browse with paginated `list_records`, or request `get_workspace` with `compact: "true"` for an index of identities, product relationships, stages, monetary fields and current versions. Compact mode deliberately omits long prose, context details/source and action drafts. Read specific full context before editing or outreach; blank compact fields do not establish missing history. Full workspace mode remains available explicitly and preserves its existing default for client compatibility.

The current hosted capabilities do not yet include every operation on the reviewed main branch. Automatic Git deployment is disabled. A merge does not publish the application or apply migrations. Before publishing current source, check the restricted production database against every declared table and column, review any unapplied migrations against the target and backup policy, then qualify MCP discovery on the published release. The new health and database checks reject missing columns even when the tables themselves exist.

## Agent workflow

| Work | Read and prepare | Write or execute | Checks and limits |
| --- | --- | --- | --- |
| Identity and access | `get_me`, `get_permission_audit`, `get_capabilities`, `list_products` | Reauthorize only when the intended grant changes | Organization, product grant, current membership, private history and account ownership apply to every operation. |
| Record review | `list_records`, `get_person_context`, `get_company_context` | `update_person`, `save_company`, `change_relationship`, `update_record_metadata` | Use current versions. Preserve source evidence. Context detail patches preserve omitted sections; signal/field arrays replace supplied arrays. |
| Revenue | Read actual opportunities and reviewed deal evidence | `save_deal` | `amountMinor` uses ISO minor units, such as USD cents. Unknown amount/probability is null and zero is valid. Only open deals with both fields enter forecasts. Contact estimates and company revenue are not deal amounts. |
| Sequences | `get_sequence`, `get_contact_rules`, enrollment dry run | `create_sequence`, `update_sequence`, `enroll_in_sequence`, `advance_sequences` | Dry-run `enrolled` entries are eligible candidates with null enrollment IDs. They are not enrollments or send readiness. Planning never dispatches. Template edits affect planned touches; drafted/approved touches retain their reviewed content. |
| Drafts and review tasks | Read current touch/action, context and recipient | `edit_touch_draft`, `approve_touch`, `change_action` | Editing invalidates approval. Review/research tasks and actions owed by them or unknown cannot send, even after approval. Schedule a separate reply owed by us after reviewing history. |
| Dispatch | Read owned sender account, linked thread and `get_send_readiness` | Explicit `send_touch` or `send_action` | Requires verified `crm:send`, provider send consent, current version and approval, due time, account ownership, opt-out/cooldown/quiet-hour/cap checks. Gmail needs Subject, a blank line and body. |
| Delivery outcome | `get_delivery` | `reconcile_delivery` | Keep one idempotency key per intended send. Unknown outcomes never authorize a new-key retry. Provider acceptance is not recipient delivery or a read receipt. `record_touch_sent` reports an actual external send; it is not dispatch. |
| Inbox ingestion | `get_integrations`, paginated review queue | `sync_integration`, reviewed `link_import`/`ignore_import` | Follow `nextReviewCursor` and bounded sync `more` flags. Account history stays owner scoped. Sync and classification do not send. |
| Meetings and documents | Read meetings, evidence and private materials | `save_meeting`, `accept_meeting_commitment`, `upload_material` | A booking is not a held meeting. Commitments require explicit acceptance. Calendar event dispatch, message attachments and contract signing are not implemented. |

## Sending readiness

A CRM send grant is separate from a provider's authorization. A connected Gmail account can still be read-only; inspect `get_integrations.connections[].canSend` and reconnect with sending consent when needed. LinkedIn requires an owner-configured Unipile account and provider authorization. An empty queue, an empty sequence template, a review date or a historical draft does not authorize outreach.

The live review used reads and an enrollment dry run. It did not create production enrollments, approve or dispatch messages, assign guessed deal amounts, convert historical excerpts into synced messages, or bulk classify imports. Migration preservation tests and MCP write/send tests use fictional local records and mocked provider transports.
