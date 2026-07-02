import { describe, expect, it } from "vitest";

import { extractLastVerdictJson } from "./ai-gate-log-verdict.mts";

describe("ai-gate-log-verdict", () => {
  it("extracts the last taste verdict marker from retry logs", () => {
    const log = [
      "first attempt",
      'prefix TASTE_VERDICT_JSON={"verdict":"ignored","files":[]}',
      'TASTE_VERDICT_JSON={"verdict":"block","files":[]}',
      "Attempt 1 failed - retrying",
      'TASTE_VERDICT_JSON={"verdict":"pass","files":[]}',
    ].join("\n");

    expect(extractLastVerdictJson(log, "TASTE_VERDICT_JSON")).toBe(
      '{"verdict":"pass","files":[]}',
    );
  });

  it("returns null for empty marker values", () => {
    expect(
      extractLastVerdictJson("TASTE_VERDICT_JSON=", "TASTE_VERDICT_JSON"),
    ).toBeNull();
  });

  it("extracts the last contract verdict marker without mixing marker types", () => {
    const log = [
      'TASTE_VERDICT_JSON={"verdict":"pass","files":[]}',
      'CONTRACT_VERDICT_JSON={"verdict":"block","findings":[]}',
      'CONTRACT_VERDICT_JSON={"verdict":"pass","findings":[]}',
    ].join("\n");

    expect(extractLastVerdictJson(log, "CONTRACT_VERDICT_JSON")).toBe(
      '{"verdict":"pass","findings":[]}',
    );
  });

  it("returns null when the log has no matching verdict marker", () => {
    expect(
      extractLastVerdictJson("no verdict here", "TASTE_VERDICT_JSON"),
    ).toBeNull();
  });
});
