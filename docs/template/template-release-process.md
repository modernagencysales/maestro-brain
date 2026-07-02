# Template Release Process

Client forks consume tagged template releases. Random file copying from template
`main` is not a supported upgrade path.

## Release Steps

1. Run focused tests for changed packages.
2. Run `pnpm review:readiness`.
3. Run `pnpm check:generators`, `pnpm check:confect-contracts`,
   `pnpm check:workflow-graph-boundary`, and security gates.
4. Build the web app and run static smoke.
5. Write release notes with changed packages, env changes, migrations, generated
   contract diffs, private-package compatibility, and rollback notes.
6. Run
   `pnpm --dir tooling/release exec tsx src/index.ts client-release <template-version> <client-version>`
   for any client fork being promoted from this release.
7. Tag the release.

## Client Upgrade

Use:

```bash
pnpm template:upgrade -- --from <client-version> --to <template-version>
pnpm --dir tooling/release exec tsx src/index.ts client-release <template-version> <client-version>
```

The report should identify changed packages, env var names, migration notes,
Confect/OpenAPI/CLI/MCP contract diffs, handoff artifacts, and manual review
items.

## Rollback

Keep rollback simple:

- restore the prior deployed artifact;
- restore the prior template tag in the client fork;
- revert generated contract changes only through reviewed commits;
- keep provider credential changes outside git.
