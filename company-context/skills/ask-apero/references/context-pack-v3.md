# ContextPack v3 Checks

Before synthesis, confirm all of the following:

- `schemaVersion` is `"3"`;
- `candidateManifest.version` is `"2"` and its `hash` is nonblank;
- `requestId`, `organizationKey`, `brainKey`, `question`, and `asOf` are
  present;
- top-level `freshness`, `coverageStatus`, and server-owned `readiness` are
  present and evaluated independently;
- every narrative entry includes its source and revision identity,
  `publicationSetKey`, `entryKey`, `passageKey`, offsets, authority, freshness,
  and truncation state;
- every structured fact includes its provider entity, field path, typed value,
  immutable revision, value hash, authority, timestamps, and locator;
- coverage preserves each corpus and connector scope independently, including
  whether it is required, its status, freshness, controlling generations,
  unresolved failure count, and available observation/reconciliation times;
- narrative and structured conflicts retain all competing revision keys;
- omissions use the canonical `{ reason, count }` shape.

Candidate-manifest v2 hashes the ordered narrative entries and structured facts.
That hash and those exact evidence identities must match across Codex and Claude
Code for the same pinned dataset and question. Generated answer prose may
differ.

## Safe use

- Open material citations with the exact `(publicationSetKey, entryKey)` tuple.
- Treat `readiness: "blocked"` as a stop condition unless a qualified partial
  answer is provably unaffected by every blocker.
- Treat a missing expected scope as unavailable or unknown, never as healthy
  absence.
- Do not collapse coverage records solely because they share a source kind.
- Do not infer current coverage from fresh timestamps or a recent rebuild.
- Do not use a compatibility response for evaluation, dogfood, or a pilot
  receipt.
- Do not answer from entries or structured facts that fail origin, value-hash,
  offset, content-hash, lifecycle, or authorization validation.

If the response does not meet this contract, stop with an incompatibility or
abstention message instead of adapting the shape heuristically.
