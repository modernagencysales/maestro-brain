import type { WorkspaceRole } from "../../providers/workspace";

type AccessMutationRef = unknown;

type MemberManagementRefs = {
  readonly members: {
    readonly changeRole: AccessMutationRef;
    readonly remove: AccessMutationRef;
    readonly transferOwnership: AccessMutationRef;
  };
  readonly invitations: {
    readonly create: AccessMutationRef;
    readonly cancel: AccessMutationRef;
  };
};

type MutationRunner = (
  ref: AccessMutationRef,
  args: Record<string, unknown>,
) => Promise<unknown>;

export type MemberManagementAdapter = {
  readonly role: WorkspaceRole;
  readonly canManageMembers: boolean;
  readonly canTransferOwnership: boolean;
  readonly inviteMember: (input: {
    readonly email: string;
    readonly role: WorkspaceRole;
  }) => Promise<string>;
  readonly changeRole: (input: {
    readonly membershipId: string;
    readonly role: WorkspaceRole;
  }) => Promise<void>;
  readonly removeMember: (input: {
    readonly membershipId: string;
  }) => Promise<void>;
  readonly cancelInvitation: (input: {
    readonly invitationId: string;
  }) => Promise<void>;
  readonly transferOwnership: (input: {
    readonly membershipId: string;
  }) => Promise<void>;
};

export const createMemberManagementAdapter = ({
  role,
  workspaceId,
  refs,
  runMutation,
}: {
  readonly role: WorkspaceRole;
  readonly workspaceId: string;
  readonly refs: MemberManagementRefs;
  readonly runMutation: MutationRunner;
}): MemberManagementAdapter => {
  const canManageMembers = role === "admin" || role === "owner";
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
    canTransferOwnership,
    inviteMember: async ({ email, role }) => {
      requireMemberManager();
      const invitationId = await runMutation(refs.invitations.create, {
        workspaceId,
        email,
        role,
      });
      return String(invitationId);
    },
    changeRole: async ({ membershipId, role }) => {
      requireMemberManager();
      await runMutation(refs.members.changeRole, {
        membershipId,
        newRole: role,
      });
    },
    removeMember: async ({ membershipId }) => {
      requireMemberManager();
      await runMutation(refs.members.remove, { membershipId });
    },
    cancelInvitation: async ({ invitationId }) => {
      requireMemberManager();
      await runMutation(refs.invitations.cancel, {
        invitationId,
        workspaceId,
      });
    },
    transferOwnership: async ({ membershipId }) => {
      requireOwner();
      await runMutation(refs.members.transferOwnership, { membershipId });
    },
  };
};
