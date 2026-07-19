import { FunctionSpec, GroupSpec } from "@confect/core";
import type {
  backgroundWork,
  enqueue,
  enqueueSourceJob,
  onComplete,
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
    FunctionSpec.convexInternalAction<typeof backgroundWork>()(
      "backgroundWork",
    ),
  )
  .addFunction(
    FunctionSpec.convexInternalMutation<typeof onComplete>()("onComplete"),
  );
