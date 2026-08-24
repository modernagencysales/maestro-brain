import { createFileRoute } from "@tanstack/react-router";
import { createAuthEntryHandler } from "#lib/auth/workos-auth-entry";

export const Route = createFileRoute("/api/auth/sign-up")({
  server: {
    handlers: {
      GET: createAuthEntryHandler("sign-up"),
    },
  },
});
