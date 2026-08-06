export const transcriptProviders = {
  fireflies: { providerConfigKey: "fireflies", auth: "api_key" },
  gong: { providerConfigKey: "gong-oauth", auth: "basic" },
  fathom: { providerConfigKey: "fathom-oauth", auth: "api_key" },
  granola: { providerConfigKey: "granola", auth: "api_key" },
} as const;

export type TranscriptProviderKey = keyof typeof transcriptProviders;

export class UnsupportedTranscriptProvider extends Error {
  readonly _tag = "UnsupportedTranscriptProvider";
  constructor() {
    super("Transcript provider is not supported");
  }
}

export const transcriptProviderFor = (provider: string) => {
  if (Object.hasOwn(transcriptProviders, provider))
    return transcriptProviders[provider as TranscriptProviderKey];
  throw new UnsupportedTranscriptProvider();
};
