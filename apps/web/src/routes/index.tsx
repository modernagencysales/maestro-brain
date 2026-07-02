import { createFileRoute } from "@tanstack/react-router";

import { App as TemplateReferenceApp } from "../sample/App";

export const Route = createFileRoute("/")({
  component: TemplateReferenceApp,
});
