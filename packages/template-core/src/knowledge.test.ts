import { describe, expect, it } from "vitest";
import {
  attachCitation,
  buildContextPack,
  createClaim,
  decodeKnowledgeMarkdown,
  encodeKnowledgeMarkdown,
  exportOkf,
  KnowledgeValidationError,
} from "./knowledge";

const createdAt = "2026-07-01T18:00:00.000Z";

describe("knowledge domain", () => {
  it("requires supported claims to have citations unless marked unsupported draft", () => {
    expect(() =>
      createClaim({
        claimId: "claim_001",
        workspaceId: "workspace_123",
        conceptIds: ["concept_gtm"],
        body: "Acme sells implementation services to B2B SaaS teams.",
        status: "supported",
        citationIds: [],
        createdAt,
      }),
    ).toThrow(KnowledgeValidationError);

    expect(
      createClaim({
        claimId: "claim_002",
        workspaceId: "workspace_123",
        conceptIds: ["concept_gtm"],
        body: "Acme may focus on implementation consulting.",
        status: "unsupported-draft",
        citationIds: [],
        createdAt,
      }),
    ).toMatchObject({
      claimId: "claim_002",
      status: "unsupported-draft",
      citationIds: [],
    });
  });

  it("attaches citations to claims with source ranges and quoted text", () => {
    const citation = attachCitation({
      citationId: "citation_001",
      workspaceId: "workspace_123",
      claimId: "claim_001",
      sourceId: "source_founder_notes",
      sourceKind: "markdown",
      sourceTitle: "Founder notes",
      quotedText: "implementation services to B2B SaaS teams",
      startOffset: 12,
      endOffset: 52,
      createdAt,
    });

    expect(citation).toEqual({
      citationId: "citation_001",
      workspaceId: "workspace_123",
      claimId: "claim_001",
      sourceId: "source_founder_notes",
      sourceKind: "markdown",
      sourceTitle: "Founder notes",
      quotedText: "implementation services to B2B SaaS teams",
      range: { startOffset: 12, endOffset: 52 },
      createdAt,
    });
  });

  it("builds context packs with sources, citations, freshness, and trust receipt link", () => {
    const pack = buildContextPack({
      contextPackId: "context_pack_gtm",
      workspaceId: "workspace_123",
      title: "GTM foundation",
      sourceIds: ["source_founder_notes", "source_homepage"],
      citationIds: ["citation_001"],
      claimIds: ["claim_001"],
      freshness: "fresh",
      trustReceiptId: "trust_receipt_001",
      createdAt,
    });

    expect(pack).toMatchObject({
      contextPackId: "context_pack_gtm",
      sourceIds: ["source_founder_notes", "source_homepage"],
      citationIds: ["citation_001"],
      freshness: "fresh",
      trustReceiptId: "trust_receipt_001",
      sourceBacked: true,
    });
  });

  it("round-trips headings, links, citations, and frontmatter through markdown", () => {
    const markdown = encodeKnowledgeMarkdown({
      title: "GTM Brain",
      frontmatter: {
        workspaceId: "workspace_123",
        sourceId: "source_founder_notes",
      },
      sections: [
        {
          heading: "Positioning",
          body: [
            "Acme sells [implementation services](https://example.com/services).",
            "Claim: source-backed GTM app[^citation_001].",
          ],
        },
      ],
      citations: [
        {
          id: "citation_001",
          sourceId: "source_founder_notes",
          quote: "source-backed GTM app",
        },
      ],
    });
    const decoded = decodeKnowledgeMarkdown(markdown);

    expect(markdown).toContain("---");
    expect(markdown).toContain("# GTM Brain");
    expect(markdown).toContain(
      "[implementation services](https://example.com/services)",
    );
    expect(markdown).toContain("[^citation_001]");
    expect(decoded).toMatchObject({
      title: "GTM Brain",
      frontmatter: {
        workspaceId: "workspace_123",
        sourceId: "source_founder_notes",
      },
      citations: [
        {
          id: "citation_001",
          sourceId: "source_founder_notes",
          quote: "source-backed GTM app",
        },
      ],
    });
    expect(decoded.sections[0]).toMatchObject({
      heading: "Positioning",
      body: [
        "Acme sells [implementation services](https://example.com/services).",
        "Claim: source-backed GTM app[^citation_001].",
      ],
    });
  });

  it("exports Open Knowledge Format with concepts, claims, citations, and source metadata", () => {
    const okf = exportOkf({
      workspaceId: "workspace_123",
      concepts: [
        {
          conceptId: "concept_gtm",
          workspaceId: "workspace_123",
          label: "GTM Brain",
          description: "Source-backed GTM operating context.",
        },
      ],
      claims: [
        createClaim({
          claimId: "claim_001",
          workspaceId: "workspace_123",
          conceptIds: ["concept_gtm"],
          body: "Acme sells implementation services to B2B SaaS teams.",
          status: "supported",
          citationIds: ["citation_001"],
          createdAt,
        }),
      ],
      citations: [
        attachCitation({
          citationId: "citation_001",
          workspaceId: "workspace_123",
          claimId: "claim_001",
          sourceId: "source_founder_notes",
          sourceKind: "markdown",
          sourceTitle: "Founder notes",
          quotedText: "implementation services to B2B SaaS teams",
          startOffset: 12,
          endOffset: 52,
          createdAt,
        }),
      ],
      sources: [
        {
          sourceId: "source_founder_notes",
          kind: "markdown",
          title: "Founder notes",
          freshness: "fresh",
        },
      ],
    });

    expect(okf).toMatchObject({
      format: "okf",
      version: "0.1",
      workspaceId: "workspace_123",
      posture: "source-backed-no-default-rag",
      concepts: [{ conceptId: "concept_gtm" }],
      claims: [{ claimId: "claim_001", citationIds: ["citation_001"] }],
      citations: [{ citationId: "citation_001" }],
      sources: [{ sourceId: "source_founder_notes", kind: "markdown" }],
    });
  });
});
