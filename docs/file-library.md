# File library

`/files` is the product-scoped document library in the production CRM application. The sidebar opens it under Sales materials. `/materials` retains existing stage-linked assets, folders, hashes, versions and approvals. The new library is additive: migration 0022 creates its tables without rewriting or deleting existing CRM data.

Folders contain folders, uploaded files and editable Markdown documents. List, grid and column views support selection, keyboard cut/copy/paste, folder navigation and internal drag/drop. Native file and directory uploads preserve relative paths and empty folders, with three simultaneous upload workers and per-file progress. Lists with more than 100 items render a viewport window. Transfers are atomic and limited to 1,000 descendants, including nested folders. Copies start private; moving and deleting require ownership of every descendant.

## Storage and release

Production metadata uses the existing Supabase/Postgres database, its restricted server role and RLS. Uploaded bytes use a private S3-compatible bucket, including [Supabase Storage's S3 endpoint](https://supabase.com/docs/guides/storage/s3/compatibility). Configure the existing server-only `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`. Credentials must never use a `NEXT_PUBLIC_` variable.

Before deploying this change, review the migration target and backup policy, then apply migration 0022 using the existing `bun run db:migrate` release procedure. It grants the trusted `gravity_app` role access to the two new RLS tables and revokes API-role privileges, including the Supabase service role. Browser database roles retain no access. No migration runs automatically against production on application startup.

The bucket must remain private. Permit browser PUT and GET from the exact application and preview origins in bucket CORS, including the Content-Type request header. Permit HEAD if needed by the provider. The server reserves a ten-minute signed PUT URL; the browser sends bytes directly to storage, avoiding the hosting request-body limit. The completion operation rechecks destination permissions and the reservation owner/expiry, verifies the object size, and conditionally copies its current ETag to an immutable final key. Replaying the pending PUT cannot overwrite a completed file.

Maximum upload size is 100 MiB per file. Original bytes remain available for download regardless of preview support. Downloads are authorized again and use a 60-second signed GET. A previously issued URL remains usable until it expires. The local demo uses persistent `.data/library` files and disables its byte-upload transport in production.

Deleted metadata and expired reservations do not currently garbage collect storage objects. Copies share immutable object references. Retention cleanup must verify that no live file references an object before removing it; never configure a lifecycle rule that deletes final referenced objects blindly.

## Access

Private items are owner-only. Workspace items require current workspace membership and access to the owning product. Specific-person sharing grants viewer or editor access, also subject to current product access. Public access deliberately permits anonymous viewing/download through an unguessable token. Inherited access resolves the closest explicit scope. Every ancestor must remain readable, including for public links.

Only owners change sharing or move/delete their items. Editors can rename and edit Markdown or add children to editable folders. Making an ancestor private revokes descendant public links and specific-person access immediately for new reads. The UI refreshes through the existing authorized revision feed and clears preview content during revalidation. MCP uses the same operation catalog and services as HTTP, preserving its organization/product grants and read/write scope. Sharing a document never grants message sending, account access or access to another product.

## Previews

PDF pages render on canvas with page navigation and extracted text. Images and bounded text/CSV render in the application. Markdown disables active HTML and displays remote images as links. DOCX and PowerPoint have read-only previews isolated in sanitized, script-free sandbox frames; external Office relationships are removed. Slides fit their intrinsic aspect ratio and retain embedded images. Office fidelity may differ from the original application; original downloads preserve uploaded formatting.

Office input previews are limited to 32 MiB and validated ZIP expansion budgets. Excel parsing runs in a disposable worker with a 30-second deadline. It preflights expanded XML before allocation, bounding cells, rows, sheet dimensions, shared strings, style records, text, depth and element counts. The UI requests at most 100 rows and 30 columns per page and supports worksheet selection and jumping to a cell. Cached formula results are shown without recalculation. Merged layouts are omitted. Oversized or malformed workbooks show a download fallback without attempting unbounded rendering.

## Verification

Run `bun run verify` for lint, dependency licenses, strict types, the complete unit/integration suite, the production build and public-site smoke tests. Run `bun run test:files` for browser uploads and rendering using fictional fixtures and a local demo server with uniquely named fixtures. It checks downloads against original bytes, nested folder copy/paste, native directory uploads and keyboard transfers, view changes, slide navigation, PDF canvas output, image decoding, Markdown persistence, large Excel paging and oversized workbook fallback.

`bun run test:file-storage` qualifies signed transfers against local MinIO at port 9030 in a fresh private bucket and removes that bucket afterward. It checks size mismatches, empty files, UTF-8 decoding, private access and immutable final objects after replaying a signed upload. Override `FILE_STORAGE_TEST_ENDPOINT`, `FILE_STORAGE_TEST_ACCESS_KEY` and `FILE_STORAGE_TEST_SECRET_KEY` for another local instance. Remote endpoints are deliberately rejected.
