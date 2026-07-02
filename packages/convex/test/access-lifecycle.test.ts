import { describe, expect, it } from "vitest";

import {
  acceptInvitation,
  buildWorkspaceInvitation,
  cancelInvitation,
  changeMemberRole,
  declineInvitation,
  removeMember,
  transferOwnership,
  type InvitationRef,
  type WorkspaceMemberLifecycleRef,
} from "../confect/access/lifecycle";
import {
  Forbidden,
  InvitationExpired,
  InvitationNotAccessible,
  InvitationNotPending,
  LastOwnerProtected,
  MemberNotInWorkspace,
} from "../confect/errors";

const now = 1_782_924_800_000;

const member = (
  overrides: Partial<WorkspaceMemberLifecycleRef>,
): WorkspaceMemberLifecycleRef => ({
  id: "workspaceMembers_1",
  workspaceId: "workspaces_1",
  userId: "users_1",
  role: "editor",
  status: "active",
  acceptedAt: now - 100,
  revokedAt: null,
  deletedAt: null,
  ...overrides,
});

const invitation = (overrides: Partial<InvitationRef>): InvitationRef => ({
  id: "invitations_1",
  workspaceId: "workspaces_1",
  organizationId: "organizations_1",
  email: "ada@example.com",
  role: "editor",
  status: "pending",
  tokenHash: "token_hash",
  invitedByUserId: "users_inviter",
  acceptedAt: null,
  revokedAt: null,
  expiresAt: now + 10_000,
  createdAt: now - 100,
  updatedAt: now - 100,
  ...overrides,
});

describe("workspace member lifecycle policy", () => {
  it("changes a member role when the actor can manage the target and grant the new role", () => {
    const result = changeMemberRole({
      actorUserId: "users_owner",
      actorRole: "owner",
      workspaceId: "workspaces_1",
      target: member({ id: "workspaceMembers_2", role: "editor" }),
      liveWorkspaceMembers: [
        member({
          id: "workspaceMembers_owner",
          userId: "users_owner",
          role: "owner",
        }),
        member({ id: "workspaceMembers_2", role: "editor" }),
      ],
      newRole: "admin",
      now,
    });

    expect(result.patch).toEqual({
      id: "workspaceMembers_2",
      value: { role: "admin", updatedAt: now },
    });
    expect(result.events).toEqual([
      {
        action: "member.roleChanged",
        workspaceId: "workspaces_1",
        actorUserId: "users_owner",
        subjectKind: "workspaceMember",
        subjectId: "workspaceMembers_2",
        metadata: { previousRole: "editor", nextRole: "admin" },
      },
    ]);
  });

  it("blocks self-escalation and acting on a higher role", () => {
    expect(() =>
      changeMemberRole({
        actorUserId: "users_admin",
        actorRole: "admin",
        workspaceId: "workspaces_1",
        target: member({ role: "admin", userId: "users_admin" }),
        liveWorkspaceMembers: [
          member({ role: "admin", userId: "users_admin" }),
        ],
        newRole: "owner",
        now,
      }),
    ).toThrow(Forbidden);

    expect(() =>
      removeMember({
        actorUserId: "users_admin",
        actorRole: "admin",
        workspaceId: "workspaces_1",
        target: member({ id: "workspaceMembers_owner", role: "owner" }),
        liveWorkspaceMembers: [
          member({ id: "workspaceMembers_owner", role: "owner" }),
          member({ id: "workspaceMembers_other", role: "owner" }),
        ],
        now,
      }),
    ).toThrow(Forbidden);
  });

  it("protects the last owner from demotion or removal", () => {
    const owner = member({ role: "owner" });

    expect(() =>
      changeMemberRole({
        actorUserId: "users_owner",
        actorRole: "owner",
        workspaceId: "workspaces_1",
        target: owner,
        liveWorkspaceMembers: [owner],
        newRole: "admin",
        now,
      }),
    ).toThrow(LastOwnerProtected);

    expect(() =>
      removeMember({
        actorUserId: "users_owner",
        actorRole: "owner",
        workspaceId: "workspaces_1",
        target: owner,
        liveWorkspaceMembers: [owner],
        now,
      }),
    ).toThrow(LastOwnerProtected);
  });

  it("refuses removed, pending, revoked, or cross-workspace members", () => {
    expect(() =>
      changeMemberRole({
        actorUserId: "users_owner",
        actorRole: "owner",
        workspaceId: "workspaces_1",
        target: member({ workspaceId: "workspaces_2" }),
        liveWorkspaceMembers: [],
        newRole: "admin",
        now,
      }),
    ).toThrow(MemberNotInWorkspace);
  });

  it("transfers ownership by promoting the target and stepping the caller down", () => {
    const result = transferOwnership({
      actorUserId: "users_owner",
      workspaceId: "workspaces_1",
      target: member({
        id: "workspaceMembers_target",
        userId: "users_target",
        role: "editor",
      }),
      actorMembership: member({
        id: "workspaceMembers_actor",
        userId: "users_owner",
        role: "owner",
      }),
      now,
    });

    expect(result.patches).toEqual([
      {
        id: "workspaceMembers_target",
        value: { role: "owner", updatedAt: now },
      },
      {
        id: "workspaceMembers_actor",
        value: { role: "admin", updatedAt: now },
      },
    ]);
    expect(result.events.map((event) => event.action)).toEqual([
      "member.ownershipTransferred",
    ]);
  });
});

describe("workspace invitation lifecycle policy", () => {
  it("builds a normalized pending invitation with an audit event", () => {
    const result = buildWorkspaceInvitation({
      workspaceId: "workspaces_1",
      organizationId: "organizations_1",
      inviteeEmail: " ADA@Example.COM ",
      role: "editor",
      invitedByUserId: "users_owner",
      tokenHash: "token_hash",
      now,
    });

    expect(result.invitation).toMatchObject({
      workspaceId: "workspaces_1",
      organizationId: "organizations_1",
      email: "ada@example.com",
      role: "editor",
      status: "pending",
      expiresAt: now + 7 * 24 * 60 * 60 * 1000,
    });
    expect(result.events).toEqual([
      {
        action: "invitation.created",
        workspaceId: "workspaces_1",
        actorUserId: "users_owner",
        subjectKind: "invitation",
        subjectId: "token_hash",
        metadata: { email: "ada@example.com", role: "editor" },
      },
    ]);
  });

  it("opaque-denies missing, wrong-email, and blank-email invite access", () => {
    expect(() =>
      acceptInvitation({
        invitation: null,
        verifiedEmail: "ada@example.com",
        userId: "users_ada",
        existingLiveMembership: null,
        now,
      }),
    ).toThrow(InvitationNotAccessible);

    expect(() =>
      acceptInvitation({
        invitation: invitation({ email: "ada@example.com" }),
        verifiedEmail: "grace@example.com",
        userId: "users_grace",
        existingLiveMembership: null,
        now,
      }),
    ).toThrow(InvitationNotAccessible);

    expect(() =>
      declineInvitation({
        invitation: invitation({ email: "" }),
        verifiedEmail: " ",
        now,
      }),
    ).toThrow(InvitationNotAccessible);
  });

  it("rejects non-pending and expired invitations after verifying the invitee", () => {
    expect(() =>
      acceptInvitation({
        invitation: invitation({ status: "accepted" }),
        verifiedEmail: "ada@example.com",
        userId: "users_ada",
        existingLiveMembership: null,
        now,
      }),
    ).toThrow(InvitationNotPending);

    expect(() =>
      acceptInvitation({
        invitation: invitation({ expiresAt: now }),
        verifiedEmail: "ada@example.com",
        userId: "users_ada",
        existingLiveMembership: null,
        now,
      }),
    ).toThrow(InvitationExpired);
  });

  it("accepts by creating one membership unless the invitee is already a live member", () => {
    const accepted = acceptInvitation({
      invitation: invitation({}),
      verifiedEmail: "ADA@example.com",
      userId: "users_ada",
      existingLiveMembership: null,
      now,
    });

    expect(accepted.membershipInsert).toMatchObject({
      workspaceId: "workspaces_1",
      userId: "users_ada",
      role: "editor",
      status: "active",
      acceptedAt: now,
      revokedAt: null,
      deletedAt: null,
    });
    expect(accepted.invitationPatch).toEqual({
      id: "invitations_1",
      value: { status: "accepted", acceptedAt: now, updatedAt: now },
    });

    const alreadyMember = acceptInvitation({
      invitation: invitation({}),
      verifiedEmail: "ada@example.com",
      userId: "users_ada",
      existingLiveMembership: member({ userId: "users_ada" }),
      now,
    });

    expect(alreadyMember.membershipInsert).toBeNull();
  });

  it("declines and cancels only pending invitations", () => {
    expect(
      declineInvitation({
        invitation: invitation({}),
        verifiedEmail: "ada@example.com",
        now,
      }).invitationPatch,
    ).toEqual({
      id: "invitations_1",
      value: { status: "declined", revokedAt: now, updatedAt: now },
    });

    expect(
      cancelInvitation({
        invitation: invitation({ workspaceId: "workspaces_1" }),
        workspaceId: "workspaces_1",
        actorUserId: "users_owner",
        now,
      }).invitationPatch,
    ).toEqual({
      id: "invitations_1",
      value: { status: "cancelled", revokedAt: now, updatedAt: now },
    });

    expect(
      cancelInvitation({
        invitation: invitation({ status: "accepted" }),
        workspaceId: "workspaces_1",
        actorUserId: "users_owner",
        now,
      }).invitationPatch,
    ).toBeNull();

    expect(
      cancelInvitation({
        invitation: invitation({ workspaceId: "workspaces_other" }),
        workspaceId: "workspaces_1",
        actorUserId: "users_owner",
        now,
      }).invitationPatch,
    ).toBeNull();
  });
});
