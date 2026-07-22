import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { atomicWrite, fileSha256, jsonContent } from "./evidence-write.js";
import {
  aggregateReviewLenses,
  DEFAULT_REVIEW_RUBRIC_IDS,
  REVIEW_LENS_NAMES,
  type ReviewAggregate,
  type ReviewLensArtifact,
  type ReviewLensName,
  type ReviewRubricIds,
  validateReviewLens,
} from "./review-lens.js";
import { withAggregatedReview } from "./proof.js";
import { validateContractReproofRequest } from "./contract-reproof.js";
import { buildManifest } from "./manifest.js";
import {
  releaseReviewWorktreeGuard,
  verifyReviewWorktree,
} from "./review-worktree-guard.js";
import {
  beginReviewAggregation,
  bindReviewAggregationResult,
  cleanupReviewWorktrees,
  readCompletedReviewAggregation,
} from "./review-worktrees.js";
import { releaseReviewAggregationSocketLease } from "./review-aggregation-lease.js";

const requiredMapValue = <K, V>(
  values: ReadonlyMap<K, V>,
  key: K,
  label: string,
): V => {
  const value = values.get(key);
  if (value === undefined) throw new Error(`missing ${label}`);
  return value;
};

interface UpdateProofInput {
  readonly taskId: string;
  readonly workdir: string;
  readonly evidence: string;
  readonly rubricIds?: ReviewRubricIds;
  readonly reviewerRunIds: Readonly<Record<ReviewLensName, string>>;
  readonly reproofRequest?: string | undefined;
}

const priorFindingsFor = (input: {
  readonly proof: Record<string, unknown>;
  readonly reproofRequest?: string | undefined;
  readonly taskId: string;
}) => {
  if (!input.reproofRequest || input.reproofRequest === "none") return [];
  const task = buildManifest().tasks.find(
    ({ taskId }) => taskId === input.taskId,
  );
  if (!task) throw new Error(`unknown task ${input.taskId}`);
  return (
    validateContractReproofRequest(readJson(input.reproofRequest), {
      taskId: input.taskId,
      planSha256: proofString(input.proof, "planSha256", input.taskId),
      taskBlockHash: proofString(input.proof, "taskBlockHash", input.taskId),
      controlHeadSha: proofString(input.proof, "baseSha", input.taskId),
      fileLocks: task.fileLocks,
    }).findings ?? []
  );
};

const readJson = (path: string): unknown => {
  if (!existsSync(path)) throw new Error(`missing ${path}`);
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
};

const record = (value: unknown, context: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${context} must be a JSON object`);
  return value as Record<string, unknown>;
};

const digestPromotionCore = (
  laneDirectory: string,
  excludedRelativePaths: ReadonlySet<string>,
): string => {
  const hash = createHash("sha256");
  const visit = (directory: string, relativeDirectory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const path = resolve(directory, name);
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${name}`
        : name;
      if (excludedRelativePaths.has(relativePath)) continue;
      const stat = lstatSync(path);
      if (stat.isSymbolicLink())
        throw new Error("review promotion evidence must not contain symlinks");
      if (stat.isDirectory()) visit(path, relativePath);
      else if (stat.isFile()) {
        hash.update(`file\0${relativePath}\0`);
        hash.update(readFileSync(path));
      } else
        throw new Error(
          "review promotion evidence must contain only regular files",
        );
    }
  };
  visit(laneDirectory, "");
  return hash.digest("hex");
};

const sameRecord = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

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
  execFileSync("rtk", ["proxy", "git", "rev-parse", revision], {
    cwd: workdir,
    encoding: "utf8",
  }).trim();

const git = (repo: string, ...args: readonly string[]): string =>
  execFileSync("rtk", ["proxy", "git", ...args], {
    cwd: repo,
    encoding: "utf8",
  }).trim();

const gitRaw = (repo: string, ...args: readonly string[]): string =>
  execFileSync("rtk", ["proxy", "git", ...args], {
    cwd: repo,
    encoding: "utf8",
  });

interface ParallelReviewLensCollection {
  readonly aggregate: ReviewAggregate;
  readonly artifacts: readonly ReviewLensArtifact[];
  readonly artifactContents: Readonly<Record<ReviewLensName, string>>;
  readonly artifactSha256: Readonly<Record<ReviewLensName, string>>;
  readonly commits: Readonly<Record<ReviewLensName, string>>;
  readonly reviewerRunIds: Readonly<Record<ReviewLensName, string>>;
}

export const collectParallelReviewLenses = (input: {
  readonly attempt: string;
  readonly taskId: string;
  readonly workdir: string;
  readonly reviewRepo: string;
  readonly evidence: string;
  readonly rubricIds?: ReviewRubricIds;
  readonly reproofRequest?: string | undefined;
}): ParallelReviewLensCollection => {
  if (!/^S\d{2}-T\d{2}$/.test(input.taskId))
    throw new Error("review task coordinate is invalid");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(input.attempt))
    throw new Error("review attempt coordinate is invalid");
  const headSha = gitIdentity(input.workdir, "HEAD");
  const refPrefix = `refs/heads/maestro/review/${input.taskId}/${headSha}/${input.attempt}/`;
  const refLines = git(
    input.reviewRepo,
    "for-each-ref",
    "--format=%(refname) %(objectname)",
    refPrefix,
  )
    .split("\n")
    .filter(Boolean);
  const refPattern = new RegExp(`^${refPrefix}(contract|safety|quality)$`);
  const refs = refLines.map((line) => {
    const separator = line.lastIndexOf(" ");
    const ref = line.slice(0, separator);
    const commit = line.slice(separator + 1);
    const match = refPattern.exec(ref);
    if (!match) throw new Error(`unexpected parallel review ref ${ref}`);
    return {
      ref,
      branch: ref.slice("refs/heads/".length),
      commit,
      lens: match[1] as ReviewLensName,
    };
  });
  const currentRefs = refs;
  const byLens = new Map<ReviewLensName, (typeof currentRefs)[number]>();
  for (const candidate of currentRefs) {
    if (byLens.has(candidate.lens))
      throw new Error(`duplicate current review ref for ${candidate.lens}`);
    byLens.set(candidate.lens, candidate);
  }
  for (const lens of REVIEW_LENS_NAMES) {
    if (!byLens.has(lens))
      throw new Error(`missing current review ref for ${lens}`);
  }
  if (currentRefs.length !== REVIEW_LENS_NAMES.length)
    throw new Error("unexpected current review ref count");

  const commits = Object.fromEntries(
    REVIEW_LENS_NAMES.map((lens) => [
      lens,
      requiredMapValue(byLens, lens, `${lens} current review ref`).commit,
    ]),
  ) as Record<ReviewLensName, string>;
  if (new Set(Object.values(commits)).size !== REVIEW_LENS_NAMES.length)
    throw new Error("parallel review checkpoint commits must be distinct");

  const laneDirectory = resolve(input.evidence, "lane-results", input.taskId);
  const proof = record(
    readJson(resolve(laneDirectory, "ci-proof-packet.json")),
    `${input.taskId}: proof`,
  );
  const treeSha = gitIdentity(input.workdir, "HEAD^{tree}");
  if (proofString(proof, "taskId", input.taskId) !== input.taskId)
    throw new Error(`${input.taskId}: proof taskId mismatch`);
  if (proofString(proof, "headSha", input.taskId) !== headSha)
    throw new Error(`${input.taskId}: proof headSha mismatch`);
  const reviewerRunIds = Object.fromEntries(
    REVIEW_LENS_NAMES.map((lens) => [
      lens,
      requiredMapValue(byLens, lens, `${lens} current review ref`).branch,
    ]),
  ) as Record<ReviewLensName, string>;
  const expected = {
    taskId: input.taskId,
    planSha256: proofString(proof, "planSha256", input.taskId),
    taskBlockHash: proofString(proof, "taskBlockHash", input.taskId),
    baseSha: proofString(proof, "baseSha", input.taskId),
    headSha,
    treeSha,
    rubricIds: input.rubricIds ?? DEFAULT_REVIEW_RUBRIC_IDS,
    reviewerRunIds,
    priorFindings: priorFindingsFor({
      proof,
      reproofRequest: input.reproofRequest,
      taskId: input.taskId,
    }),
  };

  const artifactContents = {} as Record<ReviewLensName, string>;
  const artifactSha256 = {} as Record<ReviewLensName, string>;
  const artifacts = REVIEW_LENS_NAMES.map((lens) => {
    const { commit } = requiredMapValue(
      byLens,
      lens,
      `${lens} current review ref`,
    );
    const parents = git(
      input.reviewRepo,
      "rev-list",
      "--parents",
      "-n",
      "1",
      commit,
    )
      .split(" ")
      .filter(Boolean);
    if (parents.length !== 2)
      throw new Error(`${lens}: checkpoint must have exactly one parent`);
    const parent = parents[1];
    if (!parent || parent !== headSha)
      throw new Error(
        `${lens}: checkpoint parent does not match reviewed head`,
      );
    const path = `.brain-review-output/${lens}.json`;
    const changed = git(
      input.reviewRepo,
      "diff-tree",
      "--no-commit-id",
      "--name-only",
      "-r",
      "--no-renames",
      parent,
      commit,
    )
      .split("\n")
      .filter(Boolean);
    if (changed.length !== 1 || changed[0] !== path)
      throw new Error(
        `${lens}: checkpoint delta must contain only ${path}; received ${changed.join(", ") || "nothing"}`,
      );
    const mode = git(input.reviewRepo, "ls-tree", commit, "--", path).split(
      /\s+/,
    )[0];
    if (mode !== "100644")
      throw new Error(`${lens}: checkpoint artifact must be a regular file`);
    const contents = gitRaw(input.reviewRepo, "show", `${commit}:${path}`);
    artifactContents[lens] = contents;
    artifactSha256[lens] = createHash("sha256").update(contents).digest("hex");
    return validateReviewLens(JSON.parse(contents) as unknown, expected);
  });
  const aggregate = aggregateReviewLenses({ expected, lenses: artifacts });
  return {
    aggregate,
    artifacts,
    artifactContents,
    artifactSha256,
    commits,
    reviewerRunIds,
  };
};

export const aggregateParallelReviewBranches = async (input: {
  readonly attempt: string;
  readonly taskId: string;
  readonly workdir: string;
  readonly reviewRepo: string;
  readonly evidence: string;
  readonly rubricIds?: ReviewRubricIds;
  readonly reproofRequest?: string | undefined;
}): Promise<ReviewAggregate> => {
  const headSha = gitIdentity(input.workdir, "HEAD");
  const coordinates = {
    attemptId: input.attempt,
    evidence: input.evidence,
    headSha,
    taskId: input.taskId,
    workdir: input.workdir,
  };
  const completed = readCompletedReviewAggregation(coordinates);
  const lease = completed
    ? undefined
    : await beginReviewAggregation(coordinates);
  const prepared = completed?.prepared ?? lease?.prepared;
  if (!prepared) throw new Error("review aggregation preparation is missing");
  const collected = collectParallelReviewLenses({
    ...input,
    attempt: prepared.attemptId,
  });
  const laneDirectory = resolve(input.evidence, "lane-results", input.taskId);
  const proofPath = resolve(laneDirectory, "ci-proof-packet.json");
  const reviewDirectory = resolve(laneDirectory, "review-lenses", headSha);
  const excludedPromotionPaths = new Set([
    "ci-proof-packet.json",
    ...REVIEW_LENS_NAMES.map((lens) => `review-lenses/${headSha}/${lens}.json`),
  ]);
  const currentProofSha256 = fileSha256(proofPath);
  const currentPromotionCoreSha256 = digestPromotionCore(
    laneDirectory,
    excludedPromotionPaths,
  );
  const priorResult = completed?.result ?? lease?.priorResult;
  let preProofSha256 = currentProofSha256;
  let expectedProofSha256: string;
  let expectedProofContents: string | undefined;
  if (priorResult) {
    if (
      !sameRecord(priorResult.artifactSha256, collected.artifactSha256) ||
      !sameRecord(priorResult.commits, collected.commits) ||
      !sameRecord(priorResult.reviewerRunIds, collected.reviewerRunIds) ||
      priorResult.promotionCoreSha256 !== currentPromotionCoreSha256 ||
      typeof priorResult.preProofSha256 !== "string" ||
      typeof priorResult.expectedProofSha256 !== "string" ||
      (currentProofSha256 !== priorResult.preProofSha256 &&
        currentProofSha256 !== priorResult.expectedProofSha256)
    )
      throw new Error("review promotion replay state mismatch");
    preProofSha256 = priorResult.preProofSha256;
    expectedProofSha256 = priorResult.expectedProofSha256;
    for (const lens of REVIEW_LENS_NAMES) {
      const artifactPath = resolve(reviewDirectory, `${lens}.json`);
      if (
        existsSync(artifactPath) &&
        fileSha256(artifactPath) !== collected.artifactSha256[lens]
      )
        throw new Error(`review promotion replay artifact mismatch: ${lens}`);
    }
    if (currentProofSha256 === preProofSha256) {
      expectedProofContents = jsonContent(
        withAggregatedReview(
          record(readJson(proofPath), `${input.taskId}: proof`),
          collected.aggregate,
          { treeSha: gitIdentity(input.workdir, "HEAD^{tree}") },
        ),
      );
      if (
        createHash("sha256").update(expectedProofContents).digest("hex") !==
        expectedProofSha256
      )
        throw new Error("review promotion expected proof mismatch");
    }
  } else {
    verifyReviewWorktree({
      evidence: input.evidence,
      proofPath,
      taskId: input.taskId,
      workdir: input.workdir,
    });
    expectedProofContents = jsonContent(
      withAggregatedReview(
        record(readJson(proofPath), `${input.taskId}: proof`),
        collected.aggregate,
        { treeSha: gitIdentity(input.workdir, "HEAD^{tree}") },
      ),
    );
    expectedProofSha256 = createHash("sha256")
      .update(expectedProofContents)
      .digest("hex");
  }
  if (completed) {
    if (
      currentProofSha256 !== expectedProofSha256 ||
      REVIEW_LENS_NAMES.some(
        (lens) => !existsSync(resolve(reviewDirectory, `${lens}.json`)),
      )
    )
      throw new Error("completed review promotion replay state mismatch");
    return collected.aggregate;
  }
  if (!lease) throw new Error("review aggregation lease is missing");
  bindReviewAggregationResult(coordinates, lease.token, {
    artifactSha256: collected.artifactSha256,
    commits: collected.commits,
    expectedProofSha256,
    outcome: "promoting",
    preProofSha256,
    promotionCoreSha256: currentPromotionCoreSha256,
    reviewerRunIds: collected.reviewerRunIds,
  });
  const crashAfterArtifacts = Number(
    process.env.BRAIN_REVIEW_TEST_CRASH_AFTER_ARTIFACTS ?? 0,
  );
  let promotedArtifacts = 0;
  for (const lens of REVIEW_LENS_NAMES) {
    atomicWrite(
      resolve(reviewDirectory, `${lens}.json`),
      collected.artifactContents[lens],
    );
    promotedArtifacts += 1;
    if (
      crashAfterArtifacts === promotedArtifacts &&
      promotedArtifacts < REVIEW_LENS_NAMES.length
    )
      throw new Error(
        `injected review promotion crash after ${promotedArtifacts} artifacts`,
      );
  }
  const pauseAfterArtifacts =
    process.env.BRAIN_REVIEW_TEST_PAUSE_AFTER_ARTIFACTS;
  if (pauseAfterArtifacts) {
    atomicWrite(`${pauseAfterArtifacts}.ready`, "ready\n");
    while (!existsSync(`${pauseAfterArtifacts}.release`))
      await new Promise((resolvePause) => setTimeout(resolvePause, 20));
  }
  if (crashAfterArtifacts === REVIEW_LENS_NAMES.length)
    throw new Error(
      `injected review promotion crash after ${promotedArtifacts} artifacts`,
    );
  if (fileSha256(proofPath) === preProofSha256) {
    if (!expectedProofContents)
      throw new Error("review promotion expected proof is unavailable");
    atomicWrite(proofPath, expectedProofContents);
  }
  if (fileSha256(proofPath) !== expectedProofSha256)
    throw new Error("review promotion proof replay mismatch");
  const aggregate = collected.aggregate;
  bindReviewAggregationResult(coordinates, lease.token, {
    artifactSha256: collected.artifactSha256,
    commits: collected.commits,
    expectedProofSha256,
    outcome: "promoted",
    preProofSha256,
    promotionCoreSha256: currentPromotionCoreSha256,
    proofSha256: fileSha256(proofPath),
    reviewerRunIds: collected.reviewerRunIds,
    reviewVerdict: aggregate.reviewVerdict,
  });
  releaseReviewWorktreeGuard({
    taskId: input.taskId,
    workdir: input.workdir,
  });
  cleanupReviewWorktrees(coordinates);
  if (process.env.BRAIN_REVIEW_TEST_CRASH_AFTER_CLEANUP === "1")
    throw new Error("injected review promotion crash after cleanup");
  await releaseReviewAggregationSocketLease(lease.token);
  return aggregate;
};

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
    priorFindings: priorFindingsFor({
      proof,
      reproofRequest: input.reproofRequest,
      taskId: input.taskId,
    }),
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

const runCli = async (): Promise<void> => {
  const taskId = valueAfter("--task");
  const attempt = valueAfter("--attempt");
  const workdir = valueAfter("--workdir");
  const reviewRepo = valueAfter("--review-repo");
  const evidence = valueAfter("--evidence");
  const reproofRequest = valueAfter("--reproof-request");
  if (!taskId || !attempt || !workdir || !reviewRepo || !evidence) {
    console.error(
      "usage: review-aggregate --task <id> --attempt <id> --workdir <absolute-dir> --review-repo <absolute-dir> --evidence <absolute-dir>",
    );
    process.exitCode = 2;
    return;
  }
  const aggregate = await aggregateParallelReviewBranches({
    attempt,
    taskId,
    workdir,
    reviewRepo,
    evidence,
    reproofRequest,
  });
  console.log(JSON.stringify(aggregate));
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await runCli();
}
