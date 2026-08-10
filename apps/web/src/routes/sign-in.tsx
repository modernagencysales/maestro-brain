import { createFileRoute } from "@tanstack/react-router";
import { getSignInUrl, signOut } from "@workos/authkit-tanstack-react-start";

export const Route = createFileRoute("/sign-in")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const searchParams = new URL(request.url).searchParams;
        if (searchParams.get("action") === "logout") {
          return signOut({ data: { returnTo: "/" } });
        }
        const returnPathname = searchParams.get("returnPathname");
        const url = await getSignInUrl(
          returnPathname ? { data: { returnPathname } } : undefined,
        );

        return new Response(null, {
          status: 307,
          headers: { Location: url },
        });
      },
    },
  },
});
