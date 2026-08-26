import { Table } from "@confect/server";
import * as S from "effect/Schema";
import { Id } from "../_generated/id";
import { BrainEvidenceProvider } from "./brainEvidenceSources";

export const BrainEvidenceRevisionRow = S.Struct({
  workspaceId: Id("workspaces"),
  provider: BrainEvidenceProvider,
  scopeKey: S.String,
  sourceKey: S.String,
  revisionKey: S.String,
  title: S.String,
  markdown: S.String,
  contentHash: S.String,
  locator: S.optional(S.String),
  sourceModifiedAt: S.Number,
  observedAt: S.Number,
  tombstone: S.Boolean,
  createdAt: S.Number,
});

export default Table.make(() => BrainEvidenceRevisionRow)
  .index("by_workspace_and_revision_key", ["workspaceId", "revisionKey"])
  .index("by_workspace_and_source_key", ["workspaceId", "sourceKey"])
  .index("by_workspace_and_source_key_and_revision_key", [
    "workspaceId",
    "sourceKey",
    "revisionKey",
  ]);
