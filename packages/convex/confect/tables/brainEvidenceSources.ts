import { Table } from "@confect/server";
import * as S from "effect/Schema";
import { Id } from "../_generated/id";

export const BrainEvidenceProvider = S.Literals([
  "brain_page",
  "slack",
  "google_drive",
  "hubspot",
  "transcript",
]);

export const BrainEvidenceSourceRow = S.Struct({
  workspaceId: Id("workspaces"),
  provider: BrainEvidenceProvider,
  scopeKey: S.String,
  sourceKey: S.String,
  title: S.String,
  locator: S.optional(S.String),
  providerMetadataJson: S.optional(S.String),
  providerMetadataHash: S.optional(S.String),
  status: S.Literals(["active", "removed"]),
  generation: S.Number,
  currentRevisionKey: S.optional(S.String),
  sourceModifiedAt: S.Number,
  observedAt: S.Number,
  createdAt: S.Number,
  updatedAt: S.Number,
});

export default Table.make(() => BrainEvidenceSourceRow)
  .index("by_workspace", ["workspaceId"])
  .index("by_workspace_and_provider", ["workspaceId", "provider"])
  .index("by_workspace_and_provider_and_status", [
    "workspaceId",
    "provider",
    "status",
  ])
  .index("by_workspace_and_source_key", ["workspaceId", "sourceKey"])
  .index("by_workspace_and_scope_key_and_source_key", [
    "workspaceId",
    "scopeKey",
    "sourceKey",
  ])
  .index("by_workspace_provider_scope_source", [
    "workspaceId",
    "provider",
    "scopeKey",
    "sourceKey",
  ])
  .index("by_workspace_provider_scope_status", [
    "workspaceId",
    "provider",
    "scopeKey",
    "status",
  ])
  .index("by_workspace_and_scope_key_and_status", [
    "workspaceId",
    "scopeKey",
    "status",
  ]);
