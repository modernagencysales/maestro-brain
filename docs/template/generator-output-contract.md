# Generator Output Contract

Every `template:add-*` and `template:promote-*` command should produce a
reviewable slice, not a loose file. Generated work must preserve the layer law,
fake-first provider posture, Confect/Effect backend contracts, and headless
surface discipline.

## Required Output

For backend or headless behavior, emit or update:

- `template-instance.json` metadata when the command changes app identity,
  intake status, provider posture, release state, upgrade compatibility, or
  private-package posture.
- Confect spec/impl.
- Effect schema.
- typed errors.
- behavior tests.
- reviewer-safe fixtures.
- README or generated docs.
- headless registry entry when exposed.
- API, CLI, MCP, and OpenAPI/Scalar metadata when exposed.
- audit metadata.
- data-map metadata.
- env manifest entries when a provider or secret name is introduced.
- migration notes for durable table or index changes.
- reviewer commands.

For app-factory setup commands such as `template:quickstart` and
`template:intake`, also emit or update:

- generated implementation or intake briefs.
- provider posture notes with fake/test/live labels.
- first workflow, source inventory, approval, and Trust Receipt questions.
- handoff risks and next commands.

For user-facing behavior, also emit or update:

- frontend adapter or view model.
- loading, empty, ready/read, ready/edit, skipped, typed error, transport error,
  and mutation success/failure states where applicable.
- route or navigation metadata.
- screenshots or visual smoke notes when the rendered surface changes.

## Promotion Rules

- Runtime-authored capabilities and workflows are data until promoted.
- Promotion to generated Confect source is the compile-time safety path.
- Generated source must never import from `repos/*`.
- Generated client-specific logic stays under generated modules or
  `private-packages/<name>/` until reviewed.
- Provider SDKs stay behind Effect services and adapters.
- React Flow output is derived UI state only; durable workflow graphs use the
  workflow schema.

## Minimum Review Commands

- `pnpm check:generators`
- `pnpm check:confect-contracts`
- `pnpm check:workflow-graph-boundary`
- `pnpm check:schema-migration-notes` when durable data changes
- `pnpm check:secret-canaries`
- focused package tests for the generated slice
