import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { materializeLaneGreenAuthorityWorkflow } from "../src/lane-green-authority-workflow.js";
import {
  readTerminalContractReproofAuthorityDelta,
  signedFindingsBindRoute,
  terminalContractReproofWorkflowName,
} from "../src/terminal-contract-reproof-launch.js";

describe("terminal contract-reproof launch", () => {
  it("uses unfiltered Git bytes for machine-readable authority paths", () => {
    const calls: string[][] = [];
    expect(
      readTerminalContractReproofAuthorityDelta({
        controlHeadSha: "a".repeat(40),
        currentHeadSha: "b".repeat(40),
        root: "/control",
        runCommand: (args) => {
          calls.push([...args]);
          return args[0] === "proxy"
            ? "tooling/brain-factory/src/example.ts"
            : "tooling/brain-factory/src/example.ts\n\nChanges:";
        },
      }),
    ).toEqual(["tooling/brain-factory/src/example.ts"]);
    expect(calls).toEqual([
      [
        "proxy",
        "git",
        "diff",
        "--name-only",
        `${"a".repeat(40)}..${"b".repeat(40)}`,
      ],
    ]);
  });

  it("binds the canonical signed finding to its task-owned routed shape", () => {
    const signed = {
      id: "wave-example-S04-T04-tenant-key-auth-mismatch",
      taskId: "S04-T04",
      candidateHeadSha: "3".repeat(40),
      summary: "Stable provider key and durable tenant ID differ.",
      details: "Authorization must use the durable tenant identity.",
      severity: "blocker",
      affectedPaths: ["packages/example.ts", "packages/example.test.ts"],
      expectedBehavior: "Resolve the provider key before authorization.",
      requiredRegressionProof: "Allow the owning tenant and deny another.",
      priorEvidenceSha256: [
        "a".repeat(64),
        "b".repeat(64),
        "c".repeat(64),
        "d".repeat(64),
        "e".repeat(64),
        "f".repeat(64),
        "1".repeat(64),
        "2".repeat(64),
      ],
      changeExpectation: "source_or_test_delta" as const,
    };
    const routed = {
      ...signed,
      ownerKind: "task" as const,
      priorEvidenceSha256: ["f".repeat(64), "a".repeat(64), "9".repeat(64)],
    };

    expect(signedFindingsBindRoute([signed], [routed], "S04-T04")).toBe(true);
    expect(
      signedFindingsBindRoute(
        [signed],
        [{ ...routed, ownerKind: "integration" }],
        "S04-T04",
      ),
    ).toBe(false);
    expect(
      signedFindingsBindRoute(
        [signed],
        [{ ...routed, priorEvidenceSha256: ["not-a-sha"] }],
        "S04-T04",
      ),
    ).toBe(false);
    expect(
      signedFindingsBindRoute(
        [signed],
        [{ ...routed, summary: "drift" }],
        "S04-T04",
      ),
    ).toBe(false);
  });

  it("materializes a deterministic workflow identity accepted by the canonical compiler", () => {
    const root = mkdtempSync(join(tmpdir(), "terminal-reproof-workflow-"));
    try {
      const workflowName = terminalContractReproofWorkflowName({
        priorRunId: "01KY64NR32560KPVBY5NXZ7RQP",
        proofHeadSha: "f".repeat(40),
        requestSha256: "a".repeat(64),
        taskId: "S04-T04",
      });
      const sourcePath = resolve(root, "source.fabro");
      const outputPath = resolve(root, "output.fabro");
      writeFileSync(sourcePath, "digraph BrainBuildTask {\n}\n");
      expect(
        materializeLaneGreenAuthorityWorkflow({
          path: outputPath,
          sourcePath,
          workflowName,
        }),
      ).toBe(outputPath);
      expect(readFileSync(outputPath, "utf8")).toContain(
        `digraph ${workflowName} {`,
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
  it("uses current workflow admission without dropping preserved authority", () => {
    const source = readFileSync(
      fileURLToPath(
        new URL("../src/terminal-contract-reproof-launch.ts", import.meta.url),
      ),
      "utf8",
    );
    expect(source).toContain("acquireDispatcherLock({");
    expect(source).toContain("admitContractReproof({");
    expect(source).toContain("buildTerminalContractReproofResume({");
    expect(source).toContain("replaceTerminalTaskRecord({");
    expect(source).toContain(
      "reproofRequest: plan.launchInputs.reproof_request",
    );
    expect(source).toContain("resumeMode: plan.launchInputs.resume_mode");
    expect(source).toContain("materializeBuildTaskRunConfig({");
    expect(
      source.match(/readContainedTerminalReproofJson\(\n\s+input\.evidence/g),
    ).toHaveLength(3);
    expect(source).toContain(
      '".fabro/workflows/brain-build-task/workflow.fabro"',
    );
  });
});
