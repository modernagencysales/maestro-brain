import { describe, expect, it } from "vitest";
import { expectDescriptorPassesAndFails } from "./src/check-test-helpers.mts";
import { descriptor } from "./check-knip.mts";

describe("check:knip", () => {
  it("passes and fails on its declared requirements", async () => {
    await expectDescriptorPassesAndFails(descriptor);
  });

  it("requires a real knip config and executable script", () => {
    expect(descriptor.requirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: "knip.json",
          includes: expect.arrayContaining(["entry", "project"]),
        }),
        expect.objectContaining({
          file: "package.json",
          includes: expect.arrayContaining(["knip --config knip.json"]),
        }),
      ]),
    );
  });
});
