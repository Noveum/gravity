# Product fields and internal tasks

## Exact datetime fields

In a person's **Context & signals → Edit context**, choose **Date and time** for a custom field or enter a signal's observed time. Inputs use the workspace time zone and preserve seconds and milliseconds. Stored values and MCP inputs are UTC ISO instants, such as `2030-03-04T04:30:18.125Z`. Up to three fractional digits are accepted; sub-millisecond inputs are rejected rather than truncated. Date-only fields remain calendar dates with no timezone conversion. Invalid dates and nonexistent local times during a DST transition require correction.

Read `get_person_context` and save through `change_relationship` with the current version. Preserve unrelated entries when replacing the `contextDetails.fields` or `contextDetails.signals` arrays. An unchanged instant retains its original value, including an occurrence during a repeated DST hour.

## Product-wide field filters

The **Filters** controls on People, Companies, Opportunities, Meetings and Actions offer custom fields from all products currently selected and authorized. Add a field, choose its type-specific comparison, and enter a value. Numeric zero and Boolean No are valid values. Several filters are combined with AND within one relationship; they cannot combine unrelated facts from different products or contacts. A company matches when a single related relationship satisfies all filters. Presence and absence are tested for the selected label and type within that relationship.

Use `list_records` with `fieldFilters` for the same paginated database queries in MCP. HTTP uses GET `/api/crm?operation=records` with a JSON-encoded `fieldFilters` query parameter. Each filter has `label`, `type`, `operator` and a typed `value`, except `exists`/`missing`, which have no value. Labels are trimmed and case-insensitive. Text/URL equality and contains are case-insensitive; number/date/datetime comparisons support `eq`, `gt`, `gte`, `lt` and `lte`. Boolean values use `eq`. Datetime values compare exact instants, including milliseconds. Fields cannot reveal relationships outside current product access.

Example:

```json
[
  { "label": "Seats", "type": "number", "operator": "gte", "value": 0 },
  { "label": "Verified", "type": "boolean", "operator": "eq", "value": false },
  { "label": "Review time", "type": "datetime", "operator": "lt", "value": "2030-03-05T00:00:00Z" }
]
```

## Recurring internal tasks

On **Actions → Internal tasks → New internal task**, select a product, assignee and due time in the task's IANA time zone. A related person is optional and must belong to that same product. Add task details and choose no repeat, daily, weekly or monthly with an interval from 1 to 365. Editing uses the version captured when the editor opens; a stale save preserves the user's draft and asks for a reviewed refresh through the existing conflict error.

**Complete occurrence** completes a one-off task. A repeating task stays open and advances to the next future occurrence, skipping missed occurrences. Recurrence retains local hour/minute/seconds/milliseconds across DST. Nonexistent local times are skipped, including a completely skipped local day. Monthly recurrence retains its original day: January 31 advances to February 28/29, then March 31. Rescheduling or changing the repeat frequency, interval or time zone establishes a new anchor. **Show completed tasks** exposes one-off completed tasks and their **Reopen task** control.

MCP uses `list_internal_tasks`, `create_internal_task` and `change_internal_task`; HTTP uses the same registry with `internal-tasks` (GET), `internal-task-create` (POST) and `internal-task-change` (POST) on `/api/crm`. Create with `productId`, `ownerId`, `title`, `dueAt`, `timeZone` and optional `description`, `relationshipId` and `recurrence: { frequency, interval }`. Change with `taskId`, current `version` and `command: save|complete|reopen`; only `save` accepts field changes. Writes require current membership, product access and verified `crm:write` for MCP. Assignees must still have current product access, and a task whose assignee loses access can be reassigned by a current product member.

Completion and recurrence updates are atomic and emit change events. Internal tasks do not create messages, approvals, sequence touches or deliveries and never dispatch communication.
