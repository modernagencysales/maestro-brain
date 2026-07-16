import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { resolveEffectiveWorkspaceRole } from "../access/auth";
import { loadCurrentUser } from "../access/handlerContext";
import { roleAtLeast, type Role } from "../access/roles";
import refs from "../_generated/refs";
import databaseSchema from "../_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../_generated/services";
import { requireWorkspaceAccess } from "../capabilities/_kit/workspaceAccess";
import { NotFound, ValidationFailed } from "../errors";
import { withMutationErrorCapture } from "../observability/errorCapture";
import pages from "./pages.spec";

type PageDoc = BrainPage & { readonly _id: GenericId<"brainPages"> };
type MutationKind = "create" | "rename" | "move" | "favorite" | "archive";
const auditActions = {
  create: "page.created",
  rename: "page.renamed",
  move: "page.moved",
  favorite: "page.favoriteChanged",
  archive: "page.archived",
} as const satisfies Record<MutationKind, string>;
type BrainContext = {
  readonly workspaceId: GenericId<"workspaces">;
  readonly organizationId: string;
  readonly brainKey: string;
  readonly actorId: string;
};

const generationLive = (row: {
  readonly lifecycleGeneration?: number;
  readonly revocationGeneration?: number;
}) => (row.revocationGeneration ?? 0) <= (row.lifecycleGeneration ?? 0);
const unsafeAssumeClockProvided = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect as Effect.Effect<A, E, Exclude<R, Clock.Clock>>;

    const organization = (yield* reader
      .table("organizations")
      .index("by_workos_organization", (q) =>
        q.eq("workosOrganizationId", workosOrganizationId),
      )
      .collect()
      .pipe(Effect.orDie)).find(({ status }) => status === "active");
    const agencyKey = organization?.agencyKey;
    if (!agencyKey || !isStableAgencyKey(agencyKey))
      return yield* new BrainNotFound({ brainKey });

    const runQuery = yield* QueryRunner;
    const resolved = yield* runQuery(
      refs.internal.identity.stableKeys.resolveBrainKey,
      { agencyKey, brainKey },
    ).pipe(
      Effect.catchAll((error) =>
        error instanceof Unauthorized ||
        error instanceof Forbidden ||
        error instanceof ValidationFailed
          ? Effect.fail(error)
          : Effect.fail(new BrainNotFound({ brainKey })),
      ),
    );
    if (resolved.organizationId !== organization._id)
      return yield* new BrainNotFound({ brainKey });

    const workspace = yield* reader
      .table("workspaces")
      .get(resolved.workspaceId)
      .pipe(Effect.orDie);
    if (workspace === null || workspace.brainKey !== brainKey)
      return yield* new BrainNotFound({ brainKey });
    if (!generationLive(organization) || !generationLive(workspace))
      return yield* new LifecycleRevoked({ resource: "brain", key: brainKey });

    const workspaceMembers = yield* reader
      .table("workspaceMembers")
      .index("by_workspace_user", (q) =>
        q.eq("workspaceId", workspace._id).eq("userId", user._id),
      )
      .collect()
      .pipe(Effect.orDie);
    const organizationMembers = yield* reader
      .table("organizationMembers")
      .index("by_organization_user", (q) =>
        q.eq("organizationId", organization._id).eq("userId", user._id),
      )
      .collect()
      .pipe(Effect.orDie);
    const resolution = resolveEffectiveWorkspaceRole({
      nowMs: yield* unsafeAssumeClockProvided(Clock.currentTimeMillis),
      userId: user._id,
      workspace: {
        id: workspace._id,
        organizationId: workspace.organizationId,
        status: workspace.status,
      },
      organization: { id: organization._id, status: organization.status },
      workspaceMembers,
      organizationMembers,
      guestGrants: [],
    });
    if (!resolution.ok || !roleAtLeast(resolution.role, minimumRole))
      return yield* new Forbidden({ reason: "Insufficient Brain role." });
    return {
      workspaceId: workspace._id,
      organizationId: organization._id,
      brainKey,
      actorId: String(user._id),
    } satisfies BrainContext;
  });

const collectPages = (brain: BrainContext) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const rows = yield* reader
      .table("brainPages")
      .index("by_workspace", (q) => q.eq("workspaceId", brain.workspaceId))
      .collect()
      .pipe(Effect.orDie);
    return rows.map(asPageDoc);
  });

const loadPage = (brain: BrainContext, pageKey: string) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const page = yield* reader
      .table("brainPages")
      .index("by_workspace_page_key", (q) =>
        q.eq("workspaceId", brain.workspaceId).eq("pageKey", pageKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    if (
      page === null ||
      page.status !== "active" ||
      page.lifecycle?.state !== "active"
    )
      return yield* new PageNotFound({ pageKey });
    return asPageDoc(page);
  });

const requireCurrentRevision = (
  page: PageDoc,
  expectedCurrentRevisionKey: string | null,
) =>
  page.currentRevisionKey === expectedCurrentRevisionKey
    ? Effect.succeed(page.currentRevisionKey)
    : Effect.fail(
        new StaleRevision({
          pageKey: page.pageKey,
          expectedCurrentRevisionKey,
          actualCurrentRevisionKey: page.currentRevisionKey ?? null,
        }),
      );
      const reader = yield* DatabaseReader;
      return yield* reader
        .table("brainPages")
        .index("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect()
        .pipe(Effect.orDie);
    }),
);

const patchPage = (args: {
  brainKey: string;
  pageKey: string;
  expectedCurrentRevisionKey: string;
  patch: Partial<
    Pick<PageDoc, "parentPageKey" | "sortKey" | "favorite" | "status">
  >;
  title?: string;
  kind: MutationKind;
}) =>
  Effect.gen(function* () {
    const brain = yield* requireBrainAccess(args.brainKey, "editor");
    const page = yield* loadPage(brain, args.pageKey);
    yield* requireCurrentRevision(page, args.expectedCurrentRevisionKey);
    const at = yield* unsafeAssumeClockProvided(Clock.currentTimeMillis);
    const nextRevisionKey = revisionKeyFor(
      args.kind,
      page.pageKey,
      at,
      page.lifecycle.generation + 1,
    );
    const lifecycle = {
      ...page.lifecycle,
      ...(args.kind === "archive" ? { state: "archived" as const } : {}),
      generation: page.lifecycle.generation + 1,
      updatedAt: at,
    };
    const patch = {
      ...args.patch,
      ...(args.title === undefined ? {} : { title: args.title }),
      currentRevisionKey: nextRevisionKey,
      updatedAt: at,
      lifecycle,
    };
    const patchedPage = { ...page, ...patch };
    const writer = yield* DatabaseWriter;
    yield* writer.table("brainPages").patch(page._id, patch).pipe(Effect.orDie);
    yield* writePageRevision({
      brain,
      page: patchedPage,
      priorRevisionKey: page.currentRevisionKey,
      revisionKey: nextRevisionKey,
      kind: args.kind,
      at,
    });
    return toPublicPageSummary(patchedPage);
  });
const rename = FunctionImpl.make(databaseSchema, pages, "rename", (args) => {
  const title = usableTitle(args.title);
  return title === null
    ? Effect.fail(
        new ValidationFailed({ field: "title", message: "Invalid title." }),
      )
    : withMutationErrorCapture(
        "brain/pages.rename",
        patchPage({ ...args, title, patch: {}, kind: "rename" }),
      );
});
const move = FunctionImpl.make(databaseSchema, pages, "move", (args) =>
  withMutationErrorCapture(
    "brain/pages.move",
    Effect.gen(function* () {
      const brain = yield* requireBrainAccess(args.brainKey, "editor");
      const page = yield* loadPage(brain, args.pageKey);
      yield* requireCurrentRevision(page, args.expectedCurrentRevisionKey);
      const activePages = (yield* collectPages(brain)).filter(
        (candidate) =>
          candidate.status === "active" &&
          candidate.lifecycle.state === "active",
      );
      const parentByPageKey = new Map(
        activePages.map((p) => [p.pageKey, p.parentPageKey]),
      );
      if (
        args.parentPageKey !== null &&
        !parentByPageKey.has(args.parentPageKey)
      )
        return yield* new PageNotFound({ pageKey: args.parentPageKey });
      const conflict = cycleConflict({
        pageKey: page.pageKey,
        parentPageKey: args.parentPageKey,
        parentByPageKey,
      });
      if (conflict !== null) return yield* conflict;
      if (
        activePages.some(
          (candidate) =>
            candidate.pageKey !== page.pageKey &&
            candidate.parentPageKey === args.parentPageKey &&
            candidate.siblingSlug === page.siblingSlug,
        )
      )
        return yield* new PageTreeConflict({
          reason: "Duplicate sibling slug.",
        });
      return yield* patchPage({
        ...args,
        patch: { parentPageKey: args.parentPageKey, sortKey: args.sortKey },
        kind: "move",
      });
    }),
  ),
);
const favorite = FunctionImpl.make(databaseSchema, pages, "favorite", (args) =>
  withMutationErrorCapture(
    "brain/pages.favorite",
    patchPage({
      ...args,
      patch: { favorite: args.favorite },
      kind: "favorite",
    }),
  ),
);
const archive = FunctionImpl.make(databaseSchema, pages, "archive", (args) =>
  withMutationErrorCapture(
    "brain/pages.archive",
    patchPage({
      ...args,
      patch: { status: "archived" },
      kind: "archive",
    }),
  ),
);

const recordSnapshotInternal = FunctionImpl.make(
  databaseSchema,
  pages,
  "recordSnapshotInternal",
  ({ brainKey, pageKey, expectedCurrentRevisionKey, snapshot, version }) =>
    Effect.gen(function* () {
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      const page = yield* reader
        .table("brainPages")
        .get(pageId)
        .pipe(Effect.orDie);

      if (page === null) {
        return yield* new NotFound({ resource: "brainPages", id: pageId });
      }

      if (page.workspaceId !== workspaceId) {
        return yield* new ValidationFailed({
          field: "workspaceId",
          message: "Brain page does not belong to workspace.",
        });
      }

      const updatedAt = yield* unsafeAssumeClockProvided(
        Clock.currentTimeMillis,
      );
      yield* writer
        .table("brainPages")
        .patch(pageId, {
          editorSnapshotJson: snapshot,
          editorSnapshotVersion: version,
          updatedAt,
        })
        .pipe(Effect.orDie);

      return { ok: true as const };
    }),
);

export default GroupImpl.make(databaseSchema, pages).pipe(
  Layer.provide(list),
  Layer.provide(createMarkdown),
  Layer.provide(recordSnapshotInternal),
  GroupImpl.finalize,
);
