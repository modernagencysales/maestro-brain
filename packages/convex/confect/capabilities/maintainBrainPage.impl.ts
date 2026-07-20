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
      proposalKey: "proposal_fixture",
      status: "proposed_noop" as const,
      citationKeys: ["fixture_citation"],
      revisionEffect: null,
    }),
);

export default GroupImpl.make(databaseSchema, maintainBrainPageGroup).pipe(
  Layer.provide(maintainBrainPageImpl),
  GroupImpl.finalize,
);
