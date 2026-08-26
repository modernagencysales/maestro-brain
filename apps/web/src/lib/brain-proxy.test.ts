import { describe, expect, it } from "vitest";

import { convexSiteOrigin } from "./brain-proxy";

describe("Brain proxy target", () => {
  it("derives the stable Convex HTTP site from its deployment URL", () => {
    expect(convexSiteOrigin("https://perfect-sparrow-808.convex.cloud")).toBe(
      "https://perfect-sparrow-808.convex.site",
    );
    expect(convexSiteOrigin("https://perfect-sparrow-808.convex.site")).toBe(
      "https://perfect-sparrow-808.convex.site",
    );
  });
});
