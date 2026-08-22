import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Layer from "effect/Layer";

import driveLedgerDatabaseSchema from "./driveLedgerDatabase";
import {
  commitDriveObservation,
  recordDriveSourceOutcome,
} from "./driveLedgerRepository";
import driveSource from "./driveSource.spec";

const commitObservation = FunctionImpl.make(
  driveLedgerDatabaseSchema,
  driveSource,
  "commitObservation",
  commitDriveObservation,
);

const recordSourceOutcome = FunctionImpl.make(
  driveLedgerDatabaseSchema,
  driveSource,
  "recordSourceOutcome",
  recordDriveSourceOutcome,
);

export default GroupImpl.make(driveLedgerDatabaseSchema, driveSource).pipe(
  Layer.provide(commitObservation),
  Layer.provide(recordSourceOutcome),
  GroupImpl.finalize,
);
