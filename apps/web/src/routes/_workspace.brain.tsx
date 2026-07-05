import { createFileRoute } from "@tanstack/react-router";
import { ReferenceDocumentRoute } from "../sample/reference-document-route";

export const Route = createFileRoute("/_workspace/brain")({
  component: BrainRoute,
});

function BrainRoute() {
  return <ReferenceDocumentRoute routeKey="brain" />;
}
