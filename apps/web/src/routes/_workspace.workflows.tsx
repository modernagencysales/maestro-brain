import { createFileRoute } from "@tanstack/react-router";
import { ReferenceDocumentRoute } from "../sample/reference-document-route";

export const Route = createFileRoute("/_workspace/workflows")({
  component: WorkflowsRoute,
});

function WorkflowsRoute() {
  return <ReferenceDocumentRoute routeKey="workflows" />;
}
