import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import { Forbidden, ValidationFailed } from "../errors";

const NoteStatus = Schema.Literal("pending_review", "published", "rejected");
const NoteSummary = Schema.Struct({
  sourceKey: Schema.String,
  title: Schema.String,
  status: NoteStatus,
  submittedAt: Schema.Number,
  reviewedAt: Schema.NullOr(Schema.Number),
});

export const get = FunctionSpec.internalQuery({
  name: "get",
  args: () =>
    Schema.Struct({
      organizationId: Id("organizations"),
      workspaceId: Id("workspaces"),
      brainKey: Schema.String,
      sourceKey: Schema.String,
    }),
  returns: () => NoteSummary,
  error: () => Schema.Union(Forbidden, ValidationFailed),
});

export const list = FunctionSpec.internalQuery({
  name: "list",
  args: () =>
    Schema.Struct({
      organizationId: Id("organizations"),
      workspaceId: Id("workspaces"),
      brainKey: Schema.String,
      status: Schema.optional(NoteStatus),
    }),
  returns: () =>
    Schema.Struct({
      items: Schema.Array(NoteSummary).pipe(Schema.maxItems(20)),
    }),
  error: () => Schema.Union(Forbidden, ValidationFailed),
});

export default GroupSpec.make().addFunction(get).addFunction(list);
