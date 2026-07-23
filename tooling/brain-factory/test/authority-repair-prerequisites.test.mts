import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveIntegratedPrerequisiteTaskIds } from "../src/authority-repair-prerequisites.js";
import { assertAuthorityRepairSourceStatus } from "../src/authority-refresh-launch.js";

const roots: string[] = [];

const fixture = () => {
  const evidence = mkdtempSync(join(tmpdir(), "authority-prerequisite-"));
  roots.push(evidence);
  const taskId = "S05-T01";
  const laneHeadSha = "1".repeat(40);
  const integrationHeadSha = "2".repeat(40);
  const laneDirectory = join(evidence, "lane-results", taskId);
  const resultDirectory = join(evidence, "integration", "wave-000001");
  mkdirSync(laneDirectory, { recursive: true });
  mkdirSync(resultDirectory, { recursive: true });
  writeFileSync(
    join(laneDirectory, "lane-result.json"),
    JSON.stringify({
      schemaVersion: "maestro-brain-lane-result/v1",
      taskId,
      status: "lane_green",
      headSha: laneHeadSha,
      treeSha: "3".repeat(40),
      tranche: "C1-contract-spine",
    }),
  );
  const result = {
    schemaVersion: "maestro-brain-integration-result/v3",
    integrationId: "wave-000001",
    status: "passed",
    reviewVerdict: "pass",
    headSha: integrationHeadSha,
    remainingFindings: [],
    broadGate: {
      status: "passed",
      headSha: integrationHeadSha,
      command: "rtk host-test-slot --class full pnpm verify",
    },
    includedTasks: [
      {
        taskId,
        laneHeadSha,
        tranche: "C1-contract-spine",
      },
    ],
  };
  const resultPath = join(resultDirectory, "integration-result.json");
  writeFileSync(resultPath, JSON.stringify(result));
  return { evidence, result, resultDirectory, resultPath, taskId };
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

describe("authority-repair prerequisite integration", () => {
  it("requires an exact failed source run", () => {
    expect(() =>
      assertAuthorityRepairSourceStatus("succeeded", "S03-T03"),
    ).toThrow("authority-repair source run must have failed");
    expect(() =>
      assertAuthorityRepairSourceStatus("canceled", "S03-T03"),
    ).toThrow("authority-repair source run must have failed");
    expect(() =>
      assertAuthorityRepairSourceStatus("failed", "S03-T03"),
    ).not.toThrow();
  });

  it("accepts only strict unsuperseded integration authority", () => {
    const value = fixture();
    const resolve = () =>
      resolveIntegratedPrerequisiteTaskIds({
        controlHeadSha: "4".repeat(40),
        evidence: value.evidence,
        isAncestor: () => true,
        requiredTasks: [{ taskId: value.taskId, tranche: "C1-contract-spine" }],
      });
    expect(resolve()).toEqual([value.taskId]);

    for (const mutate of [
      (result: Record<string, unknown>) => {
        result.schemaVersion = "unknown";
      },
      (result: Record<string, unknown>) => {
        result.status = "ready_for_review";
      },
      (result: Record<string, unknown>) => {
        result.remainingFindings = [{ id: "open" }];
      },
      (result: Record<string, unknown>) => {
        result.broadGate = { status: "failed" };
      },
      (result: Record<string, unknown>) => {
        result.includedTasks = [
          {
            taskId: value.taskId,
            laneHeadSha: "9".repeat(40),
            tranche: "C1-contract-spine",
          },
        ];
      },
      (result: Record<string, unknown>) => {
        const included = (result.includedTasks as Record<string, unknown>[])[0];
        delete included?.tranche;
      },
    ]) {
      const changed = structuredClone(value.result) as Record<string, unknown>;
      mutate(changed);
      writeFileSync(value.resultPath, JSON.stringify(changed));
      expect(resolve()).toEqual([]);
    }

    writeFileSync(value.resultPath, JSON.stringify(value.result));
    writeFileSync(join(value.resultDirectory, "supersession.json"), "{}");
    expect(resolve()).toEqual([]);
  });

  it("accepts a legacy tranche omission only through exact adopted evidence", () => {
    const value = fixture();
    const legacy = structuredClone(value.result);
    delete (legacy.includedTasks[0] as Record<string, unknown>).tranche;
    const resultContent = JSON.stringify(legacy);
    writeFileSync(value.resultPath, resultContent);
    const lanePath = join(
      value.evidence,
      "lane-results",
      value.taskId,
      "lane-result.json",
    );
    writeFileSync(
      lanePath,
      JSON.stringify({
        schemaVersion: "maestro-brain-lane-result/v1",
        taskId: value.taskId,
        status: "integrated",
        headSha: "1".repeat(40),
        tranche: "C1-contract-spine",
        integrationId: "wave-000001",
        integrationHeadSha: "2".repeat(40),
        accepted: false,
        evidenceAdoption: {
          schemaVersion: "maestro-brain-lane-evidence-adoption/v1",
          manifestTranche: "C1-contract-spine",
          integrationId: "wave-000001",
          integrationHeadSha: "2".repeat(40),
          integrationResultPath:
            "integration/wave-000001/integration-result.json",
          integrationResultSha256: createHash("sha256")
            .update(resultContent)
            .digest("hex"),
          laneHeadSha: "1".repeat(40),
        },
      }),
    );
    const resolve = () =>
      resolveIntegratedPrerequisiteTaskIds({
        controlHeadSha: "4".repeat(40),
        evidence: value.evidence,
        isAncestor: () => true,
        requiredTasks: [{ taskId: value.taskId, tranche: "C1-contract-spine" }],
      });
    expect(resolve()).toEqual([value.taskId]);

    const lane = JSON.parse(readFileSync(lanePath, "utf8")) as Record<
      string,
      unknown
    >;
    const adoption = lane.evidenceAdoption as Record<string, unknown>;
    adoption.integrationResultSha256 = "9".repeat(64);
    writeFileSync(lanePath, JSON.stringify(lane));
    expect(resolve()).toEqual([]);
  });
});
