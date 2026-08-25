import { createFileRoute } from "@tanstack/react-router";
import { createAuthEntryHandler } from "#lib/auth/workos-auth-entry";
import { createPasswordAuthHandler } from "#lib/auth/workos-password-auth";

export const Route = createFileRoute("/api/auth/sign-up")({
  server: {
    handlers: {
      GET: createAuthEntryHandler("sign-up"),
      POST: createPasswordAuthHandler("sign-up"),
    },
  },
});
