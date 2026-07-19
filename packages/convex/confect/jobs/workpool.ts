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
  recordExternalResponse,
  startSourceJob,
  succeedSourceJob,
} from "./jobState";

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
const sourceJobValidator = v.object(sourceJobArgs);
type SourceJobArgs = Infer<typeof sourceJobValidator>;
type SourceJobRow = SourceJobState & {
  readonly _id: GenericId<"sourceProcessingJobs">;
};

const maxAttempts = 3;
const leaseDurationMs = 30_000;
const workerOwner = "workpool";
const scopedIdempotencyKey = (args: SourceJobArgs) =>
  `${args.organizationKey}:${args.unitKey}:${args.idempotencyKey}`;
const leaseTokenFor = (args: SourceJobArgs) =>
  `lease:${args.idempotencyKey}:${args.effectKey}`;
const externalResponseHashFor = (workId: WorkId) => `sha256:workpool:${workId}`;

const backgroundWorkRef = makeFunctionReference<"action", SourceJobArgs, null>(
  "jobs/workpool:backgroundWork",
) as unknown as FunctionReference<"action", "internal", SourceJobArgs, null>;

const onCompleteArgs = vOnCompleteArgs(sourceJobValidator);
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
  handler: async (ctx, args): Promise<WorkId> => {
    const existing = await ctx.db
      .query("sourceProcessingJobs")
      .withIndex("by_org_unit_idempotency_key", (q) =>
        q.eq("organizationUnitIdempotencyKey", scopedIdempotencyKey(args)),
      )
      .unique();
    if (existing?.workId !== undefined) return existing.workId as WorkId;

    const rowId =
      existing?._id ??
      (await ctx.db.insert(
        "sourceProcessingJobs",
        createSourceJobState({
          ...args,
          organizationUnitIdempotencyKey: scopedIdempotencyKey(args),
          maxAttempts,
          now: Date.now(),
        }),
      ));
    const workId = await pool.enqueueAction(ctx, backgroundWorkRef, args, {
      onComplete: onCompleteRef,
      context: args,
    });
    await ctx.db.patch(rowId, { workId });
    return workId;
  },
});

export const statusSourceJob = internalQueryGeneric({
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
  args: sourceJobArgs,
  returns: v.null(),
  handler: async (): Promise<null> => null,
});

export const onComplete = internalMutationGeneric({
  args: onCompleteArgs,
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const row = (await ctx.db
      .query("sourceProcessingJobs")
      .withIndex("by_org_unit_idempotency_key", (q) =>
        q.eq(
          "organizationUnitIdempotencyKey",
          scopedIdempotencyKey(args.context),
        ),
      )
      .unique()) as SourceJobRow | null;
    if (row === null || row.acceptedEffectKey === row.effectKey) return null;

    const now = Date.now();
    const leaseToken = leaseTokenFor(args.context);
    const claimed = startSourceJob(row, {
      owner: workerOwner,
      leaseToken,
      leaseDurationMs,
      now,
    });
    if (claimed._tag === "Left") return null;
    await ctx.db.patch(row._id, claimed.right);

    const withResponse = recordExternalResponse(claimed.right, {
      leaseGeneration: claimed.right.leaseGeneration,
      leaseToken,
      responseHash: externalResponseHashFor(args.workId),
      now,
    });
    if (withResponse._tag === "Left") return null;
    await ctx.db.patch(row._id, withResponse.right);

    const completed = succeedSourceJob(withResponse.right, {
      leaseGeneration: claimed.right.leaseGeneration,
      leaseToken,
      effectKey: args.context.effectKey,
      policyGeneration: args.context.policyGeneration,
      routeGeneration: args.context.routeGeneration,
      lifecycleGeneration: args.context.lifecycleGeneration,
      emergencyGeneration: args.context.emergencyGeneration,
      now,
    });
    if (completed._tag === "Right")
      await ctx.db.patch(row._id, completed.right);
    return null;
  },
});
