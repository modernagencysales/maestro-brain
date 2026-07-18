import { readFileSync } from "node:fs";

import {
  INTEGRATION_WAVE_SCHEMA,
  readIntegrationWaveSelection,
} from "./integration-wave.js";

const valueAfter = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const selectionPath = valueAfter("--selection");
const integrationId = valueAfter("--integration-id");
const baseSha = valueAfter("--base");
const selectionPayloadSha256 = valueAfter("--selection-payload-sha256");
const selectionFileSha256 = valueAfter("--selection-file-sha256");
if (
  process.argv.includes("--selection-sha256") ||
  !selectionPath ||
  !integrationId ||
  !baseSha ||
  !selectionPayloadSha256 ||
  !selectionFileSha256
) {
  throw new Error(
    "usage: integration-wave-selection-check --selection ... --integration-id ... --base ... --selection-payload-sha256 ... --selection-file-sha256 ...",
  );
}
const read = readIntegrationWaveSelection(readFileSync(selectionPath));
if (
  read.legacy ||
  read.selection.schemaVersion !== INTEGRATION_WAVE_SCHEMA ||
  read.selection.integrationId !== integrationId ||
  read.selection.baseSha !== baseSha ||
  read.selectionPayloadSha256 !== selectionPayloadSha256 ||
  read.selectionFileSha256 !== selectionFileSha256
) {
  throw new Error("integration wave v3 selection launch identity mismatch");
}
console.log(`${integrationId}: immutable v3 wave selection passed`);
