# Record browsing

People, companies, product relationships and opportunities have custom tags and an optional deal size. Edit people and companies in their side inspector or full record. The product relationship section edits values for the selected product. Opportunity forms include tags alongside their existing amount and currency fields.

Tags are trimmed, limited to 30 per record and 50 characters per tag, and matched without case sensitivity. The current editor accepts comma-separated tags. An empty deal size means unknown; zero is a confirmed zero amount. Amounts use integer minor units and the currency's decimal precision. Range filters compare one currency, defaulting to USD when none is selected, without converting currencies.

Actions, meetings and outreach use their product relationship's tags together with the person's and company's tags. Their deal size uses the first confirmed value on the relationship, person or company, in that order. Opportunity filters also include those inherited tags and use the opportunity's own amount. People and companies list their own tags and deal size. People support owner and qualification filters across their visible product relationships.

Lists render 50 records by default, with 25, 50 and 100 row choices. Search, product scope and filter changes return to the first page. Opening or closing an inspector preserves the current page. Related work, company contacts, archived records and sequence enrollments also have bounded pages. Board totals count every matching record, even when only one page is displayed.

Clicking a person or company, including blank row cells, opens the side inspector. Modified link clicks retain normal browser behavior. Space previews a focused record and Enter opens its full page. The inspector retains an explicit Open record link. Imported JSON remains available in a collapsed source-data disclosure below readable prose.

The browser uses a compact authorized workspace snapshot for consistent product switching and local filters. Its SQL projection omits person summaries, relationship context and action reasons; opening a record fetches the complete authorized context. Editing a person waits for that complete context so an omitted summary cannot overwrite stored content. The browser still loads the compact record index for the workspace; it does not fetch each displayed page independently.

The shared HTTP and MCP `list_records` operation queries authorized database rows with SQL filters, stable ordering, a maximum page size of 100, total count and next offset. Tag and currency-specific minor-unit range filters apply to people, companies, relationships and opportunities; unsupported metadata filters on other collections are rejected. `update_record_metadata` validates organization and product access, archive state and current version, then writes metadata, increments the version and records a change event in one transaction.

Generated migrations add empty tag arrays, unknown deal sizes, currency defaults, amount checks and browsing indexes. No existing commercial amount is inferred. Local tests exercise those migrations, permission isolation, concurrent-version rejection, currency filtering, compact editing, inspector navigation, bounded rendering and SQL paging over 10,000 contacts.
