# Rule Coverage

| Rule                                          | Coverage                                                             |
| --------------------------------------------- | -------------------------------------------------------------------- |
| Preserve layer law                            | Static gate: `check:layer-boundaries`; code review checklist.        |
| Use Confect/Effect contracts                  | Static gate: `check:confect-contracts`; generator invariant.         |
| Do not edit generated files                   | Static gate: `check:generated-files`; code review checklist.         |
| Keep React Flow out of durable workflow logic | Static gate: `check:workflow-graph-boundary`; code review checklist. |
| Use Notion Kit/block primitives               | Code review checklist; frontend tests after Task 9.                  |
| No caller-supplied tenant identity            | Static gate: `check:auth-demo-bypass`; security tests after Task 8.  |
| Keep provider SDKs behind adapters            | Code review checklist; integration tests after Task 14.              |
| Protect secrets and provider payloads         | Static gate: `check:secret-canaries`; secret scan.                   |
| Add focused tests for behavior                | Test suite and PR review checklist.                                  |
| Use generators for app-factory additions      | Static gate: `check:generators`; generator invariant after Task 16.  |
| Keep docs navigable                           | Static gate: `check:docs-freshness`.                                 |
| Keep CI complete                              | Static gate: `check:ci-completeness`; Buildkite phase-1.             |
