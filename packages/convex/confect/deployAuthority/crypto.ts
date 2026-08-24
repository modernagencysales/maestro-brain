export const verifyIssuerSignature = async (
  publicKeySpki: string,
  message: string,
  signature: string,
): Promise<boolean> => {
  try {
    const key = await crypto.subtle.importKey(
      "spki",
      decodeBase64Url(publicKeySpki),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify(
      "Ed25519",
      key,
      decodeBase64Url(signature),
      new TextEncoder().encode(message),
    );
  } catch {
    return false;
  }
};
export const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
};
export const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
};
const decodeBase64Url = (value: string): ArrayBuffer => {
  const bytes = Uint8Array.from(
    atob(value.replace(/-/g, "+").replace(/_/g, "/")),
    (char) => char.charCodeAt(0),
  );
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
};
