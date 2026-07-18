import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  acquireIntegrationOwnership,
  fabroRunId,
  GLOBAL_INTEGRATION_LOCK,
  gitSha,
  integrationLockPath,
  safeAbsolutePath,
} from "./integration-recovery.js";
import { record, string } from "./integration-check-support.js";
import { validateIntegrationResult } from "./integration-result-check.mjs";
import { proveIntegrationGeneratedOutput } from "./integration-generated-proof.js";
import {
  type IntegrationWaveSelection,
  readIntegrationWaveSelection,
} from "./integration-wave.js";
import { runRtk } from "./process.js";
import {
  promotionAction,
  verifyPassedVersionedWaveRunInspection,
} from "./integration-wave-launch.js";

const valueAfter = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const integrationId = valueAfter("--integration-id");
if (!integrationId || !/^wave-\d{6}$/.test(integrationId)) {
  throw new Error(
    "usage: brain:factory:promote-wave -- --integration-id wave-NNNNNN",
  );
}

const root = process.cwd();
const state = safeAbsolutePath(
  resolve(valueAfter("--state") ?? ".fabro/state/maestro-brain"),
  "state path",
);
const evidence = resolve(state, "evidence");
const runRecordPath = resolve(
  state,
  "runs",
  `integration-${integrationId}.json`,
);
const resultDirectory = resolve(evidence, "integration", integrationId);
const resultPath = resolve(resultDirectory, "integration-result.json");
const promotionPath = resolve(resultDirectory, "promotion.json");
if (!existsSync(runRecordPath) || !existsSync(resultPath)) {
  throw new Error(`${integrationId}: missing run or passed-result evidence`);
}
const runRecord = record(
  JSON.parse(readFileSync(runRecordPath, "utf8")),
  "wave run record",
);
const runSchema = string(runRecord.schemaVersion, "wave run schema");
if (
  !new Set([
    "maestro-brain-integration-wave-run/v2",
    "maestro-brain-integration-wave-run/v3",
  ]).has(runSchema) ||
  runRecord.integrationId !== integrationId
) {
  throw new Error(`${integrationId}: wave run record mismatch`);
}
const selectionPath = safeAbsolutePath(
  runRecord.selectionPath,
  "wave selection path",
);
const selectionRead = readIntegrationWaveSelection(readFileSync(selectionPath));
const selection: IntegrationWaveSelection = selectionRead.selection;
const legacy = runSchema === "maestro-brain-integration-wave-run/v2";
if (
  !legacy &&
  (Object.hasOwn(runRecord, "selectionSha256") ||
    Object.hasOwn(runRecord, "selection_sha256"))
) {
  throw new Error(`${integrationId}: v3 run has an ambiguous selection hash`);
}
const result = record(
  JSON.parse(readFileSync(resultPath, "utf8")),
  "wave result",
);
const baseSha = gitSha(result.baseSha, "wave result base");
const headSha = gitSha(result.headSha, "wave result head");
const workdir = safeAbsolutePath(
  result.integrationWorkdir,
  "wave integration workdir",
);
if (
  result.schemaVersion !==
    (legacy
      ? "maestro-brain-integration-result/v2"
      : "maestro-brain-integration-result/v3") ||
  result.integrationId !== integrationId ||
  safeAbsolutePath(runRecord.workdir, "recorded wave workdir") !== workdir ||
  runRecord.branch !== `fabro/brain-${integrationId}` ||
  selection.baseSha !== baseSha ||
  JSON.stringify(runRecord.selection) !== JSON.stringify(selection) ||
  selectionRead.legacy !== legacy
) {
  throw new Error(`${integrationId}: wave result selection mismatch`);
}
if (legacy) {
  if (
    result.selectionSha256 !== selectionRead.selectionPayloadSha256 ||
    string(runRecord.selectionSha256, "run selection hash") !==
      selectionRead.selectionPayloadSha256
  ) {
    throw new Error(`${integrationId}: v2 wave result selection mismatch`);
  }
} else if (
  result.selectionPayloadSha256 !== selectionRead.selectionPayloadSha256 ||
  result.selectionFileSha256 !== selectionRead.selectionFileSha256 ||
  string(runRecord.selectionPayloadSha256, "run selection payload hash") !==
    selectionRead.selectionPayloadSha256 ||
  string(runRecord.selectionFileSha256, "run selection file hash") !==
    selectionRead.selectionFileSha256
) {
  throw new Error(`${integrationId}: v3 wave result selection mismatch`);
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
    action: legacy
      ? "promote-integration-wave-v2"
      : "promote-integration-wave-v3",
    at: new Date().toISOString(),
    integrationId,
    pid: process.pid,
  },
});

try {
  const runId = fabroRunId(runRecord.runId, "wave run ID");
  const attempt = Number(runRecord.attempt);
  const activeMode: "integrate" | "recover" =
    runRecord.activeMode === "recover" ? "recover" : "integrate";
  const reservationToken = string(
    runRecord.reservationToken,
    "wave reservation token",
  );
  if (
    runRecord.status !== "launched" ||
    !new Set(["integrate", "recover"]).has(String(runRecord.activeMode)) ||
    !Number.isInteger(attempt) ||
    attempt < 1
  ) {
    throw new Error(`${integrationId}: wave run is not promotable`);
  }
  const inspectionIdentity = {
    attempt,
    baseSha,
    integrationId,
    mode: activeMode,
    reservationToken,
    runId,
    selectionPath,
    ...(legacy
      ? { selectionSha256: selectionRead.selectionPayloadSha256 }
      : {
          selectionFileSha256: selectionRead.selectionFileSha256,
          selectionPayloadSha256: selectionRead.selectionPayloadSha256,
        }),
    workdir,
  };
  verifyPassedVersionedWaveRunInspection(
    JSON.parse(
      runRtk(["fabro", "inspect", runId, "--json", "--quiet"], {
        quiet: true,
      }),
    ),
    inspectionIdentity,
  );
  const branchHead = gitSha(
    runRtk(["git", "rev-parse", `refs/heads/fabro/brain-${integrationId}`], {
      quiet: true,
    }),
    "wave branch head",
  );
  if (branchHead !== headSha)
    throw new Error("wave branch and result head differ");
  validateIntegrationResult({
    controlRoot: root,
    evidenceDirectory: evidence,
    expectedWorkdir: workdir,
    integrationId,
    selectionPath,
  });
  const generatedFiles = (result.generatedFiles as string[]) ?? [];
  const laneFiles = selection.selectedTasks.flatMap(
    (task) => task.changedFiles,
  );
  if (
    generatedFiles.length > 0 ||
    laneFiles.some(
      (file) =>
        file.startsWith("packages/convex/confect/") ||
        file.startsWith("apps/web/src/routes/") ||
        file.startsWith("tooling/confect-manifest/"),
    )
  ) {
    proveIntegrationGeneratedOutput({
      baseSha,
      generatedFiles,
      headSha,
      root,
    });
  }
  const trackedStatus = runRtk(
    ["proxy", "git", "status", "--porcelain", "--untracked-files=no"],
    { quiet: true },
  );
  if (trackedStatus !== "")
    throw new Error("control worktree has tracked changes");
  const controlHead = gitSha(
    runRtk(["git", "rev-parse", "HEAD"], { quiet: true }),
    "control HEAD",
  );
  if (existsSync(promotionPath)) {
    const promotion = record(
      JSON.parse(readFileSync(promotionPath, "utf8")),
      "wave promotion",
    );
    if (
      promotion.schemaVersion !==
        (legacy
          ? "maestro-brain-integration-wave-promotion/v2"
          : "maestro-brain-integration-wave-promotion/v3") ||
      promotion.status !== "promoted" ||
      promotion.integrationId !== integrationId ||
      promotion.baseSha !== baseSha ||
      promotion.headSha !== headSha ||
      (legacy
        ? promotion.selectionSha256 !== selectionRead.selectionPayloadSha256
        : promotion.selectionPayloadSha256 !==
            selectionRead.selectionPayloadSha256 ||
          promotion.selectionFileSha256 !== selectionRead.selectionFileSha256 ||
          Object.hasOwn(promotion, "selectionSha256") ||
          Object.hasOwn(promotion, "selection_sha256")) ||
      controlHead !== headSha
    ) {
      throw new Error(`${integrationId}: promotion receipt drift`);
    }
    console.log(`${integrationId}: promotion already recorded at ${headSha}`);
  } else {
    const action = promotionAction(controlHead, baseSha, headSha);
    if (action === "fast-forward") {
      runRtk(["git", "merge", "--ff-only", headSha]);
    }
    const promotedHead = gitSha(
      runRtk(["git", "rev-parse", "HEAD"], { quiet: true }),
      "promoted control HEAD",
    );
    if (promotedHead !== headSha)
      throw new Error("fast-forward promotion head mismatch");
    mkdirSync(resultDirectory, { recursive: true });
    writeFileSync(
      promotionPath,
      `${JSON.stringify(
        {
          at: new Date().toISOString(),
          baseSha,
          headSha,
          integrationId,
          schemaVersion: legacy
            ? "maestro-brain-integration-wave-promotion/v2"
            : "maestro-brain-integration-wave-promotion/v3",
          ...(legacy
            ? { selectionSha256: selectionRead.selectionPayloadSha256 }
            : {
                selectionFileSha256: selectionRead.selectionFileSha256,
                selectionPayloadSha256: selectionRead.selectionPayloadSha256,
              }),
          status: "promoted",
        },
        null,
        2,
      )}\n`,
      { flag: "wx" },
    );
    console.log(`${integrationId}: fast-forward promoted ${headSha}`);
  }
} finally {
  releaseOwnership();
}
