import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import databaseSchema from "../_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../_generated/services";
import { Forbidden, MemberNotInWorkspace } from "../errors";
import {
  deniedPrivilegedAccessAuditEvent,
  denialAuditReason,
  recordAccessAuditEvent,
  recordAccessLifecycleEvents,
} from "./audit";
import { resolveEffectiveWorkspaceRole } from "./auth";
import { roleAtLeast, type Role } from "./roles";
import {
  asGenericId,
  loadCurrentUser,
  requireActorRole,
  toLifecycleMember,
  type Reader,
} from "./handlerContext";
import {
  changeMemberRole,
  isLiveWorkspaceMembership,
  removeMember,
  transferOwnership,
  type WorkspaceMemberLifecycleRef,
} from "./lifecycle";
import members from "./members.spec";

const MEMBER_SCAN_CAP = 200;

export const canManageWorkspaceMembers = (role: Role): boolean =>
  roleAtLeast(role, "admin");

const changeRole = FunctionImpl.make(
  databaseSchema,
  members,
  "changeRole",
  ({ workspaceId, membershipId, newRole }) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      const actor = yield* loadActorForWorkspace(reader, workspaceId, now);
      const target = yield* loadMemberInWorkspace(
        reader,
        workspaceId,
        membershipId,
      );
      yield* requireMemberManager(actor).pipe(
        auditDeniedMemberAction(writer, now, {
          action: "member.roleChanged",
          workspaceId: target.workspaceId,
          actorUserId: actor.userId,
          subjectId: target.id,
        }),
      );
      const liveMembers = yield* liveWorkspaceMembersOrDie(
        reader,
        target.workspaceId,
      );
      const plan = yield* effectFromEither(
        changeMemberRole({
          actorUserId: actor.userId,
          actorRole: actor.role,
          workspaceId: target.workspaceId,
          target,
          liveWorkspaceMembers: liveMembers,
          newRole,
          now,
        }),
      ).pipe(
        auditDeniedMemberAction(writer, now, {
          action: "member.roleChanged",
          workspaceId: target.workspaceId,
          actorUserId: actor.userId,
          subjectId: target.id,
        }),
      );

      yield* writer
        .table("workspaceMembers")
        .patch(membershipId, plan.patch.value)
        .pipe(Effect.orDie);
      yield* recordAccessLifecycleEvents(writer, plan.events, now);

      return null;
    }),
);

const remove = FunctionImpl.make(
  databaseSchema,
  members,
  "remove",
  ({ workspaceId, membershipId }) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      const actor = yield* loadActorForWorkspace(reader, workspaceId, now);
      const target = yield* loadMemberInWorkspace(
        reader,
        workspaceId,
        membershipId,
      );
      yield* requireMemberManager(actor).pipe(
        auditDeniedMemberAction(writer, now, {
          action: "member.removed",
          workspaceId: target.workspaceId,
          actorUserId: actor.userId,
          subjectId: target.id,
        }),
      );
      const liveMembers = yield* liveWorkspaceMembersOrDie(
        reader,
        target.workspaceId,
      );
      const plan = yield* effectFromEither(
        removeMember({
          actorUserId: actor.userId,
          actorRole: actor.role,
          workspaceId: target.workspaceId,
          target,
          liveWorkspaceMembers: liveMembers,
          now,
        }),
      ).pipe(
        auditDeniedMemberAction(writer, now, {
          action: "member.removed",
          workspaceId: target.workspaceId,
          actorUserId: actor.userId,
          subjectId: target.id,
        }),
      );

      yield* writer
        .table("workspaceMembers")
        .patch(membershipId, plan.patch.value)
        .pipe(Effect.orDie);
      yield* recordAccessLifecycleEvents(writer, plan.events, now);

      return null;
    }),
);

const transferOwnershipImpl = FunctionImpl.make(
  databaseSchema,
  members,
  "transferOwnership",
  ({ workspaceId, membershipId }) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      const actor = yield* loadActorForWorkspace(reader, workspaceId, now);
      const target = yield* loadMemberInWorkspace(
        reader,
        workspaceId,
        membershipId,
      );
      yield* requireActorRole(actor, "owner").pipe(
        auditDeniedMemberAction(writer, now, {
          action: "member.ownershipTransferred",
          workspaceId: target.workspaceId,
          actorUserId: actor.userId,
          subjectId: target.id,
        }),
      );
      const actorMembership = yield* loadLiveWorkspaceMemberForUser(
        reader,
        target.workspaceId,
        actor.userId,
      );
      const plan = yield* effectFromEither(
        transferOwnership({
          actorUserId: actor.userId,
          workspaceId: target.workspaceId,
          target,
          actorMembership,
          now,
        }),
      ).pipe(
        auditDeniedMemberAction(writer, now, {
          action: "member.ownershipTransferred",
          workspaceId: target.workspaceId,
          actorUserId: actor.userId,
          subjectId: target.id,
        }),
      );

      yield* Effect.forEach(plan.patches, (patch) =>
        writer
          .table("workspaceMembers")
          .patch(asGenericId<"workspaceMembers">(patch.id), patch.value)
          .pipe(Effect.orDie),
      );
      yield* recordAccessLifecycleEvents(writer, plan.events, now);

      return null;
    }),
);

const effectFromEither = <A, E>(
  either: Either.Either<A, E>,
): Effect.Effect<A, E> =>
  Either.isLeft(either)
    ? Effect.fail(either.left)
    : Effect.succeed(either.right);

const auditDeniedMemberAction =
  (
    writer: Parameters<typeof recordAccessAuditEvent>[0],
    now: number,
    input: {
      readonly action:
        "member.roleChanged" | "member.removed" | "member.ownershipTransferred";
      readonly workspaceId: string;
      readonly actorUserId: string;
      readonly subjectId: string;
    },
  ) =>
  <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
    effect.pipe(
      Effect.tapError((error) =>
        recordAccessAuditEvent(
          writer,
          deniedPrivilegedAccessAuditEvent({
            ...input,
            subjectKind: "workspaceMember",
            reason: denialAuditReason(error),
          }),
          now,
        ),
      ),
    );

const requireMemberManager = (actor: {
  readonly role: Role;
}): Effect.Effect<void, Forbidden> =>
  canManageWorkspaceMembers(actor.role)
    ? Effect.void
    : Effect.fail(
        new Forbidden({
          reason: "Member management requires admin or owner role.",
        }),
      );

const loadActorForWorkspace = (
  reader: Reader,
  workspaceId: GenericId<"workspaces"> | string,
  nowMs: number,
) =>
  Effect.gen(function* () {
    const user = yield* loadCurrentUser(reader);
    const workspace = yield* loadWorkspaceForAccess(reader, workspaceId);
    const organization = yield* loadOrganizationForAccess(
      reader,
      workspace.organizationId,
    );
    const [workspaceMembers, organizationMembers] = yield* Effect.all([
      loadWorkspaceMembershipsForUser(reader, workspaceId, user._id),
      loadOrganizationMembershipsForUser(
        reader,
        workspace.organizationId,
        user._id,
      ),
    ]);
    const resolution = resolveEffectiveWorkspaceRole({
      nowMs,
      userId: user._id,
      workspace: {
        id: workspace._id,
        organizationId: workspace.organizationId,
        status: workspace.status,
      },
      organization: {
        id: organization._id,
        status: organization.status,
      },
      workspaceMembers,
      organizationMembers,
      guestGrants: [],
    });

    if (!resolution.ok) {
      return yield* Effect.fail(new Forbidden({ reason: resolution.reason }));
    }

    return {
      userId: user._id,
      role: resolution.role,
    };
  });

const loadWorkspaceForAccess = (
  reader: Reader,
  workspaceId: GenericId<"workspaces"> | string,
) =>
  reader
    .table("workspaces")
    .get(asGenericId<"workspaces">(workspaceId))
    .pipe(
      Effect.catchAll((error) =>
        error._tag === "GetByIdFailure"
          ? Effect.fail(
              new Forbidden({
                reason: "Workspace access could not be resolved.",
              }),
            )
          : Effect.die(error),
      ),
    );

const loadOrganizationForAccess = (reader: Reader, organizationId: string) =>
  reader
    .table("organizations")
    .get(asGenericId<"organizations">(organizationId))
    .pipe(
      Effect.catchAll((error) =>
        error._tag === "GetByIdFailure"
          ? Effect.fail(
              new Forbidden({
                reason: "Workspace access could not be resolved.",
              }),
            )
          : Effect.die(error),
      ),
    );

const loadWorkspaceMembershipsForUser = (
  reader: Reader,
  workspaceId: GenericId<"workspaces"> | string,
  userId: GenericId<"users"> | string,
) =>
  reader
    .table("workspaceMembers")
    .index("by_workspace_user", (q) =>
      q.eq("workspaceId", workspaceId).eq("userId", userId),
    )
    .collect()
    .pipe(
      Effect.map((members_) => members_.map(toLifecycleMember)),
      Effect.orDie,
    );

const loadOrganizationMembershipsForUser = (
  reader: Reader,
  organizationId: string,
  userId: GenericId<"users"> | string,
) =>
  reader
    .table("organizationMembers")
    .index("by_organization_user", (q) =>
      q.eq("organizationId", organizationId).eq("userId", userId),
    )
    .collect()
    .pipe(Effect.orDie);

const loadMemberInWorkspace = (
  reader: Reader,
  workspaceId: GenericId<"workspaces"> | string,
  membershipId: GenericId<"workspaceMembers">,
): Effect.Effect<WorkspaceMemberLifecycleRef, MemberNotInWorkspace> =>
  reader
    .table("workspaceMembers")
    .get(membershipId)
    .pipe(
      Effect.map(toLifecycleMember),
      Effect.flatMap((membership) =>
        membership.workspaceId === workspaceId
          ? Effect.succeed(membership)
          : Effect.fail(new MemberNotInWorkspace({ membershipId })),
      ),
      Effect.catchAll((error) =>
        error instanceof MemberNotInWorkspace
          ? Effect.fail(error)
          : error._tag === "GetByIdFailure"
            ? Effect.fail(new MemberNotInWorkspace({ membershipId }))
            : Effect.die(error),
      ),
    );

const loadLiveWorkspaceMemberForUser = (
  reader: Reader,
  workspaceId: GenericId<"workspaces"> | string,
  userId: GenericId<"users"> | string,
): Effect.Effect<WorkspaceMemberLifecycleRef, MemberNotInWorkspace> =>
  reader
    .table("workspaceMembers")
    .index("by_workspace_user", (q) =>
      q.eq("workspaceId", workspaceId).eq("userId", userId),
    )
    .first()
    .pipe(
      Effect.map(Option.getOrNull),
      Effect.flatMap((membership) =>
        membership === null
          ? Effect.fail(new MemberNotInWorkspace({ membershipId: "actor" }))
          : Effect.succeed(toLifecycleMember(membership)),
      ),
      Effect.flatMap((membership) =>
        isLiveWorkspaceMembership(membership)
          ? Effect.succeed(membership)
          : Effect.fail(
              new MemberNotInWorkspace({ membershipId: membership.id }),
            ),
      ),
      // Keep the typed MemberNotInWorkspace; a decode/system failure is a real
      // defect, not a spurious "member not found".
      Effect.catchAll((error) =>
        error instanceof MemberNotInWorkspace
          ? Effect.fail(error)
          : Effect.die(error),
      ),
    );

const liveWorkspaceMembersOrDie = (
  reader: Reader,
  workspaceId: GenericId<"workspaces"> | string,
) =>
  reader
    .table("workspaceMembers")
    .index("by_workspace_status", (q) =>
      q.eq("workspaceId", workspaceId).eq("status", "active"),
    )
    .take(MEMBER_SCAN_CAP)
    .pipe(
      Effect.map((members_) =>
        members_.map(toLifecycleMember).filter(isLiveWorkspaceMembership),
      ),
      Effect.orDie,
    );

export default GroupImpl.make(databaseSchema, members).pipe(
  Layer.provide(changeRole),
  Layer.provide(remove),
  Layer.provide(transferOwnershipImpl),
  GroupImpl.finalize,
);
