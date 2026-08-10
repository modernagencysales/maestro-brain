export type AgencySetupResult =
  | {
      readonly kind: "authenticated";
      readonly organizationId: string;
      readonly accessToken: string;
    }
  | {
      readonly kind: "setupFailure";
      readonly reason:
        "identity_unverified" | "existing_membership" | "provider_failure";
    };

export type AgencyOnboardingUser = {
  readonly id: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly name: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
};

export type AgencyOnboardingDependencies = {
  readonly listActiveMemberships: (
    userId: string,
  ) => Promise<readonly { organizationId: string }[]>;
  readonly getOrganizationByExternalId: (
    externalId: string,
  ) => Promise<{ id: string; externalId: string } | null>;
  readonly createOrganization: (input: {
    name: string;
    externalId: string;
    idempotencyKey: string;
  }) => Promise<{ id: string; externalId: string }>;
  readonly createMembership: (input: {
    organizationId: string;
    userId: string;
  }) => Promise<void>;
  readonly switchOrganization: (organizationId: string) => Promise<{
    organizationId?: string;
    accessToken?: string;
  }>;
};

export const agencyExternalId = (userId: string) =>
  `maestro-brain-founder:${userId}`;

export const agencyIdempotencyKey = (userId: string) =>
  `maestro-brain-founder:v1:${userId}`;

export const agencyName = (user: AgencyOnboardingUser) => {
  const display =
    user.name?.trim() ||
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
    user.email.split("@")[0] ||
    "New";
  return `${display} Agency`;
};

export const ensureAgencyForUser = async ({
  user,
  dependencies,
}: {
  readonly user: AgencyOnboardingUser;
  readonly dependencies: AgencyOnboardingDependencies;
}): Promise<AgencySetupResult> => {
  if (!user.emailVerified) {
    return { kind: "setupFailure", reason: "identity_unverified" };
  }

  try {
    const externalId = agencyExternalId(user.id);
    const [memberships, existingOrganization] = await Promise.all([
      dependencies.listActiveMemberships(user.id),
      dependencies.getOrganizationByExternalId(externalId),
    ]);

    if (
      existingOrganization !== null &&
      existingOrganization.externalId !== externalId
    ) {
      return { kind: "setupFailure", reason: "provider_failure" };
    }

    if (
      memberships.length > 0 &&
      (existingOrganization === null ||
        memberships.length !== 1 ||
        memberships[0]?.organizationId !== existingOrganization.id)
    ) {
      return { kind: "setupFailure", reason: "existing_membership" };
    }

    let organization = existingOrganization;
    if (organization === null) {
      organization = await dependencies.createOrganization({
        name: agencyName(user),
        externalId,
        idempotencyKey: agencyIdempotencyKey(user.id),
      });
      if (!organization.id || organization.externalId !== externalId) {
        return { kind: "setupFailure", reason: "provider_failure" };
      }
    }

    if (memberships.length === 0) {
      await dependencies.createMembership({
        organizationId: organization.id,
        userId: user.id,
      });
    }

    const switched = await dependencies.switchOrganization(organization.id);
    if (
      switched.organizationId !== organization.id ||
      !switched.accessToken?.trim()
    ) {
      return { kind: "setupFailure", reason: "provider_failure" };
    }

    return {
      kind: "authenticated",
      organizationId: organization.id,
      accessToken: switched.accessToken,
    };
  } catch {
    return { kind: "setupFailure", reason: "provider_failure" };
  }
};
