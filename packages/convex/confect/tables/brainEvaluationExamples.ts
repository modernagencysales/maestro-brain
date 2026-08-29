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
  split: Schema.Literals(["development", "holdout"]),
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
