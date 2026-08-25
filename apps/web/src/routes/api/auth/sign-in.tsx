import { createFileRoute } from "@tanstack/react-router";
import { createAuthEntryHandler } from "#lib/auth/workos-auth-entry";
import { createPasswordAuthHandler } from "#lib/auth/workos-password-auth";

export const Route = createFileRoute("/api/auth/sign-in")({
  server: {
    handlers: {
      GET: createAuthEntryHandler("sign-in"),
      POST: createPasswordAuthHandler("sign-in"),
    },
  },
});
