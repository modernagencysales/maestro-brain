import { createFileRoute } from "@tanstack/react-router";
import { ReferenceDocumentRoute } from "../sample/reference-document-route";

export const Route = createFileRoute("/_workspace/api")({
  component: ApiRoute,
});

function ApiRoute() {
  return <ReferenceDocumentRoute routeKey="api" />;
}
