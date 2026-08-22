import { DataModel, type DatabaseSchema } from "@confect/server";
import type {
  GenericDatabaseReader,
  GenericDatabaseWriter,
} from "convex/server";
import type { GenericId } from "convex/values";
import * as Effect from "effect/Effect";

import databaseSchema from "../_generated/schema";
import { MutationCtx, QueryCtx } from "../_generated/services";
import { sha256Hex } from "../shared/sha256";
import type brainPublicationPausesSource from "../tables/brainPublicationPauses";
import type brainPublicationWorkerLeasesSource from "../tables/brainPublicationWorkerLeases";

type BrainPublicationPausesTable = ReturnType<
  typeof brainPublicationPausesSource<"brainPublicationPauses">
>;
type BrainPublicationWorkerLeasesTable = ReturnType<
  typeof brainPublicationWorkerLeasesSource<"brainPublicationWorkerLeases">
>;
type PublicationWorkerControlConfectDataModel = DataModel.FromTables<
  | DatabaseSchema.Tables<typeof databaseSchema>
  | BrainPublicationPausesTable
  | BrainPublicationWorkerLeasesTable
>;
type PublicationWorkerControlDataModel =
  DataModel.ToConvex<PublicationWorkerControlConfectDataModel>;
type PublicationPauseDoc = DataModel.DocumentWithName<
  PublicationWorkerControlConfectDataModel,
  "brainPublicationPauses"
>;
type PublicationLeaseDoc = DataModel.DocumentWithName<
  PublicationWorkerControlConfectDataModel,
  "brainPublicationWorkerLeases"
>;

type PublicationScope = {
  readonly organizationKey: string;
  readonly workspaceId: GenericId<"workspaces">;
  readonly brainKey: string;
  readonly scopeKey: string;
};

export type PublicationLeaseJob = {
  readonly organizationKey: string;
  readonly workspaceId: GenericId<"workspaces">;
  readonly brainKey: string;
  readonly jobKey: string;
  readonly originKind:
    | "page"
    | "page_rebuild"
    | "slack"
    | "transcript"
    | "document"
    | "slack_rebuild"
    | "transcript_rebuild";
  readonly attemptCount: number;
  readonly authorityEnvelope?:
    { readonly connectorScopeKey?: string | undefined } | undefined;
};

const rawReader = (
  ctx:
    | Effect.Effect.Success<typeof MutationCtx>
    | Effect.Effect.Success<typeof QueryCtx>,
) =>
  ctx.db as unknown as GenericDatabaseReader<PublicationWorkerControlDataModel>;

const rawWriter = (ctx: Effect.Effect.Success<typeof MutationCtx>) =>
  ctx.db as unknown as GenericDatabaseWriter<PublicationWorkerControlDataModel>;

const stableKey = (prefix: "bpps" | "bpwl", value: unknown): string =>
  `${prefix}_${sha256Hex(JSON.stringify(value))}`;

export const publicationScopeKeyForJob = (job: PublicationLeaseJob): string =>
  job.authorityEnvelope?.connectorScopeKey ??
  (job.originKind === "page" || job.originKind === "page_rebuild"
    ? "brain-pages"
    : job.originKind === "document"
      ? "documents"
      : job.originKind === "slack" || job.originKind === "slack_rebuild"
        ? "slack"
        : "transcripts");

export const publicationPauseKey = (scope: PublicationScope): string =>
  stableKey("bpps", {
    workspaceId: String(scope.workspaceId),
    brainKey: scope.brainKey,
    scopeKey: scope.scopeKey,
  });

export const loadPublicationPauseEffect = (scope: PublicationScope) =>
  Effect.gen(function* () {
    const ctx = yield* QueryCtx;
    const pauseKey = publicationPauseKey(scope);
    const rows = yield* Effect.promise(() =>
      rawReader(ctx)
        .query("brainPublicationPauses")
        .withIndex("by_pause_key", (query) => query.eq("pauseKey", pauseKey))
        .take(2),
    );
    return { pauseKey, rows };
  });

export const loadPublicationPauseForMutationEffect = (
  scope: PublicationScope,
) =>
  Effect.gen(function* () {
    const ctx = yield* MutationCtx;
    const pauseKey = publicationPauseKey(scope);
    const rows = yield* Effect.promise(() =>
      rawReader(ctx)
        .query("brainPublicationPauses")
        .withIndex("by_pause_key", (query) => query.eq("pauseKey", pauseKey))
        .take(2),
    );
    return { pauseKey, rows };
  });

export const activePublicationLeasesEffect = (
  pauseKey: string,
  limit: number,
) =>
  Effect.gen(function* () {
    const ctx = yield* QueryCtx;
    return yield* Effect.promise(() =>
      rawReader(ctx)
        .query("brainPublicationWorkerLeases")
        .withIndex("by_pause_state_epoch", (query) =>
          query.eq("pauseKey", pauseKey).eq("state", "active"),
        )
        .take(limit),
    );
  });

export const activePublicationLeasesForMutationEffect = (
  pauseKey: string,
  limit: number,
) =>
  Effect.gen(function* () {
    const ctx = yield* MutationCtx;
    return yield* Effect.promise(() =>
      rawReader(ctx)
        .query("brainPublicationWorkerLeases")
        .withIndex("by_pause_state_epoch", (query) =>
          query.eq("pauseKey", pauseKey).eq("state", "active"),
        )
        .take(limit),
    );
  });

export type PublicationLeaseClaim =
  | {
      readonly status: "paused";
      readonly pauseKey: string;
      readonly scopeKey: string;
      readonly pauseEpoch: number;
    }
  | {
      readonly status: "claimed";
      readonly pauseKey: string;
      readonly scopeKey: string;
      readonly pauseEpoch: number;
      readonly leaseKey: string;
    }
  | {
      readonly status: "integrity_failure";
      readonly pauseKey: string;
      readonly scopeKey: string;
      readonly pauseEpoch: number;
    };

export const claimPublicationJobLeaseEffect = (input: {
  readonly job: PublicationLeaseJob;
  readonly now: number;
  readonly leaseDurationMs: number;
}): Effect.Effect<PublicationLeaseClaim, never, MutationCtx> =>
  Effect.gen(function* () {
    const ctx = yield* MutationCtx;
    const scope = {
      organizationKey: input.job.organizationKey,
      workspaceId: input.job.workspaceId,
      brainKey: input.job.brainKey,
      scopeKey: publicationScopeKeyForJob(input.job),
    };
    const { pauseKey, rows } =
      yield* loadPublicationPauseForMutationEffect(scope);
    if (rows.length > 1)
      return {
        status: "integrity_failure",
        pauseKey,
        scopeKey: scope.scopeKey,
        pauseEpoch: rows[0]?.pauseEpoch ?? 0,
      };
    const pause = rows[0];
    const pauseEpoch = pause?.pauseEpoch ?? 0;
    if (pause?.state === "paused")
      return {
        status: "paused",
        pauseKey,
        scopeKey: scope.scopeKey,
        pauseEpoch,
      };
    const active = yield* Effect.promise(() =>
      rawReader(ctx)
        .query("brainPublicationWorkerLeases")
        .withIndex("by_job_state", (query) =>
          query.eq("jobKey", input.job.jobKey).eq("state", "active"),
        )
        .take(2),
    );
    if (active.length > 1)
      return {
        status: "integrity_failure",
        pauseKey,
        scopeKey: scope.scopeKey,
        pauseEpoch,
      };
    const current = active[0];
    const currentMatchesScope =
      current !== undefined &&
      current.organizationKey === scope.organizationKey &&
      current.workspaceId === scope.workspaceId &&
      current.brainKey === scope.brainKey &&
      current.scopeKey === scope.scopeKey &&
      current.pauseKey === pauseKey &&
      current.jobKey === input.job.jobKey;
    if (current !== undefined && !currentMatchesScope)
      return {
        status: "integrity_failure",
        pauseKey,
        scopeKey: scope.scopeKey,
        pauseEpoch,
      };
    if (
      current !== undefined &&
      currentMatchesScope &&
      current.pauseEpoch === pauseEpoch &&
      current.expiresAt > input.now
    )
      return {
        status: "claimed",
        pauseKey,
        scopeKey: scope.scopeKey,
        pauseEpoch,
        leaseKey: current.leaseKey,
      };
    if (current !== undefined)
      yield* Effect.promise(() =>
        rawWriter(ctx).patch(current._id, {
          state: "abandoned",
          releasedAt: input.now,
          releaseReason:
            current.expiresAt <= input.now ? "expired" : "superseded",
          updatedAt: input.now,
        }),
      );
    const leaseKey = stableKey("bpwl", {
      jobKey: input.job.jobKey,
      pauseEpoch,
      attemptCount: input.job.attemptCount,
      claimedAt: input.now,
    });
    const existing = yield* Effect.promise(() =>
      rawReader(ctx)
        .query("brainPublicationWorkerLeases")
        .withIndex("by_lease_key", (query) => query.eq("leaseKey", leaseKey))
        .take(2),
    );
    if (existing.length > 1)
      return {
        status: "integrity_failure",
        pauseKey,
        scopeKey: scope.scopeKey,
        pauseEpoch,
      };
    const deterministic = existing[0];
    if (
      deterministic !== undefined &&
      (deterministic.organizationKey !== scope.organizationKey ||
        deterministic.workspaceId !== scope.workspaceId ||
        deterministic.brainKey !== scope.brainKey ||
        deterministic.scopeKey !== scope.scopeKey ||
        deterministic.pauseKey !== pauseKey ||
        deterministic.jobKey !== input.job.jobKey ||
        deterministic.pauseEpoch !== pauseEpoch ||
        deterministic.state !== "active" ||
        deterministic.expiresAt <= input.now)
    )
      return {
        status: "integrity_failure",
        pauseKey,
        scopeKey: scope.scopeKey,
        pauseEpoch,
      };
    if (deterministic === undefined)
      yield* Effect.promise(() =>
        rawWriter(ctx).insert("brainPublicationWorkerLeases", {
          schemaVersion: 1,
          organizationKey: input.job.organizationKey,
          workspaceId: input.job.workspaceId,
          brainKey: input.job.brainKey,
          scopeKey: scope.scopeKey,
          pauseKey,
          leaseKey,
          jobKey: input.job.jobKey,
          pauseEpoch,
          state: "active",
          claimedAt: input.now,
          expiresAt: input.now + Math.max(1, input.leaseDurationMs),
          releasedAt: null,
          releaseReason: null,
          updatedAt: input.now,
        }),
      );
    return {
      status: "claimed",
      pauseKey,
      scopeKey: scope.scopeKey,
      pauseEpoch,
      leaseKey,
    };
  });

export const activatePublicationJobLeaseEffect = (input: {
  readonly job: PublicationLeaseJob;
  readonly leaseKey: string;
  readonly expectedPauseEpoch: number;
  readonly now: number;
}): Effect.Effect<boolean, never, MutationCtx> =>
  Effect.gen(function* () {
    const ctx = yield* MutationCtx;
    const leases = yield* Effect.promise(() =>
      rawReader(ctx)
        .query("brainPublicationWorkerLeases")
        .withIndex("by_lease_key", (query) =>
          query.eq("leaseKey", input.leaseKey),
        )
        .take(2),
    );
    const lease = leases[0];
    if (leases.length !== 1 || lease === undefined || lease.state !== "active")
      return false;
    const scope = {
      organizationKey: input.job.organizationKey,
      workspaceId: input.job.workspaceId,
      brainKey: input.job.brainKey,
      scopeKey: publicationScopeKeyForJob(input.job),
    };
    const expectedPauseKey = publicationPauseKey(scope);
    if (
      lease.organizationKey !== scope.organizationKey ||
      lease.workspaceId !== scope.workspaceId ||
      lease.brainKey !== scope.brainKey ||
      lease.scopeKey !== scope.scopeKey ||
      lease.pauseKey !== expectedPauseKey ||
      lease.jobKey !== input.job.jobKey
    )
      return false;
    const pauses = yield* Effect.promise(() =>
      rawReader(ctx)
        .query("brainPublicationPauses")
        .withIndex("by_pause_key", (query) =>
          query.eq("pauseKey", lease.pauseKey),
        )
        .take(2),
    );
    const pause = pauses[0];
    const currentEpoch = pause?.pauseEpoch ?? 0;
    const valid =
      pauses.length <= 1 &&
      (pause === undefined ||
        (pause.organizationKey === scope.organizationKey &&
          pause.workspaceId === scope.workspaceId &&
          pause.brainKey === scope.brainKey &&
          pause.scopeKey === scope.scopeKey &&
          pause.pauseKey === expectedPauseKey)) &&
      pause?.state !== "paused" &&
      lease.pauseEpoch === input.expectedPauseEpoch &&
      currentEpoch === input.expectedPauseEpoch &&
      lease.expiresAt > input.now;
    if (valid) return true;
    yield* Effect.promise(() =>
      rawWriter(ctx).patch(lease._id, {
        state: "abandoned",
        releasedAt: input.now,
        releaseReason:
          lease.expiresAt <= input.now
            ? "expired"
            : pause?.state === "paused"
              ? "paused"
              : "superseded",
        updatedAt: input.now,
      }),
    );
    return false;
  });

export const releasePublicationJobLeaseEffect = (input: {
  readonly leaseKey: string;
  readonly now: number;
}) =>
  Effect.gen(function* () {
    const ctx = yield* MutationCtx;
    const leases = yield* Effect.promise(() =>
      rawReader(ctx)
        .query("brainPublicationWorkerLeases")
        .withIndex("by_lease_key", (query) =>
          query.eq("leaseKey", input.leaseKey),
        )
        .take(2),
    );
    const lease = leases[0];
    if (leases.length !== 1 || lease === undefined || lease.state !== "active")
      return;
    yield* Effect.promise(() =>
      rawWriter(ctx).patch(lease._id, {
        state: "released",
        releasedAt: input.now,
        releaseReason: "completed",
        updatedAt: input.now,
      }),
    );
  });

export type { PublicationLeaseDoc, PublicationPauseDoc, PublicationScope };
