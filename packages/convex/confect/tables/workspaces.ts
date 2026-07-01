import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

export default Table.make(() =>
  Schema.Struct({
    slug: Schema.String,
    name: Schema.String,
    status: Schema.Literal("active", "archived"),
    dataClassification: Schema.Literal("public", "internal", "confidential"),
    createdAt: Schema.Number,
  }),
).index("by_slug", ["slug"]);
