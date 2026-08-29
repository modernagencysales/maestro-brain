import { describe, expect, it } from "vitest";
import {
  aggregateFreshness,
  canonicalContextPackHash,
  claimFreshness,
  lexicalScore,
} from "./askCompanyBrain.domain";

describe("Ask Company Brain V4 domain", () => {
  it("ranks literal company terminology deterministically", () => {
    expect(lexicalScore("pilot price", "The pilot price is $5,000")).toBe(2);
    expect(lexicalScore("pilot price", "Unrelated staffing note")).toBe(0);
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
      policyVersion: "brain-context-v1",
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
