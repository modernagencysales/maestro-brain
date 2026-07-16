import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useClientsController } from "../features/clients/clients-adapter";
import { ClientsScreen } from "../features/clients/clients-screen";
import { BusinessAppShell, BusinessPageRoot } from "../saas-ui/business-shell";

export const Route = createFileRoute("/_workspace/clients")({
  component: ClientsRoute,
});

function ClientsRoute() {
  const navigate = useNavigate();
  const controller = useClientsController({
    onCreated: (target) => navigate(target),
  });

  return (
    <BusinessAppShell activePath="/clients">
      <BusinessPageRoot>
        <ClientsScreen
          state={controller.state}
          onboarding={controller.onboarding}
          onCreateClient={controller.onCreateClient}
        />
      </BusinessPageRoot>
    </BusinessAppShell>
  );
}
