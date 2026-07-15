import { describe, expect, it } from "vitest";
import {
  buildManifest,
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
      "pattern-instance": 8,
      "template-gap": 46,
    });
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
        "S13-T01",
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
    const isolation = manifest.tasks.find((task) => task.taskId === "S00-T03");
    const migrations = manifest.tasks.find((task) => task.taskId === "S00-T04");
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
});
