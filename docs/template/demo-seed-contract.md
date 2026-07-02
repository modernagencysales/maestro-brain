# Demo Seed Contract

`pnpm template:seed-demo -- --blueprint source-grounded-gtm-brain --write`
writes deterministic fake demo data to
`examples/demo-seed/source-grounded-gtm-brain/demo-seed.json`.

## Contract

- `blueprint`: the selected blueprint id.
- `workspaceSlug`: the instance slug used by fake-mode demos.
- `providerMode`: `fake`, `test`, or `live`.
- `users`: reviewer-safe synthetic users and roles.
- `sources`: reviewer-safe markdown, link, and note records.
- `contextPack`: the first source-backed context bundle.
- `capabilityFixtures`: deterministic args and expected returns.
- `workflowGraph`: durable graph metadata, not React Flow node arrays.
- `workflowRun`: the first workflow and capability ready to run.
- `trustReceipt`: evidence count and source-backed posture.
- `auditEvents`: synthetic audit trail for seed creation and run preview.
- `billingEvents`: fake usage or credit events when billing surfaces are
  enabled.

## Rules

- Seed data must be synthetic and reviewer-safe.
- Seed data must not contain customer names, credentials, private payloads, or
  real provider responses.
- The default Brain remains source-backed. Vector/RAG fixtures belong in an
  optional provider package, not the base seed.
- Generated seed files can be replaced by client-specific private packages after
  redaction review.
- Reset must be explicit. `template:seed-demo -- --reset --write` may delete and
  recreate only generated fake-mode seed artifacts for the selected blueprint.
