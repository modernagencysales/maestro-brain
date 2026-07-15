import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { evaluateBrainAnswers } from "./brain-answers";
import { evaluateBrainClassification } from "./brain-classification";
import { evaluateBrainMaintenance } from "./brain-maintenance";
import { evaluateBrainMultilingual } from "./brain-multilingual";
import { evaluateBrainPromptInjection } from "./brain-prompt-injection";

export type BrainEvalSplit = "train" | "dev" | "test";
export type ReviewerLabels = {
  readonly reviewerA: string;
  readonly reviewerB: string;
  readonly adjudicated: string;
};
export type BrainEvalCaseBase = {
  readonly id: string;
  readonly split: BrainEvalSplit;
  readonly labels: ReviewerLabels;
};
export type BrainEvalFailure = {
  readonly caseId: string;
  readonly message: string;
};
export type BrainEvalMetric = {
  readonly numerator: number;
  readonly denominator: number;
  readonly wilsonLower95: number;
  readonly threshold: number;
  readonly passed: boolean;
};
export type BrainEvalReceipt = {
  readonly suiteVersion: string;
  readonly fixtureHash: string;
  readonly modelId: string;
  readonly promptVersion: string;
  readonly toolSchemaVersion: string;
  readonly totals: Record<string, number>;
  readonly metrics: Record<string, BrainEvalMetric>;
  readonly failures: readonly BrainEvalFailure[];
  readonly passed: boolean;
};
export type ModelPromptStatus =
  "candidate" | "evaluated" | "approved" | "rejected";
export type BrainEvalRunArtifact = {
  readonly schemaVersion: "maestro-brain-suite-run-artifact/v1";
  readonly artifactUri: string;
  readonly artifactHash: string;
  readonly rawArtifact: unknown;
};
export type BrainEvalSuiteResult = {
  readonly suiteName: string;
  readonly receipt: BrainEvalReceipt;
  readonly status: ModelPromptStatus;
  readonly runArtifact?: BrainEvalRunArtifact;
};
export type BrainEvalApprovalArtifact = {
  readonly schemaVersion: "maestro-brain-eval-approval-artifact/v1";
  readonly runId: string;
  readonly generatedAt: string;
  readonly suiteResults: readonly BrainEvalSuiteResult[];
};

type FixtureRoot = Record<string, unknown>;

export const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${entries.join(",")}}`;
};

export const sha256 = (value: unknown): string =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");

export const wilsonLowerBound95 = (
  numerator: number,
  denominator: number,
): number => {
  if (denominator === 0) return 0;
  const z = 1.959963984540054;
  const phat = numerator / denominator;
  const z2 = z * z;
  return (
    (phat +
      z2 / (2 * denominator) -
      z *
        Math.sqrt((phat * (1 - phat) + z2 / (4 * denominator)) / denominator)) /
    (1 + z2 / denominator)
  );
};

export const metric = (
  numerator: number,
  denominator: number,
  threshold: number,
): BrainEvalMetric => {
  const wilsonLower95 = wilsonLowerBound95(numerator, denominator);
  const passed =
    denominator > 0 &&
    (threshold === 1 ? numerator === denominator : wilsonLower95 >= threshold);
  return { numerator, denominator, wilsonLower95, threshold, passed };
};

export const buildReceipt = (args: {
  readonly suiteVersion: string;
  readonly fixture: unknown;
  readonly modelId: string;
  readonly promptVersion: string;
  readonly toolSchemaVersion: string;
  readonly totals: Record<string, number>;
  readonly metrics: Record<string, BrainEvalMetric>;
  readonly failures: readonly BrainEvalFailure[];
}): BrainEvalReceipt => ({
  suiteVersion: args.suiteVersion,
  fixtureHash: sha256(args.fixture),
  modelId: args.modelId,
  promptVersion: args.promptVersion,
  toolSchemaVersion: args.toolSchemaVersion,
  totals: args.totals,
  metrics: args.metrics,
  failures: args.failures,
  passed:
    Object.values(args.metrics).every(({ passed }) => passed) &&
    args.failures.length === 0,
});

export const reviewedLabelPassed = (labels: ReviewerLabels): boolean =>
  labels.reviewerA === labels.reviewerB &&
  labels.reviewerA === labels.adjudicated;

export const assertRecord = (
  value: unknown,
  label: string,
): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
};

export const assertString = (value: unknown, label: string): string => {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  return value;
};

export const assertNumber = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
};

export const assertStringArray = (
  value: unknown,
  label: string,
): readonly string[] => {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string")
  ) {
    throw new Error(`${label} must be a string array.`);
  }
  return value;
};

export const assertLabels = (value: unknown): ReviewerLabels => {
  const labels = assertRecord(value, "labels");
  return {
    reviewerA: assertString(labels.reviewerA, "reviewer A label"),
    reviewerB: assertString(labels.reviewerB, "reviewer B label"),
    adjudicated: assertString(labels.adjudicated, "adjudicated label"),
  };
};

const fixturePath = fileURLToPath(
  new URL("../fixtures/maestro-brain/frozen-suite.json", import.meta.url),
);

export const loadFrozenBrainEvalFixture = (): unknown =>
  JSON.parse(readFileSync(fixturePath, "utf8"));

const frozenFixtureRoot = (): FixtureRoot =>
  assertRecord(loadFrozenBrainEvalFixture(), "Brain eval fixture");

export const runFrozenBrainEvalSuites = (): readonly BrainEvalSuiteResult[] => {
  const root = frozenFixtureRoot();
  return [
    evaluateBrainClassification(root.classification),
    evaluateBrainAnswers(root.answers),
    evaluateBrainMaintenance(root.maintenance),
    evaluateBrainPromptInjection(root.promptInjection),
    evaluateBrainMultilingual(root.multilingual),
  ];
};

export const buildBrainEvalReport = () => {
  const fixture = loadFrozenBrainEvalFixture();
  const suites = runFrozenBrainEvalSuites();
  return {
    generatedBy: "@maestro-template/evals brain:eval",
    fixtureHash: sha256(fixture),
    mode: "fixture-only",
    suites,
    passed: false,
    approval: "rejected-fixture-only",
  };
};

export const approveBrainEvalArtifact = (
  artifact: unknown,
): BrainEvalApprovalArtifact => {
  const record = assertRecord(artifact, "Brain eval approval artifact");
  if (record.schemaVersion !== "maestro-brain-eval-approval-artifact/v1") {
    throw new Error("Brain eval approval requires an external run artifact.");
  }
  const runId = assertString(record.runId, "Brain eval run id").trim();
  if (runId.length === 0 || runId === "fixture" || runId === "fixture-only") {
    throw new Error("Brain eval approval requires a non-fixture run id.");
  }
  const suiteResults = record.suiteResults;
  if (!Array.isArray(suiteResults) || suiteResults.length === 0) {
    throw new Error("Brain eval approval requires suite result artifacts.");
  }
  const expected = new Map(
    runFrozenBrainEvalSuites().map((suite) => [suite.suiteName, suite]),
  );
  const seen = new Set<string>();
  for (const suite of suiteResults) {
    const value = assertRecord(suite, "suite result");
    const suiteName = assertString(value.suiteName, "suite name");
    const expectedSuite = expected.get(suiteName);
    if (expectedSuite === undefined || seen.has(suiteName)) {
      throw new Error(
        "Brain eval approval requires the exact external suite set.",
      );
    }
    seen.add(suiteName);
    const artifact = assertExternalRunArtifact(value.runArtifact);
    if (artifact.artifactHash !== `sha256:${sha256(artifact.rawArtifact)}`) {
      throw new Error(
        "Brain eval approval requires raw artifact hashes to match.",
      );
    }
    let recomputed: BrainEvalSuiteResult;
    try {
      recomputed = recomputeSuiteFromRawArtifact(
        suiteName,
        artifact.rawArtifact,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message ===
          "Brain eval approval requires raw results bound to the frozen corpus."
      ) {
        throw error;
      }
      throw new Error(
        "Brain eval approval requires recomputed suite receipts.",
      );
    }
    const receipt = assertRecord(value.receipt, "suite receipt");
    if (
      receipt.suiteVersion !== recomputed.receipt.suiteVersion ||
      receipt.fixtureHash !== recomputed.receipt.fixtureHash ||
      receipt.modelId !== recomputed.receipt.modelId ||
      receipt.promptVersion !== recomputed.receipt.promptVersion ||
      receipt.toolSchemaVersion !== recomputed.receipt.toolSchemaVersion
    ) {
      throw new Error("Brain eval approval requires suite version bindings.");
    }
    if (canonicalJson(recomputed.receipt) !== canonicalJson(receipt)) {
      throw new Error(
        "Brain eval approval requires recomputed suite receipts.",
      );
    }
    if (value.status !== "approved" || recomputed.receipt.passed !== true) {
      throw new Error(
        "Brain eval approval requires all external suite artifacts to pass.",
      );
    }
  }
  if (seen.size !== expected.size) {
    throw new Error(
      "Brain eval approval requires the exact external suite set.",
    );
  }
  return {
    schemaVersion: "maestro-brain-eval-approval-artifact/v1",
    runId,
    generatedAt: assertString(record.generatedAt, "Brain eval generatedAt"),
    suiteResults: suiteResults as readonly BrainEvalSuiteResult[],
  };
};

const assertExternalRunArtifact = (value: unknown): BrainEvalRunArtifact => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(
      "Brain eval approval requires immutable external run artifacts.",
    );
  }
  const artifact = value as Record<string, unknown>;
  const artifactUri = assertString(artifact.artifactUri, "suite artifact URI");
  const artifactHash = assertString(
    artifact.artifactHash,
    "suite artifact hash",
  );

  if (artifact.schemaVersion !== "maestro-brain-suite-run-artifact/v1") {
    throw new Error(
      "Brain eval approval requires immutable external run artifacts.",
    );
  }

  if (artifactUri.trim().length === 0 || artifactUri.startsWith("fixture:")) {
    throw new Error(
      "Brain eval approval requires immutable external run artifacts.",
    );
  }

  if (!/^sha256:[a-f0-9]{64}$/i.test(artifactHash)) {
    throw new Error(
      "Brain eval approval requires immutable external run artifacts.",
    );
  }

  return {
    schemaVersion: "maestro-brain-suite-run-artifact/v1",
    artifactUri,
    artifactHash,
    rawArtifact: artifact.rawArtifact,
  };
};

const recomputeSuiteFromRawArtifact = (
  suiteName: string,
  rawArtifact: unknown,
): BrainEvalSuiteResult => {
  const root = assertRecord(rawArtifact, "raw eval suite artifact");
  const frozenFixture = frozenSuiteFixture(suiteName);
  const suppliedFixture = root.fixture ?? root;
  if (sha256(suppliedFixture) !== sha256(frozenFixture)) {
    throw new Error(
      "Brain eval approval requires raw results bound to the frozen corpus.",
    );
  }

  switch (suiteName) {
    case "classification":
      return evaluateBrainClassification(frozenFixture, root.run);
    case "answers":
      return evaluateBrainAnswers(frozenFixture, root.run);
    case "maintenance":
      return evaluateBrainMaintenance(frozenFixture);
    case "promptInjection":
      return evaluateBrainPromptInjection(frozenFixture);
    case "multilingual":
      return evaluateBrainMultilingual(frozenFixture);
    default:
      throw new Error(
        "Brain eval approval requires the exact external suite set.",
      );
  }
};

const frozenSuiteFixture = (suiteName: string): unknown => {
  const fixture = frozenFixtureRoot();
  const suite = fixture[suiteName];
  if (suite === undefined) {
    throw new Error(
      "Brain eval approval requires the exact external suite set.",
    );
  }
  return suite;
};

export const writeBrainEvalReport = (path: string): void => {
  writeFileSync(path, `${JSON.stringify(buildBrainEvalReport(), null, 2)}\n`);
};

export const checkFrozenBrainFixtures = (): BrainEvalReceipt =>
  checkBrainFixture(loadFrozenBrainEvalFixture());

export const checkBrainFixture = (fixture: unknown): BrainEvalReceipt => {
  const root = assertRecord(fixture, "Brain eval fixture");
  const classification = testCases(root.classification);
  const answers = testCases(root.answers);
  const maintenance = testCases(root.maintenance);
  const promptInjection = testCases(root.promptInjection);
  const multilingual = testCases(root.multilingual);
  const answerClaims = answers.filter(({ kind }) => kind === "claim");
  const answerNoEvidence = answers.filter(({ kind }) => kind === "no-evidence");
  const noRoute = classification.filter(
    (entry) =>
      entry.expectedTarget === null || adjudicatedLabel(entry) === "no-route",
  );
  const mixedClient = classification.filter(
    (entry) =>
      adjudicatedLabel(entry) === "mixed-client" ||
      entry.caseType === "mixed-client" ||
      (typeof entry.id === "string" && entry.id.includes("mixed-client")),
  );
  const languageCounts = countByString(multilingual, "language");
  const languageTotals = Array.from(languageCounts.values());
  const minLanguageCount =
    languageTotals.length === 0 ? 0 : Math.min(...languageTotals);
  const metrics = {
    fixtureCompleteness: metric(presentSuiteCount(root), 5, 1),
    classificationDenominator: minimumCountMetric(classification.length, 500),
    classificationNoRouteDenominator: minimumCountMetric(noRoute.length, 100),
    classificationMixedClientDenominator: minimumCountMetric(
      mixedClient.length,
      50,
    ),
    answerClaimDenominator: minimumCountMetric(answerClaims.length, 300),
    answerNoEvidenceDenominator: minimumCountMetric(
      answerNoEvidence.length,
      100,
    ),
    maintenanceDenominator: minimumCountMetric(maintenance.length, 200),
    promptInjectionDenominator: minimumCountMetric(promptInjection.length, 200),
    multilingualLanguageCount: minimumCountMetric(languageCounts.size, 5),
    multilingualLanguageDenominator: minimumCountMetric(minLanguageCount, 50),
  };
  return buildReceipt({
    suiteVersion: assertString(root.suiteVersion, "suite version"),
    fixture,
    modelId: assertString(root.modelId, "model id"),
    promptVersion: assertString(root.promptVersion, "prompt version"),
    toolSchemaVersion: assertString(
      root.toolSchemaVersion,
      "tool schema version",
    ),
    totals: { suites: 5 },
    metrics,
    failures: failedMetrics(metrics),
  });
};

const countByString = (
  entries: readonly Record<string, unknown>[],
  field: string,
): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const value = entry[field];
    if (typeof value === "string")
      counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
};

const failedMetrics = (
  metrics: Record<string, BrainEvalMetric>,
): readonly BrainEvalFailure[] =>
  Object.entries(metrics)
    .filter(([, value]) => !value.passed)
    .map(([name]) => ({
      caseId: metricFailureCaseId(name),
      message: `Frozen fixture check failed ${name}.`,
    }));

const presentSuiteCount = (root: FixtureRoot): number =>
  [
    "classification",
    "answers",
    "maintenance",
    "promptInjection",
    "multilingual",
  ].filter((suite) => root[suite] !== undefined).length;

const testCases = (
  suiteFixture: unknown,
): readonly Record<string, unknown>[] => {
  if (suiteFixture === undefined) return [];
  const cases = assertRecord(suiteFixture, "suite fixture").cases;
  return Array.isArray(cases)
    ? cases.filter(
        (entry): entry is Record<string, unknown> =>
          typeof entry === "object" &&
          entry !== null &&
          !Array.isArray(entry) &&
          entry.split === "test",
      )
    : [];
};

const adjudicatedLabel = (entry: Record<string, unknown>): unknown => {
  const labels = entry.labels;
  return typeof labels === "object" && labels !== null && !Array.isArray(labels)
    ? (labels as Record<string, unknown>).adjudicated
    : undefined;
};

const metricFailureCaseId = (metricName: string): string => {
  if (metricName.startsWith("classification")) return "classification";
  if (metricName.startsWith("answer")) return "answers";
  if (metricName.startsWith("maintenance")) return "maintenance";
  if (metricName.startsWith("promptInjection")) return "promptInjection";
  if (metricName.startsWith("multilingual")) return "multilingual";
  return metricName;
};

const minimumCountMetric = (
  count: number,
  required: number,
): BrainEvalMetric => ({
  ...metric(Math.min(count, required), required, 1),
  numerator: count,
  passed: count >= required,
});
