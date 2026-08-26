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
  it("records an error when any snapshot or Brain page operation fails", () => {
    const createPage = syncSlack.indexOf("pages.createMarkdown");
    const updatePage = syncSlack.indexOf("pages.updateMarkdown");
    const failureHandler = syncSlack.indexOf("Effect.tapError");
    const errorStatus = syncSlack.indexOf('status: "error"', failureHandler);

    expect(createPage).toBeGreaterThan(-1);
    expect(updatePage).toBeGreaterThan(createPage);
    expect(failureHandler).toBeGreaterThan(updatePage);
    expect(errorStatus).toBeGreaterThan(failureHandler);
    expect(syncSlack.slice(failureHandler)).toContain(
      'errorCode: "slack_sync_failed"',
    );
  });
});
