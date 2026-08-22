"use node";

import {
  createFakeNangoClient,
  createLiveNangoClient,
} from "@maestro-template/integrations/nango/client";
import { type FunctionReference, makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import {
  createNangoTranscriptSyncProvider,
  runTranscriptSyncPage,
} from "../../confect/integrations/transcriptSync.node";
import { readProcessEnv } from "../../confect/shared/env";
import { internalAction } from "../_generated/server";

const mutation = (name: string) =>
  makeFunctionReference(name) as unknown as FunctionReference<
    "mutation",
    "internal"
  >;
const action = (name: string) =>
  makeFunctionReference(name) as unknown as FunctionReference<
    "action",
    "internal"
  >;
const claimRef = mutation(
  "integrations/transcriptSync:claimTranscriptSyncPage",
);
const ingestPageRef = mutation(
  "integrations/transcriptSync:ingestTranscriptSyncPage",
);
const failRef = mutation("integrations/transcriptSync:failTranscriptSyncPage");
const workerRef = action(
  "integrations/transcriptSyncWorker:syncTranscriptPage",
);

const nangoClientFor = (now: number, providerConfigKey: string) => {
  const env = readProcessEnv();
  if ((env.APP_PROVIDER_MODE ?? "fake").trim().toLowerCase() !== "live")
    return createFakeNangoClient({ now, providerConfigKey });
  const secretKey = env.NANGO_SECRET_KEY?.trim();
  if (!secretKey) throw new Error("Nango is unavailable");
  return createLiveNangoClient({ secretKey, providerConfigKey });
};

export const syncTranscriptPage = internalAction({
  args: {
    connectionKey: v.string(),
    expectedGeneration: v.number(),
  },
  returns: v.union(
    v.object({
      kind: v.literal("committed"),
      nextCursor: v.union(v.string(), v.null()),
    }),
    v.object({ kind: v.literal("failed"), errorTag: v.string() }),
  ),
  handler: async (ctx, input) => {
    const now = Date.now();
    const snapshot = await ctx.runMutation(claimRef, {
      connectionKey: input.connectionKey,
      expectedGeneration: input.expectedGeneration,
      leaseId: crypto.randomUUID(),
      now,
    });
    const provider = createNangoTranscriptSyncProvider((providerConfigKey) =>
      nangoClientFor(now, providerConfigKey),
    );
    let retryAfterMs: number | null = null;
    const result = await runTranscriptSyncPage({
      cursor: snapshot.cursor,
      listPage: () => provider.listPage(snapshot),
      normalize: (record) => provider.normalize(snapshot, record),
      ingestPage: (page) =>
        ctx.runMutation(ingestPageRef, {
          connectionKey: snapshot.connectionKey,
          expectedGeneration: snapshot.connectionGeneration,
          leaseId: snapshot.leaseId,
          ...page,
          now: Date.now(),
        }),
      fail: (failure) => {
        retryAfterMs = failure.retryAfterMs;
        return ctx.runMutation(failRef, {
          connectionKey: snapshot.connectionKey,
          expectedGeneration: snapshot.connectionGeneration,
          leaseId: snapshot.leaseId,
          ...failure,
          now: Date.now(),
        });
      },
    });
    if (result.kind === "committed" || retryAfterMs !== null) {
      const delay =
        result.kind === "committed"
          ? result.nextCursor === null
            ? 300_000
            : 0
          : (retryAfterMs ?? 60_000);
      await ctx.scheduler.runAfter(delay, workerRef, {
        connectionKey: snapshot.connectionKey,
        expectedGeneration: snapshot.connectionGeneration,
      });
    }
    return result;
  },
});
