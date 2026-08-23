const encoder = new TextEncoder();

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const string = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const hex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

const constantTimeEqual = (left: string, right: string): boolean => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
};

export const nangoWebhookSignatureFor = async (
  rawBody: string,
  signingKey: string,
): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody)));
};

export const verifyNangoWebhookSignature = async (input: {
  readonly rawBody: string;
  readonly signingKey: string;
  readonly signature: string | null;
}): Promise<boolean> => {
  if (
    input.rawBody.length === 0 ||
    input.signingKey.trim().length === 0 ||
    !/^[a-f0-9]{64}$/i.test(input.signature ?? "")
  )
    return false;
  const expected = await nangoWebhookSignatureFor(
    input.rawBody,
    input.signingKey,
  );
  return constantTimeEqual(expected, (input.signature ?? "").toLowerCase());
};

export type NangoSlackForward = Readonly<{
  connectionId: string;
  providerConfigKey: string;
  payload: Record<string, unknown>;
}>;

export type NangoSlackWebhook =
  | Readonly<{ kind: "slack_forward"; forward: NangoSlackForward }>
  | Readonly<{ kind: "ignored" }>
  | Readonly<{ kind: "unattributed_slack" }>
  | Readonly<{ kind: "malformed" }>;

export const parseNangoSlackWebhook = (value: unknown): NangoSlackWebhook => {
  const body = object(value);
  if (body === null) return { kind: "malformed" };

  if (body.from === "slack" && body.type === "forward") {
    const connectionId = string(body.connectionId);
    const providerConfigKey = string(body.providerConfigKey);
    const rawPayload = object(body.payload);
    if (
      connectionId === null ||
      providerConfigKey === null ||
      rawPayload === null
    )
      return { kind: "malformed" };
    const payload = Object.fromEntries(
      Object.entries(rawPayload).filter(([key]) => key !== "token"),
    );
    return {
      kind: "slack_forward",
      forward: { connectionId, providerConfigKey, payload },
    };
  }

  if (string(body.team_id) !== null || object(body.team) !== null)
    return { kind: "unattributed_slack" };

  return { kind: "ignored" };
};
