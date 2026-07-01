# Integrations

Integrations are Effect services with fake, test, and live layers. The template
must run without live credentials.

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
- Verify webhook signatures and replay windows.
- Keep raw provider payloads out of logs and public errors.
- Add fake-mode smoke tests before live setup.

## Inspect Readiness

The provider catalog lives in `packages/integrations/src/index.ts`. It declares
fake/test/live posture, required live env var names, and redacted fields for
each provider. Inspect it through:

```bash
pnpm exec tsx apps/cli/src/index.ts integrations report fake
pnpm exec tsx apps/cli/src/index.ts integrations report live
```

Live mode reports missing env var names only; it must not print secret values.
