import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import databaseSchema from "../_generated/schema";
import { DatabaseReader } from "../_generated/services";
import { ValidationFailed } from "../errors";
import noteStatus from "./noteStatus.spec";
import { requireHeadlessBrainAccess } from "./pages.impl";

const get = FunctionImpl.make(databaseSchema, noteStatus, "get", (args) =>
  Effect.gen(function* () {
    const brain = yield* requireHeadlessBrainAccess(args);
    const reader = yield* DatabaseReader;
    const source = yield* reader
      .table("brainSources")
      .index("by_workspace_source_key", (query) =>
        query
          .eq("workspaceId", brain.workspaceId)
          .eq("sourceKey", args.sourceKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    if (source === null)
      return yield* new ValidationFailed({
        field: "sourceKey",
        message: "Source not found.",
      });
    return {
      sourceKey: source.sourceKey,
      title: source.title,
      status: source.status,
      submittedAt: source.submittedAt,
      reviewedAt: source.reviewedAt ?? null,
    };
  }),
);

export default GroupImpl.make(databaseSchema, noteStatus).pipe(
  Layer.provide(get),
  GroupImpl.finalize,
);
