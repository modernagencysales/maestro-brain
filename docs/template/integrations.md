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
