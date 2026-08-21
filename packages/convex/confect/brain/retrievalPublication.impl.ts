import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import databaseSchema from "../_generated/schema";
import refs from "../_generated/refs";
import type { RetrievalPublicationJobsDoc } from "../_generated/docs";
import {
  DatabaseReader,
  DatabaseWriter,
  Scheduler,
} from "../_generated/services";
import { Unauthorized, ValidationFailed } from "../errors";
import { sha256Hex } from "../shared/sha256";
import {
  buildRetrievalPassages,
  buildRetrievalTokenRows,
  retrievalEntryKey,
  retrievalPublicationSetKey,
  type RetrievalOrigin,
} from "./retrievalPublication";
import retrievalPublicationGroup, {
  PublishPageRevisionArgs,
  RebuildPageBatchArgs,
  RebuildRoutedCorpusBatchArgs,
  PublishSlackRevisionArgs,
  PublishTranscriptRevisionArgs,
  RunPublicationJobArgs,
  RunPublicationJobReturns,
  SweepPublicationJobsArgs,
  RetrievalOriginUnavailable,
  RetrievalPublicationCapacityExceeded,
  RetrievalPublicationConflict,
} from "./retrievalPublication.spec";
import {
  retrievalPublicationJobKey,
  retrievalPublicationJobRow,
  type RetrievalPublicationJobInput,
} from "./retrievalPublicationJob";
import type { RetrievalOriginReference } from "./retrievalSchemas";

const MAX_PUBLICATION_WRITES = 7_000;
const MAX_PRIOR_PUBLICATION_SETS = 100;
const MAX_ENTRIES_PER_PUBLICATION_SET = 512;
const MAX_ACTIVE_PUBLICATION_ROWS = 3_300;
const PUBLICATION_RETRY_BASE_MS = 1_000;

type RunPublicationJobInput = Schema.Schema.Type<typeof RunPublicationJobArgs>;
type RunPublicationJobOutput = Schema.Schema.Type<
  typeof RunPublicationJobReturns
>;

const manifestHash = (input: {
  readonly entryKeys: readonly string[];
  readonly tokens: readonly {
    readonly token: string;
    readonly entryKey: string;
  }[];
}) =>
  `sha256:${sha256Hex(
    JSON.stringify({
      entryKeys: [...input.entryKeys].sort(),
      tokens: [...input.tokens]
        .map(({ token, entryKey }) => `${token}:${entryKey}`)
        .sort(),
    }),
  )}`;

const activeLifecycle = (value: unknown) => {
  if (value === undefined) return true;
  if (typeof value !== "object" || value === null) return false;
  return (value as { readonly state?: unknown }).state === "active";
};

const loadCurrentPublicationTokens = (input: {
  readonly workspaceId: GenericId<"workspaces">;
  readonly brainKey: string;
  readonly publicationSetKeys: readonly string[];
}) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const groups = yield* Effect.all(
      input.publicationSetKeys.map((publicationSetKey) =>
        reader
          .table("retrievalTokens")
          .index("by_workspace_brain_publication_set_entry", (query) =>
            query
              .eq("workspaceId", input.workspaceId)
              .eq("brainKey", input.brainKey)
              .eq("publicationSetKey", publicationSetKey),
          )
          .take(MAX_ACTIVE_PUBLICATION_ROWS + 1)
          .pipe(Effect.orDie),
      ),
    );
    return groups.flat();
  });

const removePublicationTokens = (
  rows: readonly { readonly _id: GenericId<"retrievalTokens"> }[],
) =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
    for (const row of rows)
      yield* writer.table("retrievalTokens").delete(row._id).pipe(Effect.orDie);
  });

type PreparedPassage = {
  readonly origin: RetrievalOriginReference;
  readonly passageKey: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly title: string;
  readonly headingPath: string | null;
  readonly text: string;
  readonly contentHash: string;
  readonly locator?: string | undefined;
  readonly sourceModifiedAt?: number | undefined;
  readonly observedAt: number;
};

const commitPreparedPublication = (input: {
  readonly organizationKey: string;
  readonly workspaceId: GenericId<"workspaces">;
  readonly brainKey: string;
  readonly corpusKey: string;
  readonly kind: "slack" | "transcript" | "document" | "projection";
  readonly originTable: string;
  readonly sourceKey: string;
  readonly sourceRevisionKey: string;
  readonly connectionKey?: string | undefined;
  readonly connectionGeneration?: number | undefined;
  readonly connectorScopeKey?: string | undefined;
  readonly authority: "authoritative" | "derived" | "advisory";
  readonly authorityPolicyKey: string;
  readonly policyGeneration: number;
  readonly lifecycleGeneration: number;
  readonly routeGeneration: number;
  readonly revoked: boolean;
  readonly passages: readonly PreparedPassage[];
  readonly now: number;
}) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const currentSets = yield* reader
      .table("retrievalPublicationSets")
      .index("by_workspace_brain_source_state_generation", (query) =>
        query
          .eq("workspaceId", input.workspaceId)
          .eq("brainKey", input.brainKey)
          .eq("originTable", input.originTable)
          .eq("sourceKey", input.sourceKey)
          .eq("state", "current"),
      )
      .take(MAX_PRIOR_PUBLICATION_SETS + 1)
      .pipe(Effect.orDie);
    if (currentSets.length > MAX_PRIOR_PUBLICATION_SETS)
      return yield* new RetrievalPublicationConflict({
        publicationSetKey: currentSets[0]?.publicationSetKey ?? "unknown",
      });
    const current = [...currentSets].sort(
      (left, right) => right.publicationGeneration - left.publicationGeneration,
    )[0];
    const currentTokens = yield* loadCurrentPublicationTokens({
      workspaceId: input.workspaceId,
      brainKey: input.brainKey,
      publicationSetKeys: currentSets.map(
        ({ publicationSetKey }) => publicationSetKey,
      ),
    });
    if (currentTokens.length > MAX_ACTIVE_PUBLICATION_ROWS)
      return yield* new RetrievalPublicationCapacityExceeded({
        entryCount: 0,
        tokenCount: currentTokens.length,
      });
    if (input.revoked) {
      yield* removePublicationTokens(currentTokens);
      for (const prior of currentSets)
        yield* writer
          .table("retrievalPublicationSets")
          .patch(prior._id, { state: "retired", retiredAt: input.now })
          .pipe(Effect.orDie);
      return {
        outcome: "revoked" as const,
        entryCount: 0,
        tokenCount: 0,
      };
    }
    if (
      current?.sourceRevisionKey === input.sourceRevisionKey &&
      current.policyGeneration === input.policyGeneration &&
      current.routeGeneration === input.routeGeneration &&
      current.lifecycleGeneration === input.lifecycleGeneration
    )
      return {
        outcome: "duplicate" as const,
        publicationSetKey: current.publicationSetKey,
        publicationGeneration: current.publicationGeneration,
        entryCount: current.expectedEntryCount,
        tokenCount: current.expectedTokenCount,
      };
    const firstPassage = input.passages[0];
    if (firstPassage === undefined)
      return yield* new RetrievalOriginUnavailable({
        sourceKey: input.sourceKey,
        revisionKey: input.sourceRevisionKey,
      });
    const publicationGeneration =
      Math.max(
        0,
        ...currentSets.map(
          ({ publicationGeneration }) => publicationGeneration,
        ),
      ) + 1;
    const keyOrigin: RetrievalOrigin = {
      organizationKey: input.organizationKey,
      workspaceId: String(input.workspaceId),
      brainKey: input.brainKey,
      corpusKey: input.corpusKey,
      originTable: input.originTable,
      kind: input.kind,
      origin: firstPassage.origin,
      ...(input.connectionKey === undefined
        ? {}
        : { connectionKey: input.connectionKey }),
      ...(input.connectionGeneration === undefined
        ? {}
        : { connectionGeneration: input.connectionGeneration }),
      ...(input.connectorScopeKey === undefined
        ? {}
        : { connectorScopeKey: input.connectorScopeKey }),
      sourceKey: input.sourceKey,
      sourceRevisionKey: input.sourceRevisionKey,
      title: firstPassage.title,
      ...(firstPassage.locator === undefined
        ? {}
        : { locator: firstPassage.locator }),
      ...(firstPassage.sourceModifiedAt === undefined
        ? {}
        : { sourceModifiedAt: firstPassage.sourceModifiedAt }),
      observedAt: firstPassage.observedAt,
      indexedAt: input.now,
      authority: input.authority,
      authorityPolicyKey: input.authorityPolicyKey,
      policyGeneration: input.policyGeneration,
      lifecycleGeneration: input.lifecycleGeneration,
      routeGeneration: input.routeGeneration,
    };
    const publicationSetKey = retrievalPublicationSetKey(
      keyOrigin,
      publicationGeneration,
    );
    const entries = input.passages.map((passage) => {
      const entryOrigin: RetrievalOrigin = {
        ...keyOrigin,
        origin: passage.origin,
      };
      return {
        schemaVersion: 1 as const,
        organizationKey: input.organizationKey,
        workspaceId: input.workspaceId,
        brainKey: input.brainKey,
        entryKey: retrievalEntryKey(entryOrigin, {
          passageKey: passage.passageKey,
          ordinal: 0,
          headingPath: passage.headingPath,
          text: passage.text,
          startOffset: passage.startOffset,
          endOffset: passage.endOffset,
          contentHash: passage.contentHash,
        }),
        publicationSetKey,
        publicationGeneration,
        kind: input.kind,
        corpusKey: input.corpusKey,
        origin: passage.origin,
        originTable: input.originTable,
        ...(input.connectionKey === undefined
          ? {}
          : { connectionKey: input.connectionKey }),
        ...(input.connectionGeneration === undefined
          ? {}
          : { connectionGeneration: input.connectionGeneration }),
        ...(input.connectorScopeKey === undefined
          ? {}
          : { connectorScopeKey: input.connectorScopeKey }),
        sourceKey: input.sourceKey,
        sourceRevisionKey: input.sourceRevisionKey,
        passageKey: passage.passageKey,
        startOffset: passage.startOffset,
        endOffset: passage.endOffset,
        title: passage.title,
        headingPath: passage.headingPath,
        text: passage.text,
        ...(passage.locator === undefined ? {} : { locator: passage.locator }),
        contentHash: passage.contentHash,
        ...(passage.sourceModifiedAt === undefined
          ? {}
          : { sourceModifiedAt: passage.sourceModifiedAt }),
        observedAt: passage.observedAt,
        indexedAt: input.now,
        authority: input.authority,
        authorityPolicyKey: input.authorityPolicyKey,
        policyGeneration: input.policyGeneration,
        lifecycleGeneration: input.lifecycleGeneration,
        routeGeneration: input.routeGeneration,
        state: "published" as const,
      };
    });
    const tokens = entries.flatMap((entry) =>
      buildRetrievalTokenRows({
        organizationKey: entry.organizationKey,
        workspaceId: String(entry.workspaceId),
        brainKey: entry.brainKey,
        entryKey: entry.entryKey,
        title: entry.title,
        headingPath: entry.headingPath,
        text: entry.text,
        authority: entry.authority,
      }).map((token) => ({
        ...token,
        schemaVersion: 1 as const,
        workspaceId: input.workspaceId,
        publicationSetKey,
        publicationState: "current" as const,
      })),
    );
    if (
      entries.length > MAX_ENTRIES_PER_PUBLICATION_SET ||
      entries.length + tokens.length > MAX_ACTIVE_PUBLICATION_ROWS ||
      entries.length + tokens.length + currentTokens.length + 4 >
        MAX_PUBLICATION_WRITES
    )
      return yield* new RetrievalPublicationCapacityExceeded({
        entryCount: entries.length,
        tokenCount: tokens.length,
      });
    yield* writer
      .table("retrievalPublicationSets")
      .insert({
        schemaVersion: 1,
        organizationKey: input.organizationKey,
        workspaceId: input.workspaceId,
        brainKey: input.brainKey,
        corpusKey: input.corpusKey,
        publicationSetKey,
        publicationGeneration,
        originKind: input.kind,
        originTable: input.originTable,
        sourceKey: input.sourceKey,
        sourceRevisionKey: input.sourceRevisionKey,
        routeGeneration: input.routeGeneration,
        lifecycleGeneration: input.lifecycleGeneration,
        policyGeneration: input.policyGeneration,
        expectedEntryCount: entries.length,
        expectedTokenCount: tokens.length,
        manifestHash: manifestHash({
          entryKeys: entries.map(({ entryKey }) => entryKey),
          tokens,
        }),
        state: "building",
        createdAt: input.now,
      })
      .pipe(Effect.orDie);
    for (const entry of entries)
      yield* writer.table("retrievalEntries").insert(entry).pipe(Effect.orDie);
    for (const token of tokens)
      yield* writer.table("retrievalTokens").insert(token).pipe(Effect.orDie);
    const insertedSet = yield* reader
      .table("retrievalPublicationSets")
      .index("by_workspace_publication_set", (query) =>
        query
          .eq("workspaceId", input.workspaceId)
          .eq("publicationSetKey", publicationSetKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    if (insertedSet === null)
      return yield* new RetrievalPublicationConflict({ publicationSetKey });
    yield* removePublicationTokens(currentTokens);
    for (const prior of currentSets)
      yield* writer
        .table("retrievalPublicationSets")
        .patch(prior._id, { state: "retired", retiredAt: input.now })
        .pipe(Effect.orDie);
    yield* writer
      .table("retrievalPublicationSets")
      .patch(insertedSet._id, { state: "current", activatedAt: input.now })
      .pipe(Effect.orDie);
    const health = yield* reader
      .table("brainCorpusHealth")
      .index("by_workspace_brain_corpus_scope", (query) =>
        query
          .eq("workspaceId", input.workspaceId)
          .eq("brainKey", input.brainKey)
          .eq("corpusKey", input.corpusKey)
          .eq("connectorScopeKey", input.connectorScopeKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    const healthRow = {
      schemaVersion: 1 as const,
      organizationKey: input.organizationKey,
      workspaceId: input.workspaceId,
      brainKey: input.brainKey,
      corpusKey: input.corpusKey,
      ...(input.connectorScopeKey === undefined
        ? {}
        : { connectorScopeKey: input.connectorScopeKey }),
      ...(input.connectionGeneration === undefined
        ? {}
        : { connectionGeneration: input.connectionGeneration }),
      policyGeneration: input.policyGeneration,
      coverageStatus: "partial" as const,
      lastObservedAt: Math.max(
        ...input.passages.map(({ observedAt }) => observedAt),
      ),
      lastPublishedAt: input.now,
      freshnessThresholdMs: 24 * 60 * 60 * 1_000,
      discoveredCount: Math.max(1, health?.discoveredCount ?? 0),
      publishedCount: Math.max(1, health?.publishedCount ?? 0),
      failedCount: health?.failedCount ?? 0,
      degradedReason:
        "Corpus rebuild or reconciliation has not recorded complete coverage.",
      updatedAt: input.now,
    };
    if (health === null)
      yield* writer
        .table("brainCorpusHealth")
        .insert(healthRow)
        .pipe(Effect.orDie);
    else
      yield* writer
        .table("brainCorpusHealth")
        .patch(health._id, healthRow)
        .pipe(Effect.orDie);
    return {
      outcome: "published" as const,
      publicationSetKey,
      publicationGeneration,
      entryCount: entries.length,
      tokenCount: tokens.length,
    };
  });

export const publishPageRevisionEffect = (
  args: Schema.Schema.Type<typeof PublishPageRevisionArgs>,
) =>
  Effect.gen(function* () {
    if (args.caller.kind !== "system") return yield* new Unauthorized();
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const [workspace, organization, page, revision] = yield* Effect.all([
      reader.table("workspaces").get(args.workspaceId).pipe(Effect.orDie),
      reader
        .table("organizations")
        .index("by_agency_key", (query) =>
          query.eq("agencyKey", args.organizationKey),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie),
      reader
        .table("brainPages")
        .index("by_workspace_page_key", (query) =>
          query.eq("workspaceId", args.workspaceId).eq("pageKey", args.pageKey),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie),
      reader
        .table("pageRevisions")
        .index("by_workspace_revision_key", (query) =>
          query
            .eq("workspaceId", args.workspaceId)
            .eq("revisionKey", args.revisionKey),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie),
    ]);

    if (
      workspace === null ||
      organization === null ||
      String(organization._id) !== workspace.organizationId ||
      workspace.brainKey !== args.brainKey
    )
      return yield* new ValidationFailed({
        field: "brainKey",
        message: "Organization, workspace, and Brain must identify one Brain.",
      });
    if (page === null)
      return yield* new RetrievalOriginUnavailable({
        sourceKey: args.pageKey,
        revisionKey: args.revisionKey,
      });
    if (page.currentRevisionKey !== args.revisionKey)
      return {
        outcome: "stale" as const,
        entryCount: 0,
        tokenCount: 0,
      };
    if (revision === null || revision.pageKey !== args.pageKey)
      return yield* new RetrievalOriginUnavailable({
        sourceKey: args.pageKey,
        revisionKey: args.revisionKey,
      });

    const currentSets = yield* reader
      .table("retrievalPublicationSets")
      .index("by_workspace_brain_source_state_generation", (query) =>
        query
          .eq("workspaceId", args.workspaceId)
          .eq("brainKey", args.brainKey)
          .eq("originTable", "pageRevisions")
          .eq("sourceKey", args.pageKey)
          .eq("state", "current"),
      )
      .take(MAX_PRIOR_PUBLICATION_SETS + 1)
      .pipe(Effect.orDie);
    if (currentSets.length > MAX_PRIOR_PUBLICATION_SETS)
      return yield* new RetrievalPublicationConflict({
        publicationSetKey: currentSets[0]?.publicationSetKey ?? "unknown",
      });
    const current = [...currentSets].sort(
      (left, right) => right.publicationGeneration - left.publicationGeneration,
    )[0];
    const currentTokens = yield* loadCurrentPublicationTokens({
      workspaceId: args.workspaceId,
      brainKey: args.brainKey,
      publicationSetKeys: currentSets.map(
        ({ publicationSetKey }) => publicationSetKey,
      ),
    });
    if (currentTokens.length > MAX_ACTIVE_PUBLICATION_ROWS)
      return yield* new RetrievalPublicationCapacityExceeded({
        entryCount: 0,
        tokenCount: currentTokens.length,
      });
    if (
      page.status !== "active" ||
      revision.state !== "published" ||
      !activeLifecycle(page.lifecycle) ||
      !activeLifecycle(revision.lifecycle)
    ) {
      yield* removePublicationTokens(currentTokens);
      for (const prior of currentSets)
        yield* writer
          .table("retrievalPublicationSets")
          .patch(prior._id, { state: "retired", retiredAt: args.now })
          .pipe(Effect.orDie);
      return {
        outcome: "revoked" as const,
        entryCount: 0,
        tokenCount: 0,
      };
    }
    if (
      current?.sourceRevisionKey === args.revisionKey &&
      current.policyGeneration === args.policyGeneration &&
      current.lifecycleGeneration === (page.lifecycle?.generation ?? 1)
    )
      return {
        outcome: "duplicate" as const,
        publicationSetKey: current.publicationSetKey,
        publicationGeneration: current.publicationGeneration,
        entryCount: current.expectedEntryCount,
        tokenCount: current.expectedTokenCount,
      };

    const publicationGeneration =
      Math.max(
        0,
        ...currentSets.map(
          ({ publicationGeneration }) => publicationGeneration,
        ),
      ) + 1;
    const origin: RetrievalOrigin = {
      organizationKey: args.organizationKey,
      workspaceId: String(args.workspaceId),
      brainKey: args.brainKey,
      corpusKey: "brain-pages",
      originTable: "pageRevisions",
      kind: "page",
      origin: {
        kind: "page",
        pageKey: args.pageKey,
        revisionKey: args.revisionKey,
      },
      sourceKey: args.pageKey,
      sourceRevisionKey: args.revisionKey,
      title: page.title,
      observedAt: revision.createdAt,
      indexedAt: args.now,
      authority: args.authority,
      authorityPolicyKey: args.authorityPolicyKey,
      policyGeneration: args.policyGeneration,
      lifecycleGeneration: page.lifecycle?.generation ?? 1,
      routeGeneration: 1,
    };
    const publicationSetKey = retrievalPublicationSetKey(
      origin,
      publicationGeneration,
    );
    const passages = buildRetrievalPassages(
      revision.markdown,
      args.revisionKey,
    );
    const entries = passages.map((passage) => ({
      schemaVersion: 1 as const,
      organizationKey: origin.organizationKey,
      workspaceId: args.workspaceId,
      brainKey: origin.brainKey,
      entryKey: retrievalEntryKey(origin, passage),
      publicationSetKey,
      publicationGeneration,
      kind: origin.kind,
      corpusKey: origin.corpusKey,
      origin: origin.origin,
      originTable: origin.originTable,
      sourceKey: origin.sourceKey,
      sourceRevisionKey: origin.sourceRevisionKey,
      passageKey: passage.passageKey,
      startOffset: passage.startOffset,
      endOffset: passage.endOffset,
      title: origin.title,
      headingPath: passage.headingPath,
      text: passage.text,
      contentHash: passage.contentHash,
      observedAt: origin.observedAt,
      indexedAt: origin.indexedAt,
      authority: origin.authority,
      authorityPolicyKey: origin.authorityPolicyKey,
      policyGeneration: origin.policyGeneration,
      lifecycleGeneration: origin.lifecycleGeneration,
      routeGeneration: origin.routeGeneration,
      state: "published" as const,
    }));
    const tokens = entries.flatMap((entry) =>
      buildRetrievalTokenRows({
        organizationKey: entry.organizationKey,
        workspaceId: String(entry.workspaceId),
        brainKey: entry.brainKey,
        entryKey: entry.entryKey,
        title: entry.title,
        headingPath: entry.headingPath,
        text: entry.text,
        authority: entry.authority,
      }).map((token) => ({
        ...token,
        schemaVersion: 1 as const,
        workspaceId: args.workspaceId,
        publicationSetKey,
        publicationState: "current" as const,
      })),
    );
    if (
      entries.length > MAX_ENTRIES_PER_PUBLICATION_SET ||
      entries.length + tokens.length > MAX_ACTIVE_PUBLICATION_ROWS ||
      entries.length + tokens.length + currentTokens.length + 4 >
        MAX_PUBLICATION_WRITES
    )
      return yield* new RetrievalPublicationCapacityExceeded({
        entryCount: entries.length,
        tokenCount: tokens.length,
      });

    const expectedHash = manifestHash({
      entryKeys: entries.map(({ entryKey }) => entryKey),
      tokens,
    });
    yield* writer
      .table("retrievalPublicationSets")
      .insert({
        schemaVersion: 1,
        organizationKey: origin.organizationKey,
        workspaceId: args.workspaceId,
        brainKey: origin.brainKey,
        corpusKey: origin.corpusKey,
        publicationSetKey,
        publicationGeneration,
        originKind: origin.kind,
        originTable: origin.originTable,
        sourceKey: origin.sourceKey,
        sourceRevisionKey: origin.sourceRevisionKey,
        routeGeneration: origin.routeGeneration,
        lifecycleGeneration: origin.lifecycleGeneration,
        policyGeneration: origin.policyGeneration,
        expectedEntryCount: entries.length,
        expectedTokenCount: tokens.length,
        manifestHash: expectedHash,
        state: "building",
        createdAt: args.now,
      })
      .pipe(Effect.orDie);
    for (const entry of entries)
      yield* writer.table("retrievalEntries").insert(entry).pipe(Effect.orDie);
    for (const token of tokens)
      yield* writer.table("retrievalTokens").insert(token).pipe(Effect.orDie);
    const insertedSet = yield* reader
      .table("retrievalPublicationSets")
      .index("by_workspace_publication_set", (query) =>
        query
          .eq("workspaceId", args.workspaceId)
          .eq("publicationSetKey", publicationSetKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    if (insertedSet === null)
      return yield* new RetrievalPublicationConflict({ publicationSetKey });
    yield* removePublicationTokens(currentTokens);
    for (const prior of currentSets)
      yield* writer
        .table("retrievalPublicationSets")
        .patch(prior._id, { state: "retired", retiredAt: args.now })
        .pipe(Effect.orDie);
    yield* writer
      .table("retrievalPublicationSets")
      .patch(insertedSet._id, { state: "current", activatedAt: args.now })
      .pipe(Effect.orDie);
    const health = yield* reader
      .table("brainCorpusHealth")
      .index("by_workspace_brain_corpus_scope", (query) =>
        query
          .eq("workspaceId", args.workspaceId)
          .eq("brainKey", args.brainKey)
          .eq("corpusKey", origin.corpusKey)
          .eq("connectorScopeKey", undefined),
      )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    const healthRow = {
      schemaVersion: 1 as const,
      organizationKey: origin.organizationKey,
      workspaceId: args.workspaceId,
      brainKey: args.brainKey,
      corpusKey: origin.corpusKey,
      policyGeneration: origin.policyGeneration,
      coverageStatus: "partial" as const,
      lastObservedAt: origin.observedAt,
      lastPublishedAt: args.now,
      freshnessThresholdMs: 7 * 24 * 60 * 60 * 1_000,
      discoveredCount: Math.max(1, health?.discoveredCount ?? 0),
      publishedCount: Math.max(1, health?.publishedCount ?? 0),
      failedCount: health?.failedCount ?? 0,
      degradedReason:
        "Brain-page rebuild has not yet recorded complete coverage.",
      updatedAt: args.now,
    };
    if (health === null)
      yield* writer
        .table("brainCorpusHealth")
        .insert(healthRow)
        .pipe(Effect.orDie);
    else
      yield* writer
        .table("brainCorpusHealth")
        .patch(health._id, healthRow)
        .pipe(Effect.orDie);
    return {
      outcome: "published" as const,
      publicationSetKey,
      publicationGeneration,
      entryCount: entries.length,
      tokenCount: tokens.length,
    };
  });

const publishPageRevision = FunctionImpl.make(
  databaseSchema,
  retrievalPublicationGroup,
  "publishPageRevision",
  publishPageRevisionEffect,
);

const validatePublicationTarget = (input: {
  readonly organizationKey: string;
  readonly workspaceId: GenericId<"workspaces">;
  readonly brainKey: string;
}) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const [workspace, organization] = yield* Effect.all([
      reader.table("workspaces").get(input.workspaceId).pipe(Effect.orDie),
      reader
        .table("organizations")
        .index("by_agency_key", (query) =>
          query.eq("agencyKey", input.organizationKey),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie),
    ]);
    if (
      workspace === null ||
      organization === null ||
      String(organization._id) !== workspace.organizationId ||
      workspace.brainKey !== input.brainKey ||
      workspace.status !== "active"
    )
      return yield* new ValidationFailed({
        field: "brainKey",
        message:
          "Publication target is not an active Brain in the organization.",
      });
    return workspace;
  });

const connectionIsCurrent = (input: {
  readonly organizationKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
}) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const connection = yield* reader
      .table("providerConnections")
      .index("by_connection_key", (query) =>
        query.eq("connectionKey", input.connectionKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    return (
      connection !== null &&
      connection.organizationKey === input.organizationKey &&
      connection.status === "active" &&
      connection.connectionGeneration === input.connectionGeneration
    );
  });

export const publishSlackRevisionEffect = (
  args: Schema.Schema.Type<typeof PublishSlackRevisionArgs>,
) =>
  Effect.gen(function* () {
    if (args.caller.kind !== "system") return yield* new Unauthorized();
    yield* validatePublicationTarget(args);
    const reader = yield* DatabaseReader;
    const revision = yield* reader
      .table("sourceRevisions")
      .index("by_source_revision_key", (query) =>
        query
          .eq("organizationKey", args.organizationKey)
          .eq("sourceRevisionKey", args.sourceRevisionKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    if (revision === null)
      return yield* new RetrievalOriginUnavailable({
        sourceKey: "unknown",
        revisionKey: args.sourceRevisionKey,
      });
    const artifact = yield* reader
      .table("sourceArtifacts")
      .index("by_source_key", (query) =>
        query.eq("sourceKey", revision.sourceKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    if (
      artifact === null ||
      artifact.organizationKey !== args.organizationKey ||
      artifact.latestSourceRevisionKey !== args.sourceRevisionKey
    )
      return {
        outcome: "stale" as const,
        entryCount: 0,
        tokenCount: 0,
      };
    const currentConnection = yield* connectionIsCurrent({
      organizationKey: args.organizationKey,
      connectionKey: revision.connectionKey,
      connectionGeneration: revision.connectionGeneration,
    });
    const policies = yield* reader
      .table("channelRoutingPolicies")
      .index("by_channel_active", (query) =>
        query.eq("channelKey", revision.channelKey).eq("active", true),
      )
      .take(10)
      .pipe(Effect.orDie);
    const policy = policies
      .filter(
        (candidate) =>
          candidate.mode !== "capture_only" &&
          candidate.targetBrainKeys.includes(args.brainKey),
      )
      .sort((left, right) => right.policyEpoch - left.policyEpoch)[0];
    const revoked =
      revision.tombstone ||
      revision.lifecycle.state !== "active" ||
      artifact.lifecycle.state !== "active" ||
      !currentConnection ||
      policy === undefined;
    const passages = buildRetrievalPassages(
      revision.normalizedText,
      revision.sourceRevisionKey,
    ).map((passage) => ({
      origin: {
        kind: "slack" as const,
        sourceKey: revision.sourceKey,
        sourceRevisionKey: revision.sourceRevisionKey,
      },
      passageKey: passage.passageKey,
      startOffset: passage.startOffset,
      endOffset: passage.endOffset,
      title: `Slack · ${revision.authorSnapshot.displayName}`,
      headingPath: passage.headingPath,
      text: passage.text,
      contentHash: passage.contentHash,
      locator: revision.permalink,
      sourceModifiedAt: revision.sourceCreatedAt,
      observedAt: revision.createdAt,
    }));
    return yield* commitPreparedPublication({
      organizationKey: args.organizationKey,
      workspaceId: args.workspaceId,
      brainKey: args.brainKey,
      corpusKey: "slack",
      kind: "slack",
      originTable: "sourceRevisions",
      sourceKey: revision.sourceKey,
      sourceRevisionKey: revision.sourceRevisionKey,
      connectionKey: revision.connectionKey,
      connectionGeneration: revision.connectionGeneration,
      connectorScopeKey: revision.channelKey,
      authority: "advisory",
      authorityPolicyKey: "slack-evidence",
      policyGeneration: policy?.policyEpoch ?? 1,
      lifecycleGeneration: artifact.lifecycle.generation,
      routeGeneration: policy?.policyEpoch ?? 1,
      revoked,
      passages,
      now: args.now,
    });
  });

export const publishTranscriptRevisionEffect = (
  args: Schema.Schema.Type<typeof PublishTranscriptRevisionArgs>,
) =>
  Effect.gen(function* () {
    if (args.caller.kind !== "system") return yield* new Unauthorized();
    yield* validatePublicationTarget(args);
    const reader = yield* DatabaseReader;
    const revision = yield* reader
      .table("sourceUnitRevisions")
      .index("by_unit_revision_key", (query) =>
        query
          .eq("organizationKey", args.organizationKey)
          .eq("unitRevisionKey", args.sourceRevisionKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    if (revision === null)
      return yield* new RetrievalOriginUnavailable({
        sourceKey: "unknown",
        revisionKey: args.sourceRevisionKey,
      });
    const unit = yield* reader
      .table("sourceUnits")
      .index("by_unit_key", (query) =>
        query
          .eq("organizationKey", args.organizationKey)
          .eq("unitKey", revision.unitKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    if (unit === null || unit.currentUnitRevisionKey !== args.sourceRevisionKey)
      return {
        outcome: "stale" as const,
        entryCount: 0,
        tokenCount: 0,
      };
    const currentConnection = yield* connectionIsCurrent({
      organizationKey: args.organizationKey,
      connectionKey: unit.connectionKey,
      connectionGeneration: unit.connectionGeneration,
    });
    const routes = yield* reader
      .table("callRoutingProposals")
      .index("by_org_revision", (query) =>
        query
          .eq("organizationKey", args.organizationKey)
          .eq("unitRevisionKey", args.sourceRevisionKey),
      )
      .take(100)
      .pipe(Effect.orDie);
    const route = routes
      .filter(
        (candidate) =>
          (candidate.status === "current" || candidate.status === "accepted") &&
          candidate.outcome === "routed" &&
          candidate.brainKey === args.brainKey,
      )
      .sort((left, right) => right.routeGeneration - left.routeGeneration)[0];
    const segments = yield* reader
      .table("sourceSegments")
      .index("by_unit_revision_ordinal", (query) =>
        query
          .eq("organizationKey", args.organizationKey)
          .eq("unitRevisionKey", args.sourceRevisionKey),
      )
      .take(MAX_ENTRIES_PER_PUBLICATION_SET + 1)
      .pipe(Effect.orDie);
    if (segments.length > MAX_ENTRIES_PER_PUBLICATION_SET)
      return yield* new RetrievalPublicationCapacityExceeded({
        entryCount: segments.length,
        tokenCount: 0,
      });
    const passages = segments.flatMap((segment) =>
      buildRetrievalPassages(
        segment.text,
        `${revision.unitRevisionKey}:${segment.segmentKey}`,
      ).map((passage) => ({
        origin: {
          kind: "transcript" as const,
          unitKey: revision.unitKey,
          unitRevisionKey: revision.unitRevisionKey,
          segmentKey: segment.segmentKey,
        },
        passageKey: passage.passageKey,
        startOffset: passage.startOffset,
        endOffset: passage.endOffset,
        title: revision.title,
        headingPath: passage.headingPath,
        text: passage.text,
        contentHash: passage.contentHash,
        locator: `${revision.sourceUrl}#segment=${segment.segmentKey}`,
        observedAt: revision.createdAt,
      })),
    );
    return yield* commitPreparedPublication({
      organizationKey: args.organizationKey,
      workspaceId: args.workspaceId,
      brainKey: args.brainKey,
      corpusKey: "transcripts",
      kind: "transcript",
      originTable: "sourceUnitRevisions",
      sourceKey: revision.unitKey,
      sourceRevisionKey: revision.unitRevisionKey,
      connectionKey: unit.connectionKey,
      connectionGeneration: unit.connectionGeneration,
      authority: "advisory",
      authorityPolicyKey: "transcript-evidence",
      policyGeneration: 1,
      lifecycleGeneration: unit.lifecycle.generation,
      routeGeneration: route?.routeGeneration ?? 1,
      revoked:
        revision.tombstone ||
        unit.lifecycle.state !== "active" ||
        !currentConnection ||
        route === undefined,
      passages,
      now: args.now,
    });
  });

const terminalPublicationJobStatuses = new Set([
  "succeeded",
  "superseded",
  "revoked",
  "dead_letter",
]);

const publicationJobResult = (row: {
  readonly jobKey: string;
  readonly status:
    | "pending"
    | "retry_wait"
    | "succeeded"
    | "superseded"
    | "revoked"
    | "dead_letter";
  readonly attemptCount: number;
  readonly nextAttemptAt: number;
  readonly lastErrorTag?: string | undefined;
}): RunPublicationJobOutput => ({
  jobKey: row.jobKey,
  status: row.status,
  attemptCount: row.attemptCount,
  nextAttemptAt: row.nextAttemptAt,
  ...(row.lastErrorTag === undefined ? {} : { lastErrorTag: row.lastErrorTag }),
});

export const enqueueRetrievalPublicationJobEffect = (
  input: Omit<RetrievalPublicationJobInput, "workspaceId"> & {
    readonly workspaceId: GenericId<"workspaces">;
  },
  now: number,
) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const scheduler = yield* Scheduler;
    const jobKey = retrievalPublicationJobKey({
      ...input,
      workspaceId: String(input.workspaceId),
    });
    const existing = yield* reader
      .table("retrievalPublicationJobs")
      .index("by_job_key", (query) => query.eq("jobKey", jobKey))
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    if (existing === null)
      yield* writer
        .table("retrievalPublicationJobs")
        .insert({
          ...retrievalPublicationJobRow(
            { ...input, workspaceId: String(input.workspaceId) },
            now,
          ),
          workspaceId: input.workspaceId,
        })
        .pipe(Effect.orDie);
    if (
      existing === null ||
      existing.status === "pending" ||
      existing.status === "retry_wait"
    )
      yield* scheduler.runAfter(
        Duration.zero,
        refs.internal.brain.retrievalPublication.runPublicationJob,
        {
          jobKey,
          caller: {
            kind: "system",
            name: "retrieval-publication-job",
            surface: "internal",
          },
          now,
        },
      );
    return jobKey;
  });

export const enqueueOrganizationCorpusRebuildsEffect = (input: {
  readonly organizationKey: string;
  readonly originKind: "page_rebuild" | "slack_rebuild" | "transcript_rebuild";
  readonly sourceKey: string;
  readonly sourceRevisionKey: string;
  readonly requestGeneration: number;
  readonly now: number;
}) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const organization = yield* reader
      .table("organizations")
      .index("by_agency_key", (query) =>
        query.eq("agencyKey", input.organizationKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    if (organization === null) return [];
    const targets = yield* reader
      .table("workspaces")
      .index("by_organization_status", (query) =>
        query.eq("organizationId", organization._id).eq("status", "active"),
      )
      .take(27)
      .pipe(Effect.orDie);
    if (targets.length > 26)
      return yield* new ValidationFailed({
        field: "organizationKey",
        message: "Active Brain rebuild target capacity exceeded.",
      });
    const jobKeys: string[] = [];
    for (const target of targets) {
      if (target.brainKey === undefined) continue;
      jobKeys.push(
        yield* enqueueRetrievalPublicationJobEffect(
          {
            organizationKey: input.organizationKey,
            workspaceId: target._id,
            brainKey: target.brainKey,
            originKind: input.originKind,
            sourceKey: input.sourceKey,
            sourceRevisionKey: input.sourceRevisionKey,
            requestGeneration: input.requestGeneration,
            rebuild: { limit: 5 },
          },
          input.now,
        ),
      );
    }
    return jobKeys;
  });

const corpusKeyForJob = (
  originKind: RetrievalPublicationJobsDoc["originKind"],
) =>
  originKind === "page" || originKind === "page_rebuild"
    ? "brain-pages"
    : originKind === "slack" || originKind === "slack_rebuild"
      ? "slack"
      : "transcripts";

const healthRowsForJob = (job: RetrievalPublicationJobsDoc) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const corpusKey = corpusKeyForJob(job.originKind);
    const rows = yield* reader
      .table("brainCorpusHealth")
      .index("by_workspace_brain", (index) =>
        index.eq("workspaceId", job.workspaceId).eq("brainKey", job.brainKey),
      )
      .take(100)
      .pipe(Effect.orDie);
    return {
      corpusKey,
      rows: rows.filter((row) => row.corpusKey === corpusKey),
    };
  });

const markRebuildHealthComplete = (
  job: RetrievalPublicationJobsDoc,
  counts: { readonly discovered: number; readonly published: number },
  at: number,
) =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
    const { corpusKey, rows } = yield* healthRowsForJob(job);
    if (rows.length === 0) {
      yield* writer
        .table("brainCorpusHealth")
        .insert({
          schemaVersion: 1,
          organizationKey: job.organizationKey,
          workspaceId: job.workspaceId,
          brainKey: job.brainKey,
          corpusKey,
          policyGeneration: Math.max(1, job.requestGeneration),
          reconciliationGeneration: Math.max(1, job.requestGeneration),
          coverageStatus: "complete",
          lastReconciledAt: at,
          freshnessThresholdMs:
            corpusKey === "brain-pages"
              ? 7 * 24 * 60 * 60 * 1_000
              : 24 * 60 * 60 * 1_000,
          discoveredCount: counts.discovered,
          publishedCount: counts.published,
          failedCount: 0,
          updatedAt: at,
        })
        .pipe(Effect.orDie);
      return;
    }
    for (const row of rows)
      yield* writer
        .table("brainCorpusHealth")
        .patch(row._id, {
          reconciliationGeneration: Math.max(1, job.requestGeneration),
          coverageStatus: "complete",
          lastReconciledAt: at,
          ...(corpusKey === "brain-pages"
            ? {
                discoveredCount: counts.discovered,
                publishedCount: counts.published,
              }
            : {}),
          failedCount: 0,
          degradedReason: undefined,
          updatedAt: at,
        })
        .pipe(Effect.orDie);
  });

const markPublicationDeadLetter = (
  job: RetrievalPublicationJobsDoc,
  lastErrorTag: string,
  at: number,
) =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
    const { corpusKey, rows } = yield* healthRowsForJob(job);
    const degradedReason = `Publication dead letter: ${lastErrorTag}.`;
    if (rows.length === 0) {
      yield* writer
        .table("brainCorpusHealth")
        .insert({
          schemaVersion: 1,
          organizationKey: job.organizationKey,
          workspaceId: job.workspaceId,
          brainKey: job.brainKey,
          corpusKey,
          policyGeneration: Math.max(1, job.requestGeneration),
          coverageStatus: "partial",
          freshnessThresholdMs:
            corpusKey === "brain-pages"
              ? 7 * 24 * 60 * 60 * 1_000
              : 24 * 60 * 60 * 1_000,
          discoveredCount: 0,
          publishedCount: 0,
          failedCount: 1,
          degradedReason,
          updatedAt: at,
        })
        .pipe(Effect.orDie);
      return;
    }
    for (const row of rows)
      yield* writer
        .table("brainCorpusHealth")
        .patch(row._id, {
          coverageStatus: "partial",
          failedCount: row.failedCount + 1,
          degradedReason,
          updatedAt: at,
        })
        .pipe(Effect.orDie);
  });

export const runPublicationJobEffect = (args: RunPublicationJobInput) =>
  Effect.gen(function* () {
    if (args.caller.kind !== "system") return yield* new Unauthorized();
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const job = yield* reader
      .table("retrievalPublicationJobs")
      .index("by_job_key", (query) => query.eq("jobKey", args.jobKey))
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    if (job === null)
      return yield* new ValidationFailed({
        field: "jobKey",
        message: "Publication job does not exist.",
      });
    if (
      terminalPublicationJobStatuses.has(job.status) ||
      job.nextAttemptAt > args.now
    )
      return publicationJobResult(job);

    const caller = {
      kind: "system" as const,
      name: "retrieval-publication-job",
      surface: "internal" as const,
    };
    const execution = Effect.gen(function* () {
      if (job.originKind === "page") {
        if (job.page === undefined)
          return yield* new ValidationFailed({
            field: "page",
            message: "Page publication policy is required.",
          });
        const value = yield* publishPageRevisionEffect({
          organizationKey: job.organizationKey,
          workspaceId: job.workspaceId,
          brainKey: job.brainKey,
          pageKey: job.sourceKey,
          revisionKey: job.sourceRevisionKey,
          authority: job.page.authority,
          authorityPolicyKey: job.page.authorityPolicyKey,
          policyGeneration: job.page.policyGeneration,
          caller,
          now: args.now,
        });
        return { kind: "publication" as const, value };
      }
      if (job.originKind === "slack") {
        const value = yield* publishSlackRevisionEffect({
          organizationKey: job.organizationKey,
          workspaceId: job.workspaceId,
          brainKey: job.brainKey,
          sourceRevisionKey: job.sourceRevisionKey,
          caller,
          now: args.now,
        });
        return { kind: "publication" as const, value };
      }
      if (job.originKind === "transcript") {
        const value = yield* publishTranscriptRevisionEffect({
          organizationKey: job.organizationKey,
          workspaceId: job.workspaceId,
          brainKey: job.brainKey,
          sourceRevisionKey: job.sourceRevisionKey,
          caller,
          now: args.now,
        });
        return { kind: "publication" as const, value };
      }
      if (job.rebuild === undefined)
        return yield* new ValidationFailed({
          field: "rebuild",
          message: "Rebuild cursor and limit are required.",
        });
      if (job.originKind === "page_rebuild") {
        const result = yield* rebuildPageBatchEffect({
          organizationKey: job.organizationKey,
          workspaceId: job.workspaceId,
          brainKey: job.brainKey,
          ...(job.rebuild.afterSourceKey === undefined
            ? {}
            : { afterPageKey: job.rebuild.afterSourceKey }),
          limit: job.rebuild.limit,
          caller,
          now: args.now,
        });
        const { nextAfterPageKey, ...value } = result;
        return {
          kind: "rebuild" as const,
          value: {
            ...value,
            ...(nextAfterPageKey === undefined
              ? {}
              : { nextAfterSourceKey: nextAfterPageKey }),
          },
        };
      }
      const rebuild =
        job.originKind === "slack_rebuild"
          ? rebuildSlackBatchEffect
          : rebuildTranscriptBatchEffect;
      const value = yield* rebuild({
        organizationKey: job.organizationKey,
        workspaceId: job.workspaceId,
        brainKey: job.brainKey,
        ...(job.rebuild.afterSourceKey === undefined
          ? {}
          : { afterSourceKey: job.rebuild.afterSourceKey }),
        limit: job.rebuild.limit,
        caller,
        now: args.now,
      });
      return { kind: "rebuild" as const, value };
    });
    const exit = yield* Effect.exit(execution);
    const attemptCount = job.attemptCount + 1;
    if (Exit.isSuccess(exit)) {
      const status =
        exit.value.kind === "publication" &&
        exit.value.value.outcome === "stale"
          ? ("superseded" as const)
          : exit.value.kind === "publication" &&
              exit.value.value.outcome === "revoked"
            ? ("revoked" as const)
            : ("succeeded" as const);
      if (exit.value.kind === "rebuild" && exit.value.value.hasMore) {
        const afterSourceKey = exit.value.value.nextAfterSourceKey;
        if (afterSourceKey === undefined)
          return yield* new ValidationFailed({
            field: "rebuild.afterSourceKey",
            message: "A rebuild with more rows must return its next cursor.",
          });
        yield* enqueueRetrievalPublicationJobEffect(
          {
            organizationKey: job.organizationKey,
            workspaceId: job.workspaceId,
            brainKey: job.brainKey,
            originKind: job.originKind,
            sourceKey: job.sourceKey,
            sourceRevisionKey: job.sourceRevisionKey,
            requestGeneration: job.requestGeneration,
            rebuild: {
              afterSourceKey,
              limit: job.rebuild?.limit ?? 1,
              discoveredCount:
                (job.rebuild?.discoveredCount ?? 0) +
                exit.value.value.processed,
              publishedCount:
                (job.rebuild?.publishedCount ?? 0) + exit.value.value.published,
            },
          },
          args.now,
        );
      }
      if (
        exit.value.kind === "rebuild" &&
        !exit.value.value.hasMore &&
        job.originKind === "page_rebuild"
      )
        yield* markRebuildHealthComplete(
          job,
          {
            discovered:
              (job.rebuild?.discoveredCount ?? 0) + exit.value.value.processed,
            published:
              (job.rebuild?.publishedCount ?? 0) + exit.value.value.published,
          },
          args.now,
        );
      const completed = {
        status,
        attemptCount,
        nextAttemptAt: args.now,
        completedAt: args.now,
        lastErrorTag: undefined,
        updatedAt: args.now,
      };
      yield* writer
        .table("retrievalPublicationJobs")
        .patch(job._id, completed)
        .pipe(Effect.orDie);
      return publicationJobResult({ ...job, ...completed });
    }

    const failure = Cause.failureOption(exit.cause);
    const lastErrorTag =
      failure._tag === "Some" &&
      typeof failure.value === "object" &&
      failure.value !== null &&
      "_tag" in failure.value
        ? String(failure.value._tag)
        : "RetrievalPublicationDefect";
    const retryable =
      lastErrorTag === "RetrievalOriginUnavailable" ||
      lastErrorTag === "RetrievalPublicationConflict" ||
      lastErrorTag === "RetrievalPublicationDefect";
    const deadLetter = !retryable || attemptCount >= job.maxAttempts;
    const failed = {
      status: deadLetter ? ("dead_letter" as const) : ("retry_wait" as const),
      attemptCount,
      nextAttemptAt: deadLetter
        ? args.now
        : args.now +
          PUBLICATION_RETRY_BASE_MS * 2 ** Math.max(0, attemptCount - 1),
      lastErrorTag,
      ...(deadLetter ? { completedAt: args.now } : {}),
      updatedAt: args.now,
    };
    yield* writer
      .table("retrievalPublicationJobs")
      .patch(job._id, failed)
      .pipe(Effect.orDie);
    if (deadLetter)
      yield* markPublicationDeadLetter(job, lastErrorTag, args.now);
    return publicationJobResult({ ...job, ...failed });
  });

export const sweepPublicationJobsEffect = (
  args: Schema.Schema.Type<typeof SweepPublicationJobsArgs>,
) =>
  Effect.gen(function* () {
    if (args.caller.kind !== "system") return yield* new Unauthorized();
    const currentTime = args.now ?? (yield* Clock.currentTimeMillis);
    const reader = yield* DatabaseReader;
    const scheduler = yield* Scheduler;
    const [pending, retryWait] = yield* Effect.all([
      reader
        .table("retrievalPublicationJobs")
        .index("by_status_due_job", (query) =>
          query.eq("status", "pending").lte("nextAttemptAt", currentTime),
        )
        .take(args.limit)
        .pipe(Effect.orDie),
      reader
        .table("retrievalPublicationJobs")
        .index("by_status_due_job", (query) =>
          query.eq("status", "retry_wait").lte("nextAttemptAt", currentTime),
        )
        .take(args.limit)
        .pipe(Effect.orDie),
    ]);
    const jobs = [...pending, ...retryWait]
      .sort(
        (left, right) =>
          left.nextAttemptAt - right.nextAttemptAt ||
          left.jobKey.localeCompare(right.jobKey),
      )
      .slice(0, args.limit);
    for (const job of jobs)
      yield* scheduler.runAfter(
        Duration.zero,
        refs.internal.brain.retrievalPublication.runPublicationJob,
        {
          jobKey: job.jobKey,
          caller: args.caller,
          now: currentTime,
        },
      );
    return {
      scheduled: jobs.length,
      jobKeys: jobs.map(({ jobKey }) => jobKey),
    };
  });

export const rebuildSlackBatchEffect = (
  args: Schema.Schema.Type<typeof RebuildRoutedCorpusBatchArgs>,
) =>
  Effect.gen(function* () {
    if (args.caller.kind !== "system") return yield* new Unauthorized();
    yield* validatePublicationTarget(args);
    const reader = yield* DatabaseReader;
    const artifacts = yield* reader
      .table("sourceArtifacts")
      .index("by_org_source_key", (query) => {
        const scoped = query.eq("organizationKey", args.organizationKey);
        return args.afterSourceKey === undefined
          ? scoped
          : scoped.gt("sourceKey", args.afterSourceKey);
      })
      .take(args.limit + 1)
      .pipe(Effect.orDie);
    const batch = artifacts.slice(0, args.limit);
    let published = 0;
    let revoked = 0;
    for (const artifact of batch) {
      const result = yield* publishSlackRevisionEffect({
        organizationKey: args.organizationKey,
        workspaceId: args.workspaceId,
        brainKey: args.brainKey,
        sourceRevisionKey: artifact.latestSourceRevisionKey,
        caller: args.caller,
        now: args.now,
      });
      if (result.outcome === "published" || result.outcome === "duplicate")
        published += 1;
      if (result.outcome === "revoked") revoked += 1;
    }
    const nextAfterSourceKey = batch.at(-1)?.sourceKey;
    return {
      processed: batch.length,
      published,
      revoked,
      ...(nextAfterSourceKey === undefined ? {} : { nextAfterSourceKey }),
      hasMore: artifacts.length > args.limit,
    };
  });

export const rebuildTranscriptBatchEffect = (
  args: Schema.Schema.Type<typeof RebuildRoutedCorpusBatchArgs>,
) =>
  Effect.gen(function* () {
    if (args.caller.kind !== "system") return yield* new Unauthorized();
    yield* validatePublicationTarget(args);
    const reader = yield* DatabaseReader;
    const units = yield* reader
      .table("sourceUnits")
      .index("by_unit_key", (query) => {
        const scoped = query.eq("organizationKey", args.organizationKey);
        return args.afterSourceKey === undefined
          ? scoped
          : scoped.gt("unitKey", args.afterSourceKey);
      })
      .take(args.limit + 1)
      .pipe(Effect.orDie);
    const batch = units.slice(0, args.limit);
    let published = 0;
    let revoked = 0;
    for (const unit of batch) {
      const result = yield* publishTranscriptRevisionEffect({
        organizationKey: args.organizationKey,
        workspaceId: args.workspaceId,
        brainKey: args.brainKey,
        sourceRevisionKey: unit.currentUnitRevisionKey,
        caller: args.caller,
        now: args.now,
      });
      if (result.outcome === "published" || result.outcome === "duplicate")
        published += 1;
      if (result.outcome === "revoked") revoked += 1;
    }
    const nextAfterSourceKey = batch.at(-1)?.unitKey;
    return {
      processed: batch.length,
      published,
      revoked,
      ...(nextAfterSourceKey === undefined ? {} : { nextAfterSourceKey }),
      hasMore: units.length > args.limit,
    };
  });

const publishSlackRevision = FunctionImpl.make(
  databaseSchema,
  retrievalPublicationGroup,
  "publishSlackRevision",
  publishSlackRevisionEffect,
);
const publishTranscriptRevision = FunctionImpl.make(
  databaseSchema,
  retrievalPublicationGroup,
  "publishTranscriptRevision",
  publishTranscriptRevisionEffect,
);
const rebuildSlackBatch = FunctionImpl.make(
  databaseSchema,
  retrievalPublicationGroup,
  "rebuildSlackBatch",
  rebuildSlackBatchEffect,
);
const rebuildTranscriptBatch = FunctionImpl.make(
  databaseSchema,
  retrievalPublicationGroup,
  "rebuildTranscriptBatch",
  rebuildTranscriptBatchEffect,
);
const runPublicationJob = FunctionImpl.make(
  databaseSchema,
  retrievalPublicationGroup,
  "runPublicationJob",
  runPublicationJobEffect,
);
const sweepPublicationJobs = FunctionImpl.make(
  databaseSchema,
  retrievalPublicationGroup,
  "sweepPublicationJobs",
  sweepPublicationJobsEffect,
);

export const rebuildPageBatchEffect = (
  args: Schema.Schema.Type<typeof RebuildPageBatchArgs>,
) =>
  Effect.gen(function* () {
    if (args.caller.kind !== "system") return yield* new Unauthorized();
    const reader = yield* DatabaseReader;
    const pages = yield* reader
      .table("brainPages")
      .index("by_workspace_status_page_key", (query) => {
        const scoped = query
          .eq("workspaceId", args.workspaceId)
          .eq("status", "active");
        return args.afterPageKey === undefined
          ? scoped
          : scoped.gt("pageKey", args.afterPageKey);
      })
      .take(args.limit + 1)
      .pipe(Effect.orDie);
    const batch = pages.slice(0, args.limit);
    let published = 0;
    for (const page of batch) {
      if (page.pageKey === undefined || page.currentRevisionKey == null)
        continue;
      const result = yield* publishPageRevisionEffect({
        organizationKey: args.organizationKey,
        workspaceId: args.workspaceId,
        brainKey: args.brainKey,
        pageKey: page.pageKey,
        revisionKey: page.currentRevisionKey,
        authority: "derived",
        authorityPolicyKey: "company-pages",
        policyGeneration: 1,
        caller: args.caller,
        now: args.now,
      });
      if (result.outcome === "published" || result.outcome === "duplicate")
        published += 1;
    }
    const lastPageKey = batch.at(-1)?.pageKey;
    return {
      processed: batch.length,
      published,
      ...(lastPageKey === undefined ? {} : { nextAfterPageKey: lastPageKey }),
      hasMore: pages.length > args.limit,
    };
  });

const rebuildPageBatch = FunctionImpl.make(
  databaseSchema,
  retrievalPublicationGroup,
  "rebuildPageBatch",
  rebuildPageBatchEffect,
);

export default GroupImpl.make(databaseSchema, retrievalPublicationGroup).pipe(
  Layer.provide(publishPageRevision),
  Layer.provide(publishSlackRevision),
  Layer.provide(publishTranscriptRevision),
  Layer.provide(rebuildSlackBatch),
  Layer.provide(rebuildTranscriptBatch),
  Layer.provide(runPublicationJob),
  Layer.provide(sweepPublicationJobs),
  Layer.provide(rebuildPageBatch),
  GroupImpl.finalize,
);
