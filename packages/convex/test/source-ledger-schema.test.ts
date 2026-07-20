import { describe, expect, it } from "vitest";

import {
  ProviderEventReceiptRow,
  SourceArtifactRow,
  SourceProcessingJobRow,
  SourceRevisionRow,
  assertValidSourceLedgerCapture,
  buildSourceLedgerRows,
  sourceLedgerKeysFor,
} from "../confect/sources/sourceSchemas";
import providerEventReceiptsSource from "../confect/tables/providerEventReceipts";
import sourceArtifactsSource from "../confect/tables/sourceArtifacts";
import sourceProcessingJobsSource from "../confect/tables/sourceProcessingJobs";
import sourceRevisionsSource from "../confect/tables/sourceRevisions";

const providerEventReceipts = providerEventReceiptsSource(
  "providerEventReceipts",
);
const sourceArtifacts = sourceArtifactsSource("sourceArtifacts");
const sourceRevisions = sourceRevisionsSource("sourceRevisions");
const sourceProcessingJobs = sourceProcessingJobsSource("sourceProcessingJobs");

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
    transport: "live" as const,
    transportDeliveryId: "evt_1",
    receivedAt: 1_000,
  },
  observation: {
    providerObjectId: "1680000000.000100",
    threadKey: "thr_1680000000_000100",
    sourceTimestamp: "2026-07-20T10:00:00.000Z",
    providerOrder: "00000000000000000001",
    providerRevisionId: "rev_1",
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

const verifiedBinding = {
  verifiedSlackEnvelope: true as const,
  organizationKey: "agency_acme",
  connectionKey: "slack_agency_acme",
  connectionGeneration: 2,
  teamId: "T_acme",
  appId: "A_acme",
  botUserId: "B_acme",
  channelKey: "chn_general",
  externalChannelId: "C_general",
};

describe("source ledger schema", () => {
  it("declares the S05 table/index inventory", () => {
    expect(providerEventReceipts.indexes).toMatchObject({
      by_connection_generation_transport_delivery: [
        "organizationKey",
        "connectionKey",
        "connectionGeneration",
        "transport",
        "transportDeliveryId",
      ],
      by_observation_key: ["organizationKey", "observationKey"],
      by_received_at: ["organizationKey", "receivedAt"],
      by_outcome: ["organizationKey", "outcome"],
    });
    expect(sourceArtifacts.indexes).toMatchObject({
      by_channel_provider_object: ["channelKey", "providerObjectId"],
      by_org_connection_generation_channel_provider_object: [
        "organizationKey",
        "connectionKey",
        "connectionGeneration",
        "channelKey",
        "providerObjectId",
      ],
      by_source_key: ["sourceKey"],
      by_thread_key: ["organizationKey", "threadKey"],
      by_lifecycle_purge_after: [
        "organizationKey",
        "lifecycle.state",
        "lifecycle.purgeAfter",
      ],
    });
    expect(sourceRevisions.indexes).toEqual({
      by_source_revision_key: ["organizationKey", "sourceRevisionKey"],
      by_source_provider_order: ["sourceKey", "providerOrder"],
      by_source_created: ["organizationKey", "sourceCreatedAt"],
      by_lifecycle_purge_after: [
        "organizationKey",
        "lifecycle.state",
        "lifecycle.purgeAfter",
      ],
    });
    expect(sourceProcessingJobs.indexes).toEqual({
      by_stage_status_next_retry: ["stage", "status", "nextRetryAt"],
      by_effect_key: ["effectKey"],
      by_unit_stage: ["sourceUnitKey", "stage"],
      by_lease_expiry: ["status", "leaseExpiresAt"],
      by_organization_status: ["organizationKey", "status"],
    });
  });

  it("derives stable source, observation, revision, and job keys without Convex IDs", () => {
    const result = assertValidSourceLedgerCapture(capture, { verifiedBinding });

    expect(result).toMatchObject({ outcome: "inserted" });
    expect(JSON.stringify(result)).not.toContain("_id");
    expect(result.sourceKey).toMatch(/^src_[a-f0-9]{64}$/);
    expect(result.sourceRevisionKey).toMatch(/^srev_[a-f0-9]{64}$/);
    expect(result.assemblyJobKey).toMatch(/^sjob_[a-f0-9]{64}$/);
  });

  it("length-prefixes tenant source identity so underscored fields cannot collide", () => {
    const left = sourceLedgerKeysFor({
      ...capture,
      envelope: {
        ...capture.envelope,
        organizationKey: "a_b",
        connectionKey: "c",
        connectionGeneration: 1,
        channelKey: "d",
      },
      observation: { ...capture.observation, providerObjectId: "m" },
    });
    const right = sourceLedgerKeysFor({
      ...capture,
      envelope: {
        ...capture.envelope,
        organizationKey: "a",
        connectionKey: "b_c",
        connectionGeneration: 1,
        channelKey: "d",
      },
      observation: { ...capture.observation, providerObjectId: "m" },
    });

    expect(left.sourceKey).not.toBe(right.sourceKey);
  });

  it("converges live and backfill receipts on one logical observation", () => {
    const live = assertValidSourceLedgerCapture(capture, { verifiedBinding });
    const backfill = assertValidSourceLedgerCapture(
      {
        ...capture,
        envelope: {
          ...capture.envelope,
          transport: "backfill" as const,
          transportDeliveryId: "backfill_1",
          receivedAt: 2_000,
        },
      },
      { verifiedBinding },
    );

    expect(backfill.observationKey).toBe(live.observationKey);
    expect(backfill.sourceRevisionKey).toBe(live.sourceRevisionKey);
  });

  it("dedupes same delivery IDs by transport lane and converges same-transport replays", () => {
    const seen = new Set<string>();
    expect(
      assertValidSourceLedgerCapture(capture, {
        seenTransportDeliveries: seen,
        verifiedBinding,
      }).outcome,
    ).toBe("inserted");
    expect(
      assertValidSourceLedgerCapture(
        {
          ...capture,
          envelope: {
            ...capture.envelope,
            transport: "backfill" as const,
            transportDeliveryId: "backfill_1",
            receivedAt: 2_000,
          },
        },
        { seenTransportDeliveries: seen, verifiedBinding },
      ).outcome,
    ).toBe("inserted");
    expect(
      assertValidSourceLedgerCapture(capture, {
        seenTransportDeliveries: seen,
        verifiedBinding,
      }).outcome,
    ).toBe("duplicate");
  });

  it("tenant-scopes source identity and receipt dedupe across connection generations", () => {
    const current = assertValidSourceLedgerCapture(capture, {
      verifiedBinding,
    });
    const otherOrg = assertValidSourceLedgerCapture(
      {
        ...capture,
        envelope: {
          ...capture.envelope,
          organizationKey: "agency_other",
          connectionKey: "slack_agency_other",
          transportDeliveryId: "evt_1",
        },
      },
      {
        verifiedBinding: {
          ...verifiedBinding,
          organizationKey: "agency_other",
          connectionKey: "slack_agency_other",
        },
      },
    );
    const nextGeneration = assertValidSourceLedgerCapture(
      {
        ...capture,
        envelope: {
          ...capture.envelope,
          connectionGeneration: 3,
          transportDeliveryId: "evt_1",
        },
      },
      { verifiedBinding: { ...verifiedBinding, connectionGeneration: 3 } },
    );

    expect(otherOrg.sourceKey).not.toBe(current.sourceKey);
    expect(otherOrg.observationKey).not.toBe(current.observationKey);
    expect(nextGeneration.sourceKey).not.toBe(current.sourceKey);
    expect(nextGeneration.observationKey).not.toBe(current.observationKey);
  });

  it("builds exact receipt, artifact, revision, and assembly job rows", () => {
    const rows = buildSourceLedgerRows(capture, { verifiedBinding });

    expect(ProviderEventReceiptRow.pipe).toBeDefined();
    expect(rows.receipt).toMatchObject({
      schemaVersion: 1,
      organizationKey: "agency_acme",
      connectionKey: "slack_agency_acme",
      transport: "live",
      providerEventId: "evt_1",
      providerObjectId: "1680000000.000100",
      providerRevisionId: "rev_1",
      providerOrder: "00000000000000000001",
      outcome: "inserted",
    });
    expect(SourceArtifactRow.pipe).toBeDefined();
    expect(rows.artifact).toMatchObject({
      schemaVersion: 1,
      providerObjectId: "1680000000.000100",
      latestSourceRevisionKey: rows.receipt.sourceRevisionKey,
      latestProviderOrder:
        "2026-07-20T10:00:00.000Z|rev_1|c3956707eda355a0d6148a62e5989e936eef3165d76d8b3722f1fe0d0ffc7026",
      lifecycle: { state: "active", generation: 1, updatedAt: 1_000 },
    });
    expect(SourceRevisionRow.pipe).toBeDefined();
    expect(rows.revision).toMatchObject({
      schemaVersion: 1,
      providerRevisionId: "rev_1",
      sourceCreatedAt: 1_000,
      sourceTimestamp: "2026-07-20T10:00:00.000Z",
      normalizedText: "hello agency",
      tombstone: false,
      lifecycle: { state: "active", generation: 1, updatedAt: 1_000 },
    });
    expect(SourceProcessingJobRow.pipe).toBeDefined();
    expect(rows.processingJob).toMatchObject({
      schemaVersion: 1,
      stage: "assembly_pending",
      status: "pending",
      effectKey: "source-effect-1",
      policyEpoch: 7,
      attemptCount: 0,
    });
  });

  it("rejects tenant, duplicate receipt, conflicting observation, key, size, and canonicalization violations", () => {
    const seen = new Set<string>();
    expect(
      assertValidSourceLedgerCapture(capture, {
        seenTransportDeliveries: seen,
        verifiedBinding,
      }).outcome,
    ).toBe("inserted");
    expect(
      assertValidSourceLedgerCapture(capture, {
        seenTransportDeliveries: seen,
        verifiedBinding,
      }).outcome,
    ).toBe("duplicate");
    expect(() =>
      assertValidSourceLedgerCapture(
        {
          ...capture,
          observation: { ...capture.observation, text: "altered" },
        },
        { seenTransportDeliveries: seen, verifiedBinding },
      ),
    ).toThrow("DuplicateKeyConflict");
    expect(() =>
      assertValidSourceLedgerCapture(
        { ...capture, envelope: { ...capture.envelope, organizationKey: "" } },
        { verifiedBinding },
      ),
    ).toThrow("TenantMismatch");
    expect(() =>
      assertValidSourceLedgerCapture(
        { ...capture, envelope: { ...capture.envelope, channelKey: "other" } },
        { verifiedBinding },
      ),
    ).toThrow("ChannelAccessLost");
    expect(() =>
      assertValidSourceLedgerCapture(
        {
          ...capture,
          observation: { ...capture.observation, sourceTimestamp: "bad" },
        },
        { verifiedBinding },
      ),
    ).toThrow("ObservationInvalid");
    expect(() =>
      assertValidSourceLedgerCapture(
        {
          ...capture,
          observation: { ...capture.observation, text: "x".repeat(32_001) },
        },
        { verifiedBinding },
      ),
    ).toThrow("PayloadTooLarge");
    expect(() =>
      assertValidSourceLedgerCapture(
        {
          ...capture,
          observation: {
            ...capture.observation,
            providerObjectId: "bad/slash",
          },
        },
        { verifiedBinding },
      ),
    ).toThrow("DuplicateKeyConflict");
    expect(() =>
      assertValidSourceLedgerCapture(capture, {
        existingObservationKey: "obs_other",
        verifiedBinding,
      }),
    ).toThrow("DuplicateKeyConflict");
  });
});
