import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import {
  ContentHash,
  NonNegativeInteger,
  PositiveInteger,
} from "../brain/retrievalSchemas";
import {
  DriveIngestionReceiptSchema,
  PreparedDriveReconciliationPage,
} from "./driveLedgerSchemas";
import { PreparedSlackReconciliationPage } from "./slackReconciliationAdapter";
import { PreparedTranscriptReconciliationPage } from "./transcriptReconciliationAdapter";

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
const Authority = Schema.Struct({
  organizationKey: Schema.String,
  workspaceId: Id("workspaces"),
  brainKey: Schema.String,
  corpusKey: Schema.Literal("slack", "transcripts", "documents"),
  providerKind: Schema.Literal("slack", "transcript", "google_drive"),
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
const LeasedRunRef = Schema.extend(
  RunRef,
  Schema.Struct({
    expectedLeaseGeneration: PositiveInteger,
    leaseId: Schema.String,
  }),
);
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
  originKind: Schema.Literal("slack", "transcript", "document"),
  originKey: Schema.String,
  originRevisionKey: Schema.String,
  ledgerSequence: NonNegativeNumber,
  observationDigest: ContentHash,
  obligationCause: Schema.optional(Schema.Literal("observation", "removal")),
  initialObligationState: Schema.optional(
    Schema.Literal("captured", "quarantined", "removal_pending"),
  ),
});
const RemovalCandidate = Schema.Struct({
  membershipKey: Schema.String,
  providerObjectKey: Schema.String,
  originKind: Schema.Literal("slack", "transcript", "document"),
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
      "lease_lost",
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
  error: () => errors(),
});

const activateRequiredScope = FunctionSpec.internalMutation({
  name: "activateRequiredScope",
  args: () =>
    Schema.extend(
      Authority,
      Schema.Struct({
        providerContainerKey: Schema.String,
        activationKind: Schema.Literal("activate", "restore"),
        expectedScopeGeneration: NonNegativeInteger,
        expectedIntentGeneration: NonNegativeInteger,
        controllingConfigurationDigest: ContentHash,
        now: NonNegativeInteger,
      }),
    ),
  returns: () =>
    Schema.Struct({
      connectorScopeKey: Schema.String,
      scopeGeneration: PositiveInteger,
      requiredScopeIntentKey: Schema.String,
      intentGeneration: PositiveInteger,
      state: Schema.Literal("required"),
    }),
  error: () => errors(),
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
  error: () => errors(),
});

const getReconciliationStartContext = FunctionSpec.internalQuery({
  name: "getReconciliationStartContext",
  args: () => Schema.Struct({ connectorScopeKey: Schema.String }),
  returns: () =>
    Schema.extend(
      Authority,
      Schema.Struct({
        requiredScopeIntentKey: Schema.String,
        expectedPreviousRunGeneration: NonNegativeInteger,
        providerContainerKey: Schema.String,
        providerConfigKey: Schema.String,
        nangoConnectionId: Schema.String,
        currentRun: Schema.NullOr(
          Schema.Struct({
            reconciliationRunKey: Schema.String,
            runGeneration: PositiveInteger,
            status: ReconciliationRunStatus,
            providerHighWater: Schema.NullOr(Schema.String),
            leaseId: Schema.String,
            leaseGeneration: PositiveInteger,
          }),
        ),
      }),
    ),
  error: () => errors(),
});

const claimReconciliationStep = FunctionSpec.internalMutation({
  name: "claimReconciliationStep",
  args: () =>
    Schema.extend(
      RunRef,
      Schema.Struct({
        expectedLeaseGeneration: NonNegativeInteger,
        leaseId: Schema.String,
        leaseDurationMs: Schema.Number.pipe(
          Schema.int(),
          Schema.greaterThanOrEqualTo(1),
          Schema.lessThanOrEqualTo(300_000),
        ),
        now: NonNegativeInteger,
      }),
    ),
  returns: () =>
    Schema.extend(
      Authority,
      Schema.Struct({
        requiredScopeIntentKey: Schema.String,
        reconciliationRunKey: Schema.String,
        runGeneration: PositiveInteger,
        status: ReconciliationRunStatus,
        cursorKey: Schema.String,
        providerCursor: NullableCursor,
        removalCursor: NullableCursor,
        traversalComplete: Schema.Boolean,
        cursorGeneration: PositiveInteger,
        providerHighWater: Schema.NullOr(Schema.String),
        ledgerHighWater: NonNegativeNumber,
        leaseId: Schema.String,
        leaseGeneration: PositiveInteger,
        leaseExpiresAt: NonNegativeInteger,
        providerContainerKey: Schema.String,
        providerConfigKey: Schema.String,
        nangoConnectionId: Schema.String,
        teamId: Schema.NullOr(Schema.String),
        apiAppId: Schema.NullOr(Schema.String),
        botUserId: Schema.NullOr(Schema.String),
        routingPolicyEpoch: PositiveInteger,
      }),
    ),
  error: () => errors(),
});

const DriveScopeConfiguration = Schema.Struct({
  configurationGeneration: PositiveInteger,
  driveId: Schema.String,
  rootFolderIds: Schema.Array(Schema.String).pipe(
    Schema.minItems(1),
    Schema.maxItems(100),
  ),
  sharedDrive: Schema.Boolean,
  retentionClass: Schema.String,
  permissionPolicyDigest: ContentHash,
  configurationDigest: ContentHash,
});

const upsertDriveScopeConfiguration = FunctionSpec.internalMutation({
  name: "upsertDriveScopeConfiguration",
  args: () =>
    Schema.extend(
      Authority,
      Schema.Struct({
        expectedConfigurationGeneration: NonNegativeInteger,
        driveId: Schema.String,
        rootFolderIds: Schema.Array(Schema.String).pipe(
          Schema.minItems(1),
          Schema.maxItems(100),
        ),
        sharedDrive: Schema.Boolean,
        retentionClass: Schema.String,
        permissionPolicyDigest: ContentHash,
        now: NonNegativeInteger,
      }),
    ),
  returns: () => DriveScopeConfiguration,
  error: () => errors(),
});

const getDriveScopeConfiguration = FunctionSpec.internalQuery({
  name: "getDriveScopeConfiguration",
  args: () => RunRef,
  returns: () => Schema.NullOr(DriveScopeConfiguration),
  error: () => errors(),
});

const getDriveScopeConfigurationForStart = FunctionSpec.internalQuery({
  name: "getDriveScopeConfigurationForStart",
  args: () =>
    Schema.Struct({
      connectorScopeKey: Schema.String,
      connectionGeneration: PositiveInteger,
      allowlistGeneration: PositiveInteger,
    }),
  returns: () => Schema.NullOr(DriveScopeConfiguration),
  error: () => errors(),
});

const beginReconciliationPage = FunctionSpec.internalMutation({
  name: "beginReconciliationPage",
  args: () =>
    Schema.extend(
      LeasedRunRef,
      Schema.Struct({
        cursorKey: Schema.String,
        expectedCursor: NullableCursor,
        expectedCursorGeneration: PositiveInteger,
        nextCursor: NullableCursor,
        traversalComplete: Schema.Boolean,
        providerHighWater: Schema.NullOr(Schema.String),
        ledgerHighWater: NonNegativeNumber,
        chunks: Schema.Array(PageChunkDescriptor).pipe(
          Schema.minItems(1),
          Schema.maxItems(64),
        ),
        preparedDrivePage: Schema.optional(PreparedDriveReconciliationPage),
        preparedSlackPage: Schema.optional(PreparedSlackReconciliationPage),
        preparedTranscriptPage: Schema.optional(
          PreparedTranscriptReconciliationPage,
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
  error: () => errors(),
});

const commitReconciliationPageChunk = FunctionSpec.internalMutation({
  name: "commitReconciliationPageChunk",
  args: () =>
    Schema.extend(
      LeasedRunRef,
      Schema.Struct({
        pageEnvelopeKey: Schema.String,
        chunkIndex: NonNegativeInteger,
        chunkDigest: ContentHash,
        requiredScopeIntentKey: Schema.String,
        observations: Schema.Array(ProviderObservation).pipe(
          Schema.maxItems(100),
        ),
        driveChunk: Schema.optional(Schema.Boolean),
        sourceChunk: Schema.optional(
          Schema.Literal("slack", "transcript", "google_drive"),
        ),
        now: NonNegativeInteger,
      }),
    ),
  returns: () =>
    Schema.Struct({
      pageChunkKey: Schema.String,
      observationCount: NonNegativeInteger,
      seenCount: NonNegativeInteger,
      obligationCount: NonNegativeInteger,
      duplicate: Schema.Boolean,
      driveReceipts: Schema.optional(
        Schema.Array(DriveIngestionReceiptSchema).pipe(Schema.maxItems(100)),
      ),
    }),
  error: () => errors(),
});

const finalizeReconciliationPage = FunctionSpec.internalMutation({
  name: "finalizeReconciliationPage",
  args: () =>
    Schema.extend(
      LeasedRunRef,
      Schema.Struct({
        pageEnvelopeKey: Schema.String,
        cursorKey: Schema.String,
        now: NonNegativeInteger,
      }),
    ),
  returns: () =>
    Schema.Struct({
      providerCursor: NullableCursor,
      traversalComplete: Schema.Boolean,
      cursorGeneration: PositiveInteger,
      ledgerHighWater: NonNegativeNumber,
    }),
  error: () => errors(),
});

const closeReconciliationTraversal = FunctionSpec.internalMutation({
  name: "closeReconciliationTraversal",
  args: () =>
    Schema.extend(LeasedRunRef, Schema.Struct({ now: NonNegativeInteger })),
  returns: () =>
    Schema.Struct({
      reconciliationRunKey: Schema.String,
      status: Schema.Literal("traversal_closed"),
    }),
  error: () => errors(),
});

const applyReconciliationRemovalBatch = FunctionSpec.internalMutation({
  name: "applyReconciliationRemovalBatch",
  args: () =>
    Schema.extend(
      LeasedRunRef,
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
  error: () => errors(),
});

const completeReconciliationRun = FunctionSpec.internalMutation({
  name: "completeReconciliationRun",
  args: () =>
    Schema.extend(LeasedRunRef, Schema.Struct({ now: NonNegativeInteger })),
  returns: () =>
    Schema.Struct({
      reconciliationRunKey: Schema.String,
      status: Schema.Literal("complete"),
      receiptDigest: ContentHash,
      successfulObligationCount: NonNegativeInteger,
    }),
  error: () => errors(),
});

const maybeCompleteReconciliationRun = FunctionSpec.internalMutation({
  name: "maybeCompleteReconciliationRun",
  args: () =>
    Schema.extend(LeasedRunRef, Schema.Struct({ now: NonNegativeInteger })),
  returns: () =>
    Schema.Struct({
      reconciliationRunKey: Schema.String,
      status: Schema.Literal("complete", "pending", "superseded"),
      receiptDigest: Schema.NullOr(ContentHash),
    }),
  error: () => errors(),
});

const recoverReconciliationRuns = FunctionSpec.internalMutation({
  name: "recoverReconciliationRuns",
  args: () =>
    Schema.Struct({
      limit: Schema.Number.pipe(
        Schema.int(),
        Schema.greaterThanOrEqualTo(1),
        Schema.lessThanOrEqualTo(100),
      ),
      now: Schema.optional(NonNegativeInteger),
    }),
  returns: () =>
    Schema.Struct({
      selectedCount: NonNegativeInteger,
      completedCount: NonNegativeInteger,
      pendingCount: NonNegativeInteger,
      supersededCount: NonNegativeInteger,
      hasMore: Schema.Boolean,
    }),
  error: () => errors(),
});

const listRecoverableReconciliationRuns = FunctionSpec.internalQuery({
  name: "listRecoverableReconciliationRuns",
  args: () =>
    Schema.Struct({
      limit: Schema.Number.pipe(
        Schema.int(),
        Schema.greaterThanOrEqualTo(1),
        Schema.lessThanOrEqualTo(100),
      ),
      now: NonNegativeInteger,
    }),
  returns: () =>
    Schema.Struct({
      runs: Schema.Array(
        Schema.Struct({
          reconciliationRunKey: Schema.String,
          expectedRunGeneration: PositiveInteger,
          expectedConnectionGeneration: PositiveInteger,
          expectedAllowlistGeneration: PositiveInteger,
          expectedLeaseGeneration: PositiveInteger,
        }),
      ).pipe(Schema.maxItems(100)),
      hasMore: Schema.Boolean,
    }),
  error: () => errors(),
});

const StoredPageBase = {
  pageEnvelopeKey: Schema.String,
  pageDigest: ContentHash,
  ledgerHighWater: NonNegativeNumber,
  chunks: Schema.Array(PageChunkDescriptor).pipe(Schema.maxItems(64)),
};

const loadReconciliationPage = FunctionSpec.internalQuery({
  name: "loadReconciliationPage",
  args: () =>
    Schema.extend(
      RunRef,
      Schema.Struct({
        sourceKind: Schema.Literal("slack", "transcript", "google_drive"),
        cursorKey: Schema.String,
        expectedCursor: NullableCursor,
        expectedCursorGeneration: PositiveInteger,
      }),
    ),
  returns: () =>
    Schema.NullOr(
      Schema.Union(
        Schema.Struct({
          kind: Schema.Literal("slack"),
          ...StoredPageBase,
          preparedSlackPage: PreparedSlackReconciliationPage,
        }),
        Schema.Struct({
          kind: Schema.Literal("transcript"),
          ...StoredPageBase,
          preparedTranscriptPage: PreparedTranscriptReconciliationPage,
        }),
        Schema.Struct({
          kind: Schema.Literal("google_drive"),
          ...StoredPageBase,
          preparedDrivePage: PreparedDriveReconciliationPage,
        }),
      ),
    ),
  error: () => errors(),
});

const getDriveExpectedIncarnation = FunctionSpec.internalQuery({
  name: "getDriveExpectedIncarnation",
  args: () =>
    Schema.Struct({
      organizationKey: Schema.String,
      providerObjectKey: Schema.String,
    }),
  returns: () => Schema.NullOr(PositiveInteger),
  error: () => errors(),
});

const listReconciliationRemovalCandidates = FunctionSpec.internalQuery({
  name: "listReconciliationRemovalCandidates",
  args: () =>
    Schema.Struct({
      organizationKey: Schema.String,
      sourceKind: Schema.Literal("slack", "transcript", "google_drive"),
      connectorScopeKey: Schema.String,
      connectionKey: Schema.String,
      connectionGeneration: PositiveInteger,
      allowlistGeneration: PositiveInteger,
      cursor: NullableCursor,
      limit: Schema.Number.pipe(
        Schema.int(),
        Schema.greaterThanOrEqualTo(1),
        Schema.lessThanOrEqualTo(100),
      ),
    }),
  returns: () =>
    Schema.Struct({
      candidates: Schema.Array(RemovalCandidate).pipe(Schema.maxItems(100)),
      nextCursor: NullableCursor,
    }),
  error: () => errors(),
});

const sweepIngestionObligationRepairs = FunctionSpec.internalMutation({
  name: "sweepIngestionObligationRepairs",
  args: () =>
    Schema.Struct({
      limit: PositiveInteger,
      now: Schema.optional(NonNegativeInteger),
    }),
  returns: () =>
    Schema.Struct({
      selectedCount: NonNegativeInteger,
      succeededCount: NonNegativeInteger,
      failedCount: NonNegativeInteger,
      hasMore: Schema.Boolean,
    }),
  error: () => errors(),
});

const sweepIngestionObligations = FunctionSpec.internalMutation({
  name: "sweepIngestionObligations",
  args: () =>
    Schema.Struct({
      limit: Schema.Number.pipe(
        Schema.int(),
        Schema.greaterThanOrEqualTo(1),
        Schema.lessThanOrEqualTo(100),
      ),
      now: Schema.optional(NonNegativeInteger),
    }),
  returns: () =>
    Schema.Struct({
      selectedCount: NonNegativeInteger,
      progressedCount: NonNegativeInteger,
      completedCount: NonNegativeInteger,
      policyExcludedCount: NonNegativeInteger,
      failedCount: NonNegativeInteger,
      waitingCount: NonNegativeInteger,
      hasMore: Schema.Boolean,
    }),
  error: () => errors(),
});

export default GroupSpec.make()
  .addFunction(upsertRequiredScopeIntent)
  .addFunction(activateRequiredScope)
  .addFunction(openReconciliationRun)
  .addFunction(getReconciliationStartContext)
  .addFunction(claimReconciliationStep)
  .addFunction(upsertDriveScopeConfiguration)
  .addFunction(getDriveScopeConfiguration)
  .addFunction(getDriveScopeConfigurationForStart)
  .addFunction(beginReconciliationPage)
  .addFunction(commitReconciliationPageChunk)
  .addFunction(finalizeReconciliationPage)
  .addFunction(closeReconciliationTraversal)
  .addFunction(applyReconciliationRemovalBatch)
  .addFunction(completeReconciliationRun)
  .addFunction(maybeCompleteReconciliationRun)
  .addFunction(recoverReconciliationRuns)
  .addFunction(listRecoverableReconciliationRuns)
  .addFunction(loadReconciliationPage)
  .addFunction(getDriveExpectedIncarnation)
  .addFunction(listReconciliationRemovalCandidates)
  .addFunction(sweepIngestionObligationRepairs)
  .addFunction(sweepIngestionObligations);
