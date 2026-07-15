import { describe, expect, it } from "vitest";
import * as Either from "effect/Either";

import {
  accessAuditEventInsert,
  denialAuditReason,
  deniedPrivilegedAccessAuditEvent,
  privilegedAccessAuditActions,
} from "../confect/access/audit";
import { resolveEffectiveWorkspaceRole } from "../confect/access/auth";
import {
  changeMemberRole,
  removeMember,
  transferOwnership,
  type WorkspaceMemberLifecycleRef,
} from "../confect/access/lifecycle";
import { canManageWorkspaceMembers } from "../confect/access/members.impl";
import {
  Forbidden,
  LastOwnerProtected,
  MemberNotInWorkspace,
  MembershipNotLive,
} from "../confect/errors";

const now = 1_782_924_800_000;
const roles = ["viewer", "editor", "admin", "owner"] as const;

const member = (
  overrides: Partial<WorkspaceMemberLifecycleRef>,
): WorkspaceMemberLifecycleRef => ({
  id: "workspaceMembers_target",
  workspaceId: "workspaces_brain",
  userId: "users_target",
  role: "editor",
  status: "active",
  acceptedAt: now - 100,
  revokedAt: null,
  deletedAt: null,
  ...overrides,
});

const liveOwners = [
  member({
    id: "workspaceMembers_owner_1",
    userId: "users_owner_1",
    role: "owner",
  }),
  member({
    id: "workspaceMembers_owner_2",
    userId: "users_owner_2",
    role: "owner",
  }),
];

describe("Brain role matrix", () => {
  it.each(roles)(
    "allows member administration only for admin and owner at the server boundary for %s",
    (role) => {
      expect(canManageWorkspaceMembers(role)).toBe(
        role === "admin" || role === "owner",
      );
    },
  );

  it.each(roles)(
    "allows ownership transfer only for owner, not %s",
    (actorRole) => {
      const result = transferOwnership({
        actorUserId: `users_${actorRole}`,
        workspaceId: "workspaces_brain",
        target: member({ userId: "users_target", role: "admin" }),
        actorMembership: member({
          userId: `users_${actorRole}`,
          role: actorRole,
        }),
        now,
      });

      if (actorRole === "owner") {
        expect(Either.isRight(result)).toBe(true);
      } else {
        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result))
          expect(result.left).toBeInstanceOf(Forbidden);
      }
    },
  );

  it("denies revoked direct membership and cross-Brain targets before planning writes", () => {
    const revoked = removeMember({
      actorUserId: "users_admin",
      actorRole: "admin",
      workspaceId: "workspaces_brain",
      target: member({ status: "revoked", revokedAt: now - 1 }),
      liveWorkspaceMembers: liveOwners,
      now,
    });
    expect(Either.isLeft(revoked)).toBe(true);
    if (Either.isLeft(revoked)) {
      expect(revoked.left).toBeInstanceOf(MembershipNotLive);
    }

    const crossBrain = changeMemberRole({
      actorUserId: "users_owner",
      actorRole: "owner",
      workspaceId: "workspaces_brain",
      target: member({ workspaceId: "workspaces_other" }),
      liveWorkspaceMembers: liveOwners,
      newRole: "viewer",
      now,
    });
    expect(Either.isLeft(crossBrain)).toBe(true);
    if (Either.isLeft(crossBrain)) {
      expect(crossBrain.left).toBeInstanceOf(MemberNotInWorkspace);
    }
  });

  it("grants organization admins the capped member-management baseline", () => {
    const resolution = resolveEffectiveWorkspaceRole({
      nowMs: now,
      userId: "users_org_owner",
      workspace: {
        id: "workspaces_brain",
        organizationId: "organizations_agency",
        status: "active",
      },
      organization: { id: "organizations_agency", status: "active" },
      workspaceMembers: [],
      organizationMembers: [
        {
          organizationId: "organizations_agency",
          userId: "users_org_owner",
          role: "owner",
          status: "active",
          acceptedAt: now - 100,
          revokedAt: null,
        },
      ],
      guestGrants: [],
    });

    expect(resolution).toMatchObject({
      ok: true,
      role: "admin",
      source: "organization",
    });
    expect(resolution.ok && canManageWorkspaceMembers(resolution.role)).toBe(
      true,
    );
  });

  it("denies revoked organization baseline and cross-Brain organization members", () => {
    const revoked = resolveEffectiveWorkspaceRole({
      nowMs: now,
      userId: "users_org_admin",
      workspace: {
        id: "workspaces_brain",
        organizationId: "organizations_agency",
        status: "active",
      },
      organization: { id: "organizations_agency", status: "active" },
      workspaceMembers: [],
      organizationMembers: [
        {
          organizationId: "organizations_agency",
          userId: "users_org_admin",
          role: "admin",
          status: "revoked",
          acceptedAt: now - 100,
          revokedAt: now - 1,
        },
      ],
      guestGrants: [],
    });
    const crossBrain = resolveEffectiveWorkspaceRole({
      nowMs: now,
      userId: "users_org_admin",
      workspace: {
        id: "workspaces_brain",
        organizationId: "organizations_agency",
        status: "active",
      },
      organization: { id: "organizations_agency", status: "active" },
      workspaceMembers: [],
      organizationMembers: [
        {
          organizationId: "organizations_other",
          userId: "users_org_admin",
          role: "admin",
          status: "active",
          acceptedAt: now - 100,
          revokedAt: null,
        },
      ],
      guestGrants: [],
    });

    expect(revoked).toEqual({ ok: false, reason: "NO_WORKSPACE_ACCESS" });
    expect(crossBrain).toEqual({ ok: false, reason: "NO_WORKSPACE_ACCESS" });
  });

  it("preserves last-owner protection for demotion and removal", () => {
    const onlyOwner = member({ role: "owner", userId: "users_owner" });
    const demotion = changeMemberRole({
      actorUserId: "users_owner",
      actorRole: "owner",
      workspaceId: "workspaces_brain",
      target: onlyOwner,
      liveWorkspaceMembers: [onlyOwner],
      newRole: "admin",
      now,
    });
    const removal = removeMember({
      actorUserId: "users_owner",
      actorRole: "owner",
      workspaceId: "workspaces_brain",
      target: onlyOwner,
      liveWorkspaceMembers: [onlyOwner],
      now,
    });

    expect(Either.isLeft(demotion)).toBe(true);
    if (Either.isLeft(demotion)) {
      expect(demotion.left).toBeInstanceOf(LastOwnerProtected);
    }
    expect(Either.isLeft(removal)).toBe(true);
    if (Either.isLeft(removal)) {
      expect(removal.left).toBeInstanceOf(LastOwnerProtected);
    }
  });

  it("builds redacted member denial audit metadata from typed server errors", () => {
    const row = accessAuditEventInsert(
      deniedPrivilegedAccessAuditEvent({
        action: "member.roleChanged",
        workspaceId: "workspaces_brain",
        actorUserId: "users_viewer",
        subjectKind: "workspaceMember",
        subjectId: "workspaceMembers_target",
        reason: denialAuditReason(
          new Forbidden({ reason: "Member management requires admin." }),
        ),
      }),
      now,
    );

    expect(row).toMatchObject({
      action: "member.roleChanged",
      actorUserId: "users_viewer",
      subjectKind: "workspaceMember",
      subjectId: "workspaceMembers_target",
      metadataJson: '{"outcome":"denied","reason":"Forbidden"}',
    });
    expect(row.metadataJson).not.toContain("viewer@example.com");
  });

  it("builds redacted invitation denial audit metadata from typed server errors", () => {
    const row = accessAuditEventInsert(
      deniedPrivilegedAccessAuditEvent({
        action: "invitation.cancelled",
        workspaceId: "workspaces_brain",
        actorUserId: "users_viewer",
        subjectKind: "invitation",
        subjectId: "invitations_pending",
        reason: denialAuditReason(
          new Forbidden({ reason: "Insufficient workspace role." }),
        ),
      }),
      now,
    );

    expect(row).toMatchObject({
      action: "invitation.cancelled",
      subjectKind: "invitation",
      subjectId: "invitations_pending",
      metadataJson: '{"outcome":"denied","reason":"Forbidden"}',
    });
    expect(row.metadataJson).not.toContain("invitee@example.com");
  });

  it("declares one redacted privileged audit vocabulary for later Brain actions", () => {
    expect(privilegedAccessAuditActions).toEqual([
      "member.roleChanged",
      "member.removed",
      "member.ownershipTransferred",
      "invitation.created",
      "invitation.accepted",
      "invitation.declined",
      "invitation.cancelled",
      "slack.connectionChanged",
      "slack.channelPolicyChanged",
      "retention.policyChanged",
      "model.egressPolicyChanged",
      "autopilot.policyChanged",
      "export.administered",
      "apiKey.administered",
    ]);

    const row = accessAuditEventInsert(
      {
        action: "apiKey.administered",
        workspaceId: "workspaces_brain",
        actorUserId: "users_admin",
        subjectKind: "privilegedAction",
        subjectId: "key_redacted",
        metadata: { outcome: "denied", reason: "insufficient_role" },
      },
      now,
    );

    expect(row).toMatchObject({
      action: "apiKey.administered",
      subjectKind: "privilegedAction",
    });
    expect(row.metadataJson).toBe(
      '{"outcome":"denied","reason":"insufficient_role"}',
    );
    expect(row.metadataJson).not.toContain("secret");
  });
});
