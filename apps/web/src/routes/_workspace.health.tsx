import { createFileRoute } from "@tanstack/react-router";
import { ReferenceDocumentRoute } from "../sample/reference-document-route";

export const Route = createFileRoute("/_workspace/health")({
  component: HealthRoute,
});

function HealthRoute() {
  return <ReferenceDocumentRoute routeKey="health" />;
}
