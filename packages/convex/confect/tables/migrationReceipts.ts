import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

export const MigrationReceiptKind = Schema.Literal(
  "child",
  "failure_checkpoint",
  "release_parent",
);

export const MigrationReceiptRow = Schema.Struct({
  receiptKey: Schema.String,
  runKey: Schema.String,
  parentReceiptKey: Schema.NullOr(Schema.String),
  kind: MigrationReceiptKind,
  migrationName: Schema.String,
  mode: Schema.Literal("execute", "dryRun"),
  batchSequence: Schema.Number,
  fenceGeneration: Schema.Number,
  receiptHash: Schema.String,
  payloadJson: Schema.String,
  createdAt: Schema.Number,
});

export type MigrationReceiptRow = Schema.Schema.Type<
  typeof MigrationReceiptRow
>;

export default Table.make(() => MigrationReceiptRow)
  .index("by_run_sequence", ["runKey", "batchSequence"])
  .index("by_parent", ["parentReceiptKey"])
  .index("by_receipt_hash", ["receiptHash"]);
