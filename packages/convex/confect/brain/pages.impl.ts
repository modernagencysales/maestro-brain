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
} from "./pageTree";
import { toPublicPageSummary, type BrainPage } from "./pageSchemas";
import pages from "./pages.spec";

type PageDoc = BrainPage & { readonly _id: GenericId<"brainPages"> };
type MutationKind = "create" | "rename" | "move" | "favorite" | "archive";
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
const pendingReason = (kind: MutationKind) =>
  effectKeyFor(kind, "pag_pending", revisionKeyFor(kind, "pag_pending", 0, 0));
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

const notImplemented = <A>(effect: Effect.Effect<A, PageTreeConflict>) =>
  effect;
const create = FunctionImpl.make(databaseSchema, pages, "create", () =>
  withMutationErrorCapture(
    "brain/pages.create",
    notImplemented(Effect.fail(new PageTreeConflict({ reason: "Pending." }))),
  ),
);
const rename = FunctionImpl.make(databaseSchema, pages, "rename", () =>
  withMutationErrorCapture(
    "brain/pages.rename",
    notImplemented(Effect.fail(new PageTreeConflict({ reason: "Pending." }))),
  ),
);
const move = FunctionImpl.make(databaseSchema, pages, "move", () =>
  withMutationErrorCapture(
    "brain/pages.move",
    notImplemented(Effect.fail(new PageTreeConflict({ reason: "Pending." }))),
  ),
);
const favorite = FunctionImpl.make(databaseSchema, pages, "favorite", () =>
  withMutationErrorCapture(
    "brain/pages.favorite",
    notImplemented(Effect.fail(new PageTreeConflict({ reason: "Pending." }))),
  ),
);
const archive = FunctionImpl.make(databaseSchema, pages, "archive", () =>
  withMutationErrorCapture(
    "brain/pages.archive",
    notImplemented(Effect.fail(new PageTreeConflict({ reason: "Pending." }))),
  ),
);
const createMarkdown = FunctionImpl.make(
  databaseSchema,
  pages,
  "createMarkdown",
  () =>
    Effect.fail(
      new MemberNotInWorkspace({
        membershipId: "legacy-createMarkdown-disabled",
      }),
    ),
);
const recordSnapshotInternal = FunctionImpl.make(
  databaseSchema,
  pages,
  "recordSnapshotInternal",
  ({ workspaceId, pageId, snapshot, version }) =>
    Effect.gen(function* () {
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      const page = yield* reader
        .table("brainPages")
        .get(pageId)
        .pipe(Effect.orDie);
      if (page === null)
        return yield* new NotFound({ resource: "brainPages", id: pageId });
      if (page.workspaceId !== workspaceId)
        return yield* new ValidationFailed({
          field: "workspaceId",
          message: "Brain page does not belong to workspace.",
        });
      yield* writer
        .table("brainPages")
        .patch(pageId, {
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
  Layer.provide(createMarkdown),
  Layer.provide(recordSnapshotInternal),
  GroupImpl.finalize,
);
