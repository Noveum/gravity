# Yodu lifecycle bridge

Gravity supports an explicitly configured backend bridge for source-attested signup, onboarding, payment and activation receipts. This is Gravity's integration contract. The operator must wire it into Yodu's authoritative backend; it is not an existing Yodu vendor webhook adapter. [Yodu's public developer overview](https://docs.yodu.ai/developers/overview) excludes billing from public REST/MCP, so a public workspace key is not sufficient payment evidence.

A signature establishes that the configured source asserted the event and binds its exact body bytes. It does not independently query Stripe, establish a current paid subscription, certify entitlement/access, or imply permission to contact the customer. Gravity never creates a task, approves a draft, changes stages or sends a message from these events. The four kinds describe occurrences rather than inferred current states.

## Setup and identity mapping

Configure `INTEGRATION_ENCRYPTION_KEY` and apply the generated local migration through the normal deployment process. In Connections, open **Yodu backend bridge**, select the product and create a source as a current workspace administrator. Store the once-returned signing secret only in the authoritative backend's secret configuration. Copy that source's webhook URL.

Each source is bound to one organization and product. Associate its stable external customer/workspace ID with an existing CRM relationship in that same product. Mapping is explicit; emails are never matched automatically. Unknown external subjects remain in the unassociated review queue. Source admins can correct an association using its current version; all existing receipts for that source/subject then display on the corrected relationship. Receipt content remains unchanged.

The integration is a product-owned backend source, independent of a particular mailbox. Its creator is retained as audit attribution; removing that member does not disable the organization's source. Current admins can disable it explicitly; product archival also rejects ingress. Disable and secret rotation serialize with ingestion. Rotation immediately invalidates the previous signing secret while preserving earlier receipts. A lost first-creation response can be retried using the same `sourceId`; the existing source is returned without disclosing its stored secret. Rotate explicitly to recover lost secret setup.

## Signed HTTP contract

`POST /api/webhooks/yodu?sourceId=UUID` with `Content-Type: application/json` and:

```text
yodu-signature: t=UNIX_SECONDS,v1=LOWERCASE_HEX_HMAC
```

Compute HMAC-SHA256 using the source secret over `timestamp + "." + exact UTF-8 body bytes`. Gravity accepts a timestamp within five minutes of its clock. The body is strict and capped at 10 KB:

```json
{
  "eventId": "fictional-event-1",
  "externalSubjectId": "fictional-workspace-1",
  "kind": "signup",
  "occurredAt": "2026-10-08T10:15:00Z"
}
```

`kind` is `signup`, `onboarding`, `payment` or `activation`. Decide and document each occurrence's semantics in the authoritative backend before enabling it: for example a signup committed to the identity database, an onboarding completion committed to the workspace, a processor-confirmed payment transaction, or activation of the actual entitlement. Gravity does not infer one from another. `occurredAt` is a full ISO instant with Z or an explicit offset and at most three fractional-second digits. Milliseconds are preserved; higher precision is rejected instead of truncated. An occurrence more than five minutes in the future is rejected.

`eventId` and `externalSubjectId` are stable source-local IDs, bounded to 200 characters. The body cannot contain tenant/product/relationship IDs, `verified` flags, guessed email identities, payment credentials, message history or uploaded files.

Each receipt stores the exact-body SHA-256, source version at ingestion, occurrence/receipt instants and source-local event/subject IDs in the same SQL transaction as its change event. Unique `(sourceId, eventId)` provides durable replay deduplication. Retry only with the exact same body bytes and a fresh timestamp/signature; identical receipt repeats return `{ received: true, duplicate: true, eventId: CRM_RECEIPT_ID }`. Reusing an ID with different bytes returns `409 YODU_EVENT_CONFLICT`; hold this error for review instead of minting a new ID to overwrite the fact. Different whitespace also changes the signed bytes.

Missing/invalid/stale signatures, unknown/disabled sources and archived source products return 401. Malformed bodies return 400, future occurrences return 400 `YODU_EVENT_FUTURE`, oversized bodies return 413, and demo/unconfigured transport is closed. Unknown outcomes are resolved by retrying the same signed event ID/body; this event-receipt retry never retries message dispatch.

## UI and MCP parity

Contacts show associated receipts in Evidence with occurrence/receipt times and expandable source ID/version/hash provenance. Connections supports source labels, enable/disable, rotation, explicit subject association/reassociation, and all/unassociated receipt pages. Load more customer associations to review and edit mappings beyond the first 200, including customers with no receipt events.

The shared operation registry exposes:

- `get_yodu_sources`: source metadata and 200 mappings per page; follow `nextBindingsCursor` as `bindingsCursor` for every association, including those with no receipt events. `bindingsTruncated` indicates another page remains.
- `create_yodu_source`: stable client-generated UUID, product and label; generated secret returned once.
- `update_yodu_source`: current source version plus label, enabled status or `rotateSecret`.
- `bind_yodu_subject`: source, external subject and same-product relationship; existing associations need `expectedVersion` to change.
- `list_yodu_events`: keyset pagination with optional source, relationship or unassociated filters.

Reads require current membership/product grants. Legacy/read-only MCP access excludes associations and evidence for archived contacts, matching CRM history visibility; authorized humans and verified writers retain historical access. Source configuration and association writes additionally require admin membership, verified writable MCP access for assistants, and active product access. Secrets never appear in read responses, stored credentials are encrypted, and a restricted product grant cannot address another source/relationship. Signed ingress remains a transport protocol rather than an MCP business operation; no UI/MCP write accepts a fabricated verified event.
