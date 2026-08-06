# Brain Real Alpha Launch Design

## Outcome

Ship one secure, usable Agency Brain staging path: a real WorkOS user signs in,
is provisioned into a real Convex Brain, can use the existing Brain workspace,
and can call the existing read/Ask HTTP surface from a remote CLI.

## Scope guard

- Run the existing TanStack Start server entry on Cloudflare; do not deploy only
  `dist/client`.
- Add the AuthKit callback and sign-in routes required by the installed WorkOS
  adapter, and redirect signed-out live requests into that flow.
- Use the existing authorized Convex provisioning and Brain functions. No demo
  identity or browser-side authorization bypass is permitted.
- Turn the existing private CLI into a remote client for the four already
  reviewed operations: `brain.context.get`, `brain.answers.ask`,
  `brain.sources.search`, and `brain.sources.get`.
- Deploy current Convex functions before the web app so generated references and
  hosted functions agree.

Slack ingestion, billing, dashboards, vector search, write-capable CLI commands,
and the historical 56-task release program are outside this alpha.

## Architecture

Cloudflare's Vite plugin builds and deploys `@tanstack/react-start/server-entry`
with static assets. The WorkOS middleware owns the encrypted session cookie and
callback. Its access token authenticates Convex; the existing provisioning
mutation derives the user, organization, workspace, and stable Brain key.

The CLI uses native `fetch` against the existing Convex HTTP API. It accepts a
base URL and display-once Brain API key from environment or flags, sends a
Bearer header, and preserves the server's typed error envelope. It adds no SDK
or transport abstraction.

## Error handling and security

- Live mode fails closed when WorkOS configuration is absent.
- Signed-out browser requests redirect to `/sign-in`; no Brain queries run under
  a synthetic owner.
- CLI commands require HTTPS except for localhost, never print tokens, and exit
  nonzero for HTTP, network, decode, or typed operation errors.
- WorkOS, Convex, and Cloudflare secrets remain in provider secret stores and
  are never committed.

## Test plan

- Deployment contract test pins the Cloudflare plugin, Worker entry, assets, and
  node compatibility configuration.
- Auth route tests cover callback/sign-in registration and signed-out redirect.
- CLI tests use a local fake fetch boundary to prove URL, bearer header, request
  body, response decoding, and failure exit behavior.
- Hosted browser smoke proves `/brain` no longer renders `ROUTE UNAVAILABLE`,
  then proves the authenticated note-review-edit-search-citation path.
- Hosted CLI smoke proves one real `brain.context.get` or `brain.answers.ask`
  call against the same Brain.
