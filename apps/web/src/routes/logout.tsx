import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/logout")({
  beforeLoad: () => {
    throw redirect({ href: "/sign-in?action=logout" });
  },
});
