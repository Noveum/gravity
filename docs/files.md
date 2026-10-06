# Document library

The Files section stores folders, access settings, and Markdown in PostgreSQL. Binary documents use a private S3-compatible bucket. The browser uploads directly to storage, so PowerPoint, PDF, Word, spreadsheets, and other file types do not pass through a Vercel request body. The per-file limit is 100 MB.

## Local development

Copy the S3 settings from `.env.example` into `.env`, then run:

```sh
bun run infra:up
bun run storage:setup
bun run db:push
bun run dev
```

The MinIO bucket persists in the `gravity-minio` Docker volume. PostgreSQL persists folder metadata and editable Markdown in its own volume. `bun run infra:down` preserves both volumes. `bun run infra:reset` removes local data.

`storage:setup` initializes local MinIO only. The bucket remains private. Docker configures browser upload CORS for `NEXT_PUBLIC_APP_URL`, which must match the browser origin. Restart MinIO after changing that origin.

## Supabase Storage or hosted S3

For Supabase, enable its S3 connection and create a **private** bucket. Set the server environment variables:

```text
S3_BUCKET=gravity-documents
S3_ENDPOINT=https://PROJECT_REF.storage.supabase.co/storage/v1/s3
S3_REGION=YOUR_PROJECT_REGION
S3_ACCESS_KEY_ID=YOUR_S3_ACCESS_KEY
S3_SECRET_ACCESS_KEY=YOUR_S3_SECRET_KEY
```

Use the S3 access key pair from Supabase Storage settings. These are different from the project's anon and service role API keys. Keep storage credentials on the server. Follow [Supabase S3 authentication](https://supabase.com/docs/guides/storage/s3/authentication) and [API compatibility](https://supabase.com/docs/guides/storage/s3/compatibility).

For AWS S3, omit `S3_ENDPOINT`, configure `S3_REGION`, and use AWS credentials or an IAM role. Allow the app's origin to perform browser `PUT` and `GET` requests with `content-type` in the bucket's [CORS settings](https://docs.aws.amazon.com/AmazonS3/latest/userguide/enabling-cors-examples.html). Keep public bucket access blocked. The server needs PutObject, GetObject, and HeadObject access, including server-side copies within the bucket.

Apply database migrations and configure these variables on the deployed web server. Supabase Storage can hold file bytes while the existing PostgreSQL connection holds the library's metadata and permissions; migrating the app's database is unnecessary.

## Access and editing

- Private: only the owner can read.
- Workspace: members can read; roles with record write permission can edit.
- Public: anyone with the public link can read. Authenticated workspace editors can edit.
- Specific people: selected current workspace members have viewer or editor access.
- Inherit: a nested item uses its folder's access.

Every parent folder must also be readable. Public links and direct downloads cannot bypass a restricted ancestor. Only owners can change sharing, move, or delete items. A folder move or delete requires access and ownership of its entire tree. Moving an inherited item to the root makes it private. Copies start private and belong to the person copying them.

Sharing an item with a workspace member does not grant access to its parent folders. Share those folders too when necessary. Public folders list only publicly readable children.

Markdown supports editing and a rendered preview. HTML is not executed, and embedded images render as links to avoid automatic requests to external servers. PDFs render inside the app with page navigation and accessible page text. PNG, JPEG, GIF, and WebP images have previews. Plain text and CSV files up to 1 MB render as literal text. DOCX documents and PPTX slides render inside a sandboxed preview with slide navigation. Slides fit their original proportions to the available width and viewport height. XLSX workbooks show worksheets, formatted cell text, and paginated rows and columns, with a cell address field to jump directly to a range. Office previews load on demand, accept files up to 32 MB, and reject oversized embedded archives. Scripts, macros, embedded HTML, and external resources are not executed. Complex Office layouts can differ from desktop Office. Original bytes remain available to download. Other binary formats show a clear preview availability message. The folder browser includes list, grid, and column views, an expandable folder sidebar, and native file and folder drops that preserve nested paths and empty folders. Uploading a folder at the root creates a fresh private folder, adding a numeric suffix when the name already exists. Uploads into an explicitly selected folder inherit that destination’s access.

Spreadsheet parsing runs in a dedicated worker, which terminates when the preview closes. Only a page of up to 100 rows and 30 columns crosses into the UI. The preview checks workbook structure before allocating the Excel model, accepting at most 200,000 populated cells, 200,000 row records, 100 worksheets, 200,000 shared strings, 10 million text characters, 2 million sheet positions summed across sheets, and 64 MB of expanded archive data. A 30-second loading deadline stops expensive parsing. Larger or malformed workbooks display an explanation while the original remains downloadable. Merged cells show individual cell text rather than merged layout, and formulas show their saved results without recalculation.

Uploads use ten-minute reservations. Finalization checks owner, destination access, and stored size, then copies bytes to a new immutable storage key. Reusing an upload URL cannot overwrite a finalized document. Downloads check current access and issue URLs that expire after sixty seconds. Revocation blocks new downloads immediately; an already-issued URL can remain usable until it expires.

Realtime messages carry only item IDs, with user scopes for current and former authorized readers. Clients fetch the changed item through an access check and patch cached folders. Names, sharing grants, document bodies, and storage keys never appear in event history. Large folders render a window of rows, and uploads run with at most three concurrent transfers.

Deleting an item removes its metadata and access immediately. Immutable stored blobs are retained because other copies may still reference them. Storage maintenance must remove only objects that no library entry references. Expired pending uploads can be cleaned separately; the application does not currently run storage garbage collection.

## Verification

```sh
bun run db:test-setup
bun run verify
bun run --filter '@gravity/web' test:e2e files.spec.ts files-native.spec.ts
```

Browser tests require the development servers and initialized storage. They cover persistent uploads and byte-identical downloads, Markdown edits, folder navigation, keyboard and drag transfers, and sharing revocation. Domain tests cover permission boundaries, workspace isolation, cycles, atomic tree operations, stale edits, and upload ownership.
