# Reviewed CSV Imports

Gravity supports reviewed CSV imports for contacts and companies with column mapping, duplicate detection, and final summaries, matching Slice 2 of the roadmap.

## Overview & Policy

- **No silent merges**: Rows whose person email or company domain already exists within the organization (or duplicates within the same file) are highlighted for review. They are never silently overwritten or merged. Attempting an import without skipping duplicates explicitly rejects with `PERSON_EXISTS` or `COMPANY_EXISTS`.
- **Product relationship**: Every imported contact must be bound to a selected product with a defined purpose (`buyer` or `partner`).
- **Attribution & Provenance**: Imports create a batch in `contact_import_batches` with source kind `file` (or `agent` via MCP) and record submission attribution.
- **Atomic transactions**: Imports run inside a database transaction with organization locks. If `skipDuplicates` is false and a duplicate is encountered, the entire batch rolls back.

## UI Workflow

1. Navigate to **People** (`/people`) or **Companies** (`/companies`).
2. Click **Import CSV** in the view toolbar, or use the command menu (<kbd>Ctrl</kbd>+<kbd>K</kbd> / <kbd>⌘</kbd>+<kbd>K</kbd>) $\rightarrow$ **Import contacts and companies from CSV**.
3. Select the target **Product relationship** and **Relationship type** (Buyer or Partner).
4. Upload or drop a `.csv` file:
   - Headers are parsed in the client using RFC 4180 parsing.
   - Column mappings are auto-detected (e.g. `Name`, `Email`, `Title`, `Phone`, `LinkedIn`, `Company`, `Domain`, `Summary / Notes`). You can adjust mappings or set unwanted columns to "Do not import".
5. Click **Preview import**:
   - The preview runs `preview_csv_import` against the server without writing any database records.
   - Summarizes total rows, valid rows, duplicates for review, and invalid rows.
   - Review duplicate conflicts: displays the existing record name, email/domain, and reason why it cannot be merged silently.
   - Review validation errors (e.g. missing required person name, malformed emails or domains).
6. Click **Import valid contacts**:
   - Executes `import_contacts_csv` with `skipDuplicates: true`.
   - Displays the **Import summary** card with counts of people created, companies created, and duplicates skipped.

## MCP & Operations Catalog

Both browser clients and AI assistants execute the exact same reviewed flow via `packages/operations/catalog.ts`:

- **`preview_csv_import`** (POST `/api/crm`, operation `csv-import-preview`):
  - Parameters: `organizationId`, `productId`, `csvText`, `columnMapping` (optional), `purpose` (`buyer` | `partner`).
  - Returns: summary counts, detected mapping, valid row previews, duplicate rows with collision reasons, and invalid rows with error messages.
- **`import_contacts_csv`** (POST `/api/crm`, operation `csv-import`):
  - Parameters: `organizationId`, `productId`, `csvText`, `columnMapping` (optional), `purpose`, `skipDuplicates` (`boolean`), `rowIndices` (optional), `label` (optional).
  - Returns: summary with `importedCount`, `peopleCreated`, `companiesCreated`, `relationshipsCreated`, `duplicateCount`, and `invalidCount`.

## Fictional Fixture & Test Suite

The test suite exercises several hundred rows from `tests/fixtures/fictional-contacts.csv` containing exclusively fictional data:
- `tests/csv-import.test.ts`: Validates RFC 4180 parsing, column detection, 271-row preview, duplicate collision detection, rejection on duplicates, atomic transactional rollback, provenance attribution recording, product permissions, and cross-organization isolation.
- `tests/csv-import-ui.test.tsx`: Exercises toolbar launch, file selection, column mapping, preview tabs, duplicate review, and import completion in jsdom.
