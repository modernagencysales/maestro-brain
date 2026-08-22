import { driveConnectorScope } from "@maestro-template/integrations/googleDrive/canonical";
import { convexTest } from "convex-test";
import { type FunctionReference, makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import convexSchema from "../confect/_generated/convexSchema";

const driveProxy = vi.hoisted(() => ({
  endpoints: [] as string[],
  highWater: "drive-high-water-42",
}));

vi.mock("@maestro-template/integrations/nango/client", async (original) => {
  const actual =
    await original<
      typeof import("@maestro-template/integrations/nango/client")
    >();
  return {
    ...actual,
    createFakeNangoClient: () => ({
      proxy: async ({ endpoint }: { readonly endpoint: string }) => {
        driveProxy.endpoints.push(endpoint);
        if (endpoint.startsWith("/drive/v3/changes/startPageToken"))
          return {
            status: 200,
            data: { startPageToken: driveProxy.highWater },
          };
        if (endpoint.startsWith("/drive/v3/files"))
          return { status: 200, data: { files: [] } };
        if (endpoint.startsWith("/drive/v3/changes"))
          return {
            status: 200,
            data: {
              changes: [],
              newStartPageToken: `${driveProxy.highWater}-caught-up`,
            },
          };
        throw new Error(`Unexpected provider request: ${endpoint}`);
      },
    }),
  };
});

const modules = import.meta.glob("../convex/**/!(*.*.*)*.*s");
const startProviderReconciliation = makeFunctionReference(
  "integrations/providerReconciliationWorker:startProviderReconciliation",
) as unknown as FunctionReference<
  "action",
  "internal",
  { readonly connectorScopeKey: string },
  {
    readonly reconciliationRunKey: string;
    readonly runGeneration: number;
    readonly providerKind: "slack" | "transcript" | "google_drive";
    readonly providerHighWater: string | null;
    readonly scheduledFunctionId: string;
    readonly resumed: boolean;
  }
>;
const loadReconciliationPage = makeFunctionReference(
  "integrations/providerReconciliation:loadReconciliationPage",
) as unknown as FunctionReference<"query", "internal">;

const now = 1_787_392_800_000;
const organizationKey = "ag_provider_kickoff";
const brainKey = "br_provider_kickoff";
const connectionKey = "connection_provider_kickoff";
const connectionGeneration = 3;
const allowlistGeneration = 4;
const scope = {
  connectionKey,
  connectionGeneration,
  driveId: "shared-drive-kickoff",
  rootFolderIds: ["folder-kickoff"],
  allowlistGeneration,
  sharedDrive: true,
} as const;
const connectorScopeKey = driveConnectorScope(scope).connectorScopeKey;
const digest = `sha256:${"a".repeat(64)}`;

const seedDriveScope = async (t: ReturnType<typeof convexTest>) =>
  await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      subject: "provider-kickoff-owner",
      email: "provider-kickoff@example.com",
      displayName: "Provider Kickoff Owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const organizationId = await ctx.db.insert("organizations", {
      ownerUserId: userId,
      name: "Provider Kickoff",
      slug: "provider-kickoff",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const workspaceId = await ctx.db.insert("workspaces", {
      organizationId,
      ownerUserId: userId,
      brainKey,
      slug: "provider-kickoff",
      name: "Provider Kickoff",
      status: "active",
      dataClassification: "internal",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("providerConnections", {
      provider: "nango",
      providerConfigKey: "google-drive",
      organizationKey,
      connectionKey,
      connectionGeneration,
      status: "active",
      connectSessionId: "provider-kickoff-session",
      nangoConnectionId: "provider-kickoff-nango",
      nangoEndUserId: "provider-kickoff-user",
      nangoOrganizationId: "provider-kickoff-org",
      correlationTag: "provider-kickoff",
      attemptId: "provider-kickoff-attempt",
      attemptExpiresAt: now + 60_000,
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("connectorScopes", {
      schemaVersion: 1,
      organizationKey,
      connectorScopeKey,
      providerKind: "google_drive",
      providerContainerKey: scope.driveId,
      connectionKey,
      currentConnectionGeneration: connectionGeneration,
      currentAllowlistGeneration: allowlistGeneration,
      scopeGeneration: 1,
      state: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("brainRequiredScopeIntents", {
      schemaVersion: 1,
      organizationKey,
      workspaceId,
      brainKey,
      corpusKey: "documents",
      providerKind: "google_drive",
      connectorScopeKey,
      connectionKey,
      connectionGeneration,
      allowlistGeneration,
      requiredScopeIntentKey: `brsi_${"b".repeat(64)}`,
      intentGeneration: 1,
      controllingConfigurationDigest: digest,
      state: "required",
      decommissionGeneration: null,
      activatedAt: now,
      decommissionedAt: null,
      updatedAt: now,
    });
    await ctx.db.insert("driveScopeConfigurations", {
      schemaVersion: 1,
      organizationKey,
      workspaceId,
      brainKey,
      connectorScopeKey,
      connectionKey,
      connectionGeneration,
      allowlistGeneration,
      configurationGeneration: 1,
      driveId: scope.driveId,
      rootFolderIds: scope.rootFolderIds,
      sharedDrive: scope.sharedDrive,
      retentionClass: "internal",
      permissionPolicyDigest: digest,
      configurationDigest: digest,
      createdAt: now,
      updatedAt: now,
    });
  });

const seedCursorBasedScope = async (
  t: ReturnType<typeof convexTest>,
  providerKind: "slack" | "transcript",
) => {
  const sourceConnectionKey = `${providerKind}-kickoff-connection`;
  const sourceScopeKey = `${providerKind}-kickoff-scope`;
  await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      subject: `${providerKind}-kickoff-owner`,
      email: `${providerKind}-kickoff@example.com`,
      displayName: `${providerKind} Kickoff Owner`,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const organizationId = await ctx.db.insert("organizations", {
      ownerUserId: userId,
      name: `${providerKind} Kickoff`,
      slug: `${providerKind}-kickoff`,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const workspaceId = await ctx.db.insert("workspaces", {
      organizationId,
      ownerUserId: userId,
      brainKey,
      slug: `${providerKind}-kickoff`,
      name: `${providerKind} Kickoff`,
      status: "active",
      dataClassification: "internal",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("providerConnections", {
      provider: "nango",
      providerConfigKey: providerKind === "slack" ? "slack" : "fathom",
      organizationKey,
      connectionKey: sourceConnectionKey,
      connectionGeneration: 1,
      status: "active",
      connectSessionId: `${providerKind}-kickoff-session`,
      nangoConnectionId: `${providerKind}-kickoff-nango`,
      nangoEndUserId: `${providerKind}-kickoff-user`,
      nangoOrganizationId: `${providerKind}-kickoff-org`,
      correlationTag: `${providerKind}-kickoff`,
      attemptId: `${providerKind}-kickoff-attempt`,
      attemptExpiresAt: now + 60_000,
      completedAt: now,
      ...(providerKind === "slack"
        ? {
            teamId: "T_KICKOFF",
            apiAppId: "A_KICKOFF",
            botUserId: "U_KICKOFF",
          }
        : {}),
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("connectorScopes", {
      schemaVersion: 1,
      organizationKey,
      connectorScopeKey: sourceScopeKey,
      providerKind,
      providerContainerKey:
        providerKind === "slack" ? "C_KICKOFF" : sourceConnectionKey,
      connectionKey: sourceConnectionKey,
      currentConnectionGeneration: 1,
      currentAllowlistGeneration: 1,
      scopeGeneration: 1,
      state: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("brainRequiredScopeIntents", {
      schemaVersion: 1,
      organizationKey,
      workspaceId,
      brainKey,
      corpusKey: providerKind === "slack" ? "slack" : "transcripts",
      providerKind,
      connectorScopeKey: sourceScopeKey,
      connectionKey: sourceConnectionKey,
      connectionGeneration: 1,
      allowlistGeneration: 1,
      requiredScopeIntentKey: `brsi_${(providerKind === "slack"
        ? "c"
        : "d"
      ).repeat(64)}`,
      intentGeneration: 1,
      controllingConfigurationDigest: digest,
      state: "required",
      decommissionGeneration: null,
      activatedAt: now,
      decommissionedAt: null,
      updatedAt: now,
    });
  });
  return sourceScopeKey;
};

describe("provider reconciliation kickoff action", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    driveProxy.endpoints.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("captures a Drive high-water, opens a fresh run, and schedules the internal worker", async () => {
    const t = convexTest(convexSchema, modules);
    await seedDriveScope(t);

    const started = await t.action(startProviderReconciliation, {
      connectorScopeKey,
    });
    const state = await t.run(async (ctx) => ({
      runs: await ctx.db.query("connectorReconciliationRuns").collect(),
      cursors: await ctx.db.query("connectorIncrementalCursors").collect(),
      scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
    }));

    expect(started).toMatchObject({
      runGeneration: 1,
      providerKind: "google_drive",
      providerHighWater: driveProxy.highWater,
      resumed: false,
    });
    expect(driveProxy.endpoints).toHaveLength(1);
    expect(state.runs).toHaveLength(1);
    expect(state.runs[0]).toMatchObject({
      reconciliationRunKey: started.reconciliationRunKey,
      status: "scan",
      providerHighWater: driveProxy.highWater,
    });
    expect(state.cursors).toHaveLength(1);
    expect(state.cursors[0]?.providerCursor).toContain(
      encodeURIComponent(driveProxy.highWater),
    );
    expect(state.scheduled).toHaveLength(1);
    expect(state.scheduled[0]).toMatchObject({
      _id: started.scheduledFunctionId,
      name: "integrations/providerReconciliationWorker:runProviderReconciliationWorker",
      state: { kind: "pending" },
    });
  });

  it("reuses and reschedules a nonterminal run without recapturing provider state", async () => {
    const t = convexTest(convexSchema, modules);
    await seedDriveScope(t);
    const first = await t.action(startProviderReconciliation, {
      connectorScopeKey,
    });

    const resumed = await t.action(startProviderReconciliation, {
      connectorScopeKey,
    });
    const state = await t.run(async (ctx) => ({
      runs: await ctx.db.query("connectorReconciliationRuns").collect(),
      scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
    }));

    expect(resumed).toMatchObject({
      reconciliationRunKey: first.reconciliationRunKey,
      runGeneration: first.runGeneration,
      providerHighWater: first.providerHighWater,
      resumed: true,
    });
    expect(driveProxy.endpoints).toHaveLength(1);
    expect(state.runs).toHaveLength(1);
    expect(state.scheduled).toHaveLength(2);
    expect(state.scheduled.map(({ name }) => name)).toEqual([
      "integrations/providerReconciliationWorker:runProviderReconciliationWorker",
      "integrations/providerReconciliationWorker:runProviderReconciliationWorker",
    ]);
  });

  it("runs scheduled Drive continuations through traversal, removals, and completion", async () => {
    const t = convexTest(convexSchema, modules);
    await seedDriveScope(t);
    const started = await t.action(startProviderReconciliation, {
      connectorScopeKey,
    });

    const cursorBefore = await t.run(async (ctx) =>
      ctx.db.query("connectorIncrementalCursors").unique(),
    );
    if (cursorBefore === null) throw new Error("missing kickoff cursor");
    await expect(
      t.query(loadReconciliationPage, {
        reconciliationRunKey: started.reconciliationRunKey,
        expectedRunGeneration: started.runGeneration,
        expectedConnectionGeneration: connectionGeneration,
        expectedAllowlistGeneration: allowlistGeneration,
        sourceKind: "google_drive",
        cursorKey: cursorBefore.cursorKey,
        expectedCursor: cursorBefore.providerCursor,
        expectedCursorGeneration: cursorBefore.cursorGeneration,
      }),
    ).resolves.toBeNull();

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const state = await t.run(async (ctx) => ({
      runs: await ctx.db.query("connectorReconciliationRuns").collect(),
      cursors: await ctx.db.query("connectorIncrementalCursors").collect(),
      scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
    }));

    expect(state.runs).toHaveLength(1);
    expect(state.runs[0]).toMatchObject({
      reconciliationRunKey: started.reconciliationRunKey,
      status: "complete",
      providerHighWater: driveProxy.highWater,
      removalBacklogCount: 0,
      drainBacklogCount: 0,
      blockingObligationCount: 0,
    });
    expect(state.runs[0]?.completionReceipt).toMatchObject({
      providerHighWater: driveProxy.highWater,
      blockingObligationCount: 0,
    });
    expect(state.cursors[0]).toMatchObject({
      traversalComplete: true,
      lastProviderHighWater: driveProxy.highWater,
    });
    expect(state.scheduled).toHaveLength(5);
    expect(
      state.scheduled.every(
        ({ state: jobState }) => jobState.kind === "success",
      ),
    ).toBe(true);
    expect(driveProxy.endpoints).toHaveLength(3);
  });

  it.each(["slack", "transcript"] as const)(
    "starts %s reconciliation at its declared null traversal cursor without a provider high-water",
    async (providerKind) => {
      const t = convexTest(convexSchema, modules);
      const sourceScopeKey = await seedCursorBasedScope(t, providerKind);

      const started = await t.action(startProviderReconciliation, {
        connectorScopeKey: sourceScopeKey,
      });
      const state = await t.run(async (ctx) => ({
        runs: await ctx.db.query("connectorReconciliationRuns").collect(),
        cursors: await ctx.db.query("connectorIncrementalCursors").collect(),
        scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
      }));

      expect(started).toMatchObject({
        runGeneration: 1,
        providerKind,
        providerHighWater: null,
        resumed: false,
      });
      expect(state.runs).toHaveLength(1);
      expect(state.runs[0]).toMatchObject({
        reconciliationRunKey: started.reconciliationRunKey,
        providerKind,
        providerHighWater: null,
      });
      expect(state.cursors).toHaveLength(1);
      expect(state.cursors[0]).toMatchObject({
        providerKind,
        providerCursor: null,
        traversalComplete: false,
      });
      expect(state.scheduled).toHaveLength(1);
    },
  );
});
