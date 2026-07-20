import { describe, expect, it } from "vitest";

import { commitMaintenanceProposal } from "../confect/maintenance/commit";
import { gatherMaintenanceContextPack } from "../confect/maintenance/gather";
import { requestMaintenanceProposal } from "../confect/maintenance/request";

const baseContext = {
  workspaceId: "workspace_123",
  brainKey: "br_client",
  pageKey: "pag_brief",
  currentRevisionKey: "rev_1",
  routeGeneration: 4,
  lifecycleGeneration: 8,
  policyGeneration: 2,
  modelId: "fake-maintenance-model",
  promptVersion: "maintenance-v1",
  modelPromptPair: "fake-maintenance-model@maintenance-v1",
  revisionBudget: 1,
  citations: [
    {
      citationKey: "cite_1",
      sourceUnitKey: "unit_1",
      revisionKey: "src_rev_1",
      quote: "ACME shifted to enterprise onboarding.",
    },
  ],
} as const;

describe("brain maintenance review-first policy", () => {
  it("accepts a cited no-op proposal without consuming revision budget", () => {
    const proposal = requestMaintenanceProposal({
      context: baseContext,
      modelOutput: {
        kind: "noop",
        rationale: "Current page already reflects routed evidence.",
        citationKeys: ["cite_1"],
        selfConfidence: 0.4,
      },
    });

    expect(
      commitMaintenanceProposal({ context: baseContext, proposal }),
    ).toEqual(
      expect.objectContaining({
        status: "accepted_noop",
        revisionEffect: null,
      }),
    );
  });

  it("requires factual revision proposals to cite only context-pack citations", () => {
    expect(() =>
      requestMaintenanceProposal({
        context: baseContext,
        modelOutput: {
          kind: "revision",
          title: "Client Brief",
          markdown: "# Client Brief\nACME shifted to enterprise onboarding.",
          citationKeys: [],
          selfConfidence: 0.74,
        },
      }),
    ).toThrow(/CitationRequired/);

    expect(() =>
      requestMaintenanceProposal({
        context: baseContext,
        modelOutput: {
          kind: "revision",
          title: "Client Brief",
          markdown: "# Client Brief\nUnsupported detail.",
          citationKeys: ["cite_outside"],
          selfConfidence: 0.74,
        },
      }),
    ).toThrow(/CitationNotInManifest/);
  });

  it("keeps review-first by default and fences stale generations", () => {
    const proposal = requestMaintenanceProposal({
      context: baseContext,
      modelOutput: {
        kind: "revision",
        title: "Client Brief",
        markdown: "# Client Brief\nACME shifted to enterprise onboarding.",
        citationKeys: ["cite_1"],
        selfConfidence: 0.74,
      },
    });

    expect(proposal.status).toBe("awaiting_review");
    expect(() =>
      commitMaintenanceProposal({
        context: { ...baseContext, currentRevisionKey: "rev_2" },
        proposal,
      }),
    ).toThrow(/StaleRevision/);
  });

  it("allows autopilot only for approved admin-graduated model prompt pairs", () => {
    const proposal = requestMaintenanceProposal({
      context: baseContext,
      modelOutput: {
        kind: "revision",
        title: "Client Brief",
        markdown: "# Client Brief\nACME shifted to enterprise onboarding.",
        citationKeys: ["cite_1"],
        selfConfidence: 0.74,
      },
    });

    expect(() =>
      commitMaintenanceProposal({
        context: baseContext,
        proposal,
        autopilot: { mode: "autopilot", approvedPairs: [], adminEnabled: true },
      }),
    ).toThrow(/AutopilotNotEligible/);

    expect(
      commitMaintenanceProposal({
        context: baseContext,
        proposal,
        autopilot: {
          mode: "autopilot",
          approvedPairs: [baseContext.modelPromptPair],
          adminEnabled: true,
          passingEvalReceipt: true,
          reviewedSampleCount: 25,
        },
      }),
    ).toEqual(expect.objectContaining({ status: "published" }));
  });

  it("gathers immutable bounded context and rejects lifecycle-revoked inputs", () => {
    expect(
      gatherMaintenanceContextPack({
        ...baseContext,
        routedUnitKeys: ["unit_1", "unit_2", "unit_3"],
        maxUnits: 2,
      }),
    ).toEqual(
      expect.objectContaining({ routedUnitKeys: ["unit_1", "unit_2"] }),
    );

    expect(() =>
      gatherMaintenanceContextPack({
        ...baseContext,
        lifecycleState: "revoked",
        routedUnitKeys: ["unit_1"],
      }),
    ).toThrow(/LifecycleRevoked/);
  });
});
