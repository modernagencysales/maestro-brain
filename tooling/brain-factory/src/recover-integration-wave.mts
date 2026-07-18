import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { hydrateWorktreeDependencies } from "./dependencies.js";
import {
  acquireIntegrationOwnership,
  fabroRunId,
  GLOBAL_INTEGRATION_LOCK,
  gitSha,
  integrationLockPath,
  safeAbsolutePath,
} from "./integration-recovery.js";
import { record, string } from "./integration-check-support.js";
import { readIntegrationWaveSelection } from "./integration-wave.js";
import {
  materializeImmutableWaveSelection,
  replaceWaveRunRecord,
  verifyWaveRunInspection,
  waveWorkflowArgs,
  waveModeForWorktree,
  waveWorktreeRecoveryAction,
  type WaveRunIdentity,
} from "./integration-wave-launch.js";
import {
  gitBranchExists,
  gitIsAncestor,
  runRtk,
  runRtkToFile,
} from "./process.js";

const valueAfter = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const integrationId = valueAfter("--integration-id");
const reason = valueAfter("--recovery-reason");
if (!integrationId || !/^wave-\d{6}$/.test(integrationId) || !reason?.trim()) {
  throw new Error(
    "usage: brain:factory:recover-wave -- --integration-id wave-NNNNNN --recovery-reason <text>",
  );
}

const root = process.cwd();
const state = safeAbsolutePath(
  resolve(valueAfter("--state") ?? ".fabro/state/maestro-brain"),
  "state path",
);
const evidence = resolve(state, "evidence");
const runs = resolve(state, "runs");
const recordPath = resolve(runs, `integration-${integrationId}.json`);
const workflow = resolve(
  ".fabro/workflows/brain-integrate-wave/workflow.fabro",
);
if (!existsSync(recordPath) || !existsSync(workflow)) {
  throw new Error(`${integrationId}: missing durable run record or workflow`);
}
const gitCommonDirectory = safeAbsolutePath(
  resolve(
    root,
    runRtk(["git", "rev-parse", "--git-common-dir"], { quiet: true }),
  ),
  "Git common directory",
);
const releaseOwnership = acquireIntegrationOwnership({
  lockPath: integrationLockPath(gitCommonDirectory, GLOBAL_INTEGRATION_LOCK),
  owner: {
    action: "recover-integration-wave",
    at: new Date().toISOString(),
    integrationId,
    pid: process.pid,
    reason: reason.trim(),
  },
});

try {
  let currentContent = readFileSync(recordPath, "utf8");
  let runRecord = record(JSON.parse(currentContent), "wave run record");
  const runSchema = string(runRecord.schemaVersion, "wave run schema");
  if (
    !new Set([
      "maestro-brain-integration-wave-run/v2",
      "maestro-brain-integration-wave-run/v3",
    ]).has(runSchema) ||
    runRecord.integrationId !== integrationId
  ) {
    throw new Error(`${integrationId}: run record identity mismatch`);
  }
  const baseSha = gitSha(runRecord.baseSha, "wave baseSha");
  const workdir = safeAbsolutePath(runRecord.workdir, "wave workdir");
  const expectedWorkdir = resolve(
    root,
    "..",
    ".maestro-brain-fabro-workdirs",
    `integration-${integrationId}`,
  );
  const expectedBranch = `fabro/brain-${integrationId}`;
  if (workdir !== expectedWorkdir || runRecord.branch !== expectedBranch) {
    throw new Error(`${integrationId}: recorded worktree or branch mismatch`);
  }
  const selectionPath = safeAbsolutePath(
    runRecord.selectionPath,
    "wave selection path",
  );
  const legacy = runSchema === "maestro-brain-integration-wave-run/v2";
  if (
    !legacy &&
    (Object.hasOwn(runRecord, "selectionSha256") ||
      Object.hasOwn(runRecord, "selection_sha256"))
  ) {
    throw new Error(`${integrationId}: v3 run has an ambiguous selection hash`);
  }
  if (!existsSync(selectionPath)) {
    if (legacy) {
      throw new Error(
        `${integrationId}: historical v2 selection bytes are missing and cannot be recreated`,
      );
    }
    materializeImmutableWaveSelection(
      selectionPath,
      record(runRecord.selection, "reserved wave selection") as never,
    );
  }
  const selectionRead = readIntegrationWaveSelection(
    readFileSync(selectionPath, "utf8"),
  );
  const selection = selectionRead.selection;
  if (
    selection.integrationId !== integrationId ||
    selection.baseSha !== baseSha ||
    selectionRead.legacy !== legacy ||
    JSON.stringify(runRecord.selection) !== JSON.stringify(selection)
  ) {
    throw new Error(`${integrationId}: immutable selection drift`);
  }
  if (legacy) {
    if (
      string(runRecord.selectionSha256, "wave selection hash") !==
      selectionRead.selectionPayloadSha256
    ) {
      throw new Error(`${integrationId}: immutable v2 selection drift`);
    }
  } else if (
    string(runRecord.selectionPayloadSha256, "wave selection payload hash") !==
      selectionRead.selectionPayloadSha256 ||
    string(runRecord.selectionFileSha256, "wave selection file hash") !==
      selectionRead.selectionFileSha256
  ) {
    throw new Error(`${integrationId}: immutable v3 selection drift`);
  }
  const worktreeAction = waveWorktreeRecoveryAction({
    branchExists: gitBranchExists(expectedBranch, root),
    worktreeExists: existsSync(workdir),
  });
  if (worktreeAction !== "reuse") {
    if (worktreeAction === "attach-branch") {
      runRtk(["git", "worktree", "add", workdir, expectedBranch], {
        cwd: root,
      });
    } else {
      runRtk(
        ["git", "worktree", "add", "-b", expectedBranch, workdir, baseSha],
        {
          cwd: root,
        },
      );
    }
    hydrateWorktreeDependencies(root, workdir);
  }
  const worktreeHead = gitSha(
    runRtk(["git", "rev-parse", "HEAD"], { cwd: workdir, quiet: true }),
    "wave worktree HEAD",
  );
  const branchHead = gitSha(
    runRtk(["git", "rev-parse", `refs/heads/${expectedBranch}`], {
      cwd: root,
      quiet: true,
    }),
    "wave branch HEAD",
  );
  if (
    branchHead !== worktreeHead ||
    !gitIsAncestor(baseSha, worktreeHead, workdir)
  ) {
    throw new Error(`${integrationId}: wave worktree ancestry drift`);
  }
  const inspect = (runId: string): unknown =>
    JSON.parse(
      runRtk(["fabro", "inspect", runId, "--json", "--quiet"], { quiet: true }),
    );
  const discoverRecordedLaunch = (
    rawPath: string,
    identity: WaveRunIdentity,
  ): string | undefined => {
    if (!existsSync(rawPath)) return undefined;
    let inspection: unknown;
    let runId: string;
    try {
      const raw = record(
        JSON.parse(readFileSync(rawPath, "utf8")),
        "raw launch",
      );
      runId = fabroRunId(raw.run_id ?? raw.runId, "raw wave run ID");
      inspection = inspect(runId);
    } catch {
      inspection = JSON.parse(
        runRtk(
          ["fabro", "inspect", "BrainIntegrateWave", "--json", "--quiet"],
          { quiet: true },
        ),
      );
      const recent = record(
        Array.isArray(inspection) ? inspection[0] : inspection,
        "most recent wave run",
      );
      runId = fabroRunId(recent.run_id, "discovered wave run ID");
    }
    verifyWaveRunInspection(inspection, { ...identity, runId });
    return runId;
  };
  const launchOrDiscover = (
    identity: WaveRunIdentity,
    rawPath: string,
    outcomePath: string,
  ): string => {
    const discovered = discoverRecordedLaunch(rawPath, identity);
    if (discovered) return discovered;
    const raw = record(
      JSON.parse(
        runRtkToFile(
          waveWorkflowArgs({
            ...identity,
            controlRoot: root,
            evidenceDirectory: evidence,
            workflow,
          }),
          rawPath,
          { outcomePath },
        ),
      ),
      "wave launch output",
    );
    const runId = fabroRunId(raw.run_id ?? raw.runId, "wave run ID");
    verifyWaveRunInspection(inspect(runId), { ...identity, runId });
    return runId;
  };
  const reservationToken = string(
    runRecord.reservationToken,
    "wave reservation token",
  );
  const identityFor = (
    mode: "integrate" | "recover",
    attempt: number,
  ): WaveRunIdentity =>
    ({
      attempt,
      baseSha,
      integrationId,
      mode,
      reservationToken,
      selectionPath,
      ...(legacy
        ? { selectionSha256: selectionRead.selectionPayloadSha256 }
        : {
            selectionFileSha256: selectionRead.selectionFileSha256,
            selectionPayloadSha256: selectionRead.selectionPayloadSha256,
          }),
      workdir,
    }) as WaveRunIdentity;
  let runId =
    typeof runRecord.runId === "string"
      ? fabroRunId(runRecord.runId, "recorded wave run ID")
      : undefined;
  if (!runId) {
    if (legacy) {
      throw new Error(
        `${integrationId}: historical v2 run has no launch and cannot create a new attempt`,
      );
    }
    const rawPath = `${recordPath}.launch-1.raw`;
    const integrateIdentity = identityFor("integrate", 1);
    runId = launchOrDiscover(
      integrateIdentity,
      rawPath,
      `${rawPath}.outcome.json`,
    );
    replaceWaveRunRecord(recordPath, currentContent, {
      ...runRecord,
      activeMode: "integrate",
      attempt: 1,
      runId,
      runIds: [runId],
      status: "launched",
    });
    currentContent = readFileSync(recordPath, "utf8");
    runRecord = record(JSON.parse(currentContent), "wave run record");
  }
  const activeMode =
    runRecord.activeMode === "recover" ? "recover" : ("integrate" as const);
  const exactInspection = inspect(runId);
  verifyWaveRunInspection(exactInspection, {
    ...identityFor(activeMode, Number(runRecord.attempt ?? 1)),
    runId,
  });
  const inspected = record(
    Array.isArray(exactInspection) ? exactInspection[0] : exactInspection,
    "wave run inspection",
  );
  const statusValue = inspected.status;
  const status =
    typeof statusValue === "string"
      ? statusValue
      : string(
          record(statusValue, "wave run status").kind,
          "wave run status kind",
        );
  const terminalFailure = new Set([
    "failed",
    "canceled",
    "cancelled",
    "dead",
    "interrupted",
  ]).has(status);
  if (!terminalFailure) {
    console.log(
      `${integrationId}: reconciled exact run ${runId} in status ${status}; no replacement launched`,
    );
  } else {
    if (legacy) {
      throw new Error(
        `${integrationId}: historical v2 run failed; a new v2 recovery attempt is forbidden`,
      );
    }
    const attempt = Number(runRecord.attempt ?? 1) + 1;
    if (!Number.isInteger(attempt) || attempt < 2 || attempt > 20) {
      throw new Error(`${integrationId}: recovery attempt limit exceeded`);
    }
    const rawPath = `${recordPath}.launch-${attempt}.raw`;
    const outcomePath = `${rawPath}.outcome.json`;
    const recoveryMode = waveModeForWorktree(baseSha, worktreeHead);
    const recoveryIdentity = identityFor(recoveryMode, attempt);
    const recoveryRunId = launchOrDiscover(
      recoveryIdentity,
      rawPath,
      outcomePath,
    );
    const previousRunIds = Array.isArray(runRecord.runIds)
      ? runRecord.runIds.map((value, index) =>
          fabroRunId(value, `runIds[${index}]`),
        )
      : [runId];
    replaceWaveRunRecord(recordPath, currentContent, {
      ...runRecord,
      activeMode: recoveryMode,
      attempt,
      recoveredAt: new Date().toISOString(),
      recoveryReason: reason.trim(),
      runId: recoveryRunId,
      runIds: [...previousRunIds, recoveryRunId],
      status: "launched",
    });
    console.log(`${integrationId}: launched recovery ${recoveryRunId}`);
  }
} finally {
  releaseOwnership();
}
