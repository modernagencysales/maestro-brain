import { describe, expect, it } from "vitest";
import { parseAiVerdict } from "./extract-ai-verdict.mts";

describe("extract-ai-verdict", () => {
  it("accepts text and JSON pass verdicts", () => {
    expect(parseAiVerdict("verdict=pass")).toEqual({
      ok: true,
      verdict: "pass",
    });
    expect(parseAiVerdict('{"verdict":"pass","reason":"ok"}')).toEqual({
      ok: true,
      verdict: "pass",
    });
  });

  it("rejects missing, malformed, and failing verdicts", () => {
    expect(parseAiVerdict("verdict=fail")).toEqual({
      ok: false,
      reason: "missing parseable pass verdict",
    });
    expect(parseAiVerdict('{"verdict":"fail"}')).toEqual({
      ok: false,
      reason: "missing parseable pass verdict",
    });
    expect(parseAiVerdict("looks good")).toEqual({
      ok: false,
      reason: "missing parseable pass verdict",
    });
  });

  it("accepts gate logs carrying a passing VERDICT_JSON marker", () => {
    const tasteLog = [
      "taste-review: no changed source files",
      'TASTE_VERDICT_JSON={"verdict":"pass","files":[]}',
      "taste review passed (taste-v1)",
    ].join("\n");
    expect(parseAiVerdict(tasteLog)).toEqual({ ok: true, verdict: "pass" });

    const contractLog = [
      '{"verdict":"pass","findings":[]}',
      'CONTRACT_VERDICT_JSON={"verdict":"pass","findings":[]}',
    ].join("\n");
    expect(parseAiVerdict(contractLog)).toEqual({ ok: true, verdict: "pass" });
  });

  it("uses the last marker so retry logs settle on the final verdict", () => {
    const log = [
      'TASTE_VERDICT_JSON={"verdict":"block","files":[]}',
      "Attempt 1 failed - retrying",
      'TASTE_VERDICT_JSON={"verdict":"pass","files":[]}',
    ].join("\n");
    expect(parseAiVerdict(log)).toEqual({ ok: true, verdict: "pass" });
  });

  it("fails closed on blocking or unparseable markers even with pass text nearby", () => {
    const blockingLog = [
      "taste: verdict=pass reason=stale-line",
      'TASTE_VERDICT_JSON={"verdict":"block","files":[]}',
    ].join("\n");
    expect(parseAiVerdict(blockingLog)).toEqual({
      ok: false,
      reason: "blocking or unparseable AI gate verdict",
    });

    expect(parseAiVerdict("CONTRACT_VERDICT_JSON={not json")).toEqual({
      ok: false,
      reason: "blocking or unparseable AI gate verdict",
    });
  });
});
