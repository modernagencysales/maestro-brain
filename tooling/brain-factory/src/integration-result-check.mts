import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  git,
  gitIsAncestor,
  type JsonRecord,
  readJson,
  record,
  string,
} from "./integration-check-support.js";
import { archiveIntegrationEvidence } from "./evidence-archive.js";
import { adoptLegacyIntegratedLaneEvidence } from "./lane-evidence-adoption.js";
import { validateIntegratedLanes } from "./integration-lane-check.js";
import {
  type IntegrationWaveSelection,
  readIntegrationWaveSelection,
} from "./integration-wave.js";
import { integrationGeneratedFileAllowlist } from "./lane-ownership.js";
import { changedHandAuthoredSourceLines } from "./source-budget.js";
import {
  broadGateReceiptPath,
  readBroadGateReceipt,
  validateBroadGateReceipt,
} from "./integration-broad-gate.js";

export interface IntegrationResultCheckInput {
  readonly controlRoot: string;
  readonly evidenceDirectory: string;
  readonly expectedWorkdir: string;
  readonly integrationId: string;
  readonly manifestTranche?: string;
  readonly selectionPath?: string;
}

interface ValidatedIntegrationEnvelope {
  readonly baseSha: string;
  readonly controlRoot: string;
  readonly headSha: string;
  readonly includedTasks: readonly unknown[];
  readonly result: JsonRecord;
  readonly waveSelection?: IntegrationWaveSelection;
  readonly workdir: string;
}

const validatedIntegrationEnvelope = (
  input: IntegrationResultCheckInput,
): ValidatedIntegrationEnvelope => {
  if (
    !isAbsolute(input.controlRoot) ||
    !isAbsolute(input.expectedWorkdir) ||
    !isAbsolute(input.evidenceDirectory)
  ) {
    throw new Error(
      "control root, workdir, and evidence directory must be absolute",
    );
  }
  if (
    !/^[A-Za-z0-9._-]+$/.test(input.integrationId) ||
    input.integrationId === "." ||
    input.integrationId === ".."
  ) {
    throw new Error("integrationId is not a safe path segment");
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
  const schemaVersion = string(result.schemaVersion, "schemaVersion");
  if (
    schemaVersion !== "maestro-brain-integration-result/v1" &&
    schemaVersion !== "maestro-brain-integration-result/v2" &&
    schemaVersion !== "maestro-brain-integration-result/v3"
  ) {
    throw new Error("unexpected integration result schema");
  }
  if (string(result.integrationId, "integrationId") !== input.integrationId) {
    throw new Error("integrationId mismatch");
  }
  let waveSelection: IntegrationWaveSelection | undefined;
  if (schemaVersion === "maestro-brain-integration-result/v1") {
    if (
      !input.manifestTranche ||
      string(result.manifestTranche, "manifestTranche") !==
        input.manifestTranche
    ) {
      throw new Error("manifestTranche mismatch");
    }
  } else {
    if (!input.selectionPath || !isAbsolute(input.selectionPath)) {
      throw new Error(
        "wave integration requires an absolute immutable selection path",
      );
    }
    const selectionRead = readIntegrationWaveSelection(
      readFileSync(input.selectionPath),
    );
    waveSelection = selectionRead.selection;
    const selectedTranches = [
      ...new Set(waveSelection.selectedTasks.map((task) => task.tranche)),
    ].sort();
    if (waveSelection.integrationId !== input.integrationId) {
      throw new Error(
        `${schemaVersion.endsWith("/v3") ? "v3" : "v2"} integration selection integrationId mismatch`,
      );
    }
    if (waveSelection.baseSha !== baseSha) {
      throw new Error(
        `${schemaVersion.endsWith("/v3") ? "v3" : "v2"} integration selection base mismatch`,
      );
    }
    if (
      JSON.stringify(result.manifestTranches) !==
      JSON.stringify(selectedTranches)
    ) {
      throw new Error(
        `${schemaVersion.endsWith("/v3") ? "v3" : "v2"} integration selection tranche mismatch`,
      );
    }
    if (schemaVersion === "maestro-brain-integration-result/v2") {
      if (
        !selectionRead.legacy ||
        result.selectionSha256 !== selectionRead.selectionPayloadSha256
      ) {
        throw new Error("v2 integration selection identity mismatch");
      }
    } else {
      if (selectionRead.legacy) {
        throw new Error("v3 integration cannot use a legacy v2 selection");
      }
      if (
        Object.hasOwn(result, "selectionSha256") ||
        Object.hasOwn(result, "selection_sha256")
      ) {
        throw new Error(
          "v3 integration result contains an ambiguous selection hash",
        );
      }
      if (
        result.selectionPayloadSha256 !== selectionRead.selectionPayloadSha256
      ) {
        throw new Error("v3 integration selection payload hash mismatch");
      }
      if (result.selectionFileSha256 !== selectionRead.selectionFileSha256) {
        throw new Error("v3 integration selection file hash mismatch");
      }
    }
    if (
      !Array.isArray(result.remainingFindings) ||
      result.remainingFindings.length !== 0
    ) {
      throw new Error("passed wave integration has remaining findings");
    }
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
  const receiptPath = broadGateReceiptPath(
    input.evidenceDirectory,
    input.integrationId,
    headSha,
  );
  if (existsSync(receiptPath)) {
    const sidecar = readBroadGateReceipt(receiptPath);
    validateBroadGateReceipt(sidecar, headSha);
    if (!isDeepStrictEqual(broadGate, sidecar)) {
      throw new Error("recorded broad gate does not match its audited sidecar");
    }
  }
  if (!Array.isArray(result.includedTasks)) {
    throw new Error("no included tasks");
  }
  return {
    baseSha,
    controlRoot,
    headSha,
    includedTasks: result.includedTasks,
    result,
    ...(waveSelection ? { waveSelection } : {}),
    workdir,
  };
};

export const validateIntegrationResultEnvelope = (
  input: IntegrationResultCheckInput,
): void => {
  validatedIntegrationEnvelope(input);
};

export const validateIntegrationResult = (
  input: IntegrationResultCheckInput,
): void => {
  const {
    baseSha,
    controlRoot,
    headSha,
    includedTasks,
    result,
    waveSelection,
    workdir,
  } = validatedIntegrationEnvelope(input);
  validateIntegratedLanes({
    baseSha,
    controlRoot,
    evidenceDirectory: input.evidenceDirectory,
    headSha,
    includedTasks,
    integrationId: input.integrationId,
    ...(input.manifestTranche
      ? { manifestTranche: input.manifestTranche }
      : {}),
    ...(waveSelection ? { waveSelection } : {}),
    workdir,
  });
  if (waveSelection) {
    const laneFiles = new Set(
      waveSelection.selectedTasks.flatMap((task) => task.changedFiles),
    );
    const changedFiles = git(workdir, [
      "diff",
      "--name-only",
      `${baseSha}..${headSha}`,
    ])
      .split("\n")
      .filter(Boolean)
      .sort();
    const missing = [...laneFiles].filter(
      (file) => !changedFiles.includes(file),
    );
    if (missing.length > 0) {
      throw new Error(
        `wave integration omits lane-owned files: ${missing.join(", ")}`,
      );
    }
    const commits = git(workdir, [
      "rev-list",
      "--reverse",
      `${baseSha}..${headSha}`,
    ])
      .split("\n")
      .filter(Boolean);
    const commitSet = new Set(commits);
    const repairFiles = new Set<string>();
    if (result.mode === "recover") {
      if (!Array.isArray(result.repairCommits)) {
        throw new Error("recovery integration has no repair commits");
      }
      for (const [index, value] of result.repairCommits.entries()) {
        const repair = record(value, `repairCommits[${index}]`);
        const sha = string(repair.sha, `repairCommits[${index}].sha`);
        string(repair.summary, `repairCommits[${index}].summary`);
        string(repair.taskId, `repairCommits[${index}].taskId`);
        if (!commitSet.has(sha)) {
          throw new Error(`${sha}: repair commit is outside the integration`);
        }
        for (const file of git(workdir, [
          "diff",
          "--name-only",
          `${sha}^1..${sha}`,
        ])
          .split("\n")
          .filter(Boolean)) {
          repairFiles.add(file);
        }
      }
    }
    const generatedFiles = changedFiles.filter(
      (file) => !laneFiles.has(file) && !repairFiles.has(file),
    );
    const confectSourceFiles = git(workdir, [
      "ls-tree",
      "-r",
      "--name-only",
      headSha,
      "--",
      "packages/convex/confect",
    ])
      .split("\n")
      .filter(
        (file) =>
          file.endsWith(".impl.ts") ||
          /^packages\/convex\/confect\/tables\/[^/]+\.ts$/.test(file),
      );
    const generatedAllowlist = integrationGeneratedFileAllowlist({
      confectSourceFiles,
      laneFiles: [...laneFiles],
    });
    if (generatedFiles.some((file) => !generatedAllowlist.has(file))) {
      throw new Error(
        "wave integration contains non-lane, non-generated files",
      );
    }
    if (
      !Array.isArray(result.generatedFiles) ||
      JSON.stringify(result.generatedFiles) !== JSON.stringify(generatedFiles)
    ) {
      throw new Error("wave generated-file receipt mismatch");
    }
    for (const commit of commits) {
      const commitFiles = git(workdir, [
        "show",
        "--name-only",
        "--format=",
        commit,
      ])
        .split("\n")
        .filter(Boolean);
      if (
        commitFiles.length > 0 &&
        commitFiles.every((file) => generatedAllowlist.has(file))
      ) {
        continue;
      }
      const lines = changedHandAuthoredSourceLines(
        git(workdir, ["show", "--numstat", "--format=", commit]),
      );
      if (lines > 300) {
        throw new Error(
          `${commit}: integration slice changes ${lines} source lines`,
        );
      }
    }
  }
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
  const selectionPath = valueAfter("--wave-selection");
  const integrationId = valueAfter("--integration-id");
  const adoptLegacyEvidence = process.argv.includes("--adopt-legacy-evidence");
  if (
    !controlRoot ||
    !workdir ||
    !evidence ||
    !integrationId ||
    (!manifestTranche && !selectionPath)
  ) {
    throw new Error(
      "usage: integration-result-check --control-root ... --workdir ... --evidence ... " +
        "--integration-id ... (--manifest-tranche ... | --wave-selection ...)",
    );
  }
  const checkInput = {
    controlRoot,
    evidenceDirectory: evidence,
    expectedWorkdir: workdir,
    integrationId,
    ...(manifestTranche ? { manifestTranche } : {}),
    ...(selectionPath ? { selectionPath } : {}),
  };
  if (adoptLegacyEvidence) {
    validateIntegrationResultEnvelope(checkInput);
    const adopted = adoptLegacyIntegratedLaneEvidence({
      controlRoot,
      currentHeadSha: git(realpathSync(workdir), ["rev-parse", "HEAD"]),
      evidenceDirectory: evidence,
      workdir,
    });
    if (adopted.length > 0) {
      console.log(
        `adopted authoritative legacy lane evidence: ${adopted
          .map(({ integrationId: id, taskId }) => `${taskId}@${id}`)
          .join(", ")}`,
      );
    }
  }
  validateIntegrationResult(checkInput);
  const archived = archiveIntegrationEvidence({
    evidenceDirectory: evidence,
    integrationId,
    ...(manifestTranche ? { manifestTranche } : {}),
  });
  console.log(
    `${integrationId}: integration record check passed; archived ${archived.contentSha256}`,
  );
}
