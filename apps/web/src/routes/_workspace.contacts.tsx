import { createFileRoute } from "@tanstack/react-router";
import { ContactsListPage } from "../features/contacts/list/list-page";
import { useWorkspaceSlug } from "../features/common/hooks/use-workspace-slug";

export const Route = createFileRoute("/_workspace/contacts")({
  component: ContactsRoute,
});

function ContactsRoute() {
  const workspace = useWorkspaceSlug();
  return <ContactsListPage params={{ workspace }} />;
}
