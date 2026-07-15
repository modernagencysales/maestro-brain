import { Ref } from "@confect/core";
import migrationsComponent from "@convex-dev/migrations/test";
import { convexTest } from "convex-test";
import type { FunctionReference } from "convex/server";
import type { Value } from "convex/values";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import refs from "../confect/_generated/refs";
import convexSchema from "../confect/_generated/convexSchema";
import {
  MigrationBatchReceipt,
  MigrationParentReceipt,
  canonicalReceiptHash,
} from "../confect/internal/migrations.spec";

const modules = import.meta.glob("../convex/**/!(*.*.*)*.*s");
const migrationRefs = refs.internal.internal.migrations;

const args = {
  migrationName: "probe.expand",
  releaseCommit: "release-a",
  schemaBefore: "sha256:before",
  schemaAfter: "sha256:after",
  actor: "system:migration-test",
  deploymentId: "deploy-a",
  buildId: "build-a",
  mode: "execute" as const,
  batchSize: 2,
};

const makeTest = () => {
  const t = convexTest(convexSchema, modules);
  migrationsComponent.register(t);
  return t;
};

type TestHarness = ReturnType<typeof makeTest>;

const toConvexArgs = (encodedArgs: unknown): Record<string, Value> => {
  if (encodedArgs === undefined || encodedArgs === null) return {};
  if (typeof encodedArgs !== "object" || Array.isArray(encodedArgs)) {
    throw new TypeError("Confect refs encode Convex args as an object");
  }
  return encodedArgs as Record<string, Value>;
};

const makeActionCodecCaller = (t: TestHarness) => {
  const call = (
    functionReference: FunctionReference<"action">,
    encodedArgs: Record<string, Value>,
  ) => t.action(functionReference, encodedArgs);
  return (
    functionReference: FunctionReference<"action">,
    encodedArgs: unknown,
  ) => call(functionReference, toConvexArgs(encodedArgs));
};

const makeMutationCodecCaller = (t: TestHarness) => {
  const call = (
    functionReference: FunctionReference<"mutation">,
    encodedArgs: Record<string, Value>,
  ) => t.mutation(functionReference, encodedArgs);
  return (
    functionReference: FunctionReference<"mutation">,
    encodedArgs: unknown,
  ) => call(functionReference, toConvexArgs(encodedArgs));
};

const runAction = <A extends Ref.AnyAction>(
  t: TestHarness,
  ref: A,
  input: Ref.Args<A>,
) => Effect.runPromise(Ref.runWithCodec(ref, input, makeActionCodecCaller(t)));

const runMutation = <M extends Ref.AnyMutation>(
  t: TestHarness,
  ref: M,
  input: Ref.Args<M>,
) =>
  Effect.runPromise(Ref.runWithCodec(ref, input, makeMutationCodecCaller(t)));

const seedProbeTargets = async (t: TestHarness, count = 3) => {
  await t.run(async (ctx) => {
    for (let index = 0; index < count; index += 1) {
      await ctx.db.insert("migrationRuns", {
        runKey: `probe-target-${index}`,
        migrationName: "probe-target",
        releaseCommit: "seed",
        schemaBefore: "sha256:before",
        schemaAfter: index === 0 ? "sha256:after" : "sha256:before",
        status: "planned",
        cursor: null,
        leaseOwner: null,
        leaseStartedAt: null,
        leaseExpiresAt: null,
        fenceGeneration: 0,
        lastCommittedBatchSequence: 0,
        actor: "seed",
        deploymentId: "seed",
        buildId: "seed",
        createdAt: index,
        updatedAt: index,
      });
    }
  });
};

const listHarnessRows = async (t: TestHarness) =>
  await t.run(async (ctx) => {
    const runs = await ctx.db.query("migrationRuns").collect();
    const receipts = await ctx.db.query("migrationReceipts").collect();
    return { runs, receipts };
  });

const coordinatorRows = (
  rows: Awaited<ReturnType<typeof listHarnessRows>>,
  name = "probe.expand",
) => rows.runs.filter((row) => row.migrationName === name);

const assertNoOrphanChildren = (
  receipts: Awaited<ReturnType<typeof listHarnessRows>>["receipts"],
) => {
  const parentKeys = new Set(
    receipts
      .filter(
        (row) =>
          row.kind === "failure_checkpoint" || row.kind === "release_parent",
      )
      .map((row) => row.receiptKey),
  );
  for (const child of receipts.filter((row) => row.kind === "child")) {
    expect(child.parentReceiptKey).not.toBeNull();
    expect(parentKeys.has(child.parentReceiptKey!)).toBe(true);
  }
};

describe("Maestro Brain migration harness", () => {
  it("is reachable only through generated internal Confect refs backed by registered component migrations", async () => {
    expect(Ref.getFunctionReference(migrationRefs.probeExpand)).toBeDefined();
    expect(Ref.getFunctionReference(migrationRefs.probeFail)).toBeDefined();
    expect(
      Ref.getFunctionReference(migrationRefs.runRegisteredMigration),
    ).toBeDefined();
    expect(Ref.getFunctionReference(migrationRefs.acquireLease)).toBeDefined();
    expect(Ref.getFunctionReference(migrationRefs.settleBatch)).toBeDefined();
    expect("migrations" in (refs.public as object)).toBe(false);

    const t = makeTest();
    await seedProbeTargets(t);
    const result = await runAction(
      t,
      migrationRefs.runRegisteredMigration,
      args,
    );

    expect(result).toMatchObject({
      migrationName: "probe.expand",
      scanned: 2,
      changed: 0,
      skipped: 2,
      failed: 0,
      batchSequence: 1,
      fenceGeneration: 1,
    });
  });

  it("decodes only the exact component DRY RUN rollback payload without writing target rows or receipts", async () => {
    const t = makeTest();
    await seedProbeTargets(t);

    const result = await runAction(t, migrationRefs.runRegisteredMigration, {
      ...args,
      mode: "dryRun",
    });
    const rows = await listHarnessRows(t);
    const targetRows = rows.runs.filter(
      (row) => row.migrationName === "probe-target",
    );

    expect(result).toMatchObject({
      status: "dryRunComplete",
      scanned: 2,
      changed: 0,
      skipped: 2,
      failed: 0,
    });
    expect(targetRows.map((row) => row.schemaAfter)).toEqual([
      "sha256:after",
      "sha256:before",
      "sha256:before",
    ]);
    expect(coordinatorRows(rows)).toHaveLength(0);
    expect(rows.receipts).toHaveLength(0);
  });

  it("persists production failure in dry-run mode when the component error is not the exact DRY RUN rollback", async () => {
    const t = makeTest();
    await seedProbeTargets(t, 1);

    await expect(
      runAction(t, migrationRefs.runRegisteredMigration, {
        ...args,
        migrationName: "probe.fail",
        mode: "dryRun",
      }),
    ).rejects.toThrow("probe.fail");

    const rows = await listHarnessRows(t);
    expect(coordinatorRows(rows, "probe.fail")[0]).toMatchObject({
      status: "failed",
    });
    assertNoOrphanChildren(rows.receipts);
  });

  it("durably records failed state plus failed child and exactly one terminal release parent/failure checkpoint before returning the typed error", async () => {
    const t = makeTest();
    await seedProbeTargets(t, 1);

    await expect(
      runAction(t, migrationRefs.runRegisteredMigration, {
        ...args,
        migrationName: "probe.fail",
      }),
    ).rejects.toThrow("probe.fail");

    const { runs, receipts } = await listHarnessRows(t);
    const run = runs.find((row) => row.migrationName === "probe.fail");
    const childReceipts = receipts.filter((row) => row.kind === "child");
    const parentReceipts = receipts.filter(
      (row) =>
        row.kind === "failure_checkpoint" || row.kind === "release_parent",
    );

    expect(parentReceipts.map((row) => row.kind)).toEqual([
      "failure_checkpoint",
    ]);
    expect(run).toMatchObject({
      status: "failed",
      leaseOwner: null,
      lastCommittedBatchSequence: 1,
    });
    expect(childReceipts).toHaveLength(1);
    expect(parentReceipts).toHaveLength(1);
    expect(JSON.parse(childReceipts[0]!.payloadJson)).toMatchObject({
      migrationName: "probe.fail",
      failed: 1,
      complete: true,
    });
    expect(childReceipts[0]!.parentReceiptKey).toBe(
      parentReceipts[0]!.receiptKey,
    );
    expect(
      JSON.parse(parentReceipts[0]!.payloadJson).childReceiptHashes,
    ).toEqual([childReceipts[0]!.receiptHash]);
    assertNoOrphanChildren(receipts);
  });

  it("rejects lease races, recovers expired leases, rejects stale settlement fences, and resumes from the committed cursor", async () => {
    const t = makeTest();
    const contenders = await Promise.allSettled([
      runMutation(t, migrationRefs.acquireLease, {
        ...args,
        leaseOwner: "worker-a",
      }),
      runMutation(t, migrationRefs.acquireLease, {
        ...args,
        leaseOwner: "worker-b",
      }),
    ]);
    expect(
      contenders.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      contenders.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);

    const winner = contenders.find((result) => result.status === "fulfilled")!;
    const lease = winner.value;
    await expect(
      runMutation(t, migrationRefs.settleBatch, {
        ...args,
        mode: "execute",
        expectedLeaseOwner: "stale-worker",
        expectedFenceGeneration: lease.fenceGeneration,
        batchStartedAt: lease.leaseStartedAt,
        componentCursor: lease.cursor,
        nextCursor: lease.cursor,
        complete: false,
        scanned: 0,
        changed: 0,
        skipped: 0,
        failed: 0,
      }),
    ).rejects.toThrow("leaseOwner");

    await t.run(async (ctx) => {
      const run = (await ctx.db.query("migrationRuns").collect()).find(
        (row) => row.migrationName === "probe.expand",
      )!;
      await ctx.db.patch(run._id, { leaseExpiresAt: 0 });
    });
    const recovered = await runMutation(t, migrationRefs.acquireLease, {
      ...args,
      leaseOwner: "worker-c",
    });
    expect(recovered.fenceGeneration).toBe(2);
    await expect(
      runMutation(t, migrationRefs.settleBatch, {
        ...args,
        mode: "execute",
        expectedLeaseOwner: recovered.leaseOwner!,
        expectedFenceGeneration: lease.fenceGeneration,
        batchStartedAt: recovered.leaseStartedAt,
        componentCursor: recovered.cursor,
        nextCursor: recovered.cursor,
        complete: false,
        scanned: 0,
        changed: 0,
        skipped: 0,
        failed: 0,
      }),
    ).rejects.toThrow("leaseOwner");

    await runMutation(t, migrationRefs.settleBatch, {
      ...args,
      mode: "execute",
      expectedLeaseOwner: recovered.leaseOwner!,
      expectedFenceGeneration: recovered.fenceGeneration,
      batchStartedAt: recovered.leaseStartedAt,
      componentCursor: recovered.cursor,
      nextCursor: recovered.cursor,
      complete: false,
      scanned: 0,
      changed: 0,
      skipped: 0,
      failed: 0,
    });

    await seedProbeTargets(t, 5);
    const resumed = await runAction(
      t,
      migrationRefs.runRegisteredMigration,
      args,
    );

    expect(resumed.componentCursor).toBe(recovered.cursor);
    expect(resumed.leaseOwner).toBeNull();
    expect(resumed.fenceGeneration).toBe(3);
    expect(resumed.batchSequence).toBe(2);
  });

  it("rejects release/schema/deployment/build drift and returns the existing completed result idempotently", async () => {
    const t = makeTest();
    await seedProbeTargets(t, 3);

    await runAction(t, migrationRefs.runRegisteredMigration, args);
    await runAction(t, migrationRefs.runRegisteredMigration, args);
    const complete = await runAction(
      t,
      migrationRefs.runRegisteredMigration,
      args,
    );
    const before = await listHarnessRows(t);
    const rerun = await runAction(
      t,
      migrationRefs.runRegisteredMigration,
      args,
    );
    const after = await listHarnessRows(t);

    expect(complete.status).toBe("complete");
    expect(rerun).toMatchObject(complete);
    expect(after.receipts).toEqual(before.receipts);
    expect(after.runs).toEqual(before.runs);

    for (const drift of [
      { releaseCommit: "release-b" },
      { schemaBefore: "sha256:other-before" },
      { schemaAfter: "sha256:other-after" },
      { deploymentId: "deploy-b" },
      { buildId: "build-b" },
    ]) {
      await expect(
        runAction(t, migrationRefs.runRegisteredMigration, {
          ...args,
          ...drift,
        }),
      ).rejects.toThrow("migrationName");
    }
  });

  it("persists append-only receipts with batch-order child hashes and typed complete release_parent metadata", async () => {
    const t = makeTest();
    await seedProbeTargets(t, 3);

    await runAction(t, migrationRefs.runRegisteredMigration, args);
    await runAction(t, migrationRefs.runRegisteredMigration, args);
    await runAction(t, migrationRefs.runRegisteredMigration, args);

    const { receipts } = await listHarnessRows(t);
    const childReceipts = receipts.filter((row) => row.kind === "child");
    const parentReceipts = receipts.filter(
      (row) =>
        row.kind === "failure_checkpoint" || row.kind === "release_parent",
    );
    const terminalParent = parentReceipts.at(-1)!;
    expect(terminalParent.kind).toBe("release_parent");
    const parentPayload = JSON.parse(terminalParent.payloadJson);

    expect(childReceipts.map((row) => row.batchSequence)).toEqual([1, 2, 3]);
    expect(parentReceipts).toHaveLength(1);
    expect(childReceipts.map((row) => row.parentReceiptKey)).toEqual([
      terminalParent.receiptKey,
      terminalParent.receiptKey,
      terminalParent.receiptKey,
    ]);
    expect(parentPayload.childReceiptHashes).toEqual(
      childReceipts.map((row) => row.receiptHash),
    );
    for (const child of childReceipts) {
      expect(child.receiptHash).toBe(
        canonicalReceiptHash(
          MigrationBatchReceipt.make(JSON.parse(child.payloadJson)),
        ),
      );
    }
    expect(terminalParent.receiptHash).toBe(
      canonicalReceiptHash(MigrationParentReceipt.make(parentPayload)),
    );
    expect(canonicalReceiptHash({ a: 1, b: 2 })).toBe(
      "sha256:43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777",
    );
    expect(canonicalReceiptHash({ b: 2, a: 1 })).toBe(
      canonicalReceiptHash({ a: 1, b: 2 }),
    );
    expect(canonicalReceiptHash({ a: 1, b: 3 })).not.toBe(
      canonicalReceiptHash({ a: 1, b: 2 }),
    );
    expect(parentPayload).toMatchObject({
      releaseCommit: "release-a",
      schemaBefore: "sha256:before",
      schemaAfter: "sha256:after",
      rollbackOwner: "platform",
      actor: "system:migration-test",
      deploymentId: "deploy-a",
      buildId: "build-a",
      batchSize: 2,
      complete: true,
    });
    assertNoOrphanChildren(receipts);
  });

  it("rejects unknown, reserved, destructive, forged cursor, reset, next, and invalid batch inputs", async () => {
    const t = makeTest();
    await expect(
      runAction(t, migrationRefs.runRegisteredMigration, {
        ...args,
        migrationName: "future.agencyKeys.expand",
      }),
    ).rejects.toThrow("migrationName");
    await expect(
      runAction(t, migrationRefs.runRegisteredMigration, {
        ...args,
        migrationName: "probe.contract",
      }),
    ).rejects.toThrow("migrationName");
    await expect(
      runAction(t, migrationRefs.runRegisteredMigration, {
        ...args,
        cursor: "forged",
      }),
    ).rejects.toThrow("migrationName");
    await expect(
      runAction(t, migrationRefs.runRegisteredMigration, {
        ...args,
        reset: true,
      }),
    ).rejects.toThrow("migrationName");
    await expect(
      runAction(t, migrationRefs.runRegisteredMigration, {
        ...args,
        next: ["internal/migrations:probeExpand"],
      }),
    ).rejects.toThrow("migrationName");
    await expect(
      runAction(t, migrationRefs.runRegisteredMigration, {
        ...args,
        batchSize: 101,
      }),
    ).rejects.toBeTruthy();
  });
});
