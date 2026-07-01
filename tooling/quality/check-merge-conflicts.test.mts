import { describe, expect, it } from "vitest";
import { hasMode } from "./src/script-mode.mts";

describe("check:merge-conflicts", () => {
  it("passes fake mode detection", () => {
    expect(hasMode("fake", ["node", "script", "--mode", "fake"])).toBe(true);
  });

  it("fails fake mode detection for another mode", () => {
    expect(hasMode("fake", ["node", "script", "--mode", "real"])).toBe(false);
  });
});
