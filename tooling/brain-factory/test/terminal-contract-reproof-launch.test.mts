import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { materializeLaneGreenAuthorityWorkflow } from "../src/lane-green-authority-workflow.js";
import {
  commitTerminalContractReproofRefresh,
  persistTerminalContractReproofRefreshArtifacts,
  readTerminalContractReproofAuthorityDelta,
  signedFindingsBindRoute,
  terminalContractReproofWorkflowName,
  terminalContractReproofRefreshRequired,
} from "../src/terminal-contract-reproof-launch.js";

describe("terminal contract-reproof launch", () => {
  it("refreshes a plan-stable non-empty control advance", () => {
    expect(
      terminalContractReproofRefreshRequired({
        authorityDeltaPaths: ["tooling/brain-factory/src/manifest.ts"],
        currentControlHeadSha: "b".repeat(40),
        previousControlHeadSha: "a".repeat(40),
      }),
    ).toBe(true);
    expect(() =>
      terminalContractReproofRefreshRequired({
        authorityDeltaPaths: [],
        currentControlHeadSha: "b".repeat(40),
        previousControlHeadSha: "a".repeat(40),
      }),
    ).toThrow("no authority delta");
  });

  it("performs full candidate validation before any artifact write", () => {
    const writes: string[] = [];
    expect(() =>
      commitTerminalContractReproofRefresh({
        buildRequest: () => ({ requestSha256: "a".repeat(64) }),
        buildResumePlan: () => {
          throw new Error("invalid terminal inputs");
        },
        persist: () => writes.push("write"),
      }),
    ).toThrow("invalid terminal inputs");
    expect(writes).toEqual([]);
  });

  it("recovers partial exact writes and rejects collisions before writing", () => {
    const contents = new Map([["prior-request.json", "request"]]);
    const artifacts = [
      { path: "prior-request.json", content: "request" },
      { path: "prior-proof.json", content: "proof" },
      { path: "prior-gate.json", content: "gate" },
      { path: "request.json", content: "refresh" },
    ];
    persistTerminalContractReproofRefreshArtifacts({
      artifacts,
      exists: (path) => contents.has(path),
      read: (path) => contents.get(path) ?? "",
      write: (path, content) => contents.set(path, content),
    });
    expect(Object.fromEntries(contents)).toEqual({
      "prior-request.json": "request",
      "prior-proof.json": "proof",
      "prior-gate.json": "gate",
      "request.json": "refresh",
    });

    const collision = new Map([["prior-gate.json", "wrong"]]);
    const writes: string[] = [];
    expect(() =>
      persistTerminalContractReproofRefreshArtifacts({
        artifacts,
        exists: (path) => collision.has(path),
        read: (path) => collision.get(path) ?? "",
        write: (path) => writes.push(path),
      }),
    ).toThrow("terminal refresh artifact collision");
    expect(writes).toEqual([]);
  });

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
});
