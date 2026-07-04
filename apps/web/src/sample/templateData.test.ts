import { describe, expect, it } from "vitest";
import {
  agents,
  brainSources,
  capabilities,
  durableWorkflowGraph,
  headlessSurfaces,
  openApiSummary,
  providerAdapters,
  sampleRunReceipt,
  safetyChecklist,
} from "./templateData";
import { navItems } from "./navItems";

describe("template sample data", () => {
  it("keeps navigation ids unique and backed by sample sections", () => {
    const ids = navItems.map((item) => item.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      "overview",
      "brain",
      "workflows",
      "capabilities",
      "agents",
      "headless",
      "integrations",
      "safety",
    ]);
  });

  it("uses workflow edges that reference declared nodes", () => {
    const nodeIds = new Set(durableWorkflowGraph.nodes.map((node) => node.id));

    for (const edge of durableWorkflowGraph.edges) {
      expect(nodeIds.has(edge.sourceNodeId)).toBe(true);
      expect(nodeIds.has(edge.targetNodeId)).toBe(true);
    }
  });

  it("shows the core investor-review primitives", () => {
    expect(brainSources.length).toBeGreaterThanOrEqual(3);
    expect(capabilities.length).toBeGreaterThanOrEqual(3);
    expect(agents.length).toBeGreaterThanOrEqual(3);
    expect(headlessSurfaces.map((surface) => surface.name)).toContain(
      "Scalar API",
    );
    expect(providerAdapters.map((adapter) => adapter.name)).toContain(
      "WorkOS/AuthKit",
    );
    expect(safetyChecklist.join(" ")).toContain("Tenant identity");
  });

  it("derives the API docs summary from the generated OpenAPI artifact", () => {
    expect(openApiSummary).toEqual({
      version: "3.1.0",
      operationCount: 1,
      docsRoute: "/api/docs",
      typedErrors: [
        "Unauthorized",
        "MemberNotInWorkspace",
        "WorkspaceNotFound",
        "ValidationFailed",
      ],
      authScope: "workspace member",
    });
  });

  it("shows the deterministic workflow receipt used by headless surfaces", () => {
    expect(sampleRunReceipt).toMatchObject({
      runId: "run_template_001",
      workflowRunId: "run_template_001",
      workflowId: "workflow_source_grounded_plan",
      workflowName: "Source-grounded planning workflow",
      trustReceiptId: "trust_run_template_001",
      trustReceipt: {
        receiptId: "trust_run_template_001",
        trustClaim: "source-backed-no-default-rag",
      },
    });
    expect(sampleRunReceipt.steps).toHaveLength(
      durableWorkflowGraph.nodes.length,
    );
  });
});
