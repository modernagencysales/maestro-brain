import { describe, expect, it } from "vitest";

import { seo } from "./seo";

describe("Maestro Brain metadata", () => {
  it("uses the product identity by default", () => {
    expect(seo()).toEqual(
      expect.arrayContaining([
        { title: "Maestro Brain" },
        {
          name: "description",
          content:
            "Company knowledge that people and agents can find, trust, and improve.",
        },
        { name: "og:title", content: "Maestro Brain" },
        { name: "twitter:title", content: "Maestro Brain" },
      ]),
    );
    expect(seo()).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content: "@saas_js" }),
      ]),
    );
  });

  it("preserves explicit route metadata", () => {
    expect(
      seo({ title: "Brain Inbox", description: "Review sources" }),
    ).toEqual(
      expect.arrayContaining([
        { title: "Brain Inbox" },
        { name: "og:description", content: "Review sources" },
      ]),
    );
  });
});
