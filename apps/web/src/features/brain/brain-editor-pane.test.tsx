import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@maestro-template/editor-react/client", () => ({
  BlockNoteSyncEditor: ({
    documentId,
    editable,
    expectedCurrentRevisionKey,
    initialSnapshotVersion,
  }: {
    readonly documentId: string;
    readonly editable?: boolean;
    readonly expectedCurrentRevisionKey?: string;
    readonly initialSnapshotVersion?: number;
  }) => (
    <div
      data-editor-document-id={documentId}
      data-editor-editable={editable}
      data-editor-expected-revision={expectedCurrentRevisionKey}
      data-editor-initial-version={initialSnapshotVersion}
      data-editor-state="loading"
    />
  ),
}));
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
    documentId: "brainPage:br_01HX0000000000000000000000:pg_overview",
    snapshotVersion: 1,
  },
};

const syncApi = {
  getSnapshot: {} as never,
  submitSnapshot: {} as never,
  latestVersion: {} as never,
  getSteps: {} as never,
  submitSteps: {} as never,
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

  it("reads the stable-key fenced editor document target for BlockNote sync", () => {
    expect(readEditorDocumentId(page)).toBe(
      "brainPage:br_01HX0000000000000000000000:pg_overview",
    );
    expect(readEditorDocumentId({ ...page, editorTarget: null })).toBeNull();
  });

  it("mounts editable BlockNote with the selected revision fence", () => {
    const html = render({ syncApi });

    expect(html).toContain('data-editor-state="loading"');
    expect(html).toContain(
      'data-editor-document-id="brainPage:br_01HX0000000000000000000000:pg_overview"',
    );
    expect(html).toContain('data-editor-editable="true"');
    expect(html).toContain('data-editor-expected-revision="rev_overview"');
    expect(html).toContain('data-editor-initial-version="1"');
    expect(html).toContain("Brain page markdown");
    expect(html).toContain("Trusted brief.");
  });

  it("renders viewer read-only and stale conflict states", () => {
    expect(render({ canEdit: false })).toContain("Read-only viewer");
    expect(render({ conflict: "stale_revision" })).toContain(
      "Newer revision available",
    );
  });
});
