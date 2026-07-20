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
  internalQueryGeneric,
  makeFunctionReference,
  mutationGeneric,
  queryGeneric,
} from "convex/server";
import { type GenericId, type Infer, v } from "convex/values";
import { workpoolComponent } from "./componentRefs";
import {
  type SourceJobState,
  createSourceJobState,
  failSourceJob,
  markSourceJobRunning,
  recordExternalResponse,
  scheduleRetry,
  startSourceJob,
  succeedSourceJob,
} from "./jobState";
import { heartbeatLease, reclaimExpiredLease } from "./leases";

const pool = new Workpool(workpoolComponent, {
  maxParallelism: 3,
  retryActionsByDefault: true,
  defaultRetryBehavior: {
    maxAttempts: 3,
    initialBackoffMs: 250,
    base: 2,
  },
});

const sourceJobArgs = {
  organizationKey: v.string(),
  unitKey: v.string(),
  stage: v.union(
    v.literal("assembled"),
    v.literal("awaiting_policy"),
    v.literal("capture_only"),
    v.literal("route_pending"),
    v.literal("awaiting_classification"),
    v.literal("classifying"),
    v.literal("awaiting_classification_review"),
  ),
  effectKey: v.string(),
  policyGeneration: v.number(),
  routeGeneration: v.number(),
  lifecycleGeneration: v.number(),
  emergencyGeneration: v.number(),
  idempotencyKey: v.string(),
};
const sourceJobCompletionArgs = {
  ...sourceJobArgs,
  leaseGeneration: v.number(),
  leaseToken: v.string(),
};
const sourceJobCompletionValidator = v.object(sourceJobCompletionArgs);
const sourceJobReclaimArgs = {
  ...sourceJobArgs,
  owner: v.string(),
  leaseToken: v.string(),
  leaseDurationMs: v.number(),
};
const sourceJobFailureArgs = {
  ...sourceJobCompletionArgs,
  kind: v.union(
    v.literal("retryable"),
    v.literal("permanent"),
    v.literal("cancelled"),
    v.literal("revoked"),
    v.literal("superseded"),
  ),
  reason: v.optional(v.string()),
  retryAfterMs: v.optional(v.number()),
};
type SourceJobArgs = Readonly<{
  organizationKey: string;
  unitKey: string;
  stage:
    | "assembled"
    | "awaiting_policy"
    | "capture_only"
    | "route_pending"
    | "awaiting_classification"
    | "classifying"
    | "awaiting_classification_review";
  effectKey: string;
  policyGeneration: number;
  routeGeneration: number;
  lifecycleGeneration: number;
  emergencyGeneration: number;
  idempotencyKey: string;
}>;
type SourceJobRow = SourceJobState & {
  readonly _id: GenericId<"sourceProcessingJobs">;
};
type SourceJobCompletionContext = SourceJobArgs & {
  readonly leaseGeneration: number;
  readonly leaseToken: string;
};
type SourceJobWorkpool = Readonly<{
  enqueueAction: (
    ctx: unknown,
    ref: typeof backgroundWorkRef,
    args: SourceJobCompletionContext,
    options: {
      readonly onComplete: typeof onCompleteRef;
      readonly context: SourceJobCompletionContext;
    },
  ) => Promise<WorkId>;
  status: (ctx: unknown, workId: WorkId) => Promise<unknown>;
}>;

const maxAttempts = 3;
const leaseDurationMs = 30_000;
const workerOwner = "workpool";
const scopedIdempotencyKey = (args: SourceJobArgs) =>
  `${args.organizationKey}:${args.unitKey}:${args.effectKey}:${args.policyGeneration}:${args.routeGeneration}:${args.lifecycleGeneration}:${args.emergencyGeneration}:${args.idempotencyKey}`;
const leaseTokenFor = (args: SourceJobArgs, nextLeaseGeneration: number) =>
  `lease:${args.organizationKey}:${args.unitKey}:${args.effectKey}:${nextLeaseGeneration}`;
const externalResponseHashFor = (workId: WorkId) => `sha256:workpool:${workId}`;

const backgroundWorkRef = makeFunctionReference<
  "action",
  SourceJobCompletionContext,
  null
>("jobs/workpool:backgroundWork") as unknown as FunctionReference<
  "action",
  "internal",
  SourceJobCompletionContext,
  null
>;

const onCompleteArgs = vOnCompleteArgs(sourceJobCompletionValidator);
type OnCompleteArgs = Infer<typeof onCompleteArgs>;

const onCompleteRef = makeFunctionReference<"mutation", OnCompleteArgs, null>(
  "jobs/workpool:onComplete",
) as unknown as FunctionReference<"mutation", "internal", OnCompleteArgs, null>;

export const enqueue = mutationGeneric({
  args: {},
  returns: vWorkId,
  handler: async (): Promise<WorkId> => {
    throw new Error("source jobs require internal enqueueSourceJob");
  },
});

export const enqueueSourceJob = internalMutationGeneric({
  args: sourceJobArgs,
  returns: vWorkId,
  handler: async (ctx, args): Promise<WorkId> =>
    await enqueueSourceJobHandler(
      { db: ctx.db as unknown as SourceJobDb },
      args,
      pool as SourceJobWorkpool,
    ),
});

export const enqueueSourceJobHandler = async (
  ctx: { readonly db: SourceJobDb },
  args: SourceJobArgs,
  workpool: SourceJobWorkpool,
  now = Date.now(),
): Promise<WorkId> => {
  const existing = await findSourceJob(ctx.db, args);
  if (existing !== null) {
    if (existing.effectKey !== args.effectKey)
      throw new Error("DuplicateEffect");
    if (existing.workId !== undefined) return existing.workId as WorkId;
  }
  const rowId =
    existing?._id ??
    (await ctx.db.insert(
      "sourceProcessingJobs",
      createSourceJobState({
        ...args,
        organizationUnitIdempotencyKey: scopedIdempotencyKey(args),
        maxAttempts,
        now,
      }),
    ));
  const row =
    (existing as SourceJobRow | null) ??
    ((await ctx.db.get(rowId)) as SourceJobRow | null);
  if (row === null) throw new Error("source job vanished before claim");
  const leaseToken = leaseTokenFor(args, row.leaseGeneration + 1);
  const claimed = startSourceJob(row, {
    owner: workerOwner,
    leaseToken,
    leaseDurationMs,
    now,
  });
  if (claimed._tag === "Left") {
    if (row.workId !== undefined) return row.workId as WorkId;
    throw claimed.left;
  }
  await patchIfCurrent(ctx.db, rowId, row, claimed.right);
  const context = {
    ...args,
    leaseGeneration: claimed.right.leaseGeneration,
    leaseToken,
  };
  const workId = await workpool.enqueueAction(ctx, backgroundWorkRef, context, {
    onComplete: onCompleteRef,
    context,
  });
  const current = (await ctx.db.get(rowId)) as SourceJobRow | null;
  if (
    current !== null &&
    current.leaseGeneration === claimed.right.leaseGeneration &&
    current.leaseToken === leaseToken &&
    current.workId === undefined
  ) {
    await ctx.db.patch(rowId, { workId });
  } else if (current?.workId !== undefined) {
    return current.workId as WorkId;
  } else {
    throw new Error("LeaseLost");
  }
  return workId;
};

type SourceJobIndexBuilder = {
  eq: (
    field: "organizationKey" | "organizationUnitIdempotencyKey",
    value: string,
  ) => SourceJobIndexBuilder;
};
type SourceJobDb = Readonly<{
  query: (table: "sourceProcessingJobs") => {
    withIndex: (
      index: "by_org_unit_idempotency_key",
      filter: (q: SourceJobIndexBuilder) => unknown,
    ) => { unique: () => Promise<SourceJobRow | null> };
  };
  insert: (
    table: "sourceProcessingJobs",
    row: SourceJobState,
  ) => Promise<GenericId<"sourceProcessingJobs">>;
  get: (id: GenericId<"sourceProcessingJobs">) => Promise<SourceJobRow | null>;
  patch: (
    id: GenericId<"sourceProcessingJobs">,
    patch: Partial<SourceJobState>,
  ) => Promise<void>;
}>;
const findSourceJob = (db: SourceJobDb, args: SourceJobArgs) =>
  db
    .query("sourceProcessingJobs")
    .withIndex("by_org_unit_idempotency_key", (q) =>
      q
        .eq("organizationKey", args.organizationKey)
        .eq("organizationUnitIdempotencyKey", scopedIdempotencyKey(args)),
    )
    .unique();

const patchIfCurrent = async (
  db: SourceJobDb,
  rowId: GenericId<"sourceProcessingJobs">,
  expected: SourceJobRow,
  patch: SourceJobState,
) => {
  const current = await db.get(rowId);
  if (
    current === null ||
    current.leaseGeneration !== expected.leaseGeneration ||
    current.leaseToken !== expected.leaseToken ||
    current.acceptedEffectKey !== expected.acceptedEffectKey ||
    current.executionStatus !== expected.executionStatus
  ) {
    throw new Error("LeaseLost");
  }
  await db.patch(rowId, patch);
};

const sourceJobStatusReturn = v.object({
  executionStatus: v.union(
    v.literal("queued"),
    v.literal("leased"),
    v.literal("running"),
    v.literal("succeeded"),
    v.literal("retry_wait"),
    v.literal("dead_letter"),
    v.literal("superseded"),
    v.literal("revoked"),
    v.literal("cancelled"),
  ),
  leaseGeneration: v.number(),
  attempt: v.number(),
  workId: v.optional(v.string()),
  acceptedEffectKey: v.optional(v.string()),
  externalResponseHash: v.optional(v.string()),
});

export const status = queryGeneric({
  args: { workId: vWorkId },
  returns: v.any(),
  handler: async (ctx, { workId }) => await pool.status(ctx, workId),
});

export const statusSourceJob = internalQueryGeneric({
  args: sourceJobArgs,
  returns: v.union(sourceJobStatusReturn, v.null()),
  handler: async (ctx, args) =>
    await statusSourceJobHandler(
      { db: ctx.db as unknown as SourceJobDb },
      args,
    ),
});

export const statusSourceJobHandler = async (
  ctx: { readonly db: SourceJobDb },
  args: SourceJobArgs,
): Promise<SourceJobStatus | null> => {
  const row = await findSourceJob(ctx.db, args);
  return row === null ? null : toStatus(row);
};

type SourceJobStatus = Readonly<{
  executionStatus: SourceJobState["executionStatus"];
  leaseGeneration: number;
  attempt: number;
  workId?: string;
  acceptedEffectKey?: string;
  externalResponseHash?: string;
}>;
const toStatus = (row: SourceJobState): SourceJobStatus => ({
  executionStatus: row.executionStatus,
  leaseGeneration: row.leaseGeneration,
  attempt: row.attempt,
  ...(row.workId !== undefined ? { workId: row.workId } : {}),
  ...(row.acceptedEffectKey !== undefined
    ? { acceptedEffectKey: row.acceptedEffectKey }
    : {}),
  ...(row.externalResponseHash !== undefined
    ? { externalResponseHash: row.externalResponseHash }
    : {}),
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
): Promise<SourceJobStatus | null> => {
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
  if (
    row.policyGeneration !== args.context.policyGeneration ||
    row.routeGeneration !== args.context.routeGeneration ||
    row.lifecycleGeneration !== args.context.lifecycleGeneration ||
    row.emergencyGeneration !== args.context.emergencyGeneration
  )
    throw new Error("StaleGeneration");
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
  (
    | Readonly<{
        kind: "retryable";
        reason: string;
        retryAfterMs: number;
      }>
    | Readonly<{ kind: "permanent"; reason: string }>
    | Readonly<{ kind: "cancelled" | "revoked" | "superseded" }>
  );

export const failSourceJobHandler = async (
  ctx: { readonly db: SourceJobDb },
  args: FailureArgs,
  now = Date.now(),
): Promise<SourceJobState | null> => {
  const row = await findSourceJob(ctx.db, args);
  if (row === null) return null;
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
