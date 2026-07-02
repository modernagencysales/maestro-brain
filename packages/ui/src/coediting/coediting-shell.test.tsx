import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CoeditingShell, type CoeditingShellDocument } from "./coediting-shell";

const document: CoeditingShellDocument = {
  id: "doc_founder_notes",
  title: "Founder notes",
  eyebrow: "Client brain",
  markdown: "# Founder notes\n\nThis is the working source note.",
  latestVersionId: "version_002",
  sourceMetadata: {
    kind: "markdown",
    title: "Founder notes import",
    sourceIds: ["source_001"],
  },
  annotations: [
    {
      id: "annotation_001",
      quotedText: "working source note",
      body: "Needs a customer proof point.",
      authorLabel: "Strategy agent",
      status: "open",
    },
  ],
  suggestions: [
    {
      id: "suggestion_001",
      title: "Add proof",
      body: "Pull one cited win into this section before client review.",
      proposedByLabel: "Research agent",
      status: "proposed",
    },
  ],
};

describe("CoeditingShell", () => {
  it("renders a loading document page state", () => {
    const html = renderToStaticMarkup(<CoeditingShell state="loading" />);

    expect(html).toContain("Loading document");
    expect(html).toContain("notion-page");
  });

  it("renders an empty document page state", () => {
    const html = renderToStaticMarkup(<CoeditingShell state="empty" />);

    expect(html).toContain("No document selected");
    expect(html).toContain("Choose or create a source-backed document");
  });

  it("renders document, annotation rail, and agent suggestion states", () => {
    const html = renderToStaticMarkup(
      <CoeditingShell document={document} state="ready" />,
    );

    expect(html).toContain("Founder notes");
    expect(html).toContain("version_002");
    expect(html).toContain("Source metadata");
    expect(html).toContain("Needs a customer proof point.");
    expect(html).toContain("Add proof");
    expect(html).toContain("Research agent");
  });

  it("accepts an optional rich editor slot without making editors required", () => {
    const html = renderToStaticMarkup(
      <CoeditingShell
        document={document}
        editorSlot={<div data-editor-slot>Editor placeholder</div>}
        state="ready"
      />,
    );

    expect(html).toContain("data-editor-slot");
    expect(html).toContain("Editor placeholder");
  });
});
