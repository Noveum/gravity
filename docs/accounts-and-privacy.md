# Multiple accounts and conversation privacy

Each workspace member owns their provider connections. A member can connect several Gmail, primary Google Calendar, LinkedIn and Fireflies identities. LinkedIn uses that member's private Unipile configuration; keys are encrypted and never shared with other users. Another member, including an administrator, cannot reconnect, sync, disconnect or send from your account.

Connections lists your accounts across every authorized product. Selecting a product narrows the private import review queue, while retaining account-management controls. A connected account has a default import product; explicit review can route a customer thread to another permitted product. A sender needs access to both the connection's default product and the send's product. Distinct Gmail aliases are not separate Google account identities. Delegated shared-mailbox sending is not implemented.

Imported message threads default to private, including their source-linked follow-ups. CRM people, companies and product relationships can be shared without sharing the corresponding mailbox. Linking a message thread to a relationship does not make it public to teammates.

The owner can use **Conversation access** on the person's activity to share a selected thread with current members who can access its product. The confirmation explains that sharing covers past and future messages in that thread. **Make private** removes that access again; it cannot recall copies someone already read or exported. This does not share other threads, stored credentials or sending privileges. Imported meeting records have a separate review flow: linking a meeting shares its notes with the chosen product.

## API and MCP

The shared `set_conversation_visibility` operation is available at `POST /api/crm` with `operation: conversation-sharing`, and as an OAuth MCP tool. Read `get_relationship_context` for conversation IDs, previews and visibility. Supply the authorized product, conversation ID, current `expectedVisibility`, and requested `visibility` (`private` or `product`). A row lock and comparison reject stale changes. Only the owner can change access; administrator status, product sharing and an assistant's write scope do not transfer ownership.

MCP discovery now contains **64 current business operations (19 reads, 45 mutations)** plus eight identity/context helpers. Sequences, enrollments, follow-ups, contact policy, materials, deals and personal connector configuration use the common registry. Provider login/consent remains interactive. Sending additionally requires `crm:send`, a currently approved draft, provider consent and contact-policy checks; unknown delivery outcomes cannot be blindly retried.

Capabilities distinguish multiple-account support and thread sharing from features still absent: delegated shared-mailbox sending, Calendar event writes, message attachments and contract signing. An implemented operation is not proof that a particular provider account or assistant has completed authorization.

The Sequences page also offers **New sequence** (keyboard **C**) with product selection, ordered steps, channels, delays and templates. It calls the same `create_sequence` business operation as MCP. Creating a sequence neither enrolls contacts nor sends messages. Failed saves retain the form; pending saves prevent duplicate submissions and dismissal.

## Research and product direction

[Attio's account model](https://attio.com/help/reference/email-calendar/email-and-calendar-syncing) separates personal mailboxes from collaborative CRM history. Its [sharing controls](https://attio.com/help/reference/email-calendar/sharing-emails) illustrate why content visibility needs an explicit choice. Gravity defaults message threads to private and offers deliberate product-level sharing, while keeping credential access and sending tied to the owner. Per-person sharing, metadata-only views, exclusion rules and retention controls remain future work.

[Yodu's landing page](https://yodu.ai/) demonstrates concrete work and review steps. Gravity's new public tour follows that principle with selectable contacts, products, sequences and dashboard drill-downs. Its data is explicitly fictional. It is an interactive illustration, not a production screenshot or a report of live sending. Animations run only when reduced motion is not requested.

## Verification boundaries

Tests cover distinct accounts per owner, reconnect identity, cross-user/tenant/product isolation, private review filtering, owner-controlled sharing/revocation, live revision updates, generated MCP parity, confirmation behavior and tour keyboard interaction. Public production smoke checks exercise routes, content, metadata and assets. Following PR #22, in-app browser checks covered the landing tour, light/dark themes, a 390px mobile layout, signed-in login redirection, account controls, keyboard resizing, the command palette and workspace navigation. Screenshots remain local rather than committing production account data. Live outbound qualification requires the owner's provider consent and an explicitly authorized test recipient/message. Native assistant qualification also requires refreshed read/write/send OAuth consent; server protocol tests cannot substitute for that consent.
