import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

import { validateFinalLaneResult } from "./lane-result.js";
import {
  laneHistoryOwnershipIssues,
  laneHistoryShapeIssues,
} from "./lane-ownership.js";
import { validateProofContract, proofChangedFilesMatch } from "./proof.js";
import {
  changedHandAuthoredSourceLines,
  validSourceSlices,
} from "./source-budget.js";

type JsonRecord = Record<string, unknown>;
type GitRunner = (cwd: string, args: readonly string[]) => string;

export interface AuthorityRefreshTask {
  readonly fileLocks: readonly string[];
  readonly planSha256: string;
  readonly sourceSliceBudget: number;
  readonly sourceSliceLimit: number;
  readonly taskBlockHash: string;
  readonly taskId: string;
}

interface AuthorityRefreshCoordinatesInput {
  readonly controlHeadSha: string;
  readonly planSha256: string;
  readonly root: string;
  readonly taskBlockHash: string;
  readonly taskId: string;
  readonly branchExists?: (branch: string) => boolean;
}

export interface AuthorityRefreshCoordinates {
  readonly authorityId: string;
  readonly branch: string;
  readonly workdir: string;
}

interface PreservedArtifact {
  readonly content: string;
  readonly file: string;
  readonly sha256: string;
}

export interface AuthorityRefreshAdmission {
  readonly archiveDirectory: string;
  readonly artifacts: readonly PreservedArtifact[];
  readonly controlHeadSha: string;
  readonly coordinates: AuthorityRefreshCoordinates;
  readonly oldAuthority: {
    readonly planSha256: string;
    readonly taskBlockHash: string;
  };
  readonly sourceCommits: readonly string[];
  readonly sourceHeadSha: string;
  readonly task: AuthorityRefreshTask;
  readonly taskBaseSha: string;
}

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const exactSha = (value: unknown, length: 40 | 64, label: string): string => {
  if (
    typeof value !== "string" ||
    !new RegExp(`^[0-9a-f]{${length}}$`).test(value)
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
};

const jsonRecord = (content: string, label: string): JsonRecord => {
  const value: unknown = JSON.parse(content);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonRecord;
};

const lines = (value: string): readonly string[] =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const terminalStatuses = new Set([
  "canceled",
  "cancelled",
  "failed",
  "succeeded",
]);

export const assertAuthorityRefreshTerminalStatus = (
  status: string | undefined,
  taskId: string,
): void => {
  if (!status || status === "unknown") {
    throw new Error(`${taskId}: source run status is unknown`);
  }
  if (!terminalStatuses.has(status)) {
    throw new Error(`${taskId}: source run is not terminal (${status})`);
  }
};

export const authorityRefreshCoordinates = (
  input: AuthorityRefreshCoordinatesInput,
): AuthorityRefreshCoordinates => {
  exactSha(input.controlHeadSha, 40, "authority refresh control HEAD");
  exactSha(input.planSha256, 64, "authority refresh plan SHA");
  exactSha(input.taskBlockHash, 64, "authority refresh task block hash");
  const authorityId = sha256(
    [input.controlHeadSha, input.planSha256, input.taskBlockHash].join(":"),
  ).slice(0, 12);
  const slug = input.taskId.toLowerCase();
  const branch = `fabro/review-${slug}-authority-${authorityId}`;
  const workdir = resolve(
    input.root,
    "..",
    ".maestro-brain-fabro-workdirs",
    `resume-${slug}-authority-${authorityId}`,
  );
  if (existsSync(workdir)) {
    throw new Error(
      `${input.taskId}: authority refresh worktree already exists at ${workdir}`,
    );
  }
  if (input.branchExists?.(branch)) {
    throw new Error(
      `${input.taskId}: authority refresh branch ${branch} already exists`,
    );
  }
  return { authorityId, branch, workdir };
};

export const admitAuthorityRefresh = (input: {
  readonly controlHeadSha: string;
  readonly evidence: string;
  readonly root: string;
  readonly runGit: GitRunner;
  readonly sourceBranch: string;
  readonly sourceWorkdir: string;
  readonly task: AuthorityRefreshTask;
  readonly branchExists?: (branch: string) => boolean;
}): AuthorityRefreshAdmission => {
  const taskId = input.task.taskId;
  const laneDirectory = resolve(input.evidence, "lane-results", taskId);
  const paths = {
    gate: resolve(laneDirectory, "lane-gate-report.json"),
    lane: resolve(laneDirectory, "lane-result.json"),
    proof: resolve(laneDirectory, "ci-proof-packet.json"),
  };
  for (const [label, path] of Object.entries(paths)) {
    if (!existsSync(path))
      throw new Error(`${taskId}: ${label} evidence is missing`);
  }
  if (!existsSync(input.sourceWorkdir)) {
    throw new Error(`${taskId}: source worktree is missing`);
  }
  const sourceWorkdir = realpathSync(input.sourceWorkdir);
  const root = realpathSync(input.root);
  const git = (cwd: string, args: readonly string[]): string =>
    input.runGit(cwd, args).trim();
  exactSha(input.controlHeadSha, 40, `${taskId}: controller HEAD`);
  if (git(root, ["rev-parse", "HEAD"]) !== input.controlHeadSha) {
    throw new Error(`${taskId}: controller HEAD mismatch`);
  }
  const controllerStatus = git(root, ["status", "--porcelain=v1"]);
  if (controllerStatus) {
    throw new Error(
      `${taskId}: controller worktree is dirty: ${controllerStatus}`,
    );
  }
  if (
    realpathSync(git(sourceWorkdir, ["rev-parse", "--show-toplevel"])) !==
    sourceWorkdir
  ) {
    throw new Error(`${taskId}: source worktree path mismatch`);
  }
  if (
    realpathSync(
      git(sourceWorkdir, [
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ]),
    ) !==
    realpathSync(
      git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    )
  ) {
    throw new Error(`${taskId}: source worktree common directory mismatch`);
  }
  if (git(sourceWorkdir, ["branch", "--show-current"]) !== input.sourceBranch) {
    throw new Error(`${taskId}: source worktree branch mismatch`);
  }
  const status = git(sourceWorkdir, ["status", "--porcelain=v1"]);
  if (status) throw new Error(`${taskId}: source worktree is dirty: ${status}`);

  const contents = {
    gate: readFileSync(paths.gate, "utf8"),
    lane: readFileSync(paths.lane, "utf8"),
    proof: readFileSync(paths.proof, "utf8"),
  };
  const lane = jsonRecord(contents.lane, `${taskId}: lane result`);
  const proof = jsonRecord(contents.proof, `${taskId}: CI proof`);
  const gate = jsonRecord(contents.gate, `${taskId}: final gate`);
  const sourceHeadSha = exactSha(lane.headSha, 40, `${taskId}: lane head`);
  const sourceTreeSha = exactSha(lane.treeSha, 40, `${taskId}: lane tree`);
  if (git(sourceWorkdir, ["rev-parse", "HEAD"]) !== sourceHeadSha) {
    throw new Error(`${taskId}: source worktree HEAD mismatch`);
  }
  if (git(sourceWorkdir, ["rev-parse", "HEAD^{tree}"]) !== sourceTreeSha) {
    throw new Error(`${taskId}: source worktree tree mismatch`);
  }
  validateFinalLaneResult(lane, {
    currentHeadSha: sourceHeadSha,
    currentTreeSha: sourceTreeSha,
    finalGateReport: gate,
    proof,
    taskId,
  });
  const oldTaskBlockHash = exactSha(
    proof.taskBlockHash,
    64,
    `${taskId}: prior task block hash`,
  );
  const oldPlanSha256 = validateProofContract(proof, {
    taskBlockHash: oldTaskBlockHash,
    taskId,
  });
  exactSha(oldPlanSha256, 64, `${taskId}: prior plan SHA`);
  if (
    oldPlanSha256 === input.task.planSha256 &&
    oldTaskBlockHash === input.task.taskBlockHash
  ) {
    throw new Error(`${taskId}: lane already matches current authority`);
  }
  if (
    oldPlanSha256 === input.task.planSha256 ||
    oldTaskBlockHash === input.task.taskBlockHash
  ) {
    throw new Error(`${taskId}: prior plan and task authority mismatch`);
  }
  const taskBaseSha = exactSha(proof.baseSha, 40, `${taskId}: proof base`);
  try {
    git(sourceWorkdir, [
      "merge-base",
      "--is-ancestor",
      taskBaseSha,
      sourceHeadSha,
    ]);
  } catch {
    throw new Error(`${taskId}: proof base is not an ancestor of lane HEAD`);
  }
  const sourceCommits = lines(
    git(sourceWorkdir, [
      "rev-list",
      "--reverse",
      `${taskBaseSha}..${sourceHeadSha}`,
    ]),
  );
  const histories = sourceCommits.map((commit) => {
    const revision = lines(
      git(sourceWorkdir, ["rev-list", "--parents", "-n", "1", commit]),
    )[0];
    if (!revision)
      throw new Error(`${taskId}: source commit ${commit} drifted`);
    return {
      commit,
      files: lines(
        git(sourceWorkdir, [
          "diff-tree",
          "--root",
          "--no-commit-id",
          "--name-only",
          "-r",
          "--no-renames",
          commit,
        ]),
      ),
      parentCount: Math.max(0, revision.split(/\s+/).length - 1),
      sourceLines: changedHandAuthoredSourceLines(
        git(sourceWorkdir, [
          "show",
          "--no-renames",
          "--numstat",
          "--format=",
          commit,
        ]),
      ),
    };
  });
  const shapeIssues = laneHistoryShapeIssues(histories);
  if (shapeIssues.length > 0)
    throw new Error(`${taskId}: ${shapeIssues.join("; ")}`);
  const ownershipIssues = laneHistoryOwnershipIssues(
    histories,
    input.task.fileLocks,
  );
  if (ownershipIssues.length > 0) {
    throw new Error(
      `${taskId}: ${ownershipIssues
        .join("; ")
        .replaceAll(
          "not declared in manifest fileLocks",
          "not declared in current manifest fileLocks",
        )}`,
    );
  }
  if (
    !validSourceSlices(
      histories.map((history) => history.sourceLines),
      input.task.sourceSliceBudget,
      input.task.sourceSliceLimit,
    )
  ) {
    throw new Error(
      `${taskId}: source slice limit or budget does not admit preserved commits`,
    );
  }
  const actualChangedFiles = lines(
    git(sourceWorkdir, [
      "diff",
      "--name-only",
      "--no-renames",
      `${taskBaseSha}..${sourceHeadSha}`,
    ]),
  );
  if (
    !Array.isArray(proof.changedFiles) ||
    !proof.changedFiles.every((file) => typeof file === "string") ||
    !proofChangedFilesMatch(proof.changedFiles as string[], actualChangedFiles)
  ) {
    throw new Error(`${taskId}: proof changed files mismatch source history`);
  }
  const coordinates = authorityRefreshCoordinates({
    ...(input.branchExists ? { branchExists: input.branchExists } : {}),
    controlHeadSha: input.controlHeadSha,
    planSha256: input.task.planSha256,
    root: input.root,
    taskBlockHash: input.task.taskBlockHash,
    taskId,
  });
  const archiveDirectory = resolve(
    input.evidence,
    "authority-refreshes",
    taskId,
    coordinates.authorityId,
  );
  if (existsSync(archiveDirectory)) {
    throw new Error(
      `${taskId}: authority refresh evidence coordinates already exist`,
    );
  }
  const artifactInputs: readonly (readonly [string, string])[] = [
    ["prior-lane-result.json", contents.lane],
    ["prior-proof.json", contents.proof],
    ["prior-final-gate.json", contents.gate],
  ];
  const artifacts = artifactInputs.map(([file, content]) => ({
    content,
    file,
    sha256: sha256(content),
  }));
  return {
    archiveDirectory,
    artifacts,
    controlHeadSha: input.controlHeadSha,
    coordinates,
    oldAuthority: {
      planSha256: oldPlanSha256,
      taskBlockHash: oldTaskBlockHash,
    },
    sourceCommits,
    sourceHeadSha,
    task: input.task,
    taskBaseSha,
  };
};

export const preserveAuthorityRefreshEvidence = (
  admission: AuthorityRefreshAdmission,
  fileSystem: {
    readonly remove: (path: string) => void;
    readonly rename: (from: string, to: string) => void;
    readonly write: (
      path: string,
      content: string,
      options: { readonly flag: "wx" },
    ) => void;
  } = {
    remove: (path) => rmSync(path, { force: true, recursive: true }),
    rename: renameSync,
    write: writeFileSync,
  },
): void => {
  if (existsSync(admission.archiveDirectory)) {
    throw new Error(
      `${admission.task.taskId}: authority refresh evidence coordinates already exist`,
    );
  }
  const stagingDirectory = `${admission.archiveDirectory}.next`;
  if (existsSync(stagingDirectory)) fileSystem.remove(stagingDirectory);
  mkdirSync(stagingDirectory, { recursive: true });
  const manifest = {
    schemaVersion: "maestro-brain-authority-refresh-archive/v1",
    taskId: admission.task.taskId,
    authorityId: admission.coordinates.authorityId,
    currentAuthority: {
      controlHeadSha: admission.controlHeadSha,
      planSha256: admission.task.planSha256,
      taskBlockHash: admission.task.taskBlockHash,
    },
    oldAuthority: admission.oldAuthority,
    source: {
      baseSha: admission.taskBaseSha,
      commits: admission.sourceCommits,
      headSha: admission.sourceHeadSha,
    },
    artifacts: admission.artifacts.map(({ file, sha256: digest }) => ({
      file,
      sha256: digest,
    })),
  };
  try {
    for (const artifact of admission.artifacts) {
      fileSystem.write(
        resolve(stagingDirectory, artifact.file),
        artifact.content,
        { flag: "wx" },
      );
    }
    fileSystem.write(
      resolve(stagingDirectory, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { flag: "wx" },
    );
    for (const artifact of admission.artifacts) {
      if (
        sha256(
          readFileSync(resolve(stagingDirectory, artifact.file), "utf8"),
        ) !== artifact.sha256
      ) {
        throw new Error(
          `${admission.task.taskId}: staged authority evidence hash mismatch`,
        );
      }
    }
    fileSystem.rename(stagingDirectory, admission.archiveDirectory);
  } catch (error) {
    fileSystem.remove(stagingDirectory);
    throw error;
  }
};
