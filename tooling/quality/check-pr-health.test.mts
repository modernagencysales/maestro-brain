import { describe, expect, it } from "vitest";
import { hasMode } from "./src/script-mode.mts";

describe("check:pr-health", () => {
  it("detects fake mode", () => {
    expect(hasMode("fake", ["node", "script", "--mode", "fake"])).toBe(true);
  });

  it("does not treat absent mode as fake", () => {
    expect(hasMode("fake", ["node", "script"])).toBe(false);
  });
});
