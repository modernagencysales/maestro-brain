import { sha256Hex } from "../shared/sha256";

export const MIN_ADJUDICATED_EXAMPLES = 25;
export const HOLDOUT_EXAMPLE_COUNT = 5;
export const MAX_EVALUATION_EXAMPLES = 500;
export const MAX_EVIDENCE_REFERENCES = 10;

export type EvaluationEvidenceReference = {
  readonly sourceKey: string;
  readonly revisionKey: string;
  readonly contentHash: string;
};

export type FreezeExample = {
  readonly exampleKey: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly split: "development" | "holdout";
  readonly captureKind: "feedback" | "test";
  readonly adjudicationState?: "pending" | "adjudicated" | undefined;
  readonly expectedAnswerStatus?:
    "answered" | "insufficient-context" | undefined;
  readonly expectedEvidenceReferences?:
    readonly EvaluationEvidenceReference[] | undefined;
  readonly riskLevel?: "ordinary" | "high" | undefined;
};

const referenceIdentity = (reference: EvaluationEvidenceReference): string =>
  `${reference.sourceKey}\u0000${reference.revisionKey}\u0000${reference.contentHash}`;

const byCreationAndKey = (left: FreezeExample, right: FreezeExample): number =>
  left.createdAt - right.createdAt ||
  left.exampleKey.localeCompare(right.exampleKey);

export type FreezeSelection = {
  readonly maturity: "insufficient-sample" | "ready";
  readonly adjudicatedCount: number;
  readonly selectedExampleKeys: readonly string[];
  readonly excludedForSourceOverlap: number;
  readonly previewHash: string;
};

export const selectEvaluationHoldout = (
  examples: readonly FreezeExample[],
  cutoffCreatedAt: number,
): FreezeSelection => {
  const adjudicated = examples.filter(
    (example) => example.adjudicationState === "adjudicated",
  );
  const developmentSourceKeys = new Set(
    adjudicated
      .filter(
        (example) =>
          example.split === "development" &&
          example.createdAt < cutoffCreatedAt,
      )
      .flatMap((example) =>
        (example.expectedEvidenceReferences ?? []).map(
          ({ sourceKey }) => sourceKey,
        ),
      ),
  );
  const afterCutoff = adjudicated
    .filter(
      (example) =>
        example.split === "development" &&
        example.captureKind === "test" &&
        example.createdAt >= cutoffCreatedAt,
    )
    .sort(byCreationAndKey);
  const sourceSeparated = afterCutoff.filter((example) =>
    (example.expectedEvidenceReferences ?? []).every(
      (reference) => !developmentSourceKeys.has(reference.sourceKey),
    ),
  );
  const selectedExamples = sourceSeparated.slice(0, HOLDOUT_EXAMPLE_COUNT);
  const selectedExampleKeys = selectedExamples.map(
    ({ exampleKey }) => exampleKey,
  );
  const maturity =
    adjudicated.length >= MIN_ADJUDICATED_EXAMPLES &&
    selectedExampleKeys.length === HOLDOUT_EXAMPLE_COUNT
      ? ("ready" as const)
      : ("insufficient-sample" as const);
  const payload = {
    schemaVersion: "1",
    cutoffCreatedAt,
    adjudicatedCount: adjudicated.length,
    selectedExampleKeys,
    selectedAdjudicatedGold: selectedExamples.map((example) => ({
      exampleKey: example.exampleKey,
      adjudicationState: example.adjudicationState ?? "pending",
      expectedAnswerStatus: example.expectedAnswerStatus ?? null,
      expectedEvidenceReferences: [
        ...(example.expectedEvidenceReferences ?? []),
      ].sort((left, right) =>
        referenceIdentity(left).localeCompare(referenceIdentity(right)),
      ),
      riskLevel: example.riskLevel ?? null,
      updatedAt: example.updatedAt,
    })),
    excludedForSourceOverlap: afterCutoff.length - sourceSeparated.length,
  };
  return {
    maturity,
    adjudicatedCount: adjudicated.length,
    selectedExampleKeys,
    excludedForSourceOverlap: payload.excludedForSourceOverlap,
    previewHash: `sha256:${sha256Hex(JSON.stringify(payload))}`,
  };
};

export type RedactedEvaluationExample = {
  readonly exampleKey: string;
  readonly questionHash: string;
  readonly purpose: string;
  readonly evidenceMode: "recent_evidence" | "company_truth" | "mixed";
  readonly surface: "web" | "cli" | "api" | "mcp";
  readonly answerStatus: "answered" | "insufficient-context";
  readonly packHash: string;
  readonly maxCitations?: number | undefined;
  readonly capturedAsOf?: number | undefined;
  readonly policyVersion?: string | undefined;
  readonly evidenceReferences: readonly EvaluationEvidenceReference[];
  readonly captureKind: "feedback" | "test";
  readonly usefulness: "useful" | "needs-work" | "unrated";
  readonly issueReason?: string | undefined;
  readonly adjudicationState: "pending" | "adjudicated";
  readonly expectedAnswerStatus?:
    "answered" | "insufficient-context" | undefined;
  readonly expectedEvidenceReferences: readonly EvaluationEvidenceReference[];
  readonly riskLevel?: "ordinary" | "high" | undefined;
  readonly split: "development" | "holdout";
  readonly freezeKey?: string | undefined;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export const buildRedactedEvaluationExport = (
  examples: readonly (Omit<RedactedEvaluationExample, "questionHash"> & {
    readonly question: string;
  })[],
) => {
  const rows: RedactedEvaluationExample[] = [...examples]
    .sort(
      (left, right) =>
        left.createdAt - right.createdAt ||
        left.exampleKey.localeCompare(right.exampleKey),
    )
    .map(
      ({
        question,
        expectedAnswerStatus,
        expectedEvidenceReferences,
        riskLevel,
        ...example
      }) => ({
        ...example,
        questionHash: `sha256:${sha256Hex(question)}`,
        evidenceReferences: [...example.evidenceReferences].sort(
          (left, right) =>
            referenceIdentity(left).localeCompare(referenceIdentity(right)),
        ),
        ...(example.split === "holdout"
          ? { expectedEvidenceReferences: [] }
          : {
              ...(expectedAnswerStatus === undefined
                ? {}
                : { expectedAnswerStatus }),
              expectedEvidenceReferences: [...expectedEvidenceReferences].sort(
                (left, right) =>
                  referenceIdentity(left).localeCompare(
                    referenceIdentity(right),
                  ),
              ),
              ...(riskLevel === undefined ? {} : { riskLevel }),
            }),
      }),
    );
  const payload = { schemaVersion: "1" as const, rows };
  return {
    ...payload,
    rowCount: rows.length,
    exportHash: `sha256:${sha256Hex(JSON.stringify(payload))}`,
  };
};
