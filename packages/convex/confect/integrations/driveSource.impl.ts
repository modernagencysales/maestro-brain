import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Layer from "effect/Layer";

import databaseSchema from "../_generated/schema";
import {
  commitDriveObservation,
  recordDriveSourceOutcome,
} from "./driveLedgerRepository";
import driveSource from "./driveSource.spec";

const commitObservation = FunctionImpl.make(
  databaseSchema,
  driveSource,
  "commitObservation",
  commitDriveObservation,
);

const recordSourceOutcome = FunctionImpl.make(
  databaseSchema,
  driveSource,
  "recordSourceOutcome",
  recordDriveSourceOutcome,
);

export default GroupImpl.make(databaseSchema, driveSource).pipe(
  Layer.provide(commitObservation),
  Layer.provide(recordSourceOutcome),
  GroupImpl.finalize,
);
