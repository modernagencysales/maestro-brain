import { createFileRoute } from "@tanstack/react-router";
import { ReferenceDocumentRoute } from "../sample/reference-document-route";

export const Route = createFileRoute("/_workspace/agents")({
  component: AgentsRoute,
});

function AgentsRoute() {
  return <ReferenceDocumentRoute routeKey="agents" />;
}
