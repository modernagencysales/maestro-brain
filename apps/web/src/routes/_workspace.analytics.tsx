import { createFileRoute } from "@tanstack/react-router";
import { ReferenceDocumentRoute } from "../sample/reference-document-route";

export const Route = createFileRoute("/_workspace/analytics")({
  component: AnalyticsRoute,
});

function AnalyticsRoute() {
  return <ReferenceDocumentRoute routeKey="analytics" />;
}
