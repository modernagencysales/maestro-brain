import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import { ContentHash, NonNegativeInteger } from "../brain/retrievalSchemas";

export const BrainOperationReceiptRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: Schema.String,
  workspaceId: Id("workspaces"),
  brainKey: Schema.String,
  scopeKey: Schema.String,
  operationKey: Schema.String.pipe(Schema.pattern(/^bop_[a-f0-9]{64}$/)),
  receiptKey: Schema.String.pipe(Schema.pattern(/^bopr_[a-f0-9]{64}$/)),
  operation: Schema.Literal(
    "pause_publication_workers",
    "resume_publication_workers",
    "repair_ingestion_obligation",
    "repair_publication_dead_letter",
    "quarantine_ingestion_obligation",
    "decommission_required_scope",
  ),
  targetKind: Schema.Literal(
    "publication_workers",
    "ingestion_obligation",
    "publication_job",
    "required_scope_intent",
  ),
  targetKey: Schema.String,
  expectedGeneration: Schema.NullOr(NonNegativeInteger),
  resultGeneration: Schema.NullOr(NonNegativeInteger),
  controllingConfigurationDigest: Schema.NullOr(ContentHash),
  priorState: Schema.String,
  resultState: Schema.String,
  repairMode: Schema.NullOr(Schema.Literal("retry", "attributed_repair")),
  reason: Schema.String,
  approvedBy: Schema.NullOr(Schema.String),
  linkedEffectKey: Schema.NullOr(Schema.String),
  createdAt: NonNegativeInteger,
});

export default Table.make(() => BrainOperationReceiptRow)
  .index("by_operation_key", ["organizationKey", "operationKey"])
  .index("by_target_operation_generation", [
    "targetKind",
    "targetKey",
    "operation",
    "expectedGeneration",
  ])
  .index("by_workspace_brain_created", [
    "workspaceId",
    "brainKey",
    "createdAt",
  ]);
