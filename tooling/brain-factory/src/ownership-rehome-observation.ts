import { createHash } from "node:crypto";

import type { OwnershipRehomeTransition } from "./manifest.js";
import {
  aggregateReviewLenses,
  DEFAULT_REVIEW_RUBRIC_IDS,
  REVIEW_LENS_NAMES,
} from "./review-lens.js";

type JsonRecord = Record<string, unknown>;

export interface OwnershipRehomeObservationInput {
  readonly task: {
    readonly taskId: string;
    readonly fileLocks: readonly string[];
    readonly ownershipRehomeTransition?: OwnershipRehomeTransition;
  };
  readonly runRecordContent: string;
  readonly proofContent: string;
  readonly gateContent: string;
  readonly laneResultContent: string;
  readonly lensContents: Readonly<
    Record<"contract" | "quality" | "safety", string>
  >;
  readonly expectedWorkdir: string;
  readonly integratedTaskIds: readonly string[];
  readonly currentRejection?: OwnershipRehomeCurrentRejection | undefined;
  readonly inspectRun: (runId: string) => {
    readonly status: string;
    readonly reason: string;
  };
  readonly readImmutableRef: (ref: string) => {
    readonly objectSha: string;
    readonly content: string;
  };
  readonly readWorktree: (workdir: string) => {
    readonly headSha: string;
    readonly treeSha: string;
  };
}

export interface OwnershipRehomeCurrentRejection {
  readonly transitionKind: "ownership-rehome";
  readonly taskId: string;
  readonly sourceRunId: string;
  readonly workdir: string;
  readonly sourceHeadSha: string;
  readonly sourceTreeSha: string;
  readonly missingPrerequisiteTaskIds: readonly string[];
  readonly message: string;
}

export interface OwnershipRehomeObservation {
  readonly globallyBlocking: false;
  readonly missingPrerequisiteTaskIds: readonly string[];
  readonly sourceHeadSha: string;
  readonly sourceRunId: string;
  readonly status: "authority_transition_held" | "authority_transition_ready";
  readonly taskId: string;
}

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const record = (value: unknown, label: string): JsonRecord => {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonRecord;
};

const parseRecord = (content: string, label: string): JsonRecord => {
  try {
    return record(JSON.parse(content), label);
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
};

const requireEqual = (
  actual: unknown,
  expected: unknown,
  label: string,
): void => {
  if (actual !== expected) throw new Error(`${label} mismatch`);
};

const findingValue = (content: string, label: string): string => {
  const prefix = `${label}: `;
  const matches = content.split("\n").filter((line) => line.startsWith(prefix));
  if (matches.length !== 1) {
    throw new Error(`immutable finding ${label} is not exact`);
  }
  const [match] = matches;
  if (match === undefined) {
    throw new Error(`immutable finding ${label} is not exact`);
  }
  return match.slice(prefix.length);
};

const requireDigest = (
  content: string,
  expected: string,
  label: string,
): void => requireEqual(sha256(content), expected, `${label} digest`);

const sameStrings = (
  actual: readonly string[],
  expected: readonly string[],
): boolean =>
  actual.length === expected.length &&
  actual.every((value, index) => value === expected[index]);

const rejectionKeys: readonly (keyof OwnershipRehomeCurrentRejection)[] = [
  "transitionKind",
  "taskId",
  "sourceRunId",
  "workdir",
  "sourceHeadSha",
  "sourceTreeSha",
  "missingPrerequisiteTaskIds",
  "message",
];
const rejectionKeySet = new Set<string>(rejectionKeys);

const verifyArtifactBindings = (input: {
  readonly gate: JsonRecord;
  readonly laneResult: JsonRecord;
  readonly proof: JsonRecord;
  readonly taskId: string;
  readonly transition: OwnershipRehomeTransition;
}): void => {
  const { gate, laneResult, proof, taskId, transition } = input;
  for (const [actual, expected, label] of [
    [proof.schemaVersion, "maestro-brain-ci-proof/v1", "CI proof schema"],
    [proof.taskId, taskId, "CI proof task"],
    [proof.planSha256, transition.fromPlanSha256, "CI proof plan"],
    [proof.taskBlockHash, transition.fromTaskBlockHash, "CI proof task block"],
    [proof.baseSha, transition.sourceBaseSha, "CI proof base"],
    [proof.headSha, transition.sourceHeadSha, "CI proof head"],
    [proof.reviewHeadSha, transition.sourceHeadSha, "CI proof review head"],
    [proof.reviewVerdict, "pass", "CI proof review verdict"],
    [gate.schemaVersion, "maestro-brain-lane-gate/v1", "lane gate schema"],
    [gate.taskId, taskId, "lane gate task"],
    [gate.planSha256, transition.fromPlanSha256, "lane gate plan"],
    [gate.taskBlockHash, transition.fromTaskBlockHash, "lane gate task block"],
    [gate.currentHeadSha, transition.sourceHeadSha, "lane gate current head"],
    [gate.currentTreeSha, transition.sourceTreeSha, "lane gate current tree"],
    [gate.headSha, transition.sourceHeadSha, "lane gate head"],
    [gate.stage, "final", "lane gate stage"],
    [gate.status, "passed", "lane gate status"],
    [
      laneResult.schemaVersion,
      "maestro-brain-lane-result/v1",
      "lane result schema",
    ],
    [laneResult.taskId, taskId, "lane result task"],
    [laneResult.headSha, transition.sourceHeadSha, "lane result head"],
    [laneResult.treeSha, transition.sourceTreeSha, "lane result tree"],
    [laneResult.status, "lane_green", "lane result status"],
  ] as const) {
    requireEqual(actual, expected, label);
  }
  if (!Array.isArray(proof.reviewFindings) || proof.reviewFindings.length > 0) {
    throw new Error("CI proof findings mismatch");
  }
  if (!Array.isArray(proof.changedFiles)) {
    throw new Error("CI proof changed files mismatch");
  }
  const changed = new Set(proof.changedFiles);
  for (const mapping of transition.supersededPaths) {
    if (!changed.has(mapping.path) || !changed.has(mapping.replacementPath)) {
      throw new Error("CI proof ownership-rehome paths mismatch");
    }
  }
};

export const loadOwnershipRehomeObservation = (
  input: OwnershipRehomeObservationInput,
): OwnershipRehomeObservation => {
  const transition = input.task.ownershipRehomeTransition;
  if (!transition) throw new Error("ownership-rehome transition is missing");
  requireEqual(
    transition.schemaVersion,
    "maestro-brain-ownership-rehome-transition/v1",
    "ownership-rehome schema",
  );
  requireEqual(
    transition.classification,
    "ownership-rehome",
    "ownership-rehome classification",
  );
  requireEqual(
    transition.immutableFinding.kind,
    "git-blob",
    "immutable finding kind",
  );

  const owned = new Set(input.task.fileLocks);
  for (const mapping of transition.supersededPaths) {
    if (
      owned.has(mapping.path) ||
      !owned.has(mapping.replacementPath) ||
      mapping.disposition !== "replaced-by-current-owned-artifact"
    ) {
      throw new Error("ownership-rehome manifest ownership mismatch");
    }
  }

  const immutable = input.readImmutableRef(transition.immutableFinding.ref);
  requireEqual(
    immutable.objectSha,
    transition.immutableFinding.objectSha,
    "immutable finding object",
  );
  requireDigest(
    immutable.content,
    transition.immutableFinding.contentSha256,
    "immutable finding content",
  );

  const run = parseRecord(input.runRecordContent, "source run record");
  for (const [actual, expected, label] of [
    [run.taskId, input.task.taskId, "source run task"],
    [run.runId, transition.sourceRunId, "source run id"],
    [run.baseSha, transition.sourceBaseSha, "source run base"],
    [run.mode, "authority-refresh", "source run mode"],
    [run.status, "launched", "source run record status"],
  ] as const) {
    requireEqual(actual, expected, label);
  }
  if (typeof run.workdir !== "string" || run.workdir.length === 0) {
    throw new Error("source run worktree mismatch");
  }
  requireEqual(run.workdir, input.expectedWorkdir, "source run worktree");
  const inspection = input.inspectRun(transition.sourceRunId);
  requireEqual(inspection.status, "succeeded", "source run terminal status");
  requireEqual(inspection.reason, "completed", "source run terminal reason");
  const worktree = input.readWorktree(run.workdir);
  requireEqual(
    worktree.headSha,
    transition.sourceHeadSha,
    "source worktree head",
  );
  requireEqual(
    worktree.treeSha,
    transition.sourceTreeSha,
    "source worktree tree",
  );

  const proofDigest = findingValue(immutable.content, "CI proof SHA-256");
  const gateDigest = findingValue(immutable.content, "Final lane-gate SHA-256");
  const laneResultDigest = findingValue(
    immutable.content,
    "Lane-result SHA-256",
  );
  requireDigest(input.proofContent, proofDigest, "immutable finding CI proof");
  requireDigest(input.gateContent, gateDigest, "immutable finding lane gate");
  requireDigest(
    input.laneResultContent,
    laneResultDigest,
    "immutable finding lane result",
  );
  for (const lens of ["contract", "safety", "quality"] as const) {
    const label = `${lens.charAt(0).toUpperCase()}${lens.slice(1)} lens SHA-256`;
    requireDigest(
      input.lensContents[lens],
      findingValue(immutable.content, label),
      `immutable finding ${lens} lens`,
    );
  }

  for (const [actual, expected, label] of [
    [findingValue(immutable.content, "Task"), input.task.taskId, "task"],
    [
      findingValue(immutable.content, "Current proven lane-green head"),
      transition.sourceHeadSha,
      "head",
    ],
    [
      findingValue(immutable.content, "Current proven tree"),
      transition.sourceTreeSha,
      "tree",
    ],
    [
      findingValue(immutable.content, "Source base"),
      transition.sourceBaseSha,
      "base",
    ],
    [
      findingValue(immutable.content, "Source plan SHA-256"),
      transition.fromPlanSha256,
      "plan",
    ],
    [
      findingValue(immutable.content, "Source task-block SHA-256"),
      transition.fromTaskBlockHash,
      "task block",
    ],
  ] as const) {
    requireEqual(actual, expected, `immutable finding ${label}`);
  }
  requireEqual(
    findingValue(immutable.content, "Source run"),
    `${transition.sourceRunId} (terminal status succeeded, reason completed)`,
    "immutable finding source run",
  );
  for (const mapping of transition.supersededPaths) {
    const disposition = `Authorized disposition: remove ${mapping.path} from ${input.task.taskId} ownership and rewrite only that one checker delta away. ${mapping.replacementPath} remains ${input.task.taskId}-owned and is the replacement proof location`;
    if (!immutable.content.includes(disposition)) {
      throw new Error("immutable finding authorized disposition mismatch");
    }
  }

  const proof = parseRecord(input.proofContent, "CI proof");
  const gate = parseRecord(input.gateContent, "lane gate");
  const laneResult = parseRecord(input.laneResultContent, "lane result");
  verifyArtifactBindings({
    gate,
    laneResult,
    proof,
    taskId: input.task.taskId,
    transition,
  });

  const reviewAttempt = findingValue(immutable.content, "Review attempt");
  const reviewerRunIds = Object.fromEntries(
    REVIEW_LENS_NAMES.map((lens) => [
      lens,
      `maestro/review/${input.task.taskId}/${transition.sourceHeadSha}/${reviewAttempt}/${lens}`,
    ]),
  ) as Record<(typeof REVIEW_LENS_NAMES)[number], string>;
  const review = aggregateReviewLenses({
    expected: {
      taskId: input.task.taskId,
      planSha256: transition.fromPlanSha256,
      taskBlockHash: transition.fromTaskBlockHash,
      baseSha: transition.sourceBaseSha,
      headSha: transition.sourceHeadSha,
      treeSha: transition.sourceTreeSha,
      reviewerRunIds,
      rubricIds: DEFAULT_REVIEW_RUBRIC_IDS,
    },
    lenses: REVIEW_LENS_NAMES.map((lens) =>
      parseRecord(input.lensContents[lens], `${lens} review lens`),
    ),
  });
  if (review.reviewVerdict !== "pass" || review.reviewFindings.length !== 0) {
    throw new Error("ownership-rehome review lenses are not passing");
  }

  const integrated = new Set(input.integratedTaskIds);
  const missingPrerequisiteTaskIds =
    transition.requiredIntegratedTaskIds.filter(
      (taskId) => !integrated.has(taskId),
    );
  if (missingPrerequisiteTaskIds.length > 0) {
    const rejection = input.currentRejection;
    if (!rejection) {
      throw new Error("current ownership-rehome rejection is missing");
    }
    const expectedMessage = `${input.task.taskId}: ownership-rehome prerequisite is not integrated: ${missingPrerequisiteTaskIds.join(", ")}`;
    const ownKeys = Reflect.ownKeys(rejection);
    const exactFields =
      ownKeys.length === rejectionKeys.length &&
      ownKeys.every(
        (key) => typeof key === "string" && rejectionKeySet.has(key),
      ) &&
      rejection.transitionKind === "ownership-rehome" &&
      rejection.taskId === input.task.taskId &&
      rejection.sourceRunId === transition.sourceRunId &&
      rejection.workdir === input.expectedWorkdir &&
      rejection.sourceHeadSha === transition.sourceHeadSha &&
      rejection.sourceTreeSha === transition.sourceTreeSha &&
      sameStrings(
        rejection.missingPrerequisiteTaskIds,
        missingPrerequisiteTaskIds,
      ) &&
      rejection.message === expectedMessage;
    if (!exactFields) {
      throw new Error("current ownership-rehome rejection provenance mismatch");
    }
  } else if (input.currentRejection !== undefined) {
    throw new Error("current ownership-rehome rejection is stale");
  }
  return {
    globallyBlocking: false,
    missingPrerequisiteTaskIds,
    sourceHeadSha: transition.sourceHeadSha,
    sourceRunId: transition.sourceRunId,
    status:
      missingPrerequisiteTaskIds.length === 0
        ? "authority_transition_ready"
        : "authority_transition_held",
    taskId: input.task.taskId,
  };
};
