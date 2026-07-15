import type { Ref } from "@confect/core";
import type { InvokeReturn } from "@confect/react";
import type { templateConfectRefs } from "@maestro-template/convex/refs";
import * as Either from "effect/Either";

import type { WorkspaceRole } from "../../providers/workspace";

export type AccessRefs = typeof templateConfectRefs.public.access;
type CreateInvitationRef = AccessRefs["invitations"]["create"];
type CancelInvitationRef = AccessRefs["invitations"]["cancel"];
type ChangeRoleRef = AccessRefs["members"]["changeRole"];
type RemoveMemberRef = AccessRefs["members"]["remove"];
type TransferOwnershipRef = AccessRefs["members"]["transferOwnership"];

export type WorkspaceId = Ref.Args<CreateInvitationRef>["workspaceId"];
export type MembershipId = Ref.Args<ChangeRoleRef>["membershipId"];
export type InvitationId = Ref.Args<CancelInvitationRef>["invitationId"];

export type MemberManagementMutations = {
  readonly createInvitation: (
    args: Ref.Args<CreateInvitationRef>,
  ) => InvokeReturn<CreateInvitationRef>;
  readonly cancelInvitation: (
    args: Ref.Args<CancelInvitationRef>,
  ) => InvokeReturn<CancelInvitationRef>;
  readonly changeRole: (
    args: Ref.Args<ChangeRoleRef>,
  ) => InvokeReturn<ChangeRoleRef>;
  readonly removeMember: (
    args: Ref.Args<RemoveMemberRef>,
  ) => InvokeReturn<RemoveMemberRef>;
  readonly transferOwnership: (
    args: Ref.Args<TransferOwnershipRef>,
  ) => InvokeReturn<TransferOwnershipRef>;
};

export type MemberManagementAdapter = {
  readonly role: WorkspaceRole;
  readonly canManageMembers: boolean;
  readonly canManageRole: (role: WorkspaceRole) => boolean;
  readonly canTransferOwnership: boolean;
  readonly inviteMember: (input: {
    readonly email: string;
    readonly role: WorkspaceRole;
  }) => Promise<string>;
  readonly changeRole: (input: {
    readonly membershipId: MembershipId;
    readonly role: WorkspaceRole;
  }) => Promise<void>;
  readonly removeMember: (input: {
    readonly membershipId: MembershipId;
  }) => Promise<void>;
  readonly cancelInvitation: (input: {
    readonly invitationId: InvitationId;
  }) => Promise<void>;
  readonly transferOwnership: (input: {
    readonly membershipId: MembershipId;
  }) => Promise<void>;
};

export const createMemberManagementAdapter = ({
  role,
  workspaceId,
  mutations,
}: {
  readonly role: WorkspaceRole;
  readonly workspaceId: WorkspaceId;
  readonly mutations: MemberManagementMutations;
}): MemberManagementAdapter => {
  const canManageMembers = role === "admin" || role === "owner";
  const canManageRole = (targetRole: WorkspaceRole) =>
    canManageMembers && (role === "owner" || targetRole !== "owner");
  const canTransferOwnership = role === "owner";

  const requireMemberManager = () => {
    if (!canManageMembers) {
      throw new Error("Member management requires admin or owner role.");
    }
  };
  const requireOwner = () => {
    if (!canTransferOwnership) {
      throw new Error("Ownership transfer requires owner role.");
    }
  };

  return {
    role,
    canManageMembers,
    canManageRole,
    canTransferOwnership,
    inviteMember: async ({ email, role }) => {
      requireMemberManager();
      const invitationId = unwrapActionResult(
        await mutations.createInvitation({
          workspaceId,
          email,
          role,
        }),
      );
      return String(invitationId);
    },
    changeRole: async ({ membershipId, role }) => {
      requireMemberManager();
      unwrapActionResult(
        await mutations.changeRole({
          workspaceId,
          membershipId,
          newRole: role,
        }),
      );
    },
    removeMember: async ({ membershipId }) => {
      requireMemberManager();
      unwrapActionResult(
        await mutations.removeMember({ workspaceId, membershipId }),
      );
    },
    cancelInvitation: async ({ invitationId }) => {
      requireMemberManager();
      unwrapActionResult(
        await mutations.cancelInvitation({ invitationId, workspaceId }),
      );
    },
    transferOwnership: async ({ membershipId }) => {
      requireOwner();
      unwrapActionResult(
        await mutations.transferOwnership({ workspaceId, membershipId }),
      );
    },
  };
};

const unwrapActionResult = <A, E>(result: A | Either.Either<A, E>): A => {
  if (Either.isEither(result)) {
    if (Either.isLeft(result)) throw result.left;
    return result.right;
  }
  return result;
};
