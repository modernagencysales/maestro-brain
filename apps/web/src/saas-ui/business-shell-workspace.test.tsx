import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  WorkspaceProvider,
  createWorkspaceController,
} from "../providers/workspace";
import { BusinessWorkspaceSelector } from "./business-shell";
import { MaestroSaasUiProvider } from "./provider";

describe("BusinessAppShell workspace selection", () => {
  it("renders every authorized workspace and marks the active one", async () => {
    const controller = createWorkspaceController({
      loadWorkspaces: async () => [
        {
          workspaceId: "brain_agency",
          organizationId: "org_1",
          kind: "agency",
          name: "Agency Brain",
          slug: "agency",
          role: "owner",
          status: "active",
        },
        {
          workspaceId: "brain_acme",
          organizationId: "org_1",
          kind: "client",
          name: "Acme Brain",
          slug: "acme",
          role: "owner",
          status: "active",
        },
      ],
      ensureProvisioned: async () => ({ workspaceId: "brain_agency" }),
    });
    await controller.initialize();

    const html = renderToStaticMarkup(
      <WorkspaceProvider controller={controller}>
        <MaestroSaasUiProvider>
          <BusinessWorkspaceSelector />
        </MaestroSaasUiProvider>
      </WorkspaceProvider>,
    );

    expect(html).toContain('aria-label="Active workspace"');
    expect(html).toContain(
      '<option value="brain_agency" selected="">Agency Brain</option>',
    );
    expect(html).toContain('<option value="brain_acme">Acme Brain</option>');
  });
});
