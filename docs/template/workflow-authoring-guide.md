# Workflow Authoring Guide

Workflows compose capabilities. They do not call provider SDKs, repos, or raw
Convex functions directly.

## Workflow Definition

Each workflow declares:

- id, name, description, version;
- durable graph nodes and edges;
- input and output schemas;
- capability refs;
- optional agent refs;
- policy snapshot;
- approval gates;
- idempotency and retry policy;
- audit and observability policy.

## React Flow Boundary

React Flow owns canvas interaction only: drag/drop, selection, viewport,
palette, draft commands, and visual validation hints. Durable graph schemas,
validation, and execution live outside React Flow packages.

## Verification

Focused workflow changes run:

```bash
pnpm --dir packages/workflow-ui test
pnpm --dir apps/web test src/features/workflows
pnpm --dir packages/convex test workflows
pnpm check:workflow-graph-boundary
```
