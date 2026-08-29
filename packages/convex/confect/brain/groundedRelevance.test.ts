import { describe, expect, it } from "vitest";
import {
  contributesEvidenceCoverage,
  selectEvidenceQueryTokens,
} from "./groundedRelevance";

describe("grounded evidence relevance", () => {
  it("removes conversational request words before measuring coverage", () => {
    const selected = selectEvidenceQueryTokens(
      [
        "what",
        "did",
        "team",
        "say",
        "need",
        "for",
        "replacing",
        "ask",
        "apero",
        "advisors",
      ],
      "grounded",
    );

    expect(selected).toEqual(["team", "replacing", "ask", "apero", "advisors"]);
    expect(contributesEvidenceCoverage("grounded", new Set(), new Set())).toBe(
      false,
    );
  });
});
