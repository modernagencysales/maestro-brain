import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceSettingsClient } from "../features/settings/workspace-settings-client";

export const Route = createFileRoute("/_workspace/settings")({
  component: WorkspaceSettingsRoute,
});

function WorkspaceSettingsRoute() {
  return <WorkspaceSettingsClient />;
}
