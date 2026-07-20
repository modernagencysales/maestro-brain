import {
  deriveStableAgencyKey,
  deriveStableBrainKey,
  isStableAgencyKey,
  isStableBrainKey,
  stableAgencyKeySeed,
  stableBrainKeySeed,
} from "../../identity/stableKeys";
import { componentMigrations } from "../migrationRuntime";

export const migrationImplementationTask = "S01-T02" as const;
export const executableMigrationNames = [
  "stableTenant.organizationKeys.expand",
  "stableTenant.workspaceKeys.expand",
] as const;

export const stableTenantOrganizationKeysExpand = componentMigrations.define({
  table: "organizations",
  batchSize: 1,
  migrateOne: async (ctx, row) => {
    if (row.workosOrganizationId !== undefined) {
      const sameWorkos = (await ctx.db.query("organizations").collect()).filter(
        (candidate) =>
          candidate.workosOrganizationId === row.workosOrganizationId,
      );
      if (sameWorkos.some((candidate) => candidate._id !== row._id)) {
        throw new Error("duplicate WorkOS organization binding");
      }
    }
    if (row.agencyKey !== undefined && !isStableAgencyKey(row.agencyKey)) {
      throw new Error("invalid agency key syntax");
    }
    const derivedAgencyKey =
      row.agencyKey ?? deriveStableAgencyKey(stableAgencyKeySeed(row));
    const sameAgencyKey = (
      await ctx.db.query("organizations").collect()
    ).filter((candidate) => candidate.agencyKey === derivedAgencyKey);
    if (sameAgencyKey.some((candidate) => candidate._id !== row._id)) {
      throw new Error("duplicate agency key binding");
    }
    const patch = {
      ...(row.agencyKey === undefined ? { agencyKey: derivedAgencyKey } : {}),
      ...(row.lifecycleGeneration === undefined
        ? { lifecycleGeneration: 0 }
        : {}),
      ...(row.revocationGeneration === undefined
        ? { revocationGeneration: 0 }
        : {}),
    };
    if (Object.keys(patch).length === 0) return;
    await ctx.db.patch(row._id, patch);
  },
});

export const stableTenantWorkspaceKeysExpand = componentMigrations.define({
  table: "workspaces",
  batchSize: 1,
  migrateOne: async (ctx, row) => {
    if (row.brainKey !== undefined && !isStableBrainKey(row.brainKey)) {
      throw new Error("invalid Brain key syntax");
    }
    const derivedBrainKey =
      row.brainKey ?? deriveStableBrainKey(stableBrainKeySeed(row));
    const sameBrainKey = (await ctx.db.query("workspaces").collect()).filter(
      (candidate) =>
        candidate.organizationId === row.organizationId &&
        candidate.brainKey === derivedBrainKey,
    );
    if (sameBrainKey.some((candidate) => candidate._id !== row._id)) {
      throw new Error("duplicate organization Brain key binding");
    }
    const patch = {
      ...(row.brainKey === undefined ? { brainKey: derivedBrainKey } : {}),
      ...(row.kind === undefined ? { kind: "agency" as const } : {}),
      ...(row.lifecycleGeneration === undefined
        ? { lifecycleGeneration: 0 }
        : {}),
      ...(row.revocationGeneration === undefined
        ? { revocationGeneration: 0 }
        : {}),
    };
    if (Object.keys(patch).length === 0) return;
    await ctx.db.patch(row._id, patch);
  },
});
