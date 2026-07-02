# GTM Implementation Blueprint

Status: optional implemented blueprint pack.

Use `gtm-implementation` when a client wants a B2B go-to-market app that starts
from accounts, people, buying committee context, source-backed account briefs,
workflow-driven follow-up, and fake/test/live-ready connector seams.

## What It Generates

- Demo-safe seed fixtures under `examples/gtm-implementation/seed/`.
- A quickstart instance with `buildAccountBrief`, `gtmAccountResearch`, and
  `gtmImplementationPlanner`.
- Provider seam metadata for CRM, Drive, and Notion.
- Reporting surface stubs for account briefs, pipeline funnel, and activity
  board.

## Safety Posture

The blueprint is optional and does not change template core assumptions. It uses
`.example` domains, fake company names, fake people, and synthetic source notes.
Connector seams are descriptors until a client fork adds reviewed SDK-backed
adapters.

## Promotion Path

1. Generate the quickstart:
   `pnpm template:quickstart -- --blueprint gtm-implementation --name "GTM Brain" --write`.
2. Review generated provider seams and reporting surfaces.
3. Replace synthetic fixtures with reviewed client context.
4. Add client-specific tables only after data lifecycle, retention, and
   redaction posture are documented.
5. Promote capabilities/workflows through the existing Confect/Effect generator
   path after contract review.
