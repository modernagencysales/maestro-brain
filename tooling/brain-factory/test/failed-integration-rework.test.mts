import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { admitContractReproof } from "../src/contract-reproof-admission.js";
import { buildContractReproofRequest } from "../src/contract-reproof.js";
import { validateFailedIntegrationReworkArchive } from "../src/failed-integration-rework-archive.js";
import { planFailedIntegrationRework } from "../src/failed-integration-rework.js";
import {
  selectionFileSha256,
  selectionPayload,
  selectionPayloadSha256,
} from "../src/integration-wave.js";

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

const fixture = () => {
  const taskId = "S11-T02";
  const baseSha = "1".repeat(40);
  const controlHeadSha = "2".repeat(40);
  const laneHeadSha = "3".repeat(40);
  const candidateHeadSha = "4".repeat(40);
  const taskBlockHash = "5".repeat(64);
  const planSha256 = "6".repeat(64);
  const lane = {
    schemaVersion: "maestro-brain-lane-result/v1",
    taskId,
    headSha: laneHeadSha,
    treeSha: "7".repeat(40),
    tranche: "D2-domain-bodies",
    status: "lane_green",
  };
  const proof = {
    schemaVersion: "maestro-brain-ci-proof/v1",
    taskId,
    taskBlockHash,
    planSha256: "8".repeat(64),
    baseSha: "9".repeat(40),
    headSha: laneHeadSha,
    reviewHeadSha: laneHeadSha,
    reviewVerdict: "pass",
    reviewFindings: [],
  };
  const gate = {
    schemaVersion: "maestro-brain-lane-gate/v1",
    taskId,
    taskBlockHash,
    planSha256: proof.planSha256,
    currentHeadSha: laneHeadSha,
    currentTreeSha: lane.treeSha,
    headSha: laneHeadSha,
    stage: "final",
    status: "passed",
  };
  const laneContent = json(lane);
  const proofContent = json(proof);
  const gateContent = json(gate);
  const payload = selectionPayload({
    baseSha,
    deferredTaskIds: [],
    integrationId: "wave-000052",
    planSha256,
    requestedTaskIds: [taskId],
    selectedTasks: [
      {
        changedFiles: ["packages/example.ts"],
        codeStartAfter: ["S11-T01"],
        fileLocks: ["packages/example.ts"],
        gateHeadSha: laneHeadSha,
        gateSha256: sha256(gateContent),
        headSha: laneHeadSha,
        laneResultSha256: sha256(laneContent),
        planSha256: proof.planSha256,
        proofHeadSha: laneHeadSha,
        proofSha256: sha256(proofContent),
        taskBlockHash,
        taskId,
        tranche: lane.tranche,
      },
    ],
  });
  const selection = {
    ...payload,
    selectionPayloadSha256: selectionPayloadSha256(payload),
  };
  const selectionContent = json(selection);
  const broadGate = {
    schemaVersion: "maestro-brain-broad-gate-receipt/v1",
    command: "rtk host-test-slot --class full pnpm verify",
    headSha: candidateHeadSha,
    status: "failed",
    attempts: [
      {
        attempt: 1,
        command: "rtk host-test-slot --class full pnpm verify",
        headSha: candidateHeadSha,
        outputSha256: "a".repeat(64),
        status: "failed",
        transientVitestWorkerRpcTimeout: false,
      },
    ],
  };
  const broadGateContent = json(broadGate);
  const integrationResult = {
    schemaVersion: "maestro-brain-integration-result/v3",
    integrationId: selection.integrationId,
    baseSha,
    headSha: candidateHeadSha,
    selectionFileSha256: selectionFileSha256(selectionContent),
    selectionPayloadSha256: selection.selectionPayloadSha256,
    status: "rework",
    reviewVerdict: "rework",
    remainingFindings: [
      {
        id: "type-coverage-below-threshold",
        severity: "high",
        summary: "Type coverage was 99.63%, below 99.7%.",
        taskId,
      },
    ],
    broadGate,
  };
  const integrationResultContent = json(integrationResult);
  const supersessionPayload = {
    schemaVersion: "maestro-brain-integration-wave-supersession/v2",
    baseSha,
    controlHeadSha: baseSha,
    createdAt: "2026-07-20T21:14:57.387Z",
    evidence: [
      `broad-gate-sha256:${sha256(broadGateContent)}`,
      `integration-result-sha256:${sha256(integrationResultContent)}`,
      "run:01KY0MHH810PNR2MDZ8MBF3AEB:failed",
    ].sort(),
    integrationId: selection.integrationId,
    planSha256,
    reason: "s11-type-coverage-below-99.7",
    runAttempts: [
      {
        attempt: 1,
        runId: "01KY0MHH810PNR2MDZ8MBF3AEB",
        status: "failed",
      },
    ],
    runRecordSha256: "b".repeat(64),
    selectedTaskIds: [taskId],
    selectionFileSha256: selectionFileSha256(selectionContent),
    selectionPayloadSha256: selection.selectionPayloadSha256,
    status: "superseded",
  };
  const supersession = {
    ...supersessionPayload,
    receiptSha256: sha256(JSON.stringify(supersessionPayload)),
  };
  const input = {
    broadGateContent,
    controlClean: true,
    controlHeadSha,
    dependenciesIntegrated: true,
    expectedSourceBranch: "fabro/review-s11-t02",
    integrationResultContent,
    isAncestor: (ancestor: string, descendant: string) =>
      ancestor === baseSha && descendant === controlHeadSha,
    laneContent,
    manifestTaskBlockHash: taskBlockHash,
    planSha256,
    priorEvidencePath: "/tmp/evidence/archive/wave-000052/pending.json",
    proofContent,
    gateContent,
    promotionExists: false,
    reason: "repair deterministic broad verification failure",
    selectionContent,
    sourceBranch: "fabro/review-s11-t02",
    sourceBranchHeadSha: laneHeadSha,
    sourceClean: true,
    sourceWorktreeHeadSha: laneHeadSha,
    supersessionContent: json(supersession),
    taskId,
  };
  return {
    input,
    values: { broadGate, integrationResult, selection, supersession },
  };
};

describe("failed integration rework admission", () => {
  it("builds an immutable archive and normal reproof request for one failed owner", () => {
    const value = fixture();
    const planned = planFailedIntegrationRework(value.input);
    expect(planned.archive).toMatchObject({
      schemaVersion: "maestro-brain-failed-integration-rework-archive/v1",
      taskId: value.input.taskId,
      integrationId: value.values.selection.integrationId,
      candidateHeadSha: value.values.integrationResult.headSha,
    });
    expect(planned.request).toEqual(
      buildContractReproofRequest({
        controlHeadSha: value.input.controlHeadSha,
        planSha256: value.input.planSha256,
        priorArchiveSha256: sha256(planned.archiveContent),
        priorEvidencePath: value.input.priorEvidencePath,
        priorIntegrationHeadSha: value.values.selection.baseSha,
        priorIntegrationId: value.values.selection.integrationId,
        priorIntegrationResultSha256: sha256(
          value.input.integrationResultContent,
        ),
        priorLaneResultSha256: sha256(value.input.laneContent),
        reason: value.input.reason,
        taskBlockHash: value.input.manifestTaskBlockHash,
        taskId: value.input.taskId,
      }),
    );
  });

  it("admits the archived failed-wave request through normal reproof tooling", () => {
    const value = fixture();
    const root = mkdtempSync(resolve(tmpdir(), "brain-failed-rework-"));
    roots.push(root);
    const evidence = resolve(root, "evidence");
    const provisional = planFailedIntegrationRework(value.input);
    const archivePath = resolve(
      evidence,
      "archive",
      value.values.selection.integrationId,
      `${sha256(provisional.archiveContent)}.json`,
    );
    const planned = planFailedIntegrationRework({
      ...value.input,
      priorEvidencePath: archivePath,
    });
    const resultPath = resolve(
      evidence,
      "integration",
      value.values.selection.integrationId,
      "integration-result.json",
    );
    const requestPath = resolve(
      evidence,
      "reproofs",
      value.input.taskId,
      "request.json",
    );
    mkdirSync(resolve(archivePath, ".."), { recursive: true });
    mkdirSync(resolve(resultPath, ".."), { recursive: true });
    mkdirSync(resolve(requestPath, ".."), { recursive: true });
    writeFileSync(archivePath, planned.archiveContent);
    writeFileSync(resultPath, value.input.integrationResultContent);
    writeFileSync(requestPath, json(planned.request));
    const selectedTask = value.values.selection.selectedTasks[0];
    if (!selectedTask) throw new Error("fixture selected task is missing");
    expect(
      admitContractReproof({
        changedFilesBetween: () => [],
        currentControlHead: value.input.controlHeadSha,
        evidenceDirectory: evidence,
        fileLocks: selectedTask.fileLocks,
        isAncestor: (ancestor, descendant) =>
          ancestor === descendant ||
          value.input.isAncestor(ancestor, descendant),
        lanePriorIntegrationHeadSha: planned.request.priorIntegrationHeadSha,
        lanePriorIntegrationId: planned.request.priorIntegrationId,
        laneRequestSha256: planned.request.requestSha256,
        planSha256: value.input.planSha256,
        proofBaseSha: value.input.controlHeadSha,
        requestPath,
        taskBlockHash: value.input.manifestTaskBlockHash,
        taskId: value.input.taskId,
      }).request,
    ).toEqual(planned.request);
  });

  it("rejects a self-rehashed archive with mutated proof evidence", () => {
    const value = fixture();
    const planned = planFailedIntegrationRework(value.input);
    const archive = {
      ...planned.archive,
      proofContent: `${planned.archive.proofContent} `,
    };
    const archiveContent = json(archive);
    const request = buildContractReproofRequest({
      ...planned.request,
      priorArchiveSha256: sha256(archiveContent),
    });
    expect(() =>
      validateFailedIntegrationReworkArchive({
        archiveContent,
        integrationResultContent: value.input.integrationResultContent,
        request,
      }),
    ).toThrow(/proof digest drift/);
  });

  it.each([
    [
      "pass wave",
      {
        integrationResultContent: json({
          ...fixture().values.integrationResult,
          status: "passed",
        }),
      },
      /status is not rework/,
    ],
    ["promoted wave", { promotionExists: true }, /already promoted/],
    ["wrong owner", { taskId: "S11-T03" }, /task owner mismatch/],
    [
      "stale task hash",
      { manifestTaskBlockHash: "c".repeat(64) },
      /task-block drift/,
    ],
    ["dirty source", { sourceClean: false }, /source worktree is not clean/],
    ["dirty control", { controlClean: false }, /control worktree is not clean/],
    ["wrong branch", { sourceBranch: "fabro/other" }, /source branch drift/],
    [
      "missing dependency",
      { dependenciesIntegrated: false },
      /dependencies are not integrated/,
    ],
    [
      "promoted base not on control",
      { isAncestor: () => false },
      /wave base is not an ancestor/,
    ],
  ])("rejects %s", (_label, overrides, expected) => {
    const value = fixture();
    expect(() =>
      planFailedIntegrationRework({ ...value.input, ...overrides }),
    ).toThrow(expected);
  });

  it("rejects a pass broad receipt", () => {
    const value = fixture();
    expect(() =>
      planFailedIntegrationRework({
        ...value.input,
        broadGateContent: json({ ...value.values.broadGate, status: "passed" }),
      }),
    ).toThrow(/broad gate is not failed/);
  });

  it("rejects ambiguous multiple-task ownership", () => {
    const value = fixture();
    const selectedTask = value.values.selection.selectedTasks[0];
    if (!selectedTask) throw new Error("fixture selected task is missing");
    const selectedTasks = [
      selectedTask,
      {
        ...selectedTask,
        changedFiles: ["packages/other.ts"],
        fileLocks: ["packages/other.ts"],
        taskId: "S11-T03",
      },
    ];
    const payload = selectionPayload({
      ...value.values.selection,
      requestedTaskIds: ["S11-T02", "S11-T03"],
      selectedTasks,
    });
    const selection = {
      ...payload,
      selectionPayloadSha256: selectionPayloadSha256(payload),
    };
    expect(() =>
      planFailedIntegrationRework({
        ...value.input,
        selectionContent: json(selection),
      }),
    ).toThrow(/exactly one selected task/);
  });

  it("rejects a finding not owned by the selected task", () => {
    const value = fixture();
    const integrationResult = {
      ...value.values.integrationResult,
      remainingFindings: [
        { id: "coverage", severity: "high", taskId: "S11-T03" },
      ],
    };
    expect(() =>
      planFailedIntegrationRework({
        ...value.input,
        integrationResultContent: json(integrationResult),
      }),
    ).toThrow(/finding owner mismatch/);
  });

  it("rejects missing or drifted broad-gate evidence", () => {
    const value = fixture();
    expect(() =>
      planFailedIntegrationRework({ ...value.input, broadGateContent: "" }),
    ).toThrow(/broad gate receipt is missing/);
    const broadGate = { ...value.values.broadGate, headSha: "d".repeat(40) };
    expect(() =>
      planFailedIntegrationRework({
        ...value.input,
        broadGateContent: json(broadGate),
      }),
    ).toThrow(/broad gate candidate head drift/);
  });

  it("rejects selection proof, gate, lane, and source-head drift", () => {
    const value = fixture();
    for (const [field, content, expected] of [
      [
        "laneContent",
        `${value.input.laneContent} `,
        /lane result digest drift/,
      ],
      ["proofContent", `${value.input.proofContent} `, /proof digest drift/],
      ["gateContent", `${value.input.gateContent} `, /gate digest drift/],
      ["sourceBranchHeadSha", "e".repeat(40), /source head drift/],
    ] as const) {
      expect(() =>
        planFailedIntegrationRework({ ...value.input, [field]: content }),
      ).toThrow(expected);
    }
  });

  it("rejects non-failed or digest-drifted supersession evidence", () => {
    const value = fixture();
    const passAttempt = {
      ...value.values.supersession,
      runAttempts: [
        { ...value.values.supersession.runAttempts[0], status: "cancelled" },
      ],
    };
    expect(() =>
      planFailedIntegrationRework({
        ...value.input,
        supersessionContent: json(passAttempt),
      }),
    ).toThrow(/supersession receipt digest drift|terminal failed/);
    const drifted = {
      ...value.values.supersession,
      receiptSha256: "f".repeat(64),
    };
    expect(() =>
      planFailedIntegrationRework({
        ...value.input,
        supersessionContent: json(drifted),
      }),
    ).toThrow(/supersession receipt digest drift/);
  });
});
