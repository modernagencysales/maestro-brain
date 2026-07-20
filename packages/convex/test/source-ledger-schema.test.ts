import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  ProviderEventReceiptRow,
  SourceArtifactRow,
  SourceProcessingJobRow,
  SourceRevisionRow,
  assertValidSourceLedgerCapture,
  sourceLedgerKeysFor,
} from "../confect/sources/sourceSchemas";
import providerEventReceiptsSource from "../confect/tables/providerEventReceipts";
import sourceArtifactsSource from "../confect/tables/sourceArtifacts";
import sourceProcessingJobsSource from "../confect/tables/sourceProcessingJobs";
import sourceRevisionsSource from "../confect/tables/sourceRevisions";

const lifecycle = {
  state: "active" as const,
  generation: 1,
  updatedAt: 1_000,
  purgeAfter: null,
};

const capture = {
  envelope: {
    organizationKey: "agency_acme",
    connectionKey: "slack_agency_acme",
    connectionGeneration: 2,
    teamId: "T_acme",
    appId: "A_acme",
    botUserId: "B_acme",
    channelKey: "chn_general",
    externalChannelId: "C_general",
    transportDeliveryId: "evt_1",
    receivedAt: 1_000,
  },
  observation: {
    providerObjectId: "1680000000.000100",
    threadKey: "thr_1680000000_000100",
    sourceTimestamp: "2026-07-20T10:00:00.000Z",
    providerOrder: "00000000000000000001",
    author: { providerUserId: "U_acme", displayName: "Alex" },
    text: "hello agency",
    blocksJson: "[]",
    permalink: "https://example.slack.com/archives/C_general/p1680000000000100",
    tombstone: false,
    revisionNonce: "message-create",
  },
  routing: {
    policyEpoch: 7,
    assemblyStage: "assembly_pending" as const,
    effectKey: "source-effect-1",
  },
};

describe("source ledger schema", () => {
  it("declares the S05 table/index inventory", () => {
    expect(
      providerEventReceiptsSource("providerEventReceipts").indexes,
    ).toEqual({
      by_connection_transport_delivery: [
        "connectionKey",
        "transportDeliveryId",
      ],
      by_observation_key: ["observationKey"],
      by_received_at: ["organizationKey", "receivedAt"],
      by_outcome: ["organizationKey", "outcome"],
    });
    expect(sourceArtifactsSource("sourceArtifacts").indexes).toEqual({
      by_channel_provider_object: ["channelKey", "providerObjectId"],
      by_source_key: ["sourceKey"],
      by_thread_key: ["organizationKey", "threadKey"],
      by_lifecycle_purge_after: [
        "organizationKey",
        "lifecycle.state",
        "lifecycle.purgeAfter",
      ],
    });
    expect(sourceRevisionsSource("sourceRevisions").indexes).toEqual({
      by_source_revision_key: ["sourceRevisionKey"],
      by_source_provider_order: ["sourceKey", "providerOrder"],
      by_source_created: ["organizationKey", "sourceCreatedAt"],
      by_lifecycle_purge_after: [
        "organizationKey",
        "lifecycle.state",
        "lifecycle.purgeAfter",
      ],
    });
    expect(sourceProcessingJobsSource("sourceProcessingJobs").indexes).toEqual({
      by_stage_status_next_retry: ["stage", "status", "nextRetryAt"],
      by_effect_key: ["effectKey"],
      by_unit_stage: ["sourceUnitKey", "stage"],
      by_lease_expiry: ["status", "leaseExpiresAt"],
      by_organization_status: ["organizationKey", "status"],
    });
  });

  it("derives stable source, observation, revision, and job keys without Convex IDs", () => {
    const result = assertValidSourceLedgerCapture(capture);
    expect(result).toMatchObject({ outcome: "inserted" });
    expect(JSON.stringify(result)).not.toContain("_id");
    expect(result.sourceKey).toBe(
      "src_slack_agency_acme_chn_general_1680000000_000100",
    );
    expect(result.sourceRevisionKey).toMatch(/^srev_[a-f0-9]{64}$/);
    expect(result.assemblyJobKey).toMatch(/^sjob_[a-f0-9]{64}$/);
  });

  it("converges live and backfill receipts on one logical observation", () => {
    const live = assertValidSourceLedgerCapture(capture);
    const backfill = assertValidSourceLedgerCapture({
      ...capture,
      envelope: {
        ...capture.envelope,
        transportDeliveryId: "backfill_1",
        receivedAt: 2_000,
      },
    });

    expect(backfill.observationKey).toBe(live.observationKey);
    expect(backfill.sourceRevisionKey).toBe(live.sourceRevisionKey);
  });

  it("validates exact receipt, artifact, revision, and assembly job rows", () => {
    const keys = sourceLedgerKeysFor(capture);
    expect(
      Schema.decodeUnknownSync(ProviderEventReceiptRow)({
        schemaVersion: 1,
        organizationKey: "agency_acme",
        connectionKey: "slack_agency_acme",
        connectionGeneration: 2,
        channelKey: "chn_general",
        externalChannelId: "C_general",
        transportDeliveryId: "evt_1",
        observationKey: keys.observationKey,
        sourceKey: keys.sourceKey,
        sourceRevisionKey: keys.sourceRevisionKey,
        outcome: "inserted",
        receivedAt: 1_000,
        createdAt: 1_000,
      }),
    ).toMatchObject({ outcome: "inserted" });
    expect(
      Schema.decodeUnknownSync(SourceArtifactRow)({
        schemaVersion: 1,
        organizationKey: "agency_acme",
        connectionKey: "slack_agency_acme",
        channelKey: "chn_general",
        externalChannelId: "C_general",
        providerObjectId: "1680000000.000100",
        sourceKey: keys.sourceKey,
        threadKey: "thr_1680000000_000100",
        latestSourceRevisionKey: keys.sourceRevisionKey,
        latestProviderOrder: "00000000000000000001",
        lifecycle,
        createdAt: 1_000,
        updatedAt: 1_000,
      }),
    ).toMatchObject({ sourceKey: keys.sourceKey });
    expect(
      Schema.decodeUnknownSync(SourceRevisionRow)({
        schemaVersion: 1,
        organizationKey: "agency_acme",
        connectionKey: "slack_agency_acme",
        channelKey: "chn_general",
        sourceKey: keys.sourceKey,
        sourceRevisionKey: keys.sourceRevisionKey,
        observationKey: keys.observationKey,
        providerOrder: "00000000000000000001",
        sourceCreatedAt: 1_000,
        sourceTimestamp: "2026-07-20T10:00:00.000Z",
        authorSnapshot: { providerUserId: "U_acme", displayName: "Alex" },
        normalizedText: "hello agency",
        blocksJson: "[]",
        permalink: capture.observation.permalink,
        contentHash: keys.contentHash,
        tombstone: false,
        lifecycle,
        createdAt: 1_000,
      }),
    ).toMatchObject({ tombstone: false });
    expect(
      Schema.decodeUnknownSync(SourceProcessingJobRow)({
        schemaVersion: 1,
        organizationKey: "agency_acme",
        sourceUnitKey: keys.sourceUnitKey,
        sourceRevisionKey: keys.sourceRevisionKey,
        stage: "assembly_pending",
        status: "pending",
        effectKey: "source-effect-1",
        policyEpoch: 7,
        leaseOwner: null,
        leaseExpiresAt: null,
        nextRetryAt: 1_000,
        attemptCount: 0,
        createdAt: 1_000,
        updatedAt: 1_000,
      }),
    ).toMatchObject({ stage: "assembly_pending" });
  });

  it("rejects tenant, duplicate receipt, conflicting observation, key, size, and canonicalization violations", () => {
    const seen = new Set<string>();
    expect(
      assertValidSourceLedgerCapture(capture, { seenTransportDeliveries: seen })
        .outcome,
    ).toBe("inserted");
    expect(
      assertValidSourceLedgerCapture(capture, { seenTransportDeliveries: seen })
        .outcome,
    ).toBe("duplicate");
    expect(() =>
      assertValidSourceLedgerCapture({
        ...capture,
        envelope: { ...capture.envelope, organizationKey: "" },
      }),
    ).toThrow("TenantMismatch");
    expect(() =>
      assertValidSourceLedgerCapture({
        ...capture,
        envelope: { ...capture.envelope, channelKey: "other" },
      }),
    ).toThrow("ChannelAccessLost");
    expect(() =>
      assertValidSourceLedgerCapture({
        ...capture,
        observation: {
          ...capture.observation,
          sourceTimestamp: "2026-07-20 10:00",
        },
      }),
    ).toThrow("ObservationInvalid");
    expect(() =>
      assertValidSourceLedgerCapture({
        ...capture,
        observation: { ...capture.observation, text: "x".repeat(32_001) },
      }),
    ).toThrow("PayloadTooLarge");
    expect(() =>
      assertValidSourceLedgerCapture({
        ...capture,
        observation: { ...capture.observation, providerObjectId: "bad/slash" },
      }),
    ).toThrow("DuplicateKeyConflict");
    expect(() =>
      assertValidSourceLedgerCapture(capture, {
        existingObservationKey: "obs_other",
      }),
    ).toThrow("DuplicateKeyConflict");
  });
});
