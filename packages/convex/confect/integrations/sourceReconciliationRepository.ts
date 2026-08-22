import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

import { DatabaseReader } from "../_generated/services";
import type { RemovalCandidate } from "./providerReconciliation";
import {
  slackReconciliationObservation,
  type PreparedSlackReconciliationPage,
} from "./slackReconciliationAdapter";
import {
  transcriptReconciliationObservation,
  type PreparedTranscriptReconciliationPage,
} from "./transcriptReconciliationAdapter";

export class SourceReconciliationProjectionError extends Data.TaggedError(
  "SourceReconciliationProjectionError",
)<{
  readonly reason: "invalid_request" | "not_found" | "identity_conflict";
}> {}

const fail = (reason: SourceReconciliationProjectionError["reason"]) =>
  Effect.fail(new SourceReconciliationProjectionError({ reason }));

const validPageRequest = (input: {
  readonly organizationKey: string;
  readonly connectorScopeKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly limit: number;
}) =>
  input.organizationKey.trim().length > 0 &&
  input.connectorScopeKey.trim().length > 0 &&
  input.connectionKey.trim().length > 0 &&
  Number.isSafeInteger(input.connectionGeneration) &&
  input.connectionGeneration > 0 &&
  Number.isSafeInteger(input.limit) &&
  input.limit > 0 &&
  input.limit <= 100;

type ScopeTuple = Readonly<{
  organizationKey: string;
  workspaceId: unknown;
  brainKey: string;
  corpusKey: string;
  providerKind: string;
  connectorScopeKey: string;
  connectionKey: string;
  connectionGeneration: number;
  allowlistGeneration: number;
}>;

const sameScopeTuple = (left: ScopeTuple, right: ScopeTuple) =>
  left.organizationKey === right.organizationKey &&
  String(left.workspaceId) === String(right.workspaceId) &&
  left.brainKey === right.brainKey &&
  left.corpusKey === right.corpusKey &&
  left.providerKind === right.providerKind &&
  left.connectorScopeKey === right.connectorScopeKey &&
  left.connectionKey === right.connectionKey &&
  left.connectionGeneration === right.connectionGeneration &&
  left.allowlistGeneration === right.allowlistGeneration;

export const listSlackReconciliationRemovalCandidates = (input: {
  readonly organizationKey: string;
  readonly connectorScopeKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly afterSourceKey: string | null;
  readonly limit: number;
}): Effect.Effect<
  Readonly<{
    candidates: readonly RemovalCandidate[];
    nextCursor: string | null;
  }>,
  SourceReconciliationProjectionError,
  DatabaseReader
> =>
  Effect.gen(function* () {
    if (!validPageRequest(input)) return yield* fail("invalid_request");
    const reader = yield* DatabaseReader;
    const rows = yield* reader
      .table("sourceArtifacts")
      .index(
        "by_org_connection_generation_source_key",
        (query) => {
          const scoped = query
            .eq("organizationKey", input.organizationKey)
            .eq("connectionKey", input.connectionKey)
            .eq("connectionGeneration", input.connectionGeneration);
          return input.afterSourceKey === null
            ? scoped
            : scoped.gt("sourceKey", input.afterSourceKey);
        },
        "asc",
      )
      .take(input.limit + 1)
      .pipe(Effect.orDie);
    const page = rows.slice(0, input.limit);
    const candidates: RemovalCandidate[] = [];
    for (const artifact of page) {
      if (
        artifact.channelKey !== input.connectorScopeKey ||
        artifact.lifecycle.state !== "active"
      )
        continue;
      const revisions = yield* reader
        .table("sourceRevisions")
        .index("by_source_revision_key", (query) =>
          query
            .eq("organizationKey", input.organizationKey)
            .eq("sourceRevisionKey", artifact.latestSourceRevisionKey),
        )
        .take(2)
        .pipe(Effect.orDie);
      if (revisions.length !== 1)
        return yield* fail(
          revisions.length === 0 ? "not_found" : "identity_conflict",
        );
      const revision = revisions[0];
      if (
        revision === undefined ||
        revision.sourceKey !== artifact.sourceKey ||
        revision.channelKey !== artifact.channelKey ||
        revision.connectionKey !== artifact.connectionKey ||
        revision.connectionGeneration !== artifact.connectionGeneration ||
        revision.tombstone
      )
        return yield* fail("identity_conflict");
      const observation = slackReconciliationObservation({
        organizationKey: input.organizationKey,
        connectionKey: input.connectionKey,
        connectionGeneration: input.connectionGeneration,
        channelKey: artifact.channelKey,
        sourceKey: artifact.sourceKey,
        sourceRevisionKey: revision.sourceRevisionKey,
        providerObjectKey: artifact.providerObjectId,
        ledgerSequence: revision.ledgerSequence ?? revision._creationTime,
        observationDigest: revision.contentHash,
      });
      candidates.push({
        membershipKey: observation.membershipKey,
        providerObjectKey: observation.providerObjectKey,
        originKind: "slack",
        originKey: observation.originKey,
        originRevisionKey: observation.originRevisionKey,
        ledgerSequence: observation.ledgerSequence,
      });
    }
    const last = page.at(-1);
    return {
      candidates,
      nextCursor:
        rows.length > input.limit && last !== undefined ? last.sourceKey : null,
    };
  });

export const listTranscriptReconciliationRemovalCandidates = (input: {
  readonly organizationKey: string;
  readonly connectorScopeKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly afterUnitKey: string | null;
  readonly limit: number;
}): Effect.Effect<
  Readonly<{
    candidates: readonly RemovalCandidate[];
    nextCursor: string | null;
  }>,
  SourceReconciliationProjectionError,
  DatabaseReader
> =>
  Effect.gen(function* () {
    if (!validPageRequest(input)) return yield* fail("invalid_request");
    const reader = yield* DatabaseReader;
    const rows = yield* reader
      .table("sourceUnits")
      .index(
        "by_org_connection_generation_unit_key",
        (query) => {
          const scoped = query
            .eq("organizationKey", input.organizationKey)
            .eq("connectionKey", input.connectionKey)
            .eq("connectionGeneration", input.connectionGeneration);
          return input.afterUnitKey === null
            ? scoped
            : scoped.gt("unitKey", input.afterUnitKey);
        },
        "asc",
      )
      .take(input.limit + 1)
      .pipe(Effect.orDie);
    const page = rows.slice(0, input.limit);
    const candidates: RemovalCandidate[] = [];
    for (const unit of page) {
      if (unit.lifecycle.state !== "active") continue;
      const revisions = yield* reader
        .table("sourceUnitRevisions")
        .index("by_unit_revision_key", (query) =>
          query
            .eq("organizationKey", input.organizationKey)
            .eq("unitRevisionKey", unit.currentUnitRevisionKey),
        )
        .take(2)
        .pipe(Effect.orDie);
      if (revisions.length !== 1)
        return yield* fail(
          revisions.length === 0 ? "not_found" : "identity_conflict",
        );
      const revision = revisions[0];
      if (
        revision === undefined ||
        revision.unitKey !== unit.unitKey ||
        revision.tombstone
      )
        return yield* fail("identity_conflict");
      const observation = transcriptReconciliationObservation({
        organizationKey: input.organizationKey,
        connectionKey: input.connectionKey,
        connectionGeneration: input.connectionGeneration,
        providerKey: unit.providerKey,
        unitKey: unit.unitKey,
        unitRevisionKey: revision.unitRevisionKey,
        externalCallId: unit.externalCallId,
        ledgerSequence: revision.ledgerSequence ?? revision._creationTime,
        observationDigest: revision.contentHash,
      });
      candidates.push({
        membershipKey: observation.membershipKey,
        providerObjectKey: observation.providerObjectKey,
        originKind: "transcript",
        originKey: observation.originKey,
        originRevisionKey: observation.originRevisionKey,
        ledgerSequence: observation.ledgerSequence,
      });
    }
    const last = page.at(-1);
    return {
      candidates,
      nextCursor:
        rows.length > input.limit && last !== undefined ? last.unitKey : null,
    };
  });

export type PersistedSourceReconciliationPage =
  | Readonly<{
      sourceChunk: "slack";
      pageEnvelopeKey: string;
      pageDigest: string;
      ledgerHighWater: number;
      chunks: readonly Readonly<{
        chunkIndex: number;
        chunkDigest: string;
        observationCount: number;
      }>[];
      preparedPage: PreparedSlackReconciliationPage;
    }>
  | Readonly<{
      sourceChunk: "transcript";
      pageEnvelopeKey: string;
      pageDigest: string;
      ledgerHighWater: number;
      chunks: readonly Readonly<{
        chunkIndex: number;
        chunkDigest: string;
        observationCount: number;
      }>[];
      preparedPage: PreparedTranscriptReconciliationPage;
    }>;

export const loadPersistedSourceReconciliationPage = (input: {
  readonly sourceChunk: "slack" | "transcript";
  readonly reconciliationRunKey: string;
  readonly expectedRunGeneration: number;
  readonly expectedConnectionGeneration: number;
  readonly expectedAllowlistGeneration: number;
  readonly cursorKey: string;
  readonly expectedCursor: string | null;
  readonly expectedCursorGeneration: number;
}): Effect.Effect<
  PersistedSourceReconciliationPage | null,
  SourceReconciliationProjectionError,
  DatabaseReader
> =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const [runs, cursors, envelopes] = yield* Effect.all([
      reader
        .table("connectorReconciliationRuns")
        .index("by_reconciliation_run_key", (query) =>
          query.eq("reconciliationRunKey", input.reconciliationRunKey),
        )
        .take(2)
        .pipe(Effect.orDie),
      reader
        .table("connectorIncrementalCursors")
        .index("by_cursor_key", (query) =>
          query.eq("cursorKey", input.cursorKey),
        )
        .take(2)
        .pipe(Effect.orDie),
      reader
        .table("connectorPageEnvelopes")
        .index("by_cursor_generation", (query) =>
          query
            .eq("cursorKey", input.cursorKey)
            .eq("expectedCursorGeneration", input.expectedCursorGeneration),
        )
        .take(2)
        .pipe(Effect.orDie),
    ]);
    if (runs.length !== 1 || cursors.length !== 1 || envelopes.length > 1)
      return yield* fail(
        runs.length === 0 || cursors.length === 0
          ? "not_found"
          : "identity_conflict",
      );
    const run = runs[0];
    const cursor = cursors[0];
    const envelope = envelopes[0];
    if (run === undefined || cursor === undefined)
      return yield* fail("not_found");
    if (
      run.providerKind !== input.sourceChunk ||
      run.runGeneration !== input.expectedRunGeneration ||
      run.connectionGeneration !== input.expectedConnectionGeneration ||
      run.allowlistGeneration !== input.expectedAllowlistGeneration ||
      cursor.connectionGeneration !== input.expectedConnectionGeneration ||
      cursor.allowlistGeneration !== input.expectedAllowlistGeneration ||
      !sameScopeTuple(run, cursor)
    )
      return yield* fail("identity_conflict");
    if (envelope === undefined) return null;
    const activeReplay =
      cursor.activeEnvelopeKey === envelope.pageEnvelopeKey &&
      cursor.providerCursor === input.expectedCursor &&
      cursor.cursorGeneration === input.expectedCursorGeneration;
    const finalizedReplay =
      cursor.activeEnvelopeKey === null &&
      cursor.providerCursor === envelope.nextCursor &&
      cursor.cursorGeneration === input.expectedCursorGeneration + 1;
    const preparedPage =
      input.sourceChunk === "slack"
        ? envelope.preparedSlackPage
        : envelope.preparedTranscriptPage;
    if (
      envelope.reconciliationRunKey !== input.reconciliationRunKey ||
      envelope.cursorKey !== input.cursorKey ||
      envelope.expectedCursor !== input.expectedCursor ||
      envelope.runGeneration !== input.expectedRunGeneration ||
      !sameScopeTuple(run, envelope) ||
      preparedPage === undefined ||
      preparedPage.connectorScopeKey !== run.connectorScopeKey ||
      preparedPage.cursorBefore !== envelope.expectedCursor ||
      preparedPage.cursorAfter !== envelope.nextCursor ||
      preparedPage.terminal !== envelope.traversalComplete ||
      envelope.preparedDrivePage !== undefined ||
      (input.sourceChunk === "slack"
        ? envelope.preparedTranscriptPage !== undefined
        : envelope.preparedSlackPage !== undefined) ||
      (!activeReplay && !finalizedReplay)
    )
      return yield* fail("identity_conflict");
    const base = {
      pageEnvelopeKey: envelope.pageEnvelopeKey,
      pageDigest: envelope.pageDigest,
      ledgerHighWater: envelope.ledgerHighWater,
      chunks: envelope.chunks,
    };
    return input.sourceChunk === "slack"
      ? {
          sourceChunk: "slack" as const,
          ...base,
          preparedPage: preparedPage as PreparedSlackReconciliationPage,
        }
      : {
          sourceChunk: "transcript" as const,
          ...base,
          preparedPage: preparedPage as PreparedTranscriptReconciliationPage,
        };
  });
