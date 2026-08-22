import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

import type {
  ProviderObservation,
  RemovalCandidate,
} from "./providerReconciliation";
import { DriveLedgerDatabaseReader } from "./driveLedgerDatabase";
import type {
  CommitDriveObservationResult,
  RecordDriveSourceOutcomeResult,
} from "./driveLedgerSchemas";

export class DriveReconciliationProjectionError extends Data.TaggedError(
  "DriveReconciliationProjectionError",
)<{
  readonly reason: "invalid_request" | "not_found" | "identity_conflict";
}> {}

const fail = (reason: DriveReconciliationProjectionError["reason"]) =>
  Effect.fail(new DriveReconciliationProjectionError({ reason }));

export const resolveDriveReconciliationObservation = (input: {
  readonly organizationKey: string;
  readonly result: CommitDriveObservationResult;
}): Effect.Effect<
  ProviderObservation | null,
  DriveReconciliationProjectionError,
  DriveLedgerDatabaseReader
> =>
  Effect.gen(function* () {
    if (
      input.result.documentRevisionKey === null ||
      input.result.membershipEdgeKey === null
    ) {
      const reader = yield* DriveLedgerDatabaseReader;
      const observations = yield* reader
        .table("documentSourceObservations")
        .index("by_organization_observation_key", (query) =>
          query
            .eq("organizationKey", input.organizationKey)
            .eq("observationKey", input.result.observationKey),
        )
        .take(2)
        .pipe(Effect.orDie);
      if (observations.length !== 1)
        return yield* fail(
          observations.length === 0 ? "not_found" : "identity_conflict",
        );
      const observation = observations[0];
      if (
        observation === undefined ||
        observation.documentRevisionKey !== null ||
        observation.membershipEdgeKey !== null ||
        observation.classification !== input.result.classification
      )
        return yield* fail("identity_conflict");
      return {
        organizationKey: input.organizationKey,
        connectionKey: observation.connectionKey,
        connectionGeneration: observation.connectionGeneration,
        membershipKey: observation.observationKey,
        providerObjectKey: observation.providerObjectKey,
        originKind: "document" as const,
        originKey: observation.documentObjectKey,
        originRevisionKey: observation.observationKey,
        ledgerSequence: observation.ledgerSequence ?? 0,
        observationDigest: `sha256:${observation.observationKey.slice("gdobs_".length)}`,
        initialObligationState: "quarantined" as const,
      };
    }
    const reader = yield* DriveLedgerDatabaseReader;
    const [revisions, memberships, objects] = yield* Effect.all([
      reader
        .table("documentSourceRevisions")
        .index("by_organization_revision_key", (query) =>
          query
            .eq("organizationKey", input.organizationKey)
            .eq(
              "documentRevisionKey",
              input.result.documentRevisionKey as string,
            ),
        )
        .take(2)
        .pipe(Effect.orDie),
      reader
        .table("documentSourceMembershipEdges")
        .index("by_organization_membership_edge_key", (query) =>
          query
            .eq("organizationKey", input.organizationKey)
            .eq("membershipEdgeKey", input.result.membershipEdgeKey as string),
        )
        .take(2)
        .pipe(Effect.orDie),
      reader
        .table("documentSourceObjects")
        .index("by_organization_object_key", (query) =>
          query
            .eq("organizationKey", input.organizationKey)
            .eq("documentObjectKey", input.result.documentObjectKey),
        )
        .take(2)
        .pipe(Effect.orDie),
    ]);
    if (
      revisions.length !== 1 ||
      memberships.length !== 1 ||
      objects.length !== 1
    )
      return yield* fail(
        revisions.length === 0 ||
          memberships.length === 0 ||
          objects.length === 0
          ? "not_found"
          : "identity_conflict",
      );
    const revision = revisions[0];
    const membership = memberships[0];
    const object = objects[0];
    if (
      revision === undefined ||
      membership === undefined ||
      object === undefined
    )
      return yield* fail("not_found");
    if (
      revision.documentObjectKey !== input.result.documentObjectKey ||
      membership.documentObjectKey !== input.result.documentObjectKey ||
      membership.documentRevisionKey !== input.result.documentRevisionKey ||
      membership.membershipEdgeKey !== input.result.membershipEdgeKey ||
      membership.providerObjectKey !== revision.providerObjectKey ||
      membership.connectorScopeKey !== revision.connectorScopeKey ||
      membership.connectionKey !== revision.connectionKey ||
      membership.connectionGeneration !== revision.connectionGeneration ||
      membership.allowlistGeneration !== revision.allowlistGeneration ||
      object.providerObjectKey !== revision.providerObjectKey
    )
      return yield* fail("identity_conflict");
    return {
      organizationKey: input.organizationKey,
      connectionKey: revision.connectionKey,
      connectionGeneration: revision.connectionGeneration,
      membershipKey: membership.membershipEdgeKey,
      providerObjectKey: revision.providerObjectKey,
      originKind: "document" as const,
      originKey: revision.documentObjectKey,
      originRevisionKey: revision.documentRevisionKey,
      ledgerSequence: revision.ledgerSequence ?? 0,
      observationDigest: `sha256:${revision.contentHash}`,
      ...(revision.tombstone
        ? {
            obligationCause: "removal" as const,
            initialObligationState: "removal_pending" as const,
          }
        : {}),
    };
  });

export const resolveDriveReconciliationOutcome = (input: {
  readonly organizationKey: string;
  readonly result: RecordDriveSourceOutcomeResult;
}): Effect.Effect<
  ProviderObservation,
  DriveReconciliationProjectionError,
  DriveLedgerDatabaseReader
> =>
  Effect.gen(function* () {
    const reader = yield* DriveLedgerDatabaseReader;
    const rows = yield* reader
      .table("documentSourceOutcomes")
      .index("by_organization_outcome_key", (query) =>
        query
          .eq("organizationKey", input.organizationKey)
          .eq("outcomeKey", input.result.outcomeKey),
      )
      .take(2)
      .pipe(Effect.orDie);
    if (rows.length !== 1)
      return yield* fail(rows.length === 0 ? "not_found" : "identity_conflict");
    const outcome = rows[0];
    if (
      outcome === undefined ||
      outcome.outcome !== input.result.outcome ||
      outcome.reason !== input.result.reason ||
      outcome.recordedAt !== input.result.recordedAt
    )
      return yield* fail("identity_conflict");
    return {
      organizationKey: input.organizationKey,
      connectionKey: outcome.connectionKey,
      connectionGeneration: outcome.connectionGeneration,
      membershipKey: outcome.outcomeKey,
      providerObjectKey: outcome.providerObjectKey,
      originKind: "document",
      originKey: outcome.providerObjectKey,
      originRevisionKey: outcome.outcomeKey,
      ledgerSequence: outcome.ledgerSequence ?? 0,
      observationDigest: `sha256:${outcome.outcomeKey.slice("gdout_".length)}`,
      initialObligationState: "quarantined",
    };
  });

export const listDriveReconciliationRemovalCandidates = (input: {
  readonly organizationKey: string;
  readonly connectorScopeKey: string;
  readonly connectionGeneration: number;
  readonly allowlistGeneration: number;
  readonly afterDocumentObjectKey: string | null;
  readonly limit: number;
}): Effect.Effect<
  Readonly<{
    candidates: readonly RemovalCandidate[];
    nextCursor: string | null;
  }>,
  DriveReconciliationProjectionError,
  DriveLedgerDatabaseReader
> =>
  Effect.gen(function* () {
    if (
      input.organizationKey.trim().length === 0 ||
      input.connectorScopeKey.trim().length === 0 ||
      !Number.isSafeInteger(input.connectionGeneration) ||
      input.connectionGeneration < 1 ||
      !Number.isSafeInteger(input.allowlistGeneration) ||
      input.allowlistGeneration < 1 ||
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100
    )
      return yield* fail("invalid_request");
    const reader = yield* DriveLedgerDatabaseReader;
    const rows = yield* reader
      .table("documentSourceScopePointers")
      .index(
        "by_scope_tuple_object",
        (query) => {
          const scoped = query
            .eq("connectorScopeKey", input.connectorScopeKey)
            .eq("connectionGeneration", input.connectionGeneration)
            .eq("allowlistGeneration", input.allowlistGeneration);
          return input.afterDocumentObjectKey === null
            ? scoped
            : scoped.gt("documentObjectKey", input.afterDocumentObjectKey);
        },
        "asc",
      )
      .take(input.limit + 1)
      .pipe(Effect.orDie);
    const page = rows.slice(0, input.limit);
    const candidates: RemovalCandidate[] = [];
    for (const pointer of page) {
      if (
        pointer.organizationKey !== input.organizationKey ||
        pointer.lifecycleState !== "live"
      )
        continue;
      const [revisions, memberships] = yield* Effect.all([
        reader
          .table("documentSourceRevisions")
          .index("by_organization_revision_key", (query) =>
            query
              .eq("organizationKey", input.organizationKey)
              .eq("documentRevisionKey", pointer.currentRevisionKey),
          )
          .take(2)
          .pipe(Effect.orDie),
        reader
          .table("documentSourceMembershipEdges")
          .index("by_organization_membership_edge_key", (query) =>
            query
              .eq("organizationKey", input.organizationKey)
              .eq("membershipEdgeKey", pointer.currentMembershipEdgeKey),
          )
          .take(2)
          .pipe(Effect.orDie),
      ]);
      if (revisions.length !== 1 || memberships.length !== 1)
        return yield* fail(
          revisions.length === 0 || memberships.length === 0
            ? "not_found"
            : "identity_conflict",
        );
      const revision = revisions[0];
      const membership = memberships[0];
      if (revision === undefined || membership === undefined)
        return yield* fail("not_found");
      if (
        revision.documentObjectKey !== pointer.documentObjectKey ||
        revision.documentRevisionKey !== pointer.currentRevisionKey ||
        membership.membershipEdgeKey !== pointer.currentMembershipEdgeKey ||
        membership.documentObjectKey !== pointer.documentObjectKey ||
        membership.documentRevisionKey !== pointer.currentRevisionKey ||
        membership.membershipState !== "active" ||
        membership.providerObjectKey !== revision.providerObjectKey
      )
        return yield* fail("identity_conflict");
      candidates.push({
        membershipKey: membership.membershipEdgeKey,
        providerObjectKey: revision.providerObjectKey,
        originKind: "document",
        originKey: revision.documentObjectKey,
        originRevisionKey: revision.documentRevisionKey,
        ledgerSequence: revision.ledgerSequence ?? 0,
      });
    }
    const last = page.at(-1);
    return {
      candidates,
      nextCursor:
        rows.length > input.limit && last !== undefined
          ? last.documentObjectKey
          : null,
    };
  });

export const loadPersistedDriveReconciliationPage = (input: {
  readonly reconciliationRunKey: string;
  readonly expectedRunGeneration: number;
  readonly expectedConnectionGeneration: number;
  readonly expectedAllowlistGeneration: number;
  readonly cursorKey: string;
  readonly expectedCursor: string | null;
  readonly expectedCursorGeneration: number;
}) =>
  Effect.gen(function* () {
    const reader = yield* DriveLedgerDatabaseReader;
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
      run.runGeneration !== input.expectedRunGeneration ||
      run.connectionGeneration !== input.expectedConnectionGeneration ||
      run.allowlistGeneration !== input.expectedAllowlistGeneration ||
      cursor.connectionGeneration !== input.expectedConnectionGeneration ||
      cursor.allowlistGeneration !== input.expectedAllowlistGeneration
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
    if (
      envelope.reconciliationRunKey !== input.reconciliationRunKey ||
      envelope.expectedCursor !== input.expectedCursor ||
      envelope.runGeneration !== input.expectedRunGeneration ||
      envelope.preparedDrivePage === undefined ||
      (!activeReplay && !finalizedReplay)
    )
      return yield* fail("identity_conflict");
    return {
      pageEnvelopeKey: envelope.pageEnvelopeKey,
      pageDigest: envelope.pageDigest,
      ledgerHighWater: envelope.ledgerHighWater,
      chunks: envelope.chunks,
      preparedDrivePage: envelope.preparedDrivePage,
    };
  });
