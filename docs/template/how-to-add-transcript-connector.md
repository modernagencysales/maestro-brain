# How To Add A Transcript Connector

Use this path after a customer asks for a provider. Do not add a generic plugin
system: one registry row, one redacted fixture, one normalizer, and an optional
fetcher are enough.

## Before Coding

Verify all of the following against the provider and the current Nango catalog:

1. Nango has the required OAuth or API-key authorization, or can host a custom
   integration configuration.
2. The provider account tier exposes completed calls and transcript text.
3. The API documents stable call IDs, updates/deletes, pagination, and rate
   limits.
4. The customer can authorize a real staging account.

Nango owns provider tokens. Brain receives only the server-selected provider
configuration key and Nango connection ID. `NANGO_SECRET_KEY` is the only
Brain-side Nango secret; never add provider access tokens to Brain env, rows,
logs, or fixtures.

## Two-Day Path

### 1. Capture one redacted payload

Add official-shape JSON under `packages/integrations/src/transcripts/fixtures/`.
Replace names, emails, transcript text, URLs, recording IDs, and tokens while
preserving field types and nesting.

### 2. Normalize it

Add `packages/integrations/src/transcripts/<provider>.ts` and its focused test.
Return `CanonicalCallTranscript`; keep provider parsing, pagination, endpoint
paths, and rate-limit decoding in this package. Revision hashes must not depend
on the Nango connection ID.

Use `provider_notes` for generated summaries or notes. Use `verbatim_transcript`
only for exact provider transcript text. Malformed input must throw a
provider-specific error without including payload content.

### 3. Pass shared conformance

Add the valid and invalid fixtures to
`packages/integrations/src/transcripts/conformance.test.ts` through
`transcriptAdapterConformance`. It checks canonical decode, deterministic output
across reconnects, stable segment order, non-empty evidence, credential-free
output, and redacted failures.

Run:

```bash
pnpm --dir packages/integrations exec vitest run \
  src/transcripts/<provider>.test.ts \
  src/transcripts/conformance.test.ts
```

### 4. Register authorization

Add one data row to `packages/integrations/src/transcripts/providers.ts`. The
browser sends the product provider key; the server chooses `providerConfigKey`
and auth mode. Update `packages/integrations/src/nango/records.test.ts` in the
same change.

### 5. Add only the fetch path the provider needs

- If Nango exposes a maintained sync model, page it with
  `NangoClient.listRecords`.
- If Nango supplies auth but no maintained sync, call the provider's documented
  list/detail endpoints through the Nango proxy.
- If neither exists, stop and use the manual JSON/VTT/SRT/TXT/Markdown import
  until there is customer demand for a custom auth configuration.

Extend `packages/convex/convex/integrations/transcriptSyncWorker.ts`; do not
change routing, mining, review, publication, retrieval, CLI, or MCP code.
Process at most one provider page per claim. Advance the primary cursor only
after every normalized call is durably ingested.

### 6. Prove lifecycle behavior

The focused worker test must cover create, duplicate, update, delete, cursor
commit after success, cursor retention after partial failure, `Retry-After`,
permanent decode failure, and redacted health errors. Provider deletions emit a
segment-free tombstone; they never erase immutable audit revisions.

### 7. Expose and smoke it

Add the provider to the Connections catalog, then run one real staging smoke:
authorize, bounded backfill, ingest a call, route or review it, accept a cited
Brain update, query it through the installed CLI, disconnect, and prove current
retrieval is revoked. Record only provider name, redacted connection key,
counts, timestamps, deployment, and commit SHA.

## Candidate Matrix

This matrix is a discovery queue, not a support claim. Nango catalog entries and
managed syncs change; verify them on the implementation date and record the
exact integration/model names in the PR.

| Provider      | Nango auth                     | Nango maintained transcript sync        | Provider path to evaluate                                   | Brain status                                       |
| ------------- | ------------------------------ | --------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------- |
| Fireflies     | Configured API key             | Configured models                       | Transcript list plus sentence detail                        | Implemented; live proof still requires credentials |
| Gong          | Configured access key + secret | Configured `CallTranscript` sync        | Call transcript plus call metadata                          | Implemented; live proof still requires credentials |
| Fathom        | Configured API key             | None found in current generated catalog | Meeting list plus recording transcript detail through proxy | Implemented; live proof still requires credentials |
| Granola       | Configured API key             | None found in current generated catalog | Note list plus note detail with transcript through proxy    | Implemented                                        |
| Zoom          | Verify current catalog/config  | Not verified; do not assume             | Cloud recording/transcript API and completion events        | Candidate                                          |
| Clari Copilot | Verify current catalog/config  | Not verified; do not assume             | Call export/transcript API                                  | Candidate                                          |
| Grain         | Verify current catalog/config  | Not verified; do not assume             | Recording/transcript API                                    | Candidate                                          |
| Avoma         | Verify current catalog/config  | Not verified; do not assume             | Meeting/transcript API                                      | Candidate                                          |
| tl;dv         | Verify current catalog/config  | Not verified; do not assume             | Recording/transcript API                                    | Candidate                                          |

For an unsupported provider, the shipped manual import is the immediate escape
hatch. Maestro Capture can implement the same canonical adapter later without
changing downstream Brain behavior.
