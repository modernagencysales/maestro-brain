import { sha256Hex } from "../shared/sha256";
import {
  hasSufficientEvidenceCoverage,
  selectEvidenceQueryTokens,
} from "../brain/groundedRelevance";

export const CONTEXT_PACK_POLICY_VERSION = "brain-context-v2";
export const MAX_CONTEXT_CITATIONS = 10;

export type BrainPackFreshness = "current" | "review-due" | "stale" | "unknown";
export type BrainEvidenceProvider =
  "slack" | "google_drive" | "hubspot" | "brain_page" | "transcript";

const tokens = (value: string): readonly string[] => [
  ...new Set(
    value
      .toLowerCase()
      .match(/[a-z0-9][a-z0-9_-]{1,}/gu)
      ?.filter((token) => token.length > 2) ?? [],
  ),
];

export const lexicalScore = (question: string, text: string): number => {
  const haystack = new Set(tokens(text));
  return tokens(question).reduce(
    (score, token) => score + (haystack.has(token) ? 1 : 0),
    0,
  );
};

export const groundedLexicalScore = (
  question: string,
  text: string,
): number => {
  const queryTokens = selectEvidenceQueryTokens(tokens(question), "grounded");
  if (queryTokens.length === 0) return 0;
  const haystack = new Set(tokens(text));
  const matchedCount = queryTokens.filter((token) =>
    haystack.has(token),
  ).length;
  return hasSufficientEvidenceCoverage(
    "grounded",
    queryTokens.length,
    matchedCount,
  )
    ? matchedCount
    : 0;
};

const HIGH_RISK_TERMS = new Set([
  "price",
  "pricing",
  "cost",
  "offer",
  "policy",
  "contract",
  "terms",
  "responsible",
  "responsibility",
  "staff",
  "deal",
  "stage",
]);

export const effectiveRiskLevel = (
  question: string,
  requested?: "ordinary" | "high" | undefined,
): "ordinary" | "high" =>
  requested ??
  (tokens(question).some((token) => HIGH_RISK_TERMS.has(token))
    ? "high"
    : "ordinary");

export const normalizedEvidenceBody = (value: string): string =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");

export const sourceAuthorityWeight = (
  provider: BrainEvidenceProvider,
): number =>
  provider === "brain_page" ? 3 : provider === "google_drive" ? 2 : 1;

export const freshnessWeight = (freshness: BrainPackFreshness): number =>
  freshness === "current" ? 2 : freshness === "review-due" ? 1 : 0;

export const probableEvidenceConflict = (
  reviewedClaim: string,
  newerEvidence: string,
): boolean => {
  const claim = normalizedEvidenceBody(reviewedClaim);
  const evidence = normalizedEvidenceBody(newerEvidence);
  const sharedTerms = tokens(claim).filter((token) =>
    new Set(tokens(evidence)).has(token),
  );
  if (sharedTerms.length < 2) return false;
  const claimNumbers = new Set(claim.match(/\b\d+(?:\.\d+)?\b/gu) ?? []);
  const evidenceNumbers = new Set(evidence.match(/\b\d+(?:\.\d+)?\b/gu) ?? []);
  if (
    claimNumbers.size > 0 &&
    evidenceNumbers.size > 0 &&
    [...claimNumbers].some((value) => !evidenceNumbers.has(value))
  )
    return true;
  const negated = (value: string) =>
    /\b(?:no|not|never|without)\b/u.test(value);
  return negated(claim) !== negated(evidence);
};

export const claimFreshness = (
  nextReviewAt: number | undefined,
  asOf: number,
): BrainPackFreshness =>
  nextReviewAt === undefined
    ? "unknown"
    : nextReviewAt < asOf
      ? "stale"
      : nextReviewAt - asOf <= 14 * 24 * 60 * 60 * 1_000
        ? "review-due"
        : "current";

export const canonicalContextPackHash = (pack: {
  readonly schemaVersion: "4";
  readonly policyVersion: string;
  readonly requestedEvidenceMode: "recent_evidence" | "company_truth" | "mixed";
  readonly evidenceMode: "recent_evidence" | "company_truth" | "mixed";
  readonly fallbackReason?: "context-v4-disabled" | undefined;
  readonly workspaceId: string;
  readonly question: string;
  readonly asOf: number;
  readonly freshness: BrainPackFreshness;
  readonly claims: readonly unknown[];
  readonly citations: readonly unknown[];
  readonly conflicts: readonly unknown[];
  readonly omissions: readonly unknown[];
}): string => {
  const contentIdentity = {
    schemaVersion: pack.schemaVersion,
    policyVersion: pack.policyVersion,
    requestedEvidenceMode: pack.requestedEvidenceMode,
    evidenceMode: pack.evidenceMode,
    ...(pack.fallbackReason === undefined
      ? {}
      : { fallbackReason: pack.fallbackReason }),
    workspaceId: pack.workspaceId,
    question: pack.question,
    freshness: pack.freshness,
    claims: pack.claims,
    citations: pack.citations,
    conflicts: pack.conflicts,
    omissions: pack.omissions,
  };
  return `sha256:${sha256Hex(JSON.stringify(contentIdentity))}`;
};

export const aggregateFreshness = (
  values: readonly BrainPackFreshness[],
): BrainPackFreshness =>
  values.includes("stale")
    ? "stale"
    : values.includes("review-due")
      ? "review-due"
      : values.includes("unknown")
        ? "unknown"
        : values.length > 0
          ? "current"
          : "unknown";
