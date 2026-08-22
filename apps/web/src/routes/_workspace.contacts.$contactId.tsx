import { createFileRoute } from "@tanstack/react-router";
import { ContactPage } from "../features/contacts/view/contact-page";
import { useWorkspaceSlug } from "../features/common/hooks/use-workspace-slug";

export const Route = createFileRoute("/_workspace/contacts/$contactId")({
  component: ContactRoute,
});

function ContactRoute() {
  const workspace = useWorkspaceSlug();
  const { contactId } = Route.useParams();
  return <ContactPage params={{ workspace, id: contactId }} />;
}
