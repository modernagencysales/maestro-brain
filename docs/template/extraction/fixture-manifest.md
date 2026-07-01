# Fixture Manifest

All fixtures in this template must be synthetic, redacted, or explicitly
approved. No fixture may contain private Maestro or customer material.

| Fixture Class                   | Owner Module                        | Source Path                                          | Export/Delete Coverage                           | Investor Demo Eligible | Rule                                                                 |
| ------------------------------- | ----------------------------------- | ---------------------------------------------------- | ------------------------------------------------ | ---------------------- | -------------------------------------------------------------------- |
| Fictional workspace             | `template-core`                     | `examples/generic-ai-ops/seed/workspace.json`        | Yes                                              | Yes                    | Use fake organization names and fake ids.                            |
| Fictional source links          | `packages/convex/confect/sources`   | `examples/generic-ai-ops/seed/sources.json`          | Yes                                              | Yes                    | Use example domains or fictional URLs.                               |
| Synthetic markdown notes        | `packages/convex/confect/brain`     | `examples/generic-ai-ops/seed/brain-pages.md`        | Yes                                              | Yes                    | No real client excerpts or launch copy.                              |
| Synthetic workflow run receipts | `packages/convex/confect/workflows` | `examples/generic-ai-ops/seed/workflow-runs.json`    | Yes                                              | Yes                    | Use fake capability names and fake timestamps.                       |
| Synthetic audit events          | `packages/convex/confect/admin`     | `examples/generic-ai-ops/seed/audit-events.json`     | Yes                                              | Yes                    | Include fake actor ids and no provider payloads.                     |
| Fake provider payloads          | `packages/integrations`             | `examples/generic-ai-ops/seed/providers/`            | No customer export; yes deletion where persisted | Yes                    | Must be visibly fake and signature-safe.                             |
| Fake billing and email events   | `packages/integrations`             | `examples/generic-ai-ops/seed/lifecycle-events.json` | Yes                                              | Yes                    | Use fake customer ids, fake emails, and fake plan names.             |
| Fake workflow graph examples    | `packages/workflow-ui`              | `examples/generic-ai-ops/seed/workflows.json`        | Yes                                              | Yes                    | Demonstrate graph mechanics without Maestro-specific business logic. |

## Approval Rules

- New fixture classes must add a row before the fixture is committed.
- Fixtures copied from any prior project must include an approval note in the
  commit body or a linked internal approval document.
- If a fixture is not safe for investor review, it must not live under
  `examples/` and must be excluded from demo seed scripts.
- Fixtures used by tests must still satisfy redaction rules; test-only is not a
  privacy exception.
