import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Layer from "effect/Layer";
import databaseSchema from "../_generated/schema";
import * as workpoolFns from "./workpool";
import workpool from "./workpool.spec";

const enqueueImpl = FunctionImpl.make(
  databaseSchema,
  workpool,
  "enqueue",
  workpoolFns.enqueue,
);
const statusImpl = FunctionImpl.make(
  databaseSchema,
  workpool,
  "status",
  workpoolFns.status,
);
const enqueueSourceJobImpl = FunctionImpl.make(
  databaseSchema,
  workpool,
  "enqueueSourceJob",
  workpoolFns.enqueueSourceJob,
);
const statusSourceJobImpl = FunctionImpl.make(
  databaseSchema,
  workpool,
  "statusSourceJob",
  workpoolFns.statusSourceJob,
);
const heartbeatSourceJobImpl = FunctionImpl.make(
  databaseSchema,
  workpool,
  "heartbeatSourceJob",
  workpoolFns.heartbeatSourceJob,
);
const reclaimSourceJobImpl = FunctionImpl.make(
  databaseSchema,
  workpool,
  "reclaimSourceJob",
  workpoolFns.reclaimSourceJob,
);
const failSourceJobControlImpl = FunctionImpl.make(
  databaseSchema,
  workpool,
  "failSourceJobControl",
  workpoolFns.failSourceJobControl,
);
const backgroundWorkImpl = FunctionImpl.make(
  databaseSchema,
  workpool,
  "backgroundWork",
  workpoolFns.backgroundWork,
);
const onCompleteImpl = FunctionImpl.make(
  databaseSchema,
  workpool,
  "onComplete",
  workpoolFns.onComplete,
);

export default GroupImpl.make(databaseSchema, workpool).pipe(
  Layer.provide(enqueueImpl),
  Layer.provide(statusImpl),
  Layer.provide(enqueueSourceJobImpl),
  Layer.provide(statusSourceJobImpl),
  Layer.provide(heartbeatSourceJobImpl),
  Layer.provide(reclaimSourceJobImpl),
  Layer.provide(failSourceJobControlImpl),
  Layer.provide(backgroundWorkImpl),
  Layer.provide(onCompleteImpl),
  GroupImpl.finalize,
);
