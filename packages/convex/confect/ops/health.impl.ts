import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import databaseSchema from "../_generated/schema";
import { buildTemplateHealthReport } from "./health";
import health from "./health.spec";

const liveness = FunctionImpl.make(
  databaseSchema,
  health,
  "liveness",
  (input) => Effect.succeed(buildTemplateHealthReport(input)),
);

export default GroupImpl.make(databaseSchema, health).pipe(
  Layer.provide(liveness),
  GroupImpl.finalize,
);
