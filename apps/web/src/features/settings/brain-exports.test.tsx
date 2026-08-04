import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MaestroSaasUiProvider } from "../../saas-ui/provider";
import { BrainExports } from "./brain-exports";

const render = (role: "viewer" | "admin") =>
  renderToStaticMarkup(
    <MaestroSaasUiProvider>
      <BrainExports
        role={role}
        exportState={{ status: "empty" }}
        onRequest={vi.fn()}
      />
    </MaestroSaasUiProvider>,
  );

describe("BrainExports", () => {
  it("shows the request control and downloaded-copy warning only to admins", () => {
    const admin = render("admin");
    const viewer = render("viewer");

    expect(admin).toContain("Request Brain export");
    expect(admin).toContain("Downloaded copies leave Maestro control");
    expect(viewer).toContain("Only workspace admins can request exports.");
    expect(viewer).not.toContain("Request Brain export");
  });

  it("disables requests when the backend is unavailable", () => {
    const html = renderToStaticMarkup(
      <MaestroSaasUiProvider>
        <BrainExports
          role="admin"
          disabledReason="Brain export backend unavailable."
          exportState={{
            status: "unavailable",
            message: "Unable to load exports.",
          }}
          onRequest={vi.fn()}
        />
      </MaestroSaasUiProvider>,
    );

    expect(html).toContain("Brain export backend unavailable.");
    expect(html).toContain("disabled");
    expect(html).toContain("Unable to load exports.");
  });
});
