# Apero Company Brain Rollback Runbook

This is a forward rollback for the currently deployed schema and manifest. Do
not deploy a pre-schema binary, delete projection rows, reset connector cursors,
or discard durable required-scope intents.

## Evidence to record

For every rehearsal or live rollback, record the exact deployment SHA, workspace
and Brain keys, affected connector-scope keys, initial and final
`brain.rollout.status` payloads, pause epochs, lease-drain results, read-mode
generation, rollback result, typed endpoint result, recovery result, operator,
reason, and timestamps. Store the sanitized rehearsal at
`docs/superpowers/receipts/maestro-brain/company-brain/<deployment-sha>/read-switch-rollback.md`.
The durable runtime evidence remains in `brainReadModes`,
`brainProjectionValidationReceipts`, `brainPublicationPauses`,
`brainPublicationWorkerLeases`, and `brainOperationReceipts`.

## Read-switch rollback

1. Pin the currently deployed SHA and fetch `brain.rollout.status`. Record the
   read-mode generation and every required connector scope.
2. Call `pausePublicationWorkers` for every required scope with a unique stable
   operation key and the incident or rehearsal reason. Record each returned
   pause epoch.
3. Call `drainPublicationWorkerLeases` for each scope and epoch until
   `activeLeaseCount` is zero. Confirm with `getPublicationWorkerLeaseStatus`.
   Do not proceed while any lease is active.
4. Fetch rollout status again. Preserve all blocker and alert identifiers; do
   not treat the expected `workers_paused` blocker as a new data failure.
5. Call `rollbackBrainReadMode` with the exact current mode generation. The
   current release deliberately selects `disabled` because equivalence between
   the compatibility reader and all projection lifecycle/origin fences is not
   proven.
6. Verify Search, Source Get, ContextPack, Ask, HTTP, CLI, and MCP all return
   the typed unavailable state. None may fall through to legacy evidence.
7. Restore the prior approved Ask Apero team workflow and record that handoff in
   the rehearsal receipt. Leave source ledgers, projections, cursors, intents,
   and receipts intact.

## One-connector rollback

1. Perform the pause and lease-drain steps only for the affected connector
   scope.
2. Stop that connector's fetch/reconciliation runner without deleting its cursor
   or required intent. Do not use required-scope decommission for an outage or
   suspected corruption.
3. Run `brain.rollout.status`; the affected scope must remain present and
   blocked while healthy sibling scopes retain their own status.
4. If projection reads cannot safely omit the affected required scope, perform
   the read-switch rollback above. Otherwise keep answering behavior in its
   explicit partial/abstaining state.
5. After repair, replay the persisted page/ledger, consume any bounded repair
   effects, close removal and derived-drain obligations, complete
   reconciliation, and confirm the scope is current and ready.
6. Resume workers with the exact pause epoch. An old claimant must remain
   fenced. Revalidate projection readiness before any later promotion.

## Full-pilot rollback

1. Freeze new pilot sessions and record the incident start time.
2. Pause and drain every required scope, then execute read-switch rollback.
3. Confirm every external Brain surface is typed unavailable and restore the
   previous approved company-context workflow for the team.
4. Preserve all connector and Brain data. Export sanitized status, alert, and
   receipt identifiers for diagnosis; never place source bodies in the receipt.
5. Repair and reconcile one connector at a time. Require zero dead letters,
   quarantine, nonterminal obligations, unresolved repair effects, capacity or
   integrity failures, and derived-drain backlog before revalidation.
6. Run `validateBrainProjectionReadiness` on the exact deployed SHA, consume
   that receipt once with `switchBrainReadMode`, verify all read surfaces, then
   resume the pilot.

## Rehearsal acceptance

A rehearsal passes only when it proves pause-epoch fencing, zero active leases,
the compare-and-set rollback, typed unavailability on every read surface,
preserved cursors/intents/history, recovery reconciliation, a new single-use
validation receipt, and successful re-promotion. A prose walkthrough is not a
rehearsal receipt.
