import { requireActiveLifecycle, type MaintenanceContextPack } from "./policy";

export type GatherMaintenanceInput = MaintenanceContextPack & {
  readonly routedUnitKeys: readonly string[];
};

export const gatherMaintenanceContextPack = (
  input: GatherMaintenanceInput,
): MaintenanceContextPack => {
  requireActiveLifecycle(input);
  const maxUnits = input.maxUnits ?? input.routedUnitKeys.length;

  return {
    ...input,
    routedUnitKeys: input.routedUnitKeys.slice(0, maxUnits),
  };
};
