import { Table } from "@confect/server";
import * as S from "effect/Schema";
import { Id } from "../_generated/id";
import { BrainEvidenceProvider } from "./brainEvidenceSources";

export const BrainRetrievalEntryRow = S.Struct({
  workspaceId: Id("workspaces"),
  provider: BrainEvidenceProvider,
  scopeKey: S.optional(S.String),
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
  .index("by_workspace_and_scope_source_status", [
    "workspaceId",
    "scopeKey",
    "sourceKey",
    "status",
  ])
  .index("by_workspace_provider_scope_status", [
    "workspaceId",
    "provider",
    "scopeKey",
    "status",
  ])
  .index("by_workspace_provider_scope_source_status", [
    "workspaceId",
    "provider",
    "scopeKey",
    "sourceKey",
    "status",
  ])
  .index("by_workspace_and_provider_and_status", [
    "workspaceId",
    "provider",
    "status",
  ])
  .index("by_workspace_provider_scope_status_semantic_status", [
    "workspaceId",
    "provider",
    "scopeKey",
    "status",
    "semanticStatus",
  ])
  .index("by_workspace_provider_status_semantic_status", [
    "workspaceId",
    "provider",
    "status",
    "semanticStatus",
  ])
  .index("by_workspace_provider_scope_status_semantic_status_policy", [
    "workspaceId",
    "provider",
    "scopeKey",
    "status",
    "semanticStatus",
    "semanticPolicyVersion",
  ])
  .index("by_workspace_provider_status_semantic_status_policy", [
    "workspaceId",
    "provider",
    "status",
    "semanticStatus",
    "semanticPolicyVersion",
  ])
  .index("by_workspace_provider_scope_status_semantic_status_started_at", [
    "workspaceId",
    "provider",
    "scopeKey",
    "status",
    "semanticStatus",
    "semanticStartedAt",
  ])
  .index("by_workspace_provider_status_semantic_status_started_at", [
    "workspaceId",
    "provider",
    "status",
    "semanticStatus",
    "semanticStartedAt",
  ])
  .index("by_workspace_and_semantic_status", ["workspaceId", "semanticStatus"]);
