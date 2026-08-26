import {
  nangoProxyHeaders,
  nangoProxyUrl,
  nonEmptyString,
  positiveInteger,
  record,
  recordArray,
  stableHash,
  type ProviderReconciliationInventory,
  type ProviderSourceObservation,
  type ProviderSourceScope,
} from "./sourceMetadata";

type Request = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type HubSpotObjectTypeInput = Readonly<{
  objectType: string;
  properties: readonly string[];
}>;

export type HubSpotSourceMetadata = Readonly<{
  portalId: string;
  objectType: string;
  createdAt: number | null;
  archived: boolean;
  properties: Readonly<Record<string, string | null>>;
  propertiesHash: string;
}>;

export type HubSpotSourceObservation = ProviderSourceObservation<
  "hubspot",
  HubSpotSourceMetadata
>;

export type HubSpotScope = ProviderSourceScope<"hubspot"> &
  Readonly<{ objectTypes: readonly HubSpotObjectTypeInput[] }>;

export type HubSpotInventory = Omit<
  ProviderReconciliationInventory<"hubspot", HubSpotSourceObservation>,
  "scope"
> &
  Readonly<{
    scope: HubSpotScope;
    objectTypesScanned: readonly string[];
  }>;

export type HubSpotLimits = Readonly<{
  maxObjectTypes?: number;
  maxSources?: number;
  maxPages?: number;
}>;

export class HubSpotAdapterError extends Error {
  readonly _tag = "HubSpotAdapterError";

  constructor(
    readonly reason:
      "invalid_input" | "invalid_response" | "provider_unavailable",
  ) {
    super(`HubSpot adapter failed: ${reason}`);
    this.name = "HubSpotAdapterError";
  }
}

export class HubSpotCapacityExceeded extends Error {
  readonly _tag = "HubSpotCapacityExceeded";

  constructor(
    readonly resource: "object_types" | "sources" | "pages",
    readonly capacity: number,
  ) {
    super(`HubSpot ${resource} capacity of ${capacity} was exceeded.`);
    this.name = "HubSpotCapacityExceeded";
  }
}

export const defaultHubSpotObjectTypes = [
  {
    objectType: "companies",
    properties: [
      "name",
      "domain",
      "industry",
      "description",
      "city",
      "state",
      "country",
    ],
  },
  {
    objectType: "contacts",
    properties: [
      "firstname",
      "lastname",
      "email",
      "jobtitle",
      "company",
      "website",
    ],
  },
  {
    objectType: "deals",
    properties: [
      "dealname",
      "amount",
      "dealstage",
      "pipeline",
      "closedate",
      "hubspot_owner_id",
    ],
  },
] as const satisfies readonly HubSpotObjectTypeInput[];

const DEFAULT_MAX_OBJECT_TYPES = 20;
const DEFAULT_MAX_SOURCES = 50_000;
const DEFAULT_MAX_PAGES = 5_000;
const SAFE_OBJECT_TYPE = /^[a-z][a-z0-9_-]{0,63}$/u;
const SAFE_PROPERTY = /^[a-zA-Z][a-zA-Z0-9_]{0,127}$/u;

const requireTimestamp = (value: unknown): number => {
  const raw = nonEmptyString(value);
  const parsed = raw === undefined ? Number.NaN : Date.parse(raw);
  if (!Number.isFinite(parsed))
    throw new HubSpotAdapterError("invalid_response");
  return parsed;
};

const optionalTimestamp = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  return requireTimestamp(value);
};

const normalizeObjectTypes = (
  input: readonly HubSpotObjectTypeInput[],
): readonly HubSpotObjectTypeInput[] => {
  const normalized = input.map(({ objectType, properties }) => ({
    objectType: objectType.trim(),
    properties: [
      ...new Set(properties.map((property) => property.trim())),
    ].sort(),
  }));
  if (
    normalized.length === 0 ||
    normalized.some(
      ({ objectType, properties }) =>
        !SAFE_OBJECT_TYPE.test(objectType) ||
        properties.length === 0 ||
        properties.some((property) => !SAFE_PROPERTY.test(property)),
    ) ||
    new Set(normalized.map(({ objectType }) => objectType)).size !==
      normalized.length
  ) {
    throw new HubSpotAdapterError("invalid_input");
  }
  return normalized.sort((left, right) =>
    left.objectType.localeCompare(right.objectType),
  );
};

const validateInput = (input: {
  readonly providerConfigKey: string;
  readonly connectionId: string;
  readonly connectionGeneration: number;
  readonly portalId: string;
  readonly allowlistGeneration: number;
  readonly observedAt: number;
}) => {
  if (
    input.providerConfigKey.trim().length === 0 ||
    input.connectionId.trim().length === 0 ||
    !Number.isSafeInteger(input.connectionGeneration) ||
    input.connectionGeneration < 1 ||
    input.portalId.trim().length === 0 ||
    !Number.isSafeInteger(input.allowlistGeneration) ||
    input.allowlistGeneration < 1 ||
    !Number.isFinite(input.observedAt) ||
    input.observedAt < 0
  ) {
    throw new HubSpotAdapterError("invalid_input");
  }
};

const makeScope = (input: {
  readonly providerConfigKey: string;
  readonly connectionId: string;
  readonly connectionGeneration: number;
  readonly portalId: string;
  readonly allowlistGeneration: number;
  readonly objectTypes: readonly HubSpotObjectTypeInput[];
}): HubSpotScope => {
  const identity = {
    providerKey: "hubspot" as const,
    providerConfigKey: input.providerConfigKey,
    connectionId: input.connectionId,
    connectionGeneration: input.connectionGeneration,
    containerKey: input.portalId,
    allowlistGeneration: input.allowlistGeneration,
    objectTypes: input.objectTypes,
  };
  return { ...identity, scopeKey: `hss_${stableHash(identity)}` };
};

const propertiesFor = (
  value: unknown,
  requestedProperties: readonly string[],
): Readonly<Record<string, string | null>> => {
  const source = record(value);
  if (source === undefined) throw new HubSpotAdapterError("invalid_response");
  return Object.fromEntries(
    requestedProperties.map((property) => {
      const value = source[property];
      if (value === null || value === undefined) return [property, null];
      if (typeof value !== "string")
        throw new HubSpotAdapterError("invalid_response");
      return [property, value];
    }),
  );
};

const projectObject = (
  objectType: string,
  requestedProperties: readonly string[],
  row: Readonly<Record<string, unknown>>,
  input: { readonly portalId: string; readonly observedAt: number },
): HubSpotSourceObservation => {
  const id = nonEmptyString(row.id);
  if (id === undefined) throw new HubSpotAdapterError("invalid_response");
  const updatedAt = requireTimestamp(row.updatedAt);
  const properties = propertiesFor(row.properties, requestedProperties);
  const propertiesHash = stableHash(properties);
  return {
    providerKey: "hubspot",
    sourceKey: `hubspot:${objectType}:${id}`,
    providerObjectId: id,
    revisionKey: `hubspot:${objectType}:${id}:updated:${updatedAt}:hash:${propertiesHash}`,
    observationOrder: { kind: "updated_at", value: String(updatedAt) },
    sourceModifiedAt: updatedAt,
    observedAt: input.observedAt,
    sourceLocator: `hubspot://portal/${encodeURIComponent(input.portalId)}/${encodeURIComponent(objectType)}/${encodeURIComponent(id)}`,
    tombstone: row.archived === true,
    metadata: {
      portalId: input.portalId,
      objectType,
      createdAt: optionalTimestamp(row.createdAt),
      archived: row.archived === true,
      properties,
      propertiesHash,
    },
  };
};

const nextAfter = (
  body: Readonly<Record<string, unknown>>,
): string | undefined => {
  const paging = record(body.paging);
  const next = record(paging?.next);
  const after = next?.after;
  return typeof after === "number" && Number.isSafeInteger(after)
    ? String(after)
    : nonEmptyString(after);
};

export const fetchHubSpotInventory = async (input: {
  readonly secretKey: string;
  readonly providerConfigKey: string;
  readonly connectionId: string;
  readonly connectionGeneration: number;
  readonly portalId: string;
  readonly allowlistGeneration: number;
  readonly observedAt: number;
  readonly objectTypes?: readonly HubSpotObjectTypeInput[];
  readonly request?: Request;
  readonly limits?: HubSpotLimits;
}): Promise<HubSpotInventory> => {
  validateInput(input);
  const objectTypes = normalizeObjectTypes(
    input.objectTypes ?? defaultHubSpotObjectTypes,
  );
  const maxObjectTypes = positiveInteger(
    input.limits?.maxObjectTypes,
    DEFAULT_MAX_OBJECT_TYPES,
  );
  const maxSources = positiveInteger(
    input.limits?.maxSources,
    DEFAULT_MAX_SOURCES,
  );
  const maxPages = positiveInteger(input.limits?.maxPages, DEFAULT_MAX_PAGES);
  if (objectTypes.length > maxObjectTypes)
    throw new HubSpotCapacityExceeded("object_types", maxObjectTypes);
  const request = input.request ?? fetch;
  const headers = nangoProxyHeaders(input);
  const observations = new Map<string, HubSpotSourceObservation>();
  let pagesRead = 0;

  for (const objectType of objectTypes) {
    let after: string | undefined;
    const seenAfter = new Set<string>();
    do {
      if (pagesRead >= maxPages)
        throw new HubSpotCapacityExceeded("pages", maxPages);
      const response = await request(
        nangoProxyUrl(`crm/v3/objects/${objectType.objectType}`, {
          limit: "100",
          archived: "false",
          properties: objectType.properties.join(","),
          ...(after === undefined ? {} : { after }),
        }),
        { headers },
      );
      if (!response.ok) throw new HubSpotAdapterError("provider_unavailable");
      let body: Readonly<Record<string, unknown>> | undefined;
      try {
        body = record(await response.json());
      } catch {
        throw new HubSpotAdapterError("invalid_response");
      }
      const results = recordArray(body?.results);
      if (body === undefined || results === undefined)
        throw new HubSpotAdapterError("invalid_response");
      pagesRead += 1;
      for (const row of results) {
        const projected = projectObject(
          objectType.objectType,
          objectType.properties,
          row,
          input,
        );
        const current = observations.get(projected.sourceKey);
        if (
          current !== undefined &&
          current.revisionKey !== projected.revisionKey
        )
          throw new HubSpotAdapterError("invalid_response");
        if (current === undefined) {
          if (observations.size >= maxSources)
            throw new HubSpotCapacityExceeded("sources", maxSources);
          observations.set(projected.sourceKey, projected);
        }
      }
      after = nextAfter(body);
      if (after !== undefined) {
        if (seenAfter.has(after))
          throw new HubSpotAdapterError("invalid_response");
        seenAfter.add(after);
      }
    } while (after !== undefined);
  }

  const sources = [...observations.values()].sort((left, right) =>
    left.sourceKey.localeCompare(right.sourceKey),
  );
  return {
    scope: makeScope({ ...input, objectTypes }),
    observations: sources,
    sourceCount: sources.length,
    pagesRead,
    objectTypesScanned: objectTypes.map(({ objectType }) => objectType),
    completedAt: input.observedAt,
    complete: true,
  };
};
