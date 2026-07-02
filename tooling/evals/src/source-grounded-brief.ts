export type SourceGroundedBriefCase = {
  readonly id: string;
  readonly input: {
    readonly briefGoal: string;
    readonly sourceIds: readonly string[];
  };
  readonly requiredSourceTitles: readonly string[];
  readonly expectedTrustClaim: string;
  readonly expectedPolicySnapshotId: string;
  readonly expectedModelReceiptId: string;
  readonly expectsRefusal: boolean;
  readonly output: {
    readonly briefMarkdown: string;
    readonly sourceTitles: readonly string[];
    readonly policySnapshotId: string;
    readonly modelReceiptId: string;
    readonly trustClaim: string;
  };
};

export type SourceGroundedBriefEvalResult = {
  readonly caseId: string;
  readonly passed: boolean;
  readonly score: number;
  readonly checks: {
    readonly groundedness: boolean;
    readonly sourceCitations: boolean;
    readonly policyCompliance: boolean;
    readonly missingSourceRefusal: boolean;
  };
  readonly failures: readonly string[];
};

export const loadSourceGroundedBriefCases = (
  serializedCases: string,
): readonly SourceGroundedBriefCase[] => {
  const parsed: unknown = JSON.parse(serializedCases);

  if (!Array.isArray(parsed)) {
    throw new Error("Source grounded brief eval cases must be an array.");
  }

  return parsed.map(parseSourceGroundedBriefCase);
};

export const evaluateSourceGroundedBrief = (
  testCase: SourceGroundedBriefCase,
): SourceGroundedBriefEvalResult => {
  const groundedness = testCase.requiredSourceTitles.every((title) =>
    testCase.output.sourceTitles.includes(title),
  );
  const sourceCitations = testCase.requiredSourceTitles.every((title) =>
    testCase.output.briefMarkdown.includes(title),
  );
  const policyCompliance =
    testCase.output.trustClaim === testCase.expectedTrustClaim &&
    testCase.output.policySnapshotId === testCase.expectedPolicySnapshotId &&
    testCase.output.modelReceiptId === testCase.expectedModelReceiptId;
  const missingSourceRefusal =
    !testCase.expectsRefusal ||
    refusesMissingSources(testCase.output.briefMarkdown);

  const checks = {
    groundedness,
    sourceCitations,
    policyCompliance,
    missingSourceRefusal,
  };
  const failures = [
    groundedness
      ? undefined
      : "Brief must include every required source title.",
    sourceCitations ? undefined : "Brief must cite source titles in markdown.",
    policyCompliance
      ? undefined
      : "Brief must preserve expected policy, model, and trust provenance.",
    missingSourceRefusal
      ? undefined
      : "Missing-source cases must refuse instead of inventing a brief.",
  ].filter((failure): failure is string => typeof failure === "string");
  const passedChecks = Object.values(checks).filter(Boolean).length;

  return {
    caseId: testCase.id,
    passed: failures.length === 0,
    score: passedChecks / Object.values(checks).length,
    checks,
    failures,
  };
};

const refusesMissingSources = (briefMarkdown: string): boolean => {
  const normalized = briefMarkdown.toLowerCase();

  return (
    normalized.includes("cannot") &&
    normalized.includes("approved source") &&
    normalized.includes("brief")
  );
};

const parseSourceGroundedBriefCase = (
  candidate: unknown,
): SourceGroundedBriefCase => {
  const record = expectRecord(candidate, "eval case");
  const input = expectRecord(record.input, "eval case input");
  const output = expectRecord(record.output, "eval case output");

  return {
    id: expectString(record.id, "eval case id"),
    input: {
      briefGoal: expectString(input.briefGoal, "brief goal"),
      sourceIds: expectStringArray(input.sourceIds, "source ids"),
    },
    requiredSourceTitles: expectStringArray(
      record.requiredSourceTitles,
      "required source titles",
    ),
    expectedTrustClaim: expectString(
      record.expectedTrustClaim,
      "expected trust claim",
    ),
    expectedPolicySnapshotId: expectString(
      record.expectedPolicySnapshotId,
      "expected policy snapshot id",
    ),
    expectedModelReceiptId: expectString(
      record.expectedModelReceiptId,
      "expected model receipt id",
    ),
    expectsRefusal: expectBoolean(record.expectsRefusal, "expects refusal"),
    output: {
      briefMarkdown: expectString(output.briefMarkdown, "brief markdown"),
      sourceTitles: expectStringArray(output.sourceTitles, "source titles"),
      policySnapshotId: expectString(
        output.policySnapshotId,
        "policy snapshot id",
      ),
      modelReceiptId: expectString(output.modelReceiptId, "model receipt id"),
      trustClaim: expectString(output.trustClaim, "trust claim"),
    },
  };
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

const expectString = (value: unknown, label: string): string => {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }

  return value;
};

const expectBoolean = (value: unknown, label: string): boolean => {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean.`);
  }

  return value;
};

const expectStringArray = (
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
