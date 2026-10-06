# CRM usability and field review

This review covers the record surfaces, product navigation, long imported content, and deal forecasting in PR #30. Browser verification uses fictional local demo records. Stored production records were not rewritten or assigned guessed revenue values.

## Field audit

| Record | Fields reviewed | Display and editing |
| --- | --- | --- |
| Person | Name, title, primary and additional emails, phone, LinkedIn URL, company, notes, tags, amount and currency | Contact facts remain first. Notes are in the activity panel with a bounded preview and complete disclosure. Contact estimates and tags have their own disclosure. Contact fields use the person editor. |
| Company | Name, domain, description, people, product relationships, tags, amount and currency | Long descriptions have bounded previews. Company estimates are labelled separately. Related opportunities expose actual deal values and direct editing. |
| Product relationship | Product, owner, buyer/partner purpose, qualification, context, custom text/number/date/URL/boolean fields, signals, imported source, tags, amount and currency | Structured context and signals remain in the main panel. Long text fields collapse into previews. Source data remains available. Product estimates do not contribute to forecasts. |
| Opportunity | Name, product relationship, pipeline, stage, owner, amount, ISO currency, integer win probability, expected close date, outcome, context, loss reason, tags, version | Amount and probability drive a live expected-revenue preview. Related records and board cards expose value and forecast. The editor preserves currency precision and uses versioned domain writes. Won/lost stages use canonical probabilities. |
| Meeting | Title, relationship, start time, status, summary, proposed commitment, commitment owner and due date | Summaries have bounded previews, complete disclosure, and description search. Editors retain the original summary and workspace time zone. A booking still requires explicit review before becoming a commitment. |
| Activity | Synced message body, channel, direction and time; evidence title, classification, excerpt, source and observed time; action title, reason, owner, due date, status and draft | Long content wraps. Imported notes remain notes; they are not fabricated synced messages. Existing access, version, approval and send rules remain in place. |

## Navigation and reporting checks

- Sidebar products and All products open their overview and clear the prior record. Toolbar product selection retains the current list.
- Incompatible pipeline/stage URL filters are cleared on the opportunities board after a product switch.
- Contact, company, and relationship estimates are distinct from opportunities, preventing duplicate revenue counting.
- Forecasts include only open opportunities with both amount and probability. Unknown values differ from zero; currencies stay separate.
- Monetary displays preserve USD cents, JPY whole units, and KWD three-decimal precision.
- Activity chart bars fill their day button; browser inspection verified the previous zero-width rendering and the repaired geometry.
- Forecast coverage is visible beside overview metrics. Drill-through continues to use authorized records.
- Empty estimate sections and opportunity context stay collapsed. Long notes retain their complete text for inspection and editing.

## Verification

Regression coverage exercises direct record editing, relationship-prefilled creation, saving all forecast fields, invalid currencies, unknown/zero/won/lost cases, incompatible product filters, precise amounts, and estimate exclusion. Existing domain and transport tests continue to cover authorized scope, private histories, stale versions, and outcome consistency.

Actual production amounts and probabilities must be entered from reviewed deal information. Expected revenue is a probability-weighted estimate, not booked revenue or an automatic assessment of a customer's budget.
