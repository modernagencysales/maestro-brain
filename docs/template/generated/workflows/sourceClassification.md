# SourceClassification Workflow

Generated sourceClassification workflow. Replace the source-to-receipt graph
after review.

## Generated Contract

- Exposure: `internal`
- Headless exposure: none; internal workflow controls do not emit API, CLI, MCP,
  OpenAPI, or headless descriptors.
- Web exposure: none; internal callers dispatch through reviewed capabilities or
  jobs.
- Authorization is inherited from the reviewed internal capability or job fence
  via a required system caller principal; generated controls never load ambient
  human Auth.

## Generated Files

- `packages/convex/convex/workflowRunners/sourceClassification.ts`: plain Convex
  `defineWorkflow` durable replay handler.
- `packages/convex/confect/workflowContracts/sourceClassification.spec.ts`:
  typed start, status, and approval contract.
- `packages/convex/confect/workflowContracts/sourceClassification.impl.ts`:
  Confect implementation that records workflow ownership and projects component
  status.
- `packages/convex/confect/workflows/sourceClassification.graph.ts`: durable
  classify, admin-review, mechanical-commit, and receipt graph data.
- `packages/convex/test/sourceClassification.workflow.test.ts`: focused proof
  that one proposal waits for review and produces one commit effect.

## Required Follow-Up

1. Add the generated Confect group to the workflow spec tree.
2. Run `pnpm --dir packages/convex exec convex codegen` after writing the
   generated files so `workflowRunners/sourceClassification:run` exists before
   typecheck. Run `pnpm confect:codegen` when validating the generated
   `workflowContracts.sourceClassification` public wrappers; if Confect sync
   removes `packages/convex/convex/workflowRunners/sourceClassification.ts`,
   rerun this generator before Convex codegen and typecheck.
3. Keep React Flow as a projection of `sourceClassification.graph.ts`; do not
   persist canvas node state as the workflow contract.
4. The approval event carries an admin/owner review command; confidence never
   advances the graph.
5. The runner maps the immutable request to `classifySourceUnit` and the
   reviewed proposal to the mechanical `commitSourceRoute` capability.
6. Run `pnpm check:workflow-graph-boundary`, `pnpm check:confect-contracts`, and
   focused workflow tests.
