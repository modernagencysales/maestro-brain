import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import { TestConfect } from "@confect/test";
import { defineSchema } from "convex/server";
import type { GenericId, Value } from "convex/values";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vitest";

import generatedConvexSchema from "../confect/_generated/convexSchema";
import refs from "../confect/_generated/refs";
import databaseSchema from "../confect/_generated/schema";
import {
  DatabaseReader,
  DatabaseWriter,
  MutationCtx,
} from "../confect/_generated/services";
import {
  retrievalEligibilityFenceKey,
  retrievalPublicationSubjectKey,
} from "../confect/brain/retrievalPublication";
import {
  enqueueAttributedPublicationRepairEffect,
  runPublicationJobEffect,
} from "../confect/brain/retrievalPublication.impl";
import { slackSourceLifecycleFenceIdentity } from "../confect/brain/retrievalEligibility";
import providerReconciliationImpl from "../confect/integrations/providerReconciliation.impl";
import providerReconciliationSpec from "../confect/integrations/providerReconciliation.spec";
import {
  coordinateSourceReconciliationPage,
  type SourceReconciliationInput,
  type SourceReconciliationPort,
} from "../confect/integrations/sourceReconciliationCoordinator";
import {
  listSlackReconciliationRemovalCandidates,
  loadPersistedSourceReconciliationPage,
} from "../confect/integrations/sourceReconciliationRepository";
import { prepareSlackReconciliationWrite } from "../confect/integrations/slackReconciliationAdapter";
import { prepareTranscriptReconciliationWrite } from "../confect/integrations/transcriptReconciliationAdapter";
import { sha256Hex } from "../confect/shared/sha256";
import ingestionObligationRepairEffectsSource from "../confect/tables/ingestionObligationRepairEffects";
import ingestionObligationsSource from "../confect/tables/ingestionObligations";
import providerTargetResolutionIntentsSource from "../confect/tables/providerTargetResolutionIntents";
import retrievalPublicationJobsSource from "../confect/tables/retrievalPublicationJobs";
import { seedTenancy } from "./support/seedTenancy";

const providerFunctions = RegisteredFunctions.buildForGroup<
  typeof providerReconciliationSpec
>(databaseSchema, providerReconciliationImpl, RegisteredConvexFunction.make);
const ingestionObligationRepairEffects = ingestionObligationRepairEffectsSource(
  "ingestionObligationRepairEffects",
);
const ingestionObligations = ingestionObligationsSource("ingestionObligations");
const providerTargetResolutionIntents = providerTargetResolutionIntentsSource(
  "providerTargetResolutionIntents",
);
const retrievalPublicationJobs = retrievalPublicationJobsSource(
  "retrievalPublicationJobs",
);
const testConvexSchema = defineSchema({
  ...generatedConvexSchema.tables,
  ingestionObligations: ingestionObligations.tableDefinition,
  ingestionObligationRepairEffects:
    ingestionObligationRepairEffects.tableDefinition,
  providerTargetResolutionIntents:
    providerTargetResolutionIntents.tableDefinition,
  retrievalPublicationJobs: retrievalPublicationJobs.tableDefinition,
});
const testLayer = TestConfect.layer(databaseSchema, testConvexSchema, {
  ...import.meta.glob("../convex/**/!(*.*.*)*.*s"),
  "../convex/integrations/providerReconciliation.ts": async () =>
    providerFunctions,
});
const resultSchema = <Result>(): Schema.Schema<Result, Value> =>
  Schema.Any as unknown as Schema.Schema<Result, Value>;

type Harness = TestConfect.TestConfect<typeof databaseSchema>;

const withHarness = <Result>(run: (confect: Harness) => Promise<Result>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      return yield* Effect.promise(() => run(confect));
    }).pipe(Effect.provide(testLayer())),
  );

const reconciliationRefs = refs.internal.integrations.providerReconciliation;
const organizationKey = "ag_0123456789ABCDEFGHJKMNPQRS";
const brainKey = "br_0123456789ABCDEFGHJKMNPQRS";
const now = 1_787_270_400_000;

const runPortEffect = async <Result, Error>(
  effect: Effect.Effect<Result, Error>,
): Promise<Result> => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;
  const failure = Cause.failureOption(exit.cause);
  if (Option.isSome(failure)) throw failure.value;
  throw Cause.squash(exit.cause);
};

const reconciliationPort = (confect: Harness): SourceReconciliationPort => ({
  loadPage: (args) =>
    Effect.runPromise(
      confect.run(loadPersistedSourceReconciliationPage(args), resultSchema()),
    ),
  beginPage: (args) =>
    runPortEffect(
      confect.mutation(reconciliationRefs.beginReconciliationPage, args),
    ),
  commitChunk: (args) =>
    runPortEffect(
      confect.mutation(reconciliationRefs.commitReconciliationPageChunk, args),
    ),
  finalizePage: (args) =>
    runPortEffect(
      confect.mutation(reconciliationRefs.finalizeReconciliationPage, args),
    ),
});

type SourceKind = "slack" | "transcript";

const sourceAuthority = (
  kind: SourceKind,
  workspaceId: GenericId<"workspaces">,
) => ({
  organizationKey,
  workspaceId,
  brainKey,
  corpusKey: kind === "slack" ? ("slack" as const) : ("transcripts" as const),
  providerKind: kind,
  connectorScopeKey:
    kind === "slack" ? "channel_reconciliation" : "transcript_connection_scope",
  connectionKey:
    kind === "slack" ? "slack_connection" : "transcript_connection",
  connectionGeneration: 2,
  allowlistGeneration: 3,
});

const seedTranscriptConnection = (confect: Harness) =>
  Effect.runPromise(
    confect.run(
      Effect.gen(function* () {
        const writer = yield* DatabaseWriter;
        yield* writer
          .table("providerConnections")
          .insert({
            provider: "nango",
            providerConfigKey: "fireflies",
            organizationKey,
            connectionKey: "transcript_connection",
            connectionGeneration: 2,
            status: "active",
            connectSessionId: "transcript_connect_session",
            nangoConnectionId: "transcript_nango_connection",
            nangoEndUserId: "transcript_end_user",
            nangoOrganizationId: "transcript_organization",
            correlationTag: "transcript:reconciliation",
            attemptId: "transcript_attempt",
            attemptExpiresAt: now + 60_000,
            completedAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .pipe(Effect.orDie);
      }),
      resultSchema<void>(),
    ),
  );

const openSourceRun = async (
  confect: Harness,
  kind: SourceKind,
  workspaceId: GenericId<"workspaces">,
) => {
  const authority = sourceAuthority(kind, workspaceId);
  const required = await runPortEffect(
    confect.mutation(reconciliationRefs.activateRequiredScope, {
      ...authority,
      providerContainerKey: authority.connectorScopeKey,
      activationKind: "activate",
      expectedScopeGeneration: 0,
      expectedIntentGeneration: 0,
      controllingConfigurationDigest: `sha256:${"1".repeat(64)}`,
      now,
    }),
  );
  const run = await runPortEffect(
    confect.mutation(reconciliationRefs.openReconciliationRun, {
      ...authority,
      expectedPreviousRunGeneration: 0,
      initialCursor: "cursor_1",
      providerHighWater: "provider_high_water",
      ledgerHighWater: 0,
      leaseId: `${kind}_reconciliation_lease`,
      leaseGeneration: 1,
      leaseExpiresAt: now + 60_000,
      now,
    }),
  );
  return { authority, required, run };
};

const slackWrite = (index: number) =>
  prepareSlackReconciliationWrite({
    binding: {
      providerEventId: `slack_event_${index}`,
      signatureVerification: {
        status: "verified",
        receiptHash: `sha256:${"a".repeat(64)}`,
      },
      replayVerification: {
        status: "accepted",
        receiptHash: `sha256:${"b".repeat(64)}`,
      },
      organizationKey,
      connectionKey: "slack_connection",
      connectionGeneration: 2,
      teamId: "slack_team",
      appId: "slack_app",
      botUserId: "slack_bot",
      channelKey: "channel_reconciliation",
      externalChannelId: "C_RECONCILIATION",
    },
    input: {
      envelope: {
        organizationKey,
        connectionKey: "slack_connection",
        connectionGeneration: 2,
        teamId: "slack_team",
        appId: "slack_app",
        botUserId: "slack_bot",
        channelKey: "channel_reconciliation",
        externalChannelId: "C_RECONCILIATION",
        transport: "reconciliation",
        transportDeliveryId: `slack_reconciliation_delivery_${index}`,
        receivedAt: now,
      },
      observation: {
        providerObjectId: `1724000000.000${index}`,
        threadKey: `thread_${index}`,
        sourceTimestamp: "2026-08-21T12:00:00.000Z",
        providerOrder: String(index).padStart(20, "0"),
        providerRevisionId: `slack_revision_${index}`,
        author: { providerUserId: "slack_user", displayName: "Alex" },
        text: `Canonical Slack reconciliation message ${index}`,
        blocksJson: "[]",
        permalink: `https://example.slack.com/archives/C_RECONCILIATION/p${index}`,
        tombstone: false,
        revisionNonce: `reconciliation_${index}`,
      },
      routing: {
        policyEpoch: 1,
        assemblyStage: "assembly_pending",
        effectKey: `slack_reconciliation_effect_${index}`,
      },
    },
  });

const seedSlackRoutingPolicy = (
  confect: Harness,
  organizationId: GenericId<"organizations">,
  workspaceId: GenericId<"workspaces">,
) =>
  Effect.runPromise(
    confect.run(
      Effect.gen(function* () {
        const writer = yield* DatabaseWriter;
        yield* writer
          .table("organizations")
          .patch(organizationId, { agencyKey: organizationKey })
          .pipe(Effect.orDie);
        yield* writer
          .table("workspaces")
          .patch(workspaceId, { brainKey, kind: "agency" })
          .pipe(Effect.orDie);
        yield* writer
          .table("providerConnections")
          .insert({
            provider: "nango",
            providerConfigKey: "slack",
            organizationKey,
            connectionKey: "slack_connection",
            connectionGeneration: 2,
            status: "active",
            connectSessionId: "slack_connect_session",
            nangoConnectionId: "slack_nango_connection",
            nangoEndUserId: "slack_end_user",
            nangoOrganizationId: "slack_organization",
            correlationTag: "slack:reconciliation",
            attemptId: "slack_attempt",
            attemptExpiresAt: now + 60_000,
            completedAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .pipe(Effect.orDie);
        yield* writer
          .table("channelRoutingPolicies")
          .insert({
            organizationKey,
            connectionKey: "slack_connection",
            connectionGeneration: 2,
            channelKey: "channel_reconciliation",
            policyEpoch: 1,
            active: true,
            mode: "direct",
            targetBrainKeys: [brainKey],
            historicalBackfillStartAt: now - 1,
            statusAfterApply: "streaming",
            createdByRole: "owner",
            createdAt: now,
          })
          .pipe(Effect.orDie);
      }),
      resultSchema<void>(),
    ),
  );

const transcriptWrite = (index: number) =>
  prepareTranscriptReconciliationWrite({
    receivedAt: now,
    call: {
      providerKey: "fireflies",
      connectionKey: "transcript_connection",
      externalCallId: `transcript_call_${index}`,
      externalRevisionId: `transcript_revision_${index}`,
      revisionOrder: {
        kind: "provider_timestamp",
        timestamp: `2026-08-21T12:0${index}:00.000Z`,
        source: "updated_at",
      },
      title: `Transcript call ${index}`,
      startedAt: "2026-08-21T12:00:00.000Z",
      endedAt: "2026-08-21T12:30:00.000Z",
      durationMs: 1_800_000,
      organizer: null,
      participants: [],
      segments: [
        {
          externalSegmentId: `transcript_call_${index}:0`,
          ordinal: 0,
          evidenceKind: "verbatim_transcript",
          speakerExternalId: "speaker_1",
          speakerLabel: "Alex",
          startMs: 0,
          endMs: 2_000,
          text: `Canonical transcript reconciliation text ${index}.`,
        },
      ],
      sourceUrl: `https://app.fireflies.ai/view/transcript_call_${index}`,
      recordingUrl: null,
      providerSummary: null,
      providerMetadataJson: "{}",
      deleted: false,
    },
  });

const readSourceState = (
  confect: Harness,
  input: {
    readonly kind: SourceKind;
    readonly runKey: string;
    readonly cursorKey: string;
  },
) =>
  Effect.runPromise(
    confect.run(
      Effect.gen(function* () {
        const reader = yield* DatabaseReader;
        const [cursors, envelopes, chunks, seen, obligations, sourceRows] =
          yield* Effect.all([
            reader
              .table("connectorIncrementalCursors")
              .index("by_cursor_key", (query) =>
                query.eq("cursorKey", input.cursorKey),
              )
              .take(2)
              .pipe(Effect.orDie),
            reader
              .table("connectorPageEnvelopes")
              .index("by_run_page_envelope", (query) =>
                query.eq("reconciliationRunKey", input.runKey),
              )
              .take(100)
              .pipe(Effect.orDie),
            reader
              .table("connectorPageChunks")
              .index("by_run_page_chunk", (query) =>
                query.eq("reconciliationRunKey", input.runKey),
              )
              .take(100)
              .pipe(Effect.orDie),
            reader
              .table("connectorReconciliationSeen")
              .index("by_run_ledger_sequence", (query) =>
                query.eq("reconciliationRunKey", input.runKey),
              )
              .take(100)
              .pipe(Effect.orDie),
            reader
              .table("ingestionObligations")
              .index("by_run_ledger_sequence", (query) =>
                query.eq("reconciliationRunKey", input.runKey),
              )
              .take(100)
              .pipe(Effect.orDie),
            input.kind === "slack"
              ? reader
                  .table("sourceRevisions")
                  .index("by_organization_ledger", (query) =>
                    query.eq("organizationKey", organizationKey),
                  )
                  .take(100)
                  .pipe(Effect.orDie)
              : reader
                  .table("sourceUnitRevisions")
                  .index("by_organization_ledger", (query) =>
                    query.eq("organizationKey", organizationKey),
                  )
                  .take(100)
                  .pipe(Effect.orDie),
          ]);
        return {
          cursor: cursors[0],
          envelopes,
          chunks,
          seen,
          obligations,
          sourceRows,
        };
      }),
      resultSchema(),
    ),
  );

const coordinateInput = (
  confect: Harness,
  opened: Awaited<ReturnType<typeof openSourceRun>>,
  kind: SourceKind,
  fetchPage: () => Promise<unknown>,
): SourceReconciliationInput => {
  const common = {
    reconciliationRunKey: opened.run.reconciliationRunKey,
    expectedRunGeneration: opened.run.runGeneration,
    expectedConnectionGeneration: opened.authority.connectionGeneration,
    expectedAllowlistGeneration: opened.authority.allowlistGeneration,
    expectedLeaseGeneration: 1,
    leaseId: `${kind}_reconciliation_lease`,
    cursorKey: opened.run.cursorKey,
    expectedCursor: "cursor_1",
    expectedCursorGeneration: 1,
    connectorScopeKey: opened.authority.connectorScopeKey,
    requiredScopeIntentKey: opened.required.requiredScopeIntentKey,
    providerHighWater: "provider_high_water",
    reconciliation: reconciliationPort(confect),
    now,
    chunkSize: 1,
  } as const;
  return kind === "slack"
    ? {
        ...common,
        sourceChunk: "slack",
        fetchPage: fetchPage as unknown as Extract<
          SourceReconciliationInput,
          { sourceChunk: "slack" }
        >["fetchPage"],
      }
    : {
        ...common,
        sourceChunk: "transcript",
        fetchPage: fetchPage as unknown as Extract<
          SourceReconciliationInput,
          { sourceChunk: "transcript" }
        >["fetchPage"],
      };
};

const proveAtomicReplay = (kind: SourceKind) =>
  withHarness(async (confect) => {
    const tenancy = await Effect.runPromise(
      confect.run(seedTenancy(now), resultSchema()),
    );
    if (kind === "transcript") await seedTranscriptConnection(confect);
    const opened = await openSourceRun(confect, kind, tenancy.workspaceId);
    const writes =
      kind === "slack"
        ? [slackWrite(1), slackWrite(2)]
        : [transcriptWrite(1), transcriptWrite(2)];
    const fetchPage = vi.fn(async () => ({
      writes,
      cursorAfter: "cursor_2",
      terminal: true,
    }));
    let crashBeforeChunk = true;

    await expect(
      coordinateSourceReconciliationPage({
        ...coordinateInput(confect, opened, kind, fetchPage),
        beforeReconciliationChunk: async () => {
          if (crashBeforeChunk) {
            crashBeforeChunk = false;
            throw new Error("simulated crash before atomic source chunk");
          }
        },
      } as SourceReconciliationInput),
    ).rejects.toMatchObject({
      _tag: "SourceReconciliationCoordinatorError",
      reason: "before_chunk_commit_failed",
    });

    const beforeChunk = await readSourceState(confect, {
      kind,
      runKey: opened.run.reconciliationRunKey,
      cursorKey: opened.run.cursorKey,
    });
    expect(beforeChunk.envelopes).toHaveLength(1);
    expect(beforeChunk.sourceRows).toHaveLength(0);
    expect(beforeChunk.chunks).toHaveLength(0);
    expect(beforeChunk.seen).toHaveLength(0);
    expect(beforeChunk.obligations).toHaveLength(0);
    expect(beforeChunk.cursor).toMatchObject({
      providerCursor: "cursor_1",
      cursorGeneration: 1,
    });

    await expect(
      coordinateSourceReconciliationPage({
        ...coordinateInput(confect, opened, kind, fetchPage),
        afterReconciliationChunk: async (_receipt, chunkIndex) => {
          if (chunkIndex === 0)
            throw new Error("simulated response loss after source chunk");
        },
      } as SourceReconciliationInput),
    ).rejects.toMatchObject({
      _tag: "SourceReconciliationCoordinatorError",
      reason: "after_chunk_commit_failed",
    });
    const afterResponseLoss = await readSourceState(confect, {
      kind,
      runKey: opened.run.reconciliationRunKey,
      cursorKey: opened.run.cursorKey,
    });
    expect(afterResponseLoss.sourceRows).toHaveLength(1);
    expect(afterResponseLoss.chunks).toHaveLength(1);
    expect(afterResponseLoss.seen).toHaveLength(1);
    expect(afterResponseLoss.obligations).toHaveLength(1);

    const resumed = await coordinateSourceReconciliationPage(
      coordinateInput(confect, opened, kind, fetchPage),
    );
    const complete = await readSourceState(confect, {
      kind,
      runKey: opened.run.reconciliationRunKey,
      cursorKey: opened.run.cursorKey,
    });
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(resumed.chunkReceipts.map(({ duplicate }) => duplicate)).toEqual([
      true,
      false,
    ]);
    expect(complete.sourceRows).toHaveLength(2);
    expect(complete.chunks).toHaveLength(2);
    expect(complete.seen).toHaveLength(2);
    expect(complete.obligations).toHaveLength(2);
    expect(complete.cursor).toMatchObject({
      providerCursor: "cursor_2",
      traversalComplete: true,
      cursorGeneration: 2,
      activeEnvelopeKey: null,
    });

    const finalizedReplay = await coordinateSourceReconciliationPage(
      coordinateInput(confect, opened, kind, fetchPage),
    );
    expect(
      finalizedReplay.chunkReceipts.map(({ duplicate }) => duplicate),
    ).toEqual([true, true]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

const expectLeaseConflict = async (effect: Effect.Effect<unknown, unknown>) => {
  await expect(runPortEffect(effect)).rejects.toMatchObject({
    _tag: "ProviderReconciliationConflict",
    reason: "lease_lost",
  });
};

describe("Slack and transcript reconciliation coordinator", () => {
  it("fences every stale worker mutation after lease takeover", () =>
    withHarness(async (confect) => {
      const tenancy = await Effect.runPromise(
        confect.run(seedTenancy(now), resultSchema()),
      );
      await seedSlackRoutingPolicy(
        confect,
        tenancy.organizationId,
        tenancy.workspaceId,
      );
      const opened = await openSourceRun(confect, "slack", tenancy.workspaceId);
      await expect(
        coordinateSourceReconciliationPage({
          ...coordinateInput(confect, opened, "slack", async () => ({
            writes: [slackWrite(88)],
            cursorAfter: "cursor_2",
            terminal: true,
          })),
          beforeReconciliationChunk: async () => {
            throw new Error("pause worker A before its first chunk");
          },
        }),
      ).rejects.toMatchObject({ reason: "before_chunk_commit_failed" });

      const prepared = await readSourceState(confect, {
        kind: "slack",
        runKey: opened.run.reconciliationRunKey,
        cursorKey: opened.run.cursorKey,
      });
      const envelope = prepared.envelopes[0];
      const chunk = envelope?.chunks[0];
      if (
        envelope === undefined ||
        envelope.preparedSlackPage === undefined ||
        chunk === undefined
      )
        throw new Error("missing persisted page prepared by worker A");

      await runPortEffect(
        confect.mutation(reconciliationRefs.claimReconciliationStep, {
          reconciliationRunKey: opened.run.reconciliationRunKey,
          expectedRunGeneration: opened.run.runGeneration,
          expectedConnectionGeneration: opened.authority.connectionGeneration,
          expectedAllowlistGeneration: opened.authority.allowlistGeneration,
          expectedLeaseGeneration: 1,
          leaseId: "slack_reconciliation_lease_worker_b",
          leaseDurationMs: 60_000,
          now: now + 60_001,
        }),
      );

      const staleRef = {
        reconciliationRunKey: opened.run.reconciliationRunKey,
        expectedRunGeneration: opened.run.runGeneration,
        expectedConnectionGeneration: opened.authority.connectionGeneration,
        expectedAllowlistGeneration: opened.authority.allowlistGeneration,
        expectedLeaseGeneration: 1,
        leaseId: "slack_reconciliation_lease",
      } as const;
      const unchanged = await readSourceState(confect, {
        kind: "slack",
        runKey: opened.run.reconciliationRunKey,
        cursorKey: opened.run.cursorKey,
      });

      await expectLeaseConflict(
        confect.mutation(reconciliationRefs.beginReconciliationPage, {
          ...staleRef,
          cursorKey: envelope.cursorKey,
          expectedCursor: envelope.expectedCursor,
          expectedCursorGeneration: envelope.expectedCursorGeneration,
          nextCursor: envelope.nextCursor,
          traversalComplete: envelope.traversalComplete,
          providerHighWater: envelope.providerHighWater,
          ledgerHighWater: envelope.ledgerHighWater,
          chunks: envelope.chunks,
          preparedSlackPage: envelope.preparedSlackPage,
          now: now + 60_002,
        }),
      );
      await expectLeaseConflict(
        confect.mutation(reconciliationRefs.commitReconciliationPageChunk, {
          ...staleRef,
          pageEnvelopeKey: envelope.pageEnvelopeKey,
          chunkIndex: chunk.chunkIndex,
          chunkDigest: chunk.chunkDigest,
          requiredScopeIntentKey: opened.required.requiredScopeIntentKey,
          observations: [],
          sourceChunk: "slack",
          now: now + 60_002,
        }),
      );
      await expectLeaseConflict(
        confect.mutation(reconciliationRefs.finalizeReconciliationPage, {
          ...staleRef,
          pageEnvelopeKey: envelope.pageEnvelopeKey,
          cursorKey: envelope.cursorKey,
          now: now + 60_002,
        }),
      );
      await expectLeaseConflict(
        confect.mutation(reconciliationRefs.closeReconciliationTraversal, {
          ...staleRef,
          now: now + 60_002,
        }),
      );
      await expectLeaseConflict(
        confect.mutation(reconciliationRefs.applyReconciliationRemovalBatch, {
          ...staleRef,
          requiredScopeIntentKey: opened.required.requiredScopeIntentKey,
          expectedRemovalCursor: null,
          nextRemovalCursor: null,
          finalBatch: true,
          candidates: [],
          now: now + 60_002,
        }),
      );
      await expectLeaseConflict(
        confect.mutation(reconciliationRefs.completeReconciliationRun, {
          ...staleRef,
          now: now + 60_002,
        }),
      );
      await expectLeaseConflict(
        confect.mutation(reconciliationRefs.maybeCompleteReconciliationRun, {
          ...staleRef,
          now: now + 60_002,
        }),
      );

      const after = await readSourceState(confect, {
        kind: "slack",
        runKey: opened.run.reconciliationRunKey,
        cursorKey: opened.run.cursorKey,
      });
      expect(after).toEqual(unchanged);
    }));
  it("persists Slack pages before atomic chunks and replays without provider refetch", () =>
    proveAtomicReplay("slack"));

  it("persists transcript pages before atomic chunks and replays without provider refetch", () =>
    proveAtomicReplay("transcript"));

  it("rolls back connector restore when its required intent CAS fails", () =>
    withHarness(async (confect) => {
      const tenancy = await Effect.runPromise(
        confect.run(seedTenancy(now), resultSchema()),
      );
      const authority = sourceAuthority("slack", tenancy.workspaceId);
      const activated = await runPortEffect(
        confect.mutation(reconciliationRefs.activateRequiredScope, {
          ...authority,
          providerContainerKey: authority.connectorScopeKey,
          activationKind: "activate",
          expectedScopeGeneration: 0,
          expectedIntentGeneration: 0,
          controllingConfigurationDigest: `sha256:${"2".repeat(64)}`,
          now,
        }),
      );
      await Effect.runPromise(
        confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const writer = yield* DatabaseWriter;
            const scope = yield* reader
              .table("connectorScopes")
              .index("by_connector_scope_key", (query) =>
                query.eq("connectorScopeKey", authority.connectorScopeKey),
              )
              .first()
              .pipe(Effect.map(Option.getOrNull), Effect.orDie);
            if (scope === null) throw new Error("missing connector scope");
            yield* writer
              .table("connectorScopes")
              .patch(scope._id, { state: "revoked", updatedAt: now + 1 })
              .pipe(Effect.orDie);
          }),
          resultSchema<void>(),
        ),
      );

      await expect(
        runPortEffect(
          confect.mutation(reconciliationRefs.activateRequiredScope, {
            ...authority,
            providerContainerKey: authority.connectorScopeKey,
            activationKind: "restore",
            expectedScopeGeneration: activated.scopeGeneration,
            expectedIntentGeneration: 0,
            controllingConfigurationDigest: `sha256:${"2".repeat(64)}`,
            now: now + 2,
          }),
        ),
      ).rejects.toMatchObject({
        _tag: "ProviderReconciliationConflict",
        reason: "required_intent_stale",
      });
      const afterFailedRestore = await Effect.runPromise(
        confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const scopes = yield* reader
              .table("connectorScopes")
              .index("by_connector_scope_key", (query) =>
                query.eq("connectorScopeKey", authority.connectorScopeKey),
              )
              .take(2)
              .pipe(Effect.orDie);
            const intents = yield* reader
              .table("brainRequiredScopeIntents")
              .index("by_required_scope_intent_key", (query) =>
                query.eq(
                  "requiredScopeIntentKey",
                  activated.requiredScopeIntentKey,
                ),
              )
              .take(2)
              .pipe(Effect.orDie);
            return { scope: scopes[0], intent: intents[0] };
          }),
          resultSchema(),
        ),
      );
      expect(afterFailedRestore.scope).toMatchObject({
        state: "revoked",
        scopeGeneration: 1,
      });
      expect(afterFailedRestore.intent).toMatchObject({
        state: "required",
        intentGeneration: 1,
      });

      const restored = await runPortEffect(
        confect.mutation(reconciliationRefs.activateRequiredScope, {
          ...authority,
          providerContainerKey: authority.connectorScopeKey,
          activationKind: "restore",
          expectedScopeGeneration: 1,
          expectedIntentGeneration: 1,
          controllingConfigurationDigest: `sha256:${"2".repeat(64)}`,
          now: now + 3,
        }),
      );
      expect(restored).toMatchObject({
        scopeGeneration: 2,
        intentGeneration: 2,
        state: "required",
      });
    }));

  it("blocks an unchanged successor run while an older in-scope obligation remains unresolved", () =>
    withHarness(async (confect) => {
      const tenancy = await Effect.runPromise(
        confect.run(seedTenancy(now), resultSchema()),
      );
      const first = await openSourceRun(confect, "slack", tenancy.workspaceId);
      await Effect.runPromise(
        confect.run(
          Effect.gen(function* () {
            const writer = yield* DatabaseWriter;
            yield* writer
              .table("ingestionObligations")
              .insert({
                schemaVersion: 1,
                ...first.authority,
                ingestionObligationKey: `iobl_${"f".repeat(64)}`,
                requiredScopeIntentKey: first.required.requiredScopeIntentKey,
                reconciliationRunKey: first.run.reconciliationRunKey,
                runGeneration: first.run.runGeneration,
                cause: "observation",
                membershipKey: "older_unresolved_membership",
                originKind: "slack",
                originKey: "older_unresolved_source",
                originRevisionKey: "older_unresolved_revision",
                ledgerSequence: now,
                state: "captured",
                targetResolutionIntentKey: null,
                publicationJobKeys: [],
                errorTag: null,
                terminalAt: null,
                createdAt: now,
                updatedAt: now,
              })
              .pipe(Effect.orDie);
          }),
          resultSchema<void>(),
        ),
      );

      const secondRun = await runPortEffect(
        confect.mutation(reconciliationRefs.openReconciliationRun, {
          ...first.authority,
          expectedPreviousRunGeneration: first.run.runGeneration,
          initialCursor: "cursor_1",
          providerHighWater: "provider_high_water_2",
          ledgerHighWater: 0,
          leaseId: "slack_reconciliation_lease_2",
          leaseGeneration: 2,
          leaseExpiresAt: now + 160_000,
          now: now + 100,
        }),
      );
      await coordinateSourceReconciliationPage({
        sourceChunk: "slack",
        fetchPage: vi.fn(async () => ({
          writes: [],
          cursorAfter: "cursor_2",
          terminal: true,
        })),
        reconciliationRunKey: secondRun.reconciliationRunKey,
        expectedRunGeneration: secondRun.runGeneration,
        expectedConnectionGeneration: first.authority.connectionGeneration,
        expectedAllowlistGeneration: first.authority.allowlistGeneration,
        expectedLeaseGeneration: 2,
        leaseId: "slack_reconciliation_lease_2",
        cursorKey: secondRun.cursorKey,
        expectedCursor: "cursor_1",
        expectedCursorGeneration: 1,
        connectorScopeKey: first.authority.connectorScopeKey,
        requiredScopeIntentKey: first.required.requiredScopeIntentKey,
        providerHighWater: "provider_high_water_2",
        reconciliation: reconciliationPort(confect),
        now: now + 101,
      });
      await runPortEffect(
        confect.mutation(reconciliationRefs.closeReconciliationTraversal, {
          reconciliationRunKey: secondRun.reconciliationRunKey,
          expectedRunGeneration: secondRun.runGeneration,
          expectedConnectionGeneration: first.authority.connectionGeneration,
          expectedAllowlistGeneration: first.authority.allowlistGeneration,
          expectedLeaseGeneration: 2,
          leaseId: "slack_reconciliation_lease_2",
          now: now + 102,
        }),
      );
      await runPortEffect(
        confect.mutation(reconciliationRefs.applyReconciliationRemovalBatch, {
          reconciliationRunKey: secondRun.reconciliationRunKey,
          expectedRunGeneration: secondRun.runGeneration,
          expectedConnectionGeneration: first.authority.connectionGeneration,
          expectedAllowlistGeneration: first.authority.allowlistGeneration,
          expectedLeaseGeneration: 2,
          leaseId: "slack_reconciliation_lease_2",
          requiredScopeIntentKey: first.required.requiredScopeIntentKey,
          expectedRemovalCursor: null,
          nextRemovalCursor: null,
          finalBatch: true,
          candidates: [],
          now: now + 103,
        }),
      );
      const unchanged = await readSourceState(confect, {
        kind: "slack",
        runKey: secondRun.reconciliationRunKey,
        cursorKey: secondRun.cursorKey,
      });
      expect(unchanged.obligations).toHaveLength(0);

      await expect(
        runPortEffect(
          confect.mutation(reconciliationRefs.completeReconciliationRun, {
            reconciliationRunKey: secondRun.reconciliationRunKey,
            expectedRunGeneration: secondRun.runGeneration,
            expectedConnectionGeneration: first.authority.connectionGeneration,
            expectedAllowlistGeneration: first.authority.allowlistGeneration,
            expectedLeaseGeneration: 2,
            leaseId: "slack_reconciliation_lease_2",
            now: now + 104,
          }),
        ),
      ).rejects.toMatchObject({
        _tag: "ProviderReconciliationConflict",
        reason: "obligation_blocked",
      });
    }));

  it(
    "rotates pending completion recovery so a later completable run is reached",
    () =>
      withHarness(async (confect) => {
        const tenancy = await Effect.runPromise(
          confect.run(seedTenancy(now), resultSchema()),
        );
        const pendingRunCount = 51;
        const firstRecoveryAt = now + 10_000;
        const completableScopeKey = "completion_recovery_completable_scope";
        const completableConnectionKey =
          "completion_recovery_completable_connection";
        const completableRunKey = `crun_${sha256Hex("completion-recovery-run")}`;
        const completableIntentKey = `brsi_${sha256Hex(
          "completion-recovery-intent",
        )}`;

        await Effect.runPromise(
          confect.run(
            Effect.gen(function* () {
              const writer = yield* DatabaseWriter;
              for (let index = 0; index < pendingRunCount; index += 1) {
                const connectorScopeKey = `completion_recovery_pending_scope_${index}`;
                const connectionKey = `completion_recovery_pending_connection_${index}`;
                yield* writer
                  .table("connectorReconciliationRuns")
                  .insert({
                    schemaVersion: 1,
                    organizationKey,
                    workspaceId: tenancy.workspaceId,
                    brainKey,
                    corpusKey: "slack",
                    providerKind: "slack",
                    connectorScopeKey,
                    connectionKey,
                    connectionGeneration: 2,
                    allowlistGeneration: 3,
                    reconciliationRunKey: `crun_${sha256Hex(
                      `completion-recovery-pending-${index}`,
                    )}`,
                    runGeneration: 1,
                    scopeTupleDigest: `sha256:${sha256Hex(
                      JSON.stringify({
                        connectorScopeKey,
                        connectionKey,
                        connectionGeneration: 2,
                        allowlistGeneration: 3,
                      }),
                    )}`,
                    status: "drain_derived",
                    providerHighWater: null,
                    ledgerHighWater: 0,
                    leaseId: `completion_recovery_pending_lease_${index}`,
                    leaseGeneration: 1,
                    leaseExpiresAt: firstRecoveryAt + 60_000,
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
                    openedAt: now + index,
                    completedAt: null,
                    updatedAt: now + index,
                  })
                  .pipe(Effect.orDie);
              }

              yield* writer
                .table("connectorReconciliationRuns")
                .insert({
                  schemaVersion: 1,
                  organizationKey,
                  workspaceId: tenancy.workspaceId,
                  brainKey,
                  corpusKey: "slack",
                  providerKind: "slack",
                  connectorScopeKey: completableScopeKey,
                  connectionKey: completableConnectionKey,
                  connectionGeneration: 2,
                  allowlistGeneration: 3,
                  reconciliationRunKey: completableRunKey,
                  runGeneration: 1,
                  scopeTupleDigest: `sha256:${sha256Hex(
                    JSON.stringify({
                      connectorScopeKey: completableScopeKey,
                      connectionKey: completableConnectionKey,
                      connectionGeneration: 2,
                      allowlistGeneration: 3,
                    }),
                  )}`,
                  status: "drain_derived",
                  providerHighWater: null,
                  ledgerHighWater: 0,
                  leaseId: "completion_recovery_completable_lease",
                  leaseGeneration: 1,
                  leaseExpiresAt: firstRecoveryAt + 60_000,
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
                  openedAt: now + pendingRunCount,
                  completedAt: null,
                  updatedAt: now + pendingRunCount,
                })
                .pipe(Effect.orDie);
              yield* writer
                .table("brainRequiredScopeIntents")
                .insert({
                  schemaVersion: 1,
                  organizationKey,
                  workspaceId: tenancy.workspaceId,
                  brainKey,
                  corpusKey: "slack",
                  providerKind: "slack",
                  connectorScopeKey: completableScopeKey,
                  connectionKey: completableConnectionKey,
                  connectionGeneration: 2,
                  allowlistGeneration: 3,
                  requiredScopeIntentKey: completableIntentKey,
                  intentGeneration: 1,
                  controllingConfigurationDigest: `sha256:${"7".repeat(64)}`,
                  state: "required",
                  decommissionGeneration: null,
                  activatedAt: now + pendingRunCount,
                  decommissionedAt: null,
                  updatedAt: now + pendingRunCount,
                })
                .pipe(Effect.orDie);
            }),
            resultSchema<void>(),
          ),
        );

        const first = await runPortEffect(
          confect.mutation(reconciliationRefs.recoverReconciliationRuns, {
            limit: 50,
            now: firstRecoveryAt,
          }),
        );
        expect(first).toMatchObject({
          selectedCount: 50,
          completedCount: 0,
          pendingCount: 50,
          hasMore: true,
        });

        const beforeSecondRecovery = await Effect.runPromise(
          confect.run(
            Effect.gen(function* () {
              const reader = yield* DatabaseReader;
              return yield* reader
                .table("connectorReconciliationRuns")
                .index("by_reconciliation_run_key", (query) =>
                  query.eq("reconciliationRunKey", completableRunKey),
                )
                .first()
                .pipe(Effect.map(Option.getOrNull), Effect.orDie);
            }),
            resultSchema(),
          ),
        );
        expect(beforeSecondRecovery).toMatchObject({ status: "drain_derived" });

        const second = await runPortEffect(
          confect.mutation(reconciliationRefs.recoverReconciliationRuns, {
            limit: 50,
            now: firstRecoveryAt + 1,
          }),
        );
        expect(second).toMatchObject({
          selectedCount: 50,
          completedCount: 1,
          pendingCount: 49,
        });

        const afterSecondRecovery = await Effect.runPromise(
          confect.run(
            Effect.gen(function* () {
              const reader = yield* DatabaseReader;
              return yield* reader
                .table("connectorReconciliationRuns")
                .index("by_reconciliation_run_key", (query) =>
                  query.eq("reconciliationRunKey", completableRunKey),
                )
                .first()
                .pipe(Effect.map(Option.getOrNull), Effect.orDie);
            }),
            resultSchema(),
          ),
        );
        expect(afterSecondRecovery).toMatchObject({
          status: "complete",
          completedAt: firstRecoveryAt + 1,
        });
      }),
    30_000,
  );

  it("consumes retry and attributed repair effects in bounded batches", () =>
    withHarness(async (confect) => {
      const tenancy = await Effect.runPromise(
        confect.run(seedTenancy(now), resultSchema()),
      );
      const opened = await openSourceRun(confect, "slack", tenancy.workspaceId);
      const fetchPage = vi.fn(async () => ({
        writes: [slackWrite(11), slackWrite(12), slackWrite(13)],
        cursorAfter: "cursor_2",
        terminal: true,
      }));
      await coordinateSourceReconciliationPage(
        coordinateInput(confect, opened, "slack", fetchPage),
      );
      const state = await readSourceState(confect, {
        kind: "slack",
        runKey: opened.run.reconciliationRunKey,
        cursorKey: opened.run.cursorKey,
      });
      expect(state.obligations).toHaveLength(3);
      const repairKeys = state.obligations.map(
        (_obligation, index) =>
          `irep_${sha256Hex(JSON.stringify({ repair: index }))}`,
      );
      await Effect.runPromise(
        confect.run(
          Effect.gen(function* () {
            const writer = yield* DatabaseWriter;
            const mutationCtx = yield* MutationCtx;
            const rawDatabase = mutationCtx.db as unknown as {
              readonly insert: (
                tableName: string,
                row: Record<string, unknown>,
              ) => Promise<unknown>;
            };
            for (const [index, obligation] of state.obligations.entries()) {
              const repairCreatedAt = now + 10 + index;
              yield* writer
                .table("ingestionObligations")
                .patch(obligation._id, {
                  state: "retry_wait",
                  errorTag: "repair_requested",
                  terminalAt: null,
                  updatedAt: repairCreatedAt,
                })
                .pipe(Effect.orDie);
              yield* Effect.promise(() =>
                rawDatabase.insert("ingestionObligationRepairEffects", {
                  schemaVersion: 1,
                  organizationKey,
                  workspaceId: tenancy.workspaceId,
                  brainKey,
                  scopeKey: opened.authority.connectorScopeKey,
                  repairEffectKey: repairKeys[index],
                  ingestionObligationKey: obligation.ingestionObligationKey,
                  failureVersion: obligation.updatedAt,
                  mode: index === 1 ? "attributed_repair" : "retry",
                  state: "queued",
                  reason: `repair ${index}`,
                  createdAt: repairCreatedAt,
                  updatedAt: repairCreatedAt,
                }),
              );
            }
          }),
          resultSchema<void>(),
        ),
      );

      const first = await runPortEffect(
        confect.mutation(reconciliationRefs.sweepIngestionObligationRepairs, {
          limit: 2,
          now: now + 20,
        }),
      );
      expect(first).toEqual({
        selectedCount: 2,
        succeededCount: 2,
        failedCount: 0,
        hasMore: true,
      });
      const afterFirst = await Effect.runPromise(
        confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const mutationCtx = yield* MutationCtx;
            const obligations = yield* Effect.all(
              state.obligations.map((obligation) =>
                reader
                  .table("ingestionObligations")
                  .index("by_ingestion_obligation_key", (query) =>
                    query.eq(
                      "ingestionObligationKey",
                      obligation.ingestionObligationKey,
                    ),
                  )
                  .first()
                  .pipe(Effect.map(Option.getOrNull), Effect.orDie),
              ),
            );
            const rawDatabase = mutationCtx.db as unknown as {
              readonly query: (name: string) => {
                readonly withIndex: (
                  name: string,
                  range: (builder: {
                    readonly eq: (field: string, value: unknown) => unknown;
                  }) => unknown,
                ) => {
                  readonly take: (
                    count: number,
                  ) => Promise<readonly Record<string, unknown>[]>;
                };
              };
            };
            const effects = yield* Effect.promise(() =>
              rawDatabase
                .query("ingestionObligationRepairEffects")
                .withIndex("by_state_updated", (query) =>
                  query.eq("state", "queued"),
                )
                .take(10),
            );
            return { obligations, effects };
          }),
          resultSchema(),
        ),
      );
      expect(afterFirst.obligations.map((row) => row?.state)).toEqual([
        "normalization_pending",
        "target_resolution_pending",
        "retry_wait",
      ]);
      expect(afterFirst.effects).toHaveLength(1);
      expect(afterFirst.effects[0]?.repairEffectKey).toBe(repairKeys[2]);

      const second = await runPortEffect(
        confect.mutation(reconciliationRefs.sweepIngestionObligationRepairs, {
          limit: 2,
          now: now + 21,
        }),
      );
      expect(second).toEqual({
        selectedCount: 1,
        succeededCount: 1,
        failedCount: 0,
        hasMore: false,
      });
    }));

  it("publishes an attributed repair and completes its ingestion obligation", () =>
    withHarness(async (confect) => {
      const tenancy = await Effect.runPromise(
        confect.run(seedTenancy(now), resultSchema()),
      );
      const opened = await openSourceRun(confect, "slack", tenancy.workspaceId);
      await seedSlackRoutingPolicy(
        confect,
        tenancy.organizationId,
        tenancy.workspaceId,
      );
      await coordinateSourceReconciliationPage(
        coordinateInput(
          confect,
          opened,
          "slack",
          vi.fn(async () => ({
            writes: [slackWrite(21)],
            cursorAfter: "cursor_2",
            terminal: true,
          })),
        ),
      );

      const initial = await runPortEffect(
        confect.mutation(reconciliationRefs.sweepIngestionObligations, {
          limit: 10,
          now: now + 1,
        }),
      );
      expect(initial.selectedCount).toBe(1);
      expect(initial.failedCount).toBe(0);
      expect(initial.progressedCount).toBe(1);
      const failedAt = now + 2;
      const repairEffectKey = `irep_${sha256Hex("attributed repair success")}`;
      const original = await Effect.runPromise(
        confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const writer = yield* DatabaseWriter;
            const mutationCtx = yield* MutationCtx;
            const obligations = yield* reader
              .table("ingestionObligations")
              .index("by_run_ledger_sequence", (query) =>
                query.eq(
                  "reconciliationRunKey",
                  opened.run.reconciliationRunKey,
                ),
              )
              .take(2)
              .pipe(Effect.orDie);
            const obligation = obligations[0];
            const jobKey = obligation?.publicationJobKeys[0];
            if (obligations.length !== 1 || obligation === undefined || !jobKey)
              return yield* Effect.dieMessage("missing publication obligation");
            const jobs = yield* reader
              .table("retrievalPublicationJobs")
              .index("by_job_key", (query) => query.eq("jobKey", jobKey))
              .take(2)
              .pipe(Effect.orDie);
            const job = jobs[0];
            if (jobs.length !== 1 || job === undefined)
              return yield* Effect.dieMessage("missing publication job");
            yield* writer
              .table("retrievalPublicationJobs")
              .patch(job._id, {
                status: "dead_letter",
                lastErrorTag: "ForcedAttributedRepair",
                completedAt: failedAt,
                updatedAt: failedAt,
              })
              .pipe(Effect.orDie);
            yield* writer
              .table("ingestionObligations")
              .patch(obligation._id, {
                state: "retry_wait",
                errorTag: "ForcedAttributedRepair",
                terminalAt: null,
                updatedAt: failedAt,
              })
              .pipe(Effect.orDie);
            const rawDatabase = mutationCtx.db as unknown as {
              readonly insert: (
                tableName: string,
                row: Record<string, unknown>,
              ) => Promise<unknown>;
            };
            yield* Effect.promise(() =>
              rawDatabase.insert("ingestionObligationRepairEffects", {
                schemaVersion: 1,
                organizationKey,
                workspaceId: tenancy.workspaceId,
                brainKey,
                scopeKey: opened.authority.connectorScopeKey,
                repairEffectKey,
                ingestionObligationKey: obligation.ingestionObligationKey,
                failureVersion: obligation.updatedAt,
                mode: "attributed_repair",
                state: "queued",
                reason: "exercise attributed repair lineage",
                createdAt: failedAt,
                updatedAt: failedAt,
              }),
            );
            return { obligationKey: obligation.ingestionObligationKey, jobKey };
          }),
          resultSchema(),
        ),
      );

      const consumed = await runPortEffect(
        confect.mutation(reconciliationRefs.sweepIngestionObligationRepairs, {
          limit: 10,
          now: now + 3,
        }),
      );
      expect(consumed).toMatchObject({
        selectedCount: 1,
        succeededCount: 1,
        failedCount: 0,
      });
      const reenqueued = await runPortEffect(
        confect.mutation(reconciliationRefs.sweepIngestionObligations, {
          limit: 10,
          now: now + 4,
        }),
      );
      expect(reenqueued).toMatchObject({
        selectedCount: 1,
        progressedCount: 1,
        failedCount: 0,
      });
      const repair = await Effect.runPromise(
        confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const obligations = yield* reader
              .table("ingestionObligations")
              .index("by_ingestion_obligation_key", (query) =>
                query.eq("ingestionObligationKey", original.obligationKey),
              )
              .take(2)
              .pipe(Effect.orDie);
            const obligation = obligations[0];
            const jobKey = obligation?.publicationJobKeys[0];
            const intentId = obligation?.targetResolutionIntentId;
            if (
              obligations.length !== 1 ||
              obligation === undefined ||
              !jobKey ||
              intentId === undefined
            )
              return yield* Effect.dieMessage("missing repaired obligation");
            const intent = yield* reader
              .table("providerTargetResolutionIntents")
              .get(intentId)
              .pipe(Effect.orDie);
            return { obligation, intent, jobKey };
          }),
          resultSchema(),
        ),
      );
      expect(repair.jobKey).not.toBe(original.jobKey);
      expect(repair.obligation).toMatchObject({
        state: "publication_pending",
        publicationJobKeys: [repair.jobKey],
      });
      expect(repair.intent).toMatchObject({
        status: "succeeded",
        targetCount: 1,
        targets: [{ jobKey: repair.jobKey }],
      });

      const published = await Effect.runPromise(
        confect.run(
          runPublicationJobEffect({
            jobKey: repair.jobKey,
            caller: {
              kind: "system",
              name: "provider-reconciliation-repair-test",
              surface: "internal",
            },
            now: now + 5,
          }),
          resultSchema(),
        ),
      );
      expect(published.lastErrorTag).toBeUndefined();
      expect(published.status).toBe("succeeded");
      const completed = await runPortEffect(
        confect.mutation(reconciliationRefs.sweepIngestionObligations, {
          limit: 10,
          now: now + 6,
        }),
      );
      expect(completed).toMatchObject({
        selectedCount: 1,
        completedCount: 1,
        failedCount: 0,
      });
      const final = await Effect.runPromise(
        confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const obligations = yield* reader
              .table("ingestionObligations")
              .index("by_ingestion_obligation_key", (query) =>
                query.eq("ingestionObligationKey", original.obligationKey),
              )
              .take(2)
              .pipe(Effect.orDie);
            const originalJobs = yield* reader
              .table("retrievalPublicationJobs")
              .index("by_job_key", (query) =>
                query.eq("jobKey", original.jobKey),
              )
              .take(2)
              .pipe(Effect.orDie);
            return {
              obligation: obligations[0],
              originalJob: originalJobs[0],
            };
          }),
          resultSchema(),
        ),
      );
      expect(final.obligation).toMatchObject({
        state: "complete",
        publicationJobKeys: [repair.jobKey],
        errorTag: null,
      });
      expect(final.originalJob).toMatchObject({
        status: "superseded",
        supersededByJobKey: repair.jobKey,
      });
    }));

  it("rejects unrelated jobs from an attributed repair lineage", () =>
    withHarness(async (confect) => {
      const tenancy = await Effect.runPromise(
        confect.run(seedTenancy(now), resultSchema()),
      );
      const opened = await openSourceRun(confect, "slack", tenancy.workspaceId);
      await seedSlackRoutingPolicy(
        confect,
        tenancy.organizationId,
        tenancy.workspaceId,
      );
      await coordinateSourceReconciliationPage(
        coordinateInput(
          confect,
          opened,
          "slack",
          vi.fn(async () => ({
            writes: [slackWrite(22)],
            cursorAfter: "cursor_2",
            terminal: true,
          })),
        ),
      );
      await runPortEffect(
        confect.mutation(reconciliationRefs.sweepIngestionObligations, {
          limit: 10,
          now: now + 1,
        }),
      );
      const direct = await Effect.runPromise(
        confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const writer = yield* DatabaseWriter;
            const obligations = yield* reader
              .table("ingestionObligations")
              .index("by_run_ledger_sequence", (query) =>
                query.eq(
                  "reconciliationRunKey",
                  opened.run.reconciliationRunKey,
                ),
              )
              .take(2)
              .pipe(Effect.orDie);
            const obligation = obligations[0];
            const jobKey = obligation?.publicationJobKeys[0];
            if (obligations.length !== 1 || obligation === undefined || !jobKey)
              return yield* Effect.dieMessage("missing direct obligation");
            const jobs = yield* reader
              .table("retrievalPublicationJobs")
              .index("by_job_key", (query) => query.eq("jobKey", jobKey))
              .take(2)
              .pipe(Effect.orDie);
            const job = jobs[0];
            if (jobs.length !== 1 || job === undefined)
              return yield* Effect.dieMessage("missing direct job");
            yield* writer
              .table("retrievalPublicationJobs")
              .patch(job._id, {
                status: "dead_letter",
                lastErrorTag: "ForcedAttributedRepair",
                completedAt: now + 2,
                updatedAt: now + 2,
              })
              .pipe(Effect.orDie);
            return { obligation, jobKey };
          }),
          resultSchema(),
        ),
      );
      const repairJobKey = await Effect.runPromise(
        confect.run(
          enqueueAttributedPublicationRepairEffect({
            jobKey: direct.jobKey,
            now: now + 2,
          }),
          resultSchema(),
        ),
      );
      if (repairJobKey === null) throw new Error("missing repair job");
      await Effect.runPromise(
        confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const writer = yield* DatabaseWriter;
            const repairJobs = yield* reader
              .table("retrievalPublicationJobs")
              .index("by_job_key", (query) => query.eq("jobKey", repairJobKey))
              .take(2)
              .pipe(Effect.orDie);
            const repairJob = repairJobs[0];
            if (repairJobs.length !== 1 || repairJob === undefined)
              return yield* Effect.dieMessage("missing repair lineage");
            const { _id, _creationTime, ...repairRow } = repairJob;
            void _id;
            void _creationTime;
            yield* writer
              .table("retrievalPublicationJobs")
              .insert({
                ...repairRow,
                jobKey: `rjob_${"e".repeat(64)}`,
                createdAt: now + 3,
                updatedAt: now + 3,
              })
              .pipe(Effect.orDie);
            yield* writer
              .table("ingestionObligations")
              .patch(direct.obligation._id, {
                state: "target_resolution_pending",
                updatedAt: now + 3,
              })
              .pipe(Effect.orDie);
          }),
          resultSchema<void>(),
        ),
      );

      const rejected = await runPortEffect(
        confect.mutation(reconciliationRefs.sweepIngestionObligations, {
          limit: 10,
          now: now + 4,
        }),
      );
      expect(rejected).toMatchObject({
        selectedCount: 1,
        failedCount: 1,
        progressedCount: 0,
      });
      const obligation = await Effect.runPromise(
        confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            return yield* reader
              .table("ingestionObligations")
              .index("by_ingestion_obligation_key", (query) =>
                query.eq(
                  "ingestionObligationKey",
                  direct.obligation.ingestionObligationKey,
                ),
              )
              .first()
              .pipe(Effect.map(Option.getOrNull), Effect.orDie);
          }),
          resultSchema(),
        ),
      );
      expect(obligation).toMatchObject({
        state: "failed",
        errorTag: "ProviderTargetPopulationMismatch",
      });
    }));

  it(
    "rotates fifty waiting publications so ready work is not starved",
    () =>
      withHarness(async (confect) => {
        const tenancy = await Effect.runPromise(
          confect.run(seedTenancy(now), resultSchema()),
        );
        const opened = await openSourceRun(
          confect,
          "slack",
          tenancy.workspaceId,
        );
        await seedSlackRoutingPolicy(
          confect,
          tenancy.organizationId,
          tenancy.workspaceId,
        );
        await coordinateSourceReconciliationPage(
          coordinateInput(
            confect,
            opened,
            "slack",
            vi.fn(async () => ({
              writes: Array.from({ length: 51 }, (_, index) =>
                slackWrite(100 + index),
              ),
              cursorAfter: "cursor_2",
              terminal: true,
            })),
          ),
        );
        const initialized = await runPortEffect(
          confect.mutation(reconciliationRefs.sweepIngestionObligations, {
            limit: 100,
            now: now + 10,
          }),
        );
        expect(initialized.selectedCount).toBe(51);
        expect(initialized.failedCount).toBe(0);
        expect(initialized.progressedCount).toBe(51);
        const readyKey = await Effect.runPromise(
          confect.run(
            Effect.gen(function* () {
              const reader = yield* DatabaseReader;
              const writer = yield* DatabaseWriter;
              const obligations = yield* reader
                .table("ingestionObligations")
                .index("by_run_ledger_sequence", (query) =>
                  query.eq(
                    "reconciliationRunKey",
                    opened.run.reconciliationRunKey,
                  ),
                )
                .take(100)
                .pipe(Effect.orDie);
              const ready = obligations[50];
              if (obligations.length !== 51 || ready === undefined)
                return yield* Effect.dieMessage("missing fairness obligations");
              for (const waiter of obligations.slice(0, 50)) {
                yield* writer
                  .table("ingestionObligations")
                  .patch(waiter._id, { updatedAt: now + 11 })
                  .pipe(Effect.orDie);
              }
              yield* writer
                .table("ingestionObligations")
                .patch(ready._id, {
                  state: "normalization_pending",
                  publicationJobKeys: [],
                  updatedAt: now + 12,
                })
                .pipe(Effect.orDie);
              return ready.ingestionObligationKey;
            }),
            resultSchema(),
          ),
        );

        const waiting = await runPortEffect(
          confect.mutation(reconciliationRefs.sweepIngestionObligations, {
            limit: 50,
            now: now + 20,
          }),
        );
        expect(waiting).toMatchObject({
          selectedCount: 50,
          waitingCount: 50,
          progressedCount: 0,
        });
        const rotatedWaiters = await Effect.runPromise(
          confect.run(
            Effect.gen(function* () {
              const reader = yield* DatabaseReader;
              return yield* reader
                .table("ingestionObligations")
                .index("by_state_updated_obligation", (query) =>
                  query.eq("state", "publication_pending"),
                )
                .take(100)
                .pipe(Effect.orDie);
            }),
            resultSchema(),
          ),
        );
        expect(
          rotatedWaiters.filter(
            (obligation) => obligation.updatedAt === now + 20,
          ),
        ).toHaveLength(50);
        const rotated = await runPortEffect(
          confect.mutation(reconciliationRefs.sweepIngestionObligations, {
            limit: 50,
            now: now + 21,
          }),
        );
        expect(rotated).toMatchObject({
          selectedCount: 50,
          progressedCount: 1,
          waitingCount: 49,
        });
        const ready = await Effect.runPromise(
          confect.run(
            Effect.gen(function* () {
              const reader = yield* DatabaseReader;
              return yield* reader
                .table("ingestionObligations")
                .index("by_ingestion_obligation_key", (query) =>
                  query.eq("ingestionObligationKey", readyKey),
                )
                .first()
                .pipe(Effect.map(Option.getOrNull), Effect.orDie);
            }),
            resultSchema(),
          ),
        );
        expect(ready).toMatchObject({ state: "publication_pending" });
      }),
    30_000,
  );

  it("isolates a corrupt obligation conflict while progressing its sibling", () =>
    withHarness(async (confect) => {
      const tenancy = await Effect.runPromise(
        confect.run(seedTenancy(now), resultSchema()),
      );
      const opened = await openSourceRun(confect, "slack", tenancy.workspaceId);
      await seedSlackRoutingPolicy(
        confect,
        tenancy.organizationId,
        tenancy.workspaceId,
      );
      await coordinateSourceReconciliationPage(
        coordinateInput(
          confect,
          opened,
          "slack",
          vi.fn(async () => ({
            writes: [slackWrite(31), slackWrite(32)],
            cursorAfter: "cursor_2",
            terminal: true,
          })),
        ),
      );
      const keys = await Effect.runPromise(
        confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const writer = yield* DatabaseWriter;
            const obligations = yield* reader
              .table("ingestionObligations")
              .index("by_run_ledger_sequence", (query) =>
                query.eq(
                  "reconciliationRunKey",
                  opened.run.reconciliationRunKey,
                ),
              )
              .take(3)
              .pipe(Effect.orDie);
            const corrupt = obligations[0];
            const sibling = obligations[1];
            if (obligations.length !== 2 || corrupt === undefined || !sibling)
              return yield* Effect.dieMessage("missing sibling obligations");
            yield* writer
              .table("ingestionObligations")
              .patch(corrupt._id, {
                targetResolutionIntentKey: "corrupt_target_intent_key",
              })
              .pipe(Effect.orDie);
            return {
              corrupt: corrupt.ingestionObligationKey,
              sibling: sibling.ingestionObligationKey,
            };
          }),
          resultSchema(),
        ),
      );

      const swept = await runPortEffect(
        confect.mutation(reconciliationRefs.sweepIngestionObligations, {
          limit: 10,
          now: now + 1,
        }),
      );
      expect(swept.selectedCount).toBe(2);
      expect(swept.failedCount).toBe(1);
      expect(swept.progressedCount).toBe(1);
      const obligations = await Effect.runPromise(
        confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const rows = yield* reader
              .table("ingestionObligations")
              .index("by_run_ledger_sequence", (query) =>
                query.eq(
                  "reconciliationRunKey",
                  opened.run.reconciliationRunKey,
                ),
              )
              .take(3)
              .pipe(Effect.orDie);
            return rows;
          }),
          resultSchema(),
        ),
      );
      const byKey = new Map(
        obligations.map((row) => [row.ingestionObligationKey, row] as const),
      );
      expect(byKey.get(keys.corrupt)).toMatchObject({
        state: "failed",
        errorTag: "ProviderReconciliationConflict:page_conflict",
      });
      expect(byKey.get(keys.sibling)).toMatchObject({
        state: "publication_pending",
      });
    }));

  it("retires Slack lifecycle, drains its exact publication, and closes only after the shared obligation predicate clears", () =>
    withHarness(async (confect) => {
      const tenancy = await Effect.runPromise(
        confect.run(seedTenancy(now), resultSchema()),
      );
      const first = await openSourceRun(confect, "slack", tenancy.workspaceId);
      await coordinateSourceReconciliationPage(
        coordinateInput(
          confect,
          first,
          "slack",
          vi.fn(async () => ({
            writes: [slackWrite(21)],
            cursorAfter: "cursor_2",
            terminal: true,
          })),
        ),
      );
      const baseline = await readSourceState(confect, {
        kind: "slack",
        runKey: first.run.reconciliationRunKey,
        cursorKey: first.run.cursorKey,
      });
      const baselineRevision = baseline.sourceRows[0];
      if (
        baselineRevision === undefined ||
        !("sourceRevisionKey" in baselineRevision)
      )
        throw new Error("missing baseline Slack revision");
      const baselineObligation = baseline.obligations[0];
      if (baselineObligation === undefined)
        throw new Error("missing baseline Slack obligation");
      await Effect.runPromise(
        confect.run(
          Effect.gen(function* () {
            const writer = yield* DatabaseWriter;
            yield* writer
              .table("ingestionObligations")
              .patch(baselineObligation._id, {
                state: "complete",
                terminalAt: now,
                updatedAt: now,
              })
              .pipe(Effect.orDie);
          }),
          resultSchema<void>(),
        ),
      );

      const secondRun = await runPortEffect(
        confect.mutation(reconciliationRefs.openReconciliationRun, {
          ...first.authority,
          expectedPreviousRunGeneration: 1,
          initialCursor: "cursor_2",
          providerHighWater: "provider_high_water_2",
          ledgerHighWater: 0,
          leaseId: "slack_reconciliation_lease_2",
          leaseGeneration: 2,
          leaseExpiresAt: now + 160_000,
          now: now + 100,
        }),
      );
      await coordinateSourceReconciliationPage({
        sourceChunk: "slack",
        fetchPage: vi.fn(async () => ({
          writes: [],
          cursorAfter: "cursor_3",
          terminal: true,
        })),
        reconciliationRunKey: secondRun.reconciliationRunKey,
        expectedRunGeneration: secondRun.runGeneration,
        expectedConnectionGeneration: first.authority.connectionGeneration,
        expectedAllowlistGeneration: first.authority.allowlistGeneration,
        expectedLeaseGeneration: 2,
        leaseId: "slack_reconciliation_lease_2",
        cursorKey: secondRun.cursorKey,
        expectedCursor: "cursor_2",
        expectedCursorGeneration: 2,
        connectorScopeKey: first.authority.connectorScopeKey,
        requiredScopeIntentKey: first.required.requiredScopeIntentKey,
        providerHighWater: "provider_high_water_2",
        reconciliation: reconciliationPort(confect),
        now: now + 101,
      });
      await runPortEffect(
        confect.mutation(reconciliationRefs.closeReconciliationTraversal, {
          reconciliationRunKey: secondRun.reconciliationRunKey,
          expectedRunGeneration: secondRun.runGeneration,
          expectedConnectionGeneration: first.authority.connectionGeneration,
          expectedAllowlistGeneration: first.authority.allowlistGeneration,
          expectedLeaseGeneration: 2,
          leaseId: "slack_reconciliation_lease_2",
          now: now + 102,
        }),
      );
      const removalPage = await Effect.runPromise(
        confect.run(
          listSlackReconciliationRemovalCandidates({
            organizationKey,
            connectorScopeKey: first.authority.connectorScopeKey,
            connectionKey: first.authority.connectionKey,
            connectionGeneration: first.authority.connectionGeneration,
            afterSourceKey: null,
            limit: 100,
          }),
          resultSchema(),
        ),
      );
      expect(removalPage.candidates).toHaveLength(1);
      const removal = removalPage.candidates[0];
      if (removal === undefined) throw new Error("missing removal candidate");
      const applied = await runPortEffect(
        confect.mutation(reconciliationRefs.applyReconciliationRemovalBatch, {
          reconciliationRunKey: secondRun.reconciliationRunKey,
          expectedRunGeneration: secondRun.runGeneration,
          expectedConnectionGeneration: first.authority.connectionGeneration,
          expectedAllowlistGeneration: first.authority.allowlistGeneration,
          expectedLeaseGeneration: 2,
          leaseId: "slack_reconciliation_lease_2",
          requiredScopeIntentKey: first.required.requiredScopeIntentKey,
          expectedRemovalCursor: null,
          nextRemovalCursor: removalPage.nextCursor,
          finalBatch: true,
          candidates: removalPage.candidates,
          now: now + 103,
        }),
      );
      expect(applied).toMatchObject({
        status: "drain_derived",
        removalCount: 1,
      });

      const publicationSubjectKey = retrievalPublicationSubjectKey({
        workspaceId: String(tenancy.workspaceId),
        brainKey,
        corpusKey: "slack",
        originTable: "sourceRevisions",
        kind: "slack",
        sourceKey: removal.originKey,
        connectorScopeKey: first.authority.connectorScopeKey,
      });
      const publicationSetKey = `rset_${"5".repeat(64)}`;
      await Effect.runPromise(
        confect.run(
          Effect.gen(function* () {
            const writer = yield* DatabaseWriter;
            yield* writer
              .table("retrievalPublicationSubjects")
              .insert({
                schemaVersion: 1,
                organizationKey,
                workspaceId: tenancy.workspaceId,
                brainKey,
                corpusKey: "slack",
                publicationSubjectKey,
                originKind: "slack",
                originTable: "sourceRevisions",
                sourceKey: removal.originKey,
                connectorScopeKey: first.authority.connectorScopeKey,
                connectionKey: first.authority.connectionKey,
                connectionGeneration: first.authority.connectionGeneration,
                currentPublicationSetKey: publicationSetKey,
                lastPublicationGeneration: 1,
                createdAt: now,
                updatedAt: now,
              })
              .pipe(Effect.orDie);
            yield* writer
              .table("retrievalPublicationSets")
              .insert({
                schemaVersion: 1,
                organizationKey,
                workspaceId: tenancy.workspaceId,
                brainKey,
                corpusKey: "slack",
                publicationSubjectKey,
                publicationSetKey,
                publicationGeneration: 1,
                originKind: "slack",
                originTable: "sourceRevisions",
                connectorScopeKey: first.authority.connectorScopeKey,
                connectionKey: first.authority.connectionKey,
                connectionGeneration: first.authority.connectionGeneration,
                sourceKey: removal.originKey,
                sourceRevisionKey: removal.originRevisionKey,
                routeGeneration: 1,
                lifecycleGeneration: 1,
                policyGeneration: 1,
                expectedEntryCount: 1,
                expectedTokenCount: 1,
                manifestHash: `sha256:${"7".repeat(64)}`,
                state: "current",
                createdAt: now,
                activatedAt: now,
              })
              .pipe(Effect.orDie);
            yield* writer
              .table("retrievalTokens")
              .insert({
                schemaVersion: 1,
                organizationKey,
                workspaceId: tenancy.workspaceId,
                brainKey,
                publicationSetKey,
                publicationState: "current",
                tokenizerVersion: 1,
                token: "retire",
                entryKey: `rent_${"6".repeat(64)}`,
                authorityRank: 1,
                termFrequency: 1,
                inTitle: false,
                inHeading: false,
              })
              .pipe(Effect.orDie);
          }),
          resultSchema<void>(),
        ),
      );

      const obligations = await Effect.runPromise(
        confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            return yield* reader
              .table("ingestionObligations")
              .index("by_run_ledger_sequence", (query) =>
                query.eq(
                  "reconciliationRunKey",
                  secondRun.reconciliationRunKey,
                ),
              )
              .take(10)
              .pipe(Effect.orDie);
          }),
          resultSchema(),
        ),
      );
      const removalObligation = obligations[0];
      if (removalObligation === undefined)
        throw new Error("missing removal obligation");
      await expect(
        runPortEffect(
          confect.mutation(reconciliationRefs.completeReconciliationRun, {
            reconciliationRunKey: secondRun.reconciliationRunKey,
            expectedRunGeneration: secondRun.runGeneration,
            expectedConnectionGeneration: first.authority.connectionGeneration,
            expectedAllowlistGeneration: first.authority.allowlistGeneration,
            expectedLeaseGeneration: 2,
            leaseId: "slack_reconciliation_lease_2",
            now: now + 104,
          }),
        ),
      ).rejects.toMatchObject({
        _tag: "ProviderReconciliationConflict",
        reason: "drain_incomplete",
      });
      const retiredRemoval = await runPortEffect(
        confect.mutation(reconciliationRefs.sweepIngestionObligations, {
          limit: 100,
          now: now + 105,
        }),
      );
      expect(retiredRemoval).toMatchObject({
        selectedCount: 1,
        progressedCount: 1,
        failedCount: 0,
      });
      const drainedRemoval = await runPortEffect(
        confect.mutation(reconciliationRefs.sweepIngestionObligations, {
          limit: 100,
          now: now + 106,
        }),
      );
      expect(drainedRemoval).toMatchObject({
        selectedCount: 1,
        completedCount: 1,
        failedCount: 0,
      });
      const completed = await runPortEffect(
        confect.mutation(reconciliationRefs.completeReconciliationRun, {
          reconciliationRunKey: secondRun.reconciliationRunKey,
          expectedRunGeneration: secondRun.runGeneration,
          expectedConnectionGeneration: first.authority.connectionGeneration,
          expectedAllowlistGeneration: first.authority.allowlistGeneration,
          expectedLeaseGeneration: 2,
          leaseId: "slack_reconciliation_lease_2",
          now: now + 107,
        }),
      );
      expect(completed).toMatchObject({
        status: "complete",
        successfulObligationCount: 1,
      });

      const retired = await Effect.runPromise(
        confect.run(
          Effect.gen(function* () {
            const reader = yield* DatabaseReader;
            const [artifacts, fences, subjects, sets, tokens] =
              yield* Effect.all([
                reader
                  .table("sourceArtifacts")
                  .index("by_org_source_key", (query) =>
                    query
                      .eq("organizationKey", organizationKey)
                      .eq("sourceKey", removal.originKey),
                  )
                  .take(2)
                  .pipe(Effect.orDie),
                reader
                  .table("retrievalEligibilityFences")
                  .index("by_organization_fence", (query) =>
                    query.eq("organizationKey", organizationKey).eq(
                      "fenceKey",
                      retrievalEligibilityFenceKey(
                        slackSourceLifecycleFenceIdentity({
                          organizationKey,
                          sourceKey: removal.originKey,
                        }),
                      ),
                    ),
                  )
                  .take(2)
                  .pipe(Effect.orDie),
                reader
                  .table("retrievalPublicationSubjects")
                  .index("by_workspace_subject", (query) =>
                    query
                      .eq("workspaceId", tenancy.workspaceId)
                      .eq("publicationSubjectKey", publicationSubjectKey),
                  )
                  .take(2)
                  .pipe(Effect.orDie),
                reader
                  .table("retrievalPublicationSets")
                  .index("by_workspace_publication_set", (query) =>
                    query
                      .eq("workspaceId", tenancy.workspaceId)
                      .eq("publicationSetKey", publicationSetKey),
                  )
                  .take(2)
                  .pipe(Effect.orDie),
                reader
                  .table("retrievalTokens")
                  .index("by_workspace_brain_publication_set_entry", (query) =>
                    query
                      .eq("workspaceId", tenancy.workspaceId)
                      .eq("brainKey", brainKey)
                      .eq("publicationSetKey", publicationSetKey),
                  )
                  .take(10)
                  .pipe(Effect.orDie),
              ]);
            return {
              artifact: artifacts[0],
              fence: fences[0],
              subject: subjects[0],
              set: sets[0],
              tokens,
            };
          }),
          resultSchema(),
        ),
      );
      expect(retired.artifact?.lifecycle).toMatchObject({
        state: "deleted_tombstone",
        generation: 2,
      });
      expect(retired.fence).toMatchObject({
        eligible: false,
        eligibilityGeneration: 2,
      });
      expect(retired.subject).toMatchObject({
        currentPublicationSetKey: null,
      });
      expect(retired.set).toMatchObject({ state: "retired" });
      expect(retired.tokens).toHaveLength(0);
      expect(baselineRevision.sourceRevisionKey).toBe(
        removal.originRevisionKey,
      );
    }));
});
