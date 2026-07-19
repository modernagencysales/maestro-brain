import * as Either from "effect/Either";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  DuplicateEffect,
  LeaseLost,
  MaxAttemptsReached,
  PermanentJobFailure,
  RetryableJobFailure,
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
      unwrapJob(failSourceJob(leased, { kind: "cancelled", now: now + 100 })),
    ).toMatchObject({ executionStatus: "cancelled" });
    expect(
      unwrapJob(failSourceJob(leased, { kind: "revoked", now: now + 100 })),
    ).toMatchObject({ executionStatus: "revoked" });
    expect(
      unwrapJob(failSourceJob(leased, { kind: "superseded", now: now + 100 })),
    ).toMatchObject({ executionStatus: "superseded" });
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
