import { createFileRoute } from "@tanstack/react-router";
import { ReferenceDocumentRoute } from "../sample/reference-document-route";

export const Route = createFileRoute("/_workspace/sources")({
  component: SourcesRoute,
});

function SourcesRoute() {
  return <ReferenceDocumentRoute routeKey="sources" />;
}
