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

## License

Apache-2.0
