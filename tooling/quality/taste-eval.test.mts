import { describe, expect, it } from "vitest";
import { hasMode } from "./src/script-mode.mts";

describe("taste:eval", () => {
  it("supports fake mode", () => {
    expect(hasMode("fake", ["node", "script", "--mode", "fake"])).toBe(true);
  });

  it("does not match malformed mode args", () => {
    expect(hasMode("fake", ["node", "script", "--mode"])).toBe(false);
  });
});
