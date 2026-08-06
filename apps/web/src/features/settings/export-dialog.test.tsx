import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MaestroSaasUiProvider } from "../../saas-ui/provider";
import { ExportDialog } from "./export-dialog";

describe("ExportDialog", () => {
  it("keeps the warning confirmation and request button accessible", () => {
    const html = renderToStaticMarkup(
      <MaestroSaasUiProvider>
        <ExportDialog disabled={false} pending={false} onRequest={vi.fn()} />
      </MaestroSaasUiProvider>,
    );

    expect(html).toContain("Downloaded copies leave Maestro control");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('type="submit"');
  });

  it("shows a stable pending state", () => {
    const html = renderToStaticMarkup(
      <MaestroSaasUiProvider>
        <ExportDialog disabled={false} pending onRequest={vi.fn()} />
      </MaestroSaasUiProvider>,
    );

    expect(html).toContain("Requesting export…");
    expect(html).toContain("disabled");
  });
});
