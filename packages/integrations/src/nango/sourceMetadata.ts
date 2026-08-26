import { sha256Hex } from "./sha256";

export type ProviderSourceScope<ProviderKey extends string = string> =
  Readonly<{
    providerKey: ProviderKey;
    providerConfigKey: string;
    connectionId: string;
    connectionGeneration: number;
    containerKey: string;
    allowlistGeneration: number;
    scopeKey: string;
  }>;

export type ProviderSourceObservation<
  ProviderKey extends string = string,
  Metadata extends Readonly<Record<string, unknown>> = Readonly<
    Record<string, unknown>
  >,
> = Readonly<{
  providerKey: ProviderKey;
  sourceKey: string;
  providerObjectId: string;
  revisionKey: string;
  observationOrder: Readonly<{ kind: string; value: string }>;
  sourceModifiedAt: number;
  observedAt: number;
  sourceLocator: string;
  tombstone: boolean;
  metadata: Metadata;
}>;

export type ProviderReconciliationInventory<
  ProviderKey extends string,
  Observation extends ProviderSourceObservation<ProviderKey>,
> = Readonly<{
  scope: ProviderSourceScope<ProviderKey>;
  observations: readonly Observation[];
  sourceCount: number;
  pagesRead: number;
  completedAt: number;
  complete: true;
}>;

export const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
};

export const stableHash = (value: unknown): string =>
  sha256Hex(stableJson(value));

export const nangoProxyHeaders = (input: {
  readonly secretKey: string;
  readonly providerConfigKey: string;
  readonly connectionId: string;
}) => ({
  Authorization: `Bearer ${input.secretKey}`,
  "Connection-Id": input.connectionId,
  "Provider-Config-Key": input.providerConfigKey,
});

export const nangoProxyUrl = (
  endpoint: string,
  query: Readonly<Record<string, string>>,
): URL => {
  const normalizedEndpoint = endpoint.startsWith("/")
    ? endpoint.slice(1)
    : endpoint;
  const url = new URL(`https://api.nango.dev/proxy/${normalizedEndpoint}`);
  for (const [key, value] of Object.entries(query))
    url.searchParams.set(key, value);
  return url;
};

export const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;

export const record = (
  value: unknown,
): Readonly<Record<string, unknown>> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;

export const recordArray = (
  value: unknown,
): readonly Readonly<Record<string, unknown>>[] | undefined =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        const parsed = record(item);
        return parsed === undefined ? [] : [parsed];
      })
    : undefined;

export const positiveInteger = (
  value: number | undefined,
  fallback: number,
): number =>
  value === undefined || !Number.isSafeInteger(value) || value < 1
    ? fallback
    : value;
