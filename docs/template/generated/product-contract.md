# Product Contract

Product: Maestro Brain (maestro-brain)

Workspace members maintain and query one cited company Brain through the canonical web shell, CLI, and public HTTP surfaces.

The links below are structural coverage only. Causal strength and declared-surface usefulness are `unproven` and review-owned. Current verification comes only from the exact-head `.maestro/verification-receipt.json`.

## @BHV-BRAIN-001-R1 A member reads the Brain through the complete Inbox screen

| Field | Value |
| --- | --- |
| Revision | 1 |
| Lifecycle | required |
| Surfaces | `web-ui` |
| Typed plan paths | `docs/product/saas-ui-alpha9-adoption-plan.md` |
| App Map targets | `route:$workspace/inbox`, `route:$workspace/inbox/$id`, `system:knowledge-brain`, `table:brainPages` |
| Acceptance file paths | `brain.spec.ts` |
## @BHV-BRAIN-002-R1 A revision-fenced Brain edit persists across surfaces

| Field | Value |
| --- | --- |
| Revision | 1 |
| Lifecycle | required |
| Surfaces | `cli-process`, `public-http`, `web-ui` |
| Typed plan paths | `docs/product/saas-ui-alpha9-adoption-plan.md` |
| App Map targets | `route:$workspace/inbox/$id`, `system:knowledge-brain`, `table:brainPages` |
| Acceptance file paths | `brain.spec.ts` |
## @BHV-BRAIN-003-R1 Ask Maestro returns the same cited company context everywhere

| Field | Value |
| --- | --- |
| Revision | 1 |
| Lifecycle | required |
| Surfaces | `cli-process`, `public-http`, `web-ui` |
| Typed plan paths | `docs/product/saas-ui-alpha9-adoption-plan.md` |
| App Map targets | `agent:assistant`, `capability:source-grounded-brief`, `route:$workspace/search`, `system:knowledge-brain` |
| Acceptance file paths | `brain.spec.ts` |
## @BHV-BRAIN-004-R1 A member manages sources through complete connection cards

| Field | Value |
| --- | --- |
| Revision | 1 |
| Lifecycle | draft |
| Surfaces | `web-ui` |
| Typed plan paths | `docs/product/saas-ui-alpha9-adoption-plan.md` |
| App Map targets | `route:$workspace/settings`, `system:provider-integrations` |
| Acceptance file paths | `brain.spec.ts` |
## @BHV-BRAIN-005-R1 Agency and client Brains remain visibly separated

| Field | Value |
| --- | --- |
| Revision | 1 |
| Lifecycle | draft |
| Surfaces | `web-ui` |
| Typed plan paths | `docs/product/saas-ui-alpha9-adoption-plan.md` |
| App Map targets | `route:$workspace/contacts/`, `route:$workspace/contacts/view/$id`, `system:access-and-tenancy`, `table:workspaces` |
| Acceptance file paths | — |
## @BHV-REC-001-R1 A web-created record appears in the CLI

| Field | Value |
| --- | --- |
| Revision | 1 |
| Lifecycle | required |
| Surfaces | `cli-process`, `web-ui` |
| Typed plan paths | `docs/product/records-plan.md` |
| App Map targets | `headless:records-api`, `route:$workspace/records` |
| Acceptance file paths | `records.spec.ts` |
## @BHV-REC-002-R1 A CLI-created record appears in the web app

| Field | Value |
| --- | --- |
| Revision | 1 |
| Lifecycle | required |
| Surfaces | `cli-process`, `web-ui` |
| Typed plan paths | `docs/product/records-plan.md` |
| App Map targets | `headless:records-api`, `route:$workspace/records` |
| Acceptance file paths | `records.spec.ts` |
## @BHV-REC-003-R1 A missing API key cannot create a record

| Field | Value |
| --- | --- |
| Revision | 1 |
| Lifecycle | required |
| Surfaces | `cli-process`, `web-ui` |
| Typed plan paths | `docs/product/records-plan.md` |
| App Map targets | `headless:records-api`, `route:$workspace/records` |
| Acceptance file paths | `records.spec.ts` |
## @BHV-REC-004-R1 A workspace-bound key cannot write to another workspace

| Field | Value |
| --- | --- |
| Revision | 1 |
| Lifecycle | required |
| Surfaces | `cli-process` |
| Typed plan paths | `docs/product/records-plan.md` |
| App Map targets | `headless:records-api`, `route:$workspace/records` |
| Acceptance file paths | `records.spec.ts` |
