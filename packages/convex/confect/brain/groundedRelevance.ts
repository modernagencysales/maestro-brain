export type EvidenceRelevanceMode = "broad" | "grounded";

const GROUNDED_QUERY_STOP_WORDS = new Set([
  "after",
  "also",
  "are",
  "authoritative",
  "before",
  "company",
  "context",
  "could",
  "current",
  "does",
  "doing",
  "evidence",
  "explain",
  "give",
  "here",
  "how",
  "is",
  "our",
  "might",
  "most",
  "should",
  "show",
  "source",
  "sources",
  "tell",
  "there",
  "the",
  "this",
  "used",
  "uses",
  "using",
  "what",
  "was",
  "were",
  "who",
  "when",
  "where",
  "which",
  "while",
  "would",
  "we",
  "you",
  "your",
  "yours",
]);

export const selectEvidenceQueryTokens = (
  tokens: readonly string[],
  mode: EvidenceRelevanceMode,
) =>
  mode === "grounded"
    ? tokens.filter((token) => !GROUNDED_QUERY_STOP_WORDS.has(token))
    : tokens;

type RankedCandidate = Readonly<{
  score: number;
  matchedTokens: ReadonlySet<string>;
}>;

export const compareEvidenceCandidates = (
  mode: EvidenceRelevanceMode,
  [leftKey, left]: readonly [string, RankedCandidate],
  [rightKey, right]: readonly [string, RankedCandidate],
) => {
  const coverageOrder =
    mode === "grounded"
      ? right.matchedTokens.size - left.matchedTokens.size
      : 0;
  return (
    coverageOrder || right.score - left.score || leftKey.localeCompare(rightKey)
  );
};

export const contributesEvidenceCoverage = (
  mode: EvidenceRelevanceMode,
  matchedTokens: ReadonlySet<string>,
  coveredTokens: ReadonlySet<string>,
) =>
  mode === "broad" ||
  [...matchedTokens].some((token) => !coveredTokens.has(token));

export const addEvidenceCoverage = (
  coveredTokens: Set<string>,
  matchedTokens: ReadonlySet<string>,
) => {
  for (const token of matchedTokens) coveredTokens.add(token);
};

export const hasSufficientEvidenceCoverage = (
  mode: EvidenceRelevanceMode,
  queryTokenCount: number,
  coveredTokenCount: number,
) =>
  mode === "broad" ||
  coveredTokenCount >= Math.max(1, Math.ceil(queryTokenCount * 0.6));
