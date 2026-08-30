# Apero Company Brain Live Activation

**Environment:** staging

**Observed through:** 2026-08-29

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

## Historical pre-Slack provider state

The live `apero` health receipt is intentionally empty except for its manual
page:

| Provider     | Active sources | Current entries | Coverage state                      |
| ------------ | -------------: | --------------: | ----------------------------------- |
| Brain page   |              3 |               3 | current index covers active sources |
| Slack        |              0 |               0 | no active sources                   |
| Google Drive |              0 |               0 | no active sources                   |
| HubSpot      |              0 |               0 | no active sources                   |
| Transcript   |              0 |               0 | no active sources                   |

No real Apero Slack channel, Drive root, HubSpot portal, or transcript corpus
has been authorized or selected. That means connector code is deployed but the
provider slice of the read pilot is not activated.

## CLI 0.1.4 and provider-scope deployment receipt

- Merge commit: `31bf7f9bf636d7d69c59f4145c5f6519e1821226`
- Release: `brain-cli-v0.1.4`
- Versioned asset:
  `https://github.com/modernagencysales/maestro-brain/releases/download/brain-cli-v0.1.4/maestro-brain.tgz`
- Artifact SHA-256:
  `147213f621865733a7069dcbb74e561c4dce7f587148dc2c9f2125a8c3aaf9e7`
- GitHub deployment: `6109470283`
- Convex deployment: `perfect-sparrow-808`
- Cloudflare Worker version: `b656045b-3eae-48e7-8547-e80fde47ed64`

The public version-pinned asset passed a fresh-cache installation. `version`
returned `0.1.4`; `setup --help` performed no OAuth action; non-interactive
setup transactionally created Codex, Claude Code, Claude Cowork, and Ask Apero
project descriptors; and live `status`, `doctor`, page listing, evidence health,
MCP initialization, and nine-tool discovery passed. Codex discovered the HTTP
MCP as enabled. Claude discovered it and correctly reported the one-time project
approval as pending.

The exact merged backend exposes
`integrations/connections.js:discoverProviderScopes`. The exact merged Worker
version is tagged `31bf7f9b`, its deployment message contains the full merge
SHA, and Cloudflare reports that version at 100 percent traffic. Public login
and signup rendered in a headless browser without console or page errors;
protected routes returned to the canonical login screen when unauthenticated.

A live write/index smoke created `Release 31bf7f9b Live Smoke` through CLI
`0.1.4`, reopened the exact Markdown page, found its unique marker through the
canonical evidence search, and reported matching source, observation, and index
times in evidence health. Its stable source receipt is:

- source key: `brain-page:kd7br48njqe1p7y3p7jdwby8g98d6j0g`
- revision key: `1787769446751`
- content hash:
  `08edbd4d36df0451dee9bf04449760c11f4a2667a44897617e79abb63ffd8cd6`

The guarded Woodpecker deployment canceled before publishing, as the preceding
deployment did. The authenticated Convex and Cloudflare fallback deployed the
exact merge and the GitHub deployment was closed successfully only after the
catalog, Worker-version, UI, MCP, and write/index smokes above passed. This is a
valid live release receipt, but the canceled guarded path remains deployment
automation debt rather than being represented as green CI.

## Remaining Apero-owner actions

1. Invite the real one-to-two-person pilot cohort from `Settings -> Members`.
2. Confirm the connected Slack channel is the approved narrow pilot scope and
   name its connector owner.
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

## 2026-08-29 Slack activation and local V4 readiness receipt

Read-only checks against the linked `apero` workspace now show a successful
Nango-backed Slack activation:

- 101 active Slack sources and 101 current retrieval entries;
- completed run `slack:1:1787983361369` and successful reconciliation at
  `1787983364458`;
- provider coverage `current-index-covers-active-sources` and capacity
  `within-bounds`;
- a lexical Slack result reopened exactly as source
  `slack:C0BLX1GL89L:message:1787687788.929559`, revision `1787687788.929559`,
  content hash
  `2c14e996768503687fc0e5b1c09cfa4e0b5050ac0fc425763980568c54ddcc68`;
- the reopened body length was 128 characters and the revision was not a
  tombstone. The body is deliberately omitted from Git.

Google Drive, HubSpot, and transcript coverage remain empty. The staging MCP
still advertises the legacy nine tools and does not expose `template.brain.ask`
or the extraction/review tools in local commit `25bea20a`; a new deployment is
therefore required before V4 cross-runtime parity can be measured.

Local commit `25bea20a` passed 710/710 Convex tests, 9/9 required runtime
acceptance scenarios, typecheck, production build, generated-file/manifest and
headless-contract checks, and lint with zero errors. It has not been pushed or
deployed from this workspace.

## CLI 0.1.8 progressive-evaluation deployment receipt

- Evaluation feature commit: `671e17a079cd05b966e0ecbed9d8ed13bd1716bc`
- Merge commit: `b8546396ad345387e4474341202fb3fdf7627696`
- Pull request: `#82`
- Required Woodpecker PR pipeline: `297` (success)
- GitHub staging deployment: `6161460093`
- Guarded Woodpecker deployment pipeline: `299` (success)
- Release: `brain-cli-v0.1.8`
- Artifact SHA-256:
  `5e27a9e3b14af853979bc83aa01700dc6d0c6c8a1a1bd8daffd9c80884c1e2ad`

The release asset passed its recorded checksum and installed globally as CLI
`0.1.8`. The staging app, login route, and generated OpenAPI route returned
HTTP 200. CLI doctor passed against the linked `apero` workspace. Evidence
health reported one active/current Brain page and 101 active/current Slack
sources; Google Drive, HubSpot, and transcript remained empty. HTTP MCP
initialization negotiated protocol `2025-03-26`, advertised 16 tools, included
read-only `template.brain.evaluations.list` and `.get`, and retained the
`ask-company-brain` prompt.

The real evaluation ledger contains one pending development example, zero
adjudicated examples, and zero holdout examples. CLI status therefore reports
`insufficient-sample`. Stable list/show, redacted export, and a query-only
freeze preview passed live. The export contained one question hash and no
question or excerpt; no adjudication or freeze apply was performed. This is a
progressive evaluation data-flow receipt, not evidence that the real Apero
question set, frozen holdout, or replacement pilot is complete.

The live acceptance sweep also found two headless contract defects: generated
evaluation OpenAPI exposed credential-derived `workspaceId` and omitted required
caller-envelope fields, while a missing example surfaced a declared
`ValidationFailed` as HTTP 500. A focused follow-up fixes both with contract
tests; that fix requires its own merge and guarded staging deployment before it
becomes live evidence.

## Evaluation HTTP correction and ContextPack V4 activation

- Correction commit: `2b28cca37a8eddb70794ddf3c65bb0548a1ef860`
- Merge commit: `ac018b9337f0597214f4c68f7a3069507e46ec72`
- Pull request: `#83`
- Required Woodpecker PR pipeline: `300` (success)
- GitHub staging deployment: `6161749325`
- Guarded Woodpecker deployment pipeline: `301` (success)

The generated evaluation OpenAPI no longer asks callers for credential-derived
workspace IDs, requires the correct operation envelopes, and maps the declared
missing-example validation failure to HTTP 400. Live API and MCP negative tests
also reject missing bearer credentials and caller-supplied workspace selectors.

The live Apero workspace rollout for `template.brain.contextV4` was then enabled
at 100 percent. A credential-bound `brain.ask` call requested `mixed`, returned
effective mode `mixed`, schema version `4`, and no fallback reason. Its
citations included the current Brain Page and Slack evidence lanes. The
workspace still has zero reviewed claims, zero Drive sources, and zero
structured-provider sources, so this is an active-contract receipt rather than a
quality or pilot completion claim.

## CLI 0.1.9 onboarding and scheduled-Slack deployment receipt

- Merge commit: `1ab2c6f589db81eadba6c98d3fe813e43911df34`
- Pull request: `#84`
- Required Woodpecker PR pipeline: `302` (success)
- GitHub staging deployment: `6162343742`
- Guarded Woodpecker deployment pipeline: `304` (success)
- Release: `brain-cli-v0.1.9`
- Artifact SHA-256:
  `d4ef6947afddb81e6f9db0580dc031d6ab7c4f2284fb810c917181c701922eb1`

The public release asset installed as CLI `0.1.9` and returned the conventional
version output. A clean project setup generated exact Codex, Claude Code,
Cowork, HTTP MCP, and Ask Apero descriptors. Authenticated doctor passed the
API, MCP protocol, MCP catalog, workspace evidence, and exact descriptor checks.
Staging app, login, and Inbox returned HTTP 200. OpenAPI 3.1 exposes 20 paths.

HTTP MCP now advertises 15 tools. Canonical `template.brain.ask` is present and
the competing `template.agents.assistant.answerQuestion` tool is absent. A live
question requested and received mixed ContextPack V4 with schema `4` and an
exact Slack citation; a source-inventory meta-question correctly returned
insufficient context instead of treating operational metadata as company
evidence.

The existing active Slack row has one approved channel and connection generation
`1`. A bounded generation-fenced scheduled sync completed with one page and 99
current messages. The connection remained active/ready with
`scheduledSyncEnabled=true`; evidence health reports 99 active sources, 99
current entries, current-index coverage, within-bounds capacity, and a complete
latest run. The earlier 101 count is retained above as historical evidence; the
fresh complete traversal is the current authority. Google Drive, HubSpot, and
transcript remain empty.

The real evaluation ledger still contains one development example, zero
adjudicated examples, and zero holdout examples. Its maturity is therefore
`insufficient-sample`. This release closes the engineering-owned onboarding,
MCP-catalog, scheduled-Slack fencing, and Drive result-contract gaps; it does
not close Drive OAuth/source selection, Claude/Cowork login, evaluation, or the
elapsed replacement pilot.
