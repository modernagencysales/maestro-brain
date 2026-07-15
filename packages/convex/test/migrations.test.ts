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
  canonicalReceiptHash,
  childReceiptHash,
  releaseParentKey,
} from "../confect/internal/migrations";
import {
  MigrationBatchReceipt,
  MigrationParentReceipt,
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
  if (typeof encodedArgs !== "object" || Array.isArray(encodedArgs))
    throw new TypeError("Confect refs encode Convex args as an object");
  return encodedArgs as Record<string, Value>;
};
const makeActionCodecCaller =
  (t: TestHarness) =>
  (functionReference: FunctionReference<"action">, encodedArgs: unknown) =>
    t.action(functionReference, toConvexArgs(encodedArgs));
const makeMutationCodecCaller =
  (t: TestHarness) =>
  (functionReference: FunctionReference<"mutation">, encodedArgs: unknown) =>
    t.mutation(functionReference, toConvexArgs(encodedArgs));
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

const seedProbeTargets = async (t: TestHarness, actors: readonly string[]) => {
  await t.run(async (ctx) => {
    for (const [index, actor] of actors.entries()) {
      await ctx.db.insert("migrationRuns", {
        runKey: `probe-target-${index}`,
        migrationName: "probe-target",
        releaseCommit: "seed",
        schemaBefore: "sha256:before",
        schemaAfter: "sha256:before",
        mode: "execute",
        status: "planned",
        cursor: null,
        leaseOwner: null,
        leaseStartedAt: null,
        leaseExpiresAt: null,
        fenceGeneration: 0,
        lastCommittedBatchSequence: 0,
        actor,
        deploymentId: "seed",
        buildId: "seed",
        createdAt: index,
        updatedAt: index,
      });
    }
  });
};
const listRows = async (t: TestHarness) =>
  await t.run(async (ctx) => ({
    runs: await ctx.db.query("migrationRuns").collect(),
    receipts: await ctx.db.query("migrationReceipts").collect(),
  }));
const harnessRun = (rows: Awaited<ReturnType<typeof listRows>>) =>
  rows.runs.find((row) => row.migrationName === "probe.expand")!;
const childReceipts = (rows: Awaited<ReturnType<typeof listRows>>) =>
  rows.receipts
    .filter((row) => row.kind === "child")
    .sort((a, b) => a.batchSequence - b.batchSequence);
const releaseParents = (rows: Awaited<ReturnType<typeof listRows>>) =>
  rows.receipts.filter((row) => row.kind === "release_parent");
const failureCheckpoints = (rows: Awaited<ReturnType<typeof listRows>>) =>
  rows.receipts.filter((row) => row.kind === "failure_checkpoint");

const parseChild = (row: ReturnType<typeof childReceipts>[number]) =>
  MigrationBatchReceipt.make(JSON.parse(row.payloadJson));
const parseParent = (row: ReturnType<typeof releaseParents>[number]) =>
  MigrationParentReceipt.make(JSON.parse(row.payloadJson));

describe("Maestro Brain migration harness", () => {
  it("runs real component batches, fails after C1, resumes from C1, and reruns byte-identically", async () => {
    const t = makeTest();
    await seedProbeTargets(t, [
      "ok-0",
      "ok-1",
      "inject-component-failure",
      "ok-3",
      "ok-4",
    ]);

    const first = await runAction(
      t,
      migrationRefs.runRegisteredMigration,
      args,
    );
    expect(first).toMatchObject({
      status: "running",
      initialCursor: null,
      componentCursor: null,
      scanned: 2,
      changed: null,
      skipped: null,
      countProvenance: "unavailable",
      batchSequence: 1,
    });
    const committedCursor = first.nextCursor;
    expect(committedCursor).toEqual(expect.any(String));

    await expect(
      runAction(t, migrationRefs.runRegisteredMigration, args),
    ).rejects.toThrow("probe.expand");
    const failed = await listRows(t);
    expect(harnessRun(failed)).toMatchObject({
      status: "failed",
      cursor: committedCursor,
      leaseOwner: null,
      lastCommittedBatchSequence: 2,
    });
    expect(childReceipts(failed)).toHaveLength(2);
    expect(failureCheckpoints(failed)).toHaveLength(1);
    expect(releaseParents(failed)).toHaveLength(0);
    expect(parseChild(childReceipts(failed)[1]!)).toMatchObject({
      priorCursor: committedCursor,
      nextCursor: committedCursor,
      scanned: 0,
      failed: 1,
      changed: null,
      skipped: null,
      countProvenance: "unavailable",
      stableReleaseParentKey: releaseParentKey(first.runKey),
    });

    await t.run(async (ctx) => {
      const poison = (await ctx.db.query("migrationRuns").collect()).find(
        (row) => row.actor === "inject-component-failure",
      )!;
      await ctx.db.patch(poison._id, { actor: "ok-2" });
    });
    const resumed = await runAction(
      t,
      migrationRefs.runRegisteredMigration,
      args,
    );
    expect(resumed).toMatchObject({
      status: "running",
      componentCursor: committedCursor,
      fenceGeneration: 3,
      batchSequence: 3,
    });
    let complete = resumed;
    for (
      let attempt = 0;
      attempt < 4 && complete.status !== "complete";
      attempt += 1
    ) {
      complete = await runAction(t, migrationRefs.runRegisteredMigration, args);
    }
    expect(complete.status).toBe("complete");

    const beforeRerun = await listRows(t);
    const rerun = await runAction(
      t,
      migrationRefs.runRegisteredMigration,
      args,
    );
    const afterRerun = await listRows(t);
    expect(rerun).toEqual(complete);
    expect(afterRerun).toEqual(beforeRerun);

    const children = childReceipts(afterRerun);
    const parents = releaseParents(afterRerun);
    expect(parents).toHaveLength(1);
    expect(children.map((row) => row.batchSequence)).toEqual(
      children.map((_, index) => index + 1),
    );
    expect(children[0]!.parentReceiptKey).toBe(releaseParentKey(first.runKey));
    expect(children[1]!.parentReceiptKey).toBe(
      failureCheckpoints(afterRerun)[0]!.receiptKey,
    );
    expect(
      children
        .slice(2)
        .every(
          (row) => row.parentReceiptKey === releaseParentKey(first.runKey),
        ),
    ).toBe(true);
    const releaseParent = parseParent(parents[0]!);
    expect(releaseParent.parityChecks).not.toContain("count-parity");
    expect(releaseParent.parityChecks).toContain("component-cursor-complete");
    expect(releaseParent.parityChecks).toContain(
      "definition-counts-unavailable",
    );
    expect(releaseParent.parityChecks).toContain(
      `ordered-child-hashes:${children.length}`,
    );
    expect(releaseParent.observationEndsAt).toBeGreaterThan(
      parseChild(children.at(-1)!).finishedAt,
    );
    expect(releaseParent.rollbackOwner).toBe("platform-migrations");
    expect(releaseParent.rollbackOwner).not.toBe(`actor:${args.actor}`);
    expect(releaseParent.childReceiptHashes).toEqual(
      children.map((row) => row.receiptHash),
    );
    expect(releaseParent.receiptHash).toBeUndefined();
    expect(parents[0]!.receiptHash).toBe(canonicalReceiptHash(releaseParent));
    for (const child of children)
      expect(child.receiptHash).toBe(childReceiptHash(parseChild(child)));
  });

  it("replays a post-component/pre-settle crash idempotently without duplicate target writes or receipts", async () => {
    const t = makeTest();
    await seedProbeTargets(t, ["inject-post-component-crash", "ok-1", "ok-2"]);

    await expect(
      runAction(t, migrationRefs.runRegisteredMigration, {
        ...args,
      }),
    ).rejects.toThrow("probe.expand");

    const afterCrash = await listRows(t);
    expect(harnessRun(afterCrash)).toMatchObject({
      status: "running",
      cursor: null,
      leaseExpiresAt: 0,
      lastCommittedBatchSequence: 0,
    });
    expect(childReceipts(afterCrash)).toHaveLength(0);

    const replay = await runAction(
      t,
      migrationRefs.runRegisteredMigration,
      args,
    );
    expect(replay).toMatchObject({
      status: "running",
      nextCursor: expect.any(String),
      batchSequence: 1,
    });
    const afterReplay = await listRows(t);
    const targetRows = afterReplay.runs.filter(
      (row) => row.migrationName === "probe-target",
    );
    expect(
      targetRows.filter((row) => row.schemaAfter === "sha256:after"),
    ).toHaveLength(2);
    expect(childReceipts(afterReplay)).toHaveLength(1);
  });

  it("rejects expired settlement, prior-cursor mismatch, forged cursor controls, unknown and reserved names", async () => {
    const t = makeTest();
    const lease = await runMutation(t, migrationRefs.acquireLease, {
      ...args,
      leaseOwner: "worker-a",
    });
    await expect(
      runMutation(t, migrationRefs.acquireLease, {
        ...args,
        leaseOwner: "worker-b",
      }),
    ).rejects.toThrow("worker-a");

    await expect(
      runMutation(t, migrationRefs.settleBatch, {
        ...args,
        mode: "execute",
        expectedLeaseOwner: "worker-a",
        expectedFenceGeneration: lease.fenceGeneration,
        expectedLeaseExpiresAt: lease.leaseExpiresAt,
        batchStartedAt: lease.leaseStartedAt,
        priorCursor: "forged",
        nextCursor: "opaque-test-cursor",
        complete: false,
        scanned: 0,
        changed: null,
        skipped: null,
        failed: 0,
        countProvenance: "unavailable",
      }),
    ).rejects.toThrow("prior cursor");
    await t.run(async (ctx) => {
      const run = (await ctx.db.query("migrationRuns").collect()).find(
        (row) => row.migrationName === "probe.expand",
      )!;
      await ctx.db.patch(run._id, { leaseExpiresAt: 0 });
    });
    await expect(
      runMutation(t, migrationRefs.settleBatch, {
        ...args,
        mode: "execute",
        expectedLeaseOwner: "worker-a",
        expectedFenceGeneration: lease.fenceGeneration,
        expectedLeaseExpiresAt: 0,
        batchStartedAt: lease.leaseStartedAt,
        priorCursor: null,
        nextCursor: "opaque-test-cursor",
        complete: false,
        scanned: 0,
        changed: null,
        skipped: null,
        failed: 0,
        countProvenance: "unavailable",
      }),
    ).rejects.toThrow("expired");

    await expect(
      runAction(t, migrationRefs.runRegisteredMigration, {
        ...args,
        releaseCommit: "release-b",
      }),
    ).rejects.toThrow("release/schema/deployment/build drift");
    await expect(
      runAction(t, migrationRefs.runRegisteredMigration, {
        ...args,
        schemaAfter: "sha256:other-after",
      }),
    ).rejects.toThrow("release/schema/deployment/build drift");
    await expect(
      runAction(t, migrationRefs.runRegisteredMigration, {
        ...args,
        deploymentId: "deploy-b",
      }),
    ).rejects.toThrow("release/schema/deployment/build drift");

    for (const bad of [
      { migrationName: "future.agencyKeys.expand" },
      { migrationName: "probe.contract" },
      { migrationName: "missing.expand" },
      { cursor: "forged" },
      { reset: true },
      { reset: false },
      { next: ["internal/migrations:probeExpand"] },
      { batchSize: 101 },
    ]) {
      await expect(
        runAction(t, migrationRefs.runRegisteredMigration, { ...args, ...bad }),
      ).rejects.toBeTruthy();
    }
  });

  it("fences concurrent execute and dry-run leases across the same stable identity", async () => {
    const t = makeTest();
    const executeLease = await runMutation(t, migrationRefs.acquireLease, {
      ...args,
      leaseOwner: "execute-owner",
    });
    await expect(
      runMutation(t, migrationRefs.acquireLease, {
        ...args,
        mode: "dryRun",
        leaseOwner: "dry-run-owner",
      }),
    ).rejects.toThrow("execute-owner");
    const failed = await runMutation(t, migrationRefs.settleBatch, {
      ...args,
      mode: "execute",
      expectedLeaseOwner: "execute-owner",
      expectedFenceGeneration: executeLease.fenceGeneration,
      expectedLeaseExpiresAt: executeLease.leaseExpiresAt,
      batchStartedAt: executeLease.leaseStartedAt,
      priorCursor: null,
      nextCursor: null,
      complete: true,
      scanned: 0,
      changed: null,
      skipped: null,
      failed: 1,
      countProvenance: "unavailable",
    });
    expect(failed.status).toBe("failed");
    const rows = await listRows(t);
    expect(harnessRun(rows).leaseOwner).toBeNull();
  });

  it("applies failed dry-run quarantine even when an execute run already exists", async () => {
    const t = makeTest();
    await seedProbeTargets(t, ["inject-component-failure"]);
    await runMutation(t, migrationRefs.acquireLease, {
      ...args,
      leaseOwner: "execute-existing",
    });
    await t.run(async (ctx) => {
      const run = (await ctx.db.query("migrationRuns").collect()).find(
        (row) => row.migrationName === "probe.expand" && row.mode === "execute",
      )!;
      await ctx.db.patch(run._id, { leaseExpiresAt: 0, leaseOwner: null });
    });
    await expect(
      runAction(t, migrationRefs.runRegisteredMigration, {
        ...args,
        mode: "dryRun",
      }),
    ).rejects.toThrow("probe.expand");
    await expect(
      runAction(t, migrationRefs.runRegisteredMigration, args),
    ).rejects.toThrow("failed dry-run quarantine");
    const rows = await listRows(t);
    expect(
      rows.runs.filter(
        (row) =>
          row.actor === "inject-component-failure" &&
          row.schemaAfter === "sha256:after",
      ),
    ).toHaveLength(0);
  });

  it("runs successful dry-runs in bounded batches without blocking later execute", async () => {
    const t = makeTest();
    await seedProbeTargets(t, ["ok-0", "ok-1", "ok-2"]);

    const firstDryRun = await runAction(
      t,
      migrationRefs.runRegisteredMigration,
      {
        ...args,
        mode: "dryRun",
      },
    );
    expect(firstDryRun).toMatchObject({
      status: "running",
      initialCursor: null,
      scanned: 2,
      changed: null,
      skipped: null,
    });
    expect(firstDryRun.nextCursor).toEqual(expect.any(String));
    let rows = await listRows(t);
    expect(childReceipts(rows)).toHaveLength(1);
    expect(
      rows.runs.filter(
        (row) =>
          row.migrationName === "probe-target" &&
          row.schemaAfter === "sha256:after",
      ),
    ).toHaveLength(0);

    let terminalDryRun = firstDryRun;
    for (
      let attempt = 0;
      attempt < 4 && terminalDryRun.status !== "dryRunComplete";
      attempt += 1
    ) {
      terminalDryRun = await runAction(
        t,
        migrationRefs.runRegisteredMigration,
        {
          ...args,
          mode: "dryRun",
        },
      );
      expect(terminalDryRun.scanned).toBeLessThanOrEqual(args.batchSize);
    }
    expect(terminalDryRun.status).toBe("dryRunComplete");
    rows = await listRows(t);
    expect(
      childReceipts(rows).filter((row) => row.mode === "dryRun").length,
    ).toBeGreaterThan(1);
    expect(
      rows.runs.filter(
        (row) =>
          row.migrationName === "probe-target" &&
          row.schemaAfter === "sha256:after",
      ),
    ).toHaveLength(0);

    let execute = await runAction(
      t,
      migrationRefs.runRegisteredMigration,
      args,
    );
    while (execute.status !== "complete") {
      execute = await runAction(t, migrationRefs.runRegisteredMigration, args);
    }
    rows = await listRows(t);
    expect(
      rows.runs.filter(
        (row) =>
          row.migrationName === "probe-target" &&
          row.schemaAfter === "sha256:after",
      ),
    ).toHaveLength(3);
  });

  it("decodes dry-run rollback as read-only and persists unknown dry-run failure without execute retry", async () => {
    const t = makeTest();
    await seedProbeTargets(t, ["ok-0"]);

    await expect(
      runAction(t, migrationRefs.runRegisteredMigration, {
        ...args,
        migrationName: "probe.fail",
        mode: "dryRun",
      }),
    ).rejects.toThrow("probe.fail");

    let rows = await listRows(t);
    expect(harnessRun(rows)).toBeUndefined();
    const failedRun = rows.runs.find(
      (row) => row.migrationName === "probe.fail",
    );
    expect(failedRun).toMatchObject({
      status: "failed",
      cursor: null,
      lastCommittedBatchSequence: 1,
    });
    const failedChild = parseChild(childReceipts(rows)[0]!);
    expect(failedChild).toMatchObject({
      scanned: 0,
      failed: 1,
      changed: null,
      skipped: null,
      countProvenance: "unavailable",
    });
    expect(failureCheckpoints(rows)).toHaveLength(1);
    expect(failureCheckpoints(rows)[0]!.mode).toBe("dryRun");
    await expect(
      runAction(t, migrationRefs.runRegisteredMigration, {
        ...args,
        migrationName: "probe.fail",
        mode: "execute",
      }),
    ).rejects.toThrow("failed dry-run quarantine");
    expect(releaseParents(rows)).toHaveLength(0);
    expect(
      rows.runs.find((row) => row.migrationName === "probe-target")!
        .schemaAfter,
    ).toBe("sha256:before");

    let dryRun = await runAction(t, migrationRefs.runRegisteredMigration, {
      ...args,
      mode: "dryRun",
    });
    while (dryRun.status !== "dryRunComplete") {
      expect(dryRun.scanned).toBeLessThanOrEqual(args.batchSize);
      dryRun = await runAction(t, migrationRefs.runRegisteredMigration, {
        ...args,
        mode: "dryRun",
      });
    }
    expect(dryRun).toMatchObject({
      status: "dryRunComplete",
      changed: null,
      skipped: null,
      countProvenance: "unavailable",
    });
    rows = await listRows(t);
    expect(
      rows.runs.filter((row) => row.migrationName === "probe-target")[0]!
        .schemaAfter,
    ).toBe("sha256:before");
  });

  it("fails closed for unclassified dry-runs before upstream component invocation", async () => {
    const t = makeTest();
    const sensitive = "SECRET-BRAIN-SOURCE-CUSTOMER-TEXT";
    await seedProbeTargets(t, [sensitive]);
    const logs: string[] = [];
    const originalDebug = console.debug;
    const originalLog = console.log;
    const originalError = console.error;
    console.debug = (...values: unknown[]) =>
      logs.push(values.map(String).join(" "));
    console.log = (...values: unknown[]) =>
      logs.push(values.map(String).join(" "));
    console.error = (...values: unknown[]) =>
      logs.push(values.map(String).join(" "));
    try {
      await expect(
        runAction(t, migrationRefs.runRegisteredMigration, {
          ...args,
          migrationName: "future.sourceLedger.contract",
          mode: "dryRun",
        }),
      ).rejects.toThrow("future.sourceLedger.contract");
      await expect(
        runAction(t, migrationRefs.runRegisteredMigration, {
          ...args,
          migrationName: "missing.sensitive",
          mode: "dryRun",
        }),
      ).rejects.toThrow("missing.sensitive");
    } finally {
      console.debug = originalDebug;
      console.log = originalLog;
      console.error = originalError;
    }
    expect(logs.join("\n")).not.toContain(sensitive);
    expect(logs.join("\n")).not.toContain("DRY RUN: Example change");
  });

  it("keeps migration functions internal-only through generated Confect refs", () => {
    expect(Ref.getFunctionReference(migrationRefs.probeExpand)).toBeDefined();
    expect(
      Ref.getFunctionReference(migrationRefs.runRegisteredMigration),
    ).toBeDefined();
    expect(Ref.getFunctionReference(migrationRefs.acquireLease)).toBeDefined();
    expect(Ref.getFunctionReference(migrationRefs.settleBatch)).toBeDefined();
    expect("migrations" in (refs.public as object)).toBe(false);
  });
});
