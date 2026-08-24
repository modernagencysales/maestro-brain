/* eslint-disable template/frontend-route-server-boundary -- WorkOS already registers this compatibility URI in staging. */
import { createFileRoute } from "@tanstack/react-router";

import { createWorkosCallbackHandler } from "#lib/auth/workos-auth-entry";

/** Delegates the registered staging URI to the canonical WorkOS callback. */
export const Route = createFileRoute("/callback")({
  server: { handlers: { GET: createWorkosCallbackHandler() } },
});
