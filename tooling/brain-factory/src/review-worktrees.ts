import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";

import {
  acquireReviewAggregationSocketLease,
  releaseReviewAggregationSocketLease,
} from "./review-aggregation-lease.js";

export const REVIEW_WORKTREE_LENSES = [
  "contract",
  "safety",
  "quality",
] as const;

export type ReviewWorktreeLens = (typeof REVIEW_WORKTREE_LENSES)[number];

export interface ReviewWorktreeCoordinates {
  readonly workdir: string;
  readonly evidence: string;
  readonly taskId: string;
  readonly headSha: string;
  readonly attemptId: string;
}

export interface ReviewWorktreeMetadata {
  readonly status: "prepared";
  readonly attemptId: string;
  readonly requestedAttemptId: string;
  readonly taskId: string;
  readonly headSha: string;
  readonly treeSha: string;
  readonly planSha256: string;
  readonly taskBlockHash: string;
  readonly proofSha256: string;
  readonly evidenceSha256: string;
  readonly workdir: string;
  readonly root: string;
}

export interface PreparedReviewWorktrees {
  readonly root: string;
  readonly attemptId: string;
  readonly namespaceRef: string;
  readonly receiptRef: string;
  readonly metadata: ReviewWorktreeMetadata;
  readonly paths: Readonly<Record<ReviewWorktreeLens, string>>;
  readonly branches: Readonly<Record<ReviewWorktreeLens, string>>;
}

export interface ReviewAggregationLease {
  readonly prepared: PreparedReviewWorktrees;
  readonly priorResult?: Readonly<Record<string, unknown>>;
  readonly resuming: boolean;
  readonly token: string;
}

export interface CompletedReviewAggregation {
  readonly prepared: PreparedReviewWorktrees;
  readonly result: Readonly<Record<string, unknown>>;
}

const git = (workdir: string, ...args: readonly string[]): string =>
  execFileSync("rtk", ["proxy", "git", ...args], {
    cwd: workdir,
    encoding: "utf8",
  }).trim();

const validateLens = (lens: string): ReviewWorktreeLens => {
  if (!REVIEW_WORKTREE_LENSES.includes(lens as ReviewWorktreeLens))
    throw new Error(`invalid review lens: ${lens}`);
  return lens as ReviewWorktreeLens;
};

const validateCoordinates = (
  input: ReviewWorktreeCoordinates,
): ReviewWorktreeCoordinates & { readonly realWorkdir: string } => {
  if (!/^S\d{2}-T\d{2}$/.test(input.taskId))
    throw new Error(`invalid review task: ${input.taskId}`);
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(input.headSha))
    throw new Error(`invalid review head: ${input.headSha}`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(input.attemptId))
    throw new Error(`invalid review attempt: ${input.attemptId}`);
  if (!isAbsolute(input.workdir))
    throw new Error("product workdir must be absolute");
  const resolved = resolve(input.workdir);
  const realWorkdir = realpathSync(resolved);
  if (lstatSync(resolved).isSymbolicLink())
    throw new Error("product workdir must not contain symlinks");
  if (!lstatSync(realWorkdir).isDirectory())
    throw new Error("product workdir must be a directory");
  if (!isAbsolute(input.evidence))
    throw new Error("review evidence must be absolute");
  const resolvedEvidence = resolve(input.evidence);
  if (lstatSync(resolvedEvidence).isSymbolicLink())
    throw new Error("review evidence must not contain symlinks");
  return {
    ...input,
    workdir: resolved,
    evidence: realpathSync(resolvedEvidence),
    realWorkdir,
  };
};

const managedBase = (): string =>
  resolve(realpathSync(tmpdir()), "maestro-brain-review-worktrees");

const derivedRoot = (
  input: ReviewWorktreeCoordinates & { readonly realWorkdir: string },
): string => {
  const workdirHash = createHash("sha256")
    .update(input.realWorkdir)
    .digest("hex");
  return resolve(
    managedBase(),
    workdirHash,
    input.taskId,
    input.headSha,
    input.attemptId,
  );
};

const digestFile = (path: string): string =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

const digestDirectory = (root: string): string => {
  const hash = createHash("sha256");
  const visit = (directory: string, relativeDirectory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const path = resolve(directory, name);
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${name}`
        : name;
      const stat = lstatSync(path);
      if (stat.isSymbolicLink())
        throw new Error("task evidence must not contain symlinks");
      if (stat.isDirectory()) visit(path, relativePath);
      else if (stat.isFile()) {
        hash.update(`file\0${relativePath}\0`);
        hash.update(readFileSync(path));
      } else throw new Error("task evidence must contain only regular files");
    }
  };
  visit(root, "");
  return hash.digest("hex");
};

const jsonRecord = (path: string): Record<string, unknown> => {
  const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("review proof must be a JSON object");
  return value as Record<string, unknown>;
};

const assertContained = (root: string, candidate: string): void => {
  const fromRoot = relative(root, candidate);
  if (
    fromRoot === "" ||
    fromRoot.startsWith(`..${sep}`) ||
    fromRoot === ".." ||
    isAbsolute(fromRoot)
  )
    throw new Error("managed review path escapes its deterministic root");
};

const assertNoManagedSymlinks = (candidate: string): void => {
  const base = managedBase();
  const fromBase = relative(base, candidate);
  if (
    fromBase === ".." ||
    fromBase.startsWith(`..${sep}`) ||
    isAbsolute(fromBase)
  )
    throw new Error("managed review path escapes its managed base");
  let current = base;
  for (const part of fromBase.split(sep).filter(Boolean)) {
    current = resolve(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink())
      throw new Error("managed review path must not contain symlinks");
  }
};

const layout = (
  input: ReviewWorktreeCoordinates,
  requestedAttemptId = input.attemptId,
): PreparedReviewWorktrees & {
  readonly workdir: string;
  readonly namespaceRef: string;
  readonly receiptRef: string;
} => {
  const coordinates = validateCoordinates(input);
  const root = derivedRoot(coordinates);
  assertNoManagedSymlinks(root);
  const paths = {} as Record<ReviewWorktreeLens, string>;
  const branches = {} as Record<ReviewWorktreeLens, string>;
  for (const lens of REVIEW_WORKTREE_LENSES) {
    const path = resolve(root, lens);
    assertContained(root, path);
    assertNoManagedSymlinks(path);
    paths[lens] = path;
    branches[lens] =
      `maestro/review/${input.taskId}/${input.headSha}/${input.attemptId}/${lens}`;
  }
  const proofPath = resolve(
    coordinates.evidence,
    "lane-results",
    input.taskId,
    "ci-proof-packet.json",
  );
  const lane = resolve(proofPath, "..");
  const fromEvidence = relative(coordinates.evidence, lane);
  if (fromEvidence.startsWith(`..${sep}`) || isAbsolute(fromEvidence))
    throw new Error("task evidence escapes its evidence root");
  assertNoManagedSymlinks(root);
  const proof = jsonRecord(proofPath);
  for (const [field, expected] of [
    ["taskId", input.taskId],
    ["headSha", input.headSha],
  ] as const) {
    if (proof[field] !== expected)
      throw new Error(`review proof ${field} mismatch`);
  }
  const planSha256 = proof.planSha256;
  const taskBlockHash = proof.taskBlockHash;
  if (typeof planSha256 !== "string" || planSha256.length === 0)
    throw new Error("review proof planSha256 missing");
  if (typeof taskBlockHash !== "string" || taskBlockHash.length === 0)
    throw new Error("review proof taskBlockHash missing");
  const treeSha = git(
    coordinates.realWorkdir,
    "rev-parse",
    `${input.headSha}^{tree}`,
  );
  const metadata: ReviewWorktreeMetadata = {
    status: "prepared",
    attemptId: input.attemptId,
    requestedAttemptId,
    taskId: input.taskId,
    headSha: input.headSha,
    treeSha,
    planSha256,
    taskBlockHash,
    proofSha256: digestFile(proofPath),
    evidenceSha256: digestDirectory(lane),
    workdir: coordinates.realWorkdir,
    root,
  };
  const workdirHash = createHash("sha256")
    .update(coordinates.realWorkdir)
    .digest("hex");
  const namespaceBase = `refs/maestro-brain/review-worktrees/${workdirHash}/${input.taskId}/${input.headSha}`;
  const namespaceRef = `${namespaceBase}/active`;
  const receiptRef = `${namespaceBase}/attempts/${input.attemptId}`;
  return {
    root,
    paths,
    branches,
    workdir: coordinates.realWorkdir,
    attemptId: input.attemptId,
    namespaceRef,
    receiptRef,
    metadata,
  };
};

const branchExists = (workdir: string, branch: string): boolean =>
  spawnSync(
    "rtk",
    ["proxy", "git", "show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
    { cwd: workdir },
  ).status === 0;

const gitWithInput = (
  workdir: string,
  args: readonly string[],
  input: string,
): string =>
  execFileSync("rtk", ["proxy", "git", ...args], {
    cwd: workdir,
    encoding: "utf8",
    input,
  }).trim();

const writeMetadataBlob = (workdir: string, value: unknown): string =>
  gitWithInput(
    workdir,
    ["hash-object", "-w", "--stdin"],
    `${JSON.stringify(value)}\n`,
  );

const readNamespace = (
  workdir: string,
  ref: string,
):
  | { readonly object: string; readonly value: Record<string, unknown> }
  | undefined => {
  const found = spawnSync(
    "rtk",
    ["proxy", "git", "rev-parse", "--verify", ref],
    {
      cwd: workdir,
      encoding: "utf8",
    },
  );
  if (found.status !== 0) return undefined;
  const object = found.stdout.trim();
  return {
    object,
    value: JSON.parse(git(workdir, "cat-file", "blob", object)) as Record<
      string,
      unknown
    >,
  };
};

const requireNamespace = (
  workdir: string,
  ref: string,
): NonNullable<ReturnType<typeof readNamespace>> => {
  const namespace = readNamespace(workdir, ref);
  if (!namespace) throw new Error(`managed review ref is missing: ${ref}`);
  return namespace;
};

const attemptReceiptVisits = (
  workdir: string,
  receiptRef: string,
  requestedAttemptId: string,
): readonly {
  readonly ref: string;
  readonly visit: number;
  readonly receipt: {
    readonly object: string;
    readonly value: Record<string, unknown>;
  };
}[] => {
  const attemptsParent = receiptRef.slice(0, receiptRef.lastIndexOf("/"));
  const escapeRegExp = (value: string): string =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const attemptPattern = new RegExp(
    `^${escapeRegExp(requestedAttemptId)}-v([1-9][0-9]*)$`,
  );
  return git(
    workdir,
    "for-each-ref",
    "--format=%(refname)",
    `${attemptsParent}/`,
  )
    .split("\n")
    .filter(Boolean)
    .flatMap((ref) => {
      const receipt = requireNamespace(workdir, ref);
      if (receipt.value.requestedAttemptId !== requestedAttemptId) return [];
      const effectiveAttempt = receipt.value.attemptId;
      if (
        typeof effectiveAttempt !== "string" ||
        ref !== `${attemptsParent}/${effectiveAttempt}`
      )
        throw new Error(`invalid review visit ref: ${ref}`);
      const match = attemptPattern.exec(effectiveAttempt);
      if (!match) throw new Error(`invalid review visit ref: ${ref}`);
      const visit = Number(match[1]);
      if (!Number.isSafeInteger(visit))
        throw new Error(`unsafe review visit ref: ${ref}`);
      return [{ ref, visit, receipt }];
    });
};

const assertReviewReceiptMetadata = (
  value: Record<string, unknown>,
  expectedBase: ReviewWorktreeMetadata,
  expectedAttemptId: string,
  expectedRoot: string,
): void => {
  const baseKeys = [
    "status",
    "attemptId",
    "requestedAttemptId",
    "taskId",
    "headSha",
    "treeSha",
    "planSha256",
    "taskBlockHash",
    "proofSha256",
    "evidenceSha256",
    "workdir",
    "root",
  ] as const;
  const fail = (): never => {
    throw new Error("invalid managed review attempt receipt");
  };
  const hasExactKeys = (extras: readonly string[]): boolean => {
    const expected = new Set<string>([...baseKeys, ...extras]);
    return (
      Object.keys(value).length === expected.size &&
      Object.keys(value).every((key) => expected.has(key))
    );
  };
  const lensRecord = (
    candidate: unknown,
    pattern: RegExp,
  ): candidate is Record<ReviewWorktreeLens, string> => {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate)
    )
      return false;
    const record = candidate as Record<string, unknown>;
    return (
      Object.keys(record).length === REVIEW_WORKTREE_LENSES.length &&
      REVIEW_WORKTREE_LENSES.every(
        (lens) =>
          typeof record[lens] === "string" && pattern.test(record[lens]),
      )
    );
  };
  const resultIs = (outcome: "promoting" | "promoted"): boolean => {
    const candidate = value.result;
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate)
    )
      return false;
    const result = candidate as Record<string, unknown>;
    const expectedKeys = new Set([
      "artifactSha256",
      "commits",
      "expectedProofSha256",
      "outcome",
      "preProofSha256",
      "promotionCoreSha256",
      "reviewerRunIds",
      ...(outcome === "promoted" ? ["proofSha256", "reviewVerdict"] : []),
    ]);
    return (
      Object.keys(result).length === expectedKeys.size &&
      Object.keys(result).every((key) => expectedKeys.has(key)) &&
      result.outcome === outcome &&
      lensRecord(result.artifactSha256, /^[0-9a-f]{64}$/) &&
      lensRecord(result.commits, /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/) &&
      lensRecord(result.reviewerRunIds, /^\S+$/) &&
      typeof result.preProofSha256 === "string" &&
      /^[0-9a-f]{64}$/.test(result.preProofSha256) &&
      typeof result.promotionCoreSha256 === "string" &&
      /^[0-9a-f]{64}$/.test(result.promotionCoreSha256) &&
      typeof result.expectedProofSha256 === "string" &&
      /^[0-9a-f]{64}$/.test(result.expectedProofSha256) &&
      (outcome === "promoting" ||
        (typeof result.proofSha256 === "string" &&
          /^[0-9a-f]{64}$/.test(result.proofSha256) &&
          result.proofSha256 === result.expectedProofSha256 &&
          (result.reviewVerdict === "pass" ||
            result.reviewVerdict === "rework")))
    );
  };
  const abortedResultIsValid = (): boolean => {
    const candidate = value.result;
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate)
    )
      return false;
    const result = candidate as Record<string, unknown>;
    return (
      Object.keys(result).length === 2 &&
      result.outcome === "aborted" &&
      (result.reason === "operator-cleanup" ||
        result.reason === "invalid-checkpoint")
    );
  };
  if (
    value.attemptId !== expectedAttemptId ||
    value.requestedAttemptId !== expectedBase.requestedAttemptId ||
    value.taskId !== expectedBase.taskId ||
    value.headSha !== expectedBase.headSha ||
    value.treeSha !== expectedBase.treeSha ||
    value.planSha256 !== expectedBase.planSha256 ||
    value.taskBlockHash !== expectedBase.taskBlockHash ||
    typeof value.proofSha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.proofSha256) ||
    value.workdir !== expectedBase.workdir ||
    value.root !== expectedRoot ||
    typeof value.evidenceSha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.evidenceSha256)
  )
    fail();
  if (value.status === "prepared") {
    if (!hasExactKeys([])) fail();
    return;
  }
  if (
    value.status !== "aggregating" &&
    value.status !== "resuming" &&
    value.status !== "cleaned"
  )
    fail();
  const cleaned = value.status === "cleaned";
  if (
    cleaned &&
    value.phase === undefined &&
    hasExactKeys(["preparedObject", "result"]) &&
    typeof value.preparedObject === "string" &&
    /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value.preparedObject) &&
    abortedResultIsValid()
  )
    return;
  if (cleaned && value.phase !== "promoted") fail();
  const lifecycleKeys = [
    "leaseAuthority",
    "leaseToken",
    "phase",
    ...(value.phase === "admitting" ? [] : ["result"]),
    ...(cleaned ? ["preparedObject"] : []),
  ];
  if (
    !hasExactKeys(lifecycleKeys) ||
    typeof value.leaseToken !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value.leaseToken,
    ) ||
    typeof value.leaseAuthority !== "string" ||
    !/^127\.0\.0\.1:(?:[1-9][0-9]{0,4})$/.test(value.leaseAuthority) ||
    Number(value.leaseAuthority.slice("127.0.0.1:".length)) > 65_535 ||
    (cleaned &&
      (typeof value.preparedObject !== "string" ||
        !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value.preparedObject))) ||
    (value.phase !== "admitting" &&
      value.phase !== "promoting" &&
      value.phase !== "promoted") ||
    (value.phase === "promoting" && !resultIs("promoting")) ||
    (value.phase === "promoted" && !resultIs("promoted"))
  )
    fail();
};

const resolveActivePrepared = (
  input: ReviewWorktreeCoordinates,
  allowCleaned = false,
): ReturnType<typeof layout> => {
  const requested = layout(input);
  let active = readNamespace(requested.workdir, requested.namespaceRef);
  if (!active && allowCleaned) {
    const receipts = [
      ...attemptReceiptVisits(
        requested.workdir,
        requested.receiptRef,
        input.attemptId,
      ),
    ].sort((left, right) => right.visit - left.visit);
    if (receipts[0]) active = readNamespace(requested.workdir, receipts[0].ref);
  }
  if (!active) throw new Error("managed review namespace is not prepared");
  const attemptId = active.value.attemptId;
  if (
    typeof attemptId !== "string" ||
    active.value.requestedAttemptId !== input.attemptId
  )
    throw new Error("managed review attempt coordinate mismatch");
  const prepared = layout({ ...input, attemptId }, input.attemptId);
  assertReviewReceiptMetadata(
    active.value,
    prepared.metadata,
    attemptId,
    prepared.root,
  );
  return prepared;
};

const assertClean = (workdir: string, context: string): void => {
  const status = git(
    workdir,
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  );
  if (status !== "") throw new Error(`${context} is not clean:\n${status}`);
};

export const reviewWorktreeRoot = (input: ReviewWorktreeCoordinates): string =>
  layout(input).root;

export const reviewWorktreePath = (
  input: ReviewWorktreeCoordinates & { readonly lens: ReviewWorktreeLens },
): string => {
  const lens = validateLens(input.lens);
  const prepared = resolveActivePrepared(input);
  const path = prepared.paths[lens];
  if (!existsSync(path))
    throw new Error(`review worktree is not prepared: ${lens}`);
  assertNoManagedSymlinks(path);
  if (realpathSync(path) !== path)
    throw new Error("managed review path must not contain symlinks");
  return path;
};

export const readCompletedReviewAggregation = (
  input: ReviewWorktreeCoordinates,
): CompletedReviewAggregation | undefined => {
  const requested = layout(input);
  if (readNamespace(requested.workdir, requested.namespaceRef))
    return undefined;
  let prepared: ReturnType<typeof layout>;
  try {
    prepared = resolveActivePrepared(input, true);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "managed review namespace is not prepared"
    )
      return undefined;
    throw error;
  }
  const receipt = readNamespace(prepared.workdir, prepared.receiptRef);
  if (!receipt) return undefined;
  if (
    receipt.value.status !== "cleaned" ||
    receipt.value.phase !== "promoted" ||
    typeof receipt.value.result !== "object" ||
    receipt.value.result === null ||
    Array.isArray(receipt.value.result)
  )
    return undefined;
  return {
    prepared,
    result: receipt.value.result as Record<string, unknown>,
  };
};

export const prepareReviewWorktrees = (
  input: ReviewWorktreeCoordinates,
): PreparedReviewWorktrees => {
  const requested = layout(input);
  if (readNamespace(requested.workdir, requested.namespaceRef))
    throw new Error("review namespace is already claimed");
  const priorReceipts = attemptReceiptVisits(
    requested.workdir,
    requested.receiptRef,
    input.attemptId,
  );
  const nonTerminal = priorReceipts.flatMap(({ ref, visit, receipt }) => {
    const effectiveAttempt = `${input.attemptId}-v${visit}`;
    assertReviewReceiptMetadata(
      receipt.value,
      requested.metadata,
      effectiveAttempt,
      resolve(requested.root, "..", effectiveAttempt),
    );
    if (receipt.value.status === "cleaned") return [];
    if (
      receipt.value.status !== "prepared" &&
      receipt.value.status !== "aggregating" &&
      receipt.value.status !== "resuming"
    )
      throw new Error("invalid managed review attempt receipt");
    return [{ ref, visit, receipt }];
  });
  if (nonTerminal.length > 1)
    throw new Error("multiple non-terminal review attempt receipts");
  if (nonTerminal[0]) {
    try {
      git(
        requested.workdir,
        "update-ref",
        requested.namespaceRef,
        nonTerminal[0].receipt.object,
        "0000000000000000000000000000000000000000",
      );
    } catch {
      // A concurrent prepare or recovery claimed the active namespace first.
    }
    throw new Error("review namespace is already claimed");
  }
  const highestVisit = Math.max(0, ...priorReceipts.map(({ visit }) => visit));
  if (highestVisit === Number.MAX_SAFE_INTEGER)
    throw new Error("review visit space is exhausted");
  const effectiveAttempt = `${input.attemptId}-v${highestVisit + 1}`;
  const prepared = layout(
    { ...input, attemptId: effectiveAttempt },
    input.attemptId,
  );
  assertClean(prepared.workdir, "product worktree");
  const actualHead = git(prepared.workdir, "rev-parse", "HEAD");
  if (actualHead !== input.headSha)
    throw new Error(
      `product HEAD mismatch: expected ${input.headSha}, received ${actualHead}`,
    );
  if (readNamespace(prepared.workdir, prepared.namespaceRef))
    throw new Error("review namespace is already claimed");
  if (readNamespace(prepared.workdir, prepared.receiptRef))
    throw new Error("review attempt receipt already exists");
  if (existsSync(prepared.root))
    throw new Error(`stale review worktree root: ${prepared.root}`);
  for (const lens of REVIEW_WORKTREE_LENSES) {
    if (branchExists(prepared.workdir, prepared.branches[lens]))
      throw new Error(`stale review branch: ${prepared.branches[lens]}`);
  }

  const metadataObject = writeMetadataBlob(prepared.workdir, prepared.metadata);
  try {
    gitWithInput(
      prepared.workdir,
      ["update-ref", "--stdin"],
      [
        "start",
        `update ${prepared.namespaceRef} ${metadataObject} 0000000000000000000000000000000000000000`,
        `update ${prepared.receiptRef} ${metadataObject} 0000000000000000000000000000000000000000`,
        "prepare",
        "commit",
        "",
      ].join("\n"),
    );
  } catch {
    throw new Error("review namespace is already claimed");
  }
  mkdirSync(prepared.root, { recursive: true });
  const created: ReviewWorktreeLens[] = [];
  try {
    for (const lens of REVIEW_WORKTREE_LENSES) {
      git(
        prepared.workdir,
        "worktree",
        "add",
        "-q",
        "-b",
        prepared.branches[lens],
        prepared.paths[lens],
        input.headSha,
      );
      created.push(lens);
    }
  } catch (error) {
    for (const lens of created.reverse()) {
      spawnSync(
        "rtk",
        ["proxy", "git", "worktree", "remove", "--force", prepared.paths[lens]],
        { cwd: prepared.workdir },
      );
      spawnSync(
        "rtk",
        ["proxy", "git", "branch", "-D", prepared.branches[lens]],
        { cwd: prepared.workdir },
      );
    }
    rmSync(prepared.root, { recursive: true, force: true });
    gitWithInput(
      prepared.workdir,
      ["update-ref", "--stdin"],
      [
        "start",
        `delete ${prepared.namespaceRef} ${metadataObject}`,
        `delete ${prepared.receiptRef} ${metadataObject}`,
        "prepare",
        "commit",
        "",
      ].join("\n"),
    );
    throw error;
  }
  return prepared;
};

const sameJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

export const assertPreparedReviewWorktrees = (
  input: ReviewWorktreeCoordinates,
): PreparedReviewWorktrees => {
  const prepared = resolveActivePrepared(input);
  assertClean(prepared.workdir, "product worktree");
  if (git(prepared.workdir, "rev-parse", "HEAD") !== input.headSha)
    throw new Error("product HEAD changed after review preparation");
  const active = readNamespace(prepared.workdir, prepared.namespaceRef);
  const receipt = readNamespace(prepared.workdir, prepared.receiptRef);
  if (!active || !receipt)
    throw new Error("managed review namespace is not prepared");
  if (
    active.object !== receipt.object ||
    !sameJson(active.value, prepared.metadata) ||
    !sameJson(receipt.value, prepared.metadata)
  )
    throw new Error("managed review namespace metadata mismatch");
  for (const lens of REVIEW_WORKTREE_LENSES) {
    const path = prepared.paths[lens];
    assertNoManagedSymlinks(path);
    if (!existsSync(path) || realpathSync(path) !== path)
      throw new Error(`${lens}: managed review worktree is missing`);
    if (git(path, "branch", "--show-current") !== prepared.branches[lens])
      throw new Error(`${lens}: managed review branch identity mismatch`);
    assertClean(path, `${lens} review worktree`);
  }
  return prepared;
};

export const beginReviewAggregation = async (
  input: ReviewWorktreeCoordinates,
): Promise<ReviewAggregationLease> => {
  const prepared = resolveActivePrepared(input);
  const active = requireNamespace(prepared.workdir, prepared.namespaceRef);
  const receipt = requireNamespace(prepared.workdir, prepared.receiptRef);
  if (active.object !== receipt.object)
    throw new Error("managed review attempt receipt mismatch");
  if (
    active.value.status !== "prepared" &&
    active.value.status !== "aggregating" &&
    active.value.status !== "resuming"
  )
    throw new Error("managed review namespace metadata mismatch");
  if (
    active.value.status === "prepared" &&
    !sameJson(active.value, prepared.metadata)
  )
    throw new Error("managed review namespace metadata mismatch");
  let socketLease: Awaited<
    ReturnType<typeof acquireReviewAggregationSocketLease>
  >;
  try {
    socketLease = await acquireReviewAggregationSocketLease(
      prepared.root,
      active.value.status === "prepared"
        ? undefined
        : String(active.value.leaseAuthority),
    );
  } catch {
    throw new Error("review aggregation is already aggregating");
  }
  const latestActive = readNamespace(prepared.workdir, prepared.namespaceRef);
  const latestReceipt = readNamespace(prepared.workdir, prepared.receiptRef);
  if (
    !latestActive ||
    !latestReceipt ||
    latestActive.object !== active.object ||
    latestReceipt.object !== receipt.object ||
    latestActive.object !== latestReceipt.object
  ) {
    await releaseReviewAggregationSocketLease(socketLease.token);
    throw new Error("review aggregation is already aggregating");
  }
  const resuming = active.value.status !== "prepared";
  const leaseValue = {
    ...active.value,
    leaseAuthority: socketLease.authority,
    leaseToken: socketLease.token,
    phase: resuming ? active.value.phase : "admitting",
    status: resuming ? "resuming" : "aggregating",
  };
  assertReviewReceiptMetadata(
    leaseValue,
    prepared.metadata,
    prepared.attemptId,
    prepared.root,
  );
  const leaseObject = writeMetadataBlob(prepared.workdir, leaseValue);
  try {
    gitWithInput(
      prepared.workdir,
      ["update-ref", "--stdin"],
      [
        "start",
        `update ${prepared.namespaceRef} ${leaseObject} ${active.object}`,
        `update ${prepared.receiptRef} ${leaseObject} ${receipt.object}`,
        "prepare",
        "commit",
        "",
      ].join("\n"),
    );
  } catch {
    await releaseReviewAggregationSocketLease(socketLease.token);
    throw new Error("review aggregation is already aggregating");
  }
  const priorResult =
    resuming &&
    typeof active.value.result === "object" &&
    active.value.result !== null &&
    !Array.isArray(active.value.result)
      ? (active.value.result as Record<string, unknown>)
      : undefined;
  return {
    prepared,
    ...(priorResult === undefined ? {} : { priorResult }),
    resuming,
    token: socketLease.token,
  };
};

export const bindReviewAggregationResult = (
  input: ReviewWorktreeCoordinates,
  token: string,
  result: Record<string, unknown>,
): void => {
  const prepared = resolveActivePrepared(input);
  const active = readNamespace(prepared.workdir, prepared.namespaceRef);
  const receipt = readNamespace(prepared.workdir, prepared.receiptRef);
  if (
    !active ||
    !receipt ||
    active.object !== receipt.object ||
    (active.value.status !== "aggregating" &&
      active.value.status !== "resuming") ||
    active.value.leaseToken !== token
  )
    throw new Error("review aggregation lease is not active");
  const boundValue = {
    ...active.value,
    phase:
      result.outcome === "promoted"
        ? "promoted"
        : result.outcome === "promoting"
          ? "promoting"
          : active.value.phase,
    result,
  };
  assertReviewReceiptMetadata(
    boundValue,
    prepared.metadata,
    prepared.attemptId,
    prepared.root,
  );
  const bound = writeMetadataBlob(prepared.workdir, boundValue);
  gitWithInput(
    prepared.workdir,
    ["update-ref", "--stdin"],
    [
      "start",
      `update ${prepared.namespaceRef} ${bound} ${active.object}`,
      `update ${prepared.receiptRef} ${bound} ${receipt.object}`,
      "prepare",
      "commit",
      "",
    ].join("\n"),
  );
};

interface ReviewCleanupAuthority {
  readonly leaseToken: string;
  readonly prepared: ReturnType<typeof layout>;
  readonly namespace: NonNullable<ReturnType<typeof readNamespace>>;
  readonly receipt: NonNullable<ReturnType<typeof readNamespace>>;
  readonly status: "aggregating" | "resuming";
}

const cleanupReviewWorktreesWithReason = (
  input: ReviewWorktreeCoordinates,
  reason: "invalid-checkpoint" | "operator-cleanup",
  authority?: ReviewCleanupAuthority,
): void => {
  const prepared = authority?.prepared ?? resolveActivePrepared(input, true);
  const currentNamespace = readNamespace(
    prepared.workdir,
    prepared.namespaceRef,
  );
  const currentReceipt = readNamespace(prepared.workdir, prepared.receiptRef);
  if (
    authority &&
    (authority.namespace.value.leaseToken !== authority.leaseToken ||
      authority.namespace.value.status !== authority.status ||
      currentNamespace?.object !== authority.namespace.object ||
      currentReceipt?.object !== authority.receipt.object)
  )
    throw new Error("review aggregation authority changed before retirement");
  const namespace = authority?.namespace ?? currentNamespace;
  const attemptReceipt = authority?.receipt ?? currentReceipt;
  if (!namespace && attemptReceipt?.value.status === "cleaned") return;
  if (!namespace || !attemptReceipt)
    throw new Error("managed review worktrees are not prepared");
  if (
    namespace.value.status !== "prepared" &&
    namespace.value.status !== "aggregating" &&
    namespace.value.status !== "resuming"
  )
    throw new Error("invalid managed review namespace receipt");
  if (
    namespace.object !== attemptReceipt.object ||
    attemptReceipt.value.status !== namespace.value.status
  )
    throw new Error("managed review attempt receipt mismatch");
  if (existsSync(prepared.root)) assertNoManagedSymlinks(prepared.root);
  const entries = existsSync(prepared.root)
    ? readdirSync(prepared.root).sort()
    : [];
  const expected = [...REVIEW_WORKTREE_LENSES].sort();
  if (entries.some((entry) => !expected.includes(entry as ReviewWorktreeLens)))
    throw new Error("managed review root contains an unexpected path");

  for (const lens of REVIEW_WORKTREE_LENSES) {
    const path = prepared.paths[lens];
    if (!existsSync(path)) continue;
    assertNoManagedSymlinks(path);
    if (!existsSync(path) || lstatSync(path).isSymbolicLink())
      throw new Error("managed review path must not contain symlinks");
    if (realpathSync(path) !== path)
      throw new Error("managed review path must not contain symlinks");
    if (git(path, "branch", "--show-current") !== prepared.branches[lens])
      throw new Error(`${lens}: managed review branch identity mismatch`);
    assertClean(path, `${lens} review worktree`);
  }

  for (const lens of REVIEW_WORKTREE_LENSES)
    if (existsSync(prepared.paths[lens]))
      git(prepared.workdir, "worktree", "remove", prepared.paths[lens]);
  if (existsSync(prepared.root))
    rmSync(prepared.root, { recursive: true, force: false });
  const cleanedValue =
    namespace.value.phase === "promoted"
      ? {
          ...namespace.value,
          status: "cleaned",
          preparedObject: namespace.object,
        }
      : {
          status: "cleaned",
          attemptId: namespace.value.attemptId,
          requestedAttemptId: namespace.value.requestedAttemptId,
          taskId: namespace.value.taskId,
          headSha: namespace.value.headSha,
          treeSha: namespace.value.treeSha,
          planSha256: namespace.value.planSha256,
          taskBlockHash: namespace.value.taskBlockHash,
          proofSha256: namespace.value.proofSha256,
          evidenceSha256: namespace.value.evidenceSha256,
          workdir: namespace.value.workdir,
          root: namespace.value.root,
          result: { outcome: "aborted", reason },
          preparedObject: namespace.object,
        };
  assertReviewReceiptMetadata(
    cleanedValue,
    prepared.metadata,
    prepared.attemptId,
    prepared.root,
  );
  const receipt = writeMetadataBlob(prepared.workdir, cleanedValue);
  try {
    gitWithInput(
      prepared.workdir,
      ["update-ref", "--stdin"],
      [
        "start",
        `delete ${prepared.namespaceRef} ${namespace.object}`,
        `update ${prepared.receiptRef} ${receipt} ${attemptReceipt.object}`,
        "prepare",
        "commit",
        "",
      ].join("\n"),
    );
  } catch {
    throw new Error("review namespace cleanup CAS failed");
  }
};

export const cleanupReviewWorktrees = (
  input: ReviewWorktreeCoordinates,
): void => cleanupReviewWorktreesWithReason(input, "operator-cleanup");

export const abortInvalidReviewAggregation = (
  input: ReviewWorktreeCoordinates,
  token: string,
  afterValidation?: () => void,
): void => {
  const prepared = resolveActivePrepared(input);
  const active = readNamespace(prepared.workdir, prepared.namespaceRef);
  const receipt = readNamespace(prepared.workdir, prepared.receiptRef);
  if (
    !active ||
    !receipt ||
    active.object !== receipt.object ||
    (active.value.status !== "aggregating" &&
      active.value.status !== "resuming") ||
    active.value.leaseToken !== token
  )
    throw new Error("review aggregation lease is not active");
  const status = active.value.status;
  afterValidation?.();
  cleanupReviewWorktreesWithReason(input, "invalid-checkpoint", {
    leaseToken: token,
    namespace: active,
    prepared,
    receipt,
    status,
  });
};
