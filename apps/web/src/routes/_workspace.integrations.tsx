import { createFileRoute } from "@tanstack/react-router";
import { ReferenceDocumentRoute } from "../sample/reference-document-route";

export const Route = createFileRoute("/_workspace/integrations")({
  component: IntegrationsRoute,
});

function IntegrationsRoute() {
  return <ReferenceDocumentRoute routeKey="integrations" />;
}
