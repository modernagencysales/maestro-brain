import { createFileRoute } from "@tanstack/react-router";
import { InboxLayout } from "../features/contacts/inbox/inbox-layout";
import { useWorkspaceSlug } from "../features/common/hooks/use-workspace-slug";

export const Route = createFileRoute("/_workspace/inbox")({
  component: InboxRoute,
});

function InboxRoute() {
  const workspace = useWorkspaceSlug();
  return (
    <InboxLayout params={{ workspace }}>
      <></>
    </InboxLayout>
  );
}
