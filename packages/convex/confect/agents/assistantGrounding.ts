const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_EXCERPT_LENGTH = 640;

const STOP_WORDS = new Set([
  "about",
  "are",
  "does",
  "from",
  "have",
  "how",
  "into",
  "the",
  "latest",
  "need",
  "our",
  "should",
  "that",
  "their",
  "this",
  "what",
  "when",
  "where",
  "which",
  "with",
  "your",
]);

export type GroundingPage = Readonly<{
  id: string;
  workspaceId: string;
  title: string;
  markdown: string;
  updatedAt: number;
  status: "active" | "archived";
}>;

export type GroundingRevision = Readonly<{
  workspaceId: string;
  pageId: string;
  title: string;
  markdown: string;
  updatedAt: number;
  status: "active" | "archived";
}>;

export type GroundedCitation = Readonly<{
  citationKey: string;
  sourceId: string;
  sourceRevisionId: string;
  pageId: string;
  revisionUpdatedAt: number;
  title: string;
  excerpt: string;
  startOffset: number;
  endOffset: number;
  freshness: "current" | "review-due" | "stale";
}>;

type OmissionReason = "archived" | "revision-mismatch" | "not-relevant";

export type GroundedAnswer = Readonly<{
  status: "answered" | "insufficient-context";
  answerMarkdown: string | null;
  citations: readonly GroundedCitation[];
  freshness: "current" | "review-due" | "stale" | "unknown";
  asOf: number;
  omissions: readonly Readonly<{ reason: OmissionReason; count: number }>[];
}>;

const tokenize = (question: string): string[] =>
  [...new Set(question.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])].filter(
    (word) => !STOP_WORDS.has(word),
  );

const freshnessAt = (
  revisionUpdatedAt: number,
  now: number,
): GroundedCitation["freshness"] => {
  const age = Math.max(0, now - revisionUpdatedAt);
  if (age <= 30 * DAY_MS) return "current";
  if (age <= 90 * DAY_MS) return "review-due";
  return "stale";
};

const overallFreshness = (
  citations: readonly GroundedCitation[],
): GroundedAnswer["freshness"] => {
  if (citations.length === 0) return "unknown";
  if (citations.some(({ freshness }) => freshness === "stale")) return "stale";
  if (citations.some(({ freshness }) => freshness === "review-due"))
    return "review-due";
  return "current";
};

const excerptFor = (markdown: string, words: readonly string[]) => {
  const lower = markdown.toLowerCase();
  const firstMatch = words.reduce((best, word) => {
    const index = lower.indexOf(word);
    return index < 0 ? best : Math.min(best, index);
  }, Number.POSITIVE_INFINITY);
  const center = Number.isFinite(firstMatch) ? firstMatch : 0;
  const startOffset = Math.max(0, center - 120);
  const endOffset = Math.min(markdown.length, startOffset + MAX_EXCERPT_LENGTH);
  return {
    excerpt: markdown.slice(startOffset, endOffset),
    startOffset,
    endOffset,
  };
};

export const buildGroundedAnswer = (input: {
  readonly workspaceId: string;
  readonly question: string;
  readonly pages: readonly GroundingPage[];
  readonly revisions: readonly GroundingRevision[];
  readonly now: number;
  readonly maxCitations?: number | undefined;
}): GroundedAnswer => {
  const words = tokenize(input.question);
  const omissions = new Map<OmissionReason, number>();
  const omit = (reason: OmissionReason) =>
    omissions.set(reason, (omissions.get(reason) ?? 0) + 1);
  const revisions = new Map(
    input.revisions
      .filter(({ workspaceId }) => workspaceId === input.workspaceId)
      .map((revision) => [
        `${revision.pageId}:${revision.updatedAt}`,
        revision,
      ]),
  );

  const citations = input.pages
    .filter(({ workspaceId }) => workspaceId === input.workspaceId)
    .flatMap((page) => {
      if (page.status !== "active") {
        omit("archived");
        return [];
      }
      const revision = revisions.get(`${page.id}:${page.updatedAt}`);
      if (
        revision === undefined ||
        revision.status !== "active" ||
        revision.title !== page.title ||
        revision.markdown !== page.markdown
      ) {
        omit("revision-mismatch");
        return [];
      }
      const haystack = `${page.title}\n${page.markdown}`.toLowerCase();
      const score = words.reduce(
        (total, word) => total + (haystack.includes(word) ? 1 : 0),
        0,
      );
      if (words.length === 0 || score === 0) {
        omit("not-relevant");
        return [];
      }
      const { excerpt, startOffset, endOffset } = excerptFor(
        page.markdown,
        words,
      );
      if (excerpt.length === 0) {
        omit("not-relevant");
        return [];
      }
      const sourceId = `brain-page:${page.id}`;
      const sourceRevisionId = `${sourceId}:revision:${revision.updatedAt}`;
      return [
        {
          score,
          citation: {
            citationKey: `citation:${page.id}:${revision.updatedAt}`,
            sourceId,
            sourceRevisionId,
            pageId: page.id,
            revisionUpdatedAt: revision.updatedAt,
            title: page.title,
            excerpt,
            startOffset,
            endOffset,
            freshness: freshnessAt(revision.updatedAt, input.now),
          } satisfies GroundedCitation,
        },
      ];
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.citation.revisionUpdatedAt - left.citation.revisionUpdatedAt ||
        left.citation.sourceRevisionId.localeCompare(
          right.citation.sourceRevisionId,
        ),
    )
    .slice(0, Math.min(Math.max(Math.floor(input.maxCitations ?? 3), 1), 10))
    .map(({ citation }) => citation);

  const resultOmissions = [...omissions.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reason, count]) => ({ reason, count }));
  const asOf = input.now;

  if (citations.length === 0)
    return {
      status: "insufficient-context",
      answerMarkdown: null,
      citations,
      freshness: "unknown",
      asOf,
      omissions: resultOmissions,
    };

  return {
    status: "answered",
    answerMarkdown: citations
      .map(({ excerpt }, index) => `${excerpt} [${index + 1}]`)
      .join("\n\n"),
    citations,
    freshness: overallFreshness(citations),
    asOf,
    omissions: resultOmissions,
  };
};
