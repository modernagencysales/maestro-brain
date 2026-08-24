/* eslint-disable template/frontend-route-server-boundary -- WorkOS already registers this compatibility URI in staging. */
import { createFileRoute } from "@tanstack/react-router";
import { handleCallbackRoute } from "@workos/authkit-tanstack-react-start";

import { guardedCallback } from "#lib/auth/workos-callback";

/** Delegates the registered staging URI to the canonical WorkOS callback. */
export const Route = createFileRoute("/callback")({
  server: { handlers: { GET: guardedCallback(handleCallbackRoute()) } },
});
