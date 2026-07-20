# SourceToBrainMaintenance Workflow

Gathers routed evidence and proposes cited Brain revisions.

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

- `packages/convex/convex/workflowRunners/sourceToBrainMaintenance.ts`: plain
  Convex `defineWorkflow` durable replay handler.
- `packages/convex/confect/workflowContracts/sourceToBrainMaintenance.spec.ts`:
  typed start, status, and approval contract.
- `packages/convex/confect/workflowContracts/sourceToBrainMaintenance.impl.ts`:
  Confect implementation that records workflow ownership and projects component
  status.
- `packages/convex/confect/workflows/sourceToBrainMaintenance.graph.ts`: durable
  graph data, initially source to Trust Receipt output only.
- `packages/convex/test/sourceToBrainMaintenance.workflow.test.ts`: focused
  runner scaffold for the default graph.

## Required Follow-Up

1. Add the generated Confect group to the workflow spec tree.
2. Run `pnpm --dir packages/convex exec convex codegen` after writing the
   generated files so `workflowRunners/sourceToBrainMaintenance:run` exists
   before typecheck. Run `pnpm confect:codegen` when validating the generated
   `workflowContracts.sourceToBrainMaintenance` public wrappers; if Confect sync
   removes `packages/convex/convex/workflowRunners/sourceToBrainMaintenance.ts`,
   rerun this generator before Convex codegen and typecheck.
3. Keep React Flow as a projection of `sourceToBrainMaintenance.graph.ts`; do
   not persist canvas node state as the workflow contract.
4. Generated approval nodes require the generated
   `workflowContracts.sourceToBrainMaintenance.approve` mutation before they are
   usable.
5. Generated capability nodes require registry entries with concrete `buildArgs`
   mappers for the target internal capability ref.
6. Run `pnpm check:workflow-graph-boundary`, `pnpm check:confect-contracts`, and
   focused workflow tests.
