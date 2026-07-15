import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

const record = (value: unknown, label: string): JsonRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as JsonRecord;
};

const passed = (value: unknown, label: string): void => {
  if (record(value, label).status !== "passed")
    throw new Error(`${label} is not passed`);
};

export const validateReleaseEvidence = (input: {
  readonly evidenceDirectory: string;
  readonly releaseCommit: string;
}): void => {
  if (!isAbsolute(input.evidenceDirectory))
    throw new Error("release evidence directory must be absolute");
  if (!/^[0-9a-f]{40}$/.test(input.releaseCommit))
    throw new Error("release commit must be an exact SHA");
  const path = resolve(
    input.evidenceDirectory,
    "release",
    "release-result.json",
  );
  const result = record(JSON.parse(readFileSync(path, "utf8")), path);
  if (result.schemaVersion !== "maestro-brain-release-evidence/v1")
    throw new Error("unexpected release evidence schema");
  if (result.releaseCommit !== input.releaseCommit)
    throw new Error("release evidence does not bind the frozen commit");
  if (result.status !== "launch_approved" || result.reviewVerdict !== "go")
    throw new Error("release evidence has no deterministic go verdict");
  for (const field of [
    "ciContext",
    "productionDoctor",
    "providerContext",
    "staging",
  ])
    passed(result[field], field);
  const rollback = record(result.rollbackReceipt, "rollbackReceipt");
  if (
    rollback.status !== "passed" ||
    rollback.destructiveReverseMigration !== false
  )
    throw new Error("rollback receipt is missing or destructive");
  const pilot = record(result.pilot, "pilot");
  const startedAt = Date.parse(String(pilot.startedAt ?? ""));
  const endedAt = Date.parse(String(pilot.endedAt ?? ""));
  if (
    !Number.isInteger(pilot.agencyCount) ||
    Number(pilot.agencyCount) < 5 ||
    !Number.isInteger(pilot.completedAgencyCount) ||
    Number(pilot.completedAgencyCount) < 5 ||
    Number.isNaN(startedAt) ||
    Number.isNaN(endedAt) ||
    endedAt - startedAt < 7 * 24 * 60 * 60 * 1000
  )
    throw new Error("pilot does not prove five agencies for seven full days");
  if (!Array.isArray(result.incidents) || result.incidents.length !== 0)
    throw new Error("release has a zero-tolerance incident");
  if (
    !Array.isArray(result.approvers) ||
    result.approvers.length < 2 ||
    result.approvers.some(
      (approver) => typeof approver !== "string" || approver.length === 0,
    )
  )
    throw new Error("release requires two named approver aliases");
  if (
    typeof result.signatureSha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(result.signatureSha256)
  )
    throw new Error("release packet signature digest is missing");
};

const valueAfter = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

if (process.argv[1]?.endsWith("release-evidence-check.mts")) {
  const evidenceDirectory = valueAfter("--evidence");
  const releaseCommit = valueAfter("--release-commit");
  if (!evidenceDirectory || !releaseCommit)
    throw new Error(
      "usage: release-evidence-check --evidence <absolute-path> --release-commit <sha>",
    );
  validateReleaseEvidence({ evidenceDirectory, releaseCommit });
  console.log(`${releaseCommit}: release evidence check passed`);
}
