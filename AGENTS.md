# CRM development

This is an independent CRM repository. Use Bun to manage packages; shipped code runs on Node 22 or newer. TypeScript is strict. User-facing interface strings belong in packages/i18n/translations/en.json. Keep fictional fixtures separate from domain code. Never commit real contacts, credentials, transcripts, or uploaded files.

Every tenant-owned record has an organization ID. Product-owned children must also belong to the same product. Define every business HTTP operation in packages/operations/catalog.ts. HTTP adapters execute that registry and MCP registers its tools automatically; never add an HTTP-only business handler. Both transports call the same authorized domain services and full schemas. Transport protocols (auth, OAuth consent, callbacks, signed webhooks, cron, browser cookies, SSE) remain separate. Verified MCP read/write access must support the same business actions as the UI, preserving organization/product grants, current membership, account ownership, private histories and versions. Message dispatch is an explicit send_touch/send_action business operation, requiring verified crm:send for assistants, current approval, provider consent, owner/product authorization and durable idempotency. Unknown outcomes must never be automatically retried. Do not turn a due date, approval, or webhook into permission to send.

Run bun run typecheck, bun test via bun run test, bun run lint, and bun run build after substantial changes. Use meaningful tests for isolation, ingestion, approval invalidation, and file access. Local demo identities and PGlite must be disabled in production. New migrations must be generated and exercised locally; do not apply to a supplied external database without reviewing the target and backup policy.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
