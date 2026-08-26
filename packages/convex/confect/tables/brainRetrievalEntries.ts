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
  locator: S.optional(S.String),
  sourceModifiedAt: S.Number,
  observedAt: S.Number,
  status: S.Literals(["current", "retired"]),
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
  ]);
