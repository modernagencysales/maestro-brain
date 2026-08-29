import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { SlackChannelIds } from "./connections.spec";

describe("Slack sync scope contract", () => {
  it("accepts exactly one approved channel", () => {
    expect(Schema.decodeUnknownSync(SlackChannelIds)(["C01"])).toEqual(["C01"]);
  });

  it("rejects empty and multi-channel scopes", () => {
    expect(() => Schema.decodeUnknownSync(SlackChannelIds)([])).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(SlackChannelIds)(["C01", "C02"]),
    ).toThrow();
  });
});
