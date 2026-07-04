import * as Either from "effect/Either";

import {
  InvitationExpired,
  InvitationNotAccessible,
  InvitationNotPending,
  ValidationFailed,
} from "../errors";
import { normalizeEmail } from "./email";
import type {
  AccessLifecycleError,
  AccessLifecycleEvent,
  PlannerResult,
  WorkspaceMemberLifecycleRef,
} from "./lifecycle";
import type { Role } from "./roles";

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type InvitationStatus =
  "pending" | "accepted" | "cancelled" | "declined" | "revoked" | "expired";

type Patch<Value> = {
  readonly id: string;
  readonly value: Value;
};

export type InvitationRef = {
  readonly id: string;
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly email: string;
  readonly role: Role;
  readonly status: InvitationStatus;
  readonly tokenHash: string;
  readonly invitedByUserId: string;
  readonly acceptedAt: number | null;
  readonly revokedAt: number | null;
  readonly declinedAt: number | null;
  readonly expiresAt: number;
  readonly createdAt: number;
  readonly updatedAt: number;
};

const fail = <E extends AccessLifecycleError>(
  error: E,
): PlannerResult<never, E> => Either.left(error);
const succeed = <A>(value: A): PlannerResult<A, never> => Either.right(value);

export const buildWorkspaceInvitation = (input: {
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly inviteeEmail: string;
  readonly role: Role;
  readonly invitedByUserId: string;
  readonly tokenHash: string;
  readonly now: number;
}): PlannerResult<
  {
    readonly invitation: Omit<InvitationRef, "id">;
  },
  ValidationFailed
> => {
  const email = requireNormalizedEmail(input.inviteeEmail, "email");
  if (Either.isLeft(email)) return fail(email.left);
  const invitation = {
    workspaceId: input.workspaceId,
    organizationId: input.organizationId,
    email: email.right,
    role: input.role,
    status: "pending" as const,
    tokenHash: input.tokenHash,
    invitedByUserId: input.invitedByUserId,
    acceptedAt: null,
    revokedAt: null,
    declinedAt: null,
    expiresAt: input.now + INVITATION_TTL_MS,
    createdAt: input.now,
    updatedAt: input.now,
  };

  return succeed({
    invitation,
  });
};

export const buildInvitationCreatedEvent = (
  invitation: InvitationRef,
): AccessLifecycleEvent => ({
  action: "invitation.created",
  workspaceId: invitation.workspaceId,
  actorUserId: invitation.invitedByUserId,
  subjectKind: "invitation",
  subjectId: invitation.id,
  metadata: { email: invitation.email, role: invitation.role },
});

export const acceptInvitation = (input: {
  readonly invitation: InvitationRef | null;
  readonly verifiedEmail: string | null | undefined;
  readonly userId: string;
  readonly existingLiveMembership: WorkspaceMemberLifecycleRef | null;
  readonly now: number;
}): PlannerResult<
  {
    readonly invitationPatch: Patch<{
      readonly status: "accepted";
      readonly acceptedAt: number;
      readonly updatedAt: number;
    }>;
    readonly membershipInsert: Omit<WorkspaceMemberLifecycleRef, "id"> | null;
    readonly events: readonly AccessLifecycleEvent[];
  },
  InvitationExpired | InvitationNotAccessible | InvitationNotPending
> => {
  const invitation = requireAccessibleInvitation(
    input.invitation,
    input.verifiedEmail,
  );
  if (Either.isLeft(invitation)) return fail(invitation.left);
  const pending = requireInvitationPending(invitation.right);
  if (Either.isLeft(pending)) return fail(pending.left);
  if (invitation.right.expiresAt <= input.now) {
    return fail(new InvitationExpired({ invitationId: invitation.right.id }));
  }

  return succeed({
    invitationPatch: {
      id: invitation.right.id,
      value: {
        status: "accepted",
        acceptedAt: input.now,
        updatedAt: input.now,
      },
    },
    membershipInsert:
      input.existingLiveMembership === null
        ? {
            workspaceId: invitation.right.workspaceId,
            userId: input.userId,
            role: invitation.right.role,
            status: "active",
            acceptedAt: input.now,
            revokedAt: null,
            deletedAt: null,
          }
        : null,
    events: [
      {
        action: "invitation.accepted",
        workspaceId: invitation.right.workspaceId,
        actorUserId: input.userId,
        subjectKind: "invitation",
        subjectId: invitation.right.id,
        metadata: { acceptedByUserId: input.userId },
      },
    ],
  });
};

export const declineInvitation = (input: {
  readonly invitation: InvitationRef | null;
  readonly verifiedEmail: string | null | undefined;
  readonly now: number;
}): PlannerResult<
  {
    readonly invitationPatch: Patch<{
      readonly status: "declined";
      readonly declinedAt: number;
      readonly updatedAt: number;
    }> | null;
    readonly events: readonly AccessLifecycleEvent[];
  },
  InvitationNotAccessible
> => {
  const invitation = requireAccessibleInvitation(
    input.invitation,
    input.verifiedEmail,
  );
  if (Either.isLeft(invitation)) return fail(invitation.left);
  if (invitation.right.status !== "pending") {
    return succeed({ invitationPatch: null, events: [] });
  }
  const actorEmail = invitation.right.email;
  return succeed({
    invitationPatch: {
      id: invitation.right.id,
      value: {
        status: "declined",
        declinedAt: input.now,
        updatedAt: input.now,
      },
    },
    events: [
      {
        action: "invitation.declined",
        workspaceId: invitation.right.workspaceId,
        actorEmail,
        subjectKind: "invitation",
        subjectId: invitation.right.id,
        metadata: { reason: "declined" },
      },
    ],
  });
};

export const cancelInvitation = (input: {
  readonly invitation: InvitationRef | null;
  readonly workspaceId: string;
  readonly actorUserId: string;
  readonly now: number;
}): PlannerResult<
  {
    readonly invitationPatch: Patch<{
      readonly status: "cancelled";
      readonly revokedAt: number;
      readonly updatedAt: number;
    }> | null;
    readonly events: readonly AccessLifecycleEvent[];
  },
  never
> => {
  if (
    input.invitation === null ||
    input.invitation.workspaceId !== input.workspaceId ||
    input.invitation.status !== "pending"
  ) {
    return succeed({ invitationPatch: null, events: [] });
  }
  return succeed({
    invitationPatch: {
      id: input.invitation.id,
      value: {
        status: "cancelled",
        revokedAt: input.now,
        updatedAt: input.now,
      },
    },
    events: [
      {
        action: "invitation.cancelled",
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        subjectKind: "invitation",
        subjectId: input.invitation.id,
        metadata: { reason: "cancelled" },
      },
    ],
  });
};

const requireNormalizedEmail = (
  value: string,
  field: string,
): PlannerResult<string, ValidationFailed> => {
  const normalized = normalizeEmail(value);
  if (normalized.kind !== "verified") {
    return fail(
      new ValidationFailed({
        field,
        message: "A valid email address is required.",
      }),
    );
  }
  return succeed(normalized.email);
};

const normalizeAccessibleEmail = (
  value: string | null | undefined,
): string | null => {
  const normalized = normalizeEmail(value);
  return normalized.kind === "verified" ? normalized.email : null;
};

const requireAccessibleInvitation = (
  invitation: InvitationRef | null,
  verifiedEmail: string | null | undefined,
): PlannerResult<InvitationRef, InvitationNotAccessible> => {
  const email = normalizeAccessibleEmail(verifiedEmail);
  if (invitation === null || email === null) {
    return fail(new InvitationNotAccessible());
  }
  const invitationEmail = normalizeAccessibleEmail(invitation.email);
  if (invitationEmail === null || invitationEmail !== email) {
    return fail(new InvitationNotAccessible());
  }
  return succeed(invitation);
};

const requireInvitationPending = (
  invitation: InvitationRef,
): PlannerResult<void, InvitationNotPending> => {
  if (invitation.status !== "pending") {
    return fail(new InvitationNotPending({ invitationId: invitation.id }));
  }
  return succeed(undefined);
};
