import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";
import workflowRuns from "../_generated/tables/workflowRuns";
import workspaces from "../_generated/tables/workspaces";
import { NoRecoverableError } from "../errors";

const overview = FunctionSpec.publicQuery({
  name: "overview",
  args: () => Schema.Struct({}),
  returns: () =>
    Schema.Struct({
      workspace: Schema.NullOr(workspaces.Doc),
      workflowRuns: Schema.Array(workflowRuns.Doc),
    }),
  error: () => NoRecoverableError,
});

const seed = FunctionSpec.internalMutation({
  name: "seed",
  args: () => Schema.Struct({}),
  returns: () => Schema.Struct({ created: Schema.Boolean }),
});

export default GroupSpec.make().addFunction(overview).addFunction(seed);
