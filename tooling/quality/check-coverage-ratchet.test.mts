import { describe, expect, it } from "vitest";
import { expectDescriptorPassesAndFails } from "./src/check-test-helpers.mts";
import { descriptor } from "./check-coverage-ratchet.mts";

describe("check:coverage-ratchet", () => {
  it("passes and fails on its declared requirements", async () => {
    await expectDescriptorPassesAndFails(descriptor);
  });

  it("requires real Vitest coverage thresholds", () => {
    expect(descriptor.requirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: "vitest.config.ts",
          includes: expect.arrayContaining(["coverage", "thresholds"]),
        }),
        expect.objectContaining({
          file: "package.json",
          includes: expect.arrayContaining(["vitest run --coverage"]),
        }),
      ]),
    );
  });
});
