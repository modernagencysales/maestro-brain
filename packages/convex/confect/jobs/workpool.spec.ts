import { FunctionSpec, GroupSpec } from "@confect/core";
import type * as workpoolFns from "./workpool";

export default GroupSpec.make()
  .addFunction(
    FunctionSpec.convexPublicMutation<typeof workpoolFns.enqueue>()("enqueue"),
  )
  .addFunction(
    FunctionSpec.convexPublicQuery<typeof workpoolFns.status>()("status"),
  )
  .addFunction(
    FunctionSpec.convexInternalMutation<typeof workpoolFns.enqueueSourceJob>()(
      "enqueueSourceJob",
    ),
  )
  .addFunction(
    FunctionSpec.convexInternalQuery<typeof workpoolFns.statusSourceJob>()(
      "statusSourceJob",
    ),
  )
  .addFunction(
    FunctionSpec.convexInternalMutation<
      typeof workpoolFns.heartbeatSourceJob
    >()("heartbeatSourceJob"),
  )
  .addFunction(
    FunctionSpec.convexInternalMutation<typeof workpoolFns.reclaimSourceJob>()(
      "reclaimSourceJob",
    ),
  )
  .addFunction(
    FunctionSpec.convexInternalMutation<
      typeof workpoolFns.failSourceJobControl
    >()("failSourceJobControl"),
  )
  .addFunction(
    FunctionSpec.convexInternalAction<typeof workpoolFns.backgroundWork>()(
      "backgroundWork",
    ),
  )
  .addFunction(
    FunctionSpec.convexInternalMutation<typeof workpoolFns.onComplete>()(
      "onComplete",
    ),
  );
