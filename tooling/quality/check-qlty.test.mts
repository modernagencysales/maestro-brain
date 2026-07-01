import { describe, expect, it } from "vitest";
import { hasMode, isCi } from "./src/script-mode.mts";

describe("check:qlty", () => {
  it("supports fake mode", () => {
    expect(hasMode("fake", ["node", "script", "--mode", "fake"])).toBe(true);
  });

  it("fails closed in CI callers can detect", () => {
    expect(isCi({ CI: "true" })).toBe(true);
  });
});
