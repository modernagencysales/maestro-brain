import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import databaseSchema from "../_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../_generated/services";
import { WorkspaceNotFound } from "../errors";
import pages from "./pages.spec";

const requireWorkspace = (workspaceId: GenericId<"workspaces">) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    return yield* reader
      .table("workspaces")
      .get(workspaceId)
      .pipe(
        Effect.mapError(() => new WorkspaceNotFound({ workspaceId })),
      );
  });

const list = FunctionImpl.make(databaseSchema, pages, "list", ({ workspaceId }) =>
  Effect.gen(function* () {
    yield* requireWorkspace(workspaceId);
    const reader = yield* DatabaseReader;
    return yield* reader
      .table("brainPages")
      .index("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect()
      .pipe(Effect.orDie);
  }),
);

const createMarkdown = FunctionImpl.make(
  databaseSchema,
  pages,
  "createMarkdown",
  ({ workspaceId, slug, title, markdown }) =>
    Effect.gen(function* () {
      yield* requireWorkspace(workspaceId);
      const writer = yield* DatabaseWriter;
      return yield* writer
        .table("brainPages")
        .insert({
          workspaceId,
          slug,
          title,
          markdown,
          sourceKind: "markdown",
          updatedAt: Date.now(),
        })
        .pipe(Effect.orDie);
    }),
);

export default GroupImpl.make(databaseSchema, pages).pipe(
  Layer.provide(list),
  Layer.provide(createMarkdown),
  GroupImpl.finalize,
);
