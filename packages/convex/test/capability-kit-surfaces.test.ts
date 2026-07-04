import { describe, expect, it } from "vitest";
import {
  denyAllSurfaces,
  exposeSurfaces,
  isSurfaceAllowed,
} from "../confect/capabilities/_kit/surfaces";

describe("capability surface policy", () => {
  it("defaults to no exposure", () => {
    expect(isSurfaceAllowed(denyAllSurfaces, "api")).toBe(false);
    expect(isSurfaceAllowed(denyAllSurfaces, "web")).toBe(false);
  });

  it("exposes only listed surfaces", () => {
    const policy = exposeSurfaces(["web", "mcp"]);
    expect(isSurfaceAllowed(policy, "web")).toBe(true);
    expect(isSurfaceAllowed(policy, "mcp")).toBe(true);
    expect(isSurfaceAllowed(policy, "api")).toBe(false);
    expect(isSurfaceAllowed(policy, "cli")).toBe(false);
  });
});
