import type {
  AutopilotPolicy,
  MaintenanceContextPack,
} from "../maintenance/policy";
import type { MaintenanceModelOutput } from "../maintenance/request";

export type MaintainBrainPageInput = {
  readonly workspaceSlug: string;
  readonly contextPackId: string;
  readonly context: MaintenanceContextPack;
  readonly modelOutput: MaintenanceModelOutput;
  readonly autopilot?: AutopilotPolicy | undefined;
};

export const normalizeMaintainBrainPageInput = (
  input: Pick<MaintainBrainPageInput, "workspaceSlug" | "contextPackId">,
): Pick<MaintainBrainPageInput, "workspaceSlug" | "contextPackId"> => ({
  workspaceSlug: input.workspaceSlug.trim(),
  contextPackId: input.contextPackId.trim(),
});

export const validateMaintainBrainPageInput = (
  input: Pick<MaintainBrainPageInput, "workspaceSlug" | "contextPackId">,
): readonly string[] => {
  const errors: string[] = [];
  if (input.workspaceSlug.length === 0)
    errors.push("workspaceSlug must not be blank.");
  if (input.contextPackId.length === 0)
    errors.push("contextPackId must not be blank.");
  return errors;
};
