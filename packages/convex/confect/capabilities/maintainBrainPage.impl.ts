import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import databaseSchema from "../_generated/schema";
import maintainBrainPageGroup from "./maintainBrainPage.spec";

const maintainBrainPageImpl = FunctionImpl.make(
  databaseSchema,
  maintainBrainPageGroup,
  "maintainBrainPage",
  () =>
    Effect.succeed({
      status: "accepted" as const,
      summary:
        "Returns cited Brain revision proposals from an immutable context pack.",
    }),
);

export default GroupImpl.make(databaseSchema, maintainBrainPageGroup).pipe(
  Layer.provide(maintainBrainPageImpl),
  GroupImpl.finalize,
);
