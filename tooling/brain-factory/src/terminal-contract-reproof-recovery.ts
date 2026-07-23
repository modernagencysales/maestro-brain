import type { TerminalContractReproofRecord } from "./terminal-contract-reproof-resume.js";

export const reconcileTerminalContractReproofCreating = (input: {
  readonly inspect: (runId: string) => {
    readonly inputs: TerminalContractReproofRecord;
    readonly runId: string;
    readonly status: string;
  };
  readonly owner: TerminalContractReproofRecord;
  readonly promote: (runId: string) => void;
  readonly start: (runId: string) => void;
  readonly taskId: string;
}): string => {
  if (
    input.owner.mode !== "contract-reproof" ||
    input.owner.status !== "preparing" ||
    input.owner.phase !== "creating"
  )
    throw new Error(`${input.taskId}: creating owner mode drift`);
  const runId = String(input.owner.runId ?? "");
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(runId))
    throw new Error(`${input.taskId}: creating owner run ID is invalid`);
  const expected = input.owner.expectedRunInputs;
  if (
    typeof expected !== "object" ||
    expected === null ||
    Array.isArray(expected)
  )
    throw new Error(`${input.taskId}: creating owner inputs are missing`);
  const inspection = input.inspect(runId);
  if (
    inspection.runId !== runId ||
    Object.entries(expected as TerminalContractReproofRecord).some(
      ([key, value]) => inspection.inputs[key] !== value,
    )
  )
    throw new Error(`${input.taskId}: creating run identity drift`);
  if (inspection.status === "created") input.start(runId);
  else if (!new Set(["running", "succeeded", "failed"]).has(inspection.status))
    throw new Error(`${input.taskId}: creating run status is unsafe`);
  input.promote(runId);
  return runId;
};
