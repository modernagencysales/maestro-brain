import * as Either from "effect/Either";
import { describe, expect, it } from "vitest";

import {
  deriveStableAgencyKey,
  deriveStableBrainKey,
  isStableAgencyKey,
  isStableBrainKey,
  redactPublicTenantIds,
  resolveAgencyByKey,
  resolveBrainByKey,
  stableTenantKeyBackfill,
  type BrainKeyRow,
  type OrganizationKeyRow,
} from "../confect/identity/stableKeys";

const raiseMissingOrganization = () => {
  throw new Error("expected organization fixture");
};

const organizations: readonly OrganizationKeyRow[] = [
  {
    _id: "org_a",
    workosOrganizationId: "org_workos_a",
    agencyKey: "ag_01J0000000000000000000000A",
  },
  {
    _id: "org_b",
    workosOrganizationId: "org_workos_b",
    agencyKey: "ag_01J0000000000000000000000B",
  },
];

const brains: readonly BrainKeyRow[] = [
  {
    _id: "workspace_a",
    organizationId: "org_a",
    brainKey: "br_01J0000000000000000000000A",
    kind: "agency",
  },
  {
    _id: "workspace_b",
    organizationId: "org_b",
    brainKey: "br_01J0000000000000000000000A",
    kind: "agency",
  },
];

describe("stable tenant keys", () => {
  it("generates opaque sortable agency and Brain keys with strict syntax", () => {
    const agencyKey = deriveStableAgencyKey("organizations_abc123");
    const brainKey = deriveStableBrainKey("workspaces_abc123");

    expect(agencyKey).toMatch(/^ag_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(brainKey).toMatch(/^br_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(isStableAgencyKey(agencyKey)).toBe(true);
    expect(isStableBrainKey(brainKey)).toBe(true);
    expect(isStableAgencyKey("ag_acme-client")).toBe(false);
    expect(isStableBrainKey("workspaces_abc123")).toBe(false);
  });

  it("resolves agencies by WorkOS org plus stable key and rejects duplicates", () => {
    expect(
      Either.getOrThrow(
        resolveAgencyByKey({
          organizations,
          workosOrganizationId: "org_workos_a",
          agencyKey: "ag_01J0000000000000000000000A",
        }),
      ),
    ).toEqual(organizations[0]);

    expect(
      resolveAgencyByKey({
        organizations,
        workosOrganizationId: "org_workos_b",
        agencyKey: "ag_01J0000000000000000000000A",
      })._tag,
    ).toBe("Left");

    expect(
      resolveAgencyByKey({
        organizations: [
          organizations[0] ?? raiseMissingOrganization(),
          {
            ...(organizations[0] ?? raiseMissingOrganization()),
            _id: "org_dup",
          },
        ],
        workosOrganizationId: "org_workos_a",
        agencyKey: "ag_01J0000000000000000000000A",
      })._tag,
    ).toBe("Left");
  });

  it("resolves Brain keys inside the server-derived organization only", () => {
    expect(
      Either.getOrThrow(
        resolveBrainByKey({
          workspaces: brains,
          organizationId: "org_a",
          brainKey: "br_01J0000000000000000000000A",
        }),
      ),
    ).toEqual(brains[0]);

    expect(
      resolveBrainByKey({
        workspaces: brains,
        organizationId: "org_missing",
        brainKey: "br_01J0000000000000000000000A",
      })._tag,
    ).toBe("Left");
  });

  it("backfills missing stable keys deterministically and idempotently", () => {
    const first = stableTenantKeyBackfill({
      organizations: [{ _id: "org_legacy" }] as OrganizationKeyRow[],
      workspaces: [
        { _id: "workspace_legacy", organizationId: "org_legacy" },
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
      deriveStableAgencyKey("org_legacy"),
    );
    expect(first.workspaces[0]?.brainKey).toBe(
      deriveStableBrainKey("workspace_legacy"),
    );
  });

  it("redacts Convex document identifiers from public tenant payloads", () => {
    expect(
      redactPublicTenantIds({
        agencyKey: "ag_01J0000000000000000000000A",
        brainKey: "br_01J0000000000000000000000A",
        workspaceId: "workspaces_internal",
        nested: { organizationId: "organizations_internal" },
      }),
    ).toEqual({
      agencyKey: "ag_01J0000000000000000000000A",
      brainKey: "br_01J0000000000000000000000A",
      nested: {},
    });
  });
});
