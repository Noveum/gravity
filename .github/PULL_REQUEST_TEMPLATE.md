<!-- Thanks for contributing. Reviewers read "What changes" and "How you know it works" first; keep those concrete. -->

## What changes

<!-- One or two sentences on the behaviour after this change. -->

Closes #

## How you know it works

<!-- The tests you added and the manual checks you ran. For data changes, include another organization, a restricted product member and a private conversation owner. -->

## Screenshots

<!-- UI changes: before and after, light and dark. Fictional data only. Delete if not visual. -->

## Checklist

- [ ] `bun run verify` passes (lint, licenses, types, tests, build, public smoke test)
- [ ] New behaviour has a test that fails without the change
- [ ] Business operations are defined in `packages/operations/catalog.ts`, so HTTP and MCP stay in step
- [ ] Interface strings are in `packages/i18n/translations/en.json`
- [ ] Migrations were generated with `bun run db:generate` and exercised locally (or none were needed)
- [ ] No real contacts, message bodies, credentials or uploaded files are included
- [ ] Docs updated if setup, configuration or behaviour changed

## Limitations

<!-- Anything unfinished, provider behaviour you could not test live, or trade-offs reviewers should know about. -->
