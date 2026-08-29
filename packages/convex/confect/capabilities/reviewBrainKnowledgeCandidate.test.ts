import { describe, expect, it } from "vitest";
import metadata from "./reviewBrainKnowledgeCandidate.headless.json";
import {
  acceptedReviewBody,
  isExactEvidenceReopenable,
} from "./reviewBrainKnowledgeCandidate.domain";

const candidate = {
  sourceKey: "slack:C1:thread:1:segment:0",
  sourceRevisionKey: "thread-v1:abc",
  extractionPolicyVersion: "brain-extractor-v1",
};
const evidence = {
  sourceKey: candidate.sourceKey,
  revisionKey: candidate.sourceRevisionKey,
  contentHash: "sha256:source",
  quote: "approved price",
  startOffset: 4,
  endOffset: 18,
};
const current = {
  sourceKey: candidate.sourceKey,
  revisionKey: candidate.sourceRevisionKey,
  contentHash: evidence.contentHash,
  markdown: "The approved price is $5,000.",
  semanticStatus: "completed",
  semanticPolicyVersion: candidate.extractionPolicyVersion,
};

describe("reviewBrainKnowledgeCandidate domain", () => {
  it("requires exact current revision, hash, policy, quote, and offsets", () => {
    expect(isExactEvidenceReopenable(candidate, evidence, current)).toBe(true);
    expect(
      isExactEvidenceReopenable(candidate, evidence, {
        ...current,
        revisionKey: "thread-v1:new",
      }),
    ).toBe(false);
    expect(
      isExactEvidenceReopenable(
        candidate,
        { ...evidence, startOffset: 5 },
        current,
      ),
    ).toBe(false);
    expect(
      isExactEvidenceReopenable(candidate, evidence, {
        ...current,
        semanticStatus: "running",
      }),
    ).toBe(false);
  });

  it("uses the candidate body for accept and a trimmed body for edit-and-accept", () => {
    expect(
      acceptedReviewBody({ action: "accept", candidateBody: "Original" }),
    ).toBe("Original");
    expect(
      acceptedReviewBody({
        action: "edit_and_accept",
        candidateBody: "Original",
        editedBody: "  Revised  ",
      }),
    ).toBe("Revised");
  });

  it("declares the generated capability contract", () => {
    expect(metadata.typedErrors).toEqual(
      expect.arrayContaining(["Unauthorized", "ValidationFailed", "Forbidden"]),
    );
    expect(metadata.schemas).toEqual({
      args: "reviewBrainKnowledgeCandidateArgs",
      returns: "reviewBrainKnowledgeCandidateReturns",
    });
  });
});
