import { describe, expect, it } from "vitest";
import { templateRegistry, validateTemplateRegistry } from "./index";

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
});
