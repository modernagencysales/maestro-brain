# How To Add A Private Package

Generator after Task 16:

```bash
pnpm template:private-package:dry-run -- --fixture examples/generic-ai-ops
pnpm template:private-package:import -- --fixture examples/generic-ai-ops
```

## Files Created

Private package imports may add workflows, capabilities, agents,
transformations, source types, blocks, prompts, fixtures, docs, and tests.

## Tests

- dry-run diff;
- fixture redaction;
- generated Confect validity;
- data-map metadata;
- migration notes;
- focused package tests.

## Gates

- `pnpm template:private-package:dry-run -- --fixture <path>`
- `pnpm check:confect-contracts`
- `pnpm check:schema-migration-notes`
- `pnpm check:secret-canaries`
