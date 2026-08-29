import { useModals } from "@workspace/ui/modals";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { BrainOnboardingEmptyState } from "#features/contacts/inbox/brain-onboarding-empty-state";
import { BrainPageCreateDialog } from "#features/contacts/inbox/brain-page-create-dialog";

export const Route = createFileRoute("/_app/$workspace/_dashboard/inbox/")({
  component: BrainOnboardingRoute,
});

function BrainOnboardingRoute() {
  const { workspace } = Route.useParams();
  const navigate = useNavigate();
  const modals = useModals();
  const openConnections = () =>
    navigate({ to: "/$workspace", params: { workspace } });

  return (
    <BrainOnboardingEmptyState
      onConnectDrive={openConnections}
      onConnectSlack={openConnections}
      onConnectTerminal={() =>
        navigate({
          to: "/$workspace/settings/account/api",
          params: { workspace },
        })
      }
      onCreatePage={() =>
        modals.open(BrainPageCreateDialog, { workspaceSlug: workspace })
      }
    />
  );
}
