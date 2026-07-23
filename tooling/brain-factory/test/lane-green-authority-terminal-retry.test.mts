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
        actionId:
          "2b24aa26859e0a401121fa5e7144f052b33fc9cb5e5e129812155d35c01d756c",
        taskId,
      }),
    ).toEqual({
      archiveSha256:
        "692a776387ec91fdd47811f689495de88c32568ba95a820e537097b5172318ef",
      headSha: "9e4ab3cfc9261af8203beee9413f404aaf619d34",
      treeSha: "21f9abf17169cfb337f66f8ebf27b5d37883b190",
    });
    expect(() =>
      authorizedTerminalLaneGreenCandidate({ actionId, taskId }),
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

  it.each([
    ["task", { taskId: "S05-T02" }],
    ["run", { runId: "different-run" }],
    ["branch", { branch: "fabro/drifted" }],
    ["worktree", { workdir: "/factory/drifted" }],
    ["plan", { planSha256: sha("e", 64) }],
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
