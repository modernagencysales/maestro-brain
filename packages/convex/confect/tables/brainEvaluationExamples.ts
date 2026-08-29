import { Table } from "@confect/server";
import * as Schema from "effect/Schema";
import { Id } from "../_generated/id";

export const BrainEvaluationEvidenceReference = Schema.Struct({
  sourceKey: Schema.String,
  revisionKey: Schema.String,
  contentHash: Schema.String,
});

export const BrainEvaluationExampleRow = Schema.Struct({
  workspaceId: Id("workspaces"),
  exampleKey: Schema.String,
  question: Schema.String,
  purpose: Schema.String,
  evidenceMode: Schema.Literals(["recent_evidence", "company_truth", "mixed"]),
  surface: Schema.Literals(["web", "cli", "api", "mcp"]),
  answerStatus: Schema.Literals(["answered", "insufficient-context"]),
  packHash: Schema.String,
  maxCitations: Schema.optional(Schema.Number),
  capturedAsOf: Schema.optional(Schema.Number),
  policyVersion: Schema.optional(Schema.String),
  evidenceReferences: Schema.Array(BrainEvaluationEvidenceReference),
  captureKind: Schema.Literals(["feedback", "test"]),
  usefulness: Schema.Literals(["useful", "needs-work", "unrated"]),
  issueReason: Schema.optional(
    Schema.Literals([
      "missing-source",
      "incorrect-answer",
      "stale-context",
      "citation-problem",
      "fallback-required",
      "other",
    ]),
  ),
  adjudicationState: Schema.optional(
    Schema.Literals(["pending", "adjudicated"]),
  ),
  expectedAnswerStatus: Schema.optional(
    Schema.Literals(["answered", "insufficient-context"]),
  ),
  expectedEvidenceReferences: Schema.optional(
    Schema.Array(BrainEvaluationEvidenceReference),
  ),
  riskLevel: Schema.optional(Schema.Literals(["ordinary", "high"])),
  adjudicatedAt: Schema.optional(Schema.Number),
  adjudicatedByUserId: Schema.optional(Id("users")),
  split: Schema.Literals(["development", "holdout"]),
  freezeKey: Schema.optional(Schema.String),
  freezePreviewHash: Schema.optional(Schema.String),
  freezeCutoffCreatedAt: Schema.optional(Schema.Number),
  frozenAt: Schema.optional(Schema.Number),
  frozenByUserId: Schema.optional(Id("users")),
  actorUserId: Id("users"),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});

export default Table.make(() => BrainEvaluationExampleRow)
  .index("by_workspace", ["workspaceId"])
  .index("by_workspace_and_example_key", ["workspaceId", "exampleKey"])
  .index("by_workspace_and_split_and_created_at", [
    "workspaceId",
    "split",
    "createdAt",
  ]);
