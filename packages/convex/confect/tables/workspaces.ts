import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

export default Table.make(() =>
  Schema.Struct({
    organizationId: Schema.String,
    ownerUserId: Schema.String,
    brainKey: Schema.optional(Schema.String),
    slug: Schema.String,
    name: Schema.String,
    kind: Schema.optional(Schema.Literal("agency", "client")),
    clientSlug: Schema.optional(Schema.String),
    status: Schema.Literal("active", "archived"),
    dataClassification: Schema.Literal("public", "internal", "confidential"),
    createdAt: Schema.Number,
    updatedAt: Schema.Number,
    lifecycleGeneration: Schema.optional(Schema.Number),
    revocationGeneration: Schema.optional(Schema.Number),
  }),
)
  .index("by_slug", ["slug"])
  .index("by_organization", ["organizationId"])
  .index("by_owner", ["ownerUserId"])
  .index("by_organization_brain_key", ["organizationId", "brainKey"])
  .index("by_organization_kind", ["organizationId", "kind"]);
