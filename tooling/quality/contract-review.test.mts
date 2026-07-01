import { describe, expect, it } from "vitest";
import { hasMode } from "./src/script-mode.mts";

describe("contract-review", () => {
  it("supports fake mode", () => {
    expect(hasMode("fake", ["node", "script", "--mode", "fake"])).toBe(true);
  });

  it("rejects missing fake mode", () => {
    expect(hasMode("fake", ["node", "script"])).toBe(false);
  });
});
