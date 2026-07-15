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

export type BrainMaintenanceOutput = {
  readonly factualChangeCited: boolean;
  readonly acceptedWithoutFactualCorrection: boolean;
  readonly staleOrRevokedPublish: boolean;
};

export type BrainMaintenanceRun = {
  readonly schemaVersion: "maestro-brain-suite-run/v1";
  readonly results: readonly {
    readonly caseId: string;
    readonly output: BrainMaintenanceOutput;
  }[];
};

export type BrainMaintenanceCase = BrainEvalCaseBase & {
  readonly output: BrainMaintenanceOutput;
};

const parseMaintenanceOutput = (value: unknown): BrainMaintenanceOutput => {
  const output = assertRecord(value, "maintenance output");
  return {
    factualChangeCited: output.factualChangeCited === true,
    acceptedWithoutFactualCorrection:
      output.acceptedWithoutFactualCorrection === true,
    staleOrRevokedPublish: output.staleOrRevokedPublish === true,
  };
};

export const parseBrainMaintenanceRun = (
  value: unknown,
): BrainMaintenanceRun => {
  const record = assertRecord(value, "maintenance run");
  if (record.schemaVersion !== "maestro-brain-suite-run/v1") {
    throw new Error("maintenance run schemaVersion must be v1.");
  }
  if (!Array.isArray(record.results)) {
    throw new Error("maintenance run results must be an array.");
  }
  return {
    schemaVersion: "maestro-brain-suite-run/v1",
    results: record.results.map((entry) => {
      const result = assertRecord(entry, "maintenance run result");
      return {
        caseId: assertString(result.caseId, "maintenance run case id"),
        output: parseMaintenanceOutput(result.output),
      };
    }),
  };
};

export const parseBrainMaintenanceCases = (
  value: unknown,
): readonly BrainMaintenanceCase[] => {
  if (!Array.isArray(value))
    throw new Error("Maintenance suite must be an array.");
  return value.map((candidate) => {
    const record = assertRecord(candidate, "maintenance case");
    return {
      id: assertString(record.id, "maintenance case id"),
      split: assertString(
        record.split,
        "maintenance split",
      ) as BrainMaintenanceCase["split"],
      labels: assertLabels(record.labels),
      output: parseMaintenanceOutput(record.output),
    };
  });
};

export const evaluateBrainMaintenance = (
  suiteFixture: unknown,
  runInput?: unknown,
): BrainEvalSuiteResult => {
  const suite = assertRecord(suiteFixture, "maintenance fixture");
  const cases = parseBrainMaintenanceCases(suite.cases);
  const testCases = cases.filter((entry) => entry.split === "test");
  const failures: BrainEvalFailure[] = [];
  const runResults = new Map(
    (runInput === undefined
      ? testCases.map((entry) => ({ caseId: entry.id, output: entry.output }))
      : parseBrainMaintenanceRun(runInput).results
    ).map((result) => [result.caseId, result.output]),
  );
  const outputFor = (
    entry: BrainMaintenanceCase,
  ): BrainMaintenanceOutput | null => {
    const output = runResults.get(entry.id);
    if (output === undefined) {
      failures.push({
        caseId: entry.id,
        message: "Maintenance run result is missing for test case.",
      });
      return null;
    }
    return output;
  };

  const cited = testCases.filter((entry) => {
    const output = outputFor(entry);
    const passed = output?.factualChangeCited === true;
    if (!passed)
      failures.push({
        caseId: entry.id,
        message: "Maintenance factual changes must be cited.",
      });
    return passed;
  }).length;
  const accepted = testCases.filter((entry) => {
    const passed =
      reviewedLabelPassed(entry.labels) &&
      outputFor(entry)?.acceptedWithoutFactualCorrection === true;
    if (!passed)
      failures.push({
        caseId: entry.id,
        message:
          "Maintenance proposal must be accepted without factual correction.",
      });
    return passed;
  }).length;
  const fresh = testCases.filter((entry) => {
    const output = outputFor(entry);
    const passed = output !== null && !output.staleOrRevokedPublish;
    if (!passed)
      failures.push({
        caseId: entry.id,
        message: "Maintenance must not publish stale or revoked content.",
      });
    return passed;
  }).length;

  const receipt = buildReceipt({
    suiteVersion: assertString(suite.suiteVersion, "maintenance suite version"),
    fixture: suiteFixture,
    modelId: assertString(suite.modelId, "maintenance model id"),
    promptVersion: assertString(
      suite.promptVersion,
      "maintenance prompt version",
    ),
    toolSchemaVersion: assertString(
      suite.toolSchemaVersion,
      "maintenance tool schema version",
    ),
    totals: { cases: cases.length, testCases: testCases.length },
    metrics: {
      citationCoverage: metric(cited, testCases.length, 1),
      acceptedWithoutCorrection: metric(accepted, testCases.length, 0.8),
      freshness: metric(fresh, testCases.length, 1),
    },
    failures,
  });

  return {
    suiteName: "maintenance",
    receipt,
    status: receipt.passed ? "approved" : "rejected",
  };
};
