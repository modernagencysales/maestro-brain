import { createFileRoute } from "@tanstack/react-router";
import { ReferenceDocumentRoute } from "../sample/reference-document-route";

export const Route = createFileRoute("/_workspace/runs")({
  component: RunsRoute,
});

function RunsRoute() {
  return <ReferenceDocumentRoute routeKey="runs" />;
}
