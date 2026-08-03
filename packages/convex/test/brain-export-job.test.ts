import { describe, expect, it } from "vitest";

import { brainExportPublishable } from "../convex/brain/exports";

describe("Brain export publish fence", () => {
  it("requires the requested state and both current generations", () => {
    expect(
      brainExportPublishable({
        job: {
          state: "requested",
          lifecycleGeneration: 2,
          policyGeneration: 3,
        },
        lifecycleGeneration: 2,
        policyGeneration: 3,
      }),
    ).toBe(true);
    expect(
      brainExportPublishable({
        job: {
          state: "requested",
          lifecycleGeneration: 2,
          policyGeneration: 3,
        },
        lifecycleGeneration: 3,
        policyGeneration: 3,
      }),
    ).toBe(false);
    expect(
      brainExportPublishable({
        job: {
          state: "revoked",
          lifecycleGeneration: 2,
          policyGeneration: 3,
        },
        lifecycleGeneration: 2,
        policyGeneration: 3,
      }),
    ).toBe(false);
  });
});
