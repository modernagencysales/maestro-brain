import { describe, expect, it } from "vitest";

import { queryCenteredExcerpt } from "../confect/brain/retrievalPublication";

const bytes = (value: string) => new TextEncoder().encode(value).length;

describe("query-centered retrieval excerpts", () => {
  it("keeps a late matching passage inside the byte limit", () => {
    const text = `${"alpha ".repeat(4_000)}critical economics answer${" omega".repeat(4_000)}`;
    const result = queryCenteredExcerpt({
      text,
      queryTokens: ["economics"],
      maxBytes: 12 * 1024,
    });

    expect(result.truncated).toBe(true);
    expect(result.excerpt).toContain("critical economics answer");
    expect(bytes(result.excerpt)).toBeLessThanOrEqual(12 * 1024);
  });

  it("preserves valid multibyte text without truncating small passages", () => {
    const text = "Apero 🚀 economics and delivery";
    expect(
      queryCenteredExcerpt({ text, queryTokens: ["economics"], maxBytes: 128 }),
    ).toEqual({ excerpt: text, truncated: false });
  });
});
