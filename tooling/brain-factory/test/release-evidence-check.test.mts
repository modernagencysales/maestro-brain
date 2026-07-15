import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { validateReleaseEvidence } from "../src/release-evidence-check.mjs";

const roots: string[] = [];
const fixture = () => {
  const evidenceDirectory = mkdtempSync(
    resolve(tmpdir(), "brain-release-evidence-"),
  );
  roots.push(evidenceDirectory);
  const releaseCommit = "a".repeat(40);
  const path = resolve(evidenceDirectory, "release", "release-result.json");
  mkdirSync(resolve(evidenceDirectory, "release"));
  const result = {
    approvers: ["release-owner", "security-owner"],
    ciContext: { status: "passed" },
    incidents: [],
    pilot: {
      agencyCount: 5,
      completedAgencyCount: 5,
      endedAt: "2026-07-08T00:00:00.000Z",
      startedAt: "2026-07-01T00:00:00.000Z",
    },
    productionDoctor: { status: "passed" },
    providerContext: { status: "passed" },
    releaseCommit,
    reviewVerdict: "go",
    rollbackReceipt: { destructiveReverseMigration: false, status: "passed" },
    schemaVersion: "maestro-brain-release-evidence/v1",
    signatureSha256: "b".repeat(64),
    staging: { status: "passed" },
    status: "launch_approved",
  };
  const write = () =>
    writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`);
  write();
  return { evidenceDirectory, releaseCommit, result, write };
};

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { force: true, recursive: true });
});

describe("release evidence gate", () => {
  it("accepts only a complete deterministic go packet", () => {
    const value = fixture();
    expect(() => validateReleaseEvidence(value)).not.toThrow();
  });

  it("rejects a shortened pilot and no-go review", () => {
    const value = fixture();
    value.result.pilot.endedAt = "2026-07-07T23:59:59.999Z";
    value.write();
    expect(() => validateReleaseEvidence(value)).toThrow(/seven full days/);
    value.result.pilot.endedAt = "2026-07-08T00:00:00.000Z";
    value.result.reviewVerdict = "no_go";
    value.write();
    expect(() => validateReleaseEvidence(value)).toThrow(/go verdict/);
  });
});
