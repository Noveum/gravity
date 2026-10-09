# MCP agent experience and connection reliability review

Reviewed on 2026-10-09. This review combines current primary documentation with a source audit of Gravity. It distinguishes local implementation from production behavior: no hosted CRM records, credentials or transcripts were collected, and no production enrollment, approval, send or database migration was performed. A hosted identity/capability read succeeded through the connected Codex integration during this review. The reported intermittent disconnections have not been reproduced.

## Findings and priorities

Gravity already has server instructions, an agent-guide resource, four workflow prompts, authorization checks and a shared HTTP/MCP operation registry. The main usability gap is that agents receive a large inventory before receiving a useful explanation of how the tools work together.

The following historical baseline measurements describe the source **before this change and subsequent main-branch updates**, using a read-only Bun import of `operations`, `operationInput` and the English translations. They are character counts, not model token estimates or production latency measurements.

| Baseline measurement | Result | Source |
| --- | --- | --- |
| Business operations in the shared registry | 125 | `packages/operations/catalog.ts`, `operations` |
| Top-level fields exposed by those operations' MCP input schemas | 480 | `operationInput` removes the organization field from 598 full domain-schema fields |
| Exposed top-level fields with a description | 0 | Zod field `description` metadata |
| Global instructions | 6,235 characters | `packages/i18n/translations/en.json`, `mcpInstructions` |
| One serialized full operation catalog | 63,979 characters | Names, HTTP mapping, availability, requirements and descriptions; measured with `available: true` |
| Startup catalog duplication | Two full catalogs, about 128,000 characters before wrappers | Instructions request both `get_permission_audit` and `get_capabilities`; both return the catalog |

At the initial review, the connected Codex integration exposed 128 Gravity tools and prepended the previous server instructions to each tool description: the descriptions totaled 855,856 characters (about 856 KB), excluding schemas. This is a historical host-exposed catalog measurement; it does not prove every description is loaded into model context at once. That hosted inventory had 125 business operations and lacked the new guide; these counts do not describe the current local registry after subsequent main-branch updates.

The first 512 characters of the previous instructions describe startup calls and compact reads. Version checks, explicit-send rules and recovery guidance appear later. `gravity://agent-guide` repeats the same long instructions, and each workflow prompt prepends them again. This is an inefficient route to an answer such as “set up a sequence.”

| Priority | Improvement | Status in this change | Why it matters |
| --- | --- | --- | --- |
| P1 | Short startup instructions; a discoverable `get_agent_guide` tool with focused workflow topics and equivalent resources | Implemented in source | Works through ordinary tool discovery even when a client does not expose prompts or automatically load resources |
| P1 | Compact capability discovery with explicit access to full catalog details | Implemented in source | Avoids repeatedly loading the full inventory of descriptions and HTTP mappings at startup |
| P1 | Describe sequence parameters and improve sequence tool metadata | Implemented in source | Explains delay semantics, relationship IDs, draft personalization, versions and the preview/enroll/review boundary |
| P1 | Honor selected product when advancing sequence plans | Implemented with isolation regression | A product-scoped request previously advanced other permitted products as well |
| P1 | Preserve OAuth challenges when current-state authentication checks fail | Implemented in source | Helps a client distinguish expired or invalid authorization from a generic connection failure |
| P1 | Validate a supplied HTTP Origin while allowing its absence for native clients | Implemented in source | Uses the existing origin policy without requiring browser-only headers |
| P1 | Qualify the actual Codex connection across token refresh, idle time and deployment | Planned live qualification | Source fixes do not establish the cause of a reported disconnect |
| P2 | Define a deliberate session and assistant authorization lifetime policy | Unresolved product/security decision | The browser session can expire before the OAuth refresh token |
| P2 | Add output schemas, actionable recovery errors and bounded helper reads | Future work | Reduces guessing, opaque failures and oversized results |

The implemented `get_agent_guide` defaults to `getting-started`. Topics are `getting-started`, `sequences`, `sending`, `connections`, `records`, `imports`, `files` and `troubleshooting`; matching resources use `gravity://guides/{topic}`. It returns ordered steps, scope/role availability, a permission caveat and a typed structured result. `get_capabilities(compact: true)` omits the catalog but retains feature and operation-count summaries. Omitting `compact` preserves the full response for compatibility. The full reference remains available at `gravity://agent-guide`.

## Design guidance from current primary sources

OpenAI recommends placing the critical cross-tool instructions within the first 512 characters, describing when each focused tool is useful, and treating schemas and accurate annotations as product behavior. This supports a short startup route plus detailed, task-specific guidance. Its documentation also recommends validating discovery and authorization locally and again after deployment. [OpenAI MCP server guide](https://developers.openai.com/plugins/build/mcp-server).

MCP's maintainers explain that hosts differ in how they inject server instructions, and prompts require selection by the user. Instructions should explain workflows, while deterministic service checks enforce critical security requirements. Therefore the guide should be available as a normal read-only tool, and individual tools must retain enough metadata to be usable independently. [MCP server instructions guidance](https://blog.modelcontextprotocol.io/posts/2025-11-03-using-server-instructions/).

Anthropic recommends targeted, meaningful outputs; pagination or filtering for large responses; actionable error messages; and task-based evaluations that measure whether agents finish real workflows. This motivates measuring startup payloads and evaluating sequence setup with fresh agents, alongside protocol and domain tests. [Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents).

MCP supports `outputSchema` and `structuredContent`, with serialized text retained for older consumers. Tool execution failures should provide feedback the model can act on. Gravity's result wrapper now includes structured object results while retaining text; the new guide also declares its output schema. Most business tools still lack declared output schemas. Extending those contracts should be a deliberate registry-level improvement. [MCP tools specification](https://modelcontextprotocol.io/specification/2026-07-28/server/tools).

## Sequence workflow that agents need to understand

The guide and metadata should teach this concrete path:

1. Read identity and products. Select an existing, authorized active product; find sequences and relationships with `list_records`, then read the chosen sequence and relevant person context.
2. Read contact rules. Define ordered steps with `create_sequence` or replace steps using `update_sequence` and the current sequence version.
3. Preview `enroll_in_sequence` with `dryRun: true`, using **relationship IDs**, not person IDs. Its `enrolled` entries are eligible candidates with null enrollment IDs. The preview does not establish sender readiness.
4. Enroll only the selected eligible relationships. Enrollment already plans an eligible initial touch. `advance_sequences` now honors optional `productId`; omitting it advances all authorized products. The previous implementation ignored that input. Isolation regressions cover selected-only advancement, unauthorized/foreign product denial and omitted-scope behavior. Planning never sends.
5. Read each touch and its history. Personalize and save the exact draft using `edit_touch_draft`, then review and approve its current version.
6. If sending was explicitly requested, select the current owner's connection, inspect `get_send_readiness`, and call `send_touch` with the current version and one durable idempotency key. Handle unknown outcomes through delivery inspection and reconciliation.

Important domain details were missing from parameter discovery:

- `delayDays` is measured from enrollment for the initial step, then from the preceding touch's send or closure time. The planner can move the resulting due time to satisfy cooldown and quiet hours. See `packages/core/outreach-planner.ts`, `planEnrollment`.
- `followUp` selects a queue group from 0 through 3. It is separate from the sequence step number and is not an automatic retry count. See `packages/core/outreach.ts`, `dueTouches`.
- Templates are copied into touch drafts verbatim by the planner. The outbound service dispatches the saved draft verbatim. UI merge previews do not imply server interpolation. Agents must resolve placeholders in the saved recipient-specific draft before approval. See `packages/core/outreach.ts`, `advance`; `packages/connectors/outbound.ts`, `send`; `src/components/outreach/merge-fields.ts`.
- Updating a sequence rewrites channel, template and `followUp` on matching **planned** touches and expires planned touches for removed steps. Drafted/approved content and existing due times are not rewritten, but removing steps can complete enrollments and expire remaining open touches, clearing their approvals. Replacing steps is a full-array operation, so preserve wanted steps and their numbers. See `packages/core/outreach.ts`, `updateSequence`.

The previous MCP sequence fixture used `{{firstName}}`, while the UI preview parser recognizes single-brace labels such as `{first name}`. Neither syntax is currently rendered by the outbound service. Future template rendering needs a shared domain implementation and approval-hash tests; silently rendering after approval would change the approved content.

## Connection reliability: verified facts and remaining uncertainty

Gravity explicitly configures a five-minute access-token lifetime in `packages/auth/options.ts`. Short access-token lifetimes are compatible with reliable MCP connections when the client receives and uses refresh tokens. Increasing this lifetime without diagnosing refresh behavior would conceal the symptom and increase exposure.

`principalForVerifiedToken` also verifies the OAuth client, current session, active grant and current membership. A cryptographically valid token is rejected if its originating user session has expired or disappeared. The installed Better Auth defaults give browser sessions seven days and OAuth refresh tokens thirty days. These are distinct lifetimes: successful token refresh cannot revive an expired session. Decide explicitly whether assistants should require periodic browser reauthorization or have a separately revocable authorization lifetime. Retain immediate revocation and current membership/product/account checks under either policy.

The previous route converted these current-state `UNAUTHORIZED` failures into plain HTTP 401 JSON without preserving the OAuth discovery challenge. The route now adds `WWW-Authenticate` with `invalid_token`, the protected-resource metadata URL and the challenge scopes. Invalid/revoked authorization must remain a failure; better recovery metadata does not extend access. MCP authorization guidance describes discovery through Bearer challenges and distinguishes invalid authorization from insufficient permissions. [MCP authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).

Other possible causes remain unproven: client refresh support, refresh-token issuance or rotation, session expiry, revoked grants, deployment/network interruptions, provider delays, and client transport compatibility. The source uses the SDK's stateless legacy compatibility mode and a request duration limit of 120 seconds. Neither observation alone proves a disconnect bug.

Codex 0.154.0, released on September 9, includes coordinated MCP token refresh and preservation of login challenges when refresh fails, without automatic replay of rejected calls. Record the actual app/client version during diagnosis; this release history makes older client behavior a useful hypothesis, not an established cause. [Codex 0.154.0 release](https://github.com/openai/codex/releases/tag/rust-v0.154.0), [authentication challenge implementation](https://github.com/openai/codex/pull/42552).

The MCP route also now validates a supplied Origin through Gravity's existing mutation-origin policy. Requests without an Origin remain supported for native clients. The repository's existing `docs/mcp-client-qualification.md` records successful local OAuth/DCR qualification but explicitly leaves live Codex Client ID Metadata Document, refresh and revocation qualification outstanding; do not confuse those paths.

The server's advertised application version and capabilities identify what an endpoint claims to run; they are not proof that the local commit is deployed. Record the published release/build identity separately, then inspect the real discovery response. Historical review documents already note that hosted tools can lag the repository and a merge does not necessarily deploy it.

## Protocol compatibility in October 2026

Do not apply older persistent-SSE advice to every MCP client. Revision `2026-07-28` uses per-request metadata and removes protocol sessions and the standalone GET stream. Older revisions through `2025-11-25` use initialization and can support sessions, GET streams and resumability. A 405 for GET can therefore be correct. [Current Streamable HTTP specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http), [2025-11-25 transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).

A dual-era implementation can serve modern requests statelessly and accept legacy initialization separately. Modern HTTP clients inspect recognized protocol errors before choosing a legacy fallback; indiscriminately falling back on every 400 is incorrect. Gravity already uses SDK legacy compatibility. Qualify both eras with supported clients before changing the transport or adding custom session state. [MCP versioning and compatibility](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning).

## Qualification matrix

Run behavioral scenarios with a fresh Codex chat and at least one other supported MCP host. Local automated tests must use fictional fixtures and mock providers. Hosted qualification should use reads and enrollment previews; writes and sends belong in an isolated test workspace with explicit authorization.

| Scenario | Required result | Environment |
| --- | --- | --- |
| Fresh connection, “How do I create a sequence?” | Finds the guide and explains product selection, step semantics, relationship preview and review/send separation | Local; hosted read-only |
| Create a two-step sequence and preview contacts | Uses authorized product and relationship IDs; interprets preview correctly; no dispatch | Fictional local fixtures |
| Update a stale sequence/touch | Reloads and reviews the current version before retrying; preserves intended steps | Fictional local fixtures |
| Template with missing fields | Explains that preview is not dispatch rendering; saves resolved content before approval | Fictional local fixtures |
| Read-only or product-restricted grant | Cannot write or widen scope; no private-history or cross-product disclosure | Fictional local isolation tests; hosted reads |
| Approved but due-later touch or unconsented sender | Reports readiness blockers; never treats approval/date as authorization | Mock provider fixtures |
| Send response interrupted or unknown | Inspects existing delivery; does not automatically resend or use a new key | Mock provider fixtures |
| Five-minute token rollover and later idle request | Refresh succeeds or a clear reauthorization path is offered; grant remains unchanged | Isolated authorization test; hosted read-only |
| Expired session, disabled client, revoked grant | Refuses access; invalid session/client returns the expected OAuth challenge | Local auth fixtures |
| Modern and legacy clients, server restart/deployment | Discovery and reads recover according to the supported protocol era | Local; hosted read-only |
| Large workspace | Startup avoids duplicate catalogs; discovery and browsing stay bounded | Synthetic local data |

Measure task success, invalid calls, calls required, output characters, recovery behavior and authorization violations. Instruction-presence assertions alone cannot show that agents use the workflow correctly.

## Diagnostic runbook

1. Record the incident time, client/app version, endpoint origin, last successful method/tool, HTTP status or JSON-RPC error, and whether the failure followed idle time, token rollover or a deployment. Do not collect message contents, authorization headers, cookies, tokens or provider secrets.
2. Inspect the deployed release identity and public health/discovery metadata. Compare advertised tools and guide metadata with the intended release. A stale deployment should not be diagnosed as model misunderstanding.
3. For 401, inspect the sanitized Bearer challenge and whether the client attempts refresh or reauthorization. Correlate server-side session/client/grant state using internal identifiers without exporting credentials. For 403, examine scopes, membership and product/account authorization rather than repeatedly reconnecting.
4. For protocol errors or 405, identify the negotiated era. Test one bounded discovery/read request using that era's required metadata. Avoid diagnosing a deliberately unsupported GET stream as a failed POST transport.
5. For timeout/5xx, inspect request duration, hosting limits, deployment events and bounded provider work. Retry a read when appropriate. For an interrupted send, inspect and reconcile the existing delivery; unknown outcomes never permit automatic resending.
6. Reproduce in a fictional local fixture, add a focused regression, and rerun `bun run typecheck`, `bun run test`, `bun run lint` and `bun run build`. Report live qualification separately from local checks. Do not mutate production records or apply migrations as part of connection diagnosis.

## Follow-up improvements

- Extend registry metadata with typed output schemas and compatible structured results, beginning with discovery, sequence previews, readiness and delivery outcomes.
- Provide shared safe recovery metadata for common domain errors: current version needed, exact invalid field/path, user action required, and whether the original outcome is unknown. Avoid generic retry advice on mutations or sends. `packages/core/http.ts` currently reduces many failures to short codes, and supplemental MCP helper tools do not share the registry callback's error wrapper.
- Bound `search_records`, which still loads a workspace snapshot and returns all permitted relationships alongside matching people/companies. `list_next_actions` now uses a paginated registry operation. Prefer paginated registry reads and targeted context fetches.
- Move merge-field rendering into a shared domain facility only with an explicit preview/save contract. Approval must cover the exact resolved content actually dispatched.
- Add sanitized transport metrics: request ID, method/tool, status, duration, protocol era and release identity. Keep tokens, drafts, private history and provider credentials out of logs.

All future business actions must remain defined in `packages/operations/catalog.ts`, with full schemas and the same authorized domain services used by HTTP and MCP. Guides, prompts and annotations explain existing boundaries; they never grant permission to send or bypass consent, ownership, versioning, idempotency or isolation.

## Local verification

Automated regressions cover MCP discovery and guide contracts, OAuth challenges and Origin checks, selected-product advancement, and approval invalidation when removing the final unfinished sequence step. Startup instructions decreased from 6,235 to 869 characters; a regression requires the compact capability response to be less than one tenth of the full response. The official MCP client exercises the actual application OAuth route and the typed guide result. Run the repository verification commands above for the current branch; the pull request records the final results after integrating the latest main branch.

This verifies protocol/domain behavior and metadata contracts, not an LLM task-success evaluation or long-idle hosted reconnect behavior. The connected hosted service answered identity and capability reads, but it does not yet expose the new guide. These changes are local and have not been deployed.
