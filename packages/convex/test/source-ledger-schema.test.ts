import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import convexSchema from "../confect/_generated/convexSchema";

import {
  ProviderEventReceiptRow,
  SourceArtifactRow,
  SourceProcessingJobRow,
  SourceRevisionRow,
  assertValidSourceLedgerCapture,
  buildNoSourceProviderEventReceipt,
  buildSourceLedgerRows,
  getReadableCurrentSourceRevision,
  sourceLedgerKeysFor,
} from "../confect/sources/sourceSchemas";
import providerEventReceiptsSource from "../confect/tables/providerEventReceipts";
import sourceArtifactsSource from "../confect/tables/sourceArtifacts";
import sourceProcessingJobsSource from "../confect/tables/sourceProcessingJobs";
import sourceRevisionsSource from "../confect/tables/sourceRevisions";

const modules = import.meta.glob("../convex/**/!(*.*.*)*.*s");
const makeTest = () => convexTest(convexSchema, modules);
type TestDb = {
  readonly insert: (table: string, value: unknown) => Promise<unknown>;
  readonly query: (table: string) => {
    readonly collect: () => Promise<Array<Record<string, unknown>>>;
  };
};
const testDb = (ctx: { readonly db: unknown }) => ctx.db as TestDb;

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

const makeVerifiedBinding = (overrides: Record<string, unknown> = {}) => ({
  providerEventId: "Ev_acme_1",
  signatureVerification: {
    status: "verified" as const,
    receiptHash: `sha256:${"a".repeat(64)}`,
  },
  replayVerification: {
    status: "accepted" as const,
    receiptHash: `sha256:${"b".repeat(64)}`,
  },
  organizationKey: "agency_acme",
  connectionKey: "slack_agency_acme",
  connectionGeneration: 2,
  teamId: "T_acme",
  appId: "A_acme",
  botUserId: "B_acme",
  channelKey: "chn_general",
  externalChannelId: "C_general",
  ...overrides,
});

const verifiedBinding = makeVerifiedBinding();
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
      by_org_stage_status_next_retry: [
        "organizationKey",
        "stage",
        "executionStatus",
        "nextRetryAt",
      ],
      by_org_effect_key: ["organizationKey", "effectKey"],
      by_org_unit_idempotency_key: [
        "organizationKey",
        "organizationUnitIdempotencyKey",
      ],
      by_org_unit_stage: ["organizationKey", "unitKey", "stage"],
      by_org_lease_expiry: ["organizationKey", "leaseExpiresAt"],
      by_organization_status: ["organizationKey", "executionStatus"],
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
        verifiedBinding: makeVerifiedBinding({
          ...verifiedBinding,
          organizationKey: "agency_other",
          connectionKey: "slack_agency_other",
          providerEventId: "Ev_other_1",
        }),
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
      {
        verifiedBinding: makeVerifiedBinding({
          ...verifiedBinding,
          connectionGeneration: 3,
          providerEventId: "Ev_acme_gen_3",
        }),
      },
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
      providerEventId: "Ev_acme_1",
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
        "2026-07-20T10:00:00.000Z|rev_1|agency_acme|slack_agency_acme|2|live|evt_1",
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
      stage: "assembled",
      executionStatus: "queued",
      effectKey: rows.processingJob?.effectKey,
      policyGeneration: 7,
      attempt: 0,
      attemptReceipts: [],
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

  it("requires upstream Slack verification evidence and preserves provider event receipts", () => {
    expect(() =>
      assertValidSourceLedgerCapture(capture, {
        verifiedBinding: {
          ...verifiedBinding,
          signatureVerification: {
            status: "unverified",
            receiptHash: `sha256:${"a".repeat(64)}`,
          },
        } as never,
      }),
    ).toThrow("ChannelAccessLost");

    const rows = buildSourceLedgerRows(capture, { verifiedBinding });
    expect(rows.receipt.providerEventId).toBe("Ev_acme_1");
    expect(rows.receipt.signatureVerification).toStrictEqual(
      verifiedBinding.signatureVerification,
    );
    expect(rows.receipt.replayVerification).toStrictEqual(
      verifiedBinding.replayVerification,
    );
  });

  it("selects readable current rows by exact tenant artifact and never falls back past tombstones", () => {
    const rows = buildSourceLedgerRows(capture, { verifiedBinding });
    expect(rows.artifact).not.toBeNull();
    expect(rows.revision).not.toBeNull();
    if (!rows.artifact || !rows.revision) throw new Error("expected rows");
    const artifact = rows.artifact;
    const revision = rows.revision;
    expect(
      getReadableCurrentSourceRevision({
        organizationKey: "agency_acme",
        connectionKey: "slack_agency_acme",
        connectionGeneration: 2,
        channelKey: "chn_general",
        sourceKey: artifact.sourceKey,
        artifact,
        revisions: [revision],
      })?.sourceRevisionKey,
    ).toBe(revision.sourceRevisionKey);
    expect(
      getReadableCurrentSourceRevision({
        organizationKey: "agency_other",
        connectionKey: "slack_agency_acme",
        connectionGeneration: 2,
        channelKey: "chn_general",
        sourceKey: artifact.sourceKey,
        artifact,
        revisions: [revision],
      }),
    ).toBeNull();

    const tombstoneRows = buildSourceLedgerRows(
      {
        ...capture,
        envelope: { ...capture.envelope, transportDeliveryId: "evt_delete" },
        observation: {
          ...capture.observation,
          text: "",
          tombstone: true,
          sourceTimestamp: "2026-07-20T10:00:01.000Z",
          providerRevisionId: "rev_2",
          revisionNonce: "message-delete",
        },
      },
      {
        verifiedBinding: makeVerifiedBinding({
          ...verifiedBinding,
          providerEventId: "Ev_acme_delete",
        }),
        existingArtifact: {
          sourceKey: artifact.sourceKey,
          latestProviderOrder: artifact.latestProviderOrder,
          lifecycleGeneration: artifact.lifecycle.generation,
          createdAt: artifact.createdAt,
        },
      },
    );
    expect(
      getReadableCurrentSourceRevision({
        organizationKey: "agency_acme",
        connectionKey: "slack_agency_acme",
        connectionGeneration: 2,
        channelKey: "chn_general",
        sourceKey: artifact.sourceKey,
        artifact: tombstoneRows.artifact,
        revisions: [revision, tombstoneRows.revision].filter(
          (row): row is typeof revision => row !== null,
        ),
      }),
    ).toBeNull();
    expect(() =>
      getReadableCurrentSourceRevision({
        organizationKey: "agency_acme",
        connectionKey: "slack_agency_acme",
        connectionGeneration: 2,
        channelKey: "chn_general",
        sourceKey: artifact.sourceKey,
        artifact,
        revisions: [revision, { ...revision }],
      }),
    ).toThrow("DuplicateKeyConflict");
  });

  it("uses the minimum receipt tuple for equal primary order and preserves artifact creation time", () => {
    const first = buildSourceLedgerRows(capture, { verifiedBinding });
    expect(first.artifact).not.toBeNull();
    if (!first.artifact) throw new Error("expected artifact");
    const firstArtifact = first.artifact;
    const smallerReceipt = {
      ...capture,
      envelope: {
        ...capture.envelope,
        transport: "backfill" as const,
        transportDeliveryId: "aaa_min",
      },
      observation: {
        ...capture.observation,
        text: "equal primary correction",
        providerRevisionId: "rev_1",
        revisionNonce: "message-edit",
      },
    };
    const update = buildSourceLedgerRows(smallerReceipt, {
      verifiedBinding: makeVerifiedBinding({
        ...verifiedBinding,
        providerEventId: "Ev_acme_min",
      }),
      existingArtifact: {
        sourceKey: firstArtifact.sourceKey,
        latestProviderOrder: firstArtifact.latestProviderOrder,
        lifecycleGeneration: firstArtifact.lifecycle.generation,
        createdAt: firstArtifact.createdAt,
      },
    });

    expect(update.artifact).not.toBeNull();
    if (!update.artifact) throw new Error("expected update artifact");
    expect(update.artifact.createdAt).toBe(firstArtifact.createdAt);
    expect(update.artifact.updatedAt).toBe(capture.envelope.receivedAt);
    expect(
      update.artifact.latestProviderOrder < firstArtifact.latestProviderOrder,
    ).toBe(true);
    expect(() =>
      buildSourceLedgerRows(
        {
          ...smallerReceipt,
          envelope: {
            ...smallerReceipt.envelope,
            transport: "reconciliation" as const,
            transportDeliveryId: "zzz_max",
          },
        },
        {
          verifiedBinding: makeVerifiedBinding({
            ...verifiedBinding,
            providerEventId: "Ev_acme_max",
          }),
          existingArtifact: {
            sourceKey: firstArtifact.sourceKey,
            latestProviderOrder: firstArtifact.latestProviderOrder,
            lifecycleGeneration: firstArtifact.lifecycle.generation,
            createdAt: firstArtifact.createdAt,
          },
        },
      ),
    ).toThrow("DuplicateKeyConflict");
  });

  it("rejects no-source receipts when verification belongs to another tenant or channel", () => {
    expect(() =>
      buildNoSourceProviderEventReceipt(capture, {
        verifiedBinding: makeVerifiedBinding({
          organizationKey: "agency_other",
        }),
        outcome: "rejected",
        reasonCode: "channel_access_lost",
      }),
    ).toThrow("TenantMismatch");
    expect(() =>
      buildNoSourceProviderEventReceipt(capture, {
        verifiedBinding: makeVerifiedBinding({ channelKey: "chn_other" }),
        outcome: "rejected",
        reasonCode: "channel_access_lost",
      }),
    ).toThrow("ChannelAccessLost");
  });

  it("records sanitized invalid-payload no-source receipts without decoding malformed observation text", () => {
    const receipt = buildNoSourceProviderEventReceipt(
      {
        envelope: capture.envelope,
        observation: {
          providerObjectId: "bad/slash",
          providerRevisionId: "bad revision raw customer text",
          providerOrder: "bad/order raw customer text",
        },
      },
      {
        verifiedBinding,
        outcome: "rejected",
        reasonCode: "invalid_payload",
      },
    );

    expect(receipt).toMatchObject({
      outcome: "rejected",
      reason: "invalid_payload",
      providerObjectId: "invalid_payload",
      providerRevisionId: "invalid_payload",
      providerOrder: "invalid_payload",
      observationKey: null,
      sourceKey: null,
    });
    expect(JSON.stringify(receipt)).not.toContain("raw customer text");
    expect(JSON.stringify(receipt)).not.toContain("bad/");
  });

  it("constructs sanitized no-source receipts with outcome-compatible reasons", () => {
    const ignored = buildNoSourceProviderEventReceipt(capture, {
      verifiedBinding,
      outcome: "ignored_bot_output",
      reasonCode: "self_authored_bot",
    });
    expect(ignored).toMatchObject({
      outcome: "ignored_bot_output",
      observationKey: null,
      sourceKey: null,
      reason: "self_authored_bot",
    });
    expect(() =>
      buildNoSourceProviderEventReceipt(capture, {
        verifiedBinding,
        outcome: "ignored_bot_output",
        reasonCode: "invalid_payload" as never,
      }),
    ).toThrow("ObservationInvalid");
    expect(() =>
      buildNoSourceProviderEventReceipt(capture, {
        verifiedBinding,
        outcome: "rejected",
        reasonCode: "raw customer text",
      } as never),
    ).toThrow("ObservationInvalid");
  });

  it("rolls back real Convex writes after an injected source-ledger failure", async () => {
    const t = makeTest();
    const rows = buildSourceLedgerRows(capture, { verifiedBinding });
    await expect(
      t.run(async (ctx) => {
        await testDb(ctx).insert("providerEventReceipts", rows.receipt);
        await testDb(ctx).insert("sourceArtifacts", rows.artifact);
        throw new Error("injected durable write failure");
      }),
    ).rejects.toThrow("injected durable write failure");

    const emptyAfterFailure = await t.run(async (ctx) => ({
      receipts: await testDb(ctx).query("providerEventReceipts").collect(),
      artifacts: await testDb(ctx).query("sourceArtifacts").collect(),
      revisions: await testDb(ctx).query("sourceRevisions").collect(),
      jobs: await testDb(ctx).query("sourceProcessingJobs").collect(),
    }));
    expect(emptyAfterFailure).toEqual({
      receipts: [],
      artifacts: [],
      revisions: [],
      jobs: [],
    });

    await t.run(async (ctx) => {
      await testDb(ctx).insert("providerEventReceipts", rows.receipt);
      if (rows.artifact)
        await testDb(ctx).insert("sourceArtifacts", rows.artifact);
      if (rows.revision)
        await testDb(ctx).insert("sourceRevisions", rows.revision);
      if (rows.processingJob)
        await testDb(ctx).insert("sourceProcessingJobs", rows.processingJob);
    });
    const committed = await t.run(async (ctx) => ({
      receipts: await testDb(ctx).query("providerEventReceipts").collect(),
      artifacts: await testDb(ctx).query("sourceArtifacts").collect(),
      revisions: await testDb(ctx).query("sourceRevisions").collect(),
      jobs: await testDb(ctx).query("sourceProcessingJobs").collect(),
    }));
    expect(committed.receipts).toHaveLength(1);
    expect(committed.artifacts).toHaveLength(1);
    expect(committed.revisions).toHaveLength(1);
    expect(committed.jobs).toHaveLength(1);
    expect(
      committed.receipts.filter(
        (row) =>
          (row as { organizationKey?: string }).organizationKey ===
          "agency_other",
      ),
    ).toHaveLength(0);
  });
});
