import { resolve } from "node:path";

import { buildTaskLaunchEnv } from "./build-task-launch-env.js";
import { materializeBuildTaskRunConfig } from "./build-task-run-config.js";
import { promoteTaskReservation } from "./dispatch-ownership.js";
import type { PlanOnlyLaneAuthorityAdmission } from "./plan-only-lane-authority.js";
import { gitCommonDir, runRtk } from "./process.js";

export const createPlanOnlyFabroRun = (input: {
  readonly admission: PlanOnlyLaneAuthorityAdmission;
  readonly branch: string;
  readonly candidateHeadSha: string;
  readonly configInputs: Readonly<Record<string, unknown>>;
  readonly controlHeadSha: string;
  readonly evidence: string;
  readonly preparingRecord: Readonly<Record<string, unknown>>;
  readonly recordPath: string;
  readonly root: string;
  readonly state: string;
  readonly taskId: string;
  readonly workdir: string;
}): { readonly env: NodeJS.ProcessEnv; readonly runId: string } => {
  const env = buildTaskLaunchEnv({
    authorityRepairArchive: "none",
    baseSha: input.controlHeadSha,
    controlCommonDir: gitCommonDir(input.root),
    controlRoot: input.root,
    evidence: input.evidence,
    hostTestMaxLoad1m: "20",
    reproofRequest: "none",
    resumeBranch: input.branch,
    resumeCommits: input.admission.sourceCommits.join(","),
    resumeExpectedCommit: input.candidateHeadSha,
    resumeMode: "plan-only-authority",
    resumeProofHead: input.admission.sourceHeadSha,
    resumeSourceHead: input.admission.sourceHeadSha,
    resumeTaskBase: input.admission.sourceBaseSha,
    startSha: input.candidateHeadSha,
    taskId: input.taskId,
    workdir: input.workdir,
  });
  promoteTaskReservation(input.recordPath, {
    ...input.preparingRecord,
    phase: "creating",
  });
  const config = materializeBuildTaskRunConfig({
    env,
    graph: resolve(
      input.root,
      ".fabro/workflows/brain-build-task/workflow.fabro",
    ),
    path: resolve(
      input.state,
      "launch-configs",
      `plan-only-${input.taskId}.toml`,
    ),
  });
  const created = JSON.parse(
    runRtk(
      [
        "fabro",
        "create",
        config,
        "--json",
        "--no-upgrade-check",
        "--environment",
        "local",
        "--label",
        `task=${input.taskId}`,
        "--label",
        "mode=plan-only-lane-authority",
        ...Object.entries(input.configInputs).flatMap(([key, value]) => [
          "-I",
          `${key}=${String(value)}`,
        ]),
      ],
      { env, quiet: true },
    ),
  ) as { run_id?: string; runId?: string };
  return { env, runId: created.run_id ?? created.runId ?? "" };
};
