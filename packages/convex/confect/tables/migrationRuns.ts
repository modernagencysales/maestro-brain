import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

export const MigrationRunStatus = Schema.Literal(
  "planned",
  "running",
  "complete",
  "failed",
);

export const MigrationRunRow = Schema.Struct({
  runKey: Schema.String,
  migrationName: Schema.String,
  releaseCommit: Schema.String,
  schemaBefore: Schema.String,
  schemaAfter: Schema.String,
  status: MigrationRunStatus,
  cursor: Schema.NullOr(Schema.String),
  leaseOwner: Schema.NullOr(Schema.String),
  leaseStartedAt: Schema.NullOr(Schema.Number),
  leaseExpiresAt: Schema.NullOr(Schema.Number),
  fenceGeneration: Schema.Number,
  lastCommittedBatchSequence: Schema.Number,
  actor: Schema.String,
  deploymentId: Schema.String,
  buildId: Schema.String,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});

export type MigrationRunRow = Schema.Schema.Type<typeof MigrationRunRow>;

export default Table.make(() => MigrationRunRow)
  .index("by_migration_release", ["migrationName", "releaseCommit"])
  .index("by_status", ["status"])
  .index("by_lease_owner", ["leaseOwner"]);
