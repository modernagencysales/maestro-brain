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

const onCompleteRef = makeFunctionReference<
  "mutation",
  OnCompleteArgs,
  null
>("jobs/workpool:onComplete") as unknown as FunctionReference<
  "mutation",
  "internal",
  OnCompleteArgs,
  null
>;

export const enqueue = mutationGeneric({
  args: {},
  returns: vWorkId,
  handler: async (ctx): Promise<WorkId> =>
    await pool.enqueueAction(ctx, backgroundWorkRef, {}, {
      onComplete: onCompleteRef,
      context: null,
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
