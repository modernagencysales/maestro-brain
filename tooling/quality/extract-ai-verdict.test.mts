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
});
