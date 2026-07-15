import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  type MigrationReceiptForResume,
  type MigrationReceiptInsert,
  type MigrationStore,
  type WorkspaceForMigration,
  runMigrationBatch,
} from "../confect/internal/migrations.impl";
import migrations, {
  AllowedMigrationName,
  MigrationBatchReceipt,
  MigrationBatchRunArgs,
  migrationDefinitions,
} from "../confect/internal/migrations.spec";
import migrationReceipts, {
  MigrationReceiptRow,
} from "../confect/tables/migrationReceipts";

const runArgs = (overrides: Partial<Schema.Schema.Type<typeof MigrationBatchRunArgs>> = {}) => ({
  migrationName: "reserveStableKeys" as const,
  mode: "execute" as const,
  releaseCommit: "release_a",
  schemaBefore: "schema_a",
  schemaAfter: "schema_b",
  actor: { kind: "system" as const, key: "migration-harness-test" },
  deploymentId: "deploy_a",
  buildId: "build_a",
  ...overrides,
});

const makeStore = (input: {
  workspaces?: ReadonlyArray<WorkspaceForMigration>;
  latest?: MigrationReceiptForResume | null;
}) => {
  const state = {
    workspaces: [...(input.workspaces ?? [])],
    latest: input.latest ?? null,
    receipts: [] as Array<MigrationReceiptInsert>,
  };
  const store: MigrationStore = {
    collectWorkspaces: Effect.sync(() => state.workspaces),
    latestReceipt: () => Effect.sync(() => state.latest),
    patchWorkspaceSlug: (workspace, slug) =>
      Effect.sync(() => {
        const row = state.workspaces.find((candidate) => candidate._id === workspace._id);
        if (row === undefined) throw new Error("workspace not found");
        Object.assign(row, { slug, updatedAt: row.updatedAt + 1 });
      }),
    appendReceipt: (receipt) =>
      Effect.sync(() => {
        state.receipts.push(receipt);
        state.latest = receipt;
      }),
  };
  return { store, state };
};

describe("internal migration harness", () => {
  it("declares append-only receipt indexes and typed batch contracts", () => {
    expect(migrationReceipts.indexes).toMatchObject({
      by_migration_started: ["migrationName", "startedAt"],
      by_release_schema: ["releaseCommit", "schemaBefore", "schemaAfter"],
      by_run: ["runId"],
      by_state: ["state"],
    });

    expect(Schema.decodeUnknownSync(AllowedMigrationName)("reserveStableKeys")).toBe(
      "reserveStableKeys",
    );
    expect(() => Schema.decodeUnknownSync(AllowedMigrationName)("unknownMigration")).toThrow();
    expect(() => Schema.decodeUnknownSync(MigrationBatchRunArgs)(runArgs({ batchSize: 0 }))).toThrow();

    const decoded = Schema.decodeUnknownSync(MigrationBatchReceipt)({
      migrationName: "reserveStableKeys",
      mode: "dryRun",
      cursor: null,
      scanned: 0,
      changed: 0,
      skipped: 0,
      failed: 0,
      complete: true,
      startedAt: 1,
      finishedAt: 2,
    });
    expect(decoded.complete).toBe(true);
    expect(
      Schema.decodeUnknownSync(MigrationReceiptRow)({
        runId: "run_1",
        migrationName: "reserveStableKeys",
        mode: "execute",
        state: "complete",
        phase: "expand",
        cursor: null,
        batchSize: 25,
        scanned: 0,
        changed: 0,
        skipped: 0,
        failed: 0,
        complete: true,
        releaseCommit: "release_a",
        schemaBefore: "schema_a",
        schemaAfter: "schema_b",
        parityChecks: [],
        rollbackOwner: "platform",
        observationEndsAt: 2,
        actorKind: "system",
        actorKey: "migration-harness-test",
        deploymentId: "deploy_a",
        buildId: "build_a",
        startedAt: 1,
        finishedAt: 2,
        childReceiptHashes: [],
      }),
    ).toMatchObject({ migrationName: "reserveStableKeys" });
  });

  it("keeps migration definitions non-destructive and bounded", () => {
    expect(migrationDefinitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "reserveStableKeys",
          phase: "expand",
          destructive: false,
          batchCap: 25,
        }),
      ]),
    );
    expect(
      migrationDefinitions.every(
        (definition) =>
          definition.destructive === false &&
          definition.batchCap > 0 &&
          definition.batchCap <= 25 &&
          !["delete", "drop", "reset"].some((word) =>
            definition.name.toLowerCase().includes(word),
          ),
      ),
    ).toBe(true);
  });

  it("registers only internal Confect functions with no headless/public surface", () => {
    expect(JSON.stringify(migrations)).toContain("runBatchInternal");
    expect(JSON.stringify(migrations)).toContain("listReceiptsInternal");
    expect(JSON.stringify(migrations)).not.toContain("public");
    expect(JSON.stringify(migrations)).not.toContain("mcp");
    expect(JSON.stringify(migrations)).not.toContain("api");
  });

  it("runs dry-run batches without writing rows or receipts", async () => {
    const { store, state } = makeStore({
      workspaces: [{ _id: "workspace_1", slug: "needs-key", updatedAt: 1 }],
    });

    const result = await Effect.runPromise(
      runMigrationBatch(store, runArgs({ mode: "dryRun" })),
    );

    expect(result).toMatchObject({
      mode: "dryRun",
      complete: true,
      scanned: 1,
      changed: 1,
      skipped: 0,
    });
    expect(state.workspaces[0]?.slug).toBe("needs-key");
    expect(state.receipts).toHaveLength(0);
  });

  it("runs bounded execute batches and skips already migrated rows", async () => {
    const { store, state } = makeStore({
      workspaces: [
        { _id: "workspace_1", slug: "needs-key", updatedAt: 1 },
        { _id: "workspace_2", slug: "stable-existing", updatedAt: 1 },
      ],
    });

    const first = await Effect.runPromise(runMigrationBatch(store, runArgs({ batchSize: 1 })));
    const second = await Effect.runPromise(runMigrationBatch(store, runArgs({ batchSize: 25 })));

    expect(first).toMatchObject({ scanned: 1, changed: 1, skipped: 0, complete: false });
    expect(first.cursor).toBe("workspaces:1");
    expect(second).toMatchObject({ scanned: 2, changed: 0, skipped: 2, complete: true });
    expect(state.workspaces.map((workspace) => workspace.slug)).toEqual([
      "stable-needs-key",
      "stable-existing",
    ]);
    expect(state.receipts).toHaveLength(2);
  });

  it("resumes from a failed committed cursor", async () => {
    const { store, state } = makeStore({
      latest: {
        migrationName: "reserveStableKeys",
        state: "failed",
        cursor: "workspaces:1",
        releaseCommit: "release_a",
        schemaBefore: "schema_a",
        schemaAfter: "schema_b",
        startedAt: 1,
      },
      workspaces: [
        { _id: "workspace_1", slug: "stable-done", updatedAt: 1 },
        { _id: "workspace_2", slug: "needs-resume", updatedAt: 1 },
      ],
    });

    const resumed = await Effect.runPromise(runMigrationBatch(store, runArgs()));

    expect(resumed).toMatchObject({ scanned: 1, changed: 1, skipped: 0, complete: true });
    expect(resumed.cursor).toBe("workspaces:1");
    expect(state.workspaces[1]?.slug).toBe("stable-needs-resume");
  });

  it("rejects unsafe starts and forged/cross-release cursors", async () => {
    const running = makeStore({
      latest: {
        migrationName: "reserveStableKeys",
        state: "running",
        cursor: null,
        releaseCommit: "release_a",
        schemaBefore: "schema_a",
        schemaAfter: "schema_b",
        startedAt: 1,
      },
    });
    await expect(Effect.runPromise(runMigrationBatch(running.store, runArgs()))).rejects.toHaveProperty(
      "name",
      expect.stringContaining("MigrationAlreadyRunning"),
    );

    const crossRelease = makeStore({
      latest: {
        migrationName: "reserveStableKeys",
        state: "failed",
        cursor: "workspaces:1",
        releaseCommit: "release_old",
        schemaBefore: "schema_a",
        schemaAfter: "schema_b",
        startedAt: 1,
      },
    });
    await expect(
      Effect.runPromise(runMigrationBatch(crossRelease.store, runArgs())),
    ).rejects.toHaveProperty("name", expect.stringContaining("MigrationCursorInvalid"));

    const forgedCursor = makeStore({
      latest: {
        migrationName: "reserveStableKeys",
        state: "failed",
        cursor: "caller-forged-cursor",
        releaseCommit: "release_a",
        schemaBefore: "schema_a",
        schemaAfter: "schema_b",
        startedAt: 1,
      },
    });
    await expect(
      Effect.runPromise(runMigrationBatch(forgedCursor.store, runArgs())),
    ).rejects.toHaveProperty("name", expect.stringContaining("MigrationCursorInvalid"));
  });
});
