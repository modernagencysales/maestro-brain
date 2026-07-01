# Security

Security defaults to tenant safety, typed boundaries, redaction, and fake
providers.

## Baseline

- No caller-supplied tenant identity.
- CSRF, CORS, and origin policy are explicit.
- Webhook signatures and replay windows are verified.
- Secrets never enter client bundles.
- Logs redact secrets, tokens, raw provider payloads, and customer content.
- Public source maps are blocked in production unless explicitly approved.
- Storage URLs expire and are scoped.
- API keys are hashed, display-once, scoped, version-aware, and revocable.
- Support access is narrow, justified, and audited.
- Destructive actions require approvals or explicit typed confirmations.
- Prompt-injection boundaries separate source content from instructions.

## Review

Run security gates after Task 18 lands. Until then, review sensitive changes
against this document and `coding-standards.md`.
