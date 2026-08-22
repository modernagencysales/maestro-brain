import type { GenericId } from "convex/values";
import * as Effect from "effect/Effect";

import { DatabaseReader } from "../_generated/services";
import { sha256Hex } from "../shared/sha256";
import { retrievalPublicationSubjectKey } from "./retrievalPublication";

export const MAX_PUBLICATION_HISTORY_ROWS = 100;
export const MAX_PUBLICATION_ENTRY_ROWS = 512;
export const MAX_PUBLICATION_TOKEN_ROWS = 5_000;

type PublicationKind =
  "page" | "slack" | "transcript" | "document" | "projection";
type PublicationSetState = "current" | "retired";

export type PublicationIntegritySet = {
  readonly workspaceId: string;
  readonly brainKey: string;
  readonly corpusKey: string;
  readonly originKind: PublicationKind;
  readonly originTable: string;
  readonly sourceKey: string;
  readonly sourceRevisionKey: string;
  readonly connectorScopeKey?: string | undefined;
  readonly connectionKey?: string | undefined;
  readonly connectionGeneration?: number | undefined;
  readonly publicationSubjectKey?: string | undefined;
  readonly publicationSetKey: string;
  readonly publicationGeneration: number;
  readonly expectedEntryCount: number;
  readonly expectedTokenCount: number;
  readonly manifestHash: string;
  readonly state: PublicationSetState;
};

export type PublicationIntegritySubject = {
  readonly workspaceId: string;
  readonly brainKey: string;
  readonly corpusKey: string;
  readonly originKind: PublicationKind;
  readonly originTable: string;
  readonly sourceKey: string;
  readonly connectorScopeKey?: string | undefined;
  readonly connectionKey?: string | undefined;
  readonly connectionGeneration?: number | undefined;
  readonly publicationSubjectKey: string;
  readonly currentPublicationSetKey: string | null;
  readonly lastPublicationGeneration: number;
};

export type PublicationIntegrityEntry = {
  readonly workspaceId: string;
  readonly brainKey: string;
  readonly corpusKey: string;
  readonly kind: PublicationKind;
  readonly originTable: string;
  readonly sourceKey: string;
  readonly sourceRevisionKey: string;
  readonly connectorScopeKey?: string | undefined;
  readonly connectionKey?: string | undefined;
  readonly connectionGeneration?: number | undefined;
  readonly publicationSubjectKey?: string | undefined;
  readonly publicationSetKey: string;
  readonly publicationGeneration: number;
  readonly entryKey: string;
  readonly state: "published" | "revoked" | "building";
};

export type PublicationIntegrityToken = {
  readonly workspaceId: string;
  readonly brainKey: string;
  readonly publicationSetKey: string;
  readonly publicationState?: "current" | "retired" | undefined;
  readonly entryKey: string;
  readonly token: string;
};

export type PublicationIntegrityIssueCode =
  | "origin_missing"
  | "subject_missing"
  | "duplicate_subject"
  | "subject_collision"
  | "set_subject_mismatch"
  | "duplicate_current_set"
  | "dangling_current_pointer"
  | "pointer_to_retired_set"
  | "allocator_generation_regression"
  | "entry_count_mismatch"
  | "token_count_mismatch"
  | "entry_identity_mismatch"
  | "token_identity_mismatch"
  | "manifest_hash_mismatch";

export type PublicationIntegrityIssue = {
  readonly code: PublicationIntegrityIssueCode;
  readonly publicationSetKey: string;
  readonly detail: string;
};

export type PublicationIntegritySnapshot = {
  readonly expectedPublicationSubjectKey: string;
  readonly originPresent: boolean;
  readonly set: PublicationIntegritySet;
  readonly subjects: readonly PublicationIntegritySubject[];
  readonly subjectHistory: readonly PublicationIntegritySet[];
  readonly entries: readonly PublicationIntegrityEntry[];
  readonly tokens: readonly PublicationIntegrityToken[];
};

const digest = (value: unknown): string =>
  `sha256:${sha256Hex(JSON.stringify(value))}`;

export const publicationCitationInvalidationReceipt = (input: {
  readonly organizationKey: string;
  readonly workspaceId: string;
  readonly brainKey: string;
  readonly publicationSetKey: string;
  readonly reason: "retention_expired" | "operator_invalidated";
  readonly invalidatedAt: number;
}) => {
  const receiptBase = {
    organizationKey: input.organizationKey,
    workspaceId: input.workspaceId,
    brainKey: input.brainKey,
    publicationSetKey: input.publicationSetKey,
    reason: input.reason,
    invalidatedAt: input.invalidatedAt,
  };
  return {
    receiptKey: `rcinv_${sha256Hex(JSON.stringify(receiptBase))}`,
    reason: input.reason,
    invalidatedAt: input.invalidatedAt,
    receiptDigest: digest(receiptBase),
  } as const;
};

const normalizedOptional = (value: string | undefined): string | null =>
  value ?? null;

const sameSubjectIdentity = (
  subject: PublicationIntegritySubject,
  set: PublicationIntegritySet,
): boolean =>
  String(subject.workspaceId) === String(set.workspaceId) &&
  subject.brainKey === set.brainKey &&
  subject.corpusKey === set.corpusKey &&
  subject.originKind === set.originKind &&
  subject.originTable === set.originTable &&
  subject.sourceKey === set.sourceKey &&
  normalizedOptional(subject.connectorScopeKey) ===
    normalizedOptional(set.connectorScopeKey) &&
  normalizedOptional(subject.connectionKey) ===
    normalizedOptional(set.connectionKey) &&
  (subject.connectionGeneration ?? null) === (set.connectionGeneration ?? null);

const sameSetSubjectIdentity = (
  left: PublicationIntegritySet,
  right: PublicationIntegritySet,
): boolean =>
  String(left.workspaceId) === String(right.workspaceId) &&
  left.brainKey === right.brainKey &&
  left.corpusKey === right.corpusKey &&
  left.originKind === right.originKind &&
  left.originTable === right.originTable &&
  left.sourceKey === right.sourceKey &&
  normalizedOptional(left.connectorScopeKey) ===
    normalizedOptional(right.connectorScopeKey);

export const publicationManifestHash = (input: {
  readonly entryKeys: readonly string[];
  readonly tokens: readonly {
    readonly token: string;
    readonly entryKey: string;
  }[];
}): string =>
  digest({
    entryKeys: [...input.entryKeys].sort(),
    tokens: [...input.tokens]
      .map(({ token, entryKey }) => `${token}:${entryKey}`)
      .sort(),
  });

export const advancePublicationIntegrityDigest = (
  predecessorDigest: string,
  itemDigest: string,
): string => digest({ predecessorDigest, itemDigest });

export const inspectPublicationIntegrity = (
  input: PublicationIntegritySnapshot,
) => {
  const issues: PublicationIntegrityIssue[] = [];
  const add = (code: PublicationIntegrityIssueCode, detail: string) =>
    issues.push({
      code,
      publicationSetKey: input.set.publicationSetKey,
      detail,
    });

  if (!input.originPresent)
    add("origin_missing", "The immutable publication origin is missing.");
  if (input.subjects.length === 0)
    add("subject_missing", "The publication subject row is missing.");
  if (input.subjects.length > 1)
    add("duplicate_subject", "More than one subject row owns the identity.");
  const subject = input.subjects[0];
  if (
    subject !== undefined &&
    (!sameSubjectIdentity(subject, input.set) ||
      subject.publicationSubjectKey !== input.expectedPublicationSubjectKey)
  )
    add(
      "subject_collision",
      "The deterministic subject key resolves to a different identity.",
    );
  if (input.set.publicationSubjectKey !== input.expectedPublicationSubjectKey)
    add(
      "set_subject_mismatch",
      "The publication set does not reference its deterministic subject.",
    );

  const history = input.subjectHistory.filter((candidate) =>
    sameSetSubjectIdentity(candidate, input.set),
  );
  const currentSets = history.filter(({ state }) => state === "current");
  if (currentSets.length > 1)
    add(
      "duplicate_current_set",
      "A logical publication has multiple current publication sets.",
    );
  if (subject !== undefined) {
    const pointed =
      subject.currentPublicationSetKey === null
        ? null
        : (history.find(
            ({ publicationSetKey }) =>
              publicationSetKey === subject.currentPublicationSetKey,
          ) ?? null);
    if (subject.currentPublicationSetKey !== null && pointed === null)
      add(
        "dangling_current_pointer",
        "The subject current pointer does not resolve to retained history.",
      );
    else if (pointed?.state === "retired")
      add(
        "pointer_to_retired_set",
        "The subject current pointer references a retired publication set.",
      );
    const soleCurrent = currentSets.length === 1 ? currentSets[0] : undefined;
    if (
      soleCurrent !== undefined &&
      subject.currentPublicationSetKey !== soleCurrent.publicationSetKey
    )
      add(
        "dangling_current_pointer",
        "The subject pointer does not reference the sole current set.",
      );
    const maximumGeneration = Math.max(
      0,
      ...history.map(({ publicationGeneration }) => publicationGeneration),
    );
    if (subject.lastPublicationGeneration < maximumGeneration)
      add(
        "allocator_generation_regression",
        "The subject allocator trails retained publication history.",
      );
  }

  if (input.entries.length !== input.set.expectedEntryCount)
    add(
      "entry_count_mismatch",
      "The entry count differs from the publication-set manifest.",
    );
  if (input.tokens.length !== input.set.expectedTokenCount)
    add(
      "token_count_mismatch",
      "The token count differs from the publication-set manifest.",
    );
  const expectedEntryState =
    input.set.state === "current" ? "published" : "revoked";
  if (
    input.entries.some(
      (entry) =>
        String(entry.workspaceId) !== String(input.set.workspaceId) ||
        entry.brainKey !== input.set.brainKey ||
        entry.corpusKey !== input.set.corpusKey ||
        entry.kind !== input.set.originKind ||
        entry.originTable !== input.set.originTable ||
        entry.sourceKey !== input.set.sourceKey ||
        entry.sourceRevisionKey !== input.set.sourceRevisionKey ||
        normalizedOptional(entry.connectorScopeKey) !==
          normalizedOptional(input.set.connectorScopeKey) ||
        normalizedOptional(entry.connectionKey) !==
          normalizedOptional(input.set.connectionKey) ||
        (entry.connectionGeneration ?? null) !==
          (input.set.connectionGeneration ?? null) ||
        entry.publicationSubjectKey !== input.expectedPublicationSubjectKey ||
        entry.publicationSetKey !== input.set.publicationSetKey ||
        entry.publicationGeneration !== input.set.publicationGeneration ||
        entry.state !== expectedEntryState,
    ) ||
    new Set(input.entries.map(({ entryKey }) => entryKey)).size !==
      input.entries.length
  )
    add(
      "entry_identity_mismatch",
      "An entry does not match its subject, set, origin, generation, or state.",
    );
  const entryKeys = new Set(input.entries.map(({ entryKey }) => entryKey));
  const expectedTokenState = input.set.state;
  if (
    input.tokens.some(
      (token) =>
        String(token.workspaceId) !== String(input.set.workspaceId) ||
        token.brainKey !== input.set.brainKey ||
        token.publicationSetKey !== input.set.publicationSetKey ||
        !entryKeys.has(token.entryKey) ||
        (token.publicationState !== undefined &&
          token.publicationState !== expectedTokenState),
    ) ||
    new Set(input.tokens.map(({ token, entryKey }) => `${token}:${entryKey}`))
      .size !== input.tokens.length
  )
    add(
      "token_identity_mismatch",
      "A token does not match its publication set, state, or entry.",
    );
  const actualManifestHash = publicationManifestHash({
    entryKeys: input.entries.map(({ entryKey }) => entryKey),
    tokens: input.tokens,
  });
  if (input.set.manifestHash !== actualManifestHash)
    add(
      "manifest_hash_mismatch",
      "The publication manifest hash does not match its entries and tokens.",
    );

  const setDigest = digest({
    publicationSubjectKey: input.expectedPublicationSubjectKey,
    publicationSetKey: input.set.publicationSetKey,
    publicationGeneration: input.set.publicationGeneration,
    state: input.set.state,
    manifestHash: actualManifestHash,
    entryKeys: [...entryKeys].sort(),
    tokenKeys: input.tokens
      .map(({ token, entryKey }) => `${token}:${entryKey}`)
      .sort(),
    issues: issues.map(({ code }) => code).sort(),
  });
  return {
    issues,
    setDigest,
    entryCount: input.entries.length,
    tokenCount: input.tokens.length,
  } as const;
};

export type StoredPublicationSet = PublicationIntegritySet & {
  readonly organizationKey: string;
};

export const publicationOriginPresentEffect = (set: StoredPublicationSet) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    if (set.originKind === "page") {
      const rows = yield* reader
        .table("pageRevisions")
        .index("by_workspace_revision_key", (query) =>
          query
            .eq("workspaceId", set.workspaceId as GenericId<"workspaces">)
            .eq("revisionKey", set.sourceRevisionKey),
        )
        .take(2)
        .pipe(Effect.orDie);
      return rows.length === 1 && rows[0]?.pageKey === set.sourceKey;
    }
    if (set.originKind === "slack") {
      const rows = yield* reader
        .table("sourceRevisions")
        .index("by_source_revision_key", (query) =>
          query
            .eq("organizationKey", set.organizationKey)
            .eq("sourceRevisionKey", set.sourceRevisionKey),
        )
        .take(2)
        .pipe(Effect.orDie);
      const revision = rows[0];
      return (
        rows.length === 1 &&
        revision?.sourceKey === set.sourceKey &&
        revision.channelKey === set.connectorScopeKey &&
        revision.connectionKey === set.connectionKey &&
        revision.connectionGeneration === set.connectionGeneration
      );
    }
    if (set.originKind === "transcript") {
      const revisions = yield* reader
        .table("sourceUnitRevisions")
        .index("by_unit_revision_key", (query) =>
          query
            .eq("organizationKey", set.organizationKey)
            .eq("unitRevisionKey", set.sourceRevisionKey),
        )
        .take(2)
        .pipe(Effect.orDie);
      const units = yield* reader
        .table("sourceUnits")
        .index("by_unit_key", (query) =>
          query
            .eq("organizationKey", set.organizationKey)
            .eq("unitKey", set.sourceKey),
        )
        .take(2)
        .pipe(Effect.orDie);
      return (
        revisions.length === 1 &&
        units.length === 1 &&
        revisions[0]?.unitKey === set.sourceKey &&
        units[0]?.connectionKey === set.connectionKey &&
        units[0]?.connectionGeneration === set.connectionGeneration
      );
    }
    return false;
  });

export type PublicationIntegrityLoadResult =
  | {
      readonly kind: "validated";
      readonly report: ReturnType<typeof inspectPublicationIntegrity>;
    }
  | {
      readonly kind: "capacity";
      readonly publicationSetKey: string;
      readonly historyCount: number;
      readonly entryCount: number;
      readonly tokenCount: number;
    };

export const validatePublicationSetIntegrityEffect = (
  set: StoredPublicationSet,
) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const expectedPublicationSubjectKey = retrievalPublicationSubjectKey({
      workspaceId: String(set.workspaceId),
      brainKey: set.brainKey,
      corpusKey: set.corpusKey,
      originTable: set.originTable,
      kind: set.originKind,
      sourceKey: set.sourceKey,
      ...(set.connectorScopeKey === undefined
        ? {}
        : { connectorScopeKey: set.connectorScopeKey }),
    });
    const subjects = yield* reader
      .table("retrievalPublicationSubjects")
      .index("by_workspace_subject", (query) =>
        query
          .eq("workspaceId", set.workspaceId as GenericId<"workspaces">)
          .eq("publicationSubjectKey", expectedPublicationSubjectKey),
      )
      .take(3)
      .pipe(Effect.orDie);
    const historyRows = yield* reader
      .table("retrievalPublicationSets")
      .index("by_workspace_brain_source_state_generation", (query) =>
        query
          .eq("workspaceId", set.workspaceId as GenericId<"workspaces">)
          .eq("brainKey", set.brainKey)
          .eq("originTable", set.originTable)
          .eq("sourceKey", set.sourceKey),
      )
      .take(MAX_PUBLICATION_HISTORY_ROWS + 1)
      .pipe(Effect.orDie);
    const entries = yield* reader
      .table("retrievalEntries")
      .index("by_workspace_brain_publication_set_entry", (query) =>
        query
          .eq("workspaceId", set.workspaceId as GenericId<"workspaces">)
          .eq("brainKey", set.brainKey)
          .eq("publicationSetKey", set.publicationSetKey),
      )
      .take(MAX_PUBLICATION_ENTRY_ROWS + 1)
      .pipe(Effect.orDie);
    const tokens = yield* reader
      .table("retrievalTokens")
      .index("by_workspace_brain_publication_set_entry", (query) =>
        query
          .eq("workspaceId", set.workspaceId as GenericId<"workspaces">)
          .eq("brainKey", set.brainKey)
          .eq("publicationSetKey", set.publicationSetKey),
      )
      .take(MAX_PUBLICATION_TOKEN_ROWS + 1)
      .pipe(Effect.orDie);
    if (
      historyRows.length > MAX_PUBLICATION_HISTORY_ROWS ||
      entries.length > MAX_PUBLICATION_ENTRY_ROWS ||
      tokens.length > MAX_PUBLICATION_TOKEN_ROWS
    )
      return {
        kind: "capacity" as const,
        publicationSetKey: set.publicationSetKey,
        historyCount: historyRows.length,
        entryCount: entries.length,
        tokenCount: tokens.length,
      };
    const originPresent = yield* publicationOriginPresentEffect(set);
    return {
      kind: "validated" as const,
      report: inspectPublicationIntegrity({
        expectedPublicationSubjectKey,
        originPresent,
        set,
        subjects,
        subjectHistory: historyRows.filter(
          (
            candidate,
          ): candidate is typeof candidate & {
            readonly state: PublicationSetState;
          } => candidate.state === "current" || candidate.state === "retired",
        ),
        entries,
        tokens,
      }),
    };
  });

export const publicationSubjectDigest = (
  subject: PublicationIntegritySubject,
  history: readonly PublicationIntegritySet[],
): string =>
  digest({
    publicationSubjectKey: subject.publicationSubjectKey,
    currentPublicationSetKey: subject.currentPublicationSetKey,
    lastPublicationGeneration: subject.lastPublicationGeneration,
    history: history
      .map(({ publicationSetKey, publicationGeneration, state }) => ({
        publicationSetKey,
        publicationGeneration,
        state,
      }))
      .sort((left, right) =>
        left.publicationSetKey.localeCompare(right.publicationSetKey),
      ),
  });
