import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RevisionDiff, buildBrainRevisionDiff } from "./revision-diff";

describe("RevisionDiff", () => {
  it("shows added and removed lines", () => {
    expect(
      buildBrainRevisionDiff({
        beforeRevisionKey: "rev_before",
        afterRevisionKey: "rev_after",
        before: "old",
        after: "new",
      }),
    ).toEqual([
      { kind: "removed", text: "old" },
      { kind: "added", text: "new" },
    ]);
  });

  it("renders untrusted Markdown as text, not HTML", () => {
    const html = renderToStaticMarkup(
      <RevisionDiff
        diff={{
          beforeRevisionKey: "rev_before",
          afterRevisionKey: "rev_after",
          before: "<script>alert(1)</script>",
          after: "safe",
        }}
      />,
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
