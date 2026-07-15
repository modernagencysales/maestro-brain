import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import type { probeExpand, probeFail } from "./migrations";

const NonEmpty = Schema.String.pipe(Schema.minLength(1));
const PositiveBatchSize = Schema.Number.pipe(
  Schema.int(),
  Schema.greaterThanOrEqualTo(1),
  Schema.lessThanOrEqualTo(100),
);

export class MigrationNotFound extends Schema.TaggedError<MigrationNotFound>()(
  "MigrationNotFound",
  { migrationName: Schema.String },
) {}

export class MigrationAlreadyRunning extends Schema.TaggedError<MigrationAlreadyRunning>()(
  "MigrationAlreadyRunning",
  { migrationName: Schema.String, leaseOwner: Schema.String },
) {}

export class MigrationCursorInvalid extends Schema.TaggedError<MigrationCursorInvalid>()(
  "MigrationCursorInvalid",
  { migrationName: Schema.String, reason: Schema.String },
) {}

export class MigrationBatchFailed extends Schema.TaggedError<MigrationBatchFailed>()(
  "MigrationBatchFailed",
  {
    migrationName: Schema.String,
    batchSequence: Schema.Number,
    failed: Schema.Number,
  },
) {}

export const MigrationError = Schema.Union(
  MigrationNotFound,
  MigrationAlreadyRunning,
  MigrationCursorInvalid,
  MigrationBatchFailed,
);

export const MigrationPhase = Schema.Literal("expand", "backfill", "contract");
export type MigrationPhase = Schema.Schema.Type<typeof MigrationPhase>;

export const MigrationMode = Schema.Literal("execute", "dryRun");
export type MigrationMode = Schema.Schema.Type<typeof MigrationMode>;

export const ExecuteMigrationArgs = Schema.Struct({
  migrationName: NonEmpty,
  releaseCommit: NonEmpty,
  schemaBefore: NonEmpty,
  schemaAfter: NonEmpty,
  actor: NonEmpty,
  deploymentId: NonEmpty,
  buildId: NonEmpty,
  mode: Schema.optionalWith(MigrationMode, {
    default: () => "execute" as const,
  }),
  batchSize: PositiveBatchSize,
  cursor: Schema.optional(Schema.String),
  reset: Schema.optional(Schema.Boolean),
  next: Schema.optional(Schema.Array(Schema.String)),
});

export const ExecuteMigrationResult = Schema.Struct({
  runKey: Schema.String,
  migrationName: Schema.String,
  status: Schema.Literal("running", "complete", "failed", "dryRunComplete"),
  initialCursor: Schema.Null,
  nextCursor: Schema.NullOr(Schema.String),
  componentCursor: Schema.NullOr(Schema.String),
  leaseOwner: Schema.NullOr(Schema.String),
  batchSequence: Schema.Number,
  fenceGeneration: Schema.Number,
  scanned: Schema.Number,
  changed: Schema.Number,
  skipped: Schema.Number,
  failed: Schema.Number,
  childReceiptHash: Schema.String,
  parentReceiptHash: Schema.optional(Schema.String),
});

export const MigrationBatchReceipt = Schema.Struct({
  migrationName: Schema.String,
  mode: MigrationMode,
  cursor: Schema.NullOr(Schema.String),
  priorCursor: Schema.NullOr(Schema.String),
  nextCursor: Schema.NullOr(Schema.String),
  runKey: Schema.String,
  batchSequence: Schema.Number,
  fenceGeneration: Schema.Number,
  actor: Schema.String,
  deploymentId: Schema.String,
  buildId: Schema.String,
  scanned: Schema.Number,
  changed: Schema.Number,
  skipped: Schema.Number,
  failed: Schema.Number,
  complete: Schema.Boolean,
  startedAt: Schema.Number,
  finishedAt: Schema.Number,
});
export type MigrationBatchReceipt = Schema.Schema.Type<
  typeof MigrationBatchReceipt
>;

export const MigrationParentReceipt = Schema.Struct({
  runKey: Schema.String,
  migrationName: Schema.String,
  releaseCommit: Schema.String,
  schemaBefore: Schema.String,
  schemaAfter: Schema.String,
  parityChecks: Schema.Array(Schema.String),
  rollbackOwner: Schema.String,
  observationEndsAt: Schema.Number,
  actor: Schema.String,
  deploymentId: Schema.String,
  buildId: Schema.String,
  fenceGeneration: Schema.Number,
  cursor: Schema.NullOr(Schema.String),
  batchSequence: Schema.Number,
  batchSize: Schema.Number,
  childReceiptHashes: Schema.Array(Schema.String),
  complete: Schema.Boolean,
});
export type MigrationParentReceipt = Schema.Schema.Type<
  typeof MigrationParentReceipt
>;

export const executableMigrations = {
  "probe.expand": {
    phase: "expand" as MigrationPhase,
    componentFunction: "internal/migrations:probeExpand",
  },
  "probe.fail": {
    phase: "expand" as MigrationPhase,
    componentFunction: "internal/migrations:probeFail",
  },
} as const;

const reservedMigrations = new Set([
  "future.agencyKeys.expand",
  "future.brainPageKeys.backfill",
  "future.sourceLedger.contract",
]);

export const assertExecutableMigration = (migrationName: string) => {
  if (reservedMigrations.has(migrationName)) {
    throw new MigrationNotFound({ migrationName });
  }
  const entry =
    executableMigrations[migrationName as keyof typeof executableMigrations];
  if (!entry || entry.phase === ("contract" as MigrationPhase)) {
    throw new MigrationNotFound({ migrationName });
  }
  return entry;
};
