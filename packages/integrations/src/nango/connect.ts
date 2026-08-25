export class NangoProviderUnavailable extends Error {
  readonly _tag = "NangoProviderUnavailable";
}

export class NangoConnectionInvalid extends Error {
  readonly _tag = "NangoConnectionInvalid";
}

type Request = (input: string | URL, init?: RequestInit) => Promise<Response>;

const workspaceKey = (workspaceId: string) => `workspace:${workspaceId}`;
const correlationTag = (workspaceId: string, generation: number) =>
  `slack:${workspaceId}:${generation}`;

const readJson = async (
  response: Response,
): Promise<Record<string, unknown>> => {
  if (!response.ok) throw new NangoProviderUnavailable();
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new NangoProviderUnavailable();
  }
};

const authorization = (secretKey: string) => ({
  authorization: `Bearer ${secretKey}`,
  "content-type": "application/json",
});

export const createNangoConnectSession = async (input: {
  readonly secretKey: string;
  readonly providerConfigKey: string;
  readonly workspaceId: string;
  readonly generation: number;
  readonly now: number;
  readonly request?: Request;
}) => {
  const request = input.request ?? fetch;
  const key = workspaceKey(input.workspaceId);
  const response = await request("https://api.nango.dev/connect/sessions", {
    method: "POST",
    headers: authorization(input.secretKey),
    body: JSON.stringify({
      allowed_integrations: [input.providerConfigKey],
      end_user: { id: key },
      organization: { id: key },
      tags: {
        correlationTag: correlationTag(input.workspaceId, input.generation),
      },
    }),
  });
  const body = await readJson(response);
  const data = (body.data ?? body) as Record<string, unknown>;
  const token = data.token;
  const providerExpiry = Date.parse(String(data.expires_at ?? ""));
  const localExpiry = input.now + 300_000;
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    !Number.isFinite(providerExpiry) ||
    providerExpiry <= input.now
  ) {
    throw new NangoProviderUnavailable();
  }
  return {
    connectSessionToken: token,
    expiresAt: Math.min(providerExpiry, localExpiry),
  };
};

export const verifyNangoConnection = async (input: {
  readonly secretKey: string;
  readonly providerConfigKey: string;
  readonly workspaceId: string;
  readonly generation: number;
  readonly connectionId: string;
  readonly request?: Request;
}) => {
  if (
    input.connectionId.trim().length === 0 ||
    /^(sk_|xox[a-z]-|nango_secret|connect_public_)/i.test(input.connectionId)
  ) {
    throw new NangoConnectionInvalid();
  }
  const request = input.request ?? fetch;
  const query = new URLSearchParams({
    provider_config_key: input.providerConfigKey,
  });
  const response = await request(
    `https://api.nango.dev/connections/${encodeURIComponent(input.connectionId)}?${query.toString()}`,
    { headers: authorization(input.secretKey) },
  );
  const body = await readJson(response);
  const connection = (body.data ?? body) as Record<string, unknown>;
  const endUser = (connection.end_user ?? {}) as Record<string, unknown>;
  const organization = (endUser.organization ?? {}) as Record<string, unknown>;
  const tags = (endUser.tags ?? connection.tags ?? {}) as Record<
    string,
    unknown
  >;
  // Nango normalizes connection tag keys to lowercase in API responses.
  const returnedCorrelationTag = tags.correlationtag ?? tags.correlationTag;
  const expectedKey = workspaceKey(input.workspaceId);
  if (
    connection.provider_config_key !== input.providerConfigKey ||
    endUser.id !== expectedKey ||
    organization.id !== expectedKey ||
    returnedCorrelationTag !==
      correlationTag(input.workspaceId, input.generation)
  ) {
    throw new NangoConnectionInvalid();
  }
  return { connectionId: input.connectionId };
};
