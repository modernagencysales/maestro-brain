import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MaestroSaasUiProvider } from "../../saas-ui/provider";
import { ClientsTable } from "./clients-table";

describe("ClientsTable", () => {
  it("renders explicit future metrics without fabricating provider data", () => {
    const html = renderToStaticMarkup(
      <MaestroSaasUiProvider>
        <ClientsTable
          clients={[
            {
              key: "br_client",
              name: "Client Co",
              health: "Not connected",
              freshness: "Updated today",
              connections: 0,
              recentChanges: 0,
            },
          ]}
        />
      </MaestroSaasUiProvider>,
    );

    expect(html).toContain("Not connected");
    expect(html).toContain("Recent changes");
    expect(html).toContain(">0</td>");
  });
});
