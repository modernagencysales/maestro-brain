import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

export const BrainExportJobRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  jobId: Schema.String,
  idempotencyKey: Schema.String,
  organizationKey: Schema.String,
  workspaceId: Schema.String,
  brainKey: Schema.String,
  lifecycleGeneration: Schema.Number,
  policyGeneration: Schema.Number,
  state: Schema.Literal(
    "requested",
    "running",
    "ready",
    "revoked",
    "failed",
    "expired",
    "purged",
  ),
  artifactId: Schema.optional(Schema.String),
  manifestHash: Schema.optional(Schema.String),
  artifactHash: Schema.optional(Schema.String),
  sizeBytes: Schema.optional(Schema.Number),
  expiresAt: Schema.optional(Schema.Number),
  error: Schema.optional(Schema.String),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});

export type BrainExportJobRowValue = typeof BrainExportJobRow.Type;

export default Table.make(() => BrainExportJobRow)
  .index("by_job_id", ["jobId"])
  .index("by_org_idempotency", ["organizationKey", "idempotencyKey"])
  .index("by_org_state", ["organizationKey", "state"])
  .index("by_expiry", ["state", "expiresAt"]);
