import type { GenericId } from "convex/values";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { DatabaseReader, DatabaseWriter } from "../_generated/services";
import { ValidationFailed } from "../errors";
import { sha256Hex } from "../shared/sha256";

export type EvidenceProvider =
  "brain_page" | "slack" | "google_drive" | "hubspot" | "transcript";

const PASSAGE_LENGTH = 640;
const PASSAGE_OVERLAP = 100;
const MAX_PASSAGES = 48;
const MAX_TOKENS_PER_PASSAGE = 80;
const RETRIEVAL_PROJECTION_VERSION = 2;
export const MAX_RETRIEVAL_TOKENS_PER_ENTRY =
  MAX_PASSAGES * MAX_TOKENS_PER_PASSAGE;

const STOP_WORDS = new Set([
  "about",
  "and",
  "are",
  "for",
  "from",
  "have",
  "into",
  "our",
  "that",
  "the",
  "their",
  "this",
  "with",
]);

export const evidenceTokens = (
  title: string,
  markdown: string,
  limit = 128,
): readonly Readonly<{ token: string; weight: number }>[] => {
  const weights = new Map<string, number>();
  const add = (text: string, weight: number) => {
    for (const token of text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []) {
      if (!STOP_WORDS.has(token))
        weights.set(token, (weights.get(token) ?? 0) + weight);
    }
  };
  add(title, 3);
  add(markdown, 1);
  return [...weights.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, limit)
    .map(([token, weight]) => ({ token, weight }));
};

export const evidencePassages = (title: string, markdown: string) => {
  const passages: Array<{
    readonly passageKey: string;
    readonly startOffset: number;
    readonly endOffset: number;
    readonly tokens: readonly Readonly<{ token: string; weight: number }>[];
  }> = [];
  let startOffset = 0;
  while (startOffset < markdown.length || passages.length === 0) {
    if (passages.length >= MAX_PASSAGES)
      return { passages, capacityExceeded: true } as const;
    const targetEnd = Math.min(markdown.length, startOffset + PASSAGE_LENGTH);
    const boundaryWindowStart = Math.max(startOffset, targetEnd - 240);
    const boundary =
      targetEnd === markdown.length
        ? targetEnd
        : Math.max(
            markdown.lastIndexOf("\n", targetEnd),
            markdown.lastIndexOf(" ", targetEnd),
          );
    const endOffset =
      boundary >= boundaryWindowStart ? boundary + 1 : targetEnd;
    const passageText = markdown.slice(startOffset, endOffset);
    const tokens = evidenceTokens(
      title,
      passageText,
      MAX_TOKENS_PER_PASSAGE + 1,
    );
    if (tokens.length > MAX_TOKENS_PER_PASSAGE)
      return { passages, capacityExceeded: true } as const;
    passages.push({
      passageKey: `${passages.length}:${startOffset}:${endOffset}`,
      startOffset,
      endOffset,
      tokens,
    });
    if (endOffset >= markdown.length) break;
    startOffset = Math.max(startOffset + 1, endOffset - PASSAGE_OVERLAP);
  }
  return { passages, capacityExceeded: false } as const;
};

export const evidenceContentHash = (title: string, markdown: string) =>
  sha256Hex(`${title}\n${markdown}`);

const currentSource = (
  workspaceId: GenericId<"workspaces">,
  sourceKey: string,
) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    return yield* reader
      .table("brainEvidenceSources")
      .index("by_workspace_and_source_key", (q) =>
        q.eq("workspaceId", workspaceId).eq("sourceKey", sourceKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
  });

const currentEntries = (
  workspaceId: GenericId<"workspaces">,
  sourceKey: string,
) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    return yield* reader
      .table("brainRetrievalEntries")
      .index("by_workspace_and_source_key_and_status", (q) =>
        q
          .eq("workspaceId", workspaceId)
          .eq("sourceKey", sourceKey)
          .eq("status", "current"),
      )
      .take(2)
      .pipe(Effect.orDie);
  });

const removeEntryTokens = (input: {
  readonly workspaceId: GenericId<"workspaces">;
  readonly entryKey: string;
}) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const rows = yield* reader
      .table("brainRetrievalTokens")
      .index("by_workspace_and_entry_key", (q) =>
        q.eq("workspaceId", input.workspaceId).eq("entryKey", input.entryKey),
      )
      .take(MAX_RETRIEVAL_TOKENS_PER_ENTRY + 1)
      .pipe(Effect.orDie);
    if (rows.length > MAX_RETRIEVAL_TOKENS_PER_ENTRY)
      return yield* new ValidationFailed({
        field: "entryKey",
        message: "Retrieval token capacity was exceeded.",
      });
    yield* Effect.forEach(rows, (row) =>
      writer.table("brainRetrievalTokens").delete(row._id).pipe(Effect.orDie),
    );
  });

export const projectEvidence = (input: {
  readonly workspaceId: GenericId<"workspaces">;
  readonly provider: EvidenceProvider;
  readonly scopeKey: string;
  readonly sourceKey: string;
  readonly revisionKey: string;
  readonly title: string;
  readonly markdown: string;
  readonly locator?: string | undefined;
  readonly providerMetadataJson?: string | undefined;
  readonly providerMetadataHash?: string | undefined;
  readonly sourceModifiedAt: number;
  readonly observedAt: number;
}) =>
  Effect.gen(function* () {
    const title = input.title.trim();
    if (title.length === 0 || input.sourceKey.trim().length === 0)
      return yield* new ValidationFailed({
        field: "sourceKey",
        message: "Evidence source and title must not be blank.",
      });
    const contentHash = evidenceContentHash(title, input.markdown);
    if (
      (input.providerMetadataJson === undefined) !==
        (input.providerMetadataHash === undefined) ||
      (input.providerMetadataJson !== undefined &&
        sha256Hex(input.providerMetadataJson) !== input.providerMetadataHash)
    )
      return yield* new ValidationFailed({
        field: "providerMetadataHash",
        message: "Evidence provider metadata failed integrity validation.",
      });
    const projection = evidencePassages(title, input.markdown);
    if (projection.capacityExceeded)
      return yield* new ValidationFailed({
        field: "markdown",
        message:
          "Evidence passage capacity was exceeded; split the source before indexing it.",
      });
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const revision = yield* reader
      .table("brainEvidenceRevisions")
      .index("by_workspace_and_source_key_and_revision_key", (q) =>
        q
          .eq("workspaceId", input.workspaceId)
          .eq("sourceKey", input.sourceKey)
          .eq("revisionKey", input.revisionKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    if (
      revision !== null &&
      (revision.contentHash !== contentHash ||
        (revision.providerMetadataHash ?? null) !==
          (input.providerMetadataHash ?? null))
    )
      return yield* new ValidationFailed({
        field: "revisionKey",
        message: "An immutable evidence revision changed content.",
      });
    if (revision === null)
      yield* writer
        .table("brainEvidenceRevisions")
        .insert({
          ...input,
          title,
          contentHash,
          tombstone: false,
          createdAt: input.observedAt,
        })
        .pipe(Effect.orDie);

    const source = yield* currentSource(input.workspaceId, input.sourceKey);
    const generation =
      (source?.generation ?? 0) +
      (source?.currentRevisionKey === input.revisionKey ? 0 : 1);
    if (source === null)
      yield* writer
        .table("brainEvidenceSources")
        .insert({
          workspaceId: input.workspaceId,
          provider: input.provider,
          scopeKey: input.scopeKey,
          sourceKey: input.sourceKey,
          title,
          ...(input.locator === undefined ? {} : { locator: input.locator }),
          ...(input.providerMetadataJson === undefined
            ? {}
            : { providerMetadataJson: input.providerMetadataJson }),
          ...(input.providerMetadataHash === undefined
            ? {}
            : { providerMetadataHash: input.providerMetadataHash }),
          status: "active",
          generation,
          currentRevisionKey: input.revisionKey,
          sourceModifiedAt: input.sourceModifiedAt,
          observedAt: input.observedAt,
          createdAt: input.observedAt,
          updatedAt: input.observedAt,
        })
        .pipe(Effect.orDie);
    else
      yield* writer
        .table("brainEvidenceSources")
        .patch(source._id, {
          provider: input.provider,
          scopeKey: input.scopeKey,
          title,
          locator: input.locator,
          providerMetadataJson: input.providerMetadataJson,
          providerMetadataHash: input.providerMetadataHash,
          status: "active",
          generation,
          currentRevisionKey: input.revisionKey,
          sourceModifiedAt: input.sourceModifiedAt,
          observedAt: input.observedAt,
          updatedAt: input.observedAt,
        })
        .pipe(Effect.orDie);

    const entries = yield* currentEntries(input.workspaceId, input.sourceKey);
    if (entries.length > 1)
      return yield* new ValidationFailed({
        field: "sourceKey",
        message: "Evidence source has multiple current retrieval entries.",
      });
    const current = entries[0];
    if (
      current?.revisionKey === input.revisionKey &&
      current.projectionVersion === RETRIEVAL_PROJECTION_VERSION
    )
      return { changed: false, entryKey: current.entryKey } as const;
    const reprojectingCurrent = current?.revisionKey === input.revisionKey;
    if (current !== undefined && !reprojectingCurrent) {
      yield* writer
        .table("brainRetrievalEntries")
        .patch(current._id, { status: "retired", updatedAt: input.observedAt })
        .pipe(Effect.orDie);
      yield* removeEntryTokens({
        workspaceId: input.workspaceId,
        entryKey: current.entryKey,
      });
    }
    const entryKey = `${input.sourceKey}:revision:${input.revisionKey}`;
    if (reprojectingCurrent && current !== undefined) {
      yield* removeEntryTokens({
        workspaceId: input.workspaceId,
        entryKey: current.entryKey,
      });
      yield* writer
        .table("brainRetrievalEntries")
        .patch(current._id, {
          projectionVersion: RETRIEVAL_PROJECTION_VERSION,
          updatedAt: input.observedAt,
        })
        .pipe(Effect.orDie);
    } else
      yield* writer
        .table("brainRetrievalEntries")
        .insert({
          workspaceId: input.workspaceId,
          provider: input.provider,
          entryKey,
          sourceKey: input.sourceKey,
          revisionKey: input.revisionKey,
          title,
          markdown: input.markdown,
          contentHash,
          projectionVersion: RETRIEVAL_PROJECTION_VERSION,
          ...(input.locator === undefined ? {} : { locator: input.locator }),
          sourceModifiedAt: input.sourceModifiedAt,
          observedAt: input.observedAt,
          status: "current",
          createdAt: input.observedAt,
          updatedAt: input.observedAt,
        })
        .pipe(Effect.orDie);
    yield* Effect.forEach(projection.passages, (passage) =>
      Effect.forEach(passage.tokens, (token) =>
        writer
          .table("brainRetrievalTokens")
          .insert({
            workspaceId: input.workspaceId,
            ...token,
            entryKey,
            passageKey: passage.passageKey,
            passageStartOffset: passage.startOffset,
            passageEndOffset: passage.endOffset,
            sourceKey: input.sourceKey,
            revisionKey: input.revisionKey,
            createdAt: input.observedAt,
          })
          .pipe(Effect.orDie),
      ),
    );
    return { changed: true, entryKey } as const;
  });

export const retireEvidence = (input: {
  readonly workspaceId: GenericId<"workspaces">;
  readonly sourceKey: string;
  readonly revisionKey: string;
  readonly observedAt: number;
}) =>
  Effect.gen(function* () {
    const source = yield* currentSource(input.workspaceId, input.sourceKey);
    if (source === null || source.status === "removed") return false;
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const entries = yield* currentEntries(input.workspaceId, input.sourceKey);
    if (entries.length > 1)
      return yield* new ValidationFailed({
        field: "sourceKey",
        message: "Evidence source has multiple current retrieval entries.",
      });
    const current = entries[0];
    if (current !== undefined) {
      yield* writer
        .table("brainRetrievalEntries")
        .patch(current._id, { status: "retired", updatedAt: input.observedAt })
        .pipe(Effect.orDie);
      yield* removeEntryTokens({
        workspaceId: input.workspaceId,
        entryKey: current.entryKey,
      });
    }
    const tombstone = yield* reader
      .table("brainEvidenceRevisions")
      .index("by_workspace_and_source_key_and_revision_key", (q) =>
        q
          .eq("workspaceId", input.workspaceId)
          .eq("sourceKey", input.sourceKey)
          .eq("revisionKey", input.revisionKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    if (tombstone === null)
      yield* writer
        .table("brainEvidenceRevisions")
        .insert({
          workspaceId: input.workspaceId,
          provider: source.provider,
          scopeKey: source.scopeKey,
          sourceKey: input.sourceKey,
          revisionKey: input.revisionKey,
          title: source.title,
          markdown: "",
          contentHash: evidenceContentHash(source.title, ""),
          ...(source.locator === undefined ? {} : { locator: source.locator }),
          sourceModifiedAt: source.sourceModifiedAt,
          observedAt: input.observedAt,
          tombstone: true,
          createdAt: input.observedAt,
        })
        .pipe(Effect.orDie);
    yield* writer
      .table("brainEvidenceSources")
      .patch(source._id, {
        status: "removed",
        generation: source.generation + 1,
        currentRevisionKey: input.revisionKey,
        observedAt: input.observedAt,
        updatedAt: input.observedAt,
      })
      .pipe(Effect.orDie);
    return true;
  });
