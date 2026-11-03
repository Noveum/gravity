# Reviewed CSV imports

Gravity imports contacts and companies from CSV through the same authorized operation registry in the browser and MCP. Files support at most **1,000 data rows** and 5,000,000 characters. Split larger files before importing. Parsing rejects malformed quotes, duplicate or empty headers, uneven rows, and mappings that would overwrite another column's target field. Field limits produce validation errors instead of truncating values.

## Access, identity and provenance

Current organization and product membership is checked for every preview. Import checks current product write access again inside its transaction. A verified `crm:read` MCP principal can preview; `crm:write` is required to import. HTTP method does not determine business read/write permission.

Collisions are checked across the organization, including archived contacts and companies, primary and alternate email addresses, and normalized LinkedIn profiles. Preview shows only values supplied in the CSV and structured collision reasons. It does not disclose stored record names or identifiers, including records outside the selected product. Duplicate identities within the file are also flagged. There are no silent merges or updates: without `skipDuplicates`, duplicates reject with `PERSON_EXISTS` or `COMPANY_EXISTS`; with it, only valid non-duplicate rows are imported.

Contact imports create an immutable `contact_import_batches` declaration with source kind `file` for both browser and MCP submissions. Transport records `session`, `demo` or `mcp` independently. Actor, MCP client and grant attribution come from authentication. Each created contact contribution references the batch, logical source-row number and parsed row hash; `get_contact_attribution` exposes the readable joined batch label and submission history. Attribution does not establish sending permission.

Imports are atomic: people, companies, product relationships, batch declarations, contributions and change events roll back together if a write fails. The row bound is enforced before opening the import transaction or acquiring the organization lock. The import operation is not idempotent. After an unknown response, inspect the recorded state before attempting another import.

## Browser workflow

1. Open **People** or **Companies**, then **Import CSV**. The Companies entry defaults to **Companies only**; the import type can be changed.
2. Select an authorized product. Contact mode also asks for the relationship purpose, Buyer or Partner.
3. Select a CSV and review its detected column mapping. Each target field can be mapped once. Company mode accepts company name, domain and description; name or domain is required. Contact mode requires a person name.
4. Select **Preview import** and review valid, duplicate and invalid rows. File replacement clears the prior preview; preview stays unavailable while file text is loading. Superseded reads cannot replace newer file data, and import uses the exact input associated with the successful preview.
5. Import the valid rows. The summary reports contacts, companies, relationships, skipped duplicates and invalid rows. Company-only mode creates organization companies without people or product relationships.

## Shared HTTP and MCP operations

- `preview_csv_import`: POST `/api/crm`, operation `csv-import-preview`, business access `read`. Inputs are `organizationId`, `productId`, `csvText`, optional `columnMapping`, `mode` (`contacts`, the default, or `companies`) and `purpose` (`buyer` or `partner`). Returns summary counts, detected mapping, validated input rows, structured duplicate reasons and validation codes. The browser translates codes using `en.json`.
- `import_contacts_csv`: POST `/api/crm`, operation `csv-import`, business access `write`. Accepts the same inputs plus `skipDuplicates`, optional `rowIndices` and `label`. Returns import and rejection counts, created contact identifiers with relationship identifiers, and company identifiers for company-only imports. MCP supplies the immutable organization scope from authentication instead of accepting it from tool input.

## Regression coverage

All fixtures are fictional. `tests/csv-import.test.ts` covers CSV parsing, mapping, the 271-row fixture, import summaries and organization isolation. `tests/csv-import-security.test.ts` covers current product membership, read-only MCP preview, private collision responses, identity normalization, joined provenance, company-only imports, field and row limits, pre-transaction rejection and forced mid-import rollback. `tests/csv-import-ui.test.tsx` covers preview/review/import, company summaries, localized errors, deferred replacement reads and out-of-order file completion. `tests/mcp-write.test.ts` exercises tool discovery, scope reporting, annotations and read-only preview through the MCP transport.
