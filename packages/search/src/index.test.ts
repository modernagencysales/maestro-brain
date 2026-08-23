import { describe, expect, it } from "vitest";
import {
  createSearchService,
  MAX_SEARCH_LIMIT,
  SearchConfigError,
  SearchQueryError,
  type SearchChunk,
} from "./index";

const chunks: readonly SearchChunk[] = [
  {
    workspaceSlug: "acme-demo",
    chunkId: "chunk_positioning",
    sourceId: "source_founder_notes",
    sourceTitle: "Founder interview notes",
    text: "Positioning: the product is a typed workflow brain for operators.",
  },
  {
    workspaceSlug: "acme-demo",
    chunkId: "chunk_pricing",
    sourceId: "source_policies",
    sourceTitle: "Product docs and policies",
    text: "Pricing policy: credits are prepaid and workflow runs draw down.",
  },
  {
    workspaceSlug: "other-tenant",
    chunkId: "chunk_leak",
    sourceId: "source_other",
    sourceTitle: "Other tenant secrets",
    text: "Positioning notes that must never leak across workspaces.",
  },
];

describe("search service", () => {
  it("never returns chunks from another workspace", () => {
    const service = createSearchService({ mode: "fake", chunks });

    const hits = service.query({
      workspaceSlug: "acme-demo",
      query: "positioning",
    });

    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => hit.chunkId !== "chunk_leak")).toBe(true);
  });

  it("ranks deterministically by token overlap with a stable tie-break", () => {
    const service = createSearchService({ mode: "fake", chunks });

    const hits = service.query({
      workspaceSlug: "acme-demo",
      query: "workflow positioning product",
    });

    expect(hits.map((hit) => hit.chunkId)).toEqual([
      "chunk_positioning",
      "chunk_pricing",
    ]);
    expect(hits[0]?.score).toBeGreaterThan(hits[1]?.score ?? 0);
  });

  it("builds bounded snippets and respects the limit", () => {
    const longText = "grounded ".repeat(60);
    const service = createSearchService({
      mode: "fake",
      chunks: [
        ...chunks,
        {
          workspaceSlug: "acme-demo",
          chunkId: "chunk_long",
          sourceId: "source_long",
          sourceTitle: "Long source",
          text: longText,
        },
      ],
    });

    const hits = service.query({
      workspaceSlug: "acme-demo",
      query: "grounded",
      limit: 1,
    });

    expect(hits).toHaveLength(1);
    expect(hits[0]?.snippet.length).toBeLessThanOrEqual(160);
  });

  it("rejects blank queries and out-of-range limits with typed errors", () => {
    const service = createSearchService({ mode: "fake", chunks });

    expect(() =>
      service.query({ workspaceSlug: "acme-demo", query: "   " }),
    ).toThrowError(SearchQueryError);
    expect(() =>
      service.query({
        workspaceSlug: "acme-demo",
        query: "positioning",
        limit: MAX_SEARCH_LIMIT + 1,
      }),
    ).toThrowError(SearchQueryError);
  });

  it("fails closed in live mode without an injected adapter", () => {
    const service = createSearchService({ mode: "live", chunks });

    expect(() =>
      service.query({ workspaceSlug: "acme-demo", query: "positioning" }),
    ).toThrowError(SearchConfigError);
  });

  it("delegates validated input to the live adapter", () => {
    const calls: unknown[] = [];
    const service = createSearchService({
      mode: "live",
      liveAdapter: (input) => {
        calls.push(input);
        return [];
      },
    });

    service.query({ workspaceSlug: "acme-demo", query: "  positioning  " });

    expect(calls).toEqual([
      { workspaceSlug: "acme-demo", query: "positioning", limit: 10 },
    ]);
  });
});
