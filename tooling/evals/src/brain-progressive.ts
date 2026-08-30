export type BrainEvaluationMaturity =
  "insufficient-sample" | "provisional" | "exit-eligible";

export type BrainAnswerStatus = "answered" | "insufficient_context";

export type BrainEvidenceReference = {
  readonly sourceId: string;
  readonly revisionId: string;
  readonly contentHash: string;
  readonly eligible: boolean;
};

export type BrainObservedCitation = {
  readonly sourceId: string;
  readonly revisionId: string;
  readonly contentHash: string;
  readonly reopenedContentHash: string;
  readonly accessible: boolean;
  readonly entailed?: boolean | undefined;
};

export type BrainSurfaceObservation = {
  readonly surface: "web" | "cli" | "api" | "http_mcp";
  readonly answerStatus: BrainAnswerStatus;
  readonly packHash: string;
  readonly citations: readonly BrainObservedCitation[];
};

export type BrainProgressiveCase = {
  readonly id: string;
  readonly fixtureClass: "synthetic-safety" | "external-real";
  readonly adjudicated: boolean;
  readonly riskLevel: "ordinary" | "high";
  readonly expectedAnswerStatus: BrainAnswerStatus;
  readonly availableEvidence: readonly BrainEvidenceReference[];
  readonly observations: readonly BrainSurfaceObservation[];
};

export type BrainExternalFixtureManifest = {
  readonly schemaVersion: 1;
  readonly datasetId: string;
  readonly payloadLocation: "external";
  readonly realTaskCount: number;
  readonly adjudicatedTaskCount: number;
  readonly payloadHashes: readonly string[];
};

export type BrainMetric = {
  readonly numerator: number;
  readonly denominator: number;
  readonly rate: number | null;
};

export type BrainProgressiveCaseResult = {
  readonly caseId: string;
  readonly passed: boolean;
  readonly checks: {
    readonly exactCitationReopening: boolean;
    readonly expectedAnswerStatus: boolean;
    readonly supportingSourceRecallAt5: boolean;
    readonly withdrawalSafety: boolean;
    readonly insufficientContext: boolean;
    readonly surfaceParity: boolean;
  };
  readonly failures: readonly string[];
};

export type BrainProgressiveReport = {
  readonly maturity: BrainEvaluationMaturity;
  readonly sample: {
    readonly realTasks: number;
    readonly adjudicatedRealTasks: number;
    readonly minimumExitSample: number;
    readonly manifestDeclaredRealTasks: number;
    readonly manifestDeclaredAdjudicatedTasks: number;
    readonly manifestMatchesInspectedCases: boolean;
  };
  readonly metrics: {
    readonly casesPassing: BrainMetric;
    readonly exactCitationReopening: BrainMetric;
    readonly expectedAnswerStatus: BrainMetric;
    readonly supportingSourceRecallAt5: BrainMetric;
    readonly citationEntailment: BrainMetric;
    readonly highRiskCitationEntailment: BrainMetric;
    readonly withdrawalExclusion: BrainMetric;
    readonly insufficientContext: BrainMetric;
    readonly surfaceParity: BrainMetric;
  };
  readonly cases: readonly BrainProgressiveCaseResult[];
};

const MINIMUM_EXIT_SAMPLE = 25;

export const loadBrainProgressiveCases = (
  serializedCases: string,
): readonly BrainProgressiveCase[] => {
  const parsed: unknown = JSON.parse(serializedCases);
  if (!Array.isArray(parsed)) {
    throw new Error("Brain progressive eval cases must be an array.");
  }

  const cases = parsed.map(parseCase);
  assertUnique(
    cases.map(({ id }) => id),
    "Brain progressive eval case ids",
  );
  return cases;
};

export const loadBrainExternalFixtureManifest = (
  serializedManifest: string,
): BrainExternalFixtureManifest => {
  const record = expectRecord(JSON.parse(serializedManifest), "manifest");
  const schemaVersion = expectNumber(record.schemaVersion, "schema version");
  if (schemaVersion !== 1)
    throw new Error("Brain manifest schemaVersion must be 1.");
  if (record.payloadLocation !== "external") {
    throw new Error("Brain customer fixture payloads must remain external.");
  }

  const realTaskCount = expectNonnegativeInteger(
    record.realTaskCount,
    "real task count",
  );
  const adjudicatedTaskCount = expectNonnegativeInteger(
    record.adjudicatedTaskCount,
    "adjudicated task count",
  );
  const payloadHashes = expectStringArray(
    record.payloadHashes,
    "payload hashes",
  );
  if (adjudicatedTaskCount > realTaskCount) {
    throw new Error("Adjudicated task count cannot exceed real task count.");
  }
  if (payloadHashes.length > realTaskCount) {
    throw new Error("Payload hash count cannot exceed real task count.");
  }
  for (const hash of payloadHashes) {
    if (!/^sha256:[a-f0-9]{64}$/u.test(hash)) {
      throw new Error("Brain manifest payload hashes must be sha256 digests.");
    }
  }

  return {
    schemaVersion: 1,
    datasetId: expectString(record.datasetId, "dataset id"),
    payloadLocation: "external",
    realTaskCount,
    adjudicatedTaskCount,
    payloadHashes,
  };
};

export const evaluateBrainProgressive = (
  cases: readonly BrainProgressiveCase[],
  manifest: BrainExternalFixtureManifest,
): BrainProgressiveReport => {
  const sortedCases = [...cases].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const caseResults = sortedCases.map(evaluateCase);
  const realCases = sortedCases.filter(
    ({ fixtureClass }) => fixtureClass === "external-real",
  );
  const adjudicatedRealCases = realCases.filter(
    ({ adjudicated }) => adjudicated,
  );

  const reopening = metricAccumulator();
  const withdrawals = metricAccumulator();
  const insufficient = metricAccumulator();
  const parity = metricAccumulator();
  const expectedStatus = metricAccumulator();
  const supportingSourceRecall = metricAccumulator();
  const citationEntailment = metricAccumulator();
  const highRiskCitationEntailment = metricAccumulator();
  let assessableEntailmentCount = 0;
  let assessableHighRiskEntailmentCount = 0;

  for (const testCase of sortedCases) {
    const evidenceByKey = new Map(
      testCase.availableEvidence.map((reference) => [
        referenceKey(reference),
        reference,
      ]),
    );
    for (const observation of testCase.observations) {
      if (testCase.adjudicated) {
        expectedStatus.add(
          observation.answerStatus === testCase.expectedAnswerStatus,
        );
        const expectedSources = new Set(
          testCase.availableEvidence
            .filter(({ eligible }) => eligible)
            .map(({ sourceId }) => sourceId),
        );
        const observedSources = new Set(
          observation.citations.slice(0, 5).map(({ sourceId }) => sourceId),
        );
        for (const sourceId of expectedSources)
          supportingSourceRecall.add(observedSources.has(sourceId));
      }
      for (const citation of observation.citations) {
        const evidence = evidenceByKey.get(referenceKey(citation));
        reopening.add(
          Boolean(
            evidence?.eligible &&
            citation.accessible &&
            citation.contentHash === evidence.contentHash &&
            citation.reopenedContentHash === evidence.contentHash,
          ),
        );
        if (
          testCase.fixtureClass === "external-real" &&
          testCase.adjudicated &&
          observation.answerStatus === "answered"
        ) {
          if (testCase.riskLevel === "high") {
            assessableHighRiskEntailmentCount += 1;
            if (citation.entailed !== undefined)
              highRiskCitationEntailment.add(citation.entailed);
          } else {
            assessableEntailmentCount += 1;
            if (citation.entailed !== undefined)
              citationEntailment.add(citation.entailed);
          }
        }
      }
    }

    for (const reference of testCase.availableEvidence.filter(
      ({ eligible }) => !eligible,
    )) {
      const excluded = testCase.observations.every((observation) =>
        observation.citations.every(
          (citation) => referenceKey(citation) !== referenceKey(reference),
        ),
      );
      withdrawals.add(excluded);
    }

    if (testCase.expectedAnswerStatus === "insufficient_context") {
      insufficient.add(
        testCase.observations.length > 0 &&
          testCase.observations.every(
            (observation) =>
              observation.answerStatus === "insufficient_context" &&
              observation.citations.length === 0,
          ),
      );
    }

    if (testCase.observations.length > 1) {
      parity.add(hasSurfaceParity(testCase.observations));
    }
  }

  const manifestMatchesInspectedCases =
    manifest.realTaskCount === realCases.length &&
    manifest.adjudicatedTaskCount === adjudicatedRealCases.length;
  const citationEntailmentMetric = citationEntailment.metric();
  const highRiskCitationEntailmentMetric = highRiskCitationEntailment.metric();
  const casesPassingMetric = toMetric(
    caseResults.filter(({ passed }) => passed).length,
    caseResults.length,
  );
  const exactCitationReopeningMetric = reopening.metric();
  const expectedAnswerStatusMetric = expectedStatus.metric();
  const supportingSourceRecallAt5Metric = supportingSourceRecall.metric();
  const withdrawalExclusionMetric = withdrawals.metric();
  const insufficientContextMetric = insufficient.metric();
  const surfaceParityMetric = parity.metric();
  return {
    maturity: maturityFor({
      adjudicatedTaskCount: adjudicatedRealCases.length,
      manifestMatchesInspectedCases,
      assessedEntailmentCount: citationEntailmentMetric.denominator,
      assessableEntailmentCount,
      entailmentRate: citationEntailmentMetric.rate,
      assessedHighRiskEntailmentCount:
        highRiskCitationEntailmentMetric.denominator,
      assessableHighRiskEntailmentCount,
      highRiskEntailmentRate: highRiskCitationEntailmentMetric.rate,
      casesPassing: casesPassingMetric,
      exactCitationReopening: exactCitationReopeningMetric,
      expectedAnswerStatus: expectedAnswerStatusMetric,
      supportingSourceRecallAt5: supportingSourceRecallAt5Metric,
      withdrawalExclusion: withdrawalExclusionMetric,
      insufficientContext: insufficientContextMetric,
      surfaceParity: surfaceParityMetric,
    }),
    sample: {
      realTasks: realCases.length,
      adjudicatedRealTasks: adjudicatedRealCases.length,
      minimumExitSample: MINIMUM_EXIT_SAMPLE,
      manifestDeclaredRealTasks: manifest.realTaskCount,
      manifestDeclaredAdjudicatedTasks: manifest.adjudicatedTaskCount,
      manifestMatchesInspectedCases,
    },
    metrics: {
      casesPassing: casesPassingMetric,
      exactCitationReopening: exactCitationReopeningMetric,
      expectedAnswerStatus: expectedAnswerStatusMetric,
      supportingSourceRecallAt5: supportingSourceRecallAt5Metric,
      citationEntailment: citationEntailmentMetric,
      highRiskCitationEntailment: highRiskCitationEntailmentMetric,
      withdrawalExclusion: withdrawalExclusionMetric,
      insufficientContext: insufficientContextMetric,
      surfaceParity: surfaceParityMetric,
    },
    cases: caseResults,
  };
};

const evaluateCase = (
  testCase: BrainProgressiveCase,
): BrainProgressiveCaseResult => {
  const evidenceByKey = new Map(
    testCase.availableEvidence.map((reference) => [
      referenceKey(reference),
      reference,
    ]),
  );
  const exactCitationReopening = testCase.observations.every((observation) =>
    observation.citations.every((citation) => {
      const evidence = evidenceByKey.get(referenceKey(citation));
      return Boolean(
        evidence?.eligible &&
        citation.accessible &&
        citation.contentHash === evidence.contentHash &&
        citation.reopenedContentHash === evidence.contentHash,
      );
    }),
  );
  const expectedAnswerStatus =
    !testCase.adjudicated ||
    (testCase.observations.length > 0 &&
      testCase.observations.every(
        (observation) =>
          observation.answerStatus === testCase.expectedAnswerStatus,
      ));
  const expectedSources = new Set(
    testCase.availableEvidence
      .filter(({ eligible }) => eligible)
      .map(({ sourceId }) => sourceId),
  );
  const supportingSourceRecallAt5 =
    !testCase.adjudicated ||
    testCase.observations.every((observation) => {
      const observedSources = new Set(
        observation.citations.slice(0, 5).map(({ sourceId }) => sourceId),
      );
      return [...expectedSources].every((sourceId) =>
        observedSources.has(sourceId),
      );
    });
  const withdrawalSafety = testCase.availableEvidence
    .filter(({ eligible }) => !eligible)
    .every((reference) =>
      testCase.observations.every((observation) =>
        observation.citations.every(
          (citation) => referenceKey(citation) !== referenceKey(reference),
        ),
      ),
    );
  const insufficientContext =
    testCase.expectedAnswerStatus !== "insufficient_context" ||
    (testCase.observations.length > 0 &&
      testCase.observations.every(
        (observation) =>
          observation.answerStatus === "insufficient_context" &&
          observation.citations.length === 0,
      ));
  const surfaceParity =
    testCase.observations.length < 2 || hasSurfaceParity(testCase.observations);
  const checks = {
    exactCitationReopening,
    expectedAnswerStatus,
    supportingSourceRecallAt5,
    withdrawalSafety,
    insufficientContext,
    surfaceParity,
  };
  const failures = [
    exactCitationReopening
      ? undefined
      : "Every citation must reopen the exact eligible evidence revision and content hash.",
    expectedAnswerStatus
      ? undefined
      : "Every adjudicated observation must match the expected answer status.",
    supportingSourceRecallAt5
      ? undefined
      : "Every adjudicated observation must cite each expected supporting source in its first five citations.",
    withdrawalSafety
      ? undefined
      : "Withdrawn or ineligible evidence must not be cited.",
    insufficientContext
      ? undefined
      : "Insufficient-context cases must abstain without citations.",
    surfaceParity
      ? undefined
      : "Web, CLI, API, and HTTP MCP must preserve pack and citation identity.",
  ].filter((failure): failure is string => typeof failure === "string");

  return {
    caseId: testCase.id,
    passed: failures.length === 0,
    checks,
    failures,
  };
};

const hasSurfaceParity = (
  observations: readonly BrainSurfaceObservation[],
): boolean => {
  const [first, ...rest] = observations;
  if (!first) return true;
  const expectedCitations = citationIdentity(first.citations);
  return rest.every(
    (observation) =>
      observation.answerStatus === first.answerStatus &&
      observation.packHash === first.packHash &&
      citationIdentity(observation.citations) === expectedCitations,
  );
};

const citationIdentity = (
  citations: readonly BrainObservedCitation[],
): string =>
  [...citations]
    .map((citation) => `${referenceKey(citation)}:${citation.contentHash}`)
    .sort()
    .join("|");

const referenceKey = (reference: {
  readonly sourceId: string;
  readonly revisionId: string;
}): string => `${reference.sourceId}:${reference.revisionId}`;

const maturityFor = (input: {
  readonly adjudicatedTaskCount: number;
  readonly manifestMatchesInspectedCases: boolean;
  readonly assessedEntailmentCount: number;
  readonly assessableEntailmentCount: number;
  readonly entailmentRate: number | null;
  readonly assessedHighRiskEntailmentCount: number;
  readonly assessableHighRiskEntailmentCount: number;
  readonly highRiskEntailmentRate: number | null;
  readonly casesPassing: BrainMetric;
  readonly exactCitationReopening: BrainMetric;
  readonly expectedAnswerStatus: BrainMetric;
  readonly supportingSourceRecallAt5: BrainMetric;
  readonly withdrawalExclusion: BrainMetric;
  readonly insufficientContext: BrainMetric;
  readonly surfaceParity: BrainMetric;
}): BrainEvaluationMaturity => {
  const {
    adjudicatedTaskCount,
    manifestMatchesInspectedCases,
    assessedEntailmentCount,
    assessableEntailmentCount,
    entailmentRate,
    assessedHighRiskEntailmentCount,
    assessableHighRiskEntailmentCount,
    highRiskEntailmentRate,
    casesPassing,
    exactCitationReopening,
    expectedAnswerStatus,
    supportingSourceRecallAt5,
    withdrawalExclusion,
    insufficientContext,
    surfaceParity,
  } = input;
  const meetsRequiredRate = (metric: BrainMetric, minimum: number) =>
    metric.denominator > 0 && metric.rate !== null && metric.rate >= minimum;
  if (adjudicatedTaskCount === 0) return "insufficient-sample";
  if (
    adjudicatedTaskCount < MINIMUM_EXIT_SAMPLE ||
    !manifestMatchesInspectedCases ||
    assessableEntailmentCount === 0 ||
    assessedEntailmentCount !== assessableEntailmentCount ||
    entailmentRate === null ||
    entailmentRate < 0.95 ||
    assessableHighRiskEntailmentCount === 0 ||
    assessedHighRiskEntailmentCount !== assessableHighRiskEntailmentCount ||
    highRiskEntailmentRate !== 1 ||
    !meetsRequiredRate(casesPassing, 1) ||
    !meetsRequiredRate(exactCitationReopening, 1) ||
    !meetsRequiredRate(expectedAnswerStatus, 0.95) ||
    !meetsRequiredRate(supportingSourceRecallAt5, 0.9) ||
    !meetsRequiredRate(withdrawalExclusion, 1) ||
    !meetsRequiredRate(insufficientContext, 0.95) ||
    !meetsRequiredRate(surfaceParity, 1)
  )
    return "provisional";
  return "exit-eligible";
};

const metricAccumulator = () => {
  let numerator = 0;
  let denominator = 0;
  return {
    add(passed: boolean) {
      denominator += 1;
      if (passed) numerator += 1;
    },
    metric: () => toMetric(numerator, denominator),
  };
};

const toMetric = (numerator: number, denominator: number): BrainMetric => ({
  numerator,
  denominator,
  rate: denominator === 0 ? null : numerator / denominator,
});

const parseCase = (candidate: unknown): BrainProgressiveCase => {
  const record = expectRecord(candidate, "eval case");
  const fixtureClass = record.fixtureClass;
  if (fixtureClass !== "synthetic-safety" && fixtureClass !== "external-real") {
    throw new Error("Brain eval fixtureClass is invalid.");
  }
  const expectedAnswerStatus = parseAnswerStatus(record.expectedAnswerStatus);
  const riskLevel = record.riskLevel;
  if (riskLevel !== "ordinary" && riskLevel !== "high")
    throw new Error("Brain eval riskLevel is invalid.");
  return {
    id: expectString(record.id, "case id"),
    fixtureClass,
    adjudicated: expectBoolean(record.adjudicated, "adjudicated"),
    riskLevel,
    expectedAnswerStatus,
    availableEvidence: expectArray(
      record.availableEvidence,
      "available evidence",
    ).map(parseEvidenceReference),
    observations: expectArray(record.observations, "observations").map(
      parseObservation,
    ),
  };
};

const parseEvidenceReference = (candidate: unknown): BrainEvidenceReference => {
  const record = expectRecord(candidate, "evidence reference");
  return {
    sourceId: expectString(record.sourceId, "source id"),
    revisionId: expectString(record.revisionId, "revision id"),
    contentHash: expectString(record.contentHash, "content hash"),
    eligible: expectBoolean(record.eligible, "evidence eligibility"),
  };
};

const parseObservation = (candidate: unknown): BrainSurfaceObservation => {
  const record = expectRecord(candidate, "surface observation");
  const surface = record.surface;
  if (
    surface !== "web" &&
    surface !== "cli" &&
    surface !== "api" &&
    surface !== "http_mcp"
  ) {
    throw new Error("Brain eval surface is invalid.");
  }
  return {
    surface,
    answerStatus: parseAnswerStatus(record.answerStatus),
    packHash: expectString(record.packHash, "pack hash"),
    citations: expectArray(record.citations, "citations").map((citation) => {
      const citationRecord = expectRecord(citation, "citation");
      return {
        sourceId: expectString(citationRecord.sourceId, "citation source id"),
        revisionId: expectString(
          citationRecord.revisionId,
          "citation revision id",
        ),
        contentHash: expectString(
          citationRecord.contentHash,
          "citation content hash",
        ),
        reopenedContentHash: expectString(
          citationRecord.reopenedContentHash,
          "reopened content hash",
        ),
        accessible: expectBoolean(
          citationRecord.accessible,
          "citation accessibility",
        ),
        ...(citationRecord.entailed === undefined
          ? {}
          : {
              entailed: expectBoolean(
                citationRecord.entailed,
                "citation entailment",
              ),
            }),
      };
    }),
  };
};

const parseAnswerStatus = (value: unknown): BrainAnswerStatus => {
  if (value !== "answered" && value !== "insufficient_context") {
    throw new Error("Brain eval answer status is invalid.");
  }
  return value;
};

const expectRecord = (
  value: unknown,
  label: string,
): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
};

const expectArray = (value: unknown, label: string): readonly unknown[] => {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
};

const expectString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
};

const expectStringArray = (value: unknown, label: string): readonly string[] =>
  expectArray(value, label).map((entry) => expectString(entry, label));

const expectBoolean = (value: unknown, label: string): boolean => {
  if (typeof value !== "boolean")
    throw new Error(`${label} must be a boolean.`);
  return value;
};

const expectNumber = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a number.`);
  }
  return value;
};

const expectNonnegativeInteger = (value: unknown, label: string): number => {
  const number = expectNumber(value, label);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${label} must be a nonnegative integer.`);
  }
  return number;
};

const assertUnique = (values: readonly string[], label: string): void => {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must be unique.`);
  }
};
