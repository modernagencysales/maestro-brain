import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
import * as Layer from "effect/Layer";

import type { InvitationsDoc } from "../_generated/docs";
import refs from "../_generated/refs";
import databaseSchema from "../_generated/schema";
import {
  DatabaseReader,
  DatabaseWriter,
  MutationRunner,
} from "../_generated/services";
import { stableFingerprint } from "../shared/tokenCrypto";
import {
  deniedPrivilegedAccessAuditEvent,
  denialAuditReason,
  recordAccessAuditEvent,
  recordAccessLifecycleEvents,
} from "./audit";
import { resolveEffectiveWorkspaceRole } from "./auth";
import { roleAtLeast, type Role } from "./roles";
import {
  Forbidden,
  InvitationNotAccessible,
  Unauthorized,
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

const createCore = FunctionImpl.make(
  databaseSchema,
  invitations,
  "createCore",
  ({ workspaceId, email, role }) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      const actor = yield* loadActorForWorkspace(reader, workspaceId, now);
      yield* requireActorRole(actor, "admin");
      yield* requireActorCanInviteRole(actor, role);
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
      const acceptedInvitation = yield* requireLoadedInvitation(invitation);
      yield* requireInvitationWorkspaceLive(reader, acceptedInvitation);
      const existingLiveMembership =
        yield* loadOptionalLiveWorkspaceMemberForUser(
          reader,
          acceptedInvitation.workspaceId,
          user._id,
        );
      const plan = yield* acceptInvitation({
        invitation: acceptedInvitation,
        verifiedEmail: user.email,
        userId: user._id,
        existingLiveMembership,
        now,
      });

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

const cancelCore = FunctionImpl.make(
  databaseSchema,
  invitations,
  "cancelCore",
  ({ invitationId, workspaceId }) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      const actor = yield* loadActorForWorkspace(reader, workspaceId, now);
      yield* requireActorRole(actor, "admin");
      const invitation = yield* loadCancellableInvitation(
        reader,
        invitationId,
        workspaceId,
        now,
      );
      yield* requireActorCanInviteRole(actor, invitation.role);
      const plan = yield* effectFromEither(
        cancelInvitation({
          invitation,
          workspaceId,
          actorUserId: actor.userId,
          now,
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

const list = FunctionImpl.make(
  databaseSchema,
  invitations,
  "list",
  ({ workspaceId }) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const reader = yield* DatabaseReader;
      yield* loadActorForWorkspace(reader, workspaceId, now);
      const workspace = yield* reader
        .table("workspaces")
        .get(workspaceId)
        .pipe(Effect.orDie);
      const rows = yield* reader
        .table("invitations")
        .index("by_workspace_status", (q) =>
          q.eq("workspaceId", workspaceId).eq("status", "pending"),
        )
        .collect()
        .pipe(Effect.orDie);
      return rows
        .filter(
          (row) =>
            row.organizationId === workspace.organizationId &&
            row.expiresAt > now,
        )
        .map((row) => ({
          invitationId: row._id,
          email: row.email,
          role: row.role,
          status: row.status,
          expiresAt: row.expiresAt,
        }));
    }),
);

const create = FunctionImpl.make(
  databaseSchema,
  invitations,
  "create",
  (args) =>
    Effect.gen(function* () {
      const runMutation = yield* MutationRunner;
      return yield* runMutation(
        refs.internal.access.invitations.createCore,
        args,
      ).pipe(
        Effect.catchTags({
          Forbidden: (error) =>
            recordInvitationDenial(runMutation, {
              workspaceId: args.workspaceId,
              action: "invitation.created",
              subjectId: "pending-invitation",
              reason: denialAuditReason(error),
            }).pipe(Effect.flatMap(() => Effect.fail(error))),
          ValidationFailed: (error) =>
            recordInvitationDenial(runMutation, {
              workspaceId: args.workspaceId,
              action: "invitation.created",
              subjectId: "pending-invitation",
              reason: denialAuditReason(error),
            }).pipe(Effect.flatMap(() => Effect.fail(error))),
          WorkspaceNotFound: (error) =>
            recordInvitationDenial(runMutation, {
              workspaceId: args.workspaceId,
              action: "invitation.created",
              subjectId: "pending-invitation",
              reason: denialAuditReason(error),
            }).pipe(Effect.flatMap(() => Effect.fail(error))),
          ParseError: (error) => Effect.die(error),
        }),
      );
    }),
);

const cancel = FunctionImpl.make(
  databaseSchema,
  invitations,
  "cancel",
  (args) =>
    Effect.gen(function* () {
      const runMutation = yield* MutationRunner;
      yield* runMutation(
        refs.internal.access.invitations.cancelCore,
        args,
      ).pipe(
        Effect.catchTags({
          Forbidden: (error) =>
            recordInvitationDenial(runMutation, {
              workspaceId: args.workspaceId,
              action: "invitation.cancelled",
              subjectId: args.invitationId,
              reason: denialAuditReason(error),
            }).pipe(Effect.flatMap(() => Effect.fail(error))),
          ParseError: (error) => Effect.die(error),
        }),
      );
      return null;
    }),
);

const recordDenialAudit = FunctionImpl.make(
  databaseSchema,
  invitations,
  "recordDenialAudit",
  ({ workspaceId, action, subjectId, reason }) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      const actor = yield* loadCurrentUser(reader);
      yield* recordAccessAuditEvent(
        writer,
        deniedPrivilegedAccessAuditEvent({
          action,
          workspaceId,
          actorUserId: actor._id,
          subjectKind: "invitation",
          subjectId,
          reason,
        }),
        now,
      );
      return null;
    }),
);

const recordInvitationDenial = (
  runMutation: Context.Tag.Service<typeof MutationRunner>,
  input: {
    readonly workspaceId: GenericId<"workspaces"> | string;
    readonly action: "invitation.created" | "invitation.cancelled";
    readonly subjectId: string;
    readonly reason: string;
  },
): Effect.Effect<void> =>
  runMutation(refs.internal.access.invitations.recordDenialAudit, {
    ...input,
    workspaceId: asGenericId<"workspaces">(input.workspaceId),
  }).pipe(Effect.orDie, Effect.asVoid);

const effectFromEither = <A, E>(
  either: Either.Either<A, E>,
): Effect.Effect<A, E> =>
  Either.isLeft(either)
    ? Effect.fail(either.left)
    : Effect.succeed(either.right);

const requireActorCanInviteRole = (
  actor: { readonly role: Role },
  invitedRole: Role,
): Effect.Effect<void, Forbidden> =>
  roleAtLeast(actor.role, invitedRole)
    ? Effect.void
    : Effect.fail(
        new Forbidden({
          reason: "Cannot invite a role higher than your own.",
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

const loadCancellableInvitation = (
  reader: Reader,
  invitationId: GenericId<"invitations">,
  workspaceId: GenericId<"workspaces"> | string,
  now: number,
): Effect.Effect<InvitationRef, Forbidden> =>
  loadInvitationForResponse(reader, invitationId).pipe(
    Effect.flatMap((invitation) => {
      if (invitation === null || invitation.workspaceId !== workspaceId) {
        return Effect.fail(
          new Forbidden({ reason: "Invitation access could not be resolved." }),
        );
      }
      return reader
        .table("workspaces")
        .get(asGenericId<"workspaces">(workspaceId))
        .pipe(
          Effect.orDie,
          Effect.flatMap((workspace) => {
            if (workspace.organizationId !== invitation.organizationId) {
              return Effect.fail(
                new Forbidden({
                  reason: "Invitation access could not be resolved.",
                }),
              );
            }
            if (
              invitation.status !== "pending" ||
              invitation.expiresAt <= now
            ) {
              return Effect.fail(
                new Forbidden({ reason: "Invitation is not pending." }),
              );
            }
            return Effect.succeed(invitation);
          }),
        );
    }),
  );

const loadOptionalLiveWorkspaceMemberForUser = (
  reader: Reader,
  workspaceId: GenericId<"workspaces"> | string,
  userId: GenericId<"users"> | string,
): Effect.Effect<WorkspaceMemberLifecycleRef | null, InvitationNotAccessible> =>
  reader
    .table("workspaceMembers")
    .index("by_workspace_user", (q) =>
      q.eq("workspaceId", workspaceId).eq("userId", userId),
    )
    .collect()
    .pipe(
      Effect.orDie,
      Effect.map((members_) =>
        members_.map(toLifecycleMember).filter(isLiveWorkspaceMembership),
      ),
      Effect.flatMap((members_) => {
        if (members_.length > 1) {
          return Effect.fail(new InvitationNotAccessible());
        }
        return Effect.succeed(members_[0] ?? null);
      }),
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

const requireInvitationWorkspaceLive = (
  reader: Reader,
  invitation: InvitationRef,
): Effect.Effect<void, InvitationNotAccessible> =>
  Effect.gen(function* () {
    const workspace = yield* reader
      .table("workspaces")
      .get(asGenericId<"workspaces">(invitation.workspaceId))
      .pipe(
        Effect.catchAll((error) =>
          error._tag === "GetByIdFailure"
            ? Effect.fail(new InvitationNotAccessible())
            : Effect.die(error),
        ),
      );
    if (
      workspace.status !== "active" ||
      workspace.organizationId !== invitation.organizationId
    ) {
      return yield* Effect.fail(new InvitationNotAccessible());
    }
    const organization = yield* reader
      .table("organizations")
      .get(asGenericId<"organizations">(invitation.organizationId))
      .pipe(
        Effect.catchAll((error) =>
          error._tag === "GetByIdFailure"
            ? Effect.fail(new InvitationNotAccessible())
            : Effect.die(error),
        ),
      );
    if (organization.status !== "active") {
      return yield* Effect.fail(new InvitationNotAccessible());
    }
  });

export default GroupImpl.make(databaseSchema, invitations).pipe(
  Layer.provide(list),
  Layer.provide(create),
  Layer.provide(createCore),
  Layer.provide(accept),
  Layer.provide(decline),
  Layer.provide(cancel),
  Layer.provide(cancelCore),
  Layer.provide(recordDenialAudit),
  GroupImpl.finalize,
);
