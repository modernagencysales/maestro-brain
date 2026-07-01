import { describe, expect, it } from "vitest";
import {
  agents,
  brainSources,
  capabilities,
  headlessSurfaces,
  navItems,
  providerAdapters,
  safetyChecklist,
  workflowEdges,
  workflowNodes,
} from "./templateData";

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
    const nodeIds = new Set(workflowNodes.map((node) => node.id));

    for (const edge of workflowEdges) {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
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
});
