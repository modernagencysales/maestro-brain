import { describe, expect, it } from "vitest";
import {
  providerConfigReport,
  providerDescriptors,
  redactProviderPayload,
  validateProviderConfig,
} from "./index";

describe("provider adapter descriptors", () => {
  it("declares every required default provider family", () => {
    expect(providerDescriptors.map((provider) => provider.id)).toEqual([
      "workos",
      "posthog",
      "dodo",
      "mailersend",
      "openrouter",
      "storage",
      "search",
    ]);
    expect(providerDescriptors.every((provider) => provider.fakeMode)).toBe(
      true,
    );
    expect(providerDescriptors.every((provider) => provider.liveMode)).toBe(
      true,
    );
  });

  it("allows fake mode without secrets", () => {
    expect(validateProviderConfig("workos", "fake", {})).toBe(true);
    expect(providerConfigReport("fake", {}).every((entry) => entry.ready)).toBe(
      true,
    );
  });

  it("reports missing live env names without secret values", () => {
    const result = validateProviderConfig("dodo", "live", {
      DODO_API_KEY: "secret-key",
    });

    expect(result).toMatchObject({
      _tag: "ProviderConfigError",
      provider: "dodo",
      missingEnv: ["DODO_WEBHOOK_SECRET"],
    });
    expect(JSON.stringify(result)).not.toContain("secret-key");
  });

  it("redacts provider payload fields by descriptor", () => {
    expect(
      redactProviderPayload("openrouter", {
        apiKey: "secret",
        prompt: "source text",
        model: "example-model",
      }),
    ).toEqual({
      apiKey: "[redacted]",
      prompt: "[redacted]",
      model: "example-model",
    });
  });
});
