# Maestro Brain Transcript Connector Staging Evidence

Date: 2026-08-07  
Staging candidate commit: `90abf1d`

Staging Worker version: `15ae8ffd-a9df-4b7e-b7d5-6dced2e4b90c`

Staging Convex deployment: `perfect-sparrow-808`

## Hosted evidence

| Area                    | Evidence                                                                                                                | Status |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------ |
| Focused candidate gates | 36 backend tests, 26 Brain UI tests, Convex/web typechecks, web build, formatting, and gitleaks passed on the candidate | pass   |
| Convex backend          | Schema and functions deployed to the isolated staging deployment; no indexes deleted                                    | pass   |
| Web application         | `maestro-brain-staging` Worker deployed with the reviewed client/server build                                           | pass   |
| Authentication          | Bitwarden-backed WorkOS smoke account completed hosted sign-in                                                          | pass   |
| Connections route       | Hosted Playwright loaded `/connections` without `Route unavailable`, page errors, or console errors                     | pass   |
| Connector catalog       | Fireflies, Gong, Fathom, and Granola rows and provider-specific actions rendered                                        | pass   |
| Manual import           | A VTT upload completed through routing, mining, review, publication, and cited retrieval                                | pass   |
| Nango server secret     | Stored in Bitwarden and injected into isolated staging without printing or committing the value                         | pass   |
| Nango Connect           | Authenticated Fireflies action minted a live session and opened `connect.nango.dev`                                     | pass   |
| Nango catalog           | Fireflies, Gong, Fathom, and Granola each minted a fresh hosted Connect session (HTTP 201)                              | pass   |
| Manual transcript V1    | Imported VTT marker `Lighthouse-1786145926518` produced two cited page proposals and was published                      | pass   |
| Client Brain search     | Published marker returned with a transcript citation in `Brain V1 Acceptance`                                           | pass   |
| Agency isolation        | The same marker returned no result after switching to the agency workspace                                              | pass   |
| Installed CLI           | A display-once Client Brain key completed source search/get and cited Ask, then was revoked                             | pass   |
| Secret handling         | Repository gitleaks and provider/logging boundaries passed; provider credentials remain outside Brain                   | pass   |

Latest hosted UI acceptance timestamp: `2026-08-07T22:19:05Z`.

Latest hosted CLI acceptance timestamp: `2026-08-07T23:45:15Z`.

Published maintenance proposal:
`brainmaint_7ba8f5c724555aa443cbe68845af3dda0663edc901741075e69c0dfdb0d6824a`
(`published`, two page items). The live OpenRouter path required two mining
attempts and one durable named retry sleep before producing accepted structured
output; model receipts retained hashes and usage metadata rather than raw call
or completion text.

## CLI evidence

The installed `/Users/headless/.local/bin/maestro-brain` binary authenticated
with a temporary key scoped to `Brain V1 Acceptance` and completed the cited V1
read path against `perfect-sparrow-808`:

- `brain.sources.search` returned the published marker and a citation key.
- `brain.sources.get` returned the matching published source revision.
- `brain.answers.ask` returned `answered` with matching cited evidence.
- The temporary key was revoked in the acceptance test's `finally` cleanup.

The HTTP layer dispatches API-key calls to internal service-principal queries;
the ordinary public queries still require WorkOS user identity.

## Nango project

| Brain key      | Nango provider | Authorization                  | Function                                     | Status |
| -------------- | -------------- | ------------------------------ | -------------------------------------------- | ------ |
| `fireflies`    | Fireflies      | API key                        | `transcripts` -> `Transcript`                | pass   |
| `gong-oauth`   | Gong           | Access key + access key secret | `call-transcripts` -> `CallTranscript`       | pass   |
| `fathom-oauth` | Fathom         | API key                        | Proxy adapter; no maintained transcript sync | pass   |
| `granola`      | Granola        | API token                      | Proxy adapter; no maintained transcript sync | pass   |

Nango-hosted OAuth developer apps were unavailable for Gong and Fathom in the
current project. The existing Brain keys therefore use the immediately usable
Gong basic-auth and Fathom API-key catalog providers. Switching those two keys
to OAuth later requires vendor-issued client credentials, not Brain code.

No provider account credential was entered during this setup. A real call,
30-day backfill, routing decision, mined proposal, accepted update, and cited
Ask/CLI result remain the provider-account acceptance sequence.

## Release verdict

The deployed Brain, transcript Connections route, manual transcript pipeline,
and installed CLI are ready for provider credential entry and authenticated
staging testing. Live provider ingestion remains `no-go` until one real provider
account completes the acceptance sequence above. Exact-head repository and CI
evidence is authoritative in the release PR because it is generated after this
receipt is committed.
