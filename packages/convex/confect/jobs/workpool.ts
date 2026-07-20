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
