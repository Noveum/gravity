# Gravity design

Status: approved design, 2026-10-03. This document is the source of truth for what Gravity is. The implementation plans under `docs/plans/` derive from it.

## 1. What Gravity is

Gravity is an open-source, realtime, keyboard-first CRM for small teams doing a lot of outreach across several products. It has the speed and polish of Orbit (the sibling task manager), and it is built around three ideas:

1. One person can be pursued for several products by several teammates at once, without collisions, with one shared history.
2. Every follow-up is planned, every outbound message is approved by a human, and the system enforces the team's contact rules.
3. AI agents (Claude, Codex, cron-driven scripts) are first-class users through an MCP server that ships on day one.

Gravity records, plans and gates outreach. It does not send messages itself in v1. An agent or a person sends through their own tools and accounts and reports the send back. LinkedIn and Gmail sync confirm what was actually sent and received. The data model leaves room to add native sending through each member's own connected accounts later without a migration.

### Motivating use case

A team of a few founders and sellers runs several outbound motions at once: services sales, a SaaS product, a marketplace recruiting sellers, and fundraising. Each motion has its own offer, stages and messaging. Together the team sends around a hundred personal LinkedIn and email messages a day. Today that work lives in per-campaign SQLite files, spreadsheets, static HTML review pages and one-off scripts. Campaigns cannot see each other, statuses are free text, the offer drifts between drafts, and nothing is live.

### Non-goals for v1

- Sending messages from Gravity itself. This comes later, behind the same gate.
- Marketing automation, landing pages, newsletters, ticketing.
- Native mobile apps.
- Pooling several LinkedIn accounts per person.

## 2. Product principles

1. **One person, many pursuits.** A person exists once. Each pursuit is a lead with its own owner, stage and sequence. History is shared; ownership is not.
2. **Nothing goes out without a human.** Agents research and draft. A person approves the exact text. The gate re-checks every rule at hand-off time. Review dates are never send dates.
3. **Every open lead has a next step.** A lead with no planned touch, open task or hold shows up in the queue until someone decides.
4. **Context before contact.** The full cross-channel history across every teammate is checked before a first touch. Facts carry a source and a date.
5. **Agents are first-class users.** Every agent write is attributed to the agent client and the human it acts for, appears on the timeline, and loses to a human edit.
6. **Orbit-grade speed.** Keyboard everywhere, realtime everywhere, optimistic updates, a cached first paint, no layout animation.
7. **Generic by construction.** Brands, pipelines, stages, fields, playbooks and policies are configuration. Nothing in the code names a particular company.

## 3. Domain model

### 3.1 Concepts

- **Workspace.** The tenant. Members belong to workspaces with a role (owner, admin, member, guest). Agent identities are members flagged `is_agent`.
- **Brand.** A business the workspace sells for. Owns a versioned playbook (ICP, offer, price, voice, banned phrases, examples), a signature and default senders.
- **Pipeline.** Belongs to a brand. Has a kind (`people` for prospecting, `deals` for company-level opportunities), ordered stages and its own custom fields.
- **Stage.** Ordered within a pipeline, with a category: `open`, `won`, `lost`, `hold`.
- **Person** and **Company.** Facts about the world. A person has emails, phones, LinkedIn URL and provider id, location, timezone and a do-not-contact flag. A company has domains, size, revenue band and segment.
- **Employment.** Person × company with title, start, end, `is_current`. Job changes are signals.
- **Lead.** One person pursued in one pipeline. Owner, stage, source, priority, hold reason and hold-until, next action and time, `owed_by` (`us`, `them`, `none`). There is at most one open lead per person per pipeline.
- **Deal.** One company pursued in a deals pipeline. Amount, currency, close date, participants with roles. A lead can qualify into a deal; the lead keeps its history and links to the deal. Nothing is converted or destroyed.
- **Fact.** A sourced, dated claim about a person or company: kind (`hiring`, `funding`, `news`, `tech`, `pain`, `relationship`, `other`), claim, source URL, observed-at, expires-at, author, confidence. A fact flagged as a signal raises a task.
- **Conversation** and **Message.** A channel thread (email thread, LinkedIn chat) and its messages, synced from each member's connected accounts and matched to people. Manual matches are never overridden by sync.
- **Activity.** An append-only timeline event with kind, actor and payload, fanned out to the people, companies, leads and deals it concerns.
- **Sequence**, **Step**, **Variant.** A versioned plan of touches with channels, delays, windows, threading and stop rules.
- **Enrollment.** A lead running a sequence version, with a sticky sender per channel, state, current step, paused-until and finish reason.
- **Touch.** One planned outbound message. The unit of the approval queue.
- **Task.** A unit of human work: reply, call, manual LinkedIn step, meeting follow-up, research, signal review, todo.
- **Meeting.** A calendar event with attendees, an optional notetaker transcript reference, a summary and action items.
- **Suppression.** A do-not-contact entry by email, domain, person, company, LinkedIn provider id, or country plus channel, scoped to the workspace or one brand.
- **Sender identity.** A member's connected account for one channel (LinkedIn via Unipile, Gmail mailbox) with caps, timezone and health.

### 3.2 Tables

All tables follow Orbit's conventions: singular snake_case names, text UUIDv7 ids from `randomUUIDv7()`, `organization_id` with cascade, `sync_id bigint` for realtime catch-up, `created_at` and `updated_at` timestamptz, `archived_at` where records can be archived.

| Table | Key columns | Constraints and notes |
| --- | --- | --- |
| `organization` | name, slug, settings jsonb (contact policy) | named for better-auth's organization plugin; shown as Workspace |
| `member` | workspace, user, role, is_agent | unique (workspace, user) |
| `brand` | name, domain, color, signature | |
| `playbook_version` | brand, version, body (markdown), variables jsonb | unique (brand, version); brand points at its current version |
| `pipeline` | brand, name, key, kind, lead_counter | unique (organization, key) where not archived; key is 2 to 5 uppercase letters |
| `stage` | pipeline, name, category, sort_order | |
| `field_definition` | object (`person`, `company`, `lead`, `deal`), pipeline nullable, key, type, options, description, example | unique (workspace, object, pipeline, key) |
| `company` | name, domains text[], size, revenue jsonb (per source), segment, location, fields jsonb, fields_meta jsonb | unique (workspace, primary domain) |
| `person` | name, emails text[], primary_email, phones, linkedin_url, linkedin_provider_id, location, timezone, do_not_contact, fields, fields_meta | unique (workspace, primary_email), unique (workspace, linkedin_provider_id) |
| `employment` | person, company, title, started_at, ended_at, is_current | |
| `lead` | person, pipeline, number, owner, stage, source, priority, hold_reason, hold_until, next_action, next_action_at, owed_by, last_inbound_at, last_outbound_at, unanswered_streak, fields, fields_meta, deal nullable | partial unique (person, pipeline) where stage category is open or hold; unique (pipeline, number); shown as `KEY-number`, for example `YOD-142` |
| `deal` | company, pipeline, owner, stage, amount, currency, close_date, fields, fields_meta | |
| `deal_participant` | deal, person, role | |
| `fact` | subject_type, subject_id, kind, claim, source_url, observed_at, expires_at, confidence, is_signal, author actor | |
| `conversation` | channel, sender_identity, provider_thread_id, person nullable, match_state | unique (sender_identity, provider_thread_id) |
| `message` | conversation, direction, provider_message_id, sent_at, body, touch nullable | unique (conversation, provider_message_id) |
| `activity` | kind, actor, occurred_at, payload, external_id | unique (workspace, external_id) where not null |
| `activity_link` | activity, entity_type, entity_id | |
| `note` | subject_type, subject_id, body (Tiptap JSON), author | |
| `sequence` | brand, pipeline, name, current_version | |
| `sequence_version` | sequence, version, stop_rules jsonb, schedule jsonb | |
| `step` | sequence_version, position, action, delay_amount, delay_unit, condition, thread_with_step | |
| `variant` | step, weight, subject, body_template | |
| `enrollment` | lead, sequence_version, state, current_step, paused_until, finish_reason, sender_by_channel jsonb, enrolled_by actor | |
| `touch` | lead, enrollment nullable, step nullable, variant nullable, channel, sender_identity, due_at, window_end_at, state, draft_body, draft_subject, draft_author actor, draft_sources jsonb, playbook_version, approved_by, approved_at, approved_hash, approval_expires_at, claim_token, claimed_by actor, claim_expires_at, sent_at, provider_message_id, sent_hash | unique (enrollment, step) where enrollment not null |
| `task` | kind, subject_type, subject_id, lead nullable, assignee, due_at, status, source jsonb | |
| `meeting` | calendar_event_id, starts_at, ends_at, status, attendees jsonb, summary, action_items jsonb, transcript_ref | |
| `meeting_person` | meeting, person | |
| `suppression` | kind, value, brand nullable, reason, source, expires_at | unique (workspace, kind, value, brand) |
| `sender_identity` | member, channel, provider, external_account_id, status, timezone, caps jsonb | |
| `sender_usage` | sender_identity, local_date, action, count | unique (sender_identity, local_date, action) |
| `integration_connection` | member, provider, encrypted credentials, scopes, status | credentials AES-GCM encrypted |
| `saved_view` | object, pipeline nullable, name, filter jsonb, display jsonb, visibility, owner | |
| `outbox` | sync_id, payload, published_at | written in the mutation's transaction |
| `webhook_inbox` | provider, external_event_id, payload, received_at, processed_at, error | unique (provider, external_event_id) |

Auth tables (`user`, `session`, `account`, `verification`, `passkey`) and MCP OAuth tables (`oauth_application`, `oauth_access_token`, `oauth_consent`, `mcp_grant`) follow Orbit's better-auth setup.

### 3.3 Custom fields

Custom field values live in a `fields` jsonb column on person, company, lead and deal, validated against `field_definition` through Zod schemas generated at request time. A sibling `fields_meta` jsonb records `{source, actor, at, confidence}` per key. A human write always wins over an agent or enrichment write to the same key. A key used in a saved view's filter or sort gets an expression index. Per-tenant DDL is rejected because it makes every upgrade a migration of every workspace.

### 3.4 Stages and status

There is one stage per lead or deal. There is no separate lifecycle stage or lead status. A person's overall status (`prospect`, `in_conversation`, `customer`, `do_not_contact`) is a derived read-only rollup over their leads and deals.

Default prospecting stages: New, Researching, Ready, Contacted, Follow-up, Replied, Meeting booked, Meeting held, Qualified, On hold, Closed: no reply, Closed: not a fit, Do not contact. Default deal stages: Discovery, Proposal, Negotiation, Won, Lost. Workspaces can edit both.

### 3.5 Actors

Every write records an actor: `{type: "user", userId}`, `{type: "agent", clientId, onBehalfOf: userId}`, `{type: "sync", provider}`, or `{type: "system", job}`. The timeline renders agent actors as "Claude for Shashank".

## 4. Contact policy

The policy is enforced in `packages/engine`, shown in the UI, and explained in MCP responses. Every threshold is a workspace setting.

| Rule | Default |
| --- | --- |
| One open lead per person per pipeline | Enforced by a unique index |
| Person cooldown across all pipelines and senders | No two outbound touches within 3 days |
| Company lock per brand | One live opening per company per brand; a sibling contact needs an override with a reason |
| A reply anywhere pauses everything | All enrollments for the person pause, and every lead owner is notified |
| History gate before a first touch | 3 or more unanswered outbound days means blocked; an existing warm relationship means personal handling only |
| Suppression | Workspace-wide or per brand; opt-outs, bounces and complaints are added automatically |
| Country and channel rules | Configurable list, for example no cold email to Germany |
| Approval freshness | Opening approvals valid for 24 hours, reply approvals for 10 minutes |
| Follow-up budget | Per pipeline, for example one nudge after 7 or more days, then close as no reply |
| Sender caps | Per sender and action per local day, for example 100 LinkedIn messages and 20 invites |

The policy is a pure function, `evaluate(context) -> { allowed, blocks: Block[], warnings: Warning[] }`. Each block carries a code, a human-readable explanation and a resolution hint ("override with reason" or "wait until 2026-10-08"). The function runs when a touch is planned, when it is approved, and when it is claimed for sending.

## 5. Outreach flow

### 5.1 Touch lifecycle

```
planned -> drafting -> awaiting_approval -> approved -> claimed -> sent
                                    ^            |          |
                                    |            v          v
                                    +------ expired     released (back to approved)
planned | awaiting_approval | approved -> canceled   (reply, opt-out, collision, enrollment stopped)
awaiting_approval -> skipped                         (human skips)
claimed -> failed -> approved                        (sender reports failure)
```

- A touch is planned by a sequence step coming due or by a one-off follow-up.
- An agent or person writes the draft. The draft stores its author, the facts it used and the playbook version.
- A human approves the exact text. Approval stores `approved_hash` and `approval_expires_at`. An expired approval returns the touch to `awaiting_approval`. A playbook version change marks unsent drafts stale.
- **Hand-off.** A sender (an agent run or a person) calls `claim`. The claim re-runs the policy, checks the window and the sender's cap, and returns the approved text with a claim token valid for 10 minutes. Only one claimant can hold a touch.
- The sender sends through their own account, then reports `sent` with the provider message id and a hash of the text actually sent. A hash mismatch is recorded and flagged.
- **Sync is the source of truth.** An outbound message observed through Unipile or Gmail that matches a claimed or approved touch (same sender, same thread or person, inside the window, matching text) marks the touch sent even if nobody reported it. A message sent from a phone still lands on the timeline.
- Native sending later is an internal claimant using the same claim and report path.

### 5.2 Sequences

- Step actions: `email_new`, `email_reply`, `linkedin_invite`, `linkedin_message`, `linkedin_inmail`, `linkedin_visit`, `call`, `manual_task`, `wait_until`.
- Delays in business days or hours. Windows run in the prospect's timezone, falling back to the sender's.
- One level of branching on a condition (`invite_accepted`, `replied`, `meeting_booked`, `has_email`).
- Stop rules: a reply on any channel always stops; meeting booked and opt-out stop; an out-of-office reply pauses until the return date.
- Agents draft each touch up to 24 hours before it is due. An unapproved touch slides to the next window and is never sent automatically.
- Editing a live sequence creates a new version; running enrollments keep theirs.
- Bulk enroll always runs as a dry run first and reports clean, company-locked, in cooldown, suppressed and history-blocked counts.

### 5.3 Planner and jobs

Built-in jobs run from Vercel cron routes guarded by `CRON_SECRET` (a long-running scheduler process in Docker):

| Job | Interval | Purpose |
| --- | --- | --- |
| `plan` | 1 min | Materialize due sequence steps into touches; expire approvals and claims; wake held and paused leads |
| `inbound` | 1 min | Process `webhook_inbox` rows: match threads, apply stop, pause, owed-by and suppression rules, confirm sends |
| `reconcile` | 15 min | Poll each connected account for anything a webhook missed |
| `renew` | daily | Renew Gmail watches and other provider subscriptions |
| `digest` | hourly | Send each member's daily digest at their local morning |

Claims use `SELECT ... FOR UPDATE SKIP LOCKED`. Cap counters in `sender_usage` are incremented under a row lock at claim time and corrected from sync.

## 6. User interface

The visual language and interaction model come from Orbit, and `2026-10-03-gravity-ui.md` is the detailed interface spec: sidebar, dense virtualized lists, a peek panel, a command palette, single-key verbs, light and dark themes from CSS custom properties, motion limited to transform and opacity under 200ms.

### 6.1 Navigation

- **Work:** Today, Inbox, Meetings.
- **Records:** Leads (per pipeline, list or board), People, Companies, Deals, Sequences, saved Views. Pipelines are grouped under brands in the sidebar.
- **Settings:** Brands and playbooks, pipelines and stages, custom fields, contact policy, senders and caps, integrations, suppression list, MCP clients, members.

### 6.2 Today

The home screen is a queue with sections: Replies owed, Approvals, Follow-ups due, Meetings, Signals, No next step, Ready to send (approved touches waiting for a sender). Focus mode shows one item at a time in three panes:

- left: person, company, every lead with its owner, cross-brand overlap banner, timeline, facts with ages;
- centre: the draft with channel, sender, window, author, sources and playbook version; actions Approve and next (`A`), Edit (`E`), Regenerate with instruction (`R`), Snooze (`H`), Skip (`X`);
- right: why it is due now, each policy check with its result, the sender's cap meter, the remaining steps.

For a person sending by hand, an approved touch offers "Copy and open" (copies the text, opens the LinkedIn chat or Gmail compose) and "Mark sent". Sync confirms either way.

### 6.3 Lists, records and inbox

- **Lead list:** grouped by stage, columns for person, company, owner, last touch, next action, owed-by and sequence step. `S` sets stage, `A` assigns, `E` enrolls, `Shift+H` holds with a reason.
- **Person record:** attributes and one card per lead on the left; a unified timeline across channels, teammates and brands on the right, filterable by brand and kind; a composer for notes (`N`), calls (`L`) and tasks (`T`).
- **Company record:** people at the company with their lead chips, deals, facts, the company lock state per brand.
- **Inbox:** unified email and LinkedIn conversations for the member, matched to people, with an unmatched bucket and a manual match action.
- **Meetings:** upcoming with prep context, past with summary, action items converted to tasks, and a recap draft as a touch.
- **Bulk actions:** multi-select or select all matching the filter; enroll, assign, stage, hold, suppress; every bulk action has a dry run and can be undone.

### 6.4 Keyboard

`Cmd+K` palette; `G T` Today; `G I` Inbox; `J`/`K` move; `Space` peek; `A` approve or assign; `E` edit or enroll; `R` regenerate; `H` snooze; `X` select or skip; `S` stage; `Shift+H` hold; `N`, `L`, `T` note, call, task; `Cmd+Z` undo.

## 7. MCP server

Served at `/mcp` from the web app. OAuth 2.1 with dynamic client registration and PKCE through the better-auth MCP plugin, with a consent screen where the user picks a workspace and re-verifies with a passkey. Access tokens are validated against the shared database and bound to an `mcp_grant`.

### 7.1 Scopes

- `gravity.read`: everything the user can read.
- `gravity.write`: records, facts, tasks, drafts, enrollments, claiming and reporting sends.
- `gravity.approve`: approving touches. Off by default, warned on consent, and can be forbidden by workspace policy.

A token with neither read nor write is refused with 403 before any tool is registered.

### 7.2 Tools

| Tool | Scope | Purpose |
| --- | --- | --- |
| `describe_workspace` | read | Brands, current playbooks, pipelines, stages, field definitions, contact policy, the caller's senders and caps |
| `search` | read | Fuzzy search over people, companies, deals, conversations |
| `get_context` | read | Token-budgeted bundle for a person or company: fields, employment, leads with owners, recent timeline, facts with ages, open tasks, policy state |
| `list_queue` | read | A member's Today queue by section |
| `list_leads` | read | Leads in a pipeline using the UI filter language or a saved view id |
| `get_conversation` | read | A full email or LinkedIn thread |
| `check_contact` | read | Whether a person can be contacted for a pipeline, by whom and when, with blocking rules explained |
| `query` | read | Read-only aggregates: funnel by stage, reply rate by variant or sender, touches per day |
| `upsert_person`, `upsert_company` | write | Match on email, LinkedIn provider id or domain; return created or matched and a field diff |
| `add_facts` | write | Attach sourced, dated facts; optionally flag a signal |
| `create_lead`, `update_lead` | write | Stage, owner, hold with reason, next action |
| `import_rows` | write | Bulk upsert with dedupe; dry run by default |
| `log_interaction` | write | Record something that happened elsewhere; idempotent on an external id |
| `ingest_meeting` | write | Attendees, summary, transcript reference, action items; matched to people and turned into tasks |
| `draft_touch` | write | Write the draft for a planned touch or propose a one-off; stores reasoning and facts used |
| `enroll` | write | Enroll leads in a sequence; dry run first with the collision report |
| `create_task`, `complete_task`, `snooze` | write | Follow-ups and todos |
| `list_ready_touches` | write | Approved touches due now for the caller's senders |
| `claim_touch` | write | Re-run the policy and return the approved text and a claim token, or the blocks |
| `report_touch_sent`, `report_touch_failed`, `release_touch` | write | Close out a claim with the provider message id and sent-text hash |
| `approve_touch` | approve | Approve a draft on the human's behalf |

Every write accepts an idempotency key. Bulk writes default to dry run. Responses are compact text plus `structuredContent`, with deep links into the web app. Errors name the field and suggest the closest valid values.

### 7.3 Resources

Each brand's current playbook is an MCP resource (`gravity://brands/{slug}/playbook`) and is included in `describe_workspace`.

## 8. Integrations

Every connection belongs to one member. Channels implement one interface in `packages/channels`:

```ts
type ChannelAdapter = {
  connect(input: ConnectInput): Promise<ConnectResult>
  verifyWebhook(request: Request): Promise<boolean>
  parseEvent(payload: unknown): ChannelEvent[]
  fetchThread(ref: ThreadRef): Promise<ThreadSnapshot>
  listSince(cursor: SyncCursor): Promise<SyncPage>
}
```

`send` is added to the interface when native sending lands.

| Need | Provider | v1 scope | Milestone |
| --- | --- | --- | --- |
| LinkedIn | Unipile | Hosted auth per member; webhooks for messages, reads, accepted invites and account status; history backfill | M1 |
| Email | Gmail API | OAuth per member and per mailbox; Pub/Sub watch plus history sync; thread matching | M1 |
| Calendar | Google Calendar | Watch channels; moved and cancelled events; meeting booked stops sequences | M4 |
| Booking | Calendly | Booking webhooks | M4 |
| Meeting notes | Fireflies (webhooks v2) | HMAC-verified transcript events; attendees, summary, action items | M4 |
| Enrichment | Apollo, People Data Labs, Crustdata | Per-field waterfall with provenance; watchers raise signals | M5 |
| Notifications | Resend | Digest, reply alerts, approval nudges | M2 |
| Email (Microsoft) | Microsoft Graph | Same adapter | M6 |

## 9. Architecture

### 9.1 Topology

One Next.js app deployed as one Vercel project on the node runtime, in the same region as the database. It serves the UI, REST route handlers, the realtime socket at `/api/ws`, the MCP server at `/mcp`, cron routes and provider webhooks. Postgres holds records, the touch queue, the outbox and the webhook inbox. Redis carries realtime fan-out and rate limits. S3-compatible storage holds attachments and transcripts. Local development uses Docker Compose for Postgres, Redis and MinIO, and a Bun socket host for realtime.

### 9.2 Repository layout

```
apps/web                  Next.js app: UI, REST, auth, /api/ws, /mcp, cron, webhooks
apps/realtime             Bun socket host, local development only
packages/shared           Zod contracts, events, policy types, filters, errors, utils
packages/db               Drizzle schema, migrations, client, seed, release tooling
packages/core             Domain services: every mutation goes through here
packages/engine           Pure logic: contact policy, planner, touch state machine, matching
packages/channels         Unipile and Gmail adapters
packages/integrations     Calendar, Fireflies, enrichment providers
packages/mcp-server       MCP tools and the fetch handler behind /mcp
packages/realtime-server  Connection hub: tickets, scopes, presence, Redis fan-out
packages/realtime-client  Browser client and React hooks
scripts/                  Repo tooling in TypeScript, run with bun
```

### 9.3 Stack

| Layer | Choice |
| --- | --- |
| Toolchain | Bun for install, scripts and tests; Biome; node at runtime |
| App | Next.js 16, React 19 with the React Compiler, Tailwind 4, Radix primitives, cmdk |
| Client data | TanStack Query 5 with IndexedDB persistence, TanStack Virtual, dnd-kit |
| Editor | Tiptap 3 |
| Database | Postgres, Drizzle ORM over postgres.js, `pg_trgm` and `tsvector` search |
| Realtime | `ws` upgraded by `@vercel/functions`, ioredis, transactional outbox |
| Auth | better-auth with Google, GitHub, passkeys, email OTP, organization plugin, MCP plugin |
| Validation | Zod 4 contracts shared by routes, MCP and client |
| Storage and email | `@aws-sdk/client-s3`, Resend |
| Tests | `bun test` against a real Postgres per package, Playwright end to end |

### 9.4 Realtime

Every mutation runs in a transaction that writes rows, bumps `sync_id`, records activity, and inserts its `SyncAction`s into `outbox`. After commit the route publishes the outbox rows to Redis and stamps `published_at`. The `plan` job republishes any outbox row older than 30 seconds that was never published. The hub fans actions out to sockets subscribed to matching scopes (`workspace:`, `brand:`, `pipeline:`, `person:`, `user:`). The client patches the TanStack Query cache and never refetches a list the user is looking at.

### 9.5 What comes from Orbit

Taken and adapted from Orbit: the better-auth configuration and OTP templates, principal resolution, invites and the email domain allowlist, the realtime hub, client and tickets, `defineTool` with scope gating and MCP token verification, the UI components and design tokens, the keyboard registry and command palette, query persistence and server prefetch, the route handler wrapper, storage and email services, cron authentication, migration release and drift tooling, and repo scripts and the verify pipeline. The filter AST becomes generic over a property registry.

Left behind: teams, workflow states, cycles, estimates, milestones, issue identifiers, GitHub reconciliation, burndown analytics.

Fixed on the way in: a transactional outbox, integration tokens encrypted at rest, no account linking across different emails, a registry of realtime models and scopes instead of a hardcoded list, files kept small.

## 10. Authentication

Gravity runs standalone with its own auth tables, so a self-hosted copy needs nothing else. Sign-in methods are Google, GitHub, passkeys and email OTP, with optional argon2id passwords behind `GRAVITY_PASSWORD_AUTH`. An `ALLOWED_EMAIL_DOMAINS` allowlist applies to invites and user creation.

A generic OpenID Connect provider slot (`GRAVITY_OIDC_ISSUER`, `GRAVITY_OIDC_CLIENT_ID`, `GRAVITY_OIDC_CLIENT_SECRET`, `GRAVITY_OIDC_LABEL`) lets a deployment add one more button such as "Continue with Orbit" or "Continue with Noveum" when that identity provider exists. Orbit does not act as an OIDC provider today; adding that is Orbit-side work and out of scope here.

## 11. Data import

`bun run import <adapter> <path>` with one adapter per source. Every import is idempotent on source ids, deduplicates on email, LinkedIn provider id and domain, starts with a dry-run report, and writes history as backdated activities. The repository ships a generic CSV adapter and a JSON adapter driven by a mapping file. Adapters for private sources live outside the repository.

## 12. Security and privacy

- Integration credentials are encrypted with AES-256-GCM under `GRAVITY_ENCRYPTION_KEY` and never returned by any API or tool.
- Every query is scoped by workspace in `packages/core`. Authorization goes through `packages/shared/src/policy`; the UI reads the same policy to hide affordances.
- Every write records its actor.
- Erasing a person deletes their data and keeps a hashed suppression entry so they are never contacted again.
- Webhooks are verified per provider (HMAC or shared secret) and deduplicated on the provider's event id.
- Seeds, fixtures and screenshots use fictional companies only.

## 13. Repository rules

The same rules as Orbit: Bun is the only package manager and script runner; no comments in code; no AI attribution; no em-dash characters; strict TypeScript with no `any` and no non-null assertions; Zod at every boundary; tests under each package's `tests/` mirroring `src/`; a database test refuses to run against a database whose name does not contain `test`; `bun run verify` runs lint, the comment policy, the Bun import check, typecheck and tests, and must be green before merge. License: Apache-2.0.

## 14. Milestones

| Milestone | Scope | Done when |
| --- | --- | --- |
| M0 Foundation | Repo seeded from Orbit's platform; auth; workspaces; brands, pipelines, stages; people, companies, leads; list, board, record and peek views; command palette; realtime with outbox; MCP read tools; CSV and JSON import | Two members sign in, see imported people and leads across brands, and an agent can search and get context over MCP |
| M1 Context and history | Unipile and Gmail read sync; unified timeline and Inbox; facts and notes; contact policy engine with history gate; MCP write tools | Cross-campaign overlap and relationship history are visible on every record without manual audits |
| M2 Queue and approvals | Touches and tasks; Today and focus mode; approval freshness; claim and report hand-off; sync-confirmed sends; reply detection; owed-by; daily digest | A full day of outreach across all brands runs from Today, with agents claiming and reporting sends |
| M3 Sequences | Versioned sequences, branching, windows, stop rules, bulk enroll dry run, playbook variables and stale drafts, A/B variants | First, second and third touches are planned automatically and drafted ahead by agents |
| M4 Meetings | Google Calendar, Calendly, Fireflies; action items as tasks; recap drafts | Every held meeting produces a follow-up in Today within minutes of the transcript |
| M5 Enrichment and reporting | Provider waterfall with provenance, watchers, signal-driven priority, funnel and reply-rate reports | A new hiring or funding signal moves the right lead up the queue unprompted |
| M6 Open-source launch | Docker Compose template, docs, demo seed, security review, Microsoft Graph, Granola and Fathom | A stranger runs it locally in ten minutes and connects their own accounts |
