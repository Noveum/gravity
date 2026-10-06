# PR 24 review

Reviewed the V1 repair against the official documentation MCP, the DSN's public OpenAPI, existing tenant/product authorization, and live tests with an owner-supplied temporary key.

## Findings resolved

| Priority | Finding and resulting correction | Source |
| --- | --- | --- |
| P1 | V1 setup depended on manually copied webhook credentials. The UI now selects an existing account and registers two account-scoped hooks using the saved API key and a server-generated token. | `packages/connectors/configuration.ts:269`, `packages/connectors/unipile-webhooks.ts:17` |
| P1 | Retrying webhook creation after a lost response could duplicate registrations. A setup lease serializes changes; retries reconcile matching provider hooks before creating another. Removal discovers partial registrations and deletes only managed hooks. | `packages/connectors/unipile-webhooks.ts:17`, `packages/connectors/unipile-webhooks.ts:105` |
| P2 | Permission and reconnection status notifications did not restore/report the correct state. `PERMISSIONS` now reports a permission error and `RECONNECTED` restores the connection. | `packages/connectors/unipile-v1.ts:94` |
| P2 | A failed chat ownership check before message submission could become an unreconcilable unknown send. Preflight errors are now definite failures; ambiguity after submission remains protected from retries. | `packages/connectors/outbound-provider.ts:230`, `packages/connectors/outbound.ts:647` |
| P2 | External account listing could exceed a product-restricted assistant grant. Listing and webhook management require all-products MCP access; bound connection operations recheck owner and product authorization. | `packages/connectors/configuration.ts:232`, `packages/connectors/configuration.ts:269` |
| P2 | After a webhook setup failure, editable account/product fields could disagree with the account already connected. Those fields and account reload controls now stay locked during webhook retry, which continues on the saved connection and product. | `src/components/integration-cards.tsx:816` |

## Review dimensions

| Dimension | Assessment |
| --- | --- |
| Security | No unresolved blocking finding identified in the reviewed scope. DSN host validation, encrypted owner credentials, account binding, constant-time webhook verification and explicit send authorization are preserved. |
| Correctness | Live V1 reads and provider webhook registration/retry/cleanup contracts passed. Regression tests cover status transitions, uncertain creation, rejected send preflights, registration concurrency and UI retry behavior. |
| Performance | History, webhook discovery and cleanup are bounded. Registration performs provider requests outside database locks and serializes conflicting setup changes with an expiring lease. |
| Maintainability | UI and MCP use the shared operation registry and domain authorization. Provider webhook contracts are contained in one helper; API keys and webhook tokens are not returned. |

The existing owner/product isolation and unknown-send safeguards were sound and remain covered by regression tests. There is no database migration or provider-account migration.

The pre-merge review integrated current main, preserving its relationship-context and organization-settings changes, and removed obsolete manual-webhook UI copy. The focused setup, registration, ingress and V1 adapter tests passed: four files, 27 tests. The pull request's verification section records the final combined full-suite, type checking, lint, build and CI results separately.

## Live qualification limits

The actual history adapter normalized 35 messages from the owner's first page. Both provider accounts reported healthy messaging sources. Two disabled test hooks were scoped to the owner, reused on retry, and deleted afterward. Temporary credential files and scripts were removed. No messages were sent and no customer data was written to Gravity.

The repair remains undeployed. Enabled webhook delivery to the production V1 receiver, full historical completeness, and live approved sending remain unqualified. The temporary test key can be revoked; normal setup should use a persistent owner-managed key.
