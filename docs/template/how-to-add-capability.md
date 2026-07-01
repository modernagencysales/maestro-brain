# How To Add A Capability

Dry-run a generated capability:

```bash
pnpm template:add-capability -- --name summarizeSource
```

Write the generated files:

```bash
pnpm template:add-capability -- --name summarizeSource --description "Summarizes an approved source set." --exposure headless --write
```

Promote reviewed files into production-target Confect paths:

```bash
pnpm template:promote-capability -- --name summarizeSource --description "Summarizes an approved source set." --write
```

## Files Created

- Confect-oriented capability spec and impl under
  `generated/capabilities/<name>/`.
- Typed args, returns, and errors.
- Capability headless metadata.
- Contract test scaffold.
- README with follow-up steps for moving into the owning Confect group.

The generator intentionally writes to `generated/` first. After review,
`template:promote-capability` writes production-target files under
`packages/convex/confect/capabilities/<name>/`. Add the promoted group to the
Confect spec tree, run `pnpm confect:codegen`, then wire generated refs into
web/API/CLI/MCP surfaces.

Future generator slices should add frontend adapters when user-facing and richer
fake fixtures once the capability owns provider side effects.

- Docs and audit metadata.

## Tests

- happy path;
- unauthenticated;
- role denial;
- cross-workspace denial;
- invalid input;
- typed error;
- idempotency;
- side-effect blocking before provider calls.

## Gates

- `pnpm --dir packages/convex test capabilities`
- `pnpm check:confect-contracts`
- `pnpm check:headless-surface-contract` when exposed.
