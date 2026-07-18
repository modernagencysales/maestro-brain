import {
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";

import {
  fabroRunId,
  gitSha,
  safeAbsolutePath,
} from "./integration-recovery.js";
import {
  record,
  string,
  type JsonRecord,
} from "./integration-check-support.js";

export interface WaveRunIdentity {
  readonly attempt: number;
  readonly baseSha: string;
  readonly integrationId: string;
  readonly mode: "integrate" | "recover";
  readonly reservationToken: string;
  readonly selectionFileSha256: string;
  readonly selectionPath: string;
  readonly selectionPayloadSha256: string;
  readonly workdir: string;
}

export interface LegacyV2WaveRunIdentity {
  readonly attempt: number;
  readonly baseSha: string;
  readonly integrationId: string;
  readonly mode: "integrate" | "recover";
  readonly reservationToken: string;
  readonly selectionPath: string;
  readonly selectionSha256: string;
  readonly workdir: string;
}

export type VersionedWaveRunIdentity =
  WaveRunIdentity | LegacyV2WaveRunIdentity;

export const promotionAction = (
  controlHead: string,
  baseSha: string,
  integrationHead: string,
): "fast-forward" | "record-after-crash" => {
  if (controlHead === baseSha) return "fast-forward";
  if (controlHead === integrationHead) return "record-after-crash";
  throw new Error(
    `control HEAD diverged from ${baseSha}; rebuild the wave and rerun full verify`,
  );
};

export const waveModeForWorktree = (
  baseSha: string,
  worktreeHead: string,
): "integrate" | "recover" =>
  baseSha === worktreeHead ? "integrate" : "recover";

export const waveWorktreeRecoveryAction = (input: {
  readonly branchExists: boolean;
  readonly worktreeExists: boolean;
}): "attach-branch" | "create-branch" | "reuse" =>
  input.worktreeExists
    ? "reuse"
    : input.branchExists
      ? "attach-branch"
      : "create-branch";

export const materializeImmutableWaveSelection = (
  path: string,
  value: unknown,
): void => {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  if (existsSync(path)) {
    if (readFileSync(path, "utf8") !== content) {
      throw new Error("immutable wave selection conflicts with reservation");
    }
    return;
  }
  writeFileSync(path, content, { flag: "wx" });
};

const assertV3WaveRunIdentity = (input: WaveRunIdentity): void => {
  const value = input as unknown as Record<string, unknown>;
  if (
    Object.prototype.hasOwnProperty.call(value, "selectionSha256") ||
    Object.prototype.hasOwnProperty.call(value, "selection_sha256")
  ) {
    throw new Error("ambiguous selection hash field is forbidden in v3");
  }
  for (const [label, digest] of [
    ["selectionPayloadSha256", input.selectionPayloadSha256],
    ["selectionFileSha256", input.selectionFileSha256],
  ] as const) {
    if (!/^[0-9a-f]{64}$/.test(digest)) {
      throw new Error(`${label} must be a 64-hex SHA-256`);
    }
  }
};

export const waveWorkflowArgs = (
  input: WaveRunIdentity & {
    readonly controlRoot: string;
    readonly evidenceDirectory: string;
    readonly workflow: string;
  },
): string[] => {
  assertV3WaveRunIdentity(input);
  return [
    "fabro",
    "run",
    input.workflow,
    "--detach",
    "--json",
    "--no-upgrade-check",
    "--environment",
    "local",
    "--label",
    `integration=${input.integrationId}`,
    "--label",
    "integration-mode=wave-v3",
    "--label",
    `reservation=${input.reservationToken}`,
    "--label",
    `attempt=${input.attempt}`,
    "-I",
    `workdir=${input.workdir}`,
    "-I",
    `control_root=${input.controlRoot}`,
    "-I",
    `evidence_dir=${input.evidenceDirectory}`,
    "-I",
    `integration_id=${input.integrationId}`,
    "-I",
    `base_sha=${input.baseSha}`,
    "-I",
    `attempt=${input.attempt}`,
    "-I",
    `selection_path=${input.selectionPath}`,
    "-I",
    `selection_payload_sha256=${input.selectionPayloadSha256}`,
    "-I",
    `selection_file_sha256=${input.selectionFileSha256}`,
    "-I",
    `mode=${input.mode}`,
    "-I",
    `reservation_token=${input.reservationToken}`,
  ];
};

export const verifyWaveRunInspection = (
  value: unknown,
  expected: WaveRunIdentity & { readonly runId: string },
): void => {
  assertV3WaveRunIdentity(expected);
  const items = Array.isArray(value) ? value : [value];
  if (items.length !== 1)
    throw new Error("wave run inspection must contain one run");
  const run = record(items[0], "wave run");
  if (fabroRunId(run.run_id, "wave run ID") !== expected.runId) {
    throw new Error("wave run ID mismatch");
  }
  const runSpec = record(run.run_spec, "wave run spec");
  const settings = record(runSpec.settings, "wave run settings");
  const configuration = record(settings.run, "wave run configuration");
  const inputs = record(configuration.inputs, "wave run inputs");
  const metadata = record(
    configuration.metadata ?? runSpec.labels ?? run.labels,
    "wave run metadata",
  );
  if (
    Object.prototype.hasOwnProperty.call(inputs, "selection_sha256") ||
    Object.prototype.hasOwnProperty.call(inputs, "selectionSha256")
  ) {
    throw new Error("wave v3 run inspection contains legacy selection_sha256");
  }
  if (
    Number(inputs.attempt) !== expected.attempt ||
    gitSha(inputs.base_sha, "wave run base") !== expected.baseSha ||
    string(inputs.integration_id, "wave integration ID") !==
      expected.integrationId ||
    string(inputs.mode, "wave run mode") !== expected.mode ||
    safeAbsolutePath(inputs.selection_path, "wave selection path") !==
      expected.selectionPath ||
    string(inputs.selection_payload_sha256, "wave selection payload hash") !==
      expected.selectionPayloadSha256 ||
    string(inputs.selection_file_sha256, "wave selection file hash") !==
      expected.selectionFileSha256 ||
    string(inputs.reservation_token, "wave reservation token") !==
      expected.reservationToken ||
    safeAbsolutePath(inputs.workdir, "wave workdir") !== expected.workdir ||
    metadata.integration !== expected.integrationId ||
    metadata["integration-mode"] !== "wave-v3" ||
    metadata.reservation !== expected.reservationToken ||
    Number(metadata.attempt) !== expected.attempt
  ) {
    throw new Error("wave run inspection identity mismatch");
  }
};

export const verifyLegacyV2WaveRunInspection = (
  value: unknown,
  expected: LegacyV2WaveRunIdentity & { readonly runId: string },
): void => {
  const items = Array.isArray(value) ? value : [value];
  if (items.length !== 1)
    throw new Error("legacy wave run inspection must contain one run");
  const run = record(items[0], "legacy wave run");
  if (fabroRunId(run.run_id, "legacy wave run ID") !== expected.runId) {
    throw new Error("legacy wave run ID mismatch");
  }
  const runSpec = record(run.run_spec, "legacy wave run spec");
  const settings = record(runSpec.settings, "legacy wave run settings");
  const configuration = record(settings.run, "legacy wave run configuration");
  const inputs = record(configuration.inputs, "legacy wave run inputs");
  const metadata = record(
    configuration.metadata ?? runSpec.labels ?? run.labels,
    "legacy wave run metadata",
  );
  if (
    Object.prototype.hasOwnProperty.call(inputs, "selection_payload_sha256") ||
    Object.prototype.hasOwnProperty.call(inputs, "selection_file_sha256") ||
    Number(inputs.attempt) !== expected.attempt ||
    gitSha(inputs.base_sha, "legacy wave run base") !== expected.baseSha ||
    string(inputs.integration_id, "legacy wave integration ID") !==
      expected.integrationId ||
    string(inputs.mode, "legacy wave run mode") !== expected.mode ||
    safeAbsolutePath(inputs.selection_path, "legacy wave selection path") !==
      expected.selectionPath ||
    string(inputs.selection_sha256, "legacy wave selection hash") !==
      expected.selectionSha256 ||
    string(inputs.reservation_token, "legacy wave reservation token") !==
      expected.reservationToken ||
    safeAbsolutePath(inputs.workdir, "legacy wave workdir") !==
      expected.workdir ||
    metadata.integration !== expected.integrationId ||
    metadata["integration-mode"] !== "wave-v2" ||
    metadata.reservation !== expected.reservationToken ||
    Number(metadata.attempt) !== expected.attempt
  ) {
    throw new Error("legacy wave run inspection identity mismatch");
  }
};

export const verifyVersionedWaveRunInspection = (
  value: unknown,
  expected: VersionedWaveRunIdentity & { readonly runId: string },
): void => {
  if (Object.hasOwn(expected, "selectionSha256")) {
    verifyLegacyV2WaveRunInspection(
      value,
      expected as LegacyV2WaveRunIdentity & { readonly runId: string },
    );
    return;
  }
  verifyWaveRunInspection(
    value,
    expected as WaveRunIdentity & { readonly runId: string },
  );
};

const verifySucceededWaveRunStatus = (value: unknown, runId: string): void => {
  const items = Array.isArray(value) ? value : [value];
  const run = record(items[0], "wave run");
  const statusValue = run.status;
  const status =
    typeof statusValue === "string"
      ? statusValue
      : string(
          record(statusValue, "wave run status").kind,
          "wave run status kind",
        );
  if (status !== "succeeded") {
    throw new Error(`wave run ${runId} did not succeed (${status})`);
  }
};

export const verifyPassedVersionedWaveRunInspection = (
  value: unknown,
  expected: VersionedWaveRunIdentity & { readonly runId: string },
): void => {
  verifyVersionedWaveRunInspection(value, expected);
  verifySucceededWaveRunStatus(value, expected.runId);
};

export const verifyPassedWaveRunInspection = (
  value: unknown,
  expected: WaveRunIdentity & { readonly runId: string },
): void => {
  verifyWaveRunInspection(value, expected);
  verifySucceededWaveRunStatus(value, expected.runId);
};

export const replaceWaveRunRecord = (
  path: string,
  currentContent: string,
  next: JsonRecord,
): void => {
  const temporary = `${path}.next`;
  writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, {
    flag: "wx",
  });
  try {
    const current = readFileSync(path, "utf8");
    if (current !== currentContent) throw new Error("wave run record changed");
    renameSync(temporary, path);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // Preserve the original failure when the temporary file was already moved.
    }
    throw error;
  }
};
