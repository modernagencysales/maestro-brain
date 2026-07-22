import { runRtk } from "./process.js";

export type JsonRecord = Record<string, unknown>;

export const laneGreenAuthorityRecord = (
  value: unknown,
  label: string,
): JsonRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} is not a JSON object`);
  }
  return value as JsonRecord;
};

export const laneGreenAuthorityLines = (value: string): string[] =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

export const inspectLaneGreenAuthorityReproofRun = (runId: string): string => {
  const parsed = JSON.parse(
    runRtk(["fabro", "inspect", runId, "--json", "--quiet"], {
      quiet: true,
    }),
  ) as unknown;
  const item = Array.isArray(parsed) ? parsed[0] : parsed;
  const value = laneGreenAuthorityRecord(item, `Fabro run ${runId}`);
  const status =
    typeof value.status === "string"
      ? value.status
      : laneGreenAuthorityRecord(value.status, `Fabro run ${runId} status`)
          .kind;
  if (typeof status !== "string" || !status) {
    throw new Error(`Fabro run ${runId} has no status; ownership is unknown`);
  }
  return status;
};

export const laneGreenAuthorityReproofRunIsTerminal = (
  status: string,
): boolean =>
  new Set(["canceled", "cancelled", "failed", "succeeded"]).has(status);
