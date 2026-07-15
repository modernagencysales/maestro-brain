import { execFileSync } from "node:child_process";
import {
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
import { gateCommandSetHash } from "../src/lane-gate-cache.js";

const temporaryDirectories: string[] = [];

const command = (directory: string, ...args: string[]): string =>
  execFileSync("rtk", ["proxy", "git", ...args], {
    cwd: directory,
    encoding: "utf8",
  }).trim();

const writeJson = (path: string, value: unknown): void =>
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

const fixture = () => {
  const root = mkdtempSync(resolve(tmpdir(), "brain-integration-check-"));
  temporaryDirectories.push(root);
  const workdir = resolve(root, "integration");
  const evidence = resolve(root, "evidence");
  const integrationId = "C1-contract-spine-w2";
  const manifestTranche = "C1-contract-spine";
  const taskId = "S09-T01";
  const manifestDirectory = resolve(
    root,
    "docs/superpowers/execution/maestro-brain",
  );
  mkdirSync(manifestDirectory, { recursive: true });
  const manifestPath = resolve(manifestDirectory, "task-manifest.json");
  writeJson(manifestPath, {
    tasks: [
      {
        taskId,
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
  command(workdir, "config", "user.email", "brain@example.test");
  command(workdir, "config", "user.name", "Brain Test");
  writeFileSync(resolve(workdir, "source.ts"), "export const ready = false;\n");
  command(workdir, "add", "source.ts");
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
    broadGate: {
      status: "passed",
      headSha,
      command: "rtk host-test-slot --class full pnpm verify",
    },
    includedTasks: [{ taskId }],
  });
  writeJson(lanePath, {
    taskId,
    headSha: laneHeadSha,
    status: "integrated",
    integrationHeadSha: headSha,
    integrationId,
    tranche: manifestTranche,
  });
  const proofPath = resolve(laneDirectory, "ci-proof-packet.json");
  writeJson(proofPath, {
    taskId,
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
    commandSetHash: gateCommandSetHash(gateCommands),
    commands: gateCommands.map(
      (gateCommand) =>
        `rtk ${gateCommand.program} ${gateCommand.args.join(" ")}`,
    ),
    stage: "final",
    status: "passed",
  });
  return {
    controlRoot: root,
    evidence,
    headSha,
    integrationId,
    gatePath,
    lanePath,
    manifestPath,
    manifestTranche,
    proofPath,
    resultPath,
    workdir,
  };
};

const readRecord = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("normal integration result check", () => {
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

  it("rejects a task outside the manifest tranche", () => {
    const value = fixture();
    writeJson(value.manifestPath, {
      tasks: [
        {
          taskId: "S09-T01",
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
      tasks: [
        {
          taskId: "S09-T01",
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

  it("rejects conflicting included-task locks", () => {
    const value = fixture();
    writeJson(value.manifestPath, {
      tasks: [
        {
          taskId: "S09-T01",
          tranche: value.manifestTranche,
          codeStartAfter: [],
          fileInventoryStatus: "ready",
          fileLocks: ["source.ts"],
          gateProfiles: ["docs"],
        },
        {
          taskId: "S09-T02",
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
