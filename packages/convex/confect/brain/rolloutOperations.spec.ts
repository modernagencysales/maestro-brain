import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import {
  ContentHash,
  NonNegativeInteger,
  PositiveInteger,
} from "./retrievalSchemas";

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

const Errors = Schema.Union(
  ProjectionBackfillNotFound,
  ProjectionBackfillConflict,
  ProjectionBackfillCapacityExceeded,
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

export default GroupSpec.make()
  .addFunction(startProjectionBackfill)
  .addFunction(resumeProjectionBackfill)
  .addFunction(migrateLegacyPublicationJobAuthority)
  .addFunction(resumeLegacyPublicationJobAuthorityMigration);
