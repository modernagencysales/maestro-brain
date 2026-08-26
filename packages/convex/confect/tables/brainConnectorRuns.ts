import { Table } from "@confect/server";
import * as S from "effect/Schema";
import { Id } from "../_generated/id";
import { BrainEvidenceProvider } from "./brainEvidenceSources";

export const BrainConnectorRunRow = S.Struct({
  workspaceId: Id("workspaces"),
  provider: BrainEvidenceProvider,
  scopeKey: S.String,
  runKey: S.String,
  status: S.Literals(["running", "complete", "failed"]),
  startedAt: S.Number,
  completedAt: S.optional(S.Number),
  discoveredCount: S.Number,
  publishedCount: S.Number,
  retiredCount: S.Number,
  failureCode: S.optional(S.String),
  createdAt: S.Number,
  updatedAt: S.Number,
});

export default Table.make(() => BrainConnectorRunRow)
  .index("by_workspace_and_run_key", ["workspaceId", "runKey"])
  .index("by_workspace_and_provider_and_scope_key", [
    "workspaceId",
    "provider",
    "scopeKey",
  ])
  .index("by_workspace_and_provider_and_status", [
    "workspaceId",
    "provider",
    "status",
  ])
  .index("by_workspace_and_provider_and_updated_at", [
    "workspaceId",
    "provider",
    "updatedAt",
  ]);
