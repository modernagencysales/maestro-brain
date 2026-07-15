import {
  assertLabels,
  assertRecord,
  assertString,
  buildReceipt,
  metric,
  reviewedLabelPassed,
  type BrainEvalCaseBase,
  type BrainEvalFailure,
  type BrainEvalSuiteResult,
} from "./brain-eval-report";

export type BrainAnswerOutput = {
  readonly claimEntailed: boolean;
  readonly citationLocatorResolved: boolean;
  readonly redactionMarker: boolean;
  readonly abstained: boolean;
  readonly inventedSource: boolean;
};
export type BrainAnswerArtifactOutput = BrainAnswerOutput & {
  readonly claimText?: string;
  readonly citedQuote?: string;
  readonly citationLocator?: string;
  readonly sourceArtifactHash?: string;
};

export type BrainAnswerRunResult = {
  readonly caseId: string;
  readonly output: BrainAnswerArtifactOutput;
};

export type BrainAnswerRun = {
  readonly schemaVersion: "maestro-brain-answer-run/v1";
  readonly results: readonly BrainAnswerRunResult[];
};

export type BrainAnswerCase = BrainEvalCaseBase & {
  readonly kind: "claim" | "no-evidence";
  readonly output: BrainAnswerArtifactOutput;
};

export const parseBrainAnswerCases = (
  value: unknown,
): readonly BrainAnswerCase[] => {
  if (!Array.isArray(value)) throw new Error("Answer suite must be an array.");
  return value.map((candidate) => {
    const record = assertRecord(candidate, "answer case");
    const output = parseOutput(record.output);
    return {
      id: assertString(record.id, "answer case id"),
      split: assertString(
        record.split,
        "answer split",
      ) as BrainAnswerCase["split"],
      labels: assertLabels(record.labels),
      kind: assertString(record.kind, "answer kind") as BrainAnswerCase["kind"],
      output,
    };
  });
};

const parseOutput = (value: unknown): BrainAnswerArtifactOutput => {
  const output = assertRecord(value, "answer output");
  return {
    claimEntailed: output.claimEntailed === true,
    citationLocatorResolved: output.citationLocatorResolved === true,
    redactionMarker: output.redactionMarker === true,
    abstained: output.abstained === true,
    inventedSource: output.inventedSource === true,
    ...(typeof output.claimText === "string"
      ? { claimText: output.claimText }
      : {}),
    ...(typeof output.citedQuote === "string"
      ? { citedQuote: output.citedQuote }
      : {}),
    ...(typeof output.citationLocator === "string"
      ? { citationLocator: output.citationLocator }
      : {}),
    ...(typeof output.sourceArtifactHash === "string"
      ? { sourceArtifactHash: output.sourceArtifactHash }
      : {}),
  };
};

const hasArtifactSupport = (output: BrainAnswerArtifactOutput): boolean =>
  typeof output.claimText === "string" &&
  output.claimText.length > 0 &&
  typeof output.citedQuote === "string" &&
  output.citedQuote.length > 0 &&
  output.citedQuote.includes(output.claimText) &&
  typeof output.citationLocator === "string" &&
  output.citationLocator.length > 0 &&
  typeof output.sourceArtifactHash === "string" &&
  /^sha256:[a-f0-9]{64}$/i.test(output.sourceArtifactHash);

export const parseBrainAnswerRun = (value: unknown): BrainAnswerRun => {
  const record = assertRecord(value, "answer run");
  if (record.schemaVersion !== "maestro-brain-answer-run/v1") {
    throw new Error("answer run schemaVersion must be v1.");
  }
  if (!Array.isArray(record.results)) {
    throw new Error("answer run results must be an array.");
  }
  return {
    schemaVersion: "maestro-brain-answer-run/v1",
    results: record.results.map((entry) => {
      const result = assertRecord(entry, "answer run result");
      return {
        caseId: assertString(result.caseId, "answer run case id"),
        output: parseOutput(result.output),
      };
    }),
  };
};

export const evaluateBrainAnswers = (
  suiteFixture: unknown,
  runInput?: unknown,
): BrainEvalSuiteResult => {
  const suite = assertRecord(suiteFixture, "answers fixture");
  const cases = parseBrainAnswerCases(suite.cases);
  const testCases = cases.filter((entry) => entry.split === "test");
  const claimCases = testCases.filter((entry) => entry.kind === "claim");
  const noEvidenceCases = testCases.filter(
    (entry) => entry.kind === "no-evidence",
  );
  const failures: BrainEvalFailure[] = [];
  const runResults = new Map(
    (runInput === undefined
      ? testCases.map((entry) => ({ caseId: entry.id, output: entry.output }))
      : parseBrainAnswerRun(runInput).results
    ).map((result) => [result.caseId, result.output]),
  );
  const outputFor = (
    entry: BrainAnswerCase,
  ): BrainAnswerArtifactOutput | null => {
    const output = runResults.get(entry.id);
    if (output === undefined) {
      failures.push({
        caseId: entry.id,
        message: "Answer run result is missing for test case.",
      });
      return null;
    }
    return output;
  };

  const entailed = claimCases.filter((entry) => {
    const output = outputFor(entry);
    if (output === null) return false;
    const passed =
      reviewedLabelPassed(entry.labels) && hasArtifactSupport(output);
    if (!passed)
      failures.push({
        caseId: entry.id,
        message: "Answer claim must be entailed by cited exact revision.",
      });
    return passed;
  }).length;
  const locators = testCases.filter((entry) => {
    const output = outputFor(entry);
    if (output === null) return false;
    const passed =
      output.redactionMarker ||
      (output.citationLocatorResolved &&
        typeof output.citationLocator === "string" &&
        output.citationLocator.length > 0);
    if (!passed)
      failures.push({
        caseId: entry.id,
        message:
          "Answer citation locator must resolve or return explicit redaction.",
      });
    return passed;
  }).length;
  const abstentions = noEvidenceCases.filter((entry) => {
    const output = outputFor(entry);
    if (output === null) return false;
    const passed = output.abstained && !output.inventedSource;
    if (!passed)
      failures.push({
        caseId: entry.id,
        message: "No-evidence answer must abstain without invented sources.",
      });
    return passed;
  }).length;

  const receipt = buildReceipt({
    suiteVersion: assertString(suite.suiteVersion, "answers suite version"),
    fixture: suiteFixture,
    modelId: assertString(suite.modelId, "answers model id"),
    promptVersion: assertString(suite.promptVersion, "answers prompt version"),
    toolSchemaVersion: assertString(
      suite.toolSchemaVersion,
      "answers tool schema version",
    ),
    totals: { cases: cases.length, testCases: testCases.length },
    metrics: {
      entailment: metric(entailed, claimCases.length, 0.95),
      locatorResolution: metric(locators, testCases.length, 1),
      noEvidenceAbstention: metric(abstentions, noEvidenceCases.length, 0.95),
    },
    failures,
  });

  return {
    suiteName: "answers",
    receipt,
    status: receipt.passed ? "approved" : "rejected",
  };
};
