import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CitationList } from "./citation-list";

describe("CitationList", () => {
  it("marks redacted and unresolved citations without exposing text", () => {
    const html = renderToStaticMarkup(
      <CitationList
        citations={[
          {
            citationKey: "cit_redacted",
            sourceRevisionKey: "rev_1",
            locator: "block 2",
            freshness: "fresh",
            state: "redacted",
            quotedText: "secret",
          },
          {
            citationKey: "cit_legacy",
            sourceRevisionKey: "rev_legacy",
            locator: "unknown",
            freshness: "stale",
            state: "legacy_unresolved",
            quotedText: "also secret",
          },
        ]}
      />,
    );
    expect(html).toContain("Citation text redacted.");
    expect(html).toContain("Citation provenance unresolved.");
    expect(html).not.toContain("secret");
  });
});
