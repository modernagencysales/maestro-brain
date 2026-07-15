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
  deriveStableAgencyKey,
  deriveStableBrainKey,
} from "../confect/identity/stableKeys";
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
  (
    functionReference: FunctionReference<"action", "public" | "internal">,
    encodedArgs: unknown,
  ) =>
    t.action(functionReference, toConvexArgs(encodedArgs));
const makeMutationCodecCaller =
  (t: TestHarness) =>
  (
    functionReference: FunctionReference<"mutation", "public" | "internal">,
    encodedArgs: unknown,
  ) =>
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
const expectOne = <T>(value: T | undefined, label: string): T => {
  expect(value, label).toBeDefined();
  return value as T;
};

const harnessRun = (rows: Awaited<ReturnType<typeof listRows>>) =>
  expectOne(
    rows.runs.find((row) => row.migrationName === "probe.expand"),
    "probe.expand harness run",
  );
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
const stableTenantExecuteChildren = (
  rows: Awaited<ReturnType<typeof listRows>>,
) =>
  childReceipts(rows)
    .map(parseChild)
    .filter(
      (
        receipt,
      ): receipt is MigrationBatchReceipt & {
        readonly changed: number;
        readonly skipped: number;
      } =>
        receipt.mode === "execute" &&
        receipt.migrationName.startsWith("stableTenant.") &&
        receipt.countProvenance === "component" &&
        typeof receipt.changed === "number" &&
        typeof receipt.skipped === "number",
    )
    .sort(
      (left, right) =>
        left.migrationName.localeCompare(right.migrationName) ||
        left.batchSequence - right.batchSequence,
    );
const parseParent = (row: ReturnType<typeof releaseParents>[number]) =>
  MigrationParentReceipt.make(JSON.parse(row.payloadJson));
const errorTags = (
  error: unknown,
  seen = new Set<unknown>(),
): readonly string[] => {
  if (typeof error !== "object" || error === null || seen.has(error)) return [];
  seen.add(error);
  const tagged = error as { readonly _tag?: unknown };
  const ownTag = typeof tagged._tag === "string" ? [tagged._tag] : [];
  return [
    ...ownTag,
    ...Reflect.ownKeys(error).flatMap((key) =>
      errorTags((error as Record<PropertyKey, unknown>)[key], seen),
    ),
  ];
};

const stableOrgArgs = {
  ...args,
  migrationName: "stableTenant.organizationKeys.expand",
  releaseCommit: "release-stable-org",
  schemaAfter: "sha256:stable-org-after",
  batchSize: 1,
};
const stableWorkspaceArgs = {
  ...args,
  migrationName: "stableTenant.workspaceKeys.expand",
  releaseCommit: "release-stable-workspace",
  schemaAfter: "sha256:stable-workspace-after",
  batchSize: 1,
};

const seedStableTenantTargets = async (t: TestHarness) => {
  await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      subject: "workos|stable-migration",
      email: "stable-migration@example.com",
      displayName: "Stable Migration",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    const organizationOne = await ctx.db.insert("organizations", {
      ownerUserId: userId,
      slug: "stable-one",
      name: "Stable One",
      status: "active",
      createdAt: 10,
      updatedAt: 10,
    });
    const organizationTwo = await ctx.db.insert("organizations", {
      ownerUserId: userId,
      slug: "stable-two",
      name: "Stable Two",
      status: "active",
      createdAt: 20,
      updatedAt: 20,
    });
    await ctx.db.insert("workspaces", {
      organizationId: organizationOne,
      ownerUserId: userId,
      slug: "stable-workspace-one",
      name: "Stable Workspace One",
      status: "active",
      dataClassification: "internal",
      createdAt: 30,
      updatedAt: 30,
    });
    await ctx.db.insert("workspaces", {
      organizationId: organizationTwo,
      ownerUserId: userId,
      slug: "stable-workspace-two",
      name: "Stable Workspace Two",
      status: "active",
      dataClassification: "internal",
      createdAt: 40,
      updatedAt: 40,
    });
  });
};

const expectRejectTag = async (promise: Promise<unknown>, tag: string) => {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error, `expected rejection tagged ${tag}`).toBeDefined();
  expect(errorTags(error)).toContain(tag);
};

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
    expect(
      parseChild(expectOne(childReceipts(failed)[1], "failed child receipt")),
    ).toMatchObject({
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
      const poison = expectOne(
        (await ctx.db.query("migrationRuns").collect()).find(
          (row) => row.actor === "inject-component-failure",
        ),
        "poison probe target",
      );
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
    expect(expectOne(children[0], "first child receipt").parentReceiptKey).toBe(
      releaseParentKey(first.runKey),
    );
    expect(
      expectOne(children[1], "failed child receipt").parentReceiptKey,
    ).toBe(
      expectOne(failureCheckpoints(afterRerun)[0], "failure checkpoint")
        .receiptKey,
    );
    expect(
      children
        .slice(2)
        .every(
          (row) => row.parentReceiptKey === releaseParentKey(first.runKey),
        ),
    ).toBe(true);
    const releaseParent = parseParent(expectOne(parents[0], "release parent"));
    expect(releaseParent.mode).toBe("execute");
    expect(releaseParent.parityChecks).not.toContain("count-parity");
    expect(releaseParent.parityChecks).toContain("component-cursor-complete");
    expect(releaseParent.parityChecks).toContain(
      "definition-counts-unavailable",
    );
    expect(releaseParent.parityChecks).toContain(
      `ordered-child-hashes:${children.length}`,
    );
    expect(releaseParent.observationEndsAt).toBe(
      parseChild(expectOne(children.at(-1), "last child receipt")).finishedAt +
        5 * 60_000,
    );
    expect(parents[0]).toMatchObject({ mode: "execute" });
    expect(releaseParent.rollbackOwner).toBe("platform-migrations");
    expect(releaseParent.rollbackOwner).not.toBe(`actor:${args.actor}`);
    expect(releaseParent.childReceiptHashes).toEqual(
      children.map((row) => row.receiptHash),
    );
    expect("receiptHash" in releaseParent).toBe(false);
    expect(expectOne(parents[0], "release parent row").receiptHash).toBe(
      canonicalReceiptHash(releaseParent),
    );
    for (const child of children)
      expect(child.receiptHash).toBe(childReceiptHash(parseChild(child)));
  });

  it("rejects completed reruns when terminal child or final parent receipt is missing", async () => {
    const completeRun = async (t: TestHarness) => {
      let result = await runAction(t, migrationRefs.runRegisteredMigration, {
        ...args,
        batchSize: 1,
      });
      for (
        let attempt = 0;
        attempt < 4 && result.status !== "complete";
        attempt += 1
      ) {
        result = await runAction(t, migrationRefs.runRegisteredMigration, {
          ...args,
          batchSize: 1,
        });
      }
      expect(result.status).toBe("complete");
    };

    const missingChild = makeTest();
    await seedProbeTargets(missingChild, ["ok-0"]);
    await completeRun(missingChild);
    await missingChild.run(async (ctx) => {
      const children = (
        await ctx.db.query("migrationReceipts").collect()
      ).filter((row) => row.kind === "child");
      expect(children.length, "child receipts to corrupt").toBeGreaterThan(0);
      for (const child of children) await ctx.db.delete(child._id);
    });
    await expectRejectTag(
      runAction(missingChild, migrationRefs.runRegisteredMigration, {
        ...args,
        batchSize: 1,
      }),
      "MigrationBatchFailed",
    );

    const missingParent = makeTest();
    await seedProbeTargets(missingParent, ["ok-0"]);
    await completeRun(missingParent);
    await missingParent.run(async (ctx) => {
      const parent = expectOne(
        (await ctx.db.query("migrationReceipts").collect()).find(
          (row) => row.kind === "release_parent",
        ),
        "release parent receipt",
      );
      await ctx.db.delete(parent._id);
    });
    await expectRejectTag(
      runAction(missingParent, migrationRefs.runRegisteredMigration, {
        ...args,
        batchSize: 1,
      }),
      "MigrationBatchFailed",
    );
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
    expect(
      afterCrash.runs.filter(
        (row) =>
          row.migrationName === "probe-target" &&
          row.schemaAfter === "sha256:after",
      ),
    ).toHaveLength(2);
    const crashedTarget = expectOne(
      afterCrash.runs.find((row) => row.actor === "write-count:1;post-crash"),
      "post-crash target",
    );
    expect(crashedTarget.probeWriteCount).toBe(1);

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
    const replayedCrashTarget = expectOne(
      targetRows.find((row) => row.actor === "write-count:1;post-crash"),
      "replayed post-crash target",
    );
    expect(replayedCrashTarget.probeWriteCount).toBe(1);
    expect(childReceipts(afterReplay)).toHaveLength(1);
  });

  it("rejects expired settlement, prior-cursor mismatch, forged cursor controls, unknown and reserved names", async () => {
    const t = makeTest();
    const lease = await runMutation(t, migrationRefs.acquireLease, {
      ...args,
      leaseOwner: "worker-a",
    });
    await expectRejectTag(
      runMutation(t, migrationRefs.acquireLease, {
        ...args,
        leaseOwner: "worker-b",
      }),
      "MigrationAlreadyRunning",
    );

    const settlementArgs = {
      ...args,
      mode: "execute" as const,
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
      countProvenance: "unavailable" as const,
    };
    await expectRejectTag(
      runMutation(t, migrationRefs.settleBatch, settlementArgs),
      "MigrationCursorInvalid",
    );
    await expectRejectTag(
      runMutation(t, migrationRefs.settleBatch, {
        ...settlementArgs,
        priorCursor: null,
        expectedFenceGeneration: lease.fenceGeneration + 1,
      }),
      "MigrationAlreadyRunning",
    );
    await expectRejectTag(
      runMutation(t, migrationRefs.settleBatch, {
        ...settlementArgs,
        priorCursor: null,
        expectedLeaseOwner: "wrong-owner",
      }),
      "MigrationAlreadyRunning",
    );
    await t.run(async (ctx) => {
      const run = expectOne(
        (await ctx.db.query("migrationRuns").collect()).find(
          (row) => row.migrationName === "probe.expand",
        ),
        "probe.expand run",
      );
      await ctx.db.patch(run._id, { leaseExpiresAt: 0 });
    });
    await expectRejectTag(
      runMutation(t, migrationRefs.settleBatch, {
        ...settlementArgs,
        priorCursor: null,
        expectedLeaseExpiresAt: 0,
      }),
      "MigrationAlreadyRunning",
    );

    await expect(
      runAction(t, migrationRefs.runRegisteredMigration, {
        ...args,
        releaseCommit: "release-b",
      }),
    ).rejects.toThrow("release/schema/deployment/build drift");
    await expect(
      runAction(t, migrationRefs.runRegisteredMigration, {
        ...args,
        schemaBefore: "sha256:other-before",
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
    await expect(
      runAction(t, migrationRefs.runRegisteredMigration, {
        ...args,
        buildId: "build-b",
      }),
    ).rejects.toThrow("release/schema/deployment/build drift");

    for (const bad of [
      [{ migrationName: "future.agencyKeys.expand" }, "MigrationNotFound"],
      [{ migrationName: "probe.contract" }, "MigrationNotFound"],
      [{ migrationName: "missing.expand" }, "MigrationNotFound"],
      [{ cursor: "forged" }, "MigrationCursorInvalid"],
      [{ reset: true }, "MigrationCursorInvalid"],
      [{ reset: false }, "MigrationCursorInvalid"],
      [{ next: ["internal/migrations:probeExpand"] }, "MigrationCursorInvalid"],
      [{ batchSize: 101 }, "MigrationCursorInvalid"],
    ] as const) {
      await expectRejectTag(
        runAction(t, migrationRefs.runRegisteredMigration, {
          ...args,
          ...bad[0],
        }),
        bad[1],
      );
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
      const run = expectOne(
        (await ctx.db.query("migrationRuns").collect()).find(
          (row) =>
            row.migrationName === "probe.expand" && row.mode === "execute",
        ),
        "execute probe.expand run",
      );
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
    const dryRunRun = expectOne(
      rows.runs.find(
        (row) => row.migrationName === "probe.expand" && row.mode === "dryRun",
      ),
      "dry-run coordinator row",
    );
    expect(dryRunRun.status).toBe("complete");
    expect(releaseParents(rows)).toHaveLength(1);
    expect(releaseParents(rows)[0]).toMatchObject({
      mode: "dryRun",
      runKey: dryRunRun.runKey,
    });
    expect(childReceipts(rows).every((row) => row.mode === "dryRun")).toBe(
      true,
    );
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
    expect(
      rows.runs.find((row) => row.migrationName === "probe.expand"),
    ).toBeUndefined();
    const failedRun = rows.runs.find(
      (row) => row.migrationName === "probe.fail",
    );
    expect(failedRun).toMatchObject({
      status: "failed",
      cursor: null,
      lastCommittedBatchSequence: 1,
    });
    const failedChild = parseChild(
      expectOne(childReceipts(rows)[0], "failed child receipt"),
    );
    expect(failedChild).toMatchObject({
      scanned: 0,
      failed: 1,
      changed: null,
      skipped: null,
      countProvenance: "unavailable",
    });
    expect(failureCheckpoints(rows)).toHaveLength(1);
    expect(
      expectOne(failureCheckpoints(rows)[0], "dry-run failure checkpoint").mode,
    ).toBe("dryRun");
    await expect(
      runAction(t, migrationRefs.runRegisteredMigration, {
        ...args,
        migrationName: "probe.fail",
        mode: "execute",
      }),
    ).rejects.toThrow("failed dry-run quarantine");
    expect(releaseParents(rows)).toHaveLength(0);
    expect(
      expectOne(
        rows.runs.find((row) => row.migrationName === "probe-target"),
        "probe target row",
      ).schemaAfter,
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
      expectOne(
        rows.runs.filter((row) => row.migrationName === "probe-target")[0],
        "probe target row",
      ).schemaAfter,
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

  it("fails closed on invalid or duplicate persisted stable tenant migration rows", async () => {
    const cases = [
      ["duplicateWorkos", stableOrgArgs],
      ["invalidAgency", stableOrgArgs],
      ["duplicateAgency", stableOrgArgs],
      ["invalidBrain", stableWorkspaceArgs],
      ["duplicateBrain", stableWorkspaceArgs],
    ] as const;

    for (const [kind, runArgs] of cases) {
      const t = makeTest();
      await t.run(async (ctx) => {
        const owner = await ctx.db.insert("users", {
          subject: `workos|${kind}`,
          email: `${kind}@example.com`,
          displayName: kind,
          status: "active",
          createdAt: 1,
          updatedAt: 1,
        });
        const other = await ctx.db.insert("users", {
          subject: `workos|${kind}-other`,
          email: `${kind}-other@example.com`,
          displayName: `${kind} other`,
          status: "active",
          createdAt: 2,
          updatedAt: 2,
        });
        const organizationId = await ctx.db.insert("organizations", {
          ownerUserId: owner,
          workosOrganizationId: `org_workos_${kind}`,
          agencyKey:
            kind === "invalidAgency"
              ? "ag_not-valid"
              : "ag_01J0000000000000000000000A",
          slug: kind,
          name: kind,
          status: "active",
          createdAt: 10,
          updatedAt: 10,
        });
        if (kind === "duplicateWorkos" || kind === "duplicateAgency") {
          await ctx.db.insert("organizations", {
            ownerUserId: other,
            ...(kind === "duplicateWorkos"
              ? { workosOrganizationId: `org_workos_${kind}` }
              : {}),
            ...(kind === "duplicateAgency"
              ? { agencyKey: "ag_01J0000000000000000000000A" }
              : {}),
            slug: `${kind}-other`,
            name: `${kind} other`,
            status: "active",
            createdAt: 11,
            updatedAt: 11,
          });
        }
        await ctx.db.insert("workspaces", {
          organizationId,
          ownerUserId: owner,
          brainKey:
            kind === "invalidBrain"
              ? "br_not-valid"
              : "br_01J0000000000000000000000A",
          slug: `${kind}-workspace`,
          name: `${kind} Workspace`,
          status: "active",
          dataClassification: "internal",
          createdAt: 20,
          updatedAt: 20,
        });
        if (kind === "duplicateBrain") {
          await ctx.db.insert("workspaces", {
            organizationId,
            ownerUserId: other,
            brainKey: "br_01J0000000000000000000000A",
            slug: `${kind}-duplicate`,
            name: `${kind} Duplicate`,
            status: "active",
            dataClassification: "internal",
            createdAt: 21,
            updatedAt: 21,
          });
        }
      });
      const before = await t.run(async (ctx) => ({
        organizations: await ctx.db.query("organizations").collect(),
        workspaces: await ctx.db.query("workspaces").collect(),
      }));
      await expectRejectTag(
        runAction(t, migrationRefs.runRegisteredMigration, runArgs),
        "MigrationBatchFailed",
      );
      const after = await t.run(async (ctx) => ({
        organizations: await ctx.db.query("organizations").collect(),
        workspaces: await ctx.db.query("workspaces").collect(),
      }));
      expect(after).toEqual(before);
      const rows = await listRows(t);
      const failedRun = expectOne(
        rows.runs.find((row) => row.migrationName === runArgs.migrationName),
        `${kind} stable tenant failed run`,
      );
      expect(failedRun.status).toBe("failed");
      expect(failureCheckpoints(rows)).toHaveLength(1);
      expect(
        parseChild(expectOne(childReceipts(rows)[0], `${kind} failed child`)),
      ).toMatchObject({
        migrationName: runArgs.migrationName,
        failed: 1,
      });
    }
  });

  it("routes stable tenant migrations through Confect refs with safe dry-run and resumable execute", async () => {
    const t = makeTest();
    await seedStableTenantTargets(t);
    const logs: string[] = [];
    const originalDebug = console.debug;
    console.debug = (...values: unknown[]) =>
      logs.push(values.map((value) => JSON.stringify(value)).join(" "));
    try {
      for (const runArgs of [stableOrgArgs, stableWorkspaceArgs] as const) {
        let dryRun = await runAction(t, migrationRefs.runRegisteredMigration, {
          ...runArgs,
          mode: "dryRun",
        });
        while (dryRun.status !== "dryRunComplete") {
          expect(dryRun.scanned).toBeLessThanOrEqual(1);
          dryRun = await runAction(t, migrationRefs.runRegisteredMigration, {
            ...runArgs,
            mode: "dryRun",
          });
        }
      }
    } finally {
      console.debug = originalDebug;
    }
    const afterDryRun = await t.run(async (ctx) => ({
      organizations: await ctx.db.query("organizations").collect(),
      workspaces: await ctx.db.query("workspaces").collect(),
    }));
    expect(
      afterDryRun.organizations.every((row) => row.agencyKey === undefined),
    ).toBe(true);
    expect(
      afterDryRun.workspaces.every((row) => row.brainKey === undefined),
    ).toBe(true);
    expect(logs.join("\n")).not.toContain("Stable One");
    expect(logs.join("\n")).not.toContain("Stable Workspace One");
    expect(logs.join("\n")).not.toContain("stable-workspace-one");
    expect(logs.join("\n")).not.toContain("before");
    expect(logs.join("\n")).not.toContain("after");

    const orgFirst = await runAction(
      t,
      migrationRefs.runRegisteredMigration,
      stableOrgArgs,
    );
    expect(orgFirst).toMatchObject({ status: "running", scanned: 1 });
    let orgSecond = await runAction(
      t,
      migrationRefs.runRegisteredMigration,
      stableOrgArgs,
    );
    for (
      let attempt = 0;
      attempt < 4 && orgSecond.status !== "complete";
      attempt += 1
    ) {
      orgSecond = await runAction(
        t,
        migrationRefs.runRegisteredMigration,
        stableOrgArgs,
      );
    }
    expect(orgSecond.status).toBe("complete");
    const orgBeforeRerun = await listRows(t);
    const orgRerun = await runAction(
      t,
      migrationRefs.runRegisteredMigration,
      stableOrgArgs,
    );
    expect(orgRerun).toEqual(orgSecond);
    expect(await listRows(t)).toEqual(orgBeforeRerun);

    const workspaceFirst = await runAction(
      t,
      migrationRefs.runRegisteredMigration,
      stableWorkspaceArgs,
    );
    expect(workspaceFirst).toMatchObject({ status: "running", scanned: 1 });
    let workspaceSecond = await runAction(
      t,
      migrationRefs.runRegisteredMigration,
      stableWorkspaceArgs,
    );
    for (
      let attempt = 0;
      attempt < 4 && workspaceSecond.status !== "complete";
      attempt += 1
    ) {
      workspaceSecond = await runAction(
        t,
        migrationRefs.runRegisteredMigration,
        stableWorkspaceArgs,
      );
    }
    expect(workspaceSecond.status).toBe("complete");
    const workspaceBeforeRerun = await listRows(t);
    const workspaceRerun = await runAction(
      t,
      migrationRefs.runRegisteredMigration,
      stableWorkspaceArgs,
    );
    expect(workspaceRerun).toEqual(workspaceSecond);
    expect(await listRows(t)).toEqual(workspaceBeforeRerun);

    const rows = await t.run(async (ctx) => ({
      organizations: await ctx.db.query("organizations").collect(),
      workspaces: await ctx.db.query("workspaces").collect(),
    }));
    for (const organization of rows.organizations) {
      expect(organization.agencyKey).toBe(
        deriveStableAgencyKey({
          _id: organization._id,
          createdAt: organization.createdAt,
          _creationTime: organization._creationTime,
        }),
      );
    }
    for (const workspace of rows.workspaces) {
      expect(workspace.brainKey).toBe(
        deriveStableBrainKey({
          _id: workspace._id,
          createdAt: workspace.createdAt,
          _creationTime: workspace._creationTime,
        }),
      );
    }
    const stableChildren = stableTenantExecuteChildren(await listRows(t));
    expect(
      stableChildren.map(
        ({ migrationName, changed, skipped, countProvenance }) => ({
          migrationName,
          changed,
          skipped,
          countProvenance,
        }),
      ),
    ).toEqual([
      {
        migrationName: "stableTenant.organizationKeys.expand",
        changed: 1,
        skipped: 0,
        countProvenance: "component",
      },
      {
        migrationName: "stableTenant.organizationKeys.expand",
        changed: 1,
        skipped: 0,
        countProvenance: "component",
      },
      {
        migrationName: "stableTenant.organizationKeys.expand",
        changed: 0,
        skipped: 0,
        countProvenance: "component",
      },
      {
        migrationName: "stableTenant.workspaceKeys.expand",
        changed: 1,
        skipped: 0,
        countProvenance: "component",
      },
      {
        migrationName: "stableTenant.workspaceKeys.expand",
        changed: 1,
        skipped: 0,
        countProvenance: "component",
      },
      {
        migrationName: "stableTenant.workspaceKeys.expand",
        changed: 0,
        skipped: 0,
        countProvenance: "component",
      },
    ]);
  });

  it("keeps migration functions internal-only through generated Confect refs", () => {
    expect(Ref.getFunctionReference(migrationRefs.probeExpand)).toBeDefined();
    expect(
      Ref.getFunctionReference(migrationRefs.runRegisteredMigration),
    ).toBeDefined();
    expect(Ref.getFunctionReference(migrationRefs.acquireLease)).toBeDefined();
    expect(Ref.getFunctionReference(migrationRefs.settleBatch)).toBeDefined();
    expect(
      Ref.getFunctionReference(
        migrationRefs.stableTenantOrganizationKeysExpand,
      ),
    ).toBeDefined();
    expect(
      Ref.getFunctionReference(migrationRefs.stableTenantWorkspaceKeysExpand),
    ).toBeDefined();
    expect("migrations" in (refs.public as object)).toBe(false);
  });
});
