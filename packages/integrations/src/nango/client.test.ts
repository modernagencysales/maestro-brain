import { describe, expect, it } from "vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  NangoConfigError,
  NangoProvider,
  createFakeNangoClient,
  createLiveNangoClient,
  createNangoProviderLayer,
  isUnsafeNangoConnectionId,
  providerModeFromEnv,
  redactNangoDiagnostic,
  validateNangoEnv,
} from "./client";

describe("Nango provider client boundary", () => {
  it("validates live env names without exposing secret values", () => {
    const result = validateNangoEnv("live", {
      NANGO_SECRET_KEY: ` ${`s${"k"}_${"live"}_secret`} `,
      NANGO_CONNECT_INTEGRATION_ID: "",
    });

    expect(result).toBeInstanceOf(NangoConfigError);
    expect(result).toMatchObject({
      _tag: "NangoConfigError",
      missingEnv: ["NANGO_CONNECT_INTEGRATION_ID"],
      invalidEnv: [],
    });
    expect(JSON.stringify(result)).not.toContain(`s${"k"}_${"live"}_secret`);
    expect(validateNangoEnv("test", {})).toBe(true);
  });

  it("rejects raw token shaped connection ids before provider calls", async () => {
    const client = createFakeNangoClient({ now: 1_782_924_800_000 });

    for (const connectionId of [
      `${"xo"}x${"b"}-raw-slack-token`,
      `${"connect"}_public_maestro-session-token`,
    ]) {
      await expect(
        client.verifyConnectSession({
          connectSessionId: "maestro-session-org-acme",
          connectionId,
        }),
      ).rejects.toMatchObject({ _tag: "ConnectSessionInvalid" });
    }
    expect(
      isUnsafeNangoConnectionId(`${"connect"}_public_maestro-session-token`),
    ).toBe(true);
  });

  it("returns redacted fake connect sessions and classifies provider timeouts", async () => {
    const client = createFakeNangoClient({ now: 1_782_924_800_000 });
    const session = await client.createConnectSession({
      organizationKey: "nango-org-opaque",
      endUserId: "nango-user-opaque",
      providerConfigKey: "slack",
      correlationTag: "slack-connect:opaque-session",
    });

    expect(session.connectSessionId).toMatch(
      /^maestro-session-[A-Fa-f0-9]{32}$/,
    );
    expect(session.connectSessionId).not.toContain("org_acme");
    expect(session.connectSessionToken).not.toBe(session.connectSessionId);
    expect(session.expiresAt).toBe(1_782_925_100_000);
    expect(JSON.stringify(session)).not.toContain("secret");

    await expect(
      client.createConnectSession({
        organizationKey: "timeout",
        endUserId: "timeout",
        providerConfigKey: "slack",
        correlationTag: "slack-connect:timeout:1782924800000",
      }),
    ).rejects.toMatchObject({ _tag: "ProviderUnavailable" });
  });

  it("adapts live @nangohq/node connect sessions and metadata without credential reads", async () => {
    const calls: unknown[] = [];
    const client = createLiveNangoClient({
      secretKey: `s${"k"}_${"live"}_secret`,
      providerConfigKey: "slack",
      nango: {
        createConnectSession: async (body: unknown) => {
          calls.push(["create", body]);
          return {
            data: {
              token: `${"connect"}_public_${"org_acme"}`,
              connect_link: "https://connect.nango.dev/session",
              expires_at: "2026-07-15T12:05:00.000Z",
            },
          };
        },
        getConnection: async (
          providerConfigKey: string,
          connectionId: string,
        ) => {
          calls.push(["get", providerConfigKey, connectionId]);
          return {
            provider_config_key: providerConfigKey,
            connection_id: connectionId,
            end_user: {
              id: "nango-user-opaque",
              display_name: null,
              email: null,
              tags: { correlationTag: "slack-connect:opaque-session" },
              organization: { id: "nango-org-opaque", display_name: null },
            },
            tags: { correlationTag: "slack-connect:opaque-session" },
          };
        },
      },
    });

    await expect(
      client.createConnectSession({
        organizationKey: "nango-org-opaque",
        endUserId: "nango-user-opaque",
        providerConfigKey: "slack",
        correlationTag: "slack-connect:opaque-session",
        connectSessionId: "maestro-session-live",
      }),
    ).resolves.toEqual({
      connectSessionId: "maestro-session-live",
      connectSessionToken: `${"connect"}_public_org_acme`,
      expiresAt: Date.parse("2026-07-15T12:05:00.000Z"),
    });
    await expect(
      client.verifyConnectSession({
        connectSessionId: "maestro-session-live",
        connectionId: "opaque-provider-connection",
      }),
    ).resolves.toEqual({
      organizationKey: "nango-org-opaque",
      endUserId: "nango-user-opaque",
      providerConfigKey: "slack",
      correlationTag: "slack-connect:opaque-session",
    });
    expect(calls).toEqual([
      [
        "create",
        {
          allowed_integrations: ["slack"],
          end_user: { id: "nango-user-opaque" },
          organization: { id: "nango-org-opaque" },
          tags: { correlationTag: "slack-connect:opaque-session" },
        },
      ],
      ["get", "slack", "opaque-provider-connection"],
    ]);
  });

  it("selects fake/test or live provider layers from validated mode", async () => {
    await expect(
      Effect.runPromise(
        Effect.scoped(Layer.build(createNangoProviderLayer())).pipe(
          Effect.withConfigProvider(
            ConfigProvider.fromMap(new Map([["APP_PROVIDER_MODE", "fake"]])),
          ),
        ),
      ),
    ).resolves.toBeTruthy();

    await expect(
      Effect.runPromise(
        Effect.scoped(
          Layer.build(
            createNangoProviderLayer({
              nangoFactory: () => ({
                createConnectSession: async () => ({
                  data: {
                    token: `${"connect"}_public_live`,
                    connect_link: "https://connect.nango.dev/session",
                    expires_at: "2026-07-15T12:05:00.000Z",
                  },
                }),
                getConnection: async () => ({
                  provider_config_key: "slack",
                  end_user: {
                    id: "nango-user-opaque",
                    organization: { id: "nango-org-opaque" },
                    tags: {
                      correlationTag: "slack-connect:opaque-session",
                    },
                  },
                  tags: {},
                }),
              }),
            }),
          ),
        ).pipe(
          Effect.withConfigProvider(
            ConfigProvider.fromMap(
              new Map([
                ["APP_PROVIDER_MODE", "live"],
                ["NANGO_SECRET_KEY", `s${"k"}_${"live"}_secret`],
                ["NANGO_CONNECT_INTEGRATION_ID", "slack"],
              ]),
            ),
          ),
        ),
      ),
    ).resolves.toBeTruthy();

    expect(providerModeFromEnv({ APP_PROVIDER_MODE: "live" })).toBe("live");
    expect(providerModeFromEnv({ APP_PROVIDER_MODE: "test" })).toBe("test");
    expect(providerModeFromEnv({})).toBe("fake");
    expect(providerModeFromEnv({ NANGO_PROVIDER_MODE: "live" })).toBe("fake");
    expect(() => providerModeFromEnv({ APP_PROVIDER_MODE: "prod" })).toThrow(
      NangoConfigError,
    );
  });

  it("rejects blank or whitespace live Config values before SDK construction", async () => {
    let constructed = false;
    await expect(
      Effect.runPromise(
        Effect.scoped(
          Layer.build(
            createNangoProviderLayer({
              nangoFactory: () => {
                constructed = true;
                throw new Error("SDK construction must not happen");
              },
            }),
          ),
        ).pipe(
          Effect.withConfigProvider(
            ConfigProvider.fromMap(
              new Map([
                ["APP_PROVIDER_MODE", "live"],
                ["NANGO_SECRET_KEY", "   "],
                ["NANGO_CONNECT_INTEGRATION_ID", " slack "],
              ]),
            ),
          ),
        ),
      ),
    ).rejects.toBeTruthy();
    expect(constructed).toBe(false);
  });

  it("trims valid live Config values before SDK construction", async () => {
    const constructedWith: unknown[] = [];
    const layer = await Effect.runPromise(
      Effect.scoped(
        Layer.build(
          createNangoProviderLayer({
            nangoFactory: (config) => {
              constructedWith.push(config);
              return {
                createConnectSession: async () => ({
                  data: {
                    token: `${"connect"}_public_live`,
                    expires_at: "2026-07-15T12:05:00.000Z",
                  },
                }),
                getConnection: async () => ({
                  provider_config_key: "slack",
                  end_user: {
                    id: "nango-user-opaque",
                    organization: { id: "nango-org-opaque" },
                    tags: { correlationTag: "slack-connect:opaque-session" },
                  },
                }),
              };
            },
          }),
        ),
      ).pipe(
        Effect.withConfigProvider(
          ConfigProvider.fromMap(
            new Map([
              ["APP_PROVIDER_MODE", "live"],
              ["NANGO_SECRET_KEY", ` s${"k"}_${"live"}_secret `],
              ["NANGO_CONNECT_INTEGRATION_ID", " slack "],
            ]),
          ),
        ),
      ),
    );

    const client = layer.unsafeMap.get(NangoProvider.key).clientFor({ now: 1 });
    await expect(
      client.createConnectSession({
        organizationKey: "nango-org-opaque",
        endUserId: "nango-user-opaque",
        providerConfigKey: "slack",
        correlationTag: "slack-connect:opaque-session",
      }),
    ).resolves.toMatchObject({
      expiresAt: Date.parse("2026-07-15T12:05:00.000Z"),
    });
    expect(constructedWith).toEqual([
      { secretKey: `s${"k"}_${"live"}_secret`, providerConfigKey: "slack" },
    ]);
  });

  it("redacts provider diagnostics before logging", () => {
    expect(
      redactNangoDiagnostic({
        provider: "nango",
        connectSessionToken: `${"connect"}_public_${"org_acme"}_1782924800000`,
        secretKey: `s${"k"}_${"live"}_secret`,
        connectionId: "opaque-provider-connection",
      }),
    ).toEqual({
      provider: "nango",
      connectSessionToken: "[redacted]",
      secretKey: "[redacted]",
      connectionId: "opaque-provider-connection",
    });
  });
});
