import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import type { PlanOnlySourceRunProvenance } from "./plan-only-lane-authority.js";
import { runRtk } from "./process.js";

type JsonRecord = Record<string, unknown>;

const record = (value: unknown, label: string): JsonRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${label} is not a JSON object`);
  return value as JsonRecord;
};

const durableSourceRun = (input: {
  readonly baseSha: string;
  readonly evidence: string;
  readonly expectedRunId: string;
  readonly taskId: string;
}): void => {
  const runs = resolve(input.evidence, "..", "runs");
  const matches = readdirSync(runs)
    .filter(
      (name) =>
        name === `${input.taskId}.json` ||
        name.startsWith(`${input.taskId}.json.terminal-`),
    )
    .map((name) =>
      record(
        JSON.parse(readFileSync(resolve(runs, name), "utf8")) as unknown,
        `${input.taskId}: source run ${name}`,
      ),
    )
    .filter(({ runId }) => runId === input.expectedRunId);
  if (
    matches.length !== 1 ||
    matches[0]?.taskId !== input.taskId ||
    matches[0]?.status !== "launched" ||
    matches[0]?.mode !== "resume-review" ||
    matches[0]?.factoryBaseSha !== input.baseSha ||
    matches[0]?.branch !== `fabro/review-${input.taskId.toLowerCase()}`
  )
    throw new Error(`${input.taskId}: immutable source run identity drifted`);
};

export const loadPlanOnlySourceRunProvenance = (input: {
  readonly baseSha: string;
  readonly evidence: string;
  readonly evidenceDirectory: string;
  readonly evidenceSha256s: {
    readonly ciProofPacket: string;
    readonly laneGateReport: string;
    readonly laneResult: string;
  };
  readonly expectedRunId: string;
  readonly lane: JsonRecord;
  readonly proof: JsonRecord;
  readonly taskId: string;
}): PlanOnlySourceRunProvenance => {
  durableSourceRun(input);
  const inspected = JSON.parse(
    runRtk(["fabro", "inspect", input.expectedRunId, "--json", "--quiet"], {
      quiet: true,
    }),
  ) as unknown;
  if (!Array.isArray(inspected) || inspected.length !== 1)
    throw new Error(`${input.taskId}: source run inspection is ambiguous`);
  const run = record(inspected[0], `${input.taskId}: source run`);
  const status = record(run.status, `${input.taskId}: run status`);
  const runSpec = record(run.run_spec, `${input.taskId}: run spec`);
  const settings = record(runSpec.settings, `${input.taskId}: settings`);
  const runSettings = record(settings.run, `${input.taskId}: run settings`);
  const metadata = record(runSettings.metadata, `${input.taskId}: metadata`);
  const inputs = record(runSettings.inputs, `${input.taskId}: inputs`);
  if (
    run.run_id !== input.expectedRunId ||
    status.kind !== "succeeded" ||
    metadata.task !== input.taskId ||
    metadata.mode !== "resume-review" ||
    inputs.task_id !== input.taskId ||
    inputs.base_sha !== input.baseSha ||
    inputs.evidence_dir !== input.evidence
  )
    throw new Error(`${input.taskId}: source run provenance drifted`);
  return {
    baseSha: String(inputs.base_sha),
    ciProofPacketSha256: input.evidenceSha256s.ciProofPacket,
    evidenceDirectory: input.evidenceDirectory,
    laneGateReportSha256: input.evidenceSha256s.laneGateReport,
    laneHeadSha: String(input.lane.headSha),
    laneResultSha256: input.evidenceSha256s.laneResult,
    laneTreeSha: String(input.lane.treeSha),
    mode: String(metadata.mode),
    planSha256: String(input.proof.planSha256),
    runId: String(run.run_id),
    status: String(status.kind),
    taskBlockHash: String(input.proof.taskBlockHash),
    taskId: String(metadata.task),
  };
};
