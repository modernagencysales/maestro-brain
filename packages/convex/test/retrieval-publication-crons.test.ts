import { describe, expect, it } from "vitest";

import crons from "../confect/crons";
import convexCrons from "../convex/crons";

describe("retrieval publication recovery cron", () => {
  it("registers the bounded internal publication sweeper", () => {
    expect(Object.keys(crons.cronJobs)).toEqual([
      "recover Brain publication jobs",
    ]);
    expect(crons.cronJobs["recover Brain publication jobs"]?.args).toEqual({
      limit: 20,
      caller: {
        kind: "system",
        name: "retrieval-publication-cron",
        surface: "internal",
      },
    });
    expect(
      Object.keys(
        crons.convexCronJobs.crons as unknown as Record<string, unknown>,
      ),
    ).toEqual([
      "recover Brain publication jobs",
      "recover Slack publication target resolution",
    ]);
  });

  it("registers bounded recovery for Slack target-resolution intents", () => {
    const registered = convexCrons.crons as unknown as Record<
      string,
      { args?: unknown }
    >;
    expect(Object.keys(registered)).toEqual([
      "recover Brain publication jobs",
      "recover Slack publication target resolution",
    ]);
    expect(
      registered["recover Slack publication target resolution"]?.args,
    ).toEqual([{ limit: 20 }]);
  });
});
