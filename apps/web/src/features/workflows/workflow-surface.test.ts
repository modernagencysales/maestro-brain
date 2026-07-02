import { describe, expect, it } from "vitest";
import { createSampleWorkflowRunReceipt } from "@maestro-template/template-core";
import {
  buildWorkflowRunDocumentSections,
  buildWorkflowRunViewModel,
  reduceFakeWorkflowRunCommand,
} from "./workflow-surface";

describe("workflow surface", () => {
  it("turns a run receipt into a readable run and receipt view model", () => {
    const receipt = createSampleWorkflowRunReceipt();
    const viewModel = buildWorkflowRunViewModel(receipt);

    expect(viewModel.statusLine).toBe(
      "completed run_template_001 in workspace acme-demo",
    );
    expect(viewModel.stageLines).toEqual([
      "Source Set completed through resolveSourceSet",
      "Build Context Pack completed through buildContextPack",
      "Planner Agent completed through Planner Agent",
      "Policy Approval completed",
      "Trust Receipt completed through createTrustReceipt",
    ]);
    expect(viewModel.evidenceLine).toContain("Founder interview notes");
    expect(viewModel.policyLine).toBe(
      "policy_snapshot_template_default using fake/local deterministic model",
    );
    expect(viewModel.trustReceiptLine).toBe(
      "trust_run_template_001 proves source-backed-no-default-rag for run_template_001",
    );
  });

  it("builds Notion document sections for workflow run inspection", () => {
    const sections = buildWorkflowRunDocumentSections(
      createSampleWorkflowRunReceipt(),
    );

    expect(sections.map((section) => section.heading)).toEqual([
      "Run status",
      "Stage list",
      "Evidence snapshot",
      "Policy and model snapshot",
      "Trust Receipt",
    ]);
    expect(sections[1]?.body).toContain(
      "Build Context Pack completed through buildContextPack",
    );
    expect(sections[4]?.body).toContain(
      "trust_run_template_001 proves source-backed-no-default-rag for run_template_001",
    );
  });

  it("reduces the fake/local run trigger into a deterministic completed receipt", () => {
    const result = reduceFakeWorkflowRunCommand({
      type: "trigger_fake_workflow_run",
      workspaceSlug: "acme-demo",
      workflowId: "workflow_source_grounded_plan",
      requestedBy: "operator@example.test",
    });

    expect(result.mode).toBe("fake/local");
    expect(result.commandLine).toBe(
      "maestro-template workflow run --workflow workflow_source_grounded_plan --workspace acme-demo --mode fake",
    );
    expect(result.receipt.workflowRunId).toBe("run_template_001");
    expect(result.receipt.trustReceipt.trustClaim).toBe(
      "source-backed-no-default-rag",
    );
    expect(result.auditLine).toContain("requested_by:operator@example.test");
  });

  it("rejects fake/local run triggers for unknown workflow ids", () => {
    expect(() =>
      reduceFakeWorkflowRunCommand({
        type: "trigger_fake_workflow_run",
        workspaceSlug: "acme-demo",
        workflowId: "unknown_workflow",
        requestedBy: "operator@example.test",
      }),
    ).toThrow("Unknown fake workflow: unknown_workflow");
  });
});
