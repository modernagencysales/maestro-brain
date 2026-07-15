import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildManifest,
  PLAN_RELATIVE,
  parseTaskPacketAuditRows,
  REPO_ROOT,
  readyWidth,
  validateManifest,
} from "../src/manifest.js";

describe("Maestro Brain execution manifest", () => {
  it("preserves every audited task and classification", () => {
    const manifest = buildManifest();
    expect(validateManifest(manifest)).toEqual([]);
    expect(manifest.tasks).toHaveLength(56);
    expect(
      Object.fromEntries(
        ["template-gap", "pattern-instance", "fixture-to-real"].map((kind) => [
          kind,
          manifest.tasks.filter((task) => task.classification === kind).length,
        ]),
      ),
    ).toEqual({
      "fixture-to-real": 2,
      "pattern-instance": 7,
      "template-gap": 47,
    });
  });

  it("keeps every focused verification packet executable", () => {
    const plan = readFileSync(resolve(REPO_ROOT, PLAN_RELATIVE), "utf8");
    const shorthand = [
      "accessibility smoke",
      "accessibility test",
      "all exact release commands",
      "codegen/manifest",
      "generator/codegen/manifest",
      "integration fake tests",
      "property/concurrency tests",
      "schema/property tests",
      "targeted web tests",
    ];
    for (const match of plan.matchAll(
      /^### (S\d{2}-T\d{2}) — [^\n]+\n([\s\S]*?)(?=^### S\d{2}-T\d{2} — |^---$)/gm,
    )) {
      const taskId = match[1];
      const body = match[2] ?? "";
      const focused = body.match(
        /- \*\*Focused verification:\*\*([\s\S]*?)(?=\n- \*\*)/,
      )?.[1];
      expect(focused, `${taskId}: focused verification missing`).toBeDefined();
      expect(focused, `${taskId}: no exact rtk verification command`).toContain(
        "`rtk ",
      );
      for (const phrase of shorthand) {
        expect(
          focused?.toLowerCase(),
          `${taskId}: shorthand ${phrase}`,
        ).not.toContain(phrase);
      }
    }
  });

  it("exposes a real contract-first parallel frontier", () => {
    const manifest = buildManifest();
    expect(readyWidth(manifest)).toBeGreaterThanOrEqual(6);
    expect(
      manifest.tasks
        .filter((task) => task.codeStartAfter.length === 0)
        .map((task) => task.taskId),
    ).toEqual(
      expect.arrayContaining([
        "S01-T01",
        "S02-T01",
        "S03-T01",
        "S08-T01",
        "S09-T01",
      ]),
    );
  });

  it("reserves generated output for integration and locks environment ownership", () => {
    const manifest = buildManifest();
    expect(
      manifest.tasks.every(
        (task) =>
          !task.fileLocks.includes("@generated-confect") &&
          task.fileLocks.every((file) => !file.includes("/_generated/")),
      ),
    ).toBe(true);
    expect(
      manifest.tasks.some((task) => task.fileLocks.includes("@environment")),
    ).toBe(true);
  });

  it("serializes migrations behind deployment isolation", () => {
    const manifest = buildManifest();
    const sourceContract = manifest.tasks.find(
      (task) => task.taskId === "S00-T02",
    );
    const isolation = manifest.tasks.find((task) => task.taskId === "S00-T03");
    const migrations = manifest.tasks.find((task) => task.taskId === "S00-T04");
    expect(sourceContract?.kind).toBe("product");
    expect(sourceContract?.fileLocks).toEqual(
      expect.arrayContaining([
        "@dependencies",
        "package.json",
        "pnpm-workspace.yaml",
      ]),
    );
    expect(isolation?.fileLocks).toContain(".buildkite/pipeline.yml");
    expect(migrations?.codeStartAfter).toEqual(["S00-T03"]);
  });

  it("keeps durable identity and provider work behind foundation gates", () => {
    const manifest = buildManifest();
    const stableIdentity = manifest.tasks.find(
      (task) => task.taskId === "S01-T02",
    );
    const providerSetup = manifest.tasks.find(
      (task) => task.taskId === "S04-T01",
    );
    expect(stableIdentity?.codeStartAfter).toEqual(["S00-T04", "S01-T01"]);
    expect(providerSetup?.codeStartAfter).toEqual(["S00-T03", "S01-T02"]);
  });

  it("keeps S13 MCP and export work behind the reviewed contracts", () => {
    const manifest = buildManifest();
    const semanticEvals = manifest.tasks.find(
      (task) => task.taskId === "S13-T01",
    );
    const capacity = manifest.tasks.find((task) => task.taskId === "S13-T02");
    const operations = manifest.tasks.find((task) => task.taskId === "S13-T03");
    expect(semanticEvals?.acceptanceAfter).toBe("S10, S11, S12 complete");
    expect(semanticEvals?.codeStartAfter).toEqual([
      "S08-T04",
      "S09-T04",
      "S11-T03",
    ]);
    expect(capacity?.codeStartAfter).toEqual(["S13-T01", "S06-T02", "S11-T04"]);
    expect(operations?.codeStartAfter).toEqual([
      "S06-T02",
      "S08-T01",
      "S11-T04",
      "S12-T02",
    ]);
    expect(
      manifest.tasks
        .filter((task) => task.taskId.startsWith("S13-"))
        .every((task) => task.tranche === "X3-convergence"),
    ).toBe(true);
  });

  it("uses only package-relevant profiles for the next frontier", () => {
    const manifest = buildManifest();
    const deployment = manifest.tasks.find((task) => task.taskId === "S00-T03");
    const generator = manifest.tasks.find((task) => task.taskId === "S08-T02");
    expect(deployment?.gateProfiles).toEqual(["release"]);
    expect(generator?.gateProfiles).toEqual(["generators"]);
    expect(generator?.fileLocks).not.toContain("@dependencies");
  });

  it("binds completed packet audits and rejects unsafe ready pseudo-locks", () => {
    const manifest = buildManifest();
    expect(
      manifest.tasks.every((task) => task.fileInventoryStatus === "ready"),
    ).toBe(true);
    const unsafe = manifest.tasks.map((task) =>
      task.taskId === "S00-T03"
        ? {
            ...task,
            fileInventoryIssues: ["settings.test.ts: basename"],
          }
        : task,
    );
    expect(validateManifest({ ...manifest, tasks: unsafe })).toContain(
      "S00-T03: ready file inventory is unsafe: settings.test.ts: basename",
    );
  });

  it("rejects duplicate, unknown, missing, and misclassified audit rows", () => {
    const expected = new Map([
      ["S00-T01", "template-gap" as const],
      ["S00-T02", "pattern-instance" as const],
    ]);
    const heading = "### Task-packet audit\n";
    expect(
      parseTaskPacketAuditRows(
        `${heading}| S00-T01 | template-gap | ready | S00-T02 | pattern-instance | open:F |`,
        expected,
      ),
    ).toEqual(
      new Map([
        ["S00-T01", "ready"],
        ["S00-T02", "open:F"],
      ]),
    );
    expect(() =>
      parseTaskPacketAuditRows(
        `${heading}| S00-T01 | template-gap | ready | S00-T01 | template-gap | ready |`,
        expected,
      ),
    ).toThrow("duplicate task-packet audit row");
    expect(() =>
      parseTaskPacketAuditRows(
        `${heading}| S00-T01 | template-gap | ready | S00-T03 | template-gap | ready |`,
        expected,
      ),
    ).toThrow("S00-T03: unknown task-packet audit row");
    expect(() =>
      parseTaskPacketAuditRows(
        `${heading}| S00-T01 | fixture-to-real | ready | S00-T02 | pattern-instance | open:F |`,
        expected,
      ),
    ).toThrow(
      "audit classification fixture-to-real does not match template-gap",
    );
    expect(() =>
      parseTaskPacketAuditRows(
        `${heading}| S00-T01 | template-gap | ready | S00-T02 | pattern-instance | open:F |`,
        new Map([...expected, ["S00-T03", "template-gap" as const] as const]),
      ),
    ).toThrow("S00-T03: missing task-packet audit row");
  });
});
