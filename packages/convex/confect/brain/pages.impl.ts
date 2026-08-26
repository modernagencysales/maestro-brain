import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import databaseSchema from "../_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../_generated/services";
import {
  requireWorkspaceAccess,
  requireWorkspaceActorAccess,
} from "../capabilities/_kit/workspaceAccess";
import { NotFound, StaleRevision, ValidationFailed } from "../errors";
import { withMutationErrorCapture } from "../observability/errorCapture";
import { projectEvidence, retireEvidence } from "./evidenceProjection";
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

const publishPageEvidence = (page: {
  readonly _id: GenericId<"brainPages">;
  readonly workspaceId: GenericId<"workspaces">;
  readonly title: string;
  readonly markdown: string;
  readonly updatedAt: number;
  readonly status?: "active" | "archived" | undefined;
}) => {
  const sourceKey = `brain-page:${page._id}`;
  return (page.status ?? "active") === "archived"
    ? retireEvidence({
        workspaceId: page.workspaceId,
        sourceKey,
        revisionKey: `archived:${page.updatedAt}`,
        observedAt: page.updatedAt,
      }).pipe(Effect.map((changed) => ({ changed, entryKey: sourceKey })))
    : projectEvidence({
        workspaceId: page.workspaceId,
        provider: "brain_page",
        scopeKey: "brain-pages",
        sourceKey,
        revisionKey: String(page.updatedAt),
        title: page.title,
        markdown: page.markdown,
        sourceModifiedAt: page.updatedAt,
        observedAt: page.updatedAt,
      });
};

const listPages = (
  workspaceId: GenericId<"workspaces">,
  includeArchived?: boolean,
) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const rows = yield* reader
      .table("brainPages")
      .index("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .take(1_001)
      .pipe(Effect.orDie);
    if (rows.length > 1_000)
      return yield* new ValidationFailed({
        field: "workspaceId",
        message: "Brain page list capacity was exceeded.",
      });
    return rows.filter(
      (page) =>
        includeArchived === true || currentState(page).status === "active",
    );
  });

const pageHistory = (args: {
  readonly workspaceId: GenericId<"workspaces">;
  readonly pageId: GenericId<"brainPages">;
  readonly limit?: number | undefined;
}) =>
  Effect.gen(function* () {
    yield* requirePage(args.workspaceId, args.pageId);
    const reader = yield* DatabaseReader;
    const rows = yield* reader
      .table("pageRevisions")
      .index("by_workspace_page_updated", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("pageId", args.pageId),
      )
      .take(101)
      .pipe(Effect.orDie);
    if (rows.length > 100)
      return yield* new ValidationFailed({
        field: "pageId",
        message: "Brain page history capacity was exceeded.",
      });
    return rows
      .filter((revision) => "pageId" in revision)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, Math.min(Math.max(Math.floor(args.limit ?? 50), 1), 100));
  });

const list = FunctionImpl.make(databaseSchema, pages, "list", (args) =>
  Effect.gen(function* () {
    yield* unsafeAssumeClockProvided(
      requireWorkspaceAccess(args.workspaceId, "viewer"),
    );
    return yield* listPages(args.workspaceId, args.includeArchived);
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
    return yield* pageHistory(args);
  }),
);

const createMarkdownPage = (args: {
  readonly workspaceId: GenericId<"workspaces">;
  readonly slug: string;
  readonly title: string;
  readonly markdown: string;
  readonly importSourceKey?: string | undefined;
  readonly parentPageId?: GenericId<"brainPages"> | null | undefined;
  readonly sortKey?: string | undefined;
  readonly actorUserId: GenericId<"users">;
}) =>
  Effect.gen(function* () {
    const title = args.title.trim();
    if (title.length === 0 || title.length > 160)
      return yield* new ValidationFailed({
        field: "title",
        message: "Title must contain between 1 and 160 characters.",
      });
    const importSourceKey = args.importSourceKey?.trim();
    if (
      args.importSourceKey !== undefined &&
      (importSourceKey === undefined ||
        importSourceKey.length === 0 ||
        importSourceKey.length > 240)
    )
      return yield* new ValidationFailed({
        field: "importSourceKey",
        message: "Import source key must contain between 1 and 240 characters.",
      });
    const reader = yield* DatabaseReader;
    const slugMatches = yield* reader
      .table("brainPages")
      .index("by_workspace_slug", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("slug", args.slug),
      )
      .take(2)
      .pipe(Effect.orDie);
    if (slugMatches.length > 0)
      return yield* new ValidationFailed({
        field: "slug",
        message: "A Brain page with this slug already exists.",
      });
    if (importSourceKey !== undefined) {
      const sourceMatches = yield* reader
        .table("brainPages")
        .index("by_workspace_import_source", (q) =>
          q
            .eq("workspaceId", args.workspaceId)
            .eq("importSourceKey", importSourceKey),
        )
        .take(2)
        .pipe(Effect.orDie);
      if (sourceMatches.length > 0)
        return yield* new ValidationFailed({
          field: "importSourceKey",
          message: "A Brain page for this import source already exists.",
        });
    }
    if (args.parentPageId !== undefined && args.parentPageId !== null) {
      const parent = yield* requirePage(args.workspaceId, args.parentPageId);
      if (currentState(parent).status !== "active")
        return yield* new ValidationFailed({
          field: "parentPageId",
          message: "Parent page must be active.",
        });
    }
    const updatedAt = yield* unsafeAssumeClockProvided(Clock.currentTimeMillis);
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
        ...(importSourceKey === undefined ? {} : { importSourceKey }),
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
      actorUserId: args.actorUserId,
    });
    yield* publishPageEvidence({
      _id: pageId,
      workspaceId: args.workspaceId,
      title,
      markdown: args.markdown,
      updatedAt,
      status: "active",
    });
    return pageId;
  });

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
        return yield* createMarkdownPage({
          ...args,
          actorUserId: access.userId,
        });
      }),
    ),
);

const patchPage = (input: {
  readonly workspaceId: GenericId<"workspaces">;
  readonly pageId: GenericId<"brainPages">;
  readonly expectedUpdatedAt: number;
  readonly causation: Exclude<RevisionCausation, "create" | "restore">;
  readonly patch: Record<string, unknown>;
  readonly expectedImportSourceKey?: string | undefined;
  readonly adoptImportSourceKey?: string | undefined;
  readonly actorUserId: GenericId<"users">;
}) =>
  Effect.gen(function* () {
    const page = yield* requirePage(input.workspaceId, input.pageId);
    if (
      input.expectedImportSourceKey !== undefined &&
      input.adoptImportSourceKey !== undefined
    )
      return yield* new ValidationFailed({
        field: "adoptImportSourceKey",
        message: "Import ownership cannot be asserted and adopted together.",
      });
    if (
      input.expectedImportSourceKey !== undefined &&
      page.importSourceKey !== input.expectedImportSourceKey
    )
      return yield* new ValidationFailed({
        field: "expectedImportSourceKey",
        message: "The page is not owned by this import source.",
      });
    const adoptImportSourceKey = input.adoptImportSourceKey?.trim();
    if (input.adoptImportSourceKey !== undefined) {
      if (
        adoptImportSourceKey === undefined ||
        adoptImportSourceKey.length === 0 ||
        adoptImportSourceKey.length > 240
      )
        return yield* new ValidationFailed({
          field: "adoptImportSourceKey",
          message: "Adopted import source key is invalid.",
        });
      if (page.importSourceKey !== undefined)
        return yield* new ValidationFailed({
          field: "adoptImportSourceKey",
          message: "The page already belongs to an import source.",
        });
      const reader = yield* DatabaseReader;
      const sourceMatches = yield* reader
        .table("brainPages")
        .index("by_workspace_import_source", (q) =>
          q
            .eq("workspaceId", input.workspaceId)
            .eq("importSourceKey", adoptImportSourceKey),
        )
        .take(2)
        .pipe(Effect.orDie);
      if (sourceMatches.length > 0)
        return yield* new ValidationFailed({
          field: "adoptImportSourceKey",
          message: "This import source already belongs to another page.",
        });
    }
    yield* requireCurrentRevision(page, input.expectedUpdatedAt);
    const updatedAt = nextPageUpdatedAt(
      page.updatedAt,
      yield* unsafeAssumeClockProvided(Clock.currentTimeMillis),
    );
    const patch = {
      ...input.patch,
      ...(adoptImportSourceKey === undefined
        ? {}
        : { importSourceKey: adoptImportSourceKey }),
    };
    const patchedPage = { ...page, ...patch, updatedAt };
    const writer = yield* DatabaseWriter;
    yield* writer
      .table("brainPages")
      .patch(page._id, { ...patch, updatedAt })
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
      actorUserId: input.actorUserId,
    });
    yield* publishPageEvidence(patchedPage);
    return patchedPage;
  });

const updateMarkdown = FunctionImpl.make(
  databaseSchema,
  pages,
  "updateMarkdown",
  (args) =>
    withMutationErrorCapture(
      "brain/pages.updateMarkdown",
      Effect.gen(function* () {
        const title = args.title?.trim();
        if (
          args.title !== undefined &&
          (title === undefined || title.length === 0 || title.length > 160)
        )
          return yield* new ValidationFailed({
            field: "title",
            message: "Title must contain between 1 and 160 characters.",
          });
        const access = yield* unsafeAssumeClockProvided(
          requireWorkspaceAccess(args.workspaceId, "editor"),
        );
        return yield* patchPage({
          ...args,
          causation: "update",
          patch: {
            markdown: args.markdown,
            ...(title === undefined ? {} : { title }),
          },
          actorUserId: access.userId,
        });
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
        Effect.gen(function* () {
          const access = yield* unsafeAssumeClockProvided(
            requireWorkspaceAccess(args.workspaceId, "editor"),
          );
          return yield* patchPage({
            ...args,
            causation: "rename",
            patch: { title },
            actorUserId: access.userId,
          });
        }),
      );
});

const move = FunctionImpl.make(databaseSchema, pages, "move", (args) =>
  withMutationErrorCapture(
    "brain/pages.move",
    Effect.gen(function* () {
      const access = yield* unsafeAssumeClockProvided(
        requireWorkspaceAccess(args.workspaceId, "editor"),
      );
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
        actorUserId: access.userId,
      });
    }),
  ),
);

const favorite = FunctionImpl.make(databaseSchema, pages, "favorite", (args) =>
  withMutationErrorCapture(
    "brain/pages.favorite",
    Effect.gen(function* () {
      const access = yield* unsafeAssumeClockProvided(
        requireWorkspaceAccess(args.workspaceId, "editor"),
      );
      return yield* patchPage({
        ...args,
        causation: "favorite",
        patch: { favorite: args.favorite },
        actorUserId: access.userId,
      });
    }),
  ),
);

const archive = FunctionImpl.make(databaseSchema, pages, "archive", (args) =>
  withMutationErrorCapture(
    "brain/pages.archive",
    Effect.gen(function* () {
      const access = yield* unsafeAssumeClockProvided(
        requireWorkspaceAccess(args.workspaceId, "editor"),
      );
      return yield* patchPage({
        ...args,
        causation: "archive",
        patch: { status: "archived" },
        actorUserId: access.userId,
      });
    }),
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
      if (revision === null || !("pageId" in revision))
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
      yield* publishPageEvidence(restoredPage);
      return restoredPage;
    }),
  ),
);

const listForActor = FunctionImpl.make(
  databaseSchema,
  pages,
  "listForActor",
  ({ workspaceId, userId, includeArchived }) =>
    Effect.gen(function* () {
      yield* unsafeAssumeClockProvided(
        requireWorkspaceActorAccess(workspaceId, userId, "viewer"),
      );
      return yield* listPages(workspaceId, includeArchived);
    }),
);

const getForActor = FunctionImpl.make(
  databaseSchema,
  pages,
  "getForActor",
  ({ workspaceId, userId, pageId }) =>
    Effect.gen(function* () {
      yield* unsafeAssumeClockProvided(
        requireWorkspaceActorAccess(workspaceId, userId, "viewer"),
      );
      return yield* requirePage(workspaceId, pageId);
    }),
);

const historyForActor = FunctionImpl.make(
  databaseSchema,
  pages,
  "historyForActor",
  ({ workspaceId, userId, pageId, limit }) =>
    Effect.gen(function* () {
      yield* unsafeAssumeClockProvided(
        requireWorkspaceActorAccess(workspaceId, userId, "viewer"),
      );
      return yield* pageHistory({ workspaceId, pageId, limit });
    }),
);

const createMarkdownForActor = FunctionImpl.make(
  databaseSchema,
  pages,
  "createMarkdownForActor",
  ({ userId, ...args }) =>
    withMutationErrorCapture(
      "brain/pages.createMarkdownForActor",
      Effect.gen(function* () {
        yield* unsafeAssumeClockProvided(
          requireWorkspaceActorAccess(args.workspaceId, userId, "editor"),
        );
        return yield* createMarkdownPage({ ...args, actorUserId: userId });
      }),
    ),
);

const updateMarkdownForActor = FunctionImpl.make(
  databaseSchema,
  pages,
  "updateMarkdownForActor",
  ({ userId, ...args }) =>
    withMutationErrorCapture(
      "brain/pages.updateMarkdownForActor",
      Effect.gen(function* () {
        const title = args.title?.trim();
        if (
          args.title !== undefined &&
          (title === undefined || title.length === 0 || title.length > 160)
        )
          return yield* new ValidationFailed({
            field: "title",
            message: "Title must contain between 1 and 160 characters.",
          });
        yield* unsafeAssumeClockProvided(
          requireWorkspaceActorAccess(args.workspaceId, userId, "editor"),
        );
        return yield* patchPage({
          ...args,
          causation: "update",
          patch: {
            markdown: args.markdown,
            ...(title === undefined ? {} : { title }),
          },
          actorUserId: userId,
        });
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
  Layer.provide(listForActor),
  Layer.provide(getForActor),
  Layer.provide(createMarkdownForActor),
  Layer.provide(updateMarkdownForActor),
  Layer.provide(historyForActor),
  Layer.provide(rename),
  Layer.provide(move),
  Layer.provide(favorite),
  Layer.provide(archive),
  Layer.provide(restore),
  Layer.provide(recordSnapshotInternal),
  GroupImpl.finalize,
);
