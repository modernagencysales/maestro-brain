import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

export const ClassificationDecisionState = Schema.Literal(
  "gathered",
  "proposed_zero",
  "proposed_one",
  "proposed_mixed",
  "accepted",
  "changed_to_allowed",
  "no_route",
  "mixed_client_no_route",
  "rejected",
  "superseded",
);

export const ClassificationContentScope = Schema.Literal(
  "single_target",
  "mixed_client",
  "no_target",
);

export const ClassificationDecisionRow = Schema.Struct({
  organizationId: Schema.String,
  workspaceId: Schema.String,
  decisionKey: Schema.String,
  sourceUnitRevisionKey: Schema.String,
  sourceUnitHash: Schema.String,
  policyVersion: Schema.Number,
  lifecycleGeneration: Schema.Number,
  routeGeneration: Schema.Number,
  leaseGeneration: Schema.Number,
  allowedTargetKeys: Schema.Array(Schema.String),
  state: ClassificationDecisionState,
  contentScope: ClassificationContentScope,
  targetBrainKey: Schema.NullOr(Schema.String),
  confidence: Schema.Number,
  rationaleHash: Schema.String,
  evidenceHash: Schema.String,
  reviewerPrincipalKey: Schema.optional(Schema.NullOr(Schema.String)),
  effectKey: Schema.optional(Schema.NullOr(Schema.String)),
  routeEffectKey: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});

export default Table.make(() => ClassificationDecisionRow)
  .index("by_unit_policy_epoch", ["sourceUnitRevisionKey", "policyVersion"])
  .index("by_status_created", ["state", "createdAt"])
  .index("by_effect_key", ["effectKey"])
  .index("by_target_brain", ["targetBrainKey"]);
