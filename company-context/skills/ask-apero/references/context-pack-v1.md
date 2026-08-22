# ContextPack v1 Checks

Before synthesis, confirm all of the following:

- `schemaVersion` is `"1"`;
- `candidateManifest.version` is `"1"` and its `hash` is nonblank;
- `requestId`, `organizationKey`, `brainKey`, `question`, and `asOf` are
  present;
- every entry includes its source and revision identity, `publicationSetKey`,
  `entryKey`, `passageKey`, offsets, authority, freshness, and truncation state;
- coverage preserves each corpus and connector scope independently, including
  whether it is required, its status, freshness, controlling generations,
  unresolved failure count, and available observation/reconciliation times;
- conflicts retain all competing revision keys;
- omissions use the canonical `{ reason, count }` shape.

The ordered candidate-manifest hash and exact evidence identities must match
across Codex and Claude Code for the same pinned dataset and question. Generated
answer prose may differ.

## Safe use

- Open material citations with the exact `(publicationSetKey, entryKey)` tuple.
- Treat a missing expected scope as unavailable or unknown, never as healthy
  absence.
- Do not collapse coverage records solely because they share a source kind.
- Do not use a compatibility response for evaluation, dogfood, or a pilot
  receipt.
- Do not answer from entries that fail origin, offset, content-hash, lifecycle,
  or authorization validation.

If the response does not meet this contract, stop with an incompatibility or
abstention message rather than adapting the shape heuristically.
