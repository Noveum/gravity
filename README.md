# Gravity · CRM by Noveum

An open-source CRM foundation for teams managing relationships and outreach across several products and organizations. **Gravity by Noveum** is the selected product name. The local checkout remains `noveum-crm`.

The daily action queue is the center of the app. A person can have separate buyer or partner relationships for different products, with separate owners, context, outreach, and opportunities. Conversation history and evidence explain the next step.

**Status: working local foundation, not a production sales system.** Changes persist in a real local PostgreSQL engine. Live Gmail/LinkedIn connection, sending, invitations, imports, execution workers, and deployment remain unfinished. No live mail or private outreach data is included.

## Run locally

Requirements: Node.js 22.12+ and Bun 1.3.14.

```sh
bun install --frozen-lockfile
bun run dev
```

Open <http://127.0.0.1:3014>. No cloud database, paid provider, or credentials are needed for the fictional demo. The first run migrates and seeds PGlite at `.data/postgres`; uploaded demo files live at `.data/files`. Both are ignored by Git.

Stop the dev server before running `bun run db:migrate` against local PGlite. It supports one application process; it is not the production database. `bun run db:seed` is a local-only seed command. Production and any configured `DATABASE_URL` disable demo identities. Do not put real data in this development demo.

## What works

- Organization switching and creation; several products per organization, product creation, and product membership enforcement.
- People/company views and explicit product relationships. Create a person and optional research task; link an existing readable person to another product without copying or overwriting identity. Duplicate email creation is rejected for review.
- Next actions filtered by product, owner, type, and search; separate saved views for replies, commitments, and waiting on others.
- Conversation/evidence inspector with partial-history disclosure and private conversation permissions.
- Persistent draft editing, human approval bound to draft content/recipient/channel/product, stale-write checks, and approval invalidation. Completing an action never claims a message was sent.
- Separate sequence/enrollment views and qualified-opportunity board. Sequence execution and deal editing are not implemented.
- Reviewed meeting commitments with owner and due date, created once. Imported meeting notes are not connected yet.
- Private PDF, Markdown, and text materials, nested folders per product, associations with one or several product stages, authenticated download, and content hashes. Files start as drafts; approval/version replacement and PDF extraction are pending.
- Tested Unipile v2 event normalization and signed webhook entry point. Incoming replies pause enrollments and invalidate approved drafts; several replies in one conversation keep one pending reply task; retries do not duplicate messages. Unknown threads remain in the database for later classification.
- Read-only MCP using OAuth authorization-code flow with PKCE, resource-bound JWTs, organization/product selection, client consent, refresh, and revocable immutable grants. The OAuth flow is exercised against real local HTTP and SQL in tests. Real Codex/Claude and social-provider connections still require configuration and live verification.
- Orbit’s blue light/dark palettes, system preference, compact row density, a searchable command menu and safe keyboard navigation.
- Explicit next-action scheduling with product-authorized owners, channels, owed-by party and UTC deadlines.
- Authenticated SSE revision delivery with immediate same-runtime wakeups, one-second reconciliation across runtimes and fallback recovery. Unsaved drafts keep their edited version across live updates; distributed fan-out and large-list pagination remain future work.

## Try the app

Choose **Northstar Collective** to see three fictional products, or **Lunar Studio** to see a separate organization. Add a fictional person under People and attach a second product relationship using Existing person. In Next actions, select Mira's blocked follow-up, inspect her reply, and rework the draft. In Sales materials, choose a product, create a nested folder, upload a small PDF/text file, and filter by a relevant stage. In Meetings, review a proposed commitment before assigning its deadline.

Dates display in the organization's time zone. The commitment input explicitly uses the device's time zone and stores an absolute UTC instant.

## Stack and structure

Next.js App Router, React, strict TypeScript, Drizzle/PostgreSQL, Better Auth with its MCP/CIMD plugins, official MCP server package, Zod, and S3-compatible private storage. Bun manages the pinned dependencies; deployment uses Node. There is one deployable application and small internal packages, avoiding unnecessary infrastructure for a two-person team.

```text
src/app/                 App shell, HTTP routes, authentication pages, /mcp
src/components/          Queue, inspector, records, materials, contact creation
packages/core/           Authorized domain services and common permissions
packages/database/       Drizzle schema, PostgreSQL/PGlite adapters, fictional seed
packages/auth/           Social sign-in, OAuth flow binding, resource configuration
packages/connectors/     Signed event normalization and idempotent reply ingestion
packages/mcp/            Read-only tools over the same domain services
packages/storage/        Private file access and content validation
packages/i18n/           Interface strings
Drizzle migrations:      drizzle/
Tests:                   tests/
```

The interface takes inspiration from [Noveum Orbit](https://github.com/Noveum/orbit); this foundation contains newly written application code rather than a copied task-manager application.

## Verification

```sh
bun run typecheck
bun run test
bun run lint
bun run build
```

Tests exercise actual PostgreSQL migrations and constraints using PGlite, plus OAuth registration, PKCE, consent, token refresh, MCP HTTP transport, tenant isolation, private histories, concurrent duplicate replies, coalesced reply tasks, invalidated approvals, file access, and identity creation/linking. Build success verifies packaging; it does not verify a supplied cloud database, live OAuth app, S3 bucket, or sending account.

## Configuration and deployment

Start from `.env.example`; use a secret manager for real credentials. [Setup and OAuth MCP](docs/setup-and-mcp.md) describes the required variables and callbacks. [Architecture](docs/architecture.md) records tenant boundaries and storage decisions. [Connector design](docs/connectors.md) distinguishes implemented event handling from live synchronization. [Consolidated requirements and keyboard map](docs/requirements.md) covers every requested feature and its status. [Delivery roadmap](docs/roadmap.md) records production gates and the next implementation slices. [Naming research](docs/naming.md) records the selected brand and naming history. [Verification record](docs/verification.md) records the tests and browser checks actually performed.

Target deployment: Vercel with managed PostgreSQL and private object storage, without Kubernetes. Do not deploy this foundation for real sales work before the production gates are complete. In particular, the local 10 MB upload route must be replaced with authenticated direct-to-storage uploads to accommodate Vercel request limits.

This checkout has no GitHub remote or deployment. The code is prepared under Apache-2.0; publication and remote repository creation remain separate release steps.
