import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { materializeLaneGreenAuthorityWorkflow } from "../src/lane-green-authority-workflow.js";
import { terminalContractReproofWorkflowName } from "../src/terminal-contract-reproof-launch.js";

describe("terminal contract-reproof launch", () => {
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
