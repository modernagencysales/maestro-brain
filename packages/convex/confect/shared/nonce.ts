import { base64UrlEncode } from "./tokenCrypto";

export type Nonce = {
  readonly next: () => string;
};

export const createDeterministicNonce = (values: readonly string[]): Nonce => {
  let index = 0;

  return {
    next: () => {
      const value = values[index];

      if (!value) {
        throw new Error("No deterministic nonce values remain");
      }

      index += 1;
      return value;
    },
  };
};

export const createWebCryptoNonce = (
  random: Pick<Crypto, "getRandomValues"> = crypto,
  byteLength = 15,
): Nonce => ({
  next: () => {
    const bytes = new Uint8Array(byteLength);

    random.getRandomValues(bytes);

    return base64UrlEncode(bytes);
  },
});
