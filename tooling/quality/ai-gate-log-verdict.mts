import { readFileSync } from "node:fs";
import process from "node:process";

import { isDirectRun } from "./src/direct-run.mts";

// Extracts the last compact VERDICT_JSON=... marker from retry logs. The AI
// judges emit single-line JSON markers, so multi-line JSON is intentionally out
// of contract here.
export type VerdictMarker = "TASTE_VERDICT_JSON" | "CONTRACT_VERDICT_JSON";

function option(name: string): string | null {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  return value === undefined || value.trim() === "" ? null : value;
}

function parseMarker(raw: string | null): VerdictMarker {
  if (raw === "TASTE_VERDICT_JSON" || raw === "CONTRACT_VERDICT_JSON") {
    return raw;
  }
  throw new Error(`Invalid --marker "${raw ?? ""}".`);
}

export function extractLastVerdictJson(
  log: string,
  marker: VerdictMarker,
): string | null {
  const prefix = `${marker}=`;
  let verdict: string | null = null;
  for (const line of log.split("\n")) {
    if (line.startsWith(prefix)) verdict = line.slice(prefix.length).trim();
  }
  return verdict === "" ? null : verdict;
}

function main(): void {
  const marker = parseMarker(option("--marker"));
  const logFile = option("--log-file");
  if (logFile === null) throw new Error("Missing --log-file.");
  const verdict = extractLastVerdictJson(readFileSync(logFile, "utf8"), marker);
  if (verdict !== null) process.stdout.write(`${verdict}\n`);
}

if (isDirectRun(import.meta.url)) main();
