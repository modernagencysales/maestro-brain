import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MaestroSaasUiProvider } from "../../saas-ui/provider";
import {
  BrainEditorPane,
  readEditorDocumentId,
  readMarkdownSaveDraft,
} from "./brain-editor-pane";
import type { BrainSelectedPage } from "./brain-surface";

const page: BrainSelectedPage = {
  pageKey: "pg_overview",
  title: "Overview",
  markdown: "# Overview\nTrusted brief.",
  updatedAt: 1_720_000_000_000,
  currentRevisionKey: "rev_overview",
  editorTarget: {
    brainKey: "br_01HX0000000000000000000000",
    pageKey: "pg_overview",
    revisionKey: "rev_overview",
    documentId: "brainPage:j97f0k4knmzsk2a4tx9c6a4r497msf7s",
    snapshotVersion: 1,
  },
};

const render = (props: Partial<Parameters<typeof BrainEditorPane>[0]> = {}) =>
  renderToStaticMarkup(
    <MaestroSaasUiProvider>
      <BrainEditorPane
        canEdit
        page={page}
        onSaveMarkdown={vi.fn()}
        syncApi={undefined}
        {...props}
      />
    </MaestroSaasUiProvider>,
  );

describe("BrainEditorPane", () => {
  it("renders title, freshness, Ask placeholder, markdown fallback, and save affordance", () => {
    const html = render();

    expect(html).toContain("Overview");
    expect(html).toContain("Updated Jul 3, 2024");
    expect(html).toContain("Ask this Brain");
    expect(html).toContain("Trusted brief.");
    expect(html).toContain("Save page");
  });

  it("submits the edited markdown fallback draft instead of the original page markdown", () => {
    expect(readMarkdownSaveDraft("# Original", "# Edited")).toBe("# Edited");
  });

  it("reads the row-id fenced editor document target for BlockNote sync", () => {
    expect(readEditorDocumentId(page)).toBe(
      "brainPage:j97f0k4knmzsk2a4tx9c6a4r497msf7s",
    );
    expect(readEditorDocumentId({ ...page, editorTarget: null })).toBeNull();
  });

  it("renders viewer read-only and stale conflict states", () => {
    expect(render({ canEdit: false })).toContain("Read-only viewer");
    expect(render({ conflict: "stale_revision" })).toContain(
      "Newer revision available",
    );
  });
});
