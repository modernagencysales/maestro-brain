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
import type {
  RetrievalPublicationJobsDoc,
  RetrievalRebuildChildrenDoc,
} from "../_generated/docs";
import {
  DatabaseReader,
  DatabaseWriter,
  MutationCtx,
  Scheduler,
} from "../_generated/services";
import { Unauthorized, ValidationFailed } from "../errors";
import { sha256Hex } from "../shared/sha256";
import { progressLiveCaptureParentEffect } from "./liveCaptureParentProgress";
import {
  connectionFenceIdentity,
  connectorAllowlistFenceIdentity,
  connectorScopeFenceIdentity,
  documentLifecycleFenceIdentity,
  eligibilityFenceRefsCurrentEffect,
  ensureEligibilityFenceEffect,
  pageLifecycleFenceIdentity,
  slackPolicyFenceIdentity,
  slackSourceLifecycleFenceIdentity,
  transcriptRouteFenceIdentity,
  transcriptUnitLifecycleFenceIdentity,
} from "./retrievalEligibility";
import {
  buildRetrievalPassages,
  buildRetrievalTokenRows,
  retrievalEntryKey,
  retrievalPublicationSetKey,
  retrievalPublicationSubjectKey,
  type RetrievalEligibilityFenceRef,
  type RetrievalOrigin,
} from "./retrievalPublication";
import retrievalPublicationGroup, {
  PublishPageRevisionArgs,
  RebuildPageBatchArgs,
  RebuildPageBatchReturns,
  RebuildRoutedCorpusBatchArgs,
  RebuildRoutedCorpusBatchReturns,
  PublishSlackRevisionArgs,
  PublishTranscriptRevisionArgs,
  RunPublicationJobArgs,
  RunPublicationJobReturns,
  SweepPublicationJobsArgs,
  SweepPublicationJobsReturns,
  RetrievalOriginUnavailable,
  RetrievalPublicationCapacityExceeded,
  RetrievalPublicationConflict,
} from "./retrievalPublication.spec";
import {
  retrievalPublicationJobKey,
  retrievalPublicationJobRow,
  retrievalPublicationAuthorityDigest,
  retrievalPublicationAuthorityEnvelope,
  retrievalPublicationSubjectIncarnationKey,
  type RetrievalPublicationAuthorityContext,
  type RetrievalPublicationFenceSnapshot,
  type RetrievalPublicationJobInput,
} from "./retrievalPublicationJob";
import { advanceProjectionPopulationForMutationEffect } from "./projectionPopulation";
import {
  activatePublicationJobLeaseEffect,
  claimPublicationJobLeaseEffect,
  releasePublicationJobLeaseEffect,
} from "./publicationWorkerControl";
import type { RetrievalOriginReference } from "./retrievalSchemas";
import {
  providerTargetResolutionAuthorityDigest,
  providerTargetResolutionPopulationDigest,
  type ProviderTargetResolutionAuthority,
} from "./providerTargetResolution";
import {
  RETRIEVAL_TOKEN_CATALOG_POSTING_LIMIT,
  RETRIEVAL_TOKEN_CATALOG_SET_LIMIT,
  retrievalTokenCatalogContribution,
  retrievalTokenCatalogDigest,
  retrievalTokenCatalogIsConsistent,
  retrievalTokenCatalogProjection,
  type RetrievalTokenPostingIdentity,
} from "./retrievalTokenCatalog";

const MAX_PUBLICATION_WRITES = 7_000;
const MAX_PRIOR_PUBLICATION_SETS = 100;
const MAX_ENTRIES_PER_PUBLICATION_SET = 512;
const MAX_ACTIVE_PUBLICATION_ROWS = 3_300;
const PUBLICATION_RETRY_BASE_MS = 1_000;
const PUBLICATION_WORKER_LEASE_MS = 60_000;

type RunPublicationJobInput = Schema.Schema.Type<typeof RunPublicationJobArgs>;
type RunPublicationJobOutput = Schema.Schema.Type<
  typeof RunPublicationJobReturns
>;
type PublicationOutput =
  | {
      readonly outcome: "published" | "duplicate";
      readonly publicationSetKey: string;
      readonly publicationGeneration: number;
      readonly entryCount: number;
      readonly tokenCount: number;
    }
  | {
      readonly outcome: "stale" | "revoked";
      readonly publicationSetKey?: undefined;
      readonly publicationGeneration?: undefined;
      readonly entryCount: number;
      readonly tokenCount: number;
    };
type RebuildPageBatchOutput = Schema.Schema.Type<
  typeof RebuildPageBatchReturns
>;
type RebuildRoutedCorpusBatchOutput = Schema.Schema.Type<
  typeof RebuildRoutedCorpusBatchReturns
>;
type SweepPublicationJobsOutput = Schema.Schema.Type<
  typeof SweepPublicationJobsReturns
>;
type PublicationEffectError =
  | Unauthorized
  | ValidationFailed
  | RetrievalOriginUnavailable
  | RetrievalPublicationConflict
  | RetrievalPublicationCapacityExceeded;
type PublicationMutationServices =
  DatabaseReader | DatabaseWriter | MutationCtx | Scheduler;
type PurgePublicationSubjectOutput = {
  readonly outcome: "purged";
  readonly deletedSets: number;
  readonly deletedEntries: number;
  readonly deletedTokens: number;
  readonly lastPublicationGeneration: number;
};

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

const catalogMutationCount = (
  ...groups: readonly (readonly Pick<
    RetrievalTokenPostingIdentity,
    "token"
  >[])[]
) => new Set(groups.flatMap((group) => group.map(({ token }) => token))).size;

export const synchronizeCurrentTokenCatalogEffect = (input: {
  readonly organizationKey: string;
  readonly workspaceId: GenericId<"workspaces">;
  readonly brainKey: string;
  readonly removedPostings: readonly RetrievalTokenPostingIdentity[];
  readonly addedPostings: readonly RetrievalTokenPostingIdentity[];
  readonly now: number;
}): Effect.Effect<
  void,
  RetrievalPublicationConflict | RetrievalPublicationCapacityExceeded,
  DatabaseReader | DatabaseWriter
> =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const affectedTokens = [
      ...new Set(
        [...input.removedPostings, ...input.addedPostings].map(
          ({ token }) => token,
        ),
      ),
    ].sort();
    const removedSetKeys = new Set(
      input.removedPostings.map(({ publicationSetKey }) => publicationSetKey),
    );
    const addedByTokenAndSet = new Map<
      string,
      Map<string, RetrievalTokenPostingIdentity[]>
    >();
    for (const posting of input.addedPostings) {
      const bySet =
        addedByTokenAndSet.get(posting.token) ??
        new Map<string, RetrievalTokenPostingIdentity[]>();
      bySet.set(posting.publicationSetKey, [
        ...(bySet.get(posting.publicationSetKey) ?? []),
        posting,
      ]);
      addedByTokenAndSet.set(posting.token, bySet);
    }

    for (const token of affectedTokens) {
      const storedRows = yield* reader
        .table("retrievalTokenCatalog")
        .index("by_workspace_brain_token", (query) =>
          query
            .eq("workspaceId", input.workspaceId)
            .eq("brainKey", input.brainKey)
            .eq("token", token),
        )
        .take(2)
        .pipe(Effect.orDie);
      if (storedRows.length > 1)
        return yield* new RetrievalPublicationConflict({
          publicationSetKey: token,
        });
      const stored = storedRows[0];
      if (
        stored !== undefined &&
        (stored.organizationKey !== input.organizationKey ||
          stored.workspaceId !== input.workspaceId ||
          stored.brainKey !== input.brainKey ||
          stored.tokenizerVersion !== 1 ||
          stored.token !== token ||
          !retrievalTokenCatalogIsConsistent(stored))
      )
        return yield* new RetrievalPublicationConflict({
          publicationSetKey: token,
        });
      let projection;
      if (stored === undefined) {
        const currentPostings = yield* reader
          .table("retrievalTokens")
          .index(
            "by_workspace_brain_token_publication_state_authority_entry",
            (query) =>
              query
                .eq("workspaceId", input.workspaceId)
                .eq("brainKey", input.brainKey)
                .eq("token", token)
                .eq("publicationState", "current"),
          )
          .take(RETRIEVAL_TOKEN_CATALOG_POSTING_LIMIT + 1)
          .pipe(Effect.orDie);
        if (currentPostings.length > RETRIEVAL_TOKEN_CATALOG_POSTING_LIMIT)
          return yield* new RetrievalPublicationCapacityExceeded({
            entryCount: 0,
            tokenCount: currentPostings.length,
          });
        const addedSetKeys = new Set([
          ...(addedByTokenAndSet.get(token)?.keys() ?? []),
        ]);
        projection = retrievalTokenCatalogProjection(
          [
            ...currentPostings.filter(
              ({ publicationSetKey }) =>
                !removedSetKeys.has(publicationSetKey) &&
                !addedSetKeys.has(publicationSetKey),
            ),
            ...(addedByTokenAndSet.get(token)?.values() ?? []),
          ].flat(),
        );
      } else {
        const added = addedByTokenAndSet.get(token) ?? new Map();
        const replacedSetKeys = new Set([...added.keys()]);
        const contributions = stored.contributions
          .filter(
            ({ publicationSetKey }) =>
              !removedSetKeys.has(publicationSetKey) &&
              !replacedSetKeys.has(publicationSetKey),
          )
          .concat(
            [...added].map(([publicationSetKey, postings]) =>
              retrievalTokenCatalogContribution(publicationSetKey, postings),
            ),
          )
          .sort((left, right) =>
            left.publicationSetKey.localeCompare(right.publicationSetKey),
          );
        projection = {
          contributions,
          expectedPostingCount: contributions.reduce(
            (total, contribution) => total + contribution.postingCount,
            0,
          ),
          expectedPostingDigest: retrievalTokenCatalogDigest(contributions),
        };
      }
      if (
        projection.contributions.length > RETRIEVAL_TOKEN_CATALOG_SET_LIMIT ||
        projection.expectedPostingCount > RETRIEVAL_TOKEN_CATALOG_POSTING_LIMIT
      )
        return yield* new RetrievalPublicationCapacityExceeded({
          entryCount: projection.contributions.length,
          tokenCount: projection.expectedPostingCount,
        });
      if (projection.expectedPostingCount === 0) {
        if (stored !== undefined)
          yield* writer
            .table("retrievalTokenCatalog")
            .delete(stored._id)
            .pipe(Effect.orDie);
        continue;
      }
      const row = {
        schemaVersion: 1 as const,
        organizationKey: input.organizationKey,
        workspaceId: input.workspaceId,
        brainKey: input.brainKey,
        tokenizerVersion: 1 as const,
        token,
        expectedPostingCount: projection.expectedPostingCount,
        expectedPostingDigest: projection.expectedPostingDigest,
        contributions: projection.contributions,
        updatedAt: input.now,
      };
      if (stored === undefined)
        yield* writer
          .table("retrievalTokenCatalog")
          .insert(row)
          .pipe(Effect.orDie);
      else
        yield* writer
          .table("retrievalTokenCatalog")
          .patch(stored._id, row)
          .pipe(Effect.orDie);
    }
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

type PublicationSubjectIdentity = {
  readonly organizationKey: string;
  readonly workspaceId: GenericId<"workspaces">;
  readonly brainKey: string;
  readonly corpusKey: string;
  readonly kind: "page" | "slack" | "transcript" | "document" | "projection";
  readonly originTable: string;
  readonly sourceKey: string;
  readonly connectorScopeKey?: string | undefined;
  readonly connectionKey?: string | undefined;
  readonly connectionGeneration?: number | undefined;
  readonly now: number;
};

const loadPublicationSubject = (input: PublicationSubjectIdentity) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const publicationSubjectKey = retrievalPublicationSubjectKey({
      workspaceId: String(input.workspaceId),
      brainKey: input.brainKey,
      corpusKey: input.corpusKey,
      originTable: input.originTable,
      kind: input.kind,
      sourceKey: input.sourceKey,
      ...(input.connectorScopeKey === undefined
        ? {}
        : { connectorScopeKey: input.connectorScopeKey }),
    });
    const stored = yield* reader
      .table("retrievalPublicationSubjects")
      .index("by_workspace_subject", (query) =>
        query
          .eq("workspaceId", input.workspaceId)
          .eq("publicationSubjectKey", publicationSubjectKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    if (stored !== null) {
      const currentPublicationSetKey = stored.currentPublicationSetKey;
      const current =
        currentPublicationSetKey === null
          ? null
          : yield* reader
              .table("retrievalPublicationSets")
              .index("by_workspace_publication_set", (query) =>
                query
                  .eq("workspaceId", input.workspaceId)
                  .eq("publicationSetKey", currentPublicationSetKey),
              )
              .first()
              .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      if (
        currentPublicationSetKey !== null &&
        (current === null || current.state !== "current")
      )
        return yield* new RetrievalPublicationConflict({
          publicationSetKey: currentPublicationSetKey,
        });
      return {
        publicationSubjectKey,
        subjectId: stored._id,
        created: false,
        lastPublicationGeneration: stored.lastPublicationGeneration,
        currentSets: current === null ? [] : [current],
      };
    }

    const legacyCandidates = yield* reader
      .table("retrievalPublicationSets")
      .index("by_workspace_brain_source_state_generation", (query) =>
        query
          .eq("workspaceId", input.workspaceId)
          .eq("brainKey", input.brainKey)
          .eq("originTable", input.originTable)
          .eq("sourceKey", input.sourceKey),
      )
      .take(MAX_PRIOR_PUBLICATION_SETS + 1)
      .pipe(Effect.orDie);
    if (legacyCandidates.length > MAX_PRIOR_PUBLICATION_SETS)
      return yield* new RetrievalPublicationConflict({
        publicationSetKey:
          legacyCandidates[0]?.publicationSetKey ?? publicationSubjectKey,
      });
    const legacySets = legacyCandidates.filter(
      ({ connectorScopeKey, corpusKey, originKind }) =>
        corpusKey === input.corpusKey &&
        originKind === input.kind &&
        (connectorScopeKey === input.connectorScopeKey ||
          (connectorScopeKey === undefined &&
            input.connectorScopeKey === undefined)),
    );
    const currentSets = legacySets.filter(({ state }) => state === "current");
    if (currentSets.length > 1)
      return yield* new RetrievalPublicationConflict({
        publicationSetKey:
          currentSets[0]?.publicationSetKey ?? publicationSubjectKey,
      });
    const lastPublicationGeneration = Math.max(
      0,
      ...legacySets.map(({ publicationGeneration }) => publicationGeneration),
    );
    const currentPublicationSetKey = currentSets[0]?.publicationSetKey ?? null;
    const subjectId = yield* writer
      .table("retrievalPublicationSubjects")
      .insert({
        schemaVersion: 1,
        organizationKey: input.organizationKey,
        workspaceId: input.workspaceId,
        brainKey: input.brainKey,
        corpusKey: input.corpusKey,
        publicationSubjectKey,
        originKind: input.kind,
        originTable: input.originTable,
        sourceKey: input.sourceKey,
        ...(input.connectorScopeKey === undefined
          ? {}
          : { connectorScopeKey: input.connectorScopeKey }),
        ...(input.connectionKey === undefined
          ? {}
          : { connectionKey: input.connectionKey }),
        ...(input.connectionGeneration === undefined
          ? {}
          : { connectionGeneration: input.connectionGeneration }),
        currentPublicationSetKey,
        lastPublicationGeneration,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .pipe(Effect.orDie);
    return {
      publicationSubjectKey,
      subjectId,
      created: true,
      lastPublicationGeneration,
      currentSets,
    };
  });

export const commitPreparedPublicationEffect = (input: {
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
  readonly eligibilityFences?: readonly RetrievalEligibilityFenceRef[];
  readonly revoked: boolean;
  readonly passages: readonly PreparedPassage[];
  readonly now: number;
}): Effect.Effect<
  PublicationOutput,
  PublicationEffectError,
  PublicationMutationServices
> =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const expectedEligibilityIdentities =
      input.kind === "slack" &&
      input.connectorScopeKey !== undefined &&
      input.connectionKey !== undefined
        ? [
            slackSourceLifecycleFenceIdentity({
              organizationKey: input.organizationKey,
              sourceKey: input.sourceKey,
            }),
            slackPolicyFenceIdentity({
              organizationKey: input.organizationKey,
              channelKey: input.connectorScopeKey,
              brainKey: input.brainKey,
            }),
            connectionFenceIdentity({
              organizationKey: input.organizationKey,
              connectionKey: input.connectionKey,
            }),
          ]
        : input.kind === "transcript" && input.connectionKey !== undefined
          ? [
              transcriptUnitLifecycleFenceIdentity({
                organizationKey: input.organizationKey,
                unitKey: input.sourceKey,
              }),
              transcriptRouteFenceIdentity({
                organizationKey: input.organizationKey,
                unitKey: input.sourceKey,
                brainKey: input.brainKey,
              }),
              connectionFenceIdentity({
                organizationKey: input.organizationKey,
                connectionKey: input.connectionKey,
              }),
            ]
          : input.kind === "document" &&
              input.connectionKey !== undefined &&
              input.connectorScopeKey !== undefined
            ? [
                documentLifecycleFenceIdentity({
                  organizationKey: input.organizationKey,
                  documentObjectKey: input.sourceKey,
                }),
                connectorScopeFenceIdentity({
                  organizationKey: input.organizationKey,
                  connectorScopeKey: input.connectorScopeKey,
                }),
                connectorAllowlistFenceIdentity({
                  organizationKey: input.organizationKey,
                  connectorScopeKey: input.connectorScopeKey,
                }),
                connectionFenceIdentity({
                  organizationKey: input.organizationKey,
                  connectionKey: input.connectionKey,
                }),
              ]
            : [];
    if (!input.revoked && expectedEligibilityIdentities.length > 0) {
      if (
        input.eligibilityFences === undefined ||
        !(yield* eligibilityFenceRefsCurrentEffect({
          organizationKey: input.organizationKey,
          refs: input.eligibilityFences,
          expectedIdentities: expectedEligibilityIdentities,
        }))
      )
        return yield* new RetrievalPublicationConflict({
          publicationSetKey:
            input.eligibilityFences?.[0]?.fenceKey ?? input.sourceRevisionKey,
        });
    } else if (
      !input.revoked &&
      input.eligibilityFences !== undefined &&
      !(yield* eligibilityFenceRefsCurrentEffect({
        organizationKey: input.organizationKey,
        refs: input.eligibilityFences,
      }))
    )
      return yield* new RetrievalPublicationConflict({
        publicationSetKey:
          input.eligibilityFences[0]?.fenceKey ?? input.sourceRevisionKey,
      });
    const subject = yield* loadPublicationSubject({
      organizationKey: input.organizationKey,
      workspaceId: input.workspaceId,
      brainKey: input.brainKey,
      corpusKey: input.corpusKey,
      kind: input.kind,
      originTable: input.originTable,
      sourceKey: input.sourceKey,
      ...(input.connectorScopeKey === undefined
        ? {}
        : { connectorScopeKey: input.connectorScopeKey }),
      ...(input.connectionKey === undefined
        ? {}
        : { connectionKey: input.connectionKey }),
      ...(input.connectionGeneration === undefined
        ? {}
        : { connectionGeneration: input.connectionGeneration }),
      now: input.now,
    });
    const currentSets = subject.currentSets;
    const current = currentSets[0];
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
      if (
        currentTokens.length + catalogMutationCount(currentTokens) + 3 >
        MAX_PUBLICATION_WRITES
      )
        return yield* new RetrievalPublicationCapacityExceeded({
          entryCount: 0,
          tokenCount: currentTokens.length,
        });
      yield* removePublicationTokens(currentTokens);
      for (const prior of currentSets)
        yield* writer
          .table("retrievalPublicationSets")
          .patch(prior._id, { state: "retired", retiredAt: input.now })
          .pipe(Effect.orDie);
      yield* writer
        .table("retrievalPublicationSubjects")
        .patch(subject.subjectId, {
          currentPublicationSetKey: null,
          updatedAt: input.now,
        })
        .pipe(Effect.orDie);
      yield* synchronizeCurrentTokenCatalogEffect({
        organizationKey: input.organizationKey,
        workspaceId: input.workspaceId,
        brainKey: input.brainKey,
        removedPostings: currentTokens,
        addedPostings: [],
        now: input.now,
      });
      if (subject.created || currentSets.length > 0)
        yield* advanceProjectionPopulationForMutationEffect({
          organizationKey: input.organizationKey,
          workspaceId: input.workspaceId,
          brainKey: input.brainKey,
          now: input.now,
        });
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
    ) {
      if (subject.created) {
        yield* synchronizeCurrentTokenCatalogEffect({
          organizationKey: input.organizationKey,
          workspaceId: input.workspaceId,
          brainKey: input.brainKey,
          removedPostings: [],
          addedPostings: currentTokens,
          now: input.now,
        });
        yield* advanceProjectionPopulationForMutationEffect({
          organizationKey: input.organizationKey,
          workspaceId: input.workspaceId,
          brainKey: input.brainKey,
          now: input.now,
        });
      }
      return {
        outcome: "duplicate" as const,
        publicationSetKey: current.publicationSetKey,
        publicationGeneration: current.publicationGeneration,
        entryCount: current.expectedEntryCount,
        tokenCount: current.expectedTokenCount,
      };
    }
    const firstPassage = input.passages[0];
    if (firstPassage === undefined)
      return yield* new RetrievalOriginUnavailable({
        sourceKey: input.sourceKey,
        revisionKey: input.sourceRevisionKey,
      });
    const publicationGeneration = subject.lastPublicationGeneration + 1;
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
        publicationSubjectKey: subject.publicationSubjectKey,
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
        ...(input.connectionKey === undefined
          ? {}
          : { connectionKey: input.connectionKey }),
        ...(input.connectionGeneration === undefined
          ? {}
          : { connectionGeneration: input.connectionGeneration }),
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
        corpusKey: entry.corpusKey,
        sourceModifiedAt: entry.sourceModifiedAt,
        observedAt: entry.observedAt,
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
      entries.length +
        tokens.length +
        currentTokens.length +
        catalogMutationCount(currentTokens, tokens) +
        4 >
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
        publicationSubjectKey: subject.publicationSubjectKey,
        publicationSetKey,
        publicationGeneration,
        originKind: input.kind,
        originTable: input.originTable,
        ...(input.connectorScopeKey === undefined
          ? {}
          : { connectorScopeKey: input.connectorScopeKey }),
        ...(input.connectionKey === undefined
          ? {}
          : { connectionKey: input.connectionKey }),
        ...(input.connectionGeneration === undefined
          ? {}
          : { connectionGeneration: input.connectionGeneration }),
        sourceKey: input.sourceKey,
        sourceRevisionKey: input.sourceRevisionKey,
        routeGeneration: input.routeGeneration,
        lifecycleGeneration: input.lifecycleGeneration,
        policyGeneration: input.policyGeneration,
        ...(input.eligibilityFences === undefined
          ? {}
          : { eligibilityFences: [...input.eligibilityFences] }),
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
    yield* writer
      .table("retrievalPublicationSubjects")
      .patch(subject.subjectId, {
        currentPublicationSetKey: publicationSetKey,
        lastPublicationGeneration: publicationGeneration,
        updatedAt: input.now,
      })
      .pipe(Effect.orDie);
    yield* synchronizeCurrentTokenCatalogEffect({
      organizationKey: input.organizationKey,
      workspaceId: input.workspaceId,
      brainKey: input.brainKey,
      removedPostings: currentTokens,
      addedPostings: tokens,
      now: input.now,
    });
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
    yield* advanceProjectionPopulationForMutationEffect({
      organizationKey: input.organizationKey,
      workspaceId: input.workspaceId,
      brainKey: input.brainKey,
      now: input.now,
    });
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
): Effect.Effect<
  PublicationOutput,
  PublicationEffectError,
  PublicationMutationServices
> =>
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

    const subject = yield* loadPublicationSubject({
      organizationKey: args.organizationKey,
      workspaceId: args.workspaceId,
      brainKey: args.brainKey,
      corpusKey: "brain-pages",
      kind: "page",
      originTable: "pageRevisions",
      sourceKey: args.pageKey,
      now: args.now,
    });
    const currentSets = subject.currentSets;
    const current = currentSets[0];
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
      if (
        currentTokens.length + catalogMutationCount(currentTokens) + 3 >
        MAX_PUBLICATION_WRITES
      )
        return yield* new RetrievalPublicationCapacityExceeded({
          entryCount: 0,
          tokenCount: currentTokens.length,
        });
      yield* removePublicationTokens(currentTokens);
      for (const prior of currentSets)
        yield* writer
          .table("retrievalPublicationSets")
          .patch(prior._id, { state: "retired", retiredAt: args.now })
          .pipe(Effect.orDie);
      yield* writer
        .table("retrievalPublicationSubjects")
        .patch(subject.subjectId, {
          currentPublicationSetKey: null,
          updatedAt: args.now,
        })
        .pipe(Effect.orDie);
      yield* synchronizeCurrentTokenCatalogEffect({
        organizationKey: args.organizationKey,
        workspaceId: args.workspaceId,
        brainKey: args.brainKey,
        removedPostings: currentTokens,
        addedPostings: [],
        now: args.now,
      });
      if (subject.created || currentSets.length > 0)
        yield* advanceProjectionPopulationForMutationEffect({
          organizationKey: args.organizationKey,
          workspaceId: args.workspaceId,
          brainKey: args.brainKey,
          now: args.now,
        });
      return {
        outcome: "revoked" as const,
        entryCount: 0,
        tokenCount: 0,
      };
    }
    const lifecycleFence = yield* ensureEligibilityFenceEffect({
      identity: pageLifecycleFenceIdentity({
        organizationKey: args.organizationKey,
        workspaceId: String(args.workspaceId),
        pageKey: args.pageKey,
      }),
      eligible: true,
      now: args.now,
    });
    if (!lifecycleFence.eligible)
      return yield* new RetrievalPublicationConflict({
        publicationSetKey: lifecycleFence.ref.fenceKey,
      });
    if (
      current?.sourceRevisionKey === args.revisionKey &&
      current.policyGeneration === args.policyGeneration &&
      current.lifecycleGeneration === (page.lifecycle?.generation ?? 1)
    ) {
      if (subject.created) {
        yield* synchronizeCurrentTokenCatalogEffect({
          organizationKey: args.organizationKey,
          workspaceId: args.workspaceId,
          brainKey: args.brainKey,
          removedPostings: [],
          addedPostings: currentTokens,
          now: args.now,
        });
        yield* advanceProjectionPopulationForMutationEffect({
          organizationKey: args.organizationKey,
          workspaceId: args.workspaceId,
          brainKey: args.brainKey,
          now: args.now,
        });
      }
      return {
        outcome: "duplicate" as const,
        publicationSetKey: current.publicationSetKey,
        publicationGeneration: current.publicationGeneration,
        entryCount: current.expectedEntryCount,
        tokenCount: current.expectedTokenCount,
      };
    }

    const publicationGeneration = subject.lastPublicationGeneration + 1;
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
      publicationSubjectKey: subject.publicationSubjectKey,
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
        corpusKey: entry.corpusKey,
        observedAt: entry.observedAt,
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
      entries.length +
        tokens.length +
        currentTokens.length +
        catalogMutationCount(currentTokens, tokens) +
        4 >
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
        publicationSubjectKey: subject.publicationSubjectKey,
        publicationSetKey,
        publicationGeneration,
        originKind: origin.kind,
        originTable: origin.originTable,
        sourceKey: origin.sourceKey,
        sourceRevisionKey: origin.sourceRevisionKey,
        routeGeneration: origin.routeGeneration,
        lifecycleGeneration: origin.lifecycleGeneration,
        policyGeneration: origin.policyGeneration,
        eligibilityFences: [lifecycleFence.ref],
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
    yield* writer
      .table("retrievalPublicationSubjects")
      .patch(subject.subjectId, {
        currentPublicationSetKey: publicationSetKey,
        lastPublicationGeneration: publicationGeneration,
        updatedAt: args.now,
      })
      .pipe(Effect.orDie);
    yield* synchronizeCurrentTokenCatalogEffect({
      organizationKey: args.organizationKey,
      workspaceId: args.workspaceId,
      brainKey: args.brainKey,
      removedPostings: currentTokens,
      addedPostings: tokens,
      now: args.now,
    });
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
    yield* advanceProjectionPopulationForMutationEffect({
      organizationKey: args.organizationKey,
      workspaceId: args.workspaceId,
      brainKey: args.brainKey,
      now: args.now,
    });
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

const cleanupPublicationSubjectEffect = (args: {
  readonly organizationKey: string;
  readonly workspaceId: GenericId<"workspaces">;
  readonly brainKey: string;
  readonly publicationSubjectKey: string;
  readonly now: number;
}) =>
  Effect.gen(function* () {
    yield* validatePublicationTarget(args);
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const subjects = yield* reader
      .table("retrievalPublicationSubjects")
      .index("by_workspace_subject", (query) =>
        query
          .eq("workspaceId", args.workspaceId)
          .eq("publicationSubjectKey", args.publicationSubjectKey),
      )
      .take(2)
      .pipe(Effect.orDie);
    const subject = subjects.length === 1 ? subjects[0] : undefined;
    if (
      subject === undefined ||
      subject.organizationKey !== args.organizationKey ||
      subject.brainKey !== args.brainKey
    )
      return yield* new RetrievalPublicationConflict({
        publicationSetKey: args.publicationSubjectKey,
      });
    if (subject.currentPublicationSetKey === null)
      return {
        outcome: "duplicate" as const,
        entryCount: 0,
        tokenCount: 0,
      };
    const sets = yield* reader
      .table("retrievalPublicationSets")
      .index("by_workspace_publication_set", (query) =>
        query
          .eq("workspaceId", args.workspaceId)
          .eq("publicationSetKey", subject.currentPublicationSetKey ?? ""),
      )
      .take(2)
      .pipe(Effect.orDie);
    const current = sets.length === 1 ? sets[0] : undefined;
    if (
      current === undefined ||
      current.state !== "current" ||
      current.publicationSubjectKey !== subject.publicationSubjectKey
    )
      return yield* new RetrievalPublicationConflict({
        publicationSetKey: subject.currentPublicationSetKey,
      });
    const tokens = yield* loadCurrentPublicationTokens({
      workspaceId: args.workspaceId,
      brainKey: args.brainKey,
      publicationSetKeys: [current.publicationSetKey],
    });
    if (
      tokens.length + catalogMutationCount(tokens) + 3 >
      MAX_PUBLICATION_WRITES
    )
      return yield* new RetrievalPublicationCapacityExceeded({
        entryCount: 0,
        tokenCount: tokens.length,
      });
    yield* removePublicationTokens(tokens);
    yield* writer
      .table("retrievalPublicationSets")
      .patch(current._id, { state: "retired", retiredAt: args.now })
      .pipe(Effect.orDie);
    yield* writer
      .table("retrievalPublicationSubjects")
      .patch(subject._id, {
        currentPublicationSetKey: null,
        updatedAt: args.now,
      })
      .pipe(Effect.orDie);
    yield* synchronizeCurrentTokenCatalogEffect({
      organizationKey: args.organizationKey,
      workspaceId: args.workspaceId,
      brainKey: args.brainKey,
      removedPostings: tokens,
      addedPostings: [],
      now: args.now,
    });
    yield* advanceProjectionPopulationForMutationEffect({
      organizationKey: args.organizationKey,
      workspaceId: args.workspaceId,
      brainKey: args.brainKey,
      now: args.now,
    });
    return {
      outcome: "revoked" as const,
      entryCount: 0,
      tokenCount: 0,
    };
  });

export const purgePublicationSubjectEffect = (args: {
  readonly organizationKey: string;
  readonly workspaceId: GenericId<"workspaces">;
  readonly brainKey: string;
  readonly publicationSubjectKey: string;
  readonly now: number;
}): Effect.Effect<
  PurgePublicationSubjectOutput,
  | ValidationFailed
  | RetrievalPublicationConflict
  | RetrievalPublicationCapacityExceeded,
  DatabaseReader | DatabaseWriter | MutationCtx
> =>
  Effect.gen(function* () {
    yield* validatePublicationTarget(args);
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const subjects = yield* reader
      .table("retrievalPublicationSubjects")
      .index("by_workspace_subject", (query) =>
        query
          .eq("workspaceId", args.workspaceId)
          .eq("publicationSubjectKey", args.publicationSubjectKey),
      )
      .take(2)
      .pipe(Effect.orDie);
    const subject = subjects.length === 1 ? subjects[0] : undefined;
    const sets = yield* reader
      .table("retrievalPublicationSets")
      .index("by_workspace_subject_generation", (query) =>
        query
          .eq("workspaceId", args.workspaceId)
          .eq("publicationSubjectKey", args.publicationSubjectKey),
      )
      .take(MAX_PRIOR_PUBLICATION_SETS + 1)
      .pipe(Effect.orDie);
    if (sets.length > MAX_PRIOR_PUBLICATION_SETS)
      return yield* new RetrievalPublicationCapacityExceeded({
        entryCount: sets.length,
        tokenCount: 0,
      });
    if (subject === undefined) {
      if (subjects.length > 1 || sets.length > 0)
        return yield* new RetrievalPublicationConflict({
          publicationSetKey: args.publicationSubjectKey,
        });
      return {
        outcome: "purged" as const,
        deletedSets: 0,
        deletedEntries: 0,
        deletedTokens: 0,
        lastPublicationGeneration: 0,
      };
    }
    if (
      subject.organizationKey !== args.organizationKey ||
      subject.brainKey !== args.brainKey ||
      sets.some(
        (set) =>
          set.organizationKey !== args.organizationKey ||
          set.brainKey !== args.brainKey ||
          set.publicationSubjectKey !== subject.publicationSubjectKey,
      ) ||
      (subject.currentPublicationSetKey !== null &&
        !sets.some(
          (set) =>
            set.publicationSetKey === subject.currentPublicationSetKey &&
            set.state === "current",
        ))
    )
      return yield* new RetrievalPublicationConflict({
        publicationSetKey:
          subject.currentPublicationSetKey ?? subject.publicationSubjectKey,
      });
    const entryGroups = yield* Effect.all(
      sets.map((set) =>
        reader
          .table("retrievalEntries")
          .index("by_workspace_brain_publication_set_entry", (query) =>
            query
              .eq("workspaceId", args.workspaceId)
              .eq("brainKey", args.brainKey)
              .eq("publicationSetKey", set.publicationSetKey),
          )
          .take(MAX_ENTRIES_PER_PUBLICATION_SET + 1)
          .pipe(Effect.orDie),
      ),
    );
    const tokenGroups = yield* Effect.all(
      sets.map((set) =>
        reader
          .table("retrievalTokens")
          .index("by_workspace_brain_publication_set_entry", (query) =>
            query
              .eq("workspaceId", args.workspaceId)
              .eq("brainKey", args.brainKey)
              .eq("publicationSetKey", set.publicationSetKey),
          )
          .take(MAX_ACTIVE_PUBLICATION_ROWS + 1)
          .pipe(Effect.orDie),
      ),
    );
    if (
      entryGroups.some(
        (entries) => entries.length > MAX_ENTRIES_PER_PUBLICATION_SET,
      ) ||
      tokenGroups.some((tokens) => tokens.length > MAX_ACTIVE_PUBLICATION_ROWS)
    )
      return yield* new RetrievalPublicationCapacityExceeded({
        entryCount: entryGroups.flat().length,
        tokenCount: tokenGroups.flat().length,
      });
    const entries = entryGroups.flat();
    const tokens = tokenGroups.flat();
    if (
      entries.length +
        tokens.length +
        sets.length +
        catalogMutationCount(tokens) +
        1 >
      MAX_PUBLICATION_WRITES
    )
      return yield* new RetrievalPublicationCapacityExceeded({
        entryCount: entries.length,
        tokenCount: tokens.length,
      });

    yield* removePublicationTokens(tokens);
    for (const entry of entries)
      yield* writer
        .table("retrievalEntries")
        .delete(entry._id)
        .pipe(Effect.orDie);
    for (const set of sets)
      yield* writer
        .table("retrievalPublicationSets")
        .delete(set._id)
        .pipe(Effect.orDie);
    yield* synchronizeCurrentTokenCatalogEffect({
      organizationKey: args.organizationKey,
      workspaceId: args.workspaceId,
      brainKey: args.brainKey,
      removedPostings: tokens,
      addedPostings: [],
      now: args.now,
    });
    yield* writer
      .table("retrievalPublicationSubjects")
      .patch(subject._id, {
        currentPublicationSetKey: null,
        updatedAt: args.now,
      })
      .pipe(Effect.orDie);
    yield* advanceProjectionPopulationForMutationEffect({
      organizationKey: args.organizationKey,
      workspaceId: args.workspaceId,
      brainKey: args.brainKey,
      now: args.now,
    });
    return {
      outcome: "purged" as const,
      deletedSets: sets.length,
      deletedEntries: entries.length,
      deletedTokens: tokens.length,
      lastPublicationGeneration: subject.lastPublicationGeneration,
    };
  });

export const publishSlackRevisionEffect = (
  args: Schema.Schema.Type<typeof PublishSlackRevisionArgs>,
): Effect.Effect<
  PublicationOutput,
  PublicationEffectError,
  PublicationMutationServices
> =>
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
      .take(2)
      .pipe(Effect.orDie);
    if (policies.length > 1)
      return yield* new RetrievalPublicationCapacityExceeded({
        entryCount: policies.length,
        tokenCount: 0,
      });
    const policy = policies
      .filter(
        (candidate) =>
          candidate.mode !== "capture_only" &&
          candidate.targetBrainKeys.includes(args.brainKey),
      )
      .sort((left, right) => right.policyEpoch - left.policyEpoch)[0];
    const eligibleByCutoff =
      policy?.historicalBackfillStartAt !== undefined &&
      revision.sourceCreatedAt >= policy.historicalBackfillStartAt;
    const revoked =
      revision.tombstone ||
      revision.lifecycle.state !== "active" ||
      artifact.lifecycle.state !== "active" ||
      !currentConnection ||
      policy === undefined ||
      !eligibleByCutoff;
    const eligibilityFences = revoked
      ? undefined
      : yield* Effect.all([
          ensureEligibilityFenceEffect({
            identity: slackSourceLifecycleFenceIdentity({
              organizationKey: args.organizationKey,
              sourceKey: revision.sourceKey,
            }),
            eligible: true,
            now: args.now,
          }),
          ensureEligibilityFenceEffect({
            identity: slackPolicyFenceIdentity({
              organizationKey: args.organizationKey,
              channelKey: revision.channelKey,
              brainKey: args.brainKey,
            }),
            eligible: true,
            now: args.now,
          }),
          ensureEligibilityFenceEffect({
            identity: connectionFenceIdentity({
              organizationKey: args.organizationKey,
              connectionKey: revision.connectionKey,
            }),
            eligible: true,
            now: args.now,
          }),
        ]);
    if (eligibilityFences?.some(({ eligible }) => !eligible) === true)
      return yield* new RetrievalPublicationConflict({
        publicationSetKey:
          eligibilityFences.find(({ eligible }) => !eligible)?.ref.fenceKey ??
          revision.sourceRevisionKey,
      });
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
      sourceModifiedAt: revision.sourceModifiedAt ?? revision.sourceCreatedAt,
      observedAt: revision.createdAt,
    }));
    return yield* commitPreparedPublicationEffect({
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
      ...(eligibilityFences === undefined
        ? {}
        : { eligibilityFences: eligibilityFences.map(({ ref }) => ref) }),
      revoked,
      passages,
      now: args.now,
    });
  });

export const publishTranscriptRevisionEffect = (
  args: Schema.Schema.Type<typeof PublishTranscriptRevisionArgs>,
): Effect.Effect<
  PublicationOutput,
  PublicationEffectError,
  PublicationMutationServices
> =>
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
        sourceModifiedAt: Date.parse(revision.endedAt ?? revision.startedAt),
        observedAt: revision.createdAt,
      })),
    );
    const revoked =
      revision.tombstone ||
      unit.lifecycle.state !== "active" ||
      !currentConnection ||
      route === undefined;
    const eligibilityFences = revoked
      ? undefined
      : yield* Effect.all([
          ensureEligibilityFenceEffect({
            identity: transcriptUnitLifecycleFenceIdentity({
              organizationKey: args.organizationKey,
              unitKey: revision.unitKey,
            }),
            eligible: true,
            now: args.now,
          }),
          ensureEligibilityFenceEffect({
            identity: transcriptRouteFenceIdentity({
              organizationKey: args.organizationKey,
              unitKey: revision.unitKey,
              brainKey: args.brainKey,
            }),
            eligible: true,
            now: args.now,
          }),
          ensureEligibilityFenceEffect({
            identity: connectionFenceIdentity({
              organizationKey: args.organizationKey,
              connectionKey: unit.connectionKey,
            }),
            eligible: true,
            now: args.now,
          }),
        ]);
    if (eligibilityFences?.some(({ eligible }) => !eligible) === true)
      return yield* new RetrievalPublicationConflict({
        publicationSetKey:
          eligibilityFences.find(({ eligible }) => !eligible)?.ref.fenceKey ??
          revision.unitRevisionKey,
      });
    return yield* commitPreparedPublicationEffect({
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
      ...(eligibilityFences === undefined
        ? {}
        : { eligibilityFences: eligibilityFences.map(({ ref }) => ref) }),
      revoked,
      passages,
      now: args.now,
    });
  });

type DocumentPublicationAuthorityInput = {
  readonly organizationKey: string;
  readonly workspaceId: GenericId<"workspaces">;
  readonly brainKey: string;
  readonly sourceKey: string;
  readonly sourceRevisionKey: string;
  readonly ingestionObligationKey: string;
};

const loadDocumentPublicationAuthorityEffect = (
  input: DocumentPublicationAuthorityInput,
) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const obligations = yield* reader
      .table("ingestionObligations")
      .index("by_ingestion_obligation_key", (query) =>
        query.eq("ingestionObligationKey", input.ingestionObligationKey),
      )
      .take(2)
      .pipe(Effect.orDie);
    if (obligations.length > 1)
      return yield* Effect.dieMessage(
        "Document publication obligation identity is not unique.",
      );
    const obligation = obligations[0];
    const obligationMatches =
      obligation !== undefined &&
      obligation.organizationKey === input.organizationKey &&
      obligation.workspaceId === input.workspaceId &&
      obligation.brainKey === input.brainKey &&
      obligation.cause === "observation" &&
      obligation.allowlistGeneration !== undefined &&
      obligation.originKind === "document" &&
      obligation.originKey === input.sourceKey &&
      obligation.originRevisionKey === input.sourceRevisionKey;
    if (!obligationMatches || obligation === undefined)
      return {
        obligation: null,
        revision: null,
        object: null,
        membership: null,
        scope: null,
        allowlist: null,
        connection: null,
        exact: false,
        eligible: false,
      } as const;
    const allowlistGeneration = obligation.allowlistGeneration;
    if (allowlistGeneration === undefined)
      return yield* Effect.dieMessage(
        "Document publication obligation has no allowlist generation.",
      );

    const [revisions, objects, memberships, scopes, allowlists, connections] =
      yield* Effect.all([
        reader
          .table("documentSourceRevisions")
          .index("by_organization_revision_key", (query) =>
            query
              .eq("organizationKey", input.organizationKey)
              .eq("documentRevisionKey", input.sourceRevisionKey),
          )
          .take(2),
        reader
          .table("documentSourceObjects")
          .index("by_organization_object_key", (query) =>
            query
              .eq("organizationKey", input.organizationKey)
              .eq("documentObjectKey", input.sourceKey),
          )
          .take(2),
        reader
          .table("documentSourceMembershipEdges")
          .index("by_organization_membership_edge_key", (query) =>
            query
              .eq("organizationKey", input.organizationKey)
              .eq("membershipEdgeKey", obligation.membershipKey),
          )
          .take(2),
        reader
          .table("connectorScopes")
          .index("by_connector_scope_key", (query) =>
            query.eq("connectorScopeKey", obligation.connectorScopeKey),
          )
          .take(2),
        reader
          .table("connectorAllowlistGenerations")
          .index("by_scope_generation", (query) =>
            query
              .eq("connectorScopeKey", obligation.connectorScopeKey)
              .eq("allowlistGeneration", allowlistGeneration),
          )
          .take(2),
        reader
          .table("providerConnections")
          .index("by_connection_key", (query) =>
            query.eq("connectionKey", obligation.connectionKey),
          )
          .take(2),
      ]).pipe(Effect.orDie);
    if (
      revisions.length > 1 ||
      objects.length > 1 ||
      memberships.length > 1 ||
      scopes.length > 1 ||
      allowlists.length > 1 ||
      connections.length > 1
    )
      return yield* Effect.dieMessage(
        "Document publication authority is not unique.",
      );
    const revision = revisions[0] ?? null;
    const object = objects[0] ?? null;
    const membership = memberships[0] ?? null;
    const scope = scopes[0] ?? null;
    const allowlist = allowlists[0] ?? null;
    const connection = connections[0] ?? null;
    const exact =
      revision !== null &&
      object !== null &&
      membership !== null &&
      scope !== null &&
      allowlist !== null &&
      connection !== null &&
      revision.documentObjectKey === input.sourceKey &&
      revision.connectorScopeKey === obligation.connectorScopeKey &&
      revision.connectionKey === obligation.connectionKey &&
      revision.connectionGeneration === obligation.connectionGeneration &&
      revision.allowlistGeneration === obligation.allowlistGeneration &&
      object.documentObjectKey === input.sourceKey &&
      membership.documentObjectKey === input.sourceKey &&
      membership.documentRevisionKey === input.sourceRevisionKey &&
      membership.connectorScopeKey === obligation.connectorScopeKey &&
      membership.connectionKey === obligation.connectionKey &&
      membership.connectionGeneration === obligation.connectionGeneration &&
      membership.allowlistGeneration === obligation.allowlistGeneration &&
      scope.organizationKey === input.organizationKey &&
      scope.providerKind === "google_drive" &&
      scope.connectionKey === obligation.connectionKey &&
      allowlist.organizationKey === input.organizationKey &&
      allowlist.connectionKey === obligation.connectionKey &&
      allowlist.connectionGeneration === obligation.connectionGeneration &&
      connection.organizationKey === input.organizationKey;
    const eligible =
      exact &&
      revision?.tombstone === false &&
      object?.lifecycleState === "live" &&
      membership?.membershipState === "active" &&
      scope?.state === "active" &&
      scope.currentConnectionGeneration === obligation.connectionGeneration &&
      scope.currentAllowlistGeneration === obligation.allowlistGeneration &&
      allowlist?.state === "current" &&
      connection?.status === "active" &&
      connection.connectionGeneration === obligation.connectionGeneration;
    return {
      obligation,
      revision,
      object,
      membership,
      scope,
      allowlist,
      connection,
      exact,
      eligible,
    } as const;
  });

const publishDocumentRevisionEffect = (input: {
  readonly job: RetrievalPublicationJobsDoc;
  readonly now: number;
}) =>
  Effect.gen(function* () {
    const ingestionObligationKey = input.job.ingestionObligationKey;
    if (ingestionObligationKey === undefined)
      return yield* new ValidationFailed({
        field: "ingestionObligationKey",
        message: "Document publication requires one ingestion obligation.",
      });
    const authority = yield* loadDocumentPublicationAuthorityEffect({
      organizationKey: input.job.organizationKey,
      workspaceId: input.job.workspaceId,
      brainKey: input.job.brainKey,
      sourceKey: input.job.sourceKey,
      sourceRevisionKey: input.job.sourceRevisionKey,
      ingestionObligationKey,
    });
    if (
      !authority.exact ||
      authority.obligation === null ||
      authority.revision === null ||
      authority.object === null
    )
      return yield* new RetrievalOriginUnavailable({
        sourceKey: input.job.sourceKey,
        revisionKey: input.job.sourceRevisionKey,
      });
    const reader = yield* DatabaseReader;
    const rows = yield* reader
      .table("documentSourcePassages")
      .index("by_revision_ordinal", (query) =>
        query.eq("documentRevisionKey", input.job.sourceRevisionKey),
      )
      .take(MAX_ENTRIES_PER_PUBLICATION_SET + 1)
      .pipe(Effect.orDie);
    if (rows.length > MAX_ENTRIES_PER_PUBLICATION_SET)
      return yield* new RetrievalPublicationCapacityExceeded({
        entryCount: rows.length,
        tokenCount: 0,
      });
    const revision = authority.revision;
    const obligation = authority.obligation;
    const allowlistGeneration = obligation.allowlistGeneration;
    if (allowlistGeneration === undefined)
      return yield* new ValidationFailed({
        field: "ingestionObligationKey",
        message: "Document obligation has no allowlist generation.",
      });
    const passages = rows.map((passage) => ({
      origin: {
        kind: "document" as const,
        connectionKey: obligation.connectionKey,
        connectorScopeKey: obligation.connectorScopeKey,
        objectKey: input.job.sourceKey,
        revisionKey: input.job.sourceRevisionKey,
      },
      passageKey: `rpass_${sha256Hex(
        JSON.stringify({
          documentRevisionKey: input.job.sourceRevisionKey,
          passageKey: passage.passageKey,
        }),
      )}`,
      startOffset: passage.startOffset,
      endOffset: passage.endOffset,
      title: revision.title,
      headingPath:
        passage.headingPath.length === 0
          ? null
          : passage.headingPath.join(" > "),
      text: passage.text,
      contentHash: `sha256:${passage.contentHash}`,
      locator: passage.sourceLocator,
      sourceModifiedAt: revision.sourceModifiedAt,
      observedAt: revision.observedAt,
    }));
    return yield* commitPreparedPublicationEffect({
      organizationKey: input.job.organizationKey,
      workspaceId: input.job.workspaceId,
      brainKey: input.job.brainKey,
      corpusKey: "documents",
      kind: "document",
      originTable: "documentSourceRevisions",
      sourceKey: input.job.sourceKey,
      sourceRevisionKey: input.job.sourceRevisionKey,
      connectionKey: obligation.connectionKey,
      connectionGeneration: obligation.connectionGeneration,
      connectorScopeKey: obligation.connectorScopeKey,
      authority: "authoritative",
      authorityPolicyKey: "drive-scope-membership",
      policyGeneration: allowlistGeneration,
      lifecycleGeneration: authority.object.incarnation,
      routeGeneration: authority.scope?.scopeGeneration ?? 1,
      ...(input.job.authorityEnvelope?.eligibilityFences === undefined
        ? {}
        : {
            eligibilityFences: input.job.authorityEnvelope.eligibilityFences,
          }),
      revoked: !authority.eligible,
      passages,
      now: input.now,
    });
  });

const terminalPublicationJobStatuses = new Set([
  "succeeded",
  "superseded",
  "revoked",
  "integrity_failure",
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
    | "integrity_failure"
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

type EnqueuePublicationJobInput = Omit<
  RetrievalPublicationJobInput,
  "workspaceId"
> & {
  readonly workspaceId: GenericId<"workspaces">;
};

const authorityFenceSnapshotEffect = (input: {
  readonly identity: Parameters<
    typeof ensureEligibilityFenceEffect
  >[0]["identity"];
  readonly eligible: boolean;
  readonly now: number;
}) =>
  ensureEligibilityFenceEffect(input).pipe(
    Effect.map(({ ref, eligible }): RetrievalPublicationFenceSnapshot => ({
      ...ref,
      eligible,
      controllerKey: input.identity.controllerKey,
    })),
  );

const subjectIdentityForJob = (input: {
  readonly workspaceId: GenericId<"workspaces">;
  readonly brainKey: string;
  readonly corpusKey: string;
  readonly originTable: string;
  readonly kind: "page" | "slack" | "transcript" | "document";
  readonly sourceKey: string;
  readonly connectorScopeKey?: string;
}) =>
  retrievalPublicationSubjectKey({
    workspaceId: String(input.workspaceId),
    brainKey: input.brainKey,
    corpusKey: input.corpusKey,
    originTable: input.originTable,
    kind: input.kind,
    sourceKey: input.sourceKey,
    ...(input.connectorScopeKey === undefined
      ? {}
      : { connectorScopeKey: input.connectorScopeKey }),
  });

const authorityContext = (input: {
  readonly job: EnqueuePublicationJobInput;
  readonly publicationSubjectKey?: string;
  readonly connectorScopeKey?: string;
  readonly configuration?: Omit<
    RetrievalPublicationAuthorityContext["configuration"],
    "requestGeneration"
  >;
  readonly eligibilityFences?: readonly RetrievalPublicationFenceSnapshot[];
  readonly observationKind: "revision" | "rebuild";
  readonly observationKey?: string;
  readonly observationGeneration?: number;
  readonly targetResolutionIntentKey?: GenericId<"slackPublicationTargetIntents">;
  readonly targetResolutionGeneration?: number;
  readonly repairOfJobKey?: string;
  readonly supersedesJobKey?: string;
}): RetrievalPublicationAuthorityContext => {
  const lifecycle = input.eligibilityFences?.find(
    ({ kind }) => kind === "lifecycle",
  );
  return {
    version: 1,
    ...(input.publicationSubjectKey === undefined
      ? {}
      : {
          publicationSubjectKey: input.publicationSubjectKey,
          ...(lifecycle === undefined
            ? {}
            : {
                subjectIncarnationKey:
                  retrievalPublicationSubjectIncarnationKey({
                    publicationSubjectKey: input.publicationSubjectKey,
                    lifecycleFenceKey: lifecycle.fenceKey,
                    lifecycleGeneration: lifecycle.eligibilityGeneration,
                  }),
              }),
        }),
    ...(input.connectorScopeKey === undefined
      ? {}
      : { connectorScopeKey: input.connectorScopeKey }),
    configuration: {
      requestGeneration: input.job.requestGeneration,
      ...input.configuration,
    },
    eligibilityFences: input.eligibilityFences ?? [],
    observationFence: {
      kind: input.observationKind,
      key: input.observationKey ?? input.job.sourceRevisionKey,
      ...(input.observationGeneration === undefined
        ? {}
        : { generation: input.observationGeneration }),
    },
    ...(input.targetResolutionIntentKey === undefined
      ? {}
      : { targetResolutionIntentKey: input.targetResolutionIntentKey }),
    ...(input.targetResolutionGeneration === undefined
      ? {}
      : { targetResolutionGeneration: input.targetResolutionGeneration }),
    ...(input.job.providerTargetResolutionIntentId === undefined ||
    input.job.providerTargetResolutionGeneration === undefined
      ? {}
      : {
          providerTargetResolutionIntentId:
            input.job.providerTargetResolutionIntentId,
          providerTargetResolutionGeneration:
            input.job.providerTargetResolutionGeneration,
        }),
    ...(input.repairOfJobKey === undefined
      ? {}
      : { repairOfJobKey: input.repairOfJobKey }),
    ...(input.supersedesJobKey === undefined
      ? {}
      : { supersedesJobKey: input.supersedesJobKey }),
  };
};

const capturePublicationAuthorityContextEffect = (
  job: EnqueuePublicationJobInput,
  now: number,
  linkage: {
    readonly targetResolutionIntentKey?: GenericId<"slackPublicationTargetIntents">;
    readonly targetResolutionGeneration?: number;
    readonly repairOfJobKey?: string;
    readonly supersedesJobKey?: string;
  } = {},
) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    if (job.originKind === "page") {
      const page = yield* reader
        .table("brainPages")
        .index("by_workspace_page_key", (query) =>
          query.eq("workspaceId", job.workspaceId).eq("pageKey", job.sourceKey),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      const identity = pageLifecycleFenceIdentity({
        organizationKey: job.organizationKey,
        workspaceId: String(job.workspaceId),
        pageKey: job.sourceKey,
      });
      const lifecycleFence = yield* authorityFenceSnapshotEffect({
        identity,
        eligible:
          page !== null &&
          page.status === "active" &&
          page.lifecycle?.state === "active",
        now,
      });
      const publicationSubjectKey = subjectIdentityForJob({
        workspaceId: job.workspaceId,
        brainKey: job.brainKey,
        corpusKey: "brain-pages",
        originTable: "pageRevisions",
        kind: "page",
        sourceKey: job.sourceKey,
      });
      return authorityContext({
        job,
        publicationSubjectKey,
        configuration: {
          policyGeneration: job.page?.policyGeneration ?? 1,
          lifecycleGeneration: lifecycleFence.eligibilityGeneration,
        },
        eligibilityFences: [lifecycleFence],
        observationKind: "revision",
        ...linkage,
      });
    }

    if (job.originKind === "slack") {
      const revision = yield* reader
        .table("sourceRevisions")
        .index("by_source_revision_key", (query) =>
          query
            .eq("organizationKey", job.organizationKey)
            .eq("sourceRevisionKey", job.sourceRevisionKey),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      const artifact = yield* reader
        .table("sourceArtifacts")
        .index("by_org_source_key", (query) =>
          query
            .eq("organizationKey", job.organizationKey)
            .eq("sourceKey", job.sourceKey),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      const policy =
        revision === null
          ? null
          : yield* reader
              .table("channelRoutingPolicies")
              .index("by_channel_active", (query) =>
                query.eq("channelKey", revision.channelKey).eq("active", true),
              )
              .take(2)
              .pipe(
                Effect.map((rows) =>
                  rows.length === 1 &&
                  rows[0]?.mode !== "capture_only" &&
                  rows[0]?.targetBrainKeys.includes(job.brainKey)
                    ? (rows[0] ?? null)
                    : null,
                ),
                Effect.orDie,
              );
      const connection =
        revision === null
          ? null
          : yield* reader
              .table("providerConnections")
              .index("by_connection_key", (query) =>
                query.eq("connectionKey", revision.connectionKey),
              )
              .first()
              .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      const connectorScopeKey = revision?.channelKey ?? artifact?.channelKey;
      const connectionKey = revision?.connectionKey ?? artifact?.connectionKey;
      const fenceSnapshots = yield* Effect.all([
        authorityFenceSnapshotEffect({
          identity: slackSourceLifecycleFenceIdentity({
            organizationKey: job.organizationKey,
            sourceKey: job.sourceKey,
          }),
          eligible:
            revision !== null &&
            artifact !== null &&
            !revision.tombstone &&
            revision.lifecycle.state === "active" &&
            artifact.lifecycle.state === "active",
          now,
        }),
        authorityFenceSnapshotEffect({
          identity: slackPolicyFenceIdentity({
            organizationKey: job.organizationKey,
            channelKey: connectorScopeKey ?? "missing",
            brainKey: job.brainKey,
          }),
          eligible: policy !== null,
          now,
        }),
        authorityFenceSnapshotEffect({
          identity: connectionFenceIdentity({
            organizationKey: job.organizationKey,
            connectionKey: connectionKey ?? "missing",
          }),
          eligible:
            connection !== null &&
            connection.status === "active" &&
            connection.connectionGeneration === revision?.connectionGeneration,
          now,
        }),
      ]);
      const publicationSubjectKey = subjectIdentityForJob({
        workspaceId: job.workspaceId,
        brainKey: job.brainKey,
        corpusKey: "slack",
        originTable: "sourceRevisions",
        kind: "slack",
        sourceKey: job.sourceKey,
        ...(connectorScopeKey === undefined ? {} : { connectorScopeKey }),
      });
      return authorityContext({
        job,
        publicationSubjectKey,
        ...(connectorScopeKey === undefined ? {} : { connectorScopeKey }),
        configuration: {
          policyGeneration: policy?.policyEpoch ?? 1,
          routeGeneration: policy?.policyEpoch ?? 1,
          lifecycleGeneration: artifact?.lifecycle.generation ?? 1,
          connectionGeneration: revision?.connectionGeneration ?? 1,
        },
        eligibilityFences: fenceSnapshots,
        observationKind: "revision",
        ...linkage,
      });
    }

    if (job.originKind === "transcript") {
      const revision = yield* reader
        .table("sourceUnitRevisions")
        .index("by_unit_revision_key", (query) =>
          query
            .eq("organizationKey", job.organizationKey)
            .eq("unitRevisionKey", job.sourceRevisionKey),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      const unit = yield* reader
        .table("sourceUnits")
        .index("by_unit_key", (query) =>
          query
            .eq("organizationKey", job.organizationKey)
            .eq("unitKey", job.sourceKey),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      const routes =
        revision === null
          ? []
          : yield* reader
              .table("callRoutingProposals")
              .index("by_org_revision", (query) =>
                query
                  .eq("organizationKey", job.organizationKey)
                  .eq("unitRevisionKey", revision.unitRevisionKey),
              )
              .take(100)
              .pipe(Effect.orDie);
      const route =
        routes
          .filter(
            (candidate) =>
              candidate.outcome === "routed" &&
              candidate.brainKey === job.brainKey &&
              (candidate.status === "current" ||
                candidate.status === "accepted"),
          )
          .sort(
            (left, right) => right.routeGeneration - left.routeGeneration,
          )[0] ?? null;
      const connection =
        unit === null
          ? null
          : yield* reader
              .table("providerConnections")
              .index("by_connection_key", (query) =>
                query.eq("connectionKey", unit.connectionKey),
              )
              .first()
              .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      const fenceSnapshots = yield* Effect.all([
        authorityFenceSnapshotEffect({
          identity: transcriptUnitLifecycleFenceIdentity({
            organizationKey: job.organizationKey,
            unitKey: job.sourceKey,
          }),
          eligible:
            revision !== null &&
            unit !== null &&
            !revision.tombstone &&
            unit.lifecycle.state === "active",
          now,
        }),
        authorityFenceSnapshotEffect({
          identity: transcriptRouteFenceIdentity({
            organizationKey: job.organizationKey,
            unitKey: job.sourceKey,
            brainKey: job.brainKey,
          }),
          eligible: route !== null,
          now,
        }),
        authorityFenceSnapshotEffect({
          identity: connectionFenceIdentity({
            organizationKey: job.organizationKey,
            connectionKey: unit?.connectionKey ?? "missing",
          }),
          eligible:
            connection !== null &&
            connection.status === "active" &&
            connection.connectionGeneration === unit?.connectionGeneration,
          now,
        }),
      ]);
      const publicationSubjectKey = subjectIdentityForJob({
        workspaceId: job.workspaceId,
        brainKey: job.brainKey,
        corpusKey: "transcripts",
        originTable: "sourceUnitRevisions",
        kind: "transcript",
        sourceKey: job.sourceKey,
      });
      return authorityContext({
        job,
        publicationSubjectKey,
        configuration: {
          policyGeneration: 1,
          routeGeneration: route?.routeGeneration ?? 1,
          lifecycleGeneration: unit?.lifecycle.generation ?? 1,
          connectionGeneration: unit?.connectionGeneration ?? 1,
        },
        eligibilityFences: fenceSnapshots,
        observationKind: "revision",
        ...linkage,
      });
    }

    if (job.originKind === "document") {
      const ingestionObligationKey = job.ingestionObligationKey;
      const documentAuthority =
        ingestionObligationKey === undefined
          ? null
          : yield* loadDocumentPublicationAuthorityEffect({
              organizationKey: job.organizationKey,
              workspaceId: job.workspaceId,
              brainKey: job.brainKey,
              sourceKey: job.sourceKey,
              sourceRevisionKey: job.sourceRevisionKey,
              ingestionObligationKey,
            });
      const obligation = documentAuthority?.obligation;
      const connectorScopeKey = obligation?.connectorScopeKey ?? "missing";
      const connectionKey = obligation?.connectionKey ?? "missing";
      const fenceSnapshots = yield* Effect.all([
        authorityFenceSnapshotEffect({
          identity: documentLifecycleFenceIdentity({
            organizationKey: job.organizationKey,
            documentObjectKey: job.sourceKey,
          }),
          eligible:
            documentAuthority?.exact === true &&
            documentAuthority.revision?.tombstone === false &&
            documentAuthority.object?.lifecycleState === "live" &&
            documentAuthority.membership?.membershipState === "active",
          now,
        }),
        authorityFenceSnapshotEffect({
          identity: connectorScopeFenceIdentity({
            organizationKey: job.organizationKey,
            connectorScopeKey,
          }),
          eligible:
            documentAuthority?.scope?.state === "active" &&
            documentAuthority.scope.currentConnectionGeneration ===
              obligation?.connectionGeneration,
          now,
        }),
        authorityFenceSnapshotEffect({
          identity: connectorAllowlistFenceIdentity({
            organizationKey: job.organizationKey,
            connectorScopeKey,
          }),
          eligible:
            documentAuthority?.allowlist?.state === "current" &&
            documentAuthority.allowlist.allowlistGeneration ===
              obligation?.allowlistGeneration,
          now,
        }),
        authorityFenceSnapshotEffect({
          identity: connectionFenceIdentity({
            organizationKey: job.organizationKey,
            connectionKey,
          }),
          eligible:
            documentAuthority?.connection?.status === "active" &&
            documentAuthority.connection.connectionGeneration ===
              obligation?.connectionGeneration,
          now,
        }),
      ]);
      const publicationSubjectKey = subjectIdentityForJob({
        workspaceId: job.workspaceId,
        brainKey: job.brainKey,
        corpusKey: "documents",
        originTable: "documentSourceRevisions",
        kind: "document",
        sourceKey: job.sourceKey,
        connectorScopeKey,
      });
      return authorityContext({
        job,
        publicationSubjectKey,
        connectorScopeKey,
        configuration: {
          policyGeneration: obligation?.allowlistGeneration ?? 1,
          routeGeneration: documentAuthority?.scope?.scopeGeneration ?? 1,
          lifecycleGeneration: documentAuthority?.object?.incarnation ?? 1,
          connectionGeneration: obligation?.connectionGeneration ?? 1,
        },
        eligibilityFences: fenceSnapshots,
        observationKind: "revision",
        observationGeneration: documentAuthority?.revision?.incarnation ?? 1,
        ...linkage,
      });
    }

    const fenceSnapshots: RetrievalPublicationFenceSnapshot[] = [];
    if (
      job.originKind === "slack_rebuild" &&
      job.sourceRevisionKey.startsWith("policy:")
    )
      fenceSnapshots.push(
        yield* authorityFenceSnapshotEffect({
          identity: slackPolicyFenceIdentity({
            organizationKey: job.organizationKey,
            channelKey: job.sourceKey,
            brainKey: job.brainKey,
          }),
          eligible: true,
          now,
        }),
      );
    if (
      (job.originKind === "slack_rebuild" ||
        job.originKind === "transcript_rebuild") &&
      job.sourceRevisionKey.startsWith("connection:")
    )
      fenceSnapshots.push(
        yield* authorityFenceSnapshotEffect({
          identity: connectionFenceIdentity({
            organizationKey: job.organizationKey,
            connectionKey: job.sourceKey,
          }),
          eligible: job.sourceRevisionKey.includes(":active:"),
          now,
        }),
      );
    return authorityContext({
      job,
      configuration: {
        ...(job.originKind === "page_rebuild" ||
        job.sourceRevisionKey.startsWith("policy:")
          ? { policyGeneration: job.requestGeneration }
          : {}),
        ...(job.sourceRevisionKey.startsWith("connection:")
          ? { connectionGeneration: job.requestGeneration }
          : {}),
      },
      eligibilityFences: fenceSnapshots,
      observationKind: "rebuild",
      ...(job.rebuildRunKey === undefined
        ? {}
        : { observationKey: job.rebuildRunKey }),
      observationGeneration: job.rebuildRunGeneration ?? job.requestGeneration,
      ...linkage,
    });
  });

const authorityContextFromEnvelope = (
  envelope: NonNullable<RetrievalPublicationJobsDoc["authorityEnvelope"]>,
): RetrievalPublicationAuthorityContext => ({
  version: envelope.version,
  ...(envelope.publicationSubjectKey === undefined
    ? {}
    : { publicationSubjectKey: envelope.publicationSubjectKey }),
  ...(envelope.subjectIncarnationKey === undefined
    ? {}
    : { subjectIncarnationKey: envelope.subjectIncarnationKey }),
  ...(envelope.connectorScopeKey === undefined
    ? {}
    : { connectorScopeKey: envelope.connectorScopeKey }),
  configuration: {
    requestGeneration: envelope.configuration.requestGeneration,
    ...(envelope.configuration.policyGeneration === undefined
      ? {}
      : { policyGeneration: envelope.configuration.policyGeneration }),
    ...(envelope.configuration.routeGeneration === undefined
      ? {}
      : { routeGeneration: envelope.configuration.routeGeneration }),
    ...(envelope.configuration.lifecycleGeneration === undefined
      ? {}
      : { lifecycleGeneration: envelope.configuration.lifecycleGeneration }),
    ...(envelope.configuration.connectionGeneration === undefined
      ? {}
      : {
          connectionGeneration: envelope.configuration.connectionGeneration,
        }),
  },
  eligibilityFences: envelope.eligibilityFences,
  observationFence: {
    kind: envelope.observationFence.kind,
    key: envelope.observationFence.key,
    ...(envelope.observationFence.generation === undefined
      ? {}
      : { generation: envelope.observationFence.generation }),
  },
  ...(envelope.targetResolutionIntentKey === undefined
    ? {}
    : { targetResolutionIntentKey: envelope.targetResolutionIntentKey }),
  ...(envelope.targetResolutionGeneration === undefined
    ? {}
    : { targetResolutionGeneration: envelope.targetResolutionGeneration }),
  ...(envelope.providerTargetResolutionIntentId === undefined
    ? {}
    : {
        providerTargetResolutionIntentId:
          envelope.providerTargetResolutionIntentId,
      }),
  ...(envelope.providerTargetResolutionGeneration === undefined
    ? {}
    : {
        providerTargetResolutionGeneration:
          envelope.providerTargetResolutionGeneration,
      }),
  ...(envelope.repairOfJobKey === undefined
    ? {}
    : { repairOfJobKey: envelope.repairOfJobKey }),
  ...(envelope.supersedesJobKey === undefined
    ? {}
    : { supersedesJobKey: envelope.supersedesJobKey }),
});

const jobIdentityInput = (job: RetrievalPublicationJobsDoc) => ({
  organizationKey: job.organizationKey,
  workspaceId: String(job.workspaceId),
  brainKey: job.brainKey,
  originKind: job.originKind,
  ...(job.effectClass === undefined ? {} : { effectClass: job.effectClass }),
  ...(job.operation === undefined ? {} : { operation: job.operation }),
  sourceKey: job.sourceKey,
  sourceRevisionKey: job.sourceRevisionKey,
  ...(job.ingestionObligationKey === undefined
    ? {}
    : { ingestionObligationKey: job.ingestionObligationKey }),
  ...(job.providerTargetResolutionIntentId === undefined
    ? {}
    : {
        providerTargetResolutionIntentId: job.providerTargetResolutionIntentId,
      }),
  ...(job.providerTargetResolutionGeneration === undefined
    ? {}
    : {
        providerTargetResolutionGeneration:
          job.providerTargetResolutionGeneration,
      }),
  requestGeneration: job.requestGeneration,
  ...(job.rebuildRunKey === undefined
    ? {}
    : { rebuildRunKey: job.rebuildRunKey }),
  ...(job.rebuildRunGeneration === undefined
    ? {}
    : { rebuildRunGeneration: job.rebuildRunGeneration }),
  ...(job.rebuildLedgerHighWater === undefined
    ? {}
    : { rebuildLedgerHighWater: job.rebuildLedgerHighWater }),
  ...(job.rebuildPauseEpoch === undefined
    ? {}
    : { rebuildPauseEpoch: job.rebuildPauseEpoch }),
  ...(job.rebuildPredecessorDigest === undefined
    ? {}
    : { rebuildPredecessorDigest: job.rebuildPredecessorDigest }),
  ...(job.parentRebuildJobKey === undefined
    ? {}
    : { parentRebuildJobKey: job.parentRebuildJobKey }),
  ...(job.page === undefined ? {} : { page: job.page }),
  ...(job.rebuild === undefined
    ? {}
    : {
        rebuild: {
          limit: job.rebuild.limit,
          ...(job.rebuild.phase === undefined
            ? {}
            : { phase: job.rebuild.phase }),
          ...(job.rebuild.phaseHighWater === undefined
            ? {}
            : { phaseHighWater: job.rebuild.phaseHighWater }),
          ...(job.rebuild.afterSourceKey === undefined
            ? {}
            : { afterSourceKey: job.rebuild.afterSourceKey }),
          ...(job.rebuild.discoveredCount === undefined
            ? {}
            : { discoveredCount: job.rebuild.discoveredCount }),
          ...(job.rebuild.publishedCount === undefined
            ? {}
            : { publishedCount: job.rebuild.publishedCount }),
        },
      }),
});

const rebuildChildManifestMatchesJob = (
  manifest: RetrievalRebuildChildrenDoc,
  job: RetrievalPublicationJobsDoc,
) =>
  manifest.childJobKey === job.jobKey &&
  manifest.rebuildRunKey === job.rebuildRunKey &&
  manifest.parentBatchJobKey === job.parentRebuildJobKey &&
  manifest.originKind === job.originKind &&
  manifest.operation === job.operation &&
  manifest.sourceKey === job.sourceKey &&
  manifest.sourceRevisionKey === job.sourceRevisionKey;

const blockRebuildChildManifestEffect = (
  manifest: RetrievalRebuildChildrenDoc,
  at: number,
  blockingErrorTag: string,
) =>
  Effect.gen(function* () {
    if (manifest.status !== "pending") return;
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const runs = yield* reader
      .table("retrievalRebuildRuns")
      .index("by_run_key", (query) =>
        query.eq("rebuildRunKey", manifest.rebuildRunKey),
      )
      .take(2)
      .pipe(Effect.orDie);
    const run = runs.length === 1 ? runs[0] : undefined;
    yield* writer
      .table("retrievalRebuildChildren")
      .patch(manifest._id, {
        status: "blocked",
        updatedAt: at,
      })
      .pipe(Effect.orDie);
    if (run === undefined) return;
    yield* writer
      .table("retrievalRebuildRuns")
      .patch(run._id, {
        status: "blocked",
        terminalChildCount: run.terminalChildCount + 1,
        blockingChildCount: run.blockingChildCount + 1,
        blockingErrorTag,
        updatedAt: at,
      })
      .pipe(Effect.orDie);
  });

const blockUnmanifestedRebuildChildEffect = (
  job: RetrievalPublicationJobsDoc,
  at: number,
) =>
  Effect.gen(function* () {
    const parentRebuildJobKey = job.parentRebuildJobKey;
    if (parentRebuildJobKey === undefined) return;
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const parents = yield* reader
      .table("retrievalPublicationJobs")
      .index("by_job_key", (query) => query.eq("jobKey", parentRebuildJobKey))
      .take(2)
      .pipe(Effect.orDie);
    const parent = parents.length === 1 ? parents[0] : undefined;
    if (parent?.rebuildRunKey === undefined) return;
    const rebuildRunKey = parent.rebuildRunKey;
    const runs = yield* reader
      .table("retrievalRebuildRuns")
      .index("by_run_key", (query) => query.eq("rebuildRunKey", rebuildRunKey))
      .take(2)
      .pipe(Effect.orDie);
    const run = runs.length === 1 ? runs[0] : undefined;
    if (run === undefined || run.status === "complete") return;
    yield* writer
      .table("retrievalRebuildRuns")
      .patch(run._id, {
        status: "blocked",
        blockingChildCount: run.blockingChildCount + 1,
        blockingErrorTag: "RebuildChildManifestMissing",
        updatedAt: at,
      })
      .pipe(Effect.orDie);
  });

const recordRebuildChildTerminalEffect = (
  job: RetrievalPublicationJobsDoc,
  outcome: "published" | "revoked" | "superseded" | "blocked",
  at: number,
) =>
  Effect.gen(function* () {
    if (job.parentRebuildJobKey === undefined) return;
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const manifests = yield* reader
      .table("retrievalRebuildChildren")
      .index("by_child_job_key", (query) => query.eq("childJobKey", job.jobKey))
      .take(2)
      .pipe(Effect.orDie);
    if (manifests.length !== 1) {
      yield* blockUnmanifestedRebuildChildEffect(job, at);
      return;
    }
    const manifest = manifests[0];
    if (manifest === undefined || manifest.status !== "pending") return;
    if (!rebuildChildManifestMatchesJob(manifest, job)) {
      yield* blockRebuildChildManifestEffect(
        manifest,
        at,
        "RebuildChildManifestMismatch",
      );
      return;
    }
    const runs = yield* reader
      .table("retrievalRebuildRuns")
      .index("by_run_key", (query) =>
        query.eq("rebuildRunKey", manifest.rebuildRunKey),
      )
      .take(2)
      .pipe(Effect.orDie);
    const run = runs.length === 1 ? runs[0] : undefined;
    if (run === undefined) {
      yield* writer
        .table("retrievalRebuildChildren")
        .patch(manifest._id, { status: "blocked", updatedAt: at })
        .pipe(Effect.orDie);
      return;
    }
    yield* writer
      .table("retrievalRebuildChildren")
      .patch(manifest._id, { status: outcome, updatedAt: at })
      .pipe(Effect.orDie);
    yield* writer
      .table("retrievalRebuildRuns")
      .patch(run._id, {
        terminalChildCount: run.terminalChildCount + 1,
        ...(outcome === "published"
          ? { publishedChildCount: run.publishedChildCount + 1 }
          : {}),
        ...(outcome === "revoked"
          ? { revokedChildCount: run.revokedChildCount + 1 }
          : {}),
        ...(outcome === "superseded"
          ? { supersededChildCount: run.supersededChildCount + 1 }
          : {}),
        ...(outcome === "blocked"
          ? {
              status: "blocked" as const,
              blockingChildCount: run.blockingChildCount + 1,
              blockingErrorTag: "RebuildChildBlocked",
            }
          : {}),
        updatedAt: at,
      })
      .pipe(Effect.orDie);
  });

const markRebuildRunTerminalEffect = (
  job: RetrievalPublicationJobsDoc,
  status: "blocked" | "superseded",
  lastErrorTag: string,
  at: number,
) =>
  Effect.gen(function* () {
    if (!job.originKind.endsWith("_rebuild") || job.rebuildRunKey === undefined)
      return;
    const rebuildRunKey = job.rebuildRunKey;
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const runs = yield* reader
      .table("retrievalRebuildRuns")
      .index("by_run_key", (query) => query.eq("rebuildRunKey", rebuildRunKey))
      .take(2)
      .pipe(Effect.orDie);
    if (runs.length !== 1) return;
    const run = runs[0];
    if (
      run === undefined ||
      run.status === "complete" ||
      run.status === "superseded"
    )
      return;
    yield* writer
      .table("retrievalRebuildRuns")
      .patch(run._id, {
        status,
        ...(status === "blocked" ? { blockingErrorTag: lastErrorTag } : {}),
        updatedAt: at,
      })
      .pipe(Effect.orDie);
  });

const supersedePublicationJob = (
  job: RetrievalPublicationJobsDoc,
  at: number,
  lastErrorTag: string,
) =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
    yield* recordRebuildChildTerminalEffect(job, "superseded", at);
    yield* markRebuildRunTerminalEffect(job, "superseded", lastErrorTag, at);
    const completed = {
      status: "superseded" as const,
      attemptCount: job.attemptCount,
      nextAttemptAt: at,
      lastErrorTag,
      completedAt: at,
      updatedAt: at,
    };
    yield* writer
      .table("retrievalPublicationJobs")
      .patch(job._id, completed)
      .pipe(Effect.orDie);
    yield* transitionLiveCaptureChildEffect(
      job,
      "policy_excluded",
      at,
      lastErrorTag,
    );
    return publicationJobResult({ ...job, ...completed });
  });

const deferLegacyPublicationJob = (
  job: RetrievalPublicationJobsDoc,
  at: number,
  lastErrorTag: string,
) =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
    const deferred = {
      status: "retry_wait" as const,
      attemptCount: job.attemptCount,
      nextAttemptAt: at + 24 * 60 * 60 * 1_000,
      lastErrorTag,
      updatedAt: at,
    };
    yield* writer
      .table("retrievalPublicationJobs")
      .patch(job._id, deferred)
      .pipe(Effect.orDie);
    return publicationJobResult({ ...job, ...deferred });
  });

const publicationAuthorityLinkageIsValid = (
  job: RetrievalPublicationJobsDoc,
  envelope: NonNullable<RetrievalPublicationJobsDoc["authorityEnvelope"]>,
) => {
  const rebuild = job.originKind.endsWith("_rebuild");
  const effectClass = job.effectClass;
  return !(
    effectClass === undefined ||
    (effectClass === "direct_publication" && rebuild) ||
    (effectClass === "rebuild_batch" && !rebuild) ||
    (effectClass === "rebuild_batch" &&
      (job.rebuildRunKey === undefined ||
        job.rebuildRunGeneration === undefined ||
        job.rebuildLedgerHighWater === undefined ||
        job.rebuildPauseEpoch === undefined ||
        job.rebuildPredecessorDigest === undefined)) ||
    (effectClass === "direct_publication" &&
      (envelope.repairOfJobKey !== undefined ||
        envelope.supersedesJobKey !== undefined)) ||
    (effectClass === "rebuild_batch" &&
      (envelope.repairOfJobKey !== undefined ||
        envelope.supersedesJobKey !== undefined)) ||
    (effectClass === "attributed_repair" &&
      (envelope.repairOfJobKey === undefined ||
        envelope.supersedesJobKey !== undefined)) ||
    (effectClass === "migration_replacement" &&
      (envelope.supersedesJobKey === undefined ||
        envelope.repairOfJobKey !== undefined)) ||
    (envelope.repairOfJobKey !== undefined &&
      envelope.supersedesJobKey !== undefined) ||
    (rebuild &&
      (envelope.publicationSubjectKey !== undefined ||
        envelope.subjectIncarnationKey !== undefined)) ||
    (!rebuild &&
      (envelope.publicationSubjectKey === undefined ||
        envelope.subjectIncarnationKey === undefined)) ||
    (rebuild && envelope.observationFence.kind !== "rebuild") ||
    (rebuild && envelope.observationFence.key !== job.rebuildRunKey) ||
    (rebuild &&
      envelope.observationFence.generation !== job.rebuildRunGeneration) ||
    (!rebuild && envelope.observationFence.kind !== "revision") ||
    envelope.configuration.requestGeneration !== job.requestGeneration ||
    (!rebuild && envelope.observationFence.key !== job.sourceRevisionKey) ||
    (envelope.targetResolutionIntentKey !== undefined &&
      job.originKind !== "slack") ||
    (envelope.providerTargetResolutionIntentId === undefined) !==
      (envelope.providerTargetResolutionGeneration === undefined) ||
    (job.providerTargetResolutionIntentId === undefined) !==
      (job.providerTargetResolutionGeneration === undefined) ||
    envelope.providerTargetResolutionIntentId !==
      job.providerTargetResolutionIntentId ||
    envelope.providerTargetResolutionGeneration !==
      job.providerTargetResolutionGeneration ||
    (envelope.providerTargetResolutionIntentId !== undefined &&
      (job.ingestionObligationKey === undefined ||
        rebuild ||
        !["slack", "transcript", "document"].includes(job.originKind)))
  );
};

const publicationJobAuthorityIdentity = (job: RetrievalPublicationJobsDoc) =>
  JSON.stringify({
    organizationKey: job.organizationKey,
    workspaceId: String(job.workspaceId),
    brainKey: job.brainKey,
    originKind: job.originKind,
    sourceKey: job.sourceKey,
    sourceRevisionKey: job.sourceRevisionKey,
    ingestionObligationKey: job.ingestionObligationKey ?? null,
    requestGeneration: job.requestGeneration,
    page: job.page ?? null,
    rebuild: job.rebuild ?? null,
    targetResolutionIntentKey: job.targetResolutionIntentKey ?? null,
    providerTargetResolutionIntentId:
      job.providerTargetResolutionIntentId ?? null,
    providerTargetResolutionGeneration:
      job.providerTargetResolutionGeneration ?? null,
  });

const unattributedAuthorityContext = (
  envelope: NonNullable<RetrievalPublicationJobsDoc["authorityEnvelope"]>,
) => {
  const context = { ...authorityContextFromEnvelope(envelope) };
  delete context.repairOfJobKey;
  delete context.supersedesJobKey;
  return context;
};

const linkedPublicationAuthorityIsValidEffect = (
  job: RetrievalPublicationJobsDoc,
  envelope: NonNullable<RetrievalPublicationJobsDoc["authorityEnvelope"]>,
) =>
  Effect.gen(function* () {
    const linkedJobKey =
      envelope.repairOfJobKey ?? envelope.supersedesJobKey ?? null;
    if (linkedJobKey === null) return true;
    if (linkedJobKey === job.jobKey) return false;
    const reader = yield* DatabaseReader;
    const linkedJobs = yield* reader
      .table("retrievalPublicationJobs")
      .index("by_job_key", (query) => query.eq("jobKey", linkedJobKey))
      .take(2)
      .pipe(Effect.orDie);
    if (linkedJobs.length !== 1) return false;
    const linked = linkedJobs[0];
    if (linked === undefined || linked.authorityEnvelope === undefined)
      return false;
    if (
      publicationJobAuthorityIdentity(job) !==
        publicationJobAuthorityIdentity(linked) ||
      retrievalPublicationAuthorityDigest(
        unattributedAuthorityContext(envelope),
      ) !==
        retrievalPublicationAuthorityDigest(
          unattributedAuthorityContext(linked.authorityEnvelope),
        )
    )
      return false;
    if (job.effectClass === "attributed_repair")
      return linked.status === "dead_letter";
    if (job.effectClass === "migration_replacement")
      return (
        linked.status === "superseded" &&
        linked.supersededByJobKey === job.jobKey
      );
    return false;
  });

const ingestionObligationLinkageIsValidEffect = (
  job: RetrievalPublicationJobsDoc,
) =>
  Effect.gen(function* () {
    const ingestionObligationKey = job.ingestionObligationKey;
    if (ingestionObligationKey === undefined)
      return job.originKind !== "document";
    if (
      (job.effectClass !== "direct_publication" &&
        job.effectClass !== "attributed_repair") ||
      job.operation !== "publish"
    )
      return false;
    const reader = yield* DatabaseReader;
    const obligations = yield* reader
      .table("ingestionObligations")
      .index("by_ingestion_obligation_key", (query) =>
        query.eq("ingestionObligationKey", ingestionObligationKey),
      )
      .take(2)
      .pipe(Effect.orDie);
    const obligation = obligations[0];
    if (
      obligations.length !== 1 ||
      obligation === undefined ||
      obligation.cause !== "observation" ||
      obligation.organizationKey !== job.organizationKey ||
      obligation.workspaceId !== job.workspaceId ||
      obligation.brainKey !== job.brainKey ||
      obligation.originKind !== job.originKind ||
      obligation.originKey !== job.sourceKey ||
      obligation.originRevisionKey !== job.sourceRevisionKey ||
      (obligation.state !== "publication_pending" &&
        obligation.state !== "retry_wait") ||
      obligation.publicationJobKeys.length !== 1 ||
      obligation.publicationJobKeys[0] !== job.jobKey ||
      obligation.targetResolutionIntentId === undefined ||
      job.providerTargetResolutionIntentId !==
        obligation.targetResolutionIntentId ||
      job.providerTargetResolutionGeneration === undefined
    )
      return false;
    const intent = yield* reader
      .table("providerTargetResolutionIntents")
      .get(obligation.targetResolutionIntentId)
      .pipe(Effect.orDie);
    if (intent?.authorityKind === "live_capture") {
      if (
        obligation.authorityKind !== "live_capture" ||
        obligation.parentIngestionObligationKey === undefined ||
        intent.targetResolutionIntentKey !==
          obligation.targetResolutionIntentKey ||
        intent.ingestionObligationKey !==
          obligation.parentIngestionObligationKey ||
        intent.resolutionGeneration !==
          job.providerTargetResolutionGeneration ||
        intent.status !== "succeeded" ||
        intent.organizationKey !== job.organizationKey ||
        intent.originKind !== job.originKind ||
        intent.originKey !== job.sourceKey ||
        intent.originRevisionKey !== job.sourceRevisionKey ||
        intent.captureKey === undefined ||
        intent.capturedAt === undefined ||
        intent.requiredScopeIntentKey !== undefined ||
        intent.pageChunkKey !== undefined ||
        intent.pageEnvelopeKey !== undefined ||
        intent.reconciliationRunKey !== undefined ||
        intent.runGeneration !== undefined ||
        intent.workspaceId !== undefined ||
        intent.brainKey !== undefined ||
        intent.allowlistGeneration !== undefined ||
        intent.ledgerSequence !== undefined ||
        job.authorityDigest === undefined
      )
        return false;
      const authority = {
        authorityKind: "live_capture",
        targetResolutionIntentKey: intent.targetResolutionIntentKey,
        ingestionObligationKey: intent.ingestionObligationKey,
        organizationKey: intent.organizationKey,
        corpusKey: intent.corpusKey,
        providerKind: intent.providerKind,
        connectorScopeKey: intent.connectorScopeKey,
        connectionKey: intent.connectionKey,
        connectionGeneration: intent.connectionGeneration,
        membershipKey: intent.membershipKey,
        originKind: intent.originKind,
        originKey: intent.originKey,
        originRevisionKey: intent.originRevisionKey,
        observationDigest: intent.observationDigest,
        resolutionGeneration: intent.resolutionGeneration,
        captureKey: intent.captureKey,
        capturedAt: intent.capturedAt,
      } satisfies ProviderTargetResolutionAuthority;
      if (
        intent.authorityDigest !==
        providerTargetResolutionAuthorityDigest(authority)
      )
        return false;
      const target = {
        workspaceId: String(job.workspaceId),
        brainKey: job.brainKey,
        jobKey: job.jobKey,
        authorityDigest: job.authorityDigest,
        childIngestionObligationKey: obligation.ingestionObligationKey,
      };
      const storedTarget = intent.targets.find(
        (candidate) =>
          candidate.workspaceId === target.workspaceId &&
          candidate.brainKey === target.brainKey,
      );
      return (
        storedTarget?.jobKey === target.jobKey &&
        storedTarget.authorityDigest === target.authorityDigest &&
        storedTarget.childIngestionObligationKey ===
          target.childIngestionObligationKey &&
        intent.targetCount === intent.targets.length &&
        intent.targetDigest ===
          providerTargetResolutionPopulationDigest(intent.targets)
      );
    }
    if (
      intent === null ||
      intent.targetResolutionIntentKey !==
        obligation.targetResolutionIntentKey ||
      intent.ingestionObligationKey !== obligation.ingestionObligationKey ||
      intent.resolutionGeneration !== job.providerTargetResolutionGeneration ||
      intent.status !== "succeeded" ||
      intent.organizationKey !== job.organizationKey ||
      intent.workspaceId !== job.workspaceId ||
      intent.brainKey !== job.brainKey ||
      (intent.authorityKind !== undefined &&
        intent.authorityKind !== "reconciliation_page") ||
      intent.requiredScopeIntentKey === undefined ||
      intent.pageChunkKey === undefined ||
      intent.pageEnvelopeKey === undefined ||
      intent.reconciliationRunKey === undefined ||
      intent.runGeneration === undefined ||
      intent.allowlistGeneration === undefined ||
      intent.ledgerSequence === undefined ||
      intent.originKind !== job.originKind ||
      intent.originKey !== job.sourceKey ||
      intent.originRevisionKey !== job.sourceRevisionKey
    )
      return false;
    const authority = {
      authorityKind: "reconciliation_page",
      targetResolutionIntentKey: intent.targetResolutionIntentKey,
      ingestionObligationKey: intent.ingestionObligationKey,
      requiredScopeIntentKey: intent.requiredScopeIntentKey,
      pageChunkKey: intent.pageChunkKey,
      pageEnvelopeKey: intent.pageEnvelopeKey,
      reconciliationRunKey: intent.reconciliationRunKey,
      runGeneration: intent.runGeneration,
      organizationKey: intent.organizationKey,
      workspaceId: String(intent.workspaceId),
      brainKey: intent.brainKey,
      corpusKey: intent.corpusKey,
      providerKind: intent.providerKind,
      connectorScopeKey: intent.connectorScopeKey,
      connectionKey: intent.connectionKey,
      connectionGeneration: intent.connectionGeneration,
      allowlistGeneration: intent.allowlistGeneration,
      membershipKey: intent.membershipKey,
      originKind: intent.originKind,
      originKey: intent.originKey,
      originRevisionKey: intent.originRevisionKey,
      ledgerSequence: intent.ledgerSequence,
      observationDigest: intent.observationDigest,
      resolutionGeneration: intent.resolutionGeneration,
    } satisfies ProviderTargetResolutionAuthority;
    if (
      intent.authorityDigest !==
      providerTargetResolutionAuthorityDigest(authority)
    )
      return false;
    const intentJobs = yield* reader
      .table("retrievalPublicationJobs")
      .index("by_provider_target_resolution_intent_job", (query) =>
        query.eq("providerTargetResolutionIntentId", intent._id),
      )
      .take(101)
      .pipe(Effect.orDie);
    if (
      intentJobs.length > 100 ||
      job.authorityDigest === undefined ||
      !intentJobs.every(
        (candidate) =>
          candidate.authorityDigest !== undefined &&
          candidate.providerTargetResolutionIntentId === intent._id &&
          candidate.providerTargetResolutionGeneration ===
            intent.resolutionGeneration &&
          candidate.ingestionObligationKey ===
            obligation.ingestionObligationKey &&
          publicationJobAuthorityIdentity(candidate) ===
            publicationJobAuthorityIdentity(job),
      )
    )
      return false;
    const lineageValid =
      job.effectClass === "direct_publication"
        ? intentJobs.length === 1 && intentJobs[0]?._id === job._id
        : (() => {
            const predecessorKey = job.authorityEnvelope?.repairOfJobKey;
            if (
              job.effectClass !== "attributed_repair" ||
              predecessorKey === undefined ||
              predecessorKey === job.jobKey ||
              intentJobs.length !== 2 ||
              !intentJobs.some((candidate) => candidate._id === job._id)
            )
              return false;
            const predecessor = intentJobs.find(
              (candidate) => candidate.jobKey === predecessorKey,
            );
            return (
              predecessor?.effectClass === "direct_publication" &&
              predecessor.status === "dead_letter"
            );
          })();
    if (!lineageValid) return false;
    const target = {
      workspaceId: String(job.workspaceId),
      brainKey: job.brainKey,
      jobKey: job.jobKey,
      authorityDigest: job.authorityDigest,
    };
    return (
      intent.targetCount === 1 &&
      intent.targets.length === 1 &&
      intent.targets[0]?.workspaceId === target.workspaceId &&
      intent.targets[0]?.brainKey === target.brainKey &&
      intent.targets[0]?.jobKey === target.jobKey &&
      intent.targets[0]?.authorityDigest === target.authorityDigest &&
      intent.targetDigest === providerTargetResolutionPopulationDigest([target])
    );
  });

const transitionLiveCaptureChildEffect = (
  job: RetrievalPublicationJobsDoc,
  state: "retry_wait" | "complete" | "policy_excluded" | "failed",
  at: number,
  errorTag: string | null,
) =>
  Effect.gen(function* () {
    if (
      job.ingestionObligationKey === undefined ||
      job.providerTargetResolutionIntentId === undefined
    )
      return;
    const ingestionObligationKey = job.ingestionObligationKey;
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const intent = yield* reader
      .table("providerTargetResolutionIntents")
      .get(job.providerTargetResolutionIntentId)
      .pipe(Effect.orDie);
    if (intent?.authorityKind !== "live_capture") return;
    const rows = yield* reader
      .table("ingestionObligations")
      .index("by_ingestion_obligation_key", (query) =>
        query.eq("ingestionObligationKey", ingestionObligationKey),
      )
      .take(2)
      .pipe(Effect.orDie);
    const child = rows[0];
    if (
      rows.length !== 1 ||
      child === undefined ||
      child.authorityKind !== "live_capture" ||
      child.parentIngestionObligationKey !== intent.ingestionObligationKey ||
      child.targetResolutionIntentId !== intent._id ||
      child.publicationJobKeys.length !== 1 ||
      child.publicationJobKeys[0] !== job.jobKey
    )
      return yield* Effect.dieMessage(
        "Live-capture publication child authority conflicts.",
      );
    const terminal = state !== "retry_wait";
    yield* writer
      .table("ingestionObligations")
      .patch(child._id, {
        state,
        errorTag,
        terminalAt: terminal ? at : null,
        updatedAt: at,
      })
      .pipe(Effect.orDie);
    yield* progressLiveCaptureParentEffect({
      targetResolutionIntentId: intent._id,
      now: at,
    });
  });

const targetResolutionPopulationDigest = (
  jobs: readonly Pick<
    RetrievalPublicationJobsDoc,
    "workspaceId" | "brainKey" | "jobKey"
  >[],
) =>
  `sha256:${sha256Hex(
    JSON.stringify(
      jobs
        .map(
          (candidate) =>
            `${String(candidate.workspaceId)}:${candidate.brainKey}:${candidate.jobKey}`,
        )
        .sort(),
    ),
  )}`;

const targetResolutionAuthorityStatusEffect = (
  job: RetrievalPublicationJobsDoc,
  envelope: NonNullable<RetrievalPublicationJobsDoc["authorityEnvelope"]>,
) =>
  Effect.gen(function* () {
    const intentKey = envelope.targetResolutionIntentKey;
    const resolutionGeneration = envelope.targetResolutionGeneration;
    if (
      intentKey === undefined &&
      resolutionGeneration === undefined &&
      job.targetResolutionIntentKey === undefined
    )
      return "valid" as const;
    if (
      intentKey !== undefined &&
      resolutionGeneration === undefined &&
      job.targetResolutionIntentKey === undefined
    )
      return "migration_required" as const;
    if (
      intentKey === undefined ||
      resolutionGeneration === undefined ||
      job.targetResolutionIntentKey === undefined
    )
      return "integrity_failure" as const;
    if (job.targetResolutionIntentKey !== intentKey)
      return "integrity_failure" as const;

    const reader = yield* DatabaseReader;
    const intent = yield* reader
      .table("slackPublicationTargetIntents")
      .get(intentKey)
      .pipe(Effect.orDie);
    if (intent === null) return "integrity_failure" as const;
    const missingIntentLinkage = [
      intent.resolutionGeneration,
      intent.linkageVersion,
      intent.targetDigest,
      intent.targets,
    ].filter((value) => value === undefined).length;
    if (missingIntentLinkage === 4) return "migration_required" as const;
    if (missingIntentLinkage > 0) return "integrity_failure" as const;
    const intentTargets = intent.targets;
    if (intentTargets === undefined) return "integrity_failure" as const;
    if (
      intent.status !== "succeeded" ||
      intent.resolutionGeneration !== resolutionGeneration ||
      intent.organizationKey !== job.organizationKey ||
      intent.sourceRevisionKey !== job.sourceRevisionKey ||
      intent.channelKey !== envelope.connectorScopeKey
    )
      return "integrity_failure" as const;

    const receipt = yield* reader
      .table("providerEventReceipts")
      .get(intent.receiptId)
      .pipe(Effect.orDie);
    if (
      receipt === null ||
      receipt.organizationKey !== job.organizationKey ||
      receipt.sourceKey === null ||
      receipt.sourceRevisionKey === null ||
      receipt.sourceKey !== job.sourceKey ||
      receipt.sourceRevisionKey !== job.sourceRevisionKey ||
      receipt.channelKey !== intent.channelKey ||
      receipt.channelKey !== envelope.connectorScopeKey ||
      receipt.connectionGeneration !==
        envelope.configuration.connectionGeneration
    )
      return "integrity_failure" as const;

    const [revisions, artifacts, organizations, workspace, policies] =
      yield* Effect.all([
        reader
          .table("sourceRevisions")
          .index("by_source_revision_key", (query) =>
            query
              .eq("organizationKey", job.organizationKey)
              .eq("sourceRevisionKey", job.sourceRevisionKey),
          )
          .take(2),
        reader
          .table("sourceArtifacts")
          .index("by_org_source_key", (query) =>
            query
              .eq("organizationKey", job.organizationKey)
              .eq("sourceKey", job.sourceKey),
          )
          .take(2),
        reader
          .table("organizations")
          .index("by_agency_key", (query) =>
            query.eq("agencyKey", job.organizationKey),
          )
          .take(2),
        reader.table("workspaces").get(job.workspaceId),
        reader
          .table("channelRoutingPolicies")
          .index("by_channel_active", (query) =>
            query.eq("channelKey", intent.channelKey).eq("active", true),
          )
          .take(2),
      ]).pipe(Effect.orDie);

    const revision = revisions.length === 1 ? revisions[0] : undefined;
    const artifact = artifacts.length === 1 ? artifacts[0] : undefined;
    const organization =
      organizations.length === 1 ? organizations[0] : undefined;
    if (revisions.length > 1 || artifacts.length > 1)
      return "integrity_failure" as const;
    if (revisions.length === 0 || artifacts.length === 0)
      return "superseded" as const;
    if (
      revision === undefined ||
      artifact === undefined ||
      revision.sourceKey !== receipt.sourceKey ||
      revision.sourceRevisionKey !== receipt.sourceRevisionKey ||
      revision.channelKey !== receipt.channelKey ||
      revision.connectionKey !== receipt.connectionKey ||
      revision.connectionGeneration !== receipt.connectionGeneration ||
      artifact.sourceKey !== receipt.sourceKey ||
      artifact.channelKey !== receipt.channelKey ||
      artifact.connectionKey !== receipt.connectionKey ||
      intent.targetCount !== intentTargets.length ||
      intent.targetDigest !== targetResolutionPopulationDigest(intentTargets) ||
      new Set(
        intentTargets.map(
          (target) =>
            `${String(target.workspaceId)}:${target.brainKey}:${target.jobKey}`,
        ),
      ).size !== intentTargets.length ||
      !intentTargets.some(
        (target) =>
          target.workspaceId === job.workspaceId &&
          target.brainKey === job.brainKey &&
          target.jobKey === job.jobKey,
      )
    )
      return "integrity_failure" as const;

    const policy = policies.length === 1 ? policies[0] : undefined;
    if (
      organization === undefined ||
      workspace === null ||
      policy === undefined ||
      workspace.organizationId !== organization._id ||
      workspace.status !== "active" ||
      workspace.brainKey !== job.brainKey ||
      policy.organizationKey !== job.organizationKey ||
      policy.connectionKey !== receipt.connectionKey ||
      policy.connectionGeneration !== receipt.connectionGeneration ||
      policy.policyEpoch !== envelope.configuration.policyGeneration ||
      policy.mode === "capture_only" ||
      !policy.targetBrainKeys.includes(job.brainKey)
    )
      return "superseded" as const;

    const activeWorkspaces = yield* reader
      .table("workspaces")
      .index("by_organization_status", (query) =>
        query.eq("organizationId", organization._id).eq("status", "active"),
      )
      .take(27)
      .pipe(Effect.orDie);
    if (activeWorkspaces.length > 26) return "superseded" as const;
    const expectedTargets = activeWorkspaces
      .filter(
        (target) =>
          target.brainKey !== undefined &&
          policy.targetBrainKeys.includes(target.brainKey),
      )
      .map((target) => `${String(target._id)}:${target.brainKey}`)
      .sort();
    const capturedTargets = intentTargets
      .map((target) => `${String(target.workspaceId)}:${target.brainKey}`)
      .sort();
    return JSON.stringify(expectedTargets) === JSON.stringify(capturedTargets)
      ? ("valid" as const)
      : ("superseded" as const);
  });

const corpusKeyForJob = (
  originKind: RetrievalPublicationJobsDoc["originKind"],
): "brain-pages" | "slack" | "transcripts" | "documents" =>
  originKind === "page" || originKind === "page_rebuild"
    ? "brain-pages"
    : originKind === "slack" || originKind === "slack_rebuild"
      ? "slack"
      : originKind === "document"
        ? "documents"
        : "transcripts";

const rebuildLedgerStateEffect = (input: EnqueuePublicationJobInput) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    if (input.originKind === "page_rebuild") {
      const [latestRevision, latestPage] = yield* Effect.all([
        reader
          .table("pageRevisions")
          .index(
            "by_workspace_ledger",
            (query) => query.eq("workspaceId", input.workspaceId),
            "desc",
          )
          .first()
          .pipe(Effect.map(Option.getOrNull)),
        reader
          .table("brainPages")
          .index(
            "by_workspace_updated",
            (query) => query.eq("workspaceId", input.workspaceId),
            "desc",
          )
          .first()
          .pipe(Effect.map(Option.getOrNull)),
      ]).pipe(Effect.orDie);
      const highWater = latestRevision?._creationTime ?? 0;
      return {
        highWater,
        stateDigest: `sha256:${sha256Hex(
          JSON.stringify({
            highWater,
            pageUpdatedHighWater: latestPage?.updatedAt ?? 0,
          }),
        )}`,
      };
    }
    if (input.originKind === "slack_rebuild") {
      const [latestRevision, latestArtifact, latestPolicy] = yield* Effect.all([
        reader
          .table("sourceRevisions")
          .index(
            "by_organization_ledger",
            (query) => query.eq("organizationKey", input.organizationKey),
            "desc",
          )
          .first()
          .pipe(Effect.map(Option.getOrNull)),
        reader
          .table("sourceArtifacts")
          .index(
            "by_organization_updated",
            (query) => query.eq("organizationKey", input.organizationKey),
            "desc",
          )
          .first()
          .pipe(Effect.map(Option.getOrNull)),
        reader
          .table("channelRoutingPolicies")
          .index(
            "by_organization_created",
            (query) => query.eq("organizationKey", input.organizationKey),
            "desc",
          )
          .first()
          .pipe(Effect.map(Option.getOrNull)),
      ]).pipe(Effect.orDie);
      const highWater = latestRevision?._creationTime ?? 0;
      return {
        highWater,
        stateDigest: `sha256:${sha256Hex(
          JSON.stringify({
            highWater,
            artifactUpdatedHighWater: latestArtifact?.updatedAt ?? 0,
            policyCreatedHighWater: latestPolicy?.createdAt ?? 0,
          }),
        )}`,
      };
    }
    const [latestRevision, latestUnit, latestRoute] = yield* Effect.all([
      reader
        .table("sourceUnitRevisions")
        .index(
          "by_organization_ledger",
          (query) => query.eq("organizationKey", input.organizationKey),
          "desc",
        )
        .first()
        .pipe(Effect.map(Option.getOrNull)),
      reader
        .table("sourceUnits")
        .index(
          "by_organization_updated",
          (query) => query.eq("organizationKey", input.organizationKey),
          "desc",
        )
        .first()
        .pipe(Effect.map(Option.getOrNull)),
      reader
        .table("callRoutingProposals")
        .index(
          "by_organization_updated",
          (query) => query.eq("organizationKey", input.organizationKey),
          "desc",
        )
        .first()
        .pipe(Effect.map(Option.getOrNull)),
    ]).pipe(Effect.orDie);
    const highWater = latestRevision?._creationTime ?? 0;
    return {
      highWater,
      stateDigest: `sha256:${sha256Hex(
        JSON.stringify({
          highWater,
          unitUpdatedHighWater: latestUnit?.updatedAt ?? 0,
          routeUpdatedHighWater: latestRoute?.updatedAt ?? 0,
        }),
      )}`,
    };
  });

const rebuildScopeFor = (input: EnqueuePublicationJobInput) => {
  const corpusKey =
    input.originKind === "page_rebuild"
      ? ("brain-pages" as const)
      : input.originKind === "slack_rebuild"
        ? ("slack" as const)
        : ("transcripts" as const);
  const connectionScoped = input.sourceRevisionKey.startsWith("connection:");
  const connectorScoped =
    input.originKind === "slack_rebuild" &&
    input.sourceRevisionKey.startsWith("policy:");
  const scopeKind = connectionScoped
    ? ("connection" as const)
    : connectorScoped
      ? ("connector_scope" as const)
      : input.originKind === "page_rebuild"
        ? ("workspace" as const)
        : ("corpus" as const);
  const scopeValue =
    scopeKind === "workspace" ? String(input.workspaceId) : input.sourceKey;
  const rebuildScopeKey = `rscope_${sha256Hex(
    JSON.stringify({
      organizationKey: input.organizationKey,
      workspaceId: String(input.workspaceId),
      brainKey: input.brainKey,
      corpusKey,
      scopeKind,
      scopeValue,
    }),
  )}`;
  return { corpusKey, scopeKind, scopeValue, rebuildScopeKey };
};

const openRetrievalRebuildRunEffect = (
  input: EnqueuePublicationJobInput,
  capturedContext: RetrievalPublicationAuthorityContext,
  now: number,
) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    if (
      input.originKind !== "page_rebuild" &&
      input.originKind !== "slack_rebuild" &&
      input.originKind !== "transcript_rebuild"
    )
      return yield* Effect.dieMessage(
        "Only rebuild jobs can open rebuild runs.",
      );
    const { corpusKey, scopeKind, scopeValue, rebuildScopeKey } =
      rebuildScopeFor(input);
    const policyGeneration =
      input.originKind === "page_rebuild" ||
      input.sourceRevisionKey.startsWith("policy:")
        ? input.requestGeneration
        : capturedContext.configuration.policyGeneration;
    const connectionGeneration = input.sourceRevisionKey.startsWith(
      "connection:",
    )
      ? input.requestGeneration
      : capturedContext.configuration.connectionGeneration;
    const configuration = {
      requestGeneration: input.requestGeneration,
      ...(policyGeneration === undefined ? {} : { policyGeneration }),
      ...(capturedContext.configuration.routeGeneration === undefined
        ? {}
        : { routeGeneration: capturedContext.configuration.routeGeneration }),
      ...(connectionGeneration === undefined ? {} : { connectionGeneration }),
    };
    const configurationDigest = `sha256:${sha256Hex(
      JSON.stringify(configuration),
    )}`;
    const rebuildRunKey = `rrun_${sha256Hex(
      JSON.stringify({
        rebuildScopeKey,
        triggerSourceKey: input.sourceKey,
        triggerRevisionKey: input.sourceRevisionKey,
        originKind: input.originKind,
        configurationDigest,
        eligibilityFences: capturedContext.eligibilityFences,
      }),
    )}`;
    const existingRuns = yield* reader
      .table("retrievalRebuildRuns")
      .index("by_run_key", (query) => query.eq("rebuildRunKey", rebuildRunKey))
      .take(2)
      .pipe(Effect.orDie);
    if (existingRuns.length > 1)
      return yield* Effect.dieMessage("Rebuild run identity is not unique.");
    const existing = existingRuns[0];
    if (existing !== undefined)
      return {
        rebuildRunKey: existing.rebuildRunKey,
        rebuildRunGeneration: existing.runGeneration,
        rebuildLedgerHighWater: existing.ledgerHighWater,
        rebuildPauseEpoch: existing.pauseEpoch,
        rebuildPredecessorDigest: existing.rootPredecessorDigest,
        authorityContext: {
          version: 1 as const,
          configuration: {
            requestGeneration: existing.configuration.requestGeneration,
            ...(existing.configuration.policyGeneration === undefined
              ? {}
              : {
                  policyGeneration: existing.configuration.policyGeneration,
                }),
            ...(existing.configuration.routeGeneration === undefined
              ? {}
              : { routeGeneration: existing.configuration.routeGeneration }),
            ...(existing.configuration.connectionGeneration === undefined
              ? {}
              : {
                  connectionGeneration:
                    existing.configuration.connectionGeneration,
                }),
          },
          eligibilityFences: existing.eligibilityFences,
          observationFence: {
            kind: "rebuild" as const,
            key: existing.rebuildRunKey,
            generation: existing.runGeneration,
          },
        },
      };

    const latest = yield* reader
      .table("retrievalRebuildRuns")
      .index(
        "by_scope_generation",
        (query) => query.eq("rebuildScopeKey", rebuildScopeKey),
        "desc",
      )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    const runGeneration = (latest?.runGeneration ?? 0) + 1;
    const ledgerState = yield* rebuildLedgerStateEffect(input);
    const ledgerHighWater = ledgerState.highWater;
    const pauseEpoch = 0;
    const rootPredecessorDigest = `sha256:${sha256Hex(
      JSON.stringify({ rebuildRunKey, runGeneration, predecessor: "root" }),
    )}`;
    const runAuthorityDigest = `sha256:${sha256Hex(
      JSON.stringify({
        rebuildRunKey,
        runGeneration,
        rebuildScopeKey,
        configuration,
        eligibilityFences: capturedContext.eligibilityFences,
        ledgerHighWater,
        ledgerStateDigest: ledgerState.stateDigest,
        pauseEpoch,
        rootPredecessorDigest,
      }),
    )}`;
    if (
      latest !== null &&
      (latest.status === "running" || latest.status === "closing")
    )
      yield* writer
        .table("retrievalRebuildRuns")
        .patch(latest._id, {
          status: "superseded",
          blockingErrorTag: "RebuildSuccessorOpened",
          updatedAt: now,
        })
        .pipe(Effect.orDie);
    yield* writer
      .table("retrievalRebuildRuns")
      .insert({
        schemaVersion: 1,
        rebuildRunKey,
        rebuildScopeKey,
        organizationKey: input.organizationKey,
        workspaceId: input.workspaceId,
        brainKey: input.brainKey,
        corpusKey,
        originKind: input.originKind,
        scopeKind,
        scopeValue,
        ...(scopeKind === "connector_scope"
          ? { connectorScopeKey: scopeValue }
          : {}),
        ...(scopeKind === "connection" ? { connectionKey: scopeValue } : {}),
        triggerSourceKey: input.sourceKey,
        triggerRevisionKey: input.sourceRevisionKey,
        runGeneration,
        configuration,
        configurationDigest,
        eligibilityFences: capturedContext.eligibilityFences,
        runAuthorityDigest,
        ledgerHighWater,
        ledgerStateDigest: ledgerState.stateDigest,
        pauseEpoch,
        rootPredecessorDigest,
        openedAt: now,
        status: "running",
        headDigest: rootPredecessorDigest,
        emittedChildCount: 0,
        terminalChildCount: 0,
        blockingChildCount: 0,
        publishedChildCount: 0,
        revokedChildCount: 0,
        supersededChildCount: 0,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    return {
      rebuildRunKey,
      rebuildRunGeneration: runGeneration,
      rebuildLedgerHighWater: ledgerHighWater,
      rebuildPauseEpoch: pauseEpoch,
      rebuildPredecessorDigest: rootPredecessorDigest,
      authorityContext: {
        version: 1 as const,
        configuration,
        eligibilityFences: capturedContext.eligibilityFences,
        observationFence: {
          kind: "rebuild" as const,
          key: rebuildRunKey,
          generation: runGeneration,
        },
      },
    };
  });

const rebuildRunAuthorityStatusEffect = (job: RetrievalPublicationJobsDoc) =>
  Effect.gen(function* () {
    const batchJob = job.originKind.endsWith("_rebuild");
    const childJob = job.parentRebuildJobKey !== undefined;
    if (!batchJob && !childJob && job.rebuildRunKey === undefined)
      return "valid" as const;
    if (
      job.rebuildRunKey === undefined ||
      job.rebuildRunGeneration === undefined ||
      job.rebuildLedgerHighWater === undefined ||
      job.rebuildPauseEpoch === undefined ||
      (batchJob && job.rebuildPredecessorDigest === undefined) ||
      (childJob && job.parentRebuildJobKey === undefined)
    )
      return "migration_required" as const;
    if (!batchJob && !childJob) return "integrity_failure" as const;
    const rebuildRunKey = job.rebuildRunKey;
    const reader = yield* DatabaseReader;
    const runs = yield* reader
      .table("retrievalRebuildRuns")
      .index("by_run_key", (query) => query.eq("rebuildRunKey", rebuildRunKey))
      .take(2)
      .pipe(Effect.orDie);
    if (runs.length !== 1) return "integrity_failure" as const;
    const run = runs[0];
    if (run === undefined) return "integrity_failure" as const;
    if (run.ledgerStateDigest === undefined)
      return "migration_required" as const;
    const expectedRunOrigin = batchJob
      ? job.originKind
      : job.originKind === "page"
        ? "page_rebuild"
        : job.originKind === "slack"
          ? "slack_rebuild"
          : "transcript_rebuild";
    const expectedAuthorityDigest = `sha256:${sha256Hex(
      JSON.stringify({
        rebuildRunKey: run.rebuildRunKey,
        runGeneration: run.runGeneration,
        rebuildScopeKey: run.rebuildScopeKey,
        configuration: run.configuration,
        eligibilityFences: run.eligibilityFences,
        ledgerHighWater: run.ledgerHighWater,
        ledgerStateDigest: run.ledgerStateDigest,
        pauseEpoch: run.pauseEpoch,
        rootPredecessorDigest: run.rootPredecessorDigest,
      }),
    )}`;
    if (
      run.organizationKey !== job.organizationKey ||
      run.workspaceId !== job.workspaceId ||
      run.brainKey !== job.brainKey ||
      run.originKind !== expectedRunOrigin ||
      run.rebuildRunKey !== job.rebuildRunKey ||
      run.runGeneration !== job.rebuildRunGeneration ||
      run.ledgerHighWater !== job.rebuildLedgerHighWater ||
      run.pauseEpoch !== job.rebuildPauseEpoch ||
      run.runAuthorityDigest !== expectedAuthorityDigest
    )
      return "integrity_failure" as const;
    const latest = yield* reader
      .table("retrievalRebuildRuns")
      .index(
        "by_scope_generation",
        (query) => query.eq("rebuildScopeKey", run.rebuildScopeKey),
        "desc",
      )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    if (
      latest === null ||
      latest.rebuildRunKey !== run.rebuildRunKey ||
      run.status === "superseded" ||
      run.status === "complete"
    )
      return "superseded" as const;
    if (run.status === "blocked") return "integrity_failure" as const;
    if (childJob) {
      const parentRebuildJobKey = job.parentRebuildJobKey;
      if (parentRebuildJobKey === undefined)
        return "integrity_failure" as const;
      const manifests = yield* reader
        .table("retrievalRebuildChildren")
        .index("by_child_job_key", (query) =>
          query.eq("childJobKey", job.jobKey),
        )
        .take(2)
        .pipe(Effect.orDie);
      const manifest = manifests.length === 1 ? manifests[0] : undefined;
      if (
        manifest === undefined ||
        manifest.status !== "pending" ||
        !rebuildChildManifestMatchesJob(manifest, job)
      )
        return "integrity_failure" as const;
      const parents = yield* reader
        .table("retrievalPublicationJobs")
        .index("by_job_key", (query) => query.eq("jobKey", parentRebuildJobKey))
        .take(2)
        .pipe(Effect.orDie);
      const parent = parents.length === 1 ? parents[0] : undefined;
      return parent !== undefined &&
        manifest.parentBatchJobKey === parent.jobKey &&
        parent.rebuildRunKey === job.rebuildRunKey &&
        parent.effectClass === "rebuild_batch" &&
        parent.status === "succeeded"
        ? ("valid" as const)
        : ("integrity_failure" as const);
    }
    if (run.headDigest !== job.rebuildPredecessorDigest)
      return "superseded" as const;
    const samePredecessor = yield* reader
      .table("retrievalPublicationJobs")
      .index("by_rebuild_run_predecessor", (query) =>
        query
          .eq("rebuildRunKey", job.rebuildRunKey)
          .eq("rebuildPredecessorDigest", job.rebuildPredecessorDigest),
      )
      .take(3)
      .pipe(Effect.orDie);
    return samePredecessor.length === 1 && samePredecessor[0]?._id === job._id
      ? ("valid" as const)
      : ("integrity_failure" as const);
  });

export const enqueueRetrievalPublicationJobEffect = (
  input: EnqueuePublicationJobInput,
  now: number,
): Effect.Effect<string, never, DatabaseReader | DatabaseWriter | Scheduler> =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const scheduler = yield* Scheduler;
    let normalizedInput = input;
    let authorityContextValue = input.authorityContext;
    if (
      input.originKind.endsWith("_rebuild") &&
      input.rebuildRunKey === undefined
    ) {
      const captured =
        authorityContextValue ??
        (yield* capturePublicationAuthorityContextEffect(input, now));
      const opened = yield* openRetrievalRebuildRunEffect(input, captured, now);
      normalizedInput = {
        ...input,
        rebuildRunKey: opened.rebuildRunKey,
        rebuildRunGeneration: opened.rebuildRunGeneration,
        rebuildLedgerHighWater: opened.rebuildLedgerHighWater,
        rebuildPauseEpoch: opened.rebuildPauseEpoch,
        rebuildPredecessorDigest: opened.rebuildPredecessorDigest,
        rebuild: {
          ...(input.rebuild ?? { limit: 5 }),
          phase: input.rebuild?.phase ?? "scan",
          phaseHighWater: opened.rebuildLedgerHighWater,
        },
      };
      authorityContextValue = opened.authorityContext;
    }
    authorityContextValue ??= yield* capturePublicationAuthorityContextEffect(
      normalizedInput,
      now,
    );
    if (
      normalizedInput.providerTargetResolutionIntentId !== undefined ||
      normalizedInput.providerTargetResolutionGeneration !== undefined
    ) {
      if (
        normalizedInput.providerTargetResolutionIntentId === undefined ||
        normalizedInput.providerTargetResolutionGeneration === undefined
      )
        return yield* Effect.die(
          "Provider target resolution linkage must include both intent and generation.",
        );
      authorityContextValue = {
        ...authorityContextValue,
        providerTargetResolutionIntentId:
          normalizedInput.providerTargetResolutionIntentId,
        providerTargetResolutionGeneration:
          normalizedInput.providerTargetResolutionGeneration,
      };
    }
    const persistedInput = {
      ...normalizedInput,
      workspaceId: String(normalizedInput.workspaceId),
      authorityContext: authorityContextValue,
    };
    const jobKey = retrievalPublicationJobKey(persistedInput);
    const existing = yield* reader
      .table("retrievalPublicationJobs")
      .index("by_job_key", (query) => query.eq("jobKey", jobKey))
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    if (existing === null)
      yield* writer
        .table("retrievalPublicationJobs")
        .insert({
          ...retrievalPublicationJobRow(persistedInput, now),
          workspaceId: normalizedInput.workspaceId,
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

export const enqueueAttributedPublicationRepairEffect = (input: {
  readonly jobKey: string;
  readonly now: number;
}): Effect.Effect<
  string | null,
  never,
  DatabaseReader | DatabaseWriter | Scheduler
> =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const jobs = yield* reader
      .table("retrievalPublicationJobs")
      .index("by_job_key", (query) => query.eq("jobKey", input.jobKey))
      .take(2)
      .pipe(Effect.orDie);
    const job = jobs[0];
    if (
      jobs.length !== 1 ||
      job === undefined ||
      job.status !== "dead_letter" ||
      job.authorityEnvelope === undefined ||
      (job.providerTargetResolutionIntentId === undefined) !==
        (job.providerTargetResolutionGeneration === undefined)
    )
      return null;
    const authorityContext = {
      ...unattributedAuthorityContext(job.authorityEnvelope),
      repairOfJobKey: job.jobKey,
    };
    return yield* enqueueRetrievalPublicationJobEffect(
      {
        organizationKey: job.organizationKey,
        workspaceId: job.workspaceId,
        brainKey: job.brainKey,
        originKind: job.originKind,
        effectClass: "attributed_repair",
        ...(job.operation === undefined ? {} : { operation: job.operation }),
        ...(job.rebuildRunKey === undefined
          ? {}
          : { rebuildRunKey: job.rebuildRunKey }),
        ...(job.rebuildRunGeneration === undefined
          ? {}
          : { rebuildRunGeneration: job.rebuildRunGeneration }),
        ...(job.rebuildLedgerHighWater === undefined
          ? {}
          : { rebuildLedgerHighWater: job.rebuildLedgerHighWater }),
        ...(job.rebuildPauseEpoch === undefined
          ? {}
          : { rebuildPauseEpoch: job.rebuildPauseEpoch }),
        ...(job.rebuildPredecessorDigest === undefined
          ? {}
          : { rebuildPredecessorDigest: job.rebuildPredecessorDigest }),
        ...(job.parentRebuildJobKey === undefined
          ? {}
          : { parentRebuildJobKey: job.parentRebuildJobKey }),
        sourceKey: job.sourceKey,
        sourceRevisionKey: job.sourceRevisionKey,
        ...(job.ingestionObligationKey === undefined
          ? {}
          : { ingestionObligationKey: job.ingestionObligationKey }),
        ...(job.providerTargetResolutionIntentId === undefined ||
        job.providerTargetResolutionGeneration === undefined
          ? {}
          : {
              providerTargetResolutionIntentId:
                job.providerTargetResolutionIntentId,
              providerTargetResolutionGeneration:
                job.providerTargetResolutionGeneration,
            }),
        requestGeneration: job.requestGeneration,
        ...(job.page === undefined ? {} : { page: job.page }),
        ...(job.rebuild === undefined
          ? {}
          : {
              rebuild: {
                limit: job.rebuild.limit,
                ...(job.rebuild.phase === undefined
                  ? {}
                  : { phase: job.rebuild.phase }),
                ...(job.rebuild.phaseHighWater === undefined
                  ? {}
                  : { phaseHighWater: job.rebuild.phaseHighWater }),
                ...(job.rebuild.afterSourceKey === undefined
                  ? {}
                  : { afterSourceKey: job.rebuild.afterSourceKey }),
                ...(job.rebuild.discoveredCount === undefined
                  ? {}
                  : { discoveredCount: job.rebuild.discoveredCount }),
                ...(job.rebuild.publishedCount === undefined
                  ? {}
                  : { publishedCount: job.rebuild.publishedCount }),
              },
            }),
        ...(job.targetResolutionIntentKey === undefined
          ? {}
          : {
              targetResolutionIntentKey: job.targetResolutionIntentKey,
            }),
        authorityContext,
      },
      input.now,
    );
  });

export type LegacyPublicationJobMigrationResult =
  | {
      readonly kind: "replaced";
      readonly jobKey: string;
      readonly replacementJobKey: string;
    }
  | {
      readonly kind: "complete_authority" | "terminal_history";
      readonly jobKey: string;
    }
  | {
      readonly kind: "conflict";
      readonly jobKey: string;
      readonly reason:
        "origin_missing" | "authority_ambiguous" | "replacement_collision";
    };

const legacyJobOriginAuthorityStatusEffect = (
  job: RetrievalPublicationJobsDoc,
) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    if (job.originKind === "page") {
      const [pages, revisions] = yield* Effect.all([
        reader
          .table("brainPages")
          .index("by_workspace_page_key", (query) =>
            query
              .eq("workspaceId", job.workspaceId)
              .eq("pageKey", job.sourceKey),
          )
          .take(2)
          .pipe(Effect.orDie),
        reader
          .table("pageRevisions")
          .index("by_workspace_revision_key", (query) =>
            query
              .eq("workspaceId", job.workspaceId)
              .eq("revisionKey", job.sourceRevisionKey),
          )
          .take(2)
          .pipe(Effect.orDie),
      ]);
      if (pages.length === 0 || revisions.length === 0)
        return "origin_missing" as const;
      if (
        pages.length !== 1 ||
        revisions.length !== 1 ||
        revisions[0]?.pageKey !== job.sourceKey ||
        pages[0]?.lifecycle === undefined ||
        job.page === undefined
      )
        return "authority_ambiguous" as const;
      return "valid" as const;
    }
    if (job.originKind === "slack") {
      const [revisions, artifacts] = yield* Effect.all([
        reader
          .table("sourceRevisions")
          .index("by_source_revision_key", (query) =>
            query
              .eq("organizationKey", job.organizationKey)
              .eq("sourceRevisionKey", job.sourceRevisionKey),
          )
          .take(2)
          .pipe(Effect.orDie),
        reader
          .table("sourceArtifacts")
          .index("by_org_source_key", (query) =>
            query
              .eq("organizationKey", job.organizationKey)
              .eq("sourceKey", job.sourceKey),
          )
          .take(2)
          .pipe(Effect.orDie),
      ]);
      const revision = revisions[0];
      const artifact = artifacts[0];
      if (revision === undefined || artifact === undefined)
        return "origin_missing" as const;
      if (
        revisions.length !== 1 ||
        artifacts.length !== 1 ||
        revision.sourceKey !== job.sourceKey ||
        artifact.channelKey !== revision.channelKey ||
        artifact.connectionKey !== revision.connectionKey
      )
        return "authority_ambiguous" as const;
      const [policies, connections] = yield* Effect.all([
        reader
          .table("channelRoutingPolicies")
          .index("by_channel_active", (query) =>
            query.eq("channelKey", revision.channelKey).eq("active", true),
          )
          .take(3)
          .pipe(Effect.orDie),
        reader
          .table("providerConnections")
          .index("by_connection_key", (query) =>
            query.eq("connectionKey", revision.connectionKey),
          )
          .take(2)
          .pipe(Effect.orDie),
      ]);
      const matchingPolicies = policies.filter(
        (policy) =>
          policy.mode !== "capture_only" &&
          policy.targetBrainKeys.includes(job.brainKey),
      );
      const connection = connections[0];
      return matchingPolicies.length === 1 &&
        connections.length === 1 &&
        connection?.organizationKey === job.organizationKey &&
        connection.connectionGeneration === revision.connectionGeneration
        ? ("valid" as const)
        : ("authority_ambiguous" as const);
    }
    if (job.originKind === "transcript") {
      const [revisions, units] = yield* Effect.all([
        reader
          .table("sourceUnitRevisions")
          .index("by_unit_revision_key", (query) =>
            query
              .eq("organizationKey", job.organizationKey)
              .eq("unitRevisionKey", job.sourceRevisionKey),
          )
          .take(2)
          .pipe(Effect.orDie),
        reader
          .table("sourceUnits")
          .index("by_unit_key", (query) =>
            query
              .eq("organizationKey", job.organizationKey)
              .eq("unitKey", job.sourceKey),
          )
          .take(2)
          .pipe(Effect.orDie),
      ]);
      const revision = revisions[0];
      const unit = units[0];
      if (revision === undefined || unit === undefined)
        return "origin_missing" as const;
      if (
        revisions.length !== 1 ||
        units.length !== 1 ||
        revision.unitKey !== job.sourceKey
      )
        return "authority_ambiguous" as const;
      const [routes, connections] = yield* Effect.all([
        reader
          .table("callRoutingProposals")
          .index("by_org_revision", (query) =>
            query
              .eq("organizationKey", job.organizationKey)
              .eq("unitRevisionKey", revision.unitRevisionKey),
          )
          .take(101)
          .pipe(Effect.orDie),
        reader
          .table("providerConnections")
          .index("by_connection_key", (query) =>
            query.eq("connectionKey", unit.connectionKey),
          )
          .take(2)
          .pipe(Effect.orDie),
      ]);
      const matchingRoutes = routes.filter(
        (route) =>
          route.outcome === "routed" &&
          route.brainKey === job.brainKey &&
          (route.status === "current" || route.status === "accepted"),
      );
      const connection = connections[0];
      return matchingRoutes.length === 1 &&
        connections.length === 1 &&
        connection?.organizationKey === job.organizationKey &&
        connection.connectionGeneration === unit.connectionGeneration
        ? ("valid" as const)
        : ("authority_ambiguous" as const);
    }
    if (
      job.rebuildRunKey === undefined ||
      job.rebuildRunGeneration === undefined ||
      job.rebuildLedgerHighWater === undefined ||
      job.rebuildPauseEpoch === undefined ||
      job.rebuildPredecessorDigest === undefined
    )
      return "authority_ambiguous" as const;
    const runs = yield* reader
      .table("retrievalRebuildRuns")
      .index("by_run_key", (query) =>
        query.eq("rebuildRunKey", job.rebuildRunKey ?? ""),
      )
      .take(2)
      .pipe(Effect.orDie);
    return runs.length === 1 ? ("valid" as const) : ("origin_missing" as const);
  });

const publicationJobAuthorityEnvelopeIsComplete = (
  job: RetrievalPublicationJobsDoc,
): boolean => {
  const envelope = job.authorityEnvelope;
  if (
    envelope === undefined ||
    job.authorityDigest === undefined ||
    !publicationAuthorityLinkageIsValid(job, envelope)
  )
    return false;
  const context = authorityContextFromEnvelope(envelope);
  const expected = retrievalPublicationAuthorityEnvelope(
    jobIdentityInput(job),
    context,
    envelope.capturedAt,
  );
  return (
    expected.authorityDigest === job.authorityDigest &&
    expected.authorityDigest === envelope.authorityDigest &&
    expected.stableEffectKey === envelope.stableEffectKey
  );
};

export const migrateLegacyPublicationJobEffect: (
  job: RetrievalPublicationJobsDoc,
  now: number,
) => Effect.Effect<
  LegacyPublicationJobMigrationResult,
  never,
  PublicationMutationServices
> = (job, now) =>
  Effect.gen(function* () {
    if (job.status !== "pending" && job.status !== "retry_wait")
      return { kind: "terminal_history" as const, jobKey: job.jobKey };
    if (publicationJobAuthorityEnvelopeIsComplete(job))
      return { kind: "complete_authority" as const, jobKey: job.jobKey };
    const originStatus = yield* legacyJobOriginAuthorityStatusEffect(job);
    if (originStatus !== "valid")
      return {
        kind: "conflict" as const,
        jobKey: job.jobKey,
        reason: originStatus,
      };
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    let targetResolutionGeneration: number | undefined;
    if (job.targetResolutionIntentKey !== undefined) {
      const intent = yield* reader
        .table("slackPublicationTargetIntents")
        .get(job.targetResolutionIntentKey)
        .pipe(Effect.orDie);
      if (
        intent === null ||
        intent.resolutionGeneration === undefined ||
        intent.linkageVersion !== 1
      )
        return {
          kind: "conflict" as const,
          jobKey: job.jobKey,
          reason: "authority_ambiguous" as const,
        };
      targetResolutionGeneration = intent.resolutionGeneration;
    }
    const migrationInput: EnqueuePublicationJobInput = {
      ...jobIdentityInput(job),
      workspaceId: job.workspaceId,
      effectClass: "migration_replacement",
      operation: job.operation ?? "publish",
    };
    const authorityContextValue =
      yield* capturePublicationAuthorityContextEffect(migrationInput, now, {
        ...(job.targetResolutionIntentKey === undefined
          ? {}
          : { targetResolutionIntentKey: job.targetResolutionIntentKey }),
        ...(targetResolutionGeneration === undefined
          ? {}
          : { targetResolutionGeneration }),
        supersedesJobKey: job.jobKey,
      });
    const replacementJobKey = yield* enqueueRetrievalPublicationJobEffect(
      { ...migrationInput, authorityContext: authorityContextValue },
      now,
    );
    const replacements = yield* reader
      .table("retrievalPublicationJobs")
      .index("by_job_key", (query) => query.eq("jobKey", replacementJobKey))
      .take(2)
      .pipe(Effect.orDie);
    const replacement = replacements[0];
    if (
      replacements.length !== 1 ||
      replacement === undefined ||
      replacement.effectClass !== "migration_replacement" ||
      replacement.authorityEnvelope?.supersedesJobKey !== job.jobKey ||
      !publicationJobAuthorityEnvelopeIsComplete(replacement)
    )
      return {
        kind: "conflict" as const,
        jobKey: job.jobKey,
        reason: "replacement_collision" as const,
      };
    yield* writer
      .table("retrievalPublicationJobs")
      .patch(job._id, {
        status: "superseded",
        supersededByJobKey: replacementJobKey,
        lastErrorTag: "LegacyPublicationJobAuthorityMigrated",
        completedAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    return {
      kind: "replaced" as const,
      jobKey: job.jobKey,
      replacementJobKey,
    };
  });

const enqueueUniqueRebuildChildEffect = (
  input: EnqueuePublicationJobInput & {
    readonly rebuildRunKey: string;
    readonly operation?: "publish" | "cleanup";
  },
  now: number,
) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const authorityContextValue =
      input.authorityContext ??
      (yield* capturePublicationAuthorityContextEffect(input, now));
    const authorityDigest = retrievalPublicationAuthorityDigest(
      authorityContextValue,
    );
    const existingJobs = yield* reader
      .table("retrievalPublicationJobs")
      .index("by_rebuild_child_authority", (query) =>
        query
          .eq("rebuildRunKey", input.rebuildRunKey)
          .eq("originKind", input.originKind)
          .eq("operation", input.operation ?? "publish")
          .eq("sourceRevisionKey", input.sourceRevisionKey)
          .eq("authorityDigest", authorityDigest),
      )
      .take(2)
      .pipe(Effect.orDie);
    if (existingJobs.length > 1)
      return yield* new RetrievalPublicationConflict({
        publicationSetKey: input.rebuildRunKey,
      });
    const childJobKey =
      existingJobs[0]?.jobKey ??
      (yield* enqueueRetrievalPublicationJobEffect(
        { ...input, authorityContext: authorityContextValue },
        now,
      ));
    const manifests = yield* reader
      .table("retrievalRebuildChildren")
      .index("by_run_child", (query) =>
        query
          .eq("rebuildRunKey", input.rebuildRunKey)
          .eq("childJobKey", childJobKey),
      )
      .take(2)
      .pipe(Effect.orDie);
    if (manifests.length > 1)
      return yield* new RetrievalPublicationConflict({
        publicationSetKey: input.rebuildRunKey,
      });
    if (input.parentRebuildJobKey === undefined)
      return yield* new ValidationFailed({
        field: "parentRebuildJobKey",
        message: "Rebuild children require an emitting batch job.",
      });
    const existingManifest = manifests[0];
    if (existingManifest !== undefined) {
      if (
        existingManifest.originKind !== input.originKind ||
        existingManifest.operation !== (input.operation ?? "publish") ||
        existingManifest.sourceKey !== input.sourceKey ||
        existingManifest.sourceRevisionKey !== input.sourceRevisionKey
      )
        return yield* new RetrievalPublicationConflict({
          publicationSetKey: input.rebuildRunKey,
        });
      return false;
    }
    yield* writer
      .table("retrievalRebuildChildren")
      .insert({
        schemaVersion: 1,
        rebuildRunKey: input.rebuildRunKey,
        childJobKey,
        parentBatchJobKey: input.parentRebuildJobKey,
        originKind: input.originKind as "page" | "slack" | "transcript",
        operation: input.operation ?? "publish",
        sourceKey: input.sourceKey,
        sourceRevisionKey: input.sourceRevisionKey,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    return true;
  });

type RebuildExecutionScope = {
  readonly connectorScopeKey?: string;
  readonly connectionKey?: string;
  readonly connectionGeneration?: number;
};

const rebuildExecutionScopeEffect = (job: RetrievalPublicationJobsDoc) =>
  Effect.gen(function* () {
    if (job.rebuildRunKey === undefined) return {};
    const rebuildRunKey = job.rebuildRunKey;
    const reader = yield* DatabaseReader;
    const runs = yield* reader
      .table("retrievalRebuildRuns")
      .index("by_run_key", (query) => query.eq("rebuildRunKey", rebuildRunKey))
      .take(2)
      .pipe(Effect.orDie);
    if (runs.length !== 1)
      return yield* new ValidationFailed({
        field: "rebuildRunKey",
        message: "Rebuild execution requires one immutable run parent.",
      });
    const run = runs[0];
    if (run === undefined)
      return yield* new ValidationFailed({
        field: "rebuildRunKey",
        message: "Rebuild execution requires one immutable run parent.",
      });
    return {
      ...(run.connectorScopeKey === undefined
        ? {}
        : { connectorScopeKey: run.connectorScopeKey }),
      ...(run.connectionKey === undefined
        ? {}
        : { connectionKey: run.connectionKey }),
      ...(run.connectionKey === undefined ||
      run.configuration.connectionGeneration === undefined
        ? {}
        : {
            connectionGeneration: run.configuration.connectionGeneration,
          }),
    } satisfies RebuildExecutionScope;
  });

const rebuildSetDifferenceBatchEffect = (
  job: RetrievalPublicationJobsDoc,
  executionScope: RebuildExecutionScope,
  now: number,
) =>
  Effect.gen(function* () {
    if (
      job.rebuild === undefined ||
      job.rebuildRunKey === undefined ||
      job.rebuildRunGeneration === undefined ||
      job.rebuildLedgerHighWater === undefined ||
      job.rebuildPauseEpoch === undefined
    )
      return yield* new ValidationFailed({
        field: "rebuildRunKey",
        message: "Set difference requires immutable rebuild authority.",
      });
    const reader = yield* DatabaseReader;
    const corpusKey = corpusKeyForJob(job.originKind);
    const subjects = yield* (
      executionScope.connectorScopeKey !== undefined
        ? reader
            .table("retrievalPublicationSubjects")
            .index("by_workspace_brain_corpus_connector_subject", (query) => {
              const scoped = query
                .eq("workspaceId", job.workspaceId)
                .eq("brainKey", job.brainKey)
                .eq("corpusKey", corpusKey)
                .eq("connectorScopeKey", executionScope.connectorScopeKey);
              return job.rebuild?.afterSourceKey === undefined
                ? scoped
                : scoped.gt(
                    "publicationSubjectKey",
                    job.rebuild.afterSourceKey,
                  );
            })
            .take(job.rebuild.limit + 1)
        : executionScope.connectionKey !== undefined &&
            executionScope.connectionGeneration !== undefined
          ? reader
              .table("retrievalPublicationSubjects")
              .index(
                "by_workspace_brain_corpus_connection_subject",
                (query) => {
                  const scoped = query
                    .eq("workspaceId", job.workspaceId)
                    .eq("brainKey", job.brainKey)
                    .eq("corpusKey", corpusKey)
                    .eq("connectionKey", executionScope.connectionKey)
                    .eq(
                      "connectionGeneration",
                      executionScope.connectionGeneration,
                    );
                  return job.rebuild?.afterSourceKey === undefined
                    ? scoped
                    : scoped.gt(
                        "publicationSubjectKey",
                        job.rebuild.afterSourceKey,
                      );
                },
              )
              .take(job.rebuild.limit + 1)
          : reader
              .table("retrievalPublicationSubjects")
              .index("by_workspace_brain_corpus_subject", (query) => {
                const scoped = query
                  .eq("workspaceId", job.workspaceId)
                  .eq("brainKey", job.brainKey)
                  .eq("corpusKey", corpusKey);
                return job.rebuild?.afterSourceKey === undefined
                  ? scoped
                  : scoped.gt(
                      "publicationSubjectKey",
                      job.rebuild.afterSourceKey,
                    );
              })
              .take(job.rebuild.limit + 1)
    ).pipe(Effect.orDie);
    const batch = subjects.slice(0, job.rebuild.limit);
    let emitted = 0;
    for (const subject of batch) {
      if (subject.currentPublicationSetKey === null) continue;
      const currentOrigin =
        subject.originKind === "page"
          ? yield* reader
              .table("brainPages")
              .index("by_workspace_page_key", (query) =>
                query
                  .eq("workspaceId", job.workspaceId)
                  .eq("pageKey", subject.sourceKey),
              )
              .first()
              .pipe(Effect.map(Option.getOrNull), Effect.orDie)
          : subject.originKind === "slack"
            ? yield* reader
                .table("sourceArtifacts")
                .index("by_org_source_key", (query) =>
                  query
                    .eq("organizationKey", job.organizationKey)
                    .eq("sourceKey", subject.sourceKey),
                )
                .first()
                .pipe(Effect.map(Option.getOrNull), Effect.orDie)
            : subject.originKind === "transcript"
              ? yield* reader
                  .table("sourceUnits")
                  .index("by_unit_key", (query) =>
                    query
                      .eq("organizationKey", job.organizationKey)
                      .eq("unitKey", subject.sourceKey),
                  )
                  .first()
                  .pipe(Effect.map(Option.getOrNull), Effect.orDie)
              : null;
      const originStillOwnsSubject =
        currentOrigin !== null &&
        (subject.connectorScopeKey === undefined ||
          ("channelKey" in currentOrigin &&
            currentOrigin.channelKey === subject.connectorScopeKey)) &&
        (subject.connectionKey === undefined ||
          ("connectionKey" in currentOrigin &&
            currentOrigin.connectionKey === subject.connectionKey)) &&
        (subject.connectionGeneration === undefined ||
          ("connectionGeneration" in currentOrigin &&
            currentOrigin.connectionGeneration ===
              subject.connectionGeneration));
      const originActive =
        subject.originKind === "page"
          ? currentOrigin !== null &&
            "status" in currentOrigin &&
            currentOrigin.status === "active"
          : subject.originKind === "slack" ||
              subject.originKind === "transcript"
            ? currentOrigin !== null &&
              originStillOwnsSubject &&
              "lifecycle" in currentOrigin &&
              currentOrigin.lifecycle?.state === "active"
            : false;
      if (originActive) continue;
      const sets = yield* reader
        .table("retrievalPublicationSets")
        .index("by_workspace_publication_set", (query) =>
          query
            .eq("workspaceId", job.workspaceId)
            .eq("publicationSetKey", subject.currentPublicationSetKey ?? ""),
        )
        .take(2)
        .pipe(Effect.orDie);
      const currentSet = sets.length === 1 ? sets[0] : undefined;
      if (currentSet === undefined)
        return yield* new RetrievalPublicationConflict({
          publicationSetKey: subject.currentPublicationSetKey,
        });
      const directOriginKind =
        subject.originKind === "page"
          ? ("page" as const)
          : subject.originKind === "slack"
            ? ("slack" as const)
            : ("transcript" as const);
      if (
        yield* enqueueUniqueRebuildChildEffect(
          {
            organizationKey: job.organizationKey,
            workspaceId: job.workspaceId,
            brainKey: job.brainKey,
            originKind: directOriginKind,
            operation: "cleanup",
            sourceKey: subject.sourceKey,
            sourceRevisionKey: currentSet.sourceRevisionKey,
            requestGeneration: job.requestGeneration,
            ...(directOriginKind === "page"
              ? {
                  page: {
                    authority: "derived" as const,
                    authorityPolicyKey: "company-pages",
                    policyGeneration: job.requestGeneration,
                  },
                }
              : {}),
            rebuildRunKey: job.rebuildRunKey,
            rebuildRunGeneration: job.rebuildRunGeneration,
            rebuildLedgerHighWater: job.rebuildLedgerHighWater,
            rebuildPauseEpoch: job.rebuildPauseEpoch,
            parentRebuildJobKey: job.jobKey,
          },
          now,
        )
      )
        emitted += 1;
    }
    const nextAfterSourceKey = batch.at(-1)?.publicationSubjectKey;
    return {
      processed: batch.length,
      emitted,
      published: 0,
      ...(nextAfterSourceKey === undefined ? {} : { nextAfterSourceKey }),
      hasMore: subjects.length > job.rebuild.limit,
    };
  });

export const enqueueOrganizationCorpusRebuildsEffect = (input: {
  readonly organizationKey: string;
  readonly originKind: "page_rebuild" | "slack_rebuild" | "transcript_rebuild";
  readonly sourceKey: string;
  readonly sourceRevisionKey: string;
  readonly requestGeneration: number;
  readonly now: number;
}): Effect.Effect<
  string[],
  ValidationFailed,
  DatabaseReader | DatabaseWriter | Scheduler
> =>
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

const healthRowsForJob = (job: RetrievalPublicationJobsDoc) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const corpusKey = corpusKeyForJob(job.originKind);
    const rows = yield* reader
      .table("brainCorpusHealth")
      .index("by_workspace_brain_corpus_scope_connection", (index) =>
        index
          .eq("workspaceId", job.workspaceId)
          .eq("brainKey", job.brainKey)
          .eq("corpusKey", corpusKey)
          .eq("connectorScopeKey", job.authorityEnvelope?.connectorScopeKey)
          .eq(
            "connectionGeneration",
            job.authorityEnvelope?.configuration.connectionGeneration,
          ),
      )
      .take(2)
      .pipe(Effect.orDie);
    if (rows.length > 1)
      return yield* Effect.dieMessage(
        "More than one corpus-health row owns the exact configuration tuple.",
      );
    return { corpusKey, rows };
  });

export const completedRebuildFailureState = (input: {
  readonly failedCount: number;
  readonly degradedReason?: string | undefined;
}) => ({
  coverageStatus:
    input.failedCount === 0 ? ("complete" as const) : ("partial" as const),
  failedCount: input.failedCount,
  ...(input.failedCount === 0
    ? { degradedReason: undefined }
    : input.degradedReason === undefined
      ? {}
      : { degradedReason: input.degradedReason }),
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
          ...(job.authorityEnvelope?.connectorScopeKey === undefined
            ? {}
            : {
                connectorScopeKey: job.authorityEnvelope.connectorScopeKey,
              }),
          ...(job.authorityEnvelope?.configuration.connectionGeneration ===
          undefined
            ? {}
            : {
                connectionGeneration:
                  job.authorityEnvelope.configuration.connectionGeneration,
              }),
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
          ...completedRebuildFailureState(row),
          lastReconciledAt: at,
          ...(corpusKey === "brain-pages"
            ? {
                discoveredCount: counts.discovered,
                publishedCount: counts.published,
              }
            : {}),
          updatedAt: at,
        })
        .pipe(Effect.orDie);
  });

const markPublicationFailure = (
  job: RetrievalPublicationJobsDoc,
  lastErrorTag: string,
  at: number,
  kind: "dead letter" | "integrity failure",
) =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
    const { corpusKey, rows } = yield* healthRowsForJob(job);
    const degradedReason = `Publication ${kind}: ${lastErrorTag}.`;
    if (rows.length === 0) {
      yield* writer
        .table("brainCorpusHealth")
        .insert({
          schemaVersion: 1,
          organizationKey: job.organizationKey,
          workspaceId: job.workspaceId,
          brainKey: job.brainKey,
          corpusKey,
          ...(job.authorityEnvelope?.connectorScopeKey === undefined
            ? {}
            : {
                connectorScopeKey: job.authorityEnvelope.connectorScopeKey,
              }),
          ...(job.authorityEnvelope?.configuration.connectionGeneration ===
          undefined
            ? {}
            : {
                connectionGeneration:
                  job.authorityEnvelope.configuration.connectionGeneration,
              }),
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

const markPublicationDeadLetter = (
  job: RetrievalPublicationJobsDoc,
  lastErrorTag: string,
  at: number,
) => markPublicationFailure(job, lastErrorTag, at, "dead letter");

const resolvePublicationHealthFailureEffect = (
  job: RetrievalPublicationJobsDoc,
  at: number,
) =>
  Effect.gen(function* () {
    if (job.healthFailureActive !== true) return;
    const writer = yield* DatabaseWriter;
    const { rows } = yield* healthRowsForJob(job);
    const row = rows[0];
    if (row === undefined || row.failedCount < 1)
      return yield* Effect.dieMessage(
        "The publication failure marker has no matching corpus-health failure.",
      );
    const failedCount = row.failedCount - 1;
    yield* writer
      .table("brainCorpusHealth")
      .patch(row._id, {
        failedCount,
        coverageStatus: "partial",
        ...(failedCount === 0 ? { degradedReason: undefined } : {}),
        updatedAt: at,
      })
      .pipe(Effect.orDie);
  });

const resolveAttributedPublicationRepairEffect = (
  job: RetrievalPublicationJobsDoc,
  at: number,
) =>
  Effect.gen(function* () {
    const repairOfJobKey = job.authorityEnvelope?.repairOfJobKey;
    if (job.effectClass !== "attributed_repair" || repairOfJobKey === undefined)
      return;
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const originals = yield* reader
      .table("retrievalPublicationJobs")
      .index("by_job_key", (query) => query.eq("jobKey", repairOfJobKey))
      .take(2)
      .pipe(Effect.orDie);
    const original = originals[0];
    if (
      originals.length !== 1 ||
      original === undefined ||
      original.status !== "dead_letter"
    )
      return yield* Effect.dieMessage(
        "The attributed publication repair lost its exact dead-letter authority.",
      );
    yield* writer
      .table("retrievalPublicationJobs")
      .patch(original._id, {
        status: "superseded",
        supersededByJobKey: job.jobKey,
        lastErrorTag: "AttributedRepairSucceeded",
        healthFailureActive: false,
        completedAt: at,
        updatedAt: at,
      })
      .pipe(Effect.orDie);
    yield* resolvePublicationHealthFailureEffect(original, at);
  });

const markPublicationIntegrityFailure = (
  job: RetrievalPublicationJobsDoc,
  lastErrorTag: string,
  at: number,
) => markPublicationFailure(job, lastErrorTag, at, "integrity failure");

const failPublicationIntegrity = (
  job: RetrievalPublicationJobsDoc,
  at: number,
  lastErrorTag: string,
) =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
    yield* recordRebuildChildTerminalEffect(job, "blocked", at);
    yield* markRebuildRunTerminalEffect(job, "blocked", lastErrorTag, at);
    yield* markPublicationIntegrityFailure(job, lastErrorTag, at);
    const failed = {
      status: "integrity_failure" as const,
      attemptCount: job.attemptCount,
      nextAttemptAt: at,
      lastErrorTag,
      completedAt: at,
      updatedAt: at,
    };
    yield* writer
      .table("retrievalPublicationJobs")
      .patch(job._id, failed)
      .pipe(Effect.orDie);
    yield* transitionLiveCaptureChildEffect(job, "failed", at, lastErrorTag);
    return publicationJobResult({ ...job, ...failed });
  });

const runPublicationJobWithoutLeaseEffect = (
  args: RunPublicationJobInput,
): Effect.Effect<
  RunPublicationJobOutput,
  PublicationEffectError,
  PublicationMutationServices
> =>
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
        message: `Publication job ${args.jobKey} does not exist.`,
      });
    if (
      terminalPublicationJobStatuses.has(job.status) ||
      job.nextAttemptAt > args.now
    )
      return publicationJobResult(job);

    if (job.authorityEnvelope === undefined)
      return yield* deferLegacyPublicationJob(
        job,
        args.now,
        "PublicationAuthorityEnvelopeMissing",
      );
    if (job.effectClass === undefined)
      return yield* deferLegacyPublicationJob(
        job,
        args.now,
        "PublicationEffectClassMigrationRequired",
      );
    if (job.operation === undefined)
      return yield* deferLegacyPublicationJob(
        job,
        args.now,
        "PublicationOperationMigrationRequired",
      );
    if (!(yield* ingestionObligationLinkageIsValidEffect(job)))
      return yield* failPublicationIntegrity(
        job,
        args.now,
        "PublicationIngestionObligationLinkageInvalid",
      );
    if (!publicationAuthorityLinkageIsValid(job, job.authorityEnvelope))
      return yield* failPublicationIntegrity(
        job,
        args.now,
        "PublicationAuthorityLinkageInvalid",
      );
    if (
      !(yield* linkedPublicationAuthorityIsValidEffect(
        job,
        job.authorityEnvelope,
      ))
    )
      return yield* failPublicationIntegrity(
        job,
        args.now,
        "PublicationAuthorityLinkageInvalid",
      );
    const capturedContext = authorityContextFromEnvelope(job.authorityEnvelope);
    const expectedEnvelope = retrievalPublicationAuthorityEnvelope(
      jobIdentityInput(job),
      capturedContext,
      job.authorityEnvelope.capturedAt,
    );
    if (
      expectedEnvelope.authorityDigest !==
        job.authorityEnvelope.authorityDigest ||
      expectedEnvelope.stableEffectKey !== job.authorityEnvelope.stableEffectKey
    )
      return yield* failPublicationIntegrity(
        job,
        args.now,
        "PublicationAuthorityEnvelopeInvalid",
      );
    const targetResolutionStatus = yield* targetResolutionAuthorityStatusEffect(
      job,
      job.authorityEnvelope,
    );
    if (targetResolutionStatus === "migration_required")
      return yield* deferLegacyPublicationJob(
        job,
        args.now,
        "PublicationTargetLinkageMigrationRequired",
      );
    if (targetResolutionStatus === "integrity_failure")
      return yield* failPublicationIntegrity(
        job,
        args.now,
        "PublicationAuthorityLinkageInvalid",
      );
    if (targetResolutionStatus === "superseded")
      return yield* supersedePublicationJob(
        job,
        args.now,
        "PublicationAuthoritySuperseded",
      );
    const rebuildRunStatus = yield* rebuildRunAuthorityStatusEffect(job);
    if (rebuildRunStatus === "migration_required")
      return yield* deferLegacyPublicationJob(
        job,
        args.now,
        "PublicationRebuildRunMigrationRequired",
      );
    if (rebuildRunStatus === "integrity_failure")
      return yield* failPublicationIntegrity(
        job,
        args.now,
        "PublicationRebuildRunIntegrityFailure",
      );
    if (rebuildRunStatus === "superseded")
      return yield* supersedePublicationJob(
        job,
        args.now,
        "PublicationRebuildRunSuperseded",
      );
    const currentContext = yield* capturePublicationAuthorityContextEffect(
      {
        ...jobIdentityInput(job),
        workspaceId: job.workspaceId,
      },
      args.now,
      {
        ...(job.authorityEnvelope.targetResolutionIntentKey === undefined
          ? {}
          : {
              targetResolutionIntentKey:
                job.authorityEnvelope.targetResolutionIntentKey,
            }),
        ...(job.authorityEnvelope.targetResolutionGeneration === undefined
          ? {}
          : {
              targetResolutionGeneration:
                job.authorityEnvelope.targetResolutionGeneration,
            }),
        ...(job.authorityEnvelope.repairOfJobKey === undefined
          ? {}
          : { repairOfJobKey: job.authorityEnvelope.repairOfJobKey }),
        ...(job.authorityEnvelope.supersedesJobKey === undefined
          ? {}
          : { supersedesJobKey: job.authorityEnvelope.supersedesJobKey }),
      },
    );
    if (
      retrievalPublicationAuthorityDigest(currentContext) !==
      job.authorityEnvelope.authorityDigest
    )
      return yield* supersedePublicationJob(
        job,
        args.now,
        "PublicationAuthoritySuperseded",
      );

    const caller = {
      kind: "system" as const,
      name: "retrieval-publication-job",
      surface: "internal" as const,
    };
    const execution = Effect.gen(function* () {
      if (job.operation === "cleanup") {
        const publicationSubjectKey =
          job.authorityEnvelope?.publicationSubjectKey;
        if (publicationSubjectKey === undefined)
          return yield* new ValidationFailed({
            field: "publicationSubjectKey",
            message: "Cleanup requires an exact publication subject.",
          });
        const value = yield* cleanupPublicationSubjectEffect({
          organizationKey: job.organizationKey,
          workspaceId: job.workspaceId,
          brainKey: job.brainKey,
          publicationSubjectKey,
          now: args.now,
        });
        return { kind: "publication" as const, value };
      }
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
      if (job.originKind === "document") {
        const value = yield* publishDocumentRevisionEffect({
          job,
          now: args.now,
        });
        return { kind: "publication" as const, value };
      }
      if (job.rebuild === undefined)
        return yield* new ValidationFailed({
          field: "rebuild",
          message: "Rebuild cursor and limit are required.",
        });
      if (
        job.rebuildRunKey === undefined ||
        job.rebuildRunGeneration === undefined ||
        job.rebuildLedgerHighWater === undefined ||
        job.rebuildPauseEpoch === undefined
      )
        return yield* new ValidationFailed({
          field: "rebuildRunKey",
          message: "Rebuild child authority is required.",
        });
      if (job.rebuild.phase === "set_difference")
        return {
          kind: "rebuild" as const,
          value: yield* rebuildSetDifferenceBatchEffect(
            job,
            yield* rebuildExecutionScopeEffect(job),
            args.now,
          ),
        };
      if (job.rebuild.phase === "close")
        return {
          kind: "rebuild" as const,
          value: {
            processed: 0,
            emitted: 0,
            published: 0,
            hasMore: false,
          },
        };
      if (job.originKind === "page_rebuild") {
        const result = yield* rebuildPageBatchEffect({
          organizationKey: job.organizationKey,
          workspaceId: job.workspaceId,
          brainKey: job.brainKey,
          ledgerHighWater:
            job.rebuild.phaseHighWater ?? job.rebuildLedgerHighWater,
          rebuildChildAuthority: {
            rebuildRunKey: job.rebuildRunKey,
            rebuildRunGeneration: job.rebuildRunGeneration,
            rebuildLedgerHighWater: job.rebuildLedgerHighWater,
            rebuildPauseEpoch: job.rebuildPauseEpoch,
            parentRebuildJobKey: job.jobKey,
            requestGeneration: job.requestGeneration,
          },
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
      const executionScope = yield* rebuildExecutionScopeEffect(job);
      const value = yield* rebuild({
        organizationKey: job.organizationKey,
        workspaceId: job.workspaceId,
        brainKey: job.brainKey,
        ledgerHighWater:
          job.rebuild.phaseHighWater ?? job.rebuildLedgerHighWater,
        rebuildChildAuthority: {
          rebuildRunKey: job.rebuildRunKey,
          rebuildRunGeneration: job.rebuildRunGeneration,
          rebuildLedgerHighWater: job.rebuildLedgerHighWater,
          rebuildPauseEpoch: job.rebuildPauseEpoch,
          parentRebuildJobKey: job.jobKey,
          requestGeneration: job.requestGeneration,
        },
        ...executionScope,
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
      let rebuildResultDigest: string | undefined;
      if (exit.value.kind === "rebuild") {
        if (
          job.rebuild === undefined ||
          job.rebuildRunKey === undefined ||
          job.rebuildRunGeneration === undefined ||
          job.rebuildLedgerHighWater === undefined ||
          job.rebuildPauseEpoch === undefined ||
          job.rebuildPredecessorDigest === undefined
        )
          return yield* new ValidationFailed({
            field: "rebuildRunKey",
            message: "Rebuild execution is missing immutable run authority.",
          });
        const phase = job.rebuild.phase ?? "scan";
        const afterSourceKey = exit.value.value.nextAfterSourceKey;
        if (exit.value.value.hasMore && afterSourceKey === undefined)
          return yield* new ValidationFailed({
            field: "rebuild.afterSourceKey",
            message: "A rebuild with more rows must return its next cursor.",
          });
        const rebuildRunKey = job.rebuildRunKey;
        rebuildResultDigest = `sha256:${sha256Hex(
          JSON.stringify({
            rebuildRunKey,
            runGeneration: job.rebuildRunGeneration,
            jobKey: job.jobKey,
            predecessorDigest: job.rebuildPredecessorDigest,
            phase,
            phaseHighWater: job.rebuild.phaseHighWater ?? null,
            afterSourceKey: job.rebuild.afterSourceKey ?? null,
            nextAfterSourceKey: afterSourceKey ?? null,
            processed: exit.value.value.processed,
            emitted: exit.value.value.emitted,
            published: exit.value.value.published,
            hasMore: exit.value.value.hasMore,
          }),
        )}`;
        const runs = yield* reader
          .table("retrievalRebuildRuns")
          .index("by_run_key", (query) =>
            query.eq("rebuildRunKey", rebuildRunKey),
          )
          .take(2)
          .pipe(Effect.orDie);
        const run = runs.length === 1 ? runs[0] : undefined;
        if (run === undefined)
          return yield* new ValidationFailed({
            field: "rebuildRunKey",
            message: "Rebuild run disappeared during execution.",
          });
        const discoveredCount =
          (job.rebuild.discoveredCount ?? 0) + exit.value.value.processed;
        const publishedCount =
          (job.rebuild.publishedCount ?? 0) + exit.value.value.published;
        let nextPhase:
          "scan" | "catch_up" | "set_difference" | "close" | undefined;
        let nextAfterSourceKey: string | undefined;
        let nextPhaseHighWater = job.rebuild.phaseHighWater;
        let nextPhaseStateDigest: string | undefined;
        if (exit.value.value.hasMore) {
          nextPhase = phase;
          nextAfterSourceKey = afterSourceKey;
        } else if (phase === "scan") {
          nextPhase = "catch_up";
          const nextLedgerState = yield* rebuildLedgerStateEffect({
            ...jobIdentityInput(job),
            workspaceId: job.workspaceId,
          });
          nextPhaseHighWater = nextLedgerState.highWater;
          nextPhaseStateDigest = nextLedgerState.stateDigest;
        } else if (phase === "catch_up") {
          nextPhase = "set_difference";
        } else if (phase === "set_difference") {
          nextPhase = "close";
        } else {
          const currentLedgerState = yield* rebuildLedgerStateEffect({
            ...jobIdentityInput(job),
            workspaceId: job.workspaceId,
          });
          if (currentLedgerState.stateDigest !== run.catchupStateDigest) {
            nextPhase = "catch_up";
            nextPhaseHighWater = currentLedgerState.highWater;
            nextPhaseStateDigest = currentLedgerState.stateDigest;
          }
        }
        const runProgress = {
          headDigest: rebuildResultDigest,
          emittedChildCount: run.emittedChildCount + exit.value.value.emitted,
          terminalChildCount: run.terminalChildCount,
          publishedChildCount:
            run.publishedChildCount + exit.value.value.published,
          ...(phase === "scan" && !exit.value.value.hasMore
            ? { scanDigest: rebuildResultDigest }
            : {}),
          ...(phase === "catch_up" && !exit.value.value.hasMore
            ? { catchupDigest: rebuildResultDigest }
            : {}),
          ...(phase === "set_difference"
            ? { setDifferenceDigest: rebuildResultDigest }
            : {}),
          ...(phase === "scan" && nextPhase === "catch_up"
            ? {
                catchupHighWater: nextPhaseHighWater,
                catchupStateDigest: nextPhaseStateDigest,
              }
            : {}),
          ...(phase === "close" && nextPhase === "catch_up"
            ? {
                catchupHighWater: nextPhaseHighWater,
                catchupStateDigest: nextPhaseStateDigest,
              }
            : {}),
          updatedAt: args.now,
        };
        if (nextPhase !== undefined) {
          yield* writer
            .table("retrievalRebuildRuns")
            .patch(run._id, runProgress)
            .pipe(Effect.orDie);
          yield* enqueueRetrievalPublicationJobEffect(
            {
              organizationKey: job.organizationKey,
              workspaceId: job.workspaceId,
              brainKey: job.brainKey,
              originKind: job.originKind,
              sourceKey: job.sourceKey,
              sourceRevisionKey: job.sourceRevisionKey,
              requestGeneration: job.requestGeneration,
              rebuildRunKey: job.rebuildRunKey,
              rebuildRunGeneration: job.rebuildRunGeneration,
              rebuildLedgerHighWater: job.rebuildLedgerHighWater,
              rebuildPauseEpoch: job.rebuildPauseEpoch,
              rebuildPredecessorDigest: rebuildResultDigest,
              rebuild: {
                phase: nextPhase,
                ...(nextPhaseHighWater === undefined
                  ? {}
                  : { phaseHighWater: nextPhaseHighWater }),
                ...(nextAfterSourceKey === undefined
                  ? {}
                  : { afterSourceKey: nextAfterSourceKey }),
                limit: job.rebuild.limit,
                discoveredCount,
                publishedCount,
              },
              authorityContext: authorityContextFromEnvelope(
                job.authorityEnvelope,
              ),
            },
            args.now,
          );
        } else {
          if (
            run.scanDigest === undefined ||
            run.catchupDigest === undefined ||
            run.setDifferenceDigest === undefined ||
            run.catchupHighWater === undefined ||
            run.catchupStateDigest === undefined
          )
            return yield* new ValidationFailed({
              field: "rebuildRunKey",
              message: "Rebuild close is missing phase receipts.",
            });
          const pendingManifests = yield* reader
            .table("retrievalRebuildChildren")
            .index("by_run_status_child", (query) =>
              query
                .eq("rebuildRunKey", run.rebuildRunKey)
                .eq("status", "pending"),
            )
            .take(2)
            .pipe(Effect.orDie);
          const pendingManifest = pendingManifests[0];
          if (pendingManifest !== undefined) {
            const manifestedJobs = yield* reader
              .table("retrievalPublicationJobs")
              .index("by_job_key", (query) =>
                query.eq("jobKey", pendingManifest.childJobKey),
              )
              .take(2)
              .pipe(Effect.orDie);
            const manifestedJob =
              manifestedJobs.length === 1 ? manifestedJobs[0] : undefined;
            if (
              manifestedJob === undefined ||
              (manifestedJob.status !== "pending" &&
                manifestedJob.status !== "retry_wait") ||
              !rebuildChildManifestMatchesJob(pendingManifest, manifestedJob)
            ) {
              yield* blockRebuildChildManifestEffect(
                pendingManifest,
                args.now,
                "RebuildChildManifestMismatch",
              );
              return yield* failPublicationIntegrity(
                job,
                args.now,
                "PublicationRebuildChildManifestInvalid",
              );
            }
          }
          const [pending, retryWait] = yield* Effect.all([
            reader
              .table("retrievalPublicationJobs")
              .index("by_rebuild_run_status", (query) =>
                query
                  .eq("rebuildRunKey", job.rebuildRunKey)
                  .eq("status", "pending"),
              )
              .take(2),
            reader
              .table("retrievalPublicationJobs")
              .index("by_rebuild_run_status", (query) =>
                query
                  .eq("rebuildRunKey", job.rebuildRunKey)
                  .eq("status", "retry_wait"),
              )
              .take(2),
          ]).pipe(Effect.orDie);
          const outstandingJobs = [...pending, ...retryWait].filter(
            (candidate) => candidate._id !== job._id,
          );
          if (pendingManifest === undefined && outstandingJobs.length > 0)
            return yield* failPublicationIntegrity(
              job,
              args.now,
              "PublicationRebuildChildManifestMissing",
            );
          if (pendingManifest !== undefined) {
            yield* writer
              .table("retrievalRebuildRuns")
              .patch(run._id, {
                status: "closing",
                updatedAt: args.now,
              })
              .pipe(Effect.orDie);
            const waiting = {
              status: "retry_wait" as const,
              attemptCount,
              nextAttemptAt:
                args.now +
                PUBLICATION_RETRY_BASE_MS * 2 ** Math.max(0, attemptCount - 1),
              lastErrorTag: "RetrievalRebuildNotDrained",
              updatedAt: args.now,
            };
            yield* writer
              .table("retrievalPublicationJobs")
              .patch(job._id, waiting)
              .pipe(Effect.orDie);
            return publicationJobResult({ ...job, ...waiting });
          }
          const childManifests = yield* reader
            .table("retrievalRebuildChildren")
            .index("by_run_child", (query) =>
              query.eq("rebuildRunKey", run.rebuildRunKey),
            )
            .take(runProgress.emittedChildCount + 1)
            .pipe(Effect.orDie);
          const childManifestCounts = {
            pending: 0,
            published: 0,
            revoked: 0,
            superseded: 0,
            blocked: 0,
          };
          for (const manifest of childManifests)
            childManifestCounts[manifest.status] += 1;
          const terminalChildManifestCount =
            childManifestCounts.published +
            childManifestCounts.revoked +
            childManifestCounts.superseded +
            childManifestCounts.blocked;
          if (
            childManifests.length !== runProgress.emittedChildCount ||
            childManifestCounts.pending !== 0 ||
            terminalChildManifestCount !== runProgress.terminalChildCount ||
            childManifestCounts.published !== runProgress.publishedChildCount ||
            childManifestCounts.revoked !== run.revokedChildCount ||
            childManifestCounts.superseded !== run.supersededChildCount ||
            childManifestCounts.blocked !== run.blockingChildCount
          )
            return yield* failPublicationIntegrity(
              job,
              args.now,
              "PublicationRebuildChildManifestCensusInvalid",
            );
          const finalChainDigest = rebuildResultDigest;
          const receiptDigest = `sha256:${sha256Hex(
            JSON.stringify({
              rebuildRunKey: run.rebuildRunKey,
              runGeneration: run.runGeneration,
              scanDigest: run.scanDigest,
              catchupDigest: run.catchupDigest,
              setDifferenceDigest: run.setDifferenceDigest,
              catchupStateDigest: run.catchupStateDigest,
              finalChainDigest,
              emittedChildCount: runProgress.emittedChildCount,
              terminalChildCount: runProgress.terminalChildCount,
              publishedChildCount: runProgress.publishedChildCount,
              completedAt: args.now,
            }),
          )}`;
          yield* writer
            .table("retrievalRebuildRuns")
            .patch(run._id, {
              ...runProgress,
              status: "complete",
              completionReceipt: {
                catchupHighWater: run.catchupHighWater,
                catchupStateDigest: run.catchupStateDigest,
                scanDigest: run.scanDigest,
                catchupDigest: run.catchupDigest,
                setDifferenceDigest: run.setDifferenceDigest,
                finalChainDigest,
                emittedChildCount: runProgress.emittedChildCount,
                terminalChildCount: runProgress.terminalChildCount,
                publishedChildCount: runProgress.publishedChildCount,
                revokedChildCount: run.revokedChildCount,
                completedAt: args.now,
                receiptDigest,
              },
            })
            .pipe(Effect.orDie);
          if (job.originKind === "page_rebuild")
            yield* markRebuildHealthComplete(
              job,
              {
                discovered: runProgress.emittedChildCount,
                published: runProgress.publishedChildCount,
              },
              args.now,
            );
        }
      }
      if (job.parentRebuildJobKey !== undefined)
        yield* recordRebuildChildTerminalEffect(
          job,
          status === "revoked"
            ? "revoked"
            : status === "superseded"
              ? "superseded"
              : "published",
          args.now,
        );
      const completed = {
        status,
        attemptCount,
        nextAttemptAt: args.now,
        completedAt: args.now,
        lastErrorTag: undefined,
        ...(rebuildResultDigest === undefined ? {} : { rebuildResultDigest }),
        healthFailureActive: false,
        updatedAt: args.now,
      };
      yield* resolvePublicationHealthFailureEffect(job, args.now);
      yield* writer
        .table("retrievalPublicationJobs")
        .patch(job._id, completed)
        .pipe(Effect.orDie);
      yield* transitionLiveCaptureChildEffect(
        job,
        status === "succeeded" ? "complete" : "policy_excluded",
        args.now,
        null,
      );
      yield* resolveAttributedPublicationRepairEffect(job, args.now);
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
      ...(deadLetter ? { healthFailureActive: true } : {}),
      updatedAt: args.now,
    };
    yield* writer
      .table("retrievalPublicationJobs")
      .patch(job._id, failed)
      .pipe(Effect.orDie);
    yield* transitionLiveCaptureChildEffect(
      job,
      deadLetter ? "failed" : "retry_wait",
      args.now,
      lastErrorTag,
    );
    if (deadLetter) {
      yield* recordRebuildChildTerminalEffect(job, "blocked", args.now);
      yield* markRebuildRunTerminalEffect(
        job,
        "blocked",
        lastErrorTag,
        args.now,
      );
      if (job.healthFailureActive !== true)
        yield* markPublicationDeadLetter(job, lastErrorTag, args.now);
    }
    return publicationJobResult({ ...job, ...failed });
  });

export const runPublicationJobEffect = (
  args: RunPublicationJobInput,
): Effect.Effect<
  RunPublicationJobOutput,
  PublicationEffectError,
  PublicationMutationServices
> =>
  Effect.gen(function* () {
    if (args.caller.kind !== "system") return yield* new Unauthorized();
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const jobs = yield* reader
      .table("retrievalPublicationJobs")
      .index("by_job_key", (query) => query.eq("jobKey", args.jobKey))
      .take(2)
      .pipe(Effect.orDie);
    const job = jobs[0];
    if (jobs.length !== 1 || job === undefined)
      return yield* runPublicationJobWithoutLeaseEffect(args);
    if (terminalPublicationJobStatuses.has(job.status)) {
      yield* transitionLiveCaptureChildEffect(
        job,
        job.status === "succeeded"
          ? "complete"
          : job.status === "revoked" || job.status === "superseded"
            ? "policy_excluded"
            : "failed",
        args.now,
        job.lastErrorTag ?? null,
      );
      return publicationJobResult(job);
    }
    if (job.nextAttemptAt > args.now) return publicationJobResult(job);
    const claim = yield* claimPublicationJobLeaseEffect({
      job,
      now: args.now,
      leaseDurationMs: PUBLICATION_WORKER_LEASE_MS,
    });
    if (claim.status === "integrity_failure")
      return yield* failPublicationIntegrity(
        job,
        args.now,
        "PublicationWorkerLeaseIntegrityFailure",
      );
    if (claim.status === "paused") {
      const paused = {
        status: "retry_wait" as const,
        attemptCount: job.attemptCount,
        nextAttemptAt: args.now + PUBLICATION_RETRY_BASE_MS,
        lastErrorTag: "PublicationWorkersPaused",
        updatedAt: args.now,
      };
      yield* writer
        .table("retrievalPublicationJobs")
        .patch(job._id, paused)
        .pipe(Effect.orDie);
      yield* transitionLiveCaptureChildEffect(
        job,
        "retry_wait",
        args.now,
        paused.lastErrorTag,
      );
      return publicationJobResult({ ...job, ...paused });
    }
    const activated = yield* activatePublicationJobLeaseEffect({
      job,
      leaseKey: claim.leaseKey,
      expectedPauseEpoch: claim.pauseEpoch,
      now: args.now,
    });
    if (!activated) {
      const deferred = {
        status: "retry_wait" as const,
        attemptCount: job.attemptCount,
        nextAttemptAt: args.now + PUBLICATION_RETRY_BASE_MS,
        lastErrorTag: "PublicationWorkerLeaseSuperseded",
        updatedAt: args.now,
      };
      yield* writer
        .table("retrievalPublicationJobs")
        .patch(job._id, deferred)
        .pipe(Effect.orDie);
      yield* transitionLiveCaptureChildEffect(
        job,
        "retry_wait",
        args.now,
        deferred.lastErrorTag,
      );
      return publicationJobResult({ ...job, ...deferred });
    }
    const exit = yield* Effect.exit(runPublicationJobWithoutLeaseEffect(args));
    yield* releasePublicationJobLeaseEffect({
      leaseKey: claim.leaseKey,
      now: args.now,
    });
    if (Exit.isFailure(exit)) return yield* Effect.failCause(exit.cause);
    return exit.value;
  });

export const sweepPublicationJobsEffect = (
  args: Schema.Schema.Type<typeof SweepPublicationJobsArgs>,
): Effect.Effect<
  SweepPublicationJobsOutput,
  PublicationEffectError,
  PublicationMutationServices
> =>
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
    const liveParentPages = yield* Effect.all(
      (
        [
          "target_resolution_pending",
          "retry_wait",
          "capacity_blocked",
          "drain_pending",
        ] as const
      ).map((state) =>
        reader
          .table("ingestionObligations")
          .index("by_state_updated_obligation", (query) =>
            query.eq("state", state),
          )
          .take(args.limit)
          .pipe(Effect.orDie),
      ),
    );
    const liveParents = liveParentPages
      .flat()
      .filter(
        (obligation) =>
          obligation.authorityKind === "live_capture" &&
          obligation.parentIngestionObligationKey === undefined &&
          obligation.targetResolutionIntentId !== undefined,
      )
      .sort(
        (left, right) =>
          left.updatedAt - right.updatedAt ||
          left.ingestionObligationKey.localeCompare(
            right.ingestionObligationKey,
          ),
      )
      .slice(0, args.limit);
    for (const parent of liveParents)
      if (parent.targetResolutionIntentId !== undefined)
        yield* progressLiveCaptureParentEffect({
          targetResolutionIntentId: parent.targetResolutionIntentId,
          now: currentTime,
        });
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
): Effect.Effect<
  RebuildRoutedCorpusBatchOutput,
  PublicationEffectError,
  PublicationMutationServices
> =>
  Effect.gen(function* () {
    if (args.caller.kind !== "system") return yield* new Unauthorized();
    yield* validatePublicationTarget(args);
    const reader = yield* DatabaseReader;
    const connectorScopeKey = args.connectorScopeKey;
    const connectionKey = args.connectionKey;
    const connectionGeneration = args.connectionGeneration;
    const artifacts = yield* (
      connectorScopeKey !== undefined
        ? reader
            .table("sourceArtifacts")
            .index("by_org_channel_source_key", (query) => {
              const scoped = query
                .eq("organizationKey", args.organizationKey)
                .eq("channelKey", connectorScopeKey);
              return args.afterSourceKey === undefined
                ? scoped
                : scoped.gt("sourceKey", args.afterSourceKey);
            })
            .take(args.limit + 1)
        : connectionKey !== undefined && connectionGeneration !== undefined
          ? reader
              .table("sourceArtifacts")
              .index("by_org_connection_generation_source_key", (query) => {
                const scoped = query
                  .eq("organizationKey", args.organizationKey)
                  .eq("connectionKey", connectionKey)
                  .eq("connectionGeneration", connectionGeneration);
                return args.afterSourceKey === undefined
                  ? scoped
                  : scoped.gt("sourceKey", args.afterSourceKey);
              })
              .take(args.limit + 1)
          : reader
              .table("sourceArtifacts")
              .index("by_org_source_key", (query) => {
                const scoped = query.eq(
                  "organizationKey",
                  args.organizationKey,
                );
                return args.afterSourceKey === undefined
                  ? scoped
                  : scoped.gt("sourceKey", args.afterSourceKey);
              })
              .take(args.limit + 1)
    ).pipe(Effect.orDie);
    const batch = artifacts.slice(0, args.limit);
    let published = 0;
    let revoked = 0;
    let emitted = 0;
    for (const artifact of batch) {
      const revision = yield* reader
        .table("sourceRevisions")
        .index("by_source_revision_key", (query) =>
          query
            .eq("organizationKey", args.organizationKey)
            .eq("sourceRevisionKey", artifact.latestSourceRevisionKey),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      if (
        revision === null ||
        (args.ledgerHighWater !== undefined &&
          revision._creationTime > args.ledgerHighWater)
      )
        continue;
      if (args.rebuildChildAuthority !== undefined) {
        if (
          yield* enqueueUniqueRebuildChildEffect(
            {
              organizationKey: args.organizationKey,
              workspaceId: args.workspaceId,
              brainKey: args.brainKey,
              originKind: "slack",
              sourceKey: artifact.sourceKey,
              sourceRevisionKey: artifact.latestSourceRevisionKey,
              requestGeneration: args.rebuildChildAuthority.requestGeneration,
              rebuildRunKey: args.rebuildChildAuthority.rebuildRunKey,
              rebuildRunGeneration:
                args.rebuildChildAuthority.rebuildRunGeneration,
              rebuildLedgerHighWater:
                args.rebuildChildAuthority.rebuildLedgerHighWater,
              rebuildPauseEpoch: args.rebuildChildAuthority.rebuildPauseEpoch,
              parentRebuildJobKey:
                args.rebuildChildAuthority.parentRebuildJobKey,
            },
            args.now,
          )
        )
          emitted += 1;
        continue;
      }
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
      emitted,
      published,
      revoked,
      ...(nextAfterSourceKey === undefined ? {} : { nextAfterSourceKey }),
      hasMore: artifacts.length > args.limit,
    };
  });

export const rebuildTranscriptBatchEffect = (
  args: Schema.Schema.Type<typeof RebuildRoutedCorpusBatchArgs>,
): Effect.Effect<
  RebuildRoutedCorpusBatchOutput,
  PublicationEffectError,
  PublicationMutationServices
> =>
  Effect.gen(function* () {
    if (args.caller.kind !== "system") return yield* new Unauthorized();
    yield* validatePublicationTarget(args);
    const reader = yield* DatabaseReader;
    const connectionKey = args.connectionKey;
    const connectionGeneration = args.connectionGeneration;
    const units = yield* (
      connectionKey !== undefined && connectionGeneration !== undefined
        ? reader
            .table("sourceUnits")
            .index("by_org_connection_generation_unit_key", (query) => {
              const scoped = query
                .eq("organizationKey", args.organizationKey)
                .eq("connectionKey", connectionKey)
                .eq("connectionGeneration", connectionGeneration);
              return args.afterSourceKey === undefined
                ? scoped
                : scoped.gt("unitKey", args.afterSourceKey);
            })
            .take(args.limit + 1)
        : reader
            .table("sourceUnits")
            .index("by_unit_key", (query) => {
              const scoped = query.eq("organizationKey", args.organizationKey);
              return args.afterSourceKey === undefined
                ? scoped
                : scoped.gt("unitKey", args.afterSourceKey);
            })
            .take(args.limit + 1)
    ).pipe(Effect.orDie);
    const batch = units.slice(0, args.limit);
    let published = 0;
    let revoked = 0;
    let emitted = 0;
    for (const unit of batch) {
      const revision = yield* reader
        .table("sourceUnitRevisions")
        .index("by_unit_revision_key", (query) =>
          query
            .eq("organizationKey", args.organizationKey)
            .eq("unitRevisionKey", unit.currentUnitRevisionKey),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      if (
        revision === null ||
        (args.ledgerHighWater !== undefined &&
          revision._creationTime > args.ledgerHighWater)
      )
        continue;
      if (args.rebuildChildAuthority !== undefined) {
        if (
          yield* enqueueUniqueRebuildChildEffect(
            {
              organizationKey: args.organizationKey,
              workspaceId: args.workspaceId,
              brainKey: args.brainKey,
              originKind: "transcript",
              sourceKey: unit.unitKey,
              sourceRevisionKey: unit.currentUnitRevisionKey,
              requestGeneration: args.rebuildChildAuthority.requestGeneration,
              rebuildRunKey: args.rebuildChildAuthority.rebuildRunKey,
              rebuildRunGeneration:
                args.rebuildChildAuthority.rebuildRunGeneration,
              rebuildLedgerHighWater:
                args.rebuildChildAuthority.rebuildLedgerHighWater,
              rebuildPauseEpoch: args.rebuildChildAuthority.rebuildPauseEpoch,
              parentRebuildJobKey:
                args.rebuildChildAuthority.parentRebuildJobKey,
            },
            args.now,
          )
        )
          emitted += 1;
        continue;
      }
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
      emitted,
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
): Effect.Effect<
  RebuildPageBatchOutput,
  PublicationEffectError,
  PublicationMutationServices
> =>
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
    let emitted = 0;
    for (const page of batch) {
      if (page.pageKey === undefined || page.currentRevisionKey == null)
        continue;
      const revision = yield* reader
        .table("pageRevisions")
        .index("by_workspace_revision_key", (query) =>
          query
            .eq("workspaceId", args.workspaceId)
            .eq("revisionKey", page.currentRevisionKey ?? ""),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      if (
        revision === null ||
        (args.ledgerHighWater !== undefined &&
          revision._creationTime > args.ledgerHighWater)
      )
        continue;
      if (args.rebuildChildAuthority !== undefined) {
        if (
          yield* enqueueUniqueRebuildChildEffect(
            {
              organizationKey: args.organizationKey,
              workspaceId: args.workspaceId,
              brainKey: args.brainKey,
              originKind: "page",
              sourceKey: page.pageKey,
              sourceRevisionKey: page.currentRevisionKey,
              requestGeneration: args.rebuildChildAuthority.requestGeneration,
              page: {
                authority: "derived",
                authorityPolicyKey: "company-pages",
                policyGeneration: args.rebuildChildAuthority.requestGeneration,
              },
              rebuildRunKey: args.rebuildChildAuthority.rebuildRunKey,
              rebuildRunGeneration:
                args.rebuildChildAuthority.rebuildRunGeneration,
              rebuildLedgerHighWater:
                args.rebuildChildAuthority.rebuildLedgerHighWater,
              rebuildPauseEpoch: args.rebuildChildAuthority.rebuildPauseEpoch,
              parentRebuildJobKey:
                args.rebuildChildAuthority.parentRebuildJobKey,
            },
            args.now,
          )
        )
          emitted += 1;
        continue;
      }
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
      emitted,
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
