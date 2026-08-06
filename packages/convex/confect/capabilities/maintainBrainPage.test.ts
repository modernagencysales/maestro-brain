import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  normalizeMaintainBrainPageInput,
  validateMaintainBrainPageInput,
} from "./maintainBrainPage.domain";
import {
  maintainBrainPageFromContextPack,
  requireGroupedMaintenanceCaller,
} from "./maintainBrainPage.impl";

const metadata = JSON.parse(
  readFileSync(
    new URL("./maintainBrainPage.headless.json", import.meta.url),
    "utf8",
  ),
) as {
  readonly typedErrors: readonly string[];
  readonly schemas: Readonly<Record<string, string>>;
};

const contextPack = {
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

describe("maintainBrainPage generated capability domain", () => {
  it("allows grouped call maintenance only from workflow or internal callers", () => {
    expect(requireGroupedMaintenanceCaller(undefined)).toBe(false);
    expect(
      requireGroupedMaintenanceCaller({
        kind: "system",
        name: "sourceToBrainMaintenance",
        surface: "workflow",
      }),
    ).toBe(true);
  });
  it("normalization is idempotent for any input", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (workspaceSlug, input) => {
        const once = normalizeMaintainBrainPageInput({
          workspaceSlug,
          contextPackId: input,
        });
        expect(normalizeMaintainBrainPageInput(once)).toEqual(once);
      }),
    );
  });

  it("rejects blank fields after normalization", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^\s*$/), (blank) => {
        const normalized = normalizeMaintainBrainPageInput({
          workspaceSlug: blank,
          contextPackId: blank,
        });
        expect(validateMaintainBrainPageInput(normalized)).toHaveLength(2);
      }),
    );
  });

  it("accepts trimmed non-blank context pack input", () => {
    const normalized = normalizeMaintainBrainPageInput({
      workspaceSlug: "  acme-demo  ",
      contextPackId: "  ctx_approved_sources  ",
    });

    expect(normalized.workspaceSlug).toBe("acme-demo");
    expect(normalized.contextPackId).toBe("ctx_approved_sources");
    expect(validateMaintainBrainPageInput(normalized)).toEqual([]);
  });

  it("declares the required typed errors", () => {
    expect(metadata.typedErrors).toEqual(
      expect.arrayContaining([
        "Unauthorized",
        "ValidationFailed",
        "Forbidden",
        "CitationRequired",
        "CitationNotInManifest",
        "RevisionBudgetExceeded",
        "AutopilotNotEligible",
        "StaleRevision",
        "LifecycleRevoked",
      ]),
    );
    expect(metadata.schemas).toEqual({
      args: "maintainBrainPageArgs",
      returns: "maintainBrainPageReturns",
    });
  });

  it("returns cited review-first revisions from immutable context packs", () => {
    expect(
      maintainBrainPageFromContextPack({
        workspaceSlug: "acme-demo",
        contextPackId: "ctx_approved_sources",
        context: contextPack,
        modelOutput: {
          kind: "revision",
          title: "Client Brief",
          markdown: "# Client Brief\nACME shifted to enterprise onboarding.",
          citationKeys: ["cite_1"],
          selfConfidence: 0.74,
        },
      }),
    ).toEqual(
      expect.objectContaining({
        status: "awaiting_review",
        citationKeys: ["cite_1"],
        revisionEffect: null,
      }),
    );
  });

  it("makes declared citation failures reachable through capability domain", () => {
    expect(() =>
      maintainBrainPageFromContextPack({
        workspaceSlug: "acme-demo",
        contextPackId: "ctx_approved_sources",
        context: contextPack,
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
});
