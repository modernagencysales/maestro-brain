import { FunctionSpec, GroupSpec } from "@confect/core";
import type { editorSyncApi } from "./editor/syncApi";

const getSnapshot =
  FunctionSpec.convexPublicQuery<typeof editorSyncApi.getSnapshot>()(
    "getSnapshot",
  );

const submitSnapshot =
  FunctionSpec.convexPublicMutation<typeof editorSyncApi.submitSnapshot>()(
    "submitSnapshot",
  );

const latestVersion =
  FunctionSpec.convexPublicQuery<typeof editorSyncApi.latestVersion>()(
    "latestVersion",
  );

const getSteps =
  FunctionSpec.convexPublicQuery<typeof editorSyncApi.getSteps>()("getSteps");

const submitSteps =
  FunctionSpec.convexPublicMutation<typeof editorSyncApi.submitSteps>()(
    "submitSteps",
  );

export default GroupSpec.make()
  .addFunction(getSnapshot)
  .addFunction(submitSnapshot)
  .addFunction(latestVersion)
  .addFunction(getSteps)
  .addFunction(submitSteps);
