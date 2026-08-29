import { describe, expect, it } from "vitest";
import {
  aggregateFreshness,
  canonicalContextPackHash,
  claimFreshness,
  effectiveRiskLevel,
  groundedLexicalScore,
  normalizedEvidenceBody,
  probableEvidenceConflict,
  sourceAuthorityWeight,
  lexicalScore,
} from "./askCompanyBrain.domain";

describe("Ask Company Brain V4 domain", () => {
  it("ranks literal company terminology deterministically", () => {
    expect(lexicalScore("pilot price", "The pilot price is $5,000")).toBe(2);
    expect(lexicalScore("pilot price", "Unrelated staffing note")).toBe(0);
    expect(
      groundedLexicalScore("What is our pricing?", "Our office is remote"),
    ).toBe(0);
    expect(
      groundedLexicalScore(
        "What is our pilot pricing?",
        "The advisory pilot pricing is $5,000.",
      ),
    ).toBe(2);
  });

  it("classifies current-state questions consistently across callers", () => {
    expect(effectiveRiskLevel("What is our current pilot price?")).toBe("high");
    expect(effectiveRiskLevel("What did the team discuss yesterday?")).toBe(
      "ordinary",
    );
    expect(effectiveRiskLevel("What is the price?", "ordinary")).toBe(
      "ordinary",
    );
  });

  it("normalizes duplicate bodies and detects only narrow contradictions", () => {
    expect(normalizedEvidenceBody(" Pilot—PRICE: $5,000 ")).toBe(
      "pilot price 5 000",
    );
    expect(
      probableEvidenceConflict(
        "The advisory pilot costs 5000 per month",
        "The advisory pilot costs 6000 per month",
      ),
    ).toBe(true);
    expect(
      probableEvidenceConflict(
        "The advisory pilot costs 5000 per month",
        "The team has 6 advisors",
      ),
    ).toBe(false);
    expect(sourceAuthorityWeight("brain_page")).toBeGreaterThan(
      sourceAuthorityWeight("google_drive"),
    );
  });

  it("derives freshness without persisted pack state", () => {
    const now = 2_000_000_000_000;
    expect(claimFreshness(now + 30 * 24 * 60 * 60 * 1_000, now)).toBe(
      "current",
    );
    expect(claimFreshness(now - 1, now)).toBe("stale");
    expect(aggregateFreshness(["current", "review-due"])).toBe("review-due");
  });

  it("hashes canonical pack content deterministically", () => {
    const pack = {
      schemaVersion: "4" as const,
      policyVersion: "brain-context-v2",
      requestedEvidenceMode: "mixed" as const,
      evidenceMode: "mixed" as const,
      workspaceId: "workspace",
      question: "What is the pilot price?",
      asOf: 1,
      freshness: "current" as const,
      claims: [],
      citations: [],
      conflicts: [],
      omissions: [],
    };
    expect(canonicalContextPackHash(pack)).toBe(canonicalContextPackHash(pack));
    expect(canonicalContextPackHash(pack)).toBe(
      canonicalContextPackHash({ ...pack, asOf: 2 }),
    );
    expect(canonicalContextPackHash(pack)).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });
});
