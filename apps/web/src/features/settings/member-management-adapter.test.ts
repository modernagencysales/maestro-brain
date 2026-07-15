import { describe, expect, it, vi } from "vitest";

import { createMemberManagementAdapter } from "./member-management-adapter";

const refs = {
  members: {
    changeRole: {
      functionNamespace: "access/members",
      functionSpec: { name: "changeRole" },
    },
    remove: {
      functionNamespace: "access/members",
      functionSpec: { name: "remove" },
    },
    transferOwnership: {
      functionNamespace: "access/members",
      functionSpec: { name: "transferOwnership" },
    },
  },
  invitations: {
    create: {
      functionNamespace: "access/invitations",
      functionSpec: { name: "create" },
    },
    cancel: {
      functionNamespace: "access/invitations",
      functionSpec: { name: "cancel" },
    },
  },
} as const;

describe("member management adapter", () => {
  it("hides privileged mutations from viewer and editor roles", async () => {
    const runMutation = vi.fn();
    const adapter = createMemberManagementAdapter({
      role: "editor",
      workspaceId: "workspaces_1",
      refs,
      runMutation,
    });

    expect(adapter.canManageMembers).toBe(false);
    await expect(
      adapter.inviteMember({ email: "ada@example.com", role: "viewer" }),
    ).rejects.toThrow("admin or owner");
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("dispatches admin member operations through generated access refs", async () => {
    const runMutation = vi.fn().mockResolvedValue("invitations_1");
    const adapter = createMemberManagementAdapter({
      role: "admin",
      workspaceId: "workspaces_1",
      refs,
      runMutation,
    });

    await expect(
      adapter.inviteMember({ email: "ada@example.com", role: "editor" }),
    ).resolves.toBe("invitations_1");
    await adapter.changeRole({
      membershipId: "workspaceMembers_1",
      role: "viewer",
    });
    await adapter.removeMember({ membershipId: "workspaceMembers_1" });
    await adapter.cancelInvitation({ invitationId: "invitations_1" });

    expect(runMutation).toHaveBeenNthCalledWith(1, refs.invitations.create, {
      workspaceId: "workspaces_1",
      email: "ada@example.com",
      role: "editor",
    });
    expect(runMutation).toHaveBeenNthCalledWith(2, refs.members.changeRole, {
      membershipId: "workspaceMembers_1",
      newRole: "viewer",
    });
    expect(runMutation).toHaveBeenNthCalledWith(3, refs.members.remove, {
      membershipId: "workspaceMembers_1",
    });
    expect(runMutation).toHaveBeenNthCalledWith(4, refs.invitations.cancel, {
      invitationId: "invitations_1",
      workspaceId: "workspaces_1",
    });
  });

  it("keeps ownership transfer owner-only in the UI adapter", async () => {
    const adminMutation = vi.fn();
    const admin = createMemberManagementAdapter({
      role: "admin",
      workspaceId: "workspaces_1",
      refs,
      runMutation: adminMutation,
    });
    await expect(
      admin.transferOwnership({ membershipId: "workspaceMembers_2" }),
    ).rejects.toThrow("owner");
    expect(adminMutation).not.toHaveBeenCalled();

    const ownerMutation = vi.fn().mockResolvedValue(null);
    const owner = createMemberManagementAdapter({
      role: "owner",
      workspaceId: "workspaces_1",
      refs,
      runMutation: ownerMutation,
    });
    await owner.transferOwnership({ membershipId: "workspaceMembers_2" });
    expect(ownerMutation).toHaveBeenCalledWith(refs.members.transferOwnership, {
      membershipId: "workspaceMembers_2",
    });
  });
});
