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
    expect(templateRegistry.capabilities).toContainEqual(
      expect.objectContaining({
        name: "sourceGroundedBrief",
        exposure: "API + CLI",
        typedErrors: expect.arrayContaining([
          "PolicyNotFound",
          "PromptNotFound",
          "RateLimited",
          "SpendCapExceeded",
        ]),
      }),
    );
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
      workflowRunId: "run_template_001",
      workflowId: "workflow_source_grounded_plan",
      workflowVersion: 1,
      status: "completed",
      trustReceiptId: "trust_run_template_001",
      trustReceipt: {
        receiptId: "trust_run_template_001",
        workflowRunId: "run_template_001",
        modelReceiptId: "model_receipt_template_fake_local",
        trustClaim: "source-backed-no-default-rag",
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
