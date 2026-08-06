import { sha256 } from "./brain-eval-report";

export type BrainEvidenceTelemetryBudget = Readonly<{
  readonly evidenceBytes: number;
  readonly modelTokens: number;
  readonly storageBytes: number;
  readonly rawTextObserved: boolean;
}>;

export type BrainEvidenceTelemetryReceipt = Readonly<{
  readonly schemaVersion: "maestro-brain-evidence-telemetry-receipt/v1";
  readonly fixtureHash: string;
  readonly passed: boolean;
  readonly rawTextObserved: boolean;
  readonly failures: readonly string[];
}>;

export const BRAIN_EVIDENCE_TELEMETRY_BUDGET_FIXTURE: BrainEvidenceTelemetryBudget =
  Object.freeze({
    evidenceBytes: 1_000_000,
    modelTokens: 50_000,
    storageBytes: 10_000_000,
    rawTextObserved: false,
  });

export const evaluateBrainEvidenceTelemetryBudget = (
  fixture: BrainEvidenceTelemetryBudget,
): BrainEvidenceTelemetryReceipt => {
  const failures: string[] = [];
  if (fixture.evidenceBytes > 6_000_000)
    failures.push("evidence budget exceeded");
  if (fixture.modelTokens > 100_000)
    failures.push("model token budget exceeded");
  if (fixture.storageBytes > 100_000_000)
    failures.push("storage budget exceeded");
  if (fixture.rawTextObserved) failures.push("raw text observed");
  return {
    schemaVersion: "maestro-brain-evidence-telemetry-receipt/v1",
    fixtureHash: `sha256:${sha256(fixture)}`,
    passed: failures.length === 0,
    rawTextObserved: fixture.rawTextObserved,
    failures,
  };
};
