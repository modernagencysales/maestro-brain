import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

export const ClaimRow = Schema.Struct({
  // Kept string-compatible through the fixture-to-real migration window.
  // New writers still supply a validated workspace Id at their boundary.
  workspaceId: Schema.String,
  claimId: Schema.String,
  conceptIds: Schema.Array(Schema.String),
  body: Schema.String,
  status: Schema.Literals([
    "supported",
    "disputed",
    "archived",
    "unsupported-draft",
  ]),
  citationIds: Schema.Array(Schema.String),
  candidateReceiptKey: Schema.optional(Schema.String),
  propositionFingerprint: Schema.optional(Schema.String),
  epistemics: Schema.optional(Schema.Literals(["factual", "subjective"])),
  tags: Schema.optional(Schema.Array(Schema.String)),
  verifiedAt: Schema.optional(Schema.Number),
  nextReviewAt: Schema.optional(Schema.Number),
  sourceWithdrawnAt: Schema.optional(Schema.Number),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});

export default Table.make(() => ClaimRow)
  .index("by_workspace", ["workspaceId"])
  .index("by_workspace_status", ["workspaceId", "status"])
  .index("by_workspace_and_claim_id", ["workspaceId", "claimId"])
  .index("by_workspace_and_candidate_receipt_key", [
    "workspaceId",
    "candidateReceiptKey",
  ]);
