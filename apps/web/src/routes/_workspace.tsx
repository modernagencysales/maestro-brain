import { createFileRoute, Outlet } from "@tanstack/react-router";

import { DashboardLayout } from "../features/common/layouts/dashboard-layout";

export const Route = createFileRoute("/_workspace")({
  // The canonical Pro Resizer reads browser globals while rendering.
  ssr: false,
  component: WorkspaceLayout,
});

function WorkspaceLayout() {
  return (
    <DashboardLayout>
      <Outlet />
    </DashboardLayout>
  );
}
