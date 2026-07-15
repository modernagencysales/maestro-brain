import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { adoptLegacyIntegratedLaneEvidence } from "../src/lane-evidence-adoption.js";
import { validateLaneAcceptance } from "../src/lane-acceptance.js";

const roots: string[] = [];
const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
const writeJson = (path: string, value: unknown): void =>
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const readRecord = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

const fixture = (input?: {
  readonly acceptanceAfter?: string;
  readonly integrationId?: string;
  readonly laneAccepted?: boolean;
  readonly laneAcceptanceBlocker?: string;
  readonly laneIntegrationId?: string;
  readonly laneTranche?: string;
  readonly manifestTranche?: string;
  readonly resultUsesExplicitId?: boolean;
  readonly taskId?: string;
}): {
  readonly evidence: string;
  readonly lanePath: string;
  readonly resultPath: string;
  readonly root: string;
  readonly taskId: string;
} => {
  const root = mkdtempSync(resolve(tmpdir(), "brain-lane-adoption-"));
  roots.push(root);
  const evidence = resolve(root, "evidence");
  const taskId = input?.taskId ?? "S01-T01";
  const integrationId = input?.integrationId ?? "C1-contract-spine";
  const manifestTranche =
    input?.manifestTranche ??
    (taskId === "S13-T01" ? "X3-convergence" : integrationId);
  const laneHeadSha = "1".repeat(40);
  const integrationHeadSha = "2".repeat(40);
  const manifestDirectory = resolve(
    root,
    "docs/superpowers/execution/maestro-brain",
  );
  mkdirSync(manifestDirectory, { recursive: true });
  writeJson(resolve(manifestDirectory, "task-manifest.json"), {
    schemaVersion: "maestro-brain-task-manifest/v1",
    planSha256: "3".repeat(64),
    tasks: [
      {
        acceptanceAfter: input?.acceptanceAfter ?? "S00 complete",
        codeStartAfter: [],
        fileInventoryStatus: "ready",
        fileLocks: ["source.ts"],
        gateProfiles: ["docs"],
        taskBlockHash: "4".repeat(64),
        taskId,
        tranche: manifestTranche,
      },
    ],
  });
  const laneDirectory = resolve(evidence, "lane-results", taskId);
  const integrationDirectory = resolve(evidence, "integration", integrationId);
  mkdirSync(laneDirectory, { recursive: true });
  mkdirSync(integrationDirectory, { recursive: true });
  const lanePath = resolve(laneDirectory, "lane-result.json");
  const resultPath = resolve(integrationDirectory, "integration-result.json");
  writeJson(lanePath, {
    ...(input?.laneAcceptanceBlocker
      ? { acceptanceBlocker: input.laneAcceptanceBlocker }
      : {}),
    ...(input?.laneAccepted === undefined
      ? {}
      : { accepted: input.laneAccepted }),
    headSha: laneHeadSha,
    ...(input?.laneIntegrationId
      ? { integrationId: input.laneIntegrationId }
      : {}),
    integrationHeadSha,
    schemaVersion: "maestro-brain-lane-result/v1",
    status: "integrated",
    taskId,
    tranche: input?.laneTranche ?? manifestTranche,
  });
  writeJson(resultPath, {
    broadGate: {
      command: "rtk host-test-slot --class full pnpm verify",
      headSha: integrationHeadSha,
      status: "passed",
    },
    headSha: integrationHeadSha,
    includedTasks: [{ laneHeadSha, taskId }],
    ...(input?.resultUsesExplicitId ? { integrationId } : {}),
    integrationWorkdir: root,
    remainingFindings: [],
    reviewVerdict: "pass",
    schemaVersion: "maestro-brain-integration-result/v1",
    status: "passed",
    tranche: integrationId,
  });
  return { evidence, lanePath, resultPath, root, taskId };
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("legacy integrated lane evidence adoption", () => {
  const realLegacyMappings = [
    {
      acceptanceAfter: "S00-T01",
      integrationId: "F0-foundation",
      laneAccepted: false,
      laneAcceptanceBlocker:
        "S00-T01 three-host Convex plugin attestation is not present",
      manifestTranche: "F0-foundation",
      resultUsesExplicitId: true,
      taskId: "S00-T02",
    },
    {
      acceptanceAfter: "S00 complete",
      integrationId: "C1-contract-spine",
      manifestTranche: "C1-contract-spine",
      taskId: "S01-T01",
    },
    {
      acceptanceAfter: "S01 complete",
      integrationId: "C1-contract-spine",
      manifestTranche: "C1-contract-spine",
      taskId: "S02-T01",
    },
    {
      acceptanceAfter: "S02 complete",
      integrationId: "C1-contract-spine",
      manifestTranche: "C1-contract-spine",
      taskId: "S03-T01",
    },
    {
      acceptanceAfter: "S02, S05, S07",
      integrationId: "C1-contract-spine",
      manifestTranche: "C1-contract-spine",
      taskId: "S08-T01",
    },
    {
      acceptanceAfter: "S08-T01",
      integrationId: "D2-domain-bodies",
      laneAccepted: true,
      laneIntegrationId: "D2-domain-bodies",
      manifestTranche: "D2-domain-bodies",
      resultUsesExplicitId: true,
      taskId: "S08-T02",
    },
    {
      acceptanceAfter: "S07, S08",
      integrationId: "C1-contract-spine-w2",
      laneIntegrationId: "C1-contract-spine-w2",
      manifestTranche: "C1-contract-spine",
      resultUsesExplicitId: true,
      taskId: "S09-T01",
    },
    {
      acceptanceAfter: "S09 complete",
      integrationId: "C1-contract-spine",
      manifestTranche: "C1-contract-spine",
      taskId: "S11-T01",
    },
    {
      acceptanceAfter: "S07, S11",
      integrationId: "C1-contract-spine",
      manifestTranche: "C1-contract-spine",
      taskId: "S12-T01",
    },
    {
      acceptanceAfter: "S10, S11, S12 complete",
      integrationId: "C1-contract-spine",
      laneTranche: "C1-contract-spine",
      manifestTranche: "X3-convergence",
      taskId: "S13-T01",
    },
  ] as const;

  it.each(realLegacyMappings)(
    "previews and adopts the real $taskId identity mapping",
    (mapping) => {
      const value = fixture(mapping);
      const args = {
        controlRoot: value.root,
        currentHeadSha: "5".repeat(40),
        evidenceDirectory: value.evidence,
        isAncestor: () => true,
        workdir: value.root,
      };
      const before = readFileSync(value.lanePath, "utf8");
      expect(
        adoptLegacyIntegratedLaneEvidence({ ...args, apply: false }),
      ).toEqual([
        { integrationId: mapping.integrationId, taskId: mapping.taskId },
      ]);
      expect(readFileSync(value.lanePath, "utf8")).toBe(before);
      expect(adoptLegacyIntegratedLaneEvidence(args)).toHaveLength(1);
      expect(
        adoptLegacyIntegratedLaneEvidence({ ...args, apply: false }),
      ).toEqual([]);
      expect(readRecord(value.lanePath)).toMatchObject({
        accepted: false,
        integrationId: mapping.integrationId,
        status: "integrated",
        tranche: mapping.manifestTranche,
      });
    },
  );

  it("adopts exact authoritative v1 evidence and is idempotent", () => {
    const value = fixture();
    const before = sha256(readFileSync(value.lanePath, "utf8"));
    expect(
      adoptLegacyIntegratedLaneEvidence({
        controlRoot: value.root,
        currentHeadSha: "5".repeat(40),
        evidenceDirectory: value.evidence,
        isAncestor: () => true,
        workdir: value.root,
      }),
    ).toEqual([{ integrationId: "C1-contract-spine", taskId: "S01-T01" }]);
    const lane = readRecord(value.lanePath);
    expect(lane).toMatchObject({
      accepted: false,
      integrationId: "C1-contract-spine",
      status: "integrated",
    });
    expect(String(lane.acceptanceBlocker)).toContain("S00 complete");
    expect(() => validateLaneAcceptance(lane, value.taskId)).not.toThrow();
    const adoption = lane.evidenceAdoption as Record<string, unknown>;
    expect(adoption.laneResultSha256Before).toBe(before);
    expect(adoption.integrationResultSha256).toBe(
      sha256(readFileSync(value.resultPath, "utf8")),
    );
    const receiptPath = resolve(
      value.evidence,
      "lane-results",
      value.taskId,
      "lane-evidence-adoption.json",
    );
    expect(readRecord(receiptPath).laneResultSha256After).toBe(
      sha256(readFileSync(value.lanePath, "utf8")),
    );
    expect(
      adoptLegacyIntegratedLaneEvidence({
        controlRoot: value.root,
        currentHeadSha: "5".repeat(40),
        evidenceDirectory: value.evidence,
        isAncestor: () => true,
        workdir: value.root,
      }),
    ).toEqual([]);
  });

  it("rejects unproven and ambiguous records without changing the lane", () => {
    const value = fixture();
    const before = readFileSync(value.lanePath, "utf8");
    const result = readRecord(value.resultPath);
    result.broadGate = {
      command: "pnpm verify",
      headSha: "2".repeat(40),
      status: "passed",
    };
    writeJson(value.resultPath, result);
    expect(() =>
      adoptLegacyIntegratedLaneEvidence({
        controlRoot: value.root,
        currentHeadSha: "5".repeat(40),
        evidenceDirectory: value.evidence,
        isAncestor: () => true,
        workdir: value.root,
      }),
    ).toThrow(/0 authoritative integration results/);
    expect(readFileSync(value.lanePath, "utf8")).toBe(before);

    result.broadGate = {
      command: "rtk host-test-slot --class full pnpm verify",
      headSha: "2".repeat(40),
      status: "passed",
    };
    writeJson(value.resultPath, result);
    const duplicateDirectory = resolve(
      value.evidence,
      "integration",
      "C1-contract-spine-copy",
    );
    mkdirSync(duplicateDirectory, { recursive: true });
    writeJson(resolve(duplicateDirectory, "integration-result.json"), {
      ...result,
      tranche: "C1-contract-spine-copy",
    });
    expect(() =>
      adoptLegacyIntegratedLaneEvidence({
        controlRoot: value.root,
        currentHeadSha: "5".repeat(40),
        evidenceDirectory: value.evidence,
        isAncestor: () => true,
        workdir: value.root,
      }),
    ).toThrow(/2 authoritative integration results/);
    expect(readFileSync(value.lanePath, "utf8")).toBe(before);
  });

  it("rejects an integration task with contradictory tranche identity", () => {
    const value = fixture();
    const result = readRecord(value.resultPath);
    result.includedTasks = [
      {
        laneHeadSha: "1".repeat(40),
        manifestTranche: "C1-contract-spine",
        taskId: value.taskId,
        tranche: "wrong-tranche",
      },
    ];
    writeJson(value.resultPath, result);
    expect(() =>
      adoptLegacyIntegratedLaneEvidence({
        controlRoot: value.root,
        currentHeadSha: "5".repeat(40),
        evidenceDirectory: value.evidence,
        isAncestor: () => true,
        workdir: value.root,
      }),
    ).toThrow(/0 authoritative integration results/);
  });

  it("records S13 acceptance as deferred instead of inventing acceptance", () => {
    const value = fixture({
      acceptanceAfter: "S10, S11, S12 complete",
      taskId: "S13-T01",
    });
    adoptLegacyIntegratedLaneEvidence({
      controlRoot: value.root,
      currentHeadSha: "5".repeat(40),
      evidenceDirectory: value.evidence,
      isAncestor: () => true,
      workdir: value.root,
    });
    expect(readRecord(value.lanePath)).toMatchObject({
      acceptanceBlocker:
        "Acceptance remains deferred until S10, S11, S12 complete; adopted integration evidence proves integration only.",
      accepted: false,
      status: "integrated",
    });
  });
});
