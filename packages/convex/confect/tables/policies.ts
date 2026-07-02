import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

export default Table.make(() =>
  Schema.Struct({
    policyKey: Schema.String,
    kind: Schema.Literal("spend.limits", "agent.config", "prompt.override"),
    scope: Schema.Literal("system", "workspace"),
    workspaceId: Schema.optional(Schema.String),
    version: Schema.Number,
    status: Schema.Literal("draft", "active", "retired"),
    dataJson: Schema.String,
    evalRequired: Schema.Boolean,
    activatedByUserId: Schema.optional(Schema.String),
    activationReason: Schema.optional(Schema.String),
    createdAt: Schema.Number,
    activatedAt: Schema.NullOr(Schema.Number),
    retiredAt: Schema.NullOr(Schema.Number),
  }),
)
  .index("by_kind_scope_status", ["kind", "scope", "status"])
  .index("by_workspace_kind_status", ["workspaceId", "kind", "status"])
  .index("by_policy_version", ["policyKey", "version"]);
