import { describe, expect, it } from "vitest";
import {
  assertOwningSide,
  highestCandidate,
  requireOrganizationMember,
  requireWorkspaceMember,
  resolveEffectiveWorkspaceRole,
  resolveRoleCandidates,
} from "../confect/access/auth";

const activeWorkspace = {
  id: "workspace_123",
  organizationId: "org_123",
  status: "active" as const,
};

const activeOrganization = {
  id: "org_123",
  status: "active" as const,
};

const baseSnapshot = {
  nowMs: 100,
  userId: "user_123",
  workspace: activeWorkspace,
  organization: activeOrganization,
  workspaceMembers: [],
  organizationMembers: [],
  guestGrants: [],
};

describe("effective workspace role resolver", () => {
  it("resolves direct workspace membership", () => {
    const result = resolveEffectiveWorkspaceRole({
      ...baseSnapshot,
      workspaceMembers: [
        {
          workspaceId: "workspace_123",
          userId: "user_123",
          role: "editor",
          status: "active",
          acceptedAt: 1,
          revokedAt: null,
          deletedAt: null,
        },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      role: "editor",
      source: "direct",
    });
  });

  it("grants an organization admin baseline capped to workspace admin", () => {
    const result = resolveEffectiveWorkspaceRole({
      ...baseSnapshot,
      organizationMembers: [
        {
          organizationId: "org_123",
          userId: "user_123",
          role: "owner",
          status: "active",
          acceptedAt: 1,
          revokedAt: null,
        },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      role: "admin",
      source: "organization",
    });
  });

  it("resolves active guest grants", () => {
    const result = resolveEffectiveWorkspaceRole({
      ...baseSnapshot,
      guestGrants: [
        {
          workspaceId: "workspace_123",
          userId: "user_123",
          role: "viewer",
          expiresAt: 200,
          revokedAt: null,
        },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      role: "viewer",
      source: "guest",
    });
  });

  it("uses precedence tie-breaks for equal roles", () => {
    const candidates = resolveRoleCandidates({
      ...baseSnapshot,
      workspaceMembers: [
        {
          workspaceId: "workspace_123",
          userId: "user_123",
          role: "admin",
          status: "active",
          acceptedAt: 1,
          revokedAt: null,
          deletedAt: null,
        },
      ],
      organizationMembers: [
        {
          organizationId: "org_123",
          userId: "user_123",
          role: "admin",
          status: "active",
          acceptedAt: 1,
          revokedAt: null,
        },
      ],
    });

    expect(highestCandidate(candidates)).toMatchObject({
      role: "admin",
      source: "direct",
    });
  });

  it("ignores expired and revoked guest grants", () => {
    const result = resolveEffectiveWorkspaceRole({
      ...baseSnapshot,
      guestGrants: [
        {
          workspaceId: "workspace_123",
          userId: "user_123",
          role: "admin",
          expiresAt: 99,
          revokedAt: null,
        },
        {
          workspaceId: "workspace_123",
          userId: "user_123",
          role: "editor",
          expiresAt: 200,
          revokedAt: 50,
        },
      ],
    });

    expect(result).toEqual({
      ok: false,
      reason: "NO_WORKSPACE_ACCESS",
    });
  });

  it("does not grant organization baseline for suspended orgs or archived workspaces", () => {
    expect(
      resolveEffectiveWorkspaceRole({
        ...baseSnapshot,
        organization: { id: "org_123", status: "suspended" },
        organizationMembers: [
          {
            organizationId: "org_123",
            userId: "user_123",
            role: "admin",
            status: "active",
            acceptedAt: 1,
            revokedAt: null,
          },
        ],
      }),
    ).toEqual({ ok: false, reason: "ORGANIZATION_INACTIVE" });

    expect(
      resolveEffectiveWorkspaceRole({
        ...baseSnapshot,
        workspace: {
          id: "workspace_123",
          organizationId: "org_123",
          status: "archived",
        },
      }),
    ).toEqual({ ok: false, reason: "WORKSPACE_ARCHIVED" });
  });

  it("throws on duplicate live membership row corruption", () => {
    expect(() =>
      resolveRoleCandidates({
        ...baseSnapshot,
        workspaceMembers: [
          {
            workspaceId: "workspace_123",
            userId: "user_123",
            role: "viewer",
            status: "active",
            acceptedAt: 1,
            revokedAt: null,
            deletedAt: null,
          },
          {
            workspaceId: "workspace_123",
            userId: "user_123",
            role: "editor",
            status: "active",
            acceptedAt: 2,
            revokedAt: null,
            deletedAt: null,
          },
        ],
      }),
    ).toThrow(/Duplicate live workspace membership/);
  });

  it("does not trust caller supplied workspace roles", () => {
    const untrustedPayload = {
      ...baseSnapshot,
      claimedWorkspaceRole: "owner",
    };
    const result = resolveEffectiveWorkspaceRole(untrustedPayload);

    expect(result).toEqual({
      ok: false,
      reason: "NO_WORKSPACE_ACCESS",
    });
  });
});

describe("workspace and organization access guards", () => {
  it("requires workspace and organization membership", () => {
    expect(
      requireWorkspaceMember(
        {
          ok: true,
          role: "editor",
          source: "direct",
          reason: "direct workspace membership",
        },
        "viewer",
      ),
    ).toMatchObject({ role: "editor" });
    expect(() =>
      requireWorkspaceMember(
        { ok: false, reason: "NO_WORKSPACE_ACCESS" },
        "viewer",
      ),
    ).toThrow(/NO_WORKSPACE_ACCESS/);
    expect(() =>
      requireWorkspaceMember(
        {
          ok: true,
          role: "viewer",
          source: "direct",
          reason: "direct workspace membership",
        },
        "admin",
      ),
    ).toThrow(/NO_WORKSPACE_ACCESS/);

    expect(
      requireOrganizationMember(
        {
          organizationId: "org_123",
          userId: "user_123",
          role: "admin",
          status: "active",
          acceptedAt: 1,
          revokedAt: null,
        },
        "editor",
      ),
    ).toMatchObject({ role: "admin" });
  });

  it("asserts workspace ownership side before resolving access", () => {
    expect(() =>
      assertOwningSide(activeWorkspace, activeOrganization),
    ).not.toThrow();
    expect(() =>
      assertOwningSide(
        { id: "workspace_123", organizationId: "org_other", status: "active" },
        activeOrganization,
      ),
    ).toThrow(/Workspace does not belong to organization/);
  });
});
