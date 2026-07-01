# Brain Architecture

The template Brain is a flexible source-backed context system. It defaults to
markdown, links, Source Sets, Evidence Views, context packs, freshness, and
Trust Receipts. RAG and vector search are optional extensions, not the default
truth model.

## Core Concepts

- Source: a markdown page, URL, pasted note, uploaded file, transcript, or
  connector record.
- Source Set: a selected group of sources used for a task.
- Evidence Snapshot: pinned source passages with freshness and scope metadata.
- Evidence View: reviewer-facing evidence state.
- Context Pack: compiled context passed into a workflow, capability, or agent.
- Trust Receipt: record of source ids, evidence snapshot, policy, prompt, model,
  transformation version, output hash, and generated timestamp.

## Safety

Source content is data, not instructions. Prompt-injection tests must prove
source text cannot override system, policy, or tool-grant instructions.

## Optional Retrieval

Vector search may be added behind the search provider boundary. It should
improve recall, not replace citations, evidence snapshots, or Trust Receipts.
