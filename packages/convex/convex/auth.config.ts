export type WorkosConvexAuthConfig = {
  readonly providers: readonly [
    {
      readonly type: "customJwt";
      readonly issuer: string;
      readonly jwks: string;
      readonly applicationID: string;
    },
  ];
};

export const deriveWorkosConvexAuthConfig = (input: {
  readonly issuer: string;
  readonly jwksUrl: string;
  readonly applicationId: string;
}): WorkosConvexAuthConfig => ({
  providers: [
    {
      type: "customJwt",
      issuer: input.issuer,
      jwks: input.jwksUrl,
      applicationID: input.applicationId,
    },
  ],
});

const authConfig = deriveWorkosConvexAuthConfig({
  issuer: "https://api.workos.com",
  jwksUrl: "https://api.workos.com/sso/jwks/org_acme_demo",
  applicationId: "client_fake_local_key",
});

export default authConfig;
