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
import { reclaimExpiredLease } from "./leases";

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
  `${args.organizationKey}:${args.unitKey}:${args.idempotencyKey}`;
const leaseTokenFor = (args: SourceJobArgs) =>
  `lease:${args.idempotencyKey}:${args.effectKey}`;
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
  handler: async (ctx): Promise<WorkId> =>
    await pool.enqueueAction(ctx, backgroundWorkRef, {
      organizationKey: "demo",
      unitKey: "demo",
      stage: "assembled",
      effectKey: "demo",
      policyGeneration: 0,
      routeGeneration: 0,
      lifecycleGeneration: 0,
      emergencyGeneration: 0,
      idempotencyKey: "demo",
      leaseGeneration: 0,
      leaseToken: "demo",
    }),
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
  if (existing !== null && existing.workId !== undefined)
    return existing.workId as WorkId;
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
  const leaseToken = leaseTokenFor(args);
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
  await ctx.db.patch(rowId, claimed.right);
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
  }
  return workId;
};

type SourceJobDb = Readonly<{
  query: (table: "sourceProcessingJobs") => {
    withIndex: (
      index: "by_org_unit_idempotency_key",
      filter: (q: {
        eq: (field: "organizationUnitIdempotencyKey", value: string) => unknown;
      }) => unknown,
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
      q.eq("organizationUnitIdempotencyKey", scopedIdempotencyKey(args)),
    )
    .unique();

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
): Promise<Readonly<{
  executionStatus: SourceJobState["executionStatus"];
  leaseGeneration: number;
  attempt: number;
  workId?: string;
  acceptedEffectKey?: string;
  externalResponseHash?: string;
}> | null> => {
  const row = await findSourceJob(ctx.db, args);
  if (row === null) return null;
  return {
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
  };
};

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
  if (row === null || row.acceptedEffectKey === row.effectKey) return null;
  const running = markSourceJobRunning(row, {
    leaseGeneration: args.context.leaseGeneration,
    leaseToken: args.context.leaseToken,
    now,
  });
  if (running._tag === "Left") throw running.left;
  await ctx.db.patch(row._id, running.right);
  const withResponse = recordExternalResponse(running.right, {
    leaseGeneration: args.context.leaseGeneration,
    leaseToken: args.context.leaseToken,
    responseHash: externalResponseHashFor(args.workId),
    now,
  });
  if (withResponse._tag === "Left") throw withResponse.left;
  await ctx.db.patch(row._id, withResponse.right);
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
  await ctx.db.patch(row._id, completed.right);
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
  await ctx.db.patch(row._id, reclaimed.right);
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
        : failSourceJob(row, { kind: args.kind, now });
  if (failed._tag === "Left") throw failed.left;
  await ctx.db.patch(row._id, failed.right);
  return failed.right;
};
