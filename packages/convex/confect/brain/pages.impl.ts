import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { resolveEffectiveWorkspaceRole } from "../access/auth";
import { extractIdentityProfile } from "../access/provisioning";
import { roleAtLeast, type Role } from "../access/roles";
import databaseSchema from "../_generated/schema";
import { Auth, DatabaseReader, DatabaseWriter } from "../_generated/services";
import {
  Forbidden,
  MemberNotInWorkspace,
  NotFound,
  Unauthorized,
  ValidationFailed,
} from "../errors";
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
type MutationKind = "create" | "rename" | "move" | "favorite" | "archive";
type AuditAction =
  | "page.created"
  | "page.renamed"
  | "page.moved"
  | "page.favoriteChanged"
  | "page.archived";
type BrainContext = {
  readonly workspaceId: GenericId<"workspaces">;
  readonly organizationId: string;
  readonly brainKey: string;
  readonly role: Role;
  readonly actorId: string;
};

const unsafeAssumeClockProvided = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect as Effect.Effect<A, E, Exclude<R, Clock.Clock>>;
const asPageDoc = (page: unknown): PageDoc => page as PageDoc;
const nextKey = (prefix: "pag" | "rev", at: number) =>
  `${prefix}_${at.toString(36).padStart(8, "0")}`;
const hashJson = (value: unknown) => sha256Hex(JSON.stringify(value));
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
const auditActionFor = (kind: MutationKind): AuditAction => {
  switch (kind) {
    case "create":
      return "page.created";
    case "rename":
      return "page.renamed";
    case "move":
      return "page.moved";
    case "favorite":
      return "page.favoriteChanged";
    case "archive":
      return "page.archived";
  }
};
const requireBrainAccess = (brainKey: string, minimumRole: Role) =>
  Effect.gen(function* () {
    const auth = yield* Auth;
    const reader = yield* DatabaseReader;
    const claims = yield* auth.getUserIdentity.pipe(
      Effect.mapError(() => new Unauthorized()),
    );
    const identity = yield* extractIdentityProfile(claims);
    const users = yield* reader
      .table("users")
      .index("by_subject", (q) => q.eq("subject", identity.subject))
      .collect()
      .pipe(Effect.orDie);
    const activeUsers = users.filter(
      (candidate) => candidate.status === "active",
    );
    if (activeUsers.length !== 1) return yield* new Unauthorized();
    const user = activeUsers[0];
    if (user === undefined || identity.workosOrganizationId === undefined)
      return yield* new Unauthorized();

    const organizations = yield* reader
      .table("organizations")
      .index("by_workos_organization", (q) =>
        q.eq("workosOrganizationId", identity.workosOrganizationId),
      )
      .collect()
      .pipe(Effect.orDie);
    const activeOrganizations = organizations.filter(
      (candidate) => candidate.status === "active",
    );
    if (activeOrganizations.length !== 1)
      return yield* new BrainNotFound({ brainKey });
    const organization = activeOrganizations[0];
    if (organization === undefined)
      return yield* new BrainNotFound({ brainKey });

    const workspaces = yield* reader
      .table("workspaces")
      .index("by_organization_brain_key", (q) =>
        q.eq("organizationId", organization._id).eq("brainKey", brainKey),
      )
      .collect()
      .pipe(Effect.orDie);
    const activeOrArchivedWorkspaces = workspaces.filter(
      (candidate) =>
        candidate.status === "active" || candidate.status === "archived",
    );
    if (activeOrArchivedWorkspaces.length !== 1)
      return yield* new BrainNotFound({ brainKey });
    const workspace = activeOrArchivedWorkspaces[0];
    if (workspace === undefined) return yield* new BrainNotFound({ brainKey });
    if (workspace.status !== "active")
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
      role: resolution.role,
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

const writePageRevision = (args: {
  readonly brain: BrainContext;
  readonly page: Omit<BrainPage, "currentRevisionKey"> & {
    readonly currentRevisionKey: string;
  };
  readonly priorRevisionKey: string | null;
  readonly revisionKey: string;
  readonly kind: MutationKind;
  readonly at: number;
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
    yield* writer
      .table("brainPageAuditEvents")
      .insert({
        workspaceId: args.brain.workspaceId,
        organizationId: args.brain.organizationId,
        brainKey: args.brain.brainKey,
        pageKey: args.page.pageKey,
        revisionKey: args.revisionKey,
        actorUserId: args.brain.actorId,
        action: auditActionFor(args.kind),
        effectKey,
        metadata: {},
        createdAt: args.at,
        schemaVersion: 1,
      })
      .pipe(Effect.orDie);
  });

const list = FunctionImpl.make(databaseSchema, pages, "list", (args) =>
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

const get = FunctionImpl.make(databaseSchema, pages, "get", (args) =>
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
        lifecycle: {
          state: "active" as const,
          generation: 1,
          updatedAt: at,
          purgeAfter: null,
        },
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
    const patchedPage = {
      ...page,
      ...args.patch,
      ...(args.title === undefined ? {} : { title: args.title }),
      currentRevisionKey: nextRevisionKey,
      updatedAt: at,
      lifecycle: {
        ...page.lifecycle,
        ...(args.kind === "archive" ? { state: "archived" as const } : {}),
        generation: page.lifecycle.generation + 1,
        updatedAt: at,
      },
    };
    const writer = yield* DatabaseWriter;
    yield* writer
      .table("brainPages")
      .patch(page._id, {
        ...args.patch,
        ...(args.title === undefined ? {} : { title: args.title }),
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
      const writer = yield* DatabaseWriter;
      yield* writer
        .table("brainPages")
        .patch(page._id, {
          editorSnapshotJson: snapshot,
          editorSnapshotVersion: version,
          updatedAt: yield* unsafeAssumeClockProvided(Clock.currentTimeMillis),
        })
        .pipe(Effect.orDie);
      return { ok: true as const };
    }),
);
export default GroupImpl.make(databaseSchema, pages).pipe(
  Layer.provide(list),
  Layer.provide(get),
  Layer.provide(create),
  Layer.provide(rename),
  Layer.provide(move),
  Layer.provide(favorite),
  Layer.provide(archive),
  Layer.provide(recordSnapshotInternal),
  GroupImpl.finalize,
);
