import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  admitArchivedLaneGreenAuthorityRetry,
  authorizedTerminalLaneGreenCandidate,
  loadAuditedLaneGreenAuthorityArchive,
} from "../src/lane-green-authority-terminal-retry.js";

const sha = (value: string, length = 40): string => value.repeat(length);
const taskId = "S05-T01";
const actionId = sha("a", 64);
const rootActionId =
  "2b24aa26859e0a401121fa5e7144f052b33fc9cb5e5e129812155d35c01d756c";
const rootArchiveSha256 =
  "692a776387ec91fdd47811f689495de88c32568ba95a820e537097b5172318ef";
const rootCandidateHeadSha = "9e4ab3cfc9261af8203beee9413f404aaf619d34";
const rootCandidateTreeSha = "21f9abf17169cfb337f66f8ebf27b5d37883b190";
const transition = {
  schemaVersion: "maestro-brain-lane-green-authority-reproof/v1" as const,
  proofBaseSha: sha("1"),
  proofHeadSha: sha("2"),
  proofPlanSha256: sha("3", 64),
  proofTaskBlockHash: sha("4", 64),
  proofFindingIds: ["OWNERSHIP-S05-T01-001"],
  proofGateStage: "pre-review" as const,
  proofChangedFiles: ["proof.ts"],
  sourceBaseSha: sha("5"),
  sourceCommits: [sha("6")],
  sourceChangedFiles: ["owned.ts"],
  sourceHeadSha: sha("6"),
  sourceTreeSha: sha("7"),
};
const archiveRecord = {
  baseSha: sha("8"),
  branch: "fabro/reproof-s05-t01-green-123456789abc",
  factoryBaseSha: sha("8"),
  mode: "lane-green-authority-reproof",
  phase: "launched",
  planSha256: sha("9", 64),
  proofBaseSha: transition.proofBaseSha,
  proofFindingIds: transition.proofFindingIds,
  proofGateStage: transition.proofGateStage,
  proofHeadSha: transition.proofHeadSha,
  proofPlanSha256: transition.proofPlanSha256,
  proofTaskBlockHash: transition.proofTaskBlockHash,
  runId: "01KY6A17F7BF5FYK7ARGYT2G9V",
  sourceCommitPatchSha256s: [sha("b", 64)],
  sourceCommits: transition.sourceCommits,
  sourceHeadSha: transition.sourceHeadSha,
  sourceTreeSha: transition.sourceTreeSha,
  status: "launched",
  taskBaseSha: transition.sourceBaseSha,
  taskBlockHash: sha("c", 64),
  taskId,
  workdir: "/factory/reproof-s05-t01-green-123456789abc",
  workflowName: "BrainBuildTaskS05T01Green123456789abc",
};

describe("terminal lane-green authority retry", () => {
  it("pins the one authorized archive to the preserved candidate", () => {
    expect(
      authorizedTerminalLaneGreenCandidate({
        actionId: rootActionId,
        taskId,
      }),
    ).toEqual({
      archiveSha256: rootArchiveSha256,
      headSha: rootCandidateHeadSha,
      treeSha: rootCandidateTreeSha,
    });
    expect(() =>
      authorizedTerminalLaneGreenCandidate({ actionId, taskId }),
    ).toThrow("terminal archive has no authorized candidate");
  });

  it("carries the pinned candidate through an audited retry archive", () => {
    const state = mkdtempSync(join(tmpdir(), "lane-green-terminal-chain-"));
    const localRecordPath = join(state, "runs", `${taskId}.json`);
    const localArchivedPath = `${localRecordPath}.terminal-${actionId}`;
    const auditPath = join(state, "recovery-audit.jsonl");
    const chained = {
      ...archiveRecord,
      terminalArchiveActionId: rootActionId,
      terminalArchiveSha256: rootArchiveSha256,
      terminalCandidateHeadSha: rootCandidateHeadSha,
      terminalCandidateTreeSha: rootCandidateTreeSha,
    };
    mkdirSync(join(state, "runs"));
    writeFileSync(localArchivedPath, `${JSON.stringify(chained)}\n`);
    writeFileSync(
      auditPath,
      `${JSON.stringify({
        action: "archive-terminal-task-run",
        actionId,
        archivedPath: localArchivedPath,
        at: "2026-07-24T00:00:00.000Z",
        runId: chained.runId,
        status: "failed",
        taskId,
      })}\n`,
    );

    expect(
      authorizedTerminalLaneGreenCandidate({
        actionId,
        auditPath,
        recordPath: localRecordPath,
        taskId,
      }),
    ).toEqual({
      archiveSha256: createHash("sha256")
        .update(readFileSync(localArchivedPath))
        .digest("hex"),
      headSha: rootCandidateHeadSha,
      treeSha: rootCandidateTreeSha,
    });
  });

  it("validates every audited hop in a chained retry archive", () => {
    const state = mkdtempSync(join(tmpdir(), "lane-green-terminal-multihop-"));
    const localRecordPath = join(state, "runs", `${taskId}.json`);
    const auditPath = join(state, "recovery-audit.jsonl");
    const firstAction = sha("d", 64);
    const secondAction = sha("e", 64);
    mkdirSync(join(state, "runs"));
    const firstPath = `${localRecordPath}.terminal-${firstAction}`;
    const firstRecord = {
      ...archiveRecord,
      terminalArchiveActionId: rootActionId,
      terminalArchiveSha256: rootArchiveSha256,
      terminalCandidateHeadSha: rootCandidateHeadSha,
      terminalCandidateTreeSha: rootCandidateTreeSha,
    };
    writeFileSync(firstPath, `${JSON.stringify(firstRecord)}\n`);
    const firstDigest = createHash("sha256")
      .update(readFileSync(firstPath))
      .digest("hex");
    const secondPath = `${localRecordPath}.terminal-${secondAction}`;
    const secondRecord = {
      ...archiveRecord,
      runId: "01KY6HDQTWXPM0EPMN1BQ5SHVE",
      terminalArchiveActionId: firstAction,
      terminalArchiveSha256: firstDigest,
      terminalCandidateHeadSha: rootCandidateHeadSha,
      terminalCandidateTreeSha: rootCandidateTreeSha,
    };
    writeFileSync(secondPath, `${JSON.stringify(secondRecord)}\n`);
    writeFileSync(
      auditPath,
      [
        {
          action: "archive-terminal-task-run",
          actionId: firstAction,
          archivedPath: firstPath,
          at: "2026-07-24T00:00:00.000Z",
          runId: firstRecord.runId,
          status: "failed",
          taskId,
        },
        {
          action: "archive-terminal-task-run",
          actionId: secondAction,
          archivedPath: secondPath,
          at: "2026-07-24T00:01:00.000Z",
          runId: secondRecord.runId,
          status: "failed",
          taskId,
        },
      ]
        .map((event) => JSON.stringify(event))
        .join("\n") + "\n",
    );

    expect(
      authorizedTerminalLaneGreenCandidate({
        actionId: secondAction,
        auditPath,
        recordPath: localRecordPath,
        taskId,
      }),
    ).toMatchObject({
      headSha: rootCandidateHeadSha,
      treeSha: rootCandidateTreeSha,
    });

    writeFileSync(
      auditPath,
      `${readFileSync(auditPath, "utf8").split("\n")[1]}\n`,
    );
    expect(() =>
      authorizedTerminalLaneGreenCandidate({
        actionId: secondAction,
        auditPath,
        recordPath: localRecordPath,
        taskId,
      }),
    ).toThrow("exact terminal archive audit is missing or ambiguous");
  });

  it("rejects a recursive archive cycle", () => {
    const state = mkdtempSync(join(tmpdir(), "lane-green-terminal-cycle-"));
    const localRecordPath = join(state, "runs", `${taskId}.json`);
    const auditPath = join(state, "recovery-audit.jsonl");
    const cycleAction = sha("f", 64);
    const cyclePath = `${localRecordPath}.terminal-${cycleAction}`;
    mkdirSync(join(state, "runs"));
    writeFileSync(
      cyclePath,
      `${JSON.stringify({
        ...archiveRecord,
        terminalArchiveActionId: cycleAction,
        terminalArchiveSha256: sha("0", 64),
        terminalCandidateHeadSha: rootCandidateHeadSha,
        terminalCandidateTreeSha: rootCandidateTreeSha,
      })}\n`,
    );
    writeFileSync(
      auditPath,
      `${JSON.stringify({
        action: "archive-terminal-task-run",
        actionId: cycleAction,
        archivedPath: cyclePath,
        at: "2026-07-24T00:00:00.000Z",
        runId: archiveRecord.runId,
        status: "failed",
        taskId,
      })}\n`,
    );
    expect(() =>
      authorizedTerminalLaneGreenCandidate({
        actionId: cycleAction,
        auditPath,
        recordPath: localRecordPath,
        taskId,
      }),
    ).toThrow("terminal archive has no authorized candidate");
  });
  it("selects only the exact audited terminal archive", () => {
    const state = mkdtempSync(join(tmpdir(), "lane-green-terminal-audit-"));
    const localRecordPath = join(state, "runs", `${taskId}.json`);
    const localArchivedPath = `${localRecordPath}.terminal-${actionId}`;
    const auditPath = join(state, "recovery-audit.jsonl");
    mkdirSync(join(state, "runs"));
    writeFileSync(localArchivedPath, `${JSON.stringify(archiveRecord)}\n`);
    writeFileSync(
      auditPath,
      `${JSON.stringify({
        action: "archive-terminal-task-run",
        actionId,
        archivedPath: localArchivedPath,
        at: "2026-07-23T02:17:42.486Z",
        runId: archiveRecord.runId,
        status: "failed",
        taskId,
      })}\n`,
    );

    const selected = loadAuditedLaneGreenAuthorityArchive({
      actionId,
      auditPath,
      recordPath: localRecordPath,
      taskId,
    });
    expect(selected.record).toEqual(archiveRecord);
    expect(selected.archivedPath).toBe(localArchivedPath);
    expect(selected.sha256).toBe(
      createHash("sha256")
        .update(readFileSync(localArchivedPath))
        .digest("hex"),
    );
    expect(selected.status).toBe("failed");
  });

  it("reconstructs admission without mutable lane evidence", () => {
    expect(
      admitArchivedLaneGreenAuthorityRetry({
        archive: archiveRecord,
        coordinates: {
          branch: archiveRecord.branch,
          workdir: archiveRecord.workdir,
          workflowName: archiveRecord.workflowName,
        },
        currentPlanSha256: archiveRecord.planSha256,
        currentTaskBlockHash: archiveRecord.taskBlockHash,
        sourceChangedFiles: transition.sourceChangedFiles,
        sourceCommitPatchSha256s: archiveRecord.sourceCommitPatchSha256s,
        sourcePatchSha256: sha("d", 64),
        sourceTreeSha: transition.sourceTreeSha,
        taskId,
        transition,
      }),
    ).toEqual({
      mode: "lane-green-authority-reproof",
      oldPlanSha256: transition.proofPlanSha256,
      oldTaskBlockHash: transition.proofTaskBlockHash,
      proofBaseSha: transition.proofBaseSha,
      proofFindingIds: transition.proofFindingIds,
      proofGateStage: "pre-review",
      proofHeadSha: transition.proofHeadSha,
      sourceBaseSha: transition.sourceBaseSha,
      sourceCommits: transition.sourceCommits,
      sourceCommitPatchSha256s: archiveRecord.sourceCommitPatchSha256s,
      sourceChangedFiles: transition.sourceChangedFiles,
      sourceHeadSha: transition.sourceHeadSha,
      sourcePatchSha256: sha("d", 64),
      sourceTreeSha: transition.sourceTreeSha,
    });
  });

  it("retains archived plan provenance across a plan-only advance", () => {
    expect(() =>
      admitArchivedLaneGreenAuthorityRetry({
        archive: archiveRecord,
        coordinates: {
          branch: archiveRecord.branch,
          workdir: archiveRecord.workdir,
          workflowName: archiveRecord.workflowName,
        },
        currentPlanSha256: sha("e", 64),
        currentTaskBlockHash: archiveRecord.taskBlockHash,
        sourceChangedFiles: transition.sourceChangedFiles,
        sourceCommitPatchSha256s: archiveRecord.sourceCommitPatchSha256s,
        sourcePatchSha256: sha("d", 64),
        sourceTreeSha: transition.sourceTreeSha,
        taskId,
        transition,
      }),
    ).not.toThrow();
  });

  it.each([
    ["task", { taskId: "S05-T02" }],
    ["run", { runId: "different-run" }],
    ["branch", { branch: "fabro/drifted" }],
    ["worktree", { workdir: "/factory/drifted" }],
    ["plan", { planSha256: "invalid-plan" }],
    ["task hash", { taskBlockHash: sha("f", 64) }],
    ["proof lineage", { proofHeadSha: sha("0") }],
    ["source lineage", { sourceHeadSha: sha("0") }],
    ["patch lineage", { sourceCommitPatchSha256s: [sha("0", 64)] }],
  ])("rejects archived %s identity drift", (_label, drift) => {
    expect(() =>
      admitArchivedLaneGreenAuthorityRetry({
        archive: { ...archiveRecord, ...drift },
        coordinates: {
          branch: archiveRecord.branch,
          workdir: archiveRecord.workdir,
          workflowName: archiveRecord.workflowName,
        },
        currentPlanSha256: archiveRecord.planSha256,
        currentTaskBlockHash: archiveRecord.taskBlockHash,
        sourceChangedFiles: transition.sourceChangedFiles,
        sourceCommitPatchSha256s: archiveRecord.sourceCommitPatchSha256s,
        sourcePatchSha256: sha("d", 64),
        sourceTreeSha: transition.sourceTreeSha,
        taskId,
        transition,
      }),
    ).toThrow();
  });
});
