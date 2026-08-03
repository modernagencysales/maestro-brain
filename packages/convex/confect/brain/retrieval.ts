import { assertReadableLifecycle } from "./lifecycle";
import { sha256Hex } from "../shared/sha256";

export type AskPage = {
  readonly pageKey: string;
  readonly title: string;
  readonly markdown: string;
  readonly status: "active" | "archived" | "redacted" | "purged";
  readonly lifecycle: { readonly state: string; readonly generation: number };
  readonly currentRevisionKey: string | null;
};

export type AskRevision = {
  readonly pageKey: string;
  readonly revisionKey: string;
  readonly markdown: string;
  readonly state: string;
  readonly lifecycle: { readonly state: string; readonly generation: number };
};

export type AskCitation = {
  readonly citationId: string;
  readonly pageKey?: string;
  readonly revisionKey?: string;
  readonly sourceTitle: string;
  readonly quotedText: string;
  readonly startOffset: number;
  readonly endOffset: number;
};

export type AskEvidence = {
  readonly citationKey: string;
  readonly pageKey: string;
  readonly revisionKey: string;
  readonly title: string;
  readonly excerpt: string;
};

export type AskResponse =
  | {
      readonly status: "answered";
      readonly answer: string;
      readonly evidence: readonly AskEvidence[];
    }
  | {
      readonly status: "abstained";
      readonly reason: "insufficient_evidence";
      readonly answer: null;
      readonly evidence: readonly [];
    };

export type RetrievalReceiptState =
  "assembled" | "consumed" | "stale" | "revoked";

export type RetrievalReceipt = {
  readonly receiptKey: string;
  readonly state: RetrievalReceiptState;
  readonly workspaceId: string;
  readonly brainKey: string;
  readonly principalId: string;
  readonly queryHash: string;
  readonly candidateKeys: readonly string[];
  readonly manifestHash: string;
  readonly authorizationGeneration: number;
  readonly routeGeneration: number;
  readonly lifecycleGeneration: number;
  readonly policyGeneration: number;
  readonly createdAt: number;
};

type RetrievalAuthorization = {
  readonly workspaceId: string;
  readonly brainKey: string;
  readonly principalId: string;
  readonly role: "viewer" | "editor" | "admin" | "owner";
  readonly authorizationGeneration: number;
  readonly routeGeneration: number;
  readonly lifecycleGeneration: number;
  readonly policyGeneration: number;
  readonly lifecycleState?: "active" | "revoked" | "expired" | undefined;
  readonly expiresAt?: number | null | undefined;
};

type RetrievalCandidate = {
  readonly pageKey: string;
  readonly revisionKey: string;
  readonly lifecycleGeneration: number;
  readonly excerpt: string;
};

export const buildAuthorizedRetrievalReceipt = (
  input: RetrievalAuthorization & {
    readonly query: string;
    readonly candidates: readonly RetrievalCandidate[];
    readonly now: number;
  },
): RetrievalReceipt => {
  assertReadableLifecycle(
    {
      state: input.lifecycleState ?? "active",
      generation: input.lifecycleGeneration,
      expiresAt: input.expiresAt ?? null,
    },
    input.now,
  );
  if (
    input.role === "viewer" ||
    input.role === "editor" ||
    input.role === "admin" ||
    input.role === "owner"
  ) {
    const manifest = input.candidates.map((candidate) => ({
      key: `${candidate.pageKey}:${candidate.revisionKey}`,
      lifecycleGeneration: candidate.lifecycleGeneration,
      excerptHash: sha256Hex(candidate.excerpt),
    }));
    if (
      manifest.some(
        (candidate) =>
          candidate.lifecycleGeneration !== input.lifecycleGeneration,
      )
    ) {
      throw new Error("RetrievalManifestStale");
    }
    const manifestJson = JSON.stringify(manifest);
    const queryHash = `sha256:${sha256Hex(input.query.trim().toLowerCase())}`;
    const manifestHash = `sha256:${sha256Hex(manifestJson)}`;
    return {
      receiptKey: `retrieval:${input.workspaceId}:${sha256Hex(`${input.principalId}:${input.now}:${manifestHash}`)}`,
      state: "assembled",
      workspaceId: input.workspaceId,
      brainKey: input.brainKey,
      principalId: input.principalId,
      queryHash,
      candidateKeys: manifest.map((candidate) => candidate.key),
      manifestHash,
      authorizationGeneration: input.authorizationGeneration,
      routeGeneration: input.routeGeneration,
      lifecycleGeneration: input.lifecycleGeneration,
      policyGeneration: input.policyGeneration,
      createdAt: input.now,
    };
  }
  throw new Error("Unauthorized");
};

export const reauthorizeRetrievalReceipt = (
  receipt: RetrievalReceipt,
  current: Omit<RetrievalAuthorization, "brainKey" | "principalId"> & {
    readonly brainKey?: string;
    readonly principalId?: string;
    readonly now: number;
  },
): RetrievalReceipt => {
  if (
    current.lifecycleState === "revoked" ||
    current.lifecycleState === "expired" ||
    (current.expiresAt !== undefined &&
      current.expiresAt !== null &&
      current.expiresAt <= current.now)
  )
    return { ...receipt, state: "revoked" };
  const stale =
    receipt.workspaceId !== current.workspaceId ||
    (current.brainKey !== undefined && receipt.brainKey !== current.brainKey) ||
    (current.principalId !== undefined &&
      receipt.principalId !== current.principalId) ||
    receipt.authorizationGeneration !== current.authorizationGeneration ||
    receipt.routeGeneration !== current.routeGeneration ||
    receipt.lifecycleGeneration !== current.lifecycleGeneration ||
    receipt.policyGeneration !== current.policyGeneration;
  return { ...receipt, state: stale ? "stale" : "consumed" };
};

const stopWords = new Set([
  "the",
  "and",
  "for",
  "when",
  "where",
  "what",
  "who",
  "does",
  "is",
]);

const queryWords = (query: string) =>
  query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !stopWords.has(word));

const isAuthoritative = (
  page: AskPage,
  revision: AskRevision | undefined,
  citation: AskCitation | undefined,
) =>
  page.status === "active" &&
  page.lifecycle.state === "active" &&
  revision?.pageKey === page.pageKey &&
  revision.revisionKey === page.currentRevisionKey &&
  revision.state === "published" &&
  revision.lifecycle.state === "active" &&
  revision.lifecycle.generation === page.lifecycle.generation &&
  citation?.pageKey === page.pageKey &&
  citation.revisionKey === revision.revisionKey &&
  citation.citationId.length > 0 &&
  citation.sourceTitle.length > 0 &&
  citation.quotedText.length > 0 &&
  citation.startOffset >= 0 &&
  citation.endOffset > citation.startOffset &&
  citation.endOffset <= revision.markdown.length &&
  revision.markdown.slice(citation.startOffset, citation.endOffset) ===
    citation.quotedText;

export const buildAskResponse = (input: {
  readonly query: string;
  readonly pages: readonly AskPage[];
  readonly revisions: readonly AskRevision[];
  readonly citations: readonly AskCitation[];
}): AskResponse => {
  const words = queryWords(input.query);
  const revisions = new Map(
    input.revisions.map((revision) => [revision.revisionKey, revision]),
  );
  const citations = new Map(
    input.citations.map((citation) => [
      `${citation.pageKey}:${citation.revisionKey}`,
      citation,
    ]),
  );
  const evidence = input.pages
    .map((page) => {
      const revision = page.currentRevisionKey
        ? revisions.get(page.currentRevisionKey)
        : undefined;
      const citation = revision
        ? citations.get(`${page.pageKey}:${revision.revisionKey}`)
        : undefined;
      return { page, revision, citation };
    })
    .filter(({ page, revision, citation }) =>
      isAuthoritative(page, revision, citation),
    )
    .filter(({ page, citation }) => {
      const haystack = `${page.title} ${citation?.quotedText}`.toLowerCase();
      return words.some((word) => haystack.includes(word));
    })
    .slice(0, 3)
    .map(({ page, revision, citation }) => ({
      citationKey: citation?.citationId ?? "",
      pageKey: page.pageKey,
      revisionKey: revision?.revisionKey ?? "",
      title: citation?.sourceTitle ?? page.title,
      excerpt: citation?.quotedText ?? "",
    }));

  if (evidence.length === 0)
    return {
      status: "abstained",
      reason: "insufficient_evidence",
      answer: null,
      evidence: [],
    };

  return {
    status: "answered",
    answer: evidence
      .map(({ excerpt, citationKey }) => `${excerpt} [${citationKey}]`)
      .join(" "),
    evidence,
  };
};
