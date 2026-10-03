# Gravity interface and interaction design

Status: approved direction, 2026-10-03. Companion to `2026-10-03-gravity-design.md`. Every screen in M0.2 and later is built against this document.

## 1. Feel

Gravity is used for hours a day by people working through hundreds of records, and in parallel by agents writing to the same records over MCP. The interface has three jobs: show the next thing that needs a human, let that human act on it without touching the mouse, and show every change (theirs, a teammate's or an agent's) the moment it happens.

Four rules decide every trade-off:

1. **Instant.** A keystroke or click changes the screen in the same frame. Nothing waits on the network before the screen updates.
2. **Live.** What is on screen is what is in the database right now, including other people's and agents' changes, with no refresh.
3. **Keyboard first, mouse friendly.** Every action has a key, and every key is discoverable from where you are.
4. **One surface for humans and agents.** Anything a person can do in the UI an agent can do over MCP, and the reverse. Both see each other's work as it happens.

## 2. Visual system

- **Orbit's colour system, unchanged.** The blue accent, every neutral, the semantic colours, both light and dark themes, radii, row heights and motion durations come from Orbit's `globals.css` with only the prefix renamed. Light and dark are both first class and follow the system setting unless the user picks one.
- **Brand colours are data.** Each brand has a colour chosen from a fixed palette of tokens that read in both themes. It is used only as a small dot or stripe, so three brands never turn the screen into a rainbow.
- **Density.** Default rows are Orbit's compact height. A comfortable density doubles the vertical padding for people who want it. The choice is per user.
- **Type.** Orbit's typeface and scale. Numbers that line up (counts, dates, money) use tabular figures.
- **State is shape as well as colour.** Owed-by, stage category, blocked checks and agent authorship each have an icon or chip shape, so they read without colour in either theme.
- **Motion.** Transform and opacity only, 80ms for row highlights, at most 200ms for panels, nothing that reflows, everything off under `prefers-reduced-motion`.

## 3. Screen layout

Three zones, left to right, sized for a 1440px laptop and degrading cleanly.

| Zone | Default width | Contents |
| --- | --- | --- |
| Sidebar | 232px, collapsible to 56px with `[` | Workspace switcher, Work (Today, Inbox, Meetings), Records (Leads, People, Companies, Deals, Sequences), Brands with their pipelines, saved Views, Settings |
| Main | Flexible | The list, board, queue or record the user is working in |
| Context panel | 420px, resizable from 360 to 640px, remembered per user | Peek of the focused row, or the right-hand pane of focus mode |

Breakpoints:

- **1440px and wider.** All three zones visible. Focus mode uses three panes: context, draft, checks.
- **1200 to 1439px.** Sidebar collapses to icons by default. Focus mode merges checks into a strip under the draft.
- **900 to 1199px.** The context panel overlays the main zone instead of pushing it.
- **Under 900px.** One column. Lists and records stay fully usable for reading, triage, notes and approvals. Settings and bulk actions show on wider screens only.

The top bar of the main zone holds, in order: a breadcrumb (brand, pipeline, view), the view switcher (list or board), the filter chips, a Display menu (grouping, ordering, visible properties, density) and presence avatars of who else is on this view, agents included.

## 4. Speed architecture

What makes it feel instant, in the order it happens:

1. **Cached first paint.** TanStack Query's cache persists to IndexedDB for 24 hours, so a reload paints the last known lists before any request completes. The server also prefetches and dehydrates the first page of the route being loaded.
2. **Bootstrap once.** One ETag-cached `/api/bootstrap` returns workspace metadata: brands, pipelines, stages, field definitions, members, saved views, and the caller's senders. Pickers never fetch.
3. **Optimistic mutations.** Every write updates the cache immediately, sends the request with the client id header, and rolls back with a toast only if the server refuses. The toast always offers Undo or Retry.
4. **Patch, never refetch.** Realtime deltas update cached rows in place. A delta that changes whether a row belongs in a list (stage, owner, pipeline) moves it in or out of that list using the list's filter, evaluated on the client with the same filter code the server uses.
5. **Own echoes are skipped** by client id. Out-of-order deltas are dropped by `sync_id`.
6. **Reconnect catches up from the outbox** with `since=<last sync id>`, which includes deletes, so a laptop that slept for an hour is correct within one request.
7. **Virtualized everything.** Lists, boards and timelines render only visible rows, so 10,000 leads scroll at 60fps.
8. **No spinners under 300ms.** Below that the UI shows nothing. Above it, a skeleton appears in place. Buttons never disable while a request is in flight; repeated presses are idempotent.
9. **Search is local first.** The palette searches the cached records instantly and merges server results within 140ms of the last keystroke.
10. **Conflicts are per field.** Two people editing different fields never conflict. Two people editing the same field: the later write wins, the earlier writer sees the new value arrive with a brief highlight and can press `Cmd+Z` to restore theirs.

Budgets, enforced by a Playwright performance test in M0.3: keystroke to visible change under 16ms, route change from cache under 100ms, a teammate's change visible in another browser under 500ms on a local network.

## 5. Humans and agents on one surface

- **Parity.** Every UI action maps to an MCP tool and every MCP write tool maps to a UI action. A test enumerates both lists and fails when one side gains an action the other lacks.
- **Same identifiers.** Each pipeline has a short key (for example `YOD`, `GLD`, `API`) and every lead gets an identifier such as `YOD-142`, like Orbit issues. People and companies are addressed by email, LinkedIn URL or domain as well as id. MCP tools accept all of these, and the palette jumps to any of them.
- **Deep links both ways.** Every MCP response includes the URL of what it touched. Every record page has "Copy link" (`Cmd+Shift+C`) and "Copy for agent" (`Cmd+Shift+A`), which copies a compact text context bundle (the same text `get_context` returns), so a person can paste a record into a Claude or Codex chat.
- **Agents are visible while they work.** An MCP session that reads or writes a record shows as a presence avatar with an agent badge on that record and its lists ("Claude for Shashank"). Agent writes animate in like a teammate's, with the badge on the timeline entry.
- **Agent activity feed.** A filterable feed (Settings → Agents, and per record) lists every agent write with client, human and time, and offers one-click revert for each.
- **Human edits win.** A field a human set is not overwritten by an agent or by enrichment unless the human allows it; the agent's attempt is recorded as a suggestion on the field instead.

## 6. Core flows

### 6.1 Morning approvals

1. `G T` opens Today. Section counts show at the top; `1` to `7` jump between sections.
2. `Enter` on Approvals starts focus mode on the first item.
3. Left pane: person, company, every lead with owner, overlap banner, timeline, facts with ages. Centre: the draft with channel, sender, window, author and sources. Right: why it is due, each check, the sender's cap meter, the next steps.
4. `A` approves and loads the next item. `E` edits in place (`Cmd+Enter` saves and approves, `Esc` cancels). `R` opens a one-line instruction box ("shorter, mention the hiring post"); the agent's new draft streams into the centre pane. `H` snoozes with a picker (`1` later today, `2` tomorrow, `3` next week, or type a date). `X` skips with a reason.
5. A failing check turns into a blocking chip with its explanation and the fix ("override with reason" or "wait until Oct 8"). `A` is disabled while a block exists; `Shift+A` overrides and asks for a reason.
6. When the section is empty the screen says so and offers the next non-empty section.

### 6.2 Adding a person

1. `C` anywhere opens quick create. Paste a LinkedIn URL, an email or a name.
2. As you type, matching people and companies appear underneath from the local cache and then the server. Choosing one opens it rather than creating a duplicate.
3. `Tab` moves to company (auto-filled from the email domain), pipeline (defaults to the current one) and owner (defaults to you).
4. `Cmd+Enter` creates the person and the lead in one step. The new row appears in every open list that matches, for every teammate, immediately.

### 6.3 Working a pipeline

1. `G L` opens Leads for the last used pipeline. `V` toggles list and board.
2. `J` and `K` move, `Space` toggles the peek, `Enter` opens the full record, `X` selects, `Shift+J` and `Shift+K` extend the selection.
3. Single-key verbs on the focused or selected rows: `S` stage, `A` assign, `P` priority, `N` next action, `Shift+H` hold with reason, `E` enroll, `Cmd+Backspace` close.
4. Each verb opens a small picker anchored to the row: type to filter, `Enter` to apply. With a selection, the change applies to all selected rows and offers Undo.
5. On the board, cards drag between stages, or `Shift+Left` and `Shift+Right` move the focused card one stage.

### 6.4 Replying to a reply

1. Replies owed sit at the top of Today and in Inbox, sorted by how long the person has waited.
2. `Enter` opens the conversation with the record context beside it.
3. `D` asks the agent to draft a reply, which lands as an approval in the same pane. Once approved, the reply is ready for the sending agent, and its 10-minute freshness window is shown as a countdown.

### 6.5 Researching before contact

1. On a lead in Researching, `F` adds a fact (claim, source URL, date). Pasting a URL fills the source.
2. `Cmd+Shift+A` copies the agent context bundle for a chat, or the scheduled research agent fills facts automatically.
3. `S` then `Ready` moves it on. A lead cannot reach Ready while the history gate blocks it; the chip says why.

### 6.6 Bulk work

1. Filter a list (`F` opens the filter menu, `/` searches), then `Cmd+A` selects every match, not just the visible rows.
2. `E` enroll, `A` assign, `S` stage or `Shift+H` hold applies to the whole selection.
3. Enroll and any change touching more than 50 rows show a dry-run summary first (clean, blocked by company lock, in cooldown, suppressed, history-blocked), with the blocked rows listed and openable.

### 6.7 After a meeting

1. A finished meeting with notes appears in Today under Meetings.
2. The pane shows the summary and action items. `T` on an action item turns it into a task. `D` drafts the recap as an approval.
3. `S` moves the lead to Meeting held.

## 7. Keyboard map

Rules: single keys act on whatever is focused; `G` chords navigate; `Cmd` combinations work even while typing in a field; `Esc` always backs out one level; `?` shows the keys available on the current screen.

### Global

| Keys | Action |
| --- | --- |
| `Cmd+K` | Command palette: navigate, search records by name, email, domain or identifier, run any action |
| `/` | Search within the current list |
| `C` | Quick create (person, company, lead; `Tab` switches type) |
| `G T` `G I` `G M` | Today, Inbox, Meetings |
| `G L` `G P` `G C` `G D` `G S` | Leads, People, Companies, Deals, Sequences |
| `G ,` | Settings |
| `[` | Collapse or expand the sidebar |
| `]` | Show or hide the context panel |
| `?` | Keyboard shortcuts for this screen |
| `Cmd+Z` `Cmd+Shift+Z` | Undo, redo the last change |
| `Cmd+Shift+C` | Copy link to the current record or view |
| `Cmd+Shift+A` | Copy the agent context bundle for the current record |
| `Esc` | Close the topmost layer |

### Lists and boards

| Keys | Action |
| --- | --- |
| `J` `K` or arrows | Move focus |
| `Space` | Toggle peek |
| `Enter` or `O` | Open record |
| `X` | Select or deselect |
| `Shift+J` `Shift+K` | Extend selection |
| `Cmd+A` | Select all matching the filter |
| `S` `A` `P` `N` | Stage, assign, priority, next action |
| `Shift+H` | Hold with reason |
| `E` | Enroll in a sequence |
| `L` | Add or edit a custom field value |
| `Cmd+Backspace` | Close or archive |
| `V` | Toggle list and board |
| `F` | Filter menu |
| `Shift+F` | Clear filters |
| `Cmd+S` | Save the current filters as a view |
| `Shift+Left` `Shift+Right` | Board: move card one stage |

### Record

| Keys | Action |
| --- | --- |
| `N` | Add a note |
| `L` | Log a call or interaction |
| `T` | Add a task or follow-up |
| `F` | Add a fact |
| `S` `A` `N` | Stage, assign, next action for the lead in focus |
| `Tab` | Move between the record's leads |
| `1` to `6` | Timeline filter: all, messages, meetings, notes, facts, changes |
| `[` `]` | Previous or next record from the list it was opened from |

### Today focus mode

| Keys | Action |
| --- | --- |
| `1` to `7` | Jump to a section |
| `Enter` | Start focus mode on the section |
| `A` | Approve and next |
| `Shift+A` | Override a block with a reason, then approve |
| `E` | Edit draft in place |
| `Cmd+Enter` | Save edit and approve |
| `R` | Regenerate with an instruction |
| `D` | Ask the agent to draft (replies, recaps) |
| `H` | Snooze |
| `X` | Skip with reason |
| `C` | Copy and open the channel (manual send) |
| `M` | Mark sent |
| `J` `K` | Next, previous item without acting |

Conflicts are resolved by context: `A` is assign in lists and approve in focus mode, `E` is enroll in lists and edit in focus mode. The shortcuts overlay always shows the meaning for the current screen.

## 8. Empty, loading and error states

- **Empty** states say what will appear and give the one action that fills them ("No leads in Yodu · Direct yet. Press C to add a person, or import a CSV").
- **Loading** shows nothing for 300ms, then a skeleton shaped like the real rows.
- **Offline** shows a slim banner. Reads keep working from cache, and writes queue and replay on reconnect in order. A write that fails on replay surfaces with Retry and Discard.
- **Errors** name what failed and how to fix it, never "something went wrong" alone. A permission error names the role needed.

## 9. Accessibility

Radix primitives for every menu, dialog and popover. Visible focus rings in both themes. Every shortcut has a clickable equivalent. The focused row is announced to screen readers with its key fields. Colour contrast meets WCAG AA in both themes, checked by an automated test against the token values.
