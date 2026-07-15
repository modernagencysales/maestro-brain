import { describe, expect, it } from "vitest";

import {
  NangoConfigError,
  createFakeNangoClient,
  redactNangoDiagnostic,
  validateNangoEnv,
} from "./client";

describe("Nango provider client boundary", () => {
  it("validates live env names without exposing secret values", () => {
    const result = validateNangoEnv("live", {
      NANGO_SECRET_KEY: ` ${`sk_${"live"}_secret`} `,
      NANGO_CONNECT_INTEGRATION_ID: "",
    });

    expect(result).toBeInstanceOf(NangoConfigError);
    expect(result).toMatchObject({
      _tag: "NangoConfigError",
      missingEnv: ["NANGO_CONNECT_INTEGRATION_ID"],
      invalidEnv: ["NANGO_SECRET_KEY"],
    });
    expect(JSON.stringify(result)).not.toContain(`sk_${"live"}_secret`);
    expect(validateNangoEnv("fake", {})).toBe(true);
  });

  it("rejects raw token shaped connection ids before provider calls", async () => {
    const client = createFakeNangoClient({ now: 1_782_924_800_000 });

    await expect(
      client.verifyConnectSession({
        organizationKey: "org_acme",
        connectSessionId: "connect_session_123",
        connectionId: `xox${"b"}-raw-slack-token`,
      }),
    ).rejects.toMatchObject({ _tag: "ConnectSessionInvalid" });
  });

  it("returns redacted fake connect sessions and classifies provider timeouts", async () => {
    const client = createFakeNangoClient({ now: 1_782_924_800_000 });
    const session = await client.createConnectSession({
      organizationKey: "org_acme",
    });

    expect(session).toEqual({
      connectSessionId: "cs_org_acme_1782924800000",
      connectSessionToken: `connect_public_${"org_acme"}_1782924800000`,
      expiresAt: 1_782_925_100_000,
    });
    expect(JSON.stringify(session)).not.toContain("secret");

    await expect(
      client.createConnectSession({ organizationKey: "timeout" }),
    ).rejects.toMatchObject({ _tag: "ProviderUnavailable" });
  });

  it("redacts provider diagnostics before logging", () => {
    expect(
      redactNangoDiagnostic({
        provider: "nango",
        connectSessionToken: `connect_public_${"org_acme"}_1782924800000`,
        secretKey: `sk_${"live"}_secret`,
        connectionId: "conn_org_acme",
      }),
    ).toEqual({
      provider: "nango",
      connectSessionToken: "[redacted]",
      secretKey: "[redacted]",
      connectionId: "conn_org_acme",
    });
  });
});
