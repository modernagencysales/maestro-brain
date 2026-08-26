import { describe, expect, it } from "vitest";

import { buildSlackEvidenceItems } from "./slackSnapshot";

describe("Slack Brain projection", () => {
  it("projects messages into stable provider evidence revisions", () => {
    expect(
      buildSlackEvidenceItems(
        {
          channels: [
            {
              id: "C01",
              name: "company-context",
              messages: [
                {
                  timestamp: "178.1",
                  revisionTimestamp: "179.2",
                  authorId: "U01",
                  text: "Our ICP is…",
                },
              ],
            },
          ],
          messageCount: 1,
        },
        {
          workspaceId: "workspace_1" as never,
          connectionRef: "apero-slack",
          runKey: "run-1",
          observedAt: 1_782_924_800_000,
        },
      ),
    ).toEqual([
      {
        workspaceId: "workspace_1",
        provider: "slack",
        scopeKey: "slack:apero-slack",
        runKey: "run-1",
        sourceKey: "slack:C01:message:178.1",
        revisionKey: "179.2",
        title: "Slack · #company-context · U01",
        markdown: "Our ICP is…",
        locator: "slack://channel/C01/message/178.1",
        sourceModifiedAt: 179_200,
        observedAt: 1_782_924_800_000,
      },
    ]);
  });
});
