import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import {
  ContentHash,
  NonNegativeInteger,
  PositiveInteger,
} from "./retrievalSchemas";
import {
  TranscriptAdapterOrderVersion,
  TranscriptRevisionOrderConflictKind,
} from "../sources/transcriptRevisionOrder";

const NullableString = Schema.NullOr(Schema.String);
const BatchSize = Schema.Number.pipe(
  Schema.int(),
  Schema.greaterThanOrEqualTo(1),
  Schema.lessThanOrEqualTo(10),
);

export const ProjectionBackfillStage = Schema.Literal(
  "scan_current",
  "scan_retired",
  "catch_up_current",
  "catch_up_retired",
  "validate_current",
  "validate_retired",
  "validate_subjects",
  "fence_scan_current",
  "fence_scan_retired",
  "fence_catch_up_current",
  "fence_catch_up_retired",
  "fence_validate_current",
  "fence_validate_retired",
  "complete",
  "blocked",
  "superseded",
);

export const ProjectionBackfillPhase = Schema.Literal(
  "publication_subjects",
  "eligibility_fences",
);

export class ProjectionBackfillNotFound extends Schema.TaggedError<ProjectionBackfillNotFound>()(
  "ProjectionBackfillNotFound",
  { runKey: Schema.String },
) {}

export class ProjectionBackfillConflict extends Schema.TaggedError<ProjectionBackfillConflict>()(
  "ProjectionBackfillConflict",
  {
    reason: Schema.Literal(
      "generation_changed",
      "configuration_changed",
      "integrity_conflict",
      "completion_immutable",
    ),
    detail: Schema.String,
  },
) {}

export class ProjectionBackfillCapacityExceeded extends Schema.TaggedError<ProjectionBackfillCapacityExceeded>()(
  "ProjectionBackfillCapacityExceeded",
  {
    publicationSetKey: Schema.String,
    historyCount: NonNegativeInteger,
    entryCount: NonNegativeInteger,
    tokenCount: NonNegativeInteger,
  },
) {}

const Progress = Schema.Struct({
  runKey: Schema.String,
  runGeneration: PositiveInteger,
  phase: ProjectionBackfillPhase,
  stage: ProjectionBackfillStage,
  cursor: NullableString,
  projectionPopulationGeneration: PositiveInteger,
  subjectBackfillGeneration: NonNegativeInteger,
  fenceBackfillGeneration: NonNegativeInteger,
  processed: NonNegativeInteger,
  backfilled: NonNegativeInteger,
  validated: NonNegativeInteger,
  conflictCount: NonNegativeInteger,
  capacityCount: NonNegativeInteger,
  validationRestartCount: NonNegativeInteger,
  current: NonNegativeInteger,
  retired: NonNegativeInteger,
  fenceBackfilled: NonNegativeInteger,
  invalidated: NonNegativeInteger,
  terminal: Schema.Boolean,
  legacyCompletionDigest: Schema.NullOr(ContentHash),
  fenceCompletionDigest: Schema.NullOr(ContentHash),
});

export const LegacyJobAuthorityMigrationStage = Schema.Literal(
  "scanning",
  "complete",
  "blocked",
);

const LegacyJobAuthorityMigrationProgress = Schema.Struct({
  runKey: Schema.String,
  runGeneration: PositiveInteger,
  stage: LegacyJobAuthorityMigrationStage,
  cursor: NullableString,
  projectionPopulationGeneration: PositiveInteger,
  processed: NonNegativeInteger,
  replaced: NonNegativeInteger,
  completeAuthority: NonNegativeInteger,
  terminalHistory: NonNegativeInteger,
  conflictCount: NonNegativeInteger,
  terminal: Schema.Boolean,
  completionDigest: Schema.NullOr(ContentHash),
});

export class TranscriptRevisionOrderBackfillNotFound extends Schema.TaggedError<TranscriptRevisionOrderBackfillNotFound>()(
  "TranscriptRevisionOrderBackfillNotFound",
  { runKey: Schema.String },
) {}

export class TranscriptRevisionOrderBackfillConflict extends Schema.TaggedError<TranscriptRevisionOrderBackfillConflict>()(
  "TranscriptRevisionOrderBackfillConflict",
  {
    reason: Schema.Literal(
      "generation_changed",
      "adapter_version_changed",
      "integrity_conflict",
      "completion_immutable",
    ),
    detail: Schema.String,
  },
) {}

const TranscriptRevisionOrderBackfillProgress = Schema.Struct({
  runKey: Schema.String,
  runGeneration: PositiveInteger,
  adapterOrderVersion: TranscriptAdapterOrderVersion,
  stage: Schema.Literal("scanning", "validating", "complete", "blocked"),
  cursor: NullableString,
  sourcePopulationGeneration: NonNegativeInteger,
  pinnedSourcePopulationGeneration: NonNegativeInteger,
  processed: NonNegativeInteger,
  backfilled: NonNegativeInteger,
  excluded: NonNegativeInteger,
  conflictCount: NonNegativeInteger,
  blockingConflict: Schema.NullOr(TranscriptRevisionOrderConflictKind),
  terminal: Schema.Boolean,
  readyForPromotion: Schema.Boolean,
  completionDigest: Schema.NullOr(ContentHash),
});

const Errors = Schema.Union(
  ProjectionBackfillNotFound,
  ProjectionBackfillConflict,
  ProjectionBackfillCapacityExceeded,
);

const TranscriptRevisionOrderErrors = Schema.Union(
  TranscriptRevisionOrderBackfillNotFound,
  TranscriptRevisionOrderBackfillConflict,
);

const OperationKey = Schema.String.pipe(Schema.pattern(/^bop_[a-f0-9]{64}$/));
const OperationReason = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(2_048),
);
const ReceiptKey = Schema.NullOr(
  Schema.String.pipe(Schema.pattern(/^bopr_[a-f0-9]{64}$/)),
);
const LeaseBatchSize = Schema.Number.pipe(
  Schema.int(),
  Schema.greaterThanOrEqualTo(1),
  Schema.lessThanOrEqualTo(20),
);

export class BrainOperationConflict extends Schema.TaggedError<BrainOperationConflict>()(
  "BrainOperationConflict",
  {
    operation: Schema.String,
    reason: Schema.Literal(
      "target_not_found",
      "scope_mismatch",
      "generation_changed",
      "configuration_changed",
      "state_changed",
      "active_leases",
      "effect_not_failed",
      "effect_already_repaired",
      "capacity_exceeded",
      "integrity_conflict",
    ),
    detail: Schema.String,
  },
) {}

export const PublicationWorkerControlResult = Schema.Struct({
  operationKey: OperationKey,
  receiptKey: ReceiptKey,
  pauseKey: Schema.String,
  scopeKey: Schema.String,
  previousPauseEpoch: NonNegativeInteger,
  pauseEpoch: NonNegativeInteger,
  state: Schema.Literal("running", "paused"),
  activeLeaseCount: NonNegativeInteger,
  dryRun: Schema.Boolean,
});

export const PublicationWorkerLeaseStatus = Schema.Struct({
  pauseKey: Schema.String,
  scopeKey: Schema.String,
  pauseEpoch: NonNegativeInteger,
  state: Schema.Literal("running", "paused"),
  activeLeaseCount: NonNegativeInteger,
  earliestLeaseExpiry: Schema.NullOr(NonNegativeInteger),
});

export const PublicationWorkerDrainResult = Schema.Struct({
  pauseKey: Schema.String,
  scopeKey: Schema.String,
  pauseEpoch: NonNegativeInteger,
  state: Schema.Literal("running", "paused"),
  drainedLeaseCount: NonNegativeInteger,
  activeLeaseCount: NonNegativeInteger,
  hasMore: Schema.Boolean,
  dryRun: Schema.Boolean,
});

export const FailedEffectRepairResult = Schema.Struct({
  operationKey: OperationKey,
  receiptKey: ReceiptKey,
  targetKind: Schema.Literal("ingestion_obligation", "publication_job"),
  targetKey: Schema.String,
  mode: Schema.Literal("retry", "attributed_repair"),
  priorState: Schema.String,
  resultState: Schema.String,
  repairEffectKey: Schema.NullOr(Schema.String),
  dryRun: Schema.Boolean,
});

export const QuarantineDispositionResult = Schema.Struct({
  operationKey: OperationKey,
  receiptKey: ReceiptKey,
  ingestionObligationKey: Schema.String,
  priorState: Schema.String,
  resultState: Schema.Literal("quarantined"),
  reason: OperationReason,
  dryRun: Schema.Boolean,
});

export const RequiredScopeDecommissionResult = Schema.Struct({
  operationKey: OperationKey,
  receiptKey: ReceiptKey,
  requiredScopeIntentKey: Schema.String,
  intentGeneration: PositiveInteger,
  priorState: Schema.Literal("required", "decommissioned"),
  resultState: Schema.Literal("required", "decommissioned"),
  excludedObligationCount: NonNegativeInteger,
  hasMore: Schema.Boolean,
  dryRun: Schema.Boolean,
});

const ProjectionValidationReceiptKey = Schema.String.pipe(
  Schema.pattern(/^bpvr_[a-f0-9]{64}$/),
);

export class ProjectionReadinessRejected extends Schema.TaggedError<ProjectionReadinessRejected>()(
  "ProjectionReadinessRejected",
  {
    operation: Schema.Literal(
      "validate_brain_projection_readiness",
      "switch_brain_read_mode",
      "rollback_brain_read_mode",
    ),
    reason: Schema.Literal(
      "not_ready",
      "capacity_exceeded",
      "integrity_conflict",
      "population_changed",
      "receipt_not_found",
      "receipt_scope_mismatch",
      "receipt_expired",
      "receipt_consumed",
      "receipt_tampered",
      "deployment_changed",
      "mode_changed",
      "state_changed",
    ),
    detail: Schema.String,
  },
) {}

export const ProjectionValidationReceiptResult = Schema.Struct({
  receiptKey: ProjectionValidationReceiptKey,
  deploymentSha: Schema.String,
  projectionSchemaVersion: Schema.Literal("3"),
  projectionManifestVersion: Schema.Literal("2"),
  validatedMode: Schema.Literal("compatibility", "disabled"),
  validatedModeGeneration: NonNegativeInteger,
  projectionPopulationGeneration: PositiveInteger,
  publicationPopulationDigest: ContentHash,
  requiredScopeManifestDigest: ContentHash,
  issuedAt: NonNegativeInteger,
  expiresAt: NonNegativeInteger,
  receiptDigest: ContentHash,
});

export const BrainReadModeSwitchResult = Schema.Struct({
  receiptKey: ProjectionValidationReceiptKey,
  previousMode: Schema.Literal("compatibility", "disabled"),
  mode: Schema.Literal("projection"),
  previousModeGeneration: NonNegativeInteger,
  modeGeneration: PositiveInteger,
  consumedAt: NonNegativeInteger,
});

export const BrainReadModeRollbackResult = Schema.Struct({
  previousMode: Schema.Literal("compatibility", "projection", "disabled"),
  mode: Schema.Literal("disabled"),
  previousModeGeneration: PositiveInteger,
  modeGeneration: PositiveInteger,
  compatibilityEquivalent: Schema.Literal(false),
  reason: OperationReason,
  rolledBackAt: NonNegativeInteger,
});

const BrainOperationErrors = Schema.Union(BrainOperationConflict);
const ProjectionReadinessErrors = Schema.Union(ProjectionReadinessRejected);

const OwnerApproval = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(512),
);

export const startProjectionBackfill = FunctionSpec.internalMutation({
  name: "startProjectionBackfill",
  args: () =>
    Schema.Struct({
      organizationKey: Schema.String,
      workspaceId: Id("workspaces"),
      brainKey: Schema.String,
      phase: ProjectionBackfillPhase,
      corpusKey: NullableString,
      connectorScopeKey: NullableString,
      expectedConfigurationDigest: ContentHash,
      expectedProjectionPopulationGeneration: NonNegativeInteger,
      batchSize: BatchSize,
    }),
  returns: () => Progress,
  error: () => Errors,
});

export const resumeProjectionBackfill = FunctionSpec.internalMutation({
  name: "resumeProjectionBackfill",
  args: () =>
    Schema.Struct({
      runKey: Schema.String,
      expectedRunGeneration: PositiveInteger,
      batchSize: BatchSize,
    }),
  returns: () => Progress,
  error: () => Errors,
});

export const migrateLegacyPublicationJobAuthority =
  FunctionSpec.internalMutation({
    name: "migrateLegacyPublicationJobAuthority",
    args: () =>
      Schema.Struct({
        organizationKey: Schema.String,
        workspaceId: Id("workspaces"),
        brainKey: Schema.String,
        expectedConfigurationDigest: ContentHash,
        expectedProjectionPopulationGeneration: NonNegativeInteger,
        batchSize: BatchSize,
      }),
    returns: () => LegacyJobAuthorityMigrationProgress,
    error: () => Errors,
  });

export const resumeLegacyPublicationJobAuthorityMigration =
  FunctionSpec.internalMutation({
    name: "resumeLegacyPublicationJobAuthorityMigration",
    args: () =>
      Schema.Struct({
        runKey: Schema.String,
        expectedRunGeneration: PositiveInteger,
        batchSize: BatchSize,
      }),
    returns: () => LegacyJobAuthorityMigrationProgress,
    error: () => Errors,
  });

export const backfillTranscriptRevisionOrder = FunctionSpec.internalMutation({
  name: "backfillTranscriptRevisionOrder",
  args: () =>
    Schema.Struct({
      organizationKey: Schema.String,
      adapterOrderVersion: TranscriptAdapterOrderVersion,
      batchSize: BatchSize,
    }),
  returns: () => TranscriptRevisionOrderBackfillProgress,
  error: () => TranscriptRevisionOrderErrors,
});

export const resumeTranscriptRevisionOrderBackfill =
  FunctionSpec.internalMutation({
    name: "resumeTranscriptRevisionOrderBackfill",
    args: () =>
      Schema.Struct({
        runKey: Schema.String,
        expectedRunGeneration: PositiveInteger,
        batchSize: BatchSize,
      }),
    returns: () => TranscriptRevisionOrderBackfillProgress,
    error: () => TranscriptRevisionOrderErrors,
  });

export const pausePublicationWorkers = FunctionSpec.internalMutation({
  name: "pausePublicationWorkers",
  args: () =>
    Schema.Struct({
      organizationKey: Schema.String,
      workspaceId: Id("workspaces"),
      brainKey: Schema.String,
      scopeKey: Schema.String,
      operationKey: OperationKey,
      reason: OperationReason,
      dryRun: Schema.Boolean,
      now: NonNegativeInteger,
    }),
  returns: () => PublicationWorkerControlResult,
  error: () => BrainOperationErrors,
});

export const resumePublicationWorkers = FunctionSpec.internalMutation({
  name: "resumePublicationWorkers",
  args: () =>
    Schema.Struct({
      organizationKey: Schema.String,
      workspaceId: Id("workspaces"),
      brainKey: Schema.String,
      scopeKey: Schema.String,
      operationKey: OperationKey,
      expectedPauseEpoch: NonNegativeInteger,
      reason: OperationReason,
      dryRun: Schema.Boolean,
      now: NonNegativeInteger,
    }),
  returns: () => PublicationWorkerControlResult,
  error: () => BrainOperationErrors,
});

export const drainPublicationWorkerLeases = FunctionSpec.internalMutation({
  name: "drainPublicationWorkerLeases",
  args: () =>
    Schema.Struct({
      organizationKey: Schema.String,
      workspaceId: Id("workspaces"),
      brainKey: Schema.String,
      scopeKey: Schema.String,
      expectedPauseEpoch: NonNegativeInteger,
      batchSize: LeaseBatchSize,
      dryRun: Schema.Boolean,
      now: NonNegativeInteger,
    }),
  returns: () => PublicationWorkerDrainResult,
  error: () => BrainOperationErrors,
});

export const getPublicationWorkerLeaseStatus = FunctionSpec.internalQuery({
  name: "getPublicationWorkerLeaseStatus",
  args: () =>
    Schema.Struct({
      organizationKey: Schema.String,
      workspaceId: Id("workspaces"),
      brainKey: Schema.String,
      scopeKey: Schema.String,
    }),
  returns: () => PublicationWorkerLeaseStatus,
  error: () => BrainOperationErrors,
});

export const repairIngestionObligation = FunctionSpec.internalMutation({
  name: "repairIngestionObligation",
  args: () =>
    Schema.Struct({
      organizationKey: Schema.String,
      workspaceId: Id("workspaces"),
      brainKey: Schema.String,
      scopeKey: Schema.String,
      operationKey: OperationKey,
      ingestionObligationKey: Schema.String,
      mode: Schema.Literal("retry", "attributed_repair"),
      reason: OperationReason,
      dryRun: Schema.Boolean,
      now: NonNegativeInteger,
    }),
  returns: () => FailedEffectRepairResult,
  error: () => BrainOperationErrors,
});

export const repairPublicationDeadLetter = FunctionSpec.internalMutation({
  name: "repairPublicationDeadLetter",
  args: () =>
    Schema.Struct({
      organizationKey: Schema.String,
      workspaceId: Id("workspaces"),
      brainKey: Schema.String,
      scopeKey: Schema.String,
      operationKey: OperationKey,
      publicationJobKey: Schema.String,
      mode: Schema.Literal("retry", "attributed_repair"),
      reason: OperationReason,
      dryRun: Schema.Boolean,
      now: NonNegativeInteger,
    }),
  returns: () => FailedEffectRepairResult,
  error: () => BrainOperationErrors,
});

export const quarantineIngestionObligation = FunctionSpec.internalMutation({
  name: "quarantineIngestionObligation",
  args: () =>
    Schema.Struct({
      organizationKey: Schema.String,
      workspaceId: Id("workspaces"),
      brainKey: Schema.String,
      scopeKey: Schema.String,
      operationKey: OperationKey,
      ingestionObligationKey: Schema.String,
      reason: OperationReason,
      dryRun: Schema.Boolean,
      now: NonNegativeInteger,
    }),
  returns: () => QuarantineDispositionResult,
  error: () => BrainOperationErrors,
});

export const decommissionRequiredScope = FunctionSpec.internalMutation({
  name: "decommissionRequiredScope",
  args: () =>
    Schema.Struct({
      organizationKey: Schema.String,
      workspaceId: Id("workspaces"),
      brainKey: Schema.String,
      scopeKey: Schema.String,
      operationKey: OperationKey,
      requiredScopeIntentKey: Schema.String,
      expectedIntentGeneration: PositiveInteger,
      expectedControllingConfigurationDigest: ContentHash,
      approvedBy: OwnerApproval,
      reason: OperationReason,
      batchSize: LeaseBatchSize,
      dryRun: Schema.Boolean,
      now: NonNegativeInteger,
    }),
  returns: () => RequiredScopeDecommissionResult,
  error: () => BrainOperationErrors,
});

export const validateBrainProjectionReadiness = FunctionSpec.internalMutation({
  name: "validateBrainProjectionReadiness",
  args: () =>
    Schema.Struct({
      organizationKey: Schema.String,
      workspaceId: Id("workspaces"),
      brainKey: Schema.String,
    }),
  returns: () => ProjectionValidationReceiptResult,
  error: () => ProjectionReadinessErrors,
});

export const switchBrainReadMode = FunctionSpec.internalMutation({
  name: "switchBrainReadMode",
  args: () =>
    Schema.Struct({
      organizationKey: Schema.String,
      workspaceId: Id("workspaces"),
      brainKey: Schema.String,
      receiptKey: ProjectionValidationReceiptKey,
    }),
  returns: () => BrainReadModeSwitchResult,
  error: () => ProjectionReadinessErrors,
});

export const rollbackBrainReadMode = FunctionSpec.internalMutation({
  name: "rollbackBrainReadMode",
  args: () =>
    Schema.Struct({
      organizationKey: Schema.String,
      workspaceId: Id("workspaces"),
      brainKey: Schema.String,
      expectedModeGeneration: PositiveInteger,
      reason: OperationReason,
    }),
  returns: () => BrainReadModeRollbackResult,
  error: () => ProjectionReadinessErrors,
});

export default GroupSpec.make()
  .addFunction(startProjectionBackfill)
  .addFunction(resumeProjectionBackfill)
  .addFunction(migrateLegacyPublicationJobAuthority)
  .addFunction(resumeLegacyPublicationJobAuthorityMigration)
  .addFunction(backfillTranscriptRevisionOrder)
  .addFunction(resumeTranscriptRevisionOrderBackfill)
  .addFunction(pausePublicationWorkers)
  .addFunction(resumePublicationWorkers)
  .addFunction(drainPublicationWorkerLeases)
  .addFunction(getPublicationWorkerLeaseStatus)
  .addFunction(repairIngestionObligation)
  .addFunction(repairPublicationDeadLetter)
  .addFunction(quarantineIngestionObligation)
  .addFunction(decommissionRequiredScope)
  .addFunction(validateBrainProjectionReadiness)
  .addFunction(switchBrainReadMode)
  .addFunction(rollbackBrainReadMode);
