import { FunctionSpec, GroupSpec } from "@confect/core";

import { ValidationFailed } from "../errors";
import {
  CommitDriveObservationArgs,
  CommitDriveObservationResult,
  RecordDriveSourceOutcomeArgs,
  RecordDriveSourceOutcomeResult,
} from "./driveLedgerSchemas";

export const commitObservation = FunctionSpec.internalMutation({
  name: "commitObservation",
  args: () => CommitDriveObservationArgs,
  returns: () => CommitDriveObservationResult,
  error: () => ValidationFailed,
});

export const recordSourceOutcome = FunctionSpec.internalMutation({
  name: "recordSourceOutcome",
  args: () => RecordDriveSourceOutcomeArgs,
  returns: () => RecordDriveSourceOutcomeResult,
  error: () => ValidationFailed,
});

export default GroupSpec.make()
  .addFunction(commitObservation)
  .addFunction(recordSourceOutcome);
