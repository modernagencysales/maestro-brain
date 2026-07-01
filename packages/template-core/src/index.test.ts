import { describe, expect, it } from "vitest";
import {
  createSampleWorkflowRunReceipt,
  templateRegistry,
  validateTemplateRegistry,
} from "./index";

describe("templateRegistry", () => {
  it("is internally valid", () => {
    expect(validateTemplateRegistry(templateRegistry)).toEqual([]);
  });

  it("declares typed errors for every capability", () => {
    for (const capability of templateRegistry.capabilities) {
      expect(capability.typedErrors.length).toBeGreaterThan(0);
    }
  });

  it("keeps source-grounding and headless primitives visible", () => {
    expect(templateRegistry.brainSources.length).toBeGreaterThanOrEqual(3);
    expect(
      templateRegistry.headlessSurfaces.map((surface) => surface.name),
    ).toEqual(["Scalar API", "CLI", "MCP"]);
  });

  it("creates a deterministic workflow run receipt", () => {
    const receipt = createSampleWorkflowRunReceipt();

    expect(receipt).toMatchObject({
      runId: "run_template_001",
      status: "completed",
      trustReceipt: {
        receiptId: "receipt_template_001",
        model: "fake/local deterministic model",
      },
    });
    expect(receipt.steps.map((step) => step.nodeId)).toEqual([
      "source",
      "context",
      "agent",
      "approval",
      "output",
    ]);
    expect(receipt.auditEvents).toContain("trust_receipt.created");
  });
});
