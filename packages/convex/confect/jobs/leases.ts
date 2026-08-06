import * as Either from "effect/Either";
import {
  type DuplicateEffect,
  type LeaseLost,
  type SourceJobState,
  assertCurrentLease,
  startSourceJob,
} from "./jobState";

const terminalStatuses: ReadonlySet<SourceJobState["executionStatus"]> =
  new Set(["succeeded", "dead_letter", "superseded", "revoked", "cancelled"]);

export const isLeaseExpired = (job: SourceJobState, now: number): boolean =>
  !terminalStatuses.has(job.executionStatus) &&
  ((job.leaseExpiresAt !== undefined && job.leaseExpiresAt < now) ||
    (job.executionStatus === "retry_wait" && job.nextRetryAt <= now));

export const heartbeatLease = (
  job: SourceJobState,
  input: {
    readonly leaseGeneration: number;
    readonly leaseToken: string;
    readonly leaseDurationMs: number;
    readonly now: number;
  },
): Either.Either<SourceJobState, LeaseLost> => {
  const lease = assertCurrentLease(job, input);
  if (Either.isLeft(lease)) return Either.left(lease.left);
  return Either.right({
    ...job,
    leaseExpiresAt: input.now + input.leaseDurationMs,
    updatedAt: input.now,
  });
};

export const reclaimExpiredLease = (
  job: SourceJobState,
  input: {
    readonly owner: string;
    readonly leaseToken: string;
    readonly leaseDurationMs: number;
    readonly now: number;
  },
): Either.Either<SourceJobState, DuplicateEffect | LeaseLost> => {
  if (!isLeaseExpired(job, input.now)) {
    return Either.right(job);
  }
  return startSourceJob(
    {
      ...job,
      executionStatus: "queued",
      leaseToken: undefined,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
    },
    input,
  );
};
