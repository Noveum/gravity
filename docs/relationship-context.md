# Relationship context and signals

A person has a separate relationship for each product and purpose. Contact identity, company, email and phone remain person/company fields. Relationship context is product-scoped and shared with members who can access that product. Private mailbox history stays in its authorized thread; copying it into context would share those notes with product members.

## Fields in the UI, HTTP API and MCP

The full person record and inspector have **Context & signals → Edit context**. The full record uses the wider main pane; narrow inspectors stack sections. The keyboard-accessible dialog supports Cmd/Ctrl+Enter to save and Escape to cancel. Saved values appear immediately from the server response and refresh through the existing live change feed. Workspace snapshots omit the new detailed document and source archive; fetch `get_person_context` to load them on demand.

| Field | Purpose |
| --- | --- |
| `context` | Readable summary, up to 10,000 characters. Never serialize an import into this prose field. |
| `contextDetails.background` | Role and relationship background. |
| `contextDetails.needs` | Needs, use cases and pain points. |
| `contextDetails.timing` | Evaluation timeline and timing constraints. |
| `contextDetails.budget` | Budget and financial fit, including what remains unverified. Deal amount/currency still belong to the opportunity. |
| `contextDetails.decisionProcess` | Decision makers and buying process. |
| `contextDetails.risks` | Risks and blockers. |
| `contextDetails.history` | Human-readable relationship history. This does not create messages or mark a draft as sent. |
| `contextDetails.signals` | Up to 100 sourced observations, with stable UUID, title, description, kind (hiring/funding/product/engagement/other), fact/hypothesis classification, nullable HTTP(S) source URL and nullable ISO timestamp. |
| `contextDetails.fields` | Up to 50 custom fields with stable UUID, label, type and matching value: text/string, number/finite number, date/ISO date, url/HTTP(S) URL, boolean/boolean. False and zero are preserved. |
| `contextSource` | Read-only original context, preserved the first time existing nonempty notes/imports are replaced. |

The complete structured details document is limited to 80,000 UTF-8 bytes; combined relationship inputs are bounded to 90,000 bytes below both HTTP adapters’ 100,000-byte envelope limit. Each narrative/description/text value is bounded to 10,000 characters. URLs containing embedded credentials or executable schemes are rejected. Unknown structured properties and duplicate IDs in an array are rejected.

## Updating with an agent

1. Read `get_person_context` for the relationship and current version.
2. Call the existing `change_relationship` MCP tool, or POST `/api/outreach` with `operation: "relationship"`. Pass `relationshipId`, `productId`, `version`, and changed `context`/`contextDetails` values. HTTP also requires `organizationId`; MCP supplies the organization from its verified grant.
3. Omitted sections remain unchanged. Supplying `signals` or `fields` replaces that complete array: retain unrelated entries from the latest read, use stable IDs for updates, and remove only intended entries. Empty text or `[]` clears a section. A stale version fails with CONFLICT; read again and review before retrying.
4. `create_person` accepts `contextDetails` as well, so an agent can create a structured relationship in one operation.

Writes require existing current membership, product access and `crm:write` for assistants. This operation does not require `crm:send`. It never sends, approves a message, changes message history, enrolls someone or schedules a touch. Imported `send_permission`, status and draft claims remain untrusted source data. Operational actions still use their dedicated APIs and send gates.

## Existing JSON imports

The previous UI displayed `relationships.context` verbatim and the update schema excluded it. That was a field/model/API gap, not an MCP limitation. Structured context now uses a validated JSONB column; JSON is storage/transport, while the UI renders actual labeled controls and values.

Legacy documents render as expandable labeled fields, arrays and nested groups under **Imported context & original source**. Long text is folded; nested children mount only on expansion. Rendering is bounded to 200,000 characters of parseable input, 30 entries per page and twenty nested levels; all entries in a group are reachable through Previous/Next fields without mounting the entire import at once. The complete unchanged source remains downloadable for larger/deeper imports. Untrusted strings are rendered as text, not HTML. Only safe HTTP(S) URLs become links. Large or malformed imports remain downloadable with a bounded text preview.

The UI leaves legacy JSON untouched when structured fields are added without a replacement summary. Saving a readable replacement summary archives the original in `contextSource`. There is no bulk conversion of real imported records: agents/users can extract factual notes and signals deliberately after reviewing provenance and privacy. Archived source is not a version-by-version edit history; change events record each edit and existing optimistic versions prevent lost updates.

## Rollout

Migration `0014_breezy_bloodstorm.sql` adds `context_details` with empty typed defaults and nullable `context_source`. It does not rewrite any existing context, version, messages or operational state. The populated upgrade is tested locally in PGlite, including a repeat migration run. Review the target and backup policy, then apply the additive migration before deploying code that reads the new columns. This PR does not apply migrations to production or import/update production records.
