import { ConflictException, NotFoundException, WorkOS } from "@workos-inc/node";

import type { AgencyOnboardingDependencies } from "./agency-onboarding";
import { switchWorkosOrganization } from "./workos-server-adapter";

type WorkosOrganization = {
  readonly id: string;
  readonly externalId?: string | null;
};

type WorkosOrganizationMembership = {
  readonly organizationId: string;
};

export type WorkosAgencyClient = {
  readonly organizations: {
    readonly getOrganizationByExternalId: (
      externalId: string,
    ) => Promise<WorkosOrganization>;
    readonly createOrganization: (
      payload: { readonly name: string; readonly externalId: string },
      requestOptions: { readonly idempotencyKey: string },
    ) => Promise<WorkosOrganization>;
  };
  readonly userManagement: {
    readonly listOrganizationMemberships: (input: {
      readonly userId: string;
      readonly statuses: readonly ["active"];
      readonly limit: number;
    }) => Promise<{ readonly data: readonly WorkosOrganizationMembership[] }>;
    readonly createOrganizationMembership: (input: {
      readonly organizationId: string;
      readonly userId: string;
    }) => Promise<unknown>;
  };
};

type SwitchToOrganization = (input: {
  readonly data: {
    readonly organizationId: string;
    readonly returnTo: string;
  };
}) => Promise<{
  readonly organizationId?: string;
  readonly accessToken?: string;
}>;

const normalizeOrganization = (organization: WorkosOrganization) => ({
  id: organization.id,
  externalId: organization.externalId ?? "",
});

const activeMembershipInput = (userId: string) => ({
  userId,
  statuses: ["active"] as const,
  limit: 100,
});

export const createWorkosAgencyDependencies = (input: {
  readonly apiKey: string;
  readonly client?: WorkosAgencyClient;
  readonly switchToOrganization?: SwitchToOrganization;
}): AgencyOnboardingDependencies => {
  const client =
    input.client ?? (new WorkOS(input.apiKey) as unknown as WorkosAgencyClient);
  const switchToOrganization =
    input.switchToOrganization ?? switchWorkosOrganization;

  return {
    listActiveMemberships: async (userId) => {
      const memberships =
        await client.userManagement.listOrganizationMemberships(
          activeMembershipInput(userId),
        );
      return memberships.data.map(({ organizationId }) => ({ organizationId }));
    },
    getOrganizationByExternalId: async (externalId) => {
      try {
        return normalizeOrganization(
          await client.organizations.getOrganizationByExternalId(externalId),
        );
      } catch (error) {
        if (error instanceof NotFoundException) return null;
        throw error;
      }
    },
    createOrganization: async ({ name, externalId, idempotencyKey }) => {
      try {
        return normalizeOrganization(
          await client.organizations.createOrganization(
            { name, externalId },
            { idempotencyKey },
          ),
        );
      } catch (error) {
        if (!(error instanceof ConflictException)) throw error;
        return normalizeOrganization(
          await client.organizations.getOrganizationByExternalId(externalId),
        );
      }
    },
    createMembership: async ({ organizationId, userId }) => {
      try {
        await client.userManagement.createOrganizationMembership({
          organizationId,
          userId,
        });
      } catch (error) {
        if (!(error instanceof ConflictException)) throw error;
        const memberships =
          await client.userManagement.listOrganizationMemberships(
            activeMembershipInput(userId),
          );
        if (
          memberships.data.length !== 1 ||
          memberships.data[0]?.organizationId !== organizationId
        ) {
          throw error;
        }
      }
    },
    switchOrganization: async (organizationId) =>
      switchToOrganization({
        data: { organizationId, returnTo: "/brain" },
      }),
  };
};
