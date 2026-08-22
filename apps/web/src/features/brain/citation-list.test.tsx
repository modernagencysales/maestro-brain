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
            publicationSetKey: "publication_redacted",
            entryKey: "entry_redacted",
            sourceRevisionKey: "rev_1",
            locator: "block 2",
            freshness: "current",
            state: "redacted",
            quotedText: "secret",
          },
          {
            citationKey: "cit_legacy",
            publicationSetKey: "publication_legacy",
            entryKey: "entry_legacy",
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

  it("labels timestamped call evidence for humans", () => {
    const html = renderToStaticMarkup(
      <CitationList
        citations={[
          {
            citationKey: "cit_call",
            publicationSetKey: "publication_call",
            entryKey: "entry_call",
            sourceRevisionKey: "surev_1",
            locator: "timestamp:12000-15400",
            label: "Alex · 00:12",
            freshness: "current",
            state: "resolved",
            quotedText: "We will launch on Friday.",
            permalink: "https://app.fireflies.ai/view/call_1",
          },
        ]}
      />,
    );

    expect(html).toContain("Alex · 00:12");
    expect(html).toContain("timestamp:12000-15400");
    expect(html).toContain("We will launch on Friday.");
    expect(html).toContain("publication_call");
    expect(html).toContain("entry_call");
  });
});
