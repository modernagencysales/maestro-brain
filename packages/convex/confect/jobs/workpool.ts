import {
  type WorkId,
  Workpool,
  vOnCompleteArgs,
  vWorkId,
} from "@convex-dev/workpool";
import {
  type FunctionReference,
  internalActionGeneric,
  internalMutationGeneric,
  makeFunctionReference,
  mutationGeneric,
  queryGeneric,
} from "convex/server";
import { type Infer, v } from "convex/values";
import { workpoolComponent } from "./componentRefs";

const pool = new Workpool(workpoolComponent, {
  maxParallelism: 3,
  retryActionsByDefault: true,
  defaultRetryBehavior: {
    maxAttempts: 3,
    initialBackoffMs: 250,
    base: 2,
  },
});

const backgroundWorkRef = makeFunctionReference<
  "action",
  Record<string, never>,
  null
>("jobs/workpool:backgroundWork") as unknown as FunctionReference<
  "action",
  "internal",
  Record<string, never>,
  null
>;

const onCompleteArgs = vOnCompleteArgs(v.null());
type OnCompleteArgs = Infer<typeof onCompleteArgs>;

const onCompleteRef = makeFunctionReference<"mutation", OnCompleteArgs, null>(
  "jobs/workpool:onComplete",
) as unknown as FunctionReference<"mutation", "internal", OnCompleteArgs, null>;

export const enqueue = mutationGeneric({
  args: {},
  returns: vWorkId,
  handler: async (ctx): Promise<WorkId> =>
    await pool.enqueueAction(
      ctx,
      backgroundWorkRef,
      {},
      {
        onComplete: onCompleteRef,
        context: null,
      },
    ),
});

export const status = queryGeneric({
  args: { workId: vWorkId },
  returns: v.union(
    v.object({
      state: v.literal("pending"),
      previousAttempts: v.number(),
    }),
    v.object({
      state: v.literal("running"),
      previousAttempts: v.number(),
    }),
    v.object({ state: v.literal("finished") }),
  ),
  handler: async (ctx, { workId }) => await pool.status(ctx, workId),
});

export const backgroundWork = internalActionGeneric({
  args: {},
  returns: v.null(),
  handler: async (): Promise<null> => null,
});

export const onComplete = internalMutationGeneric({
  args: onCompleteArgs,
  returns: v.null(),
  handler: async (): Promise<null> => null,
});

export const statusSourceJobHandler = async (
  ctx: { readonly db: SourceJobDb },
  args: SourceJobArgs,
) => {
  const row = await findSourceJob(ctx.db, args);
  return row === null ? null : toStatus(row);
};

const toStatus = (row: SourceJobState) => ({
  executionStatus: row.executionStatus,
  leaseGeneration: row.leaseGeneration,
  attempt: row.attempt,
  ...(row.workId === undefined ? {} : { workId: row.workId }),
  ...(row.acceptedEffectKey === undefined
    ? {}
    : { acceptedEffectKey: row.acceptedEffectKey }),
  ...(row.externalResponseHash === undefined
    ? {}
    : { externalResponseHash: row.externalResponseHash }),
});
export const heartbeatSourceJob = internalMutationGeneric({
  args: { ...sourceJobCompletionArgs, leaseDurationMs: v.number() },
  returns: v.union(sourceJobStatusReturn, v.null()),
  handler: async (ctx, args) =>
    await heartbeatSourceJobHandler(
      { db: ctx.db as unknown as SourceJobDb },
      args,
    ),
});

export const heartbeatSourceJobHandler = async (
  ctx: { readonly db: SourceJobDb },
  args: SourceJobCompletionContext & { readonly leaseDurationMs: number },
  now = Date.now(),
) => {
  const row = await findSourceJob(ctx.db, args);
  if (row === null) return null;
  const heartbeated = heartbeatLease(row, { ...args, now });
  if (heartbeated._tag === "Left") throw heartbeated.left;
  await patchIfCurrent(ctx.db, row._id, row, heartbeated.right);
  return toStatus(heartbeated.right);
};

export const reclaimSourceJob = internalMutationGeneric({
  args: sourceJobReclaimArgs,
  returns: v.union(sourceJobStatusReturn, v.null()),
  handler: async (ctx, args) => {
    const row = await reclaimSourceJobHandler(
      { db: ctx.db as unknown as SourceJobDb },
      args,
      args,
    );
    return row === null ? null : toStatus(row);
  },
});

export const failSourceJobControl = internalMutationGeneric({
  args: sourceJobFailureArgs,
  returns: v.union(sourceJobStatusReturn, v.null()),
  handler: async (ctx, args) => {
    const row = await failSourceJobHandler(
      { db: ctx.db as unknown as SourceJobDb },
      args as FailureArgs,
    );
    return row === null ? null : toStatus(row);
  },
});

export const backgroundWork = internalActionGeneric({
  args: sourceJobCompletionArgs,
  returns: v.null(),
  handler: async (): Promise<null> => null,
});

export const onComplete = internalMutationGeneric({
  args: onCompleteArgs,
  returns: v.null(),
  handler: async (ctx, args): Promise<null> =>
    await completeSourceJobHandler(
      { db: ctx.db as unknown as SourceJobDb },
      args,
    ),
});

export const completeSourceJobHandler = async (
  ctx: { readonly db: SourceJobDb },
  args: OnCompleteArgs,
  now = Date.now(),
  recoveryPoint?: { readonly stopAfterExternalResponse?: boolean },
): Promise<null> => {
  const row = await findSourceJob(ctx.db, args.context);
  if (row === null) return null;
  const generation = assertSourceJobGenerations(row, args.context);
  if (generation !== null) throw generation;
  if (row.acceptedEffectKey === row.effectKey) return null;
  if (row.executionStatus === "succeeded") return null;
  const running = markSourceJobRunning(row, {
    leaseGeneration: args.context.leaseGeneration,
    leaseToken: args.context.leaseToken,
    now,
  });
  if (running._tag === "Left") throw running.left;
  await patchIfCurrent(ctx.db, row._id, row, running.right);
  const withResponse = recordExternalResponse(running.right, {
    leaseGeneration: args.context.leaseGeneration,
    leaseToken: args.context.leaseToken,
    responseHash: externalResponseHashFor(args.workId),
    now,
  });
  if (withResponse._tag === "Left") throw withResponse.left;
  await patchIfCurrent(
    ctx.db,
    row._id,
    running.right as SourceJobRow,
    withResponse.right,
  );
  if (recoveryPoint?.stopAfterExternalResponse === true) return null;
  const completed = succeedSourceJob(withResponse.right, {
    leaseGeneration: args.context.leaseGeneration,
    leaseToken: args.context.leaseToken,
    effectKey: args.context.effectKey,
    policyGeneration: args.context.policyGeneration,
    routeGeneration: args.context.routeGeneration,
    lifecycleGeneration: args.context.lifecycleGeneration,
    emergencyGeneration: args.context.emergencyGeneration,
    now,
  });
  if (completed._tag === "Left") throw completed.left;
  await patchIfCurrent(
    ctx.db,
    row._id,
    withResponse.right as SourceJobRow,
    completed.right,
  );
  return null;
};

export const reclaimSourceJobHandler = async (
  ctx: { readonly db: SourceJobDb },
  args: SourceJobArgs,
  lease: Readonly<{
    owner: string;
    leaseToken: string;
    leaseDurationMs: number;
  }>,
  now = Date.now(),
): Promise<SourceJobState | null> => {
  const row = await findSourceJob(ctx.db, args);
  if (row === null) return null;
  const reclaimed = reclaimExpiredLease(row, { ...lease, now });
  if (reclaimed._tag === "Left") throw reclaimed.left;
  if (reclaimed.right === row) return row;
  await patchIfCurrent(ctx.db, row._id, row, reclaimed.right);
  return reclaimed.right;
};

type FailureArgs = SourceJobCompletionContext &
  Readonly<
    | { kind: "retryable"; reason: string; retryAfterMs: number }
    | { kind: "permanent"; reason: string }
    | { kind: "cancelled" | "revoked" | "superseded" }
  >;

export const failSourceJobHandler = async (
  ctx: { readonly db: SourceJobDb },
  args: FailureArgs,
  now = Date.now(),
): Promise<SourceJobState | null> => {
  const row = await findSourceJob(ctx.db, args);
  if (row === null) return null;
  const generation = assertSourceJobGenerations(row, args);
  if (generation !== null) throw generation;
  const failed =
    args.kind === "retryable"
      ? scheduleRetry(row, {
          leaseGeneration: args.leaseGeneration,
          leaseToken: args.leaseToken,
          reason: args.reason,
          retryAfterMs: args.retryAfterMs,
          now,
        })
      : args.kind === "permanent"
        ? failSourceJob(row, {
            leaseGeneration: args.leaseGeneration,
            leaseToken: args.leaseToken,
            kind: "permanent",
            reason: args.reason,
            now,
          })
        : failSourceJob(row, {
            leaseGeneration: args.leaseGeneration,
            leaseToken: args.leaseToken,
            kind: args.kind,
            now,
          });
  if (failed._tag === "Left") throw failed.left;
  await patchIfCurrent(ctx.db, row._id, row, failed.right);
  return failed.right;
};

const assertSourceJobGenerations = (
  row: SourceJobState,
  args: SourceJobArgs,
): StaleGeneration | null =>
  row.policyGeneration !== args.policyGeneration
    ? new StaleGeneration({ generation: "policyGeneration" })
    : row.routeGeneration !== args.routeGeneration
      ? new StaleGeneration({ generation: "routeGeneration" })
      : row.lifecycleGeneration !== args.lifecycleGeneration
        ? new StaleGeneration({ generation: "lifecycleGeneration" })
        : row.emergencyGeneration !== args.emergencyGeneration
          ? new StaleGeneration({ generation: "emergencyGeneration" })
          : null;
