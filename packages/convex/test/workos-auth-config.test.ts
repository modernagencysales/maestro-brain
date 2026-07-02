import { describe, expect, it } from "vitest";
import authConfig, {
  deriveWorkosConvexAuthConfig,
} from "../convex/auth.config";

describe("Convex WorkOS auth config", () => {
  it("exports fake-safe default config and derivation helper", () => {
    expect(authConfig.providers[0]).toMatchObject({
      type: "customJwt",
      issuer: "https://api.workos.com",
      applicationID: "client_fake_local_key",
      algorithm: "RS256",
    });
    expect(
      deriveWorkosConvexAuthConfig({
        issuer: "https://issuer.example.test",
        jwksUrl: "https://issuer.example.test/jwks",
        applicationId: "client_test",
      }),
    ).toMatchObject({
      providers: [
        {
          issuer: "https://issuer.example.test",
          jwks: "https://issuer.example.test/jwks",
        },
      ],
    });
  });
});
