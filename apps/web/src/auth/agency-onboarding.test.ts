import { describe, expect, it } from "vitest";

import {
  agencyExternalId,
  agencyIdempotencyKey,
  agencyName,
  ensureAgencyForUser,
  type AgencyOnboardingDependencies,
} from "./agency-onboarding";

const user = {
  id: "user_123",
  email: "tim@example.com",
  emailVerified: true,
  name: "Tim Keen",
  firstName: "Tim",
  lastName: "Keen",
} as const;

type Calls = {
  listActiveMemberships: string[];
  getOrganizationByExternalId: string[];
  createOrganization: Array<{
    name: string;
    externalId: string;
    idempotencyKey: string;
  }>;
  createMembership: Array<{ organizationId: string; userId: string }>;
  switchOrganization: string[];
};

const createHarness = (
  overrides: Partial<AgencyOnboardingDependencies> = {},
) => {
  const calls: Calls = {
    listActiveMemberships: [],
    getOrganizationByExternalId: [],
    createOrganization: [],
    createMembership: [],
    switchOrganization: [],
  };

  const dependencies: AgencyOnboardingDependencies = {
    listActiveMemberships: async (userId) => {
      calls.listActiveMemberships.push(userId);
      return [];
    },
    getOrganizationByExternalId: async (externalId) => {
      calls.getOrganizationByExternalId.push(externalId);
      return null;
    },
    createOrganization: async (input) => {
      calls.createOrganization.push(input);
      return { id: "org_new", externalId: input.externalId };
    },
    createMembership: async (input) => {
      calls.createMembership.push(input);
    },
    switchOrganization: async (organizationId) => {
      calls.switchOrganization.push(organizationId);
      return { organizationId, accessToken: "token_new" };
    },
    ...overrides,
  };

  return { calls, dependencies };
};

describe("self-service agency onboarding", () => {
  it("creates and switches one agency for a verified zero-membership user", async () => {
    const { calls, dependencies } = createHarness();

    await expect(ensureAgencyForUser({ user, dependencies })).resolves.toEqual({
      kind: "authenticated",
      organizationId: "org_new",
      accessToken: "token_new",
    });
    expect(calls.createOrganization).toEqual([
      {
        name: "Tim Keen Agency",
        externalId: `maestro-brain-founder:${user.id}`,
        idempotencyKey: `maestro-brain-founder:v1:${user.id}`,
      },
    ]);
    expect(calls.createMembership).toEqual([
      { organizationId: "org_new", userId: user.id },
    ]);
    expect(calls.switchOrganization).toEqual(["org_new"]);
  });

  it("resumes only the founding user's deterministic organization", async () => {
    const externalId = agencyExternalId(user.id);
    const { calls, dependencies } = createHarness({
      getOrganizationByExternalId: async () => ({
        id: "org_owned",
        externalId,
      }),
      listActiveMemberships: async () => [{ organizationId: "org_owned" }],
    });

    await expect(ensureAgencyForUser({ user, dependencies })).resolves.toEqual({
      kind: "authenticated",
      organizationId: "org_owned",
      accessToken: "token_new",
    });
    expect(calls.createOrganization).toEqual([]);
    expect(calls.createMembership).toEqual([]);
  });

  it("refuses an unrelated active membership", async () => {
    const { calls, dependencies } = createHarness({
      listActiveMemberships: async () => [{ organizationId: "org_wrip" }],
    });

    await expect(ensureAgencyForUser({ user, dependencies })).resolves.toEqual({
      kind: "setupFailure",
      reason: "existing_membership",
    });
    expect(calls.createOrganization).toEqual([]);
    expect(calls.createMembership).toEqual([]);
    expect(calls.switchOrganization).toEqual([]);
  });

  it("rejects an unverified identity before calling a provider", async () => {
    const { calls, dependencies } = createHarness();

    await expect(
      ensureAgencyForUser({
        user: { ...user, emailVerified: false },
        dependencies,
      }),
    ).resolves.toEqual({
      kind: "setupFailure",
      reason: "identity_unverified",
    });
    expect(calls.listActiveMemberships).toEqual([]);
    expect(calls.getOrganizationByExternalId).toEqual([]);
    expect(calls.createOrganization).toEqual([]);
  });

  it("repairs an interrupted organization-before-membership setup", async () => {
    const externalId = agencyExternalId(user.id);
    const { calls, dependencies } = createHarness({
      getOrganizationByExternalId: async () => ({
        id: "org_owned",
        externalId,
      }),
    });

    await expect(ensureAgencyForUser({ user, dependencies })).resolves.toEqual({
      kind: "authenticated",
      organizationId: "org_owned",
      accessToken: "token_new",
    });
    expect(calls.createOrganization).toEqual([]);
    expect(calls.createMembership).toEqual([
      { organizationId: "org_owned", userId: user.id },
    ]);
    expect(calls.switchOrganization).toEqual(["org_owned"]);
  });

  it("maps provider exceptions to a safe setup failure", async () => {
    const { dependencies } = createHarness({
      listActiveMemberships: async () => {
        throw new Error("sensitive provider response");
      },
    });

    await expect(ensureAgencyForUser({ user, dependencies })).resolves.toEqual({
      kind: "setupFailure",
      reason: "provider_failure",
    });
  });

  it.each([
    { organizationId: "org_other", accessToken: "token_new" },
    { organizationId: "org_new" },
    { organizationId: "org_new", accessToken: "" },
  ])(
    "fails safely for an invalid organization switch result",
    async (result) => {
      const { dependencies } = createHarness({
        switchOrganization: async () => result,
      });

      await expect(
        ensureAgencyForUser({ user, dependencies }),
      ).resolves.toEqual({
        kind: "setupFailure",
        reason: "provider_failure",
      });
    },
  );

  it("derives stable provider identifiers and a non-empty agency name", () => {
    expect(agencyExternalId(user.id)).toBe(`maestro-brain-founder:${user.id}`);
    expect(agencyIdempotencyKey(user.id)).toBe(
      `maestro-brain-founder:v1:${user.id}`,
    );
    expect(
      agencyName({
        ...user,
        name: " ",
        firstName: null,
        lastName: null,
      }),
    ).toBe("tim Agency");
  });
});
