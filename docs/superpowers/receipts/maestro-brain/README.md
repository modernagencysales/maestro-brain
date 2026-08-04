# Maestro Brain V1 Evidence Checklist

**Audit date:** 2026-08-03  
**Audited code head:** `a10e4aca` **Verdict:** no-go; no hosted release evidence
is present.

## Local evidence

- Deterministic Markdown/JSON export encoding, lifecycle-fenced Convex export
  jobs, native temporary storage, fail-closed download checks, and focused
  cleanup tests are implemented. See `S12-T02.md`.
- The Brain workspace now has a selectable nested page tree, role-gated page
  actions, page move controls, revision history, explicit stale/lifecycle
  conflict messaging, revision/evidence status, restore-as-new-revision,
  BlockNote sync with edit-start revision fences, review queue listing, safe
  revision diff/citation surfaces, and a Settings export lifecycle surface.
- `staging-pilot-launch.md` is a historical no-go packet. Its old commit and
  queued-test wording are not evidence for this code head.

## REL-01 through REL-04

| Requirement                                                                                                 | Current evidence                                                                             | Required before acceptance                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REL-01 — frozen classification, citation, abstention, maintenance, multilingual, and prompt-injection evals | Harnesses exist; no current-head, version-pinned release receipt                             | Run the full frozen suites and record model/prompt versions, thresholds, fixture hashes, and failures                                                   |
| REL-02 — 25 clients / 100 channels / 100k revisions / burst and concurrency fairness                        | Capacity harness exists; no current-head receipt                                             | Run the declared fixture and record fair progress, loss/isolation, and no-tenant-bleed results                                                          |
| REL-03 — redacted observability, budgets, admission control, recovery, kill switches                        | Local budget fixture exists; hosted telemetry/alerts/recovery/kill-switch evidence is absent | Deploy the redacted metric path, exercise spend/rate/storage limits and overload controls, and attach audited recovery/kill-switch receipts             |
| REL-04 — staging, pilot value, rollback, and launch evidence                                                | No hosted staging, pilot, launch approval, or rollback drill is evidenced                    | Prove isolated staging with provider smokes, observe and approve the pilot, run promotion/rollback, and record the launch decision plus incident review |

## Remaining release gate

The product implementation is locally deployment-ready. Hosted acceptance still
requires the exact-head staging deployment, provider/eval/capacity/telemetry
receipts, pilot observation and approval, promotion, and rollback drill. No
hosted deployment, telemetry, capacity, pilot, or rollback claim should be added
until the corresponding receipt exists on the exact release head.
