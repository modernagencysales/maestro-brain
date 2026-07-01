import { describe, expect, it } from "vitest";
import { hasMode } from "./src/script-mode.mts";

describe("taste", () => {
  it("supports fake mode", () => {
    expect(hasMode("fake", ["node", "script", "--mode", "fake"])).toBe(true);
  });

  it("does not fake pass by default", () => {
    expect(hasMode("fake", ["node", "script"])).toBe(false);
  });
});
