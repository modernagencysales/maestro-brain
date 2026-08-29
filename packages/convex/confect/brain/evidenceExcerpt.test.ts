import { describe, expect, it } from "vitest";
import { evidenceExcerpt } from "./evidenceExcerpt";

describe("evidence excerpts", () => {
  it("keeps exact bounded offsets while avoiding partial words", () => {
    const markdown = `Context ${"padding ".repeat(15)}abcde codex target`;
    const result = evidenceExcerpt(markdown, ["codex"]);

    expect(result.startOffset).toBe(8);
    expect(result.excerpt.startsWith("padding ")).toBe(true);
    expect(result.excerpt).toBe(
      markdown.slice(result.startOffset, result.endOffset),
    );

    const longToken = evidenceExcerpt("a".repeat(1_000), ["pricing"], 0, 640);
    expect(longToken).toMatchObject({ startOffset: 0, endOffset: 640 });
    expect(longToken.excerpt).toHaveLength(640);
  });
});
