import { Table } from "@confect/server";
import * as S from "effect/Schema";
import { Id } from "../_generated/id";

export const BrainCandidateEvidence = S.Struct({
  sourceKey: S.String,
  revisionKey: S.String,
  contentHash: S.String,
  quote: S.String,
  startOffset: S.Number,
  endOffset: S.Number,
  locator: S.optional(S.String),
});

export const BrainCandidateReviewEvent = S.Struct({
  revision: S.Number,
  action: S.Literals(["accept", "edit_and_accept", "reject", "mark_stale"]),
  bodyHash: S.String,
  reason: S.optional(S.String),
  actorId: Id("users"),
  idempotencyKey: S.String,
  occurredAt: S.Number,
});

export const BrainKnowledgeCandidateRow = S.Struct({
  workspaceId: Id("workspaces"),
  candidateReceiptKey: S.String,
  sourceKey: S.String,
  sourceRevisionKey: S.String,
  extractionWindowKey: S.String,
  extractionPolicyVersion: S.String,
  propositionFingerprint: S.String,
  body: S.String,
  epistemics: S.Literals(["factual", "subjective"]),
  quotability: S.Number,
  tags: S.Array(S.String),
  temporalValidAt: S.optional(S.Number),
  temporalExpiresAt: S.optional(S.Number),
  evidence: S.Array(BrainCandidateEvidence),
  extractionConfidence: S.Number,
  currentState: S.Literals(["unreviewed", "accepted", "rejected", "stale"]),
  reviewRevision: S.Number,
  reviewHistory: S.Array(BrainCandidateReviewEvent),
  claimId: S.optional(Id("claims")),
  createdAt: S.Number,
  updatedAt: S.Number,
});

export default Table.make(() => BrainKnowledgeCandidateRow)
  .index("by_workspace", ["workspaceId"])
  .index("by_workspace_and_candidate_receipt_key", [
    "workspaceId",
    "candidateReceiptKey",
  ])
  .index("by_workspace_and_current_state_and_updated_at", [
    "workspaceId",
    "currentState",
    "updatedAt",
  ])
  .index("by_workspace_and_proposition_fingerprint", [
    "workspaceId",
    "propositionFingerprint",
  ])
  .index("by_workspace_and_source_revision_key", [
    "workspaceId",
    "sourceRevisionKey",
  ]);
