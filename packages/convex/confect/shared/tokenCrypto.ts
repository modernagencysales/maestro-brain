const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const bytesFromString = (value: string): Uint8Array =>
  textEncoder.encode(value);

const stringFromBytes = (value: Uint8Array): string =>
  textDecoder.decode(value);

const arrayBufferFromBytes = (value: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(value.byteLength);

  new Uint8Array(buffer).set(value);

  return buffer;
};

const toUint8Array = (value: ArrayBuffer): Uint8Array => new Uint8Array(value);

export const base64UrlEncode = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

export const base64UrlDecode = (value: string): Uint8Array => {
  const padded = value.padEnd(
    value.length + ((4 - (value.length % 4)) % 4),
    "=",
  );
  const base64 = padded.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64);

  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

export const sha256Base64Url = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    arrayBufferFromBytes(bytesFromString(value)),
  );

  return base64UrlEncode(toUint8Array(digest));
};

export const hmacSha256Base64Url = async (
  secret: string,
  payload: string,
): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    arrayBufferFromBytes(bytesFromString(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    arrayBufferFromBytes(bytesFromString(payload)),
  );

  return base64UrlEncode(toUint8Array(signature));
};

export const constantTimeEqual = (left: string, right: string): boolean => {
  const leftBytes = bytesFromString(left);
  const rightBytes = bytesFromString(right);
  const maxLength = Math.max(leftBytes.length, rightBytes.length);
  let diff = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < maxLength; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return diff === 0;
};

type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

const stableJson = (value: JsonValue): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  const record = value as { readonly [key: string]: JsonValue };

  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key] ?? null)}`)
    .join(",")}}`;
};

export const stableFingerprint = async (value: JsonValue): Promise<string> =>
  sha256Base64Url(stableJson(value));

export const decodeBase64UrlToString = (value: string): string =>
  stringFromBytes(base64UrlDecode(value));
