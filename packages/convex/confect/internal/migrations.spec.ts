import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import { MigrationReceiptRow } from "../tables/migrationReceipts";
import type {
  reserveBrainKeys,
  reservePageKeys,
  reserveStableKeys,
} from "./migrations";

const NonEmptyString = Schema.String.pipe(Schema.minLength(1));
const PositiveBatchSize = Schema.Number.pipe(
  Schema.int(),
  Schema.greaterThan(0),
  Schema.lessThanOrEqualTo(25),
);
const NonNegativeInteger = Schema.Number.pipe(
  Schema.int(),
  Schema.greaterThanOrEqualTo(0),
);

export const AllowedMigrationName = Schema.Literal(
  "reserveStableKeys",
  "reserveBrainKeys",
  "reservePageKeys",
);
export type AllowedMigrationName = Schema.Schema.Type<
  typeof AllowedMigrationName
>;

export const MigrationActor = Schema.Struct({
  kind: Schema.Literal("system", "operator"),
  key: NonEmptyString,
});

export const MigrationBatchRunArgs = Schema.Struct({
  migrationName: NonEmptyString,
  mode: Schema.Literal("dryRun", "execute"),
  releaseCommit: NonEmptyString,
  schemaBefore: NonEmptyString,
  schemaAfter: NonEmptyString,
  batchSize: Schema.optional(PositiveBatchSize),
  actor: MigrationActor,
  deploymentId: NonEmptyString,
  buildId: NonEmptyString,
  parityChecks: Schema.optional(Schema.Array(NonEmptyString)),
  rollbackOwner: Schema.optional(NonEmptyString),
  observationEndsAt: Schema.optional(Schema.Number),
});
export type MigrationBatchRunArgs = Schema.Schema.Type<
  typeof MigrationBatchRunArgs
>;

export const MigrationBatchReceipt = Schema.Struct({
  migrationName: AllowedMigrationName,
  mode: Schema.Literal("dryRun", "execute"),
  cursor: Schema.NullOr(Schema.String),
  scanned: NonNegativeInteger,
  changed: NonNegativeInteger,
  skipped: NonNegativeInteger,
  failed: NonNegativeInteger,
  complete: Schema.Boolean,
  startedAt: Schema.Number,
  finishedAt: Schema.Number,
});
export type MigrationBatchReceipt = Schema.Schema.Type<
  typeof MigrationBatchReceipt
>;

export const ListMigrationReceiptsArgs = Schema.Struct({
  migrationName: Schema.optional(AllowedMigrationName),
});
export const ListMigrationReceiptsReturn = Schema.Struct({
  receipts: Schema.Array(MigrationReceiptRow),
});

export class MigrationNotFound extends Schema.TaggedError<MigrationNotFound>()(
  "MigrationNotFound",
  { migrationName: Schema.String },
) {}
export class MigrationAlreadyRunning extends Schema.TaggedError<MigrationAlreadyRunning>()(
  "MigrationAlreadyRunning",
  { migrationName: Schema.String },
) {}
export class MigrationCursorInvalid extends Schema.TaggedError<MigrationCursorInvalid>()(
  "MigrationCursorInvalid",
  { migrationName: Schema.String, cursor: Schema.String },
) {}
export class MigrationBatchFailed extends Schema.TaggedError<MigrationBatchFailed>()(
  "MigrationBatchFailed",
  { migrationName: Schema.String, reason: Schema.String },
) {}

export const MigrationError = Schema.Union(
  MigrationNotFound,
  MigrationAlreadyRunning,
  MigrationCursorInvalid,
  MigrationBatchFailed,
);

export const migrationDefinitions = [
  {
    name: "reserveStableKeys",
    phase: "expand",
    batchCap: 25,
    destructive: false,
  },
  {
    name: "reserveBrainKeys",
    phase: "expand",
    batchCap: 25,
    destructive: false,
  },
  {
    name: "reservePageKeys",
    phase: "expand",
    batchCap: 25,
    destructive: false,
  },
] as const;

export default GroupSpec.make()
  .addFunction(
    FunctionSpec.convexInternalMutation<typeof reserveStableKeys>()(
      "reserveStableKeys",
    ),
  )
  .addFunction(
    FunctionSpec.convexInternalMutation<typeof reserveBrainKeys>()(
      "reserveBrainKeys",
    ),
  )
  .addFunction(
    FunctionSpec.convexInternalMutation<typeof reservePageKeys>()(
      "reservePageKeys",
    ),
  )
  .addFunction(
    FunctionSpec.internalMutation({
      name: "runBatchInternal",
      args: () => MigrationBatchRunArgs,
      returns: () => MigrationBatchReceipt,
      error: () => MigrationError,
    }),
  )
  .addFunction(
    FunctionSpec.internalQuery({
      name: "listReceiptsInternal",
      args: () => ListMigrationReceiptsArgs,
      returns: () => ListMigrationReceiptsReturn,
      error: () => MigrationError,
    }),
  );
