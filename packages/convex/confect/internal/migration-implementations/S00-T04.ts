import { componentMigrations } from "../migrationRuntime";

export const migrationImplementationTask = "S00-T04" as const;
export const executableMigrationNames = ["probe.expand", "probe.fail"] as const;

export const probeExpand = componentMigrations.define({
  table: "migrationRuns",
  batchSize: 2,
  migrateOne: async (ctx, row) => {
    if (row.migrationName !== "probe-target") return;
    if (row.actor === "inject-component-failure") {
      throw new Error("injected production component failure");
    }
    if (row.schemaAfter === "sha256:after") return;
    await ctx.db.patch(row._id, {
      schemaAfter: "sha256:after",
      probeWriteCount: (row.probeWriteCount ?? 0) + 1,
      ...(row.actor === "inject-post-component-crash"
        ? { actor: "write-count:1" }
        : {}),
    });
  },
});

export const probeFail = componentMigrations.define({
  table: "migrationRuns",
  batchSize: 2,
  migrateOne: async () => {
    throw new Error("unknown probe failure");
  },
});
