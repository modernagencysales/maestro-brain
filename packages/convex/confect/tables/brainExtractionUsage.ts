import { Table } from "@confect/server";
import * as Schema from "effect/Schema";
import { Id } from "../_generated/id";

// Lightweight daily extraction token and spend reservations for Company Brain.
export default Table.make(() =>
  Schema.Struct({
    workspaceId: Id("workspaces"),
    usageDay: Schema.Number,
    consumedTokens: Schema.Number,
    reservedTokens: Schema.Number,
    consumedSpendCents: Schema.Number,
    reservedSpendCents: Schema.Number,
    createdAt: Schema.Number,
    updatedAt: Schema.Number,
  }),
)
  .index("by_workspace", ["workspaceId"])
  .index("by_workspace_and_usage_day", ["workspaceId", "usageDay"]);
