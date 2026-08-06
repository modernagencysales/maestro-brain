import { createFileRoute } from "@tanstack/react-router";

import { ConnectionsRouteAdapter } from "../features/connections/connections-route-adapter";

export const Route = createFileRoute("/_workspace/connections")({
  component: ConnectionsRouteAdapter,
});
