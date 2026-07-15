import * as Either from "effect/Either";
import { describe, expect, it, vi } from "vitest";

import {
  createMemberManagementAdapter,
  type InvitationId,
  type MembershipId,
  type WorkspaceId,
} from "./member-management-adapter";

const workspaceId = "workspaces_1" as WorkspaceId;
const membershipId = "workspaceMembers_1" as MembershipId;
const invitationId = "invitations_1" as InvitationId;

const mutations = () => ({
  createInvitation: vi.fn().mockResolvedValue(Either.right(invitationId)),
  cancelInvitation: vi.fn().mockResolvedValue(Either.right(null)),
  changeRole: vi.fn().mockResolvedValue(Either.right(null)),
  removeMember: vi.fn().mockResolvedValue(Either.right(null)),
  transferOwnership: vi.fn().mockResolvedValue(Either.right(null)),
});

describe("member management adapter", () => {
  it("hides privileged mutations from viewer and editor roles", async () => {
    const mutationSet = mutations();
    const adapter = createMemberManagementAdapter({
      role: "editor",
      workspaceId,
      mutations: mutationSet,
    });

    expect(adapter.canManageMembers).toBe(false);
    await expect(
      adapter.inviteMember({ email: "ada@example.com", role: "viewer" }),
    ).rejects.toThrow("admin or owner");
    expect(mutationSet.createInvitation).not.toHaveBeenCalled();
  });

  it("unwraps a successful typed action invitation id", async () => {
    const mutationSet = mutations();
    const adapter = createMemberManagementAdapter({
      role: "admin",
      workspaceId,
      mutations: mutationSet,
    });

    await expect(
      adapter.inviteMember({ email: "ada@example.com", role: "editor" }),
    ).resolves.toBe(invitationId);
  });

  it("throws typed Left action errors instead of stringifying or ignoring them", async () => {
    const mutationSet = mutations();
    mutationSet.createInvitation.mockResolvedValue(
      Either.left(new Error("denied")),
    );
    const adapter = createMemberManagementAdapter({
      role: "admin",
      workspaceId,
      mutations: mutationSet,
    });

    await expect(
      adapter.inviteMember({ email: "ada@example.com", role: "editor" }),
    ).rejects.toThrow("denied");
  });

  it("exposes target-aware role management for convenient hiding", () => {
    const admin = createMemberManagementAdapter({
      role: "admin",
      workspaceId,
      mutations: mutations(),
    });
    const owner = createMemberManagementAdapter({
      role: "owner",
      workspaceId,
      mutations: mutations(),
    });

    expect(admin.canManageRole("admin")).toBe(true);
    expect(admin.canManageRole("owner")).toBe(false);
    expect(owner.canManageRole("owner")).toBe(true);
  });

  it("dispatches admin member operations through typed access actions", async () => {
    const mutationSet = mutations();
    const adapter = createMemberManagementAdapter({
      role: "admin",
      workspaceId,
      mutations: mutationSet,
    });

    await adapter.changeRole({ membershipId, role: "viewer" });
    await adapter.removeMember({ membershipId });
    await adapter.cancelInvitation({ invitationId });

    expect(mutationSet.changeRole).toHaveBeenCalledWith({
      workspaceId,
      membershipId,
      newRole: "viewer",
    });
    expect(mutationSet.removeMember).toHaveBeenCalledWith({
      workspaceId,
      membershipId,
    });
    expect(mutationSet.cancelInvitation).toHaveBeenCalledWith({
      invitationId,
      workspaceId,
    });
  });

  it("keeps ownership transfer owner-only in the UI adapter", async () => {
    const adminMutations = mutations();
    const admin = createMemberManagementAdapter({
      role: "admin",
      workspaceId,
      mutations: adminMutations,
    });
    await expect(admin.transferOwnership({ membershipId })).rejects.toThrow(
      "owner",
    );
    expect(adminMutations.transferOwnership).not.toHaveBeenCalled();

    const ownerMutations = mutations();
    const owner = createMemberManagementAdapter({
      role: "owner",
      workspaceId,
      mutations: ownerMutations,
    });
    await owner.transferOwnership({ membershipId });
    expect(ownerMutations.transferOwnership).toHaveBeenCalledWith({
      workspaceId,
      membershipId,
    });
  });
});
