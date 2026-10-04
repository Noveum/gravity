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

`bun run import csv people.csv --workspace <slug> --as <email> --target people` dry runs an import; add `--commit` to write it. A column mapped to the source id needs `--source <name>`, such as `hubspot`, so ids from different files never match, and a stopped import prints the `--from-row <n>` that continues it. The same import runs in the app at `/import`: `O` chooses a file, `Cmd+Enter` previews and then imports, `Esc` steps back.

`bun run db:seed` creates a demo workspace of fictional companies (`--slug` and `--domain` change it, `--reuse` completes one the seed made earlier).

`bun run db:push` does not notice when a unique index loses its `where` clause. A dev
database created by push before migration 0004 keeps the old partial
`pipeline_org_key_unique` index, which lets an archived pipeline's key be reused. Apply
0004 to it once by hand, from the repository root:

    docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U gravity -d gravity < packages/db/drizzle/0004_productive_tarantula.sql

Migration 0006 adds `import_source`, whose foreign key to `person(id, organization_id)`
keeps every import link inside its workspace. On a push-only dev database `bun run db:push`
can stop at an interactive question about `activity_link`'s primary key before it reaches
that table. Answer it, or apply 0006 once by hand the same way:

    docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U gravity -d gravity < packages/db/drizzle/0006_slippery_nemesis.sql

A dev database that already has an `import_source` table without the
`import_source_person_fk` constraint was made from an earlier draft of 0006. Drop that
table first; it only holds the source id links of earlier imports, and those are lost.

Test databases need nothing: `bun run db:test-setup` recreates them, and a test lane that
is dropped and recreated is cloned from them, so both get the full index.

## License

Apache-2.0
