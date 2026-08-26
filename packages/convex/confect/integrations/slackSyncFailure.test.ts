import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./connections.impl.ts", import.meta.url),
  "utf8",
);
const syncSlack = source.slice(
  source.indexOf("const syncSlack ="),
  source.indexOf("const recordSlackSync ="),
);

describe("Slack sync failure lifecycle", () => {
  it("fails the evidence run without reconciling removals when traversal fails", () => {
    const beginRun = syncSlack.indexOf("evidence.beginRun");
    const publishItem = syncSlack.indexOf("evidence.publishRunItem");
    const completeRun = syncSlack.indexOf("evidence.completeRun");
    const failureHandler = syncSlack.indexOf("Effect.tapError");
    const failRun = syncSlack.indexOf("evidence.failRun", failureHandler);
    const errorStatus = syncSlack.indexOf('status: "error"', failureHandler);

    expect(beginRun).toBeGreaterThan(-1);
    expect(publishItem).toBeGreaterThan(beginRun);
    expect(completeRun).toBeGreaterThan(publishItem);
    expect(failureHandler).toBeGreaterThan(completeRun);
    expect(failRun).toBeGreaterThan(failureHandler);
    expect(errorStatus).toBeGreaterThan(failureHandler);
    expect(syncSlack.slice(failureHandler)).toContain(
      'errorCode: "slack_sync_failed"',
    );
  });
});
