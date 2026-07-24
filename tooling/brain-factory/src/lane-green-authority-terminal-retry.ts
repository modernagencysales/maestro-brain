import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import type { LaneGreenAuthorityReproofTransition } from "./manifest.js";
import type { LaneGreenAuthorityReproofAdmission } from "./lane-green-authority-reproof.js";

type JsonRecord = Record<string, unknown>;

const record = (value: unknown, label: string): JsonRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${label} is not a JSON object`);
  return value as JsonRecord;
};

const string = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${label} is missing`);
  return value;
};

const sha = (value: unknown, length: 40 | 64, label: string): string => {
  const result = string(value, label);
  if (!new RegExp(`^[0-9a-f]{${length}}$`).test(result))
    throw new Error(`${label} is invalid`);
  return result;
};

const same = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

export interface AuditedLaneGreenAuthorityArchive {
  readonly actionId: string;
  readonly archivedPath: string;
  readonly content: string;
  readonly record: JsonRecord;
  readonly sha256: string;
  readonly status: string;
}

const ROOT_ARCHIVE_ACTION_ID =
  "2b24aa26859e0a401121fa5e7144f052b33fc9cb5e5e129812155d35c01d756c";
const ROOT_ARCHIVE_SHA256 =
  "692a776387ec91fdd47811f689495de88c32568ba95a820e537097b5172318ef";
const ROOT_CANDIDATE_HEAD_SHA = "9e4ab3cfc9261af8203beee9413f404aaf619d34";
const ROOT_CANDIDATE_TREE_SHA = "21f9abf17169cfb337f66f8ebf27b5d37883b190";

export const authorizedTerminalLaneGreenCandidate = (input: {
  readonly actionId: string;
  readonly auditPath?: string;
  readonly recordPath?: string;
  readonly taskId: string;
}): {
  readonly archiveSha256: string;
  readonly headSha: string;
  readonly treeSha: string;
} => {
  if (input.taskId !== "S05-T01")
    throw new Error(
      `${input.taskId}: terminal archive has no authorized candidate`,
    );
  const visit = (
    actionId: string,
    seen: ReadonlySet<string>,
  ): {
    readonly archiveSha256: string;
    readonly headSha: string;
    readonly treeSha: string;
  } => {
    if (actionId === ROOT_ARCHIVE_ACTION_ID)
      return {
        archiveSha256: ROOT_ARCHIVE_SHA256,
        headSha: ROOT_CANDIDATE_HEAD_SHA,
        treeSha: ROOT_CANDIDATE_TREE_SHA,
      };
    if (!input.auditPath || !input.recordPath || seen.has(actionId))
      throw new Error(
        `${input.taskId}: terminal archive has no authorized candidate`,
      );
    const archive = loadAuditedLaneGreenAuthorityArchive({
      actionId,
      auditPath: input.auditPath,
      recordPath: input.recordPath,
      taskId: input.taskId,
    });
    const priorActionId = sha(
      archive.record.terminalArchiveActionId,
      64,
      `${input.taskId}: prior terminal archive action`,
    );
    const prior = visit(priorActionId, new Set([...seen, actionId]));
    if (
      archive.record.terminalArchiveSha256 !== prior.archiveSha256 ||
      archive.record.terminalCandidateHeadSha !== prior.headSha ||
      archive.record.terminalCandidateTreeSha !== prior.treeSha
    )
      throw new Error(
        `${input.taskId}: terminal archive candidate chain drift`,
      );
    return {
      archiveSha256: archive.sha256,
      headSha: prior.headSha,
      treeSha: prior.treeSha,
    };
  };
  return visit(input.actionId, new Set());
};

export const loadAuditedLaneGreenAuthorityArchive = (input: {
  readonly actionId: string;
  readonly auditPath: string;
  readonly recordPath: string;
  readonly taskId: string;
}): AuditedLaneGreenAuthorityArchive => {
  if (!/^[0-9a-zA-Z._-]+$/.test(input.actionId))
    throw new Error(`${input.taskId}: archive action selector is unsafe`);
  if (!existsSync(input.auditPath))
    throw new Error(`${input.taskId}: terminal archive audit is missing`);
  const archivedPath = `${input.recordPath}.terminal-${input.actionId}`;
  const events = readFileSync(input.auditPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => record(JSON.parse(line), "task audit event"))
    .filter(
      (event) =>
        event.action === "archive-terminal-task-run" &&
        event.actionId === input.actionId &&
        event.taskId === input.taskId,
    );
  if (events.length !== 1)
    throw new Error(
      `${input.taskId}: exact terminal archive audit is missing or ambiguous`,
    );
  const [event] = events;
  if (event?.archivedPath !== archivedPath || !existsSync(archivedPath))
    throw new Error(`${input.taskId}: audited terminal archive path drift`);
  const status = string(event.status, `${input.taskId}: terminal status`);
  if (!new Set(["canceled", "cancelled", "failed", "succeeded"]).has(status))
    throw new Error(`${input.taskId}: archived run is not terminal`);
  const content = readFileSync(archivedPath, "utf8");
  const archived = record(
    JSON.parse(content),
    `${input.taskId}: archived lane-green owner`,
  );
  if (
    archived.taskId !== input.taskId ||
    archived.runId !== event.runId ||
    archived.mode !== "lane-green-authority-reproof"
  )
    throw new Error(`${input.taskId}: archived terminal identity drift`);
  return {
    actionId: input.actionId,
    archivedPath,
    content,
    record: archived,
    sha256: createHash("sha256").update(content).digest("hex"),
    status,
  };
};

export const admitArchivedLaneGreenAuthorityRetry = (input: {
  readonly archive: JsonRecord;
  readonly coordinates: {
    readonly branch: string;
    readonly workdir: string;
    readonly workflowName: string;
  };
  readonly currentPlanSha256: string;
  readonly currentTaskBlockHash: string;
  readonly sourceChangedFiles: readonly string[];
  readonly sourceCommitPatchSha256s: readonly string[];
  readonly sourcePatchSha256: string;
  readonly sourceTreeSha: string;
  readonly taskId: string;
  readonly transition: LaneGreenAuthorityReproofTransition;
}): LaneGreenAuthorityReproofAdmission => {
  const archived = input.archive;
  const transition = input.transition;
  const runId = string(archived.runId, `${input.taskId}: archived run ID`);
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(runId))
    throw new Error(`${input.taskId}: archived run ID is invalid`);
  const factoryBaseSha = sha(
    archived.factoryBaseSha,
    40,
    `${input.taskId}: archived factory base`,
  );
  sha(archived.planSha256, 64, `${input.taskId}: archived plan`);
  if (
    archived.taskId !== input.taskId ||
    input.taskId !== "S05-T01" ||
    archived.mode !== "lane-green-authority-reproof" ||
    archived.phase !== "launched" ||
    archived.status !== "launched" ||
    archived.baseSha !== factoryBaseSha ||
    archived.taskBlockHash !== input.currentTaskBlockHash ||
    archived.branch !== input.coordinates.branch ||
    archived.workdir !== input.coordinates.workdir ||
    archived.workflowName !== input.coordinates.workflowName
  )
    throw new Error(`${input.taskId}: archived authority identity drift`);
  const transitionBindings: readonly [unknown, unknown][] = [
    [archived.proofBaseSha, transition.proofBaseSha],
    [archived.proofHeadSha, transition.proofHeadSha],
    [archived.proofPlanSha256, transition.proofPlanSha256],
    [archived.proofTaskBlockHash, transition.proofTaskBlockHash],
    [archived.proofFindingIds, transition.proofFindingIds],
    [archived.proofGateStage, transition.proofGateStage],
    [archived.taskBaseSha, transition.sourceBaseSha],
    [archived.sourceCommits, transition.sourceCommits],
    [archived.sourceHeadSha, transition.sourceHeadSha],
    [archived.sourceTreeSha, transition.sourceTreeSha],
  ];
  if (transitionBindings.some(([left, right]) => !same(left, right)))
    throw new Error(`${input.taskId}: archived dual-history lineage drift`);
  if (
    !same(archived.sourceCommitPatchSha256s, input.sourceCommitPatchSha256s) ||
    !same(input.sourceChangedFiles, transition.sourceChangedFiles) ||
    input.sourceTreeSha !== transition.sourceTreeSha
  )
    throw new Error(`${input.taskId}: archived source replay lineage drift`);
  sha(input.sourcePatchSha256, 64, `${input.taskId}: source patch SHA`);
  input.sourceCommitPatchSha256s.forEach((value) =>
    sha(value, 64, `${input.taskId}: source commit patch SHA`),
  );
  return {
    mode: "lane-green-authority-reproof",
    oldPlanSha256: transition.proofPlanSha256,
    oldTaskBlockHash: transition.proofTaskBlockHash,
    proofBaseSha: transition.proofBaseSha,
    proofFindingIds: transition.proofFindingIds,
    proofGateStage: transition.proofGateStage,
    proofHeadSha: transition.proofHeadSha,
    sourceBaseSha: transition.sourceBaseSha,
    sourceCommits: transition.sourceCommits,
    sourceCommitPatchSha256s: input.sourceCommitPatchSha256s,
    sourceChangedFiles: input.sourceChangedFiles,
    sourceHeadSha: transition.sourceHeadSha,
    sourcePatchSha256: input.sourcePatchSha256,
    sourceTreeSha: transition.sourceTreeSha,
  };
};
