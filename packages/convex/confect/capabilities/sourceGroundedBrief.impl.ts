import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import databaseSchema from "../_generated/schema";
import {
  normalizeSourceGroundedBriefInput,
  runFakeSourceGroundedBrief,
} from "./sourceGroundedBrief.domain";
import sourceGroundedBrief from "./sourceGroundedBrief.spec";

const run = FunctionImpl.make(
  databaseSchema,
  sourceGroundedBrief,
  "run",
  (input) =>
    Effect.succeed(
      runFakeSourceGroundedBrief({
        input: normalizeSourceGroundedBriefInput(input),
        sources: input.sourceIds.map((sourceId) => ({
          id: sourceId,
          title: `Source ${sourceId}`,
          markdown: "Synthetic source content for fake-mode capability run.",
        })),
        policySnapshotId: `policy_snapshot_${input.idempotencyKey}`,
        modelReceiptId: `model_receipt_${input.idempotencyKey}`,
      }),
    ),
);

export default GroupImpl.make(databaseSchema, sourceGroundedBrief).pipe(
  Layer.provide(run),
  GroupImpl.finalize,
);
