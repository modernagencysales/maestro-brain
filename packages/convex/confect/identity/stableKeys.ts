import * as Either from "effect/Either";
import * as Schema from "effect/Schema";

import { ValidationFailed } from "../errors";
import { sha256Hex } from "../shared/sha256";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const STABLE_KEY_BODY = "[0-9A-HJKMNP-TV-Z]{26}";
const AGENCY_KEY = new RegExp(`^ag_${STABLE_KEY_BODY}$`);
const BRAIN_KEY = new RegExp(`^br_${STABLE_KEY_BODY}$`);

export class AgencyNotFound extends Schema.TaggedError<AgencyNotFound>()(
  "AgencyNotFound",
  {},
) {}

export class BrainNotFound extends Schema.TaggedError<BrainNotFound>()(
  "BrainNotFound",
  {},
) {}

export class StableKeyConflict extends Schema.TaggedError<StableKeyConflict>()(
  "StableKeyConflict",
  {
    resource: Schema.String,
    key: Schema.String,
  },
) {}

export class TenantMismatch extends Schema.TaggedError<TenantMismatch>()(
  "TenantMismatch",
  {},
) {}

export type TenantLifecycleStatus =
  "provisioning" | "active" | "suspended" | "deleting" | "deleted";
export type BrainKind = "agency" | "client";
export type BrainLifecycleStatus =
  "provisioning" | "active" | "archived" | "deleting" | "deleted";

export type OrganizationKeyRow = {
  readonly _id: string;
  readonly ownerUserId?: string | undefined;
  readonly workosOrganizationId?: string | undefined;
  readonly agencyKey?: string | undefined;
  readonly lifecycleGeneration?: number | undefined;
  readonly revocationGeneration?: number | undefined;
};

export type BrainKeyRow = {
  readonly _id: string;
  readonly organizationId: string;
  readonly ownerUserId?: string | undefined;
  readonly brainKey?: string | undefined;
  readonly kind?: BrainKind | undefined;
  readonly lifecycleGeneration?: number | undefined;
  readonly revocationGeneration?: number | undefined;
};

export type StableTenantKeyError =
  | AgencyNotFound
  | BrainNotFound
  | StableKeyConflict
  | TenantMismatch
  | ValidationFailed;

const stableKey = (prefix: "ag" | "br", value: string): string => {
  const hex = sha256Hex(`${prefix}:${value}`);
  let bits = BigInt(`0x${hex.slice(0, 33)}`) >> 2n;
  let body = "";
  for (let index = 0; index < 26; index += 1) {
    body = CROCKFORD[Number(bits & 31n)] + body;
    bits >>= 5n;
  }
  return `${prefix}_${body}`;
};

export const deriveStableAgencyKey = (organizationId: string): string =>
  stableKey("ag", organizationId);

export const deriveStableBrainKey = (workspaceId: string): string =>
  stableKey("br", workspaceId);

export const isStableAgencyKey = (value: string): boolean =>
  AGENCY_KEY.test(value);

export const isStableBrainKey = (value: string): boolean =>
  BRAIN_KEY.test(value);

export const stableAgencyKeySeed = (row: {
  readonly _id: string;
  readonly ownerUserId?: string | undefined;
}): string => row.ownerUserId ?? row._id;

export const stableBrainKeySeed = (row: {
  readonly _id: string;
  readonly ownerUserId?: string | undefined;
}): string => row.ownerUserId ?? row._id;

export const validateStableAgencyKey = (value: string) =>
  isStableAgencyKey(value)
    ? Either.right(value)
    : Either.left(
        new ValidationFailed({
          field: "agencyKey",
          message: "Agency keys must be opaque ag_ stable tenant keys.",
        }),
      );

export const validateStableBrainKey = (value: string) =>
  isStableBrainKey(value)
    ? Either.right(value)
    : Either.left(
        new ValidationFailed({
          field: "brainKey",
          message: "Brain keys must be opaque br_ stable tenant keys.",
        }),
      );

export const resolveAgencyByKey = (input: {
  readonly organizations: readonly OrganizationKeyRow[];
  readonly workosOrganizationId: string;
  readonly agencyKey: string;
}): Either.Either<OrganizationKeyRow, StableTenantKeyError> => {
  const valid = validateStableAgencyKey(input.agencyKey);
  if (Either.isLeft(valid)) return Either.left(valid.left);

  const sameKey = input.organizations.filter(
    (organization) => organization.agencyKey === input.agencyKey,
  );
  if (sameKey.length > 1) {
    return Either.left(
      new StableKeyConflict({
        resource: "organizations",
        key: input.agencyKey,
      }),
    );
  }

  const organization = sameKey[0];
  if (organization === undefined) return Either.left(new AgencyNotFound());
  if (organization.workosOrganizationId !== input.workosOrganizationId) {
    return Either.left(new TenantMismatch());
  }
  return Either.right(organization);
};

export const resolveBrainByKey = (input: {
  readonly workspaces: readonly BrainKeyRow[];
  readonly organizationId: string;
  readonly brainKey: string;
}): Either.Either<BrainKeyRow, StableTenantKeyError> => {
  const valid = validateStableBrainKey(input.brainKey);
  if (Either.isLeft(valid)) return Either.left(valid.left);

  const sameTenant = input.workspaces.filter(
    (workspace) =>
      workspace.organizationId === input.organizationId &&
      workspace.brainKey === input.brainKey,
  );
  if (sameTenant.length > 1) {
    return Either.left(
      new StableKeyConflict({ resource: "workspaces", key: input.brainKey }),
    );
  }
  return sameTenant[0] !== undefined
    ? Either.right(sameTenant[0])
    : Either.left(new BrainNotFound());
};

export const assertUniqueStableTenantKeys = (input: {
  readonly organizations: readonly OrganizationKeyRow[];
  readonly workspaces: readonly BrainKeyRow[];
}): Either.Either<void, StableKeyConflict> => {
  const seenWorkos = new Set<string>();
  const seenAgency = new Set<string>();
  const seenBrain = new Set<string>();

  for (const organization of input.organizations) {
    if (organization.workosOrganizationId !== undefined) {
      if (seenWorkos.has(organization.workosOrganizationId)) {
        return Either.left(
          new StableKeyConflict({
            resource: "organizations.workosOrganizationId",
            key: organization.workosOrganizationId,
          }),
        );
      }
      seenWorkos.add(organization.workosOrganizationId);
    }
    if (organization.agencyKey !== undefined) {
      if (seenAgency.has(organization.agencyKey)) {
        return Either.left(
          new StableKeyConflict({
            resource: "organizations.agencyKey",
            key: organization.agencyKey,
          }),
        );
      }
      seenAgency.add(organization.agencyKey);
    }
  }

  for (const workspace of input.workspaces) {
    if (workspace.brainKey === undefined) continue;
    const scopedBrainKey = `${workspace.organizationId}:${workspace.brainKey}`;
    if (seenBrain.has(scopedBrainKey)) {
      return Either.left(
        new StableKeyConflict({
          resource: "workspaces.organizationId.brainKey",
          key: workspace.brainKey,
        }),
      );
    }
    seenBrain.add(scopedBrainKey);
  }

  return Either.right(undefined);
};

export const stableTenantKeyBackfill = <
  Organization extends OrganizationKeyRow,
  Workspace extends BrainKeyRow,
>(input: {
  readonly organizations: readonly Organization[];
  readonly workspaces: readonly Workspace[];
}) => {
  let changedOrganizations = 0;
  let changedWorkspaces = 0;
  const organizations = input.organizations.map((organization) => {
    const patch = {
      ...(organization.agencyKey === undefined
        ? {
            agencyKey: deriveStableAgencyKey(stableAgencyKeySeed(organization)),
          }
        : {}),
      ...(organization.lifecycleGeneration === undefined
        ? { lifecycleGeneration: 0 }
        : {}),
      ...(organization.revocationGeneration === undefined
        ? { revocationGeneration: 0 }
        : {}),
    };
    if (Object.keys(patch).length === 0) return organization;
    changedOrganizations += 1;
    return { ...organization, ...patch };
  });
  const workspaces = input.workspaces.map((workspace) => {
    const patch = {
      ...(workspace.brainKey === undefined
        ? { brainKey: deriveStableBrainKey(stableBrainKeySeed(workspace)) }
        : {}),
      ...(workspace.kind === undefined ? { kind: "agency" as const } : {}),
      ...(workspace.lifecycleGeneration === undefined
        ? { lifecycleGeneration: 0 }
        : {}),
      ...(workspace.revocationGeneration === undefined
        ? { revocationGeneration: 0 }
        : {}),
    };
    if (Object.keys(patch).length === 0) return workspace;
    changedWorkspaces += 1;
    return { ...workspace, ...patch };
  });
  return { organizations, workspaces, changedOrganizations, changedWorkspaces };
};

export const redactPublicTenantIds = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redactPublicTenantIds);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          key !== "_id" &&
          key !== "organizationId" &&
          key !== "workspaceId" &&
          key !== "ownerUserId",
      )
      .map(([key, nested]) => [key, redactPublicTenantIds(nested)]),
  );
};
