import { randomUUID } from "node:crypto";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
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
}): NangoClient => ({
  createConnectSession: async ({
    organizationKey,
    endUserId,
    connectSessionId,
  }) => {
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
      organizationKey: `nango-org-slack-${connectSessionId.replace(/^maestro-session-/, "")}`,
      endUserId: `nango-user-slack-${connectSessionId.replace(/^maestro-session-/, "")}`,
      providerConfigKey: "slack",
      correlationTag: `slack-connect:${connectSessionId}`,
    };
  },
});
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

export const createNangoProviderLayer = (): Layer.Layer<NangoProvider> =>
  NangoProviderFake;
