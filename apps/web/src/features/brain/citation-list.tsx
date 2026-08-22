export type BrainCitation = {
  readonly citationKey: string;
  readonly publicationSetKey: string;
  readonly entryKey: string;
  readonly sourceRevisionKey: string;
  readonly locator: string;
  readonly label?: string;
  readonly permalink?: string;
  readonly freshness: "current" | "stale" | "unknown";
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
      <EmptyCitationList count={citations.length} />
      {citations.map((citation) => (
        <CitationItem
          citation={citation}
          key={`${citation.publicationSetKey}:${citation.entryKey}`}
        />
      ))}
    </section>
  );
}

const EmptyCitationList = ({ count }: { readonly count: number }) =>
  count === 0 ? <p>No citations available.</p> : null;

const CitationItem = ({ citation }: { readonly citation: BrainCitation }) => (
  <div>
    <strong>{citation.citationKey}</strong>
    <CitationLabel label={citation.label} />
    <p>
      {citation.sourceRevisionKey} · {citation.locator}
    </p>
    <p>
      Exact evidence: {citation.publicationSetKey} / {citation.entryKey}
    </p>
    <span>{citationStateLabel(citation)}</span>
    <CitationText citation={citation} />
    <CitationPermalink permalink={citation.permalink} />
  </div>
);

const CitationLabel = ({ label }: { readonly label?: string }) =>
  label ? <p>{label}</p> : null;

const citationStateLabel = ({
  freshness,
  state,
}: BrainCitation): BrainCitation["freshness"] | BrainCitation["state"] =>
  state === "resolved" ? freshness : state;

const unresolvedCitationCopy: Record<BrainCitation["state"], string> = {
  resolved: "Citation provenance unresolved.",
  redacted: "Citation text redacted.",
  legacy_unresolved: "Citation provenance unresolved.",
};

const CitationText = ({ citation }: { readonly citation: BrainCitation }) => {
  const copy =
    citation.state === "resolved" && citation.quotedText
      ? citation.quotedText
      : unresolvedCitationCopy[citation.state];
  return <p>{copy}</p>;
};

const CitationPermalink = ({ permalink }: { readonly permalink?: string }) =>
  permalink ? (
    <a href={permalink} rel="noreferrer" target="_blank">
      Open source
    </a>
  ) : null;
