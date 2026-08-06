# Maestro Brain Transcript Connector Staging Evidence

Date: 2026-08-06  
Product release commit: `415736eb3958`  
Staging Worker version: `c7b48017-df81-4a8c-b5ab-c32f90c66e52`

## Hosted evidence

| Area                 | Evidence                                                                                              | Status |
| -------------------- | ----------------------------------------------------------------------------------------------------- | ------ |
| Full repository gate | `maestro-remote-test -- pnpm verify` on exact head `415736eb3958`                                     | pass   |
| Convex backend       | Schema and functions deployed to the isolated staging deployment; no indexes deleted                  | pass   |
| Web application      | `maestro-brain-staging` Worker deployed with the reviewed client/server build                         | pass   |
| Authentication       | Bitwarden-backed WorkOS smoke account completed hosted sign-in                                        | pass   |
| Connections route    | Hosted Playwright loaded `/connections` without `Route unavailable`, page errors, or console errors   | pass   |
| Connector catalog    | Fireflies, Gong, Fathom, and Granola rows and provider-specific actions rendered                      | pass   |
| Secret handling      | Repository gitleaks and provider/logging boundaries passed; provider credentials remain outside Brain | pass   |

Hosted smoke timestamp: `2026-08-06T09:22:17Z`.

## Provider limitation

`NANGO_SECRET_KEY` is not present in the operator Bitwarden project or the
staging Convex environment. No real Fireflies or Gong OAuth connection, 30-day
backfill, imported call, route, mined proposal, accepted update, or cited
Ask/CLI result is claimed by this receipt.

## Release verdict

The deployed Brain and transcript Connections route are ready for authenticated
staging testing. Live provider ingestion remains `no-go` until the Nango server
secret is added and the provider-backed acceptance sequence is recorded.
