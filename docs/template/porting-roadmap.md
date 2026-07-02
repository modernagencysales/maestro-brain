# Template Porting Roadmap

Status: real execution roadmap.

This roadmap records when seams become live provider integrations. The detailed
implementation order lives in
`docs/superpowers/plans/2026-07-01-maestro-template-porting-implementation-plan.md`.

## Provider Gateway

- Rate limiting starts as a fake/test limiter in
  `packages/integrations/src/rateLimit.ts`.
- The real `@convex-dev/rate-limiter` component is wired only after headless API
  keys, workspace tenancy, usage attribution, billing ledger rows, and provider
  error envelopes are in place.
- The real component adapter must implement the `ConvexRateLimiterAdapter` shape
  and preserve the same typed `RateLimitDeniedError` mapping.
- Workflows and agents may consume rate-limit decisions through capabilities;
  they must not call the Convex component directly.
