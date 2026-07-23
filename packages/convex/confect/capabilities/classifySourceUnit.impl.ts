import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Unauthorized } from "../errors";
import databaseSchema from "../_generated/schema";
import { classifySourceUnitLocally } from "./classifySourceUnit.domain";
import classifySourceUnitGroup from "./classifySourceUnit.spec";
const classifySourceUnitImpl = FunctionImpl.make(
  databaseSchema,
  classifySourceUnitGroup,
  "classifySourceUnit",
  ({ request, caller }) =>
    caller.kind === "system" &&
    (caller.surface === "workflow" || caller.surface === "internal")
      ? Effect.sync(() => classifySourceUnitLocally(request))
      : Effect.fail(new Unauthorized()),
);

export default GroupImpl.make(databaseSchema, classifySourceUnitGroup).pipe(
  Layer.provide(classifySourceUnitImpl),
  GroupImpl.finalize,
);
