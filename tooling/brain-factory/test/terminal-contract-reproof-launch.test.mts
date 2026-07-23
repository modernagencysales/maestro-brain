import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("terminal contract-reproof launch", () => {
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
    expect(source).toContain("reproofRequest: requestPath");
    expect(source).toContain('resumeMode: "preserved-worktree"');
    expect(source).toContain("materializeBuildTaskRunConfig({");
    expect(source).toContain(
      '".fabro/workflows/brain-build-task/workflow.fabro"',
    );
  });
});
