import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

export const CallRoutingOutcome = Schema.Literal(
  "routed",
  "awaiting_review",
  "mixed_client",
  "no_match",
);

export const CallRoutingProposalRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: Schema.String,
  proposalKey: Schema.String,
  unitKey: Schema.String,
  unitRevisionKey: Schema.String,
  sourceLifecycleGeneration: Schema.Number,
  routeGeneration: Schema.Number,
  outcome: CallRoutingOutcome,
  brainKey: Schema.NullOr(Schema.String),
  candidateBrainKeys: Schema.Array(Schema.String),
  reason: Schema.String,
  status: Schema.Literal("current", "accepted", "rejected", "superseded"),
  reviewedBy: Schema.optional(Schema.String),
  reviewAttemptKey: Schema.optional(Schema.String),
  learnedMappingKey: Schema.optional(Schema.String),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});

export default Table.make(() => CallRoutingProposalRow)
  .index("by_org_revision", ["organizationKey", "unitRevisionKey"])
  .index("by_org_unit_generation", [
    "organizationKey",
    "unitKey",
    "routeGeneration",
  ])
  .index("by_org_outcome_status", ["organizationKey", "outcome", "status"])
  .index("by_org_outcome_status_brain", [
    "organizationKey",
    "outcome",
    "status",
    "brainKey",
  ])
  .index("by_proposal_key", ["organizationKey", "proposalKey"]);
