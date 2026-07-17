import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { atomicWrite, jsonContent } from "./evidence-write.js";
import {
  aggregateReviewLenses,
  DEFAULT_REVIEW_RUBRIC_IDS,
  REVIEW_LENS_NAMES,
  type ReviewAggregate,
  type ReviewLensName,
  type ReviewRubricIds,
} from "./review-lens.js";
import { withAggregatedReview } from "./proof.js";

interface UpdateProofInput {
  readonly taskId: string;
  readonly workdir: string;
  readonly evidence: string;
  readonly rubricIds?: ReviewRubricIds;
  readonly reviewerRunIds: Readonly<Record<ReviewLensName, string>>;
}

const readJson = (path: string): unknown => {
  if (!existsSync(path)) throw new Error(`missing ${path}`);
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
};

const record = (value: unknown, context: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${context} must be a JSON object`);
  return value as Record<string, unknown>;
};

const proofString = (
  proof: Record<string, unknown>,
  field: string,
  taskId: string,
): string => {
  const value = proof[field];
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${taskId}: proof ${field} missing`);
  return value;
};

const gitIdentity = (workdir: string, revision: string): string =>
  execFileSync("git", ["rev-parse", revision], {
    cwd: workdir,
    encoding: "utf8",
  }).trim();

export const updateProofFromReviewLenses = (
  input: UpdateProofInput,
): ReviewAggregate => {
  const laneDirectory = resolve(input.evidence, "lane-results", input.taskId);
  const proofPath = resolve(laneDirectory, "ci-proof-packet.json");
  const proof = record(readJson(proofPath), `${input.taskId}: proof`);
  const headSha = gitIdentity(input.workdir, "HEAD");
  const treeSha = gitIdentity(input.workdir, "HEAD^{tree}");
  if (proofString(proof, "taskId", input.taskId) !== input.taskId)
    throw new Error(`${input.taskId}: proof taskId mismatch`);
  if (proofString(proof, "headSha", input.taskId) !== headSha)
    throw new Error(`${input.taskId}: proof headSha mismatch`);

  const expected = {
    taskId: input.taskId,
    planSha256: proofString(proof, "planSha256", input.taskId),
    taskBlockHash: proofString(proof, "taskBlockHash", input.taskId),
    baseSha: proofString(proof, "baseSha", input.taskId),
    headSha,
    treeSha,
    rubricIds: input.rubricIds ?? DEFAULT_REVIEW_RUBRIC_IDS,
    reviewerRunIds: input.reviewerRunIds,
  };
  const reviewDirectory = resolve(laneDirectory, "review-lenses", headSha);
  const lenses = REVIEW_LENS_NAMES.map((name) =>
    readJson(resolve(reviewDirectory, `${name}.json`)),
  );
  const aggregate = aggregateReviewLenses({ expected, lenses });
  atomicWrite(
    proofPath,
    jsonContent(withAggregatedReview(proof, aggregate, { treeSha })),
  );
  return aggregate;
};

const valueAfter = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const runCli = (): void => {
  const taskId = valueAfter("--task");
  const workdir = valueAfter("--workdir");
  const evidence = valueAfter("--evidence");
  const contractRun = valueAfter("--contract-run");
  const safetyRun = valueAfter("--safety-run");
  const qualityRun = valueAfter("--quality-run");
  if (
    !taskId ||
    !workdir ||
    !evidence ||
    !contractRun ||
    !safetyRun ||
    !qualityRun
  ) {
    console.error(
      "usage: review-aggregate --task <id> --workdir <absolute-dir> --evidence <absolute-dir> --contract-run <id> --safety-run <id> --quality-run <id>",
    );
    process.exitCode = 2;
    return;
  }
  const aggregate = updateProofFromReviewLenses({
    taskId,
    workdir,
    evidence,
    reviewerRunIds: {
      contract: contractRun,
      safety: safetyRun,
      quality: qualityRun,
    },
  });
  console.log(JSON.stringify(aggregate));
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  runCli();
}
