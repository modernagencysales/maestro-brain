import { Table } from "@confect/server";
import * as S from "effect/Schema";
import { Id } from "../_generated/id";
import { BrainEvidenceProvider } from "./brainEvidenceSources";

export const BrainRetrievalEntryRow = S.Struct({
  workspaceId: Id("workspaces"),
  provider: BrainEvidenceProvider,
  entryKey: S.String,
  sourceKey: S.String,
  revisionKey: S.String,
  title: S.String,
  markdown: S.String,
  contentHash: S.String,
  projectionVersion: S.optional(S.Number),
  locator: S.optional(S.String),
  sourceModifiedAt: S.Number,
  observedAt: S.Number,
  status: S.Literals(["current", "retired"]),
  semanticPolicyVersion: S.optional(S.String),
  semanticStatus: S.optional(
    S.Literals(["pending", "running", "completed", "failed"]),
  ),
  semanticProposedCount: S.optional(S.Number),
  semanticCandidateCount: S.optional(S.Number),
  semanticGroundingFailureCount: S.optional(S.Number),
  semanticFailureCode: S.optional(S.String),
  semanticRunKey: S.optional(S.String),
  semanticStartedAt: S.optional(S.Number),
  semanticInputTokens: S.optional(S.Number),
  semanticOutputTokens: S.optional(S.Number),
  semanticUsageDay: S.optional(S.Number),
  semanticDailyConsumedTokens: S.optional(S.Number),
  semanticDailyReservedTokens: S.optional(S.Number),
  semanticDailyConsumedSpendCents: S.optional(S.Number),
  semanticDailyReservedSpendCents: S.optional(S.Number),
  semanticEstimatedRunTokens: S.optional(S.Number),
  semanticEstimatedSpendCents: S.optional(S.Number),
  semanticProjectedAt: S.optional(S.Number),
  createdAt: S.Number,
  updatedAt: S.Number,
});

export default Table.make(() => BrainRetrievalEntryRow)
  .index("by_workspace", ["workspaceId"])
  .index("by_workspace_and_entry_key", ["workspaceId", "entryKey"])
  .index("by_workspace_and_source_key_and_status", [
    "workspaceId",
    "sourceKey",
    "status",
  ])
  .index("by_workspace_and_provider_and_status", [
    "workspaceId",
    "provider",
    "status",
  ])
  .index("by_workspace_and_semantic_status", ["workspaceId", "semanticStatus"]);
