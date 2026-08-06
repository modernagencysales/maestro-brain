import { randomUUID } from "node:crypto";

import * as Config from "effect/Config";
import * as ConfigError from "effect/ConfigError";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { ProviderMode } from "../index";
import {
  boundedNangoRecordLimit,
  type NangoListRecordsInput,
  type NangoRecordPage,
} from "./records";

export class NangoConfigError extends Error {
  readonly _tag = "NangoConfigError";
  constructor(
    readonly input: {
      readonly missingEnv: readonly string[];
      readonly invalidEnv: readonly string[];
    },
  ) {
    super("Nango configuration is invalid");
  }
  get missingEnv() {
    return this.input.missingEnv;
  }
  get invalidEnv() {
    return this.input.invalidEnv;
  }
}

export class ConnectSessionInvalid extends Error {
  readonly _tag = "ConnectSessionInvalid";
  constructor() {
    super("Connect session is invalid");
  }
}

export class ProviderUnavailable extends Error {
  readonly _tag = "ProviderUnavailable";
  constructor() {
    super("Nango provider is unavailable");
  }
}

export type NangoConnectSession = {
  readonly connectSessionId: string;
  readonly connectSessionToken: string;
  readonly expiresAt: number;
};

export type NangoConnectionMetadata = {
  readonly organizationKey: string;
  readonly endUserId: string;
  readonly providerConfigKey: string;
  readonly correlationTag: string;
};

type NangoSdk = {
  readonly createConnectSession: (body: unknown) => Promise<{
    readonly data?: {
      readonly token?: unknown;
      readonly expires_at?: unknown;
    };
  }>;
  readonly getConnection: (
    providerConfigKey: string,
    connectionId: string,
  ) => Promise<{
    readonly provider_config_key?: unknown;
    readonly end_user?: {
      readonly id?: unknown;
      readonly organization?: { readonly id?: unknown } | null;
      readonly tags?: Record<string, unknown> | null;
    } | null;
    readonly tags?: Record<string, unknown> | null;
  }>;
  readonly proxy?: (input: {
    readonly method: string;
    readonly endpoint: string;
    readonly providerConfigKey: string;
    readonly connectionId: string;
    readonly data?: unknown;
  }) => Promise<unknown>;
  readonly listRecords?: (input: NangoListRecordsInput) => Promise<{
    readonly records: readonly Record<string, unknown>[];
    readonly next_cursor: string | null;
  }>;
};

export type NangoClient = {
  readonly createConnectSession: (input: {
    readonly organizationKey: string;
    readonly endUserId: string;
    readonly providerConfigKey: string;
    readonly correlationTag: string;
    readonly connectSessionId?: string;
  }) => Promise<NangoConnectSession>;
  readonly verifyConnectSession: (input: {
    readonly connectSessionId: string;
    readonly connectionId: string;
  }) => Promise<NangoConnectionMetadata>;
  readonly proxy: (input: {
    readonly connectionId: string;
    readonly endpoint: string;
    readonly method: "GET" | "POST";
    readonly data?: unknown;
  }) => Promise<{ readonly status: number; readonly data?: unknown }>;
  readonly listRecords: (
    input: NangoListRecordsInput,
  ) => Promise<NangoRecordPage>;
};

const requiredLiveEnv = ["NANGO_SECRET_KEY"] as const;
const secretKeyPattern = /^(sk_|xox[a-z]-|nango_secret)/i;
const unsafeConnectionIdPattern =
  /^(sk_|xox[a-z]-|nango_secret|connect_public_)/i;
const sensitiveKeyPattern =
  /(token|secret|api[-_]?key|password|authorization)/i;

export const providerModeFromEnv = (
  env: Readonly<Record<string, string | undefined>>,
): ProviderMode => {
  const raw = env.APP_PROVIDER_MODE?.trim();
  if (raw === undefined || raw.length === 0) return "fake";
  if (raw === "fake" || raw === "test" || raw === "live") return raw;
  throw new NangoConfigError({
    missingEnv: [],
    invalidEnv: ["APP_PROVIDER_MODE"],
  });
};

export const validateNangoEnv = (
  mode: ProviderMode,
  env: Readonly<Record<string, string | undefined>>,
): true | NangoConfigError => {
  if (mode !== "live") return true;

  const missingEnv: string[] = [];
  const invalidEnv: string[] = [];
  for (const name of requiredLiveEnv) {
    const value = env[name];
    const trimmed = value?.trim();
    if (!trimmed) {
      missingEnv.push(name);
    }
  }

  return missingEnv.length > 0 || invalidEnv.length > 0
    ? new NangoConfigError({ missingEnv, invalidEnv })
    : true;
};

export const isSecretShapedNangoValue = (value: string): boolean =>
  secretKeyPattern.test(value);
export const isUnsafeNangoConnectionId = (value: string): boolean =>
  unsafeConnectionIdPattern.test(value);

export const redactNangoDiagnostic = <T extends Record<string, unknown>>(
  diagnostic: T,
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(diagnostic).map(([key, value]) => [
      key,
      sensitiveKeyPattern.test(key) ? "[redacted]" : value,
    ]),
  );

export const createFakeNangoClient = (input: {
  readonly now: number;
  readonly providerConfigKey?: string;
}): NangoClient => ({
  createConnectSession: async ({ organizationKey, connectSessionId }) => {
    if (organizationKey === "timeout") throw new ProviderUnavailable();
    const sessionId =
      connectSessionId ?? `maestro-session-${randomUUID().replace(/-/g, "")}`;
    return {
      connectSessionId: sessionId,
      connectSessionToken: `connect_public_${sessionId}`,
      expiresAt: input.now + 300_000,
    };
  },
  verifyConnectSession: async ({ connectSessionId, connectionId }) => {
    if (isUnsafeNangoConnectionId(connectionId))
      throw new ConnectSessionInvalid();
    if (!connectSessionId.startsWith("maestro-session-")) {
      throw new ConnectSessionInvalid();
    }
    return {
      organizationKey: `nango-org-${input.providerConfigKey ?? "slack"}-${connectSessionId.replace(/^maestro-session-/, "")}`,
      endUserId: `nango-user-${input.providerConfigKey ?? "slack"}-${connectSessionId.replace(/^maestro-session-/, "")}`,
      providerConfigKey: input.providerConfigKey ?? "slack",
      correlationTag: `${input.providerConfigKey ?? "slack"}-connect:${connectSessionId}`,
    };
  },
  proxy: async () => ({ status: 200, data: { ok: true } }),
  listRecords: async () => ({ records: [], nextCursor: null }),
});
const stringField = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

export const createLiveNangoClient = (input: {
  readonly secretKey: string;
  readonly providerConfigKey: string;
  readonly nango?: NangoSdk;
}): NangoClient => {
  let nangoPromise: Promise<NangoSdk> | undefined;
  const loadNango = () => {
    nangoPromise ??= input.nango
      ? Promise.resolve(input.nango)
      : import("@nangohq/node").then(
          ({ Nango }) =>
            new Nango({
              apiKey: input.secretKey,
            }) as NangoSdk,
        );
    return nangoPromise;
  };

  return {
    createConnectSession: async ({
      organizationKey,
      endUserId,
      providerConfigKey,
      correlationTag,
      connectSessionId,
    }) => {
      if (providerConfigKey !== input.providerConfigKey) {
        throw new ConnectSessionInvalid();
      }
      const nango = await loadNango();
      const response = await nango.createConnectSession({
        allowed_integrations: [providerConfigKey],
        end_user: { id: endUserId },
        organization: { id: organizationKey },
        tags: { correlationTag },
      });
      const token = stringField(response.data?.token);
      const expiresAt = stringField(response.data?.expires_at);
      const expiresAtMs =
        expiresAt === null ? Number.NaN : Date.parse(expiresAt);
      if (token === null || !Number.isFinite(expiresAtMs)) {
        throw new ProviderUnavailable();
      }
      return {
        connectSessionId: connectSessionId ?? randomUUID(),
        connectSessionToken: token,
        expiresAt: expiresAtMs,
      };
    },
    verifyConnectSession: async ({ connectionId }) => {
      if (isUnsafeNangoConnectionId(connectionId)) {
        throw new ConnectSessionInvalid();
      }
      const nango = await loadNango();
      const connection = await nango.getConnection(
        input.providerConfigKey,
        connectionId,
      );
      const providerConfigKey = stringField(connection.provider_config_key);
      const endUserId = stringField(connection.end_user?.id);
      const organizationKey = stringField(
        connection.end_user?.organization?.id,
      );
      const correlationTag = stringField(
        connection.end_user?.tags?.correlationTag ??
          connection.tags?.correlationTag,
      );
      if (
        providerConfigKey !== input.providerConfigKey ||
        endUserId === null ||
        organizationKey === null ||
        correlationTag === null
      ) {
        throw new ConnectSessionInvalid();
      }
      return {
        organizationKey,
        endUserId,
        providerConfigKey,
        correlationTag,
      };
    },
    proxy: async ({ connectionId, endpoint, method, data }) => {
      const nango = await loadNango();
      if (nango.proxy === undefined) throw new ProviderUnavailable();
      const response = await nango.proxy({
        connectionId,
        endpoint,
        method,
        providerConfigKey: input.providerConfigKey,
        ...(data === undefined ? {} : { data }),
      });
      const record =
        typeof response === "object" && response !== null
          ? (response as { readonly status?: unknown; readonly data?: unknown })
          : {};
      return {
        status: typeof record.status === "number" ? record.status : 200,
        ...(record.data === undefined ? {} : { data: record.data }),
      };
    },
    listRecords: async (request) => {
      if (request.providerConfigKey !== input.providerConfigKey) {
        throw new ConnectSessionInvalid();
      }
      const nango = await loadNango();
      if (nango.listRecords === undefined) throw new ProviderUnavailable();
      try {
        const page = await nango.listRecords({
          connectionId: request.connectionId,
          providerConfigKey: request.providerConfigKey,
          model: request.model,
          ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
          limit: boundedNangoRecordLimit(request.limit),
          ...(request.filter === undefined ? {} : { filter: request.filter }),
        });
        if (!Array.isArray(page.records)) throw new ProviderUnavailable();
        return { records: page.records, nextCursor: page.next_cursor };
      } catch {
        throw new ProviderUnavailable();
      }
    },
  };
};

export type NangoProviderService = {
  readonly clientFor: (input: {
    readonly now: number;
    readonly providerConfigKey?: string;
  }) => NangoClient;
};

export class NangoProvider extends Context.Tag("NangoProvider")<
  NangoProvider,
  NangoProviderService
>() {}

export const NangoProviderFake = Layer.succeed(NangoProvider, {
  clientFor: createFakeNangoClient,
});

const ProviderModeConfig = Config.withDefault(
  Config.literal("fake", "test", "live")("APP_PROVIDER_MODE"),
  "fake" as const,
);
const NangoSecretKeyConfig = Config.string("NANGO_SECRET_KEY");

export const createNangoProviderLayer = (
  input: {
    readonly nangoFactory?: (input: {
      readonly secretKey: string;
      readonly providerConfigKey: string;
    }) => NangoSdk;
  } = {},
): Layer.Layer<NangoProvider, ConfigError.ConfigError> =>
  Layer.effect(
    NangoProvider,
    Effect.gen(function* () {
      const mode = yield* ProviderModeConfig;
      if (mode !== "live") return { clientFor: createFakeNangoClient };
      const secretKeyRaw = yield* NangoSecretKeyConfig;
      const validation = validateNangoEnv("live", {
        NANGO_SECRET_KEY: secretKeyRaw,
      });
      if (validation !== true) {
        return yield* Effect.fail(
          ConfigError.InvalidData([], validation.message),
        );
      }
      const secretKey = secretKeyRaw.trim();
      return {
        clientFor: ({ providerConfigKey = "slack" }) => {
          const nango = input.nangoFactory?.({ secretKey, providerConfigKey });
          return createLiveNangoClient({
            secretKey,
            providerConfigKey,
            ...(nango === undefined ? {} : { nango }),
          });
        },
      };
    }),
  );
