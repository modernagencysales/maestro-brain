import { describe, expect, it } from "vitest";

import {
  captureAdmittedSlackEvent,
  normalizeAdmittedSlackEvent,
} from "./sourceCapture";

const binding = {
  providerEventId: "Ev123",
  signatureVerification: {
    status: "verified" as const,
    receiptHash: `sha256:${"1".repeat(64)}`,
  },
  replayVerification: {
    status: "accepted" as const,
    receiptHash: `sha256:${"2".repeat(64)}`,
  },
  organizationKey: "org_1",
  connectionKey: "conn_1",
  connectionGeneration: 2,
  teamId: "T1",
  appId: "A1",
  botUserId: "Ubot",
  channelKey: "chan_1",
  externalChannelId: "C1",
};

const envelope = {
  ...binding,
  transport: "live" as const,
  transportDeliveryId: "delivery_1",
  receivedAt: 1_700_000_100_000,
};

const event = {
  event_id: "Ev123",
  event: {
    type: "message",
    channel: "C1",
    ts: "1700000000.123456",
    thread_ts: "1700000000.000001",
    user: "U2",
    username: "Ada",
    text: "Keep this text exactly.",
    blocks: [{ type: "section", text: { type: "mrkdwn", text: "Keep" } }],
    permalink: "https://example.test/slack/p/1",
  },
};

const routing = {
  policyEpoch: 1,
  assemblyStage: "assembly_pending" as const,
  effectKey: "effect_1",
};

describe("Slack source capture", () => {
  it("normalizes an admitted message without interpreting its text", () => {
    expect(normalizeAdmittedSlackEvent(envelope, event, routing)).toEqual({
      envelope: {
        organizationKey: "org_1",
        connectionKey: "conn_1",
        connectionGeneration: 2,
        teamId: "T1",
        appId: "A1",
        botUserId: "Ubot",
        channelKey: "chan_1",
        externalChannelId: "C1",
        transport: "live",
        transportDeliveryId: "delivery_1",
        receivedAt: 1_700_000_100_000,
      },
      observation: {
        providerObjectId: "C1:1700000000.123456",
        threadKey: "C1:1700000000.000001",
        sourceTimestamp: "2023-11-14T22:13:20.123Z",
        providerOrder: "1700000000.123456",
        providerRevisionId: "Ev123",
        author: { providerUserId: "U2", displayName: "Ada" },
        text: "Keep this text exactly.",
        blocksJson:
          '[{"text":{"text":"Keep","type":"mrkdwn"},"type":"section"}]',
        permalink: "https://example.test/slack/p/1",
        tombstone: false,
        revisionNonce: "Ev123",
      },
      routing,
    });
  });

  it("captures app mentions through the same immutable message ledger", () => {
    expect(
      normalizeAdmittedSlackEvent(
        envelope,
        {
          ...event,
          event: { ...event.event, type: "app_mention" },
        },
        routing,
      ),
    ).toMatchObject({
      observation: {
        providerObjectId: "C1:1700000000.123456",
        text: "Keep this text exactly.",
      },
    });
  });

  it("emits a tombstone for a deleted message and preserves its thread", () => {
    const deleted = {
      event_id: "Ev124",
      event: {
        type: "message",
        subtype: "message_deleted",
        channel: "C1",
        event_ts: "1700000100.000001",
        deleted_ts: "1700000000.123456",
        previous_message: {
          ts: "1700000000.123456",
          thread_ts: "1700000000.000001",
        },
      },
    };

    expect(
      normalizeAdmittedSlackEvent(envelope, deleted, routing),
    ).toMatchObject({
      observation: {
        providerObjectId: "C1:1700000000.123456",
        threadKey: "C1:1700000000.000001",
        providerOrder: "1700000100.000001",
        providerRevisionId: "Ev124",
        text: "",
        blocksJson: "[]",
        permalink: "",
        tombstone: true,
      },
    });
  });

  it("orders edits and tombstones by Slack event time instead of event id", () => {
    const changed = {
      event_id: "Ev900",
      event: {
        type: "message",
        subtype: "message_changed",
        channel: "C1",
        event_ts: "1700000200.000001",
        message: {
          ts: "1700000000.123456",
          thread_ts: "1700000000.000001",
          user: "U2",
          username: "Ada",
          text: "Edited text.",
          blocks: [],
          permalink: "https://example.test/slack/p/1",
        },
      },
    };
    const deleted = {
      event_id: "Ev001",
      event: {
        type: "message",
        subtype: "message_deleted",
        channel: "C1",
        event_ts: "1700000300.000001",
        deleted_ts: "1700000000.123456",
        previous_message: {
          ts: "1700000000.123456",
          thread_ts: "1700000000.000001",
        },
      },
    };
    const delayedEdit = {
      ...changed,
      event_id: "Ev999",
      event: { ...changed.event, event_ts: "1700000250.000001" },
    };
    const sameTimeEdit = {
      ...changed,
      event_id: "Ev000",
    };
    const recreated = {
      ...changed,
      event_id: "Ev002",
      event: {
        ...changed.event,
        event_ts: "1700000400.000001",
        message: {
          ...changed.event.message,
          text: "Recreated text.",
        },
      },
    };
    const createRows = captureAdmittedSlackEvent(binding, event, {
      envelope,
      routing,
    });
    if (createRows.artifact === null)
      throw new Error("missing create artifact");
    const editRows = captureAdmittedSlackEvent(
      { ...binding, providerEventId: changed.event_id },
      changed,
      {
        envelope: { ...envelope, transportDeliveryId: "delivery_edit" },
        routing,
        existingArtifact: createRows.artifact,
      },
    );
    if (editRows.artifact === null) throw new Error("missing edit artifact");
    const deleteRows = captureAdmittedSlackEvent(
      { ...binding, providerEventId: deleted.event_id },
      deleted,
      {
        envelope: { ...envelope, transportDeliveryId: "delivery_delete" },
        routing,
        existingArtifact: editRows.artifact,
      },
    );
    if (deleteRows.artifact === null)
      throw new Error("missing tombstone artifact");

    expect(editRows.revision?.providerOrder).toBe("1700000200.000001");
    expect(deleteRows.revision?.providerOrder).toBe("1700000300.000001");
    expect(createRows.revision).toMatchObject({
      sourceCreatedAt: 1_700_000_000_123,
      sourceModifiedAt: 1_700_000_000_123,
    });
    expect(editRows.revision).toMatchObject({
      sourceCreatedAt: 1_700_000_000_123,
      sourceModifiedAt: 1_700_000_200_000,
    });
    expect(deleteRows.revision).toMatchObject({
      sourceCreatedAt: 1_700_000_000_123,
      sourceModifiedAt: 1_700_000_300_000,
    });
    expect(createRows.artifact.lifecycle.generation).toBe(1);
    expect(editRows.artifact.lifecycle.generation).toBe(2);
    expect(deleteRows.artifact.lifecycle.generation).toBe(3);
    expect(deleteRows.artifact.lifecycle.state).toBe("deleted_tombstone");
    expect(() =>
      captureAdmittedSlackEvent(
        { ...binding, providerEventId: delayedEdit.event_id },
        delayedEdit,
        {
          envelope: {
            ...envelope,
            transportDeliveryId: "delivery_delayed_edit",
          },
          routing,
          existingArtifact: deleteRows.artifact ?? undefined,
        },
      ),
    ).toThrow("DuplicateKeyConflict");
    expect(() =>
      captureAdmittedSlackEvent(
        { ...binding, providerEventId: sameTimeEdit.event_id },
        sameTimeEdit,
        {
          envelope: {
            ...envelope,
            transportDeliveryId: "delivery_same_time_edit",
          },
          routing,
          existingArtifact: editRows.artifact,
        },
      ),
    ).toThrow("DuplicateKeyConflict");

    const recreateRows = captureAdmittedSlackEvent(
      { ...binding, providerEventId: recreated.event_id },
      recreated,
      {
        envelope: {
          ...envelope,
          transportDeliveryId: "delivery_recreate",
        },
        routing,
        existingArtifact: deleteRows.artifact,
      },
    );
    expect(recreateRows.artifact?.lifecycle).toMatchObject({
      state: "active",
      generation: 4,
    });
  });

  it("builds ledger rows with deterministic hashes independent of input formatting", () => {
    const equivalent = {
      event_id: "Ev123",
      event: {
        permalink: "https://example.test/slack/p/1",
        blocks: [{ text: { text: "Keep", type: "mrkdwn" }, type: "section" }],
        text: "Keep this text exactly.",
        user: "U2",
        username: "Ada",
        thread_ts: "1700000000.000001",
        ts: "1700000000.123456",
        channel: "C1",
        type: "message",
      },
    };
    const first = captureAdmittedSlackEvent(binding, event, {
      envelope,
      routing,
    });
    const second = captureAdmittedSlackEvent(binding, equivalent, {
      envelope: { ...envelope, transportDeliveryId: "delivery_2" },
      routing,
    });

    expect(first.receipt.canonicalContentHash).toBe(
      second.receipt.canonicalContentHash,
    );
    expect(first.revision?.sourceRevisionKey).toBe(
      second.revision?.sourceRevisionKey,
    );
    expect(first.receipt.providerObjectId).toBe("C1:1700000000.123456");
  });

  it("delegates duplicate and replay detection to the ledger contracts", () => {
    const first = captureAdmittedSlackEvent(binding, event, {
      envelope,
      routing,
      seenTransportDeliveries: new Set(),
    });
    const duplicate = captureAdmittedSlackEvent(binding, event, {
      envelope,
      routing,
      existingObservationKey: first.receipt.observationKey ?? undefined,
      seenTransportDeliveries: new Set(),
    });

    expect(first.receipt.outcome).toBe("inserted");
    expect(duplicate.receipt.outcome).toBe("duplicate");
    expect(duplicate.artifact).toBeNull();
    expect(duplicate.revision).toBeNull();
  });

  it("rejects a payload whose channel is not bound to the admitted tenant", () => {
    expect(() =>
      captureAdmittedSlackEvent(
        binding,
        { ...event, event: { ...event.event, channel: "C2" } },
        { envelope, routing },
      ),
    ).toThrow("ChannelAccessLost");
  });

  it("rejects a payload whose Slack team or app binding differs", () => {
    expect(() =>
      normalizeAdmittedSlackEvent(
        envelope,
        { ...event, team_id: "T2", api_app_id: "A1" },
        routing,
      ),
    ).toThrow("ChannelAccessLost");
  });
});
