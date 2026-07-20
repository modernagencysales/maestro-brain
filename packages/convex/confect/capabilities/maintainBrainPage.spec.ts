import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";
import { Forbidden, Unauthorized, ValidationFailed } from "../errors";

export const maintainBrainPageArgs = Schema.Struct({
  workspaceSlug: Schema.String,
  input: Schema.String,
});

export const maintainBrainPageReturns = Schema.Struct({
  status: Schema.Literal("accepted"),
  summary: Schema.String,
});

export const maintainBrainPage = FunctionSpec.publicMutation({
  name: "maintainBrainPage",
  args: () => maintainBrainPageArgs,
  returns: () => maintainBrainPageReturns,
  error: () => Schema.Union(Unauthorized, ValidationFailed, Forbidden),
});

export default GroupSpec.make().addFunction(maintainBrainPage);
