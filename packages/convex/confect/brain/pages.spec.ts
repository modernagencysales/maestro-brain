import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";
import { WorkspaceNotFound } from "../errors";
import { Id } from "../_generated/id";
import brainPages from "../_generated/tables/brainPages";

const list = FunctionSpec.publicQuery({
  name: "list",
  args: () =>
    Schema.Struct({
      workspaceId: Id("workspaces"),
    }),
  returns: () => Schema.Array(brainPages.Doc),
  error: () => WorkspaceNotFound,
});

const createMarkdown = FunctionSpec.publicMutation({
  name: "createMarkdown",
  args: () =>
    Schema.Struct({
      workspaceId: Id("workspaces"),
      slug: Schema.String,
      title: Schema.String,
      markdown: Schema.String,
    }),
  returns: () => Id("brainPages"),
  error: () => Schema.Union(WorkspaceNotFound),
});

export default GroupSpec.make().addFunction(list).addFunction(createMarkdown);
