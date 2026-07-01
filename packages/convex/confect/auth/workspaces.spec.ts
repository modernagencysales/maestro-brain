import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";
import workspaces from "../_generated/tables/workspaces";

const list = FunctionSpec.publicQuery({
  name: "list",
  args: () => Schema.Struct({}),
  returns: () => Schema.Array(workspaces.Doc),
});

export default GroupSpec.make().addFunction(list);
