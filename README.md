# Generated Maestro App

This is a customer application generated from an immutable Maestro release. Its
release, blueprint, and personalization facts live in `template-instance.json`.
Build the product in this repository. Do not run `maestro create` here and do
not copy files from a newer factory checkout.

## Start here

Requirements: Git and Node 22. The bootstrap check chooses a pinned Corepack or
npx pnpm command for the available host.

```bash
node scripts/maestro-bootstrap.mjs
corepack pnpm@10.12.1 install --frozen-lockfile
node maestro-template.mjs preflight --mode fake
node maestro-template.mjs recipes list
node maestro-template.mjs recipes show crud-business-entity
pnpm template:systems -- --query records
node maestro-template.mjs start --mode fake
```

If Corepack is unavailable, use the bootstrap report's exact
`npx --yes pnpm@10.12.1 install --frozen-lockfile` fallback.

The selected `records-example` pattern includes a workspace-owned record slice.
Open the URL printed after `/health` becomes ready, then exercise `/records`:
create a record, return to the list, and open its detail.

## The method

```text
preflight -> recipes/system lookup -> preview -> reviewed write
          -> focused verification -> commit reviewed change
          -> start --mode fake
```

Preview is the default. Before adding a subsystem or table, query the canonical
owner. A recipe write must use the exact confirmation command returned by the
preview; it rechecks the plan and clean-preflight fingerprints and retains a
receipt under `.maestro/recipe-transactions/`.

After the focused gates pass, review and commit the recipe transaction before
starting. Preflight intentionally requires a clean target so generated drift
cannot be mistaken for the app you reviewed.

```bash
git status --short
git add .
git commit -m "feat: add reviewed Maestro change"
pnpm maestro -- start --mode fake
```

For the copy/paste CRUD walkthrough, use
[Template Quickstart](./docs/template/quickstart.md). The broader method is in
[App Factory Guide](./docs/template/app-factory-guide.md), and recipe safety is
documented in
[Executable Outcome Recipes](./docs/template/executable-recipes.md).

For repository ownership and review, use the
[Repository Map](./docs/template/repo-map.md),
[Reviewer Guide](./docs/template/reviewer-guide.md), and
[Delivery Receipts](./docs/template/delivery-receipts.md).

## Guidance for agents

Start with [AGENTS.md](./AGENTS.md). Keep the shared Saas UI shell and customize
through blocks, tokens, feature adapters, generated routes, view models, and
typed contracts. Do not hand-edit generated Confect, Convex, or route-tree
files, invent parallel ownership, or weaken a failing gate.

The browser and headless surfaces share one implementation path:

```text
API/CLI/MCP -> headless registry -> same capabilities/workflows as web
```

Add behavior to the typed capability or workflow once, then project it through
the supported web, API, CLI, or MCP adapter. Do not create a second business
implementation for a headless surface.

## Before sharing

Run the focused commands printed by each successful write. At minimum:

```bash
pnpm check:format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check:system-catalog
pnpm check:system-topology
pnpm check:data-resources
```

Use `pnpm verify` for the exhaustive handoff gate. Fake mode requires no live
provider credentials and must not contain production or customer data.
