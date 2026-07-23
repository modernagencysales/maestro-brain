import { recordPreparingTaskLaunch } from "./dispatch-ownership.js";
import { resolveLaneGreenAuthorityReproofReservation } from "./lane-green-authority-reproof-recovery.js";
import { inspectExactLaneGreenCreatingRun } from "./lane-green-authority-reproof-resume.js";

type JsonRecord = Record<string, unknown>;

export const recoverPlanOnlyCreatingRun = (input: {
  readonly auditPath: string;
  readonly branch: string;
  readonly expectedConfigInputs: JsonRecord;
  readonly expectedReservation: JsonRecord;
  readonly inspect: (target: string) => unknown;
  readonly now: string;
  readonly recordPath: string;
  readonly reservation: JsonRecord;
  readonly taskId: string;
  readonly workflowName: string;
}): string | undefined => {
  const priorRunId =
    typeof input.reservation.runId === "string"
      ? input.reservation.runId
      : undefined;
  const discovered = inspectExactLaneGreenCreatingRun({
    inspect: input.inspect,
    ...(priorRunId ? { priorRunId } : {}),
    taskId: input.taskId,
    workflowName: input.workflowName,
  });
  if (discovered.kind === "no-run") return undefined;
  const reservationWithoutRun = Object.fromEntries(
    Object.entries(input.reservation).filter(([key]) => key !== "runId"),
  );
  const recovery = resolveLaneGreenAuthorityReproofReservation({
    candidates: [{ branch: input.branch, inspection: discovered.inspection }],
    expectedConfigInputs: input.expectedConfigInputs,
    expectedReservation: input.expectedReservation,
    reservation: priorRunId ? reservationWithoutRun : input.reservation,
  });
  if (recovery.kind !== "recover-launched")
    throw new Error(`${input.taskId}: creating run identity is ambiguous`);
  if (!priorRunId) {
    recordPreparingTaskLaunch({
      auditPath: input.auditPath,
      expected: input.expectedReservation,
      now: input.now,
      recordPath: input.recordPath,
      runId: recovery.runId,
      taskId: input.taskId,
    });
  }
  return recovery.runId;
};
