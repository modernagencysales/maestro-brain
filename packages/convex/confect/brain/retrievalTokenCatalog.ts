import { sha256Hex } from "../shared/sha256";
import { RETRIEVAL_POSTING_LIMIT } from "./retrievalPublication";

export const RETRIEVAL_TOKEN_CATALOG_SET_LIMIT = 512;
export const RETRIEVAL_TOKEN_CATALOG_POSTING_LIMIT = RETRIEVAL_POSTING_LIMIT;

export type RetrievalTokenPostingIdentity = {
  readonly organizationKey: string;
  readonly workspaceId: string;
  readonly brainKey: string;
  readonly publicationSetKey: string;
  readonly tokenizerVersion: number;
  readonly token: string;
  readonly entryKey: string;
  readonly corpusKey?: string | undefined;
  readonly evidenceAt?: number | undefined;
  readonly authorityRank: number;
  readonly termFrequency: number;
  readonly inTitle: boolean;
  readonly inHeading: boolean;
};

export type RetrievalTokenCatalogContribution = {
  readonly publicationSetKey: string;
  readonly postingCount: number;
  readonly postingDigest: string;
};

const digest = (value: unknown) => `sha256:${sha256Hex(JSON.stringify(value))}`;

export const retrievalTokenPostingDigest = (
  postings: readonly RetrievalTokenPostingIdentity[],
) =>
  digest(
    postings
      .map((posting) => [
        posting.organizationKey,
        posting.workspaceId,
        posting.brainKey,
        posting.publicationSetKey,
        posting.tokenizerVersion,
        posting.token,
        posting.entryKey,
        posting.corpusKey ?? null,
        posting.evidenceAt ?? null,
        posting.authorityRank,
        posting.termFrequency,
        posting.inTitle,
        posting.inHeading,
      ])
      .sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right)),
      ),
  );

export const retrievalTokenCatalogContribution = (
  publicationSetKey: string,
  postings: readonly RetrievalTokenPostingIdentity[],
): RetrievalTokenCatalogContribution => ({
  publicationSetKey,
  postingCount: postings.length,
  postingDigest: retrievalTokenPostingDigest(postings),
});

export const retrievalTokenCatalogDigest = (
  contributions: readonly RetrievalTokenCatalogContribution[],
) =>
  digest(
    contributions
      .map(({ publicationSetKey, postingCount, postingDigest }) => [
        publicationSetKey,
        postingCount,
        postingDigest,
      ])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
  );

export const retrievalTokenCatalogIsConsistent = (catalog: {
  readonly expectedPostingCount: number;
  readonly expectedPostingDigest: string;
  readonly contributions: readonly RetrievalTokenCatalogContribution[];
}) =>
  catalog.expectedPostingCount ===
    catalog.contributions.reduce(
      (total, contribution) => total + contribution.postingCount,
      0,
    ) &&
  catalog.expectedPostingDigest ===
    retrievalTokenCatalogDigest(catalog.contributions);

export const retrievalTokenCatalogProjection = (
  postings: readonly RetrievalTokenPostingIdentity[],
) => {
  const byPublicationSet = new Map<string, RetrievalTokenPostingIdentity[]>();
  for (const posting of postings)
    byPublicationSet.set(posting.publicationSetKey, [
      ...(byPublicationSet.get(posting.publicationSetKey) ?? []),
      posting,
    ]);
  const contributions = [...byPublicationSet]
    .map(([publicationSetKey, setPostings]) =>
      retrievalTokenCatalogContribution(publicationSetKey, setPostings),
    )
    .sort((left, right) =>
      left.publicationSetKey.localeCompare(right.publicationSetKey),
    );
  return {
    contributions,
    expectedPostingCount: postings.length,
    expectedPostingDigest: retrievalTokenCatalogDigest(contributions),
  };
};
