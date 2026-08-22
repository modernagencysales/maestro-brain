import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import {
  ContentHash,
  NonNegativeInteger,
  PositiveInteger,
} from "../brain/retrievalSchemas";

const NonNegativeNumber = Schema.Number.pipe(Schema.greaterThanOrEqualTo(0));

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

export const LegacySubjectBackfillCompletion = Schema.Struct({
  runKey: Schema.String.pipe(Schema.pattern(/^pbrun_[a-f0-9]{64}$/)),
  runGeneration: PositiveInteger,
  subjectBackfillGeneration: PositiveInteger,
  scanHighWater: NonNegativeNumber,
  catchUpHighWater: NonNegativeNumber,
  populationGeneration: PositiveInteger,
  populationDigest: ContentHash,
  setCount: NonNegativeInteger,
  subjectCount: NonNegativeInteger,
  entryCount: NonNegativeInteger,
  tokenCount: NonNegativeInteger,
  completedAt: NonNegativeInteger,
  completionDigest: ContentHash,
});

export const LegacyJobAuthorityMigrationStage = Schema.Literal(
  "scanning",
  "complete",
  "blocked",
);

export const LegacyJobAuthorityMigrationCompletion = Schema.Struct({
  runKey: Schema.String.pipe(Schema.pattern(/^pjam_[a-f0-9]{64}$/)),
  runGeneration: PositiveInteger,
  scanHighWater: NonNegativeNumber,
  populationGeneration: PositiveInteger,
  configurationDigest: ContentHash,
  populationDigest: ContentHash,
  processedJobCount: NonNegativeInteger,
  replacementJobCount: NonNegativeInteger,
  completeAuthorityJobCount: NonNegativeInteger,
  terminalHistoryJobCount: NonNegativeInteger,
  conflictCount: NonNegativeInteger,
  completedAt: NonNegativeInteger,
  completionDigest: ContentHash,
});

export const LegacyEligibilityFenceBackfillCompletion = Schema.Struct({
  runKey: Schema.String.pipe(Schema.pattern(/^pbrun_[a-f0-9]{64}$/)),
  runGeneration: PositiveInteger,
  fenceBackfillGeneration: PositiveInteger,
  scanHighWater: NonNegativeNumber,
  catchUpHighWater: NonNegativeNumber,
  populationGeneration: PositiveInteger,
  configurationDigest: ContentHash,
  populationDigest: ContentHash,
  currentSetCount: NonNegativeInteger,
  retiredSetCount: NonNegativeInteger,
  backfilledSetCount: NonNegativeInteger,
  invalidatedSetCount: NonNegativeInteger,
  conflictCount: NonNegativeInteger,
  completedAt: NonNegativeInteger,
  completionDigest: ContentHash,
});

export const BrainProjectionPopulationRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: Schema.String,
  workspaceId: Id("workspaces"),
  brainKey: Schema.String,
  populationKey: Schema.String.pipe(Schema.pattern(/^bpop_[a-f0-9]{64}$/)),
  projectionPopulationGeneration: PositiveInteger,
  subjectBackfillGeneration: NonNegativeInteger,
  fenceBackfillGeneration: NonNegativeInteger,
  activeRunKey: Schema.NullOr(
    Schema.String.pipe(Schema.pattern(/^pbrun_[a-f0-9]{64}$/)),
  ),
  activeRunGeneration: NonNegativeInteger,
  activePhase: Schema.NullOr(ProjectionBackfillPhase),
  activeStage: Schema.NullOr(ProjectionBackfillStage),
  activeCursor: Schema.NullOr(Schema.String),
  activeCorpusKey: Schema.NullOr(Schema.String),
  activeConnectorScopeKey: Schema.NullOr(Schema.String),
  activeConfigurationDigest: Schema.NullOr(ContentHash),
  scanHighWater: Schema.NullOr(NonNegativeNumber),
  catchUpHighWater: Schema.NullOr(NonNegativeNumber),
  validationPopulationGeneration: Schema.NullOr(PositiveInteger),
  validationPredecessorDigest: Schema.NullOr(ContentHash),
  validationRestartCount: NonNegativeInteger,
  scannedSetCount: NonNegativeInteger,
  backfilledSetCount: NonNegativeInteger,
  validatedSetCount: NonNegativeInteger,
  validatedSubjectCount: NonNegativeInteger,
  validatedEntryCount: NonNegativeInteger,
  validatedTokenCount: NonNegativeInteger,
  conflictCount: NonNegativeInteger,
  capacityCount: NonNegativeInteger,
  legacySubjectBackfillCompletion: Schema.NullOr(
    LegacySubjectBackfillCompletion,
  ),
  currentFenceSetCount: NonNegativeInteger,
  retiredFenceSetCount: NonNegativeInteger,
  fenceBackfilledSetCount: NonNegativeInteger,
  invalidatedFenceSetCount: NonNegativeInteger,
  fenceConflictCount: NonNegativeInteger,
  legacyEligibilityFenceBackfillCompletion: Schema.NullOr(
    LegacyEligibilityFenceBackfillCompletion,
  ),
  jobAuthorityMigrationRunKey: Schema.NullOr(
    Schema.String.pipe(Schema.pattern(/^pjam_[a-f0-9]{64}$/)),
  ),
  jobAuthorityMigrationRunGeneration: NonNegativeInteger,
  jobAuthorityMigrationStage: Schema.NullOr(LegacyJobAuthorityMigrationStage),
  jobAuthorityMigrationCursor: Schema.NullOr(Schema.String),
  jobAuthorityMigrationConfigurationDigest: Schema.NullOr(ContentHash),
  jobAuthorityMigrationScanHighWater: Schema.NullOr(NonNegativeNumber),
  jobAuthorityMigrationPredecessorDigest: Schema.NullOr(ContentHash),
  jobAuthorityMigrationProcessedCount: NonNegativeInteger,
  jobAuthorityMigrationReplacementCount: NonNegativeInteger,
  jobAuthorityMigrationCompleteAuthorityCount: NonNegativeInteger,
  jobAuthorityMigrationTerminalHistoryCount: NonNegativeInteger,
  jobAuthorityMigrationConflictCount: NonNegativeInteger,
  legacyJobAuthorityMigrationCompletion: Schema.NullOr(
    LegacyJobAuthorityMigrationCompletion,
  ),
  createdAt: NonNegativeInteger,
  updatedAt: NonNegativeInteger,
});

export default Table.make(() => BrainProjectionPopulationRow)
  .index("by_workspace_brain", ["workspaceId", "brainKey"])
  .index("by_active_run_key", ["activeRunKey"])
  .index("by_job_authority_migration_run_key", ["jobAuthorityMigrationRunKey"]);
