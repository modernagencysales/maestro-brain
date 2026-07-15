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
  readonly workosOrganizationId?: string | undefined;
  readonly agencyKey?: string | undefined;
};

export type BrainKeyRow = {
  readonly _id: string;
  readonly organizationId: string;
  readonly brainKey?: string | undefined;
  readonly kind?: BrainKind | undefined;
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

  const sameKey = input.workspaces.filter(
    (workspace) => workspace.brainKey === input.brainKey,
  );
  const sameTenant = sameKey.filter(
    (workspace) => workspace.organizationId === input.organizationId,
  );
  if (sameTenant.length > 1) {
    return Either.left(
      new StableKeyConflict({ resource: "workspaces", key: input.brainKey }),
    );
  }
  if (sameTenant[0] !== undefined) return Either.right(sameTenant[0]);
  return sameKey.length > 0
    ? Either.left(new TenantMismatch())
    : Either.left(new BrainNotFound());
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
    if (organization.agencyKey !== undefined) return organization;
    changedOrganizations += 1;
    return {
      ...organization,
      agencyKey: deriveStableAgencyKey(organization._id),
    };
  });
  const workspaces = input.workspaces.map((workspace) => {
    if (workspace.brainKey !== undefined) return workspace;
    changedWorkspaces += 1;
    return { ...workspace, brainKey: deriveStableBrainKey(workspace._id) };
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
