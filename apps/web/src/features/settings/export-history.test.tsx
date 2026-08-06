import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MaestroSaasUiProvider } from "../../saas-ui/provider";
import { ExportHistory, type BrainExportJob } from "./export-history";

const ready: BrainExportJob = {
  brainKey: "brain_client_alpha",
  jobId: "export_123",
  state: "ready",
  createdAt: Date.UTC(2026, 7, 1),
  updatedAt: Date.UTC(2026, 7, 1),
  expiresAt: Date.UTC(2026, 7, 2),
  sizeBytes: 2048,
  manifestHash: "manifest_sha256",
  artifactHash: "artifact_sha256",
  downloadUrl: "https://downloads.example/export_123",
};

const render = (job: BrainExportJob) =>
  renderToStaticMarkup(
    <MaestroSaasUiProvider>
      <ExportHistory state={{ status: "ready", job }} />
    </MaestroSaasUiProvider>,
  );

describe("ExportHistory", () => {
  it("shows hashes, expiry, and download only when the contract returns a URL", () => {
    const html = render(ready);

    expect(html).toContain("manifest_sha256");
    expect(html).toContain("artifact_sha256");
    expect(html).toContain("Expires");
    expect(html).toContain("Download export");
    expect(html).toContain("https://downloads.example/export_123");
    expect(render({ ...ready, downloadUrl: undefined })).not.toContain(
      "Download export",
    );
  });

  it.each(["requested", "running"] as const)(
    "renders the %s state without a download",
    (state) => {
      const html = render({ ...ready, state, downloadUrl: undefined });

      expect(html).toContain(state);
      expect(html).not.toContain("Download export");
    },
  );

  it.each(["failed", "expired", "revoked", "purged"] as const)(
    "renders the terminal %s state without a download",
    (state) => {
      const html = render({ ...ready, state, downloadUrl: undefined });

      expect(html).toContain(state);
      expect(html).not.toContain("Download export");
    },
  );
});
