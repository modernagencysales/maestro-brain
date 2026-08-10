import { ConflictException, NotFoundException } from "@workos-inc/node";
import { describe, expect, it, vi } from "vitest";

import {
  createWorkosAgencyDependencies,
  type WorkosAgencyClient,
} from "./workos-agency-adapter";

const organization = {
  id: "org_new",
  externalId: "maestro-brain-founder:user_123",
};

const createClient = (): WorkosAgencyClient => ({
  organizations: {
    getOrganizationByExternalId: vi.fn(async () => organization),
    createOrganization: vi.fn(async () => organization),
  },
  userManagement: {
    listOrganizationMemberships: vi.fn(async () => ({
      data: [{ organizationId: organization.id }],
    })),
    createOrganizationMembership: vi.fn(async () => undefined),
  },
});

const createNotFound = () =>
  new NotFoundException({
    message: "not found",
    path: "/organizations/external-id",
    requestID: "request_123",
  });

const createConflict = () =>
  new ConflictException({
    message: "duplicate",
    requestID: "request_123",
  });

describe("WorkOS agency adapter", () => {
  it("maps active memberships without requesting or assigning a role", async () => {
    const client = createClient();
    const dependencies = createWorkosAgencyDependencies({
      apiKey: "sk_test_example",
      client,
      switchToOrganization: vi.fn(),
    });

    await expect(
      dependencies.listActiveMemberships("user_123"),
    ).resolves.toEqual([{ organizationId: "org_new" }]);
    expect(
      client.userManagement.listOrganizationMemberships,
    ).toHaveBeenCalledWith({
      userId: "user_123",
      statuses: ["active"],
      limit: 100,
    });

    await dependencies.createMembership({
      organizationId: "org_new",
      userId: "user_123",
    });
    expect(
      client.userManagement.createOrganizationMembership,
    ).toHaveBeenCalledWith({
      organizationId: "org_new",
      userId: "user_123",
    });
  });

  it("maps organization lookup not-found without swallowing other failures", async () => {
    const client = createClient();
    vi.mocked(client.organizations.getOrganizationByExternalId)
      .mockRejectedValueOnce(createNotFound())
      .mockRejectedValueOnce(new Error("provider unavailable"));
    const dependencies = createWorkosAgencyDependencies({
      apiKey: "sk_test_example",
      client,
      switchToOrganization: vi.fn(),
    });

    await expect(
      dependencies.getOrganizationByExternalId(organization.externalId),
    ).resolves.toBeNull();
    await expect(
      dependencies.getOrganizationByExternalId(organization.externalId),
    ).rejects.toThrow("provider unavailable");
  });

  it("uses native idempotency and recovers a duplicate organization by external ID", async () => {
    const client = createClient();
    vi.mocked(client.organizations.createOrganization).mockRejectedValueOnce(
      createConflict(),
    );
    const dependencies = createWorkosAgencyDependencies({
      apiKey: "sk_test_example",
      client,
      switchToOrganization: vi.fn(),
    });

    await expect(
      dependencies.createOrganization({
        name: "Tim Keen Agency",
        externalId: organization.externalId,
        idempotencyKey: "maestro-brain-founder:v1:user_123",
      }),
    ).resolves.toEqual(organization);
    expect(client.organizations.createOrganization).toHaveBeenCalledWith(
      {
        name: "Tim Keen Agency",
        externalId: organization.externalId,
      },
      { idempotencyKey: "maestro-brain-founder:v1:user_123" },
    );
    expect(
      client.organizations.getOrganizationByExternalId,
    ).toHaveBeenCalledWith(organization.externalId);
  });

  it("recovers a duplicate membership only after verifying the active membership", async () => {
    const client = createClient();
    vi.mocked(
      client.userManagement.createOrganizationMembership,
    ).mockRejectedValueOnce(createConflict());
    const dependencies = createWorkosAgencyDependencies({
      apiKey: "sk_test_example",
      client,
      switchToOrganization: vi.fn(),
    });

    await expect(
      dependencies.createMembership({
        organizationId: organization.id,
        userId: "user_123",
      }),
    ).resolves.toBeUndefined();
    expect(
      client.userManagement.listOrganizationMemberships,
    ).toHaveBeenCalledWith({
      userId: "user_123",
      statuses: ["active"],
      limit: 100,
    });
  });

  it("rejects duplicate-membership recovery when any unrelated membership exists", async () => {
    const client = createClient();
    vi.mocked(
      client.userManagement.createOrganizationMembership,
    ).mockRejectedValueOnce(createConflict());
    vi.mocked(
      client.userManagement.listOrganizationMemberships,
    ).mockResolvedValueOnce({
      data: [
        { organizationId: organization.id },
        { organizationId: "org_unrelated" },
      ],
    });
    const dependencies = createWorkosAgencyDependencies({
      apiKey: "sk_test_example",
      client,
      switchToOrganization: vi.fn(),
    });

    await expect(
      dependencies.createMembership({
        organizationId: organization.id,
        userId: "user_123",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("delegates the organization switch with a safe Brain return path", async () => {
    const client = createClient();
    const switchToOrganization = vi.fn(async () => ({
      organizationId: organization.id,
      accessToken: "token_new",
    }));
    const dependencies = createWorkosAgencyDependencies({
      apiKey: "sk_test_example",
      client,
      switchToOrganization,
    });

    await expect(
      dependencies.switchOrganization(organization.id),
    ).resolves.toEqual({
      organizationId: organization.id,
      accessToken: "token_new",
    });
    expect(switchToOrganization).toHaveBeenCalledWith({
      data: { organizationId: organization.id, returnTo: "/brain" },
    });
  });
});
