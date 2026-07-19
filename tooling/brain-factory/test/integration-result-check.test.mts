import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { validateIntegrationResult } from "../src/integration-result-check.mjs";
import { archiveIntegrationEvidence } from "../src/evidence-archive.js";
import { buildContractReproofRequest } from "../src/contract-reproof.js";
import { gateCommandSetHash } from "../src/lane-gate-cache.js";
import { adoptLegacyIntegratedLaneEvidence } from "../src/lane-evidence-adoption.js";
import {
  planIntegrationWave,
  selectionFileSha256,
  selectionPayloadSha256,
} from "../src/integration-wave.js";
import type { BrainTaskContract } from "../src/manifest.js";

const temporaryDirectories: string[] = [];

const command = (directory: string, ...args: string[]): string =>
  execFileSync("rtk", ["proxy", "git", ...args], {
    cwd: directory,
    encoding: "utf8",
  }).trim();

const writeJson = (path: string, value: unknown): void =>
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

const fixture = (options?: { readonly taskId?: string }) => {
  const root = mkdtempSync(resolve(tmpdir(), "brain-integration-check-"));
  temporaryDirectories.push(root);
  const workdir = resolve(root, "integration");
  const evidence = resolve(root, "evidence");
  const integrationId = "C1-contract-spine-w2";
  const manifestTranche = "C1-contract-spine";
  const taskId = options?.taskId ?? "S09-T01";
  const planSha256 = "1".repeat(64);
  const taskBlockHash = "2".repeat(64);
  const manifestDirectory = resolve(
    root,
    "docs/superpowers/execution/maestro-brain",
  );
  mkdirSync(manifestDirectory, { recursive: true });
  const manifestPath = resolve(manifestDirectory, "task-manifest.json");
  writeJson(manifestPath, {
    schemaVersion: "maestro-brain-task-manifest/v1",
    planSha256,
    tasks: [
      {
        acceptanceAfter: "none",
        taskId,
        taskBlockHash,
        tranche: manifestTranche,
        codeStartAfter: [],
        fileInventoryStatus: "ready",
        fileLocks: ["source.ts"],
        gateProfiles: ["docs"],
      },
    ],
  });
  mkdirSync(workdir);
  command(workdir, "init", "-q");
  command(workdir, "config", "core.hooksPath", "/dev/null");
  command(workdir, "config", "user.email", "brain@example.test");
  command(workdir, "config", "user.name", "Brain Test");
  writeFileSync(resolve(workdir, "source.ts"), "export const ready = false;\n");
  mkdirSync(resolve(workdir, "packages/convex/convex"), { recursive: true });
  writeFileSync(
    resolve(workdir, "packages/convex/convex/schema.ts"),
    "export const generated = false;\n",
  );
  command(workdir, "add", "source.ts", "packages/convex/convex/schema.ts");
  command(workdir, "commit", "-qm", "test: add base");
  const baseSha = command(workdir, "rev-parse", "HEAD");
  command(workdir, "checkout", "-qb", "lane");
  writeFileSync(resolve(workdir, "source.ts"), "export const ready = true;\n");
  command(workdir, "add", "source.ts");
  command(workdir, "commit", "-qm", "test: add lane change");
  const laneHeadSha = command(workdir, "rev-parse", "HEAD");
  command(workdir, "checkout", "-qb", "integration", baseSha);
  writeFileSync(
    resolve(workdir, "integration.ts"),
    "export const merge = true;\n",
  );
  command(workdir, "add", "integration.ts");
  command(workdir, "commit", "-qm", "test: prepare integration");
  command(workdir, "cherry-pick", laneHeadSha);
  const headSha = command(workdir, "rev-parse", "HEAD");
  const integrationDirectory = resolve(evidence, "integration", integrationId);
  const laneDirectory = resolve(evidence, "lane-results", taskId);
  mkdirSync(integrationDirectory, { recursive: true });
  mkdirSync(laneDirectory, { recursive: true });
  const resultPath = resolve(integrationDirectory, "integration-result.json");
  const lanePath = resolve(laneDirectory, "lane-result.json");
  writeJson(resultPath, {
    schemaVersion: "maestro-brain-integration-result/v1",
    integrationId,
    manifestTranche,
    integrationWorkdir: realpathSync(workdir),
    baseSha,
    headSha,
    status: "passed",
    reviewVerdict: "pass",
    remainingFindings: [],
    broadGate: {
      status: "passed",
      headSha,
      command: "rtk host-test-slot --class full pnpm verify",
    },
    includedTasks: [{ taskId }],
  });
  writeJson(lanePath, {
    acceptanceBlocker: "external acceptance evidence is not yet present",
    accepted: false,
    taskId,
    headSha: laneHeadSha,
    status: "integrated",
    integrationHeadSha: headSha,
    integrationId,
    tranche: manifestTranche,
  });
  const proofPath = resolve(laneDirectory, "ci-proof-packet.json");
  writeJson(proofPath, {
    schemaVersion: "maestro-brain-ci-proof/v1",
    taskId,
    planSha256,
    taskBlockHash,
    baseSha,
    changedFiles: ["source.ts"],
    headSha: laneHeadSha,
    reviewVerdict: "pass",
    focusedCommands: ["rtk pnpm --dir packages/search typecheck"],
  });
  const gateCommands = [
    {
      program: "pnpm",
      args: ["exec", "prettier", "--check", "--ignore-unknown", "source.ts"],
    },
    { program: "pnpm", args: ["exec", "eslint", "source.ts"] },
    { program: "pnpm", args: ["--dir", "packages/search", "typecheck"] },
  ];
  const gatePath = resolve(laneDirectory, "lane-gate-report.json");
  writeJson(gatePath, {
    schemaVersion: "maestro-brain-lane-gate/v1",
    taskId,
    headSha: laneHeadSha,
    currentHeadSha: laneHeadSha,
    planSha256,
    taskBlockHash,
    commandSetHash: gateCommandSetHash(gateCommands),
    commands: gateCommands.map(
      (gateCommand) =>
        `rtk ${gateCommand.program} ${gateCommand.args.join(" ")}`,
    ),
    stage: "final",
    status: "passed",
  });
  return {
    baseSha,
    controlRoot: root,
    evidence,
    headSha,
    integrationId,
    gatePath,
    lanePath,
    manifestPath,
    manifestTranche,
    planSha256,
    proofPath,
    resultPath,
    taskBlockHash,
    workdir,
  };
};

const readRecord = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

const sha256File = (path: string): string =>
  createHash("sha256").update(readFileSync(path, "utf8")).digest("hex");

const waveFixture = (options?: {
  readonly legacy?: boolean;
  readonly reproof?: boolean;
}) => {
  const value = fixture();
  command(value.workdir, "rm", "integration.ts");
  command(value.workdir, "commit", "-qm", "test: remove integration marker");
  const headSha = command(value.workdir, "rev-parse", "HEAD");
  const manifest = readRecord(value.manifestPath);
  const manifestTask = (manifest.tasks as BrainTaskContract[])[0];
  if (!manifestTask) throw new Error("fixture manifest task missing");
  const plannerTask = {
    ...manifestTask,
    kind: "product" as const,
  } as BrainTaskContract;
  const reproofRequest = options?.reproof
    ? buildContractReproofRequest({
        controlHeadSha: value.baseSha,
        planSha256: value.planSha256,
        priorArchiveSha256: "3".repeat(64),
        priorEvidencePath: resolve(value.evidence, "archive", "prior.json"),
        priorIntegrationHeadSha: value.baseSha,
        priorIntegrationId: "wave-prior",
        priorIntegrationResultSha256: "4".repeat(64),
        priorLaneResultSha256: "5".repeat(64),
        reason: "reprove the canonical task contract",
        taskBlockHash: value.taskBlockHash,
        taskId: manifestTask.taskId,
      })
    : undefined;
  const reproofRequestPath = resolve(
    value.evidence,
    "reproofs",
    manifestTask.taskId,
    "request.json",
  );
  if (reproofRequest) {
    mkdirSync(resolve(reproofRequestPath, ".."), { recursive: true });
    writeJson(reproofRequestPath, reproofRequest);
  }
  const laneGreen = {
    taskId: manifestTask.taskId,
    headSha: readRecord(value.proofPath).headSha,
    status: "lane_green",
    tranche: manifestTask.tranche,
    ...(reproofRequest
      ? {
          reproof: {
            priorIntegrationHeadSha: reproofRequest.priorIntegrationHeadSha,
            priorIntegrationId: reproofRequest.priorIntegrationId,
            requestPath: reproofRequestPath,
            requestSha256: reproofRequest.requestSha256,
          },
        }
      : {}),
  };
  writeJson(value.lanePath, laneGreen);
  const preIntegrationLaneResultSha256 = sha256File(value.lanePath);
  const selection = planIntegrationWave({
    baseSha: value.baseSha,
    candidates: [
      {
        changedFiles: ["source.ts"],
        gateHeadSha: String(readRecord(value.gatePath).headSha),
        gateSha256: sha256File(value.gatePath),
        headSha: String(readRecord(value.proofPath).headSha),
        laneResultSha256: preIntegrationLaneResultSha256,
        planSha256: value.planSha256,
        proofHeadSha: String(readRecord(value.proofPath).headSha),
        proofSha256: sha256File(value.proofPath),
        ...(reproofRequest
          ? { reproofRequestSha256: reproofRequest.requestSha256 }
          : {}),
        taskBlockHash: value.taskBlockHash,
        taskId: manifestTask.taskId,
        tranche: manifestTask.tranche,
      },
    ],
    completedTaskIds: new Set(),
    integrationId: "wave-000001",
    planSha256: value.planSha256,
    tasks: [plannerTask],
  });
  const selectionPath = resolve(value.evidence, "wave-000001-selection.json");
  const persistedSelection = options?.legacy
    ? (() => {
        const payload = { ...selection } as Record<string, unknown>;
        delete payload.selectionPayloadSha256;
        const legacyPayload = {
          ...payload,
          schemaVersion: "maestro-brain-integration-wave-selection/v2",
        };
        return {
          ...legacyPayload,
          selectionSha256: createHash("sha256")
            .update(JSON.stringify(legacyPayload))
            .digest("hex"),
        };
      })()
    : selection;
  writeJson(selectionPath, persistedSelection);
  const persistedSelectionFileSha256 = selectionFileSha256(
    readFileSync(selectionPath, "utf8"),
  );
  const resultPath = resolve(
    value.evidence,
    "integration",
    selection.integrationId,
    "integration-result.json",
  );
  mkdirSync(resolve(resultPath, ".."), { recursive: true });
  writeJson(value.lanePath, {
    acceptanceBlocker: "external acceptance evidence is not yet present",
    accepted: false,
    taskId: manifestTask.taskId,
    headSha: selection.selectedTasks[0]?.headSha,
    integrationHeadSha: headSha,
    integrationId: selection.integrationId,
    preIntegrationLaneResultSha256,
    ...(reproofRequest ? { reproof: laneGreen.reproof } : {}),
    status: "integrated",
    tranche: manifestTask.tranche,
  });
  writeJson(resultPath, {
    schemaVersion: options?.legacy
      ? "maestro-brain-integration-result/v2"
      : "maestro-brain-integration-result/v3",
    integrationId: selection.integrationId,
    ...(options?.legacy
      ? {
          selectionSha256: String(
            (persistedSelection as Record<string, unknown>).selectionSha256,
          ),
        }
      : {
          selectionFileSha256: persistedSelectionFileSha256,
          selectionPayloadSha256: selection.selectionPayloadSha256,
        }),
    manifestTranches: [manifestTask.tranche],
    integrationWorkdir: realpathSync(value.workdir),
    baseSha: value.baseSha,
    headSha,
    status: "passed",
    reviewVerdict: "pass",
    remainingFindings: [],
    broadGate: {
      status: "passed",
      headSha,
      command: "rtk host-test-slot --class full pnpm verify",
    },
    generatedFiles: [],
    includedTasks: [
      {
        laneHeadSha: selection.selectedTasks[0]?.headSha,
        taskId: manifestTask.taskId,
        tranche: manifestTask.tranche,
      },
    ],
  });
  return {
    ...value,
    headSha,
    integrationId: selection.integrationId,
    resultPath,
    selectionPath,
  };
};

const addLegacyS01Dependency = (value: ReturnType<typeof fixture>): string => {
  const manifest = readRecord(value.manifestPath);
  const tasks = manifest.tasks as Record<string, unknown>[];
  const currentTask = tasks[0];
  if (!currentTask) throw new Error("current task fixture missing");
  currentTask.codeStartAfter = ["S01-T01"];
  tasks.push({
    acceptanceAfter: "S00 complete",
    codeStartAfter: [],
    fileInventoryStatus: "ready",
    fileLocks: ["prior-owned.ts"],
    gateProfiles: ["docs"],
    taskBlockHash: "3".repeat(64),
    taskId: "S01-T01",
    tranche: value.manifestTranche,
  });
  writeJson(value.manifestPath, manifest);
  const dependencyDirectory = resolve(
    value.evidence,
    "lane-results",
    "S01-T01",
  );
  mkdirSync(dependencyDirectory, { recursive: true });
  const dependencyLanePath = resolve(dependencyDirectory, "lane-result.json");
  writeJson(dependencyLanePath, {
    headSha: value.baseSha,
    integrationHeadSha: value.baseSha,
    schemaVersion: "maestro-brain-lane-result/v1",
    status: "integrated",
    taskId: "S01-T01",
    tranche: value.manifestTranche,
  });
  const priorIntegrationId = "C1-contract-spine-prior";
  const priorResultPath = resolve(
    value.evidence,
    "integration",
    priorIntegrationId,
    "integration-result.json",
  );
  mkdirSync(resolve(priorResultPath, ".."), { recursive: true });
  writeJson(priorResultPath, {
    broadGate: {
      command: "rtk host-test-slot --class full pnpm verify",
      headSha: value.baseSha,
      status: "passed",
    },
    headSha: value.baseSha,
    includedTasks: [{ laneHeadSha: value.baseSha, taskId: "S01-T01" }],
    remainingFindings: [],
    reviewVerdict: "pass",
    schemaVersion: "maestro-brain-integration-result/v1",
    status: "passed",
    tranche: priorIntegrationId,
  });
  return dependencyLanePath;
};

const runIntegrationResultCli = (
  value: ReturnType<typeof fixture>,
  extraArguments: readonly string[] = [],
) =>
  spawnSync(
    "rtk",
    [
      "proxy",
      "pnpm",
      "exec",
      "tsx",
      resolve(process.cwd(), "src/integration-result-check.mts"),
      "--control-root",
      value.controlRoot,
      "--workdir",
      value.workdir,
      "--evidence",
      value.evidence,
      "--integration-id",
      value.integrationId,
      "--manifest-tranche",
      value.manifestTranche,
      ...extraArguments,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("normal integration result check", () => {
  it("accepts an exact v3 wave selection and rejects task-set drift", () => {
    const value = waveFixture();
    expect(() =>
      validateIntegrationResult({
        controlRoot: value.controlRoot,
        evidenceDirectory: value.evidence,
        expectedWorkdir: value.workdir,
        integrationId: value.integrationId,
        selectionPath: value.selectionPath,
      }),
    ).not.toThrow();
    expect(
      archiveIntegrationEvidence({
        evidenceDirectory: value.evidence,
        integrationId: value.integrationId,
      }).contentSha256,
    ).toMatch(/^[a-f0-9]{64}$/);
    const result = readRecord(value.resultPath);
    result.includedTasks = [];
    writeJson(value.resultPath, result);
    expect(() =>
      validateIntegrationResult({
        controlRoot: value.controlRoot,
        evidenceDirectory: value.evidence,
        expectedWorkdir: value.workdir,
        integrationId: value.integrationId,
        selectionPath: value.selectionPath,
      }),
    ).toThrow("no included tasks");
  });

  it("rejects v3 payload and file hash mismatches distinctly", () => {
    const value = waveFixture();
    const result = readRecord(value.resultPath);
    result.selectionPayloadSha256 = "a".repeat(64);
    writeJson(value.resultPath, result);
    expect(() =>
      validateIntegrationResult({
        controlRoot: value.controlRoot,
        evidenceDirectory: value.evidence,
        expectedWorkdir: value.workdir,
        integrationId: value.integrationId,
        selectionPath: value.selectionPath,
      }),
    ).toThrow("v3 integration selection payload hash mismatch");

    result.selectionPayloadSha256 = String(
      readRecord(value.selectionPath).selectionPayloadSha256,
    );
    result.selectionFileSha256 = "b".repeat(64);
    writeJson(value.resultPath, result);
    expect(() =>
      validateIntegrationResult({
        controlRoot: value.controlRoot,
        evidenceDirectory: value.evidence,
        expectedWorkdir: value.workdir,
        integrationId: value.integrationId,
        selectionPath: value.selectionPath,
      }),
    ).toThrow("v3 integration selection file hash mismatch");
  });

  it("validates reproof waves with canonical payload hashes", () => {
    const value = waveFixture({ reproof: true });
    expect(() =>
      validateIntegrationResult({
        controlRoot: value.controlRoot,
        evidenceDirectory: value.evidence,
        expectedWorkdir: value.workdir,
        integrationId: value.integrationId,
        selectionPath: value.selectionPath,
      }),
    ).not.toThrow();
  });

  it("rejects reproof lane metadata outside the canonical binding", () => {
    const value = waveFixture({ reproof: true });
    const lane = readRecord(value.lanePath);
    const reproof = lane.reproof as Record<string, unknown>;
    reproof.requestSha256 = "f".repeat(64);
    writeJson(value.lanePath, lane);

    expect(() =>
      validateIntegrationResult({
        controlRoot: value.controlRoot,
        evidenceDirectory: value.evidence,
        expectedWorkdir: value.workdir,
        integrationId: value.integrationId,
        selectionPath: value.selectionPath,
      }),
    ).toThrow("immutable wave selection drift");
  });

  it("hashes selection file identity from raw bytes before UTF-8 decoding", () => {
    const value = waveFixture();
    const selection = readRecord(value.selectionPath);
    const selectedTasks = selection.selectedTasks as Record<string, unknown>[];
    const replacementTranche = "F0-\ufffd";
    selectedTasks[0] = { ...selectedTasks[0], tranche: replacementTranche };
    delete selection.selectionPayloadSha256;
    selection.selectionPayloadSha256 = selectionPayloadSha256(selection);
    writeJson(value.selectionPath, selection);

    const manifest = readRecord(value.manifestPath);
    const manifestTask = (manifest.tasks as Record<string, unknown>[])[0];
    if (!manifestTask) throw new Error("fixture manifest task missing");
    manifestTask.tranche = replacementTranche;
    writeJson(value.manifestPath, manifest);
    const lane = readRecord(value.lanePath);
    lane.tranche = replacementTranche;
    writeJson(value.lanePath, lane);
    const result = readRecord(value.resultPath);
    result.manifestTranches = [replacementTranche];
    const includedTask = (result.includedTasks as Record<string, unknown>[])[0];
    if (!includedTask) throw new Error("fixture included task missing");
    includedTask.tranche = replacementTranche;
    result.selectionPayloadSha256 = selection.selectionPayloadSha256;
    const validBytes = readFileSync(value.selectionPath);
    result.selectionFileSha256 = createHash("sha256")
      .update(validBytes)
      .digest("hex");
    writeJson(value.resultPath, result);

    const marker = Buffer.from("\ufffd");
    const offset = validBytes.indexOf(marker);
    expect(offset).toBeGreaterThanOrEqual(0);
    const invalidBytes = Buffer.concat([
      validBytes.subarray(0, offset),
      Buffer.from([0xff]),
      validBytes.subarray(offset + marker.length),
    ]);
    expect(invalidBytes.toString("utf8")).toBe(validBytes.toString("utf8"));
    writeFileSync(value.selectionPath, invalidBytes);

    expect(() =>
      validateIntegrationResult({
        controlRoot: value.controlRoot,
        evidenceDirectory: value.evidence,
        expectedWorkdir: value.workdir,
        integrationId: value.integrationId,
        selectionPath: value.selectionPath,
      }),
    ).toThrow("v3 integration selection file hash mismatch");
  });

  it("rejects ambiguous legacy hash fields in a v3 result", () => {
    const value = waveFixture();
    const result = readRecord(value.resultPath);
    result.selectionSha256 = result.selectionPayloadSha256;
    writeJson(value.resultPath, result);
    expect(() =>
      validateIntegrationResult({
        controlRoot: value.controlRoot,
        evidenceDirectory: value.evidence,
        expectedWorkdir: value.workdir,
        integrationId: value.integrationId,
        selectionPath: value.selectionPath,
      }),
    ).toThrow("v3 integration result contains an ambiguous selection hash");
  });

  it("retains archived v2 selection reads through the legacy boundary", () => {
    const value = waveFixture({ legacy: true });
    expect(() =>
      validateIntegrationResult({
        controlRoot: value.controlRoot,
        evidenceDirectory: value.evidence,
        expectedWorkdir: value.workdir,
        integrationId: value.integrationId,
        selectionPath: value.selectionPath,
      }),
    ).not.toThrow();
  });

  it("honors the immutable selected gate across later policy drift", () => {
    const value = waveFixture();
    const gate = readRecord(value.gatePath);
    const historicalCommands = [
      { program: "pnpm", args: ["--dir", "packages/search", "typecheck"] },
    ];
    gate.commands = historicalCommands.map(
      (command) => `rtk ${command.program} ${command.args.join(" ")}`,
    );
    gate.commandSetHash = gateCommandSetHash(historicalCommands);
    writeJson(value.gatePath, gate);

    const selection = readRecord(value.selectionPath);
    const selectedTask = (
      selection.selectedTasks as Record<string, unknown>[]
    )[0];
    if (!selectedTask) throw new Error("fixture wave task missing");
    selectedTask.gateSha256 = sha256File(value.gatePath);
    const selectionPayload = { ...selection };
    delete selectionPayload.selectionPayloadSha256;
    selection.selectionPayloadSha256 = selectionPayloadSha256(selectionPayload);
    writeJson(value.selectionPath, selection);
    const result = readRecord(value.resultPath);
    result.selectionPayloadSha256 = selection.selectionPayloadSha256;
    result.selectionFileSha256 = selectionFileSha256(
      readFileSync(value.selectionPath, "utf8"),
    );
    writeJson(value.resultPath, result);

    expect(() =>
      validateIntegrationResult({
        controlRoot: value.controlRoot,
        evidenceDirectory: value.evidence,
        expectedWorkdir: value.workdir,
        integrationId: value.integrationId,
        selectionPath: value.selectionPath,
      }),
    ).not.toThrow();

    gate.commands = [
      ...(gate.commands as string[]),
      "rtk pnpm check:confect-v9",
    ];
    writeJson(value.gatePath, gate);
    expect(() =>
      validateIntegrationResult({
        controlRoot: value.controlRoot,
        evidenceDirectory: value.evidence,
        expectedWorkdir: value.workdir,
        integrationId: value.integrationId,
        selectionPath: value.selectionPath,
      }),
    ).toThrow("immutable wave selection drift");
  });

  it("rejects v2 remaining findings and missing lane-head provenance", () => {
    const value = waveFixture();
    const result = readRecord(value.resultPath);
    result.remainingFindings = [{ id: "still-open", severity: "high" }];
    writeJson(value.resultPath, result);
    expect(() =>
      validateIntegrationResult({
        controlRoot: value.controlRoot,
        evidenceDirectory: value.evidence,
        expectedWorkdir: value.workdir,
        integrationId: value.integrationId,
        selectionPath: value.selectionPath,
      }),
    ).toThrow("remaining findings");

    result.remainingFindings = [];
    result.includedTasks = [
      { taskId: "S09-T01", tranche: "C1-contract-spine" },
    ];
    writeJson(value.resultPath, result);
    expect(() =>
      validateIntegrationResult({
        controlRoot: value.controlRoot,
        evidenceDirectory: value.evidence,
        expectedWorkdir: value.workdir,
        integrationId: value.integrationId,
        selectionPath: value.selectionPath,
      }),
    ).toThrow("included laneHeadSha");
  });

  it("rejects v2 non-lane integration files and generated receipt drift", () => {
    const value = waveFixture();
    writeFileSync(
      resolve(value.workdir, "extra.ts"),
      "export const extra = true;\n",
    );
    command(value.workdir, "add", "extra.ts");
    command(
      value.workdir,
      "commit",
      "-qm",
      "test: add unowned integration file",
    );
    const result = readRecord(value.resultPath);
    const headSha = command(value.workdir, "rev-parse", "HEAD");
    result.headSha = headSha;
    result.broadGate = {
      status: "passed",
      headSha,
      command: "rtk host-test-slot --class full pnpm verify",
    };
    const lane = readRecord(value.lanePath);
    lane.integrationHeadSha = headSha;
    writeJson(value.lanePath, lane);
    writeJson(value.resultPath, result);
    expect(() =>
      validateIntegrationResult({
        controlRoot: value.controlRoot,
        evidenceDirectory: value.evidence,
        expectedWorkdir: value.workdir,
        integrationId: value.integrationId,
        selectionPath: value.selectionPath,
      }),
    ).toThrow("non-lane, non-generated files");
  });

  it("allows only recorded recovery commit files outside lane ownership", () => {
    const value = waveFixture();
    writeFileSync(
      resolve(value.workdir, "repair.ts"),
      "export const repaired = true;\n",
    );
    command(value.workdir, "add", "repair.ts");
    command(value.workdir, "commit", "-qm", "fix: repair integration");
    const repairSha = command(value.workdir, "rev-parse", "HEAD");
    const result = readRecord(value.resultPath);
    result.mode = "recover";
    result.headSha = repairSha;
    result.broadGate = {
      status: "passed",
      headSha: repairSha,
      command: "rtk host-test-slot --class full pnpm verify",
    };
    result.repairCommits = [
      {
        sha: repairSha,
        summary: "Reviewed repair",
        taskId: "integration-recovery",
      },
    ];
    writeJson(value.resultPath, result);
    const lane = readRecord(value.lanePath);
    lane.integrationHeadSha = repairSha;
    writeJson(value.lanePath, lane);

    expect(() =>
      validateIntegrationResult({
        controlRoot: value.controlRoot,
        evidenceDirectory: value.evidence,
        expectedWorkdir: value.workdir,
        integrationId: value.integrationId,
        selectionPath: value.selectionPath,
      }),
    ).not.toThrow();

    result.repairCommits = [];
    writeJson(value.resultPath, result);
    expect(() =>
      validateIntegrationResult({
        controlRoot: value.controlRoot,
        evidenceDirectory: value.evidence,
        expectedWorkdir: value.workdir,
        integrationId: value.integrationId,
        selectionPath: value.selectionPath,
      }),
    ).toThrow("non-lane, non-generated files");
  });
  it("accepts exact integration-owned generated output", () => {
    const value = waveFixture();
    const generatedFile =
      "packages/template-core/src/generated/confectManifest.ts";
    mkdirSync(resolve(value.workdir, "packages/template-core/src/generated"), {
      recursive: true,
    });
    writeFileSync(
      resolve(value.workdir, generatedFile),
      "export const generated = true;\n",
    );
    command(value.workdir, "add", generatedFile);
    command(value.workdir, "commit", "-qm", "test: add generated output");
    const headSha = command(value.workdir, "rev-parse", "HEAD");
    const result = readRecord(value.resultPath);
    result.headSha = headSha;
    result.generatedFiles = [generatedFile];
    result.broadGate = {
      status: "passed",
      headSha,
      command: "rtk host-test-slot --class full pnpm verify",
    };
    writeJson(value.resultPath, result);
    const lane = readRecord(value.lanePath);
    lane.integrationHeadSha = headSha;
    writeJson(value.lanePath, lane);
    expect(() =>
      validateIntegrationResult({
        controlRoot: value.controlRoot,
        evidenceDirectory: value.evidence,
        expectedWorkdir: value.workdir,
        integrationId: value.integrationId,
        selectionPath: value.selectionPath,
      }),
    ).not.toThrow();
  });
  it("rejects an arbitrary file in a generated namespace", () => {
    const value = waveFixture();
    const generatedFile = "packages/convex/convex/backdoor.ts";
    writeFileSync(
      resolve(value.workdir, generatedFile),
      "export const pwn = true;\n",
    );
    command(value.workdir, "add", generatedFile);
    command(value.workdir, "commit", "-qm", "test: add fake generated output");
    const headSha = command(value.workdir, "rev-parse", "HEAD");
    const result = readRecord(value.resultPath);
    result.headSha = headSha;
    result.generatedFiles = [generatedFile];
    result.broadGate = {
      status: "passed",
      headSha,
      command: "rtk host-test-slot --class full pnpm verify",
    };
    writeJson(value.resultPath, result);
    const lane = readRecord(value.lanePath);
    lane.integrationHeadSha = headSha;
    writeJson(value.lanePath, lane);
    expect(() =>
      validateIntegrationResult({
        controlRoot: value.controlRoot,
        evidenceDirectory: value.evidence,
        expectedWorkdir: value.workdir,
        integrationId: value.integrationId,
        selectionPath: value.selectionPath,
      }),
    ).toThrow("non-lane, non-generated files");
  });
  it("accepts an exact passed head and integrated lane", () => {
    const value = fixture();
    expect(() =>
      validateIntegrationResult({
        controlRoot: value.controlRoot,
        evidenceDirectory: value.evidence,
        expectedWorkdir: value.workdir,
        integrationId: value.integrationId,
        manifestTranche: value.manifestTranche,
      }),
    ).not.toThrow();
  });

  it("rejects legacy integrated records without explicit acceptance state", () => {
    const value = fixture();
    const lane = readRecord(value.lanePath);
    delete lane.accepted;
    delete lane.acceptanceBlocker;
    writeJson(value.lanePath, lane);
    expect(() =>
      validateIntegrationResult({
        controlRoot: value.controlRoot,
        evidenceDirectory: value.evidence,
        expectedWorkdir: value.workdir,
        integrationId: value.integrationId,
        manifestTranche: value.manifestTranche,
      }),
    ).toThrow(/migrate and re-prove legacy records/);
  });

  it("archives final integration evidence by content hash and rejects drift", () => {
    const value = fixture();
    validateIntegrationResult({
      controlRoot: value.controlRoot,
      evidenceDirectory: value.evidence,
      expectedWorkdir: value.workdir,
      integrationId: value.integrationId,
      manifestTranche: value.manifestTranche,
    });
    const archived = archiveIntegrationEvidence({
      evidenceDirectory: value.evidence,
      integrationId: value.integrationId,
      manifestTranche: value.manifestTranche,
    });
    expect(archived.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(archived.artifactPath).toContain(archived.contentSha256);
    expect(existsSync(archived.artifactPath)).toBe(true);
    expect(existsSync(archived.manifestPath)).toBe(true);
    expect(
      archiveIntegrationEvidence({
        evidenceDirectory: value.evidence,
        integrationId: value.integrationId,
        manifestTranche: value.manifestTranche,
      }),
    ).toEqual(archived);

    const proof = readRecord(value.proofPath);
    proof.archiveDrift = true;
    writeJson(value.proofPath, proof);
    expect(() =>
      archiveIntegrationEvidence({
        evidenceDirectory: value.evidence,
        integrationId: value.integrationId,
        manifestTranche: value.manifestTranche,
      }),
    ).toThrow("archived evidence drift");
  });

  it("rejects archive path traversal identities", () => {
    const value = fixture();
    expect(() =>
      archiveIntegrationEvidence({
        evidenceDirectory: value.evidence,
        integrationId: "..",
        manifestTranche: value.manifestTranche,
      }),
    ).toThrow("integrationId is not a safe path segment");
  });

  it("rejects integration identity and head drift", () => {
    const value = fixture();
    const result = readRecord(value.resultPath);
    result.integrationId = "C1-contract-spine-w3";
    writeJson(value.resultPath, result);
    expect(() =>
      validateIntegrationResult({
        controlRoot: value.controlRoot,
        evidenceDirectory: value.evidence,
        expectedWorkdir: value.workdir,
        integrationId: value.integrationId,
        manifestTranche: value.manifestTranche,
      }),
    ).toThrow("integrationId mismatch");
  });

  it("rejects a broad gate not bound to the exact head", () => {
    const value = fixture();
    const result = readRecord(value.resultPath);
    result.broadGate = {
      status: "passed",
      headSha: "wrong-head",
      command: "rtk host-test-slot --class full pnpm verify",
    };
    writeJson(value.resultPath, result);
    expect(() =>
      validateIntegrationResult({
        controlRoot: value.controlRoot,
        evidenceDirectory: value.evidence,
        expectedWorkdir: value.workdir,
        integrationId: value.integrationId,
        manifestTranche: value.manifestTranche,
      }),
    ).toThrow("broad gate receipt does not prove this head");
  });

  it("rejects lane evidence not bound to the integration attempt", () => {
    const value = fixture();
    const lane = readRecord(value.lanePath);
    lane.integrationId = "C1-contract-spine";
    writeJson(value.lanePath, lane);
    expect(() =>
      validateIntegrationResult({
        controlRoot: value.controlRoot,
        evidenceDirectory: value.evidence,
        expectedWorkdir: value.workdir,
        integrationId: value.integrationId,
        manifestTranche: value.manifestTranche,
      }),
    ).toThrow("S09-T01: integrationId mismatch");
  });

  it("rejects a proof that omits a changed file", () => {
    const value = fixture();
    const proof = readRecord(value.proofPath);
    proof.changedFiles = ["integration.ts"];
    writeJson(value.proofPath, proof);
    expect(() =>
      validateIntegrationResult({
        controlRoot: value.controlRoot,
        evidenceDirectory: value.evidence,
        expectedWorkdir: value.workdir,
        integrationId: value.integrationId,
        manifestTranche: value.manifestTranche,
      }),
    ).toThrow("S09-T01: proof changedFiles do not match the task diff");
  });

  it("rejects a lane diff outside its exact manifest locks", () => {
    const value = fixture();
    const manifest = readRecord(value.manifestPath);
    const tasks = manifest.tasks as Array<Record<string, unknown>>;
    tasks[0] = { ...tasks[0], fileLocks: ["another-source.ts"] };
    writeJson(value.manifestPath, manifest);
    expect(() =>
      validateIntegrationResult({
        controlRoot: value.controlRoot,
        evidenceDirectory: value.evidence,
        expectedWorkdir: value.workdir,
        integrationId: value.integrationId,
        manifestTranche: value.manifestTranche,
      }),
    ).toThrow("S09-T01: source.ts: not declared in manifest fileLocks");
  });

  it("rejects an integrated task whose lifecycle record remains a stub", () => {
    const value = fixture();
    const recordPath =
      "docs/product/maestro-brain-lifecycle-adoption/S09-T01.md";
    const manifest = readRecord(value.manifestPath);
    const tasks = manifest.tasks as Array<Record<string, unknown>>;
    tasks[0] = { ...tasks[0], fileLocks: ["source.ts", recordPath] };
    writeJson(value.manifestPath, manifest);
    const absoluteRecordPath = resolve(value.workdir, recordPath);
    mkdirSync(resolve(absoluteRecordPath, ".."), { recursive: true });
    writeFileSync(
      absoluteRecordPath,
      "# S09-T01 Lifecycle Adoption Record\n\n**Owner:** S09-T01  \n**State:** task-owned stub\n",
    );
    command(value.workdir, "add", recordPath);
    command(
      value.workdir,
      "commit",
      "-qm",
      "test: preserve stale lifecycle record",
    );
    const stubHeadSha = command(value.workdir, "rev-parse", "HEAD");
    const result = readRecord(value.resultPath);
    result.headSha = stubHeadSha;
    result.broadGate = {
      status: "passed",
      headSha: stubHeadSha,
      command: "rtk host-test-slot --class full pnpm verify",
    };
    writeJson(value.resultPath, result);
    const lane = readRecord(value.lanePath);
    lane.integrationHeadSha = stubHeadSha;
    writeJson(value.lanePath, lane);

    expect(() =>
      validateIntegrationResult({
        controlRoot: value.controlRoot,
        evidenceDirectory: value.evidence,
        expectedWorkdir: value.workdir,
        integrationId: value.integrationId,
        manifestTranche: value.manifestTranche,
      }),
    ).toThrow("S09-T01: lifecycle adoption record remains a task-owned stub");
  });

  it("rejects proof schema and task-block drift", () => {
    const value = fixture();
    const original = readRecord(value.proofPath);
    const cases = [
      ["schemaVersion", "legacy", "unexpected CI proof schema"],
      ["taskBlockHash", "stale", "proof task block hash mismatch"],
    ] as const;
    for (const [field, replacement, message] of cases) {
      writeJson(value.proofPath, { ...original, [field]: replacement });
      expect(() =>
        validateIntegrationResult({
          controlRoot: value.controlRoot,
          evidenceDirectory: value.evidence,
          expectedWorkdir: value.workdir,
          integrationId: value.integrationId,
          manifestTranche: value.manifestTranche,
        }),
      ).toThrow(message);
    }
    writeJson(value.proofPath, original);
  });

  it("accepts prior plan provenance when the task block is unchanged", () => {
    const value = fixture();
    const manifest = readRecord(value.manifestPath);
    manifest.planSha256 = "new-global-plan";
    writeJson(value.manifestPath, manifest);

    expect(() =>
      validateIntegrationResult({
        controlRoot: value.controlRoot,
        evidenceDirectory: value.evidence,
        expectedWorkdir: value.workdir,
        integrationId: value.integrationId,
        manifestTranche: value.manifestTranche,
      }),
    ).not.toThrow();
  });

  it("rejects final gates with mismatched plan provenance", () => {
    const value = fixture();
    const gate = readRecord(value.gatePath);
    gate.planSha256 = "stale";
    writeJson(value.gatePath, gate);
    expect(() =>
      validateIntegrationResult({
        controlRoot: value.controlRoot,
        evidenceDirectory: value.evidence,
        expectedWorkdir: value.workdir,
        integrationId: value.integrationId,
        manifestTranche: value.manifestTranche,
      }),
    ).toThrow("final lane gate does not bind the lane head");
  });

  it("rejects final gates with a mismatched task block", () => {
    const value = fixture();
    const gate = readRecord(value.gatePath);
    gate.taskBlockHash = "stale";
    writeJson(value.gatePath, gate);
    expect(() =>
      validateIntegrationResult({
        controlRoot: value.controlRoot,
        evidenceDirectory: value.evidence,
        expectedWorkdir: value.workdir,
        integrationId: value.integrationId,
        manifestTranche: value.manifestTranche,
      }),
    ).toThrow("final lane gate does not bind the lane head");
  });

  it("rejects a task outside the manifest tranche", () => {
    const value = fixture();
    writeJson(value.manifestPath, {
      schemaVersion: "maestro-brain-task-manifest/v1",
      planSha256: value.planSha256,
      tasks: [
        {
          taskId: "S09-T01",
          taskBlockHash: value.taskBlockHash,
          tranche: "D2-domain-bodies",
          codeStartAfter: [],
          fileInventoryStatus: "ready",
          fileLocks: ["source.ts"],
          gateProfiles: ["docs"],
        },
      ],
    });
    expect(() =>
      validateIntegrationResult({
        controlRoot: value.controlRoot,
        evidenceDirectory: value.evidence,
        expectedWorkdir: value.workdir,
        integrationId: value.integrationId,
        manifestTranche: value.manifestTranche,
      }),
    ).toThrow("S09-T01: task manifest tranche mismatch");
  });

  it("rejects stale proof and final-gate chains", () => {
    const value = fixture();
    const proof = readRecord(value.proofPath);
    proof.reviewVerdict = "rework";
    writeJson(value.proofPath, proof);
    expect(() =>
      validateIntegrationResult({
        controlRoot: value.controlRoot,
        evidenceDirectory: value.evidence,
        expectedWorkdir: value.workdir,
        integrationId: value.integrationId,
        manifestTranche: value.manifestTranche,
      }),
    ).toThrow("S09-T01: proof does not bind a reviewed passing lane head");

    proof.reviewVerdict = "pass";
    writeJson(value.proofPath, proof);
    const gate = readRecord(value.gatePath);
    gate.currentHeadSha = "stale-head";
    writeJson(value.gatePath, gate);
    expect(() =>
      validateIntegrationResult({
        controlRoot: value.controlRoot,
        evidenceDirectory: value.evidence,
        expectedWorkdir: value.workdir,
        integrationId: value.integrationId,
        manifestTranche: value.manifestTranche,
      }),
    ).toThrow("S09-T01: final lane gate does not bind the lane head");
  });

  it("rejects an unsatisfied code-start dependency", () => {
    const value = fixture();
    writeJson(value.manifestPath, {
      schemaVersion: "maestro-brain-task-manifest/v1",
      planSha256: value.planSha256,
      tasks: [
        {
          taskId: "S09-T01",
          taskBlockHash: value.taskBlockHash,
          tranche: value.manifestTranche,
          codeStartAfter: ["S08-T01"],
          fileInventoryStatus: "ready",
          fileLocks: ["source.ts"],
          gateProfiles: ["docs"],
        },
      ],
    });
    expect(() =>
      validateIntegrationResult({
        controlRoot: value.controlRoot,
        evidenceDirectory: value.evidence,
        expectedWorkdir: value.workdir,
        integrationId: value.integrationId,
        manifestTranche: value.manifestTranche,
      }),
    ).toThrow("S09-T01: dependency S08-T01 has no lane result");
  });

  it("trusts prior v2 integration provenance after legitimate later edits", () => {
    const value = fixture();
    const manifest = readRecord(value.manifestPath);
    const tasks = manifest.tasks as Record<string, unknown>[];
    const currentTask = tasks[0];
    if (!currentTask) throw new Error("current task fixture missing");
    currentTask.codeStartAfter = ["S08-T01"];
    tasks.push({
      codeStartAfter: [],
      fileInventoryStatus: "ready",
      fileLocks: ["prior-owned-doc.md"],
      gateProfiles: ["docs"],
      taskBlockHash: "3".repeat(64),
      taskId: "S08-T01",
      tranche: "D2-domain-bodies",
    });
    writeJson(value.manifestPath, manifest);
    const dependencyLaneDirectory = resolve(
      value.evidence,
      "lane-results",
      "S08-T01",
    );
    mkdirSync(dependencyLaneDirectory, { recursive: true });
    writeJson(resolve(dependencyLaneDirectory, "lane-result.json"), {
      acceptanceBlocker: "external acceptance evidence is pending",
      accepted: false,
      headSha: value.baseSha,
      integrationHeadSha: value.baseSha,
      integrationId: "D2-domain-bodies-w1",
      status: "integrated",
      taskId: "S08-T01",
      tranche: "D2-domain-bodies",
    });
    const priorResultPath = resolve(
      value.evidence,
      "integration",
      "D2-domain-bodies-w1",
      "integration-result.json",
    );
    mkdirSync(resolve(priorResultPath, ".."), { recursive: true });
    writeJson(priorResultPath, {
      broadGate: {
        command: "rtk host-test-slot --class full pnpm verify",
        headSha: value.baseSha,
        status: "passed",
      },
      headSha: value.baseSha,
      includedTasks: [{ laneHeadSha: value.baseSha, taskId: "S08-T01" }],
      integrationId: "D2-domain-bodies-w1",
      remainingFindings: [],
      reviewVerdict: "pass",
      schemaVersion: "maestro-brain-integration-result/v2",
      status: "passed",
    });
    expect(() =>
      validateIntegrationResult({
        controlRoot: value.controlRoot,
        evidenceDirectory: value.evidence,
        expectedWorkdir: value.workdir,
        integrationId: value.integrationId,
        manifestTranche: value.manifestTranche,
      }),
    ).not.toThrow();

    const prior = readRecord(priorResultPath);
    prior.includedTasks = [{ laneHeadSha: "c".repeat(40), taskId: "S08-T01" }];
    writeJson(priorResultPath, prior);
    expect(() =>
      validateIntegrationResult({
        controlRoot: value.controlRoot,
        evidenceDirectory: value.evidence,
        expectedWorkdir: value.workdir,
        integrationId: value.integrationId,
        manifestTranche: value.manifestTranche,
      }),
    ).toThrow(/not bound by its authoritative integration result/);
  });

  it("adopts the historical S01-T01 prerequisite before checking S01-T02", () => {
    const value = fixture({ taskId: "S01-T02" });
    addLegacyS01Dependency(value);
    const priorIntegrationId = "C1-contract-spine-prior";
    expect(
      adoptLegacyIntegratedLaneEvidence({
        controlRoot: value.controlRoot,
        currentHeadSha: value.headSha,
        evidenceDirectory: value.evidence,
        workdir: value.workdir,
      }),
    ).toEqual([{ integrationId: priorIntegrationId, taskId: "S01-T01" }]);
    expect(() =>
      validateIntegrationResult({
        controlRoot: value.controlRoot,
        evidenceDirectory: value.evidence,
        expectedWorkdir: value.workdir,
        integrationId: value.integrationId,
        manifestTranche: value.manifestTranche,
      }),
    ).not.toThrow();
  });

  it("keeps the default CLI read-only and adopts only with the explicit flag", () => {
    const value = fixture({ taskId: "S01-T02" });
    const dependencyLanePath = addLegacyS01Dependency(value);
    const before = readFileSync(dependencyLanePath, "utf8");

    const readOnly = runIntegrationResultCli(value);
    expect(readOnly.status).not.toBe(0);
    expect(readFileSync(dependencyLanePath, "utf8")).toBe(before);

    const adopting = runIntegrationResultCli(value, [
      "--adopt-legacy-evidence",
    ]);
    expect(adopting.status, adopting.stderr).toBe(0);
    expect(readRecord(dependencyLanePath)).toMatchObject({
      accepted: false,
      integrationId: "C1-contract-spine-prior",
      status: "integrated",
    });
  });

  it("preflights malformed result identity before CLI adoption", () => {
    const value = fixture({ taskId: "S01-T02" });
    const dependencyLanePath = addLegacyS01Dependency(value);
    const before = readFileSync(dependencyLanePath, "utf8");
    const result = readRecord(value.resultPath);
    result.integrationId = "wrong-integration";
    writeJson(value.resultPath, result);

    const malformed = runIntegrationResultCli(value, [
      "--adopt-legacy-evidence",
    ]);
    expect(malformed.status).not.toBe(0);
    expect(readFileSync(dependencyLanePath, "utf8")).toBe(before);
  });

  it("rejects unsafe CLI integration IDs before adoption", () => {
    const value = fixture({ taskId: "S01-T02" });
    const dependencyLanePath = addLegacyS01Dependency(value);
    const before = readFileSync(dependencyLanePath, "utf8");

    const malformed = runIntegrationResultCli(
      { ...value, integrationId: "../wrong-integration" },
      ["--adopt-legacy-evidence"],
    );
    expect(malformed.status).not.toBe(0);
    expect(readFileSync(dependencyLanePath, "utf8")).toBe(before);
  });

  it("rejects conflicting included-task locks", () => {
    const value = fixture();
    writeJson(value.manifestPath, {
      schemaVersion: "maestro-brain-task-manifest/v1",
      planSha256: value.planSha256,
      tasks: [
        {
          taskId: "S09-T01",
          taskBlockHash: value.taskBlockHash,
          tranche: value.manifestTranche,
          codeStartAfter: [],
          fileInventoryStatus: "ready",
          fileLocks: ["source.ts"],
          gateProfiles: ["docs"],
        },
        {
          taskId: "S09-T02",
          taskBlockHash: "3".repeat(64),
          tranche: value.manifestTranche,
          codeStartAfter: [],
          fileInventoryStatus: "ready",
          fileLocks: ["source.ts"],
          gateProfiles: ["docs"],
        },
      ],
    });
    const result = readRecord(value.resultPath);
    result.includedTasks = [{ taskId: "S09-T01" }, { taskId: "S09-T02" }];
    writeJson(value.resultPath, result);
    expect(() =>
      validateIntegrationResult({
        controlRoot: value.controlRoot,
        evidenceDirectory: value.evidence,
        expectedWorkdir: value.workdir,
        integrationId: value.integrationId,
        manifestTranche: value.manifestTranche,
      }),
    ).toThrow("S09-T02: file lock source.ts conflicts with S09-T01");
  });

  it("rejects a dirty integration worktree", () => {
    const value = fixture();
    writeFileSync(resolve(value.workdir, "dirty.txt"), "dirty\n");
    expect(() =>
      validateIntegrationResult({
        controlRoot: value.controlRoot,
        evidenceDirectory: value.evidence,
        expectedWorkdir: value.workdir,
        integrationId: value.integrationId,
        manifestTranche: value.manifestTranche,
      }),
    ).toThrow("integration worktree is not clean");
  });
});
