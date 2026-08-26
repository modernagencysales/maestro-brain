import { Table } from "@confect/server";
import * as S from "effect/Schema";
import { Id } from "../_generated/id";

export const BrainConnectorRunSeenRow = S.Struct({
  workspaceId: Id("workspaces"),
  runKey: S.String,
  sourceKey: S.String,
  observedAt: S.Number,
});

export default Table.make(() => BrainConnectorRunSeenRow)
  .index("by_workspace_and_run_key", ["workspaceId", "runKey"])
  .index("by_workspace_and_run_key_and_source_key", [
    "workspaceId",
    "runKey",
    "sourceKey",
  ]);
