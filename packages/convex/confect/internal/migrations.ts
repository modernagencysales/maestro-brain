import { Migrations } from "@convex-dev/migrations";

import { components } from "../../convex/_generated/api";
import { internalMutation } from "../../convex/_generated/server";

export const migrationComponent = new Migrations(components.migrations, {
  internalMutation,
  defaultBatchSize: 25,
});

// S00-T04 exposes execution through internal Confect specs/impls only. This
// reserved component function proves the installed Convex migration component is
// wired beside the Confect boundary without publishing a runner that accepts raw
// functions, reset, next, caller cursors, or unbounded batch sizes.
export const reservedComponentHarness = migrationComponent.define({
  table: "workspaces",
  batchSize: 25,
  migrateOne: () => undefined,
});
