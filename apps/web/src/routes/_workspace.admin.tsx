import { createFileRoute } from "@tanstack/react-router";
import { ReferenceDocumentRoute } from "../sample/reference-document-route";

export const Route = createFileRoute("/_workspace/admin")({
  component: AdminRoute,
});

function AdminRoute() {
  return <ReferenceDocumentRoute routeKey="admin" />;
}
