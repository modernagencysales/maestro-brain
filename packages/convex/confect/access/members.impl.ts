import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import type { WorkspaceMembersDoc } from "../_generated/docs";
import databaseSchema from "../_generated/schema";
import { Auth, DatabaseReader, DatabaseWriter } from "../_generated/services";
import { Forbidden, MemberNotInWorkspace, Unauthorized } from "../errors";
import {
  changeMemberRole,
  removeMember,
  transferOwnership,
  type WorkspaceMemberLifecycleRef,
} from "./lifecycle";
import members from "./members.spec";
import { roleAtLeast, type Role } from "./roles";

const MEMBER_SCAN_CAP = 200;

const changeRole = FunctionImpl.make(
  databaseSchema,
  members,
  "changeRole",
  ({ membershipId, newRole }) =>
    Effect.gen(function* () {
      const now = Date.now();
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      const target = yield* loadMember(reader, membershipId);
      const actor = yield* loadActorForWorkspace(reader, target.workspaceId);
      requireActorRole(actor, "admin");
      const liveMembers = yield* liveWorkspaceMembers(
        reader,
        target.workspaceId,
      );
      const plan = changeMemberRole({
        actorUserId: actor.userId,
        actorRole: actor.role,
        workspaceId: target.workspaceId,
        target,
        liveWorkspaceMembers: liveMembers,
        newRole,
        now,
      });

      yield* writer
        .table("workspaceMembers")
        .patch(membershipId, plan.patch.value)
        .pipe(Effect.orDie);

      return null;
    }),
);

const remove = FunctionImpl.make(
  databaseSchema,
  members,
  "remove",
  ({ membershipId }) =>
    Effect.gen(function* () {
      const now = Date.now();
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      const target = yield* loadMember(reader, membershipId);
      const actor = yield* loadActorForWorkspace(reader, target.workspaceId);
      requireActorRole(actor, "admin");
      const liveMembers = yield* liveWorkspaceMembers(
        reader,
        target.workspaceId,
      );
      const plan = removeMember({
        actorUserId: actor.userId,
        actorRole: actor.role,
        workspaceId: target.workspaceId,
        target,
        liveWorkspaceMembers: liveMembers,
        now,
      });

      yield* writer
        .table("workspaceMembers")
        .patch(membershipId, plan.patch.value)
        .pipe(Effect.orDie);

      return null;
    }),
);

const transferOwnershipImpl = FunctionImpl.make(
  databaseSchema,
  members,
  "transferOwnership",
  ({ membershipId }) =>
    Effect.gen(function* () {
      const now = Date.now();
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      const target = yield* loadMember(reader, membershipId);
      const actor = yield* loadActorForWorkspace(reader, target.workspaceId);
      requireActorRole(actor, "owner");
      const actorMembership = yield* loadLiveWorkspaceMemberForUser(
        reader,
        target.workspaceId,
        actor.userId,
      );
      const plan = transferOwnership({
        actorUserId: actor.userId,
        workspaceId: target.workspaceId,
        target,
        actorMembership,
        now,
      });

      yield* Effect.forEach(plan.patches, (patch) =>
        writer
          .table("workspaceMembers")
          .patch(toId<"workspaceMembers">(patch.id), patch.value)
          .pipe(Effect.orDie),
      );

      return null;
    }),
);

type Reader = Context.Tag.Service<typeof DatabaseReader>;

const loadCurrentUser = (reader: Reader) =>
  Effect.gen(function* () {
    const auth = yield* Auth;
    const identity = yield* auth.getUserIdentity.pipe(
      Effect.mapError(() => new Unauthorized()),
    );
    return yield* reader
      .table("users")
      .index("by_subject", (q) => q.eq("subject", identity.subject))
      .first()
      .pipe(
        Effect.map(Option.getOrNull),
        Effect.flatMap((user) =>
          user === null
            ? Effect.fail(new Unauthorized())
            : Effect.succeed(user),
        ),
        Effect.mapError((error) =>
          error instanceof Unauthorized ? error : new Unauthorized(),
        ),
      );
  });

const loadActorForWorkspace = (
  reader: Reader,
  workspaceId: GenericId<"workspaces"> | string,
) =>
  Effect.gen(function* () {
    const user = yield* loadCurrentUser(reader);
    const membership = yield* loadLiveWorkspaceMemberForUser(
      reader,
      workspaceId,
      user._id,
    );
    return {
      userId: user._id,
      role: membership.role,
    };
  });

const loadMember = (
  reader: Reader,
  membershipId: GenericId<"workspaceMembers">,
): Effect.Effect<WorkspaceMemberLifecycleRef, MemberNotInWorkspace> =>
  reader
    .table("workspaceMembers")
    .get(membershipId)
    .pipe(
      Effect.map(toLifecycleMember),
      Effect.mapError(
        () => new MemberNotInWorkspace({ membershipId: membershipId }),
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
        membership.status === "active" &&
        membership.acceptedAt !== null &&
        membership.revokedAt === null &&
        membership.deletedAt === null
          ? Effect.succeed(membership)
          : Effect.fail(
              new MemberNotInWorkspace({ membershipId: membership.id }),
            ),
      ),
      Effect.mapError((error) =>
        error instanceof MemberNotInWorkspace
          ? error
          : new MemberNotInWorkspace({ membershipId: "actor" }),
      ),
    );

const liveWorkspaceMembers = (
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
        members_
          .map(toLifecycleMember)
          .filter(
            (member) =>
              member.acceptedAt !== null &&
              member.revokedAt === null &&
              member.deletedAt === null,
          ),
      ),
      Effect.orDie,
    );

const toLifecycleMember = (
  member: WorkspaceMembersDoc,
): WorkspaceMemberLifecycleRef => ({
  id: member._id,
  workspaceId: member.workspaceId,
  userId: member.userId,
  role: member.role,
  status: member.status,
  acceptedAt: member.acceptedAt,
  revokedAt: member.revokedAt,
  deletedAt: member.deletedAt,
});

const requireActorRole = (
  actor: { readonly role: Role },
  minimumRole: Role,
): void => {
  if (!roleAtLeast(actor.role, minimumRole)) {
    throw new Forbidden({ reason: "Insufficient workspace role." });
  }
};

const toId = <TableName extends string>(id: string): GenericId<TableName> =>
  id as GenericId<TableName>;

export default GroupImpl.make(databaseSchema, members).pipe(
  Layer.provide(changeRole),
  Layer.provide(remove),
  Layer.provide(transferOwnershipImpl),
  GroupImpl.finalize,
);
