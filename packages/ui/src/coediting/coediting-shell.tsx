import type { ReactNode } from "react";
import { NotionDocumentPage } from "../blocks/notion-document";

export type CoeditingShellSourceMetadata = {
  readonly kind: "markdown" | "link" | "note" | "document";
  readonly title: string;
  readonly sourceIds: readonly string[];
};

export type CoeditingShellAnnotation = {
  readonly id: string;
  readonly quotedText: string;
  readonly body: string;
  readonly authorLabel: string;
  readonly status: "open" | "resolved";
};

export type CoeditingShellSuggestion = {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly proposedByLabel: string;
  readonly status: "proposed" | "accepted" | "rejected";
};

export type CoeditingShellDocument = {
  readonly id: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly markdown: string;
  readonly latestVersionId: string;
  readonly sourceMetadata: CoeditingShellSourceMetadata;
  readonly annotations?: readonly CoeditingShellAnnotation[];
  readonly suggestions?: readonly CoeditingShellSuggestion[];
};

export type CoeditingShellProps = {
  readonly state: "loading" | "empty" | "ready";
  readonly document?: CoeditingShellDocument;
  readonly editorSlot?: ReactNode;
};

const markdownPreview = (markdown: string) =>
  markdown
    .split("\n")
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 4);

function CoeditingRail({
  title,
  emptyLabel,
  children,
}: {
  readonly title: string;
  readonly emptyLabel: string;
  readonly children?: ReactNode;
}) {
  return (
    <section className="coediting-rail-section" aria-label={title}>
      <h2>{title}</h2>
      {children ?? <p>{emptyLabel}</p>}
    </section>
  );
}

function ReadyCoeditingShell({
  document,
  editorSlot,
}: {
  readonly document: CoeditingShellDocument;
  readonly editorSlot?: ReactNode;
}) {
  const annotations = document.annotations ?? [];
  const suggestions = document.suggestions ?? [];

  return (
    <div className="coediting-shell">
      <div className="coediting-document">
        <NotionDocumentPage
          page={{
            id: document.id,
            eyebrow: document.eyebrow,
            title: document.title,
            intro: `Latest version ${document.latestVersionId}. Source-backed document for human and agent collaboration.`,
            sections: [
              {
                heading: "Working Draft",
                body:
                  editorSlot === undefined
                    ? markdownPreview(document.markdown)
                    : ["Rich editor slot is active for this document."],
              },
              {
                heading: "Source metadata",
                body: [
                  `Kind: \`${document.sourceMetadata.kind}\``,
                  `Title: **${document.sourceMetadata.title}**`,
                  `Source IDs: \`${document.sourceMetadata.sourceIds.join(", ")}\``,
                ],
              },
            ],
          }}
        />
        {editorSlot ? (
          <section className="coediting-editor-slot" aria-label="Editor">
            {editorSlot}
          </section>
        ) : null}
      </div>

      <aside className="coediting-rail" aria-label="Co-editing activity">
        <CoeditingRail
          title="Annotations"
          emptyLabel="No open annotations for this document."
        >
          {annotations.length > 0
            ? annotations.map((annotation) => (
                <article className="coediting-rail-item" key={annotation.id}>
                  <p>
                    <strong>{annotation.authorLabel}</strong>
                    <span> {annotation.status}</span>
                  </p>
                  <blockquote>{annotation.quotedText}</blockquote>
                  <p>{annotation.body}</p>
                </article>
              ))
            : undefined}
        </CoeditingRail>

        <CoeditingRail
          title="Agent suggestions"
          emptyLabel="No agent suggestions are pending."
        >
          {suggestions.length > 0
            ? suggestions.map((suggestion) => (
                <article className="coediting-rail-item" key={suggestion.id}>
                  <p>
                    <strong>{suggestion.title}</strong>
                    <span> {suggestion.status}</span>
                  </p>
                  <p>{suggestion.body}</p>
                  <p>{suggestion.proposedByLabel}</p>
                </article>
              ))
            : undefined}
        </CoeditingRail>
      </aside>
    </div>
  );
}

export function CoeditingShell({
  state,
  document,
  editorSlot,
}: CoeditingShellProps) {
  if (state === "loading") {
    return (
      <NotionDocumentPage
        page={{
          id: "coediting-loading",
          eyebrow: "Co-editing",
          title: "Loading document",
          intro: "Preparing the source-backed document workspace.",
          sections: [
            {
              heading: "Status",
              body: [
                "The document, versions, annotations, and suggestions are loading.",
              ],
            },
          ],
        }}
      />
    );
  }

  if (state === "empty" || document === undefined) {
    return (
      <NotionDocumentPage
        page={{
          id: "coediting-empty",
          eyebrow: "Co-editing",
          title: "No document selected",
          intro: "Choose or create a source-backed document before editing.",
          sections: [
            {
              heading: "Next step",
              body: [
                "Choose or create a source-backed document from markdown, links, notes, or uploaded business context.",
              ],
            },
          ],
        }}
      />
    );
  }

  return <ReadyCoeditingShell document={document} editorSlot={editorSlot} />;
}
