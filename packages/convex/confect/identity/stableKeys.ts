import * as Schema from "effect/Schema";

import { sha256Hex } from "../shared/sha256";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const STABLE_KEY_BODY = "[0-9A-HJKMNP-TV-Z]{26}";
const AGENCY_KEY = new RegExp(`^ag_${STABLE_KEY_BODY}$`);
const BRAIN_KEY = new RegExp(`^br_${STABLE_KEY_BODY}$`);

export class StableKeyConflict extends Schema.TaggedError<StableKeyConflict>()(
  "StableKeyConflict",
  {
    resource: Schema.String,
    key: Schema.String,
  },
) {}

export type TenantLifecycleStatus =
  "provisioning" | "active" | "suspended" | "deleting" | "deleted";
export type BrainKind = "agency" | "client";
export type BrainLifecycleStatus =
  "provisioning" | "active" | "archived" | "deleting" | "deleted";

export type OrganizationKeyRow = {
  readonly _id: string;
  readonly _creationTime?: number | undefined;
  readonly createdAt?: number | undefined;
  readonly ownerUserId?: string | undefined;
  readonly workosOrganizationId?: string | undefined;
  readonly agencyKey?: string | undefined;
  readonly lifecycleGeneration?: number | undefined;
  readonly revocationGeneration?: number | undefined;
};

export type BrainKeyRow = {
  readonly _id: string;
  readonly _creationTime?: number | undefined;
  readonly createdAt?: number | undefined;
  readonly organizationId: string;
  readonly ownerUserId?: string | undefined;
  readonly brainKey?: string | undefined;
  readonly kind?: BrainKind | undefined;
  readonly lifecycleGeneration?: number | undefined;
  readonly revocationGeneration?: number | undefined;
};

type StableKeySource = {
  readonly _id: string;
  readonly createdAt: number;
  readonly _creationTime?: number | undefined;
};

const encodeCrockford = (value: bigint, length: number): string => {
  let remaining = value;
  let body = "";
  for (let index = 0; index < length; index += 1) {
    body = CROCKFORD[Number(remaining & 31n)] + body;
    remaining >>= 5n;
  }
  return body;
};

const stableSortTimeMicros = (source: StableKeySource): bigint =>
  BigInt(
    Math.max(0, Math.round((source._creationTime ?? source.createdAt) * 1000)),
  );

const stableKey = (prefix: "ag" | "br", source: StableKeySource): string => {
  const timePrefix = encodeCrockford(stableSortTimeMicros(source), 11);
  const hex = sha256Hex(`${prefix}:${source._id}`);
  const entropy = BigInt(`0x${hex.slice(0, 20)}`);
  const uniqueSuffix = encodeCrockford(entropy % (1n << 75n), 15);
  return `${prefix}_${timePrefix}${uniqueSuffix}`;
};

export const deriveStableAgencyKey = (source: StableKeySource): string =>
  stableKey("ag", source);

export const deriveStableBrainKey = (source: StableKeySource): string =>
  stableKey("br", source);

export const isStableAgencyKey = (value: string): boolean =>
  AGENCY_KEY.test(value);

export const isStableBrainKey = (value: string): boolean =>
  BRAIN_KEY.test(value);

const requirePersistedCreatedAt = (
  row: { readonly _id: string; readonly createdAt?: number | undefined },
  field: string,
): number => {
  if (typeof row.createdAt !== "number" || !Number.isFinite(row.createdAt)) {
    throw new Error(`${field} stable key seed requires persisted createdAt.`);
  }
  return row.createdAt;
};

export const stableAgencyKeySeed = (row: {
  readonly _id: string;
  readonly createdAt?: number | undefined;
  readonly _creationTime?: number | undefined;
}): StableKeySource => ({
  _id: row._id,
  createdAt: requirePersistedCreatedAt(row, "agency"),
  ...(row._creationTime === undefined
    ? {}
    : { _creationTime: row._creationTime }),
});

export const stableBrainKeySeed = (row: {
  readonly _id: string;
  readonly createdAt?: number | undefined;
  readonly _creationTime?: number | undefined;
}): StableKeySource => ({
  _id: row._id,
  createdAt: requirePersistedCreatedAt(row, "brain"),
  ...(row._creationTime === undefined
    ? {}
    : { _creationTime: row._creationTime }),
});

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
