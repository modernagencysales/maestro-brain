import * as Either from "effect/Either";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  DuplicateEffect,
  LeaseLost,
  MaxAttemptsReached,
  PermanentJobFailure,
  RetryableJobFailure,
  SourceWorkpoolError,
  StaleGeneration,
  createSourceJobState,
  failSourceJob,
  markSourceJobRunning,
  recordExternalResponse,
  scheduleRetry,
  startSourceJob,
  succeedSourceJob,
} from "../confect/jobs/jobState";
import {
  heartbeatLease,
  isLeaseExpired,
  reclaimExpiredLease,
} from "../confect/jobs/leases";
import {
  completeSourceJobHandler,
  enqueueSourceJobHandler,
  failSourceJobHandler,
  heartbeatSourceJobHandler,
  reclaimSourceJobHandler,
  statusSourceJobHandler,
} from "../confect/jobs/workpool";
import workpoolSpec from "../confect/jobs/workpool.spec";
import { SourceProcessingJobRow } from "../confect/tables/sourceProcessingJobs";

const now = 1_800_000_000_000;
const queuedJob = () =>
  createSourceJobState({
    organizationKey: "org_1",
    unitKey: "slack:channel:C1:message:1700000000.000100",
    stage: "assembled",
    effectKey: "effect:source-unit-1",
    policyGeneration: 1,
    routeGeneration: 2,
    lifecycleGeneration: 3,
    emergencyGeneration: 4,
    maxAttempts: 3,
    now,
  });
const unwrapJob = <E>(result: Either.Either<ReturnType<typeof queuedJob>, E>) =>
  Either.getOrThrow(result);
const claim = (leaseDurationMs = 30_000) =>
  unwrapJob(
    startSourceJob(queuedJob(), {
      owner: "worker-a",
      leaseToken: "lease-a",
      leaseDurationMs,
      now,
    }),
  );
const completion = (job = claim()) => ({
  leaseGeneration: job.leaseGeneration,
  leaseToken: job.leaseToken ?? "missing",
  effectKey: job.effectKey,
  policyGeneration: job.policyGeneration,
  routeGeneration: job.routeGeneration,
  lifecycleGeneration: job.lifecycleGeneration,
  emergencyGeneration: job.emergencyGeneration,
  now: now + 300,
});

type TestRow = ReturnType<typeof queuedJob> & { readonly _id: string };
const jobArgs = {
  organizationKey: "org_1",
  unitKey: "slack:channel:C1:message:1700000000.000100",
  stage: "assembled" as const,
  effectKey: "effect:source-unit-1",
  policyGeneration: 1,
  routeGeneration: 2,
  lifecycleGeneration: 3,
  emergencyGeneration: 4,
  idempotencyKey: "idem-1",
};
const makeDb = () => {
  const rows: TestRow[] = [];
  const patches: Partial<TestRow>[] = [];
  return {
    get row() {
      return rows.at(-1) ?? null;
    },
    get rows() {
      return rows;
    },
    patches,
    db: {
      query: () => ({
        withIndex: (
          _index: string,
          filter: (q: {
            eq: (field: string, value: string) => unknown;
          }) => unknown,
        ) => {
          const filters: Record<string, string> = {};
          const q = {
            eq: (field: string, value: string) => {
              filters[field] = value;
              return q;
            },
          };
          filter(q);
          return {
            unique: async () =>
              rows.find((candidate) =>
                Object.entries(filters).every(
                  ([field, value]) =>
                    candidate[field as keyof TestRow] === value,
                ),
              ) ?? null,
          };
        },
      }),
      insert: async (_table: string, value: ReturnType<typeof queuedJob>) => {
        const row = { ...value, _id: `sourceJob:${rows.length + 1}` };
        rows.push(row);
        return row._id;
      },
      get: async (id: string) =>
        rows.find((candidate) => candidate._id === id) ?? null,
      patch: async (id: string, patch: Partial<TestRow>) => {
        const index = rows.findIndex((candidate) => candidate._id === id);
        if (index === -1) throw new Error("missing row");
        patches.push(patch);
        rows[index] = { ...(rows[index] as TestRow), ...patch };
      },
    },
  };
};

describe("source workpool job state", () => {
  it("claims queued work with opaque lease fencing", () => {
    expect(claim()).toMatchObject({
      executionStatus: "leased",
      leaseGeneration: 1,
      leaseToken: "lease-a",
      leaseOwner: "worker-a",
      leaseExpiresAt: now + 30_000,
      attempt: 1,
    });
  });

  it("heartbeats only the current lease token", () => {
    const claimed = claim();
    const staleHeartbeat = heartbeatLease(claimed, {
      leaseGeneration: 1,
      leaseToken: "stale-token",
      leaseDurationMs: 30_000,
      now: now + 1_000,
    });
    expect(Either.isLeft(staleHeartbeat)).toBe(true);
    if (Either.isLeft(staleHeartbeat))
      expect(staleHeartbeat.left).toBeInstanceOf(LeaseLost);
    expect(
      unwrapJob(
        heartbeatLease(claimed, {
          leaseGeneration: 1,
          leaseToken: "lease-a",
          leaseDurationMs: 30_000,
          now: now + 1_000,
        }),
      ).leaseExpiresAt,
    ).toBe(now + 31_000);
  });

  it("reclaims expired leases with a new generation", () => {
    const claimed = claim(10_000);
    expect(isLeaseExpired(claimed, now + 9_999)).toBe(false);
    expect(isLeaseExpired(claimed, now + 10_001)).toBe(true);
    expect(
      unwrapJob(
        reclaimExpiredLease(claimed, {
          owner: "worker-b",
          leaseToken: "lease-b",
          leaseDurationMs: 20_000,
          now: now + 10_001,
        }),
      ),
    ).toMatchObject({
      executionStatus: "leased",
      leaseGeneration: 2,
      leaseToken: "lease-b",
      attempt: 2,
    });
  });

  it("rejects stale worker completion after a lease is reclaimed", () => {
    const reclaimed = unwrapJob(
      reclaimExpiredLease(claim(10_000), {
        owner: "worker-b",
        leaseToken: "lease-b",
        leaseDurationMs: 20_000,
        now: now + 10_001,
      }),
    );
    const staleCompletion = succeedSourceJob(reclaimed, {
      ...completion(reclaimed),
      leaseGeneration: 1,
      leaseToken: "lease-a",
    });
    expect(Either.isLeft(staleCompletion)).toBe(true);
    if (Either.isLeft(staleCompletion))
      expect(staleCompletion.left).toBeInstanceOf(LeaseLost);
  });

  it("persists external response hashes before accepting one effect", () => {
    const running = unwrapJob(
      markSourceJobRunning(claim(), {
        leaseGeneration: 1,
        leaseToken: "lease-a",
        now: now + 100,
      }),
    );
    const withResponse = unwrapJob(
      recordExternalResponse(running, {
        leaseGeneration: 1,
        leaseToken: "lease-a",
        responseHash: "sha256:external-response",
        now: now + 200,
      }),
    );
    expect(
      unwrapJob(succeedSourceJob(withResponse, completion(withResponse))),
    ).toMatchObject({
      executionStatus: "succeeded",
      acceptedEffectKey: "effect:source-unit-1",
      externalResponseHash: "sha256:external-response",
    });
  });

  it("rejects duplicate effects even after an external response", () => {
    const running = unwrapJob(
      markSourceJobRunning(claim(), {
        leaseGeneration: 1,
        leaseToken: "lease-a",
        now: now + 100,
      }),
    );
    const withAcceptedEffect = {
      ...unwrapJob(
        recordExternalResponse(running, {
          leaseGeneration: 1,
          leaseToken: "lease-a",
          responseHash: "sha256:external-response",
          now: now + 200,
        }),
      ),
      acceptedEffectKey: running.effectKey,
    };
    const duplicate = succeedSourceJob(
      withAcceptedEffect,
      completion(withAcceptedEffect),
    );
    expect(Either.isLeft(duplicate)).toBe(true);
    if (Either.isLeft(duplicate))
      expect(duplicate.left).toBeInstanceOf(DuplicateEffect);
  });

  it("fences stale policy, route, lifecycle, and emergency generations", () => {
    const running = unwrapJob(
      markSourceJobRunning(claim(), {
        leaseGeneration: 1,
        leaseToken: "lease-a",
        now: now + 100,
      }),
    );
    const staleGeneration = succeedSourceJob(running, {
      ...completion(running),
      policyGeneration: 999,
    });
    expect(Either.isLeft(staleGeneration)).toBe(true);
    if (Either.isLeft(staleGeneration))
      expect(staleGeneration.left).toBeInstanceOf(StaleGeneration);
  });

  it("records retryable, permanent, max-attempt, cancellation, revoked, and superseded states", () => {
    const leased = claim();
    expect(
      unwrapJob(
        scheduleRetry(leased, {
          leaseGeneration: 1,
          leaseToken: "lease-a",
          reason: "429 retry-after",
          retryAfterMs: 60_000,
          now: now + 100,
        }),
      ),
    ).toMatchObject({
      executionStatus: "retry_wait",
      lastError: { tag: "RetryableJobFailure" },
      nextRetryAt: now + 60_100,
    });
    expect(
      unwrapJob(
        failSourceJob(leased, {
          leaseGeneration: 1,
          leaseToken: "lease-a",
          kind: "permanent",
          reason: "invalid source unit",
          now: now + 100,
        }),
      ),
    ).toMatchObject({
      executionStatus: "dead_letter",
      lastError: { tag: "PermanentJobFailure" },
    });
    expect(
      unwrapJob(
        failSourceJob(
          { ...leased, attempt: 3 },
          {
            leaseGeneration: 1,
            leaseToken: "lease-a",
            kind: "retryable",
            reason: "poison channel",
            now: now + 100,
          },
        ),
      ),
    ).toMatchObject({
      executionStatus: "dead_letter",
      lastError: { tag: "MaxAttemptsReached" },
    });
    expect(() => {
      throw new RetryableJobFailure({ reason: "temporary" });
    }).toThrow(RetryableJobFailure);
    expect(() => {
      throw new PermanentJobFailure({ reason: "permanent" });
    }).toThrow(PermanentJobFailure);
    expect(() => {
      throw new MaxAttemptsReached({ reason: "max attempts reached" });
    }).toThrow(MaxAttemptsReached);
    expect(
      unwrapJob(
        failSourceJob(leased, {
          leaseGeneration: 1,
          leaseToken: "lease-a",
          kind: "cancelled",
          now: now + 100,
        }),
      ),
    ).toMatchObject({ executionStatus: "cancelled" });
    expect(
      unwrapJob(
        failSourceJob(leased, {
          leaseGeneration: 1,
          leaseToken: "lease-a",
          kind: "revoked",
          now: now + 100,
        }),
      ),
    ).toMatchObject({ executionStatus: "revoked" });
    expect(
      unwrapJob(
        failSourceJob(leased, {
          leaseGeneration: 1,
          leaseToken: "lease-a",
          kind: "superseded",
          now: now + 100,
        }),
      ),
    ).toMatchObject({ executionStatus: "superseded" });
  });

  it("declares typed source workpool failures as encodable public-safe tags", () => {
    const encoded = [
      new LeaseLost({ reason: "lost" }),
      new RetryableJobFailure({ reason: "temporary" }),
      new PermanentJobFailure({ reason: "permanent" }),
      new MaxAttemptsReached({ reason: "max" }),
      new StaleGeneration({ generation: "emergencyGeneration" }),
      new DuplicateEffect({ effectKey: "effect:source-unit-1" }),
    ].map((error) => Schema.encodeSync(SourceWorkpoolError)(error));

    expect(encoded.map((error) => error._tag)).toEqual([
      "LeaseLost",
      "RetryableJobFailure",
      "PermanentJobFailure",
      "MaxAttemptsReached",
      "StaleGeneration",
      "DuplicateEffect",
    ]);
    expect(JSON.stringify(encoded)).not.toContain("lease-a");
  });

  it("adds internal source job controls beside legacy demo refs", () => {
    expect(workpoolSpec.functions.enqueueSourceJob).toMatchObject({
      name: "enqueueSourceJob",
      functionVisibility: "internal",
    });
    expect(workpoolSpec.functions.statusSourceJob).toMatchObject({
      name: "statusSourceJob",
      functionVisibility: "internal",
    });
    expect(workpoolSpec.functions.heartbeatSourceJob).toMatchObject({
      name: "heartbeatSourceJob",
      functionVisibility: "internal",
    });
    expect(workpoolSpec.functions.reclaimSourceJob).toMatchObject({
      name: "reclaimSourceJob",
      functionVisibility: "internal",
    });
    expect(workpoolSpec.functions.failSourceJobControl).toMatchObject({
      name: "failSourceJobControl",
      functionVisibility: "internal",
    });
  });

  it("claims before enqueueing durable background work", async () => {
    const store = makeDb();
    const enqueued: unknown[] = [];
    const workId = await enqueueSourceJobHandler(
      { db: store.db as never },
      jobArgs,
      {
        enqueueAction: async (_ctx, _ref, args) => {
          enqueued.push(args);
          return "work-1" as never;
        },
        status: async () => ({ state: "pending", previousAttempts: 0 }),
      },
      now,
    );
    expect(workId).toBe("work-1");
    expect(store.row).toMatchObject({
      executionStatus: "leased",
      leaseGeneration: 1,
      workId: "work-1",
    });
    expect(enqueued[0]).toMatchObject({ leaseGeneration: 1 });
    expect(store.row?.leaseToken).toMatch(/^lease:1:[0-9a-f-]{36}$/);
    expect(store.row?.leaseToken).not.toContain(jobArgs.organizationKey);
    expect(store.row?.leaseToken).not.toContain(jobArgs.unitKey);
    expect(enqueued[0]).toMatchObject({ leaseToken: store.row?.leaseToken });
    expect(store.patches[0]).toMatchObject({ executionStatus: "leased" });
  });

  it("recovers after external response is persisted before commit", async () => {
    const store = makeDb();
    let enqueuedContext: Record<string, unknown> | undefined;
    await enqueueSourceJobHandler(
      { db: store.db as never },
      jobArgs,
      {
        enqueueAction: async (_ctx, _ref, args) => {
          enqueuedContext = args;
          return "work-1" as never;
        },
        status: async () => ({ state: "pending", previousAttempts: 0 }),
      },
      now,
    );
    await completeSourceJobHandler(
      { db: store.db as never },
      { workId: "work-1", context: enqueuedContext } as never,
      now + 500,
      { stopAfterExternalResponse: true },
    );
    expect(store.row).toMatchObject({
      executionStatus: "running",
      externalResponseHash: "sha256:workpool:work-1",
    });
    expect(store.row?.acceptedEffectKey).toBeUndefined();
    await completeSourceJobHandler(
      { db: store.db as never },
      { workId: "work-1", context: enqueuedContext } as never,
      now + 600,
    );
    expect(store.row).toMatchObject({
      executionStatus: "succeeded",
      acceptedEffectKey: "effect:source-unit-1",
      externalResponseHash: "sha256:workpool:work-1",
    });
  });

  it("commits completion only for the claimed lease context", async () => {
    const store = makeDb();
    let enqueuedContext: Record<string, unknown> | undefined;
    await enqueueSourceJobHandler(
      { db: store.db as never },
      jobArgs,
      {
        enqueueAction: async (_ctx, _ref, args) => {
          enqueuedContext = args;
          return "work-1" as never;
        },
        status: async () => ({ state: "pending", previousAttempts: 0 }),
      },
      now,
    );
    await completeSourceJobHandler(
      { db: store.db as never },
      { workId: "work-1", context: enqueuedContext } as never,
      now + 500,
    );
    expect(store.row).toMatchObject({
      executionStatus: "succeeded",
      acceptedEffectKey: "effect:source-unit-1",
      externalResponseHash: "sha256:workpool:work-1",
    });
    const responsePatchIndex = store.patches.findIndex(
      (patch) => patch.externalResponseHash === "sha256:workpool:work-1",
    );
    const successPatchIndex = store.patches.findIndex(
      (patch) => patch.executionStatus === "succeeded",
    );
    expect(responsePatchIndex).toBeGreaterThan(-1);
    expect(successPatchIndex).toBeGreaterThan(responsePatchIndex);
  });

  it("rejects stale worker completion through the durable handler", async () => {
    const store = makeDb();
    await enqueueSourceJobHandler(
      { db: store.db as never },
      jobArgs,
      {
        enqueueAction: async () => "work-1" as never,
        status: async () => ({ state: "pending", previousAttempts: 0 }),
      },
      now,
    );
    await expect(
      completeSourceJobHandler(
        { db: store.db as never },
        {
          workId: "work-stale",
          context: { ...jobArgs, leaseGeneration: 999, leaseToken: "stale" },
        } as never,
        now + 500,
      ),
    ).rejects.toBeInstanceOf(LeaseLost);
    expect(store.row?.acceptedEffectKey).toBeUndefined();
  });

  it("reclaims expired durable leases and fences the stale worker", async () => {
    const store = makeDb();
    let staleContext: Record<string, unknown> | undefined;
    await enqueueSourceJobHandler(
      { db: store.db as never },
      jobArgs,
      {
        enqueueAction: async (_ctx, _ref, args) => {
          staleContext = args;
          return "work-1" as never;
        },
        status: async () => ({ state: "pending", previousAttempts: 0 }),
      },
      now,
    );
    const reclaimed = await reclaimSourceJobHandler(
      { db: store.db as never },
      jobArgs,
      { owner: "worker-b", leaseToken: "lease-b", leaseDurationMs: 30_000 },
      now + 31_000,
    );
    expect(reclaimed).toMatchObject({
      executionStatus: "leased",
      leaseGeneration: 2,
      leaseToken: "lease-b",
    });
    await expect(
      completeSourceJobHandler(
        { db: store.db as never },
        { workId: "work-1", context: staleContext } as never,
        now + 31_500,
      ),
    ).rejects.toBeInstanceOf(LeaseLost);
    expect(store.row?.acceptedEffectKey).toBeUndefined();
  });

  it("rejects stale generation failure controls before retry or tombstone transitions", async () => {
    const store = makeDb();
    let context: Record<string, unknown> | undefined;
    await enqueueSourceJobHandler(
      { db: store.db as never },
      jobArgs,
      {
        enqueueAction: async (_ctx, _ref, args) => {
          context = args;
          return "work-1" as never;
        },
        status: async () => ({ state: "pending", previousAttempts: 0 }),
      },
      now,
    );
    await store.db.patch("sourceJob:1", { emergencyGeneration: 5 });

    await expect(
      failSourceJobHandler(
        { db: store.db as never },
        {
          ...context,
          kind: "retryable",
          reason: "stale emergency",
          retryAfterMs: 60_000,
        } as never,
        now + 100,
      ),
    ).rejects.toBeInstanceOf(StaleGeneration);
    await expect(
      failSourceJobHandler(
        { db: store.db as never },
        { ...context, kind: "cancelled" } as never,
        now + 200,
      ),
    ).rejects.toBeInstanceOf(StaleGeneration);
    expect(store.row).toMatchObject({
      executionStatus: "leased",
      emergencyGeneration: 5,
    });
  });

  it("persists retryable, permanent, and max-attempt failures through handlers", async () => {
    const store = makeDb();
    let context: Record<string, unknown> | undefined;
    await enqueueSourceJobHandler(
      { db: store.db as never },
      jobArgs,
      {
        enqueueAction: async (_ctx, _ref, args) => {
          context = args;
          return "work-1" as never;
        },
        status: async () => ({ state: "pending", previousAttempts: 0 }),
      },
      now,
    );
    await failSourceJobHandler(
      { db: store.db as never },
      {
        ...context,
        kind: "retryable",
        reason: "429",
        retryAfterMs: 60_000,
      } as never,
      now + 100,
    );
    expect(store.row).toMatchObject({
      executionStatus: "retry_wait",
      lastError: { tag: "RetryableJobFailure" },
    });
    await reclaimSourceJobHandler(
      { db: store.db as never },
      jobArgs,
      { owner: "worker-b", leaseToken: "lease-b", leaseDurationMs: 30_000 },
      now + 60_101,
    );
    await failSourceJobHandler(
      { db: store.db as never },
      {
        ...jobArgs,
        leaseGeneration: 2,
        leaseToken: "lease-b",
        kind: "permanent",
        reason: "invalid unit",
      } as never,
      now + 60_200,
    );
    expect(store.row).toMatchObject({
      executionStatus: "dead_letter",
      lastError: { tag: "PermanentJobFailure" },
    });
  });

  it("heartbeats durable source jobs only for the current lease", async () => {
    const store = makeDb();
    let context: Record<string, unknown> | undefined;
    await enqueueSourceJobHandler(
      { db: store.db as never },
      jobArgs,
      {
        enqueueAction: async (_ctx, _ref, args) => {
          context = args;
          return "work-1" as never;
        },
        status: async () => ({ state: "pending", previousAttempts: 0 }),
      },
      now,
    );
    await expect(
      heartbeatSourceJobHandler(
        { db: store.db as never },
        { ...context, leaseToken: "stale", leaseDurationMs: 30_000 } as never,
        now + 100,
      ),
    ).rejects.toBeInstanceOf(LeaseLost);
    expect(
      await heartbeatSourceJobHandler(
        { db: store.db as never },
        { ...context, leaseDurationMs: 30_000 } as never,
        now + 100,
      ),
    ).toMatchObject({ executionStatus: "leased", leaseGeneration: 1 });
    expect(store.row?.leaseExpiresAt).toBe(now + 30_100);
  });

  it("surfaces source job execution status instead of only component status", async () => {
    const store = makeDb();
    await enqueueSourceJobHandler(
      { db: store.db as never },
      jobArgs,
      {
        enqueueAction: async () => "work-1" as never,
        status: async () => ({ state: "pending", previousAttempts: 0 }),
      },
      now,
    );
    expect(
      await statusSourceJobHandler({ db: store.db as never }, jobArgs),
    ).toMatchObject({
      executionStatus: "leased",
      leaseGeneration: 1,
      workId: "work-1",
    });
  });

  it("rejects same idempotency with a different effect key before enqueueing twice", async () => {
    const store = makeDb();
    let enqueueCount = 0;
    const workpool = {
      enqueueAction: async () => {
        enqueueCount += 1;
        return `work-${enqueueCount}` as never;
      },
      status: async () => ({ state: "pending", previousAttempts: 0 }),
    };
    await enqueueSourceJobHandler(
      { db: store.db as never },
      jobArgs,
      workpool,
      now,
    );

    await expect(
      enqueueSourceJobHandler(
        { db: store.db as never },
        { ...jobArgs, effectKey: "effect:source-unit-2" },
        workpool,
        now + 1,
      ),
    ).rejects.toBeInstanceOf(DuplicateEffect);
    expect(enqueueCount).toBe(1);
    expect(store.rows).toHaveLength(1);
  });

  it("replays duplicate enqueue without creating a second external call", async () => {
    const store = makeDb();
    let enqueueCount = 0;
    const workpool = {
      enqueueAction: async () => {
        enqueueCount += 1;
        return `work-${enqueueCount}` as never;
      },
      status: async () => ({ state: "pending", previousAttempts: 0 }),
    };
    await enqueueSourceJobHandler(
      { db: store.db as never },
      jobArgs,
      workpool,
      now,
    );
    const replay = await enqueueSourceJobHandler(
      { db: store.db as never },
      jobArgs,
      workpool,
      now + 1,
    );
    expect(replay).toBe("work-1");
    expect(enqueueCount).toBe(1);
  });

  it("does not steal an active claim or enqueue again before workId is patched", async () => {
    const store = makeDb();
    let enqueueCount = 0;
    const workpool = {
      enqueueAction: async () => {
        enqueueCount += 1;
        if (enqueueCount === 1) throw new Error("crash before workId patch");
        return `work-${enqueueCount}` as never;
      },
      status: async () => ({ state: "pending", previousAttempts: 0 }),
    };
    await expect(
      enqueueSourceJobHandler(
        { db: store.db as never },
        jobArgs,
        workpool,
        now,
      ),
    ).rejects.toThrow("crash before workId patch");
    expect(store.row).toMatchObject({
      executionStatus: "leased",
      leaseGeneration: 1,
    });
    expect(store.row).not.toHaveProperty("workId");

    await expect(
      enqueueSourceJobHandler(
        { db: store.db as never },
        jobArgs,
        workpool,
        now + 1,
      ),
    ).rejects.toBeInstanceOf(LeaseLost);
    expect(store.row).toMatchObject({
      executionStatus: "leased",
      leaseGeneration: 1,
    });
    expect(store.row).not.toHaveProperty("workId");
    expect(enqueueCount).toBe(1);
  });

  it("treats duplicate completion delivery before ACK as one accepted effect", async () => {
    const store = makeDb();
    let context: Record<string, unknown> | undefined;
    await enqueueSourceJobHandler(
      { db: store.db as never },
      jobArgs,
      {
        enqueueAction: async (_ctx, _ref, args) => {
          context = args;
          return "work-1" as never;
        },
        status: async () => ({ state: "pending", previousAttempts: 0 }),
      },
      now,
    );
    await completeSourceJobHandler(
      { db: store.db as never },
      { workId: "work-1", context } as never,
      now + 500,
    );
    await completeSourceJobHandler(
      { db: store.db as never },
      { workId: "work-1", context } as never,
      now + 600,
    );

    expect(store.row).toMatchObject({
      executionStatus: "succeeded",
      acceptedEffectKey: "effect:source-unit-1",
    });
    expect(
      store.patches.filter((patch) => patch.executionStatus === "succeeded"),
    ).toHaveLength(1);
    expect(
      store.row?.attemptReceipts.filter(
        (receipt) => receipt.acceptedEffectKey === "effect:source-unit-1",
      ),
    ).toHaveLength(1);
  });

  it("preserves generated public workpool refs beside internal source controls", () => {
    expect(workpoolSpec.functions.enqueue).toMatchObject({
      name: "enqueue",
      functionVisibility: "public",
    });
    expect(workpoolSpec.functions.status).toMatchObject({
      name: "status",
      functionVisibility: "public",
    });
  });

  it("keeps sourceProcessingJobs row schema fenced for Confect", () => {
    expect(
      Schema.decodeUnknownSync(SourceProcessingJobRow)(queuedJob()),
    ).toMatchObject({
      schemaVersion: 1,
      executionStatus: "queued",
      stage: "assembled",
      leaseGeneration: 0,
      attemptReceipts: [],
    });
  });
});
