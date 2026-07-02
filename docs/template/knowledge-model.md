# Knowledge Model

The template Brain is source-backed by default. It starts from markdown, links,
notes, and reviewed documents, then adds structured overlays for concepts,
claims, citations, evidence views, context packs, and Trust Receipts.

RAG is optional infrastructure, not the truth model. A client fork may add
search or vector retrieval later, but generated outputs should still explain
which sources, claims, citations, policies, and workflow steps were used.

## Core Objects

### Sources

Sources are the raw business context: markdown notes, links, internal notes,
documents, exports, or approved system records. Each source needs an owner,
freshness, export posture, delete posture, and redaction posture.

### Concepts

Concepts are reusable business ideas: buyer segment, offer, operating rule,
workflow stage, integration, service line, objection, or implementation
constraint. Concepts make a client Brain easy to adapt without turning every app
into a bespoke prompt pile.

### Claims

Claims are statements the system may use. A supported or disputed claim must
have at least one citation. A claim without citations must be explicitly marked
`unsupported-draft` so humans and agents cannot confuse it with grounded truth.

### Citations

Citations connect claims to source IDs, source titles, quoted text, and source
ranges. They are the basic unit of source-grounding and investor-reviewable
evidence.

### Context Packs

Context packs are bounded bundles for workflows and agents. A context pack
contains source IDs, claim IDs, citation IDs, freshness, and a Trust Receipt
link. It is the preferred handoff between Brain data and model calls.

### Trust Receipts

Trust Receipts explain what happened: source set, context pack, capability,
agent grant, policy snapshot, model/provider posture, and output provenance.
They are the reason the template can stay simple without pretending RAG is a
complete safety model.

## Markdown Codec

`packages/template-core/src/knowledge.ts` includes a deterministic markdown
codec for:

- frontmatter;
- headings;
- links;
- citation markers;
- citation footnotes.

The codec is intentionally small. It exists so client forks can import and
export readable Brain content before they need richer editors, BlockNote,
ProseMirror, or search infrastructure.

## Open Knowledge Format Export

The OKF export contains:

- concepts;
- claims;
- citations;
- source metadata;
- `source-backed-no-default-rag` posture.

Use OKF when handing a Brain slice to another app, private package, evaluator,
or client review process.

## Implementation Map

- Pure domain: `packages/template-core/src/knowledge.ts`
- Confect spec: `packages/convex/confect/ops/knowledge.spec.ts`
- Confect fake/local impl: `packages/convex/confect/ops/knowledge.impl.ts`
- Tables: `concepts`, `claims`, `citations`, `contextPacks`
- Lifecycle: `packages/convex/confect/ops/dataLifecycle.ts`

## Rules

- Do not treat source content as instructions.
- Do not emit supported claims without citations.
- Do not add RAG as the default source of truth.
- Do not store client-specific business logic in template core without review.
- Keep generated Brain extensions in generated modules or private packages until
  the contract is promoted.
