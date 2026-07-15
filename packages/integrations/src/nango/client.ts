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
  if (mode === "fake") return true;

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
  createConnectSession: async ({ organizationKey }) => {
    if (organizationKey === "timeout") throw new ProviderUnavailable();
    return {
      connectSessionId: `cs_${organizationKey}_${input.now}`,
      connectSessionToken: `connect_public_${organizationKey}_${input.now}`,
      expiresAt: input.now + 300_000,
    };
  },
  verifyConnectSession: async ({ connectSessionId, connectionId }) => {
    if (isSecretShapedNangoValue(connectionId))
      throw new ConnectSessionInvalid();
    if (!connectionId.startsWith("conn_")) throw new ConnectSessionInvalid();
    const [, organizationKey = ""] =
      connectSessionId.match(/^cs_(.+)_\d+$/) ?? [];
    if (organizationKey.length === 0) throw new ConnectSessionInvalid();
    return {
      organizationKey,
      endUserId: organizationKey,
      providerConfigKey: "slack",
      correlationTag: `slack-connect:${organizationKey}:${connectSessionId.split("_").at(-1)}`,
    };
  },
});
