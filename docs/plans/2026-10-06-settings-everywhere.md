# Settings everywhere plan

Branch `claude/settings-mcp`, based on main at 50b2943. The owner asked for every part of Gravity to be configurable, in the app and through MCP. The gap inventory is in `.superpowers/sdd/2026-10-04-design-outreach-settings/audit-config-gaps.md`.

## Ground rules

- Every new business capability is an operation in `packages/operations/catalog.ts`. MCP registers catalog operations automatically, so an operation added there is available in both the UI and MCP. Each operation declares its permission (admin, all-products grant, owner or product writer) and is added to the permission sets so `get_permission_audit` reports it.
- Follow AGENTS.md:
  - strict TypeScript;
  - user-facing strings in `packages/i18n/translations/en.json`;
  - composite tenant keys on every table;
  - RLS, runtime grants and API-role revocations in every migration that adds a table (copy the 0006 to 0010 pattern);
  - adapters call the shared domain services.
- No code comments. No em-dash characters. Stage files by explicit path. Commits carry no trailers and no AI attribution.
- Tests come first and must fail without the change. `bun run lint`, `bun run typecheck`, `bun run test`, `bun run build` and `bunx drizzle-kit check` must all stay green. Run the build in a cloned worktree (`cp -Rc`).
- Migrations are generated with `bun run db:generate` and exercised on a scratch PGlite copy. The controller applies them to the local preview and to production.
- Run the local preview at http://127.0.0.1:3016 in demo mode. Check it in the in-app browser only, never Chrome.

## Task 1: S1 Members, invitations and ownership (migration)

Add these operations:

- **`set_member_products`**: grant or remove a member's access to products. Requires admin plus an all-products grant.
- **`change_member_role`**: switch a member between admin and member. The last active admin cannot be demoted. Requires admin plus an all-products grant.
- **`deactivate_member`** and **`reactivate_member`**:
  - Deactivating sets `active=false`.
  - The member's open actions, relationships they own, and touches they send are reassigned in one transaction to a chosen active member, defaulting to the caller. The response reports the counts.
  - The member's sessions and MCP grants for that organization stop working.
  - The last active admin cannot be deactivated.
  - Requires admin plus an all-products grant.
- **`list_members`**: role, active state, products and counts of owned work. Readable by any member.
- **Invitations**, stored in a new `invitations` table with these columns:
  - organization;
  - email, lowercased;
  - role;
  - product ids;
  - a SHA-256 hash of a random token;
  - expiry, 7 days by default;
  - inviter;
  - `accepted_at`, `accepted_by` and `revoked_at`.

  The invitation operations:
  - **`create_invitation`**, **`resend_invitation`**, **`revoke_invitation`** and **`list_invitations`**. Requires admin plus an all-products grant.
  - **`accept_invitation`**: available to any signed-in user whose verified email matches the invitation, case-insensitively. Accepting creates the membership and product memberships in one transaction.
  - An expired, revoked or used invitation is refused, with a typed error for each case.
  - Invitations respect the deployment and workspace email-domain allowlists.
  - When Resend is configured (`packages/auth/email.ts`), the invitation email is sent. A copyable accept link is always returned to the admin. The token is never logged and never stored in plain text.

  Invitation pages:
  - `/invite/[token]` shows a signed-out user a sign-in prompt and brings them back to the invitation afterwards, reusing the `x-gravity-path` return.
  - A signed-in user sees the workspace name, then accepts or declines.
- **`change_relationship`** gains `ownerId` (product writer). The new owner must be an active member with access to the product. Reassigning the owner also moves that relationship's planned and drafted touches to the new sender, clears approval on drafted touches whose sender changed, and records change events.

Tests, one per rule: last-admin guard, reassignment counts, a grant stops working after deactivation, every invitation path, the allowlist, email match, ownership transfer.

## Task 2: S2 Workspace, products, pipelines and stages (migration)

Add these operations:

- **`update_workspace`**: change the name, time zone (IANA, validated) and slug (unique, URL safe). Requires admin plus an all-products grant. The organization creation form takes a time zone, defaulting to the browser's zone.
- **`update_product`**: rename and recolour.
  - Colour comes from a fixed palette of token keys. Add `products.color_key` and migrate the existing hex values to the nearest key.
  - Requires admin plus access to the product.
- **`archive_product`** and **`restore_product`** (new `products.archived_at`):
  - An archived product disappears from switchers, filters and new-record forms. Its data is kept.
  - Running enrollments in it are paused with reason `manual`.
  - The last active product cannot be archived.
- **Stage operations**, for deal and outreach pipelines:
  - `create_stage`, `update_stage` (name and category), `reorder_stages` and `archive_stage`.
  - Archiving a stage moves the relationships or deals in it to another stage in the same transaction.
  - Each pipeline must keep at least one open stage.
  - Requires admin plus access to the product.
- **`update_pipeline`**: rename a deal pipeline, if pipelines are named entities after #16. Otherwise skip.

Tests: one per rule, plus a check that the colour mapping is stable.

## Task 3: S3 Settings screens for everything

Settings gets one URL per section:

- `/settings/workspace`
- `/settings/brands`
- `/settings/pipelines`
- `/settings/members`, which includes invitations
- `/settings/outreach`: contact rules and the do-not-contact list
- `/settings/connections`
- `/settings/sending`: sending accounts and each connection's default product
- `/settings/assistants`
- `/settings/preferences`

Each section works like this:

- It calls the catalog operations.
- It hides what the role cannot do, and the server enforces the rule.
- It follows the design shell:
  - 28px rows;
  - colours from tokens only;
  - shared empty, loading and error states;
  - works at 375 wide and at 1440, in light and dark.

Two more additions:

- Add **`update_connection`** (owner only) to change a connection's default product without going through provider consent again.
- Admins see and can revoke teammates' assistant grants. Add `list_assistant_grants` and allow an admin to revoke a teammate's grant.

Tests: each section renders, its role gate works, and saving goes through the operation.

## Task 4: S4 Remaining in-app gaps

- **Sending in the app.** Approved touches and actions get Send and Reconcile controls that call the existing `send_touch`, `send_action` and `reconcile_delivery` operations. They show readiness from `get_send_readiness`, and send needs an explicit confirmation.
- **Sequences.** Add Create sequence and archive or restore (a new `archive_sequence` operation). Stop and pause an enrollment from the Sequences tab.
- **Materials.** Add `rename_material_folder` and `delete_material_folder` (empty folders only). Add a way to publish an uploaded file out of draft, through an operation if one does not exist.
- **Action presets.** Make them editable per workspace if the schema allows it cheaply. Otherwise record them as a follow-up.

Tests: one per control.

## Review

Each task gets an implementer, then a reviewer, then fix rounds. A whole-branch review runs at the end, followed by one PR and a merge. The controller applies the migrations to production after the merge, with the owner's standing approval from 2026-10-06.
