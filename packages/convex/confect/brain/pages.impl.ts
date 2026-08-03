import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { resolveEffectiveWorkspaceRole } from "../access/auth";
import { roleAtLeast, type Role } from "../access/roles";
import refs from "../_generated/refs";
import { ResolveBrainKeyReturns } from "../identity/stableKeys.spec";
import databaseSchema from "../_generated/schema";
import {
  Auth,
  DatabaseReader,
  DatabaseWriter,
  QueryRunner,
} from "../_generated/services";
import { isStableAgencyKey } from "../identity/stableKeys";
import { Forbidden, Unauthorized, ValidationFailed } from "../errors";
import { withMutationErrorCapture } from "../observability/errorCapture";
import { sha256Hex } from "../shared/sha256";
import {
  BrainNotFound,
  LifecycleRevoked,
  PageNotFound,
  PageTreeConflict,
  StaleRevision,
  cycleConflict,
  usableTitle,
} from "./pageTree";
import { toPublicPageSummary, type BrainPage } from "./pageSchemas";
import pages from "./pages.spec";

type PageDoc = BrainPage & { readonly _id: GenericId<"brainPages"> };
type MutationKind =
  "create" | "rename" | "move" | "favorite" | "archive" | "snapshot";
type AccessError = Unauthorized | Forbidden | BrainNotFound | LifecycleRevoked;
type ReadPageError = AccessError | ValidationFailed | PageNotFound;
type PageError = ReadPageError | PageTreeConflict | StaleRevision;
type ReadPageDeps = Auth | DatabaseReader | QueryRunner;
type PageDeps = ReadPageDeps | DatabaseWriter;
const auditActions = {
  create: "page.created",
  rename: "page.renamed",
  move: "page.moved",
  favorite: "page.favoriteChanged",
  archive: "page.archived",
} as const satisfies Record<Exclude<MutationKind, "snapshot">, string>;
type BrainContext = {
  readonly workspaceId: GenericId<"workspaces">;
  readonly organizationId: string;
  readonly brainKey: string;
  readonly actorId: string;
};

const generationLive = (row: {
  readonly lifecycleGeneration?: number | undefined;
  readonly revocationGeneration?: number | undefined;
}) => (row.revocationGeneration ?? 0) <= (row.lifecycleGeneration ?? 0);
const unsafeAssumeClockProvided = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect as Effect.Effect<A, E, Exclude<R, Clock.Clock>>;
const asPageDoc = (page: unknown): PageDoc => page as PageDoc;
const nextKey = (prefix: "pag" | "rev", at: number) =>
  `${prefix}_${at.toString(36).padStart(8, "0")}`;
const hashJson = (value: unknown) => sha256Hex(JSON.stringify(value));
const activeLifecycle = (updatedAt: number, generation: number) => ({
  state: "active" as const,
  generation,
  updatedAt,
  purgeAfter: null,
});
const revisionKeyFor = (
  kind: MutationKind,
  pageKey: string,
  at: number,
  generation: number,
) => `rev_${hashJson({ kind, pageKey, at, generation }).slice(0, 32)}`;
const effectKeyFor = (
  kind: MutationKind,
  pageKey: string,
  revisionKey: string,
) => `brain.pages.${kind}:${pageKey}:${revisionKey}`;
export const requireBrainAccess = (
  brainKey: string,
  minimumRole: Role,
): Effect.Effect<BrainContext, AccessError, ReadPageDeps> =>
  Effect.gen(function* () {
    const auth = yield* Auth;
    const reader = yield* DatabaseReader;
    const claims = yield* auth.getUserIdentity.pipe(
      Effect.mapError(() => new Unauthorized()),
    );
    const users = yield* reader
      .table("users")
      .index("by_subject", (q) => q.eq("subject", claims.subject))
      .collect()
      .pipe(Effect.orDie);
    if (users.length !== 1) return yield* new Unauthorized();
    const user = users[0];
    if (user === undefined || user.status !== "active")
      return yield* new Unauthorized();
    const workosOrganizationId =
      typeof claims?.workosOrganizationId === "string"
        ? claims.workosOrganizationId
        : typeof claims?.organizationId === "string"
          ? claims.organizationId
          : typeof claims?.org_id === "string"
            ? claims.org_id
            : undefined;
    if (workosOrganizationId === undefined) return yield* new Unauthorized();

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
      Effect.flatMap(Schema.decodeUnknown(ResolveBrainKeyReturns)),
      Effect.catchAll(() =>
        Effect.gen(function* () {
          const candidateWorkspaces = yield* reader
            .table("workspaces")
            .index("by_organization_brain_key", (q) =>
              q.eq("organizationId", organization._id).eq("brainKey", brainKey),
            )
            .collect()
            .pipe(Effect.orDie);
          const candidate = candidateWorkspaces[0];
          if (
            candidateWorkspaces.length === 1 &&
            candidate?.status === "archived"
          )
            return yield* new LifecycleRevoked({
              resource: "brain",
              key: brainKey,
            });
          return yield* new BrainNotFound({ brainKey });
        }),
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

const loadPage = (
  brain: BrainContext,
  pageKey: string,
): Effect.Effect<PageDoc, PageNotFound, DatabaseReader> =>
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

const writePageRevision = (args: {
  readonly brain: BrainContext;
  readonly page: Omit<BrainPage, "currentRevisionKey"> & {
    readonly currentRevisionKey: string;
  };
  readonly priorRevisionKey: string | null;
  readonly revisionKey: string;
  readonly kind: MutationKind;
  readonly at: number;
  readonly audit?: boolean;
}) =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
    const effectKey = effectKeyFor(
      args.kind,
      args.page.pageKey,
      args.revisionKey,
    );
    yield* writer
      .table("pageRevisions")
      .insert({
        workspaceId: args.brain.workspaceId,
        organizationId: args.brain.organizationId,
        pageKey: args.page.pageKey,
        revisionKey: args.revisionKey,
        priorRevisionKey: args.priorRevisionKey,
        blockNoteJson: args.page.editorSnapshotJson ?? "",
        markdown: args.page.markdown,
        contentHash: hashJson({
          title: args.page.title,
          markdown: args.page.markdown,
          editorSnapshotJson: args.page.editorSnapshotJson ?? null,
        }),
        causation: "human-edit",
        actor: { kind: "user", id: args.brain.actorId },
        modelReceiptKey: null,
        effectKey,
        state: "published",
        lifecycle: {
          state: "active",
          generation: 1,
          updatedAt: args.at,
          purgeAfter: null,
        },
        createdAt: args.at,
        schemaVersion: 1,
      })
      .pipe(Effect.orDie);
    if (args.audit !== false && args.kind !== "snapshot") {
      yield* writer
        .table("brainPageAuditEvents")
        .insert({
          workspaceId: args.brain.workspaceId,
          organizationId: args.brain.organizationId,
          brainKey: args.brain.brainKey,
          pageKey: args.page.pageKey,
          revisionKey: args.revisionKey,
          actorUserId: args.brain.actorId,
          action: auditActions[args.kind],
          effectKey,
          metadata: {},
          createdAt: args.at,
          schemaVersion: 1,
        })
        .pipe(Effect.orDie);
    }
  });

const list = FunctionImpl.make(
  databaseSchema,
  pages,
  "list",
  (
    args,
  ): Effect.Effect<
    {
      readonly brainKey: string;
      readonly asOf: number;
      readonly freshness: { readonly status: "current" };
      readonly pages: ReadonlyArray<ReturnType<typeof toPublicPageSummary>>;
    },
    ReadPageError,
    ReadPageDeps
  > =>
    Effect.gen(function* () {
      const brain = yield* requireBrainAccess(args.brainKey, "viewer");
      const rows = yield* collectPages(brain);
      return {
        brainKey: brain.brainKey,
        asOf: yield* unsafeAssumeClockProvided(Clock.currentTimeMillis),
        freshness: { status: "current" as const },
        pages: rows
          .filter(
            (page) =>
              page.status === "active" ||
              (args.includeArchived === true && page.status === "archived"),
          )
          .sort((left, right) =>
            `${left.parentPageKey ?? ""}:${left.sortKey}:${left.pageKey}`.localeCompare(
              `${right.parentPageKey ?? ""}:${right.sortKey}:${right.pageKey}`,
            ),
          )
          .map(toPublicPageSummary),
      };
    }),
);
const get = FunctionImpl.make(
  databaseSchema,
  pages,
  "get",
  (
    args,
  ): Effect.Effect<
    {
      readonly page: ReturnType<typeof toPublicPageSummary>;
      readonly markdown: string;
      readonly editorSnapshotJson: string | undefined;
      readonly editorSnapshotVersion: number | undefined;
      readonly updatedAt: number;
    },
    ReadPageError,
    ReadPageDeps
  > =>
    Effect.gen(function* () {
      const brain = yield* requireBrainAccess(args.brainKey, "viewer");
      const page = yield* loadPage(brain, args.pageKey);
      return {
        page: toPublicPageSummary(page),
        markdown: page.markdown,
        editorSnapshotJson: page.editorSnapshotJson,
        editorSnapshotVersion: page.editorSnapshotVersion,
        updatedAt: page.updatedAt,
      };
    }),
);
const history = FunctionImpl.make(databaseSchema, pages, "history", (args) =>
  Effect.gen(function* () {
    const brain = yield* requireBrainAccess(args.brainKey, "viewer");
    const reader = yield* DatabaseReader;
    const rows = yield* reader
      .table("pageRevisions")
      .index("by_page_created", (q) =>
        q.eq("workspaceId", brain.workspaceId).eq("pageKey", args.pageKey),
      )
      .collect()
      .pipe(Effect.orDie);
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
    return {
      brainKey: brain.brainKey,
      pageKey: args.pageKey,
      asOf: yield* unsafeAssumeClockProvided(Clock.currentTimeMillis),
      freshness: { status: "current" as const },
      revisions: rows.slice(0, limit).map((row) => ({
        revisionKey: row.revisionKey,
        priorRevisionKey: row.priorRevisionKey ?? null,
        causation: row.causation,
        createdAt: row.createdAt,
        lifecycleGeneration: row.lifecycle?.generation ?? 0,
      })),
    };
  }),
);
const create = FunctionImpl.make(databaseSchema, pages, "create", (args) =>
  withMutationErrorCapture(
    "brain/pages.create",
    Effect.gen(function* () {
      const title = usableTitle(args.title);
      if (title === null)
        return yield* new ValidationFailed({
          field: "title",
          message: "Invalid title.",
        });
      const brain = yield* requireBrainAccess(args.brainKey, "editor");
      if (args.expectedCurrentRevisionKey !== null)
        return yield* new StaleRevision({
          pageKey: "pag_new",
          expectedCurrentRevisionKey: args.expectedCurrentRevisionKey,
          actualCurrentRevisionKey: null,
        });
      const existing = yield* collectPages(brain);
      if (
        args.parentPageKey !== null &&
        !existing.some(
          (p) =>
            p.pageKey === args.parentPageKey &&
            p.status === "active" &&
            p.lifecycle.state === "active",
        )
      )
        return yield* new PageNotFound({ pageKey: args.parentPageKey });
      if (
        existing.some(
          (p) =>
            p.status === "active" &&
            p.parentPageKey === args.parentPageKey &&
            p.siblingSlug === args.siblingSlug,
        )
      )
        return yield* new PageTreeConflict({
          reason: "Duplicate sibling slug.",
        });
      const at = yield* unsafeAssumeClockProvided(Clock.currentTimeMillis);
      const pageKey = nextKey("pag", at + existing.length);
      const revisionKey = revisionKeyFor("create", pageKey, at, 1);
      const createdPage = {
        workspaceId: brain.workspaceId,
        organizationId: brain.organizationId,
        slug: args.siblingSlug,
        title,
        markdown: args.markdown,
        sourceKind: "markdown" as const,
        updatedAt: at,
        pageKey,
        parentPageKey: args.parentPageKey,
        siblingSlug: args.siblingSlug,
        sortKey: args.sortKey,
        favorite: false,
        status: "active" as const,
        currentRevisionKey: revisionKey,
        lifecycle: activeLifecycle(at, 1),
        createdAt: at,
        schemaVersion: 1,
      };
      const writer = yield* DatabaseWriter;
      yield* writer.table("brainPages").insert(createdPage).pipe(Effect.orDie);
      yield* writePageRevision({
        brain,
        page: createdPage,
        priorRevisionKey: null,
        revisionKey,
        kind: "create",
        at,
      });
      return toPublicPageSummary(createdPage);
    }),
  ),
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
  ({
    brainKey,
    pageKey,
    expectedCurrentRevisionKey,
    snapshot,
    version,
  }): Effect.Effect<
    {
      readonly pageKey: string;
      readonly pageRevisionKey: string;
      readonly contentHash: string;
      readonly savedAt: number;
    },
    PageError,
    PageDeps
  > =>
    Effect.gen(function* () {
      const brain = yield* requireBrainAccess(brainKey, "editor");
      const page = yield* loadPage(brain, pageKey);
      yield* requireCurrentRevision(page, expectedCurrentRevisionKey);
      if (
        !Number.isSafeInteger(version) ||
        version <= 0 ||
        version <= (page.editorSnapshotVersion ?? 0)
      )
        return yield* new ValidationFailed({
          field: "version",
          message: "Snapshot version must be a newer positive safe integer.",
        });
      const at = yield* unsafeAssumeClockProvided(Clock.currentTimeMillis);
      const nextRevisionKey = revisionKeyFor(
        "snapshot",
        page.pageKey,
        at,
        page.lifecycle.generation + 1,
      );
      const patchedPage = {
        ...page,
        editorSnapshotJson: snapshot,
        editorSnapshotVersion: version,
        currentRevisionKey: nextRevisionKey,
        updatedAt: at,
        lifecycle: {
          ...page.lifecycle,
          generation: page.lifecycle.generation + 1,
          updatedAt: at,
        },
      };
      const writer = yield* DatabaseWriter;
      yield* writer
        .table("brainPages")
        .patch(page._id, {
          editorSnapshotJson: snapshot,
          editorSnapshotVersion: version,
          currentRevisionKey: nextRevisionKey,
          updatedAt: at,
          lifecycle: patchedPage.lifecycle,
        })
        .pipe(Effect.orDie);
      yield* writePageRevision({
        brain,
        page: patchedPage,
        priorRevisionKey: page.currentRevisionKey,
        revisionKey: nextRevisionKey,
        kind: "snapshot",
        at,
        audit: false,
      });
      return {
        pageKey: page.pageKey,
        pageRevisionKey: nextRevisionKey,
        contentHash: hashJson({
          title: patchedPage.title,
          markdown: patchedPage.markdown,
          editorSnapshotJson: snapshot,
        }),
        savedAt: at,
      };
    }),
);
export default GroupImpl.make(databaseSchema, pages).pipe(
  Layer.provide(list),
  Layer.provide(get),
  Layer.provide(history),
  Layer.provide(create),
  Layer.provide(rename),
  Layer.provide(move),
  Layer.provide(favorite),
  Layer.provide(archive),
  Layer.provide(recordSnapshotInternal),
  GroupImpl.finalize,
);
