import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import {
  ContentHash,
  NonNegativeInteger,
  PositiveInteger,
} from "../brain/retrievalSchemas";

const NonNegativeNumber = Schema.Number.pipe(Schema.greaterThanOrEqualTo(0));
const NullableCursor = Schema.NullOr(Schema.String);
const ReconciliationRunStatus = Schema.Literal(
  "scan",
  "traversal_closed",
  "apply_removals",
  "drain_derived",
  "complete",
  "superseded",
  "blocked",
);
const ObligationState = Schema.Literal(
  "captured",
  "normalization_pending",
  "quarantined",
  "target_resolution_pending",
  "capacity_blocked",
  "publication_pending",
  "retry_wait",
  "removal_pending",
  "drain_pending",
  "complete",
  "policy_excluded",
  "failed",
);
const Authority = Schema.Struct({
  organizationKey: Schema.String,
  workspaceId: Id("workspaces"),
  brainKey: Schema.String,
  corpusKey: Schema.Literal("slack", "transcripts"),
  providerKind: Schema.Literal("slack", "transcript"),
  connectorScopeKey: Schema.String,
  connectionKey: Schema.String,
  connectionGeneration: PositiveInteger,
  allowlistGeneration: PositiveInteger,
});
const RunRef = Schema.Struct({
  reconciliationRunKey: Schema.String,
  expectedRunGeneration: PositiveInteger,
  expectedConnectionGeneration: PositiveInteger,
  expectedAllowlistGeneration: PositiveInteger,
});
const PageChunkDescriptor = Schema.Struct({
  chunkIndex: NonNegativeInteger,
  chunkDigest: ContentHash,
  observationCount: NonNegativeInteger,
});
const ProviderObservation = Schema.Struct({
  organizationKey: Schema.String,
  connectionKey: Schema.String,
  connectionGeneration: PositiveInteger,
  membershipKey: Schema.String,
  providerObjectKey: Schema.String,
  originKind: Schema.Literal("slack", "transcript"),
  originKey: Schema.String,
  originRevisionKey: Schema.String,
  ledgerSequence: NonNegativeNumber,
  observationDigest: ContentHash,
});
const RemovalCandidate = Schema.Struct({
  membershipKey: Schema.String,
  originKind: Schema.Literal("slack", "transcript"),
  originKey: Schema.String,
  originRevisionKey: Schema.String,
  ledgerSequence: NonNegativeNumber,
});

export class ProviderReconciliationNotFound extends Schema.TaggedError<ProviderReconciliationNotFound>()(
  "ProviderReconciliationNotFound",
  { resource: Schema.String, key: Schema.String },
) {}

export class ProviderReconciliationConflict extends Schema.TaggedError<ProviderReconciliationConflict>()(
  "ProviderReconciliationConflict",
  {
    reason: Schema.Literal(
      "cursor_conflict",
      "page_conflict",
      "chunk_conflict",
      "run_superseded",
      "scope_tuple_changed",
      "phase_conflict",
      "traversal_incomplete",
      "removal_incomplete",
      "drain_incomplete",
      "obligation_blocked",
      "required_intent_stale",
      "capacity_exceeded",
    ),
    detail: Schema.String,
  },
) {}

const errors = () =>
  Schema.Union(ProviderReconciliationNotFound, ProviderReconciliationConflict);

const upsertRequiredScopeIntent = FunctionSpec.internalMutation({
  name: "upsertRequiredScopeIntent",
  args: () =>
    Schema.extend(
      Authority,
      Schema.Struct({
        expectedIntentGeneration: NonNegativeInteger,
        controllingConfigurationDigest: ContentHash,
        now: NonNegativeInteger,
      }),
    ),
  returns: () =>
    Schema.Struct({
      requiredScopeIntentKey: Schema.String,
      intentGeneration: PositiveInteger,
      state: Schema.Literal("required"),
    }),
  error: errors,
});

const openReconciliationRun = FunctionSpec.internalMutation({
  name: "openReconciliationRun",
  args: () =>
    Schema.extend(
      Authority,
      Schema.Struct({
        expectedPreviousRunGeneration: NonNegativeInteger,
        initialCursor: NullableCursor,
        providerHighWater: Schema.NullOr(Schema.String),
        ledgerHighWater: NonNegativeNumber,
        leaseId: Schema.String,
        leaseGeneration: PositiveInteger,
        leaseExpiresAt: NonNegativeInteger,
        now: NonNegativeInteger,
      }),
    ),
  returns: () =>
    Schema.Struct({
      reconciliationRunKey: Schema.String,
      runGeneration: PositiveInteger,
      cursorKey: Schema.String,
      status: ReconciliationRunStatus,
    }),
  error: errors,
});

const beginReconciliationPage = FunctionSpec.internalMutation({
  name: "beginReconciliationPage",
  args: () =>
    Schema.extend(
      RunRef,
      Schema.Struct({
        cursorKey: Schema.String,
        expectedCursor: NullableCursor,
        expectedCursorGeneration: PositiveInteger,
        nextCursor: NullableCursor,
        providerHighWater: Schema.NullOr(Schema.String),
        ledgerHighWater: NonNegativeNumber,
        chunks: Schema.Array(PageChunkDescriptor).pipe(
          Schema.minItems(1),
          Schema.maxItems(64),
        ),
        now: NonNegativeInteger,
      }),
    ),
  returns: () =>
    Schema.Struct({
      pageEnvelopeKey: Schema.String,
      pageDigest: ContentHash,
      totalChunkCount: PositiveInteger,
    }),
  error: errors,
});

const commitReconciliationPageChunk = FunctionSpec.internalMutation({
  name: "commitReconciliationPageChunk",
  args: () =>
    Schema.Struct({
      pageEnvelopeKey: Schema.String,
      chunkIndex: NonNegativeInteger,
      chunkDigest: ContentHash,
      requiredScopeIntentKey: Schema.String,
      observations: Schema.Array(ProviderObservation).pipe(
        Schema.maxItems(100),
      ),
      now: NonNegativeInteger,
    }),
  returns: () =>
    Schema.Struct({
      pageChunkKey: Schema.String,
      observationCount: NonNegativeInteger,
      seenCount: NonNegativeInteger,
      obligationCount: NonNegativeInteger,
      duplicate: Schema.Boolean,
    }),
  error: errors,
});

const finalizeReconciliationPage = FunctionSpec.internalMutation({
  name: "finalizeReconciliationPage",
  args: () =>
    Schema.Struct({
      pageEnvelopeKey: Schema.String,
      cursorKey: Schema.String,
      now: NonNegativeInteger,
    }),
  returns: () =>
    Schema.Struct({
      providerCursor: NullableCursor,
      cursorGeneration: PositiveInteger,
      ledgerHighWater: NonNegativeNumber,
    }),
  error: errors,
});

const closeReconciliationTraversal = FunctionSpec.internalMutation({
  name: "closeReconciliationTraversal",
  args: () => Schema.extend(RunRef, Schema.Struct({ now: NonNegativeInteger })),
  returns: () =>
    Schema.Struct({
      reconciliationRunKey: Schema.String,
      status: Schema.Literal("traversal_closed"),
    }),
  error: errors,
});

const applyReconciliationRemovalBatch = FunctionSpec.internalMutation({
  name: "applyReconciliationRemovalBatch",
  args: () =>
    Schema.extend(
      RunRef,
      Schema.Struct({
        requiredScopeIntentKey: Schema.String,
        expectedRemovalCursor: NullableCursor,
        nextRemovalCursor: NullableCursor,
        finalBatch: Schema.Boolean,
        candidates: Schema.Array(RemovalCandidate).pipe(Schema.maxItems(100)),
        now: NonNegativeInteger,
      }),
    ),
  returns: () =>
    Schema.Struct({
      reconciliationRunKey: Schema.String,
      status: ReconciliationRunStatus,
      candidateCount: NonNegativeInteger,
      removalCount: NonNegativeInteger,
      removalCursor: NullableCursor,
    }),
  error: errors,
});

const transitionIngestionObligation = FunctionSpec.internalMutation({
  name: "transitionIngestionObligation",
  args: () =>
    Schema.Struct({
      ingestionObligationKey: Schema.String,
      expectedState: ObligationState,
      nextState: ObligationState,
      targetResolutionIntentKey: Schema.NullOr(Schema.String),
      publicationJobKeys: Schema.Array(Schema.String).pipe(
        Schema.maxItems(100),
      ),
      errorTag: Schema.NullOr(Schema.String),
      now: NonNegativeInteger,
    }),
  returns: () =>
    Schema.Struct({
      ingestionObligationKey: Schema.String,
      state: ObligationState,
      terminal: Schema.Boolean,
    }),
  error: errors,
});

const completeReconciliationRun = FunctionSpec.internalMutation({
  name: "completeReconciliationRun",
  args: () => Schema.extend(RunRef, Schema.Struct({ now: NonNegativeInteger })),
  returns: () =>
    Schema.Struct({
      reconciliationRunKey: Schema.String,
      status: Schema.Literal("complete"),
      receiptDigest: ContentHash,
      successfulObligationCount: NonNegativeInteger,
    }),
  error: errors,
});

export default GroupSpec.make()
  .addFunction(upsertRequiredScopeIntent)
  .addFunction(openReconciliationRun)
  .addFunction(beginReconciliationPage)
  .addFunction(commitReconciliationPageChunk)
  .addFunction(finalizeReconciliationPage)
  .addFunction(closeReconciliationTraversal)
  .addFunction(applyReconciliationRemovalBatch)
  .addFunction(transitionIngestionObligation)
  .addFunction(completeReconciliationRun);
