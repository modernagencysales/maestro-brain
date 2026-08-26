# Apero Company Brain Live Activation

**Environment:** staging

**Observed:** 2026-08-26

**Purpose:** exact live-state receipt, not a provider or dogfood completion
claim

## Live shared workspace

- Workspace: `Apero Company Brain`
- Slug: `apero`
- App: `https://maestro-brain-staging.tim-bb0.workers.dev/apero/inbox`
- Context API: `https://perfect-sparrow-808.convex.site/mcp`
- `tim@keen.digital` is an active owner.
- `timkeen+tester@gmail.com` accepted an app-native invitation and is an active
  viewer.
- The test viewer's independent read credential reopened shared evidence and was
  then revoked. Tim's individual linked credential remains active and is stored
  only in the local Maestro Brain config with directory mode `0700` and file
  mode `0600`.

## Live context receipt

The workspace contains a reviewed operational `Start Here` page. It deliberately
contains no fabricated Apero business facts. Its exact source receipt is:

- source key: `brain-page:kd7byfxj74q043nqw1nzne03ex8d6rem`
- revision key: `1787748244492`
- content hash:
  `a1e94342936dae836fea7351c0426d062225969eb45debb911d74f4d24256707`

The public CLI release `0.1.1` passed `status`, `doctor`, MCP tool discovery,
evidence health, evidence search, exact source reopening, and page listing
against the `apero` workspace. Doctor passed the API, MCP protocol, MCP catalog,
and workspace-evidence checks. MCP advertised nine Company Brain tools.

## CLI 0.1.2 live import receipt

- Merge commit: `526ae608dc148b1080a822080474a93dea0bc18b`
- Release: `brain-cli-v0.1.2`
- Stable asset: `maestro-brain.tgz`
- Artifact SHA-256:
  `5ebb3f3e33dbea49264a33471cd305de2d42efb69feb6c5089049d82ee75ace2`
- Staging deployment: GitHub deployment `6105262876`
- Cloudflare Worker version: `01facc47-4aec-4558-b60b-3c17c8a18846`
- Convex deployment: `perfect-sparrow-808`

The publicly installed `0.1.2` CLI imported one deliberately non-sensitive
operational page with marker `APERO-BRAIN-CLI-012-REPEATABLE-IMPORT`. The first
run reported one create; an immediate replay reported one unchanged item and no
duplicate; an edited title and body reported one update. The page retained its
stable source key:

- source key: `brain-page:kd759f2pezaej2tewwzp6c5ggd8d7ts5`
- initial revision: `1787753092637`
- initial content hash:
  `be59c1c8bf86ff7a7d626d981494e8079ca5daf500fef0aeb0a887dd452c39a1`
- updated revision: `1787753117123`
- updated content hash:
  `a7d4ad4526e5ed230bf2fa074a10168b57eb281838db6febccaf61936f574de0`

Exact source reopening returned both the initial and updated bodies. Evidence
search returned only the updated revision as current. The synchronized page
title was `Brain CLI 0.1.2 Live Import Proof — Updated`. `doctor`, evidence
health, MCP initialization, and MCP tool discovery also passed after deployment.
The temporary Convex deploy key used for the fallback was revoked immediately
after deployment.

## CLI 0.1.3 and completion deployment receipt

- Merge commit: `d36010c255c7839cd4e2d5bc9f2956c23ecb30c6`
- Release: `brain-cli-v0.1.3`
- Stable asset:
  `https://github.com/modernagencysales/maestro-brain/releases/latest/download/maestro-brain.tgz`
- Artifact SHA-256:
  `8d872ace1ea352bda5251774df125e8f37f8867618ef8e8eaeebbba2fbbaa74e`
- Convex deployment: `perfect-sparrow-808`
- Cloudflare Worker version: `58e1b43f-b8f3-456d-b529-d7eda21e5547`
- GitHub deployment: `6107125261`

The exact merged backend was deployed with the already-green repository and CI
typecheck gates. The live function catalog contains `dispatchScheduledSyncs`,
`syncSlackScheduled`, `syncGoogleDriveScheduled`, and `syncHubSpotScheduled`.
The pushed cron module registers
`reconcile approved Company Brain provider scopes` on a one-hour interval. A
live dispatcher invocation returned zero scheduled and zero skipped connections;
no Slack, Drive, or HubSpot source was ingested. The temporary deployment-scoped
key was revoked immediately.

The exact merged frontend passed the production build and static Worker smoke
gate before deployment. After deployment, the Connections (`/apero`), Brain
(`/apero/inbox`), Clients, login, and signup shells returned HTTP 200. The
canonical Brain page-tree/editor/provenance and Connections adapter tests passed
12/12. The authenticated live HTTP MCP passed initialize and tool discovery; CLI
doctor passed config, API, MCP protocol, MCP catalog, and workspace evidence
checks; evidence health reported two current Brain pages and zero active real
provider sources; and the recorded `Start Here` revision reopened with its exact
content hash.

The public stable-download URL installed CLI `0.1.3`. `maestro-brain version`
returned `0.1.3`, and `maestro-brain run` passed the linked credential to a
harmless child-process presence check without printing the key.

A separate controlled staging workspace proved create, immediate publication,
exact citation reopening, optimistic update, current-entry replacement, old
revision audit reopening, stale-write rejection, invalid-key rejection, and
agency/client workspace isolation. The temporary credentials were rotated or
revoked. Synthetic content is not Apero activation evidence.

## Provider state

The live `apero` health receipt is intentionally empty except for its manual
page:

| Provider     | Active sources | Current entries | Coverage state                      |
| ------------ | -------------: | --------------: | ----------------------------------- |
| Brain page   |              2 |               2 | current index covers active sources |
| Slack        |              0 |               0 | no active sources                   |
| Google Drive |              0 |               0 | no active sources                   |
| HubSpot      |              0 |               0 | no active sources                   |
| Transcript   |              0 |               0 | no active sources                   |

No real Apero Slack channel, Drive root, HubSpot portal, or transcript corpus
has been authorized or selected. That means connector code is deployed but the
provider slice of the read pilot is not activated.

## Remaining Apero-owner actions

1. Invite the real one-to-two-person pilot cohort from `Settings -> Members`.
2. Connect the approved Slack workspace and select the initial channel cohort.
3. Select the approved Shared Drive and root folders, then run the first full
   sync.
4. Confirm HubSpot is the intended structured source and select the minimum
   company/contact/deal fields, or explicitly defer CRM for E0/E1.
5. Inventory the existing Claude Ask Apero Project and record 10-20 recurring
   questions with required authoritative evidence.
6. Name the context owner and connector owner and choose freshness targets.
7. Record real provider create, edit, move/unshare, delete, resync, citation,
   and two-runtime parity receipts before declaring the read pilot complete.

Monday, DocuSign, Gmail, Notion, semantic retrieval, and provider writes remain
post-pilot additions unless the real evaluation set proves one is required.
