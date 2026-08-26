import { createFileRoute } from "@tanstack/react-router";

import { FullscreenLayout } from "#features/common/layouts/fullscreen-layout";
import { TerminalLinkPage } from "#features/terminal-link/terminal-link-page";
import { terminalLinkSearchSchema } from "#features/terminal-link/terminal-link";

export const Route = createFileRoute("/_app/terminal-link")({
  validateSearch: terminalLinkSearchSchema,
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
