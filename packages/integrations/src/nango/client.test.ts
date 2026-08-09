import { afterEach, describe, expect, it, vi } from "vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  type NangoProviderService,
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
  afterEach(() => vi.unstubAllGlobals());

  it("validates live env names without exposing secret values", () => {
    const result = validateNangoEnv("live", {
      NANGO_SECRET_KEY: ` ${`s${"k"}_${"live"}_secret`} `,
    });

    expect(result).toBe(true);
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
        deleteConnection: async (
          providerConfigKey: string,
          connectionId: string,
        ) => {
          calls.push(["delete", providerConfigKey, connectionId]);
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
    await expect(
      client.deleteConnection({
        connectionId: "opaque-provider-connection",
      }),
    ).resolves.toBeUndefined();
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
      ["delete", "slack", "opaque-provider-connection"],
    ]);
  });

  it("caps and forwards managed-sync record requests without leaking provider failures", async () => {
    const calls: unknown[] = [];
    const client = createLiveNangoClient({
      secretKey: `s${"k"}_${"live"}_secret`,
      providerConfigKey: "fireflies",
      nango: {
        createConnectSession: async () => ({ data: {} }),
        getConnection: async () => ({}),
        listRecords: async (input) => {
          calls.push(input);
          return {
            records: [{ id: "call_1", title: "Acme weekly" }],
            next_cursor: "cursor_2",
          };
        },
      },
    });

    await expect(
      client.listRecords({
        connectionId: "conn_fireflies_1",
        providerConfigKey: "fireflies",
        model: "Meeting",
        cursor: "cursor_1",
        limit: 1_000,
        filter: "updated",
      }),
    ).resolves.toEqual({
      records: [{ id: "call_1", title: "Acme weekly" }],
      nextCursor: "cursor_2",
    });
    expect(calls).toEqual([
      {
        connectionId: "conn_fireflies_1",
        providerConfigKey: "fireflies",
        model: "Meeting",
        cursor: "cursor_1",
        limit: 100,
        filter: "updated",
      },
    ]);

    const failed = createLiveNangoClient({
      secretKey: `s${"k"}_${"live"}_secret`,
      providerConfigKey: "fireflies",
      nango: {
        createConnectSession: async () => ({ data: {} }),
        getConnection: async () => ({}),
        listRecords: async () => {
          throw new Error(`provider rejected s${"k"}_${"live"}_secret`);
        },
      },
    });
    const error = await failed
      .listRecords({
        connectionId: "conn_fireflies_1",
        providerConfigKey: "fireflies",
        model: "Meeting",
      })
      .catch((cause: unknown) => cause);
    expect(error).toMatchObject({ _tag: "ProviderUnavailable" });
    expect(JSON.stringify(error)).not.toContain(`s${"k"}_${"live"}_secret`);
  });

  it("uses the isolate-safe Nango HTTP API when no SDK is injected", async () => {
    const requests: Array<{
      readonly url: string;
      readonly init?: RequestInit;
    }> = [];
    vi.stubGlobal(
      "fetch",
      async (url: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(url), ...(init ? { init } : {}) });
        if (String(url).endsWith("/connect/sessions"))
          return new Response(
            JSON.stringify({
              data: {
                token: `${"connect"}_public_org_acme`,
                expires_at: "2026-07-15T12:05:00.000Z",
              },
            }),
            { status: 201, headers: { "content-type": "application/json" } },
          );
        if (init?.method === "DELETE")
          return new Response(null, { status: 404 });
        return new Response(
          JSON.stringify({ records: [{ id: "call_1" }], next_cursor: null }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );
    const client = createLiveNangoClient({
      secretKey: `s${"k"}_${"live"}_secret`,
      providerConfigKey: "fireflies",
    });

    await expect(
      client.createConnectSession({
        organizationKey: "nango-org-opaque",
        endUserId: "nango-user-opaque",
        providerConfigKey: "fireflies",
        correlationTag: "fireflies-connect:opaque-session",
        connectSessionId: "maestro-session-live",
      }),
    ).resolves.toEqual({
      connectSessionId: "maestro-session-live",
      connectSessionToken: `${"connect"}_public_org_acme`,
      expiresAt: Date.parse("2026-07-15T12:05:00.000Z"),
    });

    await expect(
      client.listRecords({
        connectionId: "connection-1",
        providerConfigKey: "fireflies",
        model: "Transcript",
      }),
    ).resolves.toEqual({ records: [{ id: "call_1" }], nextCursor: null });
    await expect(
      client.deleteConnection({
        connectionId: "connection/with space",
      }),
    ).resolves.toBeUndefined();
    const recordsRequest = requests.find(({ url }) =>
      url.includes("/records/"),
    );
    expect(recordsRequest?.url).toContain("/records/?model=Transcript");
    expect(recordsRequest?.init?.headers).toMatchObject({
      "Connection-Id": "connection-1",
      "Provider-Config-Key": "fireflies",
    });
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: expect.stringContaining(
            "/connections/connection%2Fwith%20space?provider_config_key=fireflies",
          ),
          init: expect.objectContaining({ method: "DELETE" }),
        }),
      ]),
    );
  });

  it("forwards redacted proxy status and Retry-After headers", async () => {
    const client = createLiveNangoClient({
      secretKey: `s${"k"}_${"live"}_secret`,
      providerConfigKey: "gong-oauth",
      nango: {
        createConnectSession: async () => ({ data: {} }),
        getConnection: async () => ({}),
        proxy: async () => ({
          status: 429,
          headers: { "Retry-After": "45", authorization: 123 },
        }),
      },
    });

    await expect(
      client.proxy({
        connectionId: "gong-connection",
        endpoint: "/v2/calls/extensive",
        method: "POST",
      }),
    ).resolves.toEqual({
      status: 429,
      headers: { "retry-after": "45" },
    });
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

  it("rejects a blank live secret before SDK construction", async () => {
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
              ]),
            ),
          ),
        ),
      ),
    ).rejects.toBeTruthy();
    expect(constructed).toBe(false);
  });

  it("trims the live secret and selects provider config per client", async () => {
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
            ]),
          ),
        ),
      ),
    );

    const provider: NangoProviderService = layer.unsafeMap.get(
      NangoProvider.key,
    );
    const client = provider.clientFor({
      now: 1,
      providerConfigKey: "fireflies",
    });
    await expect(
      client.createConnectSession({
        organizationKey: "nango-org-opaque",
        endUserId: "nango-user-opaque",
        providerConfigKey: "fireflies",
        correlationTag: "slack-connect:opaque-session",
      }),
    ).resolves.toMatchObject({
      expiresAt: Date.parse("2026-07-15T12:05:00.000Z"),
    });
    expect(constructedWith).toEqual([
      {
        secretKey: `s${"k"}_${"live"}_secret`,
        providerConfigKey: "fireflies",
      },
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
