import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

const NonEmptyString = Schema.String.pipe(Schema.minLength(1));
const NonNegativeInteger = Schema.Number.pipe(
  Schema.int(),
  Schema.greaterThanOrEqualTo(0),
);

export const MigrationMode = Schema.Literal("dryRun", "execute");
export const MigrationState = Schema.Literal(
  "planned",
  "running",
  "complete",
  "failed",
);
export const MigrationPhase = Schema.Literal(
  "expand",
  "backfill",
  "verify",
  "contract",
);
export const MigrationActorKind = Schema.Literal("system", "operator");

export const MigrationReceiptRow = Schema.Struct({
  runId: NonEmptyString,
  parentRunId: Schema.NullOr(NonEmptyString),
  releaseRunId: NonEmptyString,
  receiptKind: Schema.Literal("parent", "child"),
  migrationName: NonEmptyString,
  mode: MigrationMode,
  state: MigrationState,
  leaseState: Schema.Literal("none", "held", "released"),
  phase: MigrationPhase,
  cursor: Schema.NullOr(Schema.String),
  componentCursor: Schema.NullOr(Schema.String),
  batchSize: NonNegativeInteger,
  scanned: NonNegativeInteger,
  changed: NonNegativeInteger,
  skipped: NonNegativeInteger,
  failed: NonNegativeInteger,
  complete: Schema.Boolean,
  releaseCommit: NonEmptyString,
  schemaBefore: NonEmptyString,
  schemaAfter: NonEmptyString,
  parityChecks: Schema.Array(NonEmptyString),
  rollbackOwner: NonEmptyString,
  observationEndsAt: Schema.Number,
  actorKind: MigrationActorKind,
  actorKey: NonEmptyString,
  deploymentId: NonEmptyString,
  buildId: NonEmptyString,
  receiptHash: NonEmptyString,
  childReceiptHashes: Schema.Array(NonEmptyString),
  startedAt: Schema.Number,
  finishedAt: Schema.Number,
});

export default Table.make(() => MigrationReceiptRow)
  .index("by_migration_started", ["migrationName", "startedAt"])
  .index("by_parent", ["parentRunId"])
  .index("by_release_schema", ["releaseCommit", "schemaBefore", "schemaAfter"])
  .index("by_run", ["runId"])
  .index("by_state", ["state"]);
