# Integrations

Integrations are Effect services with fake, test, and live layers. The template
must run without live credentials. Adapter boundaries live in
`packages/integrations/src/index.ts` and return Effect programs with typed,
public-safe provider errors.

## Default Families

- `LlmGateway`
- `PolicyResolver`
- `Flags`
- `Billing`
- `Analytics`
- `ErrorReporter`
- `Email`
- `Notifications`
- `Storage`
- `Search`
- `Jobs`
- `Connectors`
- `Documents`
- `Operations`

## Concrete Adapter Targets

- WorkOS/AuthKit for auth and organizations.
- PostHog for analytics.
- Dodo for billing.
- MailerSend for email.
- OpenRouter-compatible LLM provider through an OpenAI-compatible client
  surface.

Resend, Sentry, Slack/webhooks, CRM, drive, and Notion connectors are optional
adapters.

## Rules

- Decode config through typed config modules.
- Redact provider errors.
- Redact common secret field names for every provider, then apply
  provider-specific redaction.
- Verify webhook signatures and replay windows.
- Keep raw provider payloads out of logs and public errors.
- Add fake-mode smoke tests before live setup.
- Live mode validates required env var names before an adapter can be
  constructed.

## Billing And Dodo

Dodo remains fake-first in the template. Live Dodo calls stay behind
`packages/integrations/src/dodo.ts`, while `packages/convex/confect/ops/billing`
stores the reusable billing state:

- webhook events deduplicate by provider, event ID, and signature timestamp
- usage events carry an entitlement key before they create append-only credit
  ledger entries
- entitlements model seats, credits, and feature limits without hard-coding a
  pricing plan
- seat checks return typed failures instead of silently over-provisioning

Fake billing receipts redact customer and provider metadata. Webhook
normalization also redacts raw payload `data`, so tests and logs can inspect
event identity without leaking customer emails, Dodo customer IDs, checkout
session IDs, or signatures.

## Inspect Readiness

The provider catalog lives in `packages/integrations/src/index.ts`. It declares
fake/test/live posture, required live env var names, redacted fields, adapter
construction, and deterministic fake/test/live-ready receipts for each provider.
Inspect it through:

```bash
pnpm exec tsx apps/cli/src/index.ts integrations report fake
pnpm exec tsx apps/cli/src/index.ts integrations report live
pnpm --dir packages/integrations test
```

Live mode reports missing env var names only; it must not print secret values.
Fake and test modes construct adapters without secrets and return redacted
receipts through the Effect error channel. Live mode is a configured boundary:
client apps replace the deterministic `live-ready` receipts with SDK-backed
provider calls inside the same adapter shape.
