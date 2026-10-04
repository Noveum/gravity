# Design, outreach and settings plan

Branch `claude/design-outreach` (based on `codex/production-authentication` 212b867). Production runs at crm.noveum.ai on Supabase with Google and GitHub sign-in working.

The owner's asks for this round:
- fix the design, which has many problems (target: the larger build's header, shell and density at ~/Projects/Noveum/gravity);
- add an Outreach section, which is missing;
- add the missing settings;
- make every keyboard shortcut work;
- keep light and dark both first class (today a hovered button turns white in light mode).

## Ground rules

- Follow this repo's AGENTS.md:
  - Bun manages packages.
  - Shipped code runs on Node 22.
  - TypeScript is strict.
  - User-facing strings live in packages/i18n/translations/en.json.
  - Every tenant row carries organization_id, and product-owned children belong to the same product.
  - HTTP and MCP adapters call the same authorized domain services.
  - No message dispatch: the CRM never sends; people and agents send and report.
- Checks: `bun run typecheck`, `bun run lint`, `bun run test` and `bun run build` stay green after every task. Tests must be meaningful: they fail if the feature breaks.
- No code comments in new code. No em-dash characters in code or copy. Prefer small focused files over growing crm-app.tsx.
- Migrations:
  - Generate them with `bun run db:generate` and exercise them locally on PGlite.
  - Never apply them to the Supabase database; the controller asks the owner first.
  - Never read or print the values in `.env.local` or `.env.production.local`.
- Local run: the controller's preview server `gravity-crm` serves this worktree at http://127.0.0.1:3016 in demo mode with PGlite (`CRM_DEMO_MODE=true`, no `DATABASE_URL`). Do not stop it. It hot-reloads. Re-seed with `env -u DATABASE_URL CRM_DEMO_MODE=true bun run db:seed` if needed.
- Another agent (Codex) works in ~/Projects/Noveum/noveum-crm on production auth. Never edit that checkout.
- Stage files by explicit path. Commits carry no trailers and no AI attribution.

## Design target (from the side-by-side review)

Port the larger build's look and structure. Its tokens and components are in ~/Projects/Noveum/gravity/apps/web/src (globals.css, components/layout, lib/interaction.ts, components/ui).

| Element | Target |
|---|---|
| Header | 45px breadcrumb (Workspace / Section / Record) with a Cmd K search pill and a one-click theme toggle; the same on every view; view-specific filters move into a slim toolbar under the header |
| Sidebar | 232px, collapsible with `[`; workspace switcher as a menu (not a native select); sections Work, Records, Outreach, Brands; user menu with Sign out at the bottom |
| Lists | Single-line 28px rows; group headers; full-row focus ring; no three-line cards |
| Type | 13.8px base, 12px secondary; no text under 11px; the footer status strip is replaced by toasts |
| Records | Peek panel on Space or Enter from a list, full record page on open; two columns with attributes on the left and the timeline on the right |
| Theme | Light and dark via tokens only. Base button styles go through `:where(button)` so component classes always win on hover. A hovered button never becomes lighter than its own resting fill in light mode or white |
| Motion | Opacity and transform only, at most 200ms, and prefers-reduced-motion is respected |

## Tasks

### Task 1: Design system and shell
- Port tokens, type scale, row heights and interaction tokens.
- Rebuild the header and sidebar as above.
- Add the theme toggle (in the header and in preferences) and the sidebar collapse.
- Replace the footer status strip with a toast host.
- Fix the hover bug at its cause: base element styles at zero specificity, hover colours from tokens.
- Use the empty, loading and error state components consistently.
- Do not change routes yet. Every existing view still works.
- Tests:
  - the theme toggle persists;
  - the sidebar collapse;
  - a toast replaces the footer;
  - in light mode, a hovered primary, secondary and accent-soft button keeps its own fill (computed style test).

### Task 2: Routes and record pages
- Every view gets a URL: `/actions`, `/people`, `/people/[id]`, `/companies`, `/companies/[id]`, `/sequences`, `/meetings`, `/opportunities`, `/materials`, `/outreach`, `/settings/...`, with `/` redirecting to `/actions`.
- Workspace and brand are kept in the URL (slug, not a UUID) or in a cookie.
- Navigation items are links. Back and Forward work, and reload keeps the view.
- Split crm-app.tsx into route components with shared data hooks.
- Add record pages for people and companies (two columns, timeline) and the peek panel from lists.
- Tests: deep links render the right view, Back returns to the previous view, reload keeps the record.

### Task 3: Keyboard map that works everywhere
- Implement and test every advertised shortcut:
  - G chords, `J`/`K`, arrows, Home/End;
  - Enter opens and Space peeks;
  - Esc backs out one level;
  - Cmd K opens the palette, which searches records (people, companies, actions) as well as commands;
  - `/` searches the view;
  - `C` creates in the current view;
  - `?` opens the guide;
  - `[` toggles the sidebar;
  - Cmd Shift L toggles the theme;
  - `X` selects with Shift+J/K extension;
  - row verbs on actions (`D` done, `S` snooze, `A` assign) with an undo toast;
  - E or Cmd Enter saves in dialogs.
- Shortcuts pause inside inputs and while composing, except Cmd combinations. The `?` guide lists exactly what is bound (generated from the same registry).
- Tests: one per binding, plus a test that the guide lists every registry entry.

### Task 4: Records you can change
- People: edit (name, title, emails, phone, LinkedIn URL, company, summary) and archive.
- Companies: create, edit and archive.
- Meetings: create and edit.
- Opportunities: create, edit stage and value, and drag or keyboard-move between stages; won and lost columns.
- Sign out.
- All through domain services with authorization, organization checks and change events, plus tests.

### Task 5: Outreach model and services (migration)
- **Pipelines per brand (product):** ordered stages with a category of open, won, lost or hold. The default prospecting stages are New, Researching, Contacted, Follow-up, Replied, Meeting, Won, Lost and Not now.
- **Relationships (person × brand) gain:** stage, priority, next step and due date, owner, last outbound and inbound timestamps, and touch count.
- **Touches:** one outreach message per relationship and step, with a lifecycle of planned, drafted, approved, sent, skipped or expired. Each touch records the channel, sender, draft body, approval (reusing the existing draft hash) and a sent report (who reported, when, external message id).
- **Sequences:** editable steps (channel, delay in days, template, follow-up number 1, 2 or 3).
- **Enrollment** creates planned touches. A planner advances them when the previous touch is sent and the delay has passed.
- **Pausing:** a reply pauses the person's touches across every brand.
- **Contact rules per workspace:**
  - do-not-contact on a person;
  - a cooldown in days between touches to the same person;
  - a daily cap per sender;
  - quiet hours in the person's or the workspace's time zone.
  The planner and the approve and mark-sent services enforce them and explain refusals.
- Nothing sends. "Mark sent" records a send that a person or an agent made.
- Generate the migration and test it on PGlite.
- Tests:
  - lifecycle transitions;
  - no double send (a touch can be reported sent once);
  - pause on reply across brands;
  - each contact rule;
  - planner timing;
  - tenant isolation.

### Task 6: Outreach section
- `/outreach` with these tabs:
  - **Today:** due touches grouped by follow-up step (first touch, follow-up 1, 2, 3).
  - **Drafts:** awaiting approval.
  - **Approved:** ready to send.
  - **Sent:** recent.
  - **Paused:** replied or held.
  - **Sequences:** editor and enrollments.
- Row actions: edit the draft, approve, mark sent (with an optional external message link), skip, snooze, open the person.
- Enroll people from the People list (single or multi-select) with a dry-run summary of who is skipped and why.
- Pipeline board per brand for relationships, with stage moves by drag and by keyboard (`Shift+Left`/`Shift+Right` never closes a lead implicitly).
- Keyboard throughout, and tests.

### Task 7: Settings
- `/settings` with these sections:
  - **Workspace:** name, time zone.
  - **Brands:** create, rename, colour, archive.
  - **Pipelines and stages per brand:** add, rename, reorder, category, archive.
  - **Members:** list, invite by email, roles, remove; this uses the existing auth stack, and invites need email delivery through the configured Resend provider when present, else a copyable link.
  - **Outreach rules:** cooldown, daily cap per sender, quiet hours, do-not-contact list.
  - **Connections:** Gmail, LinkedIn through Unipile, Calendar and Fireflies, as honest status cards.
  - **Assistants:** MCP grants with revoke.
  - **Preferences:** theme, density, shortcuts guide.
- Role checks come from the policy module, and the UI hides what the role cannot do.
- Tests per section.

### Task 8: Agent access to outreach (MCP)
- Read tools: list touches due, get a touch with its context.
- Write tools behind a write scope: draft a touch, claim a touch, report a touch sent or skipped.
- Same domain services and rules as the UI; the double-send guard holds for agents.
- Consent shows the destination host.
- Tests.

## Review

Each task gets an implementer, then a reviewer, then fix rounds until approved. A whole-branch review follows the last task. The owner sees progress on the local preview, and the controller asks before any migration reaches Supabase or any deploy reaches crm.noveum.ai.
