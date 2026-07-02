import type { ReactNode } from "react";

export type NotionDocumentSection = {
  readonly heading: string;
  readonly body: readonly string[];
};

export type NotionDocumentPageModel = {
  readonly id: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly intro: string;
  readonly diagram?: ReactNode;
  readonly diagramLabel?: string;
  readonly sections: readonly NotionDocumentSection[];
};

export const renderInlineMarkdown = (text: string) => {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);

  return parts.map((part, index) => {
    const key = `${part}-${index}`;

    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }

    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={key}>{part.slice(1, -1)}</code>;
    }

    return <span key={key}>{part}</span>;
  });
};

export function NotionMarkdownLine({ text }: { readonly text: string }) {
  if (text.startsWith("- ")) {
    return <li>{renderInlineMarkdown(text.slice(2))}</li>;
  }

  return <p>{renderInlineMarkdown(text)}</p>;
}

export function NotionDocumentDiagram({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="notion-section" aria-label={label}>
      {children}
    </section>
  );
}

export function NotionDocumentPage({
  page,
}: {
  readonly page: NotionDocumentPageModel;
}) {
  return (
    <article className="notion-page" id={page.id}>
      <p className="notion-eyebrow">{page.eyebrow}</p>
      <h1>{page.title}</h1>
      <p className="notion-intro">{page.intro}</p>

      {page.diagram ? (
        <NotionDocumentDiagram label={page.diagramLabel ?? "Page diagram"}>
          {page.diagram}
        </NotionDocumentDiagram>
      ) : null}

      {page.sections.map((section) => {
        const listItems = section.body.filter((line) => line.startsWith("- "));
        const paragraphs = section.body.filter(
          (line) => !line.startsWith("- "),
        );

        return (
          <section className="notion-section" key={section.heading}>
            <h2>{section.heading}</h2>
            {paragraphs.map((line) => (
              <NotionMarkdownLine key={line} text={line} />
            ))}
            {listItems.length > 0 ? (
              <ul>
                {listItems.map((line) => (
                  <NotionMarkdownLine key={line} text={line} />
                ))}
              </ul>
            ) : null}
          </section>
        );
      })}
    </article>
  );
}
