import { describe, expect, it } from "vitest";

import {
  UnsupportedTranscriptProvider,
  transcriptProviderFor,
  transcriptProviders,
} from "../transcripts/providers";

describe("transcript provider registry", () => {
  it("keeps provider configuration keys server-owned", () => {
    expect(transcriptProviders).toEqual({
      fireflies: { providerConfigKey: "fireflies", auth: "api_key" },
      gong: { providerConfigKey: "gong-oauth", auth: "oauth2" },
      fathom: { providerConfigKey: "fathom-oauth", auth: "oauth2" },
      granola: { providerConfigKey: "granola", auth: "api_key" },
    });
    expect(transcriptProviderFor("gong")).toEqual(transcriptProviders.gong);
    for (const provider of ["browser-controlled", "toString"]) {
      expect(() => transcriptProviderFor(provider)).toThrow(
        UnsupportedTranscriptProvider,
      );
    }
  });
});
