import { access } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  manifest,
  workflowTypedErrors,
} from "../confect/workflowContracts/sourceToBrainMaintenance.spec";
import {
  buildGatherMaintenanceContextArgs,
  buildMaintainBrainPageArgs,
  buildMineCallTranscriptArgs,
  sourceToBrainMaintenanceGraph,
} from "../confect/workflows/sourceToBrainMaintenance.graph";
import {
  runDurableGraphWorkflow,
  type RunDurableGraphStep,
} from "../confect/workflows/_kit/graphRunner";

describe("sourceToBrainMaintenance durable workflow scaffold", () => {
  it("keeps generated workflow controls internal-only", () => {
    expect(manifest.map((entry) => entry.operationId)).toEqual([
      "workflows.sourceToBrainMaintenance.start",
      "workflows.sourceToBrainMaintenance.status",
    ]);
    expect(manifest.every((entry) => entry.surfaces.length === 0)).toBe(true);
  });

  it("declares maintenance policy failures at the workflow contract boundary", () => {
    expect(workflowTypedErrors).toEqual(
      expect.arrayContaining([
        "CitationRequired",
        "CitationNotInManifest",
        "RevisionBudgetExceeded",
        "AutopilotNotEligible",
        "StaleRevision",
        "LifecycleRevoked",
        "MaintenanceContextUnavailable",
        "TranscriptMiningFailed",
      ]),
    );
  });

  it("keeps the generated durable runner path used by workflow start", async () => {
    await expect(
      access(
        new URL(
          "../convex/workflowRunners/sourceToBrainMaintenance.ts",
          import.meta.url,
        ),
      ),
    ).resolves.toBeUndefined();
  });

  it("passes gathered routed evidence through mining into maintenance", async () => {
    const calls: { kind: string; args: Record<string, unknown> }[] = [];
    const gathered = {
      workspaceId: "workspace_123",
      organizationId: "organization_123",
      organizationKey: "agency_123",
      brainKey: "br_client",
      unitRevisionKey: "surev_123",
      pages: [],
      citations: [],
    };
    const mined = {
      output: { summary: "", pageProposals: [] },
      receipt: { attemptKey: "workflow-test-1" },
    };
    const step: RunDurableGraphStep = {
      runQuery: async (_ref, args) => {
        calls.push({ kind: "query", args });
        return gathered;
      },
      runMutation: async (_ref, args) => {
        calls.push({ kind: "mutation", args });
        return {
          proposalKey: "proposal_1",
          status: "awaiting_review",
          citationKeys: ["cite_1"],
          revisionEffect: null,
        };
      },
      runAction: async (_ref, args) => {
        calls.push({ kind: "action", args });
        return mined;
      },
      sleep: async () => {},
      awaitEvent: async () => {
        throw new Error("Maintenance graph should not await events.");
      },
    };

    const inputs = {
      workspaceId: "workspace_123",
      idempotencyKey: "workflow-test-1",
      unitRevisionKey: "surev_123",
    };
    const policySnapshot = { mode: "test" };

    const result = await runDurableGraphWorkflow(step, {
      graph: sourceToBrainMaintenanceGraph,
      inputs,
      policySnapshot,
      capabilityRegistry: {
        "capabilities.gatherMaintenanceContext": {
          kind: "query",
          ref: {} as never,
          buildArgs: buildGatherMaintenanceContextArgs,
        },
        "capabilities.mineCallTranscript": {
          kind: "action",
          ref: {} as never,
          buildArgs: buildMineCallTranscriptArgs,
        },
        "capabilities.maintainBrainPage": {
          kind: "mutation",
          ref: {} as never,
          buildArgs: buildMaintainBrainPageArgs,
        },
      },
    });

    expect(calls).toEqual([
      {
        kind: "query",
        args: expect.objectContaining({
          workspaceId: "workspace_123",
          unitRevisionKey: "surev_123",
        }),
      },
      {
        kind: "action",
        args: expect.objectContaining({
          context: gathered,
          attemptKey: "workflow-test-1",
        }),
      },
      {
        kind: "mutation",
        args: expect.objectContaining({
          workspaceSlug: "workspace_123",
          contextPackId: "workflow-test-1",
          context: gathered,
          modelOutput: mined,
          caller: expect.objectContaining({
            kind: "system",
            surface: "workflow",
          }),
        }),
      },
    ]);
    expect(result).toEqual({
      inputs,
      context: {
        start: inputs,
        gatherMaintenanceContext: gathered,
        mineCallTranscript: mined,
        maintainBrainPage: {
          proposalKey: "proposal_1",
          status: "awaiting_review",
          citationKeys: ["cite_1"],
          revisionEffect: null,
        },
      },
      policySnapshot,
    });
  });
});
