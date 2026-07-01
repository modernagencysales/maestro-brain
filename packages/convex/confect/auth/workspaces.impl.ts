import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import databaseSchema from "../_generated/schema";
import { DatabaseReader } from "../_generated/services";
import workspaces from "./workspaces.spec";

const list = FunctionImpl.make(databaseSchema, workspaces, "list", () =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    return yield* reader.table("workspaces").index("by_slug").collect().pipe(Effect.orDie);
  }),
);

export default GroupImpl.make(databaseSchema, workspaces).pipe(
  Layer.provide(list),
  GroupImpl.finalize,
);
