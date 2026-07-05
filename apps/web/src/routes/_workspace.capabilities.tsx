import { createFileRoute } from "@tanstack/react-router";
import { ReferenceDocumentRoute } from "../sample/reference-document-route";

export const Route = createFileRoute("/_workspace/capabilities")({
  component: CapabilitiesRoute,
});

function CapabilitiesRoute() {
  return <ReferenceDocumentRoute routeKey="capabilities" />;
}
