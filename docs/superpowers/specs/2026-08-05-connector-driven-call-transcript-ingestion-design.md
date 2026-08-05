# Connector-Driven Call Transcript Ingestion Design

## Decision

Make call transcripts the first reusable connector family after Slack. Nango
owns OAuth, API-key capture, credential refresh, and provider proxying. Thin
provider adapters fetch provider records and normalize them into one immutable
source-unit contract. Brain owns tenant validation, idempotency, client routing,
citation, mining, review, publication, lifecycle, and every delivery surface.

Slack keeps its verified raw-message ledger. Its thread assembler will
eventually emit the same source-unit revisions as call adapters. Call providers
already deliver assembled conversations, so they enter at the source-unit seam
instead of pretending to be Slack events.

Meeting recording is outside this release. Maestro Capture will later emit the
same canonical source-unit contract.

## Outcome

An agency connects Gong or Fireflies, Brain imports completed calls, matches
each call to the correct Client Brain whenever authority is unambiguous, mines
cited decisions and follow-up knowledge, and presents only material Brain page
changes for review. Accepted changes immediately become available through web
search, Ask, API, CLI, and MCP.

The same pipeline then supports Fathom, Granola, Zoom, Clari Copilot, Grain,
Avoma, tl;dv, generic transcript uploads, and Maestro Capture without modifying
routing, mining, review, publishing, or retrieval.

## Scope Guard

Included:

- Nango-managed connections for supported call-transcript providers.
- Canonical call, participant, transcript-revision, and transcript-segment
  contracts.
- Immutable source-unit persistence with exact timestamped citations.
- Incremental sync cursors, bounded backfill, retries, dead letters, and health.
- Automatic Client Brain matching with a routing inbox for ambiguity.
- Cited structured extraction and material Brain-maintenance proposals.
- Review-first publication and later per-Brain Autopilot eligibility.
- Fireflies and Gong as the first live providers.
- Fathom and Granola as the first custom Nango sync adapters.
- JSON, VTT, SRT, TXT, and Markdown import as the unsupported-provider escape
  hatch.

Excluded:

- Joining, recording, or transcribing meetings.
- CRM-derived routing in the first release.
- Email forwarding.
- Coaching, rep scoring, sentiment dashboards, and cross-client analytics.
- Automatic splitting of one mixed-client call across multiple Brains.
- Automatic Autopilot graduation.
- Building every provider before Gong and Fireflies prove product value.
- Fabro execution or Buildkite restoration.

## Architecture

```text
Nango connection
  -> provider sync, proxy, or webhook
  -> thin provider adapter
  -> canonical source-unit revision + segments
  -> deterministic client candidate generation
  -> exact auto-route OR bounded model proposal OR routing inbox
  -> routed context pack
  -> structured transcript mining
  -> cited no-op or grouped maintenance proposal
  -> human review or explicitly eligible Autopilot
  -> immutable Brain page revision
  -> web / Ask / API / CLI / MCP
```

The reusable boundary is an immutable source-unit revision, not a generic
provider class. Provider modules expose ordinary functions and are registered in
one small data map only after the second adapter requires selection by key.

## Canonical Contracts

### Call Transcript

```ts
type CanonicalCallTranscript = {
  providerKey: string;
  connectionKey: string;
  externalCallId: string;
  externalRevisionId: string;
  title: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  organizer: CanonicalParticipant | null;
  participants: readonly CanonicalParticipant[];
  segments: readonly CanonicalTranscriptSegment[];
  sourceUrl: string;
  recordingUrl: string | null;
  providerSummary: string | null;
  providerMetadataJson: string;
  deleted: boolean;
};

type CanonicalParticipant = {
  externalParticipantId: string;
  displayName: string;
  email: string | null;
  domain: string | null;
};

type CanonicalTranscriptSegment = {
  externalSegmentId: string;
  ordinal: number;
  evidenceKind: "verbatim_transcript" | "provider_notes";
  speakerExternalId: string | null;
  speakerLabel: string;
  startMs: number | null;
  endMs: number | null;
  text: string;
};
```

Provider adapters decode untrusted payloads, normalize ordering and timestamps,
remove empty segments, and reject malformed identities before returning this
contract. They do not choose a Brain, invoke a model, or write a page.

### Source Units

A completed call becomes one `sourceUnit`. Every provider change creates an
immutable `sourceUnitRevision`. Transcript text is stored in deterministic
`sourceSegments`, so long calls do not violate the existing 32,000-character
Slack revision limit.

Stable identities are derived from tenant, connection generation, provider,
external call ID, external revision ID, and content hashes. A repeated delivery
of identical provider data is a no-op. A changed transcript creates a new
revision. A provider deletion creates a tombstone and revokes current retrieval
and future model use.

Every segment preserves evidence kind, speaker, ordinal, optional start/end
milliseconds, text, and content hash. A citation references the exact
source-unit revision and segment plus its quoted span. Provider notes remain
visibly labeled derived evidence and never masquerade as verbatim transcript.
Autopilot and explicit owner/due-date extraction require verbatim evidence.

## Connection And Adapter Model

The existing `providerConnections` table remains the connection authority. Its
Slack identity fields stay optional and Slack-only. Generic connect operations
accept only server-registered provider configuration keys and reuse WorkOS
organization-admin authorization.

Nango owns:

- OAuth and API-key collection;
- credential storage and refresh;
- provider API proxying;
- managed sync execution when a template exists;
- connection status and provider request logs.

Brain owns:

- the allowlist of supported provider keys;
- Nango connection-to-organization binding;
- sync cursors and ingestion receipts;
- payload decoding and canonical normalization;
- source lifecycle and all downstream knowledge behavior.

Each adapter supplies:

```ts
type TranscriptAdapter = {
  normalizeCall(payload: unknown): CanonicalCallTranscript;
};
```

Sync orchestration remains shared. Managed Nango record syncs and custom proxy
pulls both feed the same ingestion capability. Provider-specific pagination and
rate-limit handling stay in the adapter-side fetcher, not in Brain maintenance.

## Automatic Client Matching

Candidate generation is tenant-scoped and deterministic:

1. An explicit provider account or call-to-Brain mapping.
2. A previously confirmed recurring-meeting mapping.
3. A previously confirmed participant-email mapping.
4. A unique external participant domain mapped to a Client Brain.
5. A participant already stored as a known stakeholder in one Brain.
6. A bounded model choice among only the remaining authorized candidates.

A unique exact match routes automatically. A model choice is review-first until
that mapping is confirmed. Confirmation writes durable recurrence, email, or
domain mappings when the reviewer selects them. Model confidence never grants
cross-Brain authority.

Calls with conflicting exact matches, multiple client domains, or no supported
candidate enter the routing inbox. Mixed-client calls are never copied wholesale
into multiple Brains. Calls whose participants are all on verified agency
domains may route to the Agency Brain.

## Mining And Maintenance

After routing, the workflow gathers the current transcript revision, exact
segment citations, current Client Brief pages, current page revisions, known
stakeholders, and active route/lifecycle/policy generations.

One schema-constrained model call returns:

- a concise call summary;
- decisions;
- commitments and next steps;
- explicit owners and stated due dates when supported by citations;
- risks and open questions;
- stakeholder changes;
- proof or assets mentioned;
- proposed page revisions;
- exact citation keys for every factual proposal; or
- a typed no-op when no material change is warranted.

The deterministic commit pipe verifies exact citation membership and quote
resolution, evidence-kind restrictions, current route and page generations,
tenant ownership, revision budget, and lifecycle state. It rejects invented
citations, stale pages, cross-Brain targets, uncited factual updates, and
malformed outputs.

One call creates one grouped review item. Source transcripts become searchable
after routing, but synthesized page changes remain review-first. Reviewers may
accept all, edit, reject, or change the target Brain. Page publication reuses
the existing immutable page-revision and citation path.

Autopilot remains per Brain and explicit. Eligibility requires a passing eval
receipt, reviewed samples for the exact model/prompt pair, and administrator
enablement. Citations remain mandatory in Autopilot.

## Product Surfaces

Connections becomes a provider catalog with Connect/Reauthorize, auth method,
health, last sync, calls discovered, calls routed, routing backlog, backfill
progress, last typed error, disconnect, and purge controls.

The routing inbox shows the call, participants, candidate Brains, matching
evidence, and Confirm/Change/No route actions. The maintenance queue shows a
single grouped item per call with summary, decisions, commitments, risks,
stakeholders, proposed page diffs, and timestamped citations.

The initial backfill is 30 days. Deeper backfill is an explicit operation and
must not delay live or recent-call ingestion.

## Provider Rollout

1. Fireflies and Gong: reuse Nango transcript syncs and prove the entire loop.
2. Fathom and Granola: reuse Nango auth/proxy and add thin custom syncs.
3. Zoom and Clari Copilot: adapt recording/call sync output and transcript
   artifacts.
4. Grain, Avoma, and tl;dv: add thin adapters over Nango-managed credentials.
5. Universal import: accept JSON, VTT, SRT, TXT, and Markdown.
6. Later: Maestro Capture emits the canonical contract directly.

Google Meet, Microsoft Teams, Otter, Webex, Dialpad, RingCentral, and Salesloft
Conversations remain demand-driven adapters. Their absence does not block the
first useful release.

## Error Handling And Security

- Credentials remain in Nango; Brain stores opaque connection identifiers.
- Every provider effect is organization-bound and connection-generation-fenced.
- Raw transcripts, webhook bodies, credentials, and model prompts never enter
  logs or receipts.
- Sync cursors advance only after canonical persistence succeeds.
- Retryable provider failures use bounded retries and `Retry-After` where
  available; permanent failures enter a visible dead-letter state.
- One provider failure never blocks another connection.
- Disconnect or credential replacement fences old work immediately.
- Provider edits append revisions; deletions revoke current retrieval and model
  use before later purge.
- Search, Ask, review, API, CLI, and MCP reauthorize against the current Brain.

## Testing

- Pure schema and deterministic-key tests for canonical calls and segments.
- One redacted golden payload fixture per provider adapter.
- Duplicate, edit, delete, out-of-order, cursor, retry, and dead-letter tests.
- Cross-organization and cross-Brain negative tests at every commit boundary.
- Routing tests for exact, learned, model-proposed, mixed-client, and no-match
  states.
- Mining tests for citations, no-op, stale revision, malformed output, and
  prompt-injection attempts.
- Feature tests for connection, empty, syncing, ready, ambiguous, review,
  mutation success, and mutation failure states.
- Hosted smoke tests for one real Fireflies account and one real Gong account.
- Woodpecker `ci/woodpecker/pr/verify` on every frozen delivery head.

Fabro remains paused. Qlty is advisory.

## Success Criteria

- Connection to first mined proposal takes less than 15 minutes.
- A completed provider call appears within five minutes of provider
  availability.
- A uniquely matched call routes without human intervention.
- Ambiguous calls never enter a Client Brain before review.
- Every factual mined output has an exact immutable source-segment citation,
  with provider notes visibly distinguished from verbatim transcript.
- Accepting a proposal updates web search, Ask, API, CLI, and MCP.
- Provider changes and deletions produce correct freshness and revocation.
- A second provider requires no changes to routing, mining, review, publishing,
  or retrieval.
- A straightforward API-backed provider adapter can be delivered in two
  engineering days or less.
- No tenant, Brain, key-scope, citation, or provider-credential incident occurs.
