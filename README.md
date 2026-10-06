<picture>
  <source media="(prefers-color-scheme: dark)" srcset="public/brand/gravity-wordmark-dark.svg">
  <img src="public/brand/gravity-wordmark.svg" alt="Gravity · CRM by Noveum" width="300">
</picture>

# Gravity · CRM by Noveum

An open-source CRM foundation for teams managing relationships and outreach across several products and organizations. **Gravity by Noveum** is the selected product name. The local checkout remains `noveum-crm`.

The daily action queue is the center of the app. A person can have separate buyer or partner relationships for different products, with separate owners, context, outreach, and opportunities. Conversation history and evidence explain the next step.

**Status: working CRM foundation with account connections and managed PostgreSQL deployment support.** The local demo persists in a local PostgreSQL engine. Supabase deployment uses restricted runtime credentials, verified TLS and server-only table policies. Gmail/primary Calendar, Fireflies and Unipile V1/V2 LinkedIn adapters provide owner-scoped imports and explicit context review. Each user can bring their own encrypted Unipile setup through Connections; no instance-wide Unipile credentials are shared. Each installation still needs provider consent and live qualification. Explicit approved Gmail/LinkedIn sending is implemented with durable idempotency and unknown-outcome handling; live sender qualification remains outstanding. Organization settings supports invitation links, role/product access management and member removal; invitation acceptance requires the recipient’s verified email. Source code and fixtures contain no real mail or private outreach data. [Integration qualification](docs/integration-review-2026-10-05.md) records what was actually tested.

## Use the hosted app

Open [gravity.noveum.ai](https://gravity.noveum.ai), choose **Sign in**, and sign in with Google, GitHub or an email code. Create an organization and its first product, then add contacts and next actions. Connect your own Gmail, Calendar, Unipile and Fireflies accounts from Connections. No local installation or database credentials are needed.

The remote OAuth MCP endpoint is `https://gravity.noveum.ai/mcp`. Assistant access includes every current business API: records, deals, follow-ups, sequence/outreach management, account-owner connections/imports and documents. HTTP and MCP use a shared operation registry so future business APIs automatically gain tools. Access is scoped to the organization and products you authorize; reconnect existing clients for full read/write/send consent. MCP includes agent instructions, workflow prompts and a live permission audit. [Complete tool map](docs/setup-and-mcp.md#complete-business-api-access).

## Deploy your own instance on Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FNoveum%2Fgravity&project-name=gravity&repository-name=gravity&env=APP_URL%2CDATABASE_URL%2CBETTER_AUTH_SECRET%2CRESEND_API_KEY%2CEMAIL_FROM%2CINTEGRATION_ENCRYPTION_KEY%2CCRON_SECRET%2CCRM_DEMO_MODE%2CDATABASE_SSL_MODE%2CPUBLIC_SITE_INDEXING&envDefaults=%7B%22CRM_DEMO_MODE%22%3A%22false%22%2C%22DATABASE_SSL_MODE%22%3A%22verify-full%22%2C%22PUBLIC_SITE_INDEXING%22%3A%22false%22%7D&envLink=https%3A%2F%2Fgithub.com%2FNoveum%2Fgravity%2Fblob%2Fmain%2Fdocs%2Fvercel.md%23environment)

The button creates **your own repository and Vercel project**. Bring your own PostgreSQL database, secrets and verified Resend sender for email-code login. It does not reuse Noveum's database or provider credentials, apply database migrations, or configure your domain automatically. [Vercel setup](docs/vercel.md) covers restricted database roles, environment values, Google/GitHub callbacks and release checks. For social-only login, import your fork and set those provider credentials instead of Resend.

The default `vercel.json` uses manual provider sync and has no plan-dependent cron. For automatic five-minute sync on a compatible Vercel plan, copy `vercel.scheduled.json` over `vercel.json` in your deployment source before deploying; alternatively use your own authenticated scheduler. Automatic Git deployments remain disabled until you configure a reviewed CI deployment gate.

## Develop locally or self-host

Requirements: Node.js 22.12+ and Bun 1.3.14.

```sh
bun install --frozen-lockfile
bun run dev
```

Open <http://127.0.0.1:3014>. No cloud database, paid provider, or credentials are needed for the fictional demo. The first run migrates and seeds PGlite at `.data/postgres`; uploaded demo files live at `.data/files`. Both are ignored by Git.

Stop the dev server before running `bun run db:migrate` against local PGlite. It supports one application process; it is not the production database. `bun run db:seed` is a local-only seed command. Production and any configured `DATABASE_URL` disable demo identities. Do not put real data in this development demo.

## What works

- Guided workspace onboarding with a first product, organization time zone and atomic defaults; organization switching, several products per organization, product creation and product membership enforcement.
- People/company views and explicit product relationships. Create a person and optional research task; link an existing readable person to another product without copying or overwriting identity. Duplicate email creation is rejected for review.
- Next actions filtered by product, owner, type, and search; separate saved views for replies, commitments, and waiting on others.
- Conversation/evidence inspector with partial-history disclosure and private conversation permissions.
- Persistent draft editing, user or authorized assistant approval bound to draft content/recipient/channel/product, stale-write checks, and approval invalidation. Completing an action never claims a message was sent.
- Separate sequence/enrollment views and editable deals across multiple sales pipelines per product. Deals record amount/currency, owner, probability, expected close date, outcome, loss reason, and context; edits reject stale versions. Sequence execution remains unfinished.
- Clickable Overview reports for follow-ups, synced message activity, team workloads, pipeline value, weighted value, average deal size, won/lost outcomes and missing deal data. Filter by product, teammate, channel and 7/30/90-day range; open the records behind each metric. Currency totals remain separate. [Analytics definitions](docs/analytics.md).
- Reviewed meeting commitments with owner and due date, created once. Calendar/Fireflies notes enter a private import queue and require an explicit relationship selection before entering shared product context.
- Private PDF, Markdown, and text materials, nested folders per product, associations with one or several product stages, authenticated download, and content hashes. Files start as drafts; approval/version replacement and PDF extraction are pending.
- Tested Unipile v2 event normalization and signed webhook entry point. Incoming replies pause enrollments and invalidate approved drafts; several replies in one conversation keep one pending reply task; retries do not duplicate messages. Unknown threads enter an owner-private review queue with title/participant search, source filters and cursor pagination.
- CRM read/write MCP using OAuth authorization-code flow with PKCE, resource-bound JWTs, organization/product selection, client consent, refresh, and revocable immutable grants. The OAuth flow is exercised against real local HTTP and SQL in tests. The deployed Codex connection has been exercised; Claude Code and each new installation still require live qualification.
- Orbit’s blue light/dark palettes, system preference, compact row density, a searchable command menu, complete shortcut guide and keyboard navigation across record views.
- Explicit next-action scheduling with product-authorized owners, channels, owed-by party and UTC deadlines.
- Authenticated SSE revision delivery with immediate same-runtime wakeups, one-second reconciliation across runtimes and fallback recovery. Unsaved drafts keep their edited version across live updates; distributed fan-out and large-list pagination remain future work.

## Public pages

Open `/` for the public landing page (`/welcome` permanently redirects there), `/docs` for setup/assistant/deployment guides and `/blog` for two original design articles. These pages work without auth or a database and reuse Orbit's light/dark palette. The CRM workspace is at `/actions`; opening it prompts signed-out users to sign in. Marketing distinguishes working foundations from planned integrations and has no invented customer claims. [Positioning research](docs/positioning-2026-10-04.md) records the competitor review. Set `PUBLIC_SITE_URL` and opt into `PUBLIC_SITE_INDEXING` only for a reviewed production launch; preview and development hosts remain non-indexable.

After deploying, run `bun run test:deployment https://your-gravity-domain.example`
to check the actual uploaded public routes, authentication page, readiness,
branding assets, favicon, app icons and OAuth MCP challenge. Deployment exclusions for root docs
are anchored so they do not remove the application's `/docs` routes.

## Explore the development demo

Open `/onboarding` to create a fictional workspace with its first product. The new queue offers contact creation and connection setup guidance. Users signing in without an organization are directed there automatically. Connections shows the canonical MCP URL, provider availability, account connection forms, sync health and a private import review queue.

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
packages/operations/     Shared business API definitions, validation and execution
packages/mcp/            Automatic read/write tools over the shared registry
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
bun run test:public
bun run licenses:check
```

React interaction tests cover command selection, focus restoration, form submission guards, native validation, instant product switching and delayed-read reconciliation. The official MCP client additionally exercises OAuth auto-discovery, dynamic registration, PKCE, protocol initialization, tool calls and revocation. [Client qualification](docs/mcp-client-qualification.md) separates this protocol evidence from live Codex/Claude verification. Built public-page smoke checks run with demo/auth/database access disabled. License checks cover installed locked packages on the CI platform. The SQL/HTTP tests exercise actual PostgreSQL migrations and constraints using PGlite, plus OAuth registration, PKCE, consent, token refresh, MCP HTTP transport, tenant isolation, private histories, concurrent duplicate replies, coalesced reply tasks, invalidated approvals, file access, and identity creation/linking. Build success verifies packaging; it does not verify a supplied cloud database, live OAuth app, S3 bucket, or sending account.

## Configuration and deployment

Start from `.env.example`; use a secret manager for real credentials. [Setup and OAuth MCP](docs/setup-and-mcp.md) describes the required variables and callbacks. [Architecture](docs/architecture.md) records tenant boundaries and storage decisions. [Connector design](docs/connectors.md) distinguishes implemented event handling from live synchronization. [Consolidated requirements and keyboard map](docs/requirements.md) covers every requested feature and its status. [Delivery roadmap](docs/roadmap.md) records production gates and the next implementation slices. [Naming research](docs/naming.md) records the selected brand and naming history. [Full-flow review](docs/flow-review-2026-10-04.md) covers onboarding, integration status and screenshots. [Verification record](docs/verification.md) records the tests and browser checks actually performed.

The hosted deployment uses Vercel and managed PostgreSQL. For self-hosting, qualify authentication, tenant permissions, provider connections and backups on your own installation. Private cloud uploads need direct-to-storage transfer: the local 10 MB upload route must be replaced with authenticated direct-to-storage uploads to accommodate Vercel request limits.

Source repository: [Noveum/gravity](https://github.com/Noveum/gravity). Licensed under Apache-2.0. This is a deployable application source package, not an npm SDK; `private: true` prevents accidental registry publication. [Contributing](CONTRIBUTING.md), [security reporting](SECURITY.md), [release review](docs/release-review.md), [dependency inventory](docs/dependency-licenses.json) and [CI/deployment](docs/ci-and-deployment.md) describe the release process. [Supabase setup](docs/supabase.md) covers migrations, runtime permissions, recovery and the deployed health check. Each provider account requires its own authorization and a successful sync; Explicit approved-send tools require crm:send and provider authorization. [Permission and execution audit](docs/mcp-permissions-2026-10-06.md).
