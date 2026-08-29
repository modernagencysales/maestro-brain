import { sha256Hex } from "../shared/sha256";

export const CONTEXT_PACK_POLICY_VERSION = "brain-context-v1";
export const MAX_CONTEXT_CITATIONS = 10;

export type BrainPackFreshness = "current" | "review-due" | "stale" | "unknown";

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
  readonly evidenceMode: "recent_evidence" | "company_truth" | "mixed";
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
    evidenceMode: pack.evidenceMode,
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
