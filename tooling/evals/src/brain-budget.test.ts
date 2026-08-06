import { describe, expect, it } from "vitest";

import {
  BRAIN_EVIDENCE_TELEMETRY_BUDGET_FIXTURE,
  evaluateBrainEvidenceTelemetryBudget,
} from "./brain-budget";

describe("Brain evidence and telemetry budget", () => {
  it("accepts the frozen redacted budget fixture", () => {
    const receipt = evaluateBrainEvidenceTelemetryBudget(
      BRAIN_EVIDENCE_TELEMETRY_BUDGET_FIXTURE,
    );
    expect(receipt.passed).toBe(true);
    expect(receipt.fixtureHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(receipt.rawTextObserved).toBe(false);
  });

  it("fails any budget overrun or raw-text observation", () => {
    const receipt = evaluateBrainEvidenceTelemetryBudget({
      ...BRAIN_EVIDENCE_TELEMETRY_BUDGET_FIXTURE,
      evidenceBytes: 6_000_001,
      rawTextObserved: true,
    });
    expect(receipt.passed).toBe(false);
    expect(receipt.failures).toEqual(
      expect.arrayContaining(["evidence budget exceeded", "raw text observed"]),
    );
  });
});
