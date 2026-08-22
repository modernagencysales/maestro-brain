import { describe, expect, it } from "vitest";

import {
  buildRetrievalPassages,
  buildRetrievalTokenRows,
  retrievalEntryKey,
  retrievalPublicationSetKey,
  retrievalScore,
  selectTopRetrievalCandidates,
  uniqueQueryTokens,
} from "./retrievalPublication";

describe("retrieval publication domain", () => {
  it("creates deterministic heading-aware bounded passages", () => {
    const markdown = [
      "# Positioning",
      "Apero helps agencies install repeatable sales systems.",
      "",
      "## Economics",
      "Revenue follows qualified pipeline and close rate.",
      "",
      "## Team",
      "The advisory team owns company context.",
    ].join("\n");
    const first = buildRetrievalPassages(markdown, "rev_snapshot", {
      maxBytes: 90,
      overlapBytes: 20,
    });
    const second = buildRetrievalPassages(markdown, "rev_snapshot", {
      maxBytes: 90,
      overlapBytes: 20,
    });

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(1);
    expect(
      first.every(({ text }) => new TextEncoder().encode(text).length <= 90),
    ).toBe(true);
    expect(
      first.some(({ headingPath }) => headingPath?.includes("Economics")),
    ).toBe(true);
    expect(new Set(first.map(({ passageKey }) => passageKey)).size).toBe(
      first.length,
    );
  });

  it("derives stable entries and token postings", () => {
    const passage = buildRetrievalPassages(
      "# ICP\n\nAgency owners need qualified pipeline and reliable economics.",
      "rev_icp",
    )[0];
    if (!passage) throw new Error("expected passage");
    const origin = {
      organizationKey: "ag_acme",
      workspaceId: "workspace_acme",
      brainKey: "br_acme",
      corpusKey: "pages",
      originTable: "pageRevisions",
      kind: "page" as const,
      origin: {
        kind: "page" as const,
        pageKey: "pag_icp",
        revisionKey: "rev_icp",
      },
      sourceKey: "pag_icp",
      sourceRevisionKey: "rev_icp",
      title: "ICP",
      observedAt: 1,
      indexedAt: 2,
      authority: "derived" as const,
      authorityPolicyKey: "company-pages",
      policyGeneration: 1,
      lifecycleGeneration: 1,
      routeGeneration: 1,
    };
    const entryKey = retrievalEntryKey(origin, passage);
    expect(entryKey).toBe(retrievalEntryKey(origin, passage));
    expect(retrievalPublicationSetKey(origin, 1)).toBe(
      retrievalPublicationSetKey(origin, 1),
    );

    const rows = buildRetrievalTokenRows({
      organizationKey: origin.organizationKey,
      workspaceId: origin.workspaceId,
      brainKey: origin.brainKey,
      entryKey,
      title: origin.title,
      headingPath: passage.headingPath,
      text: passage.text,
    });
    expect(rows.map(({ token }) => token)).toEqual(
      expect.arrayContaining(["agency", "economics", "pipeline"]),
    );
    expect(rows.find(({ token }) => token === "icp")?.inTitle).toBe(true);
  });

  it("bounds query tokens and ranks stronger evidence higher", () => {
    expect(
      uniqueQueryTokens("What is the Apero ICP and pipeline model?"),
    ).toEqual(["apero", "icp", "pipeline", "model"]);
    const strong = retrievalScore({
      queryTokens: ["icp", "pipeline"],
      postings: [
        { token: "icp", termFrequency: 1, inTitle: true, inHeading: true },
        {
          token: "pipeline",
          termFrequency: 2,
          inTitle: false,
          inHeading: false,
        },
      ],
      authority: "authoritative",
      freshness: "current",
    });
    const weak = retrievalScore({
      queryTokens: ["icp", "pipeline"],
      postings: [
        {
          token: "pipeline",
          termFrequency: 1,
          inTitle: false,
          inHeading: false,
        },
      ],
      authority: "advisory",
      freshness: "stale",
    });
    expect(strong).toBeGreaterThan(weak);
  });

  it("applies the declared score before the candidate cap", () => {
    const candidates = Array.from({ length: 41 }, (_, index) => ({
      entryKey: `entry-${String(index).padStart(2, "0")}`,
      score: index === 40 ? 10_000 : 100 - index,
    }));

    const selected = selectTopRetrievalCandidates(candidates);

    expect(selected).toHaveLength(40);
    expect(selected[0]?.entryKey).toBe("entry-40");
    expect(selected.some(({ entryKey }) => entryKey === "entry-39")).toBe(
      false,
    );
  });

  it("never exceeds the passage byte limit after overlap", () => {
    const passages = buildRetrievalPassages(
      "abcdefghij\n\n12345678901234567890",
      "rev_overlap",
      { maxBytes: 20, overlapBytes: 12 },
    );
    expect(passages.length).toBeGreaterThan(1);
    expect(
      passages.every(
        ({ text }) => new TextEncoder().encode(text).byteLength <= 20,
      ),
    ).toBe(true);
  });

  it("uses reproducible UTF-8 byte offsets", () => {
    const normalized =
      "# Team 🚀\n\nApero serves café owners.\n\nNext paragraph.";
    const encoded = new TextEncoder().encode(normalized);
    const decoder = new TextDecoder();
    const passages = buildRetrievalPassages(normalized, "rev_unicode", {
      maxBytes: 28,
      overlapBytes: 8,
    });
    for (const passage of passages) {
      expect(
        decoder.decode(encoded.slice(passage.startOffset, passage.endOffset)),
      ).toBe(passage.text);
    }
  });

  it("keeps authority ahead of lexical coverage", () => {
    const authoritative = retrievalScore({
      queryTokens: ["pipeline", "economics"],
      postings: [
        {
          token: "pipeline",
          termFrequency: 1,
          inTitle: false,
          inHeading: false,
        },
      ],
      authority: "authoritative",
      freshness: "stale",
    });
    const advisory = retrievalScore({
      queryTokens: ["pipeline", "economics"],
      postings: [
        {
          token: "pipeline",
          termFrequency: 5,
          inTitle: true,
          inHeading: true,
        },
        {
          token: "economics",
          termFrequency: 5,
          inTitle: true,
          inHeading: true,
        },
      ],
      authority: "advisory",
      freshness: "current",
    });
    expect(authoritative).toBeGreaterThan(advisory);
  });
});
