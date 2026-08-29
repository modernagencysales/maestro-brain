import { createHash } from "node:crypto";
import { failure, success, type CliResult } from "./api.js";
import { option, request, type CliDependencies } from "./runtime.js";

type EvidenceMode = "recent_evidence" | "company_truth" | "mixed";
type AnswerStatus = "answered" | "insufficient-context";
type RiskLevel = "ordinary" | "high";

type EvidenceReference = {
  readonly sourceKey: string;
  readonly revisionKey: string;
  readonly contentHash: string;
};

type EvaluationExample = {
  readonly id: string;
  readonly exampleKey: string;
  readonly question: string;
  readonly purpose?: string;
  readonly evidenceMode: EvidenceMode;
  readonly riskLevel: RiskLevel;
  readonly expectedStatus?: AnswerStatus;
  readonly answerStatus?: AnswerStatus;
  readonly packHash?: string;
  readonly maxCitations?: number;
  readonly expectedEvidenceReferences: readonly EvidenceReference[];
  readonly evidenceReferences: readonly EvidenceReference[];
  readonly usefulness?: "useful" | "needs-work" | "unrated";
  readonly issueReason?: string;
  readonly adjudicationState: "pending" | "adjudicated";
  readonly split: "development" | "holdout";
  readonly adjudicatedAt?: number;
  readonly createdAt?: number;
  readonly updatedAt?: number;
};

const usage = `Usage: maestro-brain eval status [--json]
       maestro-brain eval list [--split development|holdout] [--limit <1-100>] [--json]
       maestro-brain eval show <example-key> [--json]
       maestro-brain eval export [--split development|holdout]
       maestro-brain eval adjudicate <example-key> --expected-updated-at <epoch-ms> --expected answered|insufficient-context --risk ordinary|high [--support <source-key>|<revision-key>|<content-hash>]...
       maestro-brain eval freeze [--after <ISO-8601|epoch-ms>] [--json]
       maestro-brain eval freeze --after <ISO-8601|epoch-ms> --apply --preview-hash <sha256:...> [--json]
       maestro-brain eval run [--split development|holdout] --as-of <ISO-8601|epoch-ms> [--limit <1-100>] [--json]

Saved examples contain the full opted-in question and immutable evidence
identities. They are shared with the workspace and retained until workspace
deletion. Export never includes evidence excerpts.`;

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const apiResult = (result: CliResult): unknown | CliResult => {
  if (result.exitCode !== 0) return result;
  try {
    const body = record(JSON.parse(result.stdout));
    return body?.ok === true && "result" in body
      ? body.result
      : failure("Brain evaluation API returned an invalid response.");
  } catch {
    return failure("Brain evaluation API returned invalid JSON.");
  }
};

const isCliResult = (value: unknown | CliResult): value is CliResult =>
  record(value) !== undefined &&
  "exitCode" in (value as Record<string, unknown>);

const boundedInteger = (
  raw: string | undefined,
  minimum: number,
  maximum: number,
): number | undefined => {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : Number.NaN;
};

const timestamp = (raw: string | undefined): number | undefined => {
  if (raw === undefined) return undefined;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric >= 0) return numeric;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : Number.NaN;
};

const splitOption = (
  argv: readonly string[],
): "development" | "holdout" | undefined | CliResult => {
  const split = option(argv, "--split");
  return split === undefined || split === "development" || split === "holdout"
    ? split
    : failure("--split must be development or holdout.");
};

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;

const evidenceReference = (value: unknown): EvidenceReference | undefined => {
  const candidate = record(value);
  const sourceKey = text(candidate?.sourceKey);
  const revisionKey = text(candidate?.revisionKey);
  const contentHash = text(candidate?.contentHash);
  return sourceKey && revisionKey && contentHash
    ? { sourceKey, revisionKey, contentHash }
    : undefined;
};

const references = (value: unknown): readonly EvidenceReference[] =>
  Array.isArray(value)
    ? value.flatMap((candidate) => {
        const parsed = evidenceReference(candidate);
        return parsed === undefined ? [] : [parsed];
      })
    : [];

const evaluationExample = (value: unknown): EvaluationExample | undefined => {
  const candidate = record(value);
  if (candidate === undefined) return undefined;
  const exampleKey = text(candidate.exampleKey);
  const id =
    text(candidate.evaluationExampleId) ??
    text(candidate.id) ??
    text(candidate._id) ??
    exampleKey;
  const question = text(candidate.question);
  const purpose = text(candidate.purpose);
  const packHash = text(candidate.packHash);
  const issueReason = text(candidate.issueReason);
  const evidenceMode = candidate.evidenceMode;
  const riskLevel = candidate.riskLevel ?? "ordinary";
  const split = candidate.split ?? "development";
  if (
    !id ||
    !exampleKey ||
    !question ||
    (evidenceMode !== "recent_evidence" &&
      evidenceMode !== "company_truth" &&
      evidenceMode !== "mixed") ||
    (riskLevel !== "ordinary" && riskLevel !== "high") ||
    (split !== "development" && split !== "holdout")
  )
    return undefined;
  const expectedStatus =
    candidate.expectedAnswerStatus === "answered" ||
    candidate.expectedAnswerStatus === "insufficient-context"
      ? candidate.expectedAnswerStatus
      : candidate.expectedStatus === "answered" ||
          candidate.expectedStatus === "insufficient-context"
        ? candidate.expectedStatus
        : undefined;
  const answerStatus =
    candidate.answerStatus === "answered" ||
    candidate.answerStatus === "insufficient-context"
      ? candidate.answerStatus
      : undefined;
  const adjudicationState =
    candidate.adjudicationState === "adjudicated" ? "adjudicated" : "pending";
  return {
    id,
    exampleKey,
    question,
    ...(purpose === undefined ? {} : { purpose }),
    evidenceMode,
    riskLevel,
    ...(expectedStatus === undefined ? {} : { expectedStatus }),
    ...(answerStatus === undefined ? {} : { answerStatus }),
    ...(packHash === undefined ? {} : { packHash }),
    ...(typeof candidate.maxCitations === "number"
      ? { maxCitations: candidate.maxCitations }
      : {}),
    expectedEvidenceReferences: references(
      candidate.expectedEvidenceReferences,
    ),
    evidenceReferences: references(candidate.evidenceReferences),
    ...(candidate.usefulness === "useful" ||
    candidate.usefulness === "needs-work" ||
    candidate.usefulness === "unrated"
      ? { usefulness: candidate.usefulness }
      : {}),
    ...(issueReason === undefined ? {} : { issueReason }),
    adjudicationState,
    split,
    ...(typeof candidate.adjudicatedAt === "number"
      ? { adjudicatedAt: candidate.adjudicatedAt }
      : {}),
    ...(typeof candidate.createdAt === "number"
      ? { createdAt: candidate.createdAt }
      : {}),
    ...(typeof candidate.updatedAt === "number"
      ? { updatedAt: candidate.updatedAt }
      : {}),
  };
};

const examplesFrom = (value: unknown): readonly EvaluationExample[] => {
  const body = record(value);
  const rows = Array.isArray(value)
    ? value
    : Array.isArray(body?.examples)
      ? body.examples
      : Array.isArray(body?.items)
        ? body.items
        : [];
  return rows
    .flatMap((candidate) => {
      const parsed = evaluationExample(candidate);
      return parsed === undefined ? [] : [parsed];
    })
    .sort(
      (left, right) =>
        (left.createdAt ?? 0) - (right.createdAt ?? 0) ||
        left.id.localeCompare(right.id),
    );
};

const listExamples = async (
  dependencies: CliDependencies,
  input: Record<string, unknown>,
): Promise<
  | { readonly raw: unknown; readonly examples: readonly EvaluationExample[] }
  | CliResult
> => {
  const response = apiResult(
    await request(dependencies, {
      operationId: "brain.evaluations.list",
      input,
    }),
  );
  return isCliResult(response)
    ? response
    : { raw: response, examples: examplesFrom(response) };
};

const allExamples = async (
  dependencies: CliDependencies,
): Promise<readonly EvaluationExample[] | CliResult> => {
  return await collectExamples(dependencies, {}, 500);
};

const collectExamples = async (
  dependencies: CliDependencies,
  input: Record<string, unknown>,
  maximum: number,
): Promise<readonly EvaluationExample[] | CliResult> => {
  const examples: EvaluationExample[] = [];
  let cursor: Record<string, unknown> = {};
  for (let page = 0; page < 5; page += 1) {
    const remaining = maximum - examples.length;
    if (remaining <= 0) return examples;
    const listed = await listExamples(dependencies, {
      ...input,
      ...cursor,
      limit: Math.min(100, remaining),
    });
    if ("exitCode" in listed) return listed;
    examples.push(...listed.examples);
    const raw = record(listed.raw);
    const nextCursorCreatedAt = raw?.nextCursorCreatedAt;
    const nextCursorExampleKey = text(raw?.nextCursorExampleKey);
    if (
      typeof nextCursorCreatedAt !== "number" ||
      nextCursorExampleKey === undefined
    )
      return examples;
    cursor = {
      cursorCreatedAt: nextCursorCreatedAt,
      cursorExampleKey: nextCursorExampleKey,
    };
  }
  return examples;
};

const status = async (
  argv: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> => {
  const listed = await allExamples(dependencies);
  if (isCliResult(listed)) return listed;
  const total = listed.length;
  const development = listed.filter(
    ({ split }) => split === "development",
  ).length;
  const holdout = listed.filter(({ split }) => split === "holdout").length;
  const adjudicated = listed.filter(
    ({ adjudicationState }) => adjudicationState === "adjudicated",
  ).length;
  const result = {
    status: "ok",
    maturity: adjudicated < 25 ? "insufficient-sample" : "provisional",
    counts: { total, development, holdout, adjudicated },
    retention:
      "Opted-in full questions are shared with the workspace and retained until workspace deletion.",
  };
  return argv.includes("--json")
    ? success(result)
    : success(
        `Evaluation set: ${result.maturity}\nExamples: ${total} (${development} development, ${holdout} holdout; ${adjudicated} adjudicated)\nRetention: ${result.retention}`,
      );
};

const list = async (
  argv: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> => {
  const split = splitOption(argv);
  if (isCliResult(split)) return split;
  const limit = boundedInteger(option(argv, "--limit"), 1, 100);
  if (Number.isNaN(limit)) return failure("--limit must be from 1 to 100.");
  const listed = await listExamples(dependencies, {
    ...(split === undefined ? {} : { split }),
    limit: limit ?? 50,
  });
  if ("exitCode" in listed) return listed;
  if (argv.includes("--json"))
    return success({
      examples: listed.examples,
      count: listed.examples.length,
    });
  if (listed.examples.length === 0)
    return success(
      "No evaluation examples yet. Save a real question with maestro-brain ask <question> --save-example.",
    );
  return success(
    listed.examples
      .map(
        (example) =>
          `${example.exampleKey}\t${example.split}\t${example.adjudicationState}${example.expectedStatus === undefined ? "" : `:${example.expectedStatus}`}\t${example.question}`,
      )
      .join("\n"),
  );
};

const show = async (
  argv: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> => {
  const exampleKey = argv[2]?.trim();
  if (!exampleKey) return failure("eval show requires <example-key>.");
  const response = apiResult(
    await request(dependencies, {
      operationId: "brain.evaluations.get",
      input: { exampleKey },
    }),
  );
  if (isCliResult(response)) return response;
  const example = evaluationExample(response);
  if (example === undefined)
    return failure("Brain evaluation API returned an invalid example.");
  return argv.includes("--json")
    ? success(example)
    : success(
        `${example.exampleKey} [${example.split}]\n${example.question}\nMode: ${example.evidenceMode}; risk: ${example.riskLevel}; adjudication: ${example.adjudicationState}; expected: ${example.expectedStatus ?? "hidden or pending"}\nEvidence identities: ${example.expectedEvidenceReferences.length || example.evidenceReferences.length}\nRetention: full opted-in question retained until workspace deletion.`,
      );
};

const exportExamples = async (
  argv: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> => {
  const split = splitOption(argv);
  if (isCliResult(split)) return split;
  const response = apiResult(
    await request(dependencies, {
      operationId: "brain.evaluations.export",
      input: split === undefined ? {} : { split },
    }),
  );
  if (isCliResult(response)) return response;
  return success(response);
};

const supportOptions = (
  argv: readonly string[],
): readonly EvidenceReference[] | CliResult => {
  const results: EvidenceReference[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--support") continue;
    const raw = argv[index + 1];
    const parts = raw?.split("|") ?? [];
    if (parts.length !== 3 || parts.some((part) => part.trim().length === 0))
      return failure(
        "--support must be <source-key>|<revision-key>|<content-hash>.",
      );
    results.push({
      sourceKey: parts[0]?.trim() ?? "",
      revisionKey: parts[1]?.trim() ?? "",
      contentHash: parts[2]?.trim() ?? "",
    });
    index += 1;
  }
  return results;
};

const adjudicate = async (
  argv: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> => {
  const exampleKey = argv[2]?.trim();
  if (!exampleKey) return failure("eval adjudicate requires <example-key>.");
  const expectedUpdatedAt = boundedInteger(
    option(argv, "--expected-updated-at"),
    0,
    Number.MAX_SAFE_INTEGER,
  );
  if (expectedUpdatedAt === undefined || Number.isNaN(expectedUpdatedAt))
    return failure(
      "--expected-updated-at must be non-negative epoch milliseconds.",
    );
  const expectedStatus = option(argv, "--expected");
  if (
    expectedStatus !== "answered" &&
    expectedStatus !== "insufficient-context"
  )
    return failure("--expected must be answered or insufficient-context.");
  const riskLevel = option(argv, "--risk");
  if (riskLevel !== "ordinary" && riskLevel !== "high")
    return failure("--risk must be ordinary or high.");
  const support = supportOptions(argv);
  if (isCliResult(support)) return support;
  if (expectedStatus === "answered" && support.length === 0)
    return failure("An answered example requires at least one --support.");
  if (expectedStatus === "insufficient-context" && support.length > 0)
    return failure("An insufficient-context example cannot have --support.");
  const input = {
    exampleKey,
    expectedUpdatedAt,
    expectedAnswerStatus: expectedStatus,
    riskLevel,
    expectedEvidenceReferences: support,
  };
  const idempotencyKey = `brain-evaluation-adjudicate:${createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex")}`;
  return await request(dependencies, {
    operationId: "brain.evaluations.adjudicate",
    input,
    idempotencyKey,
  });
};

const freeze = async (
  argv: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> => {
  const after = timestamp(option(argv, "--after"));
  if (Number.isNaN(after))
    return failure(
      "--after must be ISO-8601 or non-negative epoch milliseconds.",
    );
  const cutoffCreatedAt = after ?? dependencies.now();
  const apply = argv.includes("--apply");
  const reviewedPreviewHash = text(option(argv, "--preview-hash"));
  if (apply && after === undefined)
    return failure("eval freeze --apply requires the reviewed --after cutoff.");
  if (
    apply &&
    (reviewedPreviewHash === undefined ||
      !/^sha256:[a-f0-9]{64}$/u.test(reviewedPreviewHash))
  )
    return failure(
      "eval freeze --apply requires --preview-hash from the reviewed preview.",
    );
  if (apply) {
    const freezeKey = `cli:${createHash("sha256")
      .update(
        JSON.stringify({
          cutoffCreatedAt,
          expectedPreviewHash: reviewedPreviewHash,
        }),
      )
      .digest("hex")}`;
    const result = await request(dependencies, {
      operationId: "brain.evaluations.freezeApply",
      input: {
        cutoffCreatedAt,
        expectedPreviewHash: reviewedPreviewHash,
        freezeKey,
      },
      idempotencyKey: freezeKey,
    });
    if (result.exitCode !== 0 || argv.includes("--json")) return result;
    const parsed = apiResult(result);
    if (isCliResult(parsed)) return parsed;
    return success(
      `Holdout freeze applied.\n${JSON.stringify(parsed, null, 2)}`,
    );
  }
  const previewResult = await request(dependencies, {
    operationId: "brain.evaluations.freezePreview",
    input: { cutoffCreatedAt },
  });
  if (previewResult.exitCode !== 0) return previewResult;
  const preview = apiResult(previewResult);
  if (isCliResult(preview)) return preview;
  return argv.includes("--json")
    ? success(preview)
    : success(
        `Holdout freeze preview.\n${JSON.stringify(preview, null, 2)}\nNo examples were changed. Review the cutoff and previewHash, then rerun with --apply --preview-hash <previewHash>.`,
      );
};

const citationRecord = (value: unknown): Record<string, unknown> | undefined =>
  record(value);

const run = async (
  argv: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> => {
  const split = splitOption(argv);
  if (isCliResult(split)) return split;
  const selectedSplit = split ?? "holdout";
  const asOf = timestamp(option(argv, "--as-of"));
  if (asOf === undefined || Number.isNaN(asOf))
    return failure(
      "eval run requires --as-of <ISO-8601|epoch-ms> so every question shares one explicit evaluation time.",
    );
  const limit = boundedInteger(option(argv, "--limit"), 1, 100);
  if (Number.isNaN(limit)) return failure("--limit must be from 1 to 100.");
  const listed = await collectExamples(
    dependencies,
    {
      split: selectedSplit,
      adjudicationState: "adjudicated",
      includeHoldoutGold: true,
    },
    limit ?? 500,
  );
  if (isCliResult(listed)) return listed;
  const examples = listed.filter(
    ({ expectedStatus }) => expectedStatus !== undefined,
  );
  const results: Record<string, unknown>[] = [];
  let requestFailures = 0;
  let expectedStatusMatches = 0;
  let abstentionDenominator = 0;
  let correctAbstentions = 0;
  let expectedSourceDenominator = 0;
  let recalledSources = 0;
  let citationIdentityDenominator = 0;
  let exactCitationIdentities = 0;
  let reopeningDenominator = 0;
  let reopeningAvailable = 0;
  let packDriftDenominator = 0;
  let unchangedPacks = 0;

  for (const example of examples) {
    const response = apiResult(
      await request(dependencies, {
        operationId: "brain.ask",
        input: {
          question: example.question,
          evidenceMode: example.evidenceMode,
          riskLevel: example.riskLevel,
          maxCitations: example.maxCitations ?? 5,
          asOf,
        },
      }),
    );
    if (isCliResult(response)) {
      requestFailures += 1;
      results.push({
        exampleKey: example.exampleKey,
        status: "request-failed",
        exitCode: response.exitCode,
      });
      continue;
    }
    const answer = record(response);
    const actualStatus =
      answer?.status === "answered" || answer?.status === "insufficient-context"
        ? answer.status
        : undefined;
    const contextPack = record(answer?.contextPack);
    const citations = Array.isArray(contextPack?.citations)
      ? contextPack.citations
          .map(citationRecord)
          .filter((row) => row !== undefined)
      : [];
    const expectedReferences = example.expectedEvidenceReferences;
    const expectedSources = [
      ...new Set(expectedReferences.map(({ sourceKey }) => sourceKey)),
    ];
    const topSources = new Set(
      citations.slice(0, 5).flatMap((citation) => {
        const sourceKey = text(citation.sourceKey);
        return sourceKey === undefined ? [] : [sourceKey];
      }),
    );
    const sourceHits = expectedSources.filter((sourceKey) =>
      topSources.has(sourceKey),
    ).length;
    expectedSourceDenominator += expectedSources.length;
    recalledSources += sourceHits;
    if (actualStatus === example.expectedStatus) expectedStatusMatches += 1;
    if (example.expectedStatus === "insufficient-context") {
      abstentionDenominator += 1;
      if (actualStatus === "insufficient-context") correctAbstentions += 1;
    }
    const observedCitationIdentities = new Set(
      citations.slice(0, 5).flatMap((citation) => {
        const sourceKey = text(citation.sourceKey);
        const revisionKey = text(citation.revisionKey);
        const contentHash = text(citation.contentHash);
        return sourceKey === undefined ||
          revisionKey === undefined ||
          contentHash === undefined
          ? []
          : [`${sourceKey}\u0000${revisionKey}\u0000${contentHash}`];
      }),
    );
    for (const expectedReference of expectedReferences) {
      citationIdentityDenominator += 1;
      if (
        observedCitationIdentities.has(
          `${expectedReference.sourceKey}\u0000${expectedReference.revisionKey}\u0000${expectedReference.contentHash}`,
        )
      )
        exactCitationIdentities += 1;
    }
    for (const citation of citations) {
      const sourceKey = text(citation.sourceKey);
      const revisionKey = text(citation.revisionKey);
      const contentHash = text(citation.contentHash);
      if (sourceKey !== undefined && revisionKey !== undefined) {
        reopeningDenominator += 1;
        const reopened = apiResult(
          await request(dependencies, {
            operationId: "brain.evidence.sourceGet",
            input: { sourceKey, revisionKey },
          }),
        );
        if (!isCliResult(reopened)) {
          const exact = record(reopened);
          if (
            text(exact?.sourceKey) === sourceKey &&
            text(exact?.revisionKey) === revisionKey &&
            contentHash !== undefined &&
            text(exact?.contentHash) === contentHash &&
            exact?.tombstone !== true
          )
            reopeningAvailable += 1;
        }
      }
    }
    const actualPackHash = text(contextPack?.packHash);
    if (example.packHash !== undefined && actualPackHash !== undefined) {
      packDriftDenominator += 1;
      if (example.packHash === actualPackHash) unchangedPacks += 1;
    }
    results.push({
      exampleKey: example.exampleKey,
      status: "evaluated",
      expectedStatus: example.expectedStatus,
      actualStatus: actualStatus ?? "invalid-response",
      expectedSourceCount: expectedSources.length,
      recalledSourceCountAt5: sourceHits,
      citationCount: citations.length,
      ...(example.packHash === undefined || actualPackHash === undefined
        ? { packDrift: "unavailable" }
        : {
            packDrift: example.packHash === actualPackHash ? "none" : "changed",
          }),
    });
  }

  const evaluated = examples.length - requestFailures;
  const ratio = (numerator: number, denominator: number): number | null =>
    denominator === 0 ? null : numerator / denominator;
  const expectedStatusAccuracy = ratio(expectedStatusMatches, evaluated);
  const correctAbstentionRate = ratio(
    correctAbstentions,
    abstentionDenominator,
  );
  const sourceRecallAt5 = ratio(recalledSources, expectedSourceDenominator);
  const exactCitationIdentityRate = ratio(
    exactCitationIdentities,
    citationIdentityDenominator,
  );
  const reopeningRate = ratio(reopeningAvailable, reopeningDenominator);
  const minimumSample = examples.length >= 25;
  const maturity = !minimumSample ? "insufficient-sample" : "provisional";
  const report = {
    schemaVersion: 1,
    split: selectedSplit,
    asOf,
    maturity,
    counts: {
      listed: listed.length,
      adjudicated: examples.length,
      evaluated,
      requestFailures,
    },
    metrics: {
      expectedStatus: {
        numerator: expectedStatusMatches,
        denominator: evaluated,
        rate: expectedStatusAccuracy,
      },
      correctAbstention: {
        numerator: correctAbstentions,
        denominator: abstentionDenominator,
        rate: correctAbstentionRate,
      },
      supportingSourceRecallAt5: {
        numerator: recalledSources,
        denominator: expectedSourceDenominator,
        rate: sourceRecallAt5,
      },
      citationExactIdentity: {
        numerator: exactCitationIdentities,
        denominator: citationIdentityDenominator,
        rate: exactCitationIdentityRate,
      },
      citationReopening: {
        numerator: reopeningAvailable,
        denominator: reopeningDenominator,
        rate: reopeningRate,
        availability: reopeningDenominator === 0 ? "unavailable" : "reported",
      },
      citationEntailment: {
        numerator: 0,
        denominator: 0,
        rate: null,
        assessment: "not-assessed",
      },
      packDrift: {
        unchanged: unchangedPacks,
        changed: packDriftDenominator - unchangedPacks,
        denominator: packDriftDenominator,
        diagnosticOnly: true,
      },
    },
    results,
  };
  if (argv.includes("--json")) return success(report);
  const metric = (numerator: number, denominator: number): string =>
    `${numerator}/${denominator}`;
  return success(
    `Evaluation run: ${maturity}\nSplit: ${selectedSplit}; as of: ${new Date(asOf).toISOString()}\nExamples: ${evaluated}/${examples.length} evaluated (${requestFailures} request failures)\nExpected status: ${metric(expectedStatusMatches, evaluated)}\nCorrect abstention: ${metric(correctAbstentions, abstentionDenominator)}\nSupporting-source recall@5: ${metric(recalledSources, expectedSourceDenominator)}\nExact citation identity: ${metric(exactCitationIdentities, citationIdentityDenominator)}\nCitation reopening: ${reopeningDenominator === 0 ? "unavailable" : metric(reopeningAvailable, reopeningDenominator)}\nCitation entailment: not assessed\nPack drift: ${packDriftDenominator - unchangedPacks}/${packDriftDenominator} changed`,
  );
};

export const evaluationCommand = async (
  argv: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> => {
  if (argv[1] === "status") return await status(argv, dependencies);
  if (argv[1] === "list") return await list(argv, dependencies);
  if (argv[1] === "show") return await show(argv, dependencies);
  if (argv[1] === "export") return await exportExamples(argv, dependencies);
  if (argv[1] === "adjudicate") return await adjudicate(argv, dependencies);
  if (argv[1] === "freeze") return await freeze(argv, dependencies);
  if (argv[1] === "run") return await run(argv, dependencies);
  return failure(usage);
};

export const evaluationHelp = usage;
