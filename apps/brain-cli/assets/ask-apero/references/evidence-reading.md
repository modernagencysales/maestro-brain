# Canonical Evidence Reading

Search results are candidate citations, not complete sources. Each result
contains the exact `sourceKey` and `revisionKey` needed for `sourceGet`, plus an
excerpt, provider, source timestamps, content hash, freshness, and an optional
stable locator.

Use the fields as follows:

- `sourceModifiedAt`: when the authoritative source changed;
- `observedAt`: when Maestro observed that revision;
- `freshness`: the server's current/review-due/stale classification;
- `contentHash`: integrity check between the candidate and exact revision;
- `locator`: provider or source link when disclosure is allowed;
- `tombstone`: the revision records removal and must not support a current
  factual claim.

Prefer a qualified partial answer only when missing or stale evidence cannot
change the supported portion. Otherwise abstain. When sources conflict, present
both with their exact revisions unless an explicit returned authority rule
resolves the conflict. Never infer freshness from the question time or index
time.
