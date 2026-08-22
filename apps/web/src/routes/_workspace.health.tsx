import { createFileRoute } from "@tanstack/react-router";
import { HealthSurface } from "../features/health/health-surface";

export const Route = createFileRoute("/_workspace/health")({
  component: HealthSurface,
});
