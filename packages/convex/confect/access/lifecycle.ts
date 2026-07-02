import {
  Forbidden,
  InvitationExpired,
  InvitationNotAccessible,
  InvitationNotPending,
  LastOwnerProtected,
  MemberNotInWorkspace,
  ValidationFailed,
} from "../errors";
import { normalizeEmail } from "./email";
import { roleAtLeast, type Role } from "./roles";

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type MembershipStatus = "pending" | "active" | "revoked";
type InvitationStatus =
  "pending" | "accepted" | "cancelled" | "declined" | "revoked" | "expired";

export type WorkspaceMemberLifecycleRef = {
  readonly id: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly role: Role;
  readonly status: MembershipStatus;
  readonly acceptedAt: number | null;
  readonly revokedAt: number | null;
  readonly deletedAt: number | null;
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
  readonly expiresAt: number;
  readonly createdAt: number;
  readonly updatedAt: number;
};

type AuditMetadata =
  | { readonly previousRole: Role; readonly nextRole: Role }
  | { readonly role: Role }
  | { readonly email: string; readonly role: Role }
  | { readonly acceptedByUserId: string }
  | { readonly reason: "declined" | "cancelled" };

export type AccessLifecycleEvent = {
  readonly action:
    | "member.roleChanged"
    | "member.removed"
    | "member.ownershipTransferred"
    | "invitation.created"
    | "invitation.accepted"
    | "invitation.declined"
    | "invitation.cancelled";
  readonly workspaceId: string;
  readonly actorUserId: string;
  readonly subjectKind: "workspaceMember" | "invitation";
  readonly subjectId: string;
  readonly metadata: AuditMetadata;
};

type Patch<Value> = {
  readonly id: string;
  readonly value: Value;
};

export const changeMemberRole = (input: {
  readonly actorUserId: string;
  readonly actorRole: Role;
  readonly workspaceId: string;
  readonly target: WorkspaceMemberLifecycleRef;
  readonly liveWorkspaceMembers: readonly WorkspaceMemberLifecycleRef[];
  readonly newRole: Role;
  readonly now: number;
}): {
  readonly patch: Patch<{ readonly role: Role; readonly updatedAt: number }>;
  readonly events: readonly AccessLifecycleEvent[];
} => {
  assertLiveWorkspaceMember(input.target, input.workspaceId);
  assertActorCanManage(input.actorRole, input.target.role);
  assertActorCanGrant(input.actorRole, input.newRole);
  if (input.target.role === "owner" && input.newRole !== "owner") {
    assertNotLastOwner(input.workspaceId, input.liveWorkspaceMembers);
  }

  return {
    patch: {
      id: input.target.id,
      value: { role: input.newRole, updatedAt: input.now },
    },
    events: [
      {
        action: "member.roleChanged",
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        subjectKind: "workspaceMember",
        subjectId: input.target.id,
        metadata: {
          previousRole: input.target.role,
          nextRole: input.newRole,
        },
      },
    ],
  };
};

export const removeMember = (input: {
  readonly actorUserId: string;
  readonly actorRole: Role;
  readonly workspaceId: string;
  readonly target: WorkspaceMemberLifecycleRef;
  readonly liveWorkspaceMembers: readonly WorkspaceMemberLifecycleRef[];
  readonly now: number;
}): {
  readonly patch: Patch<{
    readonly status: "revoked";
    readonly revokedAt: number;
    readonly deletedAt: number;
    readonly updatedAt: number;
  }>;
  readonly events: readonly AccessLifecycleEvent[];
} => {
  assertLiveWorkspaceMember(input.target, input.workspaceId);
  assertActorCanManage(input.actorRole, input.target.role);
  if (input.target.role === "owner") {
    assertNotLastOwner(input.workspaceId, input.liveWorkspaceMembers);
  }

  return {
    patch: {
      id: input.target.id,
      value: {
        status: "revoked",
        revokedAt: input.now,
        deletedAt: input.now,
        updatedAt: input.now,
      },
    },
    events: [
      {
        action: "member.removed",
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        subjectKind: "workspaceMember",
        subjectId: input.target.id,
        metadata: { role: input.target.role },
      },
    ],
  };
};

export const transferOwnership = (input: {
  readonly actorUserId: string;
  readonly workspaceId: string;
  readonly target: WorkspaceMemberLifecycleRef;
  readonly actorMembership: WorkspaceMemberLifecycleRef;
  readonly now: number;
}): {
  readonly patches: readonly Patch<{
    readonly role: Role;
    readonly updatedAt: number;
  }>[];
  readonly events: readonly AccessLifecycleEvent[];
} => {
  assertLiveWorkspaceMember(input.target, input.workspaceId);
  assertLiveWorkspaceMember(input.actorMembership, input.workspaceId);
  if (
    input.target.userId === input.actorUserId ||
    input.actorMembership.userId !== input.actorUserId ||
    input.actorMembership.role !== "owner"
  ) {
    throw new Forbidden({ reason: "Cannot transfer workspace ownership." });
  }

  return {
    patches: [
      {
        id: input.target.id,
        value: { role: "owner", updatedAt: input.now },
      },
      {
        id: input.actorMembership.id,
        value: { role: "admin", updatedAt: input.now },
      },
    ],
    events: [
      {
        action: "member.ownershipTransferred",
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        subjectKind: "workspaceMember",
        subjectId: input.target.id,
        metadata: { previousRole: input.target.role, nextRole: "owner" },
      },
    ],
  };
};

export const buildWorkspaceInvitation = (input: {
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly inviteeEmail: string;
  readonly role: Role;
  readonly invitedByUserId: string;
  readonly tokenHash: string;
  readonly now: number;
}): {
  readonly invitation: Omit<InvitationRef, "id">;
  readonly events: readonly AccessLifecycleEvent[];
} => {
  const email = requireNormalizedEmail(input.inviteeEmail, "email");
  const invitation = {
    workspaceId: input.workspaceId,
    organizationId: input.organizationId,
    email,
    role: input.role,
    status: "pending" as const,
    tokenHash: input.tokenHash,
    invitedByUserId: input.invitedByUserId,
    acceptedAt: null,
    revokedAt: null,
    expiresAt: input.now + INVITATION_TTL_MS,
    createdAt: input.now,
    updatedAt: input.now,
  };

  return {
    invitation,
    events: [
      {
        action: "invitation.created",
        workspaceId: input.workspaceId,
        actorUserId: input.invitedByUserId,
        subjectKind: "invitation",
        subjectId: input.tokenHash,
        metadata: { email, role: input.role },
      },
    ],
  };
};

export const acceptInvitation = (input: {
  readonly invitation: InvitationRef | null;
  readonly verifiedEmail: string | null | undefined;
  readonly userId: string;
  readonly existingLiveMembership: WorkspaceMemberLifecycleRef | null;
  readonly now: number;
}): {
  readonly invitationPatch: Patch<{
    readonly status: "accepted";
    readonly acceptedAt: number;
    readonly updatedAt: number;
  }>;
  readonly membershipInsert: Omit<WorkspaceMemberLifecycleRef, "id"> | null;
  readonly events: readonly AccessLifecycleEvent[];
} => {
  const invitation = requireAccessibleInvitation(
    input.invitation,
    input.verifiedEmail,
  );
  assertInvitationPending(invitation);
  if (invitation.expiresAt <= input.now) {
    throw new InvitationExpired({ invitationId: invitation.id });
  }

  return {
    invitationPatch: {
      id: invitation.id,
      value: {
        status: "accepted",
        acceptedAt: input.now,
        updatedAt: input.now,
      },
    },
    membershipInsert:
      input.existingLiveMembership === null
        ? {
            workspaceId: invitation.workspaceId,
            userId: input.userId,
            role: invitation.role,
            status: "active",
            acceptedAt: input.now,
            revokedAt: null,
            deletedAt: null,
          }
        : null,
    events: [
      {
        action: "invitation.accepted",
        workspaceId: invitation.workspaceId,
        actorUserId: input.userId,
        subjectKind: "invitation",
        subjectId: invitation.id,
        metadata: { acceptedByUserId: input.userId },
      },
    ],
  };
};

export const declineInvitation = (input: {
  readonly invitation: InvitationRef | null;
  readonly verifiedEmail: string | null | undefined;
  readonly now: number;
}): {
  readonly invitationPatch: Patch<{
    readonly status: "declined";
    readonly revokedAt: number;
    readonly updatedAt: number;
  }> | null;
  readonly events: readonly AccessLifecycleEvent[];
} => {
  const invitation = requireAccessibleInvitation(
    input.invitation,
    input.verifiedEmail,
  );
  if (invitation.status !== "pending") {
    return { invitationPatch: null, events: [] };
  }
  return {
    invitationPatch: {
      id: invitation.id,
      value: {
        status: "declined",
        revokedAt: input.now,
        updatedAt: input.now,
      },
    },
    events: [
      {
        action: "invitation.declined",
        workspaceId: invitation.workspaceId,
        actorUserId: invitation.email,
        subjectKind: "invitation",
        subjectId: invitation.id,
        metadata: { reason: "declined" },
      },
    ],
  };
};

export const cancelInvitation = (input: {
  readonly invitation: InvitationRef | null;
  readonly workspaceId: string;
  readonly actorUserId: string;
  readonly now: number;
}): {
  readonly invitationPatch: Patch<{
    readonly status: "cancelled";
    readonly revokedAt: number;
    readonly updatedAt: number;
  }> | null;
  readonly events: readonly AccessLifecycleEvent[];
} => {
  if (
    input.invitation === null ||
    input.invitation.workspaceId !== input.workspaceId ||
    input.invitation.status !== "pending"
  ) {
    return { invitationPatch: null, events: [] };
  }
  return {
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
  };
};

const assertLiveWorkspaceMember = (
  member: WorkspaceMemberLifecycleRef,
  workspaceId: string,
): void => {
  if (
    member.workspaceId !== workspaceId ||
    member.status !== "active" ||
    member.acceptedAt === null ||
    member.revokedAt !== null ||
    member.deletedAt !== null
  ) {
    throw new MemberNotInWorkspace({ membershipId: member.id });
  }
};

const assertActorCanManage = (actorRole: Role, targetRole: Role): void => {
  if (!roleAtLeast(actorRole, targetRole)) {
    throw new Forbidden({
      reason: "Cannot manage a member with a higher role.",
    });
  }
};

const assertActorCanGrant = (actorRole: Role, newRole: Role): void => {
  if (!roleAtLeast(actorRole, newRole)) {
    throw new Forbidden({
      reason: "Cannot grant a role higher than your own.",
    });
  }
};

const assertNotLastOwner = (
  workspaceId: string,
  members: readonly WorkspaceMemberLifecycleRef[],
): void => {
  const liveOwners = members.filter(
    (member) =>
      member.workspaceId === workspaceId &&
      member.role === "owner" &&
      member.status === "active" &&
      member.acceptedAt !== null &&
      member.revokedAt === null &&
      member.deletedAt === null,
  );
  if (liveOwners.length <= 1) {
    throw new LastOwnerProtected({ workspaceId });
  }
};

const requireNormalizedEmail = (value: string, field: string): string => {
  const normalized = normalizeEmail(value);
  if (normalized.kind !== "verified") {
    throw new ValidationFailed({
      field,
      message: "A valid email address is required.",
    });
  }
  return normalized.email;
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
): InvitationRef => {
  const email = normalizeAccessibleEmail(verifiedEmail);
  if (invitation === null || email === null) {
    throw new InvitationNotAccessible();
  }
  const invitationEmail = normalizeAccessibleEmail(invitation.email);
  if (invitationEmail === null || invitationEmail !== email) {
    throw new InvitationNotAccessible();
  }
  return invitation;
};

const assertInvitationPending = (invitation: InvitationRef): void => {
  if (invitation.status !== "pending") {
    throw new InvitationNotPending({ invitationId: invitation.id });
  }
};
