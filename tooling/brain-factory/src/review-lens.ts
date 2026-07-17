export const REVIEW_LENS_NAMES = ["contract", "safety", "quality"] as const;

export type ReviewLensName = (typeof REVIEW_LENS_NAMES)[number];
export type ReviewDisposition = "pass" | "finding" | "not_applicable";
export type ReviewLensVerdict = "pass" | "rework";

export interface ReviewRubricDisposition {
  readonly rubricId: string;
  readonly disposition: ReviewDisposition;
  readonly evidence: readonly string[];
  readonly findingIds?: readonly string[];
  readonly rationale?: string;
}

export interface ReviewFinding {
  readonly id: string;
  readonly severity: string;
  readonly summary: string;
  readonly details?: string;
  readonly evidence: readonly string[];
}

export interface ReviewRubricIds {
  readonly contract: readonly string[];
  readonly safety: readonly string[];
  readonly quality: readonly string[];
}

export const DEFAULT_REVIEW_RUBRIC_IDS: ReviewRubricIds = {
  contract: [
    "contract.task-packet",
    "contract.typed-api",
    "contract.schema",
    "contract.plan",
    "contract.ownership",
    "contract.failure-contract",
  ],
  safety: [
    "safety.tenancy",
    "safety.authorization",
    "safety.lifecycle",
    "safety.privacy",
    "safety.concurrency",
    "safety.replay",
    "safety.fencing",
    "safety.provider-boundaries",
  ],
  quality: [
    "quality.test-adequacy",
    "quality.layer-law",
    "quality.maintainability",
    "quality.observability",
    "quality.budgets",
    "quality.generated-file-discipline",
  ],
};

export interface ReviewLensExpected {
  readonly taskId: string;
  readonly planSha256: string;
  readonly taskBlockHash: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly treeSha: string;
  readonly rubricIds: ReviewRubricIds;
  readonly reviewerRunIds?: Partial<Record<ReviewLensName, string>>;
}

export interface ReviewLensArtifact {
  readonly lens: ReviewLensName;
  readonly taskId: string;
  readonly planSha256: string;
  readonly taskBlockHash: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly treeSha: string;
  readonly reviewerRunId: string;
  readonly rubricDispositions: readonly ReviewRubricDisposition[];
  readonly findings: readonly ReviewFinding[];
  readonly verdict: ReviewLensVerdict;
}

export interface AggregatedReviewFinding extends ReviewFinding {
  readonly lens: ReviewLensName;
}

export interface ReviewAggregate {
  readonly taskId: string;
  readonly planSha256: string;
  readonly taskBlockHash: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly treeSha: string;
  readonly reviewerRunIds: Readonly<Record<ReviewLensName, string>>;
  readonly reviewFindings: readonly AggregatedReviewFinding[];
  readonly reviewVerdict: ReviewLensVerdict;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requiredString = (
  value: Record<string, unknown>,
  field: string,
  context: string,
): string => {
  const candidate = value[field];
  if (typeof candidate !== "string" || candidate.length === 0)
    throw new Error(`${context}: ${field} must be a non-empty string`);
  return candidate;
};

const stringArray = (
  value: unknown,
  field: string,
  context: string,
  allowEmpty = false,
): readonly string[] => {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.some((entry) => typeof entry !== "string" || entry.length === 0)
  ) {
    throw new Error(`${context}: ${field} must contain non-empty strings`);
  }
  return value;
};

const assertJsonSafe = (value: unknown, context: string): void => {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertJsonSafe(entry, `${context}[${index}]`),
    );
    return;
  }
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value))
      assertJsonSafe(entry, `${context}.${key}`);
    return;
  }
  throw new Error(`${context}: value is not JSON-safe`);
};

const validateFinding = (value: unknown, context: string): ReviewFinding => {
  if (!isRecord(value)) throw new Error(`${context}: finding must be a record`);
  const details = value.details;
  if (details !== undefined && (typeof details !== "string" || !details))
    throw new Error(`${context}: details must be a non-empty string`);
  return {
    id: requiredString(value, "id", context),
    severity: requiredString(value, "severity", context),
    summary: requiredString(value, "summary", context),
    ...(details === undefined ? {} : { details }),
    evidence: stringArray(value.evidence, "evidence", context),
  };
};

const validateDisposition = (
  value: unknown,
  context: string,
): ReviewRubricDisposition => {
  if (!isRecord(value))
    throw new Error(`${context}: rubric disposition must be a record`);
  const rubricId = requiredString(value, "rubricId", context);
  const disposition = value.disposition;
  if (!new Set(["pass", "finding", "not_applicable"]).has(String(disposition)))
    throw new Error(`${context}: invalid disposition`);
  const evidence = stringArray(value.evidence, "evidence", context);
  const findingIds =
    value.findingIds === undefined
      ? undefined
      : stringArray(value.findingIds, "findingIds", context);
  const rationale = value.rationale;
  if (rationale !== undefined && (typeof rationale !== "string" || !rationale))
    throw new Error(`${context}: rationale must be a non-empty string`);
  if (disposition === "finding" && !findingIds)
    throw new Error(`${context}: finding disposition requires findingIds`);
  if (disposition !== "finding" && findingIds)
    throw new Error(`${context}: only finding dispositions may name findings`);
  if (disposition === "not_applicable" && !rationale)
    throw new Error(
      `${context}: not_applicable requires an explicit rationale`,
    );
  return {
    rubricId,
    disposition: disposition as ReviewDisposition,
    evidence,
    ...(findingIds === undefined ? {} : { findingIds }),
    ...(rationale === undefined ? {} : { rationale }),
  };
};

const assertUnique = (
  values: readonly string[],
  message: (value: string) => string,
): void => {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(message(value));
    seen.add(value);
  }
};

export const validateReviewLens = (
  value: unknown,
  expected: ReviewLensExpected,
): ReviewLensArtifact => {
  assertJsonSafe(value, "review lens");
  if (!isRecord(value)) throw new Error("review lens must be a record");
  const lens = value.lens;
  if (!REVIEW_LENS_NAMES.includes(lens as ReviewLensName))
    throw new Error(`invalid review lens ${String(lens)}`);
  const lensName = lens as ReviewLensName;
  const context = `${expected.taskId}/${lensName}`;
  for (const field of [
    "taskId",
    "planSha256",
    "taskBlockHash",
    "baseSha",
    "headSha",
    "treeSha",
  ] as const) {
    const actual = requiredString(value, field, context);
    if (actual !== expected[field])
      throw new Error(`${context}: ${field} mismatch`);
  }
  const reviewerRunId = requiredString(value, "reviewerRunId", context);
  const expectedReviewerRunId = expected.reviewerRunIds?.[lensName];
  if (expectedReviewerRunId && reviewerRunId !== expectedReviewerRunId)
    throw new Error(`${context}: reviewerRunId mismatch`);

  if (!Array.isArray(value.rubricDispositions))
    throw new Error(`${context}: rubricDispositions must be an array`);
  const rubricDispositions = value.rubricDispositions.map((entry, index) =>
    validateDisposition(entry, `${context}/rubric/${index}`),
  );
  assertUnique(
    rubricDispositions.map(({ rubricId }) => rubricId),
    (rubricId) => `${context}: duplicate rubric disposition ${rubricId}`,
  );
  const configuredRubrics = expected.rubricIds[lensName];
  assertUnique(
    configuredRubrics,
    (rubricId) => `${context}: duplicate configured rubric ${rubricId}`,
  );
  const dispositionIds = new Set(
    rubricDispositions.map(({ rubricId }) => rubricId),
  );
  for (const rubricId of configuredRubrics) {
    if (!dispositionIds.has(rubricId))
      throw new Error(`${context}: missing rubric disposition ${rubricId}`);
  }
  for (const rubricId of dispositionIds) {
    if (!configuredRubrics.includes(rubricId))
      throw new Error(`${context}: unexpected rubric disposition ${rubricId}`);
  }

  if (!Array.isArray(value.findings))
    throw new Error(`${context}: findings must be an array`);
  const findings = value.findings.map((entry, index) =>
    validateFinding(entry, `${context}/finding/${index}`),
  );
  assertUnique(
    findings.map(({ id }) => id),
    (id) => `${context}: duplicate finding ID ${id}`,
  );
  const findingIds = new Set(findings.map(({ id }) => id));
  const referencedFindingIds = new Set(
    rubricDispositions.flatMap(({ findingIds: ids }) => ids ?? []),
  );
  for (const id of referencedFindingIds) {
    if (!findingIds.has(id))
      throw new Error(`${context}: rubric references unknown finding ${id}`);
  }
  for (const id of findingIds) {
    if (!referencedFindingIds.has(id))
      throw new Error(`${context}: finding ${id} has no rubric disposition`);
  }
  const verdict = value.verdict;
  if (verdict !== "pass" && verdict !== "rework")
    throw new Error(`${context}: invalid verdict`);
  const expectedVerdict = findings.length === 0 ? "pass" : "rework";
  if (verdict !== expectedVerdict)
    throw new Error(`${context}: verdict does not match findings`);

  return {
    lens: lensName,
    taskId: expected.taskId,
    planSha256: expected.planSha256,
    taskBlockHash: expected.taskBlockHash,
    baseSha: expected.baseSha,
    headSha: expected.headSha,
    treeSha: expected.treeSha,
    reviewerRunId,
    rubricDispositions,
    findings,
    verdict,
  };
};

export const aggregateReviewLenses = ({
  expected,
  lenses,
}: {
  readonly expected: ReviewLensExpected;
  readonly lenses: readonly unknown[];
}): ReviewAggregate => {
  const validated = lenses.map((candidate) =>
    validateReviewLens(candidate, expected),
  );
  const byName = new Map<ReviewLensName, ReviewLensArtifact>();
  for (const artifact of validated) {
    if (byName.has(artifact.lens))
      throw new Error(`duplicate review lens ${artifact.lens}`);
    byName.set(artifact.lens, artifact);
  }
  for (const name of REVIEW_LENS_NAMES) {
    if (!byName.has(name)) throw new Error(`missing review lens ${name}`);
  }
  if (byName.size !== REVIEW_LENS_NAMES.length)
    throw new Error("unexpected review lens count");

  const reviewerRunIds = Object.fromEntries(
    REVIEW_LENS_NAMES.map((name) => [name, byName.get(name)!.reviewerRunId]),
  ) as unknown as Record<ReviewLensName, string>;
  assertUnique(
    Object.values(reviewerRunIds),
    (runId) => `duplicate reviewer run ${runId}`,
  );

  const findings = REVIEW_LENS_NAMES.flatMap((name) =>
    byName.get(name)!.findings.map((finding) => ({ ...finding, lens: name })),
  );
  assertUnique(
    findings.map(({ id }) => id),
    (id) => `duplicate finding ID ${id}`,
  );
  findings.sort((left, right) => (left.id < right.id ? -1 : 1));
  const reviewVerdict = findings.length === 0 ? "pass" : "rework";
  return {
    taskId: expected.taskId,
    planSha256: expected.planSha256,
    taskBlockHash: expected.taskBlockHash,
    baseSha: expected.baseSha,
    headSha: expected.headSha,
    treeSha: expected.treeSha,
    reviewerRunIds,
    reviewFindings: findings,
    reviewVerdict,
  };
};
