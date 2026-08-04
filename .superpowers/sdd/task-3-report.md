# Task 3 report — minimum remote Brain CLI

## Delivered

`maestro-template api call <operation-id> --input <json>` now sends read-only
Brain calls to the deployed Convex HTTP API using `CONVEX_SITE_URL` and
`MAESTRO_BRAIN_API_KEY`.

The command accepts only these operation IDs:

- `brain.context.get`
- `brain.answers.ask`
- `brain.sources.search`
- `brain.sources.get`

Existing synchronous `runCli` commands remain synchronous; the executable uses
the new async entrypoint only for `api call`.

## Security behavior

- Allows HTTPS origin-only `CONVEX_SITE_URL` values, plus `http://localhost`.
- Rejects URL credentials, query strings, fragments, and non-root paths.
- Sends only `POST /api/<operation-id>` with a Bearer header, JSON body,
  `redirect: "error"`, and a fixed 10-second native `AbortSignal` timeout.
- Rejects caller-provided tenant, workspace, and Brain selectors recursively.
- Rejects all write/unreviewed operation IDs locally.
- Treats a JSON `{ "ok": false }` envelope as failure even when HTTP is 200.
- Redacts the configured bearer key from rendered remote failure output and
  returns a generic message for network/parse errors.

## Tests and verification

TDD RED was observed for the missing `runCliAsync` export. Focused tests cover
request URL/header/body, typed HTTP-200 failures, network failures, secret
redaction, unsafe URLs, localhost, selector rejection, and write rejection.

Commands run successfully:

```sh
rtk proxy env HOST_TEST_MAX_LOAD_1M=25 host-test-slot --class focused pnpm --dir apps/cli test
rtk proxy env HOST_TEST_MAX_LOAD_1M=25 host-test-slot --class focused pnpm --dir apps/cli typecheck
```

The required host-test semaphore was used for every CLI test/typecheck run.

## Environment documentation

Added a blank `MAESTRO_BRAIN_API_KEY` placeholder to `.env.example` and a
server-secret manifest entry. No secret value or hosted demo identity was added.

## Scope and review

No dependencies, transport framework, write command, web file, or lockfile was
changed. Self-review found the implementation uses only native platform APIs and
has no new abstraction or dependency to remove.
