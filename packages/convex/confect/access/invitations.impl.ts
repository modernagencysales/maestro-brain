import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import type { InvitationsDoc } from "../_generated/docs";
import databaseSchema from "../_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../_generated/services";
import { stableFingerprint } from "../shared/tokenCrypto";
import {
  deniedPrivilegedAccessAuditEvent,
  denialAuditReason,
  recordAccessAuditEvent,
  recordAccessLifecycleEvents,
} from "./audit";
import { resolveEffectiveWorkspaceRole } from "./auth";
import {
  Forbidden,
  InvitationNotAccessible,
  WorkspaceNotFound,
} from "../errors";
import {
  asGenericId,
  loadCurrentUser,
  requireActorRole,
  toLifecycleMember,
  type Reader,
} from "./handlerContext";
import {
  acceptInvitation,
  buildInvitationCreatedEvent,
  buildWorkspaceInvitation,
  cancelInvitation,
  declineInvitation,
  isLiveWorkspaceMembership,
  type InvitationRef,
  type WorkspaceMemberLifecycleRef,
} from "./lifecycle";
import invitations from "./invitations.spec";

const create = FunctionImpl.make(
  databaseSchema,
  invitations,
  "create",
  ({ workspaceId, email, role }) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      const actor = yield* loadActorForWorkspace(reader, workspaceId, now);
      yield* requireActorRole(actor, "admin").pipe(
        auditDeniedInvitationAction(writer, now, {
          action: "invitation.created",
          workspaceId,
          actorUserId: actor.userId,
          subjectId: "pending-invitation",
        }),
      );
      const workspace = yield* reader
        .table("workspaces")
        .get(workspaceId)
        .pipe(
          Effect.catchAll((error) =>
            error._tag === "GetByIdFailure"
              ? Effect.fail(new WorkspaceNotFound({ workspaceId }))
              : Effect.die(error),
          ),
        );
      const tokenHash = yield* Effect.promise(() =>
        stableFingerprint({
          workspaceId,
          email,
          invitedByUserId: actor.userId,
          now,
        }),
      );
      const plan = yield* buildWorkspaceInvitation({
        workspaceId,
        organizationId: workspace.organizationId,
        inviteeEmail: email,
        role,
        invitedByUserId: actor.userId,
        tokenHash,
        now,
      });

      const invitationId = yield* writer
        .table("invitations")
        .insert(plan.invitation)
        .pipe(Effect.orDie);
      yield* recordAccessLifecycleEvents(
        writer,
        [
          buildInvitationCreatedEvent({
            id: invitationId,
            ...plan.invitation,
          }),
        ],
        now,
      );

      return invitationId;
    }),
);

const accept = FunctionImpl.make(
  databaseSchema,
  invitations,
  "accept",
  ({ invitationId }) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
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
      const plan = yield* acceptInvitation({
        invitation,
        verifiedEmail: user.email,
        userId: user._id,
        existingLiveMembership,
        now,
      });
      const acceptedInvitation = yield* requireLoadedInvitation(invitation);

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
      yield* recordAccessLifecycleEvents(writer, plan.events, now);

      return {
        workspaceId: asGenericId<"workspaces">(acceptedInvitation.workspaceId),
      };
    }),
);

const decline = FunctionImpl.make(
  databaseSchema,
  invitations,
  "decline",
  ({ invitationId }) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      const user = yield* loadCurrentUser(reader);
      const invitation = yield* loadInvitationForResponse(reader, invitationId);
      const plan = yield* declineInvitation({
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
      yield* recordAccessLifecycleEvents(writer, plan.events, now);

      return null;
    }),
);

const cancel = FunctionImpl.make(
  databaseSchema,
  invitations,
  "cancel",
  ({ invitationId, workspaceId }) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      const actor = yield* loadActorForWorkspace(reader, workspaceId, now);
      yield* requireActorRole(actor, "admin").pipe(
        auditDeniedInvitationAction(writer, now, {
          action: "invitation.cancelled",
          workspaceId,
          actorUserId: actor.userId,
          subjectId: invitationId,
        }),
      );
      const invitation = yield* loadInvitationForResponse(reader, invitationId);
      const plan = yield* effectFromEither(
        cancelInvitation({
          invitation,
          workspaceId,
          actorUserId: actor.userId,
          now,
        }),
      ).pipe(
        auditDeniedInvitationAction(writer, now, {
          action: "invitation.cancelled",
          workspaceId,
          actorUserId: actor.userId,
          subjectId: invitationId,
        }),
      );

      if (plan.invitationPatch !== null) {
        yield* writer
          .table("invitations")
          .patch(invitationId, plan.invitationPatch.value)
          .pipe(Effect.orDie);
      }
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

const auditDeniedInvitationAction =
  (
    writer: Parameters<typeof recordAccessAuditEvent>[0],
    now: number,
    input: {
      readonly action: "invitation.created" | "invitation.cancelled";
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
            subjectKind: "invitation",
            reason: denialAuditReason(error),
          }),
          now,
        ),
      ),
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

const loadInvitationForResponse = (
  reader: Reader,
  invitationId: GenericId<"invitations">,
): Effect.Effect<InvitationRef | null, never> =>
  reader
    .table("invitations")
    .get(invitationId)
    .pipe(
      Effect.map((invitation) => toInvitationRef(invitation)),
      // Missing invitation -> null; a decode/system failure is a real defect,
      // not a silent null (same discrimination as members.impl loadMember).
      Effect.catchAll((error) =>
        error._tag === "GetByIdFailure"
          ? Effect.succeed(null)
          : Effect.die(error),
      ),
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
        membership !== null && isLiveWorkspaceMembership(membership)
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
  declinedAt: invitation.declinedAt ?? null,
  expiresAt: invitation.expiresAt,
  createdAt: invitation.createdAt,
  updatedAt: invitation.updatedAt,
});

const requireLoadedInvitation = (
  invitation: InvitationRef | null,
): Effect.Effect<InvitationRef, InvitationNotAccessible> =>
  invitation === null
    ? Effect.fail(new InvitationNotAccessible())
    : Effect.succeed(invitation);

export default GroupImpl.make(databaseSchema, invitations).pipe(
  Layer.provide(create),
  Layer.provide(accept),
  Layer.provide(decline),
  Layer.provide(cancel),
  GroupImpl.finalize,
);
