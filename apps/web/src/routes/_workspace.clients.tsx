import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useClientsController } from "../features/clients/clients-adapter";
import { ClientsScreen } from "../features/clients/clients-screen";
import { Page } from "@saas-ui/react";
import { useWorkspace } from "../providers/workspace";

export const Route = createFileRoute("/_workspace/clients")({
  component: ClientsRoute,
});

function ClientsRoute() {
  const navigate = useNavigate();
  const workspace = useWorkspace();
  const controller = useClientsController({
    onCreated: (target) => {
      workspace.switchWorkspace(target.search.brainKey);
      return navigate(target);
    },
  });

  return (
    <Page.Root>
      <ClientsScreen
        state={controller.state}
        onboarding={controller.onboarding}
        onCreateClient={controller.onCreateClient}
      />
    </Page.Root>
  );
}
