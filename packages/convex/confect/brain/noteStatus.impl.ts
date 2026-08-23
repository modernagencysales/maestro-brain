import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import databaseSchema from "../_generated/schema";
import { DatabaseReader } from "../_generated/services";
import { ValidationFailed } from "../errors";
import noteStatus from "./noteStatus.spec";
import { requireHeadlessBrainAccess } from "./pages.impl";

const summaryFor = (source: {
  readonly sourceKey: string;
  readonly title: string;
  readonly status: "pending_review" | "published" | "rejected";
  readonly submittedAt: number;
  readonly reviewedAt?: number | undefined;
}) => ({
  sourceKey: source.sourceKey,
  title: source.title,
  status: source.status,
  submittedAt: source.submittedAt,
  reviewedAt: source.reviewedAt ?? null,
});

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
    return summaryFor(source);
  }),
);

const list = FunctionImpl.make(databaseSchema, noteStatus, "list", (args) =>
  Effect.gen(function* () {
    const brain = yield* requireHeadlessBrainAccess(args);
    const reader = yield* DatabaseReader;
    const sources = yield* (
      args.status === undefined
        ? reader
            .table("brainSources")
            .index(
              "by_workspace",
              (query) => query.eq("workspaceId", brain.workspaceId),
              "desc",
            )
            .take(20)
        : reader
            .table("brainSources")
            .index(
              "by_workspace_status",
              (query) =>
                query
                  .eq("workspaceId", brain.workspaceId)
                  .eq("status", args.status as NonNullable<typeof args.status>),
              "desc",
            )
            .take(20)
    ).pipe(Effect.orDie);
    return { items: sources.map(summaryFor) };
  }),
);

export default GroupImpl.make(databaseSchema, noteStatus).pipe(
  Layer.provide(get),
  Layer.provide(list),
  GroupImpl.finalize,
);
