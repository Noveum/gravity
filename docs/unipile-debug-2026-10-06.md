# Unipile compatibility investigation

The reported setup failure combined two independent problems: the account was on Unipile V1, while Gravity sent every key to `https://api.unipile.com/v2`; the shared provider client translated HTTP 400/401 into `RECONNECT_REQUIRED`, including during key verification before any LinkedIn account existed in Gravity.

The V1 dashboard shows a DSN and access tokens. V2 uses `dashboardv2.unipile.com`, a fixed API origin, application/scoped keys, different account IDs, different authentication requests and HMAC webhooks. Adding a DSN field without changing API routing, response validation, pagination and webhook handling would still fail. [V1 API usage](https://developer.unipile.com/docs/api-usage), [V2 API usage](https://developer.unipile.com/v2.0/reference/api-usage), [webhook migration](https://developer.unipile.com/v2.0/docs/migration-webhooks).

The existing Unipile LinkedIn MCP connection successfully listed two accounts with `OK` messaging sources and retrieved a chat page. This establishes that those provider sessions were usable at investigation time. It does not prove that the particular masked token entered in Gravity was valid; that token was not retrieved or copied. The official Unipile documentation MCP uses an explicit branch selector for V1/V2, and does not replace the credentials and account binding required by the CRM adapter. [Official MCP documentation](https://developer.unipile.com/v2.0/docs/mcp).

The official documentation MCP was queried directly with `branch=v1.0`. Its `get-endpoint` result for `GET /api/v1/accounts` confirms a DSN server with subdomain/port variables, `X-API-KEY` header authentication, and `items`/`cursor` pagination. The public OpenAPI document from the dashboard's DSN also confirmed the chat, message, recipient and webhook contracts used by the repair.

The repair preserves V2 setup and adds V1 DSN validation, versioned encrypted credentials, verified existing-account selection, bounded history, numeric/null message normalization, custom-header webhooks, and V1 sending/receipt endpoints. Invalid API keys now produce an explicit Unipile setup error rather than a LinkedIn reauthentication instruction. Existing V2 credentials without a version continue to mean V2. No schema migration, subscription purchase or provider-account migration is needed.

Production inspection confirmed three successive scheduler executions five minutes apart. Each synchronized the three existing Gmail, Calendar and Fireflies accounts, with zero failures and zero pending webhook receipts processed. Their latest observed successful sync was shortly after 12:05 PM Asia/Kolkata on October 6. Gmail and Calendar reported no additional history page; Fireflies reported more history available. The current Gmail connection did not have send consent. No real messages were sent during investigation.

| Provider | Verified behavior | Remaining qualification |
| --- | --- | --- |
| Gmail | Connected, successful five-minute polling, no sync error, current cursor caught up | Sending needs separate Gmail send consent; attachments and Pub/Sub push are not implemented |
| Calendar | Connected, successful five-minute polling, no sync error, current cursor caught up | Primary calendar only; no event creation or secondary-calendar sync |
| Fireflies | Connected, successful five-minute polling, history pagination continuing | Live signed-webhook delivery and completeness of the full archive are not established |
| LinkedIn | Provider MCP reads succeed; Gravity production has no saved Unipile setup | Deploy the repair, enter the owner's V1 credentials, select the owner's account, then qualify a live history page and webhook delivery |

Scheduler ticks are not a guarantee of full-history freshness. The worker chooses at most four accounts, oldest-sync first, processes two at a time, and reads one bounded page per account. Receipt processing is bounded to four per tick with retries. Fireflies reads twenty transcripts per page and starts another scan after finishing the archive. LinkedIn backfills can take many ticks; webhooks avoid waiting for a complete historical scan to discover current messages. Owner review still determines the person and product for imported context.
