import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

import { sha256Hex } from "../shared/sha256";
import type {
  DrivePreparedWrite,
  PreparedDriveReconciliationPage,
} from "./driveLedgerSchemas";
import type {
  PreparedSlackReconciliationPage,
  PreparedSlackReconciliationWrite,
} from "./slackReconciliationAdapter";
import type {
  PreparedTranscriptReconciliationPage,
  PreparedTranscriptReconciliationWrite,
} from "./transcriptReconciliationAdapter";

export type ProviderKind = "slack" | "transcript" | "google_drive";
export type ReconciliationCorpusKey = "slack" | "transcripts" | "documents";
export type ReconciliationOriginKind = "slack" | "transcript" | "document";
export type ReconciliationRunStatus =
  | "scan"
  | "traversal_closed"
  | "apply_removals"
  | "drain_derived"
  | "complete"
  | "superseded"
  | "blocked";
export type IngestionObligationState =
  | "captured"
  | "normalization_pending"
  | "quarantined"
  | "target_resolution_pending"
  | "capacity_blocked"
  | "publication_pending"
  | "retry_wait"
  | "removal_pending"
  | "drain_pending"
  | "complete"
  | "policy_excluded"
  | "failed";

export type ReconciliationScopeAuthority = {
  readonly organizationKey: string;
  readonly workspaceId: string;
  readonly brainKey: string;
  readonly corpusKey: ReconciliationCorpusKey;
  readonly providerKind: ProviderKind;
  readonly connectorScopeKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly allowlistGeneration: number;
};

export type ConnectorCursorState = ReconciliationScopeAuthority & {
  readonly cursorKey: string;
  readonly providerCursor: string | null;
  readonly traversalComplete: boolean;
  readonly cursorGeneration: number;
  readonly activeEnvelopeKey: string | null;
  readonly lastProviderHighWater: string | null;
  readonly ledgerHighWater: number;
  readonly updatedAt: number;
};

export type ReconciliationCompletionReceipt = {
  readonly providerHighWater: string | null;
  readonly ledgerHighWater: number;
  readonly successfulObligationCount: number;
  readonly blockingObligationCount: number;
  readonly completedAt: number;
  readonly receiptDigest: string;
};

export type ReconciliationRunState = ReconciliationScopeAuthority & {
  readonly reconciliationRunKey: string;
  readonly runGeneration: number;
  readonly scopeTupleDigest: string;
  readonly status: ReconciliationRunStatus;
  readonly providerHighWater: string | null;
  readonly ledgerHighWater: number;
  readonly leaseId: string;
  readonly leaseGeneration: number;
  readonly leaseExpiresAt: number;
  readonly scanCursor: string | null;
  readonly removalCursor: string | null;
  readonly drainCursor: string | null;
  readonly observedCount: number;
  readonly obligationCount: number;
  readonly removalCandidateCount: number;
  readonly removalRequiredCount: number;
  readonly removalBacklogCount: number;
  readonly drainedCount: number;
  readonly drainBacklogCount: number;
  readonly blockingObligationCount: number;
  readonly completionReceipt: ReconciliationCompletionReceipt | null;
  readonly openedAt: number;
  readonly completedAt: number | null;
  readonly updatedAt: number;
};

export type ProviderObservation = {
  readonly organizationKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly membershipKey: string;
  readonly providerObjectKey: string;
  readonly originKind: ReconciliationOriginKind;
  readonly originKey: string;
  readonly originRevisionKey: string;
  readonly ledgerSequence: number;
  readonly observationDigest: string;
  readonly obligationCause?: "observation" | "removal" | undefined;
  readonly initialObligationState?:
    "captured" | "quarantined" | "removal_pending" | undefined;
};

export type PageChunkDescriptor = {
  readonly chunkIndex: number;
  readonly chunkDigest: string;
  readonly observationCount: number;
};

export type ProviderPageEnvelope = ReconciliationScopeAuthority & {
  readonly pageEnvelopeKey: string;
  readonly reconciliationRunKey: string;
  readonly runGeneration: number;
  readonly cursorKey: string;
  readonly expectedCursor: string | null;
  readonly expectedCursorGeneration: number;
  readonly nextCursor: string | null;
  readonly traversalComplete: boolean;
  readonly providerHighWater: string | null;
  readonly ledgerHighWater: number;
  readonly pageDigest: string;
  readonly chunks: readonly PageChunkDescriptor[];
  readonly preparedDrivePage?: PreparedDriveReconciliationPage | undefined;
  readonly preparedSlackPage?: PreparedSlackReconciliationPage | undefined;
  readonly preparedTranscriptPage?:
    PreparedTranscriptReconciliationPage | undefined;
  readonly createdAt: number;
};

export type ProviderPageChunkReceipt = {
  readonly pageChunkKey: string;
  readonly pageEnvelopeKey: string;
  readonly reconciliationRunKey: string;
  readonly chunkIndex: number;
  readonly chunkDigest: string;
  readonly observationCount: number;
  readonly seenCount: number;
  readonly obligationCount: number;
  readonly commitDigest: string;
  readonly committedAt: number;
};

export type ReconciliationSeenMarker = ReconciliationScopeAuthority & {
  readonly seenMarkerKey: string;
  readonly reconciliationRunKey: string;
  readonly runGeneration: number;
  readonly membershipKey: string;
  readonly providerObjectKey: string;
  readonly originKind: ReconciliationOriginKind;
  readonly originKey: string;
  readonly originRevisionKey: string;
  readonly ledgerSequence: number;
  readonly observationDigest: string;
  readonly seenAt: number;
};

export type PlannedIngestionObligation = ReconciliationScopeAuthority & {
  readonly ingestionObligationKey: string;
  readonly reconciliationRunKey: string;
  readonly runGeneration: number;
  readonly cause: "observation" | "removal";
  readonly membershipKey: string;
  readonly originKind: ReconciliationOriginKind;
  readonly originKey: string;
  readonly originRevisionKey: string;
  readonly ledgerSequence: number;
  readonly observationDigest: string;
  readonly state: IngestionObligationState;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type RemovalCandidate = {
  readonly membershipKey: string;
  readonly providerObjectKey: string;
  readonly originKind: ReconciliationOriginKind;
  readonly originKey: string;
  readonly originRevisionKey: string;
  readonly ledgerSequence: number;
};

export type ProviderReconciliationInvariantReason =
  | "cursor_conflict"
  | "page_conflict"
  | "chunk_conflict"
  | "lease_lost"
  | "run_superseded"
  | "scope_tuple_changed"
  | "phase_conflict"
  | "traversal_incomplete"
  | "removal_incomplete"
  | "drain_incomplete"
  | "obligation_blocked"
  | "required_intent_stale"
  | "capacity_exceeded";

export class ProviderReconciliationInvariant extends Data.TaggedError(
  "ProviderReconciliationInvariant",
)<{
  readonly reason: ProviderReconciliationInvariantReason;
  readonly detail: string;
}> {}

const fail = (reason: ProviderReconciliationInvariantReason, detail: string) =>
  Effect.fail(new ProviderReconciliationInvariant({ reason, detail }));

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([field, nested]) => `${JSON.stringify(field)}:${stableJson(nested)}`,
      )
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
};

const digest = (value: unknown): string =>
  `sha256:${sha256Hex(stableJson(value))}`;

const key = (prefix: string, value: unknown): string =>
  `${prefix}_${sha256Hex(stableJson(value))}`;

export const providerPageChunkDigest = (
  observations: readonly ProviderObservation[],
): string => digest({ observations });

export const preparedDriveChunkDigest = (
  writes: readonly DrivePreparedWrite[],
): string => digest({ driveWrites: writes });

export const preparedSlackChunkDigest = (
  writes: readonly PreparedSlackReconciliationWrite[],
): string => digest({ slackWrites: writes });

export const preparedTranscriptChunkDigest = (
  writes: readonly PreparedTranscriptReconciliationWrite[],
): string => digest({ transcriptWrites: writes });

export const reconciliationScopeTupleDigest = (
  authority: ReconciliationScopeAuthority,
): string =>
  digest({
    connectorScopeKey: authority.connectorScopeKey,
    connectionKey: authority.connectionKey,
    connectionGeneration: authority.connectionGeneration,
    allowlistGeneration: authority.allowlistGeneration,
  });

const sameAuthority = (
  left: ReconciliationScopeAuthority,
  right: ReconciliationScopeAuthority,
): boolean =>
  left.organizationKey === right.organizationKey &&
  left.workspaceId === right.workspaceId &&
  left.brainKey === right.brainKey &&
  left.corpusKey === right.corpusKey &&
  left.providerKind === right.providerKind &&
  left.connectorScopeKey === right.connectorScopeKey &&
  left.connectionKey === right.connectionKey &&
  left.connectionGeneration === right.connectionGeneration &&
  left.allowlistGeneration === right.allowlistGeneration;

const authorityKindsMatch = (
  authority: ReconciliationScopeAuthority,
): boolean =>
  (authority.providerKind === "slack" && authority.corpusKey === "slack") ||
  (authority.providerKind === "transcript" &&
    authority.corpusKey === "transcripts") ||
  (authority.providerKind === "google_drive" &&
    authority.corpusKey === "documents");

const expectedOriginKind = (
  providerKind: ProviderKind,
): ReconciliationOriginKind =>
  providerKind === "google_drive" ? "document" : providerKind;

const assertAuthoritativeRun = (input: {
  readonly run: ReconciliationRunState;
  readonly currentAuthority: ReconciliationScopeAuthority;
  readonly latestRunGeneration: number;
}) =>
  !sameAuthority(input.run, input.currentAuthority)
    ? fail(
        "scope_tuple_changed",
        "The connector scope configuration tuple no longer matches the run.",
      )
    : input.run.runGeneration !== input.latestRunGeneration
      ? fail(
          "run_superseded",
          "A successor reconciliation run owns this connector scope.",
        )
      : Effect.void;

const assertNonNegative = (
  value: number,
  field: string,
): Effect.Effect<void, ProviderReconciliationInvariant> =>
  Number.isFinite(value) && value >= 0
    ? Effect.void
    : fail("page_conflict", `${field} must be a nonnegative number.`);

export const openReconciliationRunPlan = (input: {
  readonly authority: ReconciliationScopeAuthority;
  readonly previousRunGeneration: number;
  readonly expectedPreviousRunGeneration: number;
  readonly providerHighWater: string | null;
  readonly ledgerHighWater: number;
  readonly leaseId: string;
  readonly leaseGeneration: number;
  readonly leaseExpiresAt: number;
  readonly now: number;
}) =>
  Effect.gen(function* () {
    if (!authorityKindsMatch(input.authority))
      return yield* fail(
        "scope_tuple_changed",
        "The provider kind and Brain corpus do not form a valid reconciliation authority.",
      );
    if (input.previousRunGeneration !== input.expectedPreviousRunGeneration)
      return yield* fail(
        "run_superseded",
        "The expected predecessor is not the current reconciliation run.",
      );
    yield* assertNonNegative(input.ledgerHighWater, "ledgerHighWater");
    const runGeneration = input.previousRunGeneration + 1;
    if (runGeneration < 1 || !Number.isInteger(runGeneration))
      return yield* fail(
        "run_superseded",
        "Run generations must advance monotonically by one.",
      );
    const scopeTupleDigest = reconciliationScopeTupleDigest(input.authority);
    const reconciliationRunKey = key("crun", {
      connectorScopeKey: input.authority.connectorScopeKey,
      runGeneration,
      scopeTupleDigest,
      providerHighWater: input.providerHighWater,
      ledgerHighWater: input.ledgerHighWater,
    });
    return {
      ...input.authority,
      reconciliationRunKey,
      runGeneration,
      scopeTupleDigest,
      status: "scan" as const,
      providerHighWater: input.providerHighWater,
      ledgerHighWater: input.ledgerHighWater,
      leaseId: input.leaseId,
      leaseGeneration: input.leaseGeneration,
      leaseExpiresAt: input.leaseExpiresAt,
      scanCursor: null,
      removalCursor: null,
      drainCursor: null,
      observedCount: 0,
      obligationCount: 0,
      removalCandidateCount: 0,
      removalRequiredCount: 0,
      removalBacklogCount: 0,
      drainedCount: 0,
      drainBacklogCount: 0,
      blockingObligationCount: 0,
      completionReceipt: null,
      openedAt: input.now,
      completedAt: null,
      updatedAt: input.now,
    } satisfies ReconciliationRunState;
  });

export const beginProviderPagePlan = (input: {
  readonly run: ReconciliationRunState;
  readonly currentAuthority: ReconciliationScopeAuthority;
  readonly latestRunGeneration: number;
  readonly cursor: ConnectorCursorState;
  readonly expectedCursor: string | null;
  readonly expectedCursorGeneration: number;
  readonly nextCursor: string | null;
  readonly traversalComplete: boolean;
  readonly providerHighWater: string | null;
  readonly ledgerHighWater: number;
  readonly chunks: readonly PageChunkDescriptor[];
  readonly preparedDrivePage?: PreparedDriveReconciliationPage | undefined;
  readonly preparedSlackPage?: PreparedSlackReconciliationPage | undefined;
  readonly preparedTranscriptPage?:
    PreparedTranscriptReconciliationPage | undefined;
  readonly reserveLedgerRange?: boolean | undefined;
  readonly now: number;
}) =>
  Effect.gen(function* () {
    yield* assertAuthoritativeRun(input);
    if (input.run.status !== "scan")
      return yield* fail(
        "phase_conflict",
        "Only a scanning run accepts pages.",
      );
    if (!sameAuthority(input.cursor, input.currentAuthority))
      return yield* fail(
        "scope_tuple_changed",
        "The incremental cursor belongs to another scope tuple.",
      );
    if (
      input.cursor.providerCursor !== input.expectedCursor ||
      input.cursor.cursorGeneration !== input.expectedCursorGeneration ||
      input.cursor.activeEnvelopeKey !== null
    )
      return yield* fail(
        "cursor_conflict",
        "The provider cursor or active page envelope changed.",
      );
    yield* assertNonNegative(input.ledgerHighWater, "ledgerHighWater");
    if (
      input.ledgerHighWater > input.run.ledgerHighWater &&
      input.reserveLedgerRange !== true
    )
      return yield* fail(
        "page_conflict",
        "A page ledger high-water cannot exceed the run fence.",
      );
    if (
      input.chunks.length < 1 ||
      input.chunks.length > 64 ||
      input.chunks.some(
        (chunk, index) =>
          chunk.chunkIndex !== index ||
          chunk.observationCount < 0 ||
          !Number.isInteger(chunk.observationCount),
      )
    )
      return yield* fail(
        "capacity_exceeded",
        "A provider page must declare one to 64 ordered chunks.",
      );
    const pageDigest = digest({
      connectorScopeKey: input.run.connectorScopeKey,
      runGeneration: input.run.runGeneration,
      expectedCursor: input.expectedCursor,
      nextCursor: input.nextCursor,
      traversalComplete: input.traversalComplete,
      providerHighWater: input.providerHighWater,
      ledgerHighWater: input.ledgerHighWater,
      chunks: input.chunks,
      preparedDrivePage: input.preparedDrivePage,
      preparedSlackPage: input.preparedSlackPage,
      preparedTranscriptPage: input.preparedTranscriptPage,
    });
    const pageEnvelopeKey = key("cenv", pageDigest);
    const envelope = {
      ...input.currentAuthority,
      pageEnvelopeKey,
      reconciliationRunKey: input.run.reconciliationRunKey,
      runGeneration: input.run.runGeneration,
      cursorKey: input.cursor.cursorKey,
      expectedCursor: input.expectedCursor,
      expectedCursorGeneration: input.expectedCursorGeneration,
      nextCursor: input.nextCursor,
      traversalComplete: input.traversalComplete,
      providerHighWater: input.providerHighWater,
      ledgerHighWater: input.ledgerHighWater,
      pageDigest,
      chunks: input.chunks,
      ...(input.preparedDrivePage === undefined
        ? {}
        : { preparedDrivePage: input.preparedDrivePage }),
      ...(input.preparedSlackPage === undefined
        ? {}
        : { preparedSlackPage: input.preparedSlackPage }),
      ...(input.preparedTranscriptPage === undefined
        ? {}
        : { preparedTranscriptPage: input.preparedTranscriptPage }),
      createdAt: input.now,
    } satisfies ProviderPageEnvelope;
    return {
      envelope,
      cursor: {
        ...input.cursor,
        activeEnvelopeKey: pageEnvelopeKey,
        updatedAt: input.now,
      } satisfies ConnectorCursorState,
    };
  });

export const commitProviderPageChunkPlan = (input: {
  readonly envelope: ProviderPageEnvelope;
  readonly chunkIndex: number;
  readonly chunkDigest: string;
  readonly observations: readonly ProviderObservation[];
  readonly existingReceipt: ProviderPageChunkReceipt | null;
  readonly canonicalChunkDigest?: string | undefined;
  readonly now: number;
}) =>
  Effect.gen(function* () {
    const descriptor = input.envelope.chunks[input.chunkIndex];
    if (
      descriptor === undefined ||
      descriptor.chunkDigest !== input.chunkDigest ||
      descriptor.observationCount !== input.observations.length
    )
      return yield* fail(
        "chunk_conflict",
        "The chunk body does not match its immutable page descriptor.",
      );
    if (
      input.observations.some(
        (observation) =>
          observation.organizationKey !== input.envelope.organizationKey ||
          observation.connectionKey !== input.envelope.connectionKey ||
          observation.connectionGeneration !==
            input.envelope.connectionGeneration ||
          observation.originKind !==
            expectedOriginKind(input.envelope.providerKind) ||
          !Number.isFinite(observation.ledgerSequence) ||
          observation.ledgerSequence > input.envelope.ledgerHighWater ||
          observation.ledgerSequence < 0,
      )
    )
      return yield* fail(
        "scope_tuple_changed",
        "A chunk observation is outside the page authority or ledger fence.",
      );
    if (
      (input.canonicalChunkDigest ??
        providerPageChunkDigest(input.observations)) !== input.chunkDigest
    )
      return yield* fail(
        "chunk_conflict",
        "The chunk digest does not match its canonical observation body.",
      );
    const pageChunkKey = key("cchunk", {
      pageEnvelopeKey: input.envelope.pageEnvelopeKey,
      chunkIndex: input.chunkIndex,
      chunkDigest: input.chunkDigest,
    });
    const commitDigest = digest({
      pageEnvelopeKey: input.envelope.pageEnvelopeKey,
      chunkIndex: input.chunkIndex,
      chunkDigest: input.chunkDigest,
      observations: input.observations,
    });
    if (
      input.existingReceipt !== null &&
      (input.existingReceipt.pageChunkKey !== pageChunkKey ||
        input.existingReceipt.commitDigest !== commitDigest)
    )
      return yield* fail(
        "chunk_conflict",
        "A different receipt already owns this page chunk index.",
      );
    const seenMarkers = input.observations.map(
      (observation): ReconciliationSeenMarker => ({
        organizationKey: input.envelope.organizationKey,
        workspaceId: input.envelope.workspaceId,
        brainKey: input.envelope.brainKey,
        corpusKey: input.envelope.corpusKey,
        providerKind: input.envelope.providerKind,
        connectorScopeKey: input.envelope.connectorScopeKey,
        connectionKey: input.envelope.connectionKey,
        connectionGeneration: input.envelope.connectionGeneration,
        allowlistGeneration: input.envelope.allowlistGeneration,
        seenMarkerKey: key("cseen", {
          reconciliationRunKey: input.envelope.reconciliationRunKey,
          membershipKey: observation.membershipKey,
        }),
        reconciliationRunKey: input.envelope.reconciliationRunKey,
        runGeneration: input.envelope.runGeneration,
        membershipKey: observation.membershipKey,
        providerObjectKey: observation.providerObjectKey,
        originKind: observation.originKind,
        originKey: observation.originKey,
        originRevisionKey: observation.originRevisionKey,
        ledgerSequence: observation.ledgerSequence,
        observationDigest: observation.observationDigest,
        seenAt: input.now,
      }),
    );
    const obligations = input.observations.map(
      (observation): PlannedIngestionObligation => ({
        organizationKey: input.envelope.organizationKey,
        workspaceId: input.envelope.workspaceId,
        brainKey: input.envelope.brainKey,
        corpusKey: input.envelope.corpusKey,
        providerKind: input.envelope.providerKind,
        connectorScopeKey: input.envelope.connectorScopeKey,
        connectionKey: input.envelope.connectionKey,
        connectionGeneration: input.envelope.connectionGeneration,
        allowlistGeneration: input.envelope.allowlistGeneration,
        ingestionObligationKey: key("iobl", {
          connectorScopeKey: input.envelope.connectorScopeKey,
          connectionGeneration: input.envelope.connectionGeneration,
          allowlistGeneration: input.envelope.allowlistGeneration,
          reconciliationRunKey: input.envelope.reconciliationRunKey,
          originRevisionKey: observation.originRevisionKey,
        }),
        reconciliationRunKey: input.envelope.reconciliationRunKey,
        runGeneration: input.envelope.runGeneration,
        cause: observation.obligationCause ?? "observation",
        membershipKey: observation.membershipKey,
        originKind: observation.originKind,
        originKey: observation.originKey,
        originRevisionKey: observation.originRevisionKey,
        ledgerSequence: observation.ledgerSequence,
        observationDigest: observation.observationDigest,
        state:
          observation.obligationCause === "removal"
            ? "removal_pending"
            : (observation.initialObligationState ?? "captured"),
        createdAt: input.now,
        updatedAt: input.now,
      }),
    );
    const receipt =
      input.existingReceipt ??
      ({
        pageChunkKey,
        pageEnvelopeKey: input.envelope.pageEnvelopeKey,
        reconciliationRunKey: input.envelope.reconciliationRunKey,
        chunkIndex: input.chunkIndex,
        chunkDigest: input.chunkDigest,
        observationCount: input.observations.length,
        seenCount: seenMarkers.length,
        obligationCount: obligations.length,
        commitDigest,
        committedAt: input.now,
      } satisfies ProviderPageChunkReceipt);
    return {
      receipt,
      observations: input.observations,
      seenMarkers,
      obligations,
    };
  });

export const finalizeProviderPagePlan = (input: {
  readonly cursor: ConnectorCursorState;
  readonly envelope: ProviderPageEnvelope;
  readonly receipts: readonly ProviderPageChunkReceipt[];
  readonly now: number;
}) =>
  Effect.gen(function* () {
    if (
      input.cursor.cursorKey !== input.envelope.cursorKey ||
      input.cursor.providerCursor !== input.envelope.expectedCursor ||
      input.cursor.cursorGeneration !==
        input.envelope.expectedCursorGeneration ||
      input.cursor.activeEnvelopeKey !== input.envelope.pageEnvelopeKey
    )
      return yield* fail(
        "cursor_conflict",
        "The cursor no longer owns the immutable page envelope.",
      );
    const receipts = [...input.receipts].sort(
      (left, right) => left.chunkIndex - right.chunkIndex,
    );
    if (
      receipts.length !== input.envelope.chunks.length ||
      receipts.some((receipt, index) => {
        const expected = input.envelope.chunks[index];
        return (
          expected === undefined ||
          receipt.pageEnvelopeKey !== input.envelope.pageEnvelopeKey ||
          receipt.chunkIndex !== expected.chunkIndex ||
          receipt.chunkDigest !== expected.chunkDigest ||
          receipt.observationCount !== expected.observationCount
        );
      })
    )
      return yield* fail(
        "traversal_incomplete",
        "Every declared page chunk must commit before cursor advancement.",
      );
    return {
      ...input.cursor,
      providerCursor: input.envelope.nextCursor,
      traversalComplete: input.envelope.traversalComplete,
      cursorGeneration: input.cursor.cursorGeneration + 1,
      activeEnvelopeKey: null,
      lastProviderHighWater: input.envelope.providerHighWater,
      ledgerHighWater: Math.max(
        input.cursor.ledgerHighWater,
        input.envelope.ledgerHighWater,
      ),
      updatedAt: input.now,
    } satisfies ConnectorCursorState;
  });

export const closeReconciliationTraversalPlan = (input: {
  readonly run: ReconciliationRunState;
  readonly currentAuthority: ReconciliationScopeAuthority;
  readonly latestRunGeneration: number;
  readonly traversalComplete: boolean;
  readonly activeEnvelopeKey: string | null;
  readonly now: number;
}) =>
  Effect.gen(function* () {
    yield* assertAuthoritativeRun(input);
    if (
      input.run.status !== "scan" ||
      !input.traversalComplete ||
      input.activeEnvelopeKey !== null
    )
      return yield* fail(
        "traversal_incomplete",
        "Traversal closes only after the terminal cursor and every page receipt.",
      );
    return {
      ...input.run,
      status: "traversal_closed" as const,
      scanCursor: null,
      updatedAt: input.now,
    };
  });

export const planReconciliationRemovals = (input: {
  readonly run: ReconciliationRunState;
  readonly currentAuthority: ReconciliationScopeAuthority;
  readonly latestRunGeneration: number;
  readonly seenMembershipKeys: ReadonlySet<string>;
  readonly candidates: readonly RemovalCandidate[];
}) =>
  Effect.gen(function* () {
    yield* assertAuthoritativeRun(input);
    if (
      input.run.status !== "traversal_closed" &&
      input.run.status !== "apply_removals"
    )
      return yield* fail(
        "phase_conflict",
        "Removal inference requires a successfully closed traversal.",
      );
    return input.candidates
      .filter(
        (candidate) =>
          candidate.ledgerSequence <= input.run.ledgerHighWater &&
          !input.seenMembershipKeys.has(candidate.membershipKey),
      )
      .sort((left, right) =>
        left.membershipKey.localeCompare(right.membershipKey),
      );
  });

export const isSuccessfulObligationState = (
  state: IngestionObligationState,
): boolean => state === "complete" || state === "policy_excluded";

export const isBlockingObligationState = (
  state: IngestionObligationState,
): boolean => !isSuccessfulObligationState(state);

export const ingestionObligationStates = [
  "captured",
  "normalization_pending",
  "quarantined",
  "target_resolution_pending",
  "capacity_blocked",
  "publication_pending",
  "retry_wait",
  "removal_pending",
  "drain_pending",
  "complete",
  "policy_excluded",
  "failed",
] as const satisfies readonly IngestionObligationState[];

export const blockingIngestionObligationStates =
  ingestionObligationStates.filter(isBlockingObligationState);

const allowedObligationTransitions: Readonly<
  Record<IngestionObligationState, readonly IngestionObligationState[]>
> = {
  captured: [
    "normalization_pending",
    "target_resolution_pending",
    "quarantined",
    "retry_wait",
    "failed",
  ],
  normalization_pending: [
    "target_resolution_pending",
    "quarantined",
    "retry_wait",
    "failed",
  ],
  quarantined: ["normalization_pending", "policy_excluded", "failed"],
  target_resolution_pending: [
    "capacity_blocked",
    "publication_pending",
    "policy_excluded",
    "retry_wait",
    "failed",
  ],
  capacity_blocked: ["target_resolution_pending", "retry_wait", "failed"],
  publication_pending: ["complete", "retry_wait", "failed"],
  retry_wait: [
    "normalization_pending",
    "target_resolution_pending",
    "publication_pending",
    "removal_pending",
    "drain_pending",
    "failed",
  ],
  removal_pending: ["drain_pending", "retry_wait", "failed"],
  drain_pending: ["complete", "retry_wait", "failed"],
  complete: [],
  policy_excluded: [],
  failed: ["retry_wait"],
};

export const transitionIngestionObligationPlan = (input: {
  readonly current: IngestionObligationState;
  readonly expected: IngestionObligationState;
  readonly next: IngestionObligationState;
}) =>
  input.current !== input.expected ||
  !allowedObligationTransitions[input.current].includes(input.next)
    ? fail(
        "obligation_blocked",
        `Invalid obligation transition ${input.current} -> ${input.next}.`,
      )
    : Effect.succeed(input.next);

export const completeReconciliationRunPlan = (input: {
  readonly run: ReconciliationRunState;
  readonly currentAuthority: ReconciliationScopeAuthority;
  readonly latestRunGeneration: number;
  readonly obligationStates: readonly IngestionObligationState[];
  readonly successfulObligationCount?: number;
  readonly requiredIntentCurrent: boolean;
  readonly now: number;
}) =>
  Effect.gen(function* () {
    yield* assertAuthoritativeRun(input);
    if (!input.requiredIntentCurrent)
      return yield* fail(
        "required_intent_stale",
        "The required scope intent does not match the run configuration tuple.",
      );
    if (
      input.run.status !== "drain_derived" ||
      input.run.removalCursor !== null ||
      input.run.drainCursor !== null ||
      input.run.removalBacklogCount !== 0 ||
      input.run.drainBacklogCount !== 0
    )
      return yield* fail(
        "drain_incomplete",
        "Removal and derived-drain cursors must close with no backlog.",
      );
    const blockingObligationCount = input.obligationStates.filter(
      isBlockingObligationState,
    ).length;
    if (blockingObligationCount > 0)
      return yield* fail(
        "obligation_blocked",
        `${blockingObligationCount} obligation(s) remain nonterminal.`,
      );
    const successfulObligationCount =
      input.successfulObligationCount ?? input.obligationStates.length;
    const receiptWithoutDigest = {
      providerHighWater: input.run.providerHighWater,
      ledgerHighWater: input.run.ledgerHighWater,
      successfulObligationCount,
      blockingObligationCount,
      completedAt: input.now,
    };
    return {
      ...input.run,
      status: "complete" as const,
      blockingObligationCount,
      completionReceipt: {
        ...receiptWithoutDigest,
        receiptDigest: digest({
          reconciliationRunKey: input.run.reconciliationRunKey,
          runGeneration: input.run.runGeneration,
          scopeTupleDigest: input.run.scopeTupleDigest,
          ...receiptWithoutDigest,
        }),
      },
      completedAt: input.now,
      updatedAt: input.now,
    } satisfies ReconciliationRunState;
  });
