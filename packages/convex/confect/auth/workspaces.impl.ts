import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import databaseSchema from "../_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../_generated/services";
import { Forbidden, MemberNotInWorkspace, ValidationFailed } from "../errors";
import { isLiveWorkspaceMembership } from "../access/lifecycle";
import { requireWorkspaceAccess } from "../capabilities/_kit/workspaceAccess";
import {
  asGenericId,
  loadCurrentUser,
  toLifecycleMember,
  type Reader,
} from "../access/handlerContext";
import workspaces from "./workspaces.spec";

const MEMBER_SCAN_CAP = 200;
const WORKSPACE_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/u;

const withConfectClock = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, Clock.Clock>> =>
  effect as Effect.Effect<A, E, Exclude<R, Clock.Clock>>;

const normalizeWorkspaceInput = (input: {
  readonly name: string;
  readonly slug: string;
}) => {
  const name = input.name.trim();
  const slug = input.slug.trim().toLowerCase();
  if (name.length < 2 || name.length > 50)
    return new ValidationFailed({
      field: "name",
      message: "Workspace name must contain between 2 and 50 characters.",
    });
  if (!WORKSPACE_SLUG.test(slug))
    return new ValidationFailed({
      field: "slug",
      message:
        "Workspace slug must contain 2 to 50 lowercase letters, numbers, or dashes.",
    });
  return { name, slug };
};

const requireAvailableSlug = (
  reader: Reader,
  slug: string,
  currentWorkspaceId?: GenericId<"workspaces"> | undefined,
) =>
  Effect.gen(function* () {
    const existing = yield* reader
      .table("workspaces")
      .index("by_slug", (q) => q.eq("slug", slug))
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    if (existing !== null && existing._id !== currentWorkspaceId)
      return yield* new ValidationFailed({
        field: "slug",
        message: "Workspace slug is already in use.",
      });
  });

const requireWritableOrganization = (
  reader: Reader,
  userId: GenericId<"users">,
) =>
  Effect.gen(function* () {
    const ownedOrganization = yield* reader
      .table("organizations")
      .index("by_owner", (q) => q.eq("ownerUserId", userId))
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    if (ownedOrganization?.status === "active") return ownedOrganization;
    const memberships = yield* reader
      .table("organizationMembers")
      .index("by_user", (q) => q.eq("userId", userId))
      .take(MEMBER_SCAN_CAP)
      .pipe(Effect.orDie);
    const membership = memberships.find(
      (candidate) =>
        candidate.status === "active" &&
        (candidate.role === "owner" || candidate.role === "admin"),
    );
    if (membership === undefined)
      return yield* new Forbidden({
        reason: "Organization administrator access is required.",
      });
    const organizationId = asGenericId<"organizations">(
      membership.organizationId,
    );
    const organization = yield* reader
      .table("organizations")
      .get(organizationId)
      .pipe(Effect.orDie);
    if (organization === null || organization.status !== "active")
      return yield* new Forbidden({ reason: "Organization is not active." });
    return organization;
  });

const liveMemberships = (reader: Reader, userId: GenericId<"users">) =>
  reader
    .table("workspaceMembers")
    .index("by_user", (q) => q.eq("userId", userId))
    .take(MEMBER_SCAN_CAP)
    .pipe(
      Effect.map((rows) =>
        rows.map(toLifecycleMember).filter(isLiveWorkspaceMembership),
      ),
      Effect.orDie,
    );

const frontendWorkspace = (row: {
  readonly _id: GenericId<"workspaces">;
  readonly slug: string;
  readonly name: string;
}) => ({
  id: row._id,
  slug: row.slug,
  name: row.name,
});

const workspaceRowsForUser = (reader: Reader, userId: GenericId<"users">) =>
  Effect.gen(function* () {
    const memberships = yield* liveMemberships(reader, userId);
    const rows = yield* Effect.forEach(memberships, (membership) =>
      reader
        .table("workspaces")
        .get(asGenericId<"workspaces">(membership.workspaceId))
        .pipe(Effect.orDie),
    );
    return rows.filter(
      (row): row is NonNullable<typeof row> =>
        row !== null && row.status === "active",
    );
  });

const me = FunctionImpl.make(databaseSchema, workspaces, "me", () =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const user = yield* loadCurrentUser(reader);
    const memberships = yield* liveMemberships(reader, user._id);
    const rows = yield* Effect.forEach(memberships, (membership) =>
      reader
        .table("workspaces")
        .get(asGenericId<"workspaces">(membership.workspaceId))
        .pipe(Effect.orDie),
    );
    return {
      id: user._id,
      email: user.email,
      name: user.displayName ?? user.email,
      image: null,
      workspaces: rows
        .filter(
          (row): row is NonNullable<typeof row> =>
            row !== null && row.status === "active",
        )
        .map(frontendWorkspace),
    };
  }),
);

const bySlug = FunctionImpl.make(
  databaseSchema,
  workspaces,
  "bySlug",
  ({ slug }) =>
    Effect.gen(function* () {
      const reader = yield* DatabaseReader;
      const user = yield* loadCurrentUser(reader);
      const workspace = yield* reader
        .table("workspaces")
        .index("by_slug", (q) => q.eq("slug", slug))
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      if (workspace === null || workspace.status !== "active") return null;
      const membership = yield* reader
        .table("workspaceMembers")
        .index("by_workspace_user", (q) =>
          q.eq("workspaceId", workspace._id).eq("userId", user._id),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      if (
        membership === null ||
        !isLiveWorkspaceMembership(toLifecycleMember(membership))
      ) {
        return yield* Effect.fail(
          new MemberNotInWorkspace({ membershipId: "workspace" }),
        );
      }
      return frontendWorkspace(workspace);
    }),
);

const list = FunctionImpl.make(databaseSchema, workspaces, "list", () =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const user = yield* loadCurrentUser(reader);
    return yield* workspaceRowsForUser(reader, user._id);
  }),
);

const listForActor = FunctionImpl.make(
  databaseSchema,
  workspaces,
  "listForActor",
  ({ userId }) =>
    Effect.gen(function* () {
      const reader = yield* DatabaseReader;
      const user = yield* reader.table("users").get(userId).pipe(Effect.orDie);
      if (user === null || user.status !== "active") return [];
      return yield* workspaceRowsForUser(reader, userId);
    }),
);

const slugAvailable = FunctionImpl.make(
  databaseSchema,
  workspaces,
  "slugAvailable",
  ({ slug }) =>
    Effect.gen(function* () {
      const reader = yield* DatabaseReader;
      yield* loadCurrentUser(reader);
      const normalized = normalizeWorkspaceInput({ name: "ok", slug });
      if (normalized instanceof ValidationFailed) return yield* normalized;
      const existing = yield* reader
        .table("workspaces")
        .index("by_slug", (q) => q.eq("slug", normalized.slug))
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      return { available: existing === null };
    }),
);

const create = FunctionImpl.make(
  databaseSchema,
  workspaces,
  "create",
  (input) =>
    Effect.gen(function* () {
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      const user = yield* loadCurrentUser(reader);
      const normalized = normalizeWorkspaceInput(input);
      if (normalized instanceof ValidationFailed) return yield* normalized;
      yield* requireAvailableSlug(reader, normalized.slug);
      const organization = yield* requireWritableOrganization(reader, user._id);
      const now = yield* withConfectClock(Clock.currentTimeMillis);
      const workspaceId = yield* writer
        .table("workspaces")
        .insert({
          organizationId: organization._id,
          ownerUserId: user._id,
          slug: normalized.slug,
          name: normalized.name,
          status: "active",
          dataClassification: "confidential",
          createdAt: now,
          updatedAt: now,
        })
        .pipe(Effect.orDie);
      yield* writer
        .table("workspaceMembers")
        .insert({
          workspaceId,
          userId: user._id,
          role: "owner",
          status: "active",
          acceptedAt: now,
          revokedAt: null,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .pipe(Effect.orDie);
      return { id: workspaceId, ...normalized };
    }),
);

const update = FunctionImpl.make(
  databaseSchema,
  workspaces,
  "update",
  ({ workspaceId, ...input }) =>
    Effect.gen(function* () {
      yield* withConfectClock(requireWorkspaceAccess(workspaceId, "admin"));
      const normalized = normalizeWorkspaceInput(input);
      if (normalized instanceof ValidationFailed) return yield* normalized;
      const reader = yield* DatabaseReader;
      yield* requireAvailableSlug(reader, normalized.slug, workspaceId);
      const writer = yield* DatabaseWriter;
      yield* writer
        .table("workspaces")
        .patch(workspaceId, {
          ...normalized,
          updatedAt: yield* withConfectClock(Clock.currentTimeMillis),
        })
        .pipe(Effect.orDie);
      return { id: workspaceId, ...normalized };
    }),
);

export default GroupImpl.make(databaseSchema, workspaces).pipe(
  Layer.provide(me),
  Layer.provide(bySlug),
  Layer.provide(list),
  Layer.provide(listForActor),
  Layer.provide(slugAvailable),
  Layer.provide(create),
  Layer.provide(update),
  GroupImpl.finalize,
);
