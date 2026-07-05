import { createFileRoute } from "@tanstack/react-router";
import { ReferenceDocumentRoute } from "../sample/reference-document-route";

export const Route = createFileRoute("/_workspace/billing")({
  component: BillingRoute,
});

function BillingRoute() {
  return <ReferenceDocumentRoute routeKey="billing" />;
}
