import { describe, expect, it } from "vitest";

import { buildSlackPages } from "./slackSnapshot";

describe("Slack Brain projection", () => {
  it("projects channel messages into stable source-backed Brain pages", () => {
    expect(
      buildSlackPages(
        {
          channels: [
            {
              id: "C01",
              name: "company-context",
              messages: [
                { timestamp: "178.1", authorId: "U01", text: "Our ICP is…" },
              ],
            },
          ],
          messageCount: 1,
        },
        1_782_924_800_000,
      ),
    ).toEqual([
      {
        slug: "slack-c01",
        title: "Slack · #company-context",
        markdown:
          "# Slack · #company-context\n\n> Synced from Slack channel `C01` at 2026-07-01T16:53:20.000Z.\n\n### U01 · 178.1\n\nOur ICP is…\n",
      },
    ]);
  });
});
