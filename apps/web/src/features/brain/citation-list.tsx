export type BrainCitation = {
  readonly citationKey: string;
  readonly sourceRevisionKey: string;
  readonly locator: string;
  readonly permalink?: string;
  readonly freshness: "fresh" | "stale";
  readonly state: "resolved" | "redacted" | "legacy_unresolved";
  readonly quotedText?: string;
};

export function CitationList({
  citations,
}: {
  readonly citations: readonly BrainCitation[];
}) {
  return (
    <section aria-label="Citations">
      {citations.length === 0 ? <p>No citations available.</p> : null}
      {citations.map((citation) => (
        <div key={citation.citationKey}>
          <strong>{citation.citationKey}</strong>
          <p>
            {citation.sourceRevisionKey} · {citation.locator}
          </p>
          <span>
            {citation.state === "resolved"
              ? citation.freshness
              : citation.state}
          </span>
          {citation.state === "resolved" && citation.quotedText ? (
            <p>{citation.quotedText}</p>
          ) : (
            <p>
              {citation.state === "redacted"
                ? "Citation text redacted."
                : "Citation provenance unresolved."}
            </p>
          )}
          {citation.permalink ? (
            <a href={citation.permalink} rel="noreferrer" target="_blank">
              Open source
            </a>
          ) : null}
        </div>
      ))}
    </section>
  );
}
