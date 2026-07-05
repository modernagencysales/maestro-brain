import { createFileRoute } from "@tanstack/react-router";
import { ReferenceDocumentRoute } from "../sample/reference-document-route";

export const Route = createFileRoute("/_workspace/documents")({
  component: DocumentsRoute,
});

function DocumentsRoute() {
  return <ReferenceDocumentRoute routeKey="documents" />;
}
