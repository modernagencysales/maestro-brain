import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { buildManifest } from "../src/manifest.js";

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

describe("reopen CLI failed-wave lineage", () => {
  it("accepts only the exact refreshed lane selected by Wave 56", () => {
    const root = resolve(process.cwd(), "../..");
    const state = mkdtempSync(resolve(tmpdir(), "brain-reopen-cli-"));
    const headSha = execFileSync("rtk", ["proxy", "git", "rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    const manifest = buildManifest(root);
    const evidence = resolve(state, "evidence", "lane-results");
    for (const task of manifest.tasks) {
      const path = resolve(evidence, task.taskId, "lane-result.json");
      mkdirSync(resolve(path, ".."), { recursive: true });
      writeFileSync(
        path,
        json({
          integrationHeadSha: headSha,
          status: "integrated",
          taskId: task.taskId,
        }),
      );
    }
    const requestSha256 =
      "ccafadbc70627965fa08186de3267241489289078e3051a32a68856bcf4690d1";
    writeFileSync(
      resolve(evidence, "S04-T04", "lane-result.json"),
      json({
        headSha,
        reproof: { requestSha256 },
        status: "lane_green",
        taskId: "S04-T04",
      }),
    );
    const selectionPath = resolve(
      state,
      "runs",
      "integration-wave-000056-selection.json",
    );
    mkdirSync(resolve(selectionPath, ".."), { recursive: true });
    const run = (selectedRequestSha256: string) => {
      writeFileSync(
        selectionPath,
        json({
          baseSha: headSha,
          integrationId: "wave-000056",
          selectedTasks: [
            {
              reproofRequestSha256: selectedRequestSha256,
              taskId: "S04-T04",
            },
          ],
        }),
      );
      return spawnSync(
        "rtk",
        [
          "proxy",
          "pnpm",
          "exec",
          "tsx",
          "tooling/brain-factory/src/reopen.mts",
          "--task",
          "S04-T04",
          "--reason",
          "Wave 56 deterministic preflight",
          "--failed-integration",
          "wave-000056",
          "--state",
          state,
        ],
        { cwd: root, encoding: "utf8" },
      );
    };

    const mismatch = run("b".repeat(64));
    expect(`${mismatch.stdout}${mismatch.stderr}`).toContain(
      "failed integration rework lineage is ambiguous",
    );
    const exact = run(requestSha256);
    const exactOutput = `${exact.stdout}${exact.stderr}`;
    expect(exactOutput).not.toContain(
      "failed integration rework lineage is ambiguous",
    );
    expect(exactOutput).toContain("prior integration result is missing");
    rmSync(state, { force: true, recursive: true });
  });
});
