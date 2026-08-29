import { Table } from "@confect/server";
import * as Schema from "effect/Schema";
import { Id } from "../_generated/id";
import { BrainEvidenceProvider } from "./brainEvidenceSources";

// Lightweight exact grounding-quality aggregate by evidence scope and extraction policy.
export default Table.make(() =>
  Schema.Struct({
    workspaceId: Id("workspaces"),
    provider: BrainEvidenceProvider,
    scopeKey: Schema.String,
    extractionPolicyVersion: Schema.String,
    proposedCount: Schema.Number,
    groundingFailureCount: Schema.Number,
    createdAt: Schema.Number,
    updatedAt: Schema.Number,
  }),
)
  .index("by_workspace", ["workspaceId"])
  .index("by_workspace_provider_scope_policy", [
    "workspaceId",
    "provider",
    "scopeKey",
    "extractionPolicyVersion",
  ]);
