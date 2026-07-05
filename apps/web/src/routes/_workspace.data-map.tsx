import { createFileRoute } from "@tanstack/react-router";
import { ReferenceDocumentRoute } from "../sample/reference-document-route";

export const Route = createFileRoute("/_workspace/data-map")({
  component: DataMapRoute,
});

function DataMapRoute() {
  return <ReferenceDocumentRoute routeKey="dataMap" />;
}
