import { FunctionSpec, GroupSpec } from "@confect/core";
import type {
  backgroundWork,
  enqueue,
  enqueueSourceJob,
  failSourceJobControl,
  heartbeatSourceJob,
  onComplete,
  reclaimSourceJob,
  status,
  statusSourceJob,
} from "./workpool";

export default GroupSpec.make()
  .addFunction(FunctionSpec.convexPublicMutation<typeof enqueue>()("enqueue"))
  .addFunction(FunctionSpec.convexPublicQuery<typeof status>()("status"))
  .addFunction(
    FunctionSpec.convexInternalMutation<typeof enqueueSourceJob>()(
      "enqueueSourceJob",
    ),
  )
  .addFunction(
    FunctionSpec.convexInternalQuery<typeof statusSourceJob>()(
      "statusSourceJob",
    ),
  )
  .addFunction(
    FunctionSpec.convexInternalMutation<typeof heartbeatSourceJob>()(
      "heartbeatSourceJob",
    ),
  )
  .addFunction(
    FunctionSpec.convexInternalMutation<typeof reclaimSourceJob>()(
      "reclaimSourceJob",
    ),
  )
  .addFunction(
    FunctionSpec.convexInternalMutation<typeof failSourceJobControl>()(
      "failSourceJobControl",
    ),
  )
  .addFunction(
    FunctionSpec.convexInternalAction<typeof backgroundWork>()(
      "backgroundWork",
    ),
  )
  .addFunction(
    FunctionSpec.convexInternalMutation<typeof onComplete>()("onComplete"),
  );
