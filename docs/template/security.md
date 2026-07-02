# Security

Security defaults to tenant safety, typed boundaries, redaction, and fake
providers.

## Baseline

- No caller-supplied tenant identity.
- CSRF, CORS, and origin policy are explicit.
- HTTP responses from `packages/convex/confect/http.ts` include CSP, HSTS,
  `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and
  `Referrer-Policy: no-referrer`.
- Webhook signatures and replay windows are verified.
- Secrets never enter client bundles.
- Provider setup follows [env-manifest.md](./env-manifest.md); docs and handoff
  packets list secret names, never values.
- Logs redact secrets, tokens, raw provider payloads, and customer content.
- Public source maps are blocked in production unless explicitly approved.
- Storage URLs expire and are scoped.
- API keys are hashed, display-once, scoped, version-aware, and revocable.
- Support access is narrow, justified, and audited.
- Destructive actions require approvals or explicit typed confirmations.
- Prompt-injection boundaries separate source content from instructions.

## Review

Run `pnpm check:secret-canaries`, `pnpm check:auth-demo-bypass`, and focused
tests for changed auth, provider, storage, webhook, and support/admin behavior.
Review sensitive changes against this document and `coding-standards.md`.

Implemented safety checks:

- `packages/convex/test/http-docs.test.ts` verifies HTTP security headers.
- `packages/convex/test/data-lifecycle.test.ts` verifies export/delete
  confirmation and current-resource lifecycle planning.
- `packages/notifications/src/index.test.ts` verifies outbound alerts redact
  payload metadata before leaving the seam.
