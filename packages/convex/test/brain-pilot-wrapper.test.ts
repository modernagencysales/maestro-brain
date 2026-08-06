import { describe, expect, it } from "vitest";

import * as pilot from "../convex/brain/pilot";

describe("brain pilot public wrapper", () => {
  it("exports the review queue function", () => {
    expect(pilot).toHaveProperty("listReviewQueue");
  });
});
