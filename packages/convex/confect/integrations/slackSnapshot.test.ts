import { describe, expect, it } from "vitest";

import {
  buildSlackEvidenceItems,
  SlackThreadSegmentCapacityExceeded,
} from "./slackSnapshot";

const input = {
  workspaceId: "workspace_1" as never,
  scopeKey: "slack:apero-slack:channel:C1:lookback:30",
  runKey: "run-1",
  observedAt: 1_782_924_800_000,
};

describe("Slack Brain projection", () => {
  it("projects a thread into one stable cited evidence revision", () => {
    const [item] = buildSlackEvidenceItems(
      {
        channels: [
          {
            id: "C01",
            name: "company-context",
            messages: [
              {
                timestamp: "178.1",
                revisionTimestamp: "179.2",
                threadRootTimestamp: "178.1",
                parentTimestamp: null,
                authorId: "U01",
                text: "Our ICP is…",
              },
              {
                timestamp: "178.2",
                revisionTimestamp: "178.2",
                threadRootTimestamp: "178.1",
                parentTimestamp: "178.1",
                authorId: "U02",
                text: "Confirmed for the advisory offer.",
              },
            ],
          },
        ],
        messageCount: 2,
      },
      input,
    );

    expect(item).toMatchObject({
      workspaceId: "workspace_1",
      provider: "slack",
      scopeKey: "slack:apero-slack:channel:C1:lookback:30",
      runKey: "run-1",
      sourceKey: "slack:C01:thread:178.1:segment:0",
      title: "Slack · #company-context · Thread 178.1",
      locator: "slack://channel/C01/message/178.1",
      sourceModifiedAt: 179_200,
      observedAt: 1_782_924_800_000,
    });
    expect(item?.revisionKey).toMatch(/^thread-v1:[a-f0-9]{64}$/);
    expect(item?.providerMetadataHash).toMatch(/^[a-f0-9]{64}$/);
    expect(item?.markdown).toBe(
      "### U01 · 178.1\n\nOur ICP is…\n\n### U02 · 178.2\n\nConfirmed for the advisory offer.",
    );
    expect(JSON.parse(item?.providerMetadataJson ?? "{}")).toMatchObject({
      schemaVersion: 1,
      channelId: "C01",
      channelName: "company-context",
      threadRootTimestamp: "178.1",
      segmentIndex: 0,
      segmentCount: 1,
      messageRefs: [
        {
          timestamp: "178.1",
          revisionTimestamp: "179.2",
          authorId: "U01",
          locator: "slack://channel/C01/message/178.1",
        },
        {
          timestamp: "178.2",
          revisionTimestamp: "178.2",
          authorId: "U02",
          locator: "slack://channel/C01/message/178.2",
        },
      ],
    });
  });

  it("splits an oversized thread deterministically on message boundaries", () => {
    const messages = Array.from({ length: 33 }, (_, index) => ({
      timestamp: `178.${String(index + 1).padStart(2, "0")}`,
      revisionTimestamp: `178.${String(index + 1).padStart(2, "0")}`,
      threadRootTimestamp: "178.01",
      parentTimestamp: index === 0 ? null : "178.01",
      authorId: `U${index + 1}`,
      text: `Message ${index + 1}`,
    }));
    const items = buildSlackEvidenceItems(
      {
        channels: [{ id: "C01", name: "company-context", messages }],
        messageCount: messages.length,
      },
      input,
    );

    expect(items).toHaveLength(2);
    expect(items.map(({ sourceKey }) => sourceKey)).toEqual([
      "slack:C01:thread:178.01:segment:0",
      "slack:C01:thread:178.01:segment:1",
    ]);
    expect(
      items.map((item) => JSON.parse(item.providerMetadataJson).segmentCount),
    ).toEqual([2, 2]);
  });

  it("fails explicitly when one message cannot fit a bounded segment", () => {
    expect(() =>
      buildSlackEvidenceItems(
        {
          channels: [
            {
              id: "C01",
              name: "company-context",
              messages: [
                {
                  timestamp: "178.1",
                  revisionTimestamp: "178.1",
                  threadRootTimestamp: "178.1",
                  parentTimestamp: null,
                  authorId: "U01",
                  text: "x".repeat(24_000),
                },
              ],
            },
          ],
          messageCount: 1,
        },
        input,
      ),
    ).toThrow(SlackThreadSegmentCapacityExceeded);
  });
});
