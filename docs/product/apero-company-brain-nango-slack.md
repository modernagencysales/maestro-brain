# Nango Slack Operations

Maestro Brain uses Nango for Slack OAuth, token rotation, Events API URL
verification, webhook forwarding, and provider API calls. Maestro owns event
attribution, deduplication, capture, Brain routing, Ask Apero, and answer
policy.

## Required Nango configuration

1. Configure the `slack` integration in the same Nango environment used by the
   deployment.
2. Set the Nango environment webhook URL to
   `https://<convex-site>/webhooks/nango`.
3. Set `NANGO_SECRET_KEY`, `NANGO_CONNECT_INTEGRATION_ID=slack`, and
   `NANGO_WEBHOOK_SIGNING_KEY` on the Convex deployment. The webhook signing key
   comes from **Environment Settings > Webhooks > Signing key** and is distinct
   from the environment API key.
4. In the Slack app, use the Nango-provided Events API request URL. Subscribe to
   `message.channels`, `message.groups`, `message.im`, and `app_mention` as
   required by the pilot.
5. Connect Slack from the Brain **Connections** screen. Nango completes OAuth;
   the existing directory reconciliation records the bot identity and channels.
6. Activate the intended channel routing/delivery policies and link each Slack
   user who should use Ask Apero to a Brain identity.

Nango forwards attributed events with `connectionId`, `providerConfigKey`, and
the original Slack payload. Maestro rejects raw Slack payloads that Nango could
not attribute to a connection. Exact retries are idempotent by raw-body digest
and Slack `event_id`.

Outbound answers use the existing Nango Slack proxy and are requester-private.
No Slack access or bot token belongs in Maestro configuration.

## Acceptance checks

- An invalid `X-Nango-Hmac-Sha256` returns `401`.
- An unattributed raw Slack event returns `422`.
- A valid channel message creates one provider receipt and one source revision;
  retrying it does not create another.
- A linked user DM or eligible private-channel mention creates a Slack question
  receipt, cited answer outbox row, and one Nango-backed Slack delivery.
- A bot-authored event is captured as ignored and does not loop.

Public-channel mentions remain subject to the existing Slack audience policy;
the webhook bridge dispatches them, but policy may deny the answer.
