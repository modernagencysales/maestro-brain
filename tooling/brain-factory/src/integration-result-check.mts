import { realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import {
  git,
  gitIsAncestor,
  readJson,
  record,
  string,
} from "./integration-check-support.js";
import { validateIntegratedLanes } from "./integration-lane-check.js";

export interface IntegrationResultCheckInput {
  readonly controlRoot: string;
  readonly evidenceDirectory: string;
  readonly expectedWorkdir: string;
  readonly integrationId: string;
  readonly manifestTranche: string;
}

export const validateIntegrationResult = (
  input: IntegrationResultCheckInput,
): void => {
  if (
    !isAbsolute(input.controlRoot) ||
    !isAbsolute(input.expectedWorkdir) ||
    !isAbsolute(input.evidenceDirectory)
  ) {
    throw new Error(
      "control root, workdir, and evidence directory must be absolute",
    );
  }

  const controlRoot = realpathSync(input.controlRoot);
  const workdir = realpathSync(input.expectedWorkdir);
  const result = readJson(
    resolve(
      input.evidenceDirectory,
      "integration",
      input.integrationId,
      "integration-result.json",
    ),
  );
  const headSha = git(workdir, ["rev-parse", "HEAD"]);
  const baseSha = string(result.baseSha, "baseSha");
  if (!gitIsAncestor(workdir, baseSha, headSha)) {
    throw new Error("integration base is not an ancestor of HEAD");
  }
  if (
    string(result.schemaVersion, "schemaVersion") !==
    "maestro-brain-integration-result/v1"
  ) {
    throw new Error("unexpected integration result schema");
  }
  if (string(result.integrationId, "integrationId") !== input.integrationId) {
    throw new Error("integrationId mismatch");
  }
  if (
    string(result.manifestTranche, "manifestTranche") !== input.manifestTranche
  ) {
    throw new Error("manifestTranche mismatch");
  }
  if (
    realpathSync(string(result.integrationWorkdir, "integrationWorkdir")) !==
    workdir
  ) {
    throw new Error("integration workdir mismatch");
  }
  if (string(result.headSha, "headSha") !== headSha) {
    throw new Error("evidence head does not match HEAD");
  }
  if (result.status !== "passed") {
    throw new Error("integration result is not passed");
  }
  if (result.reviewVerdict !== "pass") {
    throw new Error("review verdict is not pass");
  }
  if (git(workdir, ["status", "--porcelain"]) !== "") {
    throw new Error("integration worktree is not clean");
  }

  const broadGate = record(result.broadGate, "broadGate");
  if (
    broadGate.status !== "passed" ||
    broadGate.headSha !== headSha ||
    broadGate.command !== "rtk host-test-slot --class full pnpm verify"
  ) {
    throw new Error("broad gate receipt does not prove this head");
  }
  if (!Array.isArray(result.includedTasks)) {
    throw new Error("no included tasks");
  }
  validateIntegratedLanes({
    baseSha,
    controlRoot,
    evidenceDirectory: input.evidenceDirectory,
    headSha,
    includedTasks: result.includedTasks,
    integrationId: input.integrationId,
    manifestTranche: input.manifestTranche,
    workdir,
  });
};

const valueAfter = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

if (process.argv[1]?.endsWith("integration-result-check.mts")) {
  const workdir = valueAfter("--workdir");
  const controlRoot = valueAfter("--control-root");
  const evidence = valueAfter("--evidence");
  const manifestTranche = valueAfter("--manifest-tranche");
  const integrationId = valueAfter("--integration-id");
  if (
    !controlRoot ||
    !workdir ||
    !evidence ||
    !manifestTranche ||
    !integrationId
  ) {
    throw new Error(
      "usage: integration-result-check --control-root ... --workdir ... --evidence ... " +
        "--manifest-tranche ... --integration-id ...",
    );
  }
  validateIntegrationResult({
    controlRoot,
    evidenceDirectory: evidence,
    expectedWorkdir: workdir,
    integrationId,
    manifestTranche,
  });
  console.log(`${integrationId}: integration record check passed`);
}
