import { Migrations } from "@convex-dev/migrations";

import schema from "../../convex/schema";
import { components } from "../../convex/_generated/api";

export const componentMigrations = new Migrations(components.migrations, {
  schema,
});

export const probeExpand = componentMigrations.define({
  table: "migrationRuns",
  batchSize: 2,
  migrateOne: async () => undefined,
});

export const probeFail = componentMigrations.define({
  table: "migrationRuns",
  batchSize: 2,
  migrateOne: async () => {
    throw new Error("injected production component failure");
  },
});
