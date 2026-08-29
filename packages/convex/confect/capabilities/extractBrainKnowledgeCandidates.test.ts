import { describe, expect, it } from "vitest";
import {
  groundCandidateProposals,
  parseCandidateProposals,
} from "./extractBrainKnowledgeCandidates.domain";

const source = {
  sourceKey: "slack:C1:thread:1:segment:0",
  revisionKey: "thread-v1:abc",
  contentHash: "sha256:source",
  markdown:
    "We agreed the pilot costs $5,000 per month.\n\nThis is an opinion.",
  locator: "slack://channel/C1/message/1",
  extractionWindowKey: "full:0:67",
  extractionPolicyVersion: "brain-extractor-v1",
};

describe("Brain candidate extraction domain", () => {
  it("grounds an exact quote with stable receipt and proposition identities", () => {
    const proposals = parseCandidateProposals(
      JSON.stringify([
        {
          body: "The pilot costs $5,000 per month.",
          quote: "the pilot costs $5,000 per month",
          epistemics: "factual",
          quotability: 0.9,
          confidence: 0.95,
          tags: ["Pricing", "pilot", "pricing"],
        },
      ]),
    );
    const first = groundCandidateProposals(proposals, source);
    const second = groundCandidateProposals(proposals, source);
    expect(first).toEqual(second);
    expect(first.failureCount).toBe(0);
    expect(first.candidates[0]).toMatchObject({
      body: "The pilot costs $5,000 per month.",
      tags: ["pricing", "pilot"],
      evidence: [{ startOffset: 10, endOffset: 42 }],
    });
    expect(first.candidates[0]?.candidateReceiptKey).toMatch(
      /^candidate:[a-f0-9]{64}$/u,
    );
  });

  it("rejects invented quotes without rejecting grounded siblings", () => {
    const result = groundCandidateProposals(
      [
        {
          body: "Invented",
          quote: "not in source",
          epistemics: "factual",
          quotability: 1,
          confidence: 1,
          tags: ["test"],
        },
        {
          body: "This is an opinion.",
          quote: "This is an opinion.",
          epistemics: "subjective",
          quotability: 0.5,
          confidence: 0.8,
          tags: ["Positioning"],
        },
      ],
      source,
    );
    expect(result.failureCount).toBe(1);
    expect(result.candidates).toHaveLength(1);
  });

  it("fails malformed or over-capacity model output closed", () => {
    expect(() => parseCandidateProposals("not json")).toThrow(
      "extractor_malformed_output",
    );
    expect(() =>
      parseCandidateProposals(
        JSON.stringify(Array.from({ length: 6 }, () => ({}))),
      ),
    ).toThrow("extractor_malformed_output");
  });

  it("changes receipt identity for a policy change without changing proposition identity", () => {
    const proposal = [
      {
        body: "This is an opinion.",
        quote: "This is an opinion.",
        epistemics: "subjective" as const,
        quotability: 0.5,
        confidence: 0.8,
        tags: ["positioning"],
      },
    ];
    const first = groundCandidateProposals(proposal, source).candidates[0];
    const second = groundCandidateProposals(proposal, {
      ...source,
      extractionPolicyVersion: "brain-extractor-v2",
    }).candidates[0];
    expect(first?.propositionFingerprint).toBe(second?.propositionFingerprint);
    expect(first?.candidateReceiptKey).not.toBe(second?.candidateReceiptKey);
  });
});
