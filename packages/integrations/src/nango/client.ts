import { randomUUID } from "node:crypto";

import * as Context from "effect/Context";
import { Nango } from "@nangohq/node";
import * as Layer from "effect/Layer";

import type { ProviderMode } from "../index";

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
};

const requiredLiveEnv = [
  "NANGO_SECRET_KEY",
  "NANGO_CONNECT_INTEGRATION_ID",
] as const;
const secretKeyPattern = /^(sk_|xox[a-z]-|nango_secret)/i;
const sensitiveKeyPattern =
  /(token|secret|api[-_]?key|password|authorization)/i;

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
    } else if (value !== trimmed) {
      invalidEnv.push(name);
    }
  }

  return missingEnv.length > 0 || invalidEnv.length > 0
    ? new NangoConfigError({ missingEnv, invalidEnv })
    : true;
};

export const isSecretShapedNangoValue = (value: string): boolean =>
  secretKeyPattern.test(value);

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
}): NangoClient => ({
  createConnectSession: async ({ organizationKey, connectSessionId }) => {
    if (organizationKey === "timeout") throw new ProviderUnavailable();
    return {
      connectSessionId:
        connectSessionId ?? `maestro-session-${organizationKey}-${input.now}`,
      connectSessionToken: `connect_public_${organizationKey}_${input.now}`,
      expiresAt: input.now + 300_000,
    };
  },
  verifyConnectSession: async ({ connectSessionId, connectionId }) => {
    if (isSecretShapedNangoValue(connectionId))
      throw new ConnectSessionInvalid();
    const [, organizationKey = "", timestamp = ""] =
      connectSessionId.match(/^maestro-session-(.+)-(\d+)$/) ?? [];
    if (organizationKey.length === 0 || timestamp.length === 0) {
      throw new ConnectSessionInvalid();
    }
    return {
      organizationKey,
      endUserId: organizationKey,
      providerConfigKey: "slack",
      correlationTag: `slack-connect:${organizationKey}:${timestamp}`,
    };
  },
});
const stringField = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

export const createLiveNangoClient = (input: {
  readonly secretKey: string;
  readonly providerConfigKey: string;
  readonly nango?: NangoSdk;
}): NangoClient => {
  const nango =
    input.nango ??
    new Nango({
      apiKey: input.secretKey,
    });

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
      if (isSecretShapedNangoValue(connectionId)) {
        throw new ConnectSessionInvalid();
      }
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
  };
};

export type NangoProviderService = {
  readonly clientFor: (input: { readonly now: number }) => NangoClient;
};

export class NangoProvider extends Context.Tag("NangoProvider")<
  NangoProvider,
  NangoProviderService
>() {}

export const NangoProviderFake = Layer.succeed(NangoProvider, {
  clientFor: createFakeNangoClient,
});

export const createNangoProviderLayer = (input: {
  readonly mode: ProviderMode;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly nangoFactory?: (input: {
    readonly secretKey: string;
    readonly providerConfigKey: string;
  }) => NangoSdk;
}): Layer.Layer<NangoProvider> => {
  if (input.mode !== "live") return NangoProviderFake;
  const envResult = validateNangoEnv(input.mode, input.env);
  if (envResult !== true) throw envResult;
  const secretKey = input.env.NANGO_SECRET_KEY?.trim() ?? "";
  const providerConfigKey =
    input.env.NANGO_CONNECT_INTEGRATION_ID?.trim() ?? "slack";
  return Layer.succeed(NangoProvider, {
    clientFor: () => {
      const nango = input.nangoFactory?.({ secretKey, providerConfigKey });
      return createLiveNangoClient({
        secretKey,
        providerConfigKey,
        ...(nango === undefined ? {} : { nango }),
      });
    },
  });
};
