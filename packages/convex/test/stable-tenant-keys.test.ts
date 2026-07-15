import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
import { describe, expect, it } from "vitest";

import {
  buildProvisioningPlan,
  extractIdentityProfile,
} from "../confect/access/provisioning";
import {
  deriveStableAgencyKey,
  deriveStableBrainKey,
  isStableAgencyKey,
  isStableBrainKey,
  stableTenantKeyBackfill,
  type BrainKeyRow,
  type OrganizationKeyRow,
} from "../confect/identity/stableKeys";

describe("stable tenant keys", () => {
  it("extracts and plans the server-derived WorkOS organization binding", () => {
    const identity = Effect.runSync(
      extractIdentityProfile({
        subject: "workos|user_12345678",
        name: "Ada Lovelace",
        email: "ada@example.com",
        emailVerified: true,
        organizationId: " org_workos_123 ",
      }),
    );

    const plan = Either.getOrThrow(
      buildProvisioningPlan({
        identity,
        state: {
          user: null,
          liveOrganization: null,
          liveWorkspace: null,
          organizationMembership: null,
          workspaceMembership: null,
        },
        now: 1_782_924_800_000,
      }),
    );

    expect(identity.workosOrganizationId).toBe("org_workos_123");
    expect(plan.organization).toMatchObject({
      action: "insert",
      value: {
        workosOrganizationId: "org_workos_123",
      },
    });
    expect(plan.workspace).toMatchObject({
      action: "insert",
      value: {},
    });
  });

  it("does not derive insert keys from literal placeholder identifiers", () => {
    const identity = Effect.runSync(
      extractIdentityProfile({
        subject: "workos|user_no_placeholders",
        name: "No Placeholders",
        email: "no-placeholders@example.com",
        emailVerified: true,
        organizationId: "org_workos_no_placeholders",
      }),
    );

    const plan = Either.getOrThrow(
      buildProvisioningPlan({
        identity,
        state: {
          user: null,
          liveOrganization: null,
          liveWorkspace: null,
          organizationMembership: null,
          workspaceMembership: null,
        },
        now: 1_782_924_800_000,
      }),
    );

    expect(plan.organization.action).toBe("insert");
    expect(plan.workspace.action).toBe("insert");
    if (plan.organization.action === "insert") {
      expect(plan.organization.value.agencyKey).toBeUndefined();
    }
    if (plan.workspace.action === "insert") {
      expect(plan.workspace.value.brainKey).toBeUndefined();
    }
  });

  it("plans migration-compatible patches for existing tenant rows", () => {
    const identity = Effect.runSync(
      extractIdentityProfile({
        subject: "workos|user_12345678",
        name: "Ada Lovelace",
        email: "ada@example.com",
        emailVerified: true,
        organizationId: "org_workos_123",
      }),
    );

    const plan = Either.getOrThrow(
      buildProvisioningPlan({
        identity,
        state: {
          user: {
            _id: "user_legacy",
            subject: identity.subject,
            email: identity.email,
            displayName: identity.displayName,
            status: "active",
            createdAt: 1,
            updatedAt: 1,
          },
          liveOrganization: {
            _id: "org_legacy",
            ownerUserId: "user_legacy",
            slug: "legacy",
            name: "Legacy",
            status: "active",
            createdAt: 1,
            updatedAt: 1,
          },
          liveWorkspace: {
            _id: "workspace_legacy",
            organizationId: "org_legacy",
            ownerUserId: "user_legacy",
            slug: "legacy",
            name: "Legacy",
            status: "active",
            dataClassification: "internal",
            createdAt: 1,
            updatedAt: 1,
          },
          organizationMembership: null,
          workspaceMembership: null,
        },
        now: 2,
      }),
    );

    expect(plan.organization).toEqual({
      action: "patch",
      id: "org_legacy",
      value: {
        workosOrganizationId: "org_workos_123",
        agencyKey: deriveStableAgencyKey({ _id: "org_legacy", createdAt: 1 }),
        lifecycleGeneration: 0,
        revocationGeneration: 0,
        updatedAt: 2,
      },
    });
    expect(plan.workspace).toEqual({
      action: "patch",
      id: "workspace_legacy",
      value: {
        brainKey: deriveStableBrainKey({
          _id: "workspace_legacy",
          createdAt: 1,
        }),
        kind: "agency",
        lifecycleGeneration: 0,
        revocationGeneration: 0,
        updatedAt: 2,
      },
    });
  });

  it("generates opaque sortable agency and Brain keys with strict syntax", () => {
    const agencyKey = deriveStableAgencyKey({
      _id: "organizations_abc123",
      createdAt: 1,
    });
    const brainKey = deriveStableBrainKey({
      _id: "workspaces_abc123",
      createdAt: 1,
    });

    expect(agencyKey).toMatch(/^ag_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(brainKey).toMatch(/^br_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(isStableAgencyKey(agencyKey)).toBe(true);
    expect(isStableBrainKey(brainKey)).toBe(true);
    expect(isStableAgencyKey("ag_acme-client")).toBe(false);
    expect(isStableBrainKey("workspaces_abc123")).toBe(false);
  });

  it("sorts keys by persisted creation time and keeps same-owner rows distinct", () => {
    const older = deriveStableAgencyKey({
      _id: "organizations_newer_id",
      createdAt: 100,
    });
    const newer = deriveStableAgencyKey({
      _id: "organizations_older_id",
      createdAt: 200,
    });
    const sameOwner = stableTenantKeyBackfill({
      organizations: [
        {
          _id: "org_one",
          ownerUserId: "user_same",
          createdAt: 100,
          _creationTime: 100.1,
        },
        {
          _id: "org_two",
          ownerUserId: "user_same",
          createdAt: 100,
          _creationTime: 100.2,
        },
      ] as OrganizationKeyRow[],
      workspaces: [
        {
          _id: "workspace_one",
          organizationId: "org_one",
          ownerUserId: "user_same",
          createdAt: 100,
          _creationTime: 100.1,
        },
        {
          _id: "workspace_two",
          organizationId: "org_one",
          ownerUserId: "user_same",
          createdAt: 100,
          _creationTime: 100.2,
        },
      ] as BrainKeyRow[],
    });

    expect(older < newer).toBe(true);
    const firstAgencyKey = sameOwner.organizations[0]?.agencyKey;
    const secondAgencyKey = sameOwner.organizations[1]?.agencyKey;
    const firstBrainKey = sameOwner.workspaces[0]?.brainKey;
    const secondBrainKey = sameOwner.workspaces[1]?.brainKey;
    expect(firstAgencyKey).not.toBe(secondAgencyKey);
    expect(firstBrainKey).not.toBe(secondBrainKey);
    expect(firstAgencyKey !== undefined && secondAgencyKey !== undefined).toBe(
      true,
    );
    expect(firstBrainKey !== undefined && secondBrainKey !== undefined).toBe(
      true,
    );
    expect(firstAgencyKey! < secondAgencyKey!).toBe(true);
    expect(firstBrainKey! < secondBrainKey!).toBe(true);
  });

  it("keeps realistic epoch microsecond prefixes lexically ordered", () => {
    const t2026 = Date.UTC(2026, 6, 15);
    const future = Date.UTC(2500, 0, 1);
    expect(
      deriveStableAgencyKey({
        _id: "org_2026_a",
        createdAt: t2026,
        _creationTime: t2026 + 0.1,
      }) <
        deriveStableAgencyKey({
          _id: "org_2026_b",
          createdAt: t2026,
          _creationTime: t2026 + 0.2,
        }),
    ).toBe(true);
    expect(
      deriveStableBrainKey({
        _id: "workspace_future_a",
        createdAt: future,
        _creationTime: future + 0.1,
      }) <
        deriveStableBrainKey({
          _id: "workspace_future_b",
          createdAt: future,
          _creationTime: future + 0.2,
        }),
    ).toBe(true);
  });

  it("requires persisted createdAt before deriving stable keys", () => {
    expect(() =>
      stableTenantKeyBackfill({
        organizations: [{ _id: "org_missing" } as OrganizationKeyRow],
        workspaces: [
          {
            _id: "workspace_missing",
            organizationId: "org_missing",
          } as BrainKeyRow,
        ],
      }),
    ).toThrow(/requires persisted createdAt/);
  });

  it("backfills missing stable keys deterministically and idempotently", () => {
    const first = stableTenantKeyBackfill({
      organizations: [
        { _id: "org_legacy", ownerUserId: "user_legacy", createdAt: 1 },
      ] as OrganizationKeyRow[],
      workspaces: [
        {
          _id: "workspace_legacy",
          organizationId: "org_legacy",
          ownerUserId: "user_legacy",
          createdAt: 1,
        },
      ] as BrainKeyRow[],
    });
    const second = stableTenantKeyBackfill({
      organizations: first.organizations,
      workspaces: first.workspaces,
    });

    expect(second.organizations).toEqual(first.organizations);
    expect(second.workspaces).toEqual(first.workspaces);
    expect(first.changedOrganizations).toBe(1);
    expect(first.changedWorkspaces).toBe(1);
    expect(second.changedOrganizations).toBe(0);
    expect(second.changedWorkspaces).toBe(0);
    expect(first.organizations[0]?.agencyKey).toBe(
      deriveStableAgencyKey({ _id: "org_legacy", createdAt: 1 }),
    );
    expect(first.workspaces[0]?.brainKey).toBe(
      deriveStableBrainKey({ _id: "workspace_legacy", createdAt: 1 }),
    );
  });

  it("backfills missing tenant metadata on already-keyed rows", () => {
    const first = stableTenantKeyBackfill({
      organizations: [
        {
          _id: "org_keyed",
          ownerUserId: "user_keyed",
          agencyKey: "ag_01J0000000000000000000000C",
          createdAt: 1,
        },
      ] as OrganizationKeyRow[],
      workspaces: [
        {
          _id: "workspace_keyed",
          organizationId: "org_keyed",
          ownerUserId: "user_keyed",
          brainKey: "br_01J0000000000000000000000C",
          createdAt: 1,
        },
      ] as BrainKeyRow[],
    });
    const second = stableTenantKeyBackfill({
      organizations: first.organizations,
      workspaces: first.workspaces,
    });

    expect(first.changedOrganizations).toBe(1);
    expect(first.changedWorkspaces).toBe(1);
    expect(second.changedOrganizations).toBe(0);
    expect(second.changedWorkspaces).toBe(0);
    expect(first.organizations[0]).toMatchObject({
      agencyKey: "ag_01J0000000000000000000000C",
      lifecycleGeneration: 0,
      revocationGeneration: 0,
    });
    expect(first.workspaces[0]).toMatchObject({
      brainKey: "br_01J0000000000000000000000C",
      kind: "agency",
      lifecycleGeneration: 0,
      revocationGeneration: 0,
    });
    expect(second.organizations).toEqual(first.organizations);
    expect(second.workspaces).toEqual(first.workspaces);
  });
});
