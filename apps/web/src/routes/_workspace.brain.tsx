import { createFileRoute } from "@tanstack/react-router";
import { BrainWorkspaceRoute } from "../features/brain/brain-workspace";

export const Route = createFileRoute("/_workspace/brain")({
  component: BrainRoute,
});

function BrainRoute() {
  return <BrainWorkspaceRoute />;
}
