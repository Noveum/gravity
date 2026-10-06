# Gravity documentation

Start with the guide that matches what you are doing. The hosted versions of the
user guides are at [gravity.noveum.ai/docs](https://gravity.noveum.ai/docs).

## Using Gravity

| Guide | What it covers |
| --- | --- |
| [Setup and OAuth MCP](setup-and-mcp.md) | Environment variables, sign-in providers, connecting Codex, Claude Code or another MCP client, and the complete tool map |
| [Account connections](connectors.md) | Gmail, Calendar, Unipile LinkedIn and Fireflies: what each imports and how review works |
| [Multiple accounts and privacy](accounts-and-privacy.md) | Who can see which imported conversations, and how sharing works |
| [Overview and deals](analytics.md) | How every Overview metric is defined |
| [File library](file-library.md) | Product-scoped folders, previews and direct-to-storage uploads |
| [Contact import attribution](contact-attribution.md) | Submitter, declared source, creator, provider history and contributor filters |
| [Record browsing](record-browsing.md) | Tags, deal sizes, filters, paging and inspectors in the record lists |
| [Relationship context and signals](relationship-context.md) | Structured context per product relationship, and editing it over MCP |
| [Requirements and keyboard map](requirements.md) | Every feature, its status, and the full shortcut list |

## Running your own instance

| Guide | What it covers |
| --- | --- |
| [Deploy on Vercel](vercel.md) | One-click clone, environment values, callbacks and scheduled sync |
| [Supabase PostgreSQL](supabase.md) | Migrations, restricted runtime role, TLS and recovery |
| [CI and deployment](ci-and-deployment.md) | What CI checks and how preview deployments are gated |

## Working on the code

| Guide | What it covers |
| --- | --- |
| [Contributing](../CONTRIBUTING.md) | Local setup, the development loop, rules and pull requests |
| [Architecture and invariants](architecture.md) | Tenant boundaries, the operation registry, storage and auth decisions |
| [Agent access and outbound execution](mcp-permissions-2026-10-06.md) | MCP scopes, send permission and durable idempotency |
| [MCP client qualification](mcp-client-qualification.md) | What protocol tests prove and what needs live client checks |
| [Roadmap](roadmap.md) | Next slices and production gates |
| [Brand](brand.md) and [naming](naming.md) | Identity assets and how the name was chosen |

## Review records

Dated records of what was built, tested and qualified at each step. They describe
the state at that date; newer records and the roadmap supersede them.

- [Foundation release review, 3 October 2026](release-review.md) and [verification](verification.md)
- [Full-flow review, 4 October 2026](flow-review-2026-10-04.md)
- [CRM usability and field review, 6 October 2026](crm-usability-review.md)
- [Public site and MCP qualification, 4 October 2026](public-site-review-2026-10-04.md)
- [Positioning research, 4 October 2026](positioning-2026-10-04.md)
- [Provider connections, 5 October 2026](integration-review-2026-10-05.md)
- [Personal Unipile settings, 5 October 2026](provider-settings-review-2026-10-05.md)
- [MCP business API parity, 6 October 2026](mcp-api-parity-2026-10-06.md)
- [Unipile compatibility investigation, 6 October 2026](unipile-debug-2026-10-06.md) and [review](unipile-pr-review-2026-10-06.md)
