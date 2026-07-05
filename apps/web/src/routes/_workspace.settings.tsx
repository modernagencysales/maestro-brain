import { createFileRoute } from "@tanstack/react-router";
import { ReferenceDocumentRoute } from "../sample/reference-document-route";

export const Route = createFileRoute("/_workspace/settings")({
  component: SettingsRoute,
});

function SettingsRoute() {
  return <ReferenceDocumentRoute routeKey="settings" />;
}
