import { Table } from "@confect/server";
import * as Schema from "effect/Schema";
import { Id } from "../_generated/id";

export const MaintenanceProposalStatus = Schema.Literal(
  "gathering",
  "proposed_noop",
  "accepted_noop",
  "proposed_revision",
  "awaiting_review",
  "published",
  "edited_and_published",
  "rejected",
  "superseded",
  "revoked",
);

export default Table.make(() =>
  Schema.Struct({
    workspaceId: Id("workspaces"),
    brainKey: Schema.String,
    pageKey: Schema.String,
    proposalKey: Schema.String,
    status: MaintenanceProposalStatus,
    expectedRevisionKey: Schema.String,
    routeGeneration: Schema.Number,
    lifecycleGeneration: Schema.Number,
    policyGeneration: Schema.Number,
    modelPromptPair: Schema.String,
    citationKeys: Schema.Array(Schema.String),
    markdown: Schema.optional(Schema.String),
    createdAt: Schema.Number,
    updatedAt: Schema.Number,
  }),
)
  .index("by_workspace", ["workspaceId"])
  .index("by_workspace_proposal", ["workspaceId", "proposalKey"])
  .index("by_workspace_page_status", ["workspaceId", "pageKey", "status"]);
