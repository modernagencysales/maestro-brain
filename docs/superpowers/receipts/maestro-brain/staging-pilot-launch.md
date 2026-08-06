# Maestro Brain Transcript Connector Staging Evidence

Date: 2026-08-06  
Product release commit: `493cc4cc5177`

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
| Secret handling      | Repository gitleaks and provider/logging boundaries passed; provider credentials remain outside Brain | pass   |

Hosted smoke timestamp: `2026-08-06T11:05:45Z`.

## Provider limitation

`NANGO_SECRET_KEY` is not present in the operator Bitwarden project or the
staging Convex environment. No real provider OAuth connection, 30-day backfill,
imported call, route, mined proposal, accepted update, or cited Ask/CLI result
is claimed by this receipt.

## Release verdict

The deployed Brain and transcript Connections route are ready for authenticated
staging testing. Live provider ingestion remains `no-go` until the Nango server
secret is added and the provider-backed acceptance sequence is recorded.
