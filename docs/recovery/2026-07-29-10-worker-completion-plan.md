# Maestro Brain Ten-Worker Completion Plan

Date: 2026-07-29  
Canonical branch: `main`  
Canonical repository: `modernagencysales/maestro-brain`  
Work graph: `docs/recovery/2026-07-29-10-worker-work-graph.json`

## Terminal outcome

Produce a feature-complete Maestro Brain candidate with the recovered work
integrated, the remaining product dependency chain implemented, exact-head gates
passing, and an honest staging/pilot/rollback packet. Launch approval,
production credentials, provider qualification, and the seven-day pilot
observation remain external decisions or elapsed-time gates; workers must never
invent those receipts.

The factory remains retired. This plan uses one manually owned queue, one
worktree per builder, one integration owner, and Agent Mail handoffs. It does
not recreate controller, proof-freshness, or automatic acceptance machinery.

## Operating rules

- Worker 01 alone updates canonical `main`, runs generated-file reconciliation,
  and pushes integration commits. Builders never merge one another.
- Workers 02-10 each use a separate worktree and branch. A worker may prepare
  downstream work early, but may call it only `candidate-ready` until every
  dependency in the graph is integrated.
- The shared schema/interface files are serialized. Worker 04 owns
  `sourceProcessingJobs.ts` and source-ledger tables; Worker 05 owns the job
  claim/workpool interface; Worker 06 owns lifecycle propagation; Worker 07 owns
  answer assembly/delivery; Worker 01 owns generated refs, root HTTP
  registration, root migration registration, route generation, and lockfiles.
  Other workers request narrow changes from those owners through Agent Mail.
- Every assignment uses its graph ID as the Agent Mail thread ID. Builders
  reserve exact paths, send `STARTED`, and finish with commit SHA, changed
  paths, focused test output, risks, and requested shared-interface changes.
- Use pnpm 10.12.1 exclusively. The safe command form is
  `npx -y pnpm@10.12.1 ...`; the host-global pnpm 9.15.4 is not valid here.
- Builders run focused tests. A task is not complete merely because its focused
  tests pass. Worker 01 runs `npx -y pnpm@10.12.1 exec just verify` on every
  integration wave and `npx -y pnpm@10.12.1 exec just verify-full` on
  release-candidate heads.
- Auto-assignment stays disabled. No wave shares one verdict: a defect in one
  candidate does not reject unrelated green candidates.

## Worker assignments

### Worker 01 — Integration captain

Own canonical `main`; do not implement a product lane.

1. Establish the green baseline and create/review the nine builder worktrees.
2. Integrate one intention at a time in graph order. Start with the independent
   recovered candidates, then the source spine, then downstream domains.
3. Own semantic reconciliation of generated Confect/Convex refs, root HTTP
   registration, root migration registration, route generation, lockfiles, and
   the shared `sourceProcessingJobs.ts` sequence handed off by Worker 04.
4. Run focused post-pick checks, then the full integration-wave gate. Reject
   only the defective candidate; keep unrelated candidates moving.
5. Maintain the exact-head readiness ledger and push every green integration
   commit to GitHub.

Required handoff for every promotion: source branch/commit, dependency heads,
diff summary, focused evidence, integration commit, full-gate output, and any
deferred finding.

### Worker 02 — Brain workspace, revisions, and review UX

Initial work: `MB-W02-BRAIN-RECOVERY`.

- Recover `S03-T03` from `bffa00c9`: responsive page tree, Brain workspace,
  BlockNote synchronization, and evidence drawer.
- Rebase it onto current `main`, prove its existing 3/3 review findings remain
  resolved, and hand it to Worker 01 without unrelated edits.

Next work: `MB-W02-REVISIONS` after Worker 04 lands the source ledger.

- Implement `S02-T03`: authorized revisions, citations, and real
  versioning/knowledge persistence.
- Implement `S03-T04`: history, diff, restore, citations, and review queue UX.
- Own Brain feature files. Workers 06-08 request narrow Brain UI changes rather
  than editing the same files concurrently.

### Worker 03 — Slack trust boundary and channel policy

Assignment: `MB-W03-SLACK-EDGE`.

- Implement `S04-T03`: signed Slack Events verification, replay protection,
  manifest/env contract, and verification before tenant resolution.
- Safety-review and recover fixed `S04-T04` from `f07e8661`: multi-channel
  routing and delivery policy. Confirm the tenant-key authorization repair
  against current code, then run the missing safety review.
- Own webhook and channel-policy contracts. Publish the verified event envelope
  consumed by Worker 04; do not implement normalization or source persistence.

### Worker 04 — Source ledger, capture, assembly, and routing

Initial work: `MB-W04-SOURCE-LEDGER`.

- Recover `S05-T01` from `d5efc88a` first.
- Own the migration registry, source ledger tables, source schemas, and the
  canonical shape of `sourceProcessingJobs.ts`.

Next work: `MB-W04-SOURCE-PIPELINE` after Worker 03 publishes the verified event
envelope.

- Implement `S05-T02` deterministic normalization, ordering, and atomic Slack
  capture.
- Implement `S05-T03` immutable bounded source-unit assembly.
- Implement `S05-T04` mechanical capture-only/direct routing.
- Reconcile downstream requests for source-job fields from Workers 05-08 in this
  lane, with one schema migration and one generated-ref update per wave.

### Worker 05 — Fenced jobs, scheduling, history, and recovery

Initial work: `MB-W05-WORKPOOL-RECOVERY`.

- Recover `S06-T01` from `02c3ee79` and rebase it after Worker 04's ledger.
- Preserve fencing, leases, idempotency, and terminal job-state semantics.

Next work: `MB-W05-SOURCE-OPERATIONS` after the complete S05 pipeline lands.

- Implement `S06-T02` fair priority pools and centralized Slack budgets.
- Implement `S06-T03` bounded recent/deep history backfill.
- Implement `S06-T04` reconciliation, dead-letter replay, and honest gap UX.
- Own workpool/job interfaces. Request source-job table changes from Worker 04.

### Worker 06 — Lifecycle, revocation, retention, and legal holds

Assignment: `MB-W06-LIFECYCLE`.

- Prepare lifecycle contracts and failing tests while S05/S06 integrate; do not
  claim completion against speculative schemas.
- Implement `S07-T01` shared lifecycle envelopes, policies, holds, and jobs.
- Implement `S07-T02` edit/delete propagation and emergency route revocation.
- Implement `S07-T03` retention, DSAR, purge, organization/Brain deletion, and
  backup policy.
- Implement `S07-T04` lifecycle health, holds, recovery, and redacted-citation
  surfaces.
- Publish the authoritative identity/membership/connection revoker interface
  required by Worker 08's `S10-T01` safety repair.

### Worker 07 — Cognition, maintenance, retrieval, and cited Ask

Initial candidate preparation: `MB-W07-COGNITION`.

- Recover `S08-T03` from `04e8205f` and preserve review-first, zero-or-one
  classification.
- Repair and recover `S08-T04` from `73a0d4d1`. Remove public caller-controlled
  workspace authority from `maintainBrainPage`; make it internal/workflow scoped
  or bind authorization entirely from server-derived context.
- These candidates may be prepared early but integrate only after lifecycle and
  source-job contracts are final.

Next work: `MB-W07-RETRIEVAL`.

- Implement `S09-T02` authorized workspace search projections.
- Implement `S09-T03` shared reads and immutable retrieval receipts.
- Implement `S09-T04` cited Ask with abstention and final reauthorization.
- Own answer assembly/delivery contracts. Worker 08 consumes them rather than
  duplicating answer logic in Slack.

### Worker 08 — Slack identity, private answers, outbox, and recovery UX

Assignment: `MB-W08-SLACK-ANSWERS`.

- Repair and recover `S10-T01` from `ae416ba6`. Wire its revokers to the actual
  membership suspension, user suspension, and connection replacement producers
  supplied by Worker 06; prove all three negative paths.
- Implement `S10-T02` mention/DM intake and authorized Brain scope selection.
- Implement `S10-T03` fenced outbox and requester-private delivery.
- Implement `S10-T04` linking, clarification, delivery, and recovery UX.
- Consume Worker 07's authorized Ask contract. Never make Slack channel
  membership equivalent to Brain read authority.

### Worker 09 — Bearer auth, API/MCP, and export

Initial work: `MB-W09-HEADLESS-AUTH`.

- Recover `S11-T02` from `789cacd4`: scoped bearer principals, API keys,
  pre-decode authorization, audit, and settings UI.

Next work: `MB-W09-HEADLESS-EXPORT` after retrieval and lifecycle stabilize.

- Implement `S11-T03` reviewed read/Ask registry and surface parity.
- Implement `S11-T04` stateless Streamable HTTP MCP and client configuration.
- Implement `S12-T02` authorized export jobs and temporary storage.
- Implement `S12-T03` export UI, audit history, expiry, and purge recovery.
- Keep external API/MCP read-only and one-Brain-scoped.

### Worker 10 — Capacity, operations, independent review, and release evidence

Initial candidate preparation: `MB-W10-OPS-CANDIDATES`.

- Rebase and inspect `S13-T02` from `efc6da66` and `S13-T03` from `9a372756`.
  They remain staged candidates until workpool, MCP, export, and runtime
  prerequisites are integrated.
- While waiting, perform read-only defect-first reviews of incoming candidates;
  send findings to the owning worker and never patch another worker's branch.

Final work: `MB-W10-OPS-RELEASE`.

- Implement `S13-T04` operations dashboard, alerts, and recovery drills.
- Assemble `S14-T01` staging, pilot, launch/no-go, and rollback evidence against
  one exact product head.
- Record missing credentials, provider receipts, security approval, pilot
  metrics, or elapsed observation as explicit external blockers. Never turn a
  missing receipt into a fabricated pass.

## Promotion waves

1. **Recovery frontier:** Workers 02, 03, 04, 09, and 10 prepare independent
   candidates; Worker 01 lands safe units individually. Worker 05 rebases its
   recovered workpool immediately after the ledger.
2. **Source spine:** Worker 03's verified webhook feeds Worker 04's S05 chain;
   Worker 05 then completes S06. This is the first serialized critical path.
3. **Knowledge and lifecycle:** Worker 02 completes revisions/history; Worker 06
   lands S07 against final source/job schemas.
4. **Cognition and retrieval:** Worker 07 lands repaired S08 and completes S09.
5. **Surfaces:** Workers 08 and 09 complete Slack answers, headless/MCP, and
   export in parallel once retrieval/lifecycle contracts are fixed.
6. **Operations and release:** Worker 10 lands the deferred operations
   candidates, S13-T04, and exact-head release evidence. Worker 01 runs the
   release-candidate full gate and pushes the candidate.

## Expected concurrency and timing

The initial merge-safe frontier is five builders plus the integrator, not ten
simultaneous writes to shared backend state. All ten panes still have useful
work through candidate rebasing, test construction, interface review, and
read-only review. Expected effective concurrency is four to seven workers.

- Recovered-candidate integration and bounded safety repairs: 1-2 days.
- Remaining feature implementation and integration: 4-8 additional days.
- Pilot-ready exact-head candidate: approximately 7-12 days.
- Pilot verdict: at least seven observation days after the candidate enters the
  frozen pilot, so approximately 2-3 weeks from swarm start if no material
  candidate reset occurs.

## Stop rules

- If a worker needs an owned shared file, it sends an interface request and
  continues elsewhere; it does not silently expand its reservation.
- Two failed integration attempts on the same candidate trigger a bounded
  human-readable defect review, not new orchestration tooling.
- A full-gate failure is assigned to the smallest owning candidate. Unrelated
  green commits remain integrated.
- Any cross-tenant, Slack-audience, lifecycle-revocation, API-key-scope, or
  unverified-webhook finding blocks that candidate immediately.
- No worker edits `repos/`, resurrects `tooling/brain-factory`, or adds new
  `.fabro` Brain workflows.
