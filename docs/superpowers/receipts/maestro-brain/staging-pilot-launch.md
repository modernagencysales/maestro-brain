# Maestro Brain V1 Release Evidence

Date: 2026-08-03  
Product release commit: `28e4965c55fbb394b2e8053a2ffb5ec884244202`  
Attestation scope: deterministic export artifact/job support only

## Local evidence

| Area                    | Evidence                                                                                                                                  | Status                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Deterministic export    | `packages/template-core/src/brainExport.ts` plus `brainExportJob.ts`; stable file ordering, hashes, byte size, lifecycle-generation fence | implemented; focused test queued |
| Type safety             | `pnpm --dir packages/template-core typecheck`                                                                                             | pass                             |
| Semantic/security eval  | Existing frozen harness in `tooling/evals`; no fresh run in this checkpoint                                                               | not reverified                   |
| Capacity/fairness       | Existing deterministic harness in `tooling/evals/src/brain-capacity.ts`; no fresh run in this checkpoint                                  | not reverified                   |
| Telemetry/kill switches | Existing operation-policy surface is present, but redacted Brain metric implementation is not complete in this branch                     | gap                              |
| Rollback                | Export job revokes on lifecycle-generation mismatch; no hosted deploy rollback drill was run                                              | local fence only                 |

## Verification limitations

The focused Vitest command was blocked by `host-test-slot`: host load remained
above the configured threshold (`15.39`–`22.84`, threshold `10.00`). The
existing dirty branch also has unrelated `git diff --check` failures at EOF in
`packages/convex/confect/capabilities/classifySourceUnit.impl.ts` and
`packages/convex/confect/jobs/workpool.ts`.

## Release verdict

`no-go`. This packet is local implementation evidence, not staging, pilot, or
production approval. V1 remains blocked on durable authorized export storage,
lifecycle/retrieval/API transport integration, fresh eval/capacity/telemetry
receipts, hosted rollback rehearsal, and pilot observation/approval.
