import { Table } from "@confect/server";
import * as S from "effect/Schema";
import { Id } from "../_generated/id";

export const BrainRetrievalTokenRow = S.Struct({
  workspaceId: Id("workspaces"),
  token: S.String,
  entryKey: S.String,
  passageKey: S.optional(S.String),
  passageStartOffset: S.optional(S.Number),
  passageEndOffset: S.optional(S.Number),
  sourceKey: S.String,
  revisionKey: S.String,
  weight: S.Number,
  createdAt: S.Number,
});

export default Table.make(() => BrainRetrievalTokenRow)
  .index("by_workspace_and_token", ["workspaceId", "token"])
  .index("by_workspace_and_entry_key", ["workspaceId", "entryKey"]);
