import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import {
  EnvConfigError,
  killSwitchOn,
  readOptionalEnv,
  readRequiredEnv,
  requireLiveEnv,
} from "../confect/shared/env";

describe("shared typed env access", () => {
  it("fails missing live secrets with a typed config error", () => {
    expect(() => readRequiredEnv("WORKOS_API_KEY", {})).toThrow(
      /Missing required env: WORKOS_API_KEY/,
    );
    expect(() =>
      Schema.decodeUnknownSync(EnvConfigError)({
        _tag: "EnvConfigError",
        name: "WORKOS_API_KEY",
        reason: "missing",
      }),
    ).not.toThrow();
  });

  it("fails whitespace live secrets", () => {
    expect(() =>
      readRequiredEnv("WORKOS_API_KEY", { WORKOS_API_KEY: "   " }),
    ).toThrow(/Blank required env: WORKOS_API_KEY/);
  });

  it("does not require live secrets in fake mode", () => {
    const result = requireLiveEnv(
      ["WORKOS_API_KEY", "OPENROUTER_API_KEY"],
      "fake",
      {},
    );

    expect(result).toEqual({});
  });

  it("returns trimmed optional and required values", () => {
    expect(
      readOptionalEnv("OPTIONAL_URL", { OPTIONAL_URL: "  https://x.test " }),
    ).toBe("https://x.test");
    expect(
      readRequiredEnv("REQUIRED_URL", { REQUIRED_URL: "  https://x.test " }),
    ).toBe("https://x.test");
  });

  it("requires live secrets outside fake mode", () => {
    expect(() =>
      requireLiveEnv(["WORKOS_API_KEY"], "live", {
        WORKOS_API_KEY: "",
      }),
    ).toThrow(/Blank required env: WORKOS_API_KEY/);

    expect(
      requireLiveEnv(["WORKOS_API_KEY"], "test", {
        WORKOS_API_KEY: " test_key ",
      }),
    ).toEqual({ WORKOS_API_KEY: "test_key" });
  });

  it("enables the LLM kill switch only for true", () => {
    expect(killSwitchOn({ LLM_DISABLED: "true" })).toBe(true);
    expect(killSwitchOn({ LLM_DISABLED: "TRUE" })).toBe(true);
    expect(killSwitchOn({ LLM_DISABLED: "false" })).toBe(false);
    expect(killSwitchOn({})).toBe(false);
  });
});
