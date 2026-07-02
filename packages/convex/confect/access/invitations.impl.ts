import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import type { InvitationsDoc, WorkspaceMembersDoc } from "../_generated/docs";
import databaseSchema from "../_generated/schema";
import { Auth, DatabaseReader, DatabaseWriter } from "../_generated/services";
import { stableFingerprint } from "../shared/tokenCrypto";
import {
  Forbidden,
  InvitationNotAccessible,
  Unauthorized,
  WorkspaceNotFound,
} from "../errors";
import {
  acceptInvitation,
  buildWorkspaceInvitation,
  cancelInvitation,
  declineInvitation,
  type InvitationRef,
  type WorkspaceMemberLifecycleRef,
} from "./lifecycle";
import invitations from "./invitations.spec";
import { roleAtLeast, type Role } from "./roles";

const create = FunctionImpl.make(
  databaseSchema,
  invitations,
  "create",
  ({ workspaceId, email, role }) =>
    Effect.gen(function* () {
      const now = Date.now();
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      const actor = yield* loadActorForWorkspace(reader, workspaceId);
      requireActorRole(actor, "admin");
      const workspace = yield* reader
        .table("workspaces")
        .get(workspaceId)
        .pipe(Effect.mapError(() => new WorkspaceNotFound({ workspaceId })));
      const tokenHash = yield* Effect.promise(() =>
        stableFingerprint({
          workspaceId,
          email,
          invitedByUserId: actor.userId,
          now,
        }),
      );
      const plan = buildWorkspaceInvitation({
        workspaceId,
        organizationId: workspace.organizationId,
        inviteeEmail: email,
        role,
        invitedByUserId: actor.userId,
        tokenHash,
        now,
      });

      return yield* writer
        .table("invitations")
        .insert(plan.invitation)
        .pipe(Effect.orDie);
    }),
);

const accept = FunctionImpl.make(
  databaseSchema,
  invitations,
  "accept",
  ({ invitationId }) =>
    Effect.gen(function* () {
      const now = Date.now();
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      const user = yield* loadCurrentUser(reader);
      const invitation = yield* loadInvitationForResponse(reader, invitationId);
      const existingLiveMembership =
        invitation === null
          ? null
          : yield* loadOptionalLiveWorkspaceMemberForUser(
              reader,
              invitation.workspaceId,
              user._id,
            );
      const plan = acceptInvitation({
        invitation,
        verifiedEmail: user.email,
        userId: user._id,
        existingLiveMembership,
        now,
      });
      const acceptedInvitation = requireLoadedInvitation(invitation);

      yield* writer
        .table("invitations")
        .patch(invitationId, plan.invitationPatch.value)
        .pipe(Effect.orDie);

      if (plan.membershipInsert !== null) {
        yield* writer
          .table("workspaceMembers")
          .insert({
            ...plan.membershipInsert,
            createdAt: now,
            updatedAt: now,
          })
          .pipe(Effect.orDie);
      }

      return {
        workspaceId: toId<"workspaces">(acceptedInvitation.workspaceId),
      };
    }),
);

const decline = FunctionImpl.make(
  databaseSchema,
  invitations,
  "decline",
  ({ invitationId }) =>
    Effect.gen(function* () {
      const now = Date.now();
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      const user = yield* loadCurrentUser(reader);
      const invitation = yield* loadInvitationForResponse(reader, invitationId);
      const plan = declineInvitation({
        invitation,
        verifiedEmail: user.email,
        now,
      });

      if (plan.invitationPatch !== null) {
        yield* writer
          .table("invitations")
          .patch(invitationId, plan.invitationPatch.value)
          .pipe(Effect.orDie);
      }

      return null;
    }),
);

const cancel = FunctionImpl.make(
  databaseSchema,
  invitations,
  "cancel",
  ({ invitationId, workspaceId }) =>
    Effect.gen(function* () {
      const now = Date.now();
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      const actor = yield* loadActorForWorkspace(reader, workspaceId);
      requireActorRole(actor, "admin");
      const invitation = yield* loadInvitationForResponse(reader, invitationId);
      const plan = cancelInvitation({
        invitation,
        workspaceId,
        actorUserId: actor.userId,
        now,
      });

      if (plan.invitationPatch !== null) {
        yield* writer
          .table("invitations")
          .patch(invitationId, plan.invitationPatch.value)
          .pipe(Effect.orDie);
      }

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
    const membership = yield* loadOptionalLiveWorkspaceMemberForUser(
      reader,
      workspaceId,
      user._id,
    );
    if (membership === null) {
      return yield* new Forbidden({ reason: "No live workspace membership." });
    }
    return {
      userId: user._id,
      role: membership.role,
    };
  });

const loadInvitationForResponse = (
  reader: Reader,
  invitationId: GenericId<"invitations">,
): Effect.Effect<InvitationRef | null, never> =>
  reader
    .table("invitations")
    .get(invitationId)
    .pipe(
      Effect.map((invitation) => toInvitationRef(invitation)),
      Effect.catchAll(() => Effect.succeed(null)),
    );

const loadOptionalLiveWorkspaceMemberForUser = (
  reader: Reader,
  workspaceId: GenericId<"workspaces"> | string,
  userId: GenericId<"users"> | string,
): Effect.Effect<WorkspaceMemberLifecycleRef | null, never> =>
  reader
    .table("workspaceMembers")
    .index("by_workspace_user", (q) =>
      q.eq("workspaceId", workspaceId).eq("userId", userId),
    )
    .first()
    .pipe(
      Effect.map(Option.getOrNull),
      Effect.map((membership) =>
        membership === null ? null : toLifecycleMember(membership),
      ),
      Effect.map((membership) =>
        membership !== null &&
        membership.status === "active" &&
        membership.acceptedAt !== null &&
        membership.revokedAt === null &&
        membership.deletedAt === null
          ? membership
          : null,
      ),
      Effect.orDie,
    );

const toInvitationRef = (invitation: InvitationsDoc): InvitationRef => ({
  id: invitation._id,
  workspaceId: invitation.workspaceId,
  organizationId: invitation.organizationId,
  email: invitation.email,
  role: invitation.role,
  status: invitation.status,
  tokenHash: invitation.tokenHash,
  invitedByUserId: invitation.invitedByUserId,
  acceptedAt: invitation.acceptedAt,
  revokedAt: invitation.revokedAt,
  expiresAt: invitation.expiresAt,
  createdAt: invitation.createdAt,
  updatedAt: invitation.updatedAt,
});

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

const requireLoadedInvitation = (
  invitation: InvitationRef | null,
): InvitationRef => {
  if (invitation === null) {
    throw new InvitationNotAccessible();
  }
  return invitation;
};

const toId = <TableName extends string>(id: string): GenericId<TableName> =>
  id as GenericId<TableName>;

export default GroupImpl.make(databaseSchema, invitations).pipe(
  Layer.provide(create),
  Layer.provide(accept),
  Layer.provide(decline),
  Layer.provide(cancel),
  GroupImpl.finalize,
);
