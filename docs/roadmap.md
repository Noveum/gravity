# Delivery roadmap

## Foundation delivered

Independent local Git repository, pinned runtime/dependencies, reviewed SQL migrations, local persistence, multi-organization/product permissions, queue and context UI, contact creation and explicit product linking, private materials, reviewed commitments, normalized reply ingestion, and read-only OAuth MCP. A synthetic real HTTP OAuth test verifies consent and refresh binding across two simultaneous tenant flows. This does not establish live Google/GitHub or actual assistant interoperability.

The current app can be reviewed with fictional records. It cannot yet replace the company's live CRM or daily outreach tools. Existing Twenty/RepoCloud/domain/MCP infrastructure has not been changed by this implementation.

## Next slices, in order

| Slice | Deliverable | Acceptance |
|---|---|---|
| 1. Tenant onboarding | Real Google/GitHub login, invites, member/product permissions UI, profile and organization time zone | Two real users join only invited products; removal revokes HTTP and MCP access |
| 2. Useful records and queue | Company/person editing, reviewed CSV imports with mapping/deduplication, evidence editing, filters saved in URL, cursor pagination and bulk review | Import hundreds of rows with a preview; no silent merges; list/navigation stays fast under a realistic history |
| 3. Live assistant | Qualified Codex and Claude consent using deployed metadata, scopes, current grant/revocation UI, prompt-injection and client compatibility checks | Read permitted context and materials; attempts to cross org/product, read private mail or approve/send fail |
| 4. Gmail/LinkedIn inbox | Select one adapter per account, connection UX, encrypted mailbox credentials, durable ingress/jobs, bounded backfill, unmatched triage and disconnect/reconnect | Replies from both channels arrive once, stale approval is removed, sync freshness is visible and missing events can recover |
| 5. Outreach planning | Sequence editor, immutable versions, enrollment, initial/follow-up 1/2/3 actions, working-hour/time-zone scheduling, owner/product collision checks | A paused sequence remains paused through draft rework; date changes survive restart; no automatic send |
| 6. Controlled execution | Qualified sender adapter, suppression/bounces, explicit approved-send command, send leases, idempotency and ambiguous-timeout reconciliation | No duplicate send after crash/retry; new reply cancels stale dispatch; limits and opt-outs block sends |
| 7. Meetings and enablement | Calendar/Fireflies adapter, reviewed sourced promises, direct file upload, extraction/version/approval, persona/stage kits | Reimports do not duplicate promises; agents receive approved cited material for the right product/stage |
| 8. Public preview and hardening | Clean public repository, deployment templates, migration upgrade tests, observability, recovery docs, exports/deletion | New install works from docs and production data can be restored/exported |

The queue and connector slices deserve the most effort. A polished board cannot establish outreach reliability. Do not implement every sales feature before qualifying one complete live loop for the two-person team.

## Production gates

- Supplied managed PostgreSQL provider/region/pooling identified; reviewed migrations, isolated development/staging data and runtime database role.
- Automatic backups and retention configured; point-in-time recovery if required by the chosen recovery target; a real restore rehearsal. Record recovery point and recovery time targets. Export is useful but is not the backup system.
- RLS or equivalently reviewed least-privileged database access; tests covering tenant/product/private-source boundaries across queries, jobs, MCP and storage. Current composite FKs/application permissions are necessary but do not replace this review.
- Production HTTPS origin, auth secrets, Google/GitHub callbacks, invite rules, distributed abuse limits for auth/DCR/API, signing-key rotation, session/grant revocation and secret handling verified.
- Private object bucket and lifecycle, authenticated short-lived upload/download grants, upload finalization and cleanup, file validation/scanning and no public object keys. The current local route accepts 10 MB; Vercel functions have a 4.5 MB request/response payload limit. Use direct object storage transfer before enabling large uploads/downloads there. [Vercel function limits](https://vercel.com/docs/functions/limitations)
- Durable webhook receipts, worker retries and dead letters, unmatched classification, historical-event handling, connector gap reconciliation and visible sync health.
- Actual Codex/Claude OAuth consent tested from the deployed URL. Synthetic tests do not substitute for client compatibility checks.
- Mail scopes/verification qualified, supported LinkedIn account connection and restrictions qualified, credentials encrypted, disconnect revocation tested.
- Tenant-scoped structured logs and alerting without bodies/tokens; basic operational dashboard for sync lag, failed jobs, queue age and backup status.
- Bounded list queries and indexes, realistic volume/latency checks, keyboard/responsive/accessibility review and reconnect/conflict recovery.
- No sending until opt-outs, sender quotas, collision checks, fresh approval and ambiguous-send recovery pass.

## Open-source release

Apache-2.0 matches Orbit's permissive direction. The source is newly written, with fictional fixtures only; the installed dependency license inventory is recorded with explicit platform coverage. Review secrets and business data before pushing a new GitHub repository. Keep brand/trademark assets and source licensing distinct. Publish a Preview with an honest capability matrix; do not label unconnected providers as working integrations.

Keep PostgreSQL, object storage, connector and execution interfaces portable. Built-in AI should be optional: the core queue and external MCP clients work without an app-owned model subscription. Select any paid provider after pricing/account qualification; do not promise a fixed hosting price until the supplied database and existing Vercel account are known.
