import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import databaseSchema from "../_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../_generated/services";
import { requireWorkspaceAccess } from "../capabilities/_kit/workspaceAccess";
import { NotFound, StaleRevision, ValidationFailed } from "../errors";
import { withMutationErrorCapture } from "../observability/errorCapture";
import pages from "./pages.spec";
import { nextPageUpdatedAt } from "./pageRevision";
import { isAdvancingSnapshotVersion } from "./snapshotVersion";

const unsafeAssumeClockProvided = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect as Effect.Effect<A, E, Exclude<R, Clock.Clock>>;

type PageState = {
  readonly parentPageId: GenericId<"brainPages"> | null;
  readonly sortKey: string;
  readonly favorite: boolean;
  readonly status: "active" | "archived";
};

const currentState = (page: {
  readonly parentPageId?: GenericId<"brainPages"> | null | undefined;
  readonly sortKey?: string | undefined;
  readonly favorite?: boolean | undefined;
  readonly status?: "active" | "archived" | undefined;
  readonly slug: string;
}): PageState => ({
  parentPageId: page.parentPageId ?? null,
  sortKey: page.sortKey ?? page.slug,
  favorite: page.favorite ?? false,
  status: page.status ?? "active",
});

const requirePage = (
  workspaceId: GenericId<"workspaces">,
  pageId: GenericId<"brainPages">,
) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const page = yield* reader
      .table("brainPages")
      .get(pageId)
      .pipe(Effect.orDie);
    if (page === null || page.workspaceId !== workspaceId)
      return yield* new NotFound({ resource: "brainPages", id: pageId });
    return page;
  });

const requireCurrentRevision = (
  page: { readonly _id: GenericId<"brainPages">; readonly updatedAt: number },
  expectedUpdatedAt: number,
) =>
  page.updatedAt === expectedUpdatedAt
    ? Effect.void
    : Effect.fail(
        new StaleRevision({
          pageId: page._id,
          expectedUpdatedAt,
          actualUpdatedAt: page.updatedAt,
        }),
      );

type RevisionCausation =
  "create" | "update" | "rename" | "move" | "favorite" | "archive" | "restore";

const writeRevision = (input: {
  readonly workspaceId: GenericId<"workspaces">;
  readonly pageId: GenericId<"brainPages">;
  readonly priorUpdatedAt: number | null;
  readonly updatedAt: number;
  readonly title: string;
  readonly markdown: string;
  readonly sourceKind: "markdown" | "link" | "note";
  readonly causation: RevisionCausation;
  readonly state: PageState;
  readonly actorUserId: GenericId<"users">;
}) =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
    yield* writer
      .table("pageRevisions")
      .insert({
        workspaceId: input.workspaceId,
        pageId: input.pageId,
        priorUpdatedAt: input.priorUpdatedAt,
        updatedAt: input.updatedAt,
        title: input.title,
        markdown: input.markdown,
        sourceKind: input.sourceKind,
        causation: input.causation,
        parentPageId: input.state.parentPageId,
        sortKey: input.state.sortKey,
        favorite: input.state.favorite,
        status: input.state.status,
        actorUserId: input.actorUserId,
        createdAt: input.updatedAt,
      })
      .pipe(Effect.orDie);
  });

const list = FunctionImpl.make(databaseSchema, pages, "list", (args) =>
  Effect.gen(function* () {
    yield* unsafeAssumeClockProvided(
      requireWorkspaceAccess(args.workspaceId, "viewer"),
    );
    const reader = yield* DatabaseReader;
    const rows = yield* reader
      .table("brainPages")
      .index("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect()
      .pipe(Effect.orDie);
    return rows.filter(
      (page) =>
        args.includeArchived === true || currentState(page).status === "active",
    );
  }),
);

const get = FunctionImpl.make(databaseSchema, pages, "get", (args) =>
  Effect.gen(function* () {
    yield* unsafeAssumeClockProvided(
      requireWorkspaceAccess(args.workspaceId, "viewer"),
    );
    return yield* requirePage(args.workspaceId, args.pageId);
  }),
);

const history = FunctionImpl.make(databaseSchema, pages, "history", (args) =>
  Effect.gen(function* () {
    yield* unsafeAssumeClockProvided(
      requireWorkspaceAccess(args.workspaceId, "viewer"),
    );
    yield* requirePage(args.workspaceId, args.pageId);
    const reader = yield* DatabaseReader;
    const rows = yield* reader
      .table("pageRevisions")
      .index("by_workspace_page_updated", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("pageId", args.pageId),
      )
      .collect()
      .pipe(Effect.orDie);
    return [...rows]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, Math.min(Math.max(Math.floor(args.limit ?? 50), 1), 100));
  }),
);

const createMarkdown = FunctionImpl.make(
  databaseSchema,
  pages,
  "createMarkdown",
  (args) =>
    withMutationErrorCapture(
      "brain/pages.createMarkdown",
      Effect.gen(function* () {
        const access = yield* unsafeAssumeClockProvided(
          requireWorkspaceAccess(args.workspaceId, "editor"),
        );
        const title = args.title.trim();
        if (title.length === 0 || title.length > 160)
          return yield* new ValidationFailed({
            field: "title",
            message: "Title must contain between 1 and 160 characters.",
          });
        if (args.parentPageId !== undefined && args.parentPageId !== null) {
          const parent = yield* requirePage(
            args.workspaceId,
            args.parentPageId,
          );
          if (currentState(parent).status !== "active")
            return yield* new ValidationFailed({
              field: "parentPageId",
              message: "Parent page must be active.",
            });
        }
        const updatedAt = yield* unsafeAssumeClockProvided(
          Clock.currentTimeMillis,
        );
        const state = {
          parentPageId: args.parentPageId ?? null,
          sortKey: args.sortKey ?? args.slug,
          favorite: false,
          status: "active" as const,
        };
        const writer = yield* DatabaseWriter;
        const pageId = yield* writer
          .table("brainPages")
          .insert({
            workspaceId: args.workspaceId,
            slug: args.slug,
            title,
            markdown: args.markdown,
            sourceKind: "markdown",
            ...state,
            createdAt: updatedAt,
            updatedAt,
          })
          .pipe(Effect.orDie);
        yield* writeRevision({
          workspaceId: args.workspaceId,
          pageId,
          priorUpdatedAt: null,
          updatedAt,
          title,
          markdown: args.markdown,
          sourceKind: "markdown",
          causation: "create",
          state,
          actorUserId: access.userId,
        });
        return pageId;
      }),
    ),
);

const patchPage = (input: {
  readonly workspaceId: GenericId<"workspaces">;
  readonly pageId: GenericId<"brainPages">;
  readonly expectedUpdatedAt: number;
  readonly causation: Exclude<RevisionCausation, "create" | "restore">;
  readonly patch: Record<string, unknown>;
}) =>
  Effect.gen(function* () {
    const access = yield* unsafeAssumeClockProvided(
      requireWorkspaceAccess(input.workspaceId, "editor"),
    );
    const page = yield* requirePage(input.workspaceId, input.pageId);
    yield* requireCurrentRevision(page, input.expectedUpdatedAt);
    const updatedAt = nextPageUpdatedAt(
      page.updatedAt,
      yield* unsafeAssumeClockProvided(Clock.currentTimeMillis),
    );
    const patchedPage = { ...page, ...input.patch, updatedAt };
    const writer = yield* DatabaseWriter;
    yield* writer
      .table("brainPages")
      .patch(page._id, { ...input.patch, updatedAt })
      .pipe(Effect.orDie);
    yield* writeRevision({
      workspaceId: input.workspaceId,
      pageId: page._id,
      priorUpdatedAt: page.updatedAt,
      updatedAt,
      title: patchedPage.title,
      markdown: patchedPage.markdown,
      sourceKind: patchedPage.sourceKind,
      causation: input.causation,
      state: currentState(patchedPage),
      actorUserId: access.userId,
    });
    return patchedPage;
  });

const updateMarkdown = FunctionImpl.make(
  databaseSchema,
  pages,
  "updateMarkdown",
  (args) =>
    withMutationErrorCapture(
      "brain/pages.updateMarkdown",
      patchPage({
        ...args,
        causation: "update",
        patch: { markdown: args.markdown },
      }),
    ),
);

const rename = FunctionImpl.make(databaseSchema, pages, "rename", (args) => {
  const title = args.title.trim();
  return title.length === 0 || title.length > 160
    ? Effect.fail(
        new ValidationFailed({
          field: "title",
          message: "Title must contain between 1 and 160 characters.",
        }),
      )
    : withMutationErrorCapture(
        "brain/pages.rename",
        patchPage({ ...args, causation: "rename", patch: { title } }),
      );
});

const move = FunctionImpl.make(databaseSchema, pages, "move", (args) =>
  withMutationErrorCapture(
    "brain/pages.move",
    Effect.gen(function* () {
      const page = yield* requirePage(args.workspaceId, args.pageId);
      yield* requireCurrentRevision(page, args.expectedUpdatedAt);
      if (args.parentPageId === args.pageId)
        return yield* new ValidationFailed({
          field: "parentPageId",
          message: "A page cannot be its own parent.",
        });
      if (args.parentPageId !== null) {
        let parent = yield* requirePage(args.workspaceId, args.parentPageId);
        const seen = new Set<string>([args.pageId]);
        while (true) {
          if (seen.has(parent._id))
            return yield* new ValidationFailed({
              field: "parentPageId",
              message: "Page move would create a cycle.",
            });
          seen.add(parent._id);
          const ancestorId = currentState(parent).parentPageId;
          if (ancestorId === null) break;
          parent = yield* requirePage(args.workspaceId, ancestorId);
        }
      }
      return yield* patchPage({
        ...args,
        causation: "move",
        patch: { parentPageId: args.parentPageId, sortKey: args.sortKey },
      });
    }),
  ),
);

const favorite = FunctionImpl.make(databaseSchema, pages, "favorite", (args) =>
  withMutationErrorCapture(
    "brain/pages.favorite",
    patchPage({
      ...args,
      causation: "favorite",
      patch: { favorite: args.favorite },
    }),
  ),
);

const archive = FunctionImpl.make(databaseSchema, pages, "archive", (args) =>
  withMutationErrorCapture(
    "brain/pages.archive",
    patchPage({ ...args, causation: "archive", patch: { status: "archived" } }),
  ),
);

const restore = FunctionImpl.make(databaseSchema, pages, "restore", (args) =>
  withMutationErrorCapture(
    "brain/pages.restore",
    Effect.gen(function* () {
      const access = yield* unsafeAssumeClockProvided(
        requireWorkspaceAccess(args.workspaceId, "editor"),
      );
      const page = yield* requirePage(args.workspaceId, args.pageId);
      yield* requireCurrentRevision(page, args.expectedUpdatedAt);
      const reader = yield* DatabaseReader;
      const revision = yield* reader
        .table("pageRevisions")
        .index("by_workspace_page_updated", (q) =>
          q
            .eq("workspaceId", args.workspaceId)
            .eq("pageId", args.pageId)
            .eq("updatedAt", args.revisionUpdatedAt),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      if (revision === null)
        return yield* new NotFound({
          resource: "pageRevisions",
          id: `${args.pageId}:${args.revisionUpdatedAt}`,
        });
      const updatedAt = nextPageUpdatedAt(
        page.updatedAt,
        yield* unsafeAssumeClockProvided(Clock.currentTimeMillis),
      );
      const patch = {
        title: revision.title,
        markdown: revision.markdown,
        sourceKind: revision.sourceKind,
        parentPageId: revision.parentPageId,
        sortKey: revision.sortKey,
        favorite: revision.favorite,
        status: revision.status,
        updatedAt,
      };
      const restoredPage = { ...page, ...patch };
      const writer = yield* DatabaseWriter;
      yield* writer
        .table("brainPages")
        .patch(page._id, patch)
        .pipe(Effect.orDie);
      yield* writeRevision({
        workspaceId: args.workspaceId,
        pageId: page._id,
        priorUpdatedAt: page.updatedAt,
        updatedAt,
        title: restoredPage.title,
        markdown: restoredPage.markdown,
        sourceKind: restoredPage.sourceKind,
        causation: "restore",
        state: currentState(restoredPage),
        actorUserId: access.userId,
      });
      return restoredPage;
    }),
  ),
);

const recordSnapshotInternal = FunctionImpl.make(
  databaseSchema,
  pages,
  "recordSnapshotInternal",
  (args) =>
    Effect.gen(function* () {
      const page = yield* requirePage(args.workspaceId, args.pageId);
      if (!isAdvancingSnapshotVersion(page.editorSnapshotVersion, args.version))
        return yield* new ValidationFailed({
          field: "version",
          message: "Snapshot version must be a newer positive safe integer.",
        });
      const writer = yield* DatabaseWriter;
      yield* writer
        .table("brainPages")
        .patch(page._id, {
          editorSnapshotJson: args.snapshot,
          editorSnapshotVersion: args.version,
        })
        .pipe(Effect.orDie);
      return { ok: true as const };
    }),
);

export default GroupImpl.make(databaseSchema, pages).pipe(
  Layer.provide(list),
  Layer.provide(get),
  Layer.provide(history),
  Layer.provide(createMarkdown),
  Layer.provide(updateMarkdown),
  Layer.provide(rename),
  Layer.provide(move),
  Layer.provide(favorite),
  Layer.provide(archive),
  Layer.provide(restore),
  Layer.provide(recordSnapshotInternal),
  GroupImpl.finalize,
);
