import { describe, expect, it } from "vitest";
import { isCi } from "./src/script-mode.mts";

describe("check:unresolved-review-threads", () => {
  it("detects Buildkite CI", () => {
    expect(isCi({ BUILDKITE: "true" })).toBe(true);
  });

  it("treats local env as non-CI", () => {
    expect(isCi({})).toBe(false);
  });
});
