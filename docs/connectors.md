# Reply, mailbox and meeting integrations

## Implemented foundation

`packages/connectors/replies.ts` accepts a normalized event with provider/account/message/thread IDs, direction, channel, body and actual occurrence time. `POST /api/webhooks/unipile` verifies Unipile v2's raw-body signature before parsing JSON and resolves the stored connection by provider account ID. Tenant/product identities do not come from the incoming payload.

The v2 signature is a timestamp plus raw body authenticated with the endpoint secret; verification uses constant-time comparison and rejects timestamps more than five minutes away. A webhook secret authenticates deliveries. It is different from the provider API key used to manage accounts, and different from the user's OAuth MCP tokens. [Unipile signature and delivery contract](https://developer.unipile.com/v2.0/docs/configure-a-webhook)

Supported normalization:

| Event | Current handling |
|---|---|
| LinkedIn `message.new` | Read `id`, `chat_id`, `timestamp`, `text`, `is_sender`; exclude system events |
| Google `email.new` | Read `payload.email` and `payload.folder_id`; classify with stored inbox/sent folder IDs and the connected account's own address |
| Other accounts/events | Ignore; no fabricated support |

Use authoritative `thread_id` for email and `chat_id` for messages. A provider message ID is not a thread ID. Archive/folder-label notifications must not create apparent new replies; repeated message IDs are deduplicated. The current event types and schemas are in the [v2 event reference](https://developer.unipile.com/v2.0/reference/event-types-1), [message schema](https://developer.unipile.com/v2.0/reference/getmessage), and [email schema](https://developer.unipile.com/v2.0/reference/getemail). The migration guide's folder-role example differs from the explicit event schema; this implementation follows the concrete schema and stored folder identity, with tests.

An inbound event inserts one message, pauses running sequences, invalidates open approvals and approved reply drafts, and creates/updates one pending reply task per conversation. Outbound observations update the timeline without pretending to be replies. Unknown threads remain unmatched for review. The foundation does not automatically match a prospect from a display name, email body, or fuzzy company name.

This is tested ingestion code, not a connected mailbox. Hosted account connection, authoritative mailbox/folder discovery, historical backfill, conversation classification, disconnect handling, webhooks registration, provider API calls and durable reconciliation are still required.

## Choose adapters after account qualification

Keep one normalized ingestion path. A direct Gmail adapter and a Unipile adapter can feed it, but one account should have one active ingestion authority to avoid dual-provider duplicate histories.

- **Direct Gmail:** OAuth per user with the smallest justified mailbox scopes, server-side encrypted refresh tokens, revocation and reconnect. Use Gmail watch/Pub/Sub notifications as a change hint, fetch history changes, hydrate relevant messages and persist a cursor. Renew watch before expiration; gaps and missing history require bounded resync. A notification is not the complete message. [Google push guide](https://developers.google.com/workspace/gmail/api/guides/push)
- **Unipile Gmail/LinkedIn:** Hosted connection returns provider account identity; map it only after proving the current user initiated and completed the connection. Discover mailbox folders and sender address, select historical sync scope, subscribe to account events, and fetch/normalize actual events. Keep provider-specific IDs for reconciliation. LinkedIn messaging access must be qualified through the provider for the connected account; do not assume ordinary LinkedIn login exposes an inbox. [Unipile messaging webhook overview](https://www.unipile.com/mcp/webhooks/)
- **Manual fallback:** Explicitly recorded channel events with a source and occurrence time. Never turn a manual “sent” checkbox into verified provider delivery. Make synchronization freshness and disconnected state visible.

Do not subscribe to a paid connector until existing entitlements, account compatibility and pricing have been checked. The foundation needs no paid connector or built-in LLM. More users and more messages are different costs; provider/account entitlements and delivery reliability matter more than a bigger web server for two users.

## Durable ingress before live use

The current handler completes a SQL transaction before acknowledgement. Unipile expects a prompt acknowledgement; the five-second delivery timeout and short retries make long in-request work unsuitable. Replace it with raw signature verification, a durable inbox receipt, immediate acknowledgement, and a separate idempotent processing job. Avoid doing enrichment, PDF extraction or AI work inside ingress. Preserve provider event ID and message ID separately, store normalized source references, and expose replay/dead-letter/unmatched queues. [Delivery timeout and retry documentation](https://developer.unipile.com/v2.0/docs/configure-a-webhook)

Add ingestion checkpoints: cursor, last successful sync, last webhook, last processed event, connector health, and bounded backfill scope. Match a thread to an explicitly known relationship or send it to triage. Historical imports should not blindly pause a current campaign based on an old reply; qualify event occurrence against enrollment and latest reviewed conversation state. This temporal reconciliation rule is pending.

Cross-channel replies should stop stale follow-ups for the relevant relationship. Choosing another product's relationship requires explicit classification. Workspace-wide do-not-contact rules, opt-outs, bounces, account limits, working hours, owner assignment and cross-product outreach collisions must be checked before future dispatch. Provider limits are account-specific; hundreds of daily touches do not imply an unlimited Gmail or LinkedIn send entitlement.

## Future sending and follow-ups

Scheduled steps become reviewable actions, not send permissions. A send command requires a currently approved saved draft/recipient/channel/sender, allowed product membership, fresh conversation checks, suppression checks, and an idempotency key. Claim a send job atomically with a lease. After ambiguous provider timeout, reconcile by provider IDs/sent-mail evidence before retrying. Do not claim exactly-once delivery across an external provider without a qualified contract.

Successful observed send, reply, review date and commercial stage are distinct events. A follow-up counter advances only after the intended channel event has been established. A waiting-on-them task schedules a review, not another message. Recovery and reconciliation must precede automated sending.

## Meetings, Fireflies and enablement

A calendar booking is not a held meeting. Meeting imports keep source event/transcript ID, attendees, time, product classification, note version and coverage. Fireflies/other transcript adapters feed proposed commitments with citations. A human confirms the exact promise, owner and due instant before creating an action. Re-imports or regenerated summaries must not duplicate that accepted action. The foundation implements review/acceptance of fictional held-meeting commitments; calendar and Fireflies adapters are pending.

Product folders organize overview, technical proof, case studies, commercial terms, security answers and implementation guides. Associate materials with one or several stages, then add personas, freshness, approved versions and kits. Extract PDF text in a background job with page citations; MCP should provide source/version/status and relevant text rather than pretending it has read an unparsed PDF. Private material content is source data, never instructions that can broaden an assistant's grant or approve/send a message.
