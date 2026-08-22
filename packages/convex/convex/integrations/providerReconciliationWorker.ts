"use node";

import {
  createFakeNangoClient,
  createLiveNangoClient,
} from "@maestro-template/integrations/nango/client";
import { transcriptProviders } from "@maestro-template/integrations/transcripts/providers";
import { type FunctionReference, makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import {
  captureDriveReconciliationStart,
  coordinateDriveReconciliationPage,
  type DriveReconciliationPort,
} from "../../confect/integrations/driveReconciliationCoordinator";
import {
  fetchSlackReconciliationPage,
  makeNangoDriveReconciliationClient,
} from "../../confect/integrations/providerReconciliationWorker.node";
import {
  coordinateSourceReconciliationPage,
  type SourceReconciliationPort,
} from "../../confect/integrations/sourceReconciliationCoordinator";
import { prepareTranscriptReconciliationWrite } from "../../confect/integrations/transcriptReconciliationAdapter";
import { createNangoTranscriptSyncProvider } from "../../confect/integrations/transcriptSync.node";
import { readProcessEnv } from "../../confect/shared/env";
import { internalAction, type ActionCtx } from "../_generated/server";

const query = (name: string) =>
  makeFunctionReference(name) as unknown as FunctionReference<
    "query",
    "internal"
  >;
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

const listRecoverableRef = query(
  "integrations/providerReconciliation:listRecoverableReconciliationRuns",
);
const startContextRef = query(
  "integrations/providerReconciliation:getReconciliationStartContext",
);
const driveStartConfigurationRef = query(
  "integrations/providerReconciliation:getDriveScopeConfigurationForStart",
);
const openRunRef = mutation(
  "integrations/providerReconciliation:openReconciliationRun",
);
const claimStepRef = mutation(
  "integrations/providerReconciliation:claimReconciliationStep",
);
const loadPageRef = query(
  "integrations/providerReconciliation:loadReconciliationPage",
);
const driveConfigurationRef = query(
  "integrations/providerReconciliation:getDriveScopeConfiguration",
);
const driveIncarnationRef = query(
  "integrations/providerReconciliation:getDriveExpectedIncarnation",
);
const beginPageRef = mutation(
  "integrations/providerReconciliation:beginReconciliationPage",
);
const commitChunkRef = mutation(
  "integrations/providerReconciliation:commitReconciliationPageChunk",
);
const finalizePageRef = mutation(
  "integrations/providerReconciliation:finalizeReconciliationPage",
);
const closeTraversalRef = mutation(
  "integrations/providerReconciliation:closeReconciliationTraversal",
);
const listRemovalsRef = query(
  "integrations/providerReconciliation:listReconciliationRemovalCandidates",
);
const applyRemovalsRef = mutation(
  "integrations/providerReconciliation:applyReconciliationRemovalBatch",
);
const maybeCompleteRef = mutation(
  "integrations/providerReconciliation:maybeCompleteReconciliationRun",
);
const workerRef = action(
  "integrations/providerReconciliationWorker:runProviderReconciliationWorker",
);

type RunRef = {
  readonly reconciliationRunKey: string;
  readonly expectedRunGeneration: number;
  readonly expectedConnectionGeneration: number;
  readonly expectedAllowlistGeneration: number;
  readonly expectedLeaseGeneration: number;
};

type ClaimedStep = {
  readonly organizationKey: string;
  readonly workspaceId: string;
  readonly brainKey: string;
  readonly corpusKey: "slack" | "transcripts" | "documents";
  readonly providerKind: "slack" | "transcript" | "google_drive";
  readonly connectorScopeKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly allowlistGeneration: number;
  readonly requiredScopeIntentKey: string;
  readonly reconciliationRunKey: string;
  readonly runGeneration: number;
  readonly status:
    "scan" | "traversal_closed" | "apply_removals" | "drain_derived";
  readonly cursorKey: string;
  readonly providerCursor: string | null;
  readonly removalCursor: string | null;
  readonly traversalComplete: boolean;
  readonly cursorGeneration: number;
  readonly providerHighWater: string | null;
  readonly ledgerHighWater: number;
  readonly leaseId: string;
  readonly leaseGeneration: number;
  readonly leaseExpiresAt: number;
  readonly providerContainerKey: string;
  readonly providerConfigKey: string;
  readonly nangoConnectionId: string;
  readonly teamId: string | null;
  readonly apiAppId: string | null;
  readonly botUserId: string | null;
  readonly routingPolicyEpoch: number;
};

type StartContext = {
  readonly organizationKey: string;
  readonly workspaceId: string;
  readonly brainKey: string;
  readonly corpusKey: "slack" | "transcripts" | "documents";
  readonly providerKind: "slack" | "transcript" | "google_drive";
  readonly connectorScopeKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly allowlistGeneration: number;
  readonly requiredScopeIntentKey: string;
  readonly expectedPreviousRunGeneration: number;
  readonly providerContainerKey: string;
  readonly providerConfigKey: string;
  readonly nangoConnectionId: string;
  readonly currentRun: null | {
    readonly reconciliationRunKey: string;
    readonly runGeneration: number;
    readonly status:
      | "scan"
      | "traversal_closed"
      | "apply_removals"
      | "drain_derived"
      | "complete"
      | "superseded"
      | "blocked";
    readonly providerHighWater: string | null;
    readonly leaseId: string;
    readonly leaseGeneration: number;
  };
};

const resumableStatuses = new Set([
  "scan",
  "traversal_closed",
  "apply_removals",
  "drain_derived",
]);

const nangoClientFor = (now: number, providerConfigKey: string) => {
  const env = readProcessEnv();
  if ((env.APP_PROVIDER_MODE ?? "fake").trim().toLowerCase() !== "live")
    return createFakeNangoClient({ now, providerConfigKey });
  const secretKey = env.NANGO_SECRET_KEY?.trim();
  if (!secretKey) throw new Error("Nango is unavailable");
  return createLiveNangoClient({ secretKey, providerConfigKey });
};

const runRefFor = (step: ClaimedStep) => ({
  reconciliationRunKey: step.reconciliationRunKey,
  expectedRunGeneration: step.runGeneration,
  expectedConnectionGeneration: step.connectionGeneration,
  expectedAllowlistGeneration: step.allowlistGeneration,
  expectedLeaseGeneration: step.leaseGeneration,
  leaseId: step.leaseId,
});

const continuationFor = (step: ClaimedStep) => ({
  reconciliationRunKey: step.reconciliationRunKey,
  expectedRunGeneration: step.runGeneration,
  expectedConnectionGeneration: step.connectionGeneration,
  expectedAllowlistGeneration: step.allowlistGeneration,
  expectedLeaseGeneration: step.leaseGeneration,
  leaseId: step.leaseId,
});

const sourcePort = (
  ctx: ActionCtx,
  sourceKind: "slack" | "transcript",
): SourceReconciliationPort => ({
  loadPage: async (args) => {
    const stored = (await ctx.runQuery(loadPageRef, {
      reconciliationRunKey: args.reconciliationRunKey,
      expectedRunGeneration: args.expectedRunGeneration,
      expectedConnectionGeneration: args.expectedConnectionGeneration,
      expectedAllowlistGeneration: args.expectedAllowlistGeneration,
      sourceKind,
      cursorKey: args.cursorKey,
      expectedCursor: args.expectedCursor,
      expectedCursorGeneration: args.expectedCursorGeneration,
    })) as
      | null
      | {
          readonly kind: "slack";
          readonly pageEnvelopeKey: string;
          readonly pageDigest: string;
          readonly ledgerHighWater: number;
          readonly chunks: readonly {
            readonly chunkIndex: number;
            readonly chunkDigest: string;
            readonly observationCount: number;
          }[];
          readonly preparedSlackPage: unknown;
        }
      | {
          readonly kind: "transcript";
          readonly pageEnvelopeKey: string;
          readonly pageDigest: string;
          readonly ledgerHighWater: number;
          readonly chunks: readonly {
            readonly chunkIndex: number;
            readonly chunkDigest: string;
            readonly observationCount: number;
          }[];
          readonly preparedTranscriptPage: unknown;
        };
    if (stored === null) return null;
    if (stored.kind === "slack")
      return {
        sourceChunk: "slack",
        pageEnvelopeKey: stored.pageEnvelopeKey,
        pageDigest: stored.pageDigest,
        ledgerHighWater: stored.ledgerHighWater,
        chunks: stored.chunks,
        preparedPage: stored.preparedSlackPage,
      } as Awaited<ReturnType<SourceReconciliationPort["loadPage"]>>;
    return {
      sourceChunk: "transcript",
      pageEnvelopeKey: stored.pageEnvelopeKey,
      pageDigest: stored.pageDigest,
      ledgerHighWater: stored.ledgerHighWater,
      chunks: stored.chunks,
      preparedPage: stored.preparedTranscriptPage,
    } as Awaited<ReturnType<SourceReconciliationPort["loadPage"]>>;
  },
  beginPage: async (args) => await ctx.runMutation(beginPageRef, args),
  commitChunk: async (args) => await ctx.runMutation(commitChunkRef, args),
  finalizePage: async (args) => await ctx.runMutation(finalizePageRef, args),
});

const drivePort = (ctx: ActionCtx): DriveReconciliationPort => ({
  loadPage: async (args) => {
    const stored = (await ctx.runQuery(loadPageRef, {
      reconciliationRunKey: args.reconciliationRunKey,
      expectedRunGeneration: args.expectedRunGeneration,
      expectedConnectionGeneration: args.expectedConnectionGeneration,
      expectedAllowlistGeneration: args.expectedAllowlistGeneration,
      sourceKind: "google_drive",
      cursorKey: args.cursorKey,
      expectedCursor: args.expectedCursor,
      expectedCursorGeneration: args.expectedCursorGeneration,
    })) as null | {
      readonly kind: "google_drive";
      readonly pageEnvelopeKey: string;
      readonly pageDigest: string;
      readonly ledgerHighWater: number;
      readonly chunks: readonly {
        readonly chunkIndex: number;
        readonly chunkDigest: string;
        readonly observationCount: number;
      }[];
      readonly preparedDrivePage: unknown;
    };
    if (stored === null) return null;
    return {
      pageEnvelopeKey: stored.pageEnvelopeKey,
      pageDigest: stored.pageDigest,
      ledgerHighWater: stored.ledgerHighWater,
      chunks: stored.chunks,
      preparedDrivePage: stored.preparedDrivePage,
    } as Awaited<ReturnType<DriveReconciliationPort["loadPage"]>>;
  },
  beginPage: async (args) => await ctx.runMutation(beginPageRef, args),
  commitChunk: async (args) => await ctx.runMutation(commitChunkRef, args),
  finalizePage: async (args) => await ctx.runMutation(finalizePageRef, args),
});

const transcriptProviderForConfig = (providerConfigKey: string) =>
  Object.entries(transcriptProviders).find(
    ([, provider]) => provider.providerConfigKey === providerConfigKey,
  )?.[0] as keyof typeof transcriptProviders | undefined;

const runScanStep = async (ctx: ActionCtx, step: ClaimedStep, now: number) => {
  const runRef = runRefFor(step);
  const pageRef = {
    ...runRef,
    cursorKey: step.cursorKey,
    expectedCursor: step.providerCursor,
    expectedCursorGeneration: step.cursorGeneration,
    connectorScopeKey: step.connectorScopeKey,
    requiredScopeIntentKey: step.requiredScopeIntentKey,
    providerHighWater: step.providerHighWater,
    now,
  };
  const client = nangoClientFor(now, step.providerConfigKey);
  if (step.providerKind === "slack") {
    if (
      step.teamId === null ||
      step.apiAppId === null ||
      step.botUserId === null
    )
      throw new Error("Slack reconciliation connection metadata is missing");
    const teamId = step.teamId;
    const appId = step.apiAppId;
    const botUserId = step.botUserId;
    return await coordinateSourceReconciliationPage({
      ...pageRef,
      sourceChunk: "slack",
      reconciliation: sourcePort(ctx, "slack"),
      fetchPage: async () =>
        await fetchSlackReconciliationPage({
          client,
          connectionId: step.nangoConnectionId,
          organizationKey: step.organizationKey,
          connectionKey: step.connectionKey,
          connectionGeneration: step.connectionGeneration,
          connectorScopeKey: step.connectorScopeKey,
          channelId: step.providerContainerKey,
          teamId,
          appId,
          botUserId,
          routingPolicyEpoch: step.routingPolicyEpoch,
          cursor: step.providerCursor,
          receivedAt: now,
        }),
    });
  }
  if (step.providerKind === "transcript") {
    const provider = transcriptProviderForConfig(step.providerConfigKey);
    if (provider === undefined)
      throw new Error("Transcript reconciliation provider is unsupported");
    const transcriptClient = createNangoTranscriptSyncProvider(() => client);
    const snapshot = {
      organizationKey: step.organizationKey,
      connectionKey: step.connectionKey,
      connectionGeneration: step.connectionGeneration,
      provider,
      providerConfigKey: step.providerConfigKey,
      nangoConnectionId: step.nangoConnectionId,
      cursor: step.providerCursor,
      leaseId: step.leaseId,
    };
    return await coordinateSourceReconciliationPage({
      ...pageRef,
      sourceChunk: "transcript",
      reconciliation: sourcePort(ctx, "transcript"),
      fetchPage: async () => {
        const page = await transcriptClient.listPage(snapshot);
        const writes = [];
        for (const record of page.records)
          writes.push(
            prepareTranscriptReconciliationWrite({
              call: await transcriptClient.normalize(snapshot, record),
              receivedAt: now,
            }),
          );
        return {
          writes,
          cursorAfter: page.nextCursor,
          terminal: page.nextCursor === null,
        };
      },
    });
  }
  if (step.providerCursor === null)
    throw new Error("Drive reconciliation cursor is missing");
  const configuration = (await ctx.runQuery(driveConfigurationRef, {
    reconciliationRunKey: step.reconciliationRunKey,
    expectedRunGeneration: step.runGeneration,
    expectedConnectionGeneration: step.connectionGeneration,
    expectedAllowlistGeneration: step.allowlistGeneration,
  })) as null | {
    readonly driveId: string;
    readonly rootFolderIds: readonly string[];
    readonly sharedDrive: boolean;
    readonly retentionClass: string;
    readonly permissionPolicyDigest: string;
  };
  if (configuration === null)
    throw new Error("Drive reconciliation configuration is missing");
  return await coordinateDriveReconciliationPage({
    ...runRef,
    organizationKey: step.organizationKey,
    scope: {
      connectionKey: step.connectionKey,
      connectionGeneration: step.connectionGeneration,
      driveId: configuration.driveId,
      rootFolderIds: configuration.rootFolderIds,
      allowlistGeneration: step.allowlistGeneration,
      sharedDrive: configuration.sharedDrive,
    },
    client: makeNangoDriveReconciliationClient({
      client,
      connectionId: step.nangoConnectionId,
    }),
    ledger: {
      getExpectedIncarnation: async (organizationKey, providerObjectKey) =>
        (await ctx.runQuery(driveIncarnationRef, {
          organizationKey,
          providerObjectKey,
        })) as number | null,
    },
    reconciliation: drivePort(ctx),
    cursorKey: step.cursorKey,
    pageToken: step.providerCursor,
    expectedCursorGeneration: step.cursorGeneration,
    requiredScopeIntentKey: step.requiredScopeIntentKey,
    providerHighWater: step.providerHighWater,
    pageSize: 100,
    observedAt: now,
    retentionClass: configuration.retentionClass,
    permissionSnapshotHash: async () => configuration.permissionPolicyDigest,
  });
};

const runRefArgs = {
  reconciliationRunKey: v.string(),
  expectedRunGeneration: v.number(),
  expectedConnectionGeneration: v.number(),
  expectedAllowlistGeneration: v.number(),
  expectedLeaseGeneration: v.number(),
  leaseId: v.optional(v.string()),
};

const startResult = v.object({
  reconciliationRunKey: v.string(),
  runGeneration: v.number(),
  providerKind: v.union(
    v.literal("slack"),
    v.literal("transcript"),
    v.literal("google_drive"),
  ),
  providerHighWater: v.union(v.string(), v.null()),
  scheduledFunctionId: v.id("_scheduled_functions"),
  resumed: v.boolean(),
});

export const startProviderReconciliation = internalAction({
  args: { connectorScopeKey: v.string() },
  returns: startResult,
  handler: async (ctx, input) => {
    const now = Date.now();
    const start = (await ctx.runQuery(startContextRef, {
      connectorScopeKey: input.connectorScopeKey,
    })) as StartContext;
    const current = start.currentRun;
    if (current !== null && resumableStatuses.has(current.status)) {
      const scheduledFunctionId = await ctx.scheduler.runAfter(0, workerRef, {
        reconciliationRunKey: current.reconciliationRunKey,
        expectedRunGeneration: current.runGeneration,
        expectedConnectionGeneration: start.connectionGeneration,
        expectedAllowlistGeneration: start.allowlistGeneration,
        expectedLeaseGeneration: current.leaseGeneration,
        leaseId: current.leaseId,
      });
      return {
        reconciliationRunKey: current.reconciliationRunKey,
        runGeneration: current.runGeneration,
        providerKind: start.providerKind,
        providerHighWater: current.providerHighWater,
        scheduledFunctionId,
        resumed: true,
      };
    }

    let initialCursor: string | null = null;
    let providerHighWater: string | null = null;
    if (start.providerKind === "google_drive") {
      const configuration = (await ctx.runQuery(driveStartConfigurationRef, {
        connectorScopeKey: start.connectorScopeKey,
        connectionGeneration: start.connectionGeneration,
        allowlistGeneration: start.allowlistGeneration,
      })) as null | {
        readonly driveId: string;
        readonly rootFolderIds: readonly string[];
        readonly sharedDrive: boolean;
      };
      if (configuration === null)
        throw new Error("Drive reconciliation configuration is missing");
      const client = makeNangoDriveReconciliationClient({
        client: nangoClientFor(now, start.providerConfigKey),
        connectionId: start.nangoConnectionId,
      });
      const captured = await captureDriveReconciliationStart({
        client,
        scope: {
          connectionKey: start.connectionKey,
          connectionGeneration: start.connectionGeneration,
          driveId: configuration.driveId,
          rootFolderIds: configuration.rootFolderIds,
          allowlistGeneration: start.allowlistGeneration,
          sharedDrive: configuration.sharedDrive,
        },
      });
      if (captured.connectorScopeKey !== start.connectorScopeKey)
        throw new Error("Drive reconciliation scope configuration is stale");
      initialCursor = captured.initialCursor;
      providerHighWater = captured.providerHighWater;
    }

    const leaseId = crypto.randomUUID();
    const opened = (await ctx.runMutation(openRunRef, {
      organizationKey: start.organizationKey,
      workspaceId: start.workspaceId,
      brainKey: start.brainKey,
      corpusKey: start.corpusKey,
      providerKind: start.providerKind,
      connectorScopeKey: start.connectorScopeKey,
      connectionKey: start.connectionKey,
      connectionGeneration: start.connectionGeneration,
      allowlistGeneration: start.allowlistGeneration,
      expectedPreviousRunGeneration: start.expectedPreviousRunGeneration,
      initialCursor,
      providerHighWater,
      ledgerHighWater: 0,
      leaseId,
      leaseGeneration: 1,
      leaseExpiresAt: now + 60_000,
      now,
    })) as {
      readonly reconciliationRunKey: string;
      readonly runGeneration: number;
    };
    const scheduledFunctionId = await ctx.scheduler.runAfter(0, workerRef, {
      reconciliationRunKey: opened.reconciliationRunKey,
      expectedRunGeneration: opened.runGeneration,
      expectedConnectionGeneration: start.connectionGeneration,
      expectedAllowlistGeneration: start.allowlistGeneration,
      expectedLeaseGeneration: 1,
      leaseId,
    });
    return {
      reconciliationRunKey: opened.reconciliationRunKey,
      runGeneration: opened.runGeneration,
      providerKind: start.providerKind,
      providerHighWater,
      scheduledFunctionId,
      resumed: false,
    };
  },
});

export const runProviderReconciliationWorker = internalAction({
  args: runRefArgs,
  returns: v.object({
    reconciliationRunKey: v.string(),
    status: v.string(),
  }),
  handler: async (ctx, input) => {
    const now = Date.now();
    const leaseId = input.leaseId ?? crypto.randomUUID();
    const claimed = (await ctx.runMutation(claimStepRef, {
      reconciliationRunKey: input.reconciliationRunKey,
      expectedRunGeneration: input.expectedRunGeneration,
      expectedConnectionGeneration: input.expectedConnectionGeneration,
      expectedAllowlistGeneration: input.expectedAllowlistGeneration,
      expectedLeaseGeneration: input.expectedLeaseGeneration,
      leaseId,
      leaseDurationMs: 60_000,
      now,
    })) as ClaimedStep;
    const leasedRef = runRefFor(claimed);
    let status: string;
    let continueImmediately = false;
    if (claimed.status === "scan" && claimed.traversalComplete) {
      await ctx.runMutation(closeTraversalRef, { ...leasedRef, now });
      status = "traversal_closed";
      continueImmediately = true;
    } else if (claimed.status === "scan") {
      const page = await runScanStep(ctx, claimed, now);
      status = page.cursor.traversalComplete ? "scan_complete" : "scan";
      continueImmediately = true;
    } else if (
      claimed.status === "traversal_closed" ||
      claimed.status === "apply_removals"
    ) {
      const removals = (await ctx.runQuery(listRemovalsRef, {
        organizationKey: claimed.organizationKey,
        sourceKind: claimed.providerKind,
        connectorScopeKey: claimed.connectorScopeKey,
        connectionKey: claimed.connectionKey,
        connectionGeneration: claimed.connectionGeneration,
        allowlistGeneration: claimed.allowlistGeneration,
        cursor: claimed.removalCursor,
        limit: 100,
      })) as {
        readonly candidates: readonly unknown[];
        readonly nextCursor: string | null;
      };
      const applied = (await ctx.runMutation(applyRemovalsRef, {
        ...leasedRef,
        requiredScopeIntentKey: claimed.requiredScopeIntentKey,
        expectedRemovalCursor: claimed.removalCursor,
        nextRemovalCursor: removals.nextCursor,
        finalBatch: removals.nextCursor === null,
        candidates: removals.candidates,
        now,
      })) as { readonly status: string };
      status = applied.status;
      continueImmediately =
        applied.status === "apply_removals" ||
        applied.status === "drain_derived";
    } else {
      const completed = (await ctx.runMutation(maybeCompleteRef, {
        ...leasedRef,
        now,
      })) as { readonly status: string };
      status = completed.status;
    }
    if (continueImmediately)
      await ctx.scheduler.runAfter(0, workerRef, continuationFor(claimed));
    return {
      reconciliationRunKey: claimed.reconciliationRunKey,
      status,
    };
  },
});

export const recoverProviderReconciliationWorkers = internalAction({
  args: { limit: v.number() },
  returns: v.object({ scheduled: v.number(), hasMore: v.boolean() }),
  handler: async (ctx, input) => {
    const limit = Math.max(1, Math.min(100, Math.floor(input.limit)));
    const result = (await ctx.runQuery(listRecoverableRef, {
      limit,
      now: Date.now(),
    })) as { readonly runs: readonly RunRef[]; readonly hasMore: boolean };
    for (const run of result.runs)
      await ctx.scheduler.runAfter(0, workerRef, run);
    return { scheduled: result.runs.length, hasMore: result.hasMore };
  },
});
