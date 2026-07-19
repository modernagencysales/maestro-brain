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
  handler: async (ctx, args): Promise<WorkId> =>
    await pool.enqueueAction(ctx, backgroundWorkRef, args, {
      onComplete: onCompleteRef,
      context: args,
    }),
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
  handler: async (): Promise<null> => null,
});
