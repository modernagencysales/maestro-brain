import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vitest";

import {
  type MigrationReceiptForResume,
  type MigrationReceiptInsert,
  type MigrationRuntime,
  runComponentWithMutationRunner,
  runMigrationBatch,
} from "../confect/internal/migrations.impl";
import componentHarness, {
  MIGRATION_BATCH_CAP,
  componentMigrations,
  migrationsComponent,
  reserveBrainKeys,
  reservePageKeys,
  reserveStableKeys,
} from "../confect/internal/migrations";
import migrations, {
  AllowedMigrationName,
  MigrationBatchFailed,
  MigrationBatchRunArgs,
  migrationDefinitions,
} from "../confect/internal/migrations.spec";
import migrationReceipts from "../confect/tables/migrationReceipts";

const args = (
  overrides: Partial<Schema.Schema.Type<typeof MigrationBatchRunArgs>> = {},
) => ({
  migrationName: "reserveStableKeys" as const,
  mode: "execute" as const,
  releaseCommit: "release_a",
  schemaBefore: "schema_a",
  schemaAfter: "schema_b",
  actor: { kind: "system" as const, key: "migration-test" },
  deploymentId: "deploy_a",
  buildId: "build_a",
  ...overrides,
});

const makeRuntime = (
  input: {
    latest?: MigrationReceiptForResume | null;
    runOne?: ReturnType<typeof vi.fn>;
  } = {},
) => {
  const state = {
    latest: input.latest ?? null,
    receipts: [] as MigrationReceiptInsert[],
  };
  const runOne =
    input.runOne ??
    vi.fn(async () => ({ continueCursor: null, isDone: true, processed: 1 }));
  const runtime: MigrationRuntime = {
    runComponent: (name, options) =>
      Effect.tryPromise({
        try: () => runOne(name, options),
        catch: (error) =>
          new MigrationBatchFailed({
            migrationName: name,
            reason: String(error),
          }),
      }),
    receipts: {
      latestReceipt: () => Effect.sync(() => state.latest),
      childHashes: (releaseRunId) =>
        Effect.sync(() =>
          state.receipts
            .filter((row) => row.parentRunId === releaseRunId)
            .map((row) => row.receiptHash),
        ),
      appendReceipt: (receipt) =>
        Effect.sync(() => {
          state.receipts.push(receipt);
          state.latest = receipt;
        }),
    },
  };
  return { runtime, state, runOne };
};

describe("internal migration harness", () => {
  it("declares internal-only Confect contracts and real component-defined migrations", () => {
    expect(JSON.stringify(migrations)).toContain("runBatchInternal");
    expect(JSON.stringify(migrations)).toContain("listReceiptsInternal");
    expect(JSON.stringify(migrations)).not.toMatch(/public|mcp|api/i);
    expect(componentHarness).toBe(componentMigrations);
    expect(componentMigrations.component).toBe(migrationsComponent);
    expect(MIGRATION_BATCH_CAP).toBe(25);
    expect(reserveStableKeys).toBeTypeOf("function");
    expect(reserveBrainKeys).toBeTypeOf("function");
    expect(reservePageKeys).toBeTypeOf("function");
    expect(migrationReceipts.indexes).toMatchObject({
      by_parent: ["parentRunId"],
    });
  });

  it("validates safe input before dispatching component runOne", async () => {
    expect(
      Schema.decodeUnknownSync(AllowedMigrationName)("reserveStableKeys"),
    ).toBe("reserveStableKeys");
    expect(() =>
      Schema.decodeUnknownSync(AllowedMigrationName)("unknownMigration"),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(MigrationBatchRunArgs)(args({ batchSize: 0 })),
    ).toThrow();
    expect(
      Schema.decodeUnknownSync(MigrationBatchRunArgs)({
        ...args(),
        cursor: "forged",
      }),
    ).not.toHaveProperty("cursor");
    expect(
      migrationDefinitions.every(
        (definition) => !definition.destructive && definition.batchCap <= 25,
      ),
    ).toBe(true);
    const { runtime, runOne } = makeRuntime();
    await expect(
      Effect.runPromise(
        runMigrationBatch(runtime, {
          ...args(),
          migrationName: "unknownMigration",
        }),
      ),
    ).rejects.toHaveProperty(
      "name",
      expect.stringContaining("MigrationNotFound"),
    );
    expect(runOne).not.toHaveBeenCalled();
  });

  it("runs bounded component batches and appends deterministic parent plus child receipts", async () => {
    const { runtime, state, runOne } = makeRuntime({
      runOne: vi.fn(async () => ({
        continueCursor: "cursor:1",
        isDone: false,
        processed: 1,
      })),
    });
    const result = await Effect.runPromise(
      runMigrationBatch(runtime, args({ batchSize: 1 })),
    );
    expect(result).toMatchObject({
      scanned: 1,
      changed: 0,
      skipped: 1,
      complete: false,
      cursor: "cursor:1",
    });
    expect(runOne).toHaveBeenCalledWith("reserveStableKeys", {
      batchSize: 1,
      dryRun: false,
      cursor: undefined,
    });
    expect(state.receipts.map((row) => row.receiptKind)).toEqual([
      "parent",
      "child",
    ]);
    expect(state.receipts[0]).toMatchObject({
      state: "planned",
      leaseState: "released",
    });
    expect(state.receipts[1]).toMatchObject({
      parentRunId: state.receipts[0]?.releaseRunId,
      receiptHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      leaseState: "released",
    });
    expect(JSON.stringify(state.receipts)).not.toMatch(
      /customer|payload|token|prompt/,
    );
  });

  it("dry-runs through component runOne without append-only writes", async () => {
    const { runtime, state, runOne } = makeRuntime();
    const result = await Effect.runPromise(
      runMigrationBatch(runtime, args({ mode: "dryRun" })),
    );
    expect(result).toMatchObject({
      scanned: 1,
      changed: 0,
      skipped: 1,
      complete: true,
    });
    expect(runOne).toHaveBeenCalledWith("reserveStableKeys", {
      batchSize: 25,
      dryRun: true,
      cursor: undefined,
    });
    expect(state.receipts).toHaveLength(0);
  });

  it("persists component failure receipts and resumes incomplete batches from committed cursor", async () => {
    const failing = makeRuntime({
      runOne: vi.fn(async () => {
        throw new Error("adapter failed");
      }),
    });
    await expect(
      Effect.runPromise(runMigrationBatch(failing.runtime, args())),
    ).rejects.toHaveProperty(
      "name",
      expect.stringContaining("MigrationBatchFailed"),
    );
    expect(failing.state.receipts.map((row) => row.state)).toEqual([
      "planned",
      "failed",
      "failed",
    ]);
    expect(failing.state.latest).toMatchObject({
      state: "failed",
      leaseState: "released",
      componentCursor: null,
    });

    const incomplete = makeRuntime({
      runOne: vi.fn(async () => ({
        continueCursor: "cursor:1",
        isDone: false,
        processed: 1,
      })),
    });
    await Effect.runPromise(
      runMigrationBatch(incomplete.runtime, args({ batchSize: 1 })),
    );
    const resumed = makeRuntime({ latest: incomplete.state.latest });
    await Effect.runPromise(
      runMigrationBatch(resumed.runtime, args({ batchSize: 2 })),
    );
    expect(resumed.runOne).toHaveBeenCalledWith("reserveStableKeys", {
      batchSize: 2,
      dryRun: false,
      cursor: "cursor:1",
    });
  });

  it("production component helper invokes MutationRunner with registered ref and bounded args", async () => {
    const calls: unknown[] = [];
    const runMutation = ((ref: unknown, options: unknown) => {
      calls.push([ref, options]);
      return Effect.succeed({
        continueCursor: "cursor:2",
        isDone: false,
        processed: 2,
      });
    }) as never;
    const result = await Effect.runPromise(
      runComponentWithMutationRunner("reserveStableKeys", {
        batchSize: 2,
        dryRun: false,
        cursor: "cursor:1",
      }).pipe(
        Effect.provideService(
          (await import("../confect/_generated/services")).MutationRunner,
          runMutation,
        ),
      ),
    );
    expect(result).toMatchObject({ continueCursor: "cursor:2", processed: 2 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([
      reserveStableKeys,
      { batchSize: 2, dryRun: false, cursor: "cursor:1", oneBatchOnly: true },
    ]);
  });

  it("rejects cross-release resume, concurrent starts, and invalid failed cursors before component dispatch", async () => {
    const base = {
      runId: "r",
      receiptKind: "parent" as const,
      migrationName: "reserveStableKeys" as const,
      componentCursor: "cursor:1",
      releaseCommit: "release_a",
      schemaBefore: "schema_a",
      schemaAfter: "schema_b",
      deploymentId: "deploy_a",
      startedAt: 1,
    };
    for (const latest of [
      {
        ...base,
        state: "running" as const,
        leaseState: "held" as const,
        releaseRunId: "r",
      },
      {
        ...base,
        state: "failed" as const,
        leaseState: "released" as const,
        releaseRunId: "r",
        releaseCommit: "old",
      },
      {
        ...base,
        state: "failed" as const,
        leaseState: "released" as const,
        releaseRunId: "r",
        componentCursor: null,
      },
    ]) {
      const { runtime, runOne } = makeRuntime({ latest });
      await expect(
        Effect.runPromise(runMigrationBatch(runtime, args())),
      ).rejects.toHaveProperty(
        "name",
        expect.stringMatching(/MigrationAlreadyRunning|MigrationCursorInvalid/),
      );
      expect(runOne).not.toHaveBeenCalled();
    }
  });
});
