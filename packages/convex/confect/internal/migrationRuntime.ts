import { Migrations } from "@convex-dev/migrations";

import { components } from "../../convex/_generated/api";
import schema from "../../convex/schema";

export const componentMigrations = new Migrations(components.migrations, {
  schema,
});

export type MigrationRuntimeReceipt = Readonly<{
  taskId: string;
  schemaVersion: 1;
  generatedRegistryOwnedBy: "integration";
}>;

export const migrationRuntimeReceipt = (
  taskId: string,
): MigrationRuntimeReceipt => ({
  taskId,
  schemaVersion: 1,
  generatedRegistryOwnedBy: "integration",
});
