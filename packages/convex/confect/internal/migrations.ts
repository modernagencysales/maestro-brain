import { Migrations } from "@convex-dev/migrations";
import { makeFunctionReference } from "convex/server";

export const MIGRATION_BATCH_CAP = 25;

export const migrationsComponent = {
  lib: {
    migrate: makeFunctionReference("migrations:lib/migrate"),
    cancel: makeFunctionReference("migrations:lib/cancel"),
    cancelAll: makeFunctionReference("migrations:lib/cancelAll"),
    clearAll: makeFunctionReference("migrations:lib/clearAll"),
    getStatus: makeFunctionReference("migrations:lib/getStatus"),
  },
} as unknown as ConstructorParameters<typeof Migrations>[0];

export const componentMigrations = new Migrations(migrationsComponent, {
  defaultBatchSize: MIGRATION_BATCH_CAP,
  migrationsLocationPrefix: "internal/migrations:",
});

const noopReservedMigration = () => undefined;

export const reserveStableKeys = componentMigrations.define({
  table: "workspaces",
  batchSize: MIGRATION_BATCH_CAP,
  migrateOne: noopReservedMigration,
});
export const reserveBrainKeys = componentMigrations.define({
  table: "workspaces",
  batchSize: MIGRATION_BATCH_CAP,
  migrateOne: noopReservedMigration,
});
export const reservePageKeys = componentMigrations.define({
  table: "brainPages",
  batchSize: MIGRATION_BATCH_CAP,
  migrateOne: noopReservedMigration,
});

export const reservedMigrationRefs = {
  reserveStableKeys,
  reserveBrainKeys,
  reservePageKeys,
} as const;

export default componentMigrations;
