# Gravity

An open-source, realtime, keyboard-first CRM for teams that do a lot of outreach, with an MCP server for AI agents.

## Develop

    bun install
    cp .env.example .env
    bun run infra:up
    bun run db:push
    bun run db:test-setup
    bun run dev

The web app runs on http://localhost:3300 and the realtime socket on ws://localhost:3400.

`bun run import csv people.csv --workspace <slug> --as <email> --target people` dry runs an import; add `--commit` to write it. The same import runs in the app at `/import`: `O` chooses a file, `Cmd+Enter` previews and then imports, `Esc` steps back.

`bun run db:seed` creates a demo workspace of fictional companies (`--slug` and `--domain` change it, `--reuse` completes one the seed made earlier).

`bun run db:push` does not notice when a unique index loses its `where` clause. A dev
database created by push before migration 0004 keeps the old partial
`pipeline_org_key_unique` index, which lets an archived pipeline's key be reused. Apply
0004 to it once by hand, from the repository root:

    docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U gravity -d gravity < packages/db/drizzle/0004_productive_tarantula.sql

Test databases need nothing: `bun run db:test-setup` recreates them, and a test lane that
is dropped and recreated is cloned from them, so both get the full index.

## License

Apache-2.0
