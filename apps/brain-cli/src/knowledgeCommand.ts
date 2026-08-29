import { createHash } from "node:crypto";
import { callMcpTool, failure, type CliResult } from "./api.js";
import {
  configFor,
  isCliResult,
  option,
  request,
  type CliDependencies,
} from "./runtime.js";

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

const extract = async (
  argv: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> => {
  const limit = boundedInteger(option(argv, "--limit"), 1, 25);
  if (Number.isNaN(limit))
    return failure("--limit must be an integer between 1 and 25.");
  return await request(dependencies, {
    operationId: "brain.knowledge.extract",
    input: limit === undefined ? {} : { limit },
  });
};

const candidates = async (
  argv: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> => {
  const state = option(argv, "--state");
  if (
    state !== undefined &&
    state !== "unreviewed" &&
    state !== "accepted" &&
    state !== "rejected" &&
    state !== "stale"
  )
    return failure("--state must be unreviewed, accepted, rejected, or stale.");
  const limit = boundedInteger(option(argv, "--limit"), 1, 50);
  if (Number.isNaN(limit))
    return failure("--limit must be an integer between 1 and 50.");
  return await requestMcp(dependencies, "template.brain.knowledge.candidates", {
    ...(state === undefined ? {} : { state }),
    ...(limit === undefined ? {} : { limit }),
  });
};

const review = async (
  argv: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> => {
  const candidateReceiptKey = argv[2]?.trim();
  if (!candidateReceiptKey)
    return failure("knowledge review requires <candidate-key>.");
  const accept = argv.includes("--accept");
  const reject = argv.includes("--reject");
  if (accept === reject)
    return failure(
      "knowledge review requires exactly one of --accept or --reject.",
    );
  const expectedReviewRevision = boundedInteger(
    option(argv, "--expected-revision"),
    0,
    Number.MAX_SAFE_INTEGER,
  );
  if (
    expectedReviewRevision === undefined ||
    Number.isNaN(expectedReviewRevision)
  )
    return failure("--expected-revision must be a non-negative integer.");
  const body = option(argv, "--body")?.trim();
  if (body !== undefined && (body.length === 0 || body.length > 500))
    return failure("--body must contain between 1 and 500 characters.");
  if (reject && body !== undefined)
    return failure("--body can only be used with --accept.");
  const reason = option(argv, "--reason")?.trim();
  if (reason !== undefined && (reason.length === 0 || reason.length > 1_000))
    return failure("--reason must contain between 1 and 1000 characters.");
  const reviewHorizonDays = boundedInteger(
    option(argv, "--review-horizon-days"),
    30,
    365,
  );
  if (Number.isNaN(reviewHorizonDays))
    return failure("--review-horizon-days must be between 30 and 365.");
  const action = reject
    ? "reject"
    : body === undefined
      ? "accept"
      : "edit_and_accept";
  const idempotencyKey =
    option(argv, "--idempotency-key")?.trim() ||
    `brain-review-cli:${createHash("sha256")
      .update(
        JSON.stringify({
          candidateReceiptKey,
          expectedReviewRevision,
          action,
          body: body ?? null,
          reason: reason ?? null,
          reviewHorizonDays: reviewHorizonDays ?? null,
        }),
      )
      .digest("hex")}`;
  return await requestMcp(dependencies, "template.brain.knowledge.review", {
    candidateReceiptKey,
    expectedReviewRevision,
    idempotencyKey,
    action,
    ...(body === undefined ? {} : { body }),
    ...(reason === undefined ? {} : { reason }),
    ...(reviewHorizonDays === undefined ? {} : { reviewHorizonDays }),
  });
};

const requestMcp = async (
  dependencies: CliDependencies,
  toolName: string,
  args: Record<string, unknown>,
): Promise<CliResult> => {
  const config = configFor(dependencies);
  return isCliResult(config)
    ? config
    : await callMcpTool(config, dependencies.fetch, toolName, args);
};

export const knowledgeCommand = async (
  argv: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> => {
  if (argv[1] === "extract") return await extract(argv, dependencies);
  if (argv[1] === "candidates") return await candidates(argv, dependencies);
  if (argv[1] === "review") return await review(argv, dependencies);
  return failure(
    "Usage: maestro-brain knowledge extract [--limit <1-25>] | knowledge candidates [--state <state>] [--limit <1-50>] | knowledge review <candidate-key> --accept|--reject --expected-revision <n>",
  );
};
