import { describe, expect, it } from "vitest";

describe("extract-ai-verdict", () => {
  it("documents accepted text verdict", () => {
    expect(/verdict\s*=\s*pass/i.test("verdict=pass")).toBe(true);
  });

  it("documents rejected text verdict", () => {
    expect(/verdict\s*=\s*pass/i.test("verdict=fail")).toBe(false);
  });
});
