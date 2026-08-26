import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { FullscreenLayout } from "#features/common/layouts/fullscreen-layout";
import { TerminalLinkPage } from "#features/terminal-link/terminal-link-page";

export const Route = createFileRoute("/_app/terminal-link")({
  validateSearch: z.object({
    callback: z.string(),
    state: z.string().min(16),
  }),
  head: () => ({ meta: [{ title: "Connect Maestro Brain" }] }),
  component: TerminalLinkRoute,
});

function TerminalLinkRoute() {
  const search = Route.useSearch();
  return (
    <FullscreenLayout>
      <TerminalLinkPage callback={search.callback} state={search.state} />
    </FullscreenLayout>
  );
}
