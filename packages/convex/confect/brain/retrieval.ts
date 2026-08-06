import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { DatabaseReader } from "../_generated/services";
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
  readonly sourceKind?: string;
  readonly pageKey?: string;
  readonly revisionKey?: string;
  readonly sourceTitle: string;
  readonly quotedText: string;
  readonly startOffset: number;
  readonly endOffset: number;
};

export type ResolvedTranscriptCitation = {
  readonly citationKey: string;
  readonly sourceKey: string;
  readonly sourceRevisionKey: string;
  readonly pageKey: string;
  readonly revisionKey: string;
  readonly title: string;
  readonly quotedText: string;
  readonly locator: string;
  readonly label: string;
  readonly permalink: string;
  readonly freshness: "fresh";
  readonly state: "resolved";
};

type TranscriptCitationInput = {
  readonly workspaceId: string;
  readonly citationId: string;
  readonly sourceId: string;
  readonly sourceKind: string;
  readonly sourceTitle: string;
  readonly quotedText: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly pageKey?: string | undefined;
  readonly revisionKey?: string | undefined;
  readonly sourceUnitRevisionKey?: string | undefined;
  readonly segmentKey?: string | undefined;
  readonly startMs?: number | undefined;
  readonly endMs?: number | undefined;
};

export const formatCitationTime = (milliseconds: number) => {
  const seconds = Math.floor(milliseconds / 1_000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};

export const resolveTranscriptCitation = (input: {
  readonly workspaceId: string;
  readonly organizationKey: string;
  readonly citation: TranscriptCitationInput;
  readonly unit: {
    readonly organizationKey: string;
    readonly connectionKey: string;
    readonly connectionGeneration: number;
    readonly unitKey: string;
    readonly currentUnitRevisionKey: string;
    readonly lifecycle: {
      readonly state: string;
      readonly generation?: number | undefined;
    };
  };
  readonly revision: {
    readonly organizationKey: string;
    readonly unitKey: string;
    readonly unitRevisionKey: string;
    readonly title?: string;
    readonly sourceUrl: string;
    readonly tombstone: boolean;
  };
  readonly segment: {
    readonly organizationKey: string;
    readonly unitKey: string;
    readonly unitRevisionKey: string;
    readonly segmentKey: string;
    readonly speakerLabel: string;
    readonly startMs: number | null;
    readonly endMs: number | null;
    readonly text: string;
  };
  readonly connection: {
    readonly organizationKey: string;
    readonly connectionKey: string;
    readonly connectionGeneration: number;
    readonly status: string;
  };
}): ResolvedTranscriptCitation | null => {
  const { citation, unit, revision, segment, connection } = input;
  if (
    citation.sourceKind !== "call_transcript" ||
    citation.workspaceId !== input.workspaceId ||
    !citation.pageKey ||
    !citation.revisionKey ||
    !citation.sourceUnitRevisionKey ||
    !citation.segmentKey ||
    unit.organizationKey !== input.organizationKey ||
    revision.organizationKey !== input.organizationKey ||
    segment.organizationKey !== input.organizationKey ||
    connection.organizationKey !== input.organizationKey ||
    unit.unitKey !== citation.sourceId ||
    unit.currentUnitRevisionKey !== citation.sourceUnitRevisionKey ||
    unit.lifecycle.state !== "active" ||
    revision.unitKey !== unit.unitKey ||
    revision.unitRevisionKey !== citation.sourceUnitRevisionKey ||
    revision.tombstone ||
    segment.unitKey !== unit.unitKey ||
    segment.unitRevisionKey !== revision.unitRevisionKey ||
    segment.segmentKey !== citation.segmentKey ||
    connection.connectionKey !== unit.connectionKey ||
    connection.connectionGeneration !== unit.connectionGeneration ||
    connection.status !== "active" ||
    citation.startOffset < 0 ||
    citation.endOffset <= citation.startOffset ||
    segment.text.slice(citation.startOffset, citation.endOffset) !==
      citation.quotedText ||
    (citation.startMs ?? null) !== segment.startMs ||
    (citation.endMs ?? null) !== segment.endMs
  )
    return null;

  const locator =
    segment.startMs === null
      ? `segment:${segment.segmentKey}`
      : segment.endMs === null
        ? `timestamp:${segment.startMs}`
        : `timestamp:${segment.startMs}-${segment.endMs}`;
  const label =
    segment.startMs === null
      ? segment.speakerLabel
      : `${segment.speakerLabel} · ${formatCitationTime(segment.startMs)}`;
  return {
    citationKey: citation.citationId,
    sourceKey: unit.unitKey,
    sourceRevisionKey: revision.unitRevisionKey,
    pageKey: citation.pageKey,
    revisionKey: citation.revisionKey,
    title: revision.title ?? citation.sourceTitle,
    quotedText: citation.quotedText,
    locator,
    label,
    permalink: revision.sourceUrl,
    freshness: "fresh",
    state: "resolved",
  };
};

export const loadTranscriptCitations = (input: {
  readonly workspaceId: string;
  readonly organizationKey: string;
  readonly citations: readonly TranscriptCitationInput[];
}) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const resolved: ResolvedTranscriptCitation[] = [];
    // ponytail: Task 4 replaces this workspace citation fence with a current route check.
    for (const citation of input.citations
      .filter(({ sourceKind }) => sourceKind === "call_transcript")
      .slice(0, 100)) {
      if (!citation.sourceUnitRevisionKey || !citation.segmentKey) continue;
      const unitRevisionKey = citation.sourceUnitRevisionKey;
      const segmentKey = citation.segmentKey;
      const unit = yield* reader
        .table("sourceUnits")
        .index("by_unit_key", (q) =>
          q
            .eq("organizationKey", input.organizationKey)
            .eq("unitKey", citation.sourceId),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      const revision = yield* reader
        .table("sourceUnitRevisions")
        .index("by_unit_revision_key", (q) =>
          q
            .eq("organizationKey", input.organizationKey)
            .eq("unitRevisionKey", unitRevisionKey),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      const segment = yield* reader
        .table("sourceSegments")
        .index("by_segment_key", (q) =>
          q
            .eq("organizationKey", input.organizationKey)
            .eq("segmentKey", segmentKey),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      if (unit === null || revision === null || segment === null) continue;
      const connection = yield* reader
        .table("providerConnections")
        .index("by_connection_key", (q) =>
          q.eq("connectionKey", unit.connectionKey),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      if (connection === null) continue;
      const projection = resolveTranscriptCitation({
        ...input,
        citation,
        unit,
        revision,
        segment,
        connection,
      });
      if (projection !== null) resolved.push(projection);
    }
    return resolved;
  });

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
  citation: AskCitation | ResolvedTranscriptCitation | undefined,
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
  ("citationKey" in citation
    ? citation.state === "resolved" && citation.quotedText.length > 0
    : citation.sourceKind !== "call_transcript" &&
      citation.citationId.length > 0 &&
      citation.sourceTitle.length > 0 &&
      citation.quotedText.length > 0 &&
      citation.startOffset >= 0 &&
      citation.endOffset > citation.startOffset &&
      citation.endOffset <= revision.markdown.length &&
      revision.markdown.slice(citation.startOffset, citation.endOffset) ===
        citation.quotedText);

export const buildAskResponse = (input: {
  readonly query: string;
  readonly pages: readonly AskPage[];
  readonly revisions: readonly AskRevision[];
  readonly citations: readonly AskCitation[];
  readonly transcriptCitations?: readonly ResolvedTranscriptCitation[];
}): AskResponse => {
  const words = queryWords(input.query);
  const revisions = new Map(
    input.revisions.map((revision) => [revision.revisionKey, revision]),
  );
  const citations = new Map<string, AskCitation | ResolvedTranscriptCitation>(
    input.citations
      .filter(({ sourceKind }) => sourceKind !== "call_transcript")
      .map((citation) => [
        `${citation.pageKey}:${citation.revisionKey}`,
        citation,
      ]),
  );
  for (const citation of input.transcriptCitations ?? [])
    citations.set(`${citation.pageKey}:${citation.revisionKey}`, citation);
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
      citationKey:
        citation === undefined
          ? ""
          : "citationKey" in citation
            ? citation.citationKey
            : citation.citationId,
      pageKey: page.pageKey,
      revisionKey: revision?.revisionKey ?? "",
      title:
        citation === undefined
          ? page.title
          : "citationKey" in citation
            ? citation.title
            : citation.sourceTitle,
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
