import { convexTest } from "convex-test";
import { defineSchema } from "convex/server";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import databaseSchema from "../confect/_generated/schema";
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

const modules = import.meta.glob("../convex/**/!(*.*.*)*.*s");

const transientConvexSchema = defineSchema({
  ...Object.fromEntries(
    Object.entries(databaseSchema.tables).map(([name, table]) => [
      name,
      table.tableDefinition,
    ]),
  ),
  providerEventReceipts: providerEventReceipts.tableDefinition,
  sourceArtifacts: sourceArtifacts.tableDefinition,
  sourceRevisions: sourceRevisions.tableDefinition,
  sourceProcessingJobs: sourceProcessingJobs.tableDefinition,
});

const lifecycle = {
  state: "active" as const,
  generation: 1,
  updatedAt: 1_000,
  purgeAfter: null,
};

const verifiedBinding = {
  organizationKey: "agency_acme",
  connectionKey: "slack_agency_acme",
  connectionGeneration: 2,
  teamId: "T_acme",
  appId: "A_acme",
  botUserId: "B_acme",
  channelKey: "chn_general",
  externalChannelId: "C_general",
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
    expect(providerEventReceipts.indexes).toMatchObject({
      by_connection_transport_delivery: [
        "connectionKey",
        "transportDeliveryId",
      ],
      by_connection_generation_transport_delivery: [
        "organizationKey",
        "connectionKey",
        "connectionGeneration",
        "transportDeliveryId",
      ],
      by_observation_key: ["observationKey"],
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
      by_source_revision_key: ["sourceRevisionKey"],
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
          transportDeliveryId: "backfill_1",
          receivedAt: 2_000,
        },
      },
      { verifiedBinding },
    );

    expect(backfill.observationKey).toBe(live.observationKey);
    expect(backfill.sourceRevisionKey).toBe(live.sourceRevisionKey);
  });

  it("tenant-scopes source identity, artifact lookup, and receipt dedupe across connection generations", () => {
    const current = assertValidSourceLedgerCapture(capture, {
      verifiedBinding,
    });
    const otherOrgBinding = {
      ...verifiedBinding,
      organizationKey: "agency_other",
      connectionKey: "slack_agency_other",
    };
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
      { verifiedBinding: otherOrgBinding },
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
          envelope: { ...capture.envelope, connectionGeneration: 3 },
        },
        {
          seenTransportDeliveries: seen,
          verifiedBinding: { ...verifiedBinding, connectionGeneration: 3 },
        },
      ).outcome,
    ).toBe("inserted");
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
        connectionGeneration: 2,
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
        connectionGeneration: 2,
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
          observation: {
            ...capture.observation,
            revisionNonce: "message-edit",
            text: "altered replay",
          },
        },
        { seenTransportDeliveries: seen, verifiedBinding },
      ),
    ).toThrow("DuplicateKeyConflict");
    expect(() =>
      assertValidSourceLedgerCapture(
        {
          ...capture,
          observation: {
            ...capture.observation,
            threadKey: "thread_changed",
          },
        },
        { seenTransportDeliveries: seen, verifiedBinding },
      ),
    ).toThrow("DuplicateKeyConflict");
    expect(() =>
      assertValidSourceLedgerCapture(
        {
          ...capture,
          routing: { ...capture.routing, effectKey: "source-effect-changed" },
        },
        { seenTransportDeliveries: seen, verifiedBinding },
      ),
    ).toThrow("DuplicateKeyConflict");
    expect(() =>
      assertValidSourceLedgerCapture(
        {
          ...capture,
          envelope: { ...capture.envelope, organizationKey: "" },
        },
        { verifiedBinding },
      ),
    ).toThrow("TenantMismatch");
    expect(() =>
      assertValidSourceLedgerCapture(
        {
          ...capture,
          envelope: { ...capture.envelope, channelKey: "other" },
        },
        { verifiedBinding },
      ),
    ).toThrow("ChannelAccessLost");
    expect(() =>
      assertValidSourceLedgerCapture(
        {
          ...capture,
          observation: {
            ...capture.observation,
            sourceTimestamp: "2026-07-20 10:00",
          },
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

  it("rejects missing and cross-tenant verified channel bindings before key derivation", () => {
    expect(() => assertValidSourceLedgerCapture(capture)).toThrow(
      "ChannelAccessLost",
    );
    expect(() =>
      assertValidSourceLedgerCapture(capture, {
        verifiedBinding: {
          ...verifiedBinding,
          organizationKey: "agency_other",
        },
      }),
    ).toThrow("TenantMismatch");
    expect(() =>
      assertValidSourceLedgerCapture(capture, {
        verifiedBinding: { ...verifiedBinding, channelKey: "chn_other" },
      }),
    ).toThrow("ChannelAccessLost");
  });

  it("rolls back durable source ledger writes when a later write fails", async () => {
    const t = convexTest({ schema: transientConvexSchema, modules });
    const rows = buildSourceLedgerRows(capture, { verifiedBinding });

    await expect(
      t.run(async (ctx) => {
        await ctx.db.insert("providerEventReceipts", rows.receipt);
        await ctx.db.insert("sourceArtifacts", rows.artifact);
        await ctx.db.insert("sourceRevisions", rows.revision);
        throw new Error("simulate sourceProcessingJobs write failure");
      }),
    ).rejects.toThrow("simulate sourceProcessingJobs write failure");

    await expect(
      t.run(async (ctx) => ({
        receipts: await ctx.db.query("providerEventReceipts").collect(),
        artifacts: await ctx.db.query("sourceArtifacts").collect(),
        revisions: await ctx.db.query("sourceRevisions").collect(),
        jobs: await ctx.db.query("sourceProcessingJobs").collect(),
      })),
    ).resolves.toEqual({
      receipts: [],
      artifacts: [],
      revisions: [],
      jobs: [],
    });
  });

  it("stages all source ledger rows before mutating caller state", () => {
    const seen = new Set<string>();
    const rows = buildSourceLedgerRows(capture, {
      seenTransportDeliveries: seen,
      verifiedBinding,
    });

    expect(seen.size).toBe(0);
    expect(rows.receipt.transportDeliveryId).toBe("evt_1");
    expect(rows.artifact.sourceKey).toBe(rows.receipt.sourceKey);
    expect(rows.revision.sourceRevisionKey).toBe(
      rows.receipt.sourceRevisionKey,
    );
    expect(rows.processingJob.sourceRevisionKey).toBe(
      rows.receipt.sourceRevisionKey,
    );

    expect(() =>
      buildSourceLedgerRows(
        {
          ...capture,
          observation: { ...capture.observation, text: "x".repeat(32_001) },
        },
        { seenTransportDeliveries: seen, verifiedBinding },
      ),
    ).toThrow("PayloadTooLarge");
    expect(seen.size).toBe(0);
  });
});
