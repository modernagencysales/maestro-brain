# Connector-Driven Call Transcript Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect real call-transcript providers, automatically route completed
calls to the correct Client Brain, and turn cited transcript evidence into
reviewable Brain updates through one reusable source-unit pipeline.

**Architecture:** Keep Slack's provider-specific raw-message ledger and add an
immutable provider-neutral source-unit seam downstream. Nango owns credentials,
managed syncs, and proxy calls; thin adapters normalize Gong, Fireflies, Fathom,
Granola, and imported transcript formats. Shared Confect capabilities own tenant
validation, persistence, routing, mining, review, and publication.

**Tech Stack:** TypeScript, Effect 3.21, Confect 9.1, Convex 1.42, Nango Node
0.71, TanStack Start, React 19, SaaS UI/Chakra, Vitest, Playwright, Cloudflare
Workers.

## Global Constraints

- Preserve WorkOS-derived identity and server-owned tenant injection.
- Nango retains provider credentials; never persist or log credentials in Brain.
- Decode every provider payload as untrusted input before persistence.
- Every factual model output requires an exact immutable segment citation.
- Transcript routing may select only Brains authorized inside the current
  organization.
- Exact deterministic matches may auto-route; model-only matches remain
  review-first in this plan.
- Synthesized Brain page changes remain review-first until the existing
  Autopilot eligibility contract passes.
- Keep Slack raw capture behavior intact; do not force call payloads through
  `VerifiedSlackChannelBinding`.
- Do not add a provider SDK outside `packages/integrations`.
- Add no parsing dependency for VTT, SRT, TXT, or Markdown.
- Do not hand-edit Confect or Convex generated files.
- Use expand/backfill/verify/contract schema changes and update
  `docs/product/maestro-brain-migrations.md` in the schema task.
- Fabro remains paused. Do not invoke Buildkite. Woodpecker
  `ci/woodpecker/pr/verify` is the sole required GitHub status; Qlty is
  advisory.
- Focused checks run through `host-test-slot --class focused`. Broad checks run
  on committed heads through `maestro-remote-test`.

## Scope And Work-Package Classification

| Area                      | Classification     | Existing anchor                                     | Real boundary                                                  |
| ------------------------- | ------------------ | --------------------------------------------------- | -------------------------------------------------------------- |
| Source units and segments | `template-gap`     | Slack-shaped `sources/sourceSchemas.ts`             | provider-neutral immutable source-unit tables                  |
| Generic Nango connection  | `pattern-instance` | `integrations/slackConnections.*`                   | server-allowlisted transcript provider connection              |
| Nango record access       | `fixture-to-real`  | `packages/integrations/src/nango/client.ts`         | `Nango.listRecords` and provider proxy                         |
| Maintenance workflow      | `fixture-to-real`  | hard-coded `sourceToBrainMaintenance.graph.ts` args | gathered transcript evidence plus structured LLM output        |
| Routing                   | `template-gap`     | classification authority and review primitives      | deterministic match rules plus bounded reviewed model proposal |
| Review UI                 | `pattern-instance` | Brain and classification review queues              | call routing and grouped maintenance adapters                  |
| Fireflies/Gong            | `pattern-instance` | Nango managed models                                | redacted adapters and live sync workers                        |
| Fathom/Granola/import     | `pattern-instance` | shared adapter contract                             | Nango proxy pulls and native text parsers                      |

## Delivery Batches

### Batch 1 — Canonical source-unit core

- **Tasks:** 1–3
- **Branch/head:** `codex/brain-transcript-core`
- **Base:** design commit `3e0fe2b` on `codex/brain-pilot-slice`
- **PR target:** `codex/brain-pilot-slice`
- **Independent value:** accepted canonical transcript revisions can be
  persisted, cited, deduplicated, edited, deleted, and read without a live
  provider.
- **Focused checks:** source-unit schema, ingest capability, citation, schema
  migration, Confect contract, and secret-canary checks named in Tasks 1–3.
- **Batch review:** `rtk pnpm contract-review`
- **Required verification:** commit the batch, then run
  `rtk maestro-remote-test -- pnpm verify`; require current-head Woodpecker.

### Batch 2 — Useful routed and mined product

- **Tasks:** 4–8
- **Branch/head:** `codex/brain-transcript-product`
- **Base:** frozen Batch 1 head, recorded before this branch is created
- **PR target:** `codex/brain-transcript-core`
- **Independent value:** imported canonical calls auto-match when exact, enter a
  safe routing inbox when ambiguous, produce real cited maintenance proposals,
  and publish approved updates to existing retrieval surfaces.
- **Focused checks:** routing, maintenance, workflow, Brain review, retrieval,
  web feature, and accessibility checks named in Tasks 4–8.
- **Batch review:** `rtk pnpm contract-review`
- **Required verification:** commit the batch, then run
  `rtk maestro-remote-test -- pnpm verify`; require current-head Woodpecker.

### Batch 3 — Fireflies and Gong live providers

- **Tasks:** 9–11
- **Branch/head:** `codex/brain-transcript-live`
- **Base:** frozen Batch 2 head, recorded before this branch is created
- **PR target:** `codex/brain-transcript-product`
- **Independent value:** real Fireflies and Gong calls enter the complete
  product loop with connection health, bounded backfill, and live staging proof.
- **Focused checks:** Nango client, provider adapters, sync worker, provider
  connection, Connections UI, and hosted smoke checks named in Tasks 9–11.
- **Batch review:** `rtk pnpm contract-review`
- **Required verification:** commit the batch, then run
  `rtk maestro-remote-test -- pnpm verify`; require current-head Woodpecker.

### Batch 4 — Connector expansion kit

- **Tasks:** 12–14
- **Branch/head:** `codex/brain-transcript-expansion`
- **Base:** frozen Batch 3 head, recorded before this branch is created
- **PR target:** `codex/brain-transcript-live`
- **Independent value:** Fathom, Granola, and unsupported transcript files feed
  the same loop without changes to routing, mining, review, publication, or
  retrieval.
- **Focused checks:** Fathom, Granola, parser, source-intake, connector
  conformance, schema migration, and secret-canary checks named in Tasks 12–14.
- **Batch review:** `rtk pnpm contract-review`
- **Required verification:** commit the batch, then run
  `rtk maestro-remote-test -- pnpm verify`; require current-head Woodpecker.

---

### Task 1: Add immutable provider-neutral source units and segments

**Classification:** `template-gap`. The documented `template:add-source-type`
command is not present in root scripts or the current generator. Implement the
smallest product contract directly, document the migration, and add generator
promotion as a template finding only after call and Slack source units both use
the seam.

**Files:**

- Create: `packages/convex/confect/sources/sourceUnit.ts`
- Create: `packages/integrations/src/transcripts/canonical.ts`
- Modify: `packages/integrations/src/index.ts`
- Modify: `packages/integrations/package.json`
- Create: `packages/convex/confect/tables/sourceUnits.ts`
- Create: `packages/convex/confect/tables/sourceUnitRevisions.ts`
- Create: `packages/convex/confect/tables/sourceSegments.ts`
- Modify: `packages/convex/confect/tables/citations.ts`
- Modify: `docs/product/maestro-brain-migrations.md`
- Test: `packages/convex/test/source-unit-schema.test.ts`

**Interfaces:**

- Produces `CanonicalCallTranscript`, `SourceUnitRow`, `SourceUnitRevisionRow`,
  `SourceSegmentRow`, and `buildCallSourceUnitRows(input, authority)`.
- Existing Slack `SourceArtifactRow` and `SourceRevisionRow` remain unchanged.
- Citation rows gain optional `sourceUnitRevisionKey`, `segmentKey`, `startMs`,
  and `endMs`, while existing note citations remain decodable.

- [ ] **Step 1: Write failing source-unit schema tests**

```ts
const call = {
  providerKey: "fireflies",
  connectionKey: "conn_fireflies_1",
  externalCallId: "call_1",
  externalRevisionId: "revision_1",
  title: "Acme weekly",
  startedAt: "2026-08-05T14:00:00.000Z",
  endedAt: "2026-08-05T14:30:00.000Z",
  durationMs: 1_800_000,
  organizer: null,
  participants: [],
  segments: [
    {
      externalSegmentId: "call_1:0",
      ordinal: 0,
      evidenceKind: "verbatim_transcript",
      speakerExternalId: "speaker_1",
      speakerLabel: "Alex",
      startMs: 0,
      endMs: 2_000,
      text: "We will launch on Friday.",
    },
  ],
  sourceUrl: "https://app.fireflies.ai/view/call_1",
  recordingUrl: null,
  providerSummary: null,
  providerMetadataJson: "{}",
  deleted: false,
} as const;

it("builds stable source-unit and exact segment rows", () => {
  const first = buildCallSourceUnitRows(call, authority);
  const second = buildCallSourceUnitRows(call, authority);
  expect(second).toEqual(first);
  expect(first.segments[0]).toMatchObject({
    ordinal: 0,
    speakerLabel: "Alex",
    text: "We will launch on Friday.",
  });
});

it("changes only the revision when transcript content changes", () => {
  const first = buildCallSourceUnitRows(call, authority);
  const changed = buildCallSourceUnitRows(
    {
      ...call,
      externalRevisionId: "revision_2",
      segments: [{ ...call.segments[0], text: "We launched Friday." }],
    },
    authority,
  );
  expect(changed.unit.unitKey).toBe(first.unit.unitKey);
  expect(changed.revision.unitRevisionKey).not.toBe(
    first.revision.unitRevisionKey,
  );
});
```

- [ ] **Step 2: Run the focused test and confirm missing contracts fail**

Run:

```bash
rtk host-test-slot --class focused pnpm --dir packages/convex exec vitest run test/source-unit-schema.test.ts
```

Expected: FAIL because `sources/sourceUnit.ts` and its exports do not exist.

- [ ] **Step 3: Implement schemas and deterministic row construction**

Use Effect `Schema.Struct` and the existing `sha256Hex` helper. The canonical
types must include the exact fields approved in the design. Derive keys as:

```ts
const unitKey = `sunit_${sha256Hex(
  JSON.stringify({
    organizationKey: authority.organizationKey,
    connectionKey: input.connectionKey,
    connectionGeneration: authority.connectionGeneration,
    providerKey: input.providerKey,
    externalCallId: input.externalCallId,
  }),
)}`;
const unitRevisionKey = `surev_${sha256Hex(
  JSON.stringify({
    unitKey,
    externalRevisionId: input.externalRevisionId,
    contentHash,
    deleted: input.deleted,
  }),
)}`;
```

Sort segments by `ordinal`, reject duplicate ordinals or external IDs, reject
empty transcripts unless `deleted` is true, and cap each segment at 32,000
characters without capping the total call length.

- [ ] **Step 4: Add tables and expand citations compatibly**

Create indexes for:

```ts
sourceUnits: (by_org_connection_external, by_unit_key, by_org_current_state);
sourceUnitRevisions: (by_unit_revision_key, by_unit_created);
sourceSegments: (by_unit_revision_ordinal, by_segment_key);
```

Add `call_transcript` to citation source kinds and make transcript locator
fields optional so existing note rows survive expansion.

- [ ] **Step 5: Record expand/backfill/verify/contract migration**

Document that this task only expands tables and citation fields, that no pilot
note row requires backfill, that rollback ignores new tables, and that
contracting Slack-specific source tables is explicitly outside this batch.

- [ ] **Step 6: Generate and verify**

```bash
rtk pnpm confect:codegen
rtk host-test-slot --class focused pnpm --dir packages/convex exec vitest run test/source-unit-schema.test.ts
rtk host-test-slot --class focused pnpm check:schema-migration-notes
rtk host-test-slot --class focused pnpm check:secret-canaries
```

Expected: all pass; generated changes contain the three new tables and expanded
citation schema.

- [ ] **Step 7: Commit**

```bash
rtk git add packages/integrations/src/transcripts/canonical.ts packages/integrations/src/index.ts packages/integrations/package.json packages/convex/confect/sources/sourceUnit.ts packages/convex/confect/tables/sourceUnits.ts packages/convex/confect/tables/sourceUnitRevisions.ts packages/convex/confect/tables/sourceSegments.ts packages/convex/confect/tables/citations.ts packages/convex/confect/_generated docs/product/maestro-brain-migrations.md packages/convex/test/source-unit-schema.test.ts
rtk git commit -m "feat: add canonical transcript source units"
```

### Task 2: Add the internal idempotent source-unit ingestion capability

**Classification:** `pattern-instance` of an internal Confect capability, using
`maintainBrainPage` for file layout and typed-error style.

**Files:**

- Create: `packages/convex/confect/capabilities/ingestSourceUnit.spec.ts`
- Create: `packages/convex/confect/capabilities/ingestSourceUnit.domain.ts`
- Create: `packages/convex/confect/capabilities/ingestSourceUnit.impl.ts`
- Create: `packages/convex/confect/capabilities/ingestSourceUnit.test.ts`
- Test: `packages/convex/test/source-unit-ingestion.test.ts`

**Interfaces:**

- Consumes `CanonicalCallTranscript`, a system/internal principal, and an
  `IngestSourceAuthority` union. Provider authority names the active connection
  generation; manual-import authority names the already-authorized organization
  and actor and is accepted only for provider key `manual-transcript`.
- Produces
  `{ outcome: "inserted" | "duplicate" | "tombstone"; unitKey; unitRevisionKey; segmentCount }`.
- Declares `Unauthorized`, `TenantMismatch`, `ConnectionRevoked`,
  `DuplicateKeyConflict`, and `ValidationFailed`.
- Exposes no web, API, CLI, or MCP surface.

- [ ] **Step 1: Write failing contract and persistence tests**

Test successful insert, identical duplicate, changed immutable revision,
tombstone, revoked connection, and another organization's connection. Require
the duplicate call to leave row counts unchanged.

```ts
expect(await ingest(call)).toMatchObject({ outcome: "inserted" });
expect(await ingest(call)).toMatchObject({ outcome: "duplicate" });
expect(await countRows()).toEqual({ units: 1, revisions: 1, segments: 1 });
```

- [ ] **Step 2: Run tests and confirm the capability is missing**

```bash
rtk host-test-slot --class focused pnpm --dir packages/convex exec vitest run confect/capabilities/ingestSourceUnit.test.ts test/source-unit-ingestion.test.ts
```

Expected: FAIL because the spec and implementation are absent.

- [ ] **Step 3: Implement pure validation and idempotency decisions**

`ingestSourceUnit.domain.ts` must compare the incoming revision key with the
current unit revision and return one of:

```ts
type IngestPlan =
  | { readonly outcome: "duplicate" }
  | { readonly outcome: "inserted"; readonly replaceCurrent: boolean }
  | { readonly outcome: "tombstone"; readonly replaceCurrent: true };
```

Do not perform provider calls or Brain routing in this capability.

- [ ] **Step 4: Implement the database-backed Confect mutation**

For provider authority, resolve the active `providerConnections` row by
organization, connection key, and generation before decoding content. For
manual-import authority, require the internal caller and exact
`manual-transcript` provider key supplied by the public capability that already
authorized the human. Insert revision and segments first, then insert or patch
the current unit pointer, and finally enqueue one `sourceProcessingJobs` row
with stage `assembled`. Use the unit revision key as the organization
idempotency key.

- [ ] **Step 5: Regenerate contracts and run focused gates**

```bash
rtk pnpm confect:codegen
rtk pnpm confect:manifest
rtk host-test-slot --class focused pnpm --dir packages/convex exec vitest run confect/capabilities/ingestSourceUnit.test.ts test/source-unit-ingestion.test.ts
rtk host-test-slot --class focused pnpm check:confect-contracts
rtk host-test-slot --class focused pnpm check:headless-surface-contract
```

Expected: all pass and the operation has an empty external surface list.

- [ ] **Step 6: Commit**

```bash
rtk git add packages/convex/confect/capabilities/ingestSourceUnit.* packages/convex/test/source-unit-ingestion.test.ts packages/convex/confect/_generated packages/template-core/src/generated/confectManifest.ts
rtk git commit -m "feat: ingest immutable source units"
```

### Task 3: Make transcript citations readable through shared Brain retrieval

**Classification:** `pattern-instance` of existing Brain read and citation
contracts.

**Files:**

- Modify: `packages/convex/confect/brain/retrieval.ts`
- Modify: `packages/convex/confect/brain/readApi.impl.ts`
- Modify: `packages/convex/confect/brain/pilot.impl.ts`
- Modify: `apps/web/src/features/brain/citation-list.tsx`
- Test: `packages/convex/test/brain-lifecycle-retrieval.test.ts`
- Test: `packages/convex/test/brain-pilot.test.ts`
- Test: `apps/web/src/features/brain/citation-list.test.tsx`

**Interfaces:**

- Consumes routed active source-unit revisions and segment citations.
- Produces citation locators such as `timestamp:12000-15400` and labels such as
  `Alex · 00:12` without exposing another Brain.

- [ ] **Step 1: Add failing retrieval and renderer tests**

Require a routed call segment to resolve with exact quote, speaker, timestamps,
source URL, and freshness. Require revoked, tombstoned, stale-generation, and
foreign-Brain segments to be excluded.

- [ ] **Step 2: Run focused tests and confirm call citations are unresolved**

```bash
rtk host-test-slot --class focused pnpm --dir packages/convex exec vitest run test/brain-lifecycle-retrieval.test.ts test/brain-pilot.test.ts
rtk host-test-slot --class focused pnpm --dir apps/web exec vitest run src/features/brain/citation-list.test.tsx
```

- [ ] **Step 3: Implement a shared transcript citation projection**

Keep note behavior intact. Resolve transcript citations only when unit,
revision, segment, route, and lifecycle are current. Format timestamps with a
small local helper:

```ts
export const formatCitationTime = (milliseconds: number) => {
  const seconds = Math.floor(milliseconds / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};
```

- [ ] **Step 4: Run focused tests and commit**

```bash
rtk host-test-slot --class focused pnpm --dir packages/convex exec vitest run test/brain-lifecycle-retrieval.test.ts test/brain-pilot.test.ts
rtk host-test-slot --class focused pnpm --dir apps/web exec vitest run src/features/brain/citation-list.test.tsx
rtk git add packages/convex/confect/brain apps/web/src/features/brain/citation-list.tsx apps/web/src/features/brain/citation-list.test.tsx packages/convex/test/brain-lifecycle-retrieval.test.ts packages/convex/test/brain-pilot.test.ts
rtk git commit -m "feat: resolve transcript citations"
```

### Task 4: Add deterministic and reviewable call-to-Brain routing

**Classification:** `template-gap` built from the existing classification
authority, review, and route-generation primitives.

**Files:**

- Create: `packages/convex/confect/tables/callRouteMappings.ts`
- Create: `packages/convex/confect/tables/callRoutingProposals.ts`
- Create: `packages/convex/confect/routing/callMatching.ts`
- Create: `packages/convex/confect/capabilities/routeCallToBrain.spec.ts`
- Create: `packages/convex/confect/capabilities/routeCallToBrain.domain.ts`
- Create: `packages/convex/confect/capabilities/routeCallToBrain.impl.ts`
- Create: `packages/convex/confect/capabilities/routeCallToBrain.test.ts`
- Modify:
  `packages/convex/confect/workflowContracts/sourceClassification.impl.ts`
- Modify: `packages/convex/confect/classification/gather.ts`
- Test: `packages/convex/test/call-routing.test.ts`
- Test: `packages/convex/test/sourceClassification.workflow.test.ts`

**Interfaces:**

- Consumes a current call `unitRevisionKey` and system principal.
- Produces `routed`, `awaiting_review`, `mixed_client`, or `no_match`.
- Exact match kinds are `explicit`, `recurring_meeting`, `participant_email`,
  `participant_domain`, `known_stakeholder`, and `agency_internal`.
- Model proposals can choose only from the supplied candidate Brain keys and do
  not commit a route without review.

- [ ] **Step 1: Write failing pure matching tests**

```ts
expect(
  matchCall({
    participants: [{ email: "buyer@acme.com", domain: "acme.com" }],
    mappings: [{ kind: "domain", value: "acme.com", brainKey: "br_acme" }],
  }),
).toEqual({ kind: "exact", brainKey: "br_acme", reason: "participant_domain" });

expect(
  matchCall({
    participants: [
      { email: "a@acme.com", domain: "acme.com" },
      { email: "b@globex.com", domain: "globex.com" },
    ],
    mappings: domainMappings,
  }),
).toMatchObject({ kind: "mixed_client" });
```

Cover precedence, conflicting mappings, all-agency participants, no external
domain, model candidate closure, and cross-organization mapping rejection.

- [ ] **Step 2: Run tests and confirm the routing domain is absent**

```bash
rtk host-test-slot --class focused pnpm --dir packages/convex exec vitest run confect/capabilities/routeCallToBrain.test.ts test/call-routing.test.ts
```

- [ ] **Step 3: Implement exact matching and durable reviewed mappings**

Use exact normalized values only; do not add heuristic scores or keyword
weights. Confirmation may persist recurrence, email, or domain mappings only
when the reviewer explicitly selects that learning scope.

- [ ] **Step 4: Implement the typed capability and route fencing**

Require current unit revision and lifecycle generation. An exact unique match
may create the route immediately. Conflicts and no-match states create a
proposal without exposing transcript content to candidate Brains.

- [ ] **Step 5: Replace the classification gather fixture for call units**

Make the existing source-classification workflow gather the current immutable
call revision, exact segments, and closed candidate Brain list. Preserve its
zero-or-one result and reviewed commit semantics. Start it only when exact
matching produced neither a route nor a structural mixed-client result.

- [ ] **Step 6: Generate, run gates, and commit**

```bash
rtk pnpm confect:codegen
rtk pnpm confect:manifest
rtk host-test-slot --class focused pnpm --dir packages/convex exec vitest run confect/capabilities/routeCallToBrain.test.ts test/call-routing.test.ts test/sourceClassification.workflow.test.ts
rtk host-test-slot --class focused pnpm check:confect-contracts
rtk git add packages/convex/confect/routing packages/convex/confect/capabilities/routeCallToBrain.* packages/convex/confect/tables/callRouteMappings.ts packages/convex/confect/tables/callRoutingProposals.ts packages/convex/confect/workflowContracts/sourceClassification.impl.ts packages/convex/confect/classification/gather.ts packages/convex/confect/_generated packages/convex/test/call-routing.test.ts packages/convex/test/sourceClassification.workflow.test.ts packages/template-core/src/generated/confectManifest.ts
rtk git commit -m "feat: route calls to authorized Brains"
```

### Task 5: Replace the maintenance fixture with gathered transcript evidence

**Classification:** `fixture-to-real`. Replace the hard-coded context in
`sourceToBrainMaintenance.graph.ts`; preserve the existing workflow and
`maintainBrainPage` contracts deliberately.

**Files:**

- Create:
  `packages/convex/confect/capabilities/gatherMaintenanceContext.spec.ts`
- Create:
  `packages/convex/confect/capabilities/gatherMaintenanceContext.impl.ts`
- Create:
  `packages/convex/confect/capabilities/gatherMaintenanceContext.test.ts`
- Create: `packages/convex/confect/capabilities/mineCallTranscript.spec.ts`
- Create: `packages/convex/confect/capabilities/mineCallTranscript.domain.ts`
- Create: `packages/convex/confect/capabilities/mineCallTranscript.impl.ts`
- Create: `packages/convex/confect/capabilities/mineCallTranscript.test.ts`
- Modify: `packages/convex/confect/workflows/sourceToBrainMaintenance.graph.ts`
- Modify: `packages/convex/convex/workflowRunners/sourceToBrainMaintenance.ts`
- Modify: `packages/convex/confect/capabilities/maintainBrainPage.impl.ts`
- Modify: `packages/convex/confect/tables/brainMaintenanceProposals.ts`
- Create: `packages/convex/confect/tables/brainMaintenanceProposalItems.ts`
- Test: `packages/convex/test/sourceToBrainMaintenance.workflow.test.ts`

**Interfaces:**

- `gatherMaintenanceContext(unitRevisionKey)` returns current routed Brain,
  pages, current revision keys, exact segment citations, and authority
  generations.
- `mineCallTranscript(context)` performs one schema-constrained LLM call and
  returns a typed summary, decisions, commitments, risks, stakeholders, page
  proposals, citation keys, or no-op.
- `maintainBrainPage` validates and persists one grouped proposal.

- [ ] **Step 1: Write failing gather tests**

Require only current routed active segments, current Brain pages, and current
authority generations. Require typed failure for stale route, revoked source,
foreign workspace, missing current page, and zero readable citations.

- [ ] **Step 2: Write failing mining decoder tests**

Use a fake model service returning valid and invalid structured results.

```ts
expect(
  decodeMinedCall({
    summary: "Acme approved Friday launch.",
    decisions: [{ text: "Launch Friday", citationKeys: ["cite_segment_1"] }],
    commitments: [],
    risks: [],
    stakeholderChanges: [],
    pageProposals: [],
  }),
).toMatchObject({ summary: expect.any(String) });
```

Reject unknown citations, empty factual citation lists, invented owner/due-date
fields without cited text, and an output targeting a different Brain.

- [ ] **Step 3: Run focused tests and confirm fixture behavior fails them**

```bash
rtk host-test-slot --class focused pnpm --dir packages/convex exec vitest run confect/capabilities/gatherMaintenanceContext.test.ts confect/capabilities/mineCallTranscript.test.ts test/sourceToBrainMaintenance.workflow.test.ts
```

- [ ] **Step 4: Implement the gather query**

Read current route, unit revision, segments, pages, revisions, and citations in
one tenant-scoped capability. Limit context deterministically by current call
and the six Client Brief pages; do not add vector retrieval.

- [ ] **Step 5: Implement one structured model action**

Reuse `packages/integrations/src/llmStructured.ts`. The model gets no provider,
database, or write tools. Delimit transcript and page content as untrusted data.
Persist only model, prompt, schema, usage, request hash, and response hash in
the receipt—not raw transcript or completion text.

- [ ] **Step 6: Replace the graph's static mapper**

The graph becomes:

```text
start -> gatherMaintenanceContext -> mineCallTranscript -> maintainBrainPage -> receipt
```

`buildArgs` must pass `unitRevisionKey` and prior node output, never fake
`br_client`, `pag_brief`, `cite_1`, or fixed model output.

- [ ] **Step 7: Persist grouped proposals with citations**

Extend `maintainBrainPage.impl.ts` to write one grouped
`brainMaintenanceProposals` row plus one normalized
`brainMaintenanceProposalItems` row per proposed page. Each item stores page
key, expected revision key, markdown, and citation keys. Keep stale revision,
citation, evidence-kind, lifecycle, route generation, and revision budget checks
reachable. Owner and due-date claims require at least one `verbatim_transcript`
citation.

- [ ] **Step 8: Generate, run gates, and commit**

```bash
rtk pnpm confect:codegen
rtk pnpm confect:manifest
rtk host-test-slot --class focused pnpm --dir packages/convex exec vitest run confect/capabilities/gatherMaintenanceContext.test.ts confect/capabilities/mineCallTranscript.test.ts test/sourceToBrainMaintenance.workflow.test.ts
rtk host-test-slot --class focused pnpm check:workflow-graph-boundary
rtk host-test-slot --class focused pnpm check:confect-contracts
rtk git add packages/convex/confect/capabilities packages/convex/confect/tables/brainMaintenanceProposals.ts packages/convex/confect/tables/brainMaintenanceProposalItems.ts packages/convex/confect/workflows/sourceToBrainMaintenance.graph.ts packages/convex/convex/workflowRunners/sourceToBrainMaintenance.ts packages/convex/confect/_generated packages/convex/test/sourceToBrainMaintenance.workflow.test.ts packages/template-core/src/generated/confectManifest.ts
rtk git commit -m "feat: mine routed call evidence"
```

### Task 6: Add routing and grouped maintenance review operations

**Classification:** `pattern-instance` of the existing Brain pilot review and
classification review contracts.

**Files:**

- Create: `packages/convex/confect/brain/callReview.spec.ts`
- Create: `packages/convex/confect/brain/callReview.impl.ts`
- Test: `packages/convex/test/call-review.test.ts`
- Modify: `packages/convex/confect/capabilities/maintainBrainPage.impl.ts`
- Modify: `packages/convex/confect/brain/pages.impl.ts`

**Interfaces:**

- Public editor/admin operations: `listCallRoutingQueue`, `reviewCallRoute`,
  `listCallMaintenanceQueue`, and `reviewCallMaintenance`.
- `reviewCallMaintenance` accepts `accept`, `edit`, or `reject` plus an
  idempotent `attemptKey` and expected authority generations.

- [ ] **Step 1: Write failing authorization and transition tests**

Cover viewer denial, editor maintenance review, admin route review, another
Brain denial, duplicate attempt, stale source revision, stale page revision,
accept, edited accept, reject, and learned mapping persistence.

- [ ] **Step 2: Run tests and confirm operations are absent**

```bash
rtk host-test-slot --class focused pnpm --dir packages/convex exec vitest run test/call-review.test.ts
```

- [ ] **Step 3: Implement review operations and atomic page publication**

Route confirmation must commit the route before scheduling maintenance.
Maintenance acceptance must insert immutable page revision and exact citations
before advancing the page pointer. Duplicate `attemptKey` returns the existing
result; stale generations fail without partial writes.

- [ ] **Step 4: Generate, run tests, and commit**

```bash
rtk pnpm confect:codegen
rtk pnpm confect:manifest
rtk host-test-slot --class focused pnpm --dir packages/convex exec vitest run test/call-review.test.ts test/brain-pages-crud.test.ts
rtk host-test-slot --class focused pnpm check:confect-contracts
rtk git add packages/convex/confect/brain/callReview.* packages/convex/confect/capabilities/maintainBrainPage.impl.ts packages/convex/confect/brain/pages.impl.ts packages/convex/confect/_generated packages/convex/test/call-review.test.ts packages/template-core/src/generated/confectManifest.ts
rtk git commit -m "feat: review mined call updates"
```

### Task 7: Build the call routing and maintenance review UI

**Classification:** `pattern-instance` of existing Connections classification
review and Brain review queue components.

**Files:**

- Create: `apps/web/src/features/connections/call-routing-queue.tsx`
- Create: `apps/web/src/features/connections/call-routing-queue.test.tsx`
- Create: `apps/web/src/features/brain/call-maintenance-review.tsx`
- Create: `apps/web/src/features/brain/call-maintenance-review.test.tsx`
- Modify: `apps/web/src/features/connections/connections-screen.tsx`
- Modify: `apps/web/src/features/connections/connections-screen.test.tsx`
- Modify: `apps/web/src/features/brain/brain-workspace.tsx`
- Modify: `apps/web/src/features/brain/brain-workspace.test.tsx`
- Modify: `apps/web/src/features/brain/brain-surface.ts`

**Interfaces:**

- Feature adapters call generated `brain.callReview` refs.
- Components receive view models and callbacks; they do not import Convex or
  provider SDKs directly.

- [ ] **Step 1: Write failing UI state tests**

Cover loading, empty, ambiguous ready, exact auto-routed, mutation pending,
mutation success, mutation failure, grouped page diffs, timestamped citations,
keyboard operation, and viewer read-only behavior.

- [ ] **Step 2: Run focused web tests and confirm components are absent**

```bash
rtk host-test-slot --class focused pnpm --dir apps/web exec vitest run src/features/connections/call-routing-queue.test.tsx src/features/brain/call-maintenance-review.test.tsx src/features/connections/connections-screen.test.tsx src/features/brain/brain-workspace.test.tsx
```

- [ ] **Step 3: Implement the smallest accessible review surfaces**

Reuse SaaS UI buttons, tables, alerts, and disclosure primitives. Show matching
evidence, candidate Brain, source link, summary, page diffs, and citations.
Provide Confirm, Change Brain, No route, Accept all, Edit, and Reject controls.

- [ ] **Step 4: Run focused tests, typecheck, and commit**

```bash
rtk host-test-slot --class focused pnpm --dir apps/web exec vitest run src/features/connections/call-routing-queue.test.tsx src/features/brain/call-maintenance-review.test.tsx src/features/connections/connections-screen.test.tsx src/features/brain/brain-workspace.test.tsx
rtk host-test-slot --class focused pnpm --dir apps/web typecheck
rtk git add apps/web/src/features/connections apps/web/src/features/brain
rtk git commit -m "feat: review routed call knowledge"
```

### Task 8: Prove publication reaches every existing read surface

**Classification:** `pattern-instance` of the existing shared Brain capability
registry and API/CLI/MCP dispatch.

**Files:**

- Modify: `packages/convex/confect/brain/readApi.impl.ts`
- Modify: `packages/convex/confect/brain/pilot.impl.ts`
- Test: `packages/convex/test/brain-ask.test.ts`
- Test: `packages/convex/test/brain-pilot-wrapper.test.ts`
- Test: `apps/cli/src/index.test.ts`

**Interfaces:**

- No new write operation is exposed to CLI or MCP.
- Existing `brain.context.get`, `brain.answers.ask`, `brain.sources.search`, and
  `brain.sources.get` return accepted call-backed page content and exact
  citations under current authorization.

- [ ] **Step 1: Add a failing cross-surface acceptance test**

Seed a routed call, accepted maintenance proposal, page revision, and segment
citation. Assert the same source and revision keys appear in web search, Ask,
read API, and CLI response decoding. Assert another Brain key cannot retrieve
them.

- [ ] **Step 2: Run focused backend and CLI tests**

```bash
rtk host-test-slot --class focused pnpm --dir packages/convex exec vitest run test/brain-ask.test.ts test/brain-pilot-wrapper.test.ts
rtk host-test-slot --class focused pnpm --dir apps/cli exec vitest run src/index.test.ts
```

- [ ] **Step 3: Reuse the existing active projection path**

Extend existing reads only where transcript citations need resolution. Do not
add a call-specific CLI command, MCP tool, or second retrieval backend.

- [ ] **Step 4: Run tests and commit**

```bash
rtk host-test-slot --class focused pnpm --dir packages/convex exec vitest run test/brain-ask.test.ts test/brain-pilot-wrapper.test.ts
rtk host-test-slot --class focused pnpm --dir apps/cli exec vitest run src/index.test.ts
rtk git add packages/convex/confect/brain packages/convex/test/brain-ask.test.ts packages/convex/test/brain-pilot-wrapper.test.ts apps/cli/src/index.test.ts
rtk git commit -m "test: prove call knowledge across read surfaces"
```

### Task 9: Generalize Nango connections and record access safely

**Classification:** `fixture-to-real` extension of the existing single-provider
Nango service and Slack-only connect operations.

**Files:**

- Create: `packages/integrations/src/transcripts/providers.ts`
- Create: `packages/integrations/src/nango/records.ts`
- Create: `packages/integrations/src/nango/records.test.ts`
- Modify: `packages/integrations/src/nango/client.ts`
- Modify: `packages/integrations/src/nango/client.test.ts`
- Modify: `packages/integrations/src/index.ts`
- Modify: `packages/integrations/package.json`
- Create: `packages/convex/confect/integrations/transcriptConnections.spec.ts`
- Create: `packages/convex/confect/integrations/transcriptConnections.impl.ts`
- Create: `packages/convex/confect/integrations/transcriptConnections.node.ts`
- Create: `packages/convex/convex/integrations/transcriptConnections.ts`
- Test: `packages/convex/test/transcript-connections.test.ts`

**Interfaces:**

- Server registry initially allows `fireflies`, `gong-oauth`, `fathom-oauth`,
  and `granola`.
- `NangoClient.listRecords({ connectionId, providerConfigKey, model, cursor, limit, filter })`
  wraps SDK 0.71's `listRecords` without returning secrets.
- Generic connect completion binds the returned provider configuration key to
  the requested organization and registered provider.

- [ ] **Step 1: Write failing registry, listRecords, and connect tests**

Require unknown provider rejection before Nango, cursor forwarding, maximum page
size enforcement, redacted provider errors, organization mismatch denial, and
Slack connection regression coverage.

- [ ] **Step 2: Run focused tests and confirm single-provider assumptions fail**

```bash
rtk host-test-slot --class focused pnpm --dir packages/integrations exec vitest run src/nango/client.test.ts src/nango/records.test.ts
rtk host-test-slot --class focused pnpm --dir packages/convex exec vitest run test/transcript-connections.test.ts test/slack-connections.test.ts
```

- [ ] **Step 3: Add a data-only provider registry**

```ts
export const transcriptProviders = {
  fireflies: { providerConfigKey: "fireflies", auth: "api_key" },
  gong: { providerConfigKey: "gong-oauth", auth: "oauth2" },
  fathom: { providerConfigKey: "fathom-oauth", auth: "oauth2" },
  granola: { providerConfigKey: "granola", auth: "api_key" },
} as const;
```

Do not add classes or runtime plugin loading.

- [ ] **Step 4: Wrap Nango `listRecords` and multi-provider Connect**

Use the installed SDK's exact request fields: `providerConfigKey`,
`connectionId`, `model`, `cursor`, `limit`, and `filter`. Pin `limit` to 100.
Keep `NANGO_SECRET_KEY` as the only server credential; provider configuration
keys come from the server registry rather than a browser value.

- [ ] **Step 5: Generate, run gates, and commit**

```bash
rtk pnpm confect:codegen
rtk pnpm confect:manifest
rtk host-test-slot --class focused pnpm --dir packages/integrations exec vitest run src/nango/client.test.ts src/nango/records.test.ts
rtk host-test-slot --class focused pnpm --dir packages/convex exec vitest run test/transcript-connections.test.ts test/slack-connections.test.ts
rtk host-test-slot --class focused pnpm check:provider-boundary
rtk host-test-slot --class focused pnpm check:secret-canaries
rtk git add packages/integrations packages/convex/confect/integrations/transcriptConnections.* packages/convex/convex/integrations/transcriptConnections.ts packages/convex/confect/_generated packages/convex/test/transcript-connections.test.ts packages/template-core/src/generated/confectManifest.ts
rtk git commit -m "feat: connect transcript providers"
```

### Task 10: Add Fireflies and Gong normalization adapters

**Classification:** `pattern-instance` of the Nango provider adapter boundary.

**Files:**

- Modify: `packages/integrations/src/transcripts/canonical.ts`
- Create: `packages/integrations/src/transcripts/fireflies.ts`
- Create: `packages/integrations/src/transcripts/fireflies.test.ts`
- Create: `packages/integrations/src/transcripts/gong.ts`
- Create: `packages/integrations/src/transcripts/gong.test.ts`
- Create:
  `packages/integrations/src/transcripts/fixtures/fireflies-transcript.json`
- Create:
  `packages/integrations/src/transcripts/fixtures/fireflies-sentences.json`
- Create: `packages/integrations/src/transcripts/fixtures/gong-call.json`
- Create: `packages/integrations/src/transcripts/fixtures/gong-transcript.json`
- Modify: `packages/integrations/src/index.ts`

**Interfaces:**

- `normalizeFirefliesCall({ transcript, sentences })` joins Nango `Transcript`
  and `Sentence` models.
- `normalizeGongCall({ call, transcript })` joins Nango `Call` and
  `CallTranscript` models.
- Both return `CanonicalCallTranscript` and throw provider-specific typed decode
  errors containing no payload text.

- [ ] **Step 1: Add redacted fixtures and failing adapter tests**

Fireflies tests must sort sentence `index`, normalize numeric/string speaker
IDs, and convert start/end times. Gong tests must flatten monologues and
sentences while retaining speaker IDs and call metadata. Both tests cover empty
segments, malformed call IDs, deletion records, and deterministic revision
hashes.

- [ ] **Step 2: Run tests and confirm adapters are absent**

```bash
rtk host-test-slot --class focused pnpm --dir packages/integrations exec vitest run src/transcripts/fireflies.test.ts src/transcripts/gong.test.ts
```

- [ ] **Step 3: Implement ordinary normalization functions**

Use Effect Schema or explicit type guards already present in the package. Do not
import provider SDKs, route Brains, or invoke models.

- [ ] **Step 4: Run tests, provider-boundary checks, and commit**

```bash
rtk host-test-slot --class focused pnpm --dir packages/integrations exec vitest run src/transcripts/fireflies.test.ts src/transcripts/gong.test.ts
rtk host-test-slot --class focused pnpm check:provider-boundary
rtk host-test-slot --class focused pnpm check:logging-boundary
rtk git add packages/integrations/src/transcripts packages/integrations/src/index.ts
rtk git commit -m "feat: normalize Gong and Fireflies calls"
```

### Task 11: Run bounded provider syncs and expose connection health

**Classification:** `pattern-instance` of the existing workpool and provider
connection health patterns.

**Files:**

- Create: `packages/convex/confect/tables/connectorSyncStates.ts`
- Create: `packages/convex/confect/integrations/transcriptSync.spec.ts`
- Create: `packages/convex/confect/integrations/transcriptSync.impl.ts`
- Create: `packages/convex/convex/integrations/transcriptSyncWorker.ts`
- Test: `packages/convex/test/transcript-sync.test.ts`
- Modify: `apps/web/src/features/connections/connections-screen.tsx`
- Modify: `apps/web/src/features/connections/connections-screen.test.tsx`
- Create: `tests/e2e/hosted-brain-transcript.spec.ts`
- Modify: `docs/superpowers/receipts/maestro-brain/staging-pilot-launch.md`

**Interfaces:**

- One worker page processes at most 100 Nango records and one connection.
- Fireflies advances one `Transcript` cursor and fetches that transcript's
  sentence detail through the provider proxy. Gong advances one `CallTranscript`
  cursor and resolves call metadata through the `Call` model by ID or provider
  proxy. Related lookups never advance the primary cursor.
- Cursor advances only after every canonical call in the page is durably
  ingested.
- Health returns provider, state, last success, cursor presence, counts,
  backfill progress, and redacted last error tag.

- [ ] **Step 1: Write failing worker tests**

Cover cursor commit after success, cursor retention after partial failure,
duplicate records, edit, delete, `Retry-After`, permanent decode failure,
connection generation replacement, fairness between two connections, and no raw
payload in error state.

- [ ] **Step 2: Run tests and confirm the worker is absent**

```bash
rtk host-test-slot --class focused pnpm --dir packages/convex exec vitest run test/transcript-sync.test.ts
```

- [ ] **Step 3: Implement one-page fenced sync execution**

The Node worker calls only the Nango service and generated internal ingestion
ref. The Confect mutation owns claims, cursor compare-and-set, and health. A
failure schedules bounded retry without advancing the cursor.

- [ ] **Step 4: Add connection catalog states**

Render disconnected, authorizing, syncing, ready, error, reauthorizing, and
revoked states plus calls discovered, routed, and awaiting routing. Reuse
`NangoConnectButton`; parameterize its label with the provider display name.

- [ ] **Step 5: Run focused checks and commit code**

```bash
rtk pnpm confect:codegen
rtk pnpm confect:manifest
rtk host-test-slot --class focused pnpm --dir packages/convex exec vitest run test/transcript-sync.test.ts
rtk host-test-slot --class focused pnpm --dir apps/web exec vitest run src/features/connections/connections-screen.test.tsx
rtk host-test-slot --class focused pnpm check:secret-canaries
rtk git add packages/convex/confect/tables/connectorSyncStates.ts packages/convex/confect/integrations/transcriptSync.* packages/convex/convex/integrations/transcriptSyncWorker.ts packages/convex/confect/_generated packages/convex/test/transcript-sync.test.ts apps/web/src/features/connections/connections-screen.tsx apps/web/src/features/connections/connections-screen.test.tsx packages/template-core/src/generated/confectManifest.ts
rtk git commit -m "feat: sync live call transcripts"
```

- [ ] **Step 6: Configure staging without printing secrets**

Use `headless-bws-env check` before asking the user for credentials. Configure
Nango provider integrations and Cloudflare/Convex environment values through
provider secret stores. Never copy API keys into repository files or command
output.

- [ ] **Step 7: Run real hosted smokes**

For one Fireflies and one Gong connection, prove connect, 30-day bounded
backfill, one imported call, exact auto-route or routing review, mined proposal,
acceptance, and cited Ask/CLI result. Record provider names, connection keys,
counts, timestamps, commit SHA, and redacted statuses in the staging receipt.

- [ ] **Step 8: Add and run the browser smoke**

```bash
rtk headless-bws-env exec pnpm exec playwright test tests/e2e/hosted-brain-transcript.spec.ts
```

Expected: PASS against staging with no route boundary, failed Convex request,
console error, or uncited mined claim.

- [ ] **Step 9: Commit the redacted staging receipt**

```bash
rtk git add tests/e2e/hosted-brain-transcript.spec.ts docs/superpowers/receipts/maestro-brain/staging-pilot-launch.md
rtk git commit -m "test: prove live transcript ingestion"
```

### Task 12: Add Fathom and Granola proxy-pull adapters

**Classification:** `pattern-instance` of the Fireflies/Gong canonical adapter
and shared sync worker. Nango provides auth/proxy but no prebuilt sync for these
providers.

**Files:**

- Create: `packages/integrations/src/transcripts/fathom.ts`
- Create: `packages/integrations/src/transcripts/fathom.test.ts`
- Create: `packages/integrations/src/transcripts/granola.ts`
- Create: `packages/integrations/src/transcripts/granola.test.ts`
- Create: `packages/integrations/src/transcripts/fixtures/fathom-meeting.json`
- Create: `packages/integrations/src/transcripts/fixtures/granola-note.json`
- Modify: `packages/convex/convex/integrations/transcriptSyncWorker.ts`
- Modify: `packages/convex/test/transcript-sync.test.ts`

**Interfaces:**

- Fathom fetches changed meetings through Nango proxy using the OAuth provider
  configuration and emits speaker/timestamp transcript segments when available.
- Granola fetches `/v1/notes` pages through Nango proxy and emits note text as
  `provider_notes` segments. Verbatim transcript segments are emitted only when
  the provider response supplies them; the two evidence kinds remain visible and
  enforce different mining policy.
- Both reuse the shared cursor and ingestion capability.

- [ ] **Step 1: Add redacted official-shape fixtures and failing tests**

Tests must prove pagination, stable call IDs, participant normalization,
timestamp conversion, provider-summary labeling, deletion behavior, and that
Granola notes without verbatim transcript cannot satisfy a transcript quote.

- [ ] **Step 2: Run focused tests and confirm adapters are absent**

```bash
rtk host-test-slot --class focused pnpm --dir packages/integrations exec vitest run src/transcripts/fathom.test.ts src/transcripts/granola.test.ts
```

- [ ] **Step 3: Implement proxy fetch and normalizers**

Keep provider endpoints, pagination tokens, and rate handling in these modules.
Return the same canonical contract and shared typed provider failures.

- [ ] **Step 4: Prove conformance and no downstream changes**

Run the shared adapter conformance suite against all four providers and verify
that no routing, maintenance, Brain review, page, retrieval, CLI, or MCP file
changed in this task.

- [ ] **Step 5: Run tests and commit**

```bash
rtk host-test-slot --class focused pnpm --dir packages/integrations exec vitest run src/transcripts/fathom.test.ts src/transcripts/granola.test.ts src/transcripts/fireflies.test.ts src/transcripts/gong.test.ts
rtk host-test-slot --class focused pnpm --dir packages/convex exec vitest run test/transcript-sync.test.ts
rtk host-test-slot --class focused pnpm check:provider-boundary
rtk git add packages/integrations/src/transcripts packages/convex/convex/integrations/transcriptSyncWorker.ts packages/convex/test/transcript-sync.test.ts
rtk git commit -m "feat: ingest Fathom and Granola calls"
```

### Task 13: Add a universal transcript import escape hatch

**Classification:** `pattern-instance` of a source-intake capability, using only
native string parsing.

**Files:**

- Create: `packages/integrations/src/transcripts/import.ts`
- Create: `packages/integrations/src/transcripts/import.test.ts`
- Create: `packages/convex/confect/capabilities/importTranscript.spec.ts`
- Create: `packages/convex/confect/capabilities/importTranscript.impl.ts`
- Create: `packages/convex/confect/capabilities/importTranscript.test.ts`
- Create: `apps/web/src/features/connections/transcript-import.tsx`
- Create: `apps/web/src/features/connections/transcript-import.test.tsx`
- Modify: `apps/web/src/features/connections/connections-screen.tsx`
- Test: `packages/convex/test/transcript-import.test.ts`

**Interfaces:**

- Accepts JSON, VTT, SRT, TXT, or Markdown plus title, occurred-at timestamp,
  participant emails, and optional target Brain.
- Produces `CanonicalCallTranscript` with provider key `manual-transcript` and
  passes through the same ingestion, routing, mining, and review pipeline.
- Requires editor role; direct target selection must pass current Brain access.

- [ ] **Step 1: Write failing parser tests**

Cover VTT/SRT timestamps, multiline cues, UTF-8 text, duplicate cue IDs, plain
text, Markdown, valid canonical JSON, invalid JSON, empty files, unsupported
format, and payload size limit. Require no dependency additions.

- [ ] **Step 2: Run tests and confirm parsers are absent**

```bash
rtk host-test-slot --class focused pnpm --dir packages/integrations exec vitest run src/transcripts/import.test.ts
```

- [ ] **Step 3: Implement native parsers and capability**

Use line splitting and explicit timestamp parsing. Set unknown speakers to
`Unknown speaker`; preserve exact cue text. The Confect capability authorizes,
normalizes, and delegates to `ingestSourceUnit` without duplicating writes.

- [ ] **Step 4: Add accessible import UI tests and implementation**

Cover file selection, metadata validation, target selection, importing, success,
failure, and keyboard behavior. Use native `<input type="file">` with an
`accept` list; do not add an upload component dependency.

- [ ] **Step 5: Generate, run checks, and commit**

```bash
rtk pnpm confect:codegen
rtk pnpm confect:manifest
rtk host-test-slot --class focused pnpm --dir packages/integrations exec vitest run src/transcripts/import.test.ts
rtk host-test-slot --class focused pnpm --dir packages/convex exec vitest run confect/capabilities/importTranscript.test.ts test/transcript-import.test.ts
rtk host-test-slot --class focused pnpm --dir apps/web exec vitest run src/features/connections/transcript-import.test.tsx
rtk host-test-slot --class focused pnpm check:secret-canaries
rtk git add packages/integrations/src/transcripts/import.* packages/convex/confect/capabilities/importTranscript.* packages/convex/confect/_generated packages/convex/test/transcript-import.test.ts apps/web/src/features/connections/transcript-import.* apps/web/src/features/connections/connections-screen.tsx packages/template-core/src/generated/confectManifest.ts
rtk git commit -m "feat: import unsupported call transcripts"
```

### Task 14: Freeze connector conformance and extension documentation

**Classification:** `template-gap` promotion. Convert the proven four-provider
shape into a small reusable conformance suite and update the source-type
playbook without creating a plugin framework.

**Files:**

- Create: `packages/integrations/src/transcripts/conformance.ts`
- Create: `packages/integrations/src/transcripts/conformance.test.ts`
- Modify: `docs/template/how-to-add-source-type.md`
- Create: `docs/template/how-to-add-transcript-connector.md`
- Modify: `docs/template/blueprint-catalog.md`
- Modify: `docs/template/env-manifest.md`

**Interfaces:**

- `transcriptAdapterConformance(name, normalize, fixture)` verifies canonical
  decode, deterministic output, stable ordering, no empty segments, redacted
  failures, and no credential-shaped values.
- The extension guide names the exact adapter, fixture, registry, focused-test,
  Nango configuration, staging smoke, and lifecycle steps for Zoom, Clari
  Copilot, Grain, Avoma, and tl;dv.

- [ ] **Step 1: Write the failing conformance suite against all four adapters**

```ts
transcriptAdapterConformance(
  "fireflies",
  normalizeFirefliesCall,
  firefliesFixture,
);
transcriptAdapterConformance("gong", normalizeGongCall, gongFixture);
transcriptAdapterConformance("fathom", normalizeFathomCall, fathomFixture);
transcriptAdapterConformance("granola", normalizeGranolaNote, granolaFixture);
```

- [ ] **Step 2: Run and confirm inconsistent adapter edges fail**

```bash
rtk host-test-slot --class focused pnpm --dir packages/integrations exec vitest run src/transcripts/conformance.test.ts
```

- [ ] **Step 3: Implement only the shared assertions proven necessary**

Do not introduce a base class, dependency-injection container, dynamic module
loader, or provider-specific routing hook.

- [ ] **Step 4: Document the two-day connector path**

The guide must require: Nango auth availability, one redacted payload fixture,
one normalizer, optional provider fetcher, registry entry, conformance test,
delete/update behavior, rate-limit behavior, provider secret names, and one real
staging smoke. Include a capability matrix for Zoom, Clari Copilot, Grain,
Avoma, and tl;dv without claiming a sync that Nango does not provide.

- [ ] **Step 5: Run docs and adapter gates and commit**

```bash
rtk host-test-slot --class focused pnpm --dir packages/integrations exec vitest run src/transcripts/conformance.test.ts
rtk host-test-slot --class focused pnpm check:docs-freshness
rtk host-test-slot --class focused pnpm check:env-boundary
rtk git add packages/integrations/src/transcripts/conformance.* docs/template/how-to-add-source-type.md docs/template/how-to-add-transcript-connector.md docs/template/blueprint-catalog.md docs/template/env-manifest.md
rtk git commit -m "docs: define transcript connector extension path"
```

## Final Release Verification

After Batch 4 is committed:

1. Run full verification remotely on the exact committed head:

   ```bash
   rtk maestro-remote-test -- pnpm verify
   ```

2. Push the exact head and require `ci/woodpecker/pr/verify` to pass.
3. Run hosted Fireflies and Gong browser smokes with BWS-provided environment.
4. Run one installed CLI `brain.context.get` and one cited `brain.answers.ask`
   against the accepted call-backed revision.
5. Verify disconnect/revocation removes the transcript from current retrieval
   without deleting immutable audit metadata.
6. Verify another organization and another Brain cannot retrieve, route, cite,
   review, or publish the call.
7. Record exact commit, deployment IDs, provider names, redacted counts,
   timestamps, and rollback result in the staging receipt.

The release is ready for pilot when all seven checks pass. Zoom, Clari Copilot,
Grain, Avoma, tl;dv, Maestro Capture, CRM routing, recording, coaching, and
cross-client analytics remain separate demand-driven deliveries.
