# Maestro Brain Transcript Connector Staging Evidence

Date: 2026-08-06  
Product release commit: `d26d938`

Staging Worker version: `2e409965-278f-4255-863b-df8a72797ad5`

## Hosted evidence

| Area                 | Evidence                                                                                              | Status |
| -------------------- | ----------------------------------------------------------------------------------------------------- | ------ |
| Full repository gate | Remote `pnpm verify` and Woodpecker pipeline 9 passed on exact head `493cc4cc5177`                    | pass   |
| Convex backend       | Schema and functions deployed to the isolated staging deployment; no indexes deleted                  | pass   |
| Web application      | `maestro-brain-staging` Worker deployed with the reviewed client/server build                         | pass   |
| Authentication       | Bitwarden-backed WorkOS smoke account completed hosted sign-in                                        | pass   |
| Connections route    | Hosted Playwright loaded `/connections` without `Route unavailable`, page errors, or console errors   | pass   |
| Connector catalog    | Fireflies, Gong, Fathom, and Granola rows and provider-specific actions rendered                      | pass   |
| Manual import        | Canonical JSON upload completed and Brain processing started without page or console errors           | pass   |
| Nango server secret  | Stored in Bitwarden and injected into isolated staging without printing or committing the value       | pass   |
| Nango Connect        | Authenticated Fireflies action minted a live session and opened `connect.nango.dev`                   | pass   |
| Secret handling      | Repository gitleaks and provider/logging boundaries passed; provider credentials remain outside Brain | pass   |

Hosted smoke timestamp: `2026-08-06T16:51:15Z`.

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

The deployed Brain and transcript Connections route are ready for provider
credential entry and authenticated staging testing. Live provider ingestion
remains `no-go` until one real provider account completes the acceptance
sequence above.
