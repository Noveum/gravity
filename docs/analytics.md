# Overview and deals

Open `/overview`, or press **G V**. Product selection updates reports immediately from the authorized workspace snapshot. Choose a teammate, message channel, and 7/30/90-day reporting period. Every KPI, activity bar, pipeline stage, team metric and data-health row opens its underlying records. Message details are fetched in pages of 50 and respect private conversation ownership. Click a deal to edit it, a follow-up to inspect its person/context, or a meeting to open the meeting record.

## Definitions

- **Overdue / due today:** incomplete actions owed by us, compared with the organization's calendar day. Actions waiting on the other person are reported separately. Blocked actions remain incomplete. Completed actions are an all-time current count; completion dates are not recorded yet.
- **Sent / received messages:** stored, synced outbound/inbound messages in the selected calendar-date range. Drafts, approved actions and scheduled sequence steps do not count as sends. Inbound messages are not necessarily replies to an outbound message. Unmatched imports are excluded until assigned to a relationship. Counts cover available synced history, not an entire unconnected mailbox. Future timestamps are excluded.
- **Team message activity:** attributed to the connected mailbox owner, who may differ from a relationship or deal owner. Private conversations are invisible to other teammates, including their counts.
- **Outreach workload:** planned/approved messages in running sequences, including overdue touches and first/second/third follow-ups. Paused sequences are excluded from due workload. Manually reported sends are a separate period count and are never added to synced message counts. Open each record to inspect its outreach drawer.
- **Open pipeline value:** current open deals with a known amount, grouped by currency. Values are never added across currencies. A blank amount is unknown; zero is a valid recorded amount.
- **Weighted value:** amount multiplied by the recorded probability. Deals without either field are excluded. Average deal size uses open deals with a known amount, separately per currency.
- **Won value / win rate:** deals with a recorded close time in the reporting period. Win rate is won divided by won plus lost; it is blank when there are no recorded outcomes. Existing deals without a historical close time are excluded from period results.
- **Pipeline stages:** current stage occupancy, not a historical conversion funnel. Data health highlights missing values/probabilities/close dates, expected close dates in the past, and open deals with no pending relationship action. Meetings held use their recorded start date and held status.

Date boundaries use the organization's time zone. Channel filtering applies to message activity and outreach workload; pipeline and relationship-action reports retain their product/owner scope. The source is the same live snapshot used by the app, with existing SSE revision delivery and reconciliation. No analytics subscription or external chart service is required.

## Entering and reviewing revenue

Open a person or company record and use **New deal**, or click an existing opportunity to edit it without leaving the record. Creating from a person preselects the current product relationship. The editor shows expected revenue as the deal amount and probability change. Won and lost stages use 100% and 0%. Unsupported currencies and values outside the supported precision produce an input error.

Expected revenue is visible on the overview, opportunity board, and related opportunities. Forecast coverage counts only open opportunities with both amount and probability. Contact, company, and product relationship estimates are displayed separately and never added to pipeline revenue. Empty estimate sections are collapsed; expanding them exposes their values, tags, and editor. The amounts retain the currency's minor-unit precision throughout the interface. Switching the toolbar product clears incompatible pipeline and stage filters while retaining the opportunities view.

## Deal fields and pipelines

Deals record name, product, person relationship, pipeline/stage, owner, amount, currency, probability, expected close date, open/won/lost outcome, context and loss reason. Stored monetary amounts use ISO currency minor-unit precision, including zero-decimal and three-decimal currencies. Closing sets a close time and canonical probability (won 100%, lost 0%); reopening clears the close time. Editing an already closed deal preserves its close time. Updates require the current version and keep product/person identity fixed.

Organization admins can create multiple pipelines per product. Each starts with Discovery, Evaluation, Proposal, Won and Lost. Custom stage editing and historical stage transition analysis are future work. Owners and stages must belong to the same authorized product.

## MCP and database upgrade

`get_overview`, `get_message_activity`, `save_deal`, and `create_pipeline` use the same domain permissions and version checks as HTTP/UI. An assistant's organization/product grant and current membership still apply. These operations do not send messages.

Migration `0011_productive_miss_america.sql` adds protected pipelines, deal fields and the message activity index after the record/outreach migrations. It attaches existing deal stages to a default product pipeline, preserves stage/deal IDs and values, and derives current owners/outcomes from stage categories. Outreach stages keep their separate family. Unknown historical creation/close timestamps remain null. RLS, restricted runtime grants and API-role revocations apply to the new table. Review the production target and backup policy before applying; never seed fictional demo records in production.
