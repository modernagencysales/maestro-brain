import { describe, expect, it } from "vitest";
import { expectDescriptorPassesAndFails } from "./src/check-test-helpers.mts";
import { descriptor } from "./check-layer-boundaries.mts";

describe("check:layer-boundaries", () => {
  it("passes and fails on its declared requirements", async () => {
    await expectDescriptorPassesAndFails(descriptor);
  });

  it("requires dependency-cruiser boundaries instead of a placeholder file check", () => {
    expect(descriptor.requirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: "dependency-cruiser.config.cjs",
          includes: expect.arrayContaining(["forbidden", "from", "to"]),
        }),
        expect.objectContaining({
          file: "package.json",
          includes: expect.arrayContaining([
            "depcruise --config dependency-cruiser.config.cjs",
          ]),
        }),
      ]),
    );
  });
});
