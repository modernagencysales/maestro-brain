export interface PlanOnlyLaneAuthorityTransition {
  readonly schemaVersion: "maestro-brain-plan-only-lane-authority/v1";
  readonly fromPlanSha256: string;
  readonly taskBlockHash: string;
  readonly sourceRunId: string;
  readonly sourceBaseSha: string;
  readonly sourceHeadSha: string;
  readonly sourceTreeSha: string;
  readonly sourceCommits: readonly string[];
  readonly sourceCommitPatchSha256s: readonly string[];
  readonly laneResultSha256: string;
  readonly ciProofPacketSha256: string;
  readonly laneGateReportSha256: string;
  readonly requiredIntegratedTaskIds: readonly string[];
}

const allowedTaskIds = new Set(["S06-T01", "S11-T02", "S13-T02"]);
const keys = [
  "schemaVersion",
  "taskId",
  "fromPlanSha256",
  "taskBlockHash",
  "sourceRunId",
  "sourceBaseSha",
  "sourceHeadSha",
  "sourceTreeSha",
  "sourceCommits",
  "sourceCommitPatchSha256s",
  "laneResultSha256",
  "ciProofPacketSha256",
  "laneGateReportSha256",
  "requiredIntegratedTaskIds",
] as const;

const record = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("plan-only lane authority record must be an object");
  const result = value as Record<string, unknown>;
  if (
    JSON.stringify(Object.keys(result).sort()) !==
    JSON.stringify([...keys].sort())
  )
    throw new Error(
      `plan-only lane authority fields must be exactly ${keys.join(", ")}`,
    );
  return result;
};

const string = (value: unknown, pattern: RegExp, label: string): string => {
  if (typeof value !== "string" || !pattern.test(value))
    throw new Error(`${label} is invalid`);
  return value;
};

const strings = (value: unknown, pattern: RegExp, label: string): string[] => {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || !pattern.test(item)) ||
    new Set(value).size !== value.length
  )
    throw new Error(`${label} must contain unique matching strings`);
  return value as string[];
};

const parseRecord = (
  input: unknown,
): readonly [string, PlanOnlyLaneAuthorityTransition] => {
  const value = record(input);
  const taskId = string(value.taskId, /^S\d{2}-T\d{2}$/, "plan-only task");
  if (!allowedTaskIds.has(taskId))
    throw new Error(`${taskId}: plan-only lane authority is unauthorized`);
  if (value.schemaVersion !== "maestro-brain-plan-only-lane-authority/v1")
    throw new Error(`${taskId}: invalid plan-only authority schema`);
  const sourceCommits = strings(
    value.sourceCommits,
    /^[0-9a-f]{40}$/,
    `${taskId}: commits`,
  );
  const sourceCommitPatchSha256s = strings(
    value.sourceCommitPatchSha256s,
    /^[0-9a-f]{64}$/,
    `${taskId}: patch digests`,
  );
  if (
    sourceCommits.length === 0 ||
    sourceCommits.length !== sourceCommitPatchSha256s.length
  )
    throw new Error(`${taskId}: source lineage cardinality is invalid`);
  const sourceHeadSha = string(
    value.sourceHeadSha,
    /^[0-9a-f]{40}$/,
    `${taskId}: source head`,
  );
  if (sourceCommits.at(-1) !== sourceHeadSha)
    throw new Error(`${taskId}: source history does not end at head`);
  const sha64 = (name: string): string =>
    string(value[name], /^[0-9a-f]{64}$/, `${taskId}: ${name}`);
  return [
    taskId,
    {
      schemaVersion: "maestro-brain-plan-only-lane-authority/v1",
      fromPlanSha256: sha64("fromPlanSha256"),
      taskBlockHash: sha64("taskBlockHash"),
      sourceRunId: string(
        value.sourceRunId,
        /^[0-9A-HJKMNP-TV-Z]{26}$/,
        `${taskId}: source run`,
      ),
      sourceBaseSha: string(
        value.sourceBaseSha,
        /^[0-9a-f]{40}$/,
        `${taskId}: source base`,
      ),
      sourceHeadSha,
      sourceTreeSha: string(
        value.sourceTreeSha,
        /^[0-9a-f]{40}$/,
        `${taskId}: source tree`,
      ),
      sourceCommits,
      sourceCommitPatchSha256s,
      laneResultSha256: sha64("laneResultSha256"),
      ciProofPacketSha256: sha64("ciProofPacketSha256"),
      laneGateReportSha256: sha64("laneGateReportSha256"),
      requiredIntegratedTaskIds: strings(
        value.requiredIntegratedTaskIds,
        /^S\d{2}-T\d{2}$/,
        `${taskId}: prerequisites`,
      ),
    },
  ];
};

export const parsePlanOnlyLaneAuthorityRegistry = (
  plan: string,
): ReadonlyMap<string, PlanOnlyLaneAuthorityTransition> => {
  const marker =
    /## Appendix Q — Plan-only lane authority registry\s*```json\r?\n([\s\S]*?)\r?\n```/g;
  const matches = [...plan.matchAll(marker)];
  if (matches.length === 0) return new Map();
  if (matches.length !== 1)
    throw new Error("duplicate plan-only authority registry");
  const body = matches[0]?.[1];
  if (!body) throw new Error("empty plan-only authority registry");
  const parsed = JSON.parse(body) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0)
    throw new Error("plan-only authority registry must be a non-empty array");
  const result = new Map<string, PlanOnlyLaneAuthorityTransition>();
  for (const input of parsed) {
    const [taskId, transition] = parseRecord(input);
    if (result.has(taskId))
      throw new Error(`duplicate plan-only authority task ${taskId}`);
    result.set(taskId, transition);
  }
  return result;
};
