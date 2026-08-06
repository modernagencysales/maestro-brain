import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MaestroSaasUiProvider } from "../../saas-ui/provider";
import {
  TranscriptImport,
  transcriptImportFromFormData,
  type TranscriptImportState,
} from "./transcript-import";

const render = (
  state: TranscriptImportState,
  role: "viewer" | "editor" | "admin" | "owner" = "editor",
) =>
  renderToStaticMarkup(
    <MaestroSaasUiProvider>
      <TranscriptImport
        role={role}
        state={state}
        targets={[{ brainKey: "br_acme", name: "Acme" }]}
        onImport={() => undefined}
      />
    </MaestroSaasUiProvider>,
  );

describe("TranscriptImport", () => {
  it("uses a native accessible file form with supported formats", () => {
    const html = render({ status: "idle" });
    expect(html).toContain('aria-label="Import transcript"');
    expect(html).toContain('type="file"');
    expect(html).toContain(".json,.vtt,.srt,.txt,.md");
    expect(html).toContain('type="datetime-local"');
    expect(html).toContain('type="submit"');
    expect(html).toContain("Optional target Brain");
  });

  it.each([
    [{ status: "reading" as const }, "Reading transcript…"],
    [{ status: "importing" as const }, "Importing transcript…"],
    [{ status: "success" as const }, "Transcript imported"],
    [{ status: "typed_failure" as const }, "Transcript was rejected"],
    [{ status: "transport_failure" as const }, "Import connection failed"],
  ])("renders import state $state.status", (state, message) => {
    expect(render(state)).toContain(message);
  });

  it("disables import for viewers", () => {
    const html = render({ status: "idle" }, "viewer");
    expect(html).toContain("Editor access is required to import transcripts");
    expect(html).toContain("disabled");
  });

  it("reads metadata and infers the format from the selected file", async () => {
    const data = new FormData();
    data.set(
      "file",
      new File(["WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello"], "call.vtt", {
        type: "text/vtt",
      }),
    );
    data.set("title", "Customer call");
    data.set("occurredAt", "2026-08-05T14:00");
    data.set("participantEmails", "buyer@example.com, seller@example.com");
    data.set("targetBrainKey", "br_acme");

    await expect(transcriptImportFromFormData(data)).resolves.toMatchObject({
      format: "vtt",
      title: "Customer call",
      participantEmails: ["buyer@example.com", "seller@example.com"],
      targetBrainKey: "br_acme",
    });
  });

  it("rejects missing and unsupported files before mutation", async () => {
    const missing = new FormData();
    await expect(transcriptImportFromFormData(missing)).rejects.toThrow(
      "Select a transcript file",
    );
    const unsupported = new FormData();
    unsupported.set(
      "file",
      new File(["payload"], "call.pdf", { type: "application/pdf" }),
    );
    unsupported.set("title", "Call");
    unsupported.set("occurredAt", "2026-08-05T14:00");
    await expect(transcriptImportFromFormData(unsupported)).rejects.toThrow(
      "JSON, VTT, SRT, TXT, or Markdown",
    );
  });
});
